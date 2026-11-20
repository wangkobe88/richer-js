#!/usr/bin/env node
// 新增 7 址作弊钱包误伤面评估(bt-v153=10-12 36h 窗口,182 跑)
// 口径:G5 veto=cheatCrewBuyBnb==0,fire 时刻名单钱包累计买入>0 即拦。
//   成交票:我们首买成交时刻前名单已买 → 该票被拦 → 对照两组实际盈亏
//   信号票:fired BUY 信号 fire 时刻前在场 → 被拦信号数
//   全域:7 址在窗口全部票的足迹(搅和度,含我们没碰的票)
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const { dbManager } = require('../src/services/dbManager');

const EXP = 'd3453504-03d5-480c-89e0-483db930361c';
const R = p => path.join(__dirname, '..', p);
const lc = s => (s || '').toLowerCase();

const NEW7 = [
  '0x9d41e99374e4bceebb4c0bd070e814e72b7e7ace', '0xd80bf2b4d8158b21da727c3a510284a5f73747c3',
  '0xf7a934528d38e2f2865a7cd30c335c6d115928b8', '0xf90026d86fb41f02a2be73345a8904d0b003ff6d',
  '0x9a213971f8749e087c6f8d5f5d1daabef0e14191', '0xc8c2c361142fda8a8ee5a807972fbfa9eb4f5a51',
  '0xa44039d10d4883a7353ee729a48fda88fa5d2333',
];
const V1_6 = [
  '0x06f0a63c7f3df29d855c84c6cbfc55f35abc1cfc', '0x0b2259e10d494f848ea1458acb39152ad9865424',
  '0x727864fad9aef9b1049b1a724c66d2f91ecc0bf2', '0x27ac0351e225a15fb13d6b84a8dc31d799d0fe76',
  '0x66c81cf68a6bfb01a1885be28f01a588be477231', '0x1bd3c9ac6f9a4204aa7ededcf3a7afe16b3f644e',
];
const ALL13 = new Set([...NEW7, ...V1_6].map(lc));
const SHORT = w => w.slice(0, 10);

// token -> { wallet -> {firstDt, bnb} }（名单钱包的买入足迹）
const trace = new Map();
const tokenTotal = new Set();

async function scanCache() {
  for (const f of ['fourmeme.jsonl.gz', 'flap.jsonl.gz']) {
    const fp = R('data/tick-cache/backtest/win-20261012t000000000z_20261013t120000000z/' + f);
    if (!fs.existsSync(fp)) { console.log('skip', f); continue; }
    const rl = readline.createInterface({ input: fs.createReadStream(fp).pipe(zlib.createGunzip()) });
    for await (const line of rl) {
      let r; try { r = JSON.parse(line); } catch { continue; }
      const t = lc(r.token_address);
      tokenTotal.add(t);
      if (r.trade_type !== 'buy') continue;
      const w = lc(r.sender_address) || lc(r.trader_address);
      if (!ALL13.has(w)) continue;
      if (!trace.has(t)) trace.set(t, new Map());
      const m = trace.get(t);
      if (!m.has(w)) m.set(w, { firstDt: Date.parse(r.block_time), bnb: 0 });
      const e = m.get(w);
      e.bnb += Number(r.bnb_amount) || 0;
      if (Date.parse(r.block_time) < e.firstDt) e.firstDt = Date.parse(r.block_time);
    }
    console.log(`[scan] ${f} done`);
  }
  console.log(`[scan] 窗口 token 总数 ${tokenTotal.size},名单足迹票数 ${trace.size}`);
}

function presentAt(t, dtMs, pool) {
  const m = trace.get(t);
  if (!m) return [];
  const out = [];
  for (const [w, e] of m) if ((pool ? pool.has(w) : true) && e.firstDt <= dtMs && e.bnb >= 0.001) out.push(w);
  return out;
}

