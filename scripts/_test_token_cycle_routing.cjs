#!/usr/bin/env node
/**
 * 行为周期分桶（卖出臂周期路由）+ 毕业竞态/timeStop 遗留修复——本地零 DB 单测
 *
 * 背景（2026-09-28 用户思路 v1，51ea69e7 20 买 14 割肉实证）：FA 读取时聚合
 * tps30s + gapMedianMs 双主量三档判定（3 热/2 中/1 冷/null 证据不足 fail-closed），
 * hysteresis 闩锁（升/降档驻留 30s——2026-09-29 降档 120→30（8bd5ef0b 断流票案）/
 * 断流 stale 快速降档 30s），strategy.cycle
 * × token.cycleTag 等值路由（evaluate 内过滤，一处覆盖买/卖/去抖重评/回测四链）。
 * 2026-09-28 v2（策略库一期）：strategy.cycle 字段泛化为 groups 表达式
 * （'cycle==3'），loadStrategies 单点转换 + evaluate 对标签上下文求值——
 * 本文件 C 段断言已随改；groups 机制的独立单测见 _test_strategy_library_groups.cjs。
 *
 * 覆盖：
 *   A. FA 判定（密/中/疏 → 3/2/1；tick<minTicks 且过 warmup → 冷桶 1；age<warmup → null
 *      ——2026-09-28 修正：证据不足不再 null 全隐，1c68478f 回测 36 强平票根因）
 *   B. hysteresis（升档 30s 驻留 / 降档 30s 驻留 / stale 快速降档 / 驻留秒数 /
 *      B5 早期两项修正 2026-10-04：tps 分母按存活时长归一 + cycleEarlySec 升档免驻留）
 *   C. loadStrategies cycle 脏值归一（字符串/越界/小数/未配 → null）
 *   D. evaluate 过滤矩阵（腿 cycle × cycleTag 等值可见 + null 全隐 + 无 cycle 恒可见）
 *   E. 桶切换后旧桶 strategyExecutions 计数保留
 *   F. getFactorKeys 含 5 新键 + 时序白名单 4 键（旧因子集 → null 不掩盖）
 *   G. 遗留修复：毕业补卖（幂等后置 + 扫描兜底 + 买入点挂点）+ timeStop <=0 边界
 *
 * 用法：node scripts/_test_token_cycle_routing.cjs
 */
'use strict';

const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { StrategyEngine } = require('../src/strategies/StrategyEngine');
const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
const { buildFactorValuesForTimeSeries, buildSlimFactorValues } = require('../src/trading-engine/core/FactorBuilder');
const { mapCycleParams, CYCLE_PARAM_KEY_MAP } = require('../src/strategies/group-variables');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// ── [CycleSwitch] 日志捕获（FA _logCycleSwitch 走 console.log 固定格式）──
const cycleLogs = [];
const origLog = console.log;
console.log = (...args) => {
  const s = args.join(' ');
  if (s.includes('[CycleSwitch]')) cycleLogs.push(s);
  else origLog(...args);
};

// ── 真 FA 实例（构造零 DB；默认 factorParams 即被测阈值）──
let traderSeq = 0;
function makeTick(addr, ts, { isBuy = true, bnb = 0.01, priceBnb = 5e-9 } = {}) {
  traderSeq++;
  return {
    token_address: addr,
    trade_type: isBuy ? 'buy' : 'sell',
    trader_address: `0xtrader${traderSeq}`,
    price_bnb: priceBnb, price_usd: priceBnb * 600,
    bnb_amount: bnb, token_amount: bnb / priceBnb,
    block_number: 40000000 + traderSeq, timestamp: ts,
    tx_hash: `0xtx${traderSeq}`, log_index: 0,
    price_outlier: false, platform: 'fourmeme',
  };
}
function makeFA(addr, createdAtMs = 1000) {
  const fa = new FourMemeFactorAggregator({ fourmemeWs: {} }, noopLogger);
  fa.registerToken(addr, { createdAtMs, totalSupply: 1e9, symbol: 'TST', creatorAddress: '0xcreator' });
  return fa;
}
/** 从 startTs 起喂 n 笔间隔 intervalSec 的 tick，返回下一时刻 ts */
function feed(fa, addr, startTs, intervalSec, n) {
  let ts = startTs;
  for (let i = 0; i < n; i++) {
    fa.processTick(makeTick(addr, ts), { emitFactors: false });
    ts += intervalSec * 1000;
  }
  return ts;
}

