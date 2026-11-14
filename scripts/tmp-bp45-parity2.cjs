#!/usr/bin/env node
// ============================================================================
// 一次性（182 跑）：BP45 定向对拍 第二段
// A' bt-s02 0x28ad2c7d 07:15:45（区内 −9.9%，旧判定 poor·chip_gate famous 拒）
//    —— 主对拍点：预期 famous 臂退出 chip_gate → 综合不再 chip_gate 拒
// C' v81（11-07 时段）famous dominant 第一波票 —— 预期照拦（再起域外/null）
// （B 07:16:21 反例已达成：restart 0.52/0.62/0.53 三连+pattern_gate 位置门拒）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const BT2 = '19ab9c37-771c-483e-93ad-7137550c44d9';
const V81 = 'a5b43ad1-78b0-450e-bd9d-3dde74fbf713';
const TOKEN = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');

  // C' 候选：v81 famous dominant 拦截票
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await db.from('strategy_signals')
      .select('token_address,created_at,metadata')
      .eq('experiment_id', V81).eq('signal_type', 'BUY')
      .range(from, from + 999).order('created_at');
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  const hit = {};
  for (const s of all) {
    const b = (s.metadata || {}).buyPoint || {};
    const fam = (b.dimensions || {}).famous_domination || {};
    const a = b.assessment || {};
    if ((fam.bucket === 'dominant' || fam.bucket === 'heavy') && a.rule === 'chip_gate') {
      const k = s.token_address;
      if (!hit[k]) hit[k] = { n: 0, first: s.created_at, lastAt: null };
      hit[k].n++;
      if (s.created_at < hit[k].first) hit[k].first = s.created_at;
      if (s.created_at > (hit[k].lastAt || '')) hit[k].lastAt = s.created_at;
    }
  }
  const cands = Object.entries(hit).sort((x, y) => y[1].n - x[1].n).slice(0, 5);
  console.log(`[v81] BUY=${all.length} famous chip_gate 拦截票:`);
  for (const [tok, v] of cands) console.log(`  ${tok} n=${v.n} first=${v.first.slice(0, 19)}`);

  // A' 锚：bt-s02 07:15:45 行
  const { data: sigs, error: e2 } = await db.from('strategy_signals')
    .select('created_at').eq('experiment_id', BT2).eq('signal_type', 'BUY')
    .eq('token_address', TOKEN).order('created_at');
  if (e2) throw new Error(e2.message);
  const aRow = sigs.find((s) => s.created_at.slice(11, 19) === '07:15:45');
  if (!aRow) throw new Error('07:15:45 信号行未找到');

  const svc = new BuyPointCheckService(
    { enabled: true, timeoutMs: 60000, gate: { awaitMs: 60000 }, minTicks: 8, settleDelayMs: 1 },
    { info() {}, warn() {}, error() {} },
    {},
  );

  async function run(token, meta, anchorMs, label, n) {
    for (let i = 1; i <= n; i++) {
      const r = await svc.gateBuyPoint(token, meta, {}, { anchorMs });
      const a = r.assessment || {};
      const pat = (r.dimensions || {}).market_pattern || {};
      const fam = (r.dimensions || {}).famous_domination || {};
      const an = r.anchors || {};
      console.log(`${label}#${i} → ${r.status} 综=${a.bucket}(${a.rule}) p=${a.prob != null ? Number(a.prob).toFixed(2) : '?'} pattern=${pat.bucket}(${pat.prob != null ? Number(pat.prob).toFixed(2) : '?'}) famous=${fam.bucket}(${fam.prob != null ? Number(fam.prob).toFixed(2) : '?'}) ticks=${r.anchorTickCount ?? '?'} minVs=${an.minVsLaunchPct ?? '?'} curVs=${an.currentVsLaunchPct ?? '?'}`);
    }
  }

  await run(TOKEN, { symbol: 'HUILAO', name: '让我们回到过去', platform: 'fourmeme' }, Date.parse(aRow.created_at), `A' 07:15:45`, 3);
  if (cands.length) {
    const [tok, v] = cands[0];
    await run(tok, { symbol: 'FAMT1', name: 'famous-first-wave', platform: 'fourmeme' }, Date.parse(v.lastAt || v.first), `C' ${tok.slice(0, 10)} ${(v.lastAt || v.first).slice(11, 19)}`, 2);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
