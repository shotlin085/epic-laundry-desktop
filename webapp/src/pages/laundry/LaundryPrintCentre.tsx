import { useQuery } from "@tanstack/react-query";
import {
  Check,
  Download,
  History,
  Loader2,
  Printer,
  Search,
  Tag,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { apiGet, apiPost } from "@/lib/api";
import type { LaundryOrder } from "@/lib/laundry";
import {
  buildLaundryPrintHtml,
  type PrintOrder,
  type PrintSettings,
  type PrintTag,
} from "@/lib/laundryPrint";
import { formatINR } from "@/lib/utils";
import VisualEmptyState from "@/components/laundry/VisualEmptyState";

type Detail = LaundryOrder &
  PrintOrder & {
    receipt: PrintOrder["receipt"];
    tags: PrintTag[];
    containerTags?: PrintTag[];
  };
type PrintJob = {
  id: string;
  orderId: string;
  documentType: string;
  requestedCopies: number;
  requestedBy: string;
  createdAt: string;
  status: string;
  templateId: string;
  evidence?: string;
  tagIds: string[];
};
type Tab = "invoice" | "mini-invoice" | "garment-tags" | "bag-tags" | "history";
type PrintQueueFilter = "today" | "ready" | "unprinted" | "partial" | "reprints" | "completed" | "all";

export default function LaundryPrintCentre() {
  const [search, setSearch] = useState("");
  const [orderFilter, setOrderFilter] = useState<PrintQueueFilter>("today");
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState<Tab>("garment-tags");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [worksetOpen, setWorksetOpen] = useState(false);
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const order = searchParams.get("order");
    if (order) {
      setSelected(order);
      setWorksetOpen(true);
    }
  }, [searchParams]);
  const orders = useQuery({
    queryKey: ["print-centre-orders", search],
    queryFn: () =>
      apiGet<LaundryOrder[]>(
        `/laundry/orders?search=${encodeURIComponent(search)}`,
      ),
  });
  const detail = useQuery({
    queryKey: ["print-centre-order", selected],
    queryFn: () => apiGet<Detail>(`/laundry/orders/${selected}`),
    enabled: Boolean(selected),
  });
  const settings = useQuery({
    queryKey: ["print-centre-settings"],
    queryFn: () => apiGet<PrintSettings>("/laundry/print-settings"),
  });
  const jobs = useQuery({
    queryKey: ["print-centre-history", selected],
    queryFn: () =>
      apiGet<PrintJob[]>(
        `/laundry/print-jobs${selected ? `?orderId=${encodeURIComponent(selected)}` : ""}`,
      ),
  });
  const allJobs = useQuery({
    queryKey: ["print-centre-history-all"],
    queryFn: () => apiGet<PrintJob[]>("/laundry/print-jobs"),
  });
  const order = detail.data;
  const tags = order?.tags || [];
  const containerTags = order?.containerTags || [];
  const activeTags = tab === "bag-tags" ? containerTags : tags;
  const selectedRows = useMemo(
    () =>
      activeTags.filter((tag) =>
        selectedTags.includes(tag.containerId || tag.unitId || tag.tagNumber),
      ),
    [selectedTags, activeTags],
  );
  const allSelected =
    activeTags.length > 0 && selectedRows.length === activeTags.length;

  async function runDocument(kind: "print" | "pdf") {
    if (!order) return;
    const receiptTab = tab === "invoice" || tab === "mini-invoice";
    const rows = receiptTab
      ? []
      : selectedRows.length
        ? selectedRows
        : activeTags;
    const containerTab = tab === "bag-tags";
    const documentKind = receiptTab ? "receipt" : "tags";
    const html = await buildLaundryPrintHtml(
      documentKind,
      order,
      settings.data,
      rows,
    );
    const result =
      kind === "pdf"
        ? await window.epic?.exportHtmlPdf?.(
            html,
            `${order.orderNumber}-${tab}`,
          )
        : await window.epic?.printHtml?.(html);
    let ok = Boolean(result?.ok);
    if (!result) {
      const popup = window.open("", "_blank", "width=900,height=1100");
      if (popup) {
        popup.document.write(
          html + "<script>window.onload=()=>window.print()<\/script>",
        );
        popup.document.close();
        ok = true;
      }
    }
    setNotice(
      ok
        ? kind === "pdf"
          ? "PDF saved from the same renderer used for preview."
          : "Native print command accepted. Physical page emergence is not independently verified."
        : "Print was cancelled or could not be started.",
    );
    try {
      await apiPost("/laundry/print-jobs", {
        orderId: order.id,
        templateId: "recommended-a4-6",
        templateVersion: "1",
        printerProfile: settings.data?.printerProfile || "system-default",
        ...(containerTab
          ? {
              containerIds: rows.map((row) => row.containerId || row.tagNumber),
            }
          : { tagIds: rows.map((row) => row.unitId || row.tagNumber) }),
        documentType: tab,
        requestedCopies: 1,
        status: ok ? (kind === "pdf" ? "Downloaded" : "Printed") : "Cancelled",
        evidence: ok
          ? kind === "pdf"
            ? "Electron printToPDF completed"
            : "Native print command accepted; physical output not independently verified"
          : "Operator cancelled or print command failed",
      });
      jobs.refetch();
      allJobs.refetch();
    } catch {
      setNotice(
        "The document action completed, but its audit record could not be saved.",
      );
    }
  }

  const visibleOrders = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const history = allJobs.data || [];
    const physicalJobs = (orderId: string) => history.filter((job) => job.orderId === orderId && ["garment-tags", "bag-tags"].includes(job.documentType) && ["Printed", "Downloaded"].includes(job.status));
    return (orders.data || []).filter(
      (row) => {
        const total = (row.physicalUnits?.length || 0) + (row.containers?.length || 0);
        const rowJobs = physicalJobs(row.id);
        const printedIds = new Set(rowJobs.flatMap((job) => job.tagIds || []));
        const printed = printedIds.size;
        if (orderFilter === "all") return true;
        if (orderFilter === "today") return row.orderDate === today;
        if (orderFilter === "ready") return ["Ready", "In Process", "Processing", "Racked"].includes(row.state);
        if (orderFilter === "unprinted") return total > 0 && printed === 0;
        if (orderFilter === "partial") return total > 0 && printed > 0 && printed < total;
        if (orderFilter === "reprints") return rowJobs.length > 1 || printedIds.size < rowJobs.reduce((sum, job) => sum + (job.tagIds || []).length, 0);
        return orderFilter === "completed" && row.state === "Delivered";
      },
    );
  }, [orders.data, allJobs.data, orderFilter]);
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <PageHeading />
      <div className="mt-6 min-h-[calc(100vh-220px)]">
        <OrderList
          search={search}
          setSearch={setSearch}
          filter={orderFilter}
          setFilter={setOrderFilter}
          orders={visibleOrders}
          loading={orders.isLoading}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            setSelectedTags([]);
            setTab("garment-tags");
            setNotice("");
            setWorksetOpen(true);
          }}
        />
      </div>
      {worksetOpen ? (
        <PrintWorksetDrawer onClose={() => setWorksetOpen(false)}>
          {!selected ? <EmptyState /> : detail.isLoading || !order ? (
            <div className="grid min-h-[560px] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#3a7d78]" /></div>
          ) : <DocumentWorkspace
            order={order}
            tags={tags}
            containerTags={containerTags}
            tab={tab}
            setTab={(next) => {
              setTab(next);
              setSelectedTags([]);
            }}
            notice={notice}
            setNotice={setNotice}
            jobs={jobs.data || []}
            settings={settings.data}
            selectedTags={selectedTags}
            selectedRows={selectedRows}
            allSelected={allSelected}
            setSelectedTags={setSelectedTags}
            onClose={() => setWorksetOpen(false)}
            onPrint={() => void runDocument("print")}
            onPdf={() => void runDocument("pdf")}
          />}
        </PrintWorksetDrawer>
      ) : null}
    </div>
  );
}

