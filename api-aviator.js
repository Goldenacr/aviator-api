const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const PLAYERS_FILE = path.join(DATA_DIR, 'aviator_players.json');
const LOANS_FILE = path.join(DATA_DIR, 'aviator_loans.json');
const REVENUE_FILE = path.join(DATA_DIR, 'aviator_revenue.json');

function load(f) { try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {} return {}; }
function save(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// ======================== PLAYERS ========================
app.get('/players', (req, res) => {
    const players = load(PLAYERS_FILE);
    res.json({ success: true, players, total: Object.keys(players).length });
});

app.post('/players/sync', (req, res) => {
    const { player, botId } = req.body;
    if (!player) return res.status(400).json({ success: false, error: 'No player data' });
    
    const players = load(PLAYERS_FILE);
    players[player.jid] = { ...player, botId, syncedAt: Date.now() };
    save(PLAYERS_FILE, players);
    
    res.json({ success: true, id: player.id });
});

// ======================== LOANS ========================
app.get('/loans', (req, res) => {
    const loans = load(LOANS_FILE);
    res.json({ success: true, loans, total: Object.keys(loans).length });
});

app.post('/loans/broadcast', (req, res) => {
    const { loan, botId } = req.body;
    if (!loan) return res.status(400).json({ success: false, error: 'No loan data' });
    
    const loans = load(LOANS_FILE);
    loans[loan.id] = { ...loan, botId, broadcastAt: Date.now() };
    save(LOANS_FILE, loans);
    
    res.json({ success: true, loanId: loan.id, message: 'Broadcast to super owners' });
});

app.post('/loans/update', (req, res) => {
    const { loanId, updates } = req.body;
    const loans = load(LOANS_FILE);
    if (!loans[loanId]) return res.status(404).json({ success: false });
    
    Object.assign(loans[loanId], updates);
    save(LOANS_FILE, loans);
    res.json({ success: true });
});

// ======================== DEPOSITS ========================
app.get('/deposits', (req, res) => {
    const deposits = load(path.join(DATA_DIR, 'aviator_deposits.json'));
    res.json({ success: true, deposits });
});

app.post('/deposits/broadcast', (req, res) => {
    const { deposit, botId } = req.body;
    const deposits = load(path.join(DATA_DIR, 'aviator_deposits.json'));
    deposits[deposit.id] = { ...deposit, botId, broadcastAt: Date.now() };
    save(path.join(DATA_DIR, 'aviator_deposits.json'), deposits);
    res.json({ success: true });
});

app.post('/deposits/update', (req, res) => {
    const { depositId, updates } = req.body;
    const deposits = load(path.join(DATA_DIR, 'aviator_deposits.json'));
    if (!deposits[depositId]) return res.status(404).json({ success: false });
    Object.assign(deposits[depositId], updates);
    save(path.join(DATA_DIR, 'aviator_deposits.json'), deposits);
    res.json({ success: true });
});

// ======================== REVENUE ========================
app.get('/revenue', (req, res) => {
    const rev = load(REVENUE_FILE);
    res.json({ success: true, revenue: rev });
});

app.post('/revenue/update', (req, res) => {
    const { amount, type } = req.body;
    const rev = load(REVENUE_FILE);
    rev.total = (rev.total || 0) + amount;
    rev[type] = (rev[type] || 0) + amount;
    rev.history = rev.history || [];
    rev.history.push({ amount, type, timestamp: Date.now() });
    save(REVENUE_FILE, rev);
    res.json({ success: true });
});

// ======================== HEALTH ========================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'aviator-api', timestamp: Date.now() });
});


// ======================== MULTIPLAYER AVIATOR GAME ========================
let currentGame = null;

