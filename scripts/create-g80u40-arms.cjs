#!/usr/bin/env node
// ============================================================================
// g80u40 双门验证臂（2026-10-13 用户拍板：gmgnBundlerWalletRatio ≤ 80 +
// TPAPre_gmgnUserPct ≥ 40）
//
// 桂花小鸟案（0xbe5a8a5a…7777，-52% 对倒票）：bundler 87.5% 高段 + 真实用户
// 28.1% 双显形，但现有 G4 门只拦低段（<21.4）、TPAPre_gmgnUserPct 从未成门。
// 本脚本在 b462db4f 同窗（10-04→10-08）建两臂对拍：
//   g0  = v7 基线（2ad6a39b 策略段原样，不加门）
//   g2  = v7 + 双门（fire condition 追加 TPAPre_gmgnUserPct >= 40——FA 键集，
//         preBuy 键集不含 TPAPre 族；preBuyCheckCondition 追加
//         gmgnBundlerWalletRatio <= 80——未覆盖时值 0 恒过=fail-open 同 covered 语义）
//
// 用法：node scripts/create-g80u40-arms.cjs [--commit]（默认 dry-run 打印两臂形状）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const COMMIT = process.argv.includes('--commit');

const SRC_V7 = '2ad6a39b-9a61-4f6d-905e-54d1d1159d52'; // v7 实跑（策略形状来源）
const SRC_BT = 'b462db4f-21fb-4584-be09-8df468da9f6b'; // pr1b 基准（窗口来源）
// b462db4f 窗口硬编码（行已核）：防加载失败时口径漂移
const BT_SECTION = {
  startTime: '2026-10-04T12:47:00.000Z',
  endTime: '2026-10-08T13:10:00.000Z',
  sourceExperimentId: '36a2c12a-a7d6-47ec-ba7e-7f007562fdb4',
  maxTickRows: 8000000,
};

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const v7 = await factory.load(SRC_V7);
  if (!v7) throw new Error('v7 实验不存在: ' + SRC_V7);
  const bt = await factory.load(SRC_BT);
  if (!bt) throw new Error('基准实验不存在: ' + SRC_BT);
  // 窗口口径核验：BT_SECTION 与 b462db4f 实际 backtest 段一致（不一致=窗口漂移，拒建）
  const liveBt = bt.config?.backtest || {};
  for (const k of Object.keys(BT_SECTION)) {
    if (liveBt[k] !== BT_SECTION[k]) {
      throw new Error(`窗口口径漂移: ${k} 基准=${liveBt[k]} 硬编码=${BT_SECTION[k]}`);
    }
  }

  const arms = [
    {
      suffix: 'g0基线',
      desc: 'v7 基线臂（2ad6a39b 策略段原样），g80u40 双门对拍的对照组',
      fireAppend: '', preBuyAppend: '',
    },
    {
      suffix: 'g2双门',
      desc: 'v7 + 双门：fire+=TPAPre_gmgnUserPct>=40（真实用户占比下限 4 成，null fail-closed 拦）；'
        + 'preBuy+=gmgnBundlerWalletRatio<=80（捆绑钱包占比上限 8 成，未覆盖=0 恒过）',
      fireAppend: ' AND TPAPre_gmgnUserPct >= 40',
      preBuyAppend: ' AND gmgnBundlerWalletRatio <= 80',
    },
  ];

  for (const arm of arms) {
    const cfg = JSON.parse(JSON.stringify(v7.config));
    cfg.name = `回测-g80u40-${arm.suffix}-1013`;
    cfg.description = `${arm.desc} | 窗 ${BT_SECTION.startTime}→${BT_SECTION.endTime}`
      + ` 源 ${BT_SECTION.sourceExperimentId.slice(0, 8)}（=b462db4f 同窗）`;
    cfg.backtest = JSON.parse(JSON.stringify(BT_SECTION));
    const buy = cfg.strategiesConfig?.buyStrategies?.[0];
    if (!buy) throw new Error('买腿缺失');
    if (arm.fireAppend) buy.condition = buy.condition + arm.fireAppend;
    if (arm.preBuyAppend) buy.preBuyCheckCondition = (buy.preBuyCheckCondition || '') + arm.preBuyAppend;

    console.log(`===== ${cfg.name} =====`);
    console.log('  fire:   ', buy.condition);
    console.log('  preBuy: ', buy.preBuyCheckCondition);
    if (!COMMIT) continue;
    const container = await factory.createFromConfig(cfg, 'backtest');
    console.log('ARM_ID=' + container.id);
  }
  if (!COMMIT) console.log('\n[dry-run] 未建；加 --commit 真建');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
