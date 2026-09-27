/**
 * platform 归一化（双平台实验唯一入口）
 *
 * experiment.config.platform 取值：
 *   - 'fourmeme'（缺省）→ ['fourmeme']
 *   - 'flap'            → ['flap']
 *   - 'both'            → ['fourmeme', 'flap']（双平台实验：单引擎 per-token 分派）
 *
 * 引擎选择/wsConfig 段选择的存量判断全是标量相等（`=== 'flap'`），'both' 在每处
 * 自然落入"非 flap → 默认分支"（基类引擎 + fourmemeWs 段）；平台集合的展开只发生在
 * SharedTickConsumer 过滤 / _handleNewToken 分派 / BacktestEngine ticks .in 三处。
 */

'use strict';

const DUAL_PLATFORM = 'both';

/** 返回新数组（调用方可用 Set 包装）；未知值（含 undefined）一律 ['fourmeme'] */
function resolvePlatforms(platform) {
  if (platform === DUAL_PLATFORM) return ['fourmeme', 'flap'];
  if (platform === 'flap') return ['flap'];
  return ['fourmeme'];
}

module.exports = { resolvePlatforms, DUAL_PLATFORM };
