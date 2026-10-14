#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v9 → v10（2026-10-14 holderTrend 族 slot 化改造配套）
//   语义变更背景：holderTrend* 11 键原地改语义（10s 墙钟桶×8=80s 窗 →
//   blockNumber 桶×8 块≈4s 窗），旧条件 `(holderTrendGrowthRatio >= 55 OR … IS NULL)
//   AND (holderTrendSlope < 0.55 OR … IS NULL)` 的 OR NULL 臂在新语义下近乎恒真
//   = 门不存在。用户裁定买门形状改为 `holderTrendSlope > 0`（NULL fail-closed，
//   不写 OR NULL——键缺失/值 null 双路 ConditionEvaluator 恒 false）。
//   ⚠️ 与代码改造强耦合同批部署：新代码+旧条件窗口期语义漂移，窗口尽量短。
// 防呆：断言 v9 + 旧两括号项精确子串在 → 替换 → 断言新子句在/旧项零残留/
//   其余子句原样；不匹配即失败退出（人工核对，不盲目改库）。
// 用法：node scripts/bump-buy-v2-v10.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const OLD_SEGMENT = '(holderTrendGrowthRatio >= 55 OR holderTrendGrowthRatio IS NULL) AND (holderTrendSlope < 0.55 OR holderTrendSlope IS NULL)';
const NEW_SEGMENT = 'holderTrendSlope > 0';
const OTHER_CLAUSES = [ // 其余子句原样断言（防替换时误伤）
  'buyVolumeBnb >= 1.5',
  'tokenAgeSec < 90',
  'holders > 5',
  'gmgnUserPct >= 40',
  'marketCap < 15000',
];

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== 9) throw new Error(`buy-v2 版本=${entry.version}，期望 9（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);

  // 定位含旧形状的腿（防呆：恰好一腿命中，多腿/零腿均失败退出）
  const hits = full.legs
    .map((leg, i) => ({ i, cond: leg.condition }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes(OLD_SEGMENT));
  if (hits.length !== 1) {
    full.legs.forEach((leg, i) => console.log(`腿[${i}] condition:`, leg.condition));
    throw new Error(`含旧 holderTrend 段的腿数=${hits.length}（期望恰好 1），人工核对`);
  }
  const legIdx = hits[0].i;
  const oldCond = full.legs[legIdx].condition;
  const newCond = oldCond.replace(OLD_SEGMENT, NEW_SEGMENT);

  // 后置断言：新子句在 / 旧项零残留 / 其余子句原样
  if (!newCond.includes(NEW_SEGMENT)) throw new Error('替换后新子句缺失');
  for (const bad of ['holderTrendGrowthRatio', 'IS NULL']) {
    if (newCond.includes(bad)) throw new Error(`替换后残留旧痕迹: ${bad}`);
  }
  for (const clause of OTHER_CLAUSES) {
    if (!newCond.includes(clause)) throw new Error(`替换后其余子句丢失: ${clause}`);
  }

  console.log('name:   ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log('old fire:', oldCond);
  console.log('new fire:', newCond);
  const newDescription = 'v10（2026-10-14 holderTrend slot 化配套）：holderTrendSlope>0 单门替旧 '
    + 'growthRatio>=55/slope<0.55 双 OR-NULL 门——11 键语义原地改 8 块≈4s 窗（blockNumber 桶），'
    + 'OR NULL 臂失效故换 fail-closed 形状；其余子句零改动（v9 形状：buyVolume 1.5+age 90+holders 5'
    + '+u40+市值门 15K）。代码改造同批部署，历史回测不可比。';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const legs = JSON.parse(JSON.stringify(full.legs));
  legs[legIdx].condition = newCond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs,
    expectedVersion: 9,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
