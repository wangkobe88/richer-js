/**
 * token_create payload → 回测 _tokenMeta 七键映射（单一真相源）
 *
 * 2026-11-20 Case 集合管理系统引入：原逻辑内嵌于 BacktestEngine
 * _loadTokenMetadataFromEvents（时间范围通道），Case 集合通道
 * （_loadTokenMetadataFromCaseSet，token_meta=wss_events token_create 原始
 * payload 冻结快照）须产出**逐字节相同**的七键形状——抽此处共享，防两通道
 * 映射漂移（改这里两通道同步生效；改任何键名/哨兵逻辑须跑
 * _test_backtest_window_token_universe + _test_backtest_case_channel 对拍）。
 *
 * payload = collector 回调 info 本体（camelCase，与 experiment_tokens
 * raw_api_data 字段名刻意一致）。flap/gang info 不带 totalSupply 键 → 固定
 * 常量（从两 collector 模块 lazy require，避免顶层引入重依赖——对齐原实现）。
 *
 * 纯函数零 DB 零网络（单测 scripts/_test_backtest_case_channel.cjs 直调）。
 */

/**
 * @param {string} platform 行级平台（'fourmeme'|'flap'|'gang'；缺省回落 'fourmeme'）
 * @param {object} payload  token_create 原始 payload
 * @param {string|Date|null} blockTime token_create 行 block_time（ISO 串或 Date）
 * @returns {{symbol:string, name:string, platform:string, createdAtSec:number|null,
 *            totalSupply:number, creator:string|null, graduationThresholdBnb:number|null}}
 */
function tokenMetaFromCreatePayload(platform, payload, blockTime) {
  const plat = platform || 'fourmeme';
  const p = payload || {};
  let totalSupply = Number(p.totalSupply) || 0;
  if (plat === 'flap') {
    // lazy require：与原 BacktestEngine 实现逐字一致（避免顶层引入重依赖）
    const { FLAP_TOTAL_SUPPLY } = require('../../collectors/flap-ankr-ws-collector');
    totalSupply = FLAP_TOTAL_SUPPLY;
  } else if (plat === 'gang') {
    const { GANG_TOTAL_SUPPLY } = require('../../collectors/gang-ankr-ws-collector');
    totalSupply = GANG_TOTAL_SUPPLY;
  }
  return {
    symbol: p.symbol || '',
    name: p.name || '',
    platform: plat,
    createdAtSec: blockTime ? new Date(blockTime).getTime() / 1000 : null,
    totalSupply,
    creator: p.creator || null,
    graduationThresholdBnb: Number(p.gradAmtBnb) > 0 ? Number(p.gradAmtBnb) : null,
  };
}

module.exports = { tokenMetaFromCreatePayload };
