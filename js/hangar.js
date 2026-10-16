// Hangar: robot milik pilot (ukuran = kelas frame, pendar = loadout), data pilot, klaim saham, loadout.
import * as THREE from 'three';
import { Stage } from './stage.js';
import { loadMechAssets, Mech } from './mech.js';
import { SLOTS, CHAIN } from './config.js';
import { onPrices } from './market.js';
import { mountShell, api, rpcCall, toast, fmtTok, fmtUsd, short } from './shell.js';
import { onWallet, current, signMessage, sendTx, waitReceipt, encodeClaim } from './wallet.js';

const $ = s => document.querySelector(s);
const shell = mountShell('hangar');
const stage = new Stage($('#stage'));
const { camera } = stage;
const mobile = () => innerWidth <= 860;

let hero = null, state = null, pilot = null, prices = null, viewing = null;
let loadout = new Array(8).fill(1250);

loadMechAssets().then(a => { hero = new Mech(a); stage.scene.add(hero.root); applyLook(); });
onPrices(d => { prices = d; renderParts(); });

// ---------------------------------------------------------------- 3D: putar dengan seret
let rotY = 0.35, velY = 0, dragging = false, lastX = 0, focus = -1;
const cv = $('#stage');
cv.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => { if (!dragging) return; velY = (e.clientX - lastX) * 0.008; rotY += velY; lastX = e.clientX; });
['pointerup', 'pointercancel'].forEach(ev => cv.addEventListener(ev, () => (dragging = false)));
const camPos = new THREE.Vector3(), look = new THREE.Vector3();
stage.onUpdate((dt, t) => {
  if (!hero) return;
  if (!dragging) { velY *= 0.94; rotY += velY + dt * 0.04; }
  hero.root.rotation.y = rotY;
  const s = hero.root.scale.x;
  hero.resetMotion();
  hero.m.look = camera.position.clone();
  hero.update(dt, t);
  const m = mobile();
  camPos.set(0.12, 0.12, (m ? 2.9 : 1.6) + 1.7 * s);
  look.set(0, 0.56 * s + 0.04, 0);
  camera.position.lerp(camPos, 1 - Math.exp(-dt * 3));
  camera.lookAt(look);
  camera.setViewOffset(innerWidth, innerHeight, 0, m ? innerHeight * 0.22 : 0, innerWidth, innerHeight);
  camera.updateProjectionMatrix();
  stage.bgU.uPan.value.set(0, -0.16); stage.bgU.uZoom.value = 1.15; stage.bgU.uBlur.value = 1.2; stage.bgU.uDim.value = 0.35;
});

function applyLook() {
  if (!hero) return;
  const scale = pilot?.cls?.scale || 1;
  hero.root.scale.setScalar(scale);
  hero.setFocus(focus);
  hero.setGlow(loadout.map(w => 0.15 + (w / 10000) * 3.5));
}

// ---------------------------------------------------------------- data
async function loadState() {
  state = await api('/api/state').catch(() => null);
  if (state?.mode === 'prelaunch') document.body.insertAdjacentHTML('beforeend', '<div class="preview-banner">Pre-launch · hangars open when $FOLIO goes live</div>');
}

async function view(address) {
  viewing = address ? address.toLowerCase() : null;
  const u = new URL(location.href);
  if (viewing && (!current() || current().address !== viewing)) u.searchParams.set('address', viewing); else u.searchParams.delete('address');
  history.replaceState(null, '', u);
  if (!viewing) { pilot = null; renderPilot(); renderParts(); renderLoadout(); applyLook(); return; }
  $('#pilotAddr').textContent = 'Loading…';
  try { pilot = await api('/api/pilot/' + viewing); }
  catch (e) { pilot = null; toast(e.message, 'err'); }
  loadout = pilot?.loadout?.slice() || new Array(8).fill(1250);
  renderPilot(); renderParts(); renderLoadout(); applyLook();
}

