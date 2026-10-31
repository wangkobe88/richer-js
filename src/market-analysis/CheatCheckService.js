/**
 * 作弊盘检测服务（CD1 立项，2026-10-30 用户裁定）——Jev 驱动的买点同步式盘面
 * 健康检测，**观察期 fire-and-forget 纯旁路层：绝不影响买决策**（ObservationSignal
 * Service 纪律；catch 全包绝不 throw 进交易链）。
 *
 * 三分类语义（用户裁定原话）：「作弊盘 / 不健康盘 / 健康盘。其中不健康盘跟健康盘
 * 可以相互转化，买点不同，性质可能会有差异。」——cheat=协同资金主导的既成事实
 * （不可逆）；unhealthy/healthy=时点状态（可转化）→ **每个买点独立 as-of 判定**。
 * **D3.5（2026-10-31）判定层停产**：用户裁定「先不下结论，不把它们分类为 作弊/
 * 不健康 等等，只识别现象，以及现象的强度」——本服务只落观测行（verdict 列=
 * 'observed'；error/timeout 失败行照旧），分类结论待观测数据攒批后再定。
 * ⚠ DDL 红线：cheat_detection 的 verdict CHECK 域须先加 'observed' 再启用写行
 * （表当前 0 行无迁移负担；ALTER 语句见台账 D3.5 行）。
 *
 * 与叙事 token 级终身缓存的本质差异（时点性 drove 全部缓存设计）：
 * - 重析条件 = `(新tick>0 ∧ 距上次≥minIntervalMs) OR 新tick≥reanalyzeTickDelta`
 *   ——TTL 不作重析触发器（DB 行不自更新，0 新 tick 重析=纯烧配额），降格为
 *   minIntervalMs 限流器；慢票几笔新 tick 隔很久仍会覆盖、快票不打爆
 * - 缓存复用 = 同 question_version ∧ 增量条件未触发；每次真分析=一行 as-of 切片
 *   （cheat_detection 多行历史，转化轨迹=回归研究数据）
 * - anchor = **单次查询返回行数**（一次 select 定锚，绝不允许 count+select 两次
 *   查询——中间新写入即撕裂）；满帽（pullLimit）时行数饱和，增量改判尾行水位
 *   （block:log 变=有新 tick，量未知按满值处理，受顶帽兜底）
 *
 * 时序：买点触发 → settleDelayMs（默认 4s，覆盖 tickBuffer 500ms flush +
 * SenderResolver 0-3s RPC 回查）后拉数——**拉数发生在分析开始而非完成**，尾部
 * 突发簇（恰是触发买点的关键窗口）不能截在 DB 外。
 *
 * 拉数帽：单 tail 查询（链上真序倒序 limit pullLimit=3000）；满帽才补 head 300
 * （launch 窗对作弊检测关键：dev 抢跑/首发簇在头段）——anchor 恒=tail 单次查询
 * 返回行数，head 补充不参与锚（两查询窗缝=保守缺行，接受）。
 *
 * 消费链：wss_price_ticks 单一组装路径（FA 内存 tick 明细仅 5min 滑窗不参与；
 * 实时/离线回归同源 bit-identical）→ cheat-snapshot → cheat-state-builder →
 * JevClient（ESM，dynamic import——NarrativeDirectCaller 先例）→ cheat-result-mapper
 * → insert cheat_detection。
 *
 * 失败语义（观察期）：Jev 失败/超时落 error/timeout 行带 fail_reason（fail-loud
 * 留痕）+ failCooldownMs 冷却，绝不影响买点；DB 写失败 loud warn（行丢=可观测）。
 * minTicks 预门：拉数后 tickCount<8 → 不调 Jev 不落表（unclear 桶留给「有量但
 * 证据矛盾」的真判定）。maxAnalysesPerToken 顶帽（per question_version，DB 行数
 * 兜底 + 进程内计数；error/timeout 行也烧预算——防故障环）。
 *
 * 引擎挂点：_runBuyEvaluation preBuy 通过后、GMGN if 块外（无 GMGN 条件的腿
 * 照样检查、被 GMGN 拒的票也进观察样本）。回测零接线（BacktestEngine 不继承
 * _runBuyEvaluation）。实验 stop 不清理表行（token 级全局资产）。
 */

