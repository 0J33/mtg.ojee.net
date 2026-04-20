// MTG keyword ability definitions. Used by Card hover and CardMaximized to
// show reminder text for keywords in the card's text/typeLine.
//
// Keys are lowercase. Matching is whole-word (word boundaries) and
// case-insensitive. Some keywords take parameters (Ward, Protection,
// Landwalk, etc.) — those match on the keyword word alone; the full
// variant still matches its canonical reminder text.

export const KEYWORDS = {
    // Evergreen
    flying: 'Can\u2019t be blocked except by creatures with flying or reach.',
    reach: 'Can block creatures with flying.',
    trample: 'This creature can deal excess combat damage to the defending player or planeswalker.',
    'first strike': 'Deals combat damage before creatures without first strike.',
    'double strike': 'Deals both first-strike and regular combat damage.',
    deathtouch: 'Any amount of damage this deals to a creature is enough to destroy it.',
    lifelink: 'Damage dealt by this creature also causes you to gain that much life.',
    vigilance: 'Attacking doesn\u2019t cause this creature to tap.',
    haste: 'This creature can attack and use tap abilities as soon as it comes under your control.',
    menace: 'Can\u2019t be blocked except by two or more creatures.',
    hexproof: 'This permanent can\u2019t be the target of spells or abilities your opponents control.',
    shroud: 'This permanent can\u2019t be the target of spells or abilities.',
    indestructible: 'Damage and effects that say \u201Cdestroy\u201D don\u2019t destroy this.',
    flash: 'You may cast this spell any time you could cast an instant.',
    defender: 'Can\u2019t attack.',
    protection: 'Can\u2019t be targeted, dealt damage, enchanted, or equipped by the specified quality.',
    ward: 'Whenever this becomes the target of a spell or ability an opponent controls, counter it unless the caster pays the ward cost.',

    // Common non-evergreen
    cascade: 'When you cast this spell, exile cards from the top of your library until you exile a nonland card with a lesser mana value. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order.',
    cycling: 'Pay the cycling cost, discard this card: Draw a card.',
    convoke: 'Your creatures can help cast this spell. Each creature you tap while casting it pays for 1 or one mana of that creature\u2019s color.',
    delve: 'You may exile any number of cards from your graveyard as you cast this spell. It costs 1 less to cast for each card exiled this way.',
    dredge: 'If you would draw a card, you may instead mill the dredge number and return this card from your graveyard to your hand.',
    echo: 'At the beginning of your upkeep, if this came under your control since your last upkeep, sacrifice it unless you pay its echo cost.',
    emerge: 'You may cast this spell by sacrificing a creature and paying the emerge cost reduced by that creature\u2019s mana value.',
    escape: 'You may cast this card from your graveyard for its escape cost.',
    evoke: 'You may cast this spell for its evoke cost. If you do, sacrifice it when it enters the battlefield.',
    exalted: 'Whenever a creature you control attacks alone, it gets +1/+1 until end of turn.',
    fading: 'This permanent enters with N fade counters. At the beginning of your upkeep, remove one; if you can\u2019t, sacrifice it.',
    fear: 'Can\u2019t be blocked except by artifact creatures and/or black creatures.',
    flashback: 'You may cast this card from your graveyard for its flashback cost. Then exile it.',
    foretell: 'During your turn, you may pay 2 and exile this card from your hand face down. Cast it on a later turn for its foretell cost.',
    graft: 'This enters with +1/+1 counters. Whenever another creature enters, you may move a +1/+1 counter from this onto it.',
    heroic: 'Whenever you cast a spell that targets this creature, trigger the heroic ability.',
    improvise: 'Your artifacts can help cast this spell. Each artifact you tap pays for 1.',
    kicker: 'You may pay an additional cost as you cast this spell for an extra effect.',
    landfall: 'Whenever a land enters the battlefield under your control, this triggers.',
    morph: 'You may cast this card face down as a 2/2 creature for 3. Turn it face up any time for its morph cost.',
    mutate: 'If you cast this spell for its mutate cost, put it over or under a target non-Human creature you own. They become a single mutated creature.',
    ninjutsu: 'Pay the ninjutsu cost, return an unblocked attacker you control to its owner\u2019s hand: Put this card onto the battlefield tapped and attacking.',
    outlast: 'Pay the outlast cost, tap this creature: Put a +1/+1 counter on it. Activate only as a sorcery.',
    overload: 'You may cast this spell for its overload cost. If you do, change its text by replacing \u201Ctarget\u201D with \u201Ceach.\u201D',
    persist: 'When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield with a -1/-1 counter on it.',
    phasing: 'This phases in or out before you untap during each of your untap steps.',
    prowess: 'Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.',
    rebound: 'If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast it from exile without paying its mana cost.',
    regenerate: 'The next time this creature would be destroyed this turn, instead tap it, remove all damage from it, and remove it from combat.',
    renown: 'When this creature deals combat damage to a player, if it isn\u2019t renowned, put N +1/+1 counters on it and it becomes renowned.',
    retrace: 'You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.',
    riot: 'This creature enters with your choice of a +1/+1 counter or haste.',
    scry: 'Look at the top N cards of your library. Put any number of them on the bottom and the rest back on top in any order.',
    splice: 'As you cast an Arcane spell, you may reveal this card from your hand and pay its splice cost to add its effect to that spell.',
    suspend: 'Rather than cast this card, you may pay its suspend cost and exile it with N time counters. Remove one at each of your upkeeps; when the last is removed, cast it without paying its mana cost.',
    threshold: 'If you have seven or more cards in your graveyard, this ability is active.',
    transmute: 'Pay the transmute cost, discard this card: Search your library for a card with the same mana value, reveal it, put it into your hand, then shuffle.',
    unearth: 'Pay the unearth cost: Return this creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.',
    undying: 'When this creature dies, if it had no +1/+1 counters on it, return it to the battlefield with a +1/+1 counter on it.',
    vanishing: 'This permanent enters with N time counters. At the beginning of your upkeep, remove one; when the last is removed, sacrifice it.',
    wither: 'Damage this deals to creatures is in the form of -1/-1 counters.',
    infect: 'Damage this deals to creatures is in -1/-1 counters, and to players in poison counters.',
    annihilator: 'Whenever this creature attacks, defending player sacrifices N permanents.',
    affinity: 'This spell costs 1 less to cast for each permanent of the specified type you control.',
    bloodthirst: 'If an opponent was dealt damage this turn, this creature enters with N +1/+1 counters.',
    buyback: 'You may pay an additional cost as you cast this spell. If you do, put it into your hand as it resolves.',
    champion: 'When this enters, sacrifice it unless you exile another creature you control of the specified type. When this leaves, return the exiled card.',
    changeling: 'This card is every creature type.',
    conspire: 'As you cast this spell, you may tap two untapped creatures you control that share a color with it. When you do, copy it. You may choose new targets for the copy.',
    dash: 'You may cast this spell for its dash cost. If you do, it gains haste and returns to its owner\u2019s hand at the beginning of the next end step.',
    devoid: 'This card has no color.',
    devour: 'As this enters, you may sacrifice any number of creatures. This creature enters with that many times N +1/+1 counters on it.',
    dethrone: 'Whenever this attacks the player with the most life or tied for most, put a +1/+1 counter on it.',
    embalm: 'Pay the embalm cost, exile this card from your graveyard: Create a token that\u2019s a copy of this card, except it\u2019s a white Zombie. Sorcery only.',
    entwine: 'You may pay the entwine cost in addition to the spell\u2019s normal cost. If you do, you get both modes of the modal spell.',
    epic: 'For the rest of the game, you can\u2019t cast spells. At the beginning of each of your upkeeps, copy this spell except for its epic ability.',
    equip: 'Pay the equip cost: Attach this Equipment to target creature you control. Sorcery only.',
    eternalize: 'Pay the eternalize cost, exile this card from your graveyard: Create a 4/4 black Zombie token that\u2019s a copy of this card. Sorcery only.',
    evolve: 'Whenever a creature enters under your control, if it has greater power or toughness than this, put a +1/+1 counter on this.',
    exploit: 'When this enters, you may sacrifice a creature.',
    extort: 'Whenever you cast a spell, you may pay WB. If you do, each opponent loses 1 life and you gain that much life.',
    fabricate: 'When this enters, put N +1/+1 counters on it or create N 1/1 colorless Servo artifact creature tokens.',
    fateseal: 'Look at the top N cards of an opponent\u2019s library. Put any number on the bottom and the rest back on top in any order.',
    fuse: 'You may cast one or both halves of this card from your hand.',
    gravestorm: 'When you cast this spell, copy it for each permanent that was put into a graveyard this turn.',
    haunt: 'When this is put into a graveyard from the battlefield, exile it haunting target creature. When that creature dies, this triggers.',
    hidden: 'Doesn\u2019t reveal itself until a trigger condition happens.',
    horsemanship: 'Can\u2019t be blocked except by creatures with horsemanship.',
    ingest: 'Whenever this creature deals combat damage to a player, that player exiles the top card of their library.',
    jump: 'Variable — see card text.',
    landwalk: 'Can\u2019t be blocked as long as defending player controls a land of the specified type.',
    level: 'Level up cost: Put a level counter on this. Its abilities change based on levels.',
    madness: 'If you discard this card, you may cast it for its madness cost instead of putting it into your graveyard.',
    megamorph: 'Like morph, but turn face up with a +1/+1 counter.',
    modular: 'This enters with N +1/+1 counters. When it dies, you may put its +1/+1 counters on target artifact creature.',
    offering: 'You may cast this card any time you could cast an instant by sacrificing a creature of the specified type and paying the difference in mana cost.',
    'partner': 'You can have two commanders if both have partner.',
    poisonous: 'Whenever this creature deals combat damage to a player, that player gets N poison counters.',
    prowl: 'You may cast this spell for its prowl cost if you dealt combat damage to a player this turn with a creature of the shared type.',
    rampage: 'Whenever this creature becomes blocked, it gets +N/+N until end of turn for each creature blocking it beyond the first.',
    ripple: 'When you cast this spell, you may reveal the top N cards of your library. You may cast any with the same name for free, then put the rest on the bottom.',
    shadow: 'Can block or be blocked only by creatures with shadow.',
    soulbond: 'You may pair this creature with another unpaired creature when either enters. They remain paired for as long as you control both.',
    soulshift: 'When this dies, you may return target Spirit card with lesser mana value from your graveyard to your hand.',
    split: 'This card has two halves. Choose which to cast.',
    storm: 'When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets.',
    sunburst: 'This enters with a charge counter or +1/+1 counter for each color of mana spent to cast it.',
    surge: 'You may cast this spell for its surge cost if you or a teammate has cast another spell this turn.',
    totem: 'Animates into a creature when activated.',
    toxic: 'Whenever this creature deals combat damage to a player, that player gets N poison counters.',
    transfigure: 'Pay the transfigure cost, sacrifice this creature: Search your library for a creature card with the same mana value, put it onto the battlefield, then shuffle.',
    transform: 'Double-faced — flips between sides based on conditions.',
    transmutes: 'See Transmute.',
    undaunted: 'This spell costs 1 less to cast for each opponent.',
    unleash: 'You may have this creature enter with a +1/+1 counter. It can\u2019t block as long as it has a +1/+1 counter on it.',
    vanish: 'See Vanishing.',

    // Tribal / type keywords that sometimes appear as reminder text
    'banding': 'Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a unit. If any attacking creature has banding, its controller divides any combat damage, not the defending player.',
    'bushido': 'Whenever this creature blocks or becomes blocked, it gets +N/+N until end of turn.',
    'crew': 'Tap any number of creatures you control with total power N or greater: This Vehicle becomes an artifact creature until end of turn.',
    'dash': 'You may cast this spell for its dash cost. If you do, it gains haste and returns to your hand at end of turn.',
    'explore': 'Reveal the top card of your library. If it\u2019s a land, put it into your hand. Otherwise, put a +1/+1 counter on the creature, then put the card back or into your graveyard.',
    'investigate': 'Create a Clue token. (2, Sacrifice this artifact: Draw a card.)',
    'learn': 'You may reveal a Lesson card from outside the game and put it into your hand, or discard a card to draw a card.',
    'manifest': 'Put the top card of your library onto the battlefield face down as a 2/2 creature. Turn it face up any time for its mana cost if it\u2019s a creature card.',
    'myriad': 'Whenever this creature attacks, for each opponent other than defending player, you may create a token copy tapped and attacking that player or planeswalker.',
    'parley': 'Each player reveals the top card of their library. Then the ability triggers based on what\u2019s revealed.',
    'plot': 'You may pay the plot cost and exile this card from your hand. Cast it as a sorcery on a later turn without paying its mana cost.',
    'prototype': 'You may cast this spell with different mana cost, power, and toughness. It keeps its abilities.',
    'raid': 'If you attacked this turn, this ability is active.',
    'rally': 'Whenever this or another Ally enters under your control, the rally ability triggers.',
    'skulk': 'Can\u2019t be blocked by creatures with greater power.',
    'soulbond': 'You may pair this creature with another unpaired creature when either enters the battlefield.',
    'spectacle': 'You may cast this spell for its spectacle cost instead if an opponent lost life this turn.',
    'squad': 'Pay the squad cost any number of times as you cast this. Copy it that many times.',
    'surveil': 'Look at the top N cards of your library, then put any number into your graveyard and the rest on top in any order.',
    'venture': 'Venture into the dungeon — enter the first room or advance to the next room.',

    // Static short words (can collide with common English — handled via word-boundary regex)
};

