/**
 * Precheck fail 重试服务（fPay/FOMOPAY 宣告竞态案，2026-09-27 用户裁定落地，§六-24；
 * no_public_info 域扩展：FOMOON 案，2026-09-28 用户裁定）
 *
 * 背景 A（address 域）：项目方标准动作序列是「先发币、立即发推贴 CA」（fPay 宣告
 * 晚于首析 6s / FOMOPAY 晚 5s 两例实证），首次叙事分析常跑在宣告推文之前 → 账号
 * 质量门不达标 + 地址未公示 → precheck fail（validationStage='address'），且
 * token_narrative 全局缓存把「宣告前」fail 永久固化。
 *
 * 背景 B（no_public_info 域）：「先发币、后补推文/官网」（FOMOON 0xb5e1…7777 实证
 * 推文比创建晚 12m38s、比首析晚 8m30s）——首析时 four.meme 元数据与 IPFS 均空
 * （不可变恒空），GMGN link 也未聚合 → no_public_info（ruleName 形状）终局拒绝。
 * 唯一可变补源是 GMGN link 聚合（BRF 案结论），故 no_public_info 重试必须：
 *   a. 传 enrichSocialByGmgn:true——不传则 GMGN 补源整条链不执行，重试必空转
 *   b. 重试前定点失效 GMGN 缓存（external_resource_cache，maxAge 1d）——否则
 *      重析命中首析时的空社媒缓存，5 次重试全部空转（用户裁定：重试前删缓存行，
 *      GMGN 付费配额从「仅叙事直调」扩展到重试链路，重试低频可控）
 *
 * 机制：engine 常驻进程定时扫描两类 fail 行，对满足以下全部条件的行按形状重析：
 *   1. pre_check_result.pass=false 且形状命中（details 形状互斥，见 classifyFailShape）：
 *      - 'address'：details.validationStage='address'（宣告竞态形状）
 *      - 'no_public_info'：details.ruleName='no_public_info'（语料缺失形状）
 *   2. 代币创建（wss_events token_create 最早事件时间）距今 < 各自窗口（出窗完全
 *      停止——用户裁定；查不到创建事件 = 无时间锚，无法执行停止语义，不重试）：
 *      - address 域 retryWindowSec（默认 300s，「重试在代币发出后 5 分钟完全停止」）
 *      - no_public_info 域 noPublicInfoRetryWindowSec（默认 1800s——FOMOON 实测
 *        推文晚 12m38s，300s 盖不住，独立配窗不动 address 语义）
 *   3. 自上次分析（analyzed_at）以来新增 tick ≥ tradeSurgeThreshold（增量口径而非
 *      总量：fail 时刻盘面往往已有交易量，总量口径会立即触发且每轮触发；增量 =
 *      「上次分析后发生了新市场活动」，天然限频）
 *   4. 本进程内该 token 重试次数 < maxRetriesPerToken（重启清零，非持久语义——
 *      窗口本身即边界；30min 窗重启清零最多多几次重试，低频可接受）
 *
 * DB 客户端：dbManager（service key 优先）——wss_price_ticks / wss_events 对 anon
 * key 被 RLS 静默过滤成空，不得用 NarrativeRepository / engine 自带的 anon 客户端
 * 查这两表；重析写入仍走 NarrativeAnalyzer→NarrativeRepository（token_narrative
 * 对该客户端可写，与 worker 同链路）。
 */

import { createRequire } from 'module';
import { ExternalResourceCache } from '../db/ExternalResourceCache.mjs';

const require = createRequire(import.meta.url);
const { dbManager } = require('../../services/dbManager.js');

function log(level, message, data = {}) {
  const line = `[${new Date().toISOString()}] [PrecheckFailRetry] [${level}] ${message}`;
  if (Object.keys(data).length > 0) console.log(line, JSON.stringify(data));
  else console.log(line);
}

/**
 * 从 pre_check_result 提取失败形状（两类 details 形状互斥，见文件头）：
 * - 'address'：规则 fail 走 account 路径时 validationStage=rulesResult.stage 嵌入
 * - 'no_public_info'：规则层 buildPreCheckResult 的 ruleName 字段
 * 其余规则形状（symbol_too_long/copycat_token/…）不在重试域，返回 null。
 */
function classifyFailShape(preCheckResult) {
  if (preCheckResult?.pass !== false) return null;
  const details = preCheckResult?.details;
  if (details?.validationStage === 'address') return 'address';
  if (details?.ruleName === 'no_public_info') return 'no_public_info';
  return null;
}

