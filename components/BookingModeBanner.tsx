import type { BookingMode } from '@/lib/useBookingMode'

// Shown on court and booking pages while online booking is not open to everyone.
export default function BookingModeBanner({ mode, isAdmin }: { mode: BookingMode | null; isAdmin: boolean }) {
  if (!mode || mode === 'public') return null
  const admin = mode === 'admin_only' && isAdmin
  const text = admin
    ? 'Test mode: only admins can book right now. Your bookings are test bookings and will be deleted before launch.'
    : mode === 'closed'
      ? 'Online booking is paused right now. Please check back soon.'
      : 'Online booking opens soon. You can browse courts and times now.'
  return (
    <div role="status" style={{
      background: admin ? '#FFFBEB' : '#EFF6FF', border: `1px solid ${admin ? '#FDE68A' : '#BFDBFE'}`,
      color: admin ? '#92400E' : '#1E3A8A', borderRadius: '10px', padding: '12px 16px', fontSize: '14px', lineHeight: 1.5, margin: '0 0 16px',
    }}>
      {text}
    </div>
  )
}
