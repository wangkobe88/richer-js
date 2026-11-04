/**
 * SellConfirmDebouncer：卖出条件持续为真的确认去抖（pumpfun 回迁批 2）
 *
 * 与 TickDebouncer（burst 内每 tick 重置）语义相反：touch 只在「无 pending」时
 * 起算，后续 touch 不重置——卖出要的是"条件持续真 N ms"的确认而非静默期，
 * 重置会让持续阴跌的热门票（每 tick 都真）永远等不到 fire。
 *
 * 语义（母版 WssTradingEngine._scheduleSellDebouncer/_cancelSellDebounce 抽出成类）：
 * - touch：首真起计；已 pending → ticksSeen++（凑证据）+ 满足双门即时 fire
 * - clear：条件变 false（趋势恢复）/ 卖出完成 / 引擎停止时取消（不 fire）
 * - fire：只负责到点回调；「重读因子 + 重评 + 仍真才卖」由消费方 onFire 承担
 *   （窗口内价格可能恢复→不卖，防即时卖砍掉本可拿住的回调）
 * - debounceMs <= 0：touch 即 fire（引擎分流已保证此情形不进 touch，兜底语义）
 *
 * 双门槛确认（2026-10-16 蓝筹蛙/RIBBIT 断流案用户裁定）：minTicks > 0 时
 * fire = 时间窗（debounceMs）AND 窗后新 tick 数（ticksSeen >= minTicks）——
 * 断流票在时间窗内零 tick 时不得按陈旧快照卖，须等新证据凑齐；逃生门
 * maxWaitMs（首真起计绝对上限，缺省 120s）到点强制走 fire 路径（onFire 仍
 * 重读因子重评，条件翻假依旧不卖）。minTicks=0（缺省）纯时间语义，存量
 * 行为 bit-identical。
 *
 * tick 去重 + 腿级覆盖（T109 2026-11-03 0x89e4 flap 止损臂案；T109b 2026-11-04
 * 0x1cffe 交错回推案去重升级 Set）：
 * - 同一笔链上 tick（txHash:logIndex）的重复 touch 零效应——FA 两段喂食
 *   （processTick 价格段 + applyWalletTick wallet 段回推，resolver 开启时每笔
 *   tick 各 emit 一次 factorsUpdated）会让卖腿评估对同一笔 tick 跑两次，旧实现
 *   ticksSeen 双计把 minTicks 证据门稀释减半（事故现场：3 真笔 tick 凑满
 *   minTicks=5 提前 fire）；identity 缺失（tick 无链上键）按独立证据计（旧语义）
 * - T109b：去重键从「相邻单值 lastTickKey」升级为 entry 级 **seenKeys Set**——
 *   首见钱包走 SenderResolver RPC 回查 1-3s 后乱序回推，交错序（A价,B价,A钱包,
 *   B钱包）每步 key≠lastTickKey 相邻去重全部漏过（0x1cffe 现场实锤：minTicks=10
 *   六真笔即 fire，证据门实质≈minTicks/2）；Set 有界 ≤minTicks+1（封顶后证据门
 *   必已满足，多余 key 不再记录零行为差异）
 * - tick=null（扫描兜底路径的快照评估）不是新 tick 证据：只推进时间门检查，
 *   不再 ticksSeen++（旧实现会把 30s 扫描周期当证据凑数，违背「窗后新 tick
 *   数」语义）；无 pending 时仍可起窗（maxWait 逃生链起点）
 * - 腿级覆盖：touch 第三参 legOpts={minTicks, debounceMs, maxWaitMs}（卖腿
 *   sellDebounce 段，T109）逐键回落构造缺省；**首真起算的 entry 固化当时的
 *   effective 门**（窗口内不同腿命中 touch 不改门——防优先级竞争下门参数抖动）
 *
 * 两种驱动模式（同 TickDebouncer 骨架）：
 * - real：setTimeout 驱动（实时引擎，wall-clock 到点即 fire）
 * - virtual：虚拟时钟驱动（回测引擎，每笔 tick 处理前 advance(tickTs) 推进）
 *
 * 已知 parity 缝隙（与母版同构，文档化保留）：触发后变静的死票，virtual 无后续
 * tick 不推进不 fire（回测侧偏保守，maxWaitMs 强制门在 virtual 因时钟静止同样
 * 无法触发）；real 的 maxWait timer 兜底强制 fire——两模式的死票处置刻意不同。
 */

