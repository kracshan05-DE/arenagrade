import { NextRequest, NextResponse } from 'next/server'

// Resend API docs: https://resend.com/docs
// Email types we send:
// 1. Booking confirmation — to customer after successful payment
// 2. Cancellation approved — to customer when admin approves
// 3. Cancellation rejected — to customer when admin rejects
// 4. Daily report — to Praneeth at 10 PM every day

const RESEND_API = 'https://api.resend.com/emails'

// Use onboarding@resend.dev until arenagrade.lk domain is verified in Resend
// After domain registration: change to 'ArenaGrade <bookings@arenagrade.lk>'
const FROM_EMAIL = 'ArenaGrade <onboarding@resend.dev>'
const PRANEETH_EMAIL = process.env.PRANEETH_EMAIL || 'praneeth@arenagrade.lk'

async function sendEmail(to: string, subject: string, html: string): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY

  // DEV MODE — if no API key, log and return success
  if (!apiKey) {
    console.log(`[DEV EMAIL] To: ${to} | Subject: ${subject}`)
    return { success: true }
  }

  try {
    const response = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    })

    const data = await response.json()

    if (response.ok) {
      return { success: true }
    } else {
      console.error('Resend error:', data)
      return { success: false, error: data.message || 'Email failed' }
    }
  } catch (err) {
    console.error('Email network error:', err)
    return { success: false, error: 'Network error sending email' }
  }
}

const bookingConfirmationTemplate = (data: {
  customer_name: string
  court_name: string
  location: string
  slot_date: string
  start_time: string
  end_time: string
  court_type: string
  amount: number
  reference: string
}) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
    <div style="background:#0B2818;border-radius:14px;padding:28px;margin-bottom:16px;text-align:center;">
      <p style="color:#4ADE80;font-size:13px;font-weight:700;margin:0 0 16px;">🏟 ArenaGrade</p>
      <p style="font-size:40px;margin:0 0 12px;">✅</p>
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 6px;">Booking Confirmed!</h1>
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:0;">Your court has been successfully booked.</p>
    </div>
    <div style="background:#fff;border-radius:14px;border:0.5px solid #E2E8F0;padding:24px;margin-bottom:16px;">
      <p style="font-size:11px;color:#94A3B8;font-weight:500;letter-spacing:0.04em;margin:0 0 16px;">BOOKING DETAILS</p>
      <p style="font-size:16px;font-weight:700;color:#0F172A;margin:0 0 4px;">${data.court_name}</p>
      <p style="font-size:13px;color:#64748B;margin:0 0 16px;">📍 ${data.location}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <td style="padding:10px;background:#F8FAFC;border-radius:8px 0 0 0;width:50%;">
            <p style="font-size:11px;color:#94A3B8;margin:0 0 3px;">DATE</p>
            <p style="font-size:13px;font-weight:600;color:#0F172A;margin:0;">${data.slot_date}</p>
          </td>
          <td style="padding:10px;background:#F8FAFC;border-radius:0 8px 0 0;width:50%;">
            <p style="font-size:11px;color:#94A3B8;margin:0 0 3px;">TIME</p>
            <p style="font-size:13px;font-weight:600;color:#0F172A;margin:0;">${data.start_time} - ${data.end_time}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:10px;background:#F8FAFC;border-radius:0 0 0 8px;">
            <p style="font-size:11px;color:#94A3B8;margin:0 0 3px;">COURT TYPE</p>
            <p style="font-size:13px;font-weight:600;color:#0F172A;margin:0;">${data.court_type}</p>
          </td>
          <td style="padding:10px;background:#F8FAFC;border-radius:0 0 8px 0;">
            <p style="font-size:11px;color:#94A3B8;margin:0 0 3px;">AMOUNT PAID</p>
            <p style="font-size:13px;font-weight:700;color:#1B6B3A;margin:0;">LKR ${data.amount.toLocaleString()}</p>
          </td>
        </tr>
      </table>
      <div style="border-top:0.5px solid #F1F5F9;padding-top:14px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <p style="font-size:11px;color:#94A3B8;margin:0 0 2px;">BOOKING REFERENCE</p>
          <p style="font-size:12px;font-weight:600;color:#0F172A;margin:0;font-family:monospace;">${data.reference}</p>
        </div>
        <span style="background:#ECFDF5;color:#065F46;font-size:11px;padding:4px 12px;border-radius:20px;font-weight:600;">Confirmed</span>
      </div>
    </div>
    <div style="background:#FFFBEB;border:0.5px solid #FDE68A;border-radius:12px;padding:16px;margin-bottom:16px;">
      <p style="font-size:13px;font-weight:600;color:#92400E;margin:0 0 4px;">⚠️ Cancellation policy</p>
      <p style="font-size:12px;color:#92400E;margin:0;line-height:1.6;">
        More than 24 hours before your slot → Full refund<br/>
        Less than 24 hours before your slot → No refund<br/>
        To cancel, visit My Bookings on arenagrade.vercel.app
      </p>
    </div>
    <div style="text-align:center;padding:16px 0;">
      <p style="font-size:12px;color:#94A3B8;margin:0 0 6px;">Questions? Contact us at</p>
      <a href="mailto:info@arenagrade.lk" style="font-size:13px;color:#1B6B3A;font-weight:600;">info@arenagrade.lk</a>
      <p style="font-size:11px;color:#CBD5E1;margin:12px 0 0;">© 2026 ArenaGrade. Sri Lanka.</p>
    </div>
  </div>
