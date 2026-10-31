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
const { mapCheatAnswers, VERDICT_COLUMN_MAP, SB_HOLD_PCT_MIN, EQ_HOLD_PCT_MIN } = require('../src/market-analysis/cheat-result-mapper');

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
// D3.1 持仓占比锚：ZERODAY 有 7 同块簇+0.2475×4 等额带+creator 净持仓+0.1>0 → 两锚必非空且
// 恒不等式分子⊆分母 → 0-100 值域（公式精确值锁定在 D 段合成夹具，此处锁真实事故现场值域）
ok(d.sameBlockHoldPct !== null && d.sameBlockHoldPct >= 0 && d.sameBlockHoldPct <= 100,
  `sameBlockHoldPct 非空且 0-100（实际 ${d.sameBlockHoldPct?.toFixed(1)}）`);
ok(d.equalBandHoldPct !== null && d.equalBandHoldPct >= 0 && d.equalBandHoldPct <= 100,
  `equalBandHoldPct 非空且 0-100（实际 ${d.equalBandHoldPct?.toFixed(1)}）`);
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
// D3.1 持仓占比锚公式精确值（本夹具手算）：正净持仓=尘组 3×0.0005+等额组 3×0.05+同块组
// (0.1+0.11+0.12)+0x3333 0.25，posTotal=0.7315；0x1111/0x2222 买=卖净 0 双剔（不进分母也不进
// 分子）；sbMembers=四合格块并集 12 钱包⊇全部正持仓者 → sbHold=100%；等额带仅 0.0500×3 带合格
// （0x1111/0x2222 同买 0.2 但带内仅 2 钱包<3 不合格）→ eqHold=0.15/0.7315=20.5%
ok(dRows.derived.sameBlockHoldPct.toFixed(1) === '100.0', `sameBlockHoldPct=100.0%（实际 ${dRows.derived.sameBlockHoldPct}——零净持仓钱包双剔=分子⊆分母）`);
ok(dRows.derived.equalBandHoldPct.toFixed(1) === '20.5', `equalBandHoldPct=20.5%（实际 ${dRows.derived.equalBandHoldPct}——0.2×2 带不足 3 钱包不冒充）`);
// 近等额带捕获：0.3300/0.3298/0.3302 刻意抖金额逃精确分组 → 同一 ±2% 对数带（equalClusters
// 四位精确口径为空=旧门漏检形状，band 口径 9.0% 抓到）；跨块买入无同块簇 → sbHold=null
{
  const nearRows = [];
  const nearWallets = ['0x4444000000000000000000000000000000000044', '0x4545000000000000000000000000000000000045', '0x4646000000000000000000000000000000000046'];
  [0.33, 0.3298, 0.3302].forEach((amt, i) => {
    nearRows.push(mkRow(10 + i, 300 + i * 10, 0, 'buy', amt, 1e-9, { trader: nearWallets[i], sender: nearWallets[i] }));
  });
  nearRows.push(mkRow(50, 400, 0, 'buy', 10, 1e-9, { trader: '0x4747000000000000000000000000000000000047', sender: '0x4747000000000000000000000000000000000047' }));
  const nd = buildSnapshotFromRows(nearRows, microMeta).derived;
  ok(nd.equalClusters.length === 0 && nd.equalBandHoldPct.toFixed(1) === '9.0',
    `近等额带：equalClusters 空（精确口径漏）但 equalBandHoldPct=9.0%（实际 ${nd.equalBandHoldPct?.toFixed(1)}——±2% 带抓逃分组形状）`);
  ok(nd.sameBlockHoldPct === null, '跨块买入无合格同块簇 → sameBlockHoldPct=null（有证据的缺席）');
}

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
// D3.1：routerPct 行退役（2026-10-31 用户裁定：作弊钱包同样走路由，无判别价值）；
// 两持仓占比锚行进场；top1 集中度标注降为「仅健康参考」
ok(!st.state.includes('路由行买入'), 'routerPct 行已删（裁定：走路由无判别价值）');
ok(st.state.includes('同块簇持仓占比:') && st.state.includes('近等额簇持仓占比:'), 'PRECOMPUTED 含两持仓占比锚行（D3.1）');
ok(st.state.includes('仅作盘面健康参考，不作作弊判据'), 'top1 集中度标注「仅健康参考不作判据」');
ok(st.state.includes('分子=成员正净持仓合计，分母=全场正净持仓合计'), '锚口径注释在场（分子⊆分母）');
ok(microStateDisplay.state.includes('同块簇持仓占比: 无合格簇') && microStateDisplay.state.includes('近等额簇持仓占比: 无合格簇'),
  '无合格簇渲染「无合格簇」（null 不冒充 0）');
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

