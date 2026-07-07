# Mosaic Real Estate Intelligence — Legal & Compliance Reference

**Status: draft, prepared for legal team review. Not legal advice, and not independently verified against current CREA/OREA/TRREB/RECO/Ampre published materials or Team Mosaic's signed vendor agreement.** See [Section 6](#6-known-gaps--required-legal-verification) before relying on this document.

## 1. Purpose & scope

This document describes the compliance controls implemented in the Mosaic Real Estate Intelligence codebase as of this build, why they exist, and where they're enforced in code. It's a starting point for legal review, not a finished compliance program — Mosaic is a Phase 1 skeleton.

## 2. Data access tiers

Every `/api/chat` request carries a `userType` of `client` or `realtor`. Unset or invalid values default to `client` (fail closed — the more restrictive tier).

| Tier | Who | Data access |
|---|---|---|
| `client` | The realtor's client, using the chat UI directly | Full property details — address, status, list/sold price, close date, days on market, beds, baths, sqft, lot depth, year built, property type, and the public marketing description. **No** seller/agent identity or contact info, private (non-public) remarks, or showing history (see [3.1](#31-seller-privacy)). |
| `realtor` | Navjot / Team MOSAIC staff | Full unfiltered data, including any private remarks. |

Model: what a client can see is closer to a password-protected consumer site (HouseSigma-style) than a fully public one — property history, comps, and details are fine once the user is inside an authenticated, consented session; only seller/agent PII and private-side data stay realtor-only. See the auth gap below — Mosaic doesn't have that authenticated session yet.

Enforced in `core/compliance.js` (`filterClientData`, `filterRealtorData`), called from `routes/chat.js` before data reaches Claude. The tier is also passed into the Claude system prompt as an `[ACCESS TIER]` marker so the model doesn't attempt to reconstruct stripped information from general knowledge.

**Known gap — no authentication exists yet.** The `client`/`realtor` tiering here is a data-shape distinction only; there is no login, no password protection, and no consent capture anywhere in Mosaic today. `userType` is just a request body field — anyone who can reach `/api/chat` can pass `userType: "realtor"` and get full access. Before this is used with real clients, per the "password-protected platform = OK to show more data" model, Mosaic needs an actual authenticated session (even a simple one) that derives `userType` server-side from who's logged in, rather than trusting a client-supplied field.

**Known gap:** `routes/propertySearch.js` and `routes/comps.js` do not yet apply tiering — they return full unfiltered VOW data regardless of caller. The current frontend (`ChatBox.jsx`) only calls `/api/chat`, so this isn't reachable through the UI today, but it's an inconsistency in the API surface that should be closed before those endpoints are used directly by anything client-facing.

## 3. Compliance controls implemented

### 3.1 Seller privacy

`filterClientData` strips a denylist of fields — owner/seller name, private remarks, showing instructions/history, listing and co-listing agent name/email/phone, occupant type — before data reaches the client tier or Claude. The denylist is intentionally broader than what `core/vow-query.js` currently selects from Ampre, so adding a new field later doesn't silently leak it to clients.

Public marketing remarks (`PublicRemarks`, mapped to `remarks`) are **not** stripped — they're already publicly visible on any MLS listing site, and property description is explicitly in-scope for the client tier (price history, comps, and property details including description are fine to show once a client is in an authenticated, consented session — see the "no authentication exists yet" gap in [Section 2](#2-data-access-tiers)).

### 3.2 Agent remarks protection

`PrivateRemarks` (agent-to-agent notes, not currently fetched by `core/vow-query.js`) and any future private/internal-only field are stripped by the same `CLIENT_STRIP_FIELDS` denylist for the client tier, full for realtor tier. This is distinct from 3.1's public remarks, which clients can see.

### 3.3 Commission disclosure

