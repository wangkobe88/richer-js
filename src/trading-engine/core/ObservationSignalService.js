/**
 * 观察信号服务（2026-10-23 用户裁定：₿DOG 案——叙事 high 87.32 落地时市值已破
 * 买窗，零信号零留痕，「叙事过但没买」的票不可见）。
 *
 * 触发臂（任一）：叙事评级==2|3（与买条件同口径；null=未完成/1=low/9=失败超时归一
 * 均不触发）或 市值 > marketCapThreshold（默认 16 BNB 严格大于；T84 2026-10-28
 * 量纲切换随 marketCap 因子换 BNB 域，原默认 12000 USD≈16.1 BNB）。节奏=事件
 * 首记+间隔补采：首次满足即记，之后距上一行 ≥ intervalMs 且仍满足再记，每票最多
 * maxPerToken 行（实验级全局不变量：重启经 DB 重建续接，先例
 * _initTokenNotificationState）。
 *
 * 纯观察零交易副作用：不进买腿去抖链，evaluate 同步纯内存（tick ~0.75s 频率下
 * 开销=两次比较+Map 查），写行 fire-and-forget。仅 virtual+live（引擎
 * FourMemeWssTradingEngine 接线；BacktestEngine 零接线天然不接）。
 */

const { TradeSignal } = require('../entities/TradeSignal');
const { buildFactorValuesForTimeSeries } = require('./FactorBuilder');

// 默认值单一真相源（default.json 刻意不加段=缺段即关；表单 placeholder 仅展示）
const DEFAULTS = { maxPerToken: 3, intervalMs: 60000, marketCapThreshold: 16 };
const RANGES = {
  maxPerToken: [1, 10],
  intervalMs: [5000, 3600000],
  marketCapThreshold: [0, 1000000],
};

class ObservationSignalService {
  /**
   * @param {Object} p
   * @param {string} p.experimentId
   * @param {Object} p.logger - 引擎 logger（info/warn/error 带 experimentId 前缀）
   * @param {Object} p.db - supabase client（dbManager.getClient()）
   * @param {number} [p.maxPerToken=3]
   * @param {number} [p.intervalMs=60000]
   * @param {number} [p.marketCapThreshold=16]（BNB 域）
   */
  constructor({ experimentId, logger, db, maxPerToken, intervalMs, marketCapThreshold }) {
    this._experimentId = experimentId;
    this._logger = logger;
    this._db = db;
    // 形状非法 throw 拒启（与 loadStrategies 未知因子拒启同口径：脏配置到达=配置
    // 错误应大声失败，不做钳制兜底）；undefined 回落默认值
    const given = { maxPerToken, intervalMs, marketCapThreshold };
    this._cfg = {};
    for (const key of Object.keys(RANGES)) {
      const val = given[key];
      if (val === undefined) { this._cfg[key] = DEFAULTS[key]; continue; }
      const [min, max] = RANGES[key];
      if (!Number.isInteger(val) || val < min || val > max) {
        throw new Error(`observationSignals.${key} 非法: ${val}（须整数 [${min},${max}]）`);
      }
      this._cfg[key] = val;
    }
    // per-token { count, lastAt }；lastAt=已落观察行的最后时刻（ms，DB 重建取
    // max(created_at)）
    this._states = new Map();
  }

