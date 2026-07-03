import { Router } from 'express';
import { generateDisclaimer, getPrivacyPolicyUrl } from '../core/compliance.js';

const router = Router();

// GET /api/disclaimer — single source of truth for the site-wide footer disclaimer.
router.get('/', (req, res) => {
  res.json({ disclaimer: generateDisclaimer(), privacyUrl: getPrivacyPolicyUrl() });
});

export default router;
