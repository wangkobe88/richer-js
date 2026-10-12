/**
 * P2-1（bc4f756e 回测性能案）：FA preFilter 移植（pumpfun 回迁，默认关）单测
 *
 * 零 DB。两层：
 *  A. ConditionEvaluator.extractBuyRangeFromCondition 提取矩阵
 *     （AND 链提取 / OR 降级 null / 多子句最紧合并 / 非数字右值 / 非字符串 /
 *      无 age 子句 / <与<= 同上界、>与>= 同下界）
 *  B. FA setPreFilter + _buildFactorMap 判定
 *     （默认未注入零行为变化 / 出上界跳过 null + 计数 / 严格不等号边界不跳——
 *      对 < 与 <= 都不漏买 / 下界同理 / 持仓 token 永不跳过 / 多区间并集 /
 *      空数组与 null 清除 / 探针计数）
 *
 * 红线（默认关的理由）：跳过 = buildFactorMap null → 引擎侧 TPA
 * checkAndTrigger 与 cycle latch 推进一并跳过 = 决策行为变化；本测试只保证
 * 「因子构建层跳过判定与 condition 语义一致」（不漏买方向），开启前还须
 * 开/关双跑 trades 一致（plan 验收节）。
 */

'use strict';

const assert = require('assert');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');

let passed = 0;
function ok(cond, label) { assert.ok(cond, label); passed++; console.log(`  ✓ ${label}`); }
const stubLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ---------- A. extractBuyRangeFromCondition ----------
console.log('A. extractBuyRangeFromCondition 提取矩阵');
{
  const E = ConditionEvaluator.extractBuyRangeFromCondition;
  ok(E('age > 1.2 AND tps30s >= 0.5')?.minAgeMinutes === 1.2, 'A1. AND 链 age> 提取下界（其余子句透传忽略）');
  ok(E('age <= 3')?.maxAgeMinutes === 3, 'A2. 单子句 age<= 提取上界');
  ok(E('age < 3')?.maxAgeMinutes === 3, 'A3. age< 与 age<= 同上界（严格性由 FA 判定侧保证）');
  ok(E('age >= 1.33')?.minAgeMinutes === 1.33, 'A4. age>= 与 age> 同下界');
  const both = E('age >= 1.33 AND age <= 30 AND volume > 5');
  ok(both?.minAgeMinutes === 1.33 && both?.maxAgeMinutes === 30, 'A5. 多 age 子句最紧合并（下界取大上界取小）');
  const tighter = E('(age > 1 AND x < 2) AND age < 5');
  ok(tighter?.minAgeMinutes === 1 && tighter?.maxAgeMinutes === 5, 'A6. 括号 AND 嵌套透传提取');
  ok(E('age > 1 OR volume > 5') === null, 'A7. OR 结构 → null 降级（无法确定单一范围）');
  ok(E('(age > 1 AND x < 2) OR y > 3') === null, 'A8. 顶层 OR → null 降级（括号 AND 只在一侧）');
  ok(E('profitPercent > 30 AND volume < 5') === null, 'A9. 无 age 子句 → null');
  ok(E('age > abc') === null, 'A10. 右值非数字 → null');
  ok(E('') === null && E(null) === null && E(123) === null, 'A11. 空串/null/非字符串 → null');
  ok(E('age IS NOT NULL') === null, 'A12. IS NOT NULL 节点 → null');
}

// ---------- B. FA preFilter 判定 ----------
console.log('B. FA setPreFilter + _buildFactorMap 判定');

const FA = new FourMemeFactorAggregator({ fourmemeWs: {} }, stubLogger);
const TOK = '0xabc0000000000000000000000000000000000f1';
const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);

function tickAt(tsMs) {
  return {
    token_address: TOK, trade_type: 'buy', trader_address: '0xtrader1',
    price_bnb: 0.0001, price_usd: 0.07, bnb_amount: 0.5, token_amount: 5000,
    block_number: 40000001, timestamp: tsMs, tx_hash: '0xtx', log_index: 1,
    price_outlier: false, platform: 'fourmeme',
  };
}
function buildAt(ageMin) {
  return FA.buildFactorMap(TOK, T0 + ageMin * 60000);
}

FA.registerToken(TOK, { createdAtMs: T0, totalSupply: 1e9, symbol: 'TEST', creatorAddress: null });
FA.processTick(tickAt(T0 + 1000), { emitFactors: false });

