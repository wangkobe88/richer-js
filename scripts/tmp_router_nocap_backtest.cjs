#!/usr/bin/env node
// ============================================================================
// router 门去上限回测（2026-10-04，一次性脚本）：
//   基底 = 6f92e2f9 config（buy-v2 v6+hg55 门）；唯一改动 = preBuyCheckCondition
//   里 router 区间门 [50, 80) 去掉上限 80 → 只保留下限 >= 50
//   （flap 专属门：platform != 'flap' OR rp >= 50 AND rp < 80 → OR rp >= 50）
//   窗口/源/初始资金整段复用 7e4abe0f（刚在跑的同窗基准臂）——同窗同 ticks
//   同缓存（BacktestTickCache 键 = sourceExperimentId+platform），差分 = 去上限净效应
// 用法：node scripts/tmp_router_nocap_backtest.cjs [--commit]（默认 dry-run）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const SRC = '6f92e2f9-1b21-4ea6-b6a1-2e8dc70090e3';
const SIB = '7e4abe0f-aa87-4aa1-9d6c-85b950da9b0e'; // 同窗基准臂（原 [50,80) 门）
const OLD = 'earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80';
const NEW = 'earlyTradesRouterPct >= 50';
const COMMIT = process.argv.slice(2).includes('--commit');

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();

  const src = await factory.load(SRC);
  if (!src) throw new Error('源实验不存在: ' + SRC);
  const sib = await factory.load(SIB);
  if (!sib) throw new Error('基准臂实验不存在: ' + SIB);
  const bt = sib.config.backtest;
  if (!bt || bt.sourceExperimentId !== SRC) {
    throw new Error('基准臂 backtest 段异常: ' + JSON.stringify(bt));
  }

  const bCfg = JSON.parse(JSON.stringify(src.config));
  delete bCfg.virtual;

  // ── 唯一改动：买腿 preBuyCheckCondition 去 router 上限 ──
  let hits = 0;
  for (const leg of (bCfg.strategiesConfig.buyStrategies || [])) {
    const c = leg.preBuyCheckCondition;
    if (typeof c !== 'string' || !c.includes(OLD)) continue;
    leg.preBuyCheckCondition = c.split(OLD).join(NEW);
    hits++;
    console.log('改写买腿', leg.strategyId || leg.name || '?', ':');
    console.log('  OLD:', c);
    console.log('  NEW:', leg.preBuyCheckCondition);
  }
  if (hits === 0) throw new Error('未找到含 router 区间门的买腿（原文已变？）');
  // 全库兜底扫描：卖腿/其它字段不得残留 < 80 上限写法
  const residue = JSON.stringify(bCfg.strategiesConfig).includes('earlyTradesRouterPct < 80');
  if (residue) throw new Error('仍有 earlyTradesRouterPct < 80 残留');

  bCfg.backtest = JSON.parse(JSON.stringify(bt)); // 同窗同源同初始资金整段复用
  bCfg.name = '回测-V2v6+hg55门-1003-1004实跑窗-router门去上限';
  bCfg.description = `与 7e4abe0f 唯一差异 = router 门去上限：preBuyCheckCondition 里`
    + ` (platform != 'flap' OR (earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80))`
    + ` → 去掉 < 80（只保留 >= 50 下限，rp>=80 的 GMGN 极主导盘放行）；`
    + `窗口/源（${bt.startTime} → ${bt.endTime}）/config 其余部分与 7e4abe0f 完全同源，`
    + `差分 = 去上限单因子净效应`;

  console.log('\nname:', bCfg.name);
  console.log('backtest:', JSON.stringify(bCfg.backtest));
  console.log('改动腿数:', hits);

  if (!COMMIT) { console.log('\n[dry-run] 未建；加 --commit 真建'); process.exit(0); }
  const b = await factory.createFromConfig(bCfg, 'backtest');
  console.log('\nBACKTEST_ID=' + b.id);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
