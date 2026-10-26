/**
 * GMGN 钱包画像统计层（2026-10-18 GMGN wallet_stats 调研接入，Agentum/Konasu/7777 sybil 案）
 *
 * 架构（用户裁定=离线建库优先）：`gmgn_wallet_profiles` 表（全局 PK，离线脚本
 * build-gmgn-wallet-profiles.cjs 批量回填）为 fire 时刻主数据源（PK 查询毫秒级）；
 * 触发窗内后台增量回写补 miss；fire 时刻 miss 轻量补查（≤refetchBudget，inflight
 * join ≤missJoinMs）——绝不逐钱包实时 API 作为主路径。
 *
 * 因子（gwp* 前缀，避开 TPA「钱包画像」命名）从 fire 时刻首窗 top-N 买家的
 * 跨盘画像聚合，全部簇状指纹（单钱包标签无判别力——Konasu 对倒 creator 挂
 * smart_degen 正面标签的反例）：
 *   - 同窗创建簇（created_at，滑动窗 createdWinSec——Agentum 簇 B 差 61s 跨分钟
 *     边界，固定分钟桶漏）
 *   - 镜像行为统计（buy/sell/token_num 三元组；精确臂+容差臂——Konasu 707/707/710
 *     与 Agentum 7/7/24~25 精确等都不命中、容差臂都命中）
 *   - 资金同源簇（fund_from_address；团伙刻意分散入金时不可靠=辅助观察）
 *   - young/fresh 簇（created_at 龄/ fresh_wallet 标签；簇状双门槛，单钱包永不拦）
 *   - gwpGmgnUserPct 纯渗透率观察（永不进门）
 *
 * fail-closed：gwpCovered ∈ {null,0,1}——selected=0（early 窗已冻结/无买家）→
 * null 放行（IS NULL 臂，C85 narrativeCategory 同款）；任何钱包无结论（补查失败/
 * 预算耗尽/全局冷却）→ 0（Phase 2 门生效后=拒，「不确定就不买」与 GMGN token 层
 * 同语义）；全部有结论（含「GMGN 无记录」的空数据行）→ 1。
 *
 * 与 GmgnRiskCheckService 刻意分离：本层 gwp 键走表达式臂（gwpCovered==1 前置由
 * 条件串表达），不受 token 层 fail-open（2026-10-20 乌龟案 429 拒买裁定）影响——
 * gwpCovered=0 在条件串内仍恒 false；gwp 是否随 token 层一并 fail-open 待用户裁定。
 */

const { ConditionEvaluator } = require('../../strategies/ConditionEvaluator');

// gwp* 因子键集（gmgnCheckCondition 可引用；非 token-api 产物——由本服务从钱包画像聚合）
const GWP_FACTOR_KEYS = [
  'gwpCovered', 'gwpSelected', 'gwpProfiled', 'gwpFailed',
  'gwpCreatedClusterWallets', 'gwpCreatedClusterBnbPct',
  'gwpMirrorClusterWallets', 'gwpNearMirrorClusterWallets',
  'gwpFundSrcClusterWallets',
  'gwpYoungCount', 'gwpYoungBnbPct',
  'gwpFreshCount', 'gwpFreshBnbPct',
  'gwpMinWalletAgeDays', 'gwpGmgnUserPct',
  'gwpLeadMs', 'gwpJoinMs', 'gwpRefetchCount',
];

