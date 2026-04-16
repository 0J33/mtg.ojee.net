const express = require('express');
const router = express.Router();
const { fetchMoxfieldDeck, stats: moxfieldStats } = require('../moxfieldClient');

const SCRYFALL_BASE = 'https://api.scryfall.com';

// Construct a Scryfall card image URL from a scryfall_id. Moxfield's v3 API
// strips image_uris from card payloads, so we have to build them ourselves
// from the well-known cards.scryfall.io path layout:
//   https://cards.scryfall.io/normal/{front|back}/{a}/{b}/{id}.jpg
// where a and b are the first two characters of the id.
function scryfallImageFromId(scryfallId, side = 'front') {
    if (!scryfallId || typeof scryfallId !== 'string' || scryfallId.length < 2) return '';
    const a = scryfallId[0];
    const b = scryfallId[1];
    return `https://cards.scryfall.io/normal/${side}/${a}/${b}/${scryfallId}.jpg`;
}

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
        textless: !!card.textless,
        nonEnglish: !!(card.lang && card.lang !== 'en'),
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
        const result = { commanders: [], companions: [], mainboard: [], sideboard: [], tokens: [], notFound: [] };

        // Moxfield API has two response shapes depending on the endpoint
        // version we got back from the fallback chain in moxfieldClient:
        //   v2 (api.moxfield.com): data.<board>           = { id: { card, quantity } }
        //   v3 (api2.moxfield.com): data.boards.<board>.cards = { id: { card, quantity } }
        // getSection normalizes them.
        const getSection = (name) => {
            if (data?.boards?.[name]?.cards) return data.boards[name].cards;
            if (data?.[name]) return data[name];
            return null;
        };

        const processSection = (section, target) => {
            if (!section) return;
            for (const [, entry] of Object.entries(section)) {
                const card = entry.card;
                if (!card) continue;
                const sid = card.scryfall_id || card.id;
                const frontFromId = scryfallImageFromId(sid, 'front');
                const backFromId = card.card_faces && card.card_faces.length > 1
                    ? scryfallImageFromId(sid, 'back')
                    : '';
                const face0 = card.card_faces?.[0];
                const face1 = card.card_faces?.[1];
                // Moxfield marks foil via entry.isFoil (v2) or entry.finish === 'foil' (v3)
                const foilFinish = entry.finish === 'etched' ? 'etched'
                    : (!!entry.isFoil || entry.finish === 'foil') ? 'foil'
                    : null;
                target.push({
                    scryfallId: sid,
                    name: card.name,
                    quantity: entry.quantity || 1,
                    imageUri: card.image_uris?.normal
                        || face0?.image_uris?.normal
                        || frontFromId,
                    backImageUri: face1?.image_uris?.normal || backFromId,
                    manaCost: card.mana_cost || face0?.mana_cost || '',
                    typeLine: card.type_line || card.type || face0?.type_line || '',
                    oracleText: card.oracle_text || face0?.oracle_text || '',
                    power: card.power || face0?.power || '',
                    toughness: card.toughness || face0?.toughness || '',
                    colors: card.colors || face0?.colors || [],
                    colorIdentity: card.color_identity || [],
                    producedMana: card.produced_mana || face0?.produced_mana || [],
                    layout: card.layout || 'normal',
                    foil: foilFinish,
                });
            }
        };

        processSection(getSection('commanders'), result.commanders);
        processSection(getSection('companions'), result.companions);
        processSection(getSection('mainboard'), result.mainboard);
        processSection(getSection('sideboard'), result.sideboard);

        // Extract related tokens from the d.tokens array. Moxfield includes
        // all related cards (tokens, emblems, copies); filter to actual tokens
        // by checking layout or type_line. Deduplicate by name.
        //
        // Moxfield v3 strips image_uris and some data from these entries, so
        // we batch-fetch the full card data from Scryfall's /cards/collection
        // endpoint to get real art, type line, oracle text, etc.
        if (Array.isArray(data.tokens)) {
            const seenTokenNames = new Set();
            const tokenRefs = [];
            for (const card of data.tokens) {
                const tl = (card.type_line || '').toLowerCase();
                const layout = (card.layout || '').toLowerCase();
                if (layout === 'token' || tl.includes('token')) {
                    if (seenTokenNames.has(card.name)) continue;
                    seenTokenNames.add(card.name);
                    const sid = card.scryfall_id || card.id;
                    tokenRefs.push({ sid, moxCard: card });
                }
            }

            // Batch-fetch up to 75 cards at a time from Scryfall's collection API
            const scryfallTokens = new Map(); // scryfallId → full card
            for (let i = 0; i < tokenRefs.length; i += 75) {
                const batch = tokenRefs.slice(i, i + 75).filter(r => r.sid);
                if (batch.length === 0) continue;
                try {
                    const res = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            identifiers: batch.map(r => ({ id: r.sid })),
                        }),
                    });
                    if (res.ok) {
                        const json = await res.json();
                        for (const c of (json.data || [])) {
                            scryfallTokens.set(c.id, c);
                        }
                    }
                } catch (err) {
                    console.error('[moxfield import] Scryfall token fetch failed:', err.message);
                }
            }

            for (const { sid, moxCard } of tokenRefs) {
                const sc = scryfallTokens.get(sid);
                const face = sc?.card_faces?.[0];
                result.tokens.push({
                    scryfallId: sc?.id || sid,
                    name: sc?.name || moxCard.name,
                    quantity: 1,
                    imageUri: sc?.image_uris?.normal || face?.image_uris?.normal || scryfallImageFromId(sid, 'front'),
                    backImageUri: sc?.card_faces?.[1]?.image_uris?.normal || '',
                    manaCost: sc?.mana_cost || face?.mana_cost || moxCard.mana_cost || '',
                    typeLine: sc?.type_line || face?.type_line || moxCard.type_line || '',
                    oracleText: sc?.oracle_text || face?.oracle_text || moxCard.oracle_text || '',
                    power: sc?.power || face?.power || moxCard.power || '',
                    toughness: sc?.toughness || face?.toughness || moxCard.toughness || '',
                    colors: sc?.colors || face?.colors || moxCard.colors || [],
                    colorIdentity: sc?.color_identity || moxCard.color_identity || [],
                    producedMana: sc?.produced_mana || [],
                    layout: sc?.layout || moxCard.layout || 'token',
                });
            }
        }

        // Batch-fetch textless flag from Scryfall for all cards. Moxfield
        // doesn't include this. We use /cards/collection (75 per call).
        const allCards = [...result.commanders, ...result.companions, ...result.mainboard, ...result.sideboard];
        const uniqueIds = [...new Set(allCards.filter(c => c.scryfallId).map(c => c.scryfallId))];
        const cardFlags = new Map(); // scryfallId → { textless, nonEnglish }
        for (let i = 0; i < uniqueIds.length; i += 75) {
            const batch = uniqueIds.slice(i, i + 75);
            try {
                const tfRes = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifiers: batch.map(id => ({ id })) }),
                });
                if (tfRes.ok) {
                    const tfJson = await tfRes.json();
                    for (const c of (tfJson.data || [])) {
                        // Heuristic: textless flag is the strongest signal, but some
                        // printings are effectively textless too (art series, tokens,
                        // Secret Lair "poster" treatments with stylized hard-to-read
                        // text). Users can manually toggle via context menu for misses.
                        const isTextless = !!c.textless
                            || c.layout === 'art_series'
                            || (c.layout === 'token' && !c.oracle_text)
                            || (Array.isArray(c.promo_types) && c.promo_types.includes('poster'));
                        cardFlags.set(c.id, {
                            textless: isTextless,
                            nonEnglish: c.lang && c.lang !== 'en',
                        });
                    }
                }
            } catch (err) {
                console.error('[moxfield import] card flags fetch failed:', err.message);
            }
        }
        for (const c of allCards) {
            const flags = cardFlags.get(c.scryfallId);
            c.textless = flags?.textless || false;
            c.nonEnglish = flags?.nonEnglish || false;
        }

        const total = result.commanders.length + result.companions.length
            + result.mainboard.length + result.sideboard.length;
        if (total === 0) {
            console.warn('[moxfield import] parsed 0 cards from response. Top keys:', Object.keys(data || {}).join(','));
        }

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
