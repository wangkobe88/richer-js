#!/usr/bin/env node
/**
 * 一次性研究脚本（182 跑）：组级 EV/胜率（用户裁定 2026-11-21：不需单票判别，看组收益率/胜率）
 * 模拟：信号价入场 0.2B（=回测口径 4 卡×0.05），退出=引擎主出口近似——
 *   stallClose：距上一笔足额成交（≥0.02B）>50s → 按当时曲线价（=最新成交价）卖出；
 *   全程无 stall → 数据末价退出（bonding curve 恒可卖，mark-to-last 现实）。
 * 口径近似说明：无 almost 90s 延长档（地板锚本地难复现，偏向保守=更早出）；
 *   未建毕业/卖腿确认窗（早期票主出口就是断流，影响小）。
 * 分组：A=27 形状票（旧出货腿）；B=卖家口径新腿；C=无卖家腿；D=全 141。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const WIN_START = '2026-10-02T23:50:00.000Z';
const SPILL_END = '2026-10-05T06:00:00.000Z';
const STALL_MS = 50_000, SUB_BNB = 0.02, POS_BNB = 0.2;
const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : 0; };
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
  const chase = JSON.parse(require('fs').readFileSync('/tmp/a79e-chase-out.json', 'utf8'));
  const asof = new Map(JSON.parse(require('fs').readFileSync('/tmp/a79e-asof-out.json', 'utf8')).filter(r => r.a).map(r => [r.addr, r]));
  const sellcal = new Map(JSON.parse(require('fs').readFileSync('/tmp/a79e-sellcal-out.json', 'utf8')).map(r => [r.addr, r]));
  // 信号 trendFactors（chg30/actNet）需重拉一次
  const sigs = await fetchAll(db.from('strategy_signals').select('token_address, created_at, metadata')
    .eq('experiment_id', '9e9163de-a677-4d39-9c33-9ec9df05e400'));
  const tfMap = new Map(), hitTime = new Map();
  for (const s of sigs) {
    const a = (s.token_address || '').toLowerCase(); if (!a) continue;
    const gates = s.metadata && s.metadata.factorCheck && s.metadata.factorCheck.gates;
    if (!Array.isArray(gates) || !gates.some(g => g.id === 'big_buy_defer' && g.hit)) continue;
    const t = new Date(s.created_at).getTime();
    if (hitTime.has(a) && hitTime.get(a) <= t) continue;
    hitTime.set(a, t); tfMap.set(a, (s.metadata && s.metadata.trendFactors) || {});
  }
  const addrs = chase.map(r => r.addr);

  const byToken = new Map();
  for (let i = 0; i < addrs.length; i += 50) {
    const rows = await fetchAll(db.from('wss_price_ticks')
      .select('token_address, bnb_amount, price_bnb, price_outlier, block_number, log_index, block_time')
      .in('token_address', addrs.slice(i, i + 50)).gte('block_time', WIN_START).lte('block_time', SPILL_END));
    for (const r of rows) {
      const a = r.token_address.toLowerCase();
      let arr = byToken.get(a); if (!arr) { arr = []; byToken.set(a, arr); }
      arr.push(r);
    }
  }

  const sim = (ticks, tsMs) => {
    const rows = ticks
      .map((r, i) => ({ _t: new Date(r.block_time).getTime(), _i: i, _p: num(r.price_bnb), _o: r.price_outlier, _bnb: num(r.bnb_amount) }))
      .sort((a, b) => a._t - b._t || a._i - b._i);
    const rel = rows.filter(r => !r._o && r._p > 0);
    const at = rel.find(r => r._t >= tsMs);
    if (!at) return null;
    const after = rows.filter(r => r._t >= at._t);
    let lastSub = at._t, lastPrice = at._p, exit = null, exitWhy = null;
    for (const r of after) {
      if (r._t - lastSub > STALL_MS) { exit = lastPrice; exitWhy = 'stall'; break; } // 断流 50s：按断流前曲线价出
      if (!r._o && r._p > 0) lastPrice = r._p;
      if (r._bnb >= SUB_BNB) lastSub = r._t;
    }
    if (exit === null) { exit = lastPrice; exitWhy = 'end'; }
    return { pnl: +((exit / at._p - 1) * 100).toFixed(1), why: exitWhy, holdMin: +((after[after.length - 1]._t - at._t) / 60000).toFixed(1) };
  };

  const res = [];
  for (const c of chase) {
    const ticks = byToken.get(c.addr) || [];
    const s = sim(ticks, c.ts);
    if (!s) continue;
    const A = asof.get(c.addr), tf = tfMap.get(c.addr) || {}, SC = sellcal.get(c.addr) || {};
    res.push({
      addr: c.addr, sym: A ? (A.sym || '') : '', golden: A ? A.golden : false,
      pnl: s.pnl, why: s.why, holdMin: s.holdMin,
      dom: A && A.a.share >= 60,
      chg30ok: typeof tf.chg30Pct === 'number' && tf.chg30Pct >= -10,
      actNetOk: typeof tf.actNetBnb === 'number' && tf.actNetBnb >= -0.1,
      bigSellDom: SC.allBigSellerShare !== null && SC.allBigSellerShare >= 60,
      old27: undefined,
    });
  }
  const dom27 = ['0xf38f48cf', '0x19c11462', '0xece9cd98', '0xa5f7632b', '0x2bb2c57a', '0x8565b6d8', '0x406f7005', '0x3b2748df', '0x6ef09845', '0xa9e57581', '0xba6a027e', '0x57213b99', '0xfbacdfc2', '0x2c4bf870', '0x271ac8f2', '0x91289fc4', '0x36c2b853', '0x7bb31ab1', '0x04485985', '0xf3dc364c', '0x7598119d', '0x29351d04', '0xed82cdf5', '0x7ad54f15', '0xa1802ef2', '0x1dbedefa', '0xa0b08ec7'];
  for (const r of res) r.old27 = dom27.some(p => r.addr.startsWith(p));

  const summ = (list, label) => {
    if (!list.length) { console.log(`${label}: 无样本`); return; }
    const pnls = list.map(r => r.pnl);
    const net = pnls.reduce((s, v) => s + v, 0);
    const win = pnls.filter(v => v > 0).length;
    const netBnb = +(POS_BNB * net / 100).toFixed(4);
    const worst = Math.min(...pnls), best = Math.max(...pnls);
    const stallN = list.filter(r => r.why === 'stall').length;
    const exGolden = list.filter(r => !r.golden);
    const netExG = exGolden.length ? +([exGolden.map(r => r.pnl).reduce((s, v) => s + v, 0)] / 1).toFixed(1) : 0;
    console.log(`${label}: n=${list.length} | 净=${net >= 0 ? '+' : ''}${(net / list.length).toFixed(1)}%/票 组净 ${net.toFixed(1)}%≈${netBnb}B | 胜率 ${(win / list.length * 100).toFixed(0)}% | 最好 ${best}% 最差 ${worst}% | stall出 ${stallN} | 剔金狗净 ${netExG >= 0 ? '+' : ''}${netExG}（n=${exGolden.length}）`);
  };
  console.log('── 组级 EV（0.2B/票，stallClose 50s 出口）──');
  summ(res.filter(r => r.old27), 'A 27形状(旧出货腿)   ');
  summ(res.filter(r => r.dom && r.chg30ok && r.actNetOk && r.bigSellDom), 'B dom∧活态∧大卖占≥60%  ');
  summ(res.filter(r => r.dom && r.chg30ok && r.actNetOk), 'C dom∧活态(无卖家腿)  ');
  summ(res.filter(r => r.dom), 'D dom_only            ');
  summ(res, 'E 全部 141            ');
  console.log('\n── A 组逐票（按 pnl 排序）──');
  for (const r of res.filter(r => r.old27).sort((a, b) => b.pnl - a.pnl)) {
    console.log(`${r.addr.slice(0, 10)}… ${String(r.sym).padEnd(8)} pnl=${String(r.pnl).padStart(7)}% ${r.why === 'stall' ? '断流' : '末价'}@${r.holdMin}m 大卖占=${(sellcal.get(r.addr) || {}).allBigSellerShare} ${r.golden ? '狗' : ''}`);
  }
  console.log('\n── B 组逐票 ──');
  for (const r of res.filter(r => r.dom && r.chg30ok && r.actNetOk && r.bigSellDom).sort((a, b) => b.pnl - a.pnl)) {
    console.log(`${r.addr.slice(0, 10)}… ${String(r.sym).padEnd(8)} pnl=${String(r.pnl).padStart(7)}% ${r.why === 'stall' ? '断流' : '末价'}@${r.holdMin}m ${r.golden ? '狗' : ''}`);
  }
  require('fs').writeFileSync('/tmp/a79e-ev-out.json', JSON.stringify(res, null, 1));
  console.log('\n明细已落 /tmp/a79e-ev-out.json');
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