const DEFAULTS = {
  topWallets: 5,          // fire 时刻取首窗 top-N 买家
  minBuyBnb: 0.01,        // top-N 入选尘埃门（尘埃拆单规避由提高门槛应对）
  tableTtlMs: 6 * 3600 * 1000, // 内存行复用窗（超窗回表读 fresh 行）
  missJoinMs: 1500,       // fire miss 补查等待上界（常态 0=表/内存命中）
  refetchBudget: 2,       // fire 时刻单次评估最多补查 API 次数
  dailyBudget: 2000,      // 进程级 API 日预算（UTC 日；耗尽→covered=0 fail-closed）
  fetchTimeoutMs: 5000,   // 单钱包 API 超时
  failCooldownMs: 10000,  // per-wallet 失败冷却（冷却内该钱包=无结论→covered=0）
  globalCooldownMs: 60000,// 连续失败/限流全局冷却（全部钱包=无结论）
  prefetchMinAgeSec: 25,  // 触发窗预取下界（首批买家成形前的 top-N 无意义）
  prefetchIntervalMs: 500,// per-token 预取检查节流
  youngMaxAgeDays: 7,     // young 钱包龄门（created_at 锚，不依赖 fresh 标签——标签滞后）
  createdWinSec: 300,     // 创建簇滑动窗（Agentum B 差 61s；固定分钟桶漏跨边界）
  mirrorBuyRelTol: 0.01,  // 近镜像 buy/sell 相对容差（Konasu 707 vs 710 = 0.42%）
  mirrorTokRelTol: 0.10,  // 近镜像 token_num 相对容差（Agentum 24 vs 25 ≈ 4.2%）
  mirrorMinBuy: 5,        // 近镜像最低 buy 计数（低频钱包三元组撞型是噪音）
};

const SELECT_COLS = 'address,tags,created_at_sec,fund_from_address,buy_7d,sell_7d,token_num_7d,winrate,last_active_sec,native_balance_bnb,fetched_at,fetch_count';

/** 表行 → 内存画像（缺列宽容归一；GMGN 无记录的行=空画像有效行） */
function rowToProfile(row) {
  const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
  return {
    address: String(row.address || '').toLowerCase(),
    tags,
    createdAtSec: Number.isFinite(Number(row.created_at_sec)) ? Number(row.created_at_sec) : null,
    fundFrom: row.fund_from_address ? String(row.fund_from_address).toLowerCase() : null,
    buy7d: Number.isFinite(Number(row.buy_7d)) ? Number(row.buy_7d) : null,
    sell7d: Number.isFinite(Number(row.sell_7d)) ? Number(row.sell_7d) : null,
    tokenNum7d: Number.isFinite(Number(row.token_num_7d)) ? Number(row.token_num_7d) : null,
    fetchedAtMs: row.fetched_at ? Date.parse(row.fetched_at) : 0,
  };
}

/** GMGN wallet_stats 返回 → 画像（字段路径按 182 实测：common.tags/common.created_at/…） */
function apiToProfile(address, data) {
  const common = data && typeof data === 'object' ? (data.common || {}) : {};
  const pnl = data && typeof data === 'object' ? (data.pnl_stat || {}) : {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    address: String(address).toLowerCase(),
    tags: Array.isArray(common.tags) ? common.tags.map(String) : [],
    createdAtSec: num(common.created_at),
    fundFrom: common.fund_from_address ? String(common.fund_from_address).toLowerCase() : null,
    buy7d: num(data?.buy),
    sell7d: num(data?.sell),
    tokenNum7d: num(pnl.token_num),
    fetchedAtMs: Date.now(),
  };
}

class GmgnWalletStatsService {
  /**
   * @param {Object} [config] - fourmemeWs.gmgnWalletStats 段（flap 实验经 _mergedWsConfig 同键）
   * @param {Object} [logger] - 引擎 logger（可缺省）
   */
  constructor(config = {}, logger = null) {
    this._c = { ...DEFAULTS, ...config };
    this._logger = logger;
    this._mem = new Map();          // address → {profile, at}（进程内缓存；API 确认「无记录」
                                    //   的空画像行也进此 Map 并落表——表 miss ≠ 无记录，须 API 确认）
    this._failed = new Map();       // address → at（拉取失败冷却）
    this._inflight = new Map();     // address → Promise
    this._globalCooldownUntil = 0;  // 连续失败全局冷却
    this._consecutiveFails = 0;
    this._dailyDay = null;          // UTC 日键
    this._dailyCount = 0;           // API 日计数
    this._stats = { tableHits: 0, memHits: 0, apiFetches: 0, apiFails: 0, budgetRejects: 0 };
  }

  get stats() { return { ...this._stats }; }

