const mongoose = require('mongoose');

/*
 * `originId` is a stable identity shared between the "original" of a custom
 * card and any user-made copies. It enables two things:
 *
 *   1. Editing a CustomCard updates all deck entries that reference it (via
 *      a server-side fan-out keyed by originId + ownerId).
 *   2. When importing a shared deck, the importer can choose to LINK to the
 *      original (deck entries keep pointing at the sharer's ownerId+originId,
 *      so the sharer's edits propagate) or COPY (a new CustomCard with a new
 *      originId is created under the importer's ownership, fully independent).
 *
 * A "copy" always gets a NEW originId — shared originId across different
 * owners would be semantically weird, since edits never cross ownerId anyway.
 * originId is required for new documents; existing rows are backfilled by a
 * migration pass in server/index.js at startup.
 */
const customCardSchema = new mongoose.Schema({
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    originId: { type: String, index: true },
    name: { type: String, required: true, default: 'Custom Card' },
    imageUrl: { type: String, default: '' },
    manaCost: { type: String, default: '' },
    typeLine: { type: String, default: '' },
    oracleText: { type: String, default: '' },
    power: { type: String, default: '' },
    toughness: { type: String, default: '' },
    colors: [String],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('CustomCard', customCardSchema);
