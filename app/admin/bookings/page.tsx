'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Booking {
  id: string
  created_at: string
  total_lkr: number
  status: string
  cancellation_reason: string | null
  cancelled_by: string | null
  refund_amount_lkr: number | null
  payhere_payment_id: string | null
  slots: {
    slot_date: string
    start_time: string
    end_time: string
    court_type: string
    court_id: string
  }
  profiles: {
    full_name: string
    phone: string
  }
}

const COURT_TYPE_LABELS: Record<string, string> = {
  full_court: 'Full Court',
  half_a: 'Half Court A',
  half_b: 'Half Court B',
}

const STATUS_CONFIG: Record<string, { bg: string; color: string; label: string }> = {
  confirmed:               { bg: '#ECFDF5', color: '#065F46', label: 'Confirmed' },
  cancellation_requested:  { bg: '#FEE2E2', color: '#DC2626', label: 'Cancel Requested' },
  cancelled:               { bg: '#F1F5F9', color: '#64748B', label: 'Cancelled' },
}

export default function AdminBookings() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadBookings()
  }, [filter])

  const loadBookings = async () => {
    setLoading(true)
    let query = supabase
      .from('bookings')
      .select(`*, slots(slot_date, start_time, end_time, court_type, court_id), profiles(full_name, phone)`)
      .order('created_at', { ascending: false })

    if (filter !== 'all') {
      query = query.eq('status', filter)
    }

    const { data } = await query
    if (data) setBookings(data as any)
    setLoading(false)
  }

  const approveCancel = async (booking: Booking) => {
    setProcessing(booking.id)
    const refundAmount = booking.total_lkr

    await supabase.from('bookings').update({
      status: 'cancelled',
      refund_amount_lkr: refundAmount,
      cancelled_by: 'admin',
    }).eq('id', booking.id)

    // Release the slot
    if (booking.slots?.court_id) {
      await supabase.from('slots').update({
        status: 'available',
        locked_by: null,
        lock_expires_at: null,
      }).eq('court_id', booking.slots.court_id)
        .eq('slot_date', booking.slots.slot_date)
        .eq('start_time', booking.slots.start_time)
        .eq('court_type', booking.slots.court_type)
    }

    setMessage(`Cancellation approved. Full refund of LKR ${refundAmount.toLocaleString()} to be processed via PayHere.`)
    setProcessing(null)
    await loadBookings()
  }

  const rejectCancel = async (bookingId: string) => {
    setProcessing(bookingId)
    await supabase.from('bookings').update({
      status: 'confirmed',
    }).eq('id', bookingId)
    setMessage('Cancellation request rejected. Booking remains confirmed.')
    setProcessing(null)
    await loadBookings()
  }

  const filterCounts = {
    all: bookings.length,
    confirmed: bookings.filter(b => b.status === 'confirmed').length,
    cancellation_requested: bookings.filter(b => b.status === 'cancellation_requested').length,
    cancelled: bookings.filter(b => b.status === 'cancelled').length,
  }

  return (
    <div style={{ padding: '28px 32px' }}>

      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>Bookings</h1>
        <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Manage all court bookings and cancellation requests</p>
      </div>

      {message && (
        <div style={{ background: '#ECFDF5', border: '0.5px solid #6EE7B7', borderRadius: '8px', padding: '10px 16px', marginBottom: '16px' }}>
          <p style={{ fontSize: '13px', color: '#065F46', margin: 0 }}>✅ {message}</p>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', background: '#fff', border: '0.5px solid #E2E8F0', borderRadius: '10px', padding: '4px', width: 'fit-content' }}>
        {[
          { key: 'all', label: 'All' },
          { key: 'confirmed', label: 'Confirmed' },
          { key: 'cancellation_requested', label: 'Cancel Requested' },
          { key: 'cancelled', label: 'Cancelled' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              background: filter === tab.key ? '#1B6B3A' : 'transparent',
              color: filter === tab.key ? '#fff' : '#64748B',
              border: 'none', borderRadius: '7px', padding: '6px 14px',
              fontSize: '12px', fontWeight: '600', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '5px',
            }}
          >
            {tab.label}
            {tab.key === 'cancellation_requested' && filterCounts.cancellation_requested > 0 && (
              <span style={{ background: '#DC2626', color: '#fff', borderRadius: '20px', padding: '1px 6px', fontSize: '10px' }}>
                {filterCounts.cancellation_requested}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Bookings list */}
      {loading ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <p style={{ color: '#64748B' }}>Loading bookings...</p>
        </div>
      ) : bookings.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>📅</div>
          <p style={{ fontSize: '15px', fontWeight: '500', color: '#0F172A', margin: '0 0 4px' }}>No bookings found</p>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Bookings will appear here once customers start booking</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {bookings.map(booking => {
            const st = STATUS_CONFIG[booking.status] || STATUS_CONFIG.cancelled
            const isExpanded = expandedId === booking.id
            const isCancelRequest = booking.status === 'cancellation_requested'

            return (
              <div
                key={booking.id}
                style={{ background: '#fff', borderRadius: '12px', border: `0.5px solid ${isCancelRequest ? '#FECACA' : '#E2E8F0'}`, overflow: 'hidden' }}
              >
                {isCancelRequest && (
                  <div style={{ background: '#FEE2E2', padding: '6px 16px', borderBottom: '0.5px solid #FECACA' }}>
                    <p style={{ fontSize: '11px', color: '#DC2626', fontWeight: '600', margin: 0 }}>⚠️ Cancellation requested — action required</p>
                  </div>
                )}

                <div
                  style={{ padding: '16px 20px', cursor: 'pointer' }}
                  onClick={() => setExpandedId(isExpanded ? null : booking.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div style={{ width: '40px', height: '40px', background: '#ECFDF5', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                        🏀
                      </div>
                      <div>
                        <p style={{ fontSize: '14px', fontWeight: '600', color: '#0F172A', margin: '0 0 3px' }}>
                          {booking.profiles?.full_name || 'Customer'}
                        </p>
                        <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>
                          📅 {booking.slots?.slot_date} · {booking.slots?.start_time?.slice(0,5)} - {booking.slots?.end_time?.slice(0,5)} · {COURT_TYPE_LABELS[booking.slots?.court_type] || ''}
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: '14px', fontWeight: '700', color: '#1B6B3A', margin: '0 0 3px' }}>
                          LKR {booking.total_lkr?.toLocaleString()}
                        </p>
                        <span style={{ fontSize: '10px', background: st.bg, color: st.color, padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>
                          {st.label}
                        </span>
                      </div>
                      <span style={{ fontSize: '16px', color: '#94A3B8' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div style={{ borderTop: '0.5px solid #F1F5F9', padding: '16px 20px', background: '#F8FAFC' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                      <div>
                        <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>BOOKING ID</p>
                        <p style={{ fontSize: '12px', color: '#0F172A', margin: 0, fontFamily: 'monospace' }}>{booking.id.slice(0,8)}...</p>
                      </div>
                      <div>
                        <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>PHONE</p>
                        <p style={{ fontSize: '12px', color: '#0F172A', margin: 0 }}>{booking.profiles?.phone || 'N/A'}</p>
                      </div>
                      <div>
                        <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>BOOKED AT</p>
                        <p style={{ fontSize: '12px', color: '#0F172A', margin: 0 }}>{new Date(booking.created_at).toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}</p>
                      </div>
                      {booking.payhere_payment_id && (
                        <div>
                          <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>PAYMENT REF</p>
                          <p style={{ fontSize: '12px', color: '#0F172A', margin: 0, fontFamily: 'monospace' }}>{booking.payhere_payment_id}</p>
                        </div>
                      )}
                      {booking.cancellation_reason && (
                        <div style={{ gridColumn: 'span 3' }}>
                          <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>CANCELLATION REASON</p>
                          <p style={{ fontSize: '12px', color: '#DC2626', margin: 0 }}>{booking.cancellation_reason}</p>
                        </div>
                      )}
                      {booking.refund_amount_lkr && (
                        <div>
                          <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>REFUND AMOUNT</p>
                          <p style={{ fontSize: '12px', color: '#1B6B3A', fontWeight: '700', margin: 0 }}>LKR {booking.refund_amount_lkr.toLocaleString()}</p>
                        </div>
                      )}
                    </div>

                    {/* Cancellation actions */}
                    {booking.status === 'cancellation_requested' && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => rejectCancel(booking.id)}
                          disabled={processing === booking.id}
                          style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
                        >
                          Reject — Keep Booking
                        </button>
                        <button
                          onClick={() => approveCancel(booking)}
                          disabled={processing === booking.id}
                          style={{ flex: 1, background: '#DC2626', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
                        >
                          {processing === booking.id ? 'Processing...' : `Approve — Full Refund LKR ${booking.total_lkr?.toLocaleString()}`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
