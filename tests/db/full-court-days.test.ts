// Migration 1000: full-court-only days (weekends + admin-marked holidays) and
// the audit fixes C3 (re-run guards), C5 (no direct slot writes), C10 (test
// bookings only in testing mode).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TestDb, colomboDate } from './helpers'

const MIG = join(__dirname, '..', '..', 'supabase', 'migrations')
const migration = (f: string) => readFileSync(join(MIG, f), 'utf8')

let db: TestDb
beforeEach(async () => { db = await TestDb.create() })
afterEach(async () => { await db.close() })

/** The next date (from tomorrow, Colombo) whose ISO weekday is in `days` (1=Mon … 7=Sun). */
function nextDate(days: number[]) {
  for (let i = 1; i <= 14; i++) {
    const d = colomboDate(i)
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay() || 7
    if (days.includes(dow)) return d
  }
  throw new Error('no date found')
}
const SAT = () => nextDate([6])
const WEEKDAY = () => nextDate([3]) // a Wednesday

/** A St. Mary's-like court: 2-hour slots 07:00–23:00, halves before 14:00, weekend rule on. */
async function stMarys(weekendRule = true) {
  const id = (await db.su.query(
    `insert into public.courts (name, has_half_court, half_court_cutoff, operating_start, operating_end, slot_duration_hrs, max_consecutive_slots, is_active, weekend_full_court_only)
     values ('St Mary''s', true, '14:00', '07:00', '23:00', 2, 1, true, $1) returning id`, [weekendRule])).rows[0].id as string
  await db.su.query(`insert into public.court_pricing (court_id, tier_name, time_from, time_to, price_lkr, applies_to) values
    ($1, 'Standard', '00:00', '00:00', 6000, 'full_court'), ($1, 'Standard', '00:00', '00:00', 3000, 'half_a'),
    ($1, 'Standard', '00:00', '00:00', 3000, 'half_b')`, [id])
  return id
}
const generate = (court: string, from: string, to: string) =>
  db.su.query(`select public._generate_court_slots($1, $2, $3)`, [court, from, to])
const countByType = async (court: string, day: string) => Object.fromEntries((await db.su.query(
  `select court_type::text t, count(*)::int n from public.slots where court_id = $1 and slot_date = $2 group by 1`, [court, day])).rows.map((r) => [r.t, r.n]))
const mark = (admin: string, court: string, day: string, on: boolean, reason: string | null = null) =>
  db.as<{ r: Record<string, unknown> }>('authenticated', admin, `select public.admin_set_full_court_only_day($1, $2, $3, $4) as r`, [court, day, on, reason]).then((x) => x[0].r)

describe('weekends at St. Mary\'s: full court only, all day', () => {
  it('the generator creates only full-court slots on Saturday and Sunday, halves on weekdays', async () => {
    const court = await stMarys()
    const sat = SAT(), wed = WEEKDAY()
    await generate(court, sat, sat)
    await generate(court, wed, wed)
    expect(await countByType(court, sat)).toEqual({ full_court: 8 })            // 07–23, 2-hour slots
    expect(await countByType(court, wed)).toEqual({ full_court: 8, half_a: 4, half_b: 4 }) // halves 07,09,11,13
    const prices = (await db.su.query(`select distinct price_lkr::int p from public.slots where court_id = $1 and slot_date = $2`, [court, sat])).rows
    expect(prices).toEqual([{ p: 12000 }])
  })

  it('a half court can never be held or booked on a weekend, even if a row exists', async () => {
    const court = await stMarys()
    const sat = SAT()
    // A blocked half row is allowed (an admin decision) ...
    const half = await db.slot(court, sat, '09:00', '11:00', 'half_a', { status: 'blocked' })
    const admin = await db.user({ role: 'super_admin' })
    await db.as('authenticated', admin, `select public.admin_unblock_slot($1)`, [half])
    // ... but it can never be reserved.
    const customer = await db.user()
    await expect(db.hold(customer, half)).rejects.toThrow('half_court_not_offered_today')
    expect((await db.slotRow(half)).status).toBe('available')
    // Creating an available half row on a weekend is refused outright.
    await expect(db.slot(court, sat, '11:00', '13:00', 'half_b')).rejects.toThrow('half_court_not_offered_today')
  })

  it('the full court is still bookable on weekends', async () => {
    const court = await stMarys()
    const sat = SAT()
    await generate(court, sat, sat)
    const full = (await db.su.query(`select id from public.slots where court_id = $1 and slot_date = $2 and start_time = '09:00'`, [court, sat])).rows[0].id
    await expect(db.hold(await db.user(), full)).resolves.toBeTruthy()
  })

  it('courts without the weekend rule (and The Solo Court) are unaffected', async () => {
    const court = await stMarys(false)
    const sat = SAT()
    await generate(court, sat, sat)
    expect(await countByType(court, sat)).toEqual({ full_court: 8, half_a: 4, half_b: 4 })
  })
})

