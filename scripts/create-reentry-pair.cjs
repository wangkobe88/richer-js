#!/usr/bin/env node
// ============================================================================
// 再入场配对回测创建（2026-09-30，暴走板栗案衍生：全清后放量反弹能否追回）
//
// 一次性脚本，三件事：
//   1. 插策略库条目 buy-reentry-v1（name UNIQUE 冲突即退出——防重复跑）
//   2. 建 B0 基线回测：8aca25e2 config 整包（buy-v2 v3 + 17 卖腿 + tokenCycle/
//      stopLoss/TPA/卡牌全保留）+ backtest 段（G 系列起点延长到 09-29T23:59Z，
//      覆盖不烧心与暴走板栗；sourceExperimentId=9e413cbe 令 BacktestTickCache
//      缓存增量续拉）——绕过 create-backtest.cjs 不透传 tokenCycle 等段的缺口
//   3. 建 B1 实验：B0 + buyStrategies 追加 buy-reentry-v1 整腿快照 + libraryRefs
//
// 启动（182，串行防 tick 缓存双写竞态）：
//   node main.js start-experiment -e <B0_ID>
//   node main.js start-experiment -e <B1_ID>
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const BASE_EXPERIMENT_ID = '8aca25e2-7baf-421d-9a6a-6698d85d977d';  // buy-v2 v3 实跑
const SOURCE_EXPERIMENT_ID = '9e413cbe-d60d-43ef-93bb-2889b7261423'; // ticks 缓存键（G 系列同源）
const START_TIME = '2026-09-28T15:25:54.337+00:00';                  // G 系列起点（缓存增量）
const END_TIME = '2026-09-29T23:59:59.000Z';                         // 延长覆盖暴走板栗 15:19Z

// 再入场腿设计（2026-09-30 用户批准：建库条目 + 配对回测）
//   - condition：age>=90s（与 buy-v2 的 <90s 互斥，天然只在首轮窗口外触发）+ 热桶
//     + 毕业进度 30%（已涨离地）+ 5 分钟涨幅/涨速动量（对应扫描口径「90s 低点反弹
//     >=15% + tps>=0.5」）
//   - 叙事门保留（rating ∈ {2,3}），top1 门不适用：earlyTradesTop1BuyCovered 在
//     age>90s 恒 0，照抄 buy-v2 的 `== 1` 子句会把再入场全部拦死
//   - repeatBuyCheckCondition 必须配：第二轮起（currentRound>=1）引擎走
//     repeatBuy 而非 preBuy，缺配 = 叙事门被跳过 = 无门裸买
//   - 卡牌 2 张 = 0.2 BNB（对齐扫描脚本 STAKE_BNB）
const REENTRY_LEG = {
  priority: 2,
  cards: 2,
  condition: 'tokenAgeSec >= 90 AND tokenCycle == 3 AND graduationProgress >= 0.3 AND riseVel5m > 5 AND risePct5m > 15',
  narrativeCallCondition: 'tokenAgeSec >= 90 AND tokenCycle == 3 AND graduationProgress >= 0.3 AND riseVel5m > 5 AND risePct5m > 15',
  preBuyCheckCondition: 'narrativeRating == 2 OR narrativeRating == 3',
  repeatBuyCheckCondition: 'narrativeRating == 2 OR narrativeRating == 3',
  maxExecutions: 1,
  description: '再入场买腿（暴走板栗案 2026-09-30）：全清后放量反弹追回——age>=90s + 热桶 + 毕业进度 30% + 5 分钟涨幅 15% 动量；2 卡 0.2 BNB；叙事门保留（rating∈{2,3}），top1 门不适用（covered 在 age>90s 恒 0 会拦死）；repeatBuy 同门（第二轮起 preBuy 不生效）',
};

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const client = dbManager.getClient();

  // ── 1. 插策略库条目（幂等防线：重名报错退出）──
  const { data: dup } = await client.from('strategy_library').select('id').eq('name', 'buy-reentry-v1');
  if (dup && dup.length > 0) {
    console.error(`❌ strategy_library 已存在 buy-reentry-v1 (id=${dup[0].id})，如需重建请先删条目`);
    process.exit(1);
  }
  // 插入前先校验 condition/groups 语法（复用库编辑面的校验器，防脏腿入库）
  const { validateLegs } = require('../src/web/services/StrategyLibraryService');
  const validation = validateLegs('buy', [REENTRY_LEG]);
  if (!validation.valid) {
    console.error('❌ 再入场腿校验失败:', validation.errors.join('; '));
    process.exit(1);
  }
  const { data: libRow, error: libErr } = await client.from('strategy_library')
    .insert({ name: 'buy-reentry-v1', side: 'buy', version: 1, legs: [REENTRY_LEG] })
    .select('id')
    .single();
  if (libErr) throw libErr;
  console.log(`✅ 策略库条目 buy-reentry-v1 已插入 id=${libRow.id}`);

  // ── 2. 拉基底 config（8aca25e2 整包）──
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE_EXPERIMENT_ID);
  if (!base) throw new Error(`基底实验不存在: ${BASE_EXPERIMENT_ID}`);

  const backtestSection = {
    initialBalance: 100,
    sourceExperimentId: SOURCE_EXPERIMENT_ID,
    minMaxChangePercent: 0,
    startTime: START_TIME,
    endTime: END_TIME,
  };

  // ── 3. B0 基线 ──
  const b0Config = {
    ...JSON.parse(JSON.stringify(base.config)),  // 深拷贝整包（tokenCycle/stopLoss/TPA/卡牌全保留）
    name: '回测-B0-基线-buyv2v3-0930',
    description: '再入场配对基线：8aca25e2 config 整包（buy-v2 v3 + 17 卖腿），窗 09-28T15:25Z→09-29T23:59Z（G 系列起点延长，覆盖暴走板栗 15:19Z/不烧心 06:44Z）',
    backtest: backtestSection,
  };
  const b0 = await factory.createFromConfig(b0Config, 'backtest');

  // ── 4. B1 = B0 + 再入场腿 ──
  const b1Config = JSON.parse(JSON.stringify(b0Config));
  b1Config.name = '回测-B1-再入场-buyv2v3+reentry-0930';
  b1Config.description = '再入场配对实验：B0 + buy-reentry-v1 腿（库条目 id=' + libRow.id.slice(0, 8) + '）；唯一差异变量=再入场腿';
  b1Config.strategiesConfig.buyStrategies = [...b1Config.strategiesConfig.buyStrategies, JSON.parse(JSON.stringify(REENTRY_LEG))];
  b1Config.strategiesConfig.libraryRefs = [...(b1Config.strategiesConfig.libraryRefs || []), {
    name: 'buy-reentry-v1', side: 'buy', libId: libRow.id, version: 1, legCount: 1,
    snapshotAt: new Date().toISOString(),
  }];
  const b1 = await factory.createFromConfig(b1Config, 'backtest');

  console.log('\n========================================');
  console.log('B0_ID=' + b0.id);
  console.log('B1_ID=' + b1.id);
  console.log('========================================');
  console.log(`启动（182，串行）：node main.js start-experiment -e ${b0.id} && node main.js start-experiment -e ${b1.id}`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
