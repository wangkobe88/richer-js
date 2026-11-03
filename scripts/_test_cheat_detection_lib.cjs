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
const { buildObservation, PHENOMENON_IDS, EXT_PHENOMENON_IDS, ACTIVITY_LEVELS, BUNDLED_LEVELS, STALL_BURST_LEVELS, ABNORMAL_BEHAVIOR_LEVELS } = require('../src/market-analysis/cheat-result-mapper');

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
    token_amount: opts.tok ?? null,
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

// 同块对敲 wash pair（D3.28，CD27 对倒案）：同块一卖一买 ±2% 对数带配对、每笔卖出
// 至多配一次、尘门 0.001 以下不入、无配对三键全 null
{
  const washRows = [];
  let wblk = 600, wlog = 0;
  const wpush = (type, bnb, wallet) => {
    washRows.push(mkRow(100 + wlog, wblk, wlog++, type, bnb, 1e-9, { trader: wallet, sender: wallet }));
  };
  // blk 600：0.1000 卖 ↔ 0.1005 买（带内 1.005）→ 配对 ①
  wpush('sell', 0.1, '0xw1'); wpush('buy', 0.1005, '0xw2');
  wblk += 1;
  // blk 601：0.2000 卖 ↔ 0.2020 买（1.010）→ 配对 ②
  wpush('sell', 0.2, '0xw1'); wpush('buy', 0.202, '0xw3');
  wblk += 1;
  // blk 602：0.3000 卖 ↔ 0.2900 买（0.9667 超带下界）→ 不配
  wpush('sell', 0.3, '0xw1'); wpush('buy', 0.29, '0xw4');
  wblk += 1;
  // blk 603：0.5000 卖 ↔ 0.0009 买（尘门下不入配对池；卖 0.5 剩）→ 不配
  wpush('sell', 0.5, '0xw1'); wpush('buy', 0.0009, '0xw5');
  wblk += 1;
  // blk 604：0.3990 卖 ↔ 0.4000 买（1.0025）→ 配对 ③
  wpush('sell', 0.399, '0xw6'); wpush('buy', 0.4, '0xw7');
  wblk += 1;
  // blk 605：两笔 0.1000 卖 ↔ 一笔 0.1010 买（1.010）→ 买只配一笔=配对 ④（每笔买至多配一次）
  wpush('sell', 0.1, '0xw8'); wpush('sell', 0.1, '0xw9'); wpush('buy', 0.101, '0xwA');
  const wd = buildSnapshotFromRows(washRows, microMeta).derived;
  // 手推：配对 4 对、配对买额=0.1005+0.202+0.4+0.101=0.8035；Σ卖=1.699、Σ买=1.0939
  ok(wd.washPairCount === 4, `washPairCount=4（实际 ${wd.washPairCount}——超带/尘门/重复配对三形状全拦）`);
  ok(wd.washPairSellPct.toFixed(2) === '47.29', `washPairSellPct=0.8035/1.699=47.29%（实际 ${wd.washPairSellPct?.toFixed(2)}）`);
  ok(wd.washPairBuyPct.toFixed(2) === '73.42', `washPairBuyPct=0.8035/1.0944=73.42%（实际 ${wd.washPairBuyPct?.toFixed(2)}）`);
  // 零配对（microRows：唯一卖 0.1 同块无买）→ 三键 null（有证据的缺席，非零冒充）
  ok(md.washPairCount === null && md.washPairSellPct === null && md.washPairBuyPct === null,
    '零配对 → washPair 三键 null（无配对不渲染 [PRECOMPUTED] 行=缺席语义）');
  // block 缺失行不参与配对（证据洞不入池）
  {
    const noBlk = [
      mkRow(10, null, 1, 'sell', 0.2, 1e-9, { trader: wB, sender: wB }),
      mkRow(10, null, 2, 'buy', 0.2, 1e-9, { trader: wC, sender: wC }),
    ];
    const ndb = buildSnapshotFromRows(noBlk, microMeta).derived;
    ok(ndb.washPairCount === null, 'block 缺失行不入配对池（同块判定无锚=证据洞）');
  }
  // state 渲染：有配对时 [PRECOMPUTED] 出「同块对敲」行；零配对不渲染
  const wst = buildCheatState(buildSnapshotFromRows(washRows, microMeta));
  ok(wst.state.includes('同块对敲: 4 对，配对买额占全部卖出 47.3% / 占全部买入 73.4%'),
    '[PRECOMPUTED] 同块对敲行渲染（对数+双占比）');
  ok(!buildCheatState(ms).state.includes('同块对敲'), '零配对不渲染同块对敲行（缺席不占 state 预算）');
}

