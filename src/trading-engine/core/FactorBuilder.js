/**
 * 因子构建器
 * 统一管理所有因子的计算逻辑，供多个引擎共享
 *
 * 职责：
 * 1. 构建常规因子（基础因子 + 趋势因子）用于时序数据
 * 2. 构建精简因子（仅基础数据）用于时序数据存储
 * 3. 构建购买前置检查因子用于信号 metadata
 * 4. 从时序数据反序列化常规因子
 */

/**
 * 构建常规因子对象用于记录时序数据
 * 常规因子：代币状态相关的因子，每个K线都有值
 * @param {Object} factorResults - _buildFactors() 返回的完整因子结果
 * @returns {Object} 适合存储到时序数据的常规因子对象
 */
function buildFactorValuesForTimeSeries(factorResults) {
  if (!factorResults) {
    return {};
  }

  return {
    // 基础因子
    age: factorResults.age,
    // 秒口径年龄（= age×60 同源；2026-10-01 裁定改落快照——signals 页因子 chip 直读，
    // 旧信号（无此键）由前端 age×60 推导兜底；旧 FA 无键 → null 不掩盖）
    tokenAgeSec: factorResults.tokenAgeSec ?? null,
    currentPrice: factorResults.currentPrice,
    collectionPrice: factorResults.firstPrice,  // 兼容旧前端
    launchPrice: factorResults.firstPrice,      // 兼容旧前端
    firstPrice: factorResults.firstPrice,
    earlyReturn: factorResults.earlyReturn,
    riseSpeed: factorResults.riseSpeed,
    buyPrice: factorResults.buyPrice,
    // 双时长（2026-10-15 用户裁定）：holdDuration=信号（fire）时刻起算（条件触发口径）；
    // realHoldDuration=成交时刻起算（物理持有）。旧 FA/无仓 → null 不掩盖
    holdDuration: factorResults.holdDuration,
    realHoldDuration: factorResults.realHoldDuration ?? null,
    // 双口径执行键（2026-10-15）：buySignalAt=fire 时刻 ms / buyExecutedAt=成交时刻 ms /
    // buyExecutedPriceBnb=live 余额差法成交价（虚拟/回测 null=执行价即信号价无独立真相）；
    // 顺手补 peakProfitPct/buyPriceBnb 两审计键（P11 回撤臂复盘需要）
    buySignalAt: factorResults.buySignalAt ?? null,
    buyExecutedAt: factorResults.buyExecutedAt ?? null,
    buyExecutedPriceBnb: factorResults.buyExecutedPriceBnb ?? null,
    peakProfitPct: factorResults.peakProfitPct ?? null,
    buyPriceBnb: factorResults.buyPriceBnb ?? null,
    profitPercent: factorResults.profitPercent,
    highestPrice: factorResults.highestPrice,
    highestPriceTimestamp: factorResults.highestPriceTimestamp,
    drawdownFromHighest: factorResults.drawdownFromHighest,
    // 最近一次购买后的最高价相关因子（用于止损/止盈）
    // 注意：这个因子会保存到时序数据库，但回测时会动态计算（类似 profitPercent）
    highestPriceSinceLastBuy: factorResults.highestPriceSinceLastBuy,
    drawdownFromHighestSinceLastBuy: factorResults.drawdownFromHighestSinceLastBuy,
    // 拱形止损（2026-10-06）：持仓期峰值市值 USD——不可从快照因子推导（需 totalSupply+汇率），
    // 落库供 signals 页复盘；旧 FA/未持仓 → null 不掩盖
    peakMarketCapSinceLastBuy: factorResults.peakMarketCapSinceLastBuy ?? null,
    // 最近一次购买后的最高持有者数量相关因子（用于持有者回撤检测）
    highestHolderCountSinceLastBuy: factorResults.highestHolderCountSinceLastBuy,
    holderDrawdownFromHighestSinceLastBuy: factorResults.holderDrawdownFromHighestSinceLastBuy,
    txVolumeU24h: factorResults.txVolumeU24h,
    holders: factorResults.holders,
    // GMGN 用户净持仓占比实时值（2026-10-14 小王子案：TPAPre 快照不翻案换 FA 实时因子）——
    // signals 页/信号复盘直读；旧 FA 无此键 → null 不掩盖
    gmgnUserPct: factorResults.gmgnUserPct ?? null,
    // 累计买入量 BNB（FA state.totalBuyBnb；买腿 condition 量能主键）——signals 页
    // 买入条件复盘用；旧 FA/历史信号无此键 → null 不掩盖
    buyVolumeBnb: factorResults.buyVolumeBnb ?? null,
    tvl: factorResults.tvl,
    fdv: factorResults.fdv,
    marketCap: factorResults.marketCap,
    // 趋势因子（固定窗口8个点）
    trendCV: factorResults.trendCV,
    trendPriceUp: factorResults.trendPriceUp,
    trendMedianUp: factorResults.trendMedianUp,
    trendStrengthScore: factorResults.trendStrengthScore,
    trendTotalReturn: factorResults.trendTotalReturn,
    trendRiseRatio: factorResults.trendRiseRatio,
    trendSlope: factorResults.trendSlope,
    trendDataPoints: factorResults.trendDataPoints,
    trendRecentDownCount: factorResults.trendRecentDownCount,
    trendRecentDownRatio: factorResults.trendRecentDownRatio,
    trendConsecutiveDowns: factorResults.trendConsecutiveDowns,
    trendDrawdownFromWindowHigh: factorResults.trendDrawdownFromWindowHigh,
    // 持有者趋势因子（固定窗口8个点）
    holderTrendCV: factorResults.holderTrendCV,
    holderTrendHolderCountUp: factorResults.holderTrendHolderCountUp,
    holderTrendMedianUp: factorResults.holderTrendMedianUp,
    holderTrendStrengthScore: factorResults.holderTrendStrengthScore,
    holderTrendGrowthRatio: factorResults.holderTrendGrowthRatio,
    holderTrendRiseRatio: factorResults.holderTrendRiseRatio,
    holderTrendSlope: factorResults.holderTrendSlope,
    holderTrendDataPoints: factorResults.holderTrendDataPoints,
    holderTrendRecentDecreaseCount: factorResults.holderTrendRecentDecreaseCount,
    holderTrendRecentDecreaseRatio: factorResults.holderTrendRecentDecreaseRatio,
    holderTrendConsecutiveDecreases: factorResults.holderTrendConsecutiveDecreases,
    // 推文作者类型因子（0=普通, 1=A级SuperIP, 2=S级SuperIP）
    tweetAuthorType: factorResults.tweetAuthorType ?? 0,
    // 数据采集轮数因子
    dataCollectionRound: factorResults.dataCollectionRound ?? 1,
    // pumpfun 回迁批 1 观察子集（12 键；控制时序表体积，其余回测现场重算。
    // 旧引擎（AVE 轮询）无这些键 → null，不掩盖）
    counterpartyOverlapRate: factorResults.counterpartyOverlapRate ?? null,
    counterpartyOverlapVolume: factorResults.counterpartyOverlapVolume ?? null,
    top3HolderShare: factorResults.top3HolderShare ?? null,
    top5HolderShare: factorResults.top5HolderShare ?? null,
    bigHolderPresent: factorResults.bigHolderPresent ?? null,
    bigHolderTotal: factorResults.bigHolderTotal ?? null,
    bigHolderShare: factorResults.bigHolderShare ?? null,
    maxBlockDropPct: factorResults.maxBlockDropPct ?? null,
    rsi14Sec: factorResults.rsi14Sec ?? null,
    crashSpeedPctPerSec: factorResults.crashSpeedPctPerSec ?? null,
    idleSecSinceLastTick: factorResults.idleSecSinceLastTick ?? null,
    firstBlockBuyShare: factorResults.firstBlockBuyShare ?? null,
    // 名单因子（回迁批 3.3，2 键）——名单依赖型：值取决于加载时的名单快照，离线回放重算
    // 会因名单演进失真，必须在线记录（回测亦走此路径=同名单快照 parity）
    smartBotCount: factorResults.smartBotCount ?? null,
    sniperHolderShare: factorResults.sniperHolderShare ?? null,
    // E5 卖侧观测键（4 键）：毕业进度 + 5m RSI9 实时口径 + 针臂涨幅/速度——卖点信号
    // 可观测、analyze 冻结轮分桶用；旧 FA 无这些键 → null，不掩盖
    graduationProgress: factorResults.graduationProgress ?? null,
    rsi9Bar5mRt: factorResults.rsi9Bar5mRt ?? null,
    risePct5m: factorResults.risePct5m ?? null,
    riseVel5m: factorResults.riseVel5m ?? null,
    // 交易活跃度滑窗 act* 8 键（2026-10-15，原 cycle 4 键位）：FA 内存事件环不可重算
    // （30s 快照行无 tick 级分辨率），不落库即丢（holderTrend 先例）；
    // 0=空窗有证据零值（非 null），旧 FA 无这些键 → null，不掩盖
    actBuyBnb: factorResults.actBuyBnb ?? null,
    actSellBnb: factorResults.actSellBnb ?? null,
    actNetBnb: factorResults.actNetBnb ?? null,
    actTrades: factorResults.actTrades ?? null,
    actTraders: factorResults.actTraders ?? null,
    actBuyers: factorResults.actBuyers ?? null,
    actSellers: factorResults.actSellers ?? null,
    actNewTraders: factorResults.actNewTraders ?? null,
    // 同 block 首买簇捆绑检测 bundle* 6 键（2026-10-16 BITCAT 案，Phase 1 观察键）：
    // FA 内存事件环/块聚合不可重算（30s 快照行无 tick 级分辨率），不落库即丢
    // （act*/holderTrend 先例）；0=空窗有证据零值（非 null），旧 FA 无这些键 → null，不掩盖
    bundleClusterSize: factorResults.bundleClusterSize ?? null,
    bundleClusterSharePct: factorResults.bundleClusterSharePct ?? null,
    bundleClusterAmountRatio: factorResults.bundleClusterAmountRatio ?? null,
    bundleClusterEvenGap: factorResults.bundleClusterEvenGap ?? null,
    bundleClusterSameTrader: factorResults.bundleClusterSameTrader ?? null,
    maxBlockBuyCircPct: factorResults.maxBlockBuyCircPct ?? null,
    // 出生锚定捆绑簇 launch* 4 键（2026-10-17 Agentum 案方向 C）：出生窗累计+冻结
    // 不可离线重算（act* 先例），不落库即丢；0=空窗有证据零值，旧 FA 无键 → null 不掩盖
    launchBundleClusterSize: factorResults.launchBundleClusterSize ?? null,
    launchBundleClusterSharePct: factorResults.launchBundleClusterSharePct ?? null,
    launchEqualClusterWallets: factorResults.launchEqualClusterWallets ?? null,
    launchEqualClusterBnb: factorResults.launchEqualClusterBnb ?? null,
    top1HolderCircPct: factorResults.top1HolderCircPct ?? null,
    // 跟单簇名单是进程级静态 Set，名单缺失=null（fail-closed 语义随快照透传，不掩盖）
    maxCopyWalletHolderCircPct: factorResults.maxCopyWalletHolderCircPct ?? null,
    // 平台标签（2026-10-17 C84 起进快照）：新模型单一买条件 platform != 'flap' 分门 +
    // signals 页因子 chip 直读；旧 FA/历史信号无此键 → null 不掩盖
    platform: factorResults.platform ?? null,
    // earlyTrades* 首窗 90s 族 10 键（2026-10-17 C84 迁 FA，双宿主——DB 版继续服务
    // legacy 预检查腿）：FA 出生锚窗增量聚合不可离线重算（回测 replay 亦走 FA 实算），
    // 不落库即丢（act* 先例）；0=空窗有证据零值（非 null），旧 FA 无这些键 → null 不掩盖
    earlyTradesPerWallet: factorResults.earlyTradesPerWallet ?? null,
    earlyTradesMaxWalletTrades: factorResults.earlyTradesMaxWalletTrades ?? null,
    earlyTradesNetBuyRatio: factorResults.earlyTradesNetBuyRatio ?? null,
    earlyTradesTop1BuySharePct: factorResults.earlyTradesTop1BuySharePct ?? null,
    earlyTradesTop1BuyBnb: factorResults.earlyTradesTop1BuyBnb ?? null,
    earlyTradesBuyBnb: factorResults.earlyTradesBuyBnb ?? null,
    earlyTradesRouterPct: factorResults.earlyTradesRouterPct ?? null,
    earlyTradesUniformBuyClusterRatio: factorResults.earlyTradesUniformBuyClusterRatio ?? null,
    earlyTradesUniformBuyWallets: factorResults.earlyTradesUniformBuyWallets ?? null,
    earlyTradesUniformBuyClusterN: factorResults.earlyTradesUniformBuyClusterN ?? null,
    // narrative 三键（2026-10-17 C84 叙事发起条件 + 单一买条件消费）：fire 时刻评级/
    // 轮次/重试到期快照（_narrativeFactorOverrides 投影）；未发起/旧 FA → null 不掩盖
    narrativeRating: factorResults.narrativeRating ?? null,
    narrativeRounds: factorResults.narrativeRounds ?? null,
    narrativeRetryDue: factorResults.narrativeRetryDue ?? null,
  };
}

