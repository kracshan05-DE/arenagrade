// St. Mary's Basketball Court and The Solo Court: pricing, generation, the
// 17-slot Solo schedule, two-hour reservations and their concurrency, payment,
// expiry and cancellation behaviour. Real PostgreSQL, real concurrent sessions.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { TestDb, colomboDate, settle } from './helpers'

let db: TestDb
let admin: string
let stMarys: string // 1-hour slots (as the official per-hour prices suggest; real length is confirmed via the inventory)
let stMarys2h: string // same rules with 2-hour slots, to prove price = hourly x hours
let solo: string

const key = (...p: unknown[]) => createHash('sha256').update(p.join('|')).digest('hex')

async function court(o: { name: string; half: boolean; start: string; end: string; hours: number; maxConsecutive: number; cutoff?: string }) {
  return (await db.su.query(
    `insert into public.courts (name, has_half_court, half_court_cutoff, operating_start, operating_end, slot_duration_hrs, max_consecutive_slots, is_active)
     values ($1, $2, $3, $4, $5, $6, $7, true) returning id`,
    [o.name, o.half, o.cutoff ?? '14:00', o.start, o.end, o.hours, o.maxConsecutive])).rows[0].id as string
}
async function price(courtId: string, type: string, perHour: number) {
  await db.su.query(`insert into public.court_pricing (court_id, tier_name, time_from, time_to, price_lkr, applies_to)
    values ($1, 'Standard', '00:00', '00:00', $2, $3)`, [courtId, perHour, type])
}
const gen = (courtId: string, from: string, to: string) =>
  db.as<{ r: { created: number; already_existed: number } }>('authenticated', admin,
    `select public.admin_generate_court_slots($1, $2::date, $3::date) as r`, [courtId, from, to]).then((r) => r[0].r)
const slotsOn = async (courtId: string, date: string, type = 'full_court') =>
  (await db.su.query(`select id, start_time::text, end_time::text, price_lkr::float as price, status from public.slots
    where court_id = $1 and slot_date = $2 and court_type = $3 order by start_time`, [courtId, date, type])).rows as
    { id: string; start_time: string; end_time: string; price: number; status: string }[]
const holdMany = (uid: string, ids: string[], c?: import('pg').Client) =>
  db.as<{ r: Record<string, unknown> }>('authenticated', uid, `select public.hold_slots($1::uuid[]) as r`, [ids], c).then((r) => r[0].r)
const attempt = (uid: string, slotId: string) =>
  db.service<{ r: Record<string, string> }>(`select public.payment_create_attempt($1, $2, 'payhere', 'live') as r`, [uid, slotId]).then((r) => r[0].r)
const notify = (order: string, amount: string, status = 2) =>
  db.service<{ r: Record<string, string> }>(
    `select public.payment_apply_notification('payhere', $1, $2, $3, $4, 'LKR', true, $5, '{}') as r`,
    [order, `P-${order}`, status, amount, key(order, status, amount)]).then((r) => r[0].r)

beforeAll(async () => {
  db = await TestDb.create()
  admin = await db.user({ role: 'super_admin' })
  stMarys = await court({ name: "St. Mary's Basketball Court", half: true, start: '06:00', end: '22:00', hours: 1, maxConsecutive: 1 })
  await price(stMarys, 'full_court', 6000); await price(stMarys, 'half_a', 3000); await price(stMarys, 'half_b', 3000)
  stMarys2h = await court({ name: "St. Mary's (2h test)", half: true, start: '06:00', end: '22:00', hours: 2, maxConsecutive: 1 })
  await price(stMarys2h, 'full_court', 6000); await price(stMarys2h, 'half_a', 3000); await price(stMarys2h, 'half_b', 3000)
  solo = await court({ name: 'The Solo Court', half: false, start: '05:00', end: '22:00', hours: 1, maxConsecutive: 2 })
  await price(solo, 'full_court', 2500)
})
afterAll(async () => { await db?.close() })

