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
        },
        teamId: null,
        // Mulligan sequence: 0=initial 7, 1=draws 7 (free first mulligan),
        // 2=draws 6, 3=draws 5, >=4 blocked.
        mulliganCount: 0,
        // Per-player flag — if true, their battlefield auto-untaps when their
        // turn begins. Default on because most players expect it.
        autoUntap: true,
        // Per-turn state used by the UI to nudge the player ("you haven't
        // drawn yet", "you haven't played a land yet"). Reset on each turn
        // advance and on startGame. They're hints, not enforced rules — a
        // player can ignore them or drop to 0 lands per turn.
        drewThisTurn: false,
        landsPlayedThisTurn: 0,
    };
}

function createRoom(hostId, hostUsername, settings = {}) {
    let roomCode;
    do { roomCode = generateRoomCode(); } while (activeRooms.has(roomCode));

    const room = {
        roomCode,
        hostId,
        players: [createPlayerState(hostId, hostUsername)],
        // Spectators join the room to watch and chat but never hold a seat.
        // Shape: { userId, username, socketId }. Not persisted to Mongo — ephemeral.
        spectators: [],
        // Shared chat log — last CHAT_HISTORY_LIMIT messages. Broadcast to players
        // and spectators. Shape: { id, userId, username, text, ts, isSpectator }.
        chat: [],
        drawings: [],
        turnIndex: 0,
        currentPhase: 'main1',
        actionHistory: [],
        undoStack: [],
        settings: {
            startingLife: settings.startingLife || 40,
            useCommanderDamage: settings.useCommanderDamage !== false,
            commanderDamageLethal: settings.commanderDamageLethal || 21,
            maxPlayers: settings.maxPlayers || 8,
        },
        teams: [],
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
function getRoomStateForPlayer(room, userId, opts = {}) {
    const isSpectator = !!opts.isSpectator;
    return {
        roomCode: room.roomCode,
        hostId: room.hostId,
        turnIndex: room.turnIndex,
        currentPhase: room.currentPhase,
        settings: room.settings,
        teams: room.teams,
        started: room.started,
        drawings: room.drawings,
        // Strip socketId from spectator list before sending to clients
        spectators: (room.spectators || []).map(s => ({
            userId: s.userId,
            username: s.username,
            connected: !!s.socketId,
        })),
        chat: room.chat || [],
        // Send the recent action log so late joiners / spectators see history.
        // actionHistory is already capped at 200 entries by addAction().
        actionHistory: room.actionHistory || [],
        viewerIsSpectator: isSpectator,
        players: room.players.map(p => {
            // Spectators see everyone's hand; players only see their own.
            const canSeeHand = isSpectator || p.userId === userId;
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
                autoUntap: p.autoUntap !== false,
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
            zones: p.zones,
        })),
        turnIndex: room.turnIndex,
        teams: room.teams,
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