// Words that look like "defined terms" when they appear after cue words
// like "enters" / "becomes" but are actually just common English or
// general MTG vocabulary. Used by the defined-term scanner below so we
// don't flag "enters the battlefield" as a keyword called "the".
const COMMON_DEFINED_TERM_STOP = new Set([
    'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'you', 'your',
    'and', 'or', 'but', 'not', 'no', 'yes', 'if', 'then', 'else', 'for', 'to', 'from',
    'of', 'on', 'in', 'at', 'as', 'by', 'with', 'under', 'over', 'up', 'down',
    'any', 'all', 'each', 'every', 'one', 'two', 'three', 'four', 'five', 'six',
    'seven', 'eight', 'nine', 'ten', 'zero',
    // Common MTG vocabulary that appears repeatedly but isn't a keyword.
    'creature', 'creatures', 'player', 'players', 'spell', 'spells', 'card', 'cards',
    'ability', 'abilities', 'permanent', 'permanents', 'land', 'lands', 'artifact',
    'artifacts', 'enchantment', 'enchantments', 'planeswalker', 'planeswalkers',
    'token', 'tokens', 'turn', 'turns', 'battlefield', 'graveyard', 'library',
    'hand', 'exile', 'stack', 'deck', 'damage', 'life', 'mana', 'counter', 'counters',
    'attack', 'attacks', 'attacking', 'block', 'blocks', 'blocked', 'blocking',
    'cast', 'casts', 'casting', 'tap', 'taps', 'tapped', 'untap', 'untaps', 'untapped',
    'draw', 'draws', 'drawn', 'control', 'controls', 'controlled', 'controller',
    'opponent', 'opponents', 'owner', 'power', 'toughness', 'target', 'targets',
    'color', 'colors', 'colored', 'colorless', 'type', 'types', 'basic', 'legendary',
    'white', 'blue', 'black', 'red', 'green',
    'source', 'sources', 'copy', 'copies', 'end', 'beginning', 'upkeep',
    'whenever', 'when', 'where', 'while', 'until', 'unless', 'may', 'would', 'could',
    'same', 'different', 'another', 'other', 'also', 'instead', 'only', 'just',
    'become', 'becomes', 'becoming', 'enter', 'enters', 'entered', 'entering',
    'leave', 'leaves', 'leaving', 'gain', 'gains', 'gained',
    'have', 'has', 'had', 'be', 'is', 'are', 'was', 'were', 'being', 'been',
    'put', 'puts', 'return', 'returns', 'pay', 'pays', 'paid',
]);

