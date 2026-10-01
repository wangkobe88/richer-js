#!/usr/bin/env node
// ============================================================================
// debounce 参数配对回测对拍（2026-10-01，1500/5000/0 → 200/1000/200 修正验证；182 专用）
//
// 用法：node scripts/compare-debounce-pair.cjs --r0 <R0_ID> --r1 <R1_ID>
//
// 输出：两臂 trades/净额/胜负 + token 级差分 + debounce 特有观测——
//   共同买入 token 的首 BUY 信号时刻差（R1 应更早：旧 maxWait=5000 把信号
//   推迟到首 tick+5s，新参 200/1000 slot 级合并后 ~0.2s 静默即 fire）与
//   对应买入价差（0x7e3b…7777 案 +23% 价差的直接对照）。
// 净额口径 = ExperimentStatsService.calculateTokenPnL 同款 FIFO（Σ卖出所得 − Σ买入成本）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
function argVal(name) {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) { console.error(`缺参数 ${name}`); process.exit(1); }
  return args[i + 1];
}
const R0 = argVal('--r0');
const R1 = argVal('--r1');

async function pullTrades(client, expId) {
  const pageSize = 1000;
  let offset = 0;
  const all = [];
  for (;;) {
    const { data, error } = await client.from('trades')
      .select('token_address, trade_direction, input_amount, output_amount, unit_price, trade_status, success, created_at, executed_at')
      .eq('experiment_id', expId)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`trades 查询失败: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

/** 每 token 首 BUY 成交（时刻 + 价格）——debounce 时移的直接观测点。
 * 时刻口径 = created_at（回测虚拟市场时间，由 signal.timestamp=tick 时刻驱动）；
 * ⚠勿用 executed_at——那是回放进程墙钟，两臂串行执行的进程时差（~15min）会
 * 污染全部 Δt（首版对拍踩坑：60 token「全部更晚」纯伪影）。 */
function firstBuyPerToken(trades) {
  const map = new Map();
  for (const t of trades) {
    if (!(t.success === true || t.trade_status === 'success')) continue;
    const dir = (t.trade_direction || '').toLowerCase();
    if (dir !== 'buy') continue;
    const ts = new Date(t.created_at).getTime();
    const prev = map.get(t.token_address);
    if (!prev || ts < prev.ts) {
      map.set(t.token_address, { ts, price: parseFloat(t.unit_price) || null });
    }
  }
  return map;
}

/** FIFO per-token PnL（ExperimentStatsService 同款简化版） */
function tokenPnL(trades) {
  const byToken = new Map();
  for (const t of trades) {
    if (!(t.success === true || t.trade_status === 'success')) continue;
    const isBuy = (t.trade_direction || '').toLowerCase() === 'buy';
    const rec = byToken.get(t.token_address) || { spent: 0, received: 0, buys: 0, sells: 0, leftoverCost: 0, queue: [] };
    const inAmt = parseFloat(t.input_amount || 0);
    const outAmt = parseFloat(t.output_amount || 0);
    if (isBuy) {
      if (outAmt > 0) {
        rec.queue.push({ amount: outAmt, cost: inAmt });
        rec.spent += inAmt;
        rec.buys++;
      }
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
    rec.realizedNet = rec.received - (rec.spent - rec.leftoverCost);
    out.set(tok, rec);
  }
  return out;
}

function fmt(n) { return (n >= 0 ? '+' : '') + n.toFixed(4); }
function hhmmss(ts) { return new Date(ts).toISOString().slice(11, 19); }

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const client = dbManager.getClient();

  const arms = {};
  for (const [label, id] of [['R0', R0], ['R1', R1]]) {
    const trades = await pullTrades(client, id);
    arms[label] = { id, trades, perToken: tokenPnL(trades), firstBuy: firstBuyPerToken(trades) };
    let spent = 0, received = 0, wins = 0, losses = 0, open = 0, leftover = 0;
    for (const rec of arms[label].perToken.values()) {
      spent += rec.spent; received += rec.received; leftover += rec.leftoverCost;
      if (rec.leftoverCost < 1e-9 && rec.sells > 0) { rec.realizedNet > 0 ? wins++ : losses++; }
      else if (rec.leftoverCost >= 1e-9) open++;
    }
    Object.assign(arms[label], { spent, received, wins, losses, open, leftover });
  }

  for (const label of ['R0', 'R1']) {
    const a = arms[label];
    console.log(`\n═══ ${label} (${a.id.slice(0, 8)}) ═══`);
    console.log(`  成交买单=${[...a.perToken.values()].reduce((s, r) => s + r.buys, 0)} 卖单=${[...a.perToken.values()].reduce((s, r) => s + r.sells, 0)} | 买入=${a.spent.toFixed(4)} 卖出=${a.received.toFixed(4)} BNB`);
    console.log(`  净额(含未平仓敞口)=${fmt(a.received - a.spent)} | 未平仓 token=${a.open}（余量成本 ${a.leftover.toFixed(4)}）`);
    console.log(`  平仓 token：赢=${a.wins} 亏=${a.losses}（胜率 ${(a.wins / Math.max(1, a.wins + a.losses) * 100).toFixed(1)}%）`);
  }

  // ── debounce 直接观测：共同买入 token 首 BUY 时刻/价格差 ──
  const common = [...arms.R1.firstBuy.keys()].filter(t => arms.R0.firstBuy.has(t));
  console.log(`\n═══ 首 BUY 时刻/价格差分（共同买入 token ${common.length} 个，R0=旧参 R1=新参）═══`);
  let earlier = 0, later = 0, same = 0, dTsSum = 0, shown = 0;
  const rows = [];
  for (const t of common) {
    const b0 = arms.R0.firstBuy.get(t), b1 = arms.R1.firstBuy.get(t);
    const dTs = (b1.ts - b0.ts) / 1000; // 负 = R1 更早
    dTsSum += dTs;
    if (dTs < -0.05) earlier++; else if (dTs > 0.05) later++; else same++;
    let dPricePct = null;
    if (b0.price != null && b1.price != null && b0.price > 0) dPricePct = (b1.price / b0.price - 1) * 100;
    rows.push({ t, b0, b1, dTs, dPricePct });
  }
  rows.sort((x, y) => x.dTs - y.dTs); // R1 提前最多的在前
  for (const r of rows) {
    if (shown >= 25 && Math.abs(r.dTs) <= 0.05) break; // 全列表太长：前 25 + 显著差异行
    shown++;
    const p = r.dPricePct == null ? '     n/a' : (r.dPricePct >= 0 ? '+' : '') + r.dPricePct.toFixed(1) + '%';
    console.log(`  ${r.t} | R0 ${hhmmss(r.b0.ts)} → R1 ${hhmmss(r.b1.ts)} | Δt=${r.dTs.toFixed(2)}s | 买价 Δ=${p}`);
  }
  console.log(`  …合计 ${rows.length} 行（R1 更早 ${earlier} / 更晚 ${later} / 持平 ${same}；平均 Δt=${(dTsSum / Math.max(1, rows.length)).toFixed(2)}s）`);

  // ── token 级差分 ──
  const t0 = arms.R0.perToken, t1 = arms.R1.perToken;
  const onlyR1 = [...t1.keys()].filter(t => !t0.has(t));
  const onlyR0 = [...t0.keys()].filter(t => !t1.has(t));
  console.log(`\n═══ token 级差分 ═══`);
  console.log(`— R1 独有（新参下额外买入）: ${onlyR1.length} 个 —`);
  for (const t of onlyR1) {
    const r = t1.get(t);
    console.log(`  ${t} | 买${r.buys}卖${r.sells} | 净 ${fmt(r.realizedNet)}${r.leftoverCost >= 1e-9 ? ` | ⚠未平仓 ${r.leftoverCost.toFixed(4)}` : ''}`);
  }
  console.log(`— R0 独有（旧参下才买入）: ${onlyR0.length} 个 —`);
  for (const t of onlyR0) {
    const r = t0.get(t);
    console.log(`  ${t} | 买${r.buys}卖${r.sells} | 净 ${fmt(r.realizedNet)}${r.leftoverCost >= 1e-9 ? ` | ⚠未平仓 ${r.leftoverCost.toFixed(4)}` : ''}`);
  }
  let diffSum = 0, diffTok = 0;
  for (const t of [...t1.keys()].filter(t => t0.has(t))) {
    const d = t1.get(t).realizedNet - t0.get(t).realizedNet;
    if (Math.abs(d) > 1e-6) { diffSum += d; diffTok++; }
  }
  const netR0 = arms.R0.received - arms.R0.spent;
  const netR1 = arms.R1.received - arms.R1.spent;
  console.log(`\n═══ 净效应 ═══`);
  console.log(`  R0（旧参 1500/5000/0）净额 = ${fmt(netR0)}`);
  console.log(`  R1（新参 200/1000/200）净额 = ${fmt(netR1)}`);
  console.log(`  debounce 修正净效应（R1−R0）= ${fmt(netR1 - netR0)} BNB`);
  console.log(`  共同 token 内部差分合计 = ${fmt(diffSum)}（${diffTok} 个 token 有差异）；` +
    `其余来自买入面差分（R1 新进 ${onlyR1.length} / R0 独有 ${onlyR0.length}）`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
