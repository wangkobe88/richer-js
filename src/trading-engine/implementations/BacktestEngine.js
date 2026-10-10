/**
 * BacktestEngine（wss_price_ticks tick 回放版，Phase 4 重写）
 *
 * 数据源：源实验的 wss_price_ticks（全网 tick 留存，按 experiment_id 归属）
 *        + experiment_tokens（代币元数据：created_at / totalSupply / creator）。
 * 回放管线与实时 FourMemeWssTradingEngine 共享同一套组件与语义：
 *   FourMemeFactorAggregator.processTick（因子增量）→ StrategyEngine 分腿评估
 *   （actionFilter）→ PreBuyCheckService → PortfolioManager 虚拟记账 →
 *   TokenPool 状态推进 → TickDebouncer 买评估去抖（virtual 虚拟时钟模式）。
 *
 * 时钟：全程虚拟时钟（tick.block_time 驱动）。debounce 触发、信号/交易时间戳、
 * 持仓时长、组合快照节奏均以回放时点计算，与实时引擎在同一数据上的决策对齐
 * （parity：同 tick 同因子同策略，差异仅剩 debounce 触发边界的采样粒度）。
 *
 * 产物：strategy_signals / trades / experiment_tokens / portfolio_snapshots，
 *       终态 completed（失败 failed）。不写 experiment_time_series_data
 *       （回测从 tick 重算因子，时序表是实时引擎的 30s 快照产物）。
 *
 * 与旧回测引擎（experiment_time_series_data 轮次回放）的差异：
 *   - 数据源换为 tick 级（AVE 时代旧实验的时序数据不再是回测源，历史行不删）
 *   - 叙事评级直调（同实时引擎 narrativeCallCondition）：analyze 用当前语料分析
 *     历史 token（时序穿越），绝对收益不代表当时实时可得，结论看相对增量
 */

const { TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { AbstractTradingEngine } = require('../core/AbstractTradingEngine');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const { ExperimentStatsService } = require('../../web/services/ExperimentStatsService');
const Logger = require('../../services/logger');
const Decimal = require('decimal.js');

const baseConfig = require('../../../config/default.json');

const TICK_PAGE_SIZE = 500;       // keyset 分页页大小（单 token 长尾路径；必须 < Supabase
                                  // 默认 max rows 1000，否则响应被服务端截断、终止条件误判）
const TICK_UNORDERED_LIMIT = 1000; // 无序合一拉取上限（对齐 Supabase max rows 硬上限——
                                  // 服务端 max-rows 截断恰在此值，limit 再大也拿不到更多）
const MAX_TICK_PAGES = 2000;      // 分页保护上限（全局累计 100 万 tick）
const TOKEN_CHUNK_SIZE = 50;      // .in 批大小（探针 + 数据装载合一请求共用）。2026-10-09
                                  // 沿革：in(N)+gt(id)+ORDER BY id+limit 形状 planner 稳定选
                                  // id 顺序扫（36a2c12a 四启全死于 8s statement timeout，页级
                                  // 重试 3 次仍死=计划本身坏，与 (token,platform,id) 索引无关）；
                                  // 无序形状（无 ORDER BY）无 top-k 可贪、稳定走 token 索引
                                  //（探针 LIMIT 1 / count exact 实测皆 <100ms），装载已切锚定
                                  // 无序拉取（_fetchPlatformTicksRows）
const PAGE_ATTEMPTS = 3;          // 单页拉取重试上限（探针 PROBE_ATTEMPTS 同款；连续失败 throw）
const SNAPSHOT_INTERVAL_MS = 30 * 1000; // 组合快照虚拟时间桶（对齐实时引擎 30s）
// ticks 拉取列清单单一事实源：拉取查询与 BacktestTickCache columnsTag 同源
//（列变更时旧缓存自动判废重拉，不静默缺列）
const TICK_SELECT_COLUMNS = 'id, token_address, trade_type, trader_address, sender_address, price_bnb, price_usd, bnb_amount, token_amount, block_number, block_time, tx_hash, log_index, price_outlier, platform';

/**
 * 回放排序比较函数：链上真序 (block_number, log_index)，id 仅作最终 tie-breaker
 * （log_index 是区块内日志索引，(block_number, log_index) 全局唯一；id 只保证排序
 * 确定性）。2026-10-08 凑凑 0x8ea2…7777 案：原 raw.sort(id) 的 bigserial 分配序
 * ≠提交序——watcher 延迟落库让 07:45:38 的峰行 id 反而小于 07:45:35 的行，回放
 * 把未来 3 秒的峰提前喂进 FA 价格史，P11 据此算出回撤 -35% 提前全清（真实时序
 * 该刻峰值利润仅 +8.7% 不触发）。链上真序是回测有效性的前提。
 */
function compareByChainOrder(a, b) {
  return (a.block_number - b.block_number) || (a.log_index - b.log_index) || (a.id - b.id);
}

class BacktestEngine extends AbstractTradingEngine {
  constructor(options = {}) {
    super({
      id: `backtest_${Date.now()}`,
      name: 'Fourmeme Backtest Engine (tick replay)',
      mode: TradingMode.BACKTEST,
      blockchain: 'bsc',
      ...options
    });

    this._sourceExperimentId = null;
    this._ticks = [];
    this._tokenMeta = new Map();        // tokenAddress → { symbol, name, createdAtSec, totalSupply, creator }
    this._seenTokens = new Set();       // 已落库 experiment_tokens 的 tokenAddress
    this._buyingTokens = new Set();     // 买路径执行中防重入
    this._sellingTokens = new Set();    // 卖路径执行中防重入
    this._tokenBlacklist = new Map();   // 永久阻断
    this._routerGateState = new Map();  // router 门观察史 tokenAddress → { lowSideSeen, outCount }（pre-check/router-gate-state.js；回放逐 fire 累计与实时同源）
    this._lastSnapshotTs = null;        // 上一个组合快照的虚拟时刻
    this._inflightEvals = new Set();    // 回放中 fire-and-forget 的评估 promise（买评估/卖去抖 fire；drain 用）
    this._finalStatusSet = false;       // 回放终态已写（stop 保护用）

    // graduation 事件回放（2026-10-10 虚拟↔回测一致性对齐，a21fa102 CZ 毕业票案）：
    // 毕业后 token ticks 停止，虚拟引擎有事件驱动全清（_handleGraduation →
    // _emitGraduationSell，断流前最后可靠价落袋），回测缺事件流时毕业持仓只能靠
    // 回放结束强平——同 token 同策略下卖出路径系统性分叉。此处从 wss_events
    // kind='graduation' 拉事件，按 tsMs 插入 tick 流回放（消费点/买入补卖/幂等
    // 标记后置三挂点对齐虚拟引擎，见各方法注释）
    this._graduationEvents = [];        // { token, tsMs, fundsBnb } 按 tsMs 升序
    this._gradEvtIdx = 0;               // 消费指针（卖出失败不推进 = 下轮重试，虚拟扫描兜底等价物）
    this._graduationSoldTokens = new Set(); // 幂等标记（后置到卖出成功，虚拟竞态修复同款）
    this._graduatedTokens = new Set();  // 事件已到达集合（买入成功点补卖判据——先于 FA 注册的边缘）

    // pumpfun 回迁批 2 闩锁 + 卖出确认去抖（token 级降维，语义同实时引擎）
    this._tokenLocks = new Set();       // 止损闩锁：lockTokenAfterSell 卖腿成交 → 该 token 永久禁买
    this._cumLossTotals = new Map();    // token → 已平仓轮 profitPercent 累计（盈亏同记）
    this._cumLossLockPct = null;        // 累亏闩锁阈值（卖腿 cumulativeLossLockPct 多腿取最严；null=未配置）
    this._sellDebounceMs = 0;           // 卖出确认去抖窗口（_initializeDataSources 按 wsConfig 重读）
    // E5 多卖腿轮账本：tokenAddress → { buyUsd, sellUsdGross, buyTime, legCount }（记账货币 USD，
    // 与 trades 表同口径）。买入成功登记，每卖腿累计（含回放结束强平腿）；全清时
    // addCompletedPair 一次记整轮 pnl=Σ卖-买
    this._roundLedger = new Map();
    // 卡牌仓位（迁自 rich-js）：addr → 该 token 当前卡数。机制关闭时恒空 Map（零开销）；
    // 买/卖腿只在 positionManagement.perCardBNB 启用时读写（详见 _initializeDataSources）
    this._tokenCards = new Map();
    this._perCardBNB = null;
    this._cardsEnabled = false;

    this.initialBalance = 100;
    this._tradeAmount = 0.1;
    this._permanentBlockCondition = null;

    this.metrics = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalSignals: 0,
      executedSignals: 0,
      processedDataPoints: 0,
      debounceFired: 0,
      debounceSuppressed: 0,
    };

    this.dataService = new ExperimentDataService();
    this.logger = new Logger({ dir: './logs', experimentId: null });
  }

  // ==================== 抽象方法实现 ====================

  async _updateComponentLoggers() {
    this.logger.setExperimentId(this._experimentId);
  }

  /**
   * 重写：backtest.initialBalance 必须在 base 创建 portfolio（_initializeComponents
   * 内）之前生效——base 用 this.initialBalance 建组合，配置若在 _initializeDataSources
   * 才读则为时已晚（旧回测引擎的既有缺陷，此处修正）。
   */
  async _initializeComponents() {
    const btConfig = this._experiment?.config?.backtest || {};
    if (btConfig.initialBalance) {
      this.initialBalance = btConfig.initialBalance;
    }
    await super._initializeComponents();
  }

  async _initializeDataSources() {
    // 1. 回测配置
    const backtestConfig = this._experiment.config?.backtest || {};
    this._sourceExperimentId = backtestConfig.sourceExperimentId;
    if (!this._sourceExperimentId) {
      throw new Error('回测实验缺少源实验ID配置 (config.backtest.sourceExperimentId)');
    }
    this._startTimeFilter = backtestConfig.startTime ? new Date(backtestConfig.startTime).getTime() : null;
    this._endTimeFilter = backtestConfig.endTime ? new Date(backtestConfig.endTime).getTime() : null;

    const { ExperimentFactory } = require('../factories/ExperimentFactory');
    const sourceExp = await ExperimentFactory.getInstance().load(this._sourceExperimentId);
    if (!sourceExp) {
      throw new Error(`源实验不存在: ${this._sourceExperimentId}`);
    }
    this.logger.info(this._experimentId, 'BacktestEngine',
      `📊 回测配置: 源实验=${this._sourceExperimentId}, 初始余额=${this.initialBalance}` +
      (this._startTimeFilter ? `, 起点=${new Date(this._startTimeFilter).toISOString()}` : '') +
      (this._endTimeFilter ? `, 终点=${new Date(this._endTimeFilter).toISOString()}` : ''));

    // 2. 代币池（FA 自带趋势序列，无需历史缓存）
    const TokenPool = require('../../core/token-pool');
    this._tokenPool = new TokenPool(this.logger);

    // 3. 因子聚合器（回放不挂 factorsUpdated 事件，轮询 processTick 返回值）
    // 平台由回测实验 config.platform 声明（决定 wsConfig 段；FA 键名固定 fourmemeWs）；
    // 代币级 platform 以源实验 experiment_tokens.platform 为权威（_registerToken 处覆盖）
    const FourMemeFactorAggregator = require('../../services/FourMemeFactorAggregator');
    const { resolvePlatforms } = require('../core/platforms');
    this._platform = this._experiment?.config?.platform || 'fourmeme';
    // 平台集合（'both' → 双平台并集）：ticks .in 过滤 + token 级 fallback 用；
    // wsSection 选择仍用标量（'both' → fourmemeWs，与实时双平台引擎口径一致）
    this._platforms = resolvePlatforms(this._platform);
    this.logger.info(this._experimentId, 'BacktestEngine', `回放平台口径 | platforms=${this._platforms.join(',')}`);
    const wsSection = this._platform === 'flap' ? 'flapWs' : 'fourmemeWs';
    const wsConfig = {
      ...(baseConfig[wsSection] || {}),
      ...(this._experiment?.config?.[wsSection] || {}),
    };
    // cycle 判定配置化（2026-09-28）：与实时引擎同一注入口径——tokenCycle.params
    // 并入 factorParams 最高优先级；不带 params 的存量回测零变化
    const { mapCycleParams } = require('../../strategies/group-variables');
    wsConfig.factorParams = {
      ...(wsConfig.factorParams || {}),
      ...mapCycleParams(this._experiment?.config?.tokenCycle?.params),
    };
    this._factorAggregator = new FourMemeFactorAggregator({ fourmemeWs: wsConfig }, this.logger);
    // 市场 regime 截面 feed 显式 opt-in（回迁批 2.6 观察版：与 WSS 引擎同入口同截面口径，
    // 回放 tick ts 自动成为决策时钟；回测不落表（不污染观察史）。红线同 WSS 引擎：condition 不引用 market*）
    FourMemeFactorAggregator.setMarketFeedEnabled(true);

    // 名单因子名单加载（回迁批 3.3）：与 WSS 引擎同入口同名单（回测/live 因子同构 parity）。
    // 两加载均 fail-open+warn：smartBotCount 恒 0 / sniperHolderShare 恒 null（fail-closed 门不放行），
    // 后果方向在因子层已定。⚠母版此处 sniper 是 fail-fast（A/B B 臂引用该键，静默 null 的空统计
    // 比死 run 更糟）；richer-js 无 A/B 装置且新键无存量策略引用，统一 fail-open 偏离存案。
    try {
      await FourMemeFactorAggregator.loadSmartBotWallets(this._getClient(),
        (wsConfig.factorParams || {}).smartBotCategory);
    } catch (e) {
      this.logger.warn(this._experimentId, 'BacktestEngine', `smart_bot 名单加载失败(fail-open): ${e.message}`);
    }
    try {
      await FourMemeFactorAggregator.loadSniperWallets(this._getClient());
    } catch (e) {
      this.logger.warn(this._experimentId, 'BacktestEngine', `sniper 名单加载失败(fail-open, sniperHolderShare 将恒 null): ${e.message}`);
    }

    // 4. 策略引擎（buy/sell 扁平化，与实时引擎同构；分腿评估语义）
    const { StrategyEngine } = require('../../strategies/StrategyEngine');
    const strategiesConfig = this._buildStrategyConfig();
    this._strategyEngine = new StrategyEngine({ strategies: strategiesConfig });

    const { getAvailableFactorIds } = require('../core/FactorBuilder');
    const availableFactorIds = getAvailableFactorIds();

    const strategyArray = [];
    for (const [kind, list] of [['buy', strategiesConfig.buyStrategies], ['sell', strategiesConfig.sellStrategies]]) {
      if (!Array.isArray(list)) continue;
      list.forEach((s, idx) => {
        strategyArray.push({
          id: `${kind}_${idx}_${s.priority || 0}`,
          name: `${kind === 'buy' ? '买入' : '卖出'}策略 P${s.priority || 0}`,
          description: s.description || '',
          action: kind,
          condition: s.condition,
          priority: s.priority || 0,
          maxExecutions: s.maxExecutions || null,
          preBuyCheckCondition: s.preBuyCheckCondition || null,
          repeatBuyCheckCondition: s.repeatBuyCheckCondition || null,
          narrativeCallCondition: s.narrativeCallCondition || null,
          // pumpfun 回迁批 2 卖腿机制字段（卖腿消费；买腿携带不生效，与 preBuy* 字段对称）
          bypassDebounce: !!s.bypassDebounce,
          lockTokenAfterSell: !!s.lockTokenAfterSell,
          cumulativeLossLockPct: typeof s.cumulativeLossLockPct === 'number' ? s.cumulativeLossLockPct : null,
          // E5 卖侧：卖出比例（执行时点余仓比例，(0,1]；缺省/非法 → 1=全仓=旧语义）
          sellPercentage: (typeof s.sellPercentage === 'number'
            && s.sellPercentage > 0 && s.sellPercentage <= 1) ? s.sellPercentage : 1,
          // 卡牌仓位（迁自 rich-js）：cards/cooldownSec 原样透传，loadStrategies 内归一化
          //（正整数/卖腿 'all'，脏值 → null=旧语义）；cooldownSec 独立于卡牌机制生效
          cards: s.cards,
          cooldownSec: s.cooldownSec,
          // 组路由（策略库一期，2026-09-28）：groups 表达式透传（loadStrategies 内
          // 归一 + 校验）；存量 cycle 数字仍在 normalizeGroups 内转换为等价表达式
          groups: s.groups,
          cycle: s.cycle,
          enabled: true,
        });
      });
    }
    // 未知因子 fail-fast（2026-10-03 hg55 事故裁定）：condition/narrativeCall 用 FA
    // 因子集校验；preBuy/repeat 买检查用 PreBuyCheckService 评估上下文键集校验
    //（别名防与第 5 步的 PreBuyCheckService 声明重复）
    const { PreBuyCheckService: _PreBuyCheckService } = require('../pre-check/PreBuyCheckService');
    this._strategyEngine.loadStrategies(strategyArray, availableFactorIds,
      new Set(_PreBuyCheckService.getConditionFactorKeys()));

    // 累亏闩锁阈值：取卖腿 cumulativeLossLockPct 最大值（多腿并存最严者先锁，fail-closed 方向）；
    // 未配置任何腿 = null = 机制关闭（存量实验零变化，语义同实时引擎）
    const _cumLocks = this._strategyEngine.getAllStrategies()
      .filter(s => s.action === 'sell' && s.cumulativeLossLockPct != null)
      .map(s => s.cumulativeLossLockPct);
    this._cumLossLockPct = _cumLocks.length > 0 ? Math.max(..._cumLocks) : null;

    this.logger.info(this._experimentId, 'BacktestEngine',
      `✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 6.1 FA preFilter（pumpfun 回迁，**默认关**）：backtest.faPreFilter===true 时从每个
    // 买腿 condition AST 提取 age 区间（分钟，与 FA age 因子同锚同单位），多策略取
    // 【并集】注入 FA——未持仓 token 的 age 落在全部区间外 → buildFactorMap 跳过因子
    // 构建（纯提效：AND 链 condition 出 age 区间必 false，不漏买）。红线：跳过会连带
    // 跳过 TPA checkAndTrigger 与 cycle latch 推进 = 决策行为变化（触发数/分桶演化可能
    // 漂移），故默认关；开启前须开/关双跑 trades 一致才允许实验级启用
    if (backtestConfig.faPreFilter === true) {
      const { ConditionEvaluator } = require('../../strategies/ConditionEvaluator');
      const ranges = [];
      for (const s of this._strategyEngine.getAllStrategies()) {
        if (s.action !== 'buy') continue;
        const pf = s.condition ? ConditionEvaluator.extractBuyRangeFromCondition(String(s.condition)) : null;
        if (pf) ranges.push(pf);
      }
      this._factorAggregator.setPreFilter(ranges.length > 0 ? ranges : null);
      if (ranges.length > 0) {
        const fmt = pf => `age∈[${pf.minAgeMinutes ?? 0},${pf.maxAgeMinutes ?? '∞'})`;
        this.logger.info(this._experimentId, 'preFilter',
          `FA preFilter 已启用（默认关，实验级显式开启）：${ranges.length} 个买腿区间并集 ${ranges.map(fmt).join(' | ')}`);
      } else {
        this.logger.info(this._experimentId, 'preFilter',
          'FA preFilter 开启但无可提取 age 区间的买腿（OR 结构/无 age 子句）→ 不过滤');
      }
    }

    // 5. 购买前检查服务（与实时引擎同源构建）
    const { PreBuyCheckService } = require('../pre-check/PreBuyCheckService');
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();
    const preBuyCheckConfig = {
      ...baseConfig.preBuyCheck,
      ...(this._experiment?.config?.preBuyCheck || {}),
    };
    // P1-2 日志降噪（bc4f756e 性能案：PreBuyCheck+EarlyParticipant per-signal 明细
    // 占日志量 73%、其中严格同名 DEBUG 大对象行占墙钟 15.2%）：config.backtest.
    // logMinLevel（'DEBUG'|'INFO'|'WARN'|'ERROR'，默认 null=现状全量）时给 pre-buy
    // 服务链（PreBuyCheck→EarlyParticipant/WalletCluster/SameName 等子服务共用）
    // 传独立降级 Logger——判级短路发生在 JSON.stringify 之前；引擎主日志
    // （BuyEval 触发/否决登记/直调/龙头/成交决策行）不动。两 Logger 写同一文件
    const _logMinLevel = backtestConfig.logMinLevel || null;
    const preBuyLogger = _logMinLevel
      ? new Logger({ dir: './logs', experimentId: this._experimentId, minLevel: _logMinLevel })
      : this.logger;
    this._preBuyCheckService = new PreBuyCheckService(supabase, preBuyLogger, preBuyCheckConfig);
    await this._preBuyCheckService.initialize('bsc');
    this.logger.info(this._experimentId, 'BacktestEngine',
      `✅ 购买前检查服务初始化完成 (earlyParticipantFilterEnabled=${preBuyCheckConfig.earlyParticipantFilterEnabled})`);

    // 5.5 叙事评级直调（同实时引擎：策略 narrativeCallCondition 触发时同步调
    // NarrativeAnalyzer.analyze，Jev 秒级；失败/超时=9 放行）。memoryCacheResults
    // 回测专属开启（bc4f756e 性能案 2026-09-28）：终态 PASS 结果进程内缓存，
    // 消除暖缓存下每次直调的 token_narrative 表 DB 往返；live 构造点不传=零变化
    const { NarrativeDirectCaller, mapGmgnRiskFactors, shouldBlockOnNarrative } = require('../pre-check/NarrativeDirectCaller');
    this._narrativeCaller = new NarrativeDirectCaller({ memoryCacheResults: true });
    // 挂 this：解构是函数级作用域，_evaluateBuyPath 裸引用会 ReferenceError（同实时引擎蝴蝶轮回案）
    this._mapGmgnRiskFactors = mapGmgnRiskFactors;
    // 叙事否决短路集（镜像实时引擎 _narrativeBlockedTokens，2026-09-27 用户裁定：
    // 叙事评级 low 终态的代币不再重复生成买信号——检测多少次都没用）。回测此前漏接，
    // 导致已否决 token 每次 fire 重复整链（bc4f756e 实证：222 token 重复 10,564 条
    // BUY 信号，98.9% rating=1，占 67.7min 回放的主导耗时）。内存语义同实时引擎：
    // 重启丢失后首 fire 缓存命中秒回重新登记，代价一条 signal 行
    this._narrativeBlockedTokens = new Set();
    this._shouldBlockOnNarrative = shouldBlockOnNarrative;

    // 5.6 同叙事龙头已火检查（同实时引擎：narrativeLeaderHot 因子，火门槛 5x + 首达后 24h 窗；
    // checkTimeSec 用回放时点，涨幅只算 block_time<=t 的 ticks，无未来函数）
    const { SameNarrativeLeaderService } = require('../pre-check/SameNarrativeLeaderService');
    this._sameNarrativeLeaderService = new SameNarrativeLeaderService(supabase, this.logger);

    // 6. 交易金额 / 永久阻断 / 卡牌仓位
    const experimentConfig = this._experiment?.config || {};
    this._tradeAmount = experimentConfig.tradeAmount || 0.1;
    this._permanentBlockCondition = experimentConfig.strategiesConfig?.permanentBlockCondition || null;
    // 卡牌机制开关（迁自 rich-js）：positionManagement.perCardBNB 存在且 >0 才启用。
    // 启用：买入金额 = perCardBNB × 本腿张数（cards ?? 1），卖腿配 cards 按卡数比例
    // 卖余仓（_emitSellSignal sizing）；未配置 = 全部卡牌字段忽略（存量实验零变化）
    const _pmPerCard = Number((experimentConfig.positionManagement || {}).perCardBNB);
    this._perCardBNB = Number.isFinite(_pmPerCard) && _pmPerCard > 0 ? _pmPerCard : null;
    this._cardsEnabled = this._perCardBNB != null;
    if (this._cardsEnabled) {
      this.logger.info(this._experimentId, 'BacktestEngine',
        `🃏 卡牌仓位模式启用: perCardBNB=${this._perCardBNB}（买入金额=perCardBNB×本腿张数，卖腿按卡数比例卖余仓）`);
    }

    // 6.6 行为周期分桶（卖出臂周期路由，2026-09-28）：同实时引擎——tokenCycle 段
    //     enforce=true → 主循环 buildFactorMap 后写 token.cycleTag（tick 虚拟时刻，
    //     _cycleFactors 防前视：判定只用 asOf 前数据）；缺段 = 带 cycle 腿全隐 fail-closed
    this._cycleEnforce = !!(experimentConfig.tokenCycle && experimentConfig.tokenCycle.enforce);
    if (this._cycleEnforce) {
      const _cycled = this._strategyEngine.getAllStrategies().filter(s => s.groups != null).length;
      this.logger.info(this._experimentId, 'BacktestEngine',
        `🔁 周期路由已启用（enforce）| 标注 groups 的腿=${_cycled}/${this._strategyEngine.getStrategyCount()}`);
    }

    // 6.7 引擎级止损双腿（虚拟↔回测一致性 2026-10-10 对齐，a21fa102 配对案）：语义
    //     与实时引擎 FourMemeWssTradingEngine 完全一致——不配 stopLoss 段 = 机制完全
    //     关闭（存量回测实验零变化）。回测形态差异：触发时刻全部用 tick 虚拟时钟
    //     （tick 路径=tickTs；扫描路径=当前回放到的 tickTs，等价实时的墙钟扫描）；
    //     毕业兜底不走扫描（虚拟的扫描挂点在回放里由事件消费指针的重试语义等价
    //     覆盖——卖出失败不推进指针每 tick 重试，见 _consumeGraduationEvents）
    const _sl = experimentConfig.stopLoss || {};
    const _slTimeMin = Number(_sl.timeStopMinutes);
    const _slPricePct = Number(_sl.priceStopPercent);
    this._stopLossTimeSec = Number.isFinite(_slTimeMin) && _slTimeMin > 0 ? _slTimeMin * 60 : null;
    this._stopLossPricePct = Number.isFinite(_slPricePct) && _slPricePct < 0 ? _slPricePct : null;
    const _slScanSec = Number(_sl.scanIntervalSec);
    this._stopLossScanMs = Number.isFinite(_slScanSec) && _slScanSec > 0 ? _slScanSec * 1000 : null;
    this._stopLossEnabled = !!(this._stopLossTimeSec || this._stopLossPricePct);
    this._lastStopLossScanTs = null;
    if (this._stopLossEnabled) {
      this.logger.info(this._experimentId, 'BacktestEngine',
        `🛡️ 止损双腿已启用(回测) | ${this._stopLossTimeSec != null ? `时间止损: 持有>${Math.round(this._stopLossTimeSec / 60)}min仍浮亏或持平全清 ` : ''}` +
        `${this._stopLossPricePct != null ? `价格止损: 现价≤成本${this._stopLossPricePct}%全清 ` : ''}` +
        `| 持仓扫描=${this._stopLossScanMs != null ? this._stopLossScanMs / 1000 + 's(虚拟时钟)' : '未配置（仅 tick 路径）'}`);
    }

    // 7. 批量写入缓冲区
    const { BacktestWriteBuffer } = require('../backtest/BacktestWriteBuffer');
    this._writeBuffer = new BacktestWriteBuffer(supabase, this.logger);
    this._writeBufferEnabled = experimentConfig.backtest?.writeBufferEnabled !== false;

    // 7.5 TPA 触发点持仓分析（回迁批 4 shadow 先行）：opt-in 同实时引擎——实验 config 整段无
    //     tokenPositionAnalyzer → 不构造（存量实验零影响）；段存在才构造（trigger fail-fast）。
    //     回测三点差异：persistSink 走 writeBuffer 攒批（决策不依赖落表，仅写库时机后移）；
    //     _alignClassifiedAsOf=true（防前视：分类可见时刻>asOf 的 token 不计 bad_action）；
    //     启动后预载三连（见 _loadWssTicks 之后）
    this._tokenPositionAnalyzer = null;
    const tpaExpConfig = experimentConfig.tokenPositionAnalyzer;
    if (tpaExpConfig != null) {
      const { TokenPositionAnalyzer } = require('../../services/TokenPositionAnalyzer');
      this._tokenPositionAnalyzer = new TokenPositionAnalyzer(tpaExpConfig, {
        logger: this.logger,
        experimentId: this._experimentId,
        factorAggregator: this._factorAggregator,
        // writeBuffer 关闭（调试模式，_writeBufferEnabled=false 永不 flush）时传 null →
        // TPA._persist 回退单条直写 upsert，行不丢；对齐信号通道 writeBufferEnabled guard 语义
        persistSink: this._writeBufferEnabled
          ? (row) => this._writeBuffer.addAnalysisInsert(row)
          : null,
        alignClassifiedAsOf: true,
      });
      this.logger.info(this._experimentId, 'BacktestEngine',
        `✅ TPA 已构造 (enabled=${this._tokenPositionAnalyzer.isEnabled()} ` +
        `enforce=${this._tokenPositionAnalyzer.isEnforceMode()}, alignClassifiedAsOf=true)`);
    }

    // 8. 买评估去抖（虚拟时钟模式：回放循环每 tick 前 advance 推进）
    const { TickDebouncer } = require('../core/TickDebouncer');
    this._buyDebouncer = new TickDebouncer({
      debounceMs: wsConfig.signalDebounceMs ?? 1500,
      maxWaitMs: wsConfig.signalDebounceMaxWaitMs ?? 5000,
      mode: 'virtual',
      onFire: (tokenAddress, tick, fireTs) => this._runBuyEvaluation(tokenAddress, tick, fireTs),
    });

    // 8.5 卖出确认去抖（虚拟时钟模式：首真 tick 起计不重置；默认 0=关闭=存量实验零变化）
    const { SellConfirmDebouncer } = require('../core/SellConfirmDebouncer');
    this._sellDebounceMs = wsConfig.sellDebounceMs ?? 0;
    this._sellConfirmDebouncer = new SellConfirmDebouncer({
      debounceMs: this._sellDebounceMs,
      mode: 'virtual',
      onFire: (tokenAddress, tick, fireTs) => this._onSellDebounceFire(tokenAddress, tick, fireTs),
    });
    this.logger.info(this._experimentId, 'BacktestEngine',
      `交易金额配置 | tradeAmount=${this._tradeAmount}，debounce=${wsConfig.signalDebounceMs ?? 1500}ms` +
      `，sellDebounce=${this._sellDebounceMs}ms`);

    // 9. 加载回放数据
    await this._loadTokenMetadata();
    await this._loadWssTicks();
    this.logger.info(this._experimentId, 'BacktestEngine',
      `📊 回放数据就绪: ${this._ticks.length} 笔 tick，${this._tokenMeta.size} 个代币元数据`);

    // 9.2 graduation 事件装载（虚拟↔回测一致性 2026-10-10）：wss_events kind='graduation'
    //     按 token 集合批量拉取，窗口过滤后按 tsMs 升序待回放（主循环消费见
    //     _consumeGraduationEvents）
    await this._loadGraduationEvents();

    // 9.4 EarlyParticipant 回放 ticks 索引（bc4f756e 性能案 2026-09-28）：回测期每触发
    // 买信号的早期参与者检查原本现查 wss_price_ticks（90s 窗，一 signal 一次 DB 往返）；
    // 回放数据已全量在内存——按 token 分桶预建索引注入检查服务（TPA setHistoricalTicks
    // 同款形态）。桶内 (timestamp, log_index) 升序对齐 SQL order by block_time, log_index；
    // 查询语义（闭区间/outlier=false/usd 非空/过滤后截断/桶 miss=空统计）见服务侧注释
    {
      const _epIdx = new Map();
      for (const t of this._ticks) {
        let arr = _epIdx.get(t.token_address);
        if (!arr) { arr = []; _epIdx.set(t.token_address, arr); }
        arr.push(t);
      }
      for (const arr of _epIdx.values()) {
        arr.sort((a, b) => (a.timestamp - b.timestamp) || ((a.log_index ?? 0) - (b.log_index ?? 0)));
      }
      this._preBuyCheckService.earlyParticipantService.setReplayTicksIndex(_epIdx);
      this.logger.info(this._experimentId, 'BacktestEngine',
        `EarlyParticipant 回放索引注入: ${this._ticks.length} 笔 → ${_epIdx.size} 个 token 桶`);
    }

    // 9.5 TPA 预载三连（回迁批 4，回测启动期一次性成本换回放期零 DB 往返）：
    //     offline 画像全表预载（内存 Map）→ 本实验全量 ticks 注入 trader→ticks 索引
    //     （miss/stale 路径零查询；口径=注入实验口径 ticks，平台过滤后——架构性偏离 #4
    //     已接受）→ token 分类预载（token_profiles 批量入 cache，运行期触发全命中）
    if (this._tokenPositionAnalyzer) {
      const pre = await this._tokenPositionAnalyzer.preloadOfflineProfiles(supabase);
      this.logger.info(this._experimentId, 'BacktestEngine',
        `TPA offline 画像预载: ${pre.rows} 行 / ${(pre.ms / 1000).toFixed(1)}s (${pre.source || 'fail-open'})`);
      const traders = this._tokenPositionAnalyzer.setHistoricalTicks(this._ticks);
      this.logger.info(this._experimentId, 'BacktestEngine',
        `TPA historical ticks 注入: ${this._ticks.length} 笔 → ${traders} traders`);
      const cachedTps = await this._tokenPositionAnalyzer.preloadTokenProfiles([...this._tokenMeta.keys()], supabase);
      this.logger.info(this._experimentId, 'BacktestEngine',
        `TPA token 分类预载: ${this._tokenMeta.size} token → cache ${cachedTps}`);
    }
  }

  /** 源实验 experiment_tokens → 代币元数据（FA registerToken / 落库 / totalSupply 用） */
  async _loadTokenMetadata() {
    const supabase = this._getClient();
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('experiment_tokens')
        .select('token_address, token_symbol, created_at, raw_api_data, creator_address, platform')
        .eq('experiment_id', this._sourceExperimentId)
        .order('created_at', { ascending: true })
        .range(from, from + TICK_PAGE_SIZE - 1);
      if (error) throw new Error(`读取源实验代币元数据失败: ${error.message}`);
      for (const row of data || []) {
        this._tokenMeta.set(row.token_address, {
          symbol: row.token_symbol || '',
          name: row.raw_api_data?.name || '',
          platform: row.platform || 'fourmeme',
          createdAtSec: row.created_at ? new Date(row.created_at).getTime() / 1000 : null,
          totalSupply: Number(row.raw_api_data?.totalSupply) || 0,
          creator: row.creator_address || row.raw_api_data?.creator || null,
        });
      }
      if (!data || data.length < TICK_PAGE_SIZE) break;
      from += TICK_PAGE_SIZE;
      if (from > MAX_TICK_PAGES * TICK_PAGE_SIZE) throw new Error('源实验代币数超出分页保护上限');
    }
  }

  /**
   * 回放 tick 载入（watcher 架构口径：token 集合 + platform，不再按 experiment_id——
   * 新行 experiment_id=NULL，旧口径会漏掉全部 watcher 写入的行）。
   * raw 行装载走 _loadRawTickRows：默认经 BacktestTickCache 本地缓存（jsonl.gz，
   * (sourceExperimentId, platform) 一文件全时段；配对回测/多轮验证免重复全量拉取，
   * 2026-09-29 参照 pumpfun TickDataCache 机制），backtest.cacheEnabled === false 时
   * 直拉（缓存路径只换数据来源，后续处理零差异）。
   * 全部载入后全局按 id 归并排序，再内存过滤时间窗。
   */
  async _loadWssTicks() {
    const supabase = this._getClient();
    const addresses = [...this._tokenMeta.keys()];
    // 配对回测对照臂开关（2026-10-01 GMGN 案 B 验证，H0/H1）：stripSenderAddress=true →
    // 回放 tick 不透传 sender_address → 消费侧全部 COALESCE 点（FA holders 族 + pre-buy
    // top1/sniper/netBuy）null 回退 trader，与修正前口径 bit-identical（单测 B4 机器证明）。
    // 只剥内存回放对象；BacktestTickCache 存的是 raw DB 行不动 → H0/H1 两臂共用同一缓存文件。
    const stripSender = this._experiment?.config?.backtest?.stripSenderAddress === true;
    const raw = await this._loadRawTickRows(supabase, addresses);
    // 链上真序回放（2026-10-08 凑凑案：id 分配序≠提交序，乱序回放=把未来 tick
    // 提前喂进因子状态的前视，见 compareByChainOrder 注释）
    raw.sort(compareByChainOrder);
    let tsRegressions = 0;
    let prevTs = null;
    for (const row of raw) {
      const ts = new Date(row.block_time).getTime();
      if (this._startTimeFilter && ts < this._startTimeFilter) continue;
      if (this._endTimeFilter && ts > this._endTimeFilter) continue;
      // 链序下 block_time 应非递减（BSC timestamp 协议保证单调）；倒退=数据形状
      // 异常，WARN 留痕不中断（观测口径，非兜底）
      if (prevTs !== null && ts < prevTs) tsRegressions++;
      prevTs = ts;
      this._ticks.push({
        token_address: row.token_address,
        trade_type: row.trade_type,
        trader_address: row.trader_address,
        sender_address: stripSender ? null : (row.sender_address || null),  // 真实买家 tx.from（0x1de460 案 2026-09-30）；NULL 回退 trader（消费侧 COALESCE）；H0 臂剥离复现旧口径
        price_bnb: Number(row.price_bnb),
        price_usd: row.price_usd === null ? null : Number(row.price_usd),
        bnb_amount: Number(row.bnb_amount || 0),
        token_amount: Number(row.token_amount || 0),
        block_number: row.block_number,
        timestamp: ts,
        tx_hash: row.tx_hash,
        log_index: row.log_index,
        price_outlier: row.price_outlier || false,
        platform: row.platform,   // token 级 fallback 证据（_registerToken/_evaluateBuyPath）
      });
    }
    if (tsRegressions > 0) {
      this.logger.warn(this._experimentId, 'BacktestEngine',
        `⚠️ 链上真序下 block_time 倒退 ${tsRegressions} 行（block_number/log_index 序与 block_time 不一致，需排查数据源）`);
    }
    // wss_price_ticks 表无 offers/funds_bnb 列：FA 仅在 tick.funds_bnb > 0 时更新
    // lastFundsBnb（回放恒保持 0），tvl 因子因此恒 0——策略 condition 引用 tvl 时需知情
  }

  /**
   * raw 行装载路由：缓存（默认）或直拉。
   * 开关：config.backtest.cacheEnabled（默认开启，=== false 才直拉）+
   * backtest.forceRefreshCache（默认 false，跳过缓存读强制重拉重建）。
   */
  async _loadRawTickRows(supabase, addresses) {
    const btConfig = this._experiment?.config?.backtest || {};
    if (btConfig.cacheEnabled === false) {
      const raw = [];
      for (const platform of this._platforms) {
        const rows = await this._fetchPlatformTicksRows(supabase, addresses, platform, 0, raw.length);
        for (const r of rows) raw.push(r);   // 禁 spread（大数组展开参数溢出风险）
      }
      return raw;
    }
    if (!this._tickCache) {
      const { BacktestTickCache } = require('../core/BacktestTickCache');
      this._tickCache = new BacktestTickCache({ logger: this.logger, experimentId: this._experimentId });
    }
    const forceRefresh = btConfig.forceRefreshCache === true;
    const raw = [];
    for (const platform of this._platforms) {   // both → 两 platform 文件独立装载
      const { rows, source } = await this._tickCache.getOrFetch({
        sourceExperimentId: this._sourceExperimentId,
        platform,
        addresses,
        forceRefresh,
        columnsTag: TICK_SELECT_COLUMNS,
        fetchRows: (afterId) => this._fetchPlatformTicksRows(supabase, addresses, platform, afterId, raw.length),
        probeMaxId: (anchor) => this._probeIncrementalTickId(supabase, addresses, platform, anchor),
        anchorExists: (id) => this._anchorRowExists(supabase, id),
      });
      // FRESH 纯读文件不经过 _fetchPlatformTicksRows（拉取行已在方法内计数），此处补计；
      // miss/stale/bypass 均经过 fetchRows 已计，按 source 区分防双计
      if (source === 'fresh') this.metrics.processedDataPoints += rows.length;
      this.logger.info(this._experimentId, 'BacktestEngine',
        `${platform}: raw ticks 装载 source=${source}, ${rows.length} 行`);
      for (const r of rows) raw.push(r);
    }
    return raw;
  }

  /**
   * 单 platform 锚定无序拉取（2026-10-09 终版，36a2c12a 五连折教训）。
   * MISS 传 afterId=0，STALE 增量传缓存 meta.maxId。
   *
   * 形状沿革：in(N)+gt(id)+ORDER BY id+limit 形状 planner 稳定选 pkey 顺序扫
   * （ORDER BY id 的 top-k 贪心；in(100)/in(50) 皆 8s statement timeout 且页级
   * 重试 3 次仍死=计划本身坏，与 (token,platform,id) 索引无关）；逐 token eq 稳定
   * 但 95k token 串行 ~48min/平台不可接受。无序形状（count exact 79-91ms / 无序
   * limit 49-71ms，182 实测）无 top-k 可贪、planner 稳定走 token 索引——本方法
   * 全部请求无 ORDER BY（唯一例外：单 token eq keyset，等值选择性强制索引）。
   *
   * headAnchor 时变竞态封死：装载开始锚表头 id，全部请求 .lte(id, headAnchor)
   * 闭区间——count 与 fetch 之间采集器新写的行（id > headAnchor）不进区间，
   * 行数对账在固定区间上确定性一致（无序 limit N=count 数学无损）；锚后新行由
   * 下次 STALE 增量正常补齐（探针 gt(meta.maxId)）。
   *
   * 每 chunk(50) 合一请求（count exact + 无序 limit 1000）：count=0 → 跳过；
   * count≤1000 且 len==count → 一次拉全；count>1000（热门聚集）或对账失配 →
   * 拆半递归；单 token（长尾/失配定位）→ eq+keyset 拉全并对账 count，失配
   * throw fail-loud。禁 spread push。
   */
  async _fetchPlatformTicksRows(supabase, addresses, platform, afterId, priorRowCount) {
    // 全局累计护栏上限 config 可配（backtest.maxTickRows）：默认 100 万防「拉错集合」
    // 意外；多天大窗口（36a2c12a 4 天 both 全窗口回测 flap 即 90 万+）按实验显式
    // 放宽——护栏是防意外不是正确性机制（行数对账保证无重复无遗漏）。
    const maxTickRows = this._experiment.config?.backtest?.maxTickRows || MAX_TICK_PAGES * TICK_PAGE_SIZE;
    const rows = [];
    const headAnchor = await this._fetchHeadTickId(supabase);
    this.logger.info(this._experimentId, 'BacktestEngine',
      `${platform} ticks 装载锚定 headId=${headAnchor}（闭区间 (${afterId}, ${headAnchor}]，${addresses.length} token）`);

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const guardMaxRows = () => {
      if (priorRowCount + rows.length > maxTickRows) {
        throw new Error(`回放 tick 总量超出分页保护上限（${maxTickRows}）`);
      }
    };

    // 合一请求：count exact + 无序 limit（无 ORDER BY——planner 无 top-k 可贪）
    const countFetch = async (chunk) => {
      for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
        const res = await supabase
          .from('wss_price_ticks')
          .select(TICK_SELECT_COLUMNS, { count: 'exact' })
          .in('token_address', chunk)
          .eq('platform', platform)
          .gt('id', afterId)
          .lte('id', headAnchor)
          .limit(TICK_UNORDERED_LIMIT);
        if (!res.error) return res;
        if (attempt === PAGE_ATTEMPTS) {
          throw new Error(`读取 wss_price_ticks 失败（连续 ${PAGE_ATTEMPTS} 次）: ${res.error.message}`);
        }
        await sleep(1000);
      }
    };

    // 单 token keyset（eq 等值形状，唯一允许 ORDER BY：等值选择性强制 token 索引）
    const keysetFetchToken = async (token, expectedCount) => {
      let cursor = afterId;
      let got = 0;
      for (let page = 0; page < MAX_TICK_PAGES; page++) {
        let data = null;
        let error = null;
        for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
          const r = await supabase
            .from('wss_price_ticks')
            .select(TICK_SELECT_COLUMNS)
            .eq('token_address', token)
            .eq('platform', platform)
            .gt('id', cursor)
            .lte('id', headAnchor)
            .order('id', { ascending: true })
            .limit(TICK_PAGE_SIZE);
          if (!r.error) { data = r.data; break; }
          error = r.error;
          if (attempt < PAGE_ATTEMPTS) await sleep(1000);
        }
        if (error) throw new Error(`读取 wss_price_ticks 失败（连续 ${PAGE_ATTEMPTS} 次）: ${error.message}`);
        if (!data || data.length === 0) break;
        for (const row of data) rows.push(row);
        got += data.length;
        this.metrics.processedDataPoints += data.length;
        guardMaxRows();
        if (data.length < TICK_PAGE_SIZE) break;
        cursor = data[data.length - 1].id;
      }
      if (got !== expectedCount) {
        throw new Error(`wss_price_ticks 单 token 对账失配（keyset 拉到 ${got} ≠ count ${expectedCount}）: ${token}`);
      }
    };

    // 自适应拆分：count≤limit 且对账一致（len==count）→ 一次拉全（含单 token 小批，
    // 省一次 keyset）；count>limit（热门聚集）或对账失配（闭区间下不该发生）→ 多
    // token 拆半递归 / 单 token 走 keyset 拉全并对账 count，仍失配 throw fail-loud
    const loadChunk = async (chunk) => {
      const res = await countFetch(chunk);
      if (res.count == null) {
        throw new Error(`wss_price_ticks count 形状异常（null）: platform=${platform}${res.error ? ' ' + res.error.message : ''}`);
      }
      const count = res.count;
      if (count === 0) return;
      const data = res.data || [];
      if (count <= TICK_UNORDERED_LIMIT && data.length === count) {
        for (const row of data) rows.push(row);
        this.metrics.processedDataPoints += data.length;
        guardMaxRows();
        return;
      }
      if (chunk.length === 1) {
        await keysetFetchToken(chunk[0], count);
        return;
      }
      const mid = chunk.length >> 1;
      await loadChunk(chunk.slice(0, mid));
      await loadChunk(chunk.slice(mid));
    };

    for (let ci = 0; ci < addresses.length; ci += TOKEN_CHUNK_SIZE) {
      if (ci > 0 && (ci / TOKEN_CHUNK_SIZE) % 200 === 0) {
        this.logger.info(this._experimentId, 'BacktestEngine',
          `⏳ ${platform} ticks 无序拉取进度: token ${ci}/${addresses.length}（已取 ${rows.length} 行）`);
      }
      await loadChunk(addresses.slice(ci, ci + TOKEN_CHUNK_SIZE));
    }
    return rows;
  }

  /**
   * 表头锚（锚定无序拉取配套）：无 where 的 ORDER BY id DESC LIMIT 1，pkey
   * 反向树最右叶子恒毫秒级（死的形状是「IN 列表 + 过滤 + ORDER BY DESC」的
   * top-k 贪心；无过滤表头 top-1 不扫区间）。空表返回 0（lte(id,0) 匹配 0 行
   * = 空装载，空表语义而非兜底）。
   */
  async _fetchHeadTickId(supabase) {
    for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
      const res = await supabase
        .from('wss_price_ticks')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);
      if (!res.error) {
        return res.data && res.data[0] ? Number(res.data[0].id) : 0;
      }
      if (attempt === PAGE_ATTEMPTS) {
        throw new Error(`wss_price_ticks 表头锚获取失败（连续 ${PAGE_ATTEMPTS} 次）: ${res.error.message}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  /**
   * 新鲜度探针（锚定 + 无序形状，2026-10-08 计划翻转事故两轮改造）：
   * chunk × platform 查 `id > afterId` 增量区间**任意一行**（无 ORDER BY 的
   * LIMIT 1 存在性判定）。形状选择依据（182 真实 6f92e2f9 地址集实测）：
   * ① 旧无锚 `IN(N>3) + ORDER BY id DESC LIMIT 1` 表涨 150 万行后 planner 稳定
   *    选 id 反向扫描扫表头无关行 → 8s statement timeout（in20/in50 同死）；
   * ② 锚定 `gt(meta.maxId) + ORDER DESC LIMIT 1` 只救活 token 集仍活跃（锚近表头）
   *    的平台；token 集已死（锚=集内最后行 id，如 fourmeme 10-04 死）时区间
   *    (锚, 表头] 全为无关行，反向扫照样 8s——锚定对死集无效；
   * ③ 无序 LIMIT 1 无排序需求，planner 无 top-k 反向扫可贪，稳定走
   *    (token_address, platform, id) 索引 probe（每 probe O(log n) 与区间长度
   *    无关）——fourmeme 死集旧锚最坏情形 242 批 0 错、最慢 132ms。
   * 返回值：区间有行 → 观测到的行 id（跨批取 max，仅诊断日志用；真实 max 由
   * STALE 增量拉取后 _writeSorted 重算）；无行 → null。afterId 空/0 = 无锚全
   * 区间形状。单批失败重试 2 次（间隔 1s）：491 批长循环里单批撞 DB 负载抖动
   * （实测同形状 47ms~2s 波动、偶发 >8s statement timeout，2026-10-02 d46b1b6c
   * 案）不该让整个探针 throw → bypass 落回 keyset 慢形状直拉（flap 稀疏平台必
   * 超时）；连续 3 次失败仍 throw 保持 bypass 语义（真故障不掩盖）。
   */
  async _probeIncrementalTickId(supabase, addresses, platform, afterId) {
    let maxId = null;
    const anchored = Number.isFinite(afterId) && afterId > 0;
    const PROBE_ATTEMPTS = 3;
    for (let ci = 0; ci < addresses.length; ci += TOKEN_CHUNK_SIZE) {
      const chunk = addresses.slice(ci, ci + TOKEN_CHUNK_SIZE);
      let data = null;
      for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
        let q = supabase
          .from('wss_price_ticks')
          .select('id')
          .in('token_address', chunk)
          .eq('platform', platform);
        if (anchored) q = q.gt('id', afterId);
        const res = await q.limit(1);
        if (!res.error) { data = res.data; break; }
        if (attempt === PROBE_ATTEMPTS) {
          throw new Error(`wss_price_ticks 增量探针失败（连续 ${PROBE_ATTEMPTS} 次）: ${res.error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (data && data.length > 0) {
        const id = Number(data[0].id);
        if (maxId === null || id > maxId) maxId = id;
      }
    }
    return maxId;
  }

  /**
   * 锚行 PK 存在性核验（2026-10-08 锚定探针配套）：`where id = meta.maxId limit 1`
   * 主键单行查询恒快。锚定探针返回 null（增量区间无行）时区分 FRESH 与
   * 清表/删行回缩——gt 锚形状下「DB max < 锚」结构性探不到，回缩检测责任在此。
   */
  async _anchorRowExists(supabase, id) {
    const { data, error } = await supabase
      .from('wss_price_ticks')
      .select('id')
      .eq('id', id)
      .limit(1);
    if (error) throw new Error(`wss_price_ticks 锚行核验失败: ${error.message}`);
    return !!(data && data.length > 0);
  }

  _getClient() {
    const { dbManager } = require('../../services/dbManager');
    return dbManager.getClient();
  }

  /**
   * 回放主循环：tick 按时间升序逐笔驱动（debounce advance → 首见入池 →
   * FA 增量 → 分腿路由），虚拟 30s 桶写组合快照；结束强平 + 终态。
   */
  async _runMainLoop() {
    const startTime = Date.now();
    let completedSuccessfully = false;

    try {
      this.logger.info(this._experimentId, 'BacktestEngine',
        `📊 开始回放：${this._ticks.length} 笔 tick，${this._strategyEngine.getStrategyCount()} 个策略`);

      let processed = 0;
      for (const tick of this._ticks) {
        const tickTs = tick.timestamp;

        // 虚拟时钟推进：fire 到期的买评估（用截至上一笔 tick 的状态 + 本 tick 时刻）
        await this._advanceDebouncer(tickTs);

        // 组合快照 30s 虚拟桶（loopCount 随桶自增，对齐实时引擎时序轮次语义）
        if (this._lastSnapshotTs === null || tickTs - this._lastSnapshotTs >= SNAPSHOT_INTERVAL_MS) {
          this._lastSnapshotTs = tickTs;
          this._loopCount++;
          await this._createPortfolioSnapshot(tickTs);
        }

        // 首见代币：FA 注册 + 入池 + 落库
        if (!this._seenTokens.has(tick.token_address)) {
          await this._registerToken(tick);
        }

        // 因子增量（emitFactors:false 只推进状态不构建），随后 buildFactorMap 按
        // tick 虚拟时刻取因子快照——与实时引擎 _runBuyEvaluation 同一取数路径
        this._factorAggregator.processTick(tick, { emitFactors: false });
        const factors = this._factorAggregator.buildFactorMap(tick.token_address, tick.timestamp);
        if (!factors) continue;

        // TPA 触发检查（回迁批 4）：await 保证同 tick verdict 就绪（回放串行语义，
        // 后续 buildFactorMap 立即可读 setHoldingFactors 回填的 TPAPre_* 因子；
        // asOf=tick.timestamp，tick 行含 block_number 供 blocks 时间门）
        if (this._tokenPositionAnalyzer) {
          await this._tokenPositionAnalyzer.checkAndTrigger(
            tick.token_address, factors,
            this._factorAggregator.getTokenState(tick.token_address),
            tick, tick.timestamp);
        }

        const token = this._tokenPool.getToken(tick.token_address, 'bsc');
        if (!token) continue;

        // 周期路由同步（2026-09-28）：buildFactorMap(tick.timestamp) 已按虚拟时刻推进
        // _cycleLatch（防前视），此处写 token.cycleTag 供 evaluate 桶路由
        if (this._cycleEnforce) token.cycleTag = factors.tokenCycle ?? null;

        // 分腿路由（与实时引擎 _onFactorsUpdated 同构）
        if (token.status === 'bought' && !this._buyingTokens.has(tick.token_address)) {
          // 引擎级止损双腿（tick 即时路径，对齐实时挂点）：命中优先于策略腿——保命腿不等策略评估
          const _slHit = this._stopLossHit(factors);
          if (_slHit) {
            await this._emitStopLossSell(token, factors, _slHit, tickTs, tick);
          } else {
            await this._evaluateSellPath(token, factors, tick);
          }
        } else if (!this._buyingTokens.has(tick.token_address) && token.status !== 'bought') {
          if (this._buyDebouncer.pending.has(tick.token_address)) this.metrics.debounceSuppressed++;
          this._buyDebouncer.touch(tick.token_address, tick);
        }

        // 止损持仓扫描（虚拟时钟节流，断流票兜底——对齐实时 setInterval(scanIntervalSec)）：
        // 无 tick 的持仓在 tick 路径永不评估；到达扫描周期时以当前 tickTs 全持仓扫一遍，
        // buildFactorMap(addr, tickTs) 保证断流期 holdDuration 继续走（实时扫描用墙钟，
        // 回放里 tickTs 即墙钟等价物）
        if (this._stopLossEnabled && this._stopLossScanMs != null &&
            (this._lastStopLossScanTs === null || tickTs - this._lastStopLossScanTs >= this._stopLossScanMs)) {
          this._lastStopLossScanTs = tickTs;
          await this._scanHoldingsStopLoss(tickTs);
        }

        // graduation 事件消费（tick 尾部：本 tick 已注册/进 FA，毕业断流前最后价就绪）。
        // 毕业后 ticks 停止 → 下一 tick 可能几小时后或不来，尾部 drain 兜底（见下）
        await this._consumeGraduationEvents(tickTs);

        processed++;
        if (processed % 5000 === 0) {
          this.logger.info(this._experimentId, 'BacktestEngine',
            `回放进度: ${processed}/${this._ticks.length}（${(processed / this._ticks.length * 100).toFixed(1)}%）` +
            ` 信号=${this.metrics.totalSignals} 交易=${this.metrics.totalTrades}`);
          // 定期冲刷：长回放不能只在结束时 flush（内存堆积 + 中途崩溃全丢）
          if (this._writeBufferEnabled && this._writeBuffer && this._writeBuffer.pendingCount > 0) {
            await this._writeBuffer.flush(this._experimentId);
          }
        }
      }

      // 冲刷残留 pending：买评估 burst 尾部（maxWait 覆盖，+10min 到期）；卖出去抖按
      // lastTs + sellDebounceMs 精确到期（fire 重评仍真才卖——强平前最后一次策略卖；
      // 强平走 force_sell 不置闩锁——无策略上下文）
      const lastTickTs = this._ticks[this._ticks.length - 1]?.timestamp || Date.now();
      this._buyDebouncer.advance(lastTickTs + 10 * 60 * 1000);
      this._sellConfirmDebouncer.advance(lastTickTs + this._sellDebounceMs + 1);
      if (this._inflightEvals.size > 0) {
        await Promise.all([...this._inflightEvals]);
      }

      // graduation 尾部 drain：毕业后 ticks 停止，尾部事件（tsMs > 最后一笔 tick）
      // 在 tick 循环里永远等不到消费点——窗口内的剩余事件全部处理后再强平
      //（强平前最后一次毕业卖出尝试，语义对齐虚拟「断流前最后可靠价落袋」）
      await this._consumeGraduationEvents(Infinity);

      // 回放结束：强平所有持仓（沿用旧回测语义）
      await this._forceSellAllRemaining();

      if (this._writeBufferEnabled && this._writeBuffer && this._writeBuffer.pendingCount > 0) {
        await this._writeBuffer.flush(this._experimentId);
      }

      const duration = Date.now() - startTime;
      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      const finalBalance = portfolio?.totalValue || this.initialBalance;
      const finalBalanceValue = typeof finalBalance === 'number' ? finalBalance : finalBalance.toNumber();
      const profit = finalBalanceValue - this.initialBalance;
      const profitPercent = ((profit / this.initialBalance) * 100).toFixed(2);

      this.logger.info(this._experimentId, 'BacktestEngine',
        `✅ 回放完成，耗时 ${duration}ms | 初始 ${this.initialBalance} → 最终 ${finalBalanceValue.toFixed(4)} BNB | ` +
        `收益 ${profit.toFixed(4)} (${profitPercent > 0 ? '+' : ''}${profitPercent}%) | ` +
        `信号 ${this.metrics.totalSignals}/${this.metrics.executedSignals} | 交易 ${this.metrics.totalTrades}` +
        `（成功 ${this.metrics.successfulTrades} 失败 ${this.metrics.failedTrades}）| debounceFired=${this.metrics.debounceFired}` +
        ` | narrativeBlocked=${this._narrativeBlockedTokens.size}` +
        ` | memCacheHit=${this._narrativeCaller.getMemoryCacheHits()}` +
        ` | earlyReplayHit=${this._preBuyCheckService.earlyParticipantService.getReplayHits()}` +
        ` | preFilterSkipped=${this._factorAggregator.getPreFilterSkipped()}` +
        (this._tokenPositionAnalyzer
          ? ` | TPA: ${JSON.stringify(this._tokenPositionAnalyzer.getStats())}` +
            (this._tokenPositionAnalyzer.getProfileStats()
              ? ` | TPA探针: ${JSON.stringify(this._tokenPositionAnalyzer.getProfileStats())}` : '')
          : ''));

      completedSuccessfully = true;
    } catch (error) {
      this.logger.error(this._experimentId, 'BacktestEngine', `❌ 回放执行失败: ${error.message}`);
      this.logger.error(this._experimentId, 'BacktestEngine', 'Stack trace', { stack: error.stack });
    } finally {
      // 市场截面 feed 关闭 + 模块级单例清除（防同进程下一实验继承回放累积的截面）
      require('../../services/FourMemeFactorAggregator').setMarketFeedEnabled(false);

      // TPA 清理（回迁批 4：verdict/画像缓存释放）
      if (this._tokenPositionAnalyzer) {
        this._tokenPositionAnalyzer.destroy();
      }

      const finalStatus = completedSuccessfully ? 'completed' : 'failed';
      try {
        await this._updateExperimentStatus(finalStatus);
        this._finalStatusSet = true;
        this.logger.info(this._experimentId, 'BacktestEngine', `📊 实验终态: ${finalStatus}`);
      } catch (updateError) {
        this.logger.error(this._experimentId, 'BacktestEngine', `更新实验状态失败: ${updateError.message}`);
      }

      // 回测结束即算收益（2026-10-01）：completed 后立即计算 stats 写 experiments.stats，
      // 免手动点首页「分析」按钮（analyze-all 见 stats.tokenCount>0 自动跳过，幂等）。
      // 仅 completed 算：failed 时强平腿未执行、尾部 trades 未必 flush，半程数据
      // 算出的收益会误导。失败只记日志不动终态——分析按钮仍是手动补救路径。
      if (finalStatus === 'completed' && this._finalStatusSet) {
        try {
          const statsService = new ExperimentStatsService();
          const stats = await statsService.calculateExperimentStats(this._experimentId);
          const { error: statsError } = await this._getClient()
            .from('experiments')
            .update({ stats })
            .eq('id', this._experimentId);
          if (statsError) throw new Error(statsError.message);
          this.logger.info(this._experimentId, 'BacktestEngine',
            `📊 收益统计已写入: ${stats.tokenCount} 票 | 胜率 ${Number(stats.winRate).toFixed(1)}% | ` +
            `净额 ${stats.bnbChange >= 0 ? '+' : ''}${Number(stats.bnbChange).toFixed(4)} BNB | ` +
            `收益率 ${stats.totalReturn >= 0 ? '+' : ''}${Number(stats.totalReturn).toFixed(2)}%`);
        } catch (statsError) {
          this.logger.error(this._experimentId, 'BacktestEngine',
            `回测结束 stats 计算失败（终态不受影响）: ${statsError.message}`);
        }
      }
    }
  }

  async _syncHoldings() {
    // 回测持仓由 PortfolioManager 在回放中记账，无需外部同步
  }

  // ==================== graduation 事件回放（虚拟↔回测一致性 2026-10-10）====================

  /**
   * 拉取回放 token 集合内的毕业事件（wss_events kind='graduation'，token 级全局
   * 表不挂实验维度；both 采集器写的行全量可见）。行 payload 形状（collector
   * onGraduation info 原样）：{ token, offers, quote, fundsBnb, blockNumber,
   * blockTimeMs, txHash }；block_time 列兜底定时锚。窗口 [startTime, endTime]
   * 过滤后按 tsMs 升序——回放消费按时序插入 tick 流。
   */
  async _loadGraduationEvents() {
    const supabase = this._getClient();
    const addresses = [...this._tokenMeta.keys()];
    // 批 50（对齐 TOKEN_CHUNK_SIZE）：.in() 参数走 URL，批 500 时 500×43 字符 ≈ 21.5KB
    // 超网关 8KB 限制 → fetch failed（74444a0c 首启实证：连续 3 次重试全死）
    const BATCH = 50;
    let total = 0;
    for (let i = 0; i < addresses.length; i += BATCH) {
      let data = null;
      for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
        const res = await supabase
          .from('wss_events')
          .select('token_address, payload, block_time')
          .eq('kind', 'graduation')
          .in('token_address', addresses.slice(i, i + BATCH));
        if (!res.error) { data = res.data; break; }
        if (attempt === PAGE_ATTEMPTS) {
          throw new Error(`读取 wss_events graduation 失败（连续 ${PAGE_ATTEMPTS} 次）: ${res.error.message}`);
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      for (const row of data || []) {
        const payload = row.payload || {};
        const tsMs = Number(payload.blockTimeMs)
          || (row.block_time ? new Date(row.block_time).getTime() : 0);
        if (!tsMs) {
          this.logger.warn(this._experimentId, 'BacktestEngine',
            `graduation 事件缺时间锚，跳过 | ${row.token_address}`);
          continue;
        }
        if (this._startTimeFilter && tsMs < this._startTimeFilter) continue;
        if (this._endTimeFilter && tsMs > this._endTimeFilter) continue;
        this._graduationEvents.push({
          token: row.token_address,
          tsMs,
          fundsBnb: Number(payload.fundsBnb) || null,
        });
        total++;
      }
    }
    this._graduationEvents.sort((a, b) => a.tsMs - b.tsMs);
    this.logger.info(this._experimentId, 'BacktestEngine',
      `🎓 graduation 事件装载: ${total} 个（token 集合 ${addresses.length}，窗口内）`);
  }

  /**
   * 消费到期毕业事件（主循环每 tick 尾部 + 回放收尾 drain 调用）：
   *   - 事件时刻 ≤ upToTs 的依次处理：markGraduated（FA 防前视：此后的
   *     graduationProgress 判定不受影响，毕业臂策略腿语义不变）
   *   - 持仓票 → _emitGraduationSell 全清（断流前最后可靠价 = buildFactorMap(evtTs)，
   *     毕业后无新 tick，evtTs 时刻取值即最后价格史——虚拟引擎同款）
   *   - 未持仓 → 仅标记推进（后续买入由买入成功点补卖覆盖）
   *   - 卖出失败不推进指针（每 tick 重试，虚拟「扫描兜底」的回放等价物）；
   *     持续失败最终由回放结束强平收尾
   * 消费点在 tick 处理之后：同块「首 tick + 毕业事件」时首见注册已完成
   * （markGraduated 需要 FA state 存在）。
   */
  async _consumeGraduationEvents(upToTs) {
    while (this._gradEvtIdx < this._graduationEvents.length) {
      const evt = this._graduationEvents[this._gradEvtIdx];
      if (evt.tsMs > upToTs) break;
      this._factorAggregator.markGraduated(evt.token);
      // 事件到达标记在消费点填充（74444a0c 数据点 B 前视事故：装载即填会把「未来
      // 毕业」提前暴露给买入成功点补卖判据——CZ 买入 fireTs 16:39:04 查到 14s 后
      // 才毕业的标记直接补卖@买价 0%，虚拟引擎对应标记是事件墙钟到达才置。
      // 挪到消费点后「事件先于首 tick」边缘仍覆盖：集合独立于 FA state 存在性）
      this._graduatedTokens.add(evt.token);
      const token = this._tokenPool.getToken(evt.token, 'bsc');
      if (token && token.status === 'bought' && !this._graduationSoldTokens.has(evt.token)) {
        const result = await this._emitGraduationSell(token, evt);
        if (!result || !result.success) break;   // 失败不推进指针，下轮重试
      }
      this._gradEvtIdx++;
    }
  }

  /**
   * 毕业事件驱动全清（虚拟引擎 _emitGraduationSell 的回放版，语义逐字对齐）：
   * 构造等价 strategy（与止损腿同构：cards='all'/sellPercentage=1/bypassDebounce）
   * 走 _emitSellSignal 全清链——signals/trades/卡账本/累亏记账副作用全复用。
   * 卖出价 = 断流前最后可靠价（buildFactorMap(evtTs)）。幂等标记后置到卖出成功；
   * 并发双调被 _emitSellSignal 内 _sellingTokens 挡住。
   */
  async _emitGraduationSell(token, evt) {
    const tokenAddress = token.token;
    if (this._graduationSoldTokens.has(tokenAddress)) return { success: true };
    const factors = this._factorAggregator.buildFactorMap(tokenAddress, evt.tsMs);
    if (!factors) return { success: false, reason: '无因子（价格史空）' };
    const strategy = {
      id: 'graduationSell', name: '毕业事件全清',
      action: 'sell', sellPercentage: 1, cards: 'all', bypassDebounce: true,
      priority: 0, lockTokenAfterSell: false, maxExecutions: null, cumulativeLossLockPct: null,
    };
    this.logger.info(this._experimentId, 'Graduation',
      `${token.symbol || tokenAddress.slice(0, 10)} 毕业事件驱动全清(回放) | funds=${evt.fundsBnb} BNB ` +
      `余仓按断流前最后可靠价落袋 graduationProgress=${factors.graduationProgress?.toFixed(3)}`);
    const result = await this._emitSellSignal(token, strategy, factors, evt.tsMs, null);
    if (result && result.success) this._graduationSoldTokens.add(tokenAddress);
    return result;
  }

  /**
   * 重写：回放已终态（completed/failed）后到达的停机信号不再覆盖状态、
   * 不补写真实时间快照（回放快照均已按虚拟时间落库）。
   */
  async stop() {
    if (this._finalStatusSet) {
      this._isStopped = true;
      this._status = EngineStatus.STOPPED;
      this.logger.info(this._experimentId, 'BacktestEngine', '回放已终态，停机信号仅置本地标志');
      return;
    }
    await super.stop();
  }

  _shouldRecordTimeSeries() {
    return false; // 回测不写 experiment_time_series_data（tick 重算，时序表是实时引擎产物）
  }

  /**
   * 虚拟时钟推进 + drain：advance 同步触发 onFire → _runBuyEvaluation /
   * _onSellDebounceFire（async fire-and-forget，与实时引擎同构）；回放串行语义
   * 要求评估在下一笔 tick 前完成（含预检查网络调用），drain 后再继续。
   */
  async _advanceDebouncer(tickTs) {
    this._buyDebouncer.advance(tickTs);
    this._sellConfirmDebouncer.advance(tickTs);
    if (this._inflightEvals.size > 0) {
      await Promise.all([...this._inflightEvals]);
    }
  }

  // ==================== 回放代币注册 ====================

  async _registerToken(tick) {
    const tokenAddress = tick.token_address;
    this._seenTokens.add(tokenAddress);
    const meta = this._tokenMeta.get(tokenAddress) || {};
    const createdAtSec = meta.createdAtSec || Math.floor(tick.timestamp / 1000);

    this._factorAggregator.registerToken(tokenAddress, {
      createdAtMs: createdAtSec * 1000,
      totalSupply: meta.totalSupply || 0,
      symbol: meta.symbol || '',
      creatorAddress: meta.creator || null,
      // 平台透传（FA platform 因子 + preBuy 分门）：tick 行级权威（分平台 .eq 装载
      // 恒有值）。刻意不兜 meta.platform——_loadTokenMetadata 是 `row.platform ||
      // 'fourmeme'` 兜底，并集容器行 platform 多为 null 时会把 flap 票错标
      // fourmeme = 豁免 router 门 = 漏拦（危险方向）；null 时分门走 fail-closed
      // （platform != 'flap' null 比较 false → 落回 router 区间门）
      platform: tick.platform || null,
    });
    this._tokenPool.addToken({
      token: tokenAddress,
      chain: 'bsc',
      // fallback 链：meta（源实验行级）→ tick 行（源实验缺行的罕见路径）→ 实验主平台；
      // 'both' 不落库——集合首元素 fourmeme 是缺省主平台
      platform: meta.platform || tick.platform || this._platforms[0],
      data_source: 'wss',
      name: meta.name || meta.symbol || '',
      symbol: meta.symbol || '',
      created_at: createdAtSec,
      current_price_usd: null,
      creator_address: meta.creator || null,
    });

    try {
      if (this._writeBufferEnabled && this._writeBuffer) {
        // P1-3（bc4f756e 性能案）：experiment_tokens 逐 token 直写（5,495 次 roundtrip）
        // 改 buffer 批量。行构造镜像 ExperimentDataService.saveToken 字段组装；
        // narrative_material_id 提取省略——回放 raw_api_data 无 URL 字段，提取恒 null
        // （语义安全，plan 已核）；唯一冲突（--force 重跑残留旧行）走 _batchInsert
        // 降级路径记日志跳过，与直写 saveToken 的 23505 吞掉语义等价
        const tokenRow = {
          experiment_id: this._experimentId,
          token_address: tokenAddress,
          token_symbol: meta.symbol || '',
          blockchain: 'bsc',
          platform: meta.platform || tick.platform || this._platforms[0],
          data_source: 'wss',
          discovered_at: new Date(createdAtSec * 1000).toISOString(),
          status: 'monitoring',
          raw_api_data: { source: 'wss_tick_replay', totalSupply: meta.totalSupply || 0, creator: meta.creator },
        };
        if (meta.creator) tokenRow.creator_address = meta.creator;
        this._writeBuffer.addTokenInsert(tokenRow);
      } else {
        await this.dataService.saveToken(this._experimentId, {
          token: tokenAddress,
          symbol: meta.symbol || '',
          chain: 'bsc',
          platform: meta.platform || tick.platform || this._platforms[0],
          data_source: 'wss',
          created_at: createdAtSec,
          raw_api_data: { source: 'wss_tick_replay', totalSupply: meta.totalSupply || 0, creator: meta.creator },
          creator_address: meta.creator || null,
          status: 'monitoring',
        });
      }
    } catch (error) {
      this.logger.error(this._experimentId, 'BacktestEngine',
        `回放代币落库失败 | ${tokenAddress} ${error.message}`);
    }
  }

  // ==================== 买路径（虚拟时钟版，结构与实时引擎对齐）====================

  _runBuyEvaluation(tokenAddress, tick, fireTs) {
    this.metrics.debounceFired++;
    const factors = this._factorAggregator.buildFactorMap(tokenAddress, fireTs);
    if (!factors) return Promise.resolve();

    const token = this._tokenPool.getToken(tokenAddress, 'bsc');
    if (!token) return Promise.resolve();
    // 周期路由同步（fire 时刻 buildFactorMap 已按虚拟时刻推进 latch；防 cycleTag 滞后一拍）
    if (this._cycleEnforce) token.cycleTag = factors.tokenCycle ?? null;
    if (this._buyingTokens.has(tokenAddress)) return Promise.resolve();
    if (token.status === 'bought') return Promise.resolve();
    if (this._tokenBlacklist.has(tokenAddress)) return Promise.resolve();

    // pumpfun 回迁批 2 买腿门：止损闩锁/累亏闩锁（token 级降维，语义同实时引擎；
    // 置锁与记账在 _emitSellSignal 卖出成功处，日志 tag [stopLossLock]/[cumLossLock]）
    if (this._tokenLocks.has(tokenAddress)) return Promise.resolve();
    if (this._cumLossLockPct != null
        && (this._cumLossTotals.get(tokenAddress) ?? 0) <= this._cumLossLockPct) return Promise.resolve();

    const p = this._evaluateBuyPath(token, factors, tick, fireTs)
      .catch(e => this.logger.error(this._experimentId, 'BuyEval',
        `${token.symbol || tokenAddress.slice(0, 10)} 回放买腿评估异常: ${e.message}`));
    // 收集 inflight promise：回放主循环 drain 后才推进下一笔 tick / 强平
    this._inflightEvals.add(p);
    p.finally(() => this._inflightEvals.delete(p));
    return p;
  }

  async _evaluateBuyPath(token, factorResults, tick, fireTs) {
    const tokenAddress = token.token;
    const { buildFactorValuesForTimeSeries, buildPreBuyCheckFactorValues, buildTpaFactorSnapshot } = require('../core/FactorBuilder');
    const nowTs = fireTs;

    this._buyingTokens.add(tokenAddress);
    try {
      if (!token.strategyExecutions || Object.keys(token.strategyExecutions).length === 0) {
        const strategyIds = this._strategyEngine.getAllStrategies().map(s => s.id);
        this._tokenPool.initStrategyExecutions(token.token, token.chain || 'bsc', strategyIds);
      }

      // 分腿评估（只看买腿）
      const strategy = this._strategyEngine.evaluate(factorResults, token.token, nowTs, token, 'buy');
      if (!strategy) {
        return { success: false, reason: '无触发买入策略' };
      }

      this.logger.info(this._experimentId, 'BuyEval',
        `${token.symbol} 触发买入策略(回放): ${strategy.name} | price=${factorResults.currentPrice?.toExponential(4)}` +
        ` earlyReturn=${factorResults.earlyReturn?.toFixed(1)}% age=${factorResults.age?.toFixed(2)}min tick=y`);

      // ── 叙事否决短路（镜像实时引擎，2026-09-27 用户裁定）──
      // 叙事评级已确认为 low（终态，检测多少次都没用）的代币不再生成买信号——
      // 不落 signal 行、不跑叙事直调/preBuyCheck；仅对配置了 narrativeCallCondition
      // （叙事直调链路启用）的策略生效，未配叙事的策略零影响。address-fail 宣告
      // 竞态盘的豁免在登记侧把关（shouldBlockOnNarrative，重试窗内不登记）
      const narrativeGateEnabled = !!(strategy.narrativeCallCondition && String(strategy.narrativeCallCondition).trim() !== '');
      if (narrativeGateEnabled && this._narrativeBlockedTokens.has(tokenAddress)) {
        return { success: false, reason: '叙事否决短路（评级 low 终态，不再生成信号）' };
      }

      const latestPrice = factorResults.currentPrice || 0;
      if (!(latestPrice > 0)) {
        return { success: false, reason: '无有效价格' };
      }

      // 信号先落库（预检查失败也留痕），时间戳用回放时点
      const signal = {
        action: 'buy',
        symbol: token.symbol,
        tokenAddress: token.token,
        chain: token.chain || 'bsc',
        price: latestPrice,
        confidence: 80,
        reason: strategy.name,
        strategyId: strategy.id,
        strategyName: strategy.name,
        cards: strategy.cards, // 卡牌（迁自 rich-js）：本腿买入张数（_calculateBuyAmount/_executeBuy 消费）
        factors: { trendFactors: buildFactorValuesForTimeSeries(factorResults) },
        timestamp: new Date(nowTs),
      };

      let signalId = null;
      try {
        const { TradeSignal } = require('../entities');
        const tradeSignal = new TradeSignal({
          experimentId: this._experimentId,
          tokenAddress: signal.tokenAddress,
          tokenSymbol: signal.symbol,
          signalType: 'BUY',
          action: 'buy',
          confidence: signal.confidence,
          reason: signal.reason,
          chain: signal.chain,
          metadata: {
            price: signal.price,
            strategyId: signal.strategyId,
            strategyName: signal.strategyName,
            ...signal.factors,
          },
          createdAt: signal.timestamp,
        });
        signalId = tradeSignal.id;
        if (this._writeBufferEnabled && this._writeBuffer) {
          this._writeBuffer.addSignalInsert(tradeSignal.toDatabaseFormat());
        } else {
          await tradeSignal.save();
        }
        this.metrics.totalSignals++;
      } catch (saveError) {
        this.logger.error(this._experimentId, 'BuyEval', `信号保存失败 | ${token.symbol} ${saveError.message}`);
        return { success: false, reason: `信号保存失败: ${saveError.message}` };
      }

      // ── 购买前检查（与实时引擎同构；checkTime 用回放时点）──
      let preCheckPassed = true;
      let blockReason = null;
      let preBuyCheckResult = null;

      const creatorAddress = token.creator_address || token.creatorAddress || null;
      const currentRound = this._tokenPool.getCurrentRound(token.token, token.chain || 'bsc');
      let shouldPerformPreCheck = false;
      if (currentRound === 0) {
        shouldPerformPreCheck = !!(strategy.preBuyCheckCondition && String(strategy.preBuyCheckCondition).trim() !== '');
      } else {
        shouldPerformPreCheck = !!(strategy.repeatBuyCheckCondition && String(strategy.repeatBuyCheckCondition).trim() !== '');
      }

      if (this._tokenBlacklist.has(token.token)) {
        preCheckPassed = false;
        blockReason = this._tokenBlacklist.get(token.token).reason;
      }

      // ── 叙事评级直调（同实时引擎：narrativeCallCondition 满足才同步调 analyze；
      // 结果为代币级全局缓存（不挂实验名下）；超时挂钟等待 30s，虚拟时钟回放下视为该 tick 时点的决策；
      // 失败/超时=9 放行）──
      let narrativeCallInfo = null;
      let narrativeLeaderInfo = null;
      const narrativeCallCondition = strategy.narrativeCallCondition && String(strategy.narrativeCallCondition).trim() !== ''
        ? String(strategy.narrativeCallCondition).trim() : null;
      if (narrativeCallCondition && preCheckPassed
          && this._strategyEngine.evaluateCondition(narrativeCallCondition, factorResults)) {
        narrativeCallInfo = await this._narrativeCaller.getRating(token.token);
        this.logger.info(this._experimentId, 'BuyEval',
          `叙事评级直调(回放) | ${token.symbol} rating=${narrativeCallInfo.numericRating}(${narrativeCallInfo.rating})` +
          ` ${narrativeCallInfo.durationMs}ms fromCache=${narrativeCallInfo.fromCache}` +
          (narrativeCallInfo.error ? ` error=${narrativeCallInfo.error}` : ''));

        // ── 叙事否决短路登记（镜像实时引擎）──
        // rating=low（终态）→ 登记短路集，本 token 后续 fire 不再生成买信号；
        // address-fail（宣告竞态，重试窗内可能被 PrecheckFailRetryService 翻正）豁免；
        // age 取 fire 因子（分钟、锚 token 创建时刻，与实时引擎同源同单位）
        if (this._shouldBlockOnNarrative(
          narrativeCallInfo.numericRating,
          narrativeCallInfo.precheckStage,
          factorResults.age ?? null,
        )) {
          this._narrativeBlockedTokens.add(tokenAddress);
          this.logger.info(this._experimentId, 'BuyEval',
            `叙事否决登记(回放) | ${token.symbol} rating=low${narrativeCallInfo.precheckStage ? `(${narrativeCallInfo.precheckStage})` : ''}` +
            ' → 后续买信号短路（address-fail 重试窗内已豁免的除外）');
        }

        // ── 同叙事龙头已火检查（回放：checkTimeSec 用回放时点，与下方 performAllChecks checkTime 同源；
        // 无 sourceTweetId→因子 0 放行；候选 material_id 映射为当前状态属已知穿越，涨幅计算无前视）──
        if (narrativeCallInfo.sourceTweetId) {
          narrativeLeaderInfo = await this._sameNarrativeLeaderService.check({
            tokenAddress: token.token,
            sourceTweetId: narrativeCallInfo.sourceTweetId,
            checkTimeSec: Math.floor(nowTs / 1000),
          });
          this.logger.info(this._experimentId, 'BuyEval',
            `同叙事龙头检查(回放) | ${token.symbol} hot=${narrativeLeaderInfo.factors.narrativeLeaderHot}` +
            ` count=${narrativeLeaderInfo.factors.narrativeLeaderCount}` +
            ` max=${narrativeLeaderInfo.factors.narrativeLeaderMaxMultiple}x` +
            ` ${narrativeLeaderInfo.detail.durationMs}ms tweet=${narrativeCallInfo.sourceTweetId}` +
            (narrativeLeaderInfo.detail.error ? ` error=${narrativeLeaderInfo.detail.error}` : ''));
        }
      }

      if (preCheckPassed && shouldPerformPreCheck && this._preBuyCheckService) {
        try {
          const { updateRouterGateState, routerGateFactors } = require('../pre-check/router-gate-state');
          const tokenPlatform = token.platform || tick.platform || this._platforms[0];
          const tokenInfo = {
            address: token.token,
            symbol: token.symbol,
            name: this._tokenMeta.get(token.token)?.name || token.name || '',
            chain: 'bsc',
            platform: tokenPlatform,
            launchAt: token.createdAt || null,
            innerPair: `${token.token}_${tokenPlatform === 'flap' ? 'fl' : 'fo'}`,
          };
          let preBuyCheckCondition = currentRound === 0
            ? strategy.preBuyCheckCondition
            : strategy.repeatBuyCheckCondition;
          preBuyCheckCondition = String(preBuyCheckCondition).trim();

          const lastPairReturnRate = this._tokenPool.getLastPairReturnRate(token.token, token.chain || 'bsc');

          // 早晚票语料滞后秒（0fed29f9 案 2026-10-08，与实时引擎同口径）：FA 出生锚
          // （回测 = discovered_at）− corpusTs。时序穿越声明同 narrativeRating：语料是
          // 当前快照分析历史 token，lag 只看相对增量。null = 晚票门 fail-closed。
          const faBirthMs = this._factorAggregator.getTokenState(token.token)?.createdAtMs ?? null;
          const narrativeCorpusLagSec = faBirthMs && narrativeCallInfo?.corpusTs
            ? Math.round((faBirthMs - narrativeCallInfo.corpusTs) / 1000)
            : null;
          const meta = this._tokenMeta.get(token.token) || {};
          let totalSupply = meta.totalSupply || 0;
          if (totalSupply <= 0 && factorResults.fdv > 0 && factorResults.currentPrice > 0) {
            totalSupply = factorResults.fdv / factorResults.currentPrice;
          }

          preBuyCheckResult = await this._preBuyCheckService.performAllChecks(
            token.token,
            creatorAddress,
            this._experimentId,
            signalId,
            'bsc',
            tokenInfo,
            preBuyCheckCondition,
            {
              checkTime: Math.floor(nowTs / 1000),
              tokenBuyTime: token.buyTime || null,
              drawdownFromHighest: factorResults.drawdownFromHighest || null,
              buyRound: currentRound + 1,
              lastPairReturnRate: lastPairReturnRate ?? 0,
              // early trades 存档走 buffer 批量（通道+flush FK 顺序 signals→early_trades
              // 已就绪；buffer 关时 undefined 落回直写，P1-4 接线）
              earlyTradesCacheCallback: this._writeBufferEnabled && this._writeBuffer
                ? (d) => this._writeBuffer.addEarlyTradesInsert(d)
                : undefined,
              narrativeRating: narrativeCallInfo?.numericRating ?? 9, // 直调链路（时序穿越：当前语料分析历史 token）；未配置/未触发/失败/超时=9
              narrativeCorpusLagSec, // 早晚票分级（上方注释）；null=晚票门 fail-closed
              // earlyReturn 注入 preBuy context（实时引擎同款；晚票门右臂证据）
              earlyReturn: factorResults.earlyReturn ?? null,
              narrativeLeaderHot: narrativeLeaderInfo?.factors?.narrativeLeaderHot ?? 0, // 同叙事龙头链路；无 tweet/失败=0 放行
              narrativeLeaderCount: narrativeLeaderInfo?.factors?.narrativeLeaderCount ?? 0,
              narrativeLeaderMaxMultiple: narrativeLeaderInfo?.factors?.narrativeLeaderMaxMultiple ?? 0,
              // GMGN 风险因子（x-0 案）：同 narrativeRating 直调链路；时序穿越同声明
              // （GMGN 是当前快照——历史 token 的 issuerTokenCount 含其后所有发币，
              // 偏拦方向；bundler 是当前 holder 群体）——只看相对增量，绝对值不代表实时可得
              ...this._mapGmgnRiskFactors(narrativeCallInfo?.gmgnRisk),
              tweetAuthorType: factorResults.tweetAuthorType ?? 0,
              dataCollectionRound: factorResults.dataCollectionRound ?? 0,
              totalSupply,
              // 平台标签（router 平台分门）：tick 行级真值（同 _registerToken 口径）
              platform: token.platform || factorResults.platform || null,
              // router 门观察史（2026-10-03）：截至上次 fire 的状态——本次 fire 的 rp
              // 由下方回填进状态、本次评估不消费（本次出界由区间门拦，无双计数）
              ...routerGateFactors(this._routerGateState.get(token.token)),
            },
          );

          // router 门观察史回填（fire 后）：flap 且 rp 非空才累计（宁漏不误）
          if (preBuyCheckResult && preBuyCheckResult.earlyTradesRouterPct != null) {
            this._routerGateState.set(token.token, updateRouterGateState(
              this._routerGateState.get(token.token),
              tokenPlatform,
              preBuyCheckResult.earlyTradesRouterPct,
            ));
          }

          if (!preBuyCheckResult.canBuy) {
            this.logger.warn(this._experimentId, 'BuyEval',
              `购买前检查失败(回放) | ${token.symbol} reason=${preBuyCheckResult.checkReason}`);
            preCheckPassed = false;
            blockReason = preBuyCheckResult.checkReason || 'pre_buy_check_failed';
          }

          if (this._permanentBlockCondition && preBuyCheckResult) {
            const blockResult = this._evaluatePermanentBlock(preBuyCheckResult, this._permanentBlockCondition);
            if (blockResult.blocked) {
              this._tokenBlacklist.set(token.token, { reason: blockResult.reason, timestamp: nowTs });
              if (preCheckPassed) {
                preCheckPassed = false;
                blockReason = blockResult.reason;
              }
            }
          }
        } catch (checkError) {
          this.logger.error(this._experimentId, 'BuyEval',
            `购买前检查异常(回放): ${token.symbol} - ${checkError.message}`);
          preCheckPassed = false;
          blockReason = `购买前检查异常: ${checkError.message}`;
        }
      } else if (!shouldPerformPreCheck) {
        preBuyCheckResult = { canBuy: true, checkReason: '跳过购买前检查' };
      }

      const tokenCreateTime = token.createdAt || null;

      if (!preCheckPassed) {
        if (signalId) {
          this._bufferSignalUpdate(signalId, {
            metadata: {
              tokenCreateTime,
              trendFactors: buildFactorValuesForTimeSeries(factorResults),
              tpaFactors: buildTpaFactorSnapshot(factorResults),
              narrativeCall: narrativeCallInfo,
              narrativeLeaderCheck: narrativeLeaderInfo,
              preBuyCheckFactors: {
                ...buildPreBuyCheckFactorValues(preBuyCheckResult || {}),
                permanentBlockTriggered: this._tokenBlacklist.has(token.token),
                permanentBlockCondition: this._permanentBlockCondition || null,
              },
              preBuyCheckResult: {
                canBuy: false,
                reason: blockReason,
              },
              execution_status: 'failed',
            },
            executed: false,
          });
        }
        return { success: false, reason: `预检查失败: ${blockReason}` };
      }

      // 预检查通过：补全元数据后执行
      if (signalId) {
        this._bufferSignalUpdate(signalId, {
          metadata: {
            tokenCreateTime,
            trendFactors: buildFactorValuesForTimeSeries(factorResults),
            tpaFactors: buildTpaFactorSnapshot(factorResults),
            narrativeCall: narrativeCallInfo,
            narrativeLeaderCheck: narrativeLeaderInfo,
            preBuyCheckFactors: buildPreBuyCheckFactorValues(preBuyCheckResult),
            preBuyCheckResult: {
              canBuy: true,
              reason: preBuyCheckResult.checkReason || 'passed',
            },
          },
        });
      }

      const metadata = {
        signalId,
        loopCount: this._loopCount,
        timestamp: signal.timestamp.toISOString(),
        factors: signal.factors || null,
      };
      const buyAmt = this._calculateBuyAmount(signal); // 卡牌模式下逐腿金额不同，日志用实际值
      const result = await this._executeBuy(signal, signalId, metadata, nowTs);

      if (result && result.success) {
        this._tokenPool.markAsBought(token.token, token.chain, {
          buyPrice: latestPrice,
          buyTime: nowTs,
        });
        // 虚拟时钟：冷却/次数计数都要记回放时点（挂钟会让回测冷却判据失真）
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id, nowTs);
        // P1-3：状态更新走 buffer（flush 末段按入队序重放）；buffer 关时保留直写
        if (this._writeBufferEnabled && this._writeBuffer) {
          this._writeBuffer.addTokenStatusUpdate({
            experimentId: this._experimentId, tokenAddress: token.token, status: 'bought',
          });
        } else {
          await this.dataService.updateTokenStatus(this._experimentId, token.token, 'bought');
        }

        const faState = this._factorAggregator.getTokenState(token.token);
        this._factorAggregator.setBuyState(token.token, {
          buyPriceBnb: faState?.currentPriceBnb || 0,
          buyPriceUsd: latestPrice,
          buyTime: nowTs,
        });

        this._bufferSignalUpdate(signalId, { executed: true, metadata: { execution_status: 'executed' } });
        this.metrics.executedSignals++;
        this.logger.info(this._experimentId, 'BuyEval',
          `✅ 买入成功(回放) | ${token.symbol} price=${latestPrice.toExponential(4)} amount=${buyAmt}${this._cardsEnabled ? `(${signal.cards ?? 1}卡)` : ''} 余额=${this.currentBalance.toFixed(4)}`);

        // 毕业事件先于买入的消费竞态补卖（虚拟引擎三挂点之一，盘古案 2026-09-28）：
        // graduation 事件消费时 status!=='bought' no-op，买入成功点查 FA graduated
        // 标记（或事件集合——事件先于首 tick 的边缘 markGraduated 会 no-op）直接补
        // 毕业全清。回放串行直接 await（虚拟为 fire-and-forget，效果等价）
        if (faState?.graduated || this._graduatedTokens.has(token.token)) {
          if (!this._graduationSoldTokens.has(token.token)) {
            await this._emitGraduationSell(token, {
              token: token.token, tsMs: nowTs, fundsBnb: faState?.lastFundsBnb ?? null,
            });
          }
        }
        return { success: true };
      }

      this._bufferSignalUpdate(signalId, { executed: false, metadata: { execution_status: 'failed', tradeResult: result } });
      return { success: false, reason: result?.reason || result?.message || '交易执行失败' };
    } finally {
      this._buyingTokens.delete(tokenAddress);
    }
  }

  // ==================== 卖路径（虚拟时钟版）====================

  /**
   * 引擎级止损双腿判定（与实时引擎 FourMemeWssTradingEngine._stopLossHit 逐字一致；
   * 配置 stopLoss 段启用；纯读 factors 不动状态）。返回命中描述或 null；price 先判
   * （两条同时命中时标注更深的那条，全清同效）。因子口径与策略腿同源：
   * profitPercent=相对 FA buyState 成本（%）/ holdDuration=秒。时间腿 <=0 而非 <0。
   */
  _stopLossHit(factors) {
    if (!this._stopLossEnabled) return null;
    const profit = factors.profitPercent;
    const hold = factors.holdDuration;
    if (this._stopLossPricePct != null && Number.isFinite(profit) && profit <= this._stopLossPricePct) {
      return { kind: 'price', profitPercent: profit };
    }
    if (this._stopLossTimeSec != null && Number.isFinite(hold) && hold > this._stopLossTimeSec
        && Number.isFinite(profit) && profit <= 0) {
      return { kind: 'time', profitPercent: profit, holdDuration: hold };
    }
    return null;
  }

  /**
   * 止损卖出：构造等价 strategy 走 _emitSellSignal 全清链——signals/trades/卡账本
   * （cards='all'→全清 sellPct=1）/累亏记账副作用全复用（实时引擎同款，零新执行逻辑）。
   * 回测签名差异：多 nowTs（虚拟时钟，去抖/评估路径统一传法）。
   */
  async _emitStopLossSell(token, factors, hit, nowTs, tick) {
    const common = {
      action: 'sell', sellPercentage: 1, cards: 'all', bypassDebounce: true,
      priority: 0, lockTokenAfterSell: false, maxExecutions: null, cumulativeLossLockPct: null,
    };
    const strategy = hit.kind === 'price'
      ? { id: 'stopLossPrice', name: `止损-价格跌破成本线(${this._stopLossPricePct}%)`, ...common }
      : { id: 'stopLossTime', name: `止损-持有超时仍亏损(${Math.round(this._stopLossTimeSec / 60)}min)`, ...common };
    this.logger.info(this._experimentId, 'StopLoss',
      `${token.symbol || token.token.slice(0, 10)} 触发${strategy.name}(回放) | profitPercent=${hit.profitPercent?.toFixed(1)}%` +
      `${hit.kind === 'time' ? ` holdDuration=${(hit.holdDuration / 60).toFixed(1)}min` : ''}`);
    return this._emitSellSignal(token, strategy, factors, nowTs, tick);
  }

  /**
   * 持仓止损扫描（虚拟时钟版，实时 _scanHoldingsStopLoss 的回放等价）：主循环按
   * scanIntervalMs 虚拟节流调用，断流持仓在此兜底。只判止损双腿不跑策略腿
   * （P 腿断流「不评估」语义维持）。串行逐 token await（对齐实时，避免卖出风暴）。
   * 毕业兜底不在扫描嵌（虚拟版有）：回放的毕业事件消费指针自带重试语义等价覆盖。
   */
  async _scanHoldingsStopLoss(nowTs) {
    for (const holding of this._getAllHoldings()) {
      const tokenAddress = holding.tokenAddress;
      if (!tokenAddress) continue;
      const token = this._tokenPool.getToken(tokenAddress, 'bsc');
      if (!token || token.status !== 'bought') continue;
      if (this._sellingTokens.has(tokenAddress) || this._buyingTokens.has(tokenAddress)) continue;
      const factors = this._factorAggregator.buildFactorMap(tokenAddress, nowTs);
      if (!factors) continue;
      // 周期路由同步（断流票 stale 降档；对齐实时扫描点）
      if (this._cycleEnforce) token.cycleTag = factors.tokenCycle ?? null;
      const hit = this._stopLossHit(factors);
      if (hit) {
        await this._emitStopLossSell(token, factors, hit, nowTs, null);
      }
    }
  }

  /**
   * 卖腿评估（pumpfun 回迁批 2，与实时引擎同构）：每 tick 实时评估不去抖，
   * hit 后分流——bypassDebounce/去抖关闭 → 立即卖（存量行为）；默认腿 →
   * SellConfirmDebouncer touch（首真起计不重置）；条件 false → clear。
   */
  async _evaluateSellPath(token, factors, tick) {
    const tokenAddress = token.token;
    if (token.status !== 'bought') return { success: false, reason: '非持有状态' };
    if (this._sellingTokens.has(tokenAddress)) return { success: false, reason: '卖出执行中' };

    const nowTs = tick.timestamp;
    const strategy = this._strategyEngine.evaluate(factors, tokenAddress, nowTs, token, 'sell');
    if (!strategy) {
      this._sellConfirmDebouncer.clear(tokenAddress); // 条件 false（趋势恢复）→ 取消 pending
      return { success: false, reason: '无触发卖出策略' };
    }

    if (strategy.bypassDebounce || this._sellDebounceMs <= 0) {
      this._sellConfirmDebouncer.clear(tokenAddress);
      return this._emitSellSignal(token, strategy, factors, nowTs, tick);
    }

    this._sellConfirmDebouncer.touch(tokenAddress, tick);
    return { success: false, reason: '卖出确认去抖中' };
  }

  /** 卖出去抖 fire：fireTs 虚拟时刻重读因子重评（窗口内可能已恢复/sold） */
  _onSellDebounceFire(tokenAddress, tick, fireTs) {
    const factors = this._factorAggregator.buildFactorMap(tokenAddress, fireTs);
    if (!factors) return;
    const token = this._tokenPool.getToken(tokenAddress, 'bsc');
    if (!token || token.status !== 'bought') return;
    if (this._buyingTokens.has(tokenAddress)) return; // 与卖腿路由门同口径
    // 周期路由同步（fire 时刻 buildFactorMap 已按虚拟时刻推进 latch；防 cycleTag 滞后一拍）
    if (this._cycleEnforce) token.cycleTag = factors.tokenCycle ?? null;

    const p = this._reconfirmAndSell(token, factors, fireTs)
      .catch(e => this.logger.error(this._experimentId, 'SellEval',
        `${token.symbol || tokenAddress.slice(0, 10)} 回放卖出去抖 fire 异常: ${e.message}`));
    this._inflightEvals.add(p);
    p.finally(() => this._inflightEvals.delete(p));
  }

  /** fire 重评：条件仍真才卖（恢复→不卖，等下次触发重新起算） */
  async _reconfirmAndSell(token, factors, nowTs) {
    const tokenAddress = token.token;
    if (this._sellingTokens.has(tokenAddress)) return { success: false, reason: '卖出执行中' };

    const strategy = this._strategyEngine.evaluate(factors, tokenAddress, nowTs, token, 'sell');
    if (!strategy) return { success: false, reason: '条件恢复，不卖' };

    return this._emitSellSignal(token, strategy, factors, nowTs, null);
  }

  /**
   * 构造卖出信号并执行（立即卖 / 去抖 fire 共用；从原 _evaluateSellPath 抽取）。
   * 成功后：累亏闩锁记账（盈亏同记）+ lockTokenAfterSell 止损闩锁置位。
   * @param {Object|null} tick - 触发 tick（去抖 fire 路径为 null）
   */
  async _emitSellSignal(token, strategy, factors, nowTs, tick) {
    const tokenAddress = token.token;
    if (this._sellingTokens.has(tokenAddress)) return { success: false, reason: '卖出执行中' };

    this._sellingTokens.add(tokenAddress);
    try {
      this.logger.info(this._experimentId, 'SellEval',
        `${token.symbol} 触发卖出策略(回放): ${strategy.name}${tick ? '' : '（去抖确认后）'} | ` +
        `profitPercent=${factors.profitPercent?.toFixed(1)}%`);

      const latestPrice = factors.currentPrice || 0;
      if (!(latestPrice > 0)) {
        return { success: false, reason: '无有效价格' };
      }

      const { buildFactorValuesForTimeSeries } = require('../core/FactorBuilder');
      const holding = this._getHolding(tokenAddress);
      const buyPrice = holding?.averagePurchasePrice || token.buyPrice || null;

      // 卡牌 sizing（迁自 rich-js）：机制启用 且 卖腿配 cards 且 token 有卡 → 按卡数比例
      // 卖余仓：soldN = 'all'→全清 / min(cards, 余卡)（超余卡钳制）；soldN>=tokenCards 时
      // sellPct 恒精确 1（IEEE T/T）→ Decimal.mul(1) 精确直通，PM remainingAmount.eq(0)
      // 删仓判据成立（E5d 僵尸仓教训，详见 _executeSell 注释）。不满足任一条件 → 旧
      // sellPercentage 路径（机制关闭/腿未配卡/无卡均不拦截）。cardTrade.after 为信号
      // 构造时点算好的绝对值，随 trade metadata 落库（_executeSell 成功分支写回 Map）
      let cardTrade = null;
      let sellPct = strategy.sellPercentage ?? 1;
      if (this._cardsEnabled && strategy.cards != null) {
        const tokenCards = this._tokenCards.get(tokenAddress) || 0;
        if (tokenCards > 0) {
          const soldN = strategy.cards === 'all' ? tokenCards : Math.min(strategy.cards, tokenCards);
          sellPct = soldN >= tokenCards ? 1 : soldN / tokenCards;
          cardTrade = { cards: soldN, before: tokenCards, after: tokenCards - soldN };
        }
      }

      const signal = {
        action: 'sell',
        symbol: token.symbol,
        tokenAddress: token.token,
        chain: token.chain || 'bsc',
        price: latestPrice,
        confidence: 80,
        reason: strategy.name,
        strategyId: strategy.id,
        strategyName: strategy.name,
        buyPrice,
        profitPercent: buyPrice && latestPrice ? ((latestPrice - buyPrice) / buyPrice * 100) : null,
        holdDuration: token.buyTime ? ((nowTs - token.buyTime) / 1000) : null,
        sellPercentage: sellPct, // E5：本腿卖出比例（执行时点余仓；卡牌模式=卡数比例）
        cardTrade,
        factors: { trendFactors: buildFactorValuesForTimeSeries(factors) },
        timestamp: new Date(nowTs),
      };

      let signalId = null;
      try {
        const { TradeSignal } = require('../entities');
        const tradeSignal = new TradeSignal({
          experimentId: this._experimentId,
          tokenAddress: signal.tokenAddress,
          tokenSymbol: signal.symbol,
          signalType: 'SELL',
          action: 'sell',
          confidence: signal.confidence,
          reason: signal.reason,
          chain: signal.chain,
          metadata: {
            price: signal.price,
            strategyId: signal.strategyId,
            strategyName: signal.strategyName,
            buyPrice: signal.buyPrice,
            profitPercent: signal.profitPercent,
            holdDuration: signal.holdDuration,
            ...signal.factors,
          },
          createdAt: signal.timestamp,
        });
        signalId = tradeSignal.id;
        if (this._writeBufferEnabled && this._writeBuffer) {
          this._writeBuffer.addSignalInsert(tradeSignal.toDatabaseFormat());
        } else {
          await tradeSignal.save();
        }
        this.metrics.totalSignals++;
      } catch (saveError) {
        this.logger.error(this._experimentId, 'SellEval', `信号保存失败 | ${token.symbol} ${saveError.message}`);
        return { success: false, reason: `信号保存失败: ${saveError.message}` };
      }

      const metadata = { signalId, loopCount: this._loopCount, timestamp: signal.timestamp.toISOString() };
      const result = await this._executeSell(signal, signalId, metadata, nowTs);

      if (result && result.success) {
        // 虚拟时钟：冷却判据（lastExecuted）必须记回放时点
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id, nowTs);
        this._sellConfirmDebouncer.clear(tokenAddress);

        // 累亏闩锁记账：卖出成交 → 该 token 已平仓轮 profitPercent 累计（盈亏同记）。
        // signal.profitPercent 缺失时从 token.buyPrice 现算（双缺失才跳过记账）；
        // E5 部分卖按腿折算（本腿只动了 sellPercentage 比例的仓位）
        let _pct = Number(signal.profitPercent);
        if (!Number.isFinite(_pct) && latestPrice > 0 && token.buyPrice > 0) {
          _pct = (latestPrice - token.buyPrice) / token.buyPrice * 100;
        }
        if (Number.isFinite(_pct)) {
          _pct = _pct * (signal.sellPercentage ?? 1);
          const _cum = (this._cumLossTotals.get(tokenAddress) || 0) + _pct;
          this._cumLossTotals.set(tokenAddress, _cum);
          if (this._cumLossLockPct != null && _cum <= this._cumLossLockPct) {
            this.logger.info(this._experimentId, 'cumLossLock',
              `[cumLossLock] ${token.symbol} 累计盈亏 ${_cum.toFixed(1)}% ≤ ${this._cumLossLockPct}%，该 token 禁买`);
          }
        }

        // 止损闩锁：lockTokenAfterSell 卖腿成交 → 该 token 永久禁买
        if (strategy.lockTokenAfterSell) {
          this._tokenLocks.add(tokenAddress);
          this.logger.info(this._experimentId, 'stopLossLock',
            `[stopLossLock] ${token.symbol} 止损腿[${strategy.id}]成交，该 token 禁买`);
        }

        this._bufferSignalUpdate(signalId, { executed: true, metadata: { execution_status: 'executed' } });
        this.metrics.executedSignals++;
        return { success: true };
      }
      this._bufferSignalUpdate(signalId, { executed: false, metadata: { execution_status: 'failed', tradeResult: result } });
      return { success: false, reason: result?.reason || result?.message || '卖出执行失败' };
    } finally {
      this._sellingTokens.delete(tokenAddress);
    }
  }

  // ==================== 交易执行（历史时间戳落库）====================

  async _executeBuy(signal, signalId = null, metadata = {}, timestamp = null) {
    try {
      const amountInBNB = this._calculateBuyAmount(signal);
      if (amountInBNB <= 0) {
        return { success: false, reason: '余额不足或计算金额为0' };
      }

      // 卡账本（迁自 rich-js）：机制启用时所有买入都是卡牌计价（本腿 cards ?? 1 张）。
      // after 为成交时点绝对值，先写进 trade metadata（重放/诊断），成功才落 Map
      let cardTrade = null;
      if (this._cardsEnabled) {
        const cardsN = signal.cards != null ? signal.cards : 1;
        const before = this._tokenCards.get(signal.tokenAddress) || 0;
        cardTrade = { cards: cardsN, before, after: before + cardsN };
      }

      const price = signal.price || 0;
      const tokenAmount = price > 0 ? new Decimal(amountInBNB).div(price).toNumber() : 0;

      // metadata.timestamp 驱动 Trade.createdAt（历史时间）；executedAt 为回测运行时刻
      const result = await this.executeTrade({
        tokenAddress: signal.tokenAddress,
        symbol: signal.symbol,
        direction: 'buy',
        amount: tokenAmount,
        price,
        signalId,
        metadata: {
          ...metadata,
          timestamp: timestamp !== null ? new Date(timestamp).toISOString() : undefined,
          ...(cardTrade ? { cardTrade } : {}),
        },
      });

      this.metrics.totalTrades++;
      if (result && result.success) {
        this.metrics.successfulTrades++;
        if (cardTrade) {
          this._tokenCards.set(signal.tokenAddress, cardTrade.after);
        }
        // E5 轮账本开轮：买入成功登记成本（记账货币 USD；回测 tradeAmount 即此口径）
        this._roundLedger.set(signal.tokenAddress, {
          buyUsd: amountInBNB,
          sellUsdGross: 0,
          buyTime: timestamp !== null ? timestamp : Date.now(),
          legCount: 0,
        });
      } else {
        this.metrics.failedTrades++;
        this.logger.error(this._experimentId, '_executeBuy',
          `买入失败(回放) | ${signal.symbol} reason=${result?.reason || result?.message || '未知'}`);
      }
      return result || { success: false, reason: 'executeTrade 返回空值' };
    } catch (error) {
      this.metrics.totalTrades++;
      this.metrics.failedTrades++;
      this.logger.error(this._experimentId, '_executeBuy', `异常(回放) | ${error.message}`);
      return { success: false, reason: error.message };
    }
  }

  async _executeSell(signal, signalId = null, metadata = {}, timestamp = null) {
    try {
      const holding = this._getHolding(signal.tokenAddress);
      if (!holding || holding.amount <= 0) {
        return { success: false, reason: '无持仓' };
      }
      const sellPct = (typeof signal.sellPercentage === 'number'
        && signal.sellPercentage > 0 && signal.sellPercentage <= 1) ? signal.sellPercentage : 1;
      // P-3 快照（与实时引擎同构）：PM 部分卖原地改写 holding.amount，成交后此引用即余量
      const qtyBefore = Number(holding.amount);

      // E5d 修复（精度）：amountToSell 保持 Decimal 精确值，不经 Number 往返——
      // 部分卖后 PM 余仓是 20 位精度 Decimal，Number 化可能向上失真，全清腿（sellPct=1）
      // 会以「Insufficient token balance」被 PM 拒绝（E5d BRX1600 实测：P2 每 tick 重触发
      // 40+ 次全失败、强平腿静默跳过、6140 token 成僵尸仓）。executeTrade/PM 均接受
      // Decimal 实例，currentAmount.lt(tradeAmount) 精确相等不再误抛。
      const amountToSell = new Decimal(holding.amount).mul(sellPct);
      const price = signal.price || 0;

      const result = await this.executeTrade({
        tokenAddress: signal.tokenAddress,
        symbol: signal.symbol,
        direction: 'sell',
        amount: amountToSell,
        price,
        signalId,
        metadata: {
          ...metadata,
          timestamp: timestamp !== null ? new Date(timestamp).toISOString() : undefined,
          buyPrice: signal.buyPrice,
          profitPercent: signal.profitPercent,
          holdDuration: signal.holdDuration,
          sellPercentage: sellPct,
          ...(signal.cardTrade ? { cardTrade: signal.cardTrade } : {}),
        },
      });

      this.metrics.totalTrades++;
      if (result && result.success) {
        this.metrics.successfulTrades++;
        const qtySold = amountToSell; // 虚拟成交=请求数量（Decimal，腿所得精确累计）
        const legProceedsUsd = price > 0 ? new Decimal(qtySold).mul(price).toNumber() : 0;

        // 全清判定用 PM 余仓（部分卖保持 bought，卖腿继续评估、FA 锚不清——硬底分母保住）
        const fullyClosed = (Number(this._getHolding(signal.tokenAddress)?.amount ?? 0) <= 0);

        // 卡账本写回（迁自 rich-js）：成交才扣卡（失败腿不烧卡）。配卡腿写 after 绝对值
        //（0 → 删卡）；不带 cardTrade 的腿在全清时也删卡（强平腿/sellPct=1 腿走此处，
        // 仓位清零卡随清，防重买后卡数虚高）；部分比例卖不动卡数（比例/卡数两套口径并行）
        if (signal.cardTrade) {
          if (signal.cardTrade.after > 0) {
            this._tokenCards.set(signal.tokenAddress, signal.cardTrade.after);
          } else {
            this._tokenCards.delete(signal.tokenAddress);
          }
        } else if (fullyClosed) {
          this._tokenCards.delete(signal.tokenAddress);
        }

        // E5 轮账本：每卖腿累计所得；全清时一次记整轮 pnl=Σ卖-买（含回放结束强平腿）
        const ledger = this._roundLedger.get(signal.tokenAddress)
          || { buyUsd: 0, sellUsdGross: 0, buyTime: Date.now(), legCount: 0 };
        ledger.sellUsdGross = new Decimal(ledger.sellUsdGross).plus(legProceedsUsd).toNumber();
        ledger.legCount = (ledger.legCount || 0) + 1;

        const token = this._tokenPool.getToken(signal.tokenAddress, signal.chain || 'bsc');
        if (fullyClosed) {
          if (token && token.buyTime) {
            const sellTime = timestamp !== null ? timestamp : Date.now();
            const returnRate = ledger.buyUsd > 0
              ? (ledger.sellUsdGross - ledger.buyUsd) / ledger.buyUsd * 100 : 0;
            this._tokenPool.addCompletedPair(signal.tokenAddress, signal.chain, {
              buyTime: token.buyTime,
              sellTime,
              returnRate,
              pnl: new Decimal(ledger.sellUsdGross).minus(ledger.buyUsd).toNumber(),
            });
            this.logger.info(this._experimentId, '_executeSell',
              `已完成交易对(回放，全清 ${ledger.legCount} 腿归并) | ${signal.symbol} returnRate=${returnRate.toFixed(2)}%`);
          }
          this._roundLedger.delete(signal.tokenAddress);

          this._tokenPool.markAsSold(signal.tokenAddress, signal.chain);
          // P1-3：状态更新走 buffer（flush 末段按入队序重放）；buffer 关时保留直写
          if (this._writeBufferEnabled && this._writeBuffer) {
            this._writeBuffer.addTokenStatusUpdate({
              experimentId: this._experimentId, tokenAddress: signal.tokenAddress, status: 'sold',
            });
          } else {
            await this.dataService.updateTokenStatus(this._experimentId, signal.tokenAddress, 'sold');
          }
          this._factorAggregator.clearBuyState(signal.tokenAddress, 'default');
        } else {
          this._roundLedger.set(signal.tokenAddress, ledger);
          this.logger.info(this._experimentId, '_executeSell',
            `部分卖出(回放) ${(sellPct * 100).toFixed(0)}% | ${signal.symbol} 腿所得=${legProceedsUsd.toFixed(6)} 余仓=${Number(this._getHolding(signal.tokenAddress)?.amount ?? 0).toFixed(4)}${signal.cardTrade ? ` 余卡=${signal.cardTrade.after}` : ''}`);
        }
      } else {
        this.metrics.failedTrades++;
        // E5d 修复（可观测）：卖出失败原为静默（BRX1600 强平腿跳过即由此漏诊）
        this.logger.error(this._experimentId, '_executeSell',
          `卖出失败(回放) | ${signal.symbol} reason=${result?.reason || result?.message || '未知'}`);
      }
      return result;
    } catch (error) {
      this.metrics.totalTrades++;
      this.metrics.failedTrades++;
      this.logger.error(this._experimentId, '_executeSell', `异常(回放) | ${signal.symbol} ${error.message}`);
      return { success: false, reason: error.message };
    }
  }

  _calculateBuyAmount(signal) {
    // 卡牌模式（迁自 rich-js）：金额 = perCardBNB × 本腿张数（cards ?? 1）；
    // 现金不足返 0=买失败，不降张（rich-js 原味语义）
    if (this._cardsEnabled) {
      const amt = new Decimal(this._perCardBNB).mul(signal.cards != null ? signal.cards : 1).toNumber();
      return this.currentBalance >= amt ? amt : 0;
    }
    if (this.currentBalance < this._tradeAmount) {
      return 0;
    }
    return this._tradeAmount;
  }

  /** 当前可用余额 */
  get currentBalance() {
    try {
      const portfolio = this._portfolioManager?.getPortfolio(this._portfolioId);
      if (portfolio) {
        const cashBalance = portfolio.cashBalance;
        return typeof cashBalance === 'number' ? cashBalance : cashBalance?.toNumber?.() ?? this.initialBalance;
      }
    } catch {}
    return this.initialBalance;
  }

  // ==================== 回放收尾 ====================

  /**
   * 回放结束强平所有持仓（沿用旧回测语义）：按 FA 最后价全额卖出，
   * 信号/交易落库（时间=最后一笔 tick），保证组合终值可核算。
   */
  async _forceSellAllRemaining() {
    const holdings = this._getAllHoldings();
    if (!holdings || holdings.length === 0) return;

    const lastTs = this._ticks[this._ticks.length - 1]?.timestamp || Date.now();
    this.logger.info(this._experimentId, 'BacktestEngine', `回放结束，强平 ${holdings.length} 个持仓`);

    const { buildFactorValuesForTimeSeries } = require('../core/FactorBuilder');
    for (const holding of holdings) {
      const tokenAddress = holding.tokenAddress;
      const token = this._tokenPool.getToken(tokenAddress, 'bsc');
      const factors = this._factorAggregator.buildFactorMap(tokenAddress, lastTs);
      const price = factors?.currentPrice || 0;
      if (!(price > 0)) {
        this.logger.warn(this._experimentId, 'BacktestEngine',
          `强平跳过（无价格）| ${token?.symbol || tokenAddress}`);
        continue;
      }

      const buyPrice = holding.averagePurchasePrice || token?.buyPrice || null;
      const signal = {
        action: 'sell',
        // tokenPool 的 symbol 来自 wss_events payload（权威）；holding.tokenSymbol 是
        // PM getTokenSymbol 的降级值（targetTokens 未配置时恒为地址前 8 位+'...'）
        symbol: token?.symbol || holding.tokenSymbol || '',
        tokenAddress,
        chain: 'bsc',
        price,
        confidence: 80,
        reason: '回放结束强平',
        strategyId: 'force_sell',
        strategyName: '回放结束强平',
        buyPrice,
        profitPercent: buyPrice && price ? ((price - buyPrice) / buyPrice * 100) : null,
        holdDuration: token?.buyTime ? ((lastTs - token.buyTime) / 1000) : null,
        sellPercentage: 1, // E5：强平腿=余仓全清（冻结估值口径，analyze 分列）
        factors: factors ? { trendFactors: buildFactorValuesForTimeSeries(factors) } : {},
        timestamp: new Date(lastTs),
      };

      let signalId = null;
      try {
        const { TradeSignal } = require('../entities');
        const tradeSignal = new TradeSignal({
          experimentId: this._experimentId,
          tokenAddress,
          tokenSymbol: signal.symbol,
          signalType: 'SELL',
          action: 'sell',
          confidence: 80,
          reason: signal.reason,
          chain: 'bsc',
          metadata: { price, reason: signal.reason, strategyId: signal.strategyId, strategyName: signal.strategyName, ...signal.factors },
          createdAt: signal.timestamp,
        });
        signalId = tradeSignal.id;
        if (this._writeBufferEnabled && this._writeBuffer) {
          this._writeBuffer.addSignalInsert(tradeSignal.toDatabaseFormat());
        } else {
          await tradeSignal.save();
        }
        this.metrics.totalSignals++;
      } catch (e) {
        this.logger.error(this._experimentId, 'BacktestEngine', `强平信号保存失败 | ${tokenAddress} ${e.message}`);
        continue;
      }

      const result = await this._executeSell(signal, signalId, { signalId, timestamp: signal.timestamp.toISOString() }, lastTs);
      if (result && result.success) {
        this._bufferSignalUpdate(signalId, { executed: true, metadata: { execution_status: 'executed' } });
        this.metrics.executedSignals++;
      }
    }
  }

  // ==================== 快照与交易落库（writeBuffer + 虚拟时间重写）====================

  /**
   * 创建投资组合快照（重写基类：snapshot_time 用回放虚拟时刻，走 writeBuffer 批量）。
   * @param {number} [virtualTs] - 虚拟时刻（ms）；缺省退回当前真实时间（不应发生）
   */
  async _createPortfolioSnapshot(virtualTs) {
    const portfolio = this._portfolioManager?.getPortfolio(this._portfolioId);
    if (!portfolio) {
      return;
    }
    const snapshotTime = new Date(virtualTs ?? Date.now()).toISOString();

    const snapshot = {
      experiment_id: this._experimentId,
      snapshot_time: snapshotTime,
      total_value: String(portfolio.totalValue || 0),
      total_value_change: '0',
      total_value_change_percent: '0',
      cash_balance: String(portfolio.cashBalance || portfolio.availableBalance || 0),
      cash_native_balance: String(portfolio.cashBalance || portfolio.availableBalance || 0),
      total_portfolio_value_native: String(portfolio.totalValue || 0),
      token_positions: '[]',
      positions_count: portfolio.positions ? portfolio.positions.size : 0,
      metadata: JSON.stringify({
        loop_count: this._loopCount,
        availableBalance: String(portfolio.availableBalance || 0),
        totalInvested: String(portfolio.totalInvested || 0),
        totalPnL: String(portfolio.totalPnL || 0),
        timestamp: snapshotTime,
      }),
    };

    if (this._writeBufferEnabled && this._writeBuffer) {
      this._writeBuffer.addSnapshotInsert(snapshot);
    } else {
      // 缓冲关闭（仅调试用）：直写（时间用真实时钟，与基类一致）
      await super._createPortfolioSnapshot();
    }
  }

  /**
   * 执行交易（重写基类：成功后 writeBuffer.addTradeInsert 批量落库，
   * 替代逐条 trade.save()）。Trade.createdAt 经 metadata.timestamp 取回放历史时间。
   */
  async executeTrade(tradeRequest) {
    const { Trade } = require('../entities');

    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    if (!portfolio) {
      throw new Error('投资组合不存在');
    }

    const position = portfolio.positions.get(tradeRequest.tokenAddress.toLowerCase());
    const currentPrice = tradeRequest.price || (position ? position.currentPrice : 0);

    const isBuy = tradeRequest.direction.toLowerCase() === 'buy';
    // amount 可为 Decimal 实例（E5 卖腿精确链）；String() 得精确数字串，parseFloat 仅用于
    // inputAmount/outputAmount 成交记录（double 精度足够，无比较语义）
    const tokenAmount = parseFloat(String(tradeRequest.amount));
    const price = parseFloat(currentPrice);
    const inputAmount = isBuy ? (tokenAmount * price) : tokenAmount;
    const outputAmount = isBuy ? tokenAmount : (tokenAmount * price);

    const trade = new Trade({
      experimentId: this._experimentId,
      signalId: tradeRequest.signalId || null,
      tokenAddress: tradeRequest.tokenAddress,
      tokenSymbol: tradeRequest.symbol,
      direction: tradeRequest.direction.toLowerCase(),
      inputCurrency: isBuy ? 'BNB' : tradeRequest.symbol,
      outputCurrency: isBuy ? tradeRequest.symbol : 'BNB',
      inputAmount: String(inputAmount),
      outputAmount: String(outputAmount),
      unitPrice: String(price),
      txHash: tradeRequest.txHash || null,
      metadata: tradeRequest.metadata || {},
    });

    let result;
    try {
      result = await this._portfolioManager.executeTrade(
        this._portfolioId,
        tradeRequest.tokenAddress,
        tradeRequest.direction.toLowerCase(),
        tradeRequest.amount,
        currentPrice,
      );
    } catch (pmError) {
      // E5d 修复（可观测）：PM 异常原为静默 return（Insufficient 被吞导致漏诊）
      this.logger.error(this._experimentId, 'executeTrade',
        `PM 交易异常(回放) | ${tradeRequest.symbol} ${tradeRequest.direction} ${pmError.message}`);
      trade.markAsFailed(pmError.message || '交易执行异常');
      return {
        success: false,
        message: pmError.message || '交易执行异常',
        reason: pmError.message || '交易执行异常',
        error: pmError.message || '交易执行异常',
      };
    }

    if (!result) {
      return {
        success: false,
        message: 'PortfolioManager.executeTrade 返回空值',
        reason: 'PortfolioManager.executeTrade 返回空值',
      };
    }

    if (result.success) {
      trade.markAsSuccess();

      if (this._writeBufferEnabled && this._writeBuffer) {
        this._writeBuffer.addTradeInsert(trade.toDatabaseFormat());
      } else {
        await trade.save();
      }

      return { success: true, tradeId: trade.id, trade, portfolio: result.portfolio };
    }

    const failureReason = result.message || result.reason || result.error || '未知失败原因';
    trade.markAsFailed(failureReason);
    return { success: false, message: failureReason, reason: failureReason, error: failureReason };
  }

  // ==================== 辅助 ====================

  /** 信号增量更新（走 writeBuffer 批量或直写） */
  _bufferSignalUpdate(signalId, updateData) {
    if (!signalId) return;
    if (this._writeBufferEnabled && this._writeBuffer) {
      this._writeBuffer.addSignalUpdate(signalId, updateData);
    }
    // writeBuffer 关闭时信号已即时落库，此处无直写路径（与旧回测一致：缓冲关闭仅调试用）
  }

  /** 永久阻断条件评估（扁平标量上下文上的 JS 表达式，AND/OR/NOT 语法糖） */
  _evaluatePermanentBlock(preBuyCheckResult, condition) {
    if (!condition || String(condition).trim() === '') {
      return { blocked: false, reason: '' };
    }
    try {
      const context = {};
      for (const [key, value] of Object.entries(preBuyCheckResult)) {
        if (typeof value !== 'object' && typeof value !== 'function') {
          context[key] = value;
        }
      }
      const jsExpr = String(condition)
        .replace(/\bAND\b/gi, '&&')
        .replace(/\bOR\b/gi, '||')
        .replace(/\bNOT\b/gi, '!');
      const keys = Object.keys(context);
      const values = Object.values(context);
      const fn = new Function(...keys, `return ${jsExpr};`);
      const blocked = fn(...values);
      return blocked
        ? { blocked: true, reason: `永久阻断: ${condition}` }
        : { blocked: false, reason: '' };
    } catch (error) {
      this.logger.error(this._experimentId, '_evaluatePermanentBlock', `条件评估失败: ${error.message}`);
      return { blocked: false, reason: '' };
    }
  }

  getStats() {
    return {
      engine: { id: this._id, mode: this._mode, status: this._status, loopCount: this._loopCount },
      metrics: { ...this.metrics },
      replay: {
        sourceExperimentId: this._sourceExperimentId,
        totalTicks: this._ticks.length,
        tokenCount: this._seenTokens.size,
        debouncePending: this._buyDebouncer ? this._buyDebouncer.size : 0,
        sellDebouncePending: this._sellConfirmDebouncer ? this._sellConfirmDebouncer.size : 0,
      },
      tokenPool: this._tokenPool ? this._tokenPool.getStats() : null,
      balance: this.currentBalance,
    };
  }
}

module.exports = { BacktestEngine, compareByChainOrder };
