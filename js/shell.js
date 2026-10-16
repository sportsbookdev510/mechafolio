// Kerangka bersama halaman aplikasi (Hangar, Arena, Yard, Ledger, Docs):
// HUD atas (logo, tautan halaman, status chain, CA, sosial, Buy, dompet), menu, panel harga bawah.
import { SITE, SLOTS } from './config.js';
import { onPrices, fmtPrice, fmtPct } from './market.js';
import { onBlock, nextDuel, hms } from './chain.js';
import { wallets, connect, disconnect, onWallet, restore, short } from './wallet.js';

export const api = async (path, opts) => {
  const r = await fetch(path, { cache: 'no-store', ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
};
export const rpcCall = async (method, params) => {
  const j = await api('/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (j.error) throw new Error(j.error.message);
  return j.result;
};

const PAGES = [['hangar', 'Hangar'], ['arena', 'Arena'], ['yard', 'Yard'], ['ledger', 'Ledger'], ['docs', 'Docs']];

export function mountShell(page) {
  document.body.insertAdjacentHTML('afterbegin', `
  <header class="top">
    <a class="brand" href="/" aria-label="MECHAFOLIO home"><img class="brand-mark" src="/logo.png" alt=""><span class="brand-word">MECHAFOLIO</span></a>
    <nav class="pages" aria-label="Pages">${PAGES.map(([id, n]) => `<a href="/${id}"${id === page ? ' aria-current="page"' : ''}>${n}</a>`).join('')}</nav>
    <div class="status" aria-label="Live status">
      <div class="st"><span class="k"><i class="led" id="led"></i>Chain</span><span class="v mono" id="stBlock">—</span></div>
      <div class="st hide-md"><span class="k">UTC</span><span class="v mono" id="stClock">--:--:--</span></div>
      <div class="st"><span class="k">Next duel</span><span class="v mono" id="stDuel">--:--:--</span></div>
    </div>
    <div class="actions">
      <button class="ca-chip" data-copy-ca data-ca-state="pre" title="Contract address"><span class="ca-k">CA</span><span class="ca-v" data-ca-short>0x5fd9547b0a9a75b8a3b0b60a4714974cfea5e411</span><svg class="ic"><use href="/assets/brand/symbols.svg#i-copy"/></svg></button>
      <a class="icon-btn" href="${SITE.x}" target="_blank" rel="noopener" aria-label="X"><svg><use href="/assets/brand/symbols.svg#i-x"/></svg></a>
      <button class="btn btn-accent btn-sm wallet-btn" id="walletBtn">Connect</button>
      <button class="menu-btn" id="menuBtn" aria-expanded="false" aria-controls="menu"><span>Menu</span><i></i></button>
    </div>
  </header>
  <nav class="menu" id="menu" aria-label="Pages" hidden><div class="menu-in">
    <a href="/"><b>00</b><strong>Home</strong><span>The frame, the parts, the duel.</span></a>
    ${PAGES.map(([id, n], i) => `<a href="/${id}"><b>${String(i + 1).padStart(2, '0')}</b><strong>${n}</strong><span>${{ hangar: 'Your frame, your parts, your claim.', arena: 'Daily duels at 20:00 UTC, with replays.', yard: 'Every pilot\'s mech in one yard.', ledger: 'Fees in, stocks bought, roots out.', docs: 'How it all works, and the risks.' }[id]}</span></a>`).join('')}
    <div class="menu-links"><span class="k">Official</span><a href="${SITE.x}" target="_blank" rel="noopener">X · ${SITE.xHandle}</a><a href="/">${SITE.domain}</a></div>
  </div></nav>
  <div class="wallet-pick" id="walletPick" hidden><div class="wp-in hud"><div class="wp-head"><strong>Connect a wallet</strong><button class="wp-x" aria-label="Close">×</button></div><div class="wp-list" id="wpList"></div><p class="fine">Robinhood Chain. Signing in never costs gas. MECHAFOLIO never asks for your seed phrase.</p></div></div>`);
  document.body.insertAdjacentHTML('beforeend', `<div class="dock" id="dock" aria-label="Live stock token prices"></div>`);

  // menu
  const menu = document.getElementById('menu'), menuBtn = document.getElementById('menuBtn');
  const setMenu = open => { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', open); };
  menuBtn.addEventListener('click', () => setMenu(menu.hidden));
  menu.addEventListener('click', e => { if (e.target === menu) setMenu(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape') { setMenu(false); pick.hidden = true; } });

  // status
  onBlock(s => {
    document.getElementById('led').classList.toggle('ok', s.ok);
    document.getElementById('stBlock').textContent = s.block ? '#' + s.block.toLocaleString('en-US') : 'offline';
  });
  const clock = () => { document.getElementById('stClock').textContent = new Date().toISOString().slice(11, 19); document.getElementById('stDuel').textContent = hms(nextDuel()); };
  clock(); setInterval(clock, 1000);

  // panel harga
  onPrices(d => {
    document.getElementById('dock').innerHTML = SLOTS.map((s, i) => {
      const r = d.slots[i] || {}, c = r.ch24 > 0 ? 'up' : r.ch24 < 0 ? 'down' : '';
      return `<div class="cell" style="--co:${s.color}"><span class="ct">${s.ticker}</span><span class="cp">${s.part}</span><span class="cv">${fmtPrice(r.price)}</span><span class="cc ${c}">${fmtPct(r.ch24)}</span></div>`;
    }).join('');
  });

  // dompet
  const btn = document.getElementById('walletBtn'), pick = document.getElementById('walletPick'), list = document.getElementById('wpList');
  pick.querySelector('.wp-x').addEventListener('click', () => (pick.hidden = true));
  pick.addEventListener('click', e => { if (e.target === pick) pick.hidden = true; });
  btn.addEventListener('click', () => {
    if (btn.dataset.state === 'on') { if (confirm('Disconnect this wallet from MECHAFOLIO?')) disconnect(); return; }
    openPicker();
  });
  function openPicker() {
    const ws = wallets();
    list.innerHTML = ws.length
      ? ws.map((w, i) => `<button class="wp-item" data-i="${i}">${w.info.icon ? `<img src="${w.info.icon}" alt="">` : '<i></i>'}<span>${w.info.name}</span></button>`).join('')
      : `<p class="wp-empty">No wallet found in this browser. Install a wallet that supports Robinhood Chain (MetaMask, Rabby, Phantom), or open this page inside your wallet's browser.</p>`;
    pick.hidden = false;
    list.querySelectorAll('.wp-item').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await connect(ws[+b.dataset.i]); pick.hidden = true; }
      catch (e) { toast(e.message || 'Connection failed'); }
      finally { b.disabled = false; }
    }));
  }
  onWallet(w => {
    btn.dataset.state = w ? 'on' : 'off';
    btn.textContent = w ? short(w.address) : 'Connect';
  });
  restore();
  return { openPicker };
}

export function toast(msg, kind = '') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.append(t); }
  t.textContent = msg; t.dataset.kind = kind; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 4200);
}

export const fmtTok = (raw, dp = 4) => {
  const v = Number(BigInt(raw || 0)) / 1e18;
  if (v === 0) return '0';
  if (v < 0.0001) return '<0.0001';
  return v.toLocaleString('en-US', { maximumFractionDigits: dp });
};
export const fmtUsd = v => (v == null || !isFinite(v) ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 }));
export { fmtPrice, fmtPct, short };
