// Panggung 3D bersama: renderer, latar lukisan hangar (layar penuh + paralaks + blur),
// lantai pemantul, cahaya pagi dari pintu hangar, debu melayang, bloom lembut.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { lowSpec } from './mech.js';

const ART = new URL('../assets/art/', import.meta.url).href;

export class Stage {
  constructor(canvas, { reflect = true, fit = 'window' } = {}) {
    this.low = lowSpec();
    this.fit = fit;           // 'window' = layar penuh, 'parent' = mengikuti ukuran elemen induk canvas
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.low, powerPreference: 'high-performance' });
    r.toneMapping = THREE.NeutralToneMapping;   // Neutral: warna lukisan latar tidak tercuci seperti ACES
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    // batasi buffer: layar separuh hitam di GPU lemah kalau melebihi batas (lihat catatan WebGL)
    const maxTex = r.capabilities.maxTextureSize || 4096;
    this.maxPR = Math.min(this.low ? 1.5 : 2, window.devicePixelRatio || 1);
    this.maxPx = Math.min(4096, maxTex);
    this.maxPix = this.low ? 1.6e6 : 3.0e6;   // batas total piksel render layar penuh (layar besar + DPR 2 terlalu berat)
    this.prScale = 1;                          // diturunkan otomatis kalau frame lambat

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.02, 60);
    this.clock = new THREE.Clock();
    this.updaters = new Set();

    this._backdrop();
    this._lights();
    this._floor(reflect && !this.low);
    this._dust();

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.6, 0.86);
    this.composer.addPass(this.bloom);
    // keluaran akhir selalu buram (alfa 1): canvas kini menempel di atas latar CSS jendela,
    // alfa < 1 dari bayangan/bloom membuat robot tampak tembus pandang di HP
    const out = new OutputPass();
    out.material.fragmentShader = out.material.fragmentShader.replace(/\}\s*$/, '\tgl_FragColor.a = 1.0;\n}');
    this.composer.addPass(out);

    this.resize();
    addEventListener('resize', () => this.resize());
    this.running = true;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    // hemat baterai: berhenti saat tab tersembunyi
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.clock.getDelta(); });
  }

  // latar = quad layar penuh dengan shader "cover" + geser paralaks + blur (mip)
  _backdrop() {
    const tex = new THREE.TextureLoader().load(ART + (this.low ? 'hangar-1440.webp' : 'hangar-2560.webp'), t => {
      this.bgU.uAspectTex.value = t.image.width / t.image.height;
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.bgU = {
      uTex: { value: tex }, uAspectTex: { value: 2.33 }, uAspect: { value: 1 },
      uPan: { value: new THREE.Vector2(0, 0) }, uZoom: { value: 1.08 }, uBlur: { value: 0 }, uDim: { value: 0 }, uExpose: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.bgU, depthWrite: false, depthTest: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D uTex; uniform float uAspectTex, uAspect, uZoom, uBlur, uDim, uExpose; uniform vec2 uPan; varying vec2 vUv;
        void main(){
          vec2 uv = vUv - 0.5;
          float r = uAspect / uAspectTex;                 // cover: isi layar tanpa gepeng
          if (r > 1.0) uv.y /= r; else uv.x *= r;
          uv = uv / uZoom + 0.5 + uPan;
          uv.y = clamp(uv.y, 0.002, 0.998); uv.x = clamp(uv.x, 0.002, 0.998);
          vec3 c = textureLod(uTex, uv, uBlur).rgb;
          c = mix(c, c * vec3(0.55, 0.6, 0.7), uDim);
          c *= uExpose;                                   // 0 = hangar gelap (pembukaan), 1 = normal
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    q.frustumCulled = false; q.renderOrder = -10;
    this.scene.add(q);
    this.bgMesh = q;
    this.bgTex = tex;
  }

  _lights() {
    const s = this.scene;
    // pantulan lingkungan dari ruangan netral → logam tidak hitam
    const pm = new THREE.PMREMGenerator(this.renderer);
    import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
      s.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      s.environmentIntensity = 0.4;
    });
    const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x3a3f48, 0.6);
    s.add(hemi);
    // matahari pagi masuk dari pintu hangar (kanan-belakang)
    const sun = this.sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
    sun.position.set(3.2, 3.4, -1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.low ? 1024 : 2048, this.low ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2.4, bottom: -0.4, near: 0.5, far: 10 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    s.add(sun);
    // isi lembut hangat dari dalam hangar (kiri-depan)
    const fill = new THREE.DirectionalLight(0xffd9b0, 0.9);
    fill.position.set(-3, 1.5, 3);
    s.add(fill);
    // pinggiran dingin agar siluet lepas dari latar terang
    const rim = new THREE.DirectionalLight(0x9cc8ff, 1.6);
    rim.position.set(-2.5, 2.2, -3);
    s.add(rim);
    // pegangan lampu + intensitas dasar (untuk adegan "lampu hangar menyala")
    this.lights = [hemi, sun, fill, rim].map(l => ({ l, base: l.intensity }));
  }

  _floor(reflect) {
    // penangkap bayangan transparan → robot "berdiri" di lantai lukisan
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.38 }));
    shadow.rotation.x = -Math.PI / 2; shadow.receiveShadow = true;
    this.scene.add(shadow);
    // bayangan kontak lembut di bawah kaki (tetap terlihat walau kamera hampir sejajar lantai)
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const cx = cv.getContext('2d'), gr = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(.5, 'rgba(0,0,0,.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.001;
    this.scene.add(blob);
    this.contact = blob;
    if (!reflect) return;
    // pantulan lantai mengilap, memudar ke tepi (radius dihitung dari posisi lokal, bukan layar)
    const shader = {
      name: 'FloorReflector',
      uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uStrength: { value: 0.28 } },
      vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vLocal;
        void main(){ vUv = textureMatrix * vec4(position, 1.0); vLocal = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uStrength; varying vec4 vUv; varying vec2 vLocal;
        void main(){ vec4 rf = texture2DProj(tDiffuse, vUv);
          float d = length(vLocal) / 2.4;
          float a = uStrength * (1.0 - smoothstep(0.1, 0.95, d)) * rf.a;
          gl_FragColor = vec4(rf.rgb, a);
          #include <colorspace_fragment>
        }`,
    };
    const refl = new Reflector(new THREE.CircleGeometry(2.4, 64), { textureWidth: 512, textureHeight: 512, clipBias: 0.003, shader });
    refl.material.transparent = true;
    refl.rotation.x = -Math.PI / 2; refl.position.y = 0.0005;
    // saat memotret pantulan: sembunyikan latar & debu, bersihkan dengan alfa 0 → hanya robot yang terpantul
    const base = refl.onBeforeRender.bind(refl);
    refl.onBeforeRender = (renderer, scene, camera) => {
      const hidden = [this.bgMesh, this.dustMesh].filter(Boolean);
      hidden.forEach(o => (o.visible = false));
      const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      base(renderer, scene, camera);
      renderer.setClearColor(cc, ca);
      hidden.forEach(o => (o.visible = true));
    };
    this.scene.add(refl);
    this.reflector = refl;
  }

  _dust() {
    const n = this.low ? 260 : 700;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 5; pos[i * 3 + 1] = Math.random() * 2.2; pos[i * 3 + 2] = (Math.random() - 0.5) * 4 - 0.5;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.dustU = { uTime: { value: 0 }, uPR: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.dustU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float seed; uniform float uTime, uPR; varying float vA;
        void main(){ vec3 p = position;
          p.y = mod(p.y + uTime * (0.02 + seed * 0.03), 2.2);
          p.x += sin(uTime * 0.3 + seed * 40.0) * 0.08;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (2.0 + seed * 3.0) * uPR * (1.5 / -mv.z);
          vA = 0.25 + 0.5 * seed; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(1.0, 0.96, 0.88, vA * smoothstep(0.5, 0.0, d)); }`,
    });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false;
    this.scene.add(pts);
    this.dustMesh = pts;
  }

  // pindahkan canvas ke dalam elemen lain (jendela 3D di halaman); konteks WebGL tetap
  attach(el) {
    if (this.canvas.parentElement !== el) el.prepend(this.canvas);
    this.resize();
  }

  resize() {
    const par = this.canvas.parentElement;
    const w = this.fit === 'parent' && par ? Math.max(1, par.clientWidth) : innerWidth;
    const h = this.fit === 'parent' && par ? Math.max(1, par.clientHeight) : innerHeight;
    if (w === this._w && h === this._h && this._prs === this.prScale) return;
    this._w = w; this._h = h; this._prs = this.prScale;
    let pr = Math.min(this.maxPR, Math.sqrt(this.maxPix / (w * h))) * this.prScale;
    pr = Math.max(0.6, pr);
    if (Math.max(w, h) * pr > this.maxPx) pr = this.maxPx / Math.max(w, h);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * pr * 0.5, h * pr * 0.5);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.bgU.uAspect.value = w / h;
    this.dustU.uPR.value = pr;
  }

  // Wordmark raksasa sebagai papan di dalam hangar, DI BELAKANG robot (robot menutupi sebagian huruf).
  async addSign(text, { font = 'Chakra Petch', weight = 700, color = '#0b1220', width = 4.2, y = 0.66, z = -1.5, track = 0.04 } = {}) {
    try { await document.fonts.load(`${weight} 200px "${font}"`); } catch {}
    const H = 512, fs = 400;
    const c = document.createElement('canvas'), x = c.getContext('2d');
    x.font = `${weight} ${fs}px "${font}"`;
    const chars = [...text], gap = fs * track;
    const wTot = chars.reduce((a, ch) => a + x.measureText(ch).width, 0) + gap * (chars.length - 1);
    c.width = Math.min(4096, Math.ceil(wTot + 40)); c.height = H;
    const k = (c.width - 40) / wTot;
    x.font = `${weight} ${fs * k}px "${font}"`; x.textBaseline = 'middle'; x.fillStyle = '#fff';
    let cx = 20;
    for (const ch of chars) { x.fillText(ch, cx, H / 2 + fs * k * 0.04); cx += x.measureText(ch).width + gap * k; }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false, opacity: 0.94 });
    const h = width * (H / c.width);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, h), mat);
    m.position.set(0, y, z); m.renderOrder = -5;
    this.scene.add(m);
    this.sign = m;
    return m;
  }

  onUpdate(fn) { this.updaters.add(fn); return () => this.updaters.delete(fn); }

  // mode film: bingkai digerakkan manual (deterministik) untuk merender video kit
  tick(dt) {
    this._t = (this._t || 0) + dt;
    this.dustU.uTime.value = this._t;
    for (const fn of this.updaters) fn(dt, this._t);
    this.composer.render();
  }

  _loop() {
    if (this.manual) return;
    requestAnimationFrame(this._loop);
    if (document.hidden || this.paused) { this.clock.getDelta(); return; }
    const raw = Math.max(0, this.clock.getDelta());
    const dt = Math.min(0.05, raw);
    const t = this.clock.elapsedTime;
    // resolusi adaptif: rata-rata waktu frame > 24 ms → turunkan skala piksel; < 15 ms → naikkan lagi
    this._ft = this._ft ? this._ft * 0.94 + raw * 0.06 : raw;
    this._adj = (this._adj || 0) + raw;
    if (this._adj > 1.5) {
      this._adj = 0;
      const s = this._ft > 0.024 ? Math.max(0.55, this.prScale - 0.12) : this._ft < 0.015 ? Math.min(1, this.prScale + 0.08) : this.prScale;
      if (s !== this.prScale) { this.prScale = s; this.resize(); }
    }
    this.dustU.uTime.value = t;
    for (const fn of this.updaters) fn(dt, t);
    this.composer.render();
  }
}