Mosaic does not fetch or store any commission-related field from Ampre (no such field is in `core/vow-query.js`'s select list). The system prompt additionally instructs Claude to never state or estimate commission amounts or splits, and to redirect any such question to "commission is set by contract — consult the listing brokerage."

### 3.4 Fair housing compliance

The system prompt instructs Claude to never make or imply a suitability judgment based on a protected characteristic under the Ontario Human Rights Code (race, religion, ethnicity, family status, disability, sex, etc.), and to decline that framing rather than answer it. This is a prompt-level behavioral control, not a hard filter — see [Section 6](#6-known-gaps--required-legal-verification) on limitations of prompt-based enforcement.

### 3.5 Data retention limits

Mosaic currently has **no database and no cache** — every `/api/property-search`, `/api/comps`, and `/api/chat` request performs a live query against the Ampre VOW feed, and nothing is persisted beyond the request/response lifecycle. Server logs (`console.log`) include the searched address and compliance-check results but not full listing payloads. This means retention limits are, by construction, satisfied today. If caching is added later (e.g. to reduce VOW query volume), it needs an explicit TTL and purge policy consistent with the vendor agreement's data-currency requirements before it ships.

### 3.6 Solicitation restrictions

`validateSolicitation()` in `core/compliance.js` runs a keyword/pattern check against Claude's raw response for language like "sign with us now," "guaranteed," "switch agents," "better than your current agent," or "exclusive representation" — patterns associated with improper solicitation or guaranteed-outcome claims under RECO's registrant conduct norms. The check result is logged (see 3.8) but is **not currently blocking** — a flagged response is still returned to the user. This is a heuristic detector, not enforcement; see gaps.

The system prompt separately instructs Claude to never encourage a user to leave or distrust their current representing realtor, and never to claim exclusive representation.

### 3.7 Valuation disclaimers

The disclaimer is no longer appended per-message (it was originally, but that cluttered every chat bubble). It's now shown once, site-wide, in a footer below the chat input — fetched from `GET /api/disclaimer`, sourced from `generateDisclaimer()` in `core/compliance.js` so there's a single canonical copy rather than duplicated text in the frontend:

> This information is sourced from TRREB MLS data and provided for general informational purposes only. It is not a formal appraisal, CMA, or professional advice. See our privacy policy for details.

The "privacy policy" phrase links to `https://navjotchahal.ca/privacy` (`getPrivacyPolicyUrl()` in `core/compliance.js`) — **this is a placeholder destination; the page may not exist yet.** Confirm it's live before this ships to real users, since a disclaimer that links to a 404 undermines the point of having one.

The system prompt also instructs Claude not to write its own competing disclaimer, and to keep valuation language hedged ("likely," "based on available data") rather than stating definitive conclusions.

### 3.8 Power of sale handling

The system prompt instructs Claude that if a power-of-sale, estate, or court-ordered sale is evident from the data, it may acknowledge that fact but must not explain the legal mechanics, speculate about the seller's financial distress, or give procedural guidance — and should direct the client to the realtor. There is no structured data field for this today (Ampre's `PropertySubType`/`StandardStatus` don't carry it directly in what we select); in practice this would currently only surface via remarks, which are already stripped at the client tier. This rule mainly guards the realtor tier and any future data source that does expose it structurally.

### 3.9 Compliance logging

Every `/api/chat` call logs a structured line via `console.log('[compliance]', ...)` with `userType`, the searched address, `solicitationCompliant`, and `solicitationFlags`. This is process-log-only today (stdout), not a persisted audit trail — see gaps.

### 3.10 DDF fallback data source

`routes/chat.js` tries `searchByAddress` (Ampre/VOW) first. Only when that comes back `not_found` does it fall back to `searchByAddressDdf` (`core/ddf-query.js`), which queries CREA's national DDF feed (`ddfapi.realtor.ca`, OAuth2 client-credentials against `identity.crea.ca`) — this covers boards Mosaic doesn't have VOW/Cornerstone approval for yet. The fallback is wrapped in its own try/catch so a DDF outage or missing credentials silently preserves the existing `not_found` behavior rather than turning into a 502.

Important asymmetries with the primary VOW feed, confirmed against DDF's live `$metadata`:

- **DDF carries no sold/closed data at all** — no `ClosePrice`, `CloseDate`, or `PurchaseContractDate` field exists in its Property entity. Sold comparables always come from `getSoldComps` (VOW-only), regardless of which feed the subject came from — this was a deliberate decision, not a gap to close later.
- **DDF's field set is narrower than VOW's `DETAIL_SELECT`.** Fields with no DDF equivalent (`Exclusions`, `RentalItems`/`RentalItemsMonthlyCost`, `PossessionDate`/`PossessionType`, `CondoCorpNumber`, `Locker`/`LockerNumber`, `LivingAreaRange`, `ApproximateAge`, split `HeatType`/`HeatSource`, and more) are left `null` by `normalizeDdfProperty`, and `formatProperty` appends an explicit note telling Claude these are genuinely absent for DDF-sourced listings rather than something to guess at.
- **Brokerage name is not available.** DDF's Property entity only exposes `ListOfficeKey` (an internal ID), not the office name — resolving that would need a separate `Office` entity lookup, not implemented. `ensureBrokerage()` in `core/compliance.js` correctly reports this as missing (`brokerageMissing: true`) rather than fabricating a name, same as any other VOW listing with an absent brokerage.
- **`PropertySubType` vocabulary may not match between feeds.** `getSoldComps` hard-filters sold comps by `PropertySubType` (never relaxed, by design) — if a DDF-sourced subject's subtype string (e.g. `"Industrial"`, `"Vacant Land"`) doesn't exist verbatim in VOW's vocabulary for that board, comps will silently come back empty rather than erroring. Not yet mapped/reconciled between the two vocabularies.
- **DDF's `Latitude`/`Longitude` are populated (VOW's essentially never are) — this surfaced and led to fixing a latent bug.** `getSoldComps`'s geo-radius branch used to build an Ampre filter directly on `Latitude`/`Longitude`, which the live Ampre API rejects outright (`HTTP 400: Field 'Latitude' not found in query options filter`). Because VOW listings never populate these fields, that branch was never actually exercised until a DDF-sourced subject (which does have real coordinates) hit it. Fixed by removing the lat/long filter branch from `getSoldComps` entirely — comps now always resolve neighbourhood via `CityRegion`/postal-FSA regardless of source. `normalizeDdfProperty` passes DDF's real coordinates through unmodified (see [3.11](#311-nearby-amenities-google-places), which needs them); a client-side distance-ranked pass over the CityRegion/FSA comps pool (using each candidate's own returned Latitude/Longitude) would be the correct way to reintroduce tighter geo-matching later, not attempted yet.

### 3.11 Nearby amenities (Google Places)

`routes/chat.js` calls `getNearbyAmenities` (`core/places-query.js`) with the subject's coordinates on the first turn or when the question mentions schools/parks/neighbourhood/transit/amenities (`NEIGHBOURHOOD_INTENT_RE`, same gating pattern as the comps table). It queries Google Places API (New) `searchNearby` for schools, parks, and other amenities (transit, groceries, pharmacy, restaurants) within a 2km radius, ranked by real distance.

**This is proximity data, not school catchment/boundary data — a deliberate, load-bearing distinction.** Research this build (see conversation history, not reproduced here) found no self-serve source for actual school-zoning data: Fraser Institute/compareschoolrankings.org has no API, HoodQ requires a paid/sales relationship, and Local Logic is demo-gated. "Nearest school by distance" is not the same as "the school this address is zoned for." `formatAmenities()` in `core/claude-analysis.js` appends an explicit instruction that Claude must present nearby schools as proximity-only and direct catchment questions to the local school board or the Ontario school locator (ontario.ca) — never imply the nearest school is the assigned one.

**Cost:** Google Places API (New) Nearby Search bills under a Pro SKU — 5,000 free calls/month, then $32/1,000 after. This feature issues 3 calls per triggered lookup (schools/parks/other), which stays well within the free tier at expected usage volume for a small team tool; would need monitoring if usage scales up significantly. Requires `GOOGLE_PLACES_API_KEY` (a Google Cloud project with Places API (New) enabled and billing configured) — the feature fails soft (returns `null`, no error surfaced to the user) if the key is missing or the API call fails, same pattern as `core/vow-query.js`'s autocomplete.

## 4. Disclaimer text

Single source of truth: `generateDisclaimer()` and `getPrivacyPolicyUrl()` in `core/compliance.js`, served via `GET /api/disclaimer` and rendered once in the UI footer. See [3.7](#37-valuation-disclaimers) for the current text and the privacy-link caveat.

## 5. Regulatory bodies referenced

The following describes each body's general role at a high level, based on general knowledge — **not** verified against their current published rules in this session (a prior request to do that live research was stopped before completion). Do not treat anything below as a citation.

- **CREA** (Canadian Real Estate Association) — national association; owns the REALTOR® trademark and operates national data-sharing infrastructure (DDF) among member boards. Mosaic now actually queries DDF as a fallback data source (see [3.10](#310-ddf-fallback-data-source)) — the permitted-use terms of Mosaic's specific DDF access agreement have not been reviewed here, same caveat as the Ampre/VOW agreement below.
- **OREA** (Ontario Real Estate Association) — provincial association for Ontario REALTORS®; education, standard forms, and advocacy.
- **TRREB** (Toronto Regional Real Estate Board) / local board — operates the MLS system and VOW/data feed rules governing what a subscriber may query and redisplay.
- **RECO** (Real Estate Council of Ontario) — the actual regulator, administering REBBA 2002 (Real Estate and Business Brokers Act) and registrant conduct rules, including non-solicitation and no-guarantee norms.
- **ITSO / Ampre** (formerly Cornerstone) — the data platform vendor providing the VOW feed Mosaic queries (`core/vow-query.js`); the specific permitted/forbidden uses live in the signed vendor agreement, not in a public document Mosaic's code can reference.

## 6. Known gaps / required legal verification

- **No authentication/consent layer exists.** `userType` is a client-supplied request field with no login behind it — see [Section 2](#2-data-access-tiers). This is the single biggest gap before Mosaic can be used with real clients under the "password-protected platform, user consents" model.
- **No live regulatory research was performed for this build.** All rules above are implemented from general Canadian real estate industry best practices, not from verified current text of CREA/OREA/TRREB/RECO publications or the Ampre vendor agreement. Every row needs a citation check before this is treated as authoritative.
- **The actual signed Ampre/TRREB (or local board) vendor agreement has not been reviewed.** It is the actual source of truth for what a VOW subscriber may store, cache, redisplay, or pass to a third-party AI model (Claude/Anthropic) — this needs direct review, likely by whoever holds that agreement (Navjot / the brokerage).
- **Sending listing data to Claude (a third-party AI API) may itself require disclosure or fall under specific vendor-agreement restrictions** on redistributing MLS data to third parties/subprocessors. Not evaluated here.
- **`validateSolicitation()` is a heuristic keyword scanner, not enforcement.** It logs flags but does not block or rewrite a flagged response. It will miss non-keyword-based solicitation and may false-positive on legitimate usage (e.g., "not guaranteed" in the disclaimer itself, which is checked before the disclaimer is appended to avoid a self-flag, but similar phrasing elsewhere could still slip through either direction).
- **Compliance logs are process stdout only** — not persisted, not queryable, no retention policy of their own. Needs a real logging/audit destination before this is relied on for compliance evidence.
- **`propertySearch.js` and `comps.js` don't apply tiering** (see [Section 2](#2-data-access-tiers)).
- **Fair housing and power-of-sale guardrails are prompt-level instructions to Claude, not hard filters.** An LLM can be prompted around; nothing in code currently verifies Claude actually complied on a given response (`validateSolicitation` only checks the solicitation pattern list, not fair-housing or power-of-sale compliance).
- **The DDF vendor agreement's permitted-use terms have not been reviewed** — same gap as the Ampre/TRREB agreement above, now also applicable to `core/ddf-query.js`. Whether DDF data may be passed to a third-party AI model, cached, or blended with VOW data in the way Mosaic does needs direct review.
- **`PropertySubType` vocabulary is not reconciled between VOW and DDF** — a DDF-sourced subject's subtype may not match any VOW listing's subtype string, silently zeroing out sold comps for that subject rather than erroring (see [3.10](#310-ddf-fallback-data-source)).
- **Google Places' terms of service have not been reviewed** for this specific use (surfacing nearby-place data inside a real estate chat product, passed through to a third-party AI model). Same category of gap as the Ampre/DDF vendor agreements above.
- **The "proximity, not catchment" distinction for nearby schools is a prompt-level instruction, not a hard filter** (see [3.11](#311-nearby-amenities-google-places)) — same limitation as the fair-housing/power-of-sale guardrails above: nothing in code verifies Claude's response actually included the catchment caveat on a given answer.

## 7. Implementation reference

| Concern | File |
|---|---|
| Data filtering (client/realtor tiers) | `core/compliance.js` — `filterClientData`, `filterRealtorData` |
| Disclaimer text | `core/compliance.js` — `generateDisclaimer` |
| Solicitation heuristic | `core/compliance.js` — `validateSolicitation` |
| System prompt guardrails | `core/claude-analysis.js` — `SYSTEM_PROMPT` |
| Tier enforcement, disclaimer append, compliance logging | `routes/chat.js` |
| DDF fallback search (active listings, boards without VOW approval) | `core/ddf-query.js` — `searchByAddressDdf` |
| Nearby amenities (schools/parks/other, proximity-only) | `core/places-query.js` — `getNearbyAmenities` |
