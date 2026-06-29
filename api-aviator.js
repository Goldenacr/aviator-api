const express = require('express');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

const MONGO_URI = 'mongodb+srv://richvybs18:Fuckyou2026%24@cluster0.cq4ddne.mongodb.net/?appName=Cluster0';
const DB_NAME = 'aviator';
let db;

async function connectDB() {
    try {
        const client = new MongoClient(MONGO_URI);
        await client.connect();
        db = client.db(DB_NAME);
        console.log('✅ MongoDB Connected - Aviator API');
    } catch (e) {
        console.error('MongoDB connection error:', e.message);
    }
}
connectDB();

function playersCol() { return db?.collection('players'); }
function loansCol() { return db?.collection('loans'); }
function depositsCol() { return db?.collection('deposits'); }
function revenueCol() { return db?.collection('revenue'); }
function gameHistoryCol() { return db?.collection('game_history'); }

// ======================== PLAYERS ========================
app.get('/players', async (req, res) => {
    try {
        const col = playersCol();
        if (!col) return res.json({ success: true, players: {}, total: 0 });
        const players = await col.find({}).toArray();
        const result = {};
        players.forEach(p => { result[p.jid] = p; delete result[p.jid]._id; });
        res.json({ success: true, players: result, total: players.length });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/players/sync', async (req, res) => {
    try {
        const { player, botId } = req.body;
        if (!player?.jid) return res.status(400).json({ success: false });
        player.botId = botId;
        player.syncedAt = Date.now();
        const col = playersCol();
        if (col) await col.updateOne({ jid: player.jid }, { $set: player }, { upsert: true });
        res.json({ success: true, id: player.id });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ======================== LOANS ========================
app.get('/loans', async (req, res) => {
    try {
        const col = loansCol();
        if (!col) return res.json({ success: true, loans: {}, total: 0 });
        const loans = await col.find({}).toArray();
        const result = {};
        loans.forEach(l => { result[l.id] = l; delete result[l.id]._id; });
        res.json({ success: true, loans: result, total: loans.length });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/loans/broadcast', async (req, res) => {
    try {
        const { loan, botId } = req.body;
        if (!loan?.id) return res.status(400).json({ success: false });
        loan.botId = botId;
        loan.broadcastAt = Date.now();
        const col = loansCol();
        if (col) await col.updateOne({ id: loan.id }, { $set: loan }, { upsert: true });
        res.json({ success: true, loanId: loan.id });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/loans/update', async (req, res) => {
    try {
        const { loanId, updates } = req.body;
        const col = loansCol();
        if (col) await col.updateOne({ id: loanId }, { $set: updates });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ======================== DEPOSITS ========================
app.get('/deposits', async (req, res) => {
    try {
        const col = depositsCol();
        if (!col) return res.json({ success: true, deposits: {} });
        const deposits = await col.find({}).toArray();
        const result = {};
        deposits.forEach(d => { result[d.id] = d; delete result[d.id]._id; });
        res.json({ success: true, deposits: result });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/deposits/broadcast', async (req, res) => {
    try {
        const { deposit, botId } = req.body;
        if (!deposit?.id) return res.status(400).json({ success: false });
        deposit.botId = botId;
        const col = depositsCol();
        if (col) await col.updateOne({ id: deposit.id }, { $set: deposit }, { upsert: true });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/deposits/update', async (req, res) => {
    try {
        const { depositId, updates } = req.body;
        const col = depositsCol();
        if (col) await col.updateOne({ id: depositId }, { $set: updates });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ======================== REVENUE ========================
app.get('/revenue', async (req, res) => {
    try {
        const col = revenueCol();
        if (!col) return res.json({ success: true, revenue: { total: 0 } });
        const rev = await col.findOne({ type: 'aviator' }) || { total: 0, thisMonth: 0, thisWeek: 0, totalBets: 0 };
        delete rev._id;
        res.json({ success: true, revenue: rev });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/revenue/update', async (req, res) => {
    try {
        const { amount, type } = req.body;
        const col = revenueCol();
        if (!col) return res.json({ success: true });
        const existing = await col.findOne({ type: 'aviator' }) || { total: 0, thisMonth: 0, thisWeek: 0, totalBets: 0, history: [] };
        existing.total = (existing.total || 0) + amount;
        existing.thisMonth = (existing.thisMonth || 0) + amount;
        existing.thisWeek = (existing.thisWeek || 0) + amount;
        existing.totalBets = (existing.totalBets || 0) + 1;
        existing.history.push({ amount, type, timestamp: Date.now() });
        await col.updateOne({ type: 'aviator' }, { $set: existing }, { upsert: true });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ======================== MULTIPLAYER GAME ========================
let currentGame = null;

/**
 * Generate a realistic Aviator-style crash point.
 * - ~3% instant crashes at 1.00x
 * - House edge: 1%
 * - Exponentially decreasing probability for higher multipliers
 * - Maximum multiplier: 5000x
 */
function generateCrashPoint() {
    const HOUSE_EDGE = 0.01;
    const INSTANT_CRASH = 0.03;
    const MAX_MULTIPLIER = 5000;

    // Instant crash
    if (Math.random() < INSTANT_CRASH) {
        return 1.00;
    }

    // Uniform random number
    const r = Math.random();

    // Crash formula
    let crashPoint = (1 - HOUSE_EDGE) / (1 - r);

    // Cap maximum multiplier
    crashPoint = Math.min(crashPoint, MAX_MULTIPLIER);

    // Round down to 2 decimals
    crashPoint = Math.floor(crashPoint * 100) / 100;

    // Safety
    if (crashPoint < 1.00) crashPoint = 1.00;

    return crashPoint;
}

/**
 * Smooth multiplier growth.
 * Feels much closer to a real Aviator game than random jumps.
 */
function getMultiplier(elapsedMs) {
    const seconds = elapsedMs / 1000;

    // Exponential growth curve
    const multiplier = Math.exp(0.09 * seconds);

    return Number(multiplier.toFixed(2));
}

app.post('/game/start', (req, res) => {
    if (
        currentGame &&
        (currentGame.status === 'active' ||
         currentGame.status === 'starting')
    ) {
        return res.json({
            success: false,
            message: 'Game in progress',
            game: currentGame
        });
    }

    currentGame = {
        id: 'GAME' + Date.now().toString(36).toUpperCase(),
        crashPoint: generateCrashPoint(),
        multiplier: 1.00,
        status: 'starting',
        players: {},
        startTime: Date.now()
    };

    // Betting countdown
    setTimeout(() => {

        if (!currentGame || currentGame.status !== 'starting') return;

        currentGame.status = 'active';

        const gameStart = Date.now();

        const loop = setInterval(() => {

            if (!currentGame || currentGame.status !== 'active') {
                clearInterval(loop);
                return;
            }

            const elapsed = Date.now() - gameStart;

            const multiplier = getMultiplier(elapsed);

            currentGame.multiplier = multiplier;

            if (multiplier >= currentGame.crashPoint) {

                currentGame.status = 'crashed';
                currentGame.multiplier = currentGame.crashPoint;

                const col = gameHistoryCol();

                if (col) {
                    col.insertOne({
                        id: currentGame.id,
                        crashPoint: currentGame.crashPoint,
                        players: currentGame.players,
                        time: Date.now()
                    }).catch(() => {});
                }

                clearInterval(loop);

                setTimeout(() => {
                    currentGame = null;
                }, 60000);
            }

        }, 100); // 10 updates per second

    }, 10000); // 10-second betting period

    res.json({
        success: true,
        game: currentGame
    });
});

app.post('/game/start', (req, res) => {
    if (currentGame && (currentGame.status === 'active' || currentGame.status === 'starting')) {
        return res.json({ success: false, message: 'Game in progress', game: currentGame });
    }
    const crashPoint = generateCrashPoint();
    currentGame = { id: 'GAME' + Date.now().toString(36).toUpperCase(), crashPoint, multiplier: 1.00, status: 'starting', players: {}, startTime: Date.now() };
    
    setTimeout(() => {
        if (!currentGame || currentGame.status !== 'starting') return;
        currentGame.status = 'active';
        let mult = 1.00;
        const loop = setInterval(() => {
            if (!currentGame || currentGame.status !== 'active') { clearInterval(loop); return; }
            mult += getIncrement(mult);
            currentGame.multiplier = Number(mult.toFixed(2));
            if (mult >= currentGame.crashPoint) {
                currentGame.status = 'crashed';
                currentGame.multiplier = currentGame.crashPoint;
                const col = gameHistoryCol();
                if (col) col.insertOne({ id: currentGame.id, crashPoint: currentGame.crashPoint, players: currentGame.players, time: Date.now() }).catch(() => {});
                clearInterval(loop);
                setTimeout(() => { currentGame = null; }, 60000);
            }
        }, 200);
    }, 60000);
    
    res.json({ success: true, game: currentGame });
});

app.get('/game/current', (req, res) => {
    res.json({ success: true, game: currentGame, hasActiveGame: currentGame?.status === 'active' || currentGame?.status === 'starting' });
});

app.post('/game/join', (req, res) => {
    if (!currentGame || currentGame.status !== 'starting') return res.json({ success: false, message: 'Cannot join now' });
    const { playerId, playerName, bet } = req.body;
    if (!playerId || !bet) return res.json({ success: false });
    if (currentGame.players[playerId]) return res.json({ success: false, message: 'Already joined' });
    currentGame.players[playerId] = { id: playerId, name: playerName || 'Player', bet: Number(bet), cashedOut: false, cashOutMultiplier: null };
    res.json({ success: true });
});

app.post('/game/cashout', (req, res) => {
    if (!currentGame || currentGame.status !== 'active') return res.json({ success: false });
    const { playerId } = req.body;
    const player = currentGame.players[playerId];
    if (!player || player.cashedOut) return res.json({ success: false });
    player.cashedOut = true;
    player.cashOutMultiplier = currentGame.multiplier;
    player.winAmount = Math.floor(player.bet * currentGame.multiplier);
    res.json({ success: true, player });
});

app.post('/game/forcecrash', (req, res) => {
    if (!currentGame || currentGame.status !== 'active') return res.json({ success: false });
    const { multiplier } = req.body;
    if (!multiplier || multiplier < 1) return res.json({ success: false });
    currentGame.crashPoint = Number(multiplier);
    res.json({ success: true });
});

app.get('/game/history', async (req, res) => {
    try {
        const col = gameHistoryCol();
        if (!col) return res.json({ success: true, history: [] });
        const history = await col.find({}).sort({ time: -1 }).limit(10).toArray();
        history.forEach(h => delete h._id);
        res.json({ success: true, history });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ======================== HEALTH ========================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'aviator-api', db: !!db, timestamp: Date.now() });
});

// Cleanup expired pending items every hour
setInterval(async () => {
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    try {
        const lCol = loansCol();
        if (lCol) await lCol.deleteMany({ status: 'pending', createdAt: { $lt: now - twentyFourHours } });
        const dCol = depositsCol();
        if (dCol) await dCol.deleteMany({ status: 'pending', createdAt: { $lt: now - twentyFourHours } });
    } catch (e) {}
}, 3600000);

app.listen(PORT, () => console.log(`✈️ Aviator API running on port ${PORT}`));
