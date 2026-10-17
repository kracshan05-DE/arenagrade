// End-to-end route tests: real Next.js route handlers -> real SQL functions on
// local PostgreSQL. External providers (Text.lk, Resend) are mocked at fetch;
// nothing leaves the machine. PayHere notifications are signed exactly as
// PayHere documents, using a test merchant secret.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { TestDb, colomboDate } from '../db/helpers'
import { pgAdapter, tokenFor } from './pg-adapter'
import { setDbAdapterForTests } from '@/lib/server/db'

import { POST as otpSend } from '@/app/api/otp/send/route'
import { POST as otpVerify } from '@/app/api/otp/verify/route'
import { POST as payInit } from '@/app/api/payments/initiate/route'
import { POST as payNotify } from '@/app/api/payments/payhere/notify/route'
import { POST as paySimulate } from '@/app/api/payments/simulate/route'
import { POST as cancelBooking } from '@/app/api/bookings/[id]/cancel/route'
import { POST as adminDecision } from '@/app/api/admin/bookings/[id]/decision/route'
import { POST as adminRefund } from '@/app/api/admin/refunds/[id]/route'
import { GET as dailyReport } from '@/app/api/cron/daily-report/route'
import { GET as health } from '@/app/api/health/route'

const SITE = 'https://arenagrade.test'
const MERCHANT = '1211149'
const SECRET = 'TestMerchantSecret'
const md5U = (s: string) => createHash('md5').update(s).digest('hex').toUpperCase()

let db: TestDb
beforeAll(async () => {
  db = await TestDb.create()
  setDbAdapterForTests(pgAdapter(db))
})
afterAll(async () => {
  setDbAdapterForTests(null)
  await db?.close()
})

// ---- provider mocks --------------------------------------------------------
type Sent = { url: string; body: Record<string, unknown>; headers: Record<string, string> }
let sent: Sent[] = []
let textLkMode: 'ok' | 'error_200' = 'ok'
let resendMode: 'ok' | 'fail' = 'ok'
const smsTo = (n: string) => sent.filter((s) => s.url.includes('text.lk') && s.body.recipient === n)
const emails = () => sent.filter((s) => s.url.includes('resend.com'))

const BASE_ENV: Record<string, string> = {
  ARENAGRADE_ENV: 'test', APP_BASE_URL: SITE, OTP_HASH_SECRET: 'x'.repeat(40), TEXT_LK_API_KEY: 'tl-test',
  RESEND_API_KEY: 're_test', CRON_SECRET: 'cron-secret-for-tests-123', REPORT_RECIPIENTS: 'owner@gmail.com,admin@gmail.com',
  ADMIN_ALERT_PHONE: '0770000001', CRITICAL_ALERT_PHONES: '0770000009', REFUND_WHATSAPP_NUMBER: '0770000001',
  PAYHERE_MERCHANT_ID: MERCHANT, PAYHERE_MERCHANT_SECRET: SECRET, PAYHERE_MODE: 'live',
}
const CLEAR = ['VERCEL_ENV', 'PAYMENT_SIMULATION', 'OTP_TEST_MODE']

beforeEach(() => {
  for (const k of CLEAR) delete process.env[k]
  Object.assign(process.env, BASE_ENV)
  sent = []
  textLkMode = 'ok'
  resendMode = 'ok'
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}'))
    sent.push({ url, body, headers: (init.headers ?? {}) as Record<string, string> })
    if (url.includes('text.lk')) {
      return new Response(JSON.stringify(textLkMode === 'ok'
        ? { status: 'success', data: { uid: `uid-${sent.length}`, status: 'Delivered' } }
        : { status: 'error', message: 'Insufficient balance' }), { status: 200 })
    }
    if (url.includes('resend.com')) {
      return resendMode === 'ok'
        ? new Response(JSON.stringify({ id: `em-${sent.length}` }), { status: 200 })
        : new Response(JSON.stringify({ name: 'internal_server_error' }), { status: 500 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }))
})

