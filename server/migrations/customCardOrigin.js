const CustomCard = require('../models/CustomCard');
const Deck = require('../models/Deck');
const User = require('../models/User');

/*
 * One-shot migration to back-fill the custom-card origin system.
 *
 * Runs idempotently on every server startup — skips any record that already
 * has the new fields set, so re-running it is safe and cheap.
 *
 * Pass 1 (custom cards):
 *   - ojee's cards get a stable originId (their own _id as a string)
 *   - Non-ojee cards with a name that matches an ojee card are treated as
 *     COPIES the user received via a share. We delete those copies and
 *     remember the mapping so pass 2 can re-link the copier's decks directly
 *     to ojee's version (ojee's subsequent edits will now propagate to them).
 *   - Non-ojee cards with no ojee match are kept as their own originals
 *     (new originId == own _id).
 *
 * Pass 2 (deck entries):
 *   For every deck entry flagged isCustom and missing customCardOriginId:
 *     - Prefer the deck owner's own CustomCard with that name
 *     - Fall back to an ojee CustomCard with that name
 *     - If neither exists, leave the entry as-is (it still has inline data)
 *
 * The "ojee is the origin of everything" heuristic comes from the user's
 * own instruction that they made every custom card themselves and shared
 * with one other person. Anyone adding cards post-migration gets new
 * originIds from the createCustomCard endpoint.
 */
module.exports = async function runCustomCardOriginMigration() {
    let ojee;
    try {
        ojee = await User.findOne({ username: 'ojee' });
    } catch (err) {
        console.error('[migration] user lookup failed:', err.message);
        return;
    }
    if (!ojee) {
        console.log('[migration] no ojee user; skipping custom-card origin backfill');
        return;
    }

    // ─── Pass 1 — custom cards ────────────────────────────────────────
    const allCards = await CustomCard.find({}).lean();
    const ojeeCards = allCards.filter(c => String(c.ownerId) === String(ojee._id));
    const ojeeByName = new Map();
    for (const c of ojeeCards) ojeeByName.set(c.name, c);

    // Assign originId to ojee's cards (idempotent — skip if already set)
    let ojeeTouched = 0;
    for (const c of ojeeCards) {
        if (c.originId) continue;
        const originId = String(c._id);
        await CustomCard.updateOne({ _id: c._id }, { $set: { originId } });
        ojeeByName.set(c.name, { ...c, originId });
        ojeeTouched++;
    }

    // Non-ojee cards → drop copies of ojee's cards, keep originals
    const deletedCopiesByUserAndName = new Map(); // `${userId}|${name}` → { originId, ownerId (ojee._id) }
    let copiesRemoved = 0;
    let originalsTouched = 0;
    for (const c of allCards) {
        if (String(c.ownerId) === String(ojee._id)) continue;
        // Refresh name lookup (ojee's cards might've just been given an originId above)
        const ojeeMatch = ojeeByName.get(c.name);
        if (ojeeMatch && ojeeMatch.originId) {
            // This is a copy the friend received. Delete the copy and remember
            // the mapping so the friend's deck entries can re-link to ojee's.
            await CustomCard.deleteOne({ _id: c._id });
            deletedCopiesByUserAndName.set(`${c.ownerId}|${c.name}`, {
                originId: ojeeMatch.originId,
                ownerId: ojee._id,
            });
            copiesRemoved++;
        } else if (!c.originId) {
            // Friend's own custom card (no ojee match) — promote to original.
            await CustomCard.updateOne({ _id: c._id }, { $set: { originId: String(c._id) } });
            originalsTouched++;
        }
    }

    // ─── Pass 2 — deck entries ────────────────────────────────────────
    // Re-query custom cards so we pick up the newly-set originIds.
    const currentCards = await CustomCard.find({}).lean();
    const byOwnerAndName = new Map();
    for (const c of currentCards) {
        byOwnerAndName.set(`${c.ownerId}|${c.name}`, c);
    }

    // Build a username-by-userId map for hydrating authorUsername snapshots
    // on deck entries. This lets the UI show "by <username>" without any
    // cross-user DB lookups at render time.
    const allUsers = await User.find({}).select('username').lean();
    const usernameByUserId = new Map(allUsers.map(u => [String(u._id), u.username]));

    const decks = await Deck.find({}).lean();
    let entriesLinked = 0;
    let authorsBackfilled = 0;
    for (const deck of decks) {
        const sections = ['commanders', 'companions', 'mainboard', 'sideboard'];
        const patch = {};
        let deckTouched = false;
        for (const section of sections) {
            const arr = deck[section];
            if (!Array.isArray(arr)) continue;
            let sectionTouched = false;
            const next = arr.map(entry => {
                if (!entry || !entry.isCustom) return entry;
                // First, apply origin linking if missing.
                let out = entry;
                if (!out.customCardOriginId) {
                    // Prefer the deck owner's own CustomCard with this name.
                    let match = byOwnerAndName.get(`${deck.ownerId}|${entry.name}`);
                    if (!match) {
                        // Was this a deleted copy? Redirect to ojee's original.
                        const redirect = deletedCopiesByUserAndName.get(`${deck.ownerId}|${entry.name}`);
                        if (redirect) {
                            sectionTouched = true;
                            entriesLinked++;
                            out = {
                                ...out,
                                customCardOriginId: redirect.originId,
                                customCardOwnerId: redirect.ownerId,
                            };
                        } else {
                            // Fall back: maybe ojee has a card with this name
                            match = byOwnerAndName.get(`${ojee._id}|${entry.name}`);
                        }
                    }
                    if (match && match.originId && !out.customCardOriginId) {
                        sectionTouched = true;
                        entriesLinked++;
                        out = {
                            ...out,
                            customCardOriginId: match.originId,
                            customCardOwnerId: match.ownerId,
                        };
                    }
                }
                // Then, backfill authorUsername from the linked owner.
                if (!out.customCardAuthorUsername && out.customCardOwnerId) {
                    const uname = usernameByUserId.get(String(out.customCardOwnerId));
                    if (uname) {
                        sectionTouched = true;
                        authorsBackfilled++;
                        out = { ...out, customCardAuthorUsername: uname };
                    }
                }
                return out;
            });
            if (sectionTouched) {
                patch[section] = next;
                deckTouched = true;
            }
        }
        if (deckTouched) {
            await Deck.updateOne({ _id: deck._id }, { $set: patch });
        }
    }

    console.log(
        `[migration] custom-card origin backfill complete — ojee originals: ${ojeeTouched}, copies removed: ${copiesRemoved}, new originals: ${originalsTouched}, deck entries linked: ${entriesLinked}, authors backfilled: ${authorsBackfilled}`
    );
};