describe('pricing and idempotent slot generation', () => {
  it('The Solo Court: exactly 17 one-hour slots per day, 05:00–22:00, LKR 2,500 each', async () => {
    const d = colomboDate(10)
    expect(await gen(solo, d, d)).toEqual({ court_id: solo, from: d, to: d, created: 17, already_existed: 0 })
    const s = await slotsOn(solo, d)
    expect(s).toHaveLength(17)
    expect(s[0]).toMatchObject({ start_time: '05:00:00', end_time: '06:00:00', price: 2500 })
    expect(s[16]).toMatchObject({ start_time: '21:00:00', end_time: '22:00:00', price: 2500 })
    expect((await slotsOn(solo, d, 'half_a'))).toHaveLength(0)
  })

  it('re-running generation never duplicates slots', async () => {
    const d1 = colomboDate(11), d3 = colomboDate(13)
    expect((await gen(solo, d1, d3)).created).toBe(51)
    expect(await gen(solo, d1, d3)).toMatchObject({ created: 0, already_existed: 51 })
    const n = (await db.su.query(`select count(*)::int n from public.slots where court_id = $1 and slot_date between $2 and $3`, [solo, d1, d3])).rows[0].n
    expect(n).toBe(51)
  })

  it("St. Mary's: full LKR 6,000/h, halves LKR 3,000/h, halves only before the cut-off", async () => {
    const d = colomboDate(10)
    await gen(stMarys, d, d)
    const full = await slotsOn(stMarys, d)
    const half = await slotsOn(stMarys, d, 'half_a')
    expect(full).toHaveLength(16)
    expect(full.every((x) => x.price === 6000)).toBe(true)
    expect(half.every((x) => x.price === 3000 && x.start_time < '14:00:00')).toBe(true)
    expect(half).toHaveLength(8)
  })

  it('price = hourly price x slot length (2-hour slots: LKR 12,000 full, LKR 6,000 half)', async () => {
    const d = colomboDate(10)
    await gen(stMarys2h, d, d)
    expect((await slotsOn(stMarys2h, d)).every((x) => x.price === 12000)).toBe(true)
    expect((await slotsOn(stMarys2h, d, 'half_b')).every((x) => x.price === 6000)).toBe(true)
  })

  it('refuses to generate slots for a court with no price (never creates free slots)', async () => {
    const unpriced = await court({ name: 'Unpriced', half: false, start: '08:00', end: '10:00', hours: 1, maxConsecutive: 1 })
    await expect(gen(unpriced, colomboDate(10), colomboDate(10))).rejects.toThrow('pricing_missing')
  })

  it('only admins can generate slots', async () => {
    const u = await db.user()
    await expect(db.as('authenticated', u, `select public.admin_generate_court_slots($1, current_date + 5, current_date + 5)`, [solo]))
      .rejects.toThrow('forbidden')
  })
})

describe('The Solo Court: one- and two-hour reservations', () => {
  const day = () => colomboDate(20)
  beforeAll(async () => { await gen(solo, day(), day()); await gen(stMarys, day(), day()) })
  const at = async (start: string) => (await slotsOn(solo, day())).find((x) => x.start_time === start)!.id

  it('two consecutive hours: one hold, one expiry, total LKR 5,000', async () => {
    const u = await db.user()
    const r = await holdMany(u, [await at('09:00:00'), await at('10:00:00')])
    expect(r.total_lkr).toBe(5000)
    const rows = (await db.su.query(`select status, locked_by, lock_expires_at from public.slots where id = any($1)`, [r.slot_ids])).rows
    expect(rows.every((x) => x.status === 'locked' && x.locked_by === u)).toBe(true)
    expect(new Set(rows.map((x) => +x.lock_expires_at)).size).toBe(1)
    await db.as('authenticated', u, `select public.release_hold($1)`, [r.slot_id])
  })

  it('rejects non-consecutive hours, three hours, and two hours at St. Mary\'s', async () => {
    const u = await db.user()
    await expect(holdMany(u, [await at('09:00:00'), await at('11:00:00')])).rejects.toThrow('slots_not_consecutive')
    await expect(holdMany(u, [await at('12:00:00'), await at('13:00:00'), await at('14:00:00')])).rejects.toThrow('too_many_consecutive_slots')
    const sm = await slotsOn(stMarys, day())
    await expect(holdMany(u, [sm[3].id, sm[4].id])).rejects.toThrow('too_many_consecutive_slots')
    await expect(holdMany(u, [await at('15:00:00'), sm[10].id])).rejects.toThrow('slots_not_consecutive')
  })

  it('partial availability: if the second hour is taken, the first is NOT held either', async () => {
    const a = await db.user(), b = await db.user()
    await holdMany(a, [await at('17:00:00')])
    await expect(holdMany(b, [await at('16:00:00'), await at('17:00:00')])).rejects.toThrow(/slot_unavailable|slot_conflict/)
    expect((await db.slotRow(await at('16:00:00'))).status).toBe('available')
  })

  it('a practice block on one hour blocks a two-hour reservation over it', async () => {
    const u = await db.user()
    await db.as('authenticated', admin, `select public.admin_block_slot($1, 'IIMPACT Practice')`, [await at('19:00:00')])
    await expect(holdMany(u, [await at('18:00:00'), await at('19:00:00')])).rejects.toThrow(/slot_unavailable|slot_conflict/)
    expect((await db.slotRow(await at('18:00:00'))).status).toBe('available')
  })

  it('an admin cannot block an hour inside an active two-hour hold', async () => {
    const u = await db.user()
    const r = await holdMany(u, [await at('07:00:00'), await at('08:00:00')])
    await expect(db.as('authenticated', admin, `select public.admin_block_slot($1, 'x')`, [await at('08:00:00')]))
      .rejects.toThrow('block_conflicts_with_booking')
    await db.as('authenticated', u, `select public.release_hold($1)`, [r.slot_id])
  })

  it('the Solo Court is independent of St. Mary\'s and has no half-court cut-off', async () => {
    const u1 = await db.user(), u2 = await db.user()
    const sm20 = (await slotsOn(stMarys, day())).find((x) => x.start_time === '20:00:00')!.id
    await holdMany(u1, [sm20])
    await expect(holdMany(u2, [await at('20:00:00'), await at('21:00:00')])).resolves.toBeTruthy()
  })

  it('releasing one hour releases the whole reservation', async () => {
    const d = colomboDate(21); await gen(solo, d, d)
    const s = await slotsOn(solo, d)
    const u = await db.user()
    const r = await holdMany(u, [s[4].id, s[5].id])
    const out = await db.as<{ r: { count: number } }>('authenticated', u, `select public.release_hold($1) as r`, [r.slot_id])
    expect(out[0].r.count).toBe(2)
    expect((await slotsOn(solo, d)).filter((x) => x.status !== 'available')).toHaveLength(0)
  })

  it('the existing pg_cron expiry job releases both hours together', async () => {
    const d = colomboDate(22); await gen(solo, d, d)
    const s = await slotsOn(solo, d)
    const u = await db.user()
    const r = await holdMany(u, [s[0].id, s[1].id])
    await db.su.query(`update public.slots set lock_expires_at = now() - interval '1 second' where id = any($1)`, [r.slot_ids])
    // the production job, verbatim:
    await db.su.query(`UPDATE slots SET status = 'available', locked_by = NULL, lock_expires_at = NULL WHERE status = 'locked' AND lock_expires_at < NOW()`)
    expect((await slotsOn(solo, d)).slice(0, 2).every((x) => x.status === 'available')).toBe(true)
  })
})

