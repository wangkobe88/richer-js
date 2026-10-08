#!/usr/bin/env node
// ============================================================================
// 回测克隆重跑：去掉 router 门上界（2026-10-08 用户裁定「"< 80" 可以去掉」）
//
// buy-v2 v6 买腿 preBuyCheckCondition 里 router 区间门：
//   (platform != 'flap' OR (earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80))
// 改为（只保留下界 50，>=80 也放行）：
//   (platform != 'flap' OR earlyTradesRouterPct >= 50)
//
// 源 = 0fed29f9（链上真序口径 R2 基线，6815516 修复后重跑）：本实验与其唯一
// 差异 = 上界子句，A/B 差分 = 纯上界效应。NULL 语义不变（NULL>=50 为 false
// → 拦，与原形状一致）。
//
// 用法（182）：node scripts/create-no-router-upper-rerun.cjs [--src <expId>] [--commit]
//   默认 dry-run 打印改后 condition；--commit 真建并打印 NEW_EXP_ID。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
function argVal(k) {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
}
const SRC = argVal('--src') || '0fed29f9-cf81-4034-8eca-236b5a96916d';
const NAME = '回测-拱形v2重构R3-叙事引擎重测-1008-去router上界';
const DESC = "R2(0fed29f9 链上真序)克隆，唯一改动=buy 腿 preBuyCheckCondition 去掉 router 门上界：(platform != 'flap' OR (earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80)) → (platform != 'flap' OR earlyTradesRouterPct >= 50)；差分=纯上界效应";
const COMMIT = args.includes('--commit');

const OLD_CLAUSE = "(platform != 'flap' OR (earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80))";
const NEW_CLAUSE = "(platform != 'flap' OR earlyTradesRouterPct >= 50)";

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();

  const base = await factory.load(SRC);
  if (!base) throw new Error('源实验不存在: ' + SRC);
  const cfg = JSON.parse(JSON.stringify(base.config));

  const buys = cfg.strategiesConfig?.buyStrategies || [];
  let patched = 0;
  for (const leg of buys) {
    for (const key of ['preBuyCheckCondition', 'repeatBuyCheckCondition']) {
      const cond = leg[key];
      if (typeof cond !== 'string') continue;
      if (!cond.includes(OLD_CLAUSE)) continue;
      leg[key] = cond.split(OLD_CLAUSE).join(NEW_CLAUSE);
      patched++;
      console.log(`== 已改 ${key} ==`);
      console.log('  旧:', cond);
      console.log('  新:', leg[key]);
    }
  }
  // fail-loud：找不到目标子句说明源 condition 漂移，绝不静默原样建实验
  if (patched === 0) {
    throw new Error('源 condition 未含目标子句（可能已变化）: ' + OLD_CLAUSE);
  }

  cfg.name = NAME;
  cfg.description = DESC;

  console.log('== 源实验 ==', base.config.name, '(' + SRC.slice(0, 8) + ')');
  console.log('== backtest ==', JSON.stringify(cfg.backtest));
  console.log('== platform ==', cfg.platform, '| 腿数: buy', buys.length,
    '/ sell', (cfg.strategiesConfig?.sellStrategies || []).length);
  console.log('== 新 name ==', cfg.name);
  console.log('== patched ==', patched, '处');

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建'); process.exit(0); }

  const container = await factory.createFromConfig(cfg, 'backtest');
  console.log('\n========================================');
  console.log('NEW_EXP_ID=' + container.id);
  console.log('========================================');
  console.log('启动（182）: node src/run-engine.js ' + container.id);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
