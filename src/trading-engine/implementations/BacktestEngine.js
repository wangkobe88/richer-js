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
 *   - 叙事分析轮询删除（实时引擎已恒 rating=9，回放同口径）
 */

const { TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { AbstractTradingEngine } = require('../core/AbstractTradingEngine');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const Logger = require('../../services/logger');
const Decimal = require('decimal.js');

const baseConfig = require('../../../config/default.json');

const TICK_PAGE_SIZE = 2000;      // wss_price_ticks 分页读取页大小
const MAX_TICK_PAGES = 500;       // 分页保护上限（100 万 tick）
const SNAPSHOT_INTERVAL_MS = 30 * 1000; // 组合快照虚拟时间桶（对齐实时引擎 30s）

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
    this._lastSnapshotTs = null;        // 上一个组合快照的虚拟时刻
    this._inflightBuyEvals = new Set(); // 回放中 fire-and-forget 的买评估 promise（drain 用）
    this._finalStatusSet = false;       // 回放终态已写（stop 保护用）

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
    const FourMemeFactorAggregator = require('../../services/FourMemeFactorAggregator');
    const wsConfig = {
      ...(baseConfig.fourmemeWs || {}),
      ...(this._experiment?.config?.fourmemeWs || {}),
    };
    this._factorAggregator = new FourMemeFactorAggregator({ fourmemeWs: wsConfig }, this.logger);

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
          enabled: true,
        });
      });
    }
    this._strategyEngine.loadStrategies(strategyArray, availableFactorIds);
    this.logger.info(this._experimentId, 'BacktestEngine',
      `✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 5. 购买前检查服务（与实时引擎同源构建）
    const { PreBuyCheckService } = require('../pre-check/PreBuyCheckService');
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();
    const preBuyCheckConfig = {
      ...baseConfig.preBuyCheck,
      ...(this._experiment?.config?.preBuyCheck || {}),
    };
    this._preBuyCheckService = new PreBuyCheckService(supabase, this.logger, preBuyCheckConfig);
    await this._preBuyCheckService.initialize('bsc');
    this.logger.info(this._experimentId, 'BacktestEngine',
      `✅ 购买前检查服务初始化完成 (earlyParticipantFilterEnabled=${preBuyCheckConfig.earlyParticipantFilterEnabled})`);

    // 6. 交易金额 / 永久阻断
    const experimentConfig = this._experiment?.config || {};
    this._tradeAmount = experimentConfig.tradeAmount || 0.1;
    this._permanentBlockCondition = experimentConfig.strategiesConfig?.permanentBlockCondition || null;

    // 7. 批量写入缓冲区
    const { BacktestWriteBuffer } = require('../backtest/BacktestWriteBuffer');
    this._writeBuffer = new BacktestWriteBuffer(supabase, this.logger);
    this._writeBufferEnabled = experimentConfig.backtest?.writeBufferEnabled !== false;

    // 8. 买评估去抖（虚拟时钟模式：回放循环每 tick 前 advance 推进）
    const { TickDebouncer } = require('../core/TickDebouncer');
    this._buyDebouncer = new TickDebouncer({
      debounceMs: wsConfig.signalDebounceMs ?? 1500,
      maxWaitMs: wsConfig.signalDebounceMaxWaitMs ?? 5000,
      mode: 'virtual',
      onFire: (tokenAddress, tick, fireTs) => this._runBuyEvaluation(tokenAddress, tick, fireTs),
    });
    this.logger.info(this._experimentId, 'BacktestEngine',
      `交易金额配置 | tradeAmount=${this._tradeAmount}，debounce=${wsConfig.signalDebounceMs ?? 1500}ms`);

    // 9. 加载回放数据
    await this._loadTokenMetadata();
    await this._loadWssTicks();
    this.logger.info(this._experimentId, 'BacktestEngine',
      `📊 回放数据就绪: ${this._ticks.length} 笔 tick，${this._tokenMeta.size} 个代币元数据`);
  }

  /** 源实验 experiment_tokens → 代币元数据（FA registerToken / 落库 / totalSupply 用） */
  async _loadTokenMetadata() {
    const supabase = this._getClient();
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('experiment_tokens')
        .select('token_address, token_symbol, created_at, raw_api_data, creator_address')
        .eq('experiment_id', this._sourceExperimentId)
        .order('created_at', { ascending: true })
        .range(from, from + TICK_PAGE_SIZE - 1);
      if (error) throw new Error(`读取源实验代币元数据失败: ${error.message}`);
      for (const row of data || []) {
        this._tokenMeta.set(row.token_address, {
          symbol: row.token_symbol || '',
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

  /** 源实验 wss_price_ticks 按 id 升序分页读入（内存过滤时间窗） */
  async _loadWssTicks() {
    const supabase = this._getClient();
    let from = 0;
    let query = supabase
      .from('wss_price_ticks')
      .select('id, token_address, trade_type, trader_address, price_bnb, price_usd, bnb_amount, token_amount, block_number, block_time, tx_hash, log_index, price_outlier')
      .eq('experiment_id', this._sourceExperimentId)
      .order('id', { ascending: true });
    for (let page = 0; page < MAX_TICK_PAGES; page++) {
      const { data, error } = await query.range(from, from + TICK_PAGE_SIZE - 1);
      if (error) throw new Error(`读取 wss_price_ticks 失败: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data) {
        const ts = new Date(row.block_time).getTime();
        if (this._startTimeFilter && ts < this._startTimeFilter) continue;
        if (this._endTimeFilter && ts > this._endTimeFilter) continue;
        this._ticks.push({
          token_address: row.token_address,
          trade_type: row.trade_type,
          trader_address: row.trader_address,
          price_bnb: Number(row.price_bnb),
          price_usd: row.price_usd === null ? null : Number(row.price_usd),
          bnb_amount: Number(row.bnb_amount || 0),
          token_amount: Number(row.token_amount || 0),
          block_number: row.block_number,
          timestamp: ts,
          tx_hash: row.tx_hash,
          log_index: row.log_index,
          price_outlier: row.price_outlier || false,
        });
      }
      this.metrics.processedDataPoints += data.length;
      if (data.length < TICK_PAGE_SIZE) break;
      from += TICK_PAGE_SIZE;
    }
    // wss_price_ticks 表无 offers/funds_bnb 列：FA 仅在 tick.funds_bnb > 0 时更新
    // lastFundsBnb（回放恒保持 0），tvl 因子因此恒 0——策略 condition 引用 tvl 时需知情
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

        const token = this._tokenPool.getToken(tick.token_address, 'bsc');
        if (!token) continue;

        // 分腿路由（与实时引擎 _onFactorsUpdated 同构）
        if (token.status === 'bought' && !this._buyingTokens.has(tick.token_address)) {
          await this._evaluateSellPath(token, factors, tick);
        } else if (!this._buyingTokens.has(tick.token_address) && token.status !== 'bought') {
          if (this._buyDebouncer.pending.has(tick.token_address)) this.metrics.debounceSuppressed++;
          this._buyDebouncer.touch(tick.token_address, tick);
        }

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

      // 冲刷残留的 pending 买评估（burst 尾部）并 drain
      await this._advanceDebouncer((this._ticks[this._ticks.length - 1]?.timestamp || Date.now()) + 10 * 60 * 1000);

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
        `（成功 ${this.metrics.successfulTrades} 失败 ${this.metrics.failedTrades}）| debounceFired=${this.metrics.debounceFired}`);

      completedSuccessfully = true;
    } catch (error) {
      this.logger.error(this._experimentId, 'BacktestEngine', `❌ 回放执行失败: ${error.message}`);
      this.logger.error(this._experimentId, 'BacktestEngine', 'Stack trace', { stack: error.stack });
    } finally {
      const finalStatus = completedSuccessfully ? 'completed' : 'failed';
      try {
        await this._updateExperimentStatus(finalStatus);
        this._finalStatusSet = true;
        this.logger.info(this._experimentId, 'BacktestEngine', `📊 实验终态: ${finalStatus}`);
      } catch (updateError) {
        this.logger.error(this._experimentId, 'BacktestEngine', `更新实验状态失败: ${updateError.message}`);
      }
    }
  }

  async _syncHoldings() {
    // 回测持仓由 PortfolioManager 在回放中记账，无需外部同步
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
   * 虚拟时钟推进 + drain：advance 同步触发 onFire → _runBuyEvaluation
   * （async fire-and-forget，与实时引擎同构）；回放串行语义要求买评估在
   * 下一笔 tick 前完成（含预检查网络调用），drain 后再继续。
   */
  async _advanceDebouncer(tickTs) {
    this._buyDebouncer.advance(tickTs);
    if (this._inflightBuyEvals.size > 0) {
      await Promise.all([...this._inflightBuyEvals]);
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
    });
    this._tokenPool.addToken({
      token: tokenAddress,
      chain: 'bsc',
      platform: 'fourmeme',
      data_source: 'wss',
      name: meta.name || meta.symbol || '',
      symbol: meta.symbol || '',
      created_at: createdAtSec,
      current_price_usd: null,
      creator_address: meta.creator || null,
    });

    try {
      await this.dataService.saveToken(this._experimentId, {
        token: tokenAddress,
        symbol: meta.symbol || '',
        chain: 'bsc',
        platform: 'fourmeme',
        data_source: 'wss',
        created_at: createdAtSec,
        raw_api_data: { source: 'wss_tick_replay', totalSupply: meta.totalSupply || 0, creator: meta.creator },
        creator_address: meta.creator || null,
        status: 'monitoring',
      });
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
    if (this._buyingTokens.has(tokenAddress)) return Promise.resolve();
    if (token.status === 'bought') return Promise.resolve();
    if (this._tokenBlacklist.has(tokenAddress)) return Promise.resolve();

    const p = this._evaluateBuyPath(token, factors, tick, fireTs)
      .catch(e => this.logger.error(this._experimentId, 'BuyEval',
        `${token.symbol || tokenAddress.slice(0, 10)} 回放买腿评估异常: ${e.message}`));
    // 收集 inflight promise：回放主循环 drain 后才推进下一笔 tick / 强平
    this._inflightBuyEvals.add(p);
    p.finally(() => this._inflightBuyEvals.delete(p));
    return p;
  }

  async _evaluateBuyPath(token, factorResults, tick, fireTs) {
    const tokenAddress = token.token;
    const { buildFactorValuesForTimeSeries, buildPreBuyCheckFactorValues } = require('../core/FactorBuilder');
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

      if (preCheckPassed && shouldPerformPreCheck && this._preBuyCheckService) {
        try {
          const tokenInfo = {
            address: token.token,
            symbol: token.symbol,
            chain: 'bsc',
            platform: 'fourmeme',
            launchAt: token.createdAt || null,
            innerPair: `${token.token}_fo`,
          };
          let preBuyCheckCondition = currentRound === 0
            ? strategy.preBuyCheckCondition
            : strategy.repeatBuyCheckCondition;
          preBuyCheckCondition = String(preBuyCheckCondition).trim();

          const lastPairReturnRate = this._tokenPool.getLastPairReturnRate(token.token, token.chain || 'bsc');
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
              narrativeRating: 9,
              tweetAuthorType: factorResults.tweetAuthorType ?? 0,
              dataCollectionRound: factorResults.dataCollectionRound ?? 0,
              totalSupply,
            },
          );

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
      const result = await this._executeBuy(signal, signalId, metadata, nowTs);

      if (result && result.success) {
        this._tokenPool.markAsBought(token.token, token.chain, {
          buyPrice: latestPrice,
          buyTime: nowTs,
        });
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);
        await this.dataService.updateTokenStatus(this._experimentId, token.token, 'bought');

        const faState = this._factorAggregator.getTokenState(token.token);
        this._factorAggregator.setBuyState(token.token, {
          buyPriceBnb: faState?.currentPriceBnb || 0,
          buyPriceUsd: latestPrice,
          buyTime: nowTs,
        });

        this._bufferSignalUpdate(signalId, { executed: true, metadata: { execution_status: 'executed' } });
        this.metrics.executedSignals++;
        this.logger.info(this._experimentId, 'BuyEval',
          `✅ 买入成功(回放) | ${token.symbol} price=${latestPrice.toExponential(4)} amount=${this._tradeAmount} 余额=${this.currentBalance.toFixed(4)}`);
        return { success: true };
      }

      this._bufferSignalUpdate(signalId, { executed: false, metadata: { execution_status: 'failed', tradeResult: result } });
      return { success: false, reason: result?.reason || result?.message || '交易执行失败' };
    } finally {
      this._buyingTokens.delete(tokenAddress);
    }
  }

  // ==================== 卖路径（虚拟时钟版）====================

  async _evaluateSellPath(token, factors, tick) {
    const tokenAddress = token.token;
    if (token.status !== 'bought') return { success: false, reason: '非持有状态' };
    if (this._sellingTokens.has(tokenAddress)) return { success: false, reason: '卖出执行中' };

    const nowTs = tick.timestamp;
    this._sellingTokens.add(tokenAddress);
    try {
      const strategy = this._strategyEngine.evaluate(factors, tokenAddress, nowTs, token, 'sell');
      if (!strategy) {
        return { success: false, reason: '无触发卖出策略' };
      }

      this.logger.info(this._experimentId, 'SellEval',
        `${token.symbol} 触发卖出策略(回放): ${strategy.name} | profitPercent=${factors.profitPercent?.toFixed(1)}%`);

      const latestPrice = factors.currentPrice || 0;
      if (!(latestPrice > 0)) {
        return { success: false, reason: '无有效价格' };
      }

      const { buildFactorValuesForTimeSeries } = require('../core/FactorBuilder');
      const holding = this._getHolding(tokenAddress);
      const buyPrice = holding?.averagePurchasePrice || token.buyPrice || null;

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
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);
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
        metadata: { ...metadata, timestamp: timestamp !== null ? new Date(timestamp).toISOString() : undefined },
      });

      this.metrics.totalTrades++;
      if (result && result.success) {
        this.metrics.successfulTrades++;
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

      const amountToSell = holding.amount;
      const price = signal.price || 0;
      const amountOutBNB = price > 0 ? new Decimal(amountToSell).mul(price).toNumber() : 0;

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
        },
      });

      this.metrics.totalTrades++;
      if (result && result.success) {
        this.metrics.successfulTrades++;
        const token = this._tokenPool.getToken(signal.tokenAddress, signal.chain || 'bsc');
        if (token && token.buyTime && token.buyPrice) {
          const sellTime = timestamp !== null ? timestamp : Date.now();
          const buyPrice = token.buyPrice;
          const returnRate = buyPrice > 0 ? ((price - buyPrice) / buyPrice * 100) : 0;
          const pnl = amountOutBNB - (amountOutBNB / (1 + returnRate / 100));
          this._tokenPool.addCompletedPair(signal.tokenAddress, signal.chain, {
            buyTime: token.buyTime,
            sellTime,
            returnRate,
            pnl,
          });
        }
        this._tokenPool.markAsSold(signal.tokenAddress, signal.chain);
        await this.dataService.updateTokenStatus(this._experimentId, signal.tokenAddress, 'sold');
        this._factorAggregator.clearBuyState(signal.tokenAddress, 'default');
      } else {
        this.metrics.failedTrades++;
      }
      return result;
    } catch (error) {
      this.metrics.totalTrades++;
      this.metrics.failedTrades++;
      return { success: false, reason: error.message };
    }
  }

  _calculateBuyAmount(signal) {
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
        symbol: holding.tokenSymbol || token?.symbol || '',
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
          metadata: { price, reason: signal.reason, ...signal.factors },
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
    const tokenAmount = parseFloat(tradeRequest.amount);
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
      },
      tokenPool: this._tokenPool ? this._tokenPool.getStats() : null,
      balance: this.currentBalance,
    };
  }
}

module.exports = { BacktestEngine };
