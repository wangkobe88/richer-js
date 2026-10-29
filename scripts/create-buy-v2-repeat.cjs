#!/usr/bin/env node
// ============================================================================
// 库 T100 首买/再买分臂：①新建 buy-v2-repeat v1（整腿复制 buy-v2 v50，GMGN 删
//   issuer 分档臂 + buyPhase:'repeat' + maxExecutions 2→1）②bump buy-v2 v50→v51
//   （整腿仅加 buyPhase:'first'）。
//   2026-10-29 Sprout 0x3319…7777 借壳案裁定：正主首买时点 GMGN
//   twitter_create_token_count=1 干净（issuer 门判断正确，首买过滤保留）；
//   二次入场时点计数已被借壳者污染（13 秒 4 钱包同 meta CID 连环发币 1→5→8），
//   再买轮 issuer 门不可参考 → 再买臂删该臂，路由 buyPhase 显式化（防两臂
//   条件分叉后首买绕门，见 _test_buy_phase_routing.cjs）。
//   priority 保持 1（与首买臂同级）：快票再买轮须压过 early P2（单测 C4）。
//   ⚠️ copy-in 快照语义：需新建实验引用 v51/v1（create-v57.cjs）。
// 防呆：version 恰 50 / 腿数 1 / gmgn+trigger 全串锚定 / maxExecutions===2 /
//   condition T98 锚定子串（holdersExDust·T96 AND 净买门·T93 35/55）恰一次 /
//   新条目重名预检（幂等防重）/ 换后 issuer 段零残留（再买臂）。
// 用法：node scripts/create-buy-v2-repeat.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const FROM_VERSION = 50;
const REPEAT_NAME = 'buy-v2-repeat';
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_V50 = "(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100) AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early')) OR gmgnIssuerTokenCount <= 1)";
const GMGN_REPEAT = '(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100)';
const COND_KEEPS = [
  '(tokenAgeSec < 90 OR tradeCount >= 25)', 'marketCap > 4.7', 'marketCap < 27',
  '(narrativeRating == 2 OR narrativeRating == 3)', 'holderTrendSlope > 0',
  'top2HolderCircPct < 55', 'top1HolderCircPct < 35',
  'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
  '(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)',
  '(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)',
  'drawdownFromHighest > -70', 'crashSpeedPctPerSec > -10',
];

const CASE_NOTE = 'Sprout 0x3319…7777 借壳案（06:08:56-06:09:09 十三秒内 4 钱包同 meta CID 发 4 币+1 抢名币，'
  + 'GMGN 推特维度归因计数 1→5→8）：首买时点计数干净 issuer 门判断正确；再买时点已被借壳连环发币污染不可参考'
  + '——用户裁定再买臂删该臂。详档 docs/交易策略改进与Case台账.md T100';

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');

  // ── 源腿锚定（buy-v2 v50 整腿快照）──
  const entry = list.find((e) => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== FROM_VERSION) throw new Error(`buy-v2 version=${entry.version}，期望 ${FROM_VERSION}（先核对谱系再跑）`);
  const dup = list.find((e) => e.name === REPEAT_NAME);
  if (dup) throw new Error(`${REPEAT_NAME} 已存在（id=${dup.id} version=${dup.version}）——本脚本只建一次，勿重跑`);
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;
  if (legs.length !== 1) throw new Error(`buy-v2 腿数=${legs.length}，期望 1`);
  const leg = legs[0];
  if (leg.gmgnCheckCondition !== GMGN_V50) throw new Error('buy-v2 gmgn 非 v50 形状');
  if (leg.narrativeTriggerCondition !== TRIGGER_EXPECT) throw new Error('buy-v2 trigger 形状非预期');
  if (leg.maxExecutions !== 2) throw new Error(`buy-v2 maxExecutions=${JSON.stringify(leg.maxExecutions)}，期望 2`);
  if (leg.priority !== 1) throw new Error(`buy-v2 priority=${JSON.stringify(leg.priority)}，期望 1`);
  if (leg.cards !== 3) throw new Error(`buy-v2 cards=${JSON.stringify(leg.cards)}，期望 3`);
  if (leg.buyPhase != null) throw new Error(`buy-v2 v${FROM_VERSION} 已带 buyPhase（${JSON.stringify(leg.buyPhase)}）——先核对谱系`);
  for (const seg of COND_KEEPS) {
    if (String(leg.condition).split(seg).length !== 2) throw new Error(`buy-v2 condition 锚定子串非恰一次: ${seg}`);
  }

  // ── ① buy-v2-repeat v1：整腿复制 + 三处差异 ──
  const repeatLeg = JSON.parse(JSON.stringify(leg));
  repeatLeg.gmgnCheckCondition = GMGN_REPEAT;
  repeatLeg.buyPhase = 'repeat';
  repeatLeg.maxExecutions = 1;
  // priority 刻意保持 1（与首买臂同级，勿改低）：快票形状（Sprout 7 分钟内买→全清→
  // 再买）early 臂 age<600 仍真，再买臂 P1 须压过 early P2——否则再买轮被带 issuer
  // 门的 early 臂遮蔽误拦（单测 C4 锁此序）。buyPhase 互斥保首买/再买同 P1 不竞争
  if (repeatLeg.priority !== 1) throw new Error(`复制腿 priority=${repeatLeg.priority}，期望 1`);
  repeatLeg.description = `买腿 v1（2026-10-29 T100 再买专用臂）：整腿复制 buy-v2 v50，仅三处差异——`
    + `①gmgnCheckCondition 删 issuer 分档臂（剩 mcap 豁免 OR bundler 两臂）②buyPhase:'repeat'`
    + `（仅全清后可见，StrategyEngine 轮次路由；priority 保持 1 压过 early P2 防快票再买轮被遮蔽）`
    + `③maxExecutions 2→1（总买入=首买 1+再买 1 对齐 v50=2 语义）。`
    + `主 condition/trigger/cards 全不动。${CASE_NOTE}`;

  console.log('== 新建 buy-v2-repeat v1（side=buy，单腿）');
  console.log('  gmgn:', repeatLeg.gmgnCheckCondition);
  console.log('  buyPhase:', repeatLeg.buyPhase, '| maxExecutions:', repeatLeg.maxExecutions);

  // ── ② buy-v2 v50→v51：整腿仅加 buyPhase:'first' ──
  const firstLegs = JSON.parse(JSON.stringify(legs));
  firstLegs[0].buyPhase = 'first';
  const v51Desc = (full.description || '')
    + ' | 2026-10-29 v51（T100 首买标记）：整腿仅加 buyPhase:\'first\'（仅 round 0 可见——'
    + '首买必须过 issuer 分档门，该时点 GMGN 计数未被借壳者污染）。其余全不动。'
    + '⚠️copy-in：需新建实验引用 v51。详档 docs/交易策略改进与Case台账.md T100';

  console.log(`\n== bump buy-v2: v${full.version} → v${full.version + 1}（buyPhase:'first'）`);

  if (COMMIT) {
    const created = await svc.create({ name: REPEAT_NAME, description: repeatLeg.description, side: 'buy', legs: [repeatLeg] });
    console.log(`✅ committed ${REPEAT_NAME} v${created.version} (id=${created.id})`);
    const out = await svc.update(entry.id, {
      name: full.name, description: v51Desc, legs: firstLegs, expectedVersion: full.version,
    });
    console.log(`✅ committed buy-v2 v${out.version}`);
  } else {
    console.log('\n[dry-run] 未落库');
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
