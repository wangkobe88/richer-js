#!/usr/bin/env node
// ============================================================================
// 一次性（182 跑）：BP44 盘面重置判序对拍——0x28ad2c7d「让我们回到过去」
// bt-s01 三信号点（07:16:15/18/21）BP44 题面真调 Jev 重析，期望 market_pattern
// =restart 稳定（BP43 判 early_sniper_decay poor 0.79/0.83 三拒）。每点三连跑。
// 注意：真调落 buy_point_analyses 表（token 级观测资产，版本=BP44 留痕）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const BT = '6a02e983-9a6f-48d3-b47e-aa796bef4c18';
const TOKEN = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');

  // 信号点锚（bt-s01 该 token 全 BUY 信号 created_at，取最后三个=P3/P4/P5）
  const { data: sigs, error } = await db.from('strategy_signals')
    .select('id,created_at,metadata')
    .eq('experiment_id', BT).eq('signal_type', 'BUY').eq('token_address', TOKEN)
    .order('created_at');
  if (error) throw new Error(error.message);
  const pts = sigs.slice(-3);
  console.log(`[锚] bt-s01 BUY 信号共 ${sigs.length} 行，对拍后三行:`);
  const oldBp = pts.map((s) => {
    const b = (s.metadata || {}).buyPoint || {};
    const a = b.assessment || {};
    return `${s.created_at.slice(11, 19)} BP43=${a.bucket}(${a.rule}) p=${a.prob ?? '?'} pattern=${(b.dimensions || {}).market_pattern?.bucket ?? '?'}`;
  });
  oldBp.forEach((l) => console.log('   ' + l));

  const svc = new BuyPointCheckService(
    { enabled: true, timeoutMs: 60000, gate: { awaitMs: 60000 }, minTicks: 8, settleDelayMs: 1 },
    { info() {}, warn() {}, error() {} },
    {},
  );
  const META = { symbol: 'HUILAO', name: '让我们回到过去', platform: 'fourmeme' };

  let restartN = 0, totN = 0;
  for (const s of pts) {
    const anchorMs = Date.parse(s.created_at);
    for (let i = 1; i <= 3; i++) {
      const r = await svc.gateBuyPoint(TOKEN, META, {}, { anchorMs });
      totN++;
      const a = r.assessment || {};
      const pat = (r.dimensions || {}).market_pattern || {};
      const patProb = pat.prob != null ? Number(pat.prob).toFixed(2) : '?';
      const isRestart = pat.bucket === 'restart';
      if (isRestart) restartN++;
      console.log(`${s.created_at.slice(11, 19)}#${i} → ${r.status} 综=${a.bucket}(${a.rule}) p=${a.prob != null ? Number(a.prob).toFixed(2) : '?'} pattern=${pat.bucket}(${patProb}) ${isRestart ? '✅' : '❌'} `
        + `v=${r.model || r.version || '?'} anchorTicks=${r.anchorTickCount ?? '?'} minVsLaunch=${(r.anchors || {}).minVsLaunchPct ?? '?'} curVsLaunch=${(r.anchors || {}).currentVsLaunchPct ?? '?'}`);
    }
  }
  console.log(`\n[汇总] restart ${restartN}/${totN}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
