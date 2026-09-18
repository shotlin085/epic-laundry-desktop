import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, Camera, Check, ChevronRight, CircleOff, ClipboardCheck, Cloud, ExternalLink, History, Inbox, Layers, MapPin, PackageCheck, Phone, RefreshCw, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, Truck, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, apiGet, apiPost, operatorErrorMessage } from '@/lib/api'
import { cn, formatINR } from '@/lib/utils'
import { canUseUi } from '@/components/laundry/LaundryShell'
import VisualEmptyState from '@/components/laundry/VisualEmptyState'

type OnlineOrder = { id: string; externalOrderId: string; orderNumber: string; channel: string; state: string; sourceVersion: number; customer: Record<string, unknown>; pickup: Record<string, unknown>; request: Record<string, unknown>; paymentState: string; acceptanceDeadline?: string; preferences: string; notes: string; syncState: string; localOrderId?: string; updatedAt: string }
type QueuePage = { items: OnlineOrder[]; nextCursor?: string }
type SyncStatus = { configured: boolean; version: number; device: { id: string; vendorId: string; storeId: string; station: string; status: string; rotationRequired: boolean } | null; checkpoint: { lastPullAt?: string; lastPushAt?: string; lastHeartbeatAt?: string; serverTimeOffsetMs?: number; error?: string } | null; outbox: { pending: number; inFlight: number; retry: number; deadLetter: number }; inbox: { held: number; failed: number }; onlineOrders: number }
type Truth = { request?: { data?: { estimate?: Record<string, unknown>; customer?: Record<string, unknown> } }; intake?: { data?: { actual?: Record<string, unknown>; reason?: string; assessedAt?: string } }; reassessments: Array<{ id: string; data: { state: string; previousAmountPaise: number; revisedAmountPaise: number; deltaPaise: number; reason: string; decidedAt?: string } }> }
type CustomerStatus = { status: string; label: string; timeline: Array<{ eventId: string; at: string; status: string; label: string; source: string }>; evidence: { projectionVersion?: number; localOrderId?: string; reassessmentId?: string; timelineDerivedFromEvents: boolean } }
type PickupTask = { id: string; state: 'Requested' | 'Scheduled' | 'Assigned' | 'Collected' | 'Failed' | 'Cancelled'; scheduledDate?: string; window?: string; riderId?: string; serviceZone?: string; address: string; updatedAt: string }
type LocalOrderDetail = { state: string; orderNumber: string; itemCount: number; grandTotal: number; paymentStatus?: string; physicalUnits?: Array<{ state: string; activeTagCode?: string }>; containers?: Array<{ state: string; tagCode?: string }> }
type Catalogue = { garments: Array<{ id: string; name: string; unit?: string }>; services: Array<{ id: string; name: string; units?: string[] }> }
type IntakeLine = { garmentId: string; serviceId: string; qty: number }

const states = [
  { key: 'all', label: 'All orders' },
  { key: 'AwaitingAcceptance', label: 'Needs acceptance' },
  { key: 'IntakeRequired', label: 'Intake pending' },
  { key: 'CustomerApprovalRequired', label: 'Approval required' },
  { key: 'active', label: 'In progress' },
] as const

const stateTone = (state: string) => state === 'AwaitingAcceptance' ? 'bg-[#fff2d7] text-[#8b5c1b]' : state === 'Accepted' || state === 'Processing' ? 'bg-[#e7f4ef] text-[#2e6a60]' : state === 'CustomerApprovalRequired' ? 'bg-[#f1eaff] text-[#6844a6]' : state === 'Rejected' || state === 'Cancelled' ? 'bg-[#fde9e6] text-[#a44036]' : 'bg-[#edf1f0] text-[#53676a]'
const stateLabel = (state: string) => ({ AwaitingAcceptance: 'Awaiting acceptance', IntakeRequired: 'Intake required', CustomerApprovalRequired: 'Approval required', PickupScheduled: 'Pickup scheduled', DeliveryScheduled: 'Delivery scheduled', Completed: 'Completed', Rejected: 'Rejected', Cancelled: 'Cancelled' } as Record<string, string>)[state] || state
const channelLabel = (channel: string) => channel.replace(/_/g, ' ')
const text = (value: unknown, fallback = '') => String(value ?? fallback).trim()
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not scheduled'
const timeLabel = (value?: string) => value ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'

type CloudStatus = { configured: boolean; connected: boolean; remoteVendorName?: string; remoteVendorId?: string; remoteUserRole?: string; phone?: string; connectedAt?: string }
type CloudActionOutcome = { action: 'accept' | 'reject'; remoteStatus: string; transition: 'applied' | 'already_final'; materialization: string; materializationReason?: string; localOrderId?: string }

// Mirrors cloud-order-progress.ts's real response shapes exactly — these are
// only ever populated from a real /detail-sync call against the marketplace,
// never guessed locally.
type CloudOrderLine = { orderLineId: string; garmentTypeId?: string; name: string; unit: string; ratePaise?: number; estimatedQuantity?: number; confirmedQuantity?: number }
type CloudReconciliationRecord = { id: string; status: string; reason?: string; previousPayableAmountPaise?: number; proposedPayableAmountPaise?: number; customerDecisionAt?: string; photos: string[] }
type CloudTimelineEntry = { at: string; oldStatus?: string; newStatus: string; actorRole?: string; note?: string }
type CloudEvidenceRecord = { url: string; context: 'RIDER_PICKUP' | 'VENDOR_RECONCILIATION' | 'DELIVERY_PROOF' | string; orderLineId?: string; isGrouped: boolean; uploadedByName?: string; createdAt: string }
type CloudOrderDetail = { externalOrderId: string; remoteStatus: string; orderNumber: string; lines: CloudOrderLine[]; estimatedAmountPaise?: number; payableAmountPaise?: number; processingStage?: string; latestReconciliation?: CloudReconciliationRecord; timeline: CloudTimelineEntry[]; evidence: CloudEvidenceRecord[] }
type CloudDetailSyncResult = { detail: CloudOrderDetail; projectionState: string; customerDecision?: { reassessmentId: string; decision: 'approve' | 'reject'; remoteStatus: string } }
type CloudStageOutcome = { externalOrderId: string; stage: string; remoteStatus: string; projectionState: string }
type CloudReconciliationOutcome = { externalOrderId: string; reconciliationId?: string; remoteStatus: string; previousPayableAmountPaise?: number; proposedPayableAmountPaise?: number; deltaPaise?: number; projectionState: string; reassessmentId?: string }

const EVIDENCE_CONTEXT_LABEL: Record<string, string> = { RIDER_PICKUP: 'Captain pickup', VENDOR_RECONCILIATION: 'Recount evidence', DELIVERY_PROOF: 'Delivery proof' }
const REMOTE_STAGE_LABEL: Record<string, string> = {
  WAITING_VENDOR_CONFIRMATION: 'Awaiting your acceptance', VENDOR_ACCEPTED: 'Accepted, awaiting pickup', PICKUP_ASSIGNED: 'Pickup assigned', GOING_FOR_PICKUP: 'Captain on the way', PICKUP_OTP_VERIFIED: 'Pickup OTP verified', PICKED_UP: 'Picked up, in transit',
  RECEIVED_AT_VENDOR: 'Received at your store', RECONCILIATION_PENDING: 'Recount awaiting customer', RECONCILIATION_DISPUTED: 'Customer disputed the recount',
  PROCESSING: 'Processing', PACKED: 'Packed, ready for dispatch', DELIVERY_ASSIGNED: 'Delivery assigned', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERY_OTP_VERIFIED: 'Delivery OTP verified', DELIVERED: 'Delivered',
  VENDOR_REJECTED: 'Rejected', AUTO_REJECTED: 'Auto-rejected', CUSTOMER_CANCELLED: 'Cancelled by customer', ADMIN_CANCELLED: 'Cancelled by platform', REFUNDED: 'Refunded',
}
// The real backend's processing-stage endpoint accepts RECEIVED_AT_VENDOR as a
// target regardless of exactly which pre-receipt status the order is in — it
// is the store's own "the bags physically arrived" declaration, not something
// a rider's own status update produces automatically.
const PRE_RECEIPT_REMOTE_STATUSES = ['VENDOR_ACCEPTED', 'PICKUP_ASSIGNED', 'GOING_FOR_PICKUP', 'PICKUP_OTP_VERIFIED', 'PICKED_UP']
const RECEIVED_REMOTE_STATUSES = ['RECEIVED_AT_VENDOR', 'RECONCILIATION_DISPUTED', 'PROCESSING']
// Narrower than RECEIVED_REMOTE_STATUSES: the real backend only accepts a
// reconcile proposal from these two statuses — PROCESSING (washing has
// already started) is deliberately excluded, matching the real INVALID_STAGE
// gate this UI has already seen live.
const RECONCILE_ELIGIBLE_REMOTE_STATUSES = ['RECEIVED_AT_VENDOR', 'RECONCILIATION_DISPUTED']
const RECONCILIATION_STATUS_TONE: Record<string, string> = { PENDING_CUSTOMER: 'bg-[#fff2d7] text-[#8b5c1b]', ACCEPTED: 'bg-[#e7f4ef] text-[#2e6a60]', APPLIED: 'bg-[#e7f4ef] text-[#2e6a60]', REJECTED: 'bg-[#fde9e6] text-[#a44036]' }

