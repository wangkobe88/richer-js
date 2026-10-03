#!/usr/bin/env node
// ============================================================================
// 通用回测实验克隆（2026-10-03；f6504c4a 双跑污染案衍生物）
//
// 背景：f6504c4a（hg55 R0 基线）裸跑进程实际未死（此前误判 SIGHUP），screen
// rerun 与其并发 25 分钟同 id 双写 DB——trades 904=2×452、signals 7584=2×3792，
// 虚拟时间戳完全重叠不可区分，FIFO 对拍全口径失真。补救 = 不动污染行（删除
// 实验数据须用户裁定），新 id 整包克隆 config 干净重跑；tick/叙事缓存已热，
// 重跑成本 ~40min，且终值可与两跑内存值（+11.4440，逐位一致）对拍验证。
//
// 用法：node scripts/clone-backtest.cjs --src <expId> --name <新名> [--note <说明>] [--commit]
//   config 整包深拷贝（窗口/源/策略/机制全保真），只改 name/description；
//   默认 dry-run 打印，--commit 真建。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
const argVal = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
const SRC = argVal('--src');
const NAME = argVal('--name');
const NOTE = argVal('--note') || '';
const COMMIT = args.includes('--commit');

async function main() {
  if (!SRC || !NAME) {
    console.error('用法: node scripts/clone-backtest.cjs --src <expId> --name <新名> [--note <说明>] [--commit]');
    process.exit(1);
  }
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error('源实验不存在: ' + SRC);

  const cfg = JSON.parse(JSON.stringify(src.config));
  const oldName = cfg.name || '(无)';
  cfg.name = NAME;
  cfg.description = (NOTE ? NOTE + ' | ' : '') + `克隆自 ${SRC}（${oldName}）config 整包，` +
    `窗口 ${cfg.backtest?.startTime} → ${cfg.backtest?.endTime}，源 ${cfg.backtest?.sourceExperimentId}`;

  console.log('===== 克隆预览 =====');
  console.log('  src:', SRC, oldName);
  console.log('  新名:', cfg.name);
  console.log('  backtest:', JSON.stringify(cfg.backtest));
  console.log('  买腿数:', cfg.strategiesConfig?.buyStrategies?.length,
    '| 卖腿数:', cfg.strategiesConfig?.sellStrategies?.length);
  console.log('  preBuy:', cfg.strategiesConfig?.buyStrategies?.[0]?.preBuyCheckCondition);
  if (!COMMIT) { console.log('\n[dry-run] 未建；加 --commit 真建'); process.exit(0); }

  const container = await factory.createFromConfig(cfg, 'backtest');
  console.log('\nCLONE_ID=' + container.id);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
