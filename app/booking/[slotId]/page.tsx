'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, getCurrentUser } from '@/lib/supabase'
import Navbar from '@/components/Navbar'
import { rpcErrorCode } from '@/lib/apiClient'
import { userMessage } from '@/lib/userMessages'

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
  locations: { name: string; address: string }
  sport_types: { name: string }
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
  const [showExitWarning, setShowExitWarning] = useState(false)
  const lockAttempted = useRef(false)
  const slotRef = useRef<Slot | null>(null)
  const userRef = useRef<any>(null)

  useEffect(() => {
    const init = async () => {
      const currentUser = await getCurrentUser()
      if (!currentUser) {
        router.push(`/auth?redirect=/booking/${slotId}`)
        return
      }
      setUser(currentUser)
      userRef.current = currentUser

      const { data: slotData, error: slotError } = await supabase
        .from('slots').select('*').eq('id', slotId).single()

      if (slotError || !slotData) {
        setError('This slot could not be found. It may have been removed.')
        setLoading(false)
        return
      }

      if (slotData.status === 'booked' || slotData.status === 'blocked') {
        setError('This slot is no longer available. Please go back and choose another slot.')
        setLoading(false)
        return
      }

      const lockActive = slotData.status === 'locked' && slotData.lock_expires_at && new Date(slotData.lock_expires_at).getTime() > Date.now()

      if (lockActive && slotData.locked_by === currentUser.id) {
        // Our own hold (e.g. page refresh): resume the countdown from the server's expiry.
        const remaining = Math.floor((new Date(slotData.lock_expires_at).getTime() - Date.now()) / 1000)
        setSlot(slotData)
        slotRef.current = slotData
        const { data: courtData } = await supabase
          .from('courts').select('*, locations(name, address), sport_types(name)').eq('id', slotData.court_id).single()
        if (courtData) setCourt(courtData)
        setLocked(true)
        setTimeLeft(remaining)
        setLoading(false)
        return
      }

      if (lockActive) {
        setError('This slot is currently being reserved by another customer. Please go back and try another slot.')
        setLoading(false)
        return
      }

      // An expired hold counts as available; the server releases it when we reserve.
      if (slotData.status === 'locked') slotData.status = 'available'

      setSlot(slotData)
      slotRef.current = slotData

      const { data: courtData } = await supabase
        .from('courts').select('*, locations(name, address), sport_types(name)').eq('id', slotData.court_id).single()
      if (courtData) setCourt(courtData)
      setLoading(false)
    }
    init()
  }, [slotId, router])

  // Countdown timer
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
    // Intercept browser back button when slot is locked
  useEffect(() => {
    if (!locked) return

    // Push dummy history entry so back button can be intercepted
    window.history.pushState(null, '', window.location.href)

    const handlePopState = () => {
      // Keep user on page and show warning modal
      window.history.pushState(null, '', window.location.href)
      setShowExitWarning(true)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [locked])
  const handleExpiry = async () => {
    if (slotRef.current) {
      await supabase.rpc('release_hold', { p_slot_id: slotRef.current.id })
    }
    setLocked(false)
    setError('Your reservation expired. Please go back and select the slot again.')
  }

  const releaseAndExit = async () => {
    if (slotRef.current) {
      await supabase.rpc('release_hold', { p_slot_id: slotRef.current.id })
    }
    setLocked(false)
    setShowExitWarning(false)
    router.back()
  }

  const handleBackClick = () => {
    if (locked) {
      setShowExitWarning(true)
    } else {
      router.back()
    }
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
    if (lockAttempted.current || locking) return
    lockAttempted.current = true
    if (!slot || !user) return
    setLocking(true)
    setError('')

    // The database decides: availability, half/full conflicts, practice blocks,
    // cut-off time, price and the 10-minute expiry (server clock).
    const { data, error: holdError } = await supabase.rpc('hold_slot', { p_slot_id: slot.id })

    if (holdError || !data) {
      setError(userMessage(rpcErrorCode(holdError), 'Could not reserve this slot. Please go back and try again.'))
      setLocking(false)
      lockAttempted.current = false
      return
    }

    const lockExpiry = data.lock_expires_at as string
    const updatedSlot = { ...slot, status: 'locked', lock_expires_at: lockExpiry }
    setSlot(updatedSlot)
    slotRef.current = updatedSlot
    setLocked(true)
    setTimeLeft(Number(data.seconds_left ?? 600))
    setLocking(false)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
        <Navbar />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 20px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', border: '3px solid #E2E8F0', borderTopColor: '#1B6B3A', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ color: '#64748B', fontSize: '14px', margin: 0 }}>Loading booking details...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error && !locked) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
        <Navbar />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 20px' }}>
          <div style={{ background: '#fff', borderRadius: '16px', border: '0.5px solid #E2E8F0', padding: '40px', maxWidth: '420px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#0F172A', margin: '0 0 8px' }}>Slot unavailable</h2>
            <p style={{ fontSize: '14px', color: '#64748B', lineHeight: '1.7', margin: '0 0 24px' }}>{error}</p>
            <button onClick={() => router.back()}
              style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px 28px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
              Go back
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <main style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
      <Navbar />

      {/* Exit warning modal */}
      {showExitWarning && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: '16px', padding: '28px', maxWidth: '380px', width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '14px' }}>⚠️</div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#0F172A', margin: '0 0 8px' }}>Cancel your reservation?</h2>
            <p style={{ fontSize: '14px', color: '#64748B', lineHeight: '1.7', margin: '0 0 24px' }}>
              If you go back, your reserved slot will be released and another customer may book it. Are you sure you want to cancel?
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowExitWarning(false)}
                style={{ flex: 1, background: '#F1F5F9', color: '#0F172A', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}
              >
                Keep reservation
              </button>
              <button
                onClick={releaseAndExit}
                style={{ flex: 1, background: '#DC2626', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}
              >
                Yes, cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating timer */}
      {locked && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 100, background: timerBg, border: `1px solid ${timerBorder}`,
          borderRadius: '40px', padding: '10px 24px', display: 'flex', alignItems: 'center',
          gap: '10px', boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
        }}>
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
                <p style={{ fontSize: '24px', fontWeight: '800', color: '#1B6B3A', margin: 0 }}>LKR {slot.price_lkr.toLocaleString()}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 2px' }}>Payment via</p>
                <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: 0 }}>PayHere</p>
              </div>
            </div>
          </div>
        )}

        {/* Refund policy notice */}
        {!locked && (
          <div style={{ background: '#FFFBEB', border: '0.5px solid #FDE68A', borderRadius: '10px', padding: '12px 16px', marginBottom: '14px', display: 'flex', gap: '10px' }}>
            <span style={{ fontSize: '18px', flexShrink: 0 }}>⚠️</span>
            <div>
              <p style={{ fontSize: '13px', fontWeight: '600', color: '#92400E', margin: '0 0 3px' }}>Refund policy</p>
              <p style={{ fontSize: '12px', color: '#92400E', margin: 0, lineHeight: '1.6' }}>
                No refunds will be given for bookings cancelled less than 24 hours before the slot time. Cancellations made more than 24 hours in advance are eligible for a full refund.
              </p>
            </div>
          </div>
        )}

        {/* Action area */}
        {!locked ? (
          <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '20px' }}>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
              <div style={{ width: '36px', height: '36px', background: '#FEF3C7', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>⏱</div>
              <div>
                <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: '0 0 2px' }}>You have 10 minutes to complete payment</p>
                <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>The slot will be reserved exclusively for you once you click below</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleBackClick}
                style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={lockSlot} disabled={locking}
                style={{ flex: 2, background: locking ? '#94A3B8' : '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '14px', fontWeight: '600', cursor: locking ? 'not-allowed' : 'pointer' }}>
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
                <button onClick={handleBackClick}
                  style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                  Cancel
                </button>
                <a href={`/booking/${slotId}/verify`}
                  style={{ flex: 2, background: '#1B6B3A', color: '#fff', borderRadius: '8px', padding: '11px', fontSize: '14px', fontWeight: '600', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  Verify phone number →
                </a>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '20px', flexWrap: 'wrap' }}>
          {['🔒 Secure payment', '✅ Instant confirmation', '📱 SMS receipt'].map(item => (
            <span key={item} style={{ fontSize: '11px', color: '#94A3B8' }}>{item}</span>
          ))}
        </div>
      </div>
    </main>
  )
}
