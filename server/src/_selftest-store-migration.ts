import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-store-migration-'));
const legacyFile = join(tempDir, 'legacy.json');
const sqliteFile = join(tempDir, 'legacy.sqlite');

// Reproduce the first SQLite schema produced before store-level scoping.
const legacy = new Database(sqliteFile);
legacy.exec(`
  CREATE TABLE entity_rows (
    tenant TEXT NOT NULL, id TEXT NOT NULL, entity TEXT NOT NULL, status TEXT NOT NULL,
    version INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY (tenant, id)
  );
  CREATE TABLE records (kind TEXT NOT NULL, tenant TEXT NOT NULL, id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY (kind, tenant, id));
  CREATE TABLE sequences (series TEXT PRIMARY KEY, value INTEGER NOT NULL);
  CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
legacy.prepare('INSERT INTO entity_rows VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('MIGRATE', 'ROW-1', 'party', 'Active', 1, 'legacy', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', JSON.stringify({ name: 'Migrated customer', is_customer: true }));
legacy.close();

process.env.EPIC_DATA_FILE = legacyFile;
process.env.EPIC_DB_FILE = sqliteFile;
let closeStore: (() => void) | undefined;
try {
  const { store } = await import('./kernel/store.js');
  closeStore = () => store.close();
  const migrated = store.withStoreScope('MIGRATE', 'STORE-DEFAULT', () => store.getRow('MIGRATE', 'ROW-1'));
  assert.equal(migrated?.data.name, 'Migrated customer', 'legacy SQLite data is available in the default store after migration');
  const hiddenFromOtherStore = store.withStoreScope('MIGRATE', 'STORE-B', () => store.getRow('MIGRATE', 'ROW-1'));
  assert.equal(hiddenFromOtherStore, undefined, 'migrated rows are isolated from other stores');
  const migrations = store.migrationStatus();
  assert.deepEqual(migrations.map((migration) => migration.version), Array.from({ length: migrations.length }, (_, index) => index + 1), 'schema migrations are recorded in monotonically ordered versions');
  assert.equal(migrations.at(-1)?.name, 'platform-admin-session', 'latest platform-admin migration is checksum-tracked');
  assert.ok(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum)), 'each migration has a SHA-256 checksum');
  const constraintProbe = new Database(sqliteFile);
  try {
    const printJobSchema = constraintProbe.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tag_print_jobs'").get() as { sql: string };
    assert.match(printJobSchema.sql, /CHECK\(status IN/, 'print jobs have a database-level status constraint');
    const containerSchema = constraintProbe.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'laundry_containers'").get() as { sql: string };
    assert.match(containerSchema.sql, /CHECK\(state IN/, 'container tags have a database-level lifecycle constraint');
    assert.throws(() => constraintProbe.prepare('INSERT INTO tag_print_jobs(id,tenant,store_id,order_id,template_id,template_version,printer_profile,tag_ids_json,document_type,requested_copies,requested_by,created_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('invalid-status', 'MIGRATE', 'STORE-DEFAULT', 'missing-order', 'template', '1', 'system-default', '[]', 'garment-tags', 1, 'test', new Date().toISOString(), 'NotAStatus'), /CHECK constraint failed/, 'database rejects an invalid print-job status');
    assert.throws(() => constraintProbe.prepare('INSERT INTO tag_print_jobs(id,tenant,store_id,order_id,template_id,template_version,printer_profile,tag_ids_json,document_type,requested_copies,requested_by,created_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('invalid-document', 'MIGRATE', 'STORE-DEFAULT', 'missing-order', 'template', '1', 'system-default', '[]', 'not-a-document', 1, 'test', new Date().toISOString(), 'Queued'), /CHECK constraint failed/, 'database rejects an invalid print document type');
  } finally {
    constraintProbe.close();
  }
  console.log('PASS  legacy SQLite store-scope migration self-test complete');
} finally {
  closeStore?.();
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort Windows cleanup */ }
}
