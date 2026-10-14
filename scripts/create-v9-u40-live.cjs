#!/usr/bin/env node
// ============================================================================
// v9 实跑臂（2026-10-14 用户裁定）：v7 整包 + 仅 u40 门（撤 g80）
//   fire condition   += ' AND TPAPre_gmgnUserPct >= 40'（保留）
//   preBuyCondition   不动（gmgnBundlerWalletRatio <= 80 已撤——回测净负 -26）
// 源：2ad6a39b（v7-实跑-both）。回测对拍：g0=4a7aa1ae / g2(双门)=943f65ff
// u40-only 全效应（同窗分层归因）：拦 62 票 / 净效应 -9.41（大赢家 Bicat/CZ 均 <40）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '2ad6a39b-9a61-4f6d-905e-54d1d1159d52';

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error('源实验不存在: ' + SRC);
  const cfg = JSON.parse(JSON.stringify(src.config));
  cfg.name = 'v9-实跑-both-u40单门-1014';
  cfg.description = 'v7 整包 + 仅 u40 门（2026-10-14 用户裁定撤 g80）：'
    + 'fire 层 TPAPre_gmgnUserPct >= 40（GMGN 真实用户持仓占比下限 4 成，TPA 未触发=null fail-closed 拦）；'
    + 'gmgnBundlerWalletRatio <= 80 已撤（10-04→10-08 回测对拍净负 -26：高段 bundler 含大量大赢家，与 C17 结论一致）。'
    + 'u40-only 同窗全效应 -9.41（拦 62 票：34 亏票约 -5 避亏 vs Bicat/CZ/KIND 等 12 只大赢家 +9.4 被误杀）。'
    + '源=2ad6a39b v7；对拍臂 4a7aa1ae(g0)/943f65ff(g2)；前代 v8=8863fb24（双门，运行 1 天接替）';
  const buy = cfg.strategiesConfig?.buyStrategies?.[0];
  if (!buy) throw new Error('买腿缺失');
  buy.condition = buy.condition + ' AND TPAPre_gmgnUserPct >= 40';
  buy.description = (buy.description || '') + ' | v9（2026-10-14）：仅 u40 门（fire+=TPAPre_gmgnUserPct>=40），g80 bundler 上限已撤（回测净负）';
  console.log('fire:   ', buy.condition);
  console.log('preBuy: ', buy.preBuyCheckCondition);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'virtual');
  console.log('V9_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
