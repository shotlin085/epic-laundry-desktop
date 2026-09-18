import { getCloudConnectionStatus, callConnectedCloudApi, postConnectedCloudApi } from './cloud-session.js';
import type { FetchLike } from './cloud-client.js';

/**
 * The real backend's *modern* vendor-services/catalogue model
 * (`service_categories` → `vendor_services` → `vendor_service_rates`), used
 * by the real admin dashboard and the real customer discovery feed —
 * distinct from `cloud-catalogue.ts`, which talks to a separate, legacy,
 * semi-deprecated `shop-garment_rates` module on the same underlying
 * `vendor_services` table. That module stays as-is (still useful for
 * price/stock editing on services that already exist); this one exists for
 * a different job: syncing the vendor's real, admin-approved catalogue
 * (with real category images) into the local POS, and letting the vendor
 * request a brand-new service through the same PENDING→admin-approve/reject
 * lifecycle a vendor application itself goes through.
 *
 * Real image story, confirmed by reading the backend directly (this took two
 * passes to get right — worth recording precisely for whoever reads this
 * next): `vendor_services.image_asset_id` is defined in schema but never
 * written anywhere in the backend (`getReconciliationCatalogue`'s own query
 * does `COALESCE(vs.image_asset_id, sc.image_url)`, and the first half is
 * always null in practice) — so `imageUrl` above is always really just the
 * shared category photo (`service_categories.image_url`), same as the
 * category selector shows. A genuine PER-GARMENT-TYPE photo does exist,
 * though, on a different column entirely: the admin dashboard's
 * "Subcategory" editor (`laundry-categories` page — "subcategory" is that
 * dashboard's name for a `garment_types` row, not a `vendor_services` row,
 * confusingly) uploads to `garment_types.images[0]` (`thumbnail_url` was
 * dropped from that table in migration 062; `images` JSONB is what
 * actually persists it, round-tripped correctly by every OTHER endpoint
 * that reads it). `getReconciliationCatalogue`'s query joins `garment_types`
 * but historically never selected that column — so a real, correctly
 * uploaded per-garment photo could never reach this sync no matter what,
 * until the join was extended to also select `gt.images->>0 AS
 * garment_image_url`. That's `garmentImageUrl` below — genuinely per-garment,
 * only present when an admin actually uploaded one for that specific type.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireLinkedVendor(tenant: string) {
  const status = getCloudConnectionStatus(tenant);
  if (!status.connected) throw new Error('CLOUD_NOT_CONNECTED');
  if (!status.remoteVendorId) throw new Error('CLOUD_VENDOR_NOT_LINKED');
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function num(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export type CloudVendorCategory = {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  sortOrder: number;
};

/** One row per garment-type this vendor can charge for, across every
 * active+APPROVED service — the real approved catalogue for sync purposes. */
export type CloudApprovedCatalogueRow = {
  garmentTypeId: string;
  garmentName: string;
  unit: string;
  ratePaise: number;
  vendorServiceId: string;
  serviceName: string;
  categoryId: string;
  categoryName: string;
  /** The category's shared photo (`service_categories.image_url` — the
   * same one the category selector uses), NOT a per-garment photo. */
  imageUrl?: string;
  /** The real per-garment-type photo, if an admin uploaded one for THIS
   * specific garment type (`garment_types.images[0]` — what the admin
   * dashboard calls a "subcategory" image). Distinct from `imageUrl`
   * above, and was missing from this endpoint entirely until now — the
   * query joined `garment_types` but never selected its `images` column,
   * so a real per-garment photo could never reach a vendor's own catalogue
   * sync no matter how correctly it was uploaded. */
  garmentImageUrl?: string;
};

export type CloudVendorService = {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  categoryName?: string;
  pricePerPiecePaise: number;
  minWeightKg: number;
  isAvailable: boolean;
  approvalStatus: string;
  rejectionReason?: string;
};

