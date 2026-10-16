// Dompet tanpa pustaka besar: EIP-6963 (semua ekstensi dompet) + cadangan window.ethereum,
// pindah/tambah Robinhood Chain, tanda tangan pesan, kirim transaksi klaim, tunggu kuitansi.
import { CHAIN } from './config.js';

const CHAIN_HEX = '0x' + CHAIN.id.toString(16); // 0x1237
const SEL_CLAIM = '0x78f60b82';                  // claim(address,uint256[8],bytes32[])

const found = new Map();
addEventListener('eip6963:announceProvider', e => {
  const { info, provider } = e.detail || {};
  if (info?.uuid && provider) found.set(info.uuid, { info, provider });
});
dispatchEvent(new Event('eip6963:requestProvider'));

export function wallets() {
  const list = [...found.values()];
  if (!list.length && window.ethereum) list.push({ info: { uuid: 'injected', name: window.ethereum.isPhantom ? 'Phantom' : 'Browser wallet', icon: '' }, provider: window.ethereum });
  return list;
}

let active = null; // { provider, address, info }
const subs = new Set();
export const onWallet = fn => { subs.add(fn); fn(active); return () => subs.delete(fn); };
const emit = () => subs.forEach(fn => fn(active));
export const current = () => active;

export async function connect(entry) {
  const p = entry.provider;
  const [address] = await p.request({ method: 'eth_requestAccounts' });
  await ensureChain(p, entry.info);
  active = { provider: p, address: address.toLowerCase(), info: entry.info };
  p.on?.('accountsChanged', a => { if (!a?.length) disconnect(); else { active.address = a[0].toLowerCase(); emit(); } });
  p.on?.('chainChanged', () => emit());
  try { localStorage.setItem('mf.wallet', entry.info.uuid); } catch {}
  emit();
  return active;
}

export function disconnect() {
  active = null;
  try { localStorage.removeItem('mf.wallet'); } catch {}
  emit();
}

// pulihkan sambungan tanpa jendela pop-up kalau dompet masih mengizinkan
export async function restore() {
  let id = null;
  try { id = localStorage.getItem('mf.wallet'); } catch {}
  if (!id) return;
  await new Promise(r => setTimeout(r, 300));
  const entry = wallets().find(w => w.info.uuid === id) || wallets()[0];
  if (!entry) return;
  const acc = await entry.provider.request({ method: 'eth_accounts' }).catch(() => []);
  if (acc?.length) { active = { provider: entry.provider, address: acc[0].toLowerCase(), info: entry.info }; emit(); }
}

export async function ensureChain(p, info) {
  const cid = await p.request({ method: 'eth_chainId' }).catch(() => null);
  if (cid && cid.toLowerCase() === CHAIN_HEX) return;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
  } catch (e) {
    if (e?.code === 4001) throw new Error('Network switch was rejected in the wallet.');
    try {
      await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_HEX, chainName: CHAIN.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [CHAIN.rpc[1] || CHAIN.rpc[0]], blockExplorerUrls: [CHAIN.explorer] }] });
    } catch (e2) {
      if (p.isPhantom || /phantom/i.test(info?.name || '')) throw new Error('In Phantom, turn on Robinhood Chain first: Settings → Active Networks → Robinhood Chain.');
      throw new Error('Add Robinhood Chain to your wallet, then try again.');
    }
  }
}

const hex = s => '0x' + Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, '0')).join('');
export async function signMessage(message) {
  if (!active) throw new Error('Connect a wallet first.');
  return active.provider.request({ method: 'personal_sign', params: [hex(message), active.address] });
}

// ---- ABI kecil untuk claim()
const word = v => BigInt(v).toString(16).padStart(64, '0');
const addrWord = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
export function encodeClaim(account, cumulative, proof) {
  let d = SEL_CLAIM + addrWord(account) + cumulative.map(word).join('') + word(32 * 10) + word(proof.length);
  for (const p of proof) d += p.replace(/^0x/, '').padStart(64, '0');
  return d;
}

export async function sendTx(to, data) {
  if (!active) throw new Error('Connect a wallet first.');
  await ensureChain(active.provider, active.info);
  return active.provider.request({ method: 'eth_sendTransaction', params: [{ from: active.address, to, data }] });
}

export async function waitReceipt(hash, rpcCall, timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await rpcCall('eth_getTransactionReceipt', [hash]).catch(() => null);
    if (r) return r;
    await new Promise(res => setTimeout(res, 1500));
  }
  throw new Error('Still pending. Check the explorer.');
}

export const short = a => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
