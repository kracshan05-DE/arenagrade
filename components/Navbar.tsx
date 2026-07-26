'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Navbar() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUser(user)
        const { data: profileData } = await supabase
          .from('profiles')
          .select('full_name, phone, role')
          .eq('id', user.id)
          .single()
        if (profileData) {
          setProfile(profileData)
          if (profileData.role === 'super_admin') setIsAdmin(true)
        }
      }
      setLoading(false)
    }
    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user)
      } else {
        setUser(null)
        setProfile(null)
        setIsAdmin(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const getDisplayName = () => {
    if (profile?.full_name) return profile.full_name
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name
    if (user?.email) return user.email.split('@')[0]
    return 'Account'
  }

  const getInitials = () => {
    const name = getDisplayName()
    return name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  return (
    <header style={{
      background: '#fff',
      borderBottom: '0.5px solid #E2E8F0',
      padding: '0 24px',
      height: '56px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 10
    }}>
      <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
        <div style={{ width: '30px', height: '30px', background: '#1B6B3A', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>
          🏟
        </div>
        <span style={{ fontSize: '16px', fontWeight: '600', color: '#0F172A' }}>
          Arena<span style={{ color: '#1B6B3A' }}>Grade</span>
        </span>
      </a>

      {loading ? (
        <div style={{ width: '80px', height: '32px', background: '#F1F5F9', borderRadius: '8px' }} />
      ) : user ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '32px', height: '32px', background: '#1B6B3A', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: '700', color: '#fff'
            }}>
              {getInitials()}
            </div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>
                Hi, {getDisplayName().split(' ')[0]}
              </p>
            </div>
          </div>
          {isAdmin && (
            <a
              href="/admin"
              style={{
                fontSize: '12px',
                background: '#0B2818',
                color: '#4ADE80',
                padding: '6px 12px',
                borderRadius: '7px',
                textDecoration: 'none',
                fontWeight: '600',
                border: '0.5px solid #1B6B3A',
              }}
            >
              Admin panel
            </a>
          )}
          <button
            onClick={handleSignOut}
            style={{
              fontSize: '12px', color: '#64748B', background: '#F1F5F9',
              border: 'none', borderRadius: '7px', padding: '6px 12px',
              cursor: 'pointer', fontWeight: '500'
            }}
          >
            Sign out
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <a href="/auth" style={{ fontSize: '13px', color: '#64748B', padding: '6px 12px', borderRadius: '7px', textDecoration: 'none' }}>
            Sign in
          </a>
          <a href="/auth" style={{ fontSize: '13px', background: '#1B6B3A', color: '#fff', padding: '7px 16px', borderRadius: '7px', textDecoration: 'none', fontWeight: '500' }}>
            Book now
          </a>
        </div>
      )}
    </header>
  )
}
