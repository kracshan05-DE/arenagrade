'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, getCurrentUser } from '@/lib/supabase'
import Navbar from '@/components/Navbar'

interface Slot {
  id: string
  slot_date: string
  start_time: string
  end_time: string
  court_type: string
  status: string
  price_lkr: number
  court_id: string
  locked_by: string
  lock_expires_at: string
}

interface Court {
  id: string
  name: string
  locations: { name: string; address: string }
  sport_types: { name: string }
}

interface Profile {
  full_name: string
  phone: string
}

const COURT_TYPE_LABELS: Record<string, string> = {
  full_court: 'Full Court',
  half_a: 'Half Court A',
  half_b: 'Half Court B',
}

export default function PaymentPage() {
  const params = useParams()
  const router = useRouter()
  const slotId = params.slotId as string

  const [slot, setSlot] = useState<Slot | null>(null)
  const [court, setCourt] = useState<Court | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [timeLeft, setTimeLeft] = useState(0)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    const init = async () => {
      const currentUser = await getCurrentUser()
      if (!currentUser) { router.push('/auth'); return }
      setUser(currentUser)

      const { data: profileData } = await supabase
        .from('profiles').select('full_name, phone').eq('id', currentUser.id).single()
      if (profileData) setProfile(profileData)

      const { data: slotData } = await supabase
        .from('slots').select('*').eq('id', slotId).single()

      if (!slotData) { setError('Slot not found.'); setLoading(false); return }

      if (slotData.status !== 'locked' || slotData.locked_by !== currentUser.id) {
        setError('Your reservation has expired or is invalid. Please go back and book again.')
        setLoading(false)
        return
      }

      const expiresAt = new Date(slotData.lock_expires_at).getTime()
      const remaining = Math.floor((expiresAt - Date.now()) / 1000)
      if (remaining <= 0) {
        setError('Your reservation has expired. Please go back and book again.')
        setLoading(false)
        return
      }

      setSlot(slotData)
      setTimeLeft(remaining)

      const { data: courtData } = await supabase
        .from('courts').select('*, locations(name, address), sport_types(name)').eq('id', slotData.court_id).single()
      if (courtData) setCourt(courtData)
      setLoading(false)
    }
    init()
  }, [slotId, router])

  useEffect(() => {
    if (timeLeft <= 0) return
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          setError('Your reservation has expired. Please go back and book again.')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [timeLeft > 0])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  }

  const timerColor = timeLeft < 120 ? '#DC2626' : timeLeft < 300 ? '#D97706' : '#1B6B3A'
  const timerBg = timeLeft < 120 ? '#FEE2E2' : timeLeft < 300 ? '#FFFBEB' : '#ECFDF5'
  const timerBorder = timeLeft < 120 ? '#FECACA' : timeLeft < 300 ? '#FDE68A' : '#6EE7B7'

  // Simulate payment completion (dummy flow)
  const completePayment = async () => {
    if (!slot || !court || !user) return
    setProcessing(true)

    const orderId = `AG-${Date.now()}-${slot.id.slice(0, 8)}`

    // 1. Mark slot as booked
    const { error: slotError } = await supabase
      .from('slots')
      .update({
        status: 'booked',
        locked_by: null,
        lock_expires_at: null,
      })
      .eq('id', slot.id)
      .eq('locked_by', user.id)

    if (slotError) {
      setError('Failed to confirm booking. Please try again.')
      setProcessing(false)
      return
    }

    // 2. Create booking record
    const { error: bookingError } = await supabase
      .from('bookings')
      .insert({
        user_id: user.id,
        slot_id: slot.id,
        court_id: slot.court_id,
        status: 'confirmed',
        total_lkr: slot.price_lkr,
        payhere_payment_id: orderId,
        idempotency_key: orderId,
      })

    if (bookingError) {
      setError('Booking record failed. Please contact support with ref: ' + orderId)
      setProcessing(false)
      return
    }

    // 3. Log to payment audit
    await supabase.from('payment_audit').insert({
      payhere_payment_id: orderId,
      entity_type: 'booking',
      entity_id: slot.id,
      event_type: 'completed',
      amount_lkr: slot.price_lkr,
      raw_payload: { order_id: orderId, slot_id: slot.id, user_id: user.id, simulated: true },
    })

    // 4. Redirect to success page
    router.push(`/booking/${slotId}/payment/success?ref=${orderId}`)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: '#64748B', fontSize: '14px' }}>Loading payment details...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
        <Navbar />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 16px' }}>
          <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '40px', maxWidth: '400px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>⏱</div>
            <p style={{ fontSize: '15px', fontWeight: '600', color: '#0F172A', marginBottom: '8px' }}>{error}</p>
            <a href={`/courts/${slot?.court_id}`}
              style={{ display: 'inline-block', background: '#1B6B3A', color: '#fff', borderRadius: '8px', padding: '10px 24px', fontSize: '14px', fontWeight: '600', textDecoration: 'none', marginTop: '8px' }}>
              Back to court
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <main style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
      <Navbar />

      {/* Floating timer */}
      {timeLeft > 0 && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: timerBg, border: `1px solid ${timerBorder}`, borderRadius: '40px', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }}>
          <span style={{ fontSize: '18px' }}>⏱</span>
          <div>
            <p style={{ fontSize: '11px', color: timerColor, margin: '0 0 1px', fontWeight: '500', opacity: 0.8 }}>Time remaining to complete payment</p>
            <p style={{ fontSize: '22px', fontWeight: '800', color: timerColor, margin: 0, letterSpacing: '0.04em' }}>{formatTime(timeLeft)}</p>
          </div>
          {timeLeft < 120 && (
            <span style={{ fontSize: '12px', color: '#DC2626', fontWeight: '600', background: '#FEE2E2', padding: '3px 8px', borderRadius: '20px' }}>Hurry!</span>
          )}
        </div>
      )}

      <div style={{ maxWidth: '520px', margin: '32px auto', padding: '0 16px 120px' }}>

        {/* Steps */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          {['Reserve slot', 'Verify phone', 'Payment'].map((step, i) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{
                  width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700',
                  background: i < 2 ? '#ECFDF5' : '#1B6B3A',
                  color: i < 2 ? '#1B6B3A' : '#fff',
                }}>
                  {i < 2 ? '✓' : '3'}
                </div>
                <span style={{ fontSize: '12px', color: i === 2 ? '#0F172A' : '#94A3B8', fontWeight: i === 2 ? '600' : '400' }}>{step}</span>
              </div>
              {i < 2 && <div style={{ width: '24px', height: '0.5px', background: '#E2E8F0' }} />}
            </div>
          ))}
        </div>

        {/* Booking Summary */}
        {slot && court && (
          <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '14px' }}>
            <p style={{ fontSize: '11px', color: '#94A3B8', fontWeight: '500', letterSpacing: '0.04em', margin: '0 0 14px' }}>BOOKING SUMMARY</p>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <div style={{ width: '48px', height: '48px', background: '#ECFDF5', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}>🏀</div>
              <div>
                <p style={{ fontSize: '15px', fontWeight: '700', color: '#0F172A', margin: '0 0 2px' }}>{court.name}</p>
                <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>📍 {court.locations.name}</p>
              </div>
            </div>
            <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Date</p>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{formatDate(slot.slot_date)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Time</p>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{slot.start_time.slice(0,5)} - {slot.end_time.slice(0,5)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Court type</p>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{COURT_TYPE_LABELS[slot.court_type]}</p>
                </div>
                <div>
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Sport</p>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{court.sport_types.name}</p>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '14px', borderTop: '0.5px solid #F1F5F9' }}>
              <div>
                <p style={{ fontSize: '12px', color: '#94A3B8', margin: '0 0 2px' }}>Total amount</p>
                <p style={{ fontSize: '28px', fontWeight: '800', color: '#1B6B3A', margin: 0 }}>LKR {slot.price_lkr.toLocaleString()}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 2px' }}>Payment via</p>
                <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>PayHere</p>
              </div>
            </div>
          </div>
        )}

        {/* Customer Details */}
        {profile && (
          <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '14px' }}>
            <p style={{ fontSize: '11px', color: '#94A3B8', fontWeight: '500', letterSpacing: '0.04em', margin: '0 0 14px' }}>YOUR DETAILS</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Name</p>
                <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{profile.full_name || user?.email?.split('@')[0]}</p>
              </div>
              <div>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Phone</p>
                <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{profile.phone}</p>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>Email</p>
                <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{user?.email}</p>
              </div>
            </div>
          </div>
        )}

        {/* Payment Methods */}
        <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '14px' }}>
          <p style={{ fontSize: '11px', color: '#94A3B8', fontWeight: '500', letterSpacing: '0.04em', margin: '0 0 14px' }}>ACCEPTED PAYMENT METHODS</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {['💳 Visa / Mastercard', '📱 eZ Cash', '📱 FriMi', '📱 mCash', '🏦 Internet Banking'].map(method => (
              <span key={method} style={{ fontSize: '12px', background: '#F8FAFC', border: '0.5px solid #E2E8F0', color: '#475569', padding: '6px 12px', borderRadius: '8px' }}>{method}</span>
            ))}
          </div>
        </div>

        {/* DEV MODE notice */}
        <div style={{ background: '#FFFBEB', border: '0.5px solid #FDE68A', borderRadius: '10px', padding: '12px 16px', marginBottom: '14px' }}>
          <p style={{ fontSize: '12px', color: '#92400E', margin: '0 0 2px', fontWeight: '600' }}>⚙️ Development Mode</p>
          <p style={{ fontSize: '12px', color: '#92400E', margin: 0 }}>PayHere is not yet connected. Click the button below to simulate a successful payment and test the full booking flow.</p>
        </div>

        {/* Pay Button */}
        <button
          onClick={completePayment}
          disabled={processing || timeLeft <= 0}
          style={{
            width: '100%', background: processing || timeLeft <= 0 ? '#94A3B8' : '#1B6B3A',
            color: '#fff', border: 'none', borderRadius: '12px', padding: '16px',
            fontSize: '16px', fontWeight: '700', cursor: processing || timeLeft <= 0 ? 'not-allowed' : 'pointer',
            marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          }}
        >
          {processing ? 'Processing...' : `Simulate Payment — LKR ${slot?.price_lkr.toLocaleString()}`}
        </button>

        <p style={{ textAlign: 'center', fontSize: '12px', color: '#94A3B8', margin: '0 0 20px' }}>
          This button will be replaced with PayHere when credentials are ready
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', flexWrap: 'wrap' }}>
          {['🔒 SSL Secured', '✅ CBSL Approved', '📱 Instant SMS'].map(item => (
            <span key={item} style={{ fontSize: '11px', color: '#94A3B8' }}>{item}</span>
          ))}
        </div>
      </div>
    </main>
  )
}
