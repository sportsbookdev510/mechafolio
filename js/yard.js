// Yard: semua robot pilot di satu lapangan. Robot dipanggang (pose diam) jadi geometri statis,
// lalu digambar sebagai InstancedMesh — satu panggilan GPU untuk puluhan robot.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Stage } from './stage.js';
import { loadMechAssets, Mech, lowSpec } from './mech.js';
import { SLOTS } from './config.js';
import { mountShell, api, short } from './shell.js';
import { current } from './wallet.js';

const $ = s => document.querySelector(s);
mountShell('yard');
const stage = new Stage($('#stage'), { reflect: false });
const { camera, scene } = stage;
const CLSN = { scout: 'Scout', striker: 'Striker', brawler: 'Brawler', titan: 'Titan', colossus: 'Colossus' };
const MAX = lowSpec() ? 40 : 120;

// lantai lapangan lebih luas: perbesar kamera bayangan matahari
Object.assign(stage.sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, far: 30 });
stage.sun.position.set(6, 9, 4);
stage.sun.intensity = 1.6;
stage.sun.shadow.camera.updateProjectionMatrix();
if (stage.contact) stage.contact.visible = false;
// lapangan 3D sungguhan (bukan lukisan latar): lantai beton gelap bergaris, kabut, lampu sorot
stage.bgMesh.visible = false;
scene.background = new THREE.Color('#0a1120');
scene.fog = new THREE.Fog('#0a1120', 9, 26);
{
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#1a2233'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2400; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; x.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  x.strokeStyle = 'rgba(130,196,255,.16)'; x.lineWidth = 2; x.strokeRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(24, 24); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.15 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; floor.receiveShadow = true; scene.add(floor);
  // garis bahaya kuning melingkari lapangan
  const ring = new THREE.Mesh(new THREE.RingGeometry(12.4, 12.6, 96), new THREE.MeshBasicMaterial({ color: '#f2c230', transparent: true, opacity: 0.5 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.001, -4); scene.add(ring);
  for (const [x2, z2] of [[-7, 2], [7, 2], [-9, -9], [9, -9]]) {
    const L = new THREE.SpotLight('#cfe3ff', 14, 24, 0.55, 0.6, 1.2); L.position.set(x2, 9, z2); L.target.position.set(0, 0, -3); scene.add(L, L.target);
  }
}

const controls = new OrbitControls(camera, $('#stage'));
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 2.5; controls.maxDistance = 14; controls.maxPolarAngle = 1.45; controls.minPolarAngle = 0.35;
controls.target.set(0, 0.55, -1.8);
camera.position.set(0, 3.3, 8.8);

let pilots = [], body = null, cannon = null, layout = [], filter = 'all', selected = -1;

// ---------------------------------------------------------------- panggang robot jadi geometri statis
function bake(mech) {
  mech.update(0, 0);
  mech.root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(mech.root.matrixWorld).invert();
  const out = [];
  mech.root.traverse(o => {
    if (!o.isMesh || o.isPoints) return;
    if (!o.geometry.getAttribute('uv')) return;
    const g = o.geometry, n = g.attributes.position.count, pos = new Float32Array(n * 3), v = new THREE.Vector3();
    const M = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(g.attributes.position, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
      v.applyMatrix4(M);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ng.setAttribute('uv', g.attributes.uv);
    if (g.getAttribute('aSlot')) ng.setAttribute('aSlot', g.getAttribute('aSlot'));
    if (g.index) ng.setIndex(g.index);
    ng.computeVertexNormals();
    out.push({ geo: ng, mat: o.material });
  });
  return out;
}

// ---------------------------------------------------------------- tata letak: busur bertingkat, peringkat 1 di depan tengah
function arrange(n) {
  const L = [];
  let row = 0, i = 0;
  while (i < n) {
    const k = 3 + row * 2, R = 2.6 + row * 1.9, spread = Math.min(1.2, 0.62 + row * 0.1);
    for (let j = 0; j < k && i < n; j++, i++) {
      const a = k === 1 ? 0 : -spread + (2 * spread * j) / (k - 1);
      const order = j % 2 ? Math.ceil(j / 2) : -Math.ceil(j / 2);
      void order;
      L.push({ x: Math.sin(a) * R, z: -Math.cos(a) * R + 1.5, rot: -a * 0.85 });
    }
    row++;
  }
  // peringkat lebih tinggi di tengah tiap baris
  return L;
}

const dummy = new THREE.Object3D(), col = new THREE.Color();
function placeInstances() {
  const me = current()?.address;
  pilots.forEach((p, i) => {
    const L = layout[i];
    dummy.position.set(L.x, 0, L.z); dummy.rotation.set(0, L.rot, 0); dummy.scale.setScalar(p.scale);
    dummy.updateMatrix();
    body.setMatrixAt(i, dummy.matrix); cannon.setMatrixAt(i, dummy.matrix);
    const dim = filter !== 'all' && p.cls !== filter;
    col.set(i === selected ? '#9ff3ff' : p.address === me ? '#cfe6ff' : '#ffffff');
    if (dim) col.multiplyScalar(0.28);
    body.setColorAt(i, col); cannon.setColorAt(i, col);
  });
  body.instanceMatrix.needsUpdate = cannon.instanceMatrix.needsUpdate = true;
  body.instanceColor.needsUpdate = cannon.instanceColor.needsUpdate = true;
  body.count = cannon.count = pilots.length;
}

// ---------------------------------------------------------------- data
const PREVIEW = () => {
  const cls = ['colossus', 'titan', 'titan', 'brawler', 'brawler', 'brawler', 'striker', 'striker', 'striker', 'striker'];
  const sc = { scout: 0.62, striker: 0.74, brawler: 0.86, titan: 1, colossus: 1.16 };
  return Array.from({ length: 34 }, (_, i) => {
    const c = cls[i] || 'scout';
    const addr = '0x' + Array.from({ length: 40 }, (_, k) => '0123456789abcdef'[(i * 7 + k * 13 + (k * i) % 11) % 16]).join('');
    return { rank: i + 1, address: addr, share: 0.012 / (i + 1), cls: c, scale: sc[c], loadout: new Array(8).fill(1250), streak: (i * 3) % 9, record: { w: 3 - (i % 4), l: i % 4 } };
  });
};

const [assets, yard] = await Promise.all([loadMechAssets(), api('/api/yard').catch(() => ({ pilots: [] }))]);
let preview = false;
pilots = (yard.pilots || []).slice(0, MAX);
if (!pilots.length) { pilots = PREVIEW(); preview = true; document.body.insertAdjacentHTML('beforeend', '<div class="preview-banner">Preview · sample pilots until launch</div>'); }
$('#ydCount').textContent = preview ? 'Sample pilots shown until $FOLIO launches.' : `${yard.total} pilot${yard.total === 1 ? '' : 's'} holding at least the minimum. Height = share of supply.`;

const mech = new Mech(assets);
mech.setGlow(new Array(8).fill(0.35));
const parts = bake(mech);
// tubuh = mesh pertama berpenanda slot, meriam = sisanya
const bodyPart = parts.find(p => p.geo.getAttribute('aSlot')) || parts[0];
const canPart = parts.find(p => p !== bodyPart) || parts[0];
body = new THREE.InstancedMesh(bodyPart.geo, bodyPart.mat, MAX);
cannon = new THREE.InstancedMesh(canPart.geo, canPart.mat, MAX);
for (const m of [body, cannon]) { m.castShadow = true; m.receiveShadow = true; m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3); m.frustumCulled = false; scene.add(m); }
layout = arrange(pilots.length);
placeInstances();
renderBoard();

// ---------------------------------------------------------------- label & interaksi
const labels = $('#labels');
const tags = pilots.slice(0, 12).map((p, i) => i);
function drawLabels() {
  const me = current()?.address, idx = new Set(tags);
  pilots.forEach((p, i) => { if (p.address === me || i === selected) idx.add(i); });
  let html = '';
  const v = new THREE.Vector3();
  for (const i of idx) {
    const L = layout[i], p = pilots[i];
    v.set(L.x, p.scale * 1.06, L.z).project(camera);
    if (v.z > 1) continue;
    const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
    html += `<div class="ylabel${p.address === me ? ' me' : ''}" style="left:${x}px;top:${y}px"><b>#${p.rank}</b>${short(p.address)}</div>`;
  }
  labels.innerHTML = html;
}

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
$('#stage').addEventListener('pointerdown', e => (downAt = [e.clientX, e.clientY]));
$('#stage').addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(body, false)[0];
  select(hit ? hit.instanceId : -1);
});

