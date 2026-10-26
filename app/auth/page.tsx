'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { safeRedirectPath } from '@/lib/safeRedirect'

function AuthContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const redirect = safeRedirectPath(searchParams.get('redirect'))

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // If already logged in, redirect immediately
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.push(redirect)
    })
  }, [redirect, router])

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  // The password rule applies when an account is CREATED. Sign-in never checks
  // it: older accounts may have other passwords, and the server decides.
  const meetsPasswordRule = (value: string) => value.length >= 8 && /[0-9]/.test(value) && /[a-zA-Z]/.test(value)

  // Supabase error text -> plain messages that do not reveal whether an email is registered.
  const friendlyAuthError = (raw: string) => {
    const m = raw.toLowerCase()
    if (m.includes('invalid login credentials')) return 'Incorrect email or password.'
    if (m.includes('email not confirmed')) return 'Please confirm your email first. Check your inbox for the confirmation link.'
    if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a little and try again.'
    if (m.includes('already registered')) return 'An account with this email may already exist. Try signing in instead.'
    return 'Something went wrong. Please try again.'
  }

  const handleEmailAuth = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError('')
    setMessage('')
    const cleanEmail = email.trim()
    if (!cleanEmail) { setError('Enter your email address.'); return }
    if (!isValidEmail(cleanEmail)) { setError('Enter a valid email address.'); return }
    if (!password) { setError('Enter your password.'); return }
    if (isSignUp) {
      const name = fullName.trim()
      if (name.length < 2 || name.length > 80) { setError('Enter your full name (2–80 characters).'); return }
      if (!meetsPasswordRule(password)) { setError('Password must be at least 8 characters, with at least one letter and one number.'); return }
    }
    setLoading(true)

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email: cleanEmail, password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
        },
      })
      if (error) setError(friendlyAuthError(error.message))
      else setMessage('Check your email for a confirmation link.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
      if (error) setError(friendlyAuthError(error.message))
      else router.push(redirect)
    }
    setLoading(false)
  }

  const handleGoogleSignIn = async () => {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`
      }
    })
    if (error) setError(friendlyAuthError(error.message))
  }

  const inputStyle: React.CSSProperties = { width: '100%', border: '1px solid #94A3B8', borderRadius: '8px', padding: '10px 12px', fontSize: '15px', boxSizing: 'border-box', color: '#0F172A', background: '#fff' }
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: '13px', color: '#334155', fontWeight: 600, marginBottom: '5px' }

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: '16px', border: '0.5px solid #E2E8F0', padding: '32px', width: '100%', maxWidth: '400px', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ width: '44px', height: '44px', background: '#1B6B3A', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', margin: '0 auto 12px' }}>
            🏟
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>
            Arena<span style={{ color: '#1B6B3A' }}>Grade</span>
          </h1>
          <p style={{ fontSize: '14px', color: '#475569', margin: 0 }}>
            {isSignUp ? 'Create your account' : 'Sign in to your account'}
          </p>
        </div>

        {/* Google Sign In */}
        <button type="button" onClick={handleGoogleSignIn} className="ag-tap"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '11px', background: '#fff', cursor: 'pointer', marginBottom: '20px', fontSize: '14px', color: '#0F172A', fontWeight: '500' }}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{ flex: 1, height: '0.5px', background: '#E2E8F0' }} />
          <span style={{ fontSize: '12px', color: '#64748B' }}>or</span>
          <div style={{ flex: 1, height: '0.5px', background: '#E2E8F0' }} />
        </div>

        <form onSubmit={handleEmailAuth} noValidate>
          {isSignUp && (
            <div style={{ marginBottom: '12px' }}>
              <label htmlFor="auth-name" style={labelStyle}>Full name</label>
              <input id="auth-name" type="text" autoComplete="name" value={fullName} maxLength={80}
                onChange={e => { setFullName(e.target.value); setError('') }}
                placeholder="e.g. Nimal Perera" style={inputStyle} />
            </div>
          )}

          <div style={{ marginBottom: '12px' }}>
            <label htmlFor="auth-email" style={labelStyle}>Email</label>
            <input id="auth-email" type="email" autoComplete="email" inputMode="email" value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              placeholder="you@example.com" style={inputStyle} />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label htmlFor="auth-password" style={labelStyle}>Password</label>
            <div style={{ position: 'relative' }}>
              <input id="auth-password" type={showPassword ? 'text' : 'password'} value={password}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                aria-describedby={isSignUp ? 'auth-password-rule' : undefined}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder={isSignUp ? 'At least 8 characters, with a number' : 'Your password'}
                style={{ ...inputStyle, paddingRight: '64px' }} />
              <button type="button" onClick={() => setShowPassword(v => !v)} aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#1B6B3A', fontSize: '13px', fontWeight: 600, cursor: 'pointer', padding: '8px', minHeight: '36px' }}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {isSignUp && (
              <p id="auth-password-rule" style={{ fontSize: '12px', color: '#475569', margin: '6px 0 0' }}>
                At least 8 characters, with at least one letter and one number.
              </p>
            )}
          </div>

          <div aria-live="polite">
            {error && (
              <div role="alert" style={{ background: '#FEE2E2', border: '0.5px solid #FECACA', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px' }}>
                <p style={{ fontSize: '13px', color: '#B91C1C', margin: 0 }}>{error}</p>
              </div>
            )}
            {message && (
              <div style={{ background: '#ECFDF5', border: '0.5px solid #6EE7B7', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px' }}>
                <p style={{ fontSize: '13px', color: '#065F46', margin: 0 }}>{message}</p>
              </div>
            )}
          </div>

          <button type="submit" disabled={loading} className="ag-tap"
            style={{ width: '100%', background: loading ? '#94A3B8' : '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '15px', fontWeight: '700', cursor: loading ? 'not-allowed' : 'pointer', marginBottom: '16px' }}>
            {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: '14px', color: '#475569', margin: 0 }}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button type="button" onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage('') }}
            style={{ background: 'none', border: 'none', color: '#1B6B3A', fontWeight: '700', cursor: 'pointer', fontSize: '14px', padding: '6px 2px' }}>
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  )
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#F8FAFC' }} />}>
      <AuthContent />
    </Suspense>
  )
}