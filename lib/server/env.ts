import 'server-only'

// Server-side configuration. Secrets are read only here, only on the server,
// and never exposed through NEXT_PUBLIC_* variables.

export type DeployEnv = 'production' | 'preview' | 'development' | 'test'

export function deployEnv(): DeployEnv {
  if (process.env.ARENAGRADE_ENV === 'test') return 'test'
  const v = process.env.VERCEL_ENV
  if (v === 'production' || v === 'preview' || v === 'development') return v
  return process.env.NODE_ENV === 'production' ? 'production' : 'development'
}

export const isProduction = () => deployEnv() === 'production'

function opt(name: string) {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : undefined
}

export function requireEnv(name: string) {
  const v = opt(name)
  if (!v) throw new Error(`Missing required server environment variable ${name}`)
  return v
}

export const env = {
  supabaseUrl: () => requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: () => requireEnv('SUPABASE_SERVICE_ROLE_KEY'),

  /** Canonical site origin used for PayHere return/notify URLs and links. Never taken from the request Host header. */
  siteUrl: () => (opt('APP_BASE_URL') ?? opt('NEXT_PUBLIC_SITE_URL') ?? 'http://localhost:3000').replace(/\/+$/, ''),

  otpHashSecret: () => requireEnv('OTP_HASH_SECRET'),
  /** Non-production only: return the OTP in the API response instead of sending SMS. */
  otpTestMode: () => opt('OTP_TEST_MODE') === 'enabled' && !isProduction(),

  textLkApiKey: () => opt('TEXT_LK_API_KEY'),
  textLkSenderId: () => opt('TEXT_LK_SENDER_ID') ?? 'TextLKDemo',
  smsDailyCap: () => Number(opt('SMS_OTP_DAILY_CAP') ?? 300),

  resendApiKey: () => opt('RESEND_API_KEY'),
  emailFrom: () => opt('EMAIL_FROM') ?? 'ArenaGrade <onboarding@resend.dev>',
  reportRecipients: () => (opt('REPORT_RECIPIENTS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),

  /** Owner/admin phone for cancellation requests (existing PRANEETH_PHONE kept for compatibility). */
  adminPhone: () => opt('ADMIN_ALERT_PHONE') ?? opt('PRANEETH_PHONE'),
  /** WhatsApp number customers send bank details to for refunds. */
  refundWhatsapp: () => opt('REFUND_WHATSAPP_NUMBER') ?? opt('PRANEETH_PHONE'),
  /** Phone(s) for critical technical alerts — an independent channel from email. */
  criticalAlertPhones: () => (opt('CRITICAL_ALERT_PHONES') ?? opt('ADMIN_ALERT_PHONE') ?? opt('PRANEETH_PHONE') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean),

  payhereMode: () => (opt('PAYHERE_MODE') === 'live' ? 'live' : 'sandbox') as 'live' | 'sandbox',
  payhereMerchantId: () => opt('PAYHERE_MERCHANT_ID'),
  payhereMerchantSecret: () => opt('PAYHERE_MERCHANT_SECRET'),

  /** Simulated payments: only when explicitly enabled AND not production AND PayHere not in live mode. */
  paymentSimulationAllowed: () =>
    opt('PAYMENT_SIMULATION') === 'enabled' && !isProduction() && opt('PAYHERE_MODE') !== 'live',

  cronSecret: () => opt('CRON_SECRET'),
}
