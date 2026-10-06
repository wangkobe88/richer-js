#!/usr/bin/env node
// ============================================================================
// router 门去上限配对对拍（2026-10-04；182 专用——dbManager service key）
//
// 基准臂 A = 7e4abe0f（原门 [50,80)）：+2.5921 / 236 笔
// 去上限臂 B = 1d363b19（门 >=50）  ：+2.6543 / 254 笔
// 同窗 10-03T14:31→10-04T12:47Z 同源 6f92e2f9，差分 = 去 rp<80 上限净效应
//
// 输出六节：
//   ① 两臂总览 + 门净效应
//   ② 买票配对（B 独有 = 上限放行票，核心；A 独有 = 时序扰动应极少）
//   ③ B 独有票逐张归因（rp>=80 目标票 vs <80 时序扰动票）
//   ④ 净效应分解（目标票 Σ vs 扰动票 Σ vs 共同票扰动）
//   ⑤ 重点票 0xce8cd114 买点 age 对拍（6f92e2f9 实跑 51.8s vs 两回测臂）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const A = '7e4abe0f-aa87-4aa1-9d6c-85b950da9b0e';  // 基准（原门）
const B = '1d363b19-1f13-46dc-b000-9e602fea96be';  // 去上限
const LIVE = '6f92e2f9-1b21-4ea6-b6a1-2e8dc70090e3'; // 旧代码实跑（对照买点）
const FOCUS = '0xce8cd1141f08bd31c833fd1228f76053fc237777';

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

// 窄列拉取（metadata 全字段分页会 statement timeout）
async function pullSignals(client, expId) {
  const pageSize = 1000; let offset = 0; const all = [];
  for (;;) {
    const { data, error } = await client.from('strategy_signals')
      .select(`id, token_address, action, executed, created_at,
               rp:metadata->preBuyCheckFactors->>earlyTradesRouterPct,
               ageSec:metadata->trendFactors->>tokenAgeSec,
               nar:metadata->preBuyCheckFactors->>narrativeRating,
               plat:metadata->preBuyCheckFactors->>platform,
               plat2:metadata->trendFactors->>platform`)
      .eq('experiment_id', expId).order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error('signals 查询失败: ' + error.message);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const rp = r.rp != null ? parseFloat(r.rp) : NaN;
      r.rp = Number.isFinite(rp) ? rp : null;
      const age = r.ageSec != null ? parseFloat(r.ageSec) : NaN;
      r.ageSec = Number.isFinite(age) ? age : null;
      const nar = r.nar != null ? parseFloat(r.nar) : NaN;
      r.nar = Number.isFinite(nar) ? nar : null;
      r.plat = r.plat || r.plat2 || '?';
    }
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

/** FIFO per-token PnL → Map(token → rec) */
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
    r.net = r.received - r.spent;          // 已实现
    r.netWithOpen = r.net + r.leftoverCost; // 含残余持仓成本回冲
    delete r.queue;
    if (r.buys === 0) by.delete(addr);
  }
  return by;
}

