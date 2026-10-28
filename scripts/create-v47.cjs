#!/usr/bin/env node
// ============================================================================
// 建 v47 live both 实验（2026-10-28 T85 早期臂 bundle 三门放宽；先 commit/pull 本批）
//   克隆 v46 6581c288（buy-early-narrative v1 快照）。唯一变量：
//   买腿[1]（早期臂）condition ← 库 buy-early-narrative v2 copy-in——
//     bundleClusterHoldCircPct < 35→45 / top2 < 55→65 / top3 < 75→85（各 +10）
//   （T84 落地时回放=乐观上界未计三门；早期臂带内集中度天然更高，原阈值偏紧。）
//   买腿[0]（buy-v2 v43）/21 卖腿/发起门/gmgn 串/cards 6 卡制/perCardBNB/钱包/
//   观察信号/其余 config 与 v46 逐字一致。libraryRefs buy-early-narrative 1→2。
//   ⚠️ 前置：182 已跑 bump-buy-early-narrative-v2.cjs --commit。
//   ⚠️ copy-in：停 v46 与建 v47 同批（单一实验纪律）；重启前持仓确认（卡账本净额口径）。
// 防呆：源必须 stopped 且早期腿=v1 整串形状（三门 35/55/75 在场）；库必须 v2
//   （三门 45/65/85 在场）；库/实验 gmgn 与 trigger 逐字一致才允许 copy-in；
//   买腿 2/卖腿 21/主腿 BNB 4.7 锚定/cards 3 锚定。
// 用法：node scripts/create-v47.cjs [--commit]   （在 182 跑；先跑 bump-buy-early-narrative-v2.cjs --commit）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '6581c288-66f9-498a-800e-1325c8a7de58'; // v46 live both（07:26 UTC 重启版：T79 冻结 16s 在 config，整体带上不动）

const OLD_SEG = 'bundleClusterHoldCircPct < 35 AND top2BundleClusterHoldCircPct < 55 AND top3BundleClusterHoldCircPct < 75';
const NEW_SEG = 'bundleClusterHoldCircPct < 45 AND top2BundleClusterHoldCircPct < 65 AND top3BundleClusterHoldCircPct < 85';

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  // dry-run 允许源 running（只读验证全链锚定）；建行必须源已停（停 v46 与建 v47 同批）
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v46（单一实验纪律+重启前持仓确认）；当前 status=' + src.status);
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
  // 主腿锚定（buy-v2 v43 BNB 形状，本批不动）
  if (!buys[0].condition.includes('marketCap > 4.7')) {
    throw new Error('主腿非 v43 BNB 形状: ' + buys[0].condition.slice(0, 80));
  }
  if (buys[0].cards !== 3) throw new Error('主腿 cards=' + buys[0].cards + ' 期望 3（6 卡制）');
  const early = buys[1];
  if (early.condition.split(OLD_SEG).length !== 2) {
    throw new Error('源早期腿缺三门 35/55/75 旧段（应=v1 快照）: ' + early.condition);
  }
  if (early.cards !== 3) throw new Error('早期腿 cards=' + early.cards + ' 期望 3');

  // ── v47 唯一变量：早期腿 condition ← 库 buy-early-narrative v2 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-early-narrative');
  if (!entry || entry.version !== 2) throw new Error('库 buy-early-narrative version=' + (entry && entry.version) + ' 期望 2（先跑 bump-buy-early-narrative-v2.cjs --commit）');
  const full = await svc.getById(entry.id);
  const libLegs = full.legs.legs || full.legs;
  const libEarly = libLegs[0];
  if (libEarly.condition.split(NEW_SEG).length !== 2) {
    throw new Error('库 v2 缺三门 45/65/85 新段: ' + libEarly.condition);
  }
  // 库/实验两谱系防漂移：除三门段外逐字一致（gmgn/trigger 整串比对）
  if (libEarly.gmgnCheckCondition !== early.gmgnCheckCondition) {
    throw new Error('库/实验早期腿 gmgn 漂移\nLIB: ' + libEarly.gmgnCheckCondition + '\nEXP: ' + early.gmgnCheckCondition);
  }
  if (libEarly.narrativeTriggerCondition !== early.narrativeTriggerCondition) {
    throw new Error('库/实验早期腿 trigger 漂移\nLIB: ' + libEarly.narrativeTriggerCondition + '\nEXP: ' + early.narrativeTriggerCondition);
  }
  // 库 v2 条件=源 v1 条件仅三门段差异（其余逐字一致防线）
  if (libEarly.condition !== early.condition.replace(OLD_SEG, NEW_SEG)) {
    throw new Error('库 v2 与源 v1 条件除三门段外存在漂移\nLIB: ' + libEarly.condition + '\nEXP: ' + early.condition.replace(OLD_SEG, NEW_SEG));
  }
  early.condition = libEarly.condition;

  // ── libraryRefs buy-early-narrative 1→2（纯 provenance；其余不动）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!earlyRef || earlyRef.version !== 1) throw new Error('libraryRefs buy-early-narrative version=' + (earlyRef && earlyRef.version) + ' 期望 1');
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (!buyRef || buyRef.version !== 43) throw new Error('libraryRefs buy-v2 version=' + (buyRef && buyRef.version) + ' 期望 43');
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');
  earlyRef.version = 2;
  earlyRef.snapshotAt = new Date().toISOString();

  cfg.name = 'v47-实盘-both-早期臂bundle三门放宽-1028';
  cfg.description = 'v46 + T85 早期臂 bundle 三门放宽：bundleClusterHoldCircPct 35→45 / '
    + 'top2 55→65 / top3 75→85（各 +10）——T84 落地时回放=乐观上界未计三门，早期臂带内'
    + '（6.0-6.7 BNB）集中度天然更高，原阈值对该带偏紧（T84 余留项，用户裁定）。其余门/'
    + '21 卖腿（含早期臂专属三腿与 T79/衰竭豁免）/发起门/gmgn 10.7 豁免臂/6 卡制/perCardBNB '
    + '0.002/钱包/其余 config 与 v46 6581c288 逐字一致。源=v46 6581c288（early v1 快照）';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB,
    '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[1] (early v2):', early.condition);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V47_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
