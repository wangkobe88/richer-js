#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v31 → v32（2026-10-22 赵长鹏能飞案：市值上限臂放宽 12000 → 15000）
//   唯一变更（用户指令）：fire condition `marketCap < 12000` → `marketCap < 15000`
//   （起因 0x0d2cd4ec…7777：叙事 5s 极速 rating=3 时市值已 13.5K 全程不回落=结构性
//   拒买；15000 恰回 v11 时代 15K 门刻度。marketCap > 3500 下限臂不动。）
//   gmgnCheckCondition / 发起门 / 其余臂不动。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验，新建实验引用 v32 才生效。
// 防呆：断言 v31 + 旧子串恰一替换 → 新子串恰一 / gmgn 与 trigger 不动。
// 用法：node scripts/bump-buy-v2-v32.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const OLD_SEG = 'marketCap < 12000';
const NEW_SEG = 'marketCap < 15000';
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_EXPECT = "gmgnBundlerWalletRatio <= 65 AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early' AND narrativeCategory != 'event:W')) OR gmgnIssuerTokenCount <= 1)";

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== 31) throw new Error(`buy-v2 版本=${entry.version}，期望 31（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;

  const hits = legs
    .map((leg, i) => ({ i, cond: leg.condition }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes(OLD_SEG));
  if (hits.length !== 1) throw new Error(`fire condition 含「${OLD_SEG}」的腿数=${hits.length}（期望恰好 1）`);
  const legIdx = hits[0].i;
  const oldCond = legs[legIdx].condition;
  if (oldCond.split(OLD_SEG).length !== 2) throw new Error('旧子串非恰好一次: ' + OLD_SEG);
  const cond = oldCond.replace(OLD_SEG, NEW_SEG);
  if (cond.split(NEW_SEG).length !== 2) throw new Error('新子串非恰好一次');
  if (cond.length !== oldCond.length) throw new Error('长度异常（应仅等宽替换）');
  // gmgn 门与发起门不动
  if (legs[legIdx].gmgnCheckCondition !== GMGN_EXPECT) {
    throw new Error('gmgnCheckCondition 非 v31 形状（本批不动它）: ' + legs[legIdx].gmgnCheckCondition);
  }
  if (legs[legIdx].narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期: ' + legs[legIdx].narrativeTriggerCondition);
  }

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log('new condition:', cond);
  const newDescription = (full.description || '') + ' | 2026-10-22 v32（赵长鹏能飞案用户指令）：市值上限臂'
    + ' 12000 → 15000（叙事极速 rating=3 时市值 13.5K 全程不回落的结构性拒买形状；下限 3500 不动）。'
    + '⚠️copy-in：需新建实验引用 v32。';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const outLegs = JSON.parse(JSON.stringify(legs));
  outLegs[legIdx].condition = cond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs: outLegs,
    expectedVersion: 31,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
