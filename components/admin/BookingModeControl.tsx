'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { rpcErrorCode } from '@/lib/apiClient'
import { userMessage } from '@/lib/userMessages'

type Mode = 'admin_only' | 'public' | 'closed'

const OPTIONS: { value: Mode; title: string; text: string }[] = [
  { value: 'admin_only', title: 'Admins only (testing)', text: 'Customers can browse but not book. Admin bookings are test bookings.' },
  { value: 'public', title: 'Open to everyone', text: 'Customers can book and pay. Use only after PayHere live is approved and test bookings are purged.' },
  { value: 'closed', title: 'Paused', text: 'Nobody can start a new booking, including admins. Existing bookings are not affected.' },
]

// Site-wide booking switch. The database enforces it on every hold and payment.
export default function BookingModeControl() {
  const [mode, setMode] = useState<Mode | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'booking_mode').maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) { setUnavailable(true); return }
        setMode(data.value as Mode)
      })
  }, [])

  const change = async (next: Mode) => {
    if (next === mode || busy) return
    const label = OPTIONS.find((o) => o.value === next)!.title
    const warn = next === 'public'
      ? '\n\nBefore opening: PayHere must be on LIVE credentials and test bookings must be purged (04_purge_test_bookings.sql).'
      : ''
    if (!window.confirm(`Change booking mode to "${label}"?${warn}`)) return
    setBusy(true)
    setMessage('')
    const { data, error } = await supabase.rpc('admin_set_booking_mode', { p_mode: next })
    setBusy(false)
    if (error || !data) { setMessage(userMessage(rpcErrorCode(error), 'Could not change the booking mode.')); return }
    setMode(next)
    setMessage(`Booking mode is now "${label}".`)
  }

  if (unavailable) return null

  return (
    <section aria-labelledby="booking-mode-title" style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '20px' }}>
      <h2 id="booking-mode-title" style={{ fontSize: '14px', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Online booking</h2>
      <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 14px' }}>Who can make bookings on the website right now.</p>
      <div role="radiogroup" aria-labelledby="booking-mode-title" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
        {OPTIONS.map((o) => {
          const active = mode === o.value
          return (
            <button key={o.value} role="radio" aria-checked={active} disabled={busy || mode === null} onClick={() => change(o.value)} className="ag-tap"
              style={{ textAlign: 'left', borderRadius: '10px', padding: '12px', cursor: busy ? 'wait' : 'pointer',
                background: active ? '#0B2818' : '#F8FAFC', color: active ? '#fff' : '#0F172A', border: `2px solid ${active ? '#0B2818' : '#E2E8F0'}` }}>
              <span style={{ display: 'block', fontSize: '14px', fontWeight: 700, marginBottom: '2px' }}>{o.title}{active ? ' (current)' : ''}</span>
              <span style={{ display: 'block', fontSize: '12px', color: active ? '#BBF7D0' : '#475569' }}>{o.text}</span>
            </button>
          )
        })}
      </div>
      {mode === 'admin_only' && (
        <p style={{ fontSize: '12px', color: '#92400E', margin: '12px 0 0' }}>
          Totals on this page include test bookings until they are purged on launch day.
        </p>
      )}
      <p aria-live="polite" style={{ fontSize: '13px', color: '#0F172A', margin: message ? '10px 0 0' : 0 }}>{message}</p>
    </section>
  )
}
