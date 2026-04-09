const {
    createRoom, getRoom, deleteRoom, getPlayerInRoom,
    createCardInstance, createPlayerState, addAction,
    shuffleArray, getRoomStateForPlayer, activeRooms,
} = require('./gameState');
const { v4: uuidv4 } = require('uuid');
const GameRoom = require('../models/GameRoom');

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
        let currentRoom = null;
        let currentUserId = null;

        // ─── ROOM MANAGEMENT ────────────────────────────────────────────
        socket.on('createRoom', ({ userId, username, settings }, callback) => {
            currentUserId = userId;
            const room = createRoom(userId, username, settings);
            currentRoom = room.roomCode;
            room.players[0].socketId = socket.id;
            socket.join(room.roomCode);
            startAutoSave(room.roomCode);
            callback({ success: true, roomCode: room.roomCode, state: getRoomStateForPlayer(room, userId) });
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

            for (const player of room.players) {
                for (const zone of Object.values(player.zones)) {
                    const card = zone.find(c => c.instanceId === instanceId);
                    if (card) {
                        if (typeof card.counters !== 'object') card.counters = {};
                        if (value === 0) {
                            delete card.counters[counter];
                        } else {
                            card.counters[counter] = value;
                        }
                        addAction(room, currentUserId, 'setCardCounter', { cardName: card.name, counter, value });
                        broadcastRoomState(io, room);
                        return callback?.({ success: true });
                    }
                }
            }
            callback?.({ error: 'Card not found' });
        });

        socket.on('setCommanderDamage', ({ fromPlayerId, toPlayerId, damage }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const target = getPlayerInRoom(room, toPlayerId);
            if (!target) return callback?.({ error: 'Target not found' });

            if (typeof target.commanderDamageFrom !== 'object') target.commanderDamageFrom = {};
            target.commanderDamageFrom[fromPlayerId] = damage;
            addAction(room, currentUserId, 'setCommanderDamage', { from: fromPlayerId, to: target.username, damage });
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

        socket.on('createCustomCard', ({ name, imageUrl, typeLine }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            const card = createCardInstance({
                name: name || 'Custom Card',
                typeLine: typeLine || '',
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

            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            room.currentPhase = 'untap';
            addAction(room, currentUserId, 'nextTurn', { turnPlayer: room.players[room.turnIndex].username });
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

        // ─── MULLIGAN ───────────────────────────────────────────────────
        socket.on('mulligan', ({ putBackCount }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            // Return hand to library
            player.zones.library.push(...player.zones.hand);
            player.zones.hand = [];

            // Shuffle
            shuffleArray(player.zones.library);

            // Draw 7
            const drawCount = Math.min(7, player.zones.library.length);
            for (let i = 0; i < drawCount; i++) {
                player.zones.hand.push(player.zones.library.shift());
            }

            addAction(room, currentUserId, 'mulligan', { handSize: drawCount, putBack: putBackCount || 0 });
            broadcastRoomState(io, room);
            callback?.({ success: true, handSize: drawCount });
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

            // Simple undo: just broadcast a notification, let players handle manually
            // Full state undo would require snapshots which is complex
            const lastAction = room.actionHistory[room.actionHistory.length - 1];
            if (lastAction) {
                room.actionHistory.pop();
                broadcastToRoom(io, room, 'undoRequested', {
                    requestedBy: currentUserId,
                    action: lastAction,
                });
            }
            callback?.({ success: true, lastAction });
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

            room.started = true;
            room.turnIndex = 0;
            room.currentPhase = 'main1';
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
