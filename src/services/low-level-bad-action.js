'use strict';
/**
 * low-level-bad-action — 独立特性：低阈值恶意行为检测（与 bad_action 平级，非其降阈值附属）
 * （pumpfun 回迁批 4；阈值=母版 ×0.4：buy 1.5→0.6 / sell 2.5→1.0 BNB）
 *
 * 动机：bad_action baseline 门（buy ≥1.0 BNB 早期快速买入 / sell ≥2.0 BNB 闪崩集中抛售）抓不到单笔更小的「小金额早期快速买入钱包」。
 *   本特性降 BNB 阈值（buy 0.6 / sell 1.0）捕获同类恶意行为的更小笔，作为 bad_action 的补充观察信号。
 *
 * ★独立边界（母版 2026-08-05 用户指令「独立特性，不与 bad_action 混淆」）：
 *   - 独立 config 开关（lowLevelBadAction.{enabled,thresholds}），不嵌 walletScore/bad_action 参数
 *   - 独立字段命名空间 profile.lowLevelBadAction.{buy,sell}，不与 badBuyRatio/badAction 平级混
 *   - 独立计算函数（本模块），不内联 buildProfileFromTicks 的 bad_action 循环；自己聚合 ticks
 *   判定口径（早期买入 age∈[0,3s) 窗口、闪崩段、恶意 cat 集合）复用 wallet-profile-builder 客观常量——
 *   这是「什么是恶意」的定义，low-level 只是降阈值，口径不变（非 bad_action 私有字段）。
 *
 * ★不进 wallet-scorer 主维度（纯观察数据；仅 ll cap 独立惩罚分支读它）：scoreProfile 主链只读 bad_action 的 effBadRatio 等；
 *   low-level 字段对评分主链/买入过滤/verdict 零影响。先生产生成+展示，观察后决策如何使用。
 *
 * 口径（与 buildProfileFromTicks 的 bad_action 完全一致，仅阈值降）：
 *   - low buy  = holder 在恶意类 token 上 age∈[0,3s)（首笔 buy − token firstTickTime，★age>=0 排除滞后负 age）
 *                单买 ≥<thr> BNB（baseline 1.0 → low 0.6）
 *   - low sell = holder 在 wash 类 token 闪崩段[peak,floor] 单卖 ≥<thr> BNB（baseline 2.0 → low 1.0）
 *   靶向率：分母=满足硬条件候选（不分 cat），分子=同条件+cat∈恶意类。
 *
 * 输出结构：
 *   { buy: {'<bnb>': {early, bad}}, sell: {'<bnb>': {crash, bad}} }
 *   early/crash = 靶向率分母（不分 cat）；bad = 分子（cat∈恶意类）。
 *   分母 0 → 该阈值无候选（口径失效），展示/分析按「无候选」处理（ratio = null）。
 *
 * 单位：bnb_amount BNB 浮点；阈值字面量直接比较（母版 lamports 换算已废）。
 */
const {
  BAD_BUY_CATEGORIES, BAD_SELL_CATEGORIES, BAD_BUY_EARLY_MS, BAD_ACTION_NEUTRAL_CATEGORIES,
} = require('./wallet-profile-builder');

const DEFAULT_CONFIG = {
  enabled: true,
  buyBnbThresholds: [0.6],   // 降阈值的早期快速买入单买 BNB（baseline BAD_BUY 1.0；母版 1.5 SOL ×0.4）
  sellBnbThresholds: [1],    // 降阈值的闪崩集中抛售单卖 BNB（baseline BAD_SELL 2.0；母版 2.5 SOL ×0.4。key=String(1)='1'）
};

/**
 * 计算低阈值恶意行为（独立特性）。自己聚合 ticks，不借用 buildProfileFromTicks 的 byToken。
 * @param {Array} ticks wss_price_ticks 行（{token_address, bnb_amount, trade_type, block_time}）
 * @param {Map|Object} tpMap token → {category, flashCrashPeriod:{peakTime,floorTime}, firstTickTime}
 * @param {Object} [config] {enabled, buyBnbThresholds, sellBnbThresholds}（默认 DEFAULT_CONFIG）
 * @returns {{buy:Object, sell:Object}|null} enabled=false → null（不生成）
 */
