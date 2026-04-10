// Detect basic land color from name (fallback when produced_mana is missing)
const BASIC_LANDS = {
    'plains': 'W',
    'snow-covered plains': 'W',
    'island': 'U',
    'snow-covered island': 'U',
    'swamp': 'B',
    'snow-covered swamp': 'B',
    'mountain': 'R',
    'snow-covered mountain': 'R',
    'forest': 'G',
    'snow-covered forest': 'G',
    'wastes': 'C',
    'snow-covered wastes': 'C',
};

// Determine which mana a card produces when tapped
// Returns array of color codes (e.g. ['W'], ['G','U']) or null if unknown
function getProducedMana(card) {
    const name = (card.name || '').toLowerCase();
    const tl = (card.typeLine || '').toLowerCase();

    // Basic lands take priority — match by name regardless of producedMana data
    if (BASIC_LANDS[name]) return [BASIC_LANDS[name]];

    // Check basic land subtype in type line
    if (tl.includes('basic') && tl.includes('land')) {
        if (tl.includes('plains')) return ['W'];
        if (tl.includes('island')) return ['U'];
        if (tl.includes('swamp')) return ['B'];
        if (tl.includes('mountain')) return ['R'];
        if (tl.includes('forest')) return ['G'];
        if (tl.includes('wastes')) return ['C'];
    }

    if (Array.isArray(card.producedMana) && card.producedMana.length > 0) {
        return card.producedMana;
    }

    return null;
}

// Parse a mana cost string like "{2}{W}{W}" into a counts object
// Returns: { generic: 2, W: 2, U: 0, B: 0, R: 0, G: 0, C: 0, X: 0, hybrid: [...], phyrexian: 0 }
function parseManaCost(costString) {
    const result = { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, X: 0, hybrid: [], phyrexian: 0 };
    if (!costString) return result;
    const tokens = costString.match(/\{[^}]+\}/g) || [];
    for (const tok of tokens) {
        const inner = tok.slice(1, -1);
        if (/^\d+$/.test(inner)) {
            result.generic += parseInt(inner);
        } else if (inner === 'X') {
            result.X++;
        } else if (['W', 'U', 'B', 'R', 'G', 'C'].includes(inner)) {
            result[inner]++;
        } else if (inner.includes('/P')) {
            result.phyrexian++;
        } else if (inner.includes('/')) {
            // Hybrid like W/U or 2/W
            result.hybrid.push(inner.split('/'));
        }
    }
    return result;
}

// Try to pay a cost from a mana pool
// Returns the new pool if successful, or null if can't pay
function tryPayCost(pool, cost) {
    const newPool = { ...pool };
    // Pay colored requirements first
    for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) {
        if ((cost[c] || 0) > newPool[c]) return null;
        newPool[c] -= cost[c] || 0;
    }
    // Pay hybrid (try each side)
    for (const pair of (cost.hybrid || [])) {
        let paid = false;
        for (const opt of pair) {
            if (['W', 'U', 'B', 'R', 'G', 'C'].includes(opt) && newPool[opt] > 0) {
                newPool[opt]--;
                paid = true;
                break;
            }
        }
        if (!paid) {
            // Try generic for "2/W" style
            const numericOpt = pair.find(p => /^\d+$/.test(p));
            if (numericOpt) {
                const total = ['W', 'U', 'B', 'R', 'G', 'C'].reduce((s, c) => s + newPool[c], 0);
                if (total >= parseInt(numericOpt)) {
                    let need = parseInt(numericOpt);
                    for (const c of ['C', 'W', 'U', 'B', 'R', 'G']) {
                        const take = Math.min(newPool[c], need);
                        newPool[c] -= take;
                        need -= take;
                        if (need === 0) break;
                    }
                    paid = true;
                }
            }
            if (!paid) return null;
        }
    }
    // Pay generic from any color (prefer colorless first)
    let generic = cost.generic || 0;
    for (const c of ['C', 'W', 'U', 'B', 'R', 'G']) {
        const take = Math.min(newPool[c], generic);
        newPool[c] -= take;
        generic -= take;
        if (generic === 0) break;
    }
    if (generic > 0) return null;
    return newPool;
}

function emptyPool() {
    return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

module.exports = { getProducedMana, parseManaCost, tryPayCost, emptyPool };
