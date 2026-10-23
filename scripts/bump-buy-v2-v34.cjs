#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v33 → v34（2026-10-23 ₿DOG 案 0x85cd…7777：市值门放宽）
//   唯一变更（用户裁定）：fire condition `marketCap < 15000` → `< 20000`
//   （USD。案发：₿DOG 叙事 high 87.32 于 03:00:12 落地，但市值第 11 秒已破 15K
//   出窗（11 秒毕业盘），rating 落地时 29K——15K 帽接不住超快盘，放宽至 20K。）
//   gmgnCheckCondition / 发起门 / 其余臂不动。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验（重启也不影响——重启重读的也是
//   实验 config 快照），新建实验引用 v34 才生效。
// 防呆：断言 v33 + 旧子串恰一替换 → 新子串恰一 / gmgn 与 trigger 不动。
// 用法：node scripts/bump-buy-v2-v34.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const OLD_SEG = 'marketCap < 15000';
const NEW_SEG = 'marketCap < 20000';
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_EXPECT = "gmgnBundlerWalletRatio <= 65 AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early' AND narrativeCategory != 'event:W')) OR gmgnIssuerTokenCount <= 1)";

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== 33) throw new Error(`buy-v2 版本=${entry.version}，期望 33（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;

  const hits = legs
    .map((leg, i) => ({ i, cond: leg.condition }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes(OLD_SEG));
  if (hits.length !== 1) throw new Error(`fire condition 含市值门旧子串的腿数=${hits.length}（期望恰好 1）`);
  const legIdx = hits[0].i;
  const oldCond = legs[legIdx].condition;
  if (oldCond.split(OLD_SEG).length !== 2) throw new Error('旧子串非恰好一次: ' + OLD_SEG);
  const cond = oldCond.replace(OLD_SEG, NEW_SEG);
  if (cond.split(NEW_SEG).length !== 2) throw new Error('新子串非恰好一次');
  if (cond.includes(OLD_SEG)) throw new Error('替换后仍含旧子串');
  // gmgn 门与发起门不动（防误伤）
  if (legs[legIdx].gmgnCheckCondition !== GMGN_EXPECT) {
    throw new Error('gmgnCheckCondition 非 v33 形状（本批不动它）: ' + legs[legIdx].gmgnCheckCondition);
  }
  if (legs[legIdx].narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期: ' + legs[legIdx].narrativeTriggerCondition);
  }

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log('new condition:', cond);
  const newDescription = (full.description || '') + ' | 2026-10-23 v34（用户裁定）：市值门 15000→20000 USD'
    + '（₿DOG 11 秒毕业案：叙事 high 落地时市值 29K 已出 15K 窗，超快盘接不住）。'
    + '⚠️copy-in：需新建实验引用 v34 才生效。';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const outLegs = JSON.parse(JSON.stringify(legs));
  outLegs[legIdx].condition = cond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs: outLegs,
    expectedVersion: 33,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
