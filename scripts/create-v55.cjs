#!/usr/bin/env node
// ============================================================================
// 建 v55 live both 实验（2026-10-29 T98 人气门换键换车）
//   克隆 v54 0007ff5a（buy-v2 v49 + buy-early-narrative v9 快照，T96 AND 净买门）。
//   本批唯一 config 变量：两买腿人气段 ← 库 copy-in（v50/v10）——
//     '(buyVolumeBnb >= 1.25 AND holders >= 10)'
//       → '(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)'
//     '(buyVolumeBnb >= 0.25 AND holders >= 5)'
//       → '(buyVolumeBnb >= 0.25 AND holdersExDust >= 5)'
//   用户裁定「极小持仓者剔除（不让假活跃票进门），新搞一个因子替换 holders」。
//   21 卖腿/gmgn/maxExecutions=2/6 卡制/perCardBNB/钱包/其余 config 与 v54 逐字
//   一致。libraryRefs buy-v2 49→50 / early 9→10。
//   ⚠️ 前置：182 已跑 bump-t98-holders-exdust.cjs --commit + 代码在 023befb。
//   ⚠️ copy-in：停 v54 与建 v55 同批（单一实验纪律）；停前持仓确认。
// 防呆：源必须 stopped + 两买腿 T96/T95 形状 + 旧人气段恰一次；库 v50/v10；
//   库/实验 gmgn/trigger 逐字一致；库新条件=源串换人气段逐字一致；买 2/卖 21。
// 用法：node scripts/create-v55.cjs [--commit]   （在 182 跑；先跑 bump-t98 --commit）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '0007ff5a-8a17-4e31-928f-53af7e3f2d2e'; // v54 live both（T96 快照）

