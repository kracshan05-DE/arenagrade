// Row Level Security and function privileges, exercised as the real API roles.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TestDb, colomboDate } from './helpers'

let db: TestDb
let court: string
let owner: string, other: string, admin: string
let slot: string
let bookingId: string

beforeAll(async () => {
  db = await TestDb.create()
  court = await db.court()
  owner = await db.user({ phoneVerified: true })
  other = await db.user()
  admin = await db.user({ role: 'super_admin' })
  slot = await db.slot(court, colomboDate(5), '09:00', '10:00', 'full_court')
  await db.hold(owner, slot)
  const a = (await db.service<{ r: Record<string, string> }>(
    `select public.payment_create_attempt($1, $2, 'payhere', 'sandbox') as r`, [owner, slot]))[0].r
  const n = (await db.service<{ r: Record<string, string> }>(
    `select public.payment_apply_notification('payhere', $1, 'PH1', 2, $2, 'LKR', true, 'k1', '{}') as r`, [a.order_id, a.amount]))[0].r
  bookingId = n.booking_id
})
afterAll(async () => { await db?.close() })

describe('customers cannot write booking state directly', () => {
  it('cannot insert a confirmed booking', async () => {
    await expect(db.as('authenticated', other,
      `insert into public.bookings (user_id, slot_id, court_id, status, total_lkr) values ($1, $2, $3, 'confirmed', 1)`,
      [other, slot, court])).rejects.toThrow(/permission denied/)
  })

  it('cannot change any booking status, including their own', async () => {
    await expect(db.as('authenticated', owner, `update public.bookings set status = 'cancelled' where id = $1`, [bookingId]))
      .rejects.toThrow(/permission denied/)
  })

  it('cannot lock, book or release slots by updating the table', async () => {
    const s = await db.slot(court, colomboDate(6), '09:00', '10:00', 'full_court')
    const rows = await db.as('authenticated', other,
      `update public.slots set status = 'booked' where id = $1 returning id`, [s])
    expect(rows).toHaveLength(0)
    await expect(db.as('anon', null, `update public.slots set status = 'booked' where id = $1`, [s])).rejects.toThrow(/permission denied/)
    expect((await db.slotRow(s)).status).toBe('available')
  })

  it('cannot insert payment attempts, events or refunds', async () => {
    await expect(db.as('authenticated', other, `insert into public.payment_events (provider, signature_valid, event_key) values ('payhere', true, 'x')`))
      .rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', other, `insert into public.refunds (booking_id, amount_lkr) values ($1, 1)`, [bookingId]))
      .rejects.toThrow(/permission denied/)
  })
})

describe('customers only see their own private data', () => {
  it('bookings: own visible, others hidden, admin sees all', async () => {
    expect(await db.as('authenticated', owner, `select id from public.bookings where id = $1`, [bookingId])).toHaveLength(1)
    expect(await db.as('authenticated', other, `select id from public.bookings where id = $1`, [bookingId])).toHaveLength(0)
    expect(await db.as('anon', null, `select id from public.bookings`).catch(() => [])).toHaveLength(0)
    expect(await db.as('authenticated', admin, `select id from public.bookings where id = $1`, [bookingId])).toHaveLength(1)
  })

  it('payment attempts and profiles are private', async () => {
    expect(await db.as('authenticated', other, `select id from public.payment_attempts`)).toHaveLength(0)
    expect(await db.as('authenticated', owner, `select id from public.payment_attempts`)).toHaveLength(1)
    expect(await db.as('authenticated', other, `select id from public.profiles where id = $1`, [owner])).toHaveLength(0)
    expect(await db.as('anon', null, `select id from public.profiles`).catch(() => [])).toHaveLength(0)
  })

  it('operational tables are admin-only', async () => {
    for (const t of ['payment_events', 'audit_log', 'app_events', 'notification_log', 'job_runs', 'payment_audit']) {
      expect(await db.as('authenticated', owner, `select * from public.${t}`)).toHaveLength(0)
    }
    expect((await db.as('authenticated', admin, `select * from public.audit_log`)).length).toBeGreaterThan(0)
  })

  it('public catalogue data stays readable for availability', async () => {
    expect((await db.as('anon', null, `select id from public.slots where court_id = $1`, [court])).length).toBeGreaterThan(0)
    expect((await db.as('anon', null, `select id from public.courts where id = $1`, [court]))).toHaveLength(1)
  })
})

describe('admin-only management', () => {
  it('ordinary users cannot modify courts, pricing, products, portfolio or recurring bookings', async () => {
    expect(await db.as('authenticated', other, `update public.courts set name = 'hacked' where id = $1 returning id`, [court])).toHaveLength(0)
    await expect(db.as('authenticated', other, `insert into public.products (name) values ('x')`)).rejects.toThrow(/row-level security/)
    await expect(db.as('authenticated', other, `insert into public.court_portfolio (title) values ('x')`)).rejects.toThrow(/row-level security/)
    await expect(db.as('authenticated', other, `insert into public.court_pricing (court_id, price_lkr) values ($1, 1)`, [court])).rejects.toThrow(/row-level security/)
    await expect(db.as('authenticated', other, `insert into public.slots (court_id, slot_date, start_time, end_time, court_type) values ($1, $2, '09:00', '10:00', 'full_court')`, [court, colomboDate(9)]))
      .rejects.toThrow(/row-level security/)
    expect(await db.as('authenticated', other, `select id from public.recurring_bookings`)).toHaveLength(0)
  })

  it('admins can manage catalogue data', async () => {
    expect(await db.as('authenticated', admin, `update public.courts set name = 'Main Court' where id = $1 returning id`, [court])).toHaveLength(1)
    await expect(db.as('authenticated', admin, `insert into public.products (name) values ('Ball')`)).resolves.toBeTruthy()
  })

  it('admins cannot delete booked slots', async () => {
    const rows = await db.as('authenticated', admin, `delete from public.slots where id = $1 returning id`, [slot])
    expect(rows).toHaveLength(0)
  })

  it('storage: only admins may upload images', async () => {
    await expect(db.as('authenticated', other, `insert into storage.objects (bucket_id, name) values ('images', 'x.png')`)).rejects.toThrow(/row-level security/)
    await expect(db.as('authenticated', admin, `insert into storage.objects (bucket_id, name) values ('images', 'y.png')`)).resolves.toBeTruthy()
  })
})

describe('function privileges', () => {
  it('anon can execute no ArenaGrade database function', async () => {
    const r = await db.su.query(`
      select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and has_function_privilege('anon', p.oid, 'execute')
        and p.proname not in ('slot_period', 'slot_parts', 'colombo_now')`)
    expect(r.rows.map((x) => x.proname)).toEqual([])
  })

  it('authenticated can execute only the intended customer/admin entry points', async () => {
    const r = await db.su.query(`
      select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosecdef
        and has_function_privilege('authenticated', p.oid, 'execute')
      order by 1`)
    expect(r.rows.map((x) => x.proname)).toEqual([
      'admin_block_slot', 'admin_decide_cancellation', 'admin_generate_recurring_slots', 'admin_unblock_slot',
      'admin_update_refund', 'hold_slot', 'is_super_admin', 'release_hold', 'request_booking_cancellation',
    ])
  })

  it('every SECURITY DEFINER function pins search_path', async () => {
    const r = await db.su.query(`
      select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)
    expect(r.rows).toEqual([])
  })
})
