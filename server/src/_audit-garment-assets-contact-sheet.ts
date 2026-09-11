import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = resolve(process.env.EPIC_GARMENT_CONTACT_SHEET || '../docs/v4/CATALOGUE_MEDIA_CONTACT_SHEET.html');
const suppliedDatabase = process.env.EPIC_AUDIT_DB_FILE || process.env.EPIC_DB_FILE;
const isolatedDirectory = suppliedDatabase ? undefined : mkdtempSync(join(tmpdir(), 'epic-garment-contact-sheet-'));
const tenant = process.env.EPIC_AUDIT_TENANT || 'T1';
const sourceLabel = suppliedDatabase ? `explicit workspace database: ${suppliedDatabase}` : 'fresh isolated demo workspace';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const applicationRoot = resolve(scriptDirectory, '..', 'public', 'app');

if (isolatedDirectory) {
  // Visual QA must never silently inspect a stale home-directory database.
  process.env.EPIC_DB_FILE = join(isolatedDirectory, 'epic.sqlite');
  process.env.EPIC_DATA_FILE = join(isolatedDirectory, 'legacy.json');
  process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
  process.env.EPIC_WORKSPACE_MODE = 'demo';
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));

let close: (() => void) | undefined;
try {
  const [{ store }, { auditGarmentAssets }] = await Promise.all([
    import('./kernel/store.js'),
    import('./modules/laundry/garment-assets.js'),
  ]);
  close = () => store.close();

  if (isolatedDirectory) {
    const [{ ensureDemoOwner }, { seedLaundryDefaults }] = await Promise.all([
      import('./modules/auth/auth.js'),
      import('./modules/laundry/domain.js'),
    ]);
    // The default catalogue includes all approved active garment visual keys
    // and runs the backfill used by a newly created V4 demo workspace.
    ensureDemoOwner(tenant, 'STORE-DEFAULT');
    seedLaundryDefaults(tenant);
  }

  const report = store.withStoreScope(tenant, process.env.EPIC_STORE_ID || 'STORE-DEFAULT', () => auditGarmentAssets(tenant));
  const rows = report.items.map((item) => {
    const asset = item.resolvedAsset?.startsWith('/ui/app/') ? resolve(applicationRoot, item.resolvedAsset.slice('/ui/app/'.length)) : undefined;
    const source = asset ? relative(dirname(output), asset).replaceAll('\\', '/') : '';
    return `<article class="card"><div class="thumb">${source ? `<img src="${escapeHtml(source)}" alt="${escapeHtml(item.name)}" loading="lazy">` : '<span class="missing">No local preview</span>'}</div><div class="name">${escapeHtml(item.name)}</div><div class="category">${escapeHtml(item.category || 'Uncategorised')}</div><div class="meta"><code>${escapeHtml(item.visualKey || '—')}</code><span class="pill ${escapeHtml(item.classification)}">${escapeHtml(item.classification)}</span></div><div class="path">${escapeHtml(item.resolvedAsset || item.photo || 'missing')}</div>${item.budgetWarning ? `<div class="warning">${escapeHtml(item.budgetWarning)}</div>` : ''}${item.issue ? `<div class="error">${escapeHtml(item.issue)}</div>` : ''}</article>`;
  }).join('\n');

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Epic Laundry catalogue media contact sheet</title><style>:root{color-scheme:light}body{font:14px Manrope,Inter,Segoe UI,sans-serif;background:#f8f7fc;color:#241a45;margin:32px}.summary{margin-bottom:24px;max-width:880px}.eyebrow{color:#664cf0;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}.card{background:#fffefe;border:1px solid #e5e0f2;border-radius:14px;padding:12px;box-shadow:0 5px 16px #241a450d}.thumb{height:180px;border-radius:10px;background:#f0edff;display:grid;place-items:center;overflow:hidden}.thumb img{width:100%;height:100%;object-fit:contain}.missing,.error{color:#b42318}.name{font-weight:800;margin-top:12px}.category{margin-top:3px;color:#767086;font-size:11px;font-weight:700}.meta{display:flex;justify-content:space-between;gap:8px;margin-top:6px;align-items:center}.pill{font-size:11px;padding:3px 6px;border-radius:999px;background:#e9f7f1;color:#187b5c}.path{font-size:10px;word-break:break-all;color:#767086;margin-top:8px}.warning{font-size:11px;color:#a96916;margin-top:7px}</style></head><body><div class="summary"><p class="eyebrow">Catalogue media QA</p><h1>Epic Laundry catalogue media contact sheet</h1><p>Source: <b>${escapeHtml(sourceLabel)}</b> · Tenant: <b>${escapeHtml(report.tenant)}</b> · Active garments: <b>${report.total}</b> · Failures: <b>${report.failures}</b> · Derivative budget warnings: <b>${report.budgetWarnings}</b></p><p>Generated: ${escapeHtml(report.generatedAt)}. Review every thumbnail visually; classification is evidence about storage and mapping, not legal or brand approval.</p></div><main class="grid">${rows}</main></body></html>`, 'utf8');
  console.log(`Catalogue media contact sheet written to ${output} (${sourceLabel})`);
  if (!report.ok) process.exitCode = 1;
} finally {
  close?.();
  if (isolatedDirectory) rmSync(isolatedDirectory, { recursive: true, force: true });
}