  /**
   * 触发窗预取（引擎接线已随 T71 2026-10-26 删除——原数据口 FA.getEarlyTopBuyers 随
   * early 冻结窗族退役；本纯函数层保留，将来重启须换全史数据源并重新接线）：
   * 查 top-N miss 钱包后台拉取回写表+内存。不抛错不阻塞。
   * @param {Array<{wallet:string,bnb:number}>} topWallets - 钱包买入榜（调用方供）
   * @returns {Promise<{fetched:number, skipped:number}>}
   */
  async prefetchMiss(topWallets) {
    const entries = normalizeEntries(topWallets, this._c.topWallets, this._c.minBuyBnb);
    if (entries.length === 0) return { fetched: 0, skipped: 0 };
    const profiles = new Map(); const nc = [];
    await this._resolveBatch(entries.map(e => e.wallet), profiles, nc);
    let fetched = 0;
    for (const addr of nc) {
      // fire 前台预算优先：日预算余量 < refetchBudget 时预取让路（fire 补查保命）
      if (this._dailyRemaining() < this._c.refetchBudget) { this._stats.budgetRejects++; break; }
      try { await this._fetchOne(addr); fetched++; }
      catch (_) { /* _fetchOne 内部已记账，预取失败由 fire 兜底 */ }
    }
    return { fetched, skipped: nc.length - fetched };
  }

  /**
   * fire 时刻构建 gwp 因子（GMGN 层消费点）。
   * @param {Array<{wallet:string,bnb:number}>} topWallets
   * @param {Object} [opts] - { leadMs }（触发窗首次预取→fire 提前量，观测键）
   * @returns {Promise<Object>} gwp 18 键（selected=0 → gwpCovered=null 放行形状）
   */
  async buildFactors(topWallets, opts = {}) {
    const startedAt = Date.now();
    const entries = normalizeEntries(topWallets, this._c.topWallets, this._c.minBuyBnb);
    if (entries.length === 0) {
      // selected=0（early 窗冻结/无买家）：covered=null 放行形状，selected=有证据零值
      return { ...GmgnWalletStatsService.emptyFactors(), gwpSelected: 0, gwpLeadMs: finiteOrNull(opts.leadMs) };
    }
    // 内存/表/无结论集合解析；miss 钱包受 refetchBudget 限做前台补查（join ≤ missJoinMs）
    const profiles = new Map(); // 有效画像（含空数据行）
    const noConclusion = [];    // 既无画像也无结论的钱包
    await this._resolveBatch(entries.map(e => e.wallet), profiles, noConclusion);

    let refetch = 0;
    const joinees = noConclusion.splice(0, this._c.refetchBudget);
    if (joinees.length > 0 && this._canFetch()) {
      refetch = joinees.length;
      await Promise.race([
        Promise.all(joinees.map(a => this._fetchOne(a).catch(() => {}))),
        sleep(this._c.missJoinMs),
      ]);
      await this._resolveBatch(joinees, profiles, noConclusion);
    } else {
      // 预算耗尽/全局冷却：splice 出的放回（无结论→covered=0 fail-closed）
      noConclusion.unshift(...joinees);
    }
    // 补查后仍无结论的（预算外 miss/冷却/超时截断）留在 noConclusion → covered=0
    const factors = GmgnWalletStatsService.computeWalletProfileFactors(
      entries, profiles, this._c, Date.now());
    return {
      ...factors,
      gwpCovered: noConclusion.length === 0 ? 1 : 0,
      gwpSelected: entries.length,
      gwpProfiled: profiles.size,
      gwpFailed: noConclusion.length,
      gwpLeadMs: finiteOrNull(opts.leadMs),
      gwpJoinMs: Date.now() - startedAt,
      gwpRefetchCount: refetch,
    };
  }

  /** 回测/未启用形状：gwp 键全 null（IS NULL 臂放行，C85 narrativeCategory 同款） */
  static emptyFactors() {
    const out = {};
    for (const k of GWP_FACTOR_KEYS) out[k] = null;
    return out;
  }

  /** gmgnCheckCondition 可引用的 gwp 键集（loadStrategies/validateLegs 消费） */
  static getConditionFactorKeys() { return [...GWP_FACTOR_KEYS]; }

