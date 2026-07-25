'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface SportType {
  id: string
  name: string
  has_half_court_option: boolean
}

interface District {
  id: string
  name: string
}

interface City {
  id: string
  name: string
  district_id: string
}

interface Court {
  id: string
  name: string
  has_half_court: boolean
  operating_start: string
  operating_end: string
  locations: {
    name: string
    address: string
  }
  sport_types: {
    name: string
  }
  court_pricing: {
    tier_name: string
    price_lkr: number
    applies_to: string
  }[]
}

const SPORT_ICONS: Record<string, string> = {
  Basketball: '🏀',
  Squash: '🎾',
  Tennis: '🎾',
  Badminton: '🏸',
  Futsal: '⚽',
}

export default function Home() {
  const [sports, setSports] = useState<SportType[]>([])
  const [districts, setDistricts] = useState<District[]>([])
  const [cities, setCities] = useState<City[]>([])
  const [courts, setCourts] = useState<Court[]>([])
  const [selectedSport, setSelectedSport] = useState('')
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [selectedCity, setSelectedCity] = useState('')
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    const loadInitialData = async () => {
      const [{ data: sportsData }, { data: districtsData }] = await Promise.all([
        supabase.from('sport_types').select('*').eq('is_active', true).order('name'),
        supabase.from('districts').select('*').order('name'),
      ])
      if (sportsData) setSports(sportsData)
      if (districtsData) setDistricts(districtsData)
    }
    loadInitialData()
  }, [])

  useEffect(() => {
    if (!selectedDistrict) {
      setCities([])
      setSelectedCity('')
      return
    }
    const loadCities = async () => {
      const { data } = await supabase
        .from('cities')
        .select('*')
        .eq('district_id', selectedDistrict)
        .eq('is_active', true)
        .order('name')
      if (data) setCities(data)
    }
    loadCities()
  }, [selectedDistrict])

  const searchCourts = async () => {
    if (!selectedSport || !selectedDistrict) return
    setLoading(true)
    setSearched(true)
    let query = supabase
      .from('courts')
      .select(`
        *,
        locations!inner (name, address, district_id, city_id),
        sport_types!inner (name),
        court_pricing (tier_name, price_lkr, applies_to)
      `)
      .eq('is_active', true)
      .eq('sport_type_id', selectedSport)
      .eq('locations.district_id', selectedDistrict)
    if (selectedCity) {
      query = query.eq('locations.city_id', selectedCity)
    }
    const { data } = await query
    if (data) setCourts(data)
    setLoading(false)
  }

  const getMinPrice = (pricing: Court['court_pricing']) => {
    if (!pricing || pricing.length === 0) return 'N/A'
    const min = Math.min(...pricing.map(p => p.price_lkr))
    return `LKR ${min.toLocaleString()}`
  }

  const getSelectedSportName = () => {
    const sport = sports.find(s => s.id === selectedSport)
    return sport ? sport.name : ''
  }

  return (
    <main style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>

      {/* Nav */}
      <header style={{ background: '#fff', borderBottom: '0.5px solid #E2E8F0', padding: '0 24px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '30px', height: '30px', background: '#1B6B3A', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>
            🏟
          </div>
          <span style={{ fontSize: '16px', fontWeight: '600', color: '#0F172A' }}>
            Arena<span style={{ color: '#1B6B3A' }}>Grade</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <a href="/auth" style={{ fontSize: '13px', color: '#64748B', padding: '6px 12px', borderRadius: '7px', textDecoration: 'none' }}>
            Sign in
          </a>
          <a href="/auth" style={{ fontSize: '13px', background: '#1B6B3A', color: '#fff', padding: '7px 16px', borderRadius: '7px', textDecoration: 'none', fontWeight: '500' }}>
            Book now
          </a>
        </div>
      </header>

      {/* Hero */}
      <section style={{ background: '#0D4A2A', padding: '52px 24px 88px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.03) 0, rgba(255,255,255,0.03) 1px, transparent 0, transparent 50%)', backgroundSize: '24px 24px' }} />
        <div style={{ maxWidth: '600px', margin: '0 auto', position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)', fontSize: '12px', padding: '4px 12px', borderRadius: '20px', marginBottom: '16px' }}>
            📍 Courts across Sri Lanka
          </div>
          <h1 style={{ fontSize: '30px', fontWeight: '600', color: '#fff', lineHeight: '1.3', marginBottom: '10px' }}>
            Find and book your court online
          </h1>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)', margin: 0 }}>
            Basketball · Squash · Tennis · Badminton · Futsal
          </p>
        </div>
      </section>

      {/* Search Card */}
      <section style={{ maxWidth: '680px', margin: '-40px auto 0', padding: '0 16px', position: 'relative', zIndex: 2 }}>
        <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '20px', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '12px' }}>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '5px', fontWeight: '500', letterSpacing: '0.03em' }}>SPORT</label>
              <select
                value={selectedSport}
                onChange={(e) => setSelectedSport(e.target.value)}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '9px 10px', fontSize: '13px', color: '#0F172A', background: '#fff', outline: 'none' }}
              >
                <option value="">Select sport</option>
                {sports.map(s => (
                  <option key={s.id} value={s.id}>{SPORT_ICONS[s.name] || ''} {s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '5px', fontWeight: '500', letterSpacing: '0.03em' }}>DISTRICT</label>
              <select
                value={selectedDistrict}
                onChange={(e) => { setSelectedDistrict(e.target.value); setSelectedCity('') }}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '9px 10px', fontSize: '13px', color: '#0F172A', background: '#fff', outline: 'none' }}
              >
                <option value="">Select district</option>
                {districts.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '5px', fontWeight: '500', letterSpacing: '0.03em' }}>AREA <span style={{ color: '#CBD5E1', fontWeight: '400' }}>(optional)</span></label>
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                disabled={!selectedDistrict || cities.length === 0}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '9px 10px', fontSize: '13px', color: selectedDistrict ? '#0F172A' : '#94A3B8', background: selectedDistrict ? '#fff' : '#F8FAFC', outline: 'none' }}
              >
                <option value="">All areas</option>
                {cities.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

          </div>

          <button
            onClick={searchCourts}
            disabled={!selectedSport || !selectedDistrict || loading}
            style={{ width: '100%', background: !selectedSport || !selectedDistrict ? '#94A3B8' : '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '14px', fontWeight: '600', cursor: !selectedSport || !selectedDistrict ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            {loading ? 'Searching...' : '🔍 Search courts'}
          </button>
        </div>
      </section>

      {/* Results */}
      <section style={{ maxWidth: '680px', margin: '24px auto 0', padding: '0 16px 40px' }}>

        {searched && !loading && courts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔍</div>
            <p style={{ fontSize: '15px', fontWeight: '500', color: '#0F172A', marginBottom: '4px' }}>No courts found</p>
            <p style={{ fontSize: '13px', color: '#64748B' }}>Try a different district or sport type</p>
          </div>
        )}

        {courts.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <span style={{ fontSize: '14px', fontWeight: '600', color: '#0F172A' }}>{courts.length} court{courts.length > 1 ? 's' : ''} found</span>
              <span style={{ fontSize: '12px', color: '#94A3B8' }}>{getSelectedSportName()} · {districts.find(d => d.id === selectedDistrict)?.name}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {courts.map(court => (
                <div key={court.id} style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '18px', transition: 'box-shadow 0.15s' }}>
                  <div style={{ display: 'flex', gap: '14px', marginBottom: '14px' }}>
                    <div style={{ width: '52px', height: '52px', background: '#ECFDF5', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: 0 }}>
                      {SPORT_ICONS[court.sport_types.name] || '🏟'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                        <div>
                          <h3 style={{ fontSize: '15px', fontWeight: '600', color: '#0F172A', margin: '0 0 3px' }}>{court.name}</h3>
                          <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>📍 {court.locations.name}</p>
                          <p style={{ fontSize: '11px', color: '#94A3B8', margin: '1px 0 0' }}>{court.locations.address}</p>
                        </div>
                        <span style={{ fontSize: '11px', background: '#ECFDF5', color: '#065F46', padding: '3px 10px', borderRadius: '20px', fontWeight: '500', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {court.sport_types.name}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                    <span style={{ fontSize: '11px', background: '#F1F5F9', color: '#475569', padding: '3px 10px', borderRadius: '20px' }}>
                      🕐 {court.operating_start.slice(0,5)} - {court.operating_end.slice(0,5)}
                    </span>
                    <span style={{ fontSize: '11px', background: '#F1F5F9', color: '#475569', padding: '3px 10px', borderRadius: '20px' }}>
                      2h slots
                    </span>
                    {court.has_half_court && (
                      <span style={{ fontSize: '11px', background: '#EFF6FF', color: '#1D4ED8', padding: '3px 10px', borderRadius: '20px' }}>
                        Half court available
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '14px', borderTop: '0.5px solid #F1F5F9' }}>
                    <div>
                      <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 2px' }}>Starting from</p>
                      <p style={{ fontSize: '20px', fontWeight: '700', color: '#1B6B3A', margin: 0 }}>{getMinPrice(court.court_pricing)}</p>
                    </div>
                    <a
                      href={`/courts/${court.id}`}
                      style={{ background: '#1B6B3A', color: '#fff', padding: '9px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}
                    >
                      View slots
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

    </main>
  )
}
