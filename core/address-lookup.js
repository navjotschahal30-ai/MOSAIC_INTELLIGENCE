/**
 * Canada-wide address autocomplete, proxied server-side (CORS + descriptive
 * User-Agent, same reasoning as core/geocode's reverse lookup).
 *
 * Canada Post's AddressComplete is the familiar "address bar" UX this is
 * modelled on, but it's a paid/keyed API — there's no open access tier. NRCan's
 * Geolocator (geogratis.gc.ca) covers the same civic-address-as-you-type case,
 * is free with no key, and is already Canada Post's own upstream source for
 * the National Address Register, so results line up closely in practice.
 */

const GEOLOCATOR_URL = 'https://geogratis.gc.ca/services/geolocation/en/locate';
const REQUEST_TIMEOUT_MS = 3000;

const MUNICIPALITY_PREFIX = /^(city|town|township|village|municipality|regional municipality|county|district|district municipality) of\s+/i;

// Only street-level results carry a real civic address; intersections and
// named places (lakes, conservation areas, ...) aren't something a user meant
// to type into a "property address" box.
const STREET_TYPE = 'ca.gc.nrcan.geoloc.data.model.Street';

function cleanCityName(rawMunicipality) {
  return rawMunicipality.replace(MUNICIPALITY_PREFIX, '').trim();
}

// "23 Doon Mills Drive, City Of Kitchener, Ontario" -> "23 Doon Mills Drive, Kitchener"
function formatLabel(title) {
  const [street, municipality] = title.split(',').map((p) => p.trim());
  if (!street) return null;
  if (!municipality) return street;
  return `${street}, ${cleanCityName(municipality)}`;
}

/**
 * Suggest full Canadian street addresses for a partial address string,
 * Canada Post AddressComplete-style (progressively narrowing as the user
 * types). Degrades to an empty list on any error or timeout — autocomplete
 * should never block or break typing.
 * @param {string} partial  e.g. "23 doon"
 * @param {string} [city]  narrows results when the caller already knows the city
 * @returns {Promise<string[]>}
 */
export async function suggestAddresses(partial, city) {
  const trimmed = (partial || '').trim();
  if (trimmed.length < 3) return [];

  const query = city ? `${trimmed}, ${city}` : trimmed;
  const url = `${GEOLOCATOR_URL}?q=${encodeURIComponent(query)}&num=15`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let results;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'MosaicRealEstateIntelligence/0.1 (navjot@teammosaic.ca)' },
      signal: controller.signal,
    });
    results = await response.json();
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }

  if (!Array.isArray(results)) return [];

  const streets = results.filter((r) => r.type === STREET_TYPE);
  const inCity = city
    ? streets.filter((r) => r.title.toLowerCase().includes(city.trim().toLowerCase()))
    : [];
  // Prefer city-matched results, but fall back to the wider list rather than
  // showing nothing — the city guess (browser geolocation) can be wrong.
  const candidates = inCity.length > 0 ? inCity : streets;

  // A civic-numbered match (INTERPOLATED_POSITION) is a more useful suggestion
  // than a bare street name (INTERPOLATED_CENTROID) — surface those first.
  const ranked = [...candidates].sort((a, b) => {
    const aPos = a.qualifier === 'INTERPOLATED_POSITION' ? 0 : 1;
    const bPos = b.qualifier === 'INTERPOLATED_POSITION' ? 0 : 1;
    return aPos - bPos;
  });

  const seen = new Set();
  const suggestions = [];
  for (const r of ranked) {
    const label = formatLabel(r.title);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    suggestions.push(label);
    if (suggestions.length >= 5) break;
  }
  return suggestions;
}
