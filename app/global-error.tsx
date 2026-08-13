'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body>
        <div style={{
          minHeight: '100vh', background: '#F8FAFC',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif', padding: '20px'
        }}>
          <div style={{ textAlign: 'center', maxWidth: '440px' }}>
            <div style={{ width: '64px', height: '64px', background: '#FEE2E2', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', margin: '0 auto 20px' }}>
              🔧
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 8px' }}>
              Server error
            </h1>
            <p style={{ fontSize: '14px', color: '#64748B', lineHeight: '1.7', margin: '0 0 24px' }}>
              Something went wrong on our end. Your booking data is safe. Please try again.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={reset}
                style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px 24px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}
              >
                Try again
              </button>
              <a href="/"
                style={{ background: '#F1F5F9', color: '#64748B', borderRadius: '8px', padding: '11px 24px', fontSize: '14px', fontWeight: '600', textDecoration: 'none' }}
              >
                Go home
              </a>
            </div>
            {error.digest && (
              <p style={{ fontSize: '11px', color: '#94A3B8', margin: '16px 0 0', fontFamily: 'monospace' }}>
                Error ID: {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  )
}
