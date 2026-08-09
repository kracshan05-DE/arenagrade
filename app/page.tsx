'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Navbar from '@/components/Navbar'

interface Court {
  id: string; name: string; has_half_court: boolean
  operating_start: string; operating_end: string
  locations: { name: string; address: string }
  sport_types: { name: string }
  court_pricing: { tier_name: string; price_lkr: number; applies_to: string }[]
}

interface Product {
  id: string; name: string; description: string
  category: string; price_lkr: number; stock_quantity: number
  images: string[]; is_bulk_available: boolean
  bulk_min_qty: number | null; bulk_price_lkr: number | null
}

interface Portfolio {
  id: string; title: string; location: string
  sport_type: string; description: string; images: string[]
}

interface CartItem {
  id: string; name: string; price_lkr: number
  quantity: number; image: string
}

const SPORT_ICONS: Record<string, string> = {
  Basketball: '🏀', Squash: '🎾', Tennis: '🎾', Badminton: '🏸', Futsal: '⚽',
}

const CATEGORY_ICONS: Record<string, string> = {
  basketball: '🏀', squash: '🎾', tennis: '🎾', badminton: '🏸',
  futsal: '⚽', accessories: '🎽', other: '📦',
}

export default function LandingPage() {
  const [courts, setCourts] = useState<Court[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [portfolio, setPortfolio] = useState<Portfolio[]>([])
  const [loading, setLoading] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)
  const [cartMessage, setCartMessage] = useState('')
  const [activePortfolio, setActivePortfolio] = useState<Portfolio | null>(null)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    const load = async () => {
      const [{ data: c }, { data: p }, { data: pf }] = await Promise.all([
        supabase.from('courts').select(`*, locations(name, address), sport_types(name), court_pricing(tier_name, price_lkr, applies_to)`).eq('is_active', true).order('name'),
        supabase.from('products').select('*').eq('is_active', true).gt('stock_quantity', 0).order('name'),
        supabase.from('court_portfolio').select('*').eq('is_active', true).order('created_at', { ascending: false }),
      ])
      if (c) setCourts(c)
      if (p) setProducts(p)
      if (pf) setPortfolio(pf)
      setLoading(false)
    }
    load()
  }, [])

  const getMinPrice = (pricing: Court['court_pricing']) => {
    if (!pricing || pricing.length === 0) return 'N/A'
    return `LKR ${Math.min(...pricing.map(p => p.price_lkr)).toLocaleString()}`
  }

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id)
      if (existing) {
        return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
      }
      return [...prev, { id: product.id, name: product.name, price_lkr: product.price_lkr, quantity: 1, image: product.images?.[0] || '' }]
    })
    setCartMessage(`${product.name} added to cart!`)
    setTimeout(() => setCartMessage(''), 2000)
  }

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(i => i.id !== id))
  }

  const updateQty = (id: string, delta: number) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i))
  }

  const cartTotal = cart.reduce((sum, i) => sum + i.price_lkr * i.quantity, 0)
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0)

  const handleCheckout = () => {
    const items = cart.map(i => `${i.name} x${i.quantity} (LKR ${(i.price_lkr * i.quantity).toLocaleString()})`).join('\n')
    const msg = `Hi ArenaGrade! I'd like to order:\n\n${items}\n\nTotal: LKR ${cartTotal.toLocaleString()}`
    window.open(`https://wa.me/94XXXXXXXXX?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const F = 'system-ui, -apple-system, sans-serif'

  return (
    <main style={{ minHeight: '100vh', background: '#FAFAF8', fontFamily: F, overflowX: 'hidden' }}>
      <Navbar />

      {/* Cart toast */}
      {cartMessage && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: '#1B6B3A', color: '#fff', padding: '10px 20px', borderRadius: '30px', fontSize: '13px', fontWeight: '600', zIndex: 200, boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
          ✅ {cartMessage}
        </div>
      )}

      {/* Floating cart button */}
      {cartCount > 0 && !showCart && (
        <button
          onClick={() => setShowCart(true)}
          style={{ position: 'fixed', bottom: '24px', right: '24px', background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '50px', padding: '12px 20px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', zIndex: 100, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          🛒 Cart ({cartCount})
        </button>
      )}

      {/* Cart drawer */}
      {showCart && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowCart(false)} />
          <div style={{ position: 'relative', background: '#fff', width: isMobile ? '100%' : '380px', height: '100%', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#0F172A', margin: 0 }}>Your Cart</h2>
              <button onClick={() => setShowCart(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748B' }}>✕</button>
            </div>

            {cart.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 0', color: '#94A3B8' }}>
                <div style={{ fontSize: '40px', marginBottom: '10px' }}>🛒</div>
                <p style={{ fontSize: '14px' }}>Your cart is empty</p>
              </div>
            ) : (
              <>
                <div style={{ flex: 1 }}>
                  {cart.map(item => (
                    <div key={item.id} style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 0', borderBottom: '0.5px solid #F1F5F9' }}>
                      <div style={{ width: '48px', height: '48px', background: '#ECFDF5', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0, overflow: 'hidden' }}>
                        {item.image ? <img src={item.image} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '📦'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', margin: '0 0 4px' }}>{item.name}</p>
                        <p style={{ fontSize: '12px', color: '#1B6B3A', fontWeight: '700', margin: 0 }}>LKR {(item.price_lkr * item.quantity).toLocaleString()}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button onClick={() => updateQty(item.id, -1)} style={{ width: '26px', height: '26px', background: '#F1F5F9', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '700' }}>-</button>
                        <span style={{ fontSize: '13px', fontWeight: '600', minWidth: '20px', textAlign: 'center' }}>{item.quantity}</span>
                        <button onClick={() => updateQty(item.id, 1)} style={{ width: '26px', height: '26px', background: '#F1F5F9', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '700' }}>+</button>
                        <button onClick={() => removeFromCart(item.id)} style={{ width: '26px', height: '26px', background: '#FEE2E2', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: '0.5px solid #E2E8F0', paddingTop: '16px', marginTop: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <span style={{ fontSize: '14px', color: '#64748B' }}>Total</span>
                    <span style={{ fontSize: '18px', fontWeight: '800', color: '#1B6B3A' }}>LKR {cartTotal.toLocaleString()}</span>
                  </div>
                  <button onClick={handleCheckout}
                    style={{ width: '100%', background: '#25D366', color: '#fff', border: 'none', borderRadius: '10px', padding: '13px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    📱 Order via WhatsApp
                  </button>
                  <p style={{ fontSize: '11px', color: '#94A3B8', textAlign: 'center', margin: '8px 0 0' }}>We'll confirm your order and arrange delivery</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Portfolio modal */}
      {activePortfolio && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} onClick={() => setActivePortfolio(null)} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '560px', overflow: 'hidden' }}>
            {activePortfolio.images && activePortfolio.images.length > 0 && (
              <div style={{ aspectRatio: '16/9', overflow: 'hidden' }}>
                <img src={activePortfolio.images[0]} alt={activePortfolio.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ padding: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#0F172A', margin: '0 0 6px' }}>{activePortfolio.title}</h3>
              <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 8px' }}>📍 {activePortfolio.location} · {activePortfolio.sport_type}</p>
              {activePortfolio.description && (
                <p style={{ fontSize: '13px', color: '#374151', margin: '0 0 16px', lineHeight: '1.7' }}>{activePortfolio.description}</p>
              )}
              {activePortfolio.images && activePortfolio.images.length > 1 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {activePortfolio.images.slice(1).map((img, i) => (
                    <img key={i} src={img} alt="" style={{ width: '80px', height: '60px', objectFit: 'cover', borderRadius: '8px', border: '0.5px solid #E2E8F0' }} />
                  ))}
                </div>
              )}
              <button onClick={() => setActivePortfolio(null)}
                style={{ background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: isMobile ? '48px 20px 0' : '60px 24px 0', position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.15)', borderRadius: '40px', padding: '6px 14px', marginBottom: '20px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ADE80', display: 'inline-block' }}></span>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.75)', letterSpacing: '0.06em', fontWeight: '500' }}>Sri Lanka's Premier Court Company</span>
          </div>
          <h1 style={{ fontSize: isMobile ? '30px' : '48px', fontWeight: '700', color: '#fff', lineHeight: '1.15', margin: '0 0 16px', letterSpacing: '-0.02em' }}>
            We Build Courts.<br /><span style={{ color: '#4ADE80' }}>We Grow the Game.</span>
          </h1>
          <p style={{ fontSize: isMobile ? '14px' : '16px', color: 'rgba(255,255,255,0.6)', margin: '0 0 28px', lineHeight: '1.7', maxWidth: '520px' }}>
            ArenaGrade designs and constructs world-class sports courts across Sri Lanka — and gives every player a place to book, play, and improve.
          </p>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '40px', flexWrap: 'wrap' }}>
            <a href="#book" style={{ background: '#4ADE80', color: '#0B2818', padding: '11px 22px', borderRadius: '8px', fontSize: '14px', fontWeight: '700', textDecoration: 'none' }}>Book a court →</a>
            <a href="#shop" style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', padding: '11px 22px', borderRadius: '8px', fontSize: '14px', fontWeight: '500', textDecoration: 'none', border: '0.5px solid rgba(255,255,255,0.15)' }}>Shop equipment</a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '0.5px solid rgba(255,255,255,0.1)', paddingTop: '24px' }}>
            {[{ num: '10+', label: 'Courts built' }, { num: '5', label: 'Sports covered' }, { num: '2023', label: 'Founded' }].map((s, i) => (
              <div key={s.label} style={{ padding: isMobile ? '0 12px 24px' : '0 20px 28px', borderRight: i < 2 ? '0.5px solid rgba(255,255,255,0.1)' : 'none' }}>
                <p style={{ fontSize: isMobile ? '24px' : '32px', fontWeight: '700', color: '#4ADE80', margin: '0 0 4px' }}>{s.num}</p>
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BOOK A COURT ── */}
      <section id="book" style={{ background: '#FAFAF8', padding: isMobile ? '48px 20px' : '60px 24px', borderBottom: '0.5px solid #E5E7EB' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ marginBottom: '24px' }}>
            <p style={{ fontSize: '12px', color: '#1B6B3A', fontWeight: '700', letterSpacing: '0.1em', margin: '0 0 8px' }}>BOOK A COURT</p>
            <h2 style={{ fontSize: isMobile ? '24px' : '28px', fontWeight: '700', color: '#0B2818', margin: '0 0 8px', letterSpacing: '-0.02em' }}>Find your court.</h2>
            <p style={{ fontSize: '14px', color: '#64748B', margin: 0 }}>Browse our available courts and book your slot online.</p>
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}><p>Loading courts...</p></div>
          ) : courts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>🏟</div>
              <p>No courts available at the moment.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {courts.map(court => (
                <div key={court.id} style={{ background: '#fff', border: '0.5px solid #E2E8F0', borderRadius: '14px', padding: '18px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', gap: '14px' }}>
                  <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                    <div style={{ width: '52px', height: '52px', background: '#ECFDF5', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: 0 }}>
                      {SPORT_ICONS[court.sport_types.name] || '🏟'}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <p style={{ fontSize: '15px', fontWeight: '700', color: '#0F172A', margin: 0 }}>{court.name}</p>
                        <span style={{ fontSize: '11px', background: '#ECFDF5', color: '#065F46', padding: '2px 8px', borderRadius: '20px', fontWeight: '500' }}>{court.sport_types.name}</span>
                      </div>
                      <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 4px' }}>📍 {court.locations.name}</p>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', background: '#F1F5F9', color: '#475569', padding: '2px 8px', borderRadius: '20px' }}>🕐 {court.operating_start.slice(0,5)} - {court.operating_end.slice(0,5)}</span>
                        {court.has_half_court && <span style={{ fontSize: '11px', background: '#EFF6FF', color: '#1D4ED8', padding: '2px 8px', borderRadius: '20px' }}>Half court</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', width: isMobile ? '100%' : 'auto' }}>
                    <div>
                      <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 2px' }}>Starting from</p>
                      <p style={{ fontSize: '18px', fontWeight: '800', color: '#1B6B3A', margin: 0 }}>{getMinPrice(court.court_pricing)}</p>
                    </div>
                    <a href={`/courts/${court.id}`} style={{ background: '#1B6B3A', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', textDecoration: 'none', whiteSpace: 'nowrap' }}>View slots</a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── PORTFOLIO ── */}
      {portfolio.length > 0 && (
        <section style={{ background: '#0B2818', padding: isMobile ? '48px 20px' : '60px 24px' }}>
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <div style={{ marginBottom: '28px' }}>
              <p style={{ fontSize: '12px', color: '#4ADE80', fontWeight: '700', letterSpacing: '0.1em', margin: '0 0 8px' }}>OUR WORK</p>
              <h2 style={{ fontSize: isMobile ? '24px' : '28px', fontWeight: '700', color: '#fff', margin: '0 0 8px', letterSpacing: '-0.02em' }}>Courts we've built.</h2>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>A portfolio of world-class courts built across Sri Lanka.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '14px' }}>
              {portfolio.map(item => (
                <div key={item.id}
                  onClick={() => setActivePortfolio(item)}
                  style={{ borderRadius: '14px', overflow: 'hidden', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)', transition: 'transform 0.15s' }}
                >
                  <div style={{ aspectRatio: '16/10', overflow: 'hidden', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {item.images && item.images.length > 0 ? (
                      <img src={item.images[0]} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '40px' }}>🏟</span>
                    )}
                  </div>
                  <div style={{ padding: '14px' }}>
                    <p style={{ fontSize: '14px', fontWeight: '700', color: '#fff', margin: '0 0 4px' }}>{item.title}</p>
                    <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: '0 0 6px' }}>📍 {item.location}</p>
                    <span style={{ fontSize: '11px', background: 'rgba(74,222,128,0.12)', color: '#4ADE80', padding: '2px 8px', borderRadius: '20px', border: '0.5px solid rgba(74,222,128,0.2)' }}>{item.sport_type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── SHOP ── */}
      {products.length > 0 && (
        <section id="shop" style={{ background: '#F8FAFC', padding: isMobile ? '48px 20px' : '60px 24px', borderTop: '0.5px solid #E5E7EB' }}>
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <p style={{ fontSize: '12px', color: '#1B6B3A', fontWeight: '700', letterSpacing: '0.1em', margin: '0 0 8px' }}>EQUIPMENT STORE</p>
                <h2 style={{ fontSize: isMobile ? '24px' : '28px', fontWeight: '700', color: '#0B2818', margin: '0 0 8px', letterSpacing: '-0.02em' }}>Shop gear.</h2>
                <p style={{ fontSize: '14px', color: '#64748B', margin: 0 }}>Premium sports equipment delivered to your door.</p>
              </div>
              {cartCount > 0 && (
                <button onClick={() => setShowCart(true)}
                  style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🛒 View cart ({cartCount})
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '14px' }}>
              {products.map(product => (
                <div key={product.id} style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ aspectRatio: '1/1', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {product.images && product.images.length > 0 ? (
                      <img src={product.images[0]} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '40px' }}>{CATEGORY_ICONS[product.category] || '📦'}</span>
                    )}
                  </div>
                  <div style={{ padding: '14px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <p style={{ fontSize: '13px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px', lineHeight: '1.3' }}>{product.name}</p>
                    <p style={{ fontSize: '14px', fontWeight: '800', color: '#1B6B3A', margin: '0 0 4px' }}>LKR {product.price_lkr.toLocaleString()}</p>
                    {product.is_bulk_available && product.bulk_price_lkr && (
                      <p style={{ fontSize: '11px', color: '#1D4ED8', margin: '0 0 8px' }}>Bulk: LKR {product.bulk_price_lkr.toLocaleString()} (min {product.bulk_min_qty})</p>
                    )}
                    <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
                      <button
                        onClick={() => addToCart(product)}
                        style={{ width: '100%', background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                      >
                        Add to cart
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── WHO WE ARE ── */}
      <section id="about" style={{ background: '#F0FDF4', padding: isMobile ? '48px 20px' : '60px 24px', borderTop: '0.5px solid #D1FAE5', borderBottom: '0.5px solid #D1FAE5' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: '#059669', fontWeight: '700', letterSpacing: '0.1em', margin: '0 0 8px' }}>WHO WE ARE</p>
          <h2 style={{ fontSize: isMobile ? '24px' : '28px', fontWeight: '700', color: '#0B2818', margin: '0 0 14px', letterSpacing: '-0.02em' }}>Built by players, for players.</h2>
          <p style={{ fontSize: '14px', color: '#374151', margin: '0 auto 32px', maxWidth: '620px', lineHeight: '1.8' }}>
            ArenaGrade is a Sri Lankan sports infrastructure company. We plan, design, and construct basketball, squash, and netball courts to international standards — and we run this platform so every court we build stays full, every player stays active, and the game keeps growing.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '14px', textAlign: 'left' }}>
            {[
              { title: 'Court Design & Build', desc: 'Full-service court construction from ground up. Site assessment, flooring, lighting, markings, hoops — we handle everything.' },
              { title: 'Equipment Sales', desc: 'Premium basketball shoes, hoops, boards, balls, socks, and accessories. For individuals and institutions ordering in bulk.' },
              { title: 'Online Booking', desc: 'Book our courts online in seconds. Half court or full court, off-peak or peak — choose your slot and pay securely.' },
            ].map(item => (
              <div key={item.title} style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #D1FAE5', padding: '18px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ADE80', marginBottom: '12px' }} />
                <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0B2818', margin: '0 0 6px' }}>{item.title}</h3>
                <p style={{ fontSize: '13px', color: '#6B7280', margin: 0, lineHeight: '1.7' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ background: '#0B2818', padding: isMobile ? '48px 20px' : '60px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: '560px', margin: '0 auto' }}>
          <h2 style={{ fontSize: isMobile ? '24px' : '28px', fontWeight: '700', color: '#fff', margin: '0 0 12px', letterSpacing: '-0.02em' }}>Ready to play?</h2>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: '0 0 24px', lineHeight: '1.7' }}>
            Book a court today or reach out about building one for your school, club, or facility.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="#book" style={{ background: '#4ADE80', color: '#0B2818', padding: '11px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: '700', textDecoration: 'none' }}>Book a court</a>
            <a href="mailto:info@arenagrade.lk" style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', padding: '11px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: '500', textDecoration: 'none', border: '0.5px solid rgba(255,255,255,0.15)' }}>Contact us</a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: '#081810', padding: '24px 20px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '26px', height: '26px', background: '#1B6B3A', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>🏟</div>
            <span style={{ fontSize: '14px', fontWeight: '600', color: '#fff' }}>ArenaGrade</span>
          </div>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', margin: 0 }}>© 2026 ArenaGrade. All rights reserved. Sri Lanka.</p>
          <div style={{ display: 'flex', gap: '16px' }}>
            {['Book a court', 'Shop', 'Contact'].map(l => (
              <a key={l} href="#" style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </main>
  )
}
