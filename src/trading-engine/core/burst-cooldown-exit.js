/**
 * T189 burst 承接冷盘两批卖出（2026-11-19 立法，四窗 98 票对拍 Δ+0.57）
 *
 * 机制语义（用户裁定原文「burst 触发买入后，15 秒做一次判断，30 秒还可以再做
 * 一次」「如果出现那种买入后冷盘，过很长时间再有流量进入，这种就干脆接受误伤
 * 好了。大多数盈利盘不是这样的」）：
 * - burst 触发买入成交后，观测「承接」= **非 burst 成员钱包**的买入额——
 *   burst 成员集=触发波窗（fire 前最密 5s 窗，波末≤fire+5s）内买过的钱包
 *   （583a 案：fire 在波中段，波的后半段续买全是波成员钱包，若不剔除会把
 *   自拉延续误当承接 → 主案漏网；c97a 案：波后 t+3/5/19s 跟进盘是新钱包，
 *   剔除后 0.17B 承接在场 → 免疫 ✓）
 * - 批 1（fire+15s）：承接 <0.1B → 立即 bypass 全清（「15 秒已经明确的就卖了」
 *   ——不等确认；577c 案 0.069B 触发，卖在 −7.9% vs 实际 −19.9%）
 * - 批 2（15s 存活者，fire+15s~30s 观察段）：
 *   - 快线（事件驱动）：段内承接累计 <0.05B ∧ 距末笔承接 ≥8s ∧ now≥fire+23s
 *     → 立即卖（「30 秒有一些已经等不及，收割方已经收割喽」——531d 案 23s 卖
 *     −0.044 vs 30s 兜底 −0.055）
 *   - 兜底（fire+30s）：段末承接 <0.05B → 卖（583a 案 fire 后两窗承接全 0）
 *   - 段末承接 ≥0.05B → 解除（c97a 案段末 0.098B 免疫——Y 线 0.05 与 c97a
 *     0.098 之间余量 0.048；Y=0.1 会误杀 c97a −0.296，线值敏感点留档）
 * - 知情代价（用户裁定接受）：迟到流量型小正票（3f5a −0.048/769b9f −0.042/
 *   fa99 −0.016 级，四窗合计 −0.37）；大赢家全免疫（2f17/40ef/ba5e/efbd/c97a/
 *   7c89 承接 0.17~2.3B 在场）
 * - 与 stallClose 互补：stallClose 管零成交断流，本机制管「有成交但无新钱包
 *   承接」（577c/583a 死时 tick 不断全是卖单=stallClose 盲区）
 *
 * 数据形状（FA ring：wallet 终态口径，_applyWalletAggregation 每行恰一次，
 * defer 乱序回推行按 ms 过滤天然容忍）：{ms, side:'buy'|'sell', w, bnb}
 */

'use strict';

/** 默认配置（回放线值：X=0.1/Y=0.05 甜点区——0.2 开始误杀 c97a） */
const BURST_COOLDOWN_DEFAULTS = Object.freeze({
  check1Sec: 15,          // 批 1 检查点（fire 后秒数）
  check1MinAbsorbBnb: 0.1, // 批 1 冷盘线：[fire, fire+15s] 承接买额 < 此 → 卖
  check2ConfirmSec: 8,    // 批 2 快线确认窗：距末笔承接 ≥ 此秒且 now≥23s → 卖
  check2Sec: 30,          // 批 2 兜底检查点（fire 后秒数）
  check2MinAbsorbBnb: 0.05, // 批 2 冷盘线：(fire+15s, fire+30s] 承接 < 此 → 卖
});

/** ring 观测窗（fire 前 60s——波窗定位原料；与回放口径一致） */
const BURST_CREW_LOOKBACK_MS = 60000;
/** 波窗长度（最密 5s 窗——T117 burst5 同族口径） */
const BURST_CREW_WIN_MS = 5000;
/** 波末上界约束（fire+5s：fire 在波中段时波尾 1~2 笔也是成员，577c fire=波第 6 笔/波末=第 7 笔） */
const BURST_CREW_END_GRACE_MS = 5000;
/** ring 行数上限（FIFO 保护；60s 窗高频票兜底，查询按 ms 过滤不依赖边界精确） */
const BURST_CREW_RING_MAX = 2000;

/**
 * 波窗定位 + burst 成员集冻结（纯函数；arm/检查点回溯共用）
 * @param {Array<{ms:number, side:string, w:string|null, bnb:number}>} ring FA ring 快照
 * @param {number} t0Ms 买入成交时刻（fire==成交，回放口径）
 * @returns {{crewSet:Set<string>, winStartMs:number, winEndMs:number, crewBnb:number}|null}
 *   无候选窗（fire 前 60s 无行）→ null（无 burst 语境：crew 空 → 全部买算承接，
 *   fail-open 放行方向——宁不拦不冒充）
 */
