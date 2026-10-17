import { describe, it, expect } from 'vitest'
import { checkoutHash, notifySignature, verifyNotification, parseNotification, formatAmount, sanitizedPayload } from '@/lib/server/payhere'
import { normalizeSriLankanMobile } from '@/lib/phone'
import { safeRedirectPath } from '@/lib/safeRedirect'
import { latestCompletedReportDay, reportWindow, previousDay, isValidDay } from '@/lib/server/reportPeriod'
import { escapeHtml, sms, dailyReportEmail, bookingConfirmedEmail } from '@/lib/server/notify/templates'
import { generateOtp, hashOtp } from '@/lib/server/otp'

describe('PayHere signatures (reference values computed independently with Python hashlib)', () => {
  it('checkout hash', () => {
    expect(checkoutHash('1211149', 'ItemNo12345', '1000.00', 'LKR', 'MySecret123')).toBe('67592FA10915DC796B49B21604867710')
  })
  it('notify md5sig', () => {
    expect(notifySignature({ merchantId: '1211149', orderId: 'ItemNo12345', amount: '1000.00', currency: 'LKR', statusCode: '2', merchantSecret: 'MySecret123' }))
      .toBe('4A3A4CD677B9DA257F1162EFC432726F')
  })
  const form = (over: Record<string, string> = {}) => new URLSearchParams({
    merchant_id: '1211149', order_id: 'ItemNo12345', payment_id: '320025071278', payhere_amount: '1000.00',
    payhere_currency: 'LKR', status_code: '2', md5sig: '4A3A4CD677B9DA257F1162EFC432726F', method: 'VISA',
    card_holder_name: 'JANE DOE', card_no: '************1234', ...over,
  })
  it('accepts a correct notification and rejects tampering', () => {
    expect(verifyNotification(parseNotification(form())!, '1211149', 'MySecret123')).toBe(true)
    expect(verifyNotification(parseNotification(form({ payhere_amount: '10.00' }))!, '1211149', 'MySecret123')).toBe(false)
    expect(verifyNotification(parseNotification(form({ status_code: '0' }))!, '1211149', 'MySecret123')).toBe(false)
    expect(verifyNotification(parseNotification(form())!, '9999999', 'MySecret123')).toBe(false)
    expect(verifyNotification(parseNotification(form())!, '1211149', 'WrongSecret')).toBe(false)
    expect(verifyNotification(parseNotification(form({ md5sig: 'abc' }))!, '1211149', 'MySecret123')).toBe(false)
  })
  it('rejects malformed notifications and never stores card details', () => {
    expect(parseNotification(new URLSearchParams({ order_id: 'x' }))).toBeNull()
    expect(parseNotification(form({ status_code: 'two' }))).toBeNull()
    const p = sanitizedPayload(parseNotification(form())!)
    const json = JSON.stringify(p)
    expect(json).not.toContain('JANE')
    expect(json).not.toContain('************1234')
    expect(Object.keys(p).some((k) => k.startsWith('card'))).toBe(false)
  })
  it('formats amounts with two decimals and refuses invalid ones', () => {
    expect(formatAmount(1000)).toBe('1000.00')
    expect(formatAmount('2500.5')).toBe('2500.50')
    expect(() => formatAmount(0)).toThrow()
    expect(() => formatAmount('abc')).toThrow()
  })
})

describe('phone normalisation', () => {
  it.each([
    ['0771234567', '0771234567', '94771234567'],
    ['771234567', '0771234567', '94771234567'],
    ['+94 77 123 4567', '0771234567', '94771234567'],
    ['94771234567', '0771234567', '94771234567'],
  ])('%s', (input, local, international) => {
    expect(normalizeSriLankanMobile(input)).toEqual({ local, international })
  })
  it.each(['0112345678', '07712345', '077123456789', 'abc', '', '+1 555 0100'])('rejects %s', (input) => {
    expect(normalizeSriLankanMobile(input)).toBeNull()
  })
})

