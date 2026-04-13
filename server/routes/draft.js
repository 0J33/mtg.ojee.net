const express = require('express');
const { getDraftableSets } = require('../services/packGenerator');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/draft/sets — list of sets that support drafting/sealed
router.get('/sets', requireAuth, async (req, res) => {
    try {
        const sets = await getDraftableSets();
        res.json({ sets });
    } catch (err) {
        console.error('[draft/sets]', err.message);
        res.status(500).json({ error: 'Failed to fetch draftable sets' });
    }
});

module.exports = router;
