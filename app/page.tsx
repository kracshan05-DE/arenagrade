'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface SportType {
  id: string
  name: string
  has_half_court_option: boolean
}

interface District {
  id: string
  name: string
}

interface City {
  id: string
  name: string
  district_id: string
}

interface Court {
  id: string
  name: string
  has_half_court: boolean
  operating_start: string
  operating_end: string
  locations: {
    name: string
    address: string
  }
  sport_types: {
    name: string
  }
  court_pricing: {
    tier_name: string
    price_lkr: number
    applies_to: string
  }[]
}

export default function Home() {
  const [sports, setSports] = useState<SportType[]>([])
  const [districts, setDistricts] = useState<District[]>([])
  const [cities, setCities] = useState<City[]>([])
  const [courts, setCourts] = useState<Court[]>([])
  const [selectedSport, setSelectedSport] = useState('')
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [selectedCity, setSelectedCity] = useState('')
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    const loadInitialData = async () => {
      const [{ data: sportsData }, { data: districtsData }] = await Promise.all([
        supabase.from('sport_types').select('*').eq('is_active', true).order('name'),
        supabase.from('districts').select('*').order('name'),
      ])
      if (sportsData) setSports(sportsData)
      if (districtsData) setDistricts(districtsData)
    }
    loadInitialData()
  }, [])

  useEffect(() => {
    if (!selectedDistrict) {
      setCities([])
      setSelectedCity('')
      return
    }
    const loadCities = async () => {
      const { data } = await supabase
        .from('cities')
        .select('*')
        .eq('district_id', selectedDistrict)
        .eq('is_active', true)
        .order('name')
      if (data) setCities(data)
    }
    loadCities()
  }, [selectedDistrict])

  const searchCourts = async () => {
    if (!selectedSport || !selectedDistrict) return
    setLoading(true)
    setSearched(true)
    let query = supabase
      .from('courts')
      .select(`
        *,
        locations!inner (name, address, district_id, city_id),
        sport_types!inner (name),
        court_pricing (tier_name, price_lkr, applies_to)
      `)
      .eq('is_active', true)
      .eq('sport_type_id', selectedSport)
      .eq('locations.district_id', selectedDistrict)
    if (selectedCity) {
      query = query.eq('locations.city_id', selectedCity)
    }
    const { data } = await query
    if (data) setCourts(data)
    setLoading(false)
  }

  const getMinPrice = (pricing: Court['court_pricing']) => {
    if (!pricing || pricing.length === 0) return 'N/A'
    const min = Math.min(...pricing.map(p => p.price_lkr))
    return `LKR ${min.toLocaleString()}`
  }

  return (
    <main className="min-h-screen bg-gray-50">

      <header className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">
            Arena<span className="text-green-600">Grade</span>
          </h1>
          <a
            href="/auth"
            className="bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-green-700 transition"
          >
            Sign In
          </a>
        </div>
      </header>

      <section className="bg-green-600 text-white py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-4">Book Your Court Online</h2>
          <p className="text-green-100 text-lg">
            Basketball, Squash, Tennis and more - find and book courts across Sri Lanka
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 -mt-8">
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sport</label>
              <select
                value={selectedSport}
                onChange={(e) => setSelectedSport(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Select sport</option>
                {sports.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">District</label>
              <select
                value={selectedDistrict}
                onChange={(e) => {
                  setSelectedDistrict(e.target.value)
                  setSelectedCity('')
                }}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Select district</option>
                {districts.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                City / Area <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                disabled={!selectedDistrict || cities.length === 0}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">All areas</option>
                {cities.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

          </div>

          <button
            onClick={searchCourts}
            disabled={!selectedSport || !selectedDistrict || loading}
            className="w-full bg-green-600 text-white rounded-xl py-3 font-semibold hover:bg-green-700 transition disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search Courts'}
          </button>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 py-8">
        {searched && !loading && courts.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">No courts found for your search.</p>
            <p className="text-gray-400 text-sm mt-2">Try selecting a different district or sport.</p>
          </div>
        )}

        {courts.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              {courts.length} court{courts.length > 1 ? 's' : ''} found
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {courts.map(court => (
                <div key={court.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="font-semibold text-gray-900">{court.name}</h4>
                      <p className="text-gray-500 text-sm">{court.locations.name}</p>
                      <p className="text-gray-400 text-xs mt-1">{court.locations.address}</p>
                    </div>
                    <span className="bg-green-100 text-green-700 text-xs font-medium px-3 py-1 rounded-full">
                      {court.sport_types.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                    <span>
                      {court.operating_start.slice(0, 5)} - {court.operating_end.slice(0, 5)}
                    </span>
                    {court.has_half_court && (
                      <span className="bg-blue-50 text-blue-600 text-xs px-2 py-1 rounded-full">
                        Half court available
                      </span>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs text-gray-400">Starting from</span>
                      <p className="text-green-600 font-bold text-lg">
                        {getMinPrice(court.court_pricing)}
                      </p>
                    </div>
                    <button className="bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-green-700 transition">
                      Book Now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

    </main>
  )
}
