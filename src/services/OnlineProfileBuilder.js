/**
 * OnlineProfileBuilder — BSC 在线引擎 Token Profile 构建器
 * （pumpfun src/services/OnlineProfileBuilder.js 的回迁批 3.1 移植）
 *
 * 嵌入 FourMemeWssTradingEngine（_onFactorsUpdated tick 入口 + 60s 定时扫描），
 * 交易活跃度下降时触发代币分类，写 token_profiles 表（source='online'）。
 *
 * 触发条件（tick 入口 checkAndEnqueue，任一满足，仅在 token 有新 tick 时检查）：
 * 1. idleThresholdSeconds(默认 60s)：当前 tick 距上一 tick 的间隔超时（"idle 后又来一个迟到 tick"）
 * 2. bigTickIdleSeconds(默认 600s)：距最近大额(≥bigTickBnb) tick 断流超时
 *
 * ⚠️ tick 入口只在 token 有新 tick 时被调，"短命暴发后死亡、零迟到 tick"的 token 永不触发
 * （richer-js FA 发射的 factors.idleSecSinceLastTick 在发射时刻恒 0——processTick 先置
 * lastTickAt 后建因子表，无母版 factors.timeSinceLastTrade 对应键）。这类 token 由
 * _scanIdleTokens 定时扫描补救（用 now-lastTickAt 判真实 idle）。
 *
 * 分类阈值判定委托 scripts/shared/token-classifier.js classifyFromMetrics（与离线
 * classifyToken 共用的单一真相）；metrics 从 FA state 标量构造（全史存活，不受
 * _clsTicks 窗口裁剪影响），闪崩/暴力 block 从 state._clsTicks 检测（peak 保留窗
 * 保证 peak→crash 路径完整）。
 *
 * 与母版的已裁定偏离（其余逐字对齐）：
 * 1. metrics 直接读 FA state（getTokenState），不经 factors 快照（见上 ⚠️）；
 *    inter-tick gap 从 _clsTicks 末两条取（= 当前 tick 距上一 tick，与母版
 *    factors.timeSinceLastTrade 同语义）。
 * 2. maxMarketCap = _relHighestPriceUsd × totalSupply（TokenCreate 发行量；≤0 → 0 →
 *    low_quality 保守方向），非母版常数 1.073B reserves。
 * 3. DB 写独立表 token_profiles（token_address 全局 PK upsert），非母版
 *    pumpfun_tokens.token_profile 列更新——不挂实验维度，防实验级联删 + 独立防前视
 *    生命周期；无"token 行存在"前置查询。
 * 4. 不迁：creator 画像段（母版 _updateCreatorProfile——CREATOR_PROFILE_ENABLED 本就
 *    false，richer-js 有 Q 组 creator 前作因子）、onProfileClassified 回调（TPA 暂缓）。
 * 5. violent_crash_blocks 在线即算（母版 online 留 [] 由 daily 补——BSC 无 daily 管线，
 *    与 maxBlockDropPct 共用 _computeBlockDrops 零额外成本）。
 * 6. 两入口均不需 buildFactorMap（母版扫描须 skipPreFilter 绕过 preFilter 停摆根因——
 *    richer-js FA 无 preFilter 装置，且本类不依赖 factors）。
 * 7. category_visible_at 在线路径=写入时刻（诚实口径；离线 daily 才有 computeFirstIdleVisibleAt
 *    提前口径，重写时保最早——见 token-classifier.js）。
 *
 * BacktestEngine 不嵌入（回测无写表副作用，批 3.1 既定边界）。
 */

const {
  DEFAULT_SCORING_PARAMS, MIN_TICKS,
} = require('../../scripts/shared/classifier-constants');
const {
  CLASSIFIER_VERSION, findFlashCrashPeriod, classifyFromMetrics,
  computeMaxBlockDropPct, computeViolentCrashBlocks,
} = require('../../scripts/shared/token-classifier');

// 简易 logger（引擎传入或 console 兜底）
let _logger = null;
function log(level, msg, data) {
  const prefix = '[OnlineProfileBuilder]';
  if (_logger) {
    _logger[level](`${prefix} ${msg}`, data);
  } else {
    console.log(`${prefix} [${level}] ${msg}`, data || '');
  }
}

