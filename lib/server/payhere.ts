import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'

// PayHere Checkout API, per https://support.payhere.lk/api-&-mobile-sdk/checkout-api
//   checkout hash = UPPER(md5(merchant_id + order_id + amount + currency + UPPER(md5(merchant_secret))))
//   notify md5sig = UPPER(md5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPER(md5(merchant_secret))))
//   amount formatted with exactly two decimals, no thousands separator
//   status_code: 2 success, 0 pending, -1 cancelled, -2 failed, -3 chargedback
// The live URL must include "www".

export const PAYHERE_CHECKOUT_URL = {
  sandbox: 'https://sandbox.payhere.lk/pay/checkout',
  live: 'https://www.payhere.lk/pay/checkout',
} as const

const md5Upper = (s: string) => createHash('md5').update(s, 'utf8').digest('hex').toUpperCase()

export function formatAmount(amount: number | string) {
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n) || n <= 0) throw new Error('invalid_amount')
  return n.toFixed(2)
}

export function checkoutHash(merchantId: string, orderId: string, amount: string, currency: string, merchantSecret: string) {
  return md5Upper(merchantId + orderId + amount + currency + md5Upper(merchantSecret))
}

export function notifySignature(p: {
  merchantId: string; orderId: string; amount: string; currency: string; statusCode: string; merchantSecret: string
}) {
  return md5Upper(p.merchantId + p.orderId + p.amount + p.currency + p.statusCode + md5Upper(p.merchantSecret))
}

export interface PayhereNotification {
  merchant_id: string
  order_id: string
  payment_id: string | null
  payhere_amount: string
  payhere_currency: string
  status_code: string
  md5sig: string
  method: string | null
  status_message: string | null
}

/** Parse a notify POST body. Returns null if a required field is missing. */
export function parseNotification(form: URLSearchParams): PayhereNotification | null {
  const get = (k: string) => {
    const v = form.get(k)
    return v === null ? null : v.trim()
  }
  const required = ['merchant_id', 'order_id', 'payhere_amount', 'payhere_currency', 'status_code', 'md5sig'] as const
  for (const k of required) if (!get(k)) return null
  if (!/^-?\d+$/.test(get('status_code')!)) return null
  if (get('order_id')!.length > 64) return null
  return {
    merchant_id: get('merchant_id')!,
    order_id: get('order_id')!,
    payment_id: get('payment_id'),
    payhere_amount: get('payhere_amount')!,
    payhere_currency: get('payhere_currency')!,
    status_code: get('status_code')!,
    md5sig: get('md5sig')!,
    method: get('method'),
    status_message: get('status_message'),
  }
}

/** Constant-time signature + merchant check. */
export function verifyNotification(n: PayhereNotification, merchantId: string, merchantSecret: string) {
  if (n.merchant_id !== merchantId) return false
  const expected = notifySignature({
    merchantId, orderId: n.order_id, amount: n.payhere_amount, currency: n.payhere_currency,
    statusCode: n.status_code, merchantSecret,
  })
  const a = Buffer.from(expected)
  const b = Buffer.from(n.md5sig.toUpperCase())
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Fields safe to persist: card holder name, card number mask and expiry are dropped. */
export function sanitizedPayload(n: PayhereNotification) {
  return {
    order_id: n.order_id, payment_id: n.payment_id, payhere_amount: n.payhere_amount,
    payhere_currency: n.payhere_currency, status_code: n.status_code, method: n.method,
    status_message: n.status_message?.slice(0, 200) ?? null,
  }
}
