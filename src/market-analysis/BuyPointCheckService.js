/**
 * 买入点位分析服务（BP1 引擎融合，T117 2026-11-05 用户裁定「买入策略整体调整」）
 * ——Jev 驱动的入场时机判定门，镜像 CheatCheckService 骨架裁剪。
 *
 * 定位（与 CD 分工）：输入同样是 ticks 锚截窗，CD 判「盘面是否作弊」，本服务判
 * 「**当前点位是否适合买入**」（时点判定；协同形状只作降档参考，结论归 CD）。
 * 判定形态（题集 BP33 盘型前置预判断+两质量题）：7 维度题（参考；**market_pattern
 * 前置为预判断**——BP30 用户裁定；tree_position/追高质量题已退役——BP30 用户
 * 裁定「tree_position 可以去掉」「high_chase_quality 也删除」）+ 2 类别质量题
 * （early_bird/pullback_entry，桶域 good/neutral/poor/insufficient）两视角并行
 * 独立评估；综合判定=**代码侧四层**（①盘型门 pattern∈②③④桶→poor；②活跃度门
 * heat=low 或 act∈{low,ultra}→poor；③筹码门 famous∈{heavy,dominant} 或
 * holder=strong→poor；④质量题聚合任一 good→good，否则任一 neutral→neutral，
 * 否则 poor；insufficient 不贡献；两题全 insufficient→poor 且 prob=null；
 * 门题答案缺席=null 不拦放行）。
 * **无粘滞/拉黑/grade**
 * （点位判定无终态：每个买信号独立 as-of 真析，多行历史留轨迹=校准研究数据）。
 *
 * 门语义（T117 门链第二门；与 cheat 门刻意不同向）：
 * - assessed → bucket ∈ 腿 bpPassLevels（默认 good/neutral）才放行，引擎判
 * - **fail-closed**：timeout / fail（llm_load/cooldown/jev_timeout/jev_error/
 *   mapper_error）/ disabled → 引擎一律拒（BP 是点位判定唯一来源，无据不买
 *   ——cheat 层「检测故障 fail-open 放行进 BP」的下游兜底正是本门）。
 *   disabled 另加 loud warn（配置矛盾：signalGate 腿配了门却没开服务）。
 *   **insufficient_ticks 拒（BP10 翻案，2026-11-07 用户裁定「数据不够就
 *   挡住而不是放行」——推翻 BP9 2026-11-05 放行；例票 0x18cf6407
 *   anchorTickCount=3 放行买入 15s 后止损）**：极早触发锚窗 tick<minTicks
 *   =数据不足不判定，引擎侧 fail-closed 拒（minTicks 预门保留=不烧 Jev 配额）
 * - 竞速超时 late 链续跑落行（无引擎态副作用——落行后下个买信号可见）
 *
 * 时序（与 cheat 同款）：买点触发 → settle（引擎注入 waitIdle → resolver
 * per-token watermark 清空即出窗，settleDelayMs=最长等待帽；未注入=固定
 * settleDelayMs bit 一致）→ 拉数（分析开始而非完成——尾部突发簇恰是判读主体）。
 *
 * 拉数双源（与 cheat CD237 同构）：deps.pullTicks（collector per-token 行环）
 * mem 优先（行=将被 INSERT 的同一对象同引用=同源），miss 回落 DB 单 tail 查询
 * （锚=返回行数绝不 count+select 两次；满帽补 head 300）。
 *
 * 同源红线：snapshot 输入口径=wss_price_ticks 行形状（排除 FA 聚合口径，
 * 非「任何内存」——cheat CD237 改写先例）。离线回归 runner（scripts/buy-point/）
 * 自拉 DB 不经本服务。消费链：行环 / wss_price_ticks → buy-point-snapshot →
 * buy-point-state-builder → JevClient（ESM dynamic import 同实例）→
 * buy-point-result-mapper → insert buy_point_analyses。
 *
 * 失败语义：Jev 失败/超时落 error/timeout 行带 fail_reason（fail-loud 留痕）+
 * failCooldownMs 冷却（防故障环）；DB 写失败 loud warn（行丢=可观测）。
 * minTicks 预门：拉数后 tickCount<6 → 不调 Jev 不落表（引擎侧 BP10 拒——数据不足=挡住；T131 8→7、T133 7→6）。
 * 配额由引擎侧
 * BuySignalThrottle 信号帽 + signalGate maxTriggers 触发帽天然封顶。
 *
 * 回测零接线（BacktestEngine 不走本门——signalGate 腿回测恒拒=用户裁定）。
 * 实验停止不清理表行（token 级全局资产）。
 */

const { buildBuyPointSnapshot } = require('./buy-point-snapshot');
const { buildBuyPointState } = require('./buy-point-state-builder');
const { buildBuyPointObservation } = require('./buy-point-result-mapper');
const { evaluateFactorPreBuy: evaluateFactorPreBuyJudge, FACTOR_PREBUY_VERSION } = require('./factor-pre-buy-check');

