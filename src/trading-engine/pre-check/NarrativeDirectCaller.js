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

class NarrativeDirectCaller {
  constructor() {
    this._Analyzer = null;
    /** tokenAddress(小写) → 底层 analyze promise（并发调用共享，settle 后移除） */
    this._inflight = new Map();
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
   */
  async getRating(tokenAddress) {
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

      return {
        numericRating: [1, 2, 3].includes(result?.numericRating) ? result.numericRating : 9,
        rating: result?.rating ?? 'unrated',
        reason: result?.reason ?? null,
        fromCache: !!result?.meta?.fromCache,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        error: null,
        sourceTweetId: this._extractSourceTweetId(result?.classifiedUrls),
        gmgnRisk: result?.gmgnRisk ?? null,
      };
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
      };
    }
  }
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

module.exports = { NarrativeDirectCaller, mapGmgnRiskFactors };
