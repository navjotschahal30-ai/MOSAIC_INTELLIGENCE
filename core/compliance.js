/**
 * Compliance layer for the three data-access tiers: client, agent, realtor.
 * See /legal-compliance.md for the full rule set and rationale — this module
 * implements deliberately conservative defaults pending legal review.
 */

// Stripped for the client tier even if present on the normalized object.
// Public marketing remarks (PublicRemarks, mapped to `remarks`) are NOT
// stripped — property details and description are allowed for clients.
// Only seller/agent identity, private remarks, and showing history are
// restricted. Deliberately broader than what core/vow-query.js currently
// selects, so any future field addition (owner name, private remarks, agent
// contact) is stripped by default rather than opt-in.
//
// `brokerage` (the listing brokerage/ListOfficeName) must NEVER be added
// here — MLS attribution rules require it to always be shown, for both
// tiers. See ensureBrokerage() below, which re-asserts it regardless.
const CLIENT_STRIP_FIELDS = [
  'ownerName', 'sellerName', 'privateRemarks', 'agentRemarks',
  'showingInstructions', 'showingHistory', 'showingRequirements', 'showingAppointments',
  'offerRemarks',
  'listAgentName', 'listAgentEmail', 'listAgentPhone',
  'coListAgentName', 'coListAgentEmail', 'coListAgentPhone',
  'occupantType',
];

// Stripped for the 'agent' tier — verified external REALTORS® (brokerage name +
// RECO license captured at registration, see routes/auth.js) testing the
// product. Only seller/owner identity is restricted; everything else
// (private/realtor remarks, showing instructions, offer remarks, listing
// agent contact) is a normal part of an agent's job and is not held back.
const AGENT_STRIP_FIELDS = ['ownerName', 'sellerName'];

function stripFields(obj, fields) {
  if (!obj) return obj;
  const clone = { ...obj };
  for (const f of fields) delete clone[f];
  return clone;
}

// MLS/VOW attribution rules require the listing brokerage to always be shown
// alongside listing data. This re-asserts `brokerage` on the object (immune
// to any future CLIENT_STRIP_FIELDS mistake) and flags when it's missing
// from the source data so callers/Claude know not to fabricate it.
function ensureBrokerage(obj) {
  if (!obj) return obj;
  const brokerage = obj.brokerage || null;
  return brokerage
    ? { ...obj, brokerage }
    : { ...obj, brokerage: null, brokerageMissing: true };
}

/**
 * Client-tier view: strips seller/agent identity, private remarks, and showing
 * history. Public property details (including marketing description) pass through.
 * The listing brokerage is always included (see ensureBrokerage).
 * @param {{ subject: Object|null, comps: Array<Object>, similarListings?: Array<Object> }} data
 * @returns {{ subject: Object|null, comps: Array<Object>, similarListings: Array<Object> }}
 */
export function filterClientData({ subject, comps, similarListings }) {
  return {
    subject: ensureBrokerage(stripFields(subject, CLIENT_STRIP_FIELDS)),
    comps: (comps || []).map((c) => ensureBrokerage(stripFields(c, CLIENT_STRIP_FIELDS))),
    similarListings: (similarListings || []).map((l) => ensureBrokerage(stripFields(l, CLIENT_STRIP_FIELDS))),
  };
}

/**
 * Agent-tier view: full data except seller/owner identity. For verified
 * external REALTORS® (brokerage + RECO license captured at registration)
 * testing the product — not Team MOSAIC staff, so this is deliberately one
 * notch below the realtor tier, not equal to it.
 * @param {{ subject: Object|null, comps: Array<Object>, similarListings?: Array<Object> }} data
 * @returns {{ subject: Object|null, comps: Array<Object>, similarListings: Array<Object> }}
 */
