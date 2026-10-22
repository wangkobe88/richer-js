#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v28 → v29（2026-10-22 e8da 案批次二：集中度第一臂/flap 臂放宽 + netBuyRatio 门）
//   三处变更（同一批次用户裁定）：
//   ①集中度第一臂去 mcap<4500 前置——famous<40（含 NULL）即过整臂，五腿组
//     （slope/top1/copy/bundle 钱包段因子）只在 famous>=40 时评估；e8da 案钱包段
//     滞后是极速票挤压根源，第一臂原被 mcap<4500 前置锁死（出生 mcap>4500 永不成立）
//   ②flap 臂去 mcap<4500 豁免——flap 票必须 earlyTradesRouterPct>=30（价格段实时）
//   ③人气门后加 earlyTradesNetBuyRatio >= 50——fire 时刻净/毛比（(买−卖)÷买×100），
//     23 票回放：拦 6 输家+3 平微、误伤 1 平微(PHP+0.0001)、3 赢家全保留（69-73%）；
//     换手出货盘不接。netBuyVolumeBnb 绝对净量轴经回放否决（腰斩族 12/12 全过，
//     真实买入后砸盘非对倒）
//   ⚠️ copy-in 快照语义：改库不影响在跑实验，新建实验引用 v29 才生效。
// 防呆：断言 v28 + 三处旧形状精确子串在 → 替换 → 断言零残留/其余子句原样/
//   trigger 门不动；不匹配即失败退出。
// 用法：node scripts/bump-buy-v2-v29.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const FIELD = 'condition';
const CHANGES = [
  {
    tag: '①集中度第一臂去 mcap<4500',
    old: '((marketCap < 4500 AND (famousCopyWalletCircPct IS NULL OR famousCopyWalletCircPct < 40)) OR',
    neu: '((famousCopyWalletCircPct IS NULL OR famousCopyWalletCircPct < 40) OR',
  },
  {
    tag: '②flap 臂去 mcap<4500 豁免',
    old: "(platform != 'flap' OR marketCap < 4500 OR earlyTradesRouterPct >= 30)",
    neu: "(platform != 'flap' OR earlyTradesRouterPct >= 30)",
  },
  {
    tag: '③+netBuyRatio>=50',
    old: ' AND (buyVolumeBnb >= 1.25 OR holders >= 10)',
    neu: ' AND (buyVolumeBnb >= 1.25 OR holders >= 10) AND earlyTradesNetBuyRatio >= 50',
  },
];
const OTHER_CLAUSES = [ // 其余子句原样断言（防替换时误伤）
  'tokenAgeSec < 90',
  'marketCap < 12000',
  '(narrativeRating == 2 OR narrativeRating == 3)',
  '(holderTrendSlope > 0 AND bundleClusterSharePct < 50 AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20)',
  'earlyTradesPerWallet < 4',
  '(famousCopyWalletCircPct IS NULL OR famousCopyWalletCircPct < 15)',
  '(sybilClusterHolderCircPct IS NULL OR sybilClusterHolderCircPct < 35)',
  'drawdownFromHighest > -70',
  '(crashSpeedPctPerSec IS NULL OR crashSpeedPctPerSec > -10)',
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== 28) throw new Error(`buy-v2 版本=${entry.version}，期望 28（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);

  const hits = full.legs
    .map((leg, i) => ({ i, cond: leg[FIELD] }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes(CHANGES[0].old));
  if (hits.length !== 1) throw new Error(`含旧第一臂形状的腿数=${hits.length}（期望恰好 1）`);
  const legIdx = hits[0].i;
  let cond = full.legs[legIdx][FIELD];
  for (const c of CHANGES) {
    if (cond.split(c.old).length !== 2) throw new Error(c.tag + '：旧子串非恰好一次: ' + c.old);
    cond = cond.replace(c.old, c.neu);
    // ③ 新子串以旧子串为前缀（旧子串仍在但恰一次）属预期；①② 新不含旧、残留即错
    const oldCnt = cond.split(c.old).length - 1;
    if (oldCnt !== (c.neu.includes(c.old) ? 1 : 0)) throw new Error(c.tag + '：替换后旧形状残留 ' + oldCnt + ' 次');
  }
  // 后置断言
  for (const c of CHANGES) if (cond.split(c.neu).length !== 2) throw new Error(c.tag + '：新子串非恰好一次');
  for (const clause of OTHER_CLAUSES) {
    if (!cond.includes(clause)) throw new Error(`替换后其余子句丢失: ${clause}`);
  }
  if (cond.includes('AND AND') || cond.includes('()')) throw new Error('替换后形状异常（连续 AND/空括号）');
  if (full.legs[legIdx].narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期（不动它，人工核对）: ' + full.legs[legIdx].narrativeTriggerCondition);
  }

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log(`new ${FIELD}:`, cond);
  const newDescription = 'v29（2026-10-22 e8da 案批次二）：①集中度第一臂去 mcap<4500 前置——famous<40（含 '
    + 'NULL）即过整臂，五腿组只在 famous>=40 评估（钱包段滞后是极速票挤压根源）②flap 臂去 '
    + 'mcap<4500 豁免——必须 earlyTradesRouterPct>=30 ③人气门后加 earlyTradesNetBuyRatio >= 50'
    + '（fire 时刻净/毛比，23 票回放拦 6 输家+3 平微误伤 1 平微、3 赢家全保留 69-73%；换手出货盘'
    + '不接；绝对净量轴 netBuyVolumeBnb 经回放否决——腰斩族 12/12 fire 净 2.09-4.68 全过，真实买入'
    + '后砸盘非对倒）。发起门不动。⚠️copy-in：改库不即时生效，需新建实验引用 v29。';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const legs = JSON.parse(JSON.stringify(full.legs));
  legs[legIdx][FIELD] = cond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs,
    expectedVersion: 28,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