const DEFAULTS = {
  timeoutMs: 30000,          // 单次分析整体超时（Jev 调用为主）
  settleDelayMs: 4000,       // 买点→拉数延迟；waitIdle 注入时=最长等待帽
  minTicks: 6,               // 极新票预门（低于不调 Jev 不落表；T131 8→7、T133 7→6：ladder v17 t0 6 笔档早臂配套）
  failCooldownMs: 10000,     // 失败后冷却（冷却期内买点不再发起链）
  pullLimit: 3000,           // tail 拉数帽（anchor=该单次查询返回行数）
  headLimit: 300,            // 满帽时补的首段行数（launch 窗）
  gateAwaitMs: 15000,        // 买点 await 竞速上限（超时 fail-closed 拒，late 链续跑落行）
  settleFlushMs: 600,        // waitIdle 模式尾随等待（idle=回查清空≠DB 可见）
};

// T198/FP30 arbBot 钱包集（GMGN 画像标签并集——factor 门 arb_bot_holdings 臂原料；
// 用户裁定：进程启动预加载进内存静态快照，**信号路径绝不逐次查库**；更新须重启
// 进程=与 famous/smartBot 名单同语义；表缺失/查询失败 → 空集 fail-open 臂钝化）
const ARB_BOT_TAGS = new Set(['arbitrager', 'sandwich_bot', 'wash_trader']);

const TICK_SELECT_COLUMNS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

/**
 * BP42 pump 豁免票位置门已随 BP55 退役（2026-11-09 用户裁定「这个已经不需要特殊
 * 处理了，现在庄盘也不接受价格高于 40%（也就是超出 near_launch）」）：BP48 起
 * ①strong_backer/⑤blended/⑧golden_point 三臂位置门已同线收紧至 ≤+40（low 档
 * +40~80 加仓域对所有放行型盘型桶关闭），pump 豁免票（slowGrindPump=strong 的
 * CD379 活跃度豁免票）走盘型桶位置门即可——专属 PUMP_EXEMPT_LAUNCH_PCT 门与
 * rule=pump_exempt_gate 不再有独立语义，整链删除（常量/位置门分支/引擎门链
 * pumpExempt 打标与透传）。历史 buy_point_analyses 行带 pump_exempt_gate rule
 * 照留档不清洗。行为变化面：④桶 BP47/BP53 豁免臂放行的 pump 豁免票不再被本门
 * 二次拦（BP53 臂本无价格腿——来财 curVs=109 正票形状，用户裁定的放行面）。
 */

