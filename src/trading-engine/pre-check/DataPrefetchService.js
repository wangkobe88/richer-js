'use strict';

/**
 * DataPrefetchService —— 数据预取门（发现期推文 + vision 预取，2026-10-15 立项）
 *
 * 背景（YOYO号案 0xa16c…7777，v16 live）：fire 零延迟，但 fire→tx 上链 10.4s 中
 * 叙事直调占 8.95s（vision 6.24s + 语料抓取前置 2.4s）。语料补采在入池 ~2.3s 就
 * 拿到宣告推文 URL，「等 buyVolumeBnb 证据」的 3-7s 窗口是天然空闲——tick 买腿
 * 分支按条件表达式（FA 因子表，与 N3 narrativePrefetch 同上下文）评估热度门，
 * 过门即后台预取：宣告推文（TwitterFetcher.fetchFromUrl，URL 级 DB 缓存）→ 有图
 * 则 vision 分析（analyzeTweetImage，同图缓存 + 版本失效）。fire 时叙事直调命中
 * 同一缓存，fetch/vision 段塌缩至缓存读。Jev/GMGN 决策类调用刻意不预取（结果
 * 时效性短、由 fire 时点直调）。
 *
 * 幂等性由被调侧保证：fetchFromUrl / analyzeTweetImage 各自带 DB 缓存 + inflight
 * 去重，预取与直调并发也无重复计费。预取只对 status URL 发起——账号 URL 的时间线
 * 是动态语料（预取收益低），且 fetchFromUrl 对非 status URL 提不出 tweet_id 会
 * return null 并 markFailed 一条 1h 冷却行（污染缓存行）；账号语料留给直调的
 * 账号分支正常处理。
 *
 * write-once per-token 无论成败（失败时 fire 直调走全链自兜底）；条件不满足不标
 * 记，后续 tick 满足再发起（N3 同款语义）。未知因子 → evaluateCondition
 * fail-closed false → 永不发起（安全方向；引擎启动校验 + 创建 route 400 兜底）。
 *
 * 仅实时引擎（virtual+live）接线；BacktestEngine 不嵌（回测有自己的
 * preloadCache 预载机制，且预取是纯 API 优化无回测语义）。
 */
class DataPrefetchService {
  /**
   * @param {Object} params
   * @param {string} params.condition 热度门条件表达式（语法同策略 condition；FA 因子集）
   * @param {Function} params.evaluate (cond, factors) => boolean——引擎注入
   *   strategyEngine.evaluateCondition（fail-closed false）
   * @param {Function} params.fetchersProvider async () => ({fetchTweet(url),
   *   analyzeImage(twitterInfo)})——引擎侧 dynamic import 包装叙事 ESM；单测注桩
   * @param {Object} params.logger 引擎 logger（info/warn）
   * @param {string} [params.experimentId]
   */
  constructor({ condition, evaluate, fetchersProvider, logger, experimentId = null }) {
    if (typeof condition !== 'string' || condition.trim() === '') {
      // enabled 却没配条件：宁可拒启也不静默全量预取（配置错误必须显性失败）
      throw new Error('dataPrefetch.enabled=true 但 condition 未配置——热度门条件必填');
    }
    if (typeof evaluate !== 'function') throw new Error('DataPrefetchService: evaluate 注入缺失');
    if (typeof fetchersProvider !== 'function') throw new Error('DataPrefetchService: fetchersProvider 注入缺失');
    this._condition = condition.trim();
    this._evaluate = evaluate;
    this._fetchersProvider = fetchersProvider;
    this._logger = logger || null;
    this._experimentId = experimentId;
    this._done = new Set();  // write-once per-token（无论成败；失败由 fire 直调全链兜底）
  }

  /** 本 token 是否已处理过（write-once 状态，引擎热路径早退用） */
  isDone(tokenAddress) {
    return this._done.has(tokenAddress);
  }

  /**
   * tick 买腿分支入口（同步返回是否发起；预取本体后台 fire-and-forget）。
   * 语料 miss 由引擎侧先判（_tokenCorpusMap，补采未完成时不进这里）。
   * @param {string} tokenAddress
   * @param {Object} factors 本 tick FA 因子表（与 fire 评估同源）
   * @param {Object} corpus 语料补采结果（corpusFields：twitterUrl/webUrl/description…）
   * @returns {boolean} 本次是否发起了后台预取
   */
  maybePrefetch(tokenAddress, factors, corpus) {
    if (this._done.has(tokenAddress)) return false;
    if (!corpus || typeof corpus.twitterUrl !== 'string' || corpus.twitterUrl.trim() === '') {
      return false;  // 无推文 URL：不发起不标记（语料字段补齐由补采一次性完成，此处实际不会变）
    }
    if (!this._isStatusUrl(corpus.twitterUrl)) {
      // 账号型 URL：刻意跳过并标记（时间线动态语料收益低 + fetchFromUrl 会 markFailed
      // 污染冷却行）；账号语料由 fire 直调的账号分支正常拉取
      this._done.add(tokenAddress);
      this._log('info', `${tokenAddress.slice(0, 10)} 语料为账号 URL，跳过预取`);
      return false;
    }
    if (!this._evaluate(this._condition, factors)) return false;  // 门未过：不标记，后续 tick 可再触发
    this._done.add(tokenAddress);
    const ageSec = factors.tokenAgeSec != null ? Math.round(factors.tokenAgeSec) : null;
    this._log('info', `${tokenAddress.slice(0, 10)} 预取门过（tokenAge≈${ageSec != null ? `${ageSec}s` : '?'}）后台发起`);
    const startedAt = Date.now();
    this._prefetch(tokenAddress, corpus.twitterUrl, startedAt)
      .catch(e => this._log('warn', `${tokenAddress.slice(0, 10)} 预取失败（fire 直调走全链自兜底）: ${e.message}`));
    return true;
  }

  /**
   * 预取本体：推文 →（有图）vision。全部走缓存健全链路，重复执行零重复计费。
   * @private
   */
  async _prefetch(tokenAddress, twitterUrl, startedAt) {
    const fetchers = await this._fetchersProvider();
    const twitterInfo = await fetchers.fetchTweet(twitterUrl);
    if (!twitterInfo) {
      this._log('info', `${tokenAddress.slice(0, 10)} 推文预取 null（删除/受保护/黑名单/失败），结束 ${Math.round(Date.now() - startedAt)}ms`);
      return;
    }
    const imageUrl = twitterInfo && twitterInfo.media && twitterInfo.media.images
      && twitterInfo.media.images[0] && twitterInfo.media.images[0].url;
    if (!imageUrl) {
      this._log('info', `${tokenAddress.slice(0, 10)} 推文预取完成（无图跳过 vision）${Math.round(Date.now() - startedAt)}ms`);
      return;
    }
    await fetchers.analyzeImage(twitterInfo);
    this._log('info', `${tokenAddress.slice(0, 10)} 预取完成 | 推文+vision 共 ${Math.round(Date.now() - startedAt)}ms`);
  }

  /** status 推文 URL 判定（与 fetchFromUrls 内 websiteUrl 分流同口径；账号 URL 无 /status 段） */
  _isStatusUrl(url) {
    return url.includes('/status');
  }

  _log(level, msg) {
    if (!this._logger) return;
    const fn = this._logger[level] || this._logger.info;
    fn.call(this._logger, this._experimentId, 'DataPrefetch', msg);
  }
}

module.exports = { DataPrefetchService };
