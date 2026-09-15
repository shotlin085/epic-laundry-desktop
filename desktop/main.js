// Epic BOS desktop launcher.
// Self-contained: this Electron app OWNS the backend. On launch it boots the Fastify server as a
// child process (no external server, no internet required), waits for it to be healthy, then loads
// the control UI from it. On quit it terminates the child. Works the same on Windows / macOS / Linux.
//
// Dev  : server lives at ../server and runs via `tsx` (hot reload).
// Prod : server is copied to resources/server (extraResources) and runs as compiled JS (node dist/index.js).
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, dialog, Notification, safeStorage } = require('electron');

// Auto-update (prod only). Wrapped so a missing update server never breaks launch.
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch { autoUpdater = null; }
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { readWorkspace, selectWorkspace, workspacePaths, resetDemoWorkspace } = require('./workspace');
const { createPreRestoreSnapshot } = require('./recovery-policy');
const { resolveMarketplaceCloudApiUrl } = require('./cloud-config');

const isDev = !app.isPackaged;
const HOST = '127.0.0.1'; // bind locally only — the app is the only consumer
const startupSecret = crypto.randomBytes(32).toString('base64url');
const startupNonce = crypto.randomBytes(24).toString('base64url');
const externalHosts = new Set(['updates.epicbos.app', 'web.whatsapp.com', 'wa.me', 'checkout.razorpay.com', 'dashboard.razorpay.com']);

// Where the server binary lives.
const serverDir = isDev
  ? path.join(__dirname, '..', 'server')
  : path.join(process.resourcesPath, 'server');

const internalApiKey = crypto.randomBytes(32).toString('base64url');
const nodeCandidates = process.platform === 'win32'
  ? [process.env.ProgramW6432, process.env.ProgramFiles, 'C:\\Program Files'].filter(Boolean).map((base) => path.join(base, 'nodejs', 'node.exe'))
  : [];
const systemNode = nodeCandidates.find((candidate) => fs.existsSync(candidate)) || 'node';

let serverProc = null;
let mainWin = null;
let tray = null;
let activeWorkspace = null;
let serverPort = null;
let serverOutput = '';
let resolveServerReady;
let rejectServerReady;
const serverReady = new Promise((resolve, reject) => { resolveServerReady = resolve; rejectServerReady = reject; });
function waitForAuthenticatedServer(timeoutMs = 30000) {
  return Promise.race([
    serverReady,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('local server did not complete authenticated startup')), timeoutMs)),
  ]);
}

function initializeWorkspace() {
  const userDataDir = app.getPath('userData');
  const selected = readWorkspace(userDataDir);
  activeWorkspace = workspacePaths(userDataDir, selected.mode, selected.backupDirectory);
  return activeWorkspace;
}

function getWorkspace() {
  if (!activeWorkspace) return initializeWorkspace();
  return activeWorkspace;
}

