import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

// Data-access seam. Route handlers talk to the database only through this
// interface, which:
//   * keeps the service-role key on the server
//   * runs customer actions as the customer (their JWT), so the database's own
//     checks (auth.uid(), RLS) apply
//   * lets tests swap in an adapter that calls the same SQL functions on a
//     local PostgreSQL

export class DbError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code)
  }
}

export interface AuthUser { id: string; email: string | null }
export interface ProfileRow { full_name: string | null; phone: string | null; phone_verified: boolean | null }
export interface SlotSummary {
  slot_id: string; court_id: string; court_name: string | null; location_name: string | null
  location_address: string | null; slot_date: string; start_time: string; end_time: string; court_type: string
}

export interface DbAdapter {
  getUser(accessToken: string): Promise<AuthUser | null>
  rpcAsService<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>
  rpcAsUser<T = unknown>(accessToken: string, fn: string, args: Record<string, unknown>): Promise<T>
  getProfile(userId: string): Promise<ProfileRow | null>
  getUserEmail(userId: string): Promise<string | null>
  getSlotSummary(slotId: string): Promise<SlotSummary | null>
  getPaymentAttempt(orderId: string): Promise<PaymentAttemptRow | null>
  ping(): Promise<boolean>
}

export interface PaymentAttemptRow {
  order_id: string; user_id: string; slot_id: string; amount_lkr: string; currency: string
  provider: string; environment: string; status: string
}

let override: DbAdapter | null = null
let cached: DbAdapter | null = null

/** Tests only. */
export function setDbAdapterForTests(a: DbAdapter | null) {
  override = a
}

export function db(): DbAdapter {
  if (override) return override
  if (!cached) cached = new SupabaseAdapter()
  return cached
}

function toDbError(e: { message?: string; code?: string } | null): DbError {
  const msg = e?.message ?? 'database_error'
  // Our functions raise bare machine codes like 'slot_unavailable'.
  return new DbError(/^[a-z_]+$/.test(msg) ? msg : 'database_error', msg)
}

class SupabaseAdapter implements DbAdapter {
  private admin: SupabaseClient

  constructor() {
    this.admin = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  private asUser(token: string) {
    return createClient(env.supabaseUrl(), env.supabaseAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
  }

  async getUser(token: string) {
    const { data, error } = await this.admin.auth.getUser(token)
    if (error || !data.user) return null
    return { id: data.user.id, email: data.user.email ?? null }
  }

  async rpcAsService<T>(fn: string, args: Record<string, unknown>) {
    const { data, error } = await this.admin.rpc(fn, args)
    if (error) throw toDbError(error)
    return data as T
  }

  async rpcAsUser<T>(token: string, fn: string, args: Record<string, unknown>) {
    const { data, error } = await this.asUser(token).rpc(fn, args)
    if (error) throw toDbError(error)
    return data as T
  }

  async getProfile(userId: string) {
    const { data, error } = await this.admin.from('profiles').select('full_name, phone, phone_verified').eq('id', userId).maybeSingle()
    if (error) throw toDbError(error)
    return data as ProfileRow | null
  }

  async getUserEmail(userId: string) {
    const { data, error } = await this.admin.auth.admin.getUserById(userId)
    if (error) return null
    return data.user?.email ?? null
  }

  async getSlotSummary(slotId: string) {
    const { data, error } = await this.admin
      .from('slots')
      .select('id, court_id, slot_date, start_time, end_time, court_type, courts(name, locations(name, address))')
      .eq('id', slotId)
      .maybeSingle()
    if (error) throw toDbError(error)
    if (!data) return null
    const court = (data as unknown as { courts: { name: string; locations: { name: string; address: string } | null } | null }).courts
    return {
      slot_id: data.id, court_id: data.court_id, court_name: court?.name ?? null,
      location_name: court?.locations?.name ?? null, location_address: court?.locations?.address ?? null,
      slot_date: data.slot_date, start_time: data.start_time, end_time: data.end_time, court_type: data.court_type,
    }
  }

  async getPaymentAttempt(orderId: string) {
    const { data, error } = await this.admin
      .from('payment_attempts')
      .select('order_id, user_id, slot_id, amount_lkr, currency, provider, environment, status')
      .eq('order_id', orderId)
      .maybeSingle()
    if (error) throw toDbError(error)
    return data ? { ...data, amount_lkr: Number(data.amount_lkr).toFixed(2) } as PaymentAttemptRow : null
  }

  async ping() {
    const { error } = await this.admin.from('courts').select('id', { head: true, count: 'exact' }).limit(1)
    return !error
  }
}
