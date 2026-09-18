import { useQuery } from '@tanstack/react-query'
import { Activity, BarChart3, CalendarDays, CircleDollarSign, Cloud, RefreshCw, Sparkles, UsersRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { lndryBrand } from '@/assets/generated/manifest'
import { apiGet } from '@/lib/api'
import VisualLoadingState from '@/components/laundry/VisualLoadingState'
import { cn, formatINR } from '@/lib/utils'
import VisualEmptyState from '@/components/laundry/VisualEmptyState'
import ChartAccessibility from '@/components/laundry/ChartAccessibility'

type Period = 'today' | 'week' | 'lifetime'
type Statistics = {
  period: Period; from: string; to: string
  ordersReview: { total: number; breakdown: Array<{ state: string; count: number }>; daily: Array<{ date: string; orders: number; amount: number }> }
  revenue: { total: number; averageOrderValue: number }
  collection: { total: number; daily: Array<{ date: string; amount: number }> }
  customerFrequency: { total: number; repeatCustomers: number; breakdown: Array<{ customer: string; visits: number }> }
  newCustomer: { total: number; daily: Array<{ date: string; count: number }> }
  serviceMix: Array<{ service: string; quantity: number; amount: number }>
  // Real mobile-app (marketplace) orders for this period — pre-finalization
  // estimates, deliberately kept separate from the counter-only figures
  // above, same split Dashboard already shows.
  online: { count: number; estimatedRevenue: number; topGarments: Array<{ name: string; quantity: number; amount: number }> }
}

// Overview is a brand surface, not a second teal application. Keep comparison
// colours deliberately related to the Lndry violet mark, with semantic colours
// reserved for actual success/warning/error states elsewhere in the product.
const palette = ['#664CF0', '#8D79FF', '#A857D4', '#5138CF', '#2E75D6', '#187B5C']

export default function LaundryStatistics() {
  const [period, setPeriod] = useState<Period>('week')
  const statistics = useQuery({ queryKey: ['laundry-statistics', period], queryFn: () => apiGet<Statistics>(`/laundry/statistics?period=${period}`) })
  const data = statistics.data
  const trend = useMemo(() => {
    if (!data) return []
    const collections = new Map(data.collection.daily.map((row) => [row.date, row.amount]))
    return data.ordersReview.daily.map((row) => ({ date: shortDate(row.date), orders: row.orders, revenue: row.amount, collection: collections.get(row.date) || 0 }))
  }, [data])
  const trendSummary = useMemo(() => {
    const revenue = trend.reduce((total, row) => total + row.revenue, 0)
    const collections = trend.reduce((total, row) => total + row.collection, 0)
    const orders = trend.reduce((total, row) => total + row.orders, 0)
    return `${rangeLabelFor(period)}: ${orders} orders, ${formatINR(revenue)} booked revenue and ${formatINR(collections)} collected across ${trend.length} days.`
  }, [period, trend])
  if (statistics.isLoading) return <VisualLoadingState title="Preparing business overview" detail="Building truthful trends from posted orders, collections and customer records." />
  if (statistics.isError || !data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">Statistics could not be loaded.</div>

  const rangeLabel = period === 'today' ? 'Today' : period === 'week' ? 'Last 7 days' : 'Lifetime'
  const serviceSummary = data.serviceMix.length ? `${data.serviceMix.slice(0, 8).map((row) => `${row.service}: ${formatINR(row.amount)} from ${row.quantity} item(s)`).join(', ')}.` : 'No service demand records are available for this period.'
  const orderSummary = data.ordersReview.daily.length ? `${data.ordersReview.daily.map((row) => `${shortDate(row.date)}: ${row.orders} order(s)`).join(', ')}.` : 'No daily order records are available for this period.'
  return <div className="animate-in fade-in slide-in-from-bottom-2 space-y-6 duration-500">
    <div className="rounded-[26px] border border-brand-400/25 bg-[radial-gradient(ellipse_at_85%_0%,rgba(141,121,255,.42),transparent_44%),linear-gradient(135deg,#1d124b_0%,#2c1c70_58%,#5138cf_145%)] p-6 text-white shadow-[0_18px_45px_rgba(45,28,112,.24)] md:p-7">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-4"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/95 p-2 shadow-lg shadow-brand-950/20"><img src={lndryBrand.mark} alt="Lndry" className="h-full w-full object-contain" /></div><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-brand-200">Laundry intelligence</p><h1 className="mt-1 font-serif text-3xl md:text-4xl">Overview</h1><p className="mt-2 max-w-xl text-sm text-white/75">A live pulse of orders, revenue, collections, customers and garment demand.</p></div></div>
        <div className="flex flex-wrap items-center gap-2"><div className="inline-flex rounded-xl border border-brand-100/25 bg-white/10 p-1" role="group" aria-label="Statistics period">{(['today', 'week', 'lifetime'] as Period[]).map((value) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} className={cn('rounded-lg px-3 py-2 text-xs font-bold transition', period === value ? 'bg-white text-brand-900 shadow-sm' : 'text-white/75 hover:bg-white/10')}>{value === 'today' ? 'Today' : value === 'week' ? 'Last 7 days' : 'Lifetime'}</button>)}</div><button type="button" onClick={() => void statistics.refetch()} className="grid h-10 w-10 place-items-center rounded-xl border border-brand-100/25 bg-white/10 text-white hover:bg-white/20" aria-label="Refresh statistics"><RefreshCw className="h-4 w-4" /></button></div>
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-3 text-xs text-white/70"><span className="inline-flex items-center gap-2 rounded-full border border-brand-100/15 bg-white/10 px-3 py-1.5"><Sparkles className="h-3.5 w-3.5 text-brand-200" />Live from your posted records</span><span>Range: {shortDate(data.from)} – {shortDate(data.to)}</span><span className="hidden sm:inline">·</span><span>Updated just now</span></div>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
      <StatCard label="Revenue" value={formatINR(data.revenue.total)} hint="Booked order value" icon={CircleDollarSign} accent="soft" />
      <StatCard label="Orders" value={String(data.ordersReview.total)} hint={`${rangeLabel} bookings`} icon={BarChart3} />
      <StatCard label="Collections" value={formatINR(data.collection.total)} hint="Submitted receipts" icon={CalendarDays} />
      <StatCard label="Avg. order" value={formatINR(data.revenue.averageOrderValue)} hint="Revenue per order" icon={Activity} />
      <StatCard label="Customers" value={String(data.customerFrequency.total)} hint={`${data.customerFrequency.repeatCustomers} repeat customers`} icon={UsersRound} />
      <StatCard label="New customers" value={String(data.newCustomer.total)} hint="Profiles created" icon={UsersRound} accent="soft" />
    </div>

    <Panel eyebrow="Performance" title="Revenue and collections" action={<span className="text-xs text-[#718087]">Orders · ₹ value</span>}><ChartAccessibility label="Revenue, collections and orders by day" summary={trendSummary} className="h-72"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={trend} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}><defs><linearGradient id="overview-revenue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#664CF0" stopOpacity={0.34} /><stop offset="100%" stopColor="#664CF0" stopOpacity={0.03} /></linearGradient><linearGradient id="overview-collection" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#A857D4" stopOpacity={0.3} /><stop offset="100%" stopColor="#A857D4" stopOpacity={0.03} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#ece8fb" /><XAxis dataKey="date" tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} /><YAxis yAxisId="money" tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} tickFormatter={(value) => `₹${value}`} /><YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} allowDecimals={false} /><Tooltip content={<PerformanceTooltip />} /><Area yAxisId="money" type="monotone" dataKey="revenue" name="Revenue" stroke="#664CF0" strokeWidth={2.5} fill="url(#overview-revenue)" /><Area yAxisId="money" type="monotone" dataKey="collection" name="Collections" stroke="#A857D4" strokeWidth={2} fill="url(#overview-collection)" /><Bar yAxisId="orders" dataKey="orders" name="Orders" fill="#241A45" radius={[4, 4, 0, 0]} barSize={14} /></ComposedChart></ResponsiveContainer></ChartAccessibility><div className="mt-3 flex flex-wrap gap-4 text-xs text-[#718087]"><LegendDot color="#664CF0" label="Revenue" /><LegendDot color="#A857D4" label="Collections" /><LegendDot color="#241A45" label="Orders" /></div></Panel>

    <div className="grid gap-5 xl:grid-cols-2">
      <Panel eyebrow="Orders review" title="Lifecycle mix"><div className="grid items-center gap-4 md:grid-cols-[180px_1fr]"><Donut rows={data.ordersReview.breakdown.map((row) => ({ name: row.state, value: row.count }))} /><Legend rows={data.ordersReview.breakdown.map((row) => ({ name: row.state, value: row.count }))} /></div></Panel>
      <Panel eyebrow="Customer frequency" title="Visits by customer"><div className="grid items-center gap-4 md:grid-cols-[180px_1fr]"><Donut rows={data.customerFrequency.breakdown.slice(0, 6).map((row) => ({ name: row.customer, value: row.visits }))} /><Legend rows={data.customerFrequency.breakdown.slice(0, 6).map((row) => ({ name: row.customer, value: row.visits }))} /></div></Panel>
      <Panel eyebrow="New customer" title="Acquisition trend"><Chart data={data.newCustomer.daily.map((row) => ({ date: shortDate(row.date), value: row.count }))} dataKey="value" /></Panel>
      <Panel eyebrow="Collection" title="Daily receipts"><Chart data={data.collection.daily.map((row) => ({ date: shortDate(row.date), value: row.amount }))} dataKey="value" currency /></Panel>
      <Panel eyebrow="Marketplace" title="Online orders (mobile app)" action={<span className="inline-flex items-center gap-1.5 text-xs text-[#718087]"><Cloud className="h-3.5 w-3.5 text-brand-600" />{rangeLabel}</span>}>
        <div className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-brand-50 p-3"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-brand-700">Orders</p><p className="mt-1 font-serif text-2xl text-[#17353c]">{data.online.count}</p></div><div className="rounded-2xl bg-brand-50 p-3"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-brand-700">Revenue (est.)</p><p className="mt-1 font-serif text-2xl text-[#17353c]">{formatINR(data.online.estimatedRevenue)}</p></div></div>
        <p className="mt-2 text-[11px] text-[#8b959a]">Pre-reconciliation estimate from real pulled orders — kept separate from the counter revenue above.</p>
        <div className="mt-4"><p className="mb-2 text-[10px] font-bold uppercase tracking-[.13em] text-[#718087]">Top online garments</p><Legend rows={data.online.topGarments.map((row) => ({ name: row.name, value: row.amount }))} /></div>
      </Panel>
      <Panel eyebrow="Garment services" title="Service demand"><ChartAccessibility label="Revenue by laundry service" summary={serviceSummary} className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.serviceMix.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 8, left: 12, bottom: 0 }}><CartesianGrid horizontal={false} stroke="#ece8fb" /><XAxis type="number" hide /><YAxis type="category" dataKey="service" width={92} tick={{ fontSize: 10, fill: '#5e7074' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value: unknown) => formatINR(Number(value || 0))} /><Bar dataKey="amount" name="Revenue" fill="#664CF0" radius={[0, 5, 5, 0]} barSize={18}>{data.serviceMix.slice(0, 8).map((_, index) => <Cell key={index} fill={palette[index % palette.length]} />)}</Bar></BarChart></ResponsiveContainer></ChartAccessibility></Panel>
      <Panel eyebrow="Throughput" title="Orders by day"><ChartAccessibility label="Orders by day" summary={orderSummary} className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.ordersReview.daily} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}><CartesianGrid vertical={false} stroke="#ece8fb" /><XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value: unknown) => [String(value ?? 0), 'Orders']} /><Bar dataKey="orders" name="Orders" fill="#241A45" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></ChartAccessibility></Panel>
    </div>
    <div className="flex flex-col gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-xs text-[#5e7074] sm:flex-row sm:items-center sm:justify-between"><span><strong className="text-[#17353c]">Overview is powered by posted store records.</strong> Use Reports for invoice, balance, pickup and captain-level drill-downs.</span><Link to="/laundry/reports" className="font-bold text-brand-600 hover:text-brand-700">Open reports →</Link></div>
  </div>
}

