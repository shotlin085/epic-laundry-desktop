import { randomUUID } from 'node:crypto';
import { store, type MarketplaceOrderProjectionRecord, type MarketplaceOrderState } from '../../kernel/store.js';
import { audit } from '../../kernel/audit.js';
import { callConnectedCloudApiEnvelope, getCloudConnectionStatus } from './cloud-session.js';
import { createMarketplaceOrderRequest } from './order-truth.js';
import type { FetchLike } from './cloud-client.js';

/**
 * Pulls this store's real orders from the connected LNDRY Cloud Backend
 * vendor account and materializes them as `marketplace_order_projections`
 * rows (channel='MARKETPLACE') — the same projection table edge-sync.ts's
 * envelope/device pipeline writes to.
 *
 * Deliberately does NOT go through edge-sync.ts's `receiveMarketplaceOrder`.
 * That function is gated behind `requireRegisteredDevice`, which requires a
 * marketplace device with status='Registered' — but Desktop's own device
 * enrollment flow is permanently blocked
 * (`activation: 'EXTERNAL_MARKETPLACE_ACTIVATION_REQUIRED'`, api.ts) because
 * there is nothing on the real backend to activate it against (confirmed:
 * the backend's only "device" concept is an FCM push-token registry, not a
 * marketplace sync control plane — see CLOUD_EDGE_ARCHITECTURE.md). Routing
 * through that gate would mean either building a second fake activation flow
 * or silently bypassing a check that exists for a reason, for a different
 * transport than the one this module actually uses. Instead this calls the
 * lower-level `store.saveMarketplaceOrderProjection` directly — the real
 * persistence logic, already idempotent by (tenant, store, channel,
 * external_order_id) — using the connected cloud session as its own,
 * independent trust boundary.
 */

/**
 * Mapping derived from the REAL Postgres `order_status` enum (queried
 * directly: `SELECT unnest(enum_range(NULL::order_status))` against a live
 * local backend — 27 values), not from `vendor-orders.routes.js`'s
 * querystring filter schema, which is a DIFFERENT, overlapping-but-not-
 * identical list. That schema lists `WASHING`/`DRYING`/`IRONING` as filter
 * options, but those strings are never actually stored in `orders.status` —
 * the service translates them into `status = 'PROCESSING' AND
 * processing_stage = 'Washing'` for the query only
 * (`vendor-orders.service.js#listOrders`). A live test order confirmed this:
 * inserting one with `processing_stage = 'Washing'` came back from the real
 * `/vendor/orders` endpoint as `"status":"PROCESSING"`, not `"WASHING"` — the
 * first version of this mapping keyed on `WASHING`/`DRYING`/`IRONING` and
 * would have skipped every real order in a wash/dry/iron stage as
 * "unmapped". Fixed by keying on the real enum value, `PROCESSING`.
 *
 * Local-state semantics cross-checked against `customer-status.ts`'s own
 * mapping table (e.g. IntakeRequired: 'Received', Ready: 'Ready'), not
 * guessed from the label alone.
 *
 * The enum also contains several generic e-commerce-shaped values (PENDING,
 * CONFIRMED, PREPARING, PAYMENT_PENDING, PAYMENT_FAILED,
 * WAITING_FOR_VENDOR_CONFIRMATION, OUT_FOR_DELIVERY, CANCELLED) that
 * `vendor-orders.routes.js`'s own filter list doesn't mention at all — likely
 * from a broader/earlier non-laundry order type sharing the same table and
 * enum. Mapped here on a best-effort basis by analogy to their laundry
 * equivalents so a real order in one of these states is never silently
 * skipped, but — unlike every LNDRY-specific value above — these were not
 * confirmed against an actual reachable `/vendor/orders` response, since no
 * live order in any of these states could be produced from a fresh seed.
 */
