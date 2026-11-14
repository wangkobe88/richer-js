#!/usr/bin/env node
// ============================================================================
// 一次性（182 跑）：BP45 定向对拍——⑧golden_point+famous 轴第一波域
// ①bt-s02 0x28ad2c7d 07:15:4x（区内 −9.9%）：预期⑧命中/至少 chip_gate 不再拒
// ②bt-s02 07:16:1x（拉离 +70%）：预期⑦restart 位置门拒照旧=反例
// ③BEM 0x75d5286d…7777 07:03:39（BP14 案锚，第一波 famous dominant）：预期照拦
// 注意：真调落 buy_point_analyses 表（token 级观测资产，版本=BP45 留痕）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const BT2 = '19ab9c37-771c-483e-93ad-7137550c44d9';
const TOKEN = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';
const BEM = '0x75d5286d3ac478334fe098f015624486d7a77777';

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');

  const { data: sigs, error } = await db.from('strategy_signals')
    .select('id,created_at,metadata')
    .eq('experiment_id', BT2).eq('signal_type', 'BUY').eq('token_address', TOKEN)
    .order('created_at');
  if (error) throw new Error(error.message);
  console.log(`[bt-s02] BUY 信号共 ${sigs.length} 行（旧判定）:`);
  for (const s of sigs) {
    const b = (s.metadata || {}).buyPoint || {};
    const a = b.assessment || {};
    console.log(`  ${s.created_at.slice(11, 19)} BP44=${a.bucket}(${a.rule}) pattern=${(b.dimensions || {}).market_pattern?.bucket ?? '?'} cheat=${((s.metadata || {}).cheatCheck || {}).status ?? '?'}`);
  }

  const svc = new BuyPointCheckService(
    { enabled: true, timeoutMs: 60000, gate: { awaitMs: 60000 }, minTicks: 8, settleDelayMs: 1 },
    { info() {}, warn() {}, error() {} },
    {},
  );
  const META = { symbol: 'HUILAO', name: '让我们回到过去', platform: 'fourmeme' };
  const BEM_META = { symbol: 'BEM', name: 'BEM Miner', platform: 'fourmeme' };

  async function run(token, meta, anchorMs, label, n) {
    for (let i = 1; i <= n; i++) {
      const r = await svc.gateBuyPoint(token, meta, {}, { anchorMs });
      const a = r.assessment || {};
      const pat = (r.dimensions || {}).market_pattern || {};
      const fam = (r.dimensions || {}).famous_domination || {};
      const an = r.anchors || {};
      const q = r.questionVersion || r.version || (r.snapshotDigest || {}).questionVersion || '?';
      console.log(`${label}#${i} → ${r.status} 综=${a.bucket}(${a.rule}) p=${a.prob != null ? Number(a.prob).toFixed(2) : '?'} pattern=${pat.bucket}(${pat.prob != null ? Number(pat.prob).toFixed(2) : '?'}) famous=${fam.bucket}(${fam.prob != null ? Number(fam.prob).toFixed(2) : '?'}) v=${q} ticks=${r.anchorTickCount ?? '?'} minVs=${an.minVsLaunchPct ?? '?'} curVs=${an.currentVsLaunchPct ?? '?'}`);
    }
  }

  // ①② bt-s02 首末两信号（首=07:15:4x 区内、末=07:16:1x 拉离）
  const first = sigs[0], last = sigs[sigs.length - 1];
  await run(TOKEN, META, Date.parse(first.created_at), `A ${first.created_at.slice(11, 19)}`, 3);
  await run(TOKEN, META, Date.parse(last.created_at), `B ${last.created_at.slice(11, 19)}`, 3);
  // ③ BEM 第一波反例（BP14 案 T018 同锚）
  await run(BEM, BEM_META, Date.parse('2026-11-05T07:03:39+00:00'), 'C BEM 07:03:39', 2);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
