#!/usr/bin/env node
// ============================================================================
// 「router 门拒数次后买入」晚进车验证（2026-10-03 用户观察）
//
// 用户假设：好多损失来自 earlyTradesRouterPct 出界被拒数次、rp 漂进 [50,80) 后
// 才成交的票——门拦住了早期低价，放行了晚期高价，净效果是挑最差的时点买。
//
// 口径：逐 token 信号序列（R1 buy 信号全量，含 executed=false 被拒行）：
//   B 组（router 拒后买，exclusive）= 最终成交前存在信号「platform==flap 且 rp 出界，
//     其余门全过（narrative/top1/covered/uw）」——延迟确由 router 门造成；
//   B' 组（mixed）= 之前存在 rp 出界信号（无论其它门是否同时拒）——宽口径参考；
//   A 组 = 其余（首 fire 即成交 / 拒因与 router 无关）。
// 统计各组净额（FIFO join trades）/ 胜率 / 被拒次数 / 成交时 tokenAgeSec /
// rp 首次出界侧（<50 vs >=80）/ 漂移形状。
//
// 用法（182）：node scripts/analyze-router-late-entry.cjs [--exp 5efaff23-…]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const EXP = argVal('--exp', '5efaff23-07c5-45e0-9eff-3527ab9d5240');

