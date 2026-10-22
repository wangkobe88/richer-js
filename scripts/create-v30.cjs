#!/usr/bin/env node
// ============================================================================
// 建 v30 live both 实验（2026-10-22 e8da 案批次二）
//   克隆 v29 b2f02dce-edc8-4d68-a3b6-f6121b93ff27（17 卖腿含 rug-exit 臂）：
//   ①买腿 condition 换库 buy-v2 v29 逐字快照（集中度第一臂/flap 臂放宽 + netBuyRatio>=50）
//   ②卖腿[9] ddh -45 → -35（低市值档回撤阈值与中档一致）
//   libraryRefs buy-v2 28→29；其余（发起门/GMGN 门/17 卖腿形状/钱包/卡牌/叙事段）
//   与 v29 逐字一致。
// 防呆：源必须 stopped；买腿 v28 快照三处旧形状恰一替换后与库 v29 逐字对拍；
//   卖腿[9] 精确子串替换恰一；17 卖腿数断言。
// 用法：node scripts/create-v30.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'b2f02dce-edc8-4d68-a3b6-f6121b93ff27'; // v29 live both（库 v28 快照 + rug-exit 臂）

const BUY_CHANGES = [
  ['((marketCap < 4500 AND (famousCopyWalletCircPct IS NULL OR famousCopyWalletCircPct < 40)) OR',
   '((famousCopyWalletCircPct IS NULL OR famousCopyWalletCircPct < 40) OR'],
  ["(platform != 'flap' OR marketCap < 4500 OR earlyTradesRouterPct >= 30)",
   "(platform != 'flap' OR earlyTradesRouterPct >= 30)"],
  [' AND (buyVolumeBnb >= 1.25 OR holders >= 10)',
   ' AND (buyVolumeBnb >= 1.25 OR holders >= 10) AND earlyTradesNetBuyRatio >= 50'],
];
const SELL9_OLD = 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -45 AND marketCap < 6000';
const SELL9_NEW = 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -35 AND marketCap < 6000';

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
  // 源形状锁定（v29 谱系：库 v28 快照）
  for (const [oldSeg] of BUY_CHANGES) {
    if (buy.condition.split(oldSeg).length !== 2) {
      throw new Error('源 fire condition 非 v28 快照形状（恰一次）: ' + oldSeg);
    }
  }
  if (buy.narrativeTriggerCondition !== 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1') {
    throw new Error('源 trigger 形状非 v28/v29: ' + buy.narrativeTriggerCondition);
  }
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error('源 perCardBNB 缺失');
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 17) throw new Error('源卖腿数=' + sellLegs.length + ' 期望 17（含 rug-exit 臂）');
  const sell9 = sellLegs.find(l => l.condition === SELL9_OLD);
  if (!sell9) throw new Error('卖腿[9] 非 -45 形状，人工核对');
  // rug-exit 臂在场断言（v29 libraryRefs 引用）
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');

  // ── v30 变更 ①买腿三处替换（与库 v29 逐字对拍）──
  let newCond = buy.condition;
  for (const [oldSeg, newSeg] of BUY_CHANGES) newCond = newCond.replace(oldSeg, newSeg);
  buy.condition = newCond;
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry || entry.version !== 29) throw new Error('库 buy-v2 version=' + (entry && entry.version) + ' 期望 29（先跑 bump-buy-v2-v29.cjs --commit）');
  const full = await svc.getById(entry.id);
  const libLegs = full.legs.legs || full.legs;
  if (libLegs[0].condition !== newCond) {
    throw new Error('替换后 condition 与库 v29 不逐字一致\nEXP: ' + newCond + '\nLIB: ' + libLegs[0].condition);
  }
  // ── ②卖腿[9] -45 → -35 ──
  sell9.condition = SELL9_NEW;

  // ── libraryRefs buy-v2 28→29（纯 provenance；rug-exit 不动）──
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (buyRef) { buyRef.version = 29; buyRef.snapshotAt = new Date().toISOString(); }

  cfg.name = 'v30-实盘-both-集中度臂放宽-netBuyRatio50-1022';
  cfg.description = 'v29 + e8da 案批次二（两变量）：①买腿=库 buy-v2 v29——集中度第一臂去 '
    + 'mcap<4500（famous<40 即过整臂，五腿组只在 famous>=40 评估）+ flap 臂去 mcap<4500 豁免'
    + '（须 routerPct>=30）+ earlyTradesNetBuyRatio>=50（fire 净/毛比，23 票回放拦 6 输家+3 平微'
    + '误伤 1、3 赢家全保留）②卖腿[9] ddh -45→-35（低市值档与中档一致）。发起门/GMGN 门/'
    + '17 卖腿（含 rug-exit）/钱包/其余 config 与 v29 b2f02dce 逐字一致。源=v29 b2f02dce';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| sellLegs:', sellLegs.length);
  console.log('fire:', buy.condition);
  console.log('trigger:', buy.narrativeTriggerCondition);
  console.log('sell[9]:', sell9.condition);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V30_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