// ═══ A. FA 周期判定（三档 + null fail-closed）═══
console.log('A. FA _cycleFactors 判定（tps30s + gapMedianMs 双主量三档）');
{
  // A1 密集：1.5s 间隔 × 20 笔（30s 窗 tps≈0.67 ≥0.5）→ 3
  const fa1 = makeFA('0xa1');
  feed(fa1, '0xa1', 61000, 1.5, 20);
  const f1 = fa1.buildFactorMap('0xa1', 90000);
  check('密集(1.5s×20) → 热桶 3', [f1.tokenCycle, f1.tokenCycleRaw], [3, 3]);
  check('密集 tps30s ≥0.5', f1.cycleTps30s >= 0.5, true);
  check('密集 gapMedianMs ≈1500 ≤2000', f1.cycleGapMedianMs <= 2000, true);

  // A2 中密：5s 间隔 × 20 笔（tps 0.2 ∈[0.08,0.5)；gapMed 5000 ∈(2000,12000]）→ 2
  const fa2 = makeFA('0xa2');
  feed(fa2, '0xa2', 61000, 5, 20);
  const f2 = fa2.buildFactorMap('0xa2', 160000);
  check('中密(5s×20) → 中桶 2', [f2.tokenCycle, f2.tokenCycleRaw], [2, 2]);

  // A3 疏：20s 间隔 × 15 笔（tps 0.033<0.08；gapMed 20000>12000）→ 1（5min 窗 15 笔 ≥12）
  const fa3 = makeFA('0xa3');
  feed(fa3, '0xa3', 61000, 20, 15);
  const f3 = fa3.buildFactorMap('0xa3', 345000);
  check('疏(20s×15) → 冷桶 1', [f3.tokenCycle, f3.tokenCycleRaw], [1, 1]);

  // A4 证据门（2026-09-28 修正）：5min 窗 tick < 12 且已过 warmup → 判冷桶 1 而非
  // null——熄火票冷桶保护腿（P17/P18 时间衰减）不再 fail-closed 隐身
  const fa4 = makeFA('0xa4');
  feed(fa4, '0xa4', 61000, 1.5, 11);
  const f4 = fa4.buildFactorMap('0xa4', 80000);
  check('tick<12 且过 warmup → 冷桶 1（不再 null 全隐）', [f4.tokenCycle, f4.tokenCycleRaw], [1, 1]);

  // A5 热身门：tokenAge < warmupSec(15) → null（开盘脉冲不算行为周期）；
  // 同一 token 出 warmup 后（仍证据不足）→ 冷桶——warmup null 与证据冷的两段衔接
  const fa5 = makeFA('0xa5');
  feed(fa5, '0xa5', 2000, 1.5, 10);
  check('age 9s<15 → null（热身期）', fa5.buildFactorMap('0xa5', 10000).tokenCycle, null);
  check('age 20s≥15 且 tick<12 → 冷桶 1', fa5.buildFactorMap('0xa5', 21000).tokenCycle, 1);

  // A6 衰减段核心场景（1c68478f 36 强平票路径）：热档 → tick 稀疏化（5min 窗掉破
  // minTicks）→ raw=1 走 downDwell 30s 降档——稀疏 tick（间隔<staleMs 30s）仍在触发
  // 评估，冷桶腿上线接管。若间隔 >staleMs 则走 stale 快速通道（B 段已覆盖）。
  // 稀疏段须距热段末笔 ≥5min（RATE_WINDOW_MS）——否则热段 tick/gap 样本仍在窗内
  // raw 照判热（构造坑：稀疏首笔 265000 距热段末笔 89500 仅 175.5s 时 raw=3）
  const fa6 = makeFA('0xa6');
  feed(fa6, '0xa6', 61000, 1.5, 20);            // 热段末笔 ts≈89500
  check('A6 热段 → 3', fa6.buildFactorMap('0xa6', 90000).tokenCycle, 3);
  feed(fa6, '0xa6', 400000, 25, 4);             // 稀疏段：25s 间隔 ×4（末笔 475000）
  check('稀疏首评估 → candidate 登记，dwell 未满仍 3', fa6.buildFactorMap('0xa6', 400500).tokenCycle, 3);
  check('间隔 25s <30s dwell → 仍 3', fa6.buildFactorMap('0xa6', 415000).tokenCycle, 3);
  const a6_3 = fa6.buildFactorMap('0xa6', 430500); // candidateSince=400500，30s≥30s
  check('dwell 满 30s → 切冷桶 1（保护腿上线）', [a6_3.tokenCycle, a6_3.tokenCycleRaw], [1, 1]);
}

