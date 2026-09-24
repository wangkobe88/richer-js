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
   * @private
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Object>} analyze 的结果 promise（不设超时，由调用方 race）
   */
  _startAnalysis(tokenAddress) {
    const key = tokenAddress.toLowerCase();
    let p = this._inflight.get(key);
    if (!p) {
      p = this._getAnalyzer()
        .then(Analyzer => Analyzer.analyze(tokenAddress));
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
   *   sourceTweetId: string|null}>}
   *   numericRating ∈ {1=低, 2=中, 3=高, 9=未评级(未触发/失败/超时/null 归一)}
   *   sourceTweetId：analyze 三条返回路径顶层均带 classifiedUrls，从 twitter 桶提取；
   *   超时/异常/无推文语料 → null（下游同叙事龙头检查因子按 0 放行）
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
      };
    }
  }
}

module.exports = { NarrativeDirectCaller };
