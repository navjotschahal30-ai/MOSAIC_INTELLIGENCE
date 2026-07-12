# Mosaic Real Estate Intelligence — Legal & Compliance Reference

**Status: draft, prepared for legal team review. Not legal advice, and not independently verified against current CREA/OREA/TRREB/RECO/Ampre published materials or Team Mosaic's signed vendor agreement.** See [Section 6](#6-known-gaps--required-legal-verification) before relying on this document.

## 1. Purpose & scope

This document describes the compliance controls implemented in the Mosaic Real Estate Intelligence codebase as of this build, why they exist, and where they're enforced in code. It's a starting point for legal review, not a finished compliance program — Mosaic is a Phase 1 skeleton.

## 2. Data access tiers

**Updated 2026-07-11:** `/api/chat` now derives its tier server-side from the authenticated session (`req.user.userType`, set by `requireAuth` from the signed session cookie — see `core/auth.js`) rather than trusting a client-supplied field. This closes the "anyone can pass `userType: realtor`" gap described lower in this section (kept below, struck through in spirit, for history).

| Tier | Who | Registration requirement | Data access |
|---|---|---|---|
| `client` | The realtor's client, using the chat UI directly | None — this tier is the fail-closed default for any request without a recognized session | Full property details — address, status, list/sold price, close date, days on market, beds, baths, sqft, lot depth, year built, property type, and the public marketing description. **No** seller/agent identity or contact info, private (non-public) remarks, showing info, or offer remarks (see [3.1](#31-seller-privacy)). |
| `agent` | An external REALTOR® testing or using the product (`user_type = 'external_agent'`) | Brokerage name + RECO license number, both required at registration (see [3.11](#311-agent-identity-gate-brokerage--reco-license)) | Everything a realtor sees — private/realtor remarks, showing appointments/requirements, offer remarks, listing agent contact — **except** seller/owner identity, which is stripped the same as for clients. |
| `realtor` | Navjot / Team MOSAIC staff (`user_type = 'team_mosaic'`) | None | Full unfiltered data, including seller/owner identity if it's ever present in the source data. |

Model: what a client (or agent) can see is closer to a password-protected consumer site (HouseSigma-style) than a fully public one — property history, comps, and details are fine once the user is inside an authenticated, consented session; only seller PII stays realtor-only (and, for agents, seller PII specifically — everything else an agent would normally need for their own client work is available).

Enforced in `core/compliance.js` (`filterClientData`, `filterAgentData`, `filterRealtorData`), called from `routes/chat.js` before data reaches Claude. The tier is also passed into the Claude system prompt as an `[ACCESS TIER]` marker so the model doesn't attempt to reconstruct stripped information from general knowledge.

**Remaining gap — RECO license is captured, not verified.** Registration requires a RECO license number for `external_agent` accounts, but nothing in the code cross-checks it against RECO's public registrant search (reco.on.ca) or any other registry. It's a self-reported identity gate (raises the bar above "anyone with the link," and creates an audit trail of who claimed what), not proof of an active, real registration. A real verification step (RECO registry lookup, or manual approval before an `external_agent` account is activated) would need to be added before this is relied on as an actual credential check.

**Known gap:** `routes/propertySearch.js` and `routes/comps.js` do not yet apply tiering — they return full unfiltered VOW data regardless of caller. The current frontend (`ChatBox.jsx`) only calls `/api/chat`, so this isn't reachable through the UI today, but it's an inconsistency in the API surface that should be closed before those endpoints are used directly by anything client-facing.

## 3. Compliance controls implemented

### 3.1 Seller privacy

`filterClientData` strips a denylist of fields — owner/seller name, private remarks, showing instructions/history/appointments/requirements, offer remarks, listing and co-listing agent name/email/phone, occupant type — before data reaches the client tier or Claude. The denylist is intentionally broader than what `core/vow-query.js` currently selects from Ampre, so adding a new field later doesn't silently leak it to clients.

`filterAgentData` strips a much narrower denylist — `ownerName`/`sellerName` only (`AGENT_STRIP_FIELDS` in `core/compliance.js`). Everything else client-tier hides (private remarks, showing info, offer remarks, listing agent contact) is normal working data for a REALTOR® and is passed through unfiltered for the `agent` tier.

Public marketing remarks (`PublicRemarks`, mapped to `remarks`) are **not** stripped for any tier — they're already publicly visible on any MLS listing site, and property description is explicitly in-scope even for the client tier (price history, comps, and property details including description are fine to show once a user is in an authenticated, consented session).

### 3.2 Agent remarks protection

**Updated 2026-07-11:** `PrivateRemarks`, `ShowingAppointments`, `ShowingRequirements`, and `OfferRemarks` are now fetched by `core/vow-query.js` (field names and types confirmed against the live Ampre `$metadata`) and surfaced to Claude via `formatProperty` in `core/claude-analysis.js`. They're stripped by `CLIENT_STRIP_FIELDS` for the client tier, and passed through in full for both `agent` and `realtor` tiers. This is distinct from 3.1's public remarks, which all tiers can see.

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
- **DDF's `Latitude`/`Longitude` are populated (VOW's essentially never are) — and this surfaced a latent bug.** `getSoldComps`'s geo-radius branch builds an Ampre filter directly on `Latitude`/`Longitude`, which the live Ampre API rejects outright (`HTTP 400: Field 'Latitude' not found in query options filter`). Because VOW listings never populate these fields, that branch was never actually exercised before. `normalizeDdfProperty` deliberately nulls out `latitude`/`longitude` to route DDF subjects through the same (working) `CityRegion`/postal-FSA comps fallback VOW subjects use — this avoids the bug rather than fixing it. The underlying Ampre geo-filter bug is still latent in `core/vow-query.js` and would resurface if VOW itself ever starts populating coordinates.

### 3.11 Agent identity gate (brokerage + RECO license)

Added 2026-07-11 for the first round of external testing. `POST /api/auth/register` requires `companyName` (brokerage name) and `recoLicense` (RECO registrant license number) when `userType = 'external_agent'` — both are rejected with a 400 if missing or blank. Stored on the `agents` row (`company_name`, `reco_license` columns, `db/schema.sql`) and returned by `GET /api/auth/me`. Not required for `team_mosaic` accounts.

This is a self-reported identity capture, not a verified credential check — see the "RECO license is captured, not verified" gap in [Section 2](#2-data-access-tiers).

### 3.12 Neighbourhood amenities (schools, parks, transit) — no Google API

Added 2026-07-11. `core/amenities.js` resolves an address to coordinates via Nominatim (`geocodeAddress` — same free, no-key OpenStreetMap geocoder `routes/geocode.js` already used for reverse geocoding) and queries the Overpass API (`getNearbyAmenities`, also free, no key) for nearby schools, parks/playgrounds, transit stops, and grocery/healthcare within a radius, sorted nearest-first by straight-line distance.

- Standalone endpoint: `GET /api/amenities?address=...` (`routes/amenities.js`).
- Wired into chat: `routes/chat.js` runs the lookup only when the question matches `AMENITIES_INTENT_RE` (school/park/transit/grocery/neighbourhood-type questions) — not on every turn — and passes the result into `answerPropertyQuestion` as a `[NEARBY AMENITIES]` block Claude is instructed to ground its answer in.
- VOW subjects essentially never have their own `Latitude`/`Longitude` populated (see [3.10](#310-ddf-fallback-data-source)); the address is geocoded via Nominatim in that case. DDF-sourced subjects have their coordinates deliberately nulled for an unrelated reason (the `getSoldComps` geo-radius bug, also in 3.10) — the amenities lookup uses the same address-geocoding fallback for both feeds rather than depending on either one's raw coordinates.
- No Google Maps/Places API key is used or required anywhere in this feature.
- Both Nominatim and the public Overpass instance (`overpass-api.de`) are shared free infrastructure with informal rate limits, fine at this app's current volume — self-hosting Overpass or moving to a paid provider would be the scaling path if usage grows materially.

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

- **RECO license numbers are captured at registration but not verified** against RECO's public registrant search or any other registry — see [3.11](#311-agent-identity-gate-brokerage--reco-license) and [Section 2](#2-data-access-tiers). Someone could type a fabricated brokerage/license and still get `agent`-tier access (seller identity is still hidden, but private/showing/offer remarks would not be). Fine for a small, invite-only testing cohort; needs a real verification step before wider release.
- **No live regulatory research was performed for this build.** All rules above are implemented from general Canadian real estate industry best practices, not from verified current text of CREA/OREA/TRREB/RECO publications or the Ampre vendor agreement. Every row needs a citation check before this is treated as authoritative.
- **The actual signed Ampre/TRREB (or local board) vendor agreement has not been reviewed.** It is the actual source of truth for what a VOW subscriber may store, cache, redisplay, or pass to a third-party AI model (Claude/Anthropic) — this needs direct review, likely by whoever holds that agreement (Navjot / the brokerage).
- **Sending listing data to Claude (a third-party AI API) may itself require disclosure or fall under specific vendor-agreement restrictions** on redistributing MLS data to third parties/subprocessors. Not evaluated here.
- **`validateSolicitation()` is a heuristic keyword scanner, not enforcement.** It logs flags but does not block or rewrite a flagged response. It will miss non-keyword-based solicitation and may false-positive on legitimate usage (e.g., "not guaranteed" in the disclaimer itself, which is checked before the disclaimer is appended to avoid a self-flag, but similar phrasing elsewhere could still slip through either direction).
- **Compliance logs are process stdout only** — not persisted, not queryable, no retention policy of their own. Needs a real logging/audit destination before this is relied on for compliance evidence.
- **`propertySearch.js` and `comps.js` don't apply tiering** (see [Section 2](#2-data-access-tiers)).
- **Fair housing and power-of-sale guardrails are prompt-level instructions to Claude, not hard filters.** An LLM can be prompted around; nothing in code currently verifies Claude actually complied on a given response (`validateSolicitation` only checks the solicitation pattern list, not fair-housing or power-of-sale compliance).
- **The DDF vendor agreement's permitted-use terms have not been reviewed** — same gap as the Ampre/TRREB agreement above, now also applicable to `core/ddf-query.js`. Whether DDF data may be passed to a third-party AI model, cached, or blended with VOW data in the way Mosaic does needs direct review.
- **`getSoldComps`'s geo-radius branch has a live bug** (Ampre rejects `Latitude`/`Longitude` as filter fields — see [3.10](#310-ddf-fallback-data-source)) that was never triggered before because VOW never populates coordinates. Currently avoided by nulling out DDF's coordinates before they reach `getSoldComps`, not fixed at the source.
- **`PropertySubType` vocabulary is not reconciled between VOW and DDF** — a DDF-sourced subject's subtype may not match any VOW listing's subtype string, silently zeroing out sold comps for that subject rather than erroring (see [3.10](#310-ddf-fallback-data-source)).

## 7. Implementation reference

| Concern | File |
|---|---|
| Data filtering (client/agent/realtor tiers) | `core/compliance.js` — `filterClientData`, `filterAgentData`, `filterRealtorData` |
| Disclaimer text | `core/compliance.js` — `generateDisclaimer` |
| Solicitation heuristic | `core/compliance.js` — `validateSolicitation` |
| System prompt guardrails | `core/claude-analysis.js` — `SYSTEM_PROMPT` |
| Tier enforcement (session-derived), disclaimer append, compliance logging, amenities-intent detection | `routes/chat.js` |
| Auth (register/login/session), agent identity gate | `core/auth.js`, `routes/auth.js` |
| DDF fallback search (active listings, boards without VOW approval) | `core/ddf-query.js` — `searchByAddressDdf` |
| Nearby amenities (schools/parks/transit, OSM-based, no Google API) | `core/amenities.js`, `routes/amenities.js` |
