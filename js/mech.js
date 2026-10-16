// Robot MECHAFOLIO: model Meshy ber-rig + lapisan gerak MESIN prosedural.
// Klip Meshy adalah gerakan manusia (tinju, koboi, tepuk dada) dan terlihat konyol pada robot 18 m,
// jadi tubuh memakai satu pose dasar yang dibekukan, lalu semua gerak (bidik, tinju, condong,
// terhuyung, roboh, kepala servo, napas hidrolik) dihitung sendiri tiap frame.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SLOTS } from './config.js';

const BASE = new URL('../assets/models/', import.meta.url).href;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let cache = null;

// HP / layar kecil memakai tekstur 1024; sisanya 2048
export const lowSpec = () => matchMedia('(max-width: 820px)').matches || (navigator.hardwareConcurrency || 8) <= 4;

export function loadMechAssets(onProgress) {
  if (cache) return cache;
  const file = lowSpec() ? 'mech-lo.glb' : 'mech-hi.glb';
  const get = (url, w) => new Promise((res, rej) => loader.load(url, res, e => onProgress?.(w, e.total ? e.loaded / e.total : 0), rej));
  cache = Promise.all([get(BASE + file, 0), get(BASE + 'part-cannon.glb', 1)]).then(([body, cannon]) => {
    prepareSlots(body.scene);
    return { body, cannon };
  });
  return cache;
}

const BOOST = SLOTS.findIndex(s => s.back);

// Tandai tiap titik mesh dengan nomor slot dari tulang dominannya (sekali per geometri),
// dan kunci ransel pendorong KAKU ke tulang dada (rig otomatis membuatnya ikut berayun bersama bahu).
function prepareSlots(root) {
  const boneSlot = new Map();
  SLOTS.forEach((s, i) => s.bones.forEach(b => boneSlot.set(b, i)));
  root.traverse(o => {
    if (!o.isSkinnedMesh || o.geometry.getAttribute('aSlot')) return;
    const g = o.geometry, si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight'), pos = g.getAttribute('position');
    const bones = o.skeleton.bones.map(b => b.name);
    const chest = bones.indexOf('Spine02');
    g.computeBoundingBox();
    const bb = g.boundingBox, zMid = (bb.min.z + bb.max.z) / 2, depth = bb.max.z - bb.min.z, h = bb.max.y - bb.min.y;
    const halfW = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x));
    const out = new Float32Array(pos.count);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      let slot = boneSlot.get(bones[best]) ?? 3;
      // lengan bawah + tangan kanan diganti meriam → ditandai 8 (dibuang di shader)
      if (bones[best] === 'RightForeArm' || bones[best] === 'RightHand') { out[i] = 8; continue; }
      v.fromBufferAttribute(pos, i);
      // ransel pendorong: titik di belakang badan atas, tidak jauh dari garis tengah
      if (v.z < zMid - depth * 0.08 && v.y > bb.min.y + h * 0.42 && Math.abs(v.x) < halfW * 0.5) {
        slot = BOOST;
        if (chest >= 0) { si.setXYZW(i, chest, 0, 0, 0); sw.setXYZW(i, 1, 0, 0, 0); }
      }
      out[i] = slot;
    }
    si.needsUpdate = sw.needsUpdate = true;
    // segitiga di sambungan ransel↔bahu (sebagian titik kaku ke dada, sebagian ikut lengan)
    // akan melar seperti jubah saat lengan membidik → dilipat jadi segitiga nol
    const idx = g.index;
    if (idx) {
      const a = idx.array;
      for (let k = 0; k < a.length; k += 3) {
        const b0 = out[a[k]] === BOOST, b1 = out[a[k + 1]] === BOOST, b2 = out[a[k + 2]] === BOOST;
        if ((b0 || b1 || b2) && !(b0 && b1 && b2)) { a[k + 1] = a[k]; a[k + 2] = a[k]; }
      }
      idx.needsUpdate = true;
    }
    g.setAttribute('aSlot', new THREE.BufferAttribute(out, 1));
  });
}

