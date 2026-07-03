/**
 * Ampre VOW (RESO OData) client.
 * Same query pattern as navjot-receptionist-agent/core/propertySearchEngine.js —
 * fetch + Bearer token against query.ampre.ca, RESO field names, progressive
 * filter relaxation when a strict query returns nothing.
 */

const AMPRE_URL = 'https://query.ampre.ca/odata/Property';

const DETAIL_SELECT = [
  'ListingKey', 'UnparsedAddress', 'City', 'StateOrProvince', 'PostalCode',
  'Latitude', 'Longitude', 'StandardStatus', 'TransactionType',
  'ListPrice', 'ClosePrice', 'CloseDate', 'ListDate', 'DaysOnMarket',
  'BedroomsTotal', 'BathroomsTotalInteger', 'BuildingAreaTotal',
  'LotDepth', 'LotFrontage', 'PropertySubType', 'PropertyType',
  'PublicRemarks',
].join(',');

const COMP_SELECT = [
  'ListingKey', 'UnparsedAddress', 'City', 'PostalCode', 'Latitude', 'Longitude',
  'StandardStatus', 'ListPrice', 'ClosePrice', 'CloseDate', 'DaysOnMarket',
  'BedroomsTotal', 'BathroomsTotalInteger', 'BuildingAreaTotal', 'PropertySubType',
].join(',');

function assertApiKey() {
  const vowApiKey = process.env.VOW_API_KEY;
  if (!vowApiKey) throw new Error('VOW_API_KEY not set');
  return vowApiKey;
}

/**
 * Run a raw OData query against the Ampre VOW Property feed.
 * @param {string} filter  OData $filter expression
 * @param {string} select  comma-separated $select fields
 * @param {{ top?: number, orderby?: string }} [opts]
 * @returns {Promise<Array<Object>>} raw Ampre records
 */
