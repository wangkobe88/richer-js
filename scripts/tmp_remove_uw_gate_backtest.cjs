#!/usr/bin/env node
// ============================================================================
// 首窗人数门去除回测（2026-10-04，一次性脚本）：
//   基底 = 1d363b19 config（router 门已去上限形状：>= 50，无 < 80）；
//   唯一改动 = preBuyCheckCondition 删 ' AND earlyTradesUniqueWallets >= 15'
//   与 1d363b19 差分 = uw 门净效应（无上限形状下）；窗口同窗同源原样保留
// 用法：node scripts/tmp_remove_uw_gate_backtest.cjs [--commit]（默认 dry-run）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const BASE = '1d363b19-1f13-46dc-b000-9e602fea96be'; // 基底：去上限臂
const OLD = ' AND earlyTradesUniqueWallets >= 15';
const NEW = '';
const COMMIT = process.argv.slice(2).includes('--commit');

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();

  const base = await factory.load(BASE);
  if (!base) throw new Error('基底实验不存在: ' + BASE);
  const bt = base.config.backtest;
  if (!bt || !String(bt.sourceExperimentId || '').startsWith('6f92e2f9')) {
    throw new Error('基底 backtest 段异常: ' + JSON.stringify(bt));
  }

  const bCfg = JSON.parse(JSON.stringify(base.config));

  // ── 唯一改动：删首窗人数门子句 ──
  let hits = 0;
  for (const leg of (bCfg.strategiesConfig.buyStrategies || [])) {
    const c = leg.preBuyCheckCondition;
    if (typeof c !== 'string' || !c.includes(OLD)) continue;
    leg.preBuyCheckCondition = c.split(OLD).join(NEW);
    hits++;
    console.log('改写买腿:');
    console.log('  OLD:', c);
    console.log('  NEW:', leg.preBuyCheckCondition);
  }
  if (hits === 0) throw new Error('未找到含 uw 门的买腿');
  // 残留扫描只扫条件字段（description 是人读版本历史，v6 措辞保留 + 追加 v7 说明）
  const condFields = [];
  for (const leg of (bCfg.strategiesConfig.buyStrategies || [])) {
    for (const k of ['condition', 'narrativeCallCondition', 'preBuyCheckCondition', 'repeatBuyCheckCondition']) {
      if (typeof leg[k] === 'string') condFields.push(leg[k]);
    }
  }
  for (const leg of (bCfg.strategiesConfig.sellStrategies || [])) {
    if (typeof leg.condition === 'string') condFields.push(leg.condition);
  }
  if (condFields.some(c => c.includes('earlyTradesUniqueWallets'))) {
    throw new Error('条件字段仍有 earlyTradesUniqueWallets 残留');
  }
  // description 追加 v7 说明（不改 v6 历史措辞）
  const buyLeg = bCfg.strategiesConfig.buyStrategies[0];
  buyLeg.description = (buyLeg.description || '') +
    '；v7（2026-10-04，uw 门审计）：去热度门 earlyTradesUniqueWallets >= 15（与 1d363b19 差分 = uw 门净效应）';
  // 基底形状防线：必须已是去上限（无 < 80），router 门保持 >= 50
  if (!JSON.stringify(bCfg.strategiesConfig).includes('earlyTradesRouterPct >= 50')) {
    throw new Error('基底不含 router >= 50 门（形状漂移）');
  }

  bCfg.name = '回测-V2v6+hg55门-1003-1004实跑窗-去首窗人数门';
  bCfg.description = `在 1d363b19（router 已去上限）基础上唯一改动 = 删首窗人数门子句`
    + ` AND earlyTradesUniqueWallets >= 15（uw<15 冷清盘放行）；`
    + `窗口（${bt.startTime} → ${bt.endTime}）/config 其余与 1d363b19 完全同源，`
    + `差分 = uw 门净效应（无上限形状下）`;

  console.log('\nname:', bCfg.name);
  console.log('backtest:', JSON.stringify(bCfg.backtest));
  console.log('改动腿数:', hits);

  if (!COMMIT) { console.log('\n[dry-run] 未建；加 --commit 真建'); process.exit(0); }
  const b = await factory.createFromConfig(bCfg, 'backtest');
  console.log('\nBACKTEST_ID=' + b.id);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
