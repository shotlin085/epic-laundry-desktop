import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  Ban,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cloud,
  CircleDollarSign,
  Download,
  Eye,
  Layers3,
  Loader2,
  MapPin,
  Pencil,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Tag,
  Truck,
  UserCheck,
  UserRound,
  UserX,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost, operatorErrorMessage } from "@/lib/api";
import {
  nextLaundryState,
  stateTone,
  type LaundryCatalogue,
  type LaundryFulfillmentEvent,
  type LaundryOrder,
  type LaundryPaymentSummary,
  type LaundryState,
} from "@/lib/laundry";
import { cn, formatINR } from "@/lib/utils";
import OrderItemEditor from "@/components/laundry/OrderItemEditor";
import VisualEmptyState from "@/components/laundry/VisualEmptyState";

const states: Array<LaundryState | "all"> = [
  "all",
  "Booked",
  "Picked Up",
  "In Process",
  "Ready",
  "Out for Delivery",
  "Delivered",
  "Cancelled",
];

type OrderPage = { items: LaundryOrder[]; total: number; page: number; pageSize: number; totalPages: number };
type CustomerRecord = { id: string; name: string; phone: string; email: string; address: string; preferredContact?: string; marketingConsent?: boolean };
type OnlineOnlyCustomer = { name: string; phone: string; orderCount: number; lastOrderAt: string };
type CustomerInsight = {
  asOf: string;
  summary: { totalCustomers: number; revenue: number };
  customers: Array<{ customerId: string; orderCount: number; revenue: number; lastOrderDate: string | null; contactEligible: boolean; segment: string }>;
};
type CustomerViewStatus = "all" | "contactable" | "restricted";
type CustomerViewSegment = "all" | "new" | "repeat" | "at_risk" | "lapsed" | "no_orders" | "unknown";
type CustomerDrawerProfile = {
  customer: CustomerRecord & { notes?: string; servicePreferences?: string };
  metrics: {
    revenue: number;
    orderBalance: number;
    walletBalance: number;
    rewardPoints: number;
    lastVisit: string | null;
    currentPackage: string | null;
  };
  addresses: Array<{ id: string; label: string; line1: string; line2: string; city: string; state: string; postalCode: string; isDefault: boolean; active: boolean }>;
  orders: Array<{ id: string; orderNumber: string; orderDate: string; state: string; grandTotal: number; invoice: string | null; paymentStatus: string; fulfillmentMode?: string; expectedDeliveryDate?: string }>;
  ledger: Array<{ id: string; entryDate: string; entryType: string; debit: number; credit: number; referenceId: string; reason: string }>;
  timeline: Array<{ at: string; type: string; label: string; amount: number; reason: string }>;
};

export default function LaundryOrders() {
  const { id: orderId } = useParams();
  return orderId ? <OrderWorkCardPage id={orderId} /> : <StoreOrdersCustomersWorkspace />;
}

