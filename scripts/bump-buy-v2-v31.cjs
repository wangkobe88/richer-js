#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v30 → v31（2026-10-22 GMGN bundler 门收紧 75 → 65）
//   唯一变更（用户指令）：gmgnCheckCondition 首臂 gmgnBundlerWalletRatio <= 75 → <= 65。
//   narrativeCategory IS NULL 前置臂=字符串枚举 fail-open 语义（单测锁死）刻意不动；
//   与 2026-10-22 去 NULL 批次（famous/sybil/crashSpeed 数值键）无关。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验，新建实验引用 v31 才生效。
// 防呆：断言 v30 + 旧形状精确子串恰一替换 → 新子串恰一/condition 零波及/trigger 不动。
// 用法：node scripts/bump-buy-v2-v31.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const FIELD = 'gmgnCheckCondition';
const OLD_SEG = 'gmgnBundlerWalletRatio <= 75';
const NEW_SEG = 'gmgnBundlerWalletRatio <= 65';
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== 30) throw new Error(`buy-v2 版本=${entry.version}，期望 30（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;

  const hits = legs
    .map((leg, i) => ({ i, cond: leg[FIELD] }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes(OLD_SEG));
  if (hits.length !== 1) throw new Error(`含 ${OLD_SEG} 的腿数=${hits.length}（期望恰好 1）`);
  const legIdx = hits[0].i;
  const oldCond = legs[legIdx][FIELD];
  if (oldCond.split(OLD_SEG).length !== 2) throw new Error('旧子串非恰好一次: ' + OLD_SEG);
  const cond = oldCond.replace(OLD_SEG, NEW_SEG);
  if (cond.split(NEW_SEG).length !== 2) throw new Error('新子串非恰好一次');
  if (cond.length !== oldCond.length) throw new Error('长度异常（应仅一字之差）');
  // fire condition 与 trigger 不动（防误伤）
  if (legs[legIdx].condition !== legs[legIdx].condition) throw new Error('unreachable');
  if (legs[legIdx].narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期: ' + legs[legIdx].narrativeTriggerCondition);
  }

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log(`new ${FIELD}:`, cond);
  const newDescription = (full.description || '') + ' | 2026-10-22 v31（用户指令）：gmgnCheckCondition '
    + 'bundlerWalletRatio 门收紧 75→65（高 bundler 盘更早拒）；narrativeCategory IS NULL 臂为'
    + '字符串枚举 fail-open 语义不动。⚠️copy-in：需新建实验引用 v31。';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const outLegs = JSON.parse(JSON.stringify(legs));
  outLegs[legIdx][FIELD] = cond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs: outLegs,
    expectedVersion: 30,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