/**
 * 构建购买前置检查因子对象用于信号 metadata
 * 购买前置检查因子：只在购买时执行一次，存储在购买信号的 metadata 中
 * @param {Object} preBuyCheckResult - 购买前置检查结果
 * @returns {Object} 购买前置检查因子对象
 */
function buildPreBuyCheckFactorValues(preBuyCheckResult) {
  if (!preBuyCheckResult) {
    return {};
  }

  return {
    // [已停用] 持有者检查因子 — 回测时获取的是最新数据而非历史快照
    // holdersCount: preBuyCheckResult.holdersCount || 0,
    // devHoldingRatio: preBuyCheckResult.devHoldingRatio || 0,
    // maxHoldingRatio: preBuyCheckResult.maxHoldingRatio || 0,
    // holderCanBuy: preBuyCheckResult.holderCanBuy ?? null,
    // 早期交易者黑白名单因子（替代旧的持有者黑白名单）
    earlyTraderBlacklistCount: preBuyCheckResult.earlyTraderBlacklistCount || 0,
    earlyTraderWhitelistCount: preBuyCheckResult.earlyTraderWhitelistCount || 0,
    earlyTraderUniqueParticipants: preBuyCheckResult.earlyTraderUniqueParticipants || 0,
    earlyTraderBlacklistRatio: preBuyCheckResult.earlyTraderBlacklistRatio || 0,
    earlyTraderCanBuy: preBuyCheckResult.earlyTraderCanBuy ?? null,
    // 早期参与者检查因子
    earlyTradesChecked: preBuyCheckResult.earlyTradesChecked || 0,
    earlyTradesCheckTimestamp: preBuyCheckResult.earlyTradesCheckTimestamp || null,
    earlyTradesCheckDuration: preBuyCheckResult.earlyTradesCheckDuration || null,
    earlyTradesCheckTime: preBuyCheckResult.earlyTradesCheckTime || null,
    earlyTradesWindow: preBuyCheckResult.earlyTradesWindow || null,
    earlyTradesExpectedFirstTime: preBuyCheckResult.earlyTradesExpectedFirstTime || null,
    earlyTradesExpectedLastTime: preBuyCheckResult.earlyTradesExpectedLastTime || null,
    earlyTradesDataFirstTime: preBuyCheckResult.earlyTradesDataFirstTime || null,
    earlyTradesDataLastTime: preBuyCheckResult.earlyTradesDataLastTime || null,
    earlyTradesDataCoverage: preBuyCheckResult.earlyTradesDataCoverage || 0,
    earlyTradesActualSpan: preBuyCheckResult.earlyTradesActualSpan || 0,
    earlyTradesRateCalcWindow: preBuyCheckResult.earlyTradesRateCalcWindow || 1,
    earlyTradesNoInnerData: preBuyCheckResult.earlyTradesNoInnerData || 0,
    earlyTradesVolumePerMin: preBuyCheckResult.earlyTradesVolumePerMin || 0,
    earlyTradesCountPerMin: preBuyCheckResult.earlyTradesCountPerMin || 0,
    earlyTradesWalletsPerMin: preBuyCheckResult.earlyTradesWalletsPerMin || 0,
    earlyTradesHighValuePerMin: preBuyCheckResult.earlyTradesHighValuePerMin || 0,
    earlyTradesTotalCount: preBuyCheckResult.earlyTradesTotalCount || 0,
    earlyTradesVolume: preBuyCheckResult.earlyTradesVolume || 0,
    earlyTradesUniqueWallets: preBuyCheckResult.earlyTradesUniqueWallets || 0,
    earlyTradesHighValueCount: preBuyCheckResult.earlyTradesHighValueCount || 0,
    earlyTradesFilteredCount: preBuyCheckResult.earlyTradesFilteredCount || 0,
    // 早期交易新增因子
    earlyTradesFinalLiquidity: preBuyCheckResult.earlyTradesFinalLiquidity ?? null,
    earlyTradesDrawdownFromHighest: preBuyCheckResult.earlyTradesDrawdownFromHighest ?? null,
    // 净流入因子（对倒拦截，共合案 2026-09-27）：covered=0 时 ratio 为通过值 100
    earlyTradesNetBuyRatio: preBuyCheckResult.earlyTradesNetBuyRatio ?? null,
    earlyTradesNetBuyCovered: preBuyCheckResult.earlyTradesNetBuyCovered ?? 0,
    // 同额度簇因子（sybil 批量钱包拦截，作弊票案 2026-09-27）：covered=0 时为 0 值放行
    earlyTradesUniformBuyWallets: preBuyCheckResult.earlyTradesUniformBuyWallets ?? 0,
    earlyTradesUniformBuyClusterN: preBuyCheckResult.earlyTradesUniformBuyClusterN ?? 0,
    earlyTradesUniformBuyClusterRatio: preBuyCheckResult.earlyTradesUniformBuyClusterRatio ?? 0,
    earlyTradesUniformBuyCovered: preBuyCheckResult.earlyTradesUniformBuyCovered ?? 0,
    // 每钱包笔数因子（对倒高频作业拦截，猪五花案 2026-10-15）：缺省 0 值放行
    earlyTradesPerWallet: preBuyCheckResult.earlyTradesPerWallet ?? 0,
    earlyTradesMaxWalletTrades: preBuyCheckResult.earlyTradesMaxWalletTrades ?? 0,
    // GMGN 用户净持仓占比 fire 时点快照（2026-10-16 u40 门挪层进 preBuy）：
    // 信号 metadata 审计直读；null=无 TPA 段（fail-closed 与条件语义一致）
    gmgnUserPct: preBuyCheckResult.gmgnUserPct ?? null,
    // sniper 持仓比例因子（虚假流动性拦截，显化之歌案 2026-09-29）：covered=0 时为 0 值放行
    earlyTradesSniperHoldingPct: preBuyCheckResult.earlyTradesSniperHoldingPct ?? 0,
    earlyTradesSniperWallets: preBuyCheckResult.earlyTradesSniperWallets ?? 0,
    earlyTradesSniperHolders: preBuyCheckResult.earlyTradesSniperHolders ?? 0,
    earlyTradesSniperCovered: preBuyCheckResult.earlyTradesSniperCovered ?? 0,
    // top1 买入集中度因子（单钱包主导拦截，buy-dominance 案 2026-09-29）：covered=0 时为 0 值放行
    earlyTradesTop1BuySharePct: preBuyCheckResult.earlyTradesTop1BuySharePct ?? 0,
    earlyTradesTop1BuyBnb: preBuyCheckResult.earlyTradesTop1BuyBnb ?? 0,
    earlyTradesBuyBnb: preBuyCheckResult.earlyTradesBuyBnb ?? 0,
    earlyTradesTop1BuyCovered: preBuyCheckResult.earlyTradesTop1BuyCovered ?? 0,
    // 聚合路由占比因子（GMGN 主导盘拦截，0x1de460 案 2026-09-30）：covered=0 时为 0 值放行
    earlyTradesRouterPct: preBuyCheckResult.earlyTradesRouterPct ?? 0,
    earlyTradesRouterCovered: preBuyCheckResult.earlyTradesRouterCovered ?? 0,
    // router 门观察史因子（2026-10-03，pre-check/router-gate-state.js）：截至本次 fire
    // 前的历史状态；null=未维护/非 flap（默认 null 非 0——首 fire 语义与 0「全净史」区分）
    earlyTradesRouterLowSideSeen: preBuyCheckResult.earlyTradesRouterLowSideSeen ?? null,
    earlyTradesRouterRejectCount: preBuyCheckResult.earlyTradesRouterRejectCount ?? null,
    // 钱包集中度因子
    walletTop3VolumeRatio: preBuyCheckResult.walletTop3VolumeRatio || 0,
    walletTop1VolumeRatio: preBuyCheckResult.walletTop1VolumeRatio || 0,
    walletTop3TradeRatio: preBuyCheckResult.walletTop3TradeRatio || 0,
    walletTop1TradeRatio: preBuyCheckResult.walletTop1TradeRatio || 0,
    walletDiversityIndex: preBuyCheckResult.walletDiversityIndex || 0,
    oneShotBuyerRatio: preBuyCheckResult.oneShotBuyerRatio || 0,
    // 区块集中买入因子
    maxBlockBuyRatio: preBuyCheckResult.maxBlockBuyRatio || 0,
    maxBlockNumber: preBuyCheckResult.maxBlockNumber || null,
    maxBlockBuyAmount: preBuyCheckResult.maxBlockBuyAmount || 0,
    // 钱包标签因子
    walletLabelHasFresh: preBuyCheckResult.walletLabelHasFresh || 0,
    walletLabelProfitableRatio: preBuyCheckResult.walletLabelProfitableRatio || 0,
    walletLabelBuySellRatio: preBuyCheckResult.walletLabelBuySellRatio || 0,
    walletLabelMatchCount: preBuyCheckResult.walletLabelMatchCount || 0,
    walletLabelOnlyBuyRatio: preBuyCheckResult.walletLabelOnlyBuyRatio || 0,
    // 创建者Dev钱包检查因子
    creatorIsNotBadDevWallet: preBuyCheckResult.creatorIsNotBadDevWallet ?? null,
    // 趋势因子（允许在条件表达式中使用）
    drawdownFromHighest: preBuyCheckResult.drawdownFromHighest ?? null,
    // 多次交易因子
    buyRound: preBuyCheckResult.buyRound ?? 1,
    lastPairReturnRate: preBuyCheckResult.lastPairReturnRate ?? 0,
    // 平台标签（router 平台分门审计，2026-10-02）：求值在 PreBuyCheckService context
    // 直读，此键纯事后分析用——82093ca3 配对分析曾因缺此键无法从 metadata 判平台
    platform: preBuyCheckResult.platform ?? null,
    // 强势交易者持仓因子
    strongTraderNetPositionRatio: preBuyCheckResult.strongTraderNetPositionRatio ?? 0,
    strongTraderTotalBuyRatio: preBuyCheckResult.strongTraderTotalBuyRatio ?? 0,
    strongTraderTotalSellRatio: preBuyCheckResult.strongTraderTotalSellRatio ?? 0,
    strongTraderWalletCount: preBuyCheckResult.strongTraderWalletCount ?? 0,
    strongTraderTradeCount: preBuyCheckResult.strongTraderTradeCount ?? 0,
    strongTraderSellIntensity: preBuyCheckResult.strongTraderSellIntensity ?? 0,
    // 叙事分析评级因子
    narrativeRating: preBuyCheckResult.narrativeRating ?? 9,
    // 早晚票语料滞后秒（0fed29f9 案 2026-10-08）：null=无语料时间（晚票门 fail-closed）
    narrativeCorpusLagSec: preBuyCheckResult.narrativeCorpusLagSec ?? null,
    // fire 因子 earlyReturn 注入（晚票门右臂证据；与 trendFactors.earlyReturn 同值同刻）
    earlyReturn: preBuyCheckResult.earlyReturn ?? null,
    // 同叙事龙头因子（1=同源推文下已有代币峰值涨幅>=5x 且判定时刻在其首达后24h内）
    narrativeLeaderHot: preBuyCheckResult.narrativeLeaderHot ?? 0,
    narrativeLeaderCount: preBuyCheckResult.narrativeLeaderCount ?? 0,
    narrativeLeaderMaxMultiple: preBuyCheckResult.narrativeLeaderMaxMultiple ?? 0,
    // GMGN 风险因子（x-0 案 2026-09-27：直调语境同次 getTokenInfo 带出发币史/捆绑钱包；covered=0=未查放行）
    gmgnIssuerTokenCount: preBuyCheckResult.gmgnIssuerTokenCount ?? 0,
    gmgnBundlerWalletRatio: preBuyCheckResult.gmgnBundlerWalletRatio ?? 0,
    gmgnRiskCovered: preBuyCheckResult.gmgnRiskCovered ?? 0,
    gmgnVisitingCount: preBuyCheckResult.gmgnVisitingCount ?? 0,
    // 推文作者类型因子（0=普通, 1=A级SuperIP, 2=S级SuperIP）
    tweetAuthorType: preBuyCheckResult.tweetAuthorType ?? 0,
    // 数据采集轮数因子
    dataCollectionRound: preBuyCheckResult.dataCollectionRound ?? 0,
    // 严格同名代币因子（AVE 检索；maxFDV=排除自己+过滤虚假数据后的同名最大市值，0=无同名/检查失败）
    strictSameNameTokenCount: preBuyCheckResult.strictSameNameTokenCount ?? 0,
    strictSameNameSearchCount: preBuyCheckResult.strictSameNameSearchCount ?? 0,
    strictSameNameFilteredCount: preBuyCheckResult.strictSameNameFilteredCount ?? 0,
    strictSameNameMaxFDV: preBuyCheckResult.strictSameNameMaxFDV ?? 0,
  };
}

