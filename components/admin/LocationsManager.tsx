'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { isGoogleMapsUrl } from '@/lib/mapsUrl'

type Venue = { id: string; name: string; address: string | null; google_maps_url: string | null; is_active: boolean }
type Draft = { name: string; address: string; google_maps_url: string }

const empty: Draft = { name: '', address: '', google_maps_url: '' }
const field = { width: '100%', border: '1px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', boxSizing: 'border-box' as const }
const label = { display: 'block', fontSize: '12px', color: '#475569', marginBottom: '4px', fontWeight: 600 } as const

function validate(d: Draft) {
  if (!d.name.trim()) return 'Enter a venue name.'
  const url = d.google_maps_url.trim()
  if (url && !isGoogleMapsUrl(url)) return 'The map link must be a Google Maps link starting with https:// (for example https://maps.app.goo.gl/…).'
  return ''
}

// Venues (the "locations" table): name, address and Google Maps link. Every
// court at a venue shows the same map link on the website.
export default function LocationsManager({ onChanged }: { onChanged: () => void }) {
  const [venues, setVenues] = useState<Venue[]>([])
  const [editing, setEditing] = useState<string | null>(null) // venue id, or 'new'
  const [draft, setDraft] = useState<Draft>(empty)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchVenues = () => supabase.from('locations').select('id, name, address, google_maps_url, is_active').order('name')
  const load = async () => {
    const { data } = await fetchVenues()
    if (data) setVenues(data as Venue[])
  }
  useEffect(() => {
    let alive = true
    fetchVenues().then(({ data }) => { if (alive && data) setVenues(data as Venue[]) })
    return () => { alive = false }
  }, [])

  const start = (v: Venue | null) => {
    setError('')
    setEditing(v ? v.id : 'new')
    setDraft(v ? { name: v.name, address: v.address ?? '', google_maps_url: v.google_maps_url ?? '' } : empty)
  }

  const save = async () => {
    const problem = validate(draft)
    if (problem) { setError(problem); return }
    setSaving(true)
    const row = { name: draft.name.trim(), address: draft.address.trim() || null, google_maps_url: draft.google_maps_url.trim() || null }
    const { error: e } = editing === 'new'
      ? await supabase.from('locations').insert({ ...row, is_active: true })
      : await supabase.from('locations').update(row).eq('id', editing!)
    setSaving(false)
    if (e) { setError('Could not save the venue: ' + e.message); return }
    setEditing(null)
    await load()
    onChanged()
  }

  return (
    <section aria-labelledby="venues-title" style={{ background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <div>
          <h2 id="venues-title" style={{ fontSize: '15px', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>Venues</h2>
          <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>Address and Google Maps link shown on each court’s page.</p>
        </div>
        {editing === null && (
          <button type="button" onClick={() => start(null)} className="ag-btn ag-btn-secondary ag-btn-sm">+ Add venue</button>
        )}
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {venues.map((v) => (
          <li key={v.id} style={{ border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px 14px' }}>
            {editing === v.id ? editor() : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A', margin: 0 }}>
                    {v.name}{!v.is_active && <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}> (inactive)</span>}
                  </p>
                  <p style={{ fontSize: '12px', color: '#475569', margin: '2px 0 0' }}>{v.address || 'No address'}</p>
                  <p style={{ fontSize: '12px', margin: '2px 0 0', overflowWrap: 'anywhere' }}>
                    {v.google_maps_url
                      ? <a href={v.google_maps_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ag-primary)' }}>Map link set (opens in a new tab)</a>
                      : <span style={{ color: '#92400E' }}>No map link yet</span>}
                  </p>
                </div>
                {editing === null && (
                  <button type="button" onClick={() => start(v)} className="ag-btn ag-btn-ghost ag-btn-sm">Edit</button>
                )}
              </div>
            )}
          </li>
        ))}
        {editing === 'new' && <li style={{ border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px 14px' }}>{editor()}</li>}
      </ul>
    </section>
  )

  function editor() {
    const id = editing ?? 'new'
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <div>
            <label htmlFor={`vn_${id}`} style={label}>Venue name</label>
            <input id={`vn_${id}`} value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={field} />
          </div>
          <div>
            <label htmlFor={`va_${id}`} style={label}>Address</label>
            <input id={`va_${id}`} value={draft.address} maxLength={300} onChange={(e) => setDraft({ ...draft, address: e.target.value })} style={field} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor={`vm_${id}`} style={label}>Google Maps link</label>
            <input id={`vm_${id}`} type="url" inputMode="url" value={draft.google_maps_url} maxLength={500}
              placeholder="https://maps.app.goo.gl/…" aria-describedby={`vmh_${id}`}
              onChange={(e) => setDraft({ ...draft, google_maps_url: e.target.value })} style={field} />
            <p id={`vmh_${id}`} style={{ fontSize: '12px', color: '#64748B', margin: '4px 0 0' }}>
              In Google Maps, open the venue, choose Share, then Copy link, and paste it here.
            </p>
          </div>
        </div>
        <p role="alert" style={{ fontSize: '12px', color: '#B91C1C', margin: error ? '8px 0 0' : 0 }}>{error}</p>
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
          <button type="button" onClick={() => { setEditing(null); setError('') }} className="ag-btn ag-btn-ghost ag-btn-sm">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="ag-btn ag-btn-primary ag-btn-sm">{saving ? 'Saving…' : 'Save venue'}</button>
        </div>
      </div>
    )
  }
}
