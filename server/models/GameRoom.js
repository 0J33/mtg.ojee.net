const mongoose = require('mongoose');

const cardInstanceSchema = new mongoose.Schema({
    instanceId: { type: String, required: true },
    scryfallId: { type: String },
    name: { type: String, required: true },
    imageUri: { type: String },
    backImageUri: { type: String },
    manaCost: { type: String },
    typeLine: { type: String },
    oracleText: { type: String },
    power: { type: String },
    toughness: { type: String },
    colors: [String],
    producedMana: [String],
    layout: { type: String },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    tapped: { type: Boolean, default: false },
    tappedFor: { type: String, default: null },
    bfRow: { type: String, default: null },
    notes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    flipped: { type: Boolean, default: false },
    faceDown: { type: Boolean, default: false },
    counters: { type: Map, of: Number, default: {} },
    attachedTo: { type: String, default: null },
    zIndex: { type: Number, default: 0 },
    isToken: { type: Boolean, default: false },
    isCustom: { type: Boolean, default: false },
    customImageUrl: { type: String },
    customCardAuthorUsername: { type: String, default: null },
    customCardOriginId: { type: String, default: null },
    customCardOwnerId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Combat / state extras (added in big batch). All optional.
    damage: { type: Number, default: 0 },
    phasedOut: { type: Boolean, default: false },
    suspendCounters: { type: Number, default: 0 },
    goaded: { type: Boolean, default: false },
    attackingPlayerId: { type: String, default: null },
    controllerOriginal: { type: String, default: null },
    returnZone: { type: String, default: null },
    rotated180: { type: Boolean, default: false },
    skinUrl: { type: String, default: null },
}, { _id: false });

const playerStateSchema = new mongoose.Schema({
    odjeebCookieId: { type: String },
    odjeebUserId: { type: String },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    socketId: { type: String },
    life: { type: Number, default: 40 },
    counters: { type: Map, of: Number, default: {} },
    manaPool: {
        W: { type: Number, default: 0 },
        U: { type: Number, default: 0 },
        B: { type: Number, default: 0 },
        R: { type: Number, default: 0 },
        G: { type: Number, default: 0 },
        C: { type: Number, default: 0 },
    },
    commanderDeaths: { type: Number, default: 0 },
    commanderDamageFrom: { type: Map, of: Number, default: {} },
    infect: { type: Number, default: 0 },
    commanderTax: { type: Number, default: 0 },
    background: { type: String, default: null },
    designations: {
        monarch: { type: Boolean, default: false },
        initiative: { type: Boolean, default: false },
        dayNight: { type: String, default: null },
        citysBlessing: { type: Boolean, default: false },
    },
    zones: {
        hand: [cardInstanceSchema],
        library: [cardInstanceSchema],
        battlefield: [cardInstanceSchema],
        graveyard: [cardInstanceSchema],
        exile: [cardInstanceSchema],
        commandZone: [cardInstanceSchema],
        sideboard: [cardInstanceSchema],
        companions: [cardInstanceSchema],
        foretell: [cardInstanceSchema],
        emblems: [{ type: mongoose.Schema.Types.Mixed }],
    },
    teamId: { type: String, default: null },
    mulliganCount: { type: Number, default: 0 },
    mulliganBottomPending: { type: Number, default: 0 },
    handSizeEnforce: { type: Boolean, default: true },
    avatarColor: { type: String, default: null },
    conceded: { type: Boolean, default: false },
}, { _id: false });

const strokeSchema = new mongoose.Schema({
    strokeId: { type: String, required: true },
    playerId: { type: String },
    points: [{ x: Number, y: Number }],
    color: { type: String, default: '#ffffff' },
    size: { type: Number, default: 3 },
    // Aspect ratio (width / height) of the drawer's canvas at the time the
    // stroke was made. The renderer uses this to letterbox the stroke into a
    // rectangle of the same shape on every client — so a circle drawn on a
    // landscape desktop stays a circle on a portrait phone instead of being
    // squashed into an ellipse. Optional for backward compat; strokes missing
    // this field render with the old full-canvas behavior.
    aspectRatio: { type: Number },
}, { _id: false });

const chatMessageSchema = new mongoose.Schema({
    id: { type: String, required: true },
    userId: { type: String },
    username: { type: String, required: true },
    text: { type: String, required: true },
    ts: { type: Number, default: Date.now },
    isSpectator: { type: Boolean, default: false },
}, { _id: false });

const gameRoomSchema = new mongoose.Schema({
    roomCode: { type: String, required: true, unique: true },
    hostId: { type: String, required: true },
    players: [playerStateSchema],
    drawings: [strokeSchema],
    chat: { type: [chatMessageSchema], default: [] },
    turnIndex: { type: Number, default: 0 },
    currentPhase: { type: String, default: 'main1' },
    actionHistory: [{
        actionId: { type: String },
        playerId: { type: String },
        type: { type: String },
        data: { type: mongoose.Schema.Types.Mixed },
        timestamp: { type: Date, default: Date.now },
    }],
    settings: {
        startingLife: { type: Number, default: 40 },
        useCommanderDamage: { type: Boolean, default: true },
        commanderDamageLethal: { type: Number, default: 21 },
        maxPlayers: { type: Number, default: 8 },
        format: { type: String, default: 'commander' },
        mulliganRules: { type: String, default: 'vancouver' },
        handSizeLimit: { type: Number, default: 7 },
    },
    teams: [{
        teamId: { type: String },
        name: { type: String },
        sharedLife: { type: Number, default: null },
    }],
    sharedTeamLife: { type: Boolean, default: false },
    stack: { type: [mongoose.Schema.Types.Mixed], default: [] },
    extraTurns: { type: [mongoose.Schema.Types.Mixed], default: [] },
    started: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    lastActivity: { type: Date, default: Date.now },
});

gameRoomSchema.index({ lastActivity: 1 }, { expireAfterSeconds: 3600 * 6 }); // auto-expire after 6h inactivity

module.exports = mongoose.model('GameRoom', gameRoomSchema);
