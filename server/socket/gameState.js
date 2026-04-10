const { v4: uuidv4 } = require('uuid');

// In-memory game rooms (also saved to MongoDB periodically)
const activeRooms = new Map();

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
        mulliganCount: 0, // 0 = haven't mulled, 1 = mulled once (drew 6), 2 = mulled twice (drew 5)
    };
}

function createRoom(hostId, hostUsername, settings = {}) {
    let roomCode;
    do { roomCode = generateRoomCode(); } while (activeRooms.has(roomCode));

    const room = {
        roomCode,
        hostId,
        players: [createPlayerState(hostId, hostUsername)],
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

// Get sanitized room state for a specific player (hides private info)
function getRoomStateForPlayer(room, userId) {
    return {
        roomCode: room.roomCode,
        hostId: room.hostId,
        turnIndex: room.turnIndex,
        currentPhase: room.currentPhase,
        settings: room.settings,
        teams: room.teams,
        started: room.started,
        drawings: room.drawings,
        players: room.players.map(p => {
            const isOwner = p.userId === userId;
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
                connected: !!p.socketId,
                zones: {
                    hand: isOwner ? p.zones.hand : p.zones.hand.map(() => ({ hidden: true })),
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
    addAction,
    shuffleArray,
    getRoomStateForPlayer,
    snapshotState,
    pushUndo,
    popUndo,
    restoreSnapshot,
    getAllRooms,
};
