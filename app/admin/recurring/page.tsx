'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { rpcErrorCode } from '@/lib/apiClient'
import { userMessage } from '@/lib/userMessages'

interface Court {
  id: string
  name: string
  slot_duration_hrs: number
}

interface RecurringBooking {
  id: string
  court_id: string
  company_name: string
  day_of_week: number
  start_time: string
  end_time: string
  court_type: string
  price_lkr: number
  date_from: string
  date_to: string
  notes: string
  is_active: boolean
  created_at: string
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const COURT_TYPES = [
  { value: 'full_court', label: 'Full Court' },
  { value: 'half_a', label: 'Half Court A' },
  { value: 'half_b', label: 'Half Court B' },
]

const emptyForm = {
  court_id: '',
  company_name: '',
  day_of_week: 1,
  start_time: '07:00',
  end_time: '09:00',
  court_type: 'full_court',
  price_lkr: 0,
  date_from: '',
  date_to: '',
  notes: '',
}

export default function AdminRecurring() {
  const [courts, setCourts] = useState<Court[]>([])
  const [bookings, setBookings] = useState<RecurringBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(false)

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })

  useEffect(() => {
    const load = async () => {
      const [{ data: c }, { data: b }] = await Promise.all([
        supabase.from('courts').select('id, name, slot_duration_hrs').eq('is_active', true),
        supabase.from('recurring_bookings').select('*').order('created_at', { ascending: false }),
      ])
      if (c) { setCourts(c); if (c.length > 0) setForm(f => ({ ...f, court_id: c[0].id })) }
      if (b) setBookings(b)
      setLoading(false)
    }
    load()
  }, [])

  const loadBookings = async () => {
    const { data } = await supabase.from('recurring_bookings').select('*').order('created_at', { ascending: false })
    if (data) setBookings(data)
  }

  // Generated on the server: dates are computed in Asia/Colombo, past dates are
  // skipped, and dates that clash with a customer booking or active hold are
  // skipped and reported instead of being overwritten.
  const generateSlots = async (booking: RecurringBooking) => {
    setGenerating(true)
    setMessage('')
    const { data, error } = await supabase.rpc('admin_generate_recurring_slots', { p_recurring_id: booking.id })
    if (error) {
      setMessage(userMessage(rpcErrorCode(error)))
    } else {
      const r = data as { created: number; converted: number; already_blocked: number; conflict_dates: string[] }
      const clashes = r.conflict_dates?.length
        ? ` ${r.conflict_dates.length} date(s) skipped because a customer booking exists: ${r.conflict_dates.join(', ')}.`
        : ''
      setMessage(`Recurring slots for ${booking.company_name}: ${r.created} created, ${r.converted} blocked, ${r.already_blocked} already blocked.${clashes}`)
    }
    setGenerating(false)
  }

  const save = async () => {
    if (!form.company_name || !form.court_id || !form.date_from || !form.date_to) {
      setMessage('Please fill in all required fields.')
      return
    }
    if (form.date_to < form.date_from) {
      setMessage('End date must be after start date.')
      return
    }

    const { data, error } = await supabase.from('recurring_bookings').insert({
      ...form,
      start_time: form.start_time + ':00',
      end_time: form.end_time + ':00',
      price_lkr: parseFloat(String(form.price_lkr)),
      day_of_week: parseInt(String(form.day_of_week)),
    }).select().single()

    if (error) { setMessage('Error: ' + error.message); return }

    setMessage('Recurring booking saved.')
    setShowForm(false)
    await loadBookings()

    // Auto generate slots
    if (data) await generateSlots(data)
  }

  const toggleActive = async (booking: RecurringBooking) => {
    await supabase.from('recurring_bookings').update({ is_active: !booking.is_active }).eq('id', booking.id)
    await loadBookings()
  }

  const deleteBooking = async (id: string) => {
    if (!confirm('Delete this recurring booking? Existing blocked slots will remain — you need to unblock them manually from the Slots page.')) return
    await supabase.from('recurring_bookings').delete().eq('id', id)
    await loadBookings()
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>Recurring Bookings</h1>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Set up company or academy weekly bookings</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
          + Add Recurring Booking
        </button>
      </div>

      {message && (
        <div style={{ background: '#ECFDF5', border: '0.5px solid #6EE7B7', borderRadius: '8px', padding: '10px 16px', marginBottom: '16px' }}>
          <p style={{ fontSize: '13px', color: '#065F46', margin: 0 }}>{message}</p>
        </div>
      )}

      {/* Info box */}
      <div style={{ background: '#EFF6FF', border: '0.5px solid #BFDBFE', borderRadius: '10px', padding: '14px 16px', marginBottom: '20px' }}>
        <p style={{ fontSize: '13px', fontWeight: '600', color: '#1D4ED8', margin: '0 0 4px' }}>How this works</p>
        <p style={{ fontSize: '12px', color: '#3B82F6', margin: 0 }}>
          Set a company name, which day of the week, what time, and the date range. The system will automatically block all matching slots in that range. Those slots will show as N/A to customers. You can also manually block individual slots from the Slots page.
        </p>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '20px' }}>
          <p style={{ fontSize: '14px', fontWeight: '600', color: '#0F172A', margin: '0 0 16px' }}>New Recurring Booking</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>

            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>COMPANY / ACADEMY NAME *</label>
              <input type="text" value={form.company_name} onChange={e => setForm({...form, company_name: e.target.value})}
                placeholder="e.g. IIMPACT Academy, XYZ Company"
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>COURT *</label>
              <select value={form.court_id} onChange={e => setForm({...form, court_id: e.target.value})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', background: '#fff' }}>
                {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>COURT TYPE</label>
              <select value={form.court_type} onChange={e => setForm({...form, court_type: e.target.value})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', background: '#fff' }}>
                {COURT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>DAY OF WEEK *</label>
              <select value={form.day_of_week} onChange={e => setForm({...form, day_of_week: parseInt(e.target.value)})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', background: '#fff' }}>
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>PRICE (LKR)</label>
              <input type="number" value={form.price_lkr} onChange={e => setForm({...form, price_lkr: parseFloat(e.target.value)})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>START TIME *</label>
              <input type="time" value={form.start_time} onChange={e => setForm({...form, start_time: e.target.value})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>END TIME *</label>
              <input type="time" value={form.end_time} onChange={e => setForm({...form, end_time: e.target.value})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>FROM DATE *</label>
              <input type="date" value={form.date_from} min={today} onChange={e => setForm({...form, date_from: e.target.value})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>TO DATE *</label>
              <input type="date" value={form.date_to} min={form.date_from || today} onChange={e => setForm({...form, date_to: e.target.value})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>NOTES</label>
              <input type="text" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
                placeholder="e.g. Contact: 0771234567"
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>
          </div>

          <div style={{ background: '#FFFBEB', border: '0.5px solid #FDE68A', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px' }}>
            <p style={{ fontSize: '12px', color: '#92400E', margin: 0 }}>
              ⚠️ Saving this will automatically block all matching slots in the date range. Make sure slots are generated first for those dates.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowForm(false)}
              style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={save} disabled={generating}
              style={{ flex: 2, background: generating ? '#94A3B8' : '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: generating ? 'not-allowed' : 'pointer' }}>
              {generating ? 'Generating slots...' : 'Save & Generate Slots'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <p style={{ color: '#64748B' }}>Loading...</p>
        </div>
      ) : bookings.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>🔄</div>
          <p style={{ fontSize: '15px', fontWeight: '500', color: '#0F172A', margin: '0 0 4px' }}>No recurring bookings yet</p>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Add a recurring booking for IIMPACT or company clients</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {bookings.map(booking => (
            <div key={booking.id} style={{ background: '#fff', borderRadius: '12px', border: `0.5px solid ${booking.is_active ? '#E2E8F0' : '#F1F5F9'}`, padding: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <p style={{ fontSize: '15px', fontWeight: '700', color: '#0F172A', margin: 0 }}>{booking.company_name}</p>
                    <span style={{ fontSize: '11px', background: booking.is_active ? '#ECFDF5' : '#F1F5F9', color: booking.is_active ? '#065F46' : '#64748B', padding: '2px 8px', borderRadius: '20px', fontWeight: '500' }}>
                      {booking.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', color: '#64748B' }}>📅 Every {DAYS[booking.day_of_week]}</span>
                    <span style={{ fontSize: '12px', color: '#64748B' }}>🕐 {booking.start_time.slice(0,5)} - {booking.end_time.slice(0,5)}</span>
                    <span style={{ fontSize: '12px', color: '#64748B' }}>🏀 {COURT_TYPES.find(t => t.value === booking.court_type)?.label}</span>
                    <span style={{ fontSize: '12px', color: '#1B6B3A', fontWeight: '600' }}>LKR {booking.price_lkr.toLocaleString()}</span>
                  </div>
                  <p style={{ fontSize: '12px', color: '#94A3B8', margin: '4px 0 0' }}>
                    {booking.date_from} → {booking.date_to}
                    {booking.notes && ` · ${booking.notes}`}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button onClick={() => generateSlots(booking)} disabled={generating}
                    style={{ background: '#EFF6FF', color: '#1D4ED8', border: 'none', borderRadius: '7px', padding: '6px 12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                    🔄 Regenerate
                  </button>
                  <button onClick={() => toggleActive(booking)}
                    style={{ background: booking.is_active ? '#FEE2E2' : '#ECFDF5', color: booking.is_active ? '#DC2626' : '#065F46', border: 'none', borderRadius: '7px', padding: '6px 12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                    {booking.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => deleteBooking(booking.id)}
                    style={{ background: '#FEE2E2', color: '#DC2626', border: 'none', borderRadius: '7px', padding: '6px 10px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
