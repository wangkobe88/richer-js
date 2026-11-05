/**
 * 买入点位分析测试集纯函数（BP1，2026-11-03）——零 DB 零网络。
 * 供 build-set.mjs / run.mjs（182 跑）与单测 _test_buy_point_lib.cjs 共用；
 * 台账 docs/买入点位分析与Case台账.md。
 *
 * 口径纪律：
 * - anchorCountAt **import 自 ../cheat-detection/lib.mjs 再 export**（口径单点：
 *   数 block_time ≤ 锚时刻行数，宁多勿少，不依赖单调——回放无法重现「当时 DB
 *   已落几行」，链上时间近似；等号含边界）
 * - 前向收益=**结局观测素材非判定输入**：entry=锚末可靠价（outlier=false 且
 *   price>0）；horizon 窗 (tA, tA+H] 半开；窗内可靠价 <2 → 该 horizon null
 *   （缺证据不以 0 冒充）；outlier 不推 entry/峰值
 * - episode 口径移植自 scripts/mcap-floor-sell-replay.cjs（qty 按 token 数累积、
 *   ≤1e-9 闭合；pnl=Σ卖 output−Σ买 input；open 用末可靠价盯市）；**卖先于买 →
 *   null**（账目异常防御，不冒充）
 */

/** 前向收益 horizon（秒）：+1min / +5min / +15min（用户裁定） */
export const FWD_HORIZONS_SEC = [60, 300, 900];

/** 锚计算（口径单点：cheat-detection/lib.mjs——宁多勿少近似） */
export { anchorCountAt } from '../cheat-detection/lib.mjs';

/**
 * 买入信号短窗去重（用户裁定「短窗去重」：同 token 相同 60s 窗内只取首个 BUY 信号，
 * 跨实验按 token 全局去重——同一 token 被多实验同时盯上是常态，点位语义属 token）。
 * 规则：per token created_at 升序（同毫秒按 id 稳定排序），`t − 上次保留 > windowSec*1000`
 * 才保留——**恰 windowSec 秒不保留**（严格大于，单测锁死）。无 created_at 行丢弃。
 * @param {Array} signals - {id, token_address, created_at, ...}（跨实验汇总）
 * @param {number} [windowSec=60]
 * @returns {Array} 保留信号（全局按 created_at 升序返回）
 */
export function dedupeBuySignals(signals, windowSec = 60) {
  const W = windowSec * 1000;
  const byToken = new Map();
  for (const s of signals || []) {
    const k = String((s && s.token_address) || '').toLowerCase();
    if (!k) continue;
    if (!byToken.has(k)) byToken.set(k, []);
    byToken.get(k).push(s);
  }
  const kept = [];
  for (const arr of byToken.values()) {
    arr.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
      || String(a.id).localeCompare(String(b.id)));
    let lastKeptMs = null;
    for (const s of arr) {
      const t = Date.parse(s.created_at);
      if (!Number.isFinite(t)) continue; // 无时刻行丢弃（信号表 created_at 恒在——防御）
      if (lastKeptMs === null || t - lastKeptMs > W) { kept.push(s); lastKeptMs = t; }
    }
  }
  kept.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    || String(a.id).localeCompare(String(b.id)));
  return kept;
}

/**
 * as-of 截窗：rowsAsc 前 n 行（run.mjs 重放=把 set 构建时的窗起点到锚截齐）。
 * 行数不足 → throw（set 锚与 ticks 文件漂移，fail-loud 不静默缩窗）。
 */
export function sliceAsOf(rowsAsc, n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`sliceAsOf: n 非法（${n}）`);
  if (!Array.isArray(rowsAsc) || rowsAsc.length < n) {
    throw new Error(`sliceAsOf: 行数不足（${rowsAsc ? rowsAsc.length : 0} < ${n}）——ticks 文件与 set 锚漂移`);
  }
  return rowsAsc.slice(0, n);
}

/** 可靠价判定（DB 行域：outlier=false 且 price>0——与 snapshot 价格口径一致） */
function reliablePrice(r) {
  return r && !r.price_outlier && Number(r.price_bnb) > 0 ? Number(r.price_bnb) : null;
}

