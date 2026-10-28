#!/usr/bin/env node
// ============================================================================
// 建 v48 live both 实验（2026-10-28 T88 净买门键名断代；先 commit/pull 本批）
//   克隆 v47 0b08a8d8（buy-v2 v43 + buy-early-narrative v2 快照）。唯一变量：
//   两条买腿 OR 臂 ← 库 copy-in——
//     (tradesNetBuyRatio >= 40 OR tradesNetBuyRatioWin >= 40)
//       → (tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)
//   （T88 用户裁定「全量买卖比没必要，检测一个趋势」+ M=100「先定 100 吧」：
//    全史键断代换长窗尾 100 笔；短窗键 Win→ShortWin 改名；阈值 40 不动。）
//   21 卖腿/发起门/gmgn 串/cards 6 卡制/perCardBNB/钱包/观察信号/其余 config
//   与 v47 逐字一致。libraryRefs buy-v2 43→44 + buy-early-narrative 2→3。
//   ⚠️ 前置：182 已跑 bump-t88-netbuy-window.cjs --commit（v44/v3 已写库）。
//   ⚠️ copy-in：停 v47 与建 v48 同批（单一实验纪律）；重启前持仓确认（卡账本净额口径）。
// 防呆：源必须 stopped 且两条买腿含旧 OR 臂；库必须 v44/v3（新 OR 臂在场）；
//   库/实验 gmgn 与 trigger 逐字一致；条件除 OR 臂段外逐字一致；买 2/卖 21/
//   主腿 BNB 4.7 锚定/cards 3 锚定/三门锚定（主 35/55/75、早期 45/65/85）。
// 用法：node scripts/create-v48.cjs [--commit]   （在 182 跑；先跑 bump-t88-netbuy-window.cjs --commit）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '0b08a8d8-da10-4ffc-a8c9-eafab92d6144'; // v47 live both（T85 早期臂 v2 快照）

