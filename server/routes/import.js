const express = require('express');
const router = express.Router();
const { fetchMoxfieldDeck, stats: moxfieldStats } = require('../moxfieldClient');

const SCRYFALL_BASE = 'https://api.scryfall.com';

function scryfallCardToEntry(card) {
    const face = card.card_faces?.[0];
    return {
        scryfallId: card.id,
        name: card.name,
        quantity: 1,
        imageUri: card.image_uris?.normal || face?.image_uris?.normal || '',
        backImageUri: card.card_faces?.[1]?.image_uris?.normal || '',
        manaCost: card.mana_cost || face?.mana_cost || '',
        typeLine: card.type_line || face?.type_line || '',
        oracleText: card.oracle_text || face?.oracle_text || '',
        power: card.power || face?.power || '',
        toughness: card.toughness || face?.toughness || '',
        colors: card.colors || face?.colors || [],
        colorIdentity: card.color_identity || [],
        producedMana: card.produced_mana || face?.produced_mana || [],
        layout: card.layout || 'normal',
    };
}

// Parse text decklist into sections
function parseDecklist(text) {
    const lines = text.trim().split('\n');
    const sections = { commanders: [], companions: [], mainboard: [], sideboard: [] };
    let currentSection = 'mainboard';

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const sectionMatch = line.match(/^(?:\/\/\s*)?(?:Commander|Commanders)s?$/i);
        if (sectionMatch || /^Commander/i.test(line) && !/^\d/.test(line)) {
            currentSection = 'commanders';
            continue;
        }
        if (/^(?:\/\/\s*)?Companion$/i.test(line)) { currentSection = 'companions'; continue; }
        if (/^(?:\/\/\s*)?(?:Sideboard|Side Board|SB)$/i.test(line)) { currentSection = 'sideboard'; continue; }
        if (/^(?:\/\/\s*)?(?:Deck|Main Deck|Maindeck|Mainboard)$/i.test(line)) { currentSection = 'mainboard'; continue; }
        if (/^\/\//.test(line)) continue; // skip other comments

        // Parse card line: "1 Card Name" or "1x Card Name" or "1 Card Name (SET) 123"
        const match = line.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\([A-Z0-9]+\)\s+\S+)?$/i);
        if (match) {
            const quantity = parseInt(match[1]);
            let name = match[2].replace(/\s*\*[FE]\*\s*$/, '').trim(); // strip foil markers
            // For DFC cards "Front // Back" or "Front / Back", use just the front name
            if (name.includes(' // ')) name = name.split(' // ')[0].trim();
            else if (name.includes(' / ')) name = name.split(' / ')[0].trim();
            sections[currentSection].push({ name, quantity });
        }
    }

    return sections;
}

// Import from text
router.post('/text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Decklist text required' });

    const sections = parseDecklist(text);
    const allNames = [];
    const nameToSection = {};

    for (const [section, cards] of Object.entries(sections)) {
        for (const card of cards) {
            allNames.push(card);
            nameToSection[card.name] = nameToSection[card.name] || { section, quantity: card.quantity };
        }
    }

    // Batch lookup via Scryfall (75 at a time)
    const result = { commanders: [], companions: [], mainboard: [], sideboard: [], notFound: [] };
    const batches = [];
    for (let i = 0; i < allNames.length; i += 75) {
        batches.push(allNames.slice(i, i + 75));
    }

    for (const batch of batches) {
        try {
            const response = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
                method: 'POST',
                headers: { 'User-Agent': 'MTGOjeeNet/1.0', 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    identifiers: batch.map(c => ({ name: c.name })),
                }),
            });
            const data = await response.json();

            for (const card of (data.data || [])) {
                const entry = scryfallCardToEntry(card);
                // Try multiple keys: full name, front face name, root name
                let info = nameToSection[card.name];
                if (!info && card.card_faces?.[0]?.name) info = nameToSection[card.card_faces[0].name];
                if (!info && card.name.includes(' // ')) info = nameToSection[card.name.split(' // ')[0]];
                if (info) {
                    entry.quantity = info.quantity;
                    result[info.section].push(entry);
                } else {
                    // Fall back to mainboard if we can't match the section
                    result.mainboard.push(entry);
                }
            }
            for (const nf of (data.not_found || [])) {
                result.notFound.push(nf.name || nf);
            }
        } catch (err) {
            console.error('Scryfall batch lookup failed:', err);
        }

        // Respect rate limit
        if (batches.indexOf(batch) < batches.length - 1) {
            await new Promise(r => setTimeout(r, 100));
        }
    }

    res.json(result);
});

// Import from Moxfield URL.
//
// All outgoing Moxfield API calls go through moxfieldClient.js, which
// enforces:
//   - A strict 1-request-per-second global rate limit (configurable via
//     MOXFIELD_MIN_INTERVAL_MS, defaults to 1500ms for a safety margin)
//   - A serial request queue so concurrent user imports can never stack up
//   - In-memory response caching so re-importing the same deck is free
//   - Secret user-agent handling (never logged, never sent to clients)
//
// If the MOXFIELD_USER_AGENT env var isn't set (as is the case right now),
// fetchMoxfieldDeck throws a 503 "not configured" error, which we translate
// into a user-friendly message pointing at the Paste Text path instead.
router.post('/moxfield', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Moxfield URL required' });

    const match = url.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/);
    if (!match) return res.status(400).json({ error: 'Invalid Moxfield URL' });
    const deckId = match[1];

    let data;
    try {
        data = await fetchMoxfieldDeck(deckId);
    } catch (err) {
        if (err?.status === 503) {
            return res.status(503).json({
                error: 'Moxfield URL import is currently unavailable. Use the Paste Text tab: in Moxfield, More → Export → Copy as plain text.',
            });
        }
        console.error('[moxfield import] fetch failed:', err?.message || err);
        return res.status(502).json({ error: 'Failed to fetch from Moxfield. Try pasting the decklist as text instead.' });
    }

    try {
        const result = { commanders: [], companions: [], mainboard: [], sideboard: [], notFound: [] };

        const processSection = (section, target) => {
            if (!section) return;
            for (const [, entry] of Object.entries(section)) {
                const card = entry.card;
                if (!card) continue;
                target.push({
                    scryfallId: card.scryfall_id || card.id,
                    name: card.name,
                    quantity: entry.quantity || 1,
                    imageUri: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '',
                    backImageUri: card.card_faces?.[1]?.image_uris?.normal || '',
                    manaCost: card.mana_cost || '',
                    typeLine: card.type_line || '',
                    oracleText: card.oracle_text || '',
                    power: card.power || '',
                    toughness: card.toughness || '',
                    colors: card.colors || [],
                    colorIdentity: card.color_identity || [],
                    producedMana: card.produced_mana || [],
                    layout: card.layout || 'normal',
                });
            }
        };

        processSection(data.commanders, result.commanders);
        processSection(data.companions, result.companions);
        processSection(data.mainboard, result.mainboard);
        processSection(data.sideboard, result.sideboard);

        res.json(result);
    } catch (err) {
        console.error('[moxfield import] parse failed:', err?.message || err);
        res.status(500).json({ error: 'Failed to parse Moxfield response. Try pasting the decklist as text instead.' });
    }
});

// Diagnostics endpoint for the Moxfield client state. Useful for debugging
// rate limits and cache behavior without leaking the UA.
router.get('/moxfield/stats', (req, res) => {
    res.json(moxfieldStats());
});

module.exports = router;
