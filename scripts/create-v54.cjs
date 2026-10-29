#!/usr/bin/env node
// ============================================================================
// 建 v54 live both 实验（2026-10-29 T96 净买门换轨换车）
//   克隆 v53 f1cd791b（buy-v2 v48 + buy-early-narrative v8 快照，T95 放宽）。
//   本批唯一 config 变量：两买腿 condition ← 库 copy-in（v49/v9）——
//     '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)'
//       → '(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)'
//   用户裁定「短期开始涨，长期下跌趋势解除」，两个臂都改。
//   21 卖腿/gmgn/maxExecutions=2/6 卡制/perCardBNB/钱包/其余 config 与 v53 逐字
//   一致（含 T95 早期臂 45/75）。libraryRefs buy-v2 48→49 / early 8→9。
//   ⚠️ 前置：182 已跑 bump-t96-netbuy-reshape.cjs --commit + 代码在 ec7193e。
//   ⚠️ copy-in：停 v53 与建 v54 同批（单一实验纪律）；停前持仓确认。
// 防呆：源必须 stopped + 两买腿 T93/T95 形状 + 旧净买段恰一次；库 v49/v9；
//   库/实验 gmgn/trigger 逐字一致；库新条件=源串换净买段逐字一致；买 2/卖 21。
// 用法：node scripts/create-v54.cjs [--commit]   （在 182 跑；先跑 bump-t96 --commit）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'f1cd791b-211c-4537-9bb4-0246e29c8109'; // v53 live both（T95 放宽快照）

const OLD_NETBUY = '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)';
const NEW_NETBUY = '(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)';

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v53（单一实验纪律+停前持仓确认）；当前 status=' + src.status);
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

  // ── 源形状锚定（v53 快照：T93 形状 + T95 早期臂 45/75 + 旧 OR 净买段）──
  for (const [i, leg] of buys.entries()) {
    for (const bad of ['tradesRouterPct', 'sybilClusterHolderCircPct', 'top2BundleClusterHoldCircPct', 'bundleClusterHoldCircPct <', 'top3BundleClusterHoldCircPct']) {
      if (leg.condition.includes(bad)) throw new Error('买腿[' + i + '] 残留已删键: ' + bad);
    }
    if (leg.maxExecutions !== 2) throw new Error('买腿[' + i + '] maxExecutions=' + JSON.stringify(leg.maxExecutions) + ' 期望 2');
    if (leg.cards !== 3) throw new Error('买腿[' + i + '] cards=' + leg.cards + ' 期望 3');
    if (leg.condition.split(OLD_NETBUY).length !== 2) throw new Error('买腿[' + i + '] 旧净买段非恰一次');
  }
  if (!buys[0].condition.includes('marketCap > 4.7')) throw new Error('主腿非 v48 BNB 形状');
  if (!buys[0].condition.includes('(buyVolumeBnb >= 1.25 AND holders >= 10)')) throw new Error('主腿缺 T90 AND 人气门');
  if (!buys[0].condition.includes('top2HolderCircPct < 55')) throw new Error('主腿缺 T93 top2 持有人门 55');
  if (!buys[0].condition.includes('top1HolderCircPct < 35')) throw new Error('主腿缺 top1 门 35');
  if (!buys[1].condition.includes('tokenAgeSec < 600')) throw new Error('早期腿缺 600s 段');
  if (!buys[1].condition.includes('(buyVolumeBnb >= 0.25 AND holders >= 5)')) throw new Error('早期腿缺 T90 AND 人气门');
  if (!buys[1].condition.includes('top1HolderCircPct < 45')) throw new Error('早期腿缺 T95 top1 门 45');
  if (!buys[1].condition.includes('top2HolderCircPct < 75')) throw new Error('早期腿缺 T95 top2 门 75');

  // ── v54 唯一变量：两买腿 condition ← 库 copy-in（v49/v9）──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const mainEntry = list.find(e => e.name === 'buy-v2');
  if (!mainEntry || mainEntry.version !== 49) throw new Error('库 buy-v2 version=' + (mainEntry && mainEntry.version) + ' 期望 49（先跑 bump-t96-netbuy-reshape.cjs --commit）');
  const earlyEntry = list.find(e => e.name === 'buy-early-narrative');
  if (!earlyEntry || earlyEntry.version !== 9) throw new Error('库 buy-early-narrative version=' + (earlyEntry && earlyEntry.version) + ' 期望 9');

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
    // 库新条件=源旧条件换净买段（其余逐字一致防线）
    let expected = buys[i].condition;
    if (expected.split(OLD_NETBUY).length !== 2) throw new Error(entryName + ' 源净买段非恰一次');
    expected = expected.replace(OLD_NETBUY, NEW_NETBUY);
    if (libLeg.condition !== expected) {
      throw new Error('库 ' + entryName + ' 与源条件除净买段外存在漂移\nLIB: ' + libLeg.condition + '\nEXP: ' + expected);
    }
    buys[i].condition = libLeg.condition;
  }

  // ── libraryRefs buy-v2 48→49 / early 8→9（纯 provenance）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!earlyRef || earlyRef.version !== 8) throw new Error('libraryRefs early version=' + (earlyRef && earlyRef.version) + ' 期望 8');
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (!buyRef || buyRef.version !== 48) throw new Error('libraryRefs buy-v2 version=' + (buyRef && buyRef.version) + ' 期望 48');
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');
  earlyRef.version = 9; earlyRef.snapshotAt = new Date().toISOString();
  buyRef.version = 49; buyRef.snapshotAt = new Date().toISOString();

  cfg.name = 'v54-实盘-both-净买门换轨-1029';
  cfg.description = 'v53 + T96 净买门换轨（用户裁定「短期开始涨，长期下跌趋势解除」'
    + '「两个臂都改」）：两买腿 (LongWin >= 40 OR ShortWin >= 40) → (LongWin >= 0'
    + ' AND ShortWin >= 40)——短窗尾 20 笔强净买 ≥40 ∧ 长窗尾 100 笔净比非负；'
    + '严格收紧（新 ⊆ 旧）：拦「长强短弱」与「短反弹但长期净卖」两形状。其余门'
    + '不动（主腿集中度 35/55；早期臂含 T95 放宽 45/75）。21 卖腿/gmgn/'
    + 'maxExecutions=2/6 卡制/perCardBNB/钱包/其余 config 与 v53 f1cd791b 逐字'
    + '一致。源=v53 f1cd791b（v48/v8 快照）；同车 T94 观察键 top1S/top2S。';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[0] (buy-v2 v49):', buys[0].condition);
  console.log('buy[1] (early v9):', buys[1].condition);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V54_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
