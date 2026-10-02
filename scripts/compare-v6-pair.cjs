#!/usr/bin/env node
// ============================================================================
// buy-v2 v6 四项变更配对对拍（2026-10-02；182 专用——重读走 dbManager service key）
//
// 用法：node scripts/compare-v6-pair.cjs [--v6 82093ca3-…] [--b2 960d1bbf-…]
//   V6 = 82093ca3（P9>100 + router 平台分门 + uw>=15 + TPA 2.5）
//   B2 = 960d1bbf（基线：v5 买腿 router 区间门无分门 + P9>30 + TPA 2.2，无 uw 门）
//
// 输出五节：
//   ① 两臂总览（FIFO 净额 / 买票数 / 胜负）
//   ② 买票配对（V6 独有 = fourmeme 恢复票；B2 独有 = 新门拦截票 → 门净效应）
//   ③ V6 门拦截归因（signals buy executed=false，逐门 exclusive 拦截）
//   ④ 卖腿分布对比（strategyName 分组；P9 新旧版触发对照）
//   ⑤ B2 P9 卖飞票在 V6 的结局（共同票内，P9 30 门槛早卖 vs 100 门槛晚卖）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const V6 = argVal('--v6', '82093ca3-ea73-4f26-9aef-cb9a1acee842');
const B2 = argVal('--b2', '960d1bbf-c561-4651-abb6-7f1a17e153e6');

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

async function pullSignals(client, expId, action) {
  const pageSize = 1000; let offset = 0; const all = [];
  for (;;) {
    const { data, error } = await client.from('strategy_signals')
      .select('id, token_address, executed, created_at, metadata')
      .eq('experiment_id', expId).eq('action', action)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`signals(${action}) 查询失败: ` + error.message);
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
    r.net = r.received - r.spent;                    // 全清口径
    r.netWithOpen = r.net + r.leftoverCost;          // 余量按成本记敞口
    delete r.queue;
    if (r.buys === 0) by.delete(addr);
  }
  return by;
}

