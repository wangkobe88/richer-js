#!/usr/bin/env node
// JG-24 案源负票反证 v2（182 跑）：从票全史起扫（修复 v1 窗口空扫），
// soloHHI<0.10 ∧ posH≥10 的 FP22 域采样时点，报告 entHHI 分布，
// 重点标注「簇大额卖出前 120s 内」的时点（豁免伤害风险点）。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const SOURCES = [
  ['币安锁', '0x426c0acab93fda89ceed0026103e310195d57777'],
  ['大美', '0x61a1f7cf65b5b0c38c10184b90506fe02b607777'],
  ['猫厨师', '0xdc212d5b12e6d8a7691656964a791c8ab71a7777'],
  ['不对劲', '0xb84e7e0e29513923272cbfb7ab1cc8e7de307777'],
  ['豆皮儿', '0x531d8babfdd7a5e0e37ef0fdbcc395167ebc7777'],
  ['币安之旅', '0x579343c72e546a7b4e78526c0f1c853c979c7777'],
];
const DUST = 0.015;

async function fetchAll(sb, token) {
  const { data, error } = await sb.from('wss_price_ticks')
    .select('trade_type,bnb_amount,block_number,block_time,sender_address')
    .eq('token_address', token).order('block_time', { ascending: true }).limit(8000);
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({
    ts: Date.parse(r.block_time), buy: r.trade_type === 'buy', blk: r.block_number,
    amt: Number(r.bnb_amount || 0), w: (r.sender_address || '').toLowerCase(),
  }));
}

function holdingsAt(ticks, anchorTs) {
  const net = new Map(), firstBlk = new Map();
  for (const t of ticks) {
    if (t.ts > anchorTs) break;
    if (!t.w) continue;
    net.set(t.w, (net.get(t.w) || 0) + (t.buy ? t.amt : -t.amt));
    if (t.buy && !firstBlk.has(t.w)) firstBlk.set(t.w, t.blk);
  }
  const pos = [...net.entries()].filter(([, v]) => v > DUST);
  if (pos.length < 2) return null;
  const sum = pos.reduce((s, [, v]) => s + v, 0);
  let solo = 0; for (const [, v] of pos) solo += Math.pow(v / sum, 2);
  const byBlk = new Map();
  for (const [w, v] of pos) { const k = 'b' + (firstBlk.get(w) ?? 'x'); byBlk.set(k, (byBlk.get(k) || 0) + v); }
  let ent = 0; for (const v of byBlk.values()) ent += Math.pow(v / sum, 2);
  return { posH: pos.length, soloHHI: solo, entHHI: ent };
}

(async () => {
  const sb = dbManager.getClient();
  for (const [name, addr] of SOURCES) {
    const ticks = await fetchAll(sb, addr);
    if (ticks.length < 10) { console.log(`${name}: 全史 ticks=${ticks.length} 不足`); continue; }
    const life = ((ticks[ticks.length - 1].ts - ticks[0].ts) / 60000).toFixed(1);
    // 大额卖出行（≥0.3B）= 协同砸风险点
    const bigSells = ticks.filter(t => !t.buy && t.amt >= 0.3).map(t => t.ts);
    const hits = [];
    let lastTs = 0;
    for (const t of ticks) {
      if (t.ts - lastTs < 60000) continue;
      lastTs = t.ts;
      const h = holdingsAt(ticks, t.ts);
      if (h && h.posH >= 10 && h.soloHHI < 0.10) {
        const nearDump = bigSells.some(s => s >= t.ts && s <= t.ts + 120000); // 采样后 120s 内有大卖
        hits.push({ ts: t.ts, solo: +h.soloHHI.toFixed(3), ent: +h.entHHI.toFixed(3), nearDump });
      }
    }
    if (!hits.length) { console.log(`${name}: 全史 ${life}min 无 FP22 域时点`); continue; }
    const ex = hits.filter(h => h.ent >= 0.10);
    const exDanger = ex.filter(h => h.nearDump);
    console.log(`${name}: 生命 ${life}min FP22域采样 ${hits.length} | 合并后仍拦(ent<0.10)=${hits.length - ex.length} | 会被豁免(ent≥0.10)=${ex.length} 其中「120s内遭大卖」=${exDanger.length}`);
    for (const h of ex.slice(0, 8)) console.log(`   ${new Date(h.ts).toISOString().slice(5, 19)} solo=${h.solo} ent=${h.ent} ${h.nearDump ? '⚠️120s内大卖' : ''}`);
    for (const h of hits.filter(x => x.ent < 0.10).slice(0, 3)) console.log(`   (照拦例) ${new Date(h.ts).toISOString().slice(5, 19)} solo=${h.solo} ent=${h.ent}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