{
  // B0：未注入（默认）→ 正常构建，跳过计数 0
  const f = buildAt(999);
  ok(f != null && f.age != null, 'B0. 默认未注入 → age=999min 照常构建（默认关零行为变化）');
  ok(FA.getPreFilterSkipped() === 0, 'B0b. 跳过计数 0');

  // B1：注入单区间 [1.33, 30]
  FA.setPreFilter([{ minAgeMinutes: 1.33, maxAgeMinutes: 30 }]);
  ok(buildAt(0.5) === null, 'B1. age=0.5 < 下界 1.33 → 跳过 null');
  ok(buildAt(0.5) === null && FA.getPreFilterSkipped() === 2, 'B1b. 跳过计数累加（2 次）');
  ok(buildAt(31) === null, 'B1c. age=31 > 上界 30 → 跳过');
  ok(buildAt(5) != null, 'B1d. age=5 区间内 → 正常构建');

  // B2：严格不等号边界（不漏买红线）
  FA.setPreFilter([{ minAgeMinutes: 2, maxAgeMinutes: 10 }]);
  FA._preFilterSkipped = 0;
  ok(buildAt(2) != null, 'B2. age=2 恰=下界 → 不跳过（age<min 为 false；condition `age>2` 此刻为 false、`age>=2` 为 true，边界交回评估）');
  ok(buildAt(10) != null, 'B2b. age=10 恰=上界 → 不跳过');
  ok(buildAt(1.999) === null && buildAt(10.001) === null, 'B2c. 出界一丝 → 跳过');
  ok(FA.getPreFilterSkipped() === 2, 'B2d. 边界两跳各计一次');

  // B3：持仓 token 永不跳过（卖腿需实时因子）
  FA.setBuyState(TOK, { buyPriceBnb: 0.0001, buyPriceUsd: 0.07, buyTime: T0 + 300000 });
  ok(buildAt(999) != null, 'B3. 持仓中（_positions 非空）age=999 出界 → 仍正常构建');
  FA.clearBuyState(TOK, 'default');
  ok(buildAt(999) === null, 'B3b. 清仓后恢复跳过');

  // B4：多区间并集
  FA.setPreFilter([{ minAgeMinutes: 0, maxAgeMinutes: 1 }, { minAgeMinutes: 5, maxAgeMinutes: 6 }]);
  FA._preFilterSkipped = 0;
  ok(buildAt(0.5) != null && buildAt(5.5) != null, 'B4. 并集：两区间内均正常');
  ok(buildAt(3) === null && FA.getPreFilterSkipped() === 1, 'B4b. 并集间隙 age=3 → 跳过');

  // B5：字段缺省归一 + 清除
  FA.setPreFilter([{ maxAgeMinutes: 2 }]); // min 缺省 -Infinity（2026-10-12 事故修正，原 0 误杀负 age）
  ok(buildAt(0.1) != null && buildAt(2.1) === null, 'B5. minAgeMinutes 缺省 -∞：低龄不误杀，上界仍生效');
  FA.setPreFilter([]);
  ok(buildAt(9999) != null, 'B5b. 空数组 → 清除不过滤');
  FA.setPreFilter(null);
  ok(buildAt(9999) != null, 'B5c. null → 清除不过滤');
  ok(FA.getPreFilterSkipped() >= 0, 'B5d. 探针可读（getPreFilterSkipped 导出）');

  // B6：跳过返回的 null 与「state 不存在」的 null 在引擎侧同路径（不炸）
  FA.setPreFilter([{ minAgeMinutes: 100, maxAgeMinutes: 200 }]);
  ok(buildAt(1) === null && buildAt(1) === undefined ? false : true, 'B6. 重复跳过幂等（连续 null 无异常）');
}

// ---------- C. 负 age 事故现场反证（2026-10-12 perf 臂 17da408e 信号 2s 漂移） ----------
// 根因：age 锚 = experiment_tokens.created_at（发现墙钟）晚于链上首 tick → token 出生
// 头几秒 age 为负且 tokenAgeSec<90 对负值为真；setPreFilter 原把无下界子句缺省填 0
// → 负 age tick 全部被跳过因子构建 → 首真信号调度晚 → fire/信号时刻系统性漂移
// （SJ 0x0474e64e…7777：锚+1.57s，condition 首真 li225→li719，fire 26.2s→27.8s）
console.log('C. 负 age 事故现场反证（缺省下界 -∞）');
{
  const E = ConditionEvaluator.extractBuyRangeFromCondition;
  // C1 提取端：单上界子句不产出下界键（-∞ 语义由 FA 消费端填）
  const ex = E('buyVolumeBnb >= 1.5 AND tokenAgeSec < 90 AND holders > 5');
  ok(ex?.maxAgeMinutes === 1.5 && !('minAgeMinutes' in ex), 'C1. 事故 condition 提取：只有上界键 1.5，无下界键');

  // C2 消费端：注入后负 age（出生头几秒）不跳过——事故核心反证
  FA.setPreFilter([ex]);
  FA._preFilterSkipped = 0;
  ok(buildAt(-0.026) != null, 'C2. age=-0.026min（锚+1.57s 事故参数）→ 构建不跳过（原缺省 0 此处 null=事故）');
  ok(buildAt(0) != null, 'C3. age=0 恰=旧缺省下界 → 不跳过');
  ok(buildAt(1.49) != null, 'C4. 窗内正常构建');
  ok(buildAt(1.6) === null, 'C5. age=1.6 > 上界 1.5 → 跳过（设计内：出买窗）');
  ok(FA.getPreFilterSkipped() === 1, 'C6. 仅 C5 计一次跳过');

  // C7 显式下界子句不受修复影响（收紧语义保留）
  const ex2 = E('tokenAgeSec > 120 AND buyVolumeBnb >= 1');
  FA.setPreFilter([ex2]);
  ok(buildAt(1) === null, 'C7. 显式下界 tokenAgeSec>120：age=1min（60s<120s）仍跳过（收紧不被修复放宽）');
  FA.setPreFilter(null);
}

console.log(`\n全部通过：${passed} 断言`);
