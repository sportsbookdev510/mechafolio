// Nomor blok Robinhood Chain live (eth_blockNumber) — bukti nyata situs tersambung ke chain.
// RPC publik ber-CORS dicoba bergiliran; kalau semua gagal, status jujur "offline".
import { CHAIN } from './config.js';

const subs = new Set();
let state = { block: null, ok: false, at: 0, rpc: null };
let idx = 0;

async function poll() {
  for (let k = 0; k < CHAIN.rpc.length; k++) {
    const url = CHAIN.rpc[(idx + k) % CHAIN.rpc.length];
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }), signal: ctl.signal });
      clearTimeout(to);
      const j = await r.json();
      if (!j.result) continue;
      idx = (idx + k) % CHAIN.rpc.length;
      state = { block: parseInt(j.result, 16), ok: true, at: Date.now(), rpc: new URL(url).host };
      subs.forEach(fn => fn(state));
      return;
    } catch {}
  }
  state = { ...state, ok: false };
  subs.forEach(fn => fn(state));
}

export function onBlock(fn) {
  subs.add(fn);
  if (state.at) fn(state);
  if (subs.size === 1) { poll(); setInterval(() => { if (!document.hidden) poll(); }, 2500); }
  return () => subs.delete(fn);
}

// detik menuju duel berikutnya (20:00 UTC tiap hari)
export function nextDuel(now = Date.now()) {
  const d = new Date(now);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 20, 0, 0);
  if (t <= now) t += 86400000;
  return Math.floor((t - now) / 1000);
}
export const hms = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':');
