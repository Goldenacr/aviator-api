const express = require('express');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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

function generateCrashPoint() {
    const random = Math.random() * 100;
    let cp;
    if (random < 40) cp = 1 + (Math.random() * 1);
    else if (random < 70) cp = 2 + (Math.random() * 3);
    else if (random < 85) cp = 5 + (Math.random() * 5);
    else if (random < 94) cp = 10 + (Math.random() * 10);
    else if (random < 98) cp = 20 + (Math.random() * 30);
    else if (random < 99.5) cp = 50 + (Math.random() * 150);
    else if (random < 99.9) cp = 200 + (Math.random() * 800);
    else cp = 1000 + (Math.random() * 4000);
    return Number(cp.toFixed(2));
}

function getIncrement(multiplier) {
    if (multiplier < 2) return 0.05 + Math.random() * 0.15;
    if (multiplier < 5) return 0.10 + Math.random() * 0.30;
    if (multiplier < 10) return 0.20 + Math.random() * 0.50;
    if (multiplier < 25) return 0.30 + Math.random() * 1.00;
    if (multiplier < 50) return 0.50 + Math.random() * 2.00;
    if (multiplier < 100) return 1.00 + Math.random() * 4.00;
    return 2.00 + Math.random() * 8.00;
}

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
