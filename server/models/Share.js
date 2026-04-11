const mongoose = require('mongoose');

/*
 * Share codes for decks and custom cards. Each share is a server-side snapshot
 * of the thing being shared, addressed by a short (8-char) alphanumeric code
 * that users can copy/paste or type. Replaces the old approach of encoding a
 * base64 payload directly into a "share code" — much nicer UX, lets us expire
 * old shares, and keeps clipboard contents short.
 *
 * The payload is stored as Mixed so we don't have to thread per-type schemas
 * through the Share model — the shape is validated at import time by the
 * route handler that consumes the share.
 */

const shareSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ['deck', 'customCard'], required: true },
    // Optional — record who created the share for audit / future revoke UI.
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now },
    // TTL: shares are reaped automatically after 180 days of inactivity so the
    // collection doesn't grow unbounded. If we ever need permanent shares we
    // can drop this index; shares are cheap to re-generate anyway.
    expiresAt: { type: Date, default: () => new Date(Date.now() + 180 * 24 * 3600 * 1000) },
});

// MongoDB TTL index — docs auto-delete once expiresAt is in the past.
shareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Share', shareSchema);
