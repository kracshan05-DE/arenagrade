// Payments, OTP, cancellations/refunds and reporting at the database layer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHash } from 'node:crypto'
import { TestDb, colomboDate, settle } from './helpers'

let db: TestDb
beforeAll(async () => { db = await TestDb.create() })
afterAll(async () => { await db?.close() })

const key = (...parts: unknown[]) => createHash('sha256').update(parts.join('|')).digest('hex')

async function createAttempt(uid: string, slotId: string, provider = 'payhere', env = 'sandbox') {
  const r = await db.service<{ r: Record<string, string> }>(
    `select public.payment_create_attempt($1, $2, $3, $4) as r`, [uid, slotId, provider, env])
  return r[0].r
}

async function notify(order: string, status: number, amount: string, opts: { sig?: boolean; provider?: string; pid?: string; c?: Client } = {}) {
  const pid = opts.pid ?? `PH${order}`
  const params = [opts.provider ?? 'payhere', order, pid, status, amount, 'LKR', opts.sig ?? true, key(order, pid, status, amount), '{}']
  const rows = await db.as<{ r: Record<string, string> }>('service_role', null,
    `select public.payment_apply_notification($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as r`, params, opts.c)
  return rows[0].r
}

/** Full happy path: verified customer holds a slot and pays. */
async function book(uid: string, slotId: string) {
  await db.hold(uid, slotId)
  const a = await createAttempt(uid, slotId)
  const r = await notify(a.order_id, 2, a.amount)
  expect(r.result).toBe('confirmed')
  return { attempt: a, bookingId: r.booking_id }
}

async function count(sql: string, params: unknown[] = []) {
  return Number((await db.su.query(sql, params)).rows[0].n)
}

describe('payment initiation', () => {
  it('requires the caller\'s own valid hold and a verified phone; amount comes from the slot', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(3), '09:00', '10:00', 'full_court', { price: 4500 })
    const unverified = await db.user()
    const other = await db.user({ phoneVerified: true })
    await db.hold(unverified, s)
    await expect(createAttempt(unverified, s)).rejects.toThrow('phone_not_verified')
    await expect(createAttempt(other, s)).rejects.toThrow('hold_invalid_or_expiring')

    const verified = await db.user({ phoneVerified: true })
    const s2 = await db.slot(court, colomboDate(3), '10:00', '11:00', 'full_court', { price: 4500 })
    await db.hold(verified, s2)
    const a = await createAttempt(verified, s2)
    expect(a.amount).toBe('4500.00')
    expect(a.currency).toBe('LKR')
  })

  it('repeated "Pay" clicks reuse one attempt per hold', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(3), '11:00', '12:00', 'full_court')
    const u = await db.user({ phoneVerified: true })
    await db.hold(u, s)
    const a1 = await createAttempt(u, s)
    const a2 = await createAttempt(u, s)
    expect(a2.order_id).toBe(a1.order_id)
  })

  it('refuses to start a payment with under 60 seconds of hold left', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(3), '12:00', '13:00', 'full_court')
    const u = await db.user({ phoneVerified: true })
    await db.hold(u, s)
    await db.su.query(`update public.slots set lock_expires_at = now() + interval '30 seconds' where id = $1`, [s])
    await expect(createAttempt(u, s)).rejects.toThrow('hold_invalid_or_expiring')
  })

  it('browser roles cannot call payment functions', async () => {
    const u = await db.user({ phoneVerified: true })
    await expect(db.as('authenticated', u, `select public.payment_create_attempt($1, gen_random_uuid(), 'payhere', 'live')`, [u]))
      .rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', u,
      `select public.payment_apply_notification('payhere','x','y',2,'1.00','LKR',true,'k','{}')`))
      .rejects.toThrow(/permission denied/)
  })
})

