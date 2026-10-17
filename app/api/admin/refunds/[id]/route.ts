import { db } from '@/lib/server/db'
import { env } from '@/lib/server/env'
import { authenticate, correlationId, json, readJson, sameOrigin, unauthorized, dbErrorResponse } from '@/lib/server/http'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES = new Set(['initiated', 'completed', 'cancelled'])

// POST /api/admin/refunds/:id  { status: 'initiated' | 'completed' | 'cancelled', bank_reference?, note? }
// Records the outcome of a manual bank-transfer refund. "completed" requires a
// bank reference and is final. Admin rights are checked by the database.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cid = correlationId(req)
  if (!sameOrigin(req, env.siteUrl())) return json({ error: 'forbidden' }, 403)
  const auth = await authenticate(req)
  if (!auth) return unauthorized()
  const { id } = await ctx.params
  const body = await readJson<{ status?: unknown; bank_reference?: unknown; note?: unknown }>(req)
  const status = typeof body?.status === 'string' ? body.status : ''
  if (!UUID.test(id) || !STATUSES.has(status)) return json({ error: 'invalid_input' }, 400)
  const ref = typeof body?.bank_reference === 'string' ? body.bank_reference.slice(0, 100) : null
  const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null

  try {
    const r = await db().rpcAsUser<{ changed: boolean; status: string }>(auth.token, 'admin_update_refund', {
      p_refund_id: id, p_status: status, p_bank_reference: ref, p_note: note,
    })
    return json(r)
  } catch (e) {
    return dbErrorResponse(e, cid, { forbidden: 403, refund_not_found: 404, invalid_refund_transition: 409, bank_reference_required: 400 })
  }
}
