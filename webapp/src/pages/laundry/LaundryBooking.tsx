import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, CircleDollarSign, Download, Droplets, ImagePlus, Loader2, Minus, PackagePlus, Pause, PlayCircle, Plus, Printer, RotateCcw, Scissors, Search, Shirt, Sparkles, Tag, Truck, UserPlus, Wind, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet, apiPost, apiPostOffline, operatorErrorMessage } from '@/lib/api'
import { garmentVisuals, generatedVisualManifest } from '@/assets/generated/manifest'
import type { LaundryCatalogue, LaundryQuote } from '@/lib/laundry'
import { cn, formatINR, localDateKey } from '@/lib/utils'
import { buildLaundryPrintHtml, type PrintOrder, type PrintSettings } from '@/lib/laundryPrint'

type CartLine = { garment: string; service: string; qty: number }
type Customer = { id: string; name: string; phone: string; email?: string; address?: string }
type Receipt = { orderNumber: string; invoiceNumber?: string; customer: { name: string; phone: string }; orderDate: string; expectedDeliveryDate: string; fulfillmentMode: string; items: LaundryQuote['items']; subtotal: number; charges: number; discounts: number; taxAmount: number; grandTotal: number; paymentMode: string; paymentStatus: string }
type TagData = { tagNumber: string; containerId?: string; tagKind?: 'garment' | 'container'; orderNumber: string; customer: string; garment: string; service: string; sequence: number; total: number; orderDate: string; expectedDeliveryDate: string; weightKg?: number }
type BookingResult = { order?: { id: string; orderNumber: string }; receipt: Receipt; tags: TagData[]; containerTags?: TagData[] }
type BookingDraft = { cart: Record<string, CartLine>; customer: Customer | null; newCustomerName: string; newCustomerPhone: string; deliveryAddress: string; serviceZone: string; containerCount?: number; deliveryMode: 'Pickup Order' | 'Home Delivery' | 'Express Delivery'; expectedDeliveryDate: string; charges: number; discounts: number; taxRate: number; chargeRuleIds: string[]; discountRuleIds: string[]; taxRuleId: string; notes: string }
type HeldDraft = BookingDraft & { id: string; savedAt: string; paymentMode: 'Pay Later' | 'Cash' | 'UPI' | 'Card' | 'Bank'; paymentReference: string; serverHoldId?: string; holdCode?: string; ownership?: 'mine' | 'other' | 'expired' | 'unassigned' }
type ServerHold = { id: string; holdCode: string; status: 'Held' | 'Resumed' | 'Cancelled'; payload: HeldDraft; createdAt: string; ownership: 'mine' | 'other' | 'expired' | 'unassigned'; leaseExpiresAt?: string }
type HoldPresence = { leaseMinutes: number; totalHeld: number; mineActive: number; otherActive: number; expired: number; unassigned: number }
type RepeatOrder = { items: CartLine[]; fulfillmentMode?: 'Pickup Order' | 'Home Delivery' | 'Express Delivery'; serviceZone?: string; deliveryAddress?: string; notes?: string }
const DRAFT_KEY = 'epic-laundry-booking-draft-v1'
const HELD_DRAFTS_KEY = 'epic-laundry-held-drafts-v1'

function ServiceIcon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const normalized = name.toLowerCase()
  const Icon = normalized.includes('iron') || normalized.includes('press') ? Wind
    : normalized.includes('wash') || normalized.includes('fold') ? Droplets
      : normalized.includes('dry') || normalized.includes('clean') ? Sparkles
        : normalized.includes('shoe') || normalized.includes('repair') ? Zap
          : normalized.includes('stain') || normalized.includes('special') ? Shirt
            : Scissors
  return <Icon className={className} aria-hidden="true" />
}

function ServiceVisual({ name, compact = false }: { name: string; compact?: boolean }) {
  const normalized = name.toLowerCase()
  const src = normalized.includes('iron') || normalized.includes('press')
    ? generatedVisualManifest.services.steamPress
    : normalized.includes('shoe') || normalized.includes('repair')
      ? generatedVisualManifest.services.shoeCare
      : normalized.includes('dry') || normalized.includes('clean')
        ? generatedVisualManifest.services.dryClean
        : generatedVisualManifest.services.washFold
  return <span aria-hidden="true" className={cn('grid shrink-0 place-items-center overflow-hidden bg-[#eeeaff] shadow-[inset_0_0_0_1px_rgba(102,76,240,.12)]', compact ? 'h-9 w-9 rounded-xl' : 'h-14 w-14 rounded-2xl')}><img src={src} alt="" className="h-full w-full object-contain p-0.5" /></span>
}

function CategoryVisual({ name }: { name: string }) {
  const normalized = name.toLowerCase()
  const src = normalized.includes('men') ? garmentVisuals.foldedShirt
    : normalized.includes('women') ? garmentVisuals.foldedKurti
      : normalized.includes('house') || normalized.includes('linen') ? garmentVisuals.foldedBedsheet
        : normalized.includes('access') || normalized.includes('shoe') ? garmentVisuals.handbag
          : normalized.includes('winter') ? garmentVisuals.foldedBlanket
            : garmentVisuals.mixedClothes
  return <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/80"><img src={src} alt="" className="h-full w-full object-contain p-0.5" /></span>
}

