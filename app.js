'use strict';

const G = 40, COLS = 22, ROWS = 14, SUBSTEPS = 20, HIST = 8000;
const TOOLS = [
  ['select', 'בחירה'], ['wire', 'חוט'], ['dc', 'מקור מתח DC'], ['ac', 'מתח משתנה AC'],
  ['cap', 'קבל'], ['ind', 'סליל'], ['res', 'נגד'], ['del', 'מחיקה'],
];
const DEFAULTS = {
  wire: {}, dc: { value: 5 }, ac: { amp: 5, freq: 100 },
  cap: { value: 100e-6 }, ind: { value: 10e-3 }, res: { value: 10 },
};
// [field, label, scale to SI]
const FIELDS = {
  dc: [['value', 'מתח (V)', 1]],
  ac: [['amp', 'משרעת (V)', 1], ['freq', 'תדר (Hz)', 1]],
  cap: [['value', 'קיבול (µF)', 1e-6]],
  ind: [['value', 'השראות (mH)', 1e-3]],
  res: [['value', 'התנגדות (Ω)', 1]],
};

const board = document.getElementById('board');
const ctx = board.getContext('2d');
const scope = document.getElementById('scope');
const sctx = scope.getContext('2d');

let comps = [], nextId = 1, tool = 'select', selected = null, drag = null;
let sim = null, running = true, hist = { t: [], v: [], i: [] }, histOwner = null;

// ---------- helpers ----------
function si(x, unit) {
  const a = Math.abs(x);
  if (a < 1e-12) return '0 ' + unit;
  const p = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];
  for (const [f, s] of p) if (a >= f * 0.9995) return +(x / f).toPrecision(3) + ' ' + s + unit;
  return x.toExponential(1) + ' ' + unit;
}
const snap = (v, max) => Math.max(0, Math.min(max, Math.round(v / G)));
function addComp(type, x1, y1, x2, y2) {
  const c = { id: nextId++, type, x1, y1, x2, y2, ...DEFAULTS[type] };
  comps.push(c);
  topologyChanged();
  return c;
}
function topologyChanged() {
  sim = comps.some(c => c.type !== 'wire') ? new Circuit.Sim(comps) : null;
  hist = { t: [], v: [], i: [] };
}
function elemOf(c) { return sim && sim.elems.find(e => e.c === c); }
function scopeComp() {
  if (selected && selected.type !== 'wire') return selected;
  return comps.find(c => c.type !== 'wire') || null;
}

// ---------- toolbar / panel ----------
const toolsEl = document.getElementById('tools');
for (const [id, name] of TOOLS) {
  const b = document.createElement('button');
  b.textContent = name; b.dataset.tool = id;
  b.onclick = () => { tool = id; refreshTools(); };
  toolsEl.appendChild(b);
}
function refreshTools() {
  for (const b of toolsEl.children) b.classList.toggle('on', b.dataset.tool === tool);
}
function showProps() {
  const body = document.getElementById('propsBody');
  body.innerHTML = '';
  if (!selected || !FIELDS[selected.type]) { body.textContent = 'בחרו רכיב.'; return; }
  for (const [k, label, scale] of FIELDS[selected.type]) {
    const l = document.createElement('label');
    l.textContent = label + ' ';
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = 'any'; inp.value = +(selected[k] / scale).toPrecision(6);
    inp.oninput = () => {
      const v = parseFloat(inp.value) * scale;
      if (isFinite(v) && (k === 'value' && selected.type !== 'dc' ? v > 0 : true)) selected[k] = v;
    };
    l.appendChild(inp); body.appendChild(l);
  }
}
function select(c) { selected = c; hist = { t: [], v: [], i: [] }; showProps(); }

const speedEl = document.getElementById('speed');
const speedVal = () => Math.pow(10, parseFloat(speedEl.value));
speedEl.oninput = () => { document.getElementById('speedTxt').textContent = si(speedVal(), 's') + ' לשנייה'; };
speedEl.oninput();
document.getElementById('play').onclick = e => {
  running = !running; e.target.textContent = running ? '⏸ השהה' : '▶ המשך';
};
document.getElementById('reset').onclick = topologyChanged;
document.getElementById('clear').onclick = () => { comps = []; select(null); topologyChanged(); };
document.getElementById('example').onclick = () => {
  comps = []; select(null);
  const w = (...p) => addComp('wire', ...p);
  addComp('ac', 3, 4, 3, 8).amp = 5;
  w(3, 4, 5, 4); addComp('res', 5, 4, 8, 4); addComp('ind', 8, 4, 11, 4);
  addComp('cap', 11, 4, 11, 8); w(11, 8, 3, 8);
  topologyChanged();
};

