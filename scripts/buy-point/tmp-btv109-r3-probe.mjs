// btv109 第二批复审 4 条反馈取证（182 跑）：
// ① T019 活跃度数值族（high 判档质疑）② T023/T028/T029/T033 大户在场 ③ T025 block 级捆绑砸盘 ④ T032 burst 量级
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';
const TICKS = 'scripts/buy-point/sets/btv109-trades-ticks';
const SET = 'scripts/buy-point/sets/btv109-trades.json';
const RUN = 'scripts/buy-point/data/bp-run-2026-11-12T23-22-53-137Z.json';

const TARGETS = {
  'T019 Q币安':    '0x9b1fb6a662e2b1e5a521ea1dd5147f13184b7777',
  'T023 富个鸟':    '0x580f0576e67f332508b171564f53368666a37777',
  'T025 p':        '0x778259fa35540aa8b427ced758fe59f16c2c7777',
  'T028 Insidejob': '0xce056d2c3f50cab7ca228af040c89b706c167777',
  'T029 大輔':      '0x5b78cceda4dc7dac719e17e76d0000e73c5a7777',
  'T032 币安logo':  '0xc1763b4c7e284da879c213cbc32a86de1f307777',
  'T033 币安AI':    '0x04e05fe9564d6b722468c157326b7772b0e37777',
};
const WHALES = new Set(['T023 富个鸟', 'T028 Insidejob', 'T029 大輔', 'T033 币安AI']);

const set = JSON.parse(fs.readFileSync(SET, 'utf8'));
const anchorOf = new Map(set.points.map(p => [p.tokenAddress, p.anchorTimeIso]));
const run = JSON.parse(fs.readFileSync(RUN, 'utf8'));
const runByPoint = new Map(run.results.map(r => [r.pointId, r]));

// ── 信号轨迹（全部 BUY，含被拒）──
const c = await dbManager.getClient();
const sigs = []; let from = 0;
while (true) {
  const { data, error } = await c.from('strategy_signals')
    .select('id,token_address,action,executed,reason,metadata,created_at')
    .eq('experiment_id', EXP).order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(error.message);
  sigs.push(...data); if (data.length < 1000) break; from += 1000;
}
const byTok = new Map();
for (const s of sigs) {
  if (!byTok.has(s.token_address)) byTok.set(s.token_address, []);
  byTok.get(s.token_address).push(s);
}

const wallet = (r) => (r.sender_address || r.trader_address || '').toLowerCase();
const ts = (iso) => Date.parse(iso) / 1000;
const fmtN = (v, d = 2) => (v == null ? '?' : Number(v).toFixed(d));

// ── 静默段 + 出口波重算（CD 口径简化版：gap≥50s 段，出口后 60s 最密 5s 窗）──
function burstShapes(rows, aTs) {
  const pre = rows.filter(r => ts(r.block_time) <= aTs);
  const out = [];
  // 静默段：相邻行间隔 ≥50s
  for (let i = 1; i < pre.length; i++) {
    const gap = ts(pre[i].block_time) - ts(pre[i - 1].block_time);
    if (gap >= 50) out.push({ gapSec: Math.round(gap), exitAt: pre[i].block_time, exitTs: ts(pre[i].block_time) });
  }
  // 首行前静默（token 出生前不算）；每段出口后 60s 内最密 5s 滑窗（按块时刻整秒扫）
  for (const seg of out) {
    const win = pre.filter(r => ts(r.block_time) >= seg.exitTs && ts(r.block_time) <= seg.exitTs + 60 && r.trade_type === 'buy');
    let best = { bnb: 0, n: 0, wallets: new Set(), t0: null };
    for (let s0 = seg.exitTs; s0 < seg.exitTs + 55; s0 += 1) {
      const w = win.filter(r => ts(r.block_time) >= s0 && ts(r.block_time) < s0 + 5);
      const bnb = w.reduce((a, r) => a + r.bnb_amount, 0);
      if (bnb > best.bnb) best = { bnb, n: w.length, wallets: new Set(w.map(wallet)), t0: s0 };
    }
    seg.wave = { buyBnb: +best.bnb.toFixed(3), ticks: best.n, wallets: best.wallets.size, at: best.t0 ? new Date(best.t0 * 1000).toISOString().slice(11, 19) : null };
    seg.secSinceWaveEnd = best.t0 ? Math.round(aTs - (best.t0 + 5)) : null;
  }
  // 全窗最密 5s 窗对照
  let gBest = { bnb: 0, n: 0, wallets: new Set(), t0: null };
  for (let s0 = ts(pre[0]?.block_time || 0); s0 < aTs - 4; s0 += 1) {
    const w = pre.filter(r => ts(r.block_time) >= s0 && ts(r.block_time) < s0 + 5 && r.trade_type === 'buy');
    const bnb = w.reduce((a, r) => a + r.bnb_amount, 0);
    if (bnb > gBest.bnb) gBest = { bnb, n: w.length, wallets: new Set(w.map(wallet)), t0: s0 };
  }
  return { segs: out, globalBest: { buyBnb: +gBest.bnb.toFixed(3), ticks: gBest.n, wallets: gBest.wallets.size, at: gBest.t0 ? new Date(gBest.t0 * 1000).toISOString().slice(11, 19) : null } };
}

