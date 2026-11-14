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
 * 观测）。minTicks 预门：拉数后 tickCount<6 → 不调 Jev 不落表（T133 7→6；unclear 桶留给
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
  minTicks: 6,               // 极新票预门（低于不调 Jev 不落表；T131 8→7、T133 7→6：ladder v17 t0 6 笔档早臂配套——触发即过预门）
  failCooldownMs: 10000,     // 失败后冷却（冷却期内买点不再发起链）
  pullLimit: 3000,           // tail 拉数帽（anchor=该单次查询返回行数）
  headLimit: 300,            // 满帽时补的首段行数（launch 窗）
  gateAwaitMs: 15000,        // 买点 await 竞速上限（超时 fail-open 放行）
  settleFlushMs: 600,        // waitIdle 模式尾随等待（idle=回查清空≠DB 可见，还差
                             // tickBuffer 500ms flush + INSERT 提交）
};

const TICK_SELECT_COLUMNS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

// CD403 超大量捆绑砸盘承接比臂双线（2026-11-14，T003 memes 案；详见 _exemptDeniedReason 头注⑥）：
// 卖方线 8=BP77 塞单门 STUFFING_MAX_EQ_WALLETS 同线（同块 8+ 钱包=组织性捆绑）；承接比线
// 0.3=BP82 贴锚砸盘臂「达三成=承接形成」同线（严格小于）。定线依据=四基底扫描 sellers ≥8 ∧
// ratio<0.3 唯一命中 T003 双基底、sellers 4~6 六张盈利票全在门外零误伤。
const DUMP_RATIO_MIN_SELLERS = 8;
const DUMP_LOW_ABSORPTION_RATIO = 0.3;
// CD405 burst 捆绑收割臂规模线（2026-11-14 btv111 Request C；详见 _exemptDeniedReason 头注⑦）：
// 去尘捆绑钱包 ≥7=挡（单块或相邻两 slot 合计）——同族线=BP77 塞单门 ≥8/CD403 卖方
// ≥8 的买侧对偶（同块 7+ 独立钱包=组织性捆绑，散户到不了同块规模）
const BURST_BUNDLE_MIN_WALLETS = 7;

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
    // CD389 每信号重判开关（2026-11-09 用户裁定「cheat 检测每一次都重新做，不缓存
    // cheat 的结果，每一次都重新算」——bt-v91 重跑引出；缺省 false 生产零变化）：
    // gateBuyPoint 全部秒回点（拉黑入口秒回/healthy 粘滞/unhealthy 粘滞/bootstrap
    // 复检 4b/4c）绕过恒真调 Jev 重判——走 CD381 forceRecheck 同一通路（重检不再判
    // cheat → _maybeUnblock 解除拉黑可翻案）；配额由 T110 买信号节流天然封顶。
    // 观测计数独立（alwaysRechecks，不混 forceRechecks——CD381 表达式驱动的观测域
    // 不受污染）
    this._alwaysRecheck = !!(config.gate && config.gate.alwaysRecheck);
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
      alwaysRechecks: 0, // CD389 每信号重判（gate.alwaysRecheck 配置驱动秒回绕过计数）
      settleIdleHits: 0, settleIdleTimeouts: 0,  // waitIdle 双模观测（idle 提前出窗/吃满帽）
      shadowAudits: 0, shadowMismatches: 0, shadowErrors: 0, // ② 对拍护栏观测
      strongbackerHits: 0, // CD159 强庄形状首次命中计数（曾经命中粘滞置位数）
      persistSkipped: 0, // persist=false 跳写计数（回测隔离观测）
      activityExemptions: 0, // CD379 活跃度豁免命中计数（每次门决策域变换+1）
      stallBurstExemptions: 0, // CD383 burst 豁免臂命中计数（activity 桶不在豁免集、经 sbw=burst 强形状获豁免的子集）
      exemptDenied: 0, // CD380 不豁免臂命中计数（豁免失效恢复原判：现行 wash+CD400 dump 承接——pump 臂 11-08 四修移除（价格约束移交 BP 门位置门）、holdings 臂三修移除）
      dumpAbsorbDenied: 0, // CD400 贴锚砸出零承接臂命中细分计数（dump_no_absorption；生产触发频率观察）
      burstSellDenied: 0, // CD401 出口段卖压臂命中细分计数（burst_exit_sell_pressure；生产触发频率观察）
      dumpRatioDenied: 0, // CD403 超大量捆绑砸盘承接比臂命中细分计数（dump_low_absorption；生产触发频率观察）
      burstBundleDenied: 0, // CD405 burst 捆绑收割臂命中细分计数（burst_bundled_wave；生产触发频率观察）
      ultraCheatDenied: 0, // CD388/CD391 ultra 档资格收紧命中计数（cheat∧ultra∧burst 不在场=不豁免原判保持；11-09 两度裁定：CD390 曾推广全档、CD391「交易活跃度热，cheat 继续豁免」收回 ultra 单档恢复 high 豁免）
      activityCheatDenied: 0, // CD390 全档资格收紧命中计数——CD391 收回 ultra 单档后本计数停用恒 0，保留键读数连续性
      marketResets: 0, // CD382 截窗命中计数——CD393（11-09 6a1e4567 案）截窗整链退役后停用恒 0，保留键读数连续性
      resetInsufficientRejects: 0, // CD384 fail-closed 拒计数——CD393 退役后停用恒 0，保留键读数连续性
    };
  }

  get enabled() { return this._enabled; }

  /** CD389 每信号重判开关（gate.alwaysRecheck；引擎侧拉黑短路同步放行判据） */
  get alwaysRecheck() { return this._alwaysRecheck === true; }

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
   * - CD389 gate.alwaysRecheck=true（2026-11-09 用户裁定「cheat 检测每一次都
   *   重新做，不缓存 cheat 的结果，每一次都重新算」）：拉黑/粘滞全部秒回点绕过
   *   恒真调重判（forceRecheck 同通路，可翻案）；缺省 false 生产零变化
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
    // 绕过真调重检；重检不再判 cheat=解除拉黑（_maybeUnblock，出/迟到两路统一）。
    // CD389 alwaysRecheck（2026-11-09 用户裁定「cheat 检测每一次都重新做，不缓存
    // cheat 的结果，每一次都重新算」——gate.alwaysRecheck=true 每买信号恒重判，
    // 与 forceRecheck 同通路同语义；opts.forceRecheck 显式真优先，观测计数分账）
    const _force = opts.forceRecheck === true || this._alwaysRecheck === true;
    if (this._gateBlocked.has(token) && !_force) {
      return this._applyActivityExempt(this._blockedResult(token));
    }
    if (opts.forceRecheck === true) this.stats.forceRechecks++; // CD381 重检观测
    else if (this._alwaysRecheck === true) this.stats.alwaysRechecks++; // CD389 观测

    // CD158 粘滞（入口路径——进程内已有 healthy 判定）：秒回不烧 Jev。
    // 重启后内存空 → 首链 _chain 4c 复检兜住（bootstrap 恢复后秒回）。
    // T117（2026-11-05）recheckUnhealthy=false 腿：unhealthy 结论也粘滞秒回拒
    //（省配额；用户裁定「不需重新作弊分析」=unhealthy 不重判直接用已有结论）；
    // 默认缺省 true = CD158 现行行为（unhealthy 每买信号重判）。inflight join
    // 边缘：recheck=false 腿 join 上 recheck=true 腿已起的真析链=拿更细结果，
    // 不烧额外配额，方向安全接受。CD381 forceRecheck：healthy/unhealthy 粘滞
    // 全部绕过（重检语义覆盖 recheckUnhealthy 布尔）；CD389 同绕（每信号重判）
    const lg = this._lastGrade.get(token);
    if (!_force
        && lg && (lg.grade === 'healthy'
        || (opts.recheckUnhealthy === false && lg.grade === 'unhealthy'))) {
      return this._applyActivityExempt(this._stickyResult(token, lg)); // CD379：sticky unhealthy 豁免票同放行
    }

    let chain = this._inflight.get(token);
    if (!chain) {
      // CD389：配置级重判经 opts 归一化透传 _chain（4b/4c bootstrap 秒回同绕过；
      // 显式 opts.forceRecheck 已真则原样透传）
      const _chainOpts = this._alwaysRecheck === true && opts.forceRecheck !== true
        ? { ...opts, forceRecheck: true } : opts;
      chain = this._chain(token, tokenMeta, context, _chainOpts).finally(() => this._inflight.delete(token));
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
   * CD383 burst 豁免资格臂 → **CD397 单条件化（2026-11-11 用户四条裁定）**：
   * 「burst 的判定被代码魔改了，我的建议依然是**不要魔改，用 Jev 判断**」——
   * 代码侧 gap≥50 / 波有力（buy≥0.7 ∨ wallets≥10）/ CD392 CD396 exitVs≤40
   * 三道硬线全部退役，资格=**sbw=burst 单条件**（Jev 在 D3.67 题面按单段绑定
   * 波族事实行判「停滞→紧跟的快速真实买入涌入」是否成立；跨度太长/尘埃流量/
   * 卖出引发流量的排除教学全在题面，锚=burstSecSinceWaveEnd/户均+中位/
   * 波钱包净额+卖回率，代码零硬线）。CD380 wash_pair 不豁免臂与 CD391
   * ultra_cheat denied 照旧在出口/登记点统一优先（资格成立 ≠ 豁免生效）；
   * 豁免总开关（activityExemptLevels 显式 []=关）同盖本臂。
   *
   * CD383 案史（四腿时代，2026-11-08 立 → CD392/D3.66 exitVs 第四腿 → CD397
   * 退役）：高大上 0x838657df t0a 触发被拒引出「长期沉积一朝开始操盘豁免」；
   * 二修 60/1.05/13→50/0.7/10（M4GA 0xba5ed45b 案贴线）；cd392 ad80fb7a 高位
   * 横盘流量波拒；D3.66 判据源全窗首价/波起点价→沉积段出口价（ba5e 3/5 豁免
   * 达成，残差=sbw run-to-run 方差）。v100 族三 14 票取证定案：三锚独立测量
   * （全窗最深 gap+全窗最密波+最后段出口价互不绑定）是结构性病灶——波与静默
   * 可相隔数分钟、全窗最密波可落在拉峰 frenzy；硬线堆叠治不了口径漂移，判读
   * 权归还 Jev（单段绑定锚 D3.67：burstLastGapSec/出口后 60s 最密 5s 波族/
   * secSinceWaveEnd/户均中位/净额卖回率，state 直供）。
   * sbw null/缺席（旧档断代/题未答）→ 不豁免（与 _isActivityExempt bucket
   * null 同哲学：资格授予方向 fail-closed）。
   *
   * **CD398 流向硬腿（2026-11-11 bt-v103 复盘统一裁定③「burst 按分析调整=
   * 流向键硬条件」）**：burst 波的流量必须是**买入主导**——两个净额量任一
   * **净负 = 卖方主导 burst，不授予豁免**：
   * ①`burstWaveNetBnb`（**主判量**，2026-11-11 二修）：波窗自身 Σ(买−卖) BNB
   *   （D3.67 单段绑定波：出口后 60s 最密 5s 窗内全行净流，可负）——卖家发起
   *   的波（谷歌SI 观察 17 案：窗内买 0.007 vs 单笔巨鲸卖 0.590 → -0.583）只有
   *   这个量看得见：首版只查波钱包全窗净额时，波内买家是两笔尘埃小散（净
   * +0.0367/卖回 0）而卖家巨鲸不在波内买家集（只在波内卖）→ 硬腿对立法案
   *   本身失明（对拍实锤：谷歌SI 豁免照旧成立）；波窗全行净流不挑边，卖单
   *   直接进分子。纯卖窗（零 BUY）同样可负照拒。
   * ②`burstWaveWalletNetBnb`（辅助量）：波内买家钱包全窗 Σ(买−卖)（可负）——
   *   拦「波内买入、窗内他处已/后卖出」的卖回形状（与 burstWaveSellBackPct
   *   同原料），TukTuk 8 钱包同步买 +0.455 放 / M4GA +0.491 / 海水#78 +0.304 放。
   * 这是 CD397「判读权归还 Jev」后唯一的代码硬线：流向是「流量涌入非流出」
   * （裁定②原文维度）的机械可判事实（净额符号），与跨度/流量真实度（需 Jev
   * 权衡）不同档——符号无权衡空间，Jev run-to-run 方差（CD319/CD387/ba5e 族）
   * 在卖出波形状上会漏放，硬线兜底。
   * null/undefined（无波/旧档断代/D3.67 前行）→ 容缺照常授予（不扩大收紧面，
   * _exemptDeniedReason 缺席=不触发同哲学）；净额恰 0 → 不拒（零净=无卖出
   * 证据，非卖方主导）。anchors 参数=levelsFromObservation 产物同源透传
   * （obs.anchors → digest 持久化 → bootstrap 重建全链在场）。
   */
  _isStallBurstExempt(levels, anchors) {
    if (!levels) return false;
    if (levels.stallBurstWave !== 1) return false; // sbw=burst（二桶 none=0/burst=1）；null/缺席不豁免
    // CD398 流向硬腿：①波窗自身净流 ②波钱包全窗净额——任一净负=卖方主导不豁免；
    // null/undefined 容缺（旧档防误杀）
    const an = anchors || {};
    const winNet = an.burstWaveNetBnb;
    if (typeof winNet === 'number' && winNet < 0) return false;
    const net = an.burstWaveWalletNetBnb;
    if (typeof net === 'number' && net < 0) return false;
    return true;
  }

  /**
   * CD380 不豁免臂（2026-11-07 用户三条裁定：「pump 不豁免」「出现严重对倒盘
   * （0x06810806 washPair=strong 判例）这种已经检测出来的也不要豁免」
   * 「holdingsBalance 也不豁免（持仓情况的问题，另一个维度）」）：刷量/锁仓
   * 型形状本身制造高活跃度（缓推泵/对倒刷量盘 activity 天然 high/ultra），活跃度
   * 豁免恰好专放这类票——bt-v79 复盘六案 8 个放行买入信号 originalGrade 全∈
   * {cheat,unhealthy} 且全经 CD379 豁免放走（pump/wash/holdings 证据在场）实证。
   * 不豁免臂在场=豁免失效（门决策恢复原判/拉黑登记不跳过/bootstrap 恢复不豁免）：
   * **三臂统一 strong(3) 档（2026-11-08 用户裁定档位修正「三不臂都需要 strong 才
   * 不豁免，moderate 我们之前也不用于判定 cheat 的」——moderate 在 G17 体系从不
   * 参与 cheat 级判定，不豁免臂与 A/J 通道主判线同档；首版 pump/holdings 臂误取
   * moderate 档，0x94ea754b pump=moderate 信号随修正恢复豁免）**：
   * ① pump 臂：**已移除（2026-11-08 第四次裁定「把活跃度高的命中 pump 的依然
   *    豁免掉，但是把信息传入购买前检查，在买入前检查中只允许 near_launch
   *    范围内的价格买入」——slow_grind_pump+burst_spike_concentration 是
   *    作弊盘/强庄盘共同特性，pump 臂拦豁免=强庄盘也进不来；豁免恢复，价格
   *    约束曾移交 BP 门专属位置门（BP42 pumpExempt 透传；**该门已随 BP55
   *    2026-11-09 退役**——用户裁定「这个已经不需要特殊处理了，现在庄盘也
   *    不接受价格高于 40%」：BP48 起①⑤⑧位置门同线 ≤+40，pump 豁免票走盘型
   *    桶位置门即可，专属透传链整段删除）；0xcb70708e/d0fbcc7b/4b3f1f7a 判例
   *    留档为臂移除前行为）**
   * ② wash 臂：washPair 同块对敲 = strong（「同区块刷量」；0x06810806 判例）
   *    ——**仅此一题（2026-11-08 用户裁定收窄「wash 我只是要拦截同区块刷量这
   *    一种情况，不是全部」+「其他的我没说的，依然可以走活跃度豁免」）**：首
   *    版误扩对倒族三题（equalAmountSplit 等额分仓/coordinatedSellBack 协同
   *    卖回），两键退出不豁免臂恢复 CD379 豁免资格；留痕码同步 wash_pair_family
   *    → wash_pair
   * ③ holdings 臂：**已移除（2026-11-08 同日第三次裁定「气死我了，那就 cheat
   *    模块高活跃度豁免 J_holdings_strong」）**：CD382 盘面重置对拍 bt-s01
   *    0x28ad2c7d 复盘——#5 锚（07:15:58 almost_launch 买窗内）activityLevel=
   *    high 且豁免恰被 holdings 臂拦（重置窗内「同块背靠背+等额对组合垄断在场
   *    流通 57.3%」=接盘侧新阵列非刷量形状），holdingsBalance=strong 退出不豁
   *    免臂；J 通道保持 unhealthy 拒买级判定不受影响（0xb788e63b 判例留档为
   *    臂移除前行为）。
   * ④ dump 承接臂（CD400，2026-11-13 btv109 P1「B 承接门」四基底验证立法
   *    批准落地）：锚窗末 ≤60s 存在达标砸块（单块 ≥4 独立卖方（剔聚合路由）
   *    ∧ 块卖额 ≥0.5 BNB）且该块之后（block 严格更大——同块买入=对倒不算承接）
   *    到锚的新买入承接 <0.05 BNB =「组织性拉起→砸出后无人接盘」形状不豁免
   *    （四基底：btv109 7票 −0.27 全亏/btv104 3票 +0.06/btv103-r2 3票 −0.06/
   *    v73 2票 0.00——唯一稳定负向；14/15 张命中票经 activity_high/stall_burst
   *    豁免放行=本臂靶面，原生 healthy 票零影响）。判据=anchors 数值锚
   *    （nearDumpQualBlocks/nearDumpMinAbsorbBnb，计算头注见 cheat-snapshot
   *    CD400 段）；题集/grade 版本零改动（纯代码数值臂，G17 N 通道先例）。
   *    反例处置留档（用户裁定「FOM 要具体情况具体看……这个case可以不救」）：
   *    btv104 T021 FOM +0.0729 的盈利来自 0xbf004bff64725914ee36d03b87d6965b0ced4903
   *    砸块后入场收割一波又撤——本臂拦下=接受。
   * ⑤ 出口段卖压臂（CD401，2026-11-13 btv109 P3 立法——用户裁定原话「burst
   *    的预期本身是上涨后继续涨，如果落下去了，那么就不算有 burst。如果是先卖
   *    后买，两者隔着近，那就是卖出引来了一些买入，这也不符合 burst 的期望。
   *    burst 的期望是用户突然发现了一个好票，或者某个好票开始传播，再或者庄
   *    开始收筹码坐庄。这 burst 中卖出占比高，都不太好，虽然可能会有误伤」）：
   *    出口段（最后 ≥30s 静默段出口→锚整窗，与 D3.67 段定位同锚）卖占比 ≥30%
   *    ∧ 卖额 ≥0.3 BNB = 卖驱动出口不豁免——两族形状都拦：先买后跟卖（涨不下
   *    去，网上南宁/callcat 案）+ 先卖后买（卖出引来买入，MBF 案；burst 波
   *    本身可纯买，卖在波前也算）。**作用域=限 sbw=1 资格**（2026-11-13 落地
   *    对拍后用户二次裁定 A：全通道形状 11 票净 -0.107 转负——SPP×2/比格多栋
   *    三张盈利票均为 activity_high 通道 sbw=0 误拦；sbw 靶面 5 票全止损票
   *    [魔渊/callcat小写/MBF×2/谷歌SI] 净 +0.0377 零误伤=预演「8 票全非正」
   *    口径的对拍定稿；三大赢家 T093/T064/T065 出口卖%=0 天然安全；meem
   *    36%/0.12、小旺 31%/0.24 由卖额 0.3 门保住）。判据=anchors 数值锚
   *    （**CD407 起读 burstWaveSegSellPct/burstWaveSegSellBnb**=burst 流量簇
   *    （段出口行起连续 gap<5s 活跃段），停止 ≥5s 后的卖出不计入——用户裁定
   *    「只考量『这一波突然的流量』即可」；判例 btv113 Cashless 4 买波→9s 停
   *    →卖=簇外不触发；计算头注见 cheat-snapshot CD407 段）；题集/grade 版本
   *    零改动（纯代码数值臂，CD400/G17 N 通道先例第三例）。
   * ⑥ 超大量捆绑砸盘承接比臂（CD403，2026-11-14 btv111 T003 memes
   *    0xf1fc8f44 归因立法——用户裁定原话「这个 case 有非常非常明显的作弊异常
   *    （超大量捆绑砸盘），这种情况，建议直接堵死，不豁免」）：达标砸块卖方
   *    ≥8（DUMP_RATIO_MIN_SELLERS，与 BP77 塞单门 ≥8 同线=同块 8+ 钱包=组织
   *    性捆绑，散户到不了这个同块规模）∧ 承接比（nearDumpMinAbsorbBnb÷
   *    nearDumpWorstSellBnb）< 0.3（与 BP82 贴锚砸盘臂「达三成=承接形成」
   *    同线同义）→ denied 'dump_low_absorption'。CD400 绝对线（承接 <0.05）
   *    只拦承接≈零的形状；T003 形状（23/24 卖方双块 3.62 BNB 砸出、承接
   *    0.2418=19.3%）承接非零但实质无人接——本臂按相对线接棒。**规模线 8 的
   *    定线依据**=四基底（btv103-r2/btv104/btv109/btv111）成交点位全量扫描：
   *    sellers ≥8 ∧ ratio <0.3 唯一命中 T003 双基底（btv109/btv111 同票），
   *    sellers 4~6 的六张 B 带票（왹냥/我画地为牢/富个鸟/TRUMP/無為/trust，
   *    净 +0.04~+0.043 区间=纯误伤成本）全在门外零误伤；C 带放行 26 点中
   *    sellers ≥8 票（POORNANCE/CZ/SI）承接比 0.485~1.498 全 ≥0.3 不受影响
   *    ——0.3 线分离面干净（0.30~0.379 之间无票）。trust（sellers=5 ratio
   *    0.185 −0.045）等小规模砸块低承接票不落本臂=观察攒批。臂序在 CD400 后
   *    =承接 <0.05 的形状留 dump_no_absorption 码更具体；题集/grade 版本零
   *    改动（纯代码数值臂，CD400/CD401/G17 N 通道先例第四例）。
 * ⑦ burst 捆绑收割臂（CD405，2026-11-14 btv111 Request C——用户裁定原话
 *    「Burst 中出现大量捆绑买入（拉高收割），我认为这个形态也要拒绝，这摆明了
 *    不给任何人入场机会，收割的概率很高」+定线「只控制极端情况就好，触发
 *    burst 场景的流动性，去掉 dust，捆绑钱包大于等于 7 的挡住就好。T022 这种，
 *    如果是连续 2 个 slot 数量够了，也可以挡住（但是如果在买入区块看不到
 *    后续的买入，挡不住就算了）」）：波窗（最后 ≥30s 静默段出口后 60s，D3.67
 *    段定位同源）内 单块去尘捆绑钱包 ≥BURST_BUNDLE_MIN_WALLETS(7) ∨ 相邻两
 *    slot（block 差恰 1）去尘合计 ≥7 → denied 'burst_bundled_wave'。去尘=块内
 *    单钱包买入合计 ≥0.01 BNB 才计数（BURST_BUNDLE_WALLET_DUST_BNB，snapshot
 *    计算侧——尘单堆凑的钱包数不算组织性捆绑）+ 剔聚合路由伪钱包。同块 7+
 *    钱包=组织性捆绑拉高（散户到不了同块规模；BP77 塞单门 ≥8/CD403 卖方 ≥8
 *    买侧对偶）；连续 slot 分批=同批 bundler 跨块拆分。**四基底命中面=4 票
 *    全负 Σ−0.0671 零误伤**（Callcat 同块 13w −0.0367 / Crypto Winter 2+6=8
 *    +0.0121 / 网上南宁 6+3 −0.0307 / callcat小 4+3=7 −0.0118）；门外最近
 *    TukTuk 2+4=6、MBF 5+1=6；M4GA 波内 4w+1 尘埃钱包（0.0010）天然门外。
 *    **不限 sbw**（与 CD401 限 sbw=1 刻意不同向：stall_burst 豁免票同拦——
 *    网上南宁/callcat小 两张 stall_burst 止损票在命中面内；user 定线无豁免臂
 *    限定语=统一出口）。T022 后续捆绑在锚后 1s（as-of 锚不可见）挡不住=用户
 *    预接受（「在买入区块看不到后续的买入，挡不住就算了」）留档。判据=
 *    anchors 数值锚（burstWaveBundleMaxWallets/AdjPairSum，计算头注见
 *    cheat-snapshot CD405 段）；题集/grade 版本零改动（纯代码数值臂，
 *    CD400/CD401/CD403/G17 N 通道先例第五例）。
   * 入参=levels 数值投影 + anchors 数值锚（levelsFromObservation 产物；秒回/
   * late/blocked 行同构）；levels null 或键缺席（旧档断代/题未答）→ 不触发=
   * 豁免照常（缺席不扩大收紧面，维持 CD379 原语义）。豁免与收紧全部收在本
   * 模块内部（用户裁定「这种豁免全部在 cheat 检测模块内部进行」——引擎/BP
   * 层零豁免逻辑；pump 臂移除后的价格约束在 BP 门位置门=门链消费侧非本模块）。
   */
  _exemptDeniedReason(levels, anchors) {
    if (!levels) return null;
    const lv = (k) => {
      const v = levels[k];
      return v === null || v === undefined ? 0 : v; // 缺席/断代=none 不触发
    };
    if (lv('washPair') >= 3) return 'wash_pair';
    // CD400 贴锚砸出零承接臂（anchors 数值形状；无达标块/旧档断代 null 容缺=
    // 不触发不扩大收紧面；阈值 0.05=四基底验证线）
    const an = anchors || {};
    if (typeof an.nearDumpQualBlocks === 'number' && an.nearDumpQualBlocks >= 1
      && typeof an.nearDumpMinAbsorbBnb === 'number' && an.nearDumpMinAbsorbBnb < 0.05) {
      return 'dump_no_absorption';
    }
    // CD403 超大量捆绑砸盘承接比臂（T003 归因立法，头注⑥）：同块 8+ 卖方捆绑砸出
    // ∧ 承接比 <0.3（承接/砸卖额，与 BP82「达三成=承接形成」同线）→ 不豁免。
    // 规模线 8=BP77 塞单门同线（四基底扫描唯一命中 T003、sellers 4~6 六票零误伤，
    // 定线依据见头注⑥）；承接 <0.05 已被上一臂更具体地拦（本臂只接承接非零但
    // 实质无人接的形状）；卖额门 ≥0.5 在 nearDump 资格块已含（六键前置条件）。
    if (typeof an.nearDumpQualBlocks === 'number' && an.nearDumpQualBlocks >= 1
      && typeof an.nearDumpWorstSellers === 'number' && an.nearDumpWorstSellers >= DUMP_RATIO_MIN_SELLERS
      && typeof an.nearDumpMinAbsorbBnb === 'number'
      && typeof an.nearDumpWorstSellBnb === 'number' && an.nearDumpWorstSellBnb > 0
      && an.nearDumpMinAbsorbBnb / an.nearDumpWorstSellBnb < DUMP_LOW_ABSORPTION_RATIO) {
      return 'dump_low_absorption';
    }
    // CD401 出口段卖压臂（burst 期望=纯流入驱动；卖占比 ≥30% ∧ 卖额 ≥0.3——
    // 卖额门保护 meem 0.12/小旺 0.24 级小卖压、卖%门拦谷歌SI 99% 纯卖出口；
    // 无静默段/旧档断代 null 容缺不触发；臂序在 dump 后=双中票留 dump 码更具体）。
    // **CD407 判据源改读 burst 流量簇三键**（2026-11-14 btv113 Cashless 案二修）：
    // 审查对象从「出口段→锚整窗」收紧为「这一波突然的流量」——簇=段出口行起
    // 连续 gap<5s 活跃段（BURST_WAVE_TAIL_GAP_SEC），停止一段时间（≥5s）后的
    // 卖出不是 burst 的一部分、不计入卖压分子分母（用户裁定「只考量『这一波
    // 突然的流量』即可……burst 只是让盘面通过了，但是它的反作弊审查，这几个
    // 卖出不应该参与的」）；判例 Cashless 11:34:32-33 波 4 买 0.7412 → gap 9s
    // 切断 → 簇内卖=0 臂不触发（旧口径出口整窗 30.3%/0.4082 贴线误拦 healthy
    // 形态票）。**量线不动**（SellPct≥30 ∧ SellBnb≥0.3 ∧ sbw=1）：快买快卖
    // （波后紧跟卖出在簇内）与簇内强卖压照拦=反作弊立法本旨不变；旧
    // burstExitSeg 三键降纯观察（历史档重放兼容，D3.66 先例）。
    // **作用域限 sbw=1 资格**（2026-11-13 对拍后用户裁定 A）：denied 只对 Jev
    // 判了停滞突发波（stallBurstWave==1）的豁免票生效=忠实 burst 立法语境；
    // 全通道形状（CD380/CD400 同构）对拍四基底 11 票净 -0.107——SPP×2/比格
    // 多栋三张盈利票（activity_high 通道 sbw=0）误拦 -0.189 吃掉全部止损收益
    // +0.082；sbw 靶面 5 票全止损票（魔渊/callcat小写/MBF×2/谷歌SI）净
    // +0.0377 零误伤。activity_high 通道 sbw=0 的止损票（Q币安/Callcat大写/
    // 蝴蝶2.0 合计 +0.044）一并放行=知情取舍（与 dump 臂刻意不同向：CD400
    // 立法验证就是全通道且四基底净负 -0.27 全拦为正）
    if (lv('stallBurstWave') === 1
      && typeof an.burstWaveSegSellPct === 'number' && an.burstWaveSegSellPct >= 30
      && typeof an.burstWaveSegSellBnb === 'number' && an.burstWaveSegSellBnb >= 0.3) {
      return 'burst_exit_sell_pressure';
    }
    // CD405 burst 捆绑收割臂（btv111 Request C，头注⑦）：波窗内单块去尘捆绑钱包
    // ≥7 ∨ 相邻两 slot 去尘合计 ≥7 → 不豁免（「拉高收割不给入场机会」极端形状；
    // 无 ≥30s 静默段/旧档断代 null 容缺不触发；不限 sbw=统一出口，stall_burst
    // 豁免票同拦——网上南宁/callcat小 两张 stall_burst 止损票在命中面内）
    if (typeof an.burstWaveBundleMaxWallets === 'number' && an.burstWaveBundleMaxWallets >= BURST_BUNDLE_MIN_WALLETS) {
      return 'burst_bundled_wave';
    }
    if (typeof an.burstWaveBundleAdjPairSum === 'number' && an.burstWaveBundleAdjPairSum >= BURST_BUNDLE_MIN_WALLETS) {
      return 'burst_bundled_wave';
    }
    return null; // pump 臂已移除（2026-11-08 四修裁定，见头注①）；holdings 臂已移除（三修，头注③）
  }

  /**
   * CD388 ultra 档豁免资格收紧（2026-11-09 用户裁定）→ **CD390 全档推广**
   * （2026-11-09 用户裁定「高活跃度不再豁免 cheat 这种情况，只豁免 unhealthy。
   * cheat 模块的信息也非常有作用，虽然它容易造成误伤，如果发现误伤我们再想
   * 办法解决。所以当前 cheat 只有 burst 豁免」）：**原判 cheat 的票不再享
   * activity 桶豁免**（high/ultra 全档——原判保持 → 拉黑+清仓联动照常），
   * 原判 unhealthy 的票照旧豁免（CD379 原语义）；**cheat 的唯一豁免通道=
   * CD383 burst 臂**（长期沉积一波操盘，M4GA 案语义保留——双臂同中时 burst
   * 通道在场=豁免）。
   *
   * CD388 案史（ultra 档先行实证，CD390 的直接依据）：bt-v90 12 张 activity_
   * ultra 豁免票中亏损 Top1/2/4/5 原判全 cheat、盈利三票原判全 unhealthy——
   * originalGrade 是完美分离器；bt-v91 全档对照（cheat∧activity 两桶全负、
   * unhealthy 两桶全正）把同一分离推广到 high 档。误伤（cheat 原判但真热票）
   * 由 CD389 alwaysRecheck 每信号重判+CD381 重检表达式翻案路径兜住——
   * 「如果发现误伤我们再想办法解决」。
   *
   * 三点同构：_applyActivityExempt 出口 / 拉黑登记点 / bootstrap 恢复点
   * （防「门拒但不拉黑/不触发清仓」分叉，CD380 同款纪律）。本函数=三点共用
   * 子式「cheat 的豁免资格」：burst 臂在场 ∧ CD380 不豁免臂不在场。
   * gradeObservation 规则域/题集版本零改动（观测行照落原始 grade=研究原料）。
   */
  _isCheatBurstExempt(levels, anchors) {
    return this._isStallBurstExempt(levels, anchors) && !this._exemptDeniedReason(levels, anchors);
  }

  /**
   * CD391 cheat 豁免资格单一子式（2026-11-09 用户裁定「交易活跃度热，cheat 继续
   * 豁免」——CD390 全档收紧收回 ultra 单档=CD388 形态恢复）：grade=cheat 票的
   * 豁免资格=（activity 桶命中 ∨ CD383 burst 臂）∧ CD380 不豁免臂不在场，且
   * **ultra 桶 ∧ burst 资格不在场 → false**（刷量机器不豁免=CD388 收紧维持，
   * bt-v90 ultra∧cheat 亏损 Top 实证）。cheat∧high 恢复豁免；双臂同中 burst
   * 在场=豁免。三点同构（出口/拉黑登记/bootstrap）防「门拒但不拉黑」分叉——
   * 出口另有 stats/留痕保留显式分支，本子式供后两点共用（与出口逐案等价）。
   */
  _isCheatExemptEligible(bucket, levels, anchors) {
    const actHit = this._isActivityExempt(bucket);
    if (actHit && bucket === 'ultra' && !this._isCheatBurstExempt(levels, anchors)) return false;
    return (actHit || this._isStallBurstExempt(levels, anchors)) && !this._exemptDeniedReason(levels, anchors);
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
   * **CD390（2026-11-09 用户裁定「高活跃度不再豁免 cheat 这种情况，只豁免
   * unhealthy……当前 cheat 只有 burst 豁免」）**：activity 桶通道对 grade=cheat
   * 全档关闭（CD388 ultra 档收紧推广到 high 档），cheat 的唯一豁免通道=CD383
   * burst 臂（双臂同中 burst 通道在场=豁免）；unhealthy 两通道照旧（CD379 原语义）。
   */
  _applyActivityExempt(res) {
    if (!res || this._activityExemptLevels.size === 0) return res;
    if (res.grade !== 'cheat' && res.grade !== 'unhealthy') return res;
    const act = res.buckets && res.buckets.activityLevel;
    const actHit = this._isActivityExempt(act);
    const stallBurst = this._isStallBurstExempt(res.levels, res.anchors); // CD383/CD397 burst 豁免资格臂（sbw 单条件+CD398 流向硬腿，∨ 并列）
    if (!actHit && !stallBurst) return res;
    const denied = this._exemptDeniedReason(res.levels, res.anchors); // CD380 不豁免臂（CD400 dump 承接臂读 anchors）
    if (denied) {
      this.stats.exemptDenied++;
      if (denied === 'dump_no_absorption') this.stats.dumpAbsorbDenied++; // CD400 细分计数
      if (denied === 'dump_low_absorption') this.stats.dumpRatioDenied++; // CD403 细分计数
      if (denied === 'burst_exit_sell_pressure') this.stats.burstSellDenied++; // CD401 细分计数
      if (denied === 'burst_bundled_wave') this.stats.burstBundleDenied++; // CD405 细分计数
      return { ...res, exemptDenied: denied }; // 原判保持（cheat/unhealthy），留痕供生产对拍
    }
    // CD391（2026-11-09 用户裁定「交易活跃度热，cheat 继续豁免」——CD390 全档
    // 收回 ultra 单档=CD388 形态恢复）：cheat ∧ activity=ultra ∧ burst 资格不在场
    // → 不豁免原判保持 cheat（拉黑+清仓联动照常，exemptDenied='ultra_cheat'）；
    // cheat ∧ high 恢复豁免（code=activity_high）；unhealthy 两桶照旧（CD379 原语义）
    if (res.grade === 'cheat' && actHit && act === 'ultra' && !this._isCheatBurstExempt(res.levels, res.anchors)) {
      this.stats.ultraCheatDenied++;
      return { ...res, exemptDenied: 'ultra_cheat' };
    }
    this.stats.activityExemptions++;
    if (stallBurst) this.stats.stallBurstExemptions++;
    // 双臂同中取 activity 桶为首因（更具体来源）；burst 臂独立命中（桶不在豁免集）
    // 同留 stall_burst 码（CD379 原形状恢复——cheat∧high 豁免 code=activity_high）
    const code = actHit ? `activity_${act}` : 'stall_burst';
    return { ...res, grade: 'healthy', exempt: { code, originalGrade: res.grade } };
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
      const pull0 = await this._pullTicks(token, _anchorMs);
      if (pull0.fromMem && this._auditShadow) {
        this._shadowAudit(token, pull0); // fire-and-forget 对拍护栏（全吞错，不拦截）
      }

      // 5b) CD393（2026-11-09 6a1e4567 案用户裁定「把『代币价格跌到底 ticks 截断』
      //     这个策略去掉吧，否则 ticks 不够，更买入不了了」）：CD382 盘面重置
      //     截窗+CD384 reset_insufficient fail-closed 硬拒**整链退役**——盘面
      //     回到 almost_launch 不再截断证据窗（全窗判定，上一轮形状与重启段
      //     并入同一锚窗由 Jev 权衡），重置后短窗回到天然 insufficient_ticks
      //     fail-open 存量语义；BP 锚窗=全窗从不受截断影响（restart 位置门照常
      //     判）。bt-v83 立法票（30~120s 冲高砸落小票）防线由 T129 27.5 价格门
      //     +BP43 restart 位置门接棒。历史行 digest.marketReset 键读侧兼容（写侧
      //     不再产出）。
      const pull = pull0;

      // 6) minTicks 预门（不调 Jev 不落表；不粘滞——下个买信号可重析；天然短窗
      //    fail-open 放行进 BP=存量语义）
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
          // G8（批次六）burst 波强度三键（D3.67/CD397 起 E 通道弱波臂与豁免四腿
          // 均退役=纯观察；旧全窗口径刻意不动=strongbacker §七.5 统计口径保护）
          burstMaxGapSec: snapshot.derived.maxGapSec,
          burstWaveBuyBnb: snapshot.derived.burstWaveBuyBnb,
          burstWaveWallets: snapshot.derived.burstWaveWallets,
          // CD392 burst 波起点价锚（D3.66 起纯观察——第四腿判据源移交出口价锚）
          burstWaveStartVsLaunchPct: snapshot.derived.burstWaveStartVsLaunchPct,
          // D3.66 burst 起来起点价锚（D3.67/CD397 起第四腿代码门退役=题面
          // 「位置参考」事实；头注见 cheat-snapshot 计算段）
          burstExitVsLaunchPct: snapshot.derived.burstExitVsLaunchPct,
          // D3.67/CD397 单段绑定波族十键（最后 ≥30s 静默段 → 出口后 60s 最密 5s
          // 波 → 波钱包全窗净值/卖回/户均/中位 → 波末距锚点；sbw 题 state 直供+
          // 引擎 cheatBurst 透传原料，头注见 cheat-snapshot 计算段）
          burstLastGapSec: snapshot.derived.burstLastGapSec,
          burstExitWaveFromDt: snapshot.derived.burstExitWaveFromDt,
          burstExitWaveEndDt: snapshot.derived.burstExitWaveEndDt,
          burstExitWaveBuyBnb: snapshot.derived.burstExitWaveBuyBnb,
          burstExitWaveWallets: snapshot.derived.burstExitWaveWallets,
          burstSecSinceWaveEnd: snapshot.derived.burstSecSinceWaveEnd,
          burstWaveWalletNetBnb: snapshot.derived.burstWaveWalletNetBnb,
          burstWaveSellBackPct: snapshot.derived.burstWaveSellBackPct,
          // CD398 二修：波窗自身净流（主判量——卖家发起的波只有此键可见，头注
          // 见 cheat-snapshot 计算段；`_isStallBurstExempt` 硬腿消费）
          burstWaveNetBnb: snapshot.derived.burstWaveNetBnb,
          burstWaveWalletAvgBnb: snapshot.derived.burstWaveWalletAvgBnb,
          burstWaveWalletMedianBnb: snapshot.derived.burstWaveWalletMedianBnb,
          // CD401 出口段卖压三键（burst_exit_sell_pressure 不豁免臂判据源——出口
          // 整窗买/卖/卖%；头注见 cheat-snapshot 计算段）
          burstExitSegBuyBnb: snapshot.derived.burstExitSegBuyBnb,
          burstExitSegSellBnb: snapshot.derived.burstExitSegSellBnb,
          burstExitSegSellPct: snapshot.derived.burstExitSegSellPct,
          // CD407 burst 流量簇三键（burst_exit_sell_pressure 臂判据源 CD407 起改读
          // 本族——「这一波突然的流量」簇内买/卖/卖%；挑键清单=CD405 投影链五点
          // 教训防线：漏挑=mapper 白名单有键仍臂静默失效，单测集成段必配）
          burstWaveSegBuyBnb: snapshot.derived.burstWaveSegBuyBnb,
          burstWaveSegSellBnb: snapshot.derived.burstWaveSegSellBnb,
          burstWaveSegSellPct: snapshot.derived.burstWaveSegSellPct,
          // CD405 burst 捆绑收割两键（burst_bundled_wave 不豁免臂判据源——波窗
          // 单块/相邻两 slot 去尘捆绑钱包数；头注见 cheat-snapshot 计算段）
          burstWaveBundleMaxWallets: snapshot.derived.burstWaveBundleMaxWallets,
          burstWaveBundleAdjPairSum: snapshot.derived.burstWaveBundleAdjPairSum,
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
          // CD400 贴锚组织性砸出零承接锚族六键（dump_no_absorption 不豁免臂判据源，
          // 头注见 cheat-snapshot 计算段）
          nearDumpQualBlocks: snapshot.derived.nearDumpQualBlocks,
          nearDumpMinAbsorbBnb: snapshot.derived.nearDumpMinAbsorbBnb,
          nearDumpWorstSellers: snapshot.derived.nearDumpWorstSellers,
          nearDumpWorstSellBnb: snapshot.derived.nearDumpWorstSellBnb,
          nearDumpWorstSecToAnchor: snapshot.derived.nearDumpWorstSecToAnchor,
          nearDumpWorstSameBlkBuyBnb: snapshot.derived.nearDumpWorstSameBlkBuyBnb,
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
      // CD380 不豁免臂同款收紧：wash 臂在场=豁免失效，恢复登记拉黑（与门决策
      // 出口变换同语义——防「门拒但不拉黑/不触发清仓」分叉）。
      // CD391（2026-11-09「交易活跃度热，cheat 继续豁免」）：cheat 的豁免资格=
      // activity 桶（high 恢复/ultra 单档拒，CD388 形态）∨ burst 臂——单一子式
      // 与出口/bootstrap 三点同构；unhealthy 照旧双通道（均受 CD380 约束）
      const _actBucket = obs.activityLevel ? obs.activityLevel.bucket : null;
      const activityExempt = graded.grade === 'cheat'
        ? this._isCheatExemptEligible(_actBucket, levels, anchors) // CD391：cheat 豁免登记拉黑跳过（CD398 流向腿+CD400 dump 承接臂同判）
        : ((this._isActivityExempt(_actBucket)
            || this._isStallBurstExempt(levels, anchors)) // CD383/CD397 burst 资格臂（CD398 流向硬腿）
          && !this._exemptDeniedReason(levels, anchors));
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
          ? ` 波=段买${snapshot.derived.burstExitWaveBuyBnb ?? '—'}/${snapshot.derived.burstExitWaveWallets ?? '—'}户/gap${snapshot.derived.burstLastGapSec ?? '—'}s` +
            (snapshot.derived.burstSecSinceWaveEnd !== null && snapshot.derived.burstSecSinceWaveEnd !== undefined ? ` 距锚${snapshot.derived.burstSecSinceWaveEnd}s` : '') +
            (snapshot.derived.burstWaveWalletNetBnb !== null && snapshot.derived.burstWaveWalletNetBnb !== undefined ? ` 净${snapshot.derived.burstWaveWalletNetBnb}回${snapshot.derived.burstWaveSellBackPct ?? '—'}%` : '')
          : '') +
        (snapshot.derived.spikeBuyBnb !== null && snapshot.derived.spikeBuyBnb !== undefined
          ? ` 尖刺=买${snapshot.derived.spikeBuyBnb}/${snapshot.derived.spikeWallets}户@t+${snapshot.derived.spikeFromDt}~${snapshot.derived.spikeToDt} 占簇${snapshot.derived.spikeBuyPctInBurst ?? '—'}%/持${snapshot.derived.spikeHoldPctAll ?? '—'}%`
          : '') +
        (snapshot.derived.nearDumpQualBlocks !== null && snapshot.derived.nearDumpQualBlocks !== undefined
          ? ` 贴锚砸=${snapshot.derived.nearDumpQualBlocks}块(最恶性${snapshot.derived.nearDumpWorstSellers}户${snapshot.derived.nearDumpWorstSellBnb}BNB@${snapshot.derived.nearDumpWorstSecToAnchor}s 承接${snapshot.derived.nearDumpMinAbsorbBnb})`
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
        // 豁免集内桶 ∧ wash 臂不在场才不恢复；非豁免桶（mid/low）本来就轮不到豁免，
        // 三臂在场与否不影响恢复拉黑（收紧只作用于「本来要豁免」的票）。
        // CD391（2026-11-09）：cheat 的豁免资格=activity 桶（high 恢复/ultra 单档
        // 拒）∨ burst 臂——_isCheatExemptEligible 单一子式与出口/拉黑登记点三点
        // 同构；此处 grade 恒 'cheat'（cheatSeen 扫描域）
        const cheatLv = cheatDigest ? levelsFromObservation(cheatDigest) : null;
        const cheatLevels = cheatLv ? cheatLv.levels : null;
        if (cheatSeen && !this._isCheatExemptEligible(
          cheatLv && cheatLv.buckets ? cheatLv.buckets.activityLevel : null,
          cheatLevels,
          cheatLv ? cheatLv.anchors : null)) { // CD383/CD391/CD397/CD398：不豁免=恢复拉黑
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
          // CD394 尾窗键（act 题⑦定档主锚判读原料——短窗票照出，见 snapshot 头注）
          nearTail10TickN: derived.nearTail10TickN ?? null,
          nearTail10BnbPerMin: derived.nearTail10BnbPerMin ?? null,
          nearPre20BnbPerMin: derived.nearPre20BnbPerMin ?? null,
          nearTail5TickN: derived.nearTail5TickN ?? null,
          nearTail5BuyN: derived.nearTail5BuyN ?? null,
          nearTail5BuyBnb: derived.nearTail5BuyBnb ?? null,
          nearTail10SellWallets: derived.nearTail10SellWallets ?? null, // CD394 出货臂判读线（末 10s 独立卖侧钱包数，参考 ≥10）
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