// ═══════════════ F. mapper（D3.1 现象锚+持仓占比锚综合规则） ═══════════════
console.log('F. mapper 综合规则（D3.1 四现象 + 持仓占比锚 → verdict 导出）');
const LVL = ['none', 'weak', 'moderate', 'strong'];
function phAns(bucket, p = 0.6) {
  const rest = (1 - p) / 3;
  return { type: 'choice', choice: bucket, probabilities: Object.fromEntries(LVL.map((b) => [b, b === bucket ? p : rest])) };
}
const PH_BASE = { equal_amount_split: 'none', coordinated_sell_back: 'none', creator_front_run: 'none', sell_dispersion: 'none' };
function mkAnswers(over = {}) {
  return Object.fromEntries(Object.entries({ ...PH_BASE, ...over }).map(([k, v]) => [k, phAns(v)]));
}

// A1 臂：协同卖回闭环 ≥strong（moderate 倒挂降级进 A4 联判——D3.0 实测 moderate 健康 10>cheat 10）
const m1 = mapCheatAnswers(mkAnswers({ coordinated_sell_back: 'strong' }));
ok(m1.verdict === 'cheat' && m1.ruleAudit.hitArm === 'A1', 'A1 卖回配对 ≥strong → cheat');
ok(m1.patternType === 'wash_pump' && m1.cheatProb === 0.6, 'A1 pattern=wash_pump（等额<moderate）；cheatProb=主现象 argmax 概率');
const m1b = mapCheatAnswers(mkAnswers({ coordinated_sell_back: 'strong', equal_amount_split: 'moderate' }));
ok(m1b.patternType === 'equal_amount_split', 'A1 等额指纹 ≥moderate → pattern=equal_amount_split');
const m1c = mapCheatAnswers(mkAnswers({ coordinated_sell_back: 'moderate', sell_dispersion: 'none' }));
ok(m1c.verdict === 'cheat' && m1c.ruleAudit.hitArm === 'A4' && m1c.patternType === 'wash_pump',
  'A4 卖回 moderate ∧ sd=none → cheat+wash_pump（无分散反证才坐实）');
ok(mapCheatAnswers(mkAnswers({ coordinated_sell_back: 'moderate', sell_dispersion: 'weak' })).verdict !== 'cheat',
  '卖回 moderate 但 sd=weak → 不坐实（早期获利盘常态形状）');
ok(mapCheatAnswers(mkAnswers({ coordinated_sell_back: 'weak' })).verdict !== 'cheat', '卖回仅 weak → 不命中（买了拿着≠签名）');

// A2 臂：creator 抢跑须 strong 才坐实（moderate=分批部分卖常态，D3.0 校准信号④）
const m2 = mapCheatAnswers(mkAnswers({ creator_front_run: 'strong' }));
ok(m2.verdict === 'cheat' && m2.patternType === 'dev_self_trade' && m2.ruleAudit.hitArm === 'A2', 'A2 creator=strong → cheat+dev_self_trade');
ok(mapCheatAnswers(mkAnswers({ creator_front_run: 'moderate' })).verdict !== 'cheat', 'creator=moderate（分批部分卖）→ 不坐实');

// A3 臂：等额强规整（strong 10:0:0 零误报；moderate 整数额聚带常态不单独坐实）
const m3 = mapCheatAnswers(mkAnswers({ equal_amount_split: 'strong' }));
ok(m3.verdict === 'cheat' && m3.patternType === 'equal_amount_split' && m3.ruleAudit.hitArm === 'A3', 'A3 等额=strong → cheat');
ok(mapCheatAnswers(mkAnswers({ equal_amount_split: 'moderate' })).verdict !== 'cheat', '等额=moderate 单独不坐实');