// ---- request helpers ------------------------------------------------------
function req(path: string, body: unknown, opts: { uid?: string; origin?: string; host?: string; method?: string; auth?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: opts.origin ?? SITE, host: opts.host ?? 'arenagrade.test' }
  if (opts.uid) headers.authorization = `Bearer ${tokenFor(opts.uid)}`
  if (opts.auth) headers.authorization = opts.auth
  return new Request(`${SITE}${path}`, { method: opts.method ?? 'POST', headers, body: opts.method === 'GET' ? undefined : JSON.stringify(body) })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

function notifyRequest(f: { order: string; amount: string; status?: string; currency?: string; merchant?: string; secret?: string; paymentId?: string }) {
  const status = f.status ?? '2'
  const currency = f.currency ?? 'LKR'
  const merchant = f.merchant ?? MERCHANT
  const md5sig = md5U(merchant + f.order + f.amount + currency + status + md5U(f.secret ?? SECRET))
  const form = new URLSearchParams({
    merchant_id: merchant, order_id: f.order, payment_id: f.paymentId ?? `3200${Date.now()}`, payhere_amount: f.amount,
    payhere_currency: currency, status_code: status, md5sig, method: 'VISA', status_message: 'Successfully completed',
    card_holder_name: 'JANE DOE', card_no: '************1292', card_expiry: '12/30',
  })
  return new Request(`${SITE}/api/payments/payhere/notify`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  })
}

async function verifiedCustomer(phone = '0771234567') {
  return db.user({ phoneVerified: true, phone })
}

async function initiate(uid: string, slotId: string, extra: Record<string, unknown> = {}) {
  const r = await payInit(req('/api/payments/initiate', { slotId, ...extra }, { uid }))
  return { status: r.status, body: await r.json() }
}

// ---- tests ---------------------------------------------------------------
describe('removed attack surface', () => {
  it('the open /api/send-sms and /api/send-email endpoints no longer exist', () => {
    const root = join(__dirname, '..', '..', 'app', 'api')
    expect(existsSync(join(root, 'send-sms'))).toBe(false)
    expect(existsSync(join(root, 'send-email'))).toBe(false)
  })
})

describe('OTP routes', () => {
  it('require authentication and same-origin', async () => {
    expect((await otpSend(req('/api/otp/send', { phone: '0771112222' }))).status).toBe(401)
    const u = await db.user()
    expect((await otpSend(req('/api/otp/send', { phone: '0771112222' }, { uid: u, origin: 'https://evil.example' }))).status).toBe(403)
    expect((await otpSend(req('/api/otp/send', { phone: 'abc' }, { uid: u }))).status).toBe(400)
  })

  it('send -> wrong code -> right code verifies; the code never appears in the response', async () => {
    const u = await db.user()
    const r = await otpSend(req('/api/otp/send', { phone: '077 111 3333' }, { uid: u }))
    const body = await r.json()
    expect(r.status).toBe(200)
    expect(body).toEqual({ status: 'sent', resend_after_seconds: 60 })
    const msg = smsTo('94771113333')[0].body.message as string
    const code = /code is (\d{6})/.exec(msg)![1]

    const wrong = await otpVerify(req('/api/otp/verify', { phone: '0771113333', code: code === '000000' ? '111111' : '000000' }, { uid: u }))
    expect(await wrong.json()).toEqual({ error: 'invalid_code', attempts_left: 4 })
    const right = await otpVerify(req('/api/otp/verify', { phone: '0771113333', code }, { uid: u }))
    expect(await right.json()).toEqual({ status: 'verified' })
    expect((await db.su.query(`select phone_verified from public.profiles where id = $1`, [u])).rows[0].phone_verified).toBe(true)

    // another user cannot use this user's code
    const intruder = await db.user()
    const steal = await otpVerify(req('/api/otp/verify', { phone: '0771113333', code }, { uid: intruder }))
    expect(steal.status).toBe(400)
  })

  it('treats a Text.lk error-in-200 as a failure (old code counted it as sent)', async () => {
    textLkMode = 'error_200'
    const u = await db.user()
    const r = await otpSend(req('/api/otp/send', { phone: '0771114444' }, { uid: u }))
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ error: 'sms_failed' })
    const row = (await db.su.query(`select sms_status from public.phone_otp_challenges where user_id = $1`, [u])).rows[0]
    expect(row.sms_status).toBe('failed')
  })

  it('enforces the resend cooldown', async () => {
    const u = await db.user()
    await otpSend(req('/api/otp/send', { phone: '0771115555' }, { uid: u }))
    const again = await otpSend(req('/api/otp/send', { phone: '0771115555' }, { uid: u }))
    expect(again.status).toBe(429)
    expect(smsTo('94771115555')).toHaveLength(1)
  })

  it('test mode returns the code only outside production', async () => {
    process.env.OTP_TEST_MODE = 'enabled'
    const u = await db.user()
    const body = await (await otpSend(req('/api/otp/send', { phone: '0771116666' }, { uid: u }))).json()
    expect(body.test_code).toMatch(/^\d{6}$/)
    expect(smsTo('94771116666')).toHaveLength(0)

    process.env.VERCEL_ENV = 'production'
    delete process.env.ARENAGRADE_ENV
    const u2 = await db.user()
    const body2 = await (await otpSend(req('/api/otp/send', { phone: '0771117777' }, { uid: u2 }))).json()
    expect(body2.test_code).toBeUndefined()
  })
})

