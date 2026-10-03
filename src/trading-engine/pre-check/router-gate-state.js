/**
 * router 门观察史（2026-10-03 用户指令：拦「rp<50 涨进窗」+「被拒 >10 次」）
 *
 * 背景（analyze-router-late-entry.cjs，5efaff23/9252d60a 双样本复现）：
 *   router 区间门 [50,80) 拒后晚进车的票分裂——≥80 回落进窗侧净正（bot 退潮
 *   散户接棒），<50 涨进窗侧净负（GMGN 追热），出界 fire >10 次的票结构不稳
 *   净负。两个形状都是「信号历史」函数而非单次 fire 因子 → 引擎侧维护 per-token
 *   观察史，经 performAllChecks options 透传进 preBuy 评估 context。
 *
 * 语义（与分析口径对齐——signals 序列逐 fire 累计）：
 *   - 回填时机 = buy fire 走到 preBuy 检查完成后（无论 canBuy；此时 signal 行已落）
 *   - 门评估读到的是「截至上次 fire」的状态（fire 后回填）——本次出界由区间门
 *     本身拦截，状态只承载历史形状，无双计数
 *   - 累计条件 = platform==='flap' 且 rp 非空；rp<50 → lowSideSeen=1（只置位不清），
 *     rp<50 或 rp>=80 → outCount+1（区间外即出界）
 *   - 无状态 / 非 flap / rp 缺失 → 因子 null，门写法 fail-open（旧路径、单测裸调兼容）
 *
 * ⚠️ 边界常量与 buy-v2 v6 区间门 [50,80) 同源但物理分离（condition 字符串硬编码）——
 *    若未来区间门改档，此处必须同步（探针无法从 condition 提取，人工对齐）。
 */

const ROUTER_GATE_LOW = 50;
const ROUTER_GATE_HIGH = 80;

/** fire 后回填：纯函数更新状态（返回新对象，调用方自行 set 回 Map） */
function updateRouterGateState(state, platform, routerPct) {
  if (platform !== 'flap' || routerPct == null) return state || { lowSideSeen: 0, outCount: 0 };
  const st = state ? { ...state } : { lowSideSeen: 0, outCount: 0 };
  if (routerPct < ROUTER_GATE_LOW) st.lowSideSeen = 1;
  if (routerPct < ROUTER_GATE_LOW || routerPct >= ROUTER_GATE_HIGH) st.outCount += 1;
  return st;
}

/** 门评估读取：无状态 → 双 null（门写法 `== 0 OR IS NULL` / `<= 10 OR IS NULL` fail-open） */
function routerGateFactors(state) {
  if (!state) return { earlyTradesRouterLowSideSeen: null, earlyTradesRouterRejectCount: null };
  return { earlyTradesRouterLowSideSeen: state.lowSideSeen, earlyTradesRouterRejectCount: state.outCount };
}

module.exports = { updateRouterGateState, routerGateFactors, ROUTER_GATE_LOW, ROUTER_GATE_HIGH };
