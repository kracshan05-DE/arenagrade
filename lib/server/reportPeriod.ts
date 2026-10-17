// Daily report periods, in Asia/Colombo (UTC+05:30, no daylight saving).
// Report day D covers [D-1 22:00, D 22:00) Colombo time, i.e.
// [D-1 16:30Z, D 16:30Z). The report for D can run once D 22:00 has passed.

const OFFSET_MS = (5 * 60 + 30) * 60 * 1000
const CUTOFF_HOUR = 22

const pad = (n: number) => n.toString().padStart(2, '0')
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

/** The most recent report day whose period has fully ended at `now`. */
export function latestCompletedReportDay(now: Date) {
  const local = new Date(now.getTime() + OFFSET_MS) // UTC fields now read as Colombo wall time
  if (local.getUTCHours() < CUTOFF_HOUR) local.setUTCDate(local.getUTCDate() - 1)
  return fmt(local)
}

export function previousDay(day: string) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return fmt(d)
}

export function isValidDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const d = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && fmt(d) === day
}

/** UTC instants bounding report day D. */
export function reportWindow(day: string) {
  const to = new Date(Date.parse(`${day}T${pad(CUTOFF_HOUR)}:00:00Z`) - OFFSET_MS)
  const from = new Date(to.getTime() - 86_400_000)
  return { from, to }
}
