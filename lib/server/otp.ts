import 'server-only'
import { createHmac, randomInt } from 'node:crypto'

/** 6-digit code from the OS CSPRNG (not Math.random). */
export function generateOtp() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/** HMAC bound to user and phone: a stored hash is useless for any other user/number, and cannot be reversed without the server secret. */
export function hashOtp(secret: string, userId: string, phone: string, code: string) {
  return createHmac('sha256', secret).update(`otp:v1:${userId}:${phone}:${code}`).digest('hex')
}

/** IPs are stored hashed (rate limiting without keeping raw addresses). */
export function hashIp(secret: string, ip: string | null) {
  return ip ? createHmac('sha256', secret).update(`ip:v1:${ip}`).digest('hex').slice(0, 32) : null
}
