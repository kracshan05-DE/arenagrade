import { db } from '@/lib/server/db'

// GET /api/health — for an external uptime monitor. Reports only up/down.
export async function GET() {
  let dbOk = false
  try { dbOk = await db().ping() } catch { dbOk = false }
  return new Response(JSON.stringify({ ok: dbOk }), {
    status: dbOk ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
