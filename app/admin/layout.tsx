'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase, getCurrentUser } from '@/lib/supabase'

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/admin', icon: '📊' },
  { label: 'Bookings', href: '/admin/bookings', icon: '📅' },
  { label: 'Slots', href: '/admin/slots', icon: '🕐' },
  { label: 'Courts', href: '/admin/courts', icon: '🏀' },
  { label: 'Products', href: '/admin/products', icon: '🛒' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)
  const [adminName, setAdminName] = useState('')

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
      setChecking(false)
    }
    check()
  }, [router])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: '#64748B', fontSize: '14px' }}>Verifying access...</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif', display: 'flex' }}>

      {/* Sidebar */}
      <aside style={{ width: '220px', background: '#0D4A2A', minHeight: '100vh', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 20 }}>

        {/* Logo */}
        <div style={{ padding: '20px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '28px', height: '28px', background: '#1B6B3A', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>
              🏟
            </div>
            <div>
              <p style={{ fontSize: '14px', fontWeight: '700', color: '#fff', margin: 0 }}>ArenaGrade</p>
              <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>Admin Panel</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href
            return (
              <a
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '9px 12px', borderRadius: '8px', marginBottom: '2px',
                  textDecoration: 'none',
                  background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.6)',
                  fontSize: '13px', fontWeight: isActive ? '600' : '400',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: '16px' }}>{item.icon}</span>
                {item.label}
              </a>
            )
          })}
        </nav>

        {/* Admin user */}
        <div style={{ padding: '12px 16px', borderTop: '0.5px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <div style={{ width: '28px', height: '28px', background: '#1B6B3A', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', color: '#fff', flexShrink: 0 }}>
              {adminName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p style={{ fontSize: '12px', fontWeight: '600', color: '#fff', margin: 0 }}>{adminName}</p>
              <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>Super Admin</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            style={{ width: '100%', background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: 'none', borderRadius: '7px', padding: '7px', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}
          >
            Sign out
          </button>
          <a
            href="/"
            style={{ display: 'block', textAlign: 'center', marginTop: '6px', fontSize: '11px', color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}
          >
            View website →
          </a>
        </div>
      </aside>

      {/* Main content */}
      <div style={{ marginLeft: '220px', flex: 1, minHeight: '100vh' }}>
        {children}
      </div>

    </div>
  )
}
