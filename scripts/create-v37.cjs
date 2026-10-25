#!/usr/bin/env node
// ============================================================================
// 建 v37 live both 实验（2026-10-25 bundle 门换存量口径）
//   克隆 v36 cf3d8177-f912-424e-ab1c-e73daa66cfea（1 买 buy-v2 v34 快照 + 17 卖含
//   rug-exit 臂）：买腿整条从库 buy-v2 v36 copy-in（= v35 慢热或臂 T63 + 本批
//   bundle 门存量口径 bundleClusterHoldCircPct，两改进一并生效——v36 实验 fire
//   仍是 v34 旧 age 臂快照，手动替换会漏 T63，故取库整条而非子串替换）。
//   gmgnCheckCondition(65)/发起门/17 卖腿/钱包/观察信号/其余 config 不动。
//   libraryRefs buy-v2 34→36。
//   ⚠️ 进程代码须含 bundleClusterHoldCircPct（2026-10-25 提交），先 pull 再跑。
// 防呆：源必须 stopped 且 fire 为 v34 快照形状（无 T63 臂）；库必须 v36；
//   库侧 gmgn/trigger 与实验侧逐字一致才允许 copy-in（不一致=两谱系漂移，人工裁定）。
// 用法：node scripts/create-v37.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'cf3d8177-f912-424e-ab1c-e73daa66cfea'; // v36 live both（库 v34 快照）

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
  // 源形状锁定：v36 实验 fire=v34 快照（流量 bundle 门 + 旧 age 臂无 T63）
  if (buy.condition.split('bundleClusterSharePct < 35').length !== 2) {
    throw new Error('源 fire 非流量 bundle 门形状: ' + buy.condition);
  }
  if (buy.condition.includes('tradeCount >= 25')) {
    throw new Error('源 fire 已含 T63 慢热或臂（源应=v34 快照，若已混入先核对谱系）');
  }
  if (buy.condition.split('marketCap < 20000').length !== 2) throw new Error('源 fire 非 20000 形状（源应=v36/v34）');
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error('源 perCardBNB 缺失');
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 17) throw new Error('源卖腿数=' + sellLegs.length + ' 期望 17（含 rug-exit 臂）');
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');

  // ── v37 唯一变量：买腿整条取库 buy-v2 v36 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry || entry.version !== 36) throw new Error('库 buy-v2 version=' + (entry && entry.version) + ' 期望 36（先跑 bump-buy-v2-v36.cjs --commit）');
  const full = await svc.getById(entry.id);
  const libLegs = full.legs.legs || full.legs;
  const libBuy = libLegs[0];
  if (!libBuy.condition.includes('bundleClusterHoldCircPct < 35')) {
    throw new Error('库 v36 fire 缺存量口径 bundle 门: ' + libBuy.condition);
  }
  // 库侧 gmgn/trigger 与实验侧逐字一致（两谱系防漂移；不一致=有人动了库的其他臂）
  if (libBuy.gmgnCheckCondition !== buy.gmgnCheckCondition) {
    throw new Error('库/实验 gmgnCheckCondition 漂移\nLIB: ' + libBuy.gmgnCheckCondition + '\nEXP: ' + buy.gmgnCheckCondition);
  }
  if (libBuy.narrativeTriggerCondition !== buy.narrativeTriggerCondition) {
    throw new Error('库/实验 narrativeTriggerCondition 漂移\nLIB: ' + libBuy.narrativeTriggerCondition + '\nEXP: ' + buy.narrativeTriggerCondition);
  }
  buy.condition = libBuy.condition;
  if (libBuy.gmgnCheckCondition) buy.gmgnCheckCondition = libBuy.gmgnCheckCondition;
  if (libBuy.narrativeTriggerCondition) buy.narrativeTriggerCondition = libBuy.narrativeTriggerCondition;

  // ── libraryRefs buy-v2 34→36（纯 provenance；rug-exit 不动）──
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (buyRef) { buyRef.version = 36; buyRef.snapshotAt = new Date().toISOString(); }

  cfg.name = 'v37-实盘-both-bundle门存量口径-1025';
  cfg.description = 'v36 + 买腿引用库 buy-v2 v36（两改进一并生效）：'
    + '①bundle 门流量→存量口径 bundleClusterSharePct → bundleClusterHoldCircPct'
    + '（全史 max over 块(该块买家集合当前正净持仓合计)÷流通×100——流量口径拦「10s 内簇主导'
    + '买盘」误伤快进快出交易簇，存量口径拦「簇真持仓≥35%」。cf3d8177 13 票 A/B 重放：'
    + '流量 66.5% vs 存量 107.8%（+41.3pp）；对真囤簇更晚放（OST 等消化 47s）=已知盲区用户'
    + '裁定接受。恒 ≥ maxBlockBuyCircPct）②T63 慢热或臂（tradeCount>=25+600s 帽，v36 实验'
    + '快照未含、随库 v36 首次进 live）。代码须含 bundleClusterHoldCircPct（2026-10-25）。'
    + 'GMGN bundler65/发起门/17 卖腿（含 rug-exit）/观察信号/钱包/其余 config 与 v36 cf3d8177'
    + ' 逐字一致。源=v36 cf3d8177';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| sellLegs:', sellLegs.length);
  console.log('fire:', buy.condition);
  console.log('gmgn (不变):', buy.gmgnCheckCondition.slice(0, 40) + '…');
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V37_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
