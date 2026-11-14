// bt-v111（5390bbfa）门链结论分类分析 + 因子过滤分析（182 跑）
// 输出：终端汇总报告 + /tmp/btv111-gate-analysis.json 明细
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';

async function pull(table, cols, eid) {
  const c = await dbManager.getClient();
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await c.from(table).select(cols).eq('experiment_id', eid)
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(table + ': ' + error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return rows;
}

const sigs = await pull('strategy_signals', 'id,token_address,action,executed,created_at,metadata', EXP);
const trades = await pull('trades', 'id,token_address,trade_direction,input_amount,output_amount,signal_id,created_at,metadata', EXP);
const tokRows = await pull('experiment_tokens', 'token_address,token_symbol,platform', EXP);
const symbol = new Map(tokRows.map(r => [r.token_address, r.token_symbol || r.token_address.slice(0, 8)]));

const buySigs = sigs.filter(s => s.action === 'buy');
console.log(`signals 总数=${sigs.length}（BUY=${buySigs.length}，非 BUY=${sigs.length - buySigs.length}）| trades=${trades.length} | 监控票=${tokRows.length}`);

// ── 票级 episode 盈亏 ──
const sigById = new Map(sigs.map(s => [s.id, s]));
const perTok = new Map();
for (const t of trades) {
  if (!perTok.has(t.token_address)) perTok.set(t.token_address, { buy: 0, sell: 0, nBuy: 0, nSell: 0, sellArms: [] });
  const o = perTok.get(t.token_address);
  if (t.trade_direction === 'buy') { o.buy += Number(t.input_amount || 0); o.nBuy++; }
  else {
    o.sell += Number(t.output_amount || 0); o.nSell++;
    const arm = (t.signal_id && sigById.get(t.signal_id)?.metadata?.strategyName) || t.metadata?.strategyName || '?';
    o.sellArms.push(arm);
  }
}
for (const o of perTok.values()) o.net = o.sell - o.buy;
const tokNets = [...perTok.values()].map(o => o.net);
const totNet = tokNets.reduce((s, x) => s + x, 0);
const wins = tokNets.filter(x => x > 1e-9).length;
console.log(`\n═══ A. 总览 ═══`);
console.log(`成交票=${perTok.size} | 净额=${totNet.toFixed(4)} BNB | 胜率=${(wins / perTok.size * 100).toFixed(1)}% (${wins}/${perTok.size})`);
console.log(`最好=${Math.max(...tokNets).toFixed(4)} 最差=${Math.min(...tokNets).toFixed(4)}`);

// ── B. 买信号结局分类 ──
function classify(s) {
  const md = s.metadata || {};
  if (s.executed) return '成交';
  const er = md.execution_reason || '';
  if (er === 'cheat_gate_cheat') return '拒·cheat门(cheat拉黑)';
  if (er === 'cheat_gate_unhealthy') return '拒·cheat门(unhealthy)';
  if (er === 'bp_gate_assessment') return `拒·BP门(poor)`;
  if (er === 'bp_gate_insufficient_ticks') return '拒·BP门(锚窗tick不足)';
  if (er.startsWith('bp_gate_')) return `拒·BP门(${er.slice(8)})`;
  if (er) return `其它:${er.slice(0, 40)}`;
  return '未执行(无终态)';
}
const outcomeDist = new Map();
for (const s of buySigs) {
  const k = classify(s);
  outcomeDist.set(k, (outcomeDist.get(k) || 0) + 1);
}
console.log(`\n═══ B. 买信号结局分类（${buySigs.length} 条 BUY 信号）═══`);
for (const [k, n] of [...outcomeDist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

// ── C. cheat 门结论分布 ──
const cheatSeen = buySigs.filter(s => s.metadata?.cheatCheck);
const gradeDist = new Map(); const exemptDist = new Map(); const reasonDist = new Map(); const actDist = new Map();
for (const s of cheatSeen) {
  const cc = s.metadata.cheatCheck;
  const ex = cc.exempt;
  const g = ex ? `${ex.originalGrade ?? cc.grade}→豁免(${ex.code})` : (cc.grade || cc.status || '?');
  gradeDist.set(g, (gradeDist.get(g) || 0) + 1);
  if (cc.exemptDenied) exemptDist.set(`denied:${cc.exemptDenied}`, (exemptDist.get(`denied:${cc.exemptDenied}`) || 0) + 1);
  for (const r of cc.reasons || []) reasonDist.set(r, (reasonDist.get(r) || 0) + 1);
  const act = (cc.buckets?.activityLevel && (typeof cc.buckets.activityLevel === 'object' ? cc.buckets.activityLevel.bucket : cc.buckets.activityLevel)) ?? (Number.isFinite(cc.levels?.activityLevel) ? `score${cc.levels.activityLevel}` : null);
  if (act) actDist.set(act, (actDist.get(act) || 0) + 1);
}
console.log(`\n═══ C. cheat 门结论（到达 cheat 门的信号 ${cheatSeen.length} 条）═══`);
console.log('grade 分布（含豁免翻转）:');
for (const [k, n] of [...gradeDist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
console.log('活跃度档位分布:', JSON.stringify([...actDist.entries()].sort()));
console.log('grade 通道码频次:', JSON.stringify([...reasonDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)));
if (exemptDist.size) console.log('豁免 denied:', JSON.stringify([...exemptDist.entries()]));

// 16 题档位 × 结局 交叉（只统计非 none 档，压缩输出；桶名取 buckets，缺则 levels 分值）
const LV_KEYS = ['equalAmountSplit','coordinatedSellBack','creatorFrontRun','sellDispersion','stallBurstWave','amountTiering','sameBlockBuyWave','insiderSupplySell','slowGrindPump','washPair','holdingsBalance','burstSpikeConcentration','strongBackerPressure','bundledDominance','abnormalBehavior'];
const lvCross = new Map(); // key -> {level -> {pass, cheatRej, unhealthyRej}}
for (const s of cheatSeen) {
  const cc = s.metadata.cheatCheck; const bk = cc.buckets || {}; const lvs = cc.levels || {};
  const outcome = s.executed ? 'pass' : (s.metadata.execution_reason === 'cheat_gate_cheat' ? 'cheatRej'
    : s.metadata.execution_reason === 'cheat_gate_unhealthy' ? 'unhealthyRej' : 'bpStage');
  for (const k of LV_KEYS) {
    let v = bk[k];
    if (v && typeof v === 'object') v = v.bucket ?? null;
    if (v == null) { const lv = lvs[k]; v = Number.isFinite(lv) ? `score${lv}` : null; }
    if (!v || v === 'none' || v === null) continue;
    if (!lvCross.has(k)) lvCross.set(k, new Map());
    const m = lvCross.get(k);
    if (!m.has(v)) m.set(v, { pass: 0, cheatRej: 0, unhealthyRej: 0, bpStage: 0 });
    m.get(v)[outcome]++;
  }
}
console.log('16 题非 none 档位 × cheat 门结局（pass=放行进BP / cheatRej=cheat拉黑 / unhealthyRej / bpStage=BP 段拒或其它）:');
for (const [k, m] of lvCross) {
  const parts = [...m.entries()].map(([lv, c]) => `${lv}[P${c.pass}/C${c.cheatRej}/U${c.unhealthyRej}/B${c.bpStage}]`);
  console.log(`  ${k}: ${parts.join(' ')}`);
}

// ── D. BP 门结论分布 ──
const bpSeen = buySigs.filter(s => s.metadata?.buyPoint);
const bpBucketDist = new Map(); const bpRuleDist = new Map(); const dimDist = new Map();
for (const s of bpSeen) {
  const bp = s.metadata.buyPoint;
  const a = bp.assessment;
  const bk = a?.bucket ?? `status:${bp.status}`;
  bpBucketDist.set(bk, (bpBucketDist.get(bk) || 0) + 1);
  if (a?.rule) bpRuleDist.set(a.rule, (bpRuleDist.get(a.rule) || 0) + 1);
  for (const [dk, dv] of Object.entries(bp.dimensions || {})) {
    if (!dimDist.has(dk)) dimDist.set(dk, new Map());
    const b = dv?.bucket ?? 'null';
    dimDist.get(dk).set(b, (dimDist.get(dk).get(b) || 0) + 1);
  }
}
console.log(`\n═══ D. BP 门结论（到达 BP 门的信号 ${bpSeen.length} 条）═══`);
console.log('assessment.bucket 分布:', JSON.stringify([...bpBucketDist.entries()].sort((a, b) => b[1] - a[1])));
console.log('拒因 rule 频次:', JSON.stringify([...bpRuleDist.entries()].sort((a, b) => b[1] - a[1])));
for (const [dk, m] of dimDist) console.log(`  维度题 ${dk}:`, JSON.stringify([...m.entries()].sort((a, b) => b[1] - a[1])));

// ── E. 成交票 cross：门结论 × 票级盈亏 ──
// 票级取「首条成交买信号」的门结论
const firstExecByTok = new Map();
for (const s of buySigs) {
  if (!s.executed) continue;
  if (!firstExecByTok.has(s.token_address)) firstExecByTok.set(s.token_address, s);
}
function pnlRow(sym, addr, tag, extra = {}) {
  const o = perTok.get(addr);
  return { symbol: sym, addr, tag, net: o ? Number(o.net.toFixed(4)) : null, ...extra };
}
function crossTable(keyFn, title) {
  const m = new Map();
  for (const [addr, s] of firstExecByTok) {
    const o = perTok.get(addr); if (!o) continue;
    const k = keyFn(s);
    if (!m.has(k)) m.set(k, { n: 0, net: 0, win: 0, toks: [] });
    const e = m.get(k);
    e.n++; e.net += o.net; if (o.net > 1e-9) e.win++;
    if (e.toks.length < 8) e.toks.push(`${symbol.get(addr) || addr.slice(0, 6)}:${o.net.toFixed(3)}`);
  }
  console.log(`\n── ${title} ──`);
  for (const [k, e] of [...m.entries()].sort((a, b) => b[1].net - a[1].net)) {
    console.log(`  ${k}: 票数=${e.n} 净额=${e.net.toFixed(4)} 胜率=${(e.win / e.n * 100).toFixed(0)}% | ${e.toks.join(' ')}`);
  }
  return m;
}
console.log(`\n═══ E. 成交票门结论 × 票级盈亏（${firstExecByTok.size} 票）═══`);
crossTable(s => {
  const cc = s.metadata?.cheatCheck; if (!cc) return '无cheat段';
  const ex = cc.exempt;
  return ex ? `豁免(${ex.code})` : (cc.grade || '?');
}, 'cheat 门 grade（成交票）');
crossTable(s => { const b = s.metadata?.cheatCheck?.buckets?.activityLevel; const lv = s.metadata?.cheatCheck?.levels?.activityLevel; return (b && (typeof b === 'object' ? b.bucket : b)) ?? (Number.isFinite(lv) ? `score${lv}` : 'null'); }, 'cheat 活跃度档位（成交票）');
crossTable(s => s.metadata?.buyPoint?.dimensions?.market_pattern?.bucket ?? 'null', 'BP 盘面分类 market_pattern（成交票）');
crossTable(s => s.metadata?.buyPoint?.dimensions?.entry_shape?.bucket ?? 'null', 'BP 点位性质 entry_shape（成交票）');
crossTable(s => s.metadata?.buyPoint?.dimensions?.activity_level?.bucket ?? 'null', 'BP 活跃度 activity_level（成交票）');
crossTable(s => s.metadata?.buyPoint?.dimensions?.holder_concentration?.bucket ?? 'null', 'BP 筹码 holder_concentration（成交票）');

// 触发腿 × 盈亏
crossTable(s => `${s.metadata?.strategyName || '?'}(第${s.metadata?.signalGate?.triggerNo ?? '?'}次)`.replace(/·.*$/, ''), '触发腿（成交票首买）');

// ── F. 因子过滤分析 ──
console.log(`\n═══ F. 因子过滤分析（fire 时刻因子快照，全 BUY 信号）═══`);
const F = ['buyVolumeBnb', 'holdersExDust', 'currentVsLaunchPct', 'actTotalBnb', 'tokenAgeSec', 'tradesNetBuyRatioLongWin', 'tradesNetBuyRatioShortWin', 'mcapFromPeakPct'];
function stats(arr) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 'n=0';
  const q = p => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return `n=${a.length} 均值=${(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2)} 中位=${q(0.5).toFixed(2)} P25=${q(0.25).toFixed(2)} P75=${q(0.75).toFixed(2)} 极值[${a[0].toFixed(2)}, ${a[a.length - 1].toFixed(2)}]`;
}
const groups = {
  '成交': buySigs.filter(s => s.executed),
  '拒·BP门(poor)': buySigs.filter(s => !s.executed && s.metadata?.execution_reason === 'bp_gate_assessment'),
  '拒·BP门(tick不足)': buySigs.filter(s => !s.executed && s.metadata?.execution_reason === 'bp_gate_insufficient_ticks'),
  '拒·cheat门': buySigs.filter(s => !s.executed && (s.metadata?.execution_reason === 'cheat_gate_cheat' || s.metadata?.execution_reason === 'cheat_gate_unhealthy')),
};
for (const fk of F) {
  console.log(`\n因子 ${fk}:`);
  for (const [g, arr] of Object.entries(groups)) {
    if (!arr.length) continue;
    console.log(`  [${g}] ${stats(arr.map(s => Number(s.metadata?.trendFactors?.[fk])))}`);
  }
}
// 因子分带 × 票级盈亏（成交票，首买信号因子）
function bandTable(fk, bands, labelFn) {
  const m = new Map();
  for (const [addr, s] of firstExecByTok) {
    const o = perTok.get(addr); if (!o) continue;
    const v = Number(s.metadata?.trendFactors?.[fk]);
    const b = !Number.isFinite(v) ? 'null' : labelFn(v);
    if (!m.has(b)) m.set(b, { n: 0, net: 0, win: 0 });
    const e = m.get(b); e.n++; e.net += o.net; if (o.net > 1e-9) e.win++;
  }
  const order = ['null', ...bands.map(b => b.label)];
  console.log(`\n${fk} 分带 × 票级盈亏:`);
  for (const k of order) {
    const e = m.get(k); if (!e) continue;
    console.log(`  ${k}: 票数=${e.n} 净额=${e.net.toFixed(4)} 胜率=${(e.win / e.n * 100).toFixed(0)}%`);
  }
}
bandTable('currentVsLaunchPct',
  [{ label: '≤0(破发)', max: 0 }, { label: '0~10(almost)', max: 10 }, { label: '10~20(near)', max: 20 }, { label: '20~28.5', max: 28.5 }],
  v => { for (const b of [{ label: '≤0(破发)', max: 0 }, { label: '0~10(almost)', max: 10 }, { label: '10~20(near)', max: 20 }, { label: '20~28.5', max: 28.5 }]) if (v <= b.max) return b.label; return '>28.5'; });
bandTable('tokenAgeSec',
  [{ label: '15~60s', max: 60 }, { label: '60~300s', max: 300 }, { label: '300~600s', max: 600 }],
  v => { for (const b of [{ label: '15~60s', max: 60 }, { label: '60~300s', max: 300 }, { label: '300~600s', max: 600 }]) if (v <= b.max) return b.label; return '>600s'; });
bandTable('buyVolumeBnb',
  [{ label: '1~2.5', max: 2.5 }, { label: '2.5~5', max: 5 }, { label: '5~10', max: 10 }],
  v => { for (const b of [{ label: '1~2.5', max: 2.5 }, { label: '2.5~5', max: 5 }, { label: '5~10', max: 10 }]) if (v <= b.max) return b.label; return '>10'; });
bandTable('actTotalBnb',
  [{ label: '0.1~0.5', max: 0.5 }, { label: '0.5~2', max: 2 }],
  v => { for (const b of [{ label: '0.1~0.5', max: 0.5 }, { label: '0.5~2', max: 2 }]) if (v <= b.max) return b.label; return '>2'; });

// ── G. 触发腿明细（信号级）──
console.log(`\n═══ G. 触发腿分布（信号级）═══`);
const legDist = new Map();
for (const s of buySigs) {
  const n = s.metadata?.strategyName || '?';
  const tn = s.metadata?.signalGate?.triggerNo ?? '?';
  const k = `${n}#${tn}`;
  if (!legDist.has(k)) legDist.set(k, { n: 0, exec: 0, cheatRej: 0, bpRej: 0 });
  const e = legDist.get(k); e.n++;
  const er = s.metadata?.execution_reason || '';
  if (s.executed) e.exec++;
  else if (er.startsWith('cheat_gate')) e.cheatRej++;
  else e.bpRej++;
}
for (const [k, e] of [...legDist.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k}: 触发=${e.n} 成交=${e.exec} cheat拒=${e.cheatRej} BP拒/其它=${e.bpRej}`);
}

// ── H. 卖臂分布（成交票结局归因）──
console.log(`\n═══ H. 卖臂分布（trades 级）═══`);
const sellDist = new Map();
for (const t of trades.filter(x => x.trade_direction === 'sell')) {
  const arm = (t.signal_id && sigById.get(t.signal_id)?.metadata?.strategyName) || t.metadata?.strategyName || '?';
  sellDist.set(arm, (sellDist.get(arm) || 0) + 1);
}
for (const [k, n] of [...sellDist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

// ── I. 明细 dump ──
const detail = [];
for (const [addr, s] of firstExecByTok) {
  const o = perTok.get(addr);
  const cc = s.metadata?.cheatCheck; const bp = s.metadata?.buyPoint; const d = bp?.dimensions || {};
  detail.push({
    symbol: symbol.get(addr) || addr.slice(0, 8), addr,
    leg: s.metadata?.strategyName, triggerNo: s.metadata?.signalGate?.triggerNo,
    net: o ? Number(o.net.toFixed(4)) : null, nBuy: o?.nBuy, nSell: o?.nSell, sellArms: o ? [...new Set(o.sellArms)] : [],
    cheat: cc ? { grade: cc.grade, exempt: cc.exempt?.code ?? null, exemptDenied: cc.exemptDenied ?? null, act: (cc.buckets?.activityLevel && (typeof cc.buckets.activityLevel === 'object' ? cc.buckets.activityLevel.bucket : cc.buckets.activityLevel)) ?? (Number.isFinite(cc.levels?.activityLevel) ? `score${cc.levels.activityLevel}` : null), reasons: cc.reasons } : null,
    bp: { bucket: bp?.assessment?.bucket ?? null, rule: bp?.assessment?.rule ?? null, mp: d.market_pattern?.bucket ?? null, entry: d.entry_shape?.bucket ?? null, act: d.activity_level?.bucket ?? null, holder: d.holder_concentration?.bucket ?? null },
    f: Object.fromEntries(F.map(k => [k, s.metadata?.trendFactors?.[k] ?? null])),
    at: s.created_at,
  });
}
detail.sort((a, b) => (b.net ?? -9) - (a.net ?? -9));
fs.writeFileSync('/tmp/btv111-gate-analysis.json', JSON.stringify({
  detail,
  rejected: buySigs.filter(s => !s.executed && s.metadata?.buyPoint).map(s => ({
    symbol: symbol.get(s.token_address) || s.token_address.slice(0, 8), addr: s.token_address,
    leg: s.metadata?.strategyName, at: s.created_at,
    cheat: s.metadata?.cheatCheck ? { grade: s.metadata.cheatCheck.grade, exempt: s.metadata.cheatCheck.exempt?.code ?? null } : null,
    bp: { bucket: s.metadata.buyPoint?.assessment?.bucket ?? null, rule: s.metadata.buyPoint?.assessment?.rule ?? null },
  })),
}, null, 1));
console.log(`\n明细已写 /tmp/btv111-gate-analysis.json（成交票 ${detail.length} 行）`);
console.log(`\n=== 盈利 Top8 ===`);
for (const r of detail.slice(0, 8)) console.log(`  +${r.net} ${r.symbol} leg=${r.leg} cheat=${r.cheat?.grade}${r.cheat?.exempt ? '(豁免)' : ''}/${r.cheat?.act} mp=${r.bp.mp} entry=${r.bp.entry} curVs=${r.f.currentVsLaunchPct}`);
console.log(`=== 亏损 Top8 ===`);
for (const r of detail.slice(-8).reverse()) console.log(`  ${r.net} ${r.symbol} leg=${r.leg} cheat=${r.cheat?.grade}${r.cheat?.exempt ? '(豁免)' : ''}/${r.cheat?.act} mp=${r.bp.mp} entry=${r.bp.entry} curVs=${r.f.currentVsLaunchPct}`);
process.exit(0);
