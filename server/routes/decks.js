const express = require('express');
const mongoose = require('mongoose');
const Deck = require('../models/Deck');
const CustomCard = require('../models/CustomCard');
const Share = require('../models/Share');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Short share-code generator — 8 characters from an unambiguous alphabet
// (no 0/O/1/I). Retries on collision against the Share collection.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return code;
}
async function createUniqueShare({ type, ownerId, payload }) {
    // 5 attempts is way more than enough — collision probability at 8 chars
    // from 32 = 32^8 ≈ 1.1e12 slots is effectively zero.
    for (let i = 0; i < 5; i++) {
        const code = generateCode();
        try {
            const doc = await Share.create({ code, type, ownerId, payload });
            return doc;
        } catch (err) {
            if (err?.code === 11000) continue; // duplicate key, retry
            throw err;
        }
    }
    throw new Error('Could not allocate a unique share code');
}

router.get('/', requireAuth, async (req, res) => {
    const decks = await Deck.find({ ownerId: req.user._id }).select('name format commanders notFound createdAt updatedAt sharedByUsername sharedByUserId').sort({ updatedAt: -1 });
    res.json({ decks });
});

router.get('/:id', requireAuth, async (req, res) => {
    const deck = await Deck.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    res.json({ deck });
});

// Snapshot the custom-card author username on every `isCustom` entry in an
// array of deck sections. Called at create and update time so the UI can
// render "by <username>" without needing a cross-user User lookup later.
async function hydrateCustomAuthors(sections) {
    // Collect every (originId, ownerId) pair we still need to resolve.
    const needed = new Map(); // key → { originId, ownerId }
    const collect = (arr) => {
        for (const e of (arr || [])) {
            if (!e || !e.isCustom) continue;
            if (e.customCardAuthorUsername) continue;
            if (!e.customCardOwnerId) continue;
            const key = String(e.customCardOwnerId);
            if (!needed.has(key)) needed.set(key, e.customCardOwnerId);
        }
    };
    for (const section of Object.values(sections)) collect(section);
    if (needed.size === 0) return;

    const User = require('../models/User');
    const users = await User.find({ _id: { $in: Array.from(needed.values()) } }).select('username').lean();
    const usernameById = new Map(users.map(u => [String(u._id), u.username]));

    for (const arr of Object.values(sections)) {
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
            if (!e || !e.isCustom) continue;
            if (e.customCardAuthorUsername) continue;
            if (!e.customCardOwnerId) continue;
            const uname = usernameById.get(String(e.customCardOwnerId));
            if (uname) e.customCardAuthorUsername = uname;
        }
    }
}

router.post('/', requireAuth, async (req, res) => {
    const { name, format, commanders, companions, mainboard, sideboard, tokens, notFound, importedFrom } = req.body;
    const sections = {
        commanders: [...(commanders || [])],
        companions: [...(companions || [])],
        mainboard: [...(mainboard || [])],
        sideboard: [...(sideboard || [])],
    };
    await hydrateCustomAuthors(sections);
    const deck = await Deck.create({
        ownerId: req.user._id,
        name: name || 'Untitled Deck',
        format: format || 'commander',
        commanders: sections.commanders,
        companions: sections.companions,
        mainboard: sections.mainboard,
        sideboard: sections.sideboard,
        tokens: tokens || [],
        notFound: notFound || [],
        importedFrom,
    });
    await req.user.updateOne({ $push: { decks: deck._id } });
    res.json({ deck });
});

router.put('/:id', requireAuth, async (req, res) => {
    const { name, format, commanders, companions, mainboard, sideboard, tokens } = req.body;
    // Only update fields that are provided (avoid clearing data on partial updates like rename)
    const update = { updatedAt: Date.now() };
    if (name !== undefined) update.name = name;
    if (format !== undefined) update.format = format;
    if (tokens !== undefined) update.tokens = tokens;
    // Re-hydrate authorUsername on any newly-added custom entries before
    // saving so edits made in DeckBuilder pick up the right name without
    // the client having to compute it.
    const sectionPatches = { commanders, companions, mainboard, sideboard };
    const provided = Object.fromEntries(Object.entries(sectionPatches).filter(([, v]) => v !== undefined));
    if (Object.keys(provided).length > 0) {
        await hydrateCustomAuthors(provided);
        Object.assign(update, provided);
    }

    const deck = await Deck.findOneAndUpdate(
        { _id: req.params.id, ownerId: req.user._id },
        update,
        { new: true }
    );
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    res.json({ deck });
});