  /**
   * 簇指纹聚合（纯函数，单测核心）。
   * @param {Array<{wallet:string,bnb:number}>} entries - top-N（已归一小写）
   * @param {Map<string,Object>} profiles - 有效画像（miss 钱包不在内=不进任何分子分母）
   * @param {Object} opts - { youngMaxAgeDays, createdWinSec, mirrorBuyRelTol, mirrorTokRelTol, mirrorMinBuy }
   * @param {number} nowMs - 龄计算锚
   * @returns {Object} 簇键 14 个（covered/审计四键由调用方并）
   */
  static computeWalletProfileFactors(entries, profiles, opts, nowMs) {
    const o = {
      youngMaxAgeDays: opts.youngMaxAgeDays ?? DEFAULTS.youngMaxAgeDays,
      createdWinSec: opts.createdWinSec ?? DEFAULTS.createdWinSec,
      mirrorBuyRelTol: opts.mirrorBuyRelTol ?? DEFAULTS.mirrorBuyRelTol,
      mirrorTokRelTol: opts.mirrorTokRelTol ?? DEFAULTS.mirrorTokRelTol,
      mirrorMinBuy: opts.mirrorMinBuy ?? DEFAULTS.mirrorMinBuy,
    };
    const rows = entries
      .map(e => ({ bnb: e.bnb, p: profiles.get(e.wallet) }))
      .filter(r => r.p);
    const totalBnb = rows.reduce((s, r) => s + r.bnb, 0);
    const pct = (v) => (totalBnb > 0 ? parseFloat((v / totalBnb * 100).toFixed(1)) : 0);

    // ── 同窗创建簇（滑动窗：排序双指针；Agentum B 差 61s 跨分钟边界）──
    const born = rows.filter(r => r.p.createdAtSec != null)
      .map(r => ({ ts: r.p.createdAtSec, bnb: r.bnb }))
      .sort((a, b) => a.ts - b.ts);
    let cw = 0, cbnb = 0;
    for (let i = 0, j = 0; j < born.length; j++) {
      while (born[j].ts - born[i].ts > o.createdWinSec) i++;
      const n = j - i + 1, b = born.slice(i, j + 1).reduce((s, x) => s + x.bnb, 0);
      if (n > cw || (n === cw && b > cbnb)) { cw = n; cbnb = b; }
    }
    // 单钱包不成簇（<2 → 0；与 young/fresh 簇状双门槛同语义）
    const createdWallets = cw >= 2 ? cw : 0;
    const createdBnbPct = cw >= 2 ? pct(cbnb) : 0;

    // ── 镜像三元组（精确臂：全等；容差臂：排序链式相邻聚类）──
    const trip = rows.filter(r => r.p.buy7d != null && r.p.sell7d != null && r.p.tokenNum7d != null)
      .map(r => ({ b: r.p.buy7d, s: r.p.sell7d, t: r.p.tokenNum7d }));
    const key3 = (x) => `${x.b}|${x.s}|${x.t}`;
    const exact = new Map();
    for (const x of trip) exact.set(key3(x), (exact.get(key3(x)) || 0) + 1);
    let mirror = 0;
    for (const n of exact.values()) if (n >= 2 && n > mirror) mirror = n;

    const cand = trip.filter(x => x.b >= o.mirrorMinBuy).sort((a, b) => a.b - b.b);
    let near = 0;
    for (let i = 0; i < cand.length;) {
      let j = i + 1;
      while (j < cand.length
        && relDiff(cand[j].b, cand[j - 1].b) <= o.mirrorBuyRelTol
        && relDiff(cand[j].s, cand[j - 1].s) <= o.mirrorBuyRelTol
        && relDiff(cand[j].t, cand[j - 1].t) <= o.mirrorTokRelTol) j++;
      if (j - i > near) near = j - i;
      i = j;
    }
    if (near < 2) near = 0;

    // ── 资金同源簇（fund_from 相同；辅助观察键）──
    const ff = new Map();
    for (const r of rows) {
      if (!r.p.fundFrom) continue;
      ff.set(r.p.fundFrom, (ff.get(r.p.fundFrom) || 0) + 1);
    }
    let fundSrc = 0;
    for (const n of ff.values()) if (n >= 2 && n > fundSrc) fundSrc = n;

    // ── young（created_at 龄，不依赖 fresh 标签——标签滞后 4 天才打上）──
    const youngMs = o.youngMaxAgeDays * 86400 * 1000;
    let youngCount = 0, youngBnb = 0;
    let minAgeDays = null;
    for (const r of rows) {
      if (r.p.createdAtSec == null) continue;
      const age = nowMs - r.p.createdAtSec * 1000;
      if (minAgeDays === null || age / 86400000 < minAgeDays) minAgeDays = age / 86400000;
      if (age <= youngMs) { youngCount++; youngBnb += r.bnb; }
    }

    // ── fresh（fresh_wallet 标签；与 young 分开观察——口径滞后差异）──
    let freshCount = 0, freshBnb = 0;
    for (const r of rows) {
      if (r.p.tags.includes('fresh_wallet')) { freshCount++; freshBnb += r.bnb; }
    }

    // ── GMGN 用户渗透（纯观察，永不进门）──
    let gmgnBnb = 0;
    for (const r of rows) {
      if (r.p.tags.includes('gmgn') || r.p.tags.includes('gmgn_go')) gmgnBnb += r.bnb;
    }

    return {
      gwpCreatedClusterWallets: createdWallets,
      gwpCreatedClusterBnbPct: createdBnbPct,
      gwpMirrorClusterWallets: mirror,
      gwpNearMirrorClusterWallets: near,
      gwpFundSrcClusterWallets: fundSrc,
      gwpYoungCount: youngCount,
      gwpYoungBnbPct: pct(youngBnb),
      gwpFreshCount: freshCount,
      gwpFreshBnbPct: pct(freshBnb),
      gwpMinWalletAgeDays: minAgeDays === null ? null : parseFloat((minAgeDays).toFixed(1)),
      gwpGmgnUserPct: pct(gmgnBnb),
    };
  }

