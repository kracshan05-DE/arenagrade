'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Navbar from '@/components/Navbar'

interface SportType { id: string; name: string }
interface District { id: string; name: string }
interface City { id: string; name: string; district_id: string }
interface Court {
  id: string; name: string; has_half_court: boolean
  operating_start: string; operating_end: string
  locations: { name: string; address: string }
  sport_types: { name: string }
  court_pricing: { tier_name: string; price_lkr: number; applies_to: string }[]
}

const SPORT_ICONS: Record<string, string> = {
  Basketball: '🏀', Squash: '🎾', Tennis: '🎾', Badminton: '🏸', Futsal: '⚽',
}

export default function LandingPage() {
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
    const load = async () => {
      const [{ data: s }, { data: d }] = await Promise.all([
        supabase.from('sport_types').select('*').eq('is_active', true).order('name'),
        supabase.from('districts').select('*').order('name'),
      ])
      if (s) setSports(s)
      if (d) setDistricts(d)
    }
    load()
  }, [])

  useEffect(() => {
    if (!selectedDistrict) { setCities([]); setSelectedCity(''); return }
    supabase.from('cities').select('*').eq('district_id', selectedDistrict).eq('is_active', true).order('name')
      .then(({ data }) => { if (data) setCities(data) })
  }, [selectedDistrict])

  const searchCourts = async () => {
    if (!selectedSport || !selectedDistrict) return
    setLoading(true); setSearched(true)
    let q = supabase.from('courts').select(`*, locations!inner(name,address,district_id,city_id), sport_types!inner(name), court_pricing(tier_name,price_lkr,applies_to)`)
      .eq('is_active', true).eq('sport_type_id', selectedSport).eq('locations.district_id', selectedDistrict)
    if (selectedCity) q = q.eq('locations.city_id', selectedCity)
    const { data } = await q
    if (data) setCourts(data)
    setLoading(false)
  }

  const getMinPrice = (pricing: Court['court_pricing']) => {
    if (!pricing || pricing.length === 0) return 'N/A'
    return `LKR ${Math.min(...pricing.map(p => p.price_lkr)).toLocaleString()}`
  }

  const F = 'system-ui, -apple-system, sans-serif'

  return (
    <main style={{ minHeight: '100vh', background: '#FAFAF8', fontFamily: F }}>
      <Navbar />

      {/* ── HERO ── */}
      <section style={{ background: '#0B2818', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.04 }}>
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="court" x="0" y="0" width="120" height="120" patternUnits="userSpaceOnUse">
                <rect x="10" y="10" width="100" height="100" fill="none" stroke="#fff" strokeWidth="1"/>
                <circle cx="60" cy="60" r="20" fill="none" stroke="#fff" strokeWidth="1"/>
                <line x1="60" y1="10" x2="60" y2="110" stroke="#fff" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#court)"/>
          </svg>
        </div>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '80px 24px 0', position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.15)', borderRadius: '40px', padding: '6px 14px', marginBottom: '28px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ADE80', display: 'inline-block' }}></span>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.75)', letterSpacing: '0.06em', fontWeight: '500' }}>Sri Lanka's Premier Court Company</span>
          </div>
          <h1 style={{ fontSize: '52px', fontWeight: '700', color: '#fff', lineHeight: '1.1', margin: '0 0 20px', letterSpacing: '-0.02em' }}>
            We Build Courts.<br />
            <span style={{ color: '#4ADE80' }}>We Grow the Game.</span>
          </h1>
          <p style={{ fontSize: '17px', color: 'rgba(255,255,255,0.6)', margin: '0 0 48px', maxWidth: '520px', lineHeight: '1.7' }}>
            ArenaGrade designs and constructs world-class sports courts across Sri Lanka — and gives every player a place to book, play, and improve.
          </p>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '64px', flexWrap: 'wrap' }}>
            <a href="#book" style={{ background: '#4ADE80', color: '#0B2818', padding: '13px 28px', borderRadius: '8px', fontSize: '14px', fontWeight: '700', textDecoration: 'none' }}>
              Book a court →
            </a>
            <a href="#about" style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', padding: '13px 28px', borderRadius: '8px', fontSize: '14px', fontWeight: '500', textDecoration: 'none', border: '0.5px solid rgba(255,255,255,0.15)' }}>
              About us
            </a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '0.5px solid rgba(255,255,255,0.1)', paddingTop: '32px' }}>
            {[{ num: '10+', label: 'Courts built' }, { num: '5', label: 'Sports covered' }, { num: '2023', label: 'Founded' }].map((s, i) => (
              <div key={s.label} style={{ padding: '0 24px 32px', borderRight: i < 2 ? '0.5px solid rgba(255,255,255,0.1)' : 'none' }}>
                <p style={{ fontSize: '36px', fontWeight: '700', color: '#4ADE80', margin: '0 0 4px' }}>{s.num}</p>
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHAT WE DO ── */}
      <section style={{ padding: '80px 24px', maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ marginBottom: '48px' }}>
          <p style={{ fontSize: '12px', color: '#1B6B3A', fontWeight: '700', letterSpacing: '0.1em', margin: '0 0 8px' }}>WHAT WE DO</p>
          <h2 style={{ fontSize: '34px', fontWeight: '700', color: '#0B2818', margin: '0 0 12px', letterSpacing: '-0.02em' }}>Everything the game needs.</h2>
          <p style={{ fontSize: '15px', color: '#6B7280', margin: 0, maxWidth: '480px', lineHeight: '1.7' }}>From breaking ground to the final whistle — ArenaGrade is with you at every step.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {[
            { icon: '🏗️', title: 'Court Construction', desc: 'We design and build professional-grade courts for basketball, squash, netball, and more. Every court is built to international standards.', tags: ['Basketball', 'Squash', 'Netball', 'Tennis'], color: '#0B2818', light: '#ECFDF5' },
            { icon: '🛒', title: 'Sports Equipment', desc: 'Shop premium basketballs, hoops, socks, and accessories. Everything a player needs, delivered to your door or picked up at the court.', tags: ['Basketballs', 'Hoops', 'Socks', 'Gear'], color: '#1D4ED8', light: '#EFF6FF' },
            { icon: '📅', title: 'Court Booking', desc: 'Book full or half courts by the hour — anytime, from your phone. Real-time availability, instant confirmation, secure payment.', tags: ['Full court', 'Half court', 'Instant SMS', 'Online pay'], color: '#7C3AED', light: '#F5F3FF' },
          ].map(card => (
            <div key={card.title} style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E5E7EB', padding: '24px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ width: '48px', height: '48px', background: card.light, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', marginBottom: '16px' }}>
                {card.icon}
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#0F172A', margin: '0 0 10px' }}>{card.title}</h3>
              <p style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 16px', lineHeight: '1.7', flex: 1 }}>{card.desc}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {card.tags.map(t => (
                  <span key={t} style={{ fontSize: '11px', background: card.light, color: card.color, padding: '3px 10px', borderRadius: '20px', fontWeight: '500' }}>{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BOOK A COURT (WHITE) ── */}
      <section id="book" style={{ background: '#F0FDF4', padding: '80px 24px', borderTop: '0.5px solid #E5E7EB', borderBottom: '0.5px solid #E5E7EB' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ marginBottom: '36px' }}>
            <p style={{ fontSize: '12px', color: '#1B6B3A', fontWeight: '700', letterSpacing: '0.1em', margin: '0 0 8px' }}>BOOK A COURT</p>
            <h2 style={{ fontSize: '32px', fontWeight: '700', color: '#0B2818', margin: '0 0 8px', letterSpacing: '-0.02em' }}>Find your court.</h2>
            <p style={{ fontSize: '14px', color: '#64748B', margin: 0 }}>Select a sport, district, and area to see available courts.</p>
          </div>
          <div style={{ background: '#fff', border: '0.5px solid #E2E8F0', borderRadius: '14px', padding: '24px', marginBottom: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              {[
                { label: 'SPORT', value: selectedSport, setter: setSelectedSport, options: sports.map(s => ({ id: s.id, label: `${SPORT_ICONS[s.name] || ''} ${s.name}` })), placeholder: 'Select sport' },
                { label: 'DISTRICT', value: selectedDistrict, setter: (v: string) => { setSelectedDistrict(v); setSelectedCity('') }, options: districts.map(d => ({ id: d.id, label: d.name })), placeholder: 'Select district' },
                { label: 'AREA (optional)', value: selectedCity, setter: setSelectedCity, options: cities.map(c => ({ id: c.id, label: c.name })), placeholder: 'All areas', disabled: !selectedDistrict || cities.length === 0 },
              ].map(f => (
                <div key={f.label}>
                  <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8', marginBottom: '6px', letterSpacing: '0.08em', fontWeight: '600' }}>{f.label}</label>
                  <select value={f.value} onChange={e => f.setter(e.target.value)} disabled={'disabled' in f ? f.disabled : false}
                    style={{ width: '100%', background: '#F8FAFC', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: f.value ? '#0F172A' : '#94A3B8', outline: 'none' }}>
                    <option value="">{f.placeholder}</option>
                    {f.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <button onClick={searchCourts} disabled={!selectedSport || !selectedDistrict || loading}
              style={{ width: '100%', background: !selectedSport || !selectedDistrict ? '#94A3B8' : '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: '700', cursor: !selectedSport || !selectedDistrict ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Searching...' : 'Search courts'}
            </button>
          </div>
          {searched && !loading && courts.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>
              <p style={{ fontSize: '15px' }}>No courts found. Try a different area or sport.</p>
            </div>
          )}
          {courts.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {courts.map(court => (
                <div key={court.id} style={{ background: '#F0FDF4', border: '0.5px solid #E2E8F0', borderRadius: '12px', padding: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                  <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                    <div style={{ width: '48px', height: '48px', background: '#ECFDF5', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}>
                      {SPORT_ICONS[court.sport_types.name] || '🏟'}
                    </div>
                    <div>
                      <p style={{ fontSize: '14px', fontWeight: '700', color: '#0F172A', margin: '0 0 3px' }}>{court.name}</p>
                      <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>📍 {court.locations.name} · {court.operating_start.slice(0,5)} - {court.operating_end.slice(0,5)}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 2px' }}>From</p>
                      <p style={{ fontSize: '18px', fontWeight: '700', color: '#1B6B3A', margin: 0 }}>{getMinPrice(court.court_pricing)}</p>
                    </div>
                    <a href={`/courts/${court.id}`} style={{ background: '#1B6B3A', color: '#fff', padding: '9px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', textDecoration: 'none' }}>
                      View slots
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── ABOUT FOUNDER (DARK GREEN) ── */}
      <section id="about" style={{ background: '#0B2818', padding: '80px 24px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '48px', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: '12px', color: '#4ADE80', fontWeight: '700', letterSpacing: '0.1em', margin: '0 0 8px' }}>THE FOUNDER</p>
              <h2 style={{ fontSize: '34px', fontWeight: '700', color: '#fff', margin: '0 0 16px', letterSpacing: '-0.02em', lineHeight: '1.2' }}>
                Praneeth<br />Udumalgala
              </h2>
              <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.65)', lineHeight: '1.8', margin: '0 0 20px' }}>
                National basketball player, award-winning coach, and founder of the IIMPACT HOOP LAB Academy — Praneeth built ArenaGrade from a simple belief: every Sri Lankan player deserves a world-class court to play on.
              </p>
              <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.65)', lineHeight: '1.8', margin: '0 0 28px' }}>
                With years on the national court and a track record of developing the next generation of Sri Lankan ballers, Praneeth brings unmatched credibility to every court ArenaGrade builds.
              </p>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {['National Player', 'Head Coach', 'IIMPACT HOOP LAB Founder', 'Court Builder'].map(badge => (
                  <span key={badge} style={{ fontSize: '12px', background: 'rgba(74,222,128,0.12)', color: '#4ADE80', padding: '5px 12px', borderRadius: '20px', fontWeight: '600', border: '0.5px solid rgba(74,222,128,0.3)' }}>{badge}</span>
                ))}
              </div>
            </div>

            {/* Photo */}
            <div style={{ position: 'relative' }}>
              <div style={{ borderRadius: '16px', overflow: 'hidden', aspectRatio: '4/3' }}>
                <img
                  src="/praneeth.png"
                  alt="Praneeth Udumalgala"
                  style={{ width: '100%', height: '108%', objectFit: 'cover', objectPosition: 'center 20%' }}
                />
              </div>
              {/* <div style={{ position: 'absolute', bottom: '-16px', left: '-16px', background: '#4ADE80', borderRadius: '12px', padding: '14px 18px' }}> 
                <p style={{ fontSize: '20px', fontWeight: '800', color: '#0B2818', margin: '0 0 2px' }}>FOUNDER</p>
                <p style={{ fontSize: '11px', fontWeight: '600', color: '#0B2818', margin: 0, opacity: 0.7 }}>HOOP LAB ACADEMY</p> 
              </div> */}
            </div>
          </div>
        </div>
      </section>

      {/* ── WHO WE ARE ── */}
      <section style={{ background: '#F0FDF4', padding: '80px 24px', borderTop: '0.5px solid #D1FAE5', borderBottom: '0.5px solid #D1FAE5' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: '#059669', fontWeight: '700', letterSpacing: '0.1em', margin: '0 0 8px' }}>WHO WE ARE</p>
          <h2 style={{ fontSize: '34px', fontWeight: '700', color: '#0B2818', margin: '0 0 16px', letterSpacing: '-0.02em' }}>Built by players, for players.</h2>
          <p style={{ fontSize: '16px', color: '#374151', margin: '0 auto 48px', maxWidth: '620px', lineHeight: '1.8' }}>
            ArenaGrade is a Sri Lankan sports infrastructure company. We plan, design, and construct basketball, squash, and netball courts to international standards — and we run this platform so every court we build stays full, every player stays active, and the game keeps growing.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', textAlign: 'left' }}>
            {[
              { title: 'Court Design & Build', desc: 'Full-service court construction from ground up. Site assessment, flooring, lighting, markings, hoops — we handle everything.' },
              { title: 'Equipment Sales', desc: 'Premium basketball shoes, hoops, boards, balls, socks, and accessories. For individuals and institutions ordering in bulk.' },
              { title: 'Online Booking', desc: 'Book our courts online in seconds. Half court or full court, off-peak or peak — choose your slot and pay securely.' },
            ].map(item => (
              <div key={item.title} style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #D1FAE5', padding: '20px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ADE80', marginBottom: '14px' }} />
                <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0B2818', margin: '0 0 8px' }}>{item.title}</h3>
                <p style={{ fontSize: '13px', color: '#6B7280', margin: 0, lineHeight: '1.7' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ background: '#0B2818', padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '36px', fontWeight: '700', color: '#fff', margin: '0 0 14px', letterSpacing: '-0.02em' }}>Ready to play?</h2>
          <p style={{ fontSize: '16px', color: 'rgba(255,255,255,0.5)', margin: '0 0 32px', lineHeight: '1.7' }}>
            Book a court today or reach out about building one for your school, club, or facility.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="#book" style={{ background: '#4ADE80', color: '#0B2818', padding: '13px 32px', borderRadius: '8px', fontSize: '14px', fontWeight: '700', textDecoration: 'none' }}>Book a court</a>
            <a href="mailto:info@arenagrade.lk" style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', padding: '13px 32px', borderRadius: '8px', fontSize: '14px', fontWeight: '500', textDecoration: 'none', border: '0.5px solid rgba(255,255,255,0.15)' }}>Contact us</a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: '#081810', padding: '32px 24px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '28px', height: '28px', background: '#1B6B3A', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>🏟</div>
            <span style={{ fontSize: '14px', fontWeight: '600', color: '#fff' }}>ArenaGrade</span>
          </div>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', margin: 0 }}>© 2026 ArenaGrade. All rights reserved. Sri Lanka.</p>
          <div style={{ display: 'flex', gap: '20px' }}>
            {['Book a court', 'Shop', 'Contact'].map(l => (
              <a key={l} href="#" style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </main>
  )
}
