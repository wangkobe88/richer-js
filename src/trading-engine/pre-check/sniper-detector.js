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
    // P11 探针（2026-10-13 perf11 后定因）：earlyMs 里「六族因子纯 CPU」的归因
    // 未经实测——flagsFor 是计算段唯一 await，若 miss 面大则 DB roundtrip 才是
    // 大头。queryMs=查询墙钟 / batches=批次数（批 100）/ queriedAddrs=进过
    // miss 集的地址数（含重复计入当次 missing）/ failures=查询失败次数
    this._queryMs = 0;
    this._queryBatches = 0;
    this._queriedAddrs = 0;
    this._queryFailures = 0;
    // P12 全表预载（2026-10-13 perf12 探针定因）：queryMs 52428ms = earlySvc 的
    // 96.5%（1626 批 / 5072 址 ≈ 32ms/批纯 RTT 堆积，纯 CPU 段仅 ~1.2s）。回测
    // 启动期全表 SELECT 一次灌 boolean 缓存（表仅数千行，画像几天一更），
    // 运行期 miss 集归零。_fullyLoaded 后 flagsFor 的 miss 直判 false——全表已
    // 进缓存，miss = 不在表 = 无行 = isSniperProfile(null) = false，与现查返回
    // 空行 set(addr,false) bit 一致，仅省 RTT。预载失败不设标志（fail-open
    // 运行期现查，行为同未优化）
    this._fullyLoaded = false;
    this._preloadedRows = 0;
  }

  /** 缓存条数（测试探针） */
  get size() {
    return this._flags.size;
  }

  /** P11 查询探针（回放收尾经 EarlyParticipantCheckService.getPerfStats 打印） */
  getStats() {
    return {
      queryMs: this._queryMs,
      batches: this._queryBatches,
      queriedAddrs: this._queriedAddrs,
      failures: this._queryFailures,
      cached: this._flags.size,
      fullyLoaded: this._fullyLoaded,
      preloadedRows: this._preloadedRows,
    };
  }

  /**
   * 全表预载（P12，回测启动期一次性；实时引擎不注入）。cursor 分页形状对齐
   * TPA preloadOfflineProfiles 先例：.gt(address)+order+limit，仅空页终止
   * （中间页 timeout 截断返部分行不误 break，lastAddress 续传到真正末尾）。
   * 成功置 _fullyLoaded；失败 throw（调用方 fail-open）。中途失败已写入的行
   * 保留——皆为真实表行判定值，与运行期查到 bit 相同。
   * @param {Object} supabase - Supabase客户端（null 时不预载不设标志）
   * @returns {Promise<{rows: number, ms: number}>}
   */
  async preloadAll(supabase) {
    if (!supabase) return { rows: 0, ms: 0 };
    const t0 = Date.now();
    const PAGE = 1000;
    let lastAddress = null;
    let rows = 0;
    for (;;) {
      let q = supabase.from('wallet_offline_profiles')
        .select('address, profile').order('address').limit(PAGE);
      if (lastAddress) q = q.gt('address', lastAddress);
      const { data, error } = await q;
      if (error) throw new Error(`预载 wallet_offline_profiles 失败: ${error.message}`);
      for (const r of data || []) {
        if (r && r.address) {
          this._flags.set(String(r.address).toLowerCase(), isSniperProfile(r.profile || null));
          rows++;
        }
      }
      if (!data || data.length === 0) break;
      lastAddress = data[data.length - 1].address;
    }
    this._fullyLoaded = true;
    this._preloadedRows = rows;
    return { rows, ms: Date.now() - t0 };
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

    // P12 全表预载后短路：miss = 不在表（全表已进缓存）→ 非 sniper。与现查
    // 返回空行后 set(addr,false) bit 一致，仅省 RTT（零查询零计数）
    if (this._fullyLoaded) {
      for (const addr of missing) {
        this._flags.set(addr, false);
        out.set(addr, false);
      }
      return out;
    }

    if (!supabase) {
      this._warn('Supabase 客户端未注入，sniper 画像查询跳过（全按非 sniper 放行）');
      for (const addr of missing) out.set(addr, false);
      return out;
    }

    const _t0 = Date.now();
    try {
      // 批 100（TPA _fetchOfflineProfileBatch 同款；地址小写与库存储一致）
      for (let i = 0; i < missing.length; i += 100) {
        const batch = missing.slice(i, i + 100);
        this._queryBatches++;
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
      this._queryFailures++;
      this._warn('sniper 画像查询失败，本次全按非 sniper 放行（不写缓存）', { error: this._errMsg(e) });
      for (const addr of missing) out.set(addr, false);
      return out;
    } finally {
      // P11 探针：成功/失败两路径都计时（失败路径同样消耗墙钟）
      this._queryMs += Date.now() - _t0;
      this._queriedAddrs += missing.length;
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
