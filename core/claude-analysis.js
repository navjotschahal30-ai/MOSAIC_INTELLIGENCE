/**
 * Claude Sonnet wiring for property Q&A.
 * Takes VOW subject-property + comps data (see core/vow-query.js) and answers
 * natural-language questions grounded only in that data.
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are the property analysis assistant for Mosaic Real Estate Intelligence, built for Team MOSAIC (eXp Realty, Kitchener-Waterloo-Cambridge, Ontario).

You answer questions about a specific subject property using only the MLS data provided in the [PROPERTY DATA] block below. This data comes from the Ampre VOW feed (TRREB/local board). That block also carries an [ACCESS TIER] marker — "client", "agent", or "realtor" — telling you who you're talking to:
- **client** — the realtor's own client. Public property details only; seller/agent identity, private remarks, showing info, and offer remarks are stripped before they ever reach you.
- **agent** — a verified external REALTOR® (brokerage + RECO license captured at registration) testing or using the product. Gets everything a realtor sees — private/realtor remarks, showing appointments/requirements, offer remarks, listing agent contact — EXCEPT seller/owner identity, which is stripped the same as for clients.
- **realtor** — Navjot / Team MOSAIC staff. Full unfiltered access.

## Data grounding
- Ground every answer in the provided data. Do not invent listing details, prices, or comps that are not present.
- If the data needed to answer isn't in [PROPERTY DATA], say so plainly and suggest what info would help.
- When asked about value or pricing, reason from the sold comparables (ClosePrice, CloseDate, beds/baths/sqft) rather than giving a bare guess.
- When asked about nearby schools, parks, transit, or other neighbourhood amenities, use the [NEARBY AMENITIES] block if present — it's sourced from OpenStreetMap, distances are straight-line (not walking/driving), and it only appears when the question warrants the lookup. If it's absent, say amenity data wasn't pulled for this question rather than guessing at what's nearby from general knowledge.
- When asked for similar/other listings or alternatives, use the [SIMILAR ACTIVE LISTINGS] block if present — these are currently-for-sale properties, not sold comparables, and are already shown to the user as clickable links in the UI, so don't repeat the raw address/price list; just briefly characterize the options in a sentence or two (e.g. "there are 2 similar homes on the market nearby, one a bit larger and pricier"). If the block is absent or empty, say nothing similar turned up nearby rather than inventing options.

## Ask a clarifying question when it would sharpen the answer
The user is very often physically at the property while using this — walking through a showing, standing in the basement, looking at the roof. That means you can ask them things the MLS remarks don't cover or might be stale on. When something material to the valuation is ambiguous or missing from the data (e.g. whether a basement is actually finished, the real condition of a renovation the remarks only vaguely describe, whether a "legal duplex" claim looks accurate in person), ask ONE short, focused question before finalizing your answer — multiple-choice is often clearest (e.g. "Is the basement finished? A) Fully finished B) Unfinished C) Partially finished"). Don't ask when the data already answers it, and don't stack more than one question in a single reply.

## Compliance guardrails — do not violate these
- Always include the listing brokerage name when displaying property details — e.g. "123 Main Street, Kitchener — Listed by [Brokerage Name]." Do this the first time you mention a property in your response. If the data shows the brokerage as missing (BrokerageMissing in the data block), say brokerage information isn't available for this listing — never guess or invent a brokerage name.
- Property details are fine to share freely with clients: price history, sold prices and dates, days on market, beds/baths/sqft, and the public marketing description. Only seller/agent identity, private (non-public) remarks, and showing history are restricted for the client tier — and those are already stripped from the data you're given under [ACCESS TIER: client]. Don't withhold public property details out of over-caution.
- Under [ACCESS TIER: agent], private/realtor remarks, showing appointments/requirements, and offer remarks are legitimate working data for a REALTOR® and should be answered normally when asked — do not treat them as restricted the way you would under [ACCESS TIER: client].
- Never disclose seller/owner identity or seller contact information under [ACCESS TIER: client] or [ACCESS TIER: agent] — these fields have already been stripped from the data for both tiers; do not speculate about or attempt to reconstruct them, even if asked directly.
- Never state or estimate commission amounts, splits, or fees. If asked, say commission is set by contract between the parties and to consult the listing brokerage.
- Never give legal, tax, financing, or formal appraisal advice. Valuation commentary is an informational estimate only, not a Comparative Market Analysis (CMA) or appraisal — say so if the user seems to be treating it as one.
- Fair housing: never make or imply a suitability judgment based on race, religion, ethnicity, family status, disability, sex, or any other protected characteristic under the Ontario Human Rights Code. If a question implies this (e.g. "is this a good area for [group]"), decline that framing and answer with objective, non-demographic facts only.
- Power of sale, estate, or court-ordered sales: you may acknowledge this factually if it's present in the data (e.g. "this is listed as a power of sale property") but do not explain the legal mechanics, speculate about the seller's financial distress, or give procedural guidance — direct the client to the realtor for details.
- Never encourage a user to leave, distrust, or bypass their current representing realtor, and never claim exclusive representation on Navjot's or Team MOSAIC's behalf.
- A standard legal disclaimer is automatically appended to your response after you answer — do not write your own disclaimer or repeat these caveats verbatim, but keep your language appropriately hedged (e.g. "likely", "based on available data") rather than stating definitive conclusions.

## Style
- Be direct and concise — 2-5 sentences unless the user asks for a detailed breakdown.
- No exclamation marks, no filler openers ("Great question!"), no em dashes.
- Plain prose only — no markdown (no #, **, bullet lists, or tables). The address, price, and comps are already shown separately in the UI, so don't repeat the raw comp list; reason about it in sentences instead.`;

function formatMoney(n) {
  return n != null ? `$${Number(n).toLocaleString('en-CA')}` : 'n/a';
}

// Yes/no MLS fields come back as booleans (or null when the field was simply
// never populated) — null should read as unknown, not as a false "No".
function formatYesNo(v) {
  if (v == null) return 'n/a';
  return v ? 'Yes' : 'No';
}

function formatProperty(p) {
  if (!p) return 'No subject property data available.';
  return [
    `Address: ${p.address}${p.city ? `, ${p.city}` : ''}`,
    `Listing Brokerage: ${p.brokerage || 'MISSING — do not guess or omit; tell the user brokerage info is unavailable for this listing'}`,
    `Status: ${p.status || 'n/a'}`,
    `List price: ${formatMoney(p.listPrice)}`,
    p.closePrice ? `Sold price: ${formatMoney(p.closePrice)} (closed ${p.closeDate})` : null,
    `Beds/Baths: ${p.beds ?? 'n/a'} / ${p.baths ?? 'n/a'}`,
    `Sqft: ${p.sqft ?? 'n/a'}${p.livingAreaRange ? ` (range: ${p.livingAreaRange})` : ''}`,
    `Type: ${p.propertySubType || p.propertyType || 'n/a'}`,
    `Year built: ${p.yearBuilt ?? 'n/a'}${p.approxAge ? ` (approx. age bucket: ${p.approxAge})` : ''}`,
    `Lot: ${p.lotWidth ?? '?'} x ${p.lotDepth ?? '?'} ft${p.lotSizeArea ? `, ${p.lotSizeArea} ${p.lotSizeUnits || ''}`.trimEnd() : ''}${p.lotSizeRangeAcres ? ` (range: ${p.lotSizeRangeAcres})` : ''}${p.lotShape ? `, shape: ${p.lotShape}` : ''}${p.lotFeatures ? `, features: ${p.lotFeatures}` : ''}`,
    `Basement: ${p.basement || 'n/a'}${p.basementFinished != null ? ` (finished: ${formatYesNo(p.basementFinished)})` : ''}`,
    `Roof: ${p.roof || 'n/a'} — MLS does not track roof/shingle age as its own field; only answer on shingle age if the remarks happen to mention it, otherwise say it isn't in the data`,
    p.foundationDetails ? `Foundation: ${p.foundationDetails}` : null,
    p.constructionMaterials ? `Construction materials: ${p.constructionMaterials}` : null,
    p.exteriorFeatures ? `Exterior features: ${p.exteriorFeatures}` : null,
    `Heating: ${p.heatType || 'n/a'}${p.heatSource ? ` (source: ${p.heatSource})` : ''}`,
    `Cooling: ${p.cooling || 'n/a'}`,
    `Fireplace: ${formatYesNo(p.fireplace)}${p.fireplacesTotal ? ` (${p.fireplacesTotal})` : ''}`,
    p.poolFeatures ? `Pool: ${p.poolFeatures}` : null,
    p.waterfront != null ? `Waterfront: ${formatYesNo(p.waterfront)}` : null,
    p.sewer ? `Sewer: ${p.sewer}` : null,
    `Water: ${p.water || 'n/a'}${p.waterSource ? ` (source: ${p.waterSource})` : ''}`,
    p.utilities ? `Utilities: ${p.utilities}` : null,
    p.uffi ? `UFFI (urea formaldehyde foam insulation): ${p.uffi}` : null,
    `Parking (garage/drive/total): ${p.garageParkingSpaces ?? 'n/a'} / ${p.driveParkingSpaces ?? 'n/a'} / ${p.totalParkingSpaces ?? 'n/a'}${p.parkingFeatures ? ` — ${p.parkingFeatures}` : ''}`,
    `Kitchens: ${p.kitchensTotal ?? 'n/a'}`,
    p.unitNumber ? `Unit number: ${p.unitNumber}` : null,
    p.condoCorpNumber ? `Condo corporation number: ${p.condoCorpNumber}` : null,
    p.locker ? `Locker: ${p.locker}${p.lockerNumber ? ` (#${p.lockerNumber})` : ''}` : null,
    p.condoFee != null ? `Condo/maintenance fee: ${formatMoney(p.condoFee)}${p.condoFeeFrequency ? `/${p.condoFeeFrequency}` : ''}${p.condoFeeIncludes ? ` — includes: ${p.condoFeeIncludes}` : ''}` : null,
    p.taxAnnualAmount != null ? `Annual property tax: ${formatMoney(p.taxAnnualAmount)}${p.taxYear ? ` (${p.taxYear})` : ''}` : null,
    p.inclusions ? `Inclusions: ${p.inclusions}` : null,
    p.exclusions ? `Exclusions: ${p.exclusions}` : null,
    p.rentalItems ? `Rental items (not owned, monthly cost applies): ${p.rentalItems}${p.rentalItemsMonthlyCost ? ` — cost: ${p.rentalItemsMonthlyCost}` : ''}` : null,
    p.remarksExtras ? `Extras: ${p.remarksExtras}` : null,
    p.possessionType || p.possessionDate ? `Possession: ${p.possessionType || 'n/a'}${p.possessionDate ? ` (${p.possessionDate})` : ''}` : null,
    p.zoning ? `Zoning: ${p.zoning}` : null,
    p.remarks ? `Remarks: ${p.remarks}` : null,
    // Agent-to-agent / non-public fields — only present when userType is
    // 'agent' or 'realtor' (stripped from the data before it reaches this
    // function for client tier, see core/compliance.js).
    p.privateRemarks ? `Private/realtor remarks (agent-to-agent, not public): ${p.privateRemarks}` : null,
    p.showingAppointments ? `Showing appointments (how to book): ${p.showingAppointments}` : null,
    p.showingRequirements ? `Showing requirements: ${p.showingRequirements}` : null,
    p.offerRemarks ? `Offer remarks: ${p.offerRemarks}` : null,
    p.source === 'ddf' ? `Data source: realtor.ca DDF national feed${p.boardName ? ` (originating board: ${p.boardName})` : ''} — a narrower field set than our primary MLS feed; fields not listed above (rental items, possession, condo corp #, exclusions, etc.) are not available for this listing and should be reported as not in the data rather than guessed.` : null,
  ].filter(Boolean).join('\n');
}

function formatComps(comps) {
  if (!comps || comps.length === 0) return 'No sold comparables available.';
  return comps
    .map((c) => `- ${c.address}${c.city ? `, ${c.city}` : ''} | ${formatMoney(c.closePrice)} | pending/sold ${c.pendingDate || c.closeDate || 'n/a'} | ${c.beds ?? '?'}bd/${c.baths ?? '?'}ba | size ${c.livingAreaRange || c.sqft || '?'} | age ${c.approxAge || '?'} | Brokerage: ${c.brokerage || 'MISSING'}${c.curationNote ? ` | Note: ${c.curationNote}` : ''}`)
    .join('\n');
}

// Active listings, unlike sold comps, carry a real live link (resolved via
// Lofty — see core/lofty-listing-link.js) since they're still on the market
// and Lofty's public site actually indexes them.
function formatSimilarListings(similarListings) {
  if (!similarListings || similarListings.length === 0) return null;
  return similarListings
    .map((l) => `- ${l.address}${l.city ? `, ${l.city}` : ''} | ${formatMoney(l.listPrice)} | ${l.beds ?? '?'}bd/${l.baths ?? '?'}ba | size ${l.livingAreaRange || l.sqft || '?'} | Brokerage: ${l.brokerage || 'MISSING'}${l.url ? ` | Link: ${l.url}` : ''}`)
    .join('\n');
}

// amenities: { [category]: { label, places: Array<{ name, type, distanceMeters }> } } | null
// See core/amenities.js — OSM-based (Nominatim + Overpass), no Google API.
function formatAmenities(amenities) {
  if (!amenities) return null;
  const lines = Object.values(amenities)
    .filter((cat) => cat.places.length > 0)
    .map((cat) => `${cat.label}: ${cat.places.map((p) => `${p.name} (${p.distanceMeters}m)`).join(', ')}`);
  return lines.length > 0 ? lines.join('\n') : 'No nearby amenities found in OpenStreetMap data for this location.';
}

function buildPropertyDataBlock({ subject, comps, similarListings, userType, amenities }) {
  const amenitiesText = formatAmenities(amenities);
  const amenitiesBlock = amenitiesText ? `\n\n[NEARBY AMENITIES — straight-line distance, OpenStreetMap data]\n${amenitiesText}` : '';
  const similarText = formatSimilarListings(similarListings);
  const similarBlock = similarText ? `\n\n[SIMILAR ACTIVE LISTINGS — currently for sale, not sold comparables]\n${similarText}` : '';
  return `[ACCESS TIER: ${userType}]\n\n[PROPERTY DATA]\n\nSubject property:\n${formatProperty(subject)}\n\nSold comparables:\n${formatComps(comps)}${similarBlock}${amenitiesBlock}`;
}

/**
 * Answer a question about a property using Claude Sonnet, grounded in VOW data.
 * @param {{ subject: Object|null, comps: Array<Object>, similarListings?: Array<Object>, question: string, history?: Array<{role:string, content:string}>, userType?: 'client'|'agent'|'realtor', amenities?: Object|null }} params
 * @returns {Promise<string>}
 */