// ═══ B. hysteresis 闩锁 ═══
console.log('B. hysteresis（升档 30s / 降档 120s / stale 快速降档）');
{
  // B1 升档驻留：2 →(密集)→ candidate 3，<30s 不切，≥30s 切（reason=upDwell）
  const fa = makeFA('0xb1');
  feed(fa, '0xb1', 61000, 5, 12);          // 中密期 → raw=2
  check('B1 中密期 init=2', fa.buildFactorMap('0xb1', 120000).tokenCycle, 2);
  const denseEnd = feed(fa, '0xb1', 116500, 1.5, 40); // 末笔 ts=175500
  // candidate 在首次评估到 raw=3 时登记（不是 tick 到达时）——密集结束后立即评一次锚定 candidateSince
  fa.buildFactorMap('0xb1', 176000);
  const b1_29 = fa.buildFactorMap('0xb1', 176000 + 29000);
  check('升档驻留 29s<30s → 仍 2', b1_29.tokenCycle, 2);
  feed(fa, '0xb1', 205500, 1.5, 1);   // 补一笔密集 tick：31s 评估点距末笔须 <staleMs 30s，否则 stale 降 1 抢跑
  const b1_31 = fa.buildFactorMap('0xb1', 176000 + 31000);
  check('升档驻留 31s≥30s → 切 3', b1_31.tokenCycle, 3);
  check('切桶日志 reason=upDwell', cycleLogs.some(l => l.includes('from=2 to=3') && l.includes('reason=upDwell')), true);

  // B2 降档驻留：3 →(疏 13s)→ candidate 1，<30s 不切，≥30s 切（reason=downDwell）
  const fa2 = makeFA('0xb2');
  feed(fa2, '0xb2', 61000, 1.5, 40);       // 密集期 → init=3
  check('B2 密集期 init=3', fa2.buildFactorMap('0xb2', 121000).tokenCycle, 3);
  // 疏期 13s 间隔持续喂（评估点落在笔间空档时 30s 窗仅 2 笔 tps<0.08、gapMed 13000
  // >12000 → raw=1；13s < staleMs 30s 不走 stale 快速通道，B3 独立覆盖）
  let ts = feed(fa2, '0xb2', 124000, 13, 45); // 末笔 696000，返回 709000
  const b2_cand = fa2.buildFactorMap('0xb2', ts + 1000);
  check('疏期首评 → candidate 登记 current 仍 3', b2_cand.tokenCycle, 3);
  const candSince = ts + 1000;
  // 持续喂 tick 到驻留 26s（不 stale：lastTickAt 持续刷新）→ 仍 3
  ts = feed(fa2, '0xb2', ts + 13000, 13, 1);
  const b2_26 = fa2.buildFactorMap('0xb2', ts + 1000);
  check('降档驻留 26s<30s → 仍 3', b2_26.tokenCycle, 3);
  ts = feed(fa2, '0xb2', ts + 13000, 13, 1); // 再喂 1 笔跨过 30s
  const b2_over = fa2.buildFactorMap('0xb2', ts + 1000);
  check(`降档驻留 ≥30s → 切 1`, b2_over.tokenCycle, 1);
  check('切桶日志 reason=downDwell', cycleLogs.some(l => l.includes('from=3 to=1') && l.includes('reason=downDwell')), true);

  // B3 stale 快速通道：current=3 断流 >30s → 立即 1（不等降档驻留）
  const fa3 = makeFA('0xb3');
  feed(fa3, '0xb3', 61000, 1.5, 40);       // init=3（末笔 119500）
  fa3.buildFactorMap('0xb3', 121000);
  const b3 = fa3.buildFactorMap('0xb3', 121000 + 31000); // 断流 32.5s>30s
  check('断流 31s>30s → 立即降 1', b3.tokenCycle, 1);
  check('stale 日志 reason=stale', cycleLogs.some(l => l.includes('reason=stale')), true);

  // B4 tokenCycleAgeSec：当前档位驻留秒数
  const fa4 = makeFA('0xb4');
  feed(fa4, '0xb4', 61000, 1.5, 20);
  fa4.buildFactorMap('0xb4', 90000);       // init since=90000
  const b4 = fa4.buildFactorMap('0xb4', 90000 + 12000);
  check('tokenCycleAgeSec=档位驻留秒数', b4.tokenCycleAgeSec, 12);

  // B5 早期两项修正（2026-10-04 0xe5e15117…7777 案裁定）：①tps 分母按实际存活时长
  // 归一（固定 30s 分母对 <30s 新票天然减半——9 tick 真速率 0.6 被算成 0.30）；②存活
  // <cycleEarlySec(90) 升档免驻留即时生效（冷档起步新票追热被 30s 驻留钉住，90s 买窗
  // 内最早可买点被推到 ~48s）；降档驻留不豁免、成熟 token 升档照旧走驻留（B1 锁定）
  // B5a 分母判别：12 tick 不均匀间隔（6×2100 + 5×100），age 恰 15s —— 新分母
  // tps=12/15=0.8 ≥0.5 → 热桶；若回退固定 30s 分母 tps=0.4 且 gapMed 2100>2000
  // → 中桶 2（本断言即回退探测器）。证据门同步满足（winTicks=12 ≥12）
  {
    const fa5a = makeFA('0xb5a');
    for (const ts of [2000, 4100, 4200, 6300, 6400, 8500, 8600, 10700, 10800, 12900, 13000, 15100]) {
      fa5a.processTick(makeTick('0xb5a', ts), { emitFactors: false });
    }
    const f5a = fa5a.buildFactorMap('0xb5a', 16000); // age=(16000-1000)/1000=15s 整
    check('B5a 新票分母=存活时长：tps=0.8 → 热桶 3（旧 30s 分母为 0.4 → 中桶 2）',
      [f5a.tokenCycle, f5a.tokenCycleRaw, f5a.cycleTps30s], [3, 3, 0.8]);

    // B5b 早期升档免驻留：稀疏 6 tick init=1（证据门判冷）→ 密集 burst 后首次
    // raw=3 评估（age 38.1s <90）即时切换 reason=earlyUp——旧代码该评估只登记
    // candidate（驻留 0s <30s）current 仍 1（本断言即回退探测器）
    const fa5b = makeFA('0xb5b');
    feed(fa5b, '0xb5b', 2000, 5, 6);                 // 稀疏：winTicks=6<12
    check('B5b 稀疏期 init=1（证据门）', fa5b.buildFactorMap('0xb5b', 28000).tokenCycle, 1);
    feed(fa5b, '0xb5b', 28500, 1.5, 8);              // 密集 burst（末笔 39000）
    const f5b = fa5b.buildFactorMap('0xb5b', 39100); // age=38.1s；gapMed 1500≤2000 → raw=3
    check('早期升档即时生效 → 3（旧代码驻留未满仍 1）',
      [f5b.tokenCycle, f5b.tokenCycleRaw, f5b.tokenCycleAgeSec], [3, 3, 0]);
    check('切桶日志 reason=earlyUp',
      cycleLogs.some(l => l.includes('from=1 to=3') && l.includes('reason=earlyUp')), true);

    // B5c earlySec 配置化差分：同形状喂法但 earlySec=20 → age 38.1s 已出早期窗，
    // 升档回退驻留语义（首评 candidate 驻留 0s → current 仍 1）——证明参数注入生效
    const fa5c = new FourMemeFactorAggregator(
      { fourmemeWs: { factorParams: { ...mapCycleParams({ earlySec: 20 }) } } }, noopLogger);
    fa5c.registerToken('0xb5c', { createdAtMs: 1000, totalSupply: 1e9, symbol: 'TST', creatorAddress: '0xc' });
    feed(fa5c, '0xb5c', 2000, 5, 6);
    fa5c.buildFactorMap('0xb5c', 28000);             // init=1
    feed(fa5c, '0xb5c', 28500, 1.5, 8);
    const f5c = fa5c.buildFactorMap('0xb5c', 39100); // age 38.1s ≥ earlySec 20
    check('earlySec=20 → 出窗升档回退驻留（current 仍 1，raw=3）',
      [f5c.tokenCycle, f5c.tokenCycleRaw], [1, 3]);

    // B5d 源码口径 + 键映射：earlyUp 仅升档豁免（isUp &&）；参数注册表/默认值
    const faSrc = require('fs').readFileSync(
      require('path').join(__dirname, '../src/services/FourMemeFactorAggregator.js'), 'utf8');
    check('源码：earlyUp 守卫 = isUp &&（降档不豁免）', /const earlyUp = isUp &&/.test(faSrc), true);
    check('源码：tps 分母 min(存活, 滑窗) 实现（tpsDenomMs）', faSrc.includes('tpsDenomMs'), true);
    check('CYCLE_PARAM_KEY_MAP 含 earlySec → cycleEarlySec', CYCLE_PARAM_KEY_MAP.earlySec, 'cycleEarlySec');
    check('FACTOR_PARAM_DEFAULTS.cycleEarlySec=90（对齐 90s 买窗）',
      FourMemeFactorAggregator.FACTOR_PARAM_DEFAULTS.cycleEarlySec, 90);
  }
}