// ---------- mouse ----------
function pos(ev) {
  const r = board.getBoundingClientRect();
  return [(ev.clientX - r.left) * board.width / r.width, (ev.clientY - r.top) * board.height / r.height];
}
function hit(x, y) {
  let best = null, bd = 10;
  for (const c of comps) {
    const ax = c.x1 * G, ay = c.y1 * G, bx = c.x2 * G, by = c.y2 * G;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
board.addEventListener('pointerdown', ev => {
  const [x, y] = pos(ev);
  if (tool === 'select' || tool === 'del') {
    const c = hit(x, y);
    if (tool === 'del' && c) { comps = comps.filter(k => k !== c); if (selected === c) select(null); topologyChanged(); }
    else if (tool === 'select') select(c);
  } else {
    const gx = snap(x, COLS), gy = snap(y, ROWS);
    drag = { x1: gx, y1: gy, x2: gx, y2: gy };
  }
});
board.addEventListener('pointermove', ev => {
  if (!drag) return;
  const [x, y] = pos(ev);
  drag.x2 = snap(x, COLS); drag.y2 = snap(y, ROWS);
});
window.addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.x1 !== drag.x2 || drag.y1 !== drag.y2) select(addComp(tool, drag.x1, drag.y1, drag.x2, drag.y2));
  drag = null;
});
window.addEventListener('keydown', ev => {
  if (ev.key === 'Delete' && selected && ev.target.tagName !== 'INPUT') {
    comps = comps.filter(k => k !== selected); select(null); topologyChanged();
  }
});

// ---------- drawing ----------
function drawBody(type, half) {
  ctx.beginPath();
  if (type === 'res') {
    ctx.moveTo(-half, 0);
    for (let k = 0; k < 6; k++) ctx.lineTo(-half + (k + 0.5) * half / 3, k % 2 ? 9 : -9);
    ctx.lineTo(half, 0);
  } else if (type === 'cap') {
    ctx.moveTo(-half, 0); ctx.lineTo(-6, 0); ctx.moveTo(-6, -15); ctx.lineTo(-6, 15);
    ctx.moveTo(6, -15); ctx.lineTo(6, 15); ctx.moveTo(6, 0); ctx.lineTo(half, 0);
  } else if (type === 'ind') {
    ctx.moveTo(-half, 0);
    for (let k = 0; k < 4; k++) ctx.arc(-21 + 14 * k, 0, 7, Math.PI, 0);
    ctx.moveTo(21 + 7, 0); ctx.lineTo(half, 0);
  } else if (type === 'dc') {
    ctx.moveTo(-half, 0); ctx.lineTo(-6, 0); ctx.moveTo(-6, -16); ctx.lineTo(-6, 16);
    ctx.moveTo(6, -9); ctx.lineTo(6, 9); ctx.moveTo(6, 0); ctx.lineTo(half, 0);
  } else if (type === 'ac') {
    ctx.moveTo(-half, 0); ctx.lineTo(-17, 0); ctx.moveTo(17, 0); ctx.lineTo(half, 0);
    ctx.moveTo(17, 0); ctx.arc(0, 0, 17, 0, 2 * Math.PI);
    ctx.moveTo(-10, 0);
    for (let k = -10; k <= 10; k += 2) ctx.lineTo(k, -7 * Math.sin(k * Math.PI / 10));
  }
  ctx.stroke();
}
function drawComp(c) {
  const x1 = c.x1 * G, y1 = c.y1 * G, x2 = c.x2 * G, y2 = c.y2 * G;
  const L = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.translate(x1, y1); ctx.rotate(ang);
  ctx.strokeStyle = c === selected ? '#2563eb' : '#111';
  ctx.lineWidth = c === selected ? 3 : 2;
  const half = Math.min(28, L / 2);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L / 2 - (c.type === 'wire' ? 0 : half), 0);
  ctx.moveTo(L, 0); ctx.lineTo(L / 2 + (c.type === 'wire' ? 0 : half), 0); ctx.stroke();
  if (c.type === 'wire') { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, 0); ctx.stroke(); }
  else {
    ctx.translate(L / 2, 0); drawBody(c.type, half);
    if (c.type === 'dc' || c.type === 'ac') { ctx.fillStyle = '#b91c1c'; ctx.font = 'bold 14px sans-serif'; ctx.fillText('+', -half - 4, -8); }
  }
  ctx.restore();
  if (c.type === 'wire') return;
  const e = elemOf(c), lines = [];
  if (c.type === 'dc') lines.push(si(c.value, 'V'));
  if (c.type === 'ac') lines.push(si(c.amp, 'V') + ' ~' + si(c.freq, 'Hz'));
  if (c.type === 'cap') lines.push(si(c.value, 'F'));
  if (c.type === 'ind') lines.push(si(c.value, 'H'));
  if (c.type === 'res') lines.push(si(c.value, 'Ω'));
  if (e && running !== null) lines.push('V=' + si(e.v, 'V'), 'I=' + si(e.i, 'A'));
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, vert = Math.abs(y2 - y1) > Math.abs(x2 - x1);
  ctx.fillStyle = '#374151'; ctx.font = '12px sans-serif';
  ctx.textAlign = vert ? 'left' : 'center';
  lines.forEach((s, k) => ctx.fillText(s, vert ? mx + 26 : mx, (vert ? my - 8 : my - 38) + k * 14 + (vert ? 0 : (3 - lines.length) * 14 + 14)));
  ctx.textAlign = 'left';
}
function drawBoard() {
  ctx.clearRect(0, 0, board.width, board.height);
  ctx.fillStyle = '#d1d5db';
  for (let x = 0; x <= COLS; x++) for (let y = 0; y <= ROWS; y++) ctx.fillRect(x * G - 1, y * G - 1, 2, 2);
  comps.forEach(drawComp);
  if (drag) {
    comps.push({ type: tool, x1: drag.x1, y1: drag.y1, x2: drag.x2, y2: drag.y2 });
    drawComp(comps.pop());
  }
  if (sim) {
    const vmax = Math.max(1e-9, ...sim.nv.map(Math.abs));
    const seen = new Set();
    for (const c of comps) for (const [x, y] of [[c.x1, c.y1], [c.x2, c.y2]]) {
      if (seen.has(x + ',' + y)) continue;
      seen.add(x + ',' + y);
      const n = sim.nodeOf(x, y), v = sim.nv[n] / vmax;
      ctx.fillStyle = v >= 0 ? `rgb(${Math.round(255 * (1 - v * 0.2))},${Math.round(200 * (1 - v))},${Math.round(200 * (1 - v))})`
                             : `rgb(${Math.round(200 * (1 + v))},${Math.round(200 * (1 + v))},255)`;
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x * G, y * G, 5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      if (n === sim.ground) { ctx.fillStyle = '#111'; ctx.font = '11px sans-serif'; ctx.fillText('⏚ GND', x * G + 8, y * G + 16); }
    }
  }
}