const { buildSnapshotFromRows } = require('./cheat-snapshot');
const { buildCheatState } = require('./cheat-state-builder');
const { buildObservation } = require('./cheat-result-mapper');

const DEFAULTS = {
  timeoutMs: 30000,          // 单次分析整体超时（Jev 调用为主）
  settleDelayMs: 4000,       // 买点→拉数延迟（tickBuffer flush + sender 回查窗）
  reanalyzeTickDelta: 20,    // 新 tick 硬增量（无视 minIntervalMs 直接触发重析）
  minIntervalMs: 60000,      // 限流器：距上次分析的最小间隔（增量路径）
  minTicks: 8,               // 极新票预门（低于不调 Jev 不落表）
  maxAnalysesPerToken: 20,   // per question_version 分析预算（含 error/timeout 行）
  failCooldownMs: 10000,     // 失败后冷却（冷却期内买点不再发起链）
  pullLimit: 3000,           // tail 拉数帽（anchor=该单次查询返回行数）
  headLimit: 300,            // 满帽时补的首段行数（launch 窗）
};

const TICK_SELECT_COLUMNS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

class CheatCheckService {
  /**
   * @param {Object} [config] - fourmemeWs.cheatCheck 段（flap 实验经 _mergedWsConfig 同键）
   * @param {Object} [logger] - 引擎 logger
   * @param {Object} [deps] - 测试注入口 { dbClient, now, loadLlm }（缺省生产路径：
   *   dbManager service key / Date.now / dynamic import JevClient+题集）
   */
  constructor(config = {}, logger = null, deps = {}) {
    const num = (v, dflt, min = 0) => (Number.isFinite(v) && v >= min ? v : dflt);
    this._enabled = config.enabled === true; // 物化语义：缺段/缺 enabled=关（新机制默认零影响）
    this._timeoutMs = num(config.timeoutMs, DEFAULTS.timeoutMs, 1);
    this._settleDelayMs = num(config.settleDelayMs, DEFAULTS.settleDelayMs);
    this._reanalyzeTickDelta = num(config.reanalyzeTickDelta, DEFAULTS.reanalyzeTickDelta, 1);
    this._minIntervalMs = num(config.minIntervalMs, DEFAULTS.minIntervalMs);
    this._minTicks = num(config.minTicks, DEFAULTS.minTicks, 1);
    this._maxAnalysesPerToken = num(config.maxAnalysesPerToken, DEFAULTS.maxAnalysesPerToken, 1);
    this._failCooldownMs = num(config.failCooldownMs, DEFAULTS.failCooldownMs);
    this._pullLimit = num(config.pullLimit, DEFAULTS.pullLimit, 10);
    this._headLimit = num(config.headLimit, DEFAULTS.headLimit, 10);

    this._logger = logger;
    this._deps = deps;
    this._dbClient = deps.dbClient || null;

    // 进程内状态（重启即清：DB bootstrap 补偿跨进程连续性）
    this._lastAnalysis = new Map();  // token → { questionVersion, anchorTickCount, capped, watermark, analyzedAt, verdict|null, lowTicks? }
    this._analysisCount = new Map(); // token → 已落行数（bootstrap 从 DB 计数起底）
    this._failUntil = new Map();     // token → 冷却截止 ts
    this._inflight = new Map();      // token → Promise（买点并发 join：一条链盖住相邻买点）
    this._bootstrapped = new Set();  // token → 已做 DB 历史回读
    this._promptWritten = new Set(); // `${token}\0${version}` → jev_prompt 已落过（首行全文防线）
    this._llm = null;                // { JevClient, buildCheatQuestions, CHEAT_QUESTIONS_VERSION }

    this.stats = {
      noted: 0, analyzed: 0, skippedInsufficientTicks: 0, skippedQuota: 0,
      cacheReused: 0, cooldownSkipped: 0, rowsWritten: 0, writeFailed: 0,
      timeouts: 0, errors: 0, inflightJoined: 0,
    };
  }

  get enabled() { return this._enabled; }

