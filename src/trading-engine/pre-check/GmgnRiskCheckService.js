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
 * fail-open（2026-10-20 用户裁定，乌龟案 0x0adad648…7777 GMGN 429 拒买现场）：
 * 失败/超时/GMGN 未索引/key 缺失/冷却 → covered=0 → **放行**（不评估条件表达式，
 * reason 留审计）——GMGN 是附加风控层，API 不可用时不得拦住买点。历史沿革：
 * 2026-10-14 FAKER 团伙盘案原为 fail-closed 硬拒「不确定就不买」，2026-10-20
 * 因 GMGN IP 级 RATE_LIMIT_BANNED（18s 封禁）连拒三枪、恢复后 47s 才买入（价格
 * 已涨 21%）翻转为 fail-open。条件表达式评估异常（键集外/语法）仍 fail-closed
 * 拒——那是配置/实现错误，不是 API 不可用。
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
// =存量零影响；Phase 1 观察期只落 metadata 不进条件串）；
// 2026-10-27 T76 注意力空转四键（用户裁定「VC 高但买入者少/买入量小=获得了注意力
// 但没有吸引力」）：gmgnVisitorsPerBuyer / gmgnVisitorsPerBuyBnb 两比值键由
// computeGmgnAttentionFactors 用 GMGN visitingCount ÷ fire 因子表 buyWallets /
// buyVolumeBnb 现算（引擎第六参透传）——观察键先行不进条件串，阈值待票池分布）；
// 2026-10-28 T82 mcap 早期豁免臂：marketCap（非 GMGN 键，FA fire 因子表 USD 市值
// 由引擎/回测经 buyContext 同刻同源透传）——GMGN wallet_tags_stat 分母个位数的
// 超早期盘 bundler ratio 是采样噪声（0xa44e…7777 案同盘 3min 内 58.8→166.7 剧变），
// 市值 <8K 时 bundler 门豁免放行；null=市值证据缺失不豁免（豁免门保守方向，
// 与 famous/sybil「名单缺失恒 0 放行」的拦截门 0 语义刻意相反）
const { GWP_FACTOR_KEYS } = require('./GmgnWalletStatsService');

