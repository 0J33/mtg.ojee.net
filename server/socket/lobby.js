// The home screen's list of open tables, and the rule that closes a table
// nobody has been at for an hour.
//
// Every signed-in player sees every table except private ones; a private
// table only shows to the people seated at it (and still opens by code or
// invite link). Home screens subscribe to the 'lobby' socket room and get a
// fresh list whenever any table changes.

const { activeRooms } = require('./gameState');

const LOBBY = 'lobby';
// ROOM_IDLE_CLOSE_MS exists for testing; production uses the hour.
const IDLE_CLOSE_MS = Number(process.env.ROOM_IDLE_CLOSE_MS) || 60 * 60 * 1000;
const LIST_DEBOUNCE_MS = 500;

const onlineCount = (room) =>
    room.players.filter((p) => p.socketId).length + (room.spectators || []).filter((s) => s.socketId).length;

// Scryfall image URL -> the art-only crop of the same card.
function artCrop(url) {
    if (!url || !/cards\.scryfall\.io\//.test(url)) return null;
    return url.replace(/\/(small|normal|large|png|border_crop)\//, '/art_crop/').replace(/\.png(\?|$)/, '.jpg$1');
}

function seatArt(player) {
    const card = (player.zones?.commandZone || [])[0];
    return card ? artCrop(card.imageUri) : null;
}

function summary(room, viewerId) {
    const host = room.players.find((p) => p.userId === room.hostId);
    const online = onlineCount(room);
    const current = room.started ? room.players[room.turnIndex] : null;
    return {
        code: room.roomCode,
        host: host?.username || room.players[0]?.username || 'someone',
        format: room.settings.format,
        maxPlayers: room.settings.maxPlayers,
        private: !!room.settings.private,
        started: !!room.started,
        draft: room.draftState ? room.draftState.mode : null,
        mulligan: !!room.mulliganPhase,
        turnOf: room.mulliganPhase ? null : current?.username || null,
        seats: room.players.map((p) => ({
            username: p.username,
            online: !!p.socketId,
            art: seatArt(p),
            out: !!p.conceded,
        })),
        spectators: (room.spectators || []).filter((s) => s.socketId).length,
        online,
        youAreIn: room.players.some((p) => p.userId === viewerId),
        createdAt: room.createdAt,
        idleSince: online ? null : room.lastOnlineAt || room.lastActivity || room.createdAt,
    };
}

// Your own tables first, then ones waiting for players, then games under way.
function listFor(viewerId) {
    const rank = (s) => (s.youAreIn ? 0 : !s.started && s.seats.length < s.maxPlayers ? 1 : 2);
    return [...activeRooms.values()]
        .map((room) => summary(room, viewerId))
        .filter((s) => !s.private || s.youAreIn)
        .sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
}

// Signed-out visitors get the shape of tonight's board and nothing that
// identifies anyone: format, seats and commander art, no names or codes.
function openCounts() {
    const open = [...activeRooms.values()].filter((r) => !r.settings.private);
    return {
        tables: open.length,
        players: open.reduce((n, r) => n + r.players.filter((p) => p.socketId).length, 0),
        slips: open.slice(0, 12).map((r) => ({
            format: r.settings.format,
            maxPlayers: r.settings.maxPlayers,
            state: !onlineCount(r) ? 'quiet' : r.draftState ? 'drafting' : r.started ? 'playing' : 'waiting',
            seats: r.players.map((p) => seatArt(p)),
        })),
    };
}

let pending = null;
function lobbyChanged(io) {
    if (pending) return;
    pending = setTimeout(async () => {
        pending = null;
        const sockets = await io.in(LOBBY).fetchSockets();
        for (const s of sockets) s.emit('lobby:rooms', listFor(s.data.lobbyUserId));
    }, LIST_DEBOUNCE_MS);
}

function subscribe(socket, userId) {
    socket.data.lobbyUserId = userId || null;
    socket.join(LOBBY);
    socket.emit('lobby:rooms', listFor(socket.data.lobbyUserId));
}

function unsubscribe(socket) {
    socket.leave(LOBBY);
}

// Presence clock: "nobody online" is measured from the last moment anyone was.
function markPresence(room) {
    if (onlineCount(room) > 0 || !room.lastOnlineAt) room.lastOnlineAt = Date.now();
}

function idleRooms(now = Date.now()) {
    return [...activeRooms.values()].filter((room) => {
        if (onlineCount(room) > 0) {
            room.lastOnlineAt = now;
            return false;
        }
        return now - (room.lastOnlineAt || room.lastActivity || room.createdAt) >= IDLE_CLOSE_MS;
    });
}

module.exports = { lobbyChanged, subscribe, unsubscribe, markPresence, idleRooms, openCounts, onlineCount, IDLE_CLOSE_MS };