const REMOTE_STATUS_MAP: Record<string, MarketplaceOrderState> = {
  WAITING_VENDOR_CONFIRMATION: 'AwaitingAcceptance',
  VENDOR_ACCEPTED: 'Accepted',
  PICKUP_ASSIGNED: 'PickupScheduled',
  GOING_FOR_PICKUP: 'PickupScheduled',
  PICKUP_OTP_VERIFIED: 'PickupScheduled',
  PICKED_UP: 'IntakeRequired',
  RECEIVED_AT_VENDOR: 'IntakeRequired',
  RECONCILIATION_PENDING: 'CustomerApprovalRequired',
  RECONCILIATION_DISPUTED: 'CustomerApprovalRequired',
  // The real, confirmed-live value — see the block comment above.
  PROCESSING: 'Processing',
  PACKED: 'Ready',
  DELIVERY_ASSIGNED: 'DeliveryScheduled',
  OUT_FOR_DELIVERY: 'DeliveryScheduled',
  DELIVERY_OTP_VERIFIED: 'DeliveryScheduled',
  DELIVERED: 'Completed',
  VENDOR_REJECTED: 'Rejected',
  AUTO_REJECTED: 'Rejected',
  CUSTOMER_CANCELLED: 'Cancelled',
  ADMIN_CANCELLED: 'Cancelled',
  CANCELLED: 'Cancelled',
  // A refund is a financial fact layered on top of an already-concluded
  // delivery lifecycle in the real backend's model, not a distinct lifecycle
  // stage in Desktop's local one — same reasoning customer-status.ts already
  // applies to Rejected/Expired both collapsing to 'Cancelled'.
  REFUNDED: 'Completed',
  // Best-effort mappings for the non-LNDRY-specific enum values — see the
  // block comment above for why these are lower-confidence than everything
  // above this line.
  PENDING: 'AwaitingAcceptance',
  CONFIRMED: 'Accepted',
  PREPARING: 'Processing',
  WAITING_FOR_VENDOR_CONFIRMATION: 'AwaitingAcceptance',
  PAYMENT_PENDING: 'AwaitingAcceptance',
  PAYMENT_FAILED: 'Cancelled',
};
export function mapRemoteOrderStatus(remoteStatus: string): MarketplaceOrderState {
  const mapped = REMOTE_STATUS_MAP[String(remoteStatus || '').toUpperCase()];
  if (!mapped) throw new Error(`CLOUD_ORDER_UNKNOWN_STATUS:${remoteStatus}`);
  return mapped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const CLOUD_ORDER_PAGE_SIZE = 100;
// The real backend currently offers offset pagination, not a stable cursor.
// Bound one reconciliation pass rather than silently truncating an unusually
// large vendor account or holding a Desktop process hostage forever.
const MAX_CLOUD_ORDER_PAGES_PER_PULL = 1_000;

type CloudOrderPage = { orders: unknown[]; totalPages?: number };

function cloudOrderPage(raw: Record<string, unknown>): CloudOrderPage {
  const orders = raw.data;
  if (!Array.isArray(orders)) throw new Error('CLOUD_ORDER_LIST_UNEXPECTED_RESPONSE');
  const meta = isRecord(raw.meta) ? raw.meta : undefined;
  const pagination = meta && isRecord(meta.pagination) ? meta.pagination : undefined;
  const totalPages = pagination && Number(pagination.totalPages);
  if (totalPages !== undefined && (!Number.isSafeInteger(totalPages) || totalPages < 0)) {
    throw new Error('CLOUD_ORDER_LIST_INVALID_PAGINATION');
  }
  return { orders, totalPages };
}

async function pullCloudOrderPages(tenant: string, fetchImpl?: FetchLike): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let page = 1; page <= MAX_CLOUD_ORDER_PAGES_PER_PULL; page += 1) {
    const envelope = await callConnectedCloudApiEnvelope(tenant, `/vendor/orders?page=${page}&limit=${CLOUD_ORDER_PAGE_SIZE}`, fetchImpl);
    const result = cloudOrderPage(envelope);
    all.push(...result.orders);
    if (result.totalPages !== undefined) {
      if (page >= result.totalPages) return all;
    } else if (result.orders.length < CLOUD_ORDER_PAGE_SIZE) {
      // Compatibility fallback for a deployed backend that has not yet
      // supplied pagination metadata. A short page is an unambiguous end.
      return all;
    }
  }
  throw new Error('CLOUD_ORDER_SYNC_PAGE_LIMIT_EXCEEDED');
}

export type CloudOrderSyncSummary = { pulled: number; created: number; updated: number; skipped: Array<{ externalOrderId: string; reason: string }> };

/**
 * A recurring pull must not manufacture a new source revision merely because
 * the transport was polled again. Keep the comparison intentionally limited
 * to cloud-owned fields: local notes, preferences, links and timestamps are
 * maintained by the Desktop and must not cause a cloud rewrite.
 */
