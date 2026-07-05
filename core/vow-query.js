/**
 * Ampre VOW (RESO OData) client.
 * Same query pattern as navjot-receptionist-agent/core/propertySearchEngine.js —
 * fetch + Bearer token against query.ampre.ca, RESO field names, progressive
 * filter relaxation when a strict query returns nothing.
 */

const AMPRE_URL = 'https://query.ampre.ca/odata/Property';

// Team MOSAIC's home market — assumed city when an address is given without one
// (e.g. "23 Doon Creek Street" with no city segment).
const DEFAULT_CITY = 'Kitchener';

const DETAIL_SELECT = [
  'ListingKey', 'UnparsedAddress', 'City', 'CityRegion', 'StateOrProvince', 'PostalCode',
  'Latitude', 'Longitude', 'StandardStatus', 'TransactionType',
  'ListPrice', 'ClosePrice', 'CloseDate', 'DaysOnMarket',
  'BedroomsTotal', 'BathroomsTotalInteger', 'BuildingAreaTotal', 'LivingAreaRange',
  'LotWidth', 'LotDepth', 'LotSizeArea', 'LotSizeUnits', 'LotSizeRangeAcres', 'LotFeatures', 'LotShape',
  'YearBuilt', 'ApproximateAge',
  'PropertySubType', 'PropertyType', 'OccupantType',
  'GarageParkingSpaces', 'ParkingSpaces', 'ParkingTotal', 'ParkingFeatures', 'KitchensTotal',
  // Construction & systems — RESO Data Dictionary fields confirmed against the
  // live Ampre $metadata (Roof/Basement/Cooling etc. are Collection(Edm.String)
  // and joined into comma lists by normalizeProperty).
  'Roof', 'Basement', 'BasementYN', 'FoundationDetails', 'ConstructionMaterials', 'ExteriorFeatures',
  'HeatType', 'HeatSource', 'Cooling', 'Sewer', 'Water', 'WaterSource', 'Utilities', 'UFFI',
  'FireplaceYN', 'FireplacesTotal', 'PoolFeatures', 'WaterfrontYN',
  // Financial — condo fees, taxes.
  'TaxAnnualAmount', 'TaxYear', 'AssociationFee', 'AssociationFeeFrequency', 'AssociationFeeIncludes',
  // Chattels/rentals — TRREB's Inclusions/Exclusions/RentalItems fields are
  // distinct from PublicRemarks and were previously never fetched, so
  // questions about them fell through to "not in the data."
  'Inclusions', 'Exclusions', 'RentalItems', 'RentalItemsMonthlyCost', 'PublicRemarksExtras',
  // Possession, zoning, condo unit identifiers.
  'PossessionDate', 'PossessionType', 'Zoning', 'CondoCorpNumber', 'ApartmentNumber', 'UnitNumber', 'Locker', 'LockerNumber',
  'PublicRemarks', 'ListOfficeName',
].join(',');

const COMP_SELECT = [
  'ListingKey', 'UnparsedAddress', 'City', 'PostalCode', 'Latitude', 'Longitude',
  'StandardStatus', 'ListPrice', 'ClosePrice', 'CloseDate', 'PurchaseContractDate',
  'DaysOnMarket', 'BedroomsTotal', 'BathroomsTotalInteger', 'BuildingAreaTotal',
  'LivingAreaRange', 'LotSizeRangeAcres', 'ApproximateAge', 'PropertySubType', 'OccupantType',
  'GarageParkingSpaces', 'ParkingSpaces', 'ParkingTotal', 'KitchensTotal',
  'PublicRemarks', 'ListOfficeName',
].join(',');

// Standard TRREB/Ampre bucket options (confirmed against the live MLS search UI).
// Condo-style listings sometimes use finer buckets (e.g. "500-599") that aren't
// in this list — widenBucketSet() degrades gracefully (no widening) when a
// subject's bucket isn't found here, rather than guessing.
const LIVING_AREA_RANGE_ORDER = [
  '<700', '700-1100', '1100-1500', '1500-2000', '2000-2500',
  '2500-3000', '3000-3500', '3500-5000', '5000+',
];
const APPROX_AGE_ORDER = ['New', '0-5', '6-15', '16-30', '31-50', '51-99', '100+'];

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

  // Ampre's OData parser rejects '+'-encoded spaces (what URLSearchParams produces) —
  // it needs %20, so build the query string manually with encodeURIComponent.
  const params = { $filter: filter, $top: String(top), $select: select };
  if (orderby) params.$orderby = orderby;
  const queryString = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const url = `${AMPRE_URL}?${queryString}`;
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

