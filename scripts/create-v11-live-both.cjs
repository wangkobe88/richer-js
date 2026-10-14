#!/usr/bin/env node
// ============================================================================
// v11 实盘臂（2026-10-14 用户裁定：停 v10 虚拟，开实盘）
//   源：v10 9bfa172f（both + u40 实时因子 gmgnUserPct>=40）
//   改动：trading_mode=live；perCardBNB 0.1→0.0025（单卡 0.0025 BNB，cards=4 保持
//   =单票 0.01 BNB）；wallet.executorId=98ed90fd（executors 表唯一真实钱包，
//   blockchain=bsc / reserve_native=0.01；私钥单一真相源在表，config 只落引用）
//   live 防御参数走 config/default.json fourmemeWs.live 默认（滑点 5%/gas≤10gwei/
//   熔断 5 败 30min/txWait 120s）；双平台 live=per-platform 双 trader 同一钱包
//   （commit 8332301 改造，买/卖点按 token 平台分派）
// 用法：node scripts/create-v11-live-both.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '9bfa172f-ec3b-435a-abd7-a50ef541e57e';
const EXECUTOR_ID = '98ed90fd-2f61-45ab-a4dd-a3793d3d694f';

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error('源实验不存在: ' + SRC);
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both（克隆源不对）: ' + cfg.platform);

  cfg.name = 'v11-实盘-both-u40实时因子-1014';
  cfg.description = 'v10 整包转实盘（2026-10-14 用户裁定「停止虚拟开实盘，单卡 0.0025 BNB」）：'
    + 'both 双平台 live（commit 8332301 per-platform trader map + 共享 NonceManager）；'
    + '策略/fire 条件/preBuy/叙事直调零改动（u40 门=FA 实时 gmgnUserPct>=40，小王子案）；'
    + 'perCardBNB 0.1→0.0025（cards=4 保持，单票 0.01 BNB）；钱包 executorId=98ed90fd'
    + '（0xc3c9a4f7…cf20，reserve_native 0.01）；live 防御参数走 default.json 默认。'
    + '源=v10 9bfa172f';
  // 卡牌金额：单卡 0.0025 BNB
  if (!cfg.positionManagement?.perCardBNB) throw new Error('源无 positionManagement.perCardBNB（克隆源不对）');
  cfg.positionManagement.perCardBNB = 0.0025;
  // 钱包：executors 表引用（双源互斥——不落 address/privateKey）
  cfg.wallet = { executorId: EXECUTOR_ID };
  // virtual 段对 live 无意义，去除防歧义
  delete cfg.virtual;

  const buy = cfg.strategiesConfig?.buyStrategies?.[0];
  if (!buy) throw new Error('买腿缺失');
  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| cards:', buy.cards);
  console.log('fire:   ', buy.condition);
  console.log('wallet: ', JSON.stringify(cfg.wallet));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V11_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
