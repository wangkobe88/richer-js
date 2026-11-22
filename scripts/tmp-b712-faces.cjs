#!/usr/bin/env node
// 0xb712 GWC 案两提案跨窗面测量（182 跑，后台，只读）：
// ① act 族拒绝行 × 锚前 ATH 档（火过没有）× 前向结局 —— 「act 只该管火过后的死盘」
// ② tail_dip_knife 拒绝行 × 锚前 30s 跌的量（卖额/笔数）× 前向结局 —— 「量极少的跌不是从高点下来的」
// 选择=execution_reason 前缀匹配 ∪ metadata.factorCheck.arms 交集；每票取最早锚。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');

const WINS = [
  '9e9163de-a677-4d39-9c33-9ec9df05e400',
  'ce102e94-293c-4f8f-af98-cd06f4b0e98c',
  'dddbe79e-480a-402a-aa35-85a72d2f591e',
];
const ACT_ARM = new Set(['act_low', 'act_ultra', 'act_tail_flat']);
const TD_ARM = 'tail_dip_knife';
const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier';
const CAP = 3000;
const FOUR_FLOOR = 4496173469e-18, FLAP_FLOOR = 5.546e-9;

const isActReason = r => typeof r === 'string' && (r.startsWith('factor_gate_act_') || r === 'act_front_low' || r === 'act_front_ultra');
const isTdReason = r => typeof r === 'string' && r.startsWith('factor_gate_tail_dip_knife');