class OnlineProfileBuilder {
  /**
   * @param {Object} [config] config.fourmemeWs.onlineProfile 段
   * @param {boolean} [config.enabled=false] 是否启用
   * @param {number} [config.minTicks] 最少 tick 数才触发分类（默认 MIN_TICKS=10，与离线一致）
   * @param {number} [config.minAgeSeconds=10] 最少存活时间（秒，createdAtMs 锚）
   * @param {number} [config.idleThresholdSeconds=60] 空闲阈值（秒）——只决定触发时机，
   *   真正 idle 的 token metrics 已定型，60s 与 300s 分类一致（母版 300 样本验证 60s 误判率 1.7%）
   * @param {number} [config.bigTickIdleSeconds=600] 大额 tick 断流阈值（秒，同向推迟分类）
   * @param {number} [config.pumpDumpPeakSeconds] pump_dump peak 时间窗（默认 DEFAULT_SCORING_PARAMS）
   * @param {number} [config.pumpDumpDrawdownPct] pump_dump 回撤阈值（默认 DEFAULT_SCORING_PARAMS）
   * @param {boolean} [config.scanEnabled=true] 定时扫描补救开关
   * @param {number} [config.scanIntervalSeconds=60] 扫描间隔（秒）
   * @param {Object} [logger]
   */
  constructor(config = {}, logger = null) {
    this._enabled = config.enabled ?? false;
    this._minTicks = config.minTicks || MIN_TICKS;
    this._minAgeSeconds = config.minAgeSeconds || 10;
    this._idleThresholdSeconds = config.idleThresholdSeconds || 60;
    this._bigTickIdleSeconds = config.bigTickIdleSeconds || 600;
    this._pumpDumpPeakSeconds = config.pumpDumpPeakSeconds || DEFAULT_SCORING_PARAMS.pumpDumpPeakSeconds;
    this._pumpDumpDrawdownPct = config.pumpDumpDrawdownPct || DEFAULT_SCORING_PARAMS.pumpDumpDrawdownPct;

    this._profiled = new Set();   // 已分类 token 地址（本进程生命周期内一次）

    // 定时扫描（补救死后零 tick 的漏分类 token）：扫描用 now-lastTickAt 判真实 idle
    this._scanEnabled = config.scanEnabled ?? true;
    this._scanIntervalSeconds = config.scanIntervalSeconds ?? 60;
    this._factorAggregator = null;   // start() 注入（遍历 tracked tokens + 读 state）
    this._scanInterval = null;

    _logger = logger;
  }

  /**
   * 检查是否应触发分类，满足条件则入队异步处理。
   * 由 FourMemeWssTradingEngine._onFactorsUpdated() 调用（每 factorsUpdated 事件）。
   * @param {string} tokenAddress
   * @param {Object} tokenState FA token state（getTokenState；_clsTicks/标量全在此）
   * @param {number} now 当前 tick 时间戳（ms）
   */
  checkAndEnqueue(tokenAddress, tokenState, now) {
    if (!this._enabled) return;
    if (!tokenState) return;

    // 已分类过，跳过
    if (this._profiled.has(tokenAddress)) return;

    if ((tokenState.tradeCount || 0) < this._minTicks) return;

    // 年龄门（createdAtMs 锚 = richer-js age 契约；母版 factors.ageSeconds 同位置门）
    const ageSeconds = tokenState.createdAtMs ? (now - tokenState.createdAtMs) / 1000 : 0;
    if (ageSeconds < this._minAgeSeconds) return;

    // 触发条件 1：idleThresholdSeconds 无任何 tick。
    // inter-tick gap 从 _clsTicks 末两条取（push 先于 lastTickAt 更新 → 末条=当前 tick），
    // = 母版 factors.timeSinceLastTrade（processTick 末算的当前 tick 距上一 tick 间隔）。
    const ticks = tokenState._clsTicks || [];
    const gapSeconds = ticks.length >= 2
      ? (ticks[ticks.length - 1].ts - ticks[ticks.length - 2].ts) / 1000
      : 0;
    const idleTriggered = gapSeconds > this._idleThresholdSeconds;

    // 触发条件 2：bigTickIdleSeconds 无大额(≥clsBigTickBnb) tick（FA 维护 _lastBigTickAt 标量，
    // 替代母版 recentTicks 反向扫描）
    const lastBigTickAt = tokenState._lastBigTickAt;
    const bigTickIdle = lastBigTickAt !== null && lastBigTickAt > 0
      && (now - lastBigTickAt) / 1000 > this._bigTickIdleSeconds;

    if (!idleTriggered && !bigTickIdle) return;

    const reason = idleTriggered
      ? `idle: ${gapSeconds.toFixed(1)}s > ${this._idleThresholdSeconds}s`
      : `big_tick_idle: ${((now - lastBigTickAt) / 1000).toFixed(1)}s > ${this._bigTickIdleSeconds}s`;
    this._enqueueClassification(tokenAddress, tokenState, reason);
  }