// A5 臂：持仓占比锚（代码数值门——累积期作弊：买簇持有主导份额、卖面干净）
const m5a = mapCheatAnswers(mkAnswers(), { sameBlockHoldPct: SB_HOLD_PCT_MIN + 5, equalBandHoldPct: null });
ok(m5a.verdict === 'cheat' && m5a.ruleAudit.hitArm === 'A5' && m5a.patternType === 'slow_coordinated_accumulation',
  'A5 sbHold 过线 → cheat+slow_coordinated_accumulation');
ok(Math.abs(m5a.cheatProb - (SB_HOLD_PCT_MIN + 5) / 100) < 1e-9, 'A5 cheatProb=主导锚占比/100');
ok(mapCheatAnswers(mkAnswers(), { sameBlockHoldPct: null, equalBandHoldPct: EQ_HOLD_PCT_MIN + 1 }).ruleAudit.hitArm === 'A5',
  'A5 eqHold 单腿过线也命中（OR）');
ok(mapCheatAnswers(mkAnswers(), { sameBlockHoldPct: SB_HOLD_PCT_MIN - 10, equalBandHoldPct: EQ_HOLD_PCT_MIN - 10 }).verdict !== 'cheat',
  '双锚均不过线 → 不命中');
ok(mapCheatAnswers(mkAnswers(), { sameBlockHoldPct: null, equalBandHoldPct: null }).verdict === 'unhealthy',
  '锚全 null（无合格簇）→ A5 不评（有证据的缺席≠作弊）');
ok(mapCheatAnswers(mkAnswers(), { sameBlockHoldPct: '88' }).verdict !== 'cheat', '锚形状异常（字符串）→ 按缺席算不冒充');

// B1 健康臂：卖出分散 ≥moderate（healthy 69% vs cheat 22% 最佳单一信号）
const m6 = mapCheatAnswers(mkAnswers({ sell_dispersion: 'moderate' }));
ok(m6.verdict === 'healthy' && m6.ruleAudit.hitArm === 'B1' && m6.patternType === null && m6.cheatProb === null,
  'B1 sd=moderate → healthy；非 cheat pattern/cheatProb 恒 null');
ok(mapCheatAnswers(mkAnswers({ sell_dispersion: 'weak' })).verdict === 'unhealthy', 'sd=weak → unhealthy 兜底');
const m6b = mapCheatAnswers(mkAnswers());
ok(m6b.verdict === 'unhealthy' && m6b.ruleAudit.hitArm === 'fallback_unhealthy', '全 none → unhealthy 兜底（非 unclear）');
ok(VERDICT_COLUMN_MAP.unclear_insufficient === 'unclear' && VERDICT_COLUMN_MAP.cheat === 'cheat'
  && VERDICT_COLUMN_MAP.unhealthy === 'unhealthy' && VERDICT_COLUMN_MAP.healthy === 'healthy',
  '映射表四桶显式钉死（DDL CHECK 域对齐）');

// 优先序与防线
const m7 = mapCheatAnswers(mkAnswers({ coordinated_sell_back: 'strong', creator_front_run: 'strong', sell_dispersion: 'strong' }),
  { sameBlockHoldPct: 99, equalBandHoldPct: 99 });
ok(m7.ruleAudit.hitArm === 'A1' && m7.patternType === 'wash_pump', 'A1 优先于 A2/A5/B1（闭环签名最强）；sd=strong 不解除 cheat');
const m8 = mapCheatAnswers(mkAnswers({ coordinated_sell_back: 'strong' }));
ok(m8.ruleAudit.levels.coordinated_sell_back === 'strong' && Object.keys(m8.ruleAudit.levels).length === 4,
  'ruleAudit 落全 4 现象档位快照（归因/重放审计）');
ok(mapCheatAnswers(mkAnswers()).ruleAudit.anchors.sameBlockHoldPct === null
  && mapCheatAnswers(mkAnswers(), { sameBlockHoldPct: 61.25 }).ruleAudit.anchors.sameBlockHoldPct === 61.25,
  'ruleAudit.anchors 回显输入锚（未传=null）');
