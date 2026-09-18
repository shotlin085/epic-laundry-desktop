import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Boxes, Check, CheckCircle2, CircleOff, Clock3, Cloud, IndianRupee, Package, Plus, RefreshCw, Send, Tag, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPatch, apiPost, operatorErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { canUseUi } from '@/components/laundry/LaundryShell'
import VisualEmptyState from '@/components/laundry/VisualEmptyState'

// Mirrors cloud-catalogue.ts's real response shape exactly — only ever
// populated from a real GET /shop-garment_rates call against the
// marketplace, never guessed locally.
type CatalogueItem = {
  id: string; garmentTypeId: string; name: string; sku?: string; categoryName?: string
  price?: number; salePrice?: number; costPrice?: number
  stockQuantity: number; lowStockThreshold: number; maxOrderQty: number
  isAvailable: boolean; isFeatured: boolean; approvalStatus: string; updatedAt: string
}
type CloudStatus = { configured: boolean; connected: boolean; remoteVendorName?: string; remoteVendorId?: string }

const formatINR = (value?: number) => value === undefined ? '—' : `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const timeLabel = (value?: string) => value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export default function LaundryMarketplaceCatalogue() {
  const client = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState('')

  const session = useQuery({ queryKey: ['auth-session'], queryFn: () => apiGet<{ user: { roles: string[] } | null }>('/auth/session') })
  const cloud = useQuery({ queryKey: ['marketplace-cloud-status'], queryFn: () => apiGet<CloudStatus>('/marketplace/cloud/status'), staleTime: 10_000 })
  const catalogue = useQuery({ queryKey: ['marketplace-cloud-catalogue'], queryFn: () => apiGet<CatalogueItem[]>('/marketplace/cloud/catalogue'), enabled: Boolean(cloud.data?.connected && cloud.data?.remoteVendorId), staleTime: 10_000 })

  const canEdit = canUseUi(session.data?.user?.roles, 'catalogue.read')
  const cloudReady = Boolean(cloud.data?.connected && cloud.data?.remoteVendorId)
  const cloudBlocker = !cloud.isLoading && !cloud.data?.configured ? 'Marketplace connector is not configured for this workspace.'
    : !cloud.isLoading && !cloud.data?.connected ? 'Connect this store to its marketplace account to see real pricing and stock.'
    : !cloud.isLoading && cloud.data?.connected && !cloud.data?.remoteVendorId ? 'Connected, but no vendor is linked to this account yet.'
    : undefined

  const items = catalogue.data || []
  const selected = items.find((item) => item.id === selectedId)
  useEffect(() => { if (!selectedId && items.length) setSelectedId(items[0].id) }, [items, selectedId])

  const available = items.filter((item) => item.isAvailable).length
  const lowStock = items.filter((item) => item.stockQuantity <= item.lowStockThreshold).length

  const invalidate = () => void client.invalidateQueries({ queryKey: ['marketplace-cloud-catalogue'] })

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => apiPatch<CatalogueItem>(`/marketplace/cloud/catalogue/${encodeURIComponent(id)}`, patch),
    onSuccess: () => { setNotice('Saved. The marketplace now reflects this price/availability.'); invalidate() },
  })
  const updateStock = useMutation({
    mutationFn: ({ id, stockQuantity }: { id: string; stockQuantity: number }) => apiPatch<CatalogueItem>(`/marketplace/cloud/catalogue/${encodeURIComponent(id)}/stock`, { stockQuantity }),
    onSuccess: () => { setNotice('Stock updated on the marketplace.'); invalidate() },
  })

  return <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#4d8982]">Marketplace edge · operator cockpit</p><h1 className="mt-1 font-serif text-3xl tracking-[-.02em] text-[#17353c]">Marketplace catalogue</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-[#718087]">Your real priced services on the marketplace — price, sale price, stock, and availability, read from and written straight back to the connected vendor account.</p></div>
      <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
        <button type="button" onClick={() => catalogue.refetch()} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#263f44]/15 bg-white px-3 text-xs font-bold text-[#315d57] shadow-sm"><RefreshCw className={cn('h-3.5 w-3.5', catalogue.isFetching && 'animate-spin')} />Refresh</button>
      </div>
    </header>

    <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={<Package />} label="Catalogue items" value={String(items.length)} accent="teal" />
      <Metric icon={<Check />} label="Available" value={String(available)} accent="blue" />
      <Metric icon={<Boxes />} label="Low stock" value={String(lowStock)} accent="amber" />
      <Metric icon={<Cloud />} label="Marketplace account" value={cloud.isError ? 'Unavailable' : cloudReady ? 'Connected' : cloud.data?.connected ? 'No vendor linked' : cloud.data?.configured ? 'Not connected' : 'Not configured'} accent={cloudReady ? 'teal' : cloud.data?.connected ? 'amber' : 'slate'} />
    </section>

    {cloudBlocker ? <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-[#263f44]/10 bg-[#eef2f0] px-3 py-2.5 text-xs font-semibold text-[#53676a]"><CircleOff className="h-3.5 w-3.5 shrink-0" /><span>{cloudBlocker}</span><Link to="/laundry/sync-status" className="underline decoration-[#39786f]/40 underline-offset-2 hover:text-[#2e6a60]">Open marketplace sync</Link></div> : null}
    {!session.isLoading && !canEdit ? <div className="mt-5 rounded-xl border border-[#263f44]/10 bg-[#edf3f0] px-3 py-2.5 text-xs font-semibold text-[#53676a]">Read-only view. An owner or counter operator with catalogue access can edit pricing here.</div> : null}
    {update.isError || updateStock.isError ? <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-[#fde9e6] px-3 py-2.5 text-sm text-[#a44036]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{operatorErrorMessage(update.error || updateStock.error, 'The catalogue update failed. Refresh and try again.')}</div> : null}
    {notice ? <div role="status" className="mt-4 rounded-xl bg-[#e8f3ee] px-3 py-2.5 text-xs font-semibold text-[#2e6a60]">{notice}</div> : null}

    <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.82fr)]">
      <section className="overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_10px_30px_rgba(37,48,43,.035)]" aria-label="Marketplace catalogue list">
        <div className="flex items-center justify-between border-b border-[#263f44]/8 px-4 py-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#718087]">Real marketplace services</p><p className="mt-0.5 text-sm font-semibold text-[#27454c]">{items.length} item{items.length === 1 ? '' : 's'}</p></div><Tag className="h-4 w-4 text-[#8b9a99]" /></div>
        <div className="divide-y divide-[#263f44]/8">
          {catalogue.isLoading && cloudReady ? <div className="p-10 text-center text-sm text-[#718087]">Loading the real catalogue…</div> : null}
          {!catalogue.isLoading && cloudReady ? items.map((item) => <CatalogueRow key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => setSelectedId(item.id)} />) : null}
          {!catalogue.isLoading && cloudReady && !items.length ? <VisualEmptyState kind="orders" compact title="No catalogue items yet" detail="Pricing configured on the marketplace for this vendor will appear here." /> : null}
          {!cloudReady ? <VisualEmptyState kind="orders" compact title="Not connected" detail="Connect this store to its marketplace account to see real pricing and stock." /> : null}
        </div>
      </section>

      <aside className="rounded-[22px] border border-[#173f46]/12 bg-[#173f46] text-[#f8faf5] shadow-[0_18px_42px_rgba(23,63,70,.16)]" aria-label="Catalogue item detail">
        {!selected ? <div className="grid min-h-[420px] place-items-center p-8 text-center"><Package className="h-8 w-8 text-[#8fb2a8]" /><p className="mt-3 font-serif text-xl">Select an item</p><p className="mt-1 max-w-xs text-sm leading-6 text-[#b3c8c1]">Pick a service to edit its real marketplace price, stock, and availability.</p></div> : <ItemDetail
          item={selected} canEdit={canEdit}
          onSaveFields={(patch) => update.mutate({ id: selected.id, patch })}
          onSaveStock={(stockQuantity) => updateStock.mutate({ id: selected.id, stockQuantity })}
          pending={update.isPending || updateStock.isPending}
        />}
      </aside>
    </div>

    {cloudReady ? <ServiceRequestSection canEdit={canEdit} /> : null}
  </div>
}

// ─── Request a new garment/service ─────────────────────────────────────
// A brand-new service goes through the same PENDING → admin approve/reject
// lifecycle a vendor application itself goes through (service_categories/
// vendor_services — the modern model; see cloud-vendor-services.ts's header
// for why this is a different real backend surface than the legacy
// shop-garment_rates catalogue above). Creating a service auto-seeds a
// zero-rate row for every garment type in that category on the real
// backend, so step 2 is filling in real prices for garments that already
// exist — never inventing a brand-new garment type from a text field.

type CloudCategory = { id: string; name: string; description: string; imageUrl?: string }
type CloudService = { id: string; name: string; description: string; categoryId: string; categoryName?: string; pricePerPiecePaise: number; isAvailable: boolean; approvalStatus: string; rejectionReason?: string }
type CloudServiceGarmentRate = { garmentTypeId: string; garmentName: string; unit: string; ratePaise: number; isAvailable: boolean }
type CloudServiceDetails = { categoryName: string; service: CloudService; garments: CloudServiceGarmentRate[] }

function statusBadge(status: string) {
  const normalized = (status || 'PENDING').toUpperCase()
  if (normalized === 'APPROVED') return <span className="inline-flex items-center gap-1 rounded-full bg-[#e7f4ef] px-2 py-1 text-[10px] font-bold text-[#2e6a60]"><CheckCircle2 className="h-3 w-3" />Approved</span>
  if (normalized === 'REJECTED') return <span className="inline-flex items-center gap-1 rounded-full bg-[#fde9e6] px-2 py-1 text-[10px] font-bold text-[#a44036]"><XCircle className="h-3 w-3" />Rejected</span>
  return <span className="inline-flex items-center gap-1 rounded-full bg-[#fff2d7] px-2 py-1 text-[10px] font-bold text-[#8b5c1b]"><Clock3 className="h-3 w-3" />Awaiting LNDRY approval</span>
}

function ServiceRequestSection({ canEdit }: { canEdit: boolean }) {
  const client = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [categoryId, setCategoryId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [draftServiceId, setDraftServiceId] = useState<string | undefined>(undefined)
  const [rates, setRates] = useState<Record<string, string>>({})

  const categories = useQuery({ queryKey: ['marketplace-cloud-service-categories'], queryFn: () => apiGet<CloudCategory[]>('/marketplace/cloud/service-categories') })
  const myServices = useQuery({ queryKey: ['marketplace-cloud-my-services'], queryFn: () => apiGet<CloudService[]>('/marketplace/cloud/my-services') })
  const draft = useQuery({
    queryKey: ['marketplace-cloud-service-details', draftServiceId],
    queryFn: () => apiGet<CloudServiceDetails>(`/marketplace/cloud/services/${encodeURIComponent(draftServiceId!)}`),
    enabled: Boolean(draftServiceId),
  })

  useEffect(() => {
    if (draft.data) {
      const next: Record<string, string> = {}
      for (const garment of draft.data.garments) next[garment.garmentTypeId] = garment.ratePaise ? String(garment.ratePaise / 100) : ''
      setRates(next)
    }
  }, [draft.data])

  const createDraft = useMutation({
    mutationFn: () => apiPost<CloudService>('/marketplace/cloud/services', {
      categoryId, name: name.trim(), description: description.trim(),
      pricePerPiecePaise: Math.round((Number(price) || 0) * 100),
    }),
    onSuccess: (created) => { setDraftServiceId(created.id); void client.invalidateQueries({ queryKey: ['marketplace-cloud-my-services'] }) },
  })

  const saveRates = useMutation({
    mutationFn: () => apiPost(`/marketplace/cloud/services/${encodeURIComponent(draftServiceId!)}/garment-rates/bulk`, {
      rates: Object.entries(rates).filter(([, value]) => value.trim() !== '').map(([garmentTypeId, value]) => ({ garmentTypeId, ratePaise: Math.round(Number(value) * 100) })),
    }),
    onSuccess: () => {
      setShowForm(false); setDraftServiceId(undefined); setCategoryId(''); setName(''); setDescription(''); setPrice(''); setRates({})
      void client.invalidateQueries({ queryKey: ['marketplace-cloud-my-services'] })
    },
  })

  const services = myServices.data || []

  return <section className="mt-6 overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_10px_30px_rgba(37,48,43,.035)]" aria-label="Request a new garment or service">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#263f44]/8 px-5 py-4">
      <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#718087]">New service · admin-reviewed, same as your vendor approval</p><h2 className="mt-0.5 font-serif text-xl text-[#27454c]">Request a new garment or service</h2></div>
      {canEdit && !showForm ? <button type="button" onClick={() => setShowForm(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#264a44] px-3.5 text-xs font-bold text-white"><Plus className="h-3.5 w-3.5" />New request</button> : null}
    </div>

    {showForm ? <div className="border-b border-[#263f44]/8 bg-[#fbfcf9] p-5">
      {!draftServiceId ? <form onSubmit={(event) => { event.preventDefault(); createDraft.mutate() }} className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.1em] text-[#718087]">Category</span>
          <select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="w-full rounded-xl border border-[#263f44]/15 bg-white px-3 py-2.5 text-sm">
            <option value="" disabled>Choose a category…</option>
            {(categories.data || []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.1em] text-[#718087]">Service name</span>
          <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Premium Silk Care" className="w-full rounded-xl border border-[#263f44]/15 bg-white px-3 py-2.5 text-sm" />
        </label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.1em] text-[#718087]">Description</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What makes this service different" className="w-full rounded-xl border border-[#263f44]/15 bg-white px-3 py-2.5 text-sm" />
        </label>
        <label className="block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.1em] text-[#718087]">Starting price (₹)</span>
          <input required type="number" min="0" step="1" value={price} onChange={(event) => setPrice(event.target.value)} className="w-full rounded-xl border border-[#263f44]/15 bg-white px-3 py-2.5 text-sm" />
        </label>
        {createDraft.isError ? <p role="alert" className="sm:col-span-2 rounded-xl bg-[#fde9e6] px-3 py-2 text-xs text-[#a44036]">{operatorErrorMessage(createDraft.error, 'Could not create the request. Try again.')}</p> : null}
        <div className="flex gap-2 sm:col-span-2">
          <button type="submit" disabled={createDraft.isPending} className="inline-flex items-center gap-2 rounded-xl bg-[#264a44] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60"><Send className="h-3.5 w-3.5" />{createDraft.isPending ? 'Creating…' : 'Continue to pricing'}</button>
          <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-[#263f44]/15 px-4 py-2.5 text-xs font-bold text-[#4f485e]">Cancel</button>
        </div>
      </form> : <div>
        <p className="text-sm text-[#53676a]">Set your real price for each garment under <strong>{draft.data?.categoryName || 'this category'}</strong>. Garments left blank stay at ₹0 until you fill them in later from here.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(draft.data?.garments || []).map((garment) => <label key={garment.garmentTypeId} className="flex items-center justify-between gap-3 rounded-xl border border-[#263f44]/10 bg-white px-3 py-2"><span className="text-xs font-semibold text-[#332b50]">{garment.garmentName} <span className="text-[#9aa3a2]">· {garment.unit}</span></span><span className="flex items-center gap-1 text-xs"><span className="text-[#718087]">₹</span><input type="number" min="0" step="1" value={rates[garment.garmentTypeId] || ''} onChange={(event) => setRates({ ...rates, [garment.garmentTypeId]: event.target.value })} className="w-20 rounded-lg border border-[#263f44]/15 px-2 py-1 text-right" /></span></label>)}
        </div>
        {saveRates.isError ? <p role="alert" className="mt-3 rounded-xl bg-[#fde9e6] px-3 py-2 text-xs text-[#a44036]">{operatorErrorMessage(saveRates.error, 'Could not save prices. Try again.')}</p> : null}
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={saveRates.isPending} onClick={() => saveRates.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-[#264a44] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60"><Send className="h-3.5 w-3.5" />{saveRates.isPending ? 'Submitting…' : 'Submit for LNDRY review'}</button>
          <button type="button" onClick={() => { setShowForm(false); setDraftServiceId(undefined) }} className="rounded-xl border border-[#263f44]/15 px-4 py-2.5 text-xs font-bold text-[#4f485e]">Do this later</button>
        </div>
      </div>}
    </div> : null}

    <div className="divide-y divide-[#263f44]/8">
      {myServices.isLoading ? <div className="p-8 text-center text-sm text-[#718087]">Loading your service requests…</div> : null}
      {!myServices.isLoading && !services.length ? <VisualEmptyState kind="orders" compact title="No service requests yet" detail="Services you request here will show up alongside your existing marketplace services." /> : null}
      {services.map((service) => <div key={service.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div><p className="font-bold text-[#27454c]">{service.name}</p><p className="text-xs text-[#718087]">{service.categoryName || 'Uncategorised'}</p>{service.approvalStatus === 'REJECTED' && service.rejectionReason ? <p className="mt-1 text-xs text-[#a44036]">{service.rejectionReason}</p> : null}</div>
        {statusBadge(service.approvalStatus)}
      </div>)}
    </div>
  </section>
}

function Metric({ icon, label, value, accent }: { icon?: React.ReactNode; label: string; value: string; accent: 'teal' | 'amber' | 'blue' | 'violet' | 'slate' }) {
  const colors = { teal: 'bg-[#e7f4ef] text-[#2e6a60]', amber: 'bg-[#fff2d7] text-[#8b5c1b]', blue: 'bg-[#e5f0fb] text-[#2c5f8a]', violet: 'bg-[#f1eaff] text-[#6844a6]', slate: 'bg-[#edf1f0] text-[#53676a]' } as const
  return <div className="rounded-2xl border border-[#263f44]/10 bg-white p-3.5"><div className="flex items-start justify-between gap-3"><span className={cn('grid h-8 w-8 place-items-center rounded-xl', colors[accent])}>{icon && <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>}</span><p className="text-right text-[10px] font-bold uppercase tracking-[.12em] text-[#879493]">{label}</p></div><p className="mt-3 text-xl font-bold tabular-nums text-[#27454c]">{value}</p></div>
}

function CatalogueRow({ item, selected, onSelect }: { item: CatalogueItem; selected: boolean; onSelect: () => void }) {
  const low = item.stockQuantity <= item.lowStockThreshold
  return <button type="button" onClick={onSelect} className={cn('group block w-full px-4 py-4 text-left transition-colors hover:bg-[#fbfcf9]', selected ? 'bg-[#eef6f1]' : 'bg-white')}>
    <div className="flex items-start gap-3">
      <span className={cn('mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full', !item.isAvailable ? 'bg-[#c45b50]' : low ? 'bg-[#e2a63e]' : 'bg-[#62a796]')} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[#27454c]">{item.name || 'Unnamed service'}</p>{item.categoryName ? <span className="rounded-full bg-[#f2f4f1] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-[#718087]">{item.categoryName}</span> : null}</div>
        <p className="mt-1 truncate text-xs text-[#718087]">{formatINR(item.price)}{item.salePrice !== undefined ? ` · sale ${formatINR(item.salePrice)}` : ''} · Stock {item.stockQuantity}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2"><span className={cn('rounded-full px-2 py-1 text-[10px] font-bold', item.isAvailable ? 'bg-[#e7f4ef] text-[#2e6a60]' : 'bg-[#fde9e6] text-[#a44036]')}>{item.isAvailable ? 'Available' : 'Unavailable'}</span></div>
    </div>
  </button>
}

function ItemDetail({ item, canEdit, onSaveFields, onSaveStock, pending }: { item: CatalogueItem; canEdit: boolean; onSaveFields: (patch: Record<string, unknown>) => void; onSaveStock: (stockQuantity: number) => void; pending: boolean }) {
  const [price, setPrice] = useState(String(item.price ?? ''))
  const [salePrice, setSalePrice] = useState(String(item.salePrice ?? ''))
  const [costPrice, setCostPrice] = useState(String(item.costPrice ?? ''))
  const [lowStockThreshold, setLowStockThreshold] = useState(String(item.lowStockThreshold))
  const [maxOrderQty, setMaxOrderQty] = useState(String(item.maxOrderQty))
  const [isAvailable, setIsAvailable] = useState(item.isAvailable)
  const [stockQuantity, setStockQuantity] = useState(String(item.stockQuantity))

  // Reset local edit state whenever a different item is selected, or this
  // item's own server values change after a save — otherwise a prior item's
  // half-typed edits would bleed into the next selection.
  useEffect(() => {
    setPrice(String(item.price ?? '')); setSalePrice(String(item.salePrice ?? '')); setCostPrice(String(item.costPrice ?? ''))
    setLowStockThreshold(String(item.lowStockThreshold)); setMaxOrderQty(String(item.maxOrderQty)); setIsAvailable(item.isAvailable)
    setStockQuantity(String(item.stockQuantity))
  }, [item.id, item.updatedAt])

  return <div className="space-y-4 p-4">
    <div><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#8fb2a8]"><Tag className="h-3.5 w-3.5" />{item.categoryName || 'Service'}</p><h2 className="mt-1 font-serif text-xl">{item.name || 'Unnamed service'}</h2>{item.sku ? <p className="mt-0.5 text-[10px] text-[#9fc0b5]">SKU {item.sku}</p> : null}<p className="mt-1 text-[10px] text-[#9fc0b5]">Updated {timeLabel(item.updatedAt)} · Approval {item.approvalStatus || 'unknown'}</p></div>

    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[.06] p-3.5">
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.13em] text-[#8fb2a8]"><IndianRupee className="h-3.5 w-3.5" />Pricing & availability</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Price" value={price} onChange={setPrice} disabled={!canEdit} />
        <Field label="Sale price" value={salePrice} onChange={setSalePrice} disabled={!canEdit} />
        <Field label="Cost price" value={costPrice} onChange={setCostPrice} disabled={!canEdit} />
        <Field label="Max order qty" value={maxOrderQty} onChange={setMaxOrderQty} disabled={!canEdit} />
      </div>
      <Field label="Low stock threshold" value={lowStockThreshold} onChange={setLowStockThreshold} disabled={!canEdit} />
      <label className="flex items-center gap-2 text-xs text-[#dcebe4]"><input type="checkbox" aria-label="Available on the marketplace" checked={isAvailable} onChange={(event) => setIsAvailable(event.target.checked)} disabled={!canEdit} className="h-3.5 w-3.5 rounded border-white/30 bg-white/10" />Available on the marketplace</label>
      <button type="button" disabled={!canEdit || pending} onClick={() => onSaveFields({
        price: price.trim() === '' ? undefined : Number(price),
        salePrice: salePrice.trim() === '' ? undefined : Number(salePrice),
        costPrice: costPrice.trim() === '' ? undefined : Number(costPrice),
        lowStockThreshold: lowStockThreshold.trim() === '' ? undefined : Number(lowStockThreshold),
        maxOrderQty: maxOrderQty.trim() === '' ? undefined : Number(maxOrderQty),
        isAvailable,
      })} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#a8ddc6] px-3 py-2.5 text-xs font-bold text-[#173f46] disabled:opacity-50"><Check className="h-3.5 w-3.5" />Save pricing & availability</button>
    </div>

    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[.06] p-3.5">
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.13em] text-[#8fb2a8]"><Boxes className="h-3.5 w-3.5" />Stock</p>
      <p className="text-[10px] leading-4 text-[#9fc0b5]">Stock is a separate, row-locked update on the marketplace — saved independently of pricing.</p>
      <Field label="Stock quantity" value={stockQuantity} onChange={setStockQuantity} disabled={!canEdit} />
      <button type="button" disabled={!canEdit || pending} onClick={() => onSaveStock(Number(stockQuantity) || 0)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-2.5 text-xs font-bold text-[#dcebe4] hover:bg-white/10 disabled:opacity-50"><Boxes className="h-3.5 w-3.5" />Save stock</button>
    </div>
  </div>
}

function Field({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  // Explicit aria-label rather than relying on the wrapping <label>+<span> to
  // supply an implicit accessible name — matches the convention already
  // established (and audited) in LaundryOnlineOrders.tsx's own number/date
  // inputs, not a new pattern invented here.
  return <label className="block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.1em] text-[#9fc0b5]">{label}</span><input type="number" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="w-full rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-xs text-white outline-none placeholder:text-[#a9c2ba] disabled:opacity-50" /></label>
}
