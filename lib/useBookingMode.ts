'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type BookingMode = 'admin_only' | 'public' | 'closed'

// Reads the site-wide booking mode and whether the signed-in user is an admin.
// Display only: the database enforces the mode on every hold and payment.
export function useBookingMode() {
  const [mode, setMode] = useState<BookingMode | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [{ data: setting }, { data: auth }] = await Promise.all([
        supabase.from('app_settings').select('value').eq('key', 'booking_mode').maybeSingle(),
        supabase.auth.getUser(),
      ])
      let admin = false
      if (auth?.user) {
        const { data: p } = await supabase.from('profiles').select('role').eq('id', auth.user.id).maybeSingle()
        admin = p?.role === 'super_admin'
      }
      if (!alive) return
      // Before migration 0900 the table does not exist: behave as before (public).
      const v = setting?.value
      setMode(v === 'admin_only' || v === 'closed' ? v : 'public')
      setIsAdmin(admin)
    })()
    return () => { alive = false }
  }, [])

  const canBook = mode === 'public' || (mode === 'admin_only' && isAdmin)
  const testMode = mode === 'admin_only' && isAdmin
  return { mode, isAdmin, canBook, testMode, loaded: mode !== null }
}
