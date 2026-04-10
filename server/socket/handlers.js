const {
    createRoom, getRoom, deleteRoom, getPlayerInRoom,
    createCardInstance, createPlayerState, addAction,
    shuffleArray, getRoomStateForPlayer, activeRooms,
    pushUndo, popUndo, restoreSnapshot,
} = require('./gameState');
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

function broadcastRoomState(io, room) {
    for (const player of room.players) {
        if (player.socketId) {
            io.to(player.socketId).emit('gameState', getRoomStateForPlayer(room, player.userId));
        }
    }
}

function broadcastToRoom(io, room, event, data, excludeSocketId = null) {
    for (const player of room.players) {
        if (player.socketId && player.socketId !== excludeSocketId) {
            io.to(player.socketId).emit(event, data);
        }
    }
}

module.exports = function registerSocketHandlers(io) {
    io.on('connection', (socket) => {
        console.log(`[socket] connected: ${socket.id}`);
        let currentRoom = null;
        let currentUserId = null;

        // Auto-snapshot state before any mutating event for undo support
        socket.use((packet, next) => {
            const eventName = packet[0];
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
            if (room.players.length >= room.settings.maxPlayers) return callback({ error: 'Room is full' });

            currentUserId = userId;
            currentRoom = roomCode;

            // Check if reconnecting
            let player = getPlayerInRoom(room, userId);
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
                const player = getPlayerInRoom(room, currentUserId);
                if (player) player.socketId = null;
                broadcastRoomState(io, room);
                if (room.players.every(p => !p.socketId)) {
                    stopAutoSave(currentRoom);
                }
            }
            socket.leave(currentRoom);
            currentRoom = null;
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

        socket.on('tutorCard', ({ instanceId, toZone, shuffle }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            const idx = player.zones.library.findIndex(c => c.instanceId === instanceId);
            if (idx === -1) return callback?.({ error: 'Card not in your library' });
            const [card] = player.zones.library.splice(idx, 1);
            const dest = toZone || 'hand';
            if (dest !== 'battlefield') { card.tapped = false; card.x = 0; card.y = 0; }
            player.zones[dest].push(card);

            if (shuffle) shuffleArray(player.zones.library);

            addAction(room, currentUserId, 'tutor', { cardName: card.name, toZone: dest, shuffled: !!shuffle });
            broadcastRoomState(io, room);
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

            // Send to specific players or all
            const targets = targetPlayerIds === 'all'
                ? room.players
                : room.players.filter(p => targetPlayerIds.includes(p.userId));

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
            player.life = life;
            addAction(room, currentUserId, 'setLife', { target: player.username, from: oldLife, to: life });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('adjustLife', ({ targetPlayerId, amount }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!player) return callback?.({ error: 'Player not found' });

            player.life += amount;
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
            player.counters[counter] = value;
            addAction(room, currentUserId, 'setPlayerCounter', { target: player.username, counter, value });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('setCardCounter', ({ instanceId, counter, value }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });

            const card = findCardAnywhere(room, instanceId);
            if (!card) return callback?.({ error: 'Card not found' });
            if (typeof card.counters !== 'object') card.counters = {};
            if (value === 0) {
                delete card.counters[counter];
            } else {
                card.counters[counter] = value;
            }
            addAction(room, currentUserId, 'setCardCounter', { cardName: card.name, counter, value });
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
            target.infect = Math.max(0, amount);
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
            const delta = damage - previous;
            target.commanderDamageFrom[fromPlayerId] = damage;

            // Apply delta to life total (default true)
            if (applyToLife !== false && delta !== 0) {
                target.life -= delta;
            }

            addAction(room, currentUserId, 'setCommanderDamage', { from: fromPlayerId, to: target.username, damage, lifeAdjusted: applyToLife !== false ? -delta : 0 });
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
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            room.currentPhase = 'untap';
            const newPlayer = room.players[room.turnIndex];

            // Untap all of new turn player's battlefield
            if (newPlayer && newPlayer.zones?.battlefield) {
                for (const card of newPlayer.zones.battlefield) {
                    card.tapped = false;
                }
            }

            addAction(room, currentUserId, 'nextTurn', { turnPlayer: newPlayer.username });
            broadcastToRoom(io, room, 'notification', {
                type: 'turn',
                message: `${newPlayer.username}'s turn`,
                playerId: newPlayer.userId,
            });
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

            // Mulligan cap: 0 (initial 7) -> 1 (6) -> 2 (5), then blocked
            if ((player.mulliganCount || 0) >= 2) {
                return callback?.({ error: 'No more mulligans (minimum 5 cards reached)' });
            }
            player.mulliganCount = (player.mulliganCount || 0) + 1;
            const drawSize = 7 - player.mulliganCount;

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
            room.turnIndex = Math.floor(Math.random() * room.players.length); // random first player
            const firstPlayer = room.players[room.turnIndex];
            addAction(room, currentUserId, 'startGame', { firstPlayer: firstPlayer?.username });
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

            const player = getPlayerInRoom(room, currentUserId);
            if (player) player.socketId = null;

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