function select(i, fly) {
  selected = i;
  placeInstances();
  const card = $('#card');
  if (i < 0) { card.hidden = true; return; }
  const p = pilots[i];
  card.hidden = false;
  $('#cdAddr').textContent = short(p.address);
  $('#cdCls').textContent = CLSN[p.cls];
  $('#cdRank').textContent = '#' + p.rank;
  $('#cdShare').textContent = (p.share * 100).toFixed(4) + '%';
  $('#cdH').textContent = (p.scale * 18).toFixed(1) + ' m';
  $('#cdRec').textContent = p.record ? `${p.record.w}W ${p.record.l}L` : '—';
  $('#cdLoad').innerHTML = SLOTS.map((s, k) => `<div style="--co:${s.color}"><span>${s.ticker} ${Math.round(p.loadout[k] / 100)}%</span><div class="bar"><i style="width:${Math.min(100, p.loadout[k] / 40)}%"></i></div></div>`).join('');
  $('#cdGo').href = '/hangar?address=' + p.address;
  if (fly) { const L = layout[i]; controls.target.set(L.x, 0.5 * p.scale, L.z); }
  [...document.querySelectorAll('#rank tbody tr')].forEach(tr => tr.classList.toggle('me', +tr.dataset.i === i));
}

function renderBoard() {
  const tabs = ['all', 'colossus', 'titan', 'brawler', 'striker', 'scout'];
  $('#clsTabs').innerHTML = tabs.map(t => `<button data-c="${t}" class="${t === filter ? 'on' : ''}">${t === 'all' ? 'All' : CLSN[t]}</button>`).join('');
  $('#clsTabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { filter = b.dataset.c; renderBoard(); placeInstances(); }));
  const me = current()?.address;
  $('#rank tbody').innerHTML = pilots.map((p, i) => ({ p, i })).filter(({ p }) => filter === 'all' || p.cls === filter).map(({ p, i }) =>
    `<tr data-click data-i="${i}" class="${p.address === me || i === selected ? 'me' : ''}"><td class="mono">${p.rank}</td><td class="mono">${short(p.address)}</td><td>${CLSN[p.cls]}</td><td class="r mono">${(p.share * 100).toFixed(3)}%</td><td class="r mono">${p.streak}d</td><td class="r mono">${p.record ? p.record.w + '–' + p.record.l : '—'}</td></tr>`).join('');
  $('#rank tbody').querySelectorAll('tr').forEach(tr => tr.addEventListener('click', () => select(+tr.dataset.i, true)));
}
$('#find').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('#findIn').value.trim().toLowerCase();
  const i = pilots.findIndex(p => p.address.includes(q));
  if (i >= 0) select(i, true);
});

stage.onUpdate((dt, t) => {
  controls.update();
  const w = innerWidth, h = innerHeight;
  camera.setViewOffset(w, h, w > 860 ? w * 0.06 : 0, w > 860 ? 0 : h * 0.12, w, h);
  camera.updateProjectionMatrix();
  for (const m of mech.materials) m.userData.u.uTime.value = t;
  drawLabels();
});