describe('payment notifications', () => {
  it('a verified success within the hold confirms exactly one booking', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(4), '09:00', '10:00', 'full_court', { price: 5000 })
    const u = await db.user({ phoneVerified: true })
    const { bookingId } = await book(u, s)
    const b = (await db.su.query(`select * from public.bookings where id = $1`, [bookingId])).rows[0]
    expect(b.status).toBe('confirmed')
    expect(Number(b.total_lkr)).toBe(5000)
    expect((await db.slotRow(s)).status).toBe('booked')
  })

  it('duplicate notifications (sequential and concurrent) never duplicate the booking', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(4), '10:00', '11:00', 'full_court')
    const u = await db.user({ phoneVerified: true })
    await db.hold(u, s)
    const a = await createAttempt(u, s)
    const cs = await Promise.all(Array.from({ length: 6 }, () => db.client()))
    const res = await settle(cs.map((c) => notify(a.order_id, 2, a.amount, { c })))
    await Promise.all(cs.map((c) => c.end()))
    const results = res.ok.map((r) => r.result).sort()
    expect(results.filter((r) => r === 'confirmed')).toHaveLength(1)
    expect(results.filter((r) => r === 'duplicate')).toHaveLength(5)
    expect(await count(`select count(*) n from public.bookings where idempotency_key = $1`, [a.order_id])).toBe(1)
    const again = await notify(a.order_id, 2, a.amount)
    expect(again.result).toBe('duplicate')
  })

  it('invalid signature, unknown order and wrong amount never confirm', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(4), '11:00', '12:00', 'full_court', { price: 3000 })
    const u = await db.user({ phoneVerified: true })
    await db.hold(u, s)
    const a = await createAttempt(u, s)
    expect((await notify(a.order_id, 2, a.amount, { sig: false })).result).toBe('invalid_signature')
    expect((await notify('AGNOPE', 2, '3000.00')).result).toBe('unknown_order')
    expect((await notify(a.order_id, 2, '30.00', { pid: 'other' })).result).toBe('amount_mismatch')
    expect((await db.slotRow(s)).status).toBe('locked')
    expect(await count(`select count(*) n from public.app_events where event in ('notification_unknown_order','notification_amount_mismatch') and severity='critical'`)).toBe(2)
  })

  it('a simulator event cannot settle a real PayHere order', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(4), '12:00', '13:00', 'full_court')
    const u = await db.user({ phoneVerified: true })
    await db.hold(u, s)
    const a = await createAttempt(u, s, 'payhere', 'live')
    expect((await notify(a.order_id, 2, a.amount, { provider: 'simulator' })).result).toBe('provider_mismatch')
    expect((await db.slotRow(s)).status).toBe('locked')
  })

  it('late success after the hold expired: paid but NOT booked, refund queued, incident raised', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(4), '13:00', '14:00', 'full_court', { price: 2000 })
    const u = await db.user({ phoneVerified: true })
    await db.hold(u, s)
    const a = await createAttempt(u, s)
    await db.expireHold(s)
    const r = await notify(a.order_id, 2, a.amount)
    expect(r.result).toBe('paid_unconfirmed')
    expect(await count(`select count(*) n from public.bookings where idempotency_key = $1`, [a.order_id])).toBe(0)
    const att = (await db.su.query(`select * from public.payment_attempts where order_id = $1`, [a.order_id])).rows[0]
    expect(att.status).toBe('succeeded_unconfirmed')
    expect(att.reconciliation_status).toBe('refund_required')
    expect(await count(`select count(*) n from public.refunds where payment_attempt_id = $1 and status = 'pending'`, [att.id])).toBe(1)
    expect(await count(`select count(*) n from public.app_events where event = 'paid_without_booking' and correlation_id = $1`, [a.order_id])).toBe(1)
  })

  it('late success after another customer took the slot leaves their hold untouched', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(4), '15:00', '16:00', 'full_court')
    const first = await db.user({ phoneVerified: true })
    const second = await db.user({ phoneVerified: true })
    await db.hold(first, s)
    const a = await createAttempt(first, s)
    await db.expireHold(s)
    await db.hold(second, s)
    expect((await notify(a.order_id, 2, a.amount)).result).toBe('paid_unconfirmed')
    expect((await db.slotRow(s)).locked_by).toBe(second)
  })

  it('a release-and-re-hold by the same customer does not let an old attempt confirm', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(4), '16:00', '17:00', 'full_court')
    const u = await db.user({ phoneVerified: true })
    await db.hold(u, s)
    const oldAttempt = await createAttempt(u, s)
    await db.as('authenticated', u, `select public.release_hold($1)`, [s])
    await db.hold(u, s)
    expect((await notify(oldAttempt.order_id, 2, oldAttempt.amount)).result).toBe('paid_unconfirmed')
  })

  it('out-of-order events: failure then success confirms; success then failure is ignored', async () => {
    const court = await db.court()
    const s1 = await db.slot(court, colomboDate(5), '09:00', '10:00', 'full_court')
    const s2 = await db.slot(court, colomboDate(5), '10:00', '11:00', 'full_court')
    const u = await db.user({ phoneVerified: true })
    await db.hold(u, s1)
    const a1 = await createAttempt(u, s1)
    expect((await notify(a1.order_id, -2, a1.amount)).result).toBe('failed')
    expect((await notify(a1.order_id, 2, a1.amount)).result).toBe('confirmed')

    await db.hold(u, s2)
    const a2 = await createAttempt(u, s2)
    expect((await notify(a2.order_id, 2, a2.amount)).result).toBe('confirmed')
    expect((await notify(a2.order_id, -2, a2.amount)).result).toBe('stale_ignored')
    expect((await notify(a2.order_id, -3, a2.amount)).result).toBe('charged_back')
    expect((await db.slotRow(s2)).status).toBe('booked')
  })

  it('payment confirmation racing a conflicting half-court hold: never both', async () => {
    const court = await db.court()
    let violations = 0
    for (let i = 0; i < 10; i++) {
      const g = await db.slotGroup(court, colomboDate(40), `${(6 + i).toString().padStart(2, '0')}:00`, `${7 + i}:00`)
      const payer = await db.user({ phoneVerified: true })
      const rival = await db.user()
      await db.hold(payer, g.full)
      const a = await createAttempt(payer, g.full)
      const cs = await Promise.all([db.client(), db.client()])
      await settle<unknown>([notify(a.order_id, 2, a.amount, { c: cs[0] }), db.hold(rival, g.halfA, cs[1])])
      await Promise.all(cs.map((c) => c.end()))
      const full = await db.slotRow(g.full); const half = await db.slotRow(g.halfA)
      if (['locked', 'booked'].includes(full.status) && ['locked', 'booked'].includes(half.status)) violations++
    }
    expect(violations).toBe(0)
  }, 30_000)
})

