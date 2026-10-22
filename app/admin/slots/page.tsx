'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { rpcErrorCode } from '@/lib/apiClient'
import { userMessage } from '@/lib/userMessages'
import { isWeekend } from '@/lib/courtInfo'

interface Court {
  id: string; name: string; has_half_court: boolean
  half_court_cutoff: string; operating_start: string
  operating_end: string; slot_duration_hrs: number
  weekend_full_court_only?: boolean | null
}

interface Slot {
  id: string; slot_date: string; start_time: string
  end_time: string; court_type: string; status: string
  price_lkr: number; internal_reason?: string
}

interface GroupedSlots {
  full_court?: Slot
  half_a?: Slot
  half_b?: Slot
}

const COURT_TYPE_LABELS: Record<string, string> = {
  full_court: 'Full Court', half_a: 'Half Court A', half_b: 'Half Court B',
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  available: { bg: '#ECFDF5', color: '#065F46', label: 'Available' },
  locked:    { bg: '#FFFBEB', color: '#92400E', label: 'Reserved' },
  booked:    { bg: '#EFF6FF', color: '#1D4ED8', label: 'Booked' },
  blocked:   { bg: '#F1F5F9', color: '#64748B', label: 'Blocked' },
  na:        { bg: '#F8FAFC', color: '#94A3B8', label: 'N/A' },
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
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [message, setMessage] = useState('')
  const [blockingSlotId, setBlockingSlotId] = useState('')
  const [blockReason, setBlockReason] = useState('')
  const [blockType, setBlockType] = useState<'iimpact' | 'custom'>('iimpact')
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkDays, setBulkDays] = useState(30)
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, skipped: 0, generated: 0 })
  // Holiday marked "full court only" for the selected court and date (null = not marked).
  const [holiday, setHoliday] = useState<{ reason: string | null } | null>(null)
  const [holidayReason, setHolidayReason] = useState('')
  const [holidayBusy, setHolidayBusy] = useState(false)

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + 60)
  const maxDateStr = maxDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })

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
    const [{ data }, { data: fullOnly }] = await Promise.all([
      supabase.from('slots').select('*').eq('court_id', selectedCourt).eq('slot_date', selectedDate).order('start_time'),
      supabase.from('full_court_only_dates').select('reason').eq('court_id', selectedCourt).eq('day', selectedDate).maybeSingle(),
    ])
    if (data) setSlots(data)
    setHoliday(fullOnly ? { reason: fullOnly.reason } : null)
    setLoading(false)
  }

  const court = courts.find(c => c.id === selectedCourt)

  // Slot generation runs on the server (admin_generate_court_slots): it uses
  // the court's own hours, slot length, half-court cut-off and hourly prices,
  // and never duplicates or touches existing slots, so it is safe to re-run.
  const generateRange = async (from: string, to: string) => {
    const { data, error } = await supabase.rpc('admin_generate_court_slots', { p_court_id: selectedCourt, p_from: from, p_to: to })
    if (error) {
      const code = rpcErrorCode(error)
      return { ok: false as const, message: code === 'pricing_missing'
        ? 'This court has no hourly price for one of its slot types. Add prices on the Courts page first.'
        : userMessage(code) }
    }
    return { ok: true as const, created: (data as { created: number }).created, existed: (data as { already_existed: number }).already_existed }
  }

  // Single date generation
  const generateSlots = async () => {
    if (!court || !selectedDate) return
    setGenerating(true)
    setMessage('')
    const r = await generateRange(selectedDate, selectedDate)
    setMessage(r.ok
      ? (r.created ? `Created ${r.created} slots for ${selectedDate}.` : `All slots for ${selectedDate} already exist (${r.existed}).`)
      : r.message)
    await loadSlots()
    setGenerating(false)
  }

  // Bulk generation for the selected court, in weekly chunks (progress bar)
  const generateBulkSlots = async () => {
    if (!court) return
    setBulkGenerating(true)
    setMessage('')
    const start = new Date(`${today}T00:00:00Z`)
    const dayStr = (offset: number) => {
      const d = new Date(start); d.setUTCDate(d.getUTCDate() + offset)
      return d.toISOString().slice(0, 10)
    }
    let created = 0, existed = 0, failed = ''
    const CHUNK = 7
    setBulkProgress({ current: 0, total: bulkDays, skipped: 0, generated: 0 })
    for (let i = 0; i < bulkDays; i += CHUNK) {
      const r = await generateRange(dayStr(i), dayStr(Math.min(i + CHUNK, bulkDays) - 1))
      if (!r.ok) { failed = r.message; break }
      created += r.created; existed += r.existed
      setBulkProgress({ current: Math.min(i + CHUNK, bulkDays), total: bulkDays, skipped: existed, generated: created })
    }
    setMessage(failed ? `Stopped: ${failed} (${created} slots created before the error.)`
      : `Created ${created} new slots over ${bulkDays} days. ${existed} already existed and were left unchanged.`)
    setBulkGenerating(false)
    setShowBulkModal(false)
    await loadSlots()
  }

  // Full court only days: weekends (court setting) are automatic; holidays are
  // marked here. The database deletes unused half slots when a date is marked,
  // recreates them when it is unmarked, and refuses if a half court is booked.
  const weekendRule = !!court?.has_half_court && !!court?.weekend_full_court_only && isWeekend(selectedDate)
  const setFullCourtOnly = async (on: boolean) => {
    if (!court) return
    const label = new Date(`${selectedDate}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    if (!confirm(on
      ? `Make ${label} full court only? Unbooked half-court slots for this date will be removed.`
      : `Allow half courts again on ${label}? Half-court slots will be recreated.`)) return
    setHolidayBusy(true)
    setMessage('')
    const { data, error } = await supabase.rpc('admin_set_full_court_only_day', {
      p_court_id: selectedCourt, p_day: selectedDate, p_full_court_only: on, p_reason: on ? holidayReason : null,
    })
    if (error) {
      setMessage(userMessage(rpcErrorCode(error)))
    } else {
      const r = data as { half_slots_deleted: number; half_slots_created: number; weekend_rule: boolean }
      setMessage(on
        ? `${label} is now full court only. ${r.half_slots_deleted} unbooked half-court slots removed.`
        : r.weekend_rule
          ? `Holiday removed. ${label} is a weekend, so it stays full court only.`
          : `Half courts allowed again on ${label}. ${r.half_slots_created} half-court slots created.`)
      setHolidayReason('')
    }
    await loadSlots()
    setHolidayBusy(false)
  }

  const blockSlot = async (slotId: string) => {
    const reason = blockType === 'iimpact' ? 'IIMPACT Practice' : blockReason
    if (!reason.trim()) { setMessage('Please enter a reason.'); return }
    // The database refuses a block that would clash with a booking or active hold.
    const { error } = await supabase.rpc('admin_block_slot', { p_slot_id: slotId, p_reason: reason })
    if (error) setMessage(userMessage(rpcErrorCode(error)))
    setBlockingSlotId('')
    setBlockReason('')
    await loadSlots()
  }

  const unblockSlot = async (slotId: string) => {
    const { error } = await supabase.rpc('admin_unblock_slot', { p_slot_id: slotId })
    if (error) setMessage(userMessage(rpcErrorCode(error)))
    await loadSlots()
  }

  const deleteAllSlots = async () => {
    if (!confirm('Delete all available and blocked slots for this date? Booked slots will not be deleted.')) return
    await supabase.from('slots').delete()
      .eq('court_id', selectedCourt)
      .eq('slot_date', selectedDate)
      .in('status', ['available', 'blocked'])
    await loadSlots()
    setMessage('Unbooked slots deleted.')
  }

  // Group slots by time
  const grouped: Record<string, GroupedSlots> = {}
  slots.forEach(slot => {
    const key = `${slot.start_time}-${slot.end_time}`
    if (!grouped[key]) grouped[key] = {}
    if (slot.court_type === 'full_court') grouped[key].full_court = slot
    if (slot.court_type === 'half_a') grouped[key].half_a = slot
    if (slot.court_type === 'half_b') grouped[key].half_b = slot
  })

  const getEffectiveStatus = (group: GroupedSlots, courtType: string): { status: string; autoNa: boolean } => {
    const slot = group[courtType as keyof GroupedSlots]
    if (!slot) return { status: 'na', autoNa: false }
    const BLOCKING = ['booked', 'locked', 'blocked']
    if (courtType === 'full_court') {
      const halfABlocked = group.half_a && BLOCKING.includes(group.half_a.status)
      const halfBBlocked = group.half_b && BLOCKING.includes(group.half_b.status)
      if (halfABlocked || halfBBlocked) return { status: 'na', autoNa: true }
    }
    if (courtType === 'half_a' || courtType === 'half_b') {
      const fcBlocked = group.full_court && BLOCKING.includes(group.full_court.status)
      if (fcBlocked) return { status: 'na', autoNa: true }
    }
    return { status: slot.status, autoNa: false }
  }

  const renderSlotCard = (group: GroupedSlots, courtType: string) => {
    const slot = group[courtType as keyof GroupedSlots]
    if (!slot) return null
    const { status: effectiveStatus, autoNa } = getEffectiveStatus(group, courtType)
    const st = STATUS_STYLES[effectiveStatus] || STATUS_STYLES.na
    const isBlocking = blockingSlotId === slot.id
    const actualStatus = slot.status

    return (
      <div key={slot.id} style={{ flex: 1, minWidth: '180px', background: st.bg, border: `0.5px solid ${st.color}30`, borderRadius: '10px', padding: '12px', position: 'relative' }}>
        {autoNa && (
          <div style={{ position: 'absolute', top: '-8px', left: '50%', transform: 'translateX(-50%)', background: '#F1F5F9', border: '0.5px solid #CBD5E1', borderRadius: '20px', padding: '2px 8px', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: '9px', color: '#64748B', fontWeight: '600' }}>AUTO N/A</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <p style={{ fontSize: '12px', fontWeight: '700', color: '#0F172A', margin: 0 }}>{COURT_TYPE_LABELS[courtType]}</p>
          <span style={{ fontSize: '10px', background: st.bg, color: st.color, padding: '2px 7px', borderRadius: '20px', border: `0.5px solid ${st.color}50`, fontWeight: '600' }}>
            {autoNa ? 'N/A' : st.label}
          </span>
        </div>
        <p style={{ fontSize: '13px', fontWeight: '700', color: '#1B6B3A', margin: '0 0 4px' }}>LKR {slot.price_lkr.toLocaleString()}</p>
        {slot.internal_reason && (
          <p style={{ fontSize: '11px', color: '#64748B', margin: '0 0 8px', fontStyle: 'italic' }}>📌 {slot.internal_reason}</p>
        )}
        {autoNa && (
          <div style={{ background: '#F1F5F9', borderRadius: '6px', padding: '6px 8px', marginBottom: '4px' }}>
            <p style={{ fontSize: '10px', color: '#64748B', margin: 0, lineHeight: '1.4' }}>
              {courtType === 'full_court'
                ? '⚠️ Half court blocked — auto N/A for customers'
                : '⚠️ Full court blocked — auto N/A for customers'}
            </p>
          </div>
        )}
        {!autoNa && actualStatus === 'available' && (
          !isBlocking ? (
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
                    <button onClick={() => blockSlot(slot.id)} style={{ flex: 1, background: '#1D4ED8', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Confirm</button>
                    <button onClick={() => setBlockingSlotId('')} style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '5px', padding: '5px', fontSize: '11px', cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <input type="text" placeholder="Reason" value={blockReason} onChange={e => setBlockReason(e.target.value)}
                    style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '6px', padding: '5px 8px', fontSize: '11px', outline: 'none', marginBottom: '4px', boxSizing: 'border-box' }} />
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => blockSlot(slot.id)} style={{ flex: 1, background: '#92400E', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Block</button>
                    <button onClick={() => { setBlockingSlotId(''); setBlockReason('') }} style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '5px', padding: '5px', fontSize: '11px', cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )
        )}
        {!autoNa && actualStatus === 'blocked' && (
          <button onClick={() => unblockSlot(slot.id)} style={{ width: '100%', background: '#ECFDF5', color: '#065F46', border: 'none', borderRadius: '6px', padding: '6px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Unblock</button>
        )}
        {!autoNa && actualStatus === 'booked' && (
          <div style={{ background: 'rgba(0,0,0,0.04)', borderRadius: '6px', padding: '5px', fontSize: '11px', color: '#1D4ED8', textAlign: 'center', fontWeight: '500' }}>Paid & Confirmed</div>
        )}
        {!autoNa && actualStatus === 'locked' && (
          <div style={{ background: '#FEF3C7', borderRadius: '6px', padding: '5px', fontSize: '11px', color: '#92400E', textAlign: 'center', fontWeight: '500' }}>In progress</div>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: '28px 32px' }}>

      {/* Bulk generation modal */}
      {showBulkModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={() => !bulkGenerating && setShowBulkModal(false)} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '440px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#0F172A', margin: '0 0 6px' }}>Bulk Slot Generator</h2>
            <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 20px' }}>
              Generates slots for <strong>{court?.name}</strong> starting from today. Dates that already have slots will be skipped automatically.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '6px', fontWeight: '500' }}>NUMBER OF DAYS</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[7, 14, 30, 60].map(d => (
                  <button key={d} onClick={() => setBulkDays(d)}
                    style={{ flex: 1, background: bulkDays === d ? '#1B6B3A' : '#F8FAFC', color: bulkDays === d ? '#fff' : '#64748B', border: `0.5px solid ${bulkDays === d ? '#1B6B3A' : '#E2E8F0'}`, borderRadius: '8px', padding: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                    {d}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: '12px', color: '#94A3B8', margin: '6px 0 0' }}>
                From today to {new Date(Date.now() + bulkDays * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>

            <div style={{ background: '#FFFBEB', border: '0.5px solid #FDE68A', borderRadius: '8px', padding: '12px 14px', marginBottom: '20px' }}>
              <p style={{ fontSize: '12px', color: '#92400E', margin: '0 0 3px', fontWeight: '600' }}>What this will do</p>
              <p style={{ fontSize: '12px', color: '#92400E', margin: 0, lineHeight: '1.6' }}>
                • Generate slots based on court operating hours and pricing<br />
                • Skip dates that already have slots<br />
                • Will NOT delete or overwrite any existing slots or bookings
              </p>
            </div>

            {/* Progress bar */}
            {bulkGenerating && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', color: '#64748B' }}>Generating...</span>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#1B6B3A' }}>{bulkProgress.current} / {bulkProgress.total} days</span>
                </div>
                <div style={{ height: '8px', background: '#F1F5F9', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: '#1B6B3A', borderRadius: '4px', width: `${bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0}%`, transition: 'width 0.3s ease' }} />
                </div>
                {bulkProgress.skipped > 0 && (
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '4px 0 0' }}>{bulkProgress.skipped} existing slots left unchanged</p>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setShowBulkModal(false)} disabled={bulkGenerating}
                style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '13px', fontWeight: '600', cursor: bulkGenerating ? 'not-allowed' : 'pointer', opacity: bulkGenerating ? 0.5 : 1 }}>
                Cancel
              </button>
              <button onClick={generateBulkSlots} disabled={bulkGenerating}
                style={{ flex: 2, background: bulkGenerating ? '#94A3B8' : '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '13px', fontWeight: '600', cursor: bulkGenerating ? 'not-allowed' : 'pointer' }}>
                {bulkGenerating ? `Generating... (${bulkProgress.current}/${bulkProgress.total})` : `Generate ${bulkDays} days`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>Slot Management</h1>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Generate, block, and manage court slots</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setShowBulkModal(true)}
            style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            ⚡ Bulk Generate
          </button>
          <a href="/admin/recurring"
            style={{ background: '#EFF6FF', color: '#1D4ED8', border: '0.5px solid #BFDBFE', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: '600', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
            🔄 Recurring
          </a>
        </div>
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
              style={{ background: '#475569', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: '600', cursor: generating ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: generating ? 0.7 : 1 }}>
              {generating ? 'Generating...' : '+ This date'}
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
          <div style={{ marginTop: '12px', background: message.includes('Error') ? '#FEE2E2' : '#ECFDF5', border: `0.5px solid ${message.includes('Error') ? '#FECACA' : '#6EE7B7'}`, borderRadius: '8px', padding: '10px 14px' }}>
            <p style={{ fontSize: '13px', color: message.includes('Error') ? '#DC2626' : '#065F46', margin: 0 }}>{message}</p>
          </div>
        )}
      </div>

      {/* Court info */}
      {court && (
        <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: '#64748B' }}>🕐 <strong>{court.operating_start.slice(0,5)} - {court.operating_end.slice(0,5)}</strong></span>
          <span style={{ fontSize: '12px', color: '#64748B' }}>⏱ <strong>{court.slot_duration_hrs}h slots</strong></span>
          {court.has_half_court && <span style={{ fontSize: '12px', color: '#1D4ED8' }}>🏀 Half court before <strong>{court.half_court_cutoff?.slice(0,5)}</strong>{court.weekend_full_court_only ? ' on weekdays' : ''}</span>}
        </div>
      )}

      {/* Full court only (weekends automatic, holidays marked here) */}
      {court?.has_half_court && (
        <div style={{ background: '#fff', border: '0.5px solid #E2E8F0', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>
              {weekendRule ? 'Weekend: full court only' : holiday ? `Full court only${holiday.reason ? ` (${holiday.reason})` : ''}` : 'Half courts offered on this date'}
            </p>
            <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>
              {weekendRule
                ? 'Saturdays and Sundays never offer half courts.'
                : 'Mark Poya days and other holidays as full court only.'}
            </p>
          </div>
          {!weekendRule && !holiday && (
            <>
              <input type="text" value={holidayReason} onChange={(e) => setHolidayReason(e.target.value)} maxLength={100}
                placeholder="Reason (optional), e.g. Poya" aria-label="Reason for full court only"
                style={{ border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', minWidth: '180px' }} />
              <button onClick={() => setFullCourtOnly(true)} disabled={holidayBusy}
                style={{ background: '#0B2818', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 14px', fontSize: '13px', fontWeight: 600, cursor: holidayBusy ? 'wait' : 'pointer' }}>
                Make full court only
              </button>
            </>
          )}
          {holiday && (
            <button onClick={() => setFullCourtOnly(false)} disabled={holidayBusy}
              style={{ background: '#ECFDF5', color: '#065F46', border: '0.5px solid #6EE7B7', borderRadius: '8px', padding: '9px 14px', fontSize: '13px', fontWeight: 600, cursor: holidayBusy ? 'wait' : 'pointer' }}>
              Allow half courts again
            </button>
          )}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {[
          { color: '#ECFDF5', border: '#6EE7B7', label: 'Available' },
          { color: '#FFFBEB', border: '#FCD34D', label: 'Reserved' },
          { color: '#EFF6FF', border: '#BFDBFE', label: 'Booked' },
          { color: '#F1F5F9', border: '#CBD5E1', label: 'Blocked' },
          { color: '#F8FAFC', border: '#E2E8F0', label: 'Auto N/A' },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: item.color, border: `1px solid ${item.border}` }} />
            <span style={{ fontSize: '11px', color: '#64748B' }}>{item.label}</span>
          </div>
        ))}
      </div>

      {/* Slots */}
      {loading ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <p style={{ color: '#64748B', fontSize: '14px' }}>Loading slots...</p>
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>📅</div>
          <p style={{ fontSize: '15px', fontWeight: '500', color: '#0F172A', margin: '0 0 4px' }}>No slots for this date</p>
          <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 16px' }}>Use Bulk Generate to create slots for the next 7, 14, 30, or 60 days at once</p>
          <button onClick={() => setShowBulkModal(true)}
            style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
            ⚡ Bulk Generate
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {Object.entries(grouped).map(([timeKey, group]) => {
            const [start, end] = timeKey.split('-')
            const startHour = parseInt(start.split(':')[0])
            const cutoffHour = parseInt((court?.half_court_cutoff || '14:00').split(':')[0])
            const isPeak = startHour >= cutoffHour

            return (
              <div key={timeKey} style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#0F172A' }}>{start.slice(0,5)} - {end.slice(0,5)}</span>
                  <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: '500', background: isPeak ? '#FEF3C7' : '#ECFDF5', color: isPeak ? '#92400E' : '#065F46' }}>
                    {isPeak ? 'Peak' : 'Off-peak'}
                  </span>
                  <span style={{ fontSize: '11px', color: '#94A3B8', marginLeft: 'auto' }}>
                    {Object.values(group).filter(Boolean).length} slot unit{Object.values(group).filter(Boolean).length > 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {group.full_court && renderSlotCard(group, 'full_court')}
                  {group.half_a && renderSlotCard(group, 'half_a')}
                  {group.half_b && renderSlotCard(group, 'half_b')}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
