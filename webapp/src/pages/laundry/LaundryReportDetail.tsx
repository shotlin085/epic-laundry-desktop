import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Loader2, Printer, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import { formatINR } from '@/lib/utils'
import VisualEmptyState from '@/components/laundry/VisualEmptyState'

const reports = [
  ['invoice', 'Invoice Report'], ['collection', 'Collection Report'], ['order', 'Order Report'], ['consolidated-invoices', 'Consolidated Invoices'], ['customer', 'Customer Report'], ['customer-package', 'Customer Package Report'], ['customer-list', 'Customer List'], ['growth', 'Growth Report'], ['discount', 'Discount Report'], ['expense', 'Expense Report'], ['balance', 'Balance Report'], ['pickup', 'Pickup Overview'], ['rider-delivery', 'Captain Delivery'], ['rider-collection', 'Captain Collection'], ['warehouse-user-work', 'Warehouse User Work Report'],
] as const

type Detail = {
  kind: string; from: string | null; to: string | null; columns: string[]; rows: Array<Record<string, unknown>>; totalRows: number; page: number; pageSize: number; totalPages: number; exportCap?: number | null; exportTruncated?: boolean
}
type ReportExportJob = { id: string; status: 'Queued' | 'Running' | 'Completed' | 'Failed' | 'Expired'; totalRows: number; fileName: string | null; error: string | null; expiresAt: string | null }

