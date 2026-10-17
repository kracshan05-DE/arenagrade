import 'server-only'
import { db } from './db'
import { env } from './env'
import { log } from './log'
import { sendSms } from './notify/sms'
import { sms } from './notify/templates'

export type Severity = 'info' | 'warning' | 'error' | 'critical'

/**
 * Record an operational event (app_events) and a structured log line.
 * Critical events also trigger an immediate SMS alert — a different channel
 * from email, so an email outage can still be reported. Alerts are throttled
 * to one per event type per hour.
 */
export async function recordEvent(opts: {
  severity: Severity; category: string; event: string; correlationId?: string | null
  details?: Record<string, unknown>; requiresAction?: boolean; alreadyStored?: boolean
}) {
  log(opts.severity === 'critical' || opts.severity === 'error' ? 'error' : 'warn', `${opts.category}.${opts.event}`, {
    cid: opts.correlationId ?? null, ...(opts.details ?? {}),
  })
  if (!opts.alreadyStored) {
    try {
      await db().rpcAsService('record_app_event', {
        p_severity: opts.severity, p_category: opts.category, p_event: opts.event,
        p_correlation_id: opts.correlationId ?? null, p_details: opts.details ?? {},
        p_requires_action: opts.requiresAction ?? opts.severity === 'critical',
      })
    } catch (e) {
      log('error', 'record_event_failed', { event: opts.event, error: (e as Error).message })
    }
  }
  if (opts.severity === 'critical') await sendCriticalAlert(opts.event, opts.correlationId ?? null)
}

export async function sendCriticalAlert(event: string, ref: string | null) {
  const hour = new Date().toISOString().slice(0, 13)
  for (const phone of env.criticalAlertPhones()) {
    await sendSms({
      template: 'critical_alert', to: phone, body: sms.criticalAlert(event, ref),
      idempotencyKey: `alert:${event}:${hour}:${phone.slice(-4)}`, relatedType: 'alert', relatedId: ref ?? event,
    })
  }
}