  /** 引擎买点挂点：同步返回 metadata 轨迹，分析链 fire-and-forget（不抛错） */
  noteBuyPoint(tokenAddress, tokenMeta = {}, context = {}) {
    if (!this._enabled) return { status: 'disabled' };
    const token = String(tokenAddress || '').toLowerCase();
    if (!token) return { status: 'invalid_token' };
    this.stats.noted++;

    const info = { status: 'initiated', settleDelayMs: this._settleDelayMs };
    const last = this._lastAnalysis.get(token);
    if (last) {
      info.lastVerdict = last.verdict ?? null;
      info.lastAnchorTickCount = last.anchorTickCount;
    }

    const existing = this._inflight.get(token);
    if (existing) {
      this.stats.inflightJoined++;
      existing.catch(() => {}); // 双保险（链内自吞，此处防 unhandled rejection）
      return { ...info, status: 'joined_inflight' };
    }
    const chain = this._chain(token, tokenMeta, context)
      .finally(() => this._inflight.delete(token));
    chain.catch(() => {}); // 链内全吞错；此处仅防 unhandled rejection
    this._inflight.set(token, chain);
    return info;
  }

  /** 实验 stop 优雅等流（上限 maxWaitMs——settle+Jev 最长几十秒，不值得堵停机） */
  async drain(maxWaitMs = 5000) {
    const inflight = [...this._inflight.values()];
    if (!inflight.length) return;
    await Promise.race([
      Promise.allSettled(inflight),
      new Promise((r) => setTimeout(r, maxWaitMs)),
    ]);
  }

  // ─────────────────────────── 分析链（全吞错） ───────────────────────────