async function main() {
  await scanCache();
  const sb = dbManager.getClient();

  // 成交票盈亏(现金流口径)
  const tr = await sb.from('trades').select('token_address,trade_direction,input_amount,output_amount,success,executed_at')
    .eq('experiment_id', EXP).order('executed_at').limit(3000);
  if (tr.error) throw tr.error;
  const pnl = new Map(), firstBuy = new Map();
  for (const t of tr.data) {
    if (!t.success) continue;
    const tok = lc(t.token_address);
    if (!pnl.has(tok)) pnl.set(tok, 0);
    if (t.trade_direction === 'buy') {
      pnl.set(tok, pnl.get(tok) - (Number(t.input_amount) || 0));
      const et = Date.parse(t.executed_at);
      if (!firstBuy.has(tok) || et < firstBuy.get(tok)) firstBuy.set(tok, et);
    } else pnl.set(tok, pnl.get(tok) + (Number(t.output_amount) || 0));
  }

  console.log(`\n══ 1. 成交票误伤面(我们首买时刻前名单已进场 → G5 会拦) ══`);
  for (const [label, pool] of [['新增 7 址', new Set(NEW7)], ['v1 6 址(已生效,对照)', new Set(V1_6)], ['全 13 址', ALL13]]) {
    let blocked = 0, blockedPnl = 0, kept = 0, keptPnl = 0;
    const blockedRows = [];
    for (const [tok, p] of pnl) {
      const fb = firstBuy.get(tok);
      if (fb == null) continue;
      const present = presentAt(tok, fb, pool);
      if (present.length) { blocked++; blockedPnl += p; blockedRows.push({ tok, p, present }); }
      else { kept++; keptPnl += p; }
    }
    console.log(`\n【${label}】被拦成交票 ${blocked} 个 盈亏 ${blockedPnl.toFixed(4)}(拦=止损面) | 放行 ${kept} 个 盈亏 ${keptPnl.toFixed(4)} | 净效应(被拦票盈亏) ${blockedPnl >= 0 ? '⚠误伤(被拦票本来是正的)' : '止血'}`);
    blockedRows.sort((a, b) => b.p - a.p);
    console.log(`  被拦票中盈利 top5(误伤风险点):`);
    for (const r of blockedRows.slice(0, 5)) console.log(`    ${r.tok.slice(0, 14)} ${r.p.toFixed(4)} ← ${r.present.map(SHORT).join(',')}`);
    console.log(`  被拦票中亏损 top5(止血点):`);
    for (const r of blockedRows.slice(-5).reverse()) if (r.p < 0) console.log(`    ${r.tok.slice(0, 14)} ${r.p.toFixed(4)} ← ${r.present.map(SHORT).join(',')}`);
  }

  console.log(`\n══ 2. 信号面(fired BUY 信号,fire 时刻前在场 → 信号被拦不成交) ══`);
  const sig = await sb.from('strategy_signals').select('token_address,created_at').eq('experiment_id', EXP)
    .eq('signal_type', 'BUY').order('created_at').limit(3000);
  if (sig.error) throw sig.error;
  const pool7 = new Set(NEW7);
  let sigBlocked = 0, sigTotal = 0, firstFire = new Map();
  for (const s of sig.data) {
    sigTotal++;
    const tok = lc(s.token_address);
    const dt = Date.parse(s.created_at);
    if (!firstFire.has(tok) || dt < firstFire.get(tok)) firstFire.set(tok, dt);
    if (presentAt(tok, dt, pool7).length) sigBlocked++;
  }
  console.log(`BUY 信号 ${sigTotal} 条,新增 7 址在场被拦 ${sigBlocked} 条(${(sigBlocked / sigTotal * 100).toFixed(1)}%)`);

  console.log(`\n══ 3. 全域搅和度(窗口全部 ${tokenTotal.size} 票,含我们没碰的) ══`);
  const foot = new Map();
  for (const [t, m] of trace) for (const w of m.keys()) foot.set(w, (foot.get(w) || 0) + 1);
  for (const [w, n] of [...foot.entries()].sort((a, b) => b[1] - a[1])) {
    const isNew = pool7.has(w);
    console.log(`  ${w} ${SHORT(w)} 足迹 ${n} 票(${(n / tokenTotal.size * 100).toFixed(1)}%) ${isNew ? '★新增' : 'v1'}`);
  }
  console.log('\n[done]');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