function renderPilot() {
  const mine = current() && viewing && current().address === viewing;
  $('#pilotAddr').innerHTML = viewing ? `<a class="ext" href="${CHAIN.explorer}/address/${viewing}" target="_blank" rel="noopener">${short(viewing)}</a>${mine ? ' <span class="tag-pill live">You</span>' : ''}` : '—';
  const tag = $('#pilotTag');
  if (!pilot) {
    tag.textContent = viewing ? 'Unknown' : 'No wallet'; tag.className = 'tag-pill';
    ['#kvBal', '#kvShare', '#kvRank', '#kvStreak', '#kvMin', '#kvDuel'].forEach(s => ($(s).textContent = '—'));
    $('#pilotCls').textContent = '—'; $('#pilotHeight').textContent = '—';
    $('#pilotNote').textContent = 'Connect a wallet, or paste any address to look around. Nothing here needs a transaction.';
    return;
  }
  tag.textContent = pilot.eligible ? 'Pilot' : 'Below minimum'; tag.className = 'tag-pill ' + (pilot.eligible ? 'ok' : 'warn');
  $('#pilotCls').textContent = pilot.cls.name;
  $('#pilotHeight').textContent = (pilot.cls.scale * 18).toFixed(1) + ' m frame';
  $('#kvBal').textContent = fmtTok(pilot.balance, 0);
  $('#kvShare').textContent = (pilot.share * 100).toFixed(4) + '%';
  $('#kvRank').textContent = pilot.rank ? `#${pilot.rank} of ${pilot.pilots}` : '—';
  $('#kvStreak').textContent = pilot.streak ? `${pilot.streak} day${pilot.streak > 1 ? 's' : ''}` : '0';
  $('#kvMin').textContent = fmtTok(pilot.todayMin, 0);
  const rec = pilot.duel?.record;
  $('#kvDuel').innerHTML = rec ? `${rec.w}W ${rec.l}L${pilot.duel.champion ? ' · <span style="color:#f2c230">Champion</span>' : ''}` : '—';
  $('#pilotNote').textContent = pilot.eligible
    ? 'Your share is counted on the lowest balance you hold each UTC day. Holding through the day keeps your streak.'
    : `Hold at least ${Number(state?.minHold || 1000).toLocaleString()} $FOLIO through a full UTC day to start earning.`;
}

function partRows() {
  const act = pilot?.proof?.cumulative || new Array(8).fill('0');
  const alloc = pilot?.allocated || new Array(8).fill('0');
  const claimed = pilot?.claimed || new Array(8).fill('0');
  return SLOTS.map((s, i) => {
    const a = BigInt(alloc[i]), c = BigInt(claimed[i]), live = BigInt(act[i] || 0);
    const claimable = live > c ? live - c : 0n;
    const pending = a > live ? a - live : 0n;
    const price = prices?.slots[i]?.price || 0;
    return { s, i, alloc: a, claimable, pending, usd: (Number(claimable) / 1e18) * price, worth: (Number(a) / 1e18) * price };
  });
}

function renderParts() {
  const rows = partRows();
  $('#partsTable tbody').innerHTML = rows.map(r => `<tr data-i="${r.i}" style="--co:${r.s.color}">
    <td><span class="part-cell"><strong>${r.s.part}</strong><span>${r.s.ticker}</span></span></td>
    <td class="r mono">${fmtTok(r.alloc)}${r.pending > 0n ? `<small>${fmtTok(r.pending)} pending</small>` : ''}</td>
    <td class="r mono">${fmtTok(r.claimable)}</td>
    <td class="r mono">${fmtUsd(r.worth)}</td></tr>`).join('');
  const total = rows.reduce((a, r) => a + r.usd, 0), any = rows.some(r => r.claimable > 0n);
  $('#claimUsd').textContent = fmtUsd(total);
  const btn = $('#claimBtn');
  btn.disabled = !any || !pilot?.proof?.proof;
  btn.textContent = current() && viewing && current().address !== viewing ? `Claim to ${short(viewing)}` : 'Claim stocks';
  const pr = pilot?.proof;
  const tag = $('#rootTag');
  tag.textContent = pr?.epoch ? `Epoch ${pr.epoch}` : 'No epoch yet';
  tag.className = 'tag-pill ' + (pr?.epoch ? 'live' : '');
  $('#partsTable tbody').querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('mouseenter', () => { focus = +tr.dataset.i; applyLook(); });
    tr.addEventListener('mouseleave', () => { focus = -1; applyLook(); });
  });
}