export async function answerPropertyQuestion({ subject, comps, similarListings = null, question, history = [], userType = 'client', amenities = null }) {
  const messages = [
    ...history,
    { role: 'user', content: `${buildPropertyDataBlock({ subject, comps, similarListings, userType, amenities })}\n\nQuestion: ${question}` },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages,
  });

  return response.content[0]?.text?.trim() || "I couldn't generate an answer for that — try rephrasing the question.";
}

function curationSystemPrompt(limit) {
  return `You are a real estate comp analyst. You're given a subject property and a pool of structurally-similar closed sales (already filtered by neighbourhood, property type/subtype, and roughly matching size/age/beds/baths). Your job is to read each one's remarks — the free-text marketing description — and judge which are genuinely comparable, the way an experienced agent would when hand-picking comps.

Look for meaningful mismatches the structural filters can't catch: a fully renovated subject vs. a "sold as-is, needs full gut reno" comp; a legal duplex/income suite the comps don't have (or vice versa); a comp described as a teardown, fixer-upper, or having major deferred maintenance; a subject with a finished walkout basement vs. comps that are unfinished; waterfront/ravine/conservation lots vs. standard lots; custom-built vs. builder-standard. Also weigh occupant type, parking, and kitchen count where the remarks or data reveal something structurally relevant (e.g. a legal second unit implying 2 kitchens).

Rank the candidates best-to-worst as real comps for this specific subject. Exclude any that are poor comps due to a meaningful mismatch you can identify from the remarks — but don't exclude just because a comp isn't a perfect match; some deviation is expected and normal, since these are meant to be REAL comps not clones. Keep at least one comp if any reasonable one exists, even if imperfect — only return zero if truly nothing in the pool is defensible as a comp.

Return ONLY valid JSON, no other text, in this exact shape:
{"selected": [{"id": "<candidate id>", "note": "<one short phrase — why it's a fair comp, or what to weigh, e.g. 'similar size/age, fully renovated kitchen matches subject'>"}]}

Order "selected" best comp first. Include at most ${limit} entries.`;
}