type CloudDetailPanelProps = {
  detail?: CloudOrderDetail
  pending: boolean
  syncing: boolean
  syncFailed: boolean
  onSync: () => void
  onAdvanceStage: (stage: string, packedDelivery?: { deliverySlotLabel?: string; deliverySlotAt?: string }) => void
  onReconcile: () => void
  reconLineId: string; setReconLineId: (value: string) => void
  reconQty: string; setReconQty: (value: string) => void
  reconPhotoUrls: string; setReconPhotoUrls: (value: string) => void
  reconReason: string; setReconReason: (value: string) => void
  packedSlotLabel: string; setPackedSlotLabel: (value: string) => void
  packedSlotAt: string; setPackedSlotAt: (value: string) => void
}


/**
 * Turns a cloud action result into a sentence that says what actually happened
 * on the marketplace AND what, if anything, is still pending — rather than a
 * generic "saved".
 */
function cloudOutcomeNotice(outcome: CloudActionOutcome) {
  const settled = outcome.transition === 'already_final'
    ? `The marketplace already had this order as ${outcome.remoteStatus}.`
    : `The marketplace confirmed ${outcome.remoteStatus}.`
  if (outcome.action === 'reject') return `${settled} The customer refund is handled by the marketplace.`
  switch (outcome.materialization) {
    case 'created': return `${settled} A local order was created and is now on the floor workflow.`
    case 'already_materialized': return `${settled} This order was already linked to a local order.`
    case 'awaiting_intake': return `${settled} It waits in intake until the physical laundry is counted against your catalogue.`
    case 'awaiting_customer_approval': return `${settled} It waits for the customer to answer the reassessment.`
    case 'blocked_by_setup': return `${settled} A local order cannot be created yet: ${outcome.materializationReason === 'TAX_PROFILE_INCOMPLETE' ? 'finish the supplier tax profile in settings' : outcome.materializationReason}.`
    default: return settled
  }
}

function deadline(order: OnlineOrder) {
  if (!order.acceptanceDeadline) return { label: 'No deadline', tone: 'muted' as const }
  const remaining = Date.parse(order.acceptanceDeadline) - Date.now()
  if (remaining < 0) return { label: 'Past deadline', tone: 'danger' as const }
  if (remaining < 2 * 60 * 60 * 1000) return { label: `Due in ${Math.max(1, Math.round(remaining / 60_000))}m`, tone: 'warn' as const }
  return { label: `Due ${timeLabel(order.acceptanceDeadline)}`, tone: 'muted' as const }
}

function requestLabel(order: OnlineOrder) {
  const request = order.request || {}
  const items = Array.isArray(request.items) ? request.items.length : 0
  const bags = text(request.estimatedBags)
  const kg = text(request.estimatedKg || request.estimatedKgMilli)
  if (items) return `${items} item${items === 1 ? '' : 's'} specified`
  if (bags) return `${bags} bag${bags === '1' ? '' : 's'} estimated`
  if (kg) return `${kg} kg estimated`
  return 'Physical assessment pending'
}

