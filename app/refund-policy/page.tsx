export default function RefundPolicyPage() {
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
          <h1 style={{ fontSize: '28px', fontWeight: '700', color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>Refund Policy</h1>
          <p style={{ fontSize: '13px', color: '#94A3B8', margin: 0 }}>Last updated: August 2026</p>
        </div>

        {/* Quick summary card */}
        <div style={{ background: '#0B2818', borderRadius: '14px', padding: '24px', marginBottom: '20px' }}>
          <p style={{ fontSize: '12px', color: '#4ADE80', fontWeight: '700', letterSpacing: '0.08em', margin: '0 0 16px' }}>QUICK SUMMARY</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {[
              { time: 'More than 24 hours before', refund: 'Full refund', icon: '✅', color: '#4ADE80' },
              { time: 'Less than 24 hours before', refund: 'No refund', icon: '❌', color: '#FC8181' },
              { time: 'No-show', refund: 'No refund', icon: '❌', color: '#FC8181' },
            ].map(item => (
              <div key={item.time} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>{item.icon}</div>
                <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', margin: '0 0 6px', lineHeight: '1.4' }}>{item.time}</p>
                <p style={{ fontSize: '14px', fontWeight: '700', color: item.color, margin: 0 }}>{item.refund}</p>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', margin: '16px 0 0', textAlign: 'center' }}>
            Refunds processed via direct bank transfer within 1–2 business days of approval
          </p>
        </div>

        <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '32px' }}>

          {[
            {
              title: '1. Cancellation More Than 24 Hours Before the Slot',
              content: 'If you cancel your booking more than 24 hours before the scheduled start time of your slot, you are eligible for a full refund of the amount paid. The refund will be processed within 5–7 business days to your original payment method (credit card, eZ Cash, FriMi, mCash, or bank account).'
            },
            {
              title: '2. Cancellation Less Than 24 Hours Before the Slot',
              content: 'If you cancel your booking less than 24 hours before the scheduled start time, no refund will be issued. This policy exists because last-minute cancellations do not give us adequate time to rebook the slot to another customer.'
            },
            {
              title: '3. No-Show',
              content: 'If you do not show up for your booking without prior cancellation, no refund will be issued regardless of the reason.'
            },
            {
              title: '4. How to Request a Cancellation',
              content: 'To cancel a booking, sign in to your ArenaGrade account and go to My Bookings. Select the booking you wish to cancel and click Request Cancellation. You will be asked to provide a reason. Our team will review your request within 24 hours and contact you on WhatsApp to process your refund. The cancellation button is only available for bookings that are more than 24 hours away.'
            },
            {
              title: '5. Court Unavailability',
              content: 'In the unlikely event that ArenaGrade is unable to provide the booked court due to facility issues, emergency maintenance, or circumstances beyond our control, you will receive a full refund regardless of when the cancellation occurs. We will notify you as soon as possible via SMS.'
            },
            {
            title: '6. Refund Processing',
            content: 'Once your cancellation is approved, our team will contact you via WhatsApp to collect your bank account details. Refunds are processed via direct bank transfer within 1–2 business days of receiving your account information. Please ensure you are available on WhatsApp after submitting a cancellation request.'
            },
            {
              title: '7. Disputes',
              content: 'If you believe a refund has been incorrectly denied, please contact us at info@arenagrade.lk with your booking reference number. We will review your case and respond within 3 business days.'
            },
          ].map(section => (
            <div key={section.title} style={{ marginBottom: '28px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0F172A', margin: '0 0 8px' }}>{section.title}</h2>
              <p style={{ fontSize: '14px', color: '#475569', margin: 0, lineHeight: '1.8' }}>{section.content}</p>
            </div>
          ))}

          <div style={{ background: '#FFFBEB', border: '0.5px solid #FDE68A', borderRadius: '10px', padding: '16px', marginTop: '8px' }}>
            <p style={{ fontSize: '13px', fontWeight: '600', color: '#92400E', margin: '0 0 4px' }}>⚠️ Important reminder</p>
            <p style={{ fontSize: '13px', color: '#92400E', margin: 0 }}>
              The refund policy is shown clearly on the booking page before you confirm your reservation. By clicking Reserve and Continue, you acknowledge and agree to this policy.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', flexWrap: 'wrap' }}>
          <a href="/terms" style={{ fontSize: '13px', color: '#1B6B3A', textDecoration: 'none', fontWeight: '500' }}>Terms and Conditions →</a>
          <a href="/privacy" style={{ fontSize: '13px', color: '#1B6B3A', textDecoration: 'none', fontWeight: '500' }}>Privacy Policy →</a>
        </div>
      </div>
    </main>
  )
}
