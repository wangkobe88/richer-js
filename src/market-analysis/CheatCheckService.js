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
 * 与叙事 token 级终身缓存的本质差异（CD158 后语义）：
 * - 重析条件 = **每次买信号**（unhealthy/未判定）——增量门/60s 限流已随 CD158
 *   退役，配额由引擎侧 BuySignalThrottle 信号帽（默认 5/token）封顶
 * - 缓存复用 = healthy 同版本粘滞秒回（cheatGrade 不再变化）；每次真分析=一行
 *   as-of 切片（cheat_detection 多行历史，转化轨迹=回归研究数据）
 * - anchor = **单次查询返回行数**（一次 select 定锚，绝不允许 count+select 两次
 *   查询——中间新写入即撕裂）；满帽（pullLimit）时行数饱和，重判锚定尾行水位
 *   （block:log 变=有新 tick，量未知按满值处理）
 *
 * 时序（CD237 双模）：买点触发 → settle——引擎注入 waitIdle（resolver per-token
 * watermark 清空即出窗，settleDelayMs=最长等待帽；正常路径 ~0-1s）→ 拉数——
 * **拉数发生在分析开始而非完成**，尾部突发簇（恰是触发买点的关键窗口）不能截
 * 在数据源外；未注入 waitIdle（独立跑测/旧接线）= 固定 settleDelayMs bit 一致。
 *
 * 拉数双源（CD237，memSource.enabled 默认 false）：注入 pullTicks（collector
 * per-token 行环）→ mem 优先（锚语义与 DB 逐位同构：total≤pullLimit →
 * anchor=total/capped=false；超帽 → anchor=pullLimit/capped=true/headOnly+tail
 * seen 去重拼合），miss 等 settleFlushMs(600ms) flush 边界后回落 DB；auditShadow
 * （默认开）mem hit 后异步 DB 重拉按 watermark 截断对拍 digest——不一致仅 warn
 * 不拦截（灰度护栏）。DB 路径：单 tail 查询（链上真序倒序 limit pullLimit=3000）；
 * 满帽才补 head 300（launch 窗 dev 抢跑/首发簇在头段）——anchor 恒=tail 单次
 * 查询返回行数。
 *
 * 同源红线（CD237 改写）：snapshot 输入口径=**wss_price_ticks 行形状**——排除的
 * 是 FA 聚合口径（仅 5min 滑窗、序列不可重建），**非「任何内存」**：memSource 行
 * 环行=collector `_pushTickRow` 咽喉点的同一行对象同引用（将被 INSERT 的 DB 行
 * 超集，sender 恒终态）——入口径变更理由=同形状同引用即同源。离线回归 runner
 * 自拉 DB 不经本服务（换源对回归零影响）。消费链：行环 / wss_price_ticks →
 * cheat-snapshot → cheat-state-builder → JevClient（ESM，dynamic import——
 * NarrativeDirectCaller 先例）→ cheat-result-mapper → insert cheat_detection。
 *
 * 失败语义：Jev 失败/超时落 error/timeout 行带 fail_reason（fail-loud 留痕）+
 * failCooldownMs 冷却（防故障环），绝不影响买点；DB 写失败 loud warn（行丢=可
 * 观测）。minTicks 预门：拉数后 tickCount<8 → 不调 Jev 不落表（unclear 桶留给
 * 「有量但证据矛盾」的真判定）。顶帽（maxAnalysesPerToken）已随 CD158 退役——
 * 由引擎侧信号帽（buySignalMaxPerToken 默认 5）天然封顶。
 *
 * 引擎挂点：_runBuyEvaluation preBuy 通过后、GMGN if 块前（无 GMGN 条件的腿
 * 照样检查、被 GMGN 拒的票也进样本）。回测零接线（BacktestEngine 不继承
 * _runBuyEvaluation）。实验 stop 不清理表行（token 级全局资产）。
 *
 * ── CD158 重构（2026-11-03 用户裁定）：买信号驱动 + 粘滞判定 ──
 * 交互只发生在买信号发射时刻（预触发通道/观察模式/增量门/顶帽/unhealthy 升级
 * 拉黑全部退役），作弊门=买腿 cheatCheckCondition 因子表达式（GMGN 同构）：
 * - cheat → 进程内拉黑（_gateBlocked 秒回不再烧 Jev）+ 引擎侧持仓清仓联动；
 *   **唯一拉黑来源**（unhealthy 用尽升级已随 CD158 退役）
 * - healthy → **同版本粘滞**：_lastGrade 秒回 {cached:true} 不再重判（重启经
 *   bootstrap 恢复——_chain 内 bootstrap 后粘滞复检兜住首信号窗）
 * - unhealthy / 未判定 → 每次买信号真析重判（无内部节流；配额由引擎侧
 *   BuySignalThrottle 信号帽（默认 5/token）天然封顶）
 * - insufficient_ticks / 冷却 / Jev 失败 → 放行（fail-open，GMGN 层「数据
 *   不可用不得拦买点」同向裁定）
 * 版本域：bootstrap 按 `.eq('question_version', 本版本)` 行查询——题集 bump 后
 * 旧版本行不可见=内存清空，全部代币允许下次买信号重判一次（用户裁定「按题集
 * 版本粘滞」）。⚠ 内存粘滞**免版本比较**：_lastGrade.version 存的是 GRADE 规则
 * 版本（G15，cheat-grade.js），非题集版本——进程内 this._version 恒定，内存态
 * 天然全是当前题集版本，比较恒 false 反而使粘滞永不命中（CD158 实施期修正）。
 * 观察模式（noteBuyPoint）已随 CD158 退役删除——腿不带 cheatCheckCondition 的
 * 实验零分析零落行（数据采集期已收官）。
 */

const { buildSnapshotFromRows } = require('./cheat-snapshot');
const { buildCheatState } = require('./cheat-state-builder');
const { buildObservation } = require('./cheat-result-mapper');
const { gradeObservation, levelsFromObservation, strongbackerShapeHit, STRONGBACKER_RULE_VERSION } = require('./cheat-grade');

const DEFAULTS = {
  timeoutMs: 30000,          // 单次分析整体超时（Jev 调用为主）
  settleDelayMs: 4000,       // 买点→拉数延迟；waitIdle 注入时=最长等待帽（正常路径
                             // ~1s 提前出窗，仅 RPC 劣化/停机兜底时吃满）
  minTicks: 8,               // 极新票预门（低于不调 Jev 不落表）
  failCooldownMs: 10000,     // 失败后冷却（冷却期内买点不再发起链）
  pullLimit: 3000,           // tail 拉数帽（anchor=该单次查询返回行数）
  headLimit: 300,            // 满帽时补的首段行数（launch 窗）
  gateAwaitMs: 15000,        // 买点 await 竞速上限（超时 fail-open 放行）
  settleFlushMs: 600,        // waitIdle 模式尾随等待（idle=回查清空≠DB 可见，还差
                             // tickBuffer 500ms flush + INSERT 提交）
};

const TICK_SELECT_COLUMNS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

