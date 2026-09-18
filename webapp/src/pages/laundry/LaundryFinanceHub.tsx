import { NavLink } from 'react-router-dom'
import { Banknote, BarChart3, ClipboardCheck, FileWarning, Landmark, Printer, ReceiptText, Settings2, WalletCards, ShieldCheck } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import { formatINR, localDateKey } from '@/lib/utils'

type FinanceWorkstream = {
  to: string
  title: string
  description: string
  action: string
  icon: typeof Banknote
}

const workstreams: FinanceWorkstream[] = [
  { to: '/laundry/finance-setup', title: 'Finance setup', description: 'Enter your legal entity, PAN/TAN, GST profile, work state and establishment coverage when your business is ready.', action: 'Configure finance', icon: ShieldCheck },
  { to: '/laundry/management', title: 'Management control', description: 'See financial readiness, quality risk and workforce capacity without fabricated EBITDA or statutory outcomes.', action: 'Open control room', icon: BarChart3 },
  { to: '/laundry/cash-closing', title: 'Cash closing', description: 'Close the counter shift against actual cash collection and recorded payments.', action: 'Close a cash shift', icon: Banknote },
  { to: '/laundry/expenses', title: 'Store expenses', description: 'Record operating expenses with accountable amounts and supporting context.', action: 'Review expenses', icon: WalletCards },
  { to: '/laundry/settlements', title: 'Captain settlements', description: 'Reconcile captain collections and handoffs against the orders they completed.', action: 'Open settlements', icon: Landmark },
  { to: '/laundry/print-centre', title: 'Invoices & receipts', description: 'Produce customer-facing invoices and receipts from the authoritative order data.', action: 'Open documents', icon: Printer },
  { to: '/laundry/reports', title: 'Financial reports', description: 'Review sales, collections and operating performance from local records.', action: 'Open reports', icon: ReceiptText },
  { to: '/laundry/settings', title: 'Tax & invoice readiness', description: 'Maintain store tax configuration, invoice identity and document settings.', action: 'Open store settings', icon: Settings2 },
  { to: '/laundry/corrections', title: 'Correction documents', description: 'Create controlled corrections for the underlying customer and order history.', action: 'Review corrections', icon: FileWarning },
]

export default function LaundryFinanceHub() {
  const today = localDateKey(); const monthStart = `${today.slice(0, 7)}-01`
  const statutory = useQuery({ queryKey: ['finance-statutory-dashboard', monthStart, today], queryFn: () => apiGet<any>(`/finance/statutory-dashboard?from=${monthStart}&to=${today}`) })
  const data = statutory.data; const command = data?.commandCenter
  return <section className="animate-in fade-in slide-in-from-bottom-2 duration-500">
    <div className="max-w-3xl">
      <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#664cf0]">Finance & compliance</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-.035em] text-[#17353c]">Money and compliance, with a clear next move.</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[#617178]">Every financial record traces to local store work. The statutory workspace keeps source transactions, policies, evidence and return state together.</p>
    </div>
    <NavLink to="/laundry/finance/statutory" className="group mt-6 block overflow-hidden rounded-[26px] border border-[#35216f]/25 bg-[radial-gradient(circle_at_92%_18%,rgba(218,210,255,.32),transparent_28%),linear-gradient(135deg,#2d1e65,#664cf0)] p-5 text-white shadow-[0_18px_40px_rgba(81,56,207,.22)] md:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#d8d1ff]">Finance health</p><h2 className="mt-1 font-display text-2xl font-semibold tracking-[-.035em]">{command?.health === 'ACTION_REQUIRED' ? 'Attention required' : command?.health === 'ON_TRACK_WITH_ACTIONS' ? 'On track with actions' : 'Controlled'}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#eeeaff]">Open statutory controls to see the amount, source, return journey and real evidence state—without treating a prepared return as filed.</p></div><span className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-extrabold text-[#241a45] transition group-hover:bg-[#f0edff]">Open control room <span className="ml-2">→</span></span></div>
      <div className="mt-5 grid gap-2 sm:grid-cols-3"><HubMetric label="Recorded liability" value={data ? formatINR(Number(data.liabilities.totalPaise || 0) / 100) : '—'} /><HubMetric label="Return actions" value={data ? String(data.openReturns) : '—'} /><HubMetric label="Evidence gaps" value={command ? String(command.missingEvidenceCount) : '—'} /></div>
    </NavLink>
    <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {workstreams.map((item) => <NavLink key={item.to} to={item.to} className="group rounded-[22px] border border-[#263f44]/10 bg-[#fffdf8] p-5 shadow-[0_1px_1px_rgba(12,42,48,.03)] transition hover:-translate-y-0.5 hover:border-[#664cf0]/30 hover:shadow-[0_14px_30px_rgba(81,56,207,.12)]">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#f0edff] text-[#664cf0]"><item.icon className="h-5 w-5" /></span>
        <h2 className="mt-5 font-display text-lg font-semibold tracking-[-.02em] text-[#17353c]">{item.title}</h2>
        <p className="mt-2 min-h-12 text-sm leading-6 text-[#617178]">{item.description}</p>
        <span className="mt-5 inline-flex text-xs font-extrabold text-[#664cf0] group-hover:text-[#5138cf]">{item.action} <span className="ml-1 transition-transform group-hover:translate-x-0.5">→</span></span>
      </NavLink>)}
    </div>
    <div className="mt-6 flex items-start gap-3 rounded-2xl border border-[#e2c482]/50 bg-[#fff7df] p-4 text-sm text-[#775919]">
      <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0" />
      <p><strong>Compliance boundary:</strong> the system will show configuration and evidence states. It does not claim GST, e-invoice or provider success without an actual configured and verified integration.</p>
    </div>
  </section>
}

function HubMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-3 backdrop-blur-sm"><p className="text-[9px] font-extrabold uppercase tracking-[.12em] text-[#d8d1ff]">{label}</p><p className="mt-1 text-lg font-display font-semibold tabular-nums text-white">{value}</p></div> }
