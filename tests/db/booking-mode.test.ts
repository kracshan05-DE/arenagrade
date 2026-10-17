// Pre-launch booking mode: only admins may book; admin bookings are test
// bookings; test payments are admin-only; everything test is purged on launch.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { TestDb, colomboDate } from './helpers'

let db: TestDb
beforeEach(async () => {
  db = await TestDb.create()
  await db.su.query(`update public.app_settings set value = 'admin_only' where key = 'booking_mode'`)
})
afterEach(async () => { await db.close() })

const setMode = (uid: string, mode: string) =>
  db.as<{ r: Record<string, string> }>('authenticated', uid, `select public.admin_set_booking_mode($1) as r`, [mode]).then((r) => r[0].r)

describe('admin_only mode', () => {
  it('customers cannot hold slots; admins can', async () => {
    const court = await db.court()
    const s1 = await db.slot(court, colomboDate(3), '09:00', '10:00', 'full_court')
    const s2 = await db.slot(court, colomboDate(3), '10:00', '11:00', 'full_court')
    const customer = await db.user()
    const admin = await db.user({ role: 'super_admin' })
    await expect(db.hold(customer, s1)).rejects.toThrow('booking_admin_only')
    await expect(db.hold(admin, s2)).resolves.toBeTruthy()
    expect((await db.slotRow(s1)).status).toBe('available')
  })

  it('customers cannot start payments even with a server-side call', async () => {
    const customer = await db.user({ phoneVerified: true })
    await expect(db.service(`select public.payment_create_attempt($1, gen_random_uuid(), 'payhere', 'live')`, [customer]))
      .rejects.toThrow('booking_admin_only')
  })

  it('anyone can read the current mode (for the banner); only admins can change it', async () => {
    const customer = await db.user()
    const admin = await db.user({ role: 'super_admin' })
    expect((await db.as<{ value: string }>('anon', null, `select value from public.app_settings where key = 'booking_mode'`))[0].value).toBe('admin_only')
    await expect(setMode(customer, 'public')).rejects.toThrow('forbidden')
    await expect(db.as('authenticated', customer, `update public.app_settings set value = 'public'`)).rejects.toThrow(/permission denied/)
    expect(await setMode(admin, 'public')).toEqual({ booking_mode: 'public', previous: 'admin_only' })
    await expect(setMode(admin, 'everyone')).rejects.toThrow('invalid_mode')
  })

  it('closed mode stops everyone, including admins', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(3), '12:00', '13:00', 'full_court')
    const admin = await db.user({ role: 'super_admin' })
    await setMode(admin, 'closed')
    await expect(db.hold(admin, s)).rejects.toThrow('booking_closed')
  })
})

describe('test payments are admin-only in every mode', () => {
  it('a customer cannot create a sandbox or test payment even when booking is public', async () => {
    const admin = await db.user({ role: 'super_admin' })
    await setMode(admin, 'public')
    const court = await db.court()
    const s = await db.slot(court, colomboDate(4), '09:00', '10:00', 'full_court')
    const customer = await db.user({ phoneVerified: true })
    await db.hold(customer, s)
    await expect(db.service(`select public.payment_create_attempt($1, $2, 'payhere', 'sandbox')`, [customer, s]))
      .rejects.toThrow('test_payments_admin_only')
    await expect(db.service(`select public.payment_create_attempt($1, $2, 'payhere', 'live')`, [customer, s])).resolves.toBeTruthy()
  })

  it('an admin can run a PayHere sandbox payment end to end (recorded as non-live)', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(4), '10:00', '11:00', 'full_court', { price: 12000 })
    const admin = await db.user({ role: 'super_admin', phoneVerified: true })
    await db.hold(admin, s)
    const a = (await db.service<{ r: Record<string, string> }>(`select public.payment_create_attempt($1, $2, 'payhere', 'sandbox') as r`, [admin, s]))[0].r
    const k = createHash('sha256').update(a.order_id).digest('hex')
    const r = (await db.service<{ r: Record<string, string> }>(
      `select public.payment_apply_notification('payhere', $1, 'P1', 2, $2, 'LKR', true, $3, '{}') as r`, [a.order_id, a.amount, k]))[0].r
    expect(r.result).toBe('confirmed')
    expect((await db.su.query(`select environment from public.payment_attempts where order_id = $1`, [a.order_id])).rows[0].environment).toBe('sandbox')
  })
})