function computeLowLevelBadAction(ticks, tpMap, config = DEFAULT_CONFIG) {
  if (!config || config.enabled === false) return null;
  const buyThrs = (Array.isArray(config.buyBnbThresholds) ? config.buyBnbThresholds : [])
    .map(s => ({ key: String(s), bnb: s }));
  const sellThrs = (Array.isArray(config.sellBnbThresholds) ? config.sellBnbThresholds : [])
    .map(s => ({ key: String(s), bnb: s }));
  const buy = {}, sell = {};
  for (const t of buyThrs) buy[t.key] = { early: 0, bad: 0 };
  for (const t of sellThrs) sell[t.key] = { crash: 0, bad: 0 };
  if (!buyThrs.length && !sellThrs.length) return { buy, sell };

  // 自聚合 per-token buys/sells（仅取 low-level 所需，不复用 buildProfileFromTicks 内部 byToken）
  const byToken = new Map();
  for (const t of (ticks || [])) {
    const tok = t.token_address;
    if (!tok) continue;
    let e = byToken.get(tok);
    if (!e) { e = { buys: [], sells: [] }; byToken.set(tok, e); }
    const bt = new Date(t.block_time).getTime();
    const bnb = Number(t.bnb_amount) || 0;
    if (t.trade_type === 'buy') e.buys.push({ bt, bnb });
    else if (t.trade_type === 'sell') e.sells.push({ bt, bnb });
  }

  const map = tpMap instanceof Map ? tpMap : new Map(Object.entries(tpMap || {}));

  for (const [tok, e] of byToken) {
    const prof = map.get(tok);
    if (!prof) continue; // token 无 profile（未分类新 token）→ 不计
    if (BAD_ACTION_NEUTRAL_CATEGORIES.includes(prof.category)) continue; // ★中性类（high_mcap_wash）分子分母都不计（同 bad_action 口径）
    // low buy：age∈[0,3s) 早期快速买入（★age>=0 排除 firstTickTime 滞后致负 age 误判，同 bad_action 口径）
    if (prof.firstTickTime && buyThrs.length) {
      const isBuyCat = BAD_BUY_CATEGORIES.includes(prof.category);
      for (const b of e.buys) {
        const age = b.bt - prof.firstTickTime;
        if (age >= 0 && age < BAD_BUY_EARLY_MS) {
          for (const t of buyThrs) {
            if (b.bnb >= t.bnb) {
              buy[t.key].early++;
              if (isBuyCat) buy[t.key].bad++;
            }
          }
        }
      }
    }
    // low sell：闪崩段[peak,floor] 集中抛售
    if (prof.flashCrashPeriod && sellThrs.length) {
      const isSellCat = BAD_SELL_CATEGORIES.includes(prof.category);
      const { peakTime, floorTime } = prof.flashCrashPeriod;
      for (const s of e.sells) {
        if (s.bt >= peakTime && s.bt <= floorTime) {
          for (const t of sellThrs) {
            if (s.bnb >= t.bnb) {
              sell[t.key].crash++;
              if (isSellCat) sell[t.key].bad++;
            }
          }
        }
      }
    }
  }
  return { buy, sell };
}

/**
 * offline+inc 合并（独立于 mergeOfflineProfile）：按阈值 key 累加 early/crash/bad。
 * offline/inc 任一缺失 → 用另一份；都缺失 → null。
 * @param {Object|null} o offline 的 lowLevelBadAction
 * @param {Object|null} i inc 的 lowLevelBadAction
 * @returns {Object|null}
 */
function mergeLowLevelBadAction(o, i) {
  if (!o && !i) return null;
  if (!o) return i;
  if (!i) return o;
  const mergeSide = (os, is) => {
    const keys = new Set([...Object.keys(os || {}), ...Object.keys(is || {})]);
    const out = {};
    for (const k of keys) {
      const a = os?.[k] || {};
      const b = is?.[k] || {};
      out[k] = {
        early: (a.early || 0) + (b.early || 0),
        crash: (a.crash || 0) + (b.crash || 0),
        bad: (a.bad || 0) + (b.bad || 0),
      };
    }
    return out;
  };
  return { buy: mergeSide(o.buy, i.buy), sell: mergeSide(o.sell, i.sell) };
}

module.exports = {
  computeLowLevelBadAction,
  mergeLowLevelBadAction,
  DEFAULT_CONFIG,
};
