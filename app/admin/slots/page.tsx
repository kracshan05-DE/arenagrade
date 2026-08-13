'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Court {
  id: string; name: string; has_half_court: boolean
  half_court_cutoff: string; operating_start: string
  operating_end: string; slot_duration_hrs: number
}

interface Slot {
  id: string; slot_date: string; start_time: string
  end_time: string; court_type: string; status: string
  price_lkr: number; internal_reason?: string
}

const COURT_TYPE_LABELS: Record<string, string> = {
  full_court: 'Full Court', half_a: 'Half Court A', half_b: 'Half Court B',
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  available: { bg: '#ECFDF5', color: '#065F46', label: 'Available' },
  locked:    { bg: '#FFFBEB', color: '#92400E', label: 'Reserved' },
  booked:    { bg: '#EFF6FF', color: '#1D4ED8', label: 'Booked' },
  blocked:   { bg: '#F1F5F9', color: '#64748B', label: 'Blocked' },
}

export default function AdminSlots() {
  const [courts, setCourts] = useState<Court[]>([])
  const [selectedCourt, setSelectedCourt] = useState('')
  const [selectedDate, setSelectedDate] = useState(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
  )
  const [slots, setSlots] = useState<Slot[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')
  const [blockingSlotId, setBlockingSlotId] = useState('')
  const [blockReason, setBlockReason] = useState('')
  const [blockType, setBlockType] = useState<'iimpact' | 'custom'>('iimpact')

  useEffect(() => {
    const loadCourts = async () => {
      const { data } = await supabase.from('courts').select('*').eq('is_active', true)
      if (data) { setCourts(data); if (data.length > 0) setSelectedCourt(data[0].id) }
    }
    loadCourts()
  }, [])

  useEffect(() => {
    if (!selectedCourt || !selectedDate) return
    loadSlots()
  }, [selectedCourt, selectedDate])

  const loadSlots = async () => {
    setLoading(true)
    const { data } = await supabase.from('slots').select('*').eq('court_id', selectedCourt).eq('slot_date', selectedDate).order('start_time')
    if (data) setSlots(data)
    setLoading(false)
  }

  const court = courts.find(c => c.id === selectedCourt)

  const generateSlots = async () => {
    if (!court || !selectedDate) return
    setGenerating(true)
    setMessage('')

    const { data: pricing } = await supabase.from('court_pricing').select('*').eq('court_id', selectedCourt)

    const getPrice = (hour: number, type: string) => {
      if (!pricing) return 0
      const time = `${hour.toString().padStart(2, '0')}:00:00`
      const match = pricing.find(p => p.applies_to === type && p.time_from <= time && p.time_to > time)
      return match ? match.price_lkr : 0
    }

    const startHour = parseInt(court.operating_start.split(':')[0])
    const endHour = parseInt(court.operating_end.split(':')[0])
    const duration = court.slot_duration_hrs
    const cutoffHour = parseInt((court.half_court_cutoff || '14:00').split(':')[0])
    const slotsToInsert = []

    for (let hour = startHour; hour < endHour; hour += duration) {
      const startTime = `${hour.toString().padStart(2, '0')}:00:00`
      const endTime = `${(hour + duration).toString().padStart(2, '0')}:00:00`
      const isBeforeCutoff = hour < cutoffHour

      slotsToInsert.push({ court_id: selectedCourt, slot_date: selectedDate, start_time: startTime, end_time: endTime, court_type: 'full_court', status: 'available', price_lkr: getPrice(hour, 'full_court'), version: 0 })

      if (court.has_half_court && isBeforeCutoff) {
        slotsToInsert.push({ court_id: selectedCourt, slot_date: selectedDate, start_time: startTime, end_time: endTime, court_type: 'half_a', status: 'available', price_lkr: getPrice(hour, 'half_a'), version: 0 })
        slotsToInsert.push({ court_id: selectedCourt, slot_date: selectedDate, start_time: startTime, end_time: endTime, court_type: 'half_b', status: 'available', price_lkr: getPrice(hour, 'half_b'), version: 0 })
      }
    }

    const { error } = await supabase.from('slots').insert(slotsToInsert)
    if (error) setMessage('Some slots already exist for this date.')
    else setMessage(`Generated ${slotsToInsert.length} slots successfully.`)
    await loadSlots()
    setGenerating(false)
  }

  const blockSlot = async (slotId: string) => {
    const reason = blockType === 'iimpact' ? 'IIMPACT Practice' : blockReason
    if (!reason.trim()) { setMessage('Please enter a reason.'); return }

    await supabase.from('slots').update({
      status: 'blocked',
      internal_reason: reason,
    }).eq('id', slotId)

    setBlockingSlotId('')
    setBlockReason('')
    await loadSlots()
  }

  const unblockSlot = async (slotId: string) => {
    await supabase.from('slots').update({ status: 'available', internal_reason: null }).eq('id', slotId)
    await loadSlots()
  }

  const deleteAllSlots = async () => {
    if (!confirm('Delete all available and blocked slots for this date? Booked slots will not be deleted.')) return
    await supabase.from('slots').delete().eq('court_id', selectedCourt).eq('slot_date', selectedDate).in('status', ['available', 'blocked'])
    await loadSlots()
    setMessage('Unbooked slots deleted.')
  }

  const grouped: Record<string, Slot[]> = {}
  slots.forEach(slot => {
    const key = `${slot.start_time}-${slot.end_time}`
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(slot)
  })

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + 60)
  const maxDateStr = maxDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>Slot Management</h1>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Generate, block, and manage court slots</p>
        </div>
        <a href="/admin/recurring"
          style={{ background: '#EFF6FF', color: '#1D4ED8', border: '0.5px solid #BFDBFE', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: '600', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
          🔄 Recurring bookings
        </a>
      </div>

      {/* Controls */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '12px', alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', fontWeight: '500', marginBottom: '5px', letterSpacing: '0.04em' }}>COURT</label>
            <select value={selectedCourt} onChange={e => setSelectedCourt(e.target.value)}
              style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '9px 10px', fontSize: '13px', color: '#0F172A', background: '#fff', outline: 'none' }}>
              {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', fontWeight: '500', marginBottom: '5px', letterSpacing: '0.04em' }}>DATE</label>
            <input type="date" value={selectedDate} min={today} max={maxDateStr}
              onChange={e => setSelectedDate(e.target.value)}
              style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '9px 10px', fontSize: '13px', color: '#0F172A', outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={generateSlots} disabled={generating}
              style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: '600', cursor: generating ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: generating ? 0.7 : 1 }}>
              {generating ? 'Generating...' : '+ Generate Slots'}
            </button>
            {slots.length > 0 && (
              <button onClick={deleteAllSlots}
                style={{ background: '#FEE2E2', color: '#DC2626', border: 'none', borderRadius: '8px', padding: '9px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                Clear
              </button>
            )}
          </div>
        </div>

        {message && (
          <div style={{ marginTop: '12px', background: '#ECFDF5', border: '0.5px solid #6EE7B7', borderRadius: '8px', padding: '10px 14px' }}>
            <p style={{ fontSize: '13px', color: '#065F46', margin: 0 }}>✅ {message}</p>
          </div>
        )}
      </div>

      {/* Court info */}
      {court && (
        <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: '#64748B' }}>🕐 Operating: <strong>{court.operating_start.slice(0,5)} - {court.operating_end.slice(0,5)}</strong></span>
          <span style={{ fontSize: '12px', color: '#64748B' }}>⏱ Slot duration: <strong>{court.slot_duration_hrs}h</strong></span>
          {court.has_half_court && <span style={{ fontSize: '12px', color: '#1D4ED8' }}>🏀 Half court before: <strong>{court.half_court_cutoff?.slice(0,5)}</strong></span>}
        </div>
      )}

      {/* Slots */}
      {loading ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <p style={{ color: '#64748B', fontSize: '14px' }}>Loading slots...</p>
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>📅</div>
          <p style={{ fontSize: '15px', fontWeight: '500', color: '#0F172A', margin: '0 0 4px' }}>No slots for this date</p>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Click Generate Slots to create slots for this date</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {Object.entries(grouped).map(([timeKey, timeSlots]) => {
            const [start, end] = timeKey.split('-')
            const startHour = parseInt(start.split(':')[0])
            const cutoffHour = parseInt((court?.half_court_cutoff || '14:00').split(':')[0])
            const isPeak = startHour >= cutoffHour

            return (
              <div key={timeKey} style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#0F172A' }}>{start.slice(0,5)} - {end.slice(0,5)}</span>
                  <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: '500', background: isPeak ? '#FEF3C7' : '#ECFDF5', color: isPeak ? '#92400E' : '#065F46' }}>
                    {isPeak ? 'Peak' : 'Off-peak'}
                  </span>
                  <span style={{ fontSize: '11px', color: '#94A3B8', marginLeft: 'auto' }}>{timeSlots.length} slot unit{timeSlots.length > 1 ? 's' : ''}</span>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {timeSlots.map(slot => {
                    const st = STATUS_STYLES[slot.status] || STATUS_STYLES.blocked
                    const isBlocking = blockingSlotId === slot.id

                    return (
                      <div key={slot.id} style={{ flex: 1, minWidth: '180px', background: st.bg, border: `0.5px solid ${st.color}30`, borderRadius: '10px', padding: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <p style={{ fontSize: '12px', fontWeight: '700', color: '#0F172A', margin: 0 }}>{COURT_TYPE_LABELS[slot.court_type]}</p>
                          <span style={{ fontSize: '10px', background: st.bg, color: st.color, padding: '2px 7px', borderRadius: '20px', border: `0.5px solid ${st.color}50`, fontWeight: '600' }}>{st.label}</span>
                        </div>
                        <p style={{ fontSize: '13px', fontWeight: '700', color: '#1B6B3A', margin: '0 0 4px' }}>LKR {slot.price_lkr.toLocaleString()}</p>
                        {slot.internal_reason && (
                          <p style={{ fontSize: '11px', color: '#64748B', margin: '0 0 8px', fontStyle: 'italic' }}>📌 {slot.internal_reason}</p>
                        )}

                        {slot.status === 'available' && (
                          <div>
                            {!isBlocking ? (
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button onClick={() => { setBlockingSlotId(slot.id); setBlockType('iimpact'); setBlockReason('') }}
                                  style={{ flex: 1, background: '#EFF6FF', color: '#1D4ED8', border: 'none', borderRadius: '6px', padding: '5px', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}>
                                  IIMPACT
                                </button>
                                <button onClick={() => { setBlockingSlotId(slot.id); setBlockType('custom'); setBlockReason('') }}
                                  style={{ flex: 1, background: '#FEF3C7', color: '#92400E', border: 'none', borderRadius: '6px', padding: '5px', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}>
                                  Block
                                </button>
                              </div>
                            ) : (
                              <div>
                                {blockType === 'iimpact' ? (
                                  <div>
                                    <p style={{ fontSize: '11px', color: '#1D4ED8', margin: '0 0 6px', fontWeight: '600' }}>Reserve for IIMPACT Practice?</p>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                      <button onClick={() => blockSlot(slot.id)}
                                        style={{ flex: 1, background: '#1D4ED8', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>
                                        Confirm
                                      </button>
                                      <button onClick={() => setBlockingSlotId('')}
                                        style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '5px', padding: '5px', fontSize: '11px', cursor: 'pointer' }}>
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <input type="text" placeholder="Reason (e.g. Company booking)" value={blockReason}
                                      onChange={e => setBlockReason(e.target.value)}
                                      style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '6px', padding: '5px 8px', fontSize: '11px', outline: 'none', marginBottom: '4px', boxSizing: 'border-box' }} />
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                      <button onClick={() => blockSlot(slot.id)}
                                        style={{ flex: 1, background: '#92400E', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>
                                        Block
                                      </button>
                                      <button onClick={() => { setBlockingSlotId(''); setBlockReason('') }}
                                        style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '5px', padding: '5px', fontSize: '11px', cursor: 'pointer' }}>
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {slot.status === 'blocked' && (
                          <button onClick={() => unblockSlot(slot.id)}
                            style={{ width: '100%', background: '#ECFDF5', color: '#065F46', border: 'none', borderRadius: '6px', padding: '6px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>
                            Unblock
                          </button>
                        )}

                        {slot.status === 'booked' && (
                          <div style={{ background: 'rgba(0,0,0,0.04)', borderRadius: '6px', padding: '5px', fontSize: '11px', color: '#1D4ED8', textAlign: 'center', fontWeight: '500' }}>
                            Paid & Confirmed
                          </div>
                        )}

                        {slot.status === 'locked' && (
                          <div style={{ background: '#FEF3C7', borderRadius: '6px', padding: '5px', fontSize: '11px', color: '#92400E', textAlign: 'center', fontWeight: '500' }}>
                            In progress
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
