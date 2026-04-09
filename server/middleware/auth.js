const Session = require('../models/Session');
const User = require('../models/User');

async function authMiddleware(req, res, next) {
    const sessionToken = req.cookies?.mtgSession;
    if (!sessionToken) {
        req.user = null;
        return next();
    }

    const session = await Session.findOne({ sessionToken });
    if (!session) {
        res.clearCookie('mtgSession');
        req.user = null;
        return next();
    }

    const user = await User.findById(session.userId);
    if (!user) {
        await Session.deleteOne({ _id: session._id });
        res.clearCookie('mtgSession');
        req.user = null;
        return next();
    }

    req.user = user;
    next();
}

function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    next();
}

module.exports = { authMiddleware, requireAuth };
