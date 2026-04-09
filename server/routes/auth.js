const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Session = require('../models/Session');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 2 || username.length > 24) return res.status(400).json({ error: 'Username must be 2-24 characters' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const existing = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
    if (existing) return res.status(400).json({ error: 'Username taken' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed });

    const sessionToken = uuidv4();
    await Session.create({ sessionToken, userId: user._id });

    res.cookie('mtgSession', sessionToken, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'none', secure: true });
    res.json({ user: { id: user._id, username: user.username } });
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    user.lastLogin = Date.now();
    await user.save();

    const sessionToken = uuidv4();
    await Session.create({ sessionToken, userId: user._id });

    res.cookie('mtgSession', sessionToken, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'none', secure: true });
    res.json({ user: { id: user._id, username: user.username } });
});

router.post('/logout', async (req, res) => {
    const sessionToken = req.cookies?.mtgSession;
    if (sessionToken) {
        await Session.deleteOne({ sessionToken });
    }
    res.clearCookie('mtgSession');
    res.json({ success: true });
});

router.get('/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: { id: req.user._id, username: req.user.username, preferences: req.user.preferences } });
});

module.exports = router;
