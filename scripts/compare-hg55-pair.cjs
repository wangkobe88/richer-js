#!/usr/bin/env node
// ============================================================================
// holderTrendGrowth>=55 门配对对拍（2026-10-03；182 专用——dbManager service key）
//
// 用法：node scripts/compare-hg55-pair.cjs [--r1 <门臂id>] [--r0 <基线id>]
//   v2 两臂（首版 5efaff23/20b5b439 作废：门子句误写裸键 holderTrendGrowth，
//   (X >= 55 OR X IS NULL) 恒真零拦截；v2 真名 holderTrendGrowthRatio 重跑）
//   同窗 10-02T02:18→10-03T04:00Z，同源 50442571，差分 = 门净效应
//
// 输出五节：
//   ① 两臂总览（FIFO 净额 / 买票 / 胜负）+ 门净效应
//   ② 买票配对（R0 独有 = hg 门拦截票 → 门净效应核心；R1 独有 = 时序扰动应极少）
//   ③ 拦截票逐张归因（地址 + hg 值 + 净额 + 叙事评级——两臂叙事同源验证）
//   ④ R1 信号 hg 分布（null fail-open 占比、<55 拦截量、门命中形状）
//   ⑤ 共同票净额扰动量级（回测资金竞争二阶效应应 ≈0）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const R1 = argVal('--r1', '9252d60a-38e0-4ad1-8032-2ec7bab74f99');
const R0 = argVal('--r0', 'f6504c4a-494c-4108-995a-3c66029b32e2');

