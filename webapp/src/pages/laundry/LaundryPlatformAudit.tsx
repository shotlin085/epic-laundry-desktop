import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, ChevronRight, CircleDot, FileClock, Filter, Search, ShieldCheck, Store, UserRound, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, operatorErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { canUseUi } from '@/components/laundry/LaundryShell'
import { useDialogFocusLifecycle } from '@/components/laundry/useDialogFocus'
import VisualEmptyState from '@/components/laundry/VisualEmptyState'
import VisualLoadingState from '@/components/laundry/VisualLoadingState'

type PlatformStatus = { configured: boolean; connected: boolean }
type AuditEntry = {
  id: string; action?: string; actor_role?: string | null; actor_user_id?: string | null; actor_shop_id?: string | null;
  target_type?: string | null; target_id?: string | null; before?: unknown; after?: unknown; created_at?: string
}
type AuditPage = { items: AuditEntry[]; total?: number; page?: number; limit?: number }

function label(value?: string | null) { return value ? value.replaceAll('_', ' ').replaceAll(':', ' · ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Not recorded' }
function time(value?: string) { return value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Time unavailable' }
function evidence(value: unknown) {
  if (value === null || value === undefined) return 'No value recorded.'
  const formatted = JSON.stringify(value, null, 2)
  return formatted.length > 1600 ? `${formatted.slice(0, 1600)}\n…` : formatted
}
function actionTone(action?: string) {
  if (/reject|suspend|hold|failed|error/i.test(action || '')) return 'bg-[#fff1ee] text-[#a4463f]'
  if (/approve|paid|complete|success|accept/i.test(action || '')) return 'bg-[#e8f5ed] text-[#237449]'
  return 'bg-[#e9f0f3] text-[#3c6472]'
}

export default function LaundryPlatformAudit() {
  const session = useQuery({ queryKey: ['auth-session'], queryFn: () => apiGet<{ user: { roles: string[] } | null }>('/auth/session') })
  const canAccess = canUseUi(session.data?.user?.roles, 'settings.manage')
  const connection = useQuery({ queryKey: ['platform-status'], queryFn: () => apiGet<PlatformStatus>('/platform/status'), enabled: canAccess })
  const [action, setAction] = useState('')
  const [targetType, setTargetType] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AuditEntry>()
  useDialogFocusLifecycle(() => setSelected(undefined), Boolean(selected))
  const query = useMemo(() => new URLSearchParams(Object.entries({ ...(action.trim() ? { action: action.trim() } : {}), ...(targetType.trim() ? { target_type: targetType.trim() } : {}), page: String(page), limit: '50' })).toString(), [action, page, targetType])
  const logs = useQuery({ queryKey: ['platform-audit-logs', query], queryFn: () => apiGet<AuditPage>(`/platform/audit-logs?${query}`), enabled: canAccess && Boolean(connection.data?.connected), staleTime: 10_000 })

  if (session.isLoading || connection.isLoading) return <VisualLoadingState title="Preparing platform evidence" detail="Checking the local permission and platform-admin connection." icon={FileClock} />
  if (!canAccess) return <VisualEmptyState kind="orders" title="Not available" detail="Platform audit evidence is limited to store owners on this installation." />
  if (!connection.data?.connected) return <VisualEmptyState kind="orders" title="Connect a platform-admin account first" detail="Platform evidence remains in the cloud. Connect the separate administrator identity before reviewing it." action={<Link to="/laundry/platform-control" className="inline-flex items-center gap-2 rounded-xl bg-[#193d48] px-3 py-2 text-xs font-bold text-white"><ShieldCheck className="h-3.5 w-3.5" />Open Platform Control</Link>} />

  const rows = logs.data?.items || []
  const total = logs.data?.total ?? rows.length
  const pages = Math.max(1, Math.ceil(total / 50))
  return <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
    <header className="relative overflow-hidden rounded-[26px] border border-[#193d48]/20 bg-[radial-gradient(circle_at_88%_0%,rgba(243,193,97,.22),transparent_28%),linear-gradient(135deg,#102d37,#245663)] px-5 py-6 text-white shadow-[0_18px_48px_rgba(25,61,72,.18)] md:px-7">
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><Link to="/laundry/platform-control" className="inline-flex items-center gap-1.5 text-xs font-bold text-[#cfe4e7] hover:text-white"><ArrowLeft className="h-3.5 w-3.5" />Platform Control</Link><p className="mt-4 text-[10px] font-extrabold uppercase tracking-[.2em] text-[#b5d9d5]">Platform evidence trail</p><h1 className="mt-2 font-display text-3xl font-extrabold tracking-[-.04em] md:text-4xl">Every cloud decision, plainly traceable.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#d8ecec]">A read-only window into the platform’s append-only audit record. No local copy, edit, or deletion can change this evidence.</p></div><span className="inline-flex w-fit items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold"><CircleDot className="h-3.5 w-3.5 text-[#ffd37d]" />Cloud-authoritative</span></div>
    </header>
    <section className="mt-5 rounded-[22px] border border-[#193d48]/10 bg-white p-3 shadow-[0_10px_30px_rgba(25,61,72,.045)]"><div className="flex flex-col gap-3 md:flex-row"><div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#193d48]/10 bg-[#fbfcfc] px-3 py-2"><Search className="h-4 w-4 text-[#39727b]" /><label className="sr-only" htmlFor="platform-audit-action">Filter audit action</label><input id="platform-audit-action" value={action} onChange={(event) => { setAction(event.target.value); setPage(1) }} placeholder="Exact action, e.g. vendor_reviewed" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#98a5a8]" /></div><div className="flex min-w-0 items-center gap-2 rounded-xl border border-[#193d48]/10 bg-[#fbfcfc] px-3 py-2 md:w-56"><Filter className="h-4 w-4 text-[#39727b]" /><label className="sr-only" htmlFor="platform-audit-target">Filter target type</label><input id="platform-audit-target" value={targetType} onChange={(event) => { setTargetType(event.target.value); setPage(1) }} placeholder="Target type" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#98a5a8]" /></div></div></section>
    <section className="mt-4 overflow-hidden rounded-[22px] border border-[#193d48]/10 bg-white shadow-[0_10px_30px_rgba(25,61,72,.045)]" aria-label="Platform audit evidence"><div className="flex items-center justify-between border-b border-[#193d48]/8 px-4 py-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#718087]">Immutable cloud record</p><p className="mt-0.5 text-sm font-semibold text-[#27454c]">{logs.isLoading ? 'Reading evidence' : `${total} recorded event${total === 1 ? '' : 's'}`}</p></div><FileClock className="h-4 w-4 text-[#8b9a99]" /></div>{logs.isLoading ? <div className="p-8"><VisualLoadingState title="Reading platform evidence" detail="This page observes the cloud audit trail without storing a competing copy." icon={FileClock} /></div> : logs.isError ? <ErrorNotice error={logs.error} fallback="Platform audit evidence could not be read." /> : rows.length ? <div className="divide-y divide-[#193d48]/8">{rows.map((entry) => <button key={entry.id} type="button" onClick={() => setSelected(entry)} className="group grid w-full gap-3 px-4 py-4 text-left transition hover:bg-[#f8fbfb] lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_auto]"><div className="min-w-0"><span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold', actionTone(entry.action))}><CircleDot className="h-3 w-3" />{label(entry.action)}</span><p className="mt-2 flex items-center gap-1 truncate text-xs text-[#718087]"><UserRound className="h-3 w-3" />{label(entry.actor_role)}{entry.actor_user_id ? ` · ${entry.actor_user_id.slice(0, 8)}` : ''}</p></div><div className="min-w-0 text-xs text-[#718087]"><p className="flex items-center gap-1 truncate font-semibold text-[#52666d]"><Store className="h-3 w-3" />{label(entry.target_type)}</p><p className="mt-1 truncate">{entry.target_id || 'No target identifier'}</p></div><div className="flex items-center justify-between gap-2 text-right text-xs text-[#718087] lg:block"><p>{time(entry.created_at)}</p><ChevronRight className="h-4 w-4 text-[#65828a] transition group-hover:translate-x-0.5 lg:ml-auto lg:mt-1" /></div></button>)}</div> : <VisualEmptyState kind="orders" title="No platform evidence matches this view" detail="Clear a filter or choose an action recorded by the cloud platform." />}</section>
    {pages > 1 ? <div className="mt-4 flex items-center justify-end gap-3 text-xs font-bold text-[#52666d]"><span>Page {page} of {pages}</span><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-[#193d48]/12 px-3 py-2 disabled:opacity-40">Previous</button><button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-[#193d48]/12 px-3 py-2 disabled:opacity-40">Next</button></div> : null}
    {selected ? <aside role="dialog" aria-modal="true" aria-label="Platform audit event" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-[#193d48]/15 bg-[#f8fbfb] shadow-[-18px_0_60px_rgba(20,48,56,.18)]"><header className="flex items-start justify-between border-b border-[#193d48]/10 bg-white px-5 py-5"><div><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#719099]">Cloud event evidence</p><h2 className="mt-1 text-xl font-extrabold tracking-[-.03em] text-[#193d48]">{label(selected.action)}</h2><p className="mt-1 text-xs text-[#687c81]">{time(selected.created_at)} · {label(selected.actor_role)}</p></div><button type="button" onClick={() => setSelected(undefined)} aria-label="Close audit event" className="rounded-lg border border-[#193d48]/12 p-2 text-[#4f6d74] hover:bg-[#eff6f6]"><X className="h-4 w-4" /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="grid grid-cols-2 gap-3"><Detail label="Target" value={label(selected.target_type)} /><Detail label="Target reference" value={selected.target_id || 'Not recorded'} /><Detail label="Actor role" value={label(selected.actor_role)} /><Detail label="Actor reference" value={selected.actor_user_id || 'System / not recorded'} /></div><EvidencePanel title="Before" value={selected.before} /><EvidencePanel title="After" value={selected.after} /><p className="mt-5 rounded-xl border border-[#e6d49b] bg-[#fff9e9] px-3 py-3 text-xs leading-5 text-[#73561d]">This is rendered from the platform’s read-only audit API. It intentionally omits IP address and user-agent fields from this operator view.</p></div></aside> : null}
  </div>
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[#193d48]/10 bg-white p-3"><p className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#7c9398]">{label}</p><p className="mt-1 break-all text-xs font-bold text-[#294d57]">{value}</p></div> }
function EvidencePanel({ title, value }: { title: string; value: unknown }) { return <section className="mt-4 overflow-hidden rounded-xl border border-[#193d48]/10 bg-white"><h3 className="border-b border-[#193d48]/8 px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.14em] text-[#6f888e]">{title}</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-[#f5f9f9] p-3 text-[11px] leading-5 text-[#35555d]">{evidence(value)}</pre></section> }
function ErrorNotice({ error, fallback }: { error: unknown; fallback: string }) { return <div role="alert" className="m-4 flex items-start gap-2 rounded-xl bg-[#fde9e6] px-3 py-2.5 text-sm text-[#a44036]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{operatorErrorMessage(error, fallback)}</div> }