console.log = origLog; // 恢复（后续段允许正常输出；C 段策略加载日志保留）

// ═══ C. loadStrategies cycle 归一（v2：strategy.cycle 字段 → groups 表达式）═══
console.log('C. loadStrategies cycle 脏值归一（1|2|3 外全 → null=全周期；v2 转换为 groups 表达式）');
{
  const factorIds = new Set(['tradeCount']);
  const se = new StrategyEngine();
  const base = (id, extra = {}) => ({ id, name: `策略${id}`, action: 'sell', condition: 'tradeCount >= 0', priority: 1, ...extra });
  se.loadStrategies([
    base('s1', { cycle: 2 }),
    base('s2', { cycle: '3' }),   // 字符串脏值 → null
    base('s3', { cycle: 4 }),     // 越界 → null
    base('s4', { cycle: 1.5 }),   // 非整数 → null
    base('s5', { cycle: null }),  // 显式 null → null
    base('s6'),                   // 未配 → null
  ], factorIds);
  const groups = Object.fromEntries(se.getAllStrategies().map(s => [s.id, s.groups]));
  check('合法 2 → groups "cycle==2"（v1 数字 v2 表达式等价转换）', groups.s1, 'cycle==2');
  check("字符串 '3' → null", groups.s2, null);
  check('越界 4 → null', groups.s3, null);
  check('小数 1.5 → null', groups.s4, null);
  check('显式 null → null', groups.s5, null);
  check('未配 → null', groups.s6, null);
  check('cycle 字段不再落在 strategy 对象（单一事实源 groups）', 'cycle' in se.getAllStrategies()[0], false);
}

