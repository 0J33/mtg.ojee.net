const {
    createRoom, getRoom, deleteRoom, getPlayerInRoom, getSpectatorInRoom,
    createCardInstance, createPlayerState, addAction,
    shuffleArray, getRoomStateForPlayer, activeRooms,
    pushUndo, popUndo, restoreSnapshot, appendChatMessage, INFINITE,
} = require('./gameState');

// Returns true if `p` is eliminated (dead). Mirrors the client's logic:
// zero/negative life, 21+ commander damage from any source, or 10+ poison.
function isPlayerEliminated(p) {
    if (!p) return false;
    if (typeof p.life === 'number' && p.life <= 0) return true;
    if ((p.infect || 0) >= 10) return true;
    const dmg = p.commanderDamageFrom || {};
    for (const k of Object.keys(dmg)) {
        if ((dmg[k] || 0) >= 21) return true;
    }
    return false;
}

// Clamp a user-supplied value to a sane range. Supports the "∞" sentinel so
// combo players can express an effectively-infinite resource without triggering
// JSON serialization issues. Negative values are allowed because life totals
// can go negative before being recognized as dead.
function clampGameValue(v, { allowNegative = true } = {}) {
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === '∞' || s === 'inf' || s === 'infinity' || s === 'infinite') return INFINITE;
        const parsed = parseInt(s, 10);
        if (!isNaN(parsed)) v = parsed;
        else return 0;
    }
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    v = Math.round(v);
    if (v > INFINITE) v = INFINITE;
    if (!allowNegative && v < 0) v = 0;
    if (v < -INFINITE) v = -INFINITE;
    return v;
}
const { v4: uuidv4 } = require('uuid');
const GameRoom = require('../models/GameRoom');

// Events that mutate room state and should be snapshotted for undo
const SNAPSHOT_EVENTS = new Set([
    'moveCard', 'tapCard', 'bulkTap', 'bulkMove', 'flipCard', 'toggleFaceDown',
    'shuffleLibrary', 'mill', 'drawCards', 'reorderTopCards', 'scryToBottom',
    'setLife', 'adjustLife', 'setPlayerCounter', 'setCardCounter', 'clearCardCounters',
    'setCommanderDamage', 'incrementCommanderDeaths', 'setCommanderDeaths',
    'setInfect', 'setDesignation', 'createToken', 'createCustomCard',
    'setTeam', 'setTeamLife', 'nextTurn', 'setTurnIndex',
    'untapAll', 'tapAll', 'mulligan', 'putBackFromHand',
    'setBackground', 'tutorCard', 'setBfRow', 'loadDeck', 'startGame',
    'addCardNote', 'removeCardNote', 'clearCardNotes', 'kickPlayer',
]);

// Auto-save interval
const SAVE_INTERVAL = 30000; // 30 seconds
const saveTimers = new Map();

function startAutoSave(roomCode) {
    if (saveTimers.has(roomCode)) return;
    const timer = setInterval(async () => {
        const room = getRoom(roomCode);
        if (!room) { clearInterval(timer); saveTimers.delete(roomCode); return; }
        try {
            await GameRoom.findOneAndUpdate({ roomCode }, room, { upsert: true });
        } catch (err) {
            console.error(`Auto-save failed for ${roomCode}:`, err.message);
        }
    }, SAVE_INTERVAL);
    saveTimers.set(roomCode, timer);
}

function stopAutoSave(roomCode) {
    const timer = saveTimers.get(roomCode);
    if (timer) { clearInterval(timer); saveTimers.delete(roomCode); }
}

// Check whether the game has a winner (exactly one non-eliminated player) and
// fire a one-shot 'victory' broadcast. Tracked via room.winnerUserId so we
// don't spam the notification on every state broadcast after the game ends.
function checkVictory(io, room) {
    if (!room.started) return;
    if (room.winnerUserId) return; // already declared
    const alive = room.players.filter(p => !isPlayerEliminated(p));
    if (alive.length === 1 && room.players.length > 1) {
        const winner = alive[0];
        room.winnerUserId = winner.userId;
        addAction(room, winner.userId, 'victory', { player: winner.username });
        broadcastToRoom(io, room, 'victory', {
            userId: winner.userId,
            username: winner.username,
            ts: Date.now(),
        });
    }
}

function broadcastRoomState(io, room) {
    for (const player of room.players) {
        if (player.socketId) {
            io.to(player.socketId).emit('gameState', getRoomStateForPlayer(room, player.userId));
        }
    }
    // Spectators get a state flagged isSpectator — hands are visible, UI goes read-only.
    for (const spec of (room.spectators || [])) {
        if (spec.socketId) {
            io.to(spec.socketId).emit('gameState', getRoomStateForPlayer(room, spec.userId, { isSpectator: true }));
        }
    }
    checkVictory(io, room);
}

function broadcastToRoom(io, room, event, data, excludeSocketId = null) {
    for (const player of room.players) {
        if (player.socketId && player.socketId !== excludeSocketId) {
            io.to(player.socketId).emit(event, data);
        }
    }
    for (const spec of (room.spectators || [])) {
        if (spec.socketId && spec.socketId !== excludeSocketId) {
            io.to(spec.socketId).emit(event, data);
        }
    }
}