async function pullTrades(client, expId) {
  const pageSize = 1000; let offset = 0; const all = [];
  for (;;) {
    const { data, error } = await client.from('trades')
      .select('token_address, trade_direction, input_amount, output_amount, trade_status, success, created_at')
      .eq('experiment_id', expId).order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error('trades 查询失败: ' + error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function pullSignals(client, expId) {
  const pageSize = 1000; let offset = 0; const all = [];
  for (;;) {
    const { data, error } = await client.from('strategy_signals')
      .select('id, token_address, action, executed, created_at, metadata')
      .eq('experiment_id', expId).order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error('signals 查询失败: ' + error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

/** FIFO per-token PnL（ExperimentStatsService 同款简化版）→ Map(token → rec) */
function pnlByToken(trades) {
  const by = new Map();
  for (const t of trades) {
    if (!(t.success === true || t.trade_status === 'success')) continue;
    const isBuy = t.trade_direction === 'buy' || t.trade_direction === 'BUY';
    const rec = by.get(t.token_address) || { spent: 0, received: 0, buys: 0, sells: 0, queue: [] };
    const inAmt = parseFloat(t.input_amount || 0), outAmt = parseFloat(t.output_amount || 0);
    if (isBuy) {
      if (outAmt > 0) { rec.queue.push({ amount: outAmt, cost: inAmt }); rec.spent += inAmt; rec.buys++; }
    } else {
      let rem = inAmt;
      while (rem > 0 && rec.queue.length) {
        const o = rec.queue[0];
        const sell = Math.min(rem, o.amount);
        const unit = o.cost / o.amount;
        o.amount -= sell; o.cost -= unit * sell; rem -= sell;
        if (o.amount <= 1e-12) rec.queue.shift();
      }
      rec.received += outAmt; rec.sells++;
    }
    by.set(t.token_address, rec);
  }
  for (const [addr, r] of by) {
    r.leftoverCost = r.queue.reduce((s, q) => s + q.cost, 0);
    r.net = r.received - r.spent;
    r.netWithOpen = r.net + r.leftoverCost;
    delete r.queue;
    if (r.buys === 0) by.delete(addr);
  }
  return by;
}

const f2 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const sum = (a) => a.reduce((s, x) => s + x, 0);
function median(arr) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  console.log(`R1(门臂) = ${R1}\nR0(基线) = ${R0}\n`);
  const [t1, t0] = await Promise.all([pullTrades(db, R1), pullTrades(db, R0)]);
  const [s1, s0] = await Promise.all([pullSignals(db, R1), pullSignals(db, R0)]);

  const p1 = pnlByToken(t1), p0 = pnlByToken(t0);
  // 每 token 首条 buy 信号 metadata（hg 值 / 叙事评级快照）
  const metaOf = (sigs) => { const m = new Map(); for (const s of sigs) if (s.action === 'buy' && !m.has(s.token_address)) m.set(s.token_address, s.metadata || {}); return m; };
  const m1 = metaOf(s1), m0 = metaOf(s0);
  const hgOf = (meta) => meta?.trendFactors?.holderTrendGrowthRatio;
  const narOf = (meta) => meta?.preBuyCheckFactors?.narrativeRating;
  const platOf = (meta) => meta?.preBuyCheckFactors?.platform || meta?.trendFactors?.platform || '?';

  // ════════ ① 总览 ════════
  console.log('════════ ① 两臂总览（FIFO，余量按成本记敞口）════════');
  for (const [label, pnl, trades] of [['R1 门臂', p1, t1], ['R0 基线', p0, t0]]) {
    const nets = [...pnl.values()].map(r => r.netWithOpen);
    const win = nets.filter(x => x > 0).length, lose = nets.filter(x => x <= 0).length;
    const spent = sum([...pnl.values()].map(r => r.spent)), recv = sum([...pnl.values()].map(r => r.received));
    console.log(`${label}: 买票 ${pnl.size} | 净额 ${f2(sum(nets))} (毛收 ${f2(recv)} − 支出 ${f2(spent)}) | 胜 ${win} / 负 ${lose} | 赢票合计 ${f2(sum(nets.filter(x=>x>0)))} 亏票合计 ${f2(sum(nets.filter(x=>x<=0)))}`);
  }
  const net1 = sum([...p1.values()].map(r => r.netWithOpen));
  const net0 = sum([...p0.values()].map(r => r.netWithOpen));
  console.log(`★ 门净效应(R1−R0) = ${f2(net1 - net0)}`);

  // ════════ ② 买票配对 ════════
  console.log('\n════════ ② 买票配对 ════════');
  const k1 = new Set(p1.keys()), k0 = new Set(p0.keys());
  const both = [...k1].filter(a => k0.has(a));
  const only1 = [...k1].filter(a => !k0.has(a));
  const only0 = [...k0].filter(a => !k1.has(a));
  console.log(`共同买票 ${both.length} | R1 独有 ${only1.length} | R0 独有 ${only0.length}（= hg 门拦截 + 时序扰动）`);

  // ════════ ③ 拦截票逐张归因 ════════
  console.log('\n════════ ③ R0 独有票归因（hg 门拦截核心）════════');
  const rows = only0.map(a => {
    const meta = m0.get(a) || {};
    return { addr: a, net: p0.get(a).netWithOpen, hg: hgOf(meta), nar: narOf(meta), plat: platOf(meta) };
  });
  const gated = rows.filter(r => r.hg != null && r.hg < 55);
  const notGated = rows.filter(r => !(r.hg != null && r.hg < 55));  // null 放行票 / >=55 却没买 = 资金/时序扰动
  console.log(`hg<55 拦截形状 ${gated.length} 张 | null/≥55 非门拦截（时序扰动）${notGated.length} 张`);
  if (gated.length) {
    console.log(`  拦截票净额合计 ${f2(sum(gated.map(r=>r.net)))}（避亏 ${f2(sum(gated.map(r=>r.net).filter(x=>x<=0)))} / 弃赢 ${f2(sum(gated.map(r=>r.net).filter(x=>x>0)))}）| 亏 ${gated.filter(r=>r.net<=0).length} / 赢 ${gated.filter(r=>r.net>0).length}`);
    console.log(`  hg 分布: P50=${f1(median(gated.map(r=>r.hg)))} min=${f1(Math.min(...gated.map(r=>r.hg)))} max=${f1(Math.max(...gated.map(r=>r.hg)))}`);
    console.log(`  被拦最亏 5 张（门的正面）:`);
    for (const r of [...gated].sort((a,b)=>a.net-b.net).slice(0,5)) console.log(`    ${f2(r.net)} hg=${f1(r.hg)} nar=${r.nar ?? '?'} ${r.plat} ${r.addr}`);
    console.log(`  被拦最赚 5 张（门的代价）:`);
    for (const r of [...gated].sort((a,b)=>b.net-a.net).slice(0,5)) console.log(`    +${f2(r.net)} hg=${f1(r.hg)} nar=${r.nar ?? '?'} ${r.plat} ${r.addr}`);
  }
  if (notGated.length) {
    console.log(`  非门拦截 ${notGated.length} 张（R1 也没买的其它原因）：`);
    for (const r of notGated.sort((a,b)=>a.net-b.net).slice(0,5)) console.log(`    ${f2(r.net)} hg=${r.hg == null ? 'null' : f1(r.hg)} nar=${r.nar ?? '?'} ${r.plat} ${r.addr}`);
  }
  if (only1.length) {
    console.log(`  R1 独有 ${only1.length} 张（应为时序扰动，两臂都无门差异路径）：`);
    for (const r of only1.map(a => ({ addr: a, net: p1.get(a).netWithOpen, hg: hgOf(m1.get(a) || {}) })).sort((a,b)=>a.net-b.net)) console.log(`    ${f2(r.net)} hg=${r.hg == null ? 'null' : f1(r.hg)} ${r.addr}`);
  }

  // ════════ ④ R1 信号 hg 门命中分布 ════════
  console.log('\n════════ ④ R1 buy 信号 hg 门命中形状 ════════');
  const s1buy = s1.filter(s => s.action === 'buy');
  const hgVals = s1buy.map(s => hgOf(s.metadata)).filter(v => v != null);
  const nullCnt = s1buy.length - hgVals.length;
  console.log(`R1 buy 信号 ${s1buy.length} 条：hg 非空 ${hgVals.length}（<55 被门拦 ${hgVals.filter(v => v < 55).length}）| null fail-open ${nullCnt}（${f1(100*nullCnt/s1buy.length)}%）`);
  console.log(`  非空 hg 分桶: <25=${hgVals.filter(v=>v<25).length} [25,40)=${hgVals.filter(v=>v>=25&&v<40).length} [40,55)=${hgVals.filter(v=>v>=40&&v<55).length} [55,80)=${hgVals.filter(v=>v>=55&&v<80).length} >=80=${hgVals.filter(v=>v>=80).length}`);

  // ════════ ⑤ 共同票扰动 + 叙事同源验证 ════════
  console.log('\n════════ ⑤ 共同票净额扰动 + 叙事同源 ════════');
  let diffCnt = 0, diffSum = 0;
  const narDiff = [];
  for (const a of both) {
    const d = p1.get(a).netWithOpen - p0.get(a).netWithOpen;
    if (Math.abs(d) > 1e-6) { diffCnt++; diffSum += d; }
    const n1 = narOf(m1.get(a) || {}), n0 = narOf(m0.get(a) || {});
    if (n1 !== n0) narDiff.push({ a, n1, n0 });
  }
  console.log(`共同票 ${both.length} 张中净额有差 ${diffCnt} 张（Δ合计 ${f2(diffSum)}，二阶资金扰动量级）`);
  console.log(`共同票叙事评级不一致 ${narDiff.length} 张（应=0，>0 说明两臂叙事不同源）`);
  if (narDiff.length) for (const r of narDiff.slice(0, 5)) console.log(`  R1=${r.n1} R0=${r.n0} ${r.a}`);

  console.log('\n[done]');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
