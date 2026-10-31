#!/usr/bin/env node
/**
 * 作弊盘检测纯函数单测（CD1）——零 DB 零网络
 *
 * 覆盖：cheat-snapshot（buildSnapshotFromRows/computeDerived/aggregateWallets）
 * + cheat-state-builder（buildCheatState）+ cheat-result-mapper（buildObservation——
 * D3.5 判定层停产：观测记录=现象+档位+数值锚，无 verdict）。
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
const { buildObservation, PHENOMENON_IDS, EXT_PHENOMENON_IDS, ACTIVITY_LEVELS, BUNDLED_LEVELS, STALL_BURST_LEVELS } = require('../src/market-analysis/cheat-result-mapper');

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
// D3.5：代码活跃度档位行撤除（教学单一载体=题面 activity_level——「使用 Jev 进行判断」；
// derived 数值仍算供存档对照，state 不再预贴档位结论）
ok(!st.state.includes('活跃度: 低') && !st.state.includes('活跃度: 中') && !st.state.includes('活跃度: 高')
  && !st.state.includes('活跃度: 超高') && !st.state.includes('活跃度: 不可评'),
  'state 不再渲染代码活跃度档位行（D3.5 教学迁题面——档位判定交 Jev）');
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

// ═══════════════ F. mapper 观测组装（D3.5 判定层停产：现象+档位+锚，无 verdict） ═══════════════
console.log('F. mapper 观测组装（D3.5：buildObservation 现象+档位+数值锚）');
const LVL = ['none', 'weak', 'moderate', 'strong'];
function phAns(bucket, p = 0.6) {
  const rest = (1 - p) / 3;
  return { type: 'choice', choice: bucket, probabilities: Object.fromEntries(LVL.map((b) => [b, b === bucket ? p : rest])) };
}
const PH_BASE = { equal_amount_split: 'none', coordinated_sell_back: 'none', creator_front_run: 'none', sell_dispersion: 'none' };
function mkAnswers(over = {}) {
  return Object.fromEntries(Object.entries({ ...PH_BASE, ...over }).map(([k, v]) => [k, phAns(v)]));
}

// 基本形状：phenomena 四键 argmax 档位 + anchors 回显；无 verdict/cheatProb/patternType
// 键（D3.5 判定层停产反证——A1-A5/B1/兜底随 git 留档，观测记录不带任何分类结论）
const f1 = buildObservation(mkAnswers({ equal_amount_split: 'strong' }), { sameBlockHoldPct: 61.25, equalBandHoldPct: null });
ok(f1.phenomena.equal_amount_split === 'strong' && Object.keys(f1.phenomena).length === 4,
  'phenomena=4 现象键 argmax 档位');
ok(f1.anchors.sameBlockHoldPct === 61.25 && f1.anchors.equalBandHoldPct === null,
  'anchors 回显输入锚（未传键=null）');
ok(Object.keys(f1.anchors).length === 2, 'D3.5 后 anchors 只剩 sb/eq 两数值键（activity 档位不再投影）');
ok(!('verdict' in f1) && !('cheatProb' in f1) && !('patternType' in f1) && !('ruleAudit' in f1),
  '观测记录无 verdict/cheatProb/patternType/ruleAudit 键（判定层停产反证）');
const f1b = buildObservation(mkAnswers(), { sameBlockHoldPct: '88' });
ok(f1b.anchors.sameBlockHoldPct === null, '锚形状异常（字符串）→ 按缺席算不冒充');

// ext 观察题容缺（缺席→null 不 throw；在场落 extLevels；未知桶 throw 不放宽）
// sbw D3.11 现象二分桶域（D3.10 burst_cheat/burst_normal 断代）：在场二桶照落 / 旧档断代 null / 未知桶 throw
ok(buildObservation(mkAnswers()).extLevels.stall_burst_wave === null,
  'ext 题缺席（≤D3.1 旧存档形状）→ null 落审计不 throw（零配额重放兼容）');
const sbwAns = (bucket, p = 0.72) => {
  const rest = (1 - p) / (STALL_BURST_LEVELS.length - 1);
  return { type: 'choice', choice: bucket, probabilities: Object.fromEntries(STALL_BURST_LEVELS.map((b) => [b, b === bucket ? p : rest])) };
};
const f2 = buildObservation({ ...mkAnswers(), stall_burst_wave: sbwAns('burst') });
ok(f2.extLevels.stall_burst_wave === 'burst', 'sbw=burst 照落 extLevels（现象二分在场）');
ok(buildObservation({ ...mkAnswers(), stall_burst_wave: phAns('strong') }).extLevels.stall_burst_wave === null,
  'sbw 旧档四档值 strong（D3.3-D3.8）→ 断代 null 不冒充映射');
ok(buildObservation({ ...mkAnswers(), stall_burst_wave: { type: 'choice', probabilities: { burst_suspect: 1 } } }).extLevels.stall_burst_wave === null,
  'sbw=burst_suspect（D3.9「可疑」中间态已废）→ 断代 null 不冒充映射');
ok(buildObservation({ ...mkAnswers(), stall_burst_wave: { type: 'choice', probabilities: { burst_cheat: 1 } } }).extLevels.stall_burst_wave === null,
  'sbw=burst_cheat（D3.10 定性直判桶，D3.11 裁定不重复检测）→ 断代 null 不冒充映射');
ok(buildObservation({ ...mkAnswers(), stall_burst_wave: { type: 'choice', probabilities: { burst_normal: 1 } } }).extLevels.stall_burst_wave === null,
  'sbw=burst_normal（D3.10 定性直判桶，D3.11 裁定不重复检测）→ 断代 null 不冒充映射');
ok(buildObservation({ ...mkAnswers(), stall_burst_wave: sbwAns('none') }).extLevels.stall_burst_wave === 'none',
  'sbw=none 两域同义保留（无沉寂后爆发涌入）');
let threw = false;
try {
  buildObservation({ ...mkAnswers(), stall_burst_wave: { type: 'choice', probabilities: { extreme: 1 } } });
} catch (_) { threw = true; }
ok(threw, 'ext 题在场未知桶名 → throw（漂移防线不因容缺放宽）');

// 买入额度分层题（D3.7：EXT 容缺通道——缺席 null/在场档位/未知桶 throw）
ok(buildObservation(mkAnswers()).extLevels.amount_tiering === null,
  'amount_tiering 缺席（≤D3.6 旧存档）→ null 不 throw（零配额重放兼容）');
const f2b = buildObservation({ ...mkAnswers(), amount_tiering: phAns('strong') });
ok(f2b.extLevels.amount_tiering === 'strong', 'amount_tiering=strong 照落 extLevels');
threw = false;
try {
  buildObservation({ ...mkAnswers(), amount_tiering: { type: 'choice', probabilities: { low: 1 } } });
} catch (_) { threw = true; }
ok(threw, 'amount_tiering 在场但活跃度桶名 low → throw（现象四档域校验）');

// 同块买入波题（D3.8：EXT 容缺通道同 sbw/tiering——CD12 金额连续散布+开盘无静默盲区）
ok(buildObservation(mkAnswers()).extLevels.same_block_buy_wave === null,
  'same_block_buy_wave 缺席（≤D3.7 旧存档）→ null 不 throw（零配额重放兼容）');
const f2c = buildObservation({ ...mkAnswers(), same_block_buy_wave: phAns('strong') });
ok(f2c.extLevels.same_block_buy_wave === 'strong', 'same_block_buy_wave=strong 照落 extLevels');
threw = false;
try {
  buildObservation({ ...mkAnswers(), same_block_buy_wave: { type: 'choice', probabilities: { high: 1 } } });
} catch (_) { threw = true; }
ok(threw, 'same_block_buy_wave 在场但档域名 high → throw（现象四档域校验）');

// 老鼠仓份额卖出题（D3.9：EXT 容缺通道——CD13 八零买入钱包占总卖出 49.9%+创建同 tx 首买盲区）
ok(buildObservation(mkAnswers()).extLevels.insider_supply_sell === null,
  'insider_supply_sell 缺席（≤D3.8 旧存档）→ null 不 throw（零配额重放兼容）');
const f2e = buildObservation({ ...mkAnswers(), insider_supply_sell: phAns('strong') });
ok(f2e.extLevels.insider_supply_sell === 'strong', 'insider_supply_sell=strong 照落 extLevels');
threw = false;
try {
  buildObservation({ ...mkAnswers(), insider_supply_sell: { type: 'choice', probabilities: { low: 1 } } });
} catch (_) { threw = true; }
ok(threw, 'insider_supply_sell 在场但档域名 low → throw（现象四档域校验）');

// 缓慢拉盘题（D3.14：EXT 容缺通道——CD44 慢速协同吸筹盲区：低密度小笔单向推进无回撤，现有十题看不见）
ok(buildObservation(mkAnswers()).extLevels.slow_grind_pump === null,
  'slow_grind_pump 缺席（≤D3.13 旧存档）→ null 不 throw（零配额重放兼容）');
const f2f = buildObservation({ ...mkAnswers(), slow_grind_pump: phAns('strong') });
ok(f2f.extLevels.slow_grind_pump === 'strong', 'slow_grind_pump=strong 照落 extLevels');
threw = false;
try {
  buildObservation({ ...mkAnswers(), slow_grind_pump: { type: 'choice', probabilities: { low: 1 } } });
} catch (_) { threw = true; }
ok(threw, 'slow_grind_pump 在场但档域名 low → throw（现象四档域校验）');
ok(JSON.stringify(EXT_PHENOMENON_IDS) === JSON.stringify(['stall_burst_wave', 'amount_tiering', 'same_block_buy_wave', 'insider_supply_sell', 'slow_grind_pump']),
  'EXT_PHENOMENON_IDS 导出钉死（后增题容缺通道清单——D3.14 五键）');
ok(JSON.stringify(STALL_BURST_LEVELS) === JSON.stringify(['none', 'burst']),
  'STALL_BURST_LEVELS 导出钉死（D3.11：退回纯现象二分——只判有无停滞后涌入）');

// 活跃度题（D3.5：Jev 判断活跃度——独立档域 low/mid/high/ultra，非现象四档轴）
const actAns = (bucket, p = 0.7) => {
  const rest = (1 - p) / 3;
  return { type: 'choice', choice: bucket, probabilities: Object.fromEntries(ACTIVITY_LEVELS.map((b) => [b, b === bucket ? p : rest])) };
};
ok(buildObservation(mkAnswers()).activityLevel === null,
  'activity_level 缺席（<D3.5 旧存档）→ null 不 throw（重放兼容）');
const f3 = buildObservation({ ...mkAnswers(), activity_level: actAns('low') });
ok(f3.activityLevel.bucket === 'low' && Math.abs(f3.activityLevel.prob - 0.7) < 1e-9,
  'activity_level 在场 → {bucket,prob}（Jev 档位进观测记录）');
threw = false;
try {
  buildObservation({ ...mkAnswers(), activity_level: { type: 'choice', probabilities: { none: 1 } } });
} catch (_) { threw = true; }
ok(threw, 'activity_level 在场但现象桶名 none → throw（独立档域校验——ACTIVITY_LEVELS 须同步）');
ok(JSON.stringify(ACTIVITY_LEVELS) === JSON.stringify(['low', 'mid', 'high', 'ultra']),
  'ACTIVITY_LEVELS 导出=low/mid/high/ultra（题集独立档域对齐）');

// 捆绑交易主导度题（D3.8：独立档域 low/mid/high——「持仓太大量就不好了」以持仓占比为主定档）
const bdAns = (bucket, p = 0.8) => {
  const rest = (1 - p) / 2;
  return { type: 'choice', choice: bucket, probabilities: Object.fromEntries(BUNDLED_LEVELS.map((b) => [b, b === bucket ? p : rest])) };
};
ok(buildObservation(mkAnswers()).bundledDominance === null,
  'bundled_trade_dominance 缺席（<D3.8 旧存档）→ null 不 throw（重放兼容）');
const f2d = buildObservation({ ...mkAnswers(), bundled_trade_dominance: bdAns('high') });
ok(f2d.bundledDominance.bucket === 'high' && Math.abs(f2d.bundledDominance.prob - 0.8) < 1e-9,
  'bundled_trade_dominance 在场 → {bucket,prob}（捆绑主导度档进观测记录）');
threw = false;
try {
  buildObservation({ ...mkAnswers(), bundled_trade_dominance: { type: 'choice', probabilities: { ultra: 1 } } });
} catch (_) { threw = true; }
ok(threw, 'bundled_trade_dominance 在场但档域名 ultra → throw（独立档域校验——BUNDLED_LEVELS 须同步）');
ok(JSON.stringify(BUNDLED_LEVELS) === JSON.stringify(['low', 'mid', 'high']),
  'BUNDLED_LEVELS 导出=low/mid/high（题集独立档域三桶对齐）');

// 现象题防线：缺题/未知桶 throw（fail-loud，调用方落 error 行）
threw = false;
try { buildObservation({}); } catch (_) { threw = true; }
ok(threw, '现象题缺失 → throw（调用方落 error 行）');
threw = false;
try {
  buildObservation({ ...mkAnswers(), sell_dispersion: { type: 'choice', probabilities: { extreme: 1 } } });
} catch (_) { threw = true; }
ok(threw, '未知档位桶名 → throw（题集/映射漂移防线）');

// D3.0 存档兼容：answers 带已退役题（sb/quota/strong_hand/second_wave/retail）→ 不 throw、
// 退役题答案被忽略（重放工具对旧存档跑现行观测组装的兼容前提）
const f4 = buildObservation({
  ...mkAnswers(),
  same_block_buy_burst: phAns('strong'),
  quota_ladder_heat: phAns('moderate'),
  strong_hand_real_buy: phAns('weak'),
  second_wave_absorption: phAns('moderate'),
  retail_participation: { type: 'score', score: 2 },
});
ok(f4.phenomena.equal_amount_split === 'none' && f4.activityLevel === null,
  'D3.0 存档 answers（含退役题）经现行观测组装不 throw、退役题不消费');
ok(typeof buildObservation === 'function'
  && JSON.stringify(PHENOMENON_IDS) === JSON.stringify(['equal_amount_split', 'coordinated_sell_back', 'creator_front_run', 'sell_dispersion']),
  '导出键集=buildObservation + PHENOMENON_IDS 四题（观测形状单一真相源）');

// ═══════════════ G. 活跃度数值族（D3.2 落地；D3.5 起档位判定交 Jev 题_activity_level， ═══════════════
//    derived 数值族保留=存档/回归的校准对照原料——题面教算法的三要素即本族口径）
console.log('G. 活跃度数值族（校准对照）');
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
  ok(!buildCheatState(g5snap).state.includes('高低起伏很大'), 'state 不再渲染不均衡注记（D3.5 档位行整体撤除；derived 照算供对照）');

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
  ok(!buildCheatState(g7snap).state.includes('活跃度:'), '不可评形状 state 无活跃度行（D3.5 档位行撤除后无降级行需求）');

  // G8 micro fixture（router/outlier 主 fixture）无回归：dt 齐 → 活跃度有值不影响既有键
  ok(md.activityLevel === 'low' && md.ticksPerMin === 10.5, `micro fixture：7 笔 40s tpm=10.5 → low（实际 ${md.ticksPerMin}/${md.activityLevel}）`);
}

// ═══════════════ I. 著名钱包单极控盘锚（D3.2b：名单∩窗内持仓 + 60s 跟单集，占正净持仓三档） ═══════════════
console.log('I. 著名钱包单极控盘锚');
{
  const {
    FAMOUS_FOLLOW_WINDOW_SEC, FAMOUS_DOM_HIGH_PCT, FAMOUS_DOM_MID_PCT, loadFamousRoster,
  } = require('../src/market-analysis/cheat-snapshot.js');
  ok(FAMOUS_FOLLOW_WINDOW_SEC === 60 && FAMOUS_DOM_HIGH_PCT === 50 && FAMOUS_DOM_MID_PCT === 25,
    '跟单窗 60s / 档位切点 50/25 挂常量（调档单点）');
  const cfgRoster = loadFamousRoster();
  ok(cfgRoster === null || (cfgRoster instanceof Set && cfgRoster.size > 0),
    `config 名单可加载（Set 非空或缺失=null 绝不空集冒充；实际 ${cfgRoster === null ? 'null' : cfgRoster.size + ' 个'}）`);

  const FAM = '0xbf00000000000000000000000000000000000f01';
  const FAM2 = '0xbf00000000000000000000000000000000000f02';
  const w1 = '0xd111000000000000000000000000000000000011';
  const w2 = '0xd222000000000000000000000000000000000022';
  const w3 = '0xd333000000000000000000000000000000000033';
  const roster = new Set([FAM]);
  let iblk = 900, ilog = 0;
  const mkF = (sec, type, bnb, sender) => mkRow(sec, iblk++, ilog++, type, bnb, 1e-9, { sender });

  // I1 单极控盘 high（手算精确值）：F 买 0.6@t+10；w1 同秒跟单 0.3@t+10；w2 窗边界 60s 跟单 0.3@t+70；
  //    w3 早买 0.3@t+5（F 首买前=非跟单，t+80 再买 0.3 不改首买）
  //    posNet：F 0.6 / w1 0.3 / w2 0.3 / w3 0.6 → posTotal=1.8
  //    famousHold=33.3 · top1=33.3 · follower=33.3 · dominance=66.7 ≥50 → high
  const i1rows = [
    mkF(5, 'buy', 0.3, w3),
    mkF(10, 'buy', 0.6, FAM),
    mkF(10, 'buy', 0.3, w1),
    mkF(70, 'buy', 0.3, w2),
    mkF(80, 'buy', 0.3, w3),
  ];
  const i1snap = buildSnapshotFromRows(i1rows, microMeta, { famousRoster: roster });
  const i1 = i1snap.derived;
  ok(i1.famousHoldPct === 33.3 && i1.famousTop1Pct === 33.3 && i1.famousFollowerPct === 33.3
    && i1.famousDominancePct === 66.7 && i1.famousDominanceLevel === 'high',
    `high 单极控盘 66.7%（实际 hold ${i1.famousHoldPct}/top1 ${i1.famousTop1Pct}/follower ${i1.famousFollowerPct}/dom ${i1.famousDominancePct}/${i1.famousDominanceLevel}）`);
  ok(buildCheatState(i1snap).state.includes('著名钱包单极控盘: 高'), 'state 渲染：高档中文行');

  // I2 窗边界反证：首买距 famous 买 61s >60 → 非跟单；F 独占 50% 恰压 high 线
  const i2 = buildSnapshotFromRows([
    mkF(10, 'buy', 0.6, FAM),
    mkF(71, 'buy', 0.6, w2),
  ], microMeta, { famousRoster: roster }).derived;
  ok(i2.famousFollowerPct === 0 && i2.famousDominancePct === 50 && i2.famousDominanceLevel === 'high',
    `61s 超窗=非跟单；F 独占恰 50% 压线 high（实际 ${i2.famousFollowerPct}/${i2.famousDominancePct}/${i2.famousDominanceLevel}）`);

  // I3 mid：(0.3 F + 0.3 跟单) ÷ posTotal 1.5（w3 独立散户 0.9@t+75=F 后 65s 窗外）=40 → mid（25-50 带）
  const i3 = buildSnapshotFromRows([
    mkF(10, 'buy', 0.3, FAM),
    mkF(12, 'buy', 0.3, w1),
    mkF(75, 'buy', 0.9, w3),
  ], microMeta, { famousRoster: roster }).derived;
  ok(i3.famousDominancePct === 40 && i3.famousDominanceLevel === 'mid',
    `mid=40%（实际 ${i3.famousDominancePct}/${i3.famousDominanceLevel}）`);

  // I4 low 有证据零值：F 在场但清仓（净持仓 0 不进 posNet）→ dominance=0 → low（在场=轴适用；
  //    w3@t+75=F 后 65s 窗外非跟单——买在窗外才有「无人控盘」对照）
  const i4 = buildSnapshotFromRows([
    mkF(10, 'buy', 0.5, FAM),
    mkF(20, 'sell', 0.5, FAM),
    mkF(75, 'buy', 0.6, w3),
  ], microMeta, { famousRoster: roster }).derived;
  ok(i4.famousDominancePct === 0 && i4.famousDominanceLevel === 'low',
    `著名钱包清仓离场：在场=轴适用、dominance=0 有证据零值 low（实际 ${i4.famousDominancePct}/${i4.famousDominanceLevel}）`);

  // I5 null 三臂：a) 窗内无名单命中（轴不适用）b) 名单缺失注入（缺证据）c) posTotal=0（无可主导持仓）
  const i5a = buildSnapshotFromRows([mkF(10, 'buy', 0.5, w3)], microMeta, { famousRoster: roster }).derived;
  ok(i5a.famousDominancePct === null && i5a.famousDominanceLevel === null, '窗内无著名钱包命中 → null');
  ok(buildCheatState(buildSnapshotFromRows([mkF(10, 'buy', 0.5, w3)], microMeta, { famousRoster: roster })).state.includes('著名钱包单极控盘: 不适用'), 'state 渲染：不适用降级行');
  const i5b = buildSnapshotFromRows([mkF(10, 'buy', 0.5, w3)], microMeta, { famousRoster: null }).derived;
  ok(i5b.famousDominancePct === null && i5b.famousDominanceLevel === null, '名单缺失注入 → null（缺证据不冒充）');
  const i5c = buildSnapshotFromRows([
    mkF(10, 'buy', 0.5, FAM),
    mkF(20, 'sell', 0.5, FAM),
  ], microMeta, { famousRoster: roster }).derived;
  ok(i5c.famousDominancePct === null, 'posTotal=0（无人正净持仓）→ null');

  // I6 双著名钱包 top1=最大单一：F2 0.9 > F 0.3，posTotal 1.5 → hold=80 · top1=60（F2）
  const i6 = buildSnapshotFromRows([
    mkF(10, 'buy', 0.3, FAM),
    mkF(11, 'buy', 0.9, FAM2),
    mkF(30, 'buy', 0.3, w3),
  ], microMeta, { famousRoster: new Set([FAM, FAM2]) }).derived;
  ok(i6.famousHoldPct === 80 && i6.famousTop1Pct === 60 && i6.famousDominanceLevel === 'high',
    `双著名：top1=最大单一钱包 60%（实际 ${i6.famousHoldPct}/${i6.famousTop1Pct}/${i6.famousDominanceLevel}）`);

  // I7 跟单钱包后续卖出只计净持仓：w1 跟单买 0.6 后卖 0.2 → 净 0.4 计入 follower
  const i7 = buildSnapshotFromRows([
    mkF(10, 'buy', 0.6, FAM),
    mkF(12, 'buy', 0.6, w1),
    mkF(15, 'sell', 0.2, w1),
  ], microMeta, { famousRoster: roster }).derived;
  ok(i7.famousFollowerPct === 40 && i7.famousDominancePct === 100,
    `跟单者净持仓口径：买 0.6 卖 0.2 → follower=40%（实际 ${i7.famousFollowerPct}/${i7.famousDominancePct}）`);

  // I8 既有键无回归：注入名单后 sbHold/eqHold/活跃度键与注入前逐位一致（锚独立加键）
  const noRoster = buildSnapshotFromRows(i1rows, microMeta, { famousRoster: new Set() }).derived;
  const stripFamous = (o) => {
    const c = { ...o };
    delete c.famousHoldPct; delete c.famousTop1Pct; delete c.famousFollowerPct;
    delete c.famousDominancePct; delete c.famousDominanceLevel;
    return c;
  };
  ok(JSON.stringify(stripFamous(noRoster)) === JSON.stringify(stripFamous(i1))
    && noRoster.famousDominanceLevel === null && noRoster.famousDominancePct === null,
    '空名单注入：famous 族全 null 且其余 derived 键 bit 一致');
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

  // ═══════════════ I2. 题集结构（D3.14：11 题=4 现象+sbw(现象二分 burst)+tiering+bw+activity_level+bd+insider+pump） ═══════════════
  console.log('I2. 题集结构 D3.14（ESM 题文件经动态 import）');
  const qm = await import(path.join(__dirname, '..', 'src/market-analysis/llm/cheat-questions.mjs'));
  ok(qm.CHEAT_QUESTIONS_VERSION === 'D3.15', `版本常量 D3.15（实际 ${qm.CHEAT_QUESTIONS_VERSION}）`);
  ok(JSON.stringify(qm.ACTIVITY_LEVELS) === JSON.stringify(['low', 'mid', 'high', 'ultra']),
    'ACTIVITY_LEVELS 导出=独立档域四桶（mapper 同名常量对齐）');
  ok(JSON.stringify(qm.BUNDLED_LEVELS) === JSON.stringify(['low', 'mid', 'high']),
    'BUNDLED_LEVELS 导出=捆绑题独立档域三桶（mapper 同名常量对齐）');
  ok(JSON.stringify(qm.STALL_BURST_LEVELS) === JSON.stringify(['none', 'burst']),
    'STALL_BURST_LEVELS 导出=停滞突发波现象二分桶域（D3.11 退回只判有无；mapper 同名常量对齐）');
  const qs = qm.buildCheatQuestions();
  const qids = Object.keys(qs);
  ok(qids.length === 11
    && ['equal_amount_split', 'coordinated_sell_back', 'creator_front_run', 'sell_dispersion', 'stall_burst_wave', 'amount_tiering', 'same_block_buy_wave', 'activity_level', 'bundled_trade_dominance', 'insider_supply_sell', 'slow_grind_pump']
      .every((id) => qids.includes(id)),
    '11 题=存续 4 现象题 + stall_burst_wave + amount_tiering + same_block_buy_wave + activity_level + bundled_trade_dominance + insider_supply_sell + slow_grind_pump（D3.14 新增缓慢拉盘题）');
  ok(JSON.stringify(qids.slice(0, 4)) === JSON.stringify(['equal_amount_split', 'coordinated_sell_back', 'creator_front_run', 'sell_dispersion'])
    && !EXT_PHENOMENON_IDS.some((id) => qids.slice(0, 4).includes(id)),
    '存续 4 题位序不变且观察题不在核心清单（mapper PHENOMENON_IDS 对齐）');
  for (const [id, q] of Object.entries(qs)) {
    ok(q.type === 'choice' && q.instructions.includes('怎么算') && q.instructions.includes('真实样本'),
      `题 ${id}：choice + 怎么算算法段 + 真实 case 样本段（教学载体=题面）`);
    ok(!/(cheat|unhealthy|healthy|作弊盘|不健康|健康盘)/.test(q.instructions),
      `题 ${id}：instructions 不带 verdict 词汇（防答题被结论锚定）`);
  }
  // 四档域题=存续 4 现象 + tiering/bw/insider/pump（sbw D3.9 起三分类、act/bd 独立档域另行断言）
  for (const id of [...PHENOMENON_IDS, 'amount_tiering', 'same_block_buy_wave', 'insider_supply_sell', 'slow_grind_pump']) {
    ok(qm.PHENOMENON_LEVELS.every((b) => typeof qs[id].criteria[b] === 'string')
      && Object.keys(qs[id].criteria).length === qm.PHENOMENON_LEVELS.length,
      `题 ${id}：criteria 键集=PHENOMENON_LEVELS 四档（mapper 档位序锁死）`);
  }
  ok(qm.STALL_BURST_LEVELS.every((b) => typeof qs.stall_burst_wave.criteria[b] === 'string')
    && Object.keys(qs.stall_burst_wave.criteria).length === 2,
    'stall_burst_wave：criteria 键集=STALL_BURST_LEVELS 现象二分桶域（D3.11 收缩）');
  ok(qm.ACTIVITY_LEVELS.every((b) => typeof qs.activity_level.criteria[b] === 'string')
    && Object.keys(qs.activity_level.criteria).length === 4,
    'activity_level：criteria 键集=ACTIVITY_LEVELS 独立档域（非现象四档轴——D3.5 档域分叉）');
  const act = qs.activity_level.instructions;
  ok(act.includes('无交易期占比') && act.includes('笔密度') && act.includes('笔均交易额'),
    'activity_level 算法要素=无交易期占比/笔密度/笔均交易额');
  ok(act.includes('波动性/双向性') && act.includes('单向死水推进，即使交易持续不断也压低档位'),
    'activity_level D3.14 第四要素=波动性/双向性（单向死水推进压低档——正常活跃必然带波动）');
  ok(act.includes('笔比 ≥5:1 且额比 ≥3:1') && act.includes('参考 <5%'),
    'activity_level D3.14 死水判据=买卖严重失衡（笔比 ≥5:1 且额比 ≥3:1）+ 回撤极浅（<5%）双臂');
  ok(act.includes('或单向死水推进 → 低') && act.includes('买卖双向且价格有起伏 → 中'),
    'activity_level D3.14 四要素综合定档=死水推进入低档臂、双向有起伏入中档臂');
  ok(act.includes('低档正例·单向推进') && act.includes('36:3') && act.includes('最大回撤仅约 3%'),
    'activity_level D3.14 低档正例补 CD44 形状（39 笔约 14 笔/分、买卖 36:3、30 余次新高回撤约 3%）');
  ok(qs.activity_level.criteria.low.includes('或单向死水推进') && qs.activity_level.criteria.mid.includes('买卖双向、价格有起伏'),
    'activity_level D3.14 criteria=low 加死水臂、mid 补双向有起伏（与题面定档臂对齐）');
  ok(act.includes('静默合计时长 ÷ 窗口总时长') && act.includes('÷ 窗口分钟数'),
    'activity_level 显式算式=静默占比分式 + 密度分式（教学单一载体=题面）');
  ok(act.includes('低档正例') && act.includes('超高正例'), 'activity_level 真实样本=低档/超高正例齐备');
  ok(act.includes('不下任何盘面结论'), 'activity_level 尾句=只述档位不下结论');
  const sbw = qs.stall_burst_wave.instructions;
  ok(sbw.includes('静默') && sbw.includes('排除项'),
    'stall_burst_wave 算法要素=静默段判读/排除项（D3.11 二步形状）');
  ok(sbw.includes('二选一') && sbw.includes('无沉寂后爆发涌入') && sbw.includes('沉寂后爆发涌入'),
    'stall_burst_wave 现象二分输出=有无两类桶名在题面（D3.11 用户裁定只判有无）');
  ok(sbw.includes('本题不判涌入资金的性质') && sbw.includes('不在此重复定性'),
    'stall_burst_wave 分工句=波内资金定性由等额分仓/分层/同块波/捆绑主导度等题判读，本题不重复检测（D3.11 裁定原话语义）');
  ok(!sbw.includes('钱包新旧') && !sbw.includes('买卖对冲') && !sbw.includes('单独摘出来'),
    'stall_burst_wave D3.11 反证=波内资金定性判读（钱包新旧/买卖对冲/单独摘出）已随桶域收缩删除');
  ok(sbw.includes('③量级跃升判据') && sbw.includes('突然增大') && sbw.includes('≥25% 起算明显'),
    'stall_burst_wave D3.13 量级跃升判据=涌入须有突然增大的跳升（波占窗口买入 ≥25% 起算或同块密集聚集）');
  ok(sbw.includes('稀疏到达，不算涌入') && sbw.includes('活跃度题另行判读'),
    'stall_burst_wave D3.13 低活跃盘=静默后零星 1~3 笔散金额小额只是稀疏到达不算涌入（活跃度低归活跃度题，不冒充停滞涌入）');
  ok(sbw.includes('0.08~0.09 BNB') && sbw.includes('约 4 笔/分钟'),
    'stall_burst_wave D3.13 反例=CD38 形状（七分钟窗二十余笔，多次静默后各只来 1~3 笔散金额小额，无密度与量级跳升）');
  ok(qs.stall_burst_wave.criteria.burst.includes('量级相对全窗流量显著跳升')
    && qs.stall_burst_wave.criteria.none.includes('稀疏到达'),
    'stall_burst_wave D3.13 criteria=burst 桶加量级跳升锚句、none 桶加稀疏到达排除句');
  const tier = qs.amount_tiering.instructions;
  ok(tier.includes('带间空隙') && tier.includes('分层覆盖度') && tier.includes('连续渐变'),
    'amount_tiering 算法要素=带间空隙判读/分层覆盖度/无序度对照');
  ok(tier.includes('÷ 窗口全部买入额合计') && tier.includes('跨带拆单'),
    'amount_tiering 显式算式=覆盖度分式 + 辅助形状跨带拆单');
  ok(tier.includes('0.3002~0.3683') && tier.includes('约 92%') && tier.includes('0.2475×4'),
    'amount_tiering 正例=CD1 三带样本（0.3 带/0.2475×4/覆盖约 92%）');
  ok(tier.includes('GMGN') && tier.includes('购买档位') && tier.includes('常态背景'),
    'amount_tiering D3.12 先验锚=GMGN 等工具购买档位/默认值致金额天然聚带，落带是常态背景非异常');
  ok(tier.includes('层的本体是钱包不是笔数') && tier.includes('碎层') && tier.includes('参考 ≥3 个'),
    'amount_tiering D3.12 层本体=每带不同钱包较多（≥3 参考），每带 1-2 笔碎层不构成层');
  ok(tier.includes('规模门槛') && tier.includes('至多 moderate、不给 strong'),
    'amount_tiering D3.12 规模门槛=数额小+钱包不多不给 strong（7 笔分 5 层反例裁定）');
  ok(tier.includes('已对冲离场') && tier.includes('定档以仍在场的资金为主'),
    'amount_tiering D3.12 早波离场=已对冲离场买入只作档位复现辅助，定档以在场资金为主');
  ok(tier.includes('反·碎层') && tier.includes('2.0×/1.1×/1.0×/0.5×') && tier.includes('0.93 BNB'),
    'amount_tiering D3.12 碎层反例=CD17 波4（7 笔 0.93 BNB 落倍数档每档 1-2 笔，至多 moderate）');
  ok(tier.includes('⑥带数量与连续覆盖') && tier.includes('少数几条带」是分层的前提') && tier.includes('参考 ≥6 条'),
    'amount_tiering D3.13 带数量判据=「区间数量不多」落地执行（聚带 ≥6 条且金额逐级渐变无空白=连续散布盘不是分层）');
  ok(tier.includes('连续散布盘') && tier.includes('不是分层，至多 moderate'),
    'amount_tiering D3.13 散布盘=至多 moderate（散户各按自身预算买入，金额天然铺满各档）');
  ok(tier.includes('反·散布') && tier.includes('47 个钱包') && tier.includes('极差逾百倍') && tier.includes('九条'),
    'amount_tiering D3.13 散布反例=CD42 形状（47 钱包 35 个仅一笔、极差逾百倍、九带 0.005~0.75 连续覆盖每带 2~10 钱包）');
  const bwq = qs.same_block_buy_wave.instructions;
  ok(bwq.includes('节拍复现') && bwq.includes('波占比') && bwq.includes('不同钱包'),
    'same_block_buy_wave 算法三要素=同块多钱包/节拍复现/波占比算式');
  ok(bwq.includes('÷ 窗口全部买入额合计') && bwq.includes('不要求静默'),
    'same_block_buy_wave 显式算式=波占比分式 + 与停滞突发波互补（不要求静默）');
  ok(bwq.includes('金额连续散布不削弱本现象') && bwq.includes('不是「等额」'),
    'same_block_buy_wave 判据锚=同时+多钱包而非等额（CD12 金额散布盲区反证）');
  ok(bwq.includes('单一钱包同块多笔拆单不算波'),
    'same_block_buy_wave 排除项=单一钱包拆单');
  ok(bwq.includes('0.079~0.113') && bwq.includes('约 58%'),
    'same_block_buy_wave 正例=CD12 四波样本（金额连续散布 18 笔 13 钱包 58%）');
  const bdq = qs.bundled_trade_dominance.instructions;
  ok(bdq.includes('最硬信号') && bdq.includes('同块多钱包买入波') && bdq.includes('每波轮换'),
    'bundled_trade_dominance 识别三信号=同 tx 打包/同块波/全新钱包轮换');
  ok(bdq.includes('捆绑买入占比') && bdq.includes('捆绑持仓占比') && bdq.includes('正净持仓'),
    'bundled_trade_dominance 双占比算式=买入占比+持仓占比（正净持仓域）');
  ok(bdq.includes('定档以持仓占比为主、买入占比为辅') && bdq.includes('买完拿着'),
    'bundled_trade_dominance 定档锚=持仓为主（买完拿着=主导筹码，卖走=刷量）');
  ok(bdq.includes('背景噪声') && bdq.includes('≥50%') && bdq.includes('15~50%') && bdq.includes('<15%'),
    'bundled_trade_dominance 档位语义=背景噪声无害/高档 ≥50/中档 15~50/低档 <15');
  ok(bdq.includes('约 98% 的正净持仓') && bdq.includes('同一笔链上交易'),
    'bundled_trade_dominance 正例=CD10 簇持仓 98% + CD8 同 tx 打包形状');
  ok(bdq.includes('已卖出的仓位不算主导') && bdq.includes('不足其买入额的 15%') && bdq.includes('至多中档'),
    'bundled_trade_dominance D3.9 强化=已卖出仓位不算主导（CD17 裁定：对冲离场=刷量，买入占比 ≥50% 也至多中档）');
  ok(bdq.includes('买完即对冲卖出'),
    'bundled_trade_dominance 低档正例含 CD17 形状（波内钱包买完即对冲离场、正净≈0 按刷量定低档）');
  ok(qm.BUNDLED_LEVELS.every((b) => typeof qs.bundled_trade_dominance.criteria[b] === 'string')
    && Object.keys(qs.bundled_trade_dominance.criteria).length === 3,
    'bundled_trade_dominance：criteria 键集=BUNDLED_LEVELS 独立档域（非现象四档轴）');
  const rat = qs.insider_supply_sell.instructions;
  ok(rat.includes('买入额不足其卖出额 10%') && rat.includes('沉在末尾也要扫到'),
    'insider_supply_sell 判据核心=零买入/低买入卖出钱包（10% 判据）+ [WALLETS] 降序末尾扫到（纯卖出钱包沉底反证）');
  ok(rat.includes('÷ 窗口全部卖出额合计') && rat.includes('≥30%') && rat.includes('10~30%'),
    'insider_supply_sell 显式算式=配额倾倒占比分式（卖出域——与买入域题分式区分）');
  ok(rat.includes('createTx=') && rat.includes('同一笔链上交易'),
    'insider_supply_sell 最硬信号=创建+首买同笔 tx（[TOKEN] createTx= 与 [TICKS] tx= 对上）');
  ok(rat.includes('同块协同/多轮次') && rat.includes('先买后卖'),
    'insider_supply_sell 倾倒节奏=同块协同/多轮次 + AMM 先买后卖原理锚（无买入有筹码=内部分配）');
  ok(rat.includes('零买入纯卖出') && rat.includes('总卖出一半'),
    'insider_supply_sell 正例=CD13 形状（八钱包零买入占总卖出一半三组轮次）');
  ok(rat.includes('归「抢跑者首买」题口径'),
    'insider_supply_sell 反例=creator 买入覆盖卖出归 cr 题口径（题间分界不重叠）');
  ok(rat.includes('组合升档锚') && rat.includes('老鼠仓式派发') && rat.includes('三件齐即高档'),
    'insider_supply_sell D3.10 组合升档=createTx 同笔+首买占比 ≥25%+创建者随后分批卖出=高档（CD13 裁定 strong）');
  ok(rat.includes('倾倒占比可低于 30%'),
    'insider_supply_sell 组合升档=派发路径本身已主导盘面（配额钱包占比门可不过线）');
  ok(rat.includes('定档优先级') && rat.includes('锚点截断') && rat.includes('不与②的占比互相打折'),
    'insider_supply_sell D3.10 定档优先级=三件齐独立成立即高档（窗口截断教学：窗内占比低是截断不是否定）');
  ok(qm.PHENOMENON_LEVELS.every((b) => typeof qs.insider_supply_sell.criteria[b] === 'string'),
    'insider_supply_sell：criteria 键集=PHENOMENON_LEVELS 四档（现象强度轴）');
  const pump = qs.slow_grind_pump.instructions;
  ok(pump.includes('单调性') && pump.includes('最大回撤极浅') && pump.includes('参考 <5%'),
    'slow_grind_pump 判据①=单调性（回撤 <5%、新高持续推进、无成串卖回波）');
  ok(pump.includes('买卖失衡') && pump.includes('笔比 ≥5:1 且额比 ≥3:1') && pump.includes('零星获利卖穿插'),
    'slow_grind_pump 判据②=买卖失衡双比阈值（正常上涨段也有零星获利卖穿插的反锚）');
  ok(pump.includes('看推价的持续力量是不是小笔') && pump.includes('非爆发式抢筹') && pump.includes('持续性'),
    'slow_grind_pump 判据③④=节奏看推价的持续力量是不是小笔（非爆发式贯穿全程）+ 单向状态覆盖窗口主要时段');
  ok(pump.includes('开盘首波爆发抢筹') && pump.includes('归「同块买入波」等题判读'),
    'slow_grind_pump 排除项=开盘首波爆发抢筹（天然失衡归 bw 题口径，题间分界）');
  ok(pump.includes('像样回撤') && pump.includes('成串获利卖回的盘不选本题'),
    'slow_grind_pump 排除项=有像样回撤（≥10%）或成串获利卖回的盘不选（有波动不算缓慢拉盘）');
  ok(pump.includes('39 笔跨约 3 分钟') && pump.includes('买 36 笔 1.47') && pump.includes('最大回撤仅约 3%'),
    'slow_grind_pump 正例=CD44 锚窗形状（39 笔 14 笔/分、买卖 36:3 额比超 9:1、回撤约 3%）');
  ok(pump.includes('砸出近四成回撤') && pump.includes('零交易死寂'),
    'slow_grind_pump 正例含 CD44 后续走势（推至峰值后砸崩近四成再长时间死寂=拉高后派发）');
  ok(pump.includes('约 80 笔/分钟') && pump.includes('16% 量级回撤') && pump.includes('有波动的活跃上涨盘'),
    'slow_grind_pump 反例=CD46 形状（80 笔/分、回撤 16% 有起伏——买卖失衡但非本题形状）');
  ok(pump.includes('窜上来一截后，缓慢拉盘') && pump.includes('后段垫推才是本题的观察主体'),
    'slow_grind_pump D3.15 定义句补两段式形状（用户裁定「窜上来一截后，缓慢拉盘」——前段大额簇窜升+后段尘埃买垫量缓推，垫推段是观察主体）');
  ok(pump.includes('只贡献跳升段、不贡献持续爬坡') && pump.includes('垫量缓推') && pump.includes('整窗笔均被前段大额拉高不否定后段垫推'),
    'slow_grind_pump D3.15 节奏判据=大额簇/大单只贡献跳升不贡献爬坡，海量尘埃买垫量缓推算数（笔均被拉高不否定垫推——CD55 误判归因①）');
  ok(pump.includes('窜完即止无后续缓推段') && pump.includes('爆发段之后接续垫量缓推段的，爆发段归同块波题判读、缓推段仍在本题口径内'),
    'slow_grind_pump D3.15 排除项改写=整窗主体爆发且窜完即止才排除；窜后接缓推的缓推段归本题、爆发段归 bw 题（CD55 误判归因②整窗排除）');
  ok(pump.includes('正·窜一截后缓推') && pump.includes('0.0001 级尘埃买垫量缓推') && pump.includes('最大回撤不足 2%'),
    'slow_grind_pump D3.15 正例补 CD55 两段式形状（同块簇窜升占四成多+十余笔 0.0001 级尘埃买垫推、回撤不足 2%、笔比超 13:1）');
  ok(pump.includes('窜完即止') && pump.includes('无尘埃买垫量缓推段') && pump.includes('纯爆发不属本题'),
    'slow_grind_pump D3.15 反例补窜完即止形状（CD53/CD54 同块簇占比过半数十秒窜完、无垫推段——防误伤划界锚）');

  console.log(`\n✅ _test_cheat_detection_lib 全过（${passed} 断言）`);
})().catch((e) => { console.error(`\n❌ ${e?.stack || e}`); process.exit(1); });