</body>
</html>`

const cancellationApprovedTemplate = (data: {
  court_name: string
  slot_date: string
  start_time: string
  amount: number
  praneeth_phone: string
}) => `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:14px;border:0.5px solid #E2E8F0;padding:28px;text-align:center;">
      <p style="font-size:40px;margin:0 0 12px;">❌</p>
      <h1 style="font-size:20px;font-weight:700;color:#0F172A;margin:0 0 8px;">Booking Cancelled</h1>
      <p style="font-size:14px;color:#64748B;margin:0 0 20px;">Your booking for ${data.court_name} on ${data.slot_date} at ${data.start_time} has been cancelled.</p>
      <div style="background:#ECFDF5;border-radius:10px;padding:16px;text-align:left;margin-bottom:16px;">
        <p style="font-size:13px;font-weight:600;color:#065F46;margin:0 0 6px;">✅ Refund: LKR ${data.amount.toLocaleString()}</p>
        <p style="font-size:12px;color:#047857;margin:0;">Please WhatsApp your bank account details to <strong>${data.praneeth_phone}</strong> to receive your refund within 1-2 business days.</p>
      </div>
      <p style="font-size:12px;color:#94A3B8;margin:0;">Questions? Email <a href="mailto:info@arenagrade.lk" style="color:#1B6B3A;">info@arenagrade.lk</a></p>
    </div>
  </div>
</body>
</html>`

const cancellationRejectedTemplate = (data: {
  court_name: string
  slot_date: string
  start_time: string
}) => `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:14px;border:0.5px solid #E2E8F0;padding:28px;text-align:center;">
      <p style="font-size:40px;margin:0 0 12px;">📅</p>
      <h1 style="font-size:20px;font-weight:700;color:#0F172A;margin:0 0 8px;">Booking Remains Confirmed</h1>
      <p style="font-size:14px;color:#64748B;margin:0 0 16px;">Your cancellation request for ${data.court_name} on ${data.slot_date} at ${data.start_time} has been reviewed. Your booking remains confirmed — see you on the court!</p>
      <p style="font-size:12px;color:#94A3B8;margin:0;">Questions? Email <a href="mailto:info@arenagrade.lk" style="color:#1B6B3A;">info@arenagrade.lk</a></p>
    </div>
  </div>
