/**
 * ladder 触发点位挖掘（BP3，2026-11-05 用户裁定「通过新的买入条件再挖掘一波，
 * 一个代币可以对应多个点位，多条测试数据」）：per token 历史 ticks 全窗重放
 * FA（processTick→buildFactorMap 逐 tick 快照——与回测/生产同一取数路径），
 * 逐条评估 ladder 腿条件，**per (token, legId) 首次满足**记一个触发点位
 * （对齐生产 maxTriggers=1 触发即消耗语义；t1-t7 阈值递进=同 token 多点位
 * 沿时间轴排开=阶梯接棒形状）。
 *
 * 依赖：FourMemeFactorAggregator（CJS，纯内存零 DB）+ ConditionEvaluator（条件
 * 编译求值）——createRequire 桥接（narrative ESM/引擎 CJS 分界同款纪律）。
 * 零 DB 零网络（FA roster 本地 config 文件读），单测 _test_buy_point_lib K 组真跑。
 */

import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);

/** DB 行 → 回测 tick 形状（BacktestEngine :812 同款映射——字段名单点对齐） */
function rowToTick(row) {
  return {
    token_address: row.token_address,
    trade_type: row.trade_type,
    trader_address: row.trader_address,
    sender_address: row.sender_address || null,
    price_bnb: Number(row.price_bnb),
    bnb_amount: Number(row.bnb_amount || 0),
    token_amount: Number(row.token_amount || 0),
    block_number: row.block_number,
    timestamp: Date.parse(row.block_time),
    tx_hash: row.tx_hash,
    log_index: row.log_index,
    price_outlier: row.price_outlier || false,
    platform: row.platform || null,
  };
}

/** 挖掘点位携带的因子摘要键（七条 ladder 条件全部输入因子——浏览/校准素材） */
const FACTOR_DIGEST_KEYS = [
  'tradeCount', 'buyVolumeBnb', 'holdersExDust', 'recentBlockDropPct',
  'marketCap', 'mcapFromPeakPct', 'quietSpanMs', 'quietSurgeBuyBnb', 'quietSurgeSec',
];

/**
 * 单 token ladder 挖掘。
 * @param {Object} p
 * @param {Array} p.rowsAsc - per token ticks（链上真序升序；与 set ticks 文件同源）
 * @param {Object} p.meta - set tokens 元数据（address/createdAt/symbol/totalSupply/platform/creatorAddress）
 * @param {Array} p.legs - [{id, priority, condition, description}]（strategy_library 快照）
 * @param {Object} [p.factorParams] - FA 因子参数覆盖（缺省 FA FACTOR_PARAM_DEFAULTS）
 * @returns {Array<{legId, tsIso, anchorTickCount, priceBnb, factors}>} 命中点位（时间升序）
 */
export function mineLadderPoints({ rowsAsc, meta, legs, factorParams = null }) {
  const FourMemeFactorAggregator = require_('../../src/services/FourMemeFactorAggregator.js'); // module.exports = 类本体
  const { ConditionEvaluator } = require_('../../src/strategies/ConditionEvaluator.js');
  if (!Array.isArray(rowsAsc) || !rowsAsc.length) return [];
  if (!Array.isArray(legs) || !legs.length) return [];
  const addr = String(meta.address || (rowsAsc[0] && rowsAsc[0].token_address) || '').toLowerCase();
  if (!rowsAsc[0].token_address) {
    throw new Error('mineLadderPoints: ticks 行缺 token_address 字段（拉取列漏列会让 processTick 全行静默跳过=因子恒零）——检查 TICK_COLS');
  }
  const fa = new FourMemeFactorAggregator(factorParams ? { fourmemeWs: { factorParams } } : {}, null);
  const ev = new ConditionEvaluator();
  // createdAt 缺失回退首 tick（回测 P17 复流同款 fallback 语义）
  const createdAtMs = meta.createdAt ? Date.parse(meta.createdAt) : Date.parse(rowsAsc[0].block_time);
  fa.registerToken(addr, {
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.parse(rowsAsc[0].block_time),
    totalSupply: meta.totalSupply || 0,
    symbol: meta.symbol || '',
    creatorAddress: meta.creatorAddress || null,
    platform: meta.platform || null,
    graduationThresholdBnb: null,
  });
  const pending = [];
  for (const leg of legs) {
    try {
      pending.push({ legId: leg.id, priority: leg.priority, condition: leg.condition, ast: ev.parseCondition(leg.condition) });
    } catch (e) {
      throw new Error(`ladder 腿条件解析失败 ${leg.id}: ${e.message}`);
    }
  }
  const hits = [];
  for (let i = 0; i < rowsAsc.length && pending.length; i++) {
    const row = rowsAsc[i];
    const ts = Date.parse(row.block_time);
    if (!Number.isFinite(ts)) continue;
    fa.processTick(rowToTick(row), { emitFactors: false });
    const factors = fa.buildFactorMap(addr, ts);
    if (!factors) continue;
    for (let j = pending.length - 1; j >= 0; j--) {
      const p = pending[j];
      let pass = false;
      try { pass = ev.evaluate(p.ast, factors) === true; } catch (e) { pass = false; }
      if (!pass) continue;
      pending.splice(j, 1);
      const digest = {};
      for (const k of FACTOR_DIGEST_KEYS) digest[k] = factors.get ? factors.get(k) : factors[k];
      hits.push({
        legId: p.legId,
        priority: p.priority,
        condition: p.condition,
        tsIso: new Date(ts).toISOString(),
        rowBlockTime: row.block_time,
        anchorTickCount: i + 1, // 触发行含入（与 anchorCountAt ≤ 语义一致）
        priceBnb: factors.currentPriceBnb ?? null,
        factors: digest,
      });
    }
  }
  hits.sort((a, b) => Date.parse(a.tsIso) - Date.parse(b.tsIso) || a.priority - b.priority);
  return hits;
}
