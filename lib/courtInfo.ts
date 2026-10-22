// Shared, display-only court facts. Prices shown here come from court_pricing,
// which the database defines as LKR PER HOUR; the amount actually charged is
// always computed by the server from the slot rows.

export interface PricingTier { price_lkr: number; applies_to: string; tier_name?: string; time_from?: string; time_to?: string }
export interface CourtLike {
  has_half_court?: boolean | null
  max_consecutive_slots?: number | null
  half_court_cutoff?: string | null
  weekend_full_court_only?: boolean | null
  operating_start?: string | null
  operating_end?: string | null
  court_pricing?: PricingTier[] | null
}

export const COURT_TYPE_LABEL: Record<string, string> = { full_court: 'Full court', half_a: 'Half court A', half_b: 'Half court B' }

/** "05:00:00" -> "5:00 AM", "12:00:00" -> "12:00 PM", "00:00:00" -> "12:00 AM" */
export function time12(t?: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 && h < 24 ? 'PM' : 'AM'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh}:${String(m).padStart(2, '0')} ${suffix}`
}

export const lkr = (n: number) => `LKR ${Number(n).toLocaleString('en-LK', { maximumFractionDigits: 0 })}`

/** Lowest hourly price per court type, e.g. { full_court: 6000, half: 3000 }. */
export function hourlyPrices(c: CourtLike) {
  const tiers = c.court_pricing ?? []
  const min = (types: string[]) => {
    const v = tiers.filter((t) => types.includes(t.applies_to)).map((t) => Number(t.price_lkr))
    return v.length ? Math.min(...v) : null
  }
  return { full: min(['full_court']), half: c.has_half_court ? min(['half_a', 'half_b']) : null }
}

/** Saturday or Sunday for a YYYY-MM-DD date (calendar date, no timezone shift). */
export function isWeekend(day: string) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
  return dow === 0 || dow === 6
}

export const allowsMultiHour = (c: CourtLike) => (c.max_consecutive_slots ?? 1) >= 2

/** Short, honest summary lines for a court card / header. */
export function courtFacts(c: CourtLike) {
  const p = hourlyPrices(c)
  const lines: string[] = []
  if (allowsMultiHour(c) && p.full) {
    lines.push(`${lkr(p.full)} per hour · book 1 hour or ${c.max_consecutive_slots} consecutive hours`)
  } else {
    if (p.full) lines.push(`Full court ${lkr(p.full)} per hour`)
    if (p.half) lines.push(`Half court ${lkr(p.half)} per hour (${c.weekend_full_court_only ? 'weekdays, ' : ''}before ${time12(c.half_court_cutoff ?? '14:00:00')})`)
  }
  if (c.operating_start && c.operating_end) lines.push(`Open ${time12(c.operating_start)} – ${time12(c.operating_end)}`)
  return lines
}