function PageHeading() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">
          Operations · documents
        </p>
        <h1 className="mt-1 font-serif text-3xl text-[#17353c]">
          Print centre
        </h1>
        <p className="mt-1 text-sm text-[#718087]">
          Prepare, inspect, and evidence every customer document and physical
          tag batch.
        </p>
      </div>
      <div className="rounded-2xl border border-[#39786f]/20 bg-[#eaf3ef] px-4 py-3 text-xs font-semibold text-[#2e6a60]">
        <Tag className="mr-2 inline h-4 w-4" />
        Opaque QR payloads · offline ready
      </div>
    </div>
  );
}
function EmptyState() {
  return (
    <div className="grid min-h-[560px] place-items-center">
      <VisualEmptyState
        kind="operations"
        title="Choose an order to begin"
        detail="Search by order, invoice, customer, phone, or active tag to prepare a document or tag batch."
      />
    </div>
  );
}
function OrderList({
  search,
  setSearch,
  filter,
  setFilter,
  orders,
  loading,
  selected,
  onSelect,
}: {
  search: string;
  setSearch: (value: string) => void;
  filter: PrintQueueFilter;
  setFilter: (value: PrintQueueFilter) => void;
  orders: LaundryOrder[];
  loading: boolean;
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="flex min-h-[calc(100vh-220px)] flex-col overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]">
      <header className="border-b border-[#263f44]/10 bg-[#fffdfb] px-5 py-5 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[.17em] text-[#4d8982]">Document worksets</p>
            <h2 className="mt-1 font-serif text-2xl text-[#17353c]">Choose an order to open its live worksheet</h2>
            <p className="mt-1 text-sm text-[#718087]">The queue stays visible here. Invoices, physical tags, documents, and print history open from the right.</p>
          </div>
          <span className="rounded-full bg-[#f1effb] px-3 py-1.5 text-xs font-bold text-[#5d46d2]">{orders.length} workset{orders.length === 1 ? "" : "s"}</span>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7e8d90]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search order, invoice, customer, phone or active tag"
              className="h-11 w-full rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] pl-9 pr-3 text-sm outline-none focus:border-[#438b82] focus:ring-2 focus:ring-[#b9ded6]"
            />
          </div>
          <div className="flex flex-wrap gap-1 text-[10px] font-bold uppercase tracking-[.12em] text-[#718087]">
            {(["today", "ready", "unprinted", "partial", "reprints", "completed", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full px-2.5 py-1.5 ${filter === value ? "bg-[#eaf3ef] text-[#2e6a60]" : "hover:bg-[#f2f5f1]"}`}
              >
                {value === "today" ? "Today" : value === "ready" ? "Ready" : value === "unprinted" ? "Unprinted" : value === "partial" ? "Partial" : value === "reprints" ? "Reprints" : value === "completed" ? "Completed" : "All"}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbfcfa] p-3 md:p-5">
        {loading ? (
          <Loader2 className="mx-auto my-16 h-5 w-5 animate-spin text-[#3a7d78]" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {orders.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelect(row.id)}
              className={`group w-full rounded-2xl border p-4 text-left shadow-[0_4px_16px_rgba(37,48,43,.035)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(37,48,43,.08)] ${selected === row.id ? "border-[#70aaa0] bg-[#edf8f4] ring-1 ring-inset ring-[#8dbeb3]" : "border-[#263f44]/10 bg-white hover:border-[#a9ccc4]"}`}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0"><span className="block truncate text-sm font-bold text-[#205660]">
                  {row.invoiceNumber || row.orderNumber}
                </span><span className="mt-1 block truncate text-xs text-[#617178]">{row.orderNumber}</span></span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-[#17353c]">
                  {formatINR(row.grandTotal)}
                </span>
              </span>
              <span className="mt-4 flex items-end justify-between gap-3 border-t border-[#263f44]/8 pt-3"><span className="min-w-0"><span className="block truncate font-semibold text-[#253f44]">{row.customer.name}</span><span className="mt-1 block text-[10px] font-bold uppercase tracking-[.1em] text-[#829092]">Due {row.expectedDeliveryDate}</span></span><span className="rounded-full bg-[#f1effb] px-2.5 py-1 text-[10px] font-bold text-[#5d46d2]">{row.state}</span></span>
            </button>
          ))}</div>
        )}
        {!loading && !orders.length ? (
          <VisualEmptyState
            kind="orders"
            compact
            title="No orders in this queue"
            detail="Try All, change the date filter, or search another order."
          />
        ) : null}
      </div>
    </section>
  );
}

function PrintWorksetDrawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  useEffect(() => {
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => drawerRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeHandler.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      if (priorFocusRef.current?.isConnected) {
        priorFocusRef.current.focus();
        window.requestAnimationFrame(() => {
          if (priorFocusRef.current?.isConnected) priorFocusRef.current.focus();
        });
      }
    };
  }, []);
  const onTrapKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []).filter((element) => !element.hasAttribute("hidden"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!drawerRef.current?.contains(document.activeElement)) {
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
  return <>
    <button type="button" aria-label="Close live workset" onClick={onClose} className="fixed inset-0 z-40 cursor-default bg-[#171024]/65 backdrop-blur-[2px]" />
    <aside ref={drawerRef} onKeyDown={onTrapKeyDown} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Live print workset" className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto border-l border-[#272043]/10 bg-[#fffdfb] px-4 py-5 shadow-[-22px_0_60px_rgba(32,23,60,.22)] animate-in slide-in-from-right duration-300 sm:w-[min(72vw,1040px)] sm:min-w-[680px] sm:px-6">
      {children}
    </aside>
  </>;
}

function DocumentWorkspace({
  order,
  tags,
  containerTags,
  tab,
  setTab,
  notice,
  setNotice,
  jobs,
  settings,
  selectedTags,
  selectedRows,
  allSelected,
  setSelectedTags,
  onClose,
  onPrint,
  onPdf,
}: {
  order: Detail;
  tags: PrintTag[];
  containerTags: PrintTag[];
  tab: Tab;
  setTab: (tab: Tab) => void;
  notice: string;
  setNotice: (value: string) => void;
  jobs: PrintJob[];
  settings?: PrintSettings;
  selectedTags: string[];
  selectedRows: PrintTag[];
  allSelected: boolean;
  setSelectedTags: (value: string[]) => void;
  onClose: () => void;
  onPrint: () => void;
  onPdf: () => void;
}) {
  const tabs: Array<[Tab, string]> = [
    ["invoice", "Invoice"],
    ["mini-invoice", "Mini invoice"],
    ["garment-tags", `Garment tags (${tags.length})`],
    ["bag-tags", `Bag tags (${containerTags.length})`],
    ["history", "Print history"],
  ];
  const physicalTags = tab === "bag-tags" ? containerTags : tags;
  const canPrint =
    tab === "invoice" ||
    tab === "mini-invoice" ||
    ((tab === "garment-tags" || tab === "bag-tags") && physicalTags.length > 0);
  const printLabel =
    tab === "invoice" || tab === "mini-invoice"
      ? "Print invoice"
      : selectedRows.length
        ? "Print selected"
        : "Print all";
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Workset · {order.orderNumber}
          </p>
          <h2 className="mt-1 font-serif text-2xl text-[#17353c]">
            {order.customer.name}
          </h2>
          <p className="mt-1 text-xs text-[#718087]">
            {order.invoiceNumber || "No invoice"} · {tags.length} garment tag
            {tags.length === 1 ? "" : "s"} · {containerTags.length} bag tag
            {containerTags.length === 1 ? "" : "s"} · due{" "}
            {order.expectedDeliveryDate}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg border border-[#263f44]/15 bg-white text-[#40565a] transition hover:bg-[#f1eff8]"
            aria-label="Close live workset"
            title="Close workset"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!canPrint}
            onClick={onPrint}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#123039] px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            <Printer className="h-3.5 w-3.5" />
            {printLabel}
          </button>
          <button
            type="button"
            disabled={!canPrint}
            onClick={onPdf}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#123039]/15 bg-white px-3 py-2 text-xs font-bold text-[#17353c] disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Download PDF
          </button>
        </div>
      </header>
      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-[#263f44]/10">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`whitespace-nowrap border-b-2 px-3 py-3 text-xs font-bold ${tab === value ? "border-[#3a7d78] text-[#2e6a60]" : "border-transparent text-[#718087] hover:text-[#17353c]"}`}
          >
            {value === "history" ? (
              <History className="mr-1 inline h-3.5 w-3.5" />
            ) : null}
            {label}
          </button>
        ))}
      </nav>
      {notice ? (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-[#9ccabf] bg-[#eef8f3] px-3 py-2.5 text-xs font-semibold text-[#2e6a60]">
          <span>
            <Check className="mr-1.5 inline h-4 w-4" />
            {notice}
          </span>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss print notice"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {tab === "history" ? (
        <PrintHistory jobs={jobs} />
      ) : tab === "invoice" || tab === "mini-invoice" ? (
        <InvoicePreview order={order} compact={tab === "mini-invoice"} />
      ) : (
          <TagBatch
            kind={tab === "bag-tags" ? "container" : "garment"}
            tags={physicalTags}
            template={settings?.tagTemplate}
            selectedTags={selectedTags}
          selectedRows={selectedRows}
          allSelected={allSelected}
          setSelectedTags={setSelectedTags}
        />
      )}
    </>
  );
}

function TagBatch({
  kind,
  tags,
  template,
  selectedTags,
  selectedRows,
  allSelected,
  setSelectedTags,
}: {
  kind: "garment" | "container";
  tags: PrintTag[];
  template: PrintSettings["tagTemplate"];
  selectedTags: string[];
  selectedRows: PrintTag[];
  allSelected: boolean;
  setSelectedTags: (value: string[]) => void;
}) {
  const container = kind === "container";
  return (
    <>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-serif text-xl text-[#17353c]">
            {container ? "Bag / container tag batch" : "Garment tag batch"}
          </p>
          <p className="text-xs text-[#718087]">
            {container
              ? "Explicit container identities keep bulk handling and handoffs accountable."
              : "Order-wide sequence makes missing pieces visible at assembly."}
          </p>
        </div>
        <div className="flex gap-2 text-xs font-bold">
          <button
            type="button"
            onClick={() =>
              setSelectedTags(
                allSelected
                  ? []
                  : tags.map(
                      (tag) => tag.containerId || tag.unitId || tag.tagNumber,
                    ),
              )
            }
            className="rounded-lg border border-[#263f44]/15 bg-white px-3 py-2"
          >
            {allSelected ? "Clear" : "Select all"}
          </button>
          <span className="rounded-lg bg-[#eaf3ef] px-3 py-2 text-[#2e6a60]">
            {selectedRows.length} selected
          </span>
        </div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {tags.map((tag) => {
          const id = tag.containerId || tag.unitId || tag.tagNumber;
          return (
              <TagPreview
                key={id}
                tag={tag}
                template={template}
                selected={selectedTags.includes(id)}
              onToggle={() =>
                setSelectedTags(
                  selectedTags.includes(id)
                    ? selectedTags.filter((item) => item !== id)
                    : [...selectedTags, id],
                )
              }
            />
          );
        })}
      </div>
      {!tags.length ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[#9cb5ac] px-6 py-14 text-center text-sm text-[#718087]">
          {container
            ? "No explicit bag/container tags were created for this order. Add a bag count when booking a weight or bulk line."
            : "This order has no physical garment tags. Weight-based items do not fabricate piece tags."}
        </div>
      ) : null}
    </>
  );
}
function TagPreview({
  tag,
  template,
  selected,
  onToggle,
}: {
  tag: PrintTag;
  template: PrintSettings["tagTemplate"];
  selected: boolean;
  onToggle: () => void;
}) {
  const [qr, setQr] = useState("");
  const [barcode, setBarcode] = useState("");
  const codeFormat = template?.codeFormat || "qr";
  const showQr = codeFormat === "qr" || codeFormat === "qr+code128";
  const showBarcode = codeFormat === "code128" || codeFormat === "qr+code128";
  useEffect(() => {
    if (!showQr) {
      setQr("");
      return;
    }
    QRCode.toDataURL(
      tag.tagPayload ||
        `${tag.tagKind === "container" ? "ELB" : "ELT"}:v1:${tag.tagNumber}`,
      { width: 160, margin: 1, errorCorrectionLevel: "M" },
    )
      .then(setQr)
      .catch(() => setQr(""));
  }, [showQr, tag.tagPayload, tag.tagNumber, tag.tagKind]);
  useEffect(() => {
    if (!showBarcode) {
      setBarcode("");
      return;
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    try {
      JsBarcode(svg, tag.tagNumber, {
        format: "CODE128",
        displayValue: true,
        width: 1.1,
        height: 24,
        margin: 0,
        fontSize: 8,
        lineColor: "#123039",
      });
      setBarcode(svg.outerHTML);
    } catch {
      setBarcode("");
    }
  }, [showBarcode, tag.tagNumber]);
  const container = tag.tagKind === "container";
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative rounded-[18px] border bg-white p-4 text-left shadow-[0_8px_22px_rgba(37,48,43,.04)] transition hover:-translate-y-0.5 ${selected ? "border-[#3a7d78] ring-2 ring-[#b9ded6]" : "border-[#263f44]/10"}`}
    >
      <span
        className={`absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-md border ${selected ? "border-[#3a7d78] bg-[#3a7d78] text-white" : "border-[#b8c9c1] bg-white"}`}
      >
        {selected ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      <div className="flex items-center justify-between gap-3">
        <span
          className={`text-[10px] font-black uppercase tracking-[.14em] ${container ? "text-[#9b6d1d]" : "text-[#39786f]"}`}
        >
          {container ? "Epic Laundry · container" : "Epic Laundry"}
        </span>
        {template?.showSequence !== false ? <span className="font-mono text-sm font-bold text-[#17353c]">{tag.sequence} / {tag.total}</span> : null}
      </div>
      <div className="mt-5 flex items-end justify-between gap-4">
        <div className="min-w-0">
          {template?.showGarment !== false ? <p className="text-lg font-extrabold leading-tight text-[#17353c]">{tag.garment}</p> : null}
          {template?.showService !== false ? <p className="mt-1 text-xs font-semibold text-[#39786f]">{tag.service}</p> : null}
          {template?.showOrder !== false || template?.showCustomer !== false ? <p className="mt-4 truncate text-[11px] text-[#617178]">{template?.showOrder !== false ? tag.orderNumber : ""}{template?.showOrder !== false && template?.showCustomer !== false ? " · " : ""}{template?.showCustomer !== false ? tag.customer.split(" ")[0] : ""}</p> : null}
          {template?.showDueDate !== false ? <p className="mt-1 text-[10px] font-bold uppercase tracking-[.1em] text-[#855815]">Due {tag.expectedDeliveryDate}</p> : null}
        </div>
        {qr ? (
          <img src={qr} alt="Opaque tag QR" className="h-20 w-20 shrink-0" />
        ) : showQr ? (
          <span className="h-20 w-20 shrink-0 rounded-lg bg-[#f4f6f1]" />
        ) : null}
      </div>
      {barcode ? <div aria-label="Barcode preview" className="mt-3 overflow-hidden border-t border-[#e4ebe6] pt-2" dangerouslySetInnerHTML={{ __html: barcode }} /> : null}
      {template?.showTagCode !== false || tag.state ? <div className="mt-4 flex justify-between border-t border-[#e4ebe6] pt-3 font-mono text-[9px] text-[#718087]"><span>{template?.showTagCode !== false ? tag.tagNumber : ""}</span><span>{tag.state || "Intake"}</span></div> : null}
    </button>
  );
}
function InvoicePreview({
  order,
  compact,
}: {
  order: Detail;
  compact: boolean;
}) {
  return (
    <div
      className={`mx-auto mt-6 rounded-xl border border-dashed border-[#9cb5ac] bg-white p-5 ${compact ? "max-w-sm" : "max-w-xl"}`}
    >
      <div className="flex items-start justify-between border-b border-[#263f44]/10 pb-4">
        <div>
          <p className="font-serif text-xl text-[#17353c]">Epic Laundry</p>
          <p className="mt-1 text-xs text-[#718087]">
            {order.fulfillmentMode} · Due {order.expectedDeliveryDate}
          </p>
        </div>
        <span className="rounded-lg bg-[#eaf3ef] px-2 py-1 text-[10px] font-bold text-[#39786f]">
          {compact ? "MINI" : "RECEIPT"}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {order.receipt.items.map((item) => (
          <div
            key={`${item.garmentName}:${item.serviceName}`}
            className="flex justify-between text-sm"
          >
            <span>
              {item.garmentName} × {item.qty}
              <small className="ml-1 text-xs text-[#718087]">
                {item.serviceName}
              </small>
            </span>
            <strong>{formatINR(item.amount)}</strong>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-[#263f44]/10 pt-3">
        <div className="flex justify-between text-sm">
          <span>Subtotal</span>
          <span>{formatINR(order.receipt.subtotal)}</span>
        </div>
        <div className="mt-2 flex justify-between border-t border-[#263f44]/10 pt-2 font-serif text-xl">
          <span>Total</span>
          <span>{formatINR(order.receipt.grandTotal)}</span>
        </div>
      </div>
    </div>
  );
}
function PrintHistory({ jobs }: { jobs: PrintJob[] }) {
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-[#263f44]/10 bg-white">
      <div className="grid grid-cols-[1fr_110px_110px] gap-3 border-b border-[#263f44]/10 bg-[#fafaf7] px-4 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-[#718087]">
        <span>Document</span>
        <span>Status</span>
        <span>When</span>
      </div>
      {jobs.length ? (
        jobs.map((job) => (
          <div
            key={job.id}
            className="grid grid-cols-[1fr_110px_110px] gap-3 border-b border-[#263f44]/8 px-4 py-3 text-xs"
          >
            <span>
              <strong className="block text-[#17353c]">
                {job.documentType}
              </strong>
              <span className="text-[#718087]">
                {job.requestedCopies} copies · {job.templateId}
              </span>
            </span>
            <span className="font-bold text-[#39786f]">{job.status}</span>
            <span className="text-[#718087]">
              {new Date(job.createdAt).toLocaleString()}
            </span>
          </div>
        ))
      ) : (
        <p className="px-4 py-12 text-center text-sm text-[#718087]">
          No print actions recorded for this order.
        </p>
      )}
    </div>
  );
}
