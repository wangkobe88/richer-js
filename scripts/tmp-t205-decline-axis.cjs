#!/usr/bin/env node
// 一次性（本地小结果）：T205 阶段放行面的「已明显下跌」轴分析——用户裁定
// 「凡是已经明显下跌的票需要滤掉」。键源=factorCheck.gates[tail_dip_knife].value
// 解析（ath/curVs/chg5/chg30=FP 判定时 buyDerived 原值，键保真零漂移）。
// 双脸验证：域外 36（v176−v175）+ 域内 215（v173−v170）。只读。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

(async () => {
  const sb = dbManager.getClient();
  const PAIRS = [
    { label: '域外 OOS', ctrl: 'bt-v175-t205-oos-ctrl', both: 'bt-v176-t205-oos-both' },
    { label: '域内', ctrl: 'bt-v170-t205-ctrl', both: 'bt-v173-t205-both' },
  ];
  async function pnlOf(id) {
    const per = {}; let from = 0;
    for (;;) {
      const { data } = await sb.from('trades').select('token_address,trade_direction,input_amount,output_amount,trade_status')
        .eq('experiment_id', id).order('id', { ascending: true }).range(from, from + 999);
      if (!data || !data.length) break;
      for (const t of data) {
        if (t.trade_status !== 'success') continue;
        const k = t.token_address; per[k] = per[k] || { inv: 0, ret: 0 };
        if (t.trade_direction === 'buy') per[k].inv += Number(t.input_amount) || 0;
        else per[k].ret += Number(t.output_amount) || 0;
      }
      if (data.length < 1000) break; from += 1000;
    }
    return per;
  }
  async function firstBuys(id) {
    const map = new Map(); let from = 0;
    for (;;) {
      const { data } = await sb.from('strategy_signals').select('token_address, metadata, executed')
        .eq('experiment_id', id).eq('signal_type', 'BUY').order('created_at', { ascending: true }).range(from, from + 499);
      if (!data || !data.length) break;
      for (const s of data) { if (!s.executed) continue; if (!map.has(s.token_address)) map.set(s.token_address, s.metadata || {}); }
      if (data.length < 500) break; from += 500;
    }
    return map;
  }
  const parseGate = (m) => {
    const gates = ((m.factorCheck || {}).gates) || [];
    const g = gates.find(x => x.id === 'tail_dip_knife');
    const v = (g && g.value) || '';
    const num = (re) => { const mm = v.match(re); return mm ? parseFloat(mm[1]) : null; };
    return {
      ath: num(/ath(-?[\d.]+)%/), curVs: num(/curVs(-?[\d.]+)%/),
      chg5: num(/chg5(-?[\d.]+)%/), chg30: num(/chg30(-?[\d.]+)%/),
      sell30: num(/卖30s(-?[\d.]+)B/),
    };
  };
  for (const pair of PAIRS) {
    const { data: exps } = await sb.from('experiments').select('id,experiment_name').in('experiment_name', [pair.ctrl, pair.both]);
    const idOf = Object.fromEntries(exps.map(e => [e.experiment_name, e.id]));
    const pc = await pnlOf(idOf[pair.ctrl]), pb = await pnlOf(idOf[pair.both]);
    const inc = Object.keys(pb).filter(k => !pc[k]);
    const fb = await firstBuys(idOf[pair.both]);
    const rows = inc.filter(k => fb.has(k)).map(k => {
      const p = parseGate(fb.get(k));
      return { k, net: pb[k].ret - pb[k].inv, win: pb[k].ret - pb[k].inv > 0, ...p,
        dd: (p.ath != null && p.curVs != null) ? p.ath - p.curVs : null };
    });
    console.log(`\n════ ${pair.label} 增量 ${inc.length} 票（解析成功 ${rows.filter(r => r.chg30 != null).length}）════`);
    const tab = (label, keyFn) => {
      const g = new Map();
      for (const r of rows) { const k2 = keyFn(r); if (k2 == null) continue; if (!g.has(k2)) g.set(k2, { n: 0, w: 0, net: 0 }); const e = g.get(k2); e.n++; if (r.win) e.w++; e.net += r.net; }
      console.log(`── ${label}`);
      for (const [k2, e] of [...g.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
        console.log(`  ${String(k2).padEnd(22)} ${String(e.n).padStart(4)}票 胜率${(e.w / e.n * 100).toFixed(0).padStart(3)}% 净Σ${e.net.toFixed(3).padStart(7)}`);
    };
    tab('chg30 档', r => r.chg30 == null ? null : r.chg30 < -10 ? '<-10' : r.chg30 < -5 ? '[-10,-5)' : r.chg30 < -2 ? '[-5,-2)' : r.chg30 < 0 ? '[-2,0)' : r.chg30 < 3 ? '[0,3)' : '≥3');
    tab('chg5 档', r => r.chg5 == null ? null : r.chg5 < -5 ? '<-5' : r.chg5 < -2 ? '[-5,-2)' : r.chg5 < 0 ? '[-2,0)' : '≥0');
    tab('双负（chg5<0 ∧ chg30<0）', r => (r.chg5 == null || r.chg30 == null) ? null : (r.chg5 < 0 && r.chg30 < 0 ? '双负下跌' : '非双负'));
    tab('距锚窗ATH回撤(dd)', r => r.dd == null ? null : r.dd < 10 ? '<10' : r.dd < 20 ? '[10,20)' : r.dd < 30 ? '[20,30)' : '≥30');
    tab('curVs 档', r => r.curVs == null ? null : r.curVs < 0 ? '破发' : r.curVs < 10 ? '[0,10)' : r.curVs < 20 ? '[10,20)' : '≥20');
    // 组合候选：chg30 < -2 / 双负 / chg30<0
    for (const [name, bad] of [
      ['chg30<-2', r => r.chg30 != null && r.chg30 < -2],
      ['chg30<0', r => r.chg30 != null && r.chg30 < 0],
      ['双负', r => r.chg5 != null && r.chg30 != null && r.chg5 < 0 && r.chg30 < 0],
      ['chg30<-5', r => r.chg30 != null && r.chg30 < -5],
      ['dd≥20', r => r.dd != null && r.dd >= 20],
    ]) {
      const cut = rows.filter(bad), keep = rows.filter(r => !bad(r));
      const cn = cut.length, cw = cut.filter(r => r.win).length, cnet = cut.reduce((s, r) => s + r.net, 0);
      const kn = keep.length, kw = keep.filter(r => r.win).length, knet = keep.reduce((s, r) => s + r.net, 0);
      console.log(`候选[${name}] 切${cn}票(胜${cw} 净${cnet.toFixed(3)}) | 留${kn}票 胜率${(kw / kn * 100).toFixed(1)}% 净${knet.toFixed(3)}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
