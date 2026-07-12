/**
 * Nearby-amenity lookup (schools, parks, and other neighbourhood amenities)
 * using OpenStreetMap data — no Google Maps/Places API key required.
 *
 * - Geocoding: Nominatim (nominatim.openstreetmap.org) — same free, no-key
 *   service routes/geocode.js already uses for reverse geocoding. Needed
 *   because Ampre VOW essentially never populates its own Latitude/Longitude
 *   (see legal-compliance.md 3.10); DDF-sourced listings do carry coordinates
 *   directly and skip this step.
 * - Amenities: Overpass API (overpass-api.de) — free, no key, queries OSM's
 *   tagged points of interest within a radius of a lat/lon.
 *
 * Both are shared public infrastructure with informal rate limits (~1 req/sec
 * for Nominatim; Overpass has no published hard limit but throttles/blocks
 * abusive callers) — fine for this app's per-search-turn call volume, but if
 * usage grows, self-hosting an Overpass instance or moving to a paid geocoder
 * would be the next step, same tradeoff already noted for Nominatim in
 * routes/geocode.js.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'MosaicRealEstateIntelligence/0.1 (navjot@teammosaic.ca)';

// category key -> { label, osmFilters (each an Overpass tag filter string), radiusMeters, limit }
const AMENITY_CATEGORIES = {
  schools: {
    label: 'Schools',
    filters: ['["amenity"="school"]', '["amenity"="kindergarten"]'],
    radiusMeters: 2000,
    limit: 5,
  },
  parks: {
    label: 'Parks & recreation',
    filters: ['["leisure"="park"]', '["leisure"="playground"]'],
    radiusMeters: 1500,
    limit: 5,
  },
  transit: {
    label: 'Transit stops',
    filters: ['["highway"="bus_stop"]', '["railway"="station"]'],
    radiusMeters: 800,
    limit: 5,
  },
  groceryAndHealth: {
    label: 'Grocery & healthcare',
    filters: ['["shop"="supermarket"]', '["amenity"="hospital"]', '["amenity"="pharmacy"]'],
    radiusMeters: 2000,
    limit: 5,
  },
};

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Resolve a street address to coordinates via Nominatim.
 * @param {string} address
 * @returns {Promise<{ latitude: number, longitude: number } | null>}
 */
export async function geocodeAddress(address) {
  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    const data = await response.json();
    const hit = Array.isArray(data) ? data[0] : null;
    if (!hit) return null;
    return { latitude: Number(hit.lat), longitude: Number(hit.lon) };
  } catch (err) {
    console.error('[amenities] geocode error:', err.message);
    return null;
  }
}

function buildOverpassQuery(lat, lon) {
  const clauses = Object.values(AMENITY_CATEGORIES)
    .flatMap((cat) => cat.filters.map((f) => `nwr${f}(around:${cat.radiusMeters},${lat},${lon});`))
    .join('\n  ');
  return `[out:json][timeout:20];\n(\n  ${clauses}\n);\nout center tags;`;
}

/**
 * Nearby schools, parks, transit, grocery/healthcare around a point, grouped
 * by category and sorted nearest-first. Distances are straight-line, not
 * walking/driving distance.
 * @param {{ latitude: number, longitude: number }} coords
 * @returns {Promise<{ [category: string]: Array<{ name: string, type: string, distanceMeters: number }> } | null>}
 */
export async function getNearbyAmenities({ latitude, longitude }) {
  if (latitude == null || longitude == null) return null;

  try {
    const query = buildOverpassQuery(latitude, longitude);
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!response.ok) {
      console.error('[amenities] Overpass returned', response.status);
      return null;
    }
    const data = await response.json();
    const elements = Array.isArray(data.elements) ? data.elements : [];

    const result = {};
    for (const [key, cat] of Object.entries(AMENITY_CATEGORIES)) {
      const tagValues = cat.filters.map((f) => f.match(/"([^"]+)"\]$/)?.[1]).filter(Boolean);
      const tagKeys = cat.filters.map((f) => f.match(/\["([^"]+)"=/)?.[1]).filter(Boolean);

      const matches = elements
        .filter((el) => el.tags && tagKeys.some((k, i) => el.tags[k] === tagValues[i]))
        .map((el) => {
          const lat = el.lat ?? el.center?.lat;
          const lon = el.lon ?? el.center?.lon;
          if (lat == null || lon == null) return null;
          const type = el.tags.amenity || el.tags.leisure || el.tags.shop || el.tags.highway || el.tags.railway || 'other';
          return {
            name: el.tags.name || `Unnamed ${type.replace(/_/g, ' ')}`,
            type,
            distanceMeters: Math.round(haversineMeters(latitude, longitude, lat, lon)),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, cat.limit);

      result[key] = { label: cat.label, places: matches };
    }
    return result;
  } catch (err) {
    console.error('[amenities] Overpass query error:', err.message);
    return null;
  }
}
