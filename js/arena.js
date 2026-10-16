// Arena: putar ulang duel harian dari catatan server (setiap pukulan + HP), dengan gerak mesin
// prosedural & efek yang bisa di-scrub maju-mundur.
import * as THREE from 'three';
import { Stage } from './stage.js';
import { loadMechAssets, Mech } from './mech.js';
import { FX } from './fx.js';
import { SLOTS } from './config.js';
import { mountShell, api, fmtPct, short } from './shell.js';
import { current } from './wallet.js';

const $ = s => document.querySelector(s);
mountShell('arena');
const stage = new Stage($('#stage'));
const fx = new FX(stage.scene);
const { camera } = stage;
const mobile = () => innerWidth <= 860;
const clamp01 = v => Math.max(0, Math.min(1, v));
const seg = (p, a, b) => clamp01((p - a) / (b - a));
const bump = (p, a, b) => { const t = seg(p, a, b); return t > 0 && t < 1 ? Math.sin(t * Math.PI) : 0; };
const smooth = t => t * t * (3 - 2 * t);
const CLS = { scout: 0.62, striker: 0.74, brawler: 0.86, titan: 1, colossus: 1.16 };
const CLSN = { scout: 'Scout', striker: 'Striker', brawler: 'Brawler', titan: 'Titan', colossus: 'Colossus' };
const label = a => (a?.startsWith('house:') ? 'Moonshot bot' : short(a));

let A = null, B = null, data = null, match = null;
let T = 0, playing = false, shake = 0;
const STEP = 1.25, ENTER = 0.8, KO = 1.6;
const duration = () => (match ? ENTER + match.events.length * STEP + KO : 1);

loadMechAssets().then(a => {
  A = new Mech(a); B = new Mech(a, { tint: '#e0503f' });
  stage.scene.add(A.root, B.root);
  if (match) setupMatch();
});

// ---------------------------------------------------------------- data
async function load(day) {
  data = await api('/api/arena' + (day != null ? '?day=' + day : '')).catch(() => ({ day: null }));
  if (!data.day && data.day !== 0) { $('#plLog').textContent = 'No duels yet. The first duel runs at 20:00 UTC after launch.'; return; }
  if (data.preview && !document.querySelector('.preview-banner')) document.body.insertAdjacentHTML('beforeend', '<div class="preview-banner">Preview · sample pilots until the first real duel</div>');
  $('#daySel').innerHTML = (data.days || [data.day]).map(d => `<option value="${d}"${d === data.day ? ' selected' : ''}>${new Date(d * 86400000).toISOString().slice(0, 10)}</option>`).join('');
  renderChamps(); renderStandings(); renderMatches(); renderMoves();
  const me = current()?.address;
  const pick = data.matches.find(m => m.a === me || m.b === me) || data.matches.find(m => data.champions.some(c => c.address === m.a || c.address === m.b)) || data.matches[0];
  if (pick) select(pick);
}
$('#daySel').addEventListener('change', e => load(+e.target.value));

function renderChamps() {
  $('#champs').innerHTML = data.champions.length
    ? data.champions.map(c => `<div class="champ" data-a="${c.address}"><b>${CLSN[c.cls]}</b><span>${short(c.address)}</span><em>${c.w}W ${c.l}L</em></div>`).join('')
    : '<p class="empty">No class had two pilots yet.</p>';
  $('#champs').querySelectorAll('.champ').forEach(el => el.addEventListener('click', () => { $('#mFilter').value = el.dataset.a; renderMatches(); }));
}
function renderStandings() {
  const rows = Object.entries(data.table).map(([a, r]) => ({ a, ...r })).sort((x, y) => y.w - x.w || y.dmg - x.dmg);
  $('#stCount').textContent = rows.length + ' pilots';
  const me = current()?.address;
  $('#standings tbody').innerHTML = rows.map((r, i) => `<tr data-click data-a="${r.a}" class="${r.a === me ? 'me' : ''}"><td class="mono">${i + 1}</td><td class="mono">${short(r.a)}</td><td>${CLSN[r.cls]}</td><td class="r mono">${r.w}–${r.l}</td><td class="r mono">${r.dmg}</td></tr>`).join('');
  $('#standings tbody').querySelectorAll('tr').forEach(tr => tr.addEventListener('click', () => { $('#mFilter').value = tr.dataset.a; renderMatches(); }));
}
function renderMatches() {
  const f = $('#mFilter').value.trim().toLowerCase();
  const list = data.matches.filter(m => !f || m.a.includes(f) || m.b.includes(f));
  let html = '', last = null;
  list.forEach(m => {
    if (m.cls !== last) { html += `<li class="cls-h">${CLSN[m.cls]}</li>`; last = m.cls; }
    const idx = data.matches.indexOf(m);
    html += `<li data-i="${idx}" class="${m === match ? 'on' : ''}"><span class="${m.winner === 0 ? 'w' : 'lose'}">${label(m.a)}</span><span class="x">VS</span><span class="${m.winner === 1 ? 'w' : 'lose'}">${label(m.b)}</span></li>`;
  });
  $('#mlist').innerHTML = html || '<li class="cls-h">No matches</li>';
  $('#mlist').querySelectorAll('li[data-i]').forEach(li => li.addEventListener('click', () => select(data.matches[+li.dataset.i])));
}
$('#mFilter').addEventListener('input', renderMatches);
function renderMoves() {
  $('#moves').innerHTML = SLOTS.map((s, i) => { const v = data.ch24?.[i]; return `<div><span><i class="sw" style="--co:${s.color}"></i>${s.ticker}</span><span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${fmtPct(v)}</span></div>`; }).join('');
  $('#movesAt').textContent = data.at ? new Date(data.at).toISOString().slice(11, 16) + ' UTC' : '—';
}

