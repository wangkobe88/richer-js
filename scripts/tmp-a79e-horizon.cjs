#!/usr/bin/env node
/**
 * 一次性研究脚本（182 跑）：窗口拉长检验（用户假设：「庄建仓后晚拉」不多，拉盘晚=另一形态）
 * 对 FP32 命中 141 票：信号价起算 max60/max180/max360 + 峰值出现时刻（距信号分钟）。
 * 关注：27 形状票里 max360 与 max60 的排序变化/晚拉票特征。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const WIN_START = '2026-10-02T23:50:00.000Z';
const SPILL_END = '2026-10-05T06:00:00.000Z';
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
  const addrs = chase.map(r => r.addr);

  const byToken = new Map();
  for (let i = 0; i < addrs.length; i += 50) {
    const rows = await fetchAll(db.from('wss_price_ticks')
      .select('token_address, price_bnb, price_outlier, block_number, log_index, block_time')
      .in('token_address', addrs.slice(i, i + 50)).gte('block_time', WIN_START).lte('block_time', SPILL_END));
    for (const r of rows) {
      const a = r.token_address.toLowerCase();
      let arr = byToken.get(a); if (!arr) { arr = []; byToken.set(a, arr); }
      arr.push(r);
    }
  }

  const res = [];
  for (const c of chase) {
    const ticks = byToken.get(c.addr) || [];
    const rel = ticks
      .map((r, i) => ({ _t: new Date(r.block_time).getTime(), _i: i, _p: num(r.price_bnb), _o: r.price_outlier }))
      .filter(r => !r._o && r._p > 0)
      .sort((a, b) => a._t - b._t || a._i - b._i);
    const at = rel.find(r => r._t >= c.ts);
    if (!at) continue;
    const seg = rel.filter(r => r._t >= at._t);
    const mx = (winMs) => {
      const s = seg.filter(r => r._t <= at._t + winMs);
      if (!s.length) return null;
      const best = s.reduce((m, r) => (r._p > m._p ? r : m), s[0]);
      return { pct: +((best._p / at._p - 1) * 100).toFixed(1), atMin: +((best._t - at._t) / 60000).toFixed(1) };
    };
    const m60 = mx(3_600_000), m180 = mx(10_800_000), m360 = mx(21_600_000);
    const A = asof.get(c.addr);
    res.push({
      addr: c.addr, sym: A ? (A.sym || '') : '', golden: A ? A.golden : false,
      m60, m180, m360,
      lastMin: +((seg[seg.length - 1]._t - at._t) / 60000).toFixed(0), // 信号后还有多长的成交
    });
  }

  const dom27 = ['0xf38f48cf', '0x19c11462', '0xece9cd98', '0xa5f7632b', '0x2bb2c57a', '0x8565b6d8', '0x406f7005', '0x3b2748df', '0x6ef09845', '0xa9e57581', '0xba6a027e', '0x57213b99', '0xfbacdfc2', '0x2c4bf870', '0x271ac8f2', '0x91289fc4', '0x36c2b853', '0x7bb31ab1', '0x04485985', '0xf3dc364c', '0x7598119d', '0x29351d04', '0xed82cdf5', '0x7ad54f15', '0xa1802ef2', '0x1dbedefa', '0xa0b08ec7'];
  const in27 = (r) => dom27.some(p => r.addr.startsWith(p));

  const med = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const summ = (list, key, label) => {
    const g = list.map(r => r[key] && r[key].pct).filter(v => v !== null && v !== undefined);
    if (!g.length) { console.log(`${label}: 无样本`); return; }
    console.log(`${label}: n=${list.length} 中位 ${med(g).toFixed(0)}% ≥100% ${g.filter(v => v >= 100).length} ≥300% ${g.filter(v => v >= 300).length}`);
  };
  console.log('── 27 形状票：三个窗口 ──');
  const s27 = res.filter(in27);
  summ(s27, 'm60', '形状 max60 ');
  summ(s27, 'm180', '形状 max180');
  summ(s27, 'm360', '形状 max360');
  console.log('\n── 全 141 ──');
  summ(res, 'm60', '全部 max60 ');
  summ(res, 'm180', '全部 max180');
  summ(res, 'm360', '全部 max360');

  // 晚拉票：max360 比 max60 多出 ≥100pt（且非数据截断：lastMin>60）
  console.log('\n── 晚拉票（max360 − max60 ≥ 100pt）──');
  for (const r of res.filter(r => r.m60 && r.m360 && r.m360.pct - r.m60.pct >= 100)) {
    console.log(`${r.addr.slice(0, 10)}… ${String(r.sym).padEnd(8)} ${in27(r) ? '形状' : '    '} max60=${r.m60.pct}→峰值@${r.m60.atMin}m  max180=${r.m180 ? r.m180.pct + '@' + r.m180.atMin + 'm' : '·'}  max360=${r.m360.pct}@${r.m360.atMin}m  信号后成交长${r.lastMin}m ${r.golden ? '狗' : ''}`);
  }
  // 27 张明细（按 max360 排序）
  console.log('\n── 27 形状票明细（按 max360）──');
  for (const r of s27.filter(r => r.m360).sort((a, b) => b.m360.pct - a.m360.pct)) {
    console.log(`${r.addr.slice(0, 10)}… ${String(r.sym).padEnd(8)} max60=${String(r.m60.pct).padStart(7)}@${String(r.m60.atMin).padStart(5)}m  max180=${r.m180 ? String(r.m180.pct).padStart(7) + '@' + r.m180.atMin + 'm' : '     ·'}  max360=${String(r.m360.pct).padStart(7)}@${r.m360.atMin}m  长${r.lastMin}m ${r.golden ? '狗' : ''}`);
  }
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
