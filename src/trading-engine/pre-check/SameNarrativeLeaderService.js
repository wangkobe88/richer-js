/**
 * 同叙事龙头已火检查服务（narrativeLeaderHot 因子）
 *
 * 用户裁定（2026-09-24，嫦娥系列数据分析后）：
 * - 不要求代币是叙事首发（首发无优势——嫦娥案例首发峰值仅 1.5x，第 6 个反而 12.2x）；
 * - 但同叙事（依托同一源推文）下若已有代币"火了"，其余代币买入不通过。
 *
 * 口径：
 * - 同叙事 = 同源推文：experiment_tokens.narrative_material_id（推文语料=裸数字串：
 *   tweet status id 或 community id，两者 eq 兼容）精确匹配，不限代币名——
 *   与叙事 pre-check 规则 0.5/0.55/0.58（均要求同名）互补，"天鹏"型同推文不同名仿盘只有本规则能抓
 * - "火了" = 候选代币自首笔达标 tick 起、截至买入判定时刻 t 的峰值涨幅
 *   max(price_bnb)/first(price_bnb) >= 5x（尘门：price_outlier=false 服务端 +
 *   bnbAmount>=MIN_PRICE_UPDATE_BNB 客户端，首价与峰值同门——防尘 tick 假首价，且倍数偏保守不误杀）
 * - 拒绝窗口 = 龙头首达 5x 时刻起 24h 内（多龙头任一命中即 hot）
 * - 严格事前语义：涨幅只算 block_time <= t 的 ticks，无未来函数，回测可复算
 *   （回测候选集来自当前 material_id 映射，属既有叙事直调同类的已知穿越，涨幅计算本身无前视）
 * - 候选不做 discovered_at 时间过滤：创建晚于 t 的候选 [首tick, t] 窗口自然为空不火，
 *   由 tick 窗口本身做时间过滤（避免 discovered_at 异常值漏龙头）
 *
 * 失败语义（fail-open 漏拦方向，不误杀）：无 tweet id / 查询异常 / 候选单查失败
 * → 因子全 0 放行，异常记录在 detail/日志（不掩盖问题）。
 */

const { MIN_PRICE_UPDATE_BNB } = require('../../../scripts/shared/classifier-constants');

const DEFAULT_CONFIG = {
  hotMultipleThreshold: 5,      // 火门槛（倍数）
  rejectWindowSeconds: 86400,   // 龙头首达火门槛后拒绝窗口（24h）
  maxCandidates: 50,            // 去重后候选上限（discovered_at 最早优先——龙头几乎必在最早一批）
  candidateQueryLimit: 500,     // 行级查询上限（含跨实验重复行）
  tickPageSize: 2000,           // ticks 分页大小
  maxTickPages: 3,              // 页数上限：首达 5x 几乎必然在头几页（拉升在早期），截断只影响 maxMultiple 观测精度
  candidateConcurrency: 5,      // 候选间并发拉取上限
};

