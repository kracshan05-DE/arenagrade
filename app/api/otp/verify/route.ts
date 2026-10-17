import { db } from '@/lib/server/db'
import { env } from '@/lib/server/env'
import { authenticate, clientIp, correlationId, json, readJson, sameOrigin, unauthorized, dbErrorResponse } from '@/lib/server/http'
import { hashIp, hashOtp } from '@/lib/server/otp'
import { normalizeSriLankanMobile } from '@/lib/phone'

// POST /api/otp/verify  { phone, code }
// One-time verification; on success the database marks this user's profile
// verified for exactly this phone number.
export async function POST(req: Request) {
  const cid = correlationId(req)
  if (!sameOrigin(req, env.siteUrl())) return json({ error: 'forbidden' }, 403)
  const auth = await authenticate(req)
  if (!auth) return unauthorized()

  const body = await readJson<{ phone?: unknown; code?: unknown }>(req)
  const phone = normalizeSriLankanMobile(body?.phone)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!phone || !/^\d{6}$/.test(code)) return json({ error: 'invalid_input' }, 400)

  const secret = env.otpHashSecret()
  try {
    // Extra brake on guessing across many codes from one network.
    const ipKey = hashIp(secret, clientIp(req)) ?? 'unknown'
    const limit = await db().rpcAsService<{ allowed: boolean; retry_after_seconds: number }>('rate_limit_hit', {
      p_key: `otp_verify:${ipKey}`, p_window_seconds: 3600, p_max: 30,
    })
    if (!limit.allowed) return json({ error: 'rate_limited', retry_after_seconds: limit.retry_after_seconds }, 429)

    const r = await db().rpcAsService<{ ok: boolean; reason: string | null; attempts_left: number | null }>('otp_verify_challenge', {
      p_user_id: auth.user.id, p_phone: phone.local, p_code_hash: hashOtp(secret, auth.user.id, phone.local, code),
    })
    if (r.ok) return json({ status: 'verified' })
    return json({ error: r.reason, attempts_left: r.attempts_left }, 400)
  } catch (e) {
    return dbErrorResponse(e, cid, { profile_missing: 409 })
  }
}
