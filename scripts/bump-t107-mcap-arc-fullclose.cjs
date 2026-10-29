#!/usr/bin/env node
// ============================================================================
// 库 T107 市值拱形时间全清臂：新条目 mcap-arc-fullclose v1（side=sell）
//   2026-10-29 用户裁定：X = 首次交易→最高市值耗时；峰值市值超 15K USD
//   （=20.1 BNB，T84 换算率 bnbUsd≈745）后，距峰已流逝 ≥ X/2 秒且未再破
//   新高 → 全部清仓。涨多久跌多久没新高 = 拱形走完——时间维度出场，与
//   T99 回撤深度维度（-25 减 1 卡/-35 全清）互补：浅回落阴跌票 T99 永远
//   够不着，本臂按「再等了半个涨程还没新高」截断。
//   FA 三键（token 级全生命口径，与持仓期 secSincePeak/peakMarketCapSinceLastBuy
//   分轨）：mcapPeakBnb（峰=任意接受价轨，outlier/chainLate 不推、尘价照推，
//   与 drawdownFromHighest 同峰）/ secSinceMcapPeak（距峰秒数，now=buildFactorMap
//   入参）/ mcapRiseHalfSec（X/2 预计算——条件求值器无算术文法，除法不能写
//   条件串）。无接受价/totalSupply 缺失 → null 恒 false fail-closed。
//   首峰即首 tick（开跌即峰票）X=0 → X/2=0 → 过市值门即清（忠实用户口径）。
//   插位=create-v65 在 T97 secSincePeak 腿前（priority 10 同档首中即赢：
//   拱形完成的全清 ⊃ T97/T80 减 1 卡）。maxExecutions 刻意不设（卖出失败
//   每轮重试直到清仓）；bypass=false 走 3.5s+5tick 双门确认。
//   ⚠️ 部署红线：新键条件 + 旧 FA 代码 = loadStrategies/validateLegs 未知
//   因子三防线拒启——182 须先 git pull 至含本次 FA 提交再跑本脚本+create-v65。
// 防呆：条目不存在（防重复建）/ 条件串与单测 COND 逐字一致 / 三键在
//   getFactorKeys+getAvailableFactorIds / validateCondition 可过 / 腿形状
//   （cards all/p10/bypass false/无 maxExecutions）。
// 用法：node scripts/bump-t107-mcap-arc-fullclose.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const NAME = 'mcap-arc-fullclose';
const COND = 'mcapPeakBnb > 20.1 AND secSinceMcapPeak >= mcapRiseHalfSec';

const LEG = {
  cards: 'all',
  priority: 10,
  condition: COND,
  cooldownSec: null,
  description: 'T107 市值拱形时间全清臂（2026-10-29 用户裁定）：X=首次交易→最高市值耗时'
    + '（token 全生命口径，首 tick 锚 write-once）；峰值市值超 15K USD（=20.1 BNB，T84'
    + ' 换算率 745）后，距峰已流逝 ≥ X/2 秒且未再破新高 → 全部清仓——涨多久跌多久没'
    + '新高=拱形走完，时间维度与 T99 回撤深度维度互补（浅回落阴跌票 -25/-35 永远够不着，'
    + '本臂按「再等半个涨程还没新高」截断）。峰=任意接受价轨（outlier/chainLate 不推、'
    + '尘价照推，与 drawdownFromHighest 同峰同价流）；再破高 → 峰推进=计时归零+X 变大'
    + '（X/2 只会长不会缩）；无接受价/totalSupply 缺失 → null 恒 false fail-closed'
    + '（marketCap 族惯例）；首峰即首 tick（开跌即峰）X=0 → 过门即清（忠实口径）；'
    + '进程晚接管/回测窗口晚于真实首交易的票 X 低估 → 提前触发（保守出场方向）。'
    + 'maxExecutions 刻意不设（卖出失败每轮重试直到清仓）；bypass=false 走 3.5s+5tick'
    + ' 双门确认。FA 三键 mcapPeakBnb/secSinceMcapPeak/mcapRiseHalfSec（X/2 预计算——'
    + '求值器无算术文法）。插位=T97 secSincePeak 腿前（p10 同档首中即赢：拱形完成全清'
    + ' ⊃ T97/T80 减 1 卡）。详档 docs/交易策略改进与Case台账.md T107',
  bypassDebounce: false,
};

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('sell');
  if (list.find((e) => e.name === NAME)) {
    throw new Error(`库中已存在 ${NAME}（防重复建；如需改版走 update 谱系）`);
  }

  // ── 腿形状自检（写库前本地口径锁定）──
  if (LEG.condition !== COND) throw new Error('LEG.condition 与 COND 漂移');
  if (LEG.cards !== 'all' || LEG.priority !== 10 || LEG.bypassDebounce !== false) {
    throw new Error('腿形状漂移（cards/priority/bypass）');
  }
  if (LEG.maxExecutions !== undefined) throw new Error('不得设 maxExecutions（卖出失败重试语义）');
  const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator.js');
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  for (const k of ['mcapPeakBnb', 'secSinceMcapPeak', 'mcapRiseHalfSec']) {
    if (!fa.getFactorKeys().has(k)) throw new Error(`FA 探针未收键 ${k}（代码未含 T107 三键？）`);
  }
  const { getAvailableFactorIds } = require('../src/trading-engine/core/FactorBuilder.js');
  for (const k of ['mcapPeakBnb', 'secSinceMcapPeak', 'mcapRiseHalfSec']) {
    if (!getAvailableFactorIds().has(k)) throw new Error(`getAvailableFactorIds 缺 ${k}`);
  }
  const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator.js');
  new ConditionEvaluator().parseCondition(COND); // 语法可解析（右操作数因子名合法）

  console.log(`== 新建库条目 ${NAME} v1（side=sell）`);
  console.log('condition:', COND);
  console.log('cards: all | priority: 10 | bypassDebounce: false | maxExecutions: 不设');
  if (COMMIT) {
    const out = await svc.create({ name: NAME, side: 'sell', legs: [LEG] });
    console.log(`✅ committed id=${out.id} version=${out.version}`);
  } else {
    console.log('\n[dry-run]');
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
