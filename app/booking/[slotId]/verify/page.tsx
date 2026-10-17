'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, getCurrentUser } from '@/lib/supabase'
import Navbar from '@/components/Navbar'
import { apiPost } from '@/lib/apiClient'
import { userMessage } from '@/lib/userMessages'

export default function VerifyPage() {
  const params = useParams()
  const router = useRouter()
  const slotId = params.slotId as string

  const [user, setUser] = useState<any>(null)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      const currentUser = await getCurrentUser()
      if (!currentUser) {
        router.push(`/auth?redirect=/booking/${slotId}/verify`)
        return
      }
      setUser(currentUser)

      const { data: profile } = await supabase
        .from('profiles')
        .select('phone, phone_verified')
        .eq('id', currentUser.id)
        .single()

      if (profile?.phone_verified) {
        setPhoneVerified(true)
        router.push(`/booking/${slotId}/payment`)
        return
      }

      setPageLoading(false)
    }
    init()
  }, [slotId, router])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => setResendCooldown(prev => prev - 1), 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  const validatePhone = (num: string) => /^07[0-9]{8}$/.test(num)

  // The code is generated, sent, rate-limited and checked on the server. The
  // browser never sees the stored code and cannot mark the phone as verified.
  const sendOtp = async () => {
    setError('')
    if (!validatePhone(phone)) {
      setError('Enter a valid Sri Lankan mobile number starting with 07 (10 digits)')
      return
    }
    setLoading(true)
    const res = await apiPost<{ status?: string; error?: string; retry_after_seconds?: number; resend_after_seconds?: number; test_code?: string }>(
      '/api/otp/send', { phone })
    setLoading(false)

    if (res.data.status === 'already_verified') {
      router.push(`/booking/${slotId}/payment`)
      return
    }
    if (!res.ok) {
      const wait = res.data.retry_after_seconds
      setError(res.data.error === 'rate_limited' && wait
        ? `Too many code requests. Please wait ${Math.ceil(wait / 60)} minute${Math.ceil(wait / 60) === 1 ? '' : 's'} and try again.`
        : userMessage(res.data.error))
      return
    }
    if (res.data.test_code) console.info('[TEST MODE] OTP:', res.data.test_code)
    setStep('otp')
    setResendCooldown(res.data.resend_after_seconds ?? 60)
  }

  const verifyOtp = async () => {
    setError('')
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit code sent to your phone')
      return
    }
    setLoading(true)
    const res = await apiPost<{ status?: string; error?: string; attempts_left?: number }>('/api/otp/verify', { phone, code: otp })
    setLoading(false)

    if (res.ok && res.data.status === 'verified') {
      router.push(`/booking/${slotId}/payment`)
      return
    }
    if (res.data.error === 'invalid_code' && typeof res.data.attempts_left === 'number') {
      const n = res.data.attempts_left
      setError(`Incorrect code. ${n} attempt${n === 1 ? '' : 's'} remaining.`)
      return
    }
    setError(userMessage(res.data.error))
  }

  if (pageLoading || phoneVerified) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: '#64748B', fontSize: '14px' }}>Redirecting to payment...</p>
      </div>
    )
  }

  return (
    <main style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
      <Navbar />

      <div style={{ maxWidth: '440px', margin: '48px auto', padding: '0 16px 48px' }}>

        {/* Steps */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '32px' }}>
          {['Reserve slot', 'Verify phone', 'Payment'].map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{
                  width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700',
                  background: i === 0 ? '#ECFDF5' : i === 1 ? '#1B6B3A' : '#E2E8F0',
                  color: i === 0 ? '#1B6B3A' : i === 1 ? '#fff' : '#94A3B8'
                }}>
                  {i === 0 ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: '12px', color: i === 1 ? '#0F172A' : '#94A3B8', fontWeight: i === 1 ? '600' : '400' }}>{s}</span>
              </div>
              {i < 2 && <div style={{ width: '24px', height: '0.5px', background: '#E2E8F0' }} />}
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '28px' }}>

          {step === 'phone' ? (
            <>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div style={{ width: '56px', height: '56px', background: '#ECFDF5', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', margin: '0 auto 14px' }}>
                  📱
                </div>
                <h1 style={{ fontSize: '18px', fontWeight: '700', color: '#0F172A', margin: '0 0 6px' }}>Verify your phone number</h1>
                <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>
                  We need your mobile number so we can send your booking confirmation
                </p>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#64748B', fontWeight: '500', marginBottom: '6px' }}>Mobile number</label>
                <div style={{ display: 'flex', alignItems: 'center', border: '0.5px solid #CBD5E1', borderRadius: '8px', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', background: '#F8FAFC', borderRight: '0.5px solid #CBD5E1', fontSize: '13px', color: '#64748B', whiteSpace: 'nowrap' }}>
                    🇱🇰 +94
                  </div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError('') }}
                    placeholder="07XXXXXXXX"
                    maxLength={10}
                    style={{ flex: 1, border: 'none', outline: 'none', padding: '10px 12px', fontSize: '14px', color: '#0F172A', background: 'transparent' }}
                  />
                </div>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '5px 0 0' }}>Must start with 07 and be 10 digits</p>
              </div>

              {error && (
                <div style={{ background: '#FEE2E2', border: '0.5px solid #FECACA', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px' }}>
                  <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
                </div>
              )}

              <button
                onClick={sendOtp}
                disabled={loading || phone.length < 10}
                style={{ width: '100%', background: loading || phone.length < 10 ? '#94A3B8' : '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: '600', cursor: loading || phone.length < 10 ? 'not-allowed' : 'pointer' }}
              >
                {loading ? 'Checking...' : 'Send verification code'}
              </button>

              {/* Rate limit info */}
              <p style={{ textAlign: 'center', fontSize: '11px', color: '#94A3B8', marginTop: '12px', marginBottom: 0 }}>
                Maximum 3 OTP requests per 10 minutes
              </p>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div style={{ width: '56px', height: '56px', background: '#ECFDF5', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', margin: '0 auto 14px' }}>
                  💬
                </div>
                <h1 style={{ fontSize: '18px', fontWeight: '700', color: '#0F172A', margin: '0 0 6px' }}>Enter verification code</h1>
                <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>
                  We sent a 6-digit code to <strong>{phone}</strong>
                </p>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#64748B', fontWeight: '500', marginBottom: '6px' }}>6-digit code</label>
                <input
                  type="text"
                  value={otp}
                  onChange={e => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
                  placeholder="000000"
                  maxLength={6}
                  style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '12px', fontSize: '22px', fontWeight: '700', color: '#0F172A', outline: 'none', textAlign: 'center', letterSpacing: '0.3em', boxSizing: 'border-box' }}
                />
              </div>

              {error && (
                <div style={{ background: '#FEE2E2', border: '0.5px solid #FECACA', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px' }}>
                  <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
                </div>
              )}

              <button
                onClick={verifyOtp}
                disabled={loading || otp.length !== 6}
                style={{ width: '100%', background: loading || otp.length !== 6 ? '#94A3B8' : '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: '600', cursor: loading || otp.length !== 6 ? 'not-allowed' : 'pointer', marginBottom: '14px' }}
              >
                {loading ? 'Verifying...' : 'Verify and continue'}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <button
                  onClick={() => { setStep('phone'); setOtp(''); setError('') }}
                  style={{ background: 'none', border: 'none', fontSize: '13px', color: '#64748B', cursor: 'pointer', padding: 0 }}
                >
                  Change number
                </button>
                <button
                  onClick={() => { setOtp(''); setError(''); sendOtp() }}
                  disabled={resendCooldown > 0}
                  style={{ background: 'none', border: 'none', fontSize: '13px', color: resendCooldown > 0 ? '#94A3B8' : '#1B6B3A', cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer', padding: 0, fontWeight: '500' }}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </div>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: '11px', color: '#94A3B8', marginTop: '16px' }}>
          🔒 Your number is only used for booking confirmations
        </p>
      </div>
    </main>
  )
}
