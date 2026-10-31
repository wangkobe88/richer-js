#!/usr/bin/env node
/**
 * 作弊盘检测纯函数单测（CD1）——零 DB 零网络
 *
 * 覆盖：cheat-snapshot（buildSnapshotFromRows/computeDerived/aggregateWallets）
 * + cheat-state-builder（buildCheatState）+ cheat-result-mapper（mapCheatAnswers）。
 *
 * 事故现场锁定：ZERODAY 0x23f1…7777（CD1 立案票）真实 66 笔 tick fixture——
 * derived 全键精确值对拍 2026-10-30 人工分析结论（27 钱包/top1 7.45%/快进快出
 * 20/同块簇 7 个/0.2475×4 等额簇/dev t+0s 买 t+6s 卖抢跑）。
 *
 * 合成微夹具补真实数据覆盖不到的分支：router 伪钱包剔除/unresolved 证据洞/
 * outlier 双口径/尘额等额簇不入桶/churn 60s 边界/dt 基准退化/截断与硬帽。
 * 断言失败 exit 非零（项目纪律：改到哪块跑哪块）。
 */

const assert = require('assert');
const path = require('path');
const {
  buildSnapshotFromRows, computeDerived, aggregateWallets, walletOf, isRouterWallet,
} = require('../src/market-analysis/cheat-snapshot');
const { buildCheatState, MAX_STATE_CHARS } = require('../src/market-analysis/cheat-state-builder');
const { mapCheatAnswers, VERDICT_COLUMN_MAP } = require('../src/market-analysis/cheat-result-mapper');

const ROUTER = '0x1de460f363af910f51726def188f9004276bf4bc'; // GMGN 聚合路由（AGGREGATOR_ROUTER_ADDRS）
let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`\n❌ FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ✓ ${label}`);
}

// ═══════════════ A. ZERODAY 真实 66-tick 事故现场（derived 全键精确值） ═══════════════
console.log('A. ZERODAY 真实 fixture 锁定');
const fx = require(path.join(__dirname, 'cheat-detection/fixtures/zeroday-66.json'));
const snap = buildSnapshotFromRows(fx.rows, fx.tokenMeta);
const d = snap.derived;

ok(snap.anchor.tickCount === 66, 'anchor.tickCount=66（单查询锚=行数）');
ok(snap.dtBase === 'created', 'dtBase=created（创建时刻基准）');
ok(d.buyN === 36 && d.sellN === 30, `买卖笔数 36/30（实际 ${d.buyN}/${d.sellN}）`);
ok(d.totalBuyBnb.toFixed(4) === '7.6439', `totalBuyBnb=7.6439（实际 ${d.totalBuyBnb.toFixed(4)}）`);
ok(d.totalSellBnb.toFixed(4) === '7.1103', `totalSellBnb=7.1103（实际 ${d.totalSellBnb.toFixed(4)}）`);
ok(d.walletCount === 27, `walletCount=27（实际 ${d.walletCount}——含 router 伪钱包剔除）`);
ok(d.top1BuyPct.toFixed(2) === '7.45', `top1BuyPct=7.45%（实际 ${d.top1BuyPct.toFixed(2)}——分仓绕门核心证据）`);
ok(d.top2BuyPct.toFixed(2) === '14.89', `top2BuyPct=14.89%（实际 ${d.top2BuyPct.toFixed(2)}）`);
ok(d.routerPct.toFixed(2) === '22.02' && d.routerBuyN === 7, `routerPct=22.02% ×7 笔（实际 ${d.routerPct.toFixed(2)}/${d.routerBuyN}）`);
ok(d.unresolvedSenderTickCount === 0, 'unresolvedSenderTickCount=0（本窗 sender 全解析）');
ok(d.churn60sWalletCount === 20, `churn60s=20/27 钱包（实际 ${d.churn60sWalletCount}——74% 快进快出）`);
ok(d.sameBlockClusters.length === 7, `同块簇=7 个（实际 ${d.sameBlockClusters.length}）`);
ok(d.sameBlockClusters.every((c) => c.n === 3 && c.wallets === 3), '同块簇全为 3 笔 3 钱包（同步节奏）');
ok(d.sameBlockClusters.some((c) => c.block === 130554077 && c.sumBnb.toFixed(2) === '0.99'), '同块簇含 blk 130554077 Σ0.99');
ok(d.equalClusters.length === 1 && d.equalClusters[0].amt === 0.2475
  && d.equalClusters[0].n === 4 && d.equalClusters[0].wallets === 4, '等额簇恰一个：0.2475×4 笔 4 钱包');
