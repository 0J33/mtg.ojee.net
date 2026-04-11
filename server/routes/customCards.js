const express = require('express');
const CustomCard = require('../models/CustomCard');
const Deck = require('../models/Deck');
const Share = require('../models/Share');
const { requireAuth } = require('../middleware/auth');
const mongoose = require('mongoose');

const router = express.Router();

// When a CustomCard is edited, fan the new inline data out to every deck
// entry that was made from that specific version. The match key is the pair
// (customCardOriginId, customCardOwnerId) — this is what lets "linked"
// shared decks automatically see the original author's edits.
async function propagateCustomCardEdit(card) {
    if (!card || !card.originId) return { decksUpdated: 0, entriesUpdated: 0 };
    // Find every deck with at least one entry that matches this exact
    // (originId, ownerId). Cross-user query — we need to update shared /
    // linked decks owned by other people too.
    const filter = {
        $or: [
            { 'commanders.customCardOriginId': card.originId, 'commanders.customCardOwnerId': card.ownerId },
            { 'companions.customCardOriginId': card.originId, 'companions.customCardOwnerId': card.ownerId },
            { 'mainboard.customCardOriginId': card.originId, 'mainboard.customCardOwnerId': card.ownerId },
            { 'sideboard.customCardOriginId': card.originId, 'sideboard.customCardOwnerId': card.ownerId },
        ],
    };
    const decks = await Deck.find(filter);
    let entriesUpdated = 0;
    for (const deck of decks) {
        let touched = false;
        for (const section of ['commanders', 'companions', 'mainboard', 'sideboard']) {
            const arr = deck[section];
            if (!Array.isArray(arr)) continue;
            for (const entry of arr) {
                if (!entry || !entry.isCustom) continue;
                if (String(entry.customCardOriginId) !== String(card.originId)) continue;
                if (String(entry.customCardOwnerId) !== String(card.ownerId)) continue;
                // Overwrite the inline fields that the CustomCard controls.
                // Quantity, scryfallId, etc. stay put.
                entry.name = card.name;
                entry.imageUri = card.imageUrl || '';
                entry.customImageUrl = card.imageUrl || '';
                entry.manaCost = card.manaCost || '';
                entry.typeLine = card.typeLine || '';
                entry.oracleText = card.oracleText || '';
                entry.power = card.power || '';
                entry.toughness = card.toughness || '';
                entry.colors = card.colors || [];
                entriesUpdated++;
                touched = true;
            }
        }
        if (touched) {
            deck.updatedAt = Date.now();
            await deck.save();
        }
    }
    return { decksUpdated: decks.length, entriesUpdated };
}

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
    // originId is assigned up-front from a pre-generated ObjectId so the
    // doc is internally consistent from the first save. Fresh cards are
    // their own "origin".
    const originId = new mongoose.Types.ObjectId().toString();
    const card = await CustomCard.create({
        ownerId: req.user._id,
        originId,
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
    // Fan the edits out to every deck entry made from this card, including
    // across other users who linked to it via a shared deck import.
    try {
        const fanout = await propagateCustomCardEdit(card);
        if (fanout.entriesUpdated > 0) {
            console.log(`[customCards] edit propagated to ${fanout.entriesUpdated} deck entries in ${fanout.decksUpdated} decks`);
        }
    } catch (err) {
        console.warn('[customCards] edit propagation failed:', err.message);
    }
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