  /**
   * 分类核心（tick 入口与扫描入口共用）：标记 _profiled + 算 peakTimeSeconds/闪崩段 +
   * fire-and-forget _classifyAndPersist。@private
   */
  _enqueueClassification(tokenAddress, tokenState, reason) {
    // 标记为已处理（防止重复入队）
    this._profiled.add(tokenAddress);

    // peak 时间（可靠价峰出现在第几秒；无峰信息时 Infinity=pump_dump 不触发，保守）
    const peakTimeSeconds = tokenState._relHighestAt > 0 && tokenState.firstTickAt !== null
      ? (tokenState._relHighestAt - tokenState.firstTickAt) / 1000
      : Infinity;

    // 闪崩检测复用 shared findFlashCrashPeriod（与离线统一；peakTimeMs=可靠价峰时刻，
    // 与离线 classifyToken 的 ticks[peakIdx].ts 同锚）。急跌段落库供砸盘窗口定位。
    const flashCrashPeriod = findFlashCrashPeriod(
      tokenState._clsTicks || [], { peakTimeMs: tokenState._relHighestAt || 0 });
    const hasFlash = flashCrashPeriod !== null;

    log('info', `触发分类 ${tokenAddress.slice(0, 12)}… ${reason} ` +
      `trades=${tokenState.tradeCount || 0} age=${tokenState.createdAtMs
        ? ((Date.now() - tokenState.createdAtMs) / 1000).toFixed(1) : '?'}s`);

    this._classifyAndPersist(tokenAddress, tokenState, reason, hasFlash, peakTimeSeconds, flashCrashPeriod)
      .catch(err => {
        log('error', `分类失败 ${tokenAddress.slice(0, 12)}…`, { error: err.message });
      });
  }

  /**
   * 从 FA state 标量构造分类 metrics（纯函数，无 DB——供 _classifyAndPersist 与单测共用）。
   * 口径 = 离线 computeTickMetrics（scripts/shared/token-classifier.js），两处修改须同步。@private
   */
  _buildMetrics(tokenState, hasFlash, peakTimeSeconds, flashCrashPeriod) {
    // maxMarketCap：BNB 峰 tick 的 USD 快照 × totalSupply（≤0 → 0 → low_quality 保守方向）
    const maxMarketCap = (tokenState._relHighestPriceUsd || 0)
      * (tokenState.totalSupply > 0 ? tokenState.totalSupply : 0);

    // drawdownFromHighestPct：BNB 简单百分比（末可靠价 vs 可靠价全时峰；离线同式）
    const drawdownFromHighestPct = tokenState._relHighestPriceBnb > 0
      ? ((tokenState._relPriceBnb - tokenState._relHighestPriceBnb) / tokenState._relHighestPriceBnb) * 100
      : 0;

    // high_mcap_wash 收紧 ratio 门：afterFirst9s 三元组 running 标量（FA processTick 维护，
    // 与 computeTickMetrics 单遍历同口径；Infinity=未锁定 → null 落 wash）
    const beforePeakMaxMinRatio =
      tokenState._afterFirst9sReliableCount >= 2
        && tokenState._beforeFirst9sPeakMinBnb > 0
        && tokenState._beforeFirst9sPeakMinBnb !== Infinity
        ? tokenState._afterFirst9sPeakPriceBnb / tokenState._beforeFirst9sPeakMinBnb
        : null;

    return {
      maxMarketCap,
      peakTimeSeconds,
      drawdownFromHighestPct,
      hasFlashCrash: hasFlash,
      tickCount: tokenState.tradeCount || 0, // 供 graduation 断流分支判定（与 classInfo.tickCount 同源）
      beforePeakMaxMinRatio,
      // high_mcap_wash 暴力 block 降级门：砸盘窗口单 block 最大跌幅。
      // flashCrashPeriod=null → 0（无暴力 block），不触发降级。
      maxBlockDropPct: computeMaxBlockDropPct(tokenState._clsTicks || [], flashCrashPeriod),
    };
  }

