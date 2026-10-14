#!/usr/bin/env node
// ============================================================================
// v12 实盘臂（2026-10-14 用户裁定：停 v11 起新，buy-v2 v9 现行全套）
//   源：v11 2340315d（config 已含当日三连改终态：GMGN 门移除 + 非 BNB 盘放开
//   [代码层 63159a1] + 市值门 marketCap<15000）
//   改动：仅换实验行（name/description 谱系标记）——策略/机制段/钱包零改动
//   （perCardBNB 0.0025×4 卡=单票 0.01 BNB、executorId 98ed90fd、卖腿 P0/P1+
//   拱形v2-A、u40 实时因子门 + 市值门 15K 全部继承）
//   防呆：校验 fire condition 含 u40+marketCap 且无 gmgnRiskCovered（防克隆
//   错形状）；库 buy-v2 v9 已与该形状对齐（libraryRefs provenance 不变）
// 用法：node scripts/create-v12-live-both.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '2340315d-7863-4f4f-ba8b-58d85221910c';

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error('源实验不存在: ' + SRC);
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both（克隆源不对）: ' + cfg.platform);

  // 防呆：源 config 必须是三连改终态形状
  const buy = cfg.strategiesConfig?.buyStrategies?.[0];
  if (!buy) throw new Error('买腿缺失');
  if (!buy.condition.includes('gmgnUserPct >= 40 AND marketCap < 15000'))
    throw new Error('源 fire condition 不含 u40+marketCap 终态形状（克隆源不对）: ' + buy.condition);
  if (buy.condition.includes('gmgnRiskCovered') || (buy.preBuyCheckCondition || '').includes('gmgnRiskCovered'))
    throw new Error('源条件残留 gmgnRiskCovered（G4 门应已移除）');
  if (cfg.positionManagement?.perCardBNB !== 0.0025)
    throw new Error('源 perCardBNB != 0.0025（克隆源不对）');
  if (!cfg.wallet?.executorId) throw new Error('源无 wallet.executorId（克隆源不对）');

  cfg.name = 'v12-实盘-both-市值门15K-1014';
  cfg.description = 'v11 整包继承换行（2026-10-14 用户裁定「停 v11 起新，buy-v2 v9 现行全套」）：'
    + '策略与机制段零改动——fire=u40 实时因子 gmgnUserPct>=40 + 市值门 marketCap<15000（USD 口径，'
    + '极速拉盘票不买，2026-10-14 三连改终态：GMGN G4 门移除 + 非 BNB 计价盘放开买入 63159a1 + 市值门）；'
    + 'preBuy=rating 门+flap router 门+首窗人数门+lag 门；卖腿 P0/P1 bypass + 拱形v2-A；'
    + 'perCardBNB 0.0025×4 卡=单票 0.01 BNB；钱包 executorId 继承（0xc3c9…cf20）。源=v11 2340315d';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| cards:', buy.cards);
  console.log('fire:   ', buy.condition);
  console.log('preBuy: ', buy.preBuyCheckCondition);
  console.log('wallet: ', JSON.stringify(cfg.wallet));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V12_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
