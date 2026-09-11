import { store, type MarketplaceOrderProjectionRecord, type MarketplaceOrderState } from '../../kernel/store.js';
import { audit } from '../../kernel/audit.js';
import { materializeMarketplaceOrder } from './edge-sync.js';
import { CloudClientError } from './cloud-client.js';
import { callConnectedCloudApi, getCloudConnectionStatus, postConnectedCloudApi } from './cloud-session.js';
import { mapRemoteOrderStatus } from './cloud-order-sync.js';
import type { FetchLike } from './cloud-client.js';

/**
 * Vendor accept/reject for marketplace orders, executed against the REAL
 * LNDRY Cloud Backend as the authority.
 *
 * Why cloud-first (not local-first-then-push): accepting or rejecting a
 * marketplace order is a coordination fact the customer, the rider, and the
 * platform all depend on — the cloud owns it. Desktop writing "Accepted"
 * locally and hoping to push later would let the operator see a confirmed
 * state that the customer's app never agreed to. So the remote transition is
 * attempted first, and local state is only written once the remote is known.
 *
 * edge-sync.ts's existing `actOnMarketplaceOrder` does the local-only version
 * of this (and marks it `syncState: 'PendingOutbound'` for a push that has no
 * real transport). It is also gated behind `requireRegisteredDevice`, which
 * can never be satisfied (see cloud-order-sync.ts's header). This module is
 * the cloud-connected counterpart; it reuses the genuinely valuable part of
 * that flow — `materializeMarketplaceOrder`, which bridges a marketplace
 * order into a real local laundry order — and is not device-gated.
 */

export type CloudOrderActionOutcome = {
  externalOrderId: string;
  action: 'accept' | 'reject';
  /** The remote status after the action — the authoritative answer, not a local guess. */
  remoteStatus: string;
  /**
   * How the remote responded:
   *
   * - `'applied'` — the remote accepted the call. Note this covers both a
   *   fresh transition AND an idempotent repeat: the backend's state machine
   *   deliberately treats a same-status transition as a valid no-op
   *   (`validateTransition` returns valid when current === next, verified
   *   against a live backend), and its response is byte-identical either way.
   *   Desktop does not spend an extra round trip guessing which happened,
   *   so this value does not claim to distinguish them.
   * - `'already_final'` — the remote REFUSED the transition, and re-reading
   *   the order showed it was already in the state this action wanted. A
   *   retry that raced ahead, or another client with the same intent. The
   *   business outcome is what the operator asked for, so it is a success,
   *   but it is reported distinctly rather than hidden.
   *
   * A remote state incompatible with the requested action is not a value here
   * — it raises CloudOrderConflictError.
   */
  transition: 'applied' | 'already_final';
  projectionState: MarketplaceOrderState;
  localOrderId?: string;
  /**
   * Whether a local operational order now exists — and if not, WHY not, in
   * terms of what someone has to do about it. These are deliberately separate
   * outcomes rather than one "not materialized" bucket, because each implies a
   * different next action: wait for the physical bags, wait for the customer,
   * or go fix the store's tax setup.
   */
  materialization: 'created' | 'already_materialized' | 'awaiting_intake' | 'awaiting_customer_approval' | 'blocked_by_setup' | 'not_applicable';
  /** Set when materialization is deferred — the real underlying reason, surfaced rather than swallowed. */
  materializationReason?: string;
};

export class CloudOrderConflictError extends Error {
  code = 'CLOUD_ORDER_CONFLICT' as const;
  remoteStatus: string;
  attempted: 'accept' | 'reject';
  constructor(attempted: 'accept' | 'reject', remoteStatus: string) {
    super(`cloud rejected the ${attempted}: the order is now ${remoteStatus} on the marketplace`);
    this.attempted = attempted;
    this.remoteStatus = remoteStatus;
  }
}

