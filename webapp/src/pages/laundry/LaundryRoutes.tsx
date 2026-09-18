import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  MapPin,
  MapPinned,
  Navigation,
  PackageCheck,
  Play,
  Route as RouteIcon,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { apiGet, apiPost } from "@/lib/api";
import type { LaundryOrder } from "@/lib/laundry";
import { cn } from "@/lib/utils";
import VisualEmptyState from "@/components/laundry/VisualEmptyState";
import { useDialogFocus } from "@/components/laundry/useDialogFocus";

type Rider = { id: string; name: string; phone: string };
type Session = { user: { roles: string[]; riderId?: string | null } | null };
type DispatchData = { riders: Rider[]; pickups: LaundryOrder[]; deliveries: LaundryOrder[] };
type Route = {
  id: string;
  riderId: string;
  riderName: string;
  routeDate: string;
  stage: "Pickup" | "Delivery";
  zone?: string;
  startTime?: string;
  minutesPerStop?: number;
  status: string;
  stopCount: number;
  notes: string;
  stops: Array<{ id: string; sequence: number; orderId: string; orderNumber: string; address: string; estimatedAt?: string; status: string; note: string }>;
};
type RouteAnalytics = {
  totals: { orders: number; zones: number; routes: number; activeRoutes: number; stops: number; completedStops: number; skippedStops: number; closedStops: number; completionPercent: number };
  zones: Array<{ zone: string; orders: number; pickupReady: number; deliveryReady: number; assigned: number; activeRuns: number }>;
};

const routeTone = {
  Pickup: "bg-[#e8f4ef] text-[#19735e] ring-[#b9dfd1]",
  Delivery: "bg-[#ede9ff] text-[#5d43ca] ring-[#d4c9ff]",
} as const;

