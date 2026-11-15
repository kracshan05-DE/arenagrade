'use client'

import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import BrandMark from '@/components/BrandMark'
import Icon from '@/components/Icon'

type Profile = { full_name: string | null; role: string | null }

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let alive = true
    const load = async (u: User | null) => {
      if (!u) { setUser(null); setProfile(null); return }
      setUser(u)
      const { data } = await supabase.from('profiles').select('full_name, role').eq('id', u.id).maybeSingle()
      if (alive) setProfile(data ?? null)
    }
    supabase.auth.getUser().then(async ({ data: { user: u } }) => { await load(u); if (alive) setLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => { void load(session?.user ?? null) })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  // Close the account menu on outside click or Escape (focus returns to the button).
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenuOpen(false); buttonRef.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  const handleSignOut = async () => {
    setSigningOut(true)
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const isAdmin = profile?.role === 'super_admin'
  const displayName = profile?.full_name?.trim() || (user?.user_metadata?.full_name as string | undefined) || user?.email?.split('@')[0] || 'Account'
  const firstName = displayName.split(' ')[0]
  const initials = displayName.split(/\s+/).map((n) => n[0]).join('').toUpperCase().slice(0, 2)

  return (
    <header style={{ background: 'rgba(255,255,255,0.96)', backdropFilter: 'saturate(180%) blur(8px)', borderBottom: '1px solid var(--ag-border)', position: 'sticky', top: 0, zIndex: 30 }}>
      <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '0 16px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <a href="/" aria-label="ArenaGrade home" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
          <BrandMark size={34} />
          <span style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--ag-text)' }}>
            Arena<span style={{ color: 'var(--ag-primary)' }}>Grade</span>
          </span>
        </a>

        {loading ? (
          <div aria-hidden="true" style={{ width: '96px', height: '36px', background: '#EEF2F6', borderRadius: '10px' }} />
        ) : user ? (
          <nav aria-label="Account" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <a href="/my-bookings" className="ag-btn ag-btn-ghost ag-btn-sm ag-hide-sm">
              <Icon name="calendar" size={16} /> My bookings
            </a>
            {isAdmin && (
              <a href="/admin" className="ag-btn ag-btn-secondary ag-btn-sm ag-hide-sm">
                <Icon name="shield" size={16} /> Admin
              </a>
            )}
            <div style={{ position: 'relative' }}>
              <button ref={buttonRef} type="button" onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen} aria-controls="ag-account-menu" aria-label={`Account menu for ${displayName}`}
                className="ag-btn ag-btn-ghost ag-btn-sm" style={{ paddingLeft: '6px', gap: '8px' }}>
                <span aria-hidden="true" style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'var(--ag-primary)', color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>{initials}</span>
                <span className="ag-hide-sm" style={{ color: 'var(--ag-text)' }}>{firstName}</span>
                <Icon name="chevronDown" size={16} />
              </button>
              {menuOpen && (
                <div id="ag-account-menu" ref={menuRef} className="ag-menu">
                  <div style={{ padding: '10px 12px 8px' }}>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--ag-text)' }}>{displayName}</p>
                    {user.email && <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--ag-text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</p>}
                  </div>
                  <div className="ag-menu-sep" />
                  <a href="/my-bookings" className="ag-menu-item"><Icon name="calendar" /> My bookings</a>
                  {isAdmin && <a href="/admin" className="ag-menu-item"><Icon name="shield" /> Admin panel</a>}
                  <div className="ag-menu-sep" />
                  <button type="button" onClick={handleSignOut} disabled={signingOut} className="ag-menu-item" style={{ color: '#B91C1C' }}>
                    <Icon name="logout" style={{ color: '#B91C1C' }} /> {signingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              )}
            </div>
          </nav>
        ) : (
          <nav aria-label="Account" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <a href="/auth" className="ag-btn ag-btn-ghost ag-btn-sm"><Icon name="login" size={16} /> Sign in</a>
            <a href="/#book" className="ag-btn ag-btn-primary ag-btn-sm">Book a court</a>
          </nav>
        )}
      </div>
    </header>
  )
}
