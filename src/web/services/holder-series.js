'use strict';

/**
 * wss_price_ticks → holderCount 时序重建（2026-10-15 Holder 走势图 ticks 化）
 *
 * 背景：experiment_time_series_data 30s 快照停写（2026-10-15 效率优化批次 2），
 * signals 页 Holder 走势图（用户裁定保留）改由 tick 表全量重放重建——
 * holderCount 在 FA 是增量维护量（净持仓跨 0 边界 ±1），从 token 全量 ticks
 * 按同口径重放即可重建任意时刻值。
 *
 * 口径与 FA _applyWalletAggregation bit 一致（五要素，改任何一处须两侧同改）：
 *   1. wallet = sender_address || trader_address（COALESCE；双 NULL 行不计）
 *   2. 尘 tick 剔除：bnb_amount < minTickBnb（collector 分流口径——尘行只落表
 *      不进因子，重放不过滤会把引擎从未见过的行计入净持仓致 holderCount 偏移）
 *   3. token_amount > 0 才计（零/负 token_amount 行跳过）
 *   4. 净持仓跨 0 边界 ±1（等价 #{net>0}，FA P2a 增量维护同款归纳）
 *   5. 行序 = (block_number, log_index) 链上真序（回测归并同款；holderCount 终值
 *      序无关收敛，真序保证中间时刻值与展示时间轴一致）
 */

// collector minTickBnb 同默认（fourmeme/flap 两处 `?? 0.001`，单一默认值此处第三写）
const DEFAULT_MIN_TICK_BNB = 0.001;
// Chart.js time 轴绘制甜点（原时序快照 30s/点 更粗，2000 点已远超原观感分辨率）
const DEFAULT_MAX_POINTS = 2000;

/**
 * 重放 holderCount 时序
 * @param {Array<Object>} rows wss_price_ticks 行（瘦列即可：block_time/block_number/
 *   log_index/trade_type/token_amount/bnb_amount/sender_address/trader_address），
 *   拉取序任意（内部按链上真序排序）
 * @param {Object} [opts]
 * @param {number} [opts.minTickBnb=0.001] 尘 tick 阈值（BNB）
 * @param {number} [opts.maxPoints=2000] 降采样上限（等步长取桶尾 + 保末点）
 * @returns {{points: Array<{t:number, holders:number}>, totalRows: number, holders: number}}
 *   points 时间单调升；holders=终值 holderCount
 */
function buildHolderSeries(rows, opts = {}) {
  const minTickBnb = opts.minTickBnb != null ? opts.minTickBnb : DEFAULT_MIN_TICK_BNB;
  const maxPoints = opts.maxPoints != null ? opts.maxPoints : DEFAULT_MAX_POINTS;

  const usable = [];
  for (const row of rows || []) {
    // 尘 tick 剔除（要素 2；与 collector `decoded.bnbAmount < minTickBnb` 同向同界）
    if (!((Number(row.bnb_amount) || 0) >= minTickBnb)) continue;
    // wallet COALESCE（要素 1；双 NULL 行不计）
    const wallet = row.sender_address || row.trader_address || null;
    if (!wallet) continue;
    // token_amount > 0 才计（要素 3）
    const tokenAmount = Number(row.token_amount) || 0;
    if (!(tokenAmount > 0)) continue;
    const t = new Date(row.block_time).getTime();
    if (!Number.isFinite(t)) continue;
    usable.push({
      t,
      isBuy: row.trade_type === 'buy',
      tokenAmount,
      wallet,
      blockNumber: row.block_number != null ? Number(row.block_number) : -1,
      logIndex: row.log_index != null ? Number(row.log_index) : -1,
    });
  }

  // 链上真序（要素 5）：stable sort，(block,log) 等序行保持到达序（与回测归并一致）
  usable.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.logIndex - b.logIndex));

  const net = new Map();
  let holders = 0;
  const points = [];
  for (const u of usable) {
    const delta = u.isBuy ? u.tokenAmount : -u.tokenAmount;
    const prev = net.get(u.wallet) || 0;
    const cur = prev + delta;
    net.set(u.wallet, cur);
    // 跨 0 边界 ±1（要素 4）
    if (prev <= 0 && cur > 0) holders++;
    else if (prev > 0 && cur <= 0) holders--;
    points.push({ t: u.t, holders });
  }

  return {
    points: _downsample(points, maxPoints),
    totalRows: (rows || []).length,
    holders,
  };
}

/** 等步长取桶尾 + 保末点（阶跃函数抽样取段尾=段内终态，不造中间值） */
function _downsample(points, maxPoints) {
  if (!(maxPoints > 0) || points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out = [];
  for (let i = step - 1; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

module.exports = { buildHolderSeries, DEFAULT_MIN_TICK_BNB, DEFAULT_MAX_POINTS };
