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
const { WalletLabelService } = require('./WalletLabelService');
const { ConditionEvaluator } = require('../../strategies/ConditionEvaluator');
const { SameNameTokenService } = require('./SameNameTokenService');

const StrongTraderPositionService = require('./StrongTraderPositionService');

/**
 * 因子元数据配置
 * 用于诊断失败条件时显示友好的名称和格式化
 */
const FACTOR_METADATA = {
  // 同叙事龙头因子（narrativeLeaderHot：1=同源推文下已有代币峰值涨幅>=5x 且判定时刻在其首达后24h内）
  narrativeLeaderHot: {
    name: '同叙事龙头已火',
    format: v => v ? '是' : '否',
    unit: '',
    severity: 'critical'
  },
  narrativeLeaderCount: {
    name: '同叙事候选代币数',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
  narrativeLeaderMaxMultiple: {
    name: '同叙事龙头峰值倍数',
    format: v => v.toFixed(1),
    unit: 'x',
    severity: 'info'
  },
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
  // [已停用] 持有者检查因子 — 回测时获取的是最新数据而非历史快照
  // holdersCount: {
  //   name: '持有者总数',
  //   format: v => v.toString(),
  //   unit: '',
  //   severity: 'info'
  // },
  // devHoldingRatio: {
  //   name: 'Dev持仓比例',
  //   format: v => v.toFixed(1) + '%',
  //   unit: '%',
  //   severity: 'critical'
  // },
  // maxHoldingRatio: {
  //   name: '最大持仓比例',
  //   format: v => v.toFixed(1) + '%',
  //   unit: '%',
  //   severity: 'critical'
  // },
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
  // 同额度买入簇因子（sybil 批量钱包拦截，作弊票案 2026-09-27）
  earlyTradesUniformBuyClusterRatio: {
    name: '同额度买入簇占比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'critical'
  },
  earlyTradesUniformBuyWallets: {
    name: '非尘埃买入钱包数',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
  // 每钱包笔数因子（对倒高频作业拦截，猪五花案 2026-10-15）
  earlyTradesPerWallet: {
    name: '每钱包交易笔数',
    format: v => v.toFixed(2) + ' 笔/钱包',
    unit: '',
    severity: 'critical'
  },
  earlyTradesMaxWalletTrades: {
    name: '单钱包最大笔数',
    format: v => v.toString() + ' 笔',
    unit: '个',
    severity: 'warning'
  },
  // sniper 持仓比例因子（虚假流动性拦截，显化之歌案 2026-09-29）
  earlyTradesSniperHoldingPct: {
    name: 'sniper 持仓占比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'critical'
  },
  earlyTradesSniperWallets: {
    name: 'sniper 持仓钱包数',
    format: v => v.toString(),
    unit: '个',
    severity: 'warning'
  },
  earlyTradesSniperHolders: {
    name: '窗口正持仓钱包数',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
  // top1 买入集中度因子（单钱包主导拦截，buy-dominance 案 2026-09-29）
  earlyTradesTop1BuySharePct: {
    name: 'top1 买入占比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'critical'
  },
  earlyTradesTop1BuyBnb: {
    name: 'top1 钱包买入额',
    format: v => v.toFixed(2) + ' BNB',
    unit: 'BNB',
    severity: 'warning'
  },
  earlyTradesBuyBnb: {
    name: '窗口总买入额',
    format: v => v.toFixed(2) + ' BNB',
    unit: 'BNB',
    severity: 'info'
  },
  // 聚合路由占比因子（GMGN 主导盘拦截，0x1de460 案 2026-09-30）
  earlyTradesRouterPct: {
    name: '聚合路由买入占比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'critical'
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
  // 钱包集中度因子
  walletTop3VolumeRatio: {
    name: '前3钱包交易量占比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  walletTop1VolumeRatio: {
    name: '最大单钱包交易量占比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  walletTop3TradeRatio: {
    name: '前3钱包交易次数占比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  walletTop1TradeRatio: {
    name: '最大单钱包交易次数占比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  walletDiversityIndex: {
    name: '钱包多样性指数',
    format: v => v.toFixed(3),
    unit: '',
    severity: 'info'
  },
  oneShotBuyerRatio: {
    name: '一次性买家占比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'info'
  },
  maxBlockBuyRatio: {
    name: '最大区块买入占比',
    format: v => (v * 100).toFixed(1) + '%',
    unit: '',
    severity: 'warning'
  },
  // 钱包标签因子
  walletLabelHasFresh: {
    name: '早期交易者中有新钱包',
    format: v => v ? '是' : '否',
    unit: '',
    severity: 'warning'
  },
  walletLabelProfitableRatio: {
    name: '标签钱包盈利占比',
    format: v => (v * 100).toFixed(1) + '%',
    unit: '',
    severity: 'info'
  },
  walletLabelBuySellRatio: {
    name: '标签钱包买卖比',
    format: v => v.toFixed(2),
    unit: '',
    severity: 'info'
  },
  walletLabelMatchCount: {
    name: '标签钱包匹配数',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
  walletLabelOnlyBuyRatio: {
    name: '标签钱包只买不卖占比',
    format: v => (v * 100).toFixed(1) + '%',
    unit: '',
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
  // 早晚票语料滞后秒（0fed29f9 案 2026-10-08）：token 出生锚 − 语料最早推文时间；
  // 负值 = 宣告竞态（token 先于推文，事件原创点）；null = 无语料时间（晚票门 fail-closed）
  narrativeCorpusLagSec: {
    name: '语料滞后秒数',
    format: v => v == null ? '无语料' : `${v}s`,
    unit: 's',
    severity: 'warning'
  },
  // fire 因子 earlyReturn 注入（首价锚以来涨幅 %；晚票门右臂「用户认同」证据）
  earlyReturn: {
    name: '早期涨幅',
    format: v => v == null ? '无锚' : `${v.toFixed(1)}%`,
    unit: '%',
    severity: 'info'
  },
  // GMGN 风险因子（x-0 案：直调语境同次 getTokenInfo 带出；covered=0=未查放行）
  gmgnIssuerTokenCount: {
    name: 'GMGN发币账号历史币数',
    format: v => v.toString(),
    unit: '个',
    severity: 'critical'
  },
  gmgnBundlerWalletRatio: {
    name: 'GMGN捆绑钱包占比',
    format: v => v.toFixed(1) + '%',
    unit: '',
    severity: 'critical'
  },
  gmgnVisitingCount: {
    name: 'GMGN实时访问人数',
    format: v => v.toString(),
    unit: '人',
    severity: 'info'
  },
  // 严格同名代币因子（AVE 检索；strictSameNameMaxFDV = 严格同名（排除自己）且
  // 过滤 AVE 虚假数据后的最大 FDV，用于"同名老币已存在且市值不低"拒买门）
  strictSameNameMaxFDV: {
    name: '同名老币最大市值',
    format: v => '$' + (v / 1000).toFixed(0) + 'k',
    unit: '',
    severity: 'critical'
  },
  strictSameNameTokenCount: {
    name: '严格同名代币数',
    format: v => v.toString(),
    unit: '个',
    severity: 'info'
  },
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
  },
  // 已知因子合取项短路（2026-10-12 P4a 回测性能案，第三层画像定因）：默认 false
  // （实时引擎零变化）；BacktestEngine 构造时按 backtest.knownFactorShortCircuit
  // ?? true 传入。语义见 _evaluateKnownFalseTerm 头注释
  knownFactorShortCircuit: false,
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
    // 初始化早期参与者检查服务（传入 supabase 用于存储数据）
    const earlyParticipantConfig = {
      calculateGrowthScore: false  // 暂不计算增长评分
    };
    if (this.config.earlyTradesLookbackSeconds !== undefined) {
      earlyParticipantConfig.fixedWindowSeconds = this.config.earlyTradesLookbackSeconds;
    }
    this.earlyParticipantService = new EarlyParticipantCheckService(logger, earlyParticipantConfig, supabase);

    // 初始化钱包簇检查服务
    // 默认使用区块号聚簇（比时间戳更准确）
    // 如果需要使用时间戳聚簇，配置 useTimeBasedClustering: true
    const clusterMode = this.config.useTimeBasedClustering ? 'time' : 'block';
    const clusterConfig = {
      mode: clusterMode,
      clusterBlockThreshold: this.config.clusterBlockThreshold || 7
    };
    this.walletClusterService = new WalletClusterService(logger, clusterConfig);

    // 初始化强势交易者持仓服务
    this.strongTraderPositionService = new StrongTraderPositionService();

    // 初始化钱包标签因子服务
    this.walletLabelService = new WalletLabelService(supabase, logger);

    // 初始化严格同名代币检查服务（AVE 检索"同名老币已存在"信号）
    // P1-5（bc4f756e 性能案）：AVE 搜索结果实例级 TTL 缓存（preBuyCheck.
    // sameNameSearchCacheTtlSec，默认 0=off 零变化）——回测重复 fire 同 token
    // 时同 symbol 搜索 ~47:1 重复，省外部 API roundtrip
    this.sameNameTokenService = new SameNameTokenService(logger, {
      searchCacheTtlSec: this.config?.sameNameSearchCacheTtlSec,
      // 快照写端（AVE 同名 as-of 存档，2026-10-12 用户裁定）：实时/实盘引擎每次
      // 真调 AVE 成功后 append 写 ave_same_name_snapshots（全局资产），回测同名
      // 因子改以历史快照为主数据源。写失败在 service 内 warn 不抛（不阻断决策）
      snapshotWriter: this.supabase ? {
        insert: async (row) => {
          const { error } = await this.supabase.from('ave_same_name_snapshots').insert(row);
          if (error) throw new Error(error.message);
        },
      } : null,
    });

    // 初始化条件评估器
    this._conditionEvaluator = new ConditionEvaluator();
  }

  /**
   * 初始化服务（加载缓存等）
   * @param {string} chain - 区块链标识，如 'solana', 'bsc'
   * @returns {Promise<void>}
   */
  async initialize(chain = 'bsc') {
    await this.holderService.initWalletCache(chain);
    await this.walletLabelService.initLabelCache(chain);
    this.logger.info('[PreBuyCheckService] 服务初始化完成', { chain });
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
   * @param {number} options.tokenBuyTime - 代币首次买入时间戳（毫秒），用于判断是否有历史交易记录
   * @param {number} options.drawdownFromHighest - 从最高价跌幅（%），负数表示下跌
   * @returns {Promise<Object>} 检查结果
   */
  async performAllChecks(tokenAddress, creatorAddress, experimentId, signalId, chain = 'bsc', tokenInfo = null, preBuyCheckCondition = null, options = {}) {
    const startTime = Date.now();
    const { checkTime, skipHolderCheck, skipEarlyParticipant, tokenBuyTime, drawdownFromHighest, buyRound, lastPairReturnRate, narrativeRating, narrativeCorpusLagSec, earlyReturn, narrativeLeaderHot, narrativeLeaderCount, narrativeLeaderMaxMultiple, tweetAuthorType, dataCollectionRound, totalSupply, sourceExperimentId, gmgnIssuerTokenCount, gmgnBundlerWalletRatio, gmgnRiskCovered, gmgnVisitingCount, earlyTradesRouterLowSideSeen, earlyTradesRouterRejectCount, gmgnUserPct } = options;

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
      buy_round: buyRound || 1,
      last_pair_return_rate: lastPairReturnRate ?? 0
    });

    try {
      // ── 已知因子合取项短路（P4a，2026-10-12 回测性能第三层画像）──
      // 条件顶层 AND 链中存在「全部因子检查前已知且当次评估为 false」的合取项 →
      // 整条条件恒 false，检查结果必然 canBuy=false → 跳过全部子检查直接拒绝
      // （等价性论证见 _evaluateKnownFalseTerm 头注释）。典型形状：rating=1 的
      // 宣告竞态盘在豁免窗内每 fire 重走全链，而 (narrativeRating == 2 OR == 3)
      // 恒 false——83ms/次全链纯浪费（perf3 实测 44.5% 检查属此形）
      if (String(preBuyCheckCondition || '').trim() !== '') {
        const shortCircuitTerm = this._evaluateKnownFalseTerm(preBuyCheckCondition, options);
        if (shortCircuitTerm) {
          this._seg('shortCircuits', 0);
          this.logger.info('[PreBuyCheckService] 已知因子合取项短路（跳过全链检查）', {
            token_address: tokenAddress, term: shortCircuitTerm,
          });
          return {
            ...this._buildFailedResult(startTime, `已知因子恒假短路: ${shortCircuitTerm}`, options),
            shortCircuited: true,
          };
        }
      }

      // P10 早发并发（2026-10-13 perf11 画像：preBuy 109.2s = early 65.8s 与五项
      // 45.4s 顺序串行堆叠，其中 sameName 的 AVE 网络 44.9s 与 early 内的 sniper
      // 画像查询/六族因子计算互不依赖却互相等待）：holder/creator/sameName 三项
      // 不消费 early 产物，与 early 同时发起；cluster/strong 消费
      // earlyParticipantCheck._trades 必须等 early 完成后再发。决策输入零变化——
      // 同一批 service 调用仅发起时点提前（_performEarlyParticipantCheck 无 throw
      // 路径：performCheck 内部 catch 返回空统计），早发 promise 仍由 Promise.all
      // 原样收集；catch sink 是旁支防结构性不可达的 unhandled rejection，不影响
      // Promise.all 的拒绝传播
      const _timed = (key, p) => {
        const t0 = Date.now();
        const done = () => this._seg(key, Date.now() - t0);
        return Promise.resolve(p).then(r => { done(); return r; }, e => { done(); throw e; });
      };
      const holderP = _timed('parHolder', this._performHolderCheck(tokenAddress, creatorAddress, experimentId, signalId, chain, skipHolderCheck));
      holderP.catch(() => {});
      const creatorP = _timed('parCreator', this._checkCreatorIsNotBadDevWallet(creatorAddress));
      creatorP.catch(() => {});
      const sameNameP = _timed('parSameName', this._performSameNameCheck(tokenAddress, tokenInfo, { checkTime, sourceExperimentId }));
      sameNameP.catch(() => {});

      // 先执行早期参与者检查（获取交易数据）
      // P7 分段计时（2026-10-13 preBuy 284s 定因）：early=早期参与者全链（含回放
      // 切片+因子计算，子服务另有 fetch 拆分）/ parallel=early 完成后的余量段
      //（P10 后三项已与 early 重叠，此段≈cluster/strong CPU+残余等待）/ eval=
      // 黑白名单+条件评估。三段+短路计数汇入 getPerfStats，回放收尾与六段分布
      // 一起打印；纯 Date.now 计时零行为变化
      const _segT0 = Date.now();
      const earlyParticipantCheck = await this._performEarlyParticipantCheck(
        tokenAddress, chain, tokenInfo, checkTime, skipEarlyParticipant, totalSupply
      );
      this._seg('earlyMs', Date.now() - _segT0);

      // 并行收集五项：holder/creator/sameName 已在 early 前发起（见上），此处仅
      // 补发依赖 early 产物的 cluster/strong 并等待全部完成。P8 五项各自计时
      // 保留（wrapper 从发起点计到完成，早发三项的耗时大部分落在 early 重叠区，
      // parallelMs 不再包含它们——诊断口径变化，决策零影响）
      const _parT0 = Date.now();
      const [holderCheck, walletClusterCheck, creatorDevCheck, strongTraderCheck, sameNameCheck] = await Promise.all([
        holderP,
        _timed('parCluster', this._performWalletClusterCheck(earlyParticipantCheck, tokenAddress)),
        creatorP,
        _timed('parStrong', this._performStrongTraderPositionCheck(tokenAddress, earlyParticipantCheck)),
        sameNameP,
      ]);
      this._seg('parallelMs', Date.now() - _parT0);

      // 钱包标签因子（纯内存计算，无 IO）——P8 同样计时（P7 三段外的漏计段）
      const _labT0 = Date.now();
      const walletLabelCheck = this.walletLabelService.calculateLabelFactors(earlyParticipantCheck._trades);
      this._seg('labelMs', Date.now() - _labT0);

      // 如果没有提供条件表达式，默认通过（不执行任何检查）
      // 确保 preBuyCheckCondition 是字符串类型，防止 .trim() 调用失败
      if (!preBuyCheckCondition || String(preBuyCheckCondition).trim() === '') {
        preBuyCheckCondition = 'true';  // 设置为 true 以便后续通过评估
      } else {
        preBuyCheckCondition = String(preBuyCheckCondition).trim();
      }

      // 早期交易者黑白名单检查（基于交易参与者，而非持有者）
      const _evalT0 = Date.now();
      const earlyTraderCheck = await this.holderService.checkEarlyTradersRisk(earlyParticipantCheck._trades);

      // 使用条件表达式评估
      const _evalResult = this._evaluateWithCondition(
        holderCheck,
        earlyParticipantCheck,
        walletClusterCheck,
        walletLabelCheck,
        creatorDevCheck,
        strongTraderCheck,
        earlyTraderCheck,
        preBuyCheckCondition,
        startTime,
        options.drawdownFromHighest,  // 传入 drawdownFromHighest
        sameNameCheck,
        {
          buyRound: options.buyRound,
          lastPairReturnRate: options.lastPairReturnRate,
          narrativeRating: narrativeRating,
          // 早晚票分级（0fed29f9 案 2026-10-08）：引擎侧算好透传；null=无语料时间 →
          // null 比较恒 false → 落晚票严格门（fail-closed，与龙头门 fail-open 方向相反：
          // 早票是「有证据才放行」的证据门）
          narrativeCorpusLagSec: narrativeCorpusLagSec ?? null,
          // fire 因子 earlyReturn 注入（drawdownFromHighest 同款先例）：晚票门右臂
          // `earlyReturn >= N` 的「用户认同」证据；null=无首价锚（罕见）
          earlyReturn: earlyReturn ?? null,
          // fire 因子 gmgnUserPct 注入（2026-10-16 Yoon 案用户裁定：u40 门从 fire
          // condition 挪进 preBuy——低 GMGN 占比票 fire 落行留审计痕迹，被本门拒）：
          // FA 实时净持仓量加权占比的 fire 时点快照；null=无 TPA 段（_maintainTpa
          // false 不算）→ 条件恒 false fail-closed，与小王子案 u40 语义一致
          gmgnUserPct: gmgnUserPct ?? null,
          narrativeLeaderHot: narrativeLeaderHot,
          narrativeLeaderCount: narrativeLeaderCount,
          narrativeLeaderMaxMultiple: narrativeLeaderMaxMultiple,
          tweetAuthorType: tweetAuthorType,
          dataCollectionRound: dataCollectionRound,
          // GMGN 风险因子（x-0 案，引擎侧 mapGmgnRiskFactors 算好透传）
          gmgnIssuerTokenCount: gmgnIssuerTokenCount,
          gmgnBundlerWalletRatio: gmgnBundlerWalletRatio,
          gmgnRiskCovered: gmgnRiskCovered,
          gmgnVisitingCount: gmgnVisitingCount,
          // 平台标签（router 平台分门，2026-10-02）：引擎/回测侧透传
          // 'fourmeme'/'flap'；null 语义 = 未知平台（分门 fail-closed 落 router 门）
          platform: options.platform ?? null,
          // router 门观察史因子（2026-10-03）：引擎侧 per-token 状态透传（router-gate-state.js）；
          // null=未维护/非 flap——门写法 `== 0 OR IS NULL` / `<= N OR IS NULL` fail-open
          earlyTradesRouterLowSideSeen: earlyTradesRouterLowSideSeen ?? null,
          earlyTradesRouterRejectCount: earlyTradesRouterRejectCount ?? null,
        }
      );
      this._seg('evalMs', Date.now() - _evalT0);
      return _evalResult;
    } catch (error) {
      const errorMessage = this._safeGetErrorMessage(error);

      this.logger.error('[PreBuyCheckService] 购买前检查失败', {
        token_address: tokenAddress,
        creator_address: creatorAddress,
        error: errorMessage
      });

      // 出错时返回不可购买的结果
      return this._buildFailedResult(startTime, `购买前检查失败: ${errorMessage}`, options, errorMessage);
    } finally {
      // P1 计时子计数器（2026-10-12 回测性能案）：performAllChecks 全链耗时累计
      //（含全部子检查 await；成功/失败两路径都计），回放收尾与主循环六段分布一起打印
      this._perfMs = (this._perfMs || 0) + (Date.now() - startTime);
      this._perfCalls = (this._perfCalls || 0) + 1;
    }
  }

  /** preBuy 计时子计数器（P1 探针 2026-10-12 回测性能案，回放收尾汇总用） */
  getPerfStats() {
    const s = this._perfSeg || {};
    return {
      calls: this._perfCalls || 0, ms: this._perfMs || 0,
      shortCircuits: s.shortCircuits || 0,
      earlyMs: s.earlyMs || 0, parallelMs: s.parallelMs || 0, evalMs: s.evalMs || 0,
      // P8 五项拆分 + label（...s 兜底透传未列新键）
      parHolder: s.parHolder || 0, parCluster: s.parCluster || 0, parCreator: s.parCreator || 0,
      parStrong: s.parStrong || 0, parSameName: s.parSameName || 0, labelMs: s.labelMs || 0,
    };
  }

  /** P7 分段计时累计器（见 performAllChecks 内注释；短路计数 delta 传 0） */
  _seg(key, delta) {
    if (!this._perfSeg) this._perfSeg = { shortCircuits: 0, earlyMs: 0, parallelMs: 0, evalMs: 0 };
    if (delta > 0) this._perfSeg[key] = (this._perfSeg[key] || 0) + delta;
    else this._perfSeg[key]++;
  }

  /**
   * 检查失败/短路的统一返回形状（P4a 从 performAllChecks catch 分支抽出共用：
   * canBuy=false + 全因子空值——下游 buildPreBuyCheckFactorValues / router 门
   * 回填（earlyTradesRouterPct 不存在→不回填）对两路径行为一致）
   * @private
   */
  _buildFailedResult(startTime, reason, options = {}, detail = reason) {
    return {
      preBuyCheck: 1,
      checkTimestamp: Date.now(),
      checkDuration: Date.now() - startTime,

      // [已停用] 持有者检查因子
      // holdersCount: 0,
      // devHoldingRatio: 0,
      // maxHoldingRatio: 0,
      // holderCanBuy: false,

      // 早期交易者黑白名单因子
      earlyTraderBlacklistCount: 0,
      earlyTraderWhitelistCount: 0,
      earlyTraderUniqueParticipants: 0,
      earlyTraderBlacklistRatio: 0,
      earlyTraderCanBuy: false,

      holderCheckReason: `检查失败: ${detail}`,
      blacklistReason: `检查失败: ${detail}`,
      devCheckReason: `检查失败: ${detail}`,

      canBuy: false,
      checkReason: reason,

      // 多次交易因子（默认值）
      buyRound: options.buyRound || 1,
      lastPairReturnRate: options.lastPairReturnRate ?? 0,
      // 同叙事龙头因子（默认 0=未查/无源推文；fail-open 放行，默认值用 0 不用 null——
      // ConditionEvaluator null 比较恒 false，null 会让 ==0 门误拒）
      narrativeRating: options.narrativeRating ?? 9,
      // 早晚票语料滞后秒（检查失败空值；null → 晚票门 fail-closed 同正常路径语义）
      narrativeCorpusLagSec: options.narrativeCorpusLagSec ?? null,
      earlyReturn: options.earlyReturn ?? null,
      narrativeLeaderHot: options.narrativeLeaderHot ?? 0,
      narrativeLeaderCount: options.narrativeLeaderCount ?? 0,
      narrativeLeaderMaxMultiple: options.narrativeLeaderMaxMultiple ?? 0,
      // GMGN 风险因子（默认 0 放行——未触发/失败/未索引，fail-open 与龙头门同方向）
      gmgnIssuerTokenCount: options.gmgnIssuerTokenCount ?? 0,
      gmgnBundlerWalletRatio: options.gmgnBundlerWalletRatio ?? 0,
      gmgnRiskCovered: options.gmgnRiskCovered ?? 0,
      gmgnVisitingCount: options.gmgnVisitingCount ?? 0,
      // 推文作者类型因子
      tweetAuthorType: options.tweetAuthorType ?? 0,
      // 数据采集轮数因子
      dataCollectionRound: options.dataCollectionRound ?? 0,

      // 严格同名代币因子（检查整体失败时空值；maxFDV=0 → 条件门放行）
      strictSameNameTokenCount: 0,
      strictSameNameSearchCount: 0,
      strictSameNameFilteredCount: 0,
      strictSameNameMaxFDV: 0,

      // 早期参与者检查失败时的空值
      ...this.earlyParticipantService.getEmptyFactorValues(),
      // 钱包簇检查失败时的空值
      ...this.walletClusterService.getEmptyFactorValues(),
      // 强势交易者持仓检查失败时的空值
      ...this.strongTraderPositionService.getEmptyFactorValues(),
    };
  }

  /**
   * 已知因子合取项短路判定（P4a，2026-10-12 回测性能第三层画像）。
   *
   * 动机：perf3 实测 44.5% 的 preBuy 检查 rating=1 恒拦（条件首项
   * `(narrativeRating == 2 OR == 3)` 恒 false）仍每 fire 走全链（龙头+AVE+
   * EarlyParticipant，83ms/次）；宣告竞态盘（precheckStage='address' 豁免
   * 拉黑、保留重试窗）是重复主体（top 86 次/fire）。
   *
   * 机制与等价性：条件顶层 AND 链拆成合取项；若某项引用的**全部**因子都属
   * 「检查前已知」（引擎透传 options：直调结果/平台标签/fire 因子等，检查
   * 不产生也不改写它们），则该项的值与是否跑检查无关——当次评估 false ⇒
   * AND 语义下整条条件必 false ⇒ 检查结果必然 canBuy=false。跳过检查与走
   * 全链在决策上 bit 等价；rating 翻正（宣告竞态重析）时透传值即变，短路
   * 自动解除。已知因子值时变（earlyReturn 每 fire 不同）不影响：当次值
   * 就是终值。
   *
   * 安全边界：项内混有未知因子（检查产物，如 earlyTrades*）一律不评——
   * ConditionEvaluator 对未知值比较恒 false，会把「实际可真」的项误评成
   * false 造成误拦；常数项（无因子引用）不评（保守）。解析失败 fail-open
   * 返回 null（走正常路径）。
   *
   * 副作用差异（声明，无决策影响）：被短路的检查不产生 early_trades 存档、
   * AVE 同名快照、router 门观察史——恒 false 期间这些 token 永远不会买，
   * 翻正后首检的观察史为空（fail-closed 方向）。
   *
   * @param {string} condition - preBuy/repeatBuy 条件表达式
   * @param {Object} options - performAllChecks 的 options（已知因子来源）
   * @param {string[]} [excludeKeys] - 从已知集排除的键（P4b 引擎层调用：龙头三键
   *   在龙头检查之前无值，含它们的项按「混未知因子」不评 fail-open，防默认值 0 误短路）
   * @returns {string|null} 命中的恒假合取项原文（短路），null=不短路
   * @private
   */
  _evaluateKnownFalseTerm(condition, options, excludeKeys = []) {
    if (!this.config.knownFactorShortCircuit) return null;
    const condText = String(condition || '').trim();
    if (!condText) return null;
    let ast;
    try {
      ast = this._conditionEvaluator.parseCondition(condText);
    } catch {
      return null; // 语法错交给正常路径诊断（loadStrategies 已 fail-fast，此处防御）
    }
    // 顶层 AND 链拆合取项（parseOr > parseAnd 优先级下根以下的 AND 链即顶层合取项）
    const terms = [];
    (function splitTerm(node) {
      if (node && node.type === 'AND') { splitTerm(node.left); splitTerm(node.right); }
      else if (node) terms.push(node);
    })(ast);
    if (terms.length === 0) return null;
    const known = this._buildKnownFactorContext(options, excludeKeys);
    for (const term of terms) {
      const factors = [];
      (function collect(node) {
        if (!node) return;
        if (node.type === 'AND' || node.type === 'OR') { collect(node.left); collect(node.right); }
        else if (node.type === 'IS_NULL' || node.type === 'IS_NOT_NULL') factors.push(node.operand);
        else if (node.type === 'COMPARISON') {
          // 两侧都可能是因子引用（右操作数字面量：数字 parseFloat 命中、字符串 rightString 标记）
          if (node.left != null && isNaN(parseFloat(node.left))) factors.push(node.left);
          if (node.rightString !== true && node.right != null && isNaN(parseFloat(String(node.right)))) factors.push(node.right);
        }
      })(term);
      if (factors.length === 0) continue; // 常数项不评（保守）
      const allKnown = factors.every(f => Object.prototype.hasOwnProperty.call(known, f));
      if (!allKnown) continue;
      if (!this._conditionEvaluator._evaluateNode(term, known)) {
        return this._stringifyTerm(term);
      }
    }
    return null;
  }

  /**
   * 已知因子求值上下文：与 _evaluateWithCondition 正常 context 中「引擎透传键」
   * 的键集与取值默认逐字对齐（buyRound 用 || 其余 ??；null 语义 = 同正常路径）。
   * 防漂移：单测用 getConditionFactorKeys 空壳捕获的 context 对拍同名键值。
   * @param {Object} options - 已知因子来源
   * @param {string[]} [excludeKeys] - 排除出已知集的键（P4b 引擎层：龙头三键无值
   *   时排除——排除键不进返回对象，hasOwnProperty 不中 → 引用它的项 allKnown
   *   false 不评 → fail-open 走全链，与「混未知因子」同防线）
   * @private
   */
  _buildKnownFactorContext(options = {}, excludeKeys = []) {
    const full = {
      buyRound: options.buyRound || 1,
      lastPairReturnRate: options.lastPairReturnRate ?? 0,
      platform: options.platform ?? null,
      narrativeRating: options.narrativeRating ?? 9,
      narrativeCorpusLagSec: options.narrativeCorpusLagSec ?? null,
      earlyReturn: options.earlyReturn ?? null,
      gmgnUserPct: options.gmgnUserPct ?? null,
      narrativeLeaderHot: options.narrativeLeaderHot ?? 0,
      narrativeLeaderCount: options.narrativeLeaderCount ?? 0,
      narrativeLeaderMaxMultiple: options.narrativeLeaderMaxMultiple ?? 0,
      gmgnIssuerTokenCount: options.gmgnIssuerTokenCount ?? 0,
      gmgnBundlerWalletRatio: options.gmgnBundlerWalletRatio ?? 0,
      gmgnRiskCovered: options.gmgnRiskCovered ?? 0,
      gmgnVisitingCount: options.gmgnVisitingCount ?? 0,
      tweetAuthorType: options.tweetAuthorType ?? 0,
      dataCollectionRound: options.dataCollectionRound ?? 0,
      drawdownFromHighest: options.drawdownFromHighest ?? 0,
      earlyTradesRouterLowSideSeen: options.earlyTradesRouterLowSideSeen ?? null,
      earlyTradesRouterRejectCount: options.earlyTradesRouterRejectCount ?? null,
    };
    if (excludeKeys.length === 0) return full;
    for (const k of excludeKeys) delete full[k];
    return full;
  }

  /** 合取项还原为可读文本（短路日志/原因展示用）@private */
  _stringifyTerm(node) {
    if (!node) return '';
    switch (node.type) {
      case 'AND': return `${this._stringifyTerm(node.left)} AND ${this._stringifyTerm(node.right)}`;
      case 'OR': return `(${this._stringifyTerm(node.left)} OR ${this._stringifyTerm(node.right)})`;
      case 'IS_NULL': return `${node.operand} IS NULL`;
      case 'IS_NOT_NULL': return `${node.operand} IS NOT NULL`;
      case 'COMPARISON':
        return `${node.left} ${node.operator} ${node.rightString === true ? `'${node.right}'` : node.right}`;
      default: return '';
    }
  }

  /**
   * preBuy 系条件（preBuyCheckCondition / repeatBuyCheckCondition）评估上下文的
   * 因子键集（2026-10-03 hg55 事故防线：StrategyEngine.loadStrategies 用它校验
   * 条件引用的因子存在，未知键 = 写错名 → 实验拒启）。
   *
   * 真相源 = _evaluateWithCondition 实际组装的评估 context：空壳跑一次捕获
   * _safeEvaluate 收到的 context 取键——不另持清单，context 加键自动跟上（零漂移）。
   * @returns {Array<string>} 可用于 preBuy 条件表达式的因子键
   */
  static getConditionFactorKeys() {
    const svc = Object.create(PreBuyCheckService.prototype);
    svc.logger = { info() {}, error() {}, warn() {}, debug() {} };
    let captured = null;
    svc._safeEvaluate = (_cond, ctx) => { captured = ctx; return true; };
    svc._diagnoseCondition = () => ({ conditionList: [], summaryReason: '' });
    const empty = {};
    try {
      svc._evaluateWithCondition(
        empty, empty, empty, empty, empty, empty, empty,
        '1 == 1', Date.now(), null, null, {});
    } catch (_e) {
      // 空壳跑挂 = context 组装改了形状，校验集失真——fail-loud 让调用方看见
      throw new Error(`getConditionFactorKeys 空壳捕获失败: ${_e.message}`);
    }
    if (!captured) throw new Error('getConditionFactorKeys 未捕获到评估 context');
    return Object.keys(captured);
  }

  /**
   * 使用条件表达式评估
   * @private
   * @param {Object} holderCheck - 持有者检查结果
   * @param {Object} earlyParticipantCheck - 早期参与者检查结果
   * @param {Object} walletClusterCheck - 钱包簇检查结果
   * @param {Object} creatorDevCheck - 创建者Dev检查结果
   * @param {Object} strongTraderCheck - 强势交易者持仓检查结果
   * @param {Object} earlyTraderCheck - 早期交易者黑白名单检查结果
   * @param {string} condition - 条件表达式
   * @param {number} startTime - 开始时间戳
   * @param {number} drawdownFromHighest - 从最高价跌幅
   * @param {Object} sameNameCheck - 严格同名代币检查结果（AVE 检索因子）
   * @param {Object} extraContext - 额外上下文 { buyRound, lastPairReturnRate, narrativeRating }
   */
  _evaluateWithCondition(holderCheck, earlyParticipantCheck, walletClusterCheck, walletLabelCheck, creatorDevCheck, strongTraderCheck, earlyTraderCheck, condition, startTime, drawdownFromHighest = null, sameNameCheck = null, extraContext = {}) {
    // 构建基础结果
    const baseResult = {
      // 标记已执行预检查
      preBuyCheck: 1,
      checkTimestamp: Date.now(),
      checkDuration: Date.now() - startTime,

      // [已停用] 持有者检查结果 — 回测时获取的是最新数据而非历史快照
      // holdersCount: holderCheck.holdersCount || 0,
      // devHoldingRatio: holderCheck.devHoldingRatio || 0,
      // maxHoldingRatio: holderCheck.maxHoldingRatio || 0,
      // holderCanBuy: holderCheck.canBuy,

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

      // 平台标签（router 平台分门）：存档审计用；'fourmeme'/'flap'/null
      platform: extraContext.platform ?? null,

      // 叙事分析因子
      narrativeRating: extraContext.narrativeRating ?? 9,
      // 早晚票语料滞后秒（引擎侧算好透传；null=无语料时间，条件里 null 比较恒 false
      // → 落晚票严格门 fail-closed）
      narrativeCorpusLagSec: extraContext.narrativeCorpusLagSec ?? null,
      // fire 因子 earlyReturn（晚票门右臂证据；null=无首价锚）
      earlyReturn: extraContext.earlyReturn ?? null,
      // fire 因子 gmgnUserPct（u40 门挪层注入；null=无 TPA 段 fail-closed）
      gmgnUserPct: extraContext.gmgnUserPct ?? null,
      // 同叙事龙头因子（引擎侧算好透传；默认 0=未查/无源推文/失败 fail-open 放行）
      narrativeLeaderHot: extraContext.narrativeLeaderHot ?? 0,
      narrativeLeaderCount: extraContext.narrativeLeaderCount ?? 0,
      narrativeLeaderMaxMultiple: extraContext.narrativeLeaderMaxMultiple ?? 0,
      // GMGN 风险因子（引擎侧 mapGmgnRiskFactors 透传；默认 0 放行 fail-open）
      gmgnIssuerTokenCount: extraContext.gmgnIssuerTokenCount ?? 0,
      gmgnBundlerWalletRatio: extraContext.gmgnBundlerWalletRatio ?? 0,
      gmgnRiskCovered: extraContext.gmgnRiskCovered ?? 0,
      gmgnVisitingCount: extraContext.gmgnVisitingCount ?? 0,
      // 推文作者类型因子
      tweetAuthorType: extraContext.tweetAuthorType ?? 0,
      // 数据采集轮数因子
      dataCollectionRound: extraContext.dataCollectionRound ?? 0,
      // router 门观察史因子（引擎侧状态透传，2026-10-03）：null=未维护/非 flap
      earlyTradesRouterLowSideSeen: extraContext.earlyTradesRouterLowSideSeen ?? null,
      earlyTradesRouterRejectCount: extraContext.earlyTradesRouterRejectCount ?? null,

      // 严格同名代币因子（AVE 检索；错误/未执行时 maxFDV=0 放行，与龙头门同 fail-open 方向）
      strictSameNameTokenCount: sameNameCheck?.factors?.strictSameNameTokenCount ?? 0,
      strictSameNameSearchCount: sameNameCheck?.factors?.strictSameNameSearchCount ?? 0,
      strictSameNameFilteredCount: sameNameCheck?.factors?.strictSameNameFilteredCount ?? 0,
      strictSameNameMaxFDV: sameNameCheck?.factors?.strictSameNameMaxFDV ?? 0,

      // 早期参与者检查结果
      ...earlyParticipantCheck,

      // 钱包簇检查结果
      ...walletClusterCheck,

      // 钱包标签因子
      ...walletLabelCheck,

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
        // [已停用] 持有者因子 — 回测时获取的是最新数据而非历史快照
        // holdersCount: holderCheck.holdersCount || 0,
        // devHoldingRatio: holderCheck.devHoldingRatio || 0,
        // maxHoldingRatio: holderCheck.maxHoldingRatio || 0,
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
        earlyTradesDrawdownFromHighest: earlyParticipantCheck.earlyTradesDrawdownFromHighest ?? null,
        // 净流入因子（对倒拦截）：缺省 100 放行（covered=0=age>90s 或 launchAt 缺失，
        // 口径未覆盖创建段时不拦——fail-open 与龙头门同方向）
        earlyTradesNetBuyRatio: earlyParticipantCheck.earlyTradesNetBuyRatio ?? 100,
        earlyTradesNetBuyCovered: earlyParticipantCheck.earlyTradesNetBuyCovered ?? 0,
        // 同额度簇因子（sybil 拦截）：缺省 0 放行（拦截门 wallets>=10 AND ratio>=50
        // 不触发——与净流入因子的高值放行方向相反）
        earlyTradesUniformBuyWallets: earlyParticipantCheck.earlyTradesUniformBuyWallets ?? 0,
        earlyTradesUniformBuyClusterN: earlyParticipantCheck.earlyTradesUniformBuyClusterN ?? 0,
        earlyTradesUniformBuyClusterRatio: earlyParticipantCheck.earlyTradesUniformBuyClusterRatio ?? 0,
        earlyTradesUniformBuyCovered: earlyParticipantCheck.earlyTradesUniformBuyCovered ?? 0,
        // 每钱包笔数因子（对倒高频作业拦截，猪五花案 2026-10-15）：缺省 0 放行
        //（拦截写法 <N，0 恒放行——同 uniformBuy/sniper 族方向）
        earlyTradesPerWallet: earlyParticipantCheck.earlyTradesPerWallet ?? 0,
        earlyTradesMaxWalletTrades: earlyParticipantCheck.earlyTradesMaxWalletTrades ?? 0,
        // sniper 持仓比例因子（虚假流动性拦截）：缺省 0 放行（拦截写法 pct<50，
        // 0 恒放行——与净流入因子的高值放行方向相反，同 uniformBuy 族）
        earlyTradesSniperHoldingPct: earlyParticipantCheck.earlyTradesSniperHoldingPct ?? 0,
        earlyTradesSniperWallets: earlyParticipantCheck.earlyTradesSniperWallets ?? 0,
        earlyTradesSniperHolders: earlyParticipantCheck.earlyTradesSniperHolders ?? 0,
        earlyTradesSniperCovered: earlyParticipantCheck.earlyTradesSniperCovered ?? 0,
        // top1 买入集中度因子（单钱包主导拦截）：缺省 0 放行（拦截写法 <60，
        // 0 恒放行——同 uniformBuy/sniper 族方向）
        earlyTradesTop1BuySharePct: earlyParticipantCheck.earlyTradesTop1BuySharePct ?? 0,
        earlyTradesTop1BuyBnb: earlyParticipantCheck.earlyTradesTop1BuyBnb ?? 0,
        earlyTradesBuyBnb: earlyParticipantCheck.earlyTradesBuyBnb ?? 0,
        earlyTradesTop1BuyCovered: earlyParticipantCheck.earlyTradesTop1BuyCovered ?? 0,
        // 聚合路由占比因子（GMGN 主导盘拦截）：缺省 0 放行（拦截写法 <60——同 top1 族方向）
        earlyTradesRouterPct: earlyParticipantCheck.earlyTradesRouterPct ?? 0,
        earlyTradesRouterCovered: earlyParticipantCheck.earlyTradesRouterCovered ?? 0,
        // router 门观察史因子（引擎侧 per-token 状态透传，2026-10-03）：null=未维护/非 flap，
        // 门写法 fail-open——同族平台分门 `(platform != 'flap' OR ... OR ... IS NULL)`
        earlyTradesRouterLowSideSeen: extraContext.earlyTradesRouterLowSideSeen ?? null,
        earlyTradesRouterRejectCount: extraContext.earlyTradesRouterRejectCount ?? null,
        // 早期参与者因子 - 数据跨度
        earlyTradesActualSpan: earlyParticipantCheck.earlyTradesActualSpan || 0,
        earlyTradesRateCalcWindow: earlyParticipantCheck.earlyTradesRateCalcWindow || 1,
        // 内盘无数据标记（可能已出内盘）
        earlyTradesNoInnerData: earlyParticipantCheck.earlyTradesNoInnerData || 0,
        // 钱包集中度因子
        walletTop3VolumeRatio: walletClusterCheck.walletTop3VolumeRatio || 0,
        walletTop1VolumeRatio: walletClusterCheck.walletTop1VolumeRatio || 0,
        walletTop3TradeRatio: walletClusterCheck.walletTop3TradeRatio || 0,
        walletTop1TradeRatio: walletClusterCheck.walletTop1TradeRatio || 0,
        walletDiversityIndex: walletClusterCheck.walletDiversityIndex || 0,
        oneShotBuyerRatio: walletClusterCheck.oneShotBuyerRatio || 0,
        // 区块集中买入因子
        maxBlockBuyRatio: walletClusterCheck.maxBlockBuyRatio || 0,
        maxBlockNumber: walletClusterCheck.maxBlockNumber || null,
        maxBlockBuyAmount: walletClusterCheck.maxBlockBuyAmount || 0,
        // 钱包标签因子
        walletLabelHasFresh: walletLabelCheck.walletLabelHasFresh,
        walletLabelProfitableRatio: walletLabelCheck.walletLabelProfitableRatio,
        walletLabelBuySellRatio: walletLabelCheck.walletLabelBuySellRatio,
        walletLabelMatchCount: walletLabelCheck.walletLabelMatchCount,
        walletLabelOnlyBuyRatio: walletLabelCheck.walletLabelOnlyBuyRatio,
        // 创建者Dev钱包因子（1=不在Dev列表中, 0=在Dev列表中）
        creatorIsNotBadDevWallet: creatorDevCheck.creatorIsNotBadDevWallet ?? 0,
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
        // 平台标签（允许在条件表达式中使用：platform != 'flap' 分门；
        // null 时 != 比较恒 false = 未知平台 fail-closed 落 router 区间门）
        platform: extraContext.platform ?? null,
        // 叙事分析因子（允许在条件表达式中使用）
        narrativeRating: extraContext.narrativeRating ?? 9,
        // 早晚票语料滞后秒（允许在条件表达式中使用；null=无语料时间/无出生锚——
        // ConditionEvaluator null 比较恒 false → `lag < N` 不成立 → 落晚票严格门，
        // fail-closed 是刻意语义：早票是证据门，无证据不放行）
        narrativeCorpusLagSec: extraContext.narrativeCorpusLagSec ?? null,
        // fire 因子 earlyReturn（允许在条件表达式中使用——晚票门右臂证据；
        // 与 FA fire 因子同名同值同刻，platform 键同款双域存在）
        earlyReturn: extraContext.earlyReturn ?? null,
        // fire 因子 gmgnUserPct（2026-10-16 u40 门挪层进 preBuy；与 FA fire 因子
        // 同名同值同刻，earlyReturn 同款双域存在；null=无 TPA 段 fail-closed）
        gmgnUserPct: extraContext.gmgnUserPct ?? null,
        // 同叙事龙头因子（允许在条件表达式中使用；默认 0 不用 null——null 比较恒 false 会误拒）
        narrativeLeaderHot: extraContext.narrativeLeaderHot ?? 0,
        narrativeLeaderCount: extraContext.narrativeLeaderCount ?? 0,
        narrativeLeaderMaxMultiple: extraContext.narrativeLeaderMaxMultiple ?? 0,
        // GMGN 风险因子（允许在条件表达式中使用；默认 0 放行——与龙头门同 fail-open 方向）
        gmgnIssuerTokenCount: extraContext.gmgnIssuerTokenCount ?? 0,
        gmgnBundlerWalletRatio: extraContext.gmgnBundlerWalletRatio ?? 0,
        gmgnRiskCovered: extraContext.gmgnRiskCovered ?? 0,
        gmgnVisitingCount: extraContext.gmgnVisitingCount ?? 0,
        // 推文作者类型因子（允许在条件表达式中使用）
        tweetAuthorType: extraContext.tweetAuthorType ?? 0,
        // 数据采集轮数因子（允许在条件表达式中使用）
        dataCollectionRound: extraContext.dataCollectionRound ?? 0,
        // 严格同名代币因子（允许在条件表达式中使用；AVE 错误时 maxFDV=0 → 条件门放行）
        strictSameNameTokenCount: sameNameCheck?.factors?.strictSameNameTokenCount ?? 0,
        strictSameNameSearchCount: sameNameCheck?.factors?.strictSameNameSearchCount ?? 0,
        strictSameNameMaxFDV: sameNameCheck?.factors?.strictSameNameMaxFDV ?? 0,
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
          // [已停用] devHoldingRatio: context.devHoldingRatio,
          // [已停用] maxHoldingRatio: context.maxHoldingRatio,
          earlyTradesHighValueCount: context.earlyTradesHighValueCount,
          earlyTradesCountPerMin: context.earlyTradesCountPerMin,
          walletTop3TradeRatio: context.walletTop3TradeRatio,
          narrativeRating: context.narrativeRating,
        }
      });

      const result = {
        ...baseResult,
        canBuy,
        preTraderCanBuy: canBuy,
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

      // [已停用] 持有者检查结果 — 回测时获取的是最新数据而非历史快照
      // holdersCount: holderCheck.holdersCount,
      // devHoldingRatio: holderCheck.devHoldingRatio,
      // holderCanBuy: holderCheck.canBuy,

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

      // 综合决策：持有者检查始终通过，仅依赖早期参与者检查
      result.canBuy = /* result.holderCanBuy && */ result.preTraderCanBuy;
      result.checkReason = this._buildCombinedCheckReason(
        true, // result.holderCanBuy, // 持有者检查已停用，始终通过
        result.preTraderCanBuy,
        holderCheck.reason,
        eligibility.reason
      );
    }

    this.logger.info('[PreBuyCheckService] 购买前检查完成', {
      // holderCanBuy: result.holderCanBuy, // [已停用] 持有者检查
      preTraderCanBuy: result.preTraderCanBuy,
      canBuy: result.canBuy,
      checkReason: result.checkReason,
      // devHoldingRatio: result.devHoldingRatio, // [已停用] 持有者检查
      earlyTradesTotalCount: result.earlyTradesTotalCount || 0,
      earlyTradesVolumePerMin: result.earlyTradesVolumePerMin || 0,
      earlyTradesCountPerMin: result.earlyTradesCountPerMin || 0,
      earlyTradesHighValuePerMin: result.earlyTradesHighValuePerMin || 0
    });

    return result;
  }

  /**

  /**
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
   * 例如: "(walletTop3TradeRatio < 20 && walletDiversityIndex > 0.2)"
   * -> ["walletTop3TradeRatio", "walletDiversityIndex"]
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
  _safeEvaluate(condition, context) {
    try {
      return this._conditionEvaluator.evaluate(condition, context);
    } catch (error) {
      this.logger.error('[PreBuyCheckService] 条件评估异常', { condition, error: error.message });
      return false;
    }
  }

  /**
   * 诊断条件失败原因
   * @private
   */
  _diagnoseCondition(condition, context) {
    const atomicConditions = this._parseCondition(condition);
    const conditionList = [];

    for (const expr of atomicConditions) {
      // 处理括号包裹的复杂表达式
      if (expr.startsWith('(') && expr.endsWith(')')) {
        // 尝试评估复杂条件。_parseCondition 已把 AND/OR 转成 &&/||，而
        // ConditionEvaluator 只认字面量 AND/OR——还原后再评估，否则括号段
        // 必然解析失败（「括号不匹配」恒 false，诊断恒示 ✗ 不满足）
        try {
          const satisfied = this._safeEvaluate(
            expr.replace(/&&/g, ' AND ').replace(/\|\|/g, ' OR '), context);

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
   * 执行严格同名代币检查（AVE 检索"同名老币已存在且市值不低"信号）
   * 无 symbol（tokenInfo 缺失）时返回空因子（maxFDV=0 → 条件门放行）
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {Object} tokenInfo - 代币信息（需要 symbol/name；回测还读 launchAt=发布锚秒）
   * @param {Object} [options] - { checkTime: 回放虚拟时刻秒（回测传入；实时引擎不传），
   *   sourceExperimentId: 快照 provenance }
   * @returns {Promise<Object>} 检查结果 { success, factors }
   */
  async _performSameNameCheck(tokenAddress, tokenInfo, options = {}) {
    const { checkTime, sourceExperimentId } = options;
    const symbol = tokenInfo?.symbol;
    if (!symbol) {
      this.logger.info('[PreBuyCheckService] 缺少 symbol，跳过严格同名代币检查', {
        token_address: tokenAddress
      });
      return { success: false, factors: this.sameNameTokenService.getEmptyFactors('missing_symbol') };
    }

    try {
      const result = await this.sameNameTokenService.performCheck(
        symbol,
        tokenInfo?.name || '', // name 缺失时传空 → 严格匹配全不命中 → maxFDV=0 放行（保守方向，与 AVE 错误处理一致）
        {
          selfAddress: tokenAddress,
          // 回测语义（checkTime=回放虚拟时刻秒，2026-10-12 用户裁定）：AVE 同名检查
          // 以历史快照 as-of 为主，miss 才兜底实时调用，且行级过滤到被检 token
          // 发布之前（launchAt 秒锚）。实时引擎不传 checkTime → asOfMs=null →
          // 现状行为零变化（实时调用 + 不过滤 + 照写快照）
          asOfMs: checkTime != null ? checkTime * 1000 : null,
          targetCreatedAtSec: tokenInfo?.launchAt ?? null,
          sourceExperimentId,
        }
      );
      this.logger.info('[PreBuyCheckService] 严格同名代币检查完成', {
        token_address: tokenAddress,
        symbol,
        count: result.factors.strictSameNameTokenCount,
        maxFDV: result.factors.strictSameNameMaxFDV,
        snapshotHit: result.snapshotHit,
        fallback: result.fallback,
        error: result.error || null
      });
      return result;
    } catch (error) {
      this.logger.error('[PreBuyCheckService] 严格同名代币检查异常', {
        token_address: tokenAddress,
        symbol,
        error: error.message
      });
      return { success: false, factors: this.sameNameTokenService.getEmptyFactors(error.message) };
    }
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
    // [已停用] 持有者检查 — 回测时获取的是最新数据而非历史快照（原始 AVE 实现已随 P5 清理删除）
    return {
      canBuy: true,
      whitelistCount: 0,
      blacklistCount: 0,
      holdersCount: 0,
      devHoldingRatio: 0,
      maxHoldingRatio: 0,
      reason: '持有者检查已停用',
      blacklistReason: '检查已停用',
      devReason: '检查已停用',
      largeHoldingReason: '检查已停用'
    };
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
      tokenInfo.launchAt || null,  // 创建时间（秒）——净流入因子创建锚定窗口用（共合案 2026-09-27 恢复传参）
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
      // [已停用] 持有者因子 — 回测时获取的是最新数据而非历史快照
      // holdersCount: 0,
      // devHoldingRatio: 0,
      // maxHoldingRatio: 0,
      // holderCanBuy: null,
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
      // 早晚票语料滞后秒（默认 null=无语料时间 → 晚票门 fail-closed）
      narrativeCorpusLagSec: null,
      // fire 因子 earlyReturn（默认 null=无首价锚）
      earlyReturn: null,
      // 同叙事龙头因子（默认 0=未查/无源推文）
      narrativeLeaderHot: 0,
      narrativeLeaderCount: 0,
      narrativeLeaderMaxMultiple: 0,
      // GMGN 风险因子（默认 0=未查/未触发，covered=0 放行）
      gmgnIssuerTokenCount: 0,
      gmgnBundlerWalletRatio: 0,
      gmgnRiskCovered: 0,
      gmgnVisitingCount: 0,
      // 推文作者类型因子（0=普通, 1=A级SuperIP, 2=S级SuperIP）
      tweetAuthorType: 0,
      // 数据采集轮数因子
      dataCollectionRound: 0,
      // 严格同名代币因子（未执行检查默认值）
      strictSameNameTokenCount: 0,
      strictSameNameSearchCount: 0,
      strictSameNameFilteredCount: 0,
      strictSameNameMaxFDV: 0,
      ...this.earlyParticipantService.getEmptyFactorValues(),
      ...this.walletClusterService.getEmptyFactorValues(),
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

    // P9 dev 名单进程内缓存（2026-10-13 回测性能案）：前身每次检查
    // `new WalletDataService()` + getWallets() = select * from wallets 全表
    // roundtrip（3699 次 preBuy ≈ parCreator 全额，钱包静态人工名单）。
    // 语义先例：WalletLabelService.initLabelCache 对同一张 wallets 表就是
    // 进程加载一次、不中途刷新（改名单重启实验生效）。失败不缓存——下次调用
    // 自然重试，与前身每调用重试行为一致；成功即缓存（真空表也缓存，与失败
    // 在显式 error 处分流）。select 收窄 address/category 两列：行集不变载荷更轻
    if (!this._devWalletSet) {
      try {
        const { data, error } = await this.supabase
          .from('wallets')
          .select('address, category');
        if (error) throw new Error(error.message);
        const set = new Set();
        for (const w of (data || [])) {
          if (w?.category === 'dev' && w.address) set.add(String(w.address).toLowerCase());
        }
        this._devWalletSet = set;
      } catch (error) {
        this.logger.error('[PreBuyCheckService] dev钱包名单加载失败（下次检查重试）', {
          creator_address: creatorAddress,
          error: error.message
        });
        // 与前身失败路径一致：保守放行（不缓存，后续调用重试）
        return { creatorIsNotBadDevWallet: 1 };
      }
    }

    // 1 = 不在Dev列表中（好）, 0 = 在Dev列表中（坏）
    const result = this._devWalletSet.has(creatorAddress.toLowerCase()) ? 0 : 1;

    this.logger.info('[PreBuyCheckService] 创建者Dev钱包检查完成', {
      creator_address: creatorAddress,
      is_bad_dev_wallet: result === 0,
      creatorIsNotBadDevWallet: result
    });

    return { creatorIsNotBadDevWallet: result };
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
