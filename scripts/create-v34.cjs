#!/usr/bin/env node
// ============================================================================
// 建 v34 live both 实验（2026-10-22 人气门去簇口径）
//   克隆 v33 8eca4890-2762-45fa-acf4-ffb4011eb18d（1 买 + 17 卖含 rug-exit 臂）：
//   唯一变量=买腿 fire condition 换库 buy-v2 v33 逐字快照（人气门扣协同簇）。
//   gmgnCheckCondition(65)/发起门/17 卖腿/钱包/其余 config 不动。libraryRefs 32→33。
//   ⚠️ 进程代码须 ≥22f799d（FA 新键 buyVolumeBnbExSybil/holdersExSybil）。
// 防呆：源必须 stopped；fire 恰一替换后与库 v33 逐字对拍；gmgn 65/15000/trigger
//   形状锁定；17 卖腿数断言。
// 用法：node scripts/create-v34.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '8eca4890-2762-45fa-acf4-ffb4011eb18d'; // v33 live both（库 v32 快照）

const OLD_SEG = '(buyVolumeBnb >= 1.25 OR holders >= 10)';
const NEW_SEG = '(buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10)';
const GMGN_OLD = 'gmgnBundlerWalletRatio <= 65'; // v33 形状（本批不动）
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';

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
  // 源形状锁定：fire 含旧人气门恰一 + mcap 15000 + gmgn 65 + trigger
  if (buy.condition.split(OLD_SEG).length !== 2) throw new Error('源 fire 非旧人气门形状: ' + buy.condition);
  if (buy.condition.split('marketCap < 15000').length !== 2) throw new Error('源 fire 非 15000 形状（源应=v33）');
  if (typeof buy.gmgnCheckCondition !== 'string' || buy.gmgnCheckCondition.split(GMGN_OLD).length !== 2) {
    throw new Error('源 gmgnCheckCondition 非 65 形状: ' + buy.gmgnCheckCondition);
  }
  if (buy.narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('源 trigger 形状非 v33: ' + buy.narrativeTriggerCondition);
  }
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error('源 perCardBNB 缺失');
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 17) throw new Error('源卖腿数=' + sellLegs.length + ' 期望 17（含 rug-exit 臂）');
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');

  // ── v34 唯一变量：人气门去簇（与库 v33 逐字对拍）──
  buy.condition = buy.condition.replace(OLD_SEG, NEW_SEG);
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry || entry.version !== 33) throw new Error('库 buy-v2 version=' + (entry && entry.version) + ' 期望 33（先跑 bump-buy-v2-v33.cjs --commit）');
  const full = await svc.getById(entry.id);
  const libLegs = full.legs.legs || full.legs;
  if (libLegs[0].condition !== buy.condition) {
    throw new Error('替换后 condition 与库 v33 不逐字一致\nEXP: ' + buy.condition + '\nLIB: ' + libLegs[0].condition);
  }

  // ── libraryRefs buy-v2 32→33（纯 provenance；rug-exit 不动）──
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (buyRef) { buyRef.version = 33; buyRef.snapshotAt = new Date().toISOString(); }

  cfg.name = 'v34-实盘-both-人气门去簇-1022';
  cfg.description = 'v33 + 人气门去簇口径（单变量）：fire condition '
    + '(buyVolumeBnb >= 1.25 OR holders >= 10) → (buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10)'
    + '（协同簇钱包 sybil-clusters 名单的买入量/持有者席不计人气——对倒垫人气失效；名单未启用'
    + 'fail-open 不扣=原值。原键不动：卖腿死票臂 buyVolumeBnb < 2=退出流动性、发起门 0.1 原轴）。'
    + '代码须 ≥22f799d（FA 新键）。GMGN bundler65/mcap15000/发起门/17 卖腿（含 rug-exit）/'
    + '钱包/其余 config 与 v33 8eca4890 逐字一致。源=v33 8eca4890';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| sellLegs:', sellLegs.length);
  console.log('fire:', buy.condition);
  console.log('gmgn (不变):', buy.gmgnCheckCondition.slice(0, 40) + '…');
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V34_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
