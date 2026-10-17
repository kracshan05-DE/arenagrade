import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { connect, createTestDatabase } from './pg-harness'

export type Role = 'anon' | 'authenticated' | 'service_role'

export class TestDb {
  constructor(public name: string, public su: Client) {}

  static async create() {
    const name = await createTestDatabase()
    const su = connect(name)
    await su.connect()
    return new TestDb(name, su)
  }

  async close() {
    await this.su.end()
  }

  /** A fresh connection (used for genuinely concurrent sessions). */
  async client() {
    const c = connect(this.name)
    await c.connect()
    return c
  }

  /**
   * Run one statement as an API role, the way PostgREST does: inside a
   * transaction with SET LOCAL ROLE and the JWT claims in request.jwt.claims.
   */
  async as<T = Record<string, unknown>>(role: Role, uid: string | null, sql: string, params: unknown[] = [], c?: Client) {
    const conn = c ?? (await this.client())
    try {
      await conn.query('begin')
      await conn.query(`set local role ${role}`)
      await conn.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(uid ? { sub: uid, role } : { role }),
      ])
      const r = await conn.query(sql, params)
      await conn.query('commit')
      return r.rows as T[]
    } catch (e) {
      await conn.query('rollback').catch(() => {})
      throw e
    } finally {
      if (!c) await conn.end()
    }
  }

  async user(opts: { role?: string; phoneVerified?: boolean; phone?: string } = {}) {
    const id = randomUUID()
    await this.su.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id.slice(0, 8)}@test.local`])
    await this.su.query(
      `insert into public.profiles (id, full_name, phone, phone_verified, role) values ($1, $2, $3, $4, $5)`,
      [id, 'Test User', opts.phone ?? null, opts.phoneVerified ?? false, opts.role ?? 'customer'],
    )
    return id
  }

  /** Create n users one at a time (a single pg client must not run queries concurrently). */
  async users(n: number, opts: { role?: string; phoneVerified?: boolean } = {}) {
    const ids: string[] = []
    for (let i = 0; i < n; i++) ids.push(await this.user(opts))
    return ids
  }

  async court(opts: { hasHalf?: boolean; cutoff?: string; active?: boolean } = {}) {
    const r = await this.su.query(
      `insert into public.courts (name, has_half_court, half_court_cutoff, is_active)
       values ('Test Court', $1, $2, $3) returning id`,
      [opts.hasHalf ?? true, opts.cutoff ?? '14:00', opts.active ?? true],
    )
    return r.rows[0].id as string
  }

  async slot(courtId: string, date: string, start: string, end: string, type: string, opts: { price?: number; status?: string } = {}) {
    const r = await this.su.query(
      `insert into public.slots (court_id, slot_date, start_time, end_time, court_type, status, price_lkr)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [courtId, date, start, end, type, opts.status ?? 'available', opts.price ?? 3000],
    )
    return r.rows[0].id as string
  }

  /** full_court + half_a + half_b at the same time. */
  async slotGroup(courtId: string, date: string, start: string, end: string) {
    return {
      full: await this.slot(courtId, date, start, end, 'full_court', { price: 5000 }),
      halfA: await this.slot(courtId, date, start, end, 'half_a', { price: 3000 }),
      halfB: await this.slot(courtId, date, start, end, 'half_b', { price: 3000 }),
    }
  }

  async slotRow(id: string) {
    return (await this.su.query(`select * from public.slots where id = $1`, [id])).rows[0]
  }

  async hold(uid: string, slotId: string, c?: Client) {
    const rows = await this.as<{ r: Record<string, unknown> }>('authenticated', uid, `select public.hold_slot($1) as r`, [slotId], c)
    return rows[0].r
  }

  /** Force a hold's expiry into the past (simulates the 10 minutes passing). */
  async expireHold(slotId: string) {
    await this.su.query(`update public.slots set lock_expires_at = now() - interval '1 second' where id = $1`, [slotId])
  }

  async service<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return this.as<T>('service_role', null, sql, params)
  }
}

/** A date N days from today in Asia/Colombo, as YYYY-MM-DD. */
export function colomboDate(daysFromToday: number) {
  const d = new Date(Date.now() + daysFromToday * 86_400_000)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
}

/** Settle all promises and split fulfilled / rejected. */
export async function settle<T>(ps: Promise<T>[]) {
  const results = await Promise.allSettled(ps)
  return {
    ok: results.filter((r): r is PromiseFulfilledResult<Awaited<T>> => r.status === 'fulfilled').map((r) => r.value),
    errors: results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => (r.reason as Error).message),
  }
}