describe('phone OTP', () => {
  const issue = (uid: string, phone: string, hash: string, opts: Partial<Record<string, number | string>> = {}) =>
    db.service<{ r: Record<string, unknown> }>(
      `select public.otp_issue_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as r`,
      [uid, phone, hash, opts.ip ?? 'iphash', opts.ttl ?? 600, opts.cooldown ?? 60, opts.phoneLimit ?? 3,
        opts.phoneWindow ?? 600, opts.userLimit ?? 6, opts.ipLimit ?? 10, opts.dailyCap ?? 300]).then((r) => r[0].r)
  const verify = (uid: string, phone: string, hash: string) =>
    db.service<{ r: Record<string, unknown> }>(`select public.otp_verify_challenge($1,$2,$3) as r`, [uid, phone, hash]).then((r) => r[0].r)

  it('verifies once, binds the phone to the user, and cannot be replayed', async () => {
    const u = await db.user()
    expect((await issue(u, '0771234567', 'h-good')).allowed).toBe(true)
    expect(await verify(u, '0771234567', 'h-good')).toMatchObject({ ok: true })
    const p = (await db.su.query(`select phone, phone_verified from public.profiles where id = $1`, [u])).rows[0]
    expect(p).toEqual({ phone: '0771234567', phone_verified: true })
    expect(await verify(u, '0771234567', 'h-good')).toMatchObject({ ok: false, reason: 'no_active_code' })
  })

  it('a code issued for one phone cannot verify another phone', async () => {
    const u = await db.user()
    await issue(u, '0771111111', 'h1')
    expect(await verify(u, '0772222222', 'h1')).toMatchObject({ ok: false, reason: 'no_active_code' })
  })

  it('locks after 5 wrong attempts and enforces expiry', async () => {
    const u = await db.user()
    await issue(u, '0773333333', 'right')
    for (let i = 4; i >= 1; i--) expect(await verify(u, '0773333333', 'wrong')).toMatchObject({ reason: 'invalid_code', attempts_left: i })
    expect(await verify(u, '0773333333', 'wrong')).toMatchObject({ reason: 'too_many_attempts' })
    expect(await verify(u, '0773333333', 'right')).toMatchObject({ ok: false, reason: 'too_many_attempts' })

    const u2 = await db.user()
    await issue(u2, '0774444444', 'h', { ttl: 1 })
    await db.su.query(`update public.phone_otp_challenges set expires_at = now() - interval '1 second' where user_id = $1`, [u2])
    expect(await verify(u2, '0774444444', 'h')).toMatchObject({ ok: false, reason: 'expired' })
  })

  it('a new code supersedes the previous one', async () => {
    const u = await db.user()
    await issue(u, '0775555555', 'old', { cooldown: 0 })
    await issue(u, '0775555555', 'new', { cooldown: 0 })
    expect(await verify(u, '0775555555', 'old')).toMatchObject({ ok: false, reason: 'invalid_code' })
    expect(await verify(u, '0775555555', 'new')).toMatchObject({ ok: true })
  })

  it('enforces cooldown, per-phone, per-IP and daily limits', async () => {
    const u = await db.user()
    await issue(u, '0776666666', 'a')
    expect(await issue(u, '0776666666', 'b')).toMatchObject({ allowed: false, reason: 'cooldown' })

    const phone = '0777777777'
    for (let i = 0; i < 3; i++) expect((await issue(await db.user(), phone, `p${i}`, { cooldown: 0, ip: `ip${i}` })).allowed).toBe(true)
    expect(await issue(await db.user(), phone, 'p4', { cooldown: 0, ip: 'ipx' })).toMatchObject({ allowed: false, reason: 'phone_limit' })

    for (let i = 0; i < 2; i++) await issue(await db.user(), `07800000${i}0`, 'x', { ip: 'same-ip', ipLimit: 2 })
    expect(await issue(await db.user(), '0780000099', 'x', { ip: 'same-ip', ipLimit: 2 })).toMatchObject({ allowed: false, reason: 'ip_limit' })

    const today = await count(`select count(*) n from public.phone_otp_challenges`)
    expect(await issue(await db.user(), '0790000000', 'x', { dailyCap: today, ip: 'cap' })).toMatchObject({ allowed: false, reason: 'daily_cap' })
  })

  it('parallel requests for one phone cannot exceed the per-phone limit', async () => {
    const users = await db.users(10)
    const cs = await Promise.all(users.map(() => db.client()))
    const res = await settle(users.map((u, i) => db.as<{ r: { allowed: boolean } }>('service_role', null,
      `select public.otp_issue_challenge($1,'0711111111',$2,$3,600,0,3,600,6,100,1000) as r`, [u, `h${i}`, `ip${i}`], cs[i])))
    await Promise.all(cs.map((c) => c.end()))
    expect(res.ok.filter((r) => r[0].r.allowed)).toHaveLength(3)
  })

  it('browsers cannot read challenges, call OTP functions, or mark themselves verified', async () => {
    const u = await db.user()
    await expect(db.as('authenticated', u, `select * from public.phone_otp_challenges`)).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', u, `select * from public.otp_verifications`)).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', u, `select public.otp_verify_challenge($1,'0700000000','x')`, [u])).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', u, `update public.profiles set phone_verified = true where id = $1`, [u])).rejects.toThrow('forbidden_profile_fields')
    await expect(db.as('authenticated', u, `update public.profiles set role = 'super_admin' where id = $1`, [u])).rejects.toThrow('forbidden_profile_fields')
    await expect(db.as('authenticated', u, `update public.profiles set full_name = 'New Name' where id = $1`, [u])).resolves.toBeTruthy()
  })
})