function locateBurstCrew(ring, t0Ms) {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  const lo = t0Ms - BURST_CREW_LOOKBACK_MS;
  const hi = t0Ms + BURST_CREW_END_GRACE_MS;
  const rows = ring.filter(t => t.ms >= lo && t.ms <= hi);
  if (rows.length === 0) return null;
  // 最密 5s 窗（全 tick 口径——买卖都算密度；与回放 densest5s 一致）。
  // T199c 平手破除（2026-11-20，0x4509 案）：n 并列时依次比 ①窗内买力大者
  //（真波买力强于旧回补簇/卖单簇——CD402 量级线同逻辑；卖单簇赢密度时 crew
  // 可为空集=承接全量误计、机制欠火）②窗末更晚（更贴 fire——crew 语义锚=
  // 「触发我们买入的那波」，与 t0+5s 宽限意图一致）。旧形状 `n > best.n`
  // 严格大于=first-found 判更早窗：0x4509 案贴 fire 真波（4 户 0.416B）输给
  // 13s 前旧回补窗（2 户 0.099B，含恰好 5s 边界的两笔卖单）→ 波成员同秒
  // 续买 0.218B 误计承接救活批1。六窗影响面（tmp-4509-tiebreak-impact.cjs）：
  // 307 armed 中 crew 换窗 42/判定翻转 10（全部提前到批1@15s，含 2 张晚卖
  // 价差 −35.8%/−23.7%、3 张 release 误活改杀）+22 张旧空 crew 票新进 armed
  let best = null;
  for (let i = 0; i < rows.length; i++) {
    let j = i;
    while (j < rows.length && rows[j].ms - rows[i].ms <= BURST_CREW_WIN_MS) j++;
    const n = j - i;
    if (n === 0) continue;
    let buyBnb = 0;
    for (let k = i; k < j; k++) {
      if (rows[k].side === 'buy' && rows[k].w) buyBnb += rows[k].bnb || 0;
    }
    const endMs = rows[j - 1].ms;
    if (best === null
      || n > best.n
      || (n === best.n && (buyBnb > best.buyBnb
        || (buyBnb === best.buyBnb && endMs > best.endMs)))) {
      best = { n, i, endIdx: j - 1, buyBnb, endMs };
    }
  }
  if (best === null || best.n === 0) return null;
  const winStartMs = rows[best.i].ms;
  const winEndMs = rows[best.endIdx].ms;
  const crewSet = new Set();
  let crewBnb = 0;
  for (const t of rows) {
    if (t.ms >= winStartMs && t.ms <= winEndMs && t.side === 'buy' && t.w) {
      crewSet.add(t.w);
      crewBnb += t.bnb || 0;
    }
  }
  return { crewSet, winStartMs, winEndMs, crewBnb };
}

/**
 * 承接视图（检查点回溯计算——无累计状态，defer 乱序/波尾延迟天然容忍）
 * @param {Array<{ms:number, side:string, w:string|null, bnb:number}>} ring
 * @param {{t0Ms:number, ownWallets:Set<string>}} arm
 * @param {object} cfg BURST_COOLDOWN_DEFAULTS 形状
 * @returns {{t0Ms:number, crewSize:number, crewBnb:number, w1Bnb:number, w2Bnb:number,
 *            lastAbs1Ms:number|null, lastAbs2Ms:number|null, w2SoFarBnb:number}}
 *   w1Bnb/w2Bnb=全窗值（兜底判定用）；w2SoFarBnb/lastAbs2Ms=截至 ring 末的段内
 *   累计（快线判定用——as-of 正确，不带段末前视）
 */
function buildBurstCooldownView(ring, arm, cfg) {
  const c1 = (cfg.check1Sec || BURST_COOLDOWN_DEFAULTS.check1Sec) * 1000;
  const c2 = (cfg.check2Sec || BURST_COOLDOWN_DEFAULTS.check2Sec) * 1000;
  const crew = locateBurstCrew(ring, arm.t0Ms) || { crewSet: new Set(), winStartMs: null, winEndMs: null, crewBnb: 0 };
  const own = arm.ownWallets || new Set();
  let w1Bnb = 0, w2Bnb = 0, lastAbs1Ms = null, lastAbs2Ms = null;
  for (const t of (ring || [])) {
    if (t.side !== 'buy' || t.ms < arm.t0Ms) continue;
    if (!t.w || crew.crewSet.has(t.w) || own.has(t.w)) continue;
    if (t.ms < arm.t0Ms + c1) {
      w1Bnb += t.bnb || 0;
      if (t.ms > (lastAbs1Ms || 0)) lastAbs1Ms = t.ms;
    } else if (t.ms < arm.t0Ms + c2) {
      w2Bnb += t.bnb || 0;
      if (t.ms > (lastAbs2Ms || 0)) lastAbs2Ms = t.ms;
    }
  }
  return {
    t0Ms: arm.t0Ms,
    crewSize: crew.crewSet.size,
    crewBnb: +(crew.crewBnb || 0).toFixed(4),
    w1Bnb: +w1Bnb.toFixed(4),
    w2Bnb: +w2Bnb.toFixed(4),
    w2SoFarBnb: +w2Bnb.toFixed(4), // ring 快照即「截至现在」，与 w2Bnb 同值（语义分离供快线消费）
    lastAbs1Ms, lastAbs2Ms,
  };
}

