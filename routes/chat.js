import { Router } from 'express';
import { searchByAddress, getSoldComps } from '../core/vow-query.js';
import { answerPropertyQuestion } from '../core/claude-analysis.js';

const router = Router();

// POST /api/chat  { address: string, question: string, history?: Array<{role, content}> }
router.post('/', async (req, res) => {
  const { address, question, history } = req.body || {};
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'address is required' });
  }
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required' });
  }

  try {
    const [subject, compsResult] = await Promise.all([
      searchByAddress(address.trim()),
      getSoldComps(address.trim()),
    ]);

    const answer = await answerPropertyQuestion({
      subject,
      comps: compsResult.comps,
      question: question.trim(),
      history: Array.isArray(history) ? history : [],
    });

    res.json({ answer, subject, comps: compsResult.comps });
  } catch (err) {
    console.error('[chat] error:', err.message);
    res.status(502).json({ error: 'Chat request failed', detail: err.message });
  }
});

export default router;