// 簇闭环+簇占流通（D3.41，批次二 CD20 深挖「同块买→隔数秒同块卖回」跨块闭环案）：
// 五组形状——A 簇（同块+等额双簇两轮闭环=跨簇行去重）/B 簇（sb 簇金额各异单轮）/
// C 簇（等额簇分散卖出零闭环）/d 对（2 钱包不成簇同块卖不计）/E 簇（卖先于首买
// 块不计）/F 簇（首买块缺失不计）——全部手算精确值锁定
{
  const rtRows = [];
  let rlog = 0;
  const rpush = (sec, block, type, bnb, wallet, tok) => {
    rtRows.push(mkRow(sec, block, rlog++, type, bnb, 1e-9, { trader: wallet, sender: wallet, tok }));
  };
  const a1 = '0xra10000000000000000000000000000000000a1', a2 = '0xra20000000000000000000000000000000000a2', a3 = '0xra30000000000000000000000000000000000a3';
  const b1 = '0xrb10000000000000000000000000000000000b1', b2 = '0xrb20000000000000000000000000000000000b2', b3 = '0xrb30000000000000000000000000000000000b3';
  const c1 = '0xrc10000000000000000000000000000000000c1', c2 = '0xrc20000000000000000000000000000000000c2', c3 = '0xrc30000000000000000000000000000000000c3';
  const d1 = '0xrd10000000000000000000000000000000000d1', d2 = '0xrd20000000000000000000000000000000000d2';
  const e1 = '0xre10000000000000000000000000000000000e1', e2 = '0xre20000000000000000000000000000000000e2', e3 = '0xre30000000000000000000000000000000000e3';
  const f1 = '0xrf10000000000000000000000000000000000f1', f2 = '0xrf20000000000000000000000000000000000f2', f3 = '0xrf30000000000000000000000000000000000f3';
  // A 簇：blk700 同块 0.2000×3（sb+eq 双簇）→ blk705 a1+a2 同块卖回 → blk708 a2+a3 同块再卖回
  rpush(10, 700, 'buy', 0.2, a1, 1000); rpush(10, 700, 'buy', 0.2, a2, 1000); rpush(10, 700, 'buy', 0.2, a3, 1000);
  rpush(20, 705, 'sell', 0.15, a1, 700); rpush(20, 705, 'sell', 0.15, a2, 700);
  rpush(30, 708, 'sell', 0.10, a2, 300); rpush(30, 708, 'sell', 0.15, a3, 500);
  // B 簇：blk702 同块买金额各异（只 sb 簇）→ blk710 b1+b2 同块卖回（b3 持有不动）
  rpush(12, 702, 'buy', 0.11, b1, 100); rpush(12, 702, 'buy', 0.13, b2, 100); rpush(12, 702, 'buy', 0.17, b3, 100);
  rpush(35, 710, 'sell', 0.09, b1, 60); rpush(35, 710, 'sell', 0.11, b2, 50);
  // C 簇：0.3000×3 异块买（只 eq 簇）→ c1 单人卖（同块 1 成员 <2 → 零闭环）
  rpush(40, 712, 'buy', 0.3, c1, 200); rpush(41, 713, 'buy', 0.3, c2, 200); rpush(42, 714, 'buy', 0.3, c3, 200);
  rpush(50, 720, 'sell', 0.2, c1, 200);
  // d 对：0.5×2 只两钱包（<3 不成簇）同块卖回 → 不计
  rpush(45, 715, 'buy', 0.5, d1, 400); rpush(46, 716, 'buy', 0.5, d2, 400);
  rpush(55, 721, 'sell', 0.4, d1, 300); rpush(55, 721, 'sell', 0.4, d2, 250);
  // E 簇：0.4000×3 等额（eq 簇成立）但 e1+e2 卖块 725 < 首买块 730 → 不计（链外持仓卖非卖回）
  rpush(55, 725, 'sell', 0.3, e1, 300); rpush(55, 725, 'sell', 0.3, e2, 300);
  rpush(60, 730, 'buy', 0.4, e1, 500); rpush(60, 730, 'buy', 0.4, e2, 500); rpush(60, 730, 'buy', 0.4, e3, 500);
  // F 簇：0.6000×3 等额但买入行 block 缺失（首买块证据洞）→ 同块卖不计（宁少不冒充）
  rpush(65, null, 'buy', 0.6, f1, 300); rpush(66, null, 'buy', 0.6, f2, 300); rpush(67, null, 'buy', 0.6, f3, 300);
  rpush(70, 740, 'sell', 0.5, f1, 300); rpush(70, 740, 'sell', 0.5, f2, 300); rpush(70, 740, 'sell', 0.5, f3, 300);
  const rs = buildSnapshotFromRows(rtRows, microMeta);
  const rd = rs.derived;
  // 手推：Σ买=0.6+0.41+0.9+1.0+1.2+1.8=5.91；Σ卖=0.55+0.20+0.20+0.8+0.6+1.5=3.85
  // 闭环计入行（去重）：blk705 0.30 + blk708 0.25（A 簇 sb/eq 双簇只计一次）+ blk710 0.20（B 簇）
  //   =0.75；分母=sb∪eq 成员买入 4.91（A0.6+B0.41+C0.9+E1.2+F1.8，d 对不在簇内）
  ok(rd.clusterRoundTripPct === 15.3, `clusterRoundTripPct=0.75/4.91=15.3%（实际 ${rd.clusterRoundTripPct}——跨簇行去重/A 簇双簇单计/E 卖先于首买不计/F 首买块缺失不计/d 不成簇不计全形状）`);
  ok(rd.clusterRoundTripSellPct === 19.5, `clusterRoundTripSellPct=0.75/3.85=19.5%（实际 ${rd.clusterRoundTripSellPct}）`);
  ok(rd.clusterRoundTripBlocks === 3, `clusterRoundTripBlocks=3（blk705/708/710；实际 ${rd.clusterRoundTripBlocks}）`);
  // 叙事数组：A-sb（0.55）=A-eq（0.55）>B（0.20）共 3 条；A 双簇同卖出行去重后各自 sellBnb 相同
  ok(rd.clusterRoundTrips.length === 3, `clusterRoundTrips=3 条（实际 ${rd.clusterRoundTrips.length}——A sb/eq 双簇+B sb 簇；C 零闭环/E/F 不计形状无叙事）`);
  const aSb = rd.clusterRoundTrips.find((c) => c.kind === 'same_block' && c.label === '块700');
  const aEq = rd.clusterRoundTrips.find((c) => c.kind === 'equal' && c.label === '0.2000×3');
  const bSb = rd.clusterRoundTrips.find((c) => c.kind === 'same_block' && c.label === '块702');
  ok(aSb && aSb.wallets === 3 && aSb.buyBnb === 0.6 && aSb.sellBnb === 0.55 && aSb.blocks.length === 2,
    `A sb 簇叙事=3 钱包/买 0.6/闭环卖 0.55/两轮（实际 ${JSON.stringify(aSb)}）`);
  ok(aEq && aEq.buyBnb === 0.6 && aEq.sellBnb === 0.55,
    `A eq 簇叙事同源（实际 ${JSON.stringify(aEq)}——同一批卖出行双簇各自成叙事、锚层已去重）`);
  ok(bSb && bSb.wallets === 3 && bSb.buyBnb === 0.41 && bSb.sellBnb === 0.2 && bSb.blocks.length === 1,
    `B sb 簇叙事=金额各异单轮（实际 ${JSON.stringify(bSb)}）`);
  // 簇占流通（token 域）：Σ正净=2540；sb 成员=块700+块702+块730 三簇（E 簇 0.4000×3
  //   同块买也是 sb 簇）：a1 300+a2 0+a3 500+b1 40+b2 50+b3 100+e1 200+e2 200+e3 500=1890
  //   eq 带成员（±2% 对数带 ≥3 钱包，D3.1 eqMembers 同源）：0.2/0.3/0.4/0.6 四档
  //   {a,c,e,f}（d 对 0.5 只 2 钱包不入）：2100
  const circSb = rd.sameBlockHoldCircPct, circEq = rd.equalBandHoldCircPct;
  ok(typeof circSb === 'number' && Math.abs(circSb - (1890 / 2540) * 100) < 1e-9,
    `sameBlockHoldCircPct=1890/2540=74.41%（实际 ${circSb}——token 域分子 sb 成员正净持仓、分母 Σ正净）`);
  ok(typeof circEq === 'number' && Math.abs(circEq - (2100 / 2540) * 100) < 1e-9,
    `equalBandHoldCircPct=2100/2540=82.68%（实际 ${circEq}——对数带口径与 D3.1 eqMembers 同源）`);
  // 无合格簇 → null 缺席；有簇零闭环 → 0 有证据零值（microRows 无任何 ≥3 笔同块/等额簇）
  ok(md.clusterRoundTripPct === null && md.clusterRoundTripSellPct === null && md.clusterRoundTripBlocks === 0,
    '无合格簇 → 闭环三键 null/0（缺席不冒充）');
  ok(md.sameBlockHoldCircPct === null && md.equalBandHoldCircPct === null,
    '无合格簇 → 簇流通两键 null');
  {
    // 有簇零闭环=正常盘常态：三钱包同块买后全部持有不动
    const zc = [
      mkRow(10, 800, 1, 'buy', 0.2, 1e-9, { trader: a1, sender: a1, tok: 100 }),
      mkRow(10, 800, 2, 'buy', 0.2, 1e-9, { trader: a2, sender: a2, tok: 100 }),
      mkRow(10, 800, 3, 'buy', 0.2, 1e-9, { trader: a3, sender: a3, tok: 100 }),
    ];
    const zd = buildSnapshotFromRows(zc, microMeta).derived;
    ok(zd.clusterRoundTripPct === 0 && zd.clusterRoundTripBlocks === 0 && zd.clusterRoundTrips.length === 0,
      `有簇零闭环 → pct=0 有证据零值/blocks=0/叙事空（实际 ${zd.clusterRoundTripPct}/${zd.clusterRoundTripBlocks}/${zd.clusterRoundTrips.length}）`);
    ok(zd.sameBlockHoldCircPct === 100,
      `簇全员持有 → 同块簇占在场流通 100%（实际 ${zd.sameBlockHoldCircPct}——垄断在场的极端形状）`);
  }
  // state 渲染：闭环行（块数+双占比+例句）与簇集中度行；零闭环不渲染闭环行
  const rst = buildCheatState(rs);
  ok(rst.state.includes('簇买→同块卖回闭环: 3 个同块卖回块（同一买入簇 ≥2 成员同块卖出），闭环卖出占簇成员买入 15.3% / 占全部卖出 19.5%'),
    '[PRECOMPUTED] 簇闭环行渲染（块数+双占比+口径句）');
  ok(rst.state.includes('等额簇 0.2000×3（3 钱包 t+10s 买入 Σ0.600）') && rst.state.includes('同块簇 块702'),
    '簇闭环行例句=最大三簇叙事（等额簇金额×人数/同块簇块号）');
  ok(rst.state.includes(`同块买入簇成员占在场流通 ${circSb.toFixed(1)}%`) && rst.state.includes(`等额带簇成员占在场流通 ${circEq.toFixed(1)}%`),
    '捆绑簇持仓集中度行渲染（两簇占在场流通一位小数）');
  ok(!buildCheatState(buildSnapshotFromRows([
    mkRow(10, 800, 1, 'buy', 0.2, 1e-9, { trader: a1, sender: a1, tok: 100 }),
    mkRow(10, 800, 2, 'buy', 0.2, 1e-9, { trader: a2, sender: a2, tok: 100 }),
    mkRow(10, 800, 3, 'buy', 0.2, 1e-9, { trader: a3, sender: a3, tok: 100 }),
  ], microMeta)).state.includes('簇买→同块卖回闭环'),
  '零闭环不渲染闭环行（正常盘常态不占 state 预算，缺席语义同对敲行）');
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
ok(st.state.includes('仅作盘面健康参考，不作作弊判据'), 'top1 集中度标注「仅健康参考不作判据」');
// CD133（2026-11-02 用户裁定「GMGN的散户是有默认交易额的……这要是能跨区块，误伤就
// 太大了！……还是把原始数据输入给Jev，通过现象描述，去综合判断与考量里面是否有协同
// 行为吧」）：同块簇持仓占比/近等额簇持仓占比/簇买入占比三行死指标全撤——sb∪eq 圈定
// 吞前端默认档散户；结构指纹由 Jev 从 [TICKS]/[WALLETS] 原始逐笔归纳（D3.34 题面反锚），
// derived 照算供 digest 存档/FA 投影/runner 观测
ok(!st.state.includes('同块簇持仓占比:') && !st.state.includes('近等额簇持仓占比:')
  && !st.state.includes('簇买入占比') && !st.state.includes('分子=成员正净持仓合计'),
  'CD133 三行死指标已撤（D3.34——结构指纹交 Jev 从原始逐笔归纳，口径注释随行同撤）');
ok(!microStateDisplay.state.includes('同块簇持仓占比') && !microStateDisplay.state.includes('近等额簇持仓占比'),
  '无合格簇形状同样无行（行整个不存在——不再有「无合格簇」渲染位）');
// D3.5：代码活跃度档位行撤除（教学单一载体=题面 activity_level——「使用 Jev 进行判断」；
// derived 数值仍算供存档对照，state 不再预贴档位结论）
ok(!st.state.includes('活跃度: 低') && !st.state.includes('活跃度: 中') && !st.state.includes('活跃度: 高')
  && !st.state.includes('活跃度: 超高') && !st.state.includes('活跃度: 不可评'),
  'state 不再渲染代码活跃度档位行（D3.5 教学迁题面——档位判定交 Jev）');
// D3.30：活跃度数值事实行（批次四 CD31 复查——代码口径 94 笔/分=high 而 Jev 无数值锚
// 低置信漂移 low；三要素原料以数值事实进 state，档位行仍撤、判档仍 Jev）
ok(st.state.includes('活跃度数值: 每分钟') && st.state.includes('最大交易间隔'),
  'state 渲染活跃度数值事实行（D3.30 三要素原料=每分钟笔数/笔均/最大间隔，数值非档位）');
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
ok(Object.keys(f1.anchors).length === 27, 'D3.41 后 anchors=sb/eq+bundleBuy+top1 供/流+washPair 三键+D3.32 持仓分布五键+G8 burst 三键/纯卖+D3.35 五键+D3.41 簇流通两键/簇闭环三键=二十七数值键（activity/participation 档位不投影）');
ok(f1.anchors.top1HoldSupplyPct === null && f1.anchors.top1HoldCircPct === null,
  'D3.20 双锚未传→null 容缺（f1 只传 sb/eq）');
ok(f1.anchors.washPairCount === null && f1.anchors.washPairSellPct === null
  && f1.anchors.washPairBuyPct === null,
  'D3.28 washPair 三键未传→null 容缺（f1 只传 sb/eq）');
ok(f1.anchors.top2HoldSupplyPct === null && f1.anchors.top1Top2HoldSupplyPct === null
  && f1.anchors.top1Top2FirstBuyGapSec === null && f1.anchors.clusterHoldSupplyPct === null
  && f1.anchors.t1PlusClusterSupplyPct === null,
  'D3.32 持仓分布五键未传→null 容缺（f1 只传 sb/eq——旧档断代重放零变化防线）');
ok(!('verdict' in f1) && !('cheatProb' in f1) && !('patternType' in f1) && !('ruleAudit' in f1),
  '观测记录无 verdict/cheatProb/patternType/ruleAudit 键（判定层停产反证）');
const f1b = buildObservation(mkAnswers(), { sameBlockHoldPct: '88' });
ok(f1b.anchors.sameBlockHoldPct === null, '锚形状异常（字符串）→ 按缺席算不冒充');
// D3.20 双锚透传（观测记录/digest 留痕——组 13 eqHold 59% 先例同位）
const f1c = buildObservation(mkAnswers(), { top1HoldSupplyPct: 46.5, top1HoldCircPct: 91.3 });
ok(f1c.anchors.top1HoldSupplyPct === 46.5 && f1c.anchors.top1HoldCircPct === 91.3,
  'D3.20 双锚回显（CD69 形状 46.5/91.3）');
ok(f1c.anchors.sameBlockHoldPct === null && f1c.anchors.equalBandHoldPct === null,
  'D3.20 f1c 未传 sb/eq→null（四键独立容缺）');
// D3.28 washPair 三键回显（CD27 对倒形状 10 对/95.1%）
const f1d = buildObservation(mkAnswers(), { washPairCount: 10, washPairSellPct: 95.1, washPairBuyPct: 27.3 });
ok(f1d.anchors.washPairCount === 10 && f1d.anchors.washPairSellPct === 95.1
  && f1d.anchors.washPairBuyPct === 27.3,
  'D3.28 washPair 三键回显（CD27 形状 10 对/卖占 95.1/买占 27.3）');
ok(f1d.anchors.washPairCount === 10 && f1d.anchors.sameBlockHoldPct === null,
  'D3.28 washPair 与持仓锚独立容缺（互不冒充）');
// D3.32 持仓分布五键回显（CD122 组合垄断实值：t2 9.4/Σ2 35.0/Δ1s/簇 14.5/∪40.1）
const f1e = buildObservation(mkAnswers(), { top2HoldSupplyPct: 9.4, top1Top2HoldSupplyPct: 35.0,
  top1Top2FirstBuyGapSec: 1, clusterHoldSupplyPct: 14.5, t1PlusClusterSupplyPct: 40.1 });
ok(f1e.anchors.top2HoldSupplyPct === 9.4 && f1e.anchors.top1Top2HoldSupplyPct === 35.0
  && f1e.anchors.top1Top2FirstBuyGapSec === 1 && f1e.anchors.clusterHoldSupplyPct === 14.5
  && f1e.anchors.t1PlusClusterSupplyPct === 40.1,
  'D3.32 持仓分布五键回显（CD122 形状 t2 9.4%/前二 35.0%/Δ首买 1 秒/簇 14.5%/并集 40.1%）');
ok(f1e.extLevels.holdings_balance === null,
  'holdings_balance 题缺席（<D3.32 旧档）→ extLevels null 不 throw（EXT 容缺断代）');
// D3.41 簇流通两键+簇闭环三键回显（批次二 CD20 深挖实测形状：闭环卖回占簇买 50.4%/占总卖 38.0/13 块）
const f1g = buildObservation(mkAnswers(), { sameBlockHoldCircPct: 33.3, equalBandHoldCircPct: 57.9,
  clusterRoundTripPct: 50.4, clusterRoundTripSellPct: 38.0, clusterRoundTripBlocks: 13 });
ok(f1g.anchors.sameBlockHoldCircPct === 33.3 && f1g.anchors.equalBandHoldCircPct === 57.9,
  'D3.41 簇流通两键回显（token 域在场流通口径）');
ok(f1g.anchors.clusterRoundTripPct === 50.4 && f1g.anchors.clusterRoundTripSellPct === 38.0
  && f1g.anchors.clusterRoundTripBlocks === 13,
  'D3.41 簇闭环三键回显（CD20 形状 50.4/38.0/13）');
ok(f1g.anchors.clusterRoundTrips === undefined,
  'clusterRoundTrips 叙事数组不进 observation（仅 state 渲染，digest 不膨胀）');
const f1f = buildObservation(mkAnswers({ holdings_balance: 'strong' }), {});
ok(f1f.extLevels.holdings_balance === 'strong',
  'holdings_balance 在场答案 → extLevels 落档（G7 J 通道原料）');

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

// 同块对敲题（D3.28：EXT 容缺通道——CD27 连续 9 块逐块卖↔一次性新钱包等额买回 95.1%）
ok(buildObservation(mkAnswers()).extLevels.wash_pair === null,
  'wash_pair 缺席（≤D3.27 旧存档）→ null 不 throw（零配额重放兼容——G3 存档重放零变化防线）');
const f2g = buildObservation({ ...mkAnswers(), wash_pair: phAns('strong') });
ok(f2g.extLevels.wash_pair === 'strong', 'wash_pair=strong 照落 extLevels');
threw = false;
try {
  buildObservation({ ...mkAnswers(), wash_pair: { type: 'choice', probabilities: { low: 1 } } });
} catch (_) { threw = true; }
ok(threw, 'wash_pair 在场但档域名 low → throw（现象四档域校验）');
try {
  buildObservation({ ...mkAnswers(), holdings_balance: { type: 'choice', probabilities: { low: 1 } } });
  threw = false;
} catch (_) { threw = true; }
ok(threw, 'holdings_balance 在场但档域名 low → throw（现象四档域校验——EXT 通道不因容缺放宽）');
ok(JSON.stringify(EXT_PHENOMENON_IDS) === JSON.stringify(['stall_burst_wave', 'amount_tiering', 'same_block_buy_wave', 'insider_supply_sell', 'slow_grind_pump', 'wash_pair', 'holdings_balance']),
  'EXT_PHENOMENON_IDS 导出钉死（后增题容缺通道清单——D3.32 七键：holdings_balance 入列）');
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
  // G5 跟单集中度锚（D 通道豁免数值源）：i1 跟单集={w1 0.3, w2 0.3} 全在 top3 → 100.0
  ok(i1.famousFollowerTop3Pct === 100,
    `i1 跟单 top3=100%（两跟单钱包全覆盖；实际 ${i1.famousFollowerTop3Pct}）`);
  ok(buildCheatState(i1snap).state.includes('跟单前三钱包占跟单合计'), 'state 渲染：跟单 top3 数值行');
  // G6 组织买入占比锚（豁免前提，用户补充裁定 2026-11-02）：i1 手算——总买 1.8；
  // famous∪跟单买入=0.6+0.3+0.3=1.2 → 66.7；等额带 0.3×4 钱包（w3/w1/w2）买入
  // 0.6+0.3+0.3=1.2 → bundleBuy 66.7（w3 两笔 0.3 同带并集去重）
  ok(i1.famousGroupBuyPct === 66.7 && i1.bundleBuyPct === 66.7,
    `i1 组织买入占比：famous集团 66.7 / 簇 66.7（实际 ${i1.famousGroupBuyPct}/${i1.bundleBuyPct}）`);
  ok(!buildCheatState(i1snap).state.includes('簇买入占比')
    && buildCheatState(i1snap).state.includes('著名+跟单买入占全部买入 66.7%'),
    'state 渲染：簇买入占比行已撤（CD133/G11——sb∪eq 圈定吞默认档散户）；famous 行尾集团买入保留（D 通道豁免前提 famousGroupBuyPct 仍在消费）');
  // G5 分散形：5 个跟单各 0.1 → top3=0.3/0.5=60.0（跟单正净 Σ 0.5）
  const i1b = buildSnapshotFromRows([
    mkF(10, 'buy', 0.5, FAM),
    mkF(11, 'buy', 0.1, w1), mkF(12, 'buy', 0.1, w2), mkF(13, 'buy', 0.1, w3),
    mkF(14, 'buy', 0.1, '0xd444000000000000000000000000000000000044'),
    mkF(15, 'buy', 0.1, '0xd555000000000000000000000000000000000055'),
  ], microMeta, { famousRoster: roster }).derived;
  ok(i1b.famousFollowerTop3Pct === 60,
    `5 跟单各 0.1 → top3 占 60.0（实际 ${i1b.famousFollowerTop3Pct}）`);
  ok(i1b.famousGroupBuyPct === 100 && i1b.bundleBuyPct === 50,
    `i1b 组织买入占比：全部买入都是 famous 集团 100 / 等额带 5 跟单 0.5 → 50（实际 ${i1b.famousGroupBuyPct}/${i1b.bundleBuyPct}）`);
  // G5 集中度 null 臂：无跟单钱包（跟单 Σ=0）→ null（D 通道触发=famous 本人直接控盘）
  const i1c = buildSnapshotFromRows([
    mkF(10, 'buy', 0.5, FAM),
    mkF(71, 'buy', 0.5, w2),
  ], microMeta, { famousRoster: roster }).derived;
  ok(i1c.famousFollowerPct === 0 && i1c.famousFollowerTop3Pct === null,
    `无跟单（窗外独立买）→ top3=null（实际 follower ${i1c.famousFollowerPct}/top3 ${i1c.famousFollowerTop3Pct}）`);
  ok(i1c.famousGroupBuyPct === 50 && i1c.bundleBuyPct === null,
    `i1c 无跟单 → 集团买=FAM 本人 0.5/1.0=50；两笔等额 2 钱包<3 无合格簇 → bundleBuy=null（实际 ${i1c.famousGroupBuyPct}/${i1c.bundleBuyPct}）`);
  ok(!buildCheatState(buildSnapshotFromRows([
    mkF(10, 'buy', 0.5, FAM),
    mkF(71, 'buy', 0.5, w2),
  ], microMeta, { famousRoster: roster })).state.includes('簇买入占比'), 'state 渲染：无合格簇 → 无簇买入占比行（缺席不渲染）');

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
    delete c.famousFollowerTop3Pct;
    delete c.famousGroupBuyPct;
    return c;
  };
  ok(JSON.stringify(stripFamous(noRoster)) === JSON.stringify(stripFamous(i1))
    && noRoster.famousDominanceLevel === null && noRoster.famousDominancePct === null
    && noRoster.famousFollowerTop3Pct === null && noRoster.famousGroupBuyPct === null,
    '空名单注入：famous 族（含 G5 跟单 top3 键）全 null 且其余 derived 键 bit 一致');
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

  // ═══════════════ H2. interpret 透传（D3.35 事故现场反证：runner 侧 gradeObservation
  // 吃 interpret 产物（run.mjs），CD135 全量首跑 interpret 漏 participation 键 →
  // 128 票 real_participation 全 null + R 通道结构性失明（Jev 答案在 answersRaw 里却进不了 grade）；
  // D3.39 键改名 abnormalBehavior 后事故防线原样承接 ════════════════
  console.log('H2. interpret 透传 abnormalBehavior（CD135 事故反证，D3.39 改名承接）');
  const { interpret } = await import(path.join(__dirname, 'cheat-detection/lib.mjs'));
  const { gradeObservation: grObserv } = require('../src/market-analysis/cheat-grade.js');
  const mkObs = (bucket) => ({
    phenomena: {}, extLevels: {}, activityLevel: { bucket: 'mid', prob: 0.5 },
    bundledDominance: { bucket: 'mid', prob: 0.5 }, anchors: {},
    ...(bucket === undefined ? {} : { abnormalBehavior: { bucket, prob: 0.7 } }),
  });
  ok(interpret(mkObs('dominant')).abnormalBehavior?.bucket === 'dominant',
    'interpret 透传 abnormalBehavior（dominant 进得来——首跑事故=此键被 interpret 吞掉）');
  ok(interpret(mkObs('negligible')).abnormalBehavior?.bucket === 'negligible'
    && interpret(mkObs('unclear')).abnormalBehavior?.bucket === 'unclear',
    'interpret 透传全桶位（negligible/unclear 同径）');
  ok(interpret(mkObs(undefined)).abnormalBehavior === null,
    'obs 无 abnormalBehavior 键 → null（<D3.39 旧档断代形状）');
  const viaInterp = grObserv(interpret(mkObs('dominant')), {});
  ok(viaInterp.grade === 'unhealthy' && viaInterp.reasons.some((x) => x.code === 'R_abnormal_dominant'),
    '经 interpret 的 R 通道可触发（runner grade 链路事故反证：修前此断言必挂——dominant 经 interpret 应落 unhealthy R_abnormal_dominant）');
  const viaInterpClean = grObserv(interpret(mkObs('negligible')), {});
  ok(viaInterpClean.grade === 'healthy' && !viaInterpClean.reasons.length,
    '经 interpret 的 negligible 不触发 R（clean）');
  ok(interpret(null) === null, 'interpret(null) → null 不变');

  // ═══════════════ I2. 题集结构（D3.39：14 题=4 现象+sbw+tiering+bw+activity_level+bd+insider+pump+wash+holdings+abnormal_behavior_ratio） ═══════════════
  console.log('I2. 题集结构 D3.39（ESM 题文件经动态 import）');
  const qm = await import(path.join(__dirname, '..', 'src/market-analysis/llm/cheat-questions.mjs'));
  ok(qm.CHEAT_QUESTIONS_VERSION === 'D3.46', `版本常量 D3.46（实际 ${qm.CHEAT_QUESTIONS_VERSION}——D3.46=B1 剩余批次 CD102 捞回（用户裁定「看看好不好捞回来」：机器 healthy 漏检归因=abr 平手线 noticeable 0.43 vs dominant 0.40 差 0.03——3 秒窗 12 个一次性钱包齐到（8 户挤同块=单块买 33.2%、0.0693×3 精确等额）、异常段流量 0.8967/1.54≈58% 与 dominant 样本「近六成」同量级，但波内多数落 0.0495-0.0792=0.05 档滑点后实付带，被判读要点②反锚「前端默认档聚集只是常见形态之一」读成默认档中性剔除；churn 仅 33% D3.44 两头倒臂不适用）：判读要点②补默认档聚集中性前提边界（中性前提=沿时间散布各自进场；同一秒级窗内整批一次性钱包以默认档/近额档齐到=「齐」非「散」，档位常见不豁免节奏异常）+dominant 样本一补 3 秒 12 户齐到实形；反例防线=MAI 0.1 档 62 钱包 80 分钟匀速长尾（散布句保护）/RAM 同块金额各异撞块（近额带不满足不触新句）；D3.45=D3.44 对拍后第三刀（CD88 仍 pump=moderate@0.51 strong 0.30 归因=豁免句已解锁但 Jev 以「+16% 温吞爬涨幅小」压档、D3.24 至今幅度锚定）：豁免臂补幅度锚（「大额窜升段占金额+尘埃垫推段占笔数」组合的推价组织性来自量级结构两端异常不取决于涨幅大小、温吞爬同样是垫量缓推勿以涨幅小压档）；D3.44=批次三第二组三票裁定（CD61「这个活跃度是明显不正常的，过高的活跃度看一下，我认为至少给 unhealthy，甚至 cheat」/CD88「是 cheat 无疑，尽量让 pump 能捕捉到吧」/CD137「这也是一个单向 pump 票」）：三票共同缺口=拉高出货全周期形状无人承载——CD61 峰 +276%（t+9s）→回撤 83.5%+尾段卖多买少+62% 钱包双向 churn 被 pump 反锚⑤「双向活跃=市场合力」读成合力盘（pump=none@0.64）；CD88=35 笔 0.0001 尘埃垫推+0.6 大额窜升正中 D3.24 豁免句但句带「整盘低活跃度低额度」前提、D3.25 把 act 修到 mid 后前提不满足大户豁免臂复活（pump strong 0.36 差一线）；CD137=75 钱包 100% 全员双向 churn+峰 +180% 后连续纯卖段砸去 69% 被排除项「像样回撤不选本题」+反锚双向活跃双压（pump=none@0.59）——①pump 反锚⑤加价格结构腿（合力反锚只保护价格轨迹健康的合力盘：峰后回撤过半参考 ≥50% 或收尾段集中纯卖出货=拉高出货形状，双向活跃恰是出货通道不是合力证据，反锚不触发可 strong）②pump 排除项「像样回撤不选本题」加拉高出货例外（深回撤是砸盘出货不是健康起伏）③pump strong 载体补拉高出货全周期第三形状（价格轨迹沿 [TICKS] 直接可读不经彼题判读；大比例钱包既买又卖短窗双向进出是佐证）④D3.24 豁免句去「整盘低活跃度低额度」前提改纯跟风量级判读（中位尘埃级即落、整盘活跃度档位高低不构成前提；反例 CD84 中位 0.05 正常量级保护不动）⑤abr 前提③补拉高出货全周期例句+判读要点③补全员双向 churn 两头倒（CD61 过高活跃度异常的承载=abr 异常比例，act 题保持活跃度定档职责不判异常）；D3.43=CD53 二刀（大户进场豁免臂补跟风主体=阵列限定+伪装散买句括号扩同块齐到+正例贴 CD53 实形）；D3.42=CD53 一刀（排除项真抢筹合力限定+⑤豁免臂伪装散买句+strong 载体补紧凑接力+MAI 同档长尾划界）；D3.41=批次二三题补维度+五新锚；D3.40=撤冷寂突袭；D3.39=理念重构+abr 改名无罪推定+G13 R 通道；D3.38/D3.37/D3.36/D3.35 同前）`);
  // D3.27：activity_level ⑥停滞突发反锚（burst 不判低）——题面文本锁定（用户裁定
  // 「流量 burst 命中的不要判定为活跃度 low」；配对 G2 E 通道简化）
  {
    const actQ = qm.buildCheatQuestions().activity_level;
    ok(/停滞突发反锚（burst 不判低）/.test(actQ.instructions), 'D3.27 activity ⑥停滞突发反锚在场（burst 不判低）');
    ok(/不判低/.test(actQ.instructions) && /中档起判/.test(actQ.instructions), 'burst 形状不判低+按中档起判（措辞锚）');
    ok(/停滞突发形状.*不适用本档/.test(actQ.criteria.low), 'criteria.low 排除停滞突发形状');
  }
  // D3.40：第 14 题撤「冷寂期突袭」异常形状（用户裁定——节奏归 sbw 题、现象中性、
  // 涌入流量是否作弊看其自身形状）——题面措辞锁定：正向例句不回潮+中性反锚在场
  {
    const abrQ = qm.buildCheatQuestions().abnormal_behavior_ratio;
    ok(!/冷寂期之后一个区块突然塞进大量交易|冷寂期突现密集块/.test(abrQ.instructions + abrQ.criteria.dominant),
      'D3.40 冷寂突袭正向例句不回潮（instructions+criteria.dominant 全文反证）');
    ok(/冷寂期后一波涌入」本身是中性节奏、不计异常/.test(abrQ.instructions)
      && /停滞突发题单独判/.test(abrQ.instructions),
      'D3.40 中性反锚在场（死寂后来量不计异常份额+节奏归停滞突发题单独判）');
  }
  // D3.41：批次二裁定三题补维度——题面措辞锁定（跨块闭环句/簇流通行引用/笔数联判句）
  {
    const q41 = qm.buildCheatQuestions();
    const csbQ = q41.coordinated_sell_back;
    ok(csbQ.instructions.includes('闭环不要求买卖同块')
      && csbQ.instructions.includes('「簇买→同块卖回闭环」行是代码按同一口径算好的联立事实'),
      'D3.41 coordinated_sell_back 跨块闭环句在场（对倒的时间平移版+簇闭环行代码算好直接采信）');
    ok(csbQ.instructions.includes('协同的是「同一批钱包既一起买又一起卖」的联立，不是单纯同块卖'),
      'D3.41 卖侧撞块反锚在场（高活跃盘不同批次各自离场≠闭环——买卖双联立才是协同）');
    ok(csbQ.instructions.includes('五组等额簇全部闭环'),
      'D3.41 CD20 正例在场（23 秒开盘窗五簇跨块闭环密集阵列版）');
    const hbQ = q41.holdings_balance;
    ok(hbQ.instructions.includes('捆绑簇持仓集中度」行')
      && hbQ.instructions.includes('捆绑簇垄断在场流通到量级（参考 ≥60%）'),
      'D3.41 holdings_balance 簇维度在场（新 state 行引用+量级参考与早期盘口径同尺）');
    ok(hbQ.instructions.includes('跨块长时段匀速流入的默认档长尾=整档跟风散户'),
      'D3.41 RAM/MAI 防误伤反锚在场（跨块匀速长尾默认档簇不构成垄断证据腿）');
    const bwQ = q41.same_block_buy_wave;
    ok(bwQ.instructions.includes('单块笔数节奏形状（D3.41）')
      && bwQ.instructions.includes('笔数单独看是噪音'),
      'D3.41 same_block_buy_wave ⑦单块笔数形状在场（笔数远超常态=节奏异常但须与占比/结构联判）');
  }
  // D3.42：pump 题补「伪装散买接力推价」形状（批次三 CD53 质询失效修复）——
  // 题面措辞锁定：首波爆发划出限定/豁免臂伪装散买句/strong 载体/MAI 长尾反锚
  {
    const pumpQ = qm.buildCheatQuestions().slow_grind_pump.instructions;
    ok(pumpQ.includes('该划出只保护真抢筹合力形状（买入金额连续散布、钱包各自独立进场、有零散真实买盘穿插）')
      && pumpQ.includes('不属首波爆发抢筹，仍在本题口径内按组织性推价判读'),
      'D3.42 排除项首波爆发划出加真抢筹合力限定（伪装散买阵列接力仍在本题口径——CD53 盲区修复）');
    ok(pumpQ.includes('推价流若由一批只用一次的全新钱包以相同/近同金额紧凑推进（同块一波齐到逐笔抬价，或短窗跨块紧凑接力')
      && pumpQ.includes('不走大户进场豁免、仍按本题口径给档、可 strong'),
      'D3.42/D3.43 ⑤豁免臂补伪装散买句（一次性全新钱包同额紧凑推进含同块齐到≠正常量级真散户跟风，不豁免可 strong）');
    ok(pumpQ.includes('带动的「跟风」主体若不是金额连续散布、各自独立择时的真散户单')
      && pumpQ.includes('组织性跟风阵列不是市场合力，按组织性推价口径给档、可 strong'),
      'D3.43 大户进场豁免臂补跟风主体=阵列限定（CD53 归因：Jev 误用 0.6 大单进场豁免罩同块等额阵列跟风——主体是阵列则豁免不成立）');
    ok(pumpQ.includes('同额档位跨长时段匀速零散到达、每笔间隔松散自然的=前端默认档整档跟风长尾'),
      'D3.42 MAI 防误伤时间形状划界在场（同档≠接力——跨长时段匀速长尾是跟风不算紧凑接力）');
    ok(pumpQ.includes('一批一次性全新钱包同额/近额紧凑接力；同块/等额阵列与固定节拍'),
      'D3.42 strong 组织性推价载体补伪装散买接力（与同一钱包多笔连推并列）');
    ok(pumpQ.includes('正·开盘段伪装散买推价，D3.42/D3.43')
      && pumpQ.includes('同一区块内 10 个互不重复、只用一次的全新钱包各买 0.1000 精确等额'),
      'D3.42/D3.43 正例补 CD53 实形在场（创建者 0.6 建仓+同块 10×0.1000 一次性钱包阵列+开盘段不落排除项）');
    ok(pumpQ.includes('同档长尾跟风（反，D3.42）')
      && pumpQ.includes('时间形状是整档跟风长尾不是紧凑接力'),
      'D3.42 反例补 MAI 型同档长尾在场（档位同但时间松散=不给档）');
    // 存量防线：D3.29/D3.23/D3.24 校准句不因本次修改回退
    ok(pumpQ.includes('无须判断锚窗之后是否「窜完即止」（锚窗截断看不到窗后走势，该判断不可执行）'),
      'D3.29 排除项窗内可判句保留（限定句叠加不替换）');
    ok(pumpQ.includes('「单钱包连推」须同一钱包多笔连续主动买入逐笔推价'),
      'D3.23 连推定义收紧句保留（大户单笔+真散买合力语义不动）');
    ok(pumpQ.includes('跟风若以海量尘埃级买单为主'),
      'D3.24 尘埃垫推量级限定句保留（CD88 路径不动）');
  }
  // D3.44：pump 题拉高出货全周期四刀 + abr 题补形状（批次三第二组 CD61/CD88/
  // CD137 三裁定）——题面措辞锁定：反锚价格结构腿/排除项例外/strong 第三形状/
  // 豁免句去整盘前提/正例 CD137+CD61 实形/abr 前提③+判读③；存量反证=旧
  // 「整盘低活跃度低额度」前提不回潮
  {
    const q44 = qm.buildCheatQuestions();
    const pump44 = q44.slow_grind_pump.instructions;
    ok(pump44.includes('本反锚只保护价格轨迹健康的合力盘')
      && pump44.includes('恰是出货通道（接拉升与接砸盘的是同一批手），不是市场合力证据，反锚不触发'),
      'D3.44 pump 反锚⑤价格结构腿在场（峰后回撤过半/集中纯卖收尾=拉高出货形状，双向活跃是出货通道非合力证据，反锚不触发可 strong）');
    ok(pump44.includes('拉高出货全周期例外：深回撤是砸盘出货不是健康起伏、纯卖收尾不是获利卖回'),
      'D3.44 pump 排除项「像样回撤不选本题」加拉高出货例外（CD137 被排除项双压归因修复）');
    ok(pump44.includes('或拉高出货全周期形状（窗内先数倍单向拉升、随后峰后深回撤过半或收尾段集中纯卖出货')
      && pump44.includes('沿 [TICKS] 逐笔价格直接可读，不经彼题判读'),
      'D3.44 pump strong 载体补拉高出货全周期第三形状（价格轨迹直接可读不经彼题判读；「本题不自行判读买盘结构」限定仍只覆盖组织性形状）');
    ok(pump44.includes('判据只看跟风盘自身量级，整盘活跃度档位高低不构成前提')
      && !pump44.includes('整盘低活跃度低额度'),
      'D3.44 D3.24 豁免句去「整盘低活跃度低额度」整盘前提（CD88 归因：act 修到 mid 后前提不满足致豁免臂复活；纯跟风量级判读——反证断言旧前提短语全文不回潮）');
    ok(pump44.includes('正·低额度尘埃垫推，D3.44 起不论整盘活跃度档'),
      'D3.44 CD88 正例标签同步去整盘前提（题内自洽）');
    ok(pump44.includes('正·拉高出货全周期，D3.44')
      && pump44.includes('75 个钱包全员既买又卖短窗双向进出、几乎无一次性新钱包=同一批手两头倒'),
      'D3.44 正例补 CD137 实形在场（全员 churn+峰后纯卖段砸去近七成+全程收跌）');
    ok(pump44.includes('开盘 9 秒窜至近四倍后深回撤逾八成、尾段转为卖多买少的出货段'),
      'D3.44 正例补 CD61 实形在场（数倍拉升+深回撤+出货段收尾同窗完成）');
    const abr44 = q44.abnormal_behavior_ratio.instructions;
    ok(abr44.includes('短窗内完成「数倍拉升→峰后深回撤→集中纯卖出货」的拉高出货全周期')
      && abr44.includes('正常获利回吐有买盘承接、回撤浅，与砸盘出货的深回撤+纯卖段不同'),
      'D3.44 abr 前提③补拉高出货全周期例句（与正常获利回吐划界：买盘承接+回撤浅 vs 深回撤+纯卖段）');
    ok(abr44.includes('整批钱包既买又卖短窗双向进出的两头倒（接拉升与接砸盘的是同一批手）'),
      'D3.44 abr 判读要点③补全员双向 churn 两头倒（CD61「过高活跃度」的承载=abr 异常比例；act 题保持定档职责）');
  }
  // D3.45：CD88 幅度锚（D3.44 对拍后仍 moderate@0.51 归因=Jev 以涨幅小压档）——
  // 豁免臂补「组织性来自量级结构两端异常、不取决于涨幅大小」锚
  {
    const pump45 = qm.buildCheatQuestions().slow_grind_pump.instructions;
    ok(pump45.includes('推价的组织性来自量级结构两端异常（大额非常态、尘埃亦非常态、中间正常量级真散户买近乎缺席），不取决于涨幅大小')
      && pump45.includes('数分钟十余个百分点的温吞爬同样是垫量缓推，勿以涨幅小压档'),
      'D3.45 pump 豁免臂补幅度锚（CD88 归因：+16% 两分钟温吞爬被涨幅小压档——组合形状组织性看量级结构不看涨幅）');
  }
  // D3.46：CD102 捞回（B1 剩余批次，abr 平手线归因=0.05 档滑点带被默认档中性剔除）
  {
    const abr46 = qm.buildCheatQuestions().abnormal_behavior_ratio.instructions;
    ok(abr46.includes('默认档聚集的**中性前提是沿时间散布各自进场**（不同时刻各自决策、跨块匀速长尾）')
      && abr46.includes('形状是「齐」不是「散」，档位常见不豁免节奏异常，该段按异常段计份额'),
      'D3.46 abr 判读要点②补默认档聚集中性前提边界（CD102 归因：3 秒 12 个一次性钱包 0.05 档滑点带齐到+8 户同块=异常段流量 58% 却被默认档反锚剔除——沿时间散布才是中性前提；MAI 80 分钟匀速长尾由散布句保护）');
    ok(abr46.includes('另一票开盘 3 秒内 12 个一次性钱包齐到、其中 8 户挤同一块、多数落 0.05 档滑点后实付带')
      && abr46.includes('默认档不豁免节奏异常：沿时间散布的默认档长尾才是中性'),
      'D3.46 abr dominant 样本一补 CD102 实形（3 秒齐到段吃掉窗口买入近六成=异常主体；反锚句内嵌保护散布长尾）');
  }
  ok(JSON.stringify(qm.ACTIVITY_LEVELS) === JSON.stringify(['low', 'mid', 'high', 'ultra']),
    'ACTIVITY_LEVELS 导出=独立档域四桶（mapper 同名常量对齐）');
  ok(JSON.stringify(qm.BUNDLED_LEVELS) === JSON.stringify(['low', 'mid', 'high']),
    'BUNDLED_LEVELS 导出=捆绑题独立档域三桶（mapper 同名常量对齐）');
  ok(JSON.stringify(qm.STALL_BURST_LEVELS) === JSON.stringify(['none', 'burst']),
    'STALL_BURST_LEVELS 导出=停滞突发波现象二分桶域（D3.11 退回只判有无；mapper 同名常量对齐）');
  ok(JSON.stringify(qm.ABNORMAL_BEHAVIOR_LEVELS) === JSON.stringify(['negligible', 'noticeable', 'dominant', 'unclear']),
    'ABNORMAL_BEHAVIOR_LEVELS 导出=异常行为占比独立档域四桶（D3.39 改名重构；mapper 同名常量对齐）');
  ok(qm.PARTICIPATION_LEVELS === undefined,
    'PARTICIPATION_LEVELS 导出已随 D3.39 改名退役（旧常量不得残留——断代防线）');
  const qs = qm.buildCheatQuestions();
  const qids = Object.keys(qs);
  ok(qids.length === 14
    && ['equal_amount_split', 'coordinated_sell_back', 'creator_front_run', 'sell_dispersion', 'stall_burst_wave', 'amount_tiering', 'same_block_buy_wave', 'activity_level', 'bundled_trade_dominance', 'insider_supply_sell', 'slow_grind_pump', 'wash_pair', 'holdings_balance', 'abnormal_behavior_ratio']
      .every((id) => qids.includes(id)),
    '14 题=存续 4 现象题 + stall_burst_wave + amount_tiering + same_block_buy_wave + activity_level + bundled_trade_dominance + insider_supply_sell + slow_grind_pump + wash_pair + holdings_balance + abnormal_behavior_ratio（D3.39 改名——D3.35 立项交易者角色综合题，判读方向翻转为异常占比无罪推定）');
  ok(qs.real_participation === undefined,
    '旧题 id real_participation 不得残留（D3.39 改名=换键，旧档答案键缺席容缺断代）');
  // D3.37/D3.38/D3.39：abnormal_behavior_ratio（D3.39 前名 real_participation）题面措辞锚（用户裁定反证——误导表述不得回潮）
  {
    const rpQ = qs.abnormal_behavior_ratio;
    ok(rpQ.instructions.includes('本题的判断窗口是代币刚发出后的很短时间（开盘打新段）')
      && rpQ.instructions.includes('创建者第一笔买入可能就很大（开盘建仓），这些本身都是正常形态'),
      'D3.37 前提③开盘打新段语境在场（判断窗口=刚发出极短时间，抢筹/创建者首笔大单正常——用户裁定原话锚，D3.39 平移保留）');
    ok(rpQ.instructions.includes('众数落在哪一档不是判据')
      && rpQ.instructions.includes('好盘不一定众数落默认档'),
      'D3.37 要点②众数档位非判据在场（真实盘众数可上移——默认档聚集只是常见形态之一，D3.39 平移保留）');
    ok(!rpQ.instructions.includes('真实盘以前端默认档（0.1/0.05）为众数'),
      'D3.37 反证：误导断言「真实盘以前端默认档为众数」不得回潮（好盘不一定众数落默认档——用户裁定原话）');
    ok(rpQ.instructions.includes('参考行（同档金额参考/单块买入集中度）只是参考数值与形状档位'),
      'D3.38 题面参考行清单提及单块买入集中度（换喂法 C——形状档位与数值同列「没有硬标准」域，D3.39 平移保留）');
    // D3.39：无罪推定理念锚（用户裁定原话——本题判读方向的整体翻转）
    ok(rpQ.instructions.includes('判读方向是无罪推定')
      && rpQ.instructions.includes('如果交易序列不能明显看出有问题，那就是正常盘，不需要谁来自证清白'),
      'D3.39 无罪推定开篇在场（无可见异常即正常，不要求参与者证明自己是「真实用户」——用户裁定原话锚）');
    ok(rpQ.instructions.includes('单个区块挤进大量同金额的交易')
      && rpQ.instructions.includes('秒级对倒推价')
      && rpQ.instructions.includes('成批零买入纯卖方'),
      'D3.39 结构性异常形状例句在场（用户裁定原话锚——异常识别的对象形状；冷寂例句已随 D3.40 撤除）');
    ok(!rpQ.instructions.includes('需要证明有真实用户参与')
      && rpQ.instructions.includes('更不是要求参与者证明自己一定是「真实用户」'),
      'D3.39 反证：旧理念「需要证明有真实用户参与」不得作为任务陈述回潮；否定句式在场（更不是要求……——有罪推定方向显式排除）');
  }
  ok(JSON.stringify(qids.slice(0, 4)) === JSON.stringify(['equal_amount_split', 'coordinated_sell_back', 'creator_front_run', 'sell_dispersion'])
    && !EXT_PHENOMENON_IDS.some((id) => qids.slice(0, 4).includes(id)),
    '存续 4 题位序不变且观察题不在核心清单（mapper PHENOMENON_IDS 对齐）');
  for (const [id, q] of Object.entries(qs)) {
    ok(q.type === 'choice' && q.instructions.includes('怎么算') && q.instructions.includes('真实样本'),
      `题 ${id}：choice + 怎么算算法段 + 真实 case 样本段（教学载体=题面）`);
    ok(!/(cheat|unhealthy|healthy|作弊盘|不健康|健康盘)/.test(q.instructions),
      `题 ${id}：instructions 不带 verdict 词汇（防答题被结论锚定）`);
  }
  // 四档域题=存续 4 现象 + tiering/bw/insider/pump/wash/holdings（sbw D3.9 起三分类、act/bd 独立档域另行断言）
  for (const id of [...PHENOMENON_IDS, 'amount_tiering', 'same_block_buy_wave', 'insider_supply_sell', 'slow_grind_pump', 'wash_pair', 'holdings_balance']) {
    ok(qm.PHENOMENON_LEVELS.every((b) => typeof qs[id].criteria[b] === 'string')
      && Object.keys(qs[id].criteria).length === qm.PHENOMENON_LEVELS.length,
      `题 ${id}：criteria 键集=PHENOMENON_LEVELS 四档（mapper 档位序锁死）`);
  }
  ok(qm.STALL_BURST_LEVELS.every((b) => typeof qs.stall_burst_wave.criteria[b] === 'string')
    && Object.keys(qs.stall_burst_wave.criteria).length === 2,
    'stall_burst_wave：criteria 键集=STALL_BURST_LEVELS 现象二分桶域（D3.11 收缩）');
  // D3.21：题名「缓慢拉盘」→「持续推价」+ 第三形状「秒级密集推价」+ 合力与推手反锚；id 不断代（344 行锁）
  ok(qs.slow_grind_pump.instructions.startsWith('观察「持续推价」现象'),
    'D3.21 pump 题首句=「持续推价」（题名已改，不再「缓慢拉盘」）');
  ok(qs.slow_grind_pump.instructions.includes('秒级密集推价')
    && qs.slow_grind_pump.instructions.includes('合力与推手反锚')
    && qs.slow_grind_pump.instructions.includes('形状有三种'),
    'D3.21 pump 题三形状（全程缓推/窜一截后缓推/秒级密集推价）+ 合力与推手反锚在场');
  // D3.22：insider 判据②双口径（占比口径÷全部卖出+冲击口径÷全部买入，双高才 strong）
  const ratQ = qs.insider_supply_sell.instructions;
  ok(ratQ.includes('占比口径 = 这类钱包卖出额合计 ÷ 窗口全部卖出额合计')
    && ratQ.includes('冲击口径 = 这类钱包卖出额合计 ÷ 窗口全部买入额合计'),
    'D3.22 insider 判据②双口径分母=全部卖出合计（结构）/全部买入合计（绝对规模）');
  ok(ratQ.includes('给 strong 须两口径都高') && ratQ.includes('至多 moderate、不给 strong'),
    'D3.22 insider 双高才 strong（占比高冲击低→至多 moderate——CD73 归因：占卖压 77% 但对买盘仅 16.6% 价格未受压）');
  ok(ratQ.includes('反·高占比低冲击') && ratQ.includes('占窗口总卖压四分之三以上') && ratQ.includes('不足两成'),
    'D3.22 insider 反例补 CD73 形状（单钱包零买卖占卖压 3/4+、对买盘不足两成）');
  // D3.23：pump ⑤「合力与推手反锚」强化——「单钱包连推」定义收紧+大户单笔进场豁免+高活跃散布反锚（组 16 CD84 质询）
  const pumpQ = qs.slow_grind_pump.instructions;
  ok(pumpQ.includes('「单钱包连推」须同一钱包多笔连续主动买入逐笔推价')
    && pumpQ.includes('大户单笔/极少笔大额进场') && pumpQ.includes('「大户进场+市场合力」不是连推'),
    'D3.23 pump ⑤连推定义收紧=同一钱包多笔连续主动买入（大户单笔进场不论占比=市场合力不是连推——CD84 归因：t1 单笔 1.7189 占买 37.4%）');
  ok(pumpQ.includes('开盘早期获利卖少致买卖失衡是自然的，不必「买卖两旺」才触发本反锚')
    && pumpQ.includes('买盘跨多数区块连续出现（几乎每块都有成交）'),
    'D3.23 pump ⑤反锚触发条件放宽：买卖两旺→持续活跃+跨块连续+金额散布（开盘早期失衡自然——CD84 卖仅 2 笔反锚原不触发）');
  ok(pumpQ.includes('大户进场的高热盘') && pumpQ.includes('36 笔买分布在 15 个区块几乎每块都有成交')
    && pumpQ.includes('不是「单钱包连推」，不给 strong'),
    'D3.23 pump 反例补 CD84 形状（单笔 1.7 大额+12 秒 15 块连续散买=大户进场市场合力）');
  // D3.24：pump ⑤大户进场豁免臂加「跟风量级」限定（组 17 CD88 质询）——正常量级（中位 ≥0.005）散买走豁免至多 moderate；尘埃垫推（中位 ~0.0001）＝「低活跃度低额度持续推价」不走豁免可 strong
  ok(pumpQ.includes('正常量级**散买跟风（笔均/中位 ≥0.005 量级、金额连续散布的真散户单）')
    && pumpQ.includes('是「大户进场+市场合力」不是连推，同样至多 moderate'),
    'D3.24 pump ⑤豁免臂量级限定=正常量级（≥0.005）散买跟风才走大户进场豁免（至多 moderate）');
  ok(pumpQ.includes('跟风若以海量尘埃级买单为主（中位 ~0.0001 级、几乎不占金额、靠笔数堆叠垫价')
    && pumpQ.includes('仍按本题口径给档、可 strong，不走大户进场豁免'),
    'D3.24 pump ⑤尘埃垫推不豁免＝「低额度持续推价」仍按本题口径可 strong（CD88 归因：57 笔中位 0.0001 垫量缓推；D3.44 起句尾整盘前提改「判据只看跟风盘自身量级」）');
  ok(pumpQ.includes('另票（正·低额度尘埃垫推，D3.44 起不论整盘活跃度档——判据只看跟风盘自身量级）：大户单笔 0.6（占买近半）首块窜升一截')
    && pumpQ.includes('随后 57 笔尘埃买（中位 0.0001、合计仅 0.7）垫量缓推 2 分余钟')
    && pumpQ.includes('卖侧 12 笔中 10 笔亦为尘埃卖（无自然获利回吐）')
    && pumpQ.includes('两端都不是正常量级真散户跟风'),
    'D3.24 pump 正例二补 CD88 实数（大额窜升段+尘埃垫推段组合形状——t1 单笔 0.6 占买 46.1%、价 +14% 回撤 2.9%）');
  ok(pumpQ.includes('（**中位 0.05 量级=正常量级跟风，非尘埃垫推**）'),
    'D3.24 pump 反例 CD84 标注量级（中位 0.0493=正常量级真散户跟风，与尘埃垫推划界）');
  // D3.26：pump ⑤前半句反锚给「活跃」补标准（CD88 pump 未翻 strong 第二轮——Jev 笔数口径判活跃致反锚误触发）
  ok(pumpQ.includes('本反锚的「持续活跃」以金额吞吐为准（与「活跃度」题⑤同口径）')
    && pumpQ.includes('窗口总交易额（买+卖）÷ 窗口分钟数达密集盘量级（参考 ≥10 BNB/分钟）才满足「持续活跃」前提'),
    'D3.26 pump ⑤「持续活跃」标准=金额吞吐（≥10 BNB/分钟才满足前提——与 act 题⑤同口径，用户裁定「活跃的标准是什么，这个是不是要给清楚」）');
  ok(pumpQ.includes('笔数密集、空窗短但金额吞吐尘埃级（参考 <1 BNB/分钟＝尘埃单堆笔数的假活跃）的盘不满足前提、不触发本反锚、不按市场合力豁免')
    && pumpQ.includes('那恰是本题观察的垫量缓推形状，按本题口径给档'),
    'D3.26 pump ⑤假活跃不触发反锚（CD88 吞吐 0.66 尘埃级=本题垫量缓推主体，反锚不豁免可 strong）');
  ok(pumpQ.includes('「金额连续散布」「跨块连续」两腿同样以正常量级真金白银为证据（笔均/中位 ≥0.005 量级的真散户单）')
    && pumpQ.includes('尘埃单的散布与跨块垫价不构成合力证据'),
    'D3.26 pump ⑤散布/跨块两腿同加正常量级限定（57 笔尘埃跨 47 块不构成合力证据）');
  // D3.28：同块对敲题（批次二 CD27 用户裁定「对倒交易非常严重，如有必要可能需要增加锚」
  // +落法两裁定「独立对敲题」「≥60% 且 ≥3 对 → cheat」）——现有锚对「对内等额、对外不等额」
  // 对倒失明（eqHold 要带内 ≥3 钱包、bw 要同块多笔买）；题面教逐块配对算法+CD27 正例/CD90 反例
  const washQ = qs.wash_pair.instructions;
  ok(washQ.includes('同一区块内一笔卖出与一笔买入金额几乎相等')
    && washQ.includes('|log(买额/卖额)|≤log(1.02)')
    && washQ.includes('每笔卖出至多配一次'),
    'D3.28 wash_pair 算法段=逐块 ±2% 对数带配对+每卖至多配一次（配对算法定义）');
  ok(washQ.includes('「同块对敲」行是同口径的代码计算值，直接采信'),
    'D3.28 wash_pair 采信 [PRECOMPUTED] 同块对敲行（与 sb/eq 锚同款采信句式）');
  ok(washQ.includes('对数与占比一起看，占比不足不为据'),
    'D3.28 wash_pair 占比条件入题面（对数单独不构成档位依据——CD90 3 对 1.9% 偶发碰撞反方向防线）');
  ok(washQ.includes('买方常为只用一次的新钱包、节奏多轮复现、卖方高度集中'),
    'D3.28 wash_pair 反向鉴别=一次性新钱包+多轮复现+卖方集中（vs 真实接获利卖买方持有）');
  ok(washQ.includes('连续 9 个区块、每块卖出一笔') && washQ.includes('四位小数相等的金额买回')
    && washQ.includes('占窗口全部卖出的 95%'),
    'D3.28 wash_pair 正例=CD27 形状（9 块逐块等额买回+95% 卖占比+价格推高近一倍）');
  ok(washQ.includes('3 对同块近额买卖') && washQ.includes('只占全部卖出的 1.9%'),
    'D3.28 wash_pair 反例=CD90 形状（3 对 1.9% 偶发碰撞不给档）');
  ok(qs.wash_pair.criteria && qm.PHENOMENON_LEVELS.every((b) => typeof qs.wash_pair.criteria[b] === 'string'),
    'D3.28 wash_pair criteria=四档域（EXT 容缺通道，档位序与 mapper 对齐）');
  // D3.32：持仓均衡题（批次五 CD122 用户裁定「给 Jev 增加 持仓均衡 门吧。注意总供应量
  // 占比最重要，第二 CD122 的 top2 不是单一钱包，而是捆绑簇。需要利用 Jev 的能力处理
  // 复杂情况」）——组合垄断（单一独大/前二/第1大∪簇并集三口径参考 40%）+主口径占总供应量%
  // +同源协同迹象定档腿；CD122/CD69 正例+CD84 跟车/CD104 流通虚高反例
  const holdQ = qs.holdings_balance.instructions;
  ok(holdQ.includes('主口径=占总供应量%'),
    'D3.32 holdings_balance 主口径=占总供应量%（用户裁定原话——流通口径早期虚高只辅助）');
  ok(holdQ.includes('单一钱包独大 / 前二合计 / 第1大与簇并集') && holdQ.includes('参考 ≥40% 总供应量'),
    'D3.32 holdings_balance 组合垄断三口径（单一/前二/并集）参考量级 40%（与 I 通道 40 同尺度）');
  ok(holdQ.includes('同源协同迹象') && holdQ.includes('紧邻背靠背进场=同一部署')
    && holdQ.includes('快进快出倒仓') && holdQ.includes('进场即部分离场的对冲形状'),
    'D3.32 holdings_balance 协同迹象四腿（首买相差数秒/簇成员/快进快出/二大买入反超持仓更小——CD122 T2 实形）');
  ok(holdQ.includes('第二大占总供应 <3% 且占在场流通不高只是普通跟车大户') && holdQ.includes('强庄分持不是同源组合'),
    'D3.32 holdings_balance 反锚=top2<3% 跟车组合不成立（CD84）+独立进场强庄分持不误伤（D3.35 补「占在场流通不高」限定——早期盘反锚以流通口径为前提）');
  ok(holdQ.includes('占在场流通 66% 但占总供应量 31.6%、窗口已过早期（在场流通与供应同量级）'),
    'D3.32 holdings_balance 反例=CD104 流通虚高形状（流 66.5/供 31.6——D3.35 补「窗口已过早期」适用域：在场流通口径只对早期盘有效，中后期回主口径）');
  ok(holdQ.includes('同块 6 钱包捆绑簇成员') && holdQ.includes('并集占总供应 40.1%')
    && holdQ.includes('3 秒后即卖出持仓一半'),
    'D3.32 holdings_balance 正例=CD122 形状（并集 40.1%+簇成员+快进快出+买入反超）');
  ok(holdQ.includes('一笔 5.17 BNB 买入吃走 4.65 亿枚=总供应量 46.5%'),
    'D3.32 holdings_balance 正例=CD69 形状（单一独大 46.5%）');
  ok(holdQ.includes('总供应量未知时本题缺主口径') && holdQ.includes('不给档'),
    'D3.32 holdings_balance 供应缺失=fail-open 不给档（口径缺席不判）');
  // D3.29：批次三 CD41/CD42/CD45 误伤裁定（方案 A+B 均「采纳（a+b 全上）」）——
  // ①bw ⑥第二支口子（同额带被当阵列证据+无占比约束）；②pump 排除项「窜完即止」
  // 窗内不可执行 + ⑤升档参考绕过市场合力反锚的口子
  const bwQ = qs.same_block_buy_wave.instructions;
  ok(bwQ.includes('金额散布或同额/近额带聚集（同额在打新段有多重自然来源')
    && bwQ.includes('不要求净额反推为整十名义')
    && bwQ.includes('每钱包单笔、买后持有'),
    'D3.29 bw ⑥第一支扩展=同额/近额带聚集+每钱包单笔（同额多重自然来源白名单不可枚举，不要求整十名义反推——CD42 0.1645×12 实为 0.168 档未被识别）');
  ok(!bwQ.includes('非整数名义额同额×多钱包'),
    'D3.29 bw ⑥第二支删「非整数名义额同额×多钱包」独立证据位（开盘段同额×独立tx×单笔不构成阵列证据）');
  ok(bwQ.includes('同 tx 打包 / 每钱包多笔多档固定组合 / 同批钱包同块成对节拍多轮复现'),
    'D3.29 bw ⑥组织性结构三条保留（同tx打包/多笔多档固定组合/同批钱包多轮复现）');
  ok(bwQ.includes('金额各异的同块=独立买家撞块常态') && bwQ.includes('一笔 0.25 与两笔 0.1 各自独立决策撞进同块')
    && bwQ.includes('不因同块而加档'),
    'D3.34 bw 撞块反锚=同块金额各异各自独立定价=无协同含义不加档（RAM 7746 例 0.2500/0.1037/0.1086 实形——CD133 用户裁定「同块同额度误伤可能小一些，可以作为参考」的对偶面）');
  ok(bwQ.includes('同块∧近等额（时间+金额双协同'),
    'D3.34 bw 组织性结构第四条=同块∧近额双协同参考性（与 eq 题同判据——单纯同块或单纯近额都不够）');
  ok(bwQ.includes('买入额合计占窗口全部买入不足两成时不给明显及以上档')
    && bwQ.includes('占比不足不为据，小簇刷量是噪声不是主导'),
    'D3.29 bw ⑥占比纪律=结构证据簇占买入不足两成不给明显及以上档（对齐 wash 题——CD42 四钱包簇 2.2%/CD45 五钱包簇 10.5% 小簇不再撑 strong）');
  ok(bwQ.includes('再两开盘打新段近额带形状') && bwQ.includes('精确同额 0.1645')
    && bwQ.includes('0.25/0.16/0.08 三条近额带'),
    'D3.29 bw 反例补 CD42/CD45 近额带形状（同额带×独立tx×单笔持有+小簇同买同卖=不给明显及以上档）');
  ok(pumpQ.includes('无须判断锚窗之后是否「窜完即止」（锚窗截断看不到窗后走势，该判断不可执行）'),
    'D3.29 pump 排除项改窗内可判=开盘段+整窗连续推进无回落盘整即整窗首波爆发（无须判窗后窜完即止——锚窗截断结构性不可执行）');
  ok(pumpQ.includes('本题不自行判读买盘结构：这些结构以「同块买入波」「等额分仓」等题的判读为准')
    && pumpQ.includes('只有彼题已达明显及以上档的结构才可作本题升档参考'),
    'D3.29 pump ⑤升档参考限定=同块/等额/固定节拍以 bw/eq 题判读为准（CD41 两个自然并发同块波不再绕过市场合力反锚）');
  ok(pumpQ.includes('又一开盘首波爆发形状') && pumpQ.includes('吞吐 21 BNB/分钟')
    && pumpQ.includes('把价格打出约 10% 回撤'),
    'D3.29 pump 反例补 CD41 形状（16s 首波+市场合力四腿全满足+尾部 10% 回撤双重落排除项——不给 strong）');
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
  // D3.25：act 加第五要素「单位时间交易额（金额吞吐）」+③解绑+定档句收紧（CD88 act=high 0.57 误判质询）
  ok(act.includes('⑤单位时间交易额（金额吞吐）') && act.includes('窗口总交易额（买+卖） ÷ 窗口分钟数')
    && act.includes('<1 BNB/分钟=金额死寂') && act.includes('≥10 BNB/分钟才与「高」档的密集相称'),
    'D3.25 act 第五要素=金额吞吐（<1 BNB/分钟死寂/≥10 配高——CD88 实证吞吐 0.66 全表垫底、真 high 票 ≥9.0 差一个数量级）');
  ok(act.includes('笔均尘埃级时以⑤金额吞吐定夺') && act.includes('不因笔数多而豁免（节奏稀疏与否不改变这一判读）'),
    'D3.25 act ③解绑「伴稀疏节奏」——笔均尘埃+吞吐低=假活跃必压档（CD88 笔均 0.0216 被 30 笔/分对冲是判高路径洞之一）');
  ok(act.includes('交易密集、空窗都很短**且金额吞吐与之相称**（参考 ≥10 BNB/分钟） → 高')
    && act.includes('笔数密集但金额吞吐尘埃级（<1 BNB/分钟的假活跃）不入高档'),
    'D3.25 act 定档句收紧：高档须笔数+金额双密集（旧句「空窗都很短 → 高」纯笔数口径=CD88 判高路径终点）');
  ok(act.includes('高档反例·假活跃') && act.includes('金额吞吐约 0.66 BNB/分钟') && act.includes('最大空窗仅 19 秒看似密集'),
    'D3.25 act 高档反例补 CD88 假活跃形状（70 笔/2 分余钟看似密集、吞吐 0.66=同批最低、真高活跃盘十倍以上）');
  ok(act.includes('五要素综合定档'), 'D3.25 act 定档句四要素→五要素（金额吞吐入列）');
  // D3.19 开盘打新段反锚（组 13 双质询：CD62 bw strong / CD66 eq+tier strong 两误伤——扩集
  // anchor=首笔成功买+settle 口径决定锚窗全落开盘段（四票窗首距 token_create 全 0.0s），散户
  // 默认档（净额≈名义×0.98 换算后同档精确重复）+同块并发+各钱包各 1 笔独立 tx 买后持有呈现为
  // 作弊形状；bot 阵列对照=CD67 非整名义精确等额+每钱包两笔两档固定组合+成对块两轮节拍复现）
  const eqq = qs.equal_amount_split.instructions;
  ok(eqq.includes('前端默认档位与打新段反锚（D3.34）') && eqq.includes('0.1/0.05 是散户默认档、0.2/0.25/0.3 是大户常见档')
    && eqq.includes('净额≈名义额×0.98~0.99') && eqq.includes('跨区块聚带的默认档=工具默认值分布，不是组织拆分'),
    'equal_amount_split D3.34 前端默认档位反锚=GMGN 档位表（0.1/0.05 散户默认、0.2/0.25/0.3 大户常见）+净额换算重复+跨块聚带=默认值分布（CD133 用户裁定「GMGN的散户是有默认交易额的……这要是能跨区块，误伤就太大了！」）');
  ok(eqq.includes('跨块长时段匀速流入的同额带') && eqq.includes('整档跟风散户的长尾') && eqq.includes('分仓阵列的时间特征是集中'),
    'equal_amount_split D3.34 时间形状判据=跨块匀速长尾=跟风非分仓（分仓特征是集中——MAI 62 钱包 77 笔跨 80 分钟实形承载）');
  ok(eqq.includes('不给明显及以上档') && eqq.includes('62 钱包 77 笔跨约 80 分钟匀速流入'),
    'equal_amount_split D3.34 反例补 MAI 长尾形状（0.099 档=名义 0.1 默认档整档跟风——时间无集中性=不是分仓阵列，与 D3.19 打新段反锚同向）');
  ok(eqq.includes('非整数名义额的精确等额') && eqq.includes('每钱包多笔多档固定组合') && eqq.includes('同 tx 打包'),
    'equal_amount_split D3.19 判读转向=分仓阵列结构证据（非整名义精确等额/多笔多档固定组合/成对节拍多轮复现/同 tx 打包）');
  ok(eqq.includes('同块∧近等额（时间+金额双协同') && eqq.includes('可作参考性痕迹'),
    'equal_amount_split D3.34 同块∧近等额=双协同参考性痕迹（CD133 裁定「同块同额度误伤可能小一些，可以作为参考」——单纯跨块等额与单纯同块金额各异都不够，双协同才入结构证据清单）');
  ok(eqq.includes('0.0987（名义 0.1）×9 钱包') && eqq.includes('0.2303（名义 0.235）×3'),
    'equal_amount_split D3.19 反例补 CD66 形状（开盘 15 秒窗整数名义档覆盖七成买入、每人恰 1 笔独立 tx 买后持有=散户档位抢购）');
  ok(eqq.includes('0.0631×10 钱包+0.0197×10 钱包') && eqq.includes('名义额非常见整档=配置值'),
    'equal_amount_split D3.19 正例补 CD67 bot 阵列形状（十钱包两轮成对进场每钱包两笔两档固定金额、覆盖 40/43 笔）');
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
  ok(tier.includes('开盘打新段反锚') && tier.includes('净额≈名义×0.98') && tier.includes('即使分层覆盖度高也不给 strong，至多 moderate'),
    'amount_tiering D3.19 开盘打新段反锚=整数名义默认档聚集（每带各钱包各 1 笔独立 tx 买后持有）覆盖度再高也至多 moderate');
  ok(tier.includes('非整数名义档（配置值）') && tier.includes('每钱包多笔跨档固定组合'),
    'amount_tiering D3.19 分层高档只留给分仓阵列结构证据（非整名义配置档/多笔跨档固定组合/多轮节拍复现）');
  ok(tier.includes('反·开盘默认档') && tier.includes('0.0987（名义 0.1）×9 钱包') && tier.includes('散户档位抢购非分层脚本'),
    'amount_tiering D3.19 反例补 CD66 形状（开盘 15 秒窗七成买入落整数名义档、每人恰 1 笔各自独立 tx=打新档位抢购）');
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
  ok(bwq.includes('活跃度/密度反锚') && bwq.includes('同时性本身不构成协同证据') && bwq.includes('至多弱档'),
    'same_block_buy_wave D3.16 加活跃度/密度反锚（高密度热点盘同时性降权、判读转看同 tx 打包/金额同质化——用户裁定「bw 可以加活跃度/密度反锚」）');
  ok(bwq.includes('200+ 笔/分钟') && bwq.includes('27 个尘额钱包') && bwq.includes('不给明显及以上档'),
    'same_block_buy_wave D3.16 反例补高密度盘形状（CD60：三块 27 尘额钱包独立 tx 抢买+三大额 FOMO 同秒抢入=并发流量非协同）');
  ok(bwq.includes('开盘打新段反锚：先看窗口起点') && bwq.includes('散户/狙击抢首发的并发常态') && bwq.includes('不给明显及以上档'),
    'same_block_buy_wave D3.19 开盘打新段反锚=独立 tx+金额散布/默认档+买后持有的同块波，波占比高+节拍复现也不给明显及以上档（CD62 误伤根因=D3.16 ②密度反锚拉不住开盘段纯同时性聚集）');
  ok(bwq.includes('同 tx 打包 / 每钱包多笔多档固定组合 / 同批钱包同块成对节拍多轮复现'),
    'same_block_buy_wave D3.19 判读转向=分仓阵列结构证据（D3.29 收紧：同 tx/固定组合/成对节拍多轮复现三条，「非整数名义额同额×多钱包」独立证据位删除）');
  ok(bwq.includes('13 秒窗约 217 行/分') && bwq.includes('波成员 13 钱包 12 个买后持有'),
    'same_block_buy_wave D3.19 反例补 CD62 形状（13 秒窗 217 行/分四波全独立 tx 金额连续散布、12/13 在场=纯同时性打新并发）');
  ok(bwq.includes('每块恰 5 钱包') && bwq.includes('同额 0.0631 与 0.0197 交替') && bwq.includes('覆盖窗口 40/43 笔买入'),
    'same_block_buy_wave D3.19 正例补 CD67 bot 阵列形状（十钱包两轮同块成对进场、两档同额交替覆盖 40/43 笔=按协同判读）');
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
  ok(rat.includes('缺少买入的卖出') && rat.includes('压根没有买入') && rat.includes('全部来自被转入') && !rat.includes('几乎没有任何买入'),
    'insider_supply_sell D3.18 题名改「缺少买入的卖出」+定义句两类形状（用户修正「有一些有卖出的钱包是压根没有买入的，代币全部来自被转入」——①零买入=代币全部来自被转入 ②买入额远小于卖出额；旧「几乎没有任何买入」含糊措辞退役反证）');
  ok(rat.includes('÷ 窗口全部卖出额合计') && rat.includes('≥25%') && rat.includes('10~25%') && !rat.includes('≥30%') && !rat.includes('10~30%'),
    'insider_supply_sell 显式算式=无买入卖出占比分式（卖出域——与买入域题分式区分）；D3.17 定档参考线 30%→25%（用户裁定「25% 已经非常非常多了」——CD13 35.9% 贴 30% 旧线判 moderate；旧 ≥30%/10~30% 措辞退役反证）');
  ok(rat.includes('来源不限于创建分配') && rat.includes('场外/链下划转'),
    'insider_supply_sell D3.16 证据本体=缺少买入的卖出，来源不限（创建内部分配/场外链下划转皆算——用户裁定「也不局限于创建」）；D3.18 措辞随「被转入」语义改划转');
  ok(rat.includes('筹码是从别的地方划转而来') && rat.includes('隐秘地卖出') && rat.includes('规避对筹码来源的监控') && rat.includes('往往是作弊的特征'),
    'insider_supply_sell D3.16 现象机理句（用户补裁定原话「无买入的卖出钱包，意味着筹码从别的地方划转而来，需要隐秘卖出规避监控，往往是作弊的特征」）');
  ok(rat.includes('筹码并非无成本') && !rat.includes('零成本'),
    'insider_supply_sell D3.16 成本表述纠正（用户裁定「并不是无成本哦」——筹码并非无成本，只是取得不经过本盘买入口径；旧「零成本套现」措辞退役反证）');
  ok(rat.includes('创建者自己的买入与卖出是正常行为') && rat.includes('不构成本题证据、不参与定档'),
    'insider_supply_sell D3.16 创建者正常行为不作证据（用户裁定「创建者买入/卖出都是正常行为，出现 "无买入的卖出" 才是作弊证据」）');
  ok(!rat.includes('组合升档锚') && !rat.includes('三件齐即高档') && !rat.includes('首买占比 ≥25%'),
    'insider_supply_sell D3.10 组合升档锚整体退役（createTx 同笔+首买占比+创建者分批卖不再升档——CD60 healthy 误伤坐实）');
  ok(rat.includes('createTx= 行只作背景') && rat.includes('不作为本题证据或升档条件'),
    'insider_supply_sell createTx= 降为背景行（识别创建者身份用，不作升档条件）');
  ok(rat.includes('同块协同/多轮次') && rat.includes('先买后卖'),
    'insider_supply_sell 倾倒节奏=同块协同/多轮次 + AMM 先买后卖原理锚');
  ok(rat.includes('零买入纯卖出') && rat.includes('总卖出一半'),
    'insider_supply_sell 正例=CD13 形状（八钱包零买入占总卖出一半三组轮次——占比远超 25% 线单轴即 strong，新口径不受影响）');
  ok(rat.includes('创建者先买后卖=正常获利行为不作证据') && rat.includes('不给高档'),
    'insider_supply_sell D3.16 反例=CD60 形状（creator 同笔大额买+递减分批卖=正常获利；无买入卖出占比不足四分之一+散户两旺不给高档——D3.17 措辞随 25% 线同步）');
  ok(qm.PHENOMENON_LEVELS.every((b) => typeof qs.insider_supply_sell.criteria[b] === 'string'),
    'insider_supply_sell：criteria 键集=PHENOMENON_LEVELS 四档（现象强度轴）');
  const pump = qs.slow_grind_pump.instructions;
  ok(pump.includes('单调性') && pump.includes('最大回撤极浅') && pump.includes('参考 <5%'),
    'slow_grind_pump 判据①=单调性（回撤 <5%、新高持续推进、无成串卖回波）');
  ok(pump.includes('买卖失衡') && pump.includes('笔比 ≥5:1 且额比 ≥3:1') && pump.includes('零星获利卖穿插'),
    'slow_grind_pump 判据②=买卖失衡双比阈值（正常上涨段也有零星获利卖穿插的反锚）');
  ok(pump.includes('形状①全程缓推的盘笔均尘埃~小额') && pump.includes('垫量缓推') && pump.includes('形状③短窗内密集连续推进') && pump.includes('持续性'),
    'slow_grind_pump 判据③=三形状各自节奏（缓推小笔/垫量缓推/秒级短窗密集推进，D3.21 三形状化）');
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
  ok(pump.includes('爆发/窜升段之后接续垫量缓推段或秒级密集推进段的，前段归同块波题判读、持续推价段仍在本题口径内'),
    'slow_grind_pump 排除项=窜后接缓推段**或秒级密集推进段**均归本题（D3.21 扩第三形状后口径词「缓慢」→「持续」');
  ok(pump.includes('正·窜一截后缓推') && pump.includes('0.0001 级尘埃买垫量缓推') && pump.includes('最大回撤不足 2%'),
    'slow_grind_pump D3.15 正例补 CD55 两段式形状（同块簇窜升占四成多+十余笔 0.0001 级尘埃买垫推、回撤不足 2%、笔比超 13:1）');
  ok(pump.includes('窜完即止') && pump.includes('无尘埃买垫量缓推段') && pump.includes('纯爆发不属本题'),
    'slow_grind_pump D3.15 反例补窜完即止形状（CD53/CD54 同块簇占比过半数十秒窜完、无垫推段——防误伤划界锚）');
  ok(pump.includes('市场合力而非单向推价') && pump.includes('至多 moderate、不给 strong') && pump.includes('单向死水形状'),
    'slow_grind_pump D3.16 活跃度反锚精神存续于 D3.21 ⑤（高活跃市场合力至多 moderate 不给 strong；CD56 裁定「附属条件是活跃度低，strong 就肯定不行了」——唯组织性推价形状豁免升档通道）');
  ok(pump.includes('合力与推手反锚') && pump.includes('组织性推价形状') && pump.includes('至多 moderate、不给 strong'),
    'slow_grind_pump D3.21 ⑤反锚改写=合力与推手反锚（独立进场合力至多 moderate；组织性阵列/单钱包连推可 strong——CD72 立案）');
  ok(pump.includes('高活跃盘的价格抬升段') && pump.includes('市场合力形状'),
    'slow_grind_pump D3.16 反例补高活跃盘形状（CD56：约 50 笔/分高频盘推进段不给 strong）');

  // ═══════════════ D3.20 单一钱包持仓集中双锚 ═══════════════
  console.log('D3.20 单一钱包持仓集中双锚');
  const wH1 = '0x1111000000000000000000000000000000000a01';
  const wH2 = '0x2222000000000000000000000000000000000a02';
  const wH3 = '0x3333000000000000000000000000000000000a03';
  const holdMeta = { address: '0xhold', symbol: 'H', name: 'H', platform: 'flap', quoteToken: null, createdAt: at(0), creatorAddress: null, totalSupply: 1e9 };
  // 控盘形状（CD69 同构）：w1 一笔吃 500M tok，w2/w3 各 100M → 在场 700M
  const holdRows = [
    mkRow(10, 300, 1, 'buy', 5.1653, 1e-9, { trader: wH1, sender: wH1, tok: 500e6 }),
    mkRow(11, 300, 2, 'buy', 0.1, 1e-9, { trader: wH2, sender: wH2, tok: 100e6 }),
    mkRow(12, 300, 3, 'buy', 0.1, 1e-9, { trader: wH3, sender: wH3, tok: 100e6 }),
  ];
  const hd = buildSnapshotFromRows(holdRows, holdMeta).derived;
  ok(hd.top1HoldSupplyPct === 50, `supplyPct=500M/1e9=50 整（实际 ${hd.top1HoldSupplyPct}）`);
  ok(Math.abs(hd.top1HoldCircPct - 500 / 700 * 100) < 1e-9, `circPct=500/700=71.4286（实际 ${hd.top1HoldCircPct}）`);
  // 豁免形状：w1 仅 50M（supply 5% 低）但 w2 只 1M 在场（circ 98% 高）=前者低后者高可豁免
  const exRows = [
    mkRow(10, 300, 1, 'buy', 0.5, 1e-9, { trader: wH1, sender: wH1, tok: 50e6 }),
    mkRow(11, 300, 2, 'buy', 0.01, 1e-9, { trader: wH2, sender: wH2, tok: 1e6 }),
  ];
  const exd = buildSnapshotFromRows(exRows, holdMeta).derived;
  ok(exd.top1HoldSupplyPct === 5 && Math.abs(exd.top1HoldCircPct - 50 / 51 * 100) < 1e-9,
    `豁免形状数值成立：supply=5% 低 circ=${exd.top1HoldCircPct.toFixed(2)}% 高（在场筹码少所致）`);
  // 卖出减仓入净额：w1 买 500M 卖 300M → 净 200M=supply 20%
  const partRows = holdRows.concat([mkRow(13, 300, 4, 'sell', 3.0, 1e-9, { trader: wH1, sender: wH1, tok: 300e6 })]);
  const pd = buildSnapshotFromRows(partRows, holdMeta).derived;
  ok(pd.top1HoldSupplyPct === 20, `卖出减仓后 supplyPct=200M/1e9=20（实际 ${pd.top1HoldSupplyPct}）`);
  // fail-closed：totalSupply 缺失 → supplyPct null（circPct 照算，两口径分离）
  const noSup = buildSnapshotFromRows(holdRows, { ...holdMeta, totalSupply: null }).derived;
  ok(noSup.top1HoldSupplyPct === null && Math.abs(noSup.top1HoldCircPct - 500 / 700 * 100) < 1e-9,
    'totalSupply 缺失 → supplyPct null fail-closed、circPct 照算（不以常数冒充）');
  // 行缺 token_amount 列（存量调用方）→ 两键 null（posTokTotal=0 无可归因）
  const noTok = buildSnapshotFromRows(microRows, { ...microMeta, totalSupply: 1e9 }).derived;
  ok(noTok.top1HoldSupplyPct === null && noTok.top1HoldCircPct === null,
    '行缺 token_amount 列 → 双锚 null（缺证据不冒充，防旧调用方静默失真）');
  // router 伪钱包 tok 不入分子：router 行 900M tok（sender 未解析）+ w1 100M
  const routerTokRows = [
    mkRow(10, 300, 1, 'buy', 9.0, 1e-9, { trader: ROUTER, sender: null, tok: 900e6 }),
    mkRow(11, 300, 2, 'buy', 0.1, 1e-9, { trader: wH1, sender: wH1, tok: 100e6 }),
  ];
  const rd2 = buildSnapshotFromRows(routerTokRows, holdMeta).derived;
  ok(rd2.top1HoldSupplyPct === 10, `router 伪钱包 900M tok 不入分子（top1=w1 100M=10%，实际 ${rd2.top1HoldSupplyPct}）`);
  // state 渲染三态
  const stHold = buildCheatState(buildSnapshotFromRows(holdRows, holdMeta));
  ok(stHold.state.includes('单一钱包持仓集中度: 占总供应量 50.0% / 占在场流通 71.4%'),
    'state 渲染：两口径齐备行（占总供应量/占在场流通）');
  ok(stHold.state.includes('占总供应量低但占在场流通高=在场筹码少所致，不算控盘（豁免）'),
    'state 渲染：豁免判读句随锚行（用户裁定原话语义）');
  const stNoSup = buildCheatState(buildSnapshotFromRows(holdRows, { ...holdMeta, totalSupply: null }));
  ok(stNoSup.state.includes('单一钱包持仓集中度: 总供应量未知') && stNoSup.state.includes('仅流通口径不作控盘判据'),
    'state 渲染：supply 缺失降级行（不作控盘判据 fail-closed）');
  const stEmpty = buildCheatState(buildSnapshotFromRows([mkRow(10, 300, 1, 'sell', 0.1, 1e-9, { trader: wH1, sender: wH1, tok: 10e6 })], holdMeta));
  ok(stEmpty.state.includes('单一钱包持仓集中度: 无正净持仓'),
    'state 渲染：无正净持仓降级行');

  // ═══════════════ D3.32 持仓分布锚族（G7 J 通道 holdings_balance 数值源）═══════════════
  console.log('D3.32 持仓分布锚族（前二/簇/并集占总供应量%+前二首买相差秒+前三钱包行为）');
  // holdRows 手算：posSorted=[wH1 500M, wH2 100M, wH3 100M]；三行全 block 300=
  // 同块簇成员 {wH1,wH2,wH3}（≥3 笔买同块）→ 簇合计=并集=700M/1e9=70
  ok(hd.top2HoldSupplyPct === 10, `top2 供=100M/1e9=10 整（实际 ${hd.top2HoldSupplyPct}）`);
  ok(hd.top1Top2HoldSupplyPct === 60, `前二合计=600M/1e9=60 整（实际 ${hd.top1Top2HoldSupplyPct}）`);
  ok(hd.top1Top2FirstBuyGapSec === 1, `前二首买相差=|11-10|=1 秒（实际 ${hd.top1Top2FirstBuyGapSec}）`);
  ok(hd.clusterHoldSupplyPct === 70 && hd.t1PlusClusterSupplyPct === 70,
    `同块簇合计=700M/1e9=70；t1∈簇 → 并集同 70（实际 ${hd.clusterHoldSupplyPct}/${hd.t1PlusClusterSupplyPct}）`);
  ok(Array.isArray(hd.holdingsProfile) && hd.holdingsProfile.length === 3
    && hd.holdingsProfile[0].supplyPct === 50 && hd.holdingsProfile[0].netTok === 5e8
    && hd.holdingsProfile[0].buyBnb === 5.1653 && hd.holdingsProfile[0].firstBuyBlock === 300
    && hd.holdingsProfile[0].firstSellDt === null
    && hd.holdingsProfile[1].netTok === 1e8 && hd.holdingsProfile[2].w === wH3,
    `holdingsProfile 前三钱包形状（净持/供应%/买入额/首买块/首卖缺席；实际 ${JSON.stringify(hd.holdingsProfile?.[0]?.supplyPct)}/${hd.holdingsProfile?.length} 键）`);
  ok(stHold.state.includes('持仓分布: 第1大 0x1111…0a01: 占总供应量 50.0% / 占在场流通 71.4%（净持 500.00M），买 5.165×1 / 卖 0.0000×0，首买@t+10s（块 300）'),
    'state 渲染：持仓分布前三钱包行（占总供应量%+占在场流通%（D3.35 双口径）+净持+买卖+首买块）');
  ok(stHold.state.includes('前两大合计占总供应量 60.0%（首买相差 1 秒）'),
    'state 渲染：前二合计行+首买相差秒（组合垄断叙事）');
  ok(!stHold.state.includes('同块簇∪等额簇成员正净合计'),
    'state 渲染：簇合计+并集句已撤（CD133/G11 同裁定——sb∪eq 簇口径死指标退场，holdings_balance 题档与 holdings 五锚照常承载 J 通道）；前二合计行保留（单一口径无簇圈定）');
  // 快进快出：w1 卖 300M@sec13 → 首卖距首买 3 秒行（CD122 T2「3 秒后卖一半」实形）
  const stPart = buildCheatState(buildSnapshotFromRows(partRows, holdMeta));
  ok(stPart.state.includes('首卖距首买 3 秒'),
    'state 渲染：首卖距首买秒数（快进快出叙事——CD122 T2 3 秒卖一半实形）');
  ok(Math.abs(buildSnapshotFromRows(partRows, holdMeta).derived.top1HoldSupplyPct - 20) < 1e-9,
    'D3.32 与 D3.20 同分子源：卖出减仓后 top1 供=20 一致（posSorted 共享）');
  // 无合格簇退化：两钱包不同块不同额 → 簇键 null（缺席不渲染）但前二键照算
  ok(exd.clusterHoldSupplyPct === null && exd.t1PlusClusterSupplyPct === null
    && exd.top1Top2HoldSupplyPct === 5.1 && exd.top2HoldSupplyPct === 0.1,
    `无合格簇 → 簇/并集 null（实际 ${exd.clusterHoldSupplyPct}/${exd.t1PlusClusterSupplyPct}）；前二键独立照算 5.1/0.1（实际 ${exd.top1Top2HoldSupplyPct}/${exd.top2HoldSupplyPct}）`);
  ok(!buildCheatState(buildSnapshotFromRows(exRows, holdMeta)).state.includes('同块簇∪等额簇成员正净合计'),
    'state 渲染：无合格簇 → 无簇合计短语（缺席不渲染）');
  // supply 缺失：组合口径全 null + 降级行（fail-open 不判档防线）
  ok(noSup.top2HoldSupplyPct === null && noSup.top1Top2HoldSupplyPct === null
    && noSup.clusterHoldSupplyPct === null && noSup.t1PlusClusterSupplyPct === null,
    'totalSupply 缺失 → 持仓分布四键全 null（组合口径缺席不冒充）');
  ok(stNoSup.state.includes('总供应量未知，前几大组合占比口径缺失'),
    'state 渲染：供应缺失降级行（题面「不给档」的 state 侧对偶）');
  // 唯一持仓退化（router 伪钱包已剔）：仅 1 正净持有人 → 前二键 null、profile 单行；
  // 2 笔同块不成簇（<3）→ 并集轴缺席 null（不退化为 top1 自身——单一口径另有覆盖）
  ok(rd2.top2HoldSupplyPct === null && rd2.top1Top2HoldSupplyPct === null
    && rd2.t1PlusClusterSupplyPct === null && Array.isArray(rd2.holdingsProfile) && rd2.holdingsProfile.length === 1,
    `单正净持有人（router 900M 已剔）→ 前二键 null、不成簇并集轴缺席 null、profile 单行（实际 t2=${rd2.top2HoldSupplyPct} 并集=${rd2.t1PlusClusterSupplyPct} profile=${rd2.holdingsProfile?.length}）`);

  // ═══════════════ G8（批次六，2026-11-02）：burst 波强度两键 + 零买入纯卖方锚 ═══════════════
  console.log('G8 burst 波强度两键+零买入纯卖方锚（E 弱 burst 臂/K·L 通道数值源）');
  {
    // g8Rows 手算（CD5 分仓出货+弱 burst 合成形状）：
    //   纯卖方 wS1/wS2/wS3（零买入）卖 1.00+0.80+0.29=2.09；wN 买 0.5 卖 0.91、
    //   wB1 买 0.3 卖 0.3（买卖兼有=非纯卖方）→ 总卖 3.30、noBuySellPct=
    //   2.09/3.30=63.3%、noBuySellWallets=3；wP 买 2.5 纯持仓（买入侧对照）
    //   burst 波：sec78-82 六笔（wB2 同秒两笔）Σ买 0.30+0.30+0.20+0.12+0.05+
    //   0.05=1.02、去重钱包 5（<13）；最长停滞 13→78=65s（≥60）——弱 burst 三键
    //   全中（E 通道联测见 _test_cheat_grade G8 段）；sec10-13 五笔窗（3.09>1.02）
    //   被六笔波窗以笔数压过=「最密按笔数取」口径锁定
    const wS1 = '0x5100000000000000000000000000000000000051';
    const wS2 = '0x5200000000000000000000000000000000000052';
    const wS3 = '0x5300000000000000000000000000000000000053';
    const wN = '0x5400000000000000000000000000000000000054';
    const wP = '0x5500000000000000000000000000000000000055';
    const wB1 = '0x6100000000000000000000000000000000000061';
    const wB2 = '0x6200000000000000000000000000000000000062';
    const wB4 = '0x6400000000000000000000000000000000000064';
    const wB5 = '0x6500000000000000000000000000000000000065';
    const wB6 = '0x6600000000000000000000000000000000000066';
    const g8Rows = [
      mkRow(0, 500, 0, 'buy', 2.5, 1e-9, { trader: wP, sender: wP }),
      mkRow(10, 501, 0, 'sell', 1.00, 1e-9, { trader: wS1, sender: wS1 }),
      mkRow(11, 501, 1, 'sell', 0.80, 1e-9, { trader: wS2, sender: wS2 }),
      mkRow(12, 502, 0, 'sell', 0.29, 1e-9, { trader: wS3, sender: wS3 }),
      mkRow(13, 503, 0, 'buy', 0.50, 1e-9, { trader: wN, sender: wN }),
      mkRow(13, 503, 1, 'sell', 0.91, 1e-9, { trader: wN, sender: wN }),
      mkRow(78, 600, 0, 'buy', 0.30, 1e-9, { trader: wB1, sender: wB1 }),
      mkRow(79, 601, 0, 'buy', 0.30, 1e-9, { trader: wB2, sender: wB2 }),
      mkRow(79, 601, 1, 'buy', 0.20, 1e-9, { trader: wB2, sender: wB2 }),
      mkRow(81, 603, 0, 'buy', 0.12, 1e-9, { trader: wB4, sender: wB4 }),
      mkRow(82, 604, 0, 'buy', 0.05, 1e-9, { trader: wB5, sender: wB5 }),
      mkRow(82, 604, 1, 'buy', 0.05, 1e-9, { trader: wB6, sender: wB6 }),
      mkRow(100, 700, 0, 'sell', 0.30, 1e-9, { trader: wB1, sender: wB1 }),
    ];
    const g8Snap = buildSnapshotFromRows(g8Rows, microMeta);
    const g8 = g8Snap.derived;
    ok(g8.noBuySellPct === 63.3 && g8.noBuySellWallets === 3 && g8.noBuySellBnb.toFixed(2) === '2.09',
      `零买纯卖锚精确值：3 户 Σ2.09/总卖 3.30=63.3%（实际 ${g8.noBuySellPct}/${g8.noBuySellWallets} 户/${g8.noBuySellBnb}——买卖兼有钱包不进分子）`);
    ok(g8.burstWaveBuyBnb === 1.02 && g8.burstWaveWallets === 5,
      `burst 波两键精确值：最密 5s 窗（六笔压过五笔窗）Σ买 1.02/去重 5 钱包（实际 ${g8.burstWaveBuyBnb}/${g8.burstWaveWallets}——同钱包两笔计一）`);
    ok(g8.maxGapSec === 65,
      `最长停滞 13→78=65s（实际 ${g8.maxGapSec}——grade 侧锚名 burstMaxGapSec 同一度量）`);
    // state 数值行（D3.33 state-only）：占全部卖出 % + 判读交 insider 题（不带性质标签）
    const stG8 = buildCheatState(g8Snap);
    ok(stG8.state.includes('零买入纯卖方: 3 个钱包（窗内零买入、只卖出）合计卖出 2.090 BNB，占全部卖出 63.3%')
      && stG8.state.includes('由你结合 insider_supply_sell 判断'),
      'state 渲染：零买入纯卖方数值行（D3.33——判档仍 Jev）');
    // mapper 键域：四新锚回显 + 未传 null 容缺（旧档断代 fail 方向在 grade 侧测）
    const g8Obs = buildObservation(mkAnswers(), { noBuySellPct: 65.3, burstMaxGapSec: 65, burstWaveBuyBnb: 1.02, burstWaveWallets: 5 });
    ok(g8Obs.anchors.noBuySellPct === 65.3 && g8Obs.anchors.burstMaxGapSec === 65
      && g8Obs.anchors.burstWaveBuyBnb === 1.02 && g8Obs.anchors.burstWaveWallets === 5,
      'mapper 回显 G8 四新锚（E/K/L 通道同源数值）');
    // 空窗 null 语义：单笔买入票 → 波两键/纯卖全 null（<2 有效 dt 波形状不可评；
    // 总卖=0 无卖出证据不评）+ state 不渲染行（缺席语义）
    const oneSnap = buildSnapshotFromRows([mkRow(0, 800, 0, 'buy', 0.1, 1e-9)], microMeta);
    const one = oneSnap.derived;
    ok(one.burstWaveBuyBnb === null && one.burstWaveWallets === null && one.noBuySellPct === null
      && one.noBuySellWallets === 0,
      `单笔票全 null（实际 ${one.burstWaveBuyBnb}/${one.burstWaveWallets}/${one.noBuySellPct}——绝不冒充）`);
    ok(!buildCheatState(oneSnap).state.includes('零买入纯卖方'),
      'state 渲染：总卖=0 → 零买纯卖方行缺席');
  }

  // ═══════════════ D3.35（CD135，2026-11-02）：协同买入参考四键 + 创建者曾持峰值锚 ═══════════════
  console.log('D3.35 协同买入参考四键+创建者曾持峰值锚（real_participation/holdings_balance 补腿）');
  {
    // d35a 主形状手算（CD6 单块挤买 + CD10 创建者清仓合成）：
    //   买块 100（wCr 0.9975）/200（wP 0.20）/300（wA/B/C 各 0.10+wD 0.30=4 笔 0.60）；
    //   总买 1.7975 → maxBlock=块300 4 笔、占比 0.60/1.7975=33.4%、preGap=30-20=10s
    //   （前一买块 200 firstDt=at(20)）；金额档 toFixed(4)：0.1000 档 3 钱包/共 6 买钱包=
    //   50.0%；wCr 净 0（买 500M 卖 500M）→ creatorPeak=500e6 峰值/1e9=50.00
    const wCr = '0x9900000000000000000000000000000000000099';
    const wA2 = '0xa1000000000000000000000000000000000000a1';
    const wB2 = '0xa2000000000000000000000000000000000000a2';
    const wC2 = '0xa3000000000000000000000000000000000000a3';
    const wD2 = '0xa4000000000000000000000000000000000000a4';
    const wP2 = '0xa5000000000000000000000000000000000000a5';
    const d35Meta = { address: '0xd35c', symbol: 'D35', name: 'D35', platform: 'flap', quoteToken: null, createdAt: at(0), creatorAddress: wCr, totalSupply: 1e9 };
    const d35a = [
      mkRow(5, 100, 0, 'buy', 0.9975, 1e-9, { trader: wCr, sender: wCr, tok: 500e6 }),
      mkRow(20, 200, 0, 'buy', 0.20, 1e-9, { trader: wP2, sender: wP2, tok: 180e6 }),
      mkRow(30, 300, 0, 'buy', 0.10, 1e-9, { trader: wA2, sender: wA2, tok: 90e6 }),
      mkRow(30, 300, 1, 'buy', 0.10, 1e-9, { trader: wB2, sender: wB2, tok: 90e6 }),
      mkRow(30, 300, 2, 'buy', 0.10, 1e-9, { trader: wC2, sender: wC2, tok: 90e6 }),
      mkRow(30, 300, 3, 'buy', 0.30, 1e-9, { trader: wD2, sender: wD2, tok: 270e6 }),
      mkRow(90, 700, 0, 'sell', 0.80, 1e-9, { trader: wCr, sender: wCr, tok: 500e6 }),
    ];
    const d35Snap = buildSnapshotFromRows(d35a, d35Meta);
    const d35 = d35Snap.derived;
    ok(d35.maxBlockBuyCount === 4 && d35.maxBlockBuyPct === 33.4 && d35.maxBlockPreGapSec === 10,
      `四键主形状精确值：最大单块 4 笔/占比 33.4%/前摇 10s（实际 ${d35.maxBlockBuyCount}/${d35.maxBlockBuyPct}/${d35.maxBlockPreGapSec}——CD6「死寂后单块挤买」形状）`);
    ok(d35.sameAmountWalletPct === 50.0,
      `同档金额钱包占比=0.1000 档 3/6=50.0（实际 ${d35.sameAmountWalletPct}——toFixed(4) 四位粒度无尘门）`);
    ok(d35.creatorPeakHoldSupplyPct === 50.0 && d35.creatorWallet === wCr
      && d35.creatorBuyBnb === 0.9975 && d35.creatorBuyN === 1
      && d35.creatorSellBnb === 0.80 && d35.creatorSellN === 1,
      `创建者曾持峰值=500M/1e9=50.00+行为摘要（实际 ${d35.creatorPeakHoldSupplyPct}/${d35.creatorWallet} 买${d35.creatorBuyBnb}×${d35.creatorBuyN}/卖${d35.creatorSellBnb}×${d35.creatorSellN}——CD10「开盘最大单后清仓」正净口径失明补腿）`);
    // holdingsProfile circPct：Σ正=270+180+90×3=720M；wD 流 37.5/供 27、wP 流 25
    const hp0 = d35.holdingsProfile[0];
    ok(hp0.w === wD2 && hp0.supplyPct === 27 && hp0.circPct === 37.5
      && d35.holdingsProfile[1].w === wP2 && d35.holdingsProfile[1].circPct === 25,
      `holdingsProfile 在场流通口径（Σ正=720M：wD 供 27/流 37.5、wP 流 25——早期盘垄断的正确度量）`);
    // state 渲染：同档金额参考行 + 创建者句 + 前三行双口径
    const stD35 = buildCheatState(d35Snap);
    ok(stD35.state.includes('同档金额参考: 最大同档金额的钱包去重占全部买入钱包 50.0%')
      && stD35.state.includes('同档聚集可以来自前端默认交易额（0.1/0.05 档）等真实来源，但真实盘不必然聚档、众数落在哪一档不是判据')
      && !stD35.state.includes('使真实散户盘天然聚档'),
      'state 渲染：同档金额参考行（D3.36 保留键+D3.37 措辞去误导——「天然聚档」必然性预设不得回潮，众数档位不是判据）');
    ok(stD35.state.includes('单块买入集中度: 最大单块买入占窗口总买入【三成以上，高度集中段】（此前有短暂静默）')
      && stD35.state.includes('高活跃盘与开盘打新段单块多为独立买家并发（撞块常态）')
      && !/\d/.test((stD35.state.match(/单块买入集中度[^\n]*/) || [''])[0])
      && !stD35.state.includes('33.4') && !stD35.state.includes('间隔 10 秒'),
      'state 渲染：单块形状档位行在场+整行零数字（D3.38 换喂法 C——三成以上档+短暂静默档可见，行内占比/笔数/前摇秒数伪精度不得回潮：CD104 58.7%/CD60 12 笔锚定源）');
    ok(stD35.state.includes('占总供应量 27.0% / 占在场流通 37.5%'),
      'state 渲染：持仓分布行双口径（供/流并列——D3.35 补腿）');
    ok(stD35.state.includes('创建者已不在前三（曾持峰值占总供应量 50.00%，买 0.998×1 / 卖 0.800×1）'),
      'state 渲染：创建者曾持有句（净 0 不在前三——正净口径失明补腿）');
    // d35b 边界形状：首买块 preGap=null + block 缺失买行不进单块统计
    const d35bRows = [
      mkRow(10, 500, 0, 'buy', 0.10, 1e-9, { trader: wA2, sender: wA2 }),
      mkRow(11, 500, 1, 'buy', 0.10, 1e-9, { trader: wB2, sender: wB2 }),
      mkRow(12, 500, 2, 'buy', 0.10, 1e-9, { trader: wC2, sender: wC2 }),
      mkRow(50, null, 0, 'buy', 0.10, 1e-9, { trader: wP2, sender: wP2 }),
      mkRow(60, 500, 3, 'sell', 0.30, 1e-9, { trader: wD2, sender: wD2 }),
    ];
    const d35b = buildSnapshotFromRows(d35bRows, { ...d35Meta, creatorAddress: null }).derived;
    ok(d35b.maxBlockBuyCount === 3 && d35b.maxBlockBuyPct === 75.0 && d35b.maxBlockPreGapSec === null,
      `首买块 preGap=null（开盘首块无前摇证据非 0 秒——实际 ${d35b.maxBlockPreGapSec}）；block 缺失买行资金照计不进单块统计（count=3 非 4、pct=0.30/0.40=75.0——实际 ${d35b.maxBlockBuyCount}/${d35b.maxBlockBuyPct}）`);
    ok(d35b.sameAmountWalletPct === 100.0,
      `全 0.1000 档 4/4=100.0（实际 ${d35b.sameAmountWalletPct}——block 缺失行同档照计）`);
    ok(d35b.creatorPeakHoldSupplyPct === null && d35b.creatorWallet === null,
      `creatorAddress 缺失 → 峰值锚+摘要全 null（实际 ${d35b.creatorPeakHoldSupplyPct}/${d35b.creatorWallet}——fail-closed）`);
    const stD35b = buildCheatState(buildSnapshotFromRows(d35bRows, { ...d35Meta, creatorAddress: null })).state;
    ok(stD35b.includes('单块买入集中度: 最大单块买入占窗口总买入【三成以上，高度集中段】（该块为首个买块，无前摇证据）')
      && !stD35b.includes('75.0'),
      'state 渲染：d35b 首买块前摇语义档（D3.38——preGap null=无前摇证据定性句，75.0 精确占比缺席）');
    // d35c 无买入票：count=0 其余 null、参考行缺席、创建者纯卖无 BUY 行=null
    const d35cRows = [
      mkRow(10, 500, 0, 'sell', 0.30, 1e-9, { trader: wCr, sender: wCr, tok: 300e6 }),
    ];
    const d35c = buildSnapshotFromRows(d35cRows, d35Meta).derived;
    ok(d35c.maxBlockBuyCount === 0 && d35c.maxBlockBuyPct === null && d35c.maxBlockPreGapSec === null
      && d35c.sameAmountWalletPct === null,
      `无买入票：count=0 其余全 null（实际 ${d35c.maxBlockBuyCount}/${d35c.maxBlockBuyPct}/${d35c.sameAmountWalletPct}）`);
    ok(d35c.creatorPeakHoldSupplyPct === null,
      `创建者纯卖（无 BUY 行）→ 峰值锚 null（实际 ${d35c.creatorPeakHoldSupplyPct}——链外转入域 swap 不可见，绝不以 0 冒充「从未持有」）`);
    const stD35c = buildCheatState(buildSnapshotFromRows(d35cRows, d35Meta)).state;
    ok(!stD35c.includes('同档金额参考') && !stD35c.includes('单块买入集中度'),
      'state 渲染：无买入 → 参考行缺席（同档+单块形状行同门——maxBlockBuyPct null 不渲染）');
    // d35d 并列取额大：两块各 2 笔，块 600 Σ0.50 vs 块 800 Σ0.30 → max=块 600
    const d35d = buildSnapshotFromRows([
      mkRow(10, 600, 0, 'buy', 0.25, 1e-9, { trader: wA2, sender: wA2 }),
      mkRow(10, 600, 1, 'buy', 0.25, 1e-9, { trader: wB2, sender: wB2 }),
      mkRow(20, 800, 0, 'buy', 0.15, 1e-9, { trader: wC2, sender: wC2 }),
      mkRow(20, 800, 1, 'buy', 0.15, 1e-9, { trader: wP2, sender: wP2 }),
    ], d35Meta).derived;
    ok(d35d.maxBlockBuyPct === 62.5,
      `并列笔数取买入额大者（0.50/0.80=62.5 非 37.5——实际 ${d35d.maxBlockBuyPct}）`);
    // mapper：abnormalBehavior 档域读取四形状 + anchors 五键透传/容缺（独立档域题
    // 不走 phAns 四档构造——与 actAns/bdAns 同款 abrAns；D3.39 改名=换键：
    // real_participation 旧答案键不映射（语义镜像不可比），abnormal_behavior_ratio 在场才读档）
    const abrAns = (bucket, p = 0.7) => {
      const rest = (1 - p) / 3;
      return { type: 'choice', choice: bucket, probabilities: Object.fromEntries(ABNORMAL_BEHAVIOR_LEVELS.map((b) => [b, b === bucket ? p : rest])) };
    };
    const pObs = buildObservation({ ...mkAnswers(), abnormal_behavior_ratio: abrAns('dominant') },
      { maxBlockBuyCount: 8, maxBlockBuyPct: 58.8, maxBlockPreGapSec: 412, sameAmountWalletPct: 66.7, creatorPeakHoldSupplyPct: 35.2 });
    ok(pObs.abnormalBehavior && pObs.abnormalBehavior.bucket === 'dominant' && Math.abs(pObs.abnormalBehavior.prob - 0.7) < 1e-9,
      'mapper abnormalBehavior 在场答案 argmax 读档（独立顶层键——非 EXT 通道）');
    ok(pObs.participation === undefined,
      'mapper 旧顶层键 participation 不得残留（D3.39 改名=换键——obs 产物只产 abnormalBehavior）');
    ok(pObs.anchors.maxBlockBuyCount === 8 && pObs.anchors.maxBlockBuyPct === 58.8
      && pObs.anchors.maxBlockPreGapSec === 412 && pObs.anchors.sameAmountWalletPct === 66.7
      && pObs.anchors.creatorPeakHoldSupplyPct === 35.2,
      'mapper anchors 五键透传（G13 R 通道/holdings_balance 同源数值）');
    ok(buildObservation(mkAnswers(), {}).abnormalBehavior === null,
      'mapper abnormalBehavior 缺题（<D3.39 旧档）→ null 容缺（黄金集重放零变化防线）');
    ok(buildObservation({ ...mkAnswers(), real_participation: { type: 'choice', choice: 'minimal_genuine', probabilities: { minimal_genuine: 1 } } }, {}).abnormalBehavior === null,
      'mapper 旧题 id real_participation 答案在场不映射（D3.39 断代——换键非别名，镜像语义不可比）');
    let pThrew = false;
    try {
      buildObservation({ ...mkAnswers(), abnormal_behavior_ratio: { type: 'choice', probabilities: { super_dominant: 1 } } }, {});
    } catch { pThrew = true; }
    ok(pThrew, 'mapper abnormalBehavior 未知桶 super_dominant → throw（档域校验——ABNORMAL_BEHAVIOR_LEVELS 同步防线）');
    ok(JSON.stringify(ABNORMAL_BEHAVIOR_LEVELS) === JSON.stringify(['negligible', 'noticeable', 'dominant', 'unclear']),
      'mapper ABNORMAL_BEHAVIOR_LEVELS 导出对齐题集（negligible/noticeable/dominant/unclear 四桶）');
  }

  console.log(`\n✅ _test_cheat_detection_lib 全过（${passed} 断言）`);
})().catch((e) => { console.error(`\n❌ ${e?.stack || e}`); process.exit(1); });
