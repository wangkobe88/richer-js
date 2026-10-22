#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v32 → v33（2026-10-22 人气门去簇口径）
//   唯一变更（用户指令）：fire condition 人气门 `(buyVolumeBnb >= 1.25 OR
//   holders >= 10)` → `(buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10)`
//   （协同簇钱包的买入量与持有者席不计人气——对倒垫人气失效；原键保留：卖腿
//   死票臂 buyVolumeBnb < 2=退出流动性、发起门 0.1 原轴不变。新键=FA 22f799d
//   起 provide，⚠️ 实验进程须跑 ≥22f799d 代码否则 loadStrategies 未知因子拒启。）
//   gmgnCheckCondition / 发起门 / 其余臂不动。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验，新建实验引用 v33 才生效。
// 防呆：断言 v32 + 旧子串恰一替换 → 新子串恰一 / gmgn 与 trigger 不动。
// 用法：node scripts/bump-buy-v2-v33.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const OLD_SEG = '(buyVolumeBnb >= 1.25 OR holders >= 10)';
const NEW_SEG = '(buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10)';
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_EXPECT = "gmgnBundlerWalletRatio <= 65 AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early' AND narrativeCategory != 'event:W')) OR gmgnIssuerTokenCount <= 1)";

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== 32) throw new Error(`buy-v2 版本=${entry.version}，期望 32（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;

  const hits = legs
    .map((leg, i) => ({ i, cond: leg.condition }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes(OLD_SEG));
  if (hits.length !== 1) throw new Error(`fire condition 含人气门旧子串的腿数=${hits.length}（期望恰好 1）`);
  const legIdx = hits[0].i;
  const oldCond = legs[legIdx].condition;
  if (oldCond.split(OLD_SEG).length !== 2) throw new Error('旧子串非恰好一次: ' + OLD_SEG);
  const cond = oldCond.replace(OLD_SEG, NEW_SEG);
  if (cond.split(NEW_SEG).length !== 2) throw new Error('新子串非恰好一次');
  if (cond.includes(OLD_SEG)) throw new Error('替换后仍含旧子串');
  // gmgn 门与发起门不动（防误伤）
  if (legs[legIdx].gmgnCheckCondition !== GMGN_EXPECT) {
    throw new Error('gmgnCheckCondition 非 v32 形状（本批不动它）: ' + legs[legIdx].gmgnCheckCondition);
  }
  if (legs[legIdx].narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期: ' + legs[legIdx].narrativeTriggerCondition);
  }

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log('new condition:', cond);
  const newDescription = (full.description || '') + ' | 2026-10-22 v33（用户指令）：人气门去簇口径'
    + '——buyVolumeBnb >= 1.25 OR holders >= 10 扣除协同簇钱包（sybil-clusters 名单）买入量与'
    + '持有者席，对倒垫人气失效；原键不动（死票臂/发起门原轴）。⚠️copy-in：需新建实验引用 v33'
    + '（进程代码须 ≥22f799d，新键 loadStrategies 校验依赖）。';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const outLegs = JSON.parse(JSON.stringify(legs));
  outLegs[legIdx].condition = cond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs: outLegs,
    expectedVersion: 32,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