const f4 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const sum = (a) => a.reduce((s, x) => s + x, 0);

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  const [tA, tB, sA, sB] = await Promise.all([
    pullTrades(db, A), pullTrades(db, B), pullSignals(db, A), pullSignals(db, B),
  ]);
  const pA = pnlByToken(tA), pB = pnlByToken(tB);
  const firstBuySig = (sigs) => { const m = new Map(); for (const s of sigs) if (s.action === 'buy' && !m.has(s.token_address)) m.set(s.token_address, s); return m; };
  const mA = firstBuySig(sA), mB = firstBuySig(sB);

  // ── ① 总览 ──
  const tot = (p) => ({ tokens: p.size, net: sum([...p.values()].map(r => r.netWithOpen)) });
  const a = tot(pA), b = tot(pB);
  console.log('═'.repeat(72));
  console.log('① 两臂总览（netWithOpen = FIFO 净额 + 残余持仓成本回冲）');
  console.log(`  A 基准(原门 [50,80))  ${A.slice(0, 8)}: ${a.tokens} 票  净额 ${f4(a.net)}`);
  console.log(`  B 去上限(>=50)        ${B.slice(0, 8)}: ${b.tokens} 票  净额 ${f4(b.net)}`);
  console.log(`  门净效应 (B−A) = ${f4(b.net - a.net)}`);

  // ── ② 买票配对 ──
  const onlyB = [...pB.keys()].filter(x => !pA.has(x));
  const onlyA = [...pA.keys()].filter(x => !pB.has(x));
  const common = [...pB.keys()].filter(x => pA.has(x));
  console.log('\n' + '═'.repeat(72));
  console.log(`② 买票配对：共同 ${common.length} | B 独有 ${onlyB.length} | A 独有 ${onlyA.length}`);

  // ── ③ B 独有逐张（上限放行票 vs 时序扰动票）──
  console.log('\n' + '═'.repeat(72));
  console.log('③ B 独有票逐张（rp≥80 = 上限放行目标票；rp<80/null = 时序扰动票）');
  const rows = onlyB.map(addr => {
    const sig = mB.get(addr);
    const r = pB.get(addr);
    return { addr, rp: sig ? sig.rp : null, plat: sig ? sig.plat : '?', nar: sig ? sig.nar : null, net: r.netWithOpen, buys: r.buys, sells: r.sells };
  }).sort((x, y) => (y.net) - (x.net));
  let tgtNet = 0, tgtN = 0, distNet = 0, distN = 0;
  for (const r of rows) {
    const isTgt = r.rp != null && r.rp >= 80;
    if (isTgt) { tgtNet += r.net; tgtN++; } else { distNet += r.net; distN++; }
    console.log(`  ${isTgt ? '★目标' : ' 时序'} ${r.addr}  rp=${r.rp == null ? 'null' : r.rp.toFixed(1)}  ${r.plat}  评${r.nar == null ? '?' : r.nar}  买${r.buys}/卖${r.sells}  净 ${f4(r.net)}`);
  }
  if (!rows.length) console.log('  （无 B 独有票）');
  if (onlyA.length) {
    console.log('  A 独有（应极少，时序扰动）：');
    for (const addr of onlyA) {
      const sig = mA.get(addr); const r = pA.get(addr);
      console.log(`    ${addr}  rp=${sig ? (sig.rp == null ? 'null' : sig.rp.toFixed(1)) : '?'}  净 ${f4(r.netWithOpen)}`);
    }
  }

  // ── ④ 净效应分解 ──
  let commonDrift = 0;
  for (const addr of common) commonDrift += pB.get(addr).netWithOpen - pA.get(addr).netWithOpen;
  console.log('\n' + '═'.repeat(72));
  console.log('④ 净效应分解（B−A）');
  console.log(`  上限放行目标票 Σ = ${f4(tgtNet)}（${tgtN} 张）`);
  console.log(`  时序扰动 B 独有 Σ = ${f4(distNet)}（${distN} 张）`);
  console.log(`  共同票净额漂移 Σ = ${f4(commonDrift)}（${common.length} 张，回测资金竞争二阶效应应≈0）`);
  console.log(`  合计 = ${f4(tgtNet + distNet + sum(onlyA.map(x => -pA.get(x).netWithOpen))) + commonDrift}（对照 ① ${f4(b.net - a.net)}）`);

  // ── ⑤ 重点票买点 age 对拍 ──
  console.log('\n' + '═'.repeat(72));
  console.log(`⑤ 重点票 ${FOCUS} 买点 age 对拍（fire 时刻 trendFactors.tokenAgeSec）`);
  for (const [label, expId] of [['6f92e2f9 旧代码实跑', LIVE], ['A 基准臂(原门)', A], ['B 去上限臂', B]]) {
    const { data, error } = await db.from('strategy_signals')
      .select(`created_at, ageSec:metadata->trendFactors->>tokenAgeSec, rp:metadata->preBuyCheckFactors->>earlyTradesRouterPct`)
      .eq('experiment_id', expId).eq('token_address', FOCUS).eq('action', 'buy')
      .order('created_at', { ascending: true }).limit(5);
    if (error) { console.log(`  ${label}: 查询失败 ${error.message}`); continue; }
    if (!data || data.length === 0) { console.log(`  ${label}: 无 BUY 信号`); continue; }
    console.log(`  ${label}: 首BUY age=${data[0].ageSec}s @ ${data[0].created_at}（共 ${data.length} 条）`);
  }
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
