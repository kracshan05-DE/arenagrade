// The owner-run data scripts, executed against local databases: the cleanup
// must remove exactly the listed test bookings, keep everything else, and
// refuse to run when its safety checks fail.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TestDb, colomboDate } from './helpers'

const cleanupSql = readFileSync(join(__dirname, '..', '..', 'supabase', 'data', '02_cleanup_test_bookings.sql'), 'utf8')
const withIds = (ids: string[]) => cleanupSql.replace(
  "('00000000-0000-0000-0000-000000000000')", ids.map((i) => `('${i}')`).join(',\n  '))

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

describe('01_court_setup.sql', () => {
  const setupSql = readFileSync(join(__dirname, '..', '..', 'supabase', 'data', '01_court_setup.sql'), 'utf8')
  it('configures both courts, reprices future unused slots, fixes the Solo layout, generates 17 Solo slots/day', async () => {
    // Starting point: St. Mary's with 2-hour slots and old per-slot prices; a
    // misconfigured Solo court with halves and 2-hour slots.
    const sm = (await db.su.query(`insert into public.courts (name, has_half_court, operating_start, operating_end, slot_duration_hrs) values ('St. Mary''s', true, '06:00', '22:00', 2) returning id`)).rows[0].id
    const so = (await db.su.query(`insert into public.courts (name, has_half_court, operating_start, operating_end, slot_duration_hrs, is_active) values ('Solo', true, '06:00', '22:00', 2, false) returning id`)).rows[0].id
    const d = colomboDate(3)
    const smFree = await db.slot(sm, d, '08:00', '10:00', 'full_court', { price: 5000 })
    const smBooked = await db.slot(sm, d, '10:00', '12:00', 'full_court', { price: 5000, status: 'booked' })
    const soOldFree = await db.slot(so, d, '06:00', '08:00', 'half_a', { price: 1000 })
    const soOldBooked = await db.slot(so, d, '08:00', '10:00', 'full_court', { price: 4000, status: 'booked' })

    await db.su.query(setupSql.replace('00000000-0000-0000-0000-000000000001', sm).replace('00000000-0000-0000-0000-000000000002', so))

    const solo = (await db.su.query(`select * from public.courts where id = $1`, [so])).rows[0]
    expect(solo).toMatchObject({ name: 'The Solo Court', has_half_court: false, slot_duration_hrs: 1, max_consecutive_slots: 2, is_active: true })
    expect(Number((await db.slotRow(smFree)).price_lkr)).toBe(12000)          // 2h x 6000
    expect(Number((await db.slotRow(smBooked)).price_lkr)).toBe(5000)         // booked: untouched
    expect(await db.slotRow(soOldFree)).toBeUndefined()                        // unused misfit removed
    expect((await db.slotRow(soOldBooked)).status).toBe('booked')             // booked misfit kept
    const tomorrow = colomboDate(1)
    const solo1h = (await db.su.query(`select count(*)::int n, min(price_lkr)::int lo, max(price_lkr)::int hi from public.slots
      where court_id = $1 and slot_date = $2 and court_type = 'full_court'`, [so, tomorrow])).rows[0]
    expect(solo1h).toEqual({ n: 17, lo: 2500, hi: 2500 })
  })

  it('refuses when the two IDs are the same court', async () => {
    const sm = (await db.su.query(`insert into public.courts (name, has_half_court) values ('St. Mary''s', true) returning id`)).rows[0].id
    await expect(db.su.query(setupSql.replace('00000000-0000-0000-0000-000000000001', sm).replace('00000000-0000-0000-0000-000000000002', sm)))
      .rejects.toThrow(/different court records/)
    await db.su.query('rollback').catch(() => {})
  })
})