  // ───────────────────────── 内部：解析/拉取/表 ─────────────────────────

  /** 批量解析：内存 → 表 → 无结论。写 profiles（有效画像，含 API 确认的空数据行）/
   *  noConclusion（无结论钱包：表 miss 待 API 确认 / 失败冷却 / 全局冷却） */
  async _resolveBatch(addresses, profiles, noConclusion) {
    const pend = [];
    for (const addr of addresses) {
      if (profiles.has(addr)) continue;
      const m = this._mem.get(addr);
      if (m && Date.now() - m.at <= this._c.tableTtlMs) { this._stats.memHits++; profiles.set(addr, m.profile); continue; }
      if (!this._hasConclusion(addr)) { noConclusion.push(addr); continue; }
      pend.push(addr);
    }
    if (pend.length === 0) return;
    // 表 PK 批量 .in()（≤50/批——Supabase URL 8KB 上限红线）
    for (let i = 0; i < pend.length; i += 50) {
      const batch = pend.slice(i, i + 50);
      try {
        const client = this._client();
        const res = await client.from('gmgn_wallet_profiles').select(SELECT_COLS).in('address', batch);
        const byAddr = new Map((res.data || []).map(r => [String(r.address).toLowerCase(), r]));
        for (const addr of batch) {
          const row = byAddr.get(addr);
          if (row) {
            const p = rowToProfile(row);
            this._mem.set(addr, { profile: p, at: Date.now() });
            this._stats.tableHits++;
            profiles.set(addr, p);
          } else {
            // ★表 miss ≠ GMGN 无记录——只说明本进程/离线脚本没拉过；结论须 API 补查
            noConclusion.push(addr);
          }
        }
      } catch (e) {
        this._warn(`表读失败（全部按无结论处理→covered=0）: ${e?.message || e}`);
        for (const addr of batch) noConclusion.push(addr);
      }
    }
  }

  /** 拉取单个钱包（inflight join；成功写表+内存；失败记账冷却） */
  async _fetchOne(addr) {
    const existing = this._inflight.get(addr);
    if (existing) return existing;
    const p = this._fetchOneInner(addr).finally(() => this._inflight.delete(addr));
    this._inflight.set(addr, p);
    return p;
  }

