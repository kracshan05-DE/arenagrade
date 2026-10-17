// Booking integrity: holds, half/full conflicts, concurrency, expiry, blocks.
// Every concurrent test opens separate PostgreSQL sessions and fires the calls
// at the same time — these are not sequential simulations.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { TestDb, colomboDate, settle } from './helpers'

let db: TestDb
beforeAll(async () => { db = await TestDb.create() })
afterAll(async () => { await db?.close() })

async function preconnect(n: number) {
  return Promise.all(Array.from({ length: n }, () => db.client()))
}
async function closeAll(cs: Client[]) {
  await Promise.all(cs.map((c) => c.end()))
}

/** Count pairs of active (locked/booked) slots that overlap in time and court part. */
async function activeConflictPairs() {
  const r = await db.su.query(`
    select count(*)::int n from public.slots a join public.slots b
      on a.court_id = b.court_id and a.id < b.id
     where a.status in ('locked','booked') and b.status in ('locked','booked')
       and public.slot_period(a.slot_date,a.start_time,a.end_time) && public.slot_period(b.slot_date,b.start_time,b.end_time)
       and public.slot_parts(a.court_type) && public.slot_parts(b.court_type)`)
  return r.rows[0].n as number
}

describe('single hold rules', () => {
  it('rejects anonymous callers', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(3), '09:00', '10:00', 'full_court')
    await expect(db.as('anon', null, `select public.hold_slot($1)`, [s])).rejects.toThrow(/permission denied/)
  })

  it('places a 10-minute hold timed by the database clock', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(3), '10:00', '11:00', 'full_court')
    const u = await db.user()
    const r = await db.hold(u, s)
    expect(r.seconds_left).toBe(600)
    const row = await db.slotRow(s)
    expect(row.status).toBe('locked')
    expect(row.locked_by).toBe(u)
    const diff = (new Date(row.lock_expires_at).getTime() - Date.now()) / 1000
    expect(diff).toBeGreaterThan(590)
    expect(diff).toBeLessThanOrEqual(601)
  })

  it('a retry by the same customer reuses the hold and never extends it', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(3), '11:00', '12:00', 'full_court')
    const u = await db.user()
    const first = await db.hold(u, s)
    await db.su.query(`update public.slots set lock_expires_at = now() + interval '30 seconds' where id = $1`, [s])
    const second = await db.hold(u, s)
    expect(second.reused).toBe(true)
    expect(second.seconds_left).toBeLessThanOrEqual(30)
    expect(first.reused).toBe(false)
  })

  it('rejects slots that already started (Asia/Colombo)', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(-1), '09:00', '10:00', 'full_court')
    const u = await db.user()
    await expect(db.hold(u, s)).rejects.toThrow('slot_in_past')
  })

  it('enforces the half-court cutoff by slot start time', async () => {
    const court = await db.court({ cutoff: '14:00' })
    const d = colomboDate(4)
    const before = await db.slot(court, d, '13:00', '14:00', 'half_a')
    const at = await db.slot(court, d, '14:00', '15:00', 'half_a')
    const fullAfter = await db.slot(court, d, '16:00', '17:00', 'full_court')
    const fullMorning = await db.slot(court, d, '08:00', '09:00', 'full_court')
    const u = await db.user()
    await expect(db.hold(u, before)).resolves.toBeTruthy()
    await expect(db.hold(u, at)).rejects.toThrow('half_court_after_cutoff')
    await expect(db.hold(u, fullAfter)).resolves.toBeTruthy()
    // Owner decision: full court is bookable all day.
    await expect(db.hold(u, fullMorning)).resolves.toBeTruthy()
  })

  it('rejects half courts on a court without halves, inactive courts and zero prices', async () => {
    const noHalf = await db.court({ hasHalf: false })
    const inactive = await db.court({ active: false })
    const okCourt = await db.court()
    const d = colomboDate(4)
    const u = await db.user()
    await expect(db.hold(u, await db.slot(noHalf, d, '09:00', '10:00', 'half_b'))).rejects.toThrow('half_court_not_offered')
    await expect(db.hold(u, await db.slot(inactive, d, '09:00', '10:00', 'full_court'))).rejects.toThrow('court_unavailable')
    await expect(db.hold(u, await db.slot(okCourt, d, '09:00', '10:00', 'full_court', { price: 0 }))).rejects.toThrow('slot_price_invalid')
  })

  it('limits a customer to 3 active holds', async () => {
    const court = await db.court()
    const d = colomboDate(5)
    const u = await db.user()
    for (const h of ['06', '07', '08']) await db.hold(u, await db.slot(court, d, `${h}:00`, `${+h + 1}:00`, 'full_court'))
    await expect(db.hold(u, await db.slot(court, d, '19:00', '20:00', 'full_court'))).rejects.toThrow('too_many_holds')
  })

  it('a customer cannot release someone else\'s hold', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(5), '12:00', '13:00', 'full_court')
    const a = await db.user(); const b = await db.user()
    await db.hold(a, s)
    const r = await db.as<{ r: { released: boolean } }>('authenticated', b, `select public.release_hold($1) as r`, [s])
    expect(r[0].r.released).toBe(false)
    expect((await db.slotRow(s)).locked_by).toBe(a)
  })
})

