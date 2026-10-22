#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v27 → v28（2026-10-22 e8da MAYA 案配套：人气门 AND→OR）
//   语义变更背景：2026-10-19 上线的人气门「buyVolumeBnb >= 1.25 AND holders >= 10」
//   是合取。e8da MAYA 案（0xe8da305a…7777）实证：holders 是钱包段因子（sender
//   RPC 回查滞后 1.5-2s+，新票首秒钱包全首见零缓存），buyVolumeBnb 是价格段因子
//   （WSS 到达即喂）；极速票 mcap<12000 即时冲破窗与 holders 收敛到 10 的时刻
//   不相交（tick-time 35.0 才到 11，全过窗 36.0-37.3 已出）→ 等冲破门变恒假。
//   用户裁定改 OR：单轴 buyVolumeBnb（价格段实时）即可过人气门。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验（v28 持 v27 快照），新建实验引用
//   v28 才生效；中间态安全（在跑 v27 快照照常评估，无空窗）。
// 防呆：断言 v27 + 旧合取段精确子串在（含前导 AND）→ 括号化 OR 替换 → 断言
//   零残留/其余子句原样/trigger 门不动；不匹配即失败退出。
// 用法：node scripts/bump-buy-v2-v28.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const OLD_SEGMENT = ' AND buyVolumeBnb >= 1.25 AND holders >= 10';
const NEW_SEGMENT = ' AND (buyVolumeBnb >= 1.25 OR holders >= 10)';
const FIELD = 'condition';
const OTHER_CLAUSES = [ // 其余子句原样断言（防替换时误伤）
  'tokenAgeSec < 90',
  'marketCap < 12000',
  '(narrativeRating == 2 OR narrativeRating == 3)',
  '(holderTrendSlope > 0 AND bundleClusterSharePct < 50 AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20)',
  "(platform != 'flap' OR marketCap < 4500 OR earlyTradesRouterPct >= 30)",
  'earlyTradesPerWallet < 4',
  '(sybilClusterHolderCircPct IS NULL OR sybilClusterHolderCircPct < 35)',
  'drawdownFromHighest > -70',
  '(crashSpeedPctPerSec IS NULL OR crashSpeedPctPerSec > -10)',
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1'; // 发起门量轴序不动

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== 27) throw new Error(`buy-v2 版本=${entry.version}，期望 27（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);

  // 定位含旧合取段的腿（防呆：恰好一腿命中，多腿/零腿均失败退出）
  const hits = full.legs
    .map((leg, i) => ({ i, cond: leg[FIELD] }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes(OLD_SEGMENT));
  if (hits.length !== 1) {
    full.legs.forEach((leg, i) => console.log(`腿[${i}] ${FIELD}:`, leg[FIELD]));
    throw new Error(`含旧人气门合取段的腿数=${hits.length}（期望恰好 1）`);
  }
  const legIdx = hits[0].i;
  const oldCond = full.legs[legIdx][FIELD];
  const newCond = oldCond.replace(OLD_SEGMENT, NEW_SEGMENT);

  // 后置断言：新段恰一次 / 旧裸合取零残留 / 其余子句原样 / 形状健全
  if (newCond.split(NEW_SEGMENT).length !== 2) throw new Error('替换后新段非恰好一次');
  if (newCond.includes('buyVolumeBnb >= 1.25 AND holders >= 10')) throw new Error('替换后仍残留旧合取');
  for (const clause of OTHER_CLAUSES) {
    if (!newCond.includes(clause)) throw new Error(`替换后其余子句丢失: ${clause}`);
  }
  if (newCond.includes('AND AND') || newCond.includes('()')) throw new Error('替换后形状异常（连续 AND/空括号）');
  if (full.legs[legIdx].narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期（不动它，人工核对）: ' + full.legs[legIdx].narrativeTriggerCondition);
  }

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log(`old ${FIELD}:`, oldCond);
  console.log(`new ${FIELD}:`, newCond);
  const newDescription = 'v28（2026-10-22 e8da MAYA 案）：人气门 AND→OR——buyVolumeBnb>=1.25 与 '
    + 'holders>=10 由合取改析取。归因：holders 是钱包段因子（sender RPC 回查滞后 1.5-2s+，新票首秒'
    + '钱包全首见零缓存），buyVolumeBnb 是价格段因子（WSS 到达即喂）；极速票 mcap<12000 即时冲破窗与 '
    + 'holders 收敛时刻不相交（e8da 案 tick-time 35.0 才到 11，全过窗 36.0-37.3 已出）→ 等冲破门变'
    + '恒假没买（兄弟票 eb2f 反而买了）。OR 后单轴 buyVolumeBnb（价格段实时）即可过人气门。发起门 '
    + 'buyVolumeBnb>=0.1 量轴序不动。⚠️copy-in：改库不即时生效，需新建实验引用 v28。';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const legs = JSON.parse(JSON.stringify(full.legs));
  legs[legIdx][FIELD] = newCond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs,
    expectedVersion: 27,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