describe('admin test bookings', () => {
  it('confirms the admin\'s own hold (one or two hours) without payment, marked as test', async () => {
    const court = (await db.su.query(`insert into public.courts (name, has_half_court, slot_duration_hrs, max_consecutive_slots)
      values ('The Solo Court', false, 1, 2) returning id`)).rows[0].id
    const a = await db.slot(court, colomboDate(5), '18:00', '19:00', 'full_court', { price: 2500 })
    const b = await db.slot(court, colomboDate(5), '19:00', '20:00', 'full_court', { price: 2500 })
    const admin = await db.user({ role: 'super_admin' })
    await db.as('authenticated', admin, `select public.hold_slots($1::uuid[])`, [[a, b]])
    const r = (await db.as<{ r: Record<string, string> }>('authenticated', admin, `select public.admin_confirm_test_booking($1) as r`, [a]))[0].r
    expect((await db.slotRow(a)).status).toBe('booked')
    expect((await db.slotRow(b)).status).toBe('booked')
    const att = (await db.su.query(`select provider, environment, status, amount_lkr::int as amt from public.payment_attempts where order_id = $1`, [r.order_id])).rows[0]
    expect(att).toEqual({ provider: 'manual', environment: 'test', status: 'succeeded', amt: 5000 })
  })

  it('customers cannot use it, and it needs an active hold', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(5), '09:00', '10:00', 'full_court')
    const customer = await db.user()
    const admin = await db.user({ role: 'super_admin' })
    await expect(db.as('authenticated', customer, `select public.admin_confirm_test_booking($1)`, [s])).rejects.toThrow('forbidden')
    await expect(db.as('authenticated', admin, `select public.admin_confirm_test_booking($1)`, [s])).rejects.toThrow('hold_invalid_or_expiring')
  })

  it('test bookings never count as revenue in the daily report', async () => {
    const t0 = (await db.su.query(`select clock_timestamp() t`)).rows[0].t
    const court = await db.court()
    const s = await db.slot(court, colomboDate(6), '09:00', '10:00', 'full_court', { price: 12000 })
    const admin = await db.user({ role: 'super_admin' })
    await db.hold(admin, s)
    await db.as('authenticated', admin, `select public.admin_confirm_test_booking($1)`, [s])
    const t1 = (await db.su.query(`select clock_timestamp() t`)).rows[0].t
    const rep = (await db.service<{ r: Record<string, Record<string, unknown>> }>(`select public.report_daily($1, $2) as r`, [t0, t1]))[0].r
    expect(Number(rep.payments.live_succeeded_lkr)).toBe(0)
    expect(Number(rep.payments.non_live_succeeded_count)).toBe(1)
  })
})

describe('04_purge_test_bookings.sql (launch day)', () => {
  it('deletes every test/sandbox booking, frees its hours, keeps live bookings', async () => {
    const purge = readFileSync(join(__dirname, '..', '..', 'supabase', 'data', '04_purge_test_bookings.sql'), 'utf8')
    const admin = await db.user({ role: 'super_admin', phoneVerified: true })
    const court = await db.court()
    const d = colomboDate(7)
    const t1 = await db.slot(court, d, '06:00', '07:00', 'full_court')
    const t2 = await db.slot(court, d, '07:00', '08:00', 'full_court')
    const live = await db.slot(court, d, '09:00', '10:00', 'full_court')
    for (const s of [t1, t2]) {
      await db.hold(admin, s)
      await db.as('authenticated', admin, `select public.admin_confirm_test_booking($1)`, [s])
    }
    await setMode(admin, 'public')
    const customer = await db.user({ phoneVerified: true })
    await db.hold(customer, live)
    const a = (await db.service<{ r: Record<string, string> }>(`select public.payment_create_attempt($1, $2, 'payhere', 'live') as r`, [customer, live]))[0].r
    await db.service(`select public.payment_apply_notification('payhere', $1, 'L1', 2, $2, 'LKR', true, 'live-k', '{}')`, [a.order_id, a.amount])

    await db.su.query(purge)

    expect((await db.slotRow(t1)).status).toBe('available')
    expect((await db.slotRow(t2)).status).toBe('available')
    expect((await db.slotRow(live)).status).toBe('booked')
    const left = (await db.su.query(`select count(*)::int n from public.bookings`)).rows[0].n
    expect(left).toBe(1)
    expect((await db.su.query(`select count(*)::int n from public.purge_test_bookings_backup`)).rows[0].n).toBe(2)
  })
})