const TARGET_REMOTE_STATUS = { accept: 'VENDOR_ACCEPTED', reject: 'VENDOR_REJECTED' } as const;
// Rejection is terminal on the remote side and triggers a customer refund, so
// an AUTO_REJECTED order counts as already-rejected for convergence purposes.
const EQUIVALENT_REMOTE_STATUS: Record<string, readonly string[]> = {
  VENDOR_ACCEPTED: ['VENDOR_ACCEPTED'],
  VENDOR_REJECTED: ['VENDOR_REJECTED', 'AUTO_REJECTED'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireLinkedVendor(tenant: string) {
  const status = getCloudConnectionStatus(tenant);
  if (!status.connected) throw new Error('CLOUD_NOT_CONNECTED');
  if (!status.remoteVendorId) throw new Error('CLOUD_VENDOR_NOT_LINKED');
  return status.remoteVendorId;
}

function localProjection(tenant: string, externalOrderId: string): MarketplaceOrderProjectionRecord {
  const projection = store.getMarketplaceOrderProjection(tenant, 'MARKETPLACE', externalOrderId);
  if (!projection) throw new Error('CLOUD_ORDER_NOT_SYNCED');
  return projection;
}

/** Re-reads the remote order so a failed transition can be classified honestly. */
async function remoteStatusOf(tenant: string, externalOrderId: string, fetchImpl?: FetchLike): Promise<string> {
  const detail = await callConnectedCloudApi(tenant, `/vendor/orders/${encodeURIComponent(externalOrderId)}`, fetchImpl);
  const data = isRecord(detail) ? detail : {};
  const status = typeof data.status === 'string' ? data.status : '';
  if (!status) throw new Error('CLOUD_ORDER_STATUS_UNREADABLE');
  return status;
}

async function act(
  tenant: string,
  actor: string,
  externalOrderId: string,
  action: 'accept' | 'reject',
  reason: string | undefined,
  fetchImpl?: FetchLike,
): Promise<CloudOrderActionOutcome> {
  requireLinkedVendor(tenant);
  const projection = localProjection(tenant, externalOrderId);
  const target = TARGET_REMOTE_STATUS[action];

  // ── 1. Remote transition (the authority) ──────────────────
  let remoteStatus: string;
  let transition: CloudOrderActionOutcome['transition'] = 'applied';
  try {
    const result = await postConnectedCloudApi(
      tenant,
      `/vendor/orders/${encodeURIComponent(externalOrderId)}/${action}`,
      action === 'reject' ? { reason } : {},
      fetchImpl,
    );
    const data = isRecord(result) ? result : {};
    remoteStatus = typeof data.status === 'string' ? data.status : target;
  } catch (error) {
    // The backend guards both actions with a row lock + state machine and
    // answers INVALID_TRANSITION for anything it won't move. That single code
    // can still cover two different realities — an equivalent terminal state
    // (e.g. AUTO_REJECTED when this operator asked to reject) versus a state
    // incompatible with the request (the Vendor App rejected it while this
    // operator was accepting). Only re-reading the remote order can tell them
    // apart, so that is what happens here rather than guessing from the
    // message text.
    if (error instanceof CloudClientError && error.remoteCode === 'INVALID_TRANSITION') {
      const current = await remoteStatusOf(tenant, externalOrderId, fetchImpl);
      if (!(EQUIVALENT_REMOTE_STATUS[target] ?? [target]).includes(current)) {
        // Conflict: record the remote truth locally before surfacing it, so the
        // operator's next look at this order shows what actually happened
        // instead of the stale state they acted on.
        syncProjectionToRemote(tenant, actor, projection, current, action);
        throw new CloudOrderConflictError(action, current);
      }
      remoteStatus = current;
      transition = 'already_final';
    } else {
      // Any other failure (unreachable, timeout, auth, 404, permission) means
      // the transition did not happen. Local state is deliberately left
      // untouched — no optimistic "Accepted" that the marketplace never saw.
      throw error;
    }
  }

  // ── 2. Local projection now reflects a known remote fact ───
  const now = new Date().toISOString();
  const acceptedState: MarketplaceOrderState = action === 'accept' ? 'Accepted' : 'Rejected';
  const saved = store.saveMarketplaceOrderProjection({
    ...projection,
    state: acceptedState,
    sourceVersion: projection.sourceVersion + 1,
    notes: action === 'reject' && reason ? `${projection.notes}${projection.notes ? '\n' : ''}Rejected: ${reason}` : projection.notes,
    // 'Current', not 'PendingOutbound': the cloud already knows. That is the
    // whole point of doing this cloud-first.
    syncState: 'Current',
    updatedAt: now,
  });
  audit(tenant, actor, action === 'accept' ? 'marketplace:cloud-order-accepted' : 'marketplace:cloud-order-rejected', {
    entity: 'marketplace_order_projection',
    row_id: saved.id,
    after: { externalOrderId, remoteStatus, transition, reason: reason || undefined, state: saved.state },
  });

  if (action === 'reject') {
    return { externalOrderId, action, remoteStatus, transition, projectionState: saved.state, materialization: 'not_applicable', materializationReason: 'order was rejected; no local order is created' };
  }

  // ── 3. Bridge into a real local operational order, if possible yet ──
  return { externalOrderId, action, remoteStatus, transition, ...materializeAfterAccept(tenant, actor, externalOrderId, saved) };
}

/**
 * A freshly-pulled cloud order carries the customer's marketplace request
 * (`{name, qty}` item lines), not locally-resolvable garment/service ids, and
 * usually no committed delivery date — so `materializeMarketplaceOrder` will
 * refuse it. That refusal is correct and expected: the existing design
 * deliberately keeps such an order in the online queue until physical intake
 * supplies those facts.
 *
 * The accept itself has already succeeded remotely at this point, so a
 * refusal here must never be reported as a failed accept, and must never roll
 * the remote state back. The order is parked in 'IntakeRequired' with the real
 * reason attached.
 */
const DEFERRAL_BY_REASON: Record<string, CloudOrderActionOutcome['materialization']> = {
  // Not enough physical truth yet — resolved when the bags arrive and are counted.
  MARKETPLACE_INTAKE_ITEMS_INVALID: 'awaiting_intake',
  MARKETPLACE_DELIVERY_DATE_REQUIRED: 'awaiting_intake',
  // Waiting on the customer to accept a reassessment — nobody in the store can unblock it.
  CUSTOMER_APPROVAL_REQUIRED: 'awaiting_customer_approval',
  // A store-setup gap the owner must fix in settings before ANY order can be
  // invoiced. Surfaced distinctly because "go finish your tax profile" is a
  // completely different instruction from "wait for the bags".
  TAX_PROFILE_INCOMPLETE: 'blocked_by_setup',
  TAX_CLASSIFICATION_MISSING: 'blocked_by_setup',
};

function materializeAfterAccept(
  tenant: string,
  actor: string,
  externalOrderId: string,
  accepted: MarketplaceOrderProjectionRecord,
): Pick<CloudOrderActionOutcome, 'projectionState' | 'localOrderId' | 'materialization' | 'materializationReason'> {
  try {
    const result = materializeMarketplaceOrder(tenant, actor, externalOrderId);
    if (result.created) {
      return { projectionState: result.projection.state, localOrderId: result.localOrder?.id, materialization: 'created' };
    }
    if (result.reason === 'already_materialized') {
      return { projectionState: result.projection.state, localOrderId: result.localOrder?.id, materialization: 'already_materialized' };
    }
    // 'intake_required' — the marketplace request had no item lines at all.
    return { ...park(tenant, accepted, 'awaiting_intake'), materializationReason: 'marketplace request has no item lines' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const deferral = DEFERRAL_BY_REASON[message];
    // Anything not in the known-deferral set is a genuine defect and must not
    // be silently absorbed into a tidy-looking outcome.
    if (!deferral) throw error;
    return { ...park(tenant, accepted, deferral), materializationReason: message };
  }
}

/**
 * Parks an accepted-but-not-yet-materialized order in 'IntakeRequired' — the
 * existing state the online queue already uses for "accepted, waiting on the
 * physical side". The remote accept has already happened and is not undone.
 */
function park(tenant: string, accepted: MarketplaceOrderProjectionRecord, materialization: CloudOrderActionOutcome['materialization']) {
  const parked = store.saveMarketplaceOrderProjection({ ...accepted, state: 'IntakeRequired', updatedAt: new Date().toISOString() });
  return { projectionState: parked.state, localOrderId: parked.localOrderId, materialization };
}

function syncProjectionToRemote(
  tenant: string,
  actor: string,
  projection: MarketplaceOrderProjectionRecord,
  remoteStatus: string,
  attempted: 'accept' | 'reject',
) {
  let state: MarketplaceOrderState;
  try {
    state = mapRemoteOrderStatus(remoteStatus);
  } catch {
    return; // An unmappable remote status is not worth corrupting local state over.
  }
  const saved = store.saveMarketplaceOrderProjection({ ...projection, state, sourceVersion: projection.sourceVersion + 1, syncState: 'Current', updatedAt: new Date().toISOString() });
  audit(tenant, actor, 'marketplace:cloud-order-conflict', {
    entity: 'marketplace_order_projection',
    row_id: saved.id,
    after: { externalOrderId: projection.externalOrderId, attempted, remoteStatus, state },
  });
}

export async function acceptCloudOrder(tenant: string, actor: string, externalOrderId: string, fetchImpl?: FetchLike): Promise<CloudOrderActionOutcome> {
  return act(tenant, actor, externalOrderId, 'accept', undefined, fetchImpl);
}

export async function rejectCloudOrder(tenant: string, actor: string, externalOrderId: string, reason: string, fetchImpl?: FetchLike): Promise<CloudOrderActionOutcome> {
  const trimmed = String(reason || '').trim().slice(0, 500);
  // Rejecting queues a real customer refund on the backend — an operator
  // should never be able to trigger that without stating why.
  if (!trimmed) throw new Error('CLOUD_ORDER_REJECT_REASON_REQUIRED');
  return act(tenant, actor, externalOrderId, 'reject', trimmed, fetchImpl);
}
