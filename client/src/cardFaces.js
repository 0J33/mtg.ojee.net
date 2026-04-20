/*
 * Shared helpers for parsing Scryfall card payloads into the lean
 * per-card shape our app stores. Used by any component that turns a
 * Scryfall JSON object into a card entry (DeckBuilder, CardSearch,
 * DraftPick, etc.) so the rules for "what counts as a real back face"
 * live in one place.
 */

// Layouts that have a real second face with its own image — i.e. cards
// you can flip over and see a different picture. Adventures, splits,
// flips, and aftermaths also use `card_faces`, but both halves share a
// single image, so we must NOT treat them as DFC (otherwise the UI
// renders a "view other side" button that reveals a blank card).
export const DFC_LAYOUTS = new Set([
    'transform', 'modal_dfc', 'double_faced_token', 'reversible_card', 'meld', 'battle',
]);

// Return a normalized array of face objects (name/mana cost/type line/
// oracle text/power/toughness) when the Scryfall card has 2+ faces.
// Returns null for single-face cards so the UI can short-circuit cheaply.
// The resulting array is what we display on the secondary-face panel for
// adventures/splits/flips AND for showing the back face of a DFC in
// maximize view.
export function extractFaces(card) {
    const faces = card?.card_faces;
    if (!Array.isArray(faces) || faces.length < 2) return null;
    return faces.map(f => ({
        name: f.name || '',
        manaCost: f.mana_cost || '',
        typeLine: f.type_line || '',
        oracleText: f.oracle_text || '',
        power: f.power || '',
        toughness: f.toughness || '',
        colors: Array.isArray(f.colors) ? f.colors : [],
    }));
}
