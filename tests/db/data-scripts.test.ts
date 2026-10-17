// The owner-run data scripts, executed against local databases: the cleanup
// must remove exactly the listed test bookings, keep everything else, and
// refuse to run when its safety checks fail.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TestDb, colomboDate } from './helpers'

const cleanupSql = readFileSync(join(__dirname, '..', '..', 'supabase', 'data', '02_cleanup_test_bookings.sql'), 'utf8')
// The script ships with the 7 real IDs; tests swap in their own test IDs.
const withIds = (ids: string[]) => cleanupSql.replace(
  /insert into cleanup_target \(booking_id\) values[\s\S]*?\);[^\n]*\n/, `insert into cleanup_target (booking_id) values ${ids.map((i) => `('${i}')`).join(', ')};\n`)

let db: TestDb
beforeEach(async () => { db = await TestDb.create() })
afterEach(async () => { await db.close() })

async function oldStyleBooking(court: string, h: number, uid: string) {
  const slot = await db.slot(court, colomboDate(5), `${String(h).padStart(2, '0')}:00`, `${String(h + 1).padStart(2, '0')}:00`, 'full_court', { price: 6000, status: 'booked' })
  const id = (await db.su.query(`insert into public.bookings (user_id, slot_id, court_id, status, total_lkr, payhere_payment_id, idempotency_key)
    values ($1, $2, $3, 'confirmed', 6000, $4, $4) returning id`, [uid, slot, court, `AG-${h}-test`])).rows[0].id as string
  await db.su.query(`insert into public.booking_slots (booking_id, slot_id) values ($1, $2)`, [id, slot])
  return { id, slot }
}

describe('02_cleanup_test_bookings.sql', () => {
  it('removes exactly the 7 listed bookings, resets their slots, keeps blocks and other bookings, backs up', async () => {
    const court = await db.court()
    const owner = await db.user({ role: 'super_admin' })
    const tests = []
    for (let h = 6; h < 13; h++) tests.push(await oldStyleBooking(court, h, owner))
    const keep = await oldStyleBooking(court, 15, await db.user())           // not on the list
    const block = await db.slot(court, colomboDate(5), '17:00', '18:00', 'full_court', { status: 'blocked' })

    await db.su.query(withIds(tests.map((t) => t.id)))

    expect((await db.su.query(`select count(*)::int n from public.bookings`)).rows[0].n).toBe(1)
    expect((await db.su.query(`select id from public.bookings`)).rows[0].id).toBe(keep.id)
    for (const t of tests) expect((await db.slotRow(t.slot)).status).toBe('available')
    expect((await db.slotRow(keep.slot)).status).toBe('booked')
    expect((await db.slotRow(block)).status).toBe('blocked')
    expect((await db.su.query(`select count(*)::int n from public.cleanup_20261018_bookings`)).rows[0].n).toBe(7)
    expect((await db.su.query(`select count(*)::int n from public.booking_slots`)).rows[0].n).toBe(1)
  })

  it('refuses (changes nothing) if the list does not match exactly 7 bookings', async () => {
    const court = await db.court()
    const owner = await db.user()
    const tests = []
    for (let h = 6; h < 12; h++) tests.push(await oldStyleBooking(court, h, owner)) // only 6
    await expect(db.su.query(withIds(tests.map((t) => t.id)))).rejects.toThrow(/Expected 7/)
    await db.su.query('rollback').catch(() => {})
    expect((await db.su.query(`select count(*)::int n from public.bookings`)).rows[0].n).toBe(6)
  })

  it('refuses if any listed booking has a recorded payment attempt (i.e. a real payment)', async () => {
    const court = await db.court()
    const owner = await db.user({ phoneVerified: true })
    const tests = []
    for (let h = 6; h < 13; h++) tests.push(await oldStyleBooking(court, h, owner))
    await db.su.query(`insert into public.payment_attempts (order_id, user_id, slot_id, slot_ids, court_id, amount_lkr, provider, environment, hold_expires_at, status, booking_id)
      values ('AGREAL', $1, $2, array[$2]::uuid[], $3, 6000, 'payhere', 'live', now(), 'succeeded', $4)`, [owner, tests[0].slot, court, tests[0].id])
    await expect(db.su.query(withIds(tests.map((t) => t.id)))).rejects.toThrow(/payment attempt/)
    await db.su.query('rollback').catch(() => {})
    expect((await db.su.query(`select count(*)::int n from public.bookings`)).rows[0].n).toBe(7)
  })
})

