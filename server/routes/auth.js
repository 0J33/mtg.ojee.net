const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Session = require('../models/Session');
const { setSessionCookie, clearSessionCookies } = require('../middleware/auth');

const router = express.Router();

// These rules and messages are shared with dnd.ojee.net, which registers and
// signs in against the same users (see middleware/auth.js).
const USERNAME_RULE = 'Username must be 2-24 characters';
const PASSWORD_RULE = 'Password must be at least 4 characters';

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byUsername = (username) => User.findOne({ username: { $regex: new RegExp(`^${escapeRegex(username)}$`, 'i') } });

async function startSession(res, user) {
    const sessionToken = uuidv4();
    await Session.create({ sessionToken, userId: user._id });
    setSessionCookie(res, sessionToken);
}

router.post('/register', async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 2 || username.length > 24) return res.status(400).json({ error: USERNAME_RULE });
    if (password.length < 4) return res.status(400).json({ error: PASSWORD_RULE });

    if (await byUsername(username)) return res.status(400).json({ error: 'That username is taken' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed });
    await startSession(res, user);
    res.json({ user: { id: user._id, username: user.username } });
});

router.post('/login', async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = await byUsername(username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Wrong username or password' });
    }

    user.lastLogin = Date.now();
    await user.save();
    await startSession(res, user);
    res.json({ user: { id: user._id, username: user.username } });
});

// Deleting the session signs out of dnd.ojee.net too: it shares the store.
router.post('/logout', async (req, res) => {
    if (req.sessionToken) await Session.deleteOne({ sessionToken: req.sessionToken });
    clearSessionCookies(res);
    res.json({ success: true });
});

router.get('/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: { id: req.user._id, username: req.user.username, preferences: req.user.preferences } });
});

module.exports = router;
