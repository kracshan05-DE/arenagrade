// Migration 1100: court description and photos, venue map links, safe court
// deletion, the catalogue audit trail and the images bucket limits.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TestDb, colomboDate } from './helpers'

let db: TestDb
beforeEach(async () => { db = await TestDb.create() })
afterEach(async () => { await db.close() })

const BASE = 'https://abc123.supabase.co/storage/v1/object/public/images'
const photo = (court: string, name = 'cover.jpg') => `${BASE}/courts/${court}/${name}`

const setImages = (uid: string, court: string, images: string[]) =>
  db.as('authenticated', uid, `update public.courts set images = $2 where id = $1 returning id`, [court, images])
const deleteCourt = (uid: string, court: string) =>
  db.as<{ r: Record<string, unknown> }>('authenticated', uid, `select public.admin_delete_court($1) as r`, [court]).then((x) => x[0].r)

describe('court description and photos', () => {
  it('an admin can save a description and photos stored in that court’s folder', async () => {
    const admin = await db.user({ role: 'super_admin' })
    const court = await db.court()
    const rows = await db.as('authenticated', admin,
      `update public.courts set description = $2, images = $3 where id = $1 returning id`,
      [court, 'Indoor wooden court', [photo(court), photo(court, '2.webp')]])
    expect(rows).toHaveLength(1)
    const c = (await db.su.query(`select description, images from public.courts where id = $1`, [court])).rows[0]
    expect(c.description).toBe('Indoor wooden court')
    expect(c.images).toEqual([photo(court), photo(court, '2.webp')])
  })

  it('rejects photos outside the bucket, in another court’s folder, or more than 6', async () => {
    const admin = await db.user({ role: 'super_admin' })
    const court = await db.court()
    const other = await db.court()
    await expect(setImages(admin, court, ['https://evil.example/x.jpg'])).rejects.toThrow(/courts_images_valid/)
    await expect(setImages(admin, court, [photo(other)])).rejects.toThrow(/courts_images_valid/)
    await expect(setImages(admin, court, [`${BASE}/courts/${court}/../x.jpg`])).rejects.toThrow(/courts_images_valid/)
    await expect(setImages(admin, court, Array.from({ length: 7 }, (_, i) => photo(court, `${i}.jpg`)))).rejects.toThrow(/courts_images_valid/)
    await expect(db.as('authenticated', admin, `update public.courts set description = repeat('x', 2001) where id = $1`, [court]))
      .rejects.toThrow(/courts_description_length/)
  })

  it('a customer cannot change a court, and anyone can read an active court’s photos', async () => {
    const customer = await db.user()
    const court = await db.court()
    await db.su.query(`update public.courts set images = $2 where id = $1`, [court, [photo(court)]])
    expect(await setImages(customer, court, [])).toHaveLength(0)       // RLS: no row visible to update
    const anon = await db.as<{ images: string[] }>('anon', null, `select images from public.courts where id = $1`, [court])
    expect(anon[0].images).toEqual([photo(court)])
  })
})

describe('venue map link', () => {
  it('accepts Google Maps links and rejects anything else', async () => {
    const admin = await db.user({ role: 'super_admin' })
    const loc = (await db.su.query(`insert into public.locations (name, address) values ('Venue', 'Colombo') returning id`)).rows[0].id
    const set = (url: string | null) =>
      db.as('authenticated', admin, `update public.locations set google_maps_url = $2 where id = $1 returning id`, [loc, url])
    for (const ok of ['https://maps.app.goo.gl/AbC123', 'https://www.google.com/maps/place/Colombo', 'https://maps.google.com/?q=6.9,79.8',
      'https://www.google.lk/maps/@6.9,79.8,15z', 'https://goo.gl/maps/xyz', null]) {
      expect(await set(ok)).toHaveLength(1)
    }
    for (const bad of ['http://maps.app.goo.gl/AbC', 'https://evil.example/maps', 'https://maps.app.goo.gl.evil.example/x',
      'javascript:alert(1)', 'https://www.google.com/search?q=x']) {
      await expect(set(bad)).rejects.toThrow(/locations_google_maps_url_valid/)
    }
  })
})

