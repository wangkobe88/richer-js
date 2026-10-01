#!/usr/bin/env node
// ============================================================================
// router 门配对回测创建（2026-10-01，earlyTradesRouterPct<60 去留对比）
//
// 用法：
//   node scripts/create-router-gate-pair.cjs [--base <expId>] [--source <expId>]
//        [--start <ISO>] [--end <ISO>] [--suffix <str>]
//   默认：--base/source 02c60e50（buy-v2 v4 实跑虚拟实验 = config 基底 + token 集合源）
//         --start 2026-09-30T11:00:00Z（与 H0/H1 配对同起点，首 token 11:06:51Z 前整点）
//         --end   2026-10-01T10:00:00Z（数据齐备整点；两臂同窗，尾部票卖腿余量
//                  按强平收尾——配对差分不受影响）
//
// 两臂（同一代码 = 案A sender 口径 + 案B holders 钱包口径引擎，唯一差异变量 =
// preBuyCheckCondition 的 router 门）：
//   W0 = 02c60e50 config 整包（router 门在：earlyTradesRouterPct < 60）
//   W1 = preBuyCheckCondition 去掉 ' AND earlyTradesRouterPct < 60'
//   差分即 router 门在当前引擎口径上的净效应（R0/R1 验证 +1.808 是案B之前的引擎）
//
// ⚠️ sourceExperimentId 决定 token 全集（_loadTokenMetadata 拉源实验 experiment_tokens）；
//    02c60e50 仍在跑，创建时刻集合含 END 之后发现的 token——窗口外 token 零 tick 零信号，无害。
// ⚠️ 两臂共用 BacktestTickCache（(source,platform) 键控）；H0/H1 已拉过 00:45Z 前数据，
//    本窗终点 10:00Z → 首臂 STALE 增量补拉一次，次臂 FRESH 纯读。
//
// 启动（182，串行防 tick 缓存双写竞态）：
//   node main.js start-experiment -e <W0_ID> && node main.js start-experiment -e <W1_ID>
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const DEFAULT_BASE = '02c60e50-1f99-4279-b71b-3d192a5018a4';
const DEFAULT_START = '2026-09-30T11:00:00.000Z';
const DEFAULT_END = '2026-10-01T10:00:00.000Z';
const ROUTER_CLAUSE = ' AND earlyTradesRouterPct < 60';

const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
}
const BASE = argVal('--base', DEFAULT_BASE);
const SOURCE = argVal('--source', BASE);
const START = argVal('--start', DEFAULT_START);
const END = argVal('--end', DEFAULT_END);
const SUFFIX = argVal('--suffix', '');

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE);
  if (!base) throw new Error(`基底实验不存在: ${BASE}`);

  // router 门断言（preBuyCheckCondition 尾部恰好一次——漏了/写法漂移说明基底选错）
  const buyLeg = base.config?.strategiesConfig?.buyStrategies?.[0] || {};
  const preCond = buyLeg.preBuyCheckCondition || '';
  const hits = preCond.split(ROUTER_CLAUSE).length - 1;
  if (hits !== 1) {
    throw new Error(`基底 preBuyCheckCondition 的 router 门出现 ${hits} 次（期望 1）——条件: ${preCond}`);
  }

  const backtestSection = {
    initialBalance: 100,
    sourceExperimentId: SOURCE,
    minMaxChangePercent: 0,
    startTime: START,
    endTime: END,
  };

  // ── W0 对照臂：router 门保留（= buy-v2 v4 原样）──
  const w0Config = {
    ...JSON.parse(JSON.stringify(base.config)),  // 深拷贝整包（tokenCycle/stopLoss/TPA/卡牌全保留）
    name: `回测-W0-router门在${SUFFIX}`,
    description: `router 门去留对照臂：02c60e50 config 整包（buy-v2 v4 + 17 卖腿，earlyTradesRouterPct<60 保留）；源=${SOURCE.slice(0, 8)} 集合，窗 ${START}→${END}`,
    backtest: { ...backtestSection },
  };
  const w0 = await factory.createFromConfig(w0Config, 'backtest');

  // ── W1 实验臂：唯一差异 = 去掉 router 门 ──
  const w1Config = JSON.parse(JSON.stringify(w0Config));
  const w1BuyLeg = w1Config.strategiesConfig.buyStrategies[0];
  w1BuyLeg.preBuyCheckCondition = w1BuyLeg.preBuyCheckCondition.replace(ROUTER_CLAUSE, '');
  w1BuyLeg.description = `${w1BuyLeg.description}；W1 变体（2026-10-01）：去掉 router 门 earlyTradesRouterPct<60，其余零改动`;
  w1Config.name = `回测-W1-去router门${SUFFIX}`;
  w1Config.description = `router 门去留实验臂：同 W0 config 整包，preBuyCheckCondition 唯一差异 = 去掉 earlyTradesRouterPct<60（top1 门/冷档门/TPA/叙事门全保留）；源=${SOURCE.slice(0, 8)} 集合，窗 ${START}→${END}`;
  const w1 = await factory.createFromConfig(w1Config, 'backtest');

  console.log('\n========================================');
  console.log('W0_ID=' + w0.id);
  console.log('W1_ID=' + w1.id);
  console.log('========================================');
  console.log(`W1 preBuyCheckCondition = ${w1Config.strategiesConfig.buyStrategies[0].preBuyCheckCondition}`);
  console.log(`启动（182，串行）：node main.js start-experiment -e ${w0.id} && node main.js start-experiment -e ${w1.id}`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