export class PrecheckFailRetryService {
  /**
   * @param {Object} config - engine.precheckFailRetry 配置段
   * @param {boolean} config.enabled - 默认 true
   * @param {number} config.scanIntervalMs - 扫描周期，默认 30000
   * @param {number} config.retryWindowSec - address 域代币创建后重试窗口（出窗完全停止），默认 300
   * @param {number} config.noPublicInfoRetryWindowSec - no_public_info 域重试窗口，默认 1800
   * @param {number} config.tradeSurgeThreshold - 触发重析的新增 tick 数（自上次分析起），默认 20
   * @param {number} config.maxRetriesPerToken - 单 token 重试次数上限（进程内），默认 5
   * @param {number} config.maxPerScan - 单轮扫描最多触发的重析数，默认 2
   */
  constructor(config = {}) {
    this.enabled = config.enabled !== false;
    this.scanIntervalMs = config.scanIntervalMs || 30000;
    this.retryWindowSec = config.retryWindowSec ?? 300;
    this.noPublicInfoRetryWindowSec = config.noPublicInfoRetryWindowSec ?? 1800;
    this.tradeSurgeThreshold = config.tradeSurgeThreshold ?? 20;
    this.maxRetriesPerToken = config.maxRetriesPerToken ?? 5;
    this.maxPerScan = config.maxPerScan ?? 2;

    this._timer = null;
    this._scanInProgress = false;
    this._retryCounts = new Map(); // token → 本进程内已重试次数
    this._inFlight = new Set();
    this._analyzerMod = null; // NarrativeAnalyzer 模块（首次重试时惰性加载）

    this.stats = {
      scans: 0,
      candidates: 0,        // 累计通过形状过滤的候选（含被后续条件跳过的）
      retried: 0,           // 实际发起的重析次数
      retrySuccess: 0,      // 重析后触发形状不再是 fail 的次数
      windowExpiredSkips: 0,
      noAnchorSkips: 0,
      volumeBelowSkips: 0,
      maxRetriesSkips: 0,
      gmgnInvalidateFailSkips: 0, // GMGN 缓存定点失效失败（跳过本轮不烧配额）
    };
  }

