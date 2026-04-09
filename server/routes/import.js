const express = require('express');
const router = express.Router();

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
            const name = match[2].replace(/\s*\*[FE]\*\s*$/, '').trim(); // strip foil markers
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
                const info = nameToSection[card.name];
                if (info) {
                    entry.quantity = info.quantity;
                    result[info.section].push(entry);
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

// Import from Moxfield URL
router.post('/moxfield', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Moxfield URL required' });

    const match = url.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/);
    if (!match) return res.status(400).json({ error: 'Invalid Moxfield URL' });

    const deckId = match[1];

    try {
        const response = await fetch(`https://api2.moxfield.com/v3/decks/all/${deckId}`, {
            headers: {
                'User-Agent': 'MTGOjeeNet/1.0',
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch from Moxfield. Try pasting the decklist as text instead.' });
        }

        const data = await response.json();
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
        console.error('Moxfield fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch from Moxfield. Try pasting the decklist as text instead.' });
    }
});

module.exports = router;
