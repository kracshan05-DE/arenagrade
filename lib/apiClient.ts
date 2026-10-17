'use client'
import { supabase } from '@/lib/supabase'

// Calls the app's server routes with the signed-in user's Supabase access
// token. The server verifies the token; nothing here is trusted on its own.
export async function apiPost<T = Record<string, unknown>>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })
  const data = (await res.json().catch(() => ({}))) as T
  return { ok: res.ok, status: res.status, data }
}

/** Supabase RPC error -> our machine code (functions raise e.g. 'slot_unavailable'). */
export function rpcErrorCode(error: { message?: string } | null | undefined) {
  const m = error?.message ?? ''
  return /^[a-z_]+$/.test(m) ? m : 'unknown_error'
}