// Events a spectator is allowed to emit. Everything else is dropped server-side
// with an error callback (if the packet carries one) so a client can't escalate
// out of spectator mode by spoofing events.
const SPECTATOR_ALLOWED_EVENTS = new Set([
    'joinRoom', 'joinRoomAsSpectator', 'leaveRoom',
    'sendChatMessage',
    'disconnect', 'disconnecting',
]);

module.exports = function registerSocketHandlers(io) {
    io.on('connection', (socket) => {
        console.log(`[socket] connected: ${socket.id}`);
        let currentRoom = null;
        let currentUserId = null;
        // True when this socket joined as a spectator (not a seated player).
        let isSpectator = false;

        // Socket-level guard + auto-snapshot. Runs before every incoming event.
        socket.use((packet, next) => {
            const eventName = packet[0];
            // Block mutating events from spectators. The check runs before
            // SNAPSHOT_EVENTS so we don't push bogus undo entries.
            if (isSpectator && !SPECTATOR_ALLOWED_EVENTS.has(eventName)) {
                const maybeCallback = packet[packet.length - 1];
                if (typeof maybeCallback === 'function') {
                    maybeCallback({ error: 'Spectators cannot perform game actions' });
                }
                return; // swallow the event
            }
            if (currentRoom && SNAPSHOT_EVENTS.has(eventName)) {
                const room = getRoom(currentRoom);
                if (room) pushUndo(room);
            }
            next();
        });

        // ─── ROOM MANAGEMENT ────────────────────────────────────────────
        socket.on('createRoom', ({ userId, username, settings }, callback) => {
            console.log(`[socket] createRoom from ${socket.id} user=${userId} username=${username}`);
            try {
                currentUserId = userId;
                const room = createRoom(userId, username, settings);
                currentRoom = room.roomCode;
                room.players[0].socketId = socket.id;
                socket.join(room.roomCode);
                startAutoSave(room.roomCode);
                // Emit gameState so client transitions to GameBoard
                socket.emit('gameState', getRoomStateForPlayer(room, userId));
                const response = { success: true, roomCode: room.roomCode };
                console.log(`[socket] createRoom success: ${room.roomCode}`);
                if (typeof callback === 'function') callback(response);
            } catch (err) {
                console.error(`[socket] createRoom error:`, err);
                if (typeof callback === 'function') callback({ error: err.message });
            }
        });

        socket.on('joinRoom', ({ roomCode, userId, username }, callback) => {
            const room = getRoom(roomCode);
            if (!room) return callback({ error: 'Room not found' });
            // If this user was previously spectating this room, drop the spectator
            // entry before seating them as a player so they don't get duplicate
            // gameState broadcasts.
            const existingSpec = getSpectatorInRoom(room, userId);
            if (existingSpec) {
                room.spectators = room.spectators.filter(s => s.userId !== userId);
            }
            // Block joining as a player if room is full — spectators can still join.
            const existingPlayer = getPlayerInRoom(room, userId);
            if (!existingPlayer && room.players.length >= room.settings.maxPlayers) {
                return callback({ error: 'Room is full' });
            }

            currentUserId = userId;
            currentRoom = roomCode;
            isSpectator = false;

            // Check if reconnecting
            let player = existingPlayer;
            if (player) {
                player.socketId = socket.id;
                player.username = username;
            } else {
                player = createPlayerState(userId, username);
                player.socketId = socket.id;
                player.life = room.settings.startingLife;
                room.players.push(player);
            }

            socket.join(roomCode);
            broadcastRoomState(io, room);
            callback({ success: true, state: getRoomStateForPlayer(room, userId) });
        });

        socket.on('joinRoomAsSpectator', ({ roomCode, userId, username }, callback) => {
            const room = getRoom(roomCode);
            if (!room) return callback?.({ error: 'Room not found' });

            // If this user is already a seated player, deny — they should just
            // rejoin normally. Spectating a room you're playing in makes no sense.
            if (getPlayerInRoom(room, userId)) {
                return callback?.({ error: 'You are already a player in this room. Rejoin normally.' });
            }

            currentUserId = userId;
            currentRoom = roomCode;
            isSpectator = true;

            // Reconnect path: if they were already spectating, just refresh socketId.
            let spec = getSpectatorInRoom(room, userId);
            if (spec) {
                spec.socketId = socket.id;
                spec.username = username;
            } else {
                spec = { userId, username, socketId: socket.id };
                if (!room.spectators) room.spectators = [];
                room.spectators.push(spec);
            }

            socket.join(roomCode);
            broadcastRoomState(io, room);
            callback?.({ success: true, state: getRoomStateForPlayer(room, userId, { isSpectator: true }) });
        });

        socket.on('sendChatMessage', ({ text }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const trimmed = (text || '').toString().trim().slice(0, 500);
            if (!trimmed) return callback?.({ error: 'Empty message' });

            // Look up the sender's username — from player record if seated, else
            // the spectator record. currentUserId is set at join time.
            const player = getPlayerInRoom(room, currentUserId);
            const spec = getSpectatorInRoom(room, currentUserId);
            const sender = player || spec;
            if (!sender) return callback?.({ error: 'Not in room' });

            const msg = appendChatMessage(room, {
                userId: currentUserId,
                username: sender.username,
                text: trimmed,
                isSpectator: !player,
            });
            // Broadcast just the new message so clients can append without
            // re-rendering the whole board. gameState still carries full history
            // for late joiners / reconnects.
            broadcastToRoom(io, room, 'chatMessage', msg);
            callback?.({ success: true });
        });

        socket.on('kickPlayer', ({ targetPlayerId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            if (room.hostId !== currentUserId) return callback?.({ error: 'Only the host can kick players' });
            if (targetPlayerId === room.hostId) return callback?.({ error: 'Cannot kick the host' });

            const idx = room.players.findIndex(p => p.userId === targetPlayerId);
            if (idx === -1) return callback?.({ error: 'Player not found' });

            const kicked = room.players[idx];
            if (kicked.socketId) {
                io.to(kicked.socketId).emit('kicked', { roomCode: currentRoom });
                const kickedSocket = io.sockets.sockets.get(kicked.socketId);
                if (kickedSocket) kickedSocket.leave(currentRoom);
            }
            room.players.splice(idx, 1);
            addAction(room, currentUserId, 'kickPlayer', { kicked: kicked.username });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('leaveRoom', (callback) => {
            if (!currentRoom) return callback?.({ error: 'Not in a room' });
            const room = getRoom(currentRoom);
            if (room) {
                if (isSpectator) {
                    // Spectators just get removed outright — no persistence required.
                    room.spectators = (room.spectators || []).filter(s => s.userId !== currentUserId);
                } else {
                    const player = getPlayerInRoom(room, currentUserId);
                    if (player) player.socketId = null;
                }
                broadcastRoomState(io, room);
                if (room.players.every(p => !p.socketId)) {
                    stopAutoSave(currentRoom);
                }
            }
            socket.leave(currentRoom);
            currentRoom = null;
            isSpectator = false;
            callback?.({ success: true });
        });

        // ─── DECK LOADING ───────────────────────────────────────────────
        socket.on('loadDeck', ({ deckData }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            // Clear existing zones
            player.zones = { hand: [], library: [], battlefield: [], graveyard: [], exile: [], commandZone: [] };
            player.commanderDeaths = 0;
            player.commanderTax = 0;
            player.commanderDamageFrom = {};
            player.life = room.settings.startingLife;
            player.counters = { poison: 0, energy: 0, experience: 0 };

            // Load commanders into command zone
            for (const card of (deckData.commanders || [])) {
                for (let i = 0; i < (card.quantity || 1); i++) {
                    player.zones.commandZone.push(createCardInstance(card));
                }
            }

            // Load mainboard into library
            for (const card of (deckData.mainboard || [])) {
                for (let i = 0; i < (card.quantity || 1); i++) {
                    player.zones.library.push(createCardInstance(card));
                }
            }

            // Shuffle library
            shuffleArray(player.zones.library);

            addAction(room, currentUserId, 'loadDeck', { deckName: deckData.name });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // ─── CARD ACTIONS ───────────────────────────────────────────────
        socket.on('drawCards', ({ count }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            const drawn = [];
            const num = Math.min(count || 1, player.zones.library.length);
            for (let i = 0; i < num; i++) {
                const card = player.zones.library.shift();
                if (card) {
                    player.zones.hand.push(card);
                    drawn.push(card);
                }
            }

            addAction(room, currentUserId, 'drawCards', { count: num });
            broadcastRoomState(io, room);
            callback?.({ success: true, drawn });
        });

        socket.on('moveCard', ({ instanceId, fromZone, toZone, targetPlayerId, x, y, faceDown }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });

            // Find source player and card
            let sourcePlayer = null;
            let card = null;
            let cardIndex = -1;

            for (const p of room.players) {
                const zone = p.zones[fromZone];
                if (!zone) continue;
                const idx = zone.findIndex(c => c.instanceId === instanceId);
                if (idx !== -1) {
                    sourcePlayer = p;
                    card = zone[idx];
                    cardIndex = idx;
                    break;
                }
            }

            if (!card) return callback?.({ error: 'Card not found' });

            // Remove from source
            sourcePlayer.zones[fromZone].splice(cardIndex, 1);

            // Determine target player
            const targetPlayer = targetPlayerId
                ? getPlayerInRoom(room, targetPlayerId)
                : sourcePlayer;
            if (!targetPlayer) return callback?.({ error: 'Target player not found' });

            // Update card properties
            if (x !== undefined) card.x = x;
            if (y !== undefined) card.y = y;
            if (toZone !== 'battlefield') { card.x = 0; card.y = 0; }
            if (faceDown !== undefined) card.faceDown = faceDown;
            if (toZone === 'hand' || toZone === 'library') card.tapped = false;
            if (toZone === 'commandZone' && fromZone === 'graveyard') {
                // Commander died and returned to command zone
                targetPlayer.commanderDeaths++;
            }

            // Add to target zone
            targetPlayer.zones[toZone].push(card);

            addAction(room, currentUserId, 'moveCard', {
                cardName: card.name, fromZone, toZone,
                fromPlayer: sourcePlayer.username,
                toPlayer: targetPlayer.username,
            });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('tapCard', ({ instanceId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });

            for (const player of room.players) {
                for (const card of player.zones.battlefield) {
                    if (card.instanceId === instanceId) {
                        card.tapped = !card.tapped;
                        addAction(room, currentUserId, 'tapCard', { cardName: card.name, tapped: card.tapped });
                        broadcastRoomState(io, room);
                        return callback?.({ success: true, tapped: card.tapped });
                    }
                }
            }
            callback?.({ error: 'Card not found on battlefield' });
        });


        socket.on('bulkTap', ({ instanceIds, tapped }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const ids = new Set(instanceIds || []);
            let count = 0;
            for (const player of room.players) {
                for (const card of player.zones.battlefield) {
                    if (ids.has(card.instanceId)) {
                        card.tapped = tapped === undefined ? !card.tapped : tapped;
                        count++;
                    }
                }
            }
            if (count > 0) {
                addAction(room, currentUserId, 'bulkTap', { count, tapped });
                broadcastRoomState(io, room);
            }
            callback?.({ success: true, count });
        });

        socket.on('bulkMove', ({ instanceIds, toZone, targetPlayerId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const ids = new Set(instanceIds || []);
            let moved = 0;
            const targetPlayer = targetPlayerId
                ? getPlayerInRoom(room, targetPlayerId)
                : null;

            for (const player of room.players) {
                for (const zoneName of Object.keys(player.zones)) {
                    const zone = player.zones[zoneName];
                    for (let i = zone.length - 1; i >= 0; i--) {
                        if (ids.has(zone[i].instanceId)) {
                            const [card] = zone.splice(i, 1);
                            if (toZone !== 'battlefield') { card.x = 0; card.y = 0; card.tapped = false; }
                            const dest = targetPlayer || player;
                            dest.zones[toZone].push(card);
                            moved++;
                        }
                    }
                }
            }
            if (moved > 0) {
                addAction(room, currentUserId, 'bulkMove', { count: moved, toZone });
                broadcastRoomState(io, room);
            }
            callback?.({ success: true, count: moved });
        });

        // Helper to find a card across all zones for any player
        const findCardAnywhere = (room, instanceId) => {
            for (const player of room.players) {
                for (const zoneName of Object.keys(player.zones || {})) {
                    const zone = player.zones[zoneName];
                    if (!Array.isArray(zone)) continue;
                    const card = zone.find(c => c.instanceId === instanceId);
                    if (card) return card;
                }
            }
            return null;
        };

        socket.on('addCardNote', ({ instanceId, note }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const noteObj = typeof note === 'string'
                ? { text: note.slice(0, 300), card: null }
                : { text: String(note?.text || '').slice(0, 300), card: note?.card || null };
            if (!noteObj.text) return callback?.({ error: 'Empty note' });
            const card = findCardAnywhere(room, instanceId);
            if (!card) return callback?.({ error: 'Card not found' });
            if (!Array.isArray(card.notes)) card.notes = [];
            card.notes.push(noteObj);
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('removeCardNote', ({ instanceId, index }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const card = findCardAnywhere(room, instanceId);
            if (!card) return callback?.({ error: 'Card not found' });
            if (Array.isArray(card.notes) && index >= 0 && index < card.notes.length) {
                card.notes.splice(index, 1);
            }
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('clearCardNotes', ({ instanceId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const card = findCardAnywhere(room, instanceId);
            if (!card) return callback?.({ error: 'Card not found' });
            card.notes = [];
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('setBfRow', ({ instanceId, bfRow }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            for (const player of room.players) {
                for (const card of player.zones.battlefield) {
                    if (card.instanceId === instanceId) {
                        card.bfRow = bfRow || null;
                        broadcastRoomState(io, room);
                        return callback?.({ success: true });
                    }
                }
            }
            callback?.({ error: 'Card not found on battlefield' });
        });

        socket.on('flipCard', ({ instanceId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });

            for (const player of room.players) {
                for (const zone of Object.values(player.zones)) {
                    const card = zone.find(c => c.instanceId === instanceId);
                    if (card) {
                        card.flipped = !card.flipped;
                        addAction(room, currentUserId, 'flipCard', { cardName: card.name });
                        broadcastRoomState(io, room);
                        return callback?.({ success: true });
                    }
                }
            }
            callback?.({ error: 'Card not found' });
        });

        socket.on('toggleFaceDown', ({ instanceId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });

            for (const player of room.players) {
                for (const zone of Object.values(player.zones)) {
                    const card = zone.find(c => c.instanceId === instanceId);
                    if (card) {
                        card.faceDown = !card.faceDown;
                        addAction(room, currentUserId, 'toggleFaceDown', { cardName: card.faceDown ? '(face-down card)' : card.name });
                        broadcastRoomState(io, room);
                        return callback?.({ success: true });
                    }
                }
            }
            callback?.({ error: 'Card not found' });
        });

        socket.on('updateCardPosition', ({ instanceId, x, y, zIndex }) => {
            const room = getRoom(currentRoom);
            if (!room) return;

            for (const player of room.players) {
                const card = player.zones.battlefield.find(c => c.instanceId === instanceId);
                if (card) {
                    card.x = x;
                    card.y = y;
                    if (zIndex !== undefined) card.zIndex = zIndex;
                    // Broadcast position update without full state rebuild
                    broadcastToRoom(io, room, 'cardPositionUpdate', { instanceId, x, y, zIndex }, socket.id);
                    return;
                }
            }
        });

        socket.on('shuffleLibrary', (callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            shuffleArray(player.zones.library);
            addAction(room, currentUserId, 'shuffleLibrary', {});
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('rollDice', ({ sides, count }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            const numDice = Math.min(Math.max(1, count || 1), 20);
            const numSides = Math.max(2, sides || 6);
            const results = [];
            for (let i = 0; i < numDice; i++) {
                results.push(Math.floor(Math.random() * numSides) + 1);
            }
            const total = results.reduce((a, b) => a + b, 0);

            const event = {
                id: uuidv4(),
                type: 'dice',
                sides: numSides,
                count: numDice,
                results,
                total,
                playerId: currentUserId,
                playerName: player.username,
                timestamp: Date.now(),
            };
            broadcastToRoom(io, room, 'rollResult', event);
            addAction(room, currentUserId, 'rollDice', { sides: numSides, count: numDice, results });
            callback?.({ success: true, ...event });
        });

        socket.on('flipCoin', ({ count }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            const numCoins = Math.min(Math.max(1, count || 1), 20);
            const results = [];
            for (let i = 0; i < numCoins; i++) {
                results.push(Math.random() < 0.5 ? 'Heads' : 'Tails');
            }

            const event = {
                id: uuidv4(),
                type: 'coin',
                count: numCoins,
                results,
                playerId: currentUserId,
                playerName: player.username,
                timestamp: Date.now(),
            };
            broadcastToRoom(io, room, 'rollResult', event);
            addAction(room, currentUserId, 'flipCoin', { count: numCoins, results });
            callback?.({ success: true, ...event });
        });

        socket.on('viewLibrary', (callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            // Return only this player's library to themselves
            callback?.({ success: true, library: player.zones.library });
        });

        socket.on('tutorCard', ({ instanceId, toZone, shuffle, libraryPosition }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            const idx = player.zones.library.findIndex(c => c.instanceId === instanceId);
            if (idx === -1) return callback?.({ error: 'Card not in your library' });
            const [card] = player.zones.library.splice(idx, 1);
            const dest = toZone || 'hand';
            if (dest !== 'battlefield') { card.tapped = false; card.x = 0; card.y = 0; }

            // If the destination is library, allow putting the card at a
            // specific index (0 = top). Missing/undefined position → top.
            if (dest === 'library') {
                const pos = typeof libraryPosition === 'number'
                    ? Math.max(0, Math.min(libraryPosition, player.zones.library.length))
                    : 0;
                player.zones.library.splice(pos, 0, card);
            } else {
                player.zones[dest].push(card);
            }

            // Shuffle is now opt-in only. Default is OFF because "tutor then
            // shuffle" is the less common case — most search effects want you
            // to put the card in hand without touching library order.
            if (shuffle) shuffleArray(player.zones.library);

            addAction(room, currentUserId, 'tutor', { cardName: card.name, toZone: dest, shuffled: !!shuffle });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Reveal the current user's hand to a list of target players (or 'all').
        socket.on('revealHand', ({ targetPlayerIds }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            const cards = player.zones.hand || [];
            // Never send the reveal back to the sender — they already know
            // what's in their own hand, the modal would be noise.
            const targets = (targetPlayerIds === 'all'
                ? room.players.filter(p => p.userId !== currentUserId)
                : room.players.filter(p => (targetPlayerIds || []).includes(p.userId) && p.userId !== currentUserId));

            for (const p of targets) {
                if (p.socketId) {
                    io.to(p.socketId).emit('handRevealed', {
                        revealedBy: currentUserId,
                        revealedByName: player.username,
                        cards,
                    });
                }
            }
            // Spectators always see hands anyway, so no need to send to them.
            addAction(room, currentUserId, 'revealHand', {
                player: player.username,
                handCount: cards.length,
                to: targetPlayerIds === 'all' ? 'all' : `${targets.length} player(s)`,
            });
            callback?.({ success: true });
        });

        socket.on('mill', ({ count }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            const num = Math.min(count || 1, player.zones.library.length);
            const milled = [];
            for (let i = 0; i < num; i++) {
                const card = player.zones.library.shift();
                if (card) {
                    card.tapped = false;
                    player.zones.graveyard.push(card);
                    milled.push(card.name);
                }
            }

            addAction(room, currentUserId, 'mill', { count: num, cards: milled });
            broadcastRoomState(io, room);
            callback?.({ success: true, milled });
        });

        // ─── SCRY / REVEAL ──────────────────────────────────────────────
        socket.on('scry', ({ count }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            const num = Math.min(count || 1, player.zones.library.length);
            const cards = player.zones.library.slice(0, num);
            addAction(room, currentUserId, 'scry', { count: num });
            // Only send to the requesting player
            callback?.({ success: true, cards });
        });

        socket.on('reorderTopCards', ({ cardOrder }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            // cardOrder is array of instanceIds in desired order (top of library first)
            const topCards = player.zones.library.splice(0, cardOrder.length);
            const reordered = cardOrder.map(id => topCards.find(c => c.instanceId === id)).filter(Boolean);
            player.zones.library.unshift(...reordered);

            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('scryToBottom', ({ instanceIds }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            // Move specific cards from top to bottom of library
            for (const id of (instanceIds || [])) {
                const idx = player.zones.library.findIndex(c => c.instanceId === id);
                if (idx !== -1) {
                    const [card] = player.zones.library.splice(idx, 1);
                    player.zones.library.push(card);
                }
            }

            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('revealCard', ({ instanceId, targetPlayerIds }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });

            // Find the card
            let foundCard = null;
            for (const player of room.players) {
                for (const zone of Object.values(player.zones)) {
                    const card = zone.find(c => c.instanceId === instanceId);
                    if (card) { foundCard = card; break; }
                }
                if (foundCard) break;
            }
            if (!foundCard) return callback?.({ error: 'Card not found' });

            // Send to specific players or all. "All" means all OTHER players —
            // no point spamming the sender with their own reveal.
            const targets = (targetPlayerIds === 'all'
                ? room.players.filter(p => p.userId !== currentUserId)
                : room.players.filter(p => (targetPlayerIds || []).includes(p.userId) && p.userId !== currentUserId));

            for (const player of targets) {
                if (player.socketId) {
                    io.to(player.socketId).emit('cardRevealed', {
                        revealedBy: currentUserId,
                        card: foundCard,
                    });
                }
            }

            addAction(room, currentUserId, 'revealCard', {
                cardName: foundCard.name,
                to: targetPlayerIds === 'all' ? 'all' : `${targets.length} player(s)`,
            });
            callback?.({ success: true });
        });

        // ─── COUNTERS & LIFE ────────────────────────────────────────────
        socket.on('setLife', ({ targetPlayerId, life }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!player) return callback?.({ error: 'Player not found' });

            const oldLife = player.life;
            player.life = clampGameValue(life);
            addAction(room, currentUserId, 'setLife', { target: player.username, from: oldLife, to: player.life });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('adjustLife', ({ targetPlayerId, amount }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!player) return callback?.({ error: 'Player not found' });

            // If life is already at the infinite sentinel, don't move it —
            // infinite +/- anything is still infinite.
            if (player.life >= INFINITE) {
                // Noop — already infinite.
            } else {
                player.life = clampGameValue((player.life || 0) + (typeof amount === 'number' ? amount : 0));
            }
            addAction(room, currentUserId, 'adjustLife', { target: player.username, amount, newLife: player.life });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('setPlayerCounter', ({ targetPlayerId, counter, value }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!player) return callback?.({ error: 'Player not found' });

            if (typeof player.counters !== 'object') player.counters = {};
            player.counters[counter] = clampGameValue(value, { allowNegative: false });
            addAction(room, currentUserId, 'setPlayerCounter', { target: player.username, counter, value: player.counters[counter] });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('setCardCounter', ({ instanceId, counter, value }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });

            const card = findCardAnywhere(room, instanceId);
            if (!card) return callback?.({ error: 'Card not found' });
            if (typeof card.counters !== 'object') card.counters = {};
            const clamped = clampGameValue(value);
            if (clamped === 0) {
                delete card.counters[counter];
            } else {
                card.counters[counter] = clamped;
            }
            addAction(room, currentUserId, 'setCardCounter', { cardName: card.name, counter, value: clamped });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('clearCardCounters', ({ instanceId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const card = findCardAnywhere(room, instanceId);
            if (!card) return callback?.({ error: 'Card not found' });
            card.counters = {};
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('setInfect', ({ toPlayerId, amount }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const target = getPlayerInRoom(room, toPlayerId);
            if (!target) return callback?.({ error: 'Target not found' });
            target.infect = clampGameValue(amount, { allowNegative: false });
            addAction(room, currentUserId, 'setInfect', { to: target.username, amount: target.infect });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('setCommanderDamage', ({ fromPlayerId, toPlayerId, damage, applyToLife }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const target = getPlayerInRoom(room, toPlayerId);
            if (!target) return callback?.({ error: 'Target not found' });

            if (typeof target.commanderDamageFrom !== 'object') target.commanderDamageFrom = {};
            const previous = target.commanderDamageFrom[fromPlayerId] || 0;
            const clamped = clampGameValue(damage, { allowNegative: false });
            const delta = clamped - previous;
            target.commanderDamageFrom[fromPlayerId] = clamped;

            // Apply delta to life total (default true). Infinite life can't
            // be reduced, and infinite damage will leave their life at 0.
            if (applyToLife !== false && delta !== 0 && target.life < INFINITE) {
                target.life = clampGameValue((target.life || 0) - delta);
            }

            addAction(room, currentUserId, 'setCommanderDamage', { from: fromPlayerId, to: target.username, damage: clamped, lifeAdjusted: applyToLife !== false ? -delta : 0 });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('incrementCommanderDeaths', ({ targetPlayerId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!player) return callback?.({ error: 'Player not found' });

            player.commanderDeaths++;
            player.commanderTax = player.commanderDeaths * 2;
            addAction(room, currentUserId, 'commanderDied', { player: player.username, deaths: player.commanderDeaths });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('setCommanderDeaths', ({ targetPlayerId, value }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!player) return callback?.({ error: 'Player not found' });

            player.commanderDeaths = Math.max(0, value || 0);
            player.commanderTax = player.commanderDeaths * 2;
            addAction(room, currentUserId, 'setCommanderDeaths', { player: player.username, deaths: player.commanderDeaths });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // ─── DESIGNATIONS ───────────────────────────────────────────────
        socket.on('setDesignation', ({ targetPlayerId, designation, value }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const target = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!target) return callback?.({ error: 'Player not found' });

            // For monarch/initiative, remove from other players first
            if ((designation === 'monarch' || designation === 'initiative') && value) {
                for (const p of room.players) {
                    p.designations[designation] = false;
                }
            }

            target.designations[designation] = value;
            addAction(room, currentUserId, 'setDesignation', { target: target.username, designation, value });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // ─── TOKENS ─────────────────────────────────────────────────────
        socket.on('createToken', ({ cardData, count }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            const tokens = [];
            for (let i = 0; i < (count || 1); i++) {
                const token = createCardInstance(cardData, { isToken: true });
                player.zones.battlefield.push(token);
                tokens.push(token);
            }

            addAction(room, currentUserId, 'createToken', { name: cardData.name, count: count || 1 });
            broadcastRoomState(io, room);
            callback?.({ success: true, tokens });
        });

        socket.on('createCustomCard', ({ name, imageUrl, typeLine, manaCost, oracleText, power, toughness, colors }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            const card = createCardInstance({
                name: name || 'Custom Card',
                typeLine: typeLine || '',
                manaCost: manaCost || '',
                oracleText: oracleText || '',
                power: power || '',
                toughness: toughness || '',
                colors: colors || [],
                isCustom: true,
                customImageUrl: imageUrl || '',
                imageUri: imageUrl || '',
            });
            player.zones.battlefield.push(card);

            addAction(room, currentUserId, 'createCustomCard', { name });
            broadcastRoomState(io, room);
            callback?.({ success: true, card });
        });

        // ─── TEAMS ──────────────────────────────────────────────────────
        socket.on('setTeam', ({ playerId, teamId, teamName, sharedLife }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, playerId || currentUserId);
            if (!player) return callback?.({ error: 'Player not found' });

            player.teamId = teamId;

            // Create or update team
            if (teamId) {
                let team = room.teams.find(t => t.teamId === teamId);
                if (!team) {
                    team = { teamId, name: teamName || `Team ${room.teams.length + 1}`, sharedLife: sharedLife || null };
                    room.teams.push(team);
                }
                if (sharedLife !== undefined) team.sharedLife = sharedLife;
            }

            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('setTeamLife', ({ teamId, life }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const team = room.teams.find(t => t.teamId === teamId);
            if (!team) return callback?.({ error: 'Team not found' });

            team.sharedLife = life;
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // ─── TURN & PHASE ───────────────────────────────────────────────
        socket.on('nextTurn', (callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });

            const endingPlayer = room.players[room.turnIndex];
            // Only the current-turn player can end their own turn. The host is
            // also allowed to advance for AFK/disconnected players, otherwise
            // a stuck game can't progress.
            if (endingPlayer && endingPlayer.userId !== currentUserId && room.hostId !== currentUserId) {
                return callback?.({ error: "Only the current turn player (or host) can end the turn" });
            }

            // Log the turn ending explicitly — lets the action log show a
            // clean "X ended their turn" → "Y's turn begins" sequence.
            if (endingPlayer) {
                addAction(room, currentUserId, 'turnEnd', { player: endingPlayer.username });
            }

            // Advance through eliminated players automatically. Safety cap
            // equal to player count so we can't infinite-loop if everyone is
            // somehow dead.
            const total = room.players.length;
            let advanced = 0;
            do {
                room.turnIndex = (room.turnIndex + 1) % total;
                advanced++;
            } while (isPlayerEliminated(room.players[room.turnIndex]) && advanced < total);

            room.currentPhase = 'untap';
            const newPlayer = room.players[room.turnIndex];

            // Auto-untap respects the new player's per-player toggle. Default
            // is on; player can switch it off for upkeep effects like Thousand-
            // Year Elixir or similar "doesn't untap" plays.
            if (newPlayer && newPlayer.zones?.battlefield && newPlayer.autoUntap !== false) {
                for (const card of newPlayer.zones.battlefield) {
                    card.tapped = false;
                }
            }

            addAction(room, currentUserId, 'turnStart', { player: newPlayer?.username });
            broadcastToRoom(io, room, 'notification', {
                type: 'turn',
                message: `${newPlayer?.username || '?'}'s turn`,
                playerId: newPlayer?.userId,
            });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Toggle the per-player auto-untap setting. A player can only change
        // their own flag (no forcing someone else's battlefield to untap).
        socket.on('setAutoUntap', ({ value }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            player.autoUntap = !!value;
            addAction(room, currentUserId, 'setAutoUntap', { value: !!value });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('setPhase', ({ phase }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            room.currentPhase = phase;
            broadcastToRoom(io, room, 'phaseChanged', { phase, changedBy: currentUserId });
            callback?.({ success: true });
        });

        socket.on('setTurnIndex', ({ index }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            room.turnIndex = index;
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // ─── UNTAP ALL ──────────────────────────────────────────────────
        socket.on('untapAll', (callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            for (const card of player.zones.battlefield) {
                card.tapped = false;
            }
            addAction(room, currentUserId, 'untapAll', {});
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // ─── TAP ALL ────────────────────────────────────────────────────
        socket.on('tapAll', ({ landsOnly }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            let tapped = 0;
            for (const card of player.zones.battlefield) {
                if (card.tapped) continue;
                if (landsOnly && !/Land/i.test(card.typeLine || '')) continue;
                card.tapped = true;
                tapped++;
            }
            addAction(room, currentUserId, 'tapAll', { count: tapped, landsOnly });
            broadcastRoomState(io, room);
            callback?.({ success: true, count: tapped });
        });

        // ─── MULLIGAN ───────────────────────────────────────────────────
        socket.on('mulligan', ({ putBackCount }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            // Mulligan sequence: initial draw = 7 (mulliganCount 0).
            //   mulligan 1 → draws 7 ("free" first mulligan)
            //   mulligan 2 → draws 6
            //   mulligan 3 → draws 5
            //   mulligan 4+ → blocked
            if ((player.mulliganCount || 0) >= 3) {
                return callback?.({ error: 'No more mulligans (minimum 5 cards reached)' });
            }
            player.mulliganCount = (player.mulliganCount || 0) + 1;
            const drawSize = 8 - player.mulliganCount;

            // Return hand to library
            player.zones.library.push(...player.zones.hand);
            player.zones.hand = [];

            // Shuffle
            shuffleArray(player.zones.library);

            // Draw new hand
            const drawCount = Math.min(drawSize, player.zones.library.length);
            for (let i = 0; i < drawCount; i++) {
                player.zones.hand.push(player.zones.library.shift());
            }

            addAction(room, currentUserId, 'mulligan', { handSize: drawCount, mulliganNumber: player.mulliganCount });
            broadcastToRoom(io, room, 'notification', {
                type: 'mulligan',
                message: `${player.username} mulled to ${drawCount}`,
            });
            broadcastRoomState(io, room);
            callback?.({ success: true, handSize: drawCount, mulliganCount: player.mulliganCount });
        });

        socket.on('putBackFromHand', ({ instanceIds, toBottom }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            for (const id of (instanceIds || [])) {
                const idx = player.zones.hand.findIndex(c => c.instanceId === id);
                if (idx !== -1) {
                    const [card] = player.zones.hand.splice(idx, 1);
                    if (toBottom) {
                        player.zones.library.push(card);
                    } else {
                        player.zones.library.unshift(card);
                    }
                }
            }

            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // ─── DRAWING ────────────────────────────────────────────────────
        socket.on('drawStroke', ({ strokeId, points, color, size }) => {
            const room = getRoom(currentRoom);
            if (!room) return;

            const stroke = { strokeId: strokeId || uuidv4(), playerId: currentUserId, points, color, size };
            room.drawings.push(stroke);
            broadcastToRoom(io, room, 'newStroke', stroke, socket.id);
        });

        socket.on('clearDrawings', ({ mine }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });

            if (mine) {
                room.drawings = room.drawings.filter(d => d.playerId !== currentUserId);
            } else {
                room.drawings = [];
            }

            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Erase specific strokes by id. The eraser tool runs hit-testing on
        // the client and sends up the ids of strokes it touched. We rebroadcast
        // an 'erasedStrokes' event so other clients can remove them without
        // needing the full gameState round-trip.
        socket.on('eraseStrokes', ({ strokeIds }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            if (!Array.isArray(strokeIds) || strokeIds.length === 0) return callback?.({ error: 'No strokes' });
            const ids = new Set(strokeIds);
            room.drawings = room.drawings.filter(d => !ids.has(d.strokeId));
            broadcastToRoom(io, room, 'erasedStrokes', { strokeIds });
            callback?.({ success: true });
        });

        // ─── UNDO ───────────────────────────────────────────────────────
        socket.on('undo', (callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });

            const snapshot = popUndo(room);
            if (!snapshot) {
                return callback?.({ error: 'Nothing to undo' });
            }
            restoreSnapshot(room, snapshot);
            addAction(room, currentUserId, 'undo', { undoStackSize: room.undoStack?.length || 0 });
            broadcastRoomState(io, room);
            callback?.({ success: true, undoStackSize: room.undoStack?.length || 0 });
        });

        // ─── CUSTOM BACKGROUND ──────────────────────────────────────────
        socket.on('setBackground', ({ imageUrl }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            player.background = imageUrl;
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // ─── GAME START ─────────────────────────────────────────────────
        socket.on('startGame', (callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            if (room.hostId !== currentUserId) return callback?.({ error: 'Only host can start' });

            // Shuffle each player's library and have them draw 7
            for (const player of room.players) {
                // Return any cards in hand back to library before shuffling
                if (player.zones.hand && player.zones.hand.length > 0) {
                    player.zones.library.push(...player.zones.hand);
                    player.zones.hand = [];
                }
                if (player.zones.library && player.zones.library.length > 0) {
                    shuffleArray(player.zones.library);
                    const drawCount = Math.min(7, player.zones.library.length);
                    for (let i = 0; i < drawCount; i++) {
                        player.zones.hand.push(player.zones.library.shift());
                    }
                }
                player.life = room.settings.startingLife;
                player.mulliganCount = 0;
            }

            room.started = true;
            room.winnerUserId = null; // clear any previous victor for rematches
            room.turnIndex = Math.floor(Math.random() * room.players.length); // random first player
            const firstPlayer = room.players[room.turnIndex];
            addAction(room, currentUserId, 'startGame', { firstPlayer: firstPlayer?.username });
            addAction(room, currentUserId, 'turnStart', { player: firstPlayer?.username });
            broadcastToRoom(io, room, 'notification', {
                type: 'game-start',
                message: `Game started — ${firstPlayer?.username} goes first`,
            });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // ─── DISCONNECT ─────────────────────────────────────────────────
        socket.on('disconnect', () => {
            if (!currentRoom) return;
            const room = getRoom(currentRoom);
            if (!room) return;

            if (isSpectator) {
                // Drop spectator on disconnect — no reconnect state to preserve.
                room.spectators = (room.spectators || []).filter(s => s.userId !== currentUserId);
            } else {
                const player = getPlayerInRoom(room, currentUserId);
                if (player) player.socketId = null;
            }

            broadcastRoomState(io, room);

            // If all players disconnected, keep room alive for reconnect but stop auto-save
            if (room.players.every(p => !p.socketId)) {
                stopAutoSave(currentRoom);
                // Save one final time
                GameRoom.findOneAndUpdate({ roomCode: currentRoom }, room, { upsert: true }).catch(() => {});
            }
        });
    });
};
