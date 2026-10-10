#!/usr/bin/env node
// ============================================================================
// 虚拟↔回测一致性对拍（2026-10-10，a21fa102 虚拟 vs fdb039f4 同窗同源回测）
//
// 对拍维度：
//   1. 总量：净盈亏 / 买卖笔数 / token 数
//   2. 买入对拍：逐 token 集合差（两边各买了谁）、同买 token 的时刻差与买价差
//   3. 卖出对拍：同 token 卖出腿/盈亏差
//   4. 漏斗对拍：buy signal 总数、叙事拦截数、preBuy 拦截数、成交数
//
// 用法：node scripts/compare-virtual-backtest-parity.cjs [virtualId] [backtestId]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const VIRTUAL_ID = process.argv[2] || 'a21fa102-aa00-4d98-b0d9-65f4a2323459';
const BACKTEST_ID = process.argv[3] || 'fdb039f4-36b3-4745-924e-b19c70d4e6b7';

async function pullTrades(client, expId) {
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client.from('trades')
      .select('id,token_symbol,token_address,trade_direction,input_currency,output_currency,input_amount,output_amount,unit_price,executed_at,metadata')
      .eq('experiment_id', expId)
      .order('executed_at', { ascending: true })
      .range(from, from + 499);
    if (error) throw new Error('trades: ' + error.message);
    out.push(...(data || []));
    if (!data || data.length < 500) break;
    from += 500;
  }
  // 回测行的 executed_at 是回测运行墙钟（Engine 设计：Trade.createdAt=历史、
  // executedAt=运行时刻）——历史回放时刻在 metadata.timestamp，统一抽取
  for (const t of out) {
    const ts = t.metadata?.timestamp;
    if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(ts)) t.effective_at = ts;
    else t.effective_at = t.executed_at;
  }
  return out;
}

async function pullSellLegs(client, expId, trades) {
  // 回测/虚拟 trade.metadata 均无 strategyName：经 signalId 关联 signals 行取腿名
  const ids = [...new Set(trades.filter(t => t.trade_direction === 'sell' && t.metadata?.signalId).map(t => t.metadata.signalId))];
  const legById = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await client.from('strategy_signals')
      .select('id,metadata')
      .eq('experiment_id', expId)
      .in('id', ids.slice(i, i + 200));
    if (error) throw new Error('legs: ' + error.message);
    for (const s of data || []) {
      const md = s.metadata || {};
      legById.set(s.id, String(md.strategyName || md.strategyId || '?'));
    }
  }
  return legById;
}

async function pullBuySignals(client, expId) {
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client.from('strategy_signals')
      .select('token_address,created_at,executed,metadata')
      .eq('experiment_id', expId)
      .eq('action', 'buy')
      .order('created_at', { ascending: true })
      .range(from, from + 499);
    if (error) throw new Error('signals: ' + error.message);
    out.push(...(data || []));
    if (!data || data.length < 500) break;
    from += 500;
  }
  return out;
}

function bnbPrice(t) {
  // BNB 计价单价：buy=input BNB/output token；sell=input token/output BNB
  const ia = Number(t.input_amount || 0), oa = Number(t.output_amount || 0);
  if (!ia || !oa) return null;
  return t.trade_direction === 'buy' ? ia / oa : oa / ia;
}

