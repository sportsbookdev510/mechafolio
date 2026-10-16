// Efek tarung yang bisa di-scrub: semua keadaan dihitung dari waktu/progres, bukan disimulasikan,
// sehingga gulir mundur menampilkan bingkai yang sama persis.
import * as THREE from 'three';

function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const TEX = glowTex();
const add = (color, opacity = 1) => new THREE.SpriteMaterial({ map: TEX, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
const hash = n => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

export class FX {
  constructor(scene) {
    this.g = new THREE.Group(); scene.add(this.g);
    const CYAN = 0x6fe8ff;

    // proyektil: inti + 6 jejak memudar
    this.bolt = new THREE.Group();
    this.boltCore = new THREE.Sprite(add(0xffffff)); this.boltCore.scale.setScalar(0.07);
    this.boltGlow = new THREE.Sprite(add(CYAN, 0.9)); this.boltGlow.scale.setScalar(0.2);
    this.bolt.add(this.boltGlow, this.boltCore);
    this.trail = [...Array(6)].map((_, i) => { const s = new THREE.Sprite(add(CYAN, 0.5 * (1 - i / 6))); s.scale.setScalar(0.12 * (1 - i / 8)); this.g.add(s); return s; });
    this.g.add(this.bolt);

    // sinar meriam: silinder aditif + inti putih
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uI: { value: 0 }, uT: { value: 0 } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uI, uT; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ float core = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);   // terang di tengah dari sudut mana pun
          float n = 0.85 + 0.15 * sin(vUv.y * 80.0 - uT * 50.0);
          vec3 c = mix(vec3(0.3, 0.85, 1.0), vec3(1.0), pow(core, 4.0));
          gl_FragColor = vec4(c * n * uI * 1.8, core * uI); }`,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true), beamMat);
    this.beam.frustumCulled = false; this.g.add(this.beam);

    // kilatan moncong & benturan
    this.muzzle = new THREE.Sprite(add(0xbff6ff)); this.g.add(this.muzzle);
    this.impact = new THREE.Sprite(add(0xffd2a0)); this.g.add(this.impact);
    this.light = new THREE.PointLight(0x9fe6ff, 0, 2.5, 1.6); this.g.add(this.light);

    // percikan: titik dengan arah tetap (deterministik)
    const N = 90, pos = new Float32Array(N * 3);
    this.sparkDir = [...Array(N)].map((_, i) => new THREE.Vector3(hash(i) - 0.5, hash(i + 77) * 0.9 + 0.1, hash(i + 191) - 0.5).normalize().multiplyScalar(0.4 + hash(i + 3) * 0.9));
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffc27a, size: 0.018, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false; this.g.add(this.sparks);

    // debu lantai: cincin datar yang melebar
    const dc = document.createElement('canvas'); dc.width = dc.height = 128;
    const dx = dc.getContext('2d'), dg = dx.createRadialGradient(64, 64, 20, 64, 64, 64);
    dg.addColorStop(0, 'rgba(200,190,175,0)'); dg.addColorStop(0.6, 'rgba(200,190,175,.55)'); dg.addColorStop(1, 'rgba(200,190,175,0)');
    dx.fillStyle = dg; dx.fillRect(0, 0, 128, 128);
    this.dust = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(dc), transparent: true, depthWrite: false }));
    this.dust.rotation.x = -Math.PI / 2; this.dust.position.y = 0.004; this.g.add(this.dust);

    this.clear();
  }

  clear() {
    this.bolt.visible = false; this.trail.forEach(s => (s.visible = false));
    this.beam.visible = false; this.muzzle.visible = false; this.impact.visible = false;
    this.sparks.visible = false; this.dust.visible = false; this.light.intensity = 0;
  }

  // proyektil dari A ke B, u = 0..1 sepanjang lintasan
  shot(A, B, u) {
    if (u <= 0 || u >= 1) return;
    const p = A.clone().lerp(B, u);
    this.bolt.visible = true; this.bolt.position.copy(p);
    const dir = B.clone().sub(A);
    this.trail.forEach((s, i) => { s.visible = true; s.position.copy(A).addScaledVector(dir, Math.max(0, u - (i + 1) * 0.045)); });
    this.light.position.copy(p); this.light.intensity = Math.max(this.light.intensity, 2.5);
  }

  // kilatan moncong, a = 0..1 umur kilatan
  flash(P, a, size = 0.32) {
    if (a <= 0 || a >= 1) return;
    const k = 1 - a;
    this.muzzle.visible = true; this.muzzle.position.copy(P); this.muzzle.scale.setScalar(size * (0.6 + a * 0.8));
    this.muzzle.material.opacity = k;
    this.light.position.copy(P); this.light.intensity = Math.max(this.light.intensity, 6 * k);
  }

  // benturan: bola cahaya + percikan menyebar jatuh, a = 0..1 umur
  hit(P, a, power = 1) {
    if (a <= 0 || a >= 1) return;
    const k = 1 - a;
    this.impact.visible = true; this.impact.position.copy(P);
    this.impact.scale.setScalar((0.18 + a * 0.5) * power); this.impact.material.opacity = k * k;
    const arr = this.sparks.geometry.attributes.position.array;
    this.sparkDir.forEach((d, i) => {
      const t = a * 0.9;
      arr[i * 3] = P.x + d.x * t * 0.9 * power;
      arr[i * 3 + 1] = P.y + d.y * t * 0.9 * power - 1.6 * t * t;
      arr[i * 3 + 2] = P.z + d.z * t * 0.9 * power;
    });
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.visible = true; this.sparks.material.opacity = k;
    this.light.position.copy(P); this.light.color.set(0xffc690); this.light.intensity = Math.max(this.light.intensity, 7 * k * power);
  }

  // sinar A→B dengan lebar & kekuatan
  ray(A, B, intensity, width = 0.05, t = 0) {
    if (intensity <= 0.01) return;
    const d = B.clone().sub(A), len = d.length();
    this.beam.visible = true;
    this.beam.position.copy(A).addScaledVector(d, 0.5);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.beam.scale.set(width * intensity, len, width * intensity);
    this.beam.material.uniforms.uI.value = intensity; this.beam.material.uniforms.uT.value = t;
    this.light.position.copy(A).lerp(B, 0.5); this.light.color.set(0x9fe6ff); this.light.intensity = Math.max(this.light.intensity, 5 * intensity);
  }

  // debu di lantai, a = 0..1 umur
  dustAt(P, a, size = 1) {
    if (a <= 0 || a >= 1) return;
    this.dust.visible = true; this.dust.position.set(P.x, 0.004, P.z);
    this.dust.scale.setScalar(size * (0.3 + a * 1.4)); this.dust.material.opacity = (1 - a) * 0.9;
  }
}
