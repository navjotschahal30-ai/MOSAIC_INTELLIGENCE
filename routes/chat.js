import { Router } from 'express';
import { searchByAddress, getSoldComps } from '../core/vow-query.js';
import { searchByAddressDdf } from '../core/ddf-query.js';
import { answerPropertyQuestion, curateComps } from '../core/claude-analysis.js';
import { filterClientData, filterAgentData, filterRealtorData, validateSolicitation } from '../core/compliance.js';
import { requireAuth } from '../core/auth.js';
import { geocodeAddress, getNearbyAmenities } from '../core/amenities.js';

// team_mosaic (Navjot / Team MOSAIC staff) -> full realtor tier.
// external_agent (verified brokerage + RECO license at registration,
// see routes/auth.js) -> agent tier: everything except seller identity.
// Anything else fails closed to the most restrictive (client) tier.
function tierFor(userType) {
  if (userType === 'team_mosaic') return 'realtor';
  if (userType === 'external_agent') return 'agent';
  return 'client';
}

const COMP_LIMIT = 5;

// Comps are recomputed every turn to keep the assistant's grounding data
// current, but the table should only (re)render in the UI on the first turn
// or when the user is actually asking/refining around comps — not on every
// unrelated follow-up question.
const COMPS_INTENT_RE = /\b(comps?|comparables?|comparable sales?|sold (price|homes?|properties)|similar (home|propert|listing|sale)|other (listing|propert|sale|home)s?)\b/i;

// Only fetch amenities (extra geocode + Overpass round-trip) when the question
// actually asks about the neighbourhood — not on every turn.
const AMENITIES_INTENT_RE = /\b(school|schools|park|parks|playground|amenit|transit|bus stop|grocery|supermarket|hospital|pharmacy|neighbo(u)?rhood|walkab)/i;

const router = Router();

function formatDisambiguationQuestion(candidates) {
  const addresses = candidates.map((c) => c.address);
  const last = addresses[addresses.length - 1];
  const joined = addresses.length > 1
    ? `${addresses.slice(0, -1).join(', ')} or ${last}`
    : last;
  return `Did you mean ${joined}?`;
}

// POST /api/chat  { address: string, question: string, history?: Array<{role, content}> }
// Access tier is derived server-side from the authenticated session
// (req.user.userType, set by requireAuth from the signed session cookie) —
// never from a client-supplied field. See legal-compliance.md Section 2.
router.post('/', requireAuth, async (req, res) => {
  const { address, question, history } = req.body || {};
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'address is required' });
  }
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required' });
  }

  const userType = tierFor(req.user.userType);

  try {
    let searchResult = await searchByAddress(address.trim());

    // Fall back to CREA's DDF (nationwide, active-only) when VOW comes up
    // empty — covers boards we don't have Cornerstone/Ampre approval for yet.
    if (searchResult.status === 'not_found') {
      try {
        const ddfResult = await searchByAddressDdf(address.trim());
        if (ddfResult.status !== 'not_found') searchResult = ddfResult;
      } catch (err) {
        console.error('[chat] DDF fallback failed:', err.message);
      }
    }

    if (searchResult.status === 'ambiguous') {
      return res.json({
        answer: formatDisambiguationQuestion(searchResult.candidates),
        ambiguous: true,
        candidates: searchResult.candidates,
        userType,
      });
    }

    const subject = searchResult.status === 'found' ? searchResult.property : null;
    const compsResult = await getSoldComps(subject, { limit: COMP_LIMIT });
    const curatedComps = subject
      ? await curateComps({ subject, candidates: compsResult.comps, limit: COMP_LIMIT })
      : [];

    const filtered = userType === 'realtor'
      ? filterRealtorData({ subject, comps: curatedComps })
      : userType === 'agent'
        ? filterAgentData({ subject, comps: curatedComps })
        : filterClientData({ subject, comps: curatedComps });

    // VOW almost never populates Latitude/Longitude (legal-compliance.md
    // 3.10) — DDF-sourced subjects do carry them directly. Fall back to
    // geocoding the address via Nominatim (core/amenities.js) either way.
    let amenities = null;
    if (subject && AMENITIES_INTENT_RE.test(question)) {
      try {
        // DDF's `address` already has city appended (see core/ddf-query.js) —
        // avoid sending it twice.
        const needsCity = subject.city && !subject.address.includes(subject.city);
        const coords = subject.latitude != null && subject.longitude != null
          ? { latitude: subject.latitude, longitude: subject.longitude }
          : await geocodeAddress(`${subject.address}${needsCity ? `, ${subject.city}` : ''}`);
        if (coords) amenities = await getNearbyAmenities(coords);
      } catch (err) {
        console.error('[chat] amenities lookup failed:', err.message);
      }
    }

    const answer = await answerPropertyQuestion({
      subject: filtered.subject,
      comps: filtered.comps,
      question: question.trim(),
      history: Array.isArray(history) ? history : [],
      userType,
      amenities,
    });

    // Disclaimer is no longer appended per-message — the frontend shows it
    // once, site-wide, via GET /api/disclaimer (see routes/disclaimer.js).
    const solicitationCheck = validateSolicitation(answer);

    console.log('[compliance]', JSON.stringify({
      userType,
      address: address.trim(),
      solicitationCompliant: solicitationCheck.compliant,
      solicitationFlags: solicitationCheck.flags,
    }));

    const isFirstTurn = !Array.isArray(history) || history.length === 0;
    const showComps = isFirstTurn || COMPS_INTENT_RE.test(question);

    res.json({
      answer,
      subject: isFirstTurn ? filtered.subject : undefined,
      comps: showComps ? filtered.comps : undefined,
      userType,
    });
  } catch (err) {
    console.error('[chat] error:', err.message);
    res.status(502).json({ error: 'Chat request failed', detail: err.message });
  }
});

export default router;