/**
 * tick 链上身份键：实时 collector tick=camelCase（txHash/logIndex）、回测 tick=
 * snake_case（tx_hash/log_index，wss_price_ticks 行形状）——两条管线既定命名。
 * 键缺失（tick=null 或无链上标识）→ null：无键 tick 对象按独立证据计（旧语义，
 * 兼容无链上键的调用方），tick=null 由 touch 分支单独处理（非证据）。
 */
function tickIdentity(tick) {
    if (!tick) return null;
    const tx = tick.txHash || tick.tx_hash;
    const li = tick.logIndex != null ? tick.logIndex : tick.log_index;
    if (!tx || li == null) return null;
    return `${tx}:${li}`;
}

class SellConfirmDebouncer {
  /**
   * @param {Object} opts
   * @param {number} opts.debounceMs - 确认窗口（<=0 表示不去抖，touch 即 fire；引擎级缺省，腿级可覆盖）
   * @param {number} [opts.minTicks=0] - 确认所需的窗后新 tick 数（<=0 纯时间语义；引擎级缺省，腿级可覆盖）
   * @param {number} [opts.maxWaitMs=120000] - minTicks>0 时的强制逃生上限（<=0 无上限；引擎级缺省，腿级可覆盖）
   * @param {string} opts.mode - 'real' | 'virtual'
   * @param {Function} opts.onFire - (tokenAddress, tick, fireTs) => void
   */
  constructor({ debounceMs, minTicks = 0, maxWaitMs = 120000, mode = 'real', onFire }) {
    this._debounceMs = debounceMs;
    this._minTicks = minTicks;
    this._maxWaitMs = maxWaitMs;
    this._mode = mode;
    this._onFire = onFire;
    this.pending = new Map(); // tokenAddress → entry
    this.stats = { fired: 0, suppressed: 0, forceFired: 0, deduped: 0 };
  }

  /**
   * 注册一次卖出条件为真（首真起计，后续真 tick 不重置、只凑证据数）。
   * @param {string} tokenAddress
   * @param {Object|null} tick - virtual 模式必须带 timestamp(ms)；real 模式任意（透传给 onFire）；
   *   null=扫描兜底路径的快照评估（非 tick 证据，T109）
   * @param {Object} [legOpts] - 腿级覆盖（T109 sellDebounce 段）：{minTicks, debounceMs,
   *   maxWaitMs} 逐键回落构造缺省；首真起算时固化进 entry，已 pending 的 touch 忽略
   */
  touch(tokenAddress, tick, legOpts) {
    const opt = legOpts || {};
    const debounceMs = opt.debounceMs != null ? opt.debounceMs : this._debounceMs;
    if (debounceMs <= 0) {
      this.stats.fired++;
      this._onFire(tokenAddress, tick, this._mode === 'virtual' ? tick.timestamp : Date.now());
      return;
    }
    const minTicks = opt.minTicks != null ? opt.minTicks : this._minTicks;
    const maxWaitMs = opt.maxWaitMs != null ? opt.maxWaitMs : this._maxWaitMs;
    const key = tickIdentity(tick);

    const existing = this.pending.get(tokenAddress);
    if (existing) {
      // T109b 同 tick 双投递零效应（Set 全窗去重）：同一笔链上交易不是两份证据
      // ——相邻去重挡不住 defer 交错回推（A价,B价,A钱包,B钱包），见头部 T109b 注
      if (key != null && existing.seenKeys.has(key)) {
        this.stats.deduped++;
        return;
      }
      this.stats.suppressed++; // 已 pending：不重置（让首真 tick 满期）
      // tick=null（扫描快照评估）不计证据；有键/无键 tick 对象均计（见 tickIdentity 注）
      if (tick != null) {
        existing.ticksSeen++;
        // Set 有界 ≤minTicks+1：size 达帽（=证据门已满足 ticksSeen≥minTicks）后
        // 不再记录——此后 key 重复与否零行为差异（ticksOk 单调为真），省薄盘长窗内存
        if (key != null && existing.seenKeys.size <= existing.minTicks) {
          existing.seenKeys.add(key);
        }
      }
      if (this._mode === 'real') {
        // 双门即时检查：时间窗已过且证据凑齐 → fire（debounce timer 到点但证据
        // 不足转等待后的唯一补 fire 路径；时间未到则等 debounce timer）
        this._tryFire(tokenAddress, existing, Date.now(), false);
      }
      return;
    }

    if (this._mode === 'virtual') {
      if (tick == null) return; // 扫描快照评估无 timestamp：virtual 时钟无法起算，no-op
      this.pending.set(tokenAddress, {
        startTs: tick.timestamp, ticksSeen: 0, tick, seenKeys: new Set(key != null ? [key] : []),
        debounceMs, minTicks, maxWaitMs, armed: minTicks > 0,
      });
      return;
    }

    // real 模式：timer 驱动；entry 固化腿级 effective 门（T109）
    const now = Date.now();
    const entry = { startTs: now, ticksSeen: 0, tick, debounceTimer: null, maxTimer: null,
      seenKeys: new Set(key != null ? [key] : []), debounceMs, minTicks, maxWaitMs, armed: minTicks > 0 };
    entry.debounceTimer = setTimeout(() => {
      // 时间窗到点：证据已凑齐 → fire；不足 → 转等待（后续 touch 补 fire，maxTimer 兜底）
      this._tryFire(tokenAddress, entry, Date.now(), false);
    }, entry.debounceMs);
    if (entry.armed && entry.maxWaitMs > 0) {
      entry.maxTimer = setTimeout(() => {
        this._fire(tokenAddress, entry, Date.now(), true);
      }, entry.maxWaitMs);
    }
    this.pending.set(tokenAddress, entry);
  }