  start() {
    if (!this.enabled) {
      log('INFO', 'precheck fail 重试服务未启用（engine.precheckFailRetry.enabled=false）');
      return;
    }
    log('INFO', 'precheck fail 重试服务启动', {
      scanIntervalMs: this.scanIntervalMs,
      retryWindowSec: this.retryWindowSec,
      noPublicInfoRetryWindowSec: this.noPublicInfoRetryWindowSec,
      tradeSurgeThreshold: this.tradeSurgeThreshold,
      maxRetriesPerToken: this.maxRetriesPerToken,
    });
    this._timer = setInterval(() => {
      this._scanOnce().catch(err => log('ERROR', `扫描异常: ${err.message}`));
    }, this.scanIntervalMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  /** 单轮扫描：查候选 → 逐个判定 → 触发重析（串行，限 maxPerScan 个） */
  async _scanOnce() {
    if (this._scanInProgress) return;
    this._scanInProgress = true;
    try {
      const client = dbManager.getClient();
      // 扫描窗 = 最大重试窗口 + 5min 余量：fail 行 analyzed_at 距今超过各自窗口+余量必然出窗
      const lookbackMs = (Math.max(this.retryWindowSec, this.noPublicInfoRetryWindowSec) + 300) * 1000;
      const { data: rows, error } = await client
        .from('token_narrative')
        .select('token_address, analyzed_at, pre_check_result')
        .eq('is_valid', true)
        .gt('analyzed_at', new Date(Date.now() - lookbackMs).toISOString())
        .order('analyzed_at', { ascending: false })
        .limit(500);
      if (error) throw new Error(`token_narrative 候选查询失败: ${error.message}`);

      // 两域形状过滤（classifyFailShape）：address 宣告竞态 / no_public_info 语料缺失
      const candidates = (rows || [])
        .map(r => ({ ...r, failShape: classifyFailShape(r.pre_check_result) }))
        .filter(r => r.failShape);
      this.stats.scans++;
      this.stats.candidates += candidates.length;
      if (!candidates.length) return;

      let triggered = 0;
      for (const row of candidates) {
        if (triggered >= this.maxPerScan) break;
        const reason = await this._shouldRetry(client, row);
        if (reason) continue; // 跳过（reason 即跳过原因，已计入 stats）
        await this._retry(row.token_address, row.failShape);
        triggered++;
      }
    } finally {
      this._scanInProgress = false;
    }
  }

  /**
   * 判定候选是否应重试；返回 null=应重试，否则返回跳过原因（并累计对应 stats）
   */
  async _shouldRetry(client, row) {
    const addr = row.token_address;
    if (this._inFlight.has(addr)) return 'in-flight';
    if ((this._retryCounts.get(addr) || 0) >= this.maxRetriesPerToken) {
      this.stats.maxRetriesSkips++;
      return 'max-retries';
    }

    // 代币创建时间锚：wss_events 最早 token_create（与 token-info-service 回退同口径）。
    // 查不到 = 无时间锚 → 5min 停止语义无法执行，不重试（fail-closed）
    const { data: ev, error: evError } = await client
      .from('wss_events')
      .select('created_at')
      .eq('token_address', addr)
      .eq('kind', 'token_create')
      .order('created_at', { ascending: true })
      .limit(1);
    if (evError) {
      log('WARN', `创建事件查询失败（跳过本轮）: ${addr} ${evError.message}`);
      return 'anchor-error';
    }
    const createdAtSec = ev?.[0]?.created_at
      ? Math.floor(new Date(ev[0].created_at).getTime() / 1000) : null;
    if (!createdAtSec) {
      this.stats.noAnchorSkips++;
      return 'no-anchor';
    }

    // 出窗完全停止（用户裁定）；窗口按域独立：address 300s（「代币发出后 5 分钟」）/
    // no_public_info 1800s（FOMOON 实测推文晚 12m38s，独立配窗不动 address 语义）
    const windowSec = row.failShape === 'no_public_info'
      ? this.noPublicInfoRetryWindowSec : this.retryWindowSec;
    if (Date.now() / 1000 - createdAtSec >= windowSec) {
      this.stats.windowExpiredSkips++;
      return 'window-expired';
    }

    // 交易量增量门槛：自上次分析以来的新增 tick（增量口径，见文件头）
    const { count, error: countError } = await client
      .from('wss_price_ticks')
      .select('id', { count: 'exact', head: true })
      .eq('token_address', addr)
      .gt('received_at', row.analyzed_at);
    if (countError) {
      log('WARN', `增量 tick 计数失败（跳过本轮）: ${addr} ${countError.message}`);
      return 'count-error';
    }
    if ((count || 0) < this.tradeSurgeThreshold) {
      this.stats.volumeBelowSkips++;
      return 'volume-below';
    }
    return null;
  }

  /**
   * 执行重析（in-flight 防重入 + 计数；结果仍是触发形状的 fail 则下轮按条件再试）。
   * no_public_info 形状：先定点失效 GMGN 缓存（不删则重析命中首析的空社媒缓存空转），
   * 失败则跳过本轮不烧 analyze 配额（attempts 不计）；且必须传 enrichSocialByGmgn
   * （不传则 GMGN 补源链不执行，four.meme 元数据/IPFS 不可变恒空，重试必空转）。
   */
  async _retry(addr, failShape) {
    this._inFlight.add(addr);
    try {
      if (failShape === 'no_public_info') {
        const cacheKey = `gmgn:token:bsc:${addr.toLowerCase()}`;
        const invalidated = await ExternalResourceCache.invalidate(cacheKey, 'gmgn_token_info');
        if (!invalidated) {
          this.stats.gmgnInvalidateFailSkips++;
          log('WARN', `GMGN 缓存失效失败，跳过本轮重析: ${addr} ${cacheKey}`);
          return;
        }
      }
      this._retryCounts.set(addr, (this._retryCounts.get(addr) || 0) + 1);
      this.stats.retried++;
      log('INFO', `重析触发: ${addr}`, {
        attempt: this._retryCounts.get(addr),
        max: this.maxRetriesPerToken,
        failShape,
      });
      // 惰性加载：analyzer 链顶层读配置/初始化，不拖累 engine 启动；首次重试时才加载
      if (!this._analyzerMod) {
        this._analyzerMod = await import('../analyzer/NarrativeAnalyzer.mjs');
      }
      const analyzeOpts = failShape === 'no_public_info'
        ? { ignoreCache: true, enrichSocialByGmgn: true }
        : { ignoreCache: true };
      const result = await this._analyzerMod.NarrativeAnalyzer.analyze(addr, analyzeOpts);
      // 仍是触发形状 = 未解决（address：宣告仍没发/账号仍不达标；no_public_info：
      // GMGN 仍没聚合出社媒）。拿到语料后 Jev 评 low 属「已解决」——语料到位，
      // 评级归 Jev；llmAnalysis.preCheck 在非 fail 路径为 null
      const details = result?.llmAnalysis?.preCheck?.details ?? null;
      const unresolved = failShape === 'no_public_info'
        ? details?.ruleName === 'no_public_info'
        : details?.validationStage === 'address';
      if (!unresolved) this.stats.retrySuccess++;
      log('INFO', `重析完成: ${addr}`, {
        rating: result?.llmAnalysis?.summary?.rating ?? null,
        category: result?.llmAnalysis?.prestage?.category
          ?? (result?.llmAnalysis?.stage1?.details?.eventClassification?.primaryCategory
            ? `event:${result.llmAnalysis.stage1.details.eventClassification.primaryCategory}` : null),
        promptType: result?.meta?.promptType ?? null,
        resolved: !unresolved,
      });
    } catch (err) {
      log('ERROR', `重析失败: ${addr} ${err.message}`);
    } finally {
      this._inFlight.delete(addr);
    }
  }
}
