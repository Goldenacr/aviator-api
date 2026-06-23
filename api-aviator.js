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