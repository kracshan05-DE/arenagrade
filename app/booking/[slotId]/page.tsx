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
  lock_expires_at: string | null
  court_id: string
  version: number
}

interface Court {
  id: string
  name: string
  locations: {
    name: string
    address: string
  }
  sport_types: {
    name: string
  }
}

const COURT_TYPE_LABELS: Record<string, string> = {
  full_court: 'Full Court',
  half_a: 'Half Court A',
  half_b: 'Half Court B',
}

export default function BookingPage() {
  const params = useParams()
  const router = useRouter()
  const slotId = params.slotId as string

  const [slot, setSlot] = useState<Slot | null>(null)
  const [court, setCourt] = useState<Court | null>(null)
  const [loading, setLoading] = useState(true)
  const [locking, setLocking] = useState(false)
  const [locked, setLocked] = useState(false)
  const [timeLeft, setTimeLeft] = useState(600)
  const [error, setError] = useState('')
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const init = async () => {
      const currentUser = await getCurrentUser()
      if (!currentUser) {
        router.push(`/auth?redirect=/booking/${slotId}`)
        return
      }
      setUser(currentUser)

      const { data: slotData } = await supabase
        .from('slots')
        .select('*')
        .eq('id', slotId)
        .single()

      if (!slotData) {
        setError('Slot not found.')
        setLoading(false)
        return
      }

      if (slotData.status === 'booked' || slotData.status === 'blocked') {
        setError('This slot is no longer available.')
        setLoading(false)
        return
      }

      // If slot is locked by current user, restore locked state
      if (slotData.status === 'locked' && slotData.locked_by === currentUser.id) {
        const expiresAt = new Date(slotData.lock_expires_at || '').getTime()
        const now = Date.now()
        const remaining = Math.floor((expiresAt - now) / 1000)
        if (remaining > 0) {
          setSlot(slotData)
          const { data: courtData } = await supabase
            .from('courts')
            .select('*, locations(name, address), sport_types(name)')
            .eq('id', slotData.court_id)
            .single()
          if (courtData) setCourt(courtData)
          setLocked(true)
          setTimeLeft(remaining)
          setLoading(false)
          return
        } else {
          setError('Your reservation expired. Please go back and select the slot again.')
          setLoading(false)
          return
        }
      }

      if (slotData.status === 'locked' && slotData.locked_by !== currentUser.id) {
        setError('This slot is currently being booked by someone else.')
        setLoading(false)
        return
      }

      setSlot(slotData)

      const { data: courtData } = await supabase
        .from('courts')
        .select('*, locations(name, address), sport_types(name)')
        .eq('id', slotData.court_id)
        .single()

      if (courtData) setCourt(courtData)
      setLoading(false)
    }
    init()
  }, [slotId, router])

  useEffect(() => {
    if (!locked) return
    if (timeLeft <= 0) {
      handleExpiry()
      return
    }
    const timer = setInterval(() => {
      setTimeLeft(prev => prev - 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [locked, timeLeft])

  const handleExpiry = async () => {
    if (slot) {
      await supabase
        .from('slots')
        .update({ status: 'available', locked_by: null, lock_expires_at: null })
        .eq('id', slot.id)
    }
    setLocked(false)
    setError('Your reservation expired. Please go back and select the slot again.')
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const timerColor = timeLeft < 120 ? '#DC2626' : timeLeft < 300 ? '#D97706' : '#1B6B3A'
  const timerBg = timeLeft < 120 ? '#FEE2E2' : timeLeft < 300 ? '#FFFBEB' : '#ECFDF5'
  const timerBorder = timeLeft < 120 ? '#FECACA' : timeLeft < 300 ? '#FDE68A' : '#6EE7B7'

  const lockSlot = async () => {
    if (!slot || !user) return
    setLocking(true)
    setError('')

    const lockExpiry = new Date(Date.now() + 600000).toISOString()

    // Use a simple update without version check first — version may be null
    const { data, error: lockError } = await supabase
      .from('slots')
      .update({
        status: 'locked',
        locked_by: user.id,
        lock_expires_at: lockExpiry,
        version: (slot.version || 0) + 1,
      })
      .eq('id', slot.id)
      .eq('status', 'available')
      .select()

    if (lockError || !data || data.length === 0) {
      setError('Could not reserve this slot. Someone may have just booked it. Please go back and try again.')
      setLocking(false)
      return
    }

    setLocked(true)
    setTimeLeft(600)
    setLocking(false)
  }

  const releaseSlot = async () => {
    if (!slot) return
    await supabase
      .from('slots')
      .update({ status: 'available', locked_by: null, lock_expires_at: null })
      .eq('id', slot.id)
    router.back()
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: '#64748B', fontSize: '14px' }}>Loading...</p>
      </div>
    )
  }

  if (error && !locked) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '40px', maxWidth: '400px', textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>⚠️</div>
          <p style={{ fontSize: '15px', fontWeight: '600', color: '#0F172A', marginBottom: '8px' }}>{error}</p>
          <button
            onClick={() => router.back()}
            style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 24px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginTop: '8px' }}
          >
            Go back
          </button>
        </div>
      </div>
    )
  }

  return (
    <main style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>

      <Navbar />

      {/* Sticky floating timer — appears only when locked */}
      {locked && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 100,
          background: timerBg,
          border: `1px solid ${timerBorder}`,
          borderRadius: '40px',
          padding: '10px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
        }}>
          <span style={{ fontSize: '18px' }}>⏱</span>
          <div>
            <p style={{ fontSize: '11px', color: timerColor, margin: '0 0 1px', fontWeight: '500', opacity: 0.8 }}>Time remaining to complete payment</p>
            <p style={{ fontSize: '22px', fontWeight: '800', color: timerColor, margin: 0, letterSpacing: '0.04em' }}>{formatTime(timeLeft)}</p>
          </div>
          {timeLeft < 120 && (
            <span style={{ fontSize: '12px', color: '#DC2626', fontWeight: '600', background: '#FEE2E2', padding: '3px 8px', borderRadius: '20px' }}>
              Hurry!
            </span>
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
                  background: i === 0 ? '#1B6B3A' : '#E2E8F0',
                  color: i === 0 ? '#fff' : '#94A3B8'
                }}>
                  {i + 1}
                </div>
                <span style={{ fontSize: '12px', color: i === 0 ? '#0F172A' : '#94A3B8', fontWeight: i === 0 ? '600' : '400' }}>{step}</span>
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
              <div style={{ width: '48px', height: '48px', background: '#ECFDF5', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}>
                🏀
              </div>
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
                <p style={{ fontSize: '24px', fontWeight: '800', color: '#1B6B3A', margin: 0 }}>LKR {slot.price_lkr.toLocaleString()}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 2px' }}>Payment via</p>
                <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>PayHere</p>
              </div>
            </div>
          </div>
        )}

        {/* Action area */}
        {!locked ? (
          <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '20px' }}>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
              <div style={{ width: '36px', height: '36px', background: '#FEF3C7', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                ⏱
              </div>
              <div>
                <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: '0 0 2px' }}>You have 10 minutes to complete payment</p>
                <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>The slot will be reserved exclusively for you once you click below</p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => router.back()}
                style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={lockSlot}
                disabled={locking}
                style={{ flex: 2, background: locking ? '#94A3B8' : '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '14px', fontWeight: '600', cursor: locking ? 'not-allowed' : 'pointer' }}
              >
                {locking ? 'Reserving...' : 'Reserve and continue'}
              </button>
            </div>

            {error && (
              <div style={{ marginTop: '12px', background: '#FEE2E2', border: '0.5px solid #FECACA', borderRadius: '8px', padding: '10px 14px' }}>
                <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ background: '#ECFDF5', border: '0.5px solid #6EE7B7', borderRadius: '14px', padding: '16px 20px', marginBottom: '14px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '20px' }}>✅</span>
              <div>
                <p style={{ fontSize: '13px', fontWeight: '700', color: '#065F46', margin: '0 0 2px' }}>Slot reserved successfully</p>
                <p style={{ fontSize: '12px', color: '#047857', margin: 0 }}>Complete payment before the timer runs out to confirm your booking</p>
              </div>
            </div>

            <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '20px' }}>
              <p style={{ fontSize: '11px', color: '#94A3B8', fontWeight: '500', letterSpacing: '0.04em', margin: '0 0 14px' }}>NEXT STEPS</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{ width: '24px', height: '24px', background: '#1B6B3A', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', color: '#fff', flexShrink: 0 }}>2</div>
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: '0 0 1px' }}>Verify your phone number</p>
                    <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>We will send a one-time code to confirm your number</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{ width: '24px', height: '24px', background: '#E2E8F0', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', color: '#94A3B8', flexShrink: 0 }}>3</div>
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: '600', color: '#94A3B8', margin: '0 0 1px' }}>Complete payment via PayHere</p>
                    <p style={{ fontSize: '12px', color: '#CBD5E1', margin: 0 }}>Cards, eZ Cash, FriMi, mCash, internet banking</p>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={releaseSlot}
                  style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <a
                  href={`/booking/${slotId}/verify`}
                  style={{ flex: 2, background: '#1B6B3A', color: '#fff', borderRadius: '8px', padding: '11px', fontSize: '14px', fontWeight: '600', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  Verify phone number →
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Trust signals */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '20px', flexWrap: 'wrap' }}>
          {['🔒 Secure payment', '✅ Instant confirmation', '📱 SMS receipt'].map(item => (
            <span key={item} style={{ fontSize: '11px', color: '#94A3B8' }}>{item}</span>
          ))}
        </div>

      </div>
    </main>
  )
}
