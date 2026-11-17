'use client'

import { useState } from 'react'

// Court photos on the court page: one large photo and, when there are more,
// thumbnails to switch between them. Renders nothing without photos.
export default function CourtGallery({ name, images }: { name: string; images: string[] }) {
  const [active, setActive] = useState(0)
  if (images.length === 0) return null
  const current = images[Math.min(active, images.length - 1)]

  return (
    <div style={{ marginBottom: '16px' }}>
      <img src={current} alt={`${name}, photo ${active + 1} of ${images.length}`}
        style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: '10px', display: 'block', background: '#F1F5F9' }} />
      {images.length > 1 && (
        <div role="group" aria-label="Court photos" style={{ display: 'flex', gap: '8px', marginTop: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
          {images.map((url, i) => (
            <button key={url} type="button" onClick={() => setActive(i)} aria-label={`Show photo ${i + 1}`} aria-pressed={i === active}
              style={{ padding: 0, border: i === active ? '2px solid var(--ag-primary)' : '2px solid transparent', borderRadius: '8px', background: 'none', cursor: 'pointer', flexShrink: 0 }}>
              <img src={url} alt="" loading="lazy" style={{ width: '72px', height: '54px', objectFit: 'cover', borderRadius: '6px', display: 'block' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
