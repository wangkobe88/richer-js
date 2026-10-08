/**
 * 叙事评级直调服务
 *
 * 买腿评估时按策略 narrativeCallCondition 触发，直接同步调用
 * NarrativeAnalyzer.analyze()（Jev 秒级）拿叙事评级，替代已废弃的
 * "任务表 + worker + 轮询"旧链路（[DECOUPLED] 968748d）。
 *
 * 语义（用户裁定）：
 * - 失败/超时 → 返回 numericRating=9（未评级）放行，由策略条件表达式裁决买不买
 * - 超时上限 30s：被弃的底层分析后台跑完 upsert，下轮买入评估命中 is_valid 缓存
 * - 叙事结果为代币级全局缓存（token_address 唯一，不挂实验名下）：
 *   任何实验共享同一份，命中有效缓存即复用，换实验不重复分析
 * - 同 token in-flight 去重：并发调用共享同一底层 analyze promise
 * - 永不抛错（结果全部体现在返回值，由调用方打日志）
 *
 * NarrativeAnalyzer 为 ESM（.mjs），交易引擎为 CommonJS——惰性动态 import
 * 并缓存（先例：web/routes/narrative.routes.js loadAnalyzer）。ESM 依赖链
 * 的 env/config 按模块相对路径自加载，引擎进程从仓库根启动即可。
 */

/** 直调超时上限（毫秒） */
const DIRECT_CALL_TIMEOUT_MS = 30000;

/** 超时错误标记（timedOut 判定用） */
const TIMEOUT_CODE = 'NARRATIVE_DIRECT_TIMEOUT';

/**
 * precheck fail 重试豁免窗（秒）——与 narrative engine PrecheckFailRetryService
 * 的 retryWindowSec 缺省值联动（2026-09-27 用户裁定：项目币宣告竞态盘的再次检测
 * 豁免；窗口内叙事引擎侧重析可能翻正，出窗后重试停止 = 终态，引擎侧可安全短路）
 */
const PRECHECK_FAIL_RETRY_WINDOW_SEC = 300;

/**
 * 叙事否决短路判定（纯函数，2026-09-27 用户裁定：叙事分析没过的代币不再重复
 * 生成买信号——检测多少次都没用；项目币 address-fail 重试窗内豁免）
 *
 * - numericRating===1（low=叙事否决终态）且非豁免形状 → true（登记短路）
 * - 豁免 = precheckStage==='address'（宣告竞态形状，PrecheckFailRetryService 域）
 *   且代币年龄 < 300s（重试窗内可能翻正）；无年龄信息按出窗处理（与重试服务
 *   「无时间锚不重试」fail-closed 口径对齐）
 * - rating 2/3（过）/ 9（未评级，非终态）→ false
 *
 * @param {number} numericRating - 直调评级 {1,2,3,9}
 * @param {string|null} precheckStage - precheck 挂点（'address'=宣告竞态；null=非 precheck fail）
 * @param {number|null} ageMinutes - 代币年龄（分钟；fire 因子 age，缺=null）
 * @returns {boolean} 是否登记叙事否决短路
 */
function shouldBlockOnNarrative(numericRating, precheckStage, ageMinutes) {
  if (numericRating !== 1) return false;
  if (precheckStage === 'address' && ageMinutes !== null && ageMinutes * 60 < PRECHECK_FAIL_RETRY_WINDOW_SEC) {
    return false; // 宣告竞态重试窗内：豁免（等 PrecheckFailRetryService 重析翻正）
  }
  return true;
}

