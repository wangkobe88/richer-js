#!/usr/bin/env node
// ============================================================================
// 建 v31 live both 实验（2026-10-22 五腿案批次）
//   克隆 v30 3e6ce27a-85e2-4726-ae7d-348ffe7790d0（1 买 + 17 卖含 rug-exit 臂）：
//   唯一变量=买腿 condition 换库 buy-v2 v30 逐字快照（五腿无条件 AND 化去 famous<40
//   豁免 + bundle 50→35 + 三处 IS NULL 臂删除——FA famous/sybil/crashSpeed 已随
//   64b327e 系提交改 null→0，裸比较与原 IS NULL 臂逐输入等价）。
//   libraryRefs buy-v2 29→30；卖腿 17 条/发起门/GMGN 门/钱包/卡牌/叙事段与 v30 逐字一致。
// 防呆：源必须 stopped；买腿 v29 快照四处旧形状恰一替换后与库 v30 逐字对拍；
//   17 卖腿数断言；替换后零 IS NULL。
// 用法：node scripts/create-v31.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '3e6ce27a-85e2-4726-ae7d-348ffe7790d0'; // v30 live both（库 v29 快照 + netBuyRatio50 + 卖腿[9] -35）

const BUY_CHANGES = [
  ['((famousCopyWalletCircPct IS NULL OR famousCopyWalletCircPct < 40) OR (holderTrendSlope > 0 AND bundleClusterSharePct < 50 AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20))',
   'holderTrendSlope > 0 AND bundleClusterSharePct < 35 AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20'],
  ['(famousCopyWalletCircPct IS NULL OR famousCopyWalletCircPct < 15)',
   'famousCopyWalletCircPct < 15'],
  ['(sybilClusterHolderCircPct IS NULL OR sybilClusterHolderCircPct < 35)',
   'sybilClusterHolderCircPct < 35'],
  ['(crashSpeedPctPerSec IS NULL OR crashSpeedPctPerSec > -10)',
   'crashSpeedPctPerSec > -10'],
];

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
  // 源形状锁定（v30 谱系：库 v29 快照）
  for (const [oldSeg] of BUY_CHANGES) {
    if (buy.condition.split(oldSeg).length !== 2) {
      throw new Error('源 fire condition 非 v29 快照形状（恰一次）: ' + oldSeg);
    }
  }
  if (buy.narrativeTriggerCondition !== 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1') {
    throw new Error('源 trigger 形状非 v29/v30: ' + buy.narrativeTriggerCondition);
  }
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error('源 perCardBNB 缺失');
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 17) throw new Error('源卖腿数=' + sellLegs.length + ' 期望 17（含 rug-exit 臂）');
  // rug-exit 臂在场断言（v29/v30 libraryRefs 引用）
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');

  // ── v31 唯一变量：买腿四处替换（与库 v30 逐字对拍）──
  let newCond = buy.condition;
  for (const [oldSeg, newSeg] of BUY_CHANGES) newCond = newCond.replace(oldSeg, newSeg);
  if (newCond.includes('IS NULL')) throw new Error('替换后仍含 IS NULL（去 NULL 批次要求零残留）');
  buy.condition = newCond;
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry || entry.version !== 30) throw new Error('库 buy-v2 version=' + (entry && entry.version) + ' 期望 30（先跑 bump-buy-v2-v30.cjs --commit）');
  const full = await svc.getById(entry.id);
  const libLegs = full.legs.legs || full.legs;
  if (libLegs[0].condition !== newCond) {
    throw new Error('替换后 condition 与库 v30 不逐字一致\nEXP: ' + newCond + '\nLIB: ' + libLegs[0].condition);
  }

  // ── libraryRefs buy-v2 29→30（纯 provenance；rug-exit 不动）──
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (buyRef) { buyRef.version = 30; buyRef.snapshotAt = new Date().toISOString(); }

  cfg.name = 'v31-实盘-both-五腿AND化-bundle35-去NULL-1022';
  cfg.description = 'v30 + 五腿案批次（单变量）：买腿=库 buy-v2 v30——五腿（slope>0/bundle<35/'
    + 'top1<35/copy<20）无条件 AND 评估，famous<40 豁免臂删除（被 famous<15 独立门蕴含，'
    + 'v29 形状 287 票 famous>=40 零出现=五腿死代码）+ 三处 IS NULL 臂删除（FA famous/sybil/'
    + 'crashSpeed null→0 配套，裸比较逐输入等价）。发起门/GMGN 门/17 卖腿（含 rug-exit）/钱包/'
    + '其余 config 与 v30 3e6ce27a 逐字一致。源=v30 3e6ce27a';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| sellLegs:', sellLegs.length);
  console.log('fire:', buy.condition);
  console.log('trigger:', buy.narrativeTriggerCondition);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V31_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
