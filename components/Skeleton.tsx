'use client'

interface SkeletonProps {
  width?: string
  height?: string
  borderRadius?: string
  style?: React.CSSProperties
}

export function Skeleton({ width = '100%', height = '16px', borderRadius = '6px', style }: SkeletonProps) {
  return (
    <div style={{
      width, height, borderRadius,
      background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.5s infinite',
      ...style
    }}>
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  )
}

export function CourtCardSkeleton() {
  return (
    <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '18px', marginBottom: '12px' }}>
      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
        <Skeleton width="52px" height="52px" borderRadius="12px" />
        <div style={{ flex: 1 }}>
          <Skeleton width="60%" height="18px" style={{ marginBottom: '8px' }} />
          <Skeleton width="40%" height="14px" style={{ marginBottom: '6px' }} />
          <Skeleton width="30%" height="12px" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', margin: '14px 0', flexWrap: 'wrap' }}>
        <Skeleton width="80px" height="24px" borderRadius="20px" />
        <Skeleton width="60px" height="24px" borderRadius="20px" />
        <Skeleton width="100px" height="24px" borderRadius="20px" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '14px', borderTop: '0.5px solid #F1F5F9' }}>
        <Skeleton width="120px" height="28px" />
        <Skeleton width="100px" height="36px" borderRadius="8px" />
      </div>
    </div>
  )
}

export function SlotCardSkeleton() {
  return (
    <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '16px', marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <Skeleton width="80px" height="20px" />
        <Skeleton width="60px" height="20px" borderRadius="20px" />
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ flex: 1, background: '#F8FAFC', borderRadius: '10px', padding: '12px' }}>
            <Skeleton width="70%" height="14px" style={{ marginBottom: '6px' }} />
            <Skeleton width="50%" height="12px" style={{ marginBottom: '10px' }} />
            <Skeleton width="80%" height="18px" style={{ marginBottom: '8px' }} />
            <Skeleton width="100%" height="32px" borderRadius="6px" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function BookingSkeleton() {
  return (
    <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '16px 20px', marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <Skeleton width="44px" height="44px" borderRadius="10px" />
          <div>
            <Skeleton width="140px" height="16px" style={{ marginBottom: '6px' }} />
            <Skeleton width="100px" height="12px" style={{ marginBottom: '4px' }} />
            <Skeleton width="180px" height="12px" />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Skeleton width="80px" height="18px" style={{ marginBottom: '6px' }} />
          <Skeleton width="70px" height="20px" borderRadius="20px" />
        </div>
      </div>
    </div>
  )
}

export function ProductCardSkeleton() {
  return (
    <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', overflow: 'hidden' }}>
      <Skeleton width="100%" height="0" style={{ paddingBottom: '100%', borderRadius: 0 }} />
      <div style={{ padding: '14px' }}>
        <Skeleton width="80%" height="16px" style={{ marginBottom: '6px' }} />
        <Skeleton width="50%" height="18px" style={{ marginBottom: '10px' }} />
        <Skeleton width="100%" height="36px" borderRadius="8px" />
      </div>
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <Skeleton width="60%" height="12px" style={{ marginBottom: '10px' }} />
          <Skeleton width="50%" height="28px" />
        </div>
        <Skeleton width="36px" height="36px" borderRadius="8px" />
      </div>
    </div>
  )
}