</body>
</html>`

const dailyReportTemplate = (data: {
  date: string
  total_bookings: number
  total_slots: number
  booked_slots: number
  available_slots: number
  blocked_slots: number
  gross_revenue: number
  payhere_fee: number
  net_revenue: number
  pending_cancellations: number
  bookings: Array<{
    customer_name: string
    customer_phone: string
    court_name: string
    slot_date: string
    start_time: string
    end_time: string
    court_type: string
    amount: number
  }>
}) => `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#0B2818;border-radius:14px;padding:24px;margin-bottom:16px;">
      <p style="color:#4ADE80;font-size:12px;font-weight:700;letter-spacing:0.08em;margin:0 0 6px;">DAILY REPORT</p>
      <h1 style="color:#fff;font-size:20px;font-weight:700;margin:0 0 4px;">ArenaGrade Summary</h1>
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0;">${data.date}</p>
    </div>
    <div style="background:#1B6B3A;border-radius:14px;padding:24px;margin-bottom:16px;text-align:center;">
      <p style="color:rgba(255,255,255,0.6);font-size:12px;margin:0 0 6px;">NET INCOME TODAY</p>
      <p style="color:#fff;font-size:36px;font-weight:800;margin:0 0 4px;">LKR ${data.net_revenue.toLocaleString()}</p>
      <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0;">Gross: LKR ${data.gross_revenue.toLocaleString()} − PayHere fee: LKR ${data.payhere_fee.toLocaleString()}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr>
        <td style="padding:14px;background:#EFF6FF;border-radius:10px;text-align:center;width:33%;">
          <p style="font-size:24px;font-weight:800;color:#1D4ED8;margin:0 0 4px;">${data.total_bookings}</p>
          <p style="font-size:11px;color:#1D4ED8;opacity:0.7;margin:0;">Total Bookings</p>
        </td>
        <td style="width:2%;"></td>
        <td style="padding:14px;background:#ECFDF5;border-radius:10px;text-align:center;width:33%;">
          <p style="font-size:24px;font-weight:800;color:#065F46;margin:0 0 4px;">${data.booked_slots}</p>
          <p style="font-size:11px;color:#065F46;opacity:0.7;margin:0;">Booked Slots</p>
        </td>
        <td style="width:2%;"></td>
        <td style="padding:14px;background:#FFFBEB;border-radius:10px;text-align:center;width:33%;">
          <p style="font-size:24px;font-weight:800;color:#92400E;margin:0 0 4px;">${data.available_slots}</p>
          <p style="font-size:11px;color:#92400E;opacity:0.7;margin:0;">Available Slots</p>
        </td>
      </tr>
    </table>
    ${data.pending_cancellations > 0 ? `
    <div style="background:#FEE2E2;border:0.5px solid #FECACA;border-radius:10px;padding:14px;margin-bottom:16px;">
      <p style="font-size:13px;font-weight:600;color:#DC2626;margin:0;">⚠️ ${data.pending_cancellations} cancellation request${data.pending_cancellations > 1 ? 's' : ''} pending — review at arenagrade.vercel.app/admin/bookings</p>
    </div>` : ''}
    ${data.bookings.length > 0 ? `
    <div style="background:#fff;border-radius:14px;border:0.5px solid #E2E8F0;padding:20px;margin-bottom:16px;">
      <p style="font-size:11px;color:#94A3B8;font-weight:500;letter-spacing:0.04em;margin:0 0 14px;">TODAY'S BOOKINGS</p>
      ${data.bookings.map(b => `
        <div style="padding:10px 0;border-bottom:0.5px solid #F1F5F9;">
          <p style="font-size:13px;font-weight:600;color:#0F172A;margin:0 0 2px;">${b.customer_name || b.customer_phone}</p>
          <p style="font-size:12px;color:#64748B;margin:0 0 1px;">📱 ${b.customer_phone} · ${b.court_name}</p>
          <p style="font-size:11px;color:#94A3B8;margin:0;">${b.slot_date} · ${b.start_time} - ${b.end_time} · ${b.court_type} · <span style="color:#1B6B3A;font-weight:700;">LKR ${b.amount.toLocaleString()}</span></p>
        </div>`).join('')}
    </div>` : `
    <div style="background:#fff;border-radius:14px;border:0.5px solid #E2E8F0;padding:24px;text-align:center;margin-bottom:16px;">
      <p style="color:#94A3B8;font-size:14px;margin:0;">No bookings today</p>
    </div>`}
    <div style="text-align:center;">
      <a href="https://arenagrade.vercel.app/admin" style="display:inline-block;background:#1B6B3A;color:#fff;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:600;text-decoration:none;margin-bottom:12px;">View Admin Panel</a>
      <p style="font-size:11px;color:#CBD5E1;margin:0;">© 2026 ArenaGrade · Daily report sent at 10:00 PM Sri Lanka time</p>
    </div>
  </div>
</body>
</html>`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, data } = body

    if (!type || !data) {
      return NextResponse.json({ error: 'Missing type or data' }, { status: 400 })
    }

    let result: { success: boolean; error?: string } = { success: false, error: 'Unknown type' }

    switch (type) {

      case 'booking_confirmation': {
        const { customer_email, customer_name, court_name, location,
          slot_date, start_time, end_time, court_type, amount, reference } = data
        if (!customer_email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })
        const html = bookingConfirmationTemplate({
          customer_name, court_name, location, slot_date,
          start_time, end_time, court_type, amount, reference
        })
        result = await sendEmail(customer_email, `Booking Confirmed — ${court_name} on ${slot_date}`, html)
        break
      }

      case 'cancellation_approved': {
        const { customer_email, court_name, slot_date, start_time, amount } = data
        if (!customer_email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })
        const praneethPhone = process.env.PRANEETH_PHONE || '94XXXXXXXXX'
        const html = cancellationApprovedTemplate({ court_name, slot_date, start_time, amount, praneeth_phone: praneethPhone })
        result = await sendEmail(customer_email, `Booking Cancelled — Refund Info Inside`, html)
        break
      }

      case 'cancellation_rejected': {
        const { customer_email, court_name, slot_date, start_time } = data
        if (!customer_email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })
        const html = cancellationRejectedTemplate({ court_name, slot_date, start_time })
        result = await sendEmail(customer_email, `Your Booking Remains Confirmed — ${court_name}`, html)
        break
      }

      case 'daily_report': {
        const html = dailyReportTemplate(data)
        result = await sendEmail(PRANEETH_EMAIL, `ArenaGrade Daily Report — ${data.date}`, html)
        break
      }

      default:
        return NextResponse.json({ error: `Unknown email type: ${type}` }, { status: 400 })
    }

    if (result.success) {
      return NextResponse.json({ success: true })
    } else {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 })
    }

  } catch (err) {
    console.error('Email route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