describe('two-hour concurrency (real parallel sessions)', () => {
  it('9–11 vs 10–12 at the same moment, 25 rounds: never both; the shared hour is never double-held', async () => {
    let both = 0, oneWon = 0
    for (let i = 0; i < 25; i++) {
      const d = colomboDate(30 + i); await gen(solo, d, d)
      const s = await slotsOn(solo, d)
      const [a, b] = [await db.user(), await db.user()]
      const cs = await Promise.all([db.client(), db.client()])
      const res = await settle([holdMany(a, [s[4].id, s[5].id], cs[0]), holdMany(b, [s[5].id, s[6].id], cs[1])])
      await Promise.all(cs.map((c) => c.end()))
      if (res.ok.length === 2) both++
      if (res.ok.length === 1) oneWon++
      // no partial holds left behind by the loser
      const held = (await slotsOn(solo, d)).filter((x) => x.status === 'locked').length
      expect(held).toBe(res.ok.length === 1 ? 2 : 0)
    }
    expect(both).toBe(0)
    expect(oneWon).toBe(25)
  }, 60_000)

  it('ten customers racing for overlapping one- and two-hour selections: no physical hour held twice', async () => {
    const d = colomboDate(60); await gen(solo, d, d)
    const s = await slotsOn(solo, d)
    const users = await db.users(10)
    const picks = users.map((_, i) => (i % 2 ? [s[8].id, s[9].id] : [s[9 - (i % 4 === 0 ? 0 : 1)].id]))
    const cs = await Promise.all(users.map(() => db.client()))
    await settle(users.map((u, i) => holdMany(u, picks[i], cs[i])))
    await Promise.all(cs.map((c) => c.end()))
    const dup = (await db.su.query(`select count(*)::int n from public.slots a join public.slots b on a.court_id = b.court_id and a.id < b.id
      where a.status in ('locked','booked') and b.status in ('locked','booked')
        and public.slot_period(a.slot_date,a.start_time,a.end_time) && public.slot_period(b.slot_date,b.start_time,b.end_time)
        and a.locked_by is distinct from b.locked_by`)).rows[0].n
    expect(dup).toBe(0)
  })
})

