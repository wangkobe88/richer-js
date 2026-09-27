'use strict';
/**
 * tiny-level-bad-action — 独立特性：Tiny Level 恶意行为检测（buy/sell 双侧 0.2 BNB 档）
 * （pumpfun 回迁批 4；阈值=母版 ×0.4：0.5/0.5 SOL → 0.2/0.2 BNB）
 *
 * 动机（母版 2026-08-20 LOL CftCfBqr 卡线军团案，用户拍板新增）：bad_action(1.0/2.0) 与 low-level(0.6/1.0)
 *   均被「单笔卡线」绕过——军团单笔精确卡 0.5-0.9 BNB 区间：≥1.0 档 0 笔(bad exempt)，
 *   [0.2,0.6) 段连 low-level 也漏；且闪崩段分片抛售单笔多在 0.2-1.0（ll sell 档 1.0 之下）。
 *   tiny 档 0.2/0.2 覆盖军团全部卡线区间 + 高频 bot <0.4 BNB 早期快速买入。
 *
 * ★独立边界（同 low-level-bad-action 先例，母版 2026-08-05 用户指令「独立特性，不与 bad_action 混淆」）：
 *   - 独立 config 开关（tinyLevelBadAction.{enabled,thresholds}），不嵌 walletScore/bad_action/lowLevelBadAction
 *   - 独立字段命名空间 profile.tinyLevelBadAction.{buy,sell}，不与任何现有字段平级混
 *   - 不影响已有基础机制：bad_action 主口径、lowLevelBadAction 及其 ll cap 参数一概不动
 *
 * 判定口径与 low-level 完全同源：复用同一纯函数、仅阈值档不同（0.2/0.2）→ 两档口径漂移风险为零
 *   （「什么是恶意」的定义共享 wallet-profile-builder 客观常量；tiny 只是更低的阈值档）。
 *   0.2 与金额桶 LARGE_BNB(0.2，small 桶上界) 边界对齐（medium∈[0.2,0.8) 及以上参与）。
 *
 * 输出结构（ll 同构）：{ buy: {'0.2': {early, bad}}, sell: {'0.2': {crash, bad}} }
 *   early/crash = 靶向率分母（不分 cat）；bad = 分子（cat∈恶意类）。
 *   详见 low-level-bad-action.js 头注释（口径说明全适用）。
 */
const {
  computeLowLevelBadAction, mergeLowLevelBadAction,
} = require('./low-level-bad-action');

const DEFAULT_CONFIG = {
  enabled: true,
  buyBnbThresholds: [0.2],   // tiny 早期快速买入单买 BNB（阶梯：baseline 1.0 → low 0.6 → tiny 0.2）
  sellBnbThresholds: [0.2],  // tiny 闪崩集中抛售单卖 BNB（阶梯：baseline 2.0 → low 1.0 → tiny 0.2）
};

/** 计算口径 = computeLowLevelBadAction 传 tiny 阈值（同一纯函数，零口径漂移）。 */
function computeTinyLevelBadAction(ticks, tpMap, config = DEFAULT_CONFIG) {
  return computeLowLevelBadAction(ticks, tpMap, config);
}

/** offline+inc 合并 = mergeLowLevelBadAction（按阈值 key 累加 early/crash/bad，结构同构通用）。 */
const mergeTinyLevelBadAction = mergeLowLevelBadAction;

module.exports = {
  computeTinyLevelBadAction,
  mergeTinyLevelBadAction,
  DEFAULT_CONFIG,
};
