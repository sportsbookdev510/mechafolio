// FOLIO-OS landing: gulir = scrub kamera & adegan (dua arah). Data live (harga 8 saham,
// blok Robinhood Chain) menempel langsung ke robot lewat callout, kursor bidik, dan penggaris.
import * as THREE from 'three';
import { Stage } from './stage.js';
import { loadMechAssets, Mech } from './mech.js';
import { SLOTS, CLASSES, classFor, moveMult, CHAIN } from './config.js';
import { onPrices, fmtPrice, fmtPct } from './market.js';
import { onBlock, nextDuel, hms } from './chain.js';
import { FX } from './fx.js';

const $ = s => document.querySelector(s);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = v => Math.max(0, Math.min(1, v));
const ease = t => t * t * (3 - 2 * t);
const mobile = () => innerWidth <= 820;
const finePointer = matchMedia('(pointer: fine)').matches;
const qs = new URLSearchParams(location.search);

// ---------- tema (cockpit / blueprint / broadcast) ----------
const THEMES = ['cockpit', 'blueprint', 'broadcast'];
const theme = THEMES.includes(qs.get('theme')) ? qs.get('theme') : 'cockpit';
if (qs.has('og')) document.body.classList.add('og');   // mode render gambar pratinjau link (og.jpg)
document.body.dataset.theme = theme;
const cssVar = n => getComputedStyle(document.body).getPropertyValue(n).trim();

const stage = new Stage($('#stage'));
const fx = new FX(stage.scene);
let shake = 0, powerT = 0;
const { camera } = stage;
const sections = [...document.querySelectorAll('.ch')];
const K = sections.map(s => s.dataset.k);            // nama bab menurut urutan di halaman
const is = k => K[ch] === k;
const sectorBtns = [...document.querySelectorAll('#sectors button')];

let hero = null, rival = null;
let prices = null;                         // { slots:[{ticker,price,ch24}] }
let mults = new Array(8).fill(1);
let curPart = 0;                           // bagian yang sedang ditampilkan di babak 03
let duel = null;
let sign = null;
stage.addSign('MECHAFOLIO', { color: cssVar('--wm') || '#0b1220' }).then(m => (sign = m));

// ---------- boot: angka nyata ----------
const boot = $('#boot'), bootBar = $('#bootBar');
const bootLine = (k, txt, cls) => { const li = boot.querySelector(`[data-k="${k}"]`); li.querySelector('b').textContent = txt; li.className = cls || ''; };
const t0 = performance.now();
let modelReady = false, chainSeen = false, feedSeen = false, bootDone = false;
let forceOpen = false;
setTimeout(() => { if (!bootDone) { forceOpen = true; bootLine('model', 'loading', 'warn'); tryOpen(true); } }, 3500);
function tryOpen(force) {
  if (bootDone || (!modelReady && !forceOpen)) return;
  const waited = performance.now() - t0;
  if (!force && waited < 1300) return setTimeout(tryOpen, 1300 - waited);
  if (!force && (!chainSeen || !feedSeen) && waited < 2600) return setTimeout(() => tryOpen(), 250);
  if (!chainSeen) bootLine('chain', 'standby', 'warn');
  if (!feedSeen) bootLine('feed', 'standby', 'warn');
  bootLine('ready', 'online', 'ok');
  bootDone = true;
  setTimeout(() => boot.classList.add('open'), 260);
  setTimeout(() => boot.classList.add('gone'), 1400);
}
const prog = [0, 0];
loadMechAssets((w, p) => {
  prog[w] = p;
  const v = Math.round((prog[0] * 0.85 + prog[1] * 0.15) * 100);
  bootLine('model', v + '%'); bootBar.style.width = v + '%';
}).then(assets => {
  hero = new Mech(assets);
  rival = new Mech(assets, { tint: '#e0503f' });
  rival.root.visible = false;
  stage.scene.add(hero.root, rival.root);
  bootLine('model', 'loaded', 'ok'); bootBar.style.width = '100%';
  modelReady = true; tryOpen();
}).catch(err => {
  console.error(err);
  bootLine('model', 'failed', 'warn');
  boot.querySelector('.boot-head em').textContent = 'Use a current Chrome, Safari or Firefox';
});

// ---------- status live: blok, jam UTC, hitung mundur duel ----------
onBlock(s => {
  $('#led').classList.toggle('ok', s.ok);
  $('#stBlock').textContent = s.block ? '#' + s.block.toLocaleString('en-US') : 'offline';
  if (s.ok && !chainSeen) { chainSeen = true; bootLine('chain', '#' + s.block.toLocaleString('en-US'), 'ok'); }
});
setInterval(() => {
  const d = new Date();
  $('#stClock').textContent = d.toISOString().slice(11, 19);
  $('#stDuel').textContent = hms(nextDuel());
}, 1000);

// ---------- harga live → panel instrumen, indeks bagian, callout ----------
queueMicrotask(() => onPrices(d => {
  prices = d;
  mults = SLOTS.map((s, i) => moveMult(d.slots[i]?.ch24 ?? 0));
  const n = d.slots.filter(r => r.price).length;
  if (!feedSeen) { feedSeen = true; bootLine('feed', `${n}/8 live`, n ? 'ok' : 'warn'); }
  renderDock(); renderIndex(); renderPart(curPart, true); computeDuel();
  const avg = mults.reduce((a, b) => a + b, 0) / 8;
  $('#heroPower').textContent = '×' + avg.toFixed(2);
  $('#heroPower').className = 'v mono ' + (avg > 1 ? 'up' : avg < 1 ? 'down' : '');
}));

const cls24 = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
function renderDock() {
  $('#dock').innerHTML = SLOTS.map((s, i) => {
    const r = prices?.slots[i] || {};
    return `<button class="cell${is('parts') && curPart === i ? ' on' : ''}" data-i="${i}" style="--co:${s.color}">
      <span class="ct">${s.ticker}</span><span class="cp">${s.part}</span>
      <span class="cv">${fmtPrice(r.price)}</span><span class="cc ${cls24(r.ch24)}">${fmtPct(r.ch24)}</span></button>`;
  }).join('');
}
$('#dock').addEventListener('click', e => { const b = e.target.closest('.cell'); if (b) goPart(+b.dataset.i); });

