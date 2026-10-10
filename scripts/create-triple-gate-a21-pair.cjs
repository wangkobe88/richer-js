#!/usr/bin/env node
// ============================================================================
// 三门验证窗口 2——a21fa102 数据配对建臂脚本（2026-10-10，用户裁定「基于
// a21fa102 虚拟实验的数据再次测试一下（叙事数据需要重新跑）」）
//
// 窗口 = a21fa102（13-双平台虚拟-拱形v2+lag门-1008，running）采集时段：
//   startTime = a21fa102 created_at（10-08T14:37:30Z）
//   endTime   = 建臂时刻 − 2min（动态定死，两臂共用同一值保证窗口 bit-identical）
// 窗口内旧叙事缓存 55 行已失效（is_valid=false，J1.28/J1.29 混口径不可用）——
//   R0' 基底先跑：叙事全真调（Jev 秒级/票 + C58 视觉 + GMGN enrich）落缓存；
//   R1' 三门臂后跑：叙事缓存全命中（R0' 写的 J1.29 统一口径行）。
//   差分 R1'−R0' = 纯三门净效应（与窗口 1 方法论一致）。
//
// 两臂 config 同源于 7bee34f9（窗口 1 三门臂基底）：
//   R0' = 7bee34f9 config + 换 backtest.{sourceExperimentId,startTime,endTime}
//   R1' = R0' + 三门子句（与 create-triple-gate-arm.cjs 逐字相同）
// 跑序红线：严格串行 R0' → R1'（并发会让两臂叙事口径分叉——跨进程同 token
//   双跑 Jev 非确定性，差分被污染）。
//
// 用法（182）：node scripts/create-triple-gate-a21-pair.cjs [--commit]
//   默认 dry-run 打印配置；--commit 真建（一次建两臂）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const BASE_ID = '7bee34f9-e8bc-4539-b64c-3fbd2b27dd05';
const A21_ID = 'a21fa102-aa00-4d98-b0d9-65f4a2323459';
const START = '2026-10-08T14:37:30.000Z';

// 三门子句（与 create-triple-gate-arm.cjs 逐字相同，放行语义；AND/OR only）
const COND_APPEND = ' AND (holderTrendSlope < 0.55 OR holderTrendSlope IS NULL)';
const PREBUY_APPEND = ' AND strictSameNameTokenCount >= 3'
  + ' AND (gmgnRiskCovered == 0 OR gmgnBundlerWalletRatio >= 21.4)';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

/** strip 出可比 JSON（删 name/description，可选还原两条条件/backtest） */
const strip = (cfg, restore) => {
  const s = JSON.parse(JSON.stringify(cfg));
  delete s.name;
  delete s.description;
  if (restore) {
    if (restore.cond != null) s.strategiesConfig.buyStrategies[0].condition = restore.cond;
    if (restore.pre != null) s.strategiesConfig.buyStrategies[0].preBuyCheckCondition = restore.pre;
    if (restore.backtest != null) s.backtest = restore.backtest;
  }
  return JSON.stringify(s);
};

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE_ID);
  if (!base) throw new Error('基底实验不存在: ' + BASE_ID);

  const origCond = base.config.strategiesConfig.buyStrategies[0].condition;
  const origPre = base.config.strategiesConfig.buyStrategies[0].preBuyCheckCondition;
  const origBacktest = base.config.backtest;

  // endTime 建臂时刻定死（两臂共用；−2min 缓冲防窗口边界竞态）
  const END = new Date(Date.now() - 120000).toISOString();

  // R0' 基底：换窗口
  const r0 = JSON.parse(JSON.stringify(base.config));
  r0.backtest = { ...r0.backtest, sourceExperimentId: A21_ID, startTime: START, endTime: END };
  r0.name = '回测-三门窗口2-基底-a21fa102-1010';
  r0.description = '三门验证窗口 2 基底（无三门）：config 源 7bee34f9 仅换窗口 = '
    + 'a21fa102 采集时段（10-08 14:37 → ' + END + '）；窗口内旧叙事缓存 55 行已失效，'
    + '本臂叙事全真调（Jev J1.29 统一口径 + C58 视觉 + GMGN enrich 落缓存）；'
    + '跑完后再跑三门臂（缓存全命中）→ 差分 = 纯三门净效应窗口 2 外推验证';

  // R1' 三门臂：R0' + 三门子句
  const r1 = JSON.parse(JSON.stringify(r0));
  const buy1 = r1.strategiesConfig.buyStrategies[0];
  buy1.condition = origCond + COND_APPEND;
  buy1.preBuyCheckCondition = origPre + PREBUY_APPEND;
  r1.name = '回测-三门窗口2-三门臂-a21fa102-1010';
  r1.description = '三门验证窗口 2 三门臂（G1 低名 + G7 slope + G4 bundler，子句与窗口 1 '
    + '3e57ed75 逐字相同）：窗口/其余 config 与基底臂 bit-identical；叙事缓存读窗口 2 '
    + '基底臂真调落的 J1.29 行（跑序：必须等基底臂 completed 后再启动本臂）；'
    + '窗口 1 实测净效应 +7.8859（G4 逐位兑现 77 张 −3.948 / G1 兑现 / G7 0 命中）';

  // ── 唯一性校验 ──
  // R0' vs 基底：还原 backtest 后全同
  if (strip(r0, { cond: origCond, pre: origPre, backtest: origBacktest })
    !== strip(base.config, { cond: origCond, pre: origPre, backtest: origBacktest })) {
    throw new Error('R0\' 与基底差异超出 name/description/backtest 窗口——应零差异');
  }
  // R1' vs R0'：还原两条条件后全同（backtest 相同不需要还原）
  if (strip(r1, { cond: r0.strategiesConfig.buyStrategies[0].condition,
    pre: r0.strategiesConfig.buyStrategies[0].preBuyCheckCondition })
    !== strip(r0, null)) {
    throw new Error('R1\' 与 R0\' 差异超出 name/description/两条条件——应零差异');
  }

  console.log('===== 三门窗口 2 配对 =====');
  console.log('  窗口:', START, '→', END);
  console.log('  R0\' name:', r0.name);
  console.log('  R1\' name:', r1.name);
  console.log('  R1\' condition: ', r1.strategiesConfig.buyStrategies[0].condition);
  console.log('  R1\' preBuy:', r1.strategiesConfig.buyStrategies[0].preBuyCheckCondition);
  console.log('  backtest:', JSON.stringify(r1.backtest));

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建（一次建两臂）'); process.exit(0); }

  const c0 = await factory.createFromConfig(r0, 'backtest');
  const c1 = await factory.createFromConfig(r1, 'backtest');
  console.log('\n========================================');
  console.log('R0_BASE_ID=' + c0.id);
  console.log('R1_GATED_ID=' + c1.id);
  console.log('========================================');
  console.log('下一步（182，严格按序串行）：');
  console.log('  1) nohup node src/run-engine.js ' + c0.id + ' > /tmp/triple-a21-r0.log 2>&1 &');
  console.log('     # 叙事真调（Jev/视觉/GMGN）+ tick-cache 首拉，预计 1-2h');
  console.log('  2) 等 R0 completed 后：nohup node src/run-engine.js ' + c1.id + ' > /tmp/triple-a21-r1.log 2>&1 &');
  console.log('     # 叙事缓存全命中，仅回放');
  console.log('  3) node scripts/compare-triple-gate-pair.cjs ' + c1.id + ' ' + c0.id);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
