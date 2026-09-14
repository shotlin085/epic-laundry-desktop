import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-workspace-mode-'));
const diagnostics = new Map<number, string>();

function start(mode: 'production' | 'demo', port: number): ChildProcess {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', EPIC_WORKSPACE_MODE: mode, EPIC_DB_FILE: join(tempDir, `epic-${mode}.sqlite`), EPIC_LEGACY_JSON_FILE: join(tempDir, `epic-${mode}.json`) },
  });
  diagnostics.set(port, '');
  const append = (data: Buffer) => diagnostics.set(port, `${diagnostics.get(port) || ''}${data.toString('utf8')}`.slice(-4000));
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return child;
}

async function waitForHealth(port: number) {
  // A clean demo workspace intentionally materializes the deep visual fixture
  // before listening. Keep the bound finite, but allow the fixture to bootstrap
  // on slower Windows/CI runners instead of treating expected seed work as a
  // server-health failure. This is a test-only wait; production startup still
  // has the same deterministic seed-before-listen contract.
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`workspace-mode server on ${port} did not become healthy: ${diagnostics.get(port) || 'no child output'}`);
}

async function stop(child: ChildProcess) {
  if (!child.killed) child.kill();
  await new Promise<void>((resolve) => { const timeout = setTimeout(resolve, 3000); child.once('exit', () => { clearTimeout(timeout); resolve(); }); });
}

async function bootstrap(port: number, username: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'WorkspaceModeTestPassword!26', firstName: 'Workspace', businessName: 'Workspace Test', phone: '9000000000', address: 'Test address' }) });
  const payload = await response.json() as { error?: string };
  assert.equal(response.status, 200, `owner bootstrap succeeds: ${payload.error || 'unknown bootstrap failure'}`);
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

async function signIn(port: number, username: string, password: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  const payload = await response.json() as { error?: string };
  assert.equal(response.status, 200, `demo owner sign-in succeeds: ${payload.error || 'unknown sign-in failure'}`);
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

async function orders(port: number, cookie: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/laundry/orders`, { headers: { cookie } });
  assert.equal(response.status, 200, 'owner can read the order list');
  return response.json() as Promise<Array<{ id: string }>>;
}

let production: ChildProcess | undefined;
let demo: ChildProcess | undefined;
try {
  production = start('production', 3251);
  await waitForHealth(3251);
  const productionWorkspace = await fetch('http://127.0.0.1:3251/api/workspace/status').then((response) => response.json() as Promise<{ mode: string }>);
  assert.equal(productionWorkspace.mode, 'production', 'server reports production workspace mode');
  const productionStatus = await fetch('http://127.0.0.1:3251/api/auth/bootstrap-status').then((response) => response.json() as Promise<{ needsBootstrap: boolean }>);
  assert.equal(productionStatus.needsBootstrap, true, 'new production workspace has no silent owner');
  const productionOrders = await orders(3251, await bootstrap(3251, 'production-owner'));
  assert.equal(productionOrders.length, 0, 'production workspace never receives generated orders');
  await stop(production); production = undefined;

  demo = start('demo', 3252);
  await waitForHealth(3252);
  const demoWorkspace = await fetch('http://127.0.0.1:3252/api/workspace/status').then((response) => response.json() as Promise<{ mode: string }>);
  assert.equal(demoWorkspace.mode, 'demo', 'server reports demo workspace mode');
  const demoOrders = await orders(3252, await signIn(3252, 'demo', 'DemoLaundry!2026'));
  assert.ok(demoOrders.length > 0, 'explicit demo workspace receives sample orders');
  await stop(demo); demo = undefined;
  console.log('PASS production/demo workspace separation self-test complete');
} finally {
  if (production) await stop(production);
  if (demo) await stop(demo);
  rmSync(tempDir, { recursive: true, force: true });
}
