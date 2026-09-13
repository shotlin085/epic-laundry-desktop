import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-marketplace-cloud-reconciliation-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
process.env.EPIC_MARKETPLACE_CLOUD_API_URL = 'https://fake-lndry-cloud.test/api/v1';

const TENANT = 'CLOUD-RECON-API';
const STORE = 'STORE-CLOUD-RECON';
const ORDER = 'order-recon-1';

let closeStore: (() => void) | undefined;
const originalFetch = globalThis.fetch;

type RemoteOrder = { id: string; order_number: string; status: string; processing_stage?: string | null };
type MockState = {
  remote: Map<string, RemoteOrder>;
  posts: Array<{ path: string; body: any }>;
  /** Amounts the backend computes from ITS OWN rates — never sent by the client. */
  previousPayablePaise: number;
  proposedPayablePaise: number;
  /** The marketplace's own reconciliation record, per order. */
  reconciliations: Map<string, { id: string; status: string; photos: string[]; reason?: string }>;
};

function buildMockFetch(state: MockState): typeof fetch {
  return (async (url: string, init: any = {}) => {
    const path = String(url).replace('https://fake-lndry-cloud.test/api/v1', '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (status: number, payload: unknown) => ({ status, json: async () => payload }) as any;

    if (path === '/auth/send-otp' && method === 'POST') return json(200, { success: true });
    if (path === '/auth/verify-otp' && method === 'POST') return json(200, { success: true, data: { accessToken: 'tok', refreshToken: 'ref' } });
    // connectCloudSession refreshes once immediately after verify-otp (the
    // real verify-otp token carries no shopRole claim — only refresh-token's
    // response does) — see cloud-session.ts's connect flow.
    if (path === '/auth/refresh-token' && method === 'POST') return json(200, { success: true, data: { access_token: 'tok', refresh_token: 'ref' } });
    if (path === '/auth/session' && method === 'GET') return json(200, { success: true, data: { user: { id: 'user-1', phone: '9999999999', name: 'Recon Vendor', role: 'VENDOR_OWNER' } } });
    if (path === '/vendor/profile' && method === 'GET') return json(200, { success: true, data: { id: 'vendor-recon-1', name: 'Recon Vendor' } });

    const stageMatch = path.match(/^\/vendor\/orders\/([^/]+)\/processing-stage$/);
    if (stageMatch && method === 'POST') {
      state.posts.push({ path, body });
      const order = state.remote.get(stageMatch[1])!;
      // Mirrors the real backend: RECEIVED_AT_VENDOR is its own status, while
      // the wash/dry/iron stages are stored as PROCESSING + processing_stage.
      if (body.status === 'RECEIVED_AT_VENDOR') { order.status = 'RECEIVED_AT_VENDOR'; order.processing_stage = null; }
      else if (body.status === 'PACKED') { order.status = 'PACKED'; order.processing_stage = 'Packed'; }
      else { order.status = 'PROCESSING'; order.processing_stage = body.status.charAt(0) + body.status.slice(1).toLowerCase(); }
      return json(200, { success: true, data: { orderId: order.id, status: order.status, processing_stage: order.processing_stage } });
    }

    const reconcileMatch = path.match(/^\/vendor\/orders\/([^/]+)\/reconcile$/);
    if (reconcileMatch && method === 'POST') {
      state.posts.push({ path, body });
      const order = state.remote.get(reconcileMatch[1])!;
      if (!Array.isArray(body.photo_urls) || !body.photo_urls.length) return json(400, { success: false, message: 'At least one photo_urls entry is required', code: 'VALIDATION_ERROR' });
      // The real endpoint only allows this from RECEIVED_AT_VENDOR or
      // RECONCILIATION_DISPUTED — before washing starts.
      if (!['RECEIVED_AT_VENDOR', 'RECONCILIATION_DISPUTED'].includes(order.status)) {
        return json(400, { success: false, message: 'Cannot propose a reconciliation at this order stage', code: 'INVALID_STAGE' });
      }
      order.status = 'RECONCILIATION_PENDING';
      state.reconciliations.set(order.id, { id: `recon-${order.id}`, status: 'PENDING_CUSTOMER', photos: body.photo_urls, reason: body.adjustment_reason });
      return json(200, { success: true, data: { orderId: order.id, status: 'RECONCILIATION_PENDING', reconciliation_id: `recon-${order.id}`, previous_payable_amount_paise: state.previousPayablePaise, proposed_payable_amount_paise: state.proposedPayablePaise } });
    }

    const detailMatch = path.match(/^\/vendor\/orders\/([^/?]+)$/);
    if (detailMatch && method === 'GET') {
      const order = state.remote.get(detailMatch[1]);
      if (!order) return json(404, { success: false, message: 'Order not found', code: 'ORDER_NOT_FOUND' });
      const recon = state.reconciliations.get(order.id);
      return json(200, { success: true, data: {
        ...order, estimated_amount_paise: 28000, payable_amount_paise: state.previousPayablePaise,
        // Real cross-context evidence, per Lndry_backend@29b8158 — a rider
        // pickup photo predating any reconciliation, plus whatever this
        // order's own reconciliation attached (kept in sync with `recon`).
        evidence: [
          { photo_url: 'https://cdn.test/pickup-1.jpg', context: 'RIDER_PICKUP', order_line_id: null, is_grouped: false, created_at: '2026-09-14T09:00:00Z', uploaded_by: 'rider-1', uploaded_by_name: 'Ravi Rider' },
          ...(recon ? recon.photos.map((url: string) => ({ photo_url: url, context: 'VENDOR_RECONCILIATION', order_line_id: null, is_grouped: true, created_at: '2026-09-14T11:00:00Z', uploaded_by: 'user-1', uploaded_by_name: null })) : []),
        ],
        timeline: [
          { old_status: 'WAITING_VENDOR_CONFIRMATION', new_status: 'VENDOR_ACCEPTED', actor_role: 'VENDOR_OWNER', note: 'Vendor accepted the order', timestamp: '2026-09-14T10:05:00Z' },
          { old_status: 'VENDOR_ACCEPTED', new_status: 'RECEIVED_AT_VENDOR', actor_role: 'VENDOR_OWNER', note: null, timestamp: '2026-09-14T11:00:00Z' },
        ],
        latestReconciliation: recon ? { id: recon.id, status: recon.status, reason: recon.reason, previous_payable_amount_paise: state.previousPayablePaise, proposed_payable_amount_paise: state.proposedPayablePaise, customer_decision_at: recon.status === 'PENDING_CUSTOMER' ? null : '2026-09-14T12:00:00Z', photos: recon.photos } : null,
        lines: [
          { id: 'line-1', garment_type_id: 'gt-shirt', garment_type_name: 'Shirt', garment_unit: 'PIECE', rate_paise: 6000, estimated_quantity: 3, confirmed_quantity: null },
          { id: 'line-2', garment_type_id: 'gt-wash', garment_type_name: 'Wash & fold', garment_unit: 'KG', rate_paise: 8000, estimated_quantity: 2, confirmed_quantity: null },
        ],
      } });
    }

    if (path.startsWith('/vendor/orders') && method === 'GET') {
      return json(200, { success: true, data: [...state.remote.values()].map((order) => ({
        ...order, user_id: 'cust-1', items: [{ name: 'Shirt', qty: 3 }], subtotal: '280.00', delivery_fee: '0.00',
        platform_fee: '0.00', tax_amount: '0.00', handling_fee: '0.00', total_amount: '280.00', payment_status: 'PAID',
        delivery_address: {}, vendor_slot_id: null, pickup_date: null, estimated_amount_paise: 28000,
        payable_amount_paise: state.previousPayablePaise, fee_breakdown: {}, created_at: '2026-09-14T10:00:00Z',
        updated_at: '2026-09-14T10:00:00Z', customer_name: 'Asha Rao', customer_phone: '9000000001',
      })) });
    }
    if (path === '/auth/logout' && method === 'POST') return json(200, { success: true });
    throw new Error(`unexpected mock fetch call: ${method} ${path}`);
  }) as unknown as typeof fetch;
}

try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { registerApi } = await import('./api.js');
  const { marketplaceOrderTruth } = await import('./modules/marketplace/order-truth.js');
  closeStore = () => store.close();
  const app = Fastify(); registerApi(app);
  const boot = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'recon-owner', password: 'StrongReconPassword!26', tenant: TENANT, storeId: STORE, businessName: 'Recon Laundry' } });
  assert.equal(boot.statusCode, 200);
  const headers = { cookie: String(boot.headers['set-cookie']).split(';')[0] };

  const state: MockState = {
    posts: [],
    previousPayablePaise: 28000,
    proposedPayablePaise: 34000,
    reconciliations: new Map(),
    remote: new Map([[ORDER, { id: ORDER, order_number: 'LND-RECON-1', status: 'VENDOR_ACCEPTED' }]]),
  };
  (globalThis as any).fetch = buildMockFetch(state);

  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/otp', headers, payload: { phone: '9999999999' } });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/connect', headers, payload: { phone: '9999999999', otp: '123456' } });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/sync-orders', headers });

  const truthOf = () => store.withStoreScope(TENANT, STORE, () => marketplaceOrderTruth(TENANT, ORDER));
  const projectionOf = () => store.withStoreScope(TENANT, STORE, () => store.getMarketplaceOrderProjection(TENANT, 'MARKETPLACE', ORDER));

  // ── The customer's original request is captured immutably at pull time ──
  const originalRequest = truthOf().request;
  assert.ok(originalRequest, 'pulling an order records the customer request as its own row');
  assert.equal(originalRequest!.data.immutable, true);
  const originalEstimateSnapshot = JSON.stringify(originalRequest!.data.estimate);

  // ── Detail sync brings the REAL order lines (with the ids reconcile needs) ──
  const detail = await app.inject({ method: 'POST', url: `/api/marketplace/cloud/orders/${ORDER}/detail-sync`, headers });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().detail.lines.length, 2);
  assert.equal(detail.json().detail.lines[0].orderLineId, 'line-1', 'the real remote order line id is what a recount must address');
  assert.equal(detail.json().detail.lines[0].garmentTypeId, 'gt-shirt');
  assert.equal(detail.json().detail.lines[1].unit, 'KG');

  // ── A recount before the order is received is refused with the reason ──
  const tooEarly = await app.inject({ method: 'POST', url: `/api/marketplace/cloud/orders/${ORDER}/reconcile`, headers, payload: { photoUrls: ['https://evidence.test/a.jpg'], lines: [{ orderLineId: 'line-1', confirmedQuantity: 4 }] } });
  assert.equal(tooEarly.statusCode, 409, 'the marketplace gates recounts by stage, and that is a precondition not a server fault');
  assert.equal(tooEarly.json().remoteCode, 'INVALID_STAGE');
  assert.match(tooEarly.json().hint, /marked received at the store/, 'the operator is told what to do about it');

  // ── Marking the order received on the marketplace ──
  const received = await app.inject({ method: 'POST', url: `/api/marketplace/cloud/orders/${ORDER}/stage`, headers, payload: { stage: 'RECEIVED_AT_VENDOR' } });
  assert.equal(received.statusCode, 200);
  assert.equal(received.json().remoteStatus, 'RECEIVED_AT_VENDOR');
  assert.equal(received.json().projectionState, 'IntakeRequired');

  // ── Evidence is mandatory, and Desktop refuses before wasting a round trip ──
  const postsBefore = state.posts.length;
  const noEvidence = await app.inject({ method: 'POST', url: `/api/marketplace/cloud/orders/${ORDER}/reconcile`, headers, payload: { photoUrls: [], lines: [{ orderLineId: 'line-1', confirmedQuantity: 4 }] } });
  assert.equal(noEvidence.statusCode, 400, 'the marketplace requires at least one photo and Desktop never submits an unevidenced recount');
  assert.equal(state.posts.length, postsBefore, 'the unevidenced attempt never reached the marketplace');

  const nothingToChange = await app.inject({ method: 'POST', url: `/api/marketplace/cloud/orders/${ORDER}/reconcile`, headers, payload: { photoUrls: ['https://evidence.test/a.jpg'] } });
  assert.equal(nothingToChange.statusCode, 400);
  assert.equal(nothingToChange.json().code, 'CLOUD_RECONCILIATION_EMPTY');

  // ── The real recount ──────────────────────────────────────
  const reconcile = await app.inject({ method: 'POST', url: `/api/marketplace/cloud/orders/${ORDER}/reconcile`, headers, payload: {
    photoUrls: ['https://evidence.test/counted-1.jpg', 'https://evidence.test/counted-2.jpg'],
    lines: [{ orderLineId: 'line-1', confirmedQuantity: 5 }],
    confirmedWeightKg: 2.6,
    newLines: [{ garmentTypeId: 'gt-curtain', quantity: 1 }],
    reason: 'Counted two extra shirts and one curtain that was inside the bag',
  } });
  assert.equal(reconcile.statusCode, 200);
  const outcome = reconcile.json();
  assert.equal(outcome.remoteStatus, 'RECONCILIATION_PENDING');
  assert.equal(outcome.reconciliationId, `recon-${ORDER}`);
  assert.equal(outcome.previousPayableAmountPaise, 28000);
  assert.equal(outcome.proposedPayableAmountPaise, 34000, 'the amounts come from the marketplace, which prices it from the vendor\'s own approved rates');
  assert.equal(outcome.deltaPaise, 6000);
  assert.equal(outcome.projectionState, 'CustomerApprovalRequired', 'the order now waits on the customer, not on the store');

  // The request body actually sent must use the marketplace's field names.
  // findLast, not find: an earlier attempt in this test was deliberately rejected for stage.
  const sent = state.posts.filter((entry) => entry.path.endsWith('/reconcile')).at(-1)!.body;
  assert.deepEqual(sent.lines, [{ order_line_id: 'line-1', confirmed_quantity: 5 }]);
  assert.deepEqual(sent.new_lines, [{ garment_type_id: 'gt-curtain', quantity: 1 }]);
  assert.equal(sent.confirmed_weight_kg, 2.6);
  assert.equal(sent.photo_urls.length, 2);
  assert.ok(!('rate_paise' in sent), 'Desktop never sends a price — the marketplace prices the recount itself');

  // ── THE INVARIANT: the original request is untouched ──────
  const truth = truthOf();
  assert.equal(JSON.stringify(truth.request!.data.estimate), originalEstimateSnapshot, 'the customer\'s original request is byte-identical after a recount');
  assert.ok(truth.intake, 'what was physically counted is recorded as its own row');
  assert.equal((truth.intake!.data.actual as any).confirmedWeightKg, 2.6);
  assert.equal((truth.intake!.data.actual as any).photoUrls.length, 2, 'the evidence is retained with the intake, not just posted and forgotten');
  assert.equal(JSON.stringify(truth.intake!.data.originalEstimate), originalEstimateSnapshot, 'the intake carries the original alongside the actual, so the difference stays explainable');

  // ── The customer's decision is the customer's to make ─────
  assert.equal(truth.reassessments.length, 1);
  const reassessment = truth.reassessments[0];
  assert.equal(reassessment.data.state, 'PendingApproval', 'Desktop never approves a price change on the customer\'s behalf');
  assert.equal(reassessment.data.previousAmountPaise, 28000);
  assert.equal(reassessment.data.revisedAmountPaise, 34000);
  assert.equal(reassessment.data.deltaPaise, 6000);
  assert.equal(reassessment.data.tolerancePaise, 0, 'no tolerance band can silently auto-approve part of a marketplace price change');
  assert.equal(reassessment.id, outcome.reassessmentId);

  // ── The customer's decision comes back from the marketplace ──
  // While the marketplace still says PENDING_CUSTOMER, re-reading the order
  // must NOT nudge the local decision one way or the other.
  const stillPending = await app.inject({ method: 'POST', url: `/api/marketplace/cloud/orders/${ORDER}/detail-sync`, headers });
  assert.equal(stillPending.statusCode, 200);
  assert.equal(stillPending.json().customerDecision, undefined, 'a pending recount stays pending — Desktop never advances it on its own');
  assert.equal(truthOf().reassessments[0].data.state, 'PendingApproval');
  assert.equal(stillPending.json().detail.latestReconciliation.status, 'PENDING_CUSTOMER');
  assert.equal(stillPending.json().detail.latestReconciliation.photos.length, 2, 'the evidence attached to the recount is readable back');
  assert.equal(stillPending.json().detail.timeline.length, 2, "the marketplace's own status history comes back, including actors other than this store");
  assert.equal(stillPending.json().detail.timeline[0].actorRole, 'VENDOR_OWNER');
  // ── Evidence: cross-context history, distinct from the reconciliation-scoped field ──
  const evidenceDetail = stillPending.json().detail;
  assert.equal(evidenceDetail.evidence.length, 3, "the full history includes the rider pickup photo AND both photos attached to this recount");
  assert.equal(evidenceDetail.evidence[0].context, 'RIDER_PICKUP');
  assert.equal(evidenceDetail.evidence[0].uploadedByName, 'Ravi Rider', "the uploading actor's name is carried through");
  assert.ok(evidenceDetail.evidence.some((e: any) => e.context === 'VENDOR_RECONCILIATION'), "the recount's own evidence appears in the full history too");
  assert.equal(evidenceDetail.latestReconciliation.photos.length, 2, "the reconciliation-scoped field stays scoped to just this recount, not the rider pickup photo");


  // The customer accepts on the marketplace, exactly as their app would.
  state.reconciliations.get(ORDER)!.status = 'ACCEPTED';
  state.remote.get(ORDER)!.status = 'PROCESSING';
  const accepted = await app.inject({ method: 'POST', url: `/api/marketplace/cloud/orders/${ORDER}/detail-sync`, headers });
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(
    { decision: accepted.json().customerDecision.decision, remoteStatus: accepted.json().customerDecision.remoteStatus },
    { decision: 'approve', remoteStatus: 'ACCEPTED' },
    "the marketplace's own record of the customer decision is what resolves the local reassessment",
  );
  assert.equal(truthOf().reassessments[0].data.state, 'Approved');
  assert.equal(truthOf().reassessments[0].data.decidedBy, 'marketplace:customer', 'the customer is recorded as the decider, not the operator whose sync observed it');
  assert.equal(accepted.json().projectionState, 'Processing');

  // Re-reading again must not double-decide or throw.
  const reRead = await app.inject({ method: 'POST', url: `/api/marketplace/cloud/orders/${ORDER}/detail-sync`, headers });
  assert.equal(reRead.statusCode, 200);
  assert.equal(reRead.json().customerDecision, undefined, 'an already-decided reassessment is not decided a second time');
  assert.equal(truthOf().reassessments[0].data.state, 'Approved');

  // ── And a rejection is carried across just as faithfully ──
  state.remote.set('order-recon-3', { id: 'order-recon-3', order_number: 'LND-RECON-3', status: 'RECEIVED_AT_VENDOR' });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/sync-orders', headers });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-recon-3/reconcile', headers, payload: { photoUrls: ['https://evidence.test/r3.jpg'], lines: [{ orderLineId: 'line-1', confirmedQuantity: 9 }], reason: 'Counted nine' } });
  state.reconciliations.get('order-recon-3')!.status = 'REJECTED';
  state.remote.get('order-recon-3')!.status = 'RECONCILIATION_DISPUTED';
  const rejectedSync = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-recon-3/detail-sync', headers });
  assert.equal(rejectedSync.json().customerDecision.decision, 'reject');
  const rejectedTruth = store.withStoreScope(TENANT, STORE, () => marketplaceOrderTruth(TENANT, 'order-recon-3'));
  assert.equal(rejectedTruth.reassessments[0].data.state, 'Rejected', 'a customer rejection is recorded as a rejection, not quietly dropped');
  assert.equal(rejectedSync.json().projectionState, 'CustomerApprovalRequired', 'a disputed recount still needs someone to act');

  // ── A recount that changes nothing must not invent a decision ──
  state.remote.set('order-recon-2', { id: 'order-recon-2', order_number: 'LND-RECON-2', status: 'RECEIVED_AT_VENDOR' });
  state.proposedPayablePaise = state.previousPayablePaise;
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/sync-orders', headers });
  const noDelta = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-recon-2/reconcile', headers, payload: { photoUrls: ['https://evidence.test/same.jpg'], lines: [{ orderLineId: 'line-1', confirmedQuantity: 3 }], reason: 'Count confirmed as ordered' } });
  assert.equal(noDelta.statusCode, 200);
  assert.equal(noDelta.json().deltaPaise, 0);
  assert.equal(noDelta.json().reassessmentId, undefined, 'a recount with no price change creates nothing for the customer to approve');
  const noDeltaTruth = store.withStoreScope(TENANT, STORE, () => marketplaceOrderTruth(TENANT, 'order-recon-2'));
  assert.equal(noDeltaTruth.reassessments.length, 0, 'and records no locally-approved reassessment the marketplace never granted');
  assert.ok(noDeltaTruth.intake, 'but the physical count is still recorded');

  // ── Stage progression keeps reporting outward ─────────────
  const washing = await app.inject({ method: 'POST', url: `/api/marketplace/cloud/orders/order-recon-2/stage`, headers, payload: { stage: 'WASHING' } });
  assert.equal(washing.statusCode, 200);
  assert.equal(washing.json().remoteStatus, 'PROCESSING', 'wash/dry/iron are stored by the marketplace as PROCESSING plus a stage');
  assert.equal(washing.json().projectionState, 'Processing');
  const packed = await app.inject({ method: 'POST', url: `/api/marketplace/cloud/orders/order-recon-2/stage`, headers, payload: { stage: 'PACKED', deliverySlotLabel: 'Tomorrow 9-11am' } });
  assert.equal(packed.json().projectionState, 'Ready');
  assert.equal(state.posts.at(-1)!.body.delivery_slot_label, 'Tomorrow 9-11am', 'the dispatch slot reaches the marketplace only on PACKED');

  console.log('PASS marketplace cloud reconciliation: immutable original request, real remote line ids, stage gating with an actionable reason, mandatory evidence, marketplace-priced amounts, no locally-invented customer approval, customer decision read back from the marketplace record, recount evidence and remote timeline, and outward stage progression self-test complete');
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.EPIC_MARKETPLACE_CLOUD_API_URL;
  try { closeStore?.(); } catch { /* already closed */ }
  rmSync(tempDir, { recursive: true, force: true });
}
