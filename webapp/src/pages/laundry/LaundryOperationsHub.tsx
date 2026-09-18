import { NavLink } from 'react-router-dom'
import { Bike, ClipboardCheck, ClipboardList, Printer, Route, ScanLine, ShieldCheck, Wrench } from 'lucide-react'

type Workstream = {
  to: string
  title: string
  description: string
  action: string
  icon: typeof Wrench
}

const workstreams: Workstream[] = [
  { to: '/laundry/orders', title: 'Order pipeline', description: 'Move orders from booking through collection, intake and completion.', action: 'Open store orders', icon: ClipboardList },
  { to: '/laundry/production-queue', title: 'Production queue', description: 'Work the live garment queue without losing the order it belongs to.', action: 'Open production queue', icon: Wrench },
  { to: '/laundry/garment-tracking', title: 'Garment tracking', description: 'Scan garment, bag and retired-tag identities with their physical history intact.', action: 'Track a garment', icon: ScanLine },
  { to: '/laundry/quality-claims', title: 'Quality & exceptions', description: 'Resolve QC, rewash and customer-claim decisions against the same order timeline.', action: 'Review quality work', icon: ShieldCheck },
  { to: '/laundry/dispatch', title: 'Pickup & delivery', description: 'Assign captains and record each customer handoff from the operational order.', action: 'Open dispatch', icon: Bike },
  { to: '/laundry/routes', title: 'Route runs', description: 'Plan and run pickup or delivery routes with capacity and captain accountability.', action: 'Open route runs', icon: Route },
  { to: '/laundry/print-centre', title: 'Documents & tags', description: 'Print receipts, invoices, garment tags and bag tags from canonical order data.', action: 'Open print centre', icon: Printer },
]

export default function LaundryOperationsHub() {
  return <section className="animate-in fade-in slide-in-from-bottom-2 duration-500">
    <div className="max-w-3xl">
      <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#39786f]">Operations visual board</p>
      <h1 className="mt-2 font-display text-3xl font-extrabold tracking-[-.04em] text-[#17353c]">Counter → care floor → customer.</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[#617178]">Choose a work area by its icon. Every scan, quality decision and captain handoff stays attached to the same laundry order.</p>
    </div>
    <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {workstreams.map((item, index) => <NavLink key={item.to} to={item.to} className="group relative overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-[#fffdf8] p-5 shadow-[0_1px_1px_rgba(12,42,48,.03)] transition hover:-translate-y-0.5 hover:border-[#39786f]/30 hover:shadow-[0_14px_30px_rgba(81,56,207,.13)]">
        <span className="absolute right-4 top-3 font-display text-5xl font-extrabold text-[#e7f3ef]">0{index + 1}</span>
        <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-[#e7f3ef] text-[#277267]"><item.icon className="h-6 w-6" /></span>
        <h2 className="mt-5 font-display text-lg font-semibold tracking-[-.02em] text-[#17353c]">{item.title}</h2>
        <p className="mt-2 min-h-12 text-sm leading-6 text-[#617178]">{item.description}</p>
        <span className="mt-5 inline-flex text-xs font-extrabold text-[#277267] group-hover:text-[#17353c]">{item.action} <span className="ml-1 transition-transform group-hover:translate-x-0.5">→</span></span>
      </NavLink>)}
    </div>
    <div className="mt-6 flex items-start gap-3 rounded-2xl border border-[#e2c482]/50 bg-[#fff7df] p-4 text-sm text-[#775919]">
      <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0" />
      <p><strong>Operational truth:</strong> a scan, QC result, route handoff or printed tag is an event on a laundry order—not a disconnected record in a generic ERP module.</p>
    </div>
  </section>
}