// Pull reminder text for a single keyword from the card's own oracle
// text. Handles two common forms:
//   1. Parenthetical reminder: "Flying (Can't be blocked except by...)".
//   2. Defined named ability: a sentence that mentions the keyword and
//      describes what it does (e.g. for "Prepared": "This creature
//      enters prepared. Whenever this creature attacks... becomes
//      prepared.").
// Returns the best-fit description string, or null if nothing useful is
// in the card text.
function reminderFromOracle(oracle, keyword) {
    if (!oracle || !keyword) return null;
    // Case 1 — parenthetical reminder immediately after the keyword
    // (optionally with a cost / value like "Ward {2}").
    const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const paren = new RegExp(`\\b${esc}\\b[^.(]*\\(([^)]+)\\)`, 'i');
    const m = oracle.match(paren);
    if (m) return m[1].trim();
    // Case 2 — gather every sentence that mentions the keyword. For
    // card-specific named abilities the keyword is typically referenced
    // in 2+ sentences that together describe it (enters X / becomes X /
    // triggers on X). Concatenate them so the reader gets the full
    // definition without re-reading the whole card.
    const sentences = oracle.split(/(?<=[.!?])\s+/);
    const hits = sentences.filter(s => new RegExp(`\\b${esc}\\b`, 'i').test(s));
    if (hits.length === 0) return null;
    return hits.join(' ').replace(/\s+/g, ' ').trim();
}

