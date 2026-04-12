const { v4: uuidv4 } = require('uuid');

// In-memory game rooms (also saved to MongoDB periodically)
const activeRooms = new Map();

// "Infinite" sentinel — JSON can't encode JS Infinity (it becomes null when
// passed through socket.io), so we use a large-but-safe integer that still
// supports arithmetic (e.g. infinite + 1 = still infinite on the client).
// Anything at or above this threshold is rendered as ∞ by the client.
const INFINITE = 9999;

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

function createCardInstance(cardData, overrides = {}) {
    return {
        instanceId: uuidv4(),
        scryfallId: cardData.scryfallId || null,
        name: cardData.name,
        imageUri: cardData.imageUri || '',
        backImageUri: cardData.backImageUri || '',
        manaCost: cardData.manaCost || '',
        typeLine: cardData.typeLine || '',
        oracleText: cardData.oracleText || '',
        power: cardData.power || '',
        toughness: cardData.toughness || '',
        colors: cardData.colors || [],
        producedMana: cardData.producedMana || [],
        layout: cardData.layout || 'normal',
        x: 0,
        y: 0,
        tapped: false,
        tappedFor: null, // color that was added to mana pool when this was tapped (for refund on untap)
        bfRow: null, // override for battlefield row: 'creatures' | 'artifacts' | 'lands' | 'other' | null (auto)
        notes: [], // array of { text, card?: { name, imageUri } }
        flipped: false,
        faceDown: false,
        counters: {},
        attachedTo: null,
        zIndex: 0,
        isToken: false,
        isCustom: cardData.isCustom || false,
        customImageUrl: cardData.customImageUrl || null,
        // Custom card authorship snapshot — lives on the card instance so
        // CardMaximized and similar UI can show "by <author>" without any
        // cross-user DB lookup. Only populated for isCustom cards; empty
        // otherwise.
        customCardAuthorUsername: cardData.customCardAuthorUsername || null,
        customCardOriginId: cardData.customCardOriginId || null,
        customCardOwnerId: cardData.customCardOwnerId || null,
        // ─── Combat / state extras (added in big batch). All optional, all
        // default-falsy so existing serialized cards keep working. ───────
        damage: 0,           // marked damage (clears on end of turn)
        phasedOut: false,    // phased out — visually muted, can't be targeted
        suspendCounters: 0,  // suspend / time counters; auto-decrement on upkeep
        goaded: false,       // forced to attack
        attackingPlayerId: null,  // who this creature is attacking this turn
        controllerOriginal: null, // original owner if temp control change in effect
        // The "from" zone the card was in just before being put into a temp
        // zone (foretell pile, exile from blink). Used to return it.
        returnZone: null,
        rotated180: false,
        ...overrides,
    };
}

function createPlayerState(userId, username) {
    return {
        odjeebUserId: null,
        userId,
        username,
        socketId: null,
        life: 40,
        counters: { poison: 0, energy: 0, experience: 0 },
        commanderDeaths: 0,
        commanderDamageFrom: {},
        commanderTax: 0,
        infect: 0, // cumulative poison counters; 10 = death
        background: null,
        designations: { monarch: false, initiative: false, dayNight: null, citysBlessing: false },
        zones: {
            hand: [],
            library: [],
            battlefield: [],
            graveyard: [],
            exile: [],
            commandZone: [],
            // ─── New zones (added in big batch). All start empty; the client
            // only renders strips for them when they have content, so existing
            // gameplay/UI is unaffected for users who don't use these. ───
            sideboard: [],   // 15-card sideboard (loaded from deck if present)
            companions: [],  // wishboard / companions zone
            foretell: [],    // face-down exile pile for foretold cards
            emblems: [],     // planeswalker emblems (one-shot, no cost)
        },
        // Mana pool — cleared at end of turn (or manually). Each color tracks
        // how many of that mana the player currently has floating. C = colorless.
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        teamId: null,
        // Mulligan sequence: 0=initial 7, 1=draws 7 (free first mulligan),
        // 2=draws 6, 3=draws 5, >=4 blocked.
        mulliganCount: 0,
        // London-style bottoming: if the room's mulligan rule is 'london',
        // after every mulligan a player must put `mulliganCount` cards on the
        // bottom of their library. This counter tracks how many they still owe.
        // 0 = nothing pending; n>0 = still need to bottom n cards.
        mulliganBottomPending: 0,
        // True once the player has clicked "Ready & Roll" during the mulligan
        // phase. Reset on startGame and on tiebreak re-rolls.
        mulliganReady: false,
        // The d20 roll that decides turn order. null = hasn't rolled yet
        // (will be prompted), number = committed roll. Tied players get
        // this cleared and roll again until a single winner emerges.
        firstPlayerRoll: null,
        // Per-player flag — if true, their battlefield auto-untaps when their
        // turn begins. Default on because most players expect it.
        autoUntap: true,
        // If true, server enforces (well, nudges) the hand-size limit at end
        // of turn — sends a notification to discard down to room.settings
        // .handSizeLimit. Defaults to ON since most players want the reminder;
        // can be turned off via the player options menu. Stored explicitly as
        // false (not undefined) when toggled off so the cleanup check below
        // can treat undefined as "default-on".
        handSizeEnforce: true,
        // Per-player avatar color (hex). Generated on creation; used for the
        // header dot, action log icon, and cursor hue fallback.
        avatarColor: pickAvatarColor(userId),
        // True once the player has conceded. They stay in the room (so the
        // chat / spectator-style view still works) but their seat is treated
        // as eliminated for victory checks.
        conceded: false,
        // Per-turn state used by the UI to nudge the player ("you haven't
        // drawn yet", "you haven't played a land yet"). Reset on each turn
        // advance and on startGame. They're hints, not enforced rules — a
        // player can ignore them or drop to 0 lands per turn.
        drewThisTurn: false,
        landsPlayedThisTurn: 0,
    };
}

