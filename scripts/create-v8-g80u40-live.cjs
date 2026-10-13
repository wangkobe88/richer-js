#!/usr/bin/env node
// ============================================================================
// v8 实跑臂（2026-10-13 用户拍板）：v7 整包 + g80u40 双门直接上线虚拟实跑
//   fire condition   += ' AND TPAPre_gmgnUserPct >= 40'（真实用户占比下限 4 成，null fail-closed）
//   preBuyCondition  += ' AND gmgnBundlerWalletRatio <= 80'（捆绑钱包占比上限 8 成，未覆盖=0 恒过）
// 源：2ad6a39b（v7-实跑-both，2026-10-13 13:29→14:43 停机接替）
// 用法：node scripts/create-v8-g80u40-live.cjs [--commit]
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
  cfg.name = 'v8-实跑-both-g80u40双门-1013';
  cfg.description = 'v7 整包 + 双门（2026-10-13 桂花小鸟 0xbe5a8a5a…7777 案用户拍板直接上线）：'
    + 'TPAPre_gmgnUserPct >= 40（GMGN 真实用户持仓占比下限 4 成，挂 fire 层，TPA 未触发=null fail-closed 拦）；'
    + 'gmgnBundlerWalletRatio <= 80（GMGN 捆绑钱包占比上限 8 成，挂 preBuy 层，未覆盖=0 恒过 fail-open）。'
    + '实跑对照：双门在 2ad6a39b 17 票上精确拦 2 票（桂花小鸟 -0.209 / 熊大卫 0x887a…7777 -0.070，零误杀）；'
    + '同窗对拍臂 4a7aa1ae(g0)/943f65ff(g2)。源=2ad6a39b v7（buy-v2 v7 形状，本腿条件已偏离库快照=实验内 copy-in）';
  const buy = cfg.strategiesConfig?.buyStrategies?.[0];
  if (!buy) throw new Error('买腿缺失');
  buy.condition = buy.condition + ' AND TPAPre_gmgnUserPct >= 40';
  buy.preBuyCheckCondition = (buy.preBuyCheckCondition || '') + ' AND gmgnBundlerWalletRatio <= 80';
  buy.description = (buy.description || '') + ' | v8（2026-10-13）：+g80u40 双门（fire+=TPAPre_gmgnUserPct>=40；preBuy+=gmgnBundlerWalletRatio<=80），桂花小鸟案直接上线';
  console.log('fire:   ', buy.condition);
  console.log('preBuy: ', buy.preBuyCheckCondition);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'virtual');
  console.log('V8_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
