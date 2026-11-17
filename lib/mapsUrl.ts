// Venue map links. Mirrors the database check locations_google_maps_url_valid
// (migration 1100): only https Google Maps links are accepted.
export const MAPS_URL_RE =
  /^https:\/\/(www\.google\.[a-z.]{2,10}\/maps|maps\.google\.[a-z.]{2,10}|maps\.app\.goo\.gl|goo\.gl\/maps)([/?#]|$)/

export function isGoogleMapsUrl(url: string) {
  return url.length <= 500 && MAPS_URL_RE.test(url)
}
