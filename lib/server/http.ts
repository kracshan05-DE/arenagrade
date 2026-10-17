import 'server-only'
import { randomUUID } from 'node:crypto'
import { db, DbError, type AuthUser } from './db'
import { log } from './log'

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
}

export function correlationId(req: Request) {
  return req.headers.get('x-vercel-id') ?? randomUUID()
}

/** Client IP. On Vercel, x-forwarded-for is set by the platform (first entry = client). */
export function clientIp(req: Request) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? null
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 8_192): Promise<T | null> {
  const text = await req.text()
  if (text.length > maxBytes) return null
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null
  } catch {
    return null
  }
}

export type Authed = { user: AuthUser; token: string }

/** Verify the caller's Supabase access token (Authorization: Bearer ...). */
export async function authenticate(req: Request): Promise<Authed | null> {
  const h = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  if (!m) return null
  const token = m[1].trim()
  if (token.length < 10 || token.length > 4096) return null
  const user = await db().getUser(token)
  return user ? { user, token } : null
}

export const unauthorized = () => json({ error: 'not_authenticated' }, 401)

/** Same-origin check for state-changing browser requests (defence in depth on top of bearer auth). */
export function sameOrigin(req: Request, siteUrl: string) {
  const origin = req.headers.get('origin')
  if (!origin) return true // non-browser clients; bearer token still required
  try {
    const o = new URL(origin)
    const allowed = new Set([new URL(siteUrl).host, req.headers.get('host')].filter(Boolean) as string[])
    return allowed.has(o.host)
  } catch {
    return false
  }
}

/** Map a database error to an HTTP response without leaking internals. */
export function dbErrorResponse(e: unknown, cid: string, known: Record<string, number>) {
  if (e instanceof DbError && known[e.code]) {
    return json({ error: e.code }, known[e.code])
  }
  log('error', 'unexpected_db_error', { cid, error: e instanceof Error ? e.message : String(e) })
  return json({ error: 'server_error', ref: cid }, 500)
}
