#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v37 → v38（2026-10-26 T68 用户裁定：top3 观察键转门，阈值 75）
//   唯一变更：top2 臂后追加 `AND top3BundleClusterHoldCircPct < 75`
//   （邪恶卡皮 0x4e7e…7777 案：fire 时 top1=28.5/top2=53.4 均过门、top3=77.8=
//   前三块买家并集囤 3/4 流通，4 分钟即卖；重放 fire tick t1/t2 与快照逐位一致。
//   阈值 75 用户拍板——拦 77.8、放 74 以下）。其余臂全部不动。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验，新建实验引用 v38 才生效。
//   ⚠️ 进程代码须含 top3BundleClusterHoldCircPct（4ef5109）。
// 防呆：断言 v37 + 旧子串恰一替换 → 新子串恰一 / gmgn 与 trigger 不动 /
//   兄弟门锚定（bundle<35/top1<35/sybil<35/T63 age 臂）恰一次在场。
// 用法：node scripts/bump-buy-v2-v38.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const OLD_SEG = 'top2BundleClusterHoldCircPct < 55';
const NEW_SEG = 'top2BundleClusterHoldCircPct < 55 AND top3BundleClusterHoldCircPct < 75';
const KEEP_SEGS = [
  'bundleClusterHoldCircPct < 35',
  'top1HolderCircPct < 35',
  'sybilClusterHolderCircPct < 35',
  'marketCap < 20000',
  '(tradeCount >= 25 AND tokenAgeSec < 600)', // T63 慢热或臂（不动）
  'holderTrendSlope > 0',
  '(narrativeRating == 2 OR narrativeRating == 3)',
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_EXPECT = "gmgnBundlerWalletRatio <= 65 AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early' AND narrativeCategory != 'event:W')) OR gmgnIssuerTokenCount <= 1)";

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== 37) throw new Error(`buy-v2 版本=${entry.version}，期望 37（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;

  const hits = legs
    .map((leg, i) => ({ i, cond: leg.condition }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes(OLD_SEG));
  if (hits.length !== 1) throw new Error(`fire condition 含 top2 门的腿数=${hits.length}（期望恰好 1）`);
  const legIdx = hits[0].i;
  const oldCond = legs[legIdx].condition;
  if (oldCond.split(OLD_SEG).length !== 2) throw new Error('旧子串非恰好一次: ' + OLD_SEG);
  if (oldCond.includes('top3BundleClusterHoldCircPct')) throw new Error('v37 条件已含 top3 门（谱系核对）');
  const cond = oldCond.replace(OLD_SEG, NEW_SEG);
  if (cond.split(NEW_SEG).length !== 2) throw new Error('新子串非恰好一次');
  // 兄弟门锚定（防误伤）
  for (const seg of KEEP_SEGS) {
    if (cond.split(seg).length !== 2) throw new Error(`防误伤锚定子串非恰一次: ${seg}`);
  }
  // gmgn 门与发起门不动（防误伤）
  if (legs[legIdx].gmgnCheckCondition !== GMGN_EXPECT) {
    throw new Error('gmgnCheckCondition 非 v37 形状（本批不动它）: ' + legs[legIdx].gmgnCheckCondition);
  }
  if (legs[legIdx].narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期: ' + legs[legIdx].narrativeTriggerCondition);
  }

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log('new condition:', cond);
  const newDescription = (full.description || '') + ' | 2026-10-26 v38（T68 用户裁定）：top3 观察键转门 '
    + 'top3BundleClusterHoldCircPct < 75（最大三块买家并集去重正净持仓÷流通；不足三块退化=top2；恒≥top2≥top1——'
    + '邪恶卡皮案 fire 77.8 前三块囤 3/4 流通；代码须含 4ef5109）。⚠️copy-in：需新建实验引用 v38 才生效。'
    + '详档 docs/交易策略改进与Case台账.md T68';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const outLegs = JSON.parse(JSON.stringify(legs));
  outLegs[legIdx].condition = cond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs: outLegs,
    expectedVersion: 37,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
