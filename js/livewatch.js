// Pengawas CA: baca /live.json (no-store) tiap 20 dtk + saat tab aktif lagi.
// CA atau versi berubah → muat ulang sekali (kunci sessionStorage mencegah putaran).
import { SITE, CHAIN } from './config.js';

const buildMeta = document.querySelector('meta[name="build"]')?.content || 'dev';
let current = { ca: SITE.ca, launchUtc: SITE.launchUtc };
const subs = new Set();

export const shortCa = ca => ca ? ca.slice(0, 6) + '…' + ca.slice(-4) : '';
export function onLive(fn) { subs.add(fn); fn(current); return () => subs.delete(fn); }

async function poll(first) {
  try {
    const r = await fetch('/live.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    const ca = j.contractAddress || null;
    const changed = !first && (ca !== current.ca || (j.version && j.version !== 'dev' && j.version !== buildMeta));
    if (changed) {
      const k = 'mf.reload.' + (ca || '') + (j.version || '');
      if (!sessionStorage.getItem(k)) { sessionStorage.setItem(k, '1'); location.reload(); return; }
    }
    current = { ca, launchUtc: j.launchUtc || SITE.launchUtc };
    subs.forEach(fn => fn(current));
  } catch {}
}

poll(true);
setInterval(poll, 20_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

// Isi otomatis semua elemen [data-ca] / [data-buy] / [data-countdown]
onLive(({ ca, launchUtc }) => {
  document.querySelectorAll('[data-ca-text]').forEach(el => { el.textContent = ca || (launchUtc ? 'Drops at launch' : 'CA drops at launch'); });
  document.querySelectorAll('[data-ca-short]').forEach(el => { el.textContent = ca ? shortCa(ca) : 'Soon'; });
  document.querySelectorAll('[data-ca-state]').forEach(el => { el.dataset.caState = ca ? 'live' : 'pre'; });
  document.querySelectorAll('[data-buy]').forEach(el => {
    if (ca) { el.href = CHAIN.uniswap(ca); el.removeAttribute('aria-disabled'); }
    else { el.removeAttribute('href'); el.setAttribute('aria-disabled', 'true'); }
  });
});

// salin CA
document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy-ca]');
  if (!b || !current.ca) return;
  navigator.clipboard?.writeText(current.ca);
  b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 1400);
});
