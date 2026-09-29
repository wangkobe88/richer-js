/**
 * sniper 钱包判定与画像加载（虚假流动性防线，显化之歌案 2026-09-29）
 *
 * 用户裁定：sniper 不打标签（wallets 表方案已否决回滚），运行时条件判断纯函数；
 * 衍生「sniper 持仓比例」因子拦截 sniper 聚集票（防线分工：作弊票 TPA /
 * sniper 聚集票 sniperPct / uniformBuyCluster 已弃用——因子保留计算不被策略引用）。
 *
 * 判定标准（数据依据：全库 10862 画像 tokenCount [50,100)→[100,200) 从 146 跌到
 * 43 的天然断崖；全库命中 62）：
 * - 主判：tokenCount >= 100 AND medianHoldSeconds ∈ [0, 300)——高频广撒网 + 5 分钟内闪进闪出
 * - 补判：tokenCount >= 100 AND medianHoldSeconds == null AND sym < 0.1 AND 笔数 >= 40
 *   ——卖出配对不上（全是闪进闪出）且买卖笔数近对称（对倒特征）；sym = |buy−sell|/(buy+sell)
 * - 排除：medianHoldSeconds >= 300 一律不命中（库存调仓/CEX 热钱包）
 *
 * 画像来源：wallet_offline_profiles.profile（step4 预计算，几天一更）；画像 miss =
 * 非 sniper（表 threshold 3，低频钱包不进表是常态）。查询走注入的 supabase client
 * （两引擎均传 dbManager.getClient() service key——anon 会被 RLS 静默过滤）。
 *
 * 与 wallet-scorer._isSniperLike（tokenCount>=300，TPA 的"豁免大户判定"机器人检测）
 * 语义不同、阈值独立，勿混。
 */

/** 协议地址排除清单（内盘官方做市/归集地址，非市场参与者） */
const PROTOCOL_ADDRS = new Set([
  '0x000006b7be706cdb1e5a43c9fd974c0000000091', // four.meme 内盘官方
]);

/**
 * sniper 条件判断（纯函数，不落库）
 * @param {Object|null} profile - wallet_offline_profiles.profile JSON（null/miss = 非 sniper）
 * @returns {boolean}
 */
function isSniperProfile(profile) {
  if (!profile) return false;
  // Number() 归一：非数值脏 tokenCount 走 NaN<100 恒 false 会跳过 tc 门误判狙击手
  const tc = Number(profile.tokenCount) || 0;
  if (tc < 100) return false;
  const hold = profile.medianHoldSeconds;
  if (hold != null) return hold >= 0 && hold < 300;
  const buy = profile.buyCount || 0;
  const sell = profile.sellCount || 0;
  const total = buy + sell;
  if (total === 0) return false;
  const sym = Math.abs(buy - sell) / total;
  return sym < 0.1 && total >= 40;
}

/**
 * sniper 标志实例级缓存（EarlyParticipantCheckService 持有一个实例）
 *
 * 缓存 Map<addr(lower), boolean>，miss（画像行不存在）也缓存为 false——画像
 * 几天一更、sniper 判定特征（tc/hold）是长周期统计，进程生命周期内不复查
 * （重启刷新；回测多 signal 复用同批高频钱包，命中率极高——bc4f756e 性能口径）。
 * 查询失败 fail-open：本次全按非 sniper 放行且不写缓存（瞬时错误不固化为永久 false）。
 */
class SniperFlagCache {
  /**
   * @param {Object} logger - Logger实例（warn 出口）
   */
  constructor(logger) {
    this.logger = logger;
    this._flags = new Map();
  }

  /** 缓存条数（测试探针） */
  get size() {
    return this._flags.size;
  }

  /**
   * 批量取 sniper 标志
   * @param {Object} supabase - Supabase客户端（null 时全按非 sniper 放行，不缓存）
   * @param {string[]} addresses - 钱包地址数组（大小写任意，内部统一小写）
   * @returns {Promise<Map<string, boolean>>} addr(lower) → isSniper
   */
  async flagsFor(supabase, addresses) {
    const out = new Map();
    const missing = [];
    for (const a of addresses) {
      const key = String(a).toLowerCase();
      const cached = this._flags.get(key);
      if (cached !== undefined) {
        out.set(key, cached);
      } else {
        missing.push(key);
      }
    }
    if (missing.length === 0) return out;

    if (!supabase) {
      this._warn('Supabase 客户端未注入，sniper 画像查询跳过（全按非 sniper 放行）');
      for (const addr of missing) out.set(addr, false);
      return out;
    }

    try {
      // 批 100（TPA _fetchOfflineProfileBatch 同款；地址小写与库存储一致）
      for (let i = 0; i < missing.length; i += 100) {
        const batch = missing.slice(i, i + 100);
        const { data, error } = await supabase
          .from('wallet_offline_profiles')
          .select('address, profile')
          .in('address', batch);
        if (error) throw new Error(`查询 wallet_offline_profiles 失败: ${error.message}`);
        const byAddr = new Map();
        for (const row of data || []) {
          byAddr.set(String(row.address).toLowerCase(), row.profile);
        }
        for (const addr of batch) {
          const flag = isSniperProfile(byAddr.get(addr) || null);
          this._flags.set(addr, flag);
          out.set(addr, flag);
        }
      }
      return out;
    } catch (e) {
      this._warn('sniper 画像查询失败，本次全按非 sniper 放行（不写缓存）', { error: this._errMsg(e) });
      for (const addr of missing) out.set(addr, false);
      return out;
    }
  }

  _warn(msg, meta = {}) {
    if (this.logger && typeof this.logger.warn === 'function') {
      this.logger.warn(`[SniperFlagCache] ${msg}`, meta);
    } else {
      console.warn(`[SniperFlagCache] ${msg}`, meta);
    }
  }

  _errMsg(e) {
    return e && e.message ? e.message : String(e);
  }
}

module.exports = { isSniperProfile, SniperFlagCache, PROTOCOL_ADDRS };