  async _chain(token, tokenMeta, context) {
    try {
      // 1) settle：尾部突发簇落 DB（tickBuffer 500ms flush + sender 回查 0-3s）
      if (this._settleDelayMs > 0) await new Promise((r) => setTimeout(r, this._settleDelayMs));

      // 2) LLM 模块（ESM dynamic import；失败=机制不可用，loud warn 后静默）
      try {
        await this._ensureLlm();
      } catch (e) {
        this.stats.errors++;
        this._failUntil.set(token, this._now() + this._failCooldownMs);
        this._log('warn', `LLM 模块加载失败，本次跳过 | ${token} ${e?.message || e}`);
        return;
      }

      // 3) 失败冷却
      const failUntil = this._failUntil.get(token) || 0;
      if (this._now() < failUntil) {
        this.stats.cooldownSkipped++;
        return;
      }

      // 4) DB 历史回读（首触补偿跨进程：缓存态 + 预算计数）
      await this._bootstrapHistory(token);

      // 5) 拉数（单查询定锚）
      const pull = await this._pullTicks(token);

      // 6) minTicks 预门（不调 Jev 不落表）
      if (pull.anchorTickCount < this._minTicks) {
        this.stats.skippedInsufficientTicks++;
        this._lastAnalysis.set(token, {
          questionVersion: this._version, anchorTickCount: pull.anchorTickCount,
          capped: pull.capped, watermark: pull.watermark, analyzedAt: this._now(),
          verdict: null, lowTicks: true,
        });
        this._log('info', `ticks 不足跳过（${pull.anchorTickCount}<${this._minTicks}） | ${token}`);
        return;
      }

      // 7) 增量判定（时点性缓存核心）
      const last = this._lastAnalysis.get(token);
      if (last && last.questionVersion === this._version) {
        const newTicks = this._estimateNewTicks(last, pull);
        const ageMs = this._now() - last.analyzedAt;
        const triggered = (newTicks > 0 && ageMs >= this._minIntervalMs) || newTicks >= this._reanalyzeTickDelta;
        if (!triggered) {
          this.stats.cacheReused++;
          return;
        }
      }

      // 8) 预算顶帽
      const done = this._analysisCount.get(token) || 0;
      if (done >= this._maxAnalysesPerToken) {
        this.stats.skippedQuota++;
        this._log('info', `分析预算耗尽（${done}/${this._maxAnalysesPerToken}） | ${token}`);
        return;
      }

      // 9) 快照 + state（createMeta=token_create 行 creator/createTx 兜底，fail-open）
      const createMeta = await this._loadCreateMeta(token);
      const meta = this._normalizeMeta(token, tokenMeta, pull, createMeta);
      const snapshot = buildSnapshotFromRows(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
      const { state } = buildCheatState(snapshot);

      // 10) Jev（超时竞速；迟到结果丢弃防锚重复行）
      const res = await this._runJev(state, this._llm.buildCheatQuestions());
      if (!res.ok) {
        if (res.kind === 'timeout') {
          this.stats.timeouts++;
          await this._writeRow(token, meta, pull, { verdict: 'timeout', failReason: `jev_timeout_${this._timeoutMs}ms` }, null, context, snapshot.derived);
        } else {
          this.stats.errors++;
          await this._writeRow(token, meta, pull, { verdict: 'error', failReason: `jev_error: ${res.error?.message || res.error}` }, null, context, snapshot.derived);
        }
        this._failUntil.set(token, this._now() + this._failCooldownMs);
        this._analysisCount.set(token, done + 1); // 失败也烧预算（防故障环）
        this._lastAnalysis.set(token, {
          questionVersion: this._version, anchorTickCount: pull.anchorTickCount,
          capped: pull.capped, watermark: pull.watermark, analyzedAt: this._now(), verdict: null,
        });
        this._log('warn', `Jev ${res.kind} | ${token} ${res.error?.message || ''}`);
        return;
      }

      // 11) mapper 观测组装 + 落库（D3.5：现象+档位观测记录无 verdict；D3.1 持仓
      //     占比锚随 snapshot.derived 传入——数值事实，重放对拍用）
      let obs;
      try {
        obs = buildObservation(res.result.answers, {
          sameBlockHoldPct: snapshot.derived.sameBlockHoldPct,
          equalBandHoldPct: snapshot.derived.equalBandHoldPct,
        });
      } catch (e) {
        this.stats.errors++;
        await this._writeRow(token, meta, pull, { verdict: 'error', failReason: `mapper: ${e?.message || e}` }, null, context, snapshot.derived);
        this._failUntil.set(token, this._now() + this._failCooldownMs);
        this._analysisCount.set(token, done + 1);
        return;
      }
      await this._writeRow(token, meta, pull, obs, { answers: res.result.answers, model: res.result.model, usage: res.result.usage, state }, context, snapshot.derived);
      this._analysisCount.set(token, done + 1);
      this._lastAnalysis.set(token, {
        questionVersion: this._version, anchorTickCount: pull.anchorTickCount,
        capped: pull.capped, watermark: pull.watermark, analyzedAt: this._now(), verdict: 'observed',
      });
      this.stats.analyzed++;
      const p = obs.phenomena;
      this._log('info', `盘面观测 eq=${p.equal_amount_split} sb=${p.coordinated_sell_back} cr=${p.creator_front_run} sd=${p.sell_dispersion}` +
        ` sbw=${obs.extLevels.stall_burst_wave ?? '—'} tier=${obs.extLevels.amount_tiering ?? '—'} bw=${obs.extLevels.same_block_buy_wave ?? '—'}` +
        ` rat=${obs.extLevels.insider_supply_sell ?? '—'} pump=${obs.extLevels.slow_grind_pump ?? '—'}` +
        ` act=${obs.activityLevel ? obs.activityLevel.bucket : '—'} bd=${obs.bundledDominance ? obs.bundledDominance.bucket : '—'}` +
        ` sbHold=${snapshot.derived.sameBlockHoldPct ?? '—'}% eqHold=${snapshot.derived.equalBandHoldPct ?? '—'}%` +
        ` dom=${snapshot.derived.famousDominanceLevel ?? '—'}${snapshot.derived.famousDominancePct !== null && snapshot.derived.famousDominancePct !== undefined ? `(${snapshot.derived.famousDominancePct}%)` : ''}` +
        ` ticks=${pull.anchorTickCount}${pull.capped ? '+' : ''} | ${token}`);
    } catch (e) {
      // 兜底吞错（观察期纪律：绝不影响交易链）——loud 留痕
      this.stats.errors++;
      this._failUntil.set(token, this._now() + this._failCooldownMs);
      this._log('error', `分析链异常（已吞，不影响交易） | ${token} ${e?.stack || e}`);
    }
  }

  // ─────────────────────────── 内部件 ───────────────────────────

  async _ensureLlm() {
    if (this._llm) return;
    if (this._deps.loadLlm) {
      this._llm = await this._deps.loadLlm();
    } else {
      // CJS→ESM 先例（NarrativeDirectCaller.js:152 惰性动态 import+缓存）
      const mod = await import('../narrative/analyzer/llm/JevClient.mjs');
      const q = await import('./llm/cheat-questions.mjs');
      this._llm = { JevClient: mod.JevClient, buildCheatQuestions: q.buildCheatQuestions, CHEAT_QUESTIONS_VERSION: q.CHEAT_QUESTIONS_VERSION };
    }
  }

  get _version() { return this._llm ? this._llm.CHEAT_QUESTIONS_VERSION : null; }

  _now() { return this._deps.now ? this._deps.now() : Date.now(); }

  _client() {
    if (this._dbClient) return this._dbClient;
    // dbManager service key（anon 被 RLS 静默过滤——红线 3）
    const { dbManager } = require('../../services/dbManager');
    this._dbClient = dbManager.getClient();
    return this._dbClient;
  }

  _log(level, msg) {
    try {
      const fn = (this._logger && this._logger[level]) || console[level] || console.log;
      fn('', 'CheatCheck', msg);
    } catch (_) { /* 日志失败不吞业务 */ }
  }

  /** DB 历史回读：最新有效行续接缓存态 + 行数计数起底预算（首触一次） */
  async _bootstrapHistory(token) {
    if (this._bootstrapped.has(token)) return;
    this._bootstrapped.add(token);
    try {
      const client = this._client();
      const latest = await client.from('cheat_detection')
        .select('verdict,anchor_tick_count,analyzed_at,snapshot_digest')
        .eq('token_address', token)
        .eq('question_version', this._version)
        .eq('is_valid', true)
        .order('analyzed_at', { ascending: false })
        .limit(1);
      if (!latest.error && latest.data && latest.data.length) {
        const row = latest.data[0];
        if (!this._lastAnalysis.has(token)) {
          const digest = row.snapshot_digest || {};
          this._lastAnalysis.set(token, {
            questionVersion: this._version,
            anchorTickCount: row.anchor_tick_count ?? 0,
            capped: digest.capped === true,
            watermark: digest.watermark || null,
            analyzedAt: Date.parse(row.analyzed_at) || 0,
            verdict: row.verdict || null,
          });
        }
      }
      const counted = await client.from('cheat_detection')
        .select('id', { count: 'exact', head: true })
        .eq('token_address', token)
        .eq('question_version', this._version);
      if (!counted.error && Number.isFinite(counted.count)) {
        this._analysisCount.set(token, counted.count);
      }
    } catch (e) {
      this._log('warn', `历史回读失败（按无历史继续） | ${token} ${e?.message || e}`);
    }
  }

  /**
   * 拉数：tail 单查询（链上真序倒序 limit pullLimit）=锚；满帽才补 head（launch 窗）。
   * 行到达序无关，内存重排链上真序（与 buildSnapshotFromRows 双保险）。
   */
  async _pullTicks(token) {
    const client = this._client();
    const tail = await client.from('wss_price_ticks')
      .select(TICK_SELECT_COLUMNS)
      .eq('token_address', token)
      .order('block_number', { ascending: false })
      .order('log_index', { ascending: false })
      .limit(this._pullLimit);
    if (tail.error) throw new Error(`ticks 拉取失败: ${tail.error.message}`);
    const tailRows = tail.data || [];
    if (tailRows.length === 0) {
      return { rows: [], anchorTickCount: 0, capped: false, watermark: null, quoteToken: null };
    }
    if (tailRows.length < this._pullLimit) {
      const rows = tailRows.slice().reverse();
      return {
        rows, anchorTickCount: rows.length, capped: false,
        watermark: this._watermarkOf(rows), quoteToken: this._latestQuoteToken(rows),
      };
    }
    // 满帽：锚=帽值（真总数未知，capped 标记+水位承担增量判定）；补 head 保 launch 窗
    const head = await client.from('wss_price_ticks')
      .select(TICK_SELECT_COLUMNS)
      .eq('token_address', token)
      .order('block_number', { ascending: true })
      .order('log_index', { ascending: true })
      .limit(this._headLimit);
    if (head.error) throw new Error(`ticks 首段拉取失败: ${head.error.message}`);
    const headRows = head.data || [];
    const seen = new Set(tailRows.map((r) => `${r.block_number}:${r.log_index}`));
    const headOnly = headRows.filter((r) => !seen.has(`${r.block_number}:${r.log_index}`));
    const rows = headOnly.concat(tailRows.slice().reverse()); // head 升序全早于 tail
    return {
      rows, anchorTickCount: tailRows.length, capped: true,
      watermark: this._watermarkOf(rows), quoteToken: this._latestQuoteToken(rows),
    };
  }

  _watermarkOf(rowsAsc) {
    const last = rowsAsc[rowsAsc.length - 1];
    if (!last || last.block_number === null || last.block_number === undefined) return null;
    return { block: last.block_number, log: last.log_index ?? null, key: `${last.block_number}:${last.log_index ?? 0}` };
  }

  _latestQuoteToken(rowsAsc) {
    for (let i = rowsAsc.length - 1; i >= 0; i--) {
      if (rowsAsc[i].quote_token) return rowsAsc[i].quote_token;
    }
    return null;
  }

  /** 增量估算：未满帽=行数差；任一侧满帽=行数饱和不可信，改判尾行水位 */
  _estimateNewTicks(last, pull) {
    if (!last) return pull.anchorTickCount;
    if (!pull.capped && !last.capped) return pull.anchorTickCount - last.anchorTickCount;
    if (last.watermark && pull.watermark && last.watermark.key === pull.watermark.key) return 0;
    return this._reanalyzeTickDelta; // 水位变=有新 tick 但量未知，按满值处理（限流+顶帽兜底）
  }

  _normalizeMeta(token, tokenMeta, pull, createMeta = null) {
    return {
      address: token,
      symbol: tokenMeta.symbol || null,
      name: tokenMeta.name || null,
      platform: tokenMeta.platform || null,
      quoteToken: pull.quoteToken || null,
      createdAt: tokenMeta.createdAtMs ? new Date(tokenMeta.createdAtMs).toISOString() : (tokenMeta.createdAt || null),
      // creator：引擎 meta 优先，token_create payload.creator 兜底（D3.9）
      creatorAddress: tokenMeta.creatorAddress || (createMeta && createMeta.creator) || null,
      // D3.9 老鼠仓题原料：创建交易哈希（与 [TICKS] tx= 同域——创建+首买同笔可判）
      createTxHash: (createMeta && createMeta.txHash) || null,
    };
  }

  /**
   * token_create 行读取（D3.9：creator 兜底 + createTxHash 原料）。
   * token 级终身缓存（token_create 不可变）；失败/无行 fail-open 返回 {}
   * （老票/跨平台 payload 写法差异=常态缺席，非错误不告警）。
   */
  async _loadCreateMeta(token) {
    if (this._createMetaCache && this._createMetaCache.has(token)) return this._createMetaCache.get(token);
    let out = {};
    try {
      const client = this._client();
      const r = await client.from('wss_events')
        .select('payload')
        .eq('token_address', token)
        .eq('kind', 'token_create')
        .limit(1);
      const row = r && r.data && r.data[0];
      const p = row && row.payload;
      if (p) {
        out = {
          creator: p.creator || null,
          txHash: p.txHash || p.tx_hash || null,
        };
      }
    } catch { /* fail-open：缺席=常态（老票/事件行缺失） */ }
    if (!this._createMetaCache) this._createMetaCache = new Map();
    this._createMetaCache.set(token, out);
    return out;
  }

  /** Jev 调用 + 超时竞速：超时后迟到的成功/失败结果一律丢弃（锚已记 timeout 行） */
  _runJev(state, questions) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, kind: 'timeout' });
      }, this._timeoutMs);
      this._llm.JevClient.ask(state, questions, { timeoutMs: this._timeoutMs, label: 'cheat-check' }).then(
        (result) => {
          if (!settled) { settled = true; clearTimeout(timer); resolve({ ok: true, result }); }
          else this._log('warn', 'Jev 迟到结果丢弃（超时行已落）');
        },
        (error) => {
          if (!settled) { settled = true; clearTimeout(timer); resolve({ ok: false, kind: 'error', error }); }
          else this._log('warn', `Jev 迟到失败丢弃: ${error?.message || error}`);
        },
      );
    });
  }

  /** 落库（观察 fail-open：写失败 loud warn 不重试不抛） */
  async _writeRow(token, meta, pull, mapped, raw, context, derived) {
    try {
      const promptKey = `${token}\0${this._version}`;
      const isFirst = !this._promptWritten.has(promptKey);
      let buyBnb = 0, sellBnb = 0;
      for (const r of pull.rows) {
        if (r.trade_type === 'buy') buyBnb += r.bnb_amount || 0;
        else sellBnb += r.bnb_amount || 0;
      }
      const digest = {
        tickCount: pull.anchorTickCount,
        capped: pull.capped,
        watermark: pull.watermark,
        quoteToken: pull.quoteToken || null,
        buyBnb: Number(buyBnb.toFixed(4)),
        sellBnb: Number(sellBnb.toFixed(4)),
        // D3.5 观测记录主体（失败行 mapped={verdict,failReason} → 全 null）
        phenomena: mapped.phenomena ?? null,         // 4 现象题档位（观测主键）
        extLevels: mapped.extLevels ?? null,         // 观察题档位（sbw D3.3/tiering D3.7/buy_wave D3.8 容缺 null）
        activityLevel: mapped.activityLevel ?? null, // Jev 活跃度题档位（<D3.5 旧档缺席 null）
        bundledDominance: mapped.bundledDominance ?? null, // Jev 捆绑主导度档位（D3.8；<D3.8 旧档缺席 null）
        anchors: mapped.anchors ?? null,             // 持仓占比数值锚（重放对拍用）
        activity: { // D3.2 代码活跃度原始数值——Jev 档位（activityLevel）的校准对照原料
          ticksPerMin: derived.ticksPerMin ?? null,
          avgTradeBnb: derived.avgTradeBnb ?? null,
          maxGapSec: derived.maxGapSec ?? null,
          level: derived.activityLevel ?? null,
          cv: derived.activityCv ?? null,
          uneven: derived.activityUneven ?? null,
        },
        famous: { // D3.2b 著名钱包单极控盘锚（同上，存原始数值待消费方式裁定）
          holdPct: derived.famousHoldPct ?? null,
          top1Pct: derived.famousTop1Pct ?? null,
          followerPct: derived.famousFollowerPct ?? null,
          dominancePct: derived.famousDominancePct ?? null,
          level: derived.famousDominanceLevel ?? null,
        },
      };
      const row = {
        token_address: token,
        platform: meta.platform || null,
        question_version: this._version,
        // D3.5 判定层停产：观测行 verdict='observed'（mapped 无 verdict 键）；
        // 失败行显式 timeout/error；cheat_detection verdict CHECK 域须含 'observed'（DDL 红线）
        verdict: mapped.verdict ?? 'observed',
        cheat_prob: null, // D3.5 起不产判定概率（列保留历史行）
        pattern_type: null, // D3.5 起不产模式标签（列保留历史行）
        // retail_participation 列已停写（D3.1 题集删 retail 题，2026-10-31 用户裁定）——列保留历史行
        answers_raw: raw ? { answers: raw.answers, model: raw.model || null, usage: raw.usage || null } : null,
        jev_prompt: raw && isFirst ? raw.state : null, // 仅每 (token,version) 首行落全文（无界增长防线）
        snapshot_digest: digest,
        anchor_tick_count: pull.anchorTickCount,
        fail_reason: mapped.failReason || null,
        source_experiment_id: context.experimentId || null,
      };
      const client = this._client();
      const { error } = await client.from('cheat_detection').insert([row]);
      if (error) throw new Error(error.message);
      if (raw && isFirst) this._promptWritten.add(promptKey);
      this.stats.rowsWritten++;
    } catch (e) {
      this.stats.writeFailed++;
      this._log('error', `落库失败（行丢，loud 留痕） | ${token} ${e?.message || e}`);
    }
  }
}

module.exports = { CheatCheckService, CHEAT_CHECK_DEFAULTS: DEFAULTS };