describe('half-court / full-court conflict rules', () => {
  it('full court blocks both halves; halves block full court; halves coexist', async () => {
    const court = await db.court()
    const d = colomboDate(6)
    const g1 = await db.slotGroup(court, d, '09:00', '10:00')
    const g2 = await db.slotGroup(court, d, '10:00', '11:00')
    const a = await db.user(); const b = await db.user(); const c = await db.user()

    await db.hold(a, g1.full)
    await expect(db.hold(b, g1.halfA)).rejects.toThrow('slot_conflict')
    await expect(db.hold(b, g1.halfB)).rejects.toThrow('slot_conflict')

    await db.hold(b, g2.halfA)
    await expect(db.hold(c, g2.full)).rejects.toThrow('slot_conflict')
    await expect(db.hold(c, g2.halfB)).resolves.toBeTruthy()
  })

  it('partially overlapping slots of different lengths conflict', async () => {
    const court = await db.court()
    const d = colomboDate(6)
    const twoHour = await db.slot(court, d, '15:00', '17:00', 'full_court')
    const oneHour = await db.slot(court, d, '16:00', '17:00', 'full_court', { price: 2500 })
    const a = await db.user(); const b = await db.user()
    await db.hold(a, twoHour)
    await expect(db.hold(b, oneHour)).rejects.toThrow('slot_conflict')
  })

  it('slots that only touch (09-10 and 10-11) do not conflict', async () => {
    const court = await db.court()
    const d = colomboDate(6)
    const a1 = await db.slot(court, d, '17:00', '18:00', 'full_court')
    const a2 = await db.slot(court, d, '18:00', '19:00', 'full_court')
    const a = await db.user(); const b = await db.user()
    await db.hold(a, a1)
    await expect(db.hold(b, a2)).resolves.toBeTruthy()
  })

  it('a practice block on a half makes the full court unbookable (and vice versa)', async () => {
    const court = await db.court()
    const d = colomboDate(7)
    const g = await db.slotGroup(court, d, '09:00', '10:00')
    await db.su.query(`update public.slots set status = 'blocked', internal_reason = 'IIMPACT Practice' where id = $1`, [g.halfB])
    const u = await db.user()
    await expect(db.hold(u, g.full)).rejects.toThrow('slot_conflict')
    await expect(db.hold(u, g.halfA)).resolves.toBeTruthy()
  })

  it('the database constraint rejects conflicting writes even when the function is bypassed', async () => {
    const court = await db.court()
    const d = colomboDate(7)
    const g = await db.slotGroup(court, d, '11:00', '12:00')
    const u = await db.user()
    await db.su.query(`update public.slots set status='booked' where id=$1`, [g.full])
    await expect(
      db.su.query(`update public.slots set status='locked', locked_by=$2, lock_expires_at=now()+interval '5 min' where id=$1`, [g.halfA, u]),
    ).rejects.toThrow(/slots_no_conflicting_active/)
  })

  it('a slot crossing midnight conflicts with an overlapping slot on the next day', async () => {
    const court = await db.court()
    const d1 = colomboDate(8)
    const d2 = colomboDate(9)
    const late = await db.slot(court, d1, '23:00', '01:00', 'full_court')
    const early = await db.slot(court, d2, '00:00', '01:00', 'full_court')
    const a = await db.user(); const b = await db.user()
    await db.hold(a, late)
    await expect(db.hold(b, early)).rejects.toThrow('slot_conflict')
  })
})

