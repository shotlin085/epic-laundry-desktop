import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CircleOff, Cloud, Clock3, Database, LogOut, RefreshCw, Server, ShieldAlert, Smartphone, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, apiGet, apiPost, operatorErrorMessage } from '@/lib/api'
import VisualLoadingState from '@/components/laundry/VisualLoadingState'
import { canUseUi } from '@/components/laundry/LaundryShell'

type SyncStatus = {
  version: number
  configured: boolean
  device: { id: string; vendorId: string; storeId: string; station: string; status: string; lastSeenAt?: string; rotationRequired: boolean } | null
  checkpoint: { remoteStream: string; cursor: string; lastPullAt?: string; lastPushAt?: string; lastHeartbeatAt?: string; serverTimeOffsetMs?: number; error?: string; updatedAt: string } | null
  outbox: { pending: number; inFlight: number; retry: number; acknowledged: number; deadLetter: number }
  inbox: { received: number; held: number; failed: number; conflicts: number }
  onlineOrders: number
}

function when(value?: string) {
  if (!value) return 'Not recorded'
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('en-IN') : value
}

function statusTone(status: string) {
  if (status === 'Registered') return 'bg-[#eaf3ef] text-[#32695f]'
  if (status === 'Revoked') return 'bg-rose-50 text-rose-700'
  return 'bg-[#fff8e8] text-[#855815]'
}

type CloudStatus = { configured: boolean; connected: boolean; remoteVendorName?: string; remoteVendorId?: string; remoteUserRole?: string; phone?: string; connectedAt?: string }
type CloudSyncState = 'Idle' | 'Syncing' | 'Healthy' | 'Backoff'
type CloudSyncHealth = {
  state: CloudSyncState
  lastAttemptAt?: string; lastSuccessAt?: string; lastError?: string; nextAttemptAt?: string
  consecutiveFailures: number; lastPulled: number; lastCreated: number; lastUpdated: number; lastSkipped: number; updatedAt: string
} | null

function cloudSyncTone(state?: CloudSyncState) {
  if (state === 'Healthy') return 'bg-[#e8f3ee] text-[#2e6a60]'
  if (state === 'Syncing') return 'bg-[#edf2ff] text-[#4a63b8]'
  if (state === 'Backoff') return 'bg-[#fde9e6] text-[#a44036]'
  return 'bg-[#eef2f0] text-[#617178]'
}

/**
 * Connects this store to its real marketplace account. Kept deliberately
 * separate from the device/envelope identity below: that is the local edge-sync
 * concept, this is the account the marketplace actually authenticates and
 * attributes orders to.
 */