const f2 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const sum = (a) => a.reduce((s, x) => s + x, 0);

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  console.log(`V6 = ${V6}\nB2 = ${B2}\n`);
  const [t6, t2] = await Promise.all([pullTrades(db, V6), pullTrades(db, B2)]);
  const [s6buy, s2buy, s6sell, s2sell] = await Promise.all([
    pullSignals(db, V6, 'buy'), pullSignals(db, B2, 'buy'),
    pullSignals(db, V6, 'sell'), pullSignals(db, B2, 'sell'),
  ]);

  const p6 = pnlByToken(t6), p2 = pnlByToken(t2);

  // ════════ ① 总览 ════════
  console.log('════════ ① 两臂总览（FIFO，余量按成本记敞口）════════');
  for (const [label, pnl, trades] of [['V6', p6, t6], ['B2', p2, t2]]) {
    const nets = [...pnl.values()].map(r => r.netWithOpen);
    const win = nets.filter(x => x > 0).length, lose = nets.filter(x => x <= 0).length;
    const spent = sum([...pnl.values()].map(r => r.spent)), recv = sum([...pnl.values()].map(r => r.received));
    console.log(`${label}: 买票 ${pnl.size} | 买笔 ${trades.filter(t=>t.trade_direction==='buy'&&t.success).length} 卖笔 ${trades.filter(t=>t.trade_direction==='sell'&&t.success).length} | 净额 ${f2(sum(nets))} (毛收 ${f2(recv)} − 支出 ${f2(spent)}) | 胜 ${win} / 负 ${lose} | 亏票合计 ${f2(sum(nets.filter(x=>x<=0)))} 赢票合计 ${f2(sum(nets.filter(x=>x>0)))}`);
  }
  console.log(`净效应(V6−B2) = ${f2(sum([...p6.values()].map(r=>r.netWithOpen)) - sum([...p2.values()].map(r=>r.netWithOpen)))}`);

  // ════════ ② 买票配对 ════════
  console.log('\n════════ ② 买票配对 ════════');
  const k6 = new Set(p6.keys()), k2 = new Set(p2.keys());
  const both = [...k6].filter(a => k2.has(a));
  const only6 = [...k6].filter(a => !k2.has(a));
  const only2 = [...k2].filter(a => !k6.has(a));
  // 信号 metadata 索引（buy 首 signal 拿 preBuy 因子）
  const metaOf = (sigs) => { const m = new Map(); for (const s of sigs) if (!m.has(s.token_address)) m.set(s.token_address, s.metadata || {}); return m; };
  const m6 = metaOf(s6buy), m2 = metaOf(s2buy);
  const platOf = (meta) => meta?.preBuyCheckFactors?.platform || meta?.trendFactors?.platform || '?';

  console.log(`共同买票 ${both.length} | V6 独有 ${only6.length} | B2 独有 ${only2.length}`);

  const bothNet6 = sum(both.map(a => p6.get(a).netWithOpen));
  const bothNet2 = sum(both.map(a => p2.get(a).netWithOpen));
  console.log(`共同票净额: V6 ${f2(bothNet6)} vs B2 ${f2(bothNet2)} → P9 卖腿等卖侧差异 ${f2(bothNet6 - bothNet2)}`);

  console.log(`\n-- V6 独有买票 ${only6.length} 张（预期 = fourmeme 恢复票 + 门时序扰动）--`);
  const p6only = only6.map(a => ({ addr: a, net: p6.get(a).netWithOpen, plat: platOf(m6.get(a)), rp: m6.get(a)?.preBuyCheckFactors?.earlyTradesRouterPct, uw: m6.get(a)?.preBuyCheckFactors?.earlyTradesUniqueWallets, tpa: m6.get(a)?.trendFactors?.TPAPre_tokenScore }));
  const p6onlyPlat = {};
  for (const r of p6only) p6onlyPlat[r.plat] = (p6onlyPlat[r.plat] || 0) + 1;
  console.log(`  平台分布: ${JSON.stringify(p6onlyPlat)} | 净额合计 ${f2(sum(p6only.map(r => r.net)))} | 胜 ${p6only.filter(r=>r.net>0).length} / 负 ${p6only.filter(r=>r.net<=0).length}`);
  const p6onlySorted = [...p6only].sort((a, b) => b.net - a.net);
  for (const r of p6onlySorted.slice(0, 6)) console.log(`  +${f2(r.net)} ${r.plat} rp=${r.rp ?? '?'} uw=${r.uw ?? '?'} tpa=${r.tpa ?? '?'} ${r.addr}`);
  for (const r of p6onlySorted.slice(-4)) console.log(`  ${f2(r.net)} ${r.plat} rp=${r.rp ?? '?'} uw=${r.uw ?? '?'} tpa=${r.tpa ?? '?'} ${r.addr}`);

  console.log(`\n-- B2 独有买票 ${only2.length} 张（被 V6 新门拦截）--`);
  const p2only = only2.map(a => {
    const meta = m2.get(a) || {};
    const pb = meta.preBuyCheckFactors || {}, tf = meta.trendFactors || {};
    return { addr: a, net: p2.get(a).netWithOpen, plat: pb.platform || '?', uw: pb.earlyTradesUniqueWallets, tpa: tf.TPAPre_tokenScore, rp: pb.earlyTradesRouterPct, nar: pb.narrativeRating };
  });
  // 归因分类（B2 没跑 platform 因子——用 rp 判：rp===0 → fourmeme（v5 区间门拦））
  const attr = (r) => {
    if (r.tpa !== undefined && r.tpa !== null && r.tpa <= 2.5 && r.tpa > 2.2) return 'TPA2.5门';
    if (r.uw !== undefined && r.uw !== null && r.uw < 15) return 'uw>=15门';
    return '其他/时序';
  };
  const groups = {};
  for (const r of p2only) { const k = attr(r); (groups[k] = groups[k] || []).push(r); }
  for (const [k, rs] of Object.entries(groups)) {
    const nets = rs.map(r => r.net);
    console.log(`  [${k}] ${rs.length} 张 | B2 净额合计 ${f2(sum(nets))}（亏 ${f2(sum(nets.filter(x=>x<=0)))} / 赢 ${f2(sum(nets.filter(x=>x>0)))}）| uw P50=${f1(median(rs.map(r=>r.uw).filter(x=>x!=null)))} tpa P50=${f1(median(rs.map(r=>r.tpa).filter(x=>x!=null)))}`);
  }
  const worst = [...p2only].sort((a, b) => a.net - b.net).slice(0, 5);
  for (const r of worst) console.log(`  ${f2(r.net)} [${attr(r)}] uw=${r.uw ?? '?'} tpa=${r.tpa ?? '?'} rp=${r.rp ?? '?'} ${r.addr}`);
  const best = [...p2only].sort((a, b) => b.net - a.net).slice(0, 3);
  for (const r of best) console.log(`  +${f2(r.net)} [${attr(r)}] uw=${r.uw ?? '?'} tpa=${r.tpa ?? '?'} ${r.addr}`);

  // ════════ ③ V6 门拦截归因（buy signals executed=false）════════
  console.log('\n════════ ③ V6 买信号门拦截归因（executed=false）════════');
  const blocked = s6buy.filter(s => !s.executed);
  console.log(`V6 buy 信号 ${s6buy.length} 条，executed=false ${blocked.length} 条`);
  const gate = (meta) => {
    const pb = meta?.preBuyCheckFactors || {}; const nr = pb.narrativeRating;
    const c = [];
    if (!(nr === 2 || nr === 3)) c.push('narrative');
    if (!(pb.earlyTradesTop1BuySharePct < 60)) c.push('top1');
    if (pb.earlyTradesTop1BuyCovered !== 1) c.push('top1Covered');
    const isFlap = pb.platform === 'flap';
    if (isFlap && !(pb.earlyTradesRouterPct >= 50 && pb.earlyTradesRouterPct < 80)) c.push('router[50,80)');
    if (!(pb.earlyTradesUniqueWallets >= 15)) c.push('uw>=15');
    return c; // 空数组 = 门全过（被拦另有原因：叙事否决短路/资金/评分等）
  };
  const excl = { narrative: 0, top1: 0, top1Covered: 0, 'router[50,80)': 0, 'uw>=15': 0, multi: 0, none: 0 };
  const uwBlockedTokens = new Set();
  for (const s of blocked) {
    const c = gate(s.metadata);
    if (c.length === 0) excl.none++;
    else if (c.length === 1) { excl[c[0]]++; if (c[0] === 'uw>=15') uwBlockedTokens.add(s.token_address); }
    else excl.multi++;
  }
  console.log(`  exclusive 拦截（仅该门拦）: ${JSON.stringify(excl)}`);
  console.log(`  uw 门 exclusive 拦截 token 数: ${uwBlockedTokens.size}`);

  // ════════ ④ 卖腿分布 ════════
  console.log('\n════════ ④ 卖信号 strategyName 分布（executed=true）════════');
  const sellDist = (sells) => {
    const d = {};
    for (const s of sells.filter(x => x.executed)) {
      const name = (s.metadata?.strategyName || s.metadata?.strategyId || '?') + '';
      d[name] = (d[name] || 0) + 1;
    }
    return d;
  };
  const d6 = sellDist(s6sell), d2 = sellDist(s2sell);
  const keys = [...new Set([...Object.keys(d6), ...Object.keys(d2)])].sort();
  for (const k of keys) console.log(`  ${k}: V6 ${d6[k] || 0} | B2 ${d2[k] || 0}`);

  // ════════ ⑤ P9 对照 ════════
  console.log('\n════════ ⑤ P9 卖腿对照（30 → 100 门槛）════════');
  const p9sell = (sells) => sells.filter(s => s.executed && /P9|profitPercent > (30|100)/.test(JSON.stringify(s.metadata?.strategyName || '') + JSON.stringify(s.metadata?.strategyId || '') + (s.metadata?.reason || '')));
  // 直接按 profitPercent>30 且非其他腿特征不可靠——改为统计卖信号触发时 profitPercent ∈ (30,100] 的占比
  const sellPn = (sells) => sells.filter(s => s.executed).map(s => ({ tok: s.token_address, pn: s.metadata?.profitPercent, strat: s.metadata?.strategyName || s.metadata?.strategyId || '?', ts: s.created_at })).filter(x => x.pn != null);
  const v6pn = sellPn(s6sell), b2pn = sellPn(s2sell);
  const cnt = (arr, lo, hi) => arr.filter(x => x.pn > lo && x.pn <= hi).length;
  console.log(`  V6 卖信号 profitPercent 分桶: (0,30]=${cnt(v6pn,0,30)} (30,60]=${cnt(v6pn,30,60)} (60,100]=${cnt(v6pn,60,100)} >100=${cnt(v6pn,100,1e9)}`);
  console.log(`  B2 卖信号 profitPercent 分桶: (0,30]=${cnt(b2pn,0,30)} (30,60]=${cnt(b2pn,30,60)} (60,100]=${cnt(b2pn,60,100)} >100=${cnt(b2pn,100,1e9)}`);
  // B2 P9 早卖票（卖时 pn∈(30,100]）在 V6 的同票结局
  const b2P9ish = b2pn.filter(x => x.pn > 30 && x.pn <= 100);
  console.log(`\n  B2 卖时浮盈 (30,100] 的卖信号 ${b2P9ish.length} 条；这些 token 在 V6 的净额 vs B2：`);
  const cmp = [];
  for (const x of b2P9ish) {
    if (p6.has(x.tok) && p2.has(x.tok)) cmp.push({ tok: x.tok, b2: p2.get(x.tok).netWithOpen, v6: p6.get(x.tok).netWithOpen });
  }
  if (cmp.length) {
    console.log(`  共同票 ${cmp.length} 张: B2 合计 ${f2(sum(cmp.map(c=>c.b2)))} → V6 合计 ${f2(sum(cmp.map(c=>c.v6)))}（P9 晚卖增益 ${f2(sum(cmp.map(c=>c.v6)) - sum(cmp.map(c=>c.b2)))}）`);
    for (const c of [...cmp].sort((a,b)=>(b.v6-b.b2)-(a.v6-a.b2)).slice(0,5)) console.log(`    Δ${f2(c.v6-c.b2)} (B2 ${f2(c.b2)} → V6 ${f2(c.v6)}) ${c.tok}`);
    for (const c of [...cmp].sort((a,b)=>(a.v6-a.b2)-(b.v6-b.b2)).slice(0,3)) console.log(`    Δ${f2(c.v6-c.b2)} (B2 ${f2(c.b2)} → V6 ${f2(c.v6)}) ${c.tok}`);
  }
  void p9sell;

  console.log('\n[done]');
  process.exit(0);
}

function median(arr) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