/**
 * Read remarks on a candidate comp pool and select/rank the best ones as real
 * comps for the subject, the way an experienced agent would — catching
 * mismatches (renovation status, legal suites, lot character) that structural
 * filters (size/age/beds/baths buckets) can't see.
 * @param {{ subject: Object, candidates: Array<Object>, limit: number }} params
 * @returns {Promise<Array<Object>>} the selected comps (subset/reorder of candidates), each with a `curationNote` field, capped at `limit`
 */
export async function curateComps({ subject, candidates, limit }) {
  if (!candidates || candidates.length === 0) return [];

  const subjectBlock = [
    `Address: ${subject.address}`,
    `Beds/Baths: ${subject.beds ?? 'n/a'} / ${subject.baths ?? 'n/a'}`,
    `Size range: ${subject.livingAreaRange || 'n/a'}`,
    `Age range: ${subject.approxAge || 'n/a'}`,
    `Occupant type: ${subject.occupantType || 'n/a'}`,
    `Parking (garage/drive/total): ${subject.garageParkingSpaces ?? 'n/a'} / ${subject.driveParkingSpaces ?? 'n/a'} / ${subject.totalParkingSpaces ?? 'n/a'}`,
    `Kitchens: ${subject.kitchensTotal ?? 'n/a'}`,
    `Remarks: ${subject.remarks || 'none available'}`,
  ].join('\n');

  const candidatesBlock = candidates.map((c) => [
    `id: ${c.id}`,
    `Address: ${c.address}`,
    `Sold: ${formatMoney(c.closePrice)}, pending ${c.pendingDate || c.closeDate || 'n/a'}`,
    `Beds/Baths: ${c.beds ?? 'n/a'} / ${c.baths ?? 'n/a'}`,
    `Size range: ${c.livingAreaRange || 'n/a'}`,
    `Age range: ${c.approxAge || 'n/a'}`,
    `Occupant type: ${c.occupantType || 'n/a'}`,
    `Parking (garage/drive/total): ${c.garageParkingSpaces ?? 'n/a'} / ${c.driveParkingSpaces ?? 'n/a'} / ${c.totalParkingSpaces ?? 'n/a'}`,
    `Kitchens: ${c.kitchensTotal ?? 'n/a'}`,
    `Remarks: ${c.remarks || 'none available'}`,
  ].join('\n')).join('\n\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: curationSystemPrompt(limit),
    messages: [{ role: 'user', content: `SUBJECT:\n${subjectBlock}\n\nCANDIDATES:\n\n${candidatesBlock}` }],
  });

  const raw = response.content[0]?.text?.trim() || '{"selected":[]}';
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim());
  } catch {
    // Curation is a refinement step, not the source of truth — if parsing
    // fails, fall back to the structural pool rather than losing all comps.
    return candidates.slice(0, limit);
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const selected = (parsed.selected || [])
    .map((s) => {
      const comp = byId.get(s.id);
      return comp ? { ...comp, curationNote: s.note || null } : null;
    })
    .filter(Boolean)
    .slice(0, limit);

  return selected.length > 0 ? selected : candidates.slice(0, limit);
}
