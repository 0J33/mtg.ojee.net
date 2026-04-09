require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { authMiddleware } = require('./middleware/auth');
const registerSocketHandlers = require('./socket/handlers');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5002;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

const io = new Server(server, {
    cors: { origin: CLIENT_URL, credentials: true },
});

// Trust proxy (Cloudflare/nginx) for secure cookies
app.set('trust proxy', 1);

// Middleware
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(authMiddleware);

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mtg')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/decks', require('./routes/decks'));
app.use('/api/scryfall', require('./routes/scryfall'));
app.use('/api/import', require('./routes/import'));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Socket.io
registerSocketHandlers(io);

server.listen(PORT, () => {
    console.log(`MTG server running on port ${PORT}`);
});
