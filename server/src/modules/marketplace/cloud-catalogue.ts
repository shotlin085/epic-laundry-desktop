import { getCloudConnectionStatus, callConnectedCloudApi, patchConnectedCloudApi } from './cloud-session.js';
import type { FetchLike } from './cloud-client.js';

/**
 * Reading and editing this store's real marketplace catalogue
 * (`vendor_services` on the real backend) — price, sale price, cost price,
 * stock quantity, low-stock threshold, max order quantity, and availability
 * — through the connected cloud session.
 *
 * Two separate real backend endpoints, kept as two separate functions here
 * rather than one: `PATCH /shop-garment_rates/:id` updates every field
 * except stock (price/availability/etc.); `PATCH /shop-garment_rates/:id/stock`
 * updates only `stock_quantity`, under its own row-level lock
 * (`shop-garment_rates.repository.js`'s `applyStockUpdate`, `SELECT ... FOR
 * UPDATE`) and its own rate limit (30/min) on the real backend. Folding stock
 * into the general update would be calling an endpoint that doesn't exist.
 *
 * Deliberately narrower than the full `shop-garment_rates` surface: create,
 * soft-delete, bulk-price-update, manual product creation, and the HQ
 * approve/reject routes are not exposed here. The nested
 * `bulk-price-update`/`manual`/`adjust-stock`(ledger) routes are gated by a
 * different, still-unresolved mechanism (`requirePermission`, which reads an
 * empty `permissions` array for every real account today — see
 * docs/v5/CROSS_REPOSITORY_CAPABILITY_MATRIX.md §5a) and create/delete were
 * not part of this phase's scope. This module only covers what Phase 1
 * actually unblocked: list, get, update price/availability/etc., update
 * stock.
 */

export type CloudCatalogueItem = {
  id: string;
  garmentTypeId: string;
  name: string;
  sku?: string;
  categoryName?: string;
  price?: number;
  salePrice?: number;
  costPrice?: number;
  stockQuantity: number;
  lowStockThreshold: number;
  maxOrderQty: number;
  isAvailable: boolean;
  isFeatured: boolean;
  approvalStatus: string;
  updatedAt: string;
};