describe('payment initiation', () => {
  it('requires auth, a verified phone and the caller\'s own hold', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(3), '09:00', '10:00', 'full_court', { price: 4200 })
    expect((await payInit(req('/api/payments/initiate', { slotId: s }))).status).toBe(401)
    const unverified = await db.user()
    await db.hold(unverified, s)
    expect((await initiate(unverified, s)).body.error).toBe('phone_not_verified')
    const other = await verifiedCustomer()
    expect((await initiate(other, s)).status).toBe(409)
  })

  it('signs a PayHere request with the server-side amount and canonical URLs', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(3), '10:00', '11:00', 'full_court', { price: 4200 })
    const u = await verifiedCustomer()
    await db.hold(u, s)
    const r = await payInit(req('/api/payments/initiate', { slotId: s, amount: '1.00', currency: 'USD' }, { uid: u, host: 'evil.example' }))
    const body = await r.json()
    expect(r.status).toBe(200)
    expect(body.mode).toBe('payhere')
    expect(body.action).toBe('https://www.payhere.lk/pay/checkout')
    const f = body.fields
    expect(f.amount).toBe('4200.00')
    expect(f.currency).toBe('LKR')
    expect(f.notify_url).toBe(`${SITE}/api/payments/payhere/notify`)
    expect(f.return_url.startsWith(`${SITE}/booking/${s}/payment/success`)).toBe(true)
    expect(f.hash).toBe(md5U(MERCHANT + f.order_id + '4200.00' + 'LKR' + md5U(SECRET)))
    expect(JSON.stringify(body)).not.toContain(SECRET)
  })

  it('admin-only mode: customers get 403 booking_admin_only; an admin gets a PayHere sandbox checkout', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(3), '12:00', '13:00', 'full_court', { price: 6000 })
    const admin = await db.user({ role: 'super_admin', phoneVerified: true })
    await db.hold(admin, s)
    await db.su.query(`update public.app_settings set value = 'admin_only' where key = 'booking_mode'`)
    const customer = await verifiedCustomer()
    const denied = await initiate(customer, s)
    expect(denied.status).toBe(403)
    expect(denied.body.error).toBe('booking_admin_only')
    process.env.PAYHERE_MODE = 'sandbox'
    const r = await initiate(admin, s)
    expect(r.status).toBe(200)
    expect(r.body.action).toBe('https://sandbox.payhere.lk/pay/checkout')
    expect((await db.su.query(`select environment from public.payment_attempts where user_id = $1`, [admin])).rows[0].environment).toBe('sandbox')
    await db.su.query(`update public.app_settings set value = 'public' where key = 'booking_mode'`)
  })

  it('a customer can never start a sandbox payment, even when booking is public', async () => {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(3), '13:00', '14:00', 'full_court', { price: 6000 })
    const u = await verifiedCustomer()
    await db.hold(u, s)
    process.env.PAYHERE_MODE = 'sandbox'
    const r = await initiate(u, s)
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('test_payments_admin_only')
  })

  it('is unavailable (503) when PayHere is not configured and simulation is off', async () => {
    delete process.env.PAYHERE_MERCHANT_ID
    const u = await verifiedCustomer()
    expect((await initiate(u, '00000000-0000-4000-8000-000000000000')).status).toBe(503)
  })
})

