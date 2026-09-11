import { store, type MarketplaceOrderProjectionRecord, type MarketplaceOrderState } from '../../kernel/store.js';
import { audit } from '../../kernel/audit.js';
import { CloudClientError } from './cloud-client.js';
import { callConnectedCloudApi, getCloudConnectionStatus, postConnectedCloudApi } from './cloud-session.js';
import { mapRemoteOrderStatus } from './cloud-order-sync.js';
import { createMarketplaceReassessment, recordMarketplaceIntake } from './order-truth.js';
import type { FetchLike } from './cloud-client.js';

/**
 * Moving a marketplace order through its physical stages, and proposing a
 * recount to the customer — both against the real backend as the authority.
 *
 * The reconciliation model here is deliberately NOT "edit the order". The
 * customer's original request is an immutable row recorded at pull time
 * (cloud-order-sync.ts); what is physically counted is a separate intake row;
 * what the price should become is a separate reassessment row carrying the
 * backend's own computed amounts. Nothing overwrites what the customer asked
 * for, which is what makes the difference explainable afterwards.
 */

export type CloudOrderLine = {
  orderLineId: string;
  garmentTypeId?: string;
  name: string;
  unit: string;
  ratePaise?: number;
  estimatedQuantity?: number;
  confirmedQuantity?: number;
};

export type CloudOrderDetail = {
  externalOrderId: string;
  remoteStatus: string;
  orderNumber: string;
  lines: CloudOrderLine[];
  estimatedAmountPaise?: number;
  payableAmountPaise?: number;
  processingStage?: string;
};

