// Puzzle Angar — сервер: статика, API комнат, WebSocket для совместной сборки
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const ROOMS_DIR = path.join(DATA, 'rooms');
const IMG_DIR = path.join(DATA, 'images');
fs.mkdirSync(ROOMS_DIR, { recursive: true });
fs.mkdirSync(IMG_DIR, { recursive: true });

const MAX_PIECES = 100000;
const MIN_PIECES = 6;
const SNAP = 0.26; // допуск стыковки в долях кусочка

// ---------- комнаты ----------
const metas = new Map(); // id -> meta (лёгкие данные для лобби)
const live = new Map();  // id -> Room (загруженное состояние)

for (const f of fs.readdirSync(ROOMS_DIR)) {
  if (!f.endsWith('.meta.json')) continue;
  try { const m = JSON.parse(fs.readFileSync(path.join(ROOMS_DIR, f), 'utf8')); metas.set(m.id, m); } catch (e) {}
}

function rnd(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function scatter(cols, rows, seed) {
  const N = cols * rows, R = rnd(seed ^ 0x9e3779b9), cell = 1.78;
  let b = 1;
  const free = (bb) => { const w = cols + 2 * bb, h = rows + 2 * bb; return Math.floor(w / cell) * Math.floor(h / cell) - Math.ceil((cols + 1.2) / cell + 1) * Math.ceil((rows + 1.2) / cell + 1); };
  while (free(b) < N * 1.25) b += Math.max(0.5, b * 0.08);
  const W = cols + 2 * b, H = rows + 2 * b, nx = Math.floor(W / cell), ny = Math.floor(H / cell);
  const cells = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = -b + i * cell, y = -b + j * cell;
    if (x + cell > -0.6 && x < cols + 0.6 && y + cell > -0.6 && y < rows + 0.6) continue; // не кладём на поле сборки
    cells.push([x, y]);
  }
  for (let i = cells.length - 1; i > 0; i--) { const k = Math.floor(R() * (i + 1)); [cells[i], cells[k]] = [cells[k], cells[i]]; }
  const pos = new Float32Array(N * 2);
  for (let p = 0; p < N; p++) {
    const [x, y] = cells[p];
    pos[p * 2] = x + 0.18 + R() * 0.06; pos[p * 2 + 1] = y + 0.18 + R() * 0.06;
  }
  return pos;
}

class Room {
  constructor(meta, state) {
    this.meta = meta;
    const N = meta.cols * meta.rows;
    this.N = N;
    this.groupOf = new Int32Array(N);
    this.groups = new Map();
    this.clients = new Map(); // ws -> player
    this.saveTimer = null;
    if (state) {
      for (let p = 0; p < N; p++) this.groupOf[p] = state.groupOf[p];
      for (let i = 0; i < state.groups.length; i += 3) this.groups.set(state.groups[i], { x: state.groups[i + 1], y: state.groups[i + 2], pieces: [], holder: null });
      for (let p = 0; p < N; p++) this.groups.get(this.groupOf[p]).pieces.push(p);
    } else {
      const pos = scatter(meta.cols, meta.rows, meta.seed);
      for (let p = 0; p < N; p++) {
        const c = p % meta.cols, r = (p / meta.cols) | 0;
        this.groupOf[p] = p;
        // x,y группы = положение клетки (0,0) решётки этой группы
        this.groups.set(p, { x: pos[p * 2] - c, y: pos[p * 2 + 1] - r, pieces: [p], holder: null });
      }
    }
  }
  serialize() {
    const g = [];
    for (const [id, G] of this.groups) g.push(id, +G.x.toFixed(4), +G.y.toFixed(4));
    return { groupOf: Array.from(this.groupOf), groups: g };
  }
  progress() { return this.N <= 1 ? 1 : (this.N - this.groups.size) / (this.N - 1); }
  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 4000);
  }
  save() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (!metas.has(this.meta.id)) return;
    this.meta.progress = this.progress();
    this.meta.updated = Date.now();
    fs.writeFileSync(path.join(ROOMS_DIR, this.meta.id + '.state.json'), JSON.stringify(this.serialize()));
    writeMeta(this.meta);
  }
  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const ws of this.clients.keys()) if (ws !== except && ws.readyState === 1) ws.send(s);
  }
  players() {
    return [...this.clients.values()].map(p => ({ id: p.id, name: p.name, color: p.color }));
  }
  // стыковка после того, как группу отпустили
  snap(gid) {
    const { cols, rows } = this.meta;
    const merges = [];
    let cur = gid;
    outer: for (;;) {
      const G = this.groups.get(cur);
      for (const p of G.pieces) {
        const c = p % cols, r = (p / cols) | 0;
        for (let d = 0; d < 4; d++) {
          let q;
          if (d === 0) { if (r === 0) continue; q = p - cols; }
          else if (d === 1) { if (c === cols - 1) continue; q = p + 1; }
          else if (d === 2) { if (r === rows - 1) continue; q = p + cols; }
          else { if (c === 0) continue; q = p - 1; }
          const h = this.groupOf[q];
          if (h === cur) continue;
          const H = this.groups.get(h);
          if (H.holder) continue;
          if (Math.abs(H.x - G.x) < SNAP && Math.abs(H.y - G.y) < SNAP) {
            const bigId = H.pieces.length >= G.pieces.length ? h : cur;
            const smallId = bigId === h ? cur : h;
            const big = this.groups.get(bigId), small = this.groups.get(smallId);
            for (const p2 of small.pieces) { this.groupOf[p2] = bigId; big.pieces.push(p2); }
            this.groups.delete(smallId);
            merges.push([smallId, bigId]);
            cur = bigId;
            continue outer;
          }
        }
      }
      break;
    }
    return { merges, gid: cur };
  }
}

