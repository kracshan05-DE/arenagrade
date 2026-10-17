import 'server-only'
import { db } from '../db'
import { env, isProduction } from '../env'
import { log, maskRecipient } from '../log'

// Resend (https://resend.com/docs). Uses Resend's Idempotency-Key header (kept
// 24h by Resend) plus our own notification_log claim, so retries never send a
// logical email twice. "accepted" = Resend accepted it, not "delivered".

const RESEND_URL = 'https://api.resend.com/emails'
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

export type EmailResult =
  | { status: 'accepted'; providerId: string | null }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: 'duplicate' | 'not_configured' | 'invalid_recipient' }

export async function sendEmail(opts: {
  template: string; to: string[]; subject: string; html: string; text: string; idempotencyKey: string
  relatedType?: string; relatedId?: string
}): Promise<EmailResult> {
  const to = opts.to.filter((x) => EMAIL_RE.test(x))
  if (!to.length) return { status: 'skipped', reason: 'invalid_recipient' }
  const subject = opts.subject.replace(/[\r\n]+/g, ' ').slice(0, 200) // no header injection

  try {
    const claim = await db().rpcAsService<{ claimed: boolean }>('notification_claim', {
      p_channel: 'email', p_template: opts.template, p_recipient_masked: to.map(maskRecipient).join(','),
      p_related_type: opts.relatedType ?? null, p_related_id: opts.relatedId ?? null, p_idempotency_key: opts.idempotencyKey,
    })
    if (!claim.claimed) return { status: 'skipped', reason: 'duplicate' }
  } catch (e) {
    log('error', 'email_claim_failed', { template: opts.template, error: (e as Error).message })
    return { status: 'failed', error: 'claim_failed' }
  }

  let result: EmailResult
  const apiKey = env.resendApiKey()
  if (!apiKey) {
    result = isProduction() ? { status: 'failed', error: 'email_not_configured' } : { status: 'skipped', reason: 'not_configured' }
  } else {
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': opts.idempotencyKey.slice(0, 256) },
        body: JSON.stringify({ from: env.emailFrom(), to, subject, html: opts.html, text: opts.text }),
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await res.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null
      result = res.ok
        ? { status: 'accepted', providerId: body?.id ?? null }
        : { status: 'failed', error: `resend_${res.status}:${String(body?.name ?? body?.message ?? '').slice(0, 120)}` }
    } catch (e) {
      result = { status: 'failed', error: `resend_network:${(e as Error).name}` }
    }
  }

  await db().rpcAsService('notification_finish', {
    p_idempotency_key: opts.idempotencyKey,
    p_status: result.status,
    p_provider_message_id: result.status === 'accepted' ? result.providerId : null,
    p_error: result.status === 'failed' ? result.error : result.status === 'skipped' ? result.reason : null,
  }).catch((e) => log('error', 'email_finish_failed', { error: (e as Error).message }))

  log(result.status === 'failed' ? 'warn' : 'info', 'email_result', { template: opts.template, status: result.status })
  return result
}
