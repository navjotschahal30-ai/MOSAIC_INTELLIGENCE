import { Router } from 'express';
import { getSoldComps } from '../core/vow-query.js';

const router = Router();

// POST /api/comps  { address: string, radiusKm?: number, monthsBack?: number, limit?: number }
router.post('/', async (req, res) => {
  const { address, radiusKm, monthsBack, limit } = req.body || {};
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'address is required' });
  }

  try {
    const { subject, comps } = await getSoldComps(address.trim(), { radiusKm, monthsBack, limit });
    res.json({ subject, comps });
  } catch (err) {
    console.error('[comps] error:', err.message);
    res.status(502).json({ error: 'Comps lookup failed', detail: err.message });
  }
});

export default router;
