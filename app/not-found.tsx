import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', background: '#F8FAFC',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', padding: '20px'
    }}>
      <div style={{ textAlign: 'center', maxWidth: '440px' }}>
        <div style={{ fontSize: '80px', marginBottom: '8px' }}>🏀</div>
        <h1 style={{ fontSize: '72px', fontWeight: '900', color: '#1B6B3A', margin: '0 0 8px', letterSpacing: '-4px' }}>404</h1>
        <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 10px' }}>
          Out of bounds
        </h2>
        <p style={{ fontSize: '14px', color: '#64748B', lineHeight: '1.7', margin: '0 0 28px' }}>
          Looks like this page doesn't exist — just like that shot that missed the backboard. Let's get you back on the court.
        </p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <Link href="/"
            style={{ background: '#1B6B3A', color: '#fff', borderRadius: '8px', padding: '11px 24px', fontSize: '14px', fontWeight: '600', textDecoration: 'none' }}>
            Back to home
          </Link>
          <Link href="/#book"
            style={{ background: '#F1F5F9', color: '#64748B', borderRadius: '8px', padding: '11px 24px', fontSize: '14px', fontWeight: '600', textDecoration: 'none' }}>
            Book a court
          </Link>
        </div>
      </div>
    </div>
  )
}