function select(m) {
  match = m; T = 0; playing = true; $('#plPlay').textContent = '❚❚';
  $('#sbA').textContent = label(m.a); $('#sbB').textContent = label(m.b);
  $('#sbAc').textContent = CLSN[m.cls]; $('#sbBc').textContent = m.b.startsWith('house:') ? 'House sparring bot' : CLSN[m.cls];
  $('#sbInfo').textContent = `${m.events.length} exchanges`;
  renderMatches();
  setupMatch();
}
function setupMatch() {
  if (!A || !match) return;
  A.root.scale.setScalar(CLS[match.cls] || 1);
  B.root.scale.setScalar(CLS[match.cls] || 1);
  const pa = data.pilots.find(p => p.address === match.a), pb = data.pilots.find(p => p.address === match.b);
  A.setGlow((pa?.loadout || new Array(8).fill(1250)).map(w => 0.2 + (w / 10000) * 3));
  B.setGlow((pb?.loadout || new Array(8).fill(1250)).map(w => 0.2 + (w / 10000) * 3));
}

// ---------------------------------------------------------------- pemutar
$('#plPlay').addEventListener('click', () => { if (T >= duration()) T = 0; playing = !playing; $('#plPlay').textContent = playing ? '❚❚' : '▶'; });
$('#plSeek').addEventListener('input', e => { T = (+e.target.value / 1000) * duration(); playing = false; $('#plPlay').textContent = '▶'; });

