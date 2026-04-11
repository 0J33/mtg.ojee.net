const express = require('express');
const CustomCard = require('../models/CustomCard');
const Share = require('../models/Share');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Mirrors the share-code generator in routes/decks.js. Kept local so the tiny
// helper doesn't need its own module.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return code;
}
async function createUniqueShare({ type, ownerId, payload }) {
    for (let i = 0; i < 5; i++) {
        const code = generateCode();
        try {
            return await Share.create({ code, type, ownerId, payload });
        } catch (err) {
            if (err?.code === 11000) continue;
            throw err;
        }
    }
    throw new Error('Could not allocate a unique share code');
}

router.get('/', requireAuth, async (req, res) => {
    const cards = await CustomCard.find({ ownerId: req.user._id }).sort({ updatedAt: -1 });
    res.json({ cards });
});

router.post('/', requireAuth, async (req, res) => {
    const { name, imageUrl, manaCost, typeLine, oracleText, power, toughness, colors } = req.body;
    const card = await CustomCard.create({
        ownerId: req.user._id,
        name: name || 'Custom Card',
        imageUrl: imageUrl || '',
        manaCost: manaCost || '',
        typeLine: typeLine || '',
        oracleText: oracleText || '',
        power: power || '',
        toughness: toughness || '',
        colors: colors || [],
    });
    res.json({ card });
});

router.put('/:id', requireAuth, async (req, res) => {
    const { name, imageUrl, manaCost, typeLine, oracleText, power, toughness, colors } = req.body;
    const card = await CustomCard.findOneAndUpdate(
        { _id: req.params.id, ownerId: req.user._id },
        { name, imageUrl, manaCost, typeLine, oracleText, power, toughness, colors, updatedAt: Date.now() },
        { new: true }
    );
    if (!card) return res.status(404).json({ error: 'Card not found' });
    res.json({ card });
});

router.delete('/:id', requireAuth, async (req, res) => {
    const card = await CustomCard.findOneAndDelete({ _id: req.params.id, ownerId: req.user._id });
    if (!card) return res.status(404).json({ error: 'Card not found' });
    res.json({ success: true });
});

router.get('/:id/share', requireAuth, async (req, res) => {
    const card = await CustomCard.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!card) return res.status(404).json({ error: 'Card not found' });
    try {
        const share = await createUniqueShare({
            type: 'customCard',
            ownerId: req.user._id,
            payload: {
                name: card.name,
                imageUrl: card.imageUrl,
                manaCost: card.manaCost,
                typeLine: card.typeLine,
                oracleText: card.oracleText,
                power: card.power,
                toughness: card.toughness,
                colors: card.colors,
            },
        });
        res.json({ code: share.code, cardName: card.name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/share/import', requireAuth, async (req, res) => {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Share code required' });
    }
    const share = await Share.findOne({ code: code.trim().toUpperCase(), type: 'customCard' });
    if (!share) return res.status(404).json({ error: 'Share code not found or expired' });
    const c = share.payload || {};
    const card = await CustomCard.create({
        ownerId: req.user._id,
        name: c.name || 'Custom Card',
        imageUrl: c.imageUrl || '',
        manaCost: c.manaCost || '',
        typeLine: c.typeLine || '',
        oracleText: c.oracleText || '',
        power: c.power || '',
        toughness: c.toughness || '',
        colors: c.colors || [],
    });
    res.json({ card });
});

module.exports = router;
