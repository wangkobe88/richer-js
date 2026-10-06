#!/usr/bin/env node
// ============================================================================
// 6f92e2f9 实跑（旧代码）vs 1d363b19 回测（新代码 04f135b）共同票买点 age 对拍
// （2026-10-04；182 专用）——定位「买点不一致」的机制：系统性延迟 vs 零散抖动
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const LIVE = '6f92e2f9-1b21-4ea6-b6a1-2e8dc70090e3';
const BT   = '1d363b19-1f13-46dc-b000-9e602fea96be';

async function pullBuySigs(client, expId) {
  const pageSize = 1000; let offset = 0; const all = [];
  for (;;) {
    const { data, error } = await client.from('strategy_signals')
      .select(`id, token_address, created_at, executed,
               ageSec:metadata->trendFactors->>tokenAgeSec,
               cyc:metadata->trendFactors->>tokenCycle,
               rp:metadata->preBuyCheckFactors->>earlyTradesRouterPct,
               uw:metadata->preBuyCheckFactors->>earlyTradesUniqueWallets`)
      .eq('experiment_id', expId).eq('action', 'buy')
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error('signals 查询失败: ' + error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  const m = new Map(); // token → 首条已执行 BUY
  for (const r of all) {
    if (r.executed !== true) continue;
    if (!m.has(r.token_address)) m.set(r.token_address, r);
  }
  return m;
}

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

function pnlByToken(trades) {
  const by = new Map();
  for (const t of trades) {
    if (!(t.success === true || t.trade_status === 'success')) continue;
    const isBuy = t.trade_direction === 'buy';
    const rec = by.get(t.token_address) || { spent: 0, received: 0, buys: 0, sells: 0, queue: [] };
    const inAmt = parseFloat(t.input_amount || 0), outAmt = parseFloat(t.output_amount || 0);
    if (isBuy) { if (outAmt > 0) { rec.queue.push({ amount: outAmt, cost: inAmt }); rec.spent += inAmt; rec.buys++; } }
    else {
      let rem = inAmt;
      while (rem > 0 && rec.queue.length) { const o = rec.queue[0]; const s = Math.min(rem, o.amount); const u = o.cost / o.amount; o.amount -= s; o.cost -= u * s; rem -= s; if (o.amount <= 1e-12) rec.queue.shift(); }
      rec.received += outAmt; rec.sells++;
    }
    by.set(t.token_address, rec);
  }
  for (const [a, r] of by) { r.leftover = r.queue.reduce((s, q) => s + q.cost, 0); r.netWO = r.received - r.spent + r.leftover; if (r.buys === 0) by.delete(a); }
  return by;
}

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const [sL, sB, tL, tB] = await Promise.all([pullBuySigs(db, LIVE), pullBuySigs(db, BT), pullTrades(db, LIVE), pullTrades(db, BT)]);
  const pL = pnlByToken(tL), pB = pnlByToken(tB);
  const common = [...pL.keys()].filter(x => pB.has(x));

  console.log('═'.repeat(88));
  console.log('共同 ' + common.length + ' 票买点对拍（Δ = 实跑age − 回测age；正=实跑更晚）');
  let sumD = 0, nD = 0, big = 0, lSum = 0, bSum = 0;
  const rows = [];
  for (const a of common) {
    const sl = sL.get(a), sb = sB.get(a);
    const al = sl && sl.ageSec != null ? parseFloat(sl.ageSec) : NaN;
    const ab = sb && sb.ageSec != null ? parseFloat(sb.ageSec) : NaN;
    const d = (Number.isFinite(al) && Number.isFinite(ab)) ? al - ab : NaN;
    if (Number.isFinite(d)) { sumD += d; nD++; if (Math.abs(d) > 10) big++; }
    lSum += pL.get(a).netWO; bSum += pB.get(a).netWO;
    rows.push({ a, al, ab, d, ln: pL.get(a).netWO, bn: pB.get(a).netWO, cycL: sl ? sl.cyc : '?', cycB: sb ? sb.cyc : '?' });
  }
  rows.sort((x, y) => (Number.isFinite(y.d) ? y.d : -999) - (Number.isFinite(x.d) ? x.d : -999));
  for (const r of rows) {
    console.log('  ' + (Number.isFinite(r.d) && Math.abs(r.d) > 10 ? '◆' : ' ') + ' ' + r.a +
      '  实跑 ' + (Number.isFinite(r.al) ? r.al.toFixed(1) : '?') + 's(cyc' + r.cycL + ')  回测 ' + (Number.isFinite(r.ab) ? r.ab.toFixed(1) : '?') + 's(cyc' + r.cycB + ')' +
      '  Δ ' + (Number.isFinite(r.d) ? r.d.toFixed(1) : '?') +
      '  净 实 ' + r.ln.toFixed(4) + ' / 回 ' + r.bn.toFixed(4));
  }
  console.log('\n统计: 平均Δ ' + (nD ? (sumD / nD).toFixed(1) : '?') + 's | |Δ|>10s 共 ' + big + '/' + nD + ' 张 | 实跑Σ ' + lSum.toFixed(4) + ' 回测Σ ' + bSum.toFixed(4));

  // Δ 与净差的相关性：实跑晚买的票是否实跑侧更差
  let worseLate = 0, nLate = 0;
  for (const r of rows) {
    if (Number.isFinite(r.d) && r.d > 10) { nLate++; if (r.ln < r.bn - 0.01) worseLate++; }
  }
  console.log('实跑晚 >10s 的票: ' + nLate + ' 张，其中实跑净更差: ' + worseLate + ' 张');
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