function toCategory(raw: unknown): CloudVendorCategory | undefined {
  if (!isRecord(raw)) return undefined;
  const id = str(raw.id);
  if (!id) return undefined;
  return {
    id,
    name: str(raw.name),
    description: str(raw.description),
    imageUrl: typeof raw.image_url === 'string' && raw.image_url ? raw.image_url : undefined,
    sortOrder: num(raw.sort_order) ?? 0,
  };
}

function toCatalogueRow(raw: unknown): CloudApprovedCatalogueRow | undefined {
  if (!isRecord(raw)) return undefined;
  const garmentTypeId = str(raw.garment_type_id);
  const vendorServiceId = str(raw.vendor_service_id);
  if (!garmentTypeId || !vendorServiceId) return undefined;
  return {
    garmentTypeId,
    garmentName: str(raw.garment_name),
    unit: str(raw.unit) || 'Piece',
    ratePaise: num(raw.rate_paise) ?? 0,
    vendorServiceId,
    serviceName: str(raw.service_name),
    categoryId: str(raw.category_id),
    categoryName: str(raw.category_name),
    imageUrl: typeof raw.image_url === 'string' && raw.image_url ? raw.image_url : undefined,
    garmentImageUrl: typeof raw.garment_image_url === 'string' && raw.garment_image_url ? raw.garment_image_url : undefined,
  };
}

function toVendorService(raw: unknown): CloudVendorService | undefined {
  if (!isRecord(raw)) return undefined;
  const id = str(raw.id);
  if (!id) return undefined;
  return {
    id,
    name: str(raw.name),
    description: str(raw.description),
    categoryId: str(raw.category_id),
    categoryName: typeof raw.category_name === 'string' ? raw.category_name : undefined,
    pricePerPiecePaise: num(raw.price_per_piece) ?? 0,
    minWeightKg: num(raw.min_weight_kg) ?? 1,
    isAvailable: Boolean(raw.is_available),
    approvalStatus: str(raw.approval_status) || 'PENDING',
    rejectionReason: typeof raw.rejection_reason === 'string' && raw.rejection_reason ? raw.rejection_reason : undefined,
  };
}

/** `GET /vendor/categories` — the real master category list (admin-managed, shared across all vendors). */
export async function fetchCloudVendorCategories(tenant: string, fetchImpl?: FetchLike): Promise<CloudVendorCategory[]> {
  requireLinkedVendor(tenant);
  const raw = await callConnectedCloudApi(tenant, '/vendor/categories', fetchImpl);
  const rows = Array.isArray(raw) ? raw : [];
  const mapped: CloudVendorCategory[] = [];
  for (const row of rows) {
    const parsed = toCategory(row);
    if (parsed) mapped.push(parsed);
  }
  return mapped;
}

/** `GET /vendor/services/catalogue` — flat, APPROVED-only garment/price rows across every active service this vendor actually offers. This is the real catalogue to sync into the local POS. */
export async function fetchCloudApprovedCatalogue(tenant: string, fetchImpl?: FetchLike): Promise<CloudApprovedCatalogueRow[]> {
  requireLinkedVendor(tenant);
  const raw = await callConnectedCloudApi(tenant, '/vendor/services/catalogue', fetchImpl);
  const rows = Array.isArray(raw) ? raw : [];
  const mapped: CloudApprovedCatalogueRow[] = [];
  for (const row of rows) {
    const parsed = toCatalogueRow(row);
    if (parsed) mapped.push(parsed);
  }
  return mapped;
}

/** `GET /vendor/services` — this vendor's own services, every approval status (PENDING/APPROVED/REJECTED) — for the request-a-new-service status view. */
export async function fetchCloudVendorServices(tenant: string, fetchImpl?: FetchLike): Promise<CloudVendorService[]> {
  requireLinkedVendor(tenant);
  const raw = await callConnectedCloudApi(tenant, '/vendor/services', fetchImpl);
  const rows = Array.isArray(raw) ? raw : [];
  const mapped: CloudVendorService[] = [];
  for (const row of rows) {
    const parsed = toVendorService(row);
    if (parsed) mapped.push(parsed);
  }
  return mapped;
}

