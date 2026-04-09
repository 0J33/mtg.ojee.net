const mongoose = require('mongoose');

const cardEntrySchema = new mongoose.Schema({
    scryfallId: { type: String },
    name: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    imageUri: { type: String },
    backImageUri: { type: String },
    manaCost: { type: String },
    typeLine: { type: String },
    oracleText: { type: String },
    power: { type: String },
    toughness: { type: String },
    colors: [String],
    colorIdentity: [String],
    layout: { type: String },
    isCustom: { type: Boolean, default: false },
    customImageUrl: { type: String },
}, { _id: false });

const deckSchema = new mongoose.Schema({
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, default: 'Untitled Deck' },
    format: { type: String, default: 'commander' },
    commanders: [cardEntrySchema],
    companions: [cardEntrySchema],
    mainboard: [cardEntrySchema],
    sideboard: [cardEntrySchema],
    importedFrom: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Deck', deckSchema);
