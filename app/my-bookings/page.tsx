'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getCurrentUser } from '@/lib/supabase'
import Navbar from '@/components/Navbar'
import { BookingSkeleton } from '@/components/Skeleton'

interface Booking {
  id: string
  created_at: string
  total_lkr: number
  status: string
  cancellation_reason: string | null
  refund_amount_lkr: number | null
  payhere_payment_id: string | null
  slot_id: string
  court_id: string
}

interface SlotInfo {
  slot_date: string
  start_time: string
  end_time: string
  court_type: string
}

interface CourtInfo {
  name: string
  locations: { name: string }
  sport_types: { name: string }
}

interface EnrichedBooking extends Booking {
  slot?: SlotInfo
  court?: CourtInfo
}

const COURT_TYPE_LABELS: Record<string, string> = {
  full_court: 'Full Court',
  half_a: 'Half Court A',
  half_b: 'Half Court B',
}

const STATUS_CONFIG: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  confirmed:              { bg: '#ECFDF5', color: '#065F46', label: 'Confirmed',        icon: '✅' },
  cancellation_requested: { bg: '#FEF3C7', color: '#92400E', label: 'Cancel Requested', icon: '⏳' },
  cancelled:              { bg: '#F1F5F9', color: '#64748B', label: 'Cancelled',         icon: '❌' },
}

