// Встроенные картинки. Всё рисуется кодом, поэтому работает без интернета и в любом размере.
(function () {
  const rng = (s) => window.PG.rng(s);
  const lerp = (a, b, t) => a + (b - a) * t;

  function ridge(R, w, n, rough) {
    const pts = new Float32Array(n + 1);
    pts[0] = R(); pts[n] = R();
    (function sub(a, b, amp) {
      if (b - a < 2) return;
      const m = (a + b) >> 1;
      pts[m] = (pts[a] + pts[b]) / 2 + (R() - 0.5) * amp;
      sub(a, m, amp * rough); sub(m, b, amp * rough);
    })(0, n, 1);
    return pts;
  }
  function drawRidge(ctx, w, h, pts, base, amp, fill) {
    const n = pts.length - 1;
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let i = 0; i <= n; i++) ctx.lineTo(i / n * w, base + (pts[i] - 0.5) * amp);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }

  const items = [
    {
      id: 'neon', name: 'Неоновый закат', tag: 'gallery', draw(ctx, w, h) {
        const R = rng(11);
        let g = ctx.createLinearGradient(0, 0, 0, h * 0.62);
        g.addColorStop(0, '#120a2e'); g.addColorStop(0.55, '#5b1a6e'); g.addColorStop(1, '#ff6a3d');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(255,255,255,${R() * 0.8})`; ctx.fillRect(R() * w, R() * h * 0.35, 1 + R() * w / 900, 1 + R() * w / 900); }
        const sx = w / 2, sy = h * 0.5, sr = h * 0.24;
        g = ctx.createLinearGradient(0, sy - sr, 0, sy + sr);
        g.addColorStop(0, '#ffe45c'); g.addColorStop(1, '#ff2e88');
        ctx.save(); ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = g; ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
        for (let i = 0; i < 7; i++) { const y = sy + sr * (0.05 + i * 0.14); ctx.clearRect(0, 0, 0, 0); ctx.fillStyle = '#5b1a6e'; ctx.fillRect(sx - sr, y, sr * 2, sr * 0.02 + i * sr * 0.012); }
        ctx.restore();
        const far = ridge(R, w, 128, 0.55); drawRidge(ctx, w, h, far, h * 0.58, h * 0.22, '#2a0f45');
        const near = ridge(R, w, 128, 0.5); drawRidge(ctx, w, h, near, h * 0.62, h * 0.12, '#1a0930');
        const hy = h * 0.62;
        g = ctx.createLinearGradient(0, hy, 0, h); g.addColorStop(0, '#1a0930'); g.addColorStop(1, '#05020f');
        ctx.fillStyle = g; ctx.fillRect(0, hy, w, h - hy);
        ctx.strokeStyle = '#ff3ea5'; ctx.lineWidth = Math.max(1, w / 700); ctx.shadowColor = '#ff3ea5'; ctx.shadowBlur = w / 120;
        for (let i = -24; i <= 24; i++) { ctx.beginPath(); ctx.moveTo(sx + i * w * 0.01, hy); ctx.lineTo(sx + i * w * 0.12, h); ctx.stroke(); }
        for (let i = 1; i < 16; i++) { const y = hy + (h - hy) * Math.pow(i / 15, 2.2); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
        ctx.shadowBlur = 0;
      }
    },
    {
      id: 'mountains', name: 'Горы на рассвете', tag: 'gallery', draw(ctx, w, h) {
        const R = rng(7);
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#f7c59f'); g.addColorStop(0.45, '#f3a683'); g.addColorStop(1, '#6a4c93');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        const sun = ctx.createRadialGradient(w * 0.7, h * 0.32, 0, w * 0.7, h * 0.32, h * 0.4);
        sun.addColorStop(0, 'rgba(255,250,220,1)'); sun.addColorStop(0.15, 'rgba(255,240,200,.9)'); sun.addColorStop(1, 'rgba(255,220,180,0)');
        ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
        const cols = ['#d58a94', '#a86a92', '#7b4f8c', '#523a78', '#2f2655', '#1b1636'];
        cols.forEach((c, i) => drawRidge(ctx, w, h, ridge(R, w, 256, 0.56), h * (0.42 + i * 0.1), h * (0.5 - i * 0.05), c));
        ctx.fillStyle = 'rgba(255,255,255,.7)';
        for (let i = 0; i < 9; i++) { const x = R() * w, y = h * (0.1 + R() * 0.25); ctx.fillRect(x, y, w / 250, w / 900); ctx.fillRect(x + w / 250, y - w / 900, w / 250, w / 900); }
      }
    },
    {
      id: 'glass', name: 'Витраж', tag: 'gallery', draw(ctx, w, h) {
        const R = rng(3);
        const pal = ['#e63946', '#f1c453', '#2a9d8f', '#264653', '#e76f51', '#8ecae6', '#6d597a', '#b5e48c', '#ffafcc', '#023e8a'];
        const n = 16, m = Math.round(n * h / w);
        const P = [];
        for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) {
          const edge = i === 0 || j === 0 || i === n || j === m;
          P.push([(i + (edge ? 0 : (R() - 0.5) * 0.8)) * w / n, (j + (edge ? 0 : (R() - 0.5) * 0.8)) * h / m]);
        }
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h);
        const at = (i, j) => P[j * (n + 1) + i];
        ctx.lineJoin = 'round'; ctx.lineWidth = w / 260; ctx.strokeStyle = '#141414';
        for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
          const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
          const tris = R() < 0.5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
          for (const t of tris) {
            const col = pal[(R() * pal.length) | 0];
            const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
            const g = ctx.createRadialGradient(cx - w * 0.01, cy - w * 0.01, 0, cx, cy, w / n);
            g.addColorStop(0, '#ffffffaa'); g.addColorStop(0.3, col); g.addColorStop(1, col);
            ctx.beginPath(); ctx.moveTo(...t[0]); ctx.lineTo(...t[1]); ctx.lineTo(...t[2]); ctx.closePath();
            ctx.fillStyle = g; ctx.fill(); ctx.stroke();
          }
        }
      }
    },
    {
      id: 'aurora', name: 'Северное сияние', tag: 'gallery', draw(ctx, w, h) {
        const R = rng(21);
        let g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#020814'); g.addColorStop(0.6, '#0b2a3a'); g.addColorStop(1, '#03101a');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(255,255,255,${R() * 0.9})`; const s = R() * w / 1000 + 0.5; ctx.fillRect(R() * w, R() * h * 0.6, s, s); }
        ctx.globalCompositeOperation = 'lighter';
        const bands = [['46,255,170', 0.25, 0.0], ['80,180,255', 0.33, 2.1], ['190,90,255', 0.2, 4.2]];
        for (const [rgb, base, ph] of bands) {
          for (let x = 0; x < w; x += Math.max(1, w / 900)) {
            const t = x / w;
            const y = h * (base + 0.08 * Math.sin(t * 7 + ph) + 0.04 * Math.sin(t * 19 + ph * 2));
            const len = h * (0.18 + 0.1 * Math.sin(t * 11 + ph));
            const a = 0.05 + 0.05 * Math.sin(t * 40 + ph) ** 2;
            const lg = ctx.createLinearGradient(0, y - len, 0, y + len * 0.2);
            lg.addColorStop(0, `rgba(${rgb},0)`); lg.addColorStop(0.8, `rgba(${rgb},${a})`); lg.addColorStop(1, `rgba(${rgb},0)`);
            ctx.fillStyle = lg; ctx.fillRect(x, y - len, Math.max(1, w / 900) + 1, len * 1.2);
          }
        }
        ctx.globalCompositeOperation = 'source-over';
        const lake = h * 0.74;
        drawRidge(ctx, w, h, ridge(R, w, 256, 0.6), h * 0.66, h * 0.16, '#06141c');
        g = ctx.createLinearGradient(0, lake, 0, h); g.addColorStop(0, '#0a2f3c'); g.addColorStop(1, '#020a10');
        ctx.fillStyle = g; ctx.fillRect(0, lake, w, h - lake);
        ctx.save(); ctx.globalAlpha = 0.3; ctx.translate(0, lake * 2); ctx.scale(1, -1);
        ctx.drawImage(ctx.canvas, 0, lake - h * 0.4, w, h * 0.4, 0, lake - h * 0.4, w, h * 0.4); ctx.restore();
        ctx.fillStyle = '#020a0f';
        for (let i = 0; i < 70; i++) {
          const x = R() * w, s = h * (0.04 + R() * 0.08), y = lake + h * 0.01;
          ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x - s * 0.22, y); ctx.lineTo(x + s * 0.22, y); ctx.fill();
        }
      }
    },
    {
      id: 'city', name: 'Ночной город', tag: 'gallery', draw(ctx, w, h) {
        const R = rng(5);
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#0d1b2a'); g.addColorStop(0.7, '#1b263b'); g.addColorStop(1, '#3a2f4f');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#f6f1d1'; ctx.beginPath(); ctx.arc(w * 0.2, h * 0.2, h * 0.07, 0, 7); ctx.fill();
        ctx.fillStyle = '#0d1b2a'; ctx.beginPath(); ctx.arc(w * 0.215, h * 0.19, h * 0.065, 0, 7); ctx.fill();
        const layers = [[0.55, '#22304a', 0.4], [0.68, '#172238', 0.7], [0.8, '#0b1322', 1]];
        for (const [base, col, lit] of layers) {
          let x = -10;
          while (x < w) {
            const bw = w * (0.03 + R() * 0.06), bh = h * (0.12 + R() * 0.38) * (1.2 - base * 0.6);
            const top = h * base - bh + h * 0.2;
            ctx.fillStyle = col; ctx.fillRect(x, top, bw, h - top);
            const ws = bw / 7;
            for (let wy = top + ws; wy < h - ws; wy += ws * 1.6) for (let wx = x + ws * 0.8; wx < x + bw - ws; wx += ws * 1.5) {
              if (R() < 0.35 * lit) { ctx.fillStyle = ['#ffd166', '#ffe8a3', '#9ad1ff', '#ff9f68'][(R() * 4) | 0]; ctx.fillRect(wx, wy, ws * 0.8, ws * 0.9); }
            }
            x += bw + w * 0.003;
          }
        }
      }
    },
    {
      id: 'truchet', name: 'Лабиринт дуг', tag: 'gallery', draw(ctx, w, h) {
        const R = rng(9);
        const n = 18, s = w / n, m = Math.ceil(h / s);
        const pal = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#073b4c', '#f78c6b'];
        for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
          const x = i * s, y = j * s;
          ctx.fillStyle = pal[(i * 3 + j * 5) % pal.length]; ctx.fillRect(x, y, s + 1, s + 1);
          ctx.lineWidth = s * 0.28; ctx.strokeStyle = pal[(i * 3 + j * 5 + 2) % pal.length];
          ctx.beginPath();
          if (R() < 0.5) { ctx.arc(x, y, s / 2, 0, Math.PI / 2); ctx.moveTo(x + s, y + s / 2); ctx.arc(x + s, y + s, s / 2, -Math.PI / 2, Math.PI, true); }
          else { ctx.arc(x + s, y, s / 2, Math.PI / 2, Math.PI); ctx.moveTo(x + s / 2, y + s); ctx.arc(x, y + s, s / 2, 0, -Math.PI / 2, true); }
          ctx.stroke();
        }
      }
    },
    {
      id: 'confetti', name: 'Конфетти', tag: 'gallery', draw(ctx, w, h) {
        const R = rng(13);
        ctx.fillStyle = '#fff4e6'; ctx.fillRect(0, 0, w, h);
        const pal = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff924c', '#52a675'];
        for (let i = 0; i < 1400; i++) {
          ctx.save(); ctx.translate(R() * w, R() * h); ctx.rotate(R() * 7);
          ctx.fillStyle = pal[(R() * pal.length) | 0];
          const s = w * (0.006 + R() * 0.018), k = R();
          if (k < 0.4) ctx.fillRect(-s, -s * 0.3, s * 2, s * 0.6);
          else if (k < 0.7) { ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, 7); ctx.fill(); }
          else { ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s, s); ctx.lineTo(-s, s); ctx.fill(); }
          ctx.restore();
        }
      }
    },
    {
      id: 'mandala', name: 'Мандала', tag: 'gallery', draw(ctx, w, h) {
        ctx.fillStyle = '#10243e'; ctx.fillRect(0, 0, w, h);
        const cx = w / 2, cy = h / 2, M = Math.max(w, h) * 0.62;
        const pal = ['#ffb703', '#fb8500', '#219ebc', '#8ecae6', '#e63946', '#f1faee'];
        for (let ring = 14; ring >= 1; ring--) {
          const r = M * ring / 14, k = 6 + ring * 2;
          ctx.fillStyle = pal[ring % pal.length];
          for (let i = 0; i < k; i++) {
            const a = i / k * Math.PI * 2 + ring * 0.3;
            ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
            ctx.beginPath(); ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(r * 0.35, -r * Math.PI / k * 1.3, r, 0);
            ctx.quadraticCurveTo(r * 0.35, r * Math.PI / k * 1.3, 0, 0);
            ctx.fill(); ctx.restore();
          }
          ctx.fillStyle = pal[(ring + 3) % pal.length];
          for (let i = 0; i < k; i++) { const a = (i + 0.5) / k * Math.PI * 2 + ring * 0.3; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9, r * 0.025, 0, 7); ctx.fill(); }
        }
      }
    },

    // ---------- Darklay: монолиты и безумие ----------
    { id: 'white', name: 'Белая бездна', tag: 'darklay', level: 'Монолит', draw(ctx, w, h) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); } },
    { id: 'black', name: 'Чёрная дыра', tag: 'darklay', level: 'Монолит', draw(ctx, w, h) { ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h); } },
    { id: 'grey', name: 'Бетон', tag: 'darklay', level: 'Монолит', draw(ctx, w, h) { ctx.fillStyle = '#7d7d7d'; ctx.fillRect(0, 0, w, h); } },
    {
      id: 'fog', name: 'Туман', tag: 'darklay', level: 'Почти монолит', draw(ctx, w, h) {
        const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#f4f4f4'); g.addColorStop(1, '#e4e4e4');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
    },
    {
      id: 'noise', name: 'Белый шум', tag: 'darklay', level: 'Хаос', draw(ctx, w, h) {
        const R = rng(99), img = ctx.createImageData(w, h), d = img.data;
        for (let i = 0; i < d.length; i += 4) { d[i] = R() * 256; d[i + 1] = R() * 256; d[i + 2] = R() * 256; d[i + 3] = 255; }
        ctx.putImageData(img, 0, 0);
      }
    },
    {
      id: 'sand', name: 'Песок', tag: 'darklay', level: 'Хаос', draw(ctx, w, h) {
        const R = rng(77), img = ctx.createImageData(w, h), d = img.data;
        for (let i = 0; i < d.length; i += 4) { const v = 170 + R() * 50; d[i] = v + 18; d[i + 1] = v; d[i + 2] = v - 40; d[i + 3] = 255; }
        ctx.putImageData(img, 0, 0);
      }
    },
    {
      id: 'mandel', name: 'Фрактал', tag: 'darklay', level: 'Хаос', draw(ctx, w, h) {
        const img = ctx.createImageData(w, h), d = img.data;
        const cx = -0.743643887, cy = 0.131825904, span = 0.0035, it = 400;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const x0 = cx + (x / w - 0.5) * span, y0 = cy + (y / h - 0.5) * span * h / w;
          let a = 0, b = 0, n = 0;
          while (n < it && a * a + b * b < 4) { const t = a * a - b * b + x0; b = 2 * a * b + y0; a = t; n++; }
          const k = (y * w + x) * 4;
          if (n === it) { d[k] = d[k + 1] = d[k + 2] = 0; }
          else { const t = n / 18; d[k] = 128 + 127 * Math.sin(t); d[k + 1] = 128 + 127 * Math.sin(t + 2.1); d[k + 2] = 128 + 127 * Math.sin(t + 4.2); }
          d[k + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }
    },
    {
      id: 'moire', name: 'Муар', tag: 'darklay', level: 'Хаос', draw(ctx, w, h) {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(1, w / 1400);
        const step = Math.max(3, w / 300);
        for (const [x, y] of [[w * 0.35, h * 0.45], [w * 0.62, h * 0.55]]) {
          for (let r = step; r < w * 1.2; r += step) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
        }
      }
    },
    {
      id: 'lines', name: 'Клубок', tag: 'darklay', level: 'Хаос', draw(ctx, w, h) {
        const R = rng(4);
        ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0, 0, w, h);
        ctx.lineWidth = Math.max(1, w / 1600);
        for (let i = 0; i < 4000; i++) {
          ctx.strokeStyle = `hsla(${R() * 360},90%,${45 + R() * 30}%,.7)`;
          ctx.beginPath(); ctx.moveTo(R() * w, R() * h);
          ctx.bezierCurveTo(R() * w, R() * h, R() * w, R() * h, R() * w, R() * h); ctx.stroke();
        }
      }
    },
  ];

  // Рендер в canvas заданного размера
  function render(item, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: false });
    item.draw(ctx, w, h);
    return c;
  }

  window.Gallery = { items, render };
})();
