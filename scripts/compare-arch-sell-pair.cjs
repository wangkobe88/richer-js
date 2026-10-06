#!/usr/bin/env node
// ============================================================================
// 拱形止损配对对拍（2026-10-06；182 专用——dbManager service key）
//
// 用法：node scripts/compare-arch-sell-pair.cjs [--r1 <腿臂id>] [--r0 <基线id>] [--live <实跑id>]
//       [--arch 'P10|P11|P12|P13|P14']   # 拱形腿归因正则（默认 P1\.5 旧单腿臂）
//   R1 拱形腿臂（18 卖腿）vs R0 基线臂（17 卖腿），基底 6f92e2f9 整包，
//   同窗 10-03T14:31→10-04T13:10Z，同源 token 集合，差分 = 拱形腿净效应。
//   --live 实跑对拍（可选，R0 vs 6f92e2f9 回测模拟保真度参考）。
//
// 输出：
//   ① 两臂总览（已实现净额 / 买票 / 胜负 / 卖出笔数）+ 净效应
//   ② 买票集合配对（独有票 = 资金竞争二阶效应，应少）
//   ③ 共同票逐张净额对拍（按 |diff| 降序；拱形腿 fire 票标注）
//   ④ R1 拱形腿 fire 明细（reason 匹配 --arch 正则的信号 + 该票两臂差异）
//   ⑤ R0 vs 实跑对拍（--live 时）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const R1 = argVal('--r1', '2ff8adeb-6feb-4310-b6d5-70a81a92dd99');
const R0 = argVal('--r0', '57fde778-7a0d-424f-8c5d-fd5f7b7e2fc3');
const LIVE = argVal('--live', '6f92e2f9-1b21-4ea6-b6a1-2e8dc70090e3');
// 拱形腿 fire 归因正则（2026-10-06 v2 参数化）：默认旧单腿臂 P1.5；R2 拆腿臂传
//   --arch 'P10|P11|P12|P13|P14'（reason 形如「卖出策略 P10」——\b 边界防 P1 误配 P1x）
const ARCH_PAT = argVal('--arch', 'P1\\.5');
const ARCH_RE = new RegExp('\\b(?:' + ARCH_PAT + ')\\b');