// Detect keywords the card has. Priority:
//   1. Scryfall-authoritative `card.keywords` array (includes every
//      evergreen + card-specific named ability). Each entry gets a
//      description: the static dictionary's standard reminder when we
//      know it, otherwise a reminder extracted from the card's own
//      oracle text (for made-up / named abilities), otherwise the raw
//      keyword name as-is (last resort).
//   2. Fallback: scan oracle text + type line for static-dictionary
//      keyword mentions (for cards that pre-date the keywords field or
//      for custom cards without it).
// Returns an array of { keyword, description } objects, deduplicated.
export function detectKeywords(card) {
    if (!card) return [];
    const oracle = card.oracleText || '';
    const results = [];
    const found = new Set();

    const push = (keyword, description) => {
        const key = keyword.trim();
        if (!key) return;
        const lowerKey = key.toLowerCase();
        if (found.has(lowerKey)) return;
        found.add(lowerKey);
        results.push({ keyword: key, description: description || '' });
    };

    // 1. Scryfall keywords — the authoritative list.
    const scryKeywords = Array.isArray(card.keywords) ? card.keywords : [];
    for (const kw of scryKeywords) {
        if (typeof kw !== 'string' || !kw.trim()) continue;
        const lower = kw.toLowerCase();
        const staticDesc = KEYWORDS[lower];
        // Prefer the card's own reminder text when present; otherwise
        // use our static dictionary; otherwise a last-resort description
        // that points the player at the oracle text.
        const cardReminder = reminderFromOracle(oracle, kw);
        const description = cardReminder
            || staticDesc
            || `See the card's text for what ${kw} does on this card.`;
        push(kw, description);
    }

    // 2. Fallback scan of oracle / type line for unknown-keywords-list
    // cases (custom cards without Scryfall metadata). Only adds entries
    // that weren't already surfaced by the authoritative list.
    const text = `${card.typeLine || ''}\n${oracle}`.toLowerCase();
    if (text.trim()) {
        const keys = Object.keys(KEYWORDS).sort((a, b) => b.length - a.length);
        for (const key of keys) {
            if (found.has(key)) continue;
            const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i');
            if (pattern.test(text)) {
                push(key, KEYWORDS[key]);
            }
        }
    }

    // 3. Scan for card-specific DEFINED TERMS — words the card defines
    // inline that aren't on any Scryfall / evergreen list. Pattern:
    // any word used after a state-cue verb ("enters X", "becomes X",
    // "is X", "gains X") AND mentioned in the oracle text 2+ times,
    // filtered against common English + MTG vocabulary. Catches cards
    // like Emeritus of Ideation // Ancestral Recall where "prepared" is
    // a card-local state that Scryfall doesn't flag as a keyword.
    if (oracle) {
        const typeLineWords = new Set(
            (card.typeLine || '').toLowerCase().split(/[^a-z]+/).filter(Boolean)
        );
        const cueRe = /\b(?:enters?|becomes?|is|gains?|loses?|has|turned)\s+(?:an?\s+|the\s+)?([a-z][a-z-]{2,})\b/gi;
        const candidates = new Map(); // lowerWord -> count-in-oracle
        let m;
        while ((m = cueRe.exec(oracle)) !== null) {
            const word = m[1].toLowerCase();
            if (!candidates.has(word)) candidates.set(word, 0);
        }
        // Count each candidate's total oracle occurrences.
        for (const word of candidates.keys()) {
            const re = new RegExp(`\\b${word.replace(/[-]/g, '\\-')}\\b`, 'gi');
            const count = (oracle.match(re) || []).length;
            candidates.set(word, count);
        }
        for (const [word, count] of candidates) {
            if (count < 2) continue;
            if (COMMON_DEFINED_TERM_STOP.has(word)) continue;
            if (KEYWORDS[word]) continue;          // already handled
            if (found.has(word)) continue;          // already surfaced
            if (typeLineWords.has(word)) continue;  // part of type line
            const reminder = reminderFromOracle(oracle, word);
            if (!reminder) continue;
            // Capitalize for display.
            const display = word.charAt(0).toUpperCase() + word.slice(1);
            push(display, reminder);
        }
    }
    return results;
}
