import { store } from '../../kernel/store.js';
import { audit } from '../../kernel/audit.js';
import { importLaundryCatalogue, inferredGarmentVisualKey } from '../laundry/domain.js';
import { VISUAL_ASSETS } from '../laundry/garment-assets.js';
import { fetchCloudApprovedCatalogue, fetchCloudVendorCategories } from './cloud-vendor-services.js';
import type { FetchLike } from './cloud-client.js';

/**
 * Syncs this store's real, admin-approved garment/service catalogue (from
 * `Lndry_backend`'s modern `vendor_services` model, via `cloud-vendor-services.ts`)
 * into the local POS's own master data (`laundry_category`/`laundry_service`/
 * `laundry_garment`/`laundry_price`), so the counter picks from what this
 * vendor is actually approved to sell — not the generic local starter set.
 *
 * Reuses `importLaundryCatalogue()` wholesale rather than writing new upsert
 * logic: that function already matches existing local rows by name (falling
 * back to a name+category lookup for garments) and updates in place on a
 * repeat run, all inside one all-or-nothing transaction with automatic
 * rollback on any failure — exactly the idempotent-re-sync behavior this
 * needs, already shipped and used by the owner-facing CSV catalogue import.
 *
 * Images — two real, genuinely distinct sources, both admin-uploaded (see
 * `cloud-vendor-services.ts`'s header for the full backend-side story,
 * confirmed by reading it directly rather than assumed):
 *   1. `categoryInputs.image` — the CATEGORY's shared photo
 *      (`service_categories.image_url`), same as the category-selector
 *      cards show. One photo per category, shared by every garment in it.
 *   2. `garmentInputs[].photo` — the real PER-GARMENT-TYPE photo
 *      (`garment_types.images[0]`, what the admin dashboard's "Subcategory"
 *      editor uploads) when one was actually uploaded for that specific
 *      garment type, falling back to a type-accurate bundled icon
 *      (`VISUAL_ASSETS[visualKey]`, e.g. a kurta icon for a kurta) when
 *      none was. Never the shared category photo — an earlier version of
 *      this sync stamped that onto every garment card, and live use showed
 *      exactly what that looks like in practice ("kurta / safari suit /
 *      shirt / sweater / t-shirt" all rendering as the literal same image,
 *      indistinguishable at a glance during a busy counter session) — a
 *      real UX regression manual testing caught that curl-only
 *      verification never could, before the real per-garment source was
 *      even known to exist.
 */

const REMOTE_UNIT_MAP: Record<string, string> = {
  piece: 'Piece',
  pair: 'Pair',
  kg: 'Kilogram',
  kilogram: 'Kilogram',
  sqft: 'Square Foot',
  sq_ft: 'Square Foot',
  'square_foot': 'Square Foot',
  'square foot': 'Square Foot',
};

function localUnit(remoteUnit: string): string {
  return REMOTE_UNIT_MAP[remoteUnit.trim().toLowerCase()] || 'Piece';
}

const MAX_EMBEDDED_IMAGE_CHARS = 1_400_000; // stays under saveLaundryCategory's cleanImagePath 1.5M-char ceiling

/** Plain image download — deliberately NOT `FetchLike` (that type is a narrow JSON-only
 * wrapper for authenticated LNDRY API calls and has no `.arrayBuffer()`/`.headers`).
 * Category photos are public Cloudinary URLs, unauthenticated, fetched with the real
 * global `fetch`. */
async function fetchImageAsDataUri(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const contentType = response.headers.get('content-type') || '';
    const mime = contentType.includes('webp') ? 'image/webp' : contentType.includes('png') ? 'image/png' : 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
    if (dataUri.length > MAX_EMBEDDED_IMAGE_CHARS) return undefined;
    return dataUri;
  } catch {
    return undefined;
  }
}

export type CatalogueSyncSummary = {
  categoriesSeen: number;
  servicesSeen: number;
  garmentsSeen: number;
  pricesSeen: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  imagesEmbedded: number;
  imagesSkipped: number;
  demoRowsDeactivated: number;
};

/**
 * `seedLaundryDefaults()` is the only code path anywhere in this codebase
 * that creates `laundry_category`/`laundry_service`/`laundry_garment` rows
 * with `actor: 'system'` — a durable fingerprint, since updating a row never
 * changes its `created_by`. Once a real sync has run, anything still bearing
 * that fingerprint that this sync didn't just touch is leftover generic
 * starter data, not something this vendor is actually approved to sell —
 * soft-deactivate it (never delete, preserving any historical order that
 * referenced it) so the counter shows only the vendor's real catalogue.
 */