// RESO Collection(Edm.String) fields (e.g. Roof, Basement, Cooling) come back
// as arrays — joined into a comma list since Claude and the UI only need text.
function joinList(arr) {
  return Array.isArray(arr) && arr.length > 0 ? arr.join(', ') : null;
}

function normalizeProperty(l) {
  return {
    id: String(l.ListingKey ?? ''),
    address: l.UnparsedAddress || '',
    city: l.City || null,
    cityRegion: l.CityRegion || null,
    province: l.StateOrProvince || null,
    postalCode: l.PostalCode || null,
    latitude: l.Latitude ?? null,
    longitude: l.Longitude ?? null,
    status: l.StandardStatus || null,
    transactionType: l.TransactionType || null,
    listPrice: Number(l.ListPrice) || null,
    closePrice: l.ClosePrice != null ? Number(l.ClosePrice) : null,
    closeDate: l.CloseDate || null,
    daysOnMarket: l.DaysOnMarket ?? null,
    beds: l.BedroomsTotal != null ? Math.round(l.BedroomsTotal) : null,
    baths: l.BathroomsTotalInteger != null ? Math.round(l.BathroomsTotalInteger) : null,
    sqft: l.BuildingAreaTotal != null ? Math.round(l.BuildingAreaTotal) : null,
    livingAreaRange: l.LivingAreaRange || null,
    lotWidth: l.LotWidth ?? null,
    lotDepth: l.LotDepth ?? null,
    lotSizeArea: l.LotSizeArea ?? null,
    lotSizeUnits: l.LotSizeUnits || null,
    lotSizeRangeAcres: l.LotSizeRangeAcres || null,
    lotFeatures: joinList(l.LotFeatures),
    lotShape: l.LotShape || null,
    yearBuilt: l.YearBuilt ?? null,
    approxAge: l.ApproximateAge || null,
    propertySubType: l.PropertySubType || null,
    propertyType: l.PropertyType || null,
    occupantType: l.OccupantType || null,
    garageParkingSpaces: l.GarageParkingSpaces || null,
    driveParkingSpaces: l.ParkingSpaces ?? null,
    totalParkingSpaces: l.ParkingTotal ?? null,
    parkingFeatures: joinList(l.ParkingFeatures),
    kitchensTotal: l.KitchensTotal ?? null,
    // Construction & systems
    roof: joinList(l.Roof),
    basement: joinList(l.Basement),
    basementFinished: l.BasementYN ?? null,
    foundationDetails: joinList(l.FoundationDetails),
    constructionMaterials: joinList(l.ConstructionMaterials),
    exteriorFeatures: joinList(l.ExteriorFeatures),
    heatType: l.HeatType || null,
    heatSource: l.HeatSource || null,
    cooling: joinList(l.Cooling),
    sewer: joinList(l.Sewer),
    water: l.Water || null,
    waterSource: joinList(l.WaterSource),
    utilities: joinList(l.Utilities),
    uffi: l.UFFI || null,
    fireplace: l.FireplaceYN ?? null,
    fireplacesTotal: l.FireplacesTotal ?? null,
    poolFeatures: joinList(l.PoolFeatures),
    waterfront: l.WaterfrontYN ?? null,
    // Financial
    taxAnnualAmount: l.TaxAnnualAmount != null ? Number(l.TaxAnnualAmount) : null,
    taxYear: l.TaxYear ?? null,
    condoFee: l.AssociationFee != null ? Number(l.AssociationFee) : null,
    condoFeeFrequency: l.AssociationFeeFrequency || null,
    condoFeeIncludes: joinList(l.AssociationFeeIncludes),
    // Chattels / rentals — distinct MLS fields from the free-text remarks.
    inclusions: l.Inclusions || null,
    exclusions: l.Exclusions || null,
    rentalItems: l.RentalItems || null,
    rentalItemsMonthlyCost: l.RentalItemsMonthlyCost || null,
    remarksExtras: l.PublicRemarksExtras || null,
    // Possession, zoning, condo unit identifiers
    possessionDate: l.PossessionDate || null,
    possessionType: l.PossessionType || null,
    zoning: l.Zoning || null,
    condoCorpNumber: l.CondoCorpNumber ?? null,
    unitNumber: l.ApartmentNumber || l.UnitNumber || null,
    locker: l.Locker || null,
    lockerNumber: l.LockerNumber || null,
    remarks: l.PublicRemarks || null,
    brokerage: l.ListOfficeName || null,
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
    pendingDate: l.PurchaseContractDate || null,
    daysOnMarket: l.DaysOnMarket ?? null,
    beds: l.BedroomsTotal != null ? Math.round(l.BedroomsTotal) : null,
    baths: l.BathroomsTotalInteger != null ? Math.round(l.BathroomsTotalInteger) : null,
    sqft: l.BuildingAreaTotal != null ? Math.round(l.BuildingAreaTotal) : null,
    livingAreaRange: l.LivingAreaRange || null,
    lotSizeRangeAcres: l.LotSizeRangeAcres || null,
    approxAge: l.ApproximateAge || null,
    propertySubType: l.PropertySubType || null,
    occupantType: l.OccupantType || null,
    garageParkingSpaces: l.GarageParkingSpaces || null,
    driveParkingSpaces: l.ParkingSpaces ?? null,
    totalParkingSpaces: l.ParkingTotal ?? null,
    kitchensTotal: l.KitchensTotal ?? null,
    remarks: l.PublicRemarks || null,
    brokerage: l.ListOfficeName || null,
  };
}

