#!/usr/bin/env node
// ============================================================================
// 库新条目 buy-early-narrative v1（2026-10-28 T84 早期叙事臂，用户裁定）
//   理念：现行买腿等「盘面强势」确认；本臂补「叙事通过后价格未起」的早期入场
//   ——C84 不变量「发起门量级 < 买门量级」保证叙事分析必然先于主腿可满足，中间
//   即窗口。8 天回放（scripts/tmp-early-narrative-arm-replay.cjs，182 跑）v3 矩阵
//   最优 g3-hiBand×e1：4500-5000 USD 强池带（BNB 域 6.0-6.7）119 票净 +0.0328 BNB
//   胜率 18% +13.8%/票（九天全正）；对照同期 live 实际成交 -0.0285。
//   门形（回放 g3-hiBand + 坏人门全保留 + 主腿通用防御腿）：
//     - rating 2|3（用户裁定：评级对高中质量区分无力，都入池）
//     - tokenAgeSec < 600（早期窗；回放 AGE_MAX_SEC=600）
//     - 市值带 6.0-6.7 BNB（BNB 域，T84 量纲切换；「叙事+初步盘面」双确认形状——
//       4000-4500 USD 死亡带 46 张非断流票仅 1 赢家）
//     - 承接门放松版 buyVolumeBnbExSybil >= 0.25 OR holdersExSybil >= 4
//       （回放证：放松承接门零增益零损失=门本不构成约束，取小值保底）
//     - 净买门不放松（tradesNetBuyRatio >= 40 OR Win >= 40——回放证放松有害：
//       放进来的是卖压票，「可松承接量门、不可松净买质量门」）
//     - 坏人门全保留：bundle 三门/top1/copy/famous/sybil（回放乐观上界=未计
//       bundle 三门，实跑更严）
//     - flap router 门/崩盘双门随主腿
//   cards 3（与主腿共 6 卡）；GMGN 条件随 v43（市值 <10.7 豁免臂在本带恒真=
//   超早期 bundler 采样噪声豁免，T82 裁定；issuer 分档门照拦 serial issuer）。
//   卖腿适配（600s 止损/protect20/27 上位离场/T79 与衰竭腿豁免）在实验侧
//   （create-v46.cjs，entryMarketCap 域限定），本条目只管买。
//   ⚠️ 前置：进程代码已含 T84 commit（FA marketCap BNB 域 + entryMarketCap 键）。
// 防呆：断言 buy-v2 已 v43（gmgn 10.7 臂在场=量纲同批证据）；同名条目已存在即拒。
// 用法：node scripts/create-buy-early-narrative-v1.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const CONDITION = '(narrativeRating == 2 OR narrativeRating == 3) AND tokenAgeSec < 600 '
  + 'AND marketCap > 6.0 AND marketCap < 6.7 '
  + 'AND (buyVolumeBnbExSybil >= 0.25 OR holdersExSybil >= 4) '
  + 'AND (tradesNetBuyRatio >= 40 OR tradesNetBuyRatioWin >= 40) '
  + 'AND bundleClusterHoldCircPct < 35 AND top2BundleClusterHoldCircPct < 55 AND top3BundleClusterHoldCircPct < 75 '
  + 'AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20 '
  + 'AND famousCopyWalletCircPct < 15 AND sybilClusterHolderCircPct < 35 '
  + "AND (platform != 'flap' OR tradesRouterPct >= 30) "
  + 'AND drawdownFromHighest > -70 AND crashSpeedPctPerSec > -10';
const TRIGGER = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN = '(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 65) AND ((narrativeCategory IS NULL OR '
  + "(narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' "
  + "AND narrativeCategory != 'web3_native_ip_early')) "
  + 'OR gmgnIssuerTokenCount <= 1)';
const DESCRIPTION = '早期叙事臂 v1（2026-10-28 T84 用户裁定）：叙事通过后价格未起的早期入场——'
  + '市值带 6.0-6.7 BNB（BNB 域）+rating 2|3+600s 窗+承接门放松版 0.25/4+净买门不放松 40'
  + '+坏人门全保留。回放（8 天 2599 叙事通过票，182 跑）g3-hiBand×e1：119 票净 +0.0328 BNB '
  + '胜率 18% +13.8%/票（九天全正；对照同期 live -0.0285）。8 天回放里 4000-4500 USD 死亡带'
  + '仅 1 赢家 → 带收窄 4500-5000 USD（=6.0-6.7 BNB）是强池；断流死亡票占亏损 38%（90 折敏感'
  + '性≈无损）。卖腿适配=实验侧 entryMarketCap 域限定（600s 止损/protect20/27 上位离场/T79 与'
  + '衰竭腿豁免）。cards 3（与 buy-v2 共 6 卡，用户裁定）。详档 docs/交易策略改进与Case台账.md T84';

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  if (list.find(e => e.name === 'buy-early-narrative')) {
    throw new Error('buy-early-narrative 已存在（先核对谱系，勿重复建）');
  }
  // buy-v2 必须 v43（10.7 臂在场=量纲同批证据；cards 3=6 卡制同批证据）
  const main = list.find(e => e.name === 'buy-v2');
  if (!main || main.version !== 43) {
    throw new Error(`buy-v2 version=${main && main.version}，期望 43（先跑 bump-buy-v2-v42/v43.cjs --commit）`);
  }
  const mainFull = await svc.getById(main.id);
  const mainLeg = (mainFull.legs.legs || mainFull.legs)[0];
  if (mainLeg.cards !== 3) throw new Error('buy-v2 cards=' + mainLeg.cards + '，期望 3（6 卡制未同批）');
  if (!mainLeg.gmgnCheckCondition.includes('marketCap < 10.7')) {
    throw new Error('buy-v2 gmgn 非 BNB 域形状（量纲未同批）');
  }

  const leg = {
    cards: 3,
    priority: 2,
    condition: CONDITION,
    description: DESCRIPTION,
    maxExecutions: mainLeg.maxExecutions,
    gmgnCheckCondition: GMGN,
    narrativeTriggerCondition: TRIGGER,
  };

  console.log('name:     buy-early-narrative v1 (buy)');
  console.log('condition:', CONDITION);
  console.log('gmgn:     ', GMGN);
  console.log('trigger:  ', TRIGGER);
  console.log('cards: 3 | priority: 2 | maxExecutions:', leg.maxExecutions);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const created = await svc.create({
    name: 'buy-early-narrative',
    description: DESCRIPTION,
    side: 'buy',
    legs: [leg],
  });
  console.log('CREATED id=' + created.id + ' version=' + created.version);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