// D3.0 存档兼容：answers 带已退役题（sb/quota/strong_hand/second_wave/retail）→ 不 throw、
// 退役题答案被忽略（重放工具对旧存档跑现行规则的兼容前提）
const m9 = mapCheatAnswers({
  ...mkAnswers(),
  same_block_buy_burst: phAns('strong'),
  quota_ladder_heat: phAns('moderate'),
  strong_hand_real_buy: phAns('weak'),
  second_wave_absorption: phAns('moderate'),
  retail_participation: { type: 'score', score: 2 },
});
ok(m9.verdict === 'unhealthy', 'D3.0 存档 answers（含退役题）经现行 mapper 不 throw、退役题不消费');
let threw = false;
try { mapCheatAnswers({}); } catch (_) { threw = true; }
ok(threw, '现象题缺失 → throw（调用方落 error 行）');
threw = false;
try {
  mapCheatAnswers({ ...mkAnswers(), sell_dispersion: { type: 'choice', probabilities: { extreme: 1 } } });
} catch (_) { threw = true; }
ok(threw, '未知档位桶名 → throw（题集/映射漂移防线）');

// ═══════════════ G. 活跃度锚（D3.2 综合三因子四档 + 不均衡 CV，用户裁定） ═══════════════
console.log('G. 活跃度锚四档/三因子/不均衡 CV');
{
  const {
    ACTIVITY_LOW_TPM, ACTIVITY_HIGH_TPM, ACTIVITY_ULTRA_TPM,
    ACTIVITY_DUST_AVG_BNB, ACTIVITY_LONG_GAP_SEC, ACTIVITY_UNEVEN_CV,
  } = require('../src/market-analysis/cheat-snapshot.js');
  ok(ACTIVITY_LOW_TPM === 15 && ACTIVITY_HIGH_TPM === 70 && ACTIVITY_ULTRA_TPM === 140, '密度切点 15/70/140 挂常量（调档单点）');
  ok(ACTIVITY_DUST_AVG_BNB === 0.05 && ACTIVITY_LONG_GAP_SEC === 120 && ACTIVITY_UNEVEN_CV === 1.0, '尘笔均 0.05/长空窗 120s/不均衡 CV 1.0 挂常量');

  let gblk = 900, glog = 0;
  const mkAct = (sec, bnb) => mkRow(sec, gblk++, glog++, 'buy', bnb, 1e-9);
  // sec 全整数（dt=Math.round 整秒口径）：perSec=每秒 k 笔×nSec 秒（同秒多笔=机器节奏）；spaced=均匀步长
  const perSec = (nSec, k, bnb) => Array.from({ length: nSec * k }, (_, i) => mkAct(Math.floor(i / k), bnb));
  const spaced = (n, step, bnb) => Array.from({ length: n }, (_, i) => mkAct(i * step, bnb));

  // G1 ultra：每秒 3 笔×10s=30 笔、span 9s → tpm=30/9×60=200 ≥140 → ultra；桶数 1 → CV 不可评
  const g1 = buildSnapshotFromRows(perSec(10, 3, 0.2), microMeta).derived;
  ok(g1.ticksPerMin === 200 && g1.activityLevel === 'ultra', `ultra：tpm=200（实际 ${g1.ticksPerMin}/${g1.activityLevel}）`);
  ok(g1.activityCv === null && g1.activityUneven === null, 'span 9s <3 桶 → 不均衡不可评 null');

  // G2 high：每秒 2 笔×45s=90 笔、span 44s → tpm=90/44×60=122.73 → high（[70,140) 档）
  const g2 = buildSnapshotFromRows(perSec(45, 2, 0.15), microMeta).derived;
  ok(g2.ticksPerMin === 122.73 && g2.activityLevel === 'high', `high：tpm=122.73（实际 ${g2.ticksPerMin}/${g2.activityLevel}）`);

  // G3 mid：20 笔 3s 步长、span 57s → tpm=21.05 → mid（密度 15-70 带、非尘、无长空窗）
  const g3 = buildSnapshotFromRows(spaced(20, 3, 0.3), microMeta).derived;
  ok(g3.ticksPerMin === 21.05 && g3.activityLevel === 'mid', `mid：tpm=21.05（实际 ${g3.ticksPerMin}/${g3.activityLevel}）`);

  // G4 low 三因子独立触发（任一即压低档，低档判定优先于 ultra/high）：
  // a) 长空窗：61 笔秒级 + 1 笔 t+190s——span 190、tpm=19.58（mid 密度）笔均 0.2（非尘）
  //    但 maxGap=190-60=130s ≥120 → low
  const g4a = buildSnapshotFromRows([...perSec(61, 1, 0.2), mkAct(190, 0.2)], microMeta).derived;
  ok(g4a.ticksPerMin === 19.58 && g4a.maxGapSec === 130 && g4a.activityLevel === 'low',
    `low·长空窗：tpm=19.58 mid 密度被 maxGap=130s 独立压低档（实际 ${g4a.ticksPerMin}/${g4a.maxGapSec}/${g4a.activityLevel}）`);
  // b) 尘笔均：40 笔 3s 步长、span 117s → tpm=20.51（mid 密度）但笔均 0.03<0.05 → low
  const g4b = buildSnapshotFromRows(spaced(40, 3, 0.03), microMeta).derived;
  ok(g4b.ticksPerMin === 20.51 && g4b.avgTradeBnb === 0.03 && g4b.activityLevel === 'low',
    `low·尘笔均：tpm=20.51 但笔均 0.03<0.05（实际 ${g4b.ticksPerMin}/${g4b.avgTradeBnb}/${g4b.activityLevel}）`);
  // c) 低密度：10 笔 10s 步长、span 90s → tpm=6.67<15 → low（笔均 0.3 非尘、gap 10s 非长空窗）
  const g4c = buildSnapshotFromRows(spaced(10, 10, 0.3), microMeta).derived;
  ok(g4c.ticksPerMin === 6.67 && g4c.activityLevel === 'low', `low·低密度：tpm=6.67（实际 ${g4c.ticksPerMin}/${g4c.activityLevel}）`);

  // G5 不均衡：30 笔秒级 burst（t+0..29s）+ 1 笔 t+120s——span 120、tpm=31/120×60=15.5（mid）
  //    桶 [30,0,0,1]、mean=7.75、std=√165.1875≈12.8525 → cv=1.66 ≥1 → 起伏大
  const g5snap = buildSnapshotFromRows([...perSec(30, 1, 0.2), mkAct(120, 0.2)], microMeta);
  const g5 = g5snap.derived;
  ok(g5.activityLevel === 'mid', `burst+断流但密度线以上：mid（实际 ${g5.activityLevel}——tpm=${g5.ticksPerMin}）`);
  ok(g5.activityCv === 1.66 && g5.activityUneven === true, `不均衡：cv=1.66 起伏大（实际 ${g5.activityCv}/${g5.activityUneven}）`);
  ok(buildCheatState(g5snap).state.includes('活跃度: 中') && buildCheatState(g5snap).state.includes('高低起伏很大'), 'state 渲染：档位中文+不均衡注记在场');

  // G6 均匀对照：16 笔 8s 步长均布 120s（每桶恰 4 笔）→ cv=0 非不均衡（tpm=8 同时落 low 顺带验证）
  const g6 = buildSnapshotFromRows(spaced(16, 8, 0.3), microMeta).derived;
  ok(g6.activityCv === 0 && g6.activityUneven === false, `均匀对照：cv=0 非不均衡（实际 ${g6.activityCv}/${g6.activityUneven}）`);
  ok(g6.activityLevel === 'low' && g6.ticksPerMin === 8, `均匀但低密：tpm=8 → low（实际 ${g6.ticksPerMin}/${g6.activityLevel}）`);

  // G7 dt 全缺失（block_time 无效）→ 活跃度全族 null（不可评绝不冒充）+ state 渲染降级
  const g7rows = spaced(10, 1, 0.2).map((r) => ({ ...r, block_time: 'garbage' }));
  const g7snap = buildSnapshotFromRows(g7rows, { ...microMeta, createdAt: 'garbage' });
  const g7 = g7snap.derived;
  ok(g7.ticksPerMin === null && g7.avgTradeBnb === null && g7.maxGapSec === null && g7.activityLevel === null
    && g7.activityCv === null && g7.activityUneven === null, '时间戳全无效 → 活跃度族全 null');
  ok(buildCheatState(g7snap).state.includes('活跃度: 不可评'), 'state 渲染：不可评降级行');

  // G8 micro fixture（router/outlier 主 fixture）无回归：dt 齐 → 活跃度有值不影响既有键
  ok(md.activityLevel === 'low' && md.ticksPerMin === 10.5, `micro fixture：7 笔 40s tpm=10.5 → low（实际 ${md.ticksPerMin}/${md.activityLevel}）`);
}


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