ok(d.priceArc.first.toExponential(3) === '6.467e-9', `priceArc.first=6.467e-9（实际 ${d.priceArc.first.toExponential(3)}）`);
ok(d.priceArc.ath.toExponential(3) === '1.835e-8' && d.priceArc.athDt === 70, `ATH=1.835e-8 @t+70s`);
ok(d.priceArc.last.toExponential(3) === '5.980e-9', `末价=5.98e-9（较 ATH -67% 拱形坍塌）`);
const creator = snap.wallets.find((w) => w.isCreator);
ok(!!creator, 'creator 钱包在列（isCreator 标记）');
ok(creator.w === fx.tokenMeta.creatorAddress, 'creator 地址匹配');
ok(creator.firstBuyDt === 0 && creator.firstSellDt === 6 && creator.buyBnb === 0.5
  && creator.sellBnb.toFixed(1) === '0.4',
  `dev 抢跑现场：t+0s 买 0.5 → t+6s 卖 0.4（税后净额；实际 ${creator.firstBuyDt}/${creator.firstSellDt}s）`);
ok(snap.wallets[0].buyBnb >= creator.buyBnb, 'wallets 按买入额降序');

// ═══════════════ B. as-of 截窗 + 到达序无关 ═══════════════
console.log('B. as-of 截窗与乱序重排');
const snap40 = buildSnapshotFromRows(fx.rows.slice(0, 40), fx.tokenMeta);
ok(snap40.anchor.tickCount === 40, '锚=截窗行数 40（as-of 切片防马后炮）');
ok(snap40.derived.walletCount < 27 && snap40.derived.churn60sWalletCount < 20,
  `截窗后派生值变小（wallet ${snap40.derived.walletCount}/churn ${snap40.derived.churn60sWalletCount}）`);