function StatCard({ label, value, hint, icon: Icon, accent = 'brand' }: { label: string; value: string; hint: string; icon: typeof BarChart3; accent?: 'brand' | 'soft' }) { return <div className="rounded-[20px] border border-brand-900/8 bg-white p-4 shadow-[0_8px_28px_rgba(52,41,95,.06)]"><div className={cn('grid h-9 w-9 place-items-center rounded-xl', accent === 'soft' ? 'bg-brand-100 text-brand-700' : 'bg-brand-50 text-brand-600')}><Icon className="h-4 w-4" /></div><p className="mt-4 text-[10px] font-bold uppercase tracking-[.13em] text-[#718087]">{label}</p><p className="mt-1 truncate font-serif text-2xl text-[#17353c]">{value}</p><p className="mt-1 text-[11px] text-[#74848a]">{hint}</p></div> }
function Panel({ eyebrow, title, action, children }: { eyebrow: string; title: string; action?: ReactNode; children: ReactNode }) { return <section className="rounded-[22px] border border-brand-900/8 bg-white p-5 shadow-[0_8px_28px_rgba(52,41,95,.06)] md:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-brand-600">{eyebrow}</p><h2 className="mt-1 font-serif text-2xl text-[#17353c]">{title}</h2></div>{action}</div><div className="mt-5">{children}</div></section> }
function Donut({ rows }: { rows: Array<{ name: string; value: number }> }) { const chartRows = rows.length ? rows : [{ name: 'No data', value: 1 }]; const summary = rows.length ? `${rows.map((row) => `${row.name}: ${row.value}`).join(', ')}.` : 'No records are available for this period.'; return <ChartAccessibility label="Distribution chart" summary={summary} className="h-44"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chartRows} dataKey="value" nameKey="name" innerRadius={50} outerRadius={72} paddingAngle={3}>{chartRows.map((_, index) => <Cell key={index} fill={rows.length ? palette[index % palette.length] : '#e3ddff'} />)}</Pie><Tooltip formatter={(value: unknown) => String(value ?? 0)} /></PieChart></ResponsiveContainer></ChartAccessibility> }
function Legend({ rows }: { rows: Array<{ name: string; value: number }> }) { return <div className="space-y-2">{rows.length ? rows.map((row, index) => <div key={row.name} className="flex items-center justify-between gap-3 text-sm"><span className="flex min-w-0 items-center gap-2 text-[#4c6268]"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} /><span className="truncate">{row.name}</span></span><strong className="tabular-nums text-[#17353c]">{row.value}</strong></div>) : <VisualEmptyState kind="operations" compact title="No records in this period" detail="Choose another period or complete a booking to build the overview." />}</div> }
function Chart({ data, dataKey, currency = false }: { data: Array<{ date: string; value: number }>; dataKey: string; currency?: boolean }) { const total = data.reduce((sum, row) => sum + row.value, 0); const peak = data.reduce((best, row) => row.value > best.value ? row : best, data[0] || { date: 'none', value: 0 }); const summary = data.length ? `${data.length} points, total ${currency ? formatINR(total) : total}, highest ${currency ? formatINR(peak.value) : peak.value} on ${peak.date}.` : 'No records are available for this period.'; return <ChartAccessibility label={`${currency ? 'Collection' : 'New customer'} trend`} summary={summary} className="h-52"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}><defs><linearGradient id={`stat-fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#664CF0" stopOpacity={0.28} /><stop offset="100%" stopColor="#664CF0" stopOpacity={0.02} /></linearGradient></defs><XAxis dataKey="date" tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} tickFormatter={(value) => currency ? `₹${value}` : value} /><Tooltip formatter={(value: unknown) => currency ? formatINR(Number(value || 0)) : String(value ?? 0)} /><Area type="monotone" dataKey={dataKey} stroke="#664CF0" strokeWidth={2.5} fill={`url(#stat-fill-${dataKey})`} /></AreaChart></ResponsiveContainer></ChartAccessibility> }
function PerformanceTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) { if (!active || !payload?.length) return null; return <div className="rounded-xl border border-brand-100 bg-white px-3 py-2 text-xs shadow-lg shadow-brand-900/10"><p className="mb-1 font-bold text-[#17353c]">{label}</p>{payload.map((item) => <p key={item.name} className="flex justify-between gap-4 text-[#5e7074]"><span>{item.name}</span><strong style={{ color: item.color }}>{item.name === 'Orders' ? item.value : formatINR(Number(item.value || 0))}</strong></p>)}</div> }
function LegendDot({ color, label }: { color: string; label: string }) { return <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />{label}</span> }
function shortDate(value: string) { return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(`${value}T00:00:00`)) }
function rangeLabelFor(period: Period) { return period === 'today' ? 'Today' : period === 'week' ? 'Last 7 days' : 'Lifetime' }