class BuyPointCheckService {
  /**
   * @param {Object} [config] - fourmemeWs.buyPointCheck 段（flap 实验经 _mergedWsConfig 同键）
   * @param {Object} [logger] - 引擎 logger
   * @param {Object} [deps] - 测试注入口 { dbClient, now, loadLlm }（缺省生产路径：
   *   dbManager service key / Date.now / dynamic import JevClient+题集）
   */
  constructor(config = {}, logger = null, deps = {}) {
    const num = (v, dflt, min = 0) => (Number.isFinite(v) && v >= min ? v : dflt);
    this._enabled = config.enabled === true; // 物化语义：缺段/缺 enabled=关
    this._timeoutMs = num(config.timeoutMs, DEFAULTS.timeoutMs, 1);
    this._settleDelayMs = num(config.settleDelayMs, DEFAULTS.settleDelayMs);
    this._minTicks = num(config.minTicks, DEFAULTS.minTicks, 1);
    this._failCooldownMs = num(config.failCooldownMs, DEFAULTS.failCooldownMs);
    this._pullLimit = num(config.pullLimit, DEFAULTS.pullLimit, 10);
    this._headLimit = num(config.headLimit, DEFAULTS.headLimit, 10);
    this._gateAwaitMs = num(config.gate && config.gate.awaitMs, DEFAULTS.gateAwaitMs, 1);
    this._settleFlushMs = num(config.settleFlushMs, DEFAULTS.settleFlushMs);
    // T143 因子购买前检查门（FP1，2026-11-15 duanju 案立法）：灰度开关缺省 false——
    // 开=因子门（PVP 纯代码判定+CD 四臂升格门）先于 cheat/BP 门评估（引擎侧挂点）；
    // 关/缺段=零行为（引擎 fail-open 放行进 cheat 门）。物化语义与 enabled 同款。
    this._factorEnabled = !!(config.factorCheck && config.factorCheck.enabled === true);
    // FP33/JG6 tail_dip 有机盘豁免灰度（factorCheck.tailDipOrganicExempt，缺省 false=FP32 行为不变）
    this._tailDipOrganicExempt = !!(config.factorCheck && config.factorCheck.tailDipOrganicExempt === true);
    // T205 两灰度（缺省 false=FP34 行为不变，GWC 案立法）：fix① act low 家族阶段
    // 前提（未火过 ATH<80 让位——同原则 AF1/E 通道在 cheatCheck.gate 键）/
    // fix② tail_dip 量腿（锚前 30s 卖额 ≥0.3B 才拦）
    this._actStageColdExempt = !!(config.factorCheck && config.factorCheck.actStageColdExempt === true);
    this._tailDipVolumeLeg = !!(config.factorCheck && config.factorCheck.tailDipVolumeLeg === true);
    // T193 参与者 GMGN 画像观察键（张雪电摩 pump 作弊案→画像库消费端）：锚窗 top-N
    // 买家查 gmgn_wallet_profiles 聚合（票数中位/小亏带/新号/bot 浓度）。**观察键不
    // 进门不拦截**（阈值待分布裁定）；灰度缺省 false；回测（persist=false）不跑=
    // 时序穿越防线（表是现在拉的 30d 快照）。fail-open：查表失败段={error} 照常评估。
    this._ppEnabled = !!(config.participantProfile && config.participantProfile.enabled === true);
    this._auditShadow = config.memSource ? config.memSource.auditShadow !== false : true;
    // 回测隔离（backtest.signalGateReal 实验专用，引擎构造时硬编码注入）：persist=false
    // 禁 _writeRow——buy_point_analyses 是全局表，回测判定行会污染生产域；判定轨迹由
    // signal metadata（buyPoint 段）留档。BP 无 bootstrap/粘滞（每买信号真析）无禁读面
    this._persist = config.persist !== false;

    this._logger = logger;
    this._deps = deps;
    this._dbClient = deps.dbClient || null;

    // T198/FP30 arbBot 钱包集（deps.arbBotWallets 直注=单测路径零 DB）：ctor 预热
    // fire-and-forget（一次分页拉全表 ~5k 行；完成前首信号拿空集=臂钝化该笔
    // fail-open，加载毫秒级完成远早于首个买信号）；实例级缓存=每进程恰一次查询；
    // BP 门（enabled）也消费 digest 键 → 两开关任一在即预热
    this._arbBotWallets = deps.arbBotWallets instanceof Set ? deps.arbBotWallets : null;
    this._arbBotWalletsPromise = null;
    if ((this._factorEnabled || this._enabled) && !this._arbBotWallets) {
      this._loadArbBotWallets().catch(() => {}); // 预加载（用户裁定）；失败已内吞
    }

    // 进程内状态（重启即清；无粘滞/拉黑——BP 无终态可恢复）
    this._failUntil = new Map();     // token → 冷却截止 ts
    this._inflight = new Map();      // token → Promise（买点并发 join）
    this._promptWritten = new Set(); // `${token}\0${version}` → jev_prompt 已落过（首行全文防线）
    this._llm = null;                // { JevClient, buildBuyPointQuestions, BUY_POINT_QUESTIONS_VERSION }

    this.stats = {
      analyzed: 0, skippedInsufficientTicks: 0,
      cooldownSkipped: 0, rowsWritten: 0, writeFailed: 0,
      timeouts: 0, errors: 0, inflightJoined: 0,
      gateNoted: 0, gateTimeouts: 0, gateAssessed: 0,
      settleIdleHits: 0, settleIdleTimeouts: 0,  // waitIdle 双模观测
      shadowAudits: 0, shadowMismatches: 0, shadowErrors: 0, // mem 对拍护栏观测
      persistSkipped: 0, // persist=false 跳写计数（回测隔离观测）
      factorNoted: 0, factorAssessed: 0, factorBlocked: 0, factorInsufficient: 0, factorErrors: 0, // T143 因子门观测
      ppAggregated: 0, ppErrors: 0, ppSkippedDisabled: 0, // T193 参与者画像观察键
    };
  }

