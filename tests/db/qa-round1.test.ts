// Database behaviour relied on by the QA round-1 UI fixes (26 Oct 2026).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TestDb, colomboDate } from './helpers'

let db: TestDb
beforeEach(async () => { db = await TestDb.create() })
afterEach(async () => { await db.close() })

describe('Admin Courts: prices for a new court', () => {
  it('an admin can add all-day hourly prices and slots can then be generated', async () => {
    const admin = await db.user({ role: 'super_admin' })
    const court = (await db.su.query(`insert into public.courts (name, has_half_court, operating_start, operating_end, slot_duration_hrs)
      values ('QA Court', true, '07:00', '11:00', 2) returning id`)).rows[0].id
    const d = colomboDate(3)
    // No prices yet: generation is refused (this is what QA hit).
    await expect(db.as('authenticated', admin, `select public.admin_generate_court_slots($1, $2, $2)`, [court, d])).rejects.toThrow('pricing_missing')
    // Exactly what the new "Set hourly prices" form inserts.
    await db.as('authenticated', admin, `insert into public.court_pricing (court_id, tier_name, time_from, time_to, price_lkr, applies_to) values
      ($1, 'Standard', '00:00:00', '00:00:00', 6000, 'full_court'), ($1, 'Standard', '00:00:00', '00:00:00', 3000, 'half_a'),
      ($1, 'Standard', '00:00:00', '00:00:00', 3000, 'half_b')`, [court])
    await db.as('authenticated', admin, `select public.admin_generate_court_slots($1, $2, $2)`, [court, d])
    const prices = (await db.su.query(`select court_type::text t, price_lkr::int p from public.slots where court_id = $1 and start_time = '07:00' order by 1`, [court])).rows
    expect(prices).toEqual([{ t: 'full_court', p: 12000 }, { t: 'half_a', p: 6000 }, { t: 'half_b', p: 6000 }])
  })

  it('customers still cannot add prices', async () => {
    const court = await db.court()
    const customer = await db.user()
    await expect(db.as('authenticated', customer, `insert into public.court_pricing (court_id, price_lkr, applies_to) values ($1, 1, 'full_court')`, [court]))
      .rejects.toThrow(/row-level security/)
  })
})

describe('Customer name captured on the payment page', () => {
  it('a customer can set their own name, but still not their phone or role', async () => {
    const u = await db.user()
    await db.as('authenticated', u, `update public.profiles set full_name = 'Nimal Perera' where id = $1`, [u])
    expect((await db.su.query(`select full_name from public.profiles where id = $1`, [u])).rows[0].full_name).toBe('Nimal Perera')
    await expect(db.as('authenticated', u, `update public.profiles set phone = '0771234567', phone_verified = true where id = $1`, [u]))
      .rejects.toThrow('forbidden_profile_fields')
  })

  it('a customer cannot rename another customer', async () => {
    const a = await db.user()
    const b = await db.user()
    await db.as('authenticated', a, `update public.profiles set full_name = 'x' where id = $1`, [b])
    expect((await db.su.query(`select full_name from public.profiles where id = $1`, [b])).rows[0].full_name).not.toBe('x')
  })

  it('a name given at sign-up is copied into the profile', async () => {
    const id = (await db.su.query(`insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'n@example.com', '{"full_name":"Kamal Silva"}') returning id`)).rows[0].id
    expect((await db.su.query(`select full_name from public.profiles where id = $1`, [id])).rows[0].full_name).toBe('Kamal Silva')
  })
})