function writeMeta(m) { fs.writeFileSync(path.join(ROOMS_DIR, m.id + '.meta.json'), JSON.stringify(m)); }

function getRoom(id) {
  if (live.has(id)) return live.get(id);
  const meta = metas.get(id);
  if (!meta) return null;
  let state = null;
  try { state = JSON.parse(fs.readFileSync(path.join(ROOMS_DIR, id + '.state.json'), 'utf8')); } catch (e) {}
  const room = new Room(meta, state);
  live.set(id, room);
  if (!state) room.save();
  return room;
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };

function sendFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache ? 'public, max-age=31536000, immutable' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too_big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function decodeImage(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  return { ext: m[1] === 'jpeg' ? 'jpg' : m[1], buf: Buffer.from(m[2], 'base64') };
}

function publicMeta(m) {
  const room = live.get(m.id);
  return { id: m.id, name: m.name, cols: m.cols, rows: m.rows, pieces: m.cols * m.rows, image: m.image, thumb: m.thumb, kind: m.kind, created: m.created, updated: m.updated, progress: room ? room.progress() : (m.progress || 0), online: room ? room.clients.size : 0, completedAt: m.completedAt || null };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  try {
    if (p === '/api/rooms' && req.method === 'GET') {
      return json(res, 200, [...metas.values()].map(publicMeta).sort((a, b) => (b.online - a.online) || (b.updated - a.updated)));
    }
    if (p === '/api/rooms' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 60 * 1024 * 1024)).toString('utf8'));
      const cols = body.cols | 0, rows = body.rows | 0;
      if (cols < 2 || rows < 2 || cols * rows < MIN_PIECES || cols * rows > MAX_PIECES) return json(res, 400, { error: 'Число кусочков должно быть от 6 до 100 000' });
      const img = decodeImage(body.image), th = decodeImage(body.thumb);
      if (!img || !th) return json(res, 400, { error: 'Картинка не распознана. Подойдут JPG, PNG или WebP.' });
      const id = crypto.randomBytes(4).toString('hex');
      fs.writeFileSync(path.join(IMG_DIR, id + '.' + img.ext), img.buf);
      fs.writeFileSync(path.join(IMG_DIR, id + '-t.' + th.ext), th.buf);
      const meta = { id, name: String(body.name || 'Пазл').slice(0, 60), cols, rows, seed: crypto.randomBytes(4).readUInt32LE(0), image: id + '.' + img.ext, thumb: id + '-t.' + th.ext, kind: ['upload', 'gallery', 'darklay'].includes(body.kind) ? body.kind : 'upload', created: Date.now(), updated: Date.now(), progress: 0, stats: {} };
      metas.set(id, meta);
      writeMeta(meta);
      return json(res, 200, { id });
    }
    let m;
    if ((m = /^\/api\/rooms\/([a-f0-9]{8})$/.exec(p))) {
      const meta = metas.get(m[1]);
      if (!meta) return json(res, 404, { error: 'Комната не найдена' });
      if (req.method === 'DELETE') {
        const room = live.get(meta.id);
        if (room) { room.broadcast({ t: 'deleted' }); for (const ws of room.clients.keys()) ws.close(); live.delete(meta.id); if (room.saveTimer) clearTimeout(room.saveTimer); }
        metas.delete(meta.id);
        for (const f of [meta.id + '.meta.json', meta.id + '.state.json']) fs.rm(path.join(ROOMS_DIR, f), () => {});
        for (const f of [meta.image, meta.thumb]) fs.rm(path.join(IMG_DIR, f), () => {});
        return json(res, 200, { ok: true });
      }
      return json(res, 200, publicMeta(meta));
    }
    if ((m = /^\/img\/([a-f0-9]{8}(?:-t)?\.(?:jpg|png|webp))$/.exec(p))) return sendFile(res, path.join(IMG_DIR, m[1]), true);
    if (p === '/' || p === '/index.html') return sendFile(res, path.join(PUB, 'index.html'));
    if (/^\/r\/[a-f0-9]{8}\/?$/.test(p)) return sendFile(res, path.join(PUB, 'room.html'));
    const file = path.normalize(path.join(PUB, p));
    if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    return sendFile(res, file);
  } catch (e) {
    console.error(e);
    json(res, e.message === 'too_big' ? 413 : 500, { error: e.message === 'too_big' ? 'Файл слишком большой' : 'Ошибка сервера' });
  }
});