class SameNarrativeLeaderService {
  /**
   * @param {Object} supabase - Supabase 客户端（dbManager.getClient()）
   * @param {Object} logger - 日志记录器
   * @param {Object} config - 覆盖 DEFAULT_CONFIG
   */
  constructor(supabase, logger, config = {}) {
    this.supabase = supabase;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 执行同叙事龙头检查（永不抛错）
   * @param {Object} params
   * @param {string} params.tokenAddress - 当前代币地址
   * @param {string} params.sourceTweetId - 源推文 id（narrative_material_id 同口径裸数字串）
   * @param {number} params.checkTimeSec - 判定时刻（Unix 秒；实时=wall clock，回测=回放时点）
   * @returns {Promise<{success: boolean, factors: {narrativeLeaderHot: number,
   *   narrativeLeaderCount: number, narrativeLeaderMaxMultiple: number}, detail: Object}>}
   */
  async check({ tokenAddress, sourceTweetId, checkTimeSec }) {
    const startedAt = Date.now();
    try {
      if (!tokenAddress || !sourceTweetId || !/^\d+$/.test(String(sourceTweetId)) || !checkTimeSec) {
        return this.getEmptyFactors('no_source_tweet');
      }

      // 1. 候选查询：同 material_id、排除自身，跨实验行客户端去重（表无 (exp,token) 唯一约束）
      const { data: rows, error: queryError } = await this.supabase
        .from('experiment_tokens')
        .select('token_address, token_symbol, discovered_at')
        .eq('narrative_material_id', String(sourceTweetId))
        .neq('token_address', String(tokenAddress).toLowerCase())
        .order('discovered_at', { ascending: true })
        .limit(this.config.candidateQueryLimit);

      if (queryError) {
        throw new Error(`候选查询失败: ${queryError.message}`);
      }

      const byAddr = new Map();
      for (const r of (rows || [])) {
        const key = String(r.token_address).toLowerCase();
        if (!byAddr.has(key)) byAddr.set(key, r); // 保 earliest discovered_at（已升序）
      }
      const candidates = [...byAddr.entries()].slice(0, this.config.maxCandidates)
        .map(([addr, r]) => ({ address: addr, symbol: r.token_symbol || '' }));

      const candidateErrors = [];
      const leaders = [];
      let truncated = false;
      let maxMultiple = 0;

      // 2. 并发池逐候选算峰值（<=5 并发）
      for (let i = 0; i < candidates.length; i += this.config.candidateConcurrency) {
        const batch = candidates.slice(i, i + this.config.candidateConcurrency);
        const results = await Promise.all(batch.map(c => this._evalCandidate(c, checkTimeSec)));
        for (let j = 0; j < results.length; j++) {
          const res = results[j];
          if (!res.success) { candidateErrors.push({ address: batch[j].address, error: res.error }); continue; }
          if (res.truncated) truncated = true;
          if (res.peakMultiple > maxMultiple) maxMultiple = res.peakMultiple;
          // leaders 记录所有达标候选（无论窗口内），观测用
          if (res.firstReachAt) {
            leaders.push({
              tokenAddress: batch[j].address,
              symbol: batch[j].symbol,
              firstTickAt: res.firstTickAt,
              firstReachAt: res.firstReachAt,
              peakMultiple: Number(res.peakMultiple.toFixed(1)),
              inWindow: res.inWindow ? 1 : 0,
            });
          }
        }
      }

      const hot = leaders.some(l => l.inWindow === 1) ? 1 : 0;
      const detail = {
        sourceTweetId: String(sourceTweetId),
        durationMs: Date.now() - startedAt,
        error: null,
        truncated,
        leaders,
        candidateErrors,
      };
      this.logger.info('[SameNarrativeLeaderService] 同叙事龙头检查完成', {
        token: String(tokenAddress).slice(0, 10),
        tweet: String(sourceTweetId),
        hot, count: candidates.length,
        maxMultiple: Number(maxMultiple.toFixed(1)),
        leaders: leaders.length,
        durationMs: detail.durationMs,
        ...(truncated ? { truncated: true } : {}),
        ...(candidateErrors.length ? { candidateErrors: candidateErrors.length } : {}),
      });
      return {
        success: true,
        factors: {
          narrativeLeaderHot: hot,
          narrativeLeaderCount: candidates.length,
          narrativeLeaderMaxMultiple: Number(maxMultiple.toFixed(1)),
        },
        detail,
      };
    } catch (error) {
      const detail = {
        sourceTweetId: sourceTweetId ? String(sourceTweetId) : null,
        durationMs: Date.now() - startedAt,
        error: error.message,
        truncated: false,
        leaders: [],
        candidateErrors: [],
      };
      this.logger.error('[SameNarrativeLeaderService] 同叙事龙头检查异常(fail-open)', {
        token: tokenAddress, error: error.message,
      });
      return { success: false, factors: this.getEmptyFactors('check_error').factors, detail };
    }
  }

  /**
   * 单候选峰值评估：分页拉 [首达标tick, t] 窗口，running first/max/firstReach
   * @private
   */
  async _evalCandidate(candidate, checkTimeSec) {
    const toIso = new Date(checkTimeSec * 1000).toISOString();
    const threshold = this.config.hotMultipleThreshold;
    try {
      let firstPrice = null;      // 首个达标 tick 的 price_bnb
      let firstTickAt = null;     // 首个达标 tick 的 block_time
      let maxPrice = 0;           // 窗口内峰值（达标门下）
      let firstReachAt = null;    // 首次 price >= threshold*firstPrice 的 block_time
      let truncated = false;

      for (let page = 0; page < this.config.maxTickPages; page++) {
        const off = page * this.config.tickPageSize;
        const { data: ticks, error } = await this.supabase
          .from('wss_price_ticks')
          .select('price_bnb, bnb_amount, block_time')
          .eq('token_address', candidate.address)
          .eq('price_outlier', false)
          .lte('block_time', toIso)
          .order('block_time', { ascending: true })
          .order('log_index', { ascending: true })
          .range(off, off + this.config.tickPageSize - 1);

        if (error) {
          return { success: false, error: `tick 查询失败: ${error.message}` };
        }
        if (!ticks || ticks.length === 0) break;

        for (const t of ticks) {
          const price = Number(t.price_bnb);
          const bnbAmount = Number(t.bnb_amount);
          // 尘门：与首价同门（price_outlier 服务端 + 金额门客户端）
          if (!(price > 0) || !(bnbAmount >= MIN_PRICE_UPDATE_BNB)) continue;
          if (firstPrice === null) {
            firstPrice = price;
            firstTickAt = t.block_time;
            maxPrice = price;
            continue;
          }
          if (price > maxPrice) maxPrice = price;
          if (!firstReachAt && firstPrice > 0 && price >= threshold * firstPrice) {
            firstReachAt = t.block_time; // 升序流中的首个达标时刻
          }
        }

        // 首达后本页扫描完即可提前收工（后续页只影响 maxMultiple 观测精度）
        if (firstReachAt) break;
        if (ticks.length < this.config.tickPageSize) break; // 末页
        if (page === this.config.maxTickPages - 1) truncated = true; // 页上限耗尽仍未首达
      }

      const peakMultiple = (firstPrice !== null && firstPrice > 0) ? maxPrice / firstPrice : 0;
      // inWindow：首达过火门槛 且 判定时刻在首达后 24h 拒绝窗口内
      const inWindow = firstReachAt
        ? (checkTimeSec * 1000 - new Date(firstReachAt).getTime()) <= this.config.rejectWindowSeconds * 1000
        : false;

      return {
        success: true,
        firstTickAt,
        firstReachAt,
        peakMultiple,
        inWindow,
        truncated,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 空/失败因子（fail-open：全 0 放行，原因落 detail）
   */
  getEmptyFactors(reason = null) {
    return {
      success: false,
      factors: {
        narrativeLeaderHot: 0,
        narrativeLeaderCount: 0,
        narrativeLeaderMaxMultiple: 0,
      },
      detail: { reason, error: reason },
    };
  }
}

module.exports = { SameNarrativeLeaderService };
