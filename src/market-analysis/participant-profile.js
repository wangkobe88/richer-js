/**
 * 参与者 GMGN 画像聚合（2026-11-19 张雪电摩 pump 作弊案→GMGN 钱包画像库首建的
 * 消费端；T193 观察键，**不进门不拦截**——阈值待真实信号分布裁定后立法）
 *
 * 数据链：锚窗 ticks（BP 门已拉，零新增拉数）→ top-N 买家（wallet=sender||trader
 * COALESCE 与 FA/TPA 同口径；买额 ≥ minBuyBnb 尘埃门）→ gmgn_wallet_profiles 表
 * 批量 PK 查询（毫秒级；离线脚本 build-gmgn-wallet-profiles.cjs 回填的 30d 快照）
 * → 聚合观察键。
 *
 * 案例定标（张雪电摩 0x7174c6d4…7777，flap）：56 参与钱包 bot 标签 36%、30d 平均
 * 293 票、33/54 亏损 Σ-8704$ 稳定小亏打工形状、对倒主力=低票数一次性小号批次同秒
 * 停机。但活跃圈基线（4273 钱包库）bot 浓度 76%/亏损 62%/小亏带 53%——**单指标
 * 无判别力，分离轴必须组合形状**，故先观察攒分布。
 *
 * 口径要点：
 *   - 表 miss（离线库未覆盖）≠ GMGN 无记录——miss 钱包不进任何分子分母，只计数
 *     selected vs profiled（命中率本身是观察键：活跃圈命中率应≈100%）
 *   - 字段 null（如 token_num 缺）不进对应统计的分母
 *   - realized_profit 亿级异常值（套利 bot 统计伪值，实测 -25 亿~-50 亿级 3 个）：
 *     medianRealizedProfit 用中位数天然免疫；smallLoserPct 的带 (-2000,0] 也不受污染
 *   - 回测不接线（service 侧 _persist=false 门控）——表是「现在拉」的快照，对历史
 *     fire 时刻是已知时序穿越（T183 smartmoney 同款近似红线）
 *   - winrate 是 GMGN 原值 0~1 小数，透传不换算
 */

'use strict';

const PARTICIPANT_PROFILE_VERSION = 'PP1';

const BOT_TAGS = ['gmgn', 'gmgn_go', 'arbitrager'];
const SMALL_LOSER_MIN_USD = -2000; // 小亏打工带下界（张雪电摩案定标带；开区间下界/闭上界）
const YOUNG_MAX_AGE_DAYS = 30;

const DEFAULTS = {
  topN: 10,        // 锚窗 top-N 买家（按买额）
  minBuyBnb: 0.01, // 入选尘埃门（C89 gmgnWalletStats.minBuyBnb 同线）
};

/** 锚窗 buy 行 → top-N 买家 [{wallet,bnb}]（wallet=sender||trader；聚合同钱包多笔） */
function selectTopBuyers(tickRows, opts = {}) {
  const topN = Number.isFinite(opts.topN) && opts.topN > 0 ? Math.floor(opts.topN) : DEFAULTS.topN;
  const minBnb = Number.isFinite(opts.minBuyBnb) && opts.minBuyBnb >= 0 ? opts.minBuyBnb : DEFAULTS.minBuyBnb;
  const agg = new Map();
  for (const r of (tickRows || [])) {
    if (!r || r.trade_type !== 'buy') continue;
    const w = String(r.sender_address || r.trader_address || '').toLowerCase();
    if (!w) continue;
    const bnb = Number(r.bnb_amount) || 0;
    agg.set(w, (agg.get(w) || 0) + bnb);
  }
  return [...agg.entries()]
    .filter(([, bnb]) => bnb >= minBnb)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([wallet, bnb]) => ({ wallet, bnb: Number(bnb.toFixed(4)) }));
}

/** 中位数（排序取下中位——偶数长度取 n/2-1 位，确定性单值便于断言与分布对比） */
function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/**
 * top 买家 × 库内画像行 → 聚合观察键。
 * @param {Array<{wallet:string,bnb:number}>} topBuyers - selectTopBuyers 产物
 * @param {Map<string,Object>} profiles - 库内行（address 小写 → 表行；miss 不在 Map）
 * @param {Object} [opts] - { nowSec } 年龄锚（缺省不记 young——实时调用方传 now）
 * @returns {Object} 观察键段（落 buy_point_analyses digest / signal metadata；不进条件串）
 */
function aggregateParticipantProfile(topBuyers, profiles, opts = {}) {
  const nowSec = Number.isFinite(opts.nowSec) ? opts.nowSec : null;
  const hit = [];
  const wallets = [];
  for (const b of topBuyers || []) {
    const row = profiles.get(b.wallet);
    if (!row) {
      // 库 miss：不计分子分母（≠无记录——离线库未覆盖而已）
      wallets.push({ wallet: b.wallet, buyBnb: b.bnb, miss: true });
      continue;
    }
    const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
    // null/undefined 不得经 Number() 变 0（Number(null)=0 且 finite——token_num null
    // 会冒充 0 票、realized_profit null 会落进 (-2000,0] 小亏带；单测 B4/B6 反证锁定）
    const num = (v) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
    const hitInfo = {
      wallet: b.wallet,
      buyBnb: b.bnb,
      miss: false,
      tags,
      tokenNum: num(row.token_num),
      realizedProfit: num(row.realized_profit),
      winrate: num(row.winrate),
      createdAtSec: num(row.created_at_sec),
    };
    hit.push(hitInfo);
    wallets.push(hitInfo);
  }
  const num = (arr, k) => arr.map(h => h[k]).filter(Number.isFinite);
  const pct = (part, total) => (total > 0 ? Number((part / total * 100).toFixed(1)) : null);

  const tokNums = num(hit, 'tokenNum');
  const rps = num(hit, 'realizedProfit');
  const wrs = num(hit, 'winrate');
  const botHit = hit.filter(h => h.tags.some(t => BOT_TAGS.includes(t)));
  const smallLoser = rps.filter(v => v <= 0 && v > SMALL_LOSER_MIN_USD);
  // young：钱包创建龄 ≤30d（created_at 不可变，任意 now 均有效；nowSec 缺省不评）
  let youngCount = null;
  if (nowSec != null) {
    const withAge = hit.filter(h => h.createdAtSec != null && h.createdAtSec > 0);
    youngCount = withAge.filter(h => nowSec - h.createdAtSec <= YOUNG_MAX_AGE_DAYS * 86400).length;
  }
  return {
    version: PARTICIPANT_PROFILE_VERSION,
    selected: (topBuyers || []).length,
    profiled: hit.length,
    medianTokenNum: median(tokNums),
    medianRealizedProfit: rps.length ? Number(median(rps).toFixed(2)) : null,
    medianWinrate: median(wrs),
    smallLoserPct: pct(smallLoser.length, rps.length),
    youngPct: youngCount == null ? null : pct(youngCount, hit.filter(h => h.createdAtSec != null).length),
    botTagPct: pct(botHit.length, hit.length),
    wallets,
  };
}

module.exports = {
  PARTICIPANT_PROFILE_VERSION,
  BOT_TAGS,
  DEFAULTS,
  selectTopBuyers,
  aggregateParticipantProfile,
};
