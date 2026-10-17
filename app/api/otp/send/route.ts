import { db } from '@/lib/server/db'
import { env } from '@/lib/server/env'
import { authenticate, clientIp, correlationId, json, readJson, sameOrigin, unauthorized, dbErrorResponse } from '@/lib/server/http'
import { generateOtp, hashIp, hashOtp } from '@/lib/server/otp'
import { textLkSend } from '@/lib/server/notify/sms'
import { sms } from '@/lib/server/notify/templates'
import { recordEvent, sendCriticalAlert } from '@/lib/server/alerts'
import { normalizeSriLankanMobile } from '@/lib/phone'

// POST /api/otp/send  { phone }
// Issues a one-time code for the signed-in user's phone. Code generation,
// hashing, limits and SMS dispatch all happen here on the server.
export async function POST(req: Request) {
  const cid = correlationId(req)
  if (!sameOrigin(req, env.siteUrl())) return json({ error: 'forbidden' }, 403)
  const auth = await authenticate(req)
  if (!auth) return unauthorized()

  const body = await readJson<{ phone?: unknown }>(req)
  const phone = normalizeSriLankanMobile(body?.phone)
  if (!phone) return json({ error: 'invalid_phone' }, 400)

  const profile = await db().getProfile(auth.user.id)
  if (profile?.phone_verified && profile.phone === phone.local) return json({ status: 'already_verified' })

  const secret = env.otpHashSecret()
  const code = generateOtp()
  try {
    const issued = await db().rpcAsService<{ allowed: boolean; reason?: string; retry_after_seconds?: number; challenge_id?: string }>(
      'otp_issue_challenge', {
        p_user_id: auth.user.id, p_phone: phone.local, p_code_hash: hashOtp(secret, auth.user.id, phone.local, code),
        p_ip_hash: hashIp(secret, clientIp(req)), p_daily_cap: env.smsDailyCap(),
      })
    if (!issued.allowed) {
      if (issued.reason === 'daily_cap') await sendCriticalAlert('otp_daily_cap_reached', cid)
      // Same response for every limit, so nothing about other users/numbers leaks.
      return json({ error: 'rate_limited', retry_after_seconds: issued.retry_after_seconds ?? 60 }, 429)
    }

    if (env.otpTestMode()) {
      await db().rpcAsService('otp_mark_sms', { p_challenge_id: issued.challenge_id, p_status: 'accepted', p_provider_message_id: 'test-mode' })
      return json({ status: 'sent', resend_after_seconds: 60, test_code: code })
    }

    const r = await textLkSend(phone.local, sms.otp(code))
    if (r.status === 'accepted') {
      await db().rpcAsService('otp_mark_sms', { p_challenge_id: issued.challenge_id, p_status: 'accepted', p_provider_message_id: r.providerId })
      return json({ status: 'sent', resend_after_seconds: 60 })
    }
    if (r.status === 'failed' && r.ambiguous) {
      // Provider timed out: the SMS may still arrive, so the code stays valid.
      await recordEvent({ severity: 'warning', category: 'sms', event: 'otp_send_timeout', correlationId: cid })
      return json({ status: 'sent', resend_after_seconds: 60, delayed: true })
    }
    await db().rpcAsService('otp_mark_sms', { p_challenge_id: issued.challenge_id, p_status: 'failed', p_provider_message_id: null })
    await recordEvent({
      severity: 'error', category: 'sms', event: 'otp_send_failed', correlationId: cid,
      details: { reason: r.status === 'failed' ? r.error : r.reason }, requiresAction: false,
    })
    return json({ error: 'sms_failed' }, 502)
  } catch (e) {
    return dbErrorResponse(e, cid, {})
  }
}
