const express = require('express');
const router = express.Router();

const SCRYFALL_BASE = 'https://api.scryfall.com';
const requestQueue = [];
let processing = false;

async function throttledFetch(url) {
    return new Promise((resolve, reject) => {
        requestQueue.push({ url, resolve, reject });
        processQueue();
    });
}

async function processQueue() {
    if (processing || requestQueue.length === 0) return;
    processing = true;
    const { url, resolve, reject } = requestQueue.shift();
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'MTGOjeeNet/1.0', 'Accept': 'application/json' }
        });
        const data = await res.json();
        resolve(data);
    } catch (err) {
        reject(err);
    }
    setTimeout(() => {
        processing = false;
        processQueue();
    }, 100); // 10 req/sec max
}

// Search cards
router.get('/search', async (req, res) => {
    const { q, page, include_extras } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required' });
    let url = `${SCRYFALL_BASE}/cards/search?q=${encodeURIComponent(q)}`;
    if (page) url += `&page=${page}`;
    if (include_extras) url += `&include_extras=true`;
    try {
        const data = await throttledFetch(url);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Scryfall request failed' });
    }
});

// Get card by Scryfall ID
router.get('/cards/:id', async (req, res) => {
    try {
        const data = await throttledFetch(`${SCRYFALL_BASE}/cards/${req.params.id}`);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Scryfall request failed' });
    }
});

// Fuzzy card name lookup
router.get('/named', async (req, res) => {
    const { exact, fuzzy } = req.query;
    let url = `${SCRYFALL_BASE}/cards/named?`;
    if (exact) url += `exact=${encodeURIComponent(exact)}`;
    else if (fuzzy) url += `fuzzy=${encodeURIComponent(fuzzy)}`;
    else return res.status(400).json({ error: 'exact or fuzzy param required' });
    try {
        const data = await throttledFetch(url);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Scryfall request failed' });
    }
});

// Batch lookup (max 75)
router.post('/collection', async (req, res) => {
    const { identifiers } = req.body;
    if (!identifiers || !Array.isArray(identifiers)) return res.status(400).json({ error: 'identifiers array required' });
    try {
        const response = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
            method: 'POST',
            headers: { 'User-Agent': 'MTGOjeeNet/1.0', 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifiers: identifiers.slice(0, 75) }),
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Scryfall request failed' });
    }
});

module.exports = router;