export type CloudVendorServiceGarmentRate = {
  garmentTypeId: string;
  garmentName: string;
  unit: string;
  ratePaise: number;
  isAvailable: boolean;
};

/** `GET /vendor/services/:serviceId` — full detail for one of this vendor's own services, including
 * every garment-type rate row. Creating a service (`createCloudServiceDraft`) auto-seeds a zero-rate
 * row for every active garment type in that category on the real backend — this is how the vendor
 * discovers which garment types they need to actually price, without hand-picking them. */
export async function fetchCloudVendorServiceDetails(tenant: string, serviceId: string, fetchImpl?: FetchLike): Promise<{ categoryName: string; service: CloudVendorService; garments: CloudVendorServiceGarmentRate[] }> {
  requireLinkedVendor(tenant);
  const raw = await callConnectedCloudApi(tenant, `/vendor/services/${encodeURIComponent(serviceId)}`, fetchImpl);
  if (!isRecord(raw)) throw new Error('CLOUD_INVALID_RESPONSE');
  const service = toVendorService(raw.service);
  if (!service) throw new Error('CLOUD_INVALID_RESPONSE');
  const category = isRecord(raw.category) ? raw.category : undefined;
  const garmentRows = Array.isArray(raw.garments) ? raw.garments : [];
  const garments: CloudVendorServiceGarmentRate[] = [];
  for (const row of garmentRows) {
    if (!isRecord(row)) continue;
    const garmentTypeId = str(row.garment_rate_id);
    if (!garmentTypeId) continue;
    garments.push({
      garmentTypeId,
      garmentName: str(row.garment_name),
      unit: str(row.unit) || 'Piece',
      ratePaise: num(row.rate_paise) ?? 0,
      isAvailable: Boolean(row.is_available),
    });
  }
  return { categoryName: str(category?.name), service, garments };
}

/** `POST /vendor/services` — create a new service draft under a category; the real backend sets `approval_status='PENDING'` (same lifecycle a vendor application itself goes through). */
export async function createCloudServiceDraft(
  tenant: string,
  input: { categoryId: string; name: string; description?: string; pricePerPiecePaise: number; minWeightKg?: number },
  fetchImpl?: FetchLike,
): Promise<CloudVendorService> {
  requireLinkedVendor(tenant);
  const body = {
    category_id: input.categoryId,
    name: input.name,
    description: input.description || '',
    price_per_piece: input.pricePerPiecePaise,
    min_weight_kg: input.minWeightKg ?? 1,
    is_available: true,
  };
  const raw = await postConnectedCloudApi(tenant, '/vendor/services', body, fetchImpl);
  const parsed = toVendorService(raw);
  if (!parsed) throw new Error('CLOUD_INVALID_RESPONSE');
  return parsed;
}

/** `POST /vendor/services/:serviceId/garment-rates/bulk` — attach real per-garment rates to a freshly-created draft so it's usable, not an empty shell.
 * Body field is `garment_rates` (confirmed live — `rates` 400s with "garment_rates array is required"; the
 * real controller destructures `garment_rates` specifically, not the more generic name used elsewhere). */
export async function bulkUpsertCloudGarmentRates(
  tenant: string,
  serviceId: string,
  rates: Array<{ garmentTypeId: string; ratePaise: number }>,
  fetchImpl?: FetchLike,
): Promise<void> {
  requireLinkedVendor(tenant);
  const body = { garment_rates: rates.map((rate) => ({ garment_type_id: rate.garmentTypeId, rate_paise: rate.ratePaise })) };
  await postConnectedCloudApi(tenant, `/vendor/services/${encodeURIComponent(serviceId)}/garment-rates/bulk`, body, fetchImpl);
}
