/**
 * Compliance layer for client-facing vs realtor-facing data access.
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
const CLIENT_STRIP_FIELDS = [
  'ownerName', 'sellerName', 'privateRemarks', 'agentRemarks',
  'showingInstructions', 'showingHistory', 'showingRequirements',
  'listAgentName', 'listAgentEmail', 'listAgentPhone',
  'coListAgentName', 'coListAgentEmail', 'coListAgentPhone',
  'occupantType',
];

function stripFields(obj, fields) {
  if (!obj) return obj;
  const clone = { ...obj };
  for (const f of fields) delete clone[f];
  return clone;
}

/**
 * Client-tier view: strips seller/agent identity, private remarks, and showing
 * history. Public property details (including marketing description) pass through.
 * @param {{ subject: Object|null, comps: Array<Object> }} data
 * @returns {{ subject: Object|null, comps: Array<Object> }}
 */
export function filterClientData({ subject, comps }) {
  return {
    subject: stripFields(subject, CLIENT_STRIP_FIELDS),
    comps: (comps || []).map((c) => stripFields(c, CLIENT_STRIP_FIELDS)),
  };
}

/**
 * Realtor-tier view: full, unfiltered data access.
 * @param {{ subject: Object|null, comps: Array<Object> }} data
 * @returns {{ subject: Object|null, comps: Array<Object> }}
 */
export function filterRealtorData({ subject, comps }) {
  return { subject, comps: comps || [] };
}

const STANDARD_DISCLAIMER = 'This information is generated from MLS data via the Ampre VOW feed and is provided for general informational purposes only. It is not a formal appraisal, Comparative Market Analysis (CMA), or legal, financial, or tax advice. Data accuracy is not guaranteed — verify all details with your REALTOR® before making decisions. E&OE.';

/** @returns {string} the standard disclaimer appended to every chat response. */
export function generateDisclaimer() {
  return STANDARD_DISCLAIMER;
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
