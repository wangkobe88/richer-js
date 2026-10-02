#!/usr/bin/env node
// ============================================================================
// V6 fourmeme 漏斗补充分析（2026-10-02；182 专用）
// 问题：router 分门修复后 V6 独有买票仅 1 张（还是 flap）——fourmeme 成票仍 0，
// 需要定位 fourmeme 票死在哪个门。
//
// 输出：
//   ① V6 买信号按 platform 分组漏斗（signal 数 / executed / 逐门 exclusive 拦截）
//   ② B2 独有 37 张中 8 张「其他/时序」票在 V6 的信号存在性与拦截原因
//   ③ V6 独有 1 张（0xd326a31f…）的形状
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const V6 = '82093ca3-ea73-4f26-9aef-cb9a1acee842';
const B2 = '960d1bbf-c561-4651-abb6-7f1a17e153e6';

async function pullSignals(client, expId, action) {
  const pageSize = 1000; let offset = 0; const all = [];
  for (;;) {
    const { data, error } = await client.from('strategy_signals')
      .select('id, token_address, executed, created_at, metadata')
      .eq('experiment_id', expId).eq('action', action)
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

const gate = (meta) => {
  const pb = meta?.preBuyCheckFactors || {}; const nr = pb.narrativeRating;
  const c = [];
  if (!(nr === 2 || nr === 3)) c.push('narrative');
  if (!(pb.earlyTradesTop1BuySharePct < 60)) c.push('top1');
  if (pb.earlyTradesTop1BuyCovered !== 1) c.push('top1Covered');
  if (pb.platform === 'flap' && !(pb.earlyTradesRouterPct >= 50 && pb.earlyTradesRouterPct < 80)) c.push('router');
  if (!(pb.earlyTradesUniqueWallets >= 15)) c.push('uw');
  return c;
};

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const s6 = await pullSignals(db, V6, 'buy');
  const s2 = await pullSignals(db, B2, 'buy');

  // ══ ① platform 漏斗 ══
  console.log('══ ① V6 买信号 platform 漏斗 ══');
  const plat = {};
  for (const s of s6) {
    const p = s.metadata?.preBuyCheckFactors?.platform || '(null)';
    const rec = plat[p] = plat[p] || { signals: 0, tokens: new Set(), execTokens: new Set(), gates: {}, noPb: 0 };
    rec.signals++;
    rec.tokens.add(s.token_address);
    if (s.executed) rec.execTokens.add(s.token_address);
    if (!s.metadata?.preBuyCheckFactors) { rec.noPb++; continue; }
    if (!s.executed) {
      const g = gate(s.metadata);
      const k = g.length === 0 ? '(门全过)' : g.length === 1 ? g[0] : 'multi:' + g.join('+');
      rec.gates[k] = (rec.gates[k] || 0) + 1;
    }
  }
  for (const [p, r] of Object.entries(plat)) {
    console.log(`\n[${p}] 信号 ${r.signals} 条 | token ${r.tokens.size} | executed token ${r.execTokens.size}${r.noPb ? ` | 无preBuy因子 ${r.noPb}` : ''}`);
    const ent = Object.entries(r.gates).sort((a, b) => b[1] - a[1]);
    for (const [k, n] of ent.slice(0, 10)) console.log(`    拦 ${k}: ${n}`);
  }

  // ══ ② B2 独有 37 张的 token 集 ══
  console.log('\n══ ② B2 独有票在 V6 的信号存在性 ══');
  // 重算 B2 独有 token：简化——B2 executed token − V6 executed token
  const ex2 = new Set(s2.filter(s => s.executed).map(s => s.token_address));
  const ex6 = new Set(s6.filter(s => s.executed).map(s => s.token_address));
  const only2 = [...ex2].filter(a => !ex6.has(a));
  console.log(`B2 executed tokens ${ex2.size}，V6 executed ${ex6.size}，B2 独有 ${only2.length}`);
  const sig6 = new Map(); for (const s of s6) { if (!sig6.has(s.token_address)) sig6.set(s.token_address, []); sig6.get(s.token_address).push(s); }
  const cat = { hasBlockedSignal: 0, noSignal: 0 };
  const noSignalTokens = [];
  const blockedDetail = [];
  for (const a of only2) {
    const arr = sig6.get(a);
    if (!arr || arr.length === 0) { cat.noSignal++; noSignalTokens.push(a); }
    else {
      cat.hasBlockedSignal++;
      const s = arr[arr.length - 1];
      const g = gate(s.metadata);
      const pb = s.metadata?.preBuyCheckFactors || {};
      blockedDetail.push({ a, g, uw: pb.earlyTradesUniqueWallets, rp: pb.earlyTradesRouterPct, plat: pb.platform });
    }
  }
  console.log(`  V6 有被拦信号: ${cat.hasBlockedSignal} | V6 完全无信号（condition 层拦）: ${cat.noSignal}`);
  const gcount = {};
  for (const d of blockedDetail) { const k = d.g.length ? d.g.join('+') : '(门全过,另有原因)'; gcount[k] = (gcount[k] || 0) + 1; }
  for (const [k, n] of Object.entries(gcount).sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${n}`);
  console.log('  无信号 token（condition 层: TPA2.5/tokenCycle/时序）前 8:');
  for (const a of noSignalTokens.slice(0, 8)) {
    const b2s = s2.find(s => s.executed && s.token_address === a);
    const tpa = b2s?.metadata?.trendFactors?.TPAPre_tokenScore;
    console.log(`    ${a} | B2 signal trendFactors.TPAPre_tokenScore=${tpa ?? '(null/缺)'} | trendFactors 键样例=${Object.keys(b2s?.metadata?.trendFactors || {}).slice(0, 8).join(',')}`);
  }

  // ══ ③ V6 独有 1 张 ══
  console.log('\n══ ③ V6 独有 0xd326a31f… 形状 ══');
  const d3 = s6.filter(s => s.token_address === '0xd326a31f8f38a3c489bfe44535dd91be5f2c7777');
  console.log(`  V6 信号 ${d3.length} 条`);
  for (const s of d3.slice(0, 3)) {
    const pb = s.metadata?.preBuyCheckFactors || {};
    console.log(`  executed=${s.executed} plat=${pb.platform} rp=${pb.earlyTradesRouterPct} uw=${pb.earlyTradesUniqueWallets} nr=${pb.narrativeRating} ts=${s.created_at}`);
  }
  const d3b2 = s2.filter(s => s.token_address === '0xd326a31f8f38a3c489bfe44535dd91be5f2c7777');
  console.log(`  B2 信号 ${d3b2.length} 条（executed=${d3b2.filter(s=>s.executed).length}）`);
  for (const s of d3b2.slice(0, 2)) {
    const pb = s.metadata?.preBuyCheckFactors || {};
    console.log(`  B2: executed=${s.executed} rp=${pb.earlyTradesRouterPct} uw=${pb.earlyTradesUniqueWallets} nr=${pb.narrativeRating} ts=${s.created_at}`);
  }

  console.log('\n[done]');
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
