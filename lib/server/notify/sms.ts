import 'server-only'
import { db } from '../db'
import { env, isProduction } from '../env'
import { log, maskRecipient } from '../log'
import { normalizeSriLankanMobile } from '@/lib/phone'

// Text.lk SMS (https://text.lk/docs/send-sms/). Success requires HTTP 2xx AND
// body.status === "success"; Text.lk can answer an error with a 200, which the
// old code counted as sent. A success means "accepted by the provider", not
// "delivered to the handset".

const TEXT_LK_URL = 'https://app.text.lk/api/v3/sms/send'
const TIMEOUT_MS = 10_000

export type SmsResult =
  | { status: 'accepted'; providerId: string | null }
  | { status: 'failed'; error: string; ambiguous?: boolean }
  | { status: 'skipped'; reason: 'duplicate' | 'not_configured' | 'invalid_number' }

/** Low-level send. No logging of the message body (it may contain an OTP). */
export async function textLkSend(to: string, message: string): Promise<SmsResult> {
  const phone = normalizeSriLankanMobile(to)
  if (!phone) return { status: 'skipped', reason: 'invalid_number' }
  const apiKey = env.textLkApiKey()
  if (!apiKey) {
    if (isProduction()) return { status: 'failed', error: 'sms_not_configured' }
    log('info', 'sms_dev_skip', { to: maskRecipient(phone.local) })
    return { status: 'skipped', reason: 'not_configured' }
  }
  try {
    const res = await fetch(TEXT_LK_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ recipient: phone.international, sender_id: env.textLkSenderId(), type: 'plain', message }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.json().catch(() => null)) as { status?: string; message?: string; data?: { uid?: string } } | null
    if (res.ok && body?.status === 'success') return { status: 'accepted', providerId: body.data?.uid ?? null }
    return { status: 'failed', error: `textlk_${res.status}:${String(body?.message ?? 'unknown').slice(0, 120)}` }
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    // A timeout is ambiguous: the provider may still send the message.
    return { status: 'failed', error: timeout ? 'textlk_timeout' : 'textlk_network_error', ambiguous: timeout }
  }
}

/**
 * Send a notification SMS at most once per idempotency key (a failed attempt
 * may be retried with the same key). Never throws: callers must not undo a
 * committed business decision because an SMS failed.
 */
export async function sendSms(opts: {
  template: string; to: string | null | undefined; body: string; idempotencyKey: string
  relatedType?: string; relatedId?: string
}): Promise<SmsResult> {
  if (!opts.to) return { status: 'skipped', reason: 'invalid_number' }
  try {
    const claim = await db().rpcAsService<{ claimed: boolean }>('notification_claim', {
      p_channel: 'sms', p_template: opts.template, p_recipient_masked: maskRecipient(opts.to),
      p_related_type: opts.relatedType ?? null, p_related_id: opts.relatedId ?? null, p_idempotency_key: opts.idempotencyKey,
    })
    if (!claim.claimed) return { status: 'skipped', reason: 'duplicate' }
  } catch (e) {
    log('error', 'sms_claim_failed', { template: opts.template, error: (e as Error).message })
    return { status: 'failed', error: 'claim_failed' }
  }

  const r = await textLkSend(opts.to, opts.body)
  const status = r.status === 'accepted' ? 'accepted' : r.status === 'skipped' ? 'skipped' : 'failed'
  await db().rpcAsService('notification_finish', {
    p_idempotency_key: opts.idempotencyKey, p_status: status,
    p_provider_message_id: r.status === 'accepted' ? r.providerId : null,
    p_error: r.status === 'failed' ? r.error : r.status === 'skipped' ? r.reason : null,
  }).catch((e) => log('error', 'sms_finish_failed', { error: (e as Error).message }))

  log(status === 'failed' ? 'warn' : 'info', 'sms_result', { template: opts.template, status, to: maskRecipient(opts.to) })
  return r
}
