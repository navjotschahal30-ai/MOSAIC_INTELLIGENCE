import { Router } from 'express';
import { searchByAddress, getSoldComps } from '../core/vow-query.js';
import { curateComps } from '../core/claude-analysis.js';

const DEFAULT_LIMIT = 5;

const router = Router();

// POST /api/comps  { address: string, radiusKm?: number, daysBack?: number, limit?: number }
router.post('/', async (req, res) => {
  const { address, radiusKm, daysBack, limit } = req.body || {};
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'address is required' });
  }

  const targetLimit = limit || DEFAULT_LIMIT;

  try {
    const searchResult = await searchByAddress(address.trim());

    if (searchResult.status === 'ambiguous') {
      return res.json({ ambiguous: true, candidates: searchResult.candidates });
    }

    const subject = searchResult.status === 'found' ? searchResult.property : null;
    const { comps, relaxationSteps } = await getSoldComps(subject, { radiusKm, daysBack, limit: targetLimit });
    const curated = subject ? await curateComps({ subject, candidates: comps, limit: targetLimit }) : [];

    res.json({ subject, comps: curated, relaxationSteps });
  } catch (err) {
    console.error('[comps] error:', err.message);
    res.status(502).json({ error: 'Comps lookup failed', detail: err.message });
  }
});

export default router;
