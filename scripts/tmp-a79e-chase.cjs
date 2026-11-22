#!/usr/bin/env node
/**
 * 一次性研究脚本 round5（182 跑）：修正 defer 档单位 bug 后验证「追不上」
 * FP32 命中票：信号时刻价 pSig → 推迟解锁（首笔可靠买+tier 秒，tier=≥1B→60s / ≥0.79B→45s）价 pUnlock
 * 输出：unlock/pSig 通胀比分布（追不上的程度）、解锁后剩余 max60、两金狗逐笔时间线（UTC+8 对齐信号页）。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400';
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
const fmt8 = (ms) => new Date(ms + 8 * 3600_000).toISOString().replace('T', ' ').slice(5, 19);

(async () => {
  const db = dbManager.getClient();
  const sigs = await fetchAll(db.from('strategy_signals')
    .select('token_address, signal_type, executed, created_at, metadata').eq('experiment_id', EXP_ID));
  const hitTime = new Map();
  for (const s of sigs) {
    const a = (s.token_address || '').toLowerCase(); if (!a) continue;
    const gates = s.metadata && s.metadata.factorCheck && s.metadata.factorCheck.gates;
    if (Array.isArray(gates) && gates.some(g => g.id === 'big_buy_defer' && g.hit)) {
      const t = new Date(s.created_at).getTime();
      if (!hitTime.has(a) || t < hitTime.get(a)) hitTime.set(a, t);
    }
  }
  const hitAddrs = [...hitTime.keys()];
  const asofRows = JSON.parse(require('fs').readFileSync('/tmp/a79e-asof-out.json', 'utf8'));
  const comp = new Map(asofRows.filter(r => r.a).map(r => [r.addr, r.a]));

  const TICK_COLS = 'token_address, trade_type, price_bnb, price_outlier, block_number, log_index, block_time';
  const byToken = new Map();
  for (let i = 0; i < hitAddrs.length; i += 50) {
    const rows = await fetchAll(db.from('wss_price_ticks').select(TICK_COLS)
      .in('token_address', hitAddrs.slice(i, i + 50)).gte('block_time', WIN_START).lte('block_time', SPILL_END));
    for (const r of rows) {
      const a = r.token_address.toLowerCase();
      let arr = byToken.get(a); if (!arr) { arr = []; byToken.set(a, arr); }
      arr.push(r);
    }
  }

  const res = [];
  for (const addr of hitAddrs) {
    const a = comp.get(addr); if (!a) continue;
    const ticks = byToken.get(addr) || [];
    const rel = ticks
      .map((r, i) => ({ _t: new Date(r.block_time).getTime(), _i: i, _p: num(r.price_bnb), _o: r.price_outlier, _ty: r.trade_type }))
      .filter(r => !r._o && r._p > 0)
      .sort((x, y) => x._t - y._t || x._i - y._i);
    if (!rel.length) continue;
    const t0 = rel[0]._t;
    const tsMs = hitTime.get(addr);
    const pSig = rel.find(r => r._t >= tsMs);
    if (!pSig) continue;
    // 修正后的档位：秒
    const tierSec = a.bigBuyBnb >= 1 ? 60 : 45;
    const firstRelBuy = rel.find(r => r._ty === 'buy') || rel[0];
    const unlockMs = firstRelBuy._t + tierSec * 1000;
    const pUnlock = rel.find(r => r._t >= unlockMs);
    const chase = pUnlock ? pUnlock._p / pSig._p : null;
    const maxAfterUnlock = pUnlock
      ? Math.max(...rel.filter(r => r._t >= pUnlock._t && r._t <= pUnlock._t + 3_600_000).map(r => r._p))
      : null;
    res.push({
      addr, sym: (asofRows.find(r => r.addr === addr) || {}).sym || '',
      tierSec, chase: chase === null ? null : +(chase * 100 - 100).toFixed(1),
      gainAfterUnlock: pUnlock && maxAfterUnlock ? +((maxAfterUnlock / pUnlock._p - 1) * 100).toFixed(1) : null,
      gainFromSig60: +((Math.max(...rel.filter(r => r._t >= tsMs && r._t <= tsMs + 3_600_000).map(r => r._p)) / pSig._p - 1) * 100).toFixed(1),
      _t0: t0, _ts: tsMs, _unlock: unlockMs, _pSig: pSig._p, _pUnlock: pUnlock ? pUnlock._p : null,
    });
  }

  const med = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const ch = res.map(r => r.chase).filter(v => v !== null);
  console.log(`样本 ${res.length}`);
  console.log(`推迟解锁价 vs 信号价通胀：中位 ${med(ch).toFixed(0)}% | >+50% ${ch.filter(v => v > 50).length} 票 | >+100% ${ch.filter(v => v > 100).length} 票 | 解锁时已无成交(追不上/死盘) ${res.filter(r => r.chase === null).length} 票`);
  const gu = res.map(r => r.gainAfterUnlock).filter(v => v !== null);
  console.log(`解锁后剩余 max60：中位 ${med(gu).toFixed(0)}% ≥100% ${(gu.filter(v => v >= 100).length / gu.length * 100).toFixed(0)}%`);

  console.log('\n── 两金狗逐笔时间线（UTC+8）──');
  for (const p of ['0xf38f48cf', '0x898af40e']) {
    const r = res.find(x => x.addr.startsWith(p));
    if (!r) continue;
    console.log(`${r.sym} ${r.addr}`);
    console.log(`  首笔 ${fmt8(r._t0)} | 信号 ${fmt8(r._ts)}（价 ${r._pSig.toExponential(3)}）| 解锁 ${fmt8(r._unlock)} tier=${r.tierSec}s（价 ${r._pUnlock ? r._pUnlock.toExponential(3) : '无成交'}）`);
    console.log(`  解锁价较信号价 ${(r.chase ?? 0) > 0 ? '+' : ''}${r.chase}% | 解锁后剩余 max60 ${r.gainAfterUnlock}% | 信号价直买 max60 ${r.gainFromSig60}%`);
  }
  // 追不上但信号价直买仍肥的票（豁免价值面）
  const juicy = res.filter(r => r.gainFromSig60 >= 200);
  console.log(`\n信号价直买 max60≥200% 的票 ${juicy.length} 张：`);
  for (const r of juicy) console.log(`  ${r.addr.slice(0, 10)}… ${String(r.sym).padEnd(8)} 解锁通胀 ${r.chase ?? '无成交'}% 解锁后剩余 ${r.gainAfterUnlock ?? '·'}% 信号价直买 ${r.gainFromSig60}%`);
  require('fs').writeFileSync('/tmp/a79e-chase-out.json', JSON.stringify(res.map(({ _t0, _ts, _unlock, _pSig, _pUnlock, ...rest }) => ({ ...rest, t0: _t0, ts: _ts, unlock: _unlock })), null, 1));
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