/** The stages the real backend's processing-stage endpoint accepts. */
export const CLOUD_ORDER_STAGES = ['RECEIVED_AT_VENDOR', 'WASHING', 'DRYING', 'IRONING', 'PACKED'] as const;
export type CloudOrderStage = (typeof CLOUD_ORDER_STAGES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requireLinkedVendor(tenant: string) {
  const status = getCloudConnectionStatus(tenant);
  if (!status.connected) throw new Error('CLOUD_NOT_CONNECTED');
  if (!status.remoteVendorId) throw new Error('CLOUD_VENDOR_NOT_LINKED');
}

function projectionOf(tenant: string, externalOrderId: string): MarketplaceOrderProjectionRecord {
  const projection = store.getMarketplaceOrderProjection(tenant, 'MARKETPLACE', externalOrderId);
  if (!projection) throw new Error('CLOUD_ORDER_NOT_SYNCED');
  return projection;
}

/** Reflects an authoritative remote status onto the local projection. */
function applyRemoteStatus(tenant: string, projection: MarketplaceOrderProjectionRecord, remoteStatus: string, extraRequest?: Record<string, unknown>) {
  let state: MarketplaceOrderState = projection.state;
  try {
    state = mapRemoteOrderStatus(remoteStatus);
  } catch {
    // An unmapped remote status is not worth corrupting local state over; the
    // raw value is still kept in `request.remoteStatus` for support.
  }
  return store.saveMarketplaceOrderProjection({
    ...projection,
    state,
    sourceVersion: projection.sourceVersion + 1,
    request: { ...projection.request, ...(extraRequest || {}), remoteStatus },
    syncState: 'Current',
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Reads one order's full detail from the marketplace. The list endpoint only
 * carries an `items` blob; this is the only place the REAL order lines — with
 * the ids the reconcile endpoint requires — come from.
 */
export async function fetchCloudOrderDetail(tenant: string, externalOrderId: string, fetchImpl?: FetchLike): Promise<CloudOrderDetail> {
  requireLinkedVendor(tenant);
  const raw = await callConnectedCloudApi(tenant, `/vendor/orders/${encodeURIComponent(externalOrderId)}`, fetchImpl);
  if (!isRecord(raw)) throw new Error('CLOUD_ORDER_DETAIL_UNEXPECTED_RESPONSE');
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  return {
    externalOrderId,
    remoteStatus: typeof raw.status === 'string' ? raw.status : '',
    orderNumber: typeof raw.order_number === 'string' ? raw.order_number : '',
    processingStage: typeof raw.processing_stage === 'string' ? raw.processing_stage : undefined,
    estimatedAmountPaise: num(raw.estimated_amount_paise),
    payableAmountPaise: num(raw.payable_amount_paise),
    lines: rawLines.filter(isRecord).map((line) => ({
      orderLineId: String(line.id || ''),
      garmentTypeId: line.garment_type_id ? String(line.garment_type_id) : undefined,
      name: String(line.garment_type_name || line.name || ''),
      unit: String(line.garment_unit || line.unit || ''),
      ratePaise: num(line.rate_paise),
      estimatedQuantity: num(line.estimated_quantity),
      confirmedQuantity: num(line.confirmed_quantity),
    })).filter((line) => line.orderLineId),
  };
}

/**
 * Pulls one order's detail and stores its real lines on the projection, so the
 * operator sees the customer's actual requested lines (and so a reconciliation
 * can address them by their real ids).
 */
export async function syncCloudOrderDetail(tenant: string, actor: string, externalOrderId: string, fetchImpl?: FetchLike) {
  const projection = projectionOf(tenant, externalOrderId);
  const detail = await fetchCloudOrderDetail(tenant, externalOrderId, fetchImpl);
  const saved = applyRemoteStatus(tenant, projection, detail.remoteStatus, {
    lines: detail.lines,
    processingStage: detail.processingStage ?? null,
    estimatedAmountPaise: detail.estimatedAmountPaise ?? null,
    payableAmountPaise: detail.payableAmountPaise ?? null,
  });
  audit(tenant, actor, 'marketplace:cloud-order-detail-synced', { entity: 'marketplace_order_projection', row_id: saved.id, after: { externalOrderId, remoteStatus: detail.remoteStatus, lineCount: detail.lines.length } });
  return { detail, projectionState: saved.state };
}

export type CloudStageOutcome = { externalOrderId: string; stage: CloudOrderStage; remoteStatus: string; projectionState: MarketplaceOrderState };

/**
 * Moves the order's physical stage on the marketplace, which is what makes the
 * customer-visible progress change. Local production tracking stays where it
 * is — this only reports outward.
 */
export async function advanceCloudOrderStage(
  tenant: string,
  actor: string,
  externalOrderId: string,
  stage: CloudOrderStage,
  options: { deliverySlotLabel?: string; deliverySlotAt?: string } = {},
  fetchImpl?: FetchLike,
): Promise<CloudStageOutcome> {
  requireLinkedVendor(tenant);
  if (!CLOUD_ORDER_STAGES.includes(stage)) throw new Error('CLOUD_ORDER_STAGE_INVALID');
  const projection = projectionOf(tenant, externalOrderId);

  const body: Record<string, unknown> = { status: stage };
  // Only meaningful on PACKED — the vendor's chosen dispatch time for the
  // delivery leg. Sending it on other stages would be noise the backend ignores.
  if (stage === 'PACKED' && options.deliverySlotLabel) body.delivery_slot_label = options.deliverySlotLabel;
  if (stage === 'PACKED' && options.deliverySlotAt) body.delivery_slot_at = options.deliverySlotAt;

  const result = await postConnectedCloudApi(tenant, `/vendor/orders/${encodeURIComponent(externalOrderId)}/processing-stage`, body, fetchImpl);
  const data = isRecord(result) ? result : {};
  const remoteStatus = typeof data.status === 'string' ? data.status : stage;
  const saved = applyRemoteStatus(tenant, projection, remoteStatus, { processingStage: typeof data.processing_stage === 'string' ? data.processing_stage : stage });
  audit(tenant, actor, 'marketplace:cloud-order-stage-advanced', { entity: 'marketplace_order_projection', row_id: saved.id, after: { externalOrderId, stage, remoteStatus } });
  return { externalOrderId, stage, remoteStatus, projectionState: saved.state };
}

export type ReconciliationInput = {
  /** Adjustments to lines the customer already ordered, addressed by their real remote ids. */
  lines?: Array<{ orderLineId: string; confirmedQuantity?: number; newGarmentTypeId?: string }>;
  /** Exact weight/area for a continuous-unit line. */
  confirmedWeightKg?: number;
  /** Services that were not on the order at all. */
  newLines?: Array<{ garmentTypeId: string; quantity: number }>;
  reason?: string;
  /**
   * Evidence for the recount. The marketplace requires at least one, and
   * Desktop never invents them: they are either photos an operator supplied,
   * or URLs of evidence already attached to the order upstream (e.g. the
   * rider's pickup photos).
   */
  photoUrls: string[];
};

export type ReconciliationOutcome = {
  externalOrderId: string;
  reconciliationId?: string;
  remoteStatus: string;
  previousPayableAmountPaise?: number;
  proposedPayableAmountPaise?: number;
  deltaPaise?: number;
  projectionState: MarketplaceOrderState;
  /** Set when the price actually changed and the customer therefore has something to decide. */
  reassessmentId?: string;
};

/**
 * Proposes a recount to the customer through the marketplace.
 *
 * The backend prices this itself from THIS vendor's own approved rates — a
 * client-supplied rate is never trusted — so the amounts recorded locally are
 * the ones the customer will actually be asked to approve, not a local guess.
 */
export async function proposeCloudReconciliation(
  tenant: string,
  actor: string,
  externalOrderId: string,
  input: ReconciliationInput,
  fetchImpl?: FetchLike,
): Promise<ReconciliationOutcome> {
  requireLinkedVendor(tenant);
  const projection = projectionOf(tenant, externalOrderId);

  const photoUrls = (input.photoUrls || []).map((value) => String(value || '').trim()).filter(Boolean);
  // Checked here as well as by the backend so an operator is told what is
  // missing before a pointless round trip — and so Desktop can never be the
  // thing that submits an unevidenced recount.
  if (!photoUrls.length) throw new Error('CLOUD_RECONCILIATION_EVIDENCE_REQUIRED');

  const lines = (input.lines || []).filter((line) => line && line.orderLineId);
  const newLines = (input.newLines || []).filter((line) => line && line.garmentTypeId && Number(line.quantity) > 0);
  if (!lines.length && !newLines.length && input.confirmedWeightKg === undefined) throw new Error('CLOUD_RECONCILIATION_EMPTY');

  const body: Record<string, unknown> = { photo_urls: photoUrls };
  if (lines.length) {
    body.lines = lines.map((line) => ({
      order_line_id: line.orderLineId,
      ...(line.confirmedQuantity === undefined ? {} : { confirmed_quantity: line.confirmedQuantity }),
      ...(line.newGarmentTypeId ? { new_garment_type_id: line.newGarmentTypeId } : {}),
    }));
  }
  if (input.confirmedWeightKg !== undefined) body.confirmed_weight_kg = input.confirmedWeightKg;
  if (newLines.length) body.new_lines = newLines.map((line) => ({ garment_type_id: line.garmentTypeId, quantity: line.quantity }));
  if (input.reason) body.adjustment_reason = String(input.reason).slice(0, 500);

  const result = await postConnectedCloudApi(tenant, `/vendor/orders/${encodeURIComponent(externalOrderId)}/reconcile`, body, fetchImpl);
  const data = isRecord(result) ? result : {};
  const remoteStatus = typeof data.status === 'string' ? data.status : 'RECONCILIATION_PENDING';
  const previousPayableAmountPaise = num(data.previous_payable_amount_paise);
  const proposedPayableAmountPaise = num(data.proposed_payable_amount_paise);
  const reconciliationId = data.reconciliation_id ? String(data.reconciliation_id) : undefined;

  // What was physically counted, recorded against — never into — the original
  // request. Idempotent: a repeated proposal reuses the existing intake row.
  const intakeActual: Record<string, unknown> = { lines, newLines, confirmedWeightKg: input.confirmedWeightKg ?? null, photoUrls, reconciliationId, proposedPayableAmountPaise: proposedPayableAmountPaise ?? null };
  recordMarketplaceIntake(tenant, actor, { externalOrderId, actual: intakeActual, reason: input.reason || 'Marketplace recount proposed from the store' });

  // Only record a reassessment when the price actually moved. With no delta
  // there is nothing for the customer to weigh up, and creating a row here
  // would auto-mark it 'Approved' locally while the marketplace still has the
  // order awaiting the customer — a state Desktop has no right to claim.
  const deltaPaise = previousPayableAmountPaise !== undefined && proposedPayableAmountPaise !== undefined
    ? proposedPayableAmountPaise - previousPayableAmountPaise
    : undefined;
  let reassessmentId: string | undefined;
  if (deltaPaise !== undefined && deltaPaise !== 0) {
    const reassessment = createMarketplaceReassessment(tenant, actor, {
      externalOrderId,
      previousAmountPaise: previousPayableAmountPaise!,
      revisedAmountPaise: proposedPayableAmountPaise!,
      reason: input.reason || 'Recount after physical intake',
      // Zero tolerance: the customer decides on the marketplace, so Desktop
      // must not silently approve any part of a price change on their behalf.
      tolerancePaise: 0,
    });
    reassessmentId = reassessment.id;
  }

  const saved = applyRemoteStatus(tenant, projection, remoteStatus, { reconciliationId: reconciliationId ?? null, proposedPayableAmountPaise: proposedPayableAmountPaise ?? null });
  audit(tenant, actor, 'marketplace:cloud-reconciliation-proposed', {
    entity: 'marketplace_order_projection',
    row_id: saved.id,
    after: { externalOrderId, reconciliationId, remoteStatus, previousPayableAmountPaise, proposedPayableAmountPaise, deltaPaise, evidenceCount: photoUrls.length },
  });

  return { externalOrderId, reconciliationId, remoteStatus, previousPayableAmountPaise, proposedPayableAmountPaise, deltaPaise, projectionState: saved.state, reassessmentId };
}

/** Maps this module's failures onto the reason an operator actually needs. */
export function cloudProgressErrorHint(error: unknown): string | undefined {
  if (error instanceof CloudClientError && error.remoteCode === 'INVALID_STAGE') {
    return 'The marketplace only accepts a recount once the order is marked received at the store, and before washing starts.';
  }
  if (error instanceof CloudClientError && error.remoteCode === 'INVALID_TRANSITION') {
    return 'The marketplace will not move the order to that stage from its current one.';
  }
  return undefined;
}
