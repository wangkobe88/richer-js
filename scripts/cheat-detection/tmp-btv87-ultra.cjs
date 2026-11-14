// 一次性查询（182 跑）：①苍蝇 0xb30f0b8a 在 bt-v87 的拒因确认 ②「活跃度过高（ultra）」拒票
// 清单+若买入的 +5/+15min 前向收益（ticks 锚窗口径）③已成交票 ultra 分布对照。
const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../../src/services/dbManager.js');
const db = dbManager.getClient();
const EXP = 'c84fc413-4928-45ca-9a55-b0791921820e';
const CANGYING = '0xb30f0b8a8270271989e37d6bc00e627a07637777';

async function sigsFor(exp, token) {
  const out = []; let cur = '';
  for (let p = 0; p < 40; p++) {
    let b = db.from('strategy_signals').select('created_at,token_address,metadata')
      .eq('experiment_id', exp).eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(1000);
    if (token) b = b.eq('token_address', token);
    if (cur) b = b.gt('created_at', cur);
    const { data, error } = await b;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data); cur = data[data.length - 1].created_at; if (data.length < 1000) break;
  }
  return out;
}

// per token ticks：block_time 区间 + id 翻页（build-set pullTicksWindow 同款防超时形状）
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
  return rows; // 满页截断声明
}

