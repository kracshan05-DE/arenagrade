// Every embedded select the browser or server sends ("table(...)" inside
// .select()) must be unambiguous for PostgREST. Since migration 0800,
// bookings <-> slots has two relationships (bookings.slot_id and the
// booking_slots join table); an unhinted "slots(...)" from bookings fails with
// PGRST201, which broke the payment success page on 22 Oct 2026.
//
// This test extracts the selects from the source code automatically and runs
// each one through a real PostgREST server against the migrated database.
// It needs the PostgREST binary: set POSTGREST_BIN (CI downloads it).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { TestDb } from '../db/helpers'
import { PG_PORT } from '../db/pg-harness'

const BIN = process.env.POSTGREST_BIN ?? ''
const ROOT = join(__dirname, '..', '..')
const SECRET = 'postgrest-test-secret-'.padEnd(40, 'x')
const PORT = 3399

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return sourceFiles(p)
    return /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}

/** [table, select, file] for every .from('x').select('...(...)...') in the app. */
export function embeddedSelects() {
  const pat = /\.from\(\s*'([a-z_]+)'\s*\)\s*\.select\(\s*(['`])([\s\S]*?)\2/g
  const out = new Map<string, [string, string, string]>()
  for (const dir of ['app', 'components', 'lib']) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      for (const m of readFileSync(file, 'utf8').matchAll(pat)) {
        if (m[3].includes('(') && !m[3].includes('${')) out.set(`${m[1]}|${m[3]}`, [m[1], m[3].replace(/\s+/g, ' ').trim(), file.slice(ROOT.length + 1)])
      }
    }
  }
  return [...out.values()]
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
function jwt(role: string) {
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64({ role, exp: Math.floor(Date.now() / 1000) + 3600 })
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}

describe.skipIf(!BIN || !existsSync(BIN))('PostgREST: every embedded select used by the app resolves', () => {
  let db: TestDb
  let proc: ChildProcess
  beforeAll(async () => {
    db = await TestDb.create()
    await db.su.query(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'authenticator') then
          create role authenticator login password 'authenticator' noinherit;
        end if; end $$;
      grant anon, authenticated, service_role to authenticator;`)
    proc = spawn(BIN, [], { env: { ...process.env,
      PGRST_DB_URI: `postgres://authenticator:authenticator@localhost:${PG_PORT}/${db.name}`,
      PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRET, PGRST_SERVER_PORT: String(PORT),
    } })
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`http://localhost:${PORT}/`)).status < 500) return } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error('PostgREST did not start')
  })
  afterAll(async () => { proc?.kill(); await db?.close() })

  const selects = embeddedSelects()
  it('finds the app\'s embedded selects', () => {
    expect(selects.length).toBeGreaterThanOrEqual(6)
    expect(selects.some(([t]) => t === 'bookings')).toBe(true)
  })

  it.each(selects)('%s: %s (%s)', async (table, select) => {
    const r = await fetch(`http://localhost:${PORT}/${table}?select=${encodeURIComponent(select)}&limit=1`,
      { headers: { Authorization: `Bearer ${jwt('service_role')}`, Accept: 'application/json' } })
    const body = await r.text()
    expect(r.status, body).toBe(200)
  })
})