const SWAP_MAIN = ['(buyVolumeBnb >= 1.25 AND holders >= 10)', '(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)'];
const SWAP_EARLY = ['(buyVolumeBnb >= 0.25 AND holders >= 5)', '(buyVolumeBnb >= 0.25 AND holdersExDust >= 5)'];

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v54（单一实验纪律+停前持仓确认）；当前 status=' + src.status);
  }
  if (src.status === 'stopped') console.log('注: 源已 stopped');
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 2) throw new Error('源买腿数=' + buys.length + ' 期望 2（主腿+早期臂）');
  if (sells.length !== 21) throw new Error('源卖腿数=' + sells.length + ' 期望 21');

  // ── 源形状锚定（v54 快照：T96 AND 净买门 + T95 早期臂 45/75 + 旧 holders 人气段）──
  for (const [i, leg] of buys.entries()) {
    for (const bad of ['tradesRouterPct', 'sybilClusterHolderCircPct', 'top2BundleClusterHoldCircPct', 'bundleClusterHoldCircPct <', 'top3BundleClusterHoldCircPct']) {
      if (leg.condition.includes(bad)) throw new Error('买腿[' + i + '] 残留已删键: ' + bad);
    }
    if (leg.maxExecutions !== 2) throw new Error('买腿[' + i + '] maxExecutions=' + JSON.stringify(leg.maxExecutions) + ' 期望 2');
    if (leg.cards !== 3) throw new Error('买腿[' + i + '] cards=' + leg.cards + ' 期望 3');
    if (!leg.condition.includes('(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)')) {
      throw new Error('买腿[' + i + '] 缺 T96 AND 净买门');
    }
  }
  if (!buys[0].condition.includes('marketCap > 4.7')) throw new Error('主腿非 v49 BNB 形状');
  if (buys[0].condition.split(SWAP_MAIN[0]).length !== 2) throw new Error('主腿旧人气段非恰一次');
  if (!buys[0].condition.includes('top2HolderCircPct < 55')) throw new Error('主腿缺 T93 top2 持有人门 55');
  if (!buys[0].condition.includes('top1HolderCircPct < 35')) throw new Error('主腿缺 top1 门 35');
  if (!buys[1].condition.includes('tokenAgeSec < 600')) throw new Error('早期腿缺 600s 段');
  if (buys[1].condition.split(SWAP_EARLY[0]).length !== 2) throw new Error('早期腿旧人气段非恰一次');
  if (!buys[1].condition.includes('top1HolderCircPct < 45')) throw new Error('早期腿缺 T95 top1 门 45');
  if (!buys[1].condition.includes('top2HolderCircPct < 75')) throw new Error('早期腿缺 T95 top2 门 75');

  // ── v55 唯一变量：两买腿 condition ← 库 copy-in（v50/v10）──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const mainEntry = list.find(e => e.name === 'buy-v2');
  if (!mainEntry || mainEntry.version !== 50) throw new Error('库 buy-v2 version=' + (mainEntry && mainEntry.version) + ' 期望 50（先跑 bump-t98-holders-exdust.cjs --commit）');
  const earlyEntry = list.find(e => e.name === 'buy-early-narrative');
  if (!earlyEntry || earlyEntry.version !== 10) throw new Error('库 buy-early-narrative version=' + (earlyEntry && earlyEntry.version) + ' 期望 10');

  for (const [i, entryName] of ['buy-v2', 'buy-early-narrative'].entries()) {
    const e = list.find(x => x.name === entryName);
    const full = await svc.getById(e.id);
    const libLegs = full.legs.legs || full.legs;
    const libLeg = libLegs[0];
    if (libLeg.maxExecutions !== 2) throw new Error('库 ' + entryName + ' maxExecutions=' + JSON.stringify(libLeg.maxExecutions) + ' 期望 2');
    if (libLeg.narrativeTriggerCondition !== buys[i].narrativeTriggerCondition) {
      throw new Error('库/实验 ' + entryName + ' trigger 漂移\nLIB: ' + libLeg.narrativeTriggerCondition + '\nEXP: ' + buys[i].narrativeTriggerCondition);
    }
    if (libLeg.gmgnCheckCondition !== buys[i].gmgnCheckCondition) {
      throw new Error('库/实验 ' + entryName + ' gmgn 漂移（本批不动它）\nLIB: ' + libLeg.gmgnCheckCondition + '\nEXP: ' + buys[i].gmgnCheckCondition);
    }
    if (libLeg.cards !== buys[i].cards) throw new Error('库/实验 ' + entryName + ' cards 漂移');
    // 库新条件=源旧条件换人气段（其余逐字一致防线）
    const [OLD_SEG, NEW_SEG] = i === 0 ? SWAP_MAIN : SWAP_EARLY;
    let expected = buys[i].condition;
    if (expected.split(OLD_SEG).length !== 2) throw new Error(entryName + ' 源人气段非恰一次');
    expected = expected.replace(OLD_SEG, NEW_SEG);
    if (libLeg.condition !== expected) {
      throw new Error('库 ' + entryName + ' 与源条件除人气段外存在漂移\nLIB: ' + libLeg.condition + '\nEXP: ' + expected);
    }
    buys[i].condition = libLeg.condition;
  }

  // ── libraryRefs buy-v2 49→50 / early 9→10（纯 provenance）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!earlyRef || earlyRef.version !== 9) throw new Error('libraryRefs early version=' + (earlyRef && earlyRef.version) + ' 期望 9');
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (!buyRef || buyRef.version !== 49) throw new Error('libraryRefs buy-v2 version=' + (buyRef && buyRef.version) + ' 期望 49');
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');
  earlyRef.version = 10; earlyRef.snapshotAt = new Date().toISOString();
  buyRef.version = 50; buyRef.snapshotAt = new Date().toISOString();

  cfg.name = 'v55-实盘-both-剔尘埃人气-1029';
  cfg.description = 'v54 + T98 人气门换键（用户裁定「极小持仓者剔除——这样不会'
    + '让假活跃票进门，可以新搞一个因子，替换现有的 holders 因子」）：两买腿人气门'
    + ' holders → holdersExDust（净持仓按首可靠价折算 ≥ holderDustBnb 0.002=2× tick'
    + ' 尘门+单卡仓位 的钱包数——刷 holder 的尘埃钱包不计入）；阈值不动（主 10/早期'
    + ' 5，口径变小同阈=更严）。其余门不动（T96 AND 净买门/T95 早期臂 45/75/T93 '
    + '35/55）。21 卖腿/gmgn/maxExecutions=2/6 卡制/perCardBNB/钱包/其余 config 与'
    + ' v54 0007ff5a 逐字一致。源=v54 0007ff5a（v49/v9 快照）。';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[0] (buy-v2 v50):', buys[0].condition);
  console.log('buy[1] (early v10):', buys[1].condition);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V55_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