// 若买入前向（全 BNB 域）：entry=信号时刻前最近一笔可靠价（ticks price_bnb），
// +5/+15min 窗内可靠价 max/last 相对 entry。metadata.price 是 USD 计名（×bnbUsd）不可用。
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
  // ① 苍蝇拒因确认
  const cy = await sigsFor(EXP, CANGYING);
  console.log(`===== ① 苍蝇 ${CANGYING} | BUY 信号 ${cy.length} 条 =====`);
  for (const s of cy) {
    const m = s.metadata || {}; const bp = m.buyPoint || {}; const a = bp.assessment || {};
    const d = bp.dimensions || {}; const an = bp.anchors || {};
    const cc = m.cheatCheck || {};
    console.log(`· ${s.created_at.slice(5, 19)} leg=${((m.signalGate || {}).legId || '-').replace('buy_', '')} exec=${m.execution_status}` +
      `${m.execution_reason ? ' reason=' + m.execution_reason : ''}`);
    console.log(`  综=${a.bucket}(${a.rule})${a.exempt ? ' exempt=' + a.exempt.code : ''}` +
      ` pattern=${(d.market_pattern || {}).bucket} heat=${(d.market_heat || {}).bucket} act=${(d.activity_level || {}).bucket}` +
      ` chip=${(d.holder_concentration || {}).bucket || '?'} curVs=${an.currentVsLaunchPct ?? '?'} price=${m.price ?? '?'}` +
      ` cheat=${cc.grade}${cc.exempt ? '+' + cc.exempt.code : ''}`);
  }
  // 苍蝇首拒锚前向
  {
    const f = cy[0];
    if (f) {
      const at = new Date(Date.parse(f.created_at) - 120000).toISOString();
      const end = new Date(Date.parse(f.created_at) + 960000).toISOString();
      const ticks = await pullTicks(CANGYING, at, end);
      const fw = fwdOf(ticks, f.created_at);
      if (fw) console.log(`  → 若 ${f.created_at.slice(5, 19)} 买入（entry=${fw.entry.toExponential(2)} BNB）：+5min ${fw[300] ? '峰' + fw[300].maxPct.toFixed(0) + '%/末' + fw[300].lastPct.toFixed(0) + '%' : '无价'}` +
        ` | +15min ${fw[900] ? '峰' + fw[900].maxPct.toFixed(0) + '%/末' + fw[900].lastPct.toFixed(0) + '%' : '无价'}（${ticks.length} ticks）`);
    }
  }

  // ② 全实验信号分组
  const all = await sigsFor(EXP, null);
  const executedTokens = new Set(all.filter((s) => (s.metadata || {}).execution_status === 'executed').map((s) => s.token_address));

  // ③ 已成交票 ultra 分布对照
  const execUltra = [];
  for (const s of all) {
    const m = s.metadata || {}; if (m.execution_status !== 'executed') continue;
    const bp = m.buyPoint || {}; const d = bp.dimensions || {};
    const heat = (d.market_heat || {}).bucket; const act = (d.activity_level || {}).bucket;
    if (heat === 'ultra' || act === 'ultra') execUltra.push({ addr: s.token_address, at: s.created_at, heat, act, pat: (d.market_pattern || {}).bucket });
  }
  console.log(`\n===== ② 已成交票（${executedTokens.size} token）中 heat/act=ultra：${execUltra.length} 条信号 =====`);
  for (const e of execUltra.slice(0, 12)) console.log(`  ${e.addr} ${e.at.slice(5, 19)} heat=${e.heat} act=${e.act} pattern=${e.pat}`);

  // ④ ultra 相关拒票 + 前向
  const byToken = new Map();
  for (const s of all) {
    const m = s.metadata || {}; const bp = m.buyPoint || {};
    if (!bp || !bp.dimensions) continue;
    const d = bp.dimensions; const a = bp.assessment || {};
    if (m.execution_status === 'executed') continue;
    const heat = (d.market_heat || {}).bucket; const act = (d.activity_level || {}).bucket;
    const ultraRelated = ((a.rule === 'pattern_gate' || a.rule === 'pump_exempt_gate' || a.rule === 'activity_gate'))
      && (heat === 'ultra' || act === 'ultra');
    if (!ultraRelated) continue;
    const an = bp.anchors || {};
    if (!byToken.has(s.token_address)) byToken.set(s.token_address, []);
    byToken.get(s.token_address).push({
      at: s.created_at, leg: ((m.signalGate || {}).legId || '-').replace('buy_', ''),
      rule: a.rule, pat: (d.market_pattern || {}).bucket, heat, act,
      chip: (d.holder_concentration || {}).bucket || '?', curVs: an.currentVsLaunchPct ?? null,
      price: m.price, cc: m.cheatCheck ? (m.cheatCheck.grade || '?') + (m.cheatCheck.exempt ? '+' + m.cheatCheck.exempt.code : '') : '?',
    });
  }
  const rows = [...byToken.entries()].map(([addr, list]) => ({ addr, list }));
  console.log(`\n===== ③ ultra 相关拒票 ${rows.length} token——逐票拉 ticks 算「若首拒锚买入」前向 =====`);
  for (const r of rows) {
    const f = r.list[0];
    const at = new Date(Date.parse(f.at) - 120000).toISOString();
    const end = new Date(Date.parse(f.at) + 960000).toISOString();
    try {
      const ticks = await pullTicks(r.addr, at, end);
      r.fwd = fwdOf(ticks, f.at);
    } catch (e) { r.fwd = null; console.error(`  ticks 失败 ${r.addr}: ${e.message}`); }
  }
  rows.sort((x, y) => {
    const fx = x.fwd && x.fwd[900] ? x.fwd[900].lastPct : -1e9;
    const fy = y.fwd && y.fwd[900] ? y.fwd[900].lastPct : -1e9;
    return fy - fx;
  });
  let win5 = 0, lose5 = 0, nav5 = 0;
  for (const r of rows) {
    const h5 = r.fwd && r.fwd[300];
    if (!h5) nav5++; else if (h5.lastPct >= 0) win5++; else lose5++;
  }
  console.log(`+5min 末价分布（若首拒锚 0.2 BNB 买入）：正 ${win5} / 负 ${lose5} / 无价 ${nav5}`);
  for (const r of rows) {
    const f = r.list[0]; const h5 = r.fwd && r.fwd[300]; const h15 = r.fwd && r.fwd[900];
    console.log(`\n${r.addr} | ${r.list.length} 条 | ${f.at.slice(5, 19)} ${f.leg} ${f.rule} pattern=${f.pat} heat=${f.heat} act=${f.act} chip=${f.chip} curVs=${f.curVs ?? '?'} cheat=${f.cc}`);
    console.log(`  若买入：+5min ${h5 ? '峰' + h5.maxPct.toFixed(0) + '%/末' + h5.lastPct.toFixed(0) + '%' : '无价'}` +
      ` | +15min ${h15 ? '峰' + h15.maxPct.toFixed(0) + '%/末' + h15.lastPct.toFixed(0) + '%' : '无价'}`);
    if (r.list.length > 1) {
      const others = r.list.slice(1, 3).map((e) => `${e.at.slice(11, 19)} ${e.leg} ${e.rule} curVs=${e.curVs ?? '?'}`);
      console.log(`  其余信号：${others.join(' | ')}${r.list.length > 3 ? ` … 另 ${r.list.length - 3} 条` : ''}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