// ═══ D. evaluate 过滤矩阵 ═══
console.log('D. evaluate 桶路由（腿 cycle × tokenData.cycleTag）');
{
  const factorIds = new Set(['tradeCount']);
  const mk = () => {
    const se = new StrategyEngine();
    se.loadStrategies([
      { id: 'cold1', name: '冷桶腿', action: 'sell', condition: 'tradeCount >= 0', priority: 5, cycle: 1 },
      { id: 'mid1', name: '中桶腿', action: 'sell', condition: 'tradeCount >= 0', priority: 5, cycle: 2 },
      { id: 'hot1', name: '热桶腿', action: 'sell', condition: 'tradeCount >= 0', priority: 5, cycle: 3 },
      { id: 'plain', name: '无标注腿', action: 'sell', condition: 'tradeCount >= 0', priority: 9 },
    ], factorIds);
    return se;
  };
  const factors = { tradeCount: 5 };
  check('cycleTag=1 → 冷桶腿', mk().evaluate(factors, '0xa', 1, { cycleTag: 1 }, 'sell').id, 'cold1');
  check('cycleTag=2 → 中桶腿', mk().evaluate(factors, '0xa', 1, { cycleTag: 2 }, 'sell').id, 'mid1');
  check('cycleTag=3 → 热桶腿', mk().evaluate(factors, '0xa', 1, { cycleTag: 3 }, 'sell').id, 'hot1');
  check('cycleTag=null → 带 cycle 腿全隐（fail-closed）→ 无标注腿顶上',
    mk().evaluate(factors, '0xa', 1, { cycleTag: null }, 'sell').id, 'plain');
  check('tokenData 缺失 → 同 null 语义',
    mk().evaluate(factors, '0xa', 1, null, 'sell').id, 'plain');

  // 高优先级带 cycle 腿被隐 → 低优先级无 cycle 腿可顶上（与 maxExecutions/cooldown 同构）
  const se2 = new StrategyEngine();
  se2.loadStrategies([
    { id: 'hotHigh', name: '热桶高优', action: 'sell', condition: 'tradeCount >= 0', priority: 0, cycle: 3 },
    { id: 'plainLow', name: '无标注低优', action: 'sell', condition: 'tradeCount >= 0', priority: 9 },
  ], factorIds);
  check('cycleTag=2 时热桶高优腿被隐 → 无标注低优顶上',
    se2.evaluate(factors, '0xa', 1, { cycleTag: 2 }, 'sell').id, 'plainLow');
  check('cycleTag=3 时热桶高优腿恢复',
    se2.evaluate(factors, '0xa', 1, { cycleTag: 3 }, 'sell').id, 'hotHigh');

  // 买腿同链路（actionFilter=buy）覆盖验证
  const se3 = new StrategyEngine();
  se3.loadStrategies([
    { id: 'buyCold', name: '冷桶买', action: 'buy', condition: 'tradeCount >= 0', priority: 1, cycle: 1 },
    { id: 'buyPlain', name: '无标注买', action: 'buy', condition: 'tradeCount >= 0', priority: 9 },
  ], factorIds);
  check('买腿同路由（cycleTag=2 → 无标注买腿）',
    se3.evaluate(factors, '0xa', 1, { cycleTag: 2 }, 'buy').id, 'buyPlain');
}