const GMGN_CONDITION_FACTOR_KEYS = [
  'gmgnIssuerTokenCount',
  'gmgnBundlerWalletRatio',
  'gmgnRiskCovered',
  'gmgnVisitingCount',
  'narrativeCategory',
  'gmgnBuyWallets',
  'gmgnBuyVolumeBnb',
  'gmgnVisitorsPerBuyer',
  'gmgnVisitorsPerBuyBnb',
  'marketCap',
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
   * （fail-open 放行由 evaluateFactors 执行，2026-10-20 裁定）。
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
    // 与 mapGmgnRiskFactors(null) 同款 0 值形状（covered=0），外加审计字段。
    // whale/creator 两观测键已删（T76 2026-10-27：47 票全零=零区分度，用户裁定清理）
    return {
      covered: 0,
      gmgnIssuerTokenCount: 0,
      gmgnBundlerWalletRatio: 0,
      gmgnRiskCovered: 0,
      gmgnVisitingCount: 0,
      gmgnRenownedWallets: 0,
      gmgnSmartWallets: 0,
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
   * @param {Object|null} [buyContext] - fire 因子表买盘上下文（T76 2026-10-27 注意力
   *   空转观测键原料）：{ buyWallets, buyVolumeBnb }。null/缺省=不并键=存量零影响；
   *   比值由 computeGmgnAttentionFactors 用「本层新鲜 vc ÷ 同刻买盘」现算——TTL/缓存
   *   命中时 vc 来自缓存（≤5s 龄）而买盘实时，混合时窗即设计语义（两侧都是买点附近值）
   * @returns {Promise<{passed: boolean, evaluated: boolean, factors: Object,
   *   condition: string|null, reason: string|null}>} factors 含四键+审计字段
   *   +narrativeCategory+gwp*+注意力空转四键（拒单复盘可见）
   */
  async checkAndEvaluate(tokenAddress, chain, condition, narrativeCategory = null, gwpFactors = null, buyContext = null) {
    const factors = await this.check(tokenAddress, chain);
    // narrativeCategory/gwp*/注意力空转键 非 GMGN token-api 直出——合并进 context 供
    // 条件评估（covered=0 前置硬拒不受影响：它只看 gmgnRiskCovered）
    const context = { ...factors, narrativeCategory: narrativeCategory ?? null };
    if (gwpFactors) Object.assign(context, gwpFactors);
    if (buyContext) {
      // T82 2026-10-28 mcap 早期豁免臂原料：fire 因子表市值（USD）同刻同源并入
      // context（与 narrativeCategory 第四参透传同构）；null=缺失不豁免——豁免门
      // 需要市值真值支撑，ConditionEvaluator 对 null 比较恒 false 天然保守
      context.marketCap = typeof buyContext.marketCap === 'number' ? buyContext.marketCap : null;
      Object.assign(context,
        GmgnRiskCheckService.computeGmgnAttentionFactors(factors, buyContext.buyWallets, buyContext.buyVolumeBnb));
    }
    const verdict = GmgnRiskCheckService.evaluateFactors(context, condition);
    return { ...verdict, factors: context, condition: String(condition || '').trim() || null };
  }

  /**
   * 因子表 + 条件 → 判定（纯函数；回测引擎用直调快照映射出的因子表直调本方法，
   * 不经过 check() 网络路径——回放同一管线，差异仅「实时多一次新鲜调用」）。
   * fail-open 机制保证（2026-10-20 用户裁定）：covered=0（失败/超时/未索引/
   * key 缺失/冷却）→ 放行（不评估表达式，reason 留审计，evaluated=false 供
   * 下游区分「真评估过」与「无数据跳过」）；评估异常 → 拒（条件写法/实现错误）。
   */
  static evaluateFactors(factors, condition) {
    const cond = String(condition || '').trim();
    if (!cond) return { passed: true, evaluated: false, reason: null };
    if (!factors || factors.gmgnRiskCovered !== 1) {
      const why = factors?.failReason ? `gmgn_check_no_data(${factors.failReason})` : 'gmgn_check_no_data';
      return { passed: true, evaluated: false, reason: why };
    }
    try {
      const evaluator = new ConditionEvaluator();
      const ok = evaluator.evaluate(evaluator.parseCondition(cond), factors) === true;
      return { passed: ok, evaluated: true, reason: ok ? null : `gmgn_check_failed(${cond})` };
    } catch (e) {
      // 语法/键集在 loadStrategies 已 fail-fast 校验过，运行时异常=实现 bug——仍按
      // fail-closed 拒（与「API 不可用放行」刻意不同：这不是数据拿不到，是条件
      // 本身有问题），reason 供 signal metadata 定位
      return { passed: false, evaluated: true, reason: `gmgn_check_error(${e?.message || e})` };
    }
  }

  /**
   * 注意力空转观测键合成（T76 2026-10-27 纯函数；实时 checkAndEvaluate 与回测
   * context 组装共用——单一真相源，回放同构）。用户裁定判据：「VC 高但买入者少 /
   * 买入量小」=获得了注意力但没有吸引力。
   * - gmgnBuyWallets / gmgnBuyVolumeBnb：原料透传（fire 因子表同刻同源，拒单复盘
   *   无需回查 FA）
   * - gmgnVisitorsPerBuyer = vc ÷ buyWallets（访客/买家比）；buyWallets=0 且 vc>0
   *   → 取 vc（零买家=全额空转的上限形状，有数不 null——null 会让 `<=N` 门恒 false
   *   误拦，与 famous 0 语义裁定同向）
   * - gmgnVisitorsPerBuyBnb = vc ÷ buyVolumeBnb（访客/BNB 买入量比）；buyVolumeBnb
   *   ≤0 且 vc>0 → 取 vc（同上）
   * - vc=0（死盘/秒新盘）→ 两比值 0=无注意力可观察，正常新票形状恒放行
   * - covered≠1 → 四键全 0（fail-open 路径无 GMGN 数据，不合成——键 0 与
   *   _noDataResult 形状一致）
   * 观察键先行不进条件串，阈值待票池回放分布裁定（同 T74 纪律）。
   * @param {Object} factors - 本层 GMGN 因子（covered/gmgnVisitingCount）
   * @param {number|null} buyWallets - FA 全史独立买入钱包数（_buyerAddresses.size）
   * @param {number|null} buyVolumeBnb - FA 全史买入 BNB（state.totalBuyBnb）
   */
  static computeGmgnAttentionFactors(factors, buyWallets, buyVolumeBnb) {
    const wallets = Number.isFinite(buyWallets) && buyWallets > 0 ? buyWallets : 0;
    const volume = Number.isFinite(buyVolumeBnb) && buyVolumeBnb > 0 ? buyVolumeBnb : 0;
    if (!factors || factors.gmgnRiskCovered !== 1) {
      return { gmgnBuyWallets: wallets, gmgnBuyVolumeBnb: volume,
        gmgnVisitorsPerBuyer: 0, gmgnVisitorsPerBuyBnb: 0 };
    }
    const vc = typeof factors.gmgnVisitingCount === 'number' && factors.gmgnVisitingCount > 0
      ? factors.gmgnVisitingCount : 0;
    const round1 = (x) => Math.round(x * 10) / 10;
    return {
      gmgnBuyWallets: wallets,
      gmgnBuyVolumeBnb: volume,
      gmgnVisitorsPerBuyer: wallets > 0 ? round1(vc / wallets) : vc,
      gmgnVisitorsPerBuyBnb: volume > 0 ? round1(vc / volume) : vc,
    };
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