// ---------------------------------------------------------------- koreografi dari daftar kejadian
const MOVE_TXT = { volley: 'Rail Cannon volley', rush: 'Booster rush', beam: 'Reactor beam' };
function choreo(t) {
  const ev = match.events, s = CLS[match.cls] || 1;
  A.resetMotion(); B.resetMotion();
  A.m.idle = B.m.idle = 0.4;
  const M = [A, B];
  const gap = 1.0 * s;
  let ax = -gap / 2, bx = gap / 2;
  // masuk: dua-duanya meluncur ke posisi
  const enter = seg(t, 0, ENTER);
  ax -= (1 - smooth(enter)) * 0.6; bx += (1 - smooth(enter)) * 0.6;
  A.m.thrust = B.m.thrust = enter < 1 ? 0.8 : 0;
  let hp = [match.maxHp[0], match.maxHp[1]], log = 'Frames lock on.';
  let hitAt = null, hitPow = 0;
  fx.clear();
  ev.forEach((e, k) => {
    const t0 = ENTER + k * STEP, u = (t - t0) / STEP;
    if (u >= 0.55) hp = e.hp.slice();
    if (u < 0 || u > 1) return;
    const me = M[e.by], foe = M[1 - e.by], dir = e.by === 0 ? 1 : -1;
    log = `${label(e.by === 0 ? match.a : match.b)} · ${MOVE_TXT[e.move]} · ${e.dmg} dmg`;
    me.m.look = foe.chestPos(); foe.m.look = me.chestPos();
    if (e.move === 'volley') {
      me.m.aimR = smooth(seg(u, 0, 0.2)) * (1 - seg(u, 0.8, 1)); me.m.aimRAt.copy(foe.chestPos());
      me.m.charge = bump(u, 0.12, 0.35); me.m.recoil = bump(u, 0.33, 0.45);
      hitAt = { foe, at: 0.55, pos: foe.chestPos(), shot: [me.muzzle(), 0.35, 0.55] };
    } else if (e.move === 'rush') {
      const go = smooth(seg(u, 0.08, 0.42)) * (1 - smooth(seg(u, 0.6, 0.95)));
      if (e.by === 0) ax += go * (gap - 0.42 * s); else bx -= go * (gap - 0.42 * s);
      me.m.thrust = Math.max(me.m.thrust, go > 0.02 && u < 0.6 ? 1 : 0.4 * bump(u, 0.6, 0.95));
      me.m.lean = 0.22 * go; me.m.punchL = seg(u, 0.32, 0.48) * (1 - seg(u, 0.56, 0.7)); me.m.punchAt.copy(foe.chestPos());
      hitAt = { foe, at: 0.5, pos: foe.chestPos() };
    } else {
      me.m.aimR = smooth(seg(u, 0, 0.25)) * (1 - seg(u, 0.85, 1)); me.m.aimRAt.copy(foe.chestPos());
      me.m.charge = seg(u, 0.05, 0.45) * (1 - seg(u, 0.7, 0.75)); me.m.recoil = bump(u, 0.45, 0.72) * 0.6;
      hitAt = { foe, at: 0.5, pos: foe.chestPos(), beam: [me, u] };
    }
    const hb = bump(u, hitAt.at, hitAt.at + 0.25);
    foe.m.lean -= 0.22 * hb * (e.dmg / 20 + 0.5);
    foe.hit(hb);
    hitPow = Math.max(hitPow, hb);
    // efek
    if (hitAt.shot) { fx.flash(hitAt.shot[0], seg(u, 0.33, 0.4)); fx.shot(hitAt.shot[0], hitAt.pos, seg(u, hitAt.shot[1], hitAt.shot[2])); }
    if (hitAt.beam) { const bi = bump(u, 0.45, 0.72); fx.ray(me.muzzle(), hitAt.pos, bi, 0.055 * s, t); const chg = seg(u, 0.05, 0.45) * (1 - seg(u, 0.72, 0.75)); if (chg > 0) fx.flash(me.muzzle(), 0.75 - 0.6 * chg, (0.12 + 0.28 * chg) * s); }
    fx.hit(hitAt.pos, seg(u, hitAt.at, hitAt.at + 0.25), 0.9 * s);
    void dir;
  });
  // KO
  const tEnd = ENTER + ev.length * STEP;
  const ko = seg(t, tEnd, tEnd + 1.0);
  if (ko > 0) {
    const L = M[1 - match.winner], W = M[match.winner];
    L.m.topple = ko * ko - 0.04 * bump(t, tEnd + 1.0, tEnd + 1.25); L.m.idle = 0; L.m.look = null; L.m.aimR = 0; L.m.lean = 0;
    W.m.look = camera.position.clone();
    fx.dustAt(L.root.position.clone().add(new THREE.Vector3((L === A ? -1 : 1) * 0.45 * s, 0, 0)), seg(t, tEnd + 0.85, tEnd + 1.6), 1.6 * s);
    log = `${label(match.winner === 0 ? match.a : match.b)} wins · ${hp[match.winner]} HP left`;
  }
  A.root.position.x = ax; B.root.position.x = bx;
  A.root.rotation.y = Math.PI / 2; B.root.rotation.y = -Math.PI / 2;
  shake = Math.max(shake, hitPow * 0.7 + bump(t, tEnd + 0.85, tEnd + 1.2));
  $('#hpA').style.width = (hp[0] / match.maxHp[0]) * 100 + '%';
  $('#hpB').style.width = (hp[1] / match.maxHp[1]) * 100 + '%';
  $('#plLog').textContent = log;
}

const camPos = new THREE.Vector3(0, 0.5, 3), look = new THREE.Vector3(0, 0.5, 0);
stage.onUpdate((dt, t) => {
  if (!A) return;
  if (match) {
    if (playing) { T += dt; if (T >= duration()) { T = duration(); playing = false; $('#plPlay').textContent = '↺'; } }
    const p = T / duration();
    $('#plSeek').value = Math.round(p * 1000); $('#plSeek').style.setProperty('--p', p * 100 + '%');
    choreo(T);
  } else { A.resetMotion(); B.resetMotion(); A.root.position.x = -0.55; B.root.position.x = 0.55; A.root.rotation.y = Math.PI / 2; B.root.rotation.y = -Math.PI / 2; }
  A.update(dt, t); B.update(dt, t);
  const s = A.root.scale.x, m = mobile();
  camPos.set(Math.sin(t * 0.05) * 0.35, 0.36 * s + 0.05, (m ? 5.4 : 3.7) * s + 0.3);
  look.set(0, 0.5 * s, 0);
  camera.position.lerp(camPos, 1 - Math.exp(-dt * 2));
  shake = Math.max(0, shake - dt * 3);
  if (shake > 0.01) camera.position.add(new THREE.Vector3(Math.sin(t * 71), Math.sin(t * 53 + 1), 0).multiplyScalar(0.012 * shake));
  camera.lookAt(look);
  camera.setViewOffset(innerWidth, innerHeight, 0, m ? innerHeight * 0.18 : innerHeight * 0.02, innerWidth, innerHeight);
  camera.updateProjectionMatrix();
  stage.bgU.uPan.value.set(0, -0.15); stage.bgU.uZoom.value = 1.15; stage.bgU.uBlur.value = 1.0; stage.bgU.uDim.value = 0.3;
});

load(null);
