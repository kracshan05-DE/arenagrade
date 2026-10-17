import 'server-only'

// Structured JSON logs (visible in Vercel runtime logs). Values under keys
// that can hold secrets or personal data are redacted before printing.

const REDACT = /(otp|code|secret|token|password|authorization|api[_-]?key|md5sig|hash|card|email|phone)/i

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT.test(k) ? '[redacted]' : redact(v, depth + 1)
    }
    return out
  }
  return value
}

type Level = 'debug' | 'info' | 'warn' | 'error'

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as object) })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/** "0771234567" -> "077****567"; "a.b@gmail.com" -> "a***@gmail.com" */
export function maskRecipient(v: string | null | undefined) {
  if (!v) return null
  if (v.includes('@')) {
    const [user, domain] = v.split('@')
    return `${user.slice(0, 1)}***@${domain}`
  }
  const d = v.replace(/\D/g, '')
  return d.length > 6 ? `${d.slice(0, 3)}****${d.slice(-3)}` : '***'
}
