import { Router } from 'express';
import { searchByAddress, getSoldComps } from '../core/vow-query.js';
import { answerPropertyQuestion } from '../core/claude-analysis.js';
import { filterClientData, filterRealtorData, generateDisclaimer, validateSolicitation } from '../core/compliance.js';

const router = Router();

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
    const [subject, compsResult] = await Promise.all([
      searchByAddress(address.trim()),
      getSoldComps(address.trim()),
    ]);

    const filtered = userType === 'realtor'
      ? filterRealtorData({ subject, comps: compsResult.comps })
      : filterClientData({ subject, comps: compsResult.comps });

    const rawAnswer = await answerPropertyQuestion({
      subject: filtered.subject,
      comps: filtered.comps,
      question: question.trim(),
      history: Array.isArray(history) ? history : [],
      userType,
    });

    const solicitationCheck = validateSolicitation(rawAnswer);
    const answer = `${rawAnswer}\n\n${generateDisclaimer()}`;

    console.log('[compliance]', JSON.stringify({
      userType,
      address: address.trim(),
      solicitationCompliant: solicitationCheck.compliant,
      solicitationFlags: solicitationCheck.flags,
      disclaimerAppended: true,
    }));

    res.json({ answer, subject: filtered.subject, comps: filtered.comps, userType });
  } catch (err) {
    console.error('[chat] error:', err.message);
    res.status(502).json({ error: 'Chat request failed', detail: err.message });
  }
});

export default router;