/**
 * 状态机判定（引擎扫描点每持仓票调用）
 * @param {object} view buildBurstCooldownView 产物
 * @param {number} nowMs 检查时刻（实时=墙钟/回测=虚拟 tickTs）
 * @param {object} cfg
 * @returns {null|{action:'sell', batch:'w1'|'w2-fast'|'w2-final', reason:string,
 *                    info:{batch:string, w1Bnb:number, w2Bnb:number, crewSize:number, elapsedSec:number}}
 *          |{action:'release', reason:string}}
 *   null=未到时点/不动作；release=30s 存活解除（清 arm，正常卖腿接管）
 */
function evaluateBurstCooldown(view, nowMs, cfg) {
  if (!view) return null;
  const c1 = (cfg.check1Sec || BURST_COOLDOWN_DEFAULTS.check1Sec) * 1000;
  const c2 = (cfg.check2Sec || BURST_COOLDOWN_DEFAULTS.check2Sec) * 1000;
  const confSec = (cfg.check2ConfirmSec || BURST_COOLDOWN_DEFAULTS.check2ConfirmSec) * 1000;
  const x1 = cfg.check1MinAbsorbBnb != null ? cfg.check1MinAbsorbBnb : BURST_COOLDOWN_DEFAULTS.check1MinAbsorbBnb;
  const x2 = cfg.check2MinAbsorbBnb != null ? cfg.check2MinAbsorbBnb : BURST_COOLDOWN_DEFAULTS.check2MinAbsorbBnb;
  const elapsed = nowMs - view.t0Ms;
  if (elapsed < c1) return null; // 未到批 1 检查点
  // 批 1：明确冷立即卖（迟到扫描仍有效——卖出条件不随时间失效）
  if (view.w1Bnb < x1) {
    return {
      action: 'sell', batch: 'w1', reason: 'burst 承接冷盘·批1(15s 承接不足)',
      info: { batch: 'w1', w1Bnb: view.w1Bnb, w2Bnb: view.w2Bnb, crewSize: view.crewSize, elapsedSec: Math.round(elapsed / 1000) },
    };
  }
  // 批 2 兜底：30s 段末承接不足
  if (elapsed >= c2) {
    if (view.w2Bnb < x2) {
      return {
        action: 'sell', batch: 'w2-final', reason: 'burst 承接冷盘·批2(30s 承接不足)',
        info: { batch: 'w2-final', w1Bnb: view.w1Bnb, w2Bnb: view.w2Bnb, crewSize: view.crewSize, elapsedSec: Math.round(elapsed / 1000) },
      };
    }
    return { action: 'release', reason: 'burst 承接在场(30s 存活解除)' };
  }
  // 批 2 快线（事件驱动）：段内承接枯竭 ≥confirmSec 且已到 23s（c1+confSec）——
  // 用「截至现在」累计（as-of 正确）；c97a 案 t+19s 承接 0.098≥Y → 快线永不触发
  if (elapsed >= c1 + confSec && view.w2SoFarBnb < x2
    && (view.lastAbs2Ms === null || nowMs - view.lastAbs2Ms >= confSec)) {
    return {
      action: 'sell', batch: 'w2-fast', reason: 'burst 承接冷盘·批2(段内承接枯竭)',
      info: { batch: 'w2-fast', w1Bnb: view.w1Bnb, w2Bnb: view.w2SoFarBnb, crewSize: view.crewSize, elapsedSec: Math.round(elapsed / 1000) },
    };
  }
  return null;
}

module.exports = {
  BURST_COOLDOWN_DEFAULTS,
  BURST_CREW_LOOKBACK_MS,
  BURST_CREW_WIN_MS,
  BURST_CREW_END_GRACE_MS,
  BURST_CREW_RING_MAX,
  locateBurstCrew,
  buildBurstCooldownView,
  evaluateBurstCooldown,
};
