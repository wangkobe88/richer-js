// 组 3 深挖（tmp 不 commit）：①CD8 GMGN bundler 信号形状 ②CD10 sbHold 97.7% 分子分母 ③CD12 0.1 带聚带为何非 strong
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');

const RPC = 'https://bsc-dataseed.binance.org/';
const COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,trader_address,sender_address';

const CASES = {
  CD8: { addr: '0xc2d78d35799020b122bc4284406c018a81c47777', n: 44 },
  CD10: { addr: '0xc5509930f60b645e41ff64243d7d4f85556c7777', n: 29 },
  CD12: { addr: '0xa2bb18e96da275bc8a8fd7f6b6f26afb630f7777', n: 49 },
};

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

async function pull(sb, addr, n) {
  const { data, error } = await sb.from('wss_price_ticks').select(COLS).eq('token_address', addr)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(n);
  if (error) throw new Error(error.message);
  return data ?? [];
}

const w2 = (s) => (s || 'null').slice(0, 10);

// ── 题面带宽聚带（带内 max/min ≤1.5，贪心升序）──
function band15(buys) {
  const arr = [...buys].sort((a, b) => a.bnb - b.bnb);
  const out = [];
  for (const t of arr) {
    const last = out[out.length - 1];
    if (last && t.bnb <= last.max * 1.5) { last.max = t.bnb; last.rows.push(t); }
    else out.push({ min: t.bnb, max: t.bnb, rows: [t] });
  }
  return out;
}

