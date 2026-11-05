/**
 * 公共聚合路由合约地址集（trader_address=msg.sender 层；0x1de460 GMGN 案 2026-09-30）
 * GMGN BSC 聚合路由（代理 0x1de460f3…4bc，1810 万 tx）：flap 27.9% 成交行 trader 落此
 * 合约——真实买家在 tx.from（sender_address）。router 主导盘 = 散户热度/bot 蜂拥盘
 * （8aca25e2 对拍：翻案 174 票假想 TP -8.566 BNB、亏率 66%），显式化为 routerPct 因子。
 *
 * 2026-10-11 从 EarlyParticipantCheckService 抽出为单一真相源：TPA GMGN 用户剔除
 * （FA `_walletRoutedBuyBnb` / TokenPositionAnalyzer 触发门+top20 剔除+主导盘豁免）
 * 与 EarlyParticipantCheckService routerPct 因子共用此集。扩展路由名单只改此处。
 *
 * 2026-11-05 扩录 8 址（CD350 流量画像侦察，182 实证判据=trader 恒此合约 ∧ 零自
 * sender 行 ∧ sender 跨票几十个不同用户 EOA=与 GMGN 同构的公共聚合入口；0x9689992f
 * 一址即参与 94+ 票）。用户裁定放行：tradesRouterPct 已不用于买入策略，口径可改。
 * 消费面（全部为「识别聚合器」语义的正确扩大）：FA tradesRouterPct 分子+
 * `_walletRoutedBuyBnb`（TPA 用户判定，语义从 GMGN 用户扩为聚合器用户）、
 * EarlyParticipantCheckService legacy routerPct、cheat/buy-point snapshot 伪钱包剔除、
 * cheat N 通道 routerEntryBuyPct 门（G17）。灰区未录（证据不足）：0x99999999…fa5a
 * （8 sender 但 12 行自 sender）、0x7bb8175b…6666（2 sender）。
 */
const AGGREGATOR_ROUTER_ADDRS = new Set([
  '0x1de460f363af910f51726def188f9004276bf4bc', // GMGN swap 路由（BSC）
  '0x9689992f5b5c09447f15906d8d11214944488341', // 2026-11-05 补录：聚合路由（94+ 票）
  '0x3508dca95a64c9378cb07ef6f40553a50905372a', // 同批补录
  '0xd36b6d646ac6e23672e9eedec558164c7f2d6deb', // 同批补录
  '0x9e698d361bb2375bd335dad156accbbad45bf364', // 同批补录
  '0x01a21c857a3219991fba2b1a2824b1b758966b54', // 同批补录
  '0x296b00198dc7ec3410e12da814d9267bb8df506a', // 同批补录
  '0x90497450f2a706f1951b5bdda52b4e5d16f34c06', // 同批补录
  '0x168303a96a767e2a6b2e00cb862eb95e416f72fa', // 同批补录
]);

module.exports = { AGGREGATOR_ROUTER_ADDRS };
