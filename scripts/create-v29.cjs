#!/usr/bin/env node
// ============================================================================
// 建 v29 live both 实验（2026-10-22 人气门 AND→OR）
//   克隆 v28 a97e4f25-dcaa-4c80-a719-944ded2c5b5f，仅换买腿 condition 人气门
//   合取→析取（库 buy-v2 v28 逐字快照对拍），libraryRefs 版本同步 27→28。
//   单一变量：buyVolumeBnb >= 1.25 AND holders >= 10 → (… OR …)；其余（发起门/
//   GMGN 门/16 卖腿/钱包/卡牌/叙事段）与 v28 逐字一致。
// 防呆：源必须 stopped（停 v28 后才跑）；旧合取段恰一；替换后与库 v28 逐字相等；
//   卖腿数 16 / perCardBNB / wallet.executorId / platform=both 断言。
// 用法：node scripts/create-v29.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'a97e4f25-dcaa-4c80-a719-944ded2c5b5f'; // v28 live both（J1.97 + C145-C161）

const OLD_SEGMENT = ' AND buyVolumeBnb >= 1.25 AND holders >= 10';
const NEW_SEGMENT = ' AND (buyVolumeBnb >= 1.25 OR holders >= 10)';

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error('源实验不存在: ' + SRC);
  if (src.status !== 'stopped') throw new Error('源实验未停止: ' + src.status);
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buy = cfg.strategiesConfig?.buyStrategies?.[0];
  if (!buy) throw new Error('买腿缺失');
  // 源形状锁定（v28 谱系：v27 快照 + J1.97 批次）
  if (buy.condition.split(OLD_SEGMENT).length !== 2) {
    throw new Error('源 fire condition 非人气门合取形状（恰一次）: ' + buy.condition);
  }
  if (!buy.condition.includes('marketCap < 12000') || !buy.condition.includes('holderTrendSlope > 0')) {
    throw new Error('源 fire condition 缺 v27 特征子句: ' + buy.condition);
  }
  if (buy.narrativeTriggerCondition !== 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1') {
    throw new Error('源 trigger 形状非 v27/v28: ' + buy.narrativeTriggerCondition);
  }
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error('源 perCardBNB 缺失');
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 16) throw new Error('源卖腿数=' + sellLegs.length + ' 期望 16');

  // ── v29 变更（单一变量：人气门 AND→OR，e8da MAYA 案归因，见库 v28 description）──
  const newCond = buy.condition.replace(OLD_SEGMENT, NEW_SEGMENT);
  buy.condition = newCond;

  // 库 v28 逐字对拍（实验快照=库快照，防两处手改漂移）
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry || entry.version !== 28) throw new Error('库 buy-v2 version=' + (entry && entry.version) + ' 期望 28（先跑 bump-buy-v2-v28.cjs --commit）');
  const full = await svc.getById(entry.id);
  const libLegs = full.legs.legs || full.legs;
  if (libLegs[0].condition !== newCond) {
    throw new Error('替换后 condition 与库 v28 不逐字一致\nEXP: ' + newCond + '\nLIB: ' + libLegs[0].condition);
  }

  // libraryRefs 版本同步（纯 provenance）
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (buyRef) { buyRef.version = 28; buyRef.snapshotAt = new Date().toISOString(); }

  cfg.name = 'v29-实盘-both-人气门OR-1022';
  cfg.description = 'v28 + 人气门 AND→OR（单一变量）：买腿 buyVolumeBnb>=1.25 与 holders>=10 由'
    + '合取改析取（库 buy-v2 v28 逐字快照）。归因 e8da MAYA 案 0xe8da305a…7777：holders 钱包段'
    + '（sender RPC 回查滞后）与 mcap<12000 价格段（即时）评估时刻不相交→恒假没买；OR 后单轴 '
    + 'buyVolumeBnb 实时可过。发起门/GMGN 门/16 卖腿/钱包与其余 config 与 v28 a97e4f25 逐字一致。'
    + '源=v28 a97e4f25-dcaa-4c80-a719-944ded2c5b5f';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| sellLegs:', sellLegs.length);
  console.log('fire:', buy.condition);
  console.log('trigger:', buy.narrativeTriggerCondition);
  console.log('gmgn:', buy.gmgnCheckCondition);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V29_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