function hasSameCloudSource(existing: MarketplaceOrderProjectionRecord, candidate: MarketplaceOrderProjectionRecord) {
  return existing.vendorId === candidate.vendorId
    && existing.state === candidate.state
    && existing.orderNumber === candidate.orderNumber
    && existing.paymentState === candidate.paymentState
    && JSON.stringify(existing.customer) === JSON.stringify(candidate.customer)
    && JSON.stringify(existing.pickup) === JSON.stringify(candidate.pickup)
    && JSON.stringify(existing.request) === JSON.stringify(candidate.request);
}

export async function pullCloudOrders(tenant: string, actor: string, fetchImpl?: FetchLike): Promise<CloudOrderSyncSummary> {
  const status = getCloudConnectionStatus(tenant);
  if (!status.connected) throw new Error('CLOUD_NOT_CONNECTED');
  if (!status.remoteVendorId) throw new Error('CLOUD_VENDOR_NOT_LINKED');

  const raw = await pullCloudOrderPages(tenant, fetchImpl);

  const storeId = store.currentStore(tenant);
  const summary: CloudOrderSyncSummary = { pulled: raw.length, created: 0, updated: 0, skipped: [] };
  const now = new Date().toISOString();

  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) {
      summary.skipped.push({ externalOrderId: String((entry as Record<string, unknown>)?.id || 'unknown'), reason: 'missing order id' });
      continue;
    }
    let localState: MarketplaceOrderState;
    try {
      localState = mapRemoteOrderStatus(String(entry.status || ''));
    } catch (err) {
      summary.skipped.push({ externalOrderId: entry.id, reason: err instanceof Error ? err.message : 'unmapped status' });
      continue;
    }

    const existing = store.getMarketplaceOrderProjection(tenant, 'MARKETPLACE', entry.id);
    const record: MarketplaceOrderProjectionRecord = {
      id: existing?.id || randomUUID(),
      tenant,
      storeId,
      vendorId: status.remoteVendorId,
      channel: 'MARKETPLACE',
      externalOrderId: entry.id,
      // This only becomes a new source revision after the cloud-owned
      // snapshot is proven different below. A 30-second polling fallback
      // must not create fake change history for an unchanged order.
      sourceVersion: (existing?.sourceVersion || 0) + 1,
      state: localState,
      orderNumber: typeof entry.order_number === 'string' ? entry.order_number : entry.id,
      customer: { name: entry.customer_name ?? null, phone: entry.customer_phone ?? null, remoteUserId: entry.user_id ?? null },
      pickup: { pickupDate: entry.pickup_date ?? null, vendorSlotId: entry.vendor_slot_id ?? null, pickupOtp: undefined },
      request: {
        items: entry.items ?? [],
        subtotal: entry.subtotal ?? null,
        deliveryFee: entry.delivery_fee ?? null,
        platformFee: entry.platform_fee ?? null,
        taxAmount: entry.tax_amount ?? null,
        handlingFee: entry.handling_fee ?? null,
        totalAmount: entry.total_amount ?? null,
        estimatedAmountPaise: entry.estimated_amount_paise ?? null,
        payableAmountPaise: entry.payable_amount_paise ?? null,
        feeBreakdown: entry.fee_breakdown ?? {},
        processingStage: entry.processing_stage ?? null,
        remoteStatus: entry.status,
      },
      paymentState: typeof entry.payment_status === 'string' ? entry.payment_status : 'Unknown',
      preferences: existing?.preferences || '',
      notes: existing?.notes || '',
      syncState: 'Current',
      localOrderId: existing?.localOrderId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    // Record the customer's ORIGINAL request as its own immutable row the
    // first time this order is seen. Everything downstream — physical intake,
    // a reconciliation proposal, the customer's decision — is stored against
    // it rather than editing it, so what the customer actually asked for
    // survives no matter how many times the order is later recounted or
    // repriced. `createMarketplaceOrderRequest` returns the existing row
    // unchanged on every later sync, so re-pulling can never rewrite it.
    createMarketplaceOrderRequest(tenant, actor, {
      externalOrderId: entry.id,
      channel: 'MARKETPLACE',
      estimate: record.request,
      customer: record.customer,
      requestedAt: typeof entry.created_at === 'string' ? entry.created_at : undefined,
    });

    if (existing && hasSameCloudSource(existing, record)) continue;

    store.saveMarketplaceOrderProjection(record);
    if (existing) summary.updated += 1; else summary.created += 1;
  }

  audit(tenant, actor, 'marketplace:cloud-orders-synced', { entity: 'marketplace_order_projection', row_id: tenant, after: { pulled: summary.pulled, created: summary.created, updated: summary.updated, skipped: summary.skipped.length } });
  return summary;
}