export default function LaundryOnlineOrders() {
  const client = useQueryClient()
  const [filter, setFilter] = useState<(typeof states)[number]['key']>('all')
  const [search, setSearch] = useState('')
  const [cursor, setCursor] = useState<string | undefined>()
  const [loadedItems, setLoadedItems] = useState<OnlineOrder[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [intakeLines, setIntakeLines] = useState<IntakeLine[]>([])
  const [intakeGarment, setIntakeGarment] = useState('')
  const [intakeService, setIntakeService] = useState('')
  const [intakeQty, setIntakeQty] = useState('1')
  const [intakeBagCount, setIntakeBagCount] = useState('')
  const [pickupDate, setPickupDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [pickupWindow, setPickupWindow] = useState('')
  const [pickupRider, setPickupRider] = useState('')
  const [notice, setNotice] = useState('')
  const [searchParams] = useSearchParams()
  const [cloudDetail, setCloudDetail] = useState<CloudOrderDetail | undefined>()
  const [reconLineId, setReconLineId] = useState('')
  const [reconQty, setReconQty] = useState('')
  const [reconPhotoUrls, setReconPhotoUrls] = useState('')
  const [reconReason, setReconReason] = useState('')
  const [packedSlotLabel, setPackedSlotLabel] = useState('')
  const [packedSlotAt, setPackedSlotAt] = useState('')

  const session = useQuery({ queryKey: ['auth-session'], queryFn: () => apiGet<{ user: { roles: string[] } | null }>('/auth/session') })
  const canEdit = canUseUi(session.data?.user?.roles, 'orders.edit')
  const queue = useQuery({ queryKey: ['marketplace-online-orders', cursor], queryFn: () => apiGet<QueuePage>(`/marketplace/orders?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), staleTime: 10_000 })
  const sync = useQuery({ queryKey: ['marketplace-sync-status'], queryFn: () => apiGet<SyncStatus>('/marketplace/sync/status'), staleTime: 10_000 })
  const cloud = useQuery({ queryKey: ['marketplace-cloud-status'], queryFn: () => apiGet<CloudStatus>('/marketplace/cloud/status'), staleTime: 10_000 })
  // Accepting or rejecting is a marketplace decision, so it needs a connected
  // account with a linked vendor. Without one there is nothing to decide
  // against, and the controls say so rather than failing when pressed.
  // Declared early: the marketplace-detail auto-sync effect below needs it.
  const cloudReady = Boolean(cloud.data?.connected && cloud.data?.remoteVendorId)
  const cloudBlocker = cloud.isLoading || cloudReady ? undefined
    : !cloud.data?.configured ? 'This installation has no marketplace endpoint configured, so online decisions cannot reach the marketplace.'
      : !cloud.data.connected ? 'Connect this store to its marketplace account to accept or reject online orders.'
        : 'The connected account has no vendor linked yet, so marketplace decisions cannot be attributed to a store.'
  const pageItems = queue.data?.items || []
  const orders = cursor ? [...loadedItems, ...pageItems] : pageItems
  const visible = useMemo(() => orders.filter((order) => {
    const matchesFilter = filter === 'all' || filter === 'active' ? filter === 'all' || !['Rejected', 'Cancelled', 'Completed'].includes(order.state) : order.state === filter
    const needle = search.trim().toLowerCase()
    const matchesSearch = !needle || [order.orderNumber, order.externalOrderId, order.channel, order.customer.name, order.customer.phone].map((value) => text(value).toLowerCase()).some((value) => value.includes(needle))
    return matchesFilter && matchesSearch
  }), [filter, orders, search])
  const selected = visible.find((order) => order.id === selectedId) || orders.find((order) => order.id === selectedId) || visible[0]
  const truth = useQuery({ queryKey: ['marketplace-order-truth', selected?.externalOrderId], queryFn: () => apiGet<Truth>(`/marketplace/orders/${encodeURIComponent(selected!.externalOrderId)}/truth`), enabled: Boolean(selected?.externalOrderId), staleTime: 10_000 })
  const customerStatus = useQuery({ queryKey: ['marketplace-customer-status', selected?.externalOrderId], queryFn: () => apiGet<CustomerStatus>(`/marketplace/orders/${encodeURIComponent(selected!.externalOrderId)}/customer-status`), enabled: Boolean(selected?.externalOrderId), staleTime: 10_000 })
  const pickup = useQuery({ queryKey: ['marketplace-pickup', selected?.externalOrderId], queryFn: () => apiGet<PickupTask | null>(`/marketplace/orders/${encodeURIComponent(selected!.externalOrderId)}/pickup`), enabled: Boolean(selected?.externalOrderId), staleTime: 10_000 })
  const localOrder = useQuery({ queryKey: ['marketplace-local-order', selected?.localOrderId], queryFn: () => apiGet<LocalOrderDetail>(`/laundry/orders/${encodeURIComponent(selected!.localOrderId!)}`), enabled: Boolean(selected?.localOrderId), staleTime: 10_000 })
  const catalogue = useQuery({ queryKey: ['laundry-catalogue'], queryFn: () => apiGet<Catalogue>('/laundry/catalogue'), enabled: selected?.state === 'IntakeRequired' })

  useEffect(() => { if (!selectedId && visible[0]) setSelectedId(visible[0].id) }, [selectedId, visible])
  useEffect(() => {
    const externalOrderId = searchParams.get('order')
    const match = externalOrderId ? orders.find((order) => order.externalOrderId === externalOrderId) : undefined
    if (match) setSelectedId(match.id)
  }, [orders, searchParams])
  useEffect(() => { setRejectReason(''); setIntakeLines([]); setNotice(''); setIntakeGarment(''); setIntakeService(''); setIntakeQty('1'); setIntakeBagCount(''); setPickupDate(new Date().toISOString().slice(0, 10)); setPickupWindow(''); setPickupRider(''); setCloudDetail(undefined); setReconLineId(''); setReconQty(''); setReconPhotoUrls(''); setReconReason('') }, [selected?.id])
  // The list endpoint carries no order lines, evidence, reconciliation record,
  // or remote timeline — only /detail-sync does. Fetched automatically on
  // selection (for marketplace orders with a working connection) so the
  // operator always sees the freshest marketplace truth without an extra
  // click, and it also resolves any customer decision that arrived since the
  // last time this order was opened.
  const detailSync = useMutation({
    mutationFn: (id: string) => apiPost<CloudDetailSyncResult>(`/marketplace/cloud/orders/${encodeURIComponent(id)}/detail-sync`, undefined),
    onSuccess: (result) => {
      setCloudDetail(result.detail)
      if (result.customerDecision) {
        setNotice(result.customerDecision.decision === 'approve' ? `The customer approved the recount (${result.customerDecision.remoteStatus}).` : `The customer disputed the recount (${result.customerDecision.remoteStatus}).`)
        invalidate()
      }
    },
  })
  useEffect(() => {
    if (selected && selected.channel === 'MARKETPLACE' && cloudReady) detailSync.mutate(selected.externalOrderId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, cloudReady])

  const invalidate = () => { void client.invalidateQueries({ queryKey: ['marketplace-online-orders'] }); void client.invalidateQueries({ queryKey: ['marketplace-sync-status'] }); void client.invalidateQueries({ queryKey: ['marketplace-order-truth'] }); void client.invalidateQueries({ queryKey: ['marketplace-customer-status'] }); void client.invalidateQueries({ queryKey: ['marketplace-pickup'] }) }
  // Accept/reject go to the cloud, which owns the marketplace decision: it is
  // confirmed there before any local state changes. Materialize stays local —
  // creating the local operational order is purely a store-side step.
  const action = useMutation({
    mutationFn: ({ id, kind, reason }: { id: string; kind: 'accept' | 'reject' | 'materialize'; reason?: string }) =>
      kind === 'materialize'
        ? apiPost(`/marketplace/orders/${encodeURIComponent(id)}/materialize`, {})
        : apiPost<CloudActionOutcome>(`/marketplace/cloud/orders/${encodeURIComponent(id)}/${kind}`, kind === 'reject' ? { reason } : undefined),
    onSuccess: (result, variables) => {
      setNotice(variables.kind === 'materialize' ? 'The accepted order is now linked to the local operational order.' : cloudOutcomeNotice(result as CloudActionOutcome))
      // accept/reject just moved the REMOTE status (VENDOR_ACCEPTED etc.) —
      // without this, the marketplace-progress panel below would keep
      // showing whatever remote status was cached from before this action.
      if (variables.kind !== 'materialize') void detailSync.mutate(variables.id)
      invalidate()
    },
    onError: (error, variables) => {
      // A conflict means another client (Vendor App, platform, auto-reject) got
      // there first. The queue AND the marketplace-progress panel are both
      // refreshed so the corrected remote state is visible immediately
      // instead of the operator re-clicking a stale button.
      if (error instanceof ApiError && error.code === 'CLOUD_ORDER_CONFLICT') { void detailSync.mutate(variables.id); invalidate() }
    },
  })
  const cloudSync = useMutation({
    mutationFn: () => apiPost<{ pulled: number; created: number; updated: number; skipped: Array<{ externalOrderId: string; reason: string }> }>('/marketplace/cloud/sync-orders', undefined),
    onSuccess: (result) => {
      const skipped = result.skipped.length ? ` ${result.skipped.length} could not be read and were skipped.` : ''
      setNotice(`Pulled ${result.pulled} order${result.pulled === 1 ? '' : 's'} from the marketplace — ${result.created} new, ${result.updated} updated.${skipped}`)
      invalidate()
    },
  })
  const intake = useMutation({ mutationFn: ({ id, actual }: { id: string; actual: Record<string, unknown> }) => apiPost(`/marketplace/orders/${encodeURIComponent(id)}/intake`, actual), onSuccess: () => { setNotice('Physical intake recorded. Review any reassessment before materializing.'); invalidate() } })
  // Stage advance and reconciliation both go straight to the marketplace —
  // there is no local-only version of either. A successful call re-syncs the
  // full detail so the operator sees the marketplace's own resulting status
  // immediately rather than a stale one.
  const stageAdvance = useMutation({
    mutationFn: ({ id, stage, deliverySlotLabel, deliverySlotAt }: { id: string; stage: string; deliverySlotLabel?: string; deliverySlotAt?: string }) =>
      apiPost<CloudStageOutcome>(`/marketplace/cloud/orders/${encodeURIComponent(id)}/stage`, { stage, ...(deliverySlotLabel ? { deliverySlotLabel } : {}), ...(deliverySlotAt ? { deliverySlotAt } : {}) }),
    onSuccess: (result, variables) => {
      setNotice(`The marketplace now shows ${REMOTE_STAGE_LABEL[result.remoteStatus] || result.remoteStatus}.`)
      if (variables.stage === 'PACKED') { setPackedSlotLabel(''); setPackedSlotAt('') }
      void detailSync.mutate(variables.id); invalidate()
    },
  })
  const reconcile = useMutation({
    mutationFn: ({ id, orderLineId, confirmedQuantity, photoUrls, reason }: { id: string; orderLineId: string; confirmedQuantity: number; photoUrls: string[]; reason: string }) =>
      apiPost<CloudReconciliationOutcome>(`/marketplace/cloud/orders/${encodeURIComponent(id)}/reconcile`, { lines: [{ orderLineId, confirmedQuantity }], photoUrls, reason }),
    onSuccess: (result, variables) => {
      setNotice(result.deltaPaise ? `Recount proposed: ${formatINR((result.previousPayableAmountPaise || 0) / 100)} → ${formatINR((result.proposedPayableAmountPaise || 0) / 100)}, awaiting the customer.` : 'Recount proposed — no price change, so nothing awaits customer approval.')
      setReconLineId(''); setReconQty(''); setReconPhotoUrls(''); setReconReason('')
      void detailSync.mutate(variables.id)
      invalidate()
    },
  })
  const pickupAction = useMutation({ mutationFn: ({ id, kind }: { id: string; kind: 'schedule' | 'collect' }) => kind === 'schedule' ? apiPost(`/marketplace/orders/${encodeURIComponent(id)}/pickup/schedule`, { scheduledDate: pickupDate, window: pickupWindow || undefined, riderId: pickupRider || undefined }) : apiPost(`/marketplace/orders/${encodeURIComponent(id)}/pickup/outcome`, { state: 'Collected' }), onSuccess: (_, variables) => { setNotice(variables.kind === 'schedule' ? 'Pickup scheduled locally. The outbound command will remain pending until sync is acknowledged.' : 'Pickup collection recorded locally; the order is ready for physical intake.'); invalidate() } })

  const addIntakeLine = () => {
    const qty = Number(intakeQty)
    if (!intakeGarment || !intakeService || !Number.isFinite(qty) || qty <= 0) return
    setIntakeLines((lines) => [...lines, { garmentId: intakeGarment, serviceId: intakeService, qty }])
    setIntakeQty('1')
  }
  const submitIntake = () => {
    if (!selected || !intakeLines.length) return
    intake.mutate({ id: selected.externalOrderId, actual: { items: intakeLines, ...(intakeBagCount ? { bagCount: Number(intakeBagCount) } : {}) } })
  }
  const loadMore = () => { if (!queue.data?.nextCursor || queue.isFetching) return; setLoadedItems(orders); setCursor(queue.data.nextCursor) }
  const refresh = () => { setCursor(undefined); setLoadedItems([]); void queue.refetch(); void sync.refetch() }
  // Accepting or rejecting is a marketplace decision, so it needs a connected
  // account with a linked vendor. Without one there is nothing to decide
  // against, and the controls say so rather than failing when pressed.
  const awaiting = orders.filter((order) => order.state === 'AwaitingAcceptance').length
  const needsIntake = orders.filter((order) => order.state === 'IntakeRequired').length
  const needsApproval = orders.filter((order) => order.state === 'CustomerApprovalRequired').length

  return <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#4d8982]">Marketplace edge · operator cockpit</p><h1 className="mt-1 font-serif text-3xl tracking-[-.02em] text-[#17353c]">Online orders</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-[#718087]">Every request arrives with its source and evidence. Accept the work, receive the physical laundry, then move it into the same floor workflow as a counter order.</p></div>
      <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
        <button type="button" onClick={refresh} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#263f44]/15 bg-white px-3 text-xs font-bold text-[#315d57] shadow-sm"><RefreshCw className={cn('h-3.5 w-3.5', queue.isFetching && 'animate-spin')} />Refresh queue</button>
        <button type="button" onClick={() => cloudSync.mutate()} disabled={!cloudReady || cloudSync.isPending} aria-label={cloudReady ? 'Pull from marketplace' : 'Pull from marketplace — connect this store to its marketplace account first'} title={cloudReady ? 'Fetch new and updated orders from the marketplace' : 'Connect this store to its marketplace account first'} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#173f46] px-3 text-xs font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-45"><Cloud className={cn('h-3.5 w-3.5', cloudSync.isPending && 'animate-pulse')} />{cloudSync.isPending ? 'Pulling…' : 'Pull from marketplace'}</button>
      </div>
    </header>

    <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric icon={<Inbox />} label="Loaded queue" value={String(orders.length)} accent="teal" />
      <Metric icon={<CalendarClock />} label="Awaiting acceptance" value={String(awaiting)} accent="amber" />
      <Metric icon={<PackageCheck />} label="Intake pending" value={String(needsIntake)} accent="blue" />
      <Metric icon={<ClipboardCheck />} label="Customer approval" value={String(needsApproval)} accent="violet" />
      <Metric icon={<Cloud />} label="Marketplace account" value={cloud.isError ? 'Unavailable' : cloudReady ? 'Connected' : cloud.data?.connected ? 'No vendor linked' : cloud.data?.configured ? 'Not connected' : 'Not configured'} accent={cloudReady ? 'teal' : cloud.data?.connected ? 'amber' : 'slate'} />
    </section>

    <section className="mt-5 rounded-[22px] border border-[#263f44]/10 bg-[#fffdf8] p-3 shadow-[0_10px_30px_rgba(37,48,43,.035)]">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div className="flex items-center gap-2 overflow-x-auto pb-1">{states.map((item) => <button key={item.key} type="button" onClick={() => setFilter(item.key)} className={cn('whitespace-nowrap rounded-full px-3 py-2 text-[11px] font-bold transition-colors', filter === item.key ? 'bg-[#173f46] text-white' : 'text-[#647478] hover:bg-[#edf3f0]')}>{item.label}</button>)}</div><label className="flex h-10 min-w-0 items-center gap-2 rounded-xl border border-[#263f44]/12 bg-white px-3 text-sm text-[#718087] xl:w-72"><Search className="h-4 w-4 shrink-0" /><span className="sr-only">Search online orders</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Order, customer, phone…" className="min-w-0 flex-1 bg-transparent text-sm text-[#27454c] outline-none placeholder:text-[#9ba7a7]" /></label></div>
      {sync.data?.checkpoint?.error ? <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#fff4de] px-3 py-2.5 text-xs font-semibold text-[#805b24]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Sync needs attention: {sync.data.checkpoint.error}</div> : null}
      {!session.isLoading && !canEdit ? <div className="mt-3 rounded-xl border border-[#263f44]/10 bg-[#edf3f0] px-3 py-2.5 text-xs font-semibold text-[#53676a]">Read-only queue. An owner or counter operator must accept, reject, assess, or materialize marketplace work.</div> : null}
      {cloudBlocker ? <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-[#263f44]/10 bg-[#eef2f0] px-3 py-2.5 text-xs font-semibold text-[#53676a]"><CircleOff className="h-3.5 w-3.5 shrink-0" /><span>{cloudBlocker}</span><Link to="/laundry/sync-status" className="underline decoration-[#39786f]/40 underline-offset-2 hover:text-[#2e6a60]">Open marketplace sync</Link></div> : null}
      {cloudReady && cloud.data?.remoteVendorName ? <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-[#39786f]/20 bg-[#f3faf6] px-3 py-2.5 text-xs font-semibold text-[#2e6a60]"><Cloud className="h-3.5 w-3.5 shrink-0" />Connected to {cloud.data.remoteVendorName}. Accepting or rejecting is confirmed on the marketplace before it is recorded here.</div> : null}
    </section>

    {action.isError || intake.isError ? <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-[#fde9e6] px-3 py-2.5 text-sm text-[#a44036]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{operatorErrorMessage(action.error || intake.error, 'The online order action failed. Refresh and try again.')}</div> : null}
    {notice ? <div role="status" className="mt-4 rounded-xl bg-[#e8f3ee] px-3 py-2.5 text-xs font-semibold text-[#2e6a60]">{notice}</div> : null}

    <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.82fr)]">
      <section className="overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_10px_30px_rgba(37,48,43,.035)]" aria-label="Online order queue">
        <div className="flex items-center justify-between border-b border-[#263f44]/8 px-4 py-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#718087]">Store queue</p><p className="mt-0.5 text-sm font-semibold text-[#27454c]">{visible.length} visible request{visible.length === 1 ? '' : 's'}</p></div><SlidersHorizontal className="h-4 w-4 text-[#8b9a99]" /></div>
        <div className="divide-y divide-[#263f44]/8">{queue.isLoading ? <div className="p-10 text-center text-sm text-[#718087]">Loading the local queue…</div> : visible.map((order) => <OrderRow key={order.id} order={order} selected={selected?.id === order.id} onSelect={() => setSelectedId(order.id)} />)}{!queue.isLoading && !visible.length ? <VisualEmptyState kind="orders" compact title="No matching requests" detail="Try another filter or search term. The queue never fabricates cloud connectivity." /> : null}</div>
        {queue.data?.nextCursor ? <div className="border-t border-[#263f44]/8 p-3 text-center"><button type="button" onClick={loadMore} disabled={queue.isFetching} className="rounded-lg border border-[#263f44]/15 px-3 py-2 text-xs font-bold text-[#315d57] disabled:opacity-50">Load next page <ChevronRight className="ml-1 inline h-3 w-3" /></button></div> : null}
      </section>

      <aside className="rounded-[22px] border border-[#173f46]/12 bg-[#173f46] text-[#f8faf5] shadow-[0_18px_42px_rgba(23,63,70,.16)]" aria-label="Online order detail">
        {!selected ? <div className="grid min-h-[420px] place-items-center p-8 text-center"><Inbox className="h-8 w-8 text-[#8fb2a8]" /><p className="mt-3 font-serif text-xl">Select a request</p><p className="mt-1 max-w-xs text-sm leading-6 text-[#b3c8c1]">The work card will keep request, intake, payment, sync, and action evidence together.</p></div> : <OrderDetail canEdit={canEdit} cloudReady={cloudReady} cloudBlocker={cloudBlocker} order={selected} truth={truth.data} customerStatus={customerStatus.data} pickup={pickup.data} localOrder={localOrder.data} pickupDate={pickupDate} setPickupDate={setPickupDate} pickupWindow={pickupWindow} setPickupWindow={setPickupWindow} pickupRider={pickupRider} setPickupRider={setPickupRider} catalogue={catalogue.data} intakeLines={intakeLines} setIntakeLines={setIntakeLines} intakeGarment={intakeGarment} setIntakeGarment={setIntakeGarment} intakeService={intakeService} setIntakeService={setIntakeService} intakeQty={intakeQty} setIntakeQty={setIntakeQty} intakeBagCount={intakeBagCount} setIntakeBagCount={setIntakeBagCount} onAddLine={addIntakeLine} onSubmitIntake={submitIntake} actionPending={action.isPending || intake.isPending || pickupAction.isPending} onAccept={() => action.mutate({ id: selected.externalOrderId, kind: 'accept' })} onMaterialize={() => action.mutate({ id: selected.externalOrderId, kind: 'materialize' })} onSchedulePickup={() => pickupAction.mutate({ id: selected.externalOrderId, kind: 'schedule' })} onCollectPickup={() => pickupAction.mutate({ id: selected.externalOrderId, kind: 'collect' })} onReject={() => { if (rejectReason.trim()) action.mutate({ id: selected.externalOrderId, kind: 'reject', reason: rejectReason.trim() }) }} rejectReason={rejectReason} setRejectReason={setRejectReason} cloud={{
          detail: cloudDetail, pending: stageAdvance.isPending || reconcile.isPending, syncing: detailSync.isPending, syncFailed: detailSync.isError,
          onSync: () => detailSync.mutate(selected.externalOrderId),
          onAdvanceStage: (stage, packedDelivery) => stageAdvance.mutate({ id: selected.externalOrderId, stage, deliverySlotLabel: packedDelivery?.deliverySlotLabel, deliverySlotAt: packedDelivery?.deliverySlotAt }),
          onReconcile: () => { const qty = Number(reconQty); const photoUrls = reconPhotoUrls.split(/[\n,]/).map((url) => url.trim()).filter(Boolean); if (!reconLineId || !Number.isFinite(qty) || qty < 0 || !photoUrls.length) return; reconcile.mutate({ id: selected.externalOrderId, orderLineId: reconLineId, confirmedQuantity: qty, photoUrls, reason: reconReason.trim() }) },
          reconLineId, setReconLineId, reconQty, setReconQty, reconPhotoUrls, setReconPhotoUrls, reconReason, setReconReason,
          packedSlotLabel, setPackedSlotLabel, packedSlotAt, setPackedSlotAt,
        }} />}
      </aside>
    </div>
  </div>
}

function Metric({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: 'teal' | 'amber' | 'blue' | 'violet' | 'red' | 'slate' }) {
  const colors = { teal: 'bg-[#e8f3ee] text-[#2e6a60]', amber: 'bg-[#fff2d7] text-[#8b5c1b]', blue: 'bg-[#e8f1f5] text-[#356477]', violet: 'bg-[#f1eaff] text-[#6844a6]', red: 'bg-[#fde9e6] text-[#a44036]', slate: 'bg-[#edf1f0] text-[#53676a]' }
  return <div className="rounded-2xl border border-[#263f44]/10 bg-white p-3.5"><div className="flex items-start justify-between gap-3"><span className={cn('grid h-8 w-8 place-items-center rounded-xl', colors[accent])}>{icon && <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>}</span><p className="text-right text-[10px] font-bold uppercase tracking-[.12em] text-[#879493]">{label}</p></div><p className="mt-3 text-xl font-bold tabular-nums text-[#27454c]">{value}</p></div>
}

function OrderRow({ order, selected, onSelect }: { order: OnlineOrder; selected: boolean; onSelect: () => void }) {
  const due = deadline(order)
  return <button type="button" onClick={onSelect} className={cn('group block w-full px-4 py-4 text-left transition-colors hover:bg-[#fbfcf9]', selected ? 'bg-[#eef6f1]' : 'bg-white')}><div className="flex items-start gap-3"><span className={cn('mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full', order.state === 'AwaitingAcceptance' ? 'bg-[#e2a63e]' : order.state === 'CustomerApprovalRequired' ? 'bg-[#8c65c5]' : order.state === 'Rejected' || order.state === 'Cancelled' ? 'bg-[#c45b50]' : 'bg-[#62a796]')} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[#27454c]">{order.orderNumber}</p><span className="rounded-full bg-[#f2f4f1] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-[#718087]">{channelLabel(order.channel)}</span></div><p className="mt-1 truncate text-xs text-[#718087]">{text(order.customer.name, 'Customer')} · {requestLabel(order)}</p><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-[#8a9897]"><span className={cn(due.tone === 'danger' && 'text-[#b14b40]', due.tone === 'warn' && 'text-[#9a6a22]')}>{due.label}</span><span>Updated {timeLabel(order.updatedAt)}</span></div></div><div className="flex shrink-0 flex-col items-end gap-2"><span className={cn('rounded-full px-2 py-1 text-[10px] font-bold', stateTone(order.state))}>{stateLabel(order.state)}</span><ChevronRight className={cn('h-4 w-4 text-[#a8b5b2] transition-transform group-hover:translate-x-0.5', selected && 'text-[#39786f]')} /></div></div></button>
}

function OrderDetail({ canEdit, cloudReady, cloudBlocker, order, truth, customerStatus, pickup, localOrder, pickupDate, setPickupDate, pickupWindow, setPickupWindow, pickupRider, setPickupRider, catalogue, intakeLines, setIntakeLines, intakeGarment, setIntakeGarment, intakeService, setIntakeService, intakeQty, setIntakeQty, intakeBagCount, setIntakeBagCount, onAddLine, onSubmitIntake, actionPending, onAccept, onMaterialize, onSchedulePickup, onCollectPickup, onReject, rejectReason, setRejectReason, cloud }: { canEdit: boolean; cloudReady: boolean; cloudBlocker?: string; order: OnlineOrder; truth?: Truth; customerStatus?: CustomerStatus; pickup?: PickupTask | null; localOrder?: LocalOrderDetail; pickupDate: string; setPickupDate: (value: string) => void; pickupWindow: string; setPickupWindow: (value: string) => void; pickupRider: string; setPickupRider: (value: string) => void; catalogue?: Catalogue; intakeLines: IntakeLine[]; setIntakeLines: React.Dispatch<React.SetStateAction<IntakeLine[]>>; intakeGarment: string; setIntakeGarment: (value: string) => void; intakeService: string; setIntakeService: (value: string) => void; intakeQty: string; setIntakeQty: (value: string) => void; intakeBagCount: string; setIntakeBagCount: (value: string) => void; onAddLine: () => void; onSubmitIntake: () => void; actionPending: boolean; onAccept: () => void; onMaterialize: () => void; onSchedulePickup: () => void; onCollectPickup: () => void; onReject: () => void; rejectReason: string; setRejectReason: (value: string) => void; cloud: CloudDetailPanelProps }) {
  const pickupAddress = text(order.pickup.address || order.pickup.pickupAddress, 'Address not shared')
  const customerPhone = text(order.customer.phone || order.customer.mobile)
  const latestReassessment = truth?.reassessments?.at(-1)
  return <div className="min-h-[560px]">
    <div className="border-b border-white/10 px-5 pb-4 pt-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#8fb2a8]">Work card · {channelLabel(order.channel)}</p><h2 className="mt-1 font-serif text-2xl">{order.orderNumber}</h2><p className="mt-1 break-all font-mono text-[10px] text-[#a9c2ba]">{order.externalOrderId}</p></div><span className={cn('rounded-full px-2.5 py-1.5 text-[10px] font-bold', stateTone(order.state))}>{stateLabel(order.state)}</span></div><div className="mt-4 grid grid-cols-2 gap-2"><DetailStat label="Payment" value={order.paymentState} /><DetailStat label="Source version" value={`v${order.sourceVersion}`} /></div></div>
    <div className="space-y-4 p-5"><div className="rounded-2xl border border-white/10 bg-white/[.06] p-3.5"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#8fb2a8]">Customer & collection</p><p className="mt-2 font-semibold">{text(order.customer.name, 'Customer')}</p>{customerPhone ? <p className="mt-1 flex items-center gap-2 text-xs text-[#c0d3cc]"><Phone className="h-3 w-3" />{customerPhone}</p> : null}<p className="mt-1 flex items-start gap-2 text-xs leading-5 text-[#c0d3cc]"><MapPin className="mt-1 h-3 w-3 shrink-0" />{pickupAddress}</p></div>
      <div className="rounded-2xl border border-white/10 bg-white/[.06] p-3.5"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#8fb2a8]">Original request</p><span className="text-xs font-semibold text-[#d5e3dc]">{requestLabel(order)}</span></div><dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-xs"><Info label="Requested delivery" value={dateLabel(text(order.request.expectedDeliveryDate || order.request.deliveryDate))} /><Info label="Pickup slot" value={text(order.pickup.slot || order.pickup.requestedSlot, 'Not scheduled')} /><Info label="Preferences" value={text(order.preferences, 'None recorded')} /><Info label="Local order" value={order.localOrderId ? 'Materialized' : 'Not yet linked'} /></dl></div>
      {localOrder ? <OperationalLink order={localOrder} /> : null}
      {canEdit && order.state === 'Accepted' && !pickup ? <PickupPanel date={pickupDate} setDate={setPickupDate} window={pickupWindow} setWindow={setPickupWindow} rider={pickupRider} setRider={setPickupRider} onSchedule={onSchedulePickup} pending={actionPending} /> : null}
      {canEdit && pickup && ['Scheduled', 'Assigned'].includes(pickup.state) ? <div className="rounded-2xl border border-[#6ea994]/30 bg-[#286258]/35 p-3.5"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#bfe3d3]">Pickup {pickup.state.toLowerCase()}</p><p className="mt-1 text-xs text-[#d6ebe2]">{pickup.scheduledDate || 'Date not set'} · {pickup.window || 'Window not set'}{pickup.riderId ? ` · Captain ${pickup.riderId}` : ''}</p><button type="button" disabled={actionPending} onClick={onCollectPickup} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#a8ddc6] px-3 py-2.5 text-xs font-bold text-[#173f46] disabled:opacity-50"><PackageCheck className="h-3.5 w-3.5" />Mark pickup collected</button></div> : null}
      {customerStatus ? <CustomerTimeline status={customerStatus} /> : null}
      {order.notes ? <div className="rounded-2xl border border-[#d7c38e]/30 bg-[#5c4d2d]/35 p-3.5 text-xs leading-5 text-[#f4e7c4]"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#e8cc8c]">Marketplace notes</p><p className="mt-2 whitespace-pre-wrap">{order.notes}</p></div> : null}
      {latestReassessment ? <div className="rounded-2xl border border-[#8f6fc0]/30 bg-[#6b4e92]/25 p-3.5"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#d6c2f0]">Latest reassessment · {latestReassessment.data.state}</p><div className="mt-2 flex items-end justify-between gap-3"><span className="text-xs text-[#d8cae9]">{latestReassessment.data.reason || 'Price changed after intake'}</span><span className="font-bold tabular-nums text-[#f1e5ff]">{formatINR(latestReassessment.data.revisedAmountPaise / 100)}</span></div></div> : null}
      {order.state === 'AwaitingAcceptance' ? canEdit ? <div className="space-y-2 rounded-2xl border border-[#6ea994]/30 bg-[#286258]/35 p-3.5"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#bfe3d3]">Operator decision</p><p className="text-xs leading-5 text-[#d6ebe2]">{cloudReady ? 'Your decision is confirmed on the marketplace first, then recorded here. Rejecting triggers the customer refund.' : 'Marketplace decisions are unavailable right now, so these controls cannot be used.'}</p>{cloudBlocker ? <p className="rounded-xl bg-white/10 px-3 py-2 text-xs leading-5 text-[#ffe0b8]">{cloudBlocker}</p> : null}<div className="flex gap-2"><button type="button" disabled={actionPending || !cloudReady} onClick={onAccept} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#a8ddc6] px-3 py-2.5 text-xs font-bold text-[#173f46] disabled:opacity-50"><Check className="h-3.5 w-3.5" />Accept request</button></div><div className="flex gap-2"><input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} disabled={!cloudReady} placeholder="Reason required to reject" className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs text-white outline-none placeholder:text-[#a9c2ba]" /><button type="button" disabled={actionPending || !cloudReady || !rejectReason.trim()} onClick={onReject} className="inline-flex items-center gap-1.5 rounded-xl border border-[#f0a19a]/35 px-3 py-2 text-xs font-bold text-[#ffd3ce] disabled:opacity-40"><X className="h-3.5 w-3.5" />Reject</button></div></div> : <ReadOnlyNotice message="Acceptance and rejection require order-edit access." /> : null}
      {order.state === 'IntakeRequired' && !order.localOrderId ? canEdit ? <IntakePanel catalogue={catalogue} lines={intakeLines} setLines={setIntakeLines} garment={intakeGarment} setGarment={setIntakeGarment} service={intakeService} setService={setIntakeService} qty={intakeQty} setQty={setIntakeQty} bags={intakeBagCount} setBags={setIntakeBagCount} onAdd={onAddLine} onSubmit={onSubmitIntake} pending={actionPending} /> : <ReadOnlyNotice message="Physical intake and materialization require order-edit access." /> : null}
      {canEdit && order.state === 'IntakeRequired' && truth?.intake && !order.localOrderId ? <button type="button" disabled={actionPending} onClick={onMaterialize} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#a8ddc6] px-3 py-2.5 text-xs font-bold text-[#173f46] disabled:opacity-50"><Truck className="h-3.5 w-3.5" />Materialize local order</button> : null}
      {order.channel === 'MARKETPLACE' && !['Rejected', 'Cancelled', 'Completed'].includes(order.state) ? <MarketplaceProgressPanel canEdit={canEdit} cloudReady={cloudReady} cloud={cloud} /> : null}
      <div className="flex items-center justify-between border-t border-white/10 pt-3 text-[10px] text-[#9fc0b5]"><span>Sync {order.syncState}</span><span>Updated {timeLabel(order.updatedAt)}</span></div>
    </div>
  </div>
}

/**
 * Everything that happens between "accepted" and "delivered" on the real
 * marketplace: the actual remote status (not the coarser local state above
 * it), evidence photos across all three contexts, the marketplace's own
 * timeline, the reconciliation record if one exists, stage-advance buttons,
 * and the recount form. All of it comes from `cloud.detail` — a real
 * /detail-sync response — never guessed from the list-endpoint fields alone.
 */
function MarketplaceProgressPanel({ canEdit, cloudReady, cloud }: { canEdit: boolean; cloudReady: boolean; cloud: CloudDetailPanelProps }) {
  const detail = cloud.detail
  const remoteStatus = detail?.remoteStatus
  const canReconcile = Boolean(remoteStatus && RECONCILE_ELIGIBLE_REMOTE_STATUSES.includes(remoteStatus))
  const canAdvanceStage = Boolean(remoteStatus && RECEIVED_REMOTE_STATUSES.includes(remoteStatus))
  const canMarkReceived = Boolean(remoteStatus && PRE_RECEIPT_REMOTE_STATUSES.includes(remoteStatus))
  const selectedLine = detail?.lines.find((line) => line.orderLineId === cloud.reconLineId)

  if (!cloudReady) return null

  return <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[.06] p-3.5">
    <div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#8fb2a8]"><Layers className="h-3.5 w-3.5" />Marketplace progress</p>
      {!detail && cloud.syncing ? <span className="text-[10px] text-[#9fc0b5]">Syncing…</span> : null}
      {!detail && cloud.syncFailed ? <button type="button" onClick={cloud.onSync} className="rounded-lg border border-[#f0a19a]/35 px-2 py-1 text-[10px] font-bold text-[#ffd3ce]">Retry sync</button> : null}
    </div>

    {detail ? <>
      <div className="flex items-center justify-between gap-2"><span className="text-xs text-[#c0d3cc]">Remote status</span><span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-[#e4eee9]">{REMOTE_STAGE_LABEL[detail.remoteStatus] || detail.remoteStatus}</span></div>

      {/* Evidence: everything ever attached to this order, across rider pickup, recount, and delivery — the backend gap this fixed is real, so an empty list here is honest, not a rendering bug. */}
      <div className="rounded-xl bg-black/10 p-3"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.13em] text-[#8fb2a8]"><Camera className="h-3.5 w-3.5" />Evidence ({detail.evidence.length})</p>
        {detail.evidence.length ? <div className="mt-2 space-y-1.5">{detail.evidence.map((photo, index) => <a key={`${photo.url}-${index}`} href={photo.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-[#dcebe4] hover:bg-white/10"><span className="flex min-w-0 items-center gap-1.5 truncate"><ExternalLink className="h-3 w-3 shrink-0 text-[#9fc0b5]" />{EVIDENCE_CONTEXT_LABEL[photo.context] || photo.context}{photo.uploadedByName ? ` · ${photo.uploadedByName}` : ''}</span><span className="shrink-0 text-[10px] text-[#9fc0b5]">{timeLabel(photo.createdAt)}</span></a>)}</div>
          : <p className="mt-1.5 text-xs text-[#9fc0b5]">No evidence has been attached to this order yet.</p>}
      </div>

      {detail.latestReconciliation ? <div className="rounded-xl bg-black/10 p-3"><div className="flex items-center justify-between gap-2"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.13em] text-[#8fb2a8]">{detail.latestReconciliation.status === 'REJECTED' ? <ShieldAlert className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}Recount</p><span className={cn('rounded-full px-2 py-1 text-[10px] font-bold', RECONCILIATION_STATUS_TONE[detail.latestReconciliation.status] || 'bg-white/10 text-[#e4eee9]')}>{detail.latestReconciliation.status.replace(/_/g, ' ')}</span></div>
        {detail.latestReconciliation.reason ? <p className="mt-1.5 text-xs text-[#c0d3cc]">{detail.latestReconciliation.reason}</p> : null}
        {detail.latestReconciliation.previousPayableAmountPaise !== undefined && detail.latestReconciliation.proposedPayableAmountPaise !== undefined ? <p className="mt-1.5 text-xs font-bold text-[#e4eee9]">{formatINR(detail.latestReconciliation.previousPayableAmountPaise / 100)} → {formatINR(detail.latestReconciliation.proposedPayableAmountPaise / 100)}</p> : null}
      </div> : null}

      {detail.timeline.length ? <div className="rounded-xl bg-black/10 p-3"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.13em] text-[#8fb2a8]"><History className="h-3.5 w-3.5" />Marketplace timeline</p><div className="mt-2 space-y-1.5">{detail.timeline.slice(-5).map((entry, index) => <div key={`${entry.at}-${index}`} className="text-xs text-[#c0d3cc]"><span className="font-semibold text-[#dcebe4]">{REMOTE_STAGE_LABEL[entry.newStatus] || entry.newStatus}</span>{entry.actorRole ? ` · ${entry.actorRole.replace(/_/g, ' ')}` : ''}<span className="ml-1 text-[10px] text-[#9fc0b5]">{timeLabel(entry.at)}</span>{entry.note ? <p className="text-[10px] text-[#9fc0b5]">{entry.note}</p> : null}</div>)}</div></div> : null}

      {canEdit ? <>
        {canMarkReceived ? <button type="button" disabled={cloud.pending} onClick={() => cloud.onAdvanceStage('RECEIVED_AT_VENDOR')} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#a8ddc6] px-3 py-2.5 text-xs font-bold text-[#173f46] disabled:opacity-50"><PackageCheck className="h-3.5 w-3.5" />Mark received at store</button> : null}
        {canAdvanceStage ? <div className="flex flex-wrap gap-1.5">{(['WASHING', 'DRYING', 'IRONING'] as const).map((stage) => <button key={stage} type="button" disabled={cloud.pending} onClick={() => cloud.onAdvanceStage(stage)} className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[10px] font-bold text-[#dcebe4] hover:bg-white/10 disabled:opacity-50">{stage.charAt(0) + stage.slice(1).toLowerCase()}</button>)}</div> : null}

        {canAdvanceStage ? <div className="space-y-2 rounded-xl border border-white/15 bg-white/5 p-3">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.13em] text-[#8fb2a8]"><Truck className="h-3.5 w-3.5" />Mark packed for dispatch</p>
          <p className="text-[10px] leading-4 text-[#9fc0b5]">The dispatch time shows on the captain's job card — it is separate from the customer's checkout-time delivery slot.</p>
          <input value={cloud.packedSlotLabel} onChange={(event) => cloud.setPackedSlotLabel(event.target.value)} aria-label="Dispatch slot label" placeholder="Dispatch slot (e.g. Today evening, 6-8pm)" className="w-full rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-white outline-none placeholder:text-[#9fc0b5]" />
          <input type="datetime-local" value={cloud.packedSlotAt} onChange={(event) => cloud.setPackedSlotAt(event.target.value)} aria-label="Dispatch slot time" className="w-full rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-white outline-none [color-scheme:dark]" />
          <button type="button" disabled={cloud.pending} onClick={() => cloud.onAdvanceStage('PACKED', { deliverySlotLabel: cloud.packedSlotLabel.trim() || undefined, deliverySlotAt: cloud.packedSlotAt ? new Date(cloud.packedSlotAt).toISOString() : undefined })} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs font-bold text-[#dcebe4] hover:bg-white/10 disabled:opacity-50"><PackageCheck className="h-3.5 w-3.5" />Packed</button>
        </div> : null}

        {canReconcile ? <div className="space-y-2 rounded-xl border border-[#8f6fc0]/30 bg-[#6b4e92]/20 p-3"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#d6c2f0]">Propose a recount</p><p className="text-[10px] leading-4 text-[#d8cae9]">Requires at least one photo. The marketplace prices the change — you never set an amount here.</p>
          <select aria-label="Order line to adjust" value={cloud.reconLineId} onChange={(event) => cloud.setReconLineId(event.target.value)} className="w-full rounded-xl border border-white/15 bg-[#3a2c52] px-2.5 py-2 text-xs text-white outline-none"><option value="">Select a line</option>{(detail.lines || []).map((line) => <option key={line.orderLineId} value={line.orderLineId}>{line.name} — ordered {line.estimatedQuantity ?? '—'} {line.unit}</option>)}</select>
          <div className="flex gap-2"><input type="number" min="0" step={selectedLine?.unit === 'KG' || selectedLine?.unit === 'kg' ? '0.1' : '1'} value={cloud.reconQty} onChange={(event) => cloud.setReconQty(event.target.value)} aria-label="Confirmed quantity" placeholder={`Confirmed quantity${selectedLine ? ` (${selectedLine.unit})` : ''}`} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-white outline-none placeholder:text-[#c7b6e6]" /></div>
          <textarea value={cloud.reconPhotoUrls} onChange={(event) => cloud.setReconPhotoUrls(event.target.value)} rows={2} aria-label="Evidence photo URLs" placeholder="Photo URL(s), one per line" className="w-full rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-white outline-none placeholder:text-[#c7b6e6]" />
          <input value={cloud.reconReason} onChange={(event) => cloud.setReconReason(event.target.value)} aria-label="Reconciliation reason" placeholder="Reason (e.g. two extra shirts found in the bag)" className="w-full rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-white outline-none placeholder:text-[#c7b6e6]" />
          <button type="button" disabled={cloud.pending || !cloud.reconLineId || !cloud.reconQty.trim() || !cloud.reconPhotoUrls.trim()} onClick={cloud.onReconcile} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-[#4b3470] disabled:opacity-40"><ClipboardCheck className="h-3.5 w-3.5" />Propose recount to customer</button>
        </div> : null}
      </> : <ReadOnlyNotice message="Advancing stages and proposing a recount require order-edit access." />}
    </> : null}
  </div>
}

function PickupPanel({ date, setDate, window, setWindow, rider, setRider, onSchedule, pending }: { date: string; setDate: (value: string) => void; window: string; setWindow: (value: string) => void; rider: string; setRider: (value: string) => void; onSchedule: () => void; pending: boolean }) {
  return <div className="rounded-2xl border border-[#6ea994]/30 bg-[#286258]/35 p-3.5"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#bfe3d3]">Schedule pickup</p><p className="mt-1 text-xs leading-5 text-[#d6ebe2]">Keep the request separate until the captain collects the physical laundry.</p><div className="mt-3 grid gap-2 sm:grid-cols-3"><input aria-label="Pickup date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-white outline-none" /><input aria-label="Pickup window" value={window} onChange={(event) => setWindow(event.target.value)} placeholder="10:00–12:00" className="rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-white outline-none placeholder:text-[#a9c2ba]" /><input aria-label="Captain ID" value={rider} onChange={(event) => setRider(event.target.value)} placeholder="Captain ID (optional)" className="rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-white outline-none placeholder:text-[#a9c2ba]" /></div><button type="button" disabled={pending || !date} onClick={onSchedule} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#a8ddc6] px-3 py-2.5 text-xs font-bold text-[#173f46] disabled:opacity-50"><CalendarClock className="h-3.5 w-3.5" />Schedule pickup</button></div>
}

function CustomerTimeline({ status }: { status: CustomerStatus }) {
  return <div className="rounded-2xl border border-[#8fb2a8]/25 bg-[#204b51]/70 p-3.5"><div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#bfe3d3]"><History className="h-3.5 w-3.5" />Customer-facing timeline</p><span className="rounded-full bg-[#a8ddc6] px-2 py-1 text-[10px] font-bold text-[#173f46]">{status.label}</span></div><p className="mt-2 text-[10px] leading-4 text-[#c0d3cc]">Derived from recorded marketplace, intake, approval, and store events.</p>{status.timeline.length ? <div className="mt-3 space-y-2">{status.timeline.slice(-5).map((event) => <div key={event.eventId} className="flex items-start gap-2 text-xs"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#a8ddc6]" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="font-semibold text-[#e4eee9]">{event.label}</span><span className="text-[10px] text-[#9fc0b5]">{timeLabel(event.at)}</span></div><p className="text-[10px] text-[#9fc0b5]">{event.source.replace('-', ' ')}</p></div></div>)}</div> : <p className="mt-3 text-xs text-[#c0d3cc]">No status events have been recorded yet.</p>}</div>
}

function OperationalLink({ order }: { order: LocalOrderDetail }) {
  const units = order.physicalUnits || []
  const containers = order.containers || []
  const states = [...units.map((unit) => unit.state), ...containers.map((container) => container.state)]
  return <div className="rounded-2xl border border-[#8fb2a8]/25 bg-white/[.06] p-3.5"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#bfe3d3]">Local operational order</p><span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold text-[#d5e3dc]">{order.state}</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><DetailStat label="Items" value={String(order.itemCount || 0)} /><DetailStat label="Garments" value={String(units.length)} /><DetailStat label="Bags" value={String(containers.length)} /></div>{states.length ? <p className="mt-3 text-[10px] text-[#9fc0b5]">Physical states: {Array.from(new Set(states)).join(' · ')}</p> : <p className="mt-3 text-[10px] text-[#9fc0b5]">No physical garment or bag identities recorded yet.</p>}</div>
}

function ReadOnlyNotice({ message }: { message: string }) { return <div className="rounded-2xl border border-white/10 bg-white/[.06] p-3.5 text-xs leading-5 text-[#c0d3cc]">{message}</div> }

function IntakePanel({ catalogue, lines, setLines, garment, setGarment, service, setService, qty, setQty, bags, setBags, onAdd, onSubmit, pending }: { catalogue?: Catalogue; lines: IntakeLine[]; setLines: React.Dispatch<React.SetStateAction<IntakeLine[]>>; garment: string; setGarment: (value: string) => void; service: string; setService: (value: string) => void; qty: string; setQty: (value: string) => void; bags: string; setBags: (value: string) => void; onAdd: () => void; onSubmit: () => void; pending: boolean }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[.06] p-3.5"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#8fb2a8]">Physical intake</p><p className="mt-1 text-xs leading-5 text-[#c0d3cc]">Record what arrived. The original estimate stays preserved above.</p><div className="mt-3 grid gap-2 sm:grid-cols-[1.2fr_1.2fr_.55fr_auto]"><select aria-label="Intake garment" value={garment} onChange={(event) => setGarment(event.target.value)} className="rounded-xl border border-white/15 bg-[#1e4b51] px-2.5 py-2 text-xs text-white outline-none"><option value="">Garment</option>{(catalogue?.garments || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Intake service" value={service} onChange={(event) => setService(event.target.value)} className="rounded-xl border border-white/15 bg-[#1e4b51] px-2.5 py-2 text-xs text-white outline-none"><option value="">Service</option>{(catalogue?.services || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input type="number" min=".1" step=".1" value={qty} onChange={(event) => setQty(event.target.value)} aria-label="Intake quantity" className="rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-white outline-none" /><button type="button" onClick={onAdd} className="rounded-xl border border-[#a8ddc6]/45 px-2.5 py-2 text-xs font-bold text-[#bfe3d3]">Add</button></div>{lines.length ? <div className="mt-3 space-y-1.5">{lines.map((line, index) => <div key={`${line.garmentId}-${line.serviceId}-${index}`} className="flex items-center justify-between rounded-lg bg-black/10 px-2.5 py-2 text-xs text-[#dcebe4]"><span>{catalogue?.garments.find((item) => item.id === line.garmentId)?.name || line.garmentId} · {catalogue?.services.find((item) => item.id === line.serviceId)?.name || line.serviceId}</span><span className="flex items-center gap-2 font-bold">× {line.qty}<button type="button" aria-label="Remove intake line" onClick={() => setLines(lines.filter((_, current) => current !== index))}><X className="h-3.5 w-3.5 text-[#bfe3d3]" /></button></span></div>)}</div> : null}<div className="mt-3 flex gap-2"><input type="number" min="0" step="1" value={bags} onChange={(event) => setBags(event.target.value)} aria-label="Bag count" placeholder="Bags (optional)" className="w-32 rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-white outline-none placeholder:text-[#a9c2ba]" /><button type="button" disabled={pending || !lines.length} onClick={onSubmit} className="flex-1 rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-[#173f46] disabled:opacity-40">Save physical intake</button></div></div>
}

function DetailStat({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-white/[.07] px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-[.12em] text-[#8fb2a8]">{label}</p><p className="mt-1 text-xs font-semibold text-[#e4eee9]">{value}</p></div> }
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-[9px] font-bold uppercase tracking-[.1em] text-[#8fb2a8]">{label}</dt><dd className="mt-1 line-clamp-2 text-[#d4e2dc]">{value}</dd></div> }