// ---------- WebSocket ----------
const COLORS = 12;
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const room = getRoom(url.searchParams.get('room') || '');
  if (!room) { ws.send(JSON.stringify({ t: 'error', error: 'Комната не найдена' })); return ws.close(); }
  const used = new Set([...room.clients.values()].map(p => p.color));
  let color = 0; while (used.has(color) && color < COLORS - 1) color++;
  const player = { id: crypto.randomBytes(3).toString('hex'), name: 'Гость', color, lastMove: 0 };
  room.clients.set(ws, player);

  const release = () => {
    for (const [gid, G] of room.groups) if (G.holder === player.id) {
      G.holder = null;
      const r = room.snap(gid);
      room.broadcast({ t: 'drop', g: gid, x: G.x, y: G.y, merges: r.merges, by: player.id });
    }
  };

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    switch (msg.t) {
      case 'hello': {
        player.name = String(msg.name || 'Гость').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Гость';
        const holders = [];
        for (const [gid, G] of room.groups) if (G.holder) holders.push(gid, G.holder);
        ws.send(JSON.stringify({ t: 'init', you: player.id, meta: publicMeta(room.meta), seed: room.meta.seed, state: room.serialize(), holders, players: room.players(), stats: room.meta.stats || {} }));
        room.broadcast({ t: 'players', players: room.players() });
        room.broadcast({ t: 'sys', text: player.name + ' в ангаре' }, ws);
        break;
      }
      case 'grab': {
        const G = room.groups.get(msg.g);
        if (!G) return ws.send(JSON.stringify({ t: 'deny', g: msg.g }));
        if (G.holder && G.holder !== player.id) return ws.send(JSON.stringify({ t: 'deny', g: msg.g, x: G.x, y: G.y }));
        // одна группа в руках за раз
        for (const [gid, H] of room.groups) if (H.holder === player.id && gid !== msg.g) H.holder = null;
        G.holder = player.id;
        room.broadcast({ t: 'grab', g: msg.g, by: player.id }, ws);
        break;
      }
      case 'move': {
        const G = room.groups.get(msg.g);
        if (!G || G.holder !== player.id || !isFinite(msg.x) || !isFinite(msg.y)) return;
        G.x = +msg.x; G.y = +msg.y;
        room.broadcast({ t: 'move', g: msg.g, x: G.x, y: G.y }, ws);
        break;
      }
      case 'drop': {
        const G = room.groups.get(msg.g);
        if (!G || G.holder !== player.id) return;
        if (isFinite(msg.x) && isFinite(msg.y)) { G.x = +msg.x; G.y = +msg.y; }
        G.holder = null;
        const r = room.snap(msg.g);
        if (r.merges.length) {
          room.meta.stats = room.meta.stats || {};
          room.meta.stats[player.name] = (room.meta.stats[player.name] || 0) + r.merges.length;
        }
        room.broadcast({ t: 'drop', g: msg.g, x: G.x, y: G.y, merges: r.merges, by: player.id, stats: r.merges.length ? room.meta.stats : undefined });
        if (r.merges.length && room.groups.size === 1 && !room.meta.completedAt) {
          room.meta.completedAt = Date.now();
          room.broadcast({ t: 'done', at: room.meta.completedAt, stats: room.meta.stats });
          room.save();
        } else room.scheduleSave();
        break;
      }
      case 'cursor': {
        if (!isFinite(msg.x) || !isFinite(msg.y)) return;
        room.broadcast({ t: 'cursor', id: player.id, x: +msg.x, y: +msg.y }, ws);
        break;
      }
      case 'chat': {
        const text = String(msg.text || '').trim().slice(0, 300);
        if (!text) return;
        room.broadcast({ t: 'chat', id: player.id, name: player.name, color: player.color, text });
        break;
      }
      case 'ping': {
        room.broadcast({ t: 'ping', id: player.id, x: +msg.x, y: +msg.y }, null);
        break;
      }
    }
  });

  ws.on('close', () => {
    release();
    room.clients.delete(ws);
    room.broadcast({ t: 'players', players: room.players() });
    room.broadcast({ t: 'sys', text: player.name + ' вышел' });
    room.scheduleSave();
    if (room.clients.size === 0) {
      setTimeout(() => { if (room.clients.size === 0 && live.get(room.meta.id) === room) { room.save(); live.delete(room.meta.id); } }, 30000);
    }
  });
});

function saveAll() { for (const r of live.values()) try { r.save(); } catch (e) {} }
process.on('SIGINT', () => { saveAll(); process.exit(0); });
process.on('SIGTERM', () => { saveAll(); process.exit(0); });

server.listen(PORT, () => {
  console.log(`Puzzle Angar запущен: http://localhost:${PORT}`);
  const nets = require('os').networkInterfaces();
  for (const list of Object.values(nets)) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  в локальной сети: http://${n.address}:${PORT}`);
});
