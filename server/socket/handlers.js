const {
    createRoom, getRoom, deleteRoom, getPlayerInRoom, getSpectatorInRoom,
    createCardInstance, createPlayerState, addAction,
    shuffleArray, getRoomStateForPlayer, activeRooms,
    pushUndo, popUndo, restoreSnapshot, appendChatMessage, INFINITE,
} = require('./gameState');

// Returns true if `p` is eliminated (dead). Mirrors the client's logic:
// zero/negative life, 21+ commander damage from any source, 10+ poison,
// or explicitly conceded.
function isPlayerEliminated(p) {
    if (!p) return false;
    if (p.conceded) return true;
    if (typeof p.life === 'number' && p.life <= 0) return true;
    if ((p.infect || 0) >= 10) return true;
    const dmg = p.commanderDamageFrom || {};
    for (const k of Object.keys(dmg)) {
        if ((dmg[k] || 0) >= 21) return true;
    }
    return false;
}

// End-of-turn cleanup. Wipes damage marked on creatures (for everyone, not
// just the ending player — that's how MTG works), reverts "until end of turn"
// control changes, and clears combat markers. Called from nextTurn.
function endOfTurnCleanup(room, endingPlayer, io) {
    if (!endingPlayer) return;
    // 1) Damage clears at end of turn for ALL creatures
    for (const p of room.players) {
        for (const card of (p.zones.battlefield || [])) {
            if (typeof card.damage === 'number' && card.damage > 0) card.damage = 0;
            if (card.attackingPlayerId) card.attackingPlayerId = null;
        }
    }
    // 2) Return any cards under temp control to their original owner. We
    //    iterate the snapshot first because we mutate the source array.
    for (const p of room.players) {
        const stays = [];
        const moves = [];
        for (const card of (p.zones.battlefield || [])) {
            if (card.controllerOriginal && card.controllerOriginal !== p.userId) {
                moves.push(card);
            } else {
                stays.push(card);
            }
        }
        p.zones.battlefield = stays;
        for (const card of moves) {
            const original = room.players.find(pp => pp.userId === card.controllerOriginal);
            if (original) {
                card.controllerOriginal = null;
                original.zones.battlefield.push(card);
            } else {
                // Original owner is gone — leave it where it is, drop the flag.
                card.controllerOriginal = null;
                p.zones.battlefield.push(card);
            }
        }
    }
    // 3) Hand-size enforcement nudge for ending player (default-on; an
    //    explicit `false` opts out via the player menu toggle).
    if (endingPlayer.handSizeEnforce !== false && endingPlayer.zones?.hand && room.settings?.handSizeLimit > 0) {
        const over = endingPlayer.zones.hand.length - room.settings.handSizeLimit;
        if (over > 0 && endingPlayer.socketId && io) {
            io.to(endingPlayer.socketId).emit('notification', {
                type: 'hand-size',
                message: `Discard ${over} card(s) — hand-size limit ${room.settings.handSizeLimit}`,
            });
        }
    }
}

