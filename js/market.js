// Harga live 8 saham token di Robinhood Chain (GeckoTerminal, CORS terbuka, satu panggilan).
// Disimpan sementara 60 dtk di localStorage supaya pengunjung tidak menghabiskan jatah API.
import { SLOTS } from './config.js';

const URL_ = 'https://api.geckoterminal.com/api/v2/simple/networks/robinhood/token_price/'
  + SLOTS.map(s => s.token).join(',') + '?include_24hr_price_change=true';
const KEY = 'mf.prices.v1', TTL = 60_000;
const subs = new Set();
let last = null;

function readCache() {
  try { const c = JSON.parse(localStorage.getItem(KEY)); if (c && Date.now() - c.at < TTL) return c; } catch {}
  return null;
}

async function fetchNow() {
  // server sendiri dulu (cache bersama), GeckoTerminal sebagai cadangan
  for (const src of ['/api/prices', URL_]) {
    try {
      const r = await fetch(src, { cache: 'no-store' });
      if (!r.ok) continue;
      const j = await r.json();
      const data = j.slots ? j : normalize(j);
      if (!data) continue;
      data.at = Date.now();
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
      return data;
    } catch {}
  }
  return null;
}

function normalize(j) {
  const a = j?.data?.attributes; if (!a) return null;
  const slots = SLOTS.map(s => ({
    ticker: s.ticker,
    price: +a.token_prices?.[s.token] || null,
    ch24: a.h24_price_change_percentage?.[s.token] != null ? +a.h24_price_change_percentage[s.token] : null,
  }));
  return { slots, source: 'GeckoTerminal' };
}

async function tick() {
  const d = readCache() || await fetchNow();
  if (d) { last = d; subs.forEach(fn => fn(d)); }
}

export function onPrices(fn) {
  subs.add(fn);
  if (last) fn(last);
  if (subs.size === 1) { tick(); setInterval(tick, TTL); }
  return () => subs.delete(fn);
}

export const fmtPrice = v => v == null ? '—' : '$' + (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2));
export const fmtPct = v => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%';
