'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { apiPost } from '@/lib/apiClient'
import { userMessage } from '@/lib/userMessages'


interface Booking {
  id: string
  created_at: string
  total_lkr: number
  status: string
  cancellation_reason: string | null
  cancelled_by: string | null
  refund_amount_lkr: number | null
  payhere_payment_id: string | null
  user_id: string
  slot_id: string
  court_id: string
}

interface EnrichedBooking extends Booking {
  slot?: {
    slot_date: string
    start_time: string
    end_time: string
    court_type: string
  }
  profile?: {
    full_name: string | null
    phone: string | null
  }
  refund?: {
    id: string
    status: 'pending' | 'initiated' | 'completed' | 'cancelled'
    bank_reference: string | null
    amount_lkr: number
  }
  court?: {
    name: string
  }
}

const COURT_TYPE_LABELS: Record<string, string> = {
  full_court: 'Full Court',
  half_a: 'Half Court A',
  half_b: 'Half Court B',
}

const STATUS_CONFIG: Record<string, { bg: string; color: string; label: string }> = {
  confirmed:              { bg: '#ECFDF5', color: '#065F46', label: 'Confirmed' },
  cancellation_requested: { bg: '#FEE2E2', color: '#DC2626', label: 'Cancel Requested' },
  cancelled:              { bg: '#F1F5F9', color: '#64748B', label: 'Cancelled' },
}