function getBackupsDir() { return getWorkspace().backupsDir; }
function readRecoveryRehearsal() {
  try {
    const reportPath = path.join(getBackupsDir(), 'recovery-rehearsal.json');
    if (!fs.existsSync(reportPath)) return null;
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return report && report.ok === true ? report : null;
  } catch { return null; }
}
function backupStatus() {
  const directory = getBackupsDir();
  try {
    fs.mkdirSync(directory, { recursive: true });
    let writable = true;
    try { fs.accessSync(directory, fs.constants.W_OK); } catch { writable = false; }
    const files = fs.readdirSync(directory).filter((file) => file.startsWith('autobackup-') && (file.endsWith('.epicbackup') || file.endsWith('.json'))).sort();
    const latest = files.at(-1);
    const latestStat = latest ? fs.statSync(path.join(directory, latest)) : null;
    const latestIso = latestStat ? latestStat.mtime.toISOString() : null;
    const ageHours = latestStat ? Math.max(0, (Date.now() - latestStat.mtimeMs) / 3_600_000) : null;
    const stale = ageHours === null || ageHours > 36;
    const reason = !writable ? 'backup destination is not writable' : !latest ? 'no automatic snapshot found' : stale ? 'latest automatic snapshot is stale' : 'ok';
    const rehearsal = readRecoveryRehearsal();
    const verifiedLatest = Boolean(rehearsal && latest && rehearsal.snapshot === latest);
    return { configured: Boolean(getWorkspace().backupDirectory), path: directory, healthy: writable && !stale && verifiedLatest, writable, stale, ageHours, reason: verifiedLatest ? reason : (reason === 'ok' ? 'latest snapshot has not passed a recovery verification' : reason), encrypted: Boolean(latest && latest.endsWith('.epicbackup')), latest: latestIso, rehearsal };
  } catch (error) { return { configured: Boolean(getWorkspace().backupDirectory), path: directory, healthy: false, writable: false, stale: true, ageHours: null, reason: error instanceof Error ? error.message : 'backup destination could not be inspected', encrypted: false, latest: null }; }
}
function getServerPort() {
  if (!serverPort) throw new Error('local Epic server port is not available');
  return serverPort;
}
function localAppUrl(pathname = '/ui/app/') { return `http://${HOST}:${getServerPort()}${pathname}`; }
function isLocalAppUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' && url.hostname === HOST && url.port === String(getServerPort()) && url.pathname.startsWith('/ui/');
  } catch { return false; }
}
function openApprovedExternal(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !externalHosts.has(url.hostname)) throw new Error('blocked unapproved external destination');
  return shell.openExternal(url.toString());
}
function configuredUpdateFeed() {
  const raw = String(process.env.EPIC_UPDATE_FEED_URL || '').trim();
  if (!raw) return null;
  try { const url = new URL(raw); if (url.protocol !== 'https:' || !externalHosts.has(url.hostname)) return null; return url.toString(); } catch { return null; }
}
function assertTrustedIpc(event) {
  if (!mainWin || event.sender !== mainWin.webContents || !isLocalAppUrl(event.sender.getURL())) throw new Error('blocked IPC from an untrusted renderer');
}

function processServerOutput(chunk) {
  serverOutput += chunk.toString('utf8');
  const lines = serverOutput.split(/\r?\n/);
  serverOutput = lines.pop() || '';
  for (const line of lines) {
    if (process.env.EPIC_DEBUG) process.stdout.write(`[server] ${line}\n`);
    if (!line.startsWith('EPIC_READY ')) continue;
    try {
      const ready = JSON.parse(line.slice('EPIC_READY '.length));
      const expected = crypto.createHmac('sha256', startupSecret).update(`${startupNonce}:${ready.port}`).digest('hex');
      if (!Number.isInteger(ready.port) || ready.port < 1024 || ready.port > 65535 || ready.nonce !== startupNonce || ready.proof !== expected) throw new Error('invalid backend startup proof');
      if (serverPort && serverPort !== ready.port) throw new Error('backend emitted conflicting startup port');
      serverPort = ready.port;
      resolveServerReady({ port: serverPort });
    } catch (error) { rejectServerReady(error); }
  }
}

function startServer() {
  const workspace = getWorkspace();
  const marketplaceCloudApiUrl = resolveMarketplaceCloudApiUrl({ isDev });
  const env = {
    ...process.env,
    PORT: '0',
    HOST,
    EPIC_DATA_FILE: workspace.legacyFile,
    EPIC_DB_FILE: workspace.databaseFile,
    EPIC_LEGACY_JSON_FILE: workspace.legacyFile,
    EPIC_WORKSPACE_MODE: workspace.mode,
    EPIC_INTERNAL_API_KEY: internalApiKey,
    EPIC_STARTUP_SECRET: startupSecret,
    EPIC_STARTUP_NONCE: startupNonce,
    // In dev we want the same sandbox GSP + any user .env values to pass through.
    GSP_PROVIDER: process.env.GSP_PROVIDER || 'sandbox',
    // Supplier state is persisted in the tenant tax profile. Do not inject a
    // silent demo state into production; the server must fail closed until
    // the store has completed tax setup.
    ...(process.env.EPIC_SUPPLIER_STATE ? { EPIC_SUPPLIER_STATE: process.env.EPIC_SUPPLIER_STATE } : {}),
    // Production is pointed at the canonical LNDRY API by the launcher, not
    // by browser code. This only configures the endpoint; every protected
    // cloud operation still requires the operator's own OTP/admin session.
    ...(marketplaceCloudApiUrl ? { EPIC_MARKETPLACE_CLOUD_API_URL: marketplaceCloudApiUrl } : {}),
  };
  const stdio = ['ignore', 'pipe', 'pipe'];
  if (isDev) {
    // Dev: run via tsx. Use a shell so `npx` resolves on Windows (no extension lookup otherwise).
    serverProc = spawn('npx tsx src/index.ts', { cwd: serverDir, env, stdio, shell: true });
  } else {
    // Prod: compiled JS is copied to resources/server. The bundled native
    // SQLite driver is rebuilt for the supported system Node runtime.
    serverProc = spawn(systemNode, ['dist/index.js'], { cwd: serverDir, env, stdio });
  }
  serverProc.stdout.on('data', processServerOutput);
  serverProc.stderr.on('data', (d) => { process.stderr.write(`[server:err] ${d}`); });
  serverProc.on('exit', (code) => {
    if (!serverPort) rejectServerReady(new Error(`local server exited before authenticated startup (${code ?? 'unknown'})`));
    if (code && code !== 0 && !app.isQuiting) console.error(`[server] exited code ${code}`);
  });
}

