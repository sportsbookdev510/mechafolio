// Ledger: semua angka dibaca dari kontrak lewat server (/api/ledger), diperbarui tiap 15 dtk.
import { SLOTS, CHAIN } from './config.js';
import { onPrices } from './market.js';
import { mountShell, api, fmtTok, fmtUsd, short } from './shell.js';

const $ = s => document.querySelector(s);
mountShell('ledger');
let L = null, prices = null;
const ex = (kind, v, txt) => `<a class="ext" href="${CHAIN.explorer}/${kind}/${v}" target="_blank" rel="noopener">${txt || short(v)}</a>`;
const eth = w => (Number(BigInt(w || 0)) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 4 });
const usdOf = (raw, i) => (Number(BigInt(raw || 0)) / 1e18) * (prices?.slots[i]?.price || 0);

async function refresh() {
  L = await api('/api/ledger').catch(() => null);
  render();
}
onPrices(d => { prices = d; render(); });

function render() {
  if (!L) return;
  const live = !!L.totalBought;
  $('#sEth').textContent = live ? eth(L.totalEthIn) + ' ETH' : '—';
  $('#sEthUsd').textContent = live ? `${L.opsBps / 100}% to operations · rest buys stocks` : 'Live once the engine is deployed';
  const bought = live ? L.totalBought.reduce((a, v, i) => a + usdOf(v, i), 0) : 0;
  const claimed = live ? L.totalClaimed.reduce((a, v, i) => a + usdOf(v, i), 0) : 0;
  $('#sBought').textContent = live ? fmtUsd(bought) : '—';
  $('#sClaimed').textContent = live ? fmtUsd(claimed) : '—';
  $('#sClaimedPct').textContent = live && bought ? `${((claimed / bought) * 100).toFixed(1)}% of all stocks bought` : '—';
  $('#sN').textContent = live ? String(L.harvestsCount) : '—';
  $('#sOps').textContent = live ? `${eth(L.totalOpsOut)} ETH to operations` : '—';

  $('#stocks tbody').innerHTML = SLOTS.map((s, i) => {
    const b = L.totalBought?.[i] || '0', c = L.totalClaimed?.[i] || '0', w = L.distBalances?.[i] || '0';
    const route = (L.routes?.[i] || []).map((p, k) => `<a class="ext" href="${CHAIN.explorer}/address/${p}" target="_blank" rel="noopener">pool ${k + 1}</a>`).join('');
    return `<tr><td><i class="sw" style="--co:${s.color}"></i>${s.part} · <b>${s.ticker}</b></td><td class="r mono">${fmtTok(b)}</td><td class="r mono">${fmtTok(c)}</td><td class="r mono">${fmtTok(w)}</td><td class="r mono">${fmtUsd(usdOf(b, i))}</td><td class="route">${route || '—'}</td></tr>`;
  }).join('');
  $('#distTag').innerHTML = L.contracts?.distributor ? ex('address', L.contracts.distributor, 'FolioDistributor') : 'FolioDistributor';

  const zero = '0x' + '0'.repeat(64);
  $('#rEpoch').textContent = L.epoch && L.epoch !== '0' ? new Date(Number(L.epoch) * 86400000).toISOString().slice(0, 10) + ` (#${L.epoch})` : 'none yet';
  $('#rRoot').textContent = L.root && L.root !== zero ? short(L.root) : '—';
  const pend = L.pendingRoot && L.pendingRoot !== zero;
  $('#rPend').textContent = pend ? short(L.pendingRoot) : 'none';
  $('#rAt').textContent = pend ? new Date(Number(L.pendingAt) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';
  $('#rDelay').textContent = L.delay ? `${Number(L.delay) / 3600} hours` : '—';
  $('#rootTag').textContent = pend ? 'Root waiting' : L.root && L.root !== zero ? 'Active' : 'Not started';
  $('#rootTag').className = 'tag-pill ' + (pend ? 'warn' : 'live');

  $('#weights').innerHTML = SLOTS.map((s, i) => { const w = (L.weightsNow?.[i] || 0) / 100; return `<div style="--co:${s.color}"><span>${s.ticker}</span><div class="bar"><i style="width:${Math.min(100, w * 3)}%"></i></div><span>${w.toFixed(1)}%</span></div>`; }).join('');

  $('#harvests tbody').innerHTML = (L.harvests || []).length ? L.harvests.map(h => `<tr><td class="mono">${h.n}</td><td class="mono">${ex('block', h.block, '#' + h.block.toLocaleString('en-US'))}</td><td class="r mono">${eth(h.ethIn)}</td><td class="r mono">${eth(h.opsOut)}</td><td class="r mono">${eth(h.wethSpent)}</td><td class="mono dim">${h.bought.map((b, i) => (BigInt(b) > 0n ? SLOTS[i].ticker : null)).filter(Boolean).join(' · ') || 'none'}</td><td>${ex('tx', h.tx, short(h.tx))}</td></tr>`).join('')
    : '<tr><td colspan="7" class="empty">No harvest yet. The keeper harvests fees about once an hour after launch.</td></tr>';

  $('#epochs tbody').innerHTML = (L.epochs || []).length ? L.epochs.map(e => `<tr><td class="mono">${new Date(e.epoch * 86400000).toISOString().slice(0, 10)}</td><td class="r mono">${e.pilots}</td><td class="mono">${e.root ? short(e.root) : '—'}</td><td><a class="ext" href="/api/epoch/${e.epoch}.json" target="_blank" rel="noopener">JSON</a></td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">The first epoch closes at 00:00 UTC after launch.</td></tr>';

  const C = L.contracts || {};
  $('#contracts').innerHTML = [['$FOLIO token', C.folio], ['Pons curve', C.curve], ['FolioEngine', C.engine], ['FolioDistributor', C.distributor]]
    .map(([n, a]) => `<div><span class="k">${n}</span>${a ? ex('address', a, a) : '<span class="dim mono">at launch</span>'}</div>`).join('');
}

refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 15000);