async function pullTrades(client, expId) {
  const pageSize = 500; let offset = 0; const all = [];
  for (;;) {
    const { data, error } = await client.from('trades')
      .select('token_address,token_symbol,trade_direction,input_amount,output_amount,executed_at,signal_id')
      .eq('experiment_id', expId).order('executed_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error('trades 查询失败: ' + error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function pullSellSignals(client, expId) {
  const pageSize = 500; let offset = 0; const all = [];
  for (;;) {
    const { data, error } = await client.from('strategy_signals')
      .select('id,token_address,token_symbol,reason,executed,created_at')
      .eq('experiment_id', expId).eq('action', 'sell').order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error('signals 查询失败: ' + error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

// token 级汇总：净额（sell 输出 − buy 输入，BNB；已全部平仓口径）
function tokenPnl(trades) {
  const m = new Map();
  for (const t of trades) {
    if (!m.has(t.token_address)) m.set(t.token_address, { symbol: t.token_symbol, buy: 0, sell: 0, nBuy: 0, nSell: 0 });
    const e = m.get(t.token_address);
    if (t.trade_direction === 'buy') { e.buy += Number(t.input_amount || 0); e.nBuy++; }
    else { e.sell += Number(t.output_amount || 0); e.nSell++; }
  }
  for (const [k, e] of m) e.net = e.sell - e.buy;
  return m;
}

function overview(name, trades) {
  const pnl = tokenPnl(trades);
  const tokens = [...pnl.keys()];
  const buyIn = trades.filter(t => t.trade_direction === 'buy').reduce((s, t) => s + Number(t.input_amount || 0), 0);
  const sellOut = trades.filter(t => t.trade_direction === 'sell').reduce((s, t) => s + Number(t.output_amount || 0), 0);
  const wins = tokens.filter(k => pnl.get(k).net > 0).length;
  const losses = tokens.filter(k => pnl.get(k).net < 0).length;
  console.log(`${name}: 净额=${(sellOut - buyIn).toFixed(4)} BNB | 买入=${buyIn.toFixed(3)} | 卖出=${sellOut.toFixed(3)} | token=${tokens.length}（赢${wins}/亏${losses}）| trades=${trades.length}`);
  return { pnl, tokens, net: sellOut - buyIn };
}

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  const [t1, t0, s1] = await Promise.all([pullTrades(db, R1), pullTrades(db, R0), pullSellSignals(db, R1)]);
  console.log(`\n===== ① 两臂总览 =====`);
  const o1 = overview('R1 腿臂', t1);
  const o0 = overview('R0 基线', t0);
  console.log(`拱形腿净效应 = ${(o1.net - o0.net).toFixed(4)} BNB`);

  console.log(`\n===== ② 买票集合配对 =====`);
  const only1 = o1.tokens.filter(k => !o0.pnl.has(k));
  const only0 = o0.tokens.filter(k => !o1.pnl.has(k));
  const common = o1.tokens.filter(k => o0.pnl.has(k));
  console.log(`共同 ${common.length} | R1 独有 ${only1.length} | R0 独有 ${only0.length}`);
  for (const k of only1) console.log(`  R1独有: ${o1.pnl.get(k).symbol} ${k.slice(0, 10)} net=${o1.pnl.get(k).net.toFixed(3)}`);
  for (const k of only0) console.log(`  R0独有: ${o0.pnl.get(k).symbol} ${k.slice(0, 10)} net=${o0.pnl.get(k).net.toFixed(3)}`);

  console.log(`\n===== ③ 共同票净额对拍（|diff|>0.005 才列）=====`);
  const archFires = new Map(); // token → 次数
  for (const s of s1) if (ARCH_RE.test(s.reason || '')) {
    archFires.set(s.token_address, (archFires.get(s.token_address) || 0) + 1);
  }
  let diffSum = 0, posCnt = 0, negCnt = 0;
  const rows = [];
  for (const k of common) {
    const d = o1.pnl.get(k).net - o0.pnl.get(k).net;
    diffSum += d;
    if (d > 0.0005) posCnt++; else if (d < -0.0005) negCnt++;
    if (Math.abs(d) > 0.005) rows.push({ sym: o1.pnl.get(k).symbol, addr: k, d, n1: o1.pnl.get(k).net, n0: o0.pnl.get(k).net, fire: archFires.get(k) || 0 });
  }
  rows.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  for (const r of rows) console.log(`  ${r.sym} ${r.addr.slice(0, 10)} R0=${r.n0.toFixed(3)} → R1=${r.n1.toFixed(3)} diff=${(r.d >= 0 ? '+' : '') + r.d.toFixed(3)}${r.fire ? ` 🔺拱形×${r.fire}` : ''}`);
  console.log(`共同票 diff 合计=${diffSum.toFixed(4)}（正 ${posCnt} / 负 ${negCnt} / 平 ${common.length - posCnt - negCnt}）`);

  console.log(`\n===== ④ R1 拱形腿 fire 明细（reason 匹配 /${ARCH_PAT}/）=====`);
  if (archFires.size === 0) console.log('  （无 fire）');
  for (const [k, n] of archFires) {
    const p1 = o1.pnl.get(k), p0 = o0.pnl.get(k);
    console.log(`  ${p1?.symbol || k.slice(0, 8)} ${k.slice(0, 10)} fire×${n} | R1 net=${p1 ? p1.net.toFixed(3) : '?'} vs R0 net=${p0 != null ? p0.net.toFixed(3) : '(R0未买)'} | 卖笔 R1=${p1?.nSell} R0=${p0?.nSell}`);
  }

  if (LIVE) {
    console.log(`\n===== ⑤ R0 vs 实跑对拍（模拟保真度）=====`);
    const tl = await pullTrades(db, LIVE);
    const ol = overview('实跑', tl);
    const commonL = ol.tokens.filter(k => o0.pnl.has(k));
    console.log(`实跑 token=${ol.tokens.length} | R0 token=${o0.tokens.length} | 共同=${commonL.length}`);
    let netDiff = 0; const dl = [];
    for (const k of commonL) { const d = o0.pnl.get(k).net - ol.pnl.get(k).net; netDiff += d; dl.push(d); }
    dl.sort((a, b) => Math.abs(b) - Math.abs(a));
    console.log(`共同 ${commonL.length} 票 R0−实跑 净额差合计=${netDiff.toFixed(4)}（|d| top3: ${dl.slice(0, 3).map(x => x.toFixed(3)).join(', ')}）`);
    const onlyL = ol.tokens.filter(k => !o0.pnl.has(k));
    console.log(`实跑独有 ${onlyL.length}: ${onlyL.slice(0, 5).map(k => ol.pnl.get(k).symbol + '(' + ol.pnl.get(k).net.toFixed(2) + ')').join(' ')}`);
    const only0L = o0.tokens.filter(k => !ol.pnl.has(k));
    console.log(`R0 独有 ${only0L.length}: ${only0L.slice(0, 5).map(k => o0.pnl.get(k).symbol + '(' + o0.pnl.get(k).net.toFixed(2) + ')').join(' ')}`);
  }
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