(async () => {
  const sb = dbManager.getClient();

  // 窗口名
  const { data: exps } = await sb.from('experiments').select('id,name').in('id', WINS);
  const nameOf = Object.fromEntries((exps || []).map(e => [e.id, e.name]));
  console.log('窗口:', WINS.map(w => `${w.slice(0, 8)}=${nameOf[w] || '?'}`).join(' | '));

  // 1. 收集合格信号行
  const byToken = new Map(); // addr -> {win, t, reason, arms, earliest}
  let nRows = 0;
  for (const exp of WINS) {
    let from = 0;
    for (;;) {
      const { data, error } = await sb.from('strategy_signals')
        .select('token_address, created_at, metadata').eq('experiment_id', exp).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).range(from, from + 499);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      for (const s of data) {
        const m = s.metadata || {};
        const reason = m.execution_reason || '';
        const arms = (m.factorCheck && Array.isArray(m.factorCheck.arms)) ? m.factorCheck.arms : [];
        const actHit = isActReason(reason) || arms.some(a => ACT_ARM.has(a));
        const tdHit = isTdReason(reason) || arms.includes(TD_ARM);
        if (!actHit && !tdHit) continue;
        nRows++;
        const t = new Date(s.created_at).getTime();
        const e = byToken.get(s.token_address);
        if (!e || t < e.t) byToken.set(s.token_address, { win: exp, t, reason, arms, actHit, tdHit });
        else { e.actHit = e.actHit || actHit; e.tdHit = e.tdHit || tdHit; }
      }
      if (data.length < 500) break;
      from += 500;
    }
  }
  console.log(`合格行 ${nRows}，去重票 ${byToken.size}`);

  // 2. 逐票装载 ticks + 计算锚画像
  const platCache = new Map();
  async function loadPlatform(addr) {
    if (platCache.has(addr)) return platCache.get(addr);
    const { data } = await sb.from('wss_events').select('platform,block_time')
      .eq('kind', 'token_create').eq('token_address', addr).order('id', { ascending: true }).limit(1);
    const p = data && data[0] ? { platform: data[0].platform, created: new Date(data[0].block_time).getTime() } : { platform: null, created: null };
    platCache.set(addr, p); return p;
  }
  async function loadTicks(addr) {
    const rows = []; let f = 0;
    while (f <= CAP) {
      const { data, error } = await sb.from('wss_price_ticks').select(TICK_COLS).eq('token_address', addr)
        .order('id', { ascending: true }).range(f, f + 999);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      rows.push(...data); if (data.length < 1000) break; f += 1000;
    }
    return rows.map(r => ({
      bt: new Date(r.block_time).getTime(), bn: r.block_number, li: r.log_index,
      side: String(r.trade_type).toLowerCase(), bnb: Number(r.bnb_amount || 0),
      px: Number(r.price_bnb || 0), out: !!r.price_outlier,
    })).sort((a, b) => a.bn - b.bn || a.li - b.li);
  }

  const out = [];
  let done = 0;
  for (const [addr, e0] of byToken) {
    const { platform, created } = await loadPlatform(addr);
    const all = await loadTicks(addr);
    const t0 = e0.t;
    const pre = all.filter(r => r.bt <= t0), fwd = all.filter(r => r.bt > t0);
    const rel = pre.filter(r => !r.out && r.px > 0);
    const rec = { addr, win: e0.win.slice(0, 8), t: new Date(t0).toISOString(), reason: e0.reason, arms: e0.arms,
      actHit: e0.actHit, tdHit: e0.tdHit, platform, ageSec: created ? Math.round((t0 - created) / 1000) : null,
      preN: pre.length };
    if (rel.length) {
      const lastPx = rel[rel.length - 1].px;
      const minPx = Math.min(...rel.map(r => r.px)), maxPx = Math.max(...rel.map(r => r.px));
      const floor = platform === 'fourmeme' ? FOUR_FLOOR : FLAP_FLOOR;
      const launch = Math.min(floor, minPx);
      let tAth = null; for (const r of rel) if (r.px === maxPx) tAth = r.bt; // 最早触顶时刻
      rec.athPct = +(((maxPx / launch) - 1) * 100).toFixed(1);
      rec.curVsPct = +(((lastPx / launch) - 1) * 100).toFixed(1);
      rec.secSinceAth = tAth ? Math.round((t0 - tAth) / 1000) : null;
      // 锚前 30s「跌的量」
      const w30 = pre.filter(r => r.bt > t0 - 30000);
      rec.sellBnb30 = +w30.filter(r => r.side === 'sell').reduce((s, r) => s + r.bnb, 0).toFixed(3);
      rec.sellN30 = w30.filter(r => r.side === 'sell').length;
      rec.buyBnb30 = +w30.filter(r => r.side === 'buy').reduce((s, r) => s + r.bnb, 0).toFixed(3);
      rec.tickN30 = w30.length;
      // 复活锚：180s 内最大单笔买 + 距锚
      const w180 = pre.filter(r => r.bt > t0 - 180000 && r.side === 'buy');
      let maxSingle = 0, tBig = null;
      for (const r of w180) if (r.bnb > maxSingle) { maxSingle = r.bnb; tBig = r.bt; }
      rec.maxBuy180 = +maxSingle.toFixed(3);
      rec.secSinceBigBuy = tBig ? Math.round((t0 - tBig) / 1000) : null;
      // 锚前全史吞吐
      rec.totalBnb = +pre.reduce((s, r) => s + r.bnb, 0).toFixed(2);
      // 前向
      let rPeak = 0, r30 = 0, rMin = 0;
      for (const r of fwd) {
        if (!r.px || r.out) continue;
        const g = (r.px / lastPx - 1) * 100;
        if (g > rPeak) rPeak = g;
        if (g < rMin) rMin = g;
        if (r.bt <= t0 + 1800e3 && g > r30) r30 = g;
      }
      Object.assign(rec, { rPeak: +rPeak.toFixed(1), r30: +r30.toFixed(1), rMin: +rMin.toFixed(1), fwdN: fwd.length });
    } else { rec.rPeak = null; }
    out.push(rec);
    if (++done % 100 === 0) { console.log(`…${done}/${byToken.size}`); fs.writeFileSync('/tmp/b712-faces.json', JSON.stringify(out)); }
  }
  fs.writeFileSync('/tmp/b712-faces.json', JSON.stringify(out));

  // 3. 矩阵
  const bucket = r => r.rPeak == null ? '无锚' : r.rPeak >= 100 ? '≥100%' : r.rPeak >= 50 ? '50-100' : r.rPeak >= 10 ? '10-50' : '<10%';
  const B = ['≥100%', '50-100', '10-50', '<10%', '无锚'];
  const table = (title, rows, keyFn) => {
    console.log(`\n=== ${title}（${rows.length} 票）===`);
    const groups = new Map();
    for (const r of rows) { const k = keyFn(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    console.log('档'.padEnd(24), ...B.map(b => b.padStart(6)), '合计'.padStart(6), '  命中≥100%票');
    for (const [k, sub] of groups) {
      const c = b => sub.filter(r => bucket(r) === b).length;
      const hot = sub.filter(r => r.rPeak >= 100).map(r => r.addr.slice(0, 10)).slice(0, 6).join(',');
      console.log(k.padEnd(24), ...B.map(b => String(c(b)).padStart(6)), String(sub.length).padStart(6), '  ' + hot);
    }
  };
  const act = out.filter(r => r.actHit);
  const td = out.filter(r => r.tdHit);
  table('面① act 族拒绝 × 锚前 ATH 档', act, r => {
    const a = r.athPct; if (a == null) return '无锚价';
    return a < 40 ? 'ATH<40（从未火过）' : a < 80 ? 'ATH 40-80' : a < 100 ? 'ATH 80-100' : 'ATH≥100（走完一轮）';
  });
  table('面①补 act×复活锚（180s 内单笔买≥0.2B）', act, r => r.maxBuy180 != null && r.maxBuy180 >= 0.2 ? '有复活买' : '无复活买');
  table('面①补 act 纯净面（arms 仅 act，无伴随臂）', act.filter(r => !r.arms.some(a => !ACT_ARM.has(a))), r => {
    const a = r.athPct; if (a == null) return '无锚价';
    return a < 40 ? 'ATH<40' : a < 80 ? 'ATH 40-80' : a < 100 ? 'ATH 80-100' : 'ATH≥100';
  });
  table('面② tail_dip_knife × 锚前30s 卖额档', td, r => {
    const s = r.sellBnb30; if (s == null) return '无锚价';
    return s < 0.15 ? '卖<0.15B（尘埃漂移）' : s < 0.3 ? '卖0.15-0.3' : s < 0.5 ? '卖0.3-0.5' : '卖≥0.5B（有量崩塌）';
  });
  table('面②补 tail_dip × 30s 卖笔数', td, r => {
    const n = r.sellN30; if (n == null) return '无锚价';
    return n <= 4 ? '卖≤4笔' : n <= 7 ? '卖5-7笔' : '卖≥8笔';
  });
  table('面②补 tail_dip × ATH距今', td, r => {
    const s = r.secSinceAth; if (s == null) return '无锚价';
    return s < 120 ? 'ATH<2min（新鲜顶）' : s < 600 ? 'ATH 2-10min' : 'ATH≥10min（旧顶）';
  });
  // GWC 对照行
  console.log('\nGWC 对照:', JSON.stringify(out.find(r => r.addr.startsWith('0xb71209')) || null));
  console.log('明细 /tmp/b712-faces.json');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
