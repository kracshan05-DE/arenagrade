'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ImageUpload from '@/components/ImageUpload'

interface Portfolio {
  id: string
  title: string
  location: string
  sport_type: string
  description: string
  images: string[]
  is_active: boolean
  created_at: string
}

const SPORT_TYPES = ['Basketball', 'Squash', 'Netball', 'Tennis', 'Badminton', 'Futsal', 'Multi-sport']

const emptyForm = {
  title: '',
  location: '',
  sport_type: 'Basketball',
  description: '',
  images: [] as string[],
  is_active: true,
}

export default function AdminPortfolio() {
  const [items, setItems] = useState<Portfolio[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Portfolio | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [message, setMessage] = useState('')

  useEffect(() => { loadItems() }, [])

  const loadItems = async () => {
    setLoading(true)
    const { data } = await supabase.from('court_portfolio').select('*').order('created_at', { ascending: false })
    if (data) setItems(data)
    setLoading(false)
  }

  const openAdd = () => {
    setForm({ ...emptyForm })
    setEditing(null)
    setShowForm(true)
  }

  const openEdit = (item: Portfolio) => {
    setForm({
      title: item.title,
      location: item.location,
      sport_type: item.sport_type,
      description: item.description || '',
      images: item.images || [],
      is_active: item.is_active,
    })
    setEditing(item)
    setShowForm(true)
  }

  const save = async () => {
    if (!form.title || !form.location) {
      setMessage('Please enter title and location.')
      return
    }
    const payload = {
      title: form.title,
      location: form.location,
      sport_type: form.sport_type,
      description: form.description,
      images: form.images,
      is_active: form.is_active,
    }
    if (editing) {
      const { error } = await supabase.from('court_portfolio').update(payload).eq('id', editing.id)
      if (error) { setMessage('Error: ' + error.message); return }
      setMessage('Updated successfully.')
    } else {
      const { error } = await supabase.from('court_portfolio').insert(payload)
      if (error) { setMessage('Error: ' + error.message); return }
      setMessage('Added successfully.')
    }
    setShowForm(false)
    setEditing(null)
    await loadItems()
  }

  const toggleActive = async (item: Portfolio) => {
    await supabase.from('court_portfolio').update({ is_active: !item.is_active }).eq('id', item.id)
    await loadItems()
  }

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this portfolio item?')) return
    await supabase.from('court_portfolio').delete().eq('id', id)
    await loadItems()
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>Court Portfolio</h1>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Showcase courts built by ArenaGrade</p>
        </div>
        <button onClick={openAdd}
          style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
          + Add Court
        </button>
      </div>

      {message && (
        <div style={{ background: '#ECFDF5', border: '0.5px solid #6EE7B7', borderRadius: '8px', padding: '10px 16px', marginBottom: '16px' }}>
          <p style={{ fontSize: '13px', color: '#065F46', margin: 0 }}>✅ {message}</p>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '20px' }}>
          <p style={{ fontSize: '14px', fontWeight: '600', color: '#0F172A', margin: '0 0 16px' }}>
            {editing ? `Editing: ${editing.title}` : 'Add Court to Portfolio'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>TITLE *</label>
              <input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})}
                placeholder="e.g. IIMPACT Hoop Lab Basketball Court"
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>LOCATION *</label>
              <input type="text" value={form.location} onChange={e => setForm({...form, location: e.target.value})}
                placeholder="e.g. Colombo 03"
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>SPORT TYPE</label>
              <select value={form.sport_type} onChange={e => setForm({...form, sport_type: e.target.value})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', background: '#fff' }}>
                {SPORT_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="checkbox" checked={form.is_active} onChange={e => setForm({...form, is_active: e.target.checked})} id="active_pf" />
              <label htmlFor="active_pf" style={{ fontSize: '13px', color: '#0F172A', cursor: 'pointer' }}>Show on website</label>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>DESCRIPTION</label>
              <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                placeholder="Brief description of the court project..."
                rows={3}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '6px' }}>COURT PHOTOS</label>
              <ImageUpload
                folder="portfolio"
                existingImages={form.images}
                onImagesChange={(urls) => setForm({...form, images: urls})}
                maxImages={8}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => { setShowForm(false); setEditing(null) }}
              style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={save}
              style={{ flex: 2, background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              {editing ? 'Save Changes' : 'Add to Portfolio'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <p style={{ color: '#64748B' }}>Loading...</p>
        </div>
      ) : items.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>🏟</div>
          <p style={{ fontSize: '15px', fontWeight: '500', color: '#0F172A', margin: '0 0 4px' }}>No portfolio items yet</p>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Add courts you have built to showcase your work</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
          {items.map(item => (
            <div key={item.id} style={{ background: '#fff', borderRadius: '12px', border: `0.5px solid ${item.is_active ? '#E2E8F0' : '#F1F5F9'}`, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '16/9', background: '#F8FAFC', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {item.images && item.images.length > 0 ? (
                  <img src={item.images[0]} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: '48px', opacity: 0.3 }}>🏟</span>
                )}
              </div>
              <div style={{ padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <div>
                    <p style={{ fontSize: '14px', fontWeight: '700', color: '#0F172A', margin: '0 0 2px' }}>{item.title}</p>
                    <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>📍 {item.location} · {item.sport_type}</p>
                  </div>
                  <span style={{ fontSize: '10px', background: item.is_active ? '#ECFDF5' : '#F1F5F9', color: item.is_active ? '#065F46' : '#64748B', padding: '2px 8px', borderRadius: '20px', fontWeight: '500', flexShrink: 0 }}>
                    {item.is_active ? 'Visible' : 'Hidden'}
                  </span>
                </div>
                {item.images && item.images.length > 0 && (
                  <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 10px' }}>📸 {item.images.length} photo{item.images.length > 1 ? 's' : ''}</p>
                )}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => toggleActive(item)}
                    style={{ flex: 1, background: item.is_active ? '#FEE2E2' : '#ECFDF5', color: item.is_active ? '#DC2626' : '#065F46', border: 'none', borderRadius: '7px', padding: '6px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>
                    {item.is_active ? 'Hide' : 'Show'}
                  </button>
                  <button onClick={() => openEdit(item)}
                    style={{ flex: 1, background: '#F8FAFC', color: '#0F172A', border: '0.5px solid #E2E8F0', borderRadius: '7px', padding: '6px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>
                    Edit
                  </button>
                  <button onClick={() => deleteItem(item.id)}
                    style={{ background: '#FEE2E2', color: '#DC2626', border: 'none', borderRadius: '7px', padding: '6px 10px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>
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
