#!/usr/bin/env node
// ============================================================================
// router 门观察史双门配对对拍（2026-10-03；182 专用——dbManager service key）
//
// 用法：node scripts/compare-router-gate-pair.cjs [--w1 <门臂id>] [--w0 <基线id>]
//   两臂同窗（10-03T04:00 → 创建时刻）同源 50442571，唯一差异 = 买腿 preBuy 追加
//   两门（低侧未见 / 出界<=10），差分 = 双门净效应。
//
// 输出五节：
//   ① 两臂总览（FIFO 净额 / 买票 / 胜负）+ 双门净效应
//   ② 买票配对（W0 独有 = 双门拦截票 → 净效应核心；W1 独有 = 时序扰动应极少）
//   ③ 拦截票逐张归因（地址 + 观察史重放定形状：低侧涨进 / 出界>10 / 非门时序扰动）
//   ④ W1 信号门命中分布（观察史因子非空率 / 低侧拦 / 超次数拦 / null fail-open）
//   ⑤ 共同票净额扰动量级 + 叙事同源验证
//
// 归因口径：W0 buy 信号序列（含被拒行）逐 fire 重放 router-gate-state 状态机
// （与分析脚本 analyze-router-late-entry.cjs 同源），在 W0 成交 fire 处读
// 「假想观察史」——若 W1 在同序列上运行，该 fire 的门因子即此值。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const {
  updateRouterGateState, routerGateFactors, ROUTER_GATE_LOW, ROUTER_GATE_HIGH,
} = require('../src/trading-engine/pre-check/router-gate-state');

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const W1 = argVal('--w1', 'PENDING_W1');
const W0 = argVal('--w0', 'PENDING_W0');

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

/**
 * 观察史重放（W0 信号序列 → 假想 W1 门视角）：
 * 返回 Map(token → { blockedBy: 'low'|'count'|null, lowSide, outCount, fires, outFires })
 *   blockedBy = 首个「成交 fire 处门拦」的形状（null = 全序列门不拦 = 非门拦截）
 */
function replayGateView(signals) {
  const byTok = new Map();
  for (const s of signals) {
    if (s.action !== 'buy') continue;
    if (!byTok.has(s.token_address)) byTok.set(s.token_address, []);
    byTok.get(s.token_address).push(s);
  }
  const out = new Map();
  for (const [addr, seq] of byTok) {
    seq.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let state;   // undefined = Map miss（首 fire）
    let blockedBy = null, lowSide = null, outCount = null, outFires = 0;
    for (const s of seq) {
      const pb = s.metadata?.preBuyCheckFactors || {};
      const rp = pb.earlyTradesRouterPct;
      const platform = pb.platform || null;
      // 门评估（读检查前状态）——只在「本次 rp 在区间窗内（区间门本应放行）」的 fire
      // 上判定门形状：出界 fire 本身就被区间门拦，不算双门拦截点
      if (blockedBy === null && platform === 'flap' && rp != null && rp >= ROUTER_GATE_LOW && rp < ROUTER_GATE_HIGH) {
        const f = routerGateFactors(state);
        if (f.earlyTradesRouterLowSideSeen === 1) blockedBy = 'low';
        else if (f.earlyTradesRouterRejectCount != null && f.earlyTradesRouterRejectCount > 10) blockedBy = 'count';
        lowSide = f.earlyTradesRouterLowSideSeen; outCount = f.earlyTradesRouterRejectCount;
      }
      // 回填（fire 后）——与分析 mixed 口径同源
      state = updateRouterGateState(state, platform, rp ?? null);
      if (platform === 'flap' && rp != null && (rp < ROUTER_GATE_LOW || rp >= ROUTER_GATE_HIGH)) outFires++;
    }
    out.set(addr, { blockedBy, lowSide, outCount, fires: seq.length, outFires });
  }
  return out;
}

const f2 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const sum = (a) => a.reduce((s, x) => s + x, 0);
function median(arr) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

