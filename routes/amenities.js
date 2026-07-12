import { Router } from 'express';
import { geocodeAddress, getNearbyAmenities } from '../core/amenities.js';

const router = Router();

// GET /api/amenities?address=X — schools, parks, transit, and grocery/healthcare
// near an address. OSM-based (Nominatim + Overpass), no Google API key needed.
router.get('/', async (req, res) => {
  const { address } = req.query;
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'address is required' });
  }

  const coords = await geocodeAddress(address.trim());
  if (!coords) return res.status(404).json({ error: 'Could not geocode that address' });

  const amenities = await getNearbyAmenities(coords);
  res.json({ coords, amenities });
});

export default router;