/**
 * 获取所有可用的常规因子ID列表
 * 注意：购买前置检查因子不在此列表中，它们只存储在信号 metadata 中
 *
 * 上述硬编码清单并上 FourMemeFactorAggregator.getFactorKeys()（权威单一事实源）：
 * FA 键集含 tick 原生活跃度键（tradeCount/buyVolumeBnb 等，原硬编码清单一直缺）。
 * 策略 condition 引用键 ∉ 此集合会被
 * StrategyEngine 拒载，并入后新键可直接进条件表达式。
 * @returns {Set<string>} 常规因子ID集合
 */
function getAvailableFactorIds() {
  const ids = new Set([
    // 基础因子
    'age', 'currentPrice', 'firstPrice', 'collectionPrice', 'launchPrice', 'earlyReturn', 'buyPrice',
    'holdDuration', 'profitPercent',
    'highestPrice', 'highestPriceTimestamp', 'drawdownFromHighest',
    // 最近一次购买后的最高价相关因子（用于止损/止盈）
    'highestPriceSinceLastBuy', 'drawdownFromHighestSinceLastBuy',
    // 最近一次购买后的最高持有者数量相关因子（用于持有者回撤检测）
    'highestHolderCountSinceLastBuy', 'holderDrawdownFromHighestSinceLastBuy',
    'txVolumeU24h', 'holders', 'tvl', 'fdv', 'marketCap',
    // 价格趋势因子（固定窗口8个点）
    'trendCV', 'trendPriceUp', 'trendMedianUp', 'trendStrengthScore',
    'trendTotalReturn', 'trendRiseRatio', 'trendSlope', 'trendDataPoints',
    'trendRecentDownCount', 'trendRecentDownRatio', 'trendConsecutiveDowns', 'trendDrawdownFromWindowHigh',
    // 持有者趋势因子（固定窗口8个点）
    'holderTrendCV', 'holderTrendHolderCountUp', 'holderTrendMedianUp', 'holderTrendStrengthScore',
    'holderTrendGrowthRatio', 'holderTrendRiseRatio', 'holderTrendSlope', 'holderTrendDataPoints',
    'holderTrendRecentDecreaseCount', 'holderTrendRecentDecreaseRatio', 'holderTrendConsecutiveDecreases',
  ]);
  // 惰性 require（函数调用时加载，无循环依赖：FA 不依赖 FactorBuilder）
  const FourMemeFactorAggregator = require('../../services/FourMemeFactorAggregator');
  const fa = new FourMemeFactorAggregator({});
  for (const k of fa.getFactorKeys()) ids.add(k);
  return ids;
}