async function main() {
  if (W1 === 'PENDING_W1' || W0 === 'PENDING_W0') {
    console.error('用法: node scripts/compare-router-gate-pair.cjs --w1 <门臂id> --w0 <基线id>');
    process.exit(1);
  }
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  console.log(`W1(门臂) = ${W1}\nW0(基线) = ${W0}\n`);
  const [t1, t0] = await Promise.all([pullTrades(db, W1), pullTrades(db, W0)]);
  const [s1, s0] = await Promise.all([pullSignals(db, W1), pullSignals(db, W0)]);

  const p1 = pnlByToken(t1), p0 = pnlByToken(t0);
  const narOf = (sigs) => { const m = new Map(); for (const s of sigs) if (s.action === 'buy' && !m.has(s.token_address)) m.set(s.token_address, s.metadata?.preBuyCheckFactors?.narrativeRating); return m; };
  const n1 = narOf(s1), n0 = narOf(s0);
  const gate0 = replayGateView(s0);   // W0 序列上的假想门视角（拦截归因核心）

  // ════════ ① 总览 ════════
  console.log('════════ ① 两臂总览（FIFO，余量按成本记敞口）════════');
  for (const [label, pnl] of [['W1 门臂', p1], ['W0 基线', p0]]) {
    const nets = [...pnl.values()].map(r => r.netWithOpen);
    const win = nets.filter(x => x > 0).length, lose = nets.filter(x => x <= 0).length;
    const spent = sum([...pnl.values()].map(r => r.spent)), recv = sum([...pnl.values()].map(r => r.received));
    console.log(`${label}: 买票 ${pnl.size} | 净额 ${f2(sum(nets))} (毛收 ${f2(recv)} − 支出 ${f2(spent)}) | 胜 ${win} / 负 ${lose} | 赢票合计 ${f2(sum(nets.filter(x=>x>0)))} 亏票合计 ${f2(sum(nets.filter(x=>x<=0)))}`);
  }
  const net1 = sum([...p1.values()].map(r => r.netWithOpen));
  const net0 = sum([...p0.values()].map(r => r.netWithOpen));
  console.log(`★ 双门净效应(W1−W0) = ${f2(net1 - net0)}`);

  // ════════ ② 买票配对 ════════
  console.log('\n════════ ② 买票配对 ════════');
  const k1 = new Set(p1.keys()), k0 = new Set(p0.keys());
  const both = [...k1].filter(a => k0.has(a));
  const only1 = [...k1].filter(a => !k0.has(a));
  const only0 = [...k0].filter(a => !k1.has(a));
  console.log(`共同买票 ${both.length} | W1 独有 ${only1.length} | W0 独有 ${only0.length}（= 双门拦截 + 时序扰动）`);

  // ════════ ③ 拦截票逐张归因（观察史重放定形状） ════════
  console.log('\n════════ ③ W0 独有票归因（双门拦截核心）════════');
  const rows = only0.map(a => {
    const g = gate0.get(a) || {};
    return { addr: a, net: p0.get(a).netWithOpen, shape: g.blockedBy, low: g.lowSide, cnt: g.outCount,
             fires: g.fires, outFires: g.outFires, nar: n0.get(a) };
  });
  const lowRows = rows.filter(r => r.shape === 'low');
  const cntRows = rows.filter(r => r.shape === 'count');
  const notGated = rows.filter(r => r.shape == null);
  console.log(`低侧涨进拦 ${lowRows.length} 张 | 出界>10 拦 ${cntRows.length} 张 | 非门拦截（时序/资金扰动）${notGated.length} 张`);
  const show = (list, tag) => {
    if (!list.length) return;
    console.log(`  ${tag} ${list.length} 张 | 净额合计 ${f2(sum(list.map(r=>r.net)))}（避亏 ${f2(sum(list.map(r=>r.net).filter(x=>x<=0)))} / 弃赢 ${f2(sum(list.map(r=>r.net).filter(x=>x>0)))}）| 亏 ${list.filter(r=>r.net<=0).length} / 赢 ${list.filter(r=>r.net>0).length}`);
    console.log(`  最亏 5 张:`);
    for (const r of [...list].sort((a,b)=>a.net-b.net).slice(0,5))
      console.log(`    ${f2(r.net)} low=${r.low==null?'?':r.low} cnt=${r.cnt==null?'?':r.cnt} 拒${r.outFires}次 nar=${r.nar ?? '?'} ${r.addr}`);
    console.log(`  最赚 3 张:`);
    for (const r of [...list].sort((a,b)=>b.net-a.net).slice(0,3))
      console.log(`    +${f2(r.net)} low=${r.low==null?'?':r.low} cnt=${r.cnt==null?'?':r.cnt} 拒${r.outFires}次 nar=${r.nar ?? '?'} ${r.addr}`);
  };
  show(lowRows, '① 低侧涨进形状（<50 后涨进窗）');
  show(cntRows, '② 超次数形状（出界 >10 次）');
  if (notGated.length) {
    console.log(`  非门拦截 ${notGated.length} 张（重放门不拦——资金/时序扰动）：`);
    for (const r of notGated.sort((a,b)=>a.net-b.net).slice(0,5))
      console.log(`    ${f2(r.net)} low=${r.low==null?'?':r.low} cnt=${r.cnt==null?'?':r.cnt} 拒${r.outFires}次 ${r.addr}`);
  }
  if (only1.length) {
    console.log(`  W1 独有 ${only1.length} 张（应为时序扰动）：`);
    for (const a of only1.sort((a,b)=>p1.get(a).netWithOpen-p1.get(b).netWithOpen)) console.log(`    ${f2(p1.get(a).netWithOpen)} ${a}`);
  }

  // ════════ ④ W1 信号门命中分布 ════════
  console.log('\n════════ ④ W1 buy 信号观察史因子分布 ════════');
  const s1buy = s1.filter(s => s.action === 'buy');
  const pbOf = (s) => s.metadata?.preBuyCheckFactors || {};
  const flapFires = s1buy.filter(s => pbOf(s).platform === 'flap');
  const seenLow = flapFires.filter(s => pbOf(s).earlyTradesRouterLowSideSeen === 1).length;
  const overCnt = flapFires.filter(s => (pbOf(s).earlyTradesRouterRejectCount ?? 0) > 10).length;
  const nullHist = flapFires.filter(s => pbOf(s).earlyTradesRouterLowSideSeen == null).length;
  console.log(`W1 buy 信号 ${s1buy.length} 条：flap ${flapFires.length}（fourmeme ${s1buy.length - flapFires.length} 短路放行）`);
  console.log(`  flap 中：无状态 null fail-open ${nullHist}（${flapFires.length ? f1(100*nullHist/flapFires.length) : 0}%）| 低侧已见 ${seenLow} | 出界>10 ${overCnt}`);
  const cntDist = flapFires.map(s => pbOf(s).earlyTradesRouterRejectCount).filter(v => v != null);
  if (cntDist.length) {
    console.log(`  出界计数分桶: 0=${cntDist.filter(v=>v===0).length} [1,3]=${cntDist.filter(v=>v>=1&&v<=3).length} [4,10]=${cntDist.filter(v=>v>=4&&v<=10).length} >10=${cntDist.filter(v=>v>10).length} | P50=${median(cntDist)}`);
  }

  // ════════ ⑤ 共同票扰动 + 叙事同源验证 ════════
  console.log('\n════════ ⑤ 共同票净额扰动 + 叙事同源 ════════');
  let diffCnt = 0, diffSum = 0;
  const narDiff = [];
  for (const a of both) {
    const d = p1.get(a).netWithOpen - p0.get(a).netWithOpen;
    if (Math.abs(d) > 1e-6) { diffCnt++; diffSum += d; }
    if (n1.get(a) !== n0.get(a)) narDiff.push({ a, n1: n1.get(a), n0: n0.get(a) });
  }
  console.log(`共同票 ${both.length} 张中净额有差 ${diffCnt} 张（Δ合计 ${f2(diffSum)}，二阶资金扰动量级）`);
  console.log(`共同票叙事评级不一致 ${narDiff.length} 张（应=0，>0 说明两臂叙事不同源）`);
  if (narDiff.length) for (const r of narDiff.slice(0, 5)) console.log(`  W1=${r.n1} W0=${r.n0} ${r.a}`);

  console.log('\n[done]');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
