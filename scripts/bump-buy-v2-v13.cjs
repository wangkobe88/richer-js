#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v12 → v13（2026-10-16 C74 啾啾案配套：时效门迁入叙事引擎）
//   语义变更背景：preBuyCheckCondition 裸 `narrativeCorpusLagSec < 300` 子句
//   relocate 到叙事 precheck 规则 2.1 分桶（非豁免桶 300s 硬拦 / direct_tweet
//   豁免跳过交 Jev 软评）。本 bump 删买腿该子句；因子计算链不动（转纯观察键，
//   signal metadata 照落）。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验（v18 持 v12 快照），新实验建出引用
//   v13 才真正生效；中间态安全（新引擎+v12 快照=豁免票 rating 翻 2/3 也被残余
//   lag<300 拦住，双门一致无空窗）。
// 防呆：断言 v12 + 旧子句精确子串在（含前导 AND）→ 替换 → 断言零残留/其余子句
//   原样；repeatBuyCheckCondition 同扫含该因子即 fail-loud；不匹配即失败退出。
// 用法：node scripts/bump-buy-v2-v13.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const OLD_SEGMENT = ' AND narrativeCorpusLagSec < 300';
const FACTOR = 'narrativeCorpusLagSec';
const FIELD = 'preBuyCheckCondition';
const OTHER_CLAUSES = [ // 其余子句原样断言（防替换时误伤）
  '(narrativeRating == 2 OR narrativeRating == 3)',
  '(platform != \'flap\' OR earlyTradesRouterPct >= 30)',
  'earlyTradesUniqueWallets >= 15',
  'earlyTradesPerWallet < 4',
];

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== 12) throw new Error(`buy-v2 版本=${entry.version}，期望 12（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);

  // repeatBuyCheckCondition 同扫：该字段不该含 lag 因子（fail-loud 防第二落点漏删）
  for (const [i, leg] of full.legs.entries()) {
    if (typeof leg.repeatBuyCheckCondition === 'string' && leg.repeatBuyCheckCondition.includes(FACTOR)) {
      throw new Error(`腿[${i}] repeatBuyCheckCondition 也含 ${FACTOR}，人工核对是否同删：${leg.repeatBuyCheckCondition}`);
    }
  }

  // 定位含旧形状的腿（防呆：恰好一腿命中，多腿/零腿均失败退出）
  const hits = full.legs
    .map((leg, i) => ({ i, cond: leg[FIELD] }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes(OLD_SEGMENT));
  if (hits.length !== 1) {
    full.legs.forEach((leg, i) => console.log(`腿[${i}] ${FIELD}:`, leg[FIELD]));
    throw new Error(`含旧 lag 子句的腿数=${hits.length}（期望恰好 1），人工核对（C71 删右支后可能有残括号形状）`);
  }
  const legIdx = hits[0].i;
  const oldCond = full.legs[legIdx][FIELD];
  const newCond = oldCond.replace(OLD_SEGMENT, '');

  // 后置断言：零残留 / 其余子句原样
  if (newCond.includes(FACTOR)) throw new Error('替换后仍残留 ' + FACTOR);
  for (const clause of OTHER_CLAUSES) {
    if (!newCond.includes(clause)) throw new Error(`替换后其余子句丢失: ${clause}`);
  }
  if (newCond.includes('AND AND') || newCond.includes('()')) throw new Error('替换后形状异常（连续 AND/空括号）');

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log(`old ${FIELD}:`, oldCond);
  console.log(`new ${FIELD}:`, newCond);
  const newDescription = 'v13（2026-10-16 C74 啾啾案配套）：删 preBuyCheckCondition 裸 narrativeCorpusLagSec<300 '
    + '子句——时效硬拦迁入叙事 precheck 规则 2.1 分桶（非豁免桶 angle/interpretive/unknown 300s，'
    + 'direct_tweet 高影响力新闻推豁免交 Jev event_timing 软评）；因子转纯观察键照落 metadata。'
    + '无锚语料（account/纯 IG）随之放宽：评级 2/3 即可买。⚠️copy-in：改库不即时生效，'
    + '需新建实验引用 v13；新旧评级混合期分布不可比。';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const legs = JSON.parse(JSON.stringify(full.legs));
  legs[legIdx][FIELD] = newCond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs,
    expectedVersion: 12,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