export default function MyBookingsPage() {
  const router = useRouter()
  const [bookings, setBookings] = useState<EnrichedBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [fetchError, setFetchError] = useState('')

  useEffect(() => {
    const init = async () => {
      const user = await getCurrentUser()
      if (!user) { router.push('/auth'); return }
      await loadBookings(user.id)
    }
    init()
  }, [router])

  const loadBookings = async (userId: string) => {
    setLoading(true)
    setFetchError('')

    const { data: bookingsData, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      setFetchError('Could not load your bookings. Please refresh the page.')
      setLoading(false)
      return
    }

    if (!bookingsData || bookingsData.length === 0) {
      setBookings([])
      setLoading(false)
      return
    }

    const enriched: EnrichedBooking[] = await Promise.all(
      bookingsData.map(async (booking) => {
        const [{ data: slotData }, { data: courtData }] = await Promise.all([
          supabase.from('slots').select('slot_date, start_time, end_time, court_type').eq('id', booking.slot_id).single(),
          supabase.from('courts').select('name, locations(name), sport_types(name)').eq('id', booking.court_id).single(),
        ])
        return { ...booking, slot: slotData || undefined, court: courtData as any || undefined }
      })
    )

    setBookings(enriched)
    setLoading(false)
  }

  const isUpcoming = (dateStr: string, startTime?: string) => {
    const slotDateTime = new Date(`${dateStr}T${startTime || '00:00:00'}`)
    const hoursUntilSlot = (slotDateTime.getTime() - Date.now()) / (1000 * 60 * 60)
    return hoursUntilSlot >= 24
  }

  const requestCancellation = async (booking: EnrichedBooking) => {
    if (!cancelReason.trim()) { setMessage('Please enter a reason for cancellation.'); return }
    setSubmitting(true)

    const { error } = await supabase
      .from('bookings')
      .update({ status: 'cancellation_requested', cancellation_reason: cancelReason.trim() })
      .eq('id', booking.id)

    if (error) {
      setMessage('Something went wrong. Please try again.')
      setSubmitting(false)
      return
    }

    setCancellingId(null)
    setCancelReason('')
    setMessage('Cancellation request submitted. We will review and get back to you within 24 hours.')
    const user = await getCurrentUser()
    if (user) await loadBookings(user.id)
    setSubmitting(false)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
  }

  const upcomingBookings = bookings.filter(b => b.slot && isUpcoming(b.slot.slot_date, b.slot.start_time) && b.status === 'confirmed')
  const pastBookings = bookings.filter(b => !upcomingBookings.includes(b))

  const BookingCard = ({ booking }: { booking: EnrichedBooking }) => {
    const st = STATUS_CONFIG[booking.status] || STATUS_CONFIG.cancelled
    const isExpanded = expandedId === booking.id
    const isCancelling = cancellingId === booking.id
    const canCancel = booking.status === 'confirmed' && booking.slot ? isUpcoming(booking.slot.slot_date, booking.slot.start_time) : false

    return (
      <div style={{ background: '#fff', borderRadius: '14px', border: `0.5px solid ${booking.status === 'cancellation_requested' ? '#FDE68A' : '#E2E8F0'}`, overflow: 'hidden', marginBottom: '10px' }}>
        <div style={{ padding: '16px 20px', cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : booking.id)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{ width: '44px', height: '44px', background: '#ECFDF5', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>🏀</div>
              <div>
                <p style={{ fontSize: '14px', fontWeight: '700', color: '#0F172A', margin: '0 0 3px' }}>{booking.court?.name || 'Court'}</p>
                <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 2px' }}>📍 {booking.court?.locations?.name || ''}</p>
                {booking.slot && (
                  <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0 }}>
                    📅 {formatDate(booking.slot.slot_date)} · {booking.slot.start_time?.slice(0,5)} - {booking.slot.end_time?.slice(0,5)} · {COURT_TYPE_LABELS[booking.slot.court_type] || ''}
                  </p>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '15px', fontWeight: '800', color: '#1B6B3A', margin: '0 0 4px' }}>LKR {booking.total_lkr?.toLocaleString()}</p>
                <span style={{ fontSize: '11px', background: st.bg, color: st.color, padding: '3px 10px', borderRadius: '20px', fontWeight: '600' }}>{st.icon} {st.label}</span>
              </div>
              <span style={{ fontSize: '16px', color: '#94A3B8' }}>{isExpanded ? '▲' : '▼'}</span>
            </div>
          </div>
        </div>

        {isExpanded && (
          <div style={{ borderTop: '0.5px solid #F1F5F9', padding: '16px 20px', background: '#F8FAFC' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>BOOKING REF</p>
                <p style={{ fontSize: '12px', color: '#0F172A', margin: 0, fontFamily: 'monospace' }}>{booking.payhere_payment_id || booking.id.slice(0,8) + '...'}</p>
              </div>
              <div>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>BOOKED ON</p>
                <p style={{ fontSize: '12px', color: '#0F172A', margin: 0 }}>{new Date(booking.created_at).toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}</p>
              </div>
              <div>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>SPORT</p>
                <p style={{ fontSize: '12px', color: '#0F172A', margin: 0 }}>{booking.court?.sport_types?.name || 'Basketball'}</p>
              </div>
              <div>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>AMOUNT PAID</p>
                <p style={{ fontSize: '12px', fontWeight: '700', color: '#1B6B3A', margin: 0 }}>LKR {booking.total_lkr?.toLocaleString()}</p>
              </div>
              {booking.cancellation_reason && (
                <div style={{ gridColumn: 'span 2' }}>
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>CANCELLATION REASON</p>
                  <p style={{ fontSize: '12px', color: '#92400E', margin: 0 }}>{booking.cancellation_reason}</p>
                </div>
              )}
              {booking.refund_amount_lkr && (
                <div>
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>REFUND AMOUNT</p>
                  <p style={{ fontSize: '12px', fontWeight: '700', color: '#1B6B3A', margin: 0 }}>LKR {booking.refund_amount_lkr.toLocaleString()}</p>
                </div>
              )}
            </div>

            {canCancel && (
              <div>
                {!isCancelling ? (
                  <button onClick={() => { setCancellingId(booking.id); setCancelReason('') }}
                    style={{ background: '#FEE2E2', color: '#DC2626', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                    Request cancellation
                  </button>
                ) : (
                  <div style={{ background: '#fff', border: '0.5px solid #FECACA', borderRadius: '10px', padding: '16px' }}>
                    <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: '0 0 4px' }}>Request cancellation</p>
                    <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 12px' }}>Please provide a reason. The admin will review and process your refund.</p>
                    <textarea value={cancelReason} onChange={e => { setCancelReason(e.target.value); setMessage('') }}
                      placeholder="e.g. I have an unexpected commitment and cannot attend..."
                      rows={3}
                      style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '10px', fontSize: '13px', outline: 'none', resize: 'vertical', boxSizing: 'border-box', marginBottom: '10px' }} />
                    <div style={{ background: '#FFFBEB', border: '0.5px solid #FDE68A', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
                      <p style={{ fontSize: '12px', color: '#92400E', margin: '0 0 3px', fontWeight: '600' }}>Refund policy</p>
                      <p style={{ fontSize: '12px', color: '#92400E', margin: 0 }}>
                        More than 24hrs before slot → Full refund<br />
                        Less than 24hrs before slot → No refund<br />
                        No-show → No refund
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => { setCancellingId(null); setCancelReason('') }}
                        style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                        Keep booking
                      </button>
                      <button onClick={() => requestCancellation(booking)}
                        disabled={submitting || !cancelReason.trim()}
                        style={{ flex: 2, background: submitting || !cancelReason.trim() ? '#94A3B8' : '#DC2626', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: submitting || !cancelReason.trim() ? 'not-allowed' : 'pointer' }}>
                        {submitting ? 'Submitting...' : 'Submit cancellation request'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {booking.status === 'cancellation_requested' && (
              <div style={{ background: '#FEF3C7', border: '0.5px solid #FDE68A', borderRadius: '8px', padding: '10px 14px' }}>
                <p style={{ fontSize: '12px', color: '#92400E', fontWeight: '600', margin: '0 0 2px' }}>⏳ Cancellation under review</p>
                <p style={{ fontSize: '12px', color: '#92400E', margin: 0 }}>Your request has been submitted. We will review and respond within 24 hours.</p>
              </div>
            )}

            {booking.status === 'cancelled' && booking.refund_amount_lkr && (
              <div style={{ background: '#ECFDF5', border: '0.5px solid #6EE7B7', borderRadius: '8px', padding: '10px 14px' }}>
                <p style={{ fontSize: '12px', color: '#065F46', fontWeight: '600', margin: '0 0 2px' }}>✅ Refund processed</p>
                <p style={{ fontSize: '12px', color: '#047857', margin: 0 }}>LKR {booking.refund_amount_lkr.toLocaleString()} will be returned to your original payment method within 5-7 business days.</p>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <main style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
      <Navbar />
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 16px 48px' }}>
        <div style={{ marginBottom: '28px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>My Bookings</h1>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>View and manage your court bookings</p>
        </div>

        {message && (
          <div style={{ background: '#ECFDF5', border: '0.5px solid #6EE7B7', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px' }}>
            <p style={{ fontSize: '13px', color: '#065F46', margin: 0 }}>✅ {message}</p>
          </div>
        )}

        {fetchError && (
          <div style={{ background: '#FEE2E2', border: '0.5px solid #FECACA', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{fetchError}</p>
            <button onClick={() => window.location.reload()}
              style={{ background: '#DC2626', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: '12px' }}>
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div>
            <BookingSkeleton />
            <BookingSkeleton />
            <BookingSkeleton />
          </div>
        ) : bookings.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📅</div>
            <p style={{ fontSize: '15px', fontWeight: '500', color: '#0F172A', margin: '0 0 4px' }}>No bookings yet</p>
            <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 20px' }}>Book your first court and it will appear here</p>
            <a href="/#book" style={{ background: '#1B6B3A', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>
              Find a court
            </a>
          </div>
        ) : (
          <div>
            {upcomingBookings.length > 0 && (
              <div style={{ marginBottom: '28px' }}>
                <p style={{ fontSize: '12px', color: '#1B6B3A', fontWeight: '700', letterSpacing: '0.06em', margin: '0 0 12px' }}>UPCOMING</p>
                {upcomingBookings.map(b => <BookingCard key={b.id} booking={b} />)}
              </div>
            )}
            {pastBookings.length > 0 && (
              <div>
                <p style={{ fontSize: '12px', color: '#94A3B8', fontWeight: '700', letterSpacing: '0.06em', margin: '0 0 12px' }}>PAST & OTHER BOOKINGS</p>
                {pastBookings.map(b => <BookingCard key={b.id} booking={b} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