  async _fetchOneInner(addr) {
    if (!this._canFetch()) throw new Error('fetch_unavailable');
    // per-wallet 失败冷却（前台补查 splice 前最后一道闸：冷却中重打既烧配额也打爆 GMGN）
    const failAt = this._failed.get(addr);
    if (failAt != null && Date.now() - failAt < this._c.failCooldownMs) throw new Error('wallet_fail_cooldown');
    this._countApi();
    this._stats.apiFetches++;
    const apiKey = process.env.GMGN_API_KEY;
    if (!apiKey) { this._markFail(addr); throw new Error('no_api_key'); }
    try {
      // 惰性 require（GmgnRiskCheckService 同款：单测打桩/未配置 GMGN 零加载）
      const { GMGNPortfolioAPI } = require('../../core/gmgn-api');
      const api = new GMGNPortfolioAPI({ apiKey, timeout: this._c.fetchTimeoutMs });
      const data = await api.getWalletStats('bsc', addr, '7d');
      this._consecutiveFails = 0;
      const profile = apiToProfile(addr, data);
      this._mem.set(addr, { profile, at: Date.now() });
      this._failed.delete(addr);
      // 空数据行（GMGN 无记录）也落表——下次表读即结论，全新钱包反复出现不重复烧配额
      this._writeRow(profile).catch(e => this._warn(`回写表失败（内存已可用）: ${e?.message || e}`));
      return profile;
    } catch (e) {
      this._markFail(addr, e);
      throw e;
    }
  }

  _markFail(addr, e) {
    this._stats.apiFails++;
    this._failed.set(addr, Date.now());
    this._consecutiveFails++;
    if (e?.apiError === 'RATE_LIMIT_BANNED' || e?.apiError === 'RATE_LIMIT_EXCEEDED' || this._consecutiveFails >= 5) {
      this._globalCooldownUntil = Date.now() + this._c.globalCooldownMs;
      this._consecutiveFails = 0;
    }
  }

  _hasConclusion(addr) {
    const f = this._failed.get(addr);
    return !(f != null && Date.now() - f < this._c.failCooldownMs) && Date.now() >= this._globalCooldownUntil;
  }

  _canFetch() {
    if (Date.now() < this._globalCooldownUntil) return false;
    return this._dailyRemaining() > 0;
  }

  _dailyRemaining() {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this._dailyDay) { this._dailyDay = day; this._dailyCount = 0; }
    return Math.max(0, this._c.dailyBudget - this._dailyCount);
  }

  _countApi() { this._dailyRemaining(); this._dailyCount++; }

  async _writeRow(profile) {
    const client = this._client();
    const row = {
      address: profile.address,
      tags: profile.tags,
      created_at_sec: profile.createdAtSec,
      fund_from_address: profile.fundFrom,
      buy_7d: profile.buy7d,
      sell_7d: profile.sell7d,
      token_num_7d: profile.tokenNum7d,
    };
    await client.from('gmgn_wallet_profiles').upsert(row, { onConflict: 'address' });
  }

  _client() {
    // 惰性 require（service key 红线：anon 被 RLS 静默过滤）
    const { dbManager } = require('../../services/dbManager');
    return dbManager.getClient();
  }

  _warn(msg) {
    if (this._logger?.warn) this._logger.warn('gmgn-wallet-stats', 'GwpService', msg);
  }
}

// ── 小工具 ──
function normalizeEntries(topWallets, limit, minBnb) {
  if (!Array.isArray(topWallets)) return [];
  return topWallets
    .filter(e => e && typeof e.wallet === 'string' && e.wallet.trim() !== ''
      && Number.isFinite(Number(e.bnb)) && Number(e.bnb) >= minBnb)
    .slice(0, limit)
    .map(e => ({ wallet: e.wallet.toLowerCase(), bnb: Number(e.bnb) }));
}
function relDiff(a, b) { return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12); }
function finiteOrNull(v) { return Number.isFinite(Number(v)) ? Number(v) : null; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { GmgnWalletStatsService, GWP_FACTOR_KEYS, DEFAULTS };
