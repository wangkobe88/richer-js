/**
 * 买腿第三层 GMGN 条件服务（FAKER 0xc6ee6bd2…7777 团伙盘案，2026-10-14 用户裁定）
 *
 * 三层买腿条件：触发条件（fire + narrativeCallCondition 直调）→ 预检查条件
 * （preBuyCheckCondition / repeatBuyCheckCondition）→ **GMGN 条件
 * （gmgnCheckCondition，本服务）**。第三层的因子在「前两层全部满足、确定要买」
 * 时才构建——即此刻才真调 GMGN getTokenInfo（付费配额最小化 + 数据天然新鲜，
 * 无快照龄问题）。
 *
 * 与叙事直调 GMGN（enrichSocialByGmgn）刻意隔离：
 * - 直调快照走 token_narrative.gmgn_info / external_resource_cache（成功缓存 1d），
 *   行龄不可知——对「买前新鲜」语义有害，本服务**只认自己 fetch 的结果**
 *   （不读直调快照、不回写 external_resource_cache）
 * - 本侧独立进程内缓存：per-token 短 TTL（默认 5s，防同 token 连续 fire 重复烧）+
 *   inflight join（并发评估合一次请求）+ 失败短冷却（默认 10s，冷却期内不重打）
 *
 * fail-closed（用户裁定）：失败/超时/GMGN 未索引/key 缺失 → covered=0，引擎侧
 * 机制硬拒（不评估条件表达式）——「不确定就不买」由机制保证，不依赖条件写法
 * 带 covered==1。与 preBuy 键集里 gmgn 三键的 covered=0 放行语义（宁漏拦不误杀，
 * x-0 案）刻意相反：那是被动顺带数据的宽容，这是显式风险门的严格。
 */

const { extractGmgnRisk } = require('../../core/gmgn-api/risk-fields');
const { mapGmgnRiskFactors } = require('./NarrativeDirectCaller');
const { ConditionEvaluator } = require('../../strategies/ConditionEvaluator');

// gmgnCheckCondition 可引用的因子键（mapGmgnRiskFactors 单点映射产物；2026-10-15
// 加 gmgnVisitingCount 注意力观测键——「流动性跟注意力背离」用户裁定；
// 2026-10-17 Nightshift 案加 narrativeCategory——非 GMGN 键，由引擎从 fire 因子表
// 透传进 context，供「叙事类型 × issuerTokenCount 分档门」条件引用；
// 2026-10-18 GMGN 钱包画像层并入 gwp* 18 键——非 token-api 产物，由
// GmgnWalletStatsService 从首窗 top-N 买家跨盘画像聚合（引擎第五参透传，缺省不并
// =存量零影响；Phase 1 观察期只落 metadata 不进条件串））
const { GWP_FACTOR_KEYS } = require('./GmgnWalletStatsService');

const GMGN_CONDITION_FACTOR_KEYS = [
  'gmgnIssuerTokenCount',
  'gmgnBundlerWalletRatio',
  'gmgnRiskCovered',
  'gmgnVisitingCount',
  'narrativeCategory',
  ...GWP_FACTOR_KEYS,
];

const DEFAULTS = {
  timeoutMs: 5000,       // GMGN 单次调用超时（实测 ~1.6s；base-api 429 自动重试 ≤5s 由超时竞速截断）
  perTokenTtlMs: 5000,   // 成功结果进程内复用窗（0=每次硬调）
  failCooldownMs: 10000, // 失败后冷却窗（冷却期内 covered=0 直接返回，不重打）
};

class GmgnRiskCheckService {
  /**
   * @param {Object} [config] - fourmemeWs.gmgnCheck 段（flap 实验经 _mergedWsConfig 同键）
   * @param {Object} [logger] - 引擎 logger（可缺省，console 兜底仅在构造告警用）
   */
  constructor(config = {}, logger = null) {
    this._timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : DEFAULTS.timeoutMs;
    this._ttlMs = Number.isFinite(config.perTokenTtlMs) && config.perTokenTtlMs >= 0 ? config.perTokenTtlMs : DEFAULTS.perTokenTtlMs;
    this._failCooldownMs = Number.isFinite(config.failCooldownMs) && config.failCooldownMs >= 0 ? config.failCooldownMs : DEFAULTS.failCooldownMs;
    this._logger = logger;
    this._cache = new Map();      // tokenKey → { at, ok, result }（ok=false 为失败标记，冷却判据）
    this._inflight = new Map();   // tokenKey → Promise（并发 join）
  }

  /**
   * 买前实时 GMGN 风险检查。不抛错——一切失败形状归一为 covered=0 结果
   * （fail-closed 拒买由引擎侧执行）。
   * @param {string} tokenAddress
   * @param {string} chain - BSC-only 项目，恒 'bsc'
   * @returns {Promise<{covered: number, gmgnIssuerTokenCount: number,
   *   gmgnBundlerWalletRatio: number, gmgnRiskCovered: number,
   *   gmgnVisitingCount: number,
   *   durationMs: number, fromCache: boolean, failReason: string|null}>}
   */
  async check(tokenAddress, chain = 'bsc') {
    const tokenKey = `${chain}:${String(tokenAddress || '').toLowerCase()}`;
    const startedAt = Date.now();

    // TTL 内成功结果复用（fromCache 标记审计轨迹）
    const cached = this._cache.get(tokenKey);
    if (cached && cached.ok && this._ttlMs > 0 && (startedAt - cached.at) < this._ttlMs) {
      return { ...cached.result, durationMs: startedAt - cached.at, fromCache: true };
    }
    // 失败冷却期内不重打（防连环烧配额；冷却到期放行重试）
    if (cached && !cached.ok && (startedAt - cached.at) < this._failCooldownMs) {
      return this._noDataResult('cooldown');
    }

    // inflight join：同 token 并发评估合一次请求
    const existing = this._inflight.get(tokenKey);
    if (existing) return existing;

    const p = this._fetch(tokenKey, chain, tokenAddress, startedAt)
      .finally(() => this._inflight.delete(tokenKey));
    this._inflight.set(tokenKey, p);
    return p;
  }

