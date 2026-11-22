'use strict';
// T198/FP30 arb_bot_holdings 流通豁免假设验证（2026-11-21 用户提案：
// 「是否应该豁免流通比例小的情况」——案源 0x2ee9…7777 误伤票流通仅 13.7/14.5%）。
// 方法：拉各窗命中 arb_bot_holdings 的信号行（引擎真值 metadata：持筹%/流通%/HHI/
// 伴随臂），按锚点流通切分，前向收益（锚价→+60min max/min、+30min）对比放回面 vs
// 保留面；trades 实际净额交叉核对（可成交票）。零改动纯验证。
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXPS = [
  ['v164w1003', '9e9163de-a677-4d39-9c33-9ec9df05e400'], // 当前基底（FP32 门链，0x2ee9 案所在）
  ['v162w1003', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['v158w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['v150w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['v145w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
const FWD_MIN = 60; // 前向观测窗（分钟）

function parseGate(gates, id, re) {
  const g = (gates || []).find((x) => x.id === id);
  if (!g) return null;
  const m = typeof g.value === 'string' ? g.value.match(re) : null;
  return m ? Number(m[1]) : null;
}
const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;

(async () => {
  const sb = dbManager.getClient();
  const hits = [];
  for (const [label, exp] of EXPS) {
    // 命中行：metadata.factorCheck.arms contains arb_bot_holdings（DB 侧过滤，小结果）
    const { data: rows, error } = await sb.from('strategy_signals')
      .select('token_address,created_at,token_symbol,metadata->factorCheck')
      .eq('experiment_id', exp).eq('signal_type', 'BUY')
      .contains('metadata->factorCheck->arms', '["arb_bot_holdings"]')
      .limit(500);
    if (error) throw new Error(error.message);
    for (const r of rows) {
      const fc = r['metadata->factorCheck'] || r.factorCheck || {};
      hits.push({
        label, token: r.token_address, symbol: r.token_symbol, at: r.created_at,
        arbHold: parseGate(fc.gates, 'arb_bot_holdings', /持筹([\d.]+)%/),
        holderN: parseGate(fc.gates, 'arb_bot_holdings', /\((\d+)户\)/),
        circ: parseGate(fc.gates, 'even_split_crew', /流通([\d.]+)%/),
        hhi: parseGate(fc.gates, 'even_split_crew', /HHI([\d.]+)/),
        arms: fc.arms || [],
      });
    }
    console.log(`${label}: 命中 ${rows.length} 行`);
  }
  console.log(`\n总命中信号行: ${hits.length}`);

  // 前向收益（锚价=锚前最后可靠价；+60min 内 max/min；+30min 价）
  for (const h of hits) {
    const { data: pre } = await sb.from('wss_price_ticks')
      .select('block_time,price_bnb')
      .eq('token_address', h.token)
      .lte('block_time', h.at)
      .not('price_bnb', 'is', null)
      .order('block_number', { ascending: false }).order('log_index', { ascending: false })
      .limit(1);
    const entry = pre && pre[0] ? Number(pre[0].price_bnb) : null;
    h.entry = entry;
    if (entry == null) { h.fwdMax = h.fwdMin = h.ret30 = null; continue; }
    const to = new Date(new Date(h.at).getTime() + FWD_MIN * 60000).toISOString();
    const t30 = new Date(new Date(h.at).getTime() + 30 * 60000).toISOString();
    const { data: fwd } = await sb.from('wss_price_ticks')
      .select('block_time,price_bnb')
      .eq('token_address', h.token)
      .gt('block_time', h.at).lte('block_time', to)
      .not('price_bnb', 'is', null)
      .limit(4000);
    const arr = (fwd || []).map((r) => ({ t: r.block_time, p: Number(r.price_bnb) }))
      .sort((a, b) => a.t.localeCompare(b.t));
    if (!arr.length) { h.fwdMax = h.fwdMin = h.ret30 = null; continue; }
    h.fwdMax = Math.max(...arr.map((x) => x.p)) / entry - 1;
    h.fwdMin = Math.min(...arr.map((x) => x.p)) / entry - 1;
    const at30 = arr.filter((x) => x.t <= t30).pop();
    h.ret30 = at30 ? at30.p / entry - 1 : null;
  }

  // 汇总：按流通 16.5（FP22 同线）切分 + 敏感性多线
  const LINE = 16.5;
  const rel = hits.filter((h) => h.circ != null && h.circ < LINE);   // 豁免放回面
  const keep = hits.filter((h) => h.circ != null && h.circ >= LINE); // 维持拦截面
  const noCirc = hits.filter((h) => h.circ == null);
  console.log('\n── 豁免线敏感性（纯命中行=豁免真成交面）──');
  for (const L of [10, 12, 16.5, 20]) {
    const p = hits.filter((h) => h.arms.length === 1 && h.circ != null && h.circ < L && h.fwdMax != null);
    const mx = p.map((h) => h.fwdMax), r30 = p.filter((h) => h.ret30 != null).map((h) => h.ret30), mn = p.map((h) => h.fwdMin);
    console.log(`  线${L}: 纯放行 ${p.length} 行 | ret30 中位 ${r30.length ? (med(r30) * 100).toFixed(1) + '%' : '-'} >0 ${r30.filter(r => r > 0).length}/${r30.length} | fwdMax≥+100% ${mx.filter(r => r >= 1).length} | fwdMin≤−30% ${mn.filter(r => r <= -0.3).length}`);
  }
  function agg(list, name) {
    const f = list.filter((h) => h.fwdMax != null);
    const maxRet = f.map((h) => h.fwdMax);
    const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
    console.log(`\n=== ${name}: ${list.length} 行（前向数据 ${f.length}）===`);
    if (!f.length) return;
    console.log(`  fwdMax(60m): 中位 ${(med(maxRet) * 100).toFixed(1)}%  最大 ${(Math.max(...maxRet) * 100).toFixed(1)}%  ≥+50%: ${maxRet.filter(r => r >= 0.5).length} 票  ≥+100%: ${maxRet.filter(r => r >= 1).length} 票`);
    const r30 = f.filter((h) => h.ret30 != null).map((h) => h.ret30);
    if (r30.length) console.log(`  ret@30m:   中位 ${(med(r30) * 100).toFixed(1)}%  >0: ${r30.filter(r => r > 0).length}/${r30.length}  最差 ${(Math.min(...r30) * 100).toFixed(1)}%`);
    const mn = f.map((h) => h.fwdMin);
    console.log(`  fwdMin(60m): 中位 ${(med(mn) * 100).toFixed(1)}%  ≤−30%: ${mn.filter(r => r <= -0.3).length} 票`);
  }
  agg(rel, `流通<${LINE}%（豁免放回面）`);
  agg(keep, `流通≥${LINE}%（维持拦截面）`);
  agg(noCirc, '流通值缺席');

  // 纯命中行（伴随臂为空 → 豁免后该信号真会买）——豁免的真实成交面
  const pure = hits.filter((h) => h.arms.length === 1);
  const pureRel = pure.filter((h) => h.circ != null && h.circ < LINE);
  const pureKeep = pure.filter((h) => h.circ != null && h.circ >= LINE);
  agg(pureRel, `纯命中·流通<${LINE}%（豁免真成交面）`);
  agg(pureKeep, `纯命中·流通≥${LINE}%（豁免后仍拦）`);
  // per-token 去重（首行）
  const firstByTok = new Map();
  for (const h of [...rel, ...keep]) {
    const k = h.label + '|' + h.token;
    const prev = firstByTok.get(k);
    if (!prev || h.at < prev.at) firstByTok.set(k, h);
  }
  const tokRel = [...firstByTok.values()].filter((h) => h.circ < LINE);
  const tokKeep = [...firstByTok.values()].filter((h) => h.circ >= LINE);
  agg(tokRel, `按票去重·流通<${LINE}%`);
  agg(tokKeep, `按票去重·流通≥${LINE}%`);
  console.log(`\n纯命中行总数 ${pure.length}/${hits.length}（其余为伴随臂命中——豁免后仍被伴随臂拦）`);

  // 明细（放回面逐行 + 保留面逐行）
  const line = (h) => `${h.label} ${h.token} ${h.symbol || ''} @${(h.at || '').slice(11, 19)} 持筹${h.arbHold}%( ${h.holderN}户) 流通${h.circ}% HHI${h.hhi} 伴随[${h.arms.join(',')}] 前向max=${h.fwdMax != null ? (h.fwdMax * 100).toFixed(1) + '%' : '-'} 30m=${h.ret30 != null ? (h.ret30 * 100).toFixed(1) + '%' : '-'} min=${h.fwdMin != null ? (h.fwdMin * 100).toFixed(1) + '%' : '-'}`;
  console.log(`\n── 流通<${LINE}% 明细 ──`);
  for (const h of rel) console.log('  ' + line(h));
  console.log(`\n── 流通≥${LINE}% 明细 ──`);
  for (const h of keep) console.log('  ' + line(h));
  if (noCirc.length) { console.log(`\n── 流通缺席明细 ──`); for (const h of noCirc) console.log('  ' + line(h)); }
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message, e); process.exit(1); });
