import { Router } from 'express';
import { generateDisclaimer, generateLegalText, getPrivacyPolicyUrl } from '../core/compliance.js';

const router = Router();

// GET /api/disclaimer — single source of truth for the site-wide footer disclaimer
// (short line) and the full legal text shown in the "Legal" modal.
router.get('/', (req, res) => {
  res.json({
    disclaimer: generateDisclaimer(),
    legalText: generateLegalText(),
    privacyUrl: getPrivacyPolicyUrl(),
  });
});

export default router;