  /**
   * 双门检查：时间窗已过 AND 证据凑齐才 fire（minTicks=0 时等价纯时间门）。
   * 门参数读 entry（T109 腿级固化），构造值只作首真缺省。fire 前清两个 timer
   * （fire 与 pending 删除原子成对）。
   */
  _tryFire(tokenAddress, entry, now, force) {
    const elapsed = now - entry.startTs;
    const timeOk = elapsed >= entry.debounceMs;
    const ticksOk = !entry.armed || entry.ticksSeen >= entry.minTicks;
    if (force || (timeOk && ticksOk)) {
      this._fire(tokenAddress, entry, now, force);
    }
  }

  _fire(tokenAddress, entry, now, force) {
    clearTimeout(entry.debounceTimer);
    clearTimeout(entry.maxTimer);
    this.pending.delete(tokenAddress);
    this.stats.fired++;
    if (force) this.stats.forceFired++;
    this._onFire(tokenAddress, entry.tick, now);
  }

  /**
   * 虚拟时钟推进：fire 所有「时间窗已过 AND 证据凑齐」项；强制门在此同样
   * 检查（时钟只在 tick 到达时推进，死票不推进=不强制，见头部 parity 注释）。
   * @param {number} nowTs - 推进到的虚拟时刻（ms）
   */
  advance(nowTs) {
    if (this._mode !== 'virtual') return;
    for (const [tokenAddress, e] of [...this.pending]) {
      this._tryFire(tokenAddress, e, nowTs,
        e.armed && e.maxWaitMs > 0 && (nowTs - e.startTs) >= e.maxWaitMs);
    }
  }

  /** 清除单项（不 fire）——条件变 false / 卖出完成 */
  clear(tokenAddress) {
    const entry = this.pending.get(tokenAddress);
    if (!entry) return;
    clearTimeout(entry.debounceTimer);
    clearTimeout(entry.maxTimer);
    this.pending.delete(tokenAddress);
  }

  /** 清空全部（不 fire）——引擎停止时调用 */
  clearAll() {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.debounceTimer);
      clearTimeout(entry.maxTimer);
    }
    this.pending.clear();
  }

  get size() {
    return this.pending.size;
  }
}

module.exports = { SellConfirmDebouncer };