// Deterministic pastel color from a userId so the same player always gets the
// same avatar dot across reloads, without us needing to persist a choice.
const AVATAR_PALETTE = [
    '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb',
    '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784',
    '#aed581', '#dce775', '#fff176', '#ffd54f', '#ffb74d', '#ff8a65',
];
function pickAvatarColor(userId) {
    if (!userId) return AVATAR_PALETTE[0];
    let hash = 0;
    const s = String(userId);
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
    return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function createRoom(hostId, hostUsername, settings = {}) {
    let roomCode;
    do { roomCode = generateRoomCode(); } while (activeRooms.has(roomCode));

    const room = {
        roomCode,
        hostId,
        players: [createPlayerState(hostId, hostUsername)],
        // True while the game is in the "everyone draw 7 and decide mulligans
        // before the first turn" phase. Set in startGame, cleared when every
        // player clicks Ready and the server rolls d20s to pick who goes first.
        mulliganPhase: false,
        // Spectators join the room to watch and chat but never hold a seat.
        // Shape: { userId, username, socketId }. Not persisted to Mongo — ephemeral.
        spectators: [],
        // Shared chat log — last CHAT_HISTORY_LIMIT messages. Broadcast to players
        // and spectators. Shape: { id, userId, username, text, ts, isSpectator,
        // toUserId? }. toUserId set means it's a DM, only delivered to that
        // recipient + the sender (kept out of room.chat).
        chat: [],
        drawings: [],
        turnIndex: 0,
        currentPhase: 'main1',
        actionHistory: [],
        undoStack: [],
        // The Stack — a room-level LIFO of "spells/abilities currently
        // resolving". Each entry: { id, casterId, casterName, name,
        // imageUri?, oracleText?, manaCost?, ts }. Pure tool, no resolution
        // engine — players push/pop manually as they cast and resolve.
        stack: [],
        // Extra-turn queue — array of { ownerId, ownerName, source }. When
        // nextTurn fires, if the queue is non-empty, the next turn goes to
        // the head of the queue instead of advancing turnIndex.
        extraTurns: [],
        settings: {
            startingLife: settings.startingLife || 40,
            useCommanderDamage: settings.useCommanderDamage !== false,
            commanderDamageLethal: settings.commanderDamageLethal || 21,
            maxPlayers: settings.maxPlayers || 8,
            // 'commander' (40 life, cmdr dmg on), 'brawl' (30, on), 'modern'
            // (20, off), 'oathbreaker' (20, on), 'free' (no defaults). The
            // host can also override startingLife/cmdr-dmg explicitly.
            format: settings.format || 'commander',
            // 'vancouver' (legacy 7→7→6→5), 'london' (always draw 7,
            // bottom mulliganCount cards), 'free7' (free first mull to 7
            // then 7→6→5).
            mulliganRules: settings.mulliganRules || 'vancouver',
            // The hand size end-of-turn limit (cleanup step). 7 by standard
            // rules. Only enforced for players who set handSizeEnforce=true
            // on themselves — opt-in nudge, not mandatory.
            handSizeLimit: settings.handSizeLimit || 7,
        },
        teams: [],
        // True if "shared team life" is on — when team members take damage,
        // the team total drops instead of the individual life. Off by default.
        sharedTeamLife: false,
        started: false,
        createdAt: Date.now(),
        lastActivity: Date.now(),
    };

    room.players[0].life = room.settings.startingLife;
    activeRooms.set(roomCode, room);
    return room;
}

function getRoom(roomCode) {
    return activeRooms.get(roomCode) || null;
}

function deleteRoom(roomCode) {
    activeRooms.delete(roomCode);
}

function getPlayerInRoom(room, userId) {
    return room.players.find(p => p.userId === userId);
}

function getSpectatorInRoom(room, userId) {
    return (room.spectators || []).find(s => s.userId === userId);
}

// Keep only the last N chat messages to bound room memory usage. Any more and
// long-running rooms eat memory and slow down gameState broadcasts.
const CHAT_HISTORY_LIMIT = 200;

function appendChatMessage(room, { userId, username, text, isSpectator }) {
    if (!room.chat) room.chat = [];
    const msg = {
        id: uuidv4(),
        userId,
        username,
        text,
        ts: Date.now(),
        isSpectator: !!isSpectator,
    };
    room.chat.push(msg);
    if (room.chat.length > CHAT_HISTORY_LIMIT) {
        room.chat = room.chat.slice(-CHAT_HISTORY_LIMIT);
    }
    return msg;
}

function addAction(room, playerId, type, data) {
    const action = { actionId: uuidv4(), playerId, type, data, timestamp: Date.now() };
    room.actionHistory.push(action);
    if (room.actionHistory.length > 200) room.actionHistory.shift(); // keep last 200
    room.lastActivity = Date.now();
    return action;
}

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Get sanitized room state for a specific viewer.
// opts.isSpectator — if true, all player hands are revealed (spectators see
// everything but can't interact). Spectators never appear in `players`; they're
// listed separately under `spectators` so the client can show "2 watching".
// opts.spectatorPerspectiveOf — when set on a spectator, return state as if
// from that player's view (their hand visible, others hidden). Used for the
// "spectate as <player>" coaching mode.
function getRoomStateForPlayer(room, userId, opts = {}) {
    const isSpectator = !!opts.isSpectator;
    const perspective = isSpectator ? (opts.spectatorPerspectiveOf || null) : null;
    // The "viewer" for hand visibility — normally the requesting user, but when
    // a spectator picks a perspective, it shifts to that player.
    const handViewerId = perspective || (isSpectator ? null : userId);
    return {
        roomCode: room.roomCode,
        hostId: room.hostId,
        turnIndex: room.turnIndex,
        currentPhase: room.currentPhase,
        settings: room.settings,
        teams: room.teams,
        sharedTeamLife: !!room.sharedTeamLife,
        stack: room.stack || [],
        extraTurns: (room.extraTurns || []).map(t => ({
            ownerId: t.ownerId,
            ownerName: t.ownerName,
            source: t.source,
        })),
        started: room.started,
        mulliganPhase: !!room.mulliganPhase,
        drawings: room.drawings,
        // Strip socketId from spectator list before sending to clients
        spectators: (room.spectators || []).map(s => ({
            userId: s.userId,
            username: s.username,
            connected: !!s.socketId,
        })),
        // Filter chat: drop DMs that aren't to/from this viewer (DMs have a
        // toUserId; non-DMs are visible to everyone).
        chat: (room.chat || []).filter(m => {
            if (!m.toUserId) return true;
            return m.userId === userId || m.toUserId === userId;
        }),
        // Send the recent action log so late joiners / spectators see history.
        // actionHistory is already capped at 200 entries by addAction().
        actionHistory: room.actionHistory || [],
        viewerIsSpectator: isSpectator,
        viewerPerspectiveOf: perspective,
        players: room.players.map(p => {
            // Spectators with no perspective: see everyone's hand. Spectators
            // WITH a perspective: see only that player's hand. Players: see
            // only their own hand. Always include hand for full reveal mode.
            const canSeeHand = isSpectator
                ? (perspective ? p.userId === perspective : true)
                : (p.userId === userId);
            return {
                userId: p.userId,
                username: p.username,
                life: p.life,
                counters: Object.fromEntries(p.counters instanceof Map ? p.counters : Object.entries(p.counters || {})),
                commanderDeaths: p.commanderDeaths,
                commanderDamageFrom: Object.fromEntries(p.commanderDamageFrom instanceof Map ? p.commanderDamageFrom : Object.entries(p.commanderDamageFrom || {})),
                infect: p.infect || 0,
                commanderTax: p.commanderTax,
                background: p.background,
                designations: p.designations,
                teamId: p.teamId,
                mulliganCount: p.mulliganCount || 0,
                mulliganBottomPending: p.mulliganBottomPending || 0,
                mulliganReady: !!p.mulliganReady,
                firstPlayerRoll: p.firstPlayerRoll ?? null,
                autoUntap: p.autoUntap !== false,
                handSizeEnforce: p.handSizeEnforce !== false,
                avatarColor: p.avatarColor || null,
                conceded: !!p.conceded,
                manaPool: p.manaPool || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                drewThisTurn: !!p.drewThisTurn,
                landsPlayedThisTurn: p.landsPlayedThisTurn || 0,
                connected: !!p.socketId,
                zones: {
                    hand: canSeeHand ? p.zones.hand : p.zones.hand.map(() => ({ hidden: true })),
                    handCount: p.zones.hand.length,
                    library: [],
                    libraryCount: p.zones.library.length,
                    battlefield: p.zones.battlefield,
                    graveyard: p.zones.graveyard,
                    exile: p.zones.exile,
                    commandZone: p.zones.commandZone,
                    // The new zones — only the player themselves (or a
                    // spectator with their perspective) sees the contents of
                    // foretell/sideboard/companions. Others see counts only.
                    sideboard: canSeeHand ? (p.zones.sideboard || []) : [],
                    sideboardCount: (p.zones.sideboard || []).length,
                    companions: canSeeHand ? (p.zones.companions || []) : [],
                    companionsCount: (p.zones.companions || []).length,
                    foretell: canSeeHand ? (p.zones.foretell || []) : [],
                    foretellCount: (p.zones.foretell || []).length,
                    // Emblems are always public — they represent permanent
                    // game state ("you have an emblem with...").
                    emblems: p.zones.emblems || [],
                },
            };
        }),
    };
}

// Snapshot game-relevant player state (excludes socketId/connection info)
function snapshotState(room) {
    return JSON.parse(JSON.stringify({
        players: room.players.map(p => ({
            userId: p.userId,
            username: p.username,
            life: p.life,
            counters: p.counters,
            commanderDeaths: p.commanderDeaths,
            commanderDamageFrom: p.commanderDamageFrom,
            infect: p.infect || 0,
            commanderTax: p.commanderTax,
            background: p.background,
            designations: p.designations,
            teamId: p.teamId,
            manaPool: p.manaPool,
            conceded: !!p.conceded,
            handSizeEnforce: !!p.handSizeEnforce,
            mulliganBottomPending: p.mulliganBottomPending || 0,
            zones: p.zones,
        })),
        turnIndex: room.turnIndex,
        teams: room.teams,
        stack: room.stack || [],
        extraTurns: room.extraTurns || [],
        sharedTeamLife: !!room.sharedTeamLife,
    }));
}

function pushUndo(room) {
    if (!room.undoStack) room.undoStack = [];
    room.undoStack.push(snapshotState(room));
    if (room.undoStack.length > 30) room.undoStack.shift();
}

function popUndo(room) {
    if (!room.undoStack || room.undoStack.length === 0) return null;
    return room.undoStack.pop();
}

function restoreSnapshot(room, snapshot) {
    if (!snapshot) return;
    for (const snapPlayer of snapshot.players) {
        const player = room.players.find(p => p.userId === snapPlayer.userId);
        if (!player) continue;
        // Preserve socketId and other connection state, restore everything else
        const socketId = player.socketId;
        Object.assign(player, snapPlayer);
        player.socketId = socketId;
    }
    if (snapshot.turnIndex !== undefined) room.turnIndex = snapshot.turnIndex;
    if (snapshot.teams) room.teams = snapshot.teams;
    if (snapshot.stack !== undefined) room.stack = snapshot.stack;
    if (snapshot.extraTurns !== undefined) room.extraTurns = snapshot.extraTurns;
    if (snapshot.sharedTeamLife !== undefined) room.sharedTeamLife = snapshot.sharedTeamLife;
}

function getAllRooms() {
    return Array.from(activeRooms.values()).map(r => ({
        roomCode: r.roomCode,
        playerCount: r.players.length,
        maxPlayers: r.settings.maxPlayers,
        started: r.started,
        hostUsername: r.players.find(p => p.userId === r.hostId)?.username || 'Unknown',
    }));
}

module.exports = {
    activeRooms,
    generateRoomCode,
    createCardInstance,
    createPlayerState,
    createRoom,
    getRoom,
    deleteRoom,
    getPlayerInRoom,
    getSpectatorInRoom,
    appendChatMessage,
    CHAT_HISTORY_LIMIT,
    INFINITE,
    addAction,
    shuffleArray,
    getRoomStateForPlayer,
    snapshotState,
    pushUndo,
    popUndo,
    restoreSnapshot,
    getAllRooms,
};
