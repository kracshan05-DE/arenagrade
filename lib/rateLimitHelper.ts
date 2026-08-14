// Rate limit helper — checks how many slots a user has locked in the last minute
// Import and use this in booking/[slotId]/page.tsx before calling lockSlot

import { supabase } from '@/lib/supabase'

export const checkSlotLockRateLimit = async (userId: string): Promise<{ allowed: boolean; message?: string }> => {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString()

  const { data: recentLocks } = await supabase
    .from('slots')
    .select('id')
    .eq('locked_by', userId)
    .eq('status', 'locked')
    .gte('lock_expires_at', new Date().toISOString()) // only active locks

  // Max 3 active locks at once
  if (recentLocks && recentLocks.length >= 3) {
    return {
      allowed: false,
      message: 'You have too many slots reserved at once. Please complete or cancel your existing reservations before booking another.'
    }
  }

  return { allowed: true }
}

export const checkOtpRateLimit = async (phone: string): Promise<{ allowed: boolean; waitMinutes?: number }> => {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const { data: recentOtps } = await supabase
    .from('otp_verifications')
    .select('created_at')
    .eq('phone', phone)
    .gte('created_at', tenMinutesAgo)
    .order('created_at', { ascending: false })

  if (!recentOtps || recentOtps.length < 3) return { allowed: true }

  const oldestInWindow = new Date(recentOtps[recentOtps.length - 1].created_at)
  const resetAt = new Date(oldestInWindow.getTime() + 10 * 60 * 1000)
  const waitMs = resetAt.getTime() - Date.now()
  const waitMinutes = Math.ceil(waitMs / 60000)

  return { allowed: false, waitMinutes }
}