const shuffled = [...fx.rows];
for (let i = shuffled.length - 1; i > 0; i--) { const j = (i * 7 + 13) % (i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
const snapShuffled = buildSnapshotFromRows(shuffled, fx.tokenMeta);
ok(JSON.stringify(snapShuffled.derived) === JSON.stringify(d), '乱序输入=同 derived（链上真序重排收敛）');
ok(snapShuffled.ticks.every((t, i) => t.i === i), 'tick 序号重排后连续');

// ═══════════════ C. 合成微夹具：router 伪钱包/outlier 双口径/证据洞 ═══════════════
console.log('C. router 伪钱包与 outlier 双口径');
const C0 = new Date('2026-10-30T00:00:00Z').getTime();
const at = (sec) => new Date(C0 + sec * 1000).toISOString();
function mkRow(sec, block, log, type, bnb, price, opts = {}) {
  return {
    block_time: at(sec), block_number: block, log_index: log, trade_type: type,
    bnb_amount: bnb, price_bnb: price, price_outlier: opts.outlier === true,
    trader_address: opts.trader || '0xaaaa000000000000000000000000000000000001',
    sender_address: opts.sender === undefined ? '0xaaaa000000000000000000000000000000000001' : opts.sender,
    quote_token: null,
  };
}
const wB = '0xbbbb000000000000000000000000000000000002';
const wC = '0xcccc000000000000000000000000000000000003';
const microRows = [
  // 3 笔 GMGN 路由行 sender 未解析（trader=router）：资金照计、router 伪钱包不入 wallets
  mkRow(10, 100, 1, 'buy', 0.2, 1e-9, { trader: ROUTER, sender: null }),
  mkRow(12, 101, 1, 'buy', 0.2, 1e-9, { trader: ROUTER, sender: null }),
  mkRow(14, 102, 1, 'buy', 0.2, 1.2e-9, { trader: ROUTER, sender: null }),
  // 1 笔 GMGN 路由行 sender 已解析：真钱包入列、viaRouter 标记
  mkRow(20, 103, 1, 'buy', 0.3, 1.1e-9, { trader: ROUTER, sender: wB }),
  // 默认钱包 0xaaaa…1：0.5 买 + outlier 天价卖（资金照计，ATH 不被 outlier 打飞）+ 0.1 买
  mkRow(30, 104, 1, 'buy', 0.5, 1.5e-9),
  mkRow(40, 105, 1, 'sell', 0.1, 9.9e-7, { outlier: true }),
  // 可靠价 ATH
  mkRow(50, 106, 1, 'buy', 0.1, 2.0e-9),
];
const microMeta = { address: '0xdead', symbol: 'T', name: 'T', platform: 'flap', quoteToken: null, createdAt: at(0), creatorAddress: null };
const ms = buildSnapshotFromRows(microRows, microMeta);
const md = ms.derived;
ok(md.unresolvedSenderTickCount === 3, `unresolved=3（实际 ${md.unresolvedSenderTickCount}）`);
ok(md.walletCount === 2, `walletCount=2（router 伪钱包剔除后=wB+0xaaaa；实际 ${md.walletCount}）`);
ok(md.buyN === 6 && md.totalBuyBnb.toFixed(2) === '1.50', `router 行资金照计：6 笔 1.50 BNB（实际 ${md.buyN}/${md.totalBuyBnb.toFixed(2)}）`);
ok(md.routerPct.toFixed(2) === '60.00' && md.routerBuyN === 4, `routerPct=0.9/1.50=60.00% ×4（实际 ${md.routerPct.toFixed(2)}/${md.routerBuyN}）`);
ok(md.top1BuyPct.toFixed(2) === '40.00', `top1=0xaaaa 0.6/1.50=40.00%（实际 ${md.top1BuyPct.toFixed(2)}——分母含 router 行）`);
ok(ms.ticks[3].viaRouter === true && ms.ticks[3].wallet === wB, 'sender 已解析的 router 行=真钱包+viaRouter');
ok(md.priceArc.ath === 2.0e-9, `ATH=2.0e-9 可靠价（实际 ${md.priceArc.ath}——outlier 9.9e-7 未打飞）`);
ok(md.totalSellBnb.toFixed(2) === '0.10', 'outlier 卖行资金照计 0.10');
const resolvedRouterAgg = aggregateWallets([{ i: 0, dt: 0, side: 'BUY', bnb: 1, priceBnb: null, wallet: ROUTER, block: 1, viaRouter: true, outlier: false, senderMissing: true }], microMeta);
ok(resolvedRouterAgg.length === 0, 'aggregateWallets 直接收 router 伪钱包行=空（口径单点）');

// ═══════════════ D. 等额簇尘门 / 同块簇 / churn 边界 / dt 退化 ═══════════════
console.log('D. 等额簇尘门与 churn 边界');
const churnRows = [];
let blk = 200, log = 0;
const push = (sec, type, bnb, wallet, price = 1e-9) => {
  churnRows.push(mkRow(sec, blk, log++, type, bnb, price, { trader: wallet, sender: wallet }));
};
// 尘额 0.0005×3（< 0.001 尘门）不入等额簇
for (let i = 0; i < 3; i++) push(60 + i, 'buy', 0.0005, `0x${(0xd000 + i).toString(16)}`.padEnd(42, '0'));
blk += 10;
// 等额 0.0500×3 入桶（异块）
for (let i = 0; i < 3; i++) push(70 + i, 'buy', 0.05, `0x${(0xe000 + i).toString(16)}`.padEnd(42, '0'));
// 同块 3 笔买
blk += 10;
for (let i = 0; i < 3; i++) push(80, 'buy', 0.1 + i * 0.01, `0x${(0xf000 + i).toString(16)}`.padEnd(42, '0'));
blk += 10;
// churn 边界：59s 进 / 60s 不进 / 无卖不进
push(90, 'buy', 0.2, '0x1111000000000000000000000000000000000011'); push(149, 'sell', 0.2, '0x1111000000000000000000000000000000000011'); // 59s
push(91, 'buy', 0.2, '0x2222000000000000000000000000000000000022'); push(151, 'sell', 0.2, '0x2222000000000000000000000000000000000022'); // 60s
push(92, 'buy', 0.25, '0x3333000000000000000000000000000000000033'); // 只买不卖（0.25≠0.2 防撞等额簇）
const dRows = buildSnapshotFromRows(churnRows, { ...microMeta, createdAt: null });
ok(dRows.dtBase === 'first_tick' && dRows.ticks[0].dt === 0, 'createdAt 缺失→dtBase=first_tick、首 tick dt=0');
ok(dRows.derived.equalClusters.length === 1 && dRows.derived.equalClusters[0].amt === 0.05
  && dRows.derived.equalClusters[0].n === 3, '等额簇只收 0.0500×3（0.0005 尘额×3 不入桶）');
ok(dRows.derived.sameBlockClusters.length === 4
  && dRows.derived.sameBlockClusters.some((c) => c.n === 3 && c.wallets === 3 && c.sumBnb.toFixed(2) === '0.33'),
  '同块簇无金额门：尘额/等额/目标/churn 组各成簇（Σ0.33 目标簇在列）');
ok(dRows.derived.churn60sWalletCount === 1, `churn 严格 <60s：59s 计 60s 不计（实际 ${dRows.derived.churn60sWalletCount}）`);

// ═══════════════ E. state builder ═══════════════
console.log('E. state builder');
const st = buildCheatState(snap);
ok(st.state.includes('[TOKEN]') && st.state.includes('[ANCHOR]')
  && st.state.includes('[PRECOMPUTED]') && st.state.includes('[TICKS]')
  && st.state.includes('[WALLETS]') && st.state.includes('[判定指引]'), 'state 六段齐全');
ok(st.state.includes('截至第 66 笔 tick 的 as-of 切片'), 'ANCHOR 段刻锚 66');
ok(st.state.includes('t+0s BUY 0.500 @6.47e-9 w=0x8eda…482c blk=130554073 [CREATOR]'), 'tick 行含 dev 抢跑首行+CREATOR 标记');
ok(st.state.includes('买入 top1 钱包占比 7.4% / top2 合计 14.9%'), 'PRECOMPUTED 含 top1 7.4%/top2 14.9%（一位小数展示）');
ok(st.state.includes('快进快出钱包（首买→首卖 <60s）: 20 个'), 'PRECOMPUTED 含 churn 20');
ok(!st.state.includes('quote_token='), 'BNB 盘不出现 quote 注记');
ok(st.promptChars <= MAX_STATE_CHARS, `真实 66-tick state=${st.promptChars} chars 在预算内`);
const stMicro = buildCheatState(buildSnapshotFromRows(microRows, { ...microMeta, quoteToken: '0x5555' }));
ok(stMicro.state.includes('quote_token=0x5555') && stMicro.state.includes('下列 bnb 金额已在写入时换算为 BNB 域'), 'quote 盘注记在场（换算口径声明）');
const microStateDisplay = buildCheatState(ms);
ok(microStateDisplay.state.includes('w=UNRESOLVED*'), '未解析 router 行显示 UNRESOLVED*（发起人未知，不计入钱包）');
ok(microStateDisplay.state.includes('[OUTLIER]'), 'outlier 行标注 [OUTLIER]');
// D2.1 裁定反证：簇指纹不再预渲染、行级 [GMGN] 标记去除（ZERODAY 66-tick 有 7 同块簇+1 等额簇，旧版必现）
ok(!st.state.includes('同块买入簇') && !st.state.includes('等额买入簇'), '同块簇/等额簇不预渲染（Jev 自算——derived 仍算，仅 state 不列）');
ok(!/\[GMGN\]/.test(st.state), '行级 [GMGN] 标记去除（走路由≠真人，反噬）');
ok(st.state.includes('走路由本身不区分真人/自动化'), '聚合路由机制陈述在场（含「走路由≠真人」语义）');
// 截断：400 tick → 首 200+末 100
const manyRows = [];
for (let i = 0; i < 400; i++) {
  manyRows.push(mkRow(i, 1000 + Math.floor(i / 3), i % 3, i % 4 === 3 ? 'sell' : 'buy', 0.01, 1e-9,
    { trader: `0x${(0xa0000 + (i % 50)).toString(16)}`.padEnd(42, '0') }));
}
const stMany = buildCheatState(buildSnapshotFromRows(manyRows, microMeta));
const tickLines = stMany.state.split('\n').filter((l) => /^t\+\d+s (BUY|SELL)/.test(l));
ok(stMany.truncated.ticks === true && tickLines.length === 300, `400 tick 截断为 300 行展示（实际 ${tickLines.length}）`);
ok(stMany.state.includes('保留最早 200 笔 + 最近 100 笔'), '截断声明在场');
ok(stMany.state.includes('统计仍基于全窗口'), '截断不伤 PRECOMPUTED 声明在场');
// 硬帽：巨型 meta 撑爆 20k
const stHuge = buildCheatState(buildSnapshotFromRows(fx.rows, { ...fx.tokenMeta, name: 'X'.repeat(30000) }));
ok(stHuge.truncated.hardCap === true && stHuge.state.length <= MAX_STATE_CHARS + 200
  && stHuge.state.includes('尾部被硬截断'), `硬帽截断触发（${stHuge.state.length} chars）`);
// capped + 权威锚：满帽时行集=head+tail 多于锚值，锚绝不能从 rows.length 反推
{
  const capRows = fx.rows.slice(0, 10).concat(fx.rows.slice(-20)); // head10+tail20=30 行
  const snapCap = buildSnapshotFromRows(capRows, fx.tokenMeta);
  ok(snapCap.capped === false && snapCap.anchor.tickCount === 30, '缺省=未满帽：anchor=行数（向后兼容）');
  const snapCap2 = buildSnapshotFromRows(capRows, fx.tokenMeta, { capped: true, anchorTickCount: 20 });
  const stCap = buildCheatState(snapCap2);
  ok(snapCap2.capped === true && snapCap2.anchor.tickCount === 20 && snapCap2.ticks.length === 30,
    '权威锚由 options 传入：anchor=20≠行数 30（head 补充行不参与锚）');
  ok(stCap.state.includes('截至第 20 笔') && stCap.state.includes('超拉数帽') && !stCap.state.includes('截至第 30 笔'),
    '[ANCHOR] 刻权威锚+截断声明（不谎报行数）');
}

// ═══════════════ F. mapper ═══════════════
console.log('F. mapper 决断');
const answers1 = {
  market_health_verdict: { type: 'choice', choice: 'cheat', probabilities: { cheat: 0.72, unhealthy: 0.18, healthy: 0.06, unclear_insufficient: 0.04 } },
  cheat_pattern: { type: 'choice', choice: 'dev_self_trade', probabilities: { dev_self_trade: 0.55, same_block_burst: 0.2, equal_amount_split: 0.1, rapid_churn: 0.1, wash_pump: 0.03, none_apparent: 0.02 } },
  retail_participation: { type: 'score', score: 1.5 },
};
const m1 = mapCheatAnswers(answers1);
ok(m1.verdict === 'cheat' && m1.cheatProb === 0.72, 'cheat P≥0.5 → cheat 直落');
ok(m1.patternType === 'dev_self_trade', 'pattern P≥0.4 → 落列');
ok(m1.retailParticipation === 1.5, 'score 直落');
ok(m1.rankedVerdicts.runnerUpApplied === false, '非 runner-up 路径标记');
const m2 = mapCheatAnswers({
  ...answers1,
  market_health_verdict: { type: 'choice', probabilities: { cheat: 0.4, unhealthy: 0.35, healthy: 0.15, unclear_insufficient: 0.1 } },
});
ok(m2.verdict === 'unhealthy' && m2.rankedVerdicts.runnerUpApplied === true && m2.cheatProb === 0.4,
  'argmax=cheat 但 P<0.5 → runner-up 剔除重取（cheatProb 照记审计）');
ok(m2.patternType === null, '非 cheat verdict → pattern 恒 null');
const m3 = mapCheatAnswers({
  ...answers1,
  market_health_verdict: { type: 'choice', probabilities: { cheat: 0.05, unhealthy: 0.1, healthy: 0.15, unclear_insufficient: 0.7 } },
});
ok(m3.verdict === 'unclear', 'unclear_insufficient → 列值 unclear（桶名→列值映射表）');
ok(VERDICT_COLUMN_MAP.unclear_insufficient === 'unclear' && VERDICT_COLUMN_MAP.cheat === 'cheat'
  && VERDICT_COLUMN_MAP.unhealthy === 'unhealthy' && VERDICT_COLUMN_MAP.healthy === 'healthy',
  '映射表四桶显式钉死（DDL CHECK 域对齐）');
const m4 = mapCheatAnswers({
  ...answers1,
  cheat_pattern: { type: 'choice', probabilities: { dev_self_trade: 0.35, same_block_burst: 0.3, equal_amount_split: 0.15, rapid_churn: 0.1, wash_pump: 0.05, none_apparent: 0.05 } },
});
ok(m4.patternType === null, 'pattern argmax P<0.4 → null（细分主张门略松）');
const m5 = mapCheatAnswers({
  market_health_verdict: { type: 'choice', probabilities: { cheat: 0.8, unhealthy: 0.1, healthy: 0.05, unclear_insufficient: 0.05 } },
  cheat_pattern: { type: 'choice', probabilities: { dev_self_trade: 0.9 } },
  retail_participation: { type: 'score', score: null },
});
ok(m5.verdict === 'cheat' && m5.patternType === 'dev_self_trade' && m5.retailParticipation === null,
  'score 形状异常→null 不拦主判定');
let threw = false;
try { mapCheatAnswers({ cheat_pattern: answers1.cheat_pattern }); } catch (_) { threw = true; }
ok(threw, 'Q1 缺失 → throw（调用方落 error 行）');
threw = false;
try {
  mapCheatAnswers({ ...answers1, market_health_verdict: { probabilities: { weird_bucket: 1 } } });
} catch (_) { threw = true; }
ok(threw, '未知桶名 → throw（题集/映射表漂移防线）');

// ═══════════════ H. anchorCountAt（--experiment 基线锚，lib.mjs ESM 经动态 import） ═══════════════
(async () => {
  const { anchorCountAt } = await import(path.join(__dirname, 'cheat-detection/lib.mjs'));
  console.log('H. anchorCountAt 实验基线锚计算');
  const rows = [
    { block_time: '2026-10-29T15:00:02Z' },
    { block_time: '2026-10-29T15:00:05Z' },
    { block_time: '2026-10-29T15:00:09Z' },
  ];
  ok(anchorCountAt(rows, '2026-10-29T15:00:05Z') === 2, '锚时刻=第2行 block_time → 2（等号含边界）');
  ok(anchorCountAt(rows, '2026-10-29T15:00:04.999Z') === 1, '毫秒差邻界 → 1');
  ok(anchorCountAt(rows, new Date(Date.parse('2026-10-29T15:00:09Z')).toISOString()) === 3, 'Date.parse→toISOString 往返等价（runner 同款构造）');
  ok(anchorCountAt(rows, '2026-10-29T15:00:00Z') === 0, '全早于首行 → 0（数据洞=runner 跳过不冒充）');
  ok(anchorCountAt(rows, null) === 0 && anchorCountAt(rows, 'not-a-date') === 0, '锚时刻缺失/非法 → 0 fail-loud');
  ok(anchorCountAt([...rows, { block_time: null }, {}], '2026-10-29T15:00:09Z') === 3, '行 block_time 缺失/无效不计入');
  ok(anchorCountAt([], '2026-10-29T15:00:09Z') === 0, '空行集 → 0');

  console.log(`\n✅ _test_cheat_detection_lib 全过（${passed} 断言）`);
})().catch((e) => { console.error(`\n❌ ${e?.stack || e}`); process.exit(1); });
