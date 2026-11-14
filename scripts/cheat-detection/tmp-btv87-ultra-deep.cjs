// 一次性深度分析（182 跑）：bt-v87 ultra 拒票 92 枚——
// A. 前向路径修正：中途最大回撤+止损敏感性模拟（正票的肉能不能吃到）+毕业票右尾（wss_events）
// B. ultra 域内部切片：首拒锚自带 anchors（买卖侧/openSeg/新钱包/大户卖/散户入口/burst/cheat levels）
//    逐锚分桶统计与 +5min 末正负的关系，找区分度最强的维度
// C. heat×act 四象限 + 信号条数（跨臂接力）
const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../../src/services/dbManager.js');
const db = dbManager.getClient();
const EXP = 'c84fc413-4928-45ca-9a55-b0791921820e';

async function sigsFor(exp) {
  const out = []; let cur = '';
  for (let p = 0; p < 40; p++) {
    let b = db.from('strategy_signals').select('created_at,token_address,metadata')
      .eq('experiment_id', exp).eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(1000);
    if (cur) b = b.gt('created_at', cur);
    const { data, error } = await b;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data); cur = data[data.length - 1].created_at; if (data.length < 1000) break;
  }
  return out;
}

async function pullTicks(token, startIso, endIso) {
  const rows = []; let anchorId = 0;
  for (let page = 0; page < 10; page++) {
    const { data, error } = await db.from('wss_price_ticks')
      .select('id,block_time,price_bnb,price_outlier,trade_type,bnb_amount')
      .eq('token_address', token).gte('block_time', startIso).lte('block_time', endIso)
      .gt('id', anchorId).order('id', { ascending: true }).limit(2000);
    if (error) throw new Error(`ticks 查询失败(${token}): ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 2000) return rows;
    anchorId = data[data.length - 1].id;
  }
  return rows;
}

// 前向路径（全 BNB 域）：entry=信号前最近可靠价；+15min 全程序列的 min/max/last + 止损敏感性。
// 止损口径：逐笔扫描，首个 ≤ entry×(1-SL) 的可靠价 → 出局收益=该价相对 entry（线值近似）；未触 → 持有到期末。
function fwdPath(ticks, atIso) {
  const tA = Date.parse(atIso);
  const rel = []; let entry = null;
  for (const r of ticks) {
    const bt = Date.parse(r.block_time);
    if (!Number.isFinite(bt)) continue;
    if (r.price_outlier || !(Number(r.price_bnb) > 0)) continue;
    const p = Number(r.price_bnb);
    if (bt <= tA) { entry = p; continue; }
    rel.push({ dt: bt - tA, p, side: (r.trade_type || '').toLowerCase(), bnb: Number(r.bnb_amount) || 0 });
  }
  if (!entry) return null;
  rel.sort((a, b) => a.dt - b.dt);
  const w15 = rel.filter((x) => x.dt <= 900 * 1000);
  const w5 = rel.filter((x) => x.dt <= 300 * 1000);
  const out = { entry, n: w15.length };
  out.max15 = w15.length ? (Math.max(...w15.map((x) => x.p)) / entry - 1) * 100 : null;
  out.last15 = w15.length ? (w15[w15.length - 1].p / entry - 1) * 100 : null;
  out.min15 = w15.length ? (Math.min(...w15.map((x) => x.p)) / entry - 1) * 100 : null;
  out.last5 = w5.length ? (w5[w5.length - 1].p / entry - 1) * 100 : null;
  // 止损敏感性（+15min 全程）
  out.sl = {};
  for (const SL of [15, 20, 30]) {
    const hit = w15.find((x) => x.p <= entry * (1 - SL / 100));
    out.sl[SL] = hit ? (hit.p / entry - 1) * 100 : (out.last15 ?? 0);
  }
  // 信号后 60s 买/卖侧分解（ticks 实测口径）
  const w1 = rel.filter((x) => x.dt <= 60 * 1000);
  out.post1Buy = w1.filter((x) => x.side === 'buy').reduce((a, x) => a + x.bnb, 0);
  out.post1Sell = w1.filter((x) => x.side === 'sell').reduce((a, x) => a + x.bnb, 0);
  return out;
}

function bucketStats(rows, name, keyFn) {
  const g = new Map();
  for (const r of rows) {
    const k = keyFn(r); if (k == null) continue;
    if (!g.has(k)) g.set(k, { n: 0, w: 0, l: 0, s5: 0, s15: 0, sl20: 0 });
    const e = g.get(k); const ok = r.fwd && r.fwd.last5 != null;
    e.n++;
    if (ok) { r.fwd.last5 >= 0 ? e.w++ : e.l++; e.s5 += r.fwd.last5; e.s15 += (r.fwd.last15 ?? r.fwd.last5); e.sl20 += (r.fwd.sl[20] ?? r.fwd.last5); }
  }
  console.log(`\n— ${name}`);
  for (const [k, e] of [...g.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
    console.log(`  ${String(k).padEnd(22)} n=${String(e.n).padStart(3)} 正${String(e.w).padStart(2)}/负${String(e.l).padStart(2)} Σ5=${(e.s5 / 500).toFixed(3)} Σ15=${(e.s15 / 500).toFixed(3)} ΣSL20=${(e.sl20 / 500).toFixed(3)} BNB`);
}

async function main() {
  const all = await sigsFor(EXP);
  const byToken = new Map();
  for (const s of all) {
    const m = s.metadata || {}; const bp = m.buyPoint || {};
    if (!bp || !bp.dimensions) continue;
    const d = bp.dimensions; const a = bp.assessment || {};
    if (m.execution_status === 'executed') continue;
    const heat = (d.market_heat || {}).bucket; const act = (d.activity_level || {}).bucket;
    if (!((a.rule === 'pattern_gate' || a.rule === 'pump_exempt_gate' || a.rule === 'activity_gate')
      && (heat === 'ultra' || act === 'ultra'))) continue;
    if (!byToken.has(s.token_address)) byToken.set(s.token_address, []);
    byToken.get(s.token_address).push({ at: s.created_at, m, d, a, an: bp.anchors || {} });
  }
  const tokens = [...byToken.keys()];
  console.log(`ultra 拒票 ${tokens.length} token`);

  // 毕业票右尾
  const grad = new Set();
  for (let i = 0; i < tokens.length; i += 50) {
    const { data } = await db.from('wss_events').select('token_address')
      .eq('kind', 'graduation').in('token_address', tokens.slice(i, i + 50));
    for (const r of data || []) grad.add(r.token_address);
  }
  console.log(`毕业票（wss_events graduation）：${grad.size}/${tokens.length} → ${[...grad].map((x) => x.slice(0, 8)).join(' ')}`);

  // 逐票首拒锚 + 前向路径
  const rows = [];
  for (const [addr, list] of byToken) {
    const f = list[0]; const an = f.an; const cc = f.m.cheatCheck || {}; const lv = cc.levels || {};
    const at = new Date(Date.parse(f.at) - 120000).toISOString();
    const end = new Date(Date.parse(f.at) + 960000).toISOString();
    let fwd = null;
    try { fwd = fwdPath(await pullTicks(addr, at, end), f.at); } catch (e) { console.error(`  ticks 失败 ${addr}: ${e.message}`); }
    rows.push({
      addr, at: f.at, n: list.length, legs: [...new Set(list.map((x) => ((x.m.signalGate || {}).legId || '-').replace('buy_', '')))],
      rule: f.a.rule, pat: (f.d.market_pattern || {}).bucket, heat: (f.d.market_heat || {}).bucket, act: (f.d.activity_level || {}).bucket,
      chip: (f.d.holder_concentration || {}).bucket || '?', curVs: an.currentVsLaunchPct ?? null, grad: grad.has(addr),
      ccExempt: ((f.m.cheatCheck || {}).exempt || {}).code || '无豁免',
      // 锚摘录
      a30buyShare: an.win30BuySharePct ?? null, a30sellBnb: an.win30SellBnb ?? null, a60netBnb: an.win60NetBnb ?? null,
      a30newBuyers: an.win30NewBuyers ?? null, a30buyers: an.win30Buyers ?? null,
      openShare: an.openSegBuySharePct ?? null, bigSell60: an.bigHolderSellBnb60 ?? null, exitSellers: an.exitSellerCount60 ?? null,
      router60: an.routerBuyPct60 ?? null, top1Buy60: an.top1BuyPct60 ?? null, tpm: an.actThroughputBnbPerMin ?? null,
      burst5Bnb: an.burst5BuyBnb ?? null, burst5W: an.burst5Wallets ?? null, sgp: lv.slowGrindPump ?? null,
      holdersD60: an.holdersDelta60 ?? null, athVs: an.athVsLaunchPct ?? null, fwd,
    });
  }
  rows.sort((x, y) => ((y.fwd?.last5 ?? -1e9) - (x.fwd?.last5 ?? -1e9)));

  // A. 汇总：路径修正
  const have = rows.filter((r) => r.fwd && r.fwd.last5 != null);
  const sum = (k) => have.reduce((a, r) => a + (k === 'sl20' ? r.fwd.sl[20] : r.fwd[k] ?? 0), 0) / 500;
  console.log(`\n===== A. 前向路径修正（${have.length} 票有价）=====`);
  console.log(`持有到期末：Σ(+5min)=${sum('last5').toFixed(3)} Σ(+15min)=${sum('last15').toFixed(3)} BNB(0.2/票)` +
    ` | 止损敏感性 Σ(SL15)=${(have.reduce((a, r) => a + r.fwd.sl[15], 0) / 500).toFixed(3)}` +
    ` Σ(SL20)=${sum('sl20').toFixed(3)} Σ(SL30)=${(have.reduce((a, r) => a + r.fwd.sl[30], 0) / 500).toFixed(3)}`);
  const vShape = have.filter((r) => r.fwd.min15 <= -15 && r.fwd.last15 > 0);
  console.log(`先洗后拉（min15≤-15 ∧ 末15>0）：${vShape.length} 票——止损会被洗掉的赢家`);
  const noRetreat = have.filter((r) => r.fwd.min15 > -10 && r.fwd.last5 > 30);
  console.log(`不回头型（min15>-10 ∧ +5min末>30%）：${noRetreat.length} 票：${noRetreat.map((r) => r.addr.slice(0, 8) + '(' + (r.fwd.last5 > 0 ? '+' : '') + r.fwd.last5.toFixed(0) + '%,' + (r.grad ? '毕业' : '未毕') + ')').join(' ')}`);

  // B. 逐锚分桶
  console.log(`\n===== B. ultra 域内部切片（首拒锚分桶 × +5min 末正负/净额）=====`);
  bucketStats(rows, 'heat×act 四象限', (r) => `${r.heat}/${r.act}`);
  bucketStats(rows, '信号条数（跨臂接力）', (r) => r.n >= 8 ? '≥8条' : r.n >= 4 ? '4-7条' : r.n >= 2 ? '2-3条' : '1条');
  bucketStats(rows, 'win30 买侧占比（抢筹vs出货）', (r) => r.a30buyShare == null ? null : r.a30buyShare >= 90 ? '≥90%' : r.a30buyShare >= 75 ? '75-90%' : r.a30buyShare >= 50 ? '50-75%' : '<50%（卖侧主导）');
  bucketStats(rows, 'win30 卖压绝对值', (r) => r.a30sellBnb == null ? null : r.a30sellBnb >= 1 ? '≥1 BNB' : r.a30sellBnb >= 0.3 ? '0.3-1' : r.a30sellBnb >= 0.05 ? '0.05-0.3' : '<0.05');
  bucketStats(rows, 'openSegBuySharePct（BP47 线）', (r) => r.openShare == null ? null : r.openShare >= 80 ? '≥80（开盘一波流）' : r.openShare >= 50 ? '50-80' : '<50（持续热度）');
  bucketStats(rows, 'win30 新买家数', (r) => r.a30newBuyers == null ? null : r.a30newBuyers >= 8 ? '≥8' : r.a30newBuyers >= 4 ? '4-7' : '0-3');
  bucketStats(rows, '大户卖出 bigHolderSellBnb60', (r) => r.bigSell60 == null ? null : r.bigSell60 > 0 ? '>0（在卖）' : '=0');
  bucketStats(rows, 'routerBuyPct60（散户入口）', (r) => r.router60 == null ? null : r.router60 >= 30 ? '≥30%' : r.router60 >= 10 ? '10-30%' : '<10%（无散户通道）');
  bucketStats(rows, 'top1BuyPct60（单钱包集中）', (r) => r.top1Buy60 == null ? null : r.top1Buy60 >= 50 ? '≥50%' : r.top1Buy60 >= 20 ? '20-50%' : '<20%');
  bucketStats(rows, 'slowGrindPump 档（cheat）', (r) => r.sgp == null ? null : r.sgp >= 3 ? '3 strong' : r.sgp === 2 ? '2 moderate' : '0-1');
  bucketStats(rows, 'burst5BuyBnb（波有力）', (r) => r.burst5Bnb == null ? null : r.burst5Bnb >= 0.7 ? '≥0.7' : r.burst5Bnb >= 0.3 ? '0.3-0.7' : '<0.3');
  bucketStats(rows, 'cheat 豁免类型', (r) => r.ccExempt);
  bucketStats(rows, '毕业与否', (r) => r.grad ? '毕业' : '未毕业');
  bucketStats(rows, 'curVs 价格段', (r) => r.curVs == null ? null : r.curVs > 80 ? '>80' : r.curVs > 40 ? '40-80' : r.curVs > 10 ? '10-40' : '≤10');
  console.log('\n— 组合切片');
  bucketStats(rows, 'router≥30 ∧ sgp<3（散户入口∧非机器缓推）', (r) => r.router60 != null && r.router60 >= 30 && r.sgp != null && r.sgp < 3 ? '命中' : (r.router60 != null && r.sgp != null ? '不命中' : null));
  bucketStats(rows, 'router≥30 ∧ sgp<3 ∧ 信号≥4条', (r) => r.router60 != null && r.router60 >= 30 && r.sgp != null && r.sgp < 3 ? (r.n >= 4 ? '命中' : '条数不足') : null);
  bucketStats(rows, 'top1Buy≥50（庄家单打）', (r) => r.top1Buy60 == null ? null : r.top1Buy60 >= 50 ? '命中' : '不命中');
  bucketStats(rows, 'pattern 单独（⑥/⑦）', (r) => (r.pat === 'sustained_climb' || r.pat === 'restart') ? r.pat : null);

  // D. 豁免臂口径模拟：router 豁免 ultra 的各候选形状（前向=首拒锚若买入）
  console.log(`\n===== D. router 豁免 ultra 口径模拟 =====`);
  const ruleCnt = new Map();
  for (const r of rows) ruleCnt.set(r.rule, (ruleCnt.get(r.rule) || 0) + 1);
  console.log(`拒因分布：${[...ruleCnt.entries()].map(([k, v]) => k + '=' + v).join(' ')}`);
  const variants = [
    ['A0 对照：activity_gate 全集', (r) => r.rule === 'activity_gate'],
    ['A1 对照：pattern_gate∧④ 全集', (r) => r.rule === 'pattern_gate' && r.pat === 'early_sniper_decay'],
    ['B1 ④∧router≥30', (r) => r.rule === 'pattern_gate' && r.pat === 'early_sniper_decay' && r.router60 != null && r.router60 >= 30],
    ['B2 ④∧router≥50', (r) => r.rule === 'pattern_gate' && r.pat === 'early_sniper_decay' && r.router60 != null && r.router60 >= 50],
    ['B3 ④∧router≥30∧sgp<3', (r) => r.rule === 'pattern_gate' && r.pat === 'early_sniper_decay' && r.router60 != null && r.router60 >= 30 && r.sgp != null && r.sgp < 3],
    ['B4 ④∧router≥30∧≥4条', (r) => r.rule === 'pattern_gate' && r.pat === 'early_sniper_decay' && r.router60 != null && r.router60 >= 30 && r.n >= 4],
    ['B5 ④∧router≥30∧sgp<3∧≥4条', (r) => r.rule === 'pattern_gate' && r.pat === 'early_sniper_decay' && r.router60 != null && r.router60 >= 30 && r.sgp != null && r.sgp < 3 && r.n >= 4],
    ['C1 全 rule∧router≥30（含pumpEx，动价格钳制的上界参考）', (r) => r.router60 != null && r.router60 >= 30],
  ];
  for (const [name, fn] of variants) {
    const sel = rows.filter(fn); const hv = sel.filter((r) => r.fwd && r.fwd.last5 != null);
    const s5 = hv.reduce((a, r) => a + r.fwd.last5, 0) / 500;
    const s15 = hv.reduce((a, r) => a + (r.fwd.last15 ?? r.fwd.last5), 0) / 500;
    const sl = hv.reduce((a, r) => a + r.fwd.sl[20], 0) / 500;
    const w = hv.filter((r) => r.fwd.last5 >= 0).length;
    console.log(`· ${name.padEnd(30)} n=${String(sel.length).padStart(3)} 正${w}/${hv.length - w}` +
      ` Σ5=${s5.toFixed(3)} Σ15=${s15.toFixed(3)} ΣSL20=${sl.toFixed(3)} BNB`);
    if (sel.length && sel.length <= 12) console.log(`   ${sel.map((r) => r.addr.slice(0, 8) + (r.fwd && r.fwd.last5 != null ? (r.fwd.last5 >= 0 ? '+' : '') + r.fwd.last5.toFixed(0) + '%' : '?')).join(' ')}`);
  }

  // E. B1（④∧router≥30）21 票明细——找首拒时点可用的盘面护栏（条数=前视不可用；sgp=cheat 侧不透传）
  console.log(`\n===== E. B1 明细（④∧router≥30，首拒锚可用盘面锚）=====`);
  const b1 = rows.filter((r) => r.rule === 'pattern_gate' && r.pat === 'early_sniper_decay' && r.router60 != null && r.router60 >= 30);
  for (const r of b1.sort((x, y) => (y.fwd?.last5 ?? -1e9) - (x.fwd?.last5 ?? -1e9))) {
    const f = r.fwd;
    console.log(`· ${r.addr} ${r.at.slice(5, 19)} ${r.n}条 curVs=${r.curVs ?? '?'}${r.grad ? ' ★毕业' : ''}` +
      ` | ${f ? `末5${f.last5.toFixed(0)}% 末15${f.last15?.toFixed(0) ?? '?'}% min${f.min15.toFixed(0)}%` : '无价'}` +
      ` | 买占${r.a30buyShare ?? '?'} 卖压${r.a30sellBnb ?? '?'} 买者${r.a30buyers ?? '?'} 新买${r.a30newBuyers ?? '?'}` +
      ` 吞吐${r.tpm == null ? '?' : r.tpm.toFixed(1)} 开段${r.openShare ?? '?'} top1${r.top1Buy60 ?? '?'} burst${r.burst5Bnb ?? '?'}`);
  }
  // 盘面护栏候选分桶（B1 内）
  console.log(`\n— B1 内护栏候选`);
  bucketStats(b1, '吞吐 actThroughputBnbPerMin', (r) => r.tpm == null ? null : r.tpm >= 10 ? '≥10' : r.tpm >= 4 ? '4-10' : '<4');
  bucketStats(b1, 'win30 买者数', (r) => r.a30buyers == null ? null : r.a30buyers >= 20 ? '≥20' : r.a30buyers >= 10 ? '10-20' : '<10');
  bucketStats(b1, 'win30 新买家占比（新买/买者）', (r) => (r.a30newBuyers != null && r.a30buyers) ? (r.a30newBuyers / r.a30buyers >= 0.8 ? '≥80%' : r.a30newBuyers / r.a30buyers >= 0.5 ? '50-80%' : '<50%') : null);
  bucketStats(b1, '信号条数（前视，仅参考）', (r) => r.n >= 4 ? '≥4条' : r.n >= 2 ? '2-3条' : '1条');
  bucketStats(b1, 'router60 段', (r) => r.router60 >= 60 ? '≥60%' : '30-60%');

  // C. 逐票明细（正 8 + 全部按序）
  console.log(`\n===== C. 逐票明细（按 +5min 末降序）=====`);
  for (const r of rows) {
    const f = r.fwd;
    console.log(`· ${r.addr} ${r.at.slice(5, 19)} ${r.n}条[${r.legs.slice(0, 4).join(',')}] ${r.rule.replace('_gate', '').replace('pump_exempt', 'pumpEx')}` +
      ` ${r.pat}/${r.heat}/${r.act} curVs=${r.curVs ?? '?'}${r.grad ? ' ★毕业' : ''}` +
      ` | 路径 ${f ? `min${f.min15.toFixed(0)} max${f.max15.toFixed(0)} 末5${f.last5.toFixed(0)}% 末15${f.last15?.toFixed(0) ?? '?'}% SL20=${f.sl[20].toFixed(0)}%` : '无价'}` +
      ` | 锚 买占${r.a30buyShare ?? '?'} 新买${r.a30newBuyers ?? '?'} 开段${r.openShare ?? '?'} 大卖${r.bigSell60 ?? '?'} 路由${r.router60 ?? '?'} top1${r.top1Buy60 ?? '?'} sgp${r.sgp} 后60s买${f ? f.post1Buy.toFixed(2) : '?'}/卖${f ? f.post1Sell.toFixed(2) : '?'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