// ═══ E. 桶切换后旧桶计数保留（strategyExecutions 按 strategyId 分桶）═══
console.log('E. 桶切换 → strategyExecutions 计数保留');
{
  const factorIds = new Set(['tradeCount']);
  const se = new StrategyEngine();
  se.loadStrategies([
    { id: 'hot1', name: '热桶腿限2次', action: 'sell', condition: 'tradeCount >= 0', priority: 1, cycle: 3, maxExecutions: 2 },
    { id: 'cold1', name: '冷桶腿', action: 'sell', condition: 'tradeCount >= 0', priority: 1, cycle: 1 },
    { id: 'plain', name: '兜底腿', action: 'sell', condition: 'tradeCount >= 0', priority: 9 },
  ], factorIds);
  const factors = { tradeCount: 5 };
  const td = { cycleTag: 3, strategyExecutions: { hot1: { count: 2 } } };
  check('热桶：hot1 计数满 2/2 → 被挡，兜底腿顶上', se.evaluate(factors, '0xa', 1, td, 'sell').id, 'plain');
  td.cycleTag = 1; // 切冷桶
  check('切冷桶 → cold1 可见', se.evaluate(factors, '0xa', 1, td, 'sell').id, 'cold1');
  td.cycleTag = 3; // 切回热桶
  check('切回热桶 → hot1 计数保留仍被挡', se.evaluate(factors, '0xa', 1, td, 'sell').id, 'plain');
}