describe('deleting a court', () => {
  it('removes an unused court with its prices and unbooked slots, and records it', async () => {
    const admin = await db.user({ role: 'super_admin' })
    const court = await db.court()
    await db.su.query(`insert into public.court_pricing (court_id, tier_name, time_from, time_to, price_lkr, applies_to)
      values ($1, 'Standard', '00:00', '00:00', 6000, 'full_court')`, [court])
    await db.slot(court, colomboDate(3), '08:00', '10:00', 'full_court')
    await db.slot(court, colomboDate(3), '10:00', '12:00', 'full_court', { status: 'blocked' })
    await db.su.query(`update public.courts set images = $2 where id = $1`, [court, [photo(court)]])

    const r = await deleteCourt(admin, court)
    expect(r).toMatchObject({ deleted: true, slots_removed: 2, images: [photo(court)] })
    for (const t of ['courts', 'slots', 'court_pricing']) {
      const col = t === 'courts' ? 'id' : 'court_id'
      expect((await db.su.query(`select count(*)::int n from public.${t} where ${col} = $1`, [court])).rows[0].n).toBe(0)
    }
    const audit = (await db.su.query(`select actor_id, action from public.audit_log where action = 'court.delete' and entity_id = $1`, [court])).rows
    expect(audit).toEqual([{ actor_id: admin, action: 'court.delete' }])
  })

  it('refuses a court with any booking history, and leaves it untouched', async () => {
    const admin = await db.user({ role: 'super_admin' })
    const customer = await db.user()
    const court = await db.court()
    const slot = await db.slot(court, colomboDate(3), '08:00', '10:00', 'full_court', { status: 'booked' })
    await db.su.query(`insert into public.bookings (user_id, slot_id, court_id, status, total_lkr) values ($1, $2, $3, 'cancelled', 3000)`,
      [customer, slot, court])
    await expect(deleteCourt(admin, court)).rejects.toThrow(/court_in_use/)
    expect((await db.su.query(`select count(*)::int n from public.slots where court_id = $1`, [court])).rows[0].n).toBe(1)
  })

  it('refuses a court with a live hold', async () => {
    const admin = await db.user({ role: 'super_admin' })
    const customer = await db.user()
    const court = await db.court()
    const slot = await db.slot(court, colomboDate(3), '08:00', '10:00', 'full_court')
    await db.hold(customer, slot)
    await expect(deleteCourt(admin, court)).rejects.toThrow(/court_in_use/)
  })

  it('only an admin can delete a court', async () => {
    const customer = await db.user()
    const court = await db.court()
    await expect(deleteCourt(customer, court)).rejects.toThrow(/forbidden/)
    await expect(db.as('anon', null, `select public.admin_delete_court($1)`, [court])).rejects.toThrow(/permission denied/)
  })
})

describe('catalogue audit trail', () => {
  it('records who changed a price and what changed, and skips no-op updates', async () => {
    const admin = await db.user({ role: 'super_admin' })
    const court = await db.court()
    const price = (await db.su.query(`insert into public.court_pricing (court_id, tier_name, time_from, time_to, price_lkr, applies_to)
      values ($1, 'Standard', '00:00', '00:00', 6000, 'full_court') returning id`, [court])).rows[0].id
    await db.as('authenticated', admin, `update public.court_pricing set price_lkr = 6500 where id = $1`, [price])
    await db.as('authenticated', admin, `update public.court_pricing set price_lkr = 6500 where id = $1`, [price])
    const rows = (await db.su.query(
      `select actor_id, actor_kind, details from public.audit_log where action = 'court_pricing.update' and entity_id = $1`, [price])).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actor_id: admin, actor_kind: 'admin' })
    expect(rows[0].details).toEqual({ price_lkr: { from: 6000, to: 6500 } })
  })
})

describe('images bucket limits', () => {
  it('allows only JPEG, PNG and WebP up to 5 MB', async () => {
    const b = (await db.su.query(`select file_size_limit, allowed_mime_types from storage.buckets where id = 'images'`)).rows[0]
    expect(Number(b.file_size_limit)).toBe(5 * 1024 * 1024)
    expect(b.allowed_mime_types).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })
})
