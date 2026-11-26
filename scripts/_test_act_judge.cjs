/**
 * act-judge（AF3 活跃度因子判定）单测：零 DB 零网络纯函数。
 * 夹具=Jev activity_level 题面「真实样本」逐字转写（cheat-questions.mjs 题面正例/
 * 反例）+ 判序真值表（四臂顺序 / cap 只压不抬 / ⑥burst 抬档 / ④极早窗反锚 / 出货臂
 * 直返不受背景压制 / 短窗尾窗键恒算 / 锚缺席 fail-open 不成立）。
 * 改 act-judge.js 必跑：node scripts/_test_act_judge.cjs
 */
'use strict';

const { judgeActLevel, judgeStallBurstWave, ACT_JUDGE_VERSION, LINES } = require('../src/market-analysis/act-judge');

let pass = 0, fail = 0;
const check = (name, got, want, extra) => {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${w}\n    实际 ${g}${extra ? ` | ${extra}` : ''}`); }
};
const ok = (name, cond, extra) => check(name, cond, true, extra);

/** 基底：全窗综合=mid 的普通形状（近段锚全有但四臂都不命中） */
const BASE = {
  spanSec: 120, tickCount: 40, ticksPerMin: 20, idlePct: 0, maxGapSec: 8,
  buyMedianBnb: 0.08, throughputBnbPerMin: 3, maxDrawdownPct: 12,
  buyN: 22, sellN: 18, totalBuyBnb: 1.8, totalSellBnb: 1.2,
  nearSegTickN: 8, nearSegTicksPerMin: 16, nearSegBuyMedianBnb: 0.08, nearSegBnbPerMin: 3,
  nearSegMaxGapSec: 6, nearSegBuyN: 5, nearSegSellN: 3,
  nearSegBuyBnb: 0.8, nearSegSellBnb: 0.5,
  nearTail10TickN: 4, nearTail10BnbPerMin: 3, nearPre20BnbPerMin: 3,
  nearTail5TickN: 2, nearTail5BuyN: 1, nearTail5BuyBnb: 0.1, nearTail10SellWallets: 2,
  nearTail10BuyN: 2, nearTail10BuyBnb: 0.1,
  nearPre10GapSec: 2, nearPre10Wallets: 5,
  actWeightedThroughputBnbPerMin: 2.5,
  burstLastGapSec: null,
};
const D = (o) => ({ ...BASE, ...o });

console.log('A. 版本与证据门');
check('A1 版本常量', ACT_JUDGE_VERSION, 'AF3');
check('A2 无时间轴证据 → act null（fail-open 上游放行）', judgeActLevel({}), { act: null, arm: 'no_evidence', trace: { spanSec: null, tickCount: null } });

console.log('\nB. 题面真实样本转写（低档五正例）');
// ① 大比例无交易期：17 笔 53s 静默 72% → low
check('B1 无交易期占比 72% → idle_major low', [judgeActLevel(D({ spanSec: 53, tickCount: 17, idlePct: 72, maxGapSec: 26, ticksPerMin: 19, throughputBnbPerMin: 4, buyMedianBnb: 0.08 })).act,
  judgeActLevel(D({ spanSec: 53, tickCount: 17, idlePct: 72, maxGapSec: 26, ticksPerMin: 19, throughputBnbPerMin: 4, buyMedianBnb: 0.08 })).arm], ['low', 'idle_major']);
// ② 单向死水推进：3min 39 笔 36:3 笔、额 9:1、回撤 3%（非极早窗）→ low
check('B2 单向推进（36:3 笔 / 9:1 额 / 回撤 3%）→ one_way_dead low', [
  judgeActLevel(D({ spanSec: 180, tickCount: 39, ticksPerMin: 14, buyMedianBnb: 0.04, throughputBnbPerMin: 3, maxDrawdownPct: 3, buyN: 36, sellN: 3, totalBuyBnb: 9, totalSellBnb: 1 })).act,
  judgeActLevel(D({ spanSec: 180, tickCount: 39, ticksPerMin: 14, buyMedianBnb: 0.04, throughputBnbPerMin: 3, maxDrawdownPct: 3, buyN: 36, sellN: 3, totalBuyBnb: 9, totalSellBnb: 1 })).arm,
], ['low', 'one_way_dead']);
// ③ 临近死寂：72s 24 笔全买、临近 30s 买中位 0.0002、吞吐 0.26 → near_dead low
check('B3 临近段买中位尘埃 → near_dead low', [
  judgeActLevel(D({ spanSec: 72, tickCount: 24, ticksPerMin: 20, idlePct: 0, buyMedianBnb: 0.05, throughputBnbPerMin: 1.2, maxDrawdownPct: 10, buyN: 24, sellN: 0, totalBuyBnb: 1.2, totalSellBnb: 0, nearSegBuyMedianBnb: 0.0002, nearSegBnbPerMin: 0.26, nearSegBuyBnb: 0.05, nearSegSellBnb: 0 })).act,
  judgeActLevel(D({ spanSec: 72, tickCount: 24, ticksPerMin: 20, idlePct: 0, buyMedianBnb: 0.05, throughputBnbPerMin: 1.2, maxDrawdownPct: 10, buyN: 24, sellN: 0, totalBuyBnb: 1.2, totalSellBnb: 0, nearSegBuyMedianBnb: 0.0002, nearSegBnbPerMin: 0.26, nearSegBuyBnb: 0.05, nearSegSellBnb: 0 })).arm,
], ['low', 'near_dead']);
// ④ 全窗稀疏间歇死水：4.5min 43 笔、吞吐 0.43、中位 0.025、空窗 47s → 四腿联立 low
check('B4 四腿联立稀疏（9.5 笔/分 ∧ 0.43B/分 ∧ 中位 0.025 ∧ 空窗 47s）→ sparse_four_legs low', [
  judgeActLevel(D({ spanSec: 270, tickCount: 43, ticksPerMin: 9.5, throughputBnbPerMin: 0.43, buyMedianBnb: 0.025, maxGapSec: 47, idlePct: 27 })).act,
  judgeActLevel(D({ spanSec: 270, tickCount: 43, ticksPerMin: 9.5, throughputBnbPerMin: 0.43, buyMedianBnb: 0.025, maxGapSec: 47, idlePct: 27 })).arm,
], ['low', 'sparse_four_legs']);
// ⑤ 匀速尘埃流：16min 91 笔、吞吐 0.1、买中位 0.0003 → ③尘埃假活跃 low
check('B5 尘埃假活跃（中位 0.0003 ∧ 吞吐 0.1）→ dust_fake_active low', [
  judgeActLevel(D({ spanSec: 960, tickCount: 91, ticksPerMin: 12.5, maxGapSec: 13, idlePct: 0, buyMedianBnb: 0.0003, throughputBnbPerMin: 0.1, buyN: 87, sellN: 4, totalBuyBnb: 1.3, totalSellBnb: 0.1, nearSegBuyMedianBnb: 0.001, nearSegBnbPerMin: 0.2, nearSegBuyBnb: 0.03, nearSegSellBnb: 0.01, nearTail10BnbPerMin: 0.2, nearPre20BnbPerMin: 0.2, nearTail5BuyN: 1, nearTail5BuyBnb: 0.001, nearTail10SellWallets: 1, nearTail10BuyN: 2, nearTail10BuyBnb: 0.002 })).act,
  judgeActLevel(D({ spanSec: 960, tickCount: 91, ticksPerMin: 12.5, maxGapSec: 13, idlePct: 0, buyMedianBnb: 0.0003, throughputBnbPerMin: 0.1, buyN: 87, sellN: 4, totalBuyBnb: 1.3, totalSellBnb: 0.1, nearSegBuyMedianBnb: 0.001, nearSegBnbPerMin: 0.2, nearSegBuyBnb: 0.03, nearSegSellBnb: 0.01, nearTail10BnbPerMin: 0.2, nearPre20BnbPerMin: 0.2, nearTail5BuyN: 1, nearTail5BuyBnb: 0.001, nearTail10SellWallets: 1, nearTail10BuyN: 2, nearTail10BuyBnb: 0.002 })).arm,
], ['low', 'near_dead']);

console.log('\nC. 题面真实样本转写（⑦四臂 + 高/超高）');
// 临近衰减：26s 窗 60 笔、尾 10s 3.9 vs 前 20s 33.7（跌九成）、尾 5s 1 笔无买 → 至多中
check('C1 短窗断崖衰减（26s 窗；尾窗键恒算）→ near_decay mid', [
  judgeActLevel(D({ spanSec: 26, tickCount: 60, ticksPerMin: 138, idlePct: 0, maxGapSec: 3, buyMedianBnb: 0.3, throughputBnbPerMin: 19.7, maxDrawdownPct: 5, nearTail10BnbPerMin: 3.9, nearPre20BnbPerMin: 33.7, nearTail5TickN: 1, nearTail5BuyN: 0, nearTail5BuyBnb: 0, nearTail10SellWallets: 1, nearTail10BuyN: 0, nearTail10BuyBnb: 0, nearSegTickN: null })).act,
  judgeActLevel(D({ spanSec: 26, tickCount: 60, ticksPerMin: 138, idlePct: 0, maxGapSec: 3, buyMedianBnb: 0.3, throughputBnbPerMin: 19.7, maxDrawdownPct: 5, nearTail10BnbPerMin: 3.9, nearPre20BnbPerMin: 33.7, nearTail5TickN: 1, nearTail5BuyN: 0, nearTail5BuyBnb: 0, nearTail10SellWallets: 1, nearTail10BuyN: 0, nearTail10BuyBnb: 0, nearSegTickN: null })).arm,
], ['mid', 'near_decay']);
// 临近仍活：近段 5B/分、尾 10s 5.3 vs 前 20s 6.1 未断崖、尾 5s 6 笔买 0.6 → high
check('C2 临近仍活 → near_alive high', [
  judgeActLevel(D({ spanSec: 120, tickCount: 60, ticksPerMin: 30, buyMedianBnb: 0.1, throughputBnbPerMin: 6, maxDrawdownPct: 10, buyN: 35, sellN: 25, totalBuyBnb: 3, totalSellBnb: 2.5, nearSegBnbPerMin: 5, nearSegBuyBnb: 2.2, nearSegSellBnb: 1.5, nearSegBuyMedianBnb: 0.1, nearTail10BnbPerMin: 5.3, nearPre20BnbPerMin: 6.1, nearTail5BuyN: 6, nearTail5BuyBnb: 0.6, nearTail10SellWallets: 3, nearTail10BuyN: 4, nearTail10BuyBnb: 0.5, nearPre10GapSec: 1, nearPre10Wallets: 6, actWeightedThroughputBnbPerMin: 4.5 })).act,
  judgeActLevel(D({ spanSec: 120, tickCount: 60, ticksPerMin: 30, buyMedianBnb: 0.1, throughputBnbPerMin: 6, maxDrawdownPct: 10, buyN: 35, sellN: 25, totalBuyBnb: 3, totalSellBnb: 2.5, nearSegBnbPerMin: 5, nearSegBuyBnb: 2.2, nearSegSellBnb: 1.5, nearSegBuyMedianBnb: 0.1, nearTail10BnbPerMin: 5.3, nearPre20BnbPerMin: 6.1, nearTail5BuyN: 6, nearTail5BuyBnb: 0.6, nearTail10SellWallets: 3, nearTail10BuyN: 4, nearTail10BuyBnb: 0.5, nearPre10GapSec: 1, nearPre10Wallets: 6, actWeightedThroughputBnbPerMin: 4.5 })).arm,
], ['high', 'near_alive']);
// 协同出货：尾 10s 71 卖方钱包、买 1 笔尘埃 → ultra（直返不受背景压制）
check('C3 协同出货（71 钱包纯卖 + 1 笔尘埃买）→ coop_dump ultra（直返不压档）', [
  judgeActLevel(D({ spanSec: 60, tickCount: 80, idlePct: 50, ticksPerMin: 80, buyMedianBnb: 0.05, throughputBnbPerMin: 7, maxDrawdownPct: 20, buyN: 1, sellN: 79, totalBuyBnb: 0.001, totalSellBnb: 6.2, nearTail10SellWallets: 71, nearTail10BuyN: 1, nearTail10BuyBnb: 0.001, nearSegBuyBnb: 0.001, nearSegSellBnb: 6, nearSegBuyMedianBnb: 0.001, nearSegBnbPerMin: 6, nearTail10BnbPerMin: 6, nearPre20BnbPerMin: 6, nearTail5BuyN: 0, nearTail5BuyBnb: 0, nearPre10GapSec: 1, nearPre10Wallets: 30 })).act,
  judgeActLevel(D({ spanSec: 60, tickCount: 80, idlePct: 50, ticksPerMin: 80, buyMedianBnb: 0.05, throughputBnbPerMin: 7, maxDrawdownPct: 20, buyN: 1, sellN: 79, totalBuyBnb: 0.001, totalSellBnb: 6.2, nearTail10SellWallets: 71, nearTail10BuyN: 1, nearTail10BuyBnb: 0.001, nearSegBuyBnb: 0.001, nearSegSellBnb: 6, nearSegBuyMedianBnb: 0.001, nearSegBnbPerMin: 6, nearTail10BnbPerMin: 6, nearPre20BnbPerMin: 6, nearTail5BuyN: 0, nearTail5BuyBnb: 0, nearPre10GapSec: 1, nearPre10Wallets: 30 })).arm,
], ['ultra', 'coop_dump']);
// 全窗极端密集：172 笔/分、吞吐相称 → ultra
check('C4 全窗极端密集（172 笔/分）→ whole_window_ultra', [
  judgeActLevel(D({ spanSec: 120, tickCount: 344, ticksPerMin: 172, maxGapSec: 2, idlePct: 0, buyMedianBnb: 0.1, throughputBnbPerMin: 20, nearTail10SellWallets: 5, nearTail10BuyN: 20, nearTail10BuyBnb: 3, nearTail10BnbPerMin: 20, nearPre20BnbPerMin: 20, nearTail5BuyN: 8, nearTail5BuyBnb: 1.5, nearSegBnbPerMin: 20, nearSegBuyBnb: 9, nearSegSellBnb: 7, nearSegBuyMedianBnb: 0.1, nearPre10GapSec: 1, nearPre10Wallets: 40, actWeightedThroughputBnbPerMin: 18 })).act,
  judgeActLevel(D({ spanSec: 120, tickCount: 344, ticksPerMin: 172, maxGapSec: 2, idlePct: 0, buyMedianBnb: 0.1, throughputBnbPerMin: 20, nearTail10SellWallets: 5, nearTail10BuyN: 20, nearTail10BuyBnb: 3, nearTail10BnbPerMin: 20, nearPre20BnbPerMin: 20, nearTail5BuyN: 8, nearTail5BuyBnb: 1.5, nearSegBnbPerMin: 20, nearSegBuyBnb: 9, nearSegSellBnb: 7, nearSegBuyMedianBnb: 0.1, nearPre10GapSec: 1, nearPre10Wallets: 40, actWeightedThroughputBnbPerMin: 18 })).arm,
], ['high', 'near_alive']);

console.log('\nD. 密集臂反锚');
// 砸盘潮假活跃（成色反锚）：近段吞吐 2.4 过线、卖买 8:1、买中位 0.02、静默 93.7% → ①cap low
check('D1 成色反锚（卖买 8:1）→ 密集不成立；静默 93.7% ①压 low', [
  judgeActLevel(D({ spanSec: 79, tickCount: 8, ticksPerMin: 6, maxGapSec: 74, idlePct: 93.7, buyMedianBnb: 0.02, throughputBnbPerMin: 2.4, maxDrawdownPct: 25, buyN: 3, sellN: 5, totalBuyBnb: 0.1, totalSellBnb: 1, nearSegBnbPerMin: 2.4, nearSegBuyBnb: 0.08, nearSegSellBnb: 0.98, nearSegBuyMedianBnb: 0.02, nearTail10BnbPerMin: 7.1, nearPre20BnbPerMin: 0, nearTail5BuyN: 1, nearTail5BuyBnb: 0.0867, nearTail10SellWallets: 2, nearTail10BuyN: 1, nearTail10BuyBnb: 0.0867, nearPre10GapSec: 74, nearPre10Wallets: 1 })).act,
  judgeActLevel(D({ spanSec: 79, tickCount: 8, ticksPerMin: 6, maxGapSec: 74, idlePct: 93.7, buyMedianBnb: 0.02, throughputBnbPerMin: 2.4, maxDrawdownPct: 25, buyN: 3, sellN: 5, totalBuyBnb: 0.1, totalSellBnb: 1, nearSegBnbPerMin: 2.4, nearSegBuyBnb: 0.08, nearSegSellBnb: 0.98, nearSegBuyMedianBnb: 0.02, nearTail10BnbPerMin: 7.1, nearPre20BnbPerMin: 0, nearTail5BuyN: 1, nearTail5BuyBnb: 0.0867, nearTail10SellWallets: 2, nearTail10BuyN: 1, nearTail10BuyBnb: 0.0867, nearPre10GapSec: 74, nearPre10Wallets: 1 })).arm,
], ['low', 'idle_major']);
// 孤立脉冲（段前背景反锚）：尾 10s 脉冲前 24s 静默、段前钱包 1 → 至多中
check('D2 段前背景反锚（gap 24s ∧ 段前钱包 1）→ near_alive_bg_denied mid', [
  judgeActLevel(D({ spanSec: 120, tickCount: 9, ticksPerMin: 4.5, maxGapSec: 24, idlePct: 40, buyMedianBnb: 0.05, throughputBnbPerMin: 1.3, maxDrawdownPct: 15, buyN: 5, sellN: 4, totalBuyBnb: 1.2, totalSellBnb: 1.1, nearSegBnbPerMin: 2.2, nearSegBuyBnb: 0.7, nearSegSellBnb: 0.6, nearSegBuyMedianBnb: 0.05, nearTail10BnbPerMin: 4.1, nearPre20BnbPerMin: 0, nearTail5BuyN: 5, nearTail5BuyBnb: 0.34, nearTail10SellWallets: 1, nearTail10BuyN: 5, nearTail10BuyBnb: 0.34, nearPre10GapSec: 24, nearPre10Wallets: 1, actWeightedThroughputBnbPerMin: 1.39 })).act,
  judgeActLevel(D({ spanSec: 120, tickCount: 9, ticksPerMin: 4.5, maxGapSec: 24, idlePct: 40, buyMedianBnb: 0.05, throughputBnbPerMin: 1.3, maxDrawdownPct: 15, buyN: 5, sellN: 4, totalBuyBnb: 1.2, totalSellBnb: 1.1, nearSegBnbPerMin: 2.2, nearSegBuyBnb: 0.7, nearSegSellBnb: 0.6, nearSegBuyMedianBnb: 0.05, nearTail10BnbPerMin: 4.1, nearPre20BnbPerMin: 0, nearTail5BuyN: 5, nearTail5BuyBnb: 0.34, nearTail10SellWallets: 1, nearTail10BuyN: 5, nearTail10BuyBnb: 0.34, nearPre10GapSec: 24, nearPre10Wallets: 1, actWeightedThroughputBnbPerMin: 1.39 })).arm,
], ['mid', 'near_alive_bg_denied']);
// 买入暂歇非出货：尾 10s 5 笔卖、卖方钱包 5 <10 → 不落出货臂；密集臂主腿过 → high
check('D3 买入暂歇非出货（卖方钱包 5）→ 不落出货臂照走密集臂', [
  judgeActLevel(D({ spanSec: 120, tickCount: 40, ticksPerMin: 20, idlePct: 0, maxGapSec: 6, buyMedianBnb: 0.1, throughputBnbPerMin: 5, maxDrawdownPct: 8, buyN: 20, sellN: 20, totalBuyBnb: 2.5, totalSellBnb: 2.3, nearSegTickN: 20, nearSegBuyN: 8, nearSegSellN: 7, nearSegBnbPerMin: 4, nearSegBuyBnb: 1.3, nearSegSellBnb: 0.9, nearSegBuyMedianBnb: 0.1, nearTail10BnbPerMin: 4, nearPre20BnbPerMin: 4.2, nearTail5BuyN: 0, nearTail5BuyBnb: 0, nearTail10SellWallets: 5, nearTail10BuyN: 0, nearTail10BuyBnb: 0, nearPre10GapSec: 2, nearPre10Wallets: 8 })).act,
], ['high']);

console.log('\nE. 反锚与抬档');
// ④极早窗反锚：28s 19 笔、18:1 笔、27:1 额、回撤 0% → ④不压；全窗综合（40.7 笔/分 <70）→ mid
check('E1 极早窗（28s/19 笔）单向不压档 → 题面本判 high（节奏密集金额正常）', [
  judgeActLevel(D({ spanSec: 28, tickCount: 19, ticksPerMin: 40.7, idlePct: 0, maxGapSec: 7, buyMedianBnb: 0.08, throughputBnbPerMin: 4, maxDrawdownPct: 0, buyN: 18, sellN: 1, totalBuyBnb: 27, totalSellBnb: 1, nearSegTickN: null, nearTail10SellWallets: 1, nearTail10BuyN: 12, nearTail10BuyBnb: 1.5, nearTail10BnbPerMin: 4, nearPre20BnbPerMin: 4, nearTail5BuyN: 5, nearTail5BuyBnb: 0.7, nearPre10GapSec: null, nearPre10Wallets: null })).act,
  judgeActLevel(D({ spanSec: 28, tickCount: 19, ticksPerMin: 40.7, idlePct: 0, maxGapSec: 7, buyMedianBnb: 0.08, throughputBnbPerMin: 4, maxDrawdownPct: 0, buyN: 18, sellN: 1, totalBuyBnb: 27, totalSellBnb: 1, nearSegTickN: null, nearTail10SellWallets: 1, nearTail10BuyN: 12, nearTail10BuyBnb: 1.5, nearTail10BnbPerMin: 4, nearPre20BnbPerMin: 4, nearTail5BuyN: 5, nearTail5BuyBnb: 0.7, nearPre10GapSec: null, nearPre10Wallets: null })).arm,
], ['high', 'near_alive']);
// ⑥ burst 抬档：四腿联立判 low + sbw=burst → mid（burst_raised）
check('E2 burst 反锚：low 抬 mid', [judgeActLevel(D({ spanSec: 270, tickCount: 43, ticksPerMin: 9.5, throughputBnbPerMin: 0.43, buyMedianBnb: 0.025, maxGapSec: 47, idlePct: 27 }), { sbwBurst: true }).act, judgeActLevel(D({ spanSec: 270, tickCount: 43, ticksPerMin: 9.5, throughputBnbPerMin: 0.43, buyMedianBnb: 0.025, maxGapSec: 47, idlePct: 27 }), { sbwBurst: true }).arm], ['mid', 'burst_raised']);
// ⑥ burst 不抬 high 之上：high 保持
check('E3 burst 不影响 high', [judgeActLevel(D({ spanSec: 120, tickCount: 60, ticksPerMin: 30, buyMedianBnb: 0.1, throughputBnbPerMin: 6, maxDrawdownPct: 10, buyN: 35, sellN: 25, totalBuyBnb: 3, totalSellBnb: 2.5, nearSegBnbPerMin: 5, nearSegBuyBnb: 2.2, nearSegSellBnb: 1.5, nearSegBuyMedianBnb: 0.1, nearTail10BnbPerMin: 5.3, nearPre20BnbPerMin: 6.1, nearTail5BuyN: 6, nearTail5BuyBnb: 0.6, nearTail10SellWallets: 3, nearTail10BuyN: 4, nearTail10BuyBnb: 0.5, nearPre10GapSec: 1, nearPre10Wallets: 6, actWeightedThroughputBnbPerMin: 4.5 }), { sbwBurst: true }).act], ['high']);
// D3.73 时间结构：近段 1.86、加权 1.02（<×0.6）→ 非 burst cap mid
check('E4 时间结构单点脉冲 → high 压 mid', [judgeActLevel(D({ spanSec: 120, tickCount: 60, ticksPerMin: 30, buyMedianBnb: 0.1, throughputBnbPerMin: 3, maxDrawdownPct: 10, buyN: 35, sellN: 25, totalBuyBnb: 3, totalSellBnb: 2.5, nearSegBnbPerMin: 2.2, nearSegBuyBnb: 0.9, nearSegSellBnb: 0.5, nearSegBuyMedianBnb: 0.1, nearTail10BnbPerMin: 2.1, nearPre20BnbPerMin: 2.0, nearTail5BuyN: 3, nearTail5BuyBnb: 0.3, nearTail10SellWallets: 2, nearTail10BuyN: 3, nearTail10BuyBnb: 0.3, nearPre10GapSec: 1, nearPre10Wallets: 6, actWeightedThroughputBnbPerMin: 1.02 })).arm], ['time_structure']);
// burst 时 D3.73 不 cap（集中流量事件）
check('E5 burst 时时间结构不 cap high', [judgeActLevel(D({ spanSec: 120, tickCount: 60, ticksPerMin: 30, buyMedianBnb: 0.1, throughputBnbPerMin: 3, maxDrawdownPct: 10, buyN: 35, sellN: 25, totalBuyBnb: 3, totalSellBnb: 2.5, nearSegBnbPerMin: 2.2, nearSegBuyBnb: 0.9, nearSegSellBnb: 0.5, nearSegBuyMedianBnb: 0.1, nearTail10BnbPerMin: 2.1, nearPre20BnbPerMin: 2.0, nearTail5BuyN: 3, nearTail5BuyBnb: 0.3, nearTail10SellWallets: 2, nearTail10BuyN: 3, nearTail10BuyBnb: 0.3, nearPre10GapSec: 1, nearPre10Wallets: 6, actWeightedThroughputBnbPerMin: 1.02 }), { sbwBurst: true }).act], ['high']);

console.log('\nF. 锚缺席 fail-open（不成立方向）');
// 出货臂：卖方钱包锚缺失 → 不判
check('F1 尾窗锚缺席 → 不落出货臂（走全窗综合）', judgeActLevel(D({ nearTail10SellWallets: null, nearTail10BuyN: null, nearTail10BuyBnb: null, nearTail10BnbPerMin: null, nearPre20BnbPerMin: null, nearTail5BuyN: null, nearTail5BuyBnb: null, nearSegBnbPerMin: 3, nearSegBuyBnb: 0.8, nearSegSellBnb: 0.5, nearSegBuyMedianBnb: 0.08, nearTail5TickN: null, nearPre10GapSec: null, nearPre10Wallets: null, actWeightedThroughputBnbPerMin: 2.5 })).act, 'mid');
// 段前背景反锚两键 null（极早窗）→ 反锚不适用照走密集臂
check('F2 段前两键 null → 反锚不适用照走密集臂', [judgeActLevel(D({ nearPre10GapSec: null, nearPre10Wallets: null, nearSegBnbPerMin: 5, nearSegBuyBnb: 2.2, nearSegSellBnb: 1.5, nearSegBuyMedianBnb: 0.1, nearTail10BnbPerMin: 5.3, nearPre20BnbPerMin: 6.1, nearTail5BuyN: 6, nearTail5BuyBnb: 0.6, nearTail10SellWallets: 3, nearTail10BuyN: 4, nearTail10BuyBnb: 0.5, actWeightedThroughputBnbPerMin: 5 })).act], ['high']);

console.log('\nG. sbw 因子判定（CD422 波绑定 + CD398 流向）');
const BURST_KEYS = { burstLastGapSec: 60, burstExitWaveBuyBnb: 0.5, burstExitWaveWallets: 4, burstWaveNetBnb: 0.3, burstWaveWalletNetBnb: 0.2 };
check('G1 停滞+买入波+流向正 → burst', judgeStallBurstWave(BURST_KEYS), 'burst');
check('G2 无 ≥30s 静默段 → none', judgeStallBurstWave({ burstLastGapSec: null }), 'none');
check('G3 波钱包 1（孤笔不成波 CD422）→ none', judgeStallBurstWave({ ...BURST_KEYS, burstExitWaveWallets: 1 }), 'none');
check('G4 波净流负（卖方主导 CD398）→ none', judgeStallBurstWave({ ...BURST_KEYS, burstWaveNetBnb: -0.1 }), 'none');
check('G5 波钱包全窗净额负 → none', judgeStallBurstWave({ ...BURST_KEYS, burstWaveWalletNetBnb: -0.05 }), 'none');
check('G6 波买额 0 → none', judgeStallBurstWave({ ...BURST_KEYS, burstExitWaveBuyBnb: 0 }), 'none');
check('G7 净额锚缺席容缺照判 burst', judgeStallBurstWave({ ...BURST_KEYS, burstWaveNetBnb: null, burstWaveWalletNetBnb: null }), 'burst');

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