// ═══ F. 因子键集 + 时序白名单 ═══
console.log('F. getFactorKeys 5 新键 + 时序白名单 4 键');
{
  const keys = new FourMemeFactorAggregator({ fourmemeWs: {} }, noopLogger).getFactorKeys();
  for (const k of ['tokenCycle', 'tokenCycleRaw', 'tokenCycleAgeSec', 'cycleTps30s', 'cycleGapMedianMs']) {
    check(`因子键集含 ${k}`, keys.has(k), true);
  }
  // 旧因子集（FA 无这些键）→ null 而非 undefined（不掩盖）
  const legacy = buildFactorValuesForTimeSeries({ tradeCount: 3 });
  check('旧因子集 4 键 → null（不 undefined）',
    [legacy.tokenCycle, legacy.tokenCycleRaw, legacy.cycleTps30s, legacy.cycleGapMedianMs],
    [null, null, null, null]);
  const snap = buildFactorValuesForTimeSeries({ tokenCycle: 2, tokenCycleRaw: 2, cycleTps30s: 0.21, cycleGapMedianMs: 5000 });
  check('快照 4 键透传', [snap.tokenCycle, snap.tokenCycleRaw, snap.cycleTps30s, snap.cycleGapMedianMs],
    [2, 2, 0.21, 5000]);
  // 30s 时序快照走 buildSlimFactorValues（2026-09-28 部署发现：4 错加在大白名单，
  // 182 实测快照零键；cycle 档依赖 latch 状态不可回测重建，slim 必须落库）
  const slim = buildSlimFactorValues({ tokenCycle: 3, tokenCycleRaw: 2, cycleTps30s: 0.6, cycleGapMedianMs: 1800 });
  check('slim 快照 4 键透传', [slim.tokenCycle, slim.tokenCycleRaw, slim.cycleTps30s, slim.cycleGapMedianMs],
    [3, 2, 0.6, 1800]);
  const slimLegacy = buildSlimFactorValues({ tradeCount: 3 });
  check('slim 旧因子集 4 键 → null', [slimLegacy.tokenCycle, slimLegacy.cycleTps30s], [null, null]);
}

// ═══ G. 遗留修复（毕业竞态补卖 + timeStop <=0）═══
console.log('G. 遗留修复（盘古案毕业竞态 / timeStop 持平盲区）');

function makeEngine(fields = {}) {
  return Object.assign(Object.create(FourMemeWssTradingEngine.prototype), {
    _experimentId: 'test-exp',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    _isLive: false,
    _graduationSoldTokens: new Set(),
    _cycleEnforce: false,
    ...fields,
  });
}

