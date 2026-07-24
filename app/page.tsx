import { supabase } from '@/lib/supabase'

export default async function Home() {
  const { data, error } = await supabase.from('_test').select('*')

  return (
    <main className="p-10">
      <h1 className="text-2xl font-bold text-green-600">ArenaGrade</h1>
      {error ? (
        <p className="text-green-500 mt-4">
          ✅ Supabase connected successfully!
        </p>
      ) : (
        <p className="text-red-500 mt-4">Connection failed</p>
      )}
    </main>
  )
}