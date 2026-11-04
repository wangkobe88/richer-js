/**
 * GMGN 进场验证服务（T116 卖臂，2026-11-04 用户裁定）
 *
 * 用户原话：「如果持仓 3 分钟，调用一下 GMGN API，无聪明钱/鲸鱼/KOL 进场，
 * 就全部卖出」——持仓 holdSec 检查点查一次 GMGN getTokenInfo 的
 * wallet_tags_stat，三类标签钱包（smart_wallets 聪明钱 / whale_wallets 鲸鱼 /
 * renowned_wallets KOL）**当前在场数**任一 >0 = 有聪明钱接力（entered），
 * 全零 = 无人接力（none）→ 卖臂全清。
 *
 * 探针实证（2026-11-04 scripts/tmp-gmgn-entry-probe.cjs，0.3-1.0min 票 6 枚）：
 * GMGN 索引近乎实时（18 秒大的票 wallet_tags_stat 已完整填充），三键一次调用
 * 全带出——3 分钟检查点数据必然已 populate，无「退化为无脑全清」风险。
 *
 * 「在场口径」语义自洽论证：聪明钱若在 3 分钟内进出后离场 → 计 0 → 卖——
 * 聪明钱已经跑路的票本来也是该卖的形状；三分类殊途同归，holders-stat 一次
 * 调用即可（top_traders tag 过滤口径多烧配额且「进过已走」形状同样该卖）。
 *
 * 与买侧 GmgnRiskCheckService 刻意隔离（同款组织不同实例）：
 * - 买侧有 per-token 5s TTL 复用（同 token 连续 fire 合并）——本侧 per 持仓轮
 *   检查恰一次（引擎 state map write-once），无 TTL 复用语义；
 * - 保留 inflight join（同 token 并发合一次）+ 失败冷却（防 API 故障期连环烧）；
 * - **只认自己 fetch 的结果**（不读叙事缓存/不回写，新鲜度与买侧同判）。
 *
 * fail-open（与买侧 2026-10-20 裁定同向）：失败/超时/未索引/key 缺失/tags 形状
 * 残缺 → state='unknown' 引擎不投影（因子 null → 卖臂恒 false 不误卖），
 * 下轮扫描按 retryIntervalSec 重试——API 不可用不得把「查不到」变成「全清仓」。
 *
 * 回测零接线（引擎不挂 BacktestEngine）：动态网络数据对历史 fire 是时序穿越
 * （C166 accountHealthCheck / gwp 同款裁定）。
 */

'use strict';

const DEFAULTS = {
  timeoutMs: 8000,       // GMGN 单调超时（买侧实测 ~1.6s，留余量）
  failCooldownMs: 60000, // 失败后冷却窗（冷却期内 unknown 直接返回不重打）
};

class GmgnEntryCheckService {
    /**
     * @param {Object} [config] - fourmemeWs.gmgnEntryCheck 段（flap 实验经 _mergedWsConfig 同键）
     */
    constructor(config = {}) {
        this._timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
            ? config.timeoutMs : DEFAULTS.timeoutMs;
        this._failCooldownMs = Number.isFinite(config.failCooldownMs) && config.failCooldownMs >= 0
            ? config.failCooldownMs : DEFAULTS.failCooldownMs;
        this._fails = new Map();     // tokenKey → { at }（失败冷却判据；成功即删）
        this._inflight = new Map();  // tokenKey → Promise（并发 join）
    }

    /**
     * 检查一个 token 的聪明钱/鲸鱼/KOL 进场状态。不抛错——一切失败形状归一为
     * state='unknown'（fail-open：引擎不投影，不误卖）。
     * @param {string} tokenAddress
     * @param {string} [chain='bsc'] - BSC-only 项目，恒 'bsc'
     * @returns {Promise<{state: 'entered'|'none'|'unknown',
     *   smartWallets: number|null, whaleWallets: number|null,
     *   renownedWallets: number|null, topWallets: number|null,
     *   checkedAt: number, durationMs: number, fromCache: boolean,
     *   failReason: string|null}>}
     */
    async checkEntry(tokenAddress, chain = 'bsc') {
        const tokenKey = `${chain}:${String(tokenAddress || '').toLowerCase()}`;
        const startedAt = Date.now();

        // 失败冷却期内不重打（防连环烧配额；到期放行重试）
        const fail = this._fails.get(tokenKey);
        if (fail && (startedAt - fail.at) < this._failCooldownMs) {
            return this._unknown('cooldown', startedAt);
        }

        // inflight join：同 token 并发检查合一次请求
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
            result = this._unknown('no_api_key', startedAt);
        } else {
            try {
                // 惰性 require（GmgnRiskCheckService 同款）：① 单测先污染 require cache
                //   再加载本模块即可打桩 GMGNTokenAPI；② 未配置时零加载（不触发代理链）
                const { GMGNTokenAPI } = require('../../core/gmgn-api');
                const api = new GMGNTokenAPI({ apiKey, timeout: this._timeoutMs });
                const info = await api.getTokenInfo(chain, tokenAddress);
                result = this._classify(info, startedAt);
            } catch (e) {
                result = this._unknown(`error: ${e?.message || e}`, startedAt);
            }
        }

        if (result.state === 'unknown') {
            this._fails.set(tokenKey, { at: Date.now() });
        } else {
            this._fails.delete(tokenKey); // 拿到确定形状即清冷却
        }
        return result;
    }

    /** GMGN getTokenInfo 响应 → 三态判定（纯函数，单测直调）。 */
    _classify(info, startedAt) {
        const checkedAt = Date.now();
        const durationMs = checkedAt - startedAt;
        if (!info) return this._unknown('not_indexed', startedAt);
        const tags = info.wallet_tags_stat;
        if (!tags || typeof tags !== 'object') {
            return this._unknown('tags_missing', startedAt);
        }
        const smart = tags.smart_wallets;
        const whale = tags.whale_wallets;
        const renowned = tags.renowned_wallets;
        // 三键任一非有限数=形状残缺 → unknown fail-open（缺失键当 0 会有「查不到
        // 当作零进场」的误卖方向，宁可不判定）
        if (![smart, whale, renowned].every(v => typeof v === 'number' && Number.isFinite(v))) {
            return this._unknown('tags_malformed', startedAt);
        }
        const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        const entered = (smart + whale + renowned) > 0;
        return {
            state: entered ? 'entered' : 'none',
            smartWallets: smart, whaleWallets: whale, renownedWallets: renowned,
            topWallets: num(tags.top_wallets),
            checkedAt, durationMs, fromCache: false, failReason: null,
        };
    }

    _unknown(failReason, startedAt) {
        return {
            state: 'unknown', smartWallets: null, whaleWallets: null,
            renownedWallets: null, topWallets: null,
            checkedAt: Date.now(), durationMs: Date.now() - startedAt,
            fromCache: false, failReason,
        };
    }

    /** 引擎 stop 释放（无定时器资源，清缓存即可；实例随引擎丢弃）。 */
    destroy() {
        this._fails.clear();
        this._inflight.clear();
    }
}

module.exports = { GmgnEntryCheckService };
