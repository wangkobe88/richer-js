/**
 * 实验统计监控（按小时 × 平台）service
 *
 * 给每个实验的「统计监控」页面供数（GET /api/experiment/:id/hourly-stats）：
 *   1. 各平台每小时新票数量（experiment_tokens.platform × discovered_at 分桶；
 *      discovered_at = token_create blockTimeMs 秒化，见引擎 _handleNewToken 写入链）
 *   2. 每小时出内盘（毕业 graduation）数量——双口径：gradTotal = 实验窗口内该平台
 *      毕业大盘数（wss_events kind='graduation'，token 级全局不挂实验）；
 *      gradDiscovered = 其中 token_address ∈ 本实验发现集的毕业交集数
 *   3. 热度标签：score = newTokens + GRAD_WEIGHT×gradTotal 按平台分档阈值派生
 *      （用户裁定口径：发币+毕业节奏派生，不碰 wss_price_ticks——该表无
 *      (platform, block_time) 索引，按平台×时间窗聚合会顺序扫巨表）
 *
 * 查询纪律（红线）：
 *   - wss_events 禁 ORDER BY（同表 .order 组合过滤 8.2s statement timeout 实证，
 *     BacktestEngine._loadTokenMetadataFromEvents 头注同款）：count exact + 无序
 *     limit 拉全并对账；count > 页上限不可 keyset（无序页任意子集会跳行），改窗口
 *     ms 中点二分递归（左闭右开 [s,mid)/[mid,e) 无重无漏）
 *   - wss_events platform 单值 .eq 顺序循环（勿 .in 多值）
 *   - 毕业查询按 6h 分片：毕业峰值几十/h → 单片数百行 << 1000 页上限，超限由二分兜底
 *   - experiment_tokens 允许 order + offset-range 分页（非 wss_events 红线表）
 *   - 全部经 dbManager.getClient()（service key，RLS 红线）
 *
 * null 语义（未知 ≠ 0）：单平台毕业查询整平台失败 → 该平台全部桶 gradTotal /
 * gradDiscovered = null + warnings.platformErrors，对应 heat 也置 null（不冒充档位）；
 * 其余平台照常返回（api-status 单家失败不炸整体模式）。
 *
 * 粒度：API 固定 1h UTC 桶（缓存键不带粒度）；前端用 mergeHourBuckets 的镜像
 * 实现合并 1h/4h/1d，阈值常量随响应下发保证两侧热度判定一致。
 *
 * 纯函数（module 级导出）：computeHeatLabel / bucketTokensByHour /
 * bucketGraduationsByHour / buildHourSeries / mergeHourBuckets——
 * 单测 scripts/_test_experiment_hourly_stats.cjs 直接消费。
 */

'use strict';

const { dbManager } = require('../../services/dbManager');
const Logger = require('../../services/logger');

const PLATFORMS = ['fourmeme', 'flap', 'gang'];
const HOUR_MS = 3600000;
const GRAD_CHUNK_MS = 6 * HOUR_MS;   // 毕业查询 6h 分片（3 天窗 = 12 片/平台）
const GRAD_PAGE_LIMIT = 1000;        // = Supabase max-rows 硬上限（wss_events 同表先例）
const GRAD_ATTEMPTS = 3;             // 单窗查询失败重试（BacktestEngine PAGE_ATTEMPTS 同款）
const TOKEN_PAGE_SIZE = 1000;
const TOKEN_PAGE_CAP = 30;           // 3 万行保护上限 → warnings.tokenRowsTruncated
const CACHE_TTL_MS = 60000;          // per-experiment 内存缓存（api-status 模式）
const CACHE_MAX_ENTRIES = 32;        // Map 超限按 at 淘汰最旧
const MAX_WINDOW_MS = 45 * 24 * HOUR_MS; // 超长窗 clamp（防脏数据拖垮查询）→ windowClamped

