import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Text.lk API docs: https://text.lk/docs/api-endpoints-introduction
// SMS types we send:
// 1. OTP verification — to customer during booking
// 2. Cancellation alert — to Praneeth when customer requests cancellation
// 3. Booking confirmation — to customer after successful payment
// 4. Cancellation confirmation — to customer when admin approves cancellation

const TEXT_LK_BASE = 'https://app.text.lk/api/v3/sms/send'

async function sendSMS(to: string, message: string): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.TEXT_LK_API_KEY
  const senderId = process.env.TEXT_LK_SENDER_ID || 'TextLKDemo'

  // DEV MODE — if no API key, log and return success
  if (!apiKey) {
    console.log(`[DEV SMS] To: ${to} | Message: ${message}`)
    return { success: true }
  }

  // Format phone — Text.lk needs 94XXXXXXXXX format
  let phone = to.replace(/\D/g, '')
  if (phone.startsWith('0')) phone = phone.slice(1)
  if (phone.startsWith('94')) phone = phone.slice(2)
  phone = '94' + phone 

  try {
    const response = await fetch(TEXT_LK_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        recipient: phone,
        sender_id: senderId,
        type: 'plain',
        message,
      }),
    })

    const data = await response.json()

    if (response.ok) {
      return { success: true }
    } else {
      console.error('Text.lk error:', data)
      return { success: false, error: data.message || 'SMS failed' }
    }
  } catch (err) {
    console.error('SMS network error:', err)
    return { success: false, error: 'Network error sending SMS' }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, data } = body

    // Validate request has required fields
    if (!type || !data) {
      return NextResponse.json({ error: 'Missing type or data' }, { status: 400 })
    }

    // Create Supabase client with service role for server-side queries
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    let result: { success: boolean; error?: string } = { success: false, error: 'Unknown type' }

    switch (type) {

      // 1. Send OTP to customer
      case 'otp': {
        const { phone, otp_code } = data
        if (!phone || !otp_code) {
          return NextResponse.json({ error: 'Missing phone or otp_code' }, { status: 400 })
        }
        const message = `Your ArenaGrade verification code is: ${otp_code}. Valid for 10 minutes. Do not share this code with anyone.`
        result = await sendSMS(phone, message)
        break
      }

      // 2. Alert Praneeth when customer requests cancellation
      case 'cancellation_request': {
        const { customer_phone, customer_name, slot_date, start_time, end_time, court_name, reason } = data
        const praneethPhone = process.env.PRANEETH_PHONE
        if (!praneethPhone) {
          console.log('[DEV] Praneeth phone not set — skipping cancellation alert')
          result = { success: true }
          break
        }
        const message = `ArenaGrade: Cancellation request from ${customer_name || customer_phone} for ${court_name} on ${slot_date} ${start_time}-${end_time}. Reason: ${reason}. Review at arenagrade.vercel.app/admin/bookings`
        result = await sendSMS(praneethPhone, message)
        break
      }

      // 3. Booking confirmation to customer
      case 'booking_confirmation': {
        const { phone, court_name, slot_date, start_time, end_time, court_type, amount, reference } = data
        if (!phone) {
          return NextResponse.json({ error: 'Missing phone' }, { status: 400 })
        }
        const courtTypeLabel = court_type === 'full_court' ? 'Full Court' : court_type === 'half_a' ? 'Half Court A' : 'Half Court B'
        const message = `ArenaGrade booking confirmed! ${court_name} - ${courtTypeLabel} on ${slot_date} from ${start_time} to ${end_time}. Amount: LKR ${amount}. Ref: ${reference}. See you on the court!`
        result = await sendSMS(phone, message)
        break
      }

      // 4. Cancellation approved — notify customer to send bank details
      case 'cancellation_approved': {
        const { phone, court_name, slot_date, start_time, amount } = data
        if (!phone) {
          return NextResponse.json({ error: 'Missing phone' }, { status: 400 })
        }
        const praneethPhone = process.env.PRANEETH_PHONE || '94XXXXXXXXX'
        const message = `ArenaGrade: Your booking for ${court_name} on ${slot_date} at ${start_time} has been cancelled. To receive your refund of LKR ${amount}, please WhatsApp your bank account details to ${praneethPhone}.`
        result = await sendSMS(phone, message)
        break
      }

      // 5. Cancellation rejected — notify customer booking stands
      case 'cancellation_rejected': {
        const { phone, court_name, slot_date, start_time } = data
        if (!phone) {
          return NextResponse.json({ error: 'Missing phone' }, { status: 400 })
        }
        const message = `ArenaGrade: Your cancellation request for ${court_name} on ${slot_date} at ${start_time} has been reviewed and your booking remains confirmed. Contact info@arenagrade.lk for queries.`
        result = await sendSMS(phone, message)
        break
      }

      default:
        return NextResponse.json({ error: `Unknown SMS type: ${type}` }, { status: 400 })
    }

    if (result.success) {
      return NextResponse.json({ success: true })
    } else {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 })
    }

  } catch (err) {
    console.error('SMS route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
