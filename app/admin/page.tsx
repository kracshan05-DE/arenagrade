'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Stats {
  totalBookings: number
  todayBookings: number
  totalRevenue: number
  todayRevenue: number
  pendingCancellations: number
  availableSlotsToday: number
}

interface RecentBooking {
  id: string
  created_at: string
  total_lkr: number
  status: string
  slots: {
    slot_date: string
    start_time: string
    end_time: string
    court_type: string
  }
  profiles: {
    full_name: string
    phone: string
  }
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats>({
    totalBookings: 0,
    todayBookings: 0,
    totalRevenue: 0,
    todayRevenue: 0,
    pendingCancellations: 0,
    availableSlotsToday: 0,
  })
  const [recentBookings, setRecentBookings] = useState<RecentBooking[]>([])
  const [loading, setLoading] = useState(true)

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    const loadData = async () => {
      const [
        { data: allBookings },
        { data: todayBookings },
        { data: pendingCancellations },
        { data: availableSlots },
        { data: recent },
      ] = await Promise.all([
        supabase.from('bookings').select('total_lkr, status').eq('status', 'confirmed'),
        supabase.from('bookings').select('total_lkr').eq('status', 'confirmed').gte('created_at', `${today}T00:00:00`),
        supabase.from('bookings').select('id').eq('status', 'cancellation_requested'),
        supabase.from('slots').select('id').eq('status', 'available').eq('slot_date', today),
        supabase.from('bookings')
          .select(`*, slots(slot_date, start_time, end_time, court_type), profiles(full_name, phone)`)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      setStats({
        totalBookings: allBookings?.length || 0,
        todayBookings: todayBookings?.length || 0,
        totalRevenue: allBookings?.reduce((sum, b) => sum + (b.total_lkr || 0), 0) || 0,
        todayRevenue: todayBookings?.reduce((sum, b) => sum + (b.total_lkr || 0), 0) || 0,
        pendingCancellations: pendingCancellations?.length || 0,
        availableSlotsToday: availableSlots?.length || 0,
      })

      if (recent) setRecentBookings(recent as any)
      setLoading(false)
    }
    loadData()
  }, [])

  const COURT_TYPE_LABELS: Record<string, string> = {
    full_court: 'Full Court',
    half_a: 'Half A',
    half_b: 'Half B',
  }

  const statCards = [
    { label: "Today's Bookings", value: stats.todayBookings, icon: '📅', color: '#1B6B3A', bg: '#ECFDF5' },
    { label: "Today's Revenue", value: `LKR ${stats.todayRevenue.toLocaleString()}`, icon: '💰', color: '#1D4ED8', bg: '#EFF6FF' },
    { label: 'Total Bookings', value: stats.totalBookings, icon: '📊', color: '#7C3AED', bg: '#F5F3FF' },
    { label: 'Total Revenue', value: `LKR ${stats.totalRevenue.toLocaleString()}`, icon: '💵', color: '#B45309', bg: '#FEF3C7' },
    { label: 'Pending Cancellations', value: stats.pendingCancellations, icon: '⚠️', color: '#DC2626', bg: '#FEE2E2', alert: stats.pendingCancellations > 0 },
    { label: 'Available Slots Today', value: stats.availableSlotsToday, icon: '🟢', color: '#047857', bg: '#ECFDF5' },
  ]

  return (
    <div style={{ padding: '28px 32px' }}>

      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>Dashboard</h1>
        <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Stat Cards */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '28px' }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '20px', height: '90px', animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '28px' }}>
          {statCards.map(card => (
            <div key={card.label} style={{ background: '#fff', borderRadius: '12px', border: `0.5px solid ${card.alert ? '#FECACA' : '#E2E8F0'}`, padding: '18px', position: 'relative', overflow: 'hidden' }}>
              {card.alert && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: '#DC2626' }} />
              )}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontSize: '11px', color: '#94A3B8', fontWeight: '500', letterSpacing: '0.04em', margin: '0 0 8px' }}>{card.label.toUpperCase()}</p>
                  <p style={{ fontSize: '22px', fontWeight: '800', color: card.color, margin: 0 }}>{card.value}</p>
                </div>
                <div style={{ width: '36px', height: '36px', background: card.bg, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                  {card.icon}
                </div>
              </div>
              {card.alert && (
                <a href="/admin/bookings" style={{ fontSize: '11px', color: '#DC2626', textDecoration: 'none', fontWeight: '600', display: 'block', marginTop: '8px' }}>
                  Review now →
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '20px' }}>
        <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: '0 0 14px' }}>Quick Actions</p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            { label: 'Add slots for today', href: '/admin/slots', icon: '🕐' },
            { label: 'View all bookings', href: '/admin/bookings', icon: '📅' },
            { label: 'Manage courts', href: '/admin/courts', icon: '🏀' },
            { label: 'Add product', href: '/admin/products', icon: '🛒' },
          ].map(action => (
            <a
              key={action.label}
              href={action.href}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#F8FAFC', border: '0.5px solid #E2E8F0', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', color: '#0F172A', textDecoration: 'none', fontWeight: '500' }}
            >
              <span>{action.icon}</span>
              {action.label}
            </a>
          ))}
        </div>
      </div>

      {/* Recent Bookings */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>Recent Bookings</p>
          <a href="/admin/bookings" style={{ fontSize: '12px', color: '#1B6B3A', textDecoration: 'none', fontWeight: '500' }}>View all →</a>
        </div>

        {recentBookings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: '#94A3B8' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📅</div>
            <p style={{ fontSize: '13px', margin: 0 }}>No bookings yet</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {recentBookings.map((booking, i) => (
              <div key={booking.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < recentBookings.length - 1 ? '0.5px solid #F1F5F9' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '36px', height: '36px', background: '#ECFDF5', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>
                    🏀
                  </div>
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: '0 0 2px' }}>
                      {booking.profiles?.full_name || 'Customer'}
                    </p>
                    <p style={{ fontSize: '11px', color: '#64748B', margin: 0 }}>
                      {booking.slots?.slot_date} · {booking.slots?.start_time?.slice(0,5)} - {booking.slots?.end_time?.slice(0,5)} · {COURT_TYPE_LABELS[booking.slots?.court_type] || ''}
                    </p>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '13px', fontWeight: '700', color: '#1B6B3A', margin: '0 0 2px' }}>
                    LKR {booking.total_lkr?.toLocaleString()}
                  </p>
                  <span style={{
                    fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: '500',
                    background: booking.status === 'confirmed' ? '#ECFDF5' : booking.status === 'cancellation_requested' ? '#FEE2E2' : '#F1F5F9',
                    color: booking.status === 'confirmed' ? '#065F46' : booking.status === 'cancellation_requested' ? '#DC2626' : '#64748B',
                  }}>
                    {booking.status === 'confirmed' ? 'Confirmed' : booking.status === 'cancellation_requested' ? 'Cancel Requested' : booking.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