export default function LaundryReportDetail() {
  const { kind = 'invoice' } = useParams();
  const [savedParams] = useSearchParams();
  const meta = reports.find(([id]) => id === kind) || reports[0];
  const [from, setFrom] = useState(savedParams.get('from') || '');
  const [to, setTo] = useState(savedParams.get('to') || '');
  const [search, setSearch] = useState(savedParams.get('search') || '');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportJob, setExportJob] = useState<ReportExportJob | null>(null);
  const filters = () => `${from ? `from=${encodeURIComponent(from)}&` : ''}${to ? `to=${encodeURIComponent(to)}&` : ''}${search ? `search=${encodeURIComponent(search)}&` : ''}`;
  const query = useQuery({ queryKey: ['laundry-report-detail', meta[0], from, to, search, page], queryFn: () => apiGet<Detail>(`/laundry/reports/${meta[0]}?${filters()}page=${page}&pageSize=100`) });
  const data = query.data;
  useEffect(() => { if (!exportJob || ['Completed', 'Failed', 'Expired'].includes(exportJob.status)) return; const timer = window.setInterval(() => { void apiGet<ReportExportJob>(`/laundry/report-exports/${exportJob.id}`).then((next) => { setExportJob(next); if (next.status === 'Completed') { setExportMessage(`Full export ready (${next.totalRows} rows). Starting CSV download…`); window.location.href = `/api/laundry/report-exports/${next.id}/download`; } else if (next.status === 'Failed' || next.status === 'Expired') setExportMessage(`Full export ${next.status.toLowerCase()}${next.error ? `: ${next.error}` : ''}.`); }).catch(() => undefined) }, 1000); return () => window.clearInterval(timer) }, [exportJob]);
  useEffect(() => { setExportJob(null) }, [meta[0]]);
  const queueFullExport = async () => {
    if (!data || exportJob && ['Queued', 'Running'].includes(exportJob.status)) return;
    setExportMessage('Queueing full report export…');
    try { const job = await apiPost<ReportExportJob>('/laundry/report-exports', { kind: meta[0], from: from || undefined, to: to || undefined, search: search || undefined }); setExportJob(job); setExportMessage('Full export queued. This page will show when it is ready.'); }
    catch { setExportMessage('Full export could not be queued. Please retry.'); }
  };
  const download = async (all: boolean) => {
    if (!data || exporting) return;
    if (all && data.totalRows > 5000) {
      setExportMessage('Large report detected. Queueing a durable full export…');
      try { const job = await apiPost<ReportExportJob>('/laundry/report-exports', { kind: meta[0], from: from || undefined, to: to || undefined, search: search || undefined }); setExportJob(job); setExportMessage('Full export queued. The CSV download will start when processing completes.'); }
      catch { setExportMessage('Full export could not be queued. Please retry.'); }
      return;
    }
    setExporting(true); setExportMessage('');
    try {
      const exportData = all ? await apiGet<Detail & { exportAll: boolean }>(`/laundry/reports/${meta[0]}/export?${filters()}`) : data;
      await exportRows(meta[1], exportData);
      setExportMessage(all && exportData.exportTruncated ? `Exported first ${exportData.exportCap || 5000} of ${exportData.totalRows} rows.` : all ? `Exported ${exportData.totalRows} rows.` : 'Exported current page.');
    } catch { setExportMessage('Export failed. Please retry.'); }
    finally { setExporting(false); }
  };
 return <div className="animate-in fade-in slide-in-from-bottom-2 duration-500"><div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><Link to="/laundry/reports" className="inline-flex items-center gap-1 text-xs font-bold text-[#39786f]"><ArrowLeft className="h-3.5 w-3.5" />Reports overview</Link><p className="mt-4 text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">Verified report view</p><h1 className="mt-1 font-serif text-3xl text-[#17353c]">{meta[1]}</h1><p className="mt-1 text-sm text-[#718087]">Server-backed rows for the active store and selected date range.</p></div><div className="flex flex-wrap items-end gap-2"><label className="text-xs font-semibold text-[#617178]">From<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} className="mt-1 block h-9 rounded-lg border border-[#263f44]/15 bg-white px-2 font-normal" /></label><label className="text-xs font-semibold text-[#617178]">To<input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} className="mt-1 block h-9 rounded-lg border border-[#263f44]/15 bg-white px-2 font-normal" /></label><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Filter rows" className="h-9 w-40 rounded-lg border border-[#263f44]/15 bg-white px-3 text-xs" /><button type="button" onClick={() => query.refetch()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#263f44]/15 bg-white px-3 text-xs font-bold text-[#315d57]"><RefreshCw className="h-3.5 w-3.5" />Refresh</button><button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#263f44]/15 bg-white px-3 text-xs font-bold text-[#315d57]"><Printer className="h-3.5 w-3.5" />Print</button><button type="button" disabled={!data?.rows.length || exporting} onClick={() => void download(false)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#263f44]/15 bg-white px-3 text-xs font-bold text-[#315d57] disabled:bg-[#d6dfda]"><Download className="h-3.5 w-3.5" />Page Excel</button><button type="button" disabled={!data?.totalRows || exporting} onClick={() => void download(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#123039] px-3 text-xs font-bold text-white disabled:bg-[#a8b7b2]"><Download className="h-3.5 w-3.5" />{exporting ? 'Exporting…' : 'Export all'}</button></div></div>{exportMessage && <p className="mt-2 text-right text-xs font-semibold text-[#39786f]">{exportMessage}</p>}<div className="mt-6 grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]"><nav className="h-fit rounded-[22px] border border-[#263f44]/10 bg-white p-2 shadow-[0_8px_28px_rgba(37,48,43,.04)]">{reports.map(([id, label]) => <Link key={id} to={`/laundry/reports/${id}`} className={`block rounded-xl px-3 py-2.5 text-xs font-semibold ${id === meta[0] ? 'bg-[#eaf3ef] text-[#205d55]' : 'text-[#617178] hover:bg-[#f5f7f3]'}`}>{label}</Link>)}</nav><section className="overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]">{query.isLoading ? <div className="grid h-80 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#3a7d78]" /></div> : query.isError || !data ? <p className="p-8 text-center text-rose-700">This report could not be loaded.</p> : <><div className="flex items-center justify-between border-b border-[#263f44]/10 bg-[#fafaf7] px-5 py-4"><span className="text-xs text-[#617178]"><strong className="text-[#315d57]">{data.totalRows}</strong> rows · page {data.page} of {data.totalPages} · {data.from || 'all dates'}{data.to ? ` to ${data.to}` : ''}</span><span className="text-[10px] font-bold uppercase tracking-[.14em] text-[#829092]">Authoritative local data</span></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[#fbfbf8] text-[10px] font-bold uppercase tracking-[.13em] text-[#718087]"><tr>{data.columns.map((column) => <th key={column} className="px-4 py-3">{labelize(column)}</th>)}</tr></thead><tbody>{data.rows.length ? data.rows.map((row, index) => <tr key={index} className="border-t border-[#263f44]/8">{data.columns.map((column) => <td key={column} className="px-4 py-3.5 text-[#40565a]">{formatCell(row[column], column)}</td>)}</tr>) : <tr><td colSpan={Math.max(data.columns.length, 1)}><VisualEmptyState kind="finance" title="No rows in this view" detail="Adjust the date range or clear the search filter to see authoritative records." /></td></tr>}</tbody></table></div><div className="flex items-center justify-between border-t border-[#263f44]/10 bg-[#fafaf7] px-5 py-3"><button type="button" disabled={data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex items-center gap-1 rounded-lg border border-[#263f44]/15 bg-white px-2.5 py-1.5 text-xs font-bold text-[#315d57] disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />Previous</button><span className="text-xs tabular-nums text-[#617178]">Page {data.page} of {data.totalPages}</span><button type="button" disabled={data.page >= data.totalPages} onClick={() => setPage((value) => Math.min(data.totalPages, value + 1))} className="inline-flex items-center gap-1 rounded-lg border border-[#263f44]/15 bg-white px-2.5 py-1.5 text-xs font-bold text-[#315d57] disabled:cursor-not-allowed disabled:opacity-40">Next<ChevronRight className="h-3.5 w-3.5" /></button></div></>}</section></div></div>
}

function labelize(value: string) { return value.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (char) => char.toUpperCase()) }
function formatCell(value: unknown, column: string) { if (value === null || value === undefined || value === '') return '—'; if (typeof value === 'number' && /(amount|total|revenue|tax|discount|balance|value|expense|collected)/i.test(column)) return formatINR(value); if (typeof value === 'object') return Array.isArray(value) ? value.join(', ') : JSON.stringify(value); return String(value) }
async function exportRows(title: string, data: Pick<Detail, 'rows'>) { const XLSX = await import('xlsx'); const sheet = XLSX.utils.json_to_sheet(data.rows); const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, title.slice(0, 31)); XLSX.writeFile(workbook, `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true }) }
