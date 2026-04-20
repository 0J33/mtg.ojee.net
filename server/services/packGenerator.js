/**
 * Booster pack generator using Scryfall card data.
 *
 * Generates realistic draft/play booster packs from any set by fetching cards
 * from Scryfall grouped by rarity, then randomly selecting the standard
 * distribution: 1 rare/mythic (1/8 mythic), 3 uncommons, 10 commons, 1 basic land.
 *
 * Card pools are cached in memory per set code (they rarely change).
 */

const SCRYFALL_BASE = 'https://api.scryfall.com';

// In-memory cache: setCode → { commons, uncommons, rares, mythics, basics, setName }
const poolCache = new Map();

// Rate-limit Scryfall requests (100ms between calls)
let lastRequest = 0;
async function scryfallFetch(url) {
    const now = Date.now();
    const wait = Math.max(0, 100 - (now - lastRequest));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequest = Date.now();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Scryfall ${res.status}: ${await res.text()}`);
    return res.json();
}

// Fetch all pages of a Scryfall search
async function scryfallSearchAll(query) {
    let url = `${SCRYFALL_BASE}/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=set`;
    const cards = [];
    while (url) {
        const data = await scryfallFetch(url);
        cards.push(...(data.data || []));
        url = data.has_more ? data.next_page : null;
    }
    return cards;
}

const DFC_LAYOUTS = new Set([
    'transform', 'modal_dfc', 'double_faced_token', 'reversible_card', 'meld', 'battle',
]);
function extractFaces(card) {
    const faces = card?.card_faces;
    if (!Array.isArray(faces) || faces.length < 2) return null;
    return faces.map(f => ({
        name: f.name || '',
        manaCost: f.mana_cost || '',
        typeLine: f.type_line || '',
        oracleText: f.oracle_text || '',
        power: f.power || '',
        toughness: f.toughness || '',
        colors: Array.isArray(f.colors) ? f.colors : [],
    }));
}

function cardToEntry(card) {
    const face = card.card_faces?.[0];
    const isDfc = DFC_LAYOUTS.has(card.layout);
    return {
        scryfallId: card.id,
        name: card.name,
        imageUri: card.image_uris?.normal || face?.image_uris?.normal || '',
        backImageUri: isDfc ? (card.card_faces?.[1]?.image_uris?.normal || '') : '',
        manaCost: card.mana_cost || face?.mana_cost || '',
        typeLine: card.type_line || face?.type_line || '',
        oracleText: card.oracle_text || face?.oracle_text || '',
        power: card.power || face?.power || '',
        toughness: card.toughness || face?.toughness || '',
        colors: card.colors || face?.colors || [],
        colorIdentity: card.color_identity || [],
        producedMana: card.produced_mana || [],
        layout: card.layout || 'normal',
        rarity: card.rarity,
        faces: extractFaces(card),
        keywords: Array.isArray(card.keywords) ? card.keywords : [],
    };
}

/**
 * Fetch and cache the card pool for a set, grouped by rarity.
 */
async function getSetPool(setCode) {
    const code = setCode.toLowerCase();
    if (poolCache.has(code)) return poolCache.get(code);

    // Fetch all cards in the set, excluding tokens and basic lands (fetched separately)
    const [allCards, basicCards] = await Promise.all([
        scryfallSearchAll(`set:${code} -t:basic -is:token -layout:token`),
        scryfallSearchAll(`set:${code} t:basic`).catch(() => []),
    ]);

    const pool = {
        commons: [],
        uncommons: [],
        rares: [],
        mythics: [],
        basics: [],
        setName: allCards[0]?.set_name || code.toUpperCase(),
    };

    for (const card of allCards) {
        const entry = cardToEntry(card);
        switch (card.rarity) {
            case 'common': pool.commons.push(entry); break;
            case 'uncommon': pool.uncommons.push(entry); break;
            case 'rare': pool.rares.push(entry); break;
            case 'mythic': pool.mythics.push(entry); break;
        }
    }
    for (const card of basicCards) {
        pool.basics.push(cardToEntry(card));
    }

    poolCache.set(code, pool);
    return pool;
}

function pickRandom(arr, count = 1, exclude = new Set()) {
    const available = arr.filter(c => !exclude.has(c.scryfallId));
    if (available.length === 0) return [];
    const picked = [];
    const used = new Set();
    for (let i = 0; i < count && available.length > 0; i++) {
        let attempts = 0;
        while (attempts < 50) {
            const idx = Math.floor(Math.random() * available.length);
            const card = available[idx];
            if (!used.has(card.scryfallId)) {
                used.add(card.scryfallId);
                picked.push(card);
                break;
            }
            attempts++;
        }
    }
    return picked;
}

/**
 * Generate a single booster pack from a set.
 * Standard distribution: 1 rare/mythic, 3 uncommons, 10 commons, 1 basic land.
 * Mythic chance: 1 in 8 (if mythics exist in the set).
 */
async function generatePack(setCode) {
    const pool = await getSetPool(setCode);
    if (pool.commons.length === 0 && pool.uncommons.length === 0) {
        throw new Error(`Set ${setCode} has no cards available for pack generation`);
    }

    const usedIds = new Set();
    const cards = [];

    // 1 rare or mythic (1/8 chance of mythic if mythics exist)
    const isMythic = pool.mythics.length > 0 && Math.random() < 1 / 8;
    const rarePool = isMythic ? pool.mythics : pool.rares;
    const rare = pickRandom(rarePool.length > 0 ? rarePool : pool.rares, 1, usedIds);
    rare.forEach(c => { usedIds.add(c.scryfallId); cards.push(c); });

    // 3 uncommons
    const uncommons = pickRandom(pool.uncommons, 3, usedIds);
    uncommons.forEach(c => { usedIds.add(c.scryfallId); cards.push(c); });

    // 10 commons
    const commons = pickRandom(pool.commons, 10, usedIds);
    commons.forEach(c => { usedIds.add(c.scryfallId); cards.push(c); });

    // 1 basic land
    if (pool.basics.length > 0) {
        const basic = pickRandom(pool.basics, 1);
        cards.push(...basic);
    }

    return cards;
}

/**
 * Generate a sealed pool (multiple packs).
 */
async function generateSealedPool(setCode, packCount = 6) {
    const packs = [];
    for (let i = 0; i < packCount; i++) {
        packs.push(await generatePack(setCode));
    }
    // Flatten all packs into one pool
    return { packs, pool: packs.flat() };
}

/**
 * Get list of draftable sets from Scryfall.
 */
async function getDraftableSets() {
    const data = await scryfallFetch(`${SCRYFALL_BASE}/sets`);
    const sets = (data.data || [])
        .filter(s => ['expansion', 'core', 'masters', 'draft_innovation'].includes(s.set_type))
        .filter(s => s.card_count > 50) // filter out tiny sets
        .map(s => ({
            code: s.code,
            name: s.name,
            releaseDate: s.released_at,
            type: s.set_type,
            iconUri: s.icon_svg_uri,
            cardCount: s.card_count,
        }))
        .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
    return sets;
}

// Cache draftable sets (refreshed at most once per hour)
let setsCache = null;
let setsCacheTime = 0;
async function getCachedDraftableSets() {
    if (setsCache && Date.now() - setsCacheTime < 3600000) return setsCache;
    setsCache = await getDraftableSets();
    setsCacheTime = Date.now();
    return setsCache;
}

module.exports = {
    generatePack,
    generateSealedPool,
    getSetPool,
    getDraftableSets: getCachedDraftableSets,
};
