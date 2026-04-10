const mongoose = require('mongoose');

const customCardSchema = new mongoose.Schema({
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, default: 'Custom Card' },
    imageUrl: { type: String, default: '' },
    manaCost: { type: String, default: '' },
    typeLine: { type: String, default: '' },
    oracleText: { type: String, default: '' },
    power: { type: String, default: '' },
    toughness: { type: String, default: '' },
    colors: [String],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('CustomCard', customCardSchema);