async function main() {
  const sb = dbManager.getClient();

  // ═ ① CD8 bundler ═
  const TX = '0xf5f8cbee85f0a35568a7d97f01d8a382cb4bc6b54e9db1465bb472d5fb2a24fc';
  const [tx, rc] = [await rpc('eth_getTransactionByHash', [TX]), await rpc('eth_getTransactionReceipt', [TX])];
  console.log('══① CD8 用户给的 tx 形状══');
  console.log(`from=${tx.from} to=${tx.to} block=${parseInt(tx.blockNumber, 16)} nonce=${parseInt(tx.nonce, 16)} status=${rc.status}`);
  console.log(`selector=${tx.input.slice(0, 10)} inputBytes=${(tx.input.length - 2) / 2} logs=${rc.logs.length}`);
  const logAddr = {};
  for (const l of rc.logs) logAddr[l.address.toLowerCase()] = (logAddr[l.address.toLowerCase()] || 0) + 1;
  console.log('logs by contract:', JSON.stringify(logAddr));
  const t0 = {};
  for (const l of rc.logs) t0[l.topics[0].slice(0, 18)] = (t0[l.topics[0].slice(0, 18)] || 0) + 1;
  console.log('topics0(截断):', JSON.stringify(t0));

  const cd8 = await pull(sb, CASES.CD8.addr, 24);
  console.log(`\n-- CD8 前 ${cd8.length} 行（链上真序）--`);
  for (const r of cd8) {
    console.log(`blk=${r.block_number} li=${r.log_index} tx=${(r.tx_hash || '').slice(0, 14)} ${r.trade_type} bnb=${Number(r.bnb_amount).toFixed(4)} sender=${w2(r.sender_address)} trader=${w2(r.trader_address)}`);
  }
  const fb = cd8.filter((r) => String(r.trade_type).toUpperCase() === 'BUY').slice(0, 8);
  const byTx = {}, bySender = {};
  for (const r of fb) { byTx[r.tx_hash] = (byTx[r.tx_hash] || 0) + 1; bySender[r.sender_address || 'null'] = (bySender[r.sender_address || 'null'] || 0) + 1; }
  console.log(`前 8 买（${fb.length} 行）tx_hash 分布:`);
  for (const [k, v] of Object.entries(byTx)) console.log(`  ${k} ×${v}`);
  console.log('前 8 买 sender(tx.from) 分布:');
  for (const [k, v] of Object.entries(bySender)) console.log(`  ${k} ×${v}`);

  // ═ ② CD10 sbHold 分子分母 ═
  const cd10 = await pull(sb, CASES.CD10.addr, CASES.CD10.n);
  const snap10 = buildSnapshotFromRows(cd10, {}, { anchorTickCount: CASES.CD10.n });
  console.log(`\n══② CD10 sbHold 复算（代码锚=${snap10.sameBlockHoldPct?.toFixed(1)}%）══`);
  const ticks10 = cd10.map((r) => ({
    block: r.block_number, side: String(r.trade_type).toUpperCase(),
    bnb: Number(r.bnb_amount) || 0, wallet: (r.sender_address || r.trader_address || '').toLowerCase(),
  }));
  const blk = new Map();
  for (const t of ticks10) if (t.side === 'BUY' && t.block !== null) {
    if (!blk.has(t.block)) blk.set(t.block, []);
    blk.get(t.block).push(t);
  }
  const sbMembers = new Set();
  for (const [b, arr] of blk) if (arr.length >= 3) for (const t of arr) if (t.wallet) sbMembers.add(t.wallet);
  console.log('簇块（BUY≥3 行）明细:');
  for (const [b, arr] of [...blk.entries()].sort((x, y) => y[1].length - x[1].length)) {
    if (arr.length >= 3) console.log(`  blk=${b} 笔=${arr.length} 钱包=${new Set(arr.map((t) => t.wallet)).size} Σ=${arr.reduce((s, t) => s + t.bnb, 0).toFixed(3)}B`);
  }
  const net = new Map();
  for (const t of ticks10) net.set(t.wallet, (net.get(t.wallet) || 0) + (t.side === 'BUY' ? t.bnb : -t.bnb));
  const pos = [...net.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const posTotal = pos.reduce((s, [, v]) => s + v, 0);
  const inSb = pos.filter(([w]) => sbMembers.has(w));
  const numer = inSb.reduce((s, [, v]) => s + v, 0);
  console.log(`全场正净持仓 Σ=${posTotal.toFixed(3)}B（${pos.length} 钱包）`);
  console.log(`簇成员正净持仓 Σ=${numer.toFixed(3)}B（${inSb.length} 钱包）→ ${((numer / posTotal) * 100).toFixed(1)}%`);
  console.log('正净持仓钱包明细（簇成员标*）:');
  for (const [w, v] of pos) console.log(`  ${sbMembers.has(w) ? '*' : ' '} ${w} 净=${v.toFixed(3)}B`);

  // ═ ③ CD12 0.1 带聚带 ═
  const cd12 = await pull(sb, CASES.CD12.addr, CASES.CD12.n);
  console.log(`\n══③ CD12 聚带分析（代码锚 sb=32.1% eq=8.0% 取自 run.mjs 存档）══`);
  const ticks12 = cd12.map((r) => ({
    block: r.block_number, side: String(r.trade_type).toUpperCase(),
    bnb: Number(r.bnb_amount) || 0, wallet: (r.sender_address || r.trader_address || '').toLowerCase(),
    dt: r.block_time,
  }));
  const buys12 = ticks12.filter((t) => t.side === 'BUY');
  const sumBuy = buys12.reduce((s, t) => s + t.bnb, 0);
  console.log(`窗=${ticks12.length} 行 买=${buys12.length} 笔 Σ买=${sumBuy.toFixed(3)}B`);
  const bands = band15(buys12.filter((t) => t.bnb > 0));
  console.log('题面带宽（≤1.5）聚带（只列 ≥3 笔带）:');
  for (const b of bands) {
    const wallets = new Set(b.rows.map((t) => t.wallet));
    const share = (b.rows.reduce((s, t) => s + t.bnb, 0) / sumBuy) * 100;
    if (b.rows.length >= 3) console.log(`  带 ${b.min.toFixed(4)}~${b.max.toFixed(4)} 笔=${b.rows.length} 钱包=${wallets.size} Σ=${b.rows.reduce((s, t) => s + t.bnb, 0).toFixed(3)}B 买入占比=${share.toFixed(1)}%`);
  }
  const b01 = bands.filter((b) => b.min >= 0.09 && b.max <= 0.16);
  for (const b of b01) {
    if (b.rows.length < 3) continue;
    console.log('0.1 档明细:');
    for (const t of b.rows) console.log(`  blk=${t.block} ${t.wallet.slice(0, 10)} bnb=${t.bnb.toFixed(4)} dt=${String(t.dt).slice(11, 19)}`);
  }
  const blk12 = new Map();
  for (const t of buys12) {
    if (!blk12.has(t.block)) blk12.set(t.block, []);
    blk12.get(t.block).push(t);
  }
  console.log('同块 BUY 分布（≥3 笔块）:');
  for (const [b, arr] of [...blk12.entries()].sort((x, y) => y[1].length - x[1].length)) {
    if (arr.length >= 3) console.log(`  blk=${b} 笔=${arr.length} 钱包=${new Set(arr.map((t) => t.wallet)).size} 金额=${arr.map((t) => t.bnb.toFixed(3)).join(',')} Σ=${arr.reduce((s, t) => s + t.bnb, 0).toFixed(3)}B`);
  }
  const net12 = new Map();
  for (const t of ticks12) net12.set(t.wallet, (net12.get(t.wallet) || 0) + (t.side === 'BUY' ? t.bnb : -t.bnb));
  const w01 = new Set();
  for (const b of b01) if (b.rows.length >= 3) for (const t of b.rows) w01.add(t.wallet);
  const pos12 = [...net12.entries()].filter(([, v]) => v > 0);
  const pos12T = pos12.reduce((s, [, v]) => s + v, 0);
  const hold01 = pos12.filter(([w]) => w01.has(w)).reduce((s, [, v]) => s + v, 0);
  console.log(`0.1 档簇成员（${w01.size} 钱包）正净持仓=${hold01.toFixed(3)}B ÷ 全场 ${pos12T.toFixed(3)}B = ${((hold01 / pos12T) * 100).toFixed(1)}%`);
  console.log('0.1 档钱包净持仓明细:');
  for (const w of w01) console.log(`  ${w} 净=${(net12.get(w) || 0).toFixed(3)}B`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
