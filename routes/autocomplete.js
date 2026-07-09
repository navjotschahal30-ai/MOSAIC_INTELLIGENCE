import { Router } from 'express';
import { fuzzyMatchAddress } from '../core/vow-query.js';
import { suggestAddresses } from '../core/address-lookup.js';

const router = Router();

// GET /api/autocomplete?partial=23+doon&city=Kitchener
//
// Blends two sources: MLS listings (fuzzyMatchAddress — addresses the assistant
// actually has data for) and the Canada-wide NRCan geolocator (suggestAddresses
// — a free, Canada Post AddressComplete-style "any real Canadian address" guess).
// MLS matches lead since selecting one skips a lookup miss; the geolocator fills
// the rest so typing an address outside the current listing set still guesses.
router.get('/', async (req, res) => {
  const { partial, city } = req.query;

  if (!partial || typeof partial !== 'string' || partial.trim().length < 3) {
    return res.json({ suggestions: [] });
  }

  const cityArg = typeof city === 'string' ? city : undefined;

  try {
    const [mlsSuggestions, geoSuggestions] = await Promise.all([
      fuzzyMatchAddress(partial, cityArg),
      suggestAddresses(partial, cityArg),
    ]);

    const seen = new Set(mlsSuggestions.map((s) => s.toLowerCase()));
    const merged = [...mlsSuggestions];
    for (const s of geoSuggestions) {
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(s);
      if (merged.length >= 6) break;
    }

    res.json({ suggestions: merged });
  } catch (err) {
    console.error('[autocomplete] error:', err.message);
    res.json({ suggestions: [] }); // fail soft — autocomplete should never break typing
  }
});

export default router;
