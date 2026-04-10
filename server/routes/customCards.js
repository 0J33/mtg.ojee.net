const express = require('express');
const CustomCard = require('../models/CustomCard');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

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

module.exports = router;