describe('PayHere notify (the only production path that confirms a booking)', () => {
  async function heldAndInitiated(price = 5000, phone = '0772223333') {
    const court = await db.court()
    const h = (8 + Math.floor(Math.random() * 10)).toString().padStart(2, '0')
    const s = await db.slot(court, colomboDate(4 + Math.floor(Math.random() * 20)), `${h}:00`, `${+h + 1}:00`, 'full_court', { price })
    const u = await verifiedCustomer(phone)
    await db.hold(u, s)
    const { body } = await initiate(u, s)
    return { s, u, order: body.fields.order_id as string, amount: body.fields.amount as string }
  }

  it('valid notification confirms once; SMS + email sent once; retries are no-ops', async () => {
    const { s, order, amount } = await heldAndInitiated(5000, '0772223333')
    const r1 = await payNotify(notifyRequest({ order, amount, paymentId: 'P1' }))
    expect(r1.status).toBe(200)
    expect((await db.slotRow(s)).status).toBe('booked')
    expect(smsTo('94772223333')).toHaveLength(1)
    expect(emails()).toHaveLength(1)
    expect(emails()[0].headers['Idempotency-Key']).toBe(`email:booking_confirmed:${order}`)

    const r2 = await payNotify(notifyRequest({ order, amount, paymentId: 'P1' }))
    expect(r2.status).toBe(200)
    expect(smsTo('94772223333')).toHaveLength(1)
    expect((await db.su.query(`select count(*)::int n from public.bookings where idempotency_key = $1`, [order])).rows[0].n).toBe(1)
    const stored = (await db.su.query(`select payload from public.payment_events where order_id = $1`, [order])).rows[0].payload
    expect(JSON.stringify(stored)).not.toContain('JANE')
  })

  it('rejects forged notifications: bad signature, wrong merchant, tampered amount', async () => {
    const { s, order, amount } = await heldAndInitiated()
    expect((await payNotify(notifyRequest({ order, amount, secret: 'guessed' }))).status).toBe(400)
    expect((await payNotify(notifyRequest({ order, amount, merchant: '999' }))).status).toBe(400)
    // correctly signed by "someone" but for a lower amount -> amount mismatch, never confirmed
    expect((await payNotify(notifyRequest({ order, amount: '1.00' }))).status).toBe(200)
    expect((await db.slotRow(s)).status).toBe('locked')
    expect(smsTo('94770000009').length).toBeGreaterThan(0) // critical alert SMS
  })

  it('late success after the hold expired: no booking, customer told, owner alerted, refund queued', async () => {
    const { s, order, amount } = await heldAndInitiated(3000, '0772224444')
    await db.expireHold(s)
    expect((await payNotify(notifyRequest({ order, amount }))).status).toBe(200)
    expect((await db.slotRow(s)).status).not.toBe('booked')
    expect((smsTo('94772224444')[0].body.message as string)).toContain('NOT confirmed')
    expect(smsTo('94770000009').length).toBeGreaterThan(0)
    expect((await db.su.query(`select r.status from public.refunds r join public.payment_attempts a on a.id = r.payment_attempt_id where a.order_id = $1`, [order])).rows[0].status).toBe('pending')
  })

  it('malformed bodies are rejected', async () => {
    const r = await payNotify(new Request(`${SITE}/api/payments/payhere/notify`, { method: 'POST', body: 'order_id=x' }))
    expect(r.status).toBe(400)
  })
})

