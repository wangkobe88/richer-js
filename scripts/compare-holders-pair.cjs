#!/usr/bin/env node
// ============================================================================
// FA holders 口径配对回测对拍（2026-10-01，GMGN 案 B 验证；182 专用——重读走 dbManager）
//
// 用法：node scripts/compare-holders-pair.cjs --h0 <H0_ID> --h1 <H1_ID>
//
// 输出：两臂 trades/净额/胜负 + token 级差分（H1 新放行 / H0 独有）+ 信号数对照。
// 净额口径 = ExperimentStatsService.calculateTokenPnL 同款 FIFO（Σ卖出所得 − Σ买入成本），
// 未平仓余量按剩余成本记敞口（回测收尾强平后通常为零）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
function argVal(name) {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) { console.error(`缺参数 ${name}`); process.exit(1); }
  return args[i + 1];
}
const H0 = argVal('--h0');
const H1 = argVal('--h1');

async function pullTrades(client, expId) {
  const pageSize = 1000;
  let offset = 0;
  const all = [];
  for (;;) {
    const { data, error } = await client.from('trades')
      .select('token_address, trade_direction, input_amount, output_amount, trade_status, success, created_at, executed_at')
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

async function countSignals(client, expId) {
  const out = { all: 0, buy: 0, sell: 0 };
  for (const action of ['buy', 'sell']) {
    const { count, error } = await client.from('strategy_signals')
      .select('id', { count: 'exact', head: true })
      .eq('experiment_id', expId)
      .eq('action', action);
    if (error) throw new Error(`signals 计数失败: ${error.message}`);
    out[action] = count || 0;
    out.all += count || 0;
  }
  return out;
}

/** FIFO per-token PnL（ExperimentStatsService 同款简化版） */
function tokenPnL(trades) {
  const byToken = new Map();
  for (const t of trades) {
    if (!(t.success === true || t.trade_status === 'success')) continue;
    const dir = t.trade_direction;
    const isBuy = dir === 'buy' || dir === 'BUY';
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
    rec.leftoverCost = rec.queue.reduce((s, q) => s + q.cost, 0); // 未平仓剩余成本
    rec.net = rec.received - rec.spent;                            // 已实现口径（含未平仓敞口另列）
    rec.realizedNet = rec.received - (rec.spent - rec.leftoverCost); // 已平仓部分净额
    out.set(tok, rec);
  }
  return out;
}

function fmt(n) { return (n >= 0 ? '+' : '') + n.toFixed(4); }

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const client = dbManager.getClient();

  const arms = {};
  for (const [label, id] of [['H0', H0], ['H1', H1]]) {
    const trades = await pullTrades(client, id);
    const sigCount = await countSignals(client, id);
    const perToken = tokenPnL(trades);
    let spent = 0, received = 0, buys = 0, sells = 0, leftover = 0;
    const closed = [];
    for (const rec of perToken.values()) {
      spent += rec.spent; received += rec.received;
      buys += rec.buys; sells += rec.sells;
      leftover += rec.leftoverCost;
      if (rec.leftoverCost < 1e-9 && rec.sells > 0) closed.push(rec.realizedNet);
      else if (rec.leftoverCost >= 1e-9) closed.push(null); // 未平仓不计胜负
    }
    const wins = closed.filter(v => v != null && v > 0).length;
    const losses = closed.filter(v => v != null && v <= 0).length;
    arms[label] = { id, trades, perToken, sigCount, spent, received, buys, sells, leftover, wins, losses };
  }

  for (const label of ['H0', 'H1']) {
    const a = arms[label];
    console.log(`\n═══ ${label} (${a.id.slice(0, 8)}) ═══`);
    console.log(`  信号数=${a.sigCount.all}（BUY ${a.sigCount.buy} / SELL ${a.sigCount.sell}）| 成交买单=${a.buys} 卖单=${a.sells} | 买入=${a.spent.toFixed(4)} 卖出=${a.received.toFixed(4)} BNB`);
    console.log(`  净额(含未平仓敞口)=${fmt(a.received - a.spent)} | 已实现=${fmt(a.received - a.spent + a.leftover)} | 未平仓余量成本=${a.leftover.toFixed(4)}`);
    console.log(`  平仓 token：赢=${a.wins} 亏=${a.losses}（胜率 ${(a.wins / Math.max(1, a.wins + a.losses) * 100).toFixed(1)}%）`);
  }

  // ── token 级差分 ──
  const h0Tokens = arms.H0.perToken, h1Tokens = arms.H1.perToken;
  const onlyH1 = [...h1Tokens.keys()].filter(t => !h0Tokens.has(t));
  const onlyH0 = [...h0Tokens.keys()].filter(t => !h1Tokens.has(t));
  const both = [...h1Tokens.keys()].filter(t => h0Tokens.has(t));

  console.log(`\n═══ token 级差分（共同交易 ${both.length} 个）═══`);
  console.log(`\n— H1 新放行（wallet 口径过 holders>5 / top1 门，H0 被拦）: ${onlyH1.length} 个 —`);
  for (const t of onlyH1) {
    const r = h1Tokens.get(t);
    console.log(`  ${t} | 买${r.buys}卖${r.sells} | 净 ${fmt(r.realizedNet)}${r.leftoverCost >= 1e-9 ? ` | ⚠未平仓 ${r.leftoverCost.toFixed(4)}` : ''}`);
  }
  console.log(`\n— H0 独有（旧口径放行、新口径反被拦）: ${onlyH0.length} 个 —`);
  for (const t of onlyH0) {
    const r = h0Tokens.get(t);
    console.log(`  ${t} | 买${r.buys}卖${r.sells} | 净 ${fmt(r.realizedNet)}${r.leftoverCost >= 1e-9 ? ` | ⚠未平仓 ${r.leftoverCost.toFixed(4)}` : ''}`);
  }

  let diffSum = 0, diffTok = 0;
  for (const t of both) {
    const d = h1Tokens.get(t).realizedNet - h0Tokens.get(t).realizedNet;
    if (Math.abs(d) > 1e-6) { diffSum += d; diffTok++; }
  }
  const netH0 = arms.H0.received - arms.H0.spent;
  const netH1 = arms.H1.received - arms.H1.spent;
  console.log(`\n═══ 净效应 ═══`);
  console.log(`  H0（旧 trader 口径）净额 = ${fmt(netH0)}`);
  console.log(`  H1（wallet 口径）净额   = ${fmt(netH1)}`);
  console.log(`  口径切换净效应（H1−H0）= ${fmt(netH1 - netH0)} BNB`);
  console.log(`  共同 token 内部差分合计 = ${fmt(diffSum)}（${diffTok} 个 token 有差异——时序扰动）；` +
    `其余净效应来自放行面差分（H1 新进 ${onlyH1.length} / H0 独有 ${onlyH0.length}）`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
