const express = require('express');
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
    const decks = await Deck.find({ ownerId: req.user._id }).select('name format commanders notFound createdAt updatedAt').sort({ updatedAt: -1 });
    res.json({ decks });
});

router.get('/:id', requireAuth, async (req, res) => {
    const deck = await Deck.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    res.json({ deck });
});

router.post('/', requireAuth, async (req, res) => {
    const { name, format, commanders, companions, mainboard, sideboard, notFound, importedFrom } = req.body;
    const deck = await Deck.create({
        ownerId: req.user._id,
        name: name || 'Untitled Deck',
        format: format || 'commander',
        commanders: commanders || [],
        companions: companions || [],
        mainboard: mainboard || [],
        sideboard: sideboard || [],
        notFound: notFound || [],
        importedFrom,
    });
    await req.user.updateOne({ $push: { decks: deck._id } });
    res.json({ deck });
});

router.put('/:id', requireAuth, async (req, res) => {
    const { name, format, commanders, companions, mainboard, sideboard } = req.body;
    // Only update fields that are provided (avoid clearing data on partial updates like rename)
    const update = { updatedAt: Date.now() };
    if (name !== undefined) update.name = name;
    if (format !== undefined) update.format = format;
    if (commanders !== undefined) update.commanders = commanders;
    if (companions !== undefined) update.companions = companions;
    if (mainboard !== undefined) update.mainboard = mainboard;
    if (sideboard !== undefined) update.sideboard = sideboard;

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

// Import a shared deck by code. If the snapshot contains custom cards, also
// create CustomCard records for them so the user can reuse those cards in
// other decks (deduped by name).
router.post('/share/import', requireAuth, async (req, res) => {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Share code required' });
    }
    const share = await Share.findOne({ code: code.trim().toUpperCase(), type: 'deck' });
    if (!share) return res.status(404).json({ error: 'Share code not found or expired' });
    const d = share.payload || {};

    const deck = await Deck.create({
        ownerId: req.user._id,
        name: d.name || 'Shared Deck',
        format: d.format || 'commander',
        commanders: d.commanders || [],
        companions: d.companions || [],
        mainboard: d.mainboard || [],
        sideboard: d.sideboard || [],
    });
    await req.user.updateOne({ $push: { decks: deck._id } });

    // Seed the user's CustomCard library with any custom entries in the
    // deck they don't already have (by name). Not an error if this fails —
    // the deck itself is complete without the library records.
    try {
        const allEntries = [
            ...(d.commanders || []),
            ...(d.mainboard || []),
            ...(d.sideboard || []),
            ...(d.companions || []),
        ];
        const customs = allEntries.filter(e => e && e.isCustom);
        if (customs.length > 0) {
            const existingNames = new Set(
                (await CustomCard.find({ ownerId: req.user._id }).select('name')).map(c => c.name)
            );
            const toCreate = [];
            const seen = new Set();
            for (const c of customs) {
                const key = c.name || '';
                if (!key || seen.has(key) || existingNames.has(key)) continue;
                seen.add(key);
                toCreate.push({
                    ownerId: req.user._id,
                    name: c.name,
                    imageUrl: c.customImageUrl || c.imageUri || '',
                    manaCost: c.manaCost || '',
                    typeLine: c.typeLine || '',
                    oracleText: c.oracleText || '',
                    power: c.power || '',
                    toughness: c.toughness || '',
                    colors: c.colors || [],
                });
            }
            if (toCreate.length > 0) await CustomCard.insertMany(toCreate);
        }
    } catch (err) {
        console.warn('[deck share import] custom card seeding failed:', err.message);
    }

    res.json({ deck });
});

router.delete('/:id', requireAuth, async (req, res) => {
    const deck = await Deck.findOneAndDelete({ _id: req.params.id, ownerId: req.user._id });
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    await req.user.updateOne({ $pull: { decks: deck._id } });
    res.json({ success: true });
});

module.exports = router;
