export default function PrivacyPage() {
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
          <h1 style={{ fontSize: '28px', fontWeight: '700', color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>Privacy Policy</h1>
          <p style={{ fontSize: '13px', color: '#94A3B8', margin: 0 }}>Last updated: August 2026</p>
        </div>

        <div style={{ background: '#fff', borderRadius: '14px', border: '0.5px solid #E2E8F0', padding: '32px' }}>

          {[
            {
              title: '1. Information We Collect',
              content: 'We collect the following information when you use ArenaGrade: your name and email address (from account registration or Google Sign-In), your Sri Lankan mobile phone number (required for booking verification), your booking history including court, date, time, and payment amount, and your IP address and device information for security purposes.'
            },
            {
              title: '2. How We Use Your Information',
              content: 'Your information is used to process and confirm court bookings, send booking confirmation and OTP messages via SMS, contact you about your booking in case of cancellation or changes, send daily booking summaries to our operations team, and improve our platform and services. We do not use your data for advertising purposes.'
            },
            {
              title: '3. SMS Communications',
              content: 'By providing your mobile number and completing phone verification, you consent to receiving SMS messages from ArenaGrade related to your bookings. These include OTP codes for verification and booking confirmations. We use Text.lk, a Sri Lankan SMS gateway, to deliver these messages. Standard messaging rates may apply.'
            },
            {
              title: '4. Payment Information',
              content: 'Payment processing is handled entirely by PayHere, a CBSL-approved payment gateway. ArenaGrade does not store, process, or have access to your credit card or bank account details. PayHere\'s privacy policy applies to all payment transactions.'
            },
            {
              title: '5. Data Storage',
              content: 'Your data is stored securely on Supabase infrastructure with row-level security enabled. All data is encrypted in transit using SSL/TLS. We retain your booking data for accounting and legal compliance purposes for a period of 7 years as required by Sri Lankan law.'
            },
            {
              title: '6. Data Sharing',
              content: 'We do not sell, rent, or share your personal information with third parties for marketing purposes. Your data may be shared with: Text.lk (for SMS delivery), PayHere (for payment processing), and Resend (for email notifications). All third parties are bound by confidentiality obligations.'
            },
            {
              title: '7. Your Rights',
              content: 'You have the right to access the personal data we hold about you, request correction of inaccurate data, request deletion of your data (subject to legal retention requirements), and withdraw consent for SMS communications. To exercise these rights, contact us at info@arenagrade.lk.'
            },
            {
              title: '8. Cookies',
              content: 'ArenaGrade uses essential cookies only — these are required for authentication and session management. We do not use tracking or advertising cookies.'
            },
            {
              title: '9. Contact',
              content: 'For privacy-related inquiries, please contact us at info@arenagrade.lk. We will respond within 5 business days.'
            },
          ].map(section => (
            <div key={section.title} style={{ marginBottom: '28px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0F172A', margin: '0 0 8px' }}>{section.title}</h2>
              <p style={{ fontSize: '14px', color: '#475569', margin: 0, lineHeight: '1.8' }}>{section.content}</p>
            </div>
          ))}

        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', flexWrap: 'wrap' }}>
          <a href="/terms" style={{ fontSize: '13px', color: '#1B6B3A', textDecoration: 'none', fontWeight: '500' }}>Terms and Conditions →</a>
          <a href="/refund-policy" style={{ fontSize: '13px', color: '#1B6B3A', textDecoration: 'none', fontWeight: '500' }}>Refund Policy →</a>
        </div>
      </div>
    </main>
  )
}