// Create a share code for the given deck. The deck snapshot (including any
// embedded custom-card data — deck entries already carry customImageUrl etc.
// inline) is stored server-side in the Share collection; the client gets
// back a short code to pass around. Old base64-blob behavior is gone.
router.get('/:id/share', requireAuth, async (req, res) => {
    const deck = await Deck.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    try {
        const share = await createUniqueShare({
            type: 'deck',
            ownerId: req.user._id,
            payload: {
                name: deck.name,
                format: deck.format,
                commanders: deck.commanders,
                companions: deck.companions,
                mainboard: deck.mainboard,
                sideboard: deck.sideboard,
            },
        });
        res.json({ code: share.code, deckName: deck.name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Import a shared deck by code.
//
// `customCardMode` controls how embedded custom cards are handled:
//   - 'copy' (default, safer): create new CustomCard records owned by the
//     importer with fresh originIds. The deck entries are re-pointed at the
//     new cards. The importer can edit them without affecting anyone else.
//   - 'link': leave deck entries' (customCardOriginId, customCardOwnerId)
//     pointing at the sharer's cards. The importer does NOT get a
//     CustomCard record for them, but when the sharer edits those cards
//     server-side, the fan-out propagates straight into this deck.
router.post('/share/import', requireAuth, async (req, res) => {
    const { code, customCardMode } = req.body || {};
    const mode = customCardMode === 'link' ? 'link' : 'copy';
    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Share code required' });
    }
    const share = await Share.findOne({ code: code.trim().toUpperCase(), type: 'deck' });
    if (!share) return res.status(404).json({ error: 'Share code not found or expired' });
    const d = share.payload || {};

    // Shallow clone sections so we can rewrite entries without mutating
    // the share payload (shares are reusable).
    const sections = {
        commanders: (d.commanders || []).map(e => ({ ...e })),
        companions: (d.companions || []).map(e => ({ ...e })),
        mainboard: (d.mainboard || []).map(e => ({ ...e })),
        sideboard: (d.sideboard || []).map(e => ({ ...e })),
    };

    // Resolve the sharer's username for display ("Shared by X"). Skip
    // silently if we can't — the share might be older than this feature.
    let sharedByUsername = null;
    let sharedByUserId = null;
    if (share.ownerId) {
        const User = require('../models/User');
        const sharer = await User.findById(share.ownerId).select('username').lean();
        if (sharer) {
            sharedByUsername = sharer.username;
            sharedByUserId = sharer._id;
        }
    }

    if (mode === 'copy') {
        // Collect unique custom cards by (originId || name) and create
        // fresh CustomCard records owned by the importer. Then rewrite
        // every matching deck entry to point at the new records.
        const uniqByKey = new Map();
        const allEntries = [
            ...sections.commanders, ...sections.companions,
            ...sections.mainboard, ...sections.sideboard,
        ];
        for (const e of allEntries) {
            if (!e || !e.isCustom) continue;
            const key = e.customCardOriginId || `name:${e.name}`;
            if (!uniqByKey.has(key)) uniqByKey.set(key, e);
        }

        // Dedupe against existing custom cards the importer already owns
        // (by name) so re-importing the same share twice doesn't double up.
        const existing = await CustomCard.find({ ownerId: req.user._id }).lean();
        const existingByName = new Map(existing.map(c => [c.name, c]));

        // originId of source → importer's new card record
        const remap = new Map();
        for (const [key, e] of uniqByKey) {
            let importerCard = existingByName.get(e.name);
            if (!importerCard) {
                const originId = new mongoose.Types.ObjectId().toString();
                importerCard = await CustomCard.create({
                    ownerId: req.user._id,
                    originId,
                    name: e.name || 'Custom Card',
                    imageUrl: e.customImageUrl || e.imageUri || '',
                    manaCost: e.manaCost || '',
                    typeLine: e.typeLine || '',
                    oracleText: e.oracleText || '',
                    power: e.power || '',
                    toughness: e.toughness || '',
                    colors: e.colors || [],
                });
            }
            remap.set(key, importerCard);
        }

        // Rewrite every custom entry in every section to point at the
        // importer's copy. The inline data is also refreshed from the
        // importer's card (usually identical, but consistent).
        for (const section of Object.keys(sections)) {
            sections[section] = sections[section].map(e => {
                if (!e || !e.isCustom) return e;
                const key = e.customCardOriginId || `name:${e.name}`;
                const mine = remap.get(key);
                if (!mine) return e;
                return {
                    ...e,
                    name: mine.name,
                    imageUri: mine.imageUrl,
                    customImageUrl: mine.imageUrl,
                    manaCost: mine.manaCost,
                    typeLine: mine.typeLine,
                    oracleText: mine.oracleText,
                    power: mine.power,
                    toughness: mine.toughness,
                    colors: mine.colors,
                    customCardOriginId: mine.originId,
                    customCardOwnerId: mine._id ? mine.ownerId : undefined, // ownerId on the card = importer
                    customCardAuthorUsername: req.user.username, // copies are authored by the importer
                };
            });
        }
    }
    // mode === 'link' — do nothing to the entries; they keep pointing at the
    // sharer. Their customCardAuthorUsername should snapshot the sharer's
    // name (if the embedded entries don't already carry it), so the UI can
    // show "by <sharer>" without any lookup.
    if (mode === 'link') {
        for (const section of Object.keys(sections)) {
            for (const e of sections[section]) {
                if (!e || !e.isCustom) continue;
                if (!e.customCardAuthorUsername && sharedByUsername) {
                    e.customCardAuthorUsername = sharedByUsername;
                }
            }
        }
    }
    // Belt + suspenders: if any entries are still missing author usernames
    // (legacy shares without the field) try to resolve them now.
    await hydrateCustomAuthors(sections);

    const deck = await Deck.create({
        ownerId: req.user._id,
        name: d.name || 'Shared Deck',
        format: d.format || 'commander',
        commanders: sections.commanders,
        companions: sections.companions,
        mainboard: sections.mainboard,
        sideboard: sections.sideboard,
        sharedByUsername,
        sharedByUserId,
    });
    await req.user.updateOne({ $push: { decks: deck._id } });

    res.json({ deck });
});

router.delete('/:id', requireAuth, async (req, res) => {
    const deck = await Deck.findOneAndDelete({ _id: req.params.id, ownerId: req.user._id });
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    await req.user.updateOne({ $pull: { decks: deck._id } });
    res.json({ success: true });
});

module.exports = router;
