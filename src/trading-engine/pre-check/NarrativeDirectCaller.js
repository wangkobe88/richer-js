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
    /**
     * token_narrative 预载行缓存（回测叙事预载 2026-10-12）：小写地址 → 行快照，
     * 经 preload() 批量拉取灌入、_startAnalysis 透传给 analyze({rowCache})——
     * 命中路径的 findByAddress DB 往返由此消除。null = 未预载（实时链路原行为）
     */
    this._rowCache = null;
    /**
     * analyze options 透传集（vision 预启动，2026-10-13 叙事提速第二批）：引擎构造点
     * 经 analyzeOptions 注入（如 { visionPrefetch: true }），_startAnalysis 原样展开进
     * analyze options——开关语义与默认值在 analyze 侧定义；不传 = 空对象 = analyze
     * 全默认（worker / web routes / 回测零变化）
     */
    this._analyzeOptions = options.analyzeOptions || {};
    /**
     * 直调计时子计数器（P1 探针 2026-10-12 回测性能案）：getRating 三条路径
     * （内存缓存命中/成功/超时异常）累计调用数与耗时，回放收尾与主循环六段
     * 分布一起打印——advance 段减直调/preBuy ≈ 策略评估+执行
     */
    this._totalCalls = 0;
    this._totalDurationMs = 0;
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
   * 叙事结果预载（回测专属，2026-10-12 性能案）：装载阶段按窗口 token 集合批量拉
   * token_narrative 缓存行（+语料推文缓存行）灌内存层——否则回放中每 token 首次
   * 直调走 analyze 缓存命中路径 = 2 次 DB 往返 ≈34ms 串行（e50 实测 4007 次命中
   * =137s）。行为零变化：预载行 = 命中路径会原样返回的行，组装代码不变只换数据源
   *
   * @param {string[]} tokenAddresses - 回测窗口 token 集合
   * @returns {Promise<{rowCache: Map, tweetRows: number}>} 预载统计（行数/推文行数）
   */
  async preload(tokenAddresses) {
    const Analyzer = await this._getAnalyzer();
    const r = await Analyzer.preloadCache(tokenAddresses);
    this._rowCache = r.rowCache;
    return r;
  }

  /**
   * 启动（或复用）一次底层叙事分析
   *
   * enrichSocialByGmgn=true（BRF 案，2026-09-27 用户裁定）：直调时点买门已 fire
   * （其他购买条件已满足），才允许元数据无社交链接的 token 调 GMGN 补语料入口
   * （付费配额控制——narrative engine 队列链路不传此开关，零调用）；
   * 且 no_public_info 拦截的缓存行穿透重析（空语料行已失真，见 NarrativeAnalyzer）
   *
   * N1 探针（2026-10-13 叙事提速案）：timingSink（调用方创建的数组）经 options._timing
   * 传入 analyze 分段填充；inflight 复用时后到 join 者共享首发的同一数组引用
   * （数组按引用共享，settle 后读取即已填充，无需结果对象透传）
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {Array} timingSink - 分段计时收集数组（N1 探针）
   * @returns {{ promise: Promise<Object>, timing: Array }} analyze 的结果 promise
   *   （不设超时，由调用方 race）+ 其 timing 数组
   */
  _startAnalysis(tokenAddress, timingSink) {
    const key = tokenAddress.toLowerCase();
    let entry = this._inflight.get(key);
    if (!entry) {
      const promise = this._getAnalyzer()
        .then(Analyzer => Analyzer.analyze(tokenAddress, {
          enrichSocialByGmgn: true,
          // 预载行透传（回测叙事预载 2026-10-12）：命中 → analyze 跳过 findByAddress；
          // null/无键 → 现场 DB 查原路径
          rowCache: this._rowCache || undefined,
          // 直调语境跳过中段 save（N2 叙事提速案 2026-10-13）：无前端轮询，
          // 字段由最终 save / fallback 补 save 落库，省一次 DB 往返
          skipIntermediateSave: true,
          // 引擎级 analyze options 透传（vision 预启动等；后展开覆盖同键默认，
          // 未配置键零影响——构造点注入集合见 constructor._analyzeOptions 注释）
          ...this._analyzeOptions,
          _timing: timingSink,
        }));
      entry = { promise, timing: timingSink };
      // settle 后移出 inflight；then 第二参承接 rejection 防 unhandled rejection
      const cleanup = () => this._inflight.delete(key);
      promise.then(cleanup, cleanup);
      this._inflight.set(key, entry);
    }
    return entry;
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
   *   corpusTs：语料最早推文时间 ms（主推/父推取更早；0fed29f9 案 2026-10-08 早晚票
   *   分级事件锚）；null = 无推文语料/超时/异常（下游 narrativeCorpusLagSec=null
   *   → null 比较恒 false → 落晚票严格门，fail-closed）
   *   precheckStage：precheck 挂点（'address'=宣告竞态，叙事否决短路豁免判据）
   *   timing：分段计时快照 [{seg, ms}]（N1 探针 2026-10-13 叙事提速案；analyze 全链
   *     ipfs、gmgn、fetch.<platform>、accountCollect、precheck、jev.*、dbSave.* 段）；
   *     fromCache 命中只含 cacheLookup/reassemble；超时/异常 → null（数组此刻不完整）
   */
  async getRating(tokenAddress) {
    const cacheKey = tokenAddress.toLowerCase();
    // 直调计时子计数器（P1 探针）：三条 return 路径都累计
    this._totalCalls++;
    // 内存缓存命中（回测 opt-in）：浅拷贝 + 观测标记；durationMs 归 0（本次零开销）
    if (this._memoryCacheResults) {
      const cached = this._resultCache.get(cacheKey);
      if (cached) {
        this._memoryCacheHits = (this._memoryCacheHits || 0) + 1;
        return { ...cached, fromMemoryCache: true, durationMs: 0 };
      }
    }
    const startedAt = Date.now();
    // N1 探针：本调用的分段计时数组（数组按引用传给 analyze，settle 后即已填充；
    // inflight join 时共享首发的数组）
    const timingSink = [];
    try {
      let timer = null;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(
          new Error(`叙事分析直调超时(${DIRECT_CALL_TIMEOUT_MS}ms)`),
          { code: TIMEOUT_CODE },
        )), DIRECT_CALL_TIMEOUT_MS);
      });
      const entry = this._startAnalysis(tokenAddress, timingSink);
      const result = await Promise.race([
        entry.promise,
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
        // 分段计时快照（N1 探针）：fromCache 命中路径只含 cacheLookup/reassemble 段
        timing: entry.timing.slice(),
        sourceTweetId: this._extractSourceTweetId(result?.classifiedUrls),
        gmgnRisk: result?.gmgnRisk ?? null,
        // 语料最早推文时间（主推/父推取更早；三条 return 路径顶层均带 twitter 字段）：
        // 早晚票分级的事件锚；null = 无推文语料（account 型/无 twitterUrl/超时/异常）
        corpusTs: extractCorpusTs(result?.twitter),
        // precheck 挂点（实时/缓存两路径 preCheck 均展开行内 details）——'address'
        // = 宣告竞态形状（PrecheckFailRetryService 重试域），引擎侧叙事否决短路的
        // 豁免判据；非 precheck fail / 超时 / 异常 → null
        precheckStage: result?.llmAnalysis?.preCheck?.details?.validationStage ?? null,
      };
      if (this._memoryCacheResults && this._isCacheableRatingResult(ratingResult)) {
        this._resultCache.set(cacheKey, ratingResult);
      }
      this._totalDurationMs += ratingResult.durationMs;
      // P8 计时拆分（2026-10-13 perf9 定因：6073 次 miss 贡献全部 179s，avg 29.5ms
      // ——dbCache=analyze 内 token_narrative 行命中（应≈preload 后纯内存），真跑=
      // 数据抓取+Jev 全链；两计数把 miss 耗时归到正确一侧）
      if (result?.meta?.fromCache) this._dbCacheHits = (this._dbCacheHits || 0) + 1;
      else this._realRuns = (this._realRuns || 0) + 1;
      return ratingResult;
    } catch (error) {
      this._totalDurationMs += Date.now() - startedAt;
      return {
        numericRating: 9,
        rating: 'unrated',
        reason: null,
        fromCache: false,
        durationMs: Date.now() - startedAt,
        timedOut: error?.code === TIMEOUT_CODE,
        error: error?.message || String(error),
        // 超时/异常不带分段计时：底层 analyze 多半仍在后台跑，数组此刻不完整
        timing: null,
        sourceTweetId: null,
        gmgnRisk: null,
        corpusTs: null,
        precheckStage: null,
      };
    }
  }

  /** 内存缓存命中计数（性能探针，回放收尾汇总用；未启用恒 0） */
  getMemoryCacheHits() {
    return this._memoryCacheHits || 0;
  }

  /** 直调计时子计数器（P1 探针 2026-10-12 回测性能案，回放收尾汇总用） */
  getCallStats() {
    return {
      calls: this._totalCalls || 0, ms: this._totalDurationMs || 0,
      // P8 miss 拆分：dbCache=analyze 缓存行命中 / realRun=数据抓取+Jev 真跑
      dbCacheHits: this._dbCacheHits || 0, realRuns: this._realRuns || 0,
    };
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

module.exports = { NarrativeDirectCaller, mapGmgnRiskFactors, shouldBlockOnNarrative, extractCorpusTs, parseTwitterTs };