function generateCrashPoint() {
    const random = Math.random() * 100;
    let crashPoint;
    if (random < 40) crashPoint = 1 + (Math.random() * 1);
    else if (random < 70) crashPoint = 2 + (Math.random() * 3);
    else if (random < 85) crashPoint = 5 + (Math.random() * 5);
    else if (random < 94) crashPoint = 10 + (Math.random() * 10);
    else if (random < 98) crashPoint = 20 + (Math.random() * 30);
    else if (random < 99.5) crashPoint = 50 + (Math.random() * 150);
    else if (random < 99.9) crashPoint = 200 + (Math.random() * 800);
    else crashPoint = 1000 + (Math.random() * 4000);
    return Number(crashPoint.toFixed(2));
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

// POST /game/start - Start a new round
app.post('/game/start', (req, res) => {
    if (currentGame && currentGame.status === 'active') {
        return res.json({ success: false, message: 'Game in progress', game: currentGame });
    }
    if (currentGame && currentGame.status === 'starting') {
        return res.json({ success: false, message: 'Countdown in progress', game: currentGame });
    }
    
    const crashPoint = generateCrashPoint();
    currentGame = {
        id: 'GAME' + Date.now().toString(36).toUpperCase(),
        crashPoint,
        multiplier: 1.00,
        status: 'starting',
        players: {},
        startTime: Date.now(),
        history: []
    };
    
    // Auto-start after 60 seconds
    setTimeout(() => {
        if (!currentGame || currentGame.status !== 'starting') return;
        currentGame.status = 'active';
        currentGame.startTime = Date.now();
        
        let mult = 1.00;
        const loop = setInterval(() => {
            if (!currentGame || currentGame.status !== 'active') { clearInterval(loop); return; }
            mult += getIncrement(mult);
            currentGame.multiplier = Number(mult.toFixed(2));
            
            if (mult >= currentGame.crashPoint) {
                currentGame.status = 'crashed';
                currentGame.multiplier = currentGame.crashPoint;
                currentGame.crashedAt = Date.now();
                
                // Save to history
                const history = load(path.join(DATA_DIR, 'aviator_game_history.json'));
                history[currentGame.id] = {
                    id: currentGame.id, crashPoint: currentGame.crashPoint,
                    players: currentGame.players, time: Date.now()
                };
                save(path.join(DATA_DIR, 'aviator_game_history.json'), history);
                clearInterval(loop);
                
                // Auto-reset after 60 seconds
                setTimeout(() => { currentGame = null; }, 60000);
            }
        }, 200);
    }, 60000);
    
    res.json({ success: true, game: currentGame });
});

// GET /game/current - Get current game state
app.get('/game/current', (req, res) => {
    res.json({
        success: true,
        game: currentGame,
        hasActiveGame: currentGame?.status === 'active' || currentGame?.status === 'starting'
    });
});

// POST /game/join - Join current round
app.post('/game/join', (req, res) => {
    if (!currentGame || currentGame.status !== 'starting') {
        return res.json({ success: false, message: 'Cannot join now' });
    }
    const { playerId, playerName, bet, botId } = req.body;
    if (!playerId || !bet) return res.json({ success: false, message: 'Missing data' });
    if (currentGame.players[playerId]) return res.json({ success: false, message: 'Already joined' });
    
    currentGame.players[playerId] = {
        id: playerId, name: playerName || 'Player',
        bet: Number(bet), botId: botId || 'unknown',
        cashedOut: false, cashOutMultiplier: null, joinedAt: 1.00
    };
    res.json({ success: true, game: currentGame });
});

// POST /game/cashout - Cash out
app.post('/game/cashout', (req, res) => {
    if (!currentGame || currentGame.status !== 'active') {
        return res.json({ success: false, message: 'No active game' });
    }
    const { playerId } = req.body;
    const player = currentGame.players[playerId];
    if (!player) return res.json({ success: false, message: 'Not in game' });
    if (player.cashedOut) return res.json({ success: false, message: 'Already cashed out' });
    
    player.cashedOut = true;
    player.cashOutMultiplier = currentGame.multiplier;
    player.winAmount = Math.floor(player.bet * currentGame.multiplier);
    res.json({ success: true, player });
});

// POST /game/forcecrash - Force crash (super owner)
app.post('/game/forcecrash', (req, res) => {
    if (!currentGame || currentGame.status !== 'active') {
        return res.json({ success: false, message: 'No active game' });
    }
    const { multiplier } = req.body;
    if (!multiplier || multiplier < 1) return res.json({ success: false });
    
    currentGame.crashPoint = Number(multiplier);
    res.json({ success: true });
});

// GET /game/history - Last 10 rounds
app.get('/game/history', (req, res) => {
    const history = load(path.join(DATA_DIR, 'aviator_game_history.json'));
    const recent = Object.values(history).slice(-10).reverse();
    res.json({ success: true, history: recent });
});

// Cleanup old pending loans/deposits every hour
setInterval(() => {
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    
    const loans = load(LOANS_FILE);
    for (const [id, loan] of Object.entries(loans)) {
        if (loan.status === 'pending' && now - loan.createdAt > twentyFourHours) {
            delete loans[id];
        }
    }
    save(LOANS_FILE, loans);
    
    const deposits = load(path.join(DATA_DIR, 'aviator_deposits.json'));
    for (const [id, dep] of Object.entries(deposits)) {
        if (dep.status === 'pending' && now - dep.createdAt > twentyFourHours) {
            delete deposits[id];
        }
    }
    save(path.join(DATA_DIR, 'aviator_deposits.json'), deposits);
}, 3600000);

app.listen(PORT, () => console.log(`✈️ Aviator API running on port ${PORT}`));