  /**
   * 重启重建：拉全本实验 OBSERVE 瘦列（token_address, created_at）内存聚合 per-token
   * 计数与最后时刻——「每票最多 N 行」是实验级全局不变量而非进程级（内存清零会让
   * 重启后再记 N 行、DB 超限）。不走 PostgREST 聚合（版本不定）也不走单页（max-rows
   * 静默截断坑），offset 循环拉全（观察行每票 ≤maxPerToken，量级千行内）。
   * 失败由调用方决定降级（服务不启用，少记不错记）。
   */
  async init() {
    const PAGE = 1000;
    let offset = 0;
    let rows;
    do {
      const { data, error } = await this._db
        .from('strategy_signals')
        .select('token_address,created_at')
        .eq('experiment_id', this._experimentId)
        .eq('signal_type', 'OBSERVE')
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`观察信号状态重建查询失败: ${error.message}`);
      rows = data || [];
      for (const row of rows) {
        const st = this._states.get(row.token_address) || { count: 0, lastAt: 0 };
        st.count += 1;
        st.lastAt = Math.max(st.lastAt, new Date(row.created_at).getTime());
        this._states.set(row.token_address, st);
      }
      offset += PAGE;
    } while (rows.length === PAGE);
  }

  /**
   * 每 tick 调用（挂 _onFactorsUpdated 买腿分支）：同步纯内存判定，绝不 throw。
   * 先记内存态再 fire-and-forget 写（await 窗口内不双发）；写失败不回滚——回滚
   * 引入双发竞态，丢一行上限保守，warn 可见。
   */
  evaluate(token, factors, nowMs) {
    try {
      const state = this._states.get(token.token) || { count: 0, lastAt: 0 };
      const verdict = ObservationSignalService.evaluateCore({
        factors,
        state,
        cfg: this._cfg,
        nowMs,
        alreadyBought: token.status === 'bought',
      });
      if (!verdict.shouldRecord) return;
      this._states.set(token.token, { count: state.count + 1, lastAt: nowMs });
      this._save(token, factors, verdict).catch(e =>
        this._logger.warn(this._experimentId, 'Observation',
          `观察信号落库失败（丢该行不回滚）| ${token.symbol || token.token} ${e.message}`));
    } catch (e) {
      // 评估自身异常绝不影响交易链路
      this._logger.warn(this._experimentId, 'Observation', `观察信号评估异常: ${e.message}`);
    }
  }

  /**
   * 纯判定核心（单测真值表主体）。
   * @returns {{shouldRecord:false, reason:string} |
   *           {shouldRecord:true, trigger:'narrative'|'marketcap'|'both', rating:number|null, marketCap:number, index:number}}
   */
  static evaluateCore({ factors, state, cfg, nowMs, alreadyBought }) {
    if (alreadyBought) return { shouldRecord: false, reason: 'bought' };
    if (state.count >= cfg.maxPerToken) return { shouldRecord: false, reason: 'cap' };
    const narrativeHit = factors.narrativeRating === 2 || factors.narrativeRating === 3;
    const marketCapHit = Number.isFinite(factors.marketCap) && factors.marketCap > cfg.marketCapThreshold;
    if (!narrativeHit && !marketCapHit) return { shouldRecord: false, reason: 'conditions' };
    // 首行（count===0）事件驱动立即记；后续行须间隔补采
    if (state.count > 0 && nowMs - state.lastAt < cfg.intervalMs) {
      return { shouldRecord: false, reason: 'interval' };
    }
    const trigger = narrativeHit && marketCapHit ? 'both' : (narrativeHit ? 'narrative' : 'marketcap');
    return {
      shouldRecord: true,
      trigger,
      rating: narrativeHit ? factors.narrativeRating : null,
      marketCap: factors.marketCap,
      index: state.count + 1,
    };
  }

  /** 落库一行观察信号（signal_type='OBSERVE'、action='hold'、executed=false 恒终态）。 */
  async _save(token, factors, verdict) {
    const parts = [];
    if (verdict.trigger === 'narrative' || verdict.trigger === 'both') parts.push(`叙事评级 ${verdict.rating}`);
    if (verdict.trigger === 'marketcap' || verdict.trigger === 'both') parts.push(`市值 > $${this._cfg.marketCapThreshold}`);
    const signal = new TradeSignal({
      experimentId: this._experimentId,
      tokenAddress: token.token,
      tokenSymbol: token.symbol,
      chain: token.chain || 'bsc',
      signalType: 'OBSERVE',
      action: 'hold',
      confidence: null,
      reason: `观察信号·未交易代币（${parts.join(' + ')}）`,
      metadata: {
        observation: {
          index: verdict.index,
          maxPerToken: this._cfg.maxPerToken,
          trigger: verdict.trigger,
          rating: verdict.rating,
          marketCap: verdict.marketCap,
          marketCapThreshold: this._cfg.marketCapThreshold,
        },
        strategyId: null,
        strategyName: '观察信号',
        // trendFactors 白名单已含 narrativeRating；marketCap 不在白名单故显式存
        // observation.marketCap；绝不写 execution_status（不进 rejected 统计）
        trendFactors: buildFactorValuesForTimeSeries(factors),
      },
    });
    const v = signal.validate();
    if (!v.valid) throw new Error(`观察信号行校验失败: ${v.errors.join('; ')}`);
    await signal.save();
  }
}

module.exports = { ObservationSignalService };
