import { Router } from 'express';
import { fuzzyMatchAddress } from '../core/vow-query.js';

const router = Router();

// GET /api/autocomplete?partial=23+doon&city=Kitchener
router.get('/', async (req, res) => {
  const { partial, city } = req.query;

  if (!partial || typeof partial !== 'string' || partial.trim().length < 3) {
    return res.json({ suggestions: [] });
  }

  try {
    const suggestions = await fuzzyMatchAddress(partial, typeof city === 'string' ? city : undefined);
    res.json({ suggestions });
  } catch (err) {
    console.error('[autocomplete] error:', err.message);
    res.json({ suggestions: [] }); // fail soft — autocomplete should never break typing
  }
});

export default router;
