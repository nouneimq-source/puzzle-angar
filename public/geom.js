// Общая геометрия кусочков: генерация замков, контур для 2D-canvas и SDF для попадания курсора.
// Те же формулы повторены во фрагментном шейдере room.js — менять синхронно.
(function () {
  const TAB = { cy: 0.225, r: 0.165, nw: 0.1, margin: 0.44 };

  function rng(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  // Подбор сетки под число кусочков и пропорции картинки
  function gridFor(n, aspect) {
    n = Math.max(6, Math.min(100000, Math.round(n)));
    let cols = Math.max(2, Math.round(Math.sqrt(n * aspect)));
    let rows = Math.max(2, Math.round(n / cols));
    while (cols * rows > 100000) { if (cols / rows > aspect) cols--; else rows--; }
    while (cols * rows < 6) { if (cols / rows < aspect) cols++; else rows++; }
    return { cols, rows, count: cols * rows };
  }

  // Замки: значение ребра = знак * (1 + j), j ∈ [0,1) задаёт сдвиг и размер выступа.
  // Возвращает Float32Array(4N): верх, право, низ, лево. +1 — выступ, −1 — паз, 0 — ровный край.
  function makeEdges(cols, rows, seed) {
    const R = rng(seed);
    const h = new Float32Array(cols * rows), v = new Float32Array(cols * rows);
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) h[r * cols + c] = (R() < 0.5 ? 1 : -1) * (1 + R() * 0.999);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols - 1; c++) v[r * cols + c] = (R() < 0.5 ? 1 : -1) * (1 + R() * 0.999);
    const E = new Float32Array(cols * rows * 4);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const p = r * cols + c, k = p * 4;
      E[k] = r > 0 ? -h[(r - 1) * cols + c] : 0;
      E[k + 1] = c < cols - 1 ? v[p] : 0;
      E[k + 2] = r < rows - 1 ? h[p] : 0;
      E[k + 3] = c > 0 ? -v[p - 1] : 0;
    }
    return E;
  }

  const fract = (x) => x - Math.floor(x);
  function edgeParams(e) { const j = Math.abs(e) - 1; return { s: Math.sign(e), shift: (j - 0.5) * 0.14, sc: 0.9 + 0.2 * fract(j * 7.31) }; }

  function sdBox(px, py, bx, by) {
    const dx = Math.abs(px) - bx, dy = Math.abs(py) - by;
    const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0);
  }
  function smin(a, b, k) { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return b + (a - b) * h - k * h * (1 - h); }
  function tabSd(qx, qy, sc) {
    qx /= sc; qy /= sc;
    const head = Math.hypot(qx, qy - TAB.cy) - TAB.r;
    const neck = sdBox(qx, qy - 0.06, TAB.nw, 0.09);
    return smin(head, neck, 0.04) * sc;
  }
  // Расстояние со знаком от точки (u,v) в координатах кусочка до его контура (<0 — внутри)
  function pieceSd(E, p, u, v) {
    let d = sdBox(u - 0.5, v - 0.5, 0.5, 0.5);
    const k = p * 4;
    for (let i = 0; i < 4; i++) {
      const e = E[k + i]; if (e === 0) continue;
      const { s, shift, sc } = edgeParams(e);
      let qx, qy;
      if (i === 0) { qx = u - 0.5 - shift; qy = -v; }
      else if (i === 1) { qx = v - 0.5 - shift; qy = u - 1; }
      else if (i === 2) { qx = u - 0.5 - shift; qy = v - 1; }
      else { qx = v - 0.5 - shift; qy = -u; }
      const t = tabSd(qx, s > 0 ? qy : -qy, sc);
      d = s > 0 ? Math.min(d, t) : Math.max(d, -t);
    }
    return d;
  }

  // Контур одного ребра в локальной системе: ось x вдоль обхода (по часовой), наружу — минус y.
  function edgeLocal(ctx, L, e, centerT) {
    if (e === 0) { ctx.lineTo(L, 0); return; }
    const { s, sc } = edgeParams(e);
    const cx = centerT * L, nw = TAB.nw * sc * L, r = TAB.r * sc * L, cy = TAB.cy * sc * L;
    const ny = cy - Math.sqrt(r * r - nw * nw);
    ctx.lineTo(cx - nw, 0);
    ctx.lineTo(cx - nw, -s * ny);
    if (s > 0) ctx.arc(cx, -cy, r, Math.atan2(cy - ny, -nw), Math.atan2(cy - ny, nw) + Math.PI * 2, false);
    else ctx.arc(cx, cy, r, Math.atan2(ny - cy, -nw), Math.atan2(ny - cy, nw) - Math.PI * 2, true);
    ctx.lineTo(cx + nw, 0);
    ctx.lineTo(L, 0);
  }
  // Путь кусочка p с левым верхним углом в (x,y) и размером S
  function piecePath(ctx, E, p, x, y, S) {
    const k = p * 4;
    const sh = (i) => E[k + i] === 0 ? 0 : edgeParams(E[k + i]).shift;
    ctx.save(); ctx.translate(x, y); ctx.moveTo(0, 0); ctx.restore();
    const seg = (tx, ty, rot, i, cT) => { ctx.save(); ctx.translate(x + tx, y + ty); ctx.rotate(rot); edgeLocal(ctx, S, E[k + i], cT); ctx.restore(); };
    seg(0, 0, 0, 0, 0.5 + sh(0));
    seg(S, 0, Math.PI / 2, 1, 0.5 + sh(1));
    seg(S, S, Math.PI, 2, 0.5 - sh(2));
    seg(0, S, -Math.PI / 2, 3, 0.5 - sh(3));
    ctx.closePath();
  }

  window.PG = { TAB, rng, gridFor, makeEdges, pieceSd, piecePath, edgeParams };
})();
