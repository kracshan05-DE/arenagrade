#!/usr/bin/env node
// Runs before `next build`. Fails the build (exit 1) when configuration could
// expose payment simulation, test OTPs or privileged keys in production.
// It never prints secret values.

const env = process.env
const isProd = env.VERCEL_ENV === 'production'
const errors = []
const warnings = []

function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return payload.role
  } catch {
    return null
  }
}

// 1. No privileged key in a browser-exposed variable — any environment.
for (const [k, v] of Object.entries(env)) {
  if (!k.startsWith('NEXT_PUBLIC_') || !v) continue
  if (jwtRole(v) === 'service_role') errors.push(`${k} contains a Supabase service_role key; it would be shipped to browsers.`)
  if (v.startsWith('sb_secret_')) errors.push(`${k} contains a Supabase secret key; it would be shipped to browsers.`)
  if (/^re_[A-Za-z0-9]{10,}/.test(v)) errors.push(`${k} looks like a Resend API key; it would be shipped to browsers.`)
  if (/SECRET|SERVICE_ROLE|API_KEY|PRIVATE/i.test(k)) errors.push(`${k}: secrets must not use the NEXT_PUBLIC_ prefix.`)
}

if (isProd) {
  if (env.PAYMENT_SIMULATION === 'enabled') errors.push('PAYMENT_SIMULATION=enabled in production.')
  if (env.OTP_TEST_MODE === 'enabled') errors.push('OTP_TEST_MODE=enabled in production.')
  if (env.PAYHERE_MERCHANT_ID && env.PAYHERE_MODE !== 'live')
    warnings.push('PayHere credentials are set but PAYHERE_MODE is not "live": production would use the sandbox (no real money).')
  for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'OTP_HASH_SECRET', 'CRON_SECRET', 'APP_BASE_URL', 'TEXT_LK_API_KEY'])
    if (!env[k]) errors.push(`${k} is required in production.`)
  if (env.CRON_SECRET && env.CRON_SECRET.length < 16) errors.push('CRON_SECRET must be at least 16 characters.')
  if (env.OTP_HASH_SECRET && env.OTP_HASH_SECRET.length < 32) errors.push('OTP_HASH_SECRET must be at least 32 characters.')
  if (!env.PAYHERE_MERCHANT_ID || !env.PAYHERE_MERCHANT_SECRET)
    warnings.push('PayHere is not configured: online payment (and therefore booking) is disabled in production.')
  if (!env.RESEND_API_KEY) warnings.push('RESEND_API_KEY missing: emails and the daily report will fail.')
  if (!env.REPORT_RECIPIENTS) warnings.push('REPORT_RECIPIENTS missing: the daily report has nobody to send to.')
  if (env.APP_BASE_URL && !env.APP_BASE_URL.startsWith('https://')) errors.push('APP_BASE_URL must be https in production.')
}

for (const w of warnings) console.warn(`[predeploy-check] WARNING: ${w}`)
if (errors.length) {
  for (const e of errors) console.error(`[predeploy-check] ERROR: ${e}`)
  process.exit(1)
}
console.log(`[predeploy-check] OK (${isProd ? 'production' : env.VERCEL_ENV ?? 'local'})`)
