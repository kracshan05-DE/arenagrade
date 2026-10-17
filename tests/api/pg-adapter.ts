// Test-only DbAdapter: same interface the routes use in production, but backed
// by the local PostgreSQL. RPCs run the real migration functions under the real
// API roles (service_role / authenticated with JWT claims).
import type { DbAdapter, AuthUser } from '@/lib/server/db'
import { DbError } from '@/lib/server/db'
import type { TestDb } from '../db/helpers'

export const tokenFor = (uid: string) => `test-token:${uid}`

function call(fn: string, args: Record<string, unknown>) {
  const keys = Object.keys(args)
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`
  const params = keys.map((k) => {
    const v = args[k]
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
  })
  return { sql, params }
}

function asDbError(e: unknown) {
  const msg = (e as Error).message ?? 'database_error'
  return new DbError(/^[a-z_]+$/.test(msg) ? msg : 'database_error', msg)
}

export function pgAdapter(db: TestDb): DbAdapter {
  return {
    async getUser(token: string): Promise<AuthUser | null> {
      const m = /^test-token:([0-9a-f-]{36})$/.exec(token)
      if (!m) return null
      const r = await db.su.query(`select id, email from auth.users where id = $1`, [m[1]])
      return r.rows[0] ? { id: r.rows[0].id, email: r.rows[0].email } : null
    },
    async rpcAsService<T>(fn: string, args: Record<string, unknown>) {
      const { sql, params } = call(fn, args)
      try { return (await db.as<{ r: T }>('service_role', null, sql, params))[0].r } catch (e) { throw asDbError(e) }
    },
    async rpcAsUser<T>(token: string, fn: string, args: Record<string, unknown>) {
      const uid = token.replace('test-token:', '')
      const { sql, params } = call(fn, args)
      try { return (await db.as<{ r: T }>('authenticated', uid, sql, params))[0].r } catch (e) { throw asDbError(e) }
    },
    async getProfile(userId: string) {
      return (await db.su.query(`select full_name, phone, phone_verified from public.profiles where id = $1`, [userId])).rows[0] ?? null
    },
    async getUserEmail(userId: string) {
      return (await db.su.query(`select email from auth.users where id = $1`, [userId])).rows[0]?.email ?? null
    },
    async getSlotSummary(slotId: string) {
      const r = await db.su.query(`
        select s.id as slot_id, s.court_id, c.name as court_name, l.name as location_name, l.address as location_address,
               to_char(s.slot_date, 'YYYY-MM-DD') as slot_date, s.start_time::text, s.end_time::text, s.court_type
        from public.slots s join public.courts c on c.id = s.court_id left join public.locations l on l.id = c.location_id
        where s.id = $1`, [slotId])
      return r.rows[0] ?? null
    },
    async getPaymentAttempt(orderId: string) {
      const r = await db.su.query(`
        select order_id, user_id, slot_id, to_char(amount_lkr, 'FM9999999990.00') as amount_lkr, currency, provider, environment, status
        from public.payment_attempts where order_id = $1`, [orderId])
      return r.rows[0] ?? null
    },
    async ping() { return true },
  }
}
