'use client'

import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ArenaGrade Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', background: '#F8FAFC',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif', padding: '20px'
        }}>
          <div style={{ textAlign: 'center', maxWidth: '440px' }}>
            <div style={{ width: '64px', height: '64px', background: '#FEE2E2', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', margin: '0 auto 20px' }}>
              ⚠️
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 8px' }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: '14px', color: '#64748B', lineHeight: '1.7', margin: '0 0 24px' }}>
              We hit an unexpected error. This has been noted and we will fix it. Please try refreshing the page.
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div style={{ background: '#FEF2F2', border: '0.5px solid #FECACA', borderRadius: '8px', padding: '12px', marginBottom: '20px', textAlign: 'left' }}>
                <p style={{ fontSize: '11px', color: '#DC2626', fontFamily: 'monospace', margin: 0, wordBreak: 'break-all' }}>
                  {this.state.error.message}
                </p>
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={() => window.location.reload()}
                style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px 24px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}
              >
                Refresh page
              </button>
              <a href="/"
                style={{ background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '11px 24px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', textDecoration: 'none' }}
              >
                Go home
              </a>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
