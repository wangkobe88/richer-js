/**
 * 购买前检查服务
 * 统一的购买前检查入口，整合所有预检查逻辑
 *
 * 职责：
 * 1. 执行购买前的所有检查（黑/白名单、Dev持仓、早期参与者等）
 * 2. 返回结构化的检查结果
 * 3. 将检查结果转换为因子格式
 */

const { TokenHolderService } = require('../holders/TokenHolderService');
const { EarlyParticipantCheckService } = require('./EarlyParticipantCheckService');
const { WalletClusterService } = require('./WalletClusterService');
const { WalletDataService } = require('../../web/services/WalletDataService');
const TwitterSearchService = require('./TwitterSearchService');
const StrongTraderPositionService = require('./StrongTraderPositionService');

/**
 * 因子元数据配置
 * 用于诊断失败条件时显示友好的名称和格式化
 */
const FACTOR_METADATA = {
  // 早期交易者黑白名单因子
  earlyTraderWhitelistCount: {
    name: '白名单早期交易者数量',
    format: v => v.toString(),
    unit: '',
    severity: 'info'
  },
  earlyTraderBlacklistCount: {
    name: '黑名单早期交易者数量',
    format: v => v.toString(),
    unit: '',
    severity: 'critical'
  },
  earlyTraderUniqueParticipants: {
    name: '早期交易唯一参与者数',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
  earlyTraderBlacklistRatio: {
    name: '早期交易者黑名单占比',
    format: v => (v * 100).toFixed(1),
    unit: '%',
    severity: 'critical'
  },
  earlyTraderCanBuy: {
    name: '早期交易者购买资格',
    format: v => v ? '通过' : '未通过',
    unit: '',
    severity: 'critical'
  },
  // 持有者检查因子
  holdersCount: {
    name: '持有者总数',
    format: v => v.toString(),
    unit: '',
    severity: 'info'
  },
  devHoldingRatio: {
    name: 'Dev持仓比例',
    format: v => v.toFixed(1) + '%',
    unit: '%',
    severity: 'critical'
  },
  maxHoldingRatio: {
    name: '最大持仓比例',
    format: v => v.toFixed(1) + '%',
    unit: '%',
    severity: 'critical'
  },
  // 早期参与者因子
  earlyTradesChecked: {
    name: '早期交易检查状态',
    format: v => v === 1 ? '已检查' : '未检查',
    unit: '',
    severity: 'info'
  },
  earlyTradesHighValueCount: {
    name: '早期大额交易笔数',
    format: v => v.toString(),
    unit: '笔',
    severity: 'warning'
  },
  earlyTradesHighValuePerMin: {
    name: '早期大额交易速率',
    format: v => v.toFixed(1),
    unit: '笔/分钟',
    severity: 'warning'
  },
  earlyTradesCountPerMin: {
    name: '早期交易速率',
    format: v => v.toFixed(1),
    unit: '笔/分钟',
    severity: 'warning'
  },
  earlyTradesVolumePerMin: {
    name: '早期交易量速率',
    format: v => v.toFixed(0),
    unit: '/分钟',
    severity: 'warning'
  },
  earlyTradesWalletsPerMin: {
    name: '早期活跃钱包速率',
    format: v => v.toFixed(1),
    unit: '个/分钟',
    severity: 'warning'
  },
  earlyTradesTotalCount: {
    name: '早期交易总笔数',
    format: v => v.toString(),
    unit: '笔',
    severity: 'info'
  },
  earlyTradesVolume: {
    name: '早期交易总量',
    format: v => v.toFixed(0),
    unit: '',
    severity: 'info'
  },
  earlyTradesUniqueWallets: {
    name: '早期唯一钱包数',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
  earlyTradesDataCoverage: {
    name: '早期数据覆盖率',
    format: v => (v * 100).toFixed(1) + '%',
    unit: '',
    severity: 'info'
  },
  earlyTradesFilteredCount: {
    name: '早期过滤交易数',
    format: v => v.toString(),
    unit: '笔',
    severity: 'info'
  },
  earlyTradesFinalLiquidity: {
    name: '早期交易末流动性',
    format: v => v ? '$' + v.toFixed(0) : 'N/A',
    unit: '',
    severity: 'warning'
  },
  earlyTradesDrawdownFromHighest: {
    name: '早期交易末价格从最高点跌幅',
    format: v => v.toFixed(1) + '%',
    unit: '%',
    severity: 'warning'
  },
  earlyTradesTop1BuyRatio: {
    name: 'Top1钱包买入占比',
    format: v => (v * 100).toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  earlyTradesTop3BuyRatio: {
    name: 'Top3钱包买入占比',
    format: v => (v * 100).toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  earlyTradesTop1NetHoldingRatio: {
    name: 'Top1钱包净持仓占比',
    format: v => (v * 100).toFixed(2) + '%',
    unit: '',
    severity: 'warning'
  },
  earlyTradesActualSpan: {
    name: '早期数据实际跨度',
    format: v => v.toFixed(1) + '秒',
    unit: '秒',
    severity: 'info'
  },
  earlyTradesRateCalcWindow: {
    name: '早期速率计算窗口',
    format: v => v.toFixed(1) + '秒',
    unit: '秒',
    severity: 'info'
  },
  // 钱包簇因子
  walletClusterSecondToFirstRatio: {
    name: '第二大簇与第一大簇比例',
    format: v => (v * 100).toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  walletClusterMegaRatio: {
    name: 'Mega聚簇比例',
    format: v => v.toFixed(2),
    unit: '',
    severity: 'warning'
  },
  walletClusterTop2Ratio: {
    name: '前两大簇比例',
    format: v => (v * 100).toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  walletClusterCount: {
    name: '聚簇数量',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
  walletClusterMaxSize: {
    name: '最大聚簇大小',
    format: v => v.toString(),
    unit: '笔',
    severity: 'info'
  },
  walletClusterAvgSize: {
    name: '平均聚簇大小',
    format: v => v.toFixed(1),
    unit: '笔',
    severity: 'info'
  },
  walletClusterMaxClusterWallets: {
    name: '最大聚簇钱包数',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
  walletClusterMaxBlockBuyRatio: {
    name: '最大区块买入占比',
    format: v => (v * 100).toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  walletClusterTotalBuyAmount: {
    name: '总买入金额',
    format: v => v.toFixed(0),
    unit: '',
    severity: 'info'
  },
  // Twitter因子
  twitterTotalResults: {
    name: 'Twitter搜索结果数',
    format: v => v.toString(),
    unit: '条',
    severity: 'info'
  },
  twitterQualityTweets: {
    name: 'Twitter高质量推文数',
    format: v => v.toString(),
    unit: '条',
    severity: 'info'
  },
  twitterLikes: {
    name: 'Twitter点赞数',
    format: v => v.toString(),
    unit: '',
    severity: 'info'
  },
  twitterRetweets: {
    name: 'Twitter转发数',
    format: v => v.toString(),
    unit: '',
    severity: 'info'
  },
  twitterComments: {
    name: 'Twitter评论数',
    format: v => v.toString(),
    unit: '',
    severity: 'info'
  },
  twitterTotalEngagement: {
    name: 'Twitter总互动量',
    format: v => v.toString(),
    unit: '',
    severity: 'info'
  },
  twitterAvgEngagement: {
    name: 'Twitter平均互动量',
    format: v => v.toFixed(0),
    unit: '',
    severity: 'info'
  },
  twitterVerifiedUsers: {
    name: 'Twitter认证用户数',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
  twitterFollowers: {
    name: 'Twitter粉丝总数',
    format: v => v.toString(),
    unit: '',
    severity: 'info'
  },
  twitterUniqueUsers: {
    name: 'Twitter唯一用户数',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
  // 强势交易者持仓因子
  strongTraderNetPositionRatio: {
    name: '强势交易者净持仓比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  strongTraderTotalBuyRatio: {
    name: '强势交易者买入占比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  strongTraderTotalSellRatio: {
    name: '强势交易者卖出占比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  strongTraderWalletCount: {
    name: '强势交易者钱包数',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
  strongTraderTradeCount: {
    name: '强势交易者交易笔数',
    format: v => v.toString(),
    unit: '笔',
    severity: 'info'
  },
  strongTraderSellIntensity: {
    name: '强势交易者卖出强度',
    format: v => v.toFixed(2),
    unit: '',
    severity: 'warning'
  },
  // 创建者Dev钱包因子
  creatorIsNotBadDevWallet: {
    name: '创建者非Dev钱包',
    format: v => v === 1 ? '是' : '否',
    unit: '',
    severity: 'critical'
  },
  // 趋势因子
  drawdownFromHighest: {
    name: '从最高价跌幅',
    format: v => v.toFixed(1) + '%',
    unit: '%',
    severity: 'warning'
  },
  // 多次交易因子
  buyRound: {
    name: '买入轮次',
    format: v => `第${v}轮`,
    unit: '',
    severity: 'info'
  },
  lastPairReturnRate: {
    name: '上一对收益率',
    format: v => (v * 100).toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  // 叙事分析因子
  narrativeRating: {
    name: '代币叙事评级',
    format: v => {
      const labels = { 1: '低质量', 2: '中质量', 3: '高质量', 9: '未评级' };
      return labels[v] || `${v}`;
    },
    unit: '',
    severity: 'warning'
  },
  // 合约审计风控因子
  contractRiskAvailable: {
    name: '合约审计数据可用',
    format: v => v === 1 ? '有数据' : '无数据',
    unit: '',
    severity: 'info'
  },
  contractRiskPairLockPercent: {
    name: 'LP锁定百分比',
    format: v => v.toFixed(2) + '%',
    unit: '%',
    severity: 'critical'
  },
  contractRiskTopLpHolderPercent: {
    name: 'Top1 LP持有人百分比',
    format: v => v.toFixed(1) + '%',
    unit: '%',
    severity: 'critical'
  },
  contractRiskLpHolders: {
    name: 'LP持有人数量',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
  contractRiskScore: {
    name: 'AVE风险评分',
    format: v => v.toString(),
    unit: '分',
    severity: 'warning'
  },
  contractRiskIsHoneypot: {
    name: '蜜罐标记',
    format: v => v === 1 ? '是蜜罐' : v === -1 ? '未知' : '否',
    unit: '',
    severity: 'critical'
  },
  contractRiskDexAmmType: {
    name: 'DEX AMM类型',
    format: v => v || 'unknown',
    unit: '',
    severity: 'info'
  },
  contractRiskHasCode: {
    name: '合约开源状态',
    format: v => v === 'open' ? '已开源' : v === 'closed' ? '未开源' : '无数据',
    unit: '',
    severity: 'info'
  }
};

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  devHoldingThreshold: 15,           // Dev持仓阈值（百分比）
  largeHoldingThreshold: 18,         // 大额持仓阈值（百分比）
  holderCheckEnabled: true,          // 是否启用持有者检查
  earlyParticipantCheckEnabled: true, // 是否启用早期参与者检查
  earlyParticipantFilterEnabled: false, // 是否启用早期参与者筛选（策略8）
  earlyParticipantStrategy: 'three_feature_and_p25',
  threeFeatureAndP25: {              // 策略8阈值配置
    volumePerMinThreshold: 1610,
    countPerMinThreshold: 14,
    highValuePerMinThreshold: 8
  }
};

class PreBuyCheckService {
  /**
   * @param {Object} supabase - Supabase客户端
   * @param {Object} logger - Logger实例
   * @param {Object} config - 配置对象
   */
  constructor(supabase, logger, config = {}) {
    this.supabase = supabase;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初始化持有者服务
    this.holderService = new TokenHolderService(supabase, logger);

    // 初始化早期参与者检查服务（传入 supabase 用于存储数据）
    this.earlyParticipantService = new EarlyParticipantCheckService(logger, {
      calculateGrowthScore: false  // 暂不计算增长评分
    }, supabase);

    // 初始化钱包簇检查服务
    // 默认使用区块号聚簇（比时间戳更准确）
    // 如果需要使用时间戳聚簇，配置 useTimeBasedClustering: true
    const clusterMode = this.config.useTimeBasedClustering ? 'time' : 'block';
    const clusterConfig = {
      mode: clusterMode,
      clusterBlockThreshold: this.config.clusterBlockThreshold || 7
    };
    this.walletClusterService = new WalletClusterService(logger, clusterConfig);

    // 初始化Twitter搜索服务
    this.twitterSearchService = new TwitterSearchService(logger);

    // 初始化强势交易者持仓服务
    this.strongTraderPositionService = new StrongTraderPositionService();
  }

  /**
   * 初始化服务（加载缓存等）
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.holderService.initWalletCache();
    this.logger.info('[PreBuyCheckService] 服务初始化完成');
  }

  /**
   * 执行所有购买前检查
   * @param {string} tokenAddress - 代币地址
   * @param {string} creatorAddress - 创建者地址（可为null）
   * @param {string} experimentId - 实验ID
   * @param {string} signalId - 信号ID（可为null）
   * @param {string} chain - 区块链
   * @param {Object} tokenInfo - 代币信息（用于早期参与者检查，只需要 innerPair）
   * @param {string} tokenInfo.innerPair - 内盘交易对
   * @param {string} preBuyCheckCondition - 购买前检查条件表达式（可选）
   * @param {Object} options - 可选配置
   * @param {number} options.checkTime - 检查时间戳（秒），用于回测时指定历史时间点
   * @param {boolean} options.skipHolderCheck - 是否跳过持有者检查（回测时为 true）
   * @param {boolean} options.skipEarlyParticipant - 是否跳过早期参与者检查
   * @param {boolean} options.skipTwitterSearch - 是否跳过Twitter搜索（回测时为 true，因子使用默认值）
   * @param {number} options.tokenBuyTime - 代币首次买入时间戳（毫秒），用于判断是否有历史交易记录
   * @param {number} options.drawdownFromHighest - 从最高价跌幅（%），负数表示下跌
   * @returns {Promise<Object>} 检查结果
   */
  async performAllChecks(tokenAddress, creatorAddress, experimentId, signalId, chain = 'bsc', tokenInfo = null, preBuyCheckCondition = null, options = {}) {
    const startTime = Date.now();
    const { checkTime, skipHolderCheck, skipEarlyParticipant, skipTwitterSearch, tokenBuyTime, drawdownFromHighest, buyRound, lastPairReturnRate, narrativeRating, tweetAuthorType, dataCollectionRound, contractRiskData, totalSupply } = options;

    this.logger.info('[PreBuyCheckService] 开始执行购买前检查', {
      token_address: tokenAddress,
      creator_address: creatorAddress || 'none',
      experiment_id: experimentId,
      signal_id: signalId || 'none',
      chain,
      has_condition: !!preBuyCheckCondition,
      condition: preBuyCheckCondition || '(空，默认通过)',
      check_time: checkTime || Math.floor(Date.now() / 1000),
      skip_holder_check: skipHolderCheck || false,
      skip_early_participant: skipEarlyParticipant || false,
      skip_twitter_search: skipTwitterSearch || false,
      buy_round: buyRound || 1,
      last_pair_return_rate: lastPairReturnRate ?? 0
    });

    try {
      // 先执行早期参与者检查（获取交易数据）
      const earlyParticipantCheck = await this._performEarlyParticipantCheck(
        tokenAddress, chain, tokenInfo, checkTime, skipEarlyParticipant, totalSupply
      );

      // Twitter搜索：回测时跳过，使用默认因子
      const twitterCheck = skipTwitterSearch
        ? this._getEmptyTwitterCheck()
        : await this._performTwitterSearch(tokenAddress);

      // 并行执行持有者检查、钱包簇检查、创建者Dev钱包检查、强势交易者持仓检查
      const [holderCheck, walletClusterCheck, creatorDevCheck, strongTraderCheck] = await Promise.all([
        this._performHolderCheck(tokenAddress, creatorAddress, experimentId, signalId, chain, skipHolderCheck),
        this._performWalletClusterCheck(earlyParticipantCheck, tokenAddress),
        this._checkCreatorIsNotBadDevWallet(creatorAddress),
        this._performStrongTraderPositionCheck(tokenAddress, earlyParticipantCheck)
      ]);

      // 如果没有提供条件表达式，默认通过（不执行任何检查）
      // 确保 preBuyCheckCondition 是字符串类型，防止 .trim() 调用失败
      if (!preBuyCheckCondition || String(preBuyCheckCondition).trim() === '') {
        preBuyCheckCondition = 'true';  // 设置为 true 以便后续通过评估
      } else {
        preBuyCheckCondition = String(preBuyCheckCondition).trim();
      }

      // 存储早期交易者数据（如果有 signalId 和交易数据）
      if (signalId && earlyParticipantCheck._trades && earlyParticipantCheck._trades.length > 0) {
        // 同步存储，确保数据保存完成
        const storeSuccess = await this.earlyParticipantService.storeEarlyParticipantTrades(
          tokenAddress,
          signalId,
          experimentId,
          tokenInfo?.innerPair || null,
          chain,
          earlyParticipantCheck._trades,
          checkTime || Math.floor(Date.now() / 1000)
        );
        this.logger.info('[PreBuyCheckService] 早期交易数据存储完成', {
          signal_id: signalId,
          success: storeSuccess
        });
      }

      // 早期交易者黑白名单检查（基于交易参与者，而非持有者）
      const earlyTraderCheck = await this.holderService.checkEarlyTradersRisk(earlyParticipantCheck._trades);

      // 使用条件表达式评估
      return this._evaluateWithCondition(
        holderCheck,
        earlyParticipantCheck,
        walletClusterCheck,
        creatorDevCheck,
        twitterCheck,
        strongTraderCheck,
        earlyTraderCheck,
        preBuyCheckCondition,
        startTime,
        options.drawdownFromHighest,  // 传入 drawdownFromHighest
        {
          buyRound: options.buyRound,
          lastPairReturnRate: options.lastPairReturnRate,
          narrativeRating: narrativeRating,
          tweetAuthorType: tweetAuthorType,
          dataCollectionRound: dataCollectionRound,
          contractRiskData: contractRiskData  // 合约审计风控数据
        }
      );
    } catch (error) {
      const errorMessage = this._safeGetErrorMessage(error);

      this.logger.error('[PreBuyCheckService] 购买前检查失败', {
        token_address: tokenAddress,
        creator_address: creatorAddress,
        error: errorMessage
      });

      // 出错时返回不可购买的结果
      return {
        preBuyCheck: 1,
        checkTimestamp: Date.now(),
        checkDuration: Date.now() - startTime,

        holdersCount: 0,
        devHoldingRatio: 0,
        maxHoldingRatio: 0,
        holderCanBuy: false,

        // 早期交易者黑白名单因子
        earlyTraderBlacklistCount: 0,
        earlyTraderWhitelistCount: 0,
        earlyTraderUniqueParticipants: 0,
        earlyTraderBlacklistRatio: 0,
        earlyTraderCanBuy: false,

        holderCheckReason: `检查失败: ${errorMessage}`,
        blacklistReason: `检查失败: ${errorMessage}`,
        devCheckReason: `检查失败: ${errorMessage}`,

        canBuy: false,
        checkReason: `购买前检查失败: ${errorMessage}`,

        // 多次交易因子（默认值）
        buyRound: options.buyRound || 1,
        lastPairReturnRate: options.lastPairReturnRate ?? 0,
        // 推文作者类型因子
        tweetAuthorType: options.tweetAuthorType ?? 0,
        // 数据采集轮数因子
        dataCollectionRound: options.dataCollectionRound ?? 0,

        // 早期参与者检查失败时的空值
        ...this.earlyParticipantService.getEmptyFactorValues(),
        // 钱包簇检查失败时的空值
        ...this.walletClusterService.getEmptyFactorValues(),
        // Twitter检查失败时的空值
        twitterTotalResults: 0,
        twitterQualityTweets: 0,
        twitterLikes: 0,
        twitterRetweets: 0,
        twitterComments: 0,
        twitterTotalEngagement: 0,
        twitterAvgEngagement: 0,
        twitterVerifiedUsers: 0,
        twitterFollowers: 0,
        twitterUniqueUsers: 0,
        twitterSearchSuccess: false,
        twitterSearchDuration: 0,
        twitterSearchError: errorMessage,
        // 强势交易者持仓检查失败时的空值
        ...this.strongTraderPositionService.getEmptyFactorValues(),
        // 合约审计风控因子（失败时使用传入的数据或空值）
        contractRiskAvailable: options.contractRiskData?.contractRiskAvailable ?? 0,
        contractRiskPairLockPercent: options.contractRiskData?.contractRiskPairLockPercent ?? 0,
        contractRiskTopLpHolderPercent: options.contractRiskData?.contractRiskTopLpHolderPercent ?? 0,
        contractRiskLpHolders: options.contractRiskData?.contractRiskLpHolders ?? 0,
        contractRiskScore: options.contractRiskData?.contractRiskScore ?? 0,
        contractRiskIsHoneypot: options.contractRiskData?.contractRiskIsHoneypot ?? 0,
        contractRiskDexAmmType: options.contractRiskData?.contractRiskDexAmmType ?? 'unknown',
        contractRiskHasCode: options.contractRiskData?.contractRiskHasCode ?? 'unknown'
      };
    }
  }

  /**
   * 使用条件表达式评估
   * @private
   * @param {Object} holderCheck - 持有者检查结果
   * @param {Object} earlyParticipantCheck - 早期参与者检查结果
   * @param {Object} walletClusterCheck - 钱包簇检查结果
   * @param {Object} creatorDevCheck - 创建者Dev检查结果
   * @param {Object} twitterCheck - Twitter检查结果
   * @param {Object} strongTraderCheck - 强势交易者持仓检查结果
   * @param {Object} earlyTraderCheck - 早期交易者黑白名单检查结果
   * @param {string} condition - 条件表达式
   * @param {number} startTime - 开始时间戳
   * @param {number} drawdownFromHighest - 从最高价跌幅
   * @param {Object} extraContext - 额外上下文 { buyRound, lastPairReturnRate, narrativeRating }
   */
  _evaluateWithCondition(holderCheck, earlyParticipantCheck, walletClusterCheck, creatorDevCheck, twitterCheck, strongTraderCheck, earlyTraderCheck, condition, startTime, drawdownFromHighest = null, extraContext = {}) {
    // 构建基础结果
    const baseResult = {
      // 标记已执行预检查
      preBuyCheck: 1,
      checkTimestamp: Date.now(),
      checkDuration: Date.now() - startTime,

      // 持有者检查结果（dev持仓、大额持仓仍基于持有者）
      holdersCount: holderCheck.holdersCount || 0,
      devHoldingRatio: holderCheck.devHoldingRatio || 0,
      maxHoldingRatio: holderCheck.maxHoldingRatio || 0,
      holderCanBuy: holderCheck.canBuy,

      // 持有者检查详细原因
      holderCheckReason: holderCheck.reason,
      devCheckReason: holderCheck.devReason,

      // 早期交易者黑白名单检查结果
      earlyTraderBlacklistCount: earlyTraderCheck.earlyTraderBlacklistCount || 0,
      earlyTraderWhitelistCount: earlyTraderCheck.earlyTraderWhitelistCount || 0,
      earlyTraderUniqueParticipants: earlyTraderCheck.earlyTraderUniqueParticipants || 0,
      earlyTraderBlacklistRatio: earlyTraderCheck.earlyTraderBlacklistRatio || 0,
      earlyTraderCanBuy: earlyTraderCheck.earlyTraderCanBuy ?? false,
      earlyTraderBlacklistReason: earlyTraderCheck.reason || '',

      // 创建者Dev钱包检查（1=不在Dev列表中, 0=在Dev列表中）
      creatorIsNotBadDevWallet: creatorDevCheck.creatorIsNotBadDevWallet ?? 0,

      // 从最高价跌幅（允许在条件表达式中使用）
      drawdownFromHighest: drawdownFromHighest ?? 0,

      // 多次交易因子
      buyRound: extraContext.buyRound || 1,
      lastPairReturnRate: extraContext.lastPairReturnRate ?? 0,

      // 叙事分析因子
      narrativeRating: extraContext.narrativeRating ?? 9,
      // 推文作者类型因子
      tweetAuthorType: extraContext.tweetAuthorType ?? 0,
      // 数据采集轮数因子
      dataCollectionRound: extraContext.dataCollectionRound ?? 0,

      // 合约审计风控因子
      contractRiskAvailable: extraContext.contractRiskData?.contractRiskAvailable ?? 0,
      contractRiskPairLockPercent: extraContext.contractRiskData?.contractRiskPairLockPercent ?? 0,
      contractRiskTopLpHolderPercent: extraContext.contractRiskData?.contractRiskTopLpHolderPercent ?? 0,
      contractRiskLpHolders: extraContext.contractRiskData?.contractRiskLpHolders ?? 0,
      contractRiskScore: extraContext.contractRiskData?.contractRiskScore ?? 0,
      contractRiskIsHoneypot: extraContext.contractRiskData?.contractRiskIsHoneypot ?? 0,
      contractRiskDexAmmType: extraContext.contractRiskData?.contractRiskDexAmmType ?? 'unknown',
      contractRiskHasCode: extraContext.contractRiskData?.contractRiskHasCode ?? 'unknown',

      // 早期参与者检查结果
      ...earlyParticipantCheck,

      // 钱包簇检查结果
      ...walletClusterCheck,

      // Twitter搜索结果
      ...twitterCheck.factors,
      _twitterRawResult: twitterCheck.rawResult,
      _twitterDuration: twitterCheck.duration,

      // 强势交易者持仓检查结果
      ...strongTraderCheck,

      // 早期参与者购买资格评估
      preTraderCanBuy: null,
      preTraderCheckReason: null
    };

    try {
      // 构建评估上下文
      const context = {
        // 早期交易者黑白名单因子（替代旧的持有者黑白名单因子）
        earlyTraderBlacklistCount: earlyTraderCheck.earlyTraderBlacklistCount || 0,
        earlyTraderWhitelistCount: earlyTraderCheck.earlyTraderWhitelistCount || 0,
        earlyTraderUniqueParticipants: earlyTraderCheck.earlyTraderUniqueParticipants || 0,
        earlyTraderBlacklistRatio: earlyTraderCheck.earlyTraderBlacklistRatio || 0,
        earlyTraderCanBuy: earlyTraderCheck.earlyTraderCanBuy ? 1 : 0,
        // 持有者因子（dev持仓、大额持仓仍基于持有者）
        holdersCount: holderCheck.holdersCount || 0,
        devHoldingRatio: holderCheck.devHoldingRatio || 0,
        maxHoldingRatio: holderCheck.maxHoldingRatio || 0,
        // 早期参与者因子 - 速率指标
        earlyTradesChecked: earlyParticipantCheck.earlyTradesChecked || 0,
        earlyTradesHighValueCount: earlyParticipantCheck.earlyTradesHighValueCount || 0,
        earlyTradesHighValuePerMin: earlyParticipantCheck.earlyTradesHighValuePerMin || 0,
        earlyTradesCountPerMin: earlyParticipantCheck.earlyTradesCountPerMin || 0,
        earlyTradesVolumePerMin: earlyParticipantCheck.earlyTradesVolumePerMin || 0,
        earlyTradesWalletsPerMin: earlyParticipantCheck.earlyTradesWalletsPerMin || 0,
        earlyTradesTotalCount: earlyParticipantCheck.earlyTradesTotalCount || 0,
        earlyTradesVolume: earlyParticipantCheck.earlyTradesVolume || 0,
        earlyTradesUniqueWallets: earlyParticipantCheck.earlyTradesUniqueWallets || 0,
        earlyTradesDataCoverage: earlyParticipantCheck.earlyTradesDataCoverage || 0,
        earlyTradesFilteredCount: earlyParticipantCheck.earlyTradesFilteredCount || 0,
        // 早期交易新增因子
        earlyTradesFinalLiquidity: earlyParticipantCheck.earlyTradesFinalLiquidity || null,
        earlyTradesDrawdownFromHighest: earlyParticipantCheck.earlyTradesDrawdownFromHighest || null,
        // 早期参与者因子 - 数据跨度
        earlyTradesActualSpan: earlyParticipantCheck.earlyTradesActualSpan || 0,
        earlyTradesRateCalcWindow: earlyParticipantCheck.earlyTradesRateCalcWindow || 1,
        // 内盘无数据标记（可能已出内盘）
        earlyTradesNoInnerData: earlyParticipantCheck.earlyTradesNoInnerData || 0,
        // 钱包累积集中度因子
        earlyTradesTop1BuyRatio: earlyParticipantCheck.earlyTradesTop1BuyRatio || 0,
        earlyTradesTop3BuyRatio: earlyParticipantCheck.earlyTradesTop3BuyRatio || 0,
        earlyTradesTop1NetHoldingRatio: earlyParticipantCheck.earlyTradesTop1NetHoldingRatio || 0,
        // 钱包簇因子
        walletClusterSecondToFirstRatio: walletClusterCheck.walletClusterSecondToFirstRatio || 0,
        walletClusterMegaRatio: walletClusterCheck.walletClusterMegaRatio || 0,
        walletClusterTop2Ratio: walletClusterCheck.walletClusterTop2Ratio || 0,
        walletClusterCount: walletClusterCheck.walletClusterCount || 0,
        walletClusterMaxSize: walletClusterCheck.walletClusterMaxSize || 0,
        walletClusterAvgSize: walletClusterCheck.walletClusterAvgSize || 0,
        walletClusterMaxClusterWallets: walletClusterCheck.walletClusterMaxClusterWallets || 0,
        // 最大区块买入金额占比因子
        walletClusterMaxBlockBuyRatio: walletClusterCheck.walletClusterMaxBlockBuyRatio || 0,
        walletClusterMaxBlockNumber: walletClusterCheck.walletClusterMaxBlockNumber || null,
        walletClusterMaxBlockBuyAmount: walletClusterCheck.walletClusterMaxBlockBuyAmount || 0,
        walletClusterTotalBuyAmount: walletClusterCheck.walletClusterTotalBuyAmount || 0,
        // 创建者Dev钱包因子（1=不在Dev列表中, 0=在Dev列表中）
        creatorIsNotBadDevWallet: creatorDevCheck.creatorIsNotBadDevWallet ?? 0,
        // Twitter因子
        twitterTotalResults: twitterCheck.factors.twitterTotalResults || 0,
        twitterQualityTweets: twitterCheck.factors.twitterQualityTweets || 0,
        twitterLikes: twitterCheck.factors.twitterLikes || 0,
        twitterRetweets: twitterCheck.factors.twitterRetweets || 0,
        twitterComments: twitterCheck.factors.twitterComments || 0,
        twitterTotalEngagement: twitterCheck.factors.twitterTotalEngagement || 0,
        twitterAvgEngagement: twitterCheck.factors.twitterAvgEngagement || 0,
        twitterVerifiedUsers: twitterCheck.factors.twitterVerifiedUsers || 0,
        twitterFollowers: twitterCheck.factors.twitterFollowers || 0,
        twitterUniqueUsers: twitterCheck.factors.twitterUniqueUsers || 0,
        twitterSearchSuccess: twitterCheck.factors.twitterSearchSuccess || false,
        twitterSearchDuration: twitterCheck.factors.twitterSearchDuration || 0,
        // 强势交易者持仓因子
        strongTraderNetPositionRatio: strongTraderCheck.strongTraderNetPositionRatio || 0,
        strongTraderTotalBuyRatio: strongTraderCheck.strongTraderTotalBuyRatio || 0,
        strongTraderTotalSellRatio: strongTraderCheck.strongTraderTotalSellRatio || 0,
        strongTraderWalletCount: strongTraderCheck.strongTraderWalletCount || 0,
        strongTraderTradeCount: strongTraderCheck.strongTraderTradeCount || 0,
        strongTraderSellIntensity: strongTraderCheck.strongTraderSellIntensity || 0,
        // 趋势因子（允许在条件表达式中使用）
        drawdownFromHighest: drawdownFromHighest ?? 0,
        // 多次交易因子（允许在条件表达式中使用）
        buyRound: extraContext.buyRound || 1,
        lastPairReturnRate: extraContext.lastPairReturnRate ?? 0,
        // 叙事分析因子（允许在条件表达式中使用）
        narrativeRating: extraContext.narrativeRating ?? 9,
        // 推文作者类型因子（允许在条件表达式中使用）
        tweetAuthorType: extraContext.tweetAuthorType ?? 0,
        // 数据采集轮数因子（允许在条件表达式中使用）
        dataCollectionRound: extraContext.dataCollectionRound ?? 0,
        // 合约审计风控因子（允许在条件表达式中使用）
        contractRiskAvailable: extraContext.contractRiskData?.contractRiskAvailable ?? 0,
        contractRiskPairLockPercent: extraContext.contractRiskData?.contractRiskPairLockPercent ?? 0,
        contractRiskTopLpHolderPercent: extraContext.contractRiskData?.contractRiskTopLpHolderPercent ?? 0,
        contractRiskLpHolders: extraContext.contractRiskData?.contractRiskLpHolders ?? 0,
        contractRiskScore: extraContext.contractRiskData?.contractRiskScore ?? 0,
        contractRiskIsHoneypot: extraContext.contractRiskData?.contractRiskIsHoneypot ?? 0,
        contractRiskDexAmmType: extraContext.contractRiskData?.contractRiskDexAmmType ?? 'unknown',
      contractRiskHasCode: extraContext.contractRiskData?.contractRiskHasCode ?? 'unknown',
        contractRiskHasCode: extraContext.contractRiskData?.contractRiskHasCode ?? 'unknown'
        // 注意：以下因子主要用于调试，通常不用于条件表达式
        // earlyTradesCheckTimestamp, earlyTradesCheckDuration, earlyTradesCheckTime
        // earlyTradesWindow, earlyTradesExpectedFirstTime, earlyTradesExpectedLastTime
        // earlyTradesDataFirstTime, earlyTradesDataLastTime
        // walletClusterCheckTimestamp, walletClusterCheckDuration
        // earlyWhaleMethod, earlyWhaleTotalTrades, earlyWhaleEarlyThreshold
      };

      const canBuy = this._safeEvaluate(condition, context);

      this.logger.info('[PreBuyCheckService] 条件表达式评估完成', {
        token_address: context.token_address,
        condition,
        canBuy,
        context: {
          earlyTraderBlacklistCount: context.earlyTraderBlacklistCount,
          earlyTraderWhitelistCount: context.earlyTraderWhitelistCount,
          devHoldingRatio: context.devHoldingRatio,
          maxHoldingRatio: context.maxHoldingRatio,
          earlyTradesHighValueCount: context.earlyTradesHighValueCount,
          earlyTradesCountPerMin: context.earlyTradesCountPerMin,
          walletClusterSecondToFirstRatio: context.walletClusterSecondToFirstRatio,
          twitterTotalResults: context.twitterTotalResults,
          twitterSearchDuration: context.twitterSearchDuration,
          narrativeRating: context.narrativeRating
        }
      });

      const result = {
        ...baseResult,
        canBuy,
        preTraderCanBuy: canBuy
      };

      // 无论成功失败，都执行详细诊断
      const diagnosis = this._diagnoseCondition(condition, context);
      result.failedConditions = diagnosis.conditionList;

      if (!canBuy) {
        result.checkReason = diagnosis.summaryReason;
      } else {
        result.checkReason = '购买前检查通过';
      }

      return result;
    } catch (error) {
      this.logger.error('[PreBuyCheckService] 条件表达式评估失败', {
        condition,
        error: error.message
      });
      return {
        ...baseResult,
        canBuy: false,
        checkReason: `条件表达式错误: ${error.message}`
      };
    }
  }

  /**
   * 默认评估逻辑（向后兼容）
   * @private
   */
  _evaluateDefault(holderCheck, earlyParticipantCheck, startTime) {
    // 构建基础结果
    const result = {
      // 标记已执行预检查
      preBuyCheck: 1,
      checkTimestamp: Date.now(),
      checkDuration: Date.now() - startTime,

      // 持有者检查结果（dev持仓、大额持仓仍基于持有者）
      holdersCount: holderCheck.holdersCount,
      devHoldingRatio: holderCheck.devHoldingRatio,
      holderCanBuy: holderCheck.canBuy,

      // 持有者检查详细原因
      holderCheckReason: holderCheck.reason,
      devCheckReason: holderCheck.devReason,

      // 早期参与者检查结果
      ...earlyParticipantCheck,

      // 早期参与者购买资格评估
      preTraderCanBuy: null,
      preTraderCheckReason: null,

      // 综合结果
      canBuy: holderCheck.canBuy,
      checkReason: holderCheck.reason
    };

    // 评估早期参与者购买资格
    if (this.config.earlyParticipantFilterEnabled && earlyParticipantCheck.earlyTradesChecked === 1) {
      const eligibility = this.earlyParticipantService.evaluateBuyEligibility(
        earlyParticipantCheck,
        this.config
      );
      result.preTraderCanBuy = eligibility.canBuy;
      result.preTraderCheckReason = eligibility.reason;

      // 综合决策：两个检查都必须通过
      result.canBuy = result.holderCanBuy && result.preTraderCanBuy;
      result.checkReason = this._buildCombinedCheckReason(
        result.holderCanBuy,
        result.preTraderCanBuy,
        holderCheck.reason,
        eligibility.reason
      );
    }

    this.logger.info('[PreBuyCheckService] 购买前检查完成', {
      holderCanBuy: result.holderCanBuy,
      preTraderCanBuy: result.preTraderCanBuy,
      canBuy: result.canBuy,
      checkReason: result.checkReason,
      devHoldingRatio: result.devHoldingRatio,
      earlyTradesTotalCount: result.earlyTradesTotalCount || 0,
      earlyTradesVolumePerMin: result.earlyTradesVolumePerMin || 0,
      earlyTradesCountPerMin: result.earlyTradesCountPerMin || 0,
      earlyTradesHighValuePerMin: result.earlyTradesHighValuePerMin || 0
    });

    return result;
  }

  /**
   * 安全的表达式评估
   * @private
   */
  _safeEvaluate(expression, context) {
    // 替换 AND/OR 为 JavaScript 运算符
    const jsExpr = expression
      .replace(/\bAND\b/gi, '&&')
      .replace(/\bOR\b/gi, '||')
      .replace(/\bNOT\b/gi, '!');

    // 使用 Function 构造器评估
    const keys = Object.keys(context);
    const values = Object.values(context);
    const fn = new Function(...keys, `return ${jsExpr};`);
    return fn(...values);
  }

  /**
   * 从条件表达式中提取因子名称
   * 例如: "earlyTraderBlacklistCount === 0" -> "earlyTraderBlacklistCount"
   * @private
   */
  _extractFactorName(expression) {
    // 匹配模式：变量名后跟操作符和值
    // 支持: variable === value, variable !== value, variable > value, variable < value, etc.
    const match = expression.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(===|!==|==|!=|>=|<=|>|<)\s*/);
    if (match) {
      return match[1];
    }
    return null;
  }

  /**
   * 从表达式中提取所有因子名
   * 例如: "(walletClusterCount < 4 || walletClusterTop2Ratio <= 0.85)"
   * -> ["walletClusterCount", "walletClusterTop2Ratio"]
   * @private
   */
  _extractAllFactorNames(expression) {
    // 去除外层括号
    let expr = expression.trim();
    if (expr.startsWith('(') && expr.endsWith(')')) {
      expr = expr.slice(1, -1).trim();
    }

    // 匹配所有变量名模式：变量名后跟操作符
    // 支持: variable === value, variable !== value, variable > value, variable < value, etc.
    const regex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:===|!==|==|!=|>=|<=|>|<)/g;
    const factorNames = new Set();
    let match;

    while ((match = regex.exec(expr)) !== null) {
      factorNames.add(match[1]);
    }

    return Array.from(factorNames);
  }

  /**
   * 解析条件表达式，提取所有原子条件
   * 例如: "earlyTraderBlacklistCount === 0 && devHoldingRatio < 15"
   * -> ["earlyTraderBlacklistCount === 0", "devHoldingRatio < 15"]
   * @private
   */
  _parseCondition(condition) {
    // 替换 AND/OR 为 JavaScript 运算符
    const jsExpr = condition
      .replace(/\bAND\b/gi, '&&')
      .replace(/\bOR\b/gi, '||')
      .replace(/\bNOT\b/gi, '!');

    // 分割条件表达式（按 && 和 || 分割）
    // 需要处理括号内的内容，避免错误分割
    const atomicConditions = [];
    let current = '';
    let depth = 0;

    for (let i = 0; i < jsExpr.length; i++) {
      const char = jsExpr[i];
      if (char === '(') depth++;
      else if (char === ')') depth--;
      else if ((char === '&' || char === '|') && depth === 0) {
        // 检查是否是 && 或 ||
        if (i + 1 < jsExpr.length && jsExpr[i + 1] === char) {
          const trimmed = current.trim();
          if (trimmed) atomicConditions.push(trimmed);
          current = '';
          i++; // 跳过下一个字符
          continue;
        }
      }
      current += char;
    }

    const trimmed = current.trim();
    if (trimmed) atomicConditions.push(trimmed);

    return atomicConditions;
  }

  /**
   * 提取条件的期望部分（用于显示）
   * 例如: "earlyTraderBlacklistCount === 0" -> "=== 0"
   * @private
   */
  _extractExpectedPart(expression) {
    // 匹配操作符和值部分
    const match = expression.match(/^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)/);
    if (match) {
      return `${match[1]} ${match[2]}`.trim();
    }
    return expression;
  }

  /**
   * 诊断条件，返回详细的条件检查结果
   * @private
   */
  _diagnoseCondition(condition, context) {
    const atomicConditions = this._parseCondition(condition);
    const conditionList = [];

    for (const expr of atomicConditions) {
      // 处理括号包裹的复杂表达式
      if (expr.startsWith('(') && expr.endsWith(')')) {
        // 尝试评估复杂条件
        try {
          const satisfied = this._safeEvaluate(expr, context);

          // 提取复杂条件中的所有因子
          const factorNames = this._extractAllFactorNames(expr);

          // 首先添加复杂条件的整体状态
          conditionList.push({
            id: `complex_${conditionList.length}`,
            name: '⚠️ 复杂条件',
            expression: expr,
            expected: expr,
            actualValue: null,
            actualFormatted: satisfied ? '✓ 满足' : '✗ 不满足',
            satisfied: satisfied,
            severity: satisfied ? 'info' : 'warning',
            margin: null,
            factorName: null,
            isComplex: true  // 标记为复杂条件
          });

          // 为复杂条件中的每个因子添加单独的显示条目
          for (const factorName of factorNames) {
            const metadata = FACTOR_METADATA[factorName];
            const actualValue = context[factorName];

            conditionList.push({
              id: `${factorName}_in_complex`,
              name: `  └─ ${metadata?.name || factorName}`,
              expression: `${factorName} = ${actualValue ?? 'N/A'}`,
              expected: '-',
              actualValue,
              actualFormatted: metadata ? metadata.format(actualValue ?? 0) : (actualValue ?? 'N/A'),
              satisfied: null,  // 因子本身没有满足/不满足的概念
              severity: 'info',
              margin: null,
              factorName,
              isSubFactor: true  // 标记为子因子
            });
          }
        } catch (e) {
          // 如果评估失败，保持原来的行为
          conditionList.push({
            id: `complex_${conditionList.length}`,
            name: '⚠️ 复杂条件',
            expression: expr,
            expected: expr,
            actualValue: null,
            actualFormatted: '(无法评估)',
            satisfied: null,
            severity: 'info',
            margin: null,
            factorName: null,
            error: e.message,
            isComplex: true
          });
        }
        continue;
      }

      const factorName = this._extractFactorName(expr);
      const metadata = factorName ? FACTOR_METADATA[factorName] : null;
      const actualValue = factorName !== null ? context[factorName] : null;

      try {
        // 单独评估这个条件
        const satisfied = this._safeEvaluate(expr, context);

        // 计算风险边际（仅对满足的条件）
        let margin = null;
        if (satisfied && factorName && actualValue !== null && actualValue !== undefined) {
          margin = this._calculateMargin(expr, actualValue);
        }

        conditionList.push({
          id: factorName || `condition_${conditionList.length}`,
          name: metadata?.name || factorName || expr,
          expression: expr,
          expected: this._extractExpectedPart(expr),
          actualValue,
          actualFormatted: metadata ? metadata.format(actualValue ?? 0) : (actualValue ?? 'N/A'),
          satisfied,
          severity: satisfied ? 'info' : (metadata?.severity || 'warning'),
          margin,  // 风险边际：'loose'=宽松, 'edge'=边缘, null=无法计算
          factorName
        });
      } catch (e) {
        // 评估失败，可能是复杂表达式
        conditionList.push({
          id: factorName || `condition_${conditionList.length}`,
          name: metadata?.name || factorName || expr,
          expression: expr,
          expected: this._extractExpectedPart(expr),
          actualValue,
          actualFormatted: metadata ? metadata.format(actualValue ?? 0) : (actualValue ?? 'N/A'),
          satisfied: null,
          severity: 'info',
          margin: null,
          factorName,
          error: e.message
        });
      }
    }

    return {
      conditionList,
      summaryReason: this._buildSummaryReason(conditionList)
    };
  }

  /**
   * 计算风险边际
   * 返回: 'loose' (宽松，距离阈值>30%), 'edge' (边缘，距离阈值<30%), null (无法计算)
   * @private
   */
  _calculateMargin(expression, actualValue) {
    // 提取操作符和阈值
    const match = expression.match(/^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)/);
    if (!match) return null;

    const operator = match[1];
    const thresholdStr = match[2].trim();
    const threshold = parseFloat(thresholdStr);

    if (isNaN(threshold) || isNaN(actualValue) || actualValue === null || actualValue === undefined) {
      return null;
    }

    // 计算距离阈值的百分比差异
    let diffPercent = null;

    switch (operator) {
      case '>':
      case '>=':
        // 例如: actualValue=15, threshold=10, diff=50%
        if (threshold !== 0) {
          diffPercent = ((actualValue - threshold) / Math.abs(threshold)) * 100;
        }
        break;
      case '<':
      case '<=':
        // 例如: actualValue=5, threshold=10, diff=50%
        if (threshold !== 0) {
          diffPercent = ((threshold - actualValue) / Math.abs(threshold)) * 100;
        }
        break;
      case '===':
      case '==':
        // 精确匹配，无边际
        return null;
      case '!==':
      case '!=':
        // 不等于匹配，无边际
        return null;
      default:
        return null;
    }

    if (diffPercent === null || isNaN(diffPercent)) {
      return null;
    }

    // 边际判断：30%以上为宽松，以下为边缘
    return diffPercent >= 30 ? 'loose' : 'edge';
  }

  /**
   * 构建简化的失败原因摘要
   * @private
   */
  _buildSummaryReason(failedList) {
    // 只显示不满足的关键条件
    const criticalFailed = failedList.filter(f => !f.satisfied && f.severity === 'critical');
    const warningFailed = failedList.filter(f => !f.satisfied && f.severity === 'warning');

    const parts = [];

    for (const item of criticalFailed) {
      parts.push(`${item.name}失败(${item.actualFormatted})`);
    }

    for (const item of warningFailed) {
      parts.push(`${item.name}不满足(${item.actualFormatted})`);
    }

    if (parts.length === 0) {
      // 如果没有明确的失败条件，返回第一个不满足的条件
      const anyFailed = failedList.find(f => f.satisfied === false);
      if (anyFailed) {
        return `${anyFailed.name}不满足(${anyFailed.actualFormatted})`;
      }
      return '条件表达式评估失败';
    }

    return parts.join(', ');
  }

  /**
   * 执行持有者检查
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {string} creatorAddress - 创建者地址
   * @param {string} experimentId - 实验ID
   * @param {string} signalId - 信号ID
   * @param {string} chain - 区块链
   * @param {boolean} skipHolderCheck - 是否跳过检查（回测时为 true）
   */
  async _performHolderCheck(tokenAddress, creatorAddress, experimentId, signalId, chain, skipHolderCheck = false) {
    if (skipHolderCheck || !this.config.holderCheckEnabled) {
      const reason = skipHolderCheck ? '持有者检查已跳过（回测模式）' : '持有者检查已禁用';
      return {
        canBuy: true,
        whitelistCount: 0,
        blacklistCount: 0,
        holdersCount: 0,
        devHoldingRatio: 0,
        maxHoldingRatio: 0,
        reason: reason,
        blacklistReason: '检查已跳过',
        devReason: '检查已跳过',
        largeHoldingReason: '检查已跳过'
      };
    }

    return await this.holderService.checkAllHolderRisks(
      tokenAddress,
      creatorAddress,
      experimentId,
      signalId,
      chain,
      this.config.devHoldingThreshold,
      this.config.largeHoldingThreshold
    );
  }

  /**
   * 执行早期参与者检查
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {string} chain - 区块链
   * @param {Object} tokenInfo - 代币信息（只需要 innerPair）
   * @param {number} checkTime - 检查时间戳（秒），用于回测时指定历史时间点
   * @param {boolean} skipEarlyParticipant - 是否跳过检查
   */
  async _performEarlyParticipantCheck(tokenAddress, chain, tokenInfo, checkTime = null, skipEarlyParticipant = false, totalSupply = 0) {
    if (skipEarlyParticipant || !this.config.earlyParticipantCheckEnabled) {
      return this.earlyParticipantService.getEmptyFactorValues();
    }

    // 早期参与者检查只需要 innerPair，不再需要 launchAt
    // 没有 innerPair 时返回通过值（可能已出内盘），而不是0值阻止购买
    if (!tokenInfo || !tokenInfo.innerPair) {
      this.logger.info('[PreBuyCheckService] 缺少内盘交易对信息，使用通过默认值（可能已出内盘）', {
        token_address: tokenAddress,
        has_inner_pair: !!tokenInfo?.innerPair
      });
      return this.earlyParticipantService._getEmptyResult();
    }

    // 使用传入的 checkTime，如果没有则使用当前时间
    const effectiveCheckTime = checkTime || Math.floor(Date.now() / 1000);

    return await this.earlyParticipantService.performCheck(
      tokenAddress,
      tokenInfo.innerPair,
      chain,
      null,  // launchAt 参数已不再使用
      effectiveCheckTime,
      totalSupply
    );
  }

  /**
   * 执行钱包簇检查
   * @private
   * @param {Object} earlyParticipantCheck - 早期参与者检查结果（包含 trades 数据）
   * @param {string} tokenAddress - 代币地址（用于区分买入/卖出）
   * @returns {Object} 钱包簇检查结果
   */
  async _performWalletClusterCheck(earlyParticipantCheck = null, tokenAddress = null) {
    // 从早期参与者检查结果中获取交易数据
    const trades = earlyParticipantCheck?._trades;

    if (!trades || trades.length === 0) {
      return this.walletClusterService.getEmptyFactorValues();
    }

    try {
      // 使用早期参与者检查已经获取的交易数据，传递代币地址
      return this.walletClusterService.performClusterAnalysis(trades, tokenAddress);
    } catch (error) {
      this.logger.error('[PreBuyCheckService] 钱包簇检查失败', {
        error: error.message
      });
      return this.walletClusterService.getEmptyFactorValues();
    }
  }

  /**
   * 执行Twitter搜索检查
   * @private
   * @param {string} tokenAddress - 代币地址
   * @returns {Object} Twitter搜索结果
   */
  async _performTwitterSearch(tokenAddress) {
    const startTime = Date.now();
    try {
      this.logger.debug('[PreBuyCheckService] 开始Twitter搜索', { token_address: tokenAddress });
      const result = await this.twitterSearchService.performCheck(tokenAddress);
      this.logger.debug('[PreBuyCheckService] Twitter搜索完成', {
        token_address: tokenAddress,
        success: result.success,
        duration: result.duration,
        factors_count: Object.keys(result.factors || {}).length
      });
      return result;
    } catch (error) {
      this.logger.error('[PreBuyCheckService] Twitter搜索检查失败', {
        token_address: tokenAddress,
        error: error.message,
        stack: error.stack
      });
      // 返回空因子值
      return {
        success: false,
        factors: this.twitterSearchService.getEmptyFactors(Date.now() - startTime, error.message),
        rawResult: null,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }

  /**
   * 获取空的Twitter搜索检查结果（用于回测时跳过Twitter搜索）
   * @private
   * @returns {Object} 空的Twitter搜索结果
   */
  _getEmptyTwitterCheck() {
    return {
      success: false,
      factors: {
        twitterTotalResults: 0,
        twitterQualityTweets: 0,
        twitterLikes: 0,
        twitterRetweets: 0,
        twitterComments: 0,
        twitterTotalEngagement: 0,
        twitterAvgEngagement: 0,
        twitterVerifiedUsers: 0,
        twitterFollowers: 0,
        twitterUniqueUsers: 0,
        twitterSearchSuccess: false,
        twitterSearchDuration: 0,
        twitterSearchError: 'Skipped in backtest'
      },
      rawResult: null,
      duration: 0,
      error: 'Skipped in backtest'
    };
  }

  /**
   * 执行强势交易者持仓检查
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {Object} earlyParticipantCheck - 早期参与者检查结果（包含 _trades 数据）
   * @returns {Promise<Object>} 强势交易者持仓检查结果
   */
  async _performStrongTraderPositionCheck(tokenAddress, earlyParticipantCheck = null) {
    // 从早期参与者检查结果中获取交易数据（复用，避免重复API调用）
    const trades = earlyParticipantCheck?._trades;

    if (!trades || trades.length === 0) {
      this.logger.warn('[PreBuyCheckService] 缺少早期交易数据，跳过强势交易者持仓检查', {
        token_address: tokenAddress,
        has_trades: !!trades,
        trades_count: trades?.length || 0
      });
      return this.strongTraderPositionService.getEmptyFactorValues();
    }

    try {
      this.logger.debug('[PreBuyCheckService] 开始强势交易者持仓检查', {
        token_address: tokenAddress,
        trades_count: trades.length
      });

      // 使用早期参与者检查已经获取的交易数据进行分析
      const result = this.strongTraderPositionService.analyzeFromTrades(
        tokenAddress,
        trades
      );

      this.logger.debug('[PreBuyCheckService] 强势交易者持仓检查完成', {
        token_address: tokenAddress,
        net_position_ratio: result.strongTraderNetPositionRatio,
        wallet_count: result.strongTraderWalletCount,
        trade_count: result.strongTraderTradeCount,
        total_trades_analyzed: trades.length
      });

      return result;
    } catch (error) {
      this.logger.error('[PreBuyCheckService] 强势交易者持仓检查失败', {
        token_address: tokenAddress,
        error: error.message
      });
      return this.strongTraderPositionService.getEmptyFactorValues();
    }
  }

  /**
   * 构建综合检查原因
   * @private
   */
  _buildCombinedCheckReason(holderCanBuy, preTraderCanBuy, holderReason, preTraderReason) {
    const reasons = [];

    if (!holderCanBuy) {
      reasons.push(`持有者: ${holderReason}`);
    }

    if (!preTraderCanBuy) {
      reasons.push(`早期参与者: ${preTraderReason}`);
    }

    if (reasons.length === 0) {
      return '所有检查通过';
    }

    return reasons.join(' | ');
  }

  /**
   * 获取未执行检查时的默认因子值
   * @returns {Object} 默认因子值
   */
  getEmptyFactorValues() {
    return {
      preBuyCheck: 0,
      checkTimestamp: null,
      checkDuration: null,
      holdersCount: 0,
      devHoldingRatio: 0,
      maxHoldingRatio: 0,
      holderCanBuy: null,
      // 早期交易者黑白名单因子
      earlyTraderBlacklistCount: 0,
      earlyTraderWhitelistCount: 0,
      earlyTraderUniqueParticipants: 0,
      earlyTraderBlacklistRatio: 0,
      earlyTraderCanBuy: null,
      preTraderCanBuy: null,
      preTraderCheckReason: null,
      // 创建者Dev钱包检查（默认值：null 表示未检查）
      creatorIsNotBadDevWallet: null,
      // 多次交易因子（默认值）
      buyRound: 1,
      lastPairReturnRate: 0,
      // 叙事分析因子（默认值）
      narrativeRating: 9,
      // 推文作者类型因子（0=普通, 1=A级SuperIP, 2=S级SuperIP）
      tweetAuthorType: 0,
      // 数据采集轮数因子
      dataCollectionRound: 0,
      // 合约审计风控因子
      contractRiskAvailable: 0,
      contractRiskPairLockPercent: 0,
      contractRiskTopLpHolderPercent: 0,
      contractRiskLpHolders: 0,
      contractRiskScore: 0,
      contractRiskIsHoneypot: 0,
      contractRiskDexAmmType: 'unknown',
      contractRiskHasCode: 'unknown',
      ...this.earlyParticipantService.getEmptyFactorValues(),
      ...this.walletClusterService.getEmptyFactorValues(),
      // Twitter因子
      twitterTotalResults: 0,
      twitterQualityTweets: 0,
      twitterLikes: 0,
      twitterRetweets: 0,
      twitterComments: 0,
      twitterTotalEngagement: 0,
      twitterAvgEngagement: 0,
      twitterVerifiedUsers: 0,
      twitterFollowers: 0,
      twitterUniqueUsers: 0,
      twitterSearchSuccess: false,
      twitterSearchDuration: 0,
      twitterSearchError: null,
      // 强势交易者持仓因子
      ...this.strongTraderPositionService.getEmptyFactorValues()
    };
  }

  /**
   * 检查创建者是否为坏Dev钱包
   * @private
   * @param {string} creatorAddress - 创建者地址
   * @returns {Promise<Object>} { creatorIsNotBadDevWallet: number } 1=不在Dev列表中（好）, 0=在Dev列表中（坏）
   */
  async _checkCreatorIsNotBadDevWallet(creatorAddress) {
    // 数据异常（无创建者地址）时，默认给 1（通过）
    if (!creatorAddress) {
      this.logger.info('[PreBuyCheckService] 创建者地址为空，默认通过', {
        creator_address: creatorAddress
      });
      return { creatorIsNotBadDevWallet: 1 };
    }

    try {
      const walletService = new WalletDataService();
      const allWallets = await walletService.getWallets();
      const devWallets = allWallets.filter(w => w.category === 'dev');

      const isBadDevWallet = devWallets.some(
        w => w.address.toLowerCase() === creatorAddress.toLowerCase()
      );

      // 1 = 不在Dev列表中（好）, 0 = 在Dev列表中（坏）
      const result = isBadDevWallet ? 0 : 1;

      this.logger.info('[PreBuyCheckService] 创建者Dev钱包检查完成', {
        creator_address: creatorAddress,
        is_bad_dev_wallet: isBadDevWallet,
        creatorIsNotBadDevWallet: result
      });

      return { creatorIsNotBadDevWallet: result };
    } catch (error) {
      this.logger.error('[PreBuyCheckService] 创建者Dev钱包检查失败', {
        creator_address: creatorAddress,
        error: error.message
      });
      // 检查失败时保守处理，返回 1（不拒绝）
      return { creatorIsNotBadDevWallet: 1 };
    }
  }

  /**
   * 安全地获取错误消息
   * @private
   */
  _safeGetErrorMessage(error) {
    if (!error) return '未知错误';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    if (error.error) return error.error;
    return String(error);
  }
}

module.exports = { PreBuyCheckService };