(async () => {

  // G1 _emitGraduationSell 幂等标记后置到卖出成功（失败不标记 → 扫描可重试）
  {
    const eng = makeEngine({
      _factorAggregator: { buildFactorMap: () => ({ graduationProgress: 0.9, profitPercent: 10 }) },
      _emitSellSignal: async () => ({ success: false, reason: '卖出执行中' }),
    });
    const r1 = await eng._emitGraduationSell({ token: '0xg1', symbol: 'G1' }, { fundsBnb: 15 });
    check('卖出失败 → 幂等集不标记（可重试）', [r1.success, eng._graduationSoldTokens.size], [false, 0]);

    eng._emitSellSignal = async () => ({ success: true });
    const r2 = await eng._emitGraduationSell({ token: '0xg1', symbol: 'G1' }, {});
    check('卖出成功 → 幂等集标记', [r2.success, eng._graduationSoldTokens.size], [true, 1]);

    let calls = 0;
    eng._emitSellSignal = async () => { calls++; return { success: true }; };
    const r3 = await eng._emitGraduationSell({ token: '0xg1', symbol: 'G1' }, {});
    check('已标记 → 短路不再调卖出链', [calls, r3], [0, undefined]);
  }

  // G2 _scanHoldingsStopLoss 毕业兜底（先于止损；Set 已含走止损；live 不走）
  {
    async function runScan({ graduated, inSet, isLive }) {
      const stopCalls = [], gradCalls = [];
      const eng = makeEngine({
        _isLive: isLive,
        _stopLossEnabled: true, _stopLossPricePct: -50,
        _graduationSoldTokens: new Set(inSet ? ['0xscan'] : []),
        _getAllHoldings: () => [{ tokenAddress: '0xscan' }],
        _tokenPool: { getToken: () => ({ token: '0xscan', status: 'bought' }) },
        _factorAggregator: {
          buildFactorMap: () => ({ profitPercent: -55, holdDuration: 100 }),
          getTokenState: () => ({ graduated, lastFundsBnb: 15 }),
        },
        _sellingTokens: new Set(), _buyingTokens: new Set(),
        _emitStopLossSell: async () => { stopCalls.push(1); },
        _emitGraduationSell: async () => { gradCalls.push(1); return { success: true }; },
      });
      await eng._scanHoldingsStopLoss();
      return { stopCalls: stopCalls.length, gradCalls: gradCalls.length };
    }
    check('已毕业未卖 → 毕业补卖且不走止损', await runScan({ graduated: true, inSet: false, isLive: false }), { stopCalls: 0, gradCalls: 1 });
    check('已毕业已卖（Set 含）→ 走止损（回归）', await runScan({ graduated: true, inSet: true, isLive: false }), { stopCalls: 1, gradCalls: 0 });
    check('未毕业 → 走止损（回归）', await runScan({ graduated: false, inSet: false, isLive: false }), { stopCalls: 1, gradCalls: 0 });
    check('live → 不走毕业补卖（人工处置语义）', await runScan({ graduated: true, inSet: false, isLive: true }), { stopCalls: 1, gradCalls: 0 });
  }

  // G3 timeStop <=0：断流冻结票 profit 恒 0 也能触发（盘古案盲区）
  {
    const eng = makeEngine({ _stopLossEnabled: true, _stopLossTimeSec: 3600, _stopLossPricePct: -50 });
    check('超时 + profit 恰 0 → time 命中（<=0）',
      eng._stopLossHit({ profitPercent: 0, holdDuration: 3700 }).kind, 'time');
    check('超时 + 盈利 → 不触发（回归）', eng._stopLossHit({ profitPercent: 1, holdDuration: 3700 }), null);
  }

  // ═══ H. cycle 判定配置化注入链（三级合并优先级）═══
  // 引擎构造点行为复刻：ws.factorParams 与 tokenCycle.params 并入后 FA._fp 的取值
  // （FACTOR_PARAM_DEFAULTS < fourmemeWs.factorParams < tokenCycle.params）
  console.log('H. tokenCycle.params 注入链三级合并优先级');
  {
    const wsMerged = { factorParams: { cycleHotTps: 0.4, cycleMinTicks: 8 } }; // 旧入口
    wsMerged.factorParams = {
      ...(wsMerged.factorParams || {}),
      ...mapCycleParams({ hotTps: 0.6 }), // 新显式入口（最高优先级）
    };
    const fa = new FourMemeFactorAggregator({ fourmemeWs: wsMerged }, noopLogger);
    check('tokenCycle.params 压过 ws.factorParams', fa._fp.cycleHotTps, 0.6);
    check('ws.factorParams 未覆盖键保留', fa._fp.cycleMinTicks, 8);
    check('未涉键走 FACTOR_PARAM_DEFAULTS', fa._fp.cycleStaleMs, 30000);
    // 行为级：注入后热桶门收紧（hotTps 0.6）——1.5s 间隔（tps≈0.67>0.5 但 <0.6+）
    // 注意 tps 门与 gap 门 OR 关系：1.5s 间隔同时命中 hotGapMs(2000)——构造只踩 tps
    // 门的样本不可行，改为验证参数真的进判定（gap 门放宽到 5000 后 2.5s 间隔升热桶）
    const fa2Cfg = { factorParams: { ...mapCycleParams({ hotGapMs: 5000 }) } };
    const fa2 = new FourMemeFactorAggregator({ fourmemeWs: fa2Cfg }, noopLogger);
    fa2.registerToken('0xh1', { createdAtMs: 1000, totalSupply: 1e9, symbol: 'TST', creatorAddress: '0xc' });
    let ts = feed(fa2, '0xh1', 2000, 2.5, 30); // 2.5s 间隔：默认门(2000)中桶、放宽门(5000)热桶
    const f = fa2.buildFactorMap('0xh1', ts + 1000);
    check('hotGapMs 注入生效：2.5s 间隔 → 热桶（默认门下为中桶）', f.tokenCycle, 3);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
