/**
 * CREA DDF (RESO Web API) client — nationwide fallback for active-listing
 * search on boards we don't have VOW/Ampre (Cornerstone) approval for yet.
 *
 * DDF has no sold/closed data at all — confirmed against the live
 * $metadata, there is no ClosePrice, CloseDate, or PurchaseContractDate
 * field anywhere in the Property entity. Sold comps always come from
 * core/vow-query.js's getSoldComps regardless of where the subject was
 * found; this module only ever resolves an *active* subject property.
 */

const DDF_TOKEN_URL = 'https://identity.crea.ca/connect/token';
const DDF_API_URL = 'https://ddfapi.realtor.ca/odata/v1/Property';
const DDF_SCOPE = 'DDFApi_Read';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function assertCredentials() {
  const clientId = process.env.DDF_CLIENT_ID;
  const clientSecret = process.env.DDF_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('DDF_CLIENT_ID/DDF_CLIENT_SECRET not set');
  return { clientId, clientSecret };
}

async function getDdfToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt) return cachedToken;

  const { clientId, clientSecret } = assertCredentials();
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: DDF_SCOPE,
  });

  const res = await fetch(DDF_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`DDF token error: ${JSON.stringify(data).slice(0, 300)}`);

  cachedToken = data.access_token;
  // Refresh a minute early so a request never lands right on expiry.
  cachedTokenExpiresAt = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

/**
 * Run a raw OData query against the DDF Property feed.
 * @param {string} filter  OData $filter expression
 * @param {{ top?: number, orderby?: string }} [opts]
 * @returns {Promise<Array<Object>>} raw DDF records
 */