describe('payment simulation is impossible in production', () => {
  it('returns 404 unless explicitly enabled outside production', async () => {
    const u = await verifiedCustomer()
    expect((await paySimulate(req('/api/payments/simulate', { orderId: 'x', outcome: 'success' }, { uid: u }))).status).toBe(404)
    process.env.PAYMENT_SIMULATION = 'enabled'
    process.env.VERCEL_ENV = 'production'
    delete process.env.ARENAGRADE_ENV
    expect((await paySimulate(req('/api/payments/simulate', { orderId: 'x', outcome: 'success' }, { uid: u }))).status).toBe(404)
    process.env.VERCEL_ENV = 'preview'
    process.env.PAYHERE_MODE = 'live'
    expect((await paySimulate(req('/api/payments/simulate', { orderId: 'x', outcome: 'success' }, { uid: u }))).status).toBe(404)
  })

  it('in a test environment it uses the same confirmation path, only for the caller\'s own simulator order', async () => {
    process.env.PAYMENT_SIMULATION = 'enabled'
    process.env.PAYHERE_MODE = 'sandbox' // simulation is never allowed with PAYHERE_MODE=live
    delete process.env.PAYHERE_MERCHANT_ID
    const court = await db.court()
    const s = await db.slot(court, colomboDate(9), '09:00', '10:00', 'full_court', { price: 2500 })
    const u = await db.user({ role: 'super_admin', phoneVerified: true, phone: '0773334444' }) // test payments are admin-only
    await db.hold(u, s)
    const init = await initiate(u, s)
    expect(init.body.mode).toBe('simulation')
    const other = await db.user({ role: 'super_admin', phoneVerified: true })
    expect((await paySimulate(req('/api/payments/simulate', { orderId: init.body.order_id, outcome: 'success' }, { uid: other }))).status).toBe(404)
    const r = await paySimulate(req('/api/payments/simulate', { orderId: init.body.order_id, outcome: 'success' }, { uid: u }))
    expect((await r.json()).result).toBe('confirmed')
    expect((await db.slotRow(s)).status).toBe('booked')
  })
})

describe('cancellations and admin decisions', () => {
  async function confirmedBooking(phone: string) {
    const court = await db.court()
    const s = await db.slot(court, colomboDate(15), '18:00', '19:00', 'full_court', { price: 6000 })
    const u = await verifiedCustomer(phone)
    await db.hold(u, s)
    const { body } = await initiate(u, s)
    await payNotify(notifyRequest({ order: body.fields.order_id, amount: body.fields.amount }))
    const b = (await db.su.query(`select id from public.bookings where idempotency_key = $1`, [body.fields.order_id])).rows[0]
    return { u, s, bookingId: b.id as string }
  }

  it('customer request: ownership enforced, admin alerted once', async () => {
    const { u, bookingId } = await confirmedBooking('0774445555')
    const intruder = await db.user()
    expect((await cancelBooking(req(`/api/bookings/${bookingId}/cancel`, { reason: 'mine now' }, { uid: intruder }), params(bookingId))).status).toBe(404)
    sent = []
    const r = await cancelBooking(req(`/api/bookings/${bookingId}/cancel`, { reason: 'Team travelling' }, { uid: u }), params(bookingId))
    expect(await r.json()).toEqual({ status: 'requested' })
    expect(smsTo('94770000001')).toHaveLength(1)
    const again = await cancelBooking(req(`/api/bookings/${bookingId}/cancel`, { reason: 'again' }, { uid: u }), params(bookingId))
    expect(await again.json()).toEqual({ status: 'already_requested' })
    expect(smsTo('94770000001')).toHaveLength(1)
  })

  it('only admins decide; approval notifies the customer and refunds need a bank reference', async () => {
    const { u, s, bookingId } = await confirmedBooking('0774446666')
    await cancelBooking(req(`/api/bookings/${bookingId}/cancel`, { reason: 'Injury' }, { uid: u }), params(bookingId))
    expect((await adminDecision(req(`/api/admin/bookings/${bookingId}/decision`, { decision: 'approve' }, { uid: u }), params(bookingId))).status).toBe(403)

    const admin = await db.user({ role: 'super_admin' })
    sent = []
    const r = await adminDecision(req(`/api/admin/bookings/${bookingId}/decision`, { decision: 'approve' }, { uid: admin }), params(bookingId))
    const body = await r.json()
    expect(body.status).toBe('decided')
    expect(smsTo('94774446666')).toHaveLength(1)
    expect((await db.slotRow(s)).status).toBe('available')

    const noRef = await adminRefund(req(`/api/admin/refunds/${body.refund_id}`, { status: 'completed' }, { uid: admin }), params(body.refund_id))
    expect(await noRef.json()).toEqual({ error: 'bank_reference_required' })
    const done = await adminRefund(req(`/api/admin/refunds/${body.refund_id}`, { status: 'completed', bank_reference: 'BOC-991' }, { uid: admin }), params(body.refund_id))
    expect(await done.json()).toEqual({ changed: true, status: 'completed' })
    expect((await adminRefund(req(`/api/admin/refunds/${body.refund_id}`, { status: 'completed', bank_reference: 'x' }, { uid: u }), params(body.refund_id))).status).toBe(403)
  })
})