describe('cancellations and refunds', () => {
  it('customer can request for own booking >=24h ahead; repeat is a no-op', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(5), '18:00', '19:00', 'full_court')
    const u = await db.user({ phoneVerified: true, phone: '0771230000' })
    const { bookingId } = await book(u, s)
    const r1 = await db.as<{ r: Record<string, unknown> }>('authenticated', u, `select public.request_booking_cancellation($1, 'Team travelling') as r`, [bookingId])
    expect(r1[0].r).toMatchObject({ changed: true, customer_phone: '0771230000' })
    const r2 = await db.as<{ r: Record<string, unknown> }>('authenticated', u, `select public.request_booking_cancellation($1, 'Again') as r`, [bookingId])
    expect(r2[0].r.changed).toBe(false)
  })

  it('rejects requests inside 24 hours, for other people\'s bookings, and with empty reasons', async () => {
    const court = await db.court()
    const soon = (await db.su.query(
      `insert into public.slots (court_id, slot_date, start_time, end_time, court_type, price_lkr)
       select $1, d::date, d::time, (d + interval '1 hour')::time, 'full_court', 3000
       from (select date_trunc('hour', public.colombo_now() + interval '3 hours') d) x returning id`, [court])).rows[0].id
    const u = await db.user({ phoneVerified: true })
    const { bookingId } = await book(u, soon)
    await expect(db.as('authenticated', u, `select public.request_booking_cancellation($1, 'Need to cancel')`, [bookingId]))
      .rejects.toThrow('cancellation_window_closed')

    const s2 = await db.slot(court, colomboDate(6), '09:00', '10:00', 'full_court')
    const owner = await db.user({ phoneVerified: true })
    const intruder = await db.user()
    const b2 = await book(owner, s2)
    await expect(db.as('authenticated', intruder, `select public.request_booking_cancellation($1, 'Not mine')`, [b2.bookingId]))
      .rejects.toThrow('booking_not_found')
    await expect(db.as('authenticated', owner, `select public.request_booking_cancellation($1, ' ')`, [b2.bookingId]))
      .rejects.toThrow('invalid_reason')
  })

  it('approval releases the slot and creates exactly one pending refund; refund needs a reference to complete', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(7), '09:00', '10:00', 'full_court', { price: 6000 })
    const u = await db.user({ phoneVerified: true })
    const admin = await db.user({ role: 'super_admin' })
    const { bookingId } = await book(u, s)
    await db.as('authenticated', u, `select public.request_booking_cancellation($1, 'Injury')`, [bookingId])

    await expect(db.as('authenticated', u, `select public.admin_decide_cancellation($1, 'approve')`, [bookingId])).rejects.toThrow('forbidden')

    const r = await db.as<{ r: Record<string, string> }>('authenticated', admin, `select public.admin_decide_cancellation($1, 'approve') as r`, [bookingId])
    expect(r[0].r.changed).toBe(true)
    const again = await db.as<{ r: Record<string, string> }>('authenticated', admin, `select public.admin_decide_cancellation($1, 'approve') as r`, [bookingId])
    expect(again[0].r.changed).toBe(false)
    expect((await db.slotRow(s)).status).toBe('available')
    expect(await count(`select count(*) n from public.refunds where booking_id = $1`, [bookingId])).toBe(1)

    const refundId = r[0].r.refund_id
    await expect(db.as('authenticated', admin, `select public.admin_update_refund($1, 'completed')`, [refundId])).rejects.toThrow('bank_reference_required')
    await db.as('authenticated', admin, `select public.admin_update_refund($1, 'initiated')`, [refundId])
    await db.as('authenticated', admin, `select public.admin_update_refund($1, 'completed', 'BOC-TRX-123')`, [refundId])
    await expect(db.as('authenticated', admin, `select public.admin_update_refund($1, 'pending')`, [refundId])).rejects.toThrow('invalid_refund_transition')
    await expect(db.as('authenticated', u, `select public.admin_update_refund($1, 'cancelled')`, [refundId])).rejects.toThrow('forbidden')
    await expect(db.as('authenticated', u, `update public.refunds set status = 'completed' where id = $1`, [refundId])).rejects.toThrow(/permission denied/)
  })

  it('concurrent approve and reject: one decision wins, state stays consistent', async () => {
    const court = await db.court()
    const admin = await db.user({ role: 'super_admin' })
    for (let i = 0; i < 6; i++) {
      const s = await db.slot(court, colomboDate(8), `${(8 + i).toString().padStart(2, '0')}:00`, `${9 + i}:00`, 'full_court')
      const u = await db.user({ phoneVerified: true })
      const { bookingId } = await book(u, s)
      await db.as('authenticated', u, `select public.request_booking_cancellation($1, 'Change of plans')`, [bookingId])
      const cs = await Promise.all([db.client(), db.client()])
      const res = await settle<unknown>([
        db.as('authenticated', admin, `select public.admin_decide_cancellation($1, 'approve')`, [bookingId], cs[0]),
        db.as('authenticated', admin, `select public.admin_decide_cancellation($1, 'reject')`, [bookingId], cs[1]),
      ])
      await Promise.all(cs.map((c) => c.end()))
      expect(res.ok).toHaveLength(1)
      expect(res.errors).toEqual(['booking_not_pending_cancellation'])
      const b = (await db.su.query(`select status from public.bookings where id = $1`, [bookingId])).rows[0]
      const slot = await db.slotRow(s)
      const refunds = await count(`select count(*) n from public.refunds where booking_id = $1`, [bookingId])
      if (b.status === 'cancelled') { expect(slot.status).toBe('available'); expect(refunds).toBe(1) }
      else { expect(b.status).toBe('confirmed'); expect(slot.status).toBe('booked'); expect(refunds).toBe(0) }
    }
  }, 30_000)

  it('a second request after a rejection can be rejected again', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(9), '09:00', '10:00', 'full_court')
    const u = await db.user({ phoneVerified: true })
    const admin = await db.user({ role: 'super_admin' })
    const { bookingId } = await book(u, s)
    for (let round = 0; round < 2; round++) {
      await db.as('authenticated', u, `select public.request_booking_cancellation($1, 'Please cancel')`, [bookingId])
      const r = await db.as<{ r: { changed: boolean } }>('authenticated', admin, `select public.admin_decide_cancellation($1, 'reject') as r`, [bookingId])
      expect(r[0].r.changed).toBe(true)
    }
  })
})

