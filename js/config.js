// Satu sumber kebenaran untuk semua halaman: link resmi, CA, chain, daftar suku cadang.
// CA live dibaca dari /live.json (no-store) oleh livewatch.js; nilai di sini hanya cadangan.
export const SITE = {
  name: 'MECHAFOLIO',
  ticker: '$FOLIO',
  domain: 'mechafolio.xyz',
  x: 'https://x.com/mechafolio',
  xHandle: '@mechafolio',
  launchUtc: null,            // diisi saat jadwal launch pasti, mis. '2026-10-20T17:00:00Z'
  ca: null,                   // diisi lewat live.json saat launch
};

export const CHAIN = {
  id: 4663,
  name: 'Robinhood Chain',
  rpc: ['https://robinhood.api.pocket.network', 'https://robinhood.drpc.org', 'https://robinhood-rpc.publicnode.com'],
  explorer: 'https://robinhoodchain.blockscout.com',
  pons: ca => `https://www.ponsfamily.com/launchpad/${String(ca).toLowerCase()}`,
};

// 8 slot robot = 8 saham token asli di Robinhood Chain (alamat dicek 15 Okt 2026 via GeckoTerminal).
// bones: tulang rig Meshy yang menjadi wilayah slot itu (untuk sorotan per bagian).
export const SLOTS = [
  { id: 'head',     part: 'AI Core',      ticker: 'NVDA', name: 'NVIDIA',           color: '#76d14b', token: '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', bones: ['neck', 'Head', 'head_end', 'headfront'], role: 'Targeting. Every hit lands harder.' },
  { id: 'reactor',  part: 'Reactor',      ticker: 'TSLA', name: 'Tesla',            color: '#ff4a3d', token: '0x322f0929c4625ed5bad873c95208d54e1c003b2d', bones: ['Spine02'], role: 'Power. Feeds every other part.' },
  { id: 'boosters', part: 'Boosters',     ticker: 'SPCX', name: 'SpaceX',           color: '#8b6cff', token: '0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea', bones: [], back: true, role: 'Speed. Who strikes first.' },
  { id: 'armor',    part: 'Armor',        ticker: 'SGOV', name: 'US T-Bill ETF',    color: '#e8c35a', token: '0x92fd66527192e3e61d4ddd13322aa222de86f9b5', bones: ['Hips', 'Spine', 'Spine01'], role: 'Defense. Treasury-grade plating.' },
  { id: 'sensors',  part: 'Sensor Pods',  ticker: 'AAPL', name: 'Apple',            color: '#c9d2dc', token: '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', bones: ['LeftShoulder', 'RightShoulder'], role: 'Evasion. Reads the incoming blow.' },
  { id: 'fist',     part: 'Breaker Fist', ticker: 'META', name: 'Meta',             color: '#3d7bff', token: '0xc0d6457c16cc70d6790dd43521c899c87ce02f35', bones: ['LeftArm', 'LeftForeArm', 'LeftHand'], role: 'Melee damage.' },
  { id: 'cannon',   part: 'Rail Cannon',  ticker: 'MSTR', name: 'Strategy',         color: '#ff9a1f', token: '0xec262a75e413fafd0df80480274532c79d42da09', bones: ['RightArm', 'RightForeArm', 'RightHand'], role: 'Ranged damage. High variance.' },
  { id: 'legs',     part: 'Actuators',    ticker: 'MSFT', name: 'Microsoft',        color: '#35c4f0', token: '0xe93237c50d904957cf27e7b1133b510c669c2e74', bones: ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'], role: 'Stability. Shrugs off knockdowns.' },
];

// Kelas robot dari % suplai yang dipegang (fondasi = token di dompet + saham bagian yang belum diklaim tidak dihitung).
export const CLASSES = [
  { id: 'scout',    name: 'Scout',    min: 0,      scale: 0.62 },
  { id: 'striker',  name: 'Striker',  min: 0.0005, scale: 0.74 },
  { id: 'brawler',  name: 'Brawler',  min: 0.002,  scale: 0.86 },
  { id: 'titan',    name: 'Titan',    min: 0.005,  scale: 1.0 },
  { id: 'colossus', name: 'Colossus', min: 0.01,   scale: 1.16 },
];

export const classFor = share => [...CLASSES].reverse().find(c => share >= c.min) || CLASSES[0];

// Gerak saham hari ini → pengali kekuatan bagian (sama seperti mesin duel di server).
export const moveMult = pct => Math.min(1.5, Math.max(0.5, 1 + 10 * (pct / 100)));
