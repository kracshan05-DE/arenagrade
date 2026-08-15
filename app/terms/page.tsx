export default function TermsPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '48px 20px' }}>

        <a href="/" style={{ fontSize: '13px', color: '#1B6B3A', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '32px' }}>
          ← Back to home
        </a>

        <div style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{ width: '32px', height: '32px', background: '#1B6B3A', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>🏟</div>
            <span style={{ fontSize: '15px', fontWeight: '700', color: '#0F172A' }}>Arena<span style={{ color: '#1B6B3A' }}>Grade</span></span>
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: '700', color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>Terms and Conditions</h1>
          <p style={{ fontSize: '13px', color: '#94A3B8', margin: 0 }}>Last updated: August 2026</p>
        </div>

        <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '32px', lineHeight: '1.8' }}>

          {[
            {
              title: '1. Acceptance of Terms',
              content: 'By accessing and using the ArenaGrade platform (arenagrade.lk), you agree to be bound by these Terms and Conditions. If you do not agree to these terms, please do not use our services.'
            },
            {
              title: '2. Booking and Reservations',
              content: 'Court bookings are subject to availability. When you reserve a slot, it is held exclusively for you for 10 minutes to complete payment. If payment is not completed within this window, the reservation is automatically released. A booking is only confirmed once full payment is received and you receive a confirmation SMS.'
            },
            {
              title: '3. Payment',
              content: 'All payments are processed securely through PayHere, a CBSL-approved payment gateway. Accepted payment methods include Visa, Mastercard, eZ Cash, FriMi, mCash, and internet banking. ArenaGrade does not store your card details. All amounts are in Sri Lankan Rupees (LKR).'
            },
            {
              title: '4. Cancellation and Refund Policy',
              content: 'Cancellations made more than 24 hours before the booked slot are eligible for a full refund. Cancellations made less than 24 hours before the booked slot are not eligible for a refund. No-shows are not eligible for a refund. Refunds are processed within 5–7 business days to the original payment method. To request a cancellation, visit My Bookings on the platform.'
            },
            {
              title: '5. Court Rules',
              content: 'All players must follow the court rules displayed on-site. Appropriate sports footwear must be worn at all times on court. Food and beverages are not permitted on the court surface. ArenaGrade reserves the right to remove any player who causes damage to the facility or behaves in an unsafe or disrespectful manner without a refund.'
            },
            {
              title: '6. Liability',
              content: 'Players participate in sports activities at their own risk. ArenaGrade is not liable for any injury, loss, or damage sustained while using the facility. Players are advised to ensure they are medically fit to participate. ArenaGrade is not responsible for lost or stolen personal belongings.'
            },
            {
              title: '7. Phone Verification',
              content: 'A valid Sri Lankan mobile number is required to complete a booking. This number is used solely for booking confirmations and urgent court-related communications. We do not share your number with third parties.'
            },
            {
              title: '8. Modifications',
              content: 'ArenaGrade reserves the right to modify these terms at any time. Changes will be communicated via the platform. Continued use of the platform after changes constitutes acceptance of the updated terms.'
            },
            {
              title: '9. Governing Law',
              content: 'These terms are governed by the laws of Sri Lanka. Any disputes shall be subject to the exclusive jurisdiction of the courts of Sri Lanka.'
            },
            {
              title: '10. Contact',
              content: 'For any questions regarding these terms, please contact us at info@arenagrade.lk.'
            },
          ].map(section => (
            <div key={section.title} style={{ marginBottom: '28px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0F172A', margin: '0 0 8px' }}>{section.title}</h2>
              <p style={{ fontSize: '14px', color: '#475569', margin: 0, lineHeight: '1.8' }}>{section.content}</p>
            </div>
          ))}

        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', flexWrap: 'wrap' }}>
          <a href="/privacy" style={{ fontSize: '13px', color: '#1B6B3A', textDecoration: 'none', fontWeight: '500' }}>Privacy Policy →</a>
          <a href="/refund-policy" style={{ fontSize: '13px', color: '#1B6B3A', textDecoration: 'none', fontWeight: '500' }}>Refund Policy →</a>
        </div>
      </div>
    </main>
  )
}
