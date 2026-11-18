#!/usr/bin/env node
// ============================================================================
// 一次性（182 跑）：BP87 对拍——bt-v147「幕后」0x6957ace8…7777 首信号锚
// （2026-10-12 09:33:43）BP69 题面+BP87 快照（followBuy 剔同块闪进闪出）真调
// Jev 三连。期望：dumpBlockFollowBuyBnb 0.4634→0.1443（10.7%<30% 参考线）→
// 贴锚砸盘臂判「无人接」→ entry_shape=malicious_dump 综 poor·entry_gate 拒。
// 注意：真调落 buy_point_analyses 表（token 级观测资产留痕）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const TOKEN = '0x6957ace830287a43996bc218fec5c025b17f7777';
const ANCHOR = '2026-10-12T09:33:43';

async function main() {
  const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');
  const svc = new BuyPointCheckService(
    { enabled: true, timeoutMs: 60000, gate: { awaitMs: 60000 }, minTicks: 8, settleDelayMs: 1 },
    { info() {}, warn() {}, error() {} },
    {},
  );
  const META = { symbol: '幕后', name: '幕后', platform: 'flap' };
  const anchorMs = Date.parse(ANCHOR);
  let hit = 0;
  for (let i = 1; i <= 3; i++) {
    const r = await svc.gateBuyPoint(TOKEN, META, {}, { anchorMs });
    const a = r.assessment || {};
    const es = (r.dimensions || {}).entry_shape || {};
    const an = r.anchors || {};
    console.log(`#${i} → ${r.status} 综=${a.bucket}(${a.rule}) p=${a.prob != null ? Number(a.prob).toFixed(2) : '?'} `
      + `entry=${es.bucket}(${es.prob != null ? Number(es.prob).toFixed(2) : '?'}) `
      + `followBuy=${an.dumpBlockFollowBuyBnb ?? '?'} secToAnchor=${an.dumpBlockSecToAnchor ?? '?'} `
      + `dumpBnb=${an.dumpBlockBnb ?? '?'} v=${r.model || r.version || '?'} ticks=${r.anchorTickCount ?? '?'}`);
    if (es.bucket === 'malicious_dump') hit++;
  }
  console.log(`\n[汇总] malicious_dump ${hit}/3`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
