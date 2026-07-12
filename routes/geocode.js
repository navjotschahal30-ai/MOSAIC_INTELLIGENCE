import { Router } from 'express';
import { geocodeAddress } from '../core/amenities.js';

const router = Router();

// GET /api/geocode/forward?address=X — resolves a street address to lat/lon via
// Nominatim. Needed because Ampre VOW essentially never populates its own
// Latitude/Longitude fields (see legal-compliance.md 3.10) — DDF-sourced
// listings do carry coordinates directly and don't need this.
router.get('/forward', async (req, res) => {
  const { address } = req.query;
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'address is required' });
  }
  const coords = await geocodeAddress(address.trim());
  res.json(coords || { latitude: null, longitude: null });
});

// GET /api/geocode/reverse?lat=X&lon=Y — proxies OpenStreetMap Nominatim so the
// browser doesn't call a third party directly (CORS + usage-policy reasons —
// Nominatim requires a descriptive User-Agent and no client-side hammering).
// No API key needed; free tier, ~1 req/sec. Swap for a paid geocoder if volume grows.
router.get('/reverse', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon are required' });

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'MosaicRealEstateIntelligence/0.1 (navjot@teammosaic.ca)' },
    });
    const data = await response.json();
    const address = data?.address || {};
    const city = address.city || address.town || address.village || address.municipality || null;
    res.json({ city });
  } catch (err) {
    console.error('[geocode] error:', err.message);
    res.json({ city: null });
  }
});

export default router;