/**
 * Look up a property by street address (any status — active, sold, or expired).
 * Handles partial addresses by defaulting to Kitchener when no city is given.
 * If more than one distinct address matches, returns an 'ambiguous' result
 * instead of silently guessing.
 * @param {string} addressInput  e.g. "123 Main Street, Kitchener" or "123 Main Street"
 * @returns {Promise<{ status: 'found', property: Object } | { status: 'ambiguous', candidates: Array<Object> } | { status: 'not_found' }>}
 */
export async function searchByAddress(addressInput) {
  const { street, city } = parseAddressInput(addressInput);
  const streetFilter = `contains(UnparsedAddress,'${escapeODataString(street)}')`;
  const cityToTry = city || DEFAULT_CITY;

  // Try the assumed/given city first, then fall back to an unrestricted street search
  // (covers both a wrong default-city guess and a genuinely different city).
  const variants = [
    `${streetFilter} and City eq '${escapeODataString(cityToTry)}'`,
    streetFilter,
  ];

  for (const filter of variants) {
    const records = await queryAmpre(filter, DETAIL_SELECT, { top: 5, orderby: 'ModificationTimestamp desc' });
    if (records.length === 0) continue;

    const normalized = records.map(normalizeProperty);
    const distinct = [];
    const seenAddresses = new Set();
    for (const p of normalized) {
      if (!seenAddresses.has(p.address)) {
        seenAddresses.add(p.address);
        distinct.push(p);
      }
    }

    if (distinct.length > 1) return { status: 'ambiguous', candidates: distinct };
    return { status: 'found', property: distinct[0] };
  }

  return { status: 'not_found' };
}

/**
 * Autocomplete-style lookup: top 3 distinct "Street, City" suggestions for a
 * partial address as the user types. Lighter than searchByAddress — no
 * ambiguity detection, just a ranked suggestion list.
 * @param {string} partial  e.g. "23 doon"
 * @param {string} [city]  defaults to Kitchener, same as searchByAddress
 * @returns {Promise<string[]>}
 */
export async function fuzzyMatchAddress(partial, city) {
  const trimmed = (partial || '').trim();
  if (trimmed.length < 3) return [];

  const cityToUse = city || DEFAULT_CITY;
  const filter = `contains(UnparsedAddress,'${escapeODataString(trimmed)}') and City eq '${escapeODataString(cityToUse)}'`;

  let records;
  try {
    records = await queryAmpre(filter, 'UnparsedAddress,City', { top: 10, orderby: 'ModificationTimestamp desc' });
  } catch {
    return []; // autocomplete degrades silently — a failed suggestion fetch shouldn't break typing
  }

  const seen = new Set();
  const suggestions = [];
  for (const r of records) {
    const street = (r.UnparsedAddress || '').split(',')[0].trim();
    if (!street) continue;
    const label = `${street}, ${r.City}`;
    if (!seen.has(label)) {
      seen.add(label);
      suggestions.push(label);
      if (suggestions.length >= 3) break;
    }
  }
  return suggestions;
}

