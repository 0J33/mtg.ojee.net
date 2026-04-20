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
    // Pointers to the CustomCard record this entry was made from. They make
    // the entry "linked" — editing the referenced custom card will fan out
    // to every deck entry with matching (originId, ownerId). Missing on
    // pre-migration entries; backfilled at startup.
    customCardOriginId: { type: String },
    customCardOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Snapshot of the custom card author's username at create/import time,
    // so the UI can render "by <username>" without a cross-user User lookup.
    // Not automatically updated if a username changes (usernames are
    // effectively immutable in this app, so it doesn't matter).
    customCardAuthorUsername: { type: String },
    skinUrl: { type: String, default: null },
    backSkinUrl: { type: String, default: null }, // DFC back-face custom art
    foil: { type: String, default: null }, // 'foil' | 'etched' | null
    textless: { type: Boolean, default: false },
    nonEnglish: { type: Boolean, default: false },
    // Normalized per-face data for cards with >1 face (adventures, splits,
    // flips, aftermaths, DFCs). Null for single-face cards. Each face has
    // name/mana cost/type line/oracle text/power/toughness/colors.
    faces: { type: Array, default: null },
}, { _id: false });

const deckSchema = new mongoose.Schema({
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, default: 'Untitled Deck' },
    format: { type: String, default: 'commander' },
    commanders: [cardEntrySchema],
    companions: [cardEntrySchema],
    mainboard: [cardEntrySchema],
    sideboard: [cardEntrySchema],
    tokens: [cardEntrySchema],
    notFound: { type: [String], default: [] },
    importedFrom: { type: String, default: null },
    // If this deck was created via a share-code import, sharedByUsername is a
    // snapshot of the original sharer's username. Self-built decks leave
    // this blank. Used purely for UI display ("Shared by <name>").
    sharedByUsername: { type: String, default: null },
    sharedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Deck', deckSchema);
