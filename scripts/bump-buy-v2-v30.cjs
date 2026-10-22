#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v29 → v30（2026-10-22 五腿案批次：AND 化 + 去 IS NULL + bundle 50→35）
//   四处变更（同一批次用户裁定「A+B 确认，bundle 改 35」）：
//   ①集中度组 AND 化去 famous<40 豁免臂——五腿（slope/bundle/top1/copy）无条件评估；
//     famous<40 臂删除（被保留的独立 famous<15 门蕴含，行为上臂恒真=冗余项）
//   ②bundleClusterSharePct 50 → 35（v22-v24 111 票回放同阈值锚）
//   ③④⑤去 IS NULL 臂（famous<15 / sybil<35 / crashSpeed>-10）：配套 FA 因子语义
//     去 NULL（2026-10-22 裁定「最低是 0」——未启用/无暴跌=0，裸比较与原
//     IS NULL 臂逐输入等价）；主名单 maxCopyWalletHolderCircPct 维持 null=裸比较
//     恒 false 拦截（fail-closed 不变，无 IS NULL 臂可去）
//   ⚠️ copy-in 快照语义：改库不影响在跑实验，新建实验引用 v30 才生效。
// 防呆：断言 v29 + 旧形状精确子串在 → 替换 → 断言零残留（含全串零 'IS NULL'）/
//   其余子句原样/trigger 门不动；不匹配即失败退出。
// 用法：node scripts/bump-buy-v2-v30.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const FIELD = 'condition';
const CHANGES = [
  {
    tag: '①集中度组 AND 化（五腿无条件）+ ②bundle 50→35',
    old: '((famousCopyWalletCircPct IS NULL OR famousCopyWalletCircPct < 40) OR (holderTrendSlope > 0 AND bundleClusterSharePct < 50 AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20))',
    neu: 'holderTrendSlope > 0 AND bundleClusterSharePct < 35 AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20',
  },
  {
    tag: '③famous<15 去 IS NULL 臂',
    old: '(famousCopyWalletCircPct IS NULL OR famousCopyWalletCircPct < 15)',
    neu: 'famousCopyWalletCircPct < 15',
  },
  {
    tag: '④sybil<35 去 IS NULL 臂',
    old: '(sybilClusterHolderCircPct IS NULL OR sybilClusterHolderCircPct < 35)',
    neu: 'sybilClusterHolderCircPct < 35',
  },
  {
    tag: '⑤crashSpeed>-10 去 IS NULL 臂',
    old: '(crashSpeedPctPerSec IS NULL OR crashSpeedPctPerSec > -10)',
    neu: 'crashSpeedPctPerSec > -10',
  },
];
const OTHER_CLAUSES = [ // 其余子句原样断言（防替换时误伤）
  'tokenAgeSec < 90',
  'marketCap > 3500',
  'marketCap < 12000',
  '(narrativeRating == 2 OR narrativeRating == 3)',
  "(platform != 'flap' OR earlyTradesRouterPct >= 30)",
  'earlyTradesPerWallet < 4',
  '(buyVolumeBnb >= 1.25 OR holders >= 10)',
  'earlyTradesNetBuyRatio >= 50',
  'drawdownFromHighest > -70',
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== 29) throw new Error(`buy-v2 版本=${entry.version}，期望 29（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);

  const hits = full.legs
    .map((leg, i) => ({ i, cond: leg[FIELD] }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes(CHANGES[0].old));
  if (hits.length !== 1) throw new Error(`含旧集中度组形状的腿数=${hits.length}（期望恰好 1）`);
  const legIdx = hits[0].i;
  let cond = full.legs[legIdx][FIELD];
  for (const c of CHANGES) {
    if (cond.split(c.old).length !== 2) throw new Error(c.tag + '：旧子串非恰好一次: ' + c.old);
    cond = cond.replace(c.old, c.neu);
    if (cond.includes(c.old)) throw new Error(c.tag + '：替换后旧形状残留');
  }
  // 后置断言
  for (const c of CHANGES) if (cond.split(c.neu).length !== 2) throw new Error(c.tag + '：新子串非恰好一次');
  if (cond.includes('IS NULL')) throw new Error('替换后仍含 IS NULL（去 NULL 批次要求零残留）');
  for (const clause of OTHER_CLAUSES) {
    if (!cond.includes(clause)) throw new Error(`替换后其余子句丢失: ${clause}`);
  }
  if (cond.includes('AND AND') || cond.includes('()')) throw new Error('替换后形状异常（连续 AND/空括号）');
  if (full.legs[legIdx].narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期（不动它，人工核对）: ' + full.legs[legIdx].narrativeTriggerCondition);
  }

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log(`new ${FIELD}:`, cond);
  const newDescription = 'v30（2026-10-22 五腿案批次，用户裁定 A+B+bundle35）：①集中度组 AND 化——五腿'
    + '（slope>0/bundle<35/top1<35/copy<20）无条件评估，famous<40 豁免臂删除（被独立 famous<15 门蕴含，'
    + 'v29 形状下 287 票 famous≥40 零出现=五腿死代码）②bundle 50→35 ③④⑤去 IS NULL 臂（famous<15/'
    + 'sybil<35/crashSpeed>-10）——配套 FA 因子语义去 NULL（未启用/无暴跌最低 0，裸比较与原 IS NULL 臂'
    + '逐输入等价）；maxCopyWalletHolderCircPct 维持 null=恒 false 拦截（fail-closed 无臂可去）。'
    + '静态回放：五腿无条件拦 179/287、被拦净 -0.0211；bundle 35 增拦 55 票净 -0.0291。发起门不动。'
    + '⚠️copy-in：改库不即时生效，需新建实验引用 v30。';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const legs = JSON.parse(JSON.stringify(full.legs));
  legs[legIdx][FIELD] = cond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs,
    expectedVersion: 29,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