function waitForHealth(retries = 60, delay = 500) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      const req = http.get({ host: HOST, port: getServerPort(), path: '/api/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (n++ >= retries) return reject(new Error('server did not become healthy'));
      setTimeout(tick, delay);
    };
    tick();
  });
}

// Minimal promise-based HTTP against the local bundled server (127.0.0.1 only).
function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: HOST, port: getServerPort(), path: apiPath, method,
      headers: {
        'x-epic-internal-key': internalApiKey,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(text);
        else reject(new Error(`API ${method} ${apiPath} -> ${res.statusCode}: ${text.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('API request timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function nativeNotify(title, body) {
  try { if (Notification.isSupported()) new Notification({ title: title || 'Epic Laundry', body: body || '' }).show(); }
  catch { /* notifications are best-effort */ }
}

function tsStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-07-20T05-42-45
}

// Pull a full snapshot from the server and write it to disk (used by menu, IPC, and auto-backup).
async function writeBackupTo(filePath) {
  const snapshot = await apiRequest('GET', '/api/ops/backup');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, snapshot, 'utf8');
  return filePath;
}

// Automatic local recovery snapshots never need to be portable. Protect their
// generated passphrase with Electron safeStorage so a copied backup folder alone
// cannot disclose business data, while explicit user exports remain passphrase-driven.
function autoBackupPassphrase() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const keyFile = path.join(app.getPath('userData'), 'auto-backup-key.bin');
  try {
    // The file contains Base64 *text*. Decode that text into the original
    // protected byte buffer before handing it to Electron safeStorage.
    if (fs.existsSync(keyFile)) return safeStorage.decryptString(Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64'));
    const passphrase = crypto.randomBytes(32).toString('base64url');
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, safeStorage.encryptString(passphrase).toString('base64'));
    return passphrase;
  } catch { return null; }
}

async function writeEncryptedBackupTo(filePath, passphrase) {
  const snapshot = await apiRequest('POST', '/api/ops/backup/encrypted', { passphrase });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, snapshot, 'utf8');
  return filePath;
}

async function verifyRecoverySnapshot(filePath) {
  let backup;
  try { backup = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { throw new Error('automatic recovery snapshot is not valid JSON'); }
  const encrypted = filePath.endsWith('.epicbackup');
  const response = encrypted
    ? await apiRequest('POST', '/api/ops/restore/encrypted/verify', { backup, passphrase: autoBackupPassphrase() })
    : await apiRequest('POST', '/api/ops/restore/verify', backup);
  const summary = JSON.parse(response);
  const rehearsalResponse = encrypted
    ? await apiRequest('POST', '/api/ops/restore/encrypted/rehearse', { backup, passphrase: autoBackupPassphrase() })
    : await apiRequest('POST', '/api/ops/restore/rehearse', backup);
  const rehearsal = JSON.parse(rehearsalResponse);
  const report = { ok: true, verifiedAt: new Date().toISOString(), snapshot: path.basename(filePath), encrypted, rows: Number(summary.rows || 0), financialEntries: Number(summary.financialEntries || 0), financialDocuments: Number(summary.financialDocuments || 0), customerLedgerEntries: Number(summary.customerLedgerEntries || 0), cashShiftCloses: Number(summary.cashShiftCloses || 0), freshDatabase: { ok: rehearsal.ok === true, isolatedDatabase: rehearsal.isolatedDatabase === true, digest: String(rehearsal.digest || ''), counts: rehearsal.counts || {} } };
  fs.mkdirSync(getBackupsDir(), { recursive: true });
  fs.writeFileSync(path.join(getBackupsDir(), 'recovery-rehearsal.json'), JSON.stringify(report, null, 2), 'utf8');
  return report;
}

async function doBackupDialog() {
  const suggested = path.join(app.getPath('documents'), `EpicLaundry-backup-${tsStamp()}.json`);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
    title: 'Backup Epic Laundry data',
    defaultPath: suggested,
    filters: [{ name: 'Epic Laundry Backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  await writeBackupTo(filePath);
  nativeNotify('Backup complete', `Saved to ${path.basename(filePath)}`);
  return { ok: true, path: filePath };
}

async function doEncryptedBackupDialog(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) throw new Error('backup passphrase must be at least 12 characters');
  const suggested = path.join(app.getPath('documents'), `EpicLaundry-encrypted-backup-${tsStamp()}.epicbackup`);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, { title: 'Save encrypted Epic Laundry backup', defaultPath: suggested, filters: [{ name: 'Encrypted Epic Laundry Backup', extensions: ['epicbackup'] }] });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const snapshot = await apiRequest('POST', '/api/ops/backup/encrypted', { passphrase });
  fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, snapshot, 'utf8');
  nativeNotify('Encrypted backup complete', `Saved to ${path.basename(filePath)}`);
  return { ok: true, path: filePath };
}

async function doRestoreDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWin, {
    title: 'Restore Epic Laundry data from backup',
    properties: ['openFile'],
    filters: [{ name: 'Epic Laundry Backup', extensions: ['json'] }],
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
  const raw = fs.readFileSync(filePaths[0], 'utf8');
  let db; try { db = JSON.parse(raw); } catch { throw new Error('Selected file is not valid JSON'); }
  // Verify integrity and workspace binding before asking for confirmation or
  // creating a pre-restore snapshot. Invalid input must have no side effects.
  await apiRequest('POST', '/api/ops/restore/verify', db);
  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'warning',
    buttons: ['Restore (replace all data)', 'Cancel'],
    defaultId: 1, cancelId: 1,
    title: 'Confirm restore',
    message: 'Restoring replaces ALL current data with the contents of this backup.',
    detail: 'A safety backup of your current data is saved automatically first. Continue?',
  });
  if (response !== 0) return { ok: false, canceled: true };
  // Safety net: snapshot current state before we overwrite it.
  await createPreRestoreSnapshot(writeBackupTo, path.join(getBackupsDir(), `pre-restore-${tsStamp()}.json`));
  await apiRequest('POST', '/api/ops/restore', db);
  nativeNotify('Restore complete', 'Data restored. Reloading…');
  if (mainWin) mainWin.reload();
  return { ok: true, restored: filePaths[0] };
}

async function doEncryptedRestoreDialog(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) throw new Error('backup passphrase must be at least 12 characters');
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWin, { title: 'Restore encrypted Epic Laundry backup', properties: ['openFile'], filters: [{ name: 'Encrypted Epic Laundry Backup', extensions: ['epicbackup', 'json'] }] });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
  let backup; try { backup = JSON.parse(fs.readFileSync(filePaths[0], 'utf8')); } catch { throw new Error('Selected encrypted backup is not valid JSON'); }
  // Decrypt and validate before confirmation/safety snapshot so a wrong
  // passphrase or tampered envelope cannot alter the current workspace.
  await apiRequest('POST', '/api/ops/restore/encrypted/verify', { backup, passphrase });
  const { response } = await dialog.showMessageBox(mainWin, { type: 'warning', buttons: ['Restore (replace all data)', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Confirm encrypted restore', message: 'Restoring replaces ALL current data with the encrypted backup contents.', detail: 'A safety backup of your current data is saved automatically first.' });
  if (response !== 0) return { ok: false, canceled: true };
  await createPreRestoreSnapshot(writeBackupTo, path.join(getBackupsDir(), `pre-encrypted-restore-${tsStamp()}.json`));
  await apiRequest('POST', '/api/ops/restore/encrypted', { backup, passphrase });
  nativeNotify('Encrypted restore complete', 'Data restored. Reloading…'); if (mainWin) mainWin.reload();
  return { ok: true, restored: filePaths[0] };
}

let autoBackupBusy = false;
// Scheduled/local recovery snapshots: keep the last 10 rolling encrypted snapshots in userData/backups.
async function writeAutoBackupSnapshot() {
  if (autoBackupBusy) return null;
  autoBackupBusy = true;
  try {
    const backupsDir = getBackupsDir();
    const passphrase = autoBackupPassphrase();
    const snapshotPath = passphrase ? path.join(backupsDir, `autobackup-${tsStamp()}.epicbackup`) : path.join(backupsDir, `autobackup-${tsStamp()}.json`);
    if (passphrase) await writeEncryptedBackupTo(snapshotPath, passphrase);
    else await writeBackupTo(snapshotPath);
    await verifyRecoverySnapshot(snapshotPath);
    const files = fs.readdirSync(backupsDir).filter((f) => f.startsWith('autobackup-') && (f.endsWith('.epicbackup') || f.endsWith('.json'))).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 10))) {
      try { fs.unlinkSync(path.join(backupsDir, f)); } catch { /* ignore */ }
    }
    return true;
  } catch (error) {
    try { fs.writeFileSync(path.join(getBackupsDir(), 'recovery-rehearsal.json'), JSON.stringify({ ok: false, verifiedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'recovery verification failed' }, null, 2), 'utf8'); } catch { /* never block quit on a backup failure */ }
  }
  finally { autoBackupBusy = false; }
  return null;
}

async function autoBackupOnQuit() {
  try { await writeAutoBackupSnapshot(); } catch { /* never block quit on a backup failure */ }
}

function startAutoBackupSchedule() {
  const configured = Number(process.env.EPIC_AUTO_BACKUP_INTERVAL_MS || 6 * 60 * 60 * 1000);
  const intervalMs = Number.isFinite(configured) ? Math.min(Math.max(configured, 15 * 60 * 1000), 7 * 24 * 60 * 60 * 1000) : 6 * 60 * 60 * 1000;
  const timer = setInterval(() => { if (!app.isQuiting) void writeAutoBackupSnapshot(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

// ---- IPC: native actions requested by the renderer (via preload bridge) ----
ipcMain.handle('epic:backup', (event) => { assertTrustedIpc(event); return doBackupDialog(); });
ipcMain.handle('epic:restore', (event) => { assertTrustedIpc(event); return doRestoreDialog(); });
ipcMain.handle('epic:encrypted-backup', (event, passphrase) => { assertTrustedIpc(event); return doEncryptedBackupDialog(passphrase); });
ipcMain.handle('epic:encrypted-restore', (event, passphrase) => { assertTrustedIpc(event); return doEncryptedRestoreDialog(passphrase); });
ipcMain.handle('epic:open-backups', (event) => { assertTrustedIpc(event); const backupsDir = getBackupsDir(); fs.mkdirSync(backupsDir, { recursive: true }); return shell.openPath(backupsDir); });
ipcMain.handle('epic:backup-location', (event) => { assertTrustedIpc(event); return { configured: Boolean(getWorkspace().backupDirectory), path: getBackupsDir() }; });
ipcMain.handle('epic:backup-status', (event) => { assertTrustedIpc(event); return backupStatus(); });
ipcMain.handle('epic:verify-latest-backup', async (event) => { assertTrustedIpc(event); const files = fs.readdirSync(getBackupsDir()).filter((file) => file.startsWith('autobackup-') && (file.endsWith('.epicbackup') || file.endsWith('.json'))).sort(); if (!files.length) throw new Error('no automatic recovery snapshot found'); return verifyRecoverySnapshot(path.join(getBackupsDir(), files.at(-1))); });
ipcMain.handle('epic:choose-backup-location', async (event) => {
  assertTrustedIpc(event);
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWin, { title: 'Choose encrypted recovery backup folder', properties: ['openDirectory', 'createDirectory'] });
  if (canceled || !filePaths?.[0]) return { ok: false, canceled: true, path: getBackupsDir() };
  const destination = path.resolve(filePaths[0]);
  if (destination === path.parse(destination).root) throw new Error('choose a folder below the filesystem root');
  selectWorkspace(app.getPath('userData'), getWorkspace().mode, destination);
  activeWorkspace = workspacePaths(app.getPath('userData'), getWorkspace().mode, destination);
  fs.mkdirSync(activeWorkspace.backupsDir, { recursive: true });
  return { ok: true, path: activeWorkspace.backupsDir };
});
ipcMain.handle('epic:workspace-status', (event) => { assertTrustedIpc(event); return { mode: getWorkspace().mode }; });
ipcMain.handle('epic:select-workspace', (event, mode) => {
  assertTrustedIpc(event);
  if (mode !== 'production' && mode !== 'demo') throw new Error('invalid workspace mode');
  if (mode === getWorkspace().mode) return { mode, changed: false };
  selectWorkspace(app.getPath('userData'), mode, getWorkspace().backupDirectory);
  app.relaunch();
  app.exit(0);
  return { mode, changed: true };
});
ipcMain.handle('epic:reset-demo-workspace', (event) => {
  assertTrustedIpc(event);
  if (getWorkspace().mode !== 'demo') throw new Error('demo reset is available only in the demo workspace');
  if (serverProc) { try { serverProc.kill('SIGTERM'); } catch { /* ignore */ } }
  resetDemoWorkspace(app.getPath('userData'));
  app.relaunch();
  app.exit(0);
  return { ok: true };
});
ipcMain.on('epic:notify', (event, { title, body } = {}) => { assertTrustedIpc(event); nativeNotify(title, body); });

ipcMain.handle('epic:export-pdf', async (event, suggestedName) => {
  assertTrustedIpc(event);
  if (!mainWin) return { ok: false };
  const suggested = path.join(app.getPath('documents'), `${(suggestedName || 'EpicLaundry').replace(/[^\w.-]/g, '_')}.pdf`);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
    title: 'Export current view to PDF',
    defaultPath: suggested,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const data = await mainWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  fs.writeFileSync(filePath, data);
  nativeNotify('PDF exported', `Saved to ${path.basename(filePath)}`);
  return { ok: true, path: filePath };
});

ipcMain.handle('epic:save-file', async (event, { content = '', suggestedName = 'export.csv', filters } = {}) => {
  assertTrustedIpc(event);
  const suggested = path.join(app.getPath('documents'), suggestedName.replace(/[^\w.-]/g, '_'));
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
    title: 'Save file',
    defaultPath: suggested,
    filters: filters || [{ name: 'CSV', extensions: ['csv'] }, { name: 'All Files', extensions: ['*'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, content, 'utf8');
  return { ok: true, path: filePath };
});

// Print an isolated HTML document from the renderer through the native system dialog.
// This avoids relying on window.open(), which is intentionally denied by the external-link policy.
ipcMain.handle('epic:print-html', async (event, html) => {
  assertTrustedIpc(event);
  if (typeof html !== 'string' || html.length > 2_000_000) throw new Error('Print document is invalid or too large');
  const printWin = new BrowserWindow({
    parent: mainWin || undefined,
    show: false,
    width: 800,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const result = await new Promise((resolve) => {
      printWin.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => resolve({ success, failureReason }));
    });
    if (!result.success) return { ok: false, canceled: result.failureReason === 'cancelled' };
    return { ok: true };
  } finally {
    if (!printWin.isDestroyed()) printWin.close();
  }
});

// Export the same controlled print document to PDF. The hidden window keeps the
// renderer shell out of the output and makes preview, native print, and PDF use
// one authoritative HTML renderer.
ipcMain.handle('epic:export-html-pdf', async (event, { html, suggestedName } = {}) => {
  assertTrustedIpc(event);
  if (typeof html !== 'string' || html.length > 2_000_000) throw new Error('Print document is invalid or too large');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
    title: 'Download PDF',
    defaultPath: path.join(app.getPath('documents'), `${String(suggestedName || 'EpicLaundry').replace(/[^\w.-]/g, '_')}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const printWin = new BrowserWindow({ show: false, width: 900, height: 1100, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const data = await printWin.webContents.printToPDF({ printBackground: true });
    fs.writeFileSync(filePath, data);
    nativeNotify('PDF downloaded', `Saved to ${path.basename(filePath)}`);
    return { ok: true, path: filePath };
  } finally {
    if (!printWin.isDestroyed()) printWin.close();
  }
});

// Send the loaded Laundry Desk to a specific React hash route. The desktop owns one
// operational product surface: the Laundry Desk. Generic ERP prototype pages are deliberately
// not exposed from the menu because they do not share the laundry order lifecycle or UI system.
function navigate(route) {
  if (!mainWin) return;
  if (route.startsWith('/ui/')) mainWin.loadURL(localAppUrl(route));
  else mainWin.loadURL(localAppUrl(`/ui/app/#${route}`));
}

// India-first application menu — mirrors the modules an Indian SME runs day to day.
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const go = (route) => () => navigate(route);
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Laundry Order', accelerator: 'CmdOrCtrl+N', click: go('/laundry/new-order') },
        { label: 'Store Orders', accelerator: 'CmdOrCtrl+B', click: go('/laundry/orders') },
        { type: 'separator' },
        { label: 'Backup Data…', accelerator: 'CmdOrCtrl+Shift+B', click: () => doBackupDialog().catch((e) => dialog.showErrorBox('Backup failed', String(e.message || e))) },
        { label: 'Restore Data…', click: () => doRestoreDialog().catch((e) => dialog.showErrorBox('Restore failed', String(e.message || e))) },
        { label: 'Open Backups Folder', click: () => { const backupsDir = getBackupsDir(); fs.mkdirSync(backupsDir, { recursive: true }); shell.openPath(backupsDir); } },
        { type: 'separator' },
        { label: 'Export View to PDF…', accelerator: 'CmdOrCtrl+P', click: () => ipcMain.emit('epic:export-pdf-menu') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Laundry Desk',
      submenu: [
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: go('/laundry/dashboard') },
        { label: 'Order & Billing', click: go('/laundry/new-order') },
        { label: 'Store Orders', click: go('/laundry/orders') },
        { label: 'Garments & Prices', click: go('/laundry/catalogue') },
      ],
    },
    {
      label: 'Operations',
      submenu: [
        { label: 'Operations centre', accelerator: 'CmdOrCtrl+3', click: go('/laundry/operations') },
        { type: 'separator' },
        { label: 'Production queue', click: go('/laundry/production-queue') },
        { label: 'Garment tracking', click: go('/laundry/garment-tracking') },
        { label: 'Quality & corrections', click: go('/laundry/quality-claims') },
        { label: 'Pickup & delivery', click: go('/laundry/dispatch') },
        { label: 'Route runs', click: go('/laundry/routes') },
        { label: 'Print centre', click: go('/laundry/print-centre') },
      ],
    },
    {
      label: 'Finance & Compliance',
      submenu: [
        { label: 'Finance & compliance centre', accelerator: 'CmdOrCtrl+2', click: go('/laundry/finance') },
        { type: 'separator' },
        { label: 'Cash closing', click: go('/laundry/cash-closing') },
        { label: 'Store expenses', click: go('/laundry/expenses') },
        { label: 'Rider settlements', click: go('/laundry/settlements') },
        { label: 'Invoices & print documents', click: go('/laundry/print-centre') },
        { label: 'Financial reports', click: go('/laundry/reports') },
        { label: 'Tax & invoice settings', click: go('/laundry/settings') },
        { label: 'Correction documents', click: go('/laundry/corrections') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Laundry Dashboard', accelerator: 'CmdOrCtrl+0', click: go('/laundry/dashboard') },
        { label: 'Operational overview', click: go('/laundry/operations') },
        { label: 'Financial overview', click: go('/laundry/finance') },
        { type: 'separator' },
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Epic Laundry on the Web', click: () => openApprovedExternal('https://updates.epicbos.app/') },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Menu -> PDF export (needs a save dialog; reuse the IPC handler path).
ipcMain.on('epic:export-pdf-menu', async () => {
  try {
    const title = mainWin ? mainWin.webContents.getTitle().replace(/[^\w.-]/g, '_') : 'EpicLaundry';
    const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
      title: 'Export current view to PDF',
      defaultPath: path.join(app.getPath('documents'), `${title}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return;
    const data = await mainWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    fs.writeFileSync(filePath, data);
    nativeNotify('PDF exported', `Saved to ${path.basename(filePath)}`);
  } catch (e) { dialog.showErrorBox('PDF export failed', String(e.message || e)); }
});

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1366, height: 860, minWidth: 960, minHeight: 640,
    title: 'Epic Laundry', backgroundColor: '#123039', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });

  const session = mainWin.webContents.session;
  // The counter UI does not need ambient browser permissions. Hardware integrations will
  // be exposed through audited desktop adapters rather than renderer permissions.
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onHeadersReceived((details, callback) => {
    if (!isLocalAppUrl(details.url)) return callback({ responseHeaders: details.responseHeaders });
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) if (key.toLowerCase() === 'content-security-policy') delete headers[key];
    headers['Content-Security-Policy'] = ["default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"];
    callback({ responseHeaders: headers });
  });

  mainWin.loadURL(localAppUrl('/ui/app/#/laundry/dashboard'));

  // Keep renderer startup failures visible in the packaged app log. Without these
  // listeners a React/bootstrap exception looks like a completely empty window to
  // an operator and is effectively impossible to diagnose from the desktop shell.
  mainWin.webContents.on('dom-ready', () => {
    console.log(`[renderer] DOM ready: ${mainWin.webContents.getURL()}`);
  });
  mainWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(`[renderer] load failed: code=${errorCode} description=${errorDescription} url=${validatedURL} mainFrame=${isMainFrame}`);
  });
  mainWin.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const severity = ['debug', 'info', 'warning', 'error'][level] || String(level);
    console.error(`[renderer:${severity}] ${message} (${sourceId}:${line})`);
  });
  mainWin.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer] process gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });

  // Navigation is local-only. Deliberately supported external providers open in the OS browser after URL allowlisting.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    try { if (!isLocalAppUrl(url)) openApprovedExternal(url); } catch { /* blocked destination */ }
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!isLocalAppUrl(url)) {
      e.preventDefault();
      try { openApprovedExternal(url); } catch { /* blocked destination */ }
    }
  });

  mainWin.once('ready-to-show', () => mainWin.show());
  if (process.env.EPIC_DEVTOOLS === '1') mainWin.webContents.openDevTools({ mode: 'detach' });

  mainWin.on('close', (e) => {
    // On macOS keep the app alive with the tray; hide instead of quit unless quitting.
    if (process.platform === 'darwin' && !app.isQuiting) { e.preventDefault(); mainWin.hide(); }
  });
}

function createTray() {
  // System tray with Show / Quit. (Icon is optional; without one Electron uses a default.)
  const ctx = Menu.buildFromTemplate([
    { label: 'Show Epic Laundry', click: () => { mainWin.show(); mainWin.focus(); } },
    { label: 'Quit', click: () => quitApp() },
  ]);
  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
    tray.setToolTip('Epic Laundry');
    tray.setContextMenu(ctx);
    tray.on('click', () => { mainWin.show(); mainWin.focus(); });
  } catch {
    // No icon asset: skip tray visual but keep menu semantics via app.
    app.on('browser-window-created', () => {});
  }
}

let quitting = false;
const recoveryMode = process.argv.includes('--recover-production-from-auto-backup') || process.env.EPIC_RECOVERY_MODE === '1';
async function quitApp() {
  if (quitting) return;
  quitting = true;
  app.isQuiting = true;
  // Roll a backup while the server is still alive, then terminate it.
  await autoBackupOnQuit();
  if (serverProc) { try { serverProc.kill('SIGTERM'); } catch {} }
  app.quit();
}

// Allow the renderer to request a quit (via preload bridge).
ipcMain.on('app:quit', (event) => { assertTrustedIpc(event); quitApp(); });

if (recoveryMode) {
  // Deliberately separate from ordinary startup: this performs a rehearsed,
  // local-only recovery and exits without opening the operator workspace.
  require('./scripts/recover-production-from-auto-backup.cjs');
} else {
// Single instance: a second launch focuses the running window instead of opening two backends.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
app.on('second-instance', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });

app.whenReady().then(async () => {
  initializeWorkspace();
  startServer();
  try {
    await waitForAuthenticatedServer();
    await waitForHealth();
  } catch (e) {
    dialog.showErrorBox('Epic Laundry failed to start', String(e && e.message || e));
    quitApp();
    return;
  }
  createWindow();
  buildMenu();
  createTray();
  startAutoBackupSchedule();
  nativeNotify('Epic Laundry is ready', 'Your offline laundry desk is running locally.');

  // Self-update is fail-closed: a packaged app never contacts an implicit or
  // untrusted feed. Configure an HTTPS allow-listed provider explicitly, then
  // the normal Electron updater flow can be enabled for that release channel.
  const updateFeed = configuredUpdateFeed();
  if (autoUpdater && app.isPackaged && updateFeed) {
    autoUpdater.setFeedURL({ url: updateFeed });
    autoUpdater.autoInstallOnQuit = true;
    autoUpdater.on('update-available', () => { if (process.env.EPIC_DEBUG) console.log('[updater] update available'); });
    autoUpdater.on('update-downloaded', async () => {
      const { response } = await dialog.showMessageBox(mainWin, { type: 'info', title: 'Update ready', message: 'A new Epic Laundry version is installed. Restart now?', buttons: ['Restart', 'Later'] });
      if (response === 0) autoUpdater.quitAndInstall();
    });
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  } else if (app.isPackaged && process.env.EPIC_DEBUG) {
    console.log('[updater] disabled: no approved EPIC_UPDATE_FEED_URL configured');
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
}

app.on('before-quit', () => { if (serverProc) { try { serverProc.kill('SIGTERM'); } catch {} } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') quitApp(); });
