const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, minlength: 2, maxlength: 24 },
    password: { type: String, required: true },
    decks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Deck' }],
    preferences: {
        defaultBackground: { type: String, default: null },
        cardSize: { type: String, default: 'normal' },
    },
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);