  /**
   * 阈值判定 + token_profile JSONB 构建（纯函数，无 DB）。@private
   */
  _classify(tokenState, reason, hasFlash, peakTimeSeconds, flashCrashPeriod) {
    const metrics = this._buildMetrics(tokenState, hasFlash, peakTimeSeconds, flashCrashPeriod);
    const { category } = classifyFromMetrics(metrics, {
      pumpDumpPeakSeconds: this._pumpDumpPeakSeconds,
      pumpDumpDrawdownPct: this._pumpDumpDrawdownPct,
    });

    const classInfo = {
      maxMarketCap: metrics.maxMarketCap,
      uniqueTraders: tokenState.uniqueTraders ? tokenState.uniqueTraders.size : 0,
      totalBuyBnb: tokenState.totalBuyBnb || 0,
      totalSellBnb: tokenState.totalSellBnb || 0,
      // 首末价 BNB 比价（首价=state.firstPriceBnb 首笔已接受价；离线用原始首 tick 价，
      // 离群剔除差异仅在毒价场景，classInfo 为诊断字段不进门）
      priceChangePct: tokenState.firstPriceBnb > 0 && tokenState._relPriceBnb > 0
        ? ((tokenState._relPriceBnb - tokenState.firstPriceBnb) / tokenState.firstPriceBnb) * 100
        : 0,
      drawdownFromHighestPct: metrics.drawdownFromHighestPct,
      highestPriceBnb: tokenState._relHighestPriceBnb || 0,
      highestPriceUsd: tokenState._relHighestPriceUsd || 0,
      buyCount: tokenState.buyCount || 0,
      sellCount: tokenState.sellCount || 0,
      tickCount: tokenState.tradeCount || 0,
      peakTimeSeconds,
      hasFlashCrash: hasFlash,
    };

    const nowIso = new Date().toISOString();
    // 涨幅指标（bsc-v2 起与离线管线同口径：base=首个可靠价，BNB 计价；无可靠价 → null）。
    // 在线触发时刻的快照值，离线重跑会用全史 ticks 纠正。
    const base = tokenState._relFirstPriceBnb || 0;
    const maxChangePercent = base > 0
      ? ((tokenState._relHighestPriceBnb - base) / base) * 100
      : null;
    const finalChangePercent = base > 0
      ? ((tokenState._relPriceBnb - base) / base) * 100
      : null;
    const profile = {
      version: 1,
      category,
      source: 'online',
      classified_at: nowIso,
      classifier_version: CLASSIFIER_VERSION,
      max_market_cap_usd: metrics.maxMarketCap || 0,
      max_change_percent: maxChangePercent,
      final_change_percent: finalChangePercent,
      class_info: classInfo,
      config_snapshot: {
        qualityMarketCapThreshold: DEFAULT_SCORING_PARAMS.qualityMarketCapThreshold,
        pumpDumpPeakSeconds: this._pumpDumpPeakSeconds,
        pumpDumpDrawdownPct: this._pumpDumpDrawdownPct,
        pumpDumpGraduationMinMarketCap: DEFAULT_SCORING_PARAMS.pumpDumpGraduationMinMarketCap,
        pumpDumpGraduationMaxTicks: DEFAULT_SCORING_PARAMS.pumpDumpGraduationMaxTicks,
        pumpDumpGraduationMinDrawdownPct: DEFAULT_SCORING_PARAMS.pumpDumpGraduationMinDrawdownPct,
        minTicks: MIN_TICKS,
      },
      reason: reason || null,
      // 分类信息可见时刻（回测防前视口径）：在线=写入时刻（诚实）；离线 daily 传 firstIdle 算出值
      category_visible_at: nowIso,
      // 闪崩段（peak→floor 时段），供砸盘窗口定位（Tier2 bad_sell 类消费）
      flash_crash_period: flashCrashPeriod || null,
      // 暴力砸盘 block（block_number[]；在线即算——母版 online 留空由 daily 补，BSC 无 daily 管线）
      violent_crash_blocks: computeViolentCrashBlocks(tokenState._clsTicks || [], flashCrashPeriod),
      first_tick_time: tokenState.firstTickAt || null,
      last_tick_time: tokenState.lastTickAt || null, // 与 first_tick_time 成对=分类数据时间范围（诊断）
      conflict: null,
    };

    return { category, metrics, profile };
  }

  /**
   * 异步分类并持久化（fire-and-forget；仅写 token_profiles，不做任何 wallets/creator 写入）。@private
   */
  async _classifyAndPersist(tokenAddress, tokenState, reason, hasFlash, peakTimeSeconds, flashCrashPeriod) {
    const { category, profile } = this._classify(tokenState, reason, hasFlash, peakTimeSeconds, flashCrashPeriod);

    try {
      const { dbManager } = require('./dbManager');
      const row = {
        token_address: tokenAddress,
        category,
        source: 'online',
        classifier_version: CLASSIFIER_VERSION,
        classified_at: profile.classified_at,
        category_visible_at: profile.category_visible_at,
        peak_mcap_usd: profile.max_market_cap_usd,
        max_change_percent: profile.max_change_percent ?? null,
        final_change_percent: profile.final_change_percent ?? null,
        profile,
      };
      const { error } = await dbManager.getClient()
        .from('token_profiles')
        .upsert(row, { onConflict: 'token_address' });
      if (error) {
        log('error', `写入 token_profiles 失败`, { error: error.message });
      } else {
        log('info', `✓ ${tokenAddress.slice(0, 12)}… → ${category} (online)`);
      }
    } catch (err) {
      log('error', `DB 操作失败 ${tokenAddress.slice(0, 12)}…`, { error: err.message });
    }
  }

