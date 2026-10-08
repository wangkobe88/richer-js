#!/usr/bin/env node
// ============================================================================
// 回测实验整包克隆重跑（2026-10-08，链上真序修复 6815516 配套）：
//   源实验 config 整包深拷贝（窗口/策略腿/引擎段/TPA/cycle/stopLoss 零改动），
//   只改 name/description。用途 = 同配置在**新回放排序口径**下重跑，与源实验
//   （旧 id 序口径）构成天然 A/B 对，差分 = 纯排序效应。
//
//   - 叙事 token_narrative 是 token 级全局缓存：新实验直调全命中源实验已落的
//     有效行（叙事代码未变时不重烧）
//   - BacktestTickCache 同 (sourceExperimentId, platform) 键：缓存文件 id 升序
//     原样存，装载后统一按链上真序重排 → FRESH 纯读命中，无需 forceRefresh
//
// 用法（182）：node scripts/clone-backtest-rerun.cjs --src <expId> [--name ...] [--desc ...] [--commit]
//   默认 dry-run 打印关键段；--commit 真建并打印 NEW_EXP_ID。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
function argVal(k) {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
}
const SRC = argVal('--src');
const NAME = argVal('--name');
const DESC = argVal('--desc');
const COMMIT = args.includes('--commit');

if (!SRC || !NAME || !DESC) {
  console.error('用法: node scripts/clone-backtest-rerun.cjs --src <expId> --name <新名> --desc <新描述> [--commit]');
  process.exit(1);
}

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();

  const base = await factory.load(SRC);
  if (!base) throw new Error('源实验不存在: ' + SRC);
  const cfg = JSON.parse(JSON.stringify(base.config));

  const oldName = cfg.name;
  cfg.name = NAME;
  cfg.description = DESC;

  // ── dry-run 校验打印（只读段，克隆零改动）──
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  console.log('== 源实验 ==', oldName, '(' + SRC.slice(0, 8) + ')');
  console.log('== backtest ==', JSON.stringify(cfg.backtest));
  console.log('== platform ==', cfg.platform, '| 腿数: buy', buys.length, '/ sell', sells.length);
  console.log('== 买腿 condition ==', buys[0] && buys[0].condition);
  console.log('== 引擎段 == tokenCycle:', JSON.stringify(cfg.tokenCycle),
    '| stopLoss:', JSON.stringify(cfg.stopLoss),
    '| TPA:', JSON.stringify(cfg.tokenPositionAnalyzer?.trigger));
  console.log('== PM ==', JSON.stringify(cfg.positionManagement), '| tradeAmount:', cfg.tradeAmount);
  console.log('== 新 name ==', cfg.name);
  console.log('== 新 description ==', cfg.description);

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建'); process.exit(0); }

  const container = await factory.createFromConfig(cfg, 'backtest');
  console.log('\n========================================');
  console.log('NEW_EXP_ID=' + container.id);
  console.log('========================================');
  console.log('启动（182）: node src/run-engine.js ' + container.id);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
