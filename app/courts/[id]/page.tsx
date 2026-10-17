'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Navbar from '@/components/Navbar'
import { allowsMultiHour, courtFacts, lkr, time12 } from '@/lib/courtInfo'

interface Court {
  id: string
  name: string
  has_half_court: boolean
  half_court_cutoff: string
  operating_start: string
  operating_end: string
  slot_duration_hrs: number
  max_consecutive_slots: number | null
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
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }))
  // Multi-hour courts (The Solo Court): chosen duration and selected start slot.
  const [hours, setHours] = useState(1)
  const [selectedStart, setSelectedStart] = useState<string | null>(null)
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
      setSelectedStart(null)
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
      case 'booked':   return { background: '#F8FAFC', border: '0.5px solid #E2E8F0', color: '#475569' }
      default:         return { background: '#F1F5F9', border: '0.5px solid #CBD5E1', color: '#475569' }
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'available': return 'Available'
      case 'locked':   return 'Reserved'
      case 'booked':   return 'Booked'
      default:         return 'Not available'
    }
  }


  const goToBooking = (ids: string[]) => {
    const destination = ids.length > 1 ? `/booking/${ids[0]}?slots=${ids.join(',')}` : `/booking/${ids[0]}`
    if (!user) {
      router.push(`/auth?redirect=${encodeURIComponent(destination)}`)
      return
    }
    router.push(destination)
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
      <div style={{ ...style, borderRadius: '10px', padding: '10px', flex: '1 1 96px', minWidth: 0 }}>
        <p style={{ fontSize: '13px', fontWeight: '700', margin: '0 0 2px', color: '#0F172A' }}>{label}</p>
        <p style={{ fontSize: '12px', margin: '0 0 8px', color: '#475569' }}>{getStatusLabel(status)}</p>
        {price && status !== 'na' && status !== 'blocked' && (
          <p style={{ fontSize: '14px', fontWeight: '700', margin: '0 0 8px', color: status === 'available' ? '#1B6B3A' : style.color }}>
            LKR {price.toLocaleString()}
          </p>
        )}
        {status === 'available' && slot && (
          <button
            onClick={() => handleBook(slot)}
            className="ag-tap"
            aria-label={`Book ${label}, ${time12(slot.start_time)} to ${time12(slot.end_time)}, ${lkr(slot.price_lkr)}`}
            style={{ width: '100%', background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}
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
          <div style={{ width: '100%', background: 'rgba(0,0,0,0.05)', color: '#475569', borderRadius: '6px', padding: '5px', fontSize: '11px', textAlign: 'center' }}>
            {status === 'booked' ? 'Booked' : 'Not available'}
          </div>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------------
  // The Solo Court: choose 1 or 2 hours, then a start time. A 2-hour start is
  // offered only when the next hour is also free. The server re-checks
  // everything when the hold is placed.
  // ---------------------------------------------------------------------
  const renderMultiHourSelector = () => {
    const hourly = slots
      .filter((s) => s.court_type === 'full_court')
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
    const free = (s?: Slot) => !!s && liveStatus(s) === 'available'
    const runFrom = (i: number) => {
      const run = hourly.slice(i, i + hours)
      if (run.length < hours) return null
      for (let k = 1; k < run.length; k++) if (run[k].start_time !== run[k - 1].end_time) return null
      return run.every(free) ? run : null
    }
    const selIndex = hourly.findIndex((s) => s.id === selectedStart)
    const selection = selIndex >= 0 ? runFrom(selIndex) : null
    const total = selection?.reduce((sum, s) => sum + Number(s.price_lkr), 0) ?? 0
    const max = court?.max_consecutive_slots ?? 2

    return (
      <div>
        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
          <legend style={{ fontSize: '14px', fontWeight: 700, color: '#0F172A', marginBottom: '8px' }}>How long do you want to play?</legend>
          <div role="radiogroup" aria-label="Booking length" style={{ display: 'flex', gap: '8px' }}>
            {Array.from({ length: max }, (_, k) => k + 1).map((h) => {
              const price = hourly[0] ? Number(hourly[0].price_lkr) * h : null
              const active = hours === h
              return (
                <button key={h} role="radio" aria-checked={active} className="ag-tap"
                  onClick={() => { setHours(h); setSelectedStart(null) }}
                  style={{ flex: 1, background: active ? '#0B2818' : '#fff', color: active ? '#fff' : '#0F172A', border: `2px solid ${active ? '#0B2818' : '#CBD5E1'}`, borderRadius: '12px', padding: '10px', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ display: 'block', fontSize: '15px', fontWeight: 700 }}>{h} hour{h > 1 ? 's' : ''}</span>
                  {price !== null && <span style={{ display: 'block', fontSize: '13px', color: active ? '#4ADE80' : '#1B6B3A', fontWeight: 700 }}>{lkr(price)}</span>}
                </button>
              )
            })}
          </div>
        </fieldset>

        <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#0F172A', margin: '0 0 8px' }}>
          Choose a start time{hours > 1 ? ` (you'll get ${hours} consecutive hours)` : ''}
        </h2>
        <div role="radiogroup" aria-label="Start time" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
          {hourly.map((s, i) => {
            const run = runFrom(i)
            const status = liveStatus(s)
            const selected = selection?.some((x) => x.id === s.id) ?? false
            const isStart = s.id === selectedStart && !!selection
            const reason = status !== 'available' ? getStatusLabel(status) : !run ? 'Next hour not free' : ''
            const endLabel = run ? time12(run[run.length - 1].end_time) : time12(s.end_time)
            return (
              <button key={s.id} role="radio" aria-checked={isStart} disabled={!run} className="ag-tap"
                onClick={() => setSelectedStart(s.id)}
                aria-label={run ? `${time12(s.start_time)} to ${endLabel}, ${lkr(run.reduce((a, x) => a + Number(x.price_lkr), 0))}` : `${time12(s.start_time)}, not available: ${reason}`}
                style={{
                  textAlign: 'left', borderRadius: '10px', padding: '10px 12px', cursor: run ? 'pointer' : 'not-allowed',
                  background: selected ? '#0B2818' : run ? '#ECFDF5' : '#F1F5F9',
                  color: selected ? '#fff' : run ? '#065F46' : '#64748B',
                  border: `2px solid ${selected ? '#0B2818' : run ? '#6EE7B7' : '#E2E8F0'}`,
                }}>
                <span style={{ display: 'block', fontSize: '14px', fontWeight: 700 }}>{time12(s.start_time)}</span>
                <span style={{ display: 'block', fontSize: '12px' }}>{run ? `until ${endLabel}` : reason}</span>
              </button>
            )
          })}
        </div>

        {/* Space so the fixed summary bar never covers the last start times. */}
        {selection && <div aria-hidden="true" style={{ height: '96px' }} />}
        <div aria-live="polite" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '0 16px 16px', zIndex: 50, pointerEvents: 'none' }}>
          {selection && (
            <div style={{ maxWidth: '648px', margin: '0 auto', pointerEvents: 'auto', background: '#0B2818', color: '#fff', borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', boxShadow: '0 8px 24px rgba(11,40,24,0.25)' }}>
              <div>
                <p style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                  {time12(selection[0].start_time)} – {time12(selection[selection.length - 1].end_time)}
                </p>
                <p style={{ margin: 0, fontSize: '13px', color: '#BBF7D0' }}>
                  {selection.length} hour{selection.length > 1 ? 's' : ''} · {lkr(total)}
                </p>
              </div>
              <button onClick={() => goToBooking(selection.map((x) => x.id))} className="ag-tap"
                style={{ background: '#4ADE80', color: '#0B2818', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                Continue
              </button>
            </div>
          )}
        </div>
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
                  <p style={{ fontSize: '12px', color: '#475569', margin: 0 }}>{court.locations.address}</p>
                </div>
                <span style={{ fontSize: '11px', background: '#ECFDF5', color: '#065F46', padding: '4px 10px', borderRadius: '20px', fontWeight: '500', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {court.sport_types.name}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
            <span style={{ fontSize: '12px', background: '#F1F5F9', color: '#334155', padding: '4px 10px', borderRadius: '20px' }}>
              🕐 {time12(court.operating_start)} – {time12(court.operating_end)}
            </span>
            <span style={{ fontSize: '12px', background: '#F1F5F9', color: '#334155', padding: '4px 10px', borderRadius: '20px' }}>
              {court.slot_duration_hrs}-hour slots
            </span>
            {court.has_half_court && (
              <span style={{ fontSize: '12px', background: '#EFF6FF', color: '#1D4ED8', padding: '4px 10px', borderRadius: '20px' }}>
                Half court: slots starting before {time12(court.half_court_cutoff ?? '14:00:00')}
              </span>
            )}
            {allowsMultiHour(court) && (
              <span style={{ fontSize: '12px', background: '#ECFDF5', color: '#065F46', padding: '4px 10px', borderRadius: '20px' }}>
                Book 1 hour or {court.max_consecutive_slots} consecutive hours
              </span>
            )}
          </div>

          <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '14px' }}>
            <h2 style={{ fontSize: '12px', color: '#64748B', fontWeight: '600', letterSpacing: '0.04em', margin: '0 0 8px' }}>PRICES</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '4px' }}>
              {courtFacts(court).filter((l) => !l.startsWith('Open ')).map((line) => (
                <li key={line} style={{ fontSize: '14px', color: '#0F172A' }}>{line}</li>
              ))}
            </ul>
            {court.has_half_court && (
              <p style={{ fontSize: '12px', color: '#64748B', margin: '8px 0 0' }}>
                A full-court booking uses both halves. Half courts A and B can be booked by different groups at the same time.
              </p>
            )}
          </div>
        </div>

        {/* Date Picker */}
        <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '16px 20px', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <label htmlFor="slot-date" style={{ display: 'block', fontSize: '12px', color: '#64748B', fontWeight: '600', letterSpacing: '0.04em', margin: '0 0 2px' }}>SELECT DATE</label>
            <p style={{ fontSize: '13px', color: '#0F172A', margin: 0 }}>Times are Sri Lanka time</p>
          </div>
          <input
            id="slot-date"
            className="ag-tap"
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
            style={{ border: '1px solid #94A3B8', borderRadius: '8px', padding: '8px 10px', fontSize: '15px', color: '#0F172A', background: '#fff' }}
          />
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
          {[
            { color: '#ECFDF5', border: '#6EE7B7', label: 'Available' },
            { color: '#FFFBEB', border: '#FCD34D', label: 'Reserved' },
            { color: '#F8FAFC', border: '#E2E8F0', label: 'Booked' },
            { color: '#F1F5F9', border: '#CBD5E1', label: 'Not available (blocked, started or clashing)' },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: item.color, border: `1px solid ${item.border}` }} />
              <span style={{ fontSize: '12px', color: '#475569' }}>{item.label}</span>
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
        ) : allowsMultiHour(court) ? (
          renderMultiHourSelector()
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {Object.entries(timeGroups).map(([timeKey, group]) => {
              const [start] = timeKey.split('-')
              const effectiveFCStatus = getEffectiveFullCourtStatus(group)

              return (
                <div key={timeKey} style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '16px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0F172A', margin: '0 0 12px' }}>
                    {time12(start)} – {time12(timeKey.split('-')[1])}
                  </h3>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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
