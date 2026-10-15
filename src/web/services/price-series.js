'use strict';

/**
 * wss_price_ticks → 价格线序列重建（2026-10-15 trades 页时序价格线图 ticks 化）
 *
 * 背景：experiment_time_series_data 30s 快照停写（2026-10-15 效率优化批次 2），
 * trades 页时序价格线图（原 fetchTimeSeriesData → initPriceLineChart 链）改由
 * tick 表投影重建。与 Holder 走势图（holder-series.js）对称：价格是 tick 行
 * 自带量（无重放语义），纯投影 price_usd + 服务端降采样即可。
 *
 * 口径与 /api/ticks、tick-kline-service 价格图口径一致（查询侧过滤）：
 *   price_outlier=false + price_usd 非空；按 token_address 全局拉取不挂实验
 *   （回测实验不再借源实验数据，天然跨实验一致，实验停止后数据继续完整）。
 */

// Chart.js time 轴绘制甜点（与 holder-series 同值；原时序快照 30s/点更粗）
const DEFAULT_MAX_POINTS = 2000;

/**
 * tick 行 → 价格点序列（纯投影 + 降采样）
 * @param {Array<Object>} rows wss_price_ticks 行（瘦列即可：block_time/price_usd），
 *   **须按 block_time 升序传入**（端点拉取序；本函数不排序不兜底——拉取序即合同）
 * @param {Object} [opts]
 * @param {number} [opts.maxPoints=2000] 降采样上限（等步长取桶尾 + 保末点）
 * @returns {{points: Array<{t:number, p:number}>, totalRows: number}}
 *   points 时间单调升（继承传入序）；p=price_usd（Number）
 */
function buildPriceSeries(rows, opts = {}) {
  const maxPoints = opts.maxPoints != null ? opts.maxPoints : DEFAULT_MAX_POINTS;

  const pts = [];
  for (const row of rows || []) {
    const raw = row.price_usd;
    // null/undefined/空串显式挡：Number(null)/Number('') 均为 0 会把坏行冒充 0 价观测
    if (raw === null || raw === undefined || raw === '') continue;
    const p = Number(raw);
    if (!Number.isFinite(p)) continue;
    const t = new Date(row.block_time).getTime();
    if (!Number.isFinite(t)) continue;
    pts.push({ t, p });
  }

  return {
    points: _downsample(pts, maxPoints),
    totalRows: (rows || []).length,
  };
}

/** 等步长取桶尾 + 保末点（与 holder-series._downsample 同款：段尾抽样取段内
 *  末状态，不造中间值；阶跃/连续函数同形适用） */
function _downsample(points, maxPoints) {
  if (!(maxPoints > 0) || points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out = [];
  for (let i = step - 1; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

module.exports = { buildPriceSeries, DEFAULT_MAX_POINTS };
