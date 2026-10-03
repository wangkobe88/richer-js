#!/usr/bin/env node
// ============================================================================
// hg55 门 v2 R1 门臂实跑化（2026-10-03，用户指令：接替 50442571）
//
// 基于 9252d60a（hg55 v2 配对 R1 门臂回测，completed）的 config 整包创建虚拟实跑：
//   - 唯一变换 = 删 backtest 段（窗口/源/initialBalance 回测专属）+ 改 name/description
//   - 策略零改动：buy-v2 v6 买腿（TPAPre_tokenScore>2.5 + 首窗人数门
//     earlyTradesUniqueWallets>=15 + router 区间门 flap 专属 [50,80)）
//     + hg55 门（holderTrendGrowthRatio >= 55 OR IS NULL，null fail-open）
//     + 17 卖腿（sell-hot-v1 v2 / sell-mid-v1 / sell-cold-v2）+ TPA/PM/tokenCycle/stopLoss 整包
//   - libraryRefs 照抄（provenance：v6 快照来源）；preBuyCheck.sameNameSearchCacheTtlSec 照抄
//
// 用法（182）：node scripts/create-hg55-virtual.cjs [--commit]
//   默认 dry-run 打印变换差异；--commit 真建。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const SRC_ID = '9252d60a-38e0-4ad1-8032-2ec7bab74f99';
const REPLACE_ID = '50442571-967e-4537-875d-df7d0ceca01d';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC_ID);
  if (!src) throw new Error('源实验不存在: ' + SRC_ID);
  if (src.tradingMode !== 'backtest' && src.trading_mode !== 'backtest') {
    throw new Error('源实验不是 backtest: ' + SRC_ID);
  }

  const cfg = JSON.parse(JSON.stringify(src.config));
  const buy = cfg.strategiesConfig.buyStrategies[0];
  // 形状防线：拿错臂/拿错版本即拒（fail-fast，不静默建错实验）
  if (!/holderTrendGrowthRatio >= 55 OR holderTrendGrowthRatio IS NULL/.test(buy.condition)) {
    throw new Error('源买腿 condition 缺 hg55 门（拿错臂？）: ' + buy.condition);
  }
  if (!/TPAPre_tokenScore > 2\.5/.test(buy.condition)) {
    throw new Error('源买腿 TPA 门不是 v6 的 2.5 档: ' + buy.condition);
  }
  if (!/earlyTradesUniqueWallets >= 15/.test(buy.preBuyCheckCondition)) {
    throw new Error('源买腿 preBuy 缺首窗人数门（v6 形状检查）: ' + buy.preBuyCheckCondition);
  }
  if (!/platform != 'flap' OR/.test(buy.preBuyCheckCondition)) {
    throw new Error('源买腿 router 区间门不是 flap 专属（v6 形状检查）: ' + buy.preBuyCheckCondition);
  }

  const backtestKeys = cfg.backtest ? Object.keys(cfg.backtest) : [];
  delete cfg.backtest;
  cfg.name = '10-双平台虚拟-V2v6策略+hg55门-1003';
  cfg.description = 'hg55 门 v2 R1 门臂（9252d60a，buy-v2 v6 整包）实跑化，接替 50442571（v5+router 全平台区间门）；'
    + 'v6 买腿（TPA>2.5 + 首窗人数门>=15 + router 区间门 flap 专属[50,80)）+ hg55 门'
    + '（holderTrendGrowthRatio >= 55 OR IS NULL，null fail-open）+ 17 卖腿 + TPA/PM/tokenCycle/stopLoss 整包；'
    + '变换仅删 backtest 段';

  console.log('===== 变换 =====');
  console.log('  删除 backtest 段 keys:', backtestKeys.join(','));
  console.log('  name:', cfg.name);
  console.log('  platform:', cfg.platform,
    '| virtual:', JSON.stringify(cfg.virtual),
    '| PM:', JSON.stringify(cfg.positionManagement),
    '| tokenCycle.enforce:', cfg.tokenCycle && cfg.tokenCycle.enforce,
    '| stopLoss:', JSON.stringify(cfg.stopLoss));
  console.log('  condition:', buy.condition);
  console.log('  preBuy:', buy.preBuyCheckCondition);
  console.log('  narrativeCall:', buy.narrativeCallCondition);
  console.log('  卖腿数:', cfg.strategiesConfig.sellStrategies.length,
    '| libraryRefs:', (cfg.strategiesConfig.libraryRefs || []).map(r => `${r.name}v${r.version}`).join(', '));

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建'); process.exit(0); }

  const container = await factory.createFromConfig(cfg, 'virtual');
  console.log('\n========================================');
  console.log('NEW_ID=' + container.id);
  console.log('========================================');
  console.log('接替步骤：① SIGTERM 停 ' + REPLACE_ID + '（进程 + DB 置 stopped）');
  console.log('          ② screen 启动本实验: node src/run-engine.js ' + container.id);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
