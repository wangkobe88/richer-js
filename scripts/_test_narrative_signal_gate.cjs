#!/usr/bin/env node
/**
 * 叙事否决短路——本地零 DB 单测（shouldBlockOnNarrative 纯函数 + getRating
 * precheckStage 透传打桩）
 *
 * 覆盖：
 *   1. shouldBlockOnNarrative 八路：rating 1 终态登记 / address-fail 窗内豁免 /
 *      出窗登记 / 非 address 挂点不豁免 / 无年龄按出窗（fail-closed 对齐重试服务）/
 *      rating 2/3/9 不登记
 *   2. getRating 打桩：precheckStage 从 llmAnalysis.preCheck.details.validationStage
 *      透传（实时/缓存同形）；超时/异常 → null；numericRating 非 1/2/3 归一 9
 *
 * 用法：node scripts/_test_narrative_signal_gate.cjs
 */

'use strict';

const {
  NarrativeDirectCaller,
  shouldBlockOnNarrative,
} = require('../src/trading-engine/pre-check/NarrativeDirectCaller');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

async function main() {
  // ═══ A. shouldBlockOnNarrative 纯函数 ═══
  console.log('A. shouldBlockOnNarrative 判定八路');
  check('rating=1 + 非挂点(null) + 任意年龄 → 登记短路', shouldBlockOnNarrative(1, null, 10) === true);
  check('rating=1 + address 挂点 + 窗内(3min) → 豁免（等重析翻正）', shouldBlockOnNarrative(1, 'address', 3) === false);
  check('rating=1 + address 挂点 + 出窗(6min) → 登记（重试已停=终态）', shouldBlockOnNarrative(1, 'address', 6) === true);
  check('rating=1 + 窗边界(恰好 5min) → 登记（窗口=300s 恰过）', shouldBlockOnNarrative(1, 'address', 5) === true);
  check('rating=1 + address + 无年龄(null) → 登记（fail-closed，对齐重试服务无锚不重试）', shouldBlockOnNarrative(1, 'address', null) === true);
  check('rating=1 + 其他挂点(no_public_info) + 窗内 → 登记（非重试域）', shouldBlockOnNarrative(1, 'no_public_info', 1) === true);
  check('rating=2/3（过）→ 不登记', shouldBlockOnNarrative(2, null, 10) === false && shouldBlockOnNarrative(3, null, 10) === false);
  check('rating=9（未评级，非终态）→ 不登记', shouldBlockOnNarrative(9, 'address', 1) === false && shouldBlockOnNarrative(9, null, null) === false);

  // ═══ B. getRating precheckStage 透传（打桩 _getAnalyzer）═══
  console.log('B. getRating precheckStage 透传');

  // B1 正常返回带 address 挂点
  {
    const caller = new NarrativeDirectCaller();
    caller._getAnalyzer = async () => ({
      analyze: async () => ({
        numericRating: 1,
        rating: 'low',
        meta: { fromCache: true },
        classifiedUrls: null,
        gmgnRisk: null,
        llmAnalysis: { preCheck: { details: { validationStage: 'address' } } },
      }),
    });
    const r = await caller.getRating('0xabc');
    check('precheckStage 透传 address', r.precheckStage === 'address', JSON.stringify(r));
    check('numericRating 1 透传', r.numericRating === 1);
  }

  // B2 非 precheck fail（preCheck=null，如 prestage/标准路径 low）
  {
    const caller = new NarrativeDirectCaller();
    caller._getAnalyzer = async () => ({
      analyze: async () => ({
        numericRating: 1,
        rating: 'low',
        meta: {},
        llmAnalysis: { preCheck: null, prestage: { category: 'project' } },
      }),
    });
    const r = await caller.getRating('0xabc');
    check('非 precheck fail → precheckStage null', r.precheckStage === null);
  }

  // B3 异常路径 → 9 + null
  {
    const caller = new NarrativeDirectCaller();
    caller._getAnalyzer = async () => ({ analyze: async () => { throw new Error('boom'); } });
    const r = await caller.getRating('0xabc');
    check('异常 → numericRating 9 / precheckStage null（不短路不豁免）',
      r.numericRating === 9 && r.precheckStage === null && r.error !== null);
  }

  // B4 numericRating 非 1/2/3（如 null）归一 9
  {
    const caller = new NarrativeDirectCaller();
    caller._getAnalyzer = async () => ({
      analyze: async () => ({ numericRating: null, rating: 'unrated', meta: {}, llmAnalysis: {} }),
    });
    const r = await caller.getRating('0xabc');
    check('numericRating null 归一 9（既有语义回归）', r.numericRating === 9);
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('测试执行异常:', err);
  process.exitCode = 1;
});