/**
 * 前向收益预计算（结局观测）：entry=前 anchorCount 行中最后一笔可靠价（锚末可靠价，
 * 按（链上真序）行序取末——与 snapshot chg 族窗末价同源）；锚时刻 tA=前 anchorCount
 * 行 max(block_time)（宁多勿少，倒退行照收）。horizon 窗 (tA, tA+H*1000]：
 * maxRisePct=窗内峰值/entry、lastPct=窗末价/entry、pullbackFromMaxPct=窗末/峰值−1
 * （负值=从峰值回落幅度）；窗内可靠价 <2 → 该 horizon null。
 * @returns {{entryPriceBnb:number, anchorTimeIso:string, horizonsSec:number[],
 *   byHorizon:Object<string,{maxRisePct,lastPct,pullbackFromMaxPct,ticks}|null>}|null}
 *   anchorCount=0 或无可靠价 → null（run.mjs 跳过）
 */
export function computeForwardReturns(rowsAsc, anchorCount, { horizonsSec = FWD_HORIZONS_SEC } = {}) {
  if (!Number.isInteger(anchorCount) || anchorCount <= 0) return null;
  const rows = rowsAsc || [];
  let entry = null, tA = -Infinity;
  for (let i = 0; i < Math.min(anchorCount, rows.length); i++) {
    const bt = Date.parse(rows[i] && rows[i].block_time);
    if (Number.isFinite(bt) && bt > tA) tA = bt;
    const p = reliablePrice(rows[i]);
    if (p !== null) entry = p;
  }
  if (entry === null || !Number.isFinite(tA)) return null;
  const byHorizon = {};
  for (const H of horizonsSec) {
    const win = [];
    for (const r of rows) {
      const bt = Date.parse(r && r.block_time);
      if (!Number.isFinite(bt) || bt <= tA || bt > tA + H * 1000) continue;
      const p = reliablePrice(r);
      if (p !== null) win.push(p);
    }
    if (win.length < 2) { byHorizon[H] = null; continue; }
    const max = Math.max(...win), last = win[win.length - 1];
    byHorizon[H] = {
      maxRisePct: +((max / entry - 1) * 100).toFixed(2),
      lastPct: +((last / entry - 1) * 100).toFixed(2),
      pullbackFromMaxPct: +((last / max - 1) * 100).toFixed(2),
      ticks: win.length,
    };
  }
  return {
    entryPriceBnb: entry,
    anchorTimeIso: new Date(tA).toISOString(),
    horizonsSec: [...horizonsSec],
    byHorizon,
  };
}

/**
 * 持仓 episode 切分（口径移植 mcap-floor-sell-replay.cjs）：建仓→清零（qty≤1e-9）
 * 为一个 episode；尾 episode 未平=open。trades 须为**成功交易**且按时间升序
 * （executed_at||created_at）——调用方保证。
 */
export function buildEpisodes(trades) {
  const eps = [];
  let cur = null, qty = 0;
  for (const t of trades || []) {
    const ts = Date.parse(t.executed_at || t.created_at);
    const buy = t.trade_direction === 'buy';
    if (!cur) { cur = { trades: [], startTs: ts, endTs: ts, open: true }; qty = 0; }
    cur.trades.push(t); cur.endTs = ts;
    qty += buy ? Number(t.output_amount) : -Number(t.input_amount);
    if (qty <= 1e-9) { cur.open = false; eps.push(cur); cur = null; }
  }
  if (cur) eps.push(cur);
  return eps;
}

/**
 * episode 盈亏（BNB 域）：pnl=Σ卖 output − Σ买 input；open episode 加余量×
 * markPriceBnb 盯市（markPrice 缺 → pnlBnb=null 只记 openQty）。
 * **卖先于买 → null**（账目异常防御——buildEpisodes 首笔即卖的退化 episode
 * 不冒充盈亏）；qty 为负（超卖）→ null。
 * @returns {{open:boolean, pnlBnb:number|null, openQtyToken:number, costBnb:number, proceedsBnb:number}|null}
 */
