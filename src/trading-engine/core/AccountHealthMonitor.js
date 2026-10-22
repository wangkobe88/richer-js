/**
 * 账号信息复检服务（C166 账号删号/删推卖臂，2026-10-22 用户裁定）
 *
 * 背景：一次性专号 rug 家族案（SL 0x58417f3f…affff / FOURGE 0xf9de0ca2…ffff，
 * 2026-10-21/22）买入后 3 分钟内同块协同砸盘 -56%——价格止损永远吃残值，账号
 * 删除/宣告推删除是比价格更早的 rug 前兆。用户裁定：持仓期间定期请求宣告账号
 * 信息，检测「账号被删 / 推文被删光」→ 因子（issuerAccountState）→ 卖臂全清。
 *
 * 检测语义（四态）：
 * - 'deleted'    账号被删/停封——apidance 空响应骨架形状（new-apis.js C53 分支：
 *                user.result 在而 core/legacy 全空 → throw「用户不存在（apidance
 *                空响应骨架…）」）。★与 API 故障结构性区分：网络抖动/超时/HTTP 错误
 *                走「用户信息获取失败」/「HTTP错误」分支，不会误判删号
 * - 'tweets_gone' 宣告推被删（getTweetDetail 返回 tweets.length===0，或返回了别
 *                的推文——tweets[0] 宽松兜底坑，必须严格 tweet_id 全等比对）；
 *                或账号在但 statuses_count===0（推文清零——成功返回即 screen_name
 *                非空（空 stub 已在 deleted 分支 throw），宣告过推文的账号 statuses
 *                必 >0，===0 是强信号）
 * - 'active'     账号在且推文非零
 * - 'unknown'    超时/网络失败/API 故障——fail-open 不置信号（保留上次确定值不回拨）
 *
 * 红线：裸调 new-apis.js（getUserByScreenName/getTweetDetail），**绝不走
 * TwitterFetcher/CachedFetcher**——缓存层失败写 1h 冷却行会把删号/删推信号吞掉
 * （复检要新鲜数据，且失败冷却对「查证消失」语义有害）。与叙事侧语料抓取缓存
 * 刻意隔离（那边 30d/6h maxAge 对存活检测完全失真）。
 *
 * 节流由引擎层做（per-token 持仓时长双档）；本服务管 per-handle 去重：
 * 短 TTL 结果缓存（多票同宣告账号合一次请求）+ inflight join + 连续失败退避
 * （防打爆 apidance；GmgnRiskCheckService 同款组织）。
 */

const ACCOUNT_GONE_MESSAGE = /用户不存在|空响应骨架/;   // new-apis.js getUserByScreenName C53 删号分支
const TWEET_NOT_FOUND_MESSAGE = /推文详情获取失败/;       // new-apis.js getTweetDetail tweets.length===0 分支

const DEFAULTS = {
  timeoutMs: 15000,      // 单次复检竞速超时（两层 apidance 调用最坏 10s + 余量；竞速超时归 unknown）
  cacheTtlMs: 30000,     // per-handle 结果复用窗（高频档同周期，多票同账号去重）
  failCooldownMs: 60000, // 连续失败退避窗（冷却期内不打网直接 unknown）
  maxConsecutiveFails: 3,
};

class AccountHealthMonitor {
  /**
   * @param {Object} [config] - fourmemeWs.accountHealthCheck 段（flap 实验经 _mergedWsConfig 同键）
   * @param {Object} [logger] - 引擎 logger（可缺省）
   */
  constructor(config = {}, logger = null) {
    const num = (v, d) => (Number.isFinite(v) && v > 0 ? v : d);
    const sec = (v, d) => num(num(v, d / 1000) * 1000, d); // 秒配置 → ms（非法/≤0 回默认）
    this._timeoutMs = num(config.timeoutMs, DEFAULTS.timeoutMs);
    this._cacheTtlMs = sec(config.cacheTtlSec, DEFAULTS.cacheTtlMs);
    this._failCooldownMs = sec(config.failCooldownSec, DEFAULTS.failCooldownMs);
    this._maxFails = Number.isInteger(config.maxConsecutiveFails) && config.maxConsecutiveFails > 0
      ? config.maxConsecutiveFails : DEFAULTS.maxConsecutiveFails;
    this._logger = logger;
    this._cache = new Map();    // handleKey → { at, result }
    this._inflight = new Map(); // handleKey → Promise
    this._fails = new Map();    // handleKey → 连续失败计数
  }

