// 一次性政策模拟（182 跑）：假设「ultra 活跃度只允许 almost_launch 价格买入」——
// bt-v87 全部 ultra 相关拒票（pattern_gate/pump_exempt_gate/activity_gate ∧ heat/act=ultra）中，
// per token 首条 curVs ≤ 阈值（10=BP50 almost_launch 口径；20=BP50 前旧口径对照）的拒信号
// =政策下放行买入点，拉 ticks 算 +5/+15min 前向；②③等 pattern 分组拆解；0.2 BNB/票净额参考。
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

// per token ticks：block_time 区间 + id 翻页（防超时形状）
async function pullTicks(token, startIso, endIso) {
  const rows = []; let anchorId = 0;
  for (let page = 0; page < 10; page++) {
    const { data, error } = await db.from('wss_price_ticks')
      .select('id,block_time,price_bnb,price_outlier')
      .eq('token_address', token).gte('block_time', startIso).lte('block_time', endIso)
      .gt('id', anchorId).order('id', { ascending: true }).limit(2000);
    if (error) throw new Error(`ticks 查询失败(${token}): ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 2000) return rows;
    anchorId = data[data.length - 1].id;
  }
  return rows;
}

// 前向（全 BNB 域）：entry=信号时刻前最近一笔可靠价，+5/+15min 窗内可靠价 max/last 相对 entry。
function fwdOf(ticks, atIso) {
  const tA = Date.parse(atIso);
  const rel = []; let entry = null;
  for (const r of ticks) {
    const bt = Date.parse(r.block_time);
    if (!Number.isFinite(bt)) continue;
    if (r.price_outlier || !(Number(r.price_bnb) > 0)) continue;
    const p = Number(r.price_bnb);
    if (bt <= tA) { entry = p; continue; }
    rel.push({ dt: bt - tA, p });
  }
  if (!entry) return null;
  rel.sort((a, b) => a.dt - b.dt);
  const out = { entry };
  for (const H of [300, 900]) {
    const win = rel.filter((x) => x.dt <= H * 1000);
    if (win.length < 2) { out[H] = null; continue; }
    const max = Math.max(...win.map((x) => x.p)); const last = win[win.length - 1].p;
    out[H] = { maxPct: (max / entry - 1) * 100, lastPct: (last / entry - 1) * 100, ticks: win.length };
  }
  return out;
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
    const an = bp.anchors || {};
    if (!byToken.has(s.token_address)) byToken.set(s.token_address, []);
    byToken.get(s.token_address).push({
      at: s.created_at, leg: ((m.signalGate || {}).legId || '-').replace('buy_', ''),
      rule: a.rule, pat: (d.market_pattern || {}).bucket, heat, act,
      chip: (d.holder_concentration || {}).bucket || '?', curVs: an.currentVsLaunchPct ?? null,
      cc: m.cheatCheck ? (m.cheatCheck.grade || '?') + (m.cheatCheck.exempt ? '+' + m.cheatCheck.exempt.code : '') : '?',
    });
  }
  console.log(`ultra 相关拒票基线：${byToken.size} token（前跑结论：+5min 末 正 8/负 84）`);
  const byLeg = new Map();
  for (const list of byToken.values()) for (const e of list) byLeg.set(e.leg, (byLeg.get(e.leg) || 0) + 1);
  console.log(`拒信号腿分布：${[...byLeg.entries()].map(([k, v]) => k + '=' + v).join(' ')}`);

  for (const TH of [10, 20]) {
    const rows = [];
    for (const [addr, list] of byToken) {
      const f = list.find((e) => e.curVs != null && e.curVs <= TH);
      if (!f) continue;
      const at = new Date(Date.parse(f.at) - 120000).toISOString();
      const end = new Date(Date.parse(f.at) + 960000).toISOString();
      let fwd = null;
      try { fwd = fwdOf(await pullTicks(addr, at, end), f.at); } catch (e) { console.error(`  ticks 失败 ${addr}: ${e.message}`); }
      rows.push({ addr, f, fwd });
    }
    let w5 = 0, l5 = 0, n5 = 0, sum5 = 0, sum15 = 0, cnt15 = 0;
    const byPat = new Map(); const byLegHit = new Map();
    for (const r of rows) {
      const h5 = r.fwd && r.fwd[300]; const h15 = r.fwd && r.fwd[900];
      if (!h5) n5++; else { h5.lastPct >= 0 ? w5++ : l5++; sum5 += h5.lastPct; }
      if (h15) { sum15 += h15.lastPct; cnt15++; }
      const k = r.f.pat || 'null';
      if (!byPat.has(k)) byPat.set(k, { n: 0, w: 0, l: 0, sum5: 0 });
      const g = byPat.get(k); g.n++;
      if (h5) { h5.lastPct >= 0 ? g.w++ : g.l++; g.sum5 += h5.lastPct; }
      byLegHit.set(r.f.leg, (byLegHit.get(r.f.leg) || 0) + 1);
    }
    console.log(`\n===== 政策模拟 curVs ≤ +${TH}%：命中 ${rows.length}/${byToken.size} token =====`);
    console.log(`+5min 末价：正 ${w5} / 负 ${l5} / 无价 ${n5} | Σ(+5min 末,0.2 BNB/票)=${(sum5 / 100 * 0.2).toFixed(4)} BNB` +
      ` | Σ(+15min 末)=${(sum15 / 100 * 0.2).toFixed(4)} BNB（${cnt15} 票有价）`);
    console.log(`命中信号腿分布：${[...byLegHit.entries()].map(([k, v]) => k + '=' + v).join(' ')}`);
    console.log('pattern 分组（+5min 末口径）：');
    for (const [k, g] of [...byPat.entries()].sort((x, y) => y[1].n - x[1].n))
      console.log(`  ${k}: ${g.n} 票 正${g.w}/负${g.l} Σ=${(g.sum5 / 100 * 0.2).toFixed(4)} BNB`);
    for (const r of rows) {
      const f = r.f; const h5 = r.fwd && r.fwd[300]; const h15 = r.fwd && r.fwd[900];
      console.log(`· ${r.addr} ${f.at.slice(5, 19)} ${f.leg} ${f.rule} pattern=${f.pat} heat=${f.heat} act=${f.act} chip=${f.chip} curVs=${f.curVs} cheat=${f.cc}` +
        ` | +5min ${h5 ? '峰' + h5.maxPct.toFixed(0) + '/末' + h5.lastPct.toFixed(0) + '%' : '无价'}` +
        ` | +15min ${h15 ? '峰' + h15.maxPct.toFixed(0) + '/末' + h15.lastPct.toFixed(0) + '%' : '无价'}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