function deactivateStaleSeedRows(tenant: string, actor: string, entity: 'laundry_category' | 'laundry_service' | 'laundry_garment', keepNames: Set<string>): number {
  let deactivated = 0;
  for (const row of store.rowsOf(tenant, entity)) {
    if (row.data.active === false) continue;
    if (row.created_by !== 'system') continue;
    if (keepNames.has(String(row.data.name || ''))) continue;
    row.data.active = false;
    row.updated_at = new Date().toISOString();
    store.updateRow(row);
    deactivated += 1;
  }
  if (deactivated) audit(tenant, actor, 'laundry:demo-catalogue-deactivated', { after: { entity, deactivated } });
  return deactivated;
}

export async function syncLocalCatalogueFromCloud(tenant: string, actor: string, fetchImpl?: FetchLike): Promise<CatalogueSyncSummary> {
  const [categories, catalogueRows] = await Promise.all([
    fetchCloudVendorCategories(tenant, fetchImpl),
    fetchCloudApprovedCatalogue(tenant, fetchImpl),
  ]);

  const usedCategoryIds = new Set(catalogueRows.map((row) => row.categoryId));
  const relevantCategories = categories.filter((category) => usedCategoryIds.has(category.id));

  let imagesEmbedded = 0;
  let imagesSkipped = 0;
  // Keyed by the remote URL itself (not by category/garment id) so a garment
  // sharing its category's real photo reuses the one fetch instead of
  // downloading the same image again per garment.
  const dataUriByUrl = new Map<string, string>();
  async function resolveImage(url: string | undefined): Promise<string> {
    if (!url) { imagesSkipped += 1; return ''; }
    const cached = dataUriByUrl.get(url);
    if (cached) return cached;
    const dataUri = await fetchImageAsDataUri(url);
    if (!dataUri) { imagesSkipped += 1; return ''; }
    dataUriByUrl.set(url, dataUri);
    imagesEmbedded += 1;
    return dataUri;
  }

  const categoryInputs: Array<{ name: string; image: string; active: boolean }> = [];
  for (const category of relevantCategories) {
    categoryInputs.push({ name: category.name, image: await resolveImage(category.imageUrl), active: true });
  }

  const serviceNameById = new Map<string, string>();
  for (const row of catalogueRows) serviceNameById.set(row.vendorServiceId, row.serviceName);
  const serviceInputs = [...new Set(serviceNameById.values())].map((name) => ({ name, active: true }));

  const garmentByType = new Map<string, { name: string; categoryName: string; unit: string; garmentImageUrl?: string }>();
  for (const row of catalogueRows) {
    if (!garmentByType.has(row.garmentTypeId)) {
      garmentByType.set(row.garmentTypeId, { name: row.garmentName, categoryName: row.categoryName, unit: localUnit(row.unit), garmentImageUrl: row.garmentImageUrl });
    }
  }
  const garmentInputs: Array<{ name: string; category: string; unit: string; visualKey: string; photo: string; active: boolean }> = [];
  for (const garment of garmentByType.values()) {
    // The real per-garment-type photo when an admin actually uploaded one
    // (see this file's header) — falling back to a type-accurate bundled
    // icon, never the shared category photo (that produced every garment
    // in a category rendering as the literal same image).
    const visualKey = inferredGarmentVisualKey(garment.name, garment.categoryName);
    const photo = garment.garmentImageUrl ? await resolveImage(garment.garmentImageUrl) : '';
    garmentInputs.push({ name: garment.name, category: garment.categoryName, unit: garment.unit, visualKey, photo: photo || VISUAL_ASSETS[visualKey] || '', active: true });
  }

  const priceInputs = catalogueRows.map((row) => ({
    garment: row.garmentName,
    service: row.serviceName,
    rate: row.ratePaise / 100,
    active: true,
  }));

  const result = importLaundryCatalogue(tenant, actor, {
    categories: categoryInputs,
    services: serviceInputs,
    garments: garmentInputs,
    prices: priceInputs,
  });

  const demoRowsDeactivated =
    deactivateStaleSeedRows(tenant, actor, 'laundry_category', new Set(categoryInputs.map((c) => c.name)))
    + deactivateStaleSeedRows(tenant, actor, 'laundry_service', new Set(serviceInputs.map((s) => s.name)))
    + deactivateStaleSeedRows(tenant, actor, 'laundry_garment', new Set(garmentInputs.map((g) => g.name)));

  return {
    categoriesSeen: categoryInputs.length,
    servicesSeen: serviceInputs.length,
    garmentsSeen: garmentInputs.length,
    pricesSeen: priceInputs.length,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors,
    imagesEmbedded,
    imagesSkipped,
    demoRowsDeactivated,
  };
}