function renderIndex() {
  $('#partsList').innerHTML = SLOTS.map((s, i) => {
    const r = prices?.slots[i] || {}, m = mults[i];
    return `<li data-i="${i}" style="--co:${s.color}" class="${i === curPart ? 'on' : ''}">
      <span class="n">${String(i + 1).padStart(2, '0')}</span>
      <span class="pp"><strong>${s.part}</strong><span>${s.ticker}</span></span>
      <span class="c24 ${cls24(r.ch24)}">${fmtPct(r.ch24)}</span>
      <span class="pw">×${m.toFixed(2)}<u style="--w:${((m - 0.5) / 1) * 100}%"></u></span></li>`;
  }).join('');
}
$('#partsList').addEventListener('click', e => { const li = e.target.closest('li'); if (li) goPart(+li.dataset.i); });
function goPart(i) {
  const sec = sections[K.indexOf('parts')];
  scrollTo({ top: sec.offsetTop + (sec.offsetHeight - innerHeight) * ((i + 0.5) / 8), behavior: 'smooth' });
}

// ---------- angka live alur fee (dari Ledger server; diam saja kalau server/kontrak belum ada)
async function ledgerStats() {
  try {
    const r = await fetch('/api/ledger', { cache: 'no-store' });
    if (!r.ok) return;
    const L = await r.json();
    if (!L.totalBought) return;
    const usd = arr => arr.reduce((a, v, i) => a + (Number(BigInt(v)) / 1e18) * (prices?.slots[i]?.price || 0), 0);
    const set = (k, v) => document.querySelectorAll(`[data-stat="${k}"]`).forEach(el => (el.textContent = v));
    set('harvested', (Number(BigInt(L.totalEthIn)) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' ETH in');
    set('bought', '$' + Math.round(usd(L.totalBought)).toLocaleString('en-US') + ' bought');
    set('epoch', L.epoch && L.epoch !== '0' ? 'Epoch ' + new Date(Number(L.epoch) * 86400000).toISOString().slice(5, 10) : 'First split at 00:00 UTC');
    set('claimed', '$' + Math.round(usd(L.totalClaimed)).toLocaleString('en-US') + ' claimed');
  } catch {}
}
ledgerStats(); setInterval(ledgerStats, 30_000);

// ---------- gulir: babak aktif + progres ----------
let ch = 0, chP = 0;
const chProg = new Array(sections.length).fill(0);
function readScroll() {
  const y = scrollY, vh = innerHeight;
  sections.forEach((s, i) => {
    const top = s.offsetTop, h = s.offsetHeight;
    chProg[i] = clamp01((y - top) / Math.max(1, h - vh));
    if (y + vh * 0.5 >= top && y + vh * 0.5 < top + h) ch = i;
  });
  chP = chProg[ch];
  sections.forEach((s, i) => s.classList.toggle('on', i === ch));
  sectorBtns.forEach((b, i) => { b.classList.toggle('on', i === ch); b.querySelector('i').style.setProperty('--p', i < ch ? 1 : i === ch ? chP : 0); });
  document.body.classList.toggle('ch-dim', is('parts') || is('duel') || is('trust'));
}
addEventListener('scroll', readScroll, { passive: true });
addEventListener('resize', readScroll);
readScroll();
sectorBtns.forEach((b, i) => b.addEventListener('click', () => scrollTo({ top: sections[i].offsetTop + 2, behavior: 'smooth' })));

// menu sistem
const menu = $('#menu'), menuBtn = $('#menuBtn');
menuBtn.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; menuBtn.setAttribute('aria-expanded', open); });
menu.addEventListener('click', e => { if (e.target === menu) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', false); } });
addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', false); } });

// ---------- 02 HOLD ----------
const holdBtn = $('#holdBtn'), holdArc = $('#holdArc'), holdTxt = $('#holdTxt');
let holding = false, holdT = 0, share = 0.0001, shown = null;
const SHARE_MIN = 0.0001, SHARE_MAX = 0.015;
const setHold = on => { holding = on; holdBtn.classList.toggle('holding', on); };
holdBtn.addEventListener('pointerdown', e => { e.preventDefault(); holdBtn.setPointerCapture(e.pointerId); setHold(true); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => holdBtn.addEventListener(ev, () => setHold(false)));
holdBtn.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setHold(true); } });
holdBtn.addEventListener('keyup', () => setHold(false));
function frameScale(s) {
  const t = clamp01((Math.log10(s) - Math.log10(SHARE_MIN)) / (Math.log10(SHARE_MAX) - Math.log10(SHARE_MIN)));
  return lerp(CLASSES[0].scale, CLASSES[CLASSES.length - 1].scale, t);
}
function updateHold(dt) {
  if (holding) holdT = Math.min(1, holdT + dt / 2.6);
  share = Math.pow(10, lerp(Math.log10(SHARE_MIN), Math.log10(SHARE_MAX), ease(holdT)));
  holdArc.style.strokeDashoffset = (326.7 * (1 - holdT)).toFixed(1);
  const c = classFor(share);
  $('#holdShare').textContent = (share * 100).toFixed(share < 0.001 ? 3 : 2) + '%';
  $('#holdClass').textContent = c.name;
  $('#holdHeight').textContent = (frameScale(share) * 18).toFixed(1) + ' m';
  if (shown && shown !== c.id && is('hold')) powerT = 1;   // naik kelas: pendorong menyala + pendar penuh
  shown = c.id;
  holdTxt.textContent = holdT >= 1 ? 'Max' : holding ? 'Building' : holdT > 0 ? 'Hold' : 'Hold';
}