// CD379 活跃度豁免合法域（2026-11-07 用户裁定）——与 llm/cheat-questions.mjs 的
// ACTIVITY_LEVELS 同域（ESM 不能静态 require，单测 _test_cheat_gate_engine.cjs
// dynamic import 锁两边一致防漂移）
const ACTIVITY_EXEMPT_DOMAIN = ['low', 'mid', 'high', 'ultra'];
function parseActivityExemptLevels(v) {
  if (v === undefined || v === null) return new Set(['high', 'ultra']);
  if (!Array.isArray(v)) {
    throw new Error(`cheatCheck.gate.activityExemptLevels 须为数组（合法域 ${ACTIVITY_EXEMPT_DOMAIN.join('/')}），got ${typeof v}`);
  }
  for (const x of v) {
    if (!ACTIVITY_EXEMPT_DOMAIN.includes(x)) {
      throw new Error(`cheatCheck.gate.activityExemptLevels 非法档位 '${x}'（合法域 ${ACTIVITY_EXEMPT_DOMAIN.join('/')}；显式 []=关豁免）`);
    }
  }
  return new Set(v);
}

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
    this._minTicks = num(config.minTicks, DEFAULTS.minTicks, 1);
    this._failCooldownMs = num(config.failCooldownMs, DEFAULTS.failCooldownMs);
    this._pullLimit = num(config.pullLimit, DEFAULTS.pullLimit, 10);
    this._headLimit = num(config.headLimit, DEFAULTS.headLimit, 10);

    // 买点 await 竞速上限（gate 段只消费 awaitMs——gate.enabled/unhealthyReanalyses
    // 已随 CD158 退役；门激活=买腿携带 cheatCheckCondition，由引擎判定）
    this._gateAwaitMs = num(config.gate && config.gate.awaitMs, DEFAULTS.gateAwaitMs, 1);
    // CD379 活跃度豁免（2026-11-07 用户裁定「作弊检测豁免所有活跃度在 high 之上的票」）：
    // 门决策域变换——grade∈{cheat,unhealthy} ∧ activityLevel 桶∈豁免集 → 出口变换
    // healthy 放行（exempt 留痕含 originalGrade）；观测行落库保留原始 grade（研究
    // 原料）；豁免命中不登记拉黑（引擎短路/清仓/迟到拉黑自然不触发）。
    // 缺省 ['high','ultra'] 默认生效；显式 []=关；非法值 throw（配置错误 fail-fast
    // 防静默失效——CheatCheckServiceTest CD379 段锁域与题集 ACTIVITY_LEVELS 一致）
    this._activityExemptLevels = parseActivityExemptLevels(config.gate && config.gate.activityExemptLevels);
    this._settleFlushMs = num(config.settleFlushMs, DEFAULTS.settleFlushMs);
    // ② mem 源对拍护栏（默认开）：mem hit 完成分析后异步 DB 重拉按 watermark 对齐比对
    // digest——不一致 warn+计数不拦截（灰度观察期工具，验收后可关）
    this._auditShadow = config.memSource ? config.memSource.auditShadow !== false : true;
    // 回测隔离（backtest.signalGateReal 实验专用，引擎构造时硬编码注入——不走实验
    // config）：persist=false ①禁 _writeRow（cheat_detection 是 token 级全局表，回测
    // 判定行会污染生产 bootstrap/粘滞域）②禁 _bootstrapHistory（生产已判定行的锚窗
    // ≠回测锚窗，复用=秒回错判定+掩盖回测应有轨迹）。进程内粘滞/拉黑/inflight 照常
    this._persist = config.persist !== false;

    this._logger = logger;
    this._deps = deps;
    this._dbClient = deps.dbClient || null;

    // 进程内状态（重启即清：DB bootstrap 补偿跨进程连续性）
    this._failUntil = new Map();     // token → 冷却截止 ts
    this._inflight = new Map();      // token → Promise（买点并发 join：一条链盖住相邻买点）
    this._bootstrapped = new Set();  // token → 已做 DB 历史回读
    this._promptWritten = new Set(); // `${token}\0${version}` → jev_prompt 已落过（首行全文防线）
    this._llm = null;                // { JevClient, buildCheatQuestions, CHEAT_QUESTIONS_VERSION }

    // CD158 粘滞状态（进程内，重启即清；bootstrap 恢复——按当前题集版本过滤）
    this._gateBlocked = new Set();       // token → 拉黑（**仅 cheat 判定**；秒回不烧 Jev）
    this._gateUnhealthyGrades = new Map(); // token → unhealthy 真分析判定次数（纯观测计数，FA cheatUnhealthyGrades 键源；无门效应）
    this._lastGrade = new Map();         // token → { grade, reasons, version, unhealthyGrades, levels, buckets, anchors }（healthy 粘滞源）
    // CD159 强庄形状观察臂（SB1，§七.5）：token → 曾经命中 strongbackerShapeHit
    //（**纯观察零门消费**——FA cheatStrongbackerLike 数据源；进程内存态重启清零，
    // 拱形锚「过窗即逝」的早期命中重启后丢失=已知观察期缺口，信号行 metadata 持久留痕）
    this._strongbackerLike = new Set();

    this.stats = {
      analyzed: 0, skippedInsufficientTicks: 0,
      cooldownSkipped: 0, rowsWritten: 0, writeFailed: 0,
      timeouts: 0, errors: 0, inflightJoined: 0,
      gateNoted: 0, gateBlockedHits: 0, gateTimeouts: 0, gateGraded: 0,
      stickyReused: 0, stickyBootstrapped: 0,
      forceRechecks: 0, unblocked: 0, // CD381 almost_launch 重检（真调次数/翻案解除数）
      settleIdleHits: 0, settleIdleTimeouts: 0,  // waitIdle 双模观测（idle 提前出窗/吃满帽）
      shadowAudits: 0, shadowMismatches: 0, shadowErrors: 0, // ② 对拍护栏观测
      strongbackerHits: 0, // CD159 强庄形状首次命中计数（曾经命中粘滞置位数）
      persistSkipped: 0, // persist=false 跳写计数（回测隔离观测）
      activityExemptions: 0, // CD379 活跃度豁免命中计数（每次门决策域变换+1）
      exemptDenied: 0, // CD380 不豁免臂命中计数（豁免失效恢复原判：pump/wash/holdings）
    };
  }

  get enabled() { return this._enabled; }

  /**
   * CD158 粘滞秒回形状（healthy 不再重判；T117 2026-11-05 泛化 unhealthy 拒买
   * 粘滞——recheckUnhealthy=false 腿不重判省配额秒回拒）：入口与 _chain 内
   * bootstrap 复检两处消费同一形状——{status:'graded', grade, cached:true,
   * reasons, unhealthyGrades, levels, buckets, anchors}（levels/buckets/anchors
   * 供引擎 FA 投影，与真分析返回同构=消费端零分叉）。
   * @private
   */
  _stickyResult(token, lg) {
    this.stats.stickyReused++;
    return {
      status: 'graded', grade: lg.grade, cached: true,
      reasons: lg.reasons ?? [],
      unhealthyGrades: this._gateUnhealthyGrades.get(token) ?? 0,
      levels: lg.levels ?? null, buckets: lg.buckets ?? null, anchors: lg.anchors ?? null,
      strongbackerLike: this._strongbackerLike.has(token) ? 1 : 0, // CD159 观察臂（曾经命中粘滞）
    };
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

  /**
   * 买信号驱动作弊门（CD158 2026-11-03 重构）：买点 await 式判定，竞速 awaitMs：
   * - 拉黑秒回：{status:'graded', grade:'cheat', blocked:true}（不烧 Jev；唯一
   *   拉黑来源=cheat 判定）
   * - **粘滞 healthy 秒回**：同版本 healthy 判定 {status:'graded', cached:true}
   *   不再重判（重启后首链经 bootstrap 恢复 + _chain 内粘滞复检兜住——见
   *   _chain 4c）；**免版本比较**（_lastGrade.version=GRADE 规则版本非题集版本，
   *   内存态天然全当前题集版本，版本域由 bootstrap 的 .eq(question_version) 承担）
   * - unhealthy / 未判定 → 真析（每买信号重判；增量门/顶帽已退役，配额由引擎
   *   侧 BuySignalThrottle 信号帽天然封顶）
   * - 竞速超时：{status:'timeout_fail_open', late:Promise}——**链续跑不终止**，
   *   调用方挂 late.then 补拉黑/清仓/投影（本笔已放行，下轮生效）
   * - 放行态（不拦买，GMGN fail-open 同向）：insufficient_ticks / fail
   *   （llm_load/cooldown/jev_timeout/jev_error/mapper_error）
   * 不抛错（接线级异常由引擎 catch 放行）。
   */
  async gateBuyPoint(tokenAddress, tokenMeta = {}, context = {}, opts = {}) {
    if (!this._enabled) return { status: 'disabled' };
    const token = String(tokenAddress || '').toLowerCase();
    if (!token) return { status: 'invalid_token' };
    this.stats.gateNoted++;

    // CD379 活跃度豁免：出口统一包 _applyActivityExempt（拉黑登记/恢复点已跳过
    // 豁免票，blocked 出口此处为纯防御形状统一——bootstrap 恢复的旧拉黑行以
    // 恢复点的 activity 档检查为准）
    // CD381 forceRecheck（2026-11-08 用户裁定「价格回到 almost_launch 无论上次
    // 结果如何都重检，cheat 可翻案」）：重判条件表达式真→拉黑秒回/粘滞秒回全部
    // 绕过真调重检；重检不再判 cheat=解除拉黑（_maybeUnblock，出/迟到两路统一）
    if (this._gateBlocked.has(token) && opts.forceRecheck !== true) {
      return this._applyActivityExempt(this._blockedResult(token));
    }
    if (opts.forceRecheck === true) this.stats.forceRechecks++; // CD381 重检观测

    // CD158 粘滞（入口路径——进程内已有 healthy 判定）：秒回不烧 Jev。
    // 重启后内存空 → 首链 _chain 4c 复检兜住（bootstrap 恢复后秒回）。
    // T117（2026-11-05）recheckUnhealthy=false 腿：unhealthy 结论也粘滞秒回拒
    //（省配额；用户裁定「不需重新作弊分析」=unhealthy 不重判直接用已有结论）；
    // 默认缺省 true = CD158 现行行为（unhealthy 每买信号重判）。inflight join
    // 边缘：recheck=false 腿 join 上 recheck=true 腿已起的真析链=拿更细结果，
    // 不烧额外配额，方向安全接受。CD381 forceRecheck：healthy/unhealthy 粘滞
    // 全部绕过（重检语义覆盖 recheckUnhealthy 布尔）
    const lg = this._lastGrade.get(token);
    if (opts.forceRecheck !== true
        && lg && (lg.grade === 'healthy'
        || (opts.recheckUnhealthy === false && lg.grade === 'unhealthy'))) {
      return this._applyActivityExempt(this._stickyResult(token, lg)); // CD379：sticky unhealthy 豁免票同放行
    }

    let chain = this._inflight.get(token);
    if (!chain) {
      chain = this._chain(token, tokenMeta, context, opts).finally(() => this._inflight.delete(token));
      chain.catch(() => {}); // 链内全吞错；此处仅防 unhandled rejection
      this._inflight.set(token, chain);
    } else {
      this.stats.inflightJoined++;
    }

    const awaitMs = Number.isFinite(opts.awaitMs) && opts.awaitMs > 0
      ? opts.awaitMs : this._gateAwaitMs;
    const timedOut = Symbol('gate_timeout');
    const result = await Promise.race([
      chain,
      new Promise((r) => setTimeout(() => r(timedOut), awaitMs)),
    ]);
    if (result === timedOut) {
      this.stats.gateTimeouts++;
      // CD379：late 包同款豁免变换——迟到结果若 activity high+ 豁免，_cheatGateLateConsume
      // 收到 healthy 不补拉黑不清仓（原样 chain 会把豁免票错拉黑）；
      // CD381：late 包加翻案变换（forceRecheck 重检迟到翻正同解除拉黑）
      const late = chain.then((r) => this._maybeUnblock(token, this._applyActivityExempt(r)));
      return { status: 'timeout_fail_open', late, strongbackerLike: this._strongbackerLike.has(token) ? 1 : 0 }; // CD159 观察臂（此刻粘滞值；late 完成后可能翻转，投影以 late 消费为准）
    }
    if (result && (result.grade === 'cheat' || result.grade === 'unhealthy' || result.grade === 'healthy')) {
      this.stats.gateGraded++;
    }
    // CD381 翻案统一出口：forceRecheck 重检结果非 cheat ∧ 原拉黑在场 → 解除
    //（非 forceRecheck 路径结果必 cheat 才会拉黑在场，_maybeUnblock 天然 no-op）
    return this._applyActivityExempt(this._maybeUnblock(token, result)); // CD379：chain 结果（含 4b/4c 秒回）统一出口变换
  }

  /**
   * CD381 翻案（2026-11-08 用户裁定「含 cheat 可翻案」）：forceRecheck 重检结果
   * ∈ {healthy, unhealthy} ∧ 拉黑在场 → 解除拉黑（恢复可买；清仓联动不回滚——
   * 已清的仓不自动买回）。非重检路径调用天然 no-op（拉黑只在 cheat 判定登记，
   * 无 forceRecheck 的真析若翻 healthy 说明此前未拉黑）。返回 res 原样+unblocked
   * 留痕（引擎侧同步解引擎 Set）。
   */
  _maybeUnblock(token, res) {
    if (!res || !this._gateBlocked.has(token)) return res;
    if (res.grade !== 'healthy' && res.grade !== 'unhealthy') return res;
    this._gateBlocked.delete(token);
    this.stats.unblocked = (this.stats.unblocked ?? 0) + 1;
    this._logger && this._logger.info && this._logger.info('CheatGate',
      `🔓 CD381 翻案：价格回到 almost_launch 重检 ${res.grade}，解除拉黑恢复可买 | ${token}`);
    return { ...res, unblocked: true };
  }

  /** G1 拉黑查询（引擎买条件评估后短路用——省叙事直调/preBuy 整条链） */
  isGateBlocked(tokenAddress) {
    return this._gateBlocked.has(String(tokenAddress || '').toLowerCase());
  }

  /** CD379 活跃度豁免命中判定（桶∈豁免集；空集恒 false=关；bucket null/缺席不豁免） */
  _isActivityExempt(bucket) {
    return !!bucket && this._activityExemptLevels.size > 0 && this._activityExemptLevels.has(bucket);
  }

  /**
   * CD380 不豁免臂（2026-11-07 用户三条裁定：「pump 不豁免」「出现严重对倒盘
   * （0x06810806 washPair=strong 判例）这种已经检测出来的也不要豁免」
   * 「holdingsBalance 也不豁免（持仓情况的问题，另一个维度）」）：刷量/锁仓
   * 型形状本身制造高活跃度（缓推泵/对倒刷量盘 activity 天然 high/ultra），活跃度
   * 豁免恰好专放这类票——bt-v79 复盘六案 8 个放行买入信号 originalGrade 全∈
   * {cheat,unhealthy} 且全经 CD379 豁免放走（pump/wash/holdings 证据在场）实证。
   * 三臂任一在场=豁免失效（门决策恢复原判/拉黑登记不跳过/bootstrap 恢复不豁免）：
   * **三臂统一 strong(3) 档（2026-11-08 用户裁定档位修正「三不臂都需要 strong 才
   * 不豁免，moderate 我们之前也不用于判定 cheat 的」——moderate 在 G17 体系从不
   * 参与 cheat 级判定，不豁免臂与 A/J 通道主判线同档；首版 pump/holdings 臂误取
   * moderate 档，0x94ea754b pump=moderate 信号随修正恢复豁免）**：
   * ① pump 臂：slowGrindPump = strong（机器缓推；0xcb70708e/d0fbcc7b/4b3f1f7a 判例）
   * ② wash 臂：washPair 同块对敲 = strong（「同区块刷量」；0x06810806 判例）
   *    ——**仅此一题（2026-11-08 用户裁定收窄「wash 我只是要拦截同区块刷量这
   *    一种情况，不是全部」+「其他的我没说的，依然可以走活跃度豁免」）**：首
   *    版误扩对倒族三题（equalAmountSplit 等额分仓/coordinatedSellBack 协同
   *    卖回），两键退出不豁免臂恢复 CD379 豁免资格；留痕码同步 wash_pair_family
   *    → wash_pair
   * ③ holdings 臂：holdingsBalance = strong——持仓维度独立成臂（0xb788e63b
   *    判例 holdingsBalance=strong J 通道同档）
   * 入参=levels 数值投影（levelsFromObservation 产物；秒回/late/blocked 行同构）；
   * levels null 或键缺席（旧档断代/题未答）→ 不触发=豁免照常（缺席不扩大收紧面，
   * 维持 CD379 原语义）。豁免与收紧全部收在本模块内部（用户裁定「这种豁免全部
   * 在 cheat 检测模块内部进行」——引擎/BP 层零豁免逻辑）。
   */
  _exemptDeniedReason(levels) {
    if (!levels) return null;
    const lv = (k) => {
      const v = levels[k];
      return v === null || v === undefined ? 0 : v; // 缺席/断代=none 不触发
    };
    if (lv('slowGrindPump') >= 3) return 'slow_grind_pump';
    if (lv('washPair') >= 3) return 'wash_pair';
    if (lv('holdingsBalance') >= 3) return 'holdings_balance';
    return null;
  }

  /**
   * CD379 活跃度豁免出口变换（2026-11-07 用户裁定「作弊检测豁免所有活跃度在
   * high 之上的票」）：grade∈{cheat,unhealthy} ∧ buckets.activityLevel∈豁免集
   * → healthy 放行——reasons/levels/buckets/anchors 原样保留（审计轨迹），
   * exempt 留痕 { code:'activity_<桶>', originalGrade }。观测行已在 _chain 内
   * 落库（原始 grade=研究原料），仅**门决策域**变换；gradeObservation 规则域
   * 零改动（CHEAT_GRADE_RULES_VERSION 不 bump——豁免不产新档位只改消费侧）。
   * **CD380 收紧（同日用户三条裁定）**：pump/wash/holdings 三臂在场=豁免失效
   * （见 _exemptDeniedReason），原判保持+exemptDenied 留痕——刷量型形状天然
   * 高活跃度，活跃度豁免恰好专放这类票（bt-v79 六案实证），收紧后 grade 恢复
   * 原判。非判定行/未命中/豁免关 → 原样返回。四个出口统一走本变换：入口
   * blocked 秒回 / 入口 sticky 秒回 / chain 结果 / timeout 的 late 包。
   */
  _applyActivityExempt(res) {
    if (!res || this._activityExemptLevels.size === 0) return res;
    if (res.grade !== 'cheat' && res.grade !== 'unhealthy') return res;
    const act = res.buckets && res.buckets.activityLevel;
    if (!this._isActivityExempt(act)) return res;
    const denied = this._exemptDeniedReason(res.levels); // CD380 不豁免臂
    if (denied) {
      this.stats.exemptDenied++;
      return { ...res, exemptDenied: denied }; // 原判保持（cheat/unhealthy），留痕供生产对拍
    }
    this.stats.activityExemptions++;
    return { ...res, grade: 'healthy', exempt: { code: `activity_${act}`, originalGrade: res.grade } };
  }

  // ─────────────────────────── 分析链（全吞错） ───────────────────────────

  async _chain(token, tokenMeta, context, opts = {}) {
    try {
      // 1) settle：尾部突发簇落 DB（tickBuffer 500ms flush + sender 回查 0-3s）
      //    双模（①，2026-11-04）：注入 waitIdle → 等 per-token 回查清空（watermark，
      //    提前出窗 ~1s）；未注入 → 固定 sleep 现状 bit 一致。
      //    尾随 settleFlushMs（等 flush 边界）只在数据源仍 DB 时需要——② mem 源注入
      //    时该等待移交 _pullTicks miss 路径（mem hit 行已定值零额外等待）
      const waitIdle = this._deps.waitIdle;
      if (waitIdle && this._settleDelayMs > 0) {
        const idle = await Promise.race([
          Promise.resolve(waitIdle(token)),
          new Promise((r) => setTimeout(r, this._settleDelayMs)),
        ]);
        if (idle) this.stats.settleIdleHits++;
        else this.stats.settleIdleTimeouts++;
        if (!this._deps.pullTicks) {
          await new Promise((r) => setTimeout(r, this._settleFlushMs));
        }
      } else if (this._settleDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this._settleDelayMs));
      }

      // 2) LLM 模块（ESM dynamic import；失败=机制不可用，loud warn 后静默）
      try {
        await this._ensureLlm();
      } catch (e) {
        this.stats.errors++;
        this._failUntil.set(token, this._now() + this._failCooldownMs);
        this._log('warn', `LLM 模块加载失败，本次跳过 | ${token} ${e?.message || e}`);
        return { status: 'fail', reason: 'llm_load', strongbackerLike: this._strongbackerLike.has(token) ? 1 : 0 };
      }

      // 3) 失败冷却
      const failUntil = this._failUntil.get(token) || 0;
      if (this._now() < failUntil) {
        this.stats.cooldownSkipped++;
        return { status: 'fail', reason: 'cooldown', strongbackerLike: this._strongbackerLike.has(token) ? 1 : 0 };
      }

      // 4) DB 历史回读（首触补偿跨进程：粘滞态/拉黑态/unhealthy 观测计数）
      await this._bootstrapHistory(token);

      // 4b) 拉黑复检（bootstrap 门状态恢复配套）：重启后首链走不到入口内存短路——
      // bootstrap 才从 DB 行恢复拉黑；此处不复检则已拉黑票重启后白烧一次 Jev。
      // 恢复即终态：秒回 graded/blocked（与入口短路同形状，消费端零改动）。
      // CD381 forceRecheck：绕过（almost_launch 重检可翻案）
      if (this._gateBlocked.has(token) && opts.forceRecheck !== true) return this._blockedResult(token);

      // 4c) 粘滞复检（CD158）：重启后首链入口粘滞不命中（内存空）——bootstrap
      // 恢复 healthy _lastGrade 后在此秒回，**不烧 Jev**（无此复检=粘滞语义跨重启
      // 失效一次）。与入口短路同形状（_stickyResult）；T117 recheckUnhealthy=false
      // 腿 unhealthy 同样粘滞（bootstrap 恢复的 unhealthy 也秒回）；
      // CD381 forceRecheck：绕过（同入口语义）
      {
        const lg = this._lastGrade.get(token);
        if (opts.forceRecheck !== true
            && lg && (lg.grade === 'healthy'
            || (opts.recheckUnhealthy === false && lg.grade === 'unhealthy'))) {
          this.stats.stickyBootstrapped++;
          this._log('info', `粘滞 ${lg.grade} 秒回（bootstrap 恢复） | ${token}`);
          return this._stickyResult(token, lg);
        }
      }

      // 5) 拉数（单查询定锚；② mem 源注入时环优先，miss 回落 DB）。
      // anchorMs（回测 as-of 锚，backtest.signalGateReal 链路传入=信号 fire 虚拟
      // 时刻）：DB tail/head 查询均 .lte(block_time) 截窗防前视——回测时 DB 已有
      // 全史，无锚=「最新」行集=马后炮；生产不传=现状 tail（「最新」≈信号时刻）
      const _anchorMs = Number.isFinite(opts.anchorMs) && opts.anchorMs > 0 ? opts.anchorMs : null;
      const pull = await this._pullTicks(token, _anchorMs);
      if (pull.fromMem && this._auditShadow) {
        this._shadowAudit(token, pull); // fire-and-forget 对拍护栏（全吞错，不拦截）
      }

      // 6) minTicks 预门（不调 Jev 不落表；不粘滞——下个买信号可重析）
      if (pull.anchorTickCount < this._minTicks) {
        this.stats.skippedInsufficientTicks++;
        this._log('info', `ticks 不足跳过（${pull.anchorTickCount}<${this._minTicks}） | ${token}`);
        return { status: 'insufficient_ticks', anchorTickCount: pull.anchorTickCount, strongbackerLike: this._strongbackerLike.has(token) ? 1 : 0 };
      }

      // 7) 快照 + state（createMeta=token_create 行 creator/createTx 兜底，fail-open）
      //（CD158：增量门/顶帽已退役——粘滞 healthy 在入口/_chain 4c 秒回、unhealthy/
      //  未判定每买信号真析，配额由引擎侧 BuySignalThrottle 信号帽天然封顶）
      const createMeta = await this._loadCreateMeta(token);
      const meta = this._normalizeMeta(token, tokenMeta, pull, createMeta);
      const snapshot = buildSnapshotFromRows(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
      const { state } = buildCheatState(snapshot);

      // 7b) CD159 强庄形状观察臂（SB1 §七.5）：纯数值规则**零 Jev 依赖**——快照建成
      //     即评（Jev 超时/失败轮照评照粘滞）；任一轮命中即置位（曾经命中粘滞：池票
      //     锚是先升后降拱形，过窗即逝形状靠粘滞保住；评估时机=每买信号重判的递增
      //     锚轮=unhealthy 票天然多轮，正是豁免目标人群）。grade 零消费纯观察。
      if (strongbackerShapeHit(snapshot.derived) && !this._strongbackerLike.has(token)) {
        this._strongbackerLike.add(token);
        this.stats.strongbackerHits++;
        this._log('info', `强庄形状命中（${STRONGBACKER_RULE_VERSION} 曾经命中粘滞，纯观察零门效应） | ${token}`);
      }

      // 8) Jev（超时竞速；迟到结果丢弃防锚重复行）
      const res = await this._runJev(state, this._llm.buildCheatQuestions());
      if (!res.ok) {
        if (res.kind === 'timeout') {
          this.stats.timeouts++;
          await this._writeRow(token, meta, pull, { verdict: 'timeout', failReason: `jev_timeout_${this._timeoutMs}ms` }, null, context, snapshot.derived);
        } else {
          this.stats.errors++;
          await this._writeRow(token, meta, pull, { verdict: 'error', failReason: `jev_error: ${res.error?.message || res.error}` }, null, context, snapshot.derived);
        }
        // 失败冷却（防故障环；不粘滞——下个买信号受冷却后可重析）
        this._failUntil.set(token, this._now() + this._failCooldownMs);
        this._log('warn', `Jev ${res.kind} | ${token} ${res.error?.message || ''}`);
        return { status: 'fail', reason: res.kind === 'timeout' ? 'jev_timeout' : 'jev_error', strongbackerLike: this._strongbackerLike.has(token) ? 1 : 0 };
      }

      // 9) mapper 观测组装 + 落库（D3.5：现象+档位观测记录无 verdict；D3.1 持仓
      //     占比锚随 snapshot.derived 传入——数值事实，重放对拍用）
      let obs;
      try {
        obs = buildObservation(res.result.answers, {
          sameBlockHoldPct: snapshot.derived.sameBlockHoldPct,
          equalBandHoldPct: snapshot.derived.equalBandHoldPct,
          // G6 豁免前提锚（组织买入占比，头注见 snapshot）：sb∪eq 簇买入合计
          // 占锚窗总买 %——豁免须正常用户承接 ≥两成（<80）
          bundleBuyPct: snapshot.derived.bundleBuyPct,
          // D3.28 同块对敲三键（配对数+卖/买占比；无配对→null 轴不适用）
          washPairCount: snapshot.derived.washPairCount,
          washPairSellPct: snapshot.derived.washPairSellPct,
          washPairBuyPct: snapshot.derived.washPairBuyPct,
          // D3.20 单一钱包持仓集中双锚（观测记录/digest 留痕）
          top1HoldSupplyPct: snapshot.derived.top1HoldSupplyPct,
          top1HoldCircPct: snapshot.derived.top1HoldCircPct,
          // D3.32 持仓分布锚族（组合垄断：J 通道 holdings_balance 的数值源，
          // 头注见 snapshot——前二/簇/并集占总供应量% + 前二首买相差秒）
          top2HoldSupplyPct: snapshot.derived.top2HoldSupplyPct,
          top1Top2HoldSupplyPct: snapshot.derived.top1Top2HoldSupplyPct,
          top1Top2FirstBuyGapSec: snapshot.derived.top1Top2FirstBuyGapSec,
          // D3.60 持有者基数三锚（holdings_balance 分层判读原料；头注见 snapshot）
          posHolderCount: snapshot.derived.posHolderCount,
          top1Top2HoldCircPct: snapshot.derived.top1Top2HoldCircPct,
          top3HoldCircPct: snapshot.derived.top3HoldCircPct,
          clusterHoldSupplyPct: snapshot.derived.clusterHoldSupplyPct,
          t1PlusClusterSupplyPct: snapshot.derived.t1PlusClusterSupplyPct,
          // G8（批次六）burst 波强度三键（E 通道弱 burst 代码臂同源数值；
          // burstMaxGapSec=derived.maxGapSec 同一度量换锚名，与波两键成组）
          burstMaxGapSec: snapshot.derived.maxGapSec,
          burstWaveBuyBnb: snapshot.derived.burstWaveBuyBnb,
          burstWaveWallets: snapshot.derived.burstWaveWallets,
          // G8 K/L 通道零买纯卖占比（零买入纯卖出钱包合计÷全窗总卖%）
          noBuySellPct: snapshot.derived.noBuySellPct,
          // D3.50 总交易量占比（÷买+卖合计）——insider 题⑤单钱包隐藏筹码豁免的
          // 伤害量级标尺（additive：观察/审计键，无门侧消费）
          noBuySellVolumePct: snapshot.derived.noBuySellVolumePct,
          // D3.62 聚合路由入口占比（G17 N 通道源锚；头注见 cheat-snapshot）
          routerEntryBuyPct: snapshot.derived.routerEntryBuyPct,
          // D3.35 协同买入参考四键（abnormal_behavior_ratio 题（D3.39 前
          // real_participation）参考数值非门槛，头注见
          // snapshot）+ 创建者曾持峰值锚（holdings_balance 补腿；无 BUY 行=null
          // 链外转入域不可见，绝不以 0 冒充「从未持有」）
          maxBlockBuyCount: snapshot.derived.maxBlockBuyCount,
          maxBlockBuyPct: snapshot.derived.maxBlockBuyPct,
          maxBlockPreGapSec: snapshot.derived.maxBlockPreGapSec,
          sameAmountWalletPct: snapshot.derived.sameAmountWalletPct,
          creatorPeakHoldSupplyPct: snapshot.derived.creatorPeakHoldSupplyPct,
          // D3.41 簇占在场流通两锚（token 域）+ 簇闭环三键（coordinated_sell_back
          // 跨块闭环判读原料；叙事数组 clusterRoundTrips 不进 observation 仅
          // state 渲染，头注见 snapshot）
          sameBlockHoldCircPct: snapshot.derived.sameBlockHoldCircPct,
          equalBandHoldCircPct: snapshot.derived.equalBandHoldCircPct,
          clusterRoundTripPct: snapshot.derived.clusterRoundTripPct,
          clusterRoundTripSellPct: snapshot.derived.clusterRoundTripSellPct,
          clusterRoundTripBlocks: snapshot.derived.clusterRoundTripBlocks,
          // D3.51 burst 尖刺两锚（burst_spike_concentration（A 主判 G15）同源
          // 数值：尖刺买入占簇买入%/尖刺钱包正净占全窗正净%；簇内无买/dt
          // 缺失/Σ正净=0 → null 不冒充，头注见 cheat-snapshot SPIKE_SEC）
          spikeBuyPctInBurst: snapshot.derived.spikeBuyPctInBurst,
          spikeHoldPctAll: snapshot.derived.spikeHoldPctAll,
          // D3.52 锚窗买卖比（strong_backer_pressure 题判读原料——CD159 强庄币锚
          // 观察期：grade 零消费只攒分布；窗口卖=0 → null 比值不适用）
          anchorBuySellRatio: snapshot.derived.anchorBuySellRatio,
          // D3.53 精确等额同块簇三键（CD160：equal_amount_split/same_block_buy_wave
          // 题判读原料——state 事实行+FA 投影同源；叙事数组 exactEqualBlockClusters
          // 不进 observation 仅 state 渲染，clusterRoundTrips 同款）
          exactEqualBlockBuyPct: snapshot.derived.exactEqualBlockBuyPct,
          exactEqualBlockClusterCount: snapshot.derived.exactEqualBlockClusterCount,
          exactEqualBlockMaxWallets: snapshot.derived.exactEqualBlockMaxWallets,
          // D3.57 pump 数值锚族（CD166/CD165/CD175 pump 专项：slow_grind_pump 题
          // 判读原料——state 事实行同源；斜率/perBnb 可为负=躺死阴跌方向证据）
          pumpStablePoints: snapshot.derived.pumpStablePoints,
          pumpStableSpanSec: snapshot.derived.pumpStableSpanSec,
          pumpStableR2: snapshot.derived.pumpStableR2,
          pumpStableSlopePctPerMin: snapshot.derived.pumpStableSlopePctPerMin,
          pumpRisePerBuyBnb: snapshot.derived.pumpRisePerBuyBnb,
          pumpSellTickCountPct: snapshot.derived.pumpSellTickCountPct,
          // D3.58 断流重启段锚族（CD183：≥300s 断流后段内集中度——全窗占比被
          // 前期流量稀释，段内口径单独度量；无 ≥300s 间隙全族 null）
          postStallSpanSec: snapshot.derived.postStallSpanSec,
          postStallBuyBnb: snapshot.derived.postStallBuyBnb,
          postStallBuyerCount: snapshot.derived.postStallBuyerCount,
          postStallFreshBuyerPct: snapshot.derived.postStallFreshBuyerPct,
          postStallEqualClusterPct: snapshot.derived.postStallEqualClusterPct,
          postStallMaxBlockBuyPct: snapshot.derived.postStallMaxBlockBuyPct,
        });
      } catch (e) {
        this.stats.errors++;
        await this._writeRow(token, meta, pull, { verdict: 'error', failReason: `mapper: ${e?.message || e}` }, null, context, snapshot.derived);
        this._failUntil.set(token, this._now() + this._failCooldownMs);
        return { status: 'fail', reason: 'mapper_error', strongbackerLike: this._strongbackerLike.has(token) ? 1 : 0 };
      }
      // G1 分级（2026-11-01 用户裁定：档位→交易三级映射，cheat-grade.js 纯函数；
      // anchorSellCount=锚窗卖笔数现场计数——E 门真实对手盘豁免原料，digest 落档）
      let anchorSellCount = 0;
      for (const r of pull.rows) if (r.trade_type !== 'buy') anchorSellCount++;
      const graded = gradeObservation(obs, {
        famousLevel: snapshot.derived.famousDominanceLevel ?? null,
        famousFollowerTop3Pct: snapshot.derived.famousFollowerTop3Pct ?? null,
        // G6 豁免前提锚：famous∪跟单买入合计占锚窗总买 %（≥80 死盘形状不豁免）
        famousGroupBuyPct: snapshot.derived.famousGroupBuyPct ?? null,
        anchorSellCount,
      });
      obs.grade = graded.grade;
      obs.gradeReasons = graded.reasons;
      obs.gradeVersion = graded.version;
      obs.anchorSellCount = anchorSellCount;

      await this._writeRow(token, meta, pull, obs, { answers: res.result.answers, model: res.result.model, usage: res.result.usage, state }, context, snapshot.derived);
      this.stats.analyzed++;

      // 因子化投影原料（2026-11-01 用户指令）：14 题数值档（FA 出口，D3.35 起
      // 含 abnormal_behavior_ratio（D3.39 前 real_participation））+字符串原值（metadata/日志）+数值锚二十四键
      //（famous 掌控/持仓极不均衡/持仓分布/协同买入参考补点）——
      // 随返回形状透传引擎投影 FA。CD380 起提前到拉黑登记前：不豁免臂读数值档
      //（levelsFromObservation 只读 phenomena/extLevels/extras，与 grade 设值顺序无关）
      const { levels, buckets, anchors } = levelsFromObservation(obs, {
        famousDominancePct: snapshot.derived.famousDominancePct ?? null,
        famousDominanceLevel: snapshot.derived.famousDominanceLevel ?? null,
      });

      // G1 分级消费（CD158 形状）：cheat → 拉黑（终态，含清仓联动由引擎侧
      // 消费）；unhealthy → `_gateUnhealthyGrades` 纯观测计数（FA 键
      // cheatUnhealthyGrades 数据源，**无门效应**——2026-11-03 用户裁定移除
      // 升级拉黑，unhealthy 每个买信号重判直至翻案）
      // CD379 活跃度豁免：grade∈{cheat,unhealthy} ∧ activity 档∈豁免集 → 不登记
      // 拉黑（不 add → 引擎短路/秒回/清仓/迟到拉黑全部自然不触发）；unhealthy
      // 观测计数照记（原始判定轨迹）。判据 obs.activityLevel.bucket 与
      // levelsFromObservation 的 buckets.activityLevel 同源；出口统一变换。
      // CD380 不豁免臂同款收紧：pump/wash/holdings 三臂在场=豁免失效，cheat
      // 恢复登记拉黑（与门决策出口变换同语义——防「门拒但不拉黑/不触发清仓」分叉）
      const activityExempt = this._isActivityExempt(obs.activityLevel ? obs.activityLevel.bucket : null)
        && !this._exemptDeniedReason(levels);
      if (graded.grade === 'cheat' && !activityExempt) {
        this._gateBlocked.add(token);
      } else if (graded.grade === 'unhealthy') {
        const n = (this._gateUnhealthyGrades.get(token) || 0) + 1;
        this._gateUnhealthyGrades.set(token, n);
      }

      this._lastGrade.set(token, {
        grade: graded.grade, reasons: graded.reasons, version: graded.version,
        unhealthyGrades: this._gateUnhealthyGrades.get(token) || 0,
        levels, buckets, anchors,
      });
      const p = obs.phenomena;
      this._log('info', `盘面观测 eq=${p.equal_amount_split} sb=${p.coordinated_sell_back} cr=${p.creator_front_run} sd=${p.sell_dispersion}` +
        ` sbw=${obs.extLevels.stall_burst_wave ?? '—'} tier=${obs.extLevels.amount_tiering ?? '—'} bw=${obs.extLevels.same_block_buy_wave ?? '—'}` +
        ` rat=${obs.extLevels.insider_supply_sell ?? '—'} pump=${obs.extLevels.slow_grind_pump ?? '—'} wash=${obs.extLevels.wash_pair ?? '—'}` +
        ` spike=${obs.extLevels.burst_spike_concentration ?? '—'}` +
        ` sbp=${obs.extLevels.strong_backer_pressure ?? '—'}` +
        ` hold=${obs.extLevels.holdings_balance ?? '—'}(t2:${snapshot.derived.top2HoldSupplyPct ?? '—'}%/Σ2:${snapshot.derived.top1Top2HoldSupplyPct ?? '—'}%/∪:${snapshot.derived.t1PlusClusterSupplyPct ?? '—'}%Δ${snapshot.derived.top1Top2FirstBuyGapSec ?? '—'}s)` +
        ` act=${obs.activityLevel ? obs.activityLevel.bucket : '—'} bd=${obs.bundledDominance ? obs.bundledDominance.bucket : '—'}` +
        ` abr=${obs.abnormalBehavior ? obs.abnormalBehavior.bucket : '—'}` +
        ` sbHold=${snapshot.derived.sameBlockHoldPct ?? '—'}% eqHold=${snapshot.derived.equalBandHoldPct ?? '—'}%` +
        ` wash对=${snapshot.derived.washPairCount ?? 0}对/卖占${snapshot.derived.washPairSellPct ?? '—'}%` +
        ` t1供/流=${snapshot.derived.top1HoldSupplyPct ?? '—'}%/${snapshot.derived.top1HoldCircPct ?? '—'}%` +
        ` dom=${snapshot.derived.famousDominanceLevel ?? '—'}${snapshot.derived.famousDominancePct !== null && snapshot.derived.famousDominancePct !== undefined ? `(${snapshot.derived.famousDominancePct}%)` : ''}${snapshot.derived.famousFollowerTop3Pct !== null && snapshot.derived.famousFollowerTop3Pct !== undefined ? ` top3:${snapshot.derived.famousFollowerTop3Pct}%` : ''}` +
        ` 组织买=${snapshot.derived.bundleBuyPct ?? '—'}%/${snapshot.derived.famousGroupBuyPct ?? '—'}%(簇/famous集团)` +
        ` 纯卖=${snapshot.derived.noBuySellPct ?? '—'}%/量${snapshot.derived.noBuySellVolumePct ?? '—'}%` +
        (obs.extLevels.stall_burst_wave === 'burst'
          ? ` 波=买${snapshot.derived.burstWaveBuyBnb ?? '—'}/${snapshot.derived.burstWaveWallets ?? '—'}户/gap${snapshot.derived.maxGapSec ?? '—'}s`
          : '') +
        (snapshot.derived.spikeBuyBnb !== null && snapshot.derived.spikeBuyBnb !== undefined
          ? ` 尖刺=买${snapshot.derived.spikeBuyBnb}/${snapshot.derived.spikeWallets}户@t+${snapshot.derived.spikeFromDt}~${snapshot.derived.spikeToDt} 占簇${snapshot.derived.spikeBuyPctInBurst ?? '—'}%/持${snapshot.derived.spikeHoldPctAll ?? '—'}%`
          : '') +
        // D3.52 观察期攒数据键：sbp 档位+锚窗买卖比（grade 零消费，分布数据
        // 采实验日志与 cheat_detection 行——豁免规则立法的原料）
        ` 买压=${snapshot.derived.anchorBuySellRatio ?? '—'}` +
        ` sbLike=${this._strongbackerLike.has(token) ? 1 : 0}` +
        ` grade=${graded.grade}${graded.reasons.length ? `(${graded.reasons.map((r) => r.code).join(',')})` : ''}` +
        ` ticks=${pull.anchorTickCount}${pull.capped ? '+' : ''} | ${token}`);
      return {
        status: 'analyzed', grade: graded.grade, reasons: graded.reasons,
        unhealthyGrades: this._gateUnhealthyGrades.get(token) || 0,
        levels, buckets, anchors,
        strongbackerLike: this._strongbackerLike.has(token) ? 1 : 0, // CD159 观察臂（曾经命中粘滞值）
      };
    } catch (e) {
      // 兜底吞错（观察期纪律：绝不影响交易链）——loud 留痕
      this.stats.errors++;
      this._failUntil.set(token, this._now() + this._failCooldownMs);
      this._log('error', `分析链异常（已吞，不影响交易） | ${token} ${e?.stack || e}`);
      return { status: 'fail', reason: 'chain_error', strongbackerLike: this._strongbackerLike.has(token) ? 1 : 0 };
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
    // ⚠ 路径事故锁（2026-11-02 v67 首日现场）：market-analysis 在 src/ 下，services
    // 同层须一层 ../（曾写成 ../../services 解析到项目根 services → MODULE_NOT_FOUND，
    // 链内吞错 43 次分析全灭零表行；单测 deps.dbClient 注入短路本路径=漏网，源码
    // 口径断言在 _test_cheat_detection_service 顶部防线段）
    const { dbManager } = require('../services/dbManager');
    this._dbClient = dbManager.getClient();
    return this._dbClient;
  }

  _log(level, msg) {
    try {
      // ⚠ receiver 绑定锁（2026-11-02 v67 现场二次发现）：class 方法摘出直调
      // this=undefined（class 体严格模式）→ `this.log` TypeError 被 catch 吞 =
      // 「盘面观测」/「分析链异常」/「落库失败」自上线起零日志输出（检测/落表
      // 本身正常）；单测注入 plain-object 箭头函数 logger 测不出。方法调用形式
      // （member call）天然带 receiver=logger；console 兜底不受影响。
      if (this._logger && this._logger[level]) {
        this._logger[level]('', 'CheatCheck', msg);
      } else {
        (console[level] || console.log)('', 'CheatCheck', msg);
      }
    } catch (_) { /* 日志失败不吞业务 */ }
  }

  /**
   * 拉黑秒回形状（入口短路×2 + 链内 bootstrap 复检共用）：终值 grade/levels/
   * anchors 透传（消费端与 analyzed/reused 同构；投影在产生拉黑的那次链完成时
   * 已做过或已由 bootstrap 恢复，此处无需再投影）
   */
  _blockedResult(token) {
    this.stats.gateBlockedHits++;
    const lg = this._lastGrade.get(token);
    return {
      status: 'graded', grade: 'cheat', blocked: true,
      reasons: [{ level: 'cheat', code: 'gate_blocked' }],
      unhealthyGrades: this._gateUnhealthyGrades.get(token) ?? 0,
      levels: lg ? lg.levels ?? null : null,
      buckets: lg ? lg.buckets ?? null : null,
      anchors: lg ? lg.anchors ?? null : null,
      strongbackerLike: this._strongbackerLike.has(token) ? 1 : 0, // CD159 观察臂（拉黑票形状留档——误豁研究原料）
    };
  }

  /**
   * DB 历史回读（首触一次）：CD158 语义下只恢复两态——cheat 拉黑（终态，
   * 引擎信号短路+门秒回）与 healthy 粘滞（`_lastGrade`，秒回不烧 Jev）+
   * unhealthy 观测计数（FA cheatUnhealthyGrades 数据源）。unhealthy 不再
   * 拉黑（2026-11-03 用户裁定移除升级臂）——重启后照常下次买信号重判。
   * 版本域由查询 `.eq('question_version')` 承担：题集 bump 后旧版本行
   * 不可见 → 粘滞/拉黑自然失效一次（允许重判，设计内）。
   */
  async _bootstrapHistory(token) {
    if (this._bootstrapped.has(token)) return;
    // persist=false（回测隔离）：禁读生产历史行——生产判定锚窗≠回测锚窗，粘滞/拉黑
    // 复用=秒回错判定+掩盖回测应有轨迹；回测进程内粘滞自行建立
    if (!this._persist) { this._bootstrapped.add(token); return; }
    this._bootstrapped.add(token);
    try {
      const client = this._client();
      // 行级拉取（最新优先；error/timeout 行无 grade 天然不入扫描——拉黑扫描
      // 需「任意 cheat 行在场」，粘滞恢复需「最新带 grade 行」，固定 8 行窗口足够
      const latest = await client.from('cheat_detection')
        .select('verdict,analyzed_at,snapshot_digest')
        .eq('token_address', token)
        .eq('question_version', this._version)
        .eq('is_valid', true)
        .order('analyzed_at', { ascending: false })
        .limit(8);
      const rows = (!latest.error && latest.data) || [];
      if (rows.length) {
        // 门状态恢复（版本域）：cheat 行在场 → 拉黑；unhealthy 只恢复观测计数
        let unhealthy = 0;
        let cheatSeen = false;
        let cheatDigest = null; // 最新 cheat 行 digest（rows 时间倒序，首个=最新）
        for (const r of rows) {
          const g = r.snapshot_digest && r.snapshot_digest.grade;
          if (g === 'cheat') { cheatSeen = true; cheatDigest ||= r.snapshot_digest; }
          else if (g === 'unhealthy') unhealthy++;
        }
        this._gateUnhealthyGrades.set(token, unhealthy);
        // CD379：恢复拉黑同查活跃度豁免——豁免配置上线前落的 cheat 行 activity
        // high+ 不再恢复拉黑（下个买信号重判走正常链）；digest.activityLevel.bucket
        // 与判定行同源。CD380 不豁免臂同款且同构（activityExempt = isExempt && !denied）：
        // 豁免集内桶 ∧ 三臂不在场才不恢复；非豁免桶（mid/low）本来就轮不到豁免，
        // 三臂在场与否不影响恢复拉黑（收紧只作用于「本来要豁免」的票）
        if (cheatSeen && !(this._isActivityExempt(cheatDigest && cheatDigest.activityLevel && cheatDigest.activityLevel.bucket)
          && !this._exemptDeniedReason(cheatDigest ? levelsFromObservation(cheatDigest).levels : null))) {
          this._gateBlocked.add(token);
        }
        // _lastGrade 恢复（最新带 grade 行）：cheat 拉黑秒回/healthy 粘滞秒回/
        // unhealthy 投影不缺位（下次信号重判覆盖）
        const gradedRow = rows.find((r) => r.snapshot_digest && r.snapshot_digest.grade);
        if (gradedRow && !this._lastGrade.has(token)) {
          const d = gradedRow.snapshot_digest;
          const { levels, buckets, anchors } = levelsFromObservation(d, {
            famousDominancePct: (d.anchors && d.anchors.famousDominancePct) ?? null,
            famousDominanceLevel: (d.anchors && d.anchors.famousDominanceLevel) ?? null,
          });
          this._lastGrade.set(token, {
            grade: d.grade, reasons: d.gradeReasons || [], version: d.gradeVersion || this._version,
            unhealthyGrades: unhealthy, levels, buckets, anchors,
          });
        }
      }
    } catch (e) {
      this._log('warn', `历史回读失败（按无历史继续） | ${token} ${e?.message || e}`);
    }
  }

  /**
   * 拉数（双源 ②，2026-11-04）：deps.pullTicks 注入（引擎 collector 行环）→ mem 优先
   * （环行=进程已定值全量，含未 flush 行——锚=拉数时刻进程已知行数，比 DB 路径更完整；
   * 同源红线：排除的是 FA 聚合口径，非「任何内存」——环行=将被 INSERT 的同一对象）；
   * miss（重启后环空/断流清扫后）→ 等 settleFlushMs 边界（等 buffer flush+INSERT）
   * 再走 DB 现状路径（watermark/quoteToken 口径单点复用）。
   */
  async _pullTicks(token, anchorMs = null) {
    const pullMem = this._deps.pullTicks;
    if (pullMem) {
      const mem = await pullMem(token);
      if (mem && Array.isArray(mem.rows) && mem.rows.length > 0) {
        return {
          rows: mem.rows, anchorTickCount: mem.anchorTickCount, capped: !!mem.capped,
          watermark: this._watermarkOf(mem.rows), quoteToken: this._latestQuoteToken(mem.rows),
          fromMem: true,
        };
      }
      // miss：环无该票——直接回落 DB 会拉到缺尾部行的集合（buffer 未 flush），
      // 等一个 flush 边界再拉（与 waitIdle 模式尾随等待同源语义）
      await new Promise((r) => setTimeout(r, this._settleFlushMs));
    }
    return this._pullTicksDb(token, anchorMs);
  }

  /**
   * 拉数（DB 路径）：tail 单查询（链上真序倒序 limit pullLimit）=锚；满帽才补 head
   * （launch 窗）。行到达序无关，内存重排链上真序（与 buildSnapshotFromRows 双保险）。
   * anchorMs（回测 as-of 锚）非空时两查询均 .lte(block_time) 截窗——锚计数语义
   * 不变（≤anchor 行中最新 pullLimit 行）；null=现状生产 tail 语义。
   */
  async _pullTicksDb(token, anchorMs = null) {
    const client = this._client();
    const anchorIso = anchorMs != null ? new Date(anchorMs).toISOString() : null;
    let tailQ = client.from('wss_price_ticks')
      .select(TICK_SELECT_COLUMNS)
      .eq('token_address', token);
    if (anchorIso) tailQ = tailQ.lte('block_time', anchorIso);
    const tail = await tailQ
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
    let headQ = client.from('wss_price_ticks')
      .select(TICK_SELECT_COLUMNS)
      .eq('token_address', token);
    if (anchorIso) headQ = headQ.lte('block_time', anchorIso);
    const head = await headQ
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

  /**
   * ② 对拍护栏（auditShadow，默认开）：mem hit 完成拉数后异步 sleep(settleDelayMs+2s)
   * 用 DB 路径重拉同 token，按 mem watermark 截断对齐（mem 拉数后新到 tick 不参与
   * 对拍），比对行集 digest（block:log:trader:sender:bnb:type:price:outlier）——
   * 不一致 warn+计数（不拦截不重试）；DB 侧缺行=flush/INSERT 故障信号，mem 侧多行
   * 未落库=正常瞬态（等待窗覆盖）。灰度观察期工具，验收后可关。
   */
  async _shadowAudit(token, memPull) {
    try {
      await new Promise((r) => setTimeout(r, this._settleDelayMs + 2000));
      const dbPull = await this._pullTicksDb(token);
      this.stats.shadowAudits++;
      const wm = memPull.watermark;
      if (!wm) return; // 无链上水位（block 缺失）无可比性，跳过不误报
      const dbAligned = dbPull.rows.filter((r) => {
        const b = r.block_number ?? Number.MAX_SAFE_INTEGER;
        if (b !== wm.block) return b < wm.block;
        return (r.log_index ?? 0) <= (wm.log ?? 0);
      });
      const digest = (rows) => rows.map((r) =>
        `${r.block_number}:${r.log_index}:${r.trader_address}:${r.sender_address ?? 'null'}:${r.bnb_amount}:${r.trade_type}:${r.price_bnb}:${r.price_outlier ?? false}`).join(';');
      if (digest(dbAligned) !== digest(memPull.rows)) {
        this.stats.shadowMismatches++;
        this._log('warn', `memSource 对拍不一致 | ${token} mem=${memPull.rows.length}行 capped=${memPull.capped}锚=${memPull.anchorTickCount} db对齐=${dbAligned.length}行（DB 侧缺行=flush 故障信号；mem 多行未落库=瞬态）`);
      }
    } catch (e) {
      this.stats.shadowErrors++;
    }
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

  _normalizeMeta(token, tokenMeta, pull, createMeta = null) {
    return {
      address: token,
      symbol: tokenMeta.symbol || null,
      name: tokenMeta.name || null,
      platform: tokenMeta.platform || null,
      quoteToken: pull.quoteToken || null,
      createdAt: tokenMeta.createdAtMs ? new Date(tokenMeta.createdAtMs).toISOString() : (tokenMeta.createdAt || null),
      // D3.20 持仓集中双锚分母：引擎 FA state.totalSupply（TokenCreate 注入；
      // flap/gang=collector 平台恒 1e9）；缺失 null fail-closed
      totalSupply: tokenMeta.totalSupply ?? null,
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
    // persist=false（回测隔离）：绝不写 cheat_detection 全局表（防污染生产
    // bootstrap/粘滞判定域）；判定轨迹由引擎侧 signal metadata（cheatCheck 段）留档
    if (!this._persist) { this.stats.persistSkipped++; return; }
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
        abnormalBehavior: mapped.abnormalBehavior ?? null, // Jev 异常行为占比档位（D3.39 改名 real_participation→abnormal_behavior_ratio；旧档 digest.participation 键断代不映射——G13 R 通道重放对拍原料）
        anchors: mapped.anchors ?? null,             // 持仓占比数值锚（重放对拍用）
        // G1 分级（2026-11-01：档位→交易三级映射；失败行/观察模式旧路径无键=null）
        grade: mapped.grade ?? null,
        gradeReasons: mapped.gradeReasons ?? null,
        gradeVersion: mapped.gradeVersion ?? null,
        anchorSellCount: mapped.anchorSellCount ?? null,
        strongbackerLike: this._strongbackerLike.has(token) ? 1 : 0, // CD159 SB1 观察臂粘滞值（本轮刻度；研究对拍原料，与 signal metadata 双源）
        activity: { // D3.2 代码活跃度原始数值——Jev 档位（activityLevel）的校准对照原料
          ticksPerMin: derived.ticksPerMin ?? null,
          avgTradeBnb: derived.avgTradeBnb ?? null,
          maxGapSec: derived.maxGapSec ?? null,
          idlePct: derived.idlePct ?? null, // D3.49 无交易期占比（间隔≥20s 静默段÷窗长；CD110 漏判数值化）
          spanSec: derived.spanSec ?? null, // D3.55 窗口时长（act 题④开盘极早窗反锚阈值原料，CD162）
          tickCount: derived.tickCount ?? null, // D3.55 窗口总笔数（同上）
          buyMedianBnb: derived.buyMedianBnb ?? null, // D3.59 买盘中位（act ③尘埃判读主判据数值化）
          throughputBnbPerMin: derived.throughputBnbPerMin ?? null, // D3.59 金额吞吐（act ⑤）
          maxDrawdownPct: derived.maxDrawdownPct ?? null, // D3.59 窗内最大回撤（act ④）
          nearSegTickN: derived.nearSegTickN ?? null, // D3.59 临近段（末端 30s）笔数
          nearSegTicksPerMin: derived.nearSegTicksPerMin ?? null,
          nearSegBuyMedianBnb: derived.nearSegBuyMedianBnb ?? null,
          nearSegBnbPerMin: derived.nearSegBnbPerMin ?? null,
          nearSegMaxGapSec: derived.nearSegMaxGapSec ?? null,
          nearSegBuyN: derived.nearSegBuyN ?? null,
          nearSegSellN: derived.nearSegSellN ?? null,
          level: derived.activityLevel ?? null,
          cv: derived.activityCv ?? null,
          uneven: derived.activityUneven ?? null,
        },
        famous: { // D3.2b 著名钱包单极控盘锚（同上，存原始数值待消费方式裁定）
          holdPct: derived.famousHoldPct ?? null,
          top1Pct: derived.famousTop1Pct ?? null,
          followerPct: derived.famousFollowerPct ?? null,
          followerTop3Pct: derived.famousFollowerTop3Pct ?? null,
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
