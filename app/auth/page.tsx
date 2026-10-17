'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { safeRedirectPath } from '@/lib/safeRedirect'

function AuthContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const redirect = safeRedirectPath(searchParams.get('redirect'))

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const isValidPassword = (password: string) => password.length >= 8 && /[0-9]/.test(password) && /[a-zA-Z]/.test(password)

  const handleEmailAuth = async () => {
    setError('')
    setMessage('')
    if (!isValidEmail(email)) { setError('Please enter a valid email address'); return }
    if (!isValidPassword(password)) { setError('Password must be at least 8 characters with at least one letter and one number'); return }
    setLoading(true)

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}` }
      })
      if (error) setError(error.message)
      else setMessage('Check your email for a confirmation link!')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
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
    if (error) setError(error.message)
  }

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
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>
            {isSignUp ? 'Create your account' : 'Sign in to your account'}
          </p>
        </div>

        {/* Google Sign In */}
        <button onClick={handleGoogleSignIn}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', border: '0.5px solid #E2E8F0', borderRadius: '10px', padding: '11px', background: '#fff', cursor: 'pointer', marginBottom: '20px', fontSize: '14px', color: '#0F172A', fontWeight: '500' }}>
          <svg width="18" height="18" viewBox="0 0 48 48">
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
          <span style={{ fontSize: '12px', color: '#94A3B8' }}>or</span>
          <div style={{ flex: 1, height: '0.5px', background: '#E2E8F0' }} />
        </div>

        {/* Email */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: '#64748B', fontWeight: '500', marginBottom: '5px' }}>Email</label>
          <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError('') }}
            placeholder="you@example.com"
            style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '10px 12px', fontSize: '14px', outline: 'none', boxSizing: 'border-box', color: '#0F172A' }} />
        </div>

        {/* Password */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: '#64748B', fontWeight: '500', marginBottom: '5px' }}>Password</label>
          <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError('') }}
            placeholder="Min 8 characters, include a number"
            style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '10px 12px', fontSize: '14px', outline: 'none', boxSizing: 'border-box', color: '#0F172A' }} />
        </div>

        {error && (
          <div style={{ background: '#FEE2E2', border: '0.5px solid #FECACA', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px' }}>
            <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
          </div>
        )}

        {message && (
          <div style={{ background: '#ECFDF5', border: '0.5px solid #6EE7B7', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px' }}>
            <p style={{ fontSize: '13px', color: '#065F46', margin: 0 }}>{message}</p>
          </div>
        )}

        <button onClick={handleEmailAuth} disabled={loading}
          style={{ width: '100%', background: loading ? '#94A3B8' : '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: '700', cursor: loading ? 'not-allowed' : 'pointer', marginBottom: '16px' }}>
          {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
        </button>

        <p style={{ textAlign: 'center', fontSize: '13px', color: '#64748B', margin: 0 }}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage('') }}
            style={{ background: 'none', border: 'none', color: '#1B6B3A', fontWeight: '600', cursor: 'pointer', fontSize: '13px', padding: 0 }}>
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