function RouteMetric({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <div className="min-w-0 rounded-2xl border border-[#26203f]/8 bg-white px-3 py-3 shadow-[0_8px_24px_rgba(35,25,66,.035)]"><div className="flex items-center justify-between gap-2"><span className={cn("grid h-8 w-8 place-items-center rounded-xl", tone)}>{icon}</span><p className="text-xl font-semibold tabular-nums text-[#2c2148]">{value}</p></div><p className="mt-2 text-[10px] font-extrabold uppercase tracking-[.13em] text-[#756d84]">{label}</p><p className="mt-0.5 truncate text-[11px] text-[#90899c]" title={detail}>{detail}</p></div>;
}

export default function LaundryRoutes() {
  const client = useQueryClient();
  const session = useQuery({ queryKey: ["auth-session"], queryFn: () => apiGet<Session>("/auth/session") });
  const riderMode = Boolean(session.data?.user?.roles.includes("rider"));
  const [stage, setStage] = useState<"Pickup" | "Delivery">("Pickup");
  const [rider, setRider] = useState("");
  const [routeDate, setRouteDate] = useState(new Date().toISOString().slice(0, 10));
  const [zone, setZone] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [minutesPerStop, setMinutesPerStop] = useState("15");
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const dispatch = useQuery({ queryKey: ["laundry-dispatch"], queryFn: () => apiGet<DispatchData>("/laundry/dispatch"), enabled: !riderMode, refetchInterval: 5_000, refetchIntervalInBackground: false });
  const routes = useQuery({ queryKey: ["laundry-routes"], queryFn: () => apiGet<Route[]>("/laundry/routes"), refetchInterval: 5_000, refetchIntervalInBackground: false });
  const analytics = useQuery({ queryKey: ["laundry-route-analytics", riderMode], queryFn: () => apiGet<RouteAnalytics>("/laundry/route-analytics"), refetchInterval: 5_000, refetchIntervalInBackground: false });
  const serviceZones = useQuery({ queryKey: ["laundry-service-zones"], queryFn: () => apiGet<string[]>("/laundry/service-zones"), enabled: !riderMode });
  const orders = stage === "Pickup" ? dispatch.data?.pickups || [] : dispatch.data?.deliveries || [];
  const create = useMutation({
    mutationFn: () => apiPost<Route>("/laundry/routes", { riderId: rider, stage, routeDate, zone: zone.trim(), startTime, minutesPerStop: Number(minutesPerStop) || 15, orderIds: selected }),
    onSuccess: (data) => {
      setSelected([]); setZone("");
      setNotice(`${data.id} created with ${data.stopCount} stops${data.zone ? ` in ${data.zone}` : ""}.`);
      client.invalidateQueries({ queryKey: ["laundry-routes"] });
      client.invalidateQueries({ queryKey: ["laundry-route-analytics"] });
      client.invalidateQueries({ queryKey: ["laundry-dispatch"] });
    },
  });
  const start = useMutation({
    mutationFn: (id: string) => apiPost<Route>(`/laundry/routes/${id}/start`),
    onSuccess: () => { client.invalidateQueries({ queryKey: ["laundry-routes"] }); client.invalidateQueries({ queryKey: ["laundry-route-analytics"] }); },
  });
  const complete = useMutation({
    mutationFn: ({ routeId, stopId, status, note }: { routeId: string; stopId: string; status: "Completed" | "Skipped"; note?: string }) => apiPost<Route>(`/laundry/routes/${routeId}/stops/${stopId}/complete`, { status, note: note || "" }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ["laundry-routes"] }); client.invalidateQueries({ queryKey: ["laundry-route-analytics"] }); client.invalidateQueries({ queryKey: ["laundry-dispatch"] }); },
  });
  const active = useMemo(() => (routes.data || []).filter((route) => ["Planned", "In Progress"].includes(route.status)), [routes.data]);
  const selectedOrders = selected.length;

  if (session.isLoading || routes.isLoading || (!riderMode && dispatch.isLoading)) return <div className="grid h-80 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>;
  if (routes.isError || (!riderMode && (dispatch.isError || !dispatch.data)) || !routes.data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">Route planning could not be loaded.</div>;
  if (riderMode) return <RiderRouteBoard session={session.data} active={active} starting={start.isPending} completing={complete.isPending} onStart={(id) => start.mutate(id)} onComplete={(routeId, stopId, status, note) => complete.mutate({ routeId, stopId, status, note })} />;

  const totals = analytics.data?.totals;
  return <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4 duration-500">
    <RoutePageHeader activeRoutes={totals?.activeRoutes || active.length} ready={totals?.orders || 0} />
    <section className="rounded-[22px] border border-[#26203f]/10 bg-[#fcfbff] p-3 shadow-[0_8px_28px_rgba(35,25,66,.045)]">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <RouteMetric icon={<PackageCheck className="h-4 w-4" />} label="Ready work" value={String(totals?.orders || 0)} detail="Pickup + delivery demand" tone="bg-amber-100 text-amber-700" />
        <RouteMetric icon={<Navigation className="h-4 w-4" />} label="Live runs" value={String(totals?.activeRoutes || 0)} detail="Planned or in progress" tone="bg-violet-100 text-violet-700" />
        <RouteMetric icon={<CheckCircle2 className="h-4 w-4" />} label="Closed stops" value={String(totals?.closedStops || 0)} detail={`${totals?.completionPercent || 0}% route closure`} tone="bg-emerald-100 text-emerald-700" />
        <RouteMetric icon={<MapPinned className="h-4 w-4" />} label="Zones" value={String(totals?.zones || 0)} detail="Service coverage" tone="bg-sky-100 text-sky-700" />
        <RouteMetric icon={<X className="h-4 w-4" />} label="Exceptions" value={String(totals?.skippedStops || 0)} detail="Skipped with an audit reason" tone="bg-rose-100 text-rose-700" />
      </div>
      {analytics.data?.zones.length ? <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5" aria-label="Zone route workload">{analytics.data.zones.slice(0, 8).map((item) => <div key={item.zone} className="min-w-[170px] rounded-xl border border-[#26203f]/8 bg-white px-3 py-2"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-bold text-[#33284f]">{item.zone}</p><span className="rounded-full bg-[#f0edff] px-1.5 py-0.5 text-[10px] font-bold text-[#6247d1]">{item.activeRuns} live</span></div><div className="mt-1 flex items-center gap-2 text-[10px] font-semibold text-[#7f778e]"><span className="text-emerald-700">↑ {item.pickupReady}</span><span className="text-violet-700">↓ {item.deliveryReady}</span><span>· {item.assigned} assigned</span></div></div>)}</div> : null}
    </section>
    <section className="overflow-hidden rounded-[22px] border border-[#26203f]/10 bg-white shadow-[0_8px_28px_rgba(35,25,66,.045)]">
      <div className="grid xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="border-b border-[#26203f]/10 bg-[#272044] p-4 text-white xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-[#d7cfff]"><RouteIcon className="h-4 w-4" /></span><span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[.12em]">Plan run</span></div>
          <h2 className="mt-3 text-lg font-semibold">One compact dispatch plan.</h2>
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-white/10 p-1" role="group" aria-label="Route stage">{(["Pickup", "Delivery"] as const).map((option) => <button key={option} type="button" onClick={() => { setStage(option); setSelected([]); }} className={cn("inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold transition", stage === option ? "bg-white text-[#342653] shadow-sm" : "text-white/70 hover:bg-white/10 hover:text-white")}><span aria-hidden="true">{option === "Pickup" ? "↑" : "↓"}</span>{option}</button>)}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <CompactField label="Captain" icon={<UserRound className="h-3.5 w-3.5" />}><select aria-label="Route captain" value={rider} onChange={(e) => setRider(e.target.value)} className="h-9 w-full rounded-lg border border-white/15 bg-white/10 px-2 text-xs font-semibold normal-case tracking-normal text-white outline-none focus:ring-2 focus:ring-[#f5d565]"><option value="">Choose</option>{(dispatch.data?.riders || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></CompactField>
            <CompactField label="Zone" icon={<MapPin className="h-3.5 w-3.5" />}><input value={zone} onChange={(e) => setZone(e.target.value.slice(0, 120))} placeholder="Any zone" list="laundry-service-zones" className="h-9 w-full rounded-lg border border-white/15 bg-white/10 px-2 text-xs font-semibold normal-case tracking-normal text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-[#f5d565]" /><datalist id="laundry-service-zones">{(serviceZones.data || []).map((item) => <option key={item} value={item} />)}</datalist></CompactField>
            <CompactField label="Date" icon={<MapPinned className="h-3.5 w-3.5" />}><input aria-label="Route date" type="date" value={routeDate} onChange={(e) => setRouteDate(e.target.value)} className="h-9 w-full rounded-lg border border-white/15 bg-white/10 px-2 text-xs font-semibold normal-case tracking-normal text-white outline-none [color-scheme:dark] focus:ring-2 focus:ring-[#f5d565]" /></CompactField>
            <CompactField label="Start" icon={<Clock3 className="h-3.5 w-3.5" />}><input aria-label="Route start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-9 w-full rounded-lg border border-white/15 bg-white/10 px-2 text-xs font-semibold normal-case tracking-normal text-white outline-none [color-scheme:dark] focus:ring-2 focus:ring-[#f5d565]" /></CompactField>
          </div>
          <label className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white/10 px-3 py-2 text-[11px] font-bold text-white/85"><span>Minutes / stop</span><input type="number" min="1" max="240" value={minutesPerStop} onChange={(e) => setMinutesPerStop(e.target.value)} className="w-12 bg-transparent text-right text-sm font-bold text-white outline-none" /></label>
          <button type="button" disabled={create.isPending || !rider || !selectedOrders} onClick={() => create.mutate()} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#f5d565] px-3 text-sm font-extrabold text-[#352748] transition hover:bg-[#ffe58c] disabled:cursor-not-allowed disabled:opacity-45"><RouteIcon className="h-4 w-4" />{create.isPending ? "Creating…" : `Create run · ${selectedOrders}`}</button>
          {create.isError ? <p className="mt-3 rounded-lg bg-rose-400/15 p-2 text-xs font-semibold text-rose-100">{create.error instanceof Error ? create.error.message : "Could not create the run."}</p> : null}{notice ? <p className="mt-3 flex items-start gap-2 text-xs leading-4 text-emerald-200"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />{notice}</p> : null}
        </div>
        <div className="min-w-0 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-extrabold uppercase tracking-[.15em] text-[#746c84]">Ready to assign</p><h2 className="mt-0.5 text-lg font-semibold text-[#302547]">{stage} stops <span className="ml-1 text-sm font-medium text-[#80778e]">{selectedOrders} selected</span></h2></div><span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1", routeTone[stage])}>{stage === "Pickup" ? <Truck className="h-3.5 w-3.5" /> : <Navigation className="h-3.5 w-3.5" />}{orders.length} available</span></div>
          <div className="mt-3 grid max-h-[326px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">{orders.length ? orders.map((order) => { const isSelected = selected.includes(order.id); return <button key={order.id} type="button" aria-pressed={isSelected} onClick={() => setSelected((current) => isSelected ? current.filter((id) => id !== order.id) : [...current, order.id])} className={cn("group flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition", isSelected ? "border-brand-400 bg-brand-50/70 shadow-[0_6px_16px_rgba(90,69,200,.09)]" : "border-[#26203f]/9 bg-[#fcfbff] hover:border-brand-200 hover:bg-brand-50/30")}><span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-extrabold", isSelected ? "bg-brand-600 text-white" : stage === "Pickup" ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700")}>{isSelected ? <Check className="h-4 w-4" /> : <span>{stage === "Pickup" ? "↑" : "↓"}</span>}</span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold text-[#352a50]">{order.customer.name}</span><span className="shrink-0 text-[10px] font-bold text-[#766e83]">{order.orderNumber}</span></span><span className="mt-1 block truncate text-[11px] text-[#867f93]">{order.deliveryAddress || "Address pending"}</span><span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-[#4d8a7f]"><MapPin className="h-3 w-3" />{order.serviceZone || "Any zone"}</span></span></button>; }) : <div className="sm:col-span-2"><VisualEmptyState kind="delivery" compact title={`No ${stage.toLowerCase()} stops waiting`} detail="This board will light up when an eligible order is ready." /></div>}</div>
        </div>
      </div>
    </section>
    <section><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#ede9ff] text-[#6348cf]"><Navigation className="h-4 w-4" /></span><div><p className="text-[10px] font-extrabold uppercase tracking-[.15em] text-[#746c84]">Live board</p><h2 className="text-lg font-semibold text-[#302547]">Route runs</h2></div></div><span className="rounded-full bg-[#f0edff] px-2.5 py-1 text-xs font-bold text-[#6247d1]">{active.length} active</span></div>{active.length ? <div className="grid gap-3 2xl:grid-cols-2">{active.map((route) => <RouteCard key={route.id} route={route} starting={start.isPending} completing={complete.isPending} onStart={() => start.mutate(route.id)} onComplete={(stopId, status, note) => complete.mutate({ routeId: route.id, stopId, status, note })} />)}</div> : <div className="rounded-[22px] border border-[#26203f]/10 bg-white"><VisualEmptyState kind="delivery" compact title="No live route runs" detail="Choose the ready stops above to build the next pickup or delivery run." /></div>}</section>
  </div>;
}

function RoutePageHeader({ activeRoutes, ready }: { activeRoutes: number; ready: number }) {
  return <header className="flex flex-col gap-3 rounded-[22px] border border-[#26203f]/10 bg-[radial-gradient(circle_at_top_right,_#e5dcff,_transparent_40%),linear-gradient(135deg,#faf9ff,#fffdf7)] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#2b2147] text-[#f8d766] shadow-[0_10px_20px_rgba(43,33,71,.18)]"><RouteIcon className="h-5 w-5" /></span><div><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#6d5fa2]">Pickup & delivery</p><h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-[#2d2348]">Route control</h1></div></div><div className="flex gap-2"><span className="inline-flex items-center gap-1.5 rounded-xl bg-white/80 px-3 py-2 text-xs font-bold text-[#4b3ab0] ring-1 ring-[#d9d1ff]"><Navigation className="h-3.5 w-3.5" />{activeRoutes} live</span><span className="inline-flex items-center gap-1.5 rounded-xl bg-white/80 px-3 py-2 text-xs font-bold text-[#9a6413] ring-1 ring-[#f3d898]"><PackageCheck className="h-3.5 w-3.5" />{ready} ready</span></div></header>;
}

function CompactField({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) { return <label className="block text-[10px] font-extrabold uppercase tracking-[.12em] text-white/70"><span className="mb-1 flex items-center gap-1">{icon}{label}</span>{children}</label>; }

function RiderRouteBoard({ session, active, starting, completing, onStart, onComplete }: { session: Session | undefined; active: Route[]; starting: boolean; completing: boolean; onStart: (id: string) => void; onComplete: (routeId: string, stopId: string, status: "Completed" | "Skipped", note?: string) => void }) {
  return <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4 duration-500"><RoutePageHeader activeRoutes={active.length} ready={active.reduce((sum, route) => sum + route.stops.filter((stop) => stop.status === "Planned").length, 0)} />{!session?.user?.riderId ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">This captain account is not linked to an active captain record. Ask an owner to link it before attempting route work.</div> : null}<section><div className="mb-3 flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><Truck className="h-4 w-4" /></span><div><p className="text-[10px] font-extrabold uppercase tracking-[.15em] text-[#746c84]">Field handoff</p><h2 className="text-lg font-semibold text-[#302547]">My route runs</h2></div></div>{active.length ? <div className="grid gap-3 2xl:grid-cols-2">{active.map((route) => <RouteCard key={route.id} route={route} starting={starting} completing={completing} onStart={() => onStart(route.id)} onComplete={(stopId, status, note) => onComplete(route.id, stopId, status, note)} />)}</div> : <div className="rounded-[22px] border border-[#26203f]/10 bg-white"><VisualEmptyState kind="delivery" compact title="No active route runs" detail="Assigned pickup and delivery work will appear here when a run is planned for you." /></div>}</section></div>;
}

function RouteCard({ route, starting, completing, onStart, onComplete }: { route: Route; starting: boolean; completing: boolean; onStart: () => void; onComplete: (stopId: string, status: "Completed" | "Skipped", note?: string) => void }) {
  const [expanded, setExpanded] = useState(route.status === "In Progress");
  const [skipTarget, setSkipTarget] = useState<{ id: string; orderNumber: string } | null>(null);
  const [skipNote, setSkipNote] = useState("");
  const closedStops = route.stops.filter((stop) => ["Completed", "Skipped"].includes(stop.status)).length;
  const completeStops = route.stops.filter((stop) => stop.status === "Completed").length;
  const progress = route.stopCount ? Math.round((closedStops / route.stopCount) * 100) : 0;
  const statusClass = route.status === "In Progress" ? "bg-[#e9f7f1] text-[#19755e]" : "bg-[#fff2ce] text-[#936315]";
  return <><article className="overflow-hidden rounded-[20px] border border-[#26203f]/10 bg-white shadow-[0_8px_24px_rgba(35,25,66,.04)]"><header className="p-3"><div className="flex items-start gap-3"><span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1", routeTone[route.stage])}>{route.stage === "Pickup" ? <Truck className="h-4 w-4" /> : <Navigation className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-extrabold text-[#34294f]">{route.id}</p><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-extrabold", statusClass)}>{route.status}</span></div><div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-[#7c748c]"><span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{route.riderName}</span><span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{route.zone || "All zones"}</span><span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{route.startTime || "09:00"}</span></div></div></div><div className="mt-3 flex items-center gap-2"><div className="min-w-0 flex-1"><div className="flex items-center justify-between text-[10px] font-bold text-[#81798e]"><span>{completeStops}/{route.stopCount} complete</span><span>{progress}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#efedf5]"><div className={cn("h-full rounded-full transition-all", route.stage === "Pickup" ? "bg-emerald-500" : "bg-violet-500")} style={{ width: `${progress}%` }} /></div></div>{route.status === "Planned" ? <button type="button" disabled={starting} onClick={onStart} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2b2147] px-3 text-xs font-bold text-white transition hover:bg-[#403260] disabled:opacity-50"><Play className="h-3.5 w-3.5" />Start</button> : null}<button type="button" onClick={() => setExpanded((value) => !value)} className="grid h-8 w-8 place-items-center rounded-lg border border-[#26203f]/10 text-[#5f5770] transition hover:bg-[#f4f1ff]" aria-label={`${expanded ? "Hide" : "Show"} stops for ${route.id}`} title={expanded ? "Hide stops" : "Show stops"}><ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} /></button></div></header>{expanded ? <div className="border-t border-[#26203f]/8 bg-[#fcfbff] p-2">{route.stops.map((stop) => <StopRow key={stop.id} routeStatus={route.status} stop={stop} completing={completing} onComplete={() => onComplete(stop.id, "Completed")} onSkip={() => { setSkipTarget({ id: stop.id, orderNumber: stop.orderNumber }); setSkipNote(""); }} />)}</div> : null}</article>{skipTarget ? <SkipStopDialog orderNumber={skipTarget.orderNumber} note={skipNote} setNote={setSkipNote} completing={completing} onCancel={() => { setSkipTarget(null); setSkipNote(""); }} onConfirm={() => { onComplete(skipTarget.id, "Skipped", skipNote.trim()); setSkipTarget(null); setSkipNote(""); }} /> : null}</>;
}

function StopRow({ routeStatus, stop, completing, onComplete, onSkip }: { routeStatus: string; stop: Route["stops"][number]; completing: boolean; onComplete: () => void; onSkip: () => void }) {
  const closed = stop.status === "Completed" || stop.status === "Skipped";
  return <div className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-white"><span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[10px] font-extrabold", stop.status === "Completed" ? "bg-emerald-100 text-emerald-700" : stop.status === "Skipped" ? "bg-rose-100 text-rose-700" : "bg-[#ece8ff] text-[#5c43c8]")}>{stop.status === "Completed" ? <Check className="h-3.5 w-3.5" /> : stop.status === "Skipped" ? <X className="h-3.5 w-3.5" /> : stop.sequence}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-[#372c50]">{stop.orderNumber}</p><p className="truncate text-[10px] text-[#81798e]">{stop.address || "Address pending"}{stop.estimatedAt ? ` · ${stop.estimatedAt.replace("T", " ")}` : ""}</p></div>{stop.status === "Planned" && routeStatus === "In Progress" ? <div className="flex shrink-0 gap-1"><button type="button" disabled={completing} onClick={onComplete} className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-100 text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:opacity-50" aria-label={`Complete ${stop.orderNumber}`} title="Complete stop"><Check className="h-3.5 w-3.5" /></button><button type="button" disabled={completing} onClick={onSkip} className="grid h-7 w-7 place-items-center rounded-lg bg-rose-50 text-rose-700 transition hover:bg-rose-600 hover:text-white disabled:opacity-50" aria-label={`Skip ${stop.orderNumber}`} title="Skip stop"><X className="h-3.5 w-3.5" /></button></div> : <span className={cn("shrink-0 rounded-full px-2 py-1 text-[10px] font-bold", stop.status === "Completed" ? "bg-emerald-100 text-emerald-700" : stop.status === "Skipped" ? "bg-rose-100 text-rose-700" : "bg-[#eeeaff] text-[#6045cb]")}>{closed ? stop.status : "Planned"}</span>}</div>;
}

function SkipStopDialog({ orderNumber, note, setNote, completing, onCancel, onConfirm }: { orderNumber: string; note: string; setNote: (value: string) => void; completing: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { dialogRef, initialFocusRef, onKeyDown } = useDialogFocus<HTMLFormElement, HTMLTextAreaElement>(onCancel);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#171126]/60 p-4 backdrop-blur-sm"><form ref={dialogRef} onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-labelledby="skip-stop-title" onSubmit={(event) => { event.preventDefault(); if (note.trim().length >= 3) onConfirm(); }} className="w-full max-w-md rounded-[22px] bg-[#fffdfb] p-5 shadow-2xl"><p className="text-[10px] font-extrabold uppercase tracking-[.15em] text-rose-700">Route exception</p><h2 id="skip-stop-title" className="mt-1 text-xl font-semibold text-[#302547]">Skip {orderNumber}?</h2><p className="mt-1 text-sm text-[#736c82]">Add a short reason. It is saved with the route handoff audit.</p><label className="mt-4 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#746c84]">Reason<textarea ref={initialFocusRef} aria-label="Skip reason" value={note} onChange={(event) => setNote(event.target.value)} minLength={3} className="mt-1.5 min-h-24 w-full rounded-xl border border-[#26203f]/15 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal outline-none focus:ring-2 focus:ring-brand-500" /></label><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-xl border border-[#26203f]/12 px-3 py-2 text-sm font-semibold text-[#6f687d]">Keep stop</button><button type="submit" disabled={completing || note.trim().length < 3} className="rounded-xl bg-rose-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Confirm skip</button></div></form></div>;
}