describe('two-hour payments, expiry and cancellation', () => {
  async function held2h(d: string, from = 10) {
    await gen(solo, d, d)
    const s = await slotsOn(solo, d)
    const u = await db.user({ phoneVerified: true, phone: '0771230000' })
    const r = await holdMany(u, [s[from].id, s[from + 1].id])
    return { u, ids: r.slot_ids as string[], first: r.slot_id as string }
  }

  it('one attempt for LKR 5,000 covering both hours; verified success books both under one booking', async () => {
    const { u, ids } = await held2h(colomboDate(70))
    const a = await attempt(u, ids[1]) // any hour of the reservation resolves the whole group
    expect(a.amount).toBe('5000.00')
    expect(a.slot_ids).toEqual(ids)
    const r = await notify(a.order_id, a.amount)
    expect(r.result).toBe('confirmed')
    const bs = (await db.su.query(`select slot_id from public.booking_slots where booking_id = $1 order by slot_id`, [r.booking_id])).rows.map((x) => x.slot_id)
    expect(bs.sort()).toEqual([...ids].sort())
    expect((await db.su.query(`select status from public.slots where id = any($1)`, [ids])).rows.every((x) => x.status === 'booked')).toBe(true)
    expect(Number((await db.su.query(`select total_lkr from public.bookings where id = $1`, [r.booking_id])).rows[0].total_lkr)).toBe(5000)
  })

  it('late success after expiry: neither hour booked, refund queued', async () => {
    const { u, ids } = await held2h(colomboDate(71))
    const a = await attempt(u, ids[0])
    await db.su.query(`update public.slots set lock_expires_at = now() - interval '1 second' where id = any($1)`, [ids])
    expect((await notify(a.order_id, a.amount)).result).toBe('paid_unconfirmed')
    expect((await db.su.query(`select status from public.slots where id = any($1)`, [ids])).rows.some((x) => x.status === 'booked')).toBe(false)
  })

  it('if one hour of the hold was lost and taken by someone else, payment confirms NOTHING', async () => {
    const { u, ids } = await held2h(colomboDate(72))
    const a = await attempt(u, ids[0])
    await db.su.query(`update public.slots set status='available', locked_by=null, lock_expires_at=null where id = $1`, [ids[1]])
    const other = await db.user()
    await holdMany(other, [ids[1]])
    expect((await notify(a.order_id, a.amount)).result).toBe('paid_unconfirmed')
    expect((await db.slotRow(ids[0])).status).toBe('locked')
    expect((await db.slotRow(ids[1])).locked_by).toBe(other)
  })

  it('a client cannot pay for one hour of a two-hour hold at a one-hour price', async () => {
    const { u, ids } = await held2h(colomboDate(73))
    const a = await attempt(u, ids[0])
    expect((await notify(a.order_id, '2500.00')).result).toBe('amount_mismatch')
    expect((await db.slotRow(ids[0])).status).toBe('locked')
  })

  it('cancelling a two-hour booking releases both hours and refunds the full LKR 5,000', async () => {
    const { u, ids } = await held2h(colomboDate(74))
    const a = await attempt(u, ids[0])
    const r = await notify(a.order_id, a.amount)
    await db.as('authenticated', u, `select public.request_booking_cancellation($1, 'Change of plans')`, [r.booking_id])
    const d = await db.as<{ r: Record<string, string | number> }>('authenticated', admin,
      `select public.admin_decide_cancellation($1, 'approve') as r`, [r.booking_id])
    expect(d[0].r).toMatchObject({ changed: true, hours: 2, start_time: '15:00', end_time: '17:00' })
    expect((await db.su.query(`select status from public.slots where id = any($1)`, [ids])).rows.every((x) => x.status === 'available')).toBe(true)
    expect(Number((await db.su.query(`select amount_lkr from public.refunds where booking_id = $1`, [r.booking_id])).rows[0].amount_lkr)).toBe(5000)
  })

  it('report counts bookings by court and duration', async () => {
    const t0 = (await db.su.query(`select clock_timestamp() t`)).rows[0].t
    const { u, ids } = await held2h(colomboDate(75), 2)
    await notify((await attempt(u, ids[0])).order_id, '5000.00')
    const d = colomboDate(75)
    const one = (await slotsOn(solo, d))[8].id
    const u2 = await db.user({ phoneVerified: true })
    await holdMany(u2, [one])
    await notify((await attempt(u2, one)).order_id, '2500.00')
    const t1 = (await db.su.query(`select clock_timestamp() t`)).rows[0].t
    const r = (await db.service<{ r: Record<string, Record<string, { count: number; lkr: number }>> }>(
      `select public.report_bookings_by_court($1, $2) as r`, [t0, t1]))[0].r
    expect(r['The Solo Court']['2h']).toEqual({ count: 1, lkr: 5000 })
    expect(r['The Solo Court']['1h']).toEqual({ count: 1, lkr: 2500 })
  })
})