async function pullSignals(client, expId) {
  const pageSize = 1000; let offset = 0; const all = [];
  for (;;) {
    const { data, error } = await client.from('strategy_signals')
      .select('id, token_address, action, executed, created_at, metadata')
      .eq('experiment_id', expId).eq('action', 'buy')
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error('signals 查询失败: ' + error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function pullTrades(client, expId) {
  const pageSize = 1000; let offset = 0; const all = [];
  for (;;) {
    const { data, error } = await client.from('trades')
      .select('token_address, trade_direction, input_amount, output_amount, trade_status, success')
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

function pnlByToken(trades) {
  const by = new Map();
  for (const t of trades) {
    if (!(t.success === true || t.trade_status === 'success')) continue;
    const isBuy = t.trade_direction === 'buy';
    const rec = by.get(t.token_address) || { spent: 0, received: 0, queue: [] };
    const inAmt = parseFloat(t.input_amount || 0), outAmt = parseFloat(t.output_amount || 0);
    if (isBuy) { if (outAmt > 0) { rec.queue.push({ amount: outAmt, cost: inAmt }); rec.spent += inAmt; } }
    else {
      let rem = inAmt;
      while (rem > 0 && rec.queue.length) {
        const o = rec.queue[0];
        const sell = Math.min(rem, o.amount); const unit = o.cost / o.amount;
        o.amount -= sell; o.cost -= unit * sell; rem -= sell;
        if (o.amount <= 1e-12) rec.queue.shift();
      }
      rec.received += outAmt;
    }
    by.set(t.token_address, rec);
  }
  for (const [a, r] of by) {
    r.netWithOpen = r.received - r.spent + r.queue.reduce((s, q) => s + q.cost, 0);
    delete r.queue; if (r.spent === 0) by.delete(a);
  }
  return by;
}

const f2 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const sum = (a) => a.reduce((s, x) => s + x, 0);
function median(arr) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

/** 复刻 preBuyCheckCondition 各门 pass/fail */
function gates(meta) {
  const pb = meta?.preBuyCheckFactors || {};
  const nr = pb.narrativeRating;
  return {
    narrative: nr === 2 || nr === 3,
    top1: pb.earlyTradesTop1BuySharePct < 60,
    covered: pb.earlyTradesTop1BuyCovered === 1,
    router: pb.platform !== 'flap' || (pb.earlyTradesRouterPct >= 50 && pb.earlyTradesRouterPct < 80),
    uw: pb.earlyTradesUniqueWallets >= 15,
    rpVal: pb.earlyTradesRouterPct,
    isFlap: pb.platform === 'flap',
    narVal: nr,
    ageSec: meta?.trendFactors?.tokenAgeSec,
  };
}

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  console.log('EXP =', EXP, '\n');
  const [sigs, trades] = await Promise.all([pullSignals(db, EXP), pullTrades(db, EXP)]);
  const pnl = pnlByToken(trades);

  // 逐 token 信号序列
  const byTok = new Map();
  for (const s of sigs) {
    if (!byTok.has(s.token_address)) byTok.set(s.token_address, []);
    byTok.get(s.token_address).push(s);
  }

  const rows = [];
  for (const [addr, seq] of byTok) {
    seq.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const fillIdx = seq.findIndex(s => s.executed);
    if (fillIdx < 0 || !pnl.has(addr)) continue;   // 未成交票不进本分析
    const fill = seq[fillIdx];
    const pre = seq.slice(0, fillIdx);
    const fillG = gates(fill.metadata);
    let exclRouterRejects = 0, mixedRouterRejects = 0;
    let firstOutSide = null;   // 首次出界侧 '<50' / '>=80'
    for (const s of pre) {
      const g = gates(s.metadata);
      if (!g.isFlap || g.rpVal == null) continue;
      if (g.rpVal >= 50 && g.rpVal < 80) continue;   // rp 在窗内（其它门拒的）
      if (firstOutSide == null) firstOutSide = g.rpVal < 50 ? '<50' : '>=80';
      mixedRouterRejects++;
      if (g.narrative && g.top1 && g.covered && g.uw) exclRouterRejects++;   // 仅 router 拒
    }
    rows.push({
      addr, net: pnl.get(addr).netWithOpen,
      fillIdx, preCount: pre.length, exclRouterRejects, mixedRouterRejects, firstOutSide,
      fillRp: fillG.rpVal, fillAge: fillG.ageSec, fillNar: fillG.narVal,
      firstAge: pre.length ? gates(pre[0].metadata).ageSec : fillG.ageSec,
      firstRp: pre.length ? gates(pre[0].metadata).rpVal : fillG.rpVal,
      delayedMs: pre.length ? new Date(fill.created_at) - new Date(pre[0].created_at) : 0,
    });
  }

  const B = rows.filter(r => r.exclRouterRejects > 0);
  const Bm = rows.filter(r => r.mixedRouterRejects > 0 && r.exclRouterRejects === 0);
  const A = rows.filter(r => r.mixedRouterRejects === 0);

  console.log(`成交 token ${rows.length}（buy 信号 ${sigs.length} 条）\n`);
  const grp = (name, g) => {
    if (!g.length) { console.log(`${name}: 0 张`); return; }
    const nets = g.map(r => r.net);
    console.log(`${name}: ${g.length} 张 | 净额合计 ${f2(sum(nets))}（亏票 ${f2(sum(nets.filter(x=>x<=0)))} / 赢票 ${f2(sum(nets.filter(x=>x>0)))}）| 胜 ${g.filter(r=>r.net>0).length} / 负 ${g.filter(r=>r.net<=0).length} | 亏率 ${f1(100*g.filter(r=>r.net<=0).length/g.length)}%`);
    console.log(`   成交时 age P50=${f1(median(g.map(r=>r.fillAge).filter(x=>x!=null)))}s | 首 fire→成交延迟 P50=${f1(median(g.map(r=>r.delayedMs))/1000)}s`);
  };
  grp('A 首买无 router 拒', A);
  grp('B router exclusive 拒后买（延迟确由 router 门）', B);
  grp("B' router mixed 拒后买（宽口径）", Bm);

  if (B.length) {
    console.log(`\n-- B 组细分 --`);
    const bySide = {};
    for (const r of B) { const k = r.firstOutSide || '?'; (bySide[k] = bySide[k] || []).push(r); }
    for (const [k, g] of Object.entries(bySide)) {
      console.log(`  首次出界侧 ${k}: ${g.length} 张 | 净额 ${f2(sum(g.map(r=>r.net)))} | 拒次数 P50=${median(g.map(r=>r.exclRouterRejects))}`);
    }
    const rejBuckets = {};
    for (const r of B) { const k = r.exclRouterRejects <= 2 ? '1-2' : r.exclRouterRejects <= 10 ? '3-10' : '>10'; (rejBuckets[k] = rejBuckets[k] || []).push(r); }
    for (const [k, g] of Object.entries(rejBuckets)) console.log(`  被拒 ${k} 次: ${g.length} 张 | 净额 ${f2(sum(g.map(r=>r.net)))}`);
    console.log(`  B 组 rp 漂移形状: 首 rp P50=${f1(median(B.map(r=>r.firstRp).filter(x=>x!=null)))} → 成交 rp P50=${f1(median(B.map(r=>r.fillRp).filter(x=>x!=null)))}`);
    console.log(`\n  B 组最亏 8 张:`);
    for (const r of [...B].sort((a,b)=>a.net-b.net).slice(0,8)) console.log(`    ${f2(r.net)} 首rp=${r.firstRp==null?'?':f1(r.firstRp)}(${r.firstOutSide})→成交rp=${r.fillRp==null?'?':f1(r.fillRp)} 拒${r.exclRouterRejects}次 成交age=${r.fillAge==null?'?':f1(r.fillAge)+'s'} nar=${r.fillNar ?? '?'} ${r.addr}`);
    console.log(`  B 组最赚 3 张:`);
    for (const r of [...B].sort((a,b)=>b.net-a.net).slice(0,3)) console.log(`    +${f2(r.net)} 首rp=${r.firstRp==null?'?':f1(r.firstRp)}(${r.firstOutSide})→成交rp=${r.fillRp==null?'?':f1(r.fillRp)} 拒${r.exclRouterRejects}次 成交age=${r.fillAge==null?'?':f1(r.fillAge)+'s'} ${r.addr}`);
  }

  console.log('\n[done]');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