export type CloudCatalogueUpdate = {
  price?: number;
  salePrice?: number;
  costPrice?: number;
  lowStockThreshold?: number;
  maxOrderQty?: number;
  isAvailable?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// `Number(null) === 0` is a real JS trap here: sale_price/cost_price are
// genuinely absent (SQL NULL) for most real services (confirmed live —
// "Small Carpet" has sale_price: null), and treating that as a real 0
// would both display a fake "sale ₹0" and, worse, pre-fill the edit form
// with 0 so an unrelated save could silently set a real price to zero.
function num(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requireLinkedVendor(tenant: string) {
  const status = getCloudConnectionStatus(tenant);
  if (!status.connected) throw new Error('CLOUD_NOT_CONNECTED');
  if (!status.remoteVendorId) throw new Error('CLOUD_VENDOR_NOT_LINKED');
}

function toCatalogueItem(raw: unknown): CloudCatalogueItem | undefined {
  if (!isRecord(raw)) return undefined;
  const id = String(raw.id || '');
  if (!id) return undefined;
  const product = isRecord(raw.product) ? raw.product : undefined;
  return {
    id,
    garmentTypeId: String(raw.garment_rate_id || ''),
    name: String(product?.name || ''),
    sku: typeof product?.sku === 'string' && product.sku ? product.sku : undefined,
    categoryName: typeof product?.category_name === 'string' && product.category_name ? product.category_name : undefined,
    price: num(raw.price),
    salePrice: num(raw.sale_price),
    costPrice: num(raw.cost_price),
    stockQuantity: num(raw.stock_quantity) ?? 0,
    lowStockThreshold: num(raw.low_stock_threshold) ?? 0,
    maxOrderQty: num(raw.max_order_qty) ?? 0,
    isAvailable: Boolean(raw.is_available),
    isFeatured: Boolean(raw.is_featured),
    approvalStatus: String(raw.approval_status || ''),
    updatedAt: String(raw.updated_at || ''),
  };
}

/**
 * Fetches this store's real priced marketplace services.
 *
 * `limit=100` is a simple v1 ceiling, not real pagination — it is also the
 * real backend's own hard maximum (`shop-garment_rates.routes.js`'s
 * querystring schema: `maximum: 100`; confirmed live — `limit=200` 400s
 * with a real `VALIDATION_ERROR`, not a silently clamped value). The real
 * seeded vendor used for every live check this session has 13 items. A
 * store with more than 100 would silently see only the first page; noted
 * here rather than quietly assumed away.
 */
export async function fetchCloudCatalogue(tenant: string, fetchImpl?: FetchLike): Promise<CloudCatalogueItem[]> {
  requireLinkedVendor(tenant);
  const raw = await callConnectedCloudApi(tenant, '/shop-garment_rates?limit=100', fetchImpl);
  const items = isRecord(raw) && Array.isArray(raw.items) ? raw.items : [];
  const mapped: CloudCatalogueItem[] = [];
  for (const item of items) {
    const parsed = toCatalogueItem(item);
    if (parsed) mapped.push(parsed);
  }
  return mapped;
}

/** Price/sale price/cost price/low-stock threshold/max order qty/availability — everything `PATCH /:id` accepts except stock. */
export async function updateCloudCatalogueItem(tenant: string, itemId: string, update: CloudCatalogueUpdate, fetchImpl?: FetchLike): Promise<CloudCatalogueItem> {
  requireLinkedVendor(tenant);
  const body: Record<string, unknown> = {};
  if (update.price !== undefined) body.price = update.price;
  if (update.salePrice !== undefined) body.sale_price = update.salePrice;
  if (update.costPrice !== undefined) body.cost_price = update.costPrice;
  if (update.lowStockThreshold !== undefined) body.low_stock_threshold = update.lowStockThreshold;
  if (update.maxOrderQty !== undefined) body.max_order_qty = update.maxOrderQty;
  if (update.isAvailable !== undefined) body.is_available = update.isAvailable;
  const raw = await patchConnectedCloudApi(tenant, `/shop-garment_rates/${encodeURIComponent(itemId)}`, body, fetchImpl);
  const parsed = toCatalogueItem(raw);
  if (!parsed) throw new Error('CLOUD_CATALOGUE_UPDATE_UNEXPECTED_RESPONSE');
  return parsed;
}

/**
 * Stock quantity only — the real backend's separate, row-locked `/stock`
 * endpoint. Its response is shaped differently from `PATCH /:id`'s — confirmed
 * live: `{ shopProduct: {...vendor_services columns...}, prev: {...} }`, not
 * the flat row itself — and `shopProduct` has no joined product/category
 * (it comes from `findByIdForUpdate`'s plain `SELECT * FROM vendor_services`,
 * no JOIN). The caller only needs confirmation the write landed, not a full
 * re-render of the row, so `name`/`categoryName` are honestly left empty
 * here rather than faked from data this endpoint never returned.
 */
export async function updateCloudCatalogueStock(tenant: string, itemId: string, stockQuantity: number, fetchImpl?: FetchLike): Promise<CloudCatalogueItem> {
  requireLinkedVendor(tenant);
  const raw = await patchConnectedCloudApi(tenant, `/shop-garment_rates/${encodeURIComponent(itemId)}/stock`, { stock_quantity: stockQuantity }, fetchImpl);
  const shopProduct = isRecord(raw) && isRecord(raw.shopProduct) ? raw.shopProduct : raw;
  const parsed = toCatalogueItem(shopProduct);
  if (!parsed) throw new Error('CLOUD_CATALOGUE_UPDATE_UNEXPECTED_RESPONSE');
  return parsed;
}