  async _fetch(tokenKey, chain, tokenAddress, startedAt) {
    let result;
    const apiKey = process.env.GMGN_API_KEY;
    if (!apiKey) {
      result = this._noDataResult('no_api_key');
    } else {
      try {
        // 惰性 require（而非模块顶层）：① 单测先污染 require cache 再加载本模块即可
        //   打桩 GMGNTokenAPI；② 引擎进程不配置 GMGN 时零加载（不触发 socks 代理链）
        const { GMGNTokenAPI } = require('../../core/gmgn-api');
        const api = new GMGNTokenAPI({ apiKey, timeout: this._timeoutMs });
        const info = await api.getTokenInfo(chain, tokenAddress);
        const risk = extractGmgnRisk(info);
        result = risk
          ? { covered: 1, ...mapGmgnRiskFactors(risk), durationMs: Date.now() - startedAt, fromCache: false, failReason: null }
          : this._noDataResult('not_indexed', Date.now() - startedAt);
      } catch (e) {
        result = this._noDataResult(`error: ${e?.message || e}`, Date.now() - startedAt);
      }
    }

    this._cache.set(tokenKey, { at: Date.now(), ok: result.failReason === null, result });
    return result;
  }

  _noDataResult(failReason, durationMs = 0) {
    // 与 mapGmgnRiskFactors(null) 同款 0 值形状（covered=0 八键全 0），外加审计字段
    return {
      covered: 0,
      gmgnIssuerTokenCount: 0,
      gmgnBundlerWalletRatio: 0,
      gmgnRiskCovered: 0,
      gmgnVisitingCount: 0,
      gmgnRenownedWallets: 0,
      gmgnSmartWallets: 0,
      gmgnWhaleWallets: 0,
      gmgnCreatorCreatedCount: 0,
      durationMs,
      fromCache: false,
      failReason,
    };
  }

  /**
   * 买前实时检查 + 条件评估（实时引擎消费点）。
   * @param {string} tokenAddress
   * @param {string} chain
   * @param {string} condition
   * @param {string|null} [narrativeCategory] - 叙事类型（fire 因子表透传；null =
   *   未分析/未分类/legacy 腿——条件串 IS NULL 臂放行）
   * @param {Object|null} [gwpFactors] - GMGN 钱包画像层 gwp 因子（引擎第五参透传；
   *   null/缺省=未启用/回测 → 不并键=存量零影响；gwpCovered=null 走条件串 IS NULL 臂）
   * @returns {Promise<{passed: boolean, evaluated: boolean, factors: Object,
   *   condition: string|null, reason: string|null}>} factors 含四键+审计字段
   *   +narrativeCategory+gwp*（拒单复盘可见）
   */
  async checkAndEvaluate(tokenAddress, chain, condition, narrativeCategory = null, gwpFactors = null) {
    const factors = await this.check(tokenAddress, chain);
    // narrativeCategory/gwp* 非 GMGN token-api 产物——合并进 context 供条件评估
    //（covered=0 前置硬拒不受影响：它只看 gmgnRiskCovered）
    const context = { ...factors, narrativeCategory: narrativeCategory ?? null };
    if (gwpFactors) Object.assign(context, gwpFactors);
    const verdict = GmgnRiskCheckService.evaluateFactors(context, condition);
    return { ...verdict, factors: context, condition: String(condition || '').trim() || null };
  }

  /**
   * 因子表 + 条件 → 判定（纯函数；回测引擎用直调快照映射出的因子表直调本方法，
   * 不经过 check() 网络路径——回放同一管线，差异仅「实时多一次新鲜调用」）。
   * fail-closed 机制保证：covered=0 → 拒（不评估表达式）；评估异常 → 拒。
   */
  static evaluateFactors(factors, condition) {
    const cond = String(condition || '').trim();
    if (!cond) return { passed: true, evaluated: false, reason: null };
    if (!factors || factors.gmgnRiskCovered !== 1) {
      const why = factors?.failReason ? `gmgn_check_no_data(${factors.failReason})` : 'gmgn_check_no_data';
      return { passed: false, evaluated: false, reason: why };
    }
    try {
      const evaluator = new ConditionEvaluator();
      const ok = evaluator.evaluate(evaluator.parseCondition(cond), factors) === true;
      return { passed: ok, evaluated: true, reason: ok ? null : `gmgn_check_failed(${cond})` };
    } catch (e) {
      // 语法/键集在 loadStrategies 已 fail-fast 校验过，运行时异常=实现 bug——按
      // fail-closed 拒并留 reason 供 signal metadata 定位
      return { passed: false, evaluated: true, reason: `gmgn_check_error(${e?.message || e})` };
    }
  }

  /**
   * gmgnCheckCondition 可引用的因子键集（StrategyEngine.loadStrategies
   * 第四键集 / StrategyLibraryService.validateLegs 同口径消费）
   */
  static getConditionFactorKeys() {
    return [...GMGN_CONDITION_FACTOR_KEYS];
  }
}

module.exports = { GmgnRiskCheckService, GMGN_CONDITION_FACTOR_KEYS };