class NarrativeDirectCaller {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.memoryCacheResults=false] - 结果内存缓存（回测专属
   *   opt-in，bc4f756e 性能案 2026-09-28；live 构造点不传 → 行为零变化）。
   *   只缓存终态 PASS（rating∈{2,3} 且非 precheck-fail 重试域形状），命中返回
   *   浅拷贝（fromMemoryCache=true 观测标记），消除 token_narrative 表 DB 往返
   *   （暖缓存下每次直调仍 ~70ms roundtrip）。rating=1 不缓存——其重复消耗由
   *   引擎侧叙事否决拉黑承担（互补不重叠）；9/超时/错误不缓存保留重试。
   *   缓存命中不短路调用方链路（龙头检查/pre-buy 随 checkTime 演化，由调用方自理）
   */
  constructor(options = {}) {
    this._Analyzer = null;
    /** tokenAddress(小写) → 底层 analyze promise（并发调用共享，settle 后移除） */
    this._inflight = new Map();
    this._memoryCacheResults = !!options.memoryCacheResults;
    /** tokenAddress(小写) → 已缓存 getRating 结果（终态 PASS 形状，见 constructor 注释） */
    this._resultCache = new Map();
  }

  /**
   * 惰性加载 ESM NarrativeAnalyzer 并缓存
   * @returns {Promise<Object>} NarrativeAnalyzer 类
   */
  async _getAnalyzer() {
    if (!this._Analyzer) {
      const mod = await import('../../narrative/analyzer/NarrativeAnalyzer.mjs');
      this._Analyzer = mod.NarrativeAnalyzer;
    }
    return this._Analyzer;
  }

  /**
   * 启动（或复用）一次底层叙事分析
   *
   * enrichSocialByGmgn=true（BRF 案，2026-09-27 用户裁定）：直调时点买门已 fire
   * （其他购买条件已满足），才允许元数据无社交链接的 token 调 GMGN 补语料入口
   * （付费配额控制——narrative engine 队列链路不传此开关，零调用）；
   * 且 no_public_info 拦截的缓存行穿透重析（空语料行已失真，见 NarrativeAnalyzer）
   * @private
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Object>} analyze 的结果 promise（不设超时，由调用方 race）
   */
  _startAnalysis(tokenAddress) {
    const key = tokenAddress.toLowerCase();
    let p = this._inflight.get(key);
    if (!p) {
      p = this._getAnalyzer()
        .then(Analyzer => Analyzer.analyze(tokenAddress, { enrichSocialByGmgn: true }));
      // settle 后移出 inflight；then 第二参承接 rejection 防 unhandled rejection
      const cleanup = () => this._inflight.delete(key);
      p.then(cleanup, cleanup);
      this._inflight.set(key, p);
    }
    return p;
  }

  /**
   * 从 analyze 结果的 classifiedUrls 提取源推文 id
   * 口径镜像 material-id-extractor 的 _extractFromTwitterTweets：先 status 再 communities，
   * 两者均为裸数字串 = experiment_tokens.narrative_material_id 的写入键（同叙事龙头检查用）
   * @private
   */
  _extractSourceTweetId(classifiedUrls) {
    try {
      for (const t of (classifiedUrls?.twitter || [])) {
        const m1 = String(t.url || '').match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i);
        if (m1) return m1[1];
        const m2 = String(t.url || '').match(/\/i\/communities\/(\d+)/i);
        if (m2) return m2[1];
      }
    } catch (_) { /* 提取失败按无源推文处理 */ }
    return null;
  }

  /**
   * 获取叙事评级（永不抛错）
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<{numericRating: number, rating: string, reason: string|null,
   *   fromCache: boolean, durationMs: number, timedOut: boolean, error: string|null,
   *   sourceTweetId: string|null, gmgnRisk: Object|null}>}
   *   numericRating ∈ {1=低, 2=中, 3=高, 9=未评级(未触发/失败/超时/null 归一)}
   *   sourceTweetId：analyze 三条返回路径顶层均带 classifiedUrls，从 twitter 桶提取；
   *   超时/异常/无推文语料 → null（下游同叙事龙头检查因子按 0 放行）
   *   gmgnRisk：GMGN dev 风险字段（x-0 案——直调语境 analyze 内同次 getTokenInfo
   *   带出发币史/捆绑钱包统计；超时/异常/未索引 → null，下游 gmgnRiskCovered=0
   *   放行——宁漏拦不误杀）
   *   precheckStage：precheck 挂点（'address'=宣告竞态，叙事否决短路豁免判据）
   */
  async getRating(tokenAddress) {
    const cacheKey = tokenAddress.toLowerCase();
    // 内存缓存命中（回测 opt-in）：浅拷贝 + 观测标记；durationMs 归 0（本次零开销）
    if (this._memoryCacheResults) {
      const cached = this._resultCache.get(cacheKey);
      if (cached) {
        this._memoryCacheHits = (this._memoryCacheHits || 0) + 1;
        return { ...cached, fromMemoryCache: true, durationMs: 0 };
      }
    }
    const startedAt = Date.now();
    try {
      let timer = null;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(
          new Error(`叙事分析直调超时(${DIRECT_CALL_TIMEOUT_MS}ms)`),
          { code: TIMEOUT_CODE },
        )), DIRECT_CALL_TIMEOUT_MS);
      });
      const result = await Promise.race([
        this._startAnalysis(tokenAddress),
        timeout,
      ]).finally(() => clearTimeout(timer));

      const ratingResult = {
        numericRating: [1, 2, 3].includes(result?.numericRating) ? result.numericRating : 9,
        rating: result?.rating ?? 'unrated',
        reason: result?.reason ?? null,
        fromCache: !!result?.meta?.fromCache,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        error: null,
        sourceTweetId: this._extractSourceTweetId(result?.classifiedUrls),
        gmgnRisk: result?.gmgnRisk ?? null,
        // precheck 挂点（实时/缓存两路径 preCheck 均展开行内 details）——'address'
        // = 宣告竞态形状（PrecheckFailRetryService 重试域），引擎侧叙事否决短路的
        // 豁免判据；非 precheck fail / 超时 / 异常 → null
        precheckStage: result?.llmAnalysis?.preCheck?.details?.validationStage ?? null,
      };
      if (this._memoryCacheResults && this._isCacheableRatingResult(ratingResult)) {
        this._resultCache.set(cacheKey, ratingResult);
      }
      return ratingResult;
    } catch (error) {
      return {
        numericRating: 9,
        rating: 'unrated',
        reason: null,
        fromCache: false,
        durationMs: Date.now() - startedAt,
        timedOut: error?.code === TIMEOUT_CODE,
        error: error?.message || String(error),
        sourceTweetId: null,
        gmgnRisk: null,
        precheckStage: null,
      };
    }
  }

  /** 内存缓存命中计数（性能探针，回放收尾汇总用；未启用恒 0） */
  getMemoryCacheHits() {
    return this._memoryCacheHits || 0;
  }

  /**
   * 缓存谓词：只缓存终态 PASS 形状（rating∈{2,3} 且非 precheck-fail 重试域）
   *
   * - rating=1 不缓存：重复消耗由引擎侧叙事否决拉黑承担（P0 互补，不重叠）
   * - 9 / 超时 / 错误 不缓存：保留后续 fire 重试语义
   * - precheckStage 非 null（任意 precheck-fail 形状）不缓存：重试域（address 300s /
   *   no_public_info 1800s）内 PrecheckFailRetryService 重析可翻正，冻结即失真
   * @private
   * @param {Object} r - getRating 成功路径构造的结果对象
   * @returns {boolean}
   */
  _isCacheableRatingResult(r) {
    if (r.timedOut || r.error) return false;
    if (r.numericRating !== 2 && r.numericRating !== 3) return false;
    if (r.precheckStage != null) return false;
    return true;
  }
}