describe('open redirect protection', () => {
  it.each([
    ['/booking/abc', '/booking/abc'],
    ['/my-bookings?x=1', '/my-bookings?x=1'],
    ['https://evil.example', '/'],
    ['//evil.example/path', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['%2F%2Fevil.example', '/'],
    [null, '/'],
  ])('%s -> %s', (input, out) => {
    expect(safeRedirectPath(input as string | null)).toBe(out)
  })
})

describe('daily report periods (Asia/Colombo)', () => {
  it('before 22:00 Colombo the latest complete day is yesterday', () => {
    expect(latestCompletedReportDay(new Date('2026-10-18T16:29:00Z'))).toBe('2026-10-17') // 21:59 Colombo
  })
  it('from 22:00 Colombo the latest complete day is today', () => {
    expect(latestCompletedReportDay(new Date('2026-10-18T16:30:00Z'))).toBe('2026-10-18') // 22:00 Colombo
    expect(latestCompletedReportDay(new Date('2026-10-18T17:59:00Z'))).toBe('2026-10-18') // Vercel Hobby window
  })
  it('a report day covers 22:00 the previous day to 22:00 that day', () => {
    const w = reportWindow('2026-10-18')
    expect(w.from.toISOString()).toBe('2026-10-17T16:30:00.000Z')
    expect(w.to.toISOString()).toBe('2026-10-18T16:30:00.000Z')
  })
  it('handles month boundaries and validates input', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28')
    expect(isValidDay('2026-02-30')).toBe(false)
    expect(isValidDay('2026-10-18')).toBe(true)
    expect(isValidDay('18-10-2026')).toBe(false)
  })
})

describe('templates escape user input', () => {
  it('HTML-escapes names in emails', () => {
    const m = bookingConfirmedEmail({ court_name: '<script>alert(1)</script>', court_type: 'full_court', slot_date: '2026-10-20',
      start_time: '09:00', end_time: '10:00', amount: '5000.00', reference: 'AG1"><img>' }, 'https://arenagrade.lk')
    expect(m.html).not.toContain('<script>')
    expect(m.html).not.toContain('"><img>')
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
  })
  it('strips control characters from SMS text', () => {
    const t = sms.cancellationRejected({ court_name: 'Court\nInjected: line', slot_date: '2026-10-20', start_time: '09:00' })
    expect(t).not.toContain('\n')
  })
  it('daily report states explicitly when nothing happened', () => {
    const empty = { period: { from: 'a', to: 'b' }, payments: {}, bookings: {}, refunds: {}, court_operations: {}, integrity: {}, technical: {}, admin: {} }
    const m = dailyReportEmail(empty as never, '2026-10-18', 'https://arenagrade.lk')
    expect(m.subject).toBe('ArenaGrade Daily Operations Report — 2026-10-18')
    expect(m.html).toContain('There were no bookings, payments or incidents in this period.')
    expect(m.actionCount).toBe(0)
  })
  it('daily report raises an action item for paid-but-unconfirmed payments', () => {
    const r = { period: { from: 'a', to: 'b' }, payments: { paid_unconfirmed_open: [{ order_id: 'AG1', amount_lkr: 5000 }] },
      bookings: {}, refunds: { awaiting_action_count: 1, awaiting_action_lkr: 5000 }, court_operations: {}, integrity: {}, technical: {}, admin: {} }
    const m = dailyReportEmail(r as never, '2026-10-18', 'https://arenagrade.lk')
    expect(m.actionCount).toBe(2)
    expect(m.html).toContain('Action required')
  })
})

describe('OTP primitives', () => {
  it('generates 6-digit codes and binds hashes to user and phone', () => {
    const codes = new Set(Array.from({ length: 200 }, generateOtp))
    for (const c of codes) expect(c).toMatch(/^\d{6}$/)
    expect(codes.size).toBeGreaterThan(190)
    const h = hashOtp('secret', 'user-a', '0771234567', '123456')
    expect(hashOtp('secret', 'user-b', '0771234567', '123456')).not.toBe(h)
    expect(hashOtp('secret', 'user-a', '0779999999', '123456')).not.toBe(h)
    expect(hashOtp('other', 'user-a', '0771234567', '123456')).not.toBe(h)
  })
})