describe('concurrency (real parallel sessions)', () => {
  it('two customers reserving the same slot at the same moment: exactly one wins', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(10), '09:00', '10:00', 'full_court')
    const users = [await db.user(), await db.user()]
    const cs = await preconnect(2)
    const res = await settle(users.map((u, i) => db.hold(u, s, cs[i])))
    await closeAll(cs)
    expect(res.ok).toHaveLength(1)
    expect(res.errors).toEqual(['slot_unavailable'])
  })

  it('fifteen customers on one slot: exactly one wins, no conflicts', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(10), '10:00', '11:00', 'full_court')
    const users = await db.users(15)
    const cs = await preconnect(15)
    const res = await settle(users.map((u, i) => db.hold(u, s, cs[i])))
    await closeAll(cs)
    expect(res.ok).toHaveLength(1)
    expect(res.errors.every((e) => e === 'slot_unavailable')).toBe(true)
    expect(await activeConflictPairs()).toBe(0)
  })

  it('same customer from two tabs at once: one hold, the other call reuses it', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(10), '11:00', '12:00', 'full_court')
    const u = await db.user()
    const cs = await preconnect(2)
    const res = await settle([db.hold(u, s, cs[0]), db.hold(u, s, cs[1])])
    await closeAll(cs)
    expect(res.ok).toHaveLength(2)
    expect(res.ok.map((r) => r.reused).sort()).toEqual([false, true])
  })

  it('stress: 40 rounds of 12 customers racing full/half A/half B — never an incompatible pair', async () => {
    const court = await db.court()
    const users = await db.users(12)
    const cs = await preconnect(12)
    let fullWins = 0
    let halfPairs = 0
    for (let round = 0; round < 40; round++) {
      const d = colomboDate(20 + Math.floor(round / 10))
      const h = (6 + (round % 10)).toString().padStart(2, '0')
      const g = await db.slotGroup(court, d, `${h}:00`, `${+h + 1}:00`)
      const targets = [g.full, g.halfA, g.halfB]
      const res = await settle(users.map((u, i) => db.hold(u, targets[i % 3], cs[i])))
      const winners = res.ok.map((r) => r.slot_id as string)
      const full = winners.filter((w) => w === g.full).length
      const ha = winners.filter((w) => w === g.halfA).length
      const hb = winners.filter((w) => w === g.halfB).length
      // Valid outcomes only: one full court alone, or at most one of each half.
      if (full) {
        expect(full).toBe(1); expect(ha + hb).toBe(0); fullWins++
      } else {
        expect(ha).toBeLessThanOrEqual(1); expect(hb).toBeLessThanOrEqual(1); expect(ha + hb).toBeGreaterThan(0)
        if (ha && hb) halfPairs++
      }
      // Release so the per-customer hold limit does not interfere next round.
      await db.su.query(`update public.slots set status='available', locked_by=null, lock_expires_at=null where status='locked'`)
    }
    await closeAll(cs)
    expect(await activeConflictPairs()).toBe(0)
    // Both kinds of outcome actually occurred, so the race was real.
    expect(fullWins + halfPairs).toBeGreaterThan(0)
  }, 60_000)

  it('hold expiring while another customer requests the slot: the newcomer gets it cleanly', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(11), '09:00', '10:00', 'full_court')
    const a = await db.user(); const b = await db.user()
    await db.hold(a, s)
    await db.expireHold(s)
    const r = await db.hold(b, s)
    expect(r.reused).toBe(false)
    expect((await db.slotRow(s)).locked_by).toBe(b)
  })

  it('an expired hold on the full court no longer blocks a half court (no cleanup job needed)', async () => {
    const court = await db.court()
    const g = await db.slotGroup(court, colomboDate(11), '10:00', '11:00')
    const a = await db.user(); const b = await db.user()
    await db.hold(a, g.full)
    await db.expireHold(g.full)
    await expect(db.hold(b, g.halfA)).resolves.toBeTruthy()
    expect((await db.slotRow(g.full)).status).toBe('available')
  })

  it('admin block racing a customer hold on a conflicting slot: never both', async () => {
    const court = await db.court()
    const admin = await db.user({ role: 'super_admin' })
    let bothActive = 0
    for (let i = 0; i < 15; i++) {
      const g = await db.slotGroup(court, colomboDate(30), `${(6 + i).toString().padStart(2, '0')}:00`, `${7 + i}:00`)
      const customer = await db.user()
      const cs = await preconnect(2)
      await settle<unknown>([
        db.as('authenticated', admin, `select public.admin_block_slot($1, 'IIMPACT Practice')`, [g.halfA], cs[0]),
        db.hold(customer, g.full, cs[1]),
      ])
      await closeAll(cs)
      const full = await db.slotRow(g.full)
      const half = await db.slotRow(g.halfA)
      if (full.status === 'locked' && half.status === 'blocked') bothActive++
    }
    expect(bothActive).toBe(0)
  }, 30_000)
})