describe('holidays: admin marks a date "full court only"', () => {
  it('marking removes the unused half slots; unmarking recreates them', async () => {
    const court = await stMarys()
    const wed = WEEKDAY()
    await generate(court, wed, wed)
    const admin = await db.user({ role: 'super_admin' })
    const on = await mark(admin, court, wed, true, 'Poya')
    expect(on).toMatchObject({ full_court_only: true, half_slots_deleted: 8 })
    expect(await countByType(court, wed)).toEqual({ full_court: 8 })
    expect((await db.as('anon', null, `select reason from public.full_court_only_dates where court_id = $1`, [court]))[0]).toEqual({ reason: 'Poya' })
    // Generating again does not bring halves back while the date is marked.
    await generate(court, wed, wed)
    expect(await countByType(court, wed)).toEqual({ full_court: 8 })

    const off = await mark(admin, court, wed, false)
    expect(off).toMatchObject({ full_court_only: false, half_slots_created: 8 })
    expect(await countByType(court, wed)).toEqual({ full_court: 8, half_a: 4, half_b: 4 })
  })

  it('unmarking a weekend keeps it full court only (the weekend rule still applies)', async () => {
    const court = await stMarys()
    const admin = await db.user({ role: 'super_admin' })
    const sat = SAT()
    await mark(admin, court, sat, true)
    const off = await mark(admin, court, sat, false)
    expect(off).toMatchObject({ full_court_only: true, weekend_rule: true, half_slots_created: 0 })
  })

  it('refuses to mark a date while a half court is held or booked; keeps held and blocked rows', async () => {
    const court = await stMarys()
    const wed = WEEKDAY()
    await generate(court, wed, wed)
    const halfA = (await db.su.query(`select id from public.slots where court_id = $1 and slot_date = $2 and court_type = 'half_a' and start_time = '09:00'`, [court, wed])).rows[0].id
    await db.hold(await db.user(), halfA)
    const admin = await db.user({ role: 'super_admin' })
    await expect(mark(admin, court, wed, true)).rejects.toThrow('half_court_bookings_exist')
    expect(await db.su.query(`select 1 from public.full_court_only_dates`).then((r) => r.rowCount)).toBe(0)
    expect(await countByType(court, wed)).toEqual({ full_court: 8, half_a: 4, half_b: 4 })
  })

  it('only admins, only today or later, only courts with halves', async () => {
    const court = await stMarys()
    const solo = (await db.su.query(`insert into public.courts (name, has_half_court, slot_duration_hrs) values ('The Solo Court', false, 1) returning id`)).rows[0].id
    const admin = await db.user({ role: 'super_admin' })
    await expect(mark(await db.user(), court, WEEKDAY(), true)).rejects.toThrow('forbidden')
    await expect(mark(admin, court, colomboDate(-1), true)).rejects.toThrow('invalid_date')
    await expect(mark(admin, solo, WEEKDAY(), true)).rejects.toThrow('half_court_not_offered')
    await expect(db.as('authenticated', admin, `insert into public.full_court_only_dates (court_id, day) values ($1, $2)`, [court, WEEKDAY()]))
      .rejects.toThrow(/permission denied/)
  })
})

