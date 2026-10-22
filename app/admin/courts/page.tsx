'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Location {
  id: string
  name: string
  address: string
}

interface Court {
  id: string
  name: string
  location_id: string
  sport_type_id: string
  has_half_court: boolean
  half_court_cutoff: string
  operating_start: string
  operating_end: string
  slot_duration_hrs: number
  max_consecutive_slots?: number | null
  weekend_full_court_only?: boolean | null
  is_active: boolean
  locations: { name: string }
  sport_types: { name: string }
}

interface SportType {
  id: string
  name: string
  has_half_court_option: boolean
}

interface Pricing {
  id: string
  court_id: string
  tier_name: string
  time_from: string
  time_to: string
  price_lkr: number
  applies_to: string
}

export default function AdminCourts() {
  const [courts, setCourts] = useState<Court[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [sportTypes, setSportTypes] = useState<SportType[]>([])
  const [loading, setLoading] = useState(true)
  const [editingCourt, setEditingCourt] = useState<Court | null>(null)
  const [editingPricing, setEditingPricing] = useState<Pricing[]>([])
  const [showAddCourt, setShowAddCourt] = useState(false)
  const [message, setMessage] = useState('')
  const [newCourt, setNewCourt] = useState({
    name: '',
    location_id: '',
    sport_type_id: '',
    has_half_court: false,
    half_court_cutoff: '14:00',
    operating_start: '06:00',
    operating_end: '22:00',
    slot_duration_hrs: 2,
    is_active: true,
  })

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    const [{ data: courtsData }, { data: locationsData }, { data: sportsData }] = await Promise.all([
      supabase.from('courts').select('*, locations(name), sport_types(name)').order('name'),
      supabase.from('locations').select('id, name, address').eq('is_active', true),
      supabase.from('sport_types').select('*').eq('is_active', true),
    ])
    if (courtsData) setCourts(courtsData as any)
    if (locationsData) setLocations(locationsData)
    if (sportsData) setSportTypes(sportsData)
    setLoading(false)
  }

  const loadPricing = async (courtId: string) => {
    const { data } = await supabase.from('court_pricing').select('*').eq('court_id', courtId)
    if (data) setEditingPricing(data)
  }

  const openEdit = async (court: Court) => {
    setEditingCourt({ ...court })
    await loadPricing(court.id)
  }

  const saveCourtChanges = async () => {
    if (!editingCourt) return

    const formatTime = (t: string) => {
      if (!t) return '00:00:00'
      return t.length === 5 ? t + ':00' : t
    }

    const { error } = await supabase
      .from('courts')
      .update({
        name: editingCourt.name,
        has_half_court: editingCourt.has_half_court,
        half_court_cutoff: formatTime(editingCourt.half_court_cutoff?.slice(0,5) || '14:00'),
        operating_start: formatTime(editingCourt.operating_start?.slice(0,5) || '06:00'),
        operating_end: formatTime(editingCourt.operating_end?.slice(0,5) || '22:00'),
        slot_duration_hrs: parseInt(String(editingCourt.slot_duration_hrs)),
        max_consecutive_slots: Math.min(4, Math.max(1, parseInt(String(editingCourt.max_consecutive_slots ?? 1)) || 1)),
        weekend_full_court_only: !!editingCourt.has_half_court && !!editingCourt.weekend_full_court_only,
        is_active: editingCourt.is_active,
      })
      .eq('id', editingCourt.id)

    if (error) {
      setMessage('Error saving: ' + error.message)
    } else {
      setMessage('Court updated successfully.')
      setEditingCourt(null)
      await loadAll()
    }
  }

  const savePricing = async () => {
    if (!editingCourt) return
    const formatTime = (t: string) => {
      if (!t) return '00:00:00'
      const clean = t.slice(0, 5)
      return clean.length === 5 ? clean + ':00' : '00:00:00'
    }
    
    let hasError = false
    for (const p of editingPricing) {
      const { error } = await supabase
        .from('court_pricing')
        .update({
          tier_name: p.tier_name,
          time_from: formatTime(p.time_from),
          time_to: formatTime(p.time_to),
          price_lkr: parseFloat(String(p.price_lkr)),
        })
        .eq('id', p.id)
      
      if (error) {
        hasError = true
        setMessage('Error saving pricing: ' + error.message)
        console.error('Pricing error:', error, p)
        break
      }
    }
    
    if (!hasError) {
      setMessage('Pricing updated successfully.')
    }
  }
  const toggleCourtStatus = async (court: Court) => {
    await supabase.from('courts').update({ is_active: !court.is_active }).eq('id', court.id)
    await loadAll()
  }

  const addCourt = async () => {
    if (!newCourt.name || !newCourt.location_id || !newCourt.sport_type_id) {
      setMessage('Please fill in all required fields.')
      return
    }
    const { error } = await supabase.from('courts').insert({
      ...newCourt,
      half_court_cutoff: newCourt.half_court_cutoff + ':00',
      operating_start: newCourt.operating_start + ':00',
      operating_end: newCourt.operating_end + ':00',
    })
    if (error) {
      setMessage('Error adding court.')
    } else {
      setMessage('Court added successfully.')
      setShowAddCourt(false)
      setNewCourt({ name: '', location_id: '', sport_type_id: '', has_half_court: false, half_court_cutoff: '14:00', operating_start: '06:00', operating_end: '22:00', slot_duration_hrs: 2, is_active: true })
      await loadAll()
    }
  }

  const APPLIES_TO_LABELS: Record<string, string> = {
    full_court: 'Full Court',
    half_a: 'Half Court A',
    half_b: 'Half Court B',
  }

  return (
    <div style={{ padding: '28px 32px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>Court Management</h1>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Manage courts, operating hours, and pricing</p>
        </div>
        <button
          onClick={() => setShowAddCourt(!showAddCourt)}
          style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
        >
          + Add Court
        </button>
      </div>

      {message && (
        <div style={{ background: '#ECFDF5', border: '0.5px solid #6EE7B7', borderRadius: '8px', padding: '10px 16px', marginBottom: '16px' }}>
          <p style={{ fontSize: '13px', color: '#065F46', margin: 0 }}>✅ {message}</p>
        </div>
      )}

      {/* Add Court Form */}
      {showAddCourt && (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '20px' }}>
          <p style={{ fontSize: '14px', fontWeight: '600', color: '#0F172A', margin: '0 0 16px' }}>Add New Court</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>COURT NAME *</label>
              <input type="text" value={newCourt.name} onChange={e => setNewCourt({...newCourt, name: e.target.value})}
                placeholder="e.g. Main Basketball Court"
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>LOCATION *</label>
              <select value={newCourt.location_id} onChange={e => setNewCourt({...newCourt, location_id: e.target.value})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', background: '#fff' }}>
                <option value="">Select location</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>SPORT TYPE *</label>
              <select value={newCourt.sport_type_id} onChange={e => setNewCourt({...newCourt, sport_type_id: e.target.value})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', background: '#fff' }}>
                <option value="">Select sport</option>
                {sportTypes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>SLOT DURATION (hours)</label>
              <select value={newCourt.slot_duration_hrs} onChange={e => setNewCourt({...newCourt, slot_duration_hrs: parseInt(e.target.value)})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', background: '#fff' }}>
                <option value={1}>1 hour</option>
                <option value={2}>2 hours</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>OPERATING START</label>
              <input type="time" value={newCourt.operating_start} onChange={e => setNewCourt({...newCourt, operating_start: e.target.value})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>OPERATING END</label>
              <input type="time" value={newCourt.operating_end} onChange={e => setNewCourt({...newCourt, operating_end: e.target.value})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="checkbox" checked={newCourt.has_half_court} onChange={e => setNewCourt({...newCourt, has_half_court: e.target.checked})} id="hc_new" />
              <label htmlFor="hc_new" style={{ fontSize: '13px', color: '#0F172A', cursor: 'pointer' }}>Enable half court splitting</label>
            </div>
            {newCourt.has_half_court && (
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>HALF COURT CUTOFF TIME</label>
                <input type="time" value={newCourt.half_court_cutoff} onChange={e => setNewCourt({...newCourt, half_court_cutoff: e.target.value})}
                  style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowAddCourt(false)}
              style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={addCourt}
              style={{ flex: 2, background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              Add Court
            </button>
          </div>
        </div>
      )}

      {/* Courts List */}
      {loading ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <p style={{ color: '#64748B' }}>Loading courts...</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {courts.map(court => (
            <div key={court.id} style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '20px' }}>

              {editingCourt?.id === court.id ? (
                // Edit mode
                <div>
                  <p style={{ fontSize: '14px', fontWeight: '600', color: '#0F172A', margin: '0 0 16px' }}>Editing: {court.name}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>COURT NAME</label>
                      <input type="text" value={editingCourt.name}
                        onChange={e => setEditingCourt({...editingCourt, name: e.target.value})}
                        style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>SLOT DURATION (hours)</label>
                      <select value={editingCourt.slot_duration_hrs}
                        onChange={e => setEditingCourt({...editingCourt, slot_duration_hrs: parseInt(e.target.value)})}
                        style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', background: '#fff' }}>
                        <option value={1}>1 hour</option>
                        <option value={2}>2 hours</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>OPERATING START</label>
                      <input type="time" value={editingCourt.operating_start?.slice(0,5)}
                        onChange={e => setEditingCourt({...editingCourt, operating_start: e.target.value})}
                        style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>OPERATING END</label>
                      <input type="time" value={editingCourt.operating_end?.slice(0,5)}
                        onChange={e => setEditingCourt({...editingCourt, operating_end: e.target.value})}
                        style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input type="checkbox" checked={editingCourt.has_half_court}
                        onChange={e => setEditingCourt({...editingCourt, has_half_court: e.target.checked})}
                        id={`hc_${court.id}`} />
                      <label htmlFor={`hc_${court.id}`} style={{ fontSize: '13px', color: '#0F172A', cursor: 'pointer' }}>Enable half court splitting</label>
                    </div>
                    {editingCourt.has_half_court && (
                      <div>
                        <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>HALF COURT CUTOFF</label>
                        <input type="time" value={editingCourt.half_court_cutoff?.slice(0,5)}
                          onChange={e => setEditingCourt({...editingCourt, half_court_cutoff: e.target.value})}
                          style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginTop: '10px' }}>
                          <input type="checkbox" checked={!!editingCourt.weekend_full_court_only}
                            onChange={e => setEditingCourt({...editingCourt, weekend_full_court_only: e.target.checked})}
                            id={`wk_${court.id}`} style={{ marginTop: '3px' }} />
                          <label htmlFor={`wk_${court.id}`} style={{ fontSize: '13px', color: '#0F172A', cursor: 'pointer' }}>
                            Full court only on Saturdays and Sundays
                            <span style={{ display: 'block', fontSize: '12px', color: '#64748B' }}>Half courts can never be booked on weekends. If you turn this off, generate slots again to add weekend half courts.</span>
                          </label>
                        </div>
                      </div>
                    )}
                    <div>
                      <label htmlFor={`maxc_${court.id}`} style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>LONGEST BOOKING (CONSECUTIVE SLOTS)</label>
                      <select id={`maxc_${court.id}`} value={editingCourt.max_consecutive_slots ?? 1}
                        onChange={e => setEditingCourt({...editingCourt, max_consecutive_slots: parseInt(e.target.value)})}
                        style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', boxSizing: 'border-box', background: '#fff' }}>
                        <option value={1}>1 slot only</option>
                        <option value={2}>1 or 2 consecutive slots (The Solo Court)</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input type="checkbox" checked={editingCourt.is_active}
                        onChange={e => setEditingCourt({...editingCourt, is_active: e.target.checked})}
                        id={`active_${court.id}`} />
                      <label htmlFor={`active_${court.id}`} style={{ fontSize: '13px', color: '#0F172A', cursor: 'pointer' }}>Court is active (visible to customers)</label>
                    </div>
                  </div>

                  {/* Pricing editor */}
                  {editingPricing.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: '0 0 4px' }}>Pricing (LKR per hour)</p>
                      <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 10px' }}>Slot price = hourly price × slot length. Changes apply to newly generated slots; existing bookings keep the price paid.</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {editingPricing.map((p, i) => (
                          <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', alignItems: 'center', background: '#F8FAFC', borderRadius: '8px', padding: '10px' }}>
                            <div>
                              <p style={{ fontSize: '10px', color: '#94A3B8', margin: '0 0 3px' }}>TIER</p>
                              <input type="text" value={p.tier_name}
                                onChange={e => { const updated = [...editingPricing]; updated[i] = {...p, tier_name: e.target.value}; setEditingPricing(updated) }}
                                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '6px', padding: '5px 8px', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <p style={{ fontSize: '10px', color: '#94A3B8', margin: '0 0 3px' }}>FROM</p>
                              <input type="time" value={p.time_from?.slice(0,5)}
                                onChange={e => { const updated = [...editingPricing]; updated[i] = {...p, time_from: e.target.value}; setEditingPricing(updated) }}
                                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '6px', padding: '5px 8px', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <p style={{ fontSize: '10px', color: '#94A3B8', margin: '0 0 3px' }}>TO</p>
                              <input type="time" value={p.time_to?.slice(0,5)}
                                onChange={e => { const updated = [...editingPricing]; updated[i] = {...p, time_to: e.target.value}; setEditingPricing(updated) }}
                                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '6px', padding: '5px 8px', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <p style={{ fontSize: '10px', color: '#94A3B8', margin: '0 0 3px' }}>PRICE (LKR)</p>
                              <input type="number" value={p.price_lkr}
                                onChange={e => { const updated = [...editingPricing]; updated[i] = {...p, price_lkr: parseFloat(e.target.value)}; setEditingPricing(updated) }}
                                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '6px', padding: '5px 8px', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <button onClick={savePricing}
                        style={{ marginTop: '8px', background: '#EFF6FF', color: '#1D4ED8', border: 'none', borderRadius: '7px', padding: '7px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                        Save Pricing
                      </button>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => setEditingCourt(null)}
                      style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button onClick={saveCourtChanges}
                      style={{ flex: 2, background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                      Save Changes
                    </button>
                  </div>
                </div>
              ) : (
                // View mode
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <div style={{ width: '44px', height: '44px', background: '#ECFDF5', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>
                      🏀
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <p style={{ fontSize: '15px', fontWeight: '700', color: '#0F172A', margin: 0 }}>{court.name}</p>
                        <span style={{ fontSize: '11px', background: court.is_active ? '#ECFDF5' : '#F1F5F9', color: court.is_active ? '#065F46' : '#64748B', padding: '2px 8px', borderRadius: '20px', fontWeight: '500' }}>
                          {court.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', color: '#64748B' }}>📍 {court.locations?.name}</span>
                        <span style={{ fontSize: '12px', color: '#64748B' }}>🏅 {court.sport_types?.name}</span>
                        <span style={{ fontSize: '12px', color: '#64748B' }}>🕐 {court.operating_start?.slice(0,5)} - {court.operating_end?.slice(0,5)}</span>
                        <span style={{ fontSize: '12px', color: '#64748B' }}>⏱ {court.slot_duration_hrs}h slots</span>
                        {court.has_half_court && (
                          <span style={{ fontSize: '12px', color: '#1D4ED8' }}>🏀 Half court before {court.half_court_cutoff?.slice(0,5)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => toggleCourtStatus(court)}
                      style={{ background: court.is_active ? '#FEE2E2' : '#ECFDF5', color: court.is_active ? '#DC2626' : '#065F46', border: 'none', borderRadius: '7px', padding: '7px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                    >
                      {court.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => openEdit(court)}
                      style={{ background: '#F8FAFC', color: '#0F172A', border: '0.5px solid #E2E8F0', borderRadius: '7px', padding: '7px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
