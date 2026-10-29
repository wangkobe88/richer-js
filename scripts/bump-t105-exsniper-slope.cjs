#!/usr/bin/env node
// ============================================================================
// 库 T105 剔狙击段趋势键换轨：holderTrendSlope > 0 → holderTrendSlopeExSniper > 0
//   （buy-v2 v51→v52，仅首买主腿；early/repeat/momentum 臂不动）
//   2026-10-29 用户裁定「好，换吧」。语义=FA 新键（ddc0f3c）：跳过有 tick 的
//   前 4 个不同 block（无交易块不计入），第 5 个不同 block 起 ≥4 点才出斜率，
//   <4 点键缺失 → >0 恒 false fail-closed。v60 对拍：火点拦 MWEZI/大肚柴犬/
//   0x297d（dp≤7 必拦），WOFL dp8 不拦，赢单 0x5ca9 保住；实效多为 wallet 段
//   追平后延迟 1-9s 放行非拦死（0x297d 晚 9s 价 -7%）。台账 T105。
//   ⚠️ copy-in 快照语义：需新建实验引用 v52（create-v64.cjs）。
//   ⚠️ 部署红线：新键条件 + 旧 FA 代码 = loadStrategies 未知因子三防线 throw
//   ——182 须先 git pull 至含 ddc0f3c 再建/跑 v64。
// 防呆：旧段恰一次 → 新段恰一次 / 换后无裸 holderTrendSlope 残留（ExSniper
//   除外）/ 全门锚定（换段段剔除）/ first 路由（buyPhase/maxExecutions=2）/
//   trigger 与 gmgn 不动（与源逐字一致，不硬编码形状）。
// 用法：node scripts/bump-t105-exsniper-slope.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const NAME = 'buy-v2';
const FROM_VERSION = 51;
const OLD_SEG = 'holderTrendSlope > 0';
const NEW_SEG = 'holderTrendSlopeExSniper > 0';

// 全门锚定（T103 同款清单剔除被换的 holderTrendSlope 段；换段后仍须恰一次）
const KEEPS = [
  '(tokenAgeSec < 90 OR tradeCount >= 25)',
  'marketCap > 4.7', 'marketCap < 27',
  '(narrativeRating == 2 OR narrativeRating == 3)',
  'top2HolderCircPct < 55', 'top1HolderCircPct < 35',
  'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
  '(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)',
  '(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)',
  'drawdownFromHighest > -70',
  'crashSpeedPctPerSec > -10',
];

const DESC = ' | 2026-10-29 v52（T105 剔狙击段趋势键）：holderTrendSlope > 0 →'
  + ' holderTrendSlopeExSniper > 0——跳过有交易后前 4 个 slot（=有 tick 的前 4 个不同'
  + ' block，无交易块不计入），第 5 个 slot 起 ≥4 点 holder 上涨趋势才过门（<4 点键缺失'
  + ' fail-closed）。动机=出生初期 8 点窗被狙击手段污染，火点看到的是狙击手冲高而非真'
  + '流动性涌入。v60 对拍：火点拦 MWEZI 0x20d2fa63…/大肚柴犬 0x763ef316…/0x297d33af…'
  + '（dp≤7 必拦），WOFL 0x681c4dc9… dp8 不拦，赢单 0x5ca91444… 保住；实效多为 wallet 段'
  + '追平后延迟 1-9s 放行非拦死。仅首买主腿换键；early/repeat/momentum 臂不动。'
  + '⚠️copy-in：需新建实验引用 v52（create-v64.cjs）。'
  + '详档 docs/交易策略改进与Case台账.md T105';

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');

  const entry = list.find((e) => e.name === NAME);
  if (!entry) throw new Error(`库中无 ${NAME} 条目`);
  if (entry.version !== FROM_VERSION) {
    throw new Error(`${NAME} version=${entry.version}，期望 ${FROM_VERSION}（先核对谱系再跑）`);
  }
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;
  if (legs.length !== 1) throw new Error(`${NAME} 腿数=${legs.length}，期望 1`);
  const leg = legs[0];
  if (leg.buyPhase !== 'first') throw new Error(`${NAME} buyPhase=${JSON.stringify(leg.buyPhase)}，期望 'first'（T100 路由）`);
  if (leg.maxExecutions !== 2) throw new Error(`${NAME} maxExecutions=${JSON.stringify(leg.maxExecutions)}，期望 2（T89 二次入场）`);
  if (!leg.narrativeTriggerCondition) throw new Error(`${NAME} trigger 缺失（本批不动它）`);
  if (!leg.gmgnCheckCondition) throw new Error(`${NAME} gmgn 缺失（本批不动它）`);
  if (leg.condition.includes('ExSniper')) throw new Error(`${NAME} 源已含 ExSniper（源应是 v51 旧键）`);

  let cond = leg.condition;
  if (cond.split(OLD_SEG).length !== 2) throw new Error(`${NAME} 旧段 holderTrendSlope > 0 非恰一次`);
  cond = cond.replace(OLD_SEG, NEW_SEG);
  if (cond.split(NEW_SEG).length !== 2) throw new Error(`${NAME} 新段 holderTrendSlopeExSniper > 0 非恰一次`);
  // 残留反证：剥掉全部 ExSniper 键后不得再出现裸 holderTrendSlope（防误伤其它趋势键引用）
  if (cond.replace(/holderTrendSlopeExSniper/g, '').includes('holderTrendSlope')) {
    throw new Error(`${NAME} 换后残留裸 holderTrendSlope 字样`);
  }
  for (const seg of KEEPS) {
    if (cond.split(seg).length !== 2) throw new Error(`${NAME} 防误伤锚定子串非恰一次: ${seg}`);
  }

  console.log(`== ${NAME}: v${full.version} → v${full.version + 1}`);
  console.log('new condition:', cond);
  if (COMMIT) {
    const outLegs = JSON.parse(JSON.stringify(legs));
    outLegs[0].condition = cond;
    const out = await svc.update(entry.id, {
      name: full.name,
      description: (full.description || '') + DESC,
      legs: outLegs,
      expectedVersion: full.version,
    });
    console.log(`✅ committed version=${out.version}`);
  } else {
    console.log('\n[dry-run]');
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
