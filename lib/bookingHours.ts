// A booking covers one slot row, or several consecutive hours (The Solo Court)
// linked through booking_slots. bookings.slot_id is only the FIRST hour, so
// screens that show a time range must use the last hour's end time.

type HourRow = { slots: { start_time: string; end_time: string } | null }

/** End time of the last hour and the number of hours, from booking_slots rows. */
export function bookingSpan(rows: unknown, fallbackEnd: string) {
  const hours = ((rows as HourRow[] | null) ?? [])
    .map((r) => r.slots)
    .filter((x): x is { start_time: string; end_time: string } => !!x)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
  return { end_time: hours.length ? hours[hours.length - 1].end_time : fallbackEnd, hours: Math.max(hours.length, 1) }
}

export const hoursLabel = (hours?: number) => (hours && hours > 1 ? ` (${hours} hours)` : '')