/**
 * 语料推文时间解析（早晚票分级，0fed29f9 案 2026-10-08）
 * twitter created_at 形如 "Sun Oct 04 09:00:06 +0000 2026"（Date.parse 可直接解析）
 * @param {string|null} s - 推文 created_at
 * @returns {number|null} 毫秒时间戳；空/不可解析 → null
 */
function parseTwitterTs(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

/**
 * 从 analyze 结果的 twitter 字段提取语料最早推文时间（主推/父推取更早）
 * 早晚票分级的「事件锚」：narrativeCorpusLagSec = token 出生锚 − corpusTs
 * @param {Object|null} twitter - analyze 返回的 twitterInfo（tweet 型含 created_at；
 *   account/community 型/无推文语料 → null = 无事件锚）
 * @returns {number|null} 毫秒时间戳；null = 无推文语料（下游按晚票 fail-closed）
 */
function extractCorpusTs(twitter) {
  const candidates = [twitter?.created_at, twitter?.in_reply_to?.created_at]
    .map(parseTwitterTs)
    .filter(v => typeof v === 'number');
  if (!candidates.length) return null;
  return Math.min(...candidates);
}

/**
 * GMGN 风险字段 → preBuyCheckCondition 因子（x-0 案，2026-09-27）
 * 交易引擎/回测两路径共用映射，单点维护：
 * - gmgnIssuerTokenCount：推特维度发币总数（serial issuer 核心信号——链上 EOA 每
 *   次换新绕过链上 creator 检测，推特归因暴露真实发币史；null→0）
 * - gmgnBundlerWalletRatio：捆绑钱包占比 = bundler_wallets/top_wallets ×100，
 *   保留 1 位小数（x-0：35/46=76.1%；分母不可得→0）
 * - gmgnRiskCovered：1=GMGN 查到（上两因子可信），0=未触发/失败/未索引——
 *   放行值语义（宁漏拦不误杀，与净流入因子 covered 同方向）
 * @param {Object|null} risk - analyze 返回的 gmgnRisk（null=未查到）
 * @returns {{gmgnIssuerTokenCount: number, gmgnBundlerWalletRatio: number, gmgnRiskCovered: number}}
 */
function mapGmgnRiskFactors(risk) {
  return {
    gmgnIssuerTokenCount: typeof risk?.issuerTokenCount === 'number' ? risk.issuerTokenCount : 0,
    gmgnBundlerWalletRatio: (risk && typeof risk.bundlerWallets === 'number'
      && typeof risk.topWallets === 'number' && risk.topWallets > 0)
      ? Math.round(risk.bundlerWallets / risk.topWallets * 1000) / 10
      : 0,
    gmgnRiskCovered: risk ? 1 : 0,
  };
}

module.exports = { NarrativeDirectCaller, mapGmgnRiskFactors, shouldBlockOnNarrative };
