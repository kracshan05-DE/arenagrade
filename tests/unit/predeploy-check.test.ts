import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const script = join(__dirname, '..', '..', 'scripts', 'predeploy-check.mjs')
const run = (env: Record<string, string>) =>
  spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' })

const prodOk = {
  VERCEL_ENV: 'production', SUPABASE_SERVICE_ROLE_KEY: 'x', OTP_HASH_SECRET: 'a'.repeat(40), CRON_SECRET: 'b'.repeat(24),
  APP_BASE_URL: 'https://arenagrade.lk', TEXT_LK_API_KEY: 'k', PAYHERE_MERCHANT_ID: '1', PAYHERE_MERCHANT_SECRET: 's',
  PAYHERE_MODE: 'live', RESEND_API_KEY: 'r', REPORT_RECIPIENTS: 'a@b.co',
}
const fakeJwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`

describe('build-time deployment guard', () => {
  it('passes a correct production configuration', () => {
    expect(run(prodOk).status).toBe(0)
  })
  it('fails when payment simulation is enabled in production', () => {
    const r = run({ ...prodOk, PAYMENT_SIMULATION: 'enabled' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('PAYMENT_SIMULATION')
  })
  it('fails when OTP test mode is enabled in production', () => {
    expect(run({ ...prodOk, OTP_TEST_MODE: 'enabled' }).status).toBe(1)
  })
  it('fails when a service_role key is placed in a NEXT_PUBLIC_ variable (any environment)', () => {
    const r = run({ NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt('service_role') })
    expect(r.status).toBe(1)
    expect(r.stderr).not.toContain(fakeJwt('service_role')) // never prints secrets
  })
  it('allows the anon key in NEXT_PUBLIC_', () => {
    expect(run({ NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt('anon') }).status).toBe(0)
  })
  it('warns (not fails) when PayHere is still in sandbox mode in production', () => {
    const r = run({ ...prodOk, PAYHERE_MODE: 'sandbox' })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('sandbox')
  })
  it('fails when required production secrets are missing', () => {
    const rest: Record<string, string> = { ...prodOk }
    delete rest.CRON_SECRET
    expect(run(rest).status).toBe(1)
  })
})