  /**
   * 复检一个宣告账号。不抛错——一切失败归 'unknown'（fail-open：不置卖臂信号）。
   * @param {{handle: string, announceTweetId?: string|null}} target
   * @returns {Promise<{state: 'active'|'deleted'|'tweets_gone'|'unknown',
   *   detail: string, checkedAt: number, fromCache: boolean, durationMs: number}>}
   */
  async checkAccount({ handle, announceTweetId = null }) {
    const key = String(handle || '').toLowerCase();
    if (!key) {
      return { state: 'unknown', detail: 'no_handle', checkedAt: Date.now(), fromCache: false, durationMs: 0 };
    }
    const startedAt = Date.now();

    // TTL 内结果复用（含 unknown——同周期多票同账号不重打）
    const cached = this._cache.get(key);
    if (cached && (startedAt - cached.at) < this._cacheTtlMs) {
      return { ...cached.result, durationMs: startedAt - cached.at, fromCache: true };
    }
    // 连续失败退避期内不打网（防打爆 apidance；到期放行重试）
    if ((this._fails.get(key) || 0) >= this._maxFails
        && (startedAt - (this._cache.get(key)?.at ?? 0)) < this._failCooldownMs) {
      return { state: 'unknown', detail: 'fail_backoff', checkedAt: startedAt, fromCache: false, durationMs: 0 };
    }

    // inflight join：同 handle 并发复检合一次请求
    const existing = this._inflight.get(key);
    if (existing) return existing;

    const p = this._probe(key, String(announceTweetId || ''), startedAt)
      .finally(() => this._inflight.delete(key));
    this._inflight.set(key, p);
    return p;
  }

  /** 真打网 + 形状判定（竞速超时归 unknown；底层晚到仍写缓存供下轮命中）。 */
  async _probe(key, announceTweetId, startedAt) {
    // 惰性 require：单测先污染 require cache 再加载本模块即可打桩 twitter-validation
    const { getUserByScreenName, getTweetDetail } = require('../../utils/twitter-validation/new-apis');

    const withTimeout = (promise) => Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), this._timeoutMs)),
    ]);

    // ── 第一层：账号存活 ──
    let userInfo = null;
    try {
      userInfo = await withTimeout(getUserByScreenName(key));
      if (userInfo && userInfo.__timeout) {
        return this._settle(key, 'unknown', 'user_info_timeout', startedAt);
      }
    } catch (e) {
      const msg = String(e?.message || e);
      // 删号形状只认 C53 空骨架分支的 message——HTTP/网络/超时走其它分支不误判
      if (ACCOUNT_GONE_MESSAGE.test(msg)) {
        return this._settle(key, 'deleted', 'account_gone', startedAt);
      }
      return this._settle(key, 'unknown', `user_info_error: ${msg}`, startedAt);
    }

    // ── 第二层：推文清零（账号在但 statuses_count===0）──
    if (userInfo.statuses_count === 0) {
      return this._settle(key, 'tweets_gone', 'statuses_zero', startedAt);
    }

    // ── 第三层：宣告推存活（有宣告推 id 才查；账号型票无宣告推到 active 为止）──
    if (announceTweetId) {
      try {
        const tweet = await withTimeout(getTweetDetail(announceTweetId));
        if (tweet && tweet.__timeout) {
          return this._settle(key, 'unknown', 'tweet_detail_timeout', startedAt);
        }
        // ★严格全等比对：getTweetDetail 对 ID 不匹配有「取第一条并警告」宽松兜底
        //（new-apis.js :311-320），不比对=把别的推文当宣告推在场的证据
        if (String(tweet?.tweet_id || '') !== announceTweetId) {
          return this._settle(key, 'tweets_gone', 'announce_tweet_id_mismatch', startedAt);
        }
      } catch (e) {
        const msg = String(e?.message || e);
        if (TWEET_NOT_FOUND_MESSAGE.test(msg)) {
          return this._settle(key, 'tweets_gone', 'announce_tweet_not_found', startedAt);
        }
        return this._settle(key, 'unknown', `tweet_detail_error: ${msg}`, startedAt);
      }
    }

    return this._settle(key, 'active', 'ok', startedAt);
  }

  /** 结果落缓存 + 连续失败计数维护。 */
  _settle(key, state, detail, startedAt) {
    const result = { state, detail, checkedAt: Date.now(), fromCache: false, durationMs: Date.now() - startedAt };
    this._cache.set(key, { at: Date.now(), result });
    if (state === 'unknown') {
      this._fails.set(key, (this._fails.get(key) || 0) + 1);
    } else {
      this._fails.delete(key); // 拿到确定形状即清退避计数
    }
    if (state !== 'active' && this._logger) {
      this._logger.warn('account-health', 'AccountHealthMonitor',
        `⚠️ 宣告账号异常状态: @${key} → ${state}（${detail}）`);
    }
    return result;
  }

  /** 引擎 stop 释放（无定时器资源，清缓存即可；实例随引擎丢弃）。 */
  destroy() {
    this._cache.clear();
    this._inflight.clear();
    this._fails.clear();
  }
}

module.exports = { AccountHealthMonitor, ACCOUNT_GONE_MESSAGE, TWEET_NOT_FOUND_MESSAGE };