async function queryDdf(filter, opts = {}) {
  const token = await getDdfToken();
  const { top = 25, orderby } = opts;

  const params = { $filter: filter, $top: String(top) };
  if (orderby) params.$orderby = orderby;
  const queryString = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const url = `${DDF_API_URL}?${queryString}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();

  if (!res.ok) throw new Error(`DDF HTTP ${res.status}: ${text.slice(0, 300)}`);

  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`DDF parse error: ${text.slice(0, 200)}`); }

  return data.value ?? [];
}

function escapeODataString(value) {
  return value.replace(/'/g, "''");
}

/** Splits "123 Main Street, Kitchener" into { street, city }. */
function parseAddressInput(addressInput) {
  const parts = addressInput.split(',').map((p) => p.trim()).filter(Boolean);
  const street = parts[0] || addressInput.trim();
  const city = parts.length > 1 ? parts[1] : null;
  return { street, city };
}

function joinList(arr) {
  return Array.isArray(arr) && arr.length > 0 ? arr.join(', ') : null;
}

/**
 * Maps a DDF Property record onto the same shape core/vow-query.js's
 * normalizeProperty produces, so downstream code (compliance filters,
 * formatProperty, the frontend PropertyCard/CompsTable) doesn't need to know
 * which feed a subject came from. DDF's schema is narrower than VOW's —
 * fields it has no equivalent for at all (Exclusions, RentalItems,
 * PossessionDate/Type, CondoCorpNumber, Locker, LivingAreaRange,
 * ApproximateAge, DaysOnMarket, ClosePrice/CloseDate/PurchaseContractDate,
 * split HeatType/HeatSource, and more — confirmed against the live
 * $metadata) are left null rather than guessed.
 */
function normalizeDdfProperty(l) {
  return {
    id: String(l.ListingKey ?? ''),
    address: [l.UnparsedAddress, l.City].filter(Boolean).join(', '),
    city: l.City || null,
    cityRegion: l.CityRegion || null,
    province: l.StateOrProvince || null,
    postalCode: l.PostalCode || null,
    // Deliberately not passing through DDF's real Latitude/Longitude: VOW's
    // getSoldComps() has a geo-radius branch keyed on lat/long that filters
    // the *VOW* sold feed by coordinates — untested in practice because VOW
    // itself never populates them, and confirmed broken against the live
    // Ampre API (rejects Latitude as a filter field: HTTP 400 "Field
    // 'Latitude' not found in query options filter"). Leaving these null
    // routes DDF-sourced subjects through the same CityRegion/postal-FSA
    // comps fallback VOW subjects already use, per "sold comps: no changes."
    latitude: null,
    longitude: null,
    status: l.StandardStatus || null,
    transactionType: null,
    listPrice: Number(l.ListPrice) || null,
    closePrice: null,
    closeDate: null,
    daysOnMarket: null,
    beds: l.BedroomsTotal != null ? Math.round(l.BedroomsTotal) : null,
    baths: l.BathroomsTotalInteger != null ? Math.round(l.BathroomsTotalInteger) : null,
    sqft: l.BuildingAreaTotal != null ? Math.round(l.BuildingAreaTotal)
      : (l.LivingArea != null ? Math.round(l.LivingArea) : null),
    livingAreaRange: null,
    lotWidth: null,
    lotDepth: null,
    lotSizeArea: l.LotSizeArea ?? null,
    lotSizeUnits: l.LotSizeUnits || null,
    lotSizeRangeAcres: null,
    lotFeatures: joinList(l.LotFeatures),
    lotShape: null,
    yearBuilt: l.YearBuilt ?? null,
    approxAge: null,
    propertySubType: l.PropertySubType || null,
    propertyType: null,
    occupantType: null,
    garageParkingSpaces: null,
    driveParkingSpaces: null,
    totalParkingSpaces: l.ParkingTotal ?? null,
    parkingFeatures: joinList(l.ParkingFeatures),
    kitchensTotal: null,
    // Construction & systems
    roof: joinList(l.Roof),
    basement: joinList(l.Basement),
    basementFinished: null,
    foundationDetails: joinList(l.FoundationDetails),
    constructionMaterials: joinList(l.ConstructionMaterials),
    exteriorFeatures: joinList(l.ExteriorFeatures),
    heatType: joinList(l.Heating),
    heatSource: null,
    cooling: joinList(l.Cooling),
    sewer: joinList(l.Sewer),
    water: null,
    waterSource: joinList(l.WaterSource),
    utilities: joinList(l.Utilities),
    uffi: null,
    fireplace: l.FireplaceYN ?? null,
    fireplacesTotal: l.FireplacesTotal ?? null,
    poolFeatures: joinList(l.PoolFeatures),
    waterfront: null,
    // Financial
    taxAnnualAmount: l.TaxAnnualAmount != null ? Number(l.TaxAnnualAmount) : null,
    taxYear: l.TaxYear ?? null,
    condoFee: l.AssociationFee != null ? Number(l.AssociationFee) : null,
    condoFeeFrequency: l.AssociationFeeFrequency || null,
    condoFeeIncludes: joinList(l.AssociationFeeIncludes),
    // Chattels / rentals
    inclusions: l.Inclusions || null,
    exclusions: null,
    rentalItems: null,
    rentalItemsMonthlyCost: null,
    remarksExtras: null,
    // Possession, zoning, condo unit identifiers
    possessionDate: null,
    possessionType: null,
    zoning: l.Zoning || l.ZoningDescription || null,
    condoCorpNumber: null,
    unitNumber: l.UnitNumber || null,
    locker: null,
    lockerNumber: null,
    remarks: l.PublicRemarks || null,
    // DDF's Property entity only carries ListOfficeKey, not the office name
    // itself (that needs a separate Office entity lookup) — left null so
    // ensureBrokerage() in core/compliance.js flags it as missing rather
    // than fabricating a brokerage name.
    brokerage: null,
    source: 'ddf',
    boardName: l.OriginatingSystemName || l.ListAOR || null,
  };
}

/**
 * DDF fallback lookup for an active listing on a board we don't have VOW
 * access to. Only ever searches Active status — this feed has no sold data.
 * @param {string} addressInput  e.g. "123 Main Street, Windsor"
 * @returns {Promise<{ status: 'found', property: Object } | { status: 'ambiguous', candidates: Array<Object> } | { status: 'not_found' }>}
 */
export async function searchByAddressDdf(addressInput) {
  const { street, city } = parseAddressInput(addressInput);
  const streetFilter = `contains(UnparsedAddress,'${escapeODataString(street)}') and StandardStatus eq 'Active'`;

  // Unlike VOW, DDF has no assumed default city — this is a nationwide feed,
  // so an address with no city segment just searches unrestricted.
  const variants = city
    ? [`${streetFilter} and City eq '${escapeODataString(city)}'`, streetFilter]
    : [streetFilter];

  for (const filter of variants) {
    const records = await queryDdf(filter, { top: 5, orderby: 'ModificationTimestamp desc' });
    if (records.length === 0) continue;

    const normalized = records.map(normalizeDdfProperty);
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
