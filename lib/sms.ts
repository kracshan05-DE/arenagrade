// SMS helper — call from any client component
// All SMS types are handled by the /api/send-sms route

export const sendOtpSMS = async (phone: string, otpCode: string) => {
  try {
    const res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'otp',
        data: { phone, otp_code: otpCode }
      })
    })
    return await res.json()
  } catch {
    return { success: false, error: 'Network error' }
  }
}

export const sendCancellationRequestAlert = async (data: {
  customer_phone: string
  customer_name: string | null
  slot_date: string
  start_time: string
  end_time: string
  court_name: string
  reason: string
}) => {
  try {
    const res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'cancellation_request', data })
    })
    return await res.json()
  } catch {
    return { success: false, error: 'Network error' }
  }
}

export const sendBookingConfirmationSMS = async (data: {
  phone: string
  court_name: string
  slot_date: string
  start_time: string
  end_time: string
  court_type: string
  amount: number
  reference: string
}) => {
  try {
    const res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'booking_confirmation', data })
    })
    return await res.json()
  } catch {
    return { success: false, error: 'Network error' }
  }
}

export const sendCancellationApprovedSMS = async (data: {
  phone: string
  court_name: string
  slot_date: string
  start_time: string
  amount: number
}) => {
  try {
    const res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'cancellation_approved', data })
    })
    return await res.json()
  } catch {
    return { success: false, error: 'Network error' }
  }
}

export const sendCancellationRejectedSMS = async (data: {
  phone: string
  court_name: string
  slot_date: string
  start_time: string
}) => {
  try {
    const res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'cancellation_rejected', data })
    })
    return await res.json()
  } catch {
    return { success: false, error: 'Network error' }
  }
}