// Sisipkan pendar per slot ke MeshStandardMaterial
function slotMaterial(src, fixedSlot = -1) {
  const m = src.clone();
  const u = {
    uGlow: { value: new Array(8).fill(0) },
    uCol: { value: SLOTS.map(s => new THREE.Color(s.color)) },
    uFocus: { value: -1 },
    uTime: { value: 0 },
    uHeat: { value: 0 },    // kilatan saat terkena
    uCharge: { value: 0 },  // meriam mengisi tenaga
  };
  m.userData.u = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${fixedSlot < 0 ? 'attribute float aSlot;' : ''}\nflat out float vSlot;\nout vec3 vObjPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSlot = ${fixedSlot < 0 ? 'aSlot' : fixedSlot.toFixed(1)};\nvObjPos = position;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nflat in float vSlot;\nin vec3 vObjPos;\nuniform float uGlow[8];\nuniform vec3 uCol[8];\nuniform float uFocus, uTime, uHeat, uCharge;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vSlot > 7.5) discard;
        int si = int(vSlot + 0.5);
        float g = uGlow[si];
        vec3 c = uCol[si];
        float fres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
        float isF = 1.0 - step(0.5, abs(vSlot - uFocus));
        float scan = smoothstep(0.92, 1.0, sin(vObjPos.y * 60.0 - uTime * 5.0) * 0.5 + 0.5);
        totalEmissiveRadiance += c * (fres * (0.35 * g + 1.6 * isF) + scan * isF * 0.9 + isF * 0.12);
        totalEmissiveRadiance += vec3(1.0, 0.35, 0.15) * uHeat * fres * 3.0;
        ${fixedSlot >= 0 ? 'totalEmissiveRadiance += vec3(0.35, 0.9, 1.0) * uCharge * (0.6 + 1.4 * fres) * (0.85 + 0.15 * sin(uTime * 40.0));' : ''}`);
  };
  m.customProgramCacheKey = () => 'slot' + fixedSlot;
  return m;
}

const CANNON_SLOT = SLOTS.findIndex(s => s.id === 'cannon');

// api pendorong: kerucut aditif yang berkedip
function makeFlame() {
  const geo = new THREE.ConeGeometry(0.032, 0.26, 16, 1, true);
  geo.translate(0, -0.13, 0);                 // pangkal di nosel, ujung menjulur ke bawah
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uI: { value: 0 } },
    vertexShader: 'varying float vY; void main(){ vY = -position.y / 0.26; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uT, uI; varying float vY;
      void main(){ float f = 0.8 + 0.2 * sin(uT * 60.0 + vY * 20.0);
        vec3 c = mix(vec3(0.75, 0.95, 1.0), vec3(0.25, 0.55, 1.0), vY);
        gl_FragColor = vec4(c * f * uI * 1.6, (1.0 - vY) * uI); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

// putar tulang dengan rotasi dunia qW, dicampur bobot w
function rotateWorld(bone, qW, w = 1) {
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(_q1);
  bone.parent.getWorldQuaternion(_q2);
  _q3.copy(qW).multiply(_q1);                 // orientasi dunia yang diinginkan
  _q2.invert().multiply(_q3);                 // → ruang induk
  bone.quaternion.slerp(_q2, w);
}
// arahkan ruas (tulang → ujung) ke titik dunia
function aimBone(bone, tip, target, w) {
  if (w <= 0) return;
  bone.updateWorldMatrix(true, true);
  const a = bone.getWorldPosition(_v1), b = tip.getWorldPosition(_v2);
  const cur = b.sub(a).normalize(), want = _v3.copy(target).sub(a).normalize();
  rotateWorld(bone, new THREE.Quaternion().setFromUnitVectors(cur, want), w);
}
const smooth = t => t * t * (3 - 2 * t);

export class Mech {
  constructor(assets, opts = {}) {
    this.root = new THREE.Group();            // posisi + arah hadap (diatur dari luar)
    this.body = new THREE.Group();            // kemiringan roboh, poros di kaki
    this.root.add(this.body);
    this.tint = opts.tint || null;
    this.model = SkeletonUtils.clone(assets.body.scene);
    this.body.add(this.model);
    this.materials = [];
    this.model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        o.material = slotMaterial(o.material);
        if (opts.tint) o.material.color.set(opts.tint);
        this.materials.push(o.material);
      }
    });
    // normalisasi tinggi jadi 1 unit. Kotak geometri mentah menipu (pra-skin),
    // jadi ukur kotak SETELAH skinning di pose bind.
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.model.traverse(o => {
      if (o.isSkinnedMesh) { o.computeBoundingBox(); box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
    });
    this.baseH = box.max.y - box.min.y;
    this.model.scale.setScalar(1 / this.baseH);
    this.model.position.y = -box.min.y / this.baseH;

    this.bone = n => this.model.getObjectByName(n);
    this.B = {
      hips: this.bone('Hips'), spine: this.bone('Spine01'), chest: this.bone('Spine02'), head: this.bone('Head'),
      rArm: this.bone('RightArm'), rFore: this.bone('RightForeArm'), rHand: this.bone('RightHand'),
      lArm: this.bone('LeftArm'), lFore: this.bone('LeftForeArm'), lHand: this.bone('LeftHand'),
    };

    this.attachCannon(assets.cannon.scene);
    this._findNozzles();

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = Object.fromEntries(assets.body.animations.map(c => [c.name, this.mixer.clipAction(c)]));
    // pose dasar: bingkai pertama Idle (berdiri tegak, meriam sedikit maju), dibekukan
    this.base = this.actions.Idle;
    this.base.play(); this.base.paused = true; this.base.time = 0.05;
    this.mixer.update(0);
    // simpan pose dasar semua tulang; dipulihkan manual tiap frame (mixer hanya menulis
    // nilai yang BERUBAH, jadi offset prosedural akan menumpuk kalau mengandalkan mixer)
    this.rest = [];
    this.model.traverse(o => { if (o.isBone) this.rest.push([o, o.quaternion.clone(), o.position.clone(), o.scale.clone()]); });
    this.mixer.stopAllAction();

    this.glow = new Array(8).fill(0.4);
    this.focus = -1; this.heat = 0;
    this.resetMotion();
  }

  // semua parameter gerak prosedural (diisi ulang tiap frame oleh pengendali)
  resetMotion() {
    this.m = {
      idle: 1,             // napas hidrolik + kepala servo
      aimR: 0, aimRAt: new THREE.Vector3(),   // bidik meriam
      punchL: 0, punchAt: new THREE.Vector3(), // tinju lurus kiri
      lean: 0,             // condong maju (+) / mundur (−), radian
      topple: 0,           // 0 berdiri … 1 roboh terlentang
      thrust: 0,           // api pendorong 0..1
      charge: 0,           // meriam mengisi tenaga 0..1
      recoil: 0,           // hentakan balik meriam 0..1
      look: null,          // titik dunia yang ditatap kepala (null = memindai)
    };
  }

  attachCannon(src) {
    const hand = this.B.rHand, fore = this.B.rFore;
    if (!hand || !fore) return;
    const c = src.clone(true);
    c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.material = slotMaterial(o.material, CANNON_SLOT); if (this.tint) o.material.color.set(this.tint); this.materials.push(o.material); this.cannonMats = (this.cannonMats || []).concat(o.material); } });
    c.updateMatrixWorld(true);
    const cb = new THREE.Box3().setFromObject(c);
    const len = cb.max.x - cb.min.x;
    c.position.set(-cb.min.x - len * 0.36, -(cb.min.y + cb.max.y) / 2, -(cb.min.z + cb.max.z) / 2);
    const holder = new THREE.Group();
    holder.add(c);
    this.body.add(holder);
    this.cannon = holder;
    this.cannonLen = len;

    this.body.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.body.matrixWorld).invert();
    const A = new THREE.Vector3().setFromMatrixPosition(fore.matrixWorld).applyMatrix4(inv);
    const B = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld).applyMatrix4(inv);
    const dir = B.clone().sub(A).normalize();
    const qWant = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    this.cannonOffset = this._handQuat().invert().multiply(qWant);
    const L = (A.distanceTo(B) * 3.0) / len;
    this.cannonScale = L;
    this.cannon.scale.set(L, L * 1.6, L * 1.6);
    // titik moncong dalam ruang holder (ujung +X)
    this.muzzleLocal = new THREE.Vector3(len * 0.64 + 0.02 / L, 0, 0);
    this._syncCannon();
  }

  _handQuat() {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    this.B.rHand.matrixWorld.decompose(p, q, s);
    const bq = new THREE.Quaternion();
    this.body.matrixWorld.decompose(new THREE.Vector3(), bq, new THREE.Vector3());
    this._handPos = p.applyMatrix4(new THREE.Matrix4().copy(this.body.matrixWorld).invert());
    return bq.invert().multiply(q);
  }

  _syncCannon() {
    if (!this.cannon) return;
    const q = this._handQuat();
    this.cannon.position.copy(this._handPos);
    this.cannon.quaternion.copy(q.multiply(this.cannonOffset));
  }

  // posisi moncong & arah laras (dunia), untuk efek tembakan
  muzzle(out = new THREE.Vector3()) {
    this.cannon.updateWorldMatrix(true, false);
    return out.copy(this.muzzleLocal).applyMatrix4(this.cannon.matrixWorld);
  }
  barrelDir(out = new THREE.Vector3()) {
    return out.set(1, 0, 0).applyQuaternion(this.cannon.getWorldQuaternion(_q3)).normalize();
  }
  chestPos(out = new THREE.Vector3()) { return this.B.chest.getWorldPosition(out); }
  fistPos(out = new THREE.Vector3()) { return this.B.lHand.getWorldPosition(out); }

  // dua nosel pendorong: titik terbawah ransel kiri & kanan, disimpan dalam ruang tulang dada
  _findNozzles() {
    this.nozzles = [];
    const mesh = []; this.model.traverse(o => o.isSkinnedMesh && mesh.push(o));
    const o = mesh[0]; if (!o) return;
    const g = o.geometry, pos = g.getAttribute('position'), slot = g.getAttribute('aSlot');
    const pts = [[], []];
    for (let i = 0; i < pos.count; i++) if (slot.getX(i) === BOOST) { const x = pos.getX(i); pts[x < 0 ? 0 : 1].push(i); }
    this.model.updateMatrixWorld(true);
    const chestInv = new THREE.Matrix4().copy(this.B.chest.matrixWorld).invert();
    // arah semburan (ke bawah, sedikit ke belakang) disimpan dalam ruang tulang dada
    this.nozDir = new THREE.Vector3(0, -1, -0.3).normalize().applyQuaternion(this.B.chest.getWorldQuaternion(new THREE.Quaternion()).invert());
    for (const side of pts) {
      if (side.length < 20) continue;
      let minY = Infinity; side.forEach(i => (minY = Math.min(minY, pos.getY(i))));
      const c = new THREE.Vector3(); let n = 0;
      const span = (g.boundingBox.max.y - g.boundingBox.min.y) * 0.025;
      side.forEach(i => { if (pos.getY(i) < minY + span) { c.x += pos.getX(i); c.y += pos.getY(i); c.z += pos.getZ(i); n++; } });
      c.divideScalar(n).applyMatrix4(o.matrixWorld).applyMatrix4(chestInv);
      const flame = makeFlame();
      this.body.add(flame);
      this.nozzles.push({ local: c, flame });
    }
  }

  setGlow(arr) { this.glow = arr.slice(); }
  setFocus(i) { this.focus = i; }
  hit(v = 1) { this.heat = Math.max(this.heat, v); }

  // ---------- lapisan gerak mesin ----------
  _procedural(t) {
    const m = this.m, B = this.B;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    const side = new THREE.Vector3().crossVectors(UP, fwd).normalize();

    // napas hidrolik: dada naik-turun pelan, bukan goyang badan manusia
    const br = Math.sin(t * 1.25) * 0.012 * m.idle;
    rotateWorld(B.spine, new THREE.Quaternion().setFromAxisAngle(side, br + m.lean * 0.55));
    rotateWorld(B.chest, new THREE.Quaternion().setFromAxisAngle(side, m.lean * 0.45 - m.recoil * 0.12));

    // kepala servo: berpindah sasaran tiap beberapa detik, bergerak cepat lalu diam
    let yaw = 0;
    if (m.look) {
      const hp = B.head.getWorldPosition(new THREE.Vector3());
      const d = m.look.clone().sub(hp).setY(0).normalize();
      yaw = Math.atan2(new THREE.Vector3().crossVectors(fwd, d).y, fwd.dot(d)) * 0.8;
    } else if (m.idle > 0) {
      const slot = Math.floor(t / 3.2), local = (t / 3.2) - slot;
      const h = n => (Math.sin(n * 127.1 + this.seed * 3.7) * 43758.5453) % 1;
      const a = (h(slot) - 0.5) * 0.7, b = (h(slot - 1) - 0.5) * 0.7;
      yaw = THREE.MathUtils.lerp(b, a, smooth(Math.min(1, local / 0.18))) * m.idle;
    }
    this._yaw = THREE.MathUtils.lerp(this._yaw ?? 0, yaw, 0.25);
    rotateWorld(B.head, new THREE.Quaternion().setFromAxisAngle(UP, this._yaw));

    // siaga mesin: lengan meriam sesekali terangkat sedikit lalu turun (cek servo tiap ±7 dtk)
    if (m.idle > 0 && m.aimR === 0) {
      const ph = (t + this.seed) % 7, up = ph < 1.6 ? Math.sin((ph / 1.6) * Math.PI) : 0;
      rotateWorld(B.rArm, new THREE.Quaternion().setFromAxisAngle(side, -0.12 * smooth(up) * m.idle));
    }
    // meriam: bidik sasaran (lengan atas lalu lengan bawah), hentakan balik mendorong laras ke atas
    if (m.aimR > 0) {
      const tgt = m.aimRAt.clone().addScaledVector(UP, m.recoil * 0.25);
      aimBone(B.rArm, B.rHand, tgt, m.aimR * 0.75);
      aimBone(B.rFore, B.rHand, tgt, m.aimR);
    }
    // tinju lurus kiri
    if (m.punchL > 0) {
      aimBone(B.lArm, B.lHand, m.punchAt, m.punchL);
      aimBone(B.lFore, B.lHand, m.punchAt, m.punchL);
    }
    // roboh: badan miring ke belakang dengan poros di kaki
    this.body.rotation.x = -m.topple * 1.38;
    this.body.position.y = Math.sin(Math.min(1, m.topple) * Math.PI) * 0.02;
  }

  update(dt, t) {
    if (this.seed == null) this.seed = Math.random() * 10;
    for (const [b, q, p, sc] of this.rest) { b.quaternion.copy(q); b.position.copy(p); b.scale.copy(sc); }
    this.model.updateMatrixWorld(true);
    this._procedural(t);
    this.root.updateMatrixWorld(true);
    this._syncCannon();
    // api pendorong mengikuti nosel di tulang dada
    const chestM = this.B.chest.matrixWorld, inv = new THREE.Matrix4().copy(this.body.matrixWorld).invert();
    const cq = this.B.chest.getWorldQuaternion(new THREE.Quaternion());
    const bqi = this.body.getWorldQuaternion(new THREE.Quaternion()).invert();
    const dir = this.nozDir.clone().applyQuaternion(cq).applyQuaternion(bqi);
    for (const nz of this.nozzles) {
      nz.flame.position.copy(nz.local).applyMatrix4(chestM).applyMatrix4(inv);
      nz.flame.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      const I = Math.max(this.m.thrust, 0.07 * this.m.idle * (0.8 + 0.2 * Math.sin(t * 9)));   // nyala pilot kecil saat siaga
      nz.flame.visible = I > 0.01;
      nz.flame.scale.set(1, 0.4 + I * (1.1 + 0.15 * Math.sin(t * 50)), 1);
      nz.flame.material.uniforms.uI.value = I;
      nz.flame.material.uniforms.uT.value = t;
    }
    this.heat = Math.max(0, this.heat - dt * 2.5);
    for (const mat of this.materials) {
      const u = mat.userData.u;
      for (let i = 0; i < 8; i++) u.uGlow.value[i] = this.glow[i];
      u.uFocus.value = this.focus; u.uTime.value = t; u.uHeat.value = this.heat; u.uCharge.value = this.m.charge;
    }
  }
}