for (const [name, addr] of Object.entries(TARGETS)) {
  const j = JSON.parse(fs.readFileSync(`${TICKS}/${addr}.json`, 'utf8'));
  const rows = j.rows;
  const anchor = anchorOf.get(addr) || rows[rows.length - 1].block_time;
  const aTs = ts(anchor);
  const pre = rows.filter(r => ts(r.block_time) <= aTs);
  console.log(`\n══════ ${name} ${addr} ════`);
  console.log(`ticks=${rows.length}（锚前 ${pre.length}）窗 ${rows[0].block_time.slice(11, 19)}→${rows[rows.length - 1].block_time.slice(11, 19)} 锚=${anchor.slice(11, 19)} age=${Math.round((aTs - ts(rows[0].block_time)))}s`);

  // A. 信号轨迹
  const list = byTok.get(addr) || [];
  const buys = list.filter(s => s.action === 'buy');
  console.log(`BUY 信号 ${buys.length} 条：`);
  buys.forEach((s, i) => {
    const cc = s.metadata?.cheatCheck, bp = s.metadata?.buyPoint;
    const ccStr = cc ? `${cc.grade}${cc.exempt ? '(ex:' + cc.exempt.code + ')' : ''}${cc.levels ? ' act=' + (cc.levels.activityLevel ?? '?') + ' sbw=' + (cc.levels.stallBurstWave ?? '?') : ''}` : '无cheat段';
    const bpAct = bp?.digest?.activity_level ?? bp?.assessment?.activityLevel ?? null;
    const bpStr = bp ? `bp:${bp.status}${bp.rule ? '/' + bp.rule : ''}${bpAct ? ' act题=' + JSON.stringify(bpAct) : ''}` : '';
    console.log(`  #${i + 1} ${s.created_at.slice(11, 19)} ${s.executed ? '✅成交' : '❌拒'} ${s.metadata?.strategyName || ''} ${ccStr} ${bpStr}`.trim());
  });

  // B. T019 活跃度数值族
  if (name === 'T019 Q币安') {
    const span = aTs - ts(pre[0].block_time);
    const totBuy = pre.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    const totSell = pre.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    let maxGap = 0, idle = 0;
    for (let i = 1; i < pre.length; i++) {
      const g = ts(pre[i].block_time) - ts(pre[i - 1].block_time);
      maxGap = Math.max(maxGap, g); if (g > 5) idle += g - 5;
    }
    const tail10 = pre.filter(r => aTs - ts(r.block_time) < 10);
    const pre20 = pre.filter(r => aTs - ts(r.block_time) >= 10 && aTs - ts(r.block_time) < 30);
    const tail5 = pre.filter(r => aTs - ts(r.block_time) < 5);
    console.log(`\n[活跃度数值族·简化重算]`);
    console.log(`  全窗: span=${Math.round(span)}s ticks=${pre.length} ${fmtN(pre.length / (span / 60))}/min Σ买=${fmtN(totBuy)} Σ卖=${fmtN(totSell)} avg=${fmtN((totBuy + totSell) / pre.length, 3)} maxGap=${Math.round(maxGap)}s idlePct≈${fmtN(idle / span * 100, 1)}%`);
    const t10b = tail10.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    const t10s = tail10.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    console.log(`  尾10s: ${tail10.length}笔 买${fmtN(t10b)}(${tail10.filter(r => r.trade_type === 'buy').length}) 卖${fmtN(t10s)}(${tail10.filter(r => r.trade_type === 'sell').length}) 卖家${new Set(tail10.filter(r => r.trade_type === 'sell').map(wallet)).size} → BnbPerMin=${fmtN((t10b + t10s) * 6)}`);
    const p20 = pre20.reduce((a, r) => a + r.bnb_amount, 0);
    console.log(`  前20s(10~30s前): ${pre20.length}笔 BnbPerMin=${fmtN(p20 * 3)}`);
    const t5b = tail5.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    console.log(`  尾5s: ${tail5.length}笔 买${tail5.filter(r => r.trade_type === 'buy').length}笔${fmtN(t5b)}BNB`);
    console.log(`  逐10s桶（买额/卖额/笔数）:`);
    const first = ts(pre[0].block_time);
    for (let b = Math.floor((aTs - 120) / 10) * 10; b < (aTs - first > 120 ? aTs : aTs); b += 10) {
      if (b < first) continue;
      const w = pre.filter(r => { const t = ts(r.block_time); return t >= b && t < b + 10; });
      if (!w.length) { console.log(`    ${new Date(b * 1000).toISOString().slice(11, 19)} —（空桶）`); continue; }
      const bb = w.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
      const ss = w.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
      console.log(`    ${new Date(b * 1000).toISOString().slice(11, 19)} b${fmtN(bb)}(${w.filter(r => r.trade_type === 'buy').length}) s${fmtN(ss)}(${w.filter(r => r.trade_type === 'sell').length}) w${new Set(w.map(wallet)).size}`);
    }
    // 生产+重析 act 轨迹对照
    const r19 = runByPoint.get('BP-T019');
    console.log(`  重析 act=${r19?.dimensions?.activity_level?.bucket}(${r19?.dimensions?.activity_level?.prob})`);
    const sig = buys.find(s => s.executed) || buys[0];
    const lv = sig?.metadata?.cheatCheck?.levels;
    if (lv) console.log(`  生产 cheat levels: activity=${lv.activityLevel} sbw=${lv.stallBurstWave} 其余键=${Object.keys(lv).filter(k => /act|burst|stall/i.test(k)).map(k => k + '=' + lv[k]).join(' ')}`);
  }

  // C. 大户在场（BP79 三分）
  if (WHALES.has(name)) {
    const bigBuyers = new Set(pre.filter(r => r.trade_type === 'buy' && r.bnb_amount >= 0.19).map(wallet));
    const agg = new Map();
    for (const r of pre) {
      const w = wallet(r);
      if (!agg.has(w)) agg.set(w, { buy: 0, sell: 0, last: r.block_time, maxBuy: 0, firstBuy: null });
      const o = agg.get(w);
      if (r.trade_type === 'buy') { o.buy += r.bnb_amount; o.maxBuy = Math.max(o.maxBuy, r.bnb_amount); o.firstBuy ??= r.block_time; } else o.sell += r.bnb_amount;
      o.last = r.block_time;
    }
    console.log(`\n[大户在场]（单笔≥0.19 买过的钱包 ${bigBuyers.size} 个，锚时刻三分）：`);
    let any = false;
    for (const w of bigBuyers) {
      const o = agg.get(w); if (!o) continue; any = true;
      const net = o.buy - o.sell;
      const secSince = Math.round(aTs - ts(o.last));
      const cls = net > 0.005 ? (secSince <= 120 ? '★活跃在场' : '挂账在场(>120s)') : '已清仓';
      console.log(`  ${w.slice(0, 10)} 首买${(o.firstBuy || '').slice(11, 19)} 买${fmtN(o.buy)} 卖${fmtN(o.sell)} 净${fmtN(net, 3)} max单笔${fmtN(o.maxBuy)} 末动${secSince}s前 → ${cls}`);
    }
    if (!any) console.log('  （无单笔≥0.19 买入钱包）');
    // 同 block 捆绑买入汇总（BP73 口径）
    const blocks = new Map();
    for (const r of pre) if (r.trade_type === 'buy') {
      if (!blocks.has(r.block_number)) blocks.set(r.block_number, []);
      blocks.get(r.block_number).push(r);
    }
    const bundled = [...blocks.entries()].map(([blk, rs]) => ({ blk, bnb: rs.reduce((a, r) => a + r.bnb_amount, 0), n: rs.length, w: new Set(rs.map(wallet)).size, ts2: rs[0].block_time }))
      .sort((x, y) => y.bnb - x.bnb)[0];
    if (bundled) console.log(`  同块捆绑最大块: b${bundled.blk} ${bundled.ts2.slice(11, 19)} ${fmtN(bundled.bnb)}BNB/${bundled.n}笔/${bundled.w}钱包`);
    // 全体钱包买入额 top5
    const top5 = [...agg.entries()].map(([w, o]) => ({ w, buy: o.buy, sell: o.sell, max: o.maxBuy })).sort((x, y) => y.buy - x.buy).slice(0, 5);
    console.log(`  买入额 top5: ` + top5.map(t => `${t.w.slice(0, 8)}(买${fmtN(t.buy)}/max${fmtN(t.max)})`).join(' '));
  }

  // D. T025 block 级结构
  if (name === 'T025 p') {
    const blocks = new Map();
    for (const r of rows) {
      const t = ts(r.block_time);
      if (t > aTs + 300) continue;
      if (!blocks.has(r.block_number)) blocks.set(r.block_number, { blk: r.block_number, ts2: r.block_time, buy: 0, nb: 0, sell: 0, ns: 0, buyers: new Set(), sellers: new Set() });
      const b = blocks.get(r.block_number);
      if (r.trade_type === 'buy') { b.buy += r.bnb_amount; b.nb++; b.buyers.add(wallet(r)); } else { b.sell += r.bnb_amount; b.ns++; b.sellers.add(wallet(r)); }
    }
    console.log(`\n[block 结构]（锚=${anchor.slice(11, 19)}，+300s 截断）${blocks.size} 块：`);
    const arr = [...blocks.values()].sort((x, y) => x.blk - y.blk);
    for (const b of arr) {
      const flag = (b.sellers.size >= 3 && b.sell >= 0.3) ? ' ⚠️砸盘块' : '';
      const rel = ts(b.ts2) <= aTs ? '锚前' : `+${Math.round(ts(b.ts2) - aTs)}s`;
      console.log(`  ${b.ts2.slice(11, 19)} b${b.blk} 买${fmtN(b.buy)}(${b.nb}笔/${b.buyers.size}户) 卖${fmtN(b.sell)}(${b.ns}笔/${b.sellers.size}户) ${rel}${flag}`);
    }
    // 连续块判定
    const hot = arr.filter(b => b.sellers.size >= 3 && b.sell >= 0.3);
    const consec = [];
    for (let i = 1; i < hot.length; i++) if (hot[i].blk - hot[i - 1].blk <= 2) consec.push(`${hot[i - 1].blk}→${hot[i].blk}`);
    if (consec.length) console.log(`  连续砸盘块对（块号差≤2）: ${consec.join(', ')}`);
    // 锚前 60s 买家数分布（对照接刀）
    const near = pre.filter(r => aTs - ts(r.block_time) < 60);
    console.log(`  锚前60s: ${near.length}笔 买${fmtN(near.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0))} 卖${fmtN(near.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0))}`);
  }

  // E. T032 burst 量级
  if (name === 'T032 币安logo') {
    console.log(`\n[burst 量级取证]`);
    const bs = burstShapes(rows, aTs);
    console.log(`  静默段（gap≥50s）${bs.segs.length} 个：`);
    for (const s of bs.segs) console.log(`    gap=${s.gapSec}s 出口=${s.exitAt.slice(11, 19)} 波@${s.wave.at} 买${s.wave.buyBnb}BNB/${s.wave.ticks}笔/${s.wave.wallets}户 距锚${s.secSinceWaveEnd}s`);
    console.log(`  全窗最密5s窗: @${bs.globalBest.at} 买${bs.globalBest.buyBnb}BNB/${bs.globalBest.ticks}笔/${bs.globalBest.wallets}户`);
    // 生产成交信号 cheatCheck levels/anchors 完整 dump
    const sig = buys.find(s => s.executed) || buys[0];
    if (sig) {
      const lv = sig.metadata?.cheatCheck?.levels || {};
      const an = sig.metadata?.cheatCheck?.anchors || sig.metadata?.cheatCheck?.levels?.anchors || {};
      const burstKeys = o => Object.entries(o).filter(([k]) => /burst|stall|act/i.test(k));
      console.log(`  生产 cheat levels(burst/act 键): ${burstKeys(lv).map(([k, v]) => k + '=' + v).join(' ') || '无'}`);
      console.log(`  生产 cheat anchors(burst 键): ${burstKeys(an).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') || '无'}`);
      const bp = sig.metadata?.buyPoint;
      if (bp) console.log(`  生产 BP: status=${bp.status} rule=${bp.rule || '-'} digest.activity=${JSON.stringify(bp.digest?.activity_level ?? null).slice(0, 200)}`);
    }
    // 重析 run 行 digest burst 键
    const r32 = runByPoint.get('BP-T032');
    const anchors = r32?.anchors || {};
    const bkeys = Object.entries(anchors).filter(([k]) => /burst/i.test(k));
    console.log(`  重析 anchors(burst): ${bkeys.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') || '无'}`);
    const dg = r32?.digest ? Object.entries(r32.digest).filter(([k]) => /burst/i.test(k)) : [];
    if (dg.length) console.log(`  重析 digest(burst): ${dg.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ')}`);
    console.log(`  重析 act=${r32?.dimensions?.activity_level?.bucket}(${r32?.dimensions?.activity_level?.prob})`);
    // 锚前 120s 密度（burst 波到底多小）
    const near = pre.filter(r => aTs - ts(r.block_time) < 120);
    console.log(`  锚前120s: ${near.length}笔 买${fmtN(near.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0))} 卖${fmtN(near.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0))} 买家${new Set(near.filter(r => r.trade_type === 'buy').map(wallet)).size}户`);
  }
}
process.exit(0);
