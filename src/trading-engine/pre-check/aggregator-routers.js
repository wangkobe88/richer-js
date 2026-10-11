/**
 * 公共聚合路由合约地址集（trader_address=msg.sender 层；0x1de460 GMGN 案 2026-09-30）
 * GMGN BSC 聚合路由（代理 0x1de460f3…4bc，1810 万 tx）：flap 27.9% 成交行 trader 落此
 * 合约——真实买家在 tx.from（sender_address）。router 主导盘 = 散户热度/bot 蜂拥盘
 * （8aca25e2 对拍：翻案 174 票假想 TP -8.566 BNB、亏率 66%），显式化为 routerPct 因子。
 *
 * 2026-10-11 从 EarlyParticipantCheckService 抽出为单一真相源：TPA GMGN 用户剔除
 * （FA `_walletRoutedBuyBnb` / TokenPositionAnalyzer 触发门+top20 剔除+主导盘豁免）
 * 与 EarlyParticipantCheckService routerPct 因子共用此集。扩展路由名单只改此处。
 */
const AGGREGATOR_ROUTER_ADDRS = new Set([
  '0x1de460f363af910f51726def188f9004276bf4bc', // GMGN swap 路由（BSC）
]);

module.exports = { AGGREGATOR_ROUTER_ADDRS };