function MarketplaceAccountPanel({ canManage }: { canManage: boolean }) {
  const client = useQueryClient()
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const cloud = useQuery({ queryKey: ['marketplace-cloud-status'], queryFn: () => apiGet<CloudStatus>('/marketplace/cloud/status'), refetchInterval: 60_000 })
  const cloudSyncHealth = useQuery({ queryKey: ['marketplace-cloud-sync-health'], queryFn: () => apiGet<CloudSyncHealth>('/marketplace/cloud/sync-health'), enabled: Boolean(cloud.data?.connected && cloud.data?.remoteVendorId), refetchInterval: 10_000 })
  const refresh = () => { void client.invalidateQueries({ queryKey: ['marketplace-cloud-status'] }); void client.invalidateQueries({ queryKey: ['marketplace-cloud-sync-health'] }); void client.invalidateQueries({ queryKey: ['marketplace-online-orders'] }) }
  const requestOtp = useMutation({ mutationFn: () => apiPost('/marketplace/cloud/otp', { phone: phone.trim() }), onSuccess: () => setNotice('A one-time code was sent to that number by the marketplace. Enter it below to finish connecting.') })
  const connect = useMutation({ mutationFn: () => apiPost<CloudStatus>('/marketplace/cloud/connect', { phone: phone.trim(), otp: otp.trim() }), onSuccess: (result) => { setOtp(''); setNotice(result.remoteVendorId ? `Connected as ${result.remoteVendorName || 'this account'}.` : 'Connected, but this account has no vendor linked yet, so marketplace order decisions stay unavailable.'); refresh() } })
  const disconnect = useMutation({ mutationFn: () => apiPost('/marketplace/cloud/disconnect', undefined), onSuccess: () => { setNotice('This store no longer holds marketplace credentials. Local operations are unaffected.'); refresh() } })
  const pending = requestOtp.isPending || connect.isPending || disconnect.isPending
  const error = requestOtp.error || connect.error || disconnect.error
  const data = cloud.data
  const linked = Boolean(data?.connected && data?.remoteVendorId)
  const health = cloudSyncHealth.data

  return <section className={`rounded-[22px] border p-5 md:p-6 ${linked ? 'border-[#39786f]/20 bg-[#f3faf6]' : 'border-[#263f44]/10 bg-white'} shadow-[0_8px_28px_rgba(37,48,43,.04)]`}>
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${linked ? 'bg-[#dcefe5] text-[#2e6a60]' : 'bg-[#eef2f0] text-[#6c7e80]'}`}>{linked ? <CheckCircle2 className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}</span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#4d8982]">Marketplace account</p>
          <h2 className="mt-1 font-serif text-2xl text-[#17353c]">{linked ? data?.remoteVendorName || 'Connected' : data?.connected ? 'Connected · no vendor linked' : 'Not connected'}</h2>
          <p className="mt-1 max-w-xl text-sm text-[#617178]">{linked ? 'Online orders can be pulled, and accept/reject decisions are confirmed on the marketplace before being recorded here.' : data?.connected ? 'The signed-in account is not linked to a vendor, so orders cannot be attributed to this store. Connect the account that owns the vendor profile.' : data?.configured ? 'Sign in with the phone number registered to this laundry on the marketplace.' : 'No marketplace endpoint is configured for this installation, so this store cannot reach the marketplace at all.'}</p>
        </div>
      </div>
      {data?.connected ? <dl className="grid shrink-0 gap-3 text-sm sm:grid-cols-2 lg:w-[300px]"><Row label="Signed in as" value={data.phone || 'Unknown'} /><Row label="Account role" value={data.remoteUserRole || 'Not reported'} /><Row label="Vendor id" value={data.remoteVendorId || 'Not linked'} mono /><Row label="Connected" value={when(data.connectedAt)} /></dl> : null}
    </div>

    {linked ? <div className="mt-4 rounded-xl border border-[#39786f]/15 bg-white/70 p-3.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><RefreshCw className={`h-4 w-4 ${health?.state === 'Syncing' ? 'animate-spin text-[#4a63b8]' : 'text-[#315d57]'}`} /><p className="text-xs font-bold text-[#27454c]">Direct marketplace order pull</p></div><span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${cloudSyncTone(health?.state)}`}>{health?.state === 'Healthy' ? <CheckCircle2 className="h-3.5 w-3.5" /> : health?.state === 'Backoff' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}{health?.state || 'Waiting'}</span></div>
      {health ? <div className="mt-2 grid gap-1 text-xs text-[#617178] sm:grid-cols-2"><span>Last success: <strong className="font-semibold text-[#315d57]">{when(health.lastSuccessAt)}</strong></span><span>Last pull: <strong className="font-semibold text-[#315d57]">{health.lastPulled} received · {health.lastCreated} new · {health.lastUpdated} changed</strong></span>{health.state === 'Backoff' ? <span className="sm:col-span-2 text-[#a44036]">Retry after {when(health.nextAttemptAt)} · {health.lastError || 'Marketplace unavailable'}</span> : <span className="sm:col-span-2">A direct account pull is separate from the local edge event ledger below; it never acknowledges a device-envelope event.</span>}</div> : <p className="mt-2 text-xs text-[#617178]">Waiting for this Desktop runtime’s first background marketplace check.</p>}
    </div> : null}

    {error ? <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-[#fde9e6] px-3 py-2.5 text-sm text-[#a44036]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{operatorErrorMessage(error, 'The marketplace connection attempt failed.')}{error instanceof ApiError && error.code === 'CLOUD_NOT_CONFIGURED' ? ' This installation has no marketplace endpoint configured.' : ''}</div> : null}
    {notice ? <div role="status" className="mt-4 rounded-xl bg-[#e8f3ee] px-3 py-2.5 text-xs font-semibold text-[#2e6a60]">{notice}</div> : null}

    {!canManage ? <p className="mt-4 rounded-xl border border-[#263f44]/10 bg-[#edf3f0] px-3 py-2.5 text-xs font-semibold text-[#53676a]">Connecting or disconnecting the marketplace account requires owner access.</p>
      : data?.connected ? <button type="button" onClick={() => disconnect.mutate()} disabled={pending} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[#a44036]/25 px-3 py-2 text-xs font-bold text-[#a44036] disabled:opacity-50"><LogOut className="h-3.5 w-3.5" />{disconnect.isPending ? 'Disconnecting…' : 'Disconnect this store'}</button>
        : <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#263f44]/12 bg-white px-3 text-sm text-[#718087]"><span className="sr-only">Marketplace phone number</span><input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="Registered phone number" className="min-w-0 flex-1 bg-transparent text-sm text-[#27454c] outline-none placeholder:text-[#9ba7a7]" /></label>
          <button type="button" onClick={() => requestOtp.mutate()} disabled={pending || !phone.trim() || !data?.configured} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#263f44]/15 bg-white px-3 text-xs font-bold text-[#315d57] disabled:opacity-50">{requestOtp.isPending ? 'Sending…' : 'Send code'}</button>
          <label className="flex h-10 items-center gap-2 rounded-xl border border-[#263f44]/12 bg-white px-3 text-sm text-[#718087] sm:w-40"><span className="sr-only">One-time code</span><input value={otp} onChange={(event) => setOtp(event.target.value)} inputMode="numeric" placeholder="One-time code" className="min-w-0 flex-1 bg-transparent text-sm tabular-nums text-[#27454c] outline-none placeholder:text-[#9ba7a7]" /></label>
          <button type="button" onClick={() => connect.mutate()} disabled={pending || !phone.trim() || !otp.trim()} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#173f46] px-3 text-xs font-bold text-white disabled:opacity-50"><Cloud className="h-3.5 w-3.5" />{connect.isPending ? 'Connecting…' : 'Connect store'}</button>
        </div>}
  </section>
}

export default function LaundrySyncStatus() {
  const sync = useQuery({ queryKey: ['marketplace-sync-status'], queryFn: () => apiGet<SyncStatus>('/marketplace/sync/status'), refetchInterval: 30_000 })
  const session = useQuery({ queryKey: ['auth-session'], queryFn: () => apiGet<{ user: { roles: string[] } | null }>('/auth/session') })
  const canManage = canUseUi(session.data?.user?.roles, 'settings.manage')
  if (sync.isLoading) return <VisualLoadingState title="Preparing marketplace sync status" detail="We are reading this device’s local outbox, inbox and checkpoint records. Local laundry operations remain available while sync loads." icon={Cloud} />
  if (sync.isError || !sync.data) return <section className="rounded-[22px] border border-rose-200 bg-rose-50 p-6 text-rose-800"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><h1 className="font-serif text-2xl">Sync status unavailable</h1><p className="mt-1 text-sm">The local status endpoint could not be read. The desktop remains local-first; verify the local server before retrying.</p><button type="button" onClick={() => void sync.refetch()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#123039] px-3 py-2 text-xs font-bold text-white"><RefreshCw className="h-3.5 w-3.5" />Retry</button></div></div></section>

  const data = sync.data
  const issueCount = data.outbox.retry + data.outbox.deadLetter + data.inbox.held + data.inbox.failed
  const registered = data.configured && data.device?.status === 'Registered'
  const connected = registered
  return <div className="animate-in fade-in slide-in-from-bottom-2 space-y-6 duration-500">
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">Marketplace operations</p><h1 className="mt-1 font-serif text-3xl text-[#17353c]">Sync status</h1><p className="mt-1 max-w-2xl text-sm text-[#718087]">A truthful view of this store’s edge state. Delivery is at-least-once and only a durable remote receipt closes an outbound event.</p></div>
      <button type="button" onClick={() => void sync.refetch()} disabled={sync.isFetching} className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#263f44]/15 bg-white px-3 py-2 text-sm font-semibold text-[#315d57] disabled:opacity-60"><RefreshCw className={sync.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />Refresh</button>
    </div>

    <MarketplaceAccountPanel canManage={canManage} />

    <section className={`rounded-[22px] border p-5 md:p-6 ${connected && !issueCount ? 'border-[#39786f]/20 bg-[#f3faf6]' : connected ? 'border-[#d89b4b]/30 bg-[#fff8e8]' : 'border-[#263f44]/10 bg-white'}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-3"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${connected && !issueCount ? 'bg-[#dcefe5] text-[#2e6a60]' : connected ? 'bg-[#ffedc8] text-[#9a6518]' : 'bg-[#eef2f0] text-[#6c7e80]'}`}>{connected ? (issueCount ? <ShieldAlert className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />) : <WifiOff className="h-5 w-5" />}</span><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#4d8982]">Edge event ledger</p><h2 className="mt-1 font-serif text-2xl text-[#17353c]">{connected ? (issueCount ? 'Device registered · needs attention' : 'Device registered · local ledger ready') : 'Local event ledger only'}</h2><p className="mt-1 text-sm text-[#617178]">This is the device-level outbox/inbox ledger, which is separate from the marketplace account above. It has no live control-plane transport yet, so its queues stay local; marketplace orders and decisions flow through the connected account instead.</p></div></div><span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${connected ? statusTone(data.device?.status || '') : 'bg-[#eef2f0] text-[#617178]'}`}><Cloud className="h-3.5 w-3.5" />{connected ? data.device?.status : 'Not configured'}</span></div>
    </section>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label="Pending push" value={data.outbox.pending} hint="Awaiting relay" icon={Cloud} tone={data.outbox.pending ? 'warn' : 'ok'} />
      <Metric label="Retry queue" value={data.outbox.retry} hint="Backoff scheduled" icon={RefreshCw} tone={data.outbox.retry ? 'warn' : 'ok'} />
      <Metric label="Dead letters" value={data.outbox.deadLetter} hint="Manual review required" icon={ShieldAlert} tone={data.outbox.deadLetter ? 'bad' : 'ok'} />
      <Metric label="Conflicts" value={data.inbox.conflicts} hint="Version / target review" icon={ShieldAlert} tone={data.inbox.conflicts ? 'bad' : 'ok'} />
      <Metric label="Held / failed" value={data.inbox.held + data.inbox.failed} hint="Inbound events" icon={AlertTriangle} tone={data.inbox.held + data.inbox.failed ? 'bad' : 'ok'} />
      <Metric label="Online orders" value={data.onlineOrders} hint="Store projection" icon={Database} tone="neutral" />
    </section>

    <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
      <section className="rounded-[22px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)] md:p-6"><div className="flex items-center gap-2"><Server className="h-5 w-5 text-[#3a7d78]" /><h2 className="font-serif text-2xl text-[#17353c]">Device identity</h2></div><dl className="mt-5 space-y-3 text-sm"><Row label="Device ID" value={data.device?.id || 'Not registered'} mono /><Row label="Vendor" value={data.device?.vendorId || 'Not configured'} /><Row label="Store" value={data.device?.storeId || 'Not configured'} /><Row label="Station" value={data.device?.station || 'Not assigned'} /><Row label="Credential state" value={data.device?.rotationRequired ? 'Rotation required' : data.device ? 'Credential reference present' : 'Not configured'} /></dl><div className="mt-5 flex flex-wrap gap-2"><Link to="/laundry/settings" className="rounded-xl border border-[#39786f]/25 px-3 py-2 text-xs font-bold text-[#39786f]">Open store settings</Link><span className="inline-flex items-center gap-1.5 rounded-xl bg-[#f4f8f5] px-3 py-2 text-xs font-semibold text-[#617178]">Protocol v{data.version}</span></div></section>
      <section className="rounded-[22px] border border-[#263f44]/10 bg-[#fffdf8] p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)] md:p-6"><div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-[#3a7d78]" /><h2 className="font-serif text-2xl text-[#17353c]">Checkpoint & delivery ledger</h2></div>{data.checkpoint ? <><dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2"><Row label="Remote stream" value={data.checkpoint.remoteStream} /><Row label="Cursor" value={data.checkpoint.cursor || 'Not advanced'} mono /><Row label="Last push" value={when(data.checkpoint.lastPushAt)} /><Row label="Last pull" value={when(data.checkpoint.lastPullAt)} /><Row label="Last heartbeat" value={when(data.checkpoint.lastHeartbeatAt)} /><Row label="Clock offset" value={typeof data.checkpoint.serverTimeOffsetMs === 'number' ? `${data.checkpoint.serverTimeOffsetMs} ms` : 'Not recorded'} /></dl>{data.checkpoint.error ? <p className="mt-5 rounded-xl bg-[#fff3d8] p-3 text-xs font-semibold text-[#855815]"><strong>Relay state:</strong> {data.checkpoint.error}</p> : null}<p className="mt-5 text-xs text-[#819095]">Checkpoint updated {when(data.checkpoint.updatedAt)}.</p></> : <div className="mt-5 rounded-xl border border-dashed border-[#b7c8c1] bg-[#f8fbf8] p-5 text-sm text-[#617178]">No remote checkpoint has been recorded. This is expected for local standalone mode or before the first authenticated pull.</div>}</section>
    </div>

    <section className="overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]"><div className="border-b border-[#263f44]/10 bg-[#fafaf7] p-5"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#4d8982]">At-least-once ledger</p><h2 className="mt-1 font-serif text-2xl text-[#17353c]">Event state</h2><p className="mt-1 text-sm text-[#718087]">Events are retained through retry and dead-letter states; duplicates are safe to replay.</p></div><div className="grid divide-y divide-[#263f44]/8 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-5"><Ledger label="Pending" value={data.outbox.pending} detail="Waiting for delivery" /><Ledger label="In flight" value={data.outbox.inFlight} detail="Lease currently active" /><Ledger label="Acknowledged" value={data.outbox.acknowledged} detail="Remote receipt recorded" /><Ledger label="Inbound received" value={data.inbox.received} detail={`${data.inbox.held} held · ${data.inbox.failed} failed`} /><Ledger label="Conflicts" value={data.inbox.conflicts} detail="Version / target review" /></div></section>
  </div>
}

function Metric({ label, value, hint, icon: Icon, tone }: { label: string; value: number; hint: string; icon: typeof Cloud; tone: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const iconTone = tone === 'bad' ? 'text-rose-600 bg-rose-50' : tone === 'warn' ? 'text-[#a06a18] bg-[#fff3d8]' : tone === 'ok' ? 'text-[#39786f] bg-[#eaf3ef]' : 'text-[#617178] bg-[#eef2f0]'
  return <div className="rounded-[20px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)]"><span className={`grid h-9 w-9 place-items-center rounded-xl ${iconTone}`}><Icon className="h-4 w-4" /></span><p className="mt-4 text-[10px] font-bold uppercase tracking-[.13em] text-[#718087]">{label}</p><p className="mt-1 font-serif text-3xl tabular-nums text-[#17353c]">{value}</p><p className="mt-1 text-xs text-[#74848a]">{hint}</p></div>
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div><dt className="text-[10px] font-bold uppercase tracking-[.12em] text-[#819095]">{label}</dt><dd className={`mt-1 break-all font-semibold text-[#315d57] ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd></div> }
function Ledger({ label, value, detail }: { label: string; value: number; detail: string }) { return <div className="p-5"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#718087]">{label}</p><p className="mt-1 font-serif text-2xl tabular-nums text-[#17353c]">{value}</p><p className="mt-1 text-xs text-[#819095]">{detail}</p></div> }
