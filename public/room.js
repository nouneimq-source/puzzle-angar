// Puzzle Angar — стол сборки: WebGL2-рендер инстансами, совместная игра через WebSocket
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString('ru-RU');
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const roomId = location.pathname.split('/')[2];

  const PCOL = ['#ffb51f', '#4cc9f0', '#f72585', '#7ae582', '#b388ff', '#ff7b54', '#00f5d4', '#ffd6e0', '#e9ff70', '#5e9eff', '#ff4d6d', '#c0fdfb'];
  const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const BGS = [
    { name: 'Графит', bg: '#1b1f24', board: '#23282f' },
    { name: 'Сукно', bg: '#173326', board: '#1e3f30' },
    { name: 'Фанера', bg: '#7a5a3a', board: '#8a6844' },
    { name: 'Бумага', bg: '#e7e3da', board: '#d9d4c8' },
    { name: 'Ночь', bg: '#05060a', board: '#0e1118' },
    { name: 'Сигнал', bg: '#3a2a05', board: '#4a3608' },
  ];

  // ---------- состояние ----------
  let meta, N = 0, cols = 0, rows = 0, E, me = null;
  let groupOf, groups = new Map();
  let order, slot, inst;
  const ST = 9;
  const players = new Map();
  const cursors = new Map();
  const pings = [];
  const remoteMoving = new Set();
  let stats = {};
  let edgeMode = false, ghost = false;
  let bgIdx = +(store.get('pa_bg') || 0) % BGS.length;
  let sound = store.get('pa_sound') !== '0';
  let dLo = Infinity, dHi = -1, needs = true, fullUpload = true;

  // ---------- WebGL ----------
  const canvas = $('gl'), ov = $('ov'), octx = ov.getContext('2d');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
  if (!gl) { $('load-text').textContent = 'Браузер не поддерживает WebGL2. Открой сайт в свежем Chrome, Edge, Firefox или Safari.'; return; }

  const VS = `#version 300 es
  layout(location=0) in vec2 aCorner;
  layout(location=1) in vec4 aPos;
  layout(location=2) in vec4 aEdge;
  layout(location=3) in float aFlag;
  uniform vec2 uCam; uniform float uZoom; uniform vec2 uRes; uniform vec2 uGrid;
  out vec2 vLocal; out vec2 vUV; flat out vec4 vEdge; flat out float vFlag;
  const float M = 0.44;
  void main(){
    vLocal = vec2(0.); vUV = vec2(0.); vEdge = vec4(0.); vFlag = 0.;
    if (aFlag < -0.5) { gl_Position = vec4(-9., -9., 0., 1.); return; }
    vec2 local = mix(vec2(-M), vec2(1.0 + M), aCorner);
    vec2 s = (aPos.xy + local - uCam) * uZoom;
    vec2 ndc = s / uRes * 2.0 - 1.0;
    gl_Position = vec4(ndc.x, -ndc.y, 0., 1.);
    vLocal = local; vUV = (aPos.zw + local) / uGrid; vEdge = aEdge; vFlag = aFlag;
  }`;
  const FS = `#version 300 es
  precision highp float;
  in vec2 vLocal; in vec2 vUV; flat in vec4 vEdge; flat in float vFlag;
  uniform sampler2D uTex; uniform vec3 uColors[13]; uniform float uZoom;
  out vec4 o;
  float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
  float smin(float a, float b, float k){ float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
  float tabSd(vec2 q, float sc){ q /= sc; float head = length(q - vec2(0., .225)) - .165; float neck = sdBox(q - vec2(0., .06), vec2(.1, .09)); return smin(head, neck, .04) * sc; }
  float edgeSd(float d, float e, vec2 q){
    if (e == 0.) return d;
    float s = sign(e); float j = abs(e) - 1.;
    q.x -= (j - .5) * .14;
    float t = tabSd(vec2(q.x, s > 0. ? q.y : -q.y), .9 + .2 * fract(j * 7.31));
    return s > 0. ? min(d, t) : max(d, -t);
  }
  float sd(vec2 p){
    float d = sdBox(p - .5, vec2(.5));
    d = edgeSd(d, vEdge.x, vec2(p.x - .5, -p.y));
    d = edgeSd(d, vEdge.y, vec2(p.y - .5, p.x - 1.));
    d = edgeSd(d, vEdge.z, vec2(p.x - .5, p.y - 1.));
    d = edgeSd(d, vEdge.w, vec2(p.y - .5, -p.x));
    return d;
  }
  void main(){
    float px = 1.0 / uZoom;
    float d = sd(vLocal);
    float a = clamp(0.5 - d / px, 0., 1.);
    if (a <= 0.) discard;
    vec3 col = texture(uTex, vUV).rgb;
    float detail = smoothstep(5., 22., uZoom);
    if (detail > 0.) {
      float e = 0.003;
      vec2 g = vec2(sd(vLocal + vec2(e, 0.)) - d, sd(vLocal + vec2(0., e)) - d);
      vec2 n = g / max(length(g), 1e-6);
      float bw = max(0.07, 2.5 * px);
      float rim = 1.0 - clamp(-d / bw, 0., 1.);
      float light = dot(n, vec2(-0.7071, -0.7071));
      col += rim * light * 0.32 * detail;
      col *= 1.0 - (1.0 - clamp(-d / (1.3 * px), 0., 1.)) * 0.45 * detail;
    }
    if (vFlag > 0.5) {
      vec3 hc = uColors[int(vFlag + 0.5) - 1];
      float ring = 1.0 - clamp(-d / max(0.06, 2.5 * px), 0., 1.);
      col = mix(col, hc, ring * 0.85 + 0.06);
    }
    o = vec4(clamp(col, 0., 1.) * a, a);
  }`;
  const BVS = `#version 300 es
  layout(location=0) in vec2 aCorner;
  uniform vec2 uCam; uniform float uZoom; uniform vec2 uRes; uniform vec4 uRect;
  out vec2 vUV;
  void main(){ vec2 w = uRect.xy + aCorner * uRect.zw; vec2 ndc = (w - uCam) * uZoom / uRes * 2. - 1.; gl_Position = vec4(ndc.x, -ndc.y, 0., 1.); vUV = aCorner; }`;
  const BFS = `#version 300 es
  precision highp float;
  in vec2 vUV; uniform sampler2D uTex; uniform vec3 uBoard; uniform float uGhost; out vec4 o;
  void main(){ vec3 c = mix(uBoard, texture(uTex, vUV).rgb, uGhost); o = vec4(c, 1.); }`;

  function prog(vs, fs) {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  const P = prog(VS, FS), B = prog(BVS, BFS);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vaoP = gl.createVertexArray(), vaoB = gl.createVertexArray();
  const ibuf = gl.createBuffer();
  gl.bindVertexArray(vaoB); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(vaoP); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
  const S4 = ST * 4;
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, S4, 0); gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, S4, 16); gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, S4, 32); gl.vertexAttribDivisor(3, 1);
  gl.bindVertexArray(null);
  const tex = gl.createTexture();
  let texReady = false;

  function loadTexture(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        let source = img;
        if (img.naturalWidth > max || img.naturalHeight > max) {
          const k = max / Math.max(img.naturalWidth, img.naturalHeight);
          const c = document.createElement('canvas'); c.width = Math.floor(img.naturalWidth * k); c.height = Math.floor(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); source = c;
        }
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        texReady = true; needs = true;
        resolve();
      };
      img.onerror = () => reject(new Error('Картинка не загрузилась'));
      img.src = src;
    });
  }

  // ---------- камера ----------
  const cam = { x: 0, y: 0, z: 40 };
  let dpr = 1, W = 1, H = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.round(innerWidth * dpr); H = Math.round(innerHeight * dpr);
    canvas.width = ov.width = W; canvas.height = ov.height = H;
    needs = true;
  }
  addEventListener('resize', resize); resize();
  const toWorld = (sx, sy) => [cam.x + sx * dpr / cam.z, cam.y + sy * dpr / cam.z];
  function zoomAt(sx, sy, k) {
    const [wx, wy] = toWorld(sx, sy);
    const minZ = Math.min(W, H) / (Math.max(cols, rows) * 6 + 40);
    cam.z = Math.max(minZ, Math.min(600 * dpr, cam.z * k));
    cam.x = wx - sx * dpr / cam.z; cam.y = wy - sy * dpr / cam.z;
    needs = true;
  }
  function fit() {
    if (!N) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let s = 0; s < N; s++) {
      const k = s * ST; if (inst[k + 8] < -0.5) continue;
      const x = inst[k], y = inst[k + 1];
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    x0 = Math.min(x0, 0); y0 = Math.min(y0, 0); x1 = Math.max(x1 + 1, cols); y1 = Math.max(y1 + 1, rows);
    const padTop = 70 * dpr, padBot = 70 * dpr, pad = 20 * dpr;
    cam.z = Math.min((W - pad * 2) / (x1 - x0), (H - padTop - padBot) / (y1 - y0));
    cam.x = (x0 + x1) / 2 - W / 2 / cam.z;
    cam.y = (y0 + y1) / 2 - (H + padTop - padBot) / 2 / cam.z;
    needs = true;
  }

  // ---------- кусочки ----------
  const isEdgePiece = (p) => { const c = p % cols, r = (p / cols) | 0; return c === 0 || r === 0 || c === cols - 1 || r === rows - 1; };
  function flagFor(G) {
    if (edgeMode && !G.edge) return -1;
    if (G.flash) return 13;
    if (G.holder) { const pl = players.get(G.holder); return 1 + (pl ? pl.color % 12 : 0); }
    return 0;
  }
  function mark(s) { if (s < dLo) dLo = s; if (s > dHi) dHi = s; needs = true; }
  function writeGroup(G) {
    const f = flagFor(G);
    for (const p of G.pieces) {
      const s = slot[p], k = s * ST;
      inst[k] = G.x + (p % cols); inst[k + 1] = G.y + ((p / cols) | 0); inst[k + 8] = f;
      mark(s);
    }
  }
  function buildAll() {
    for (let s = 0; s < N; s++) {
      const p = order[s], k = s * ST, G = groups.get(groupOf[p]);
      const c = p % cols, r = (p / cols) | 0;
      slot[p] = s;
      inst[k] = G.x + c; inst[k + 1] = G.y + r; inst[k + 2] = c; inst[k + 3] = r;
      inst[k + 4] = E[p * 4]; inst[k + 5] = E[p * 4 + 1]; inst[k + 6] = E[p * 4 + 2]; inst[k + 7] = E[p * 4 + 3];
      inst[k + 8] = flagFor(G);
    }
    fullUpload = true; needs = true;
  }
  function toTop(gid) {
    const G = groups.get(gid); if (!G) return;
    const n = G.pieces.length;
    let already = true;
    for (const p of G.pieces) if (slot[p] < N - n) { already = false; break; }
    if (already) return;
    const no = new Int32Array(N); let w = 0;
    for (let s = 0; s < N; s++) { const p = order[s]; if (groupOf[p] !== gid) no[w++] = p; }
    for (const p of G.pieces) no[w++] = p;
    order = no;
    buildAll();
  }
  function hitTest(wx, wy) {
    const M = PG.TAB.margin;
    for (let s = N - 1; s >= 0; s--) {
      const k = s * ST;
      if (inst[k + 8] < -0.5) continue;
      const u = wx - inst[k], v = wy - inst[k + 1];
      if (u < -M || v < -M || u > 1 + M || v > 1 + M) continue;
      const p = order[s];
      if (PG.pieceSd(E, p, u, v) < 0.02) return p;
    }
    return -1;
  }
  function progress() { return N <= 1 ? 1 : (N - groups.size) / (N - 1); }
  function updateProgress() {
    const pr = progress();
    $('bar').style.width = (pr * 100).toFixed(2) + '%';
    $('prog-text').textContent = `${(pr * 100).toFixed(pr < 0.1 && pr > 0 ? 1 : 0)}% · ${fmt(groups.size)} ${plural(groups.size, 'кусок', 'куска', 'кусков')} на столе`;
  }
  function plural(n, a, b, c) { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; }

  function applyInit(m) {
    me = m.you; meta = m.meta; cols = meta.cols; rows = meta.rows; N = cols * rows;
    E = PG.makeEdges(cols, rows, m.seed);
    groupOf = new Int32Array(m.state.groupOf);
    groups = new Map();
    const g = m.state.groups;
    for (let i = 0; i < g.length; i += 3) groups.set(g[i], { x: g[i + 1], y: g[i + 2], pieces: [], holder: null, edge: false, flash: false, tx: 0, ty: 0 });
    for (let p = 0; p < N; p++) { const G = groups.get(groupOf[p]); G.pieces.push(p); if (!G.edge && isEdgePiece(p)) G.edge = true; }
    for (let i = 0; i < m.holders.length; i += 2) { const G = groups.get(m.holders[i]); if (G) G.holder = m.holders[i + 1]; }
    setPlayers(m.players);
    stats = m.stats || {};
    // порядок: одиночки снизу, большие группы сверху
    const ids = [...groups.keys()].sort((a, b) => groups.get(a).pieces.length - groups.get(b).pieces.length);
    order = new Int32Array(N); let w = 0;
    for (const id of ids) for (const p of groups.get(id).pieces) order[w++] = p;
    slot = new Int32Array(N);
    inst = new Float32Array(N * ST);
    buildAll();
    gl.bindBuffer(gl.ARRAY_BUFFER, ibuf); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW); fullUpload = false;
    document.title = meta.name + ' · Puzzle Angar';
    $('name').textContent = meta.name;
    updateProgress();
  }

  // ---------- сеть ----------
  let ws = null, connected = false, firstInit = true, myName = store.get('pa_name') || '';
  // Связь: сначала WebSocket; если сеть (VPN, прокси, фильтр) его не пропускает — обычные HTTP-запросы
  let mode = 'ws', wsFails = 0, poll = null;
  function connect() { if (mode === 'ws') connectWS(); else connectPoll(); }
  function onOpen() { connected = true; $('conn').hidden = true; send({ t: 'hello', name: myName }); }
  function onLost() {
    connected = false; dragging = null;
    if (deleted) return;
    $('conn').hidden = false; setTimeout(connect, 1500);
  }
  function connectWS() {
    let openedAt = 0;
    let sock;
    try { sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?room=' + roomId); }
    catch (e) { mode = 'poll'; return connectPoll(); }
    ws = sock;
    const timer = setTimeout(() => { if (!openedAt) sock.close(); }, 6000);
    sock.onopen = () => { openedAt = Date.now(); clearTimeout(timer); onOpen(); };
    sock.onclose = () => {
      clearTimeout(timer);
      if (ws !== sock) return;
      ws = null;
      // не открылся или оборвался почти сразу — значит, сеть режет WebSocket
      if (!openedAt || Date.now() - openedAt < 8000) wsFails++; else wsFails = 0;
      if (wsFails >= 2 || (!openedAt && wsFails >= 1)) mode = 'poll';
      onLost();
    };
    sock.onmessage = (ev) => onMsg(JSON.parse(ev.data));
  }
  async function connectPoll() {
    const P = { cid: null, alive: true, out: [], timer: null, chain: Promise.resolve() };
    poll = P;
    try {
      const r = await fetch('/poll/open?room=' + roomId, { method: 'POST' });
      if (r.status === 404) { onMsg({ t: 'error', error: 'Комната не найдена' }); return; }
      if (!r.ok) throw new Error('open');
      P.cid = (await r.json()).cid;
      onOpen();
      while (P.alive) {
        const rr = await fetch('/poll/recv?cid=' + P.cid, { cache: 'no-store' });
        if (!rr.ok) throw new Error('recv');
        for (const m of await rr.json()) { if (m.t === 'closed') throw new Error('closed'); onMsg(m); }
      }
    } catch (e) {
      if (poll === P) { P.alive = false; poll = null; onLost(); }
    }
  }
  function send(o) {
    if (mode === 'ws') { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); return; }
    const P = poll; if (!P || !P.cid) return;
    P.out.push(o);
    if (P.timer) return;
    P.timer = setTimeout(() => {
      P.timer = null;
      const batch = P.out; P.out = [];
      // запросы идут строго по очереди, чтобы «взял — двигал — отпустил» не перепутались
      P.chain = P.chain.then(() => fetch('/poll/send?cid=' + P.cid, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) })).catch(() => {});
    }, 70);
  }
  let deleted = false;

  function onMsg(m) {
    switch (m.t) {
      case 'init':
        applyInit(m);
        if (firstInit) { firstInit = false; fit(); texPromise.then(() => { $('ov-load').hidden = true; }).catch((e) => { $('load-text').textContent = e.message; }); if (meta.completedAt) toast('Этот пазл уже собран. Можно любоваться.'); }
        break;
      case 'players': setPlayers(m.players); break;
      case 'grab': {
        const G = groups.get(m.g); if (!G) return;
        if (dragging && dragging.gid === m.g) dragging = null;
        G.holder = m.by; G.tx = G.x; G.ty = G.y; toTop(m.g); writeGroup(G);
        break;
      }
      case 'deny': {
        const G = groups.get(m.g);
        if (dragging && dragging.gid === m.g) dragging = null;
        if (G && m.x !== undefined) { G.x = m.x; G.y = m.y; writeGroup(G); }
        const pl = G && players.get(G.holder);
        toast(pl ? `Этот кусок держит ${pl.name}` : 'Этот кусок сейчас занят');
        break;
      }
      case 'move': {
        const G = groups.get(m.g); if (!G) return;
        G.tx = m.x; G.ty = m.y; remoteMoving.add(m.g); needs = true;
        break;
      }
      case 'drop': onDrop(m); break;
      case 'cursor': { const c = cursors.get(m.id) || { x: m.x, y: m.y }; c.tx = m.x; c.ty = m.y; c.t = performance.now(); cursors.set(m.id, c); needs = true; break; }
      case 'ping': pings.push({ x: m.x, y: m.y, id: m.id, t: performance.now() }); needs = true; if (m.id !== me) beep(880, 0.08); break;
      case 'chat': addMsg(m); break;
      case 'sys': addSys(m.text); break;
      case 'done': stats = m.stats || stats; celebrate(); break;
      case 'deleted': deleted = true; $('load-text').textContent = 'Комнату удалили.'; $('ov-load').hidden = false; break;
      case 'error': deleted = true; $('load-text').textContent = m.error; $('ov-load').hidden = false; break;
    }
  }

  function onDrop(m) {
    const G = groups.get(m.g); if (!G) return;
    if (m.by !== me || !dragging || dragging.gid !== m.g) { G.x = m.x; G.y = m.y; }
    G.holder = null; remoteMoving.delete(m.g);
    let into = m.g;
    for (const [from, to] of m.merges) {
      const F = groups.get(from), T = groups.get(to); if (!F || !T) continue;
      for (const p of F.pieces) { groupOf[p] = to; T.pieces.push(p); }
      T.edge = T.edge || F.edge;
      groups.delete(from); remoteMoving.delete(from);
      into = to;
    }
    if (m.stats) stats = m.stats;
    const fin = groups.get(into);
    if (m.merges.length) {
      toTop(into);
      fin.flash = true; writeGroup(fin);
      setTimeout(() => { if (groups.get(into) === fin) { fin.flash = false; writeGroup(fin); } }, 260);
      if (m.by === me) click(); else { const pl = players.get(m.by); if (pl) click(0.35); }
      updateProgress();
    } else writeGroup(fin);
  }

  // ---------- игроки ----------
  function setPlayers(list) {
    players.clear();
    for (const p of list) players.set(p.id, p);
    for (const id of [...cursors.keys()]) if (!players.has(id)) cursors.delete(id);
    const box = $('avatars'); box.innerHTML = '';
    const arr = [...players.values()].sort((a, b) => (b.id === me) - (a.id === me));
    arr.slice(0, 6).forEach((p) => {
      const d = document.createElement('div'); d.className = 'av' + (p.id === me ? ' me' : '');
      d.style.background = PCOL[p.color % 12]; d.textContent = (p.name[0] || '?').toUpperCase(); d.title = p.name + (p.id === me ? ' (ты)' : '');
      d.addEventListener('click', () => togglePop('pop-people'));
      box.appendChild(d);
    });
    if (arr.length > 6) { const d = document.createElement('div'); d.className = 'av more'; d.textContent = '+' + (arr.length - 6); d.addEventListener('click', () => togglePop('pop-people')); box.appendChild(d); }
    renderPeople();
    if (N) for (const G of groups.values()) if (G.holder) writeGroup(G);
  }
  function renderPeople() {
    const pl = $('plist'); pl.innerHTML = '';
    for (const p of players.values()) {
      const r = document.createElement('div'); r.className = 'prow';
      const sw = document.createElement('i'); sw.className = 'sw'; sw.style.background = PCOL[p.color % 12];
      const b = document.createElement('b'); b.textContent = p.name + (p.id === me ? ' (ты)' : '');
      r.append(sw, b); pl.appendChild(r);
    }
    const sl = $('slist'); sl.innerHTML = '';
    const ent = Object.entries(stats).sort((a, b) => b[1] - a[1]);
    if (!ent.length) { const n = document.createElement('div'); n.className = 'note'; n.textContent = 'Пока никто ничего не соединил.'; sl.appendChild(n); }
    for (const [name, n] of ent.slice(0, 20)) {
      const r = document.createElement('div'); r.className = 'prow';
      const b = document.createElement('b'); b.textContent = name; const s = document.createElement('span'); s.textContent = fmt(n);
      r.append(b, s); sl.appendChild(r);
    }
  }

  // ---------- управление ----------
  const board = $('board');
  const pointers = new Map();
  let dragging = null, panning = null, pinch = null;
  let lastMoveSent = 0, lastCursorSent = 0, pendingMove = null;
  let lastPointer = null;

  board.addEventListener('pointerdown', (e) => {
    if (!N) return;
    board.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    closePops();
    unlockAudio();
    if (pointers.size === 2 && !dragging) {
      panning = null;
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (pointers.size > 1) return;
    if (e.button === 2) return;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const p = hitTest(wx, wy);
    if (p >= 0) {
      const gid = groupOf[p], G = groups.get(gid);
      if (G.holder && G.holder !== me) {
        const pl = players.get(G.holder); toast(pl ? `Этот кусок держит ${pl.name}` : 'Этот кусок сейчас занят');
        return;
      }
      dragging = { gid, pid: e.pointerId, ox: wx - G.x, oy: wy - G.y, sx: e.clientX, sy: e.clientY };
      G.holder = me; toTop(gid); writeGroup(G);
      send({ t: 'grab', g: gid });
      board.classList.add('grabbing');
    } else {
      panning = { pid: e.pointerId, x: e.clientX, y: e.clientY };
      board.classList.add('grabbing');
    }
  });
  board.addEventListener('pointermove', (e) => {
    lastPointer = { x: e.clientX, y: e.clientY };
    const pt = pointers.get(e.pointerId);
    if (pt) { pt.x = e.clientX; pt.y = e.clientY; }
    const now = performance.now();
    if (now - lastCursorSent > 60 && N) { lastCursorSent = now; const [wx, wy] = toWorld(e.clientX, e.clientY); send({ t: 'cursor', x: +wx.toFixed(3), y: +wy.toFixed(3) }); }
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      cam.x -= (mx - pinch.mx) * dpr / cam.z; cam.y -= (my - pinch.my) * dpr / cam.z;
      zoomAt(mx, my, (pinch.z * d / pinch.d) / cam.z);
      pinch.mx = mx; pinch.my = my;
      return;
    }
    if (dragging && e.pointerId === dragging.pid) moveDragged(e.clientX, e.clientY);
    else if (panning && e.pointerId === panning.pid) {
      cam.x -= (e.clientX - panning.x) * dpr / cam.z; cam.y -= (e.clientY - panning.y) * dpr / cam.z;
      panning.x = e.clientX; panning.y = e.clientY; needs = true;
    }
  });
  function moveDragged(cx, cy) {
    const G = groups.get(dragging.gid); if (!G) { dragging = null; return; }
    const [wx, wy] = toWorld(cx, cy);
    G.x = wx - dragging.ox; G.y = wy - dragging.oy;
    writeGroup(G);
    const now = performance.now();
    if (now - lastMoveSent > 40) { lastMoveSent = now; send({ t: 'move', g: dragging.gid, x: +G.x.toFixed(4), y: +G.y.toFixed(4) }); }
  }
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (dragging && e.pointerId === dragging.pid) {
      const G = groups.get(dragging.gid);
      if (G) send({ t: 'drop', g: dragging.gid, x: +G.x.toFixed(4), y: +G.y.toFixed(4) });
      dragging = null;
    }
    if (panning && e.pointerId === panning.pid) panning = null;
    if (!pointers.size) board.classList.remove('grabbing');
  }
  board.addEventListener('pointerup', endPointer);
  board.addEventListener('pointercancel', endPointer);
  board.addEventListener('contextmenu', (e) => e.preventDefault());
  board.addEventListener('dblclick', (e) => {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    if (hitTest(wx, wy) < 0) send({ t: 'ping', x: +wx.toFixed(3), y: +wy.toFixed(3) });
  });
  board.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (e.ctrlKey || !e.shiftKey) zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0015));
    if (dragging && lastPointer) moveDragged(lastPointer.x, lastPointer.y);
  }, { passive: false });

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === '+' || k === '=') zoomAt(innerWidth / 2, innerHeight / 2, 1.25);
    else if (k === '-' || k === '_') zoomAt(innerWidth / 2, innerHeight / 2, 0.8);
    else if (k === 'f' || k === 'а' || k === '0') fit();
    else if (k === 'e' || k === 'у') $('edges').click();
    else if (k === 'g' || k === 'п') $('ghost').click();
    else if (k === 'p' || k === 'з') $('pic').click();
    else if (k === 'enter') { $('chat').hidden = false; $('chat-btn').setAttribute('aria-pressed', 'true'); $('unread').hidden = true; $('chat-input').focus(); e.preventDefault(); }
  });

  // ---------- кнопки ----------
  $('zin').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1.35);
  $('zout').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.35);
  $('fit').onclick = fit;
  $('edges').onclick = () => {
    edgeMode = !edgeMode; $('edges').setAttribute('aria-pressed', edgeMode);
    for (const G of groups.values()) writeGroup(G);
    toast(edgeMode ? 'Показаны только кусочки с краем' : 'Показаны все кусочки');
  };
  $('ghost').onclick = () => { ghost = !ghost; $('ghost').setAttribute('aria-pressed', ghost); needs = true; };
  $('pic').onclick = () => { const h = !$('preview').hidden; $('preview').hidden = h; $('pic').setAttribute('aria-pressed', !h); if (!h) closePops(); };
  function applyBg() { $('bg-dot').setAttribute('fill', BGS[bgIdx].bg); $('bg').title = 'Стол: ' + BGS[bgIdx].name; needs = true; }
  $('bg').onclick = () => { bgIdx = (bgIdx + 1) % BGS.length; store.set('pa_bg', bgIdx); applyBg(); toast('Стол: ' + BGS[bgIdx].name); };
  applyBg();
  function applySnd() { $('snd').setAttribute('aria-pressed', sound); $('snd-wave').style.opacity = sound ? 1 : 0.15; }
  $('snd').onclick = () => { sound = !sound; store.set('pa_sound', sound ? '1' : '0'); applySnd(); if (sound) click(); };
  applySnd();
  $('chat-btn').onclick = () => { const h = !$('chat').hidden; $('chat').hidden = h; $('chat-btn').setAttribute('aria-pressed', !h); if (!h) { $('unread').hidden = true; $('chat-input').focus(); } };
  $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); const t = $('chat-input').value.trim(); if (t) send({ t: 'chat', text: t }); $('chat-input').value = ''; });

  function closePops() { document.querySelectorAll('.pop').forEach((p) => { p.hidden = true; }); }
  function togglePop(id) { const el = $(id); const h = !el.hidden; closePops(); el.hidden = h; if (!h) { $('preview').hidden = true; $('pic').setAttribute('aria-pressed', 'false'); } if (id === 'pop-people') renderPeople(); }
  $('invite').onclick = () => {
    togglePop('pop-invite');
    $('invite-link').value = location.href;
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    $('invite-note').className = 'note' + (local ? ' warn' : '');
    $('invite-note').textContent = local
      ? 'Это адрес только для твоего компьютера. Друзьям нужен адрес из окна сервера («в локальной сети») или ссылка туннеля, см. README.'
      : 'Отправь ссылку. Кто откроет, сразу попадёт к этому столу.';
  };
  $('copy').onclick = () => {
    const inp = $('invite-link');
    const ok = () => { $('copy').textContent = 'Скопировано'; setTimeout(() => { $('copy').textContent = 'Копировать'; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(inp.value).then(ok, () => { inp.select(); });
    else { inp.select(); try { document.execCommand('copy'); ok(); } catch (e) {} }
  };
  $('done-close').onclick = () => { $('ov-done').hidden = true; };

  // ---------- чат и тосты ----------
  function addMsg(m) {
    const d = document.createElement('div'); d.className = 'm';
    const b = document.createElement('b'); b.textContent = m.name; b.style.color = PCOL[m.color % 12];
    const s = document.createElement('span'); s.textContent = m.text;
    d.append(b, s); pushMsg(d);
    if ($('chat').hidden) { $('unread').hidden = false; if (m.id !== me) toast(m.name + ': ' + m.text); }
    if (m.id !== me) beep(660, 0.05);
  }
  function addSys(text) { const d = document.createElement('div'); d.className = 'sys'; d.textContent = text; pushMsg(d); if ($('chat').hidden) toast(text); }
  function pushMsg(el) { const box = $('msgs'); box.appendChild(el); while (box.children.length > 80) box.firstChild.remove(); box.scrollTop = box.scrollHeight; }
  function toast(text) {
    const t = document.createElement('div'); t.className = 'toast chip'; t.textContent = text;
    $('toasts').appendChild(t); while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
    setTimeout(() => t.remove(), 2600);
  }

  // ---------- звук ----------
  let actx = null;
  function unlockAudio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === 'suspended') actx.resume(); }
  function click(vol = 1) {
    if (!sound || !actx) return;
    const t = actx.currentTime;
    const len = 0.05, buf = actx.createBuffer(1, actx.sampleRate * len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
    const src = actx.createBufferSource(); src.buffer = buf;
    const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 1.2;
    const g = actx.createGain(); g.gain.value = 0.9 * vol;
    src.connect(f).connect(g).connect(actx.destination); src.start(t);
    const o = actx.createOscillator(), og = actx.createGain();
    o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.07);
    og.gain.setValueAtTime(0.25 * vol, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(og).connect(actx.destination); o.start(t); o.stop(t + 0.1);
  }
  function beep(freq, dur) {
    if (!sound || !actx) return;
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = freq; g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur * 3);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur * 3);
  }

  // ---------- финал ----------
  const confetti = [];
  function celebrate() {
    const ent = Object.entries(stats).sort((a, b) => b[1] - a[1]);
    $('done-text').textContent = `${fmt(N)} ${plural(N, 'кусочек', 'кусочка', 'кусочков')} на своих местах. Кто сколько соединил:`;
    const list = $('done-list'); list.innerHTML = '';
    ent.slice(0, 10).forEach(([name, n], i) => {
      const r = document.createElement('div'); r.className = 'prow';
      const b = document.createElement('b'); b.textContent = (i === 0 ? '🏆 ' : `${i + 1}. `) + name; const s = document.createElement('span'); s.textContent = fmt(n);
      r.append(b, s); list.appendChild(r);
    });
    $('ov-done').hidden = false;
    for (let i = 0; i < 220; i++) confetti.push({ x: Math.random() * W, y: -Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 4 * dpr, vy: (2 + Math.random() * 4) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: PCOL[i % 12], s: (4 + Math.random() * 6) * dpr });
    if (sound && actx) [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.15), i * 120));
    fit();
  }

  // ---------- кадр ----------
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    // плавное движение чужих кусков
    for (const gid of remoteMoving) {
      const G = groups.get(gid); if (!G) { remoteMoving.delete(gid); continue; }
      G.x += (G.tx - G.x) * 0.45; G.y += (G.ty - G.y) * 0.45;
      if (Math.abs(G.tx - G.x) < 0.001 && Math.abs(G.ty - G.y) < 0.001) { G.x = G.tx; G.y = G.ty; remoteMoving.delete(gid); }
      writeGroup(G);
    }
    for (const c of cursors.values()) {
      if (Math.abs(c.tx - c.x) > 0.001 || Math.abs(c.ty - c.y) > 0.001) { c.x += (c.tx - c.x) * 0.35; c.y += (c.ty - c.y) * 0.35; needs = true; }
    }
    // автопрокрутка у края экрана, когда тащишь кусок
    if (dragging && lastPointer) {
      const m = 36, sp = 9 * dpr / cam.z; let dx = 0, dy = 0;
      if (lastPointer.x < m) dx = -sp; else if (lastPointer.x > innerWidth - m) dx = sp;
      if (lastPointer.y < m) dy = -sp; else if (lastPointer.y > innerHeight - m) dy = sp;
      if (dx || dy) { cam.x += dx; cam.y += dy; moveDragged(lastPointer.x, lastPointer.y); }
    }
    if (pings.length || confetti.length) needs = true;
    for (const c of cursors.values()) { const age = now - c.t; if (age > 9000 && age < 12500) { needs = true; break; } }
    if (!needs || !texReady || !N) return;
    needs = false;
    draw(now);
  }

  function draw(now) {
    gl.viewport(0, 0, W, H);
    const bg = hex2rgb(BGS[bgIdx].bg);
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    // поле сборки
    gl.disable(gl.BLEND);
    gl.useProgram(B.p); gl.bindVertexArray(vaoB);
    gl.uniform2f(B.u.uCam, cam.x, cam.y); gl.uniform1f(B.u.uZoom, cam.z); gl.uniform2f(B.u.uRes, W, H);
    gl.uniform4f(B.u.uRect, 0, 0, cols, rows); gl.uniform3fv(B.u.uBoard, hex2rgb(BGS[bgIdx].board)); gl.uniform1f(B.u.uGhost, ghost ? 0.22 : 0);
    gl.uniform1i(B.u.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // кусочки
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(P.p); gl.bindVertexArray(vaoP);
    gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
    if (fullUpload) { gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst); fullUpload = false; dLo = Infinity; dHi = -1; }
    else if (dHi >= dLo) { gl.bufferSubData(gl.ARRAY_BUFFER, dLo * S4, inst, dLo * ST, (dHi - dLo + 1) * ST); dLo = Infinity; dHi = -1; }
    gl.uniform2f(P.u.uCam, cam.x, cam.y); gl.uniform1f(P.u.uZoom, cam.z); gl.uniform2f(P.u.uRes, W, H); gl.uniform2f(P.u.uGrid, cols, rows);
    gl.uniform1i(P.u.uTex, 0);
    const colors = new Float32Array(13 * 3);
    PCOL.forEach((h, i) => colors.set(hex2rgb(h), i * 3)); colors.set([1, 1, 1], 36);
    gl.uniform3fv(P.u.uColors, colors);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, N);
    gl.bindVertexArray(null);
    drawOverlay(now);
  }

  function drawOverlay(now) {
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, W, H);
    const sx = (x) => (x - cam.x) * cam.z, sy = (y) => (y - cam.y) * cam.z;
    // рамка поля
    const light = bgIdx === 3;
    octx.strokeStyle = light ? '#0000004d' : '#ffffff40'; octx.lineWidth = 1.5 * dpr; octx.setLineDash([8 * dpr, 6 * dpr]);
    octx.strokeRect(sx(0), sy(0), cols * cam.z, rows * cam.z); octx.setLineDash([]);
    // отметки
    for (let i = pings.length - 1; i >= 0; i--) {
      const pg = pings[i], age = (now - pg.t) / 1600;
      if (age > 1) { pings.splice(i, 1); continue; }
      const pl = players.get(pg.id), col = pl ? PCOL[pl.color % 12] : '#fff';
      octx.strokeStyle = col; octx.globalAlpha = 1 - age; octx.lineWidth = 3 * dpr;
      for (const k of [0, 0.3]) { const a = Math.max(0, age - k); octx.beginPath(); octx.arc(sx(pg.x), sy(pg.y), (10 + a * 60) * dpr, 0, Math.PI * 2); octx.stroke(); }
      octx.globalAlpha = 1;
    }
    // курсоры друзей
    octx.font = `700 ${12 * dpr}px Manrope, system-ui, sans-serif`;
    for (const [id, c] of cursors) {
      const pl = players.get(id); if (!pl || id === me) continue;
      const age = now - c.t; if (age > 12000) continue;
      const x = sx(c.x), y = sy(c.y), col = PCOL[pl.color % 12];
      octx.globalAlpha = age > 9000 ? 1 - (age - 9000) / 3000 : 1;
      octx.fillStyle = col; octx.strokeStyle = '#0008'; octx.lineWidth = 1.2 * dpr;
      octx.beginPath(); octx.moveTo(x, y); octx.lineTo(x + 4 * dpr, y + 16 * dpr); octx.lineTo(x + 7.5 * dpr, y + 9.5 * dpr); octx.lineTo(x + 14 * dpr, y + 8 * dpr); octx.closePath(); octx.fill(); octx.stroke();
      const tw = octx.measureText(pl.name).width;
      octx.fillRect(x + 12 * dpr, y + 14 * dpr, tw + 12 * dpr, 18 * dpr);
      octx.fillStyle = '#111'; octx.fillText(pl.name, x + 18 * dpr, y + 27 * dpr);
      octx.globalAlpha = 1;
    }
    // конфетти
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i]; c.x += c.vx; c.y += c.vy; c.vy += 0.05 * dpr; c.r += c.vr;
      if (c.y > H + 20) { confetti.splice(i, 1); continue; }
      octx.save(); octx.translate(c.x, c.y); octx.rotate(c.r); octx.fillStyle = c.c; octx.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2); octx.restore();
    }
  }

  // ---------- старт ----------
  let texPromise;
  async function start() {
    let info;
    try {
      const res = await fetch('/api/rooms/' + roomId);
      if (!res.ok) throw new Error('Комната не найдена');
      info = await res.json();
    } catch (e) { $('load-text').innerHTML = ''; $('load-text').append(e.message + '. '); const a = document.createElement('a'); a.href = '/'; a.textContent = 'В лобби'; $('load-text').append(a); return; }
    $('name').textContent = info.name;
    $('preview-img').src = '/img/' + info.image;
    texPromise = loadTexture('/img/' + info.image);
    texPromise.catch((e) => { $('load-text').textContent = e.message; });
    const go = () => { $('ov-name').hidden = true; $('ov-load').hidden = false; $('load-text').textContent = `Раскладываем ${fmt(info.pieces)} ${plural(info.pieces, 'кусочек', 'кусочка', 'кусочков')}…`; connect(); };
    if (!myName) {
      $('ov-load').hidden = true; $('ov-name').hidden = false;
      $('name-thumb').src = '/img/' + info.thumb;
      $('name-title').textContent = info.name;
      $('name-input').focus();
      $('name-form').addEventListener('submit', (e) => { e.preventDefault(); myName = $('name-input').value.trim().slice(0, 24); if (!myName) return; store.set('pa_name', myName); unlockAudio(); go(); });
    } else go();
    if (store.get('pa_help_seen')) $('help').hidden = true;
    setTimeout(() => { $('help').hidden = true; store.set('pa_help_seen', '1'); }, 15000);
    requestAnimationFrame(frame);
  }
  start();
})();