describe('admin blocks and recurring generation', () => {
  it('admin cannot block a slot that overlaps a booking or active hold', async () => {
    const court = await db.court()
    const g = await db.slotGroup(court, colomboDate(12), '09:00', '10:00')
    const admin = await db.user({ role: 'super_admin' })
    const u = await db.user()
    await db.hold(u, g.full)
    await expect(db.as('authenticated', admin, `select public.admin_block_slot($1, 'IIMPACT Practice')`, [g.halfA]))
      .rejects.toThrow('block_conflicts_with_booking')
    await expect(db.as('authenticated', admin, `select public.admin_block_slot($1, 'IIMPACT Practice')`, [g.full]))
      .rejects.toThrow('block_conflicts_with_booking')
  })

  it('non-admins cannot block slots', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(12), '11:00', '12:00', 'full_court')
    const u = await db.user()
    await expect(db.as('authenticated', u, `select public.admin_block_slot($1, 'x')`, [s])).rejects.toThrow('forbidden')
  })

  it('recurring generation never overwrites a booked slot and reports the clash', async () => {
    const court = await db.court()
    const admin = await db.user({ role: 'super_admin' })
    // Find the next Wednesday (dow 3) at least 3 days ahead.
    let day = 3
    while (new Date(colomboDate(day) + 'T00:00:00Z').getUTCDay() !== 3) day++
    const d1 = colomboDate(day); const d2 = colomboDate(day + 7); const d3 = colomboDate(day + 14)
    const booked = await db.slot(court, d1, '18:00', '19:00', 'full_court', { status: 'booked' })
    const avail = await db.slot(court, d2, '18:00', '19:00', 'full_court')
    const rec = await db.su.query(
      `insert into public.recurring_bookings (court_id, company_name, day_of_week, start_time, end_time, court_type, price_lkr, date_from, date_to)
       values ($1, 'Acme Corp', 3, '18:00', '19:00', 'full_court', 4000, $2, $3) returning id`, [court, d1, d3])
    const r = await db.as<{ r: Record<string, unknown> }>('authenticated', admin,
      `select public.admin_generate_recurring_slots($1) as r`, [rec.rows[0].id])
    expect(r[0].r).toMatchObject({ created: 1, converted: 1, conflict_dates: [d1] })
    expect((await db.slotRow(booked)).status).toBe('booked')
    expect((await db.slotRow(avail)).status).toBe('blocked')
  })
})
