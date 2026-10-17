import { timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/server/db'
import { env } from '@/lib/server/env'
import { correlationId, json } from '@/lib/server/http'
import { sendEmail } from '@/lib/server/notify/email'
import { dailyReportEmail } from '@/lib/server/notify/templates'
import { recordEvent } from '@/lib/server/alerts'
import { log } from '@/lib/server/log'
import { isValidDay, latestCompletedReportDay, previousDay, reportWindow } from '@/lib/server/reportPeriod'

export const maxDuration = 60

const JOB = 'daily_report'

function authorized(req: Request) {
  const secret = env.cronSecret()
  if (!secret || secret.length < 16) return false
  const got = Buffer.from(req.headers.get('authorization') ?? '')
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

// GET /api/cron/daily-report[?period=YYYY-MM-DD&force=1]
// Triggered by Vercel Cron (and optionally Supabase pg_cron) with
// "Authorization: Bearer $CRON_SECRET". Tolerates duplicate, overlapping and
// missed invocations: each report day is claimed once in job_runs, and a run
// also catches up the previous day if it never succeeded. force=1 resends a
// specific day (manual rerun).
export async function GET(req: Request) {
  const cid = correlationId(req)
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const url = new URL(req.url)
  const explicit = url.searchParams.get('period')
  const force = url.searchParams.get('force') === '1'
  const latest = latestCompletedReportDay(new Date())
  if (explicit && (!isValidDay(explicit) || explicit > latest)) return json({ error: 'invalid_period' }, 400)
  const days = explicit ? [explicit] : [previousDay(latest), latest]

  const recipients = env.reportRecipients()
  const out: { period: string; status: string; detail?: string }[] = []
  let housekeepingDone = false

  for (const day of days) {
    const claim = await db().rpcAsService<{ claimed: boolean; status: string; attempts: number }>('job_claim', {
      p_job_name: JOB, p_period_key: day, p_force: Boolean(explicit && force), p_stale_seconds: 900,
    })
    if (!claim.claimed) { out.push({ period: day, status: `skipped_${claim.status}` }); continue }

    try {
      if (!housekeepingDone) {
        await db().rpcAsService('daily_housekeeping', {})
        housekeepingDone = true
      }
      if (!recipients.length) throw new Error('no_recipients_configured')
      const { from, to } = reportWindow(day)
      const window = { p_from: from.toISOString(), p_to: to.toISOString() }
      const report = await db().rpcAsService<Parameters<typeof dailyReportEmail>[0]>('report_daily', window)
      report.bookings_by_court = await db().rpcAsService<Record<string, unknown>>('report_bookings_by_court', window)
      const m = dailyReportEmail(report, day, env.siteUrl())
      const sent = await sendEmail({
        template: 'daily_report', to: recipients, subject: m.subject, html: m.html, text: m.text,
        idempotencyKey: `email:daily_report:${day}${force ? `:r${claim.attempts}` : ''}`, relatedType: 'job', relatedId: `${JOB}:${day}`,
      })
      if (sent.status === 'failed') throw new Error(`email_${sent.error}`)
      await db().rpcAsService('job_finish', {
        p_job_name: JOB, p_period_key: day, p_status: 'succeeded', p_error: null,
        p_details: { email: sent.status, action_items: m.actionCount, from: from.toISOString(), to: to.toISOString() },
      })
      out.push({ period: day, status: 'succeeded', detail: sent.status })
    } catch (e) {
      const msg = (e as Error).message
      await db().rpcAsService('job_finish', { p_job_name: JOB, p_period_key: day, p_status: 'failed', p_error: msg, p_details: null })
        .catch((err) => log('error', 'job_finish_failed', { error: (err as Error).message }))
      // Critical → immediate SMS alert, independent of the failing email channel.
      await recordEvent({ severity: 'critical', category: 'scheduled_job', event: 'daily_report_failed', correlationId: day, details: { cid, error: msg } })
      out.push({ period: day, status: 'failed', detail: msg })
    }
  }
  return json({ ok: out.every((o) => o.status !== 'failed'), results: out })
}
