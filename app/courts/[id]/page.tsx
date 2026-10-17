'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Navbar from '@/components/Navbar'

interface Court {
  id: string
  name: string
  has_half_court: boolean
  half_court_cutoff: string
  operating_start: string
  operating_end: string
  slot_duration_hrs: number
  locations: { name: string; address: string }
  sport_types: { name: string }
  court_pricing: {
    tier_name: string
    time_from: string
    time_to: string
    price_lkr: number
    applies_to: string
  }[]
}

interface Slot {
  id: string
  slot_date: string
  start_time: string
  end_time: string
  court_type: string
  status: string
  price_lkr: number
  lock_expires_at: string | null
}

interface GroupedSlot {
  full_court?: Slot
  half_a?: Slot
  half_b?: Slot
}

export default function CourtPage() {
  const params = useParams()
  const router = useRouter()
  const courtId = params.id as string

  const [court, setCourt] = useState<Court | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedDate, setSelectedDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })
  const [loading, setLoading] = useState(true)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [user, setUser] = useState<any>(null)

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + 30)
  const maxDateStr = maxDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })

  useEffect(() => {
    const loadCourt = async () => {
      const { data } = await supabase
        .from('courts')
        .select(`*, locations(name, address), sport_types(name), court_pricing(tier_name, time_from, time_to, price_lkr, applies_to)`)
        .eq('id', courtId)
        .single()
      if (data) setCourt(data)
      setLoading(false)
    }
    loadCourt()

    // Check if user is logged in
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
    })
  }, [courtId])

  useEffect(() => {
    if (!courtId || !selectedDate) return
    // Prevent loading slots for past dates
    if (selectedDate < today) {
      setSelectedDate(today)
      return
    }
    const loadSlots = async () => {
      setSlotsLoading(true)
      const { data } = await supabase
        .from('slots')
        .select('*')
        .eq('court_id', courtId)
        .eq('slot_date', selectedDate)
        .order('start_time')
      if (data) setSlots(data)
      setSlotsLoading(false)
    }
    loadSlots()
  }, [courtId, selectedDate])

  // Group slots by time
  const timeGroups: Record<string, GroupedSlot> = {}
  slots.forEach(slot => {
    const key = `${slot.start_time}-${slot.end_time}`
    if (!timeGroups[key]) timeGroups[key] = {}
    if (slot.court_type === 'full_court') timeGroups[key].full_court = slot
    if (slot.court_type === 'half_a') timeGroups[key].half_a = slot
    if (slot.court_type === 'half_b') timeGroups[key].half_b = slot
  })

  // Clock for display rules (re-rendered every 30s so started/expired slots update).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const slotHasStarted = (slot: Slot) =>
    new Date(`${slot.slot_date}T${slot.start_time.slice(0, 8)}+05:30`).getTime() <= now

  const isPeakSlot = (startTime: string) => {
    if (!court) return false
    const cutoff = court.half_court_cutoff || '14:00:00'
    return startTime >= cutoff
  }

  // Display only — the server enforces the same rules when a slot is reserved.
  // An expired hold is free again; a started slot cannot be booked.
  const liveStatus = (slot?: Slot): string => {
    if (!slot) return 'na'
    if (slot.status === 'locked' && slot.lock_expires_at && new Date(slot.lock_expires_at).getTime() <= now) return 'available'
    if (slot.status === 'available' && slotHasStarted(slot)) return 'na'
    return slot.status
  }
  const occupied = (slot?: Slot) => ['booked', 'locked', 'blocked'].includes(liveStatus(slot))

  // Full court N/A if either half is booked, reserved or blocked for practice
  const getEffectiveFullCourtStatus = (group: GroupedSlot): string => {
    const fc = group.full_court
    if (!fc) return 'na'
    if (occupied(group.half_a) || occupied(group.half_b)) return 'na'
    return liveStatus(fc)
  }

  // Half courts N/A if the full court is booked, reserved or blocked
  const getEffectiveHalfCourtStatus = (group: GroupedSlot, slot: Slot): string => {
    if (occupied(group.full_court)) return 'na'
    return liveStatus(slot)
  }

  const getSlotStyle = (status: string): React.CSSProperties => {
    switch (status) {
      case 'available': return { background: '#ECFDF5', border: '0.5px solid #6EE7B7', color: '#065F46' }
      case 'locked':   return { background: '#FFFBEB', border: '0.5px solid #FCD34D', color: '#92400E' }
      case 'booked':   return { background: '#F8FAFC', border: '0.5px solid #E2E8F0', color: '#94A3B8' }
      default:         return { background: '#F1F5F9', border: '0.5px solid #CBD5E1', color: '#94A3B8' }
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'available': return 'Available'
      case 'locked':   return 'Reserved'
      case 'booked':   return 'Booked'
      default:         return 'N/A'
    }
  }

  const handleBook = (slot: Slot) => {
    if (!user) {
      // Save the intended destination and redirect to auth
      const destination = `/booking/${slot.id}`
      router.push(`/auth?redirect=${encodeURIComponent(destination)}`)
      return
    }
    router.push(`/booking/${slot.id}`)
  }

  const renderSlotCard = (slot: Slot | undefined, label: string, effectiveStatus?: string) => {
    const status = effectiveStatus || slot?.status || 'na'
    const style = getSlotStyle(status)
    const price = slot?.price_lkr

    return (
      <div style={{ ...style, borderRadius: '10px', padding: '12px', flex: 1 }}>
        <p style={{ fontSize: '12px', fontWeight: '600', margin: '0 0 2px', color: style.color }}>{label}</p>
        <p style={{ fontSize: '11px', margin: '0 0 8px', opacity: 0.75, color: style.color }}>{getStatusLabel(status)}</p>
        {price && status !== 'na' && status !== 'blocked' && (
          <p style={{ fontSize: '14px', fontWeight: '700', margin: '0 0 8px', color: status === 'available' ? '#1B6B3A' : style.color }}>
            LKR {price.toLocaleString()}
          </p>
        )}
        {status === 'available' && slot && (
          <button
            onClick={() => handleBook(slot)}
            style={{ width: '100%', background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
          >
            Book
          </button>
        )}
        {status === 'locked' && (
          <div style={{ width: '100%', background: '#FEF3C7', color: '#92400E', borderRadius: '6px', padding: '5px', fontSize: '11px', fontWeight: '600', textAlign: 'center' }}>
            In progress
          </div>
        )}
        {(status === 'booked' || status === 'na' || status === 'blocked') && (
          <div style={{ width: '100%', background: 'rgba(0,0,0,0.05)', color: '#94A3B8', borderRadius: '6px', padding: '5px', fontSize: '11px', textAlign: 'center' }}>
            {status === 'booked' ? 'Booked' : 'N/A'}
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: '#64748B', fontSize: '14px' }}>Loading...</p>
      </div>
    )
  }

  if (!court) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: '#64748B', fontSize: '14px' }}>Court not found.</p>
      </div>
    )
  }

  return (
    <main style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
      <Navbar />

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '24px 16px 48px' }}>

        <a href="/" style={{ fontSize: '13px', color: '#1B6B3A', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '20px' }}>
          ← Back to search
        </a>

        {/* Court Info */}
        <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', gap: '14px', marginBottom: '16px' }}>
            <div style={{ width: '56px', height: '56px', background: '#ECFDF5', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', flexShrink: 0 }}>
              🏀
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                <div>
                  <h1 style={{ fontSize: '18px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>{court.name}</h1>
                  <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 1px' }}>📍 {court.locations.name}</p>
                  <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0 }}>{court.locations.address}</p>
                </div>
                <span style={{ fontSize: '11px', background: '#ECFDF5', color: '#065F46', padding: '4px 10px', borderRadius: '20px', fontWeight: '500', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {court.sport_types.name}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
            <span style={{ fontSize: '11px', background: '#F1F5F9', color: '#475569', padding: '4px 10px', borderRadius: '20px' }}>
              🕐 {court.operating_start.slice(0,5)} - {court.operating_end.slice(0,5)}
            </span>
            <span style={{ fontSize: '11px', background: '#F1F5F9', color: '#475569', padding: '4px 10px', borderRadius: '20px' }}>
              {court.slot_duration_hrs}h slots
            </span>
            {court.has_half_court && (
              <span style={{ fontSize: '11px', background: '#EFF6FF', color: '#1D4ED8', padding: '4px 10px', borderRadius: '20px' }}>
                Half court before {court.half_court_cutoff?.slice(0,5)}
              </span>
            )}
          </div>

          <div style={{ borderTop: '0.5px solid #F1F5F9', paddingTop: '14px' }}>
            <p style={{ fontSize: '11px', color: '#94A3B8', fontWeight: '500', letterSpacing: '0.04em', margin: '0 0 8px' }}>PRICING</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {court.court_pricing
                .filter((p, index, self) =>
                  index === self.findIndex(t => t.tier_name === p.tier_name && t.price_lkr === p.price_lkr)
                )
                .map((p, i) => (
                  <div key={i} style={{ background: '#F8FAFC', borderRadius: '8px', padding: '8px 12px', fontSize: '12px' }}>
                    <span style={{ color: '#64748B' }}>{p.tier_name} ({p.time_from?.slice(0,5)}-{p.time_to?.slice(0,5)})</span>
                    <span style={{ color: '#1B6B3A', fontWeight: '700', marginLeft: '6px' }}>LKR {p.price_lkr.toLocaleString()}</span>
                  </div>
                ))
              }
            </div>
          </div>
        </div>

        {/* Date Picker */}
        <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '16px 20px', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '11px', color: '#94A3B8', fontWeight: '500', letterSpacing: '0.04em', margin: '0 0 2px' }}>SELECT DATE</p>
            <p style={{ fontSize: '13px', color: '#0F172A', margin: 0 }}>Choose a date to see available slots</p>
          </div>
          <input
            type="date"
            value={selectedDate}
            min={today}
            max={maxDateStr}
            onChange={(e) => {
              const val = e.target.value
              // Prevent past dates
              if (val < today) return
              setSelectedDate(val)
            }}
            style={{ border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '7px 10px', fontSize: '13px', color: '#0F172A', outline: 'none', background: '#fff' }}
          />
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
          {[
            { color: '#ECFDF5', border: '#6EE7B7', label: 'Available' },
            { color: '#FFFBEB', border: '#FCD34D', label: 'Reserved' },
            { color: '#F8FAFC', border: '#E2E8F0', label: 'Booked' },
            { color: '#F1F5F9', border: '#CBD5E1', label: 'N/A' },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: item.color, border: `1px solid ${item.border}` }} />
              <span style={{ fontSize: '11px', color: '#64748B' }}>{item.label}</span>
            </div>
          ))}
        </div>

        {/* Not logged in banner */}
        {!user && (
          <div style={{ background: '#EFF6FF', border: '0.5px solid #BFDBFE', borderRadius: '10px', padding: '12px 16px', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <p style={{ fontSize: '13px', color: '#1D4ED8', margin: 0 }}>Sign in to book a slot</p>
            <a href="/auth" style={{ background: '#1D4ED8', color: '#fff', padding: '6px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: '600', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              Sign in
            </a>
          </div>
        )}

        {/* Slots */}
        {slotsLoading ? (
          <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
            <p style={{ color: '#64748B', fontSize: '14px' }}>Loading slots...</p>
          </div>
        ) : Object.keys(timeGroups).length === 0 ? (
          <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
            <div style={{ fontSize: '36px', marginBottom: '10px' }}>📅</div>
            <p style={{ fontSize: '15px', fontWeight: '500', color: '#0F172A', margin: '0 0 4px' }}>No slots for this date</p>
            <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Try a different date or check back later</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {Object.entries(timeGroups).map(([timeKey, group]) => {
              const [start] = timeKey.split('-')
              const isPeak = isPeakSlot(start)
              const effectiveFCStatus = getEffectiveFullCourtStatus(group)

              return (
                <div key={timeKey} style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A' }}>
                      {start.slice(0,5)} - {timeKey.split('-')[1].slice(0,5)}
                    </span>
                    <span style={{
                      fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: '500',
                      background: isPeak ? '#FEF3C7' : '#ECFDF5',
                      color: isPeak ? '#92400E' : '#065F46'
                    }}>
                      {isPeak ? 'Peak' : 'Off-peak'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    {group.full_court && renderSlotCard(group.full_court, 'Full court', effectiveFCStatus)}
                    {group.half_a && renderSlotCard(group.half_a, 'Half court A', getEffectiveHalfCourtStatus(group, group.half_a))}
                    {group.half_b && renderSlotCard(group.half_b, 'Half court B', getEffectiveHalfCourtStatus(group, group.half_b))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