describe('jobs, notifications and the daily report', () => {
  it('parallel job claims: exactly one runs; succeeded runs are not repeated unless forced', async () => {
    const cs = await Promise.all(Array.from({ length: 6 }, () => db.client()))
    const res = await settle(cs.map((c) => db.as<{ r: { claimed: boolean } }>('service_role', null,
      `select public.job_claim('daily_report', '2026-10-17') as r`, [], c)))
    await Promise.all(cs.map((c) => c.end()))
    expect(res.ok.filter((r) => r[0].r.claimed)).toHaveLength(1)
    await db.service(`select public.job_finish('daily_report', '2026-10-17', 'succeeded', null, '{}')`)
    expect((await db.service<{ r: { claimed: boolean } }>(`select public.job_claim('daily_report', '2026-10-17') as r`))[0].r.claimed).toBe(false)
    expect((await db.service<{ r: { claimed: boolean } }>(`select public.job_claim('daily_report', '2026-10-17', true) as r`))[0].r.claimed).toBe(true)
  })

  it('a notification is sent at most once unless the previous attempt failed', async () => {
    const claim = () => db.service<{ r: { claimed: boolean } }>(
      `select public.notification_claim('sms','booking_confirmation','07*****567','booking','b1','sms:confirm:AG1') as r`).then((r) => r[0].r.claimed)
    expect(await claim()).toBe(true)
    expect(await claim()).toBe(false)
    await db.service(`select public.notification_finish('sms:confirm:AG1','failed',null,'timeout')`)
    expect(await claim()).toBe(true)
    await db.service(`select public.notification_finish('sms:confirm:AG1','accepted','uid-1',null)`)
    expect(await claim()).toBe(false)
  })

  it('report money totals come from deduplicated attempts and separate live from test', async () => {
    const t0 = (await db.su.query(`select clock_timestamp() t`)).rows[0].t
    const court = await db.court()
    const u = await db.user({ phoneVerified: true })
    const live: string[] = []
    for (const [h, price] of [['09', 1000], ['10', 2500]] as const) {
      const s = await db.slot(court, colomboDate(50), `${h}:00`, `${+h + 1}:00`, 'full_court', { price })
      await db.hold(u, s)
      const a = await createAttempt(u, s, 'payhere', 'live')
      await notify(a.order_id, 2, a.amount)
      await notify(a.order_id, 2, a.amount) // provider retry
      live.push(a.order_id)
    }
    const st = await db.slot(court, colomboDate(50), '12:00', '13:00', 'full_court', { price: 9999 })
    await db.hold(u, st)
    const ta = await createAttempt(u, st, 'simulator', 'test')
    await notify(ta.order_id, 2, ta.amount, { provider: 'simulator' })

    const t1 = (await db.su.query(`select clock_timestamp() t`)).rows[0].t
    const rep = (await db.service<{ r: Record<string, Record<string, unknown>> }>(`select public.report_daily($1, $2) as r`, [t0, t1]))[0].r
    expect(Number(rep.payments.live_succeeded_count)).toBe(2)
    expect(Number(rep.payments.live_succeeded_lkr)).toBe(3500)
    expect(Number(rep.payments.non_live_succeeded_count)).toBe(1)
    expect(Number(rep.payments.duplicate_notifications)).toBe(2)
    expect(Number(rep.integrity.overlapping_active_slots)).toBe(0)
    expect(Number(rep.integrity.confirmed_bookings_on_unbooked_slots)).toBe(0)
  })
})
