#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v35 → v36（2026-10-25 两口径 A/B 对比用户裁定：bundle 门换存量口径）
//   唯一变更：fire condition `bundleClusterSharePct < 35` → `bundleClusterHoldCircPct < 35`
//   （cf3d8177 13 票真 FA 重放 A/B：流量口径合计 66.5% vs 存量口径 107.8%（+41.3pp）；
//   流量门拦「10s 内簇主导买盘」误伤快进快出交易簇（BNB Legend 流量 100 误拦 34s），
//   存量门拦「簇真持仓≥35%」（月亮币提前 15s 放行；对真囤簇更晚放=OST 形状已知盲区
//   用户裁定接受）。阈值 35 不动。v35 的慢热或臂（T63 灰灰案）不动。）
//   gmgnCheckCondition / 发起门 / 其余臂不动。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验（重启也不影响——重启重读的也是
//   实验 config 快照），新建实验引用 v36 才生效。
// 防呆：断言 v35 + 旧子串恰一替换 → 新子串恰一 / gmgn 与 trigger 不动 /
//   同阈值兄弟门 sybilClusterHolderCircPct < 35 在场不动（防误伤同 35 字面）/
//   T63 age 新臂在场不动。
// 用法：node scripts/bump-buy-v2-v36.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const OLD_SEG = 'bundleClusterSharePct < 35';
const NEW_SEG = 'bundleClusterHoldCircPct < 35';
const KEEP_SEGS = [
  'sybilClusterHolderCircPct < 35',
  'top1HolderCircPct < 35',
  'marketCap < 20000',
  '(tradeCount >= 25 AND tokenAgeSec < 600)', // T63 慢热或臂（v35，不动）
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
  if (entry.version !== 35) throw new Error(`buy-v2 版本=${entry.version}，期望 35（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;

  const hits = legs
    .map((leg, i) => ({ i, cond: leg.condition }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes(OLD_SEG));
  if (hits.length !== 1) throw new Error(`fire condition 含 bundle 旧门子串的腿数=${hits.length}（期望恰好 1）`);
  const legIdx = hits[0].i;
  const oldCond = legs[legIdx].condition;
  if (oldCond.split(OLD_SEG).length !== 2) throw new Error('旧子串非恰好一次: ' + OLD_SEG);
  const cond = oldCond.replace(OLD_SEG, NEW_SEG);
  if (cond.split(NEW_SEG).length !== 2) throw new Error('新子串非恰好一次');
  if (cond.includes(OLD_SEG)) throw new Error('替换后仍含旧子串');
  // 兄弟门/T63 臂不动（防误伤：两个 <35 兄弟门 + age 新臂须原样恰一次在场）
  for (const seg of KEEP_SEGS) {
    if (cond.split(seg).length !== 2) throw new Error(`防误伤锚定子串非恰一次: ${seg}`);
  }
  // gmgn 门与发起门不动（防误伤）
  if (legs[legIdx].gmgnCheckCondition !== GMGN_EXPECT) {
    throw new Error('gmgnCheckCondition 非 v35 形状（本批不动它）: ' + legs[legIdx].gmgnCheckCondition);
  }
  if (legs[legIdx].narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期: ' + legs[legIdx].narrativeTriggerCondition);
  }

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log('new condition:', cond);
  const newDescription = (full.description || '') + ' | 2026-10-25 v36（用户裁定，A/B 对比 +41.3pp）：bundle 门流量口径→存量口径'
    + ' bundleClusterSharePct → bundleClusterHoldCircPct（全块 max 当前正净持仓÷流通，阈值 35 不动；'
    + '流量门误伤快进快出交易簇，存量门拦真囤簇；代码须含新因子）。⚠️copy-in：需新建实验引用 v36 才生效。'
    + '（补注：v34=市值门 15000→20000（T2）、v35=T63 慢热或臂——两版 description 段佚失，此处回填；'
    + '详档见 docs/交易策略改进与Case台账.md T2/T63）';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const outLegs = JSON.parse(JSON.stringify(legs));
  outLegs[legIdx].condition = cond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs: outLegs,
    expectedVersion: 35,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