export default function AdminBookings() {
  const [allBookings, setAllBookings] = useState<EnrichedBooking[]>([])
  const [filtered, setFiltered] = useState<EnrichedBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  // Filters
  const [searchPhone, setSearchPhone] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDate, setFilterDate] = useState('')
  const [filterCourt, setFilterCourt] = useState('all')
  const [courts, setCourts] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    loadBookings()
    loadCourts()
  }, [])

  // Apply filters whenever data or filters change
  useEffect(() => {
    applyFilters()
  }, [allBookings, searchPhone, filterStatus, filterDate, filterCourt])

  const loadCourts = async () => {
    const { data } = await supabase.from('courts').select('id, name').eq('is_active', true)
    if (data) setCourts(data)
  }

  const loadBookings = async () => {
    setLoading(true)

    const { data: bookingsData, error } = await supabase
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false })

    if (error || !bookingsData) { setLoading(false); return }

    const { data: refundRows } = await supabase
      .from('refunds').select('id, booking_id, status, bank_reference, amount_lkr')
      .in('booking_id', bookingsData.map((b) => b.id))
    const refundByBooking = new Map((refundRows || []).map((r) => [r.booking_id, r]))

    const enriched: EnrichedBooking[] = await Promise.all(
      bookingsData.map(async (booking) => {
        const [{ data: slotData }, { data: profileData }, { data: courtData }] = await Promise.all([
          supabase.from('slots').select('slot_date, start_time, end_time, court_type').eq('id', booking.slot_id).single(),
          supabase.from('profiles').select('full_name, phone').eq('id', booking.user_id).single(),
          supabase.from('courts').select('name').eq('id', booking.court_id).single(),
        ])
        return {
          ...booking,
          slot: slotData || undefined,
          profile: profileData || undefined,
          court: courtData || undefined,
          refund: refundByBooking.get(booking.id) || undefined,
        }
      })
    )

    setAllBookings(enriched)
    setLoading(false)
  }

  const applyFilters = () => {
    let result = [...allBookings]

    // Phone search
    if (searchPhone.trim()) {
      result = result.filter(b =>
        b.profile?.phone?.includes(searchPhone.trim()) ||
        b.profile?.full_name?.toLowerCase().includes(searchPhone.trim().toLowerCase())
      )
    }

    // Status filter
    if (filterStatus !== 'all') {
      result = result.filter(b => b.status === filterStatus)
    }

    // Date filter
    if (filterDate) {
      result = result.filter(b => b.slot?.slot_date === filterDate)
    }

    // Court filter
    if (filterCourt !== 'all') {
      result = result.filter(b => b.court_id === filterCourt)
    }

    setFiltered(result)
  }

  const clearFilters = () => {
    setSearchPhone('')
    setFilterStatus('all')
    setFilterDate('')
    setFilterCourt('all')
  }

  const hasActiveFilters = searchPhone || filterStatus !== 'all' || filterDate || filterCourt !== 'all'

  // Decisions are made on the server: it checks admin rights, updates the
  // booking atomically, releases the slot, creates the pending refund and only
  // then notifies the customer.
  const decide = async (booking: EnrichedBooking, decision: 'approve' | 'reject') => {
    setProcessing(booking.id)
    const res = await apiPost<{ status?: string; error?: string; customer_sms?: string }>(
      `/api/admin/bookings/${booking.id}/decision`, { decision })
    if (!res.ok) {
      setMessage(userMessage(res.data.error))
    } else if (decision === 'approve') {
      setMessage(`Cancellation approved. Refund of LKR ${booking.total_lkr.toLocaleString()} is PENDING — record the bank transfer below once it is made.${res.data.customer_sms === 'failed' ? ' (Customer SMS failed — please contact them.)' : ''}`)
    } else {
      setMessage(`Cancellation request rejected. Booking remains confirmed.${res.data.customer_sms === 'failed' ? ' (Customer SMS failed — please contact them.)' : ''}`)
    }
    setProcessing(null)
    await loadBookings()
  }
  const approveCancel = (booking: EnrichedBooking) => decide(booking, 'approve')
  const rejectCancel = (booking: EnrichedBooking) => decide(booking, 'reject')

  const updateRefund = async (booking: EnrichedBooking, status: 'initiated' | 'completed' | 'cancelled') => {
    if (!booking.refund) return
    let bank_reference: string | undefined
    if (status === 'completed') {
      const ref = window.prompt('Bank transfer reference for this refund (required):')
      if (!ref || !ref.trim()) return
      bank_reference = ref.trim()
    }
    if (status === 'cancelled' && !window.confirm('Cancel this refund record? Only do this if no refund is owed.')) return
    setProcessing(booking.id)
    const res = await apiPost<{ error?: string }>(`/api/admin/refunds/${booking.refund.id}`, { status, bank_reference })
    setMessage(res.ok ? `Refund marked ${status}.` : userMessage(res.data.error))
    setProcessing(null)
    await loadBookings()
  }


  // Export to CSV
  const exportCSV = () => {
    const rows = [
      ['Booking ID', 'Customer Name', 'Phone', 'Court', 'Date', 'Time', 'Court Type', 'Amount (LKR)', 'Status', 'Booked At'],
      ...filtered.map(b => [
        b.id,
        b.profile?.full_name || 'N/A',
        b.profile?.phone || 'N/A',
        b.court?.name || 'N/A',
        b.slot?.slot_date || 'N/A',
        b.slot ? `${b.slot.start_time.slice(0,5)} - ${b.slot.end_time.slice(0,5)}` : 'N/A',
        COURT_TYPE_LABELS[b.slot?.court_type || ''] || 'N/A',
        b.total_lkr,
        b.status,
        new Date(b.created_at).toLocaleString('en-US', { timeZone: 'Asia/Colombo' }),
      ])
    ]

    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `arenagrade-bookings-${new Date().toLocaleDateString('en-CA')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const pendingCount = allBookings.filter(b => b.status === 'cancellation_requested').length

  return (
    <div style={{ padding: '28px 32px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>Bookings</h1>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>
            {allBookings.length} total · {filtered.length} shown
            {hasActiveFilters && ' (filtered)'}
          </p>
        </div>
        <button onClick={exportCSV}
          style={{ background: '#F8FAFC', color: '#475569', border: '0.5px solid #E2E8F0', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
          📥 Export CSV
        </button>
      </div>

      {message && (
        <div style={{ background: '#ECFDF5', border: '0.5px solid #6EE7B7', borderRadius: '8px', padding: '10px 16px', marginBottom: '16px' }}>
          <p style={{ fontSize: '13px', color: '#065F46', margin: 0 }}>✅ {message}</p>
        </div>
      )}

      {/* Pending cancellations alert */}
      {pendingCount > 0 && (
        <div style={{ background: '#FEE2E2', border: '0.5px solid #FECACA', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: '13px', color: '#DC2626', fontWeight: '600', margin: 0 }}>
            ⚠️ {pendingCount} cancellation request{pendingCount > 1 ? 's' : ''} need your attention
          </p>
          <button onClick={() => setFilterStatus('cancellation_requested')}
            style={{ background: '#DC2626', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
            View now
          </button>
        </div>
      )}

      {/* Filters */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '16px 20px', marginBottom: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '10px', alignItems: 'end' }}>

          {/* Phone/name search */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px', fontWeight: '500' }}>SEARCH</label>
            <input
              type="text"
              value={searchPhone}
              onChange={e => setSearchPhone(e.target.value)}
              placeholder="Phone or name..."
              style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box', color: '#0F172A' }}
            />
          </div>

          {/* Date filter */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px', fontWeight: '500' }}>SLOT DATE</label>
            <input
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box', color: filterDate ? '#0F172A' : '#94A3B8', background: '#fff' }}
            />
          </div>

          {/* Status filter */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px', fontWeight: '500' }}>STATUS</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', background: '#fff', color: '#0F172A' }}>
              <option value="all">All statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancellation_requested">Cancel Requested</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Court filter */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px', fontWeight: '500' }}>COURT</label>
            <select value={filterCourt} onChange={e => setFilterCourt(e.target.value)}
              style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', background: '#fff', color: '#0F172A' }}>
              <option value="all">All courts</option>
              {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Clear filters */}
          <button
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            style={{ background: hasActiveFilters ? '#FEE2E2' : '#F8FAFC', color: hasActiveFilters ? '#DC2626' : '#94A3B8', border: `0.5px solid ${hasActiveFilters ? '#FECACA' : '#E2E8F0'}`, borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: '600', cursor: hasActiveFilters ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
            Clear
          </button>
        </div>

        {/* Active filter summary */}
        {hasActiveFilters && (
          <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {searchPhone && (
              <span style={{ fontSize: '11px', background: '#EFF6FF', color: '#1D4ED8', padding: '3px 10px', borderRadius: '20px', fontWeight: '500' }}>
                Search: "{searchPhone}"
              </span>
            )}
            {filterDate && (
              <span style={{ fontSize: '11px', background: '#EFF6FF', color: '#1D4ED8', padding: '3px 10px', borderRadius: '20px', fontWeight: '500' }}>
                Date: {filterDate}
              </span>
            )}
            {filterStatus !== 'all' && (
              <span style={{ fontSize: '11px', background: '#EFF6FF', color: '#1D4ED8', padding: '3px 10px', borderRadius: '20px', fontWeight: '500' }}>
                Status: {STATUS_CONFIG[filterStatus]?.label}
              </span>
            )}
            {filterCourt !== 'all' && (
              <span style={{ fontSize: '11px', background: '#EFF6FF', color: '#1D4ED8', padding: '3px 10px', borderRadius: '20px', fontWeight: '500' }}>
                Court: {courts.find(c => c.id === filterCourt)?.name}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bookings list */}
      {loading ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <p style={{ color: '#64748B' }}>Loading bookings...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>📅</div>
          <p style={{ fontSize: '15px', fontWeight: '500', color: '#0F172A', margin: '0 0 4px' }}>
            {hasActiveFilters ? 'No bookings match your filters' : 'No bookings yet'}
          </p>
          <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 12px' }}>
            {hasActiveFilters ? 'Try adjusting your search or filters' : 'Bookings will appear here once customers start booking'}
          </p>
          {hasActiveFilters && (
            <button onClick={clearFilters}
              style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 18px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(booking => {
            const st = STATUS_CONFIG[booking.status] || STATUS_CONFIG.cancelled
            const isExpanded = expandedId === booking.id
            const isCancelRequest = booking.status === 'cancellation_requested'
            const customerName = booking.profile?.full_name || booking.profile?.phone || 'Customer'
            const customerPhone = booking.profile?.phone || 'N/A'

            return (
              <div key={booking.id} style={{ background: '#fff', borderRadius: '12px', border: `0.5px solid ${isCancelRequest ? '#FECACA' : '#E2E8F0'}`, overflow: 'hidden' }}>

                {isCancelRequest && (
                  <div style={{ background: '#FEE2E2', padding: '6px 16px', borderBottom: '0.5px solid #FECACA' }}>
                    <p style={{ fontSize: '11px', color: '#DC2626', fontWeight: '600', margin: 0 }}>⚠️ Cancellation requested — action required</p>
                  </div>
                )}

                <div style={{ padding: '16px 20px', cursor: 'pointer' }}
                  onClick={() => setExpandedId(isExpanded ? null : booking.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div style={{ width: '40px', height: '40px', background: '#ECFDF5', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                        🏀
                      </div>
                      <div>
                        <p style={{ fontSize: '14px', fontWeight: '600', color: '#0F172A', margin: '0 0 2px' }}>{customerName}</p>
                        <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 2px' }}>📱 {customerPhone}</p>
                        {booking.slot && (
                          <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0 }}>
                            📅 {booking.slot.slot_date} · {booking.slot.start_time?.slice(0,5)} - {booking.slot.end_time?.slice(0,5)} · {COURT_TYPE_LABELS[booking.slot.court_type] || ''} · {booking.court?.name || ''}
                          </p>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: '14px', fontWeight: '700', color: '#1B6B3A', margin: '0 0 3px' }}>
                          LKR {booking.total_lkr?.toLocaleString()}
                        </p>
                        <span style={{ fontSize: '10px', background: st.bg, color: st.color, padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>
                          {st.label}
                        </span>
                      </div>
                      <span style={{ fontSize: '16px', color: '#94A3B8' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: '0.5px solid #F1F5F9', padding: '16px 20px', background: '#F8FAFC' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                      <div>
                        <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>BOOKING ID</p>
                        <p style={{ fontSize: '12px', color: '#0F172A', margin: 0, fontFamily: 'monospace' }}>{booking.id.slice(0,8)}...</p>
                      </div>
                      <div>
                        <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>PHONE</p>
                        <p style={{ fontSize: '12px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{customerPhone}</p>
                      </div>
                      <div>
                        <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>BOOKED AT</p>
                        <p style={{ fontSize: '12px', color: '#0F172A', margin: 0 }}>
                          {new Date(booking.created_at).toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}
                        </p>
                      </div>
                      {booking.payhere_payment_id && (
                        <div>
                          <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>PAYMENT REF</p>
                          <p style={{ fontSize: '12px', color: '#0F172A', margin: 0, fontFamily: 'monospace' }}>{booking.payhere_payment_id}</p>
                        </div>
                      )}
                      {booking.cancellation_reason && (
                        <div style={{ gridColumn: 'span 3' }}>
                          <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>CANCELLATION REASON</p>
                          <p style={{ fontSize: '12px', color: '#DC2626', margin: 0 }}>{booking.cancellation_reason}</p>
                        </div>
                      )}
                      {booking.refund_amount_lkr && (
                        <div>
                          <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>REFUND AMOUNT</p>
                          <p style={{ fontSize: '12px', color: '#1B6B3A', fontWeight: '700', margin: 0 }}>LKR {booking.refund_amount_lkr.toLocaleString()}</p>
                        </div>
                      )}
                      {booking.refund && (
                        <div style={{ gridColumn: 'span 2' }}>
                          <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 3px' }}>REFUND STATUS</p>
                          <p style={{ fontSize: '12px', fontWeight: '700', margin: '0 0 6px', color: booking.refund.status === 'completed' ? '#065F46' : '#92400E' }}>
                            {booking.refund.status.toUpperCase()}{booking.refund.bank_reference ? ` · ref ${booking.refund.bank_reference}` : ''}
                          </p>
                          {(booking.refund.status === 'pending' || booking.refund.status === 'initiated') && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              {booking.refund.status === 'pending' && (
                                <button onClick={() => updateRefund(booking, 'initiated')} disabled={processing === booking.id}
                                  style={{ fontSize: '11px', background: '#FFFBEB', color: '#92400E', border: '0.5px solid #FDE68A', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer' }}>
                                  Mark transfer started
                                </button>
                              )}
                              <button onClick={() => updateRefund(booking, 'completed')} disabled={processing === booking.id}
                                style={{ fontSize: '11px', background: '#ECFDF5', color: '#065F46', border: '0.5px solid #6EE7B7', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer' }}>
                                Mark refunded (needs bank ref)
                              </button>
                              <button onClick={() => updateRefund(booking, 'cancelled')} disabled={processing === booking.id}
                                style={{ fontSize: '11px', background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer' }}>
                                Cancel refund
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {booking.status === 'cancellation_requested' && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => rejectCancel(booking)} disabled={processing === booking.id}
                          style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                          Reject — Keep Booking
                        </button>
                        <button onClick={() => approveCancel(booking)} disabled={processing === booking.id}
                          style={{ flex: 1, background: '#DC2626', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                          {processing === booking.id ? 'Processing...' : `Approve — Refund LKR ${booking.total_lkr?.toLocaleString()}`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
