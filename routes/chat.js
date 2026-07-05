import { Router } from 'express';
import { searchByAddress, getSoldComps } from '../core/vow-query.js';
import { searchByAddressDdf } from '../core/ddf-query.js';
import { answerPropertyQuestion, curateComps } from '../core/claude-analysis.js';
import { filterClientData, filterRealtorData, validateSolicitation } from '../core/compliance.js';

const COMP_LIMIT = 5;

// Comps are recomputed every turn to keep the assistant's grounding data
// current, but the table should only (re)render in the UI on the first turn
// or when the user is actually asking/refining around comps — not on every
// unrelated follow-up question.
const COMPS_INTENT_RE = /\b(comps?|comparables?|comparable sales?|sold (price|homes?|properties)|similar (home|propert|listing|sale)|other (listing|propert|sale|home)s?)\b/i;

const router = Router();

function formatDisambiguationQuestion(candidates) {
  const addresses = candidates.map((c) => c.address);
  const last = addresses[addresses.length - 1];
  const joined = addresses.length > 1
    ? `${addresses.slice(0, -1).join(', ')} or ${last}`
    : last;
  return `Did you mean ${joined}?`;
}

// POST /api/chat  { address: string, question: string, history?: Array<{role, content}>, userType?: 'client'|'realtor' }
router.post('/', async (req, res) => {
  const { address, question, history, userType: rawUserType } = req.body || {};
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'address is required' });
  }
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required' });
  }

  // Fail closed: anything other than an explicit 'realtor' gets the restricted client tier.
  const userType = rawUserType === 'realtor' ? 'realtor' : 'client';

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
      : filterClientData({ subject, comps: curatedComps });

    const answer = await answerPropertyQuestion({
      subject: filtered.subject,
      comps: filtered.comps,
      question: question.trim(),
      history: Array.isArray(history) ? history : [],
      userType,
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
