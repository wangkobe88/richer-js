/**
 * Precheck fail 重试服务（fPay/FOMOPAY 宣告竞态案，2026-09-27 用户裁定落地，§六-24）
 *
 * 背景：项目方标准动作序列是「先发币、立即发推贴 CA」（fPay 宣告晚于首析 6s /
 * FOMOPAY 晚 5s 两例实证），首次叙事分析常跑在宣告推文之前 → 账号质量门不达标 +
 * 地址未公示 → precheck fail（validationStage='address'），且 token_narrative 全局
 * 缓存把「宣告前」fail 永久固化。
 *
 * 机制：engine 常驻进程定时扫描 address-fail 行，对满足以下全部条件的行
 * ignoreCache 重析（宣告此时已进账号时间线——getAccountWithFullTweets 实时拉取，
 * 地址命中即通过规则层进入 prestage 分类判定，token_category 随之落库）：
 *   1. pre_check_result.pass=false 且 details.validationStage='address'（没通过且
 *      没找到发布地址——宣告竞态形状；no_public_info 等其他规则 fail 不在域内）
 *   2. 代币创建（wss_events token_create 最早事件时间）距今 < retryWindowSec
 *      （默认 300s，出窗完全停止——用户裁定「重试在代币发出后 5 分钟完全停止」；
 *      查不到创建事件 = 无时间锚，无法执行停止语义，不重试）
 *   3. 自上次分析（analyzed_at）以来新增 tick ≥ tradeSurgeThreshold（增量口径而非
 *      总量：fail 时刻盘面往往已有交易量，总量口径会立即触发且每轮触发；增量 =
 *      「上次分析后发生了新市场活动」，天然限频）
 *   4. 本进程内该 token 重试次数 < maxRetriesPerToken（重启清零，非持久语义——
 *      5min 窗口本身即边界）
 *
 * DB 客户端：dbManager（service key 优先）——wss_price_ticks / wss_events 对 anon
 * key 被 RLS 静默过滤成空，不得用 NarrativeRepository / engine 自带的 anon 客户端
 * 查这两表；重析写入仍走 NarrativeAnalyzer→NarrativeRepository（token_narrative
 * 对该客户端可写，与 worker 同链路）。
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { dbManager } = require('../../services/dbManager.js');

function log(level, message, data = {}) {
  const line = `[${new Date().toISOString()}] [PrecheckFailRetry] [${level}] ${message}`;
  if (Object.keys(data).length > 0) console.log(line, JSON.stringify(data));
  else console.log(line);
}

export class PrecheckFailRetryService {
  /**
   * @param {Object} config - engine.precheckFailRetry 配置段
   * @param {boolean} config.enabled - 默认 true
   * @param {number} config.scanIntervalMs - 扫描周期，默认 30000
   * @param {number} config.retryWindowSec - 代币创建后重试窗口（出窗完全停止），默认 300
   * @param {number} config.tradeSurgeThreshold - 触发重析的新增 tick 数（自上次分析起），默认 20
   * @param {number} config.maxRetriesPerToken - 单 token 重试次数上限（进程内），默认 5
   * @param {number} config.maxPerScan - 单轮扫描最多触发的重析数，默认 2
   */
  constructor(config = {}) {
    this.enabled = config.enabled !== false;
    this.scanIntervalMs = config.scanIntervalMs || 30000;
    this.retryWindowSec = config.retryWindowSec ?? 300;
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
      candidates: 0,        // 累计通过 address-fail 形状过滤的候选（含被后续条件跳过的）
      retried: 0,           // 实际发起的重析次数
      retrySuccess: 0,      // 重析后不再是 address-fail 的次数
      windowExpiredSkips: 0,
      noAnchorSkips: 0,
      volumeBelowSkips: 0,
      maxRetriesSkips: 0,
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
      // 扫描窗 = 重试窗口 + 5min 余量：fail 行 analyzed_at 距今超过窗口+余量必然出窗
      const lookbackMs = (this.retryWindowSec + 300) * 1000;
      const { data: rows, error } = await client
        .from('token_narrative')
        .select('token_address, analyzed_at, pre_check_result')
        .eq('is_valid', true)
        .gt('analyzed_at', new Date(Date.now() - lookbackMs).toISOString())
        .order('analyzed_at', { ascending: false })
        .limit(500);
      if (error) throw new Error(`token_narrative 候选查询失败: ${error.message}`);

      // 「没通过，且没找到发布的地址」= 账号规则验证挂在 address 阶段（宣告竞态形状）
      const candidates = (rows || []).filter(r =>
        r.pre_check_result?.pass === false
        && r.pre_check_result?.details?.validationStage === 'address');
      this.stats.scans++;
      this.stats.candidates += candidates.length;
      if (!candidates.length) return;

      let triggered = 0;
      for (const row of candidates) {
        if (triggered >= this.maxPerScan) break;
        const reason = await this._shouldRetry(client, row);
        if (reason) continue; // 跳过（reason 即跳过原因，已计入 stats）
        await this._retry(row.token_address);
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

    // 出窗完全停止（用户裁定：重试在代币发出后 5 分钟完全停止）
    if (Date.now() / 1000 - createdAtSec >= this.retryWindowSec) {
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

  /** 执行重析（in-flight 防重入 + 计数；结果仍 address-fail 则下轮按条件再试） */
  async _retry(addr) {
    this._inFlight.add(addr);
    this._retryCounts.set(addr, (this._retryCounts.get(addr) || 0) + 1);
    this.stats.retried++;
    log('INFO', `重析触发: ${addr}`, {
      attempt: this._retryCounts.get(addr),
      max: this.maxRetriesPerToken,
    });
    try {
      // 惰性加载：analyzer 链顶层读配置/初始化，不拖累 engine 启动；首次重试时才加载
      if (!this._analyzerMod) {
        this._analyzerMod = await import('../analyzer/NarrativeAnalyzer.mjs');
      }
      const result = await this._analyzerMod.NarrativeAnalyzer.analyze(addr, { ignoreCache: true });
      // 仍挂 address 阶段 = 未解决（宣告仍没发/账号仍不达标）；llmAnalysis.preCheck 在
      // 非 fail 路径为 null，其他规则 fail 的 validationStage ≠ 'address'（不在重试域）
      const stillAddressFail =
        result?.llmAnalysis?.preCheck?.details?.validationStage === 'address';
      if (!stillAddressFail) this.stats.retrySuccess++;
      log('INFO', `重析完成: ${addr}`, {
        rating: result?.llmAnalysis?.summary?.rating ?? null,
        category: result?.llmAnalysis?.prestage?.category
          ?? (result?.llmAnalysis?.stage1?.details?.eventClassification?.primaryCategory
            ? `event:${result.llmAnalysis.stage1.details.eventClassification.primaryCategory}` : null),
        promptType: result?.meta?.promptType ?? null,
        resolved: !stillAddressFail,
      });
    } catch (err) {
      log('ERROR', `重析失败: ${addr} ${err.message}`);
    } finally {
      this._inFlight.delete(addr);
    }
  }
}
