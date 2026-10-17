import { db } from '@/lib/server/db'
import { env } from '@/lib/server/env'
import { authenticate, correlationId, json, readJson, sameOrigin, unauthorized, dbErrorResponse } from '@/lib/server/http'
import { sendSms } from '@/lib/server/notify/sms'
import { sendEmail } from '@/lib/server/notify/email'
import { sms, cancellationApprovedEmail, cancellationRejectedEmail } from '@/lib/server/notify/templates'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Decision = {
  changed: boolean; decision: 'approve' | 'reject'; refund_id?: string | null; user_id: string
  customer_phone: string | null; court_name: string | null; slot_date: string; start_time: string; amount: string
}

// POST /api/admin/bookings/:id/decision  { decision: 'approve' | 'reject', note? }
// Runs as the signed-in user; the database rejects anyone who is not a
// super_admin. Customer notifications go out only after the decision is
// committed, and an SMS failure never reverses it.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cid = correlationId(req)
  if (!sameOrigin(req, env.siteUrl())) return json({ error: 'forbidden' }, 403)
  const auth = await authenticate(req)
  if (!auth) return unauthorized()
  const { id } = await ctx.params
  const body = await readJson<{ decision?: unknown; note?: unknown }>(req)
  const decision = body?.decision
  if (!UUID.test(id) || (decision !== 'approve' && decision !== 'reject')) return json({ error: 'invalid_input' }, 400)
  const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null

  try {
    const r = await db().rpcAsUser<Decision>(auth.token, 'admin_decide_cancellation', { p_booking_id: id, p_decision: decision, p_note: note })
    let notified: string = 'not_needed'
    if (r.changed) {
      const stamp = new Date().toISOString().slice(0, 16)
      const whatsapp = env.refundWhatsapp() ?? 'our WhatsApp number'
      const text = decision === 'approve' ? sms.cancellationApproved(r, whatsapp) : sms.cancellationRejected(r)
      const res = await sendSms({
        template: `cancellation_${decision}`, to: r.customer_phone, body: text,
        idempotencyKey: `sms:cancel_${decision}:${id}:${stamp}`, relatedType: 'booking', relatedId: id,
      })
      notified = res.status
      const email = await db().getUserEmail(r.user_id)
      if (email) {
        const m = decision === 'approve' ? cancellationApprovedEmail(r, whatsapp) : cancellationRejectedEmail(r)
        await sendEmail({
          template: `cancellation_${decision}`, to: [email], subject: m.subject, html: m.html, text: m.text,
          idempotencyKey: `email:cancel_${decision}:${id}:${stamp}`, relatedType: 'booking', relatedId: id,
        })
      }
    }
    return json({ status: r.changed ? 'decided' : 'unchanged', decision, refund_id: r.refund_id ?? null, customer_sms: notified })
  } catch (e) {
    return dbErrorResponse(e, cid, { forbidden: 403, booking_not_found: 404, booking_not_pending_cancellation: 409, invalid_decision: 400 })
  }
}