describe('daily report cron', () => {
  const cronReq = (q = '', auth = `Bearer ${BASE_ENV.CRON_SECRET}`) =>
    new Request(`${SITE}/api/cron/daily-report${q}`, { headers: auth ? { authorization: auth } : {} })

  it('rejects calls without the cron secret', async () => {
    expect((await dailyReport(cronReq('', ''))).status).toBe(401)
    expect((await dailyReport(cronReq('', 'Bearer wrong-secret-value-xxxxx'))).status).toBe(401)
  })

  it('sends once per report day even when invoked repeatedly; force resends', async () => {
    const r1 = await (await dailyReport(cronReq())).json()
    expect(r1.ok).toBe(true)
    const firstEmails = emails().length
    expect(firstEmails).toBeGreaterThanOrEqual(1) // today's report (+ yesterday catch-up)
    expect(emails()[0].body.to).toEqual(['owner@gmail.com', 'admin@gmail.com'])
    expect(String(emails()[0].body.subject)).toMatch(/^ArenaGrade Daily Operations Report — \d{4}-\d{2}-\d{2}$/)

    const r2 = await (await dailyReport(cronReq())).json()
    expect(r2.results.every((x: { status: string }) => x.status === 'skipped_succeeded')).toBe(true)
    expect(emails().length).toBe(firstEmails)

    const day = r1.results[r1.results.length - 1].period
    const r3 = await (await dailyReport(cronReq(`?period=${day}&force=1`))).json()
    expect(r3.results[0].status).toBe('succeeded')
    expect(emails().length).toBe(firstEmails + 1)
  })

  it('records a failed delivery and alerts by SMS (not by the failing email channel)', async () => {
    resendMode = 'fail'
    const day = '2026-01-15'
    const r = await (await dailyReport(cronReq(`?period=${day}`))).json()
    expect(r.ok).toBe(false)
    const job = (await db.su.query(`select status, last_error from public.job_runs where period_key = $1`, [day])).rows[0]
    expect(job.status).toBe('failed')
    expect(smsTo('94770000009').length).toBeGreaterThan(0)
    // a later rerun recovers
    resendMode = 'ok'
    const again = await (await dailyReport(cronReq(`?period=${day}`))).json()
    expect(again.results[0].status).toBe('succeeded')
  })
})

describe('health', () => {
  it('reports ok', async () => {
    expect(await (await health()).json()).toEqual({ ok: true })
  })
})

describe('two-hour Solo Court reservation through the API', () => {
  it('initiate charges LKR 5,000 for both hours; notify confirms both; SMS shows the full range', async () => {
    const court = (await db.su.query(
      `insert into public.courts (name, has_half_court, operating_start, operating_end, slot_duration_hrs, max_consecutive_slots)
       values ('The Solo Court', false, '05:00', '22:00', 1, 2) returning id`)).rows[0].id
    const d = colomboDate(25)
    const a = await db.slot(court, d, '18:00', '19:00', 'full_court', { price: 2500 })
    const b = await db.slot(court, d, '19:00', '20:00', 'full_court', { price: 2500 })
    const u = await verifiedCustomer('0775556666')
    await db.as('authenticated', u, `select public.hold_slots($1::uuid[])`, [[a, b]])

    const { body } = await initiate(u, b) // any hour of the reservation
    expect(body.fields.amount).toBe('5000.00')
    const r = await payNotify(notifyRequest({ order: body.fields.order_id, amount: body.fields.amount }))
    expect(r.status).toBe(200)
    expect((await db.slotRow(a)).status).toBe('booked')
    expect((await db.slotRow(b)).status).toBe('booked')
    const msg = smsTo('94775556666')[0].body.message as string
    expect(msg).toContain('18:00-20:00')
    expect(msg).toContain('5,000')
  })
})