describe('02_cleanup_test_bookings.sql on the CURRENT production schema (before migrations)', () => {
  it('works without the new tables', async () => {
    const { connect, sqlFilesInOrder } = await import('./pg-harness')
    const name = `pre_${process.pid}_${Date.now()}`
    const a = connect('postgres'); await a.connect(); await a.query(`create database ${name}`); await a.end()
    const c = connect(name); await c.connect()
    for (const f of sqlFilesInOrder().filter((x) => x.name.includes('fixtures/'))) await c.query(f.sql)
    const pre = new TestDb(name, c)
    const court = await pre.court()
    const owner = await pre.user()
    const ids: string[] = []
    for (let h = 6; h < 13; h++) {
      const slot = await pre.slot(court, colomboDate(5), `${String(h).padStart(2, '0')}:00`, `${String(h + 1).padStart(2, '0')}:00`, 'full_court', { status: 'booked' })
      ids.push((await c.query(`insert into public.bookings (user_id, slot_id, court_id, total_lkr, payhere_payment_id, idempotency_key)
        values ($1, $2, $3, 6000, $4, $4) returning id`, [owner, slot, court, `AG-${h}`])).rows[0].id)
    }
    await c.query(withIds(ids))
    expect((await c.query(`select count(*)::int n from public.bookings`)).rows[0].n).toBe(0)
    expect((await c.query(`select count(*)::int n from public.slots where status = 'booked'`)).rows[0].n).toBe(0)
    await pre.close()
  })
})

describe('01_court_setup.sql (real St. Mary\'s id from the inventory)', () => {
  const setupSql = readFileSync(join(__dirname, '..', '..', 'supabase', 'data', '01_court_setup.sql'), 'utf8')
  const SM = '8c39b8ff-8ae5-4c14-89f7-d74af6b05be7'
  async function productionLikeStMarys() {
    const loc = (await db.su.query(`insert into public.locations (name) values ('ArenaGrade Bambalapitiya') returning id`)).rows[0].id
    const sport = (await db.su.query(`insert into public.sport_types (name) values ('Basketball') returning id`)).rows[0].id
    await db.su.query(`insert into public.courts (id, location_id, sport_type_id, name, has_half_court, half_court_cutoff, operating_start, operating_end, slot_duration_hrs)
      values ($1, $2, $3, 'St Mary''s Basketball Court Bambalapitiya', true, '14:00', '07:00', '23:00', 2)`, [SM, loc, sport])
    await db.su.query(`insert into public.court_pricing (court_id, tier_name, time_from, time_to, price_lkr, applies_to) values
      ($1, 'Full Court Off-Peak', '06:00', '14:00', 4000, 'full_court'), ($1, 'Full Court Peak', '14:00', '22:00', 5000, 'full_court'),
      ($1, 'Half Court Off-Peak', '07:00', '14:00', 3000, 'half_a'), ($1, 'Half Court Off-Peak', '07:00', '14:00', 3000, 'half_b')`, [SM])
    return { loc, sport }
  }

  it('St. Mary\'s: 2-hour slots repriced to LKR 12,000 / 6,000; Solo Court created once with 17 slots/day at LKR 2,500', async () => {
    const { loc } = await productionLikeStMarys()
    const d = colomboDate(3)
    const fullFree = await db.slot(SM, d, '15:00', '17:00', 'full_court', { price: 5000 })
    const halfFree = await db.slot(SM, d, '09:00', '11:00', 'half_a', { price: 3000 })
    const booked = await db.slot(SM, d, '17:00', '19:00', 'full_court', { price: 5000, status: 'booked' })

    await db.su.query(setupSql)
    await db.su.query(setupSql) // re-run: no duplicate court, no duplicate slots

    expect(Number((await db.slotRow(fullFree)).price_lkr)).toBe(12000)
    expect(Number((await db.slotRow(halfFree)).price_lkr)).toBe(6000)
    expect(Number((await db.slotRow(booked)).price_lkr)).toBe(5000)
    const sm = (await db.su.query(`select slot_duration_hrs, operating_start::text, operating_end::text, half_court_cutoff::text, max_consecutive_slots from public.courts where id = $1`, [SM])).rows[0]
    expect(sm).toEqual({ slot_duration_hrs: 2, operating_start: '07:00:00', operating_end: '23:00:00', half_court_cutoff: '14:00:00', max_consecutive_slots: 1 })
    const solos = (await db.su.query(`select * from public.courts where name = 'The Solo Court'`)).rows
    expect(solos).toHaveLength(1)
    expect(solos[0]).toMatchObject({ location_id: loc, has_half_court: false, slot_duration_hrs: 1, max_consecutive_slots: 2, is_active: true })
    const day = (await db.su.query(`select count(*)::int n, min(price_lkr)::int lo, max(price_lkr)::int hi, min(start_time)::text first, max(end_time)::text last
      from public.slots where court_id = $1 and slot_date = $2`, [solos[0].id, colomboDate(1)])).rows[0]
    expect(day).toEqual({ n: 17, lo: 2500, hi: 2500, first: '05:00:00', last: '22:00:00' })
  })

  it('refuses if the St. Mary\'s id is not found (nothing changed)', async () => {
    await expect(db.su.query(setupSql)).rejects.toThrow(/not found/)
    await db.su.query('rollback').catch(() => {})
    expect((await db.su.query(`select count(*)::int n from public.courts`)).rows[0].n).toBe(0)
  })
})