  get enabled() { return this._enabled; }
  /** T143 因子门灰度开关（factorCheck.enabled，缺省 false——引擎 fail-open 放行进 cheat 门） */
  get factorEnabled() { return this._factorEnabled === true; }

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
   * T143 因子购买前检查门（FP1，门链最前——duanju 0x65aebe91…7777 案立法）：
   * 纯代码零 Jev（PVP 判定树+CD 四臂升格门，判据=factor-pre-buy-check.js 单源）。
   * settle→拉数（anchorMs 截窗同 BP 门）→minTicks **放行**（数据不足不双拒——
   * BP 门 insufficient_ticks 兜底拒）→snapshot→纯判定。不落表（persist 隔离天然
   * 继承）、无 inflight join（纯计算毫秒级幂等）、无冷却、无 Jev/state。
   * 返回：{status:'assessed', pass, reason, version, pvp, arms, trace}
   *      / {status:'insufficient_ticks'}（调用方放行进 cheat 门）
   *      / {status:'disabled'|'error'}（调用方 fail-open 放行——检测层故障方向
   *        对齐 cheat 门；灰度 factorCheck.enabled 缺省 false=关）。
   * 内部不抛错（接线级异常→error 返回，引擎侧 fail-open）。
   */
  async evaluateFactorPreBuy(tokenAddress, tokenMeta = {}, context = {}, opts = {}) {
    if (!this._factorEnabled) return { status: 'disabled', reason: 'factor_check_disabled' };
    const token = String(tokenAddress || '').toLowerCase();
    if (!token) return { status: 'error', reason: 'invalid_token' };
    this.stats.factorNoted++;
    try {
      // settle（waitIdle 双模同 _chain——实时尾部簇落定；回测 settleDelayMs=0 直通）
      const waitIdle = this._deps.waitIdle;
      if (waitIdle && this._settleDelayMs > 0) {
        await Promise.race([
          Promise.resolve(waitIdle(token)),
          new Promise((r) => setTimeout(r, this._settleDelayMs)),
        ]);
        if (!this._deps.pullTicks) await new Promise((r) => setTimeout(r, this._settleFlushMs));
      } else if (this._settleDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this._settleDelayMs));
      }
      const _anchorMs = Number.isFinite(opts.anchorMs) && opts.anchorMs > 0 ? opts.anchorMs : null;
      const pull = await this._pullTicks(token, _anchorMs);
      if (pull.anchorTickCount < this._minTicks) {
        this.stats.factorInsufficient++;
        return { status: 'insufficient_ticks', anchorTickCount: pull.anchorTickCount };
      }
      const createMeta = await this._loadCreateMeta(token);
      const meta = this._normalizeMeta(token, tokenMeta, pull, createMeta);
      const snapshot = buildBuyPointSnapshot(pull.rows, meta, {
        capped: pull.capped,
        anchorTickCount: pull.anchorTickCount,
        signalInfo: context.signalId
          ? { signalId: context.signalId, createdAt: context.signalCreatedAt || null, firePriceBnb: context.firePriceBnb ?? null, strategyName: context.strategyName || null }
          : null,
        // T198/FP30：arbBot 钱包集注入（实例缓存已解析=零查库；未启用时预热
        // 未完成 → 空集=键 0 有证据零值恒放行 fail-open）
        arbBotWallets: await this._loadArbBotWallets(),
      });
      const verdict = evaluateFactorPreBuyJudge(snapshot, {
        enableTailDipExempt: this._tailDipOrganicExempt,
        enableActStageCold: this._actStageColdExempt, // T205 fix①：act low 阶段前提
        enableTailDipVolumeLeg: this._tailDipVolumeLeg, // T205 fix②：tail_dip 量腿
      });
      this.stats.factorAssessed++;
      if (!verdict.pass) this.stats.factorBlocked++;
      return { status: 'assessed', ...verdict };
    } catch (e) {
      this.stats.factorErrors++;
      this._log('warn', `因子门异常（fail-open 放行） | ${token} ${e?.message || e}`);
      return { status: 'error', reason: e?.message || String(e) };
    }
  }

  /**
   * 买点 BP 门（T117 门链第二门）：竞速 awaitMs。
   * - {status:'assessed', assessment:{bucket,prob,rule}, dimensions, anchors, model, usage}（BP48 起无 qualities——两质量题退役）
   *   ——bucket 是否放行由引擎按腿 bpPassLevels 判（服务不做规则映射——判断一律 Jev）
   * - 竞速超时：{status:'timeout', late:Promise}——**调用方 fail-closed 拒本笔**，
   *   late 链续跑落行（无引擎态副作用，下个买信号可见）
   * - {status:'fail', reason}（llm_load/cooldown/jev_timeout/jev_error/mapper_error）
   *   / {status:'insufficient_ticks'} / {status:'disabled'}——全部调用方 fail-closed 拒
   * 不抛错（接线级异常由引擎 catch 拒——与 cheat 门「catch 放行」刻意不同向，
   * 引擎侧 _bpGateEvaluate 兜底 catch 返回 fail）。
   */
  async gateBuyPoint(tokenAddress, tokenMeta = {}, context = {}, opts = {}) {
    if (!this._enabled) return { status: 'disabled' };
    const token = String(tokenAddress || '').toLowerCase();
    if (!token) return { status: 'invalid_token' };
    this.stats.gateNoted++;

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
      return { status: 'timeout', late: chain };
    }
    if (result && result.status === 'assessed') this.stats.gateAssessed++;
    return result;
  }

  // ─────────────────────────── 分析链（全吞错） ───────────────────────────

  async _chain(token, tokenMeta, context, opts = {}) {
    try {
      // 1) settle：尾部突发簇落 DB（tickBuffer 500ms flush + sender 回查 0-3s）
      //    双模（与 cheat 同款）：注入 waitIdle → 等 per-token 回查清空；未注入=固定 sleep
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
        return { status: 'fail', reason: 'llm_load' };
      }

      // 3) 失败冷却
      const failUntil = this._failUntil.get(token) || 0;
      if (this._now() < failUntil) {
        this.stats.cooldownSkipped++;
        return { status: 'fail', reason: 'cooldown' };
      }

      // 4) 拉数（双源：mem 行环优先，miss 回落 DB）。anchorMs（回测 as-of 锚，
      // backtest.signalGateReal 链路传入=信号 fire 虚拟时刻）：DB 查询 .lte(block_time)
      // 截窗防前视——回测时 DB 已有全史，无锚=「最新」行集=马后炮；生产不传=现状
      // tail 语义（inflight join 边缘：join 上的链用首触发票锚——回测串行回放无并发）
      const _anchorMs = Number.isFinite(opts.anchorMs) && opts.anchorMs > 0 ? opts.anchorMs : null;
      const pull = await this._pullTicks(token, _anchorMs);
      if (pull.fromMem && this._auditShadow) {
        this._shadowAudit(token, pull); // fire-and-forget 对拍护栏（全吞错，不拦截）
      }

      // 5) minTicks 预门（不调 Jev 不落表；不粘滞——下个买信号可重析）
      if (pull.anchorTickCount < this._minTicks) {
        this.stats.skippedInsufficientTicks++;
        this._log('info', `ticks 不足跳过（${pull.anchorTickCount}<${this._minTicks}） | ${token}`);
        return { status: 'insufficient_ticks', anchorTickCount: pull.anchorTickCount };
      }

      // 6) 快照 + state（createMeta=token_create 行 creator/createTx 兜底，fail-open）
      const createMeta = await this._loadCreateMeta(token);
      const meta = this._normalizeMeta(token, tokenMeta, pull, createMeta);
      const snapshot = buildBuyPointSnapshot(pull.rows, meta, {
        capped: pull.capped,
        anchorTickCount: pull.anchorTickCount,
        // signalInfo：信号溯源行（[ANCHOR] 段展示——材料与实时引擎路径同源声明）
        signalInfo: context.signalId
          ? { signalId: context.signalId, createdAt: context.signalCreatedAt || null, firePriceBnb: context.firePriceBnb ?? null, strategyName: context.strategyName || null }
          : null,
        // BP67：cheat 门 burst 判定输入（[ANCHOR] burst 判定行——activity_level
        // 采信上游 burst 桶不重复检测；null=无 burst 证据 act 照常判）
        cheatBurst: opts.cheatBurst || null,
        // T198/FP30：arbBot 钱包集注入（BP 门 digest 同步带键留痕；零查库同上）
        arbBotWallets: await this._loadArbBotWallets(),
      });
      const { state } = buildBuyPointState(snapshot);

      // 6b) T193 参与者画像观察键（锚窗已拉零新增拉数；回测不跑；fail-open 段级容错）
      let participantProfile = null;
      if (this._ppEnabled) {
        if (this._persist) {
          participantProfile = await this._participantProfile(pull.rows);
        } else {
          this.stats.ppSkippedDisabled++; // 回测隔离：快照表对历史锚=时序穿越
        }
      }

      // 7) Jev（超时竞速；迟到结果丢弃防锚重复行）
      const res = await this._runJev(state, this._llm.buildBuyPointQuestions());
      if (!res.ok) {
        if (res.kind === 'timeout') {
          this.stats.timeouts++;
          await this._writeRow(token, meta, pull, { verdict: 'timeout', failReason: `jev_timeout_${this._timeoutMs}ms` }, null, context, snapshot, participantProfile);
        } else {
          this.stats.errors++;
          await this._writeRow(token, meta, pull, { verdict: 'error', failReason: `jev_error: ${res.error?.message || res.error}` }, null, context, snapshot, participantProfile);
        }
        // 失败冷却（防故障环；不粘滞——下个买信号受冷却后可重析）
        this._failUntil.set(token, this._now() + this._failCooldownMs);
        this._log('warn', `Jev ${res.kind} | ${token} ${res.error?.message || ''}`);
        return { status: 'fail', reason: res.kind === 'timeout' ? 'jev_timeout' : 'jev_error' };
      }

      // 8) mapper 观测组装 + 落库（维度题未知桶 throw → catch 落 error 行——
      //    判定链路坏 fail-loud；BP48 起无质量层=纯门链）
      let obs;
      try {
        obs = buildBuyPointObservation(res.result.answers, snapshot.buyDerived);
      } catch (e) {
        this.stats.errors++;
        await this._writeRow(token, meta, pull, { verdict: 'error', failReason: `mapper: ${e?.message || e}` }, null, context, snapshot, participantProfile);
        this._failUntil.set(token, this._now() + this._failCooldownMs);
        return { status: 'fail', reason: 'mapper_error' };
      }
      await this._writeRow(token, meta, pull, obs, { answers: res.result.answers, model: res.result.model, usage: res.result.usage, state }, context, snapshot, participantProfile);
      this.stats.analyzed++;

      const dim = obs.dimensions;
      // BP42 pump 豁免票位置门已随 BP55 退役（头注）——assessment 恒=obs.assessment
      const assessment = obs.assessment;
      this._log('info', `买点观测 pattern=${dim.market_pattern?.bucket ?? '—'}` +
        ` trend=${dim.price_trend?.bucket ?? '—'}` +
        ` act=${dim.activity_level?.bucket ?? '—'}` +
        ` holder=${dim.holder_concentration?.bucket ?? '—'}` +
        ` 综合=${obs.assessment.bucket}(${obs.assessment.prob},${obs.assessment.rule})` +
        `${obs.assessment.exempt ? `+exempt:${obs.assessment.exempt.code}(${obs.assessment.exempt.heat},+${obs.assessment.exempt.curVsLaunchPct}${typeof obs.assessment.exempt.openSegBuySharePct === 'number' ? `,os=${obs.assessment.exempt.openSegBuySharePct}` : ''})` : ''}` +
        ` ticks=${pull.anchorTickCount}${pull.capped ? '+' : ''} | ${token}`);
      return {
        status: 'assessed',
        // 案号 BP46：assessment.exempt（④高热近价豁免留痕）additive 透传（mapper 带
        //   才有——旧形状零变化）
        assessment: { bucket: assessment.bucket, prob: assessment.prob, rule: assessment.rule, ...(assessment.exempt ? { exempt: assessment.exempt } : {}) },
        dimensions: obs.dimensions,
        anchors: obs.anchors,
        model: res.result.model || null,
        usage: res.result.usage || null,
        // T193 参与者画像观察键（additive；灰度关/回测=缺省 undefined 不序列化）
        ...(participantProfile ? { participantProfile } : {}),
      };
    } catch (e) {
      // 兜底吞错（门链 catch 返回 fail——调用方 fail-closed 拒）loud 留痕
      this.stats.errors++;
      this._failUntil.set(token, this._now() + this._failCooldownMs);
      this._log('error', `分析链异常（已吞，调用方拒） | ${token} ${e?.stack || e}`);
      return { status: 'fail', reason: 'chain_error' };
    }
  }

  // ─────────────────────────── 内部件 ───────────────────────────

  async _ensureLlm() {
    if (this._llm) return;
    if (this._deps.loadLlm) {
      this._llm = await this._deps.loadLlm();
    } else {
      // CJS→ESM 先例（NarrativeDirectCaller 惰性动态 import+缓存；与 cheat 服务
      // 共用同一 JevClient 模块实例）
      const mod = await import('../narrative/analyzer/llm/JevClient.mjs');
      const q = await import('./llm/buy-point-questions.mjs');
      this._llm = { JevClient: mod.JevClient, buildBuyPointQuestions: q.buildBuyPointQuestions, BUY_POINT_QUESTIONS_VERSION: q.BUY_POINT_QUESTIONS_VERSION };
    }
  }

  get _version() { return this._llm ? this._llm.BUY_POINT_QUESTIONS_VERSION : null; }

  _now() { return this._deps.now ? this._deps.now() : Date.now(); }

  _client() {
    if (this._dbClient) return this._dbClient;
    // dbManager service key（anon 被 RLS 静默过滤——红线 3）
    // ⚠ 路径事故锁（v67 事故同款，CheatCheckService 先例）：market-analysis 在
    // src/ 下，services 同层须**一层** ../（写成 ../../services 解析到项目根
    // services → MODULE_NOT_FOUND 链内吞错分析全灭零表行；单测 deps.dbClient
    // 注入短路本路径=漏网，源码口径断言在 _test_buy_point_check_service 防线段）
    const { dbManager } = require('../services/dbManager');
    this._dbClient = dbManager.getClient();
    return this._dbClient;
  }

  /**
   * T198/FP30 arbBot 钱包集加载（实例级缓存：**每进程恰一次**——ctor 预热 +
   * 后续 await 命中已解析 Set，信号路径零查库；用户裁定 2026-11-20）。
   * gmgn_wallet_profiles 全表分页（keyset address 游标，PostgREST 1000 行帽）
   * → tags ∩ {arbitrager, sandwich_bot, wash_trader} 并集（小写）。
   * 失败语义：查询异常 → 空集 + warn（fail-open 臂钝化，不阻塞门链）。
   */
  async _loadArbBotWallets() {
    if (this._arbBotWallets) return this._arbBotWallets;
    if (!this._arbBotWalletsPromise) {
      this._arbBotWalletsPromise = (async () => {
        const set = new Set();
        try {
          let after = null;
          for (;;) {
            let q = this._client().from('gmgn_wallet_profiles')
              .select('address,tags').order('address').limit(1000);
            if (after) q = q.gt('address', after);
            const { data, error } = await q;
            if (error) throw new Error(error.message);
            if (!data || !data.length) break;
            for (const r of data) {
              if (Array.isArray(r.tags) && r.tags.some((t) => ARB_BOT_TAGS.has(t))) {
                set.add(String(r.address || '').toLowerCase());
              }
            }
            after = data[data.length - 1].address;
            if (data.length < 1000) break;
          }
          this._log('info', `arbBot 钱包集预加载完成：${set.size} 址（FP30 臂原料，静态快照重启生效）`);
        } catch (e) {
          this._log('warn', `arbBot 钱包集加载失败（fail-open 空集=臂钝化） | ${e?.message || e}`);
        }
        this._arbBotWallets = set;
        return set;
      })();
    }
    return this._arbBotWalletsPromise;
  }

  /**
   * T193 参与者画像观察键（BP 门锚窗零新增拉数）：top-N 买家 → 表批量 PK 查询 →
   * 纯函数聚合。查表失败 fail-open 段={error}（观察键不拦门链）；调用方须 _persist
   * 门控（回测不跑=时序穿越防线）。
   */
  async _participantProfile(tickRows) {
    const { selectTopBuyers, aggregateParticipantProfile, PARTICIPANT_PROFILE_VERSION } = require('./participant-profile');
    try {
      const top = selectTopBuyers(tickRows);
      if (!top.length) return { version: PARTICIPANT_PROFILE_VERSION, selected: 0, profiled: 0 };
      const profiles = new Map();
      const client = this._client();
      for (let i = 0; i < top.length; i += 50) { // .in ≤50/批（URL 8KB 红线）
        const batch = top.slice(i, i + 50).map(t => t.wallet);
        const { data, error } = await client.from('gmgn_wallet_profiles')
          .select('address,tags,created_at_sec,token_num,realized_profit,winrate')
          .in('address', batch);
        if (error) throw new Error(error.message);
        for (const r of data || []) profiles.set(String(r.address).toLowerCase(), r);
      }
      const seg = aggregateParticipantProfile(top, profiles, { nowSec: Math.floor(this._now() / 1000) });
      this.stats.ppAggregated++;
      return seg;
    } catch (e) {
      this.stats.ppErrors++;
      this._log('warn', `参与者画像聚合失败（fail-open 段级容错） | ${e?.message || e}`);
      return { version: PARTICIPANT_PROFILE_VERSION, error: e?.message || String(e) };
    }
  }

  _log(level, msg) {
    try {
      // ⚠ receiver 绑定锁（v67 事故同款，CheatCheckService 先例）：class 方法摘出
      // 直调 this=undefined（class 体严格模式）→ logger TypeError 被 catch 吞 =
      // 日志静默零输出；方法调用形式（member call）天然带 receiver。
      if (this._logger && this._logger[level]) {
        this._logger[level]('', 'BuyPointCheck', msg);
      } else {
        (console[level] || console.log)('', 'BuyPointCheck', msg);
      }
    } catch (_) { /* 日志失败不吞业务 */ }
  }

  /**
   * 拉数（双源，与 cheat CD237 同构）：deps.pullTicks 注入（引擎 collector 行环）
   * → mem 优先；miss 等 settleFlushMs 边界（等 buffer flush+INSERT）再走 DB。
   */
  async _pullTicks(token, anchorMs = null) {
    const pullMem = this._deps.pullTicks;
    if (pullMem) {
      const mem = await pullMem(token, anchorMs);
      if (mem && Array.isArray(mem.rows) && mem.rows.length > 0) {
        return {
          rows: mem.rows, anchorTickCount: mem.anchorTickCount, capped: !!mem.capped,
          watermark: this._watermarkOf(mem.rows), quoteToken: this._latestQuoteToken(mem.rows),
          fromMem: true,
        };
      }
      this._log('info', `mem拉数miss（600ms+DB 兜底）| ${token} anchor=${anchorMs ?? '无'}`);
      await new Promise((r) => setTimeout(r, this._settleFlushMs));
    }
    return this._pullTicksDb(token, anchorMs);
  }

  /**
   * 拉数（DB 路径）：tail 单查询（链上真序倒序 limit pullLimit）=锚；满帽才补 head。
   * anchorMs（回测 as-of 锚）非空时两查询均 .lte(block_time) 截窗——锚计数语义
   * 不变；null=现状生产 tail 语义。
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
   * 对拍护栏（auditShadow，默认开；cheat _shadowAudit 同构）：mem hit 后异步
   * DB 重拉按 watermark 截断对齐比对 digest——不一致 warn 不拦截。
   */
  async _shadowAudit(token, memPull) {
    try {
      await new Promise((r) => setTimeout(r, this._settleDelayMs + 2000));
      const dbPull = await this._pullTicksDb(token);
      this.stats.shadowAudits++;
      const wm = memPull.watermark;
      if (!wm) return;
      const dbAligned = dbPull.rows.filter((r) => {
        const b = r.block_number ?? Number.MAX_SAFE_INTEGER;
        if (b !== wm.block) return b < wm.block;
        return (r.log_index ?? 0) <= (wm.log ?? 0);
      });
      const digest = (rows) => rows.map((r) =>
        `${r.block_number}:${r.log_index}:${r.trader_address}:${r.sender_address ?? 'null'}:${r.bnb_amount}:${r.trade_type}:${r.price_bnb}:${r.price_outlier ?? false}`).join(';');
      if (digest(dbAligned) !== digest(memPull.rows)) {
        this.stats.shadowMismatches++;
        this._log('warn', `memSource 对拍不一致 | ${token} mem=${memPull.rows.length}行 db对齐=${dbAligned.length}行`);
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
      totalSupply: tokenMeta.totalSupply ?? null,
      creatorAddress: tokenMeta.creatorAddress || (createMeta && createMeta.creator) || null,
      createTxHash: (createMeta && createMeta.txHash) || null,
    };
  }

  /**
   * token_create 行读取（creator 兜底 + createTxHash 原料；与 cheat 同构）。
   * token 级终身缓存；失败/无行 fail-open 返回 {}。
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
    } catch { /* fail-open：缺席=常态 */ }
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
      this._llm.JevClient.ask(state, questions, { timeoutMs: this._timeoutMs, label: 'buy-point-check' }).then(
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

  /**
   * 落库（buy_point_analyses；写失败 loud warn 不重试不抛——行丢=可观测）。
   * jev_prompt 仅每 (token, question_version) 首行落全文（无界增长防线）。
   */
  async _writeRow(token, meta, pull, mapped, raw, context, snapshot, participantProfile = null) {
    // persist=false（回测隔离）：绝不写 buy_point_analyses 全局表；判定轨迹由引擎侧
    // signal metadata（buyPoint 段）留档
    if (!this._persist) { this.stats.persistSkipped++; return; }
    try {
      const promptKey = `${token}\0${this._version}`;
      const isFirst = !this._promptWritten.has(promptKey);
      let buyBnb = 0, sellBnb = 0;
      for (const r of pull.rows) {
        if (r.trade_type === 'buy') buyBnb += r.bnb_amount || 0;
        else sellBnb += r.bnb_amount || 0;
      }
      const b = snapshot && snapshot.buyDerived ? snapshot.buyDerived : {};
      const digest = {
        tickCount: pull.anchorTickCount,
        capped: pull.capped,
        watermark: pull.watermark,
        quoteToken: pull.quoteToken || null,
        buyBnb: Number(buyBnb.toFixed(4)),
        sellBnb: Number(sellBnb.toFixed(4)),
        // 买点摘要（失败行 mapped={verdict,failReason} → null）
        assessment: mapped.assessment ?? null,
        qualities: mapped.qualities ?? null, // BP48 两质量题退役=恒 null（键保留=历史 digest 行形状兼容，旧档重放仍有值）
        dimensions: mapped.dimensions ?? null,
        anchors: mapped.anchors ?? null,
        bp: {
          tokenAgeSec: b.tokenAgeSec ?? null,
          spanSec: b.spanSec ?? null,
          currentVsAthPct: b.currentVsAthPct ?? null,
          chg5Pct: b.chg5Pct ?? null,
          chg10Pct: b.chg10Pct ?? null,
          chg30Pct: b.chg30Pct ?? null,
          // 摆动结构族（BP8 圣诞树原料摘要；锚全量随 digest.anchors 落）
          swingHighCount: b.swingHighCount ?? null,
          swingLowCount: b.swingLowCount ?? null,
          swingLastDir: b.swingLastDir ?? null,
          secSinceSwingHigh: b.secSinceSwingHigh ?? null,
          currentVsSwingHighPct: b.currentVsSwingHighPct ?? null,
          currentVsSwingLowPct: b.currentVsSwingLowPct ?? null,
          swingMaxAmplPct: b.swingMaxAmplPct ?? null,
          mcapBnb: b.mcapBnb ?? null,
          mcapPeakBnb: b.mcapPeakBnb ?? null,
          mcapFromPeakPct: b.mcapFromPeakPct ?? null,
          holdersNow: b.holdersNow ?? null,
          holdersDelta60: b.holdersDelta60 ?? null,
        },
        // T193 参与者 GMGN 画像观察段（灰度关=缺省 null；观察键不进门）
        participantProfile: participantProfile ?? null,
      };
      const row = {
        token_address: token,
        platform: meta.platform || null,
        question_version: this._version,
        verdict: mapped.verdict ?? 'assessed',
        assessment: mapped.assessment ? mapped.assessment.bucket : null,
        dimensions: mapped.dimensions ?? null,
        answers_raw: raw ? { answers: raw.answers, model: raw.model || null, usage: raw.usage || null } : null,
        jev_prompt: raw && isFirst ? raw.state : null, // 仅每 (token,version) 首行落全文
        snapshot_digest: digest,
        anchor_tick_count: pull.anchorTickCount,
        fail_reason: mapped.failReason || null,
        signal_id: context.signalId || null,
        source_experiment_id: context.experimentId || null,
      };
      const client = this._client();
      const { error } = await client.from('buy_point_analyses').insert([row]);
      if (error) throw new Error(error.message);
      if (raw && isFirst) this._promptWritten.add(promptKey);
      this.stats.rowsWritten++;
    } catch (e) {
      this.stats.writeFailed++;
      this._log('error', `落库失败（行丢，loud 留痕） | ${token} ${e?.message || e}`);
    }
  }
}

module.exports = { BuyPointCheckService, BUY_POINT_CHECK_DEFAULTS: DEFAULTS };