// 热度权重与阈值（初版常量，可调）：score = newTokens + GRAD_WEIGHT × gradTotal
// （单盘毕业的信息量大于单新票）；gang ~12 票/h 实证锚点（add_wss_events_platform_kind_index
// 头注），fourmeme 远大于 flap/gang → 按平台分档。
const GRAD_WEIGHT = 5;
const HEAT_THRESHOLDS = {
  fourmeme: { hot: 150, active: 60, calm: 15 },
  flap: { hot: 30, active: 12, calm: 4 },
  gang: { hot: 15, active: 6, calm: 2 },
  total: { hot: 180, active: 70, calm: 18 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 平台配置展开（platforms.js resolvePlatforms 语义本地复刻，不引引擎模块）：'both'→fourmeme+flap（刻意不含 gang）、'gang'→gang、其余→fourmeme */
function expandPlatforms(raw) {
  if (raw === 'both') return ['fourmeme', 'flap'];
  if (raw === 'gang') return ['gang'];
  if (raw === 'flap') return ['flap'];
  if (raw === 'fourmeme') return ['fourmeme'];
  return ['fourmeme'];
}

function floorHourMs(ms) {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

/** null 传播求和：任一加数为 null（未知）→ 结果 null（未知 + 已知 = 未知，不冒充） */
function sumNullable(a, b) {
  return (a == null || b == null) ? null : a + b;
}

/**
 * 热度档位：'hot' | 'active' | 'calm' | 'cold'；gradTotal=null（查询失败/未知）→ null（不冒充档位）
 * score = newTokens + GRAD_WEIGHT × gradTotal；>= 阈值归上档
 */
function computeHeatLabel(scope, newTokens, gradTotal) {
  if (gradTotal == null) return null;
  const th = HEAT_THRESHOLDS[scope] || HEAT_THRESHOLDS.total;
  const score = (newTokens || 0) + GRAD_WEIGHT * (gradTotal || 0);
  if (score >= th.hot) return 'hot';
  if (score >= th.active) return 'active';
  if (score >= th.calm) return 'calm';
  return 'cold';
}

/**
 * 新票分桶：rows=[{platform, discovered_at}] → {byHour: Map<hourStartMs, Map<platform, count>>, skippedNull}
 * discovered_at 缺失/不可解析 → 跳过并计数（不崩）
 */
function bucketTokensByHour(rows) {
  const byHour = new Map();
  let skippedNull = 0;
  for (const row of rows) {
    const ms = row.discovered_at ? new Date(row.discovered_at).getTime() : NaN;
    if (!Number.isFinite(ms)) { skippedNull++; continue; }
    const h = floorHourMs(ms);
    if (!byHour.has(h)) byHour.set(h, new Map());
    const pmap = byHour.get(h);
    const p = row.platform || 'fourmeme';
    pmap.set(p, (pmap.get(p) || 0) + 1);
  }
  return { byHour, skippedNull };
}

/**
 * 毕业分桶（双口径）：rows=[{platform, token_address, block_time}]
 * → {byHour: Map<hourStartMs, Map<platform, {total, discovered}>>, unplaced}
 * token ∈ discoveredSet 计入 discovered（BSC 地址全局唯一，单一大 Set 无需按平台拆）；
 * block_time 缺失/不可解析 → unplaced 计数（不崩）
 */
function bucketGraduationsByHour(rows, discoveredSet) {
  const byHour = new Map();
  let unplaced = 0;
  for (const row of rows) {
    const ms = row.block_time ? new Date(row.block_time).getTime() : NaN;
    if (!Number.isFinite(ms)) { unplaced++; continue; }
    const h = floorHourMs(ms);
    if (!byHour.has(h)) byHour.set(h, new Map());
    const pmap = byHour.get(h);
    const p = row.platform || 'fourmeme';
    if (!pmap.has(p)) pmap.set(p, { total: 0, discovered: 0 });
    const cell = pmap.get(p);
    cell.total += 1;
    if (discoveredSet && discoveredSet.has(row.token_address)) cell.discovered += 1;
  }
  return { byHour, unplaced };
}

/**
 * 组装连续 UTC 小时网格（窗口首尾不满 1h 各占一个整点桶）。
 * failedGradPlatforms: Set<platform>——整平台毕业查询失败 → 该平台 grad/heat 置 null（未知），
 * 且 total 的 grad/heat 同样置 null（组成不全，不冒充合计）。
 * platformList: 全平台列表——给定时每桶为每个平台显式生成格子（零值列固定，监控页表格口径）；
 * 缺席时按「出现过的键 ∪ failed」并集。
 */
function buildHourSeries(startMs, endMs, tokensByHour, gradsByHour, failedGradPlatforms, platformList) {
  const failed = failedGradPlatforms || new Set();
  const hours = [];
  if (!(endMs > startMs)) return hours;
  const first = floorHourMs(startMs);
  const last = floorHourMs(endMs - 1);
  for (let h = first; h <= last; h += HOUR_MS) {
    const platforms = {};
    const total = { newTokens: 0, gradTotal: 0, gradDiscovered: 0 };
    const tmap = tokensByHour.get(h) || new Map();
    const gmap = gradsByHour.get(h) || new Map();
    const keys = platformList && platformList.length
      ? new Set(platformList)
      : new Set([...tmap.keys(), ...gmap.keys(), ...failed]);
    for (const p of keys) {
      const newTokens = tmap.get(p) || 0;
      let gradTotal = gmap.get(p) ? gmap.get(p).total : 0;
      let gradDiscovered = gmap.get(p) ? gmap.get(p).discovered : 0;
      if (failed.has(p)) { gradTotal = null; gradDiscovered = null; }
      platforms[p] = { newTokens, gradTotal, gradDiscovered };
      total.newTokens += newTokens;
      total.gradTotal = sumNullable(total.gradTotal, gradTotal);
      total.gradDiscovered = sumNullable(total.gradDiscovered, gradDiscovered);
    }
    const heat = {};
    for (const [scope, cell] of Object.entries({ ...platforms, total })) {
      heat[scope] = computeHeatLabel(scope, cell.newTokens, cell.gradTotal);
    }
    hours.push({ hourStart: new Date(h).toISOString(), platforms, total, heat });
  }
  return hours;
}

/**
 * 粒度合并（1h → N 小时桶；前端镜像实现同算法）：floor UTC ms 到粒度网格求和
 * （null 传播）+ 按阈值重算 heat。granularityHours ∈ {1,4,24}；1 = 原样浅拷贝。
 */
function mergeHourBuckets(hours, granularityHours) {
  const granMs = Math.max(1, Math.floor(Number(granularityHours) || 1)) * HOUR_MS;
  const buckets = new Map(); // bucketStartMs -> {platforms, total}
  for (const h of hours) {
    const ms = new Date(h.hourStart).getTime();
    if (!Number.isFinite(ms)) continue;
    const b = Math.floor(ms / granMs) * granMs;
    if (!buckets.has(b)) buckets.set(b, { platforms: {}, total: { newTokens: 0, gradTotal: 0, gradDiscovered: 0 } });
    const cell = buckets.get(b);
    for (const [p, pc] of Object.entries(h.platforms || {})) {
      if (!cell.platforms[p]) cell.platforms[p] = { newTokens: 0, gradTotal: 0, gradDiscovered: 0 };
      cell.platforms[p].newTokens += pc.newTokens || 0;
      cell.platforms[p].gradTotal = sumNullable(cell.platforms[p].gradTotal, pc.gradTotal);
      cell.platforms[p].gradDiscovered = sumNullable(cell.platforms[p].gradDiscovered, pc.gradDiscovered);
    }
    cell.total.newTokens += (h.total && h.total.newTokens) || 0;
    cell.total.gradTotal = sumNullable(cell.total.gradTotal, h.total && h.total.gradTotal);
    cell.total.gradDiscovered = sumNullable(cell.total.gradDiscovered, h.total && h.total.gradDiscovered);
  }
  const merged = [];
  for (const ms of [...buckets.keys()].sort((a, b) => a - b)) {
    const cell = buckets.get(ms);
    const heat = {};
    for (const [scope, c] of Object.entries({ ...cell.platforms, total: cell.total })) {
      heat[scope] = computeHeatLabel(scope, c.newTokens, c.gradTotal);
    }
    merged.push({ hourStart: new Date(ms).toISOString(), platforms: cell.platforms, total: cell.total, heat });
  }
  return merged;
}

/** 汇总聚合（null 传播；heatCounts 只统计非 null 档位） */
function buildSummary(hours, platforms) {
  const agg = { total: { newTokens: 0, gradTotal: 0, gradDiscovered: 0 } };
  for (const p of platforms) agg[p] = { newTokens: 0, gradTotal: 0, gradDiscovered: 0 };
  const heatCounts = { total: { hot: 0, active: 0, calm: 0, cold: 0 } };
  for (const p of platforms) heatCounts[p] = { hot: 0, active: 0, calm: 0, cold: 0 };
  let peakHour = null;
  for (const h of hours) {
    for (const p of Object.keys(agg)) {
      const src = p === 'total' ? h.total : h.platforms[p];
      if (!src) continue;
      agg[p].newTokens += src.newTokens || 0;
      agg[p].gradTotal = sumNullable(agg[p].gradTotal, src.gradTotal);
      agg[p].gradDiscovered = sumNullable(agg[p].gradDiscovered, src.gradDiscovered);
      const label = h.heat && h.heat[p];
      if (label && heatCounts[p]) heatCounts[p][label] += 1;
    }
    const score = h.total && h.total.gradTotal != null
      ? (h.total.newTokens || 0) + GRAD_WEIGHT * h.total.gradTotal
      : -Infinity;
    if (score > (peakHour ? peakHour.score : -Infinity)) {
      peakHour = { hourStart: h.hourStart, score };
    }
  }
  return { platforms: agg, total: agg.total, heatCounts, peakHour: peakHour && Number.isFinite(peakHour.score) ? peakHour : null };
}

/**
 * 实验统计监控 service
 * @class
 */
class ExperimentHourlyStatsService {
  constructor() {
    this.supabase = dbManager.getClient();
    this.logger = new Logger({ dir: './logs', experimentId: 'hourly-stats-service' });
    /** @type {Map<string, {at:number, data:object}>} per-experiment 60s 缓存 */
    this._cache = new Map();
  }

  /**
   * 主入口：缓存判断 + 编排 + 组装
   * @returns {Promise<object>} API 响应 data（不含 success 包装；cachedAt/fresh 由本方法补）
   */
  async getHourlyStats(experimentId, { refresh = false } = {}) {
    const hit = this._cache.get(experimentId);
    if (!refresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { ...hit.data, cachedAt: new Date(hit.at).toISOString(), fresh: false };
    }
    const data = await this._build(experimentId);
    const entry = { at: Date.now(), data };
    this._cache.set(experimentId, entry);
    while (this._cache.size > CACHE_MAX_ENTRIES) {
      let oldestKey = null;
      let oldestAt = Infinity;
      for (const [k, v] of this._cache) {
        if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
      }
      this._cache.delete(oldestKey);
    }
    return { ...data, cachedAt: new Date(entry.at).toISOString(), fresh: true };
  }

  /** @private 编排：元数据 → 窗口 → token 集 → 毕业事件 → 分桶组装 */
  async _build(experimentId) {
    const meta = await this._loadExperimentMeta(experimentId);
    const config = meta.config || {};
    const backtest = config.backtest || {};

    // 时间窗：回测显式窗优先（时间范围通道回测 started_at 与数据窗脱钩），
    // 其余 started_at → created_at 逐级回落；运行中/无 stopped_at → now()
    let windowStartMs;
    let windowSource;
    if (backtest.startTime) { windowStartMs = new Date(backtest.startTime).getTime(); windowSource = 'backtest-config'; }
    else if (meta.started_at) { windowStartMs = new Date(meta.started_at).getTime(); windowSource = 'started_at'; }
    else { windowStartMs = new Date(meta.created_at).getTime(); windowSource = 'created_at'; }

    let windowEndMs;
    let windowEndSource;
    if (backtest.endTime) { windowEndMs = new Date(backtest.endTime).getTime(); windowEndSource = 'backtest-config'; }
    else if (meta.stopped_at) { windowEndMs = new Date(meta.stopped_at).getTime(); windowEndSource = 'stopped_at'; }
    else { windowEndMs = Date.now(); windowEndSource = 'now'; }

    const warnings = { windowClamped: false, tokenRowsTruncated: false, unplacedGraduations: 0, skippedTokenRows: 0, platformErrors: {} };
    if (Number.isFinite(windowStartMs) && Number.isFinite(windowEndMs) && windowEndMs - windowStartMs > MAX_WINDOW_MS) {
      windowEndMs = windowStartMs + MAX_WINDOW_MS;
      warnings.windowClamped = true;
      windowEndSource = 'clamped';
    }

    // token 宇宙：回测旧通道=源实验 experiment_tokens（_getTargetExperimentIdForTokens 同语义）；
    // 时间范围通道回测 experiment_tokens 为空=合法形状（token 集只在 wss_events 回放里）
    const tokenUniverseId = backtest.sourceExperimentId || experimentId;
    const tokenUniverseSource = backtest.sourceExperimentId
      ? `source-experiment:${backtest.sourceExperimentId}`
      : 'self';

    const experimentInfo = {
      id: meta.id,
      name: meta.experiment_name,
      tradingMode: meta.trading_mode,
      status: meta.status,
      platforms: expandPlatforms(config.platform),
      windowStart: Number.isFinite(windowStartMs) ? new Date(windowStartMs).toISOString() : null,
      windowEnd: Number.isFinite(windowEndMs) ? new Date(windowEndMs).toISOString() : null,
      windowSource: Number.isFinite(windowStartMs) ? windowSource : 'missing',
      windowEndSource,
      tokenUniverseSource,
    };

    if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
      // 脏窗口（缺锚或 end<=start）：返回合法空态而非 throw（页面可展示元数据+空表）
      this.logger.warn(experimentId, 'ExperimentHourlyStatsService',
        `时间窗不可用（start=${experimentInfo.windowStart} end=${experimentInfo.windowEnd}），返回空序列`);
      return {
        experiment: experimentInfo,
        heatThresholds: HEAT_THRESHOLDS,
        gradWeight: GRAD_WEIGHT,
        hours: [],
        summary: buildSummary([], experimentInfo.platforms),
        warnings,
      };
    }

    // ① 新票：experiment_tokens 轻列分页拉全（order+offset 合法表）
    const { rows: tokenRows, truncated } = await this._loadDiscoveredTokens(tokenUniverseId);
    warnings.tokenRowsTruncated = truncated;
    const { byHour: tokensByHour, skippedNull } = bucketTokensByHour(tokenRows);
    warnings.skippedTokenRows = skippedNull;
    const discoveredSet = new Set(tokenRows.map((r) => r.token_address));

    // 平台集 = 配置展开 ∪ tokens 实际出现平台
    const seenPlatforms = new Set(experimentInfo.platforms);
    for (const pmap of tokensByHour.values()) {
      for (const p of pmap.keys()) seenPlatforms.add(p);
    }
    const platforms = PLATFORMS.filter((p) => seenPlatforms.has(p));
    experimentInfo.platforms = platforms;

    // ② 毕业：wss_events 逐平台 6h 分片 + 对账/二分（红线内查询）；单平台失败不炸整体
    const failedGradPlatforms = new Set();
    const gradRows = [];
    for (const platform of platforms) {
      try {
        const rows = await this._loadGraduationsForPlatform(platform, windowStartMs, windowEndMs);
        gradRows.push(...rows);
      } catch (err) {
        failedGradPlatforms.add(platform);
        warnings.platformErrors[platform] = err.message;
        this.logger.error(experimentId, 'ExperimentHourlyStatsService',
          `毕业事件拉取失败（platform=${platform}）: ${err.message}`);
      }
    }
    const { byHour: gradsByHour, unplaced } = bucketGraduationsByHour(gradRows, discoveredSet);
    warnings.unplacedGraduations = unplaced;

    // ③ 组装（platformList=全平台显式格子，零值列固定）
    const hours = buildHourSeries(windowStartMs, windowEndMs, tokensByHour, gradsByHour, failedGradPlatforms, platforms);
    const summary = buildSummary(hours, platforms);
    return {
      experiment: experimentInfo,
      heatThresholds: HEAT_THRESHOLDS,
      gradWeight: GRAD_WEIGHT,
      hours,
      summary,
      warnings,
    };
  }

  /** @private 实验元数据单行；不存在/非法 uuid → status 404 error */
  async _loadExperimentMeta(experimentId) {
    const res = await this.supabase
      .from('experiments')
      .select('id, experiment_name, trading_mode, status, started_at, stopped_at, created_at, config')
      .eq('id', experimentId)
      .single();
    if (res.error || !res.data) {
      const err = new Error(`实验不存在或查询失败: ${experimentId}${res.error ? `（${res.error.message}）` : ''}`);
      err.status = 404;
      throw err;
    }
    return res.data;
  }

  /**
   * @private experiment_tokens 轻列分页拉全（order discovered_at + offset-range；短页即止；
   * 超 TOKEN_PAGE_CAP 页停 + truncated 标记——不静默吞，页面黄条警示）
   */
  async _loadDiscoveredTokens(experimentId) {
    const rows = [];
    for (let page = 0; page < TOKEN_PAGE_CAP; page++) {
      const offset = page * TOKEN_PAGE_SIZE;
      const res = await this.supabase
        .from('experiment_tokens')
        .select('token_address, platform, discovered_at')
        .eq('experiment_id', experimentId)
        .order('discovered_at', { ascending: true })
        .range(offset, offset + TOKEN_PAGE_SIZE - 1);
      if (res.error) {
        throw new Error(`experiment_tokens 拉取失败（offset=${offset}）: ${res.error.message}`);
      }
      const data = res.data || [];
      rows.push(...data);
      if (data.length < TOKEN_PAGE_SIZE) return { rows, truncated: false };
    }
    this.logger.warn(experimentId, 'ExperimentHourlyStatsService',
      `experiment_tokens 超过 ${TOKEN_PAGE_CAP * TOKEN_PAGE_SIZE} 行保护上限，截断统计`);
    return { rows, truncated: true };
  }

  /**
   * @private 毕业事件拉全（单平台）：6h 分片 → 单窗查询（禁 .order；count exact 对账；
   * count>页上限 ms 中点二分递归左闭右开；失败重试 3 次；≤1s 叶子仍超限 fail-loud）
   */
  async _loadGraduationsForPlatform(platform, startMs, endMs) {
    const rows = [];
    const fetchWindowOnce = async (s, e) => {
      let lastErr = null;
      for (let attempt = 1; attempt <= GRAD_ATTEMPTS; attempt++) {
        const res = await this.supabase
          .from('wss_events')
          .select('token_address, block_time', { count: 'exact' })
          .eq('kind', 'graduation')
          .eq('platform', platform)
          .gte('block_time', new Date(s).toISOString())
          .lt('block_time', new Date(e).toISOString())
          .limit(GRAD_PAGE_LIMIT);
        if (!res.error) return res;
        lastErr = res.error;
        if (attempt < GRAD_ATTEMPTS) await sleep(1000);
      }
      throw new Error(`wss_events graduation 查询失败（${platform} ${new Date(s).toISOString()}~${new Date(e).toISOString()}，连续 ${GRAD_ATTEMPTS} 次）: ${lastErr && lastErr.message}`);
    };
    const loadWindow = async (s, e) => {
      const res = await fetchWindowOnce(s, e);
      if (res.count == null) {
        throw new Error(`wss_events graduation count 形状异常（null）: platform=${platform}`);
      }
      const data = res.data || [];
      if (res.count === 0) return;
      if (res.count <= GRAD_PAGE_LIMIT) {
        if (data.length !== res.count) {
          throw new Error(`毕业窗口对账失配（无序页 ${data.length} ≠ count ${res.count}）: platform=${platform} ${new Date(s).toISOString()}~${new Date(e).toISOString()}`);
        }
        for (const row of data) rows.push({ platform, token_address: row.token_address, block_time: row.block_time });
        return;
      }
      if (e - s < 1000) {
        throw new Error(`毕业窗口二分到 ≤1s 仍 ${res.count} 行 > 页上限（数据形状异常，宁拒不漏）: platform=${platform}`);
      }
      const mid = Math.floor((s + e) / 2); // 左闭右开 [s,mid)/[mid,e)：ms 整数分割无重无漏
      await loadWindow(s, mid);
      await loadWindow(mid, e);
    };
    for (let s = startMs; s < endMs; s += GRAD_CHUNK_MS) {
      const e = Math.min(s + GRAD_CHUNK_MS, endMs);
      await loadWindow(s, e);
    }
    return rows;
  }
}

module.exports = {
  ExperimentHourlyStatsService,
  computeHeatLabel,
  bucketTokensByHour,
  bucketGraduationsByHour,
  buildHourSeries,
  mergeHourBuckets,
  buildSummary,
  expandPlatforms,
  HEAT_THRESHOLDS,
  GRAD_WEIGHT,
  PLATFORMS,
  HOUR_MS,
  GRAD_CHUNK_MS,
};