describe('02_cleanup_test_bookings.sql exactly as shipped (real IDs)', () => {
  it('removes the 7 real test bookings and keeps the CompanyA block', async () => {
    const court = await db.court()
    const owner = await db.user({ role: 'super_admin' })
    const rows: [string, string, string, string, string][] = [
      ['1d3c3985-b1a6-448c-b581-8ec0aa9971e1', '2026-07-27', '07:00', '09:00', 'half_a'],
      ['c57b1adc-7c3c-45c3-a6a6-7fbbb2a602d2', '2026-07-27', '15:00', '17:00', 'full_court'],
      ['117fb805-ebbc-4d19-9129-1cc0afb1fe67', '2026-07-29', '11:00', '13:00', 'full_court'],
      ['6b73b7b2-628b-4030-8fea-7415a8a10671', '2026-07-29', '07:00', '09:00', 'full_court'],
      ['443cdda8-ee0f-4da2-a523-e8c8941799c2', '2026-08-13', '09:00', '11:00', 'half_a'],
      ['5aa658d5-7355-4e4e-815c-d0c21dd10ea4', '2026-09-08', '07:00', '09:00', 'half_a'],
      ['828bb68a-b4cf-4797-a0b5-f97dbdef1577', '2026-09-08', '11:00', '13:00', 'full_court'],
    ]
    const block = await db.slot(court, '2026-08-13', '09:00', '11:00', 'full_court', { status: 'blocked' })
    for (const [id, d, st, en, t] of rows) {
      const slot = await db.slot(court, d, st, en, t, { status: 'booked' })
      await db.su.query(`insert into public.bookings (id, user_id, slot_id, court_id, total_lkr, payhere_payment_id, idempotency_key)
        values ($1, $2, $3, $4, 3000, $5, $5)`, [id, owner, slot, court, `AG-${id.slice(0, 8)}`])
    }
    await db.su.query(cleanupSql)
    expect((await db.su.query(`select count(*)::int n from public.bookings`)).rows[0].n).toBe(0)
    expect((await db.su.query(`select count(*)::int n from public.slots where status = 'booked'`)).rows[0].n).toBe(0)
    expect((await db.slotRow(block)).status).toBe('blocked')
  })
})
