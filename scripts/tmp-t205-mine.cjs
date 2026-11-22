#!/usr/bin/env node
// 一次性（本地小结果）：T205 both 臂增量面（both 有 ctrl 无的成交票）买点门链留痕 ×
// 盈亏分离轴挖掘——用户裁定「增量胜率再提升」。只读。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

(async () => {
  const sb = dbManager.getClient();
  const { data: exps } = await sb.from('experiments').select('id,experiment_name').in('experiment_name', ['bt-v170-t205-ctrl', 'bt-v173-t205-both']);
  const idOf = Object.fromEntries(exps.map(e => [e.experiment_name, e.id]));
  const CTRL = idOf['bt-v170-t205-ctrl'], BOTH = idOf['bt-v173-t205-both'];

  async function pnlOf(id) {
    const per = {}; let from = 0;
    for (;;) {
      const { data } = await sb.from('trades').select('token_address,trade_direction,input_amount,output_amount,trade_status,metadata')
        .eq('experiment_id', id).order('id', { ascending: true }).range(from, from + 999);
      if (!data || !data.length) break;
      for (const t of data) {
        if (t.trade_status !== 'success') continue;
        const k = t.token_address; per[k] = per[k] || { inv: 0, ret: 0, holds: [], pps: [] };
        if (t.trade_direction === 'buy') per[k].inv += Number(t.input_amount) || 0;
        else {
          per[k].ret += Number(t.output_amount) || 0;
          const m = t.metadata || {};
          if (Number.isFinite(m.profitPercent)) per[k].pps.push(m.profitPercent);
          if (Number.isFinite(m.holdDuration)) per[k].holds.push(m.holdDuration);
        }
      }
      if (data.length < 1000) break; from += 1000;
    }
    return per;
  }
  async function firstBuys(id) {
    const map = new Map(); let from = 0;
    for (;;) {
      const { data } = await sb.from('strategy_signals').select('token_address, created_at, metadata, reason, executed')
        .eq('experiment_id', id).eq('signal_type', 'BUY').order('created_at', { ascending: true }).range(from, from + 499);
      if (!data || !data.length) break;
      for (const s of data) {
        if (map.has(s.token_address)) continue;
        if (!s.executed) continue; // 首个成交信号的留痕
        map.set(s.token_address, s.metadata || {});
      }
      if (data.length < 500) break; from += 500;
    }
    return map;
  }
  const pc = await pnlOf(CTRL), pb = await pnlOf(BOTH);
  const inc = Object.keys(pb).filter(k => !pc[k]);
  console.log(`both ${Object.keys(pb).length} 票 / 增量面 ${inc.length} 票；增量胜 ${inc.filter(k => pb[k].ret - pb[k].inv > 0).length}`);
  const fb = await firstBuys(BOTH);

  const rows = inc.filter(k => fb.has(k)).map(k => {
    const p = pb[k], m = fb.get(k);
    const af = m.actFrontGate || {}, ch = m.cheatCheck || {}, bp = m.buyPoint || {};
    const bpa = (bp.anchors || {}) || {};
    const tf = m.trendFactors || {};
    const lv = ch.levels || {};
    const fc = m.factorCheck || {};
    const pvpT = (fc.pvp && fc.pvp.trace) || {};
    return {
      addr: k, net: p.ret - p.inv, win: p.ret - p.inv > 0,
      afAct: af.act ?? null, afSbw: af.sbw ?? null, afWash: af.wash ?? null,
      stageCold: af.stageCold ?? null, ath: af.athVsLaunchPct ?? null,
      cheatGrade: ch.grade ?? null, washPair: lv.washPair ?? null, sbwLv: lv.sameBlockBuyWave ?? null,
      eqSplit: lv.equalAmountSplit ?? null, tiering: lv.amountTiering ?? null, rat: lv.riseAmountTiering ?? null,
      w30bn: bpa.win30BuyN ?? null, w60bn: bpa.win60BuyN ?? null, idlePct: bpa.actIdlePct ?? null,
      holders: bpa.holdersNow ?? null, bSpan: bpa.actSpanSec ?? null, burst5N: bpa.burst5N ?? null,
      act20: pvpT.act20 ?? null, act30: pvpT.act30 ?? null,
      actBuyBnb: tf.actBuyBnb ?? null, actBuyers: tf.actBuyers ?? null, age: tf.tokenAgeSec ?? null,
      curVs: tf.currentVsLaunchPct ?? null, routerPct: tf.tradesRouterPct ?? null,
      leg: (m.strategyName || '').slice(0, 16),
      maxPp: p.pps.length ? Math.max(...p.pps) : null,
      medHold: p.holds.length ? p.holds.slice().sort((a, b) => a - b)[Math.floor(p.holds.length / 2)] : null,
    };
  });
  console.log(`增量+留痕行 ${rows.length}`);

  const tab = (label, keyFn, min = 3) => {
    const g = new Map();
    for (const r of rows) { const k = keyFn(r); if (k == null) continue; if (!g.has(k)) g.set(k, { n: 0, w: 0, net: 0, tail: 0 }); const e = g.get(k); e.n++; if (r.win) e.w++; e.net += r.net; if (r.net > 0.15) e.tail++; }
    console.log(`\n── ${label}`);
    for (const [k, e] of [...g.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      if (e.n < min) continue;
      console.log(`  ${String(k).padEnd(30)} ${String(e.n).padStart(4)}票 胜率${(e.w / e.n * 100).toFixed(0).padStart(3)}% 净Σ${e.net.toFixed(2).padStart(7)} 尾>0.15:${e.tail}`);
    }
  };
  tab('AF1 act 档', r => r.afAct);
  tab('AF1 sbw', r => r.afSbw);
  tab('AF1 wash', r => r.afWash);
  tab('stageCold 放行标记', r => r.stageCold);
  tab('cheat grade', r => r.cheatGrade);
  tab('washPair 档位', r => r.washPair);
  tab('sameBlockBuyWave 档位', r => r.sbwLv);
  tab('equalAmountSplit 档位', r => r.eqSplit);
  tab('amountTiering 档位', r => r.tiering);
  tab('BP win30BuyN（尾30s买笔）', r => r.w30bn == null ? null : r.w30bn === 0 ? '0' : r.w30bn <= 2 ? '1-2' : r.w30bn <= 5 ? '3-5' : '6+');
  tab('BP win60BuyN', r => r.w60bn == null ? null : r.w60bn === 0 ? '0' : r.w60bn <= 3 ? '1-3' : r.w60bn <= 8 ? '4-8' : '9+');
  tab('BP actIdlePct', r => r.idlePct == null ? null : r.idlePct < 40 ? '<40' : r.idlePct < 70 ? '[40,70)' : r.idlePct < 95 ? '[70,95)' : '≥95');
  tab('BP holdersNow', r => r.holders == null ? null : r.holders < 8 ? '<8' : r.holders < 15 ? '[8,15)' : r.holders < 30 ? '[15,30)' : '≥30');
  tab('ath（AF1 留痕）', r => r.ath == null ? null : r.ath < 0 ? '破发' : r.ath < 20 ? '[0,20)' : r.ath < 40 ? '[20,40)' : r.ath < 60 ? '[40,60)' : '[60,80)');
  tab('age', r => r.age == null ? null : r.age < 120 ? '<2min' : r.age < 600 ? '2-10min' : r.age < 1800 ? '10-30min' : '≥30min');
  tab('curVs', r => r.curVs == null ? null : r.curVs < 0 ? '破发' : r.curVs < 10 ? '[0,10)' : r.curVs < 20 ? '[10,20)' : '≥20');
  tab('actBuyBnb', r => r.actBuyBnb == null ? null : r.actBuyBnb === 0 ? '0（纯卖触发）' : r.actBuyBnb < 0.1 ? '(0,0.1)' : r.actBuyBnb < 0.3 ? '[0.1,0.3)' : '≥0.3');
  tab('act30（0.3级买家）', r => r.act30 == null ? null : r.act30 === 0 ? '0' : (r.act30 === 1 ? '1' : '2+'));
  tab('routerPct', r => r.routerPct == null ? null : r.routerPct < 40 ? '<40' : r.routerPct < 60 ? '[40,60)' : '≥60');
  tab('medHold（中位持有秒）', r => r.medHold == null ? null : r.medHold < 60 ? '<60s' : r.medHold < 180 ? '60-180s' : '≥180s');
  console.log('\n（尾>0.15=单票净>0.15B 张数；min 3 票桶才显示）');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
