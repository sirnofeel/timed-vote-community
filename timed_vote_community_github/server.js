
import express from 'express';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 4000;

// --- Simple JSON storage ---
const DATA_PATH = path.join(process.cwd(), 'data.json');
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')); }
  catch { return { users: [], sessions: {}, topics: [] }; }
}
function saveDB() { fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2)); }
let db = loadDB();

// Helpers for password hashing
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verify, 'hex'));
}

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// --- Auth middleware ---
function authOptional(req, _res, next) {
  const sid = req.cookies.sid;
  if (sid && db.sessions[sid]) {
    const uid = db.sessions[sid];
    req.user = db.users.find(u => u.id === uid) || null;
  } else req.user = null;
  next();
}
function requireAuth(req, res, next) {
  const sid = req.cookies.sid;
  if (!sid || !db.sessions[sid]) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const uid = db.sessions[sid];
  const user = db.users.find(u => u.id === uid);
  if (!user) return res.status(401).json({ error: '세션이 유효하지 않습니다.' });
  req.user = user;
  next();
}

app.use(authOptional);

// --- Auth APIs ---
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body || {};
  const name = String(username||'').trim();
  const pw = String(password||'');
  if (!name || name.length < 2 || name.length > 30) return res.status(400).json({ error: '닉네임 2~30자를 입력하세요.' });
  if (!pw || pw.length < 6 || pw.length > 100) return res.status(400).json({ error: '비밀번호 6자 이상 입력하세요.' });
  if (db.users.find(u => u.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: '이미 존재하는 닉네임입니다.' });
  const user = { id: uuidv4(), name, pass: hashPassword(pw), created: new Date().toISOString() };
  db.users.push(user); saveDB();
  res.json({ ok: true });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const name = String(username||'').trim();
  const pw = String(password||'');
  const user = db.users.find(u => u.name.toLowerCase() === name.toLowerCase());
  if (!user || !verifyPassword(pw, user.pass)) return res.status(401).json({ error: '닉네임 또는 비밀번호가 올바르지 않습니다.' });
  const sid = uuidv4();
  db.sessions[sid] = user.id; saveDB();
  res.cookie('sid', sid, { httpOnly: true, sameSite: 'Lax', maxAge: 1000*60*60*24*30 });
  res.json({ ok: true, user: { id: user.id, name: user.name }});
});

app.post('/api/auth/logout', (req, res) => {
  const sid = req.cookies.sid;
  if (sid) delete db.sessions[sid];
  res.clearCookie('sid');
  saveDB();
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '로그인 필요' });
  res.json({ user: { id: req.user.id, name: req.user.name } });
});

// --- Voting logic helpers ---
function nowIso(){ return new Date().toISOString(); }
function isClosed(topic) { return new Date(topic.deadline).getTime() <= Date.now(); }
const REVEAL_DELAY_MS = 10 * 60 * 1000; // 10 minutes
function isRevealed(topic) { return new Date(topic.deadline).getTime() + REVEAL_DELAY_MS <= Date.now(); }
function publicTopic(topic, includeCounts) {
  const t = {
    id: topic.id,
    title: topic.title,
    desc: topic.desc,
    options: topic.options.map(o => ({ text: o.text })),
    deadline: topic.deadline,
    created: topic.created,
    status: isClosed(topic) ? 'closed' : 'open',
    revealAt: new Date(new Date(topic.deadline).getTime() + REVEAL_DELAY_MS).toISOString(),
    totalVotes: Object.keys(topic.voters).length
  };
  if (includeCounts) t.results = topic.options.map(o => o.count);
  return t;
}

// --- Topic APIs (auth required to read or act) ---
app.get('/api/topics', requireAuth, (_req, res) => {
  const items = db.topics
    .map(t => publicTopic(t, isRevealed(t)))
    .sort((a,b) => new Date(b.created) - new Date(a.created));
  res.json({ topics: items });
});

app.post('/api/topics', requireAuth, (req, res) => {
  const { title, desc, options, deadline } = req.body || {};
  if (!title || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: '제목과 2개 이상의 선택지를 입력하세요.' });
  }
  const d = new Date(deadline || '');
  if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
    return res.status(400).json({ error: '마감 시간(미래 시각)을 올바르게 입력하세요.' });
  }
  const topic = {
    id: uuidv4(),
    title: String(title).slice(0, 120),
    desc: String(desc||'').slice(0, 2000),
    options: options.map(x => ({ text: String(x).slice(0, 80), count: 0 })),
    deadline: d.toISOString(),
    created: nowIso(),
    voters: {}, // userId -> optionIndex
    votes: []   // {userId, optionIndex, ts}
  };
  db.topics.push(topic);
  saveDB();
  res.json({ ok: true, topic: publicTopic(topic, false) });
});

app.get('/api/topics/:id', requireAuth, (req, res) => {
  const topic = db.topics.find(t => t.id === req.params.id);
  if (!topic) return res.status(404).json({ error: '존재하지 않는 주제' });
  res.json({ topic: publicTopic(topic, isRevealed(topic)) });
});

app.post('/api/topics/:id/vote', requireAuth, (req, res) => {
  const userId = req.user.id;
  const { option } = req.body || {};
  const topic = db.topics.find(t => t.id === req.params.id);
  if (!topic) return res.status(404).json({ error: '존재하지 않는 주제' });
  if (isClosed(topic) && !isRevealed(topic)) return res.status(400).json({ error: '마감되었습니다. 결과는 10분 후 공개됩니다.' });
  if (isRevealed(topic)) return res.status(400).json({ error: '이미 결과가 공개되어 투표할 수 없습니다.' });
  const idx = Number(option);
  if (!(idx >= 0 && idx < topic.options.length)) return res.status(400).json({ error: '잘못된 선택지' });
  if (topic.voters[userId] != null) return res.status(400).json({ error: '이미 투표했습니다.' });
  topic.voters[userId] = idx;
  topic.options[idx].count += 1;
  topic.votes.push({ userId, optionIndex: idx, ts: nowIso() });
  saveDB();
  res.json({ ok: true, message: '투표 완료' });
});

app.get('/api/topics/:id/results', requireAuth, (req, res) => {
  const topic = db.topics.find(t => t.id === req.params.id);
  if (!topic) return res.status(404).json({ error: '존재하지 않는 주제' });
  if (!isRevealed(topic)) return res.status(403).json({ error: '결과는 마감 10분 후 공개됩니다.' });
  res.json({
    id: topic.id,
    title: topic.title,
    options: topic.options.map(o => o.text),
    results: topic.options.map(o => o.count),
    totalVotes: Object.keys(topic.voters).length
  });
});

// --- Page routes with auth gates ---
app.get('/', (req, res, next) => req.user ? next() : res.redirect('/login.html'));
app.get('/new.html', (req, res, next) => req.user ? next() : res.redirect('/login.html'));
app.get('/t/:id', (req, res, next) => req.user ? next() : res.redirect('/login.html'));

app.listen(PORT, () => console.log(`Community (login+delay) at http://localhost:${PORT}`));