function StoreOrdersCustomersWorkspace() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<LaundryState | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [searchParams] = useSearchParams();
  const [customerStatus, setCustomerStatus] = useState<CustomerViewStatus>("all");
  const [customerSegment, setCustomerSegment] = useState<CustomerViewSegment>("all");
  const [customerSort, setCustomerSort] = useState<"newest" | "spend">("newest");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const linkedCustomerId = searchParams.get("customer");
  const linkedOrderId = searchParams.get("order");
  const view = searchParams.get("view") === "customers" ? "customers" : "orders";
  useEffect(() => setPage(1), [search, state, from, to]);
  useEffect(() => {
    if (linkedCustomerId) setSelectedCustomerId(linkedCustomerId);
  }, [linkedCustomerId]);
  useEffect(() => {
    if (linkedOrderId) setSelectedOrderId(linkedOrderId);
  }, [linkedOrderId]);
  const filters = new URLSearchParams({
    search,
    ...(state === "all" ? {} : { state }),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const orders = useQuery({
    queryKey: ["laundry-orders", search, state, from, to, page],
    queryFn: () =>
      apiGet<OrderPage>(`/laundry/orders?${filters.toString()}&page=${page}&pageSize=50`),
    enabled: view === "orders",
  });
  const customers = useQuery({
    queryKey: ["laundry-customers", search],
    queryFn: () => apiGet<CustomerRecord[]>(`/laundry/customers?search=${encodeURIComponent(search)}`),
    enabled: view === "customers",
  });
  const customerInsights = useQuery({
    queryKey: ["customer-insights"],
    queryFn: () => apiGet<CustomerInsight>("/laundry/customer-insights"),
    enabled: view === "customers",
    staleTime: 30_000,
  });
  const onlineOnlyCustomers = useQuery({
    queryKey: ["laundry-customers-online-only"],
    queryFn: () => apiGet<OnlineOnlyCustomer[]>("/laundry/customers/online-only"),
    enabled: view === "customers",
    staleTime: 30_000,
  });
  const transition = useMutation({
    mutationFn: ({
      id,
      next,
      expectedVersion,
    }: {
      id: string;
      next: LaundryState;
      expectedVersion?: number;
    }) =>
      apiPost<LaundryOrder>(`/laundry/orders/${id}/transition`, {
        state: next,
        expectedVersion,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["laundry-orders"] });
      client.invalidateQueries({ queryKey: ["laundry-order"] });
      client.invalidateQueries({ queryKey: ["laundry-dashboard"] });
      client.invalidateQueries({ queryKey: ["laundry-dispatch"] });
    },
  });
  const rows = orders.data?.items || [];
  const customerRows = useMemo(() => {
    const metrics = new Map((customerInsights.data?.customers || []).map((entry) => [entry.customerId, entry]));
    const filtered = (customers.data || []).map((customer) => ({ customer, metric: metrics.get(customer.id) })).filter(({ metric }) => {
      if (customerStatus === "contactable") return Boolean(metric?.contactEligible);
      if (customerStatus === "restricted") return !metric?.contactEligible;
      return true;
    }).filter(({ metric }) => customerSegment === "all" || metric?.segment === customerSegment);
    return filtered.sort((a, b) => customerSort === "spend" ? (b.metric?.revenue || 0) - (a.metric?.revenue || 0) : String(b.metric?.lastOrderDate || "").localeCompare(String(a.metric?.lastOrderDate || "")));
  }, [customers.data, customerInsights.data, customerSegment, customerSort, customerStatus]);
  const activeToday = (customerInsights.data?.customers || []).filter((customer) => customer.lastOrderDate === customerInsights.data?.asOf).length;
  const restrictedCustomers = (customerInsights.data?.customers || []).filter((customer) => !customer.contactEligible).length;
  function setView(nextView: "orders" | "customers") {
    const params = new URLSearchParams(searchParams);
    if (nextView === "customers") params.set("view", "customers"); else params.delete("view");
    params.delete("order");
    setSearch("");
    navigate(`/laundry/orders${params.size ? `?${params.toString()}` : ""}`);
  }
  function closeCustomerDrawer() {
    setSelectedCustomerId(null);
    if (!linkedCustomerId) return;
    const params = new URLSearchParams(searchParams);
    params.delete("customer");
    navigate(`/laundry/orders${params.size ? `?${params.toString()}` : ""}`, { replace: true });
  }
  function openOrderDrawer(id: string) {
    setSelectedCustomerId(null);
    setSelectedOrderId(id);
  }
  function closeOrderDrawer() {
    setSelectedOrderId(null);
    if (!linkedOrderId) return;
    const params = new URLSearchParams(searchParams);
    params.delete("order");
    navigate(`/laundry/orders${params.size ? `?${params.toString()}` : ""}`, { replace: true });
  }
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">
            Counter operations
          </p>
          <h1 className="mt-1 font-serif text-3xl text-[#17353c]">
            Store orders & customers
          </h1>
          <p className="mt-1 text-sm text-[#718087]">
            One workspace for bookings and customer records—without splitting the
            operational truth across two menus.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => orders.refetch()}
            className="inline-flex items-center gap-2 rounded-xl border border-[#263f44]/15 bg-white px-3 py-2 text-sm font-semibold text-[#315d57]"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl border border-[#263f44]/15 bg-white px-3 py-2 text-sm font-semibold text-[#315d57]"
          >
            <Printer className="h-4 w-4" /> Print / PDF
          </button>
          <button
            type="button"
            disabled={view !== "orders" || rows.length === 0}
            onClick={() => void exportOrders(rows)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#123039] px-3 py-2 text-sm font-bold text-white disabled:bg-[#a8b7b2]"
          >
            <Download className="h-4 w-4" /> Excel
          </button>
        </div>
      </div>
      <div className="mt-5 inline-flex rounded-xl bg-[#ece9f8] p-1" role="tablist" aria-label="Store workspace view">
        <button type="button" role="tab" aria-selected={view === "orders"} onClick={() => setView("orders")} className={cn("rounded-lg px-4 py-2 text-sm font-bold transition", view === "orders" ? "bg-[#241a45] text-white shadow-sm" : "text-[#5f5a72] hover:text-[#241a45]")}>Store orders</button>
        <button type="button" role="tab" aria-selected={view === "customers"} onClick={() => setView("customers")} className={cn("rounded-lg px-4 py-2 text-sm font-bold transition", view === "customers" ? "bg-[#241a45] text-white shadow-sm" : "text-[#5f5a72] hover:text-[#241a45]")}>Customers</button>
      </div>
      {view === "orders" ? <>
        <OrderPulse rows={rows} loading={orders.isLoading} />
        <section className="mt-6 overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]">
          <div className="grid gap-3 border-b border-[#263f44]/10 p-4 lg:grid-cols-[minmax(0,1fr)_180px_135px_135px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7e8d90]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Order no, invoice, customer or phone"
                className="h-10 w-full rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] pl-9 pr-3 text-sm outline-none focus:border-[#438b82]"
              />
            </div>
            <select
              aria-label="Filter status"
              value={state}
              onChange={(event) =>
                setState(event.target.value as LaundryState | "all")
              }
              className="h-10 rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] px-3 text-sm outline-none focus:border-[#438b82]"
            >
              {states.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All statuses" : option}
                </option>
              ))}
            </select>
            <DateFilter label="From" value={from} onChange={setFrom} />
            <DateFilter label="To" value={to} onChange={setTo} />
          </div>
          <div className="flex items-center justify-between border-b border-[#263f44]/8 px-5 py-2.5 text-xs text-[#617178]">
            <span>
              <strong className="text-[#315d57]">{orders.data?.total ?? rows.length}</strong> matching
              order{rows.length === 1 ? "" : "s"}
            </span>
            <span>
              Print opens the system dialog; choose “Save as PDF” when needed.
            </span>
          </div>
          <OrderTable
            rows={rows}
            loading={orders.isLoading}
            pending={transition.isPending}
            onSelect={openOrderDrawer}
            onOpenCustomer={setSelectedCustomerId}
            onTransition={(id, next, expectedVersion) =>
              transition.mutate({ id, next, expectedVersion })
            }
          />
          <div className="flex items-center justify-between border-t border-[#263f44]/8 px-5 py-3 text-xs text-[#617178]">
            <button type="button" disabled={page <= 1 || orders.isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-[#263f44]/15 bg-white px-3 py-1.5 font-bold text-[#315d57] disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
            <span>Page {orders.data?.page || page} of {orders.data?.totalPages || 1}</span>
            <button type="button" disabled={page >= (orders.data?.totalPages || 1) || orders.isFetching} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-[#263f44]/15 bg-white px-3 py-1.5 font-bold text-[#315d57] disabled:cursor-not-allowed disabled:opacity-40">Next</button>
          </div>
        </section>
      </> : <>
        <CustomerPulse data={customerInsights.data} loading={customerInsights.isLoading} activeToday={activeToday} restricted={restrictedCustomers} />
        {onlineOnlyCustomers.data?.length ? (
          <section className="mt-5 rounded-[20px] border border-[#664cf0]/15 bg-[#f6f4ff] p-5">
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4 text-[#5138cf]" />
              <p className="text-sm font-bold text-[#3a2b8f]">Online-only customers ({onlineOnlyCustomers.data.length})</p>
            </div>
            <p className="mt-1 text-xs text-[#6b5fb0]">Ordered through the app, not yet in your local customer list — they'll appear above automatically once their first order is finalised.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {onlineOnlyCustomers.data.slice(0, 12).map((customer) => (
                <div key={customer.phone} className="rounded-xl border border-[#664cf0]/10 bg-white px-3 py-2.5">
                  <p className="truncate text-sm font-semibold text-[#332b50]">{customer.name}</p>
                  <p className="text-xs text-[#718087]">{customer.phone} · {customer.orderCount} order{customer.orderCount === 1 ? "" : "s"}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <section className="mt-6 overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]">
          <div className="grid gap-3 border-b border-[#263f44]/10 p-4 lg:grid-cols-[minmax(0,1fr)_180px_180px_150px]">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7e8d90]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone or email" className="h-10 w-full rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] pl-9 pr-3 text-sm outline-none focus:border-brand-500" /></div>
            <select aria-label="Filter customer contact status" value={customerStatus} onChange={(event) => setCustomerStatus(event.target.value as CustomerViewStatus)} className="h-10 rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] px-3 text-sm outline-none focus:border-brand-500"><option value="all">All contact states</option><option value="contactable">Contactable</option><option value="restricted">Contact restricted</option></select>
            <select aria-label="Filter customer segment" value={customerSegment} onChange={(event) => setCustomerSegment(event.target.value as CustomerViewSegment)} className="h-10 rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] px-3 text-sm outline-none focus:border-brand-500"><option value="all">All activity</option><option value="new">New</option><option value="repeat">Repeat</option><option value="at_risk">At risk</option><option value="lapsed">Lapsed</option><option value="no_orders">No orders</option><option value="unknown">Date unknown</option></select>
            <select aria-label="Sort customers" value={customerSort} onChange={(event) => setCustomerSort(event.target.value as "newest" | "spend")} className="h-10 rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] px-3 text-sm outline-none focus:border-brand-500"><option value="newest">Latest activity</option><option value="spend">Highest spend</option></select>
          </div>
          <CustomerTable rows={customerRows} loading={customers.isLoading || customerInsights.isLoading} onOpen={setSelectedCustomerId} />
        </section>
      </>}
      {transition.isError ? (
        <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
          {transition.error instanceof Error
            ? operatorErrorMessage(transition.error, "The order status could not be updated.")
            : "The order status could not be updated."}
        </p>
      ) : null}
      {selectedCustomerId ? (
        <CustomerWorkCardDrawer
          id={selectedCustomerId}
          onClose={closeCustomerDrawer}
          onOpenOrder={openOrderDrawer}
        />
      ) : null}
      {selectedOrderId ? (
        <OrderWorkCardDrawer id={selectedOrderId} onClose={closeOrderDrawer} />
      ) : null}
    </div>
  );
}

function OrderPulse({ rows, loading }: { rows: LaundryOrder[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="mt-5 h-[132px] animate-pulse rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]" aria-label="Loading order summary" />
    );
  }

  const counts = new Map<LaundryState, number>();
  for (const order of rows) counts.set(order.state, (counts.get(order.state) || 0) + 1);
  const workInProgress = rows.filter((order) => ["Booked", "Picked Up", "In Process"].includes(order.state)).length;
  const readyToMove = rows.filter((order) => ["Ready", "Out for Delivery"].includes(order.state)).length;
  const paymentAttention = rows.filter((order) => !["paid", "settled"].includes(order.paymentStatus.toLowerCase())).length;
  const stages: Array<{ label: string; state: LaundryState; tone: string }> = [
    { label: "Booked", state: "Booked", tone: "bg-[#eeeaff] text-[#5743d7]" },
    { label: "In process", state: "In Process", tone: "bg-[#e8f3f1] text-[#24776f]" },
    { label: "Ready", state: "Ready", tone: "bg-[#fff1d8] text-[#9a6519]" },
    { label: "Delivered", state: "Delivered", tone: "bg-[#edf5ef] text-[#2d7561]" },
  ];

  return (
    <section className="mt-5 overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]" aria-label="Order pulse for the current view">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#263f44]/8 px-5 py-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#4d8982]">Order pulse</p>
          <p className="mt-0.5 text-xs text-[#718087]">A quick read of the currently loaded order view.</p>
        </div>
        <span className="rounded-full bg-[#f5f2ff] px-3 py-1 text-[11px] font-bold text-[#5743d7]">{rows.length} visible</span>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <PulseMetric icon={<Layers3 className="h-4 w-4" />} label="Active work" value={workInProgress} detail="Booked, picked up or processing" tone="text-[#5743d7] bg-[#eeeaff]" />
        <PulseMetric icon={<CheckCircle2 className="h-4 w-4" />} label="Ready to move" value={readyToMove} detail="Ready or out for delivery" tone="text-[#24776f] bg-[#e8f3f1]" />
        <PulseMetric icon={<CircleDollarSign className="h-4 w-4" />} label="Payment attention" value={paymentAttention} detail="Not marked paid or settled" tone="text-[#9a6519] bg-[#fff1d8]" />
        <PulseMetric icon={<AlertTriangle className="h-4 w-4" />} label="Needs review" value={rows.filter((order) => order.state === "Cancelled").length} detail="Cancelled records in view" tone="text-[#c4554d] bg-[#fff0ee]" />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[#263f44]/8 px-5 py-3">
        <Clock3 className="h-4 w-4 text-[#718087]" aria-hidden="true" />
        <span className="mr-1 text-[10px] font-extrabold uppercase tracking-[.14em] text-[#718087]">Pipeline</span>
        {stages.map((stage, index) => (
          <div key={stage.state} className="flex items-center gap-2">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold", stage.tone)}>
              {stage.label}<span className="tabular-nums">{counts.get(stage.state) || 0}</span>
            </span>
            {index < stages.length - 1 ? <ChevronRight className="h-3.5 w-3.5 text-[#b3bfbb]" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function PulseMetric({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: number; detail: string; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#263f44]/8 bg-[#fbfcfa] px-3 py-2.5">
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl", tone)} aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#718087]">{label}</p>
        <p className="mt-0.5 text-xl font-semibold leading-none tabular-nums text-[#17353c]">{value}</p>
        <p className="mt-1 truncate text-[10px] text-[#718087]">{detail}</p>
      </div>
    </div>
  );
}

function CustomerPulse({ data, loading, activeToday, restricted }: { data?: CustomerInsight; loading: boolean; activeToday: number; restricted: number }) {
  if (loading) return <div className="mt-5 h-[132px] animate-pulse rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]" aria-label="Loading customer summary" />;
  return <section className="mt-5 overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]" aria-label="Customer summary">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#263f44]/8 px-5 py-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#4d8982]">Customer summary</p><p className="mt-0.5 text-xs text-[#718087]">Live values from this store’s customer and order records.</p></div><span className="rounded-full bg-[#f5f2ff] px-3 py-1 text-[11px] font-bold text-[#5743d7]">Current branch</span></div>
    <div className="grid gap-px bg-[#ebe7f6] sm:grid-cols-2 xl:grid-cols-4">
      <CustomerMetric icon={<UserRound className="h-4 w-4" />} label="Total customers" value={String(data?.summary.totalCustomers || 0)} detail="Profiles in this branch" tone="text-[#5743d7]" />
      <CustomerMetric icon={<UserCheck className="h-4 w-4" />} label="Active today" value={String(activeToday)} detail="Customers with an order today" tone="text-emerald-700" />
      <CustomerMetric icon={<UserX className="h-4 w-4" />} label="Contact restricted" value={String(restricted)} detail="No consent or usable contact route" tone="text-rose-700" />
      <CustomerMetric icon={<CircleDollarSign className="h-4 w-4" />} label="Total revenue" value={formatINR(data?.summary.revenue || 0)} detail="Customer revenue, before tax" tone="text-amber-700" />
    </div>
  </section>;
}

function CustomerMetric({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <div className="flex items-center gap-3 bg-white px-4 py-4"><span className={cn("grid h-9 w-9 place-items-center rounded-xl bg-[#f7f5ff]", tone)} aria-hidden="true">{icon}</span><div className="min-w-0"><p className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#718087]">{label}</p><p className="mt-1 text-xl font-semibold leading-none tabular-nums text-[#17353c]">{value}</p><p className="mt-1 truncate text-[10px] text-[#718087]">{detail}</p></div></div>;
}

function CustomerTable({ rows, loading, onOpen }: { rows: Array<{ customer: CustomerRecord; metric: CustomerInsight["customers"][number] | undefined }>; loading: boolean; onOpen: (id: string) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[940px] text-left text-sm"><thead className="bg-[#fafaf7] text-[10px] font-bold uppercase tracking-[.14em] text-[#718087]"><tr><th className="px-5 py-3">Customer</th><th className="px-3 py-3">Phone</th><th className="px-3 py-3">Orders</th><th className="px-3 py-3">Total spent</th><th className="px-3 py-3">Last activity</th><th className="px-3 py-3">Contact</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody>{loading ? <tr><td colSpan={7} className="py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-600" /></td></tr> : rows.length ? rows.map(({ customer, metric }) => <tr key={customer.id} className="border-t border-[#263f44]/8 transition hover:bg-[#faf9ff]"><td className="px-5 py-4"><button type="button" onClick={() => onOpen(customer.id)} className="font-semibold text-brand-700 hover:underline">{customer.name || "Unnamed customer"}</button><span className="mt-1 block max-w-[260px] truncate text-xs text-[#718087]">{customer.email || customer.address || "No additional contact recorded"}</span></td><td className="px-3 py-4 text-[#40565a]">{customer.phone || "—"}</td><td className="px-3 py-4 font-semibold tabular-nums">{metric?.orderCount || 0}</td><td className="px-3 py-4 font-semibold tabular-nums">{formatINR(metric?.revenue || 0)}</td><td className="px-3 py-4 text-xs text-[#617178]">{metric?.lastOrderDate || "No order date"}</td><td className="px-3 py-4"><span className={cn("rounded-full px-2 py-1 text-[10px] font-bold", metric?.contactEligible ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{metric?.contactEligible ? "Contactable" : "Restricted"}</span></td><td className="px-5 py-4 text-right"><button type="button" onClick={() => onOpen(customer.id)} className="rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50">Open profile</button></td></tr>) : <tr><td colSpan={7}><VisualEmptyState kind="customers" compact title="No customers match these filters" detail="Clear a filter or create a new customer account from the customer directory." /></td></tr>}</tbody></table></div>;
}

function useDrawerFocus() {
  const drawerRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => (initialFocusRef.current || drawerRef.current)?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (priorFocusRef.current?.isConnected) priorFocusRef.current.focus();
    };
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []).filter((element) => !element.hasAttribute("hidden"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!focusable.includes(document.activeElement as HTMLElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { drawerRef, initialFocusRef, onKeyDown };
}

function CustomerWorkCardDrawer({ id, onClose, onOpenOrder }: { id: string; onClose: () => void; onOpenOrder: (id: string) => void }) {
  const [section, setSection] = useState<"activity" | "orders" | "ledger">("activity");
  const { drawerRef, initialFocusRef, onKeyDown } = useDrawerFocus();
  const profile = useQuery({
    queryKey: ["laundry-customer-work-card", id],
    queryFn: () => apiGet<CustomerDrawerProfile>(`/laundry/customers/${id}`),
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const customer = profile.data?.customer;
  const metrics = profile.data?.metrics;
  const address = profile.data?.addresses.find((entry) => entry.isDefault && entry.active) || profile.data?.addresses.find((entry) => entry.active);
  const tabs: Array<{ value: "activity" | "orders" | "ledger"; label: string }> = [
    { value: "activity", label: "Activity" },
    { value: "orders", label: "Orders" },
    { value: "ledger", label: "Ledger" },
  ];

  return <>
    <button type="button" aria-label="Close customer work card" onClick={onClose} className="fixed inset-0 z-40 cursor-default bg-[#171024]/65 backdrop-blur-[2px]" />
    <aside ref={drawerRef} onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-labelledby="customer-work-card-title" className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-[#272043]/10 bg-[#fffdfb] shadow-[-22px_0_60px_rgba(32,23,60,.22)] animate-in slide-in-from-right duration-300 sm:w-[min(34vw,560px)] sm:min-w-[440px]">
      <header className="relative overflow-hidden border-b border-[#272043]/10 bg-[#fcfbff] px-5 py-5">
        <div className="pointer-events-none absolute -left-14 -top-16 h-36 w-36 rounded-full bg-brand-100/75 blur-2xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[.17em] text-brand-700">Customer work card</p>
            {profile.isLoading ? <div className="mt-2 h-7 w-48 animate-pulse rounded bg-brand-100" /> : <><h2 id="customer-work-card-title" className="mt-1 truncate font-serif text-2xl text-[#21183d]">{customer?.name || "Customer profile"}</h2><p className="mt-1 text-sm text-[#6d6682]">{customer?.phone || "No phone recorded"}{customer?.email ? ` · ${customer.email}` : ""}</p></>}
          </div>
          <button ref={initialFocusRef} type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#272043]/10 bg-white text-[#554d6d] transition hover:bg-brand-50 hover:text-brand-800" aria-label="Close customer work card"><X className="h-4 w-4" /></button>
        </div>
      </header>
      {profile.isLoading ? <div className="grid flex-1 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand-600" /></div> : profile.isError || !profile.data ? <div className="m-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p className="font-bold">Customer details could not be loaded.</p><p className="mt-1 text-xs">Close this card, then try again from the customer list.</p></div> : <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-px border-b border-[#272043]/10 bg-[#eae7f4] sm:grid-cols-4">
          <DrawerMetric label="Total spend" value={formatINR(metrics?.revenue || 0)} tone="text-brand-700" />
          <DrawerMetric label="Due balance" value={formatINR(metrics?.orderBalance || 0)} tone="text-amber-700" />
          <DrawerMetric label="Wallet" value={formatINR(metrics?.walletBalance || 0)} tone="text-emerald-700" />
          <DrawerMetric label="Rewards" value={String(metrics?.rewardPoints || 0)} tone="text-[#7a4cbb]" />
        </div>
        <div className="px-5 pt-4">
          <div className="flex rounded-xl bg-[#f1eff8] p-1" role="tablist" aria-label="Customer work card sections">
            {tabs.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={section === tab.value} onClick={() => setSection(tab.value)} className={cn("flex-1 rounded-lg px-2 py-2 text-xs font-bold transition", section === tab.value ? "bg-white text-brand-800 shadow-sm" : "text-[#756e89] hover:text-brand-800")}>{tab.label}</button>)}
          </div>
        </div>
        {section === "activity" ? <div className="space-y-4 px-5 py-4">
          <section className="rounded-2xl border border-[#272043]/10 bg-white p-4">
            <p className="text-[10px] font-extrabold uppercase tracking-[.15em] text-[#777086]">Customer details</p>
            <div className="mt-3 grid gap-3 text-sm">
              <div className="flex items-start gap-2.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /><div><p className="font-semibold text-[#2b2344]">{address ? `${address.label} address` : "No default address"}</p><p className="mt-0.5 text-xs leading-5 text-[#746d82]">{address ? [address.line1, address.line2, address.city, address.state, address.postalCode].filter(Boolean).join(", ") : customer?.address || "Add an address when needed for pickup or delivery."}</p></div></div>
              <div className="flex items-start gap-2.5"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /><div><p className="font-semibold text-[#2b2344]">Latest visit</p><p className="mt-0.5 text-xs text-[#746d82]">{metrics?.lastVisit ? new Date(`${metrics.lastVisit}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "No completed visit recorded"}</p></div></div>
              <div className="flex items-start gap-2.5"><WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /><div><p className="font-semibold text-[#2b2344]">Current package</p><p className="mt-0.5 text-xs text-[#746d82]">{metrics?.currentPackage || "No active package"}</p></div></div>
            </div>
          </section>
          <section className="rounded-2xl border border-[#272043]/10 bg-white p-4"><p className="text-[10px] font-extrabold uppercase tracking-[.15em] text-[#777086]">Recent activity</p><div className="mt-3 space-y-3">{profile.data.timeline.length ? profile.data.timeline.slice(0, 6).map((entry) => <div key={`${entry.at}:${entry.label}`} className="flex gap-2.5"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" /><div className="min-w-0"><p className="text-xs font-semibold text-[#3b3253]">{entry.label}</p><p className="mt-0.5 text-[11px] text-[#7b7488]">{new Date(entry.at).toLocaleString("en-IN")} {entry.amount ? ` · ${formatINR(entry.amount)}` : ""}</p></div></div>) : <p className="text-xs text-[#7b7488]">No customer activity recorded yet.</p>}</div></section>
        </div> : null}
        {section === "orders" ? <div className="space-y-2 px-5 py-4">{profile.data.orders.length ? <>
          <p className="px-1 text-[11px] leading-4 text-[#746d82]">Invoice and order details stay in this customer profile. Select the eye only when you want the separate full order work card.</p>
          {profile.data.orders.map((order) => <article key={order.id} className="rounded-2xl border border-[#272043]/10 bg-white p-3 transition hover:border-brand-200 hover:bg-brand-50/20"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-bold text-[#332849]">{order.invoice || order.orderNumber}</p><p className="mt-1 text-xs text-[#746d82]">{order.invoice ? order.orderNumber : "No invoice yet"} · {date(order.orderDate)} · {order.paymentStatus}</p></div><div className="flex shrink-0 items-center gap-2"><StatePill state={order.state as LaundryState} /><button type="button" onClick={() => onOpenOrder(order.id)} className="grid h-8 w-8 place-items-center rounded-lg border border-brand-200 bg-white text-brand-700 transition hover:bg-brand-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2" aria-label={`View order ${order.invoice || order.orderNumber}`} title="Open full order work card"><Eye className="h-4 w-4" /></button></div></div><div className="mt-3 flex items-center justify-between border-t border-[#272043]/8 pt-2 text-xs"><span className="text-[#746d82]">{order.expectedDeliveryDate ? `Due ${date(order.expectedDeliveryDate)}` : "No due date"}</span><span className="font-bold tabular-nums text-[#332849]">{formatINR(order.grandTotal)}</span></div></article>)}
        </> : <VisualEmptyState kind="orders" compact title="No orders for this customer" detail="The booking history will appear here after the first order." />}</div> : null}
        {section === "ledger" ? <div className="space-y-2 px-5 py-4">{profile.data.ledger.length ? profile.data.ledger.slice(0, 12).map((entry) => <div key={entry.id} className="rounded-xl border border-[#272043]/10 bg-white px-3 py-3"><div className="flex justify-between gap-3"><div><p className="text-xs font-bold text-[#352b4b]">{entry.entryType}</p><p className="mt-1 text-[11px] text-[#7a7388]">{entry.reason || entry.referenceId || "Customer ledger entry"}</p></div><div className="text-right text-xs tabular-nums"><p className={entry.debit ? "font-bold text-rose-700" : "font-bold text-emerald-700"}>{entry.debit ? `−${formatINR(entry.debit)}` : `+${formatINR(entry.credit)}`}</p><p className="mt-1 text-[10px] text-[#8a8397]">{date(entry.entryDate)}</p></div></div></div>) : <VisualEmptyState kind="finance" compact title="No ledger entries" detail="Payments, invoices, credits and wallet activity will be listed here." />}</div> : null}
      </div>}
    </aside>
  </>;
}

function DrawerMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="bg-[#fffdfb] px-3 py-3"><p className="text-[9px] font-extrabold uppercase tracking-[.12em] text-[#817a8e]">{label}</p><p className={cn("mt-1 text-base font-semibold tabular-nums", tone)}>{value}</p></div>;
}

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#718087]">
      {label}
      <input
        aria-label={`${label} date`}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block h-8 w-full rounded-lg border border-[#263f44]/15 bg-[#fbfbf9] px-2 text-sm font-normal normal-case tracking-normal text-[#40565a]"
      />
    </label>
  );
}
function OrderTable({
  rows,
  loading,
  pending,
  onSelect,
  onOpenCustomer,
  onTransition,
}: {
  rows: LaundryOrder[];
  loading: boolean;
  pending: boolean;
  onSelect: (id: string) => void;
  onOpenCustomer: (id: string) => void;
  onTransition: (
    id: string,
    next: LaundryState,
    expectedVersion?: number,
  ) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[870px] text-left text-sm">
        <thead className="bg-[#fafaf7] text-[10px] font-bold uppercase tracking-[.14em] text-[#718087]">
          <tr>
            <th className="px-5 py-3">Invoice / order</th>
            <th className="px-3 py-3">Customer</th>
            <th className="px-3 py-3">Dates</th>
            <th className="px-3 py-3">Amount</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-5 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={6} className="py-16 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#3a7d78]" />
              </td>
            </tr>
          ) : rows.length ? (
            rows.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                pending={pending}
                onSelect={onSelect}
                onOpenCustomer={onOpenCustomer}
                onTransition={onTransition}
              />
            ))
          ) : (
            <tr>
              <td colSpan={6} className="text-center">
                <VisualEmptyState kind="orders" compact title="No orders match this view" detail="Clear a filter or book the first order for this branch." />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function OrderRow({
  order,
  pending,
  onSelect,
  onOpenCustomer,
  onTransition,
}: {
  order: LaundryOrder;
  pending: boolean;
  onSelect: (id: string) => void;
  onOpenCustomer: (id: string) => void;
  onTransition: (
    id: string,
    next: LaundryState,
    expectedVersion?: number,
  ) => void;
}) {
  const next = nextLaundryState[order.state];
  const needsRider = next === "Out for Delivery" && !order.deliveryRider;
  return (
    <tr
      className={cn(
        "border-t border-[#263f44]/8 transition hover:bg-[#f7f8f4]",
      )}
    >
      <td
        className="cursor-pointer px-5 py-4"
        onClick={() => onSelect(order.id)}
      >
        <span className="block font-bold text-[#205660]">
          {order.invoiceNumber || "—"}
        </span>
        <span className="text-xs text-[#718087]">
          {order.orderNumber} · {order.itemCount} items
        </span>
      </td>
      <td className="cursor-pointer px-3 py-4" onClick={() => onSelect(order.id)}>
        {order.customer.id ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenCustomer(order.customer.id!);
            }}
            className="block w-fit font-semibold text-brand-700 underline-offset-4 hover:text-brand-900 hover:underline"
            title={`Open ${order.customer.name}'s customer record`}
          >
            {order.customer.name}
          </button>
        ) : (
          <span className="block font-medium">{order.customer.name}</span>
        )}
        <span className="text-xs text-[#718087]">{order.customer.phone}</span>
      </td>
      <td
        className="cursor-pointer px-3 py-4 text-xs text-[#617178]"
        onClick={() => onSelect(order.id)}
      >
        <span className="block">Booked {date(order.orderDate)}</span>
        <span className="mt-1 block">
          Due {date(order.expectedDeliveryDate)}
        </span>
      </td>
      <td className="px-3 py-4 font-bold tabular-nums">
        {formatINR(order.grandTotal)}
      </td>
      <td className="px-3 py-4">
        <StatePill state={order.state} />
      </td>
      <td className="px-5 py-4 text-right">
        {next ? (
          needsRider ? (
            <Link
              to="/laundry/dispatch"
              className="inline-flex items-center gap-1 rounded-lg bg-[#e7f3ed] px-2.5 py-1.5 text-xs font-bold text-[#2b6c62]"
            >
              Assign captain
              <Truck className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <button
              disabled={pending}
              onClick={() => onTransition(order.id, next, order.version)}
              className="inline-flex items-center gap-1 rounded-lg bg-[#123039] px-2.5 py-1.5 text-xs font-bold text-white hover:bg-[#1d4a53]"
            >
              {next}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )
        ) : (
          <button
            onClick={() => onSelect(order.id)}
            className="text-xs font-bold text-[#39786f]"
          >
            View
          </button>
        )}
      </td>
    </tr>
  );
}
type OrderTag = {
  tagNumber: string;
  garment: string;
  service: string;
  sequence: number;
  total: number;
  orderDate: string;
  expectedDeliveryDate: string;
};
function TraceabilitySummary({ order }: { order: LaundryOrder & { tags?: Array<OrderTag> } }) {
  const expectedPieces = order.items.reduce((sum, item) => /^(piece|pair)$/i.test(item.unit) ? sum + item.qty : sum, 0);
  const units = order.physicalUnits || [];
  const containers = order.containers || [];
  const accounted = expectedPieces === units.length;
  return <section className="mt-4 rounded-xl border border-[#39786f]/20 bg-[#f3faf6] p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#39786f]">Assembly safety · garment traceability</p><p className="mt-1 text-xs text-[#52676b]">{expectedPieces ? `${units.length} of ${expectedPieces} expected piece tags accounted for.` : containers.length ? `${containers.length} explicit container tag${containers.length === 1 ? '' : 's'} accounted for; no piece tags fabricated for bulk lines.` : 'No physical identity has been recorded yet.'}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${accounted ? 'bg-[#dcefe5] text-[#2e6a60]' : 'bg-amber-100 text-amber-800'}`}>{expectedPieces ? accounted ? 'Ready to assemble' : 'Hold · investigate mismatch' : containers.length ? 'Container-controlled' : 'Identity pending'}</span></div>
    {units.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{units.map((unit) => <div key={unit.id} className="rounded-lg border border-[#39786f]/10 bg-white px-2.5 py-2 text-[10px]"><div className="flex items-center justify-between gap-2"><span className="font-mono font-bold text-[#315d57]">{unit.tagCode}</span><span className="rounded-full bg-[#eaf3ef] px-1.5 py-0.5 font-bold text-[#2e6a60]">{unit.state}</span></div><p className="mt-1 truncate text-[#617178]">{unit.garment.name} · {unit.service.name} · {unit.location || 'No location'} · {unit.condition}</p><Link to={`/laundry/garment-tracking?tag=${encodeURIComponent(unit.tagCode)}`} className="mt-1 inline-block font-bold text-[#39786f]">Scan · history · reprint · replace</Link></div>)}</div> : null}
    <div className="mt-3 flex flex-wrap gap-2"><Link to={`/laundry/garment-tracking?tag=${encodeURIComponent(units[0]?.tagCode || containers[0]?.tagCode || '')}`} className="rounded-lg border border-[#39786f]/20 bg-white px-3 py-1.5 text-[10px] font-bold text-[#39786f]">Open tracking</Link><Link to={`/laundry/print-centre?order=${encodeURIComponent(order.id)}`} className="rounded-lg border border-[#39786f]/20 bg-white px-3 py-1.5 text-[10px] font-bold text-[#39786f]">Open Print Centre</Link></div>
  </section>;
}
function OrderWorkCardPage({ id }: { id: string }) {
  return <Navigate replace to={`/laundry/orders?order=${encodeURIComponent(id)}`} />;
}

function OrderWorkCardDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { drawerRef, onKeyDown } = useDrawerFocus();
  const detail = useQuery({
    queryKey: ["laundry-order", id],
    queryFn: () => apiGet<LaundryOrder & { timeline: Array<{ id: string; ts: string; action: string }>; tags?: Array<OrderTag> }>(`/laundry/orders/${id}`),
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <>
    <button type="button" aria-label="Close order work card" onClick={onClose} className="fixed inset-0 z-40 cursor-default bg-[#171024]/65 backdrop-blur-[2px]" />
    <aside ref={drawerRef} onKeyDown={onKeyDown} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Order work card" className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto border-l border-[#272043]/10 bg-[#fffdfb] px-4 py-5 shadow-[-22px_0_60px_rgba(32,23,60,.22)] animate-in slide-in-from-right duration-300 sm:w-[min(52vw,820px)] sm:min-w-[520px] sm:px-5">
      <OrderDetail order={detail.data} loading={detail.isLoading} onClose={onClose} presentation="drawer" />
    </aside>
  </>;
}

function OrderDetail({
  order,
  loading,
  onClose,
  presentation = "panel",
}: {
  order?: LaundryOrder & {
    timeline: Array<{ id: string; ts: string; action: string }>;
    tags?: Array<OrderTag>;
  };
  loading: boolean;
  onClose: () => void;
  presentation?: "panel" | "page" | "drawer";
}) {
  const client = useQueryClient();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"Cash" | "UPI" | "Card" | "Bank">("Cash");
  const [cashRegister, setCashRegister] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [fulfilmentItem, setFulfilmentItem] = useState("0");
  const [fulfilmentStage, setFulfilmentStage] =
    useState<LaundryFulfillmentEvent["stage"]>("Picked Up");
  const [fulfilmentQty, setFulfilmentQty] = useState("");
  const [fulfilmentNote, setFulfilmentNote] = useState("");
  const [editingOrder, setEditingOrder] = useState(false);
  const [editLines, setEditLines] = useState<
    Array<{ garment: string; service: string; qty: string }>
  >([]);
  const [error, setError] = useState("");
  const paymentQuery = useQuery({
    queryKey: ["laundry-order-payments", order?.id],
    queryFn: () =>
      apiGet<LaundryPaymentSummary>(`/laundry/orders/${order!.id}/payments`),
    enabled: Boolean(order?.id),
  });
  const cashShifts = useQuery({
    queryKey: ["laundry-order-cash-shifts"],
    queryFn: () =>
      apiGet<Array<{ id: string; status: string; register: string }>>(
        "/laundry/cash-shifts",
      ),
    enabled: mode === "Cash" && Boolean(order?.id),
    retry: false,
  });
  const fulfilmentQuery = useQuery({
    queryKey: ["laundry-order-fulfilment", order?.id],
    queryFn: () =>
      apiGet<LaundryFulfillmentEvent[]>(
        `/laundry/orders/${order!.id}/fulfillment`,
      ),
    enabled: Boolean(order?.id),
  });
  const catalogueQuery = useQuery({
    queryKey: ["laundry-order-edit-catalogue"],
    queryFn: () => apiGet<LaundryCatalogue>("/laundry/catalogue"),
    enabled: editingOrder,
  });
  const collect = useMutation({
    mutationFn: () =>
      apiPost<{ summary: LaundryPaymentSummary }>(
        `/laundry/orders/${order!.id}/payments`,
        {
          amount: Number(amount),
          mode,
          reference,
          note,
          cashRegister: mode === "Cash" ? cashRegister || undefined : undefined,
        },
      ),
    onSuccess: () => {
      setAmount("");
      setReference("");
      setNote("");
      setCashRegister("");
      setError("");
      void paymentQuery.refetch();
      client.invalidateQueries({ queryKey: ["laundry-orders"] });
      client.invalidateQueries({ queryKey: ["laundry-order", order?.id] });
    },
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Payment could not be recorded.",
      ),
  });
  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiPost<LaundryPaymentSummary>(`/laundry/payments/${id}/reverse`, {
        reason,
      }),
    onSuccess: () => {
      setReverseTarget(null);
      setReverseReason("");
      setError("");
      void paymentQuery.refetch();
      client.invalidateQueries({ queryKey: ["laundry-orders"] });
      client.invalidateQueries({ queryKey: ["laundry-order", order?.id] });
    },
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Payment could not be reversed.",
      ),
  });
  const fulfilment = useMutation({
    mutationFn: () =>
      apiPost<LaundryFulfillmentEvent>(
        `/laundry/orders/${order!.id}/fulfillment`,
        {
          itemIndex: Number(fulfilmentItem),
          stage: fulfilmentStage,
          quantity: Number(fulfilmentQty),
          note: fulfilmentNote,
        },
      ),
    onSuccess: () => {
      setFulfilmentQty("");
      setFulfilmentNote("");
      setError("");
      void fulfilmentQuery.refetch();
    },
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Fulfilment event could not be recorded.",
      ),
  });
  const cancelOrder = useMutation({
    mutationFn: (reason: string) =>
      apiPost<LaundryOrder>(`/laundry/orders/${order!.id}/cancel`, {
        reason,
        expectedVersion: order!.version,
      }),
    onSuccess: () => {
      setCancelReason("");
      setShowCancel(false);
      setError("");
      void paymentQuery.refetch();
      client.invalidateQueries({ queryKey: ["laundry-orders"] });
      client.invalidateQueries({ queryKey: ["laundry-order", order?.id] });
      client.invalidateQueries({ queryKey: ["laundry-dashboard"] });
      client.invalidateQueries({ queryKey: ["laundry-reports"] });
    },
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Order could not be cancelled.",
      ),
  });
  const editOrder = useMutation({
    mutationFn: () =>
      apiPatch<LaundryOrder>(`/laundry/orders/${order!.id}`, {
        items: editLines.map((line) => ({
          garment: line.garment,
          service: line.service,
          qty: Number(line.qty),
        })),
        expectedDeliveryDate: order!.expectedDeliveryDate,
        fulfillmentMode: order!.fulfillmentMode,
        charges: order!.charges,
        discounts: order!.discounts,
        taxRate: order!.taxRate,
        notes: order!.notes,
        deliveryAddress: order!.deliveryAddress,
        serviceZone: order!.serviceZone,
        expectedVersion: order!.version,
      }),
    onSuccess: () => {
      setEditingOrder(false);
      setEditLines([]);
      setError("");
      client.invalidateQueries({ queryKey: ["laundry-orders"] });
      client.invalidateQueries({ queryKey: ["laundry-order", order?.id] });
      client.invalidateQueries({ queryKey: ["laundry-dashboard"] });
      client.invalidateQueries({ queryKey: ["laundry-reports"] });
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : "Order could not be edited.",
      ),
  });
  if (!order && !loading)
    return (
      <aside className="rounded-[22px] border border-dashed border-[#99afa8] bg-[#fbfcf8] p-6 text-center text-sm text-[#718087]">
        <Tag className="mx-auto mb-3 h-5 w-5 text-[#55938a]" />
        Select an order to review its garments, payment, captain, and audit trail.
      </aside>
    );
  if (loading || !order)
    return (
      <aside className="grid h-80 place-items-center rounded-[22px] border border-[#263f44]/10 bg-white">
        <Loader2 className="h-5 w-5 animate-spin text-[#3a7d78]" />
      </aside>
    );
  const rider = order.deliveryRider || order.pickupRider;
  const summary = paymentQuery.data;
  return (
    <aside className={cn("h-fit rounded-[22px] border border-[#263f44]/10 bg-[#fffdf8] p-5 shadow-[0_8px_28px_rgba(37,48,43,.05)]", presentation === "page" ? "mx-auto max-w-[1180px]" : presentation === "drawer" ? "border-0 bg-transparent p-0 shadow-none" : "xl:sticky xl:top-24")}>
      <div className="flex justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Order work card
          </p>
          <h2 className="mt-1 font-serif text-xl text-[#17353c]">
            {order.orderNumber}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[#f0eee9]"
            aria-label="Back to Store Orders and Customers"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-white p-3">
        <div>
          <p className="font-semibold">{order.customer.name}</p>
          <p className="text-xs text-[#718087]">{order.customer.phone}</p>
        </div>
        <StatePill state={order.state} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {!["Delivered", "Cancelled"].includes(order.state) ? (
          <button
            type="button"
            onClick={() => {
              setEditingOrder(true);
              setEditLines(
                order.items.map((item) => ({
                  garment: item.garment || "",
                  service: item.service || "",
                  qty: String(item.qty),
                })),
              );
              setError("");
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#39786f]/25 bg-[#eaf3ef] px-3 py-2 text-xs font-bold text-[#39786f]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit items
          </button>
        ) : (
          <span />
        )}
        {!["Delivered", "Cancelled"].includes(order.state) ? (
          <button
            type="button"
            disabled={cancelOrder.isPending}
            onClick={() => {
              setShowCancel((visible) => !visible);
              setError("");
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-60"
          >
            <Ban className="h-3.5 w-3.5" />
            {showCancel ? "Close cancellation" : cancelOrder.isPending ? "Cancelling…" : "Cancel order"}
          </button>
        ) : null}
      </div>
      {showCancel ? (
        <section className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs font-bold text-rose-800">Cancellation reason required</p>
          <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Explain why this order is being cancelled" className="mt-2 min-h-16 w-full rounded-lg border border-rose-200 bg-white p-2 text-xs outline-none focus:border-rose-400" />
          <div className="mt-2 flex gap-2"><button type="button" onClick={() => setShowCancel(false)} className="flex-1 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700">Keep order</button><button type="button" disabled={cancelOrder.isPending || !cancelReason.trim()} onClick={() => cancelOrder.mutate(cancelReason.trim())} className="flex-1 rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{cancelOrder.isPending ? "Cancelling…" : "Confirm cancellation"}</button></div>
        </section>
      ) : null}
      <div className="mt-4 space-y-2">
        {order.items.map((item, index) => (
          <div
            key={`${item.garmentName}:${index}`}
            className="rounded-xl border border-[#263f44]/8 bg-white p-3 text-sm"
          >
            <div className="flex justify-between">
              <span>
                <span className="block font-medium">{item.garmentName}</span>
                <span className="text-xs text-[#718087]">
                  {item.serviceName} · {item.qty} {item.unit.toLowerCase()}
                </span>
              </span>
              <span className="font-bold tabular-nums">
                {formatINR(item.amount)}
              </span>
            </div>
            {item.fulfilment ? (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#718087]">
                <span>
                  Received {item.fulfilment.received}/{item.fulfilment.ordered}
                </span>
                <span className="font-semibold text-[#39786f]">
                  Delivered {item.fulfilment.delivered}
                </span>
                <span
                  className={
                    item.fulfilment.pending
                      ? "font-semibold text-[#a97420]"
                      : ""
                  }
                >
                  Pending {item.fulfilment.pending}
                </span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <TraceabilitySummary order={order} />
      {editingOrder ? (
        <section className="mt-3 rounded-xl border border-[#39786f]/20 bg-[#f3faf6] p-3">
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#39786f]">
            Controlled edit
          </p>
          <p className="mt-1 text-[10px] leading-4 text-[#617178]">
            Only unpaid orders can be amended. A replacement invoice and
            explicit ledger adjustment preserve the original history.
          </p>
          <OrderItemEditor
            order={order}
            lines={editLines}
            setLines={setEditLines}
            catalogue={catalogueQuery.data}
            loading={catalogueQuery.isLoading}
            failed={catalogueQuery.isError}
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={editOrder.isPending}
              onClick={() => editOrder.mutate()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#39786f] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              {editOrder.isPending ? "Saving…" : "Save replacement"}
            </button>
            <button
              type="button"
              onClick={() => setEditingOrder(false)}
              className="rounded-lg border border-[#39786f]/20 px-3 py-2 text-xs font-bold text-[#39786f]"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}
      <div className="mt-4 flex justify-between border-t border-[#263f44]/10 pt-4">
        <span className="text-sm text-[#617178]">
          {summary?.status || order.paymentStatus} · {order.paymentMode}
        </span>
        <span className="font-serif text-xl">
          {formatINR(summary?.total ?? order.grandTotal)}
        </span>
      </div>
      <div className="mt-4 rounded-xl bg-[#eaf3ef] p-3 text-xs text-[#32695f]">
        <Truck className="mr-1.5 inline h-4 w-4" />
        {rider
          ? `${rider.name}${rider.phone ? ` · ${rider.phone}` : ""}`
          : "No captain assigned"}{" "}
        · {order.fulfillmentMode}
      </div>
      <section className="mt-4 rounded-xl border border-[#263f44]/10 bg-white p-3">
        <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#648077]">
          Fulfilment details
        </p>
        <p className="mt-1 text-xs leading-5 text-[#617178]">
          {order.deliveryAddress || "No delivery address recorded."}
        </p>
        {order.photoPaths && (
          <img
            src={order.photoPaths}
            alt="Attached garment"
            className="mt-2 h-20 w-20 rounded-lg object-cover ring-1 ring-[#263f44]/10"
          />
        )}
        <div className="mt-3 border-t border-dashed border-[#263f44]/10 pt-3">
          <p className="text-xs font-semibold text-[#40565a]">
            Record item progress
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select
              aria-label="Fulfilment item"
              value={fulfilmentItem}
              onChange={(event) => setFulfilmentItem(event.target.value)}
              className="h-8 rounded-lg border border-[#263f44]/15 bg-white px-2 text-xs"
            >
              {order.items.map((item, index) => (
                <option key={index} value={index}>
                  {index + 1}. {item.garmentName}
                </option>
              ))}
            </select>
            <select
              aria-label="Fulfilment stage"
              value={fulfilmentStage}
              onChange={(event) =>
                setFulfilmentStage(
                  event.target.value as LaundryFulfillmentEvent["stage"],
                )
              }
              className="h-8 rounded-lg border border-[#263f44]/15 bg-white px-2 text-xs"
            >
              <option>Picked Up</option>
              <option>In Process</option>
              <option>Ready</option>
              <option>Delivered</option>
            </select>
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={fulfilmentQty}
              onChange={(event) => setFulfilmentQty(event.target.value)}
              type="number"
              min="0.01"
              step="0.01"
              placeholder={`Qty (${order.items[Number(fulfilmentItem)]?.unit || "Piece"})`}
              className="h-8 w-24 rounded-lg border border-[#263f44]/15 px-2 text-xs"
            />
            <input
              value={fulfilmentNote}
              onChange={(event) => setFulfilmentNote(event.target.value)}
              placeholder="Progress note (optional)"
              className="h-8 min-w-0 flex-1 rounded-lg border border-[#263f44]/15 px-2 text-xs"
            />
          </div>
          <button
            type="button"
            disabled={fulfilment.isPending || !Number(fulfilmentQty)}
            onClick={() => fulfilment.mutate()}
            className="mt-2 h-8 w-full rounded-lg bg-[#3a7d78] text-xs font-bold text-white disabled:bg-[#a8b7b2]"
          >
            {fulfilment.isPending ? "Saving…" : "Save progress event"}
          </button>
          {fulfilmentQuery.data?.length ? (
            <div className="mt-2 space-y-1">
              {fulfilmentQuery.data
                .slice()
                .reverse()
                .map((event) => (
                  <div
                    key={event.id}
                    className="flex justify-between rounded-lg bg-[#f7faf7] px-2 py-1.5 text-[10px] text-[#617178]"
                  >
                    <span>
                      <strong>{event.stage}</strong> · item{" "}
                      {event.itemIndex + 1}
                    </span>
                    <span>
                      {event.quantity} {event.unit}
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-2 text-[10px] text-[#819094]">
              No item-level events recorded yet.
            </p>
          )}
        </div>
      </section>
      {order.tags?.length ? (
        <section className="mt-4 rounded-xl border border-[#664cf0]/15 bg-[#f7f5ff] p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-[#5b45c8]">
              <Tag className="h-3.5 w-3.5" />
              Garment tags
            </p>
            <span className="text-[10px] font-semibold text-[#756e9a]">
              {order.tags.length} physical unit
              {order.tags.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {order.tags.map((tag) => (
              <div
                key={tag.tagNumber}
                className="rounded-lg border border-[#664cf0]/10 bg-white p-2.5"
              >
                <p className="text-xs font-bold text-[#4b3bb0]">
                  {tag.tagNumber}{" "}
                  <span className="font-normal text-[#8178a8]">
                    · {tag.sequence}/{tag.total}
                  </span>
                </p>
                <p className="mt-1 text-xs font-semibold text-[#443b58]">
                  {tag.garment}
                </p>
                <p className="text-[10px] text-[#8178a8]">
                  {tag.service} · Due {tag.expectedDeliveryDate} · {order.physicalUnits?.find((unit) => unit.tagCode === tag.tagNumber)?.state || "Active"}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className="mt-5 rounded-2xl border border-[#664cf0]/15 bg-[#f7f5ff] p-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-[#5b45c8]">
            <CircleDollarSign className="h-3.5 w-3.5" />
            Collection ledger
          </p>
          {summary && (
            <span className="text-xs font-bold text-[#4b3bb0]">
              {formatINR(summary.outstanding)} due
            </span>
          )}
        </div>
        {summary && (
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-xs">
            <div className="rounded-lg bg-white p-2">
              <span className="block text-[#7b739d]">Total</span>
              <strong>{formatINR(summary.total)}</strong>
            </div>
            <div className="rounded-lg bg-white p-2">
              <span className="block text-[#7b739d]">Paid</span>
              <strong>{formatINR(summary.paid)}</strong>
            </div>
            <div className="rounded-lg bg-white p-2">
              <span className="block text-[#7b739d]">Status</span>
              <strong>{summary.status}</strong>
            </div>
          </div>
        )}
        {summary?.outstanding ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#6d6594]">
                Amount
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  type="number"
                  min="0.01"
                  max={summary.outstanding}
                  step="0.01"
                  placeholder={String(summary.outstanding)}
                  className="mt-1 h-9 w-full rounded-lg border border-[#664cf0]/20 bg-white px-2 text-sm font-semibold normal-case tracking-normal text-[#30265f]"
                />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#6d6594]">
                Method
                <select
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as typeof mode)
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-[#664cf0]/20 bg-white px-2 text-sm font-semibold normal-case tracking-normal text-[#30265f]"
                >
                  <option>Cash</option>
                  <option>UPI</option>
                  <option>Card</option>
                  <option>Bank</option>
                </select>
              </label>
            </div>
            {mode === "Cash" && cashShifts.data?.filter((shift) => shift.status === "Open").length ? (
              <label className="mt-2 block text-[10px] font-bold uppercase tracking-[.12em] text-[#6d6594]">
                Cash register
                <select value={cashRegister} onChange={(event) => setCashRegister(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#664cf0]/20 bg-white px-2 text-xs font-semibold normal-case tracking-normal text-[#30265f]"><option value="">{cashShifts.data.filter((shift) => shift.status === "Open").length === 1 ? "Main / only open register" : "Choose an open register"}</option>{cashShifts.data.filter((shift) => shift.status === "Open").map((shift) => <option key={shift.id} value={shift.register}>{shift.register}</option>)}</select>
              </label>
            ) : mode === "Cash" ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[10px] font-semibold text-amber-800">Open a cash register before recording cash.</p> : null}
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Reference / receipt no. (optional)"
              className="mt-2 h-9 w-full rounded-lg border border-[#664cf0]/20 bg-white px-2 text-xs outline-none"
            />
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Collection note (optional)"
              className="mt-2 h-9 w-full rounded-lg border border-[#664cf0]/20 bg-white px-2 text-xs outline-none"
            />
            <button
              type="button"
              disabled={collect.isPending || !Number(amount)}
              onClick={() => collect.mutate()}
              className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#664cf0] text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-[#b8afe8]"
            >
              {collect.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CircleDollarSign className="h-3.5 w-3.5" />
              )}
              Record collection
            </button>
          </>
        ) : (
          <p className="mt-3 rounded-lg bg-white p-2 text-xs font-semibold text-[#4b3bb0]">
            This invoice is fully settled.
          </p>
        )}
        {summary?.payments.length ? (
          <div className="mt-3 space-y-1.5">
            {summary.payments.map((payment) => (
              <div key={payment.id}>
              <div
                key={payment.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2 text-xs"
              >
                <span>
                  <strong>{formatINR(payment.amount)}</strong> · {payment.mode}
                  <span className="block text-[10px] text-[#8178a8]">
                    {payment.reference || payment.postingDate} ·{" "}
                    {payment.providerStatus}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={reverse.isPending}
                  onClick={() => {
                    setReverseTarget(payment.id);
                    setReverseReason("");
                    setError("");
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-bold text-rose-700 hover:bg-rose-50"
                  title="Reverse collection"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reverse
                </button>
              </div>
              {reverseTarget === payment.id ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-2">
                  <input value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} placeholder="Reason for reversal" className="h-8 w-full rounded-md border border-rose-200 bg-white px-2 text-xs outline-none focus:border-rose-400" />
                  <div className="mt-2 flex gap-2"><button type="button" onClick={() => setReverseTarget(null)} className="flex-1 rounded-md border border-rose-200 bg-white px-2 py-1.5 text-[10px] font-bold text-rose-700">Keep payment</button><button type="button" disabled={reverse.isPending || !reverseReason.trim()} onClick={() => reverse.mutate({ id: payment.id, reason: reverseReason.trim() })} className="flex-1 rounded-md bg-rose-700 px-2 py-1.5 text-[10px] font-bold text-white disabled:opacity-50">{reverse.isPending ? "Reversing…" : "Confirm reversal"}</button></div>
                </div>
              ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <p className="mt-2 text-[10px] leading-4 text-[#756e9a]">
          Manual-safe recording only. UPI/Card entries remain operator-confirmed
          until a provider is configured.
        </p>
      </section>
      {error && (
        <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">
          {error}
        </p>
      )}
      <div className="mt-5 border-t border-[#263f44]/10 pt-4">
        <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#648077]">
          Timeline
        </p>
        <div className="mt-3 space-y-3">
          {order.timeline.map((entry) => (
            <div key={entry.id} className="flex gap-2 text-xs">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#65a298]" />
              <span>
                <span className="font-semibold text-[#40565a]">
                  {entry.action.replace("laundry:", "").replace(":", " ")}
                </span>
                <span className="block text-[#819094]">
                  {new Date(entry.ts).toLocaleString("en-IN")}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
function StatePill({ state }: { state: LaundryState }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset",
        stateTone[state],
      )}
    >
      {state}
    </span>
  );
}
function date(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
  }).format(new Date(`${value}T00:00:00`));
}
async function exportOrders(rows: LaundryOrder[]) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((order) => ({
      "Invoice no.": order.invoiceNumber,
      "Order no.": order.orderNumber,
      Customer: order.customer.name,
      Phone: order.customer.phone,
      "Order date": order.orderDate,
      "Delivery date": order.expectedDeliveryDate,
      Amount: order.grandTotal,
      "Payment mode": order.paymentMode,
      "Payment status": order.paymentStatus,
      Status: order.state,
      "Fulfilment mode": order.fulfillmentMode,
      Captain: order.deliveryRider?.name || order.pickupRider?.name || "",
    })),
  );
  sheet["!cols"] = [16, 16, 24, 16, 14, 16, 14, 16, 16, 18, 18, 22].map(
    (width) => ({ wch: width }),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Store Orders");
  XLSX.writeFile(
    workbook,
    `laundry-store-orders-${new Date().toISOString().slice(0, 10)}.xlsx`,
    { compression: true },
  );
}
