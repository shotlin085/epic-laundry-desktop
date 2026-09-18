import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, KeyRound, MonitorPlay, Phone, ShieldCheck, Sparkles } from 'lucide-react'
import { apiGet, apiPost, operatorErrorMessage } from '@/lib/api'
import { lndryBrand } from '@/assets/generated/manifest'

type Session = { user: { username: string; roles: string[]; tenant: string; storeId: string } | null }
type WorkspaceMode = 'production' | 'demo'
type Setup = { businessName: string; firstName: string; lastName: string; username: string; password: string; confirmPassword: string; phone: string; email: string; address: string; upiId: string; taxMode: 'none' | 'gst'; gstin: string; currency: string; timezone: string; printerProfile: string }
const emptySetup: Setup = { businessName: '', firstName: '', lastName: '', username: '', password: '', confirmPassword: '', phone: '', email: '', address: '', upiId: '', taxMode: 'none', gstin: '', currency: 'INR', timezone: 'Asia/Kolkata', printerProfile: '' }
const SETUP_DRAFT_KEY = 'epic-laundry-setup-draft-v1'
function readSetupDraft() {
  if (typeof window === 'undefined') return { setup: emptySetup, step: 1 as 1 | 2 | 3 }
  try {
    const saved = JSON.parse(window.localStorage.getItem(SETUP_DRAFT_KEY) || '') as { setup?: Partial<Setup>; step?: number }
    return { setup: { ...emptySetup, ...saved.setup, password: '', confirmPassword: '' }, step: saved.step === 3 ? 3 as const : saved.step === 2 ? 2 as const : 1 as const }
  } catch { return { setup: emptySetup, step: 1 as 1 | 2 | 3 } }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'bootstrap' | 'signin' | 'cloud-login' | 'ready'>('loading')
  const [workspace, setWorkspace] = useState<WorkspaceMode>('production')
  const initialDraft = readSetupDraft()
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(initialDraft.step)
  const [setup, setSetup] = useState<Setup>(initialDraft.setup)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [cloudPhone, setCloudPhone] = useState('')
  const [cloudOtp, setCloudOtp] = useState('')
  const [cloudOtpSent, setCloudOtpSent] = useState(false)
  const [cloudDevOtp, setCloudDevOtp] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [backupConfigured, setBackupConfigured] = useState(false)

  useEffect(() => {
    const onExpired = () => { setPassword(''); setError('Your session expired. Sign in again.'); setState('signin') }
    window.addEventListener('epic-auth-expired', onExpired)
    return () => window.removeEventListener('epic-auth-expired', onExpired)
  }, [])
  useEffect(() => {
    if (state !== 'bootstrap' || typeof window === 'undefined') return
    const { password: _password, confirmPassword: _confirmPassword, ...safeSetup } = setup
    try { window.localStorage.setItem(SETUP_DRAFT_KEY, JSON.stringify({ setup: safeSetup, step: setupStep, savedAt: new Date().toISOString() })) } catch { /* private/locked storage must not block setup */ }
  }, [setup, setupStep, state])
  useEffect(() => {
    if (state !== 'bootstrap' || !window.epic?.backupLocation) return
    window.epic.backupLocation().then((result) => setBackupConfigured(Boolean(result.configured))).catch(() => setBackupConfigured(false))
  }, [state])

  useEffect(() => {
    const workspaceStatus = window.epic?.workspaceStatus?.() || apiGet<{ mode: WorkspaceMode }>('/workspace/status').catch(() => ({ mode: 'production' as WorkspaceMode }))
    Promise.all([apiGet<Session>('/auth/session').catch(() => null), apiGet<{ needsBootstrap: boolean }>('/auth/bootstrap-status'), workspaceStatus])
      .then(([session, bootstrap, desktopWorkspace]) => {
        setWorkspace(desktopWorkspace.mode)
        if (session?.user) { setState('ready'); return }
        // Production has exactly one door in: real vendor phone+OTP against
        // the real backend (see cloud-auth.ts) — there is no local
        // username/password bootstrap step to route to here at all, whether
        // or not a local identity already exists. Only the isolated demo
        // workspace keeps the original bootstrap/sign-in flow, since it has
        // no real backend account to verify against.
        if (desktopWorkspace.mode === 'production') { setState('cloud-login'); return }
        if (!bootstrap.needsBootstrap) { setUsername('demo'); setPassword('DemoLaundry!2026') }
        setState(bootstrap.needsBootstrap ? 'bootstrap' : 'signin')
      })
      .catch(() => { setError('The local Epic server is unavailable. Check that the desktop application is running.'); setState('cloud-login') })
  }, [])

  async function chooseWorkspace(mode: WorkspaceMode) {
    if (mode === workspace) return
    if (!window.epic?.selectWorkspace) { setError('Workspace switching is available in the Epic Laundry desktop application.'); return }
    setSaving(true); setError('')
    try { await window.epic.selectWorkspace(mode) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change workspace.') } finally { setSaving(false) }
  }

  async function chooseBackupLocation() {
    if (!window.epic?.chooseBackupLocation) { setError('Backup destination selection is available in the installed desktop application.'); return }
    setSaving(true); setError('')
    try { const result = await window.epic.chooseBackupLocation(); if (result.ok) setBackupConfigured(true) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not configure the backup destination.') } finally { setSaving(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    if (state === 'bootstrap' && setupStep < 3) { setSetupStep((setupStep + 1) as 2 | 3); return }
    if (state === 'bootstrap' && setup.password !== setup.confirmPassword) { setError('Passwords do not match.'); return }
    setSaving(true)
    try {
      if (state === 'cloud-login') {
        if (!cloudOtpSent) {
          const result = await apiPost<{ sent: true; otp?: string }>('/auth/cloud/otp', { phone: cloudPhone })
          setCloudOtpSent(true)
          setCloudDevOtp(result.otp || '')
          if (result.otp) setCloudOtp(result.otp)
          return
        }
        await apiPost('/auth/cloud/verify', { phone: cloudPhone, otp: cloudOtp })
        setState('ready'); setCloudOtp(''); setCloudOtpSent(false); setCloudDevOtp('')
        return
      }
      if (state === 'bootstrap') {
        await apiPost('/auth/bootstrap', setup)
        try { window.localStorage.removeItem(SETUP_DRAFT_KEY) } catch { /* best effort */ }
      }
      else await apiPost('/auth/sign-in', { username, password })
      setState('ready'); setPassword(''); setSetup((current) => ({ ...current, password: '', confirmPassword: '' }))
    } catch (cause) { setError(operatorErrorMessage(cause, 'Unable to sign in.')) } finally { setSaving(false) }
  }

  if (state === 'ready') return <>{children}</>
  if (state === 'loading') return <main className="grid min-h-screen place-items-center bg-[#f3f1ec] text-[#17363e]"><p className="rounded-xl border border-[#17363e]/10 bg-white px-5 py-3 text-sm shadow-sm">Opening your secure local workspace…</p></main>
  if (state === 'cloud-login') return <CloudLoginScreen
    phone={cloudPhone} setPhone={setCloudPhone}
    otp={cloudOtp} setOtp={setCloudOtp}
    otpSent={cloudOtpSent}
    devOtp={cloudDevOtp}
    error={error} saving={saving}
    onSubmit={submit}
    onOpenDemo={() => void chooseWorkspace('demo')}
  />

  const bootstrap = state === 'bootstrap'
  const demo = workspace === 'demo'
  return <main className="grid min-h-screen place-items-center bg-[#f3f1ec] p-5 text-[#17363e]">
    <section className="w-full max-w-xl rounded-3xl border border-[#17363e]/10 bg-white p-7 shadow-[0_24px_70px_rgba(18,48,57,.14)]">
      <div className="mb-7 flex items-start justify-between gap-4"><div className="flex items-start gap-4"><span className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-white shadow-sm"><img src={lndryBrand.mark} alt="Lndry" className="h-full w-full object-cover" /></span><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#3a7d78]">Epic Laundry desktop</p><h1 className="mt-1 font-serif text-2xl">{bootstrap ? 'Set up your workspace' : 'Welcome back'}</h1></div></div><ModeBadge demo={demo} /></div>
      {bootstrap ? <p className="mb-5 text-sm leading-6 text-[#617178]">{demo ? 'You are creating an isolated training workspace. It includes clearly marked sample activity and can be reset without touching your live records.' : 'You are creating a live production workspace. No example customers, orders, captains, payments or expenses will be added.'}</p> : <p className="mb-6 text-sm leading-6 text-[#617178]">Sign in to open your authorised counter workspace.</p>}
      {bootstrap ? <div className="mb-6 grid gap-2 sm:grid-cols-3"><Step active={setupStep === 1} done={setupStep > 1} label="Business" /><Step active={setupStep === 2} done={setupStep > 2} label="Owner access" /><Step active={setupStep === 3} label="Operations" /></div> : null}
      {bootstrap ? <WorkspaceChoice active={workspace} disabled={saving} onChoose={chooseWorkspace} /> : null}
      <form className="mt-6 space-y-4" onSubmit={submit}>
        {bootstrap && setupStep === 1 ? <BusinessStep setup={setup} setSetup={setSetup} /> : bootstrap && setupStep === 2 ? <OwnerStep setup={setup} setSetup={setSetup} /> : bootstrap ? <OperationsStep setup={setup} setSetup={setSetup} backupConfigured={backupConfigured} onChooseBackup={() => void chooseBackupLocation()} /> : <SignInStep username={username} password={password} setUsername={setUsername} setPassword={setPassword} />}
        {error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="flex gap-3">{bootstrap && setupStep > 1 ? <button type="button" onClick={() => setSetupStep((setupStep - 1) as 1 | 2)} className="inline-flex items-center gap-2 rounded-xl border border-[#17363e]/15 px-4 py-3 text-sm font-semibold text-[#31484d]"><ArrowLeft className="h-4 w-4" />Back</button> : null}<button disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#123039] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1d4a53] disabled:cursor-not-allowed disabled:opacity-60"><KeyRound className="h-4 w-4" />{saving ? 'Please wait…' : bootstrap && setupStep < 3 ? 'Continue' : bootstrap ? 'Finish secure setup' : 'Sign in'}</button></div>
      </form>
      {bootstrap ? <div className="mt-5 rounded-xl bg-[#f4f8f5] p-4 text-xs leading-5 text-[#587177]"><strong className="text-[#26494b]">What happens next:</strong> default services and garments are created as editable master data. Your tax, currency, timezone, printer profile and optional backup destination are saved with this branch; catalogue import remains authenticated owner-only work and is available from the readiness checklist after setup. Your business details and current step are saved as a local draft if the desktop is restarted; passwords are never saved.</div> : <>{demo ? <div className="mt-5 rounded-xl border border-[#e6c56e]/60 bg-[#fff8e8] p-4 text-xs leading-5 text-[#745516]"><strong className="text-[#62440e]">Demo access</strong><span className="ml-1">is prefilled for this isolated training workspace: username <code className="rounded bg-white/70 px-1 py-0.5 font-mono">demo</code> and password <code className="rounded bg-white/70 px-1 py-0.5 font-mono">DemoLaundry!2026</code>.</span></div> : null}<button type="button" disabled={saving} onClick={() => void chooseWorkspace(demo ? 'production' : 'demo')} className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#39786f]"><MonitorPlay className="h-4 w-4" />{demo ? 'Return to production workspace' : 'Open isolated demo workspace'}</button></>}
    </section>
  </main>
}

function CloudLoginScreen({ phone, setPhone, otp, setOtp, otpSent, devOtp, error, saving, onSubmit, onOpenDemo }: {
  phone: string; setPhone: (value: string) => void; otp: string; setOtp: (value: string) => void; otpSent: boolean; devOtp: string;
  error: string; saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onOpenDemo: () => void;
}) {
  return <main className="grid min-h-screen place-items-center bg-[#f3f1ec] p-5 text-[#17363e]">
    <section className="w-full max-w-md rounded-3xl border border-[#17363e]/10 bg-white p-7 shadow-[0_24px_70px_rgba(18,48,57,.14)]">
      <div className="mb-7 flex items-start gap-4">
        <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-white shadow-sm"><img src={lndryBrand.mark} alt="Lndry" className="h-full w-full object-cover" /></span>
        <div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#3a7d78]">Epic Laundry desktop</p><h1 className="mt-1 font-serif text-2xl">Sign in with your LNDRY vendor number</h1></div>
      </div>
      <p className="mb-6 text-sm leading-6 text-[#617178]">This is your real LNDRY marketplace account — the same number you use on the Vendor App. Only a shop owner or staff phone can open this desktop; Captain (delivery) accounts don't have access here.</p>
      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block text-sm font-semibold">Registered phone number
          <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-[#17363e]/15 px-3 focus-within:ring-2 focus-within:ring-[#3a7d78]">
            <Phone className="h-4 w-4 shrink-0 text-[#8b959a]" />
            <input type="tel" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} required disabled={otpSent} autoFocus value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile number" className="h-11 w-full bg-transparent font-normal outline-none disabled:text-[#8b959a]" />
          </div>
        </label>
        {otpSent ? <Field label="One-time code" required autoComplete="one-time-code" value={otp} onChange={setOtp} placeholder="6-digit code" /> : null}
        {otpSent && devOtp ? <p className="rounded-xl border border-[#e6c56e]/60 bg-[#fff8e8] px-3 py-2 text-xs leading-5 text-[#745516]"><strong className="text-[#62440e]">Demo OTP:</strong> <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-sm">{devOtp}</code> — no real SMS provider is connected yet, so the code is shown here instead.</p> : null}
        {error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#123039] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1d4a53] disabled:cursor-not-allowed disabled:opacity-60">
          <KeyRound className="h-4 w-4" />{saving ? 'Please wait…' : otpSent ? 'Verify and sign in' : 'Send code'}
        </button>
      </form>
      <button type="button" disabled={saving} onClick={onOpenDemo} className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#39786f]"><MonitorPlay className="h-4 w-4" />Open isolated demo workspace instead</button>
    </section>
  </main>
}

function ModeBadge({ demo }: { demo: boolean }) { return demo ? <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#fff2ce] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#855815]"><Sparkles className="h-3.5 w-3.5" />Demo workspace</span> : <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#eaf3ef] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#2e6a60]"><ShieldCheck className="h-3.5 w-3.5" />Production</span> }
function Step({ active, done, label }: { active?: boolean; done?: boolean; label: string }) { return <span className={`flex-1 rounded-lg px-3 py-2 text-center text-xs font-bold ${active ? 'bg-[#123039] text-white' : done ? 'bg-[#eaf3ef] text-[#2e6a60]' : 'bg-[#f2f1ed] text-[#79868a]'}`}>{done ? <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> : null}{label}</span> }
function WorkspaceChoice({ active, disabled, onChoose }: { active: WorkspaceMode; disabled: boolean; onChoose: (mode: WorkspaceMode) => void }) { return <div className="grid gap-3 sm:grid-cols-2"><button type="button" disabled={disabled} onClick={() => void onChoose('production')} className={`rounded-2xl border p-4 text-left transition ${active === 'production' ? 'border-[#39786f] bg-[#eef7f2] ring-1 ring-[#39786f]/20' : 'border-[#17363e]/15 hover:bg-[#f8f9f6]'}`}><ShieldCheck className="h-5 w-5 text-[#39786f]" /><p className="mt-2 text-sm font-bold">Production workspace</p><p className="mt-1 text-xs leading-5 text-[#617178]">Your real business records. Starts with no sample transactions.</p></button><button type="button" disabled={disabled} onClick={() => void onChoose('demo')} className={`rounded-2xl border p-4 text-left transition ${active === 'demo' ? 'border-[#c79129] bg-[#fff8e8] ring-1 ring-[#c79129]/20' : 'border-[#17363e]/15 hover:bg-[#f8f9f6]'}`}><Sparkles className="h-5 w-5 text-[#ae7820]" /><p className="mt-2 text-sm font-bold">Demo workspace</p><p className="mt-1 text-xs leading-5 text-[#617178]">Separate sample data for training and exploring the app.</p></button></div> }
function BusinessStep({ setup, setSetup }: { setup: Setup; setSetup: (next: Setup) => void }) { const set = (key: keyof Setup, value: string) => setSetup({ ...setup, [key]: value }); return <><Field label="Business name" required value={setup.businessName} onChange={(value) => set('businessName', value)} placeholder="Lndry Laundry Care" /><Field label="Business phone" required type="tel" value={setup.phone} onChange={(value) => set('phone', value)} placeholder="Store contact number" /><Field label="Business email" type="email" value={setup.email} onChange={(value) => set('email', value)} placeholder="owner@example.com" /><Field label="Store address" required multiline value={setup.address} onChange={(value) => set('address', value)} placeholder="Address for receipts and delivery operations" /><Field label="UPI ID (optional)" value={setup.upiId} onChange={(value) => set('upiId', value)} placeholder="store@bank" /></> }
function OwnerStep({ setup, setSetup }: { setup: Setup; setSetup: (next: Setup) => void }) { const set = (key: keyof Setup, value: string) => setSetup({ ...setup, [key]: value }); return <><div className="grid gap-4 sm:grid-cols-2"><Field label="Owner first name" required value={setup.firstName} onChange={(value) => set('firstName', value)} /><Field label="Owner last name" value={setup.lastName} onChange={(value) => set('lastName', value)} /></div><Field label="Username" required minLength={3} autoComplete="username" value={setup.username} onChange={(value) => set('username', value)} /><Field label="Secure password" required minLength={12} autoComplete="new-password" type="password" value={setup.password} onChange={(value) => set('password', value)} hint="At least 12 characters. This password is never stored in plain text." /><Field label="Confirm password" required minLength={12} autoComplete="new-password" type="password" value={setup.confirmPassword} onChange={(value) => set('confirmPassword', value)} /></> }
function OperationsStep({ setup, setSetup, backupConfigured, onChooseBackup }: { setup: Setup; setSetup: (next: Setup) => void; backupConfigured: boolean; onChooseBackup: () => void }) { const set = (key: keyof Setup, value: string) => setSetup({ ...setup, [key]: value }); return <><div className="rounded-xl bg-[#f4f8f5] p-3 text-xs leading-5 text-[#587177]">These defaults control invoices and counter operations. You can change them later from Owner controls.</div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Tax mode<select value={setup.taxMode} onChange={(event) => set('taxMode', event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-[#17363e]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#3a7d78]"><option value="none">No GST registration</option><option value="gst">GST registered</option></select></label><Field label="GSTIN (required for GST mode)" value={setup.gstin} disabled={setup.taxMode !== 'gst'} placeholder="15-character GSTIN" onChange={(value) => set('gstin', value.toUpperCase())} /></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Currency code" required minLength={3} value={setup.currency} onChange={(value) => set('currency', value.toUpperCase())} hint="Three-letter ISO code, for example INR." /><label className="text-sm font-semibold">Timezone<select value={setup.timezone} onChange={(event) => set('timezone', event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-[#17363e]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#3a7d78]"><option value="Asia/Kolkata">Asia/Kolkata (India)</option><option value="Asia/Dhaka">Asia/Dhaka</option><option value="Asia/Dubai">Asia/Dubai</option><option value="UTC">UTC</option></select></label></div><label className="text-sm font-semibold">Printer profile<select value={setup.printerProfile} onChange={(event) => set('printerProfile', event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-[#17363e]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#3a7d78]"><option value="">Not configured yet</option><option value="system-default">System default</option><option value="thermal-58mm">Thermal receipt · 58 mm</option><option value="thermal-80mm">Thermal receipt · 80 mm</option></select><span className="mt-1 block text-xs font-normal text-[#718087]">Selecting a profile does not claim a printer is connected.</span></label><div className="rounded-xl border border-[#263f44]/10 bg-[#fafbf8] p-3"><p className="text-sm font-semibold text-[#31484d]">Recovery destination</p><p className="mt-1 text-xs leading-5 text-[#718087]">{backupConfigured ? 'A branch-scoped snapshot folder is configured.' : 'Choose an off-device folder for rolling snapshots.'}</p><button type="button" onClick={onChooseBackup} className="mt-2 rounded-lg border border-[#39786f]/30 bg-white px-3 py-2 text-xs font-bold text-[#39786f]">{backupConfigured ? 'Change folder' : 'Choose folder'}</button></div><p className="text-xs leading-5 text-[#718087]">After setup, use the owner readiness checklist to import the full catalogue and verify a backup snapshot.</p></> }
function SignInStep({ username, password, setUsername, setPassword }: { username: string; password: string; setUsername: (value: string) => void; setPassword: (value: string) => void }) { return <><Field label="Username" autoComplete="username" required minLength={3} value={username} onChange={setUsername} /><Field label="Password" autoComplete="current-password" required minLength={12} type="password" value={password} onChange={setPassword} /></> }
function Field({ label, value, placeholder, onChange, type = 'text', required, disabled, minLength, autoComplete, hint, multiline = false }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void; type?: string; required?: boolean; disabled?: boolean; minLength?: number; autoComplete?: string; hint?: string; multiline?: boolean }) { return <label className="block text-sm font-semibold">{label}{multiline ? <textarea required={required} disabled={disabled} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="mt-1.5 min-h-20 w-full rounded-xl border border-[#17363e]/15 px-3 py-2.5 font-normal outline-none ring-[#3a7d78] disabled:bg-[#f5f7f3] focus:ring-2" /> : <input type={type} autoComplete={autoComplete} required={required} disabled={disabled} minLength={minLength} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#17363e]/15 px-3 py-2.5 font-normal outline-none ring-[#3a7d78] disabled:bg-[#f5f7f3] focus:ring-2" />}{hint ? <span className="mt-1 block text-xs font-normal text-[#718087]">{hint}</span> : null}</label> }