// Decrement suspend counters at the start of an incoming player's turn.
// When a card on the battlefield (or exile, where suspended cards live) hits
// 0 suspend counters, we just leave it for the player to handle — the action
// log entry tells them it's ready.
function tickSuspendCounters(room, incomingPlayer) {
    if (!incomingPlayer) return [];
    const ready = [];
    for (const zoneName of ['exile', 'battlefield', 'hand']) {
        for (const card of (incomingPlayer.zones[zoneName] || [])) {
            if (typeof card.suspendCounters === 'number' && card.suspendCounters > 0) {
                card.suspendCounters--;
                if (card.suspendCounters === 0) {
                    ready.push({ name: card.name, instanceId: card.instanceId });
                }
            }
        }
    }
    return ready;
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
    'setBackground', 'tutorCard', 'tutorCardWithOptions', 'setBfRow', 'loadDeck', 'startGame',
    'addCardNote', 'removeCardNote', 'clearCardNotes', 'kickPlayer',
    'batchToLibrary', 'peekResolve',
    // Big-batch additions:
    'addMana', 'clearManaPool', 'tapForMana',
    'setCardField', 'cloneCard', 'foretellCard', 'castFromZone',
    'proliferate', 'queueExtraTurn', 'removeExtraTurn',
    'stackPush', 'stackPop', 'stackClear',
    'addEmblem', 'removeEmblem',
    'updateRoomSettings', 'concede',
    'mulliganBottom', 'takeControl',
    'setHandSizeEnforce', 'setSharedTeamLife',
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

// Check whether the game has a winner. Two cases:
//   1. Solo victory — exactly one non-eliminated player remains.
//   2. Team victory — every non-eliminated player belongs to the same team
//      AND that team has at least one player (and there's at least one
//      eliminated player on a different team, so the game is actually over).
// Tracked via room.winnerUserId so we don't spam the notification on every
// state broadcast after the game ends.
function checkVictory(io, room) {
    if (!room.started) return;
    if (room.winnerUserId) return; // already declared
    const alive = room.players.filter(p => !isPlayerEliminated(p));
    if (alive.length === 0) return;
    if (alive.length === 1 && room.players.length > 1) {
        const winner = alive[0];
        room.winnerUserId = winner.userId;
        addAction(room, winner.userId, 'victory', { player: winner.username });
        broadcastToRoom(io, room, 'victory', {
            userId: winner.userId,
            username: winner.username,
            ts: Date.now(),
        });
        return;
    }
    // Team victory: all alive players share a team AND at least one player
    // total has been eliminated.
    const aliveTeams = new Set(alive.map(p => p.teamId).filter(Boolean));
    const eliminatedCount = room.players.length - alive.length;
    if (aliveTeams.size === 1 && alive.every(p => p.teamId) && eliminatedCount > 0) {
        const teamId = [...aliveTeams][0];
        const teamMeta = (room.teams || []).find(t => t.teamId === teamId);
        const teamName = teamMeta?.name || teamId;
        const teamLabel = `Team ${teamName}`;
        room.winnerUserId = `team:${teamId}`;
        addAction(room, alive[0].userId, 'victory', { player: teamLabel });
        broadcastToRoom(io, room, 'victory', {
            userId: `team:${teamId}`,
            username: teamLabel,
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
    // Cursor sharing is purely visual / ephemeral, so spectators can take part
    // (they point at things while they chat). It's not in the mutation set.
    'cursorMove',
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

        // Live cursor sharing — rebroadcast a normalized (0..1) cursor
        // position to everyone else in the room. Not persisted, not snapshotted,
        // not saved to Mongo. The sender's client throttles emits; we just
        // fan-out. Each packet carries the drawer's aspectRatio so receivers
        // can letterbox it the same way drawings do, plus an optional color
        // when the sender is actively using the pen tool.
        socket.on('cursorMove', ({ x, y, aspectRatio, color }) => {
            const room = getRoom(currentRoom);
            if (!room) return;
            // Cheap sanity clamp — a malicious client can't spam us with NaN.
            if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return;
            const nx = Math.max(0, Math.min(1, x));
            const ny = Math.max(0, Math.min(1, y));
            let ar = typeof aspectRatio === 'number' && isFinite(aspectRatio) ? aspectRatio : undefined;
            if (ar !== undefined) ar = Math.max(0.1, Math.min(10, ar));
            // Only accept a short hex-ish color string; anything fancier is
            // dropped. Prevents a bad client from sending CSS injection.
            let col;
            if (typeof color === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(color)) {
                col = color.startsWith('#') ? color : '#' + color;
            }
            // Look up username from player or spectator record — cursors should
            // show whoever it was from, not just a socket id.
            const player = getPlayerInRoom(room, currentUserId);
            const spec = getSpectatorInRoom(room, currentUserId);
            const sender = player || spec;
            const username = sender?.username || 'Someone';
            broadcastToRoom(io, room, 'cursorMove', {
                userId: currentUserId,
                username,
                isSpectator: !player,
                x: nx,
                y: ny,
                aspectRatio: ar,
                color: col,
                ts: Date.now(),
            }, socket.id);
        });

        socket.on('sendChatMessage', ({ text, toUserId }, callback) => {
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

            // DM mode: toUserId set means whisper to a specific player. Stored
            // in room.chat with toUserId so getRoomStateForPlayer can filter.
            // Delivery: send only to sender + recipient (player or spec).
            if (toUserId) {
                const recipientPlayer = getPlayerInRoom(room, toUserId);
                const recipientSpec = getSpectatorInRoom(room, toUserId);
                if (!recipientPlayer && !recipientSpec) return callback?.({ error: 'Recipient not in room' });
                const msg = appendChatMessage(room, {
                    userId: currentUserId,
                    username: sender.username,
                    text: trimmed,
                    isSpectator: !player,
                });
                msg.toUserId = toUserId;
                msg.toUsername = (recipientPlayer || recipientSpec).username;
                // Re-stamp the stored message with the toUserId so reload is consistent
                const stored = room.chat[room.chat.length - 1];
                if (stored) { stored.toUserId = toUserId; stored.toUsername = msg.toUsername; }
                // Send to sender + recipient only
                if (sender.socketId) io.to(sender.socketId).emit('chatMessage', msg);
                if (recipientPlayer?.socketId && recipientPlayer.socketId !== sender.socketId) io.to(recipientPlayer.socketId).emit('chatMessage', msg);
                if (recipientSpec?.socketId && recipientSpec.socketId !== sender.socketId) io.to(recipientSpec.socketId).emit('chatMessage', msg);
                return callback?.({ success: true });
            }

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

            // Clear existing zones (including the new ones)
            player.zones = {
                hand: [], library: [], battlefield: [], graveyard: [],
                exile: [], commandZone: [],
                sideboard: [], companions: [], foretell: [], emblems: [],
            };
            player.commanderDeaths = 0;
            player.commanderTax = 0;
            player.commanderDamageFrom = {};
            player.life = room.settings.startingLife;
            player.counters = { poison: 0, energy: 0, experience: 0 };
            player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

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

            // Load sideboard / companions if the deck has them. The client
            // only renders these zones when non-empty (item 5 in the
            // missing-features list), so decks without them stay invisible.
            for (const card of (deckData.sideboard || [])) {
                for (let i = 0; i < (card.quantity || 1); i++) {
                    player.zones.sideboard.push(createCardInstance(card));
                }
            }
            for (const card of (deckData.companions || [])) {
                for (let i = 0; i < (card.quantity || 1); i++) {
                    player.zones.companions.push(createCardInstance(card));
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
            // Satisfies the "did you draw this turn?" nudge. Any draw counts,
            // including extra draws from effects — we don't distinguish the
            // turn-start draw specifically.
            if (num > 0) player.drewThisTurn = true;

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

            // Satisfy "did you play a land?" nudge when a land enters the
            // battlefield from the owner's hand. We only count it for the
            // card's owning player (the one who dragged it there), and only
            // from hand — not from other zones like graveyard.
            if (toZone === 'battlefield' && fromZone === 'hand' && sourcePlayer === targetPlayer) {
                const typeLine = (card.typeLine || '').toLowerCase();
                if (typeLine.includes('land')) {
                    targetPlayer.landsPlayedThisTurn = (targetPlayer.landsPlayedThisTurn || 0) + 1;
                }
            }

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
                            // Count lands being played this turn if this bulk
                            // move is hand → battlefield for the card's own
                            // player. Same rule as moveCard.
                            if (toZone === 'battlefield' && zoneName === 'hand' && dest === player) {
                                const typeLine = (card.typeLine || '').toLowerCase();
                                if (typeLine.includes('land')) {
                                    player.landsPlayedThisTurn = (player.landsPlayedThisTurn || 0) + 1;
                                }
                            }
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

        // Batch version of tutor-to-library-position: the caller identifies
        // a set of cards already in their library and asks the server to
        // re-place them all on top or at the bottom, in the order provided
        // (the client may have randomized beforehand). This is the engine
        // behind "select many cards, send to top/bottom, optionally randomized"
        // in LibrarySearch.
        socket.on('batchToLibrary', ({ instanceIds, position }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            if (!Array.isArray(instanceIds) || instanceIds.length === 0) {
                return callback?.({ error: 'No cards selected' });
            }
            const pos = position === 'bottom' ? 'bottom' : 'top';

            // Pull matching cards out of the library while preserving the
            // caller's requested order (first id in array → first out).
            const picked = [];
            const remaining = [];
            const pickSet = new Set(instanceIds);
            for (const c of player.zones.library) {
                if (pickSet.has(c.instanceId)) picked.push(c);
                else remaining.push(c);
            }
            // Re-order the picked array to match the client's instanceIds order
            // so random shuffles are honored.
            const byId = new Map(picked.map(c => [c.instanceId, c]));
            const ordered = instanceIds.map(id => byId.get(id)).filter(Boolean);

            if (ordered.length === 0) return callback?.({ error: 'Cards not in your library' });

            if (pos === 'top') {
                player.zones.library = [...ordered, ...remaining];
            } else {
                player.zones.library = [...remaining, ...ordered];
            }

            addAction(room, currentUserId, 'batchToLibrary', {
                count: ordered.length,
                position: pos,
            });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Gonti-style peek & exile: look at the top N cards of any player's
        // library, let the caller choose one to exile, then shuffle the
        // remaining peeked cards back to the bottom of that library (the
        // "random order" part of Gonti's text is handled client-side before
        // the callback emits back — simpler than threading dialogs through
        // two round trips).
        //
        // The chosen exile destination is the caller's exile zone, face-down.
        // This matches "exile under your control" in MTG rules — the card
        // stays face-down and the caller can move it to battlefield later.
        socket.on('peekLibraryTop', ({ targetPlayerId, count }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const target = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!target) return callback?.({ error: 'Target not found' });
            const n = Math.max(1, Math.min(count || 1, target.zones.library.length));
            const cards = target.zones.library.slice(0, n);
            // Don't mutate yet — the client will follow up with a peekResolve
            // call naming which card to exile. We return a snapshot of the
            // cards with their instanceIds so the client can display and pick.
            addAction(room, currentUserId, 'peekLibraryTop', {
                target: target.username,
                count: n,
            });
            callback?.({ success: true, cards });
        });

        socket.on('peekResolve', ({ targetPlayerId, peekCount, exileInstanceId, returnOrder }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const target = getPlayerInRoom(room, targetPlayerId || currentUserId);
            const caster = getPlayerInRoom(room, currentUserId);
            if (!target || !caster) return callback?.({ error: 'Player not found' });
            const n = Math.max(0, Math.min(peekCount || 0, target.zones.library.length));
            if (n === 0) return callback?.({ error: 'Nothing to resolve' });

            const peeked = target.zones.library.splice(0, n);
            const exileIdx = peeked.findIndex(c => c.instanceId === exileInstanceId);
            if (exileIdx === -1) {
                // Roll back the splice if the client named a card we don't have
                target.zones.library.unshift(...peeked);
                return callback?.({ error: 'Exile target not among peeked cards' });
            }
            const [exiled] = peeked.splice(exileIdx, 1);

            // Remaining cards go to the BOTTOM of the target's library in the
            // provided order (random if the client randomized). Defaults to
            // the peek order if returnOrder isn't supplied.
            let bottomOrder = peeked;
            if (Array.isArray(returnOrder) && returnOrder.length === peeked.length) {
                const byId = new Map(peeked.map(c => [c.instanceId, c]));
                const ordered = returnOrder.map(id => byId.get(id)).filter(Boolean);
                if (ordered.length === peeked.length) bottomOrder = ordered;
            }
            target.zones.library.push(...bottomOrder);

            // Exiled card goes to the CASTER's exile zone, face-down. It
            // keeps its original instanceId and all its identity so the
            // caster can read the name / cast it later.
            exiled.faceDown = true;
            exiled.tapped = false;
            exiled.x = 0;
            exiled.y = 0;
            caster.zones.exile.push(exiled);

            addAction(room, currentUserId, 'peekResolve', {
                target: target.username,
                caster: caster.username,
                exiledCardName: exiled.name,
            });
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

        // Helper for shared team life: when sharedTeamLife is on and the
        // target is in a team, propagate the life change to every teammate
        // so the team is always at one number.
        const propagateSharedTeamLife = (room, target) => {
            if (!room.sharedTeamLife || !target?.teamId) return;
            for (const p of room.players) {
                if (p.teamId === target.teamId && p.userId !== target.userId) {
                    p.life = target.life;
                }
            }
        };

        // ─── COUNTERS & LIFE ────────────────────────────────────────────
        socket.on('setLife', ({ targetPlayerId, life }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!player) return callback?.({ error: 'Player not found' });

            const oldLife = player.life;
            player.life = clampGameValue(life);
            propagateSharedTeamLife(room, player);
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
            propagateSharedTeamLife(room, player);
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
            if (room.mulliganPhase) return callback?.({ error: 'Still in mulligan phase — everyone must click Ready' });

            const endingPlayer = room.players[room.turnIndex];
            // Only the current-turn player can end their own turn. The host is
            // also allowed to advance for AFK/disconnected players, otherwise
            // a stuck game can't progress.
            if (endingPlayer && endingPlayer.userId !== currentUserId && room.hostId !== currentUserId) {
                return callback?.({ error: "Only the current turn player (or host) can end the turn" });
            }

            // Run end-of-turn cleanup before we advance: damage clears,
            // temporary control changes revert, attacking markers wipe.
            endOfTurnCleanup(room, endingPlayer, io);

            // Log the turn ending explicitly — lets the action log show a
            // clean "X ended their turn" → "Y's turn begins" sequence.
            if (endingPlayer) {
                addAction(room, currentUserId, 'turnEnd', { player: endingPlayer.username });
            }

            // Extra-turn queue check. If the head of the queue belongs to a
            // non-eliminated player, that player gets the next turn instead
            // of advancing turnIndex. Eliminated extra-turn entries are
            // dropped silently.
            let nextPlayerIdx = -1;
            while (Array.isArray(room.extraTurns) && room.extraTurns.length > 0) {
                const head = room.extraTurns.shift();
                const idx = room.players.findIndex(p => p.userId === head.ownerId);
                if (idx !== -1 && !isPlayerEliminated(room.players[idx])) {
                    nextPlayerIdx = idx;
                    addAction(room, currentUserId, 'extraTurnPop', { player: room.players[idx].username });
                    break;
                }
            }

            if (nextPlayerIdx === -1) {
                // Advance through eliminated players automatically. Safety cap
                // equal to player count so we can't infinite-loop if everyone is
                // somehow dead.
                const total = room.players.length;
                let advanced = 0;
                do {
                    room.turnIndex = (room.turnIndex + 1) % total;
                    advanced++;
                } while (isPlayerEliminated(room.players[room.turnIndex]) && advanced < total);
            } else {
                room.turnIndex = nextPlayerIdx;
            }

            room.currentPhase = 'untap';
            const newPlayer = room.players[room.turnIndex];

            // Reset per-turn nudges for the incoming player. These drive the
            // "you haven't drawn / played a land yet" glow on the client.
            if (newPlayer) {
                newPlayer.drewThisTurn = false;
                newPlayer.landsPlayedThisTurn = 0;
            }

            // Tick suspend counters on incoming player's cards. Any that hit
            // zero get an action-log entry; we don't auto-cast them (player
            // does it manually with the cast-from-exile flow).
            const ready = tickSuspendCounters(room, newPlayer);
            for (const r of ready) {
                addAction(room, newPlayer.userId, 'suspendReady', { cardName: r.name });
            }

            // Auto-untap respects the new player's per-player toggle. Default
            // is on; player can switch it off for upkeep effects like Thousand-
            // Year Elixir or similar "doesn't untap" plays.
            if (newPlayer && newPlayer.zones?.battlefield && newPlayer.autoUntap !== false) {
                let untapped = 0;
                for (const card of newPlayer.zones.battlefield) {
                    if (card.tapped) { card.tapped = false; untapped++; }
                }
                // Only log if anything was actually untapped — "auto-untapped 0
                // cards" is noise in the action log.
                if (untapped > 0) {
                    addAction(room, newPlayer.userId, 'autoUntap', { player: newPlayer.username, count: untapped });
                }
            }

            // Empty the incoming player's mana pool (mana drains between
            // turns by MTG rules — and floating mana between two of YOUR
            // turns mostly never matters).
            if (newPlayer) {
                newPlayer.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
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

        // Mulligan phase: user-initiated d20 roll. Clicking "Ready & Roll"
        // emits this event — the server rolls a d20 for the requesting
        // player, stores the result on their player state, and checks for
        // phase resolution. Once every player has rolled, the highest roll
        // wins and becomes turn 1. Ties clear only the tied players' rolls
        // so they re-roll until a single winner emerges.
        socket.on('rollForFirstPlayer', (payload, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            if (!room.mulliganPhase) return callback?.({ error: 'Not in mulligan phase' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            // Re-rolls during tiebreaks clear firstPlayerRoll back to null,
            // so a player who already has a roll is locked out until the
            // tiebreak resets them.
            if (player.firstPlayerRoll !== null && player.firstPlayerRoll !== undefined) {
                return callback?.({ error: 'You already rolled for this tiebreak round' });
            }
            const roll = 1 + Math.floor(Math.random() * 20);
            player.firstPlayerRoll = roll;
            player.mulliganReady = true;
            addAction(room, currentUserId, 'rollForFirstPlayer', { player: player.username, roll });

            // Broadcast the individual roll as a dice toast for animation.
            broadcastToRoom(io, room, 'rollResult', {
                id: uuidv4(),
                type: 'dice',
                sides: 20,
                count: 1,
                results: [roll],
                total: roll,
                playerId: currentUserId,
                playerName: player.username,
                timestamp: Date.now(),
                label: 'First player roll',
            });

            // Has everyone rolled?
            if (room.players.length > 0 && room.players.every(p => typeof p.firstPlayerRoll === 'number')) {
                // Find the highest roll + anyone tied for it.
                let max = -Infinity;
                for (const p of room.players) if (p.firstPlayerRoll > max) max = p.firstPlayerRoll;
                const tied = room.players.filter(p => p.firstPlayerRoll === max);

                if (tied.length === 1) {
                    // We have a winner.
                    const winner = tied[0];
                    const winnerIdx = room.players.findIndex(p => p.userId === winner.userId);
                    room.mulliganPhase = false;
                    room.turnIndex = winnerIdx;
                    addAction(room, currentUserId, 'firstPlayerRoll', {
                        rolls: room.players.map(p => `${p.username}:${p.firstPlayerRoll}`).join(', '),
                        winner: winner.username,
                        winningRoll: winner.firstPlayerRoll,
                    });
                    addAction(room, currentUserId, 'turnStart', { player: winner.username });
                    broadcastToRoom(io, room, 'notification', {
                        type: 'first-player',
                        message: `${winner.username} rolled ${max} and goes first`,
                        playerId: winner.userId,
                    });
                    // Clear the roll fields so they don't leak into the
                    // next game (winners + losers). Keep mulliganReady so
                    // the UI knows the phase is done.
                    for (const p of room.players) p.firstPlayerRoll = null;
                } else {
                    // Multiple players tied at the top. Clear ONLY their rolls
                    // so they re-roll — anyone not tied keeps their number
                    // (doesn't matter, they're locked out of winning anyway).
                    const tiedIds = new Set(tied.map(p => p.userId));
                    for (const p of room.players) {
                        if (tiedIds.has(p.userId)) p.firstPlayerRoll = null;
                    }
                    addAction(room, currentUserId, 'firstPlayerTiebreak', {
                        tied: tied.map(p => p.username).join(', '),
                        roll: max,
                    });
                    broadcastToRoom(io, room, 'notification', {
                        type: 'first-player-tie',
                        message: `Tie at ${max}! ${tied.map(p => p.username).join(', ')} re-roll`,
                    });
                }
            }

            broadcastRoomState(io, room);
            callback?.({ success: true, roll });
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

            const rules = room.settings?.mulliganRules || 'vancouver';

            // Vancouver: initial draw = 7 (mulliganCount 0).
            //   mulligan 1 → draws 7 ("free" first mulligan)
            //   mulligan 2 → draws 6
            //   mulligan 3 → draws 5
            //   mulligan 4+ → blocked
            // London:    always draws 7, but afterwards must put mulliganCount
            //            cards on the bottom of their library.
            // Free7:     first mull is free (7), then 6, 5, 4. Stops at 4.
            const cap = rules === 'free7' ? 4 : 3;
            if ((player.mulliganCount || 0) >= cap) {
                return callback?.({ error: `No more mulligans (cap reached)` });
            }
            player.mulliganCount = (player.mulliganCount || 0) + 1;
            // A player who mulligans is implicitly un-readied — otherwise
            // someone who clicked Ready then changed their mind wouldn't be
            // able to pull themselves out of the resolve check.
            player.mulliganReady = false;

            let drawSize;
            if (rules === 'london') {
                // Always draw 7; bottoming happens later.
                drawSize = 7;
                player.mulliganBottomPending = player.mulliganCount;
            } else if (rules === 'free7') {
                // 7 → 7 → 6 → 5 → 4
                drawSize = player.mulliganCount === 1 ? 7 : 8 - player.mulliganCount;
                player.mulliganBottomPending = 0;
            } else {
                // Vancouver (default)
                drawSize = 8 - player.mulliganCount;
                player.mulliganBottomPending = 0;
            }

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
                message: `${player.username} mulled to ${drawCount}${player.mulliganBottomPending > 0 ? ` (bottom ${player.mulliganBottomPending})` : ''}`,
            });
            broadcastRoomState(io, room);
            callback?.({ success: true, handSize: drawCount, mulliganCount: player.mulliganCount, mulliganBottomPending: player.mulliganBottomPending });
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
        socket.on('drawStroke', ({ strokeId, points, color, size, aspectRatio }) => {
            const room = getRoom(currentRoom);
            if (!room) return;

            // Clamp aspectRatio to a sane range so a bad client can't store
            // garbage that breaks rendering elsewhere. 0.1..10 covers every
            // practical portrait/landscape device shape.
            let ar = typeof aspectRatio === 'number' && isFinite(aspectRatio) ? aspectRatio : undefined;
            if (ar !== undefined) ar = Math.max(0.1, Math.min(10, ar));

            const stroke = { strokeId: strokeId || uuidv4(), playerId: currentUserId, points, color, size, aspectRatio: ar };
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
                let drawnCount = 0;
                if (player.zones.library && player.zones.library.length > 0) {
                    shuffleArray(player.zones.library);
                    drawnCount = Math.min(7, player.zones.library.length);
                    for (let i = 0; i < drawnCount; i++) {
                        player.zones.hand.push(player.zones.library.shift());
                    }
                }
                player.life = room.settings.startingLife;
                player.mulliganCount = 0;
                // Fresh turn-state for every player; the turn-1 player's state
                // gets overridden below once we know who goes first.
                player.drewThisTurn = false;
                player.landsPlayedThisTurn = 0;
                // Log the opening draw per player so the action log shows
                // "<player> drew 7" for each seat instead of silently filling
                // hands.
                if (drawnCount > 0) {
                    addAction(room, player.userId, 'initialDraw', { player: player.username, count: drawnCount });
                }
            }

            room.started = true;
            room.winnerUserId = null; // clear any previous victor for rematches
            // Enter the mulligan phase: everyone has their 7, can mulligan
            // freely, and clicks Ready when done. First player isn't decided
            // until every player is ready, at which point the server rolls a
            // d20 for each and the highest roll takes turn 1.
            room.mulliganPhase = true;
            room.turnIndex = -1; // no active turn during mulligan phase
            for (const p of room.players) {
                p.mulliganReady = false;
                p.firstPlayerRoll = null;
                p.drewThisTurn = false;
                p.landsPlayedThisTurn = 0;
            }
            addAction(room, currentUserId, 'startGame', { players: room.players.length });
            addAction(room, currentUserId, 'mulliganPhaseStart', { players: room.players.length });
            // Single notification — the old "Game started — X goes first"
            // banner referenced a `firstPlayer` variable that no longer
            // exists, because the first player is decided later when the
            // mulligan phase resolves via d20.
            broadcastToRoom(io, room, 'notification', {
                type: 'mulligan-phase',
                message: 'Mulligan phase — everyone click Ready when done',
            });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // ─── BIG BATCH: NEW HANDLERS (mana pool, stack, settings, etc.) ───
        // Each one is intentionally additive: existing flows work unchanged,
        // and feature-specific UI strips on the client only render when their
        // backing data is non-empty.

        // Mana pool ────────────────────────────────────────────────────
        socket.on('addMana', ({ targetPlayerId, color, amount }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!player) return callback?.({ error: 'Player not found' });
            if (!player.manaPool) player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
            if (!['W', 'U', 'B', 'R', 'G', 'C'].includes(color)) return callback?.({ error: 'Invalid color' });
            const delta = parseInt(amount ?? 1, 10);
            if (isNaN(delta)) return callback?.({ error: 'Invalid amount' });
            player.manaPool[color] = Math.max(0, (player.manaPool[color] || 0) + delta);
            addAction(room, currentUserId, 'addMana', { player: player.username, color, amount: delta });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('clearManaPool', ({ targetPlayerId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!player) return callback?.({ error: 'Player not found' });
            player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
            addAction(room, currentUserId, 'clearManaPool', { player: player.username });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Tap a land for mana. The server uses mana.js's getProducedMana to
        // detect basic-land production automatically; non-basic lands return
        // null and the client must call again with an explicit `colors` array
        // (the picker UI). The card is tapped as a side-effect.
        socket.on('tapForMana', ({ instanceId, colors }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            const card = (player.zones.battlefield || []).find(c => c.instanceId === instanceId);
            if (!card) return callback?.({ error: 'Card not on your battlefield' });
            if (card.tapped) return callback?.({ error: 'Already tapped' });

            const { getProducedMana } = require('./mana');
            const explicit = Array.isArray(colors) && colors.length > 0
                ? colors.filter(c => ['W', 'U', 'B', 'R', 'G', 'C'].includes(c))
                : null;
            const produced = explicit || getProducedMana(card);
            if (!produced || produced.length === 0) {
                return callback?.({ error: 'Unknown mana production', requiresPicker: true });
            }
            if (!player.manaPool) player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
            for (const c of produced) {
                player.manaPool[c] = (player.manaPool[c] || 0) + 1;
            }
            card.tapped = true;
            card.tappedFor = produced.join('');
            addAction(room, currentUserId, 'tapForMana', { cardName: card.name, mana: produced.join('') });
            broadcastRoomState(io, room);
            callback?.({ success: true, produced });
        });

        // Generic per-card field setter (damage, phasedOut, suspendCounters,
        // goaded, attackingPlayerId, controllerOriginal). Whitelisted to keep
        // a malicious client from setting arbitrary fields on cards.
        const ALLOWED_CARD_FIELDS = new Set([
            'damage', 'phasedOut', 'suspendCounters', 'goaded',
            'attackingPlayerId', 'controllerOriginal', 'attachedTo',
        ]);
        socket.on('setCardField', ({ instanceId, field, value }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            if (!ALLOWED_CARD_FIELDS.has(field)) return callback?.({ error: 'Invalid field' });
            const card = findCardAnywhere(room, instanceId);
            if (!card) return callback?.({ error: 'Card not found' });

            if (field === 'damage' || field === 'suspendCounters') {
                card[field] = clampGameValue(value, { allowNegative: false });
            } else if (field === 'phasedOut' || field === 'goaded') {
                card[field] = !!value;
            } else if (field === 'attackingPlayerId' || field === 'controllerOriginal' || field === 'attachedTo') {
                card[field] = value || null;
            }
            addAction(room, currentUserId, 'setCardField', { cardName: card.name, field, value: card[field] });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Clone a battlefield card. Creates a token-marked duplicate so it
        // doesn't accidentally come back to a deck or graveyard on cleanup.
        socket.on('cloneCard', ({ instanceId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });

            let original = null;
            for (const p of room.players) {
                const found = (p.zones.battlefield || []).find(c => c.instanceId === instanceId);
                if (found) { original = found; break; }
            }
            if (!original) return callback?.({ error: 'Card not on any battlefield' });

            const clone = createCardInstance(original, {
                isToken: true,
                x: (original.x || 0) + 20,
                y: (original.y || 0) + 20,
                tapped: false,
                damage: 0,
                phasedOut: false,
                counters: {},
                notes: [],
            });
            player.zones.battlefield.push(clone);
            addAction(room, currentUserId, 'cloneCard', { cardName: original.name });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Foretell — move from hand to caster's foretell pile, face-down.
        socket.on('foretellCard', ({ instanceId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            const idx = (player.zones.hand || []).findIndex(c => c.instanceId === instanceId);
            if (idx === -1) return callback?.({ error: 'Card not in hand' });
            const [card] = player.zones.hand.splice(idx, 1);
            card.faceDown = true;
            card.returnZone = 'hand';
            if (!player.zones.foretell) player.zones.foretell = [];
            player.zones.foretell.push(card);
            addAction(room, currentUserId, 'foretell', { cardName: card.name, player: player.username });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Cast from foretell — move from foretell pile to battlefield (face-up).
        socket.on('castForetold', ({ instanceId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            if (!player.zones.foretell) return callback?.({ error: 'No foretell pile' });
            const idx = player.zones.foretell.findIndex(c => c.instanceId === instanceId);
            if (idx === -1) return callback?.({ error: 'Card not in foretell pile' });
            const [card] = player.zones.foretell.splice(idx, 1);
            card.faceDown = false;
            card.returnZone = null;
            player.zones.battlefield.push(card);
            addAction(room, currentUserId, 'castForetold', { cardName: card.name });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Cast from a zone (graveyard / exile) — moves to battlefield, then
        // optionally exiles afterwards. Used for flashback / escape /
        // jump-start / Dread Return / unearth — anything that says "exile X
        // after it would leave the battlefield". The exile-after flag is the
        // important part; client passes it for those mechanics.
        socket.on('castFromZone', ({ instanceId, fromZone, exileAfter }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            if (!['graveyard', 'exile', 'hand'].includes(fromZone)) return callback?.({ error: 'Invalid source zone' });
            const idx = (player.zones[fromZone] || []).findIndex(c => c.instanceId === instanceId);
            if (idx === -1) return callback?.({ error: 'Card not in source zone' });
            const [card] = player.zones[fromZone].splice(idx, 1);
            // Track where it should go after leaving the battlefield, so the
            // client can show a hint in the action log if the player forgets.
            card.returnZone = exileAfter ? 'exile' : null;
            card.faceDown = false;
            player.zones.battlefield.push(card);
            addAction(room, currentUserId, 'castFromZone', {
                cardName: card.name,
                fromZone,
                exileAfter: !!exileAfter,
            });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Proliferate — for every counter on every permanent and player, add 1.
        socket.on('proliferate', (callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            let n = 0;
            for (const p of room.players) {
                for (const k of Object.keys(p.counters || {})) {
                    if ((p.counters[k] || 0) > 0) { p.counters[k]++; n++; }
                }
                if ((p.infect || 0) > 0) { p.infect++; n++; }
                for (const card of (p.zones.battlefield || [])) {
                    if (!card.counters || typeof card.counters !== 'object') continue;
                    for (const k of Object.keys(card.counters)) {
                        if ((card.counters[k] || 0) > 0) { card.counters[k]++; n++; }
                    }
                }
            }
            addAction(room, currentUserId, 'proliferate', { count: n });
            broadcastRoomState(io, room);
            callback?.({ success: true, count: n });
        });

        // Extra-turn queue ─────────────────────────────────────────────
        socket.on('queueExtraTurn', ({ targetPlayerId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const target = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!target) return callback?.({ error: 'Player not found' });
            if (!Array.isArray(room.extraTurns)) room.extraTurns = [];
            room.extraTurns.push({ ownerId: target.userId, ownerName: target.username, source: currentUserId });
            addAction(room, currentUserId, 'queueExtraTurn', { player: target.username });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('removeExtraTurn', ({ index }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            if (!Array.isArray(room.extraTurns) || room.extraTurns.length === 0) {
                return callback?.({ error: 'No extra turns queued' });
            }
            const i = typeof index === 'number' ? index : 0;
            if (i < 0 || i >= room.extraTurns.length) return callback?.({ error: 'Invalid index' });
            room.extraTurns.splice(i, 1);
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // The Stack ────────────────────────────────────────────────────
        socket.on('stackPush', ({ name, imageUri, oracleText, manaCost, instanceId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            if (!Array.isArray(room.stack)) room.stack = [];
            room.stack.push({
                id: uuidv4(),
                casterId: currentUserId,
                casterName: player.username,
                name: name || 'Spell',
                imageUri: imageUri || '',
                oracleText: oracleText || '',
                manaCost: manaCost || '',
                instanceId: instanceId || null,
                ts: Date.now(),
            });
            addAction(room, currentUserId, 'stackPush', { cardName: name });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('stackPop', ({ index }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            if (!Array.isArray(room.stack) || room.stack.length === 0) return callback?.({ error: 'Stack empty' });
            const i = typeof index === 'number' ? index : room.stack.length - 1;
            if (i < 0 || i >= room.stack.length) return callback?.({ error: 'Invalid index' });
            const [resolved] = room.stack.splice(i, 1);
            addAction(room, currentUserId, 'stackPop', { cardName: resolved?.name });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('stackClear', (callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            room.stack = [];
            addAction(room, currentUserId, 'stackClear', {});
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Emblems ──────────────────────────────────────────────────────
        socket.on('addEmblem', ({ targetPlayerId, name, oracleText }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!player) return callback?.({ error: 'Player not found' });
            if (!player.zones.emblems) player.zones.emblems = [];
            player.zones.emblems.push({
                id: uuidv4(),
                name: (name || 'Emblem').slice(0, 80),
                oracleText: (oracleText || '').slice(0, 500),
                ts: Date.now(),
            });
            addAction(room, currentUserId, 'addEmblem', { player: player.username, name });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('removeEmblem', ({ targetPlayerId, emblemId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, targetPlayerId || currentUserId);
            if (!player || !Array.isArray(player.zones.emblems)) return callback?.({ error: 'Not found' });
            player.zones.emblems = player.zones.emblems.filter(e => e.id !== emblemId);
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Settings ─────────────────────────────────────────────────────
        socket.on('updateRoomSettings', ({ settings: newSettings }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            if (room.hostId !== currentUserId) return callback?.({ error: 'Only host can update settings' });
            if (!newSettings || typeof newSettings !== 'object') return callback?.({ error: 'No settings' });
            const numericKeys = ['startingLife', 'commanderDamageLethal', 'maxPlayers', 'handSizeLimit'];
            const stringKeys = ['format', 'mulliganRules'];
            const boolKeys = ['useCommanderDamage'];
            for (const k of numericKeys) {
                if (newSettings[k] !== undefined) {
                    const v = clampGameValue(newSettings[k], { allowNegative: false });
                    if (v > 0) room.settings[k] = v;
                }
            }
            for (const k of stringKeys) {
                if (typeof newSettings[k] === 'string') {
                    room.settings[k] = newSettings[k].slice(0, 30);
                }
            }
            for (const k of boolKeys) {
                if (newSettings[k] !== undefined) room.settings[k] = !!newSettings[k];
            }
            // If startingLife changed AND game hasn't started yet, also update
            // every player's life. Mid-game changes deliberately don't touch
            // existing life totals.
            if (newSettings.startingLife !== undefined && !room.started) {
                for (const p of room.players) p.life = room.settings.startingLife;
            }
            addAction(room, currentUserId, 'updateRoomSettings', {});
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('setHandSizeEnforce', ({ value }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            player.handSizeEnforce = !!value;
            addAction(room, currentUserId, 'setHandSizeEnforce', { value: !!value });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('setSharedTeamLife', ({ value }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            if (room.hostId !== currentUserId) return callback?.({ error: 'Only host can change this' });
            room.sharedTeamLife = !!value;
            addAction(room, currentUserId, 'setSharedTeamLife', { value: !!value });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        socket.on('setAvatarColor', ({ color }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
                return callback?.({ error: 'Invalid color' });
            }
            player.avatarColor = color;
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Concede ──────────────────────────────────────────────────────
        socket.on('concede', (callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            player.conceded = true;
            // Drop life to 0 visually so the existing death-banner / dead
            // styling kicks in without us needing a separate path.
            player.life = 0;
            addAction(room, currentUserId, 'concede', { player: player.username });
            broadcastToRoom(io, room, 'notification', {
                type: 'concede',
                message: `${player.username} conceded`,
            });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Browse opponent's full library — Bribery / Acquire / wish-style.
        // Returns the entire library so the caller can pick a card. Mutating
        // moves still go through the regular tutorCard flow with a special
        // sourcePlayerId path (handled in moveCard via targetPlayerId).
        socket.on('browseLibraryFull', ({ targetPlayerId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const target = getPlayerInRoom(room, targetPlayerId);
            if (!target) return callback?.({ error: 'Player not found' });
            addAction(room, currentUserId, 'browseLibraryFull', { target: target.username });
            callback?.({ success: true, library: target.zones.library });
        });

        // Reveal a SPECIFIC subset of own hand to a target list (vs.
        // revealHand which reveals the whole hand).
        socket.on('revealSpecificFromHand', ({ instanceIds, targetPlayerIds }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            const ids = new Set(instanceIds || []);
            const cards = (player.zones.hand || []).filter(c => ids.has(c.instanceId));
            if (cards.length === 0) return callback?.({ error: 'No cards' });

            const targets = (targetPlayerIds === 'all'
                ? room.players.filter(p => p.userId !== currentUserId)
                : room.players.filter(p => (targetPlayerIds || []).includes(p.userId) && p.userId !== currentUserId));

            for (const p of targets) {
                if (p.socketId) {
                    io.to(p.socketId).emit('handRevealed', {
                        revealedBy: currentUserId,
                        revealedByName: player.username,
                        cards,
                        partial: true,
                    });
                }
            }
            addAction(room, currentUserId, 'revealHand', {
                player: player.username,
                handCount: cards.length,
                to: targetPlayerIds === 'all' ? 'all' : `${targets.length} player(s)`,
                partial: true,
            });
            callback?.({ success: true });
        });

        // London-style mulligan bottoming. The player picks N cards from hand,
        // they go on the bottom of the library in the chosen order.
        socket.on('mulliganBottom', ({ instanceIds }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            const need = player.mulliganBottomPending || 0;
            if (need <= 0) return callback?.({ error: 'No bottoming pending' });
            if (!Array.isArray(instanceIds) || instanceIds.length !== need) {
                return callback?.({ error: `Pick exactly ${need} card(s)` });
            }
            for (const id of instanceIds) {
                const idx = player.zones.hand.findIndex(c => c.instanceId === id);
                if (idx !== -1) {
                    const [card] = player.zones.hand.splice(idx, 1);
                    player.zones.library.push(card);
                }
            }
            player.mulliganBottomPending = 0;
            addAction(room, currentUserId, 'mulliganBottom', { player: player.username, count: instanceIds.length });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Spectator perspective — only valid if isSpectator === true. Sets
        // the spectator's perspectiveOf so subsequent state broadcasts hide
        // hands except the chosen player's.
        socket.on('setSpectatorPerspective', ({ targetPlayerId }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            if (!isSpectator) return callback?.({ error: 'Players can\'t use perspective mode' });
            const spec = getSpectatorInRoom(room, currentUserId);
            if (!spec) return callback?.({ error: 'Not in room' });
            if (targetPlayerId && !getPlayerInRoom(room, targetPlayerId)) {
                return callback?.({ error: 'Target player not found' });
            }
            spec.perspectiveOf = targetPlayerId || null;
            // Re-send state to ONLY this spectator with the new perspective.
            socket.emit('gameState', getRoomStateForPlayer(room, currentUserId, {
                isSpectator: true,
                spectatorPerspectiveOf: spec.perspectiveOf,
            }));
            callback?.({ success: true });
        });

        // Take control of an opposing card. controllerOriginal stores the
        // original owner so end-of-turn cleanup can revert it (when the
        // untilEndOfTurn flag is set).
        socket.on('takeControl', ({ instanceId, untilEndOfTurn }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const caster = getPlayerInRoom(room, currentUserId);
            if (!caster) return callback?.({ error: 'Not in room' });

            let card = null, owner = null, ownerIdx = -1;
            for (const p of room.players) {
                const i = (p.zones.battlefield || []).findIndex(c => c.instanceId === instanceId);
                if (i !== -1) { card = p.zones.battlefield[i]; owner = p; ownerIdx = i; break; }
            }
            if (!card || !owner) return callback?.({ error: 'Card not on any battlefield' });
            if (owner.userId === caster.userId) return callback?.({ error: 'You already control it' });

            owner.zones.battlefield.splice(ownerIdx, 1);
            card.controllerOriginal = untilEndOfTurn ? owner.userId : null;
            caster.zones.battlefield.push(card);
            addAction(room, currentUserId, 'takeControl', {
                cardName: card.name, from: owner.username, untilEndOfTurn: !!untilEndOfTurn,
            });
            broadcastRoomState(io, room);
            callback?.({ success: true });
        });

        // Tutor with destination-side options. Same as tutorCard but supports
        // tapped/counters/faceDown when the destination is battlefield.
        socket.on('tutorCardWithOptions', ({ instanceId, toZone, shuffle, libraryPosition, tapped, counters, faceDown }, callback) => {
            const room = getRoom(currentRoom);
            if (!room) return callback?.({ error: 'Not in a room' });
            const player = getPlayerInRoom(room, currentUserId);
            if (!player) return callback?.({ error: 'Not in room' });
            const idx = player.zones.library.findIndex(c => c.instanceId === instanceId);
            if (idx === -1) return callback?.({ error: 'Card not in your library' });
            const [card] = player.zones.library.splice(idx, 1);
            const dest = toZone || 'hand';
            if (dest !== 'battlefield') {
                card.tapped = false; card.x = 0; card.y = 0;
            } else {
                if (typeof tapped === 'boolean') card.tapped = tapped;
                if (counters && typeof counters === 'object') {
                    card.counters = { ...(card.counters || {}), ...counters };
                }
                if (typeof faceDown === 'boolean') card.faceDown = faceDown;
            }
            if (dest === 'library') {
                const pos = typeof libraryPosition === 'number'
                    ? Math.max(0, Math.min(libraryPosition, player.zones.library.length))
                    : 0;
                player.zones.library.splice(pos, 0, card);
            } else {
                player.zones[dest].push(card);
            }
            if (shuffle) shuffleArray(player.zones.library);
            addAction(room, currentUserId, 'tutor', {
                cardName: card.name, toZone: dest, shuffled: !!shuffle,
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
