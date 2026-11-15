'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase, getCurrentUser } from '@/lib/supabase'
import BrandMark from '@/components/BrandMark'
import Icon, { type IconName } from '@/components/Icon'

const NAV_ITEMS: { label: string; href: string; icon: IconName }[] = [
  { label: 'Dashboard', href: '/admin', icon: 'dashboard' },
  { label: 'Bookings', href: '/admin/bookings', icon: 'calendar' },
  { label: 'Slots', href: '/admin/slots', icon: 'clock' },
  { label: 'Courts', href: '/admin/courts', icon: 'court' },
  { label: 'Products', href: '/admin/products', icon: 'bag' },
  { label: 'Portfolio', href: '/admin/portfolio', icon: 'image' },
  { label: 'Recurring', href: '/admin/recurring', icon: 'repeat' },
]

// Dashboard matches exactly; other sections also match their sub-pages.
const isActive = (pathname: string, href: string) =>
  href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(href + '/')

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    const check = async () => {
      const user = await getCurrentUser()
      if (!user) {
        router.push('/auth')
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', user.id)
        .single()

      if (!profile || profile.role !== 'super_admin') {
        router.push('/')
        return
      }
      setAdminName(profile.full_name || user.email?.split('@')[0] || 'Admin')
      setAdminEmail(user.email ?? '')
      setChecking(false)
    }
    check()
  }, [router])

  // Close the mobile drawer on navigation and on Escape.
  useEffect(() => { setDrawerOpen(false) }, [pathname])
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const handleSignOut = async () => {
    setSigningOut(true)
    await supabase.auth.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div role="status" aria-live="polite" style={{ minHeight: '100vh', background: 'var(--ag-bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px' }}>
        <BrandMark size={44} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--ag-text-subtle)', fontSize: '14px' }}>
          <Icon name="shield" size={16} /> Verifying admin access…
        </div>
      </div>
    )
  }

  const initials = adminName.split(/\s+/).map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  const current = NAV_ITEMS.find((i) => isActive(pathname, i.href))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ag-bg)' }}>
      {/* Mobile top bar */}
      <div className="ag-admin-topbar ag-on-dark">
        <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open admin menu" aria-expanded={drawerOpen} aria-controls="ag-admin-sidebar"
          className="ag-btn ag-btn-on-dark ag-btn-sm" style={{ padding: '0 9px' }}>
          <Icon name="menu" />
        </button>
        <BrandMark size={26} />
        <span style={{ fontSize: '15px', fontWeight: 700 }}>{current?.label ?? 'Admin'}</span>
      </div>

      <div className="ag-admin-scrim" data-open={drawerOpen} onClick={() => setDrawerOpen(false)} aria-hidden="true" />

      <aside id="ag-admin-sidebar" className="ag-admin-sidebar ag-on-dark" data-open={drawerOpen} aria-label="Admin">
        {/* Brand */}
        <div style={{ padding: '20px 18px 18px', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <BrandMark size={34} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '15px', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>ArenaGrade</p>
            <p style={{ fontSize: '11px', fontWeight: 600, margin: '2px 0 0', color: 'var(--ag-accent)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Admin console</p>
          </div>
          <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close admin menu"
            className="ag-btn ag-btn-on-dark ag-btn-sm ag-admin-close" style={{ padding: '0 8px' }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Navigation */}
        <nav aria-label="Admin sections" style={{ flex: 1, overflowY: 'auto', padding: '14px 12px 14px 16px' }}>
          <p style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', margin: '0 0 8px 12px' }}>Manage</p>
          {NAV_ITEMS.map((item) => (
            <a key={item.href} href={item.href} className="ag-admin-link" aria-current={isActive(pathname, item.href) ? 'page' : undefined}>
              <Icon name={item.icon} />
              {item.label}
            </a>
          ))}
        </nav>

        {/* Signed-in admin */}
        <div style={{ padding: '14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', marginBottom: '10px' }}>
            <span aria-hidden="true" style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--ag-accent)', color: 'var(--ag-primary-deep)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 800, flexShrink: 0 }}>{initials}</span>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: '13px', fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{adminName}</p>
              <p style={{ fontSize: '12px', margin: '2px 0 0', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {adminEmail || 'Super admin'}
              </p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <a href="/" target="_blank" rel="noopener noreferrer" className="ag-btn ag-btn-on-dark ag-btn-sm">
              <Icon name="external" size={15} /> Website<span className="ag-sr-only"> (opens in a new tab)</span>
            </a>
            <button type="button" onClick={handleSignOut} disabled={signingOut} className="ag-btn ag-btn-on-dark ag-btn-sm">
              <Icon name="logout" size={15} /> {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </aside>

      <main className="ag-admin-main">
        {children}
      </main>
    </div>
  )
}