  /**
   * 定时扫描：补救"短命暴发后死亡、零迟到 tick"的漏分类 token。
   *
   * checkAndEnqueue 只在 token 有新 tick 时被调，死后零 tick 的 token 永不触发 idle 分类。
   * 本方法周期遍历 FA tracked tokens，用 now-lastTickAt 判真实 idle（不能复用 inter-tick
   * gap——那是上一对 tick 的旧值），对漏分类的死 token 补分类（同样写 source=online）。
   *
   * 时序安全：引擎 prune(30min) 淘汰死 token，扫描 60s 一次 + idle 60s，能在淘汰前完成。
   * 计算成本：遍历 O(n) 微秒级（每 token 仅 _profiled.has + Map.get + 算术比较）。
   * 不加 try-catch：异常杀进程暴露问题（main.js uncaughtException=exit(1)）——只统计正常分支跳过。
   */
  _scanIdleTokens() {
    if (!this._enabled || !this._scanEnabled || !this._factorAggregator) return;
    const now = Date.now();
    let scanned = 0;
    let triggered = 0;
    // 诊断计数（每轮 log，定位"扫描在跑但恒 triggered=0"的分支原因）
    let skipProfiled = 0, skipNoState = 0, skipNotIdle = 0, skipLowTicks = 0;
    const tokens = this._factorAggregator.getTrackedTokens();
    const tracked = tokens.length;
    for (const tokenAddress of tokens) {
      scanned++;
      if (this._profiled.has(tokenAddress)) { skipProfiled++; continue; }
      const state = this._factorAggregator.getTokenState(tokenAddress);
      if (!state) { skipNoState++; continue; }
      const idleSeconds = (now - state.lastTickAt) / 1000;
      if (idleSeconds <= this._idleThresholdSeconds) { skipNotIdle++; continue; }   // 还没真正 idle
      if ((state.tradeCount || 0) < this._minTicks) { skipLowTicks++; continue; }  // tick 不够，分类无意义
      triggered++;
      this._enqueueClassification(tokenAddress, state,
        `scan_idle: ${idleSeconds.toFixed(0)}s > ${this._idleThresholdSeconds}s`);
    }
    if (triggered > 0) {
      log('info', `扫描完成: 遍历 ${scanned} 个 token，补分类 ${triggered} 个漏分类死 token`);
    }
    // 每轮 log（含 triggered=0）：确认 setInterval 在跑 + 各分支跳过计数，定位停摆根因
    log('info', `扫描统计 tracked=${tracked} scanned=${scanned} triggered=${triggered} | ` +
      `skip: profiled=${skipProfiled} noState=${skipNoState} notIdle=${skipNotIdle} lowTicks=${skipLowTicks}`);
  }

  /**
   * 启动定时扫描。由引擎在构造 OPB 后调用，注入 FA。
   * @param {Object} [deps]
   * @param {Object} deps.factorAggregator FourMemeFactorAggregator 实例（遍历 tracked + 读 state）
   */
  start({ factorAggregator } = {}) {
    this._factorAggregator = factorAggregator || null;
    if (!this._enabled || !this._scanEnabled || !this._factorAggregator) return;
    this._scanInterval = setInterval(() => this._scanIdleTokens(), this._scanIntervalSeconds * 1000);
    if (this._scanInterval.unref) this._scanInterval.unref();  // 定时器不阻止进程退出
    log('info', `定时扫描已启动（间隔 ${this._scanIntervalSeconds}s，idle 阈值 ${this._idleThresholdSeconds}s）`);
  }

  /**
   * 清理资源（引擎 stop 时调用）
   */
  destroy() {
    if (this._scanInterval) {
      clearInterval(this._scanInterval);
      this._scanInterval = null;
    }
    this._factorAggregator = null;
    this._profiled.clear();
    this._enabled = false;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      enabled: this._enabled,
      profiledCount: this._profiled.size,
    };
  }
}

module.exports = { OnlineProfileBuilder };