export function filterAgentData({ subject, comps, similarListings }) {
  return {
    subject: ensureBrokerage(stripFields(subject, AGENT_STRIP_FIELDS)),
    comps: (comps || []).map((c) => ensureBrokerage(stripFields(c, AGENT_STRIP_FIELDS))),
    similarListings: (similarListings || []).map((l) => ensureBrokerage(stripFields(l, AGENT_STRIP_FIELDS))),
  };
}

/**
 * Realtor-tier view: full, unfiltered data access. The listing brokerage is
 * always included (see ensureBrokerage).
 * @param {{ subject: Object|null, comps: Array<Object>, similarListings?: Array<Object> }} data
 * @returns {{ subject: Object|null, comps: Array<Object>, similarListings: Array<Object> }}
 */
export function filterRealtorData({ subject, comps, similarListings }) {
  return {
    subject: ensureBrokerage(subject),
    comps: (comps || []).map(ensureBrokerage),
    similarListings: (similarListings || []).map(ensureBrokerage),
  };
}

// Short line shown directly in the footer — the "Legal" link opens the full
// text below. Kept intentionally brief; the fuller disclosures (brokerage
// identity, CREA trademarks, non-solicitation) live in FULL_LEGAL_TEXT so
// they're still present but don't clutter every screen.
const SHORT_DISCLAIMER = 'This chat is AI-generated using TRREB MLS® data and is not professional advice, an appraisal, or a CMA.';

const FULL_LEGAL_TEXT = 'Mosaic Real Estate Intelligence is an AI assistant built for Navjot Singh, REALTOR® — Team Mosaic, eXp Realty, Brokerage. Responses are generated by artificial intelligence, may contain errors, and should be independently verified; this is not a formal appraisal, Comparative Market Analysis (CMA), or professional advice. Property information is sourced from TRREB MLS® data, is deemed reliable but not guaranteed, and is subject to change without notice. Not intended to solicit properties currently listed for sale, or buyers/sellers already under contract with another brokerage. The trademarks REALTOR®, REALTORS®, and the REALTOR® logo are controlled by The Canadian Real Estate Association (CREA) and identify real estate professionals who are members of CREA. The trademarks MLS®, Multiple Listing Service®, and associated logos are owned by CREA and identify the quality of services provided by real estate professionals who are members of CREA. See our privacy policy for details.';

// Placeholder destination — the page may not exist yet.
const PRIVACY_POLICY_URL = 'https://navjotchahal.ca/privacy';

/** @returns {string} the short disclaimer line shown directly in the footer (see routes/disclaimer.js). */
export function generateDisclaimer() {
  return SHORT_DISCLAIMER;
}

/** @returns {string} the full legal text shown in the "Legal" modal, triggered from the footer. */
export function generateLegalText() {
  return FULL_LEGAL_TEXT;
}

/** @returns {string} the privacy policy URL referenced by the disclaimer. */
export function getPrivacyPolicyUrl() {
  return PRIVACY_POLICY_URL;
}

// Heuristic, keyword/pattern based — not a substitute for legal review.
// Flags language that reads as solicitation, guaranteed outcomes, or
// disparagement of a client's existing representation (RECO non-solicitation
// and no-guarantee norms).
const SOLICITATION_PATTERNS = [
  /\bsign (with us|now)\b/i,
  /\bguarantee[sd]?\b/i,
  /\bbetter than your (current|existing) (agent|realtor)\b/i,
  /\bswitch (agents|realtors|brokerages)\b/i,
  /\bno obligation to your (current|existing) (agent|realtor)\b/i,
  /\bexclusive representation\b/i,
  /\bwe can beat any offer\b/i,
];

/**
 * Heuristic check for solicitation / guaranteed-outcome language in a response.
 * @param {string} text
 * @returns {{ compliant: boolean, flags: string[] }}
 */
export function validateSolicitation(text) {
  const flags = SOLICITATION_PATTERNS
    .filter((re) => re.test(text || ''))
    .map((re) => re.source);
  return { compliant: flags.length === 0, flags };
}