/** Rough degree offsets for a radius in km, used to build a lat/long bounding box. */
function radiusToDegrees(radiusKm, latitude) {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((latitude * Math.PI) / 180) || 1);
  return { latDelta, lonDelta };
}

function daysAgoIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Forward Sortation Area — the first 3 characters of a Canadian postal code
// (e.g. "N2R" from "N2R 0B4"). Ampre doesn't reliably populate Latitude/
// Longitude (never observed populated on any listing we've queried) or
// CityRegion (populated for GTA/Toronto boards, null for Kitchener-Waterloo),
// so FSA is the fallback neighbourhood-level proxy for boards without CityRegion.
function postalFsa(postalCode) {
  if (!postalCode) return null;
  const compact = postalCode.replace(/\s+/g, '');
  return compact.length >= 3 ? compact.slice(0, 3) : null;
}

/** Returns bucket values within `radius` steps of `value` in `orderedList`, or just [value] if not found (can't widen an unrecognized bucket format — e.g. condo-style "500-599" granularity not in the standard list). */
function widenBucketSet(orderedList, value, radius) {
  const idx = orderedList.indexOf(value);
  if (idx === -1) return [value];
  const lo = Math.max(0, idx - radius);
  const hi = Math.min(orderedList.length - 1, idx + radius);
  return orderedList.slice(lo, hi + 1);
}

function inSetFilter(field, values) {
  return `(${values.map((v) => `${field} eq '${escapeODataString(v)}'`).join(' or ')})`;
}

/**
 * Find recently sold comparables for a resolved subject property, always
 * scoped to the subject's own neighbourhood — never widened to a whole city.
 *
 * Hard requirements, never relaxed: sale (not lease) status, property type,
 * property subtype, neighbourhood (CityRegion or postal FSA).
 *
 * Progressively relaxed, in order, only as needed to reach `limit` comps —
 * each step widens rather than drops where possible, to stay as close to the
 * subject as it can: size range (LivingAreaRange bucket) → age range
 * (ApproximateAge bucket) → beds → baths → recency window (90 → 180 → 365
 * days) → size dropped entirely → age dropped entirely → beds/baths dropped.
 *
 * BuildingAreaTotal (exact sqft) and YearBuilt are almost never populated in
 * this feed, so the bucketed LivingAreaRange/ApproximateAge fields are used
 * instead of numeric ranges.
 *
 * @param {Object|null} subject  a resolved property from searchByAddress (or null)
 * @param {{ radiusKm?: number, daysBack?: number, limit?: number }} [opts]
 * @returns {Promise<{ subject: Object|null, comps: Array<Object>, relaxationSteps: string[] }>}
 */