function drawScope() {
  const w = scope.width, h = scope.height;
  sctx.clearRect(0, 0, w, h);
  sctx.strokeStyle = '#e5e7eb';
  sctx.beginPath(); sctx.moveTo(0, h / 2); sctx.lineTo(w, h / 2); sctx.stroke();
  const n = hist.t.length;
  if (n < 2) return;
  const stride = Math.max(1, Math.floor(n / w));
  for (const [arr, color] of [[hist.v, '#2563eb'], [hist.i, '#ea580c']]) {
    const m = Math.max(1e-12, ...arr.map(Math.abs));
    sctx.strokeStyle = color; sctx.lineWidth = 1.5; sctx.beginPath();
    for (let k = 0; k < n; k += stride) {
      const x = k / (n - 1) * w, y = h / 2 - arr[k] / m * (h / 2 - 8);
      k ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
    }
    sctx.stroke();
    sctx.fillStyle = color; sctx.font = '11px sans-serif';
    sctx.fillText('±' + si(m, arr === hist.v ? 'V' : 'A'), arr === hist.v ? 4 : w - 70, 12);
  }
  sctx.fillStyle = '#555';
  sctx.fillText('חלון: ' + si(hist.t[n - 1] - hist.t[0], 's'), 4, h - 4);
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const sc = scopeComp();
  if (sc !== histOwner) { histOwner = sc; hist = { t: [], v: [], i: [] }; }
  if (sim && running) {
    const h = speedVal() * dt / SUBSTEPS, e = sc && elemOf(sc);
    for (let k = 0; k < SUBSTEPS; k++) {
      sim.step(h);
      if (e) { hist.t.push(sim.t); hist.v.push(e.v); hist.i.push(e.i); }
    }
    if (hist.t.length > HIST) for (const a of [hist.t, hist.v, hist.i]) a.splice(0, a.length - HIST);
  }
  document.getElementById('time').textContent = si(sim ? sim.t : 0, 's');
  document.getElementById('status').textContent =
    sim && sim.singular ? 'אזהרה: קצר או לולאת מקורות מתח/סלילים — התוצאה אינה מוגדרת.' : '';
  document.getElementById('scopeName').textContent = sc ? TOOLS.find(t => t[0] === sc.type)[1] : '—';
  drawBoard(); drawScope();
  requestAnimationFrame(frame);
}

refreshTools();
document.getElementById('example').click();
requestAnimationFrame(frame);