// ---------- 03 BAGIAN ----------
const PART_VIEW = {
  head:     { bone: 'Head',          az: 0.05,  el: 0.14,  d: 1.15 },
  reactor:  { bone: 'Spine02',       az: -0.25, el: 0.06,  d: 0.95 },
  boosters: { bone: 'Spine02',       az: 2.7,   el: 0.3,   d: 1.35 },
  armor:    { bone: 'Spine',         az: 0.6,   el: 0.0,   d: 1.0 },
  sensors:  { bone: 'RightShoulder', az: -0.9,  el: 0.25,  d: 0.95 },
  fist:     { bone: 'LeftHand',      az: 1.1,   el: 0.1,   d: 1.0 },
  cannon:   { bone: '@cannon',       az: -1.2,  el: 0.12,  d: 1.05 },
  legs:     { bone: 'LeftLeg',       az: 0.45,  el: -0.02, d: 1.45 },
};
function renderPart(i, force) {
  if (i === curPart && !force) return;
  curPart = i;
  const s = SLOTS[i], r = prices?.slots[i] || {}, m = mults[i];
  $('#specSlot').textContent = `SLOT ${String(i + 1).padStart(2, '0')}/08`;
  $('#specTick').textContent = s.ticker;
  $('#specName').textContent = s.part;
  $('#specCo').textContent = s.name + ' · tokenized on Robinhood Chain';
  $('#specPrice').textContent = fmtPrice(r.price);
  const c = $('#specCh'); c.textContent = fmtPct(r.ch24) + ' 24h'; c.className = 'mono ' + cls24(r.ch24);
  // jarum kekuatan ×0.5…×1.5, berpusat di ×1.0
  const g = $('#specGauge'), x = (m - 0.5) * 100;
  g.style.left = Math.min(50, x) + '%'; g.style.width = Math.abs(x - 50) + '%';
  $('#specRole').textContent = `${s.role} Power today ×${m.toFixed(2)}.`;
  const a = $('#specAddr'); a.textContent = s.token.slice(0, 10) + '…' + s.token.slice(-6) + ' ↗'; a.href = `${CHAIN.explorer}/token/${s.token}`;
  $('#spec').style.setProperty('--co', s.color);
  [...document.querySelectorAll('#partsList li')].forEach((li, k) => li.classList.toggle('on', k === i));
  [...document.querySelectorAll('#dock .cell')].forEach((b, k) => b.classList.toggle('on', is('parts') && k === i));
}

// ---------- callout: garis dari bagian robot ke label ----------
const svg = $('#callouts'), tagsEl = $('#tags');
const SVGNS = 'http://www.w3.org/2000/svg';
const pool = new Map();   // id → { path, dot, ring, tag }
function calloutEl(id) {
  if (pool.has(id)) return pool.get(id);
  const path = document.createElementNS(SVGNS, 'path'), dot = document.createElementNS(SVGNS, 'circle'), ring = document.createElementNS(SVGNS, 'circle');
  dot.setAttribute('r', 3); dot.classList.add('dot'); ring.classList.add('ring');
  svg.append(path, ring, dot);
  const tag = document.createElement('div'); tag.className = 'tag off'; tagsEl.append(tag);
  const o = { path, dot, ring, tag, used: false };
  pool.set(id, o);
  return o;
}
const proj = new THREE.Vector3();
function toScreen(v) {
  proj.copy(v).project(camera);
  return { x: (proj.x * 0.5 + 0.5) * innerWidth, y: (-proj.y * 0.5 + 0.5) * innerHeight, ok: proj.z < 1 && Math.abs(proj.x) < 1.2 && Math.abs(proj.y) < 1.2 };
}
// gambar satu callout: titik jangkar 3D → siku → label di (dx,dy) piksel, atau ke elemen tetap (toEl)
function drawCallout(id, world, { dx = 120, dy = -60, color, html, toEl, pulse = 0 }) {
  const o = calloutEl(id); o.used = true;
  const a = toScreen(world);
  if (!a.ok) { o.path.setAttribute('d', ''); o.dot.setAttribute('r', 0); o.ring.setAttribute('r', 0); o.tag.classList.add('off'); return; }
  const col = color || cssVar('--accent');
  [o.path, o.dot, o.ring].forEach(e => e.style.setProperty('--co', col));
  let ex, ey;
  if (toEl) {
    const r = toEl.getBoundingClientRect();
    ex = r.left; ey = Math.min(Math.max(a.y, r.top + 18), r.bottom - 18);
    if (a.x > r.left) { ex = r.right; }
    o.tag.classList.add('off');
  } else {
    ex = a.x + dx; ey = a.y + dy;
    o.tag.innerHTML = html; o.tag.style.setProperty('--co', col); o.tag.classList.remove('off');
    const w = o.tag.offsetWidth, h = o.tag.offsetHeight;
    let tx = dx > 0 ? ex : ex - w, ty = ey - h / 2;
    tx = Math.max(8, Math.min(innerWidth - w - 8, tx)); ty = Math.max(70, Math.min(innerHeight - h - 72, ty));
    o.tag.style.transform = `translate(${tx}px, ${ty}px)`;
    ex = dx > 0 ? tx : tx + w; ey = ty + h / 2;
  }
  const mx = a.x + (ex - a.x) * 0.55;
  o.path.setAttribute('d', `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${mx.toFixed(1)},${ey.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)}`);
  o.dot.setAttribute('cx', a.x); o.dot.setAttribute('cy', a.y); o.dot.setAttribute('r', 3.2);
  o.ring.setAttribute('cx', a.x); o.ring.setAttribute('cy', a.y); o.ring.setAttribute('r', 8 + pulse * 6);
}
function partTag(i, label) {
  const s = SLOTS[i], r = prices?.slots[i] || {};
  return `<div class="t1"><span>${label || s.part}</span><span>×${mults[i].toFixed(2)}</span></div><div class="t2">${s.ticker} <span>${fmtPrice(r.price)}</span><em class="${cls24(r.ch24)}">${fmtPct(r.ch24)}</em></div>`;
}
function anchor(id, mech = hero) {
  const v = PART_VIEW[id];
  if (v.bone === '@cannon') return mech.muzzle(new THREE.Vector3()).lerp(mech.cannon.getWorldPosition(new THREE.Vector3()), 0.45);
  return mech.model.getObjectByName(v.bone).getWorldPosition(new THREE.Vector3());
}
// penggaris tinggi di samping robot (babak HOLD)
let ruler = null;
function drawRuler(s) {
  if (!ruler) { ruler = document.createElementNS(SVGNS, 'g'); ruler.classList.add('ruler'); svg.append(ruler); }
  const side = new THREE.Vector3(0.55 * s, 0, 0.1);
  const b = toScreen(side), t = toScreen(side.clone().setY(s));
  const meters = s * 18;
  let html = `<line x1="${b.x}" y1="${b.y}" x2="${t.x}" y2="${t.y}"/>`;
  for (let m = 0; m <= meters + 0.01; m += 3) {
    const p = toScreen(side.clone().setY((m / 18)));
    html += `<line x1="${p.x}" y1="${p.y}" x2="${p.x + 8}" y2="${p.y}"/>`;
    if (m > 0 && m % 6 === 0) html += `<text class="tick-lbl" x="${p.x + 12}" y="${p.y + 3.5}">${m} m</text>`;
  }
  html += `<line x1="${t.x - 6}" y1="${t.y}" x2="${t.x + 22}" y2="${t.y}"/><text x="${t.x + 26}" y="${t.y + 4}">${meters.toFixed(1)} m · ${classFor(share).name.toUpperCase()}</text>`;
  ruler.innerHTML = html;
  ruler.style.display = '';
}

