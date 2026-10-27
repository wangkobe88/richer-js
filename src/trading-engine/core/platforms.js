/**
 * platform 归一化（多平台实验唯一入口）
 *
 * experiment.config.platform 取值：
 *   - 'fourmeme'（缺省）→ ['fourmeme']
 *   - 'flap'            → ['flap']
 *   - 'gang'            → ['gang']（2026-10-27 gang.fun 接入；单平台先行，'both' 语义不动）
 *   - 'both'            → ['fourmeme', 'flap']（双平台实验：单引擎 per-token 分派；
 *                         刻意不含 gang——三平台组合待 gang 观察期后另案裁定）
 *
 * 引擎选择/wsConfig 段选择的存量判断全是标量相等（`=== 'flap'`），'both' 在每处
 * 自然落入"非 flap → 默认分支"（基类引擎 + fourmemeWs 段）；'gang' 由
 * GangWssTradingEngine 子类接管（gangWs 段）；平台集合的展开只发生在 _createCollectors
 * 构造 / _handleNewToken 分派 / BacktestEngine ticks .in 三处。
 */

'use strict';

const DUAL_PLATFORM = 'both';

/** 返回新数组（调用方可用 Set 包装）；未知值（含 undefined）一律 ['fourmeme'] */
function resolvePlatforms(platform) {
  if (platform === DUAL_PLATFORM) return ['fourmeme', 'flap'];
  if (platform === 'flap') return ['flap'];
  if (platform === 'gang') return ['gang'];
  return ['fourmeme'];
}

module.exports = { resolvePlatforms, DUAL_PLATFORM };
