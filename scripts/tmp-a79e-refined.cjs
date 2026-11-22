#!/usr/bin/env node
/**
 * 一次性研究脚本（182 跑）：精炼豁免形状全量验证（141 张 FP32 命中票）
 * 形状=大户主导 ∧ 非砸盘进行时（chg30/actNet）∧ 大户未出货（出货比）。
 * 组件来源：信号 trendFactors（chg30Pct/actNetBnb）+ asof JSON（share/出货比）+ chase JSON（结局）。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400';

async function fetchAll(from, pageSize = 1000) {
  const rows = []; let offset = 0;
  for (;;) {
    const page = await from.range(offset, offset + pageSize - 1);
    if (page.error) throw new Error(page.error.message);
    rows.push(...page.data);
    if (page.data.length < pageSize) return rows;
    offset += pageSize;
  }
}

(async () => {
  const db = dbManager.getClient();
  const sigs = await fetchAll(db.from('strategy_signals')
    .select('token_address, created_at, metadata').eq('experiment_id', EXP_ID));
  // 每 token 首次 FP32 命中信号的 trendFactors
  const tfMap = new Map(), hitTime = new Map();
  for (const s of sigs) {
    const a = (s.token_address || '').toLowerCase(); if (!a) continue;
    const gates = s.metadata && s.metadata.factorCheck && s.metadata.factorCheck.gates;
    if (!Array.isArray(gates) || !gates.some(g => g.id === 'big_buy_defer' && g.hit)) continue;
    const t = new Date(s.created_at).getTime();
    if (hitTime.has(a) && hitTime.get(a) <= t) continue;
    hitTime.set(a, t);
    tfMap.set(a, (s.metadata && s.metadata.trendFactors) || {});
  }
  const asof = new Map(JSON.parse(require('fs').readFileSync('/tmp/a79e-asof-out.json', 'utf8')).filter(r => r.a).map(r => [r.addr, r]));
  const chase = new Map(JSON.parse(require('fs').readFileSync('/tmp/a79e-chase-out.json', 'utf8')).map(r => [r.addr, r]));

  const res = [];
  for (const [addr, tf] of tfMap) {
    const A = asof.get(addr); const C = chase.get(addr);
    if (!A || !C) continue;
    const a = A.a;
    const bigSell = a.totalSell > 0 && a.bigSellerShare !== null ? a.totalSell * a.bigSellerShare / 100 : 0;
    res.push({
      addr, sym: A.sym || '',
      share: a.share,
      sellRatio: a.bigBuyBnb > 0 ? bigSell / a.bigBuyBnb : null,
      chg30: typeof tf.chg30Pct === 'number' ? tf.chg30Pct : null,
      chg5: typeof tf.chg5Pct === 'number' ? tf.chg5Pct : null,
      actNet: typeof tf.actNetBnb === 'number' ? tf.actNetBnb : null,
      actBuy: typeof tf.actBuyBnb === 'number' ? tf.actBuyBnb : null,
      ageS: a.ageSec,
      max60: C.gainFromSig60, unlockInfl: C.chase, afterUnlock: C.gainAfterUnlock,
      golden: A.golden,
    });
  }
  console.log(`样本 ${res.length}`);
  const med = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const summ = (list, label) => {
    if (!list.length) { console.log(`${label}: 无样本`); return; }
    const g = list.map(r => r.max60).filter(v => v !== null && v !== undefined);
    console.log(`${label}: n=${list.length} | 信号直买 max60 中位 ${med(g).toFixed(0)}% ≥200% ${g.filter(v => v >= 200).length} 票 ≥500% ${g.filter(v => v >= 500).length} 票 | 尾票占比 ${(list.filter(r => r.max60 >= 200).length / list.length * 100).toFixed(0)}%`);
  };
  const dom = (r) => r.share >= 60;

  console.log('\n── 精炼形状（dom ∧ 非砸盘进行时 ∧ 大户未出货）扫线 ──');
  for (const [c30, anet, sr] of [[-10, -0.1, 0.4], [-10, -0.1, 0.3], [-5, 0, 0.4], [0, -0.1, 0.5], [-15, -0.2, 0.5], [-10, 0, 0.5]]) {
    const pick = res.filter(r => dom(r)
      && r.chg30 !== null && r.chg30 >= c30
      && r.actNet !== null && r.actNet >= anet
      && r.sellRatio !== null && r.sellRatio <= sr);
    summ(pick, `dom∧chg30≥${c30}∧actNet≥${anet}∧出货≤${sr}`);
  }
  console.log('── 基线 ──');
  summ(res.filter(r => dom(r)), 'dom_only');
  summ(res, '全部命中');

  console.log('\n── 组件单变量 ──');
  for (const c30 of [-15, -10, 0]) summ(res.filter(r => dom(r) && r.chg30 !== null && r.chg30 >= c30), `dom∧chg30≥${c30}          `);
  for (const anet of [-0.2, -0.1, 0]) summ(res.filter(r => dom(r) && r.actNet !== null && r.actNet >= anet), `dom∧actNet≥${anet}          `);
  for (const sr of [0.3, 0.4, 0.5]) summ(res.filter(r => dom(r) && r.sellRatio !== null && r.sellRatio <= sr), `dom∧出货比≤${sr}          `);

  // 看板：精炼形状（-10/-0.1/0.4）全明细
  console.log('\n── 精炼形状（chg30≥-10 ∧ actNet≥-0.1 ∧ 出货≤0.4）全明细 ──');
  for (const r of res.filter(r => dom(r) && r.chg30 >= -10 && r.actNet >= -0.1 && r.sellRatio <= 0.4 && r.max60 !== null).sort((a, b) => b.max60 - a.max60)) {
    console.log(`${r.addr.slice(0, 10)}… ${String(r.sym).padEnd(8)} chg30=${String(r.chg30).padStart(6)} actNet=${String(r.actNet).padStart(6)} 出货=${r.sellRatio.toFixed(2)} share=${r.share}% age=${r.ageS}s → 信号直买${r.max60}% 解锁通胀${r.unlockInfl}% ${r.golden ? '狗' : ''}`);
  }
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
