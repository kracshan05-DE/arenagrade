'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { supabase, getCurrentUser } from '@/lib/supabase'
import Navbar from '@/components/Navbar'

// PayHere sends the customer here after paying, but this redirect proves
// nothing. The page only shows what the server recorded after verifying
// PayHere's own notification, and keeps checking for up to ~2 minutes.

interface Booking {
  id: string
  total_lkr: number
  payhere_payment_id: string
  idempotency_key: string | null
  slots: { slot_date: string; start_time: string; end_time: string; court_type: string } | null
  booking_slots: { slots: { start_time: string; end_time: string } | null }[] | null
  courts: { name: string; locations: { name: string; address: string } | null } | null
}

type View = 'checking' | 'confirmed' | 'paid_unconfirmed' | 'failed' | 'pending_timeout' | 'signed_out'

const COURT_TYPE_LABELS: Record<string, string> = { full_court: 'Full Court', half_a: 'Half Court A', half_b: 'Half Court B' }
const POLL_MS = 3000
const MAX_POLLS = 40

export default function SuccessPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slotId = params.slotId as string
  const order = searchParams.get('order') || searchParams.get('order_id') || ''

  const [view, setView] = useState<View>('checking')
  const [booking, setBooking] = useState<Booking | null>(null)
  const polls = useRef(0)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const loadBooking = async (userId: string) => {
      let q = supabase
        .from('bookings')
        .select('id, total_lkr, payhere_payment_id, idempotency_key, slots(slot_date, start_time, end_time, court_type), booking_slots(slots(start_time, end_time)), courts(name, locations(name, address))')
        .eq('slot_id', slotId).eq('user_id', userId).in('status', ['confirmed', 'cancellation_requested'])
      if (order) q = q.eq('idempotency_key', order)
      const { data } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
      return data as unknown as Booking | null
    }

    const check = async () => {
      const user = await getCurrentUser()
      if (!user) { setView('signed_out'); return }

      if (order) {
        const { data: attempt } = await supabase
          .from('payment_attempts').select('status').eq('order_id', order).maybeSingle()
        const status = attempt?.status as string | undefined
        if (status === 'succeeded') {
          const b = await loadBooking(user.id)
          if (b) { setBooking(b); setView('confirmed'); return }
        } else if (status === 'succeeded_unconfirmed') {
          setView('paid_unconfirmed'); return
        } else if (status === 'failed' || status === 'cancelled') {
          setView('failed'); return
        }
      } else {
        const b = await loadBooking(user.id)
        if (b) { setBooking(b); setView('confirmed'); return }
      }

      polls.current += 1
      if (polls.current >= MAX_POLLS) { setView('pending_timeout'); return }
      if (!stopped) timer = setTimeout(check, POLL_MS)
    }

    check()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [slotId, order])

  // All hours of the booking (a two-hour Solo Court booking has two).
  const range = (b: Booking) => {
    const hrs = (b.booking_slots ?? []).map((x) => x.slots).filter((x): x is { start_time: string; end_time: string } => !!x)
      .sort((a, c) => a.start_time.localeCompare(c.start_time))
    const start = (hrs[0]?.start_time ?? b.slots?.start_time ?? '').slice(0, 5)
    const end = (hrs[hrs.length - 1]?.end_time ?? b.slots?.end_time ?? '').slice(0, 5)
    return `${start} - ${end}${hrs.length > 1 ? ` (${hrs.length} hours)` : ''}`
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return ''
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  }

  const header = {
    checking: { icon: '⏳', bg: '#EFF6FF', border: '#BFDBFE', title: 'Confirming your payment…', text: 'Waiting for PayHere to confirm the payment. This usually takes a few seconds — please keep this page open.' },
    confirmed: { icon: '✅', bg: '#ECFDF5', border: '#6EE7B7', title: 'Booking Confirmed!', text: 'Your payment was verified and your court is booked. See you on the court!' },
    paid_unconfirmed: { icon: '⚠️', bg: '#FFFBEB', border: '#FDE68A', title: 'Payment received — booking not confirmed', text: 'Your payment arrived after your 10-minute reservation ended, so the slot was released. You will receive a full refund; we will contact you by SMS.' },
    failed: { icon: '❌', bg: '#FEF2F2', border: '#FECACA', title: 'Payment not completed', text: 'PayHere reported that the payment failed or was cancelled. No booking was made. You can go back and try again while your reservation lasts.' },
    pending_timeout: { icon: '🕒', bg: '#FFFBEB', border: '#FDE68A', title: 'Still waiting for confirmation', text: 'We have not received PayHere’s confirmation yet. Do not pay again. Check My Bookings in a few minutes; if you were charged and no booking appears, contact info@arenagrade.lk with your reference.' },
    signed_out: { icon: '🔒', bg: '#F1F5F9', border: '#CBD5E1', title: 'Please sign in', text: 'Sign in to see the status of your booking.' },
  }[view]

  return (
    <main style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
      <Navbar />

      <div style={{ maxWidth: '480px', margin: '48px auto', padding: '0 16px 48px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ width: '72px', height: '72px', background: header.bg, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px', margin: '0 auto 16px', border: `3px solid ${header.border}` }}>
            {header.icon}
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 6px' }}>{header.title}</h1>
          <p style={{ fontSize: '14px', color: '#64748B', margin: 0 }}>{header.text}</p>
          {order && <p style={{ fontSize: '12px', color: '#94A3B8', margin: '10px 0 0', fontFamily: 'monospace' }}>Reference: {order}</p>}
        </div>

        {view === 'confirmed' && booking && (
          <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '14px' }}>
            <p style={{ fontSize: '11px', color: '#94A3B8', fontWeight: '500', letterSpacing: '0.04em', margin: '0 0 16px' }}>BOOKING DETAILS</p>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <div style={{ width: '48px', height: '48px', background: '#ECFDF5', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}>🏀</div>
              <div>
                <p style={{ fontSize: '15px', fontWeight: '700', color: '#0F172A', margin: '0 0 2px' }}>{booking.courts?.name}</p>
                <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>📍 {booking.courts?.locations?.name}</p>
              </div>
            </div>
            <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Date</p>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{formatDate(booking.slots?.slot_date)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Time</p>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{range(booking)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Court type</p>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{COURT_TYPE_LABELS[booking.slots?.court_type ?? '']}</p>
                </div>
                <div>
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Amount paid</p>
                  <p style={{ fontSize: '13px', fontWeight: '700', color: '#1B6B3A', margin: 0 }}>LKR {Number(booking.total_lkr).toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '0.5px solid #F1F5F9' }}>
              <div>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 2px' }}>Booking reference</p>
                <p style={{ fontSize: '12px', fontWeight: '600', color: '#0F172A', margin: 0, fontFamily: 'monospace' }}>{booking.idempotency_key || booking.payhere_payment_id}</p>
              </div>
              <span style={{ fontSize: '11px', background: '#ECFDF5', color: '#065F46', padding: '4px 10px', borderRadius: '20px', fontWeight: '600' }}>Confirmed</span>
            </div>
          </div>
        )}

        {view === 'confirmed' && (
          <div style={{ background: '#EFF6FF', border: '0.5px solid #BFDBFE', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
            <p style={{ fontSize: '13px', fontWeight: '600', color: '#1D4ED8', margin: '0 0 4px' }}>📱 Confirmation on its way</p>
            <p style={{ fontSize: '12px', color: '#3B82F6', margin: 0 }}>We send an SMS and email confirmation to your registered number and email address.</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          {view === 'failed' ? (
            <a href={`/booking/${slotId}/payment`}
              style={{ flex: 1, background: '#1B6B3A', color: '#fff', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: '600', textDecoration: 'none', textAlign: 'center' }}>
              Try payment again
            </a>
          ) : (
            <a href="/my-bookings"
              style={{ flex: 1, background: '#F1F5F9', color: '#64748B', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: '600', textDecoration: 'none', textAlign: 'center' }}>
              My bookings
            </a>
          )}
          <a href="/"
            style={{ flex: 1, background: view === 'failed' ? '#F1F5F9' : '#1B6B3A', color: view === 'failed' ? '#64748B' : '#fff', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: '600', textDecoration: 'none', textAlign: 'center' }}>
            Book another court
          </a>
        </div>
      </div>
    </main>
  )
}
