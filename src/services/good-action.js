'use strict';
/**
 * good-action — 独立特性：高质量盘早期集中建仓大买检测（bad_action 对称的「好人」标签，纯观察数据层）
 * （pumpfun 回迁批 4；阈值=母版 ×0.4：5/10 SOL → 2/4 BNB）
 *
 * 动机：钱包质量的最佳背书=发过好盘子。镜像 bad_action 的早期快速买入，但限定在 good 类 token
 *   （high_mcap/quality）上 age∈[0,3s) 的高金额单买，捕获「集中建仓」信号，供策略综合判断时和很多信息一起看。
 *
 * ★历史标注（母版 good-action-falsified memory，2026-07 完整研究）：
 *   - 正面独立因子用法被证伪：候选本质「热门盘早期快速买入者」（好坏盘都早期大买），在非好盘上反向亏，跨 3 源稳定。
 *   - 当年下线主因=覆盖率低（good tag 4720 vs bad 23253），非机制失效。
 *   - 唯一跨源有效是反向用法（gahp 作负面门拦早期快速买入者扎堆）。
 *   本次定位=数据层（非独立因子）。数据结构含 goodBnbRatio（好盘投入占比=当年核心判据），
 *   让使用者在综合判断时区分「真好盘主导」(goodBnbRatio 高=质量背书) vs「好坏盘都抢的早期快速买入者」(低=反向信号)。
 *
 * ★独立边界（同 low-level-bad-action）：独立 config 开关、独立字段 profile.goodAction、独立计算函数。
 *   判定口径（age∈[0,3s) 窗口、good cat 集合、中性类豁免）复用 wallet-profile-builder 客观常量——
 *   这是「什么是好盘」的定义，good_action 只限定 cat，口径不变。
 *
 * ★不进 wallet-scorer（纯观察数据）：scoreProfile 只读 bad_action；goodAction 对评分/买入/verdict 零影响。
 *
 * 口径（镜像 bad_action 的 bad_buy，仅 cat 翻 good + 阈值档 + 加 BNB 量）：
 *   - good buy = holder 在 good 类(high_mcap/quality) token 上 age∈[0,3s)（首笔 buy − token firstTickTime，★age>=0 排除滞后负 age）
 *                单买 ≥<thr> BNB
 *   - 靶向率：分母=满足硬条件候选（所有非中性类，不分 cat），分子=同条件+cat∈good 类。
 *   - goodBnb/allBnb：good 类/全盘早期大买 BNB 总量 → goodBnbRatio=goodBnb/allBnb（当年核心纯度判据）。
 *
 * 输出结构：
 *   { buy: { '<bnb>': { early, good, goodBnb, allBnb } } }
 *   early = 靶向率分母（不分 cat）；good = 分子（cat∈good）；goodBnb/allBnb 支撑 goodBnbRatio。
 *   分母 0 → 该阈值无候选（口径失效），ratio = null。
 *
 * 单位：bnb_amount BNB 浮点；阈值字面量直接比较（母版 lamports 换算已废）。
 */
const {
  BAD_BUY_EARLY_MS, BAD_ACTION_NEUTRAL_CATEGORIES, GOOD_BUY_CATEGORIES,
} = require('./wallet-profile-builder');

const DEFAULT_CONFIG = {
  enabled: true,
  buyBnbThresholds: [2, 4],  // 集中建仓大买 BNB 档（母版 5/10 SOL ×0.4；当年 3SOL 噪声/≥5 有效/10 最纯的多档弹性保留）
};

/**
 * 计算高质量盘早期集中建仓大买（独立特性）。自己聚合 ticks，只取 buy（建仓背书语义，无 sell 分支）。
 * @param {Array} ticks wss_price_ticks 行（{token_address, bnb_amount, trade_type, block_time}）
 * @param {Map|Object} tpMap token → {category, firstTickTime}
 * @param {Object} [config] {enabled, buyBnbThresholds}（默认 DEFAULT_CONFIG）
 * @returns {{buy:Object}|null} enabled=false → null（不生成）
 */
function computeGoodAction(ticks, tpMap, config = DEFAULT_CONFIG) {
  if (!config || config.enabled === false) return null;
  const buyThrs = (Array.isArray(config.buyBnbThresholds) ? config.buyBnbThresholds : [])
    .map(s => ({ key: String(s), bnb: s }));
  const buy = {};
  for (const t of buyThrs) buy[t.key] = { early: 0, good: 0, goodBnb: 0, allBnb: 0 };
  if (!buyThrs.length) return { buy };

  // 自聚合 per-token buys（只取 buy，无 sell 分支）
  const byToken = new Map();
  for (const t of (ticks || [])) {
    if (t.trade_type !== 'buy') continue;
    const tok = t.token_address;
    if (!tok) continue;
    let e = byToken.get(tok);
    if (!e) { e = []; byToken.set(tok, e); }
    e.push({ bt: new Date(t.block_time).getTime(), bnb: Number(t.bnb_amount) || 0 });
  }

  const map = tpMap instanceof Map ? tpMap : new Map(Object.entries(tpMap || {}));

  for (const [tok, buys] of byToken) {
    const prof = map.get(tok);
    if (!prof) continue; // token 无 profile（未分类新 token）→ 不计
    if (BAD_ACTION_NEUTRAL_CATEGORIES.includes(prof.category)) continue; // ★中性类（high_mcap_wash）分子分母都不计（同 bad_action 口径）
    // good buy：age∈[0,3s) 早期集中建仓（★age>=0 排除 firstTickTime 滞后致负 age 误判，同 bad_action 口径）
    if (!prof.firstTickTime) continue;
    const isGoodCat = GOOD_BUY_CATEGORIES.includes(prof.category);
    for (const b of buys) {
      const age = b.bt - prof.firstTickTime;
      if (age >= 0 && age < BAD_BUY_EARLY_MS) {
        for (const t of buyThrs) {
          if (b.bnb >= t.bnb) {
            buy[t.key].early++;
            buy[t.key].allBnb += b.bnb;
            if (isGoodCat) {
              buy[t.key].good++;
              buy[t.key].goodBnb += b.bnb;
            }
          }
        }
      }
    }
  }
  return { buy };
}

/**
 * offline+inc 合并（独立于 mergeOfflineProfile）：按阈值 key 累加 early/good/goodBnb/allBnb。
 * offline/inc 任一缺失 → 用另一份；都缺失 → null。
 * @param {Object|null} o offline 的 goodAction（{buy:{...}}）
 * @param {Object|null} i inc 的 goodAction（{buy:{...}}）
 * @returns {Object|null}
 */
function mergeGoodAction(o, i) {
  if (!o && !i) return null;
  if (!o) return i;
  if (!i) return o;
  const keys = new Set([...Object.keys(o.buy || {}), ...Object.keys(i.buy || {})]);
  const buy = {};
  for (const k of keys) {
    const a = o.buy?.[k] || {};
    const b = i.buy?.[k] || {};
    buy[k] = {
      early: (a.early || 0) + (b.early || 0),
      good: (a.good || 0) + (b.good || 0),
      goodBnb: (a.goodBnb || 0) + (b.goodBnb || 0),
      allBnb: (a.allBnb || 0) + (b.allBnb || 0),
    };
  }
  return { buy };
}

module.exports = {
  computeGoodAction,
  mergeGoodAction,
  DEFAULT_CONFIG,
};
