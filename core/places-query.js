/**
 * Google Places API (New) client — proximity-based "what's nearby" lookups
 * (schools, parks, other amenities) for a resolved subject property.
 *
 * This is NOT school catchment/boundary data — it's just "what schools
 * happen to be physically closest," which is not the same as which school
 * a given address is actually zoned for (confirmed during research: neither
 * VOW nor DDF nor Fraser Institute/HoodQ/Local Logic gave us a self-serve
 * path to real catchment data). core/claude-analysis.js's prompt always
 * pairs this data with an explicit instruction to direct the user to the
 * local school board / ontario.ca locator for the actual assigned school.
 */

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchNearby';

const SCHOOL_TYPES = ['school', 'primary_school', 'secondary_school'];
const PARK_TYPES = ['park'];
const OTHER_TYPES = ['transit_station', 'supermarket', 'pharmacy', 'restaurant'];

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.types',
  'places.formattedAddress',
  'places.location',
].join(',');

function assertApiKey() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not set');
  return apiKey;
}

/** Great-circle distance in km between two lat/long points (haversine). */
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function searchNearby({ latitude, longitude, includedTypes, radiusMeters, maxResultCount }) {
  const apiKey = assertApiKey();

  const res = await fetch(PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount,
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: { center: { latitude, longitude }, radius: radiusMeters },
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Places HTTP ${res.status}: ${text.slice(0, 300)}`);

  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Places parse error: ${text.slice(0, 200)}`); }

  return data.places ?? [];
}

function normalizePlace(p, subjectLat, subjectLon) {
  return {
    name: p.displayName?.text || 'Unnamed',
    address: p.formattedAddress || null,
    distanceKm: p.location
      ? Math.round(distanceKm(subjectLat, subjectLon, p.location.latitude, p.location.longitude) * 10) / 10
      : null,
    types: p.types || [],
  };
}

/**
 * Nearby schools, parks, and other amenities (transit, groceries, pharmacy,
 * restaurants) within a radius of a resolved subject property. Fails soft —
 * returns nulls on any error (missing key, quota, network) rather than
 * breaking the chat response, same pattern as autocomplete/geocode.
 * @param {number} latitude
 * @param {number} longitude
 * @param {{ radiusMeters?: number, perCategoryLimit?: number }} [opts]
 * @returns {Promise<{ schools: Array<Object>, parks: Array<Object>, other: Array<Object> } | null>}
 */
export async function getNearbyAmenities(latitude, longitude, opts = {}) {
  if (latitude == null || longitude == null) return null;

  const { radiusMeters = 2000, perCategoryLimit = 5 } = opts;

  try {
    const [schoolPlaces, parkPlaces, otherPlaces] = await Promise.all([
      searchNearby({ latitude, longitude, includedTypes: SCHOOL_TYPES, radiusMeters, maxResultCount: 10 }),
      searchNearby({ latitude, longitude, includedTypes: PARK_TYPES, radiusMeters, maxResultCount: 10 }),
      searchNearby({ latitude, longitude, includedTypes: OTHER_TYPES, radiusMeters, maxResultCount: 10 }),
    ]);

    const toList = (places) => places
      .map((p) => normalizePlace(p, latitude, longitude))
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
      .slice(0, perCategoryLimit);

    return {
      schools: toList(schoolPlaces),
      parks: toList(parkPlaces),
      other: toList(otherPlaces),
    };
  } catch (err) {
    console.error('[places] nearby amenities lookup failed:', err.message);
    return null;
  }
}