export default function LaundryBooking() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [cart, setCart] = useState<Record<string, CartLine>>({})
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [serviceZone, setServiceZone] = useState('')
  const [containerCount, setContainerCount] = useState('')
  const [photoPath, setPhotoPath] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [category, setCategory] = useState('all')
  const [service, setService] = useState('all')
  const [garmentSearch, setGarmentSearch] = useState('')
  const [deliveryMode, setDeliveryMode] = useState<'Pickup Order' | 'Home Delivery' | 'Express Delivery'>('Home Delivery')
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(defaultDeliveryDate())
  const [paymentMode, setPaymentMode] = useState<'Pay Later' | 'Cash' | 'UPI' | 'Card' | 'Bank'>('Pay Later')
  const [cashRegister, setCashRegister] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [charges, setCharges] = useState(0)
  const [discounts, setDiscounts] = useState(0)
  const [taxRate, setTaxRate] = useState(0)
  const [chargeRuleIds, setChargeRuleIds] = useState<string[]>([])
  const [discountRuleIds, setDiscountRuleIds] = useState<string[]>([])
  const [taxRuleId, setTaxRuleId] = useState('')
  const [taxDefaultInitialized, setTaxDefaultInitialized] = useState(false)
  const [notes, setNotes] = useState('')
  const [receipt, setReceipt] = useState<BookingResult | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const [heldDrafts, setHeldDrafts] = useState<HeldDraft[]>([])
  const [repeatPending, setRepeatPending] = useState(false)
  const [repeatNotice, setRepeatNotice] = useState('')
  // ── LNDRY wallet redemption at the counter ──────────────────────────────
  const [walletEnabled, setWalletEnabled] = useState(false)
  const [walletRequest, setWalletRequest] = useState<{ requestId: string; expiresAt: string } | null>(null)
  const [walletConfirmed, setWalletConfirmed] = useState<{ requestId: string; amountPaise: number } | null>(null)
  const [walletOtp, setWalletOtp] = useState('')
  const [walletError, setWalletError] = useState('')
  const cashShifts = useQuery({ queryKey: ['laundry-cash-shifts'], queryFn: () => apiGet<Array<{ id: string; status: string; register: string }>>('/laundry/cash-shifts'), enabled: paymentMode === 'Cash', retry: false })
  const printSettings = useQuery({ queryKey: ['laundry-booking-print-settings'], queryFn: () => apiGet<PrintSettings>('/laundry/print-settings'), retry: false })
  const serverHolds = useQuery({ queryKey: ['laundry-order-holds'], queryFn: () => apiGet<ServerHold[]>('/laundry/order-holds'), retry: false })
  const holdPresence = useQuery({ queryKey: ['laundry-order-hold-presence'], queryFn: () => apiGet<HoldPresence>('/laundry/order-holds/presence'), retry: false, refetchInterval: 30_000 })
  const resumeServerHold = useMutation({ mutationFn: (id: string) => apiPost<ServerHold>(`/laundry/order-holds/${id}/resume`, {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['laundry-order-holds'] }) })
  const claimServerHold = useMutation({ mutationFn: (id: string) => apiPost<ServerHold>(`/laundry/order-holds/${id}/claim`, {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['laundry-order-holds'] }) })

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null') as Partial<BookingDraft> | null
      if (parsed) {
        if (parsed.cart && typeof parsed.cart === 'object') setCart(parsed.cart as Record<string, CartLine>)
        if (parsed.customer) setCustomer(parsed.customer)
        if (typeof parsed.newCustomerName === 'string') setNewCustomerName(parsed.newCustomerName)
        if (typeof parsed.newCustomerPhone === 'string') setNewCustomerPhone(parsed.newCustomerPhone)
        if (typeof parsed.deliveryAddress === 'string') setDeliveryAddress(parsed.deliveryAddress)
        if (typeof parsed.serviceZone === 'string') setServiceZone(parsed.serviceZone)
        if (typeof parsed.containerCount === 'number') setContainerCount(String(parsed.containerCount))
        if (parsed.deliveryMode) setDeliveryMode(parsed.deliveryMode)
        if (typeof parsed.expectedDeliveryDate === 'string') setExpectedDeliveryDate(parsed.expectedDeliveryDate)
        if (typeof parsed.charges === 'number') setCharges(parsed.charges)
        if (typeof parsed.discounts === 'number') setDiscounts(parsed.discounts)
        if (typeof parsed.taxRate === 'number') setTaxRate(parsed.taxRate)
        if (Array.isArray(parsed.chargeRuleIds)) setChargeRuleIds(parsed.chargeRuleIds)
        if (Array.isArray(parsed.discountRuleIds)) setDiscountRuleIds(parsed.discountRuleIds)
        if (typeof parsed.taxRuleId === 'string') setTaxRuleId(parsed.taxRuleId)
        if (typeof parsed.notes === 'string') setNotes(parsed.notes)
      }
    } catch { /* a corrupt draft is ignored and replaced by the next save */ }
    try {
      const held = JSON.parse(window.localStorage.getItem(HELD_DRAFTS_KEY) || '[]')
      if (Array.isArray(held)) setHeldDrafts(held.slice(0, 10) as HeldDraft[])
    } catch { /* corrupt held drafts are ignored */ }
    setDraftRestored(true)
  }, [])
  useEffect(() => {
    if (!draftRestored) return
    const draft: BookingDraft = { cart, customer, newCustomerName, newCustomerPhone, deliveryAddress, serviceZone, containerCount: containerCount === '' ? undefined : Number(containerCount), deliveryMode, expectedDeliveryDate, charges, discounts, taxRate, chargeRuleIds, discountRuleIds, taxRuleId, notes }
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch { /* local storage is best effort */ }
  }, [draftRestored, cart, customer, newCustomerName, newCustomerPhone, deliveryAddress, serviceZone, containerCount, deliveryMode, expectedDeliveryDate, charges, discounts, taxRate, chargeRuleIds, discountRuleIds, taxRuleId, notes])
  useEffect(() => {
    if (!serverHolds.data) return
    const remote = serverHolds.data.filter((hold) => hold.status === 'Held').map((hold) => ({ ...hold.payload, id: `server-${hold.id}`, serverHoldId: hold.id, holdCode: hold.holdCode, savedAt: hold.createdAt, ownership: hold.ownership }))
    setHeldDrafts((previous) => {
      const local = previous.filter((item) => !item.serverHoldId)
      const next = [...remote, ...local].slice(0, 10)
      try { window.localStorage.setItem(HELD_DRAFTS_KEY, JSON.stringify(local.slice(0, 10))) } catch { /* best effort */ }
      return next
    })
  }, [serverHolds.data])

  const catalogueQuery = useQuery({ queryKey: ['laundry-catalogue'], queryFn: () => apiGet<LaundryCatalogue>('/laundry/catalogue') })
  const customerQuery = useQuery({ queryKey: ['laundry-customers', customerSearch], queryFn: () => apiGet<Customer[]>(`/laundry/customers?search=${encodeURIComponent(customerSearch)}`), enabled: customerSearch.trim().length >= 2 })
  // A local search only ever finds customers this desktop has already
  // saved — it can never find a real LNDRY App customer who's never
  // bought here before. This asks the real backend directly, so a phone
  // that's already a real account still resolves to a real person instead
  // of forcing a "new customer" walk-in re-entry every time.
  const searchDigits = customerSearch.replace(/\D/g, '')
  const remoteMatchQuery = useQuery({
    queryKey: ['laundry-customers-remote', searchDigits],
    queryFn: () => apiGet<{ match: { userId: string; name?: string; phone: string } | null }>(`/laundry/customers/remote-lookup?phone=${encodeURIComponent(searchDigits)}`),
    enabled: searchDigits.length >= 8,
  })
  const remoteMatch = remoteMatchQuery.data?.match && !(customerQuery.data || []).some((result) => result.phone.replace(/\D/g, '') === remoteMatchQuery.data!.match!.phone)
    ? remoteMatchQuery.data.match
    : null
  const adoptRemoteCustomer = useMutation({
    mutationFn: (match: { userId: string; name?: string; phone: string }) => apiPost<Customer>('/laundry/customers/adopt-remote', match),
    onSuccess: (created) => { setCustomer(created); setCustomerSearch(''); void queryClient.invalidateQueries({ queryKey: ['laundry-customers'] }) },
  })
  const items = useMemo(() => Object.values(cart), [cart])
  const quoteQuery = useQuery({
    queryKey: ['laundry-quote', JSON.stringify(items), customer?.id, charges, discounts, taxRate, chargeRuleIds, discountRuleIds, taxRuleId],
    queryFn: () => apiPost<LaundryQuote>('/laundry/quote', { items, customerId: customer?.id, charges, discounts, taxRate, chargeRuleIds, discountRuleIds, taxRuleId }),
    enabled: items.length > 0,
  })
  const runningTotalPaise = Math.round((quoteQuery.data?.grandTotal || 0) * 100)
  // Only a customer that resolved to (or was adopted as) a real LNDRY App
  // account has a real wallet to redeem from — a plain local walk-in never
  // does, and this lookup would just 404 for them, so it isn't attempted.
  const walletBalanceQuery = useQuery({
    queryKey: ['wallet-balance', customer?.phone],
    queryFn: () => apiPost<{ userId: string; name: string; balancePaise: number }>('/marketplace/cloud/wallet/lookup', { phone: customer!.phone }),
    enabled: Boolean(customer?.phone) && !walletConfirmed,
    retry: false,
  })
  const walletProposedPaise = Math.max(0, Math.min(walletBalanceQuery.data?.balancePaise || 0, runningTotalPaise))
  const createWalletRequest = useMutation({
    mutationFn: () => apiPost<{ requestId: string; expiresAt: string }>('/marketplace/cloud/wallet/redemption-requests', { customerUserId: walletBalanceQuery.data!.userId, amountPaise: walletProposedPaise }),
    onSuccess: (created) => { setWalletRequest(created); setWalletError('') },
    onError: (error: Error) => { setWalletError(operatorErrorMessage(error, 'Could not start a wallet redemption for this customer.')); setWalletEnabled(false) },
  })
  const confirmWalletRequest = useMutation({
    mutationFn: () => apiPost<{ requestId: string; amountPaise: number }>(`/marketplace/cloud/wallet/redemption-requests/${walletRequest!.requestId}/confirm`, { otp: walletOtp }),
    onSuccess: (confirmed) => { setWalletConfirmed(confirmed); setWalletRequest(null); setWalletOtp(''); setWalletError('') },
    onError: (error: Error) => setWalletError(operatorErrorMessage(error, 'That code did not match — ask the customer to check their app and try again.')),
  })
  const cancelWalletRequest = useMutation({
    mutationFn: () => apiPost(`/marketplace/cloud/wallet/redemption-requests/${walletRequest!.requestId}/cancel`, {}),
    onSuccess: () => { setWalletRequest(null); setWalletOtp(''); setWalletEnabled(false); setWalletError('') },
  })
  function toggleWallet(next: boolean) {
    setWalletEnabled(next)
    setWalletError('')
    if (next && walletBalanceQuery.data && walletProposedPaise > 0 && !walletRequest && !walletConfirmed) createWalletRequest.mutate()
    else if (!next && walletRequest) cancelWalletRequest.mutate()
  }
  function clearWalletRedemption() {
    if (walletRequest) cancelWalletRequest.mutate()
    setWalletEnabled(false); setWalletConfirmed(null); setWalletOtp(''); setWalletError('')
  }
  const booking = useMutation({
    mutationFn: () => apiPostOffline<BookingResult>('/laundry/orders', {
      customer: customer ? { id: customer.id, address: deliveryAddress || customer.address } : { name: newCustomerName, phone: newCustomerPhone, address: deliveryAddress },
      items, containerCount: containerCount === '' ? undefined : Number(containerCount), expectedDeliveryDate, fulfillmentMode: deliveryMode, serviceZone, cashRegister: paymentMode === 'Cash' ? cashRegister || undefined : undefined, paymentMode, paymentReference, charges, discounts, taxRate, chargeRuleIds, discountRuleIds, taxRuleId, notes, photoPaths: photoPath,
      walletRedemption: walletConfirmed ? { requestId: walletConfirmed.requestId, amountPaise: walletConfirmed.amountPaise } : undefined,
    }, 'laundry_order'),
    onSuccess: (result) => {
      setReceipt(result); setCart({}); setCustomer(null); setCustomerSearch(''); setNewCustomerName(''); setNewCustomerPhone(''); setDeliveryAddress(''); setServiceZone(''); setContainerCount(''); setPhotoPath(''); setPhotoError(''); setPaymentReference(''); setCashRegister(''); setPaymentMode('Pay Later'); setNotes(''); setChargeRuleIds([]); setDiscountRuleIds([]); setTaxRuleId('')
      setWalletEnabled(false); setWalletRequest(null); setWalletConfirmed(null); setWalletOtp(''); setWalletError('')
      try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      queryClient.invalidateQueries({ queryKey: ['laundry-dashboard'] }); queryClient.invalidateQueries({ queryKey: ['laundry-orders'] }); queryClient.invalidateQueries({ queryKey: ['laundry-customers'] })
      const action = printSettings.data?.afterBooking || 'ask'
      if (action === 'open-print-centre' && result.order?.id) navigate(`/laundry/print-centre?order=${encodeURIComponent(result.order.id)}`)
      if (action === 'auto-print' && (result.tags?.length || result.containerTags?.length)) void printBookingDocuments(result, result.tags?.length ? 'tags' : 'bag-tags')
    },
  })

  const catalogue = catalogueQuery.data
  useEffect(() => {
    if (taxDefaultInitialized || !draftRestored || !catalogue || printSettings.isLoading) return
    // GST is only defaulted after the store has positively opted into GST mode.
    // This keeps an unregistered store from accidentally charging tax.
    if (printSettings.data?.taxMode === 'gst' && !taxRuleId && taxRate === 0) {
      const standardLaundryGst = catalogue.taxRules.find((rule) => rule.rate === 18 && /laundry|9997/i.test(rule.name))
      if (standardLaundryGst) setTaxRuleId(standardLaundryGst.id)
      else setTaxRate(18)
    }
    setTaxDefaultInitialized(true)
  }, [catalogue, draftRestored, printSettings.data?.taxMode, printSettings.isLoading, taxDefaultInitialized, taxRate, taxRuleId])
  const garmentById = useMemo(() => new Map((catalogue?.garments || []).map((item) => [item.id, item])), [catalogue])
  const hasBulkItems = useMemo(() => items.some((item) => !['Piece', 'Pair'].includes(garmentById.get(item.garment)?.unit || 'Piece')), [items, garmentById])
  useEffect(() => { if (!hasBulkItems && containerCount !== '') setContainerCount('') }, [hasBulkItems, containerCount])
  const visiblePrices = useMemo(() => (catalogue?.prices || []).filter((price) => {
    const garment = garmentById.get(price.garment)
    return garment && (category === 'all' || garment.category === category) && (service === 'all' || price.service === service) && `${price.garmentName} ${price.serviceName}`.toLowerCase().includes(garmentSearch.trim().toLowerCase())
  }), [catalogue, garmentById, category, service, garmentSearch])

  function adjustLine(garment: string, serviceId: string, change: number) {
    const key = `${garment}:${serviceId}`
    setCart((previous) => {
      const next = { ...previous }; const line = next[key]
      const unit = garmentById.get(garment)?.unit || 'Piece'; const step = unit === 'Kilogram' ? 0.1 : unit === 'Square Foot' ? 0.25 : 1
      const qty = Math.round(((line?.qty || 0) + change * step) * 1000) / 1000
      if (qty <= 0) delete next[key]; else next[key] = { garment, service: serviceId, qty }
      return next
    })
  }
  function setLineQuantity(garment: string, serviceId: string, value: string) {
    const key = `${garment}:${serviceId}`; const unit = garmentById.get(garment)?.unit || 'Piece'; const parsed = Number(value); if (!Number.isFinite(parsed) || parsed <= 0) return
    const qty = ['Piece', 'Pair'].includes(unit) ? Math.round(parsed) : Math.round(parsed * 1000) / 1000
    setCart((previous) => ({ ...previous, [key]: { garment, service: serviceId, qty } }))
  }

  function currentDraft(): BookingDraft {
    return { cart, customer, newCustomerName, newCustomerPhone, deliveryAddress, serviceZone, containerCount: containerCount === '' ? undefined : Number(containerCount), deliveryMode, expectedDeliveryDate, charges, discounts, taxRate, chargeRuleIds, discountRuleIds, taxRuleId, notes }
  }
  function clearCurrentDraft() {
    setCart({}); setCustomer(null); setCustomerSearch(''); setNewCustomerName(''); setNewCustomerPhone(''); setDeliveryAddress(''); setServiceZone(''); setContainerCount(''); setPhotoPath(''); setPhotoError(''); setPaymentReference(''); setPaymentMode('Pay Later'); setNotes(''); setChargeRuleIds([]); setDiscountRuleIds([]); setTaxRuleId('')
    try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* best effort */ }
  }
  async function holdCurrentDraft() {
    if (!items.length && !customer && !newCustomerName.trim()) return
    const held: HeldDraft = { ...currentDraft(), id: `hold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, savedAt: new Date().toISOString(), paymentMode, paymentReference }
    try {
      await apiPost<ServerHold>('/laundry/order-holds', held)
      await queryClient.invalidateQueries({ queryKey: ['laundry-order-holds'] })
    } catch {
      setHeldDrafts((previous) => { const next = [held, ...previous.filter((item) => !item.serverHoldId)].slice(0, 10); try { window.localStorage.setItem(HELD_DRAFTS_KEY, JSON.stringify(next)) } catch { /* best effort */ }; return next })
    }
    clearCurrentDraft()
  }
  async function resumeHeldDraft(held: HeldDraft) {
    let source = held
    if (held.serverHoldId) {
      try {
        if (held.ownership !== 'mine') await claimServerHold.mutateAsync(held.serverHoldId)
        const resumed = await resumeServerHold.mutateAsync(held.serverHoldId); source = { ...resumed.payload, ...held }
      } catch { return }
    }
    setCart(source.cart || {}); setCustomer(source.customer || null); setNewCustomerName(source.newCustomerName || ''); setNewCustomerPhone(source.newCustomerPhone || ''); setDeliveryAddress(source.deliveryAddress || ''); setServiceZone(source.serviceZone || ''); setContainerCount(source.containerCount === undefined ? '' : String(source.containerCount)); setDeliveryMode(source.deliveryMode || 'Home Delivery'); setExpectedDeliveryDate(source.expectedDeliveryDate || defaultDeliveryDate()); setCharges(source.charges || 0); setDiscounts(source.discounts || 0); setTaxRate(source.taxRate || 0); setChargeRuleIds(source.chargeRuleIds || []); setDiscountRuleIds(source.discountRuleIds || []); setTaxRuleId(source.taxRuleId || ''); setNotes(source.notes || ''); setPaymentMode(source.paymentMode || 'Pay Later'); setPaymentReference(source.paymentReference || '')
    setHeldDrafts((previous) => { const next = previous.filter((item) => item.id !== held.id); try { window.localStorage.setItem(HELD_DRAFTS_KEY, JSON.stringify(next.filter((item) => !item.serverHoldId))) } catch { /* best effort */ }; return next })
  }

  async function repeatLastOrder() {
    if (!customer) return
    setRepeatPending(true); setRepeatNotice('')
    try {
      const profile = await apiGet<{ orders: RepeatOrder[] }>(`/laundry/customers/${customer.id}`)
      const latest = profile.orders.find((order) => Array.isArray(order.items) && order.items.length > 0)
      if (!latest) { setRepeatNotice('No previous order is available for this customer.'); return }
      const available = new Set((catalogueQuery.data?.prices || []).map((price) => `${price.garment}:${price.service}`))
      const nextCart = Object.fromEntries(latest.items.filter((item) => available.has(`${item.garment}:${item.service}`) && Number(item.qty) > 0).map((item) => [`${item.garment}:${item.service}`, { garment: item.garment, service: item.service, qty: item.qty }]))
      if (!Object.keys(nextCart).length) { setRepeatNotice('The previous garments are no longer active in this branch catalogue.'); return }
      setCart(nextCart); if (latest.fulfillmentMode) setDeliveryMode(latest.fulfillmentMode); setServiceZone(latest.serviceZone || ''); setDeliveryAddress(latest.deliveryAddress || customer.address || ''); setNotes('')
      setRepeatNotice(`${Object.keys(nextCart).length} previous line${Object.keys(nextCart).length === 1 ? '' : 's'} restored. Review quantities and today’s delivery date before booking.`)
    } catch (error) { setRepeatNotice(error instanceof Error ? error.message : 'The previous order could not be loaded.') } finally { setRepeatPending(false) }
  }

  const canBook = items.length > 0 && expectedDeliveryDate && (customer || (newCustomerName.trim() && newCustomerPhone.trim())) && !booking.isPending
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key === 'Enter') {
        event.preventDefault()
        if (canBook) booking.mutate()
      } else if (event.shiftKey && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        void holdCurrentDraft()
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [canBook, booking, holdCurrentDraft])

  return <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">Counter desk · order & billing</p><h1 className="mt-0.5 font-display text-2xl font-semibold tracking-[-.035em] text-[#17353c]">Build the order visually.</h1></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => { setCart({}); setCustomer(null); setNewCustomerName(''); setNewCustomerPhone(''); setDeliveryAddress(''); setServiceZone(''); setNotes(''); clearWalletRedemption(); try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ } }} className="rounded-full border border-[#263f44]/15 bg-white px-3 py-1.5 text-xs font-semibold text-[#617178]">Clear draft</button><span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#3c796d]/20 bg-[#eaf3ef] px-3 py-1.5 text-xs font-semibold text-[#29635b]"><Check className="h-3.5 w-3.5" /> Server-calculated totals</span></div></div>

    {(items.length > 0 || heldDrafts.length > 0) && <section className="mb-3 rounded-2xl border border-[#d7c38e]/50 bg-[#fff8e8] px-4 py-2.5"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Pause className="h-4 w-4 text-[#9b6d1d]" /><div><p className="text-sm font-bold text-[#704f19]">Counter hold queue</p><p className="hidden text-xs text-[#8b7448] 2xl:block">Park an unfinished order for another customer without losing the work.</p></div></div><button type="button" title="Shortcut: Ctrl/Cmd+Shift+H" disabled={!items.length && !customer && !newCustomerName.trim()} onClick={holdCurrentDraft} className="inline-flex items-center gap-1.5 rounded-lg bg-[#e6bc65] px-3 py-2 text-xs font-bold text-[#17363e] disabled:cursor-not-allowed disabled:opacity-45"><Pause className="h-3.5 w-3.5" />Hold current order</button></div>{holdPresence.data && <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold text-[#6d5a2d]"><span className="rounded-full bg-white/70 px-2.5 py-1">{holdPresence.data.totalHeld} active hold{holdPresence.data.totalHeld === 1 ? '' : 's'}</span><span className="rounded-full bg-white/70 px-2.5 py-1">{holdPresence.data.mineActive} on this counter</span>{holdPresence.data.otherActive > 0 && <span className="rounded-full bg-white/70 px-2.5 py-1">{holdPresence.data.otherActive} on another counter</span>}{holdPresence.data.expired > 0 && <span className="rounded-full bg-[#fce8d8] px-2.5 py-1 text-[#9a4f27]">{holdPresence.data.expired} lease{holdPresence.data.expired === 1 ? '' : 's'} expired · reclaim safely</span>}</div>}{heldDrafts.length ? <div className="mt-2 flex flex-wrap gap-2">{heldDrafts.map((held) => <button type="button" key={held.id} onClick={() => resumeHeldDraft(held)} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-left text-xs font-semibold text-[#315d57] ring-1 ring-inset ring-[#c69e4c]/30 hover:bg-[#fffdf5]"><PlayCircle className="h-4 w-4 text-[#39786f]" /><span>{held.customer?.name || held.newCustomerName || 'Walk-in draft'} · {Object.values(held.cart || {}).reduce((sum, line) => sum + line.qty, 0)} item(s)<small className="ml-1 block text-[10px] font-normal text-[#8b7448]">{held.ownership === 'other' || held.ownership === 'expired' ? `${held.ownership === 'expired' ? 'Lease expired · ' : ''}Claim & resume · ` : held.ownership === 'mine' ? 'Owned by this counter · ' : ''}{new Date(held.savedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</small></span></button>)}</div> : null}</section>}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="xl:col-span-2 rounded-[22px] border border-[#263f44]/10 bg-white p-4 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
        <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#eaf3ef] text-[#39786f]"><UserPlus className="h-4 w-4" /></span><div><p className="font-semibold">Customer</p><p className="text-xs text-[#74848a]">Find or make one quickly</p></div></div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1.2fr_1fr]"><div>{customer ? <div className="rounded-xl bg-[#edf5f1] p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-[#1d4e49]">{customer.name}</p><p className="mt-0.5 text-xs text-[#52716c]">{customer.phone}</p></div><button type="button" onClick={() => { setCustomer(null); clearWalletRedemption() }} className="rounded-lg p-1 text-[#52716c] hover:bg-white" aria-label="Clear customer"><X className="h-4 w-4" /></button></div><button type="button" disabled={repeatPending} onClick={() => void repeatLastOrder()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#39786f]/25 bg-white px-3 py-2 text-xs font-bold text-[#2d6b63] disabled:opacity-60"><RotateCcw className={`h-3.5 w-3.5 ${repeatPending ? 'animate-spin' : ''}`} />{repeatPending ? 'Loading previous order…' : 'Repeat last order'}</button>{repeatNotice ? <p role="status" className="mt-2 text-[11px] leading-4 text-[#52716c]">{repeatNotice}</p> : null}
          {walletConfirmed ? <div className="mt-3 rounded-lg border border-[#438b82]/40 bg-white p-2.5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-[#1d4e49]">₹{(walletConfirmed.amountPaise / 100).toFixed(2)} applied from LNDRY Wallet</span><button type="button" onClick={clearWalletRedemption} className="text-[10px] font-semibold text-[#8a5a2a] hover:underline">Remove</button></div></div>
          : walletBalanceQuery.data && walletBalanceQuery.data.balancePaise > 0 ? <div className="mt-3 rounded-lg border border-[#263f44]/10 bg-white p-2.5">
            <div className="flex items-center justify-between gap-2"><span className="text-xs text-[#52716c]">Wallet balance: <strong className="text-[#1d4e49]">₹{(walletBalanceQuery.data.balancePaise / 100).toFixed(2)}</strong></span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[10px] font-bold text-[#39786f]"><input type="checkbox" checked={walletEnabled} disabled={items.length === 0 || createWalletRequest.isPending} onChange={(event) => toggleWallet(event.target.checked)} className="h-3.5 w-3.5 accent-[#39786f]" />Use wallet</label>
            </div>
            {items.length === 0 && walletEnabled === false ? <p className="mt-1 text-[10px] text-[#8a959a]">Add an item first — the amount is capped by the order total.</p> : null}
            {createWalletRequest.isPending ? <p className="mt-2 text-[11px] text-[#52716c]">Sending a request to {customer.name}'s app…</p> : null}
            {walletRequest ? <div className="mt-2 space-y-1.5">
              <p className="text-[11px] leading-4 text-[#52716c]">₹{(walletProposedPaise / 100).toFixed(2)} requested — ask {customer.name} to open their LNDRY App Wallet and read out the code shown there.</p>
              <div className="flex items-center gap-1.5"><input value={walletOtp} onChange={(event) => setWalletOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" inputMode="numeric" maxLength={6} className="h-9 w-28 rounded-lg border border-[#263f44]/15 px-2.5 text-sm outline-none focus:border-[#438b82]" /><button type="button" disabled={walletOtp.length < 4 || confirmWalletRequest.isPending} onClick={() => confirmWalletRequest.mutate()} className="rounded-lg bg-[#123039] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{confirmWalletRequest.isPending ? 'Checking…' : 'Confirm'}</button><button type="button" onClick={() => cancelWalletRequest.mutate()} disabled={cancelWalletRequest.isPending} className="rounded-lg border border-[#263f44]/15 px-2.5 py-2 text-xs font-semibold text-[#617178]">Cancel</button></div>
              <WalletCountdown expiresAt={walletRequest.expiresAt} />
            </div> : null}
            {walletError ? <p role="alert" className="mt-2 text-[11px] text-rose-700">{walletError}</p> : null}
          </div> : null}
          </div> : <>
          <div className="relative mt-4"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7e8d90]" /><input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Search name or phone" className="h-10 w-full rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] pl-9 pr-3 text-sm outline-none transition focus:border-[#438b82] focus:ring-2 focus:ring-[#b9ded6]" /></div>
          {customerQuery.data && <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-[#263f44]/10 p-1">{customerQuery.data.map((result) => <button type="button" key={result.id} onClick={() => { setCustomer(result); setCustomerSearch('') }} className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-[#edf5f1]"><span className="block text-sm font-medium">{result.name}</span><span className="text-xs text-[#718087]">{result.phone}</span></button>)}</div>}
          {remoteMatch && <button type="button" disabled={adoptRemoteCustomer.isPending} onClick={() => adoptRemoteCustomer.mutate(remoteMatch)} className="mt-2 flex w-full items-center justify-between gap-2 rounded-xl border border-[#438b82]/40 bg-[#f2f9f7] px-3 py-2.5 text-left disabled:opacity-60"><span><span className="block text-sm font-medium text-[#1d4e49]">{remoteMatch.name || 'LNDRY App customer'}</span><span className="text-xs text-[#52716c]">{remoteMatch.phone} · has a real LNDRY App account, not yet saved here</span></span><span className="shrink-0 rounded-full bg-[#438b82] px-2.5 py-1 text-[10px] font-bold text-white">{adoptRemoteCustomer.isPending ? 'Linking…' : 'Use this customer'}</span></button>}
          <div className="mt-3 border-t border-dashed border-[#263f44]/15 pt-3"><p className="mb-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#648077]">New customer</p><div className="grid gap-2 sm:grid-cols-2"><input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} placeholder="Customer name" className="h-10 w-full rounded-xl border border-[#263f44]/15 px-3 text-sm outline-none focus:border-[#664cf0]" /><input value={newCustomerPhone} onChange={(event) => setNewCustomerPhone(event.target.value)} placeholder="Phone number" inputMode="tel" className="h-10 w-full rounded-xl border border-[#263f44]/15 px-3 text-sm outline-none focus:border-[#664cf0]" /></div></div>
        </>}</div>
        <div className="rounded-xl border border-dashed border-[#263f44]/15 p-3"><p className="mb-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#648077]">Fulfilment</p><div className="grid grid-cols-3 gap-1.5">{(['Pickup Order', 'Home Delivery', 'Express Delivery'] as const).map((mode) => <button type="button" key={mode} onClick={() => setDeliveryMode(mode)} className={cn('flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 text-center text-[11px] font-bold transition', deliveryMode === mode ? 'bg-[#664cf0] text-white shadow-[0_8px_18px_rgba(102,76,240,.2)]' : 'bg-[#f5f5f8] text-[#526368] hover:bg-[#eeeaff]')}><Truck className="h-4 w-4" /><span>{mode.replace(' Order', '').replace(' Delivery', '')}</span></button>)}</div>
          <label className="mt-3 block text-xs font-semibold text-[#617178]">Expected delivery<input type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-[#263f44]/15 bg-white px-2 text-sm outline-none focus:border-[#664cf0]" /></label></div>
        <div className="rounded-xl border border-dashed border-[#263f44]/15 p-3"><p className="mb-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#648077]">Route details</p><div className="space-y-2"><label className="block text-xs font-semibold text-[#617178]">Service zone<input value={serviceZone} onChange={(event) => setServiceZone(event.target.value.slice(0, 120))} placeholder="e.g. North • Downtown" className="mt-1.5 h-10 w-full rounded-xl border border-[#263f44]/15 bg-white px-3 text-sm outline-none focus:border-[#664cf0]" /></label><label className="block text-xs font-semibold text-[#617178]">Pickup / delivery address<input value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} placeholder="Address for pickup / delivery" className="mt-1.5 h-10 w-full rounded-xl border border-[#263f44]/15 bg-white px-3 text-sm font-normal outline-none focus:border-[#664cf0]" /></label></div></div></div>
      </section>

      <section className="xl:col-span-2 rounded-[22px] border border-[#263f44]/10 bg-white px-4 py-3 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
        <div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-[10px] font-bold uppercase tracking-[.16em] text-[#4d8982]">Care service</span><button type="button" onClick={() => setService('all')} className={cn('inline-flex h-12 items-center gap-2 rounded-2xl border px-3 text-left transition', service === 'all' ? 'border-[#664cf0] bg-[#f0edff] text-[#241a45] shadow-[0_8px_18px_rgba(102,76,240,.12)]' : 'border-[#263f44]/10 bg-[#fbfbf9] text-[#526368] hover:border-[#b6a8ff]')}><span className={cn('grid h-8 w-8 place-items-center rounded-xl', service === 'all' ? 'bg-[#241a45] text-white' : 'bg-[#e3ddff] text-[#664cf0]')}><PackagePlus className="h-4 w-4" /></span><span className="text-xs font-bold">All services</span></button>{(catalogue?.services || []).map((item) => <button type="button" key={item.id} onClick={() => setService(item.id)} className={cn('inline-flex h-12 items-center gap-2 rounded-2xl border px-2.5 text-left transition', service === item.id ? 'border-[#664cf0] bg-[#f0edff] text-[#241a45] shadow-[0_8px_18px_rgba(102,76,240,.12)]' : 'border-[#263f44]/10 bg-[#fbfbf9] text-[#526368] hover:border-[#b6a8ff]')}><ServiceVisual name={item.name} compact /><span className="max-w-28 truncate text-xs font-bold">{item.name}</span></button>)}</div>
      </section>

      <section className="min-w-0 rounded-[22px] border border-[#263f44]/10 bg-white p-4 shadow-[0_8px_28px_rgba(37,48,43,.04)] md:p-5">
        <div className="border-b border-[#263f44]/10 pb-4"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#4d8982]">2 · Garments</p><p className="mt-1 font-display text-xl font-semibold text-[#17353c]">Add what arrived.</p><p className="mt-1 text-xs text-[#74848a]">Visual cards make each article recognisable at a glance.</p></div><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#f0edff] text-[#664cf0]"><Shirt className="h-5 w-5" /></span></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => setCategory('all')} className={cn('inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition', category === 'all' ? 'border-[#664cf0] bg-[#664cf0] text-white shadow-[0_8px_18px_rgba(102,76,240,.18)]' : 'border-[#263f44]/10 bg-[#fbfbf9] text-[#526368] hover:border-[#b6a8ff]')}><CategoryVisual name="All" />All categories</button>{(catalogue?.categories || []).map((item) => <button type="button" key={item.id} onClick={() => setCategory(item.id)} className={cn('inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition', category === item.id ? 'border-[#664cf0] bg-[#664cf0] text-white shadow-[0_8px_18px_rgba(102,76,240,.18)]' : 'border-[#263f44]/10 bg-[#fbfbf9] text-[#526368] hover:border-[#b6a8ff]')}><CategoryVisual name={item.name} />{item.name}</button>)}</div><div className="mt-3 relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7e8d90]" /><input value={garmentSearch} onChange={(event) => setGarmentSearch(event.target.value)} placeholder="Search garment, category or service" className="h-11 w-full rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] pl-9 pr-3 text-sm outline-none focus:border-[#664cf0]" /></div></div>
        {catalogueQuery.isLoading ? <div className="grid h-72 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#664cf0]" /></div> : catalogueQuery.isError ? <p className="p-8 text-center text-rose-700">The laundry catalogue could not be loaded.</p> : <div className="mt-4 grid max-h-[650px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{visiblePrices.map((price) => { const garment = garmentById.get(price.garment)!; const line = cart[`${price.garment}:${price.service}`]; const visual = garment.photo || garmentVisuals[garment.visual_key as keyof typeof garmentVisuals] || ''; const bulk = !['Piece', 'Pair'].includes(garment.unit); const quantityStep = garment.unit === 'Kilogram' ? 0.1 : garment.unit === 'Square Foot' ? 0.25 : 1; return <article key={price.id} className={cn('group rounded-2xl border p-3 transition', line ? 'border-[#664cf0] bg-[#f4f1ff] shadow-[0_8px_20px_rgba(102,76,240,.1)]' : 'border-[#263f44]/10 bg-[#fcfcfa] hover:border-[#b6a8ff] hover:shadow-[0_8px_20px_rgba(102,76,240,.08)]')}><div className="flex items-start gap-2.5"><span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#f1effb]">{visual ? <img src={visual} alt={`${price.garmentName} visual`} loading="lazy" className="h-full w-full object-contain p-1" /> : <span className="font-display text-base font-bold text-[#664cf0]">{price.garmentName.slice(0, 1)}</span>}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-[#223b40]">{price.garmentName}</p><p className="mt-1 flex items-center gap-1 truncate text-[11px] text-[#718087]"><ServiceIcon name={price.serviceName} className="h-3 w-3 shrink-0 text-[#664cf0]" />{garment.categoryName}</p><p className="mt-1.5 text-xs font-semibold text-[#4c756e]">{formatINR(price.rate)} / {garment.unit.toLowerCase()}</p></div></div><div className="mt-3 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.13em] text-[#829092]">{garment.unit}</span>{line ? bulk ? <label className="flex items-center gap-1 text-[11px] font-semibold text-[#315d57]"><span className="sr-only">Quantity for {price.garmentName}</span><input type="number" min={quantityStep} step={quantityStep} value={line.qty} onChange={(event) => setLineQuantity(price.garment, price.service, event.target.value)} className="h-8 w-20 rounded-lg border border-[#664cf0]/25 bg-white px-2 text-right text-sm font-bold tabular-nums outline-none focus:border-[#664cf0]" aria-label={`Quantity of ${price.garmentName}`} /><span>{garment.unit}</span></label> : <div className="flex items-center gap-1 rounded-lg bg-white p-0.5 shadow-sm"><button onClick={() => adjustLine(price.garment, price.service, -1)} className="grid h-7 w-7 place-items-center rounded-md text-[#5d7274] hover:bg-[#eeeaff]" aria-label={`Decrease ${price.garmentName}`}><Minus className="h-3.5 w-3.5" /></button><span className="w-6 text-center text-sm font-bold tabular-nums">{line.qty}</span><button onClick={() => adjustLine(price.garment, price.service, 1)} className="grid h-7 w-7 place-items-center rounded-md bg-[#664cf0] text-white" aria-label={`Increase ${price.garmentName}`}><Plus className="h-3.5 w-3.5" /></button></div> : <button onClick={() => adjustLine(price.garment, price.service, 1)} className="rounded-lg bg-[#2d1f59] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#664cf0]">Add</button>}</div></article> })}{visiblePrices.length === 0 && <p className="col-span-full py-14 text-center text-sm text-[#718087]">No active price rules match these filters.</p>}</div>}
      </section>

      <section className="h-fit rounded-[22px] border border-[#263f44]/10 bg-[#fffdf8] p-3 shadow-[0_8px_28px_rgba(37,48,43,.05)] xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
        <div className="flex items-center justify-between gap-2"><div><p className="font-display text-base font-semibold text-[#17353c]">Order tray</p><p className="text-[11px] text-[#74848a]">{items.length} line{items.length === 1 ? '' : 's'} selected</p></div><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#eeeaff] text-[#664cf0]"><Tag className="h-4 w-4" /></span></div>
        <div className="mt-3 max-h-32 space-y-1.5 overflow-y-auto pr-1">{quoteQuery.data?.items.map((item) => <div key={`${item.garmentName}:${item.serviceName}`} className="rounded-xl bg-white px-2.5 py-2"><div className="flex justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-bold">{item.garmentName}</p><p className="truncate text-[10px] text-[#718087]">{item.qty} {item.unit.toLowerCase()} · {item.serviceName}</p></div><p className="shrink-0 text-xs font-bold tabular-nums">{formatINR(item.amount)}</p></div></div>)}{items.length === 0 && <div className="rounded-xl border border-dashed border-[#c7befa] bg-[#faf9ff] px-3 py-4 text-center"><PackagePlus className="mx-auto h-5 w-5 text-[#664cf0]" /><p className="mt-2 text-xs font-bold text-[#3d316e]">Start with a garment</p><p className="mt-1 text-[10px] leading-4 text-[#718087]">The catalogue stays front and centre.</p></div>}</div>
        {hasBulkItems ? <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#d7c38e]/60 bg-[#fff8e8] px-2.5 py-2"><PackagePlus className="h-4 w-4 shrink-0 text-[#9b6d1d]" /><label className="min-w-0 flex-1 text-[10px] font-bold text-[#704f19]">Container tags<input aria-label="Bag or container count" type="number" min="0" max="500" step="1" inputMode="numeric" value={containerCount} onChange={(event) => setContainerCount(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="0" className="mt-1 h-8 w-full rounded-lg border border-[#c69e4c]/35 bg-white px-2 text-sm font-semibold text-[#17353c] outline-none focus:border-[#9b6d1d]" /></label><span className="max-w-20 text-[9px] leading-3 text-[#8b7448]">Only for bulk or weight items</span></div> : null}
        <details className="group mt-3 rounded-xl border border-[#263f44]/10 bg-white"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-bold text-[#415c5e]"><span className="inline-flex items-center gap-1.5"><CircleDollarSign className="h-3.5 w-3.5 text-[#664cf0]" />Pricing, discount & GST</span><ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></summary><div className="border-t border-[#263f44]/8 px-3 pb-3 pt-2"><div className="space-y-1.5"><MoneyInput label="Additional charge" value={charges} onChange={setCharges} /><MoneyInput label="Discount" value={discounts} onChange={setDiscounts} /><MoneyInput label="Manual tax rate (%)" value={taxRate} onChange={setTaxRate} disabled={Boolean(taxRuleId)} /></div><ConfiguredRules catalogue={catalogue} chargeRuleIds={chargeRuleIds} discountRuleIds={discountRuleIds} taxRuleId={taxRuleId} onChargeChange={setChargeRuleIds} onDiscountChange={setDiscountRuleIds} onTaxChange={setTaxRuleId} /><p className={cn('mt-2 rounded-lg border px-2 py-1.5 text-[10px] leading-4', printSettings.data?.taxMode === 'gst' ? 'border-[#d9cffc] bg-[#f6f3ff] text-[#51437f]' : 'border-[#e6d5a8] bg-[#fff9ed] text-[#765b25]')}>{printSettings.data?.taxMode === 'gst' ? 'GST uses the named 18% SAC 9997 rule.' : 'GST is not enabled for this store.'}</p></div></details>
        <details className="group mt-2 rounded-xl border border-[#263f44]/10 bg-white"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-bold text-[#415c5e]"><span className="inline-flex items-center gap-1.5"><ImagePlus className="h-3.5 w-3.5 text-[#39786f]" />Notes & photo</span><ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></summary><div className="border-t border-[#263f44]/8 px-3 pb-3 pt-2"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Order notes (optional)" className="min-h-16 w-full rounded-lg border border-[#263f44]/15 bg-white p-2 text-xs outline-none focus:border-[#438b82]" /><label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#79a59b] bg-[#f5faf6] px-2 py-2 text-[10px] font-semibold text-[#39786f] hover:bg-[#edf6f0]"><ImagePlus className="h-3.5 w-3.5" />{photoPath ? 'Garment photo attached' : 'Attach garment photo'}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 1_000_000) { setPhotoError('Choose an image under 1 MB.'); setPhotoPath(''); return } const reader = new FileReader(); reader.onload = () => { setPhotoPath(String(reader.result || '')); setPhotoError('') }; reader.readAsDataURL(file) }} /></label>{photoError && <p className="mt-1 text-[10px] text-rose-700">{photoError}</p>}</div></details>
        <div className="mt-3 rounded-xl bg-[#123039] p-3 text-[#edf3ec]"><div className="flex justify-between text-[11px] text-[#c4d7d0]"><span>Sub total</span><span>{formatINR(quoteQuery.data?.subtotal || 0)}</span></div><div className="mt-1 flex justify-between text-[11px] text-[#c4d7d0]"><span>Adjustment</span><span>{formatINR((quoteQuery.data?.charges || 0) - (quoteQuery.data?.discounts || 0) + (quoteQuery.data?.taxAmount || 0))}</span></div>{walletConfirmed ? <div className="mt-1 flex justify-between text-[11px] text-[#a9dcd2]"><span>LNDRY Wallet applied</span><span>−{formatINR(walletConfirmed.amountPaise / 100)}</span></div> : null}<div className="mt-2 flex items-end justify-between border-t border-white/15 pt-2"><span className="font-serif text-base">Grand total</span><span className="font-serif text-xl tabular-nums text-[#f1ca75]">{formatINR(quoteQuery.data?.grandTotal || 0)}</span></div>{walletConfirmed ? <div className="mt-1 flex justify-between text-xs text-[#edf3ec]"><span>Due via {paymentMode}</span><span className="font-bold tabular-nums">{formatINR(Math.max(0, (quoteQuery.data?.grandTotal || 0) - walletConfirmed.amountPaise / 100))}</span></div> : null}</div>
        <div className="mt-3"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-[#648077]">Payment</p><div className="grid grid-cols-5 gap-1">{(['Pay Later', 'Cash', 'UPI', 'Card', 'Bank'] as const).map((mode) => <button key={mode} title={mode} onClick={() => setPaymentMode(mode)} className={cn('rounded-lg px-1 py-2 text-[10px] font-bold transition', paymentMode === mode ? 'bg-[#e6bc65] text-[#17363e]' : 'bg-white text-[#617178] ring-1 ring-inset ring-[#263f44]/10 hover:bg-[#f2f4ee]')}>{mode === 'Pay Later' ? 'Later' : mode}</button>)}</div>{paymentMode === 'Cash' && cashShifts.data?.filter((shift) => shift.status === 'Open').length ? <label className="mt-2 block text-[10px] font-semibold text-[#617178]">Cash register<select value={cashRegister} onChange={(event) => setCashRegister(event.target.value)} className="mt-1 h-8 w-full rounded-lg border border-[#263f44]/15 bg-white px-2 text-[10px] outline-none focus:border-[#438b82]"><option value="">{cashShifts.data.filter((shift) => shift.status === 'Open').length === 1 ? 'Main / only open register' : 'Choose an open register'}</option>{cashShifts.data.filter((shift) => shift.status === 'Open').map((shift) => <option key={shift.id} value={shift.register}>{shift.register}</option>)}</select></label> : null}{paymentMode !== 'Pay Later' && <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Payment reference (optional)" className="mt-2 h-8 w-full rounded-lg border border-[#263f44]/15 bg-white px-2 text-[10px] outline-none focus:border-[#438b82]" />}</div>
        {booking.isError && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{booking.error instanceof Error ? booking.error.message : 'The order could not be booked.'}</p>}
        <button title="Shortcut: Ctrl/Cmd+Enter" disabled={!canBook} onClick={() => booking.mutate()} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#3a7d78] text-sm font-bold text-white shadow-[0_8px_16px_rgba(45,107,98,.2)] transition hover:bg-[#2d6863] disabled:cursor-not-allowed disabled:bg-[#a8b7b2]">{booking.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}{booking.isPending ? 'Booking order…' : 'Book order'}</button>
      </section>
    </div>
    {receipt && <ReceiptDialog result={receipt} onClose={() => setReceipt(null)} />}
  </div>
}

function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<{ id: string; name: string }> }) { return <label className="relative block"><select aria-label="Filter catalogue" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full appearance-none rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] px-3 pr-8 text-sm outline-none focus:border-[#438b82]"><>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</></select><ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-[#718087]" /></label> }
function MoneyInput({ label, value, onChange, disabled = false }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean }) { return <label className="flex items-center justify-between gap-3 text-sm"><span className="text-[#617178]">{label}</span><input aria-label={label} disabled={disabled} type="number" min="0" step="0.01" value={value || ''} onChange={(event) => onChange(Number(event.target.value) || 0)} className="h-8 w-24 rounded-lg border border-[#263f44]/15 bg-white px-2 text-right text-sm font-semibold outline-none focus:border-[#664cf0] disabled:cursor-not-allowed disabled:bg-[#f1eff8] disabled:text-[#7d7598]" /></label> }
/** Live "mm:ss remaining" for a pending wallet redemption request — purely
 * a display timer, the real expiry is enforced server-side on confirm. */
function WalletCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - now)
  const label = remainingMs <= 0 ? 'Expired — cancel and start again' : `Expires in ${String(Math.floor(remainingMs / 60000)).padStart(1, '0')}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`
  return <p className={cn('text-[10px] font-semibold', remainingMs <= 0 ? 'text-rose-700' : 'text-[#8a959a]')}>{label}</p>
}
function ConfiguredRules({ catalogue, chargeRuleIds, discountRuleIds, taxRuleId, onChargeChange, onDiscountChange, onTaxChange }: { catalogue?: LaundryCatalogue; chargeRuleIds: string[]; discountRuleIds: string[]; taxRuleId: string; onChargeChange: (value: string[]) => void; onDiscountChange: (value: string[]) => void; onTaxChange: (value: string) => void }) { if (!catalogue || (!catalogue.chargeRules.length && !catalogue.discountRules.length && !catalogue.taxRules.length)) return null; return <section className="mt-4 rounded-xl border border-[#4d8982]/15 bg-[#f4f8f5] p-3"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#527a71]">Configured rules</p><p className="mt-1 text-xs text-[#718087]">Selected rules are calculated on the local server and recorded with the quote.</p><RuleChoices label="Charges" rows={catalogue.chargeRules} selected={chargeRuleIds} onChange={onChargeChange} /><RuleChoices label="Discounts" rows={catalogue.discountRules} selected={discountRuleIds} onChange={onDiscountChange} /><label className="mt-3 block text-xs font-semibold text-[#526368]">Tax rule<select value={taxRuleId} onChange={(event) => onTaxChange(event.target.value)} className="mt-1 w-full rounded-lg border border-[#263f44]/15 bg-white px-2 py-2 text-xs outline-none focus:border-[#438b82]"><option value="">Manual tax rate</option>{catalogue.taxRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name} · {rule.rate}%</option>)}</select></label></section> }
function RuleChoices({ label, rows, selected, onChange }: { label: string; rows: Array<{ id: string; name: string; type: 'Flat' | 'Percentage'; amount: number }>; selected: string[]; onChange: (value: string[]) => void }) { if (!rows.length) return null; return <fieldset className="mt-3"><legend className="text-xs font-semibold text-[#526368]">{label}</legend><div className="mt-1.5 space-y-1">{rows.map((rule) => <label key={rule.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-xs"><span className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(rule.id)} onChange={(event) => onChange(event.target.checked ? [...selected, rule.id] : selected.filter((id) => id !== rule.id))} className="accent-[#3a7d78]" />{rule.name}</span><span className="font-bold text-[#39786f]">{rule.type === 'Percentage' ? `${rule.amount}%` : formatINR(rule.amount)}</span></label>)}</div></fieldset> }
function ReceiptDialog({ result, onClose }: { result: BookingResult; onClose: () => void }) { const receipt = result.receipt; const tags = result.tags || []; const containerTags = result.containerTags || []; const [printNotice, setPrintNotice] = useState(''); async function handlePrint(kind: 'tags' | 'bag-tags' | 'receipt', pdf = false) { setPrintNotice(''); try { const outcome = await printBookingDocuments(result, kind, pdf); setPrintNotice(!outcome.ok ? 'Printing was cancelled or could not be started. No output was recorded as printed.' : !outcome.auditRecorded ? 'The document action completed, but print history could not be saved. Retry from Print Centre if needed.' : pdf ? 'PDF export completed and was recorded in print history.' : 'Print command accepted and recorded in print history. Confirm the physical output at the station.') } catch (error) { setPrintNotice(error instanceof Error ? error.message : 'The document could not be prepared. The order remains saved.') } } return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102b33]/55 p-4 backdrop-blur-sm"><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[24px] bg-[#fffdf8] p-5 shadow-2xl"><div className="flex justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">Order booked</p><h2 className="mt-1 font-serif text-2xl text-[#17353c]">{receipt.orderNumber}</h2></div><button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[#f0eee9]" aria-label="Close receipt"><X className="h-4 w-4" /></button></div><div className="mt-5 rounded-2xl border border-dashed border-[#8daaa0] bg-white p-4"><div className="flex justify-between text-sm"><span>{receipt.customer.name}</span><span>{receipt.customer.phone}</span></div><p className="mt-1 text-xs text-[#718087]">Invoice {receipt.invoiceNumber} · Delivery {receipt.expectedDeliveryDate}</p><div className="mt-4 space-y-2 border-y border-[#263f44]/10 py-3">{receipt.items.map((item) => <div key={`${item.garmentName}:${item.serviceName}`} className="flex justify-between text-sm"><span>{item.garmentName} × {item.qty}</span><span>{formatINR(item.amount)}</span></div>)}</div><div className="mt-3 flex justify-between font-serif text-xl"><span>Total</span><span>{formatINR(receipt.grandTotal)}</span></div><p className="mt-2 text-xs text-[#718087]">{receipt.paymentStatus} · {receipt.paymentMode}</p></div><div className="mt-5"><p className="text-xs font-bold uppercase tracking-[.15em] text-[#648077]">Garment tags ({tags.length})</p><div className="mt-2 grid grid-cols-2 gap-2">{tags.map((tag) => <div key={tag.tagNumber} className="rounded-xl border border-[#263f44]/10 bg-white p-2.5 text-xs"><p className="font-bold text-[#225861]">{tag.tagNumber} <span className="font-normal text-[#718087]">({tag.sequence} / {tag.total})</span></p><p className="mt-1 font-medium">{tag.garment}</p><p className="text-[#718087]">{tag.service} · Due {tag.expectedDeliveryDate}</p><p className="text-[10px] text-[#91a09f]">Order date {tag.orderDate}</p></div>)}</div>{containerTags.length ? <><p className="mt-5 text-xs font-bold uppercase tracking-[.15em] text-[#648077]">Bag / container tags ({containerTags.length})</p><div className="mt-2 grid grid-cols-2 gap-2">{containerTags.map((tag) => <div key={tag.tagNumber} className="rounded-xl border border-[#d7c38e]/60 bg-[#fff8e8] p-2.5 text-xs"><p className="font-bold text-[#704f19]">{tag.tagNumber} <span className="font-normal text-[#8b7448]">({tag.sequence} / {tag.total})</span></p><p className="mt-1 font-medium">{tag.garment}</p><p className="text-[#8b7448]">{tag.service}</p></div>)}</div></> : null}</div>{printNotice ? <p role="status" className="mt-4 rounded-xl bg-[#eaf3ef] p-3 text-xs font-semibold text-[#2e6a60]">{printNotice}</p> : null}<div className="mt-5 grid gap-2 sm:grid-cols-2"><button disabled={!tags.length} onClick={() => void handlePrint('tags')} className="flex items-center justify-center gap-2 rounded-xl bg-[#123039] py-3 text-xs font-bold text-white disabled:opacity-40"><Printer className="h-4 w-4" />{tags.length ? `Print ${tags.length} garment tags` : 'No garment tags'}</button><button onClick={() => void handlePrint('receipt')} className="flex items-center justify-center gap-2 rounded-xl border border-[#123039]/15 bg-white py-3 text-xs font-bold text-[#17353c]"><Printer className="h-4 w-4" />Print invoice</button><button disabled={!containerTags.length} onClick={() => void handlePrint('bag-tags')} className="flex items-center justify-center gap-2 rounded-xl border border-[#d7c38e] bg-[#fff8e8] py-3 text-xs font-bold text-[#704f19] disabled:opacity-40"><Tag className="h-4 w-4" />{containerTags.length ? `Print ${containerTags.length} bag tags` : 'No bag tags'}</button><button disabled={!tags.length} onClick={() => void handlePrint('tags', true)} className="flex items-center justify-center gap-2 rounded-xl border border-[#123039]/15 bg-white py-3 text-xs font-bold text-[#17353c] disabled:opacity-40"><Download className="h-4 w-4" />Tags PDF</button></div></div></div> }

type PrintActionResult = { ok: boolean; auditRecorded: boolean }

async function printBookingDocuments(result: BookingResult, kind: 'tags' | 'bag-tags' | 'receipt' = 'tags', pdf = false): Promise<PrintActionResult> {
  const settings = await apiGet<PrintSettings>('/laundry/print-settings').catch(() => ({} as PrintSettings))
  const order: PrintOrder = { id: result.order?.id || result.receipt.orderNumber, orderNumber: result.receipt.orderNumber, invoiceNumber: result.receipt.invoiceNumber, customer: result.receipt.customer, expectedDeliveryDate: result.receipt.expectedDeliveryDate, fulfillmentMode: result.receipt.fulfillmentMode, receipt: result.receipt }
  const physicalTags = kind === 'bag-tags' ? result.containerTags || [] : result.tags
  const html = await buildLaundryPrintHtml(kind === 'receipt' ? 'receipt' : 'tags', order, settings, physicalTags)
  let ok = false
  if (pdf && window.epic?.exportHtmlPdf) ok = Boolean((await window.epic.exportHtmlPdf(html, `${result.receipt.orderNumber}-${kind}`)).ok)
  else if (!pdf && window.epic?.printHtml) ok = Boolean((await window.epic.printHtml(html)).ok)
  else { const popup = window.open('', '_blank', 'width=900,height=1100'); if (popup) { popup.document.write(html + '<script>window.onload=()=>window.print()<\/script>'); popup.document.close(); ok = true } }
  let auditRecorded = false
  try { await apiPost('/laundry/print-jobs', { orderId: result.order?.id || result.receipt.orderNumber, templateId: 'recommended-a4-6', templateVersion: '1', ...(kind === 'bag-tags' ? { containerIds: physicalTags.map((tag) => tag.containerId || tag.tagNumber) } : kind === 'tags' ? { tagIds: physicalTags.map((tag) => tag.tagNumber) } : {}), documentType: kind, requestedCopies: 1, status: ok ? (pdf ? 'Downloaded' : 'Printed') : 'Cancelled', evidence: ok ? (pdf ? 'Electron printToPDF completed' : 'Native print command accepted; physical output not independently verified') : 'Operator cancelled or print command failed' }); auditRecorded = true } catch { /* the booking itself is already committed; the caller reports the missing audit record */ }
  return { ok, auditRecorded }
}
function defaultDeliveryDate() { const date = new Date(); date.setDate(date.getDate() + 2); return localDateKey(date) }
