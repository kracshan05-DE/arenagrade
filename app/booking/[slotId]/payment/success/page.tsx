'use client'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { supabase, getCurrentUser } from '@/lib/supabase'
import Navbar from '@/components/Navbar'

interface Booking {
  id: string
  total_lkr: number
  payhere_payment_id: string
  slots: {
    slot_date: string
    start_time: string
    end_time: string
    court_type: string
  }
  courts: {
    name: string
    locations: { name: string; address: string }
  }
}

const COURT_TYPE_LABELS: Record<string, string> = {
  full_court: 'Full Court',
  half_a: 'Half Court A',
  half_b: 'Half Court B',
}

export default function SuccessPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slotId = params.slotId as string
  const ref = searchParams.get('ref') || ''

  const [booking, setBooking] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser()
      if (!user) { setLoading(false); return }

      const { data } = await supabase
        .from('bookings')
        .select(`*, slots(slot_date, start_time, end_time, court_type), courts(name, locations(name, address))`)
        .eq('slot_id', slotId)
        .eq('user_id', user.id)
        .eq('status', 'confirmed')
        .single()

      if (data) {
        setBooking(data)

        // Load profile for phone
        const { data: profile } = await supabase
          .from('profiles')
          .select('phone')
          .eq('id', user.id)
          .single()

        // Send booking confirmation SMS
        if (profile?.phone) {
          const { sendBookingConfirmationSMS } = await import('@/lib/sms')
          await sendBookingConfirmationSMS({
            phone: profile.phone,
            court_name: data.courts?.name || '',
            slot_date: data.slots?.slot_date || '',
            start_time: data.slots?.start_time?.slice(0,5) || '',
            end_time: data.slots?.end_time?.slice(0,5) || '',
            court_type: data.slots?.court_type || '',
            amount: data.total_lkr,
            reference: ref || data.payhere_payment_id || '',
          })
        }

        // Send booking confirmation email
        const { data: userAuth } = await supabase.auth.getUser()
        if (userAuth?.user?.email) {
          const { sendBookingConfirmationEmail } = await import('@/lib/email')
          await sendBookingConfirmationEmail({
            customer_email: userAuth.user.email,
            customer_name: userAuth.user.user_metadata?.full_name || userAuth.user.email.split('@')[0],
            court_name: data.courts?.name || '',
            location: data.courts?.locations?.name || '',
            slot_date: data.slots?.slot_date || '',
            start_time: data.slots?.start_time?.slice(0,5) || '',
            end_time: data.slots?.end_time?.slice(0,5) || '',
            court_type: data.slots?.court_type === 'full_court' ? 'Full Court'
              : data.slots?.court_type === 'half_a' ? 'Half Court A' : 'Half Court B',
            amount: data.total_lkr,
            reference: ref || data.payhere_payment_id || '',
          })
        }
      }

      setLoading(false)
    }
    load()
  }, [slotId])

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  }

  return (
    <main style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
      <Navbar />

      <div style={{ maxWidth: '480px', margin: '48px auto', padding: '0 16px 48px' }}>

        {/* Success */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ width: '72px', height: '72px', background: '#ECFDF5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px', margin: '0 auto 16px', border: '3px solid #6EE7B7' }}>
            ✅
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 6px' }}>Booking Confirmed!</h1>
          <p style={{ fontSize: '14px', color: '#64748B', margin: 0 }}>Your court has been successfully booked. See you on the court!</p>
        </div>

        {/* Booking details */}
        {!loading && booking && (
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
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{booking.slots?.start_time?.slice(0,5)} - {booking.slots?.end_time?.slice(0,5)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Court type</p>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{COURT_TYPE_LABELS[booking.slots?.court_type]}</p>
                </div>
                <div>
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Amount paid</p>
                  <p style={{ fontSize: '13px', fontWeight: '700', color: '#1B6B3A', margin: 0 }}>LKR {booking.total_lkr?.toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '0.5px solid #F1F5F9' }}>
              <div>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 2px' }}>Booking reference</p>
                <p style={{ fontSize: '12px', fontWeight: '600', color: '#0F172A', margin: 0, fontFamily: 'monospace' }}>{ref || booking.payhere_payment_id}</p>
              </div>
              <span style={{ fontSize: '11px', background: '#ECFDF5', color: '#065F46', padding: '4px 10px', borderRadius: '20px', fontWeight: '600' }}>
                Confirmed
              </span>
            </div>
          </div>
        )}

        {loading && (
          <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '40px', textAlign: 'center' }}>
            <p style={{ color: '#64748B', fontSize: '14px' }}>Loading booking details...</p>
          </div>
        )}

        {/* Info */}
        <div style={{ background: '#EFF6FF', border: '0.5px solid #BFDBFE', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <p style={{ fontSize: '13px', fontWeight: '600', color: '#1D4ED8', margin: '0 0 4px' }}>📱 Confirmation sent</p>
          <p style={{ fontSize: '12px', color: '#3B82F6', margin: 0 }}>An SMS and email confirmation has been sent to your registered number and email address.</p>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <a href="/"
            style={{ flex: 1, background: '#F1F5F9', color: '#64748B', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: '600', textDecoration: 'none', textAlign: 'center' }}>
            Back to home
          </a>
          <a href="/"
            style={{ flex: 1, background: '#1B6B3A', color: '#fff', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: '600', textDecoration: 'none', textAlign: 'center' }}>
            Book another court
          </a>
        </div>

      </div>
    </main>
  )
}
