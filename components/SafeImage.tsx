'use client'

import { useState } from 'react'

interface SafeImageProps {
  src: string
  alt: string
  fallback?: string
  style?: React.CSSProperties
  containerStyle?: React.CSSProperties
}

export default function SafeImage({ src, alt, fallback = '🏟', style, containerStyle }: SafeImageProps) {
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)

  if (error || !src) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#F8FAFC', fontSize: '32px',
        ...containerStyle
      }}>
        {fallback}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', ...containerStyle }}>
      {!loaded && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s infinite',
          borderRadius: 'inherit',
        }}>
          <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
        </div>
      )}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        style={{
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.3s ease',
          ...style
        }}
      />
    </div>
  )
}