async function queryAmpre(filter, select, opts = {}) {
  const vowApiKey = assertApiKey();
  const { top = 25, orderby } = opts;

  const params = new URLSearchParams({ $filter: filter, $top: String(top), $select: select });
  if (orderby) params.set('$orderby', orderby);

  const url = `${AMPRE_URL}?${params.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${vowApiKey}` } });
  const text = await res.text();

  if (!res.ok) throw new Error(`Ampre HTTP ${res.status}: ${text.slice(0, 300)}`);

  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Ampre parse error: ${text.slice(0, 200)}`); }

  return data.value ?? [];
}

/**
 * Split "123 Main Street, Kitchener, ON" into { street, city }.
 * Ampre's UnparsedAddress field holds street-only text, so city is filtered separately.
 */
function parseAddressInput(addressInput) {
  const parts = addressInput.split(',').map((p) => p.trim()).filter(Boolean);
  const street = parts[0] || addressInput.trim();
  const city = parts.length > 1 ? parts[1] : null;
  return { street, city };
}

function escapeODataString(value) {
  return value.replace(/'/g, "''");
}

function normalizeProperty(l) {
  return {
    id: String(l.ListingKey ?? ''),
    address: l.UnparsedAddress || '',
    city: l.City || null,
    province: l.StateOrProvince || null,
    postalCode: l.PostalCode || null,
    latitude: l.Latitude ?? null,
    longitude: l.Longitude ?? null,
    status: l.StandardStatus || null,
    transactionType: l.TransactionType || null,
    listPrice: Number(l.ListPrice) || null,
    closePrice: l.ClosePrice != null ? Number(l.ClosePrice) : null,
    closeDate: l.CloseDate || null,
    listDate: l.ListDate || null,
    daysOnMarket: l.DaysOnMarket ?? null,
    beds: l.BedroomsTotal != null ? Math.round(l.BedroomsTotal) : null,
    baths: l.BathroomsTotalInteger != null ? Math.round(l.BathroomsTotalInteger) : null,
    sqft: l.BuildingAreaTotal != null ? Math.round(l.BuildingAreaTotal) : null,
    lotDepth: l.LotDepth ?? null,
    lotFrontage: l.LotFrontage ?? null,
    propertySubType: l.PropertySubType || null,
    propertyType: l.PropertyType || null,
    remarks: l.PublicRemarks || null,
  };
}

function normalizeComp(l) {
  return {
    id: String(l.ListingKey ?? ''),
    address: l.UnparsedAddress || '',
    city: l.City || null,
    postalCode: l.PostalCode || null,
    latitude: l.Latitude ?? null,
    longitude: l.Longitude ?? null,
    listPrice: Number(l.ListPrice) || null,
    closePrice: l.ClosePrice != null ? Number(l.ClosePrice) : null,
    closeDate: l.CloseDate || null,
    daysOnMarket: l.DaysOnMarket ?? null,
    beds: l.BedroomsTotal != null ? Math.round(l.BedroomsTotal) : null,
    baths: l.BathroomsTotalInteger != null ? Math.round(l.BathroomsTotalInteger) : null,
    sqft: l.BuildingAreaTotal != null ? Math.round(l.BuildingAreaTotal) : null,
    propertySubType: l.PropertySubType || null,
  };
}

/**
 * Look up a single property by street address (any status — active, sold, or expired).
 * @param {string} addressInput  e.g. "123 Main Street, Kitchener" or "123 Main Street"
 * @returns {Promise<Object|null>}
 */
export async function searchByAddress(addressInput) {
  const { street, city } = parseAddressInput(addressInput);
  const streetFilter = `contains(UnparsedAddress,'${escapeODataString(street)}')`;

  const variants = city
    ? [`${streetFilter} and City eq '${escapeODataString(city)}'`, streetFilter]
    : [streetFilter];

  for (const filter of variants) {
    const records = await queryAmpre(filter, DETAIL_SELECT, { top: 5, orderby: 'ModificationTimestamp desc' });
    if (records.length > 0) return normalizeProperty(records[0]);
  }
  return null;
}

/** Rough degree offsets for a radius in km, used to build a lat/long bounding box. */
function radiusToDegrees(radiusKm, latitude) {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((latitude * Math.PI) / 180) || 1);
  return { latDelta, lonDelta };
}

function monthsAgoIso(months) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Find recently sold comparables near a subject property's address.
 * @param {string} addressInput
 * @param {{ radiusKm?: number, monthsBack?: number, limit?: number }} [opts]
 * @returns {Promise<{ subject: Object|null, comps: Array<Object> }>}
 */
export async function getSoldComps(addressInput, opts = {}) {
  const { radiusKm = 1.5, monthsBack = 6, limit = 10 } = opts;

  const subject = await searchByAddress(addressInput);
  const { city } = parseAddressInput(addressInput);
  const cutoff = monthsAgoIso(monthsBack);

  const base = [`StandardStatus eq 'Closed'`, `CloseDate ge ${cutoff}`];
  const subtypeFilter = subject?.propertySubType ? `PropertySubType eq '${escapeODataString(subject.propertySubType)}'` : null;

  const variants = [];

  if (subject?.latitude != null && subject?.longitude != null) {
    const { latDelta, lonDelta } = radiusToDegrees(radiusKm, subject.latitude);
    const geoFilter = [
      `Latitude ge ${subject.latitude - latDelta}`,
      `Latitude le ${subject.latitude + latDelta}`,
      `Longitude ge ${subject.longitude - lonDelta}`,
      `Longitude le ${subject.longitude + lonDelta}`,
    ];
    if (subtypeFilter) variants.push({ label: 'geo + subtype', parts: [...base, ...geoFilter, subtypeFilter] });
    variants.push({ label: 'geo only', parts: [...base, ...geoFilter] });
  }

  const targetCity = subject?.city || city;
  if (targetCity) {
    if (subtypeFilter) variants.push({ label: 'city + subtype', parts: [...base, `City eq '${escapeODataString(targetCity)}'`, subtypeFilter] });
    variants.push({ label: 'city only', parts: [...base, `City eq '${escapeODataString(targetCity)}'`] });
  }

  for (const { parts } of variants) {
    const filter = parts.join(' and ');
    const records = await queryAmpre(filter, COMP_SELECT, { top: limit, orderby: 'CloseDate desc' });
    if (records.length > 0) return { subject, comps: records.map(normalizeComp) };
  }

  return { subject, comps: [] };
}