const OLD_OR = '(tradesNetBuyRatio >= 40 OR tradesNetBuyRatioWin >= 40)';
const NEW_OR = '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)';

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  // dry-run 允许源 running（只读验证全链锚定）；建行必须源已停（停 v47 与建 v48 同批）
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v47（单一实验纪律+重启前持仓确认）；当前 status=' + src.status);
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

  // ── 源形状锚定（v47 快照：两条买腿均含旧 OR 臂；主腿三门 35/55/75、早期三门 45/65/85）──
  for (const [i, leg] of buys.entries()) {
    if (leg.condition.split(OLD_OR).length !== 2) {
      throw new Error('买腿[' + i + '] 缺旧 OR 臂恰一次（应=v43/v2 快照）: ' + leg.condition);
    }
    if (leg.cards !== 3) throw new Error('买腿[' + i + '] cards=' + leg.cards + ' 期望 3（6 卡制）');
  }
  if (!buys[0].condition.includes('marketCap > 4.7')) {
    throw new Error('主腿非 v43 BNB 形状: ' + buys[0].condition.slice(0, 80));
  }
  if (!buys[0].condition.includes('bundleClusterHoldCircPct < 35 AND top2BundleClusterHoldCircPct < 55 AND top3BundleClusterHoldCircPct < 75')) {
    throw new Error('主腿缺三门 35/55/75 段: ' + buys[0].condition);
  }
  if (!buys[1].condition.includes('bundleClusterHoldCircPct < 45 AND top2BundleClusterHoldCircPct < 65 AND top3BundleClusterHoldCircPct < 85')) {
    throw new Error('早期腿缺三门 45/65/85 段（应=v2 快照）: ' + buys[1].condition);
  }
  if (!buys[1].condition.includes('tokenAgeSec < 600')) {
    throw new Error('早期腿缺 600s 段: ' + buys[1].condition);
  }

  // ── v48 唯一变量：两条买腿 condition ← 库 v44/v3 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const libPair = [
    { name: 'buy-v2', wantVersion: 44, leg: buys[0] },
    { name: 'buy-early-narrative', wantVersion: 3, leg: buys[1] },
  ];
  for (const t of libPair) {
    const entry = list.find(e => e.name === t.name);
    if (!entry || entry.version !== t.wantVersion) {
      throw new Error('库 ' + t.name + ' version=' + (entry && entry.version) + ' 期望 ' + t.wantVersion + '（先跑 bump-t88-netbuy-window.cjs --commit）');
    }
    const full = await svc.getById(entry.id);
    const libLegs = full.legs.legs || full.legs;
    const libLeg = libLegs[0];
    if (libLeg.condition.split(NEW_OR).length !== 2) {
      throw new Error('库 ' + t.name + ' v' + t.wantVersion + ' 缺新 OR 臂: ' + libLeg.condition);
    }
    // 库/实验谱系防漂移：gmgn/trigger 整串比对
    if (libLeg.gmgnCheckCondition !== t.leg.gmgnCheckCondition) {
      throw new Error('库/实验 ' + t.name + ' gmgn 漂移\nLIB: ' + libLeg.gmgnCheckCondition + '\nEXP: ' + t.leg.gmgnCheckCondition);
    }
    if (libLeg.narrativeTriggerCondition !== t.leg.narrativeTriggerCondition) {
      throw new Error('库/实验 ' + t.name + ' trigger 漂移\nLIB: ' + libLeg.narrativeTriggerCondition + '\nEXP: ' + t.leg.narrativeTriggerCondition);
    }
    // 库新条件=源旧条件仅 OR 臂段差异（其余逐字一致防线）
    if (libLeg.condition !== t.leg.condition.replace(OLD_OR, NEW_OR)) {
      throw new Error('库 ' + t.name + ' v' + t.wantVersion + ' 与源条件除 OR 臂外存在漂移\nLIB: ' + libLeg.condition + '\nEXP: ' + t.leg.condition.replace(OLD_OR, NEW_OR));
    }
    if (t.leg.cards !== libLeg.cards) {
      throw new Error('库/实验 ' + t.name + ' cards 漂移: ' + libLeg.cards + ' vs ' + t.leg.cards);
    }
    t.leg.condition = libLeg.condition;
  }

  // ── libraryRefs buy-v2 43→44 + buy-early-narrative 2→3（纯 provenance；其余不动）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (!buyRef || buyRef.version !== 43) throw new Error('libraryRefs buy-v2 version=' + (buyRef && buyRef.version) + ' 期望 43');
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!earlyRef || earlyRef.version !== 2) throw new Error('libraryRefs buy-early-narrative version=' + (earlyRef && earlyRef.version) + ' 期望 2');
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');
  buyRef.version = 44; buyRef.snapshotAt = new Date().toISOString();
  earlyRef.version = 3; earlyRef.snapshotAt = new Date().toISOString();

  cfg.name = 'v48-实盘-both-净买门键名断代长窗100-1028';
  cfg.description = 'v47 + T88 净买门键名断代：全史臂 tradesNetBuyRatio → 长窗 '
    + 'tradesNetBuyRatioLongWin（尾 100 笔，用户裁定「全量买卖比没必要，检测一个趋势」'
    + 'M=100「先定 100 吧」拍板）；短窗键 Win → ShortWin 改名（尾 20 笔不变）；阈值 40 不动。'
    + '回放实证 M 档买点行为全档同帧（叙事池 234 活跃六档同帧；已知代价=fire 302 中 4 票'
    + '长命二波误拦 1.3%）。21 卖腿/发起门/gmgn 10.7 豁免臂/6 卡制/perCardBNB 0.002/钱包/'
    + '其余 config 与 v47 0b08a8d8 逐字一致。源=v47 0b08a8d8（v43/v2 快照）';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB,
    '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[0] (buy-v2 v44):', buys[0].condition);
  console.log('buy[1] (early v3):', buys[1].condition);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V48_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
