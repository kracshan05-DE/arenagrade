// Local PostgreSQL test harness.
// Starts a real PostgreSQL 17 server (embedded-postgres), builds a template
// database from the Supabase shim + inferred base schema + every migration in
// supabase/migrations, and lets each test file clone its own database from it.
import EmbeddedPostgres from 'embedded-postgres'
import { Client } from 'pg'
import { mkdtempSync, readdirSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const PG_PORT = Number(process.env.PGTEST_PORT || 55433)
export const PG_USER = 'postgres'
export const PG_PASSWORD = 'postgres'
export const TEMPLATE_DB = 'arenagrade_template'

const ROOT = join(__dirname, '..', '..')

export function sqlFilesInOrder(): { name: string; sql: string }[] {
  const fixtures = join(ROOT, 'supabase', 'tests', 'fixtures')
  const migrations = join(ROOT, 'supabase', 'migrations')
  const pick = (dir: string) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => ({ name: `${dir.split('/').slice(-2).join('/')}/${f}`, sql: readFileSync(join(dir, f), 'utf8') }))
  const files = [...pick(fixtures), ...pick(migrations)]
  // Test-quality check: PGTEST_MUTATION=<name> applies tests/db/mutations/<name>.sql
  // last, to prove the suite FAILS against a deliberately broken database.
  if (process.env.PGTEST_MUTATION) {
    const f = join(ROOT, 'tests', 'db', 'mutations', `${process.env.PGTEST_MUTATION}.sql`)
    files.push({ name: `mutation/${process.env.PGTEST_MUTATION}`, sql: readFileSync(f, 'utf8') })
  }
  return files
}

export async function startServer() {
  const dataDir = process.env.PGTEST_DATA_DIR || mkdtempSync(join(tmpdir(), 'arenagrade-pg-'))
  try { chmodSync(dataDir, 0o777) } catch { /* not root: fine */ }
  const server = new EmbeddedPostgres({
    databaseDir: join(dataDir, 'data'),
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: false,
    onLog: () => {},
    onError: () => {},
    postgresFlags: ['-c', 'max_connections=200', '-c', 'TimeZone=UTC'],
  })
  await server.initialise()
  await server.start()
  return server
}

export function connect(database: string) {
  return new Client({ host: '127.0.0.1', port: PG_PORT, user: PG_USER, password: PG_PASSWORD, database })
}

export async function buildTemplate() {
  const admin = connect('postgres')
  await admin.connect()
  await admin.query(`drop database if exists ${TEMPLATE_DB}`)
  await admin.query(`create database ${TEMPLATE_DB}`)
  await admin.end()

  const c = connect(TEMPLATE_DB)
  await c.connect()
  for (const f of sqlFilesInOrder()) {
    try {
      await c.query(f.sql)
    } catch (e) {
      const err = e as Error & { position?: string }
      throw new Error(`Applying ${f.name} failed: ${err.message} (position ${err.position ?? '?'})`)
    }
  }
  await c.end()
}

let dbCounter = 0
export async function createTestDatabase(): Promise<string> {
  const name = `t_${process.pid}_${Date.now()}_${dbCounter++}`
  const admin = connect('postgres')
  await admin.connect()
  await admin.query(`create database ${name} template ${TEMPLATE_DB}`)
  await admin.end()
  return name
}