/**
 * 构建 TPA 持仓因子快照用于买信号 metadata（tpaFactors 键）
 * TPAPre_* 因子族由 TokenPositionAnalyzer 触发后经 FA.buildFactorMap 尾部注入，
 * 供买腿 condition 评估（如 TPAPre_tokenScore > 2.2）——但不在
 * preBuyCheckFactors/trendFactors 白名单内，不快照则落库即丢，signals 页面
 * 无法复盘「买入时刻 TPA 分数」。快照取 fire 时刻 factorResults 的 TPA 键集
 * （tpa-factor-keys 单一真相源），未触发键 undefined → null（显式未就绪，不掩盖）。
 * @param {Object} factorResults - 策略评估用的 fire 时刻因子（含 TPA 注入键）
 * @returns {Object} TPA 因子快照对象
 */
function buildTpaFactorSnapshot(factorResults) {
  const { HOLDING_FACTOR_KEYS, FA_TPA_KEYS } = require('../../services/tpa-factor-keys');
  const snapshot = {};
  for (const key of [...HOLDING_FACTOR_KEYS, ...FA_TPA_KEYS]) {
    const v = factorResults ? factorResults[key] : undefined;
    snapshot[key] = v === undefined ? null : v;
  }
  return snapshot;
}

module.exports = {
  buildFactorValuesForTimeSeries,
  buildPreBuyCheckFactorValues,
  getAvailableFactorIds,
  buildTpaFactorSnapshot
};
