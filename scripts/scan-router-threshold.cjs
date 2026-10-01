#!/usr/bin/env node
// ============================================================================
// earlyTradesRouterPct 阈值扫描（2026-10-01；182 专用）
//
// 用法：node scripts/scan-router-threshold.cjs --exp <experiment_id>
//
// 数据集 = 无 router 门的买门实跑/回测实验（如 61b716c6，buy-v2 v3：叙事门 +
// top1 门，无 router 门）——每张 buy signal 的 metadata.preBuyCheckFactors 已带
// earlyTradesRouterPct/earlyTradesRouterCovered，构成「假想加门」扫描集：
//   对候选阈值 θ：假想追加 `earlyTradesRouterPct < θ`（covered==1 且 pct>=θ 拦），
//   汇总被拦票的 FIFO PnL → 避免亏损 / 放弃盈利 / 净效应。
// 判定粒度 = token 首张 buy signal（窗口滑动后再进的再入场忽略，高门限下略保守）。
// 净额口径 = compare-debounce-pair.cjs 同款 FIFO。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
function argVal(name) {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) { console.error(`缺参数 ${name}`); process.exit(1); }
  return args[i + 1];
}
const EXP = argVal('--exp');

async function pullTrades(client, expId) {
  const all = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await client.from('trades')
      .select('token_address, trade_direction, input_amount, output_amount, unit_price, trade_status, success')
      .eq('experiment_id', expId).order('created_at', { ascending: true }).range(off, off + 999);
    if (error) throw new Error(`trades 查询失败: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

async function pullBuySignals(client, expId) {
  const all = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await client.from('strategy_signals')
      .select('token_address, created_at, metadata')
      .eq('experiment_id', expId).eq('action', 'buy')
      .order('created_at', { ascending: true }).range(off, off + 999);
    if (error) throw new Error(`signals 查询失败: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

/** FIFO per-token PnL（对拍脚本同款） */
function tokenPnL(trades) {
  const byToken = new Map();
  for (const t of trades) {
    if (!(t.success === true || t.trade_status === 'success')) continue;
    const isBuy = (t.trade_direction || '').toLowerCase() === 'buy';
    const rec = byToken.get(t.token_address) || { spent: 0, received: 0, buys: 0, sells: 0, leftoverCost: 0, queue: [] };
    const inAmt = parseFloat(t.input_amount || 0);
    const outAmt = parseFloat(t.output_amount || 0);
    if (isBuy) {
      if (outAmt > 0) { rec.queue.push({ amount: outAmt, cost: inAmt }); rec.spent += inAmt; rec.buys++; }
    } else {
      let remaining = inAmt;
      while (remaining > 0 && rec.queue.length > 0) {
        const oldest = rec.queue[0];
        const sellAmt = Math.min(remaining, oldest.amount);
        const unitCost = oldest.cost / oldest.amount;
        oldest.amount -= sellAmt;
        oldest.cost -= unitCost * sellAmt;
        remaining -= sellAmt;
        if (oldest.amount <= 1e-8) rec.queue.shift();
      }
      rec.received += outAmt;
      rec.sells++;
    }
    byToken.set(t.token_address, rec);
  }
  const out = new Map();
  for (const [tok, rec] of byToken) {
    rec.leftoverCost = rec.queue.reduce((s, q) => s + q.cost, 0);
    rec.net = rec.received - rec.spent;
    out.set(tok, rec);
  }
  return out;
}

function fmt(n) { return (n >= 0 ? '+' : '') + n.toFixed(4); }

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const client = dbManager.getClient();

  const trades = await pullTrades(client, EXP);
  const signals = await pullBuySignals(client, EXP);
  const pnl = tokenPnL(trades);

  // 每 token 首张 buy signal 的因子（判定粒度）
  const firstSig = new Map();
  for (const s of signals) {
    if (!firstSig.has(s.token_address)) firstSig.set(s.token_address, s);
  }

  // 成交票（假想加门的作用域）与被拦票（侧观测：两门重叠度）
  const filled = [], blocked = [];
  let noFactor = 0;
  for (const [tok, rec] of pnl) {
    const sig = firstSig.get(tok);
    const f = (sig && sig.metadata && sig.metadata.preBuyCheckFactors) || null;
    const pct = f ? f.earlyTradesRouterPct : null;
    const cov = f ? f.earlyTradesRouterCovered : null;
    if (f == null || pct == null) noFactor++;
    filled.push({ tok, pct, cov, signals: 0, net: rec.net, realized: rec.net + rec.leftoverCost > rec.leftoverCost ? rec.net : rec.net });
  }
  for (const [tok] of firstSig) {
    if (pnl.has(tok)) continue;
    const f = firstSig.get(tok).metadata?.preBuyCheckFactors || null;
    blocked.push({ tok, pct: f ? f.earlyTradesRouterPct : null, cov: f ? f.earlyTradesRouterCovered : null });
  }
  // 成交票的 signal 张数（重复买入形状参考）
  const sigCount = new Map();
  for (const s of signals) sigCount.set(s.token_address, (sigCount.get(s.token_address) || 0) + 1);

  console.log(`实验 ${EXP}`);
  console.log(`buy signals=${signals.length} | 成交 token=${filled.length}（被门拦未成交 token=${blocked.length}）| 成交票缺因子=${noFactor}`);

  // ── 成交票明细（按 routerPct 降序）──
  console.log(`\n═══ 成交票按 routerPct 降序（净额=FIFO realizedNet；covered=0 门豁免）═══`);
  const sorted = [...filled].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  for (const r of sorted) {
    console.log(`  ${r.tok} | pct=${r.pct == null ? 'null' : r.pct.toFixed(1).padStart(5)} cov=${r.cov} | 净 ${fmt(r.net).padStart(8)} | sigs=${sigCount.get(r.tok) || 0}`);
  }

  // ── 阈值扫描：假想追加 `earlyTradesRouterPct < θ`（cov==1 且 pct>=θ 拦）──
  console.log(`\n═══ 阈值扫描（在既有买门之上假想追加 router 门；拦 = cov==1 && pct>=θ）═══`);
  console.log(`  θ   | 拦票 | 避免亏损  | 放弃盈利 | 拦后净改善 | 已亏票/已赢票`);
  for (const theta of [30, 40, 50, 60, 65, 70, 75, 80, 90]) {
    const hit = filled.filter(r => r.cov === 1 && r.pct != null && r.pct >= theta);
    const avoided = hit.filter(r => r.net < 0).reduce((s, r) => s + r.net, 0); // 负数
    const forgone = hit.filter(r => r.net > 0).reduce((s, r) => s + r.net, 0); // 正数
    const losses = hit.filter(r => r.net < 0).length, wins = hit.filter(r => r.net > 0).length;
    const improve = Math.abs(avoided) - forgone; // 正 = 拦了变好（= -Σ被拦票净额）
    console.log(`  ${String(theta).padStart(3)} | ${String(hit.length).padStart(4)} | ${fmt(Math.abs(avoided)).padStart(9)} | ${forgone.toFixed(4).padStart(8)} | ${fmt(improve).padStart(10)} | ${losses}亏/${wins}赢`);
  }

  // ── 分布分桶（成交票）──
  console.log(`\n═══ 成交票 routerPct 分桶 × 净额 ═══`);
  const buckets = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 100.01], [null, null]];
  for (const [lo, hi] of buckets) {
    const rows = lo === null
      ? filled.filter(r => r.pct == null || r.cov !== 1)
      : filled.filter(r => r.pct != null && r.cov === 1 && r.pct >= lo && r.pct < hi);
    if (!rows.length) { console.log(`  ${lo === null ? 'null/cov0' : `${lo}-${hi}%`.padStart(8)} | 0 票`); continue; }
    const net = rows.reduce((s, r) => s + r.net, 0);
    const wins = rows.filter(r => r.net > 0).length, losses = rows.filter(r => r.net < 0).length;
    console.log(`  ${lo === null ? 'null/cov0' : `${lo}-${Math.min(hi, 100)}%`.padStart(8)} | ${String(rows.length).padStart(2)} 票 | 净 ${fmt(net).padStart(9)} | 赢${wins} 亏${losses} | 胜率 ${(wins / rows.length * 100).toFixed(0)}%`);
  }

  // ── 侧观测：被既有门拦掉的票里 routerPct 分布（两门重叠度）──
  console.log(`\n═══ 被既有门拦（未成交）票的 routerPct 分布 ═══`);
  const bHi = blocked.filter(r => r.cov === 1 && r.pct != null && r.pct >= 60).length;
  const bMid = blocked.filter(r => r.cov === 1 && r.pct != null && r.pct >= 30 && r.pct < 60).length;
  const bLo = blocked.filter(r => r.cov === 1 && r.pct != null && r.pct < 30).length;
  const bNa = blocked.filter(r => r.pct == null || r.cov !== 1).length;
  console.log(`  pct>=60: ${bHi} | 30-60: ${bMid} | <30: ${bLo} | null/cov0: ${bNa}（合计 ${blocked.length}）`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