export async function getSoldComps(subject, opts = {}) {
  const { radiusKm = 1.5, daysBack = 90, limit = 5 } = opts;

  // Nothing to compare against — comps are always relative to a resolved subject.
  if (!subject) return { subject: null, comps: [], relaxationSteps: [] };

  const hardBase = [`StandardStatus eq 'Closed'`, `TransactionType eq 'For Sale'`];
  if (subject.propertyType) hardBase.push(`PropertyType eq '${escapeODataString(subject.propertyType)}'`);
  if (subject.propertySubType) hardBase.push(`PropertySubType eq '${escapeODataString(subject.propertySubType)}'`);

  // Neighbourhood constraint — hard requirement, never widened to city-wide.
  // Priority: real coordinates (radius) > CityRegion (GTA/Toronto boards
  // reliably populate this, e.g. "Bay Street Corridor") > postal FSA prefix
  // (fallback for boards like Kitchener-Waterloo where CityRegion is null).
  let geoParts = null;
  if (subject.latitude != null && subject.longitude != null) {
    const { latDelta, lonDelta } = radiusToDegrees(radiusKm, subject.latitude);
    geoParts = [
      `Latitude ge ${subject.latitude - latDelta}`,
      `Latitude le ${subject.latitude + latDelta}`,
      `Longitude ge ${subject.longitude - lonDelta}`,
      `Longitude le ${subject.longitude + lonDelta}`,
    ];
  } else if (subject.cityRegion) {
    geoParts = [`CityRegion eq '${escapeODataString(subject.cityRegion)}'`];
    if (subject.city) geoParts.push(`City eq '${escapeODataString(subject.city)}'`);
  } else {
    const fsa = postalFsa(subject.postalCode);
    if (fsa) geoParts = [`startswith(PostalCode,'${escapeODataString(fsa)}')`];
  }

  // No coordinates, no CityRegion, no postal code — can't confirm the
  // neighbourhood, so don't guess by falling back to the whole city.
  if (!geoParts) return { subject, comps: [], relaxationSteps: ['no neighbourhood signal available — returned no comps rather than guessing'] };

  const hard = [...hardBase, ...geoParts];

  // Mutable relaxation state, widened step by step until enough comps are found.
  const state = {
    daysBack,
    sizeRadius: subject.livingAreaRange ? 0 : null, // null = no size constraint possible/used
    ageRadius: subject.approxAge ? 0 : null,
    bedsRadius: subject.beds != null ? 0 : null,
    bathsRadius: subject.baths != null ? 0 : null,
  };

  function buildFilter() {
    const parts = [...hard, `PurchaseContractDate ge ${daysAgoIso(state.daysBack)}`];
    if (state.sizeRadius != null) {
      const values = widenBucketSet(LIVING_AREA_RANGE_ORDER, subject.livingAreaRange, state.sizeRadius);
      parts.push(inSetFilter('LivingAreaRange', values));
    }
    if (state.ageRadius != null) {
      const values = widenBucketSet(APPROX_AGE_ORDER, subject.approxAge, state.ageRadius);
      parts.push(inSetFilter('ApproximateAge', values));
    }
    if (state.bedsRadius != null) {
      parts.push(`BedroomsTotal ge ${subject.beds - state.bedsRadius}`, `BedroomsTotal le ${subject.beds + state.bedsRadius}`);
    }
    if (state.bathsRadius != null) {
      parts.push(`BathroomsTotalInteger ge ${subject.baths - state.bathsRadius}`, `BathroomsTotalInteger le ${subject.baths + state.bathsRadius}`);
    }
    return parts.join(' and ');
  }

  // Each step widens `state` one notch. Stop widening once we've run out of steps.
  const relaxationLadder = [
    { note: 'exact match on size range, age range, beds, and baths', apply: () => {} },
    { note: 'widened size range by one bucket', apply: () => { if (state.sizeRadius != null) state.sizeRadius = 1; } },
    { note: 'widened age range by one bucket', apply: () => { if (state.ageRadius != null) state.ageRadius = 1; } },
    { note: 'widened beds to ±1', apply: () => { if (state.bedsRadius != null) state.bedsRadius = 1; } },
    { note: 'widened baths to ±1', apply: () => { if (state.bathsRadius != null) state.bathsRadius = 1; } },
    { note: 'widened recency window to 180 days', apply: () => { state.daysBack = Math.max(state.daysBack, 180); } },
    { note: 'widened size range by two buckets', apply: () => { if (state.sizeRadius != null) state.sizeRadius = 2; } },
    { note: 'dropped age range constraint', apply: () => { state.ageRadius = null; } },
    { note: 'dropped size range constraint', apply: () => { state.sizeRadius = null; } },
    { note: 'widened recency window to 365 days', apply: () => { state.daysBack = Math.max(state.daysBack, 365); } },
    { note: 'dropped beds/baths constraints (kept type, subtype, and neighbourhood)', apply: () => { state.bedsRadius = null; state.bathsRadius = null; } },
  ];

  // Aim for a slightly larger pool than `limit` so a later qualitative
  // review (reading remarks) has real choices to drop a weak comp and still
  // land on `limit` good ones, rather than being forced to keep exactly
  // `limit` regardless of fit.
  const poolTarget = limit + 3;

  const pool = new Map(); // dedupe by ListingKey across steps
  const relaxationSteps = [];

  for (const step of relaxationLadder) {
    step.apply();
    const filter = buildFilter();
    const records = await queryAmpre(filter, COMP_SELECT, { top: Math.max(poolTarget * 2, 10), orderby: 'PurchaseContractDate desc' });
    for (const r of records) {
      if (!pool.has(r.ListingKey)) pool.set(r.ListingKey, r);
    }
    relaxationSteps.push(`${step.note} → ${pool.size} candidate(s) so far`);
    if (pool.size >= poolTarget) break;
  }

  const comps = Array.from(pool.values())
    .map(normalizeComp)
    .sort((a, b) => (b.pendingDate || '').localeCompare(a.pendingDate || ''))
    .slice(0, poolTarget);

  return { subject, comps, relaxationSteps };
}