export function episodePnlBnb(episode, { markPriceBnb = null } = {}) {
  if (!episode || !Array.isArray(episode.trades) || !episode.trades.length) return null;
  if (episode.trades[0].trade_direction !== 'buy') return null;
  let qty = 0, cost = 0, proceeds = 0;
  for (const t of episode.trades) {
    if (t.trade_direction === 'buy') { qty += Number(t.output_amount); cost += Number(t.input_amount); }
    else { qty -= Number(t.input_amount); proceeds += Number(t.output_amount); }
  }
  if (!Number.isFinite(qty) || qty < -1e-9) return null;
  const open = qty > 1e-9;
  const base = {
    open,
    openQtyToken: open ? qty : 0,
    costBnb: +cost.toFixed(6),
    proceedsBnb: +proceeds.toFixed(6),
  };
  if (open) {
    const mark = Number(markPriceBnb);
    return { ...base, pnlBnb: Number.isFinite(mark) && mark > 0 ? +(proceeds - cost + qty * mark).toFixed(6) : null };
  }
  return { ...base, pnlBnb: +(proceeds - cost).toFixed(6) };
}

/** flap 非 BNB 计价盘标记（尾扫：行序最后一个非空 quote_token——cheat runner 同款） */
export function quoteTokenOf(rowsAsc) {
  let q = null;
  for (const r of rowsAsc || []) {
    const v = r && r.quote_token;
    if (v) q = v;
  }
  return q;
}

/**
 * 成交买点行映射（BP3 trades 源，2026-11-05 用户裁定「换最新三个 live 实验中所有
 * 交易点位，cheat/unhealthy 不收录」）：trades 表成功 buy 行 → 点位行——与 signals
 * 源同构 {id, token_address, token_symbol, created_at, experiment_id, signalInfo}，
 * run.mjs 零改动消费。点位时刻=成交时刻（executed_at||created_at）。
 *
 * priceBnb=input_amount/output_amount 精确换算（BNB 域真实成交价；仅 input_currency
 * 为 BNB 才算——live 买入恒 BNB，非 BNB 行 null 不冒充。trades.unit_price 是 USD
 * 口径，直接放 signalInfo.price 会冒充 BNB fire 价污染 snapshot 对照=不采）。
 * @param {Array} rows - trades 表行（须为成功 buy：调用方过滤）
 * @param {string} expId
 */
export function buildTradePoints(rows, expId) {
  const pts = [];
  for (const r of rows || []) {
    const cur = String((r && r.input_currency) || '').toUpperCase();
    const inputBnb = Number(r.input_amount);
    const outTok = Number(r.output_amount);
    const priceBnb = cur.includes('BNB') && Number.isFinite(inputBnb) && Number.isFinite(outTok)
      && inputBnb > 0 && outTok > 0 ? +(inputBnb / outTok).toFixed(12) : null;
    pts.push({
      id: r.id,
      token_address: r.token_address,
      token_symbol: r.token_symbol || null,
      created_at: r.executed_at || r.created_at,
      experiment_id: expId,
      signalId: r.signal_id || null,       // provenance（trigger 信号链路可回溯）
      tradeId: r.id,
      priceBnb,
      signalInfo: { price: priceBnb, strategyName: null },
    });
  }
  return pts;
}

/**
 * cheat/unhealthy 剔除（build-set 用，2026-11-05 用户裁定）：gradeMap=token→最新
 * 判定 grade（'cheat'|'unhealthy'|'healthy'|null——无判定行=null 放行）。cheat/
 * unhealthy 的 token 全部点位剔除；healthy/无判定放行。
 * @returns {{kept:Array, excluded:Array<{token:string,grade:string}>}}
 */
export function filterByCheatGrades(points, gradeMap = new Map()) {
  const kept = [];
  const excluded = [];
  for (const p of points || []) {
    const g = gradeMap.get(String((p && p.token_address) || '').toLowerCase()) || null;
    if (g === 'cheat' || g === 'unhealthy') excluded.push({ token: String(p.token_address).toLowerCase(), grade: g });
    else kept.push(p);
  }
  return { kept, excluded };
}