describe('migration 1000 clean-up and re-run safety', () => {
  it('deletes only unused, available half slots on future weekends; is safe to re-run', async () => {
    const court = await stMarys()
    const sat = SAT()
    await db.su.query(`set session_replication_role = replica`) // bypass the trigger to recreate pre-1000 data
    const unused = await db.slot(court, sat, '07:00', '09:00', 'half_a')
    const booked = await db.slot(court, sat, '09:00', '11:00', 'half_b', { status: 'booked' })
    const blocked = await db.slot(court, sat, '11:00', '13:00', 'half_a', { status: 'blocked' })
    await db.su.query(`set session_replication_role = origin`)

    await db.su.query(migration('20261022001000_full_court_days.sql'))
    const left = (await db.su.query(`select id from public.slots where court_id = $1`, [court])).rows.map((r) => r.id)
    expect(left).not.toContain(unused)
    expect(left).toEqual(expect.arrayContaining([booked, blocked]))
    // Running it a third time changes nothing and does not fail.
    await db.su.query(migration('20261022001000_full_court_days.sql'))
  })

  it('a re-run does not switch the weekend rule back on after an admin turned it off', async () => {
    const court = await stMarys(false)
    await db.su.query(migration('20261022001000_full_court_days.sql'))
    expect((await db.su.query(`select weekend_full_court_only w from public.courts where id = $1`, [court])).rows[0].w).toBe(false)
  })

  it('C3: re-running 0800 or 0900 now stops with a clear message and changes nothing', async () => {
    await expect(db.su.query(migration('20261018000800_multi_slot_courts.sql'))).rejects.toThrow(/must not be re-run after 0900/)
    await expect(db.su.query(migration('20261018000900_booking_mode.sql'))).rejects.toThrow(/must not be re-run after 1000/)
    const fn = (await db.su.query(`select pg_get_functiondef('public.hold_slots(uuid[])'::regprocedure) d`)).rows[0].d
    expect(fn).toContain('_assert_booking_allowed')
  })
})

describe('C5: no direct slot writes from the browser, not even by admins', () => {
  it('admins cannot insert or update slots directly; checked functions still work', async () => {
    const court = await db.court()
    const d = colomboDate(4)
    const half = await db.slot(court, d, '09:00', '11:00', 'half_a', { status: 'booked' })
    const full = await db.slot(court, d, '09:00', '11:00', 'full_court')
    const admin = await db.user({ role: 'super_admin' })
    // Previously allowed (audit probe 18 Oct): a clashing block, and freeing a booked slot.
    await expect(db.as('authenticated', admin, `update public.slots set status = 'blocked' where id = $1`, [full])).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', admin, `update public.slots set status = 'available' where id = $1`, [half])).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', admin, `insert into public.slots (court_id, slot_date, start_time, end_time, court_type, status) values ($1, $2, '13:00', '15:00', 'full_court', 'booked')`, [court, d]))
      .rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', admin, `select public.admin_block_slot($1, 'x')`, [full])).rejects.toThrow('block_conflicts_with_booking')
    // Deleting an unused slot (the admin "Clear" button) still works.
    const spare = await db.slot(court, d, '15:00', '17:00', 'full_court')
    expect(await db.as('authenticated', admin, `delete from public.slots where id = $1 returning id`, [spare])).toHaveLength(1)
  })
})

describe('C10: admin test bookings only while booking is in testing mode', () => {
  it('refused when booking is open to everyone or paused', async () => {
    const court = await db.court()
    const admin = await db.user({ role: 'super_admin' })
    for (const mode of ['public', 'closed']) {
      const s = await db.slot(court, colomboDate(4), mode === 'public' ? '09:00' : '11:00', mode === 'public' ? '10:00' : '12:00', 'full_court')
      await db.su.query(`update public.app_settings set value = 'public' where key = 'booking_mode'`)
      await db.hold(admin, s)
      await db.su.query(`update public.app_settings set value = $1 where key = 'booking_mode'`, [mode])
      await expect(db.as('authenticated', admin, `select public.admin_confirm_test_booking($1)`, [s])).rejects.toThrow('test_bookings_only_in_testing_mode')
      expect((await db.slotRow(s)).status).toBe('locked')
    }
  })
})
