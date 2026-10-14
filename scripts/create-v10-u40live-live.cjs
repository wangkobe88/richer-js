#!/usr/bin/env node
// ============================================================================
// v10 实跑臂（2026-10-14 小王子案用户裁定）：u40 门因子从 TPA 快照换 FA 实时
//   fire condition: 'TPAPre_gmgnUserPct >= 40' → 'gmgnUserPct >= 40'
// 案由：0x71b58f07…7777（小王子）TPA age=5s 触发快照 userPct=25.3<40 拦死——
//   write-once 快照对后期 GMGN 流入盲视（好票前期 GMGN 用户少、后面涨上来不翻案）。
//   gmgnUserPct 为 FA 每 tick 实时重算（口径与 TPA _gmgnShareStats 逐字一致，
//   Σ GMGN 用户 net>0 / Σ net>0 量加权），90s 买窗内随时翻正过门。
// 源：d32f9d96（v9 u40 单门）。前代：v8 8863fb24（双门）→ v9 d32f9d96（撤 g80）
// 用法：node scripts/create-v10-u40live-live.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'd32f9d96-06b7-456b-8e49-25458eac2d29';

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error('源实验不存在: ' + SRC);
  const cfg = JSON.parse(JSON.stringify(src.config));
  cfg.name = 'v10-实跑-both-u40实时因子-1014';
  cfg.description = 'v9 整包 + u40 门因子换 FA 实时层（2026-10-14 小王子 0x71b58f07…7777 案用户裁定）：'
    + 'fire 层 TPAPre_gmgnUserPct>=40（TPA 触发时 write-once 快照）改为 gmgnUserPct>=40（FA 每 tick 实时重算，'
    + '口径与 TPA _gmgnShareStats 逐字一致——前期 GMGN 用户少被拦的好票，后期 GMGN 涨上来 90s 窗内可翻正过门）。'
    + '实验无 TPA 段时因子 null fail-closed（本臂有 TPA 段）。源=d32f9d96 v9；前代 v8=8863fb24（双门）。'
    + 'u40 门同窗回测净效应 -9.41（大赢家误杀面），实跑观察中';
  const buy = cfg.strategiesConfig?.buyStrategies?.[0];
  if (!buy) throw new Error('买腿缺失');
  if (!buy.condition.includes('TPAPre_gmgnUserPct >= 40')) {
    throw new Error('源 condition 不含 TPAPre_gmgnUserPct >= 40（克隆源不对）: ' + buy.condition);
  }
  buy.condition = buy.condition.replace('TPAPre_gmgnUserPct >= 40', 'gmgnUserPct >= 40');
  buy.description = (buy.description || '') + ' | v10（2026-10-14）：u40 门因子换 FA 实时 gmgnUserPct（TPAPre 快照不翻案，小王子案）';
  console.log('fire:   ', buy.condition);
  console.log('preBuy: ', buy.preBuyCheckCondition);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'virtual');
  console.log('V10_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
