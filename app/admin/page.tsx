'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface DayStats {
  total: number
  booked: number
  reserved: number
  blocked: number
  available: number
  revenue: number
}

interface RecentBooking {
  id: string
  created_at: string
  total_lkr: number
  status: string
  user_id: string
  slot_id: string
  slots?: { slot_date: string; start_time: string; end_time: string; court_type: string }
  profiles?: { full_name: string | null; phone: string | null }
}

const COURT_TYPE_LABELS: Record<string, string> = {
  full_court: 'Full Court', half_a: 'Half A', half_b: 'Half B',
}

export default function AdminDashboard() {
  const [selectedDate, setSelectedDate] = useState(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
  )
  const [dayStats, setDayStats] = useState<DayStats>({
    total: 0, booked: 0, reserved: 0, blocked: 0, available: 0, revenue: 0
  })
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [totalBookings, setTotalBookings] = useState(0)
  const [pendingCancellations, setPendingCancellations] = useState(0)
  const [recentBookings, setRecentBookings] = useState<RecentBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(false)

  useEffect(() => { loadAll() }, [])
  useEffect(() => { loadDayStats() }, [selectedDate])

  const loadAll = async () => {
    const [
      { data: allBookings },
      { data: pendingData },
      { data: recent },
    ] = await Promise.all([
      supabase.from('bookings').select('total_lkr').eq('status', 'confirmed'),
      supabase.from('bookings').select('id').eq('status', 'cancellation_requested'),
      supabase.from('bookings').select('*').order('created_at', { ascending: false }).limit(5),
    ])

    setTotalRevenue(allBookings?.reduce((sum, b) => sum + (b.total_lkr || 0), 0) || 0)
    setTotalBookings(allBookings?.length || 0)
    setPendingCancellations(pendingData?.length || 0)

    if (recent) {
      const enriched = await Promise.all(
        recent.map(async (booking: any) => {
          const [{ data: slotData }, { data: profileData }] = await Promise.all([
            supabase.from('slots').select('slot_date, start_time, end_time, court_type').eq('id', booking.slot_id).single(),
            supabase.from('profiles').select('full_name, phone').eq('id', booking.user_id).single(),
          ])
          return { ...booking, slots: slotData, profiles: profileData }
        })
      )
      setRecentBookings(enriched)
    }
    setLoading(false)
    loadDayStats()
  }

  const loadDayStats = async () => {
    setStatsLoading(true)
    const { data: slots } = await supabase
      .from('slots')
      .select('status, price_lkr')
      .eq('slot_date', selectedDate)

    if (slots) {
      const total = slots.length
      const booked = slots.filter(s => s.status === 'booked').length
      const reserved = slots.filter(s => s.status === 'locked').length
      const blocked = slots.filter(s => s.status === 'blocked').length
      const available = slots.filter(s => s.status === 'available').length
      const revenue = slots.filter(s => s.status === 'booked').reduce((sum, s) => sum + (s.price_lkr || 0), 0)
      setDayStats({ total, booked, reserved, blocked, available, revenue })
    }

    setStatsLoading(false)
  }

  return (
    <div style={{ padding: '28px 32px' }}>

      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>Dashboard</h1>
        <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Colombo' })}
        </p>
      </div>

      {/* Overall stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '28px' }}>
        {[
          { label: 'Total Bookings', value: totalBookings, icon: '📊', color: '#7C3AED', bg: '#F5F3FF' },
          { label: 'Total Revenue', value: `LKR ${totalRevenue.toLocaleString()}`, icon: '💵', color: '#B45309', bg: '#FEF3C7' },
          { label: 'Pending Cancellations', value: pendingCancellations, icon: '⚠️', color: '#DC2626', bg: '#FEE2E2', alert: pendingCancellations > 0 },
        ].map((card: any) => (
          <div key={card.label} style={{ background: '#fff', borderRadius: '12px', border: `0.5px solid ${card.alert ? '#FECACA' : '#E2E8F0'}`, padding: '18px', position: 'relative', overflow: 'hidden' }}>
            {card.alert && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: '#DC2626' }} />}
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
              <a href="/admin/bookings" style={{ fontSize: '11px', color: '#DC2626', textDecoration: 'none', fontWeight: '600', display: 'block', marginTop: '8px' }}>Review now →</a>
            )}
          </div>
        ))}
      </div>

      {/* Date stats */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: '0 0 2px' }}>Daily Breakdown</p>
            <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>Slot and revenue summary for selected date</p>
          </div>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '7px 10px', fontSize: '13px', color: '#0F172A', outline: 'none' }}
          />
        </div>

        {statsLoading ? (
          <p style={{ color: '#64748B', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Loading...</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '16px' }}>
              {[
                { label: 'Total Slots', value: dayStats.total, color: '#0F172A', bg: '#F8FAFC' },
                { label: 'Available', value: dayStats.available, color: '#065F46', bg: '#ECFDF5' },
                { label: 'Booked', value: dayStats.booked, color: '#1D4ED8', bg: '#EFF6FF' },
                { label: 'Reserved', value: dayStats.reserved, color: '#92400E', bg: '#FFFBEB' },
                { label: 'Blocked', value: dayStats.blocked, color: '#64748B', bg: '#F1F5F9' },
              ].map(stat => (
                <div key={stat.label} style={{ background: stat.bg, borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
                  <p style={{ fontSize: '24px', fontWeight: '800', color: stat.color, margin: '0 0 4px' }}>{stat.value}</p>
                  <p style={{ fontSize: '11px', color: stat.color, opacity: 0.7, margin: 0, fontWeight: '500' }}>{stat.label}</p>
                </div>
              ))}
            </div>

            <div style={{ background: '#ECFDF5', borderRadius: '10px', padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '12px', color: '#065F46', margin: '0 0 2px', fontWeight: '500' }}>Revenue for {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                <p style={{ fontSize: '28px', fontWeight: '800', color: '#1B6B3A', margin: 0 }}>LKR {dayStats.revenue.toLocaleString()}</p>
              </div>
              <div style={{ fontSize: '36px' }}>💰</div>
            </div>

            {/* Visual bar */}
            {dayStats.total > 0 && (
              <div style={{ marginTop: '14px' }}>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 6px', fontWeight: '500' }}>SLOT DISTRIBUTION</p>
                <div style={{ display: 'flex', height: '12px', borderRadius: '6px', overflow: 'hidden', gap: '2px' }}>
                  {dayStats.booked > 0 && <div style={{ flex: dayStats.booked, background: '#3B82F6', borderRadius: '3px' }} title={`Booked: ${dayStats.booked}`} />}
                  {dayStats.reserved > 0 && <div style={{ flex: dayStats.reserved, background: '#F59E0B', borderRadius: '3px' }} title={`Reserved: ${dayStats.reserved}`} />}
                  {dayStats.blocked > 0 && <div style={{ flex: dayStats.blocked, background: '#94A3B8', borderRadius: '3px' }} title={`Blocked: ${dayStats.blocked}`} />}
                  {dayStats.available > 0 && <div style={{ flex: dayStats.available, background: '#ECFDF5', border: '1px solid #6EE7B7', borderRadius: '3px' }} title={`Available: ${dayStats.available}`} />}
                </div>
                <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
                  {[
                    { color: '#3B82F6', label: 'Booked' },
                    { color: '#F59E0B', label: 'Reserved' },
                    { color: '#94A3B8', label: 'Blocked' },
                    { color: '#6EE7B7', label: 'Available' },
                  ].map(l => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: l.color }} />
                      <span style={{ fontSize: '10px', color: '#64748B' }}>{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Quick Actions */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '20px' }}>
        <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: '0 0 14px' }}>Quick Actions</p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            { label: 'Manage slots', href: '/admin/slots', icon: '🕐' },
            { label: 'View bookings', href: '/admin/bookings', icon: '📅' },
            { label: 'Recurring bookings', href: '/admin/recurring', icon: '🔄' },
            { label: 'Manage courts', href: '/admin/courts', icon: '🏀' },
            { label: 'Add product', href: '/admin/products', icon: '🛒' },
          ].map(action => (
            <a key={action.label} href={action.href}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#F8FAFC', border: '0.5px solid #E2E8F0', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', color: '#0F172A', textDecoration: 'none', fontWeight: '500' }}>
              <span>{action.icon}</span>{action.label}
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

        {loading ? (
          <p style={{ color: '#64748B', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Loading...</p>
        ) : recentBookings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: '#94A3B8' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📅</div>
            <p style={{ fontSize: '13px', margin: 0 }}>No bookings yet</p>
          </div>
        ) : (
          <div>
            {recentBookings.map((booking, i) => (
              <div key={booking.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < recentBookings.length - 1 ? '0.5px solid #F1F5F9' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '36px', height: '36px', background: '#ECFDF5', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>🏀</div>
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: '0 0 1px' }}>
                      {booking.profiles?.full_name || booking.profiles?.phone || 'Customer'}
                    </p>
                    <p style={{ fontSize: '11px', color: '#64748B', margin: '0 0 1px' }}>📱 {booking.profiles?.phone || 'N/A'}</p>
                    {booking.slots && (
                      <p style={{ fontSize: '11px', color: '#94A3B8', margin: 0 }}>
                        {booking.slots.slot_date} · {booking.slots.start_time?.slice(0,5)} - {booking.slots.end_time?.slice(0,5)} · {COURT_TYPE_LABELS[booking.slots.court_type] || ''}
                      </p>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '13px', fontWeight: '700', color: '#1B6B3A', margin: '0 0 2px' }}>LKR {booking.total_lkr?.toLocaleString()}</p>
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