$('#claimBtn').addEventListener('click', async () => {
  const w = current();
  if (!w) return shell.openPicker();
  const pr = pilot?.proof;
  if (!pr?.proof || !state?.contracts?.distributor) return;
  const btn = $('#claimBtn');
  btn.disabled = true; btn.textContent = 'Confirm in wallet…';
  try {
    const hash = await sendTx(state.contracts.distributor, encodeClaim(viewing, pr.cumulative, pr.proof));
    btn.textContent = 'Claiming…';
    const rc = await waitReceipt(hash, rpcCall);
    if (rc.status !== '0x1') throw new Error('Claim reverted. Try again in a minute.');
    toast('Stocks claimed to ' + short(viewing), 'ok');
    await view(viewing);
  } catch (e) {
    toast(e.message || 'Claim failed', 'err');
    renderParts();
  }
});

// ---------------------------------------------------------------- loadout (persen bulat, total 100)
// basis poin → persen bulat yang totalnya pas 100 (sisa pembulatan ke pecahan terbesar)
function toPct(ws) {
  const raw = ws.map(w => w / 100), r = raw.map(Math.floor);
  let left = 100 - r.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { r[i]++; left--; } });
  return r;
}
function renderLoadout() {
  const pct = toPct(loadout);
  loadout = pct.map(p => p * 100);
  $('#ldRows').innerHTML = SLOTS.map((s, i) => `<div class="ld-row" style="--co:${s.color}">
    <label for="ld${i}">${s.part}<span>${s.ticker}</span></label>
    <input type="range" id="ld${i}" min="0" max="100" step="1" value="${pct[i]}" style="--p:${pct[i]}%">
    <output id="ldo${i}">${pct[i]}%</output></div>`).join('');
  $('#ldSum').textContent = pct.reduce((a, b) => a + b, 0) + '%';
  $('#ldRows').querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => rebalance(+inp.id.slice(2), +inp.value)));
}
// geser satu, sisanya menyesuaikan sebanding supaya total tetap 100%
function rebalance(k, v) {
  const pct = loadout.map(w => w / 100);
  const others = pct.reduce((a, b, i) => (i === k ? a : a + b), 0);
  const rest = 100 - v;
  for (let i = 0; i < 8; i++) if (i !== k) pct[i] = others > 0 ? (pct[i] / others) * rest : rest / 7;
  pct[k] = v;
  const r = pct.map(Math.floor);
  let left = 100 - r.reduce((a, b) => a + b, 0);
  pct.map((p, i) => [p - Math.floor(p), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0 && i !== k) { r[i]++; left--; } });
  loadout = r.map(p => p * 100);
  r.forEach((p, i) => { const el = $('#ld' + i); if (i !== k) el.value = p; el.style.setProperty('--p', p + '%'); $('#ldo' + i).textContent = p + '%'; });
  $('#ldSum').textContent = r.reduce((a, b) => a + b, 0) + '%';
  applyLook();
}
$('#ldEqual').addEventListener('click', () => { loadout = [13, 13, 13, 13, 12, 12, 12, 12].map(p => p * 100); renderLoadout(); applyLook(); });
$('#ldSave').addEventListener('click', async () => {
  const w = current();
  if (!w) return shell.openPicker();
  if (viewing !== w.address) return toast('You can only sign the loadout of your connected wallet.', 'err');
  const pct = toPct(loadout);
  try {
    const { message, nonce } = await api(`/api/loadout/message?address=${w.address}&pct=${pct.join(',')}`);
    const signature = await signMessage(message);
    await api('/api/loadout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: w.address, pct, nonce, signature }) });
    toast('Loadout saved. It counts from the next buy.', 'ok');
  } catch (e) { toast(e.message || 'Could not save the loadout', 'err'); }
});

// ---------------------------------------------------------------- mulai
$('#lookup').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#lookupIn').value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return toast('Paste a full 0x… wallet address.', 'err');
  view(v);
});
await loadState();
const q = new URLSearchParams(location.search).get('address');
let first = true;
onWallet(w => {
  if (first) { first = false; if (q) return view(q); }
  if (w) view(w.address); else if (!q) view(null);
});
if (!q && !current()) view(null);
renderLoadout();
