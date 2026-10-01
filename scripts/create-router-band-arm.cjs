#!/usr/bin/env node
// ============================================================================
// router 区间门回测臂创建（2026-10-01，「GMGN 占比倒 U」结构：两端都拦）
//
// 用法：
//   node scripts/create-router-band-arm.cjs --lo 50 --hi 80
//        [--base <expId>] [--source <expId>] [--start <ISO>] [--end <ISO>] [--suffix <str>]
//   默认：--base/source 02c60e50（buy-v2 v4 实跑虚拟实验 = config 基底 + token 集合源）
//         --start 2026-09-30T11:00:00Z --end 2026-10-01T10:00:00Z（与 W0/W1 配对同窗）
//
// 变换：preBuyCheckCondition 的 `earlyTradesRouterPct < 60` 替换为
//       `earlyTradesRouterPct >= <lo> AND earlyTradesRouterPct < <hi>`，其余零改动。
// 对照臂复用已跑完的 W0（60 门）/W1（无门），同窗同源同代码 → 三方差分。
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
const LO = parseFloat(argVal('--lo', ''));
const HI = parseFloat(argVal('--hi', ''));
if (!(Number.isFinite(LO) && LO >= 0 && LO < 100)) { console.error('--lo 非法（0-100）'); process.exit(1); }
if (!(Number.isFinite(HI) && HI > LO && HI <= 100)) { console.error('--hi 非法（> lo，≤100）'); process.exit(1); }

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE);
  if (!base) throw new Error(`基底实验不存在: ${BASE}`);

  const buyLeg = base.config?.strategiesConfig?.buyStrategies?.[0] || {};
  const preCond = buyLeg.preBuyCheckCondition || '';
  const hits = preCond.split(ROUTER_CLAUSE).length - 1;
  if (hits !== 1) {
    throw new Error(`基底 preBuyCheckCondition 的 router 门出现 ${hits} 次（期望 1）——条件: ${preCond}`);
  }

  const bandClause = ` AND earlyTradesRouterPct >= ${LO} AND earlyTradesRouterPct < ${HI}`;
  const cfg = JSON.parse(JSON.stringify(base.config));
  const leg = cfg.strategiesConfig.buyStrategies[0];
  leg.preBuyCheckCondition = leg.preBuyCheckCondition.replace(ROUTER_CLAUSE, bandClause);
  leg.description = `${leg.description}；区间门变体（2026-10-01）：router 门 <60 → [${LO},${HI}) 区间门（GMGN 占比倒 U：过低=无散户流量盘、过高=纯刷量盘，两端都拦）`;
  cfg.name = `回测-W2-router区间门${LO}至${HI}${SUFFIX}`;
  cfg.description = `router 区间门臂：02c60e50 config 整包，preBuyCheckCondition 唯一差异 = earlyTradesRouterPct ∈ [${LO},${HI})（对照 W0=60 门 / W1=无门）；源=${SOURCE.slice(0, 8)} 集合，窗 ${START}→${END}`;
  cfg.backtest = {
    initialBalance: 100,
    sourceExperimentId: SOURCE,
    minMaxChangePercent: 0,
    startTime: START,
    endTime: END,
  };

  const arm = await factory.createFromConfig(cfg, 'backtest');
  console.log('\n========================================');
  console.log('W2_ID=' + arm.id);
  console.log('========================================');
  console.log(`preBuyCheckCondition = ${leg.preBuyCheckCondition}`);
  console.log(`启动（182）：node main.js start-experiment -e ${arm.id}`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
