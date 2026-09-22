const Session = require('../models/Session');
const User = require('../models/User');

// One account for mtg.ojee.net and dnd.ojee.net. Users and sessions live in
// this server's database; dnd.ojee.net reads and writes the same two
// collections and sets the same cookie, so signing in or out on either site
// applies to both. Keep this file and dnd.ojee.net/server/middleware/auth.js
// in step.
//
// COOKIE_DOMAIN (".ojee.net" in production) lets both API hosts see the
// cookie; unset locally, where both servers run on localhost and share it anyway.
const SESSION_COOKIE = 'ojeeSession';
const LEGACY_COOKIE = 'mtgSession'; // pre-2026-09 name, upgraded on first request
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function cookieOptions() {
    const opts = { httpOnly: true, sameSite: 'none', secure: true };
    if (process.env.COOKIE_DOMAIN) opts.domain = process.env.COOKIE_DOMAIN;
    return opts;
}

function setSessionCookie(res, token) {
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_MS });
    res.clearCookie(LEGACY_COOKIE, { httpOnly: true, sameSite: 'none', secure: true });
}

function clearSessionCookies(res) {
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.clearCookie(LEGACY_COOKIE, { httpOnly: true, sameSite: 'none', secure: true });
}

async function authMiddleware(req, res, next) {
    const token = req.cookies?.[SESSION_COOKIE];
    const legacy = !token && req.cookies?.[LEGACY_COOKIE];
    const sessionToken = token || legacy;
    if (!sessionToken) {
        req.user = null;
        return next();
    }

    try {
        const session = await Session.findOne({ sessionToken });
        if (!session) {
            clearSessionCookies(res);
            req.user = null;
            return next();
        }

        const user = await User.findById(session.userId);
        if (!user) {
            await Session.deleteOne({ _id: session._id });
            clearSessionCookies(res);
            req.user = null;
            return next();
        }

        // Same session, new cookie name and domain: nobody gets signed out.
        if (legacy) setSessionCookie(res, sessionToken);
        req.user = user;
        req.sessionToken = sessionToken;
        next();
    } catch (err) {
        req.user = null;
        next();
    }
}

function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    next();
}

module.exports = { authMiddleware, requireAuth, setSessionCookie, clearSessionCookies, SESSION_COOKIE, SESSION_MS };