// ---------- kursor bidik: mengunci bagian robot yang ditunjuk ----------
const reticle = $('#reticle'), reticleTxt = $('#reticleTxt');
const pointer = { x: 0, y: 0, px: -999, py: -999, over: false };
let lockSlot = -1, lockPoint = null, lastCast = 0;
addEventListener('pointermove', e => {
  pointer.x = e.clientX / innerWidth - 0.5; pointer.y = e.clientY / innerHeight - 0.5;
  pointer.px = e.clientX; pointer.py = e.clientY;
  pointer.over = e.target === $('#stage');
});
function castLock(now) {
  if (!hero || now - lastCast < 70) return;
  lastCast = now;
  lockSlot = -1; lockPoint = null;
  if (!pointer.over || is('duel')) return;
  // murah: proyeksikan titik-titik bagian robot ke layar, kunci yang terdekat dengan kursor
  // (raycast ke SkinnedMesh menghitung ulang ribuan segitiga tiap gerak kursor = lag)
  let best = -1, bd = Infinity, bp = null;
  const lim = Math.min(innerWidth, innerHeight) * 0.075 * hero.root.scale.x * (is('parts') ? 2.2 : 1);
  for (const q of hoverPoints()) {
    const s = toScreen(q.v); if (!s.ok) continue;
    const d = Math.hypot(s.x - pointer.px, s.y - pointer.py);
    if (d < bd) { bd = d; best = q.slot; bp = q.v; }
  }
  if (bd < lim) { lockSlot = best; lockPoint = bp; }
}
const HOVER_BONES = [['head', ['Head', 'neck']], ['reactor', ['Spine02', 'Spine01']], ['armor', ['Hips', 'Spine']], ['sensors', ['LeftShoulder', 'RightShoulder']],
  ['fist', ['LeftArm', 'LeftForeArm', 'LeftHand']], ['cannon', ['RightArm', 'RightForeArm', '@cannon']], ['legs', ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']]];
let hoverObjs = null;
function hoverPoints() {
  if (!hoverObjs) {
    hoverObjs = [];
    for (const [id, bones] of HOVER_BONES) {
      const slot = SLOTS.findIndex(s => s.id === id);
      for (const b of bones) { const o = b === '@cannon' ? hero.cannon : hero.model.getObjectByName(b); if (o) hoverObjs.push({ o, slot }); }
    }
  }
  return hoverObjs.map(h => ({ v: h.o.getWorldPosition(new THREE.Vector3()), slot: h.slot }));
}
$('#stage').addEventListener('click', () => { if (lockSlot >= 0 && !is('duel')) goPart(lockSlot); });
let retX = 0, retY = 0;
function updateReticle() {
  const on = finePointer && pointer.over && !is('duel') && !!hero;
  document.body.classList.toggle('aiming', on);
  reticle.classList.toggle('on', on);
  if (!on) return;
  let tx = pointer.px, ty = pointer.py;
  if (lockSlot >= 0 && lockPoint) {
    const s = toScreen(lockPoint); tx = lerp(tx, s.x, 0.35); ty = lerp(ty, s.y, 0.35);
    const sl = SLOTS[lockSlot], r = prices?.slots[lockSlot] || {};
    reticleTxt.innerHTML = `LOCK · ${sl.part.toUpperCase()} · ${sl.ticker} <span class="${cls24(r.ch24)}">${fmtPct(r.ch24)}</span>`;
    reticle.style.setProperty('--co', sl.color);
  }
  retX = lerp(retX, tx, 0.5); retY = lerp(retY, ty, 0.5);
  reticle.style.transform = `translate(${retX}px, ${retY}px)`;
  reticle.classList.toggle('lock', lockSlot >= 0);
}

// ---------- aliran saham: partikel dari FolioEngine ke tiap bagian (babak 04) ----------
const STREAM_N = 46;
const streamGeo = new THREE.BufferGeometry();
const sPos = new Float32Array(8 * STREAM_N * 3), sCol = new Float32Array(8 * STREAM_N * 3);
SLOTS.forEach((s, i) => { const c = new THREE.Color(s.color); for (let k = 0; k < STREAM_N; k++) { const j = (i * STREAM_N + k) * 3; sCol[j] = c.r; sCol[j + 1] = c.g; sCol[j + 2] = c.b; } });
streamGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
streamGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
const streamMat = new THREE.PointsMaterial({ size: 0.034, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
const stream = new THREE.Points(streamGeo, streamMat); stream.frustumCulled = false; stage.scene.add(stream);
const engineCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.boltCore.material.map, color: 0x9ff3ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
engineCore.scale.setScalar(0.3); stage.scene.add(engineCore);
const ENGINE = new THREE.Vector3(0.95, 1.32, 0.25);
function updateStream(t, vis) {
  streamMat.opacity = lerp(streamMat.opacity, vis, 0.08);
  engineCore.material.opacity = streamMat.opacity;
  engineCore.position.copy(ENGINE); engineCore.scale.setScalar(0.32 + 0.05 * Math.sin(t * 6));
  if (streamMat.opacity < 0.01 || !hero) { stream.visible = engineCore.visible = false; return; }
  stream.visible = engineCore.visible = true;
  const ctrl = new THREE.Vector3(), p = new THREE.Vector3();
  SLOTS.forEach((s, i) => {
    const end = anchor(s.id);
    ctrl.copy(ENGINE).lerp(end, 0.5); ctrl.y += 0.35; ctrl.z += 0.25;
    for (let k = 0; k < STREAM_N; k++) {
      const u = ((t * 0.35 + k / STREAM_N + i * 0.071) % 1);
      const a = 1 - u;
      p.set(0, 0, 0).addScaledVector(ENGINE, a * a).addScaledVector(ctrl, 2 * a * u).addScaledVector(end, u * u);
      sPos.set([p.x, p.y, p.z], (i * STREAM_N + k) * 3);
    }
  });
  streamGeo.attributes.position.needsUpdate = true;
}

// ---------- 05 DUEL: data ----------
const HERO_W = new Array(8).fill(1 / 8);
const RIVAL_W = SLOTS.map(s => ({ boosters: 0.3, cannon: 0.3, reactor: 0.25, head: 0.15 }[s.id] || 0));
const GROUPS = [
  { k: 'Attack', ids: ['head', 'fist', 'cannon'] },
  { k: 'Power', ids: ['reactor'] },
  { k: 'Speed', ids: ['boosters'] },
  { k: 'Defense', ids: ['armor', 'sensors', 'legs'] },
];
function computeDuel() {
  const stat = w => GROUPS.map(g => g.ids.reduce((a, id) => { const i = SLOTS.findIndex(s => s.id === id); return a + w[i] * mults[i]; }, 0));
  const hs = stat(HERO_W), rs = stat(RIVAL_W);
  const pow = s => s[0] * 1.2 + s[1] * 0.8 + s[2] * 0.6;
  const def = s => 1 - Math.min(0.45, s[3] * 0.9);
  const hDmg = pow(hs) * def(rs) * 62, rDmg = pow(rs) * def(hs) * 62;
  duel = { hs, rs, hDmg, rDmg, heroWins: hDmg >= rDmg };
  const max = Math.max(...hs, ...rs, 0.01);
  $('#duelBars').innerHTML = `<div class="duel-row"><span class="lbl"><span>You</span><span>Today's stats</span><span>Bot</span></span></div>`
    + GROUPS.map((g, i) => `<div class="duel-row"><span class="lbl" style="justify-content:center">${g.k}</span><span>${(hs[i] * 100).toFixed(1)}</span><div class="bar"><i class="l" style="width:${hs[i] / max * 50}%"></i><i class="r" style="width:${rs[i] / max * 50}%"></i></div><span class="rv">${(rs[i] * 100).toFixed(1)}</span></div>`).join('');
}
computeDuel();

// ---------- koreografi duel MESIN (prosedural, bisa di-scrub dua arah) ----------
// Pahlawan di x=0 menghadap +X, lawan di x≈0.95 menghadap −X. Progres babak p = 0..1.
const seg = (p, a, b) => clamp01((p - a) / (b - a));
const easeIn = t => t * t;
const bump = (p, a, b) => { const t = seg(p, a, b); return t > 0 && t < 1 ? Math.sin(t * Math.PI) : 0; };
let plan = null;

function runDuel(p) {
  if (!hero || !rival || !duel) return;
  const hw = duel.heroWins, W = hw ? hero : rival, L = hw ? rival : hero;
  const hd = Math.min(100, duel.hDmg), rd = Math.min(100, duel.rDmg);
  hero.resetMotion(); rival.resetMotion();
  const H = hero.m, R = rival.m;
  H.idle = R.idle = 0.4;
  const chestH = hero.chestPos(), chestR = rival.chestPos();
  H.look = chestR; R.look = chestH;

  // 1 · lawan meluncur masuk dengan pendorong, mendarat berdebu
  const enter = seg(p, 0, 0.09);
  let rx = lerp(2.1, 0.95, 1 - (1 - enter) * (1 - enter));
  R.thrust = enter < 1 ? 1 : Math.max(0, 1 - seg(p, 0.09, 0.12) * 1.5);
  R.lean = 0.14 * (1 - enter) - 0.06 * bump(p, 0.09, 0.13);
  H.aimR = 0.25; H.aimRAt.copy(chestR);

  // 2 · voli meriam pahlawan: bidik → isi tenaga → dua tembakan
  const aim1 = seg(p, 0.12, 0.17) * (1 - seg(p, 0.34, 0.38));
  H.aimR = Math.max(H.aimR, aim1);
  H.charge = bump(p, 0.15, 0.2) + bump(p, 0.24, 0.27) * 0.7;
  H.recoil = bump(p, 0.19, 0.22) + bump(p, 0.27, 0.30);
  const hit1 = bump(p, 0.23, 0.28), hit2 = bump(p, 0.30, 0.35);
  R.lean -= 0.16 * hit1 + 0.18 * hit2;
  rx += 0.05 * seg(p, 0.23, 0.26) * (1 - seg(p, 0.26, 0.36)) + 0.06 * seg(p, 0.30, 0.33) * (1 - seg(p, 0.33, 0.40));

  // 3 · lawan menyerbu dengan pendorong dan meninju lurus
  const dash = seg(p, 0.40, 0.47), back = seg(p, 0.50, 0.58);
  rx = lerp(rx, 0.6, easeIn(dash)); rx = lerp(rx, 0.95, smoothstep(back));
  R.thrust = Math.max(R.thrust, dash > 0 && dash < 1 ? 1 : 0, back > 0 && back < 1 ? 0.6 : 0);
  R.lean += 0.22 * Math.sin(Math.min(1, dash) * Math.PI * 0.5) * (1 - back) - 0.1 * (back > 0 && back < 1 ? Math.sin(back * Math.PI) : 0);
  R.punchL = seg(p, 0.43, 0.47) * (1 - seg(p, 0.49, 0.53)); R.punchAt.copy(chestH);
  const hitP = bump(p, 0.47, 0.53);
  H.lean -= 0.26 * hitP;
  const hx = -0.13 * seg(p, 0.47, 0.5) * (1 - seg(p, 0.52, 0.62));
  H.aimR *= 1 - hitP;

  // 4 · pukulan penutup oleh PEMENANG: sinar meriam bertenaga penuh
  const Wm = W.m, Lm = L.m;
  const fin = seg(p, 0.60, 0.63) * (1 - seg(p, 0.76, 0.82));
  Wm.aimR = Math.max(Wm.aimR, fin); Wm.aimRAt.copy(L.chestPos());
  Wm.charge = Math.max(Wm.charge, seg(p, 0.62, 0.68) * (1 - seg(p, 0.73, 0.76)));
  const beam = bump(p, 0.68, 0.74);
  Wm.recoil = Math.max(Wm.recoil, beam * 0.6);
  Lm.lean -= 0.35 * seg(p, 0.68, 0.72) * (1 - seg(p, 0.76, 0.77));
  const push = 0.1 * seg(p, 0.68, 0.74);

  // 5 · KO: yang kalah roboh ke belakang (dipercepat gravitasi), memantul sedikit, debu
  const fall = easeIn(seg(p, 0.76, 0.86));
  Lm.topple = fall - 0.04 * bump(p, 0.86, 0.9);
  if (fall > 0) { Lm.idle = 0; Lm.look = null; Lm.aimR = 0; Lm.lean = 0; Lm.charge = 0; }
  // 6 · pemenang menurunkan meriam, uap pendorong, menoleh ke kamera
  const end = seg(p, 0.88, 0.95);
  if (end > 0) { Wm.aimR *= 1 - end; Wm.look = camera.position.clone(); Wm.thrust = Math.max(Wm.thrust, 0.35 * bump(p, 0.9, 0.97)); }

  rival.root.position.x = rx + (hw ? push : 0);
  hero.root.position.x = hx - (hw ? 0 : push);
  hero.root.rotation.y = Math.PI / 2 - (hw ? 0.5 * end : 0);
  rival.root.rotation.y = -Math.PI / 2 + (hw ? 0 : 0.5 * end);

  // HP & catatan
  let hpR = 100 - hd * 0.25 * (seg(p, 0.23, 0.25) + seg(p, 0.30, 0.32));
  let hpH = 100 - rd * 0.45 * seg(p, 0.47, 0.49);
  const finDmg = seg(p, 0.68, 0.74);
  if (hw) hpR = lerp(hpR, 0, finDmg); else hpH = lerp(hpH, 0, finDmg);
  let log = 'Rocket mech boosts in. Both mechs get their strength from today\'s 24h stock moves.';
  if (p > 0.12) log = `Rail Cannon volley. MSTR ${fmtPct(prices?.slots[6]?.ch24)} sets the damage.`;
  if (p > 0.38) log = `Booster rush. SPCX ${fmtPct(prices?.slots[2]?.ch24)} decides who strikes first.`;
  if (p > 0.6) log = 'Full-charge beam. Reactor (TSLA) feeds the cannon.';
  if (p > 0.76) log = hw ? 'Knockdown. The balanced mech wins with today\'s prices.' : 'Knockdown. The rocket mech wins: its stocks had the better day.';
  const hH = $('#hpH'), hR = $('#hpR');
  if (hH) hH.style.width = Math.max(0, hpH) + '%';
  if (hR) hR.style.width = Math.max(0, hpR) + '%';
  $('#duelLog').textContent = log;

  // getar kamera di setiap benturan
  shake = Math.max(hit1, hit2) * 0.5 + hitP * 0.8 + beam * 0.5 + bump(p, 0.85, 0.9) * 1.2;
  hero.hit(Math.max(hitP, hw ? 0 : beam)); rival.hit(Math.max(hit1, hit2, hw ? beam : 0));
  plan = { p, hw, W, L };
}
const smoothstep = t => t * t * (3 - 2 * t);

// efek dihitung SETELAH robot diperbarui supaya posisi moncong/dada tepat bingkai ini
function duelFX(t) {
  fx.clear();
  if (!plan) return;
  const { p, W, L } = plan;
  const mz = hero.muzzle(), rc = rival.chestPos();
  // dua proyektil pahlawan
  [[0.19, 0.23], [0.26, 0.30]].forEach(([a, b]) => {
    fx.flash(mz, seg(p, a, a + 0.025));
    fx.shot(mz, rc, seg(p, a, b));
    fx.hit(rc, seg(p, b, b + 0.05), 0.8);
  });
  // tinju lawan
  fx.hit(hero.chestPos(), seg(p, 0.47, 0.52), 1);
  fx.dustAt(rival.root.position, seg(p, 0.09, 0.15), 0.9);
  // sinar pemenang
  const wm = W.muzzle(), lc = L.chestPos();
  const bi = bump(p, 0.68, 0.74);
  // bola tenaga di moncong membesar selama pengisian, bertahan selama sinar
  const chg = seg(p, 0.62, 0.68) * (1 - seg(p, 0.74, 0.76));
  if (chg > 0) fx.flash(wm, 0.75 - 0.6 * chg, 0.12 + 0.3 * chg + 0.1 * bi);
  fx.ray(wm, lc, bi, 0.06, t);
  if (bi > 0) fx.hit(lc, 0.15 + 0.35 * ((t * 3) % 1), 1.2);
  // debu roboh
  fx.dustAt(L.root.position.clone().add(new THREE.Vector3((L === hero ? -1 : 1) * 0.45, 0, 0)), seg(p, 0.85, 0.95), 1.6);
}

// ---------- kamera per babak ----------
const PLATE_HORIZON = 0.135;   // posisi cakrawala di gambar hangar (dari bawah, 0..1)
const camPos = new THREE.Vector3(0.15, 0.07, 2.9), camLook = new THREE.Vector3(0, 0.62, 0);
let viewOff = { x: 0.1, y: 0 }, fov = 30, bgBlur = 0, bgDim = 0;

function targets() {
  const chP = chPs;   // progres yang sudah dihaluskan
  const m = mobile();
  const T = { pos: new THREE.Vector3(), look: new THREE.Vector3(), off: { x: m ? 0 : 0.1, y: 0 }, fov: 30, blur: 0, dim: 0 };
  const px = pointer.x * 0.22, py = pointer.y * 0.1;
  const s = hero ? hero.root.scale.x : 1;
  switch (K[ch]) {
    case 'title': {
      const k = ease(chP);
      T.pos.set(lerp(0.15, 0.5, k) + px, lerp(0.07, 0.16, k) - py * 0.5, lerp(2.9, 3.2, k));
      T.look.set(0, 0.62, 0);
      break;
    }
    case 'hold': {
      T.pos.set(0.45 * s + px, 0.1 - py * 0.5, 1.5 + 2.1 * s);
      T.look.set(0, 0.6 * s + 0.04, 0);
      T.fov = 32; T.off.x = m ? -0.16 : 0.12;   // HP: robot digeser kiri supaya label penggaris di kanan tidak terpotong
      break;
    }
    case 'parts': {
      const f = chP * 8, i = Math.min(7, Math.floor(f));
      renderPart(i);
      if (!hero) break;
      const v = PART_VIEW[SLOTS[i].id];
      const a = anchor(SLOTS[i].id);
      const spin = (f - i - 0.5) * 0.25;
      const az = v.az + spin, d = v.d * s * (m ? 1.35 : 1);
      T.pos.set(a.x + Math.sin(az) * Math.cos(v.el) * d, a.y + Math.sin(v.el) * d, a.z + Math.cos(az) * Math.cos(v.el) * d);
      T.look.copy(a);
      T.fov = 34; T.blur = 3.2; T.dim = theme === 'cockpit' ? 0.3 : 0.12;
      T.off.x = m ? 0 : 0.06;
      break;
    }
    case 'flow': {
      const k = ease(chP);
      T.pos.set(lerp(-0.75, -0.25, k), 0.1, lerp(2.9, 3.3, k));
      T.look.set(0.15, 0.72, 0);
      T.fov = 36; T.blur = 1.2; T.off = { x: m ? 0 : 0.06, y: m ? 0 : 0.1 };
      break;
    }
    case 'duel': {
      const ko = clamp01((chP - 0.76) / 0.14);   // ikuti yang roboh supaya tetap di bingkai
      const fx0 = 0.45 + (duel && !duel.heroWins ? -0.35 : 0.35) * ko;
      T.pos.set(fx0 + px * 0.5, 0.42 - 0.12 * ko, (m ? 3.9 : 2.85) + 0.5 * ko);
      T.look.set(fx0, 0.52 - 0.15 * ko, 0);
      T.off = { x: 0, y: m ? 0 : 0.03 };
      T.fov = 32; T.blur = 0.8;
      break;
    }
    case 'trust': {
      T.pos.set(1.1 + px, 0.25, 4.6); T.look.set(0.1, 0.75, 0);
      T.fov = 30; T.blur = 3.5; T.dim = 0.55; T.off = { x: m ? 0 : 0.28, y: m ? 0.2 : 0.12 };
      break;
    }
    case 'launch': {
      const k = ease(chP);
      T.pos.set(lerp(-0.25, 0.25, k) + px, 0.08 - py * 0.5, 3.4);
      T.look.set(0, 0.66, 0);
      T.off = { x: m ? 0 : -0.1, y: 0 };
      break;
    }
  }
  if (m) {
    const f = Math.max(1, (innerHeight / innerWidth) * 0.85);
    T.pos.sub(T.look).multiplyScalar(f).add(T.look);
    T.off.y = is('parts') ? 0.2 : is('duel') ? 0.12 : 0.24;
  }
  return T;
}

// ---------- callout per babak ----------
function drawCallouts(t) {
  for (const o of pool.values()) o.used = false;
  if (ruler) ruler.style.display = 'none';
  const m = mobile(), pulse = (Math.sin(t * 4) + 1) / 2;
  if (hero && bootDone) {
    if (is('title')) {
      const head = SLOTS.findIndex(s => s.id === 'head'), reac = SLOTS.findIndex(s => s.id === 'reactor'), can = SLOTS.findIndex(s => s.id === 'cannon');
      drawCallout('c-head', anchor('head'), { dx: m ? -130 : 150, dy: m ? -30 : -70, color: SLOTS[head].color, html: partTag(head), pulse });
      if (!m) {
        drawCallout('c-reac', anchor('reactor'), { dx: 190, dy: 30, color: SLOTS[reac].color, html: partTag(reac), pulse });
        const legs = SLOTS.findIndex(s => s.id === 'legs');
        drawCallout('c-legs', anchor('legs'), { dx: 170, dy: 40, color: SLOTS[legs].color, html: partTag(legs), pulse });
      }
    } else if (is('hold')) {
      drawRuler(hero.root.scale.x);
    } else if (is('parts')) {
      if (document.body.classList.contains('film')) drawCallout('c-spec', anchor(SLOTS[curPart].id), { dx: m ? 80 : 260, dy: -90, color: SLOTS[curPart].color, html: partTag(curPart), pulse });
      else drawCallout('c-spec', anchor(SLOTS[curPart].id), { color: SLOTS[curPart].color, toEl: $('#spec'), pulse });
    } else if (is('flow') && !m) {
      drawCallout('c-eng', ENGINE, { dx: 150, dy: -40, color: cssVar('--accent'), html: `<div class="t1"><span>FolioEngine</span><span>contract</span></div><div class="t2">fees <span>→</span> 8 stocks</div>`, pulse });
    } else if (is('launch') && !m) {
      const b = SLOTS.findIndex(s => s.id === 'boosters'), a = SLOTS.findIndex(s => s.id === 'armor');
      drawCallout('c-boost', anchor('boosters'), { dx: 170, dy: -90, color: SLOTS[b].color, html: partTag(b), pulse });
      drawCallout('c-armor', anchor('armor'), { dx: -210, dy: 20, color: SLOTS[a].color, html: partTag(a), pulse });
    }
  }
  for (const o of pool.values()) if (!o.used) { o.path.setAttribute('d', ''); o.dot.setAttribute('r', 0); o.ring.setAttribute('r', 0); o.tag.classList.add('off'); }
}

// ---------- putaran utama ----------
let lastCh = -1;
let chPs = 0, chS = -1;
stage.onUpdate((dt, t) => {
  chPs = chS !== ch ? chP : lerp(chPs, chP, 1 - Math.exp(-dt * 6)); chS = ch;
  updateHold(dt);
  if (sign) {
    const want = (is('title') || is('launch')) && !mobile() && !window.__noSign ? 0.94 : 0;
    sign.material.opacity = lerp(sign.material.opacity, want, 1 - Math.exp(-dt * 4));
    // judul: tinggi di dinding (tidak menabrak teks); HOLD & penutup: setinggi dada robot
    const m0 = is('title'), mob = mobile();
    const top = m0 || is('launch');   // judul & penutup: wordmark tinggi di dinding, di belakang kepala robot
    const sy = top ? (is('launch') ? 1.3 : 1.36) : 0.66, sx = top && !mob ? (is('launch') ? 0.05 : -0.12) : 0, ss = is('launch') ? 0.8 : 0.46;   // judul: kecil & di belakang robot, tidak menabrak judul
    const kk = sign.material.opacity < 0.05 ? 1 : 1 - Math.exp(-dt * 3);
    sign.position.y = lerp(sign.position.y, sy, kk); sign.position.x = lerp(sign.position.x, sx, kk);
    sign.scale.setScalar(lerp(sign.scale.x, ss, kk));
    sign.visible = sign.material.opacity > 0.01;
  }
  updateStream(t, is('flow') ? 1 : 0);
  if (!hero) return;

  if (ch !== lastCh) {
    if (!is('duel')) { rival.root.visible = false; hero.root.rotation.y = 0; hero.root.position.x = 0; fx.clear(); plan = null; }
    if (is('parts') || K[lastCh] === 'parts') renderDock();
    lastCh = ch;
  }

  const sTarget = is('hold') ? frameScale(share) : 1;
  hero.root.scale.setScalar(lerp(hero.root.scale.x, sTarget, 1 - Math.exp(-dt * 6)));
  powerT = Math.max(0, powerT - dt * 1.3);

  if (is('parts')) { hero.setFocus(curPart); hero.setGlow(mults.map(() => 0.2)); }
  else if (is('flow')) { hero.setFocus(-1); hero.setGlow(SLOTS.map((_, i) => 0.5 + 0.9 * Math.max(0, Math.sin(t * 2.2 - i * 0.8)))); }
  else if (lockSlot >= 0) { hero.setFocus(lockSlot); hero.setGlow(mults.map(() => 0.25)); }
  else { hero.setFocus(-1); hero.setGlow(mults.map(v => 0.25 + Math.max(0, v - 1) * 2.5 + powerT * 1.5)); }

  if (is('duel')) {
    rival.root.visible = true;
    runDuel(chPs);
  } else {
    hero.resetMotion();
    if (is('title') || is('launch')) hero.m.look = camera.position.clone();
    if (is('hold')) { hero.m.thrust = Math.max(powerT, holding ? 0.35 : 0); hero.m.charge = powerT; hero.m.lean = -0.05 * powerT; }
    if (is('flow')) { hero.m.charge = 0.25 + 0.2 * Math.sin(t * 3); }
  }

  hero.update(dt, t);
  if (rival.root.visible) rival.update(dt, t);
  if (is('duel')) duelFX(t);

  // kamera mendekat mulus ke target
  const T = targets();
  const k = 1 - Math.exp(-dt * (is('parts') ? 4 : 3));
  camPos.lerp(T.pos, k); camLook.lerp(T.look, k);
  fov = lerp(fov, T.fov, k); bgBlur = lerp(bgBlur, T.blur, k); bgDim = lerp(bgDim, T.dim, k);
  viewOff.x = lerp(viewOff.x, T.off.x, k); viewOff.y = lerp(viewOff.y, T.off.y, k);
  shake = Math.max(0, shake - dt * 3);
  camera.position.copy(camPos);
  if (shake > 0.01) camera.position.add(new THREE.Vector3(Math.sin(t * 71), Math.sin(t * 53 + 1), Math.sin(t * 61 + 2)).multiplyScalar(0.012 * shake));
  camera.lookAt(camLook);
  camera.fov = fov;
  const w = innerWidth, h = innerHeight;
  camera.setViewOffset(w, h, -viewOff.x * w, viewOff.y * h, w, h);
  camera.updateProjectionMatrix();
  // sejajarkan cakrawala lukisan dengan cakrawala 3D supaya kaki robot menapak lantai
  const fwd = new THREE.Vector3().subVectors(camLook, camPos).setY(0).normalize();
  const hz = camPos.clone().addScaledVector(fwd, 400).setY(0).project(camera).y;
  const U = stage.bgU, rr = U.uAspect.value / U.uAspectTex.value, ry = rr > 1 ? 1 / rr : 1;
  let zoom = 1.08, panY = 0;
  for (let it = 0; it < 3; it++) {
    panY = PLATE_HORIZON - 0.5 - (hz / 2) * ry / zoom;
    zoom = Math.max(1.08, (0.5 * ry) / Math.max(0.05, 0.5 + panY), (0.5 * ry) / Math.max(0.05, 0.5 - panY));
  }
  panY = PLATE_HORIZON - 0.5 - (hz / 2) * ry / zoom;
  U.uZoom.value = zoom;
  U.uPan.value.set(camPos.x * -0.02, panY);
  U.uBlur.value = bgBlur; U.uDim.value = bgDim;

  camera.updateMatrixWorld();
  castLock(performance.now());
  updateReticle();
  drawCallouts(t);
});

// halaman uji: lompat ke babak tertentu lewat ?ch=2&p=0.5
if (qs.has('ch')) {
  addEventListener('load', () => {
    const s = sections[+qs.get('ch')];
    scrollTo(0, s.offsetTop + (s.offsetHeight - innerHeight) * (+qs.get('p') || 0));
    readScroll();
  });
}
window.__mf = { stage, get hero() { return hero; }, get ch() { return ch; } };

// mode film (?film): bab & progres diatur langsung, bingkai dimajukan manual → video kit yang presisi
if (qs.has('film')) {
  stage.manual = true;
  document.body.classList.add('film');
  window.__film = {
    ready: () => !!hero && bootDone,
    set(c, p) {
      ch = c; chP = p;
      sections.forEach((s, i) => s.classList.toggle('on', i === c));
      document.body.classList.toggle('ch-dim', c === 2 || c === 4);
    },
    step(dt) { stage.tick(dt); },
    text(html) { let el = document.getElementById('filmText'); if (!el) { el = document.createElement('div'); el.id = 'filmText'; document.body.append(el); } el.innerHTML = html; },
    hold(on, t) { holding = on; if (t != null) holdT = t; },
    sign(on) { window.__noSign = !on; },
  };
  addEventListener('scroll', e => e.stopImmediatePropagation(), true);
}

// tombol "How it works" di judul → langsung ke bab cara kerja
document.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  const sec = sections[K.indexOf(a.dataset.go)];
  if (sec) scrollTo({ top: sec.offsetTop + 2, behavior: 'smooth' });
}));
