// Sri Lankan mobile numbers. Accepts 07XXXXXXXX, 7XXXXXXXX, 947XXXXXXXX,
// +94 7X XXX XXXX (spaces/dashes ignored). Returns the local form stored in
// profiles (07XXXXXXXX) and the international form Text.lk expects (947XXXXXXXX).
export function normalizeSriLankanMobile(input: unknown): { local: string; international: string } | null {
  if (typeof input !== 'string') return null
  let d = input.replace(/[\s\-()]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  if (!/^\d+$/.test(d)) return null
  if (d.startsWith('94')) d = d.slice(2)
  else if (d.startsWith('0')) d = d.slice(1)
  if (!/^7\d{8}$/.test(d)) return null
  return { local: `0${d}`, international: `94${d}` }
}
