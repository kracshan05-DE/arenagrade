export const sendBookingConfirmationEmail = async (data: {
  customer_email: string; customer_name: string; court_name: string
  location: string; slot_date: string; start_time: string; end_time: string
  court_type: string; amount: number; reference: string
}) => {
  try {
    const res = await fetch('/api/send-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'booking_confirmation', data })
    })
    return await res.json()
  } catch { return { success: false } }
}

export const sendCancellationApprovedEmail = async (data: {
  customer_email: string; court_name: string
  slot_date: string; start_time: string; amount: number
}) => {
  try {
    const res = await fetch('/api/send-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'cancellation_approved', data })
    })
    return await res.json()
  } catch { return { success: false } }
}

export const sendCancellationRejectedEmail = async (data: {
  customer_email: string; court_name: string
  slot_date: string; start_time: string
}) => {
  try {
    const res = await fetch('/api/send-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'cancellation_rejected', data })
    })
    return await res.json()
  } catch { return { success: false } }
}