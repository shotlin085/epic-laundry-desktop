import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const auditRoot = tmpdir();
const auditName = `epic-laundry-ui-${process.pid}`;
const port = Number(process.env.PLAYWRIGHT_PORT || 3920);
const localBrowser = [
  join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => candidate && existsSync(candidate));

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Every demo spec uses one deliberately stateful local workspace. A single
  // worker prevents a production-empty-state flow from switching the fixture
  // while another spec is signing into demo.
  workers: 1,
  testIgnore: '**/empty-state-walkthrough.spec.ts',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...(localBrowser ? { launchOptions: { executablePath: localBrowser } } : {}),
  },
  webServer: {
    command: 'npm --prefix ../server run start',
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      EPIC_WORKSPACE_MODE: 'demo',
      EPIC_DB_FILE: join(auditRoot, `${auditName}.sqlite`),
      EPIC_LEGACY_JSON_FILE: join(auditRoot, `${auditName}.json`),
      EPIC_REPORT_EXPORT_DIR: join(auditRoot, `${auditName}-report-exports`),
    },
  },
});
