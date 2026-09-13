import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Boxes, Building2, Check, LogOut, ShieldCheck, Store } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiGet, apiPost, apiPut, operatorErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { canUseUi } from '@/components/laundry/LaundryShell'
import VisualEmptyState from '@/components/laundry/VisualEmptyState'

// Mirrors platform-session.ts's PlatformAdminConnectionStatus exactly.
type PlatformStatus = { configured: boolean; connected: boolean; email?: string; fullName?: string; isSuperAdmin?: boolean; permissions?: string[]; connectedAt?: string }
// Mirrors the real backend's sanitizeUser() row shape, confirmed live via
// GET /vendors/admin/list.
type PlatformVendor = { id: string; name: string; email?: string; phone?: string; is_active?: boolean; status?: string; created_at?: string; [key: string]: unknown }
// Confirmed live: GET /vendors/admin/:id/capacity returns `daily_limit`
// (plus weekly_availability/exceptions/requests) — NOT `max_orders_per_day`,
// which is only the PUT body's field name for the same value. Reading the
// wrong key here would silently show an always-empty capacity field.
type VendorCapacity = { daily_limit?: number | null; weekly_availability?: unknown[]; [key: string]: unknown }

export default function LaundryPlatformControl() {
  const client = useQueryClient()
  const session = useQuery({ queryKey: ['auth-session'], queryFn: () => apiGet<{ user: { roles: string[] } | null }>('/auth/session') })
  const canAccess = canUseUi(session.data?.user?.roles, 'settings.manage')

  const status = useQuery({ queryKey: ['platform-status'], queryFn: () => apiGet<PlatformStatus>('/platform/status'), enabled: canAccess, staleTime: 10_000 })
  const connected = Boolean(status.data?.connected)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')

  const connect = useMutation({
    mutationFn: () => apiPost<PlatformStatus>('/platform/connect', { email, password }),
    onSuccess: () => { setNotice('Connected to the real platform-admin account.'); setPassword(''); client.invalidateQueries({ queryKey: ['platform-status'] }) },
  })
  const disconnect = useMutation({
    mutationFn: () => apiPost<PlatformStatus>('/platform/disconnect'),
    onSuccess: () => { setNotice('Disconnected.'); client.invalidateQueries({ queryKey: ['platform-status'] }); client.invalidateQueries({ queryKey: ['platform-vendors'] }) },
  })

  const vendors = useQuery({ queryKey: ['platform-vendors'], queryFn: () => apiGet<{ items?: PlatformVendor[] } | PlatformVendor[]>('/platform/vendors'), enabled: canAccess && connected, staleTime: 10_000 })
  const vendorList: PlatformVendor[] = Array.isArray(vendors.data) ? vendors.data : (vendors.data?.items || [])
  const [selectedVendorId, setSelectedVendorId] = useState<string | undefined>(undefined)
  useEffect(() => { if (!selectedVendorId && vendorList.length) setSelectedVendorId(vendorList[0].id) }, [vendorList, selectedVendorId])
  const selectedVendor = vendorList.find((v) => v.id === selectedVendorId)

  const capacity = useQuery({
    queryKey: ['platform-vendor-capacity', selectedVendorId],
    queryFn: () => apiGet<VendorCapacity>(`/platform/vendors/${encodeURIComponent(selectedVendorId!)}/capacity`),
    enabled: canAccess && connected && Boolean(selectedVendorId),
  })

  if (!session.isLoading && !canAccess) {
    return <div className="animate-in fade-in duration-500">
      <VisualEmptyState kind="orders" title="Not available" detail="Platform Control is limited to store owners on this installation." />
    </div>
  }

  return <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
    <header>
      <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#4d8982]">Platform admin · super-admin cockpit</p>
      <h1 className="mt-1 font-serif text-3xl tracking-[-.02em] text-[#17353c]">Platform Control</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-[#718087]">Signs in as a real platform administrator against the LNDRY Cloud Backend — a separate identity from this store's own vendor connection. Visibility here spans every vendor, enforced server-side by the backend's own admin-only authorization, not just hidden navigation.</p>
    </header>

    {notice ? <div role="status" className="mt-4 rounded-xl bg-[#e8f3ee] px-3 py-2.5 text-xs font-semibold text-[#2e6a60]">{notice}</div> : null}
    {connect.isError || disconnect.isError ? <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-[#fde9e6] px-3 py-2.5 text-sm text-[#a44036]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{operatorErrorMessage(connect.error || disconnect.error, 'The platform sign-in failed. Check the email and password and try again.')}</div> : null}

    {!status.isLoading && !connected ? (
      <section className="mx-auto mt-8 max-w-md rounded-[22px] border border-[#263f44]/10 bg-white p-6 shadow-[0_10px_30px_rgba(37,48,43,.035)]">
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#8b9a99]"><ShieldCheck className="h-3.5 w-3.5" />Platform sign-in</p>
        <h2 className="mt-1 font-serif text-xl text-[#27454c]">Sign in as platform admin</h2>
        <p className="mt-1 text-xs leading-5 text-[#718087]">{status.data?.configured ? 'Uses the same marketplace connector configuration as this store\'s vendor connection.' : 'Marketplace connector is not configured for this workspace.'}</p>
        <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); connect.mutate() }}>
          <label className="block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.1em] text-[#8b9a99]">Email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-[#263f44]/15 px-3 py-2.5 text-sm outline-none" /></label>
          <label className="block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.1em] text-[#8b9a99]">Password</span><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-[#263f44]/15 px-3 py-2.5 text-sm outline-none" /></label>
          <button type="submit" disabled={!status.data?.configured || connect.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#173f46] px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"><ShieldCheck className="h-3.5 w-3.5" />{connect.isPending ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </section>
    ) : null}

    {connected ? <>
      <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#263f44]/10 bg-white p-4">
        <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e7f4ef] text-[#2e6a60]"><ShieldCheck className="h-4 w-4" /></span><div><p className="text-sm font-bold text-[#27454c]">{status.data?.fullName || status.data?.email}</p><p className="text-[11px] text-[#718087]">{status.data?.isSuperAdmin ? 'Super admin' : 'Platform admin'} · {status.data?.permissions?.length ?? 0} permissions</p></div></div>
        <button type="button" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} className="inline-flex items-center gap-2 rounded-xl border border-[#263f44]/15 bg-white px-3 py-2 text-xs font-bold text-[#a44036] disabled:opacity-50"><LogOut className="h-3.5 w-3.5" />Sign out</button>
      </section>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <section className="overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_10px_30px_rgba(37,48,43,.035)]" aria-label="Vendor directory">
          <div className="flex items-center justify-between border-b border-[#263f44]/8 px-4 py-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#718087]">Vendor directory</p><p className="mt-0.5 text-sm font-semibold text-[#27454c]">{vendorList.length} vendor{vendorList.length === 1 ? '' : 's'}</p></div><Building2 className="h-4 w-4 text-[#8b9a99]" /></div>
          <div className="divide-y divide-[#263f44]/8">
            {vendors.isLoading ? <div className="p-10 text-center text-sm text-[#718087]">Loading vendors…</div> : null}
            {!vendors.isLoading ? vendorList.map((vendor) => <button type="button" key={vendor.id} onClick={() => setSelectedVendorId(vendor.id)} className={cn('block w-full px-4 py-4 text-left transition-colors hover:bg-[#fbfcf9]', selectedVendorId === vendor.id ? 'bg-[#eef6f1]' : 'bg-white')}>
              <p className="font-bold text-[#27454c]">{vendor.name || 'Unnamed vendor'}</p>
              <p className="mt-1 truncate text-xs text-[#718087]">{vendor.email || vendor.phone || '—'}{vendor.status ? ` · ${vendor.status}` : ''}</p>
            </button>) : null}
            {!vendors.isLoading && !vendorList.length ? <VisualEmptyState kind="orders" compact title="No vendors" detail="No vendors were returned by the marketplace for this platform-admin account." /> : null}
          </div>
        </section>

        <aside className="rounded-[22px] border border-[#173f46]/12 bg-[#173f46] text-[#f8faf5] shadow-[0_18px_42px_rgba(23,63,70,.16)]" aria-label="Vendor capacity">
          {!selectedVendor ? <div className="grid min-h-[320px] place-items-center p-8 text-center"><Store className="h-8 w-8 text-[#8fb2a8]" /><p className="mt-3 font-serif text-xl">Select a vendor</p></div> : <VendorCapacityPanel vendor={selectedVendor} capacity={capacity.data} loading={capacity.isLoading} onSave={(maxOrdersPerDay) => apiPut(`/platform/vendors/${encodeURIComponent(selectedVendor.id)}/capacity`, { max_orders_per_day: maxOrdersPerDay }).then(() => client.invalidateQueries({ queryKey: ['platform-vendor-capacity', selectedVendor.id] }))} />}
        </aside>
      </div>
    </> : null}
  </div>
}

function VendorCapacityPanel({ vendor, capacity, loading, onSave }: { vendor: PlatformVendor; capacity?: VendorCapacity; loading: boolean; onSave: (maxOrdersPerDay: number) => Promise<unknown> }) {
  const [maxOrdersPerDay, setMaxOrdersPerDay] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setMaxOrdersPerDay(String(capacity?.daily_limit ?? '')) }, [capacity?.daily_limit, vendor.id])

  return <div className="space-y-4 p-4">
    <div><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#8fb2a8]"><Building2 className="h-3.5 w-3.5" />Vendor</p><h2 className="mt-1 font-serif text-xl">{vendor.name || 'Unnamed vendor'}</h2><p className="mt-0.5 text-[10px] text-[#9fc0b5]">{vendor.email || vendor.phone || '—'}</p></div>

    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[.06] p-3.5">
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.13em] text-[#8fb2a8]"><Boxes className="h-3.5 w-3.5" />Daily capacity</p>
      {loading ? <p className="text-xs text-[#b3c8c1]">Loading capacity…</p> : <>
        <label className="block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.1em] text-[#9fc0b5]">Max orders per day</span><input type="number" aria-label="Max orders per day" value={maxOrdersPerDay} onChange={(event) => setMaxOrdersPerDay(event.target.value)} className="w-full rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-white outline-none" /></label>
        {error ? <p className="text-[11px] text-[#f2b5ac]">{error}</p> : null}
        <button type="button" disabled={saving} onClick={() => {
          const value = Number(maxOrdersPerDay)
          if (!Number.isInteger(value) || value < 1) { setError('Enter a whole number of at least 1.'); return }
          setError(''); setSaving(true)
          onSave(value).catch((err) => setError(operatorErrorMessage(err, 'Could not save capacity.'))).finally(() => setSaving(false))
        }} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#a8ddc6] px-3 py-2.5 text-xs font-bold text-[#173f46] disabled:opacity-50"><Check className="h-3.5 w-3.5" />Save capacity</button>
      </>}
    </div>
  </div>
}
