const { dbManager } = require('../src/services/dbManager');

const BUY_DUST = 0.015;
const WAVE_MS = 2000;
const LAUNCH_WIN_MS = 90000;

async function firstExecSig(sb, expId, token) {
  const { data } = await sb.from('strategy_signals').select('created_at,metadata')
    .eq('experiment_id', expId).eq('token_address', token).eq('signal_type', 'BUY')
    .order('created_at', { ascending: true }).limit(30);
  for (const s of data || []) if ((s.metadata || {}).execution_status === 'executed') return s;
  return null;
}

async function resolveToken(sb, expId, symbolLike) {
  const { data } = await sb.from('trades').select('token_address')
    .eq('experiment_id', expId).eq('trade_direction', 'buy').eq('trade_status', 'success')
    .ilike('token_symbol', symbolLike).limit(1);
  return data && data[0] && data[0].token_address;
}

async function analyze(sb, expId, token, label) {
  const sig = await firstExecSig(sb, expId, token);
  if (!sig) { console.log(`${label}: 无成交信号`); return; }
  const tStar = new Date(sig.created_at).getTime();
  const { data: ticks } = await sb.from('wss_price_ticks')
    .select('block_number,block_time,trade_type,bnb_amount,sender_address,trader_address')
    .eq('token_address', token).gt('block_number', 0)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(900);
  const tsAll = ticks || [];
  if (!tsAll.length) return;
  const t0 = new Date(tsAll[0].block_time).getTime();
  const wallet = r => (r.sender_address || r.trader_address || '').toLowerCase();
  const launchRows = tsAll.filter(r => new Date(r.block_time).getTime() - t0 <= LAUNCH_WIN_MS);
  const fb = launchRows[0].block_number;
  const fbTs = new Date(launchRows[0].block_time).getTime();
  const wBuys = new Map(); const firstBuyBlk = new Map();
  for (const r of launchRows) {
    if (r.trade_type !== 'buy') continue;
    const w = wallet(r); if (!w) continue;
    const amt = Number(r.bnb_amount || 0);
    wBuys.set(w, (wBuys.get(w) || 0) + amt);
    if (!firstBuyBlk.has(w)) firstBuyBlk.set(w, r.block_number);
  }
  const blkFirstTs = new Map();
  for (const r of launchRows) if (!blkFirstTs.has(r.block_number)) blkFirstTs.set(r.block_number, new Date(r.block_time).getTime());
  const sizedW = w => (wBuys.get(w) || 0) >= BUY_DUST;
  const waveBlks = new Set();
  for (const [blk, tsMs] of blkFirstTs) if (blk > fb && tsMs - fbTs <= WAVE_MS) waveBlks.add(blk);
  const waveWallets = new Set();
  for (const [w, blk] of firstBuyBlk) if ((blk === fb || waveBlks.has(blk)) && sizedW(w)) waveWallets.add(w);
  let waveBuy = 0, waveSell = 0;
  for (const r of tsAll) {
    const ts = new Date(r.block_time).getTime();
    if (ts > tStar) break;
    const w = wallet(r);
    if (!waveWallets.has(w)) continue;
    const amt = Number(r.bnb_amount || 0);
    if (r.trade_type === 'buy') waveBuy += amt; else waveSell += amt;
  }
  const residue = waveBuy - waveSell;
  const pct = waveBuy > 0 ? (residue / waveBuy * 100).toFixed(0) : '-';
  console.log(`${label}: wave=${waveWallets.size} | wave买(到t*)=${waveBuy.toFixed(2)}B | 已卖 ${waveSell.toFixed(2)}B | 残留 ${residue.toFixed(2)}B (${pct}%) | 买点age=${((tStar - t0) / 1000).toFixed(0)}s`);
}

async function main() {
  const sb = dbManager.getClient();
  const E156 = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
  const E153 = 'd3453504-03d5-480c-89e0-483db930361c';
  const list = [
    [E156, 'えみやしろう', '主案 えみやしろう   pnl=-0.049'],
    [E156, 'DND', 'DND                pnl=-0.063'],
    [E156, 'Burn', 'Burn               pnl=-0.047'],
    [E156, '小白', '小白               pnl=-0.028'],
    [E156, '社保', '社保               pnl=-0.027'],
    [E156, 'AZ', 'AZ                 pnl=-0.026'],
    [E156, '我的人生', '我的人生(正票)      pnl=+0.042'],
    [E156, '糖糖', '糖糖(正票)          pnl=+0.021'],
    [E153, 'Tiltpad', 'Tiltpad(肉票)       pnl=+0.48'],
    [E153, '苏琳', '苏琳               pnl=-0.036'],
    [E153, 'Nola', 'Nola               pnl=-0.038'],
    [E153, '塔塔', '塔塔               pnl=-0.013'],
    [E153, '大烧心', '大烧心             pnl=+0.007'],
    [E153, '老鼠舞', '老鼠舞             pnl=+0.002'],
  ];
  for (const [e, sym, l] of list) {
    try {
      const t = await resolveToken(sb, e, sym);
      if (!t) { console.log(`${l}: symbol 未找到(${sym})`); continue; }
      await analyze(sb, e, t, l);
    } catch (err) { console.log(`${l}: ERR ${err.message}`); }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
