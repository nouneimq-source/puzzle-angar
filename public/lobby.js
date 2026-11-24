// Лобби: выбор картинки, количество кусочков, создание комнаты, список комнат
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString('ru-RU');
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  // ---------- имя ----------
  const ANIMALS = ['Енот', 'Барсук', 'Лис', 'Сова', 'Кот', 'Ёж', 'Выдра', 'Пингвин', 'Панда', 'Капибара', 'Хомяк', 'Лемур'];
  let nick = store.get('pa_name');
  if (!nick) { nick = ANIMALS[(Math.random() * ANIMALS.length) | 0] + '-' + (10 + ((Math.random() * 90) | 0)); store.set('pa_name', nick); }
  $('nick').value = nick;
  $('nick').addEventListener('change', () => { const v = $('nick').value.trim(); if (v) store.set('pa_name', v); });

  // ---------- выбор источника ----------
  let source = null; // { kind, name, aspect, draw(w,h)->canvas, maxSide }
  let count = 500;

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', x === t));
    document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== t.dataset.tab; });
  }));

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) { $('create-hint').textContent = 'Это не картинка. Подойдут JPG, PNG или WebP.'; return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const base = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Моя картинка';
      setSource({
        kind: 'upload', name: base, aspect: img.naturalWidth / img.naturalHeight, srcW: img.naturalWidth, srcH: img.naturalHeight,
        draw(w, h) { // центрированная обрезка под пропорции сетки
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
          const a = w / h, ia = img.naturalWidth / img.naturalHeight;
          let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
          if (ia > a) { sw = sh * a; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / a; sy = (img.naturalHeight - sh) / 2; }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
          return c;
        }
      });
    };
    img.onerror = () => { $('create-hint').textContent = 'Не получилось открыть картинку. Попробуй другой файл.'; };
    img.src = url;
  }
  $('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  document.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { document.querySelector('[data-tab=upload]').click(); loadFile(f); }
  });

  function buildTiles(tag, el) {
    for (const item of Gallery.items.filter((i) => i.tag === tag)) {
      const b = document.createElement('button');
      b.className = 'tile'; b.type = 'button'; b.setAttribute('aria-pressed', 'false');
      const c = Gallery.render(item, 240, 160);
      b.appendChild(c);
      const s = document.createElement('span'); s.textContent = item.name; b.appendChild(s);
      if (item.level) { const i = document.createElement('i'); i.textContent = item.level; b.appendChild(i); }
      b.addEventListener('click', () => {
        document.querySelectorAll('.tile').forEach((t) => t.setAttribute('aria-pressed', t === b));
        setSource({ kind: tag, name: item.name, aspect: 3 / 2, maxSide: item.id === 'mandel' ? 2400 : (item.id === 'noise' || item.id === 'sand' ? 3600 : 6144), draw: (w, h) => Gallery.render(item, w, h) });
      });
      el.appendChild(b);
    }
  }
  // плитки рисуем после первой отрисовки страницы
  requestAnimationFrame(() => setTimeout(() => { buildTiles('gallery', $('tiles-gallery')); buildTiles('darklay', $('tiles-darklay')); }, 30));

  function setSource(s) {
    source = s;
    if (!$('room-name').dataset.touched) $('room-name').value = s.name;
    $('create').disabled = false;
    $('create-hint').textContent = s.kind === 'darklay' ? 'Darklay. Удачи, она понадобится.' : 'Готово. Создай комнату и отправь ссылку друзьям.';
    update();
  }
  $('room-name').addEventListener('input', () => { $('room-name').dataset.touched = '1'; });

  // ---------- количество кусочков ----------
  const MIN = 6, MAX = 100000;
  const toCount = (v) => Math.round(MIN * Math.pow(MAX / MIN, v / 1000));
  const toRange = (n) => Math.round(1000 * Math.log(n / MIN) / Math.log(MAX / MIN));
  const PRESETS = [6, 24, 100, 300, 500, 1000, 2000, 5000, 10000, 50000, 100000];
  for (const p of PRESETS) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = fmt(p); b.dataset.n = p;
    b.addEventListener('click', () => { count = p; $('count-range').value = toRange(p); update(); });
    $('presets').appendChild(b);
  }
  $('count-range').value = toRange(count);
  $('count-range').addEventListener('input', (e) => { count = toCount(+e.target.value); update(); });

  function targetSide(n) { return n <= 2000 ? 3072 : n <= 20000 ? 4096 : 6144; }

  let previewImg = null, previewKey = '';
  function update() {
    const aspect = source ? source.aspect : 3 / 2;
    const g = PG.gridFor(count, aspect);
    $('count-big').innerHTML = '';
    $('count-big').append(fmt(g.count));
    const small = document.createElement('small'); small.textContent = 'шт.'; $('count-big').append(small);
    document.querySelectorAll('#presets button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.n === count));
    $('grid-label').textContent = `${g.cols} × ${g.rows}`;
    const hours = g.count < 60 ? 'пара минут' : g.count < 300 ? 'минут 15–30' : g.count < 1500 ? 'вечер' : g.count < 10000 ? 'несколько вечеров' : g.count < 40000 ? 'пара недель всей компанией' : 'это уже легенда';
    const hint = $('count-hint');
    hint.className = 'hint' + (g.count > 20000 ? ' warn' : '');
    hint.textContent = (g.count > 20000 ? 'Огромный пазл: лучше собирать с компьютера. ' : '') + 'Время сборки: ' + hours + '.';
    let side = targetSide(g.count);
    if (source && source.srcW) side = Math.min(side, Math.max(source.srcW, source.srcH));
    if (source && source.maxSide) side = Math.min(side, source.maxSide);
    const px = Math.round(side / Math.max(g.cols, g.rows));
    $('foot-left').textContent = source ? `кусочек ≈ ${px} px` : '—';
    $('foot-right').textContent = source ? (px < 12 ? 'кусочки мелкие: картинка станет мозаикой' : '') : '';
    drawPreview(g);
  }

  function drawPreview(g) {
    if (!source) return;
    const cv = $('preview');
    const box = $('stage').getBoundingClientRect();
    const maxW = Math.max(200, box.width - 44), maxH = 460;
    let w = maxW, h = w * g.rows / g.cols;
    if (h > maxH) { h = maxH; w = h * g.cols / g.rows; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const key = source.name + source.kind + cv.width + 'x' + cv.height;
    if (key !== previewKey) { previewImg = source.draw(cv.width, cv.height); previewKey = key; }
    const ctx = cv.getContext('2d');
    ctx.drawImage(previewImg, 0, 0);
    const S = cv.width / g.cols;
    ctx.lineWidth = Math.max(0.6, Math.min(2, S / 30)) * dpr * 0.8;
    if (g.count <= 4000) {
      const E = PG.makeEdges(g.cols, g.rows, 12345);
      ctx.beginPath();
      for (let p = 0; p < g.count; p++) PG.piecePath(ctx, E, p, (p % g.cols) * S, ((p / g.cols) | 0) * S, S);
      ctx.strokeStyle = '#0009'; ctx.stroke();
      ctx.strokeStyle = '#fff6'; ctx.lineWidth *= 0.5; ctx.stroke();
    } else {
      ctx.strokeStyle = '#0000004d'; ctx.beginPath();
      for (let c = 1; c < g.cols; c++) { ctx.moveTo(c * S, 0); ctx.lineTo(c * S, cv.height); }
      for (let r = 1; r < g.rows; r++) { ctx.moveTo(0, r * S); ctx.lineTo(cv.width, r * S); }
      ctx.stroke();
    }
    cv.hidden = false; $('preview-empty').hidden = true;
  }
  let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(update, 120); });

  // ---------- создание комнаты ----------
  $('create').addEventListener('click', async () => {
    if (!source) return;
    const g = PG.gridFor(count, source.aspect);
    let side = targetSide(g.count);
    if (source.srcW) side = Math.min(side, Math.max(source.srcW, source.srcH));
    if (source.maxSide) side = Math.min(side, source.maxSide);
    const W = g.cols >= g.rows ? side : Math.round(side * g.cols / g.rows);
    const H = g.cols >= g.rows ? Math.round(side * g.rows / g.cols) : side;
    $('busy').hidden = false; $('busy-text').textContent = 'Режем картинку…';
    await new Promise((r) => setTimeout(r, 50));
    try {
      const full = source.draw(W, H);
      const image = full.toDataURL('image/jpeg', 0.9);
      const tw = 480, th = Math.round(480 * H / W);
      const t = document.createElement('canvas'); t.width = tw; t.height = th;
      t.getContext('2d').drawImage(full, 0, 0, tw, th);
      const thumb = t.toDataURL('image/jpeg', 0.8);
      $('busy-text').textContent = 'Загружаем в ангар…';
      const res = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('room-name').value.trim() || source.name, cols: g.cols, rows: g.rows, image, thumb, kind: source.kind }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      location.href = '/r/' + data.id;
    } catch (e) {
      $('busy').hidden = true;
      $('create-hint').textContent = 'Не удалось создать комнату: ' + e.message;
    }
  });

  // ---------- список комнат ----------
  function roomCard(r) {
    const el = document.createElement('article'); el.className = 'room';
    const th = document.createElement('div'); th.className = 'thumb'; th.style.backgroundImage = `url(/img/${r.thumb})`;
    const badge = document.createElement('div'); badge.className = 'badge';
    const addB = (txt, cls) => { const s = document.createElement('span'); s.textContent = txt; if (cls) s.className = cls; badge.appendChild(s); };
    if (r.online) addB(`● ${r.online} в ангаре`, 'live');
    if (r.completedAt) addB('Собран', 'done');
    if (r.kind === 'darklay') addB('Darklay');
    th.appendChild(badge); el.appendChild(th);
    const info = document.createElement('div'); info.className = 'info';
    const h = document.createElement('h3'); h.textContent = r.name; info.appendChild(h);
    const meta = document.createElement('div'); meta.className = 'meta';
    const a = document.createElement('span'); a.textContent = `${fmt(r.pieces)} кусочков`;
    const b = document.createElement('span'); b.textContent = `${Math.floor(r.progress * 100)}%`;
    meta.append(a, b); info.appendChild(meta);
    const bar = document.createElement('div'); bar.className = 'bar'; const bi = document.createElement('i'); bi.style.width = (r.progress * 100) + '%'; bar.appendChild(bi); info.appendChild(bar);
    const acts = document.createElement('div'); acts.className = 'acts';
    const go = document.createElement('a'); go.className = 'btn primary'; go.href = '/r/' + r.id; go.textContent = r.completedAt ? 'Посмотреть' : 'Собирать';
    const del = document.createElement('button'); del.className = 'btn ghost danger'; del.textContent = 'Удалить';
    let armed = null;
    del.addEventListener('click', async () => {
      if (!armed) { del.textContent = 'Точно?'; armed = setTimeout(() => { armed = null; del.textContent = 'Удалить'; }, 3000); return; }
      clearTimeout(armed);
      await fetch('/api/rooms/' + r.id, { method: 'DELETE' });
      loadRooms();
    });
    acts.append(go, del); info.appendChild(acts);
    el.appendChild(info);
    return el;
  }
  async function loadRooms() {
    try {
      const list = await (await fetch('/api/rooms')).json();
      const box = $('rooms'); box.innerHTML = '';
      if (!list.length) { const e = document.createElement('div'); e.className = 'empty-rooms'; e.textContent = 'Пока пусто. Создай первую комнату выше.'; box.appendChild(e); return; }
      for (const r of list) box.appendChild(roomCard(r));
    } catch (e) {}
  }
  loadRooms(); setInterval(loadRooms, 10000);

  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const m = /([a-f0-9]{8})\/?$/.exec($('join-code').value.trim());
    if (m) location.href = '/r/' + m[1];
    else $('join-code').value = '';
  });

  update();
})();
