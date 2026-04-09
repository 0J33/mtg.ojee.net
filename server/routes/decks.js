const express = require('express');
const Deck = require('../models/Deck');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
    const decks = await Deck.find({ ownerId: req.user._id }).select('name format commanders createdAt updatedAt').sort({ updatedAt: -1 });
    res.json({ decks });
});

router.get('/:id', requireAuth, async (req, res) => {
    const deck = await Deck.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    res.json({ deck });
});

router.post('/', requireAuth, async (req, res) => {
    const { name, format, commanders, companions, mainboard, sideboard, importedFrom } = req.body;
    const deck = await Deck.create({
        ownerId: req.user._id,
        name: name || 'Untitled Deck',
        format: format || 'commander',
        commanders: commanders || [],
        companions: companions || [],
        mainboard: mainboard || [],
        sideboard: sideboard || [],
        importedFrom,
    });
    await req.user.updateOne({ $push: { decks: deck._id } });
    res.json({ deck });
});

router.put('/:id', requireAuth, async (req, res) => {
    const { name, format, commanders, companions, mainboard, sideboard } = req.body;
    const deck = await Deck.findOneAndUpdate(
        { _id: req.params.id, ownerId: req.user._id },
        { name, format, commanders, companions, mainboard, sideboard, updatedAt: Date.now() },
        { new: true }
    );
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    res.json({ deck });
});

router.delete('/:id', requireAuth, async (req, res) => {
    const deck = await Deck.findOneAndDelete({ _id: req.params.id, ownerId: req.user._id });
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    await req.user.updateOne({ $pull: { decks: deck._id } });
    res.json({ success: true });
});

module.exports = router;
