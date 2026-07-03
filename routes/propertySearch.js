import { Router } from 'express';
import { searchByAddress } from '../core/vow-query.js';

const router = Router();

// POST /api/property-search  { address: string }
router.post('/', async (req, res) => {
  const { address } = req.body || {};
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'address is required' });
  }

  try {
    const property = await searchByAddress(address.trim());
    if (!property) return res.status(404).json({ error: 'No property found for that address' });
    res.json({ property });
  } catch (err) {
    console.error('[property-search] error:', err.message);
    res.status(502).json({ error: 'Property lookup failed', detail: err.message });
  }
});

export default router;
