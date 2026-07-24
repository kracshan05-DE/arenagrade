'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Court {
  id: string
  name: string
  has_half_court: boolean
  half_court_cutoff: string
  operating_start: string
  operating_end: string
  slot_duration_hrs: number
  locations: {
    name: string
    address: string
  }
  sport_types: {
    name: string
  }
  court_pricing: {
    tier_name: string
    time_from: string
    time_to: string
    price_lkr: number
    applies_to: string
  }[]
}

interface Slot {
  id: string
  start_time: string
  end_time: string
  court_type: string
  status: string
  price_lkr: number
  lock_expires_at: string | null
}

export default function CourtPage() {
  const params = useParams()
  const courtId = params.id as string

  const [court, setCourt] = useState<Court | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  })
  const [loading, setLoading] = useState(true)
  const [slotsLoading, setSlotsLoading] = useState(false)

  // Load court details
  useEffect(() => {
    const loadCourt = async () => {
      const { data } = await supabase
        .from('courts')
        .select(`
          *,
          locations (name, address),
          sport_types (name),
          court_pricing (tier_name, time_from, time_to, price_lkr, applies_to)
        `)
        .eq('id', courtId)
        .single()
      if (data) setCourt(data)
      setLoading(false)
    }
    loadCourt()
  }, [courtId])

  // Load slots for selected date
  useEffect(() => {
    if (!courtId || !selectedDate) return
    const loadSlots = async () => {
      setSlotsLoading(true)
      const { data } = await supabase
        .from('slots')
        .select('*')
        .eq('court_id', courtId)
        .eq('slot_date', selectedDate)
        .order('start_time')
      if (data) setSlots(data)
      setSlotsLoading(false)
    }
    loadSlots()
  }, [courtId, selectedDate])

  const getSlotStatusColor = (slot: Slot) => {
    if (slot.status === 'booked') return 'bg-red-100 border-red-200 text-red-500 cursor-not-allowed'
    if (slot.status === 'locked') return 'bg-yellow-100 border-yellow-200 text-yellow-600 cursor-not-allowed'
    if (slot.status === 'blocked') return 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
    return 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100 cursor-pointer'
  }

  const getSlotStatusLabel = (slot: Slot) => {
    if (slot.status === 'booked') return 'Booked'
    if (slot.status === 'locked') return 'Reserved'
    if (slot.status === 'blocked') return 'Unavailable'
    return 'Available'
  }

  const getCourtTypeLabel = (type: string) => {
    if (type === 'full_court') return 'Full Court'
    if (type === 'half_a') return 'Half Court A'
    if (type === 'half_b') return 'Half Court B'
    return type
  }

  // Get min date (today) and max date (30 days ahead)
  const today = new Date().toISOString().split('T')[0]
  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + 30)
  const maxDateStr = maxDate.toISOString().split('T')[0]

  // Group slots by time
  const groupedSlots = slots.reduce((acc, slot) => {
    const key = `${slot.start_time}-${slot.end_time}`
    if (!acc[key]) acc[key] = []
    acc[key].push(slot)
    return acc
  }, {} as Record<string, Slot[]>)

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading court details...</p>
      </div>
    )
  }

  if (!court) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Court not found.</p>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <a href="/" className="text-2xl font-bold text-gray-900">
            Arena<span className="text-green-600">Grade</span>
          </a>
          <a
            href="/auth"
            className="bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-green-700 transition"
          >
            Sign In
          </a>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Back */}
        <a href="/" className="text-green-600 text-sm font-medium hover:underline mb-6 inline-block">
          Back to search
        </a>

        {/* Court Info */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{court.name}</h1>
              <p className="text-gray-500 mt-1">{court.locations.name}</p>
              <p className="text-gray-400 text-sm">{court.locations.address}</p>
            </div>
            <span className="bg-green-100 text-green-700 text-sm font-medium px-3 py-1 rounded-full">
              {court.sport_types.name}
            </span>
          </div>

          <div className="flex items-center gap-6 mt-4 text-sm text-gray-500">
            <span>Operating hours: {court.operating_start.slice(0,5)} - {court.operating_end.slice(0,5)}</span>
            <span>Slot duration: {court.slot_duration_hrs} hours</span>
            {court.has_half_court && (
              <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded-full text-xs">
                Half court available before {court.half_court_cutoff.slice(0,5)}
              </span>
            )}
          </div>

          {/* Pricing */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm font-medium text-gray-700 mb-2">Pricing</p>
            <div className="flex flex-wrap gap-3">
              {court.court_pricing.map((p, i) => (
                <div key={i} className="bg-gray-50 rounded-xl px-4 py-2 text-sm">
                  <span className="text-gray-500">{p.tier_name} ({p.time_from.slice(0,5)} - {p.time_to.slice(0,5)})</span>
                  <span className="text-green-600 font-semibold ml-2">LKR {p.price_lkr.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Date Selector */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Date</label>
          <input
            type="date"
            value={selectedDate}
            min={today}
            max={maxDateStr}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {/* Slot Legend */}
        <div className="flex items-center gap-4 mb-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-green-100 border border-green-200"></div>
            <span className="text-gray-500">Available</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-yellow-100 border border-yellow-200"></div>
            <span className="text-gray-500">Reserved</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-red-100 border border-red-200"></div>
            <span className="text-gray-500">Booked</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-gray-100 border border-gray-200"></div>
            <span className="text-gray-500">Unavailable</span>
          </div>
        </div>

        {/* Slots */}
        {slotsLoading ? (
          <div className="text-center py-12">
            <p className="text-gray-500">Loading slots...</p>
          </div>
        ) : slots.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <p className="text-gray-500 text-lg">No slots available for this date.</p>
            <p className="text-gray-400 text-sm mt-2">Slots are generated when the admin sets them up for this date.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedSlots).map(([timeKey, timeSlots]) => {
              const [start, end] = timeKey.split('-')
              return (
                <div key={timeKey} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <p className="text-sm font-semibold text-gray-700 mb-3">
                    {start.slice(0,5)} - {end.slice(0,5)}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {timeSlots.map(slot => (
                      <div
                        key={slot.id}
                        className={`border rounded-xl p-4 transition ${getSlotStatusColor(slot)}`}
                      >
                        <p className="font-medium text-sm">{getCourtTypeLabel(slot.court_type)}</p>
                        <p className="text-xs mt-1">{getSlotStatusLabel(slot)}</p>
                        <p className="font-bold mt-2">LKR {slot.price_lkr.toLocaleString()}</p>
                        {slot.status === 'available' && (
                          <button className="mt-3 w-full bg-green-600 text-white text-xs py-2 rounded-lg hover:bg-green-700 transition font-medium">
                            Book
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </main>
  )
}
