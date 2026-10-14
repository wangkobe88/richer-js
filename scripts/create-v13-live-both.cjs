#!/usr/bin/env node
// ============================================================================
// v13 实盘臂（2026-10-14 holderTrend slot 化改造配套）
//   源：v12 94924a30（buy-v2 v9 形状：双 OR-NULL holderTrend 门）
//   改动：买腿 condition 换库 buy-v2 v10 逐字快照（从库里读，单一真相防手抄错）
//   ——旧门在 8 块≈4s 新语义下 OR NULL 臂近乎恒真=门不存在，换
//   `holderTrendSlope > 0`（NULL fail-closed，用户裁定③）。其余段零改动
//   （卖腿 P0/P1+拱形v2-A、u40 实时因子门、市值门 15K、perCardBNB 0.0025×4、
//   executorId 全继承）。libraryRefs provenance 同步 v10。
//   ⚠️ 与 holderTrend slot 化代码（d0cf735）强耦合：v13 启动进程吃新代码+新条件
//   自洽；v12 旧进程旧代码旧条件自洽跑到停，无中间态。
//   不启动：一个阶段只跑一个实验（用户裁定），建行后由用户定时点停 v12 起 v13。
// 用法：node scripts/create-v13-live-both.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '94924a30-c17e-47a2-89bf-dd87c9a7f68c';

const OLD_SEGMENT = '(holderTrendGrowthRatio >= 55 OR holderTrendGrowthRatio IS NULL) AND (holderTrendSlope < 0.55 OR holderTrendSlope IS NULL)';

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');

  // 库 v10 逐字快照（替换源=单一真相）
  const lib = new StrategyLibraryService();
  const entries = await lib.list('buy');
  const entry = entries.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2');
  if (entry.version !== 10) throw new Error(`buy-v2 版本=${entry.version}，期望 10（先跑 bump-buy-v2-v10）`);
  const libCond = entry.legs[0].condition;
  if (!libCond.includes('holderTrendSlope > 0') || libCond.includes('IS NULL'))
    throw new Error('库 v10 condition 形状不对: ' + libCond);

  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error('源实验不存在: ' + SRC);
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both（克隆源不对）: ' + cfg.platform);

  // 防呆：源买腿必须是 v9 形状（旧双括号项）
  const buy = cfg.strategiesConfig?.buyStrategies?.[0];
  if (!buy) throw new Error('买腿缺失');
  if (!buy.condition.includes(OLD_SEGMENT))
    throw new Error('源 fire condition 不含 v9 旧 holderTrend 双括号项（克隆源不对）: ' + buy.condition);
  if (cfg.positionManagement?.perCardBNB !== 0.0025)
    throw new Error('源 perCardBNB != 0.0025（克隆源不对）');
  if (!cfg.wallet?.executorId) throw new Error('源无 wallet.executorId（克隆源不对）');

  buy.condition = libCond;
  // provenance 同步 v10（refs 是元数据，运行零依赖）
  const refs = cfg.strategiesConfig.libraryRefs || [];
  const buyRef = refs.find(r => r?.name === 'buy-v2');
  if (buyRef) { buyRef.version = 10; buyRef.legCount = 1; buyRef.snapshotAt = new Date().toISOString(); }

  cfg.name = 'v13-实盘-both-holderTrendSlot-1014';
  cfg.description = 'v12 换行（2026-10-14 holderTrend slot 化）：唯一改动=买腿 condition 换库 buy-v2 v10'
    + '——旧 growthRatio>=55/slope<0.55 双 OR-NULL 门在 8 块≈4s 新语义（blockNumber 桶，d0cf735）下'
    + ' OR NULL 臂近乎恒真=门不存在，换 `holderTrendSlope > 0` NULL fail-closed（持有者趋势微向上才买，'
    + '用户裁定③）；其余零改动（u40+市值门 15K+卖腿 P0/P1+拱形v2-A+perCardBNB 0.0025×4+executor 继承）。'
    + '历史信号 metadata 旧值断代（裁定①）。源=v12 94924a30';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB);
  console.log('fire (lib v10):', buy.condition);
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V13_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
