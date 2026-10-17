// Only allow same-site relative paths as post-login destinations.
// Blocks absolute URLs, protocol-relative "//evil.com", backslash tricks and
// javascript: URLs (open-redirect protection).
export function safeRedirectPath(raw: string | null | undefined, fallback = '/') {
  if (!raw) return fallback
  let v = raw.trim()
  try { v = decodeURIComponent(v) } catch { return fallback }
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\u0000-\u001f]/.test(v)) return fallback
  try {
    const u = new URL(v, 'https://arenagrade.invalid')
    if (u.origin !== 'https://arenagrade.invalid') return fallback
    return u.pathname + u.search + u.hash
  } catch {
    return fallback
  }
}
