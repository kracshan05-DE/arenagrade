'use client'

import { useEffect, useState } from 'react'

export default function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(true)
  const [showBanner, setShowBanner] = useState(false)
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      if (wasOffline) {
        setShowBanner(true)
        setTimeout(() => setShowBanner(false), 3000)
      }
      setWasOffline(false)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setShowBanner(true)
      setWasOffline(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [wasOffline])

  if (!showBanner) return null

  return (
    <div style={{
      position: 'fixed', top: '60px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, borderRadius: '30px', padding: '10px 20px',
      display: 'flex', alignItems: 'center', gap: '8px',
      background: isOnline ? '#1B6B3A' : '#DC2626',
      color: '#fff', fontSize: '13px', fontWeight: '600',
      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      fontFamily: 'system-ui, sans-serif',
      transition: 'all 0.3s ease',
    }}>
      <span>{isOnline ? '✅' : '📵'}</span>
      {isOnline ? 'Back online — you\'re good to go' : 'No internet connection — please check your network'}
    </div>
  )
}