function aggByToken(trades) {
  const m = new Map();
  for (const t of trades) {
    if (!m.has(t.token_address)) m.set(t.token_address, { symbol: t.token_symbol || '?', buys: [], sells: [] });
    const e = m.get(t.token_address);
    e[t.trade_direction === 'buy' ? 'buys' : 'sells'].push(t);
  }
  for (const e of m.values()) {
    let bIn = 0, bOut = 0;
    for (const b of e.buys) bIn += Number(b.input_amount || 0);
    for (const s of e.sells) bOut += Number(s.output_amount || 0);
    e.bnbIn = bIn; e.bnbOut = bOut; e.net = bOut - bIn;
    e.firstBuyAt = e.buys[0]?.effective_at;
    e.firstBuyPrice = e.buys[0] ? bnbPrice(e.buys[0]) : null;
  }
  return m;
}

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const client = dbManager.getClient();

  const [vt, bt] = await Promise.all([pullTrades(client, VIRTUAL_ID), pullTrades(client, BACKTEST_ID)]);
  const vTok = aggByToken(vt), bTok = aggByToken(bt);

  const vNet = vt.length ? (vt.filter(t => t.trade_direction === 'sell').reduce((a, t) => a + Number(t.output_amount || 0), 0)
    - vt.filter(t => t.trade_direction === 'buy').reduce((a, t) => a + Number(t.input_amount || 0), 0)) : 0;
  const bNet = bt.length ? (bt.filter(t => t.trade_direction === 'sell').reduce((a, t) => a + Number(t.output_amount || 0), 0)
    - bt.filter(t => t.trade_direction === 'buy').reduce((a, t) => a + Number(t.input_amount || 0), 0)) : 0;

  console.log('================ 1. 总量对比 ================');
  console.log(`            虚拟(${VIRTUAL_ID.slice(0, 8)})   回测(${BACKTEST_ID.slice(0, 8)})`);
  console.log(`trades      ${String(vt.length).padEnd(18)}${bt.length}`);
  console.log(`  buy       ${String(vt.filter(t => t.trade_direction === 'buy').length).padEnd(18)}${bt.filter(t => t.trade_direction === 'buy').length}`);
  console.log(`  sell      ${String(vt.filter(t => t.trade_direction === 'sell').length).padEnd(18)}${bt.filter(t => t.trade_direction === 'sell').length}`);
  console.log(`token 数    ${String(vTok.size).padEnd(18)}${bTok.size}`);
  console.log(`净 BNB      ${vNet.toFixed(4).padEnd(18)}${bNet.toFixed(4)}   (差 ${(bNet - vNet).toFixed(4)})`);

  // 漏斗
  const [vs, bs] = await Promise.all([pullBuySignals(client, VIRTUAL_ID), pullBuySignals(client, BACKTEST_ID)]);
  function funnel(sigs) {
    const f = { total: sigs.length, executed: 0, narrLow: 0, narrMid: 0, narrHighUnrated: 0, preBuyFail: 0, noStrategy: 0, other: 0 };
    for (const s of sigs) {
      const md = s.metadata || {};
      const nc = md.narrativeCall;
      // rating 形状：字符串 'low'/'mid'/'high' 或数字 numericRating；未触发直调时 narrativeCall 为 null（rating 语义 9 放行）
      const rNum = nc ? (nc.numericRating ?? { low: 1, mid: 2, high: 3 }[nc.rating] ?? 9) : 9;
      if (md.execution_status === 'executed' || s.executed === true) { f.executed++; continue; }
      const pb = md.preBuyCheckResult;
      if (rNum === 1) f.narrLow++;
      else if (rNum === 2) f.narrMid++;
      else if (pb && pb.canBuy === false) f.preBuyFail++;
      else if (rNum === 3) f.narrHighUnrated++;
      else if (!pb) f.noStrategy++;
      else f.other++;
    }
    return f;
  }
  const vf = funnel(vs), bf = funnel(bs);
  console.log('\n================ 2. 买 signal 漏斗 ================');
  console.log(`fire 总数   ${String(vf.total).padEnd(18)}${bf.total}   (差 ${bf.total - vf.total})`);
  console.log(`叙事low拦   ${String(vf.narrLow).padEnd(18)}${bf.narrLow}`);
  console.log(`叙事mid拦   ${String(vf.narrMid).padEnd(18)}${bf.narrMid}`);
  console.log(`高评/未评   ${String(vf.narrHighUnrated).padEnd(18)}${bf.narrHighUnrated}`);
  console.log(`preBuy拦    ${String(vf.preBuyFail).padEnd(18)}${bf.preBuyFail}`);
  console.log(`veto拦      ${String(vf.vetoBlocked).padEnd(18)}${bf.vetoBlocked}`);
  console.log(`其他拦      ${String(vf.other).padEnd(18)}${bf.other}`);
  console.log(`成交        ${String(vf.executed).padEnd(18)}${bf.executed}`);

  // 买入集合对拍
  console.log('\n================ 3. 买入 token 集合对拍 ================');
  const vOnly = [...vTok.keys()].filter(a => !bTok.has(a));
  const bOnly = [...bTok.keys()].filter(a => !vTok.has(a));
  const both = [...vTok.keys()].filter(a => bTok.has(a));
  console.log(`两边都买 ${both.length} | 仅虚拟 ${vOnly.length} | 仅回测 ${bOnly.length}`);
  if (vOnly.length) { console.log('-- 仅虚拟买：'); for (const a of vOnly) console.log(`   ${vTok.get(a).symbol} ${a} net=${vTok.get(a).net.toFixed(4)}`); }
  if (bOnly.length) { console.log('-- 仅回测买：'); for (const a of bOnly) console.log(`   ${bTok.get(a).symbol} ${a} net=${bTok.get(a).net.toFixed(4)}`); }

  // 同买 token 的时刻/价格对拍
  console.log('\n================ 4. 同买 token 时刻/价格对拍 ================');
  console.log('symbol        时刻差(s)   虚拟买价     回测买价     价差%    虚net     回net');
  let sumTsDiff = 0, sumAbsPriceDiffPct = 0, nP = 0;
  const rows = [];
  for (const a of both) {
    const v = vTok.get(a), b = bTok.get(a);
    const tsDiff = (new Date(b.firstBuyAt) - new Date(v.firstBuyAt)) / 1000;
    const pd = (v.firstBuyPrice && b.firstBuyPrice) ? (b.firstBuyPrice / v.firstBuyPrice - 1) * 100 : null;
    if (tsDiff !== null) sumTsDiff += tsDiff;
    if (pd !== null) { sumAbsPriceDiffPct += Math.abs(pd); nP++; }
    rows.push({ symbol: v.symbol, tsDiff, vp: v.firstBuyPrice, bp: b.firstBuyPrice, pd, vn: v.net, bn: b.net, addr: a });
  }
  rows.sort((x, y) => Math.abs(y.tsDiff) - Math.abs(x.tsDiff));
  for (const r of rows) {
    console.log(`${(r.symbol || '?').padEnd(12)} ${r.tsDiff.toFixed(1).padStart(9)} ${(r.vp?.toExponential(3) ?? '-').padStart(12)} ${(r.bp?.toExponential(3) ?? '-').padStart(12)} ${(r.pd === null ? '-' : r.pd.toFixed(2) + '%').padStart(8)} ${r.vn.toFixed(4).padStart(9)} ${r.bn.toFixed(4).padStart(9)}`);
  }
  if (rows.length) {
    console.log(`\n时刻差合计 ${sumTsDiff.toFixed(1)}s（均值 ${(sumTsDiff / rows.length).toFixed(1)}s）`);
    if (nP) console.log(`买价差绝对值均值 ${((sumAbsPriceDiffPct / nP)).toFixed(2)}%（${nP}/${rows.length} 可比）`);
  }

  // 卖出腿对比（同买 token）
  const vLegs = await pullSellLegs(client, VIRTUAL_ID, vt);
  const bLegs = await pullSellLegs(client, BACKTEST_ID, bt);
  console.log('\n================ 5. 卖出明细对拍（仅两买 token）================');
  for (const a of both) {
    const v = vTok.get(a), b = bTok.get(a);
    if (v.sells.length !== b.sells.length || Math.abs(v.net - b.net) > 0.005) {
      console.log(`\n${v.symbol} ${a}`);
      for (const s of v.sells) {
        const md = s.metadata || {};
        const leg = vLegs.get(md.signalId) || '?';
        console.log(`  虚 sell @${s.effective_at} price=${bnbPrice(s)?.toExponential(3)} leg=${leg.slice(0, 36)} profitPct=${md.profitPercent?.toFixed?.(1) ?? '?'} holdMin=${md.holdDuration ? (md.holdDuration / 60000).toFixed(1) : '?'}`);
      }
      if (!v.sells.length) console.log('  虚 无卖出（窗口结束仍持有，net 按买入成本计）');
      for (const s of b.sells) {
        const md = s.metadata || {};
        const leg = bLegs.get(md.signalId) || (md.strategyName || '?');
        console.log(`  回 sell @${s.effective_at} price=${bnbPrice(s)?.toExponential(3)} leg=${String(leg).slice(0, 36)} profitPct=${md.profitPercent?.toFixed?.(1) ?? '?'}`);
      }
      if (!b.sells.length) console.log('  回 无卖出');
    }
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
