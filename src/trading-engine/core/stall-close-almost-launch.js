'use strict';

/**
 * T170 almost_launch 域断流延长 + T170b 两档化（2026-11-17 落地 / 2026-11-18 扩档）
 *
 * T170（bt-v140 Cashless 0xfd571fd6…7777 案）用户裁定原话：「如果价格都跌到
 * almost launch 这个范围，断流时间就延长到 1 分钟吧，没啥等待成本，但是有可能
 * 可以救回来大票」——40s 断流止损卖在 11:30:54（检测时点 curVs≈0% 已贴地板），
 * 5s 后即来 4×0.11B 足额买盘重开流量，66s 后价格到卖出价 ~2.4 倍（+140%）。
 *
 * T170b（2026-11-18 用户裁定两档化）：
 * ①almost_launch 档延长 60s → **90s（1 分半）**（现行）；
 * ②**破发档（d345c 对拍否证已撤回，缺省关）**：现价相对 min(平台常量, 首笔买入价)
 *   锚（T130 地板，刻意不吃 T134 滚动最低）≤ −5% → 延长到 180s——d345c（36h
 *   win1012 对拍，`2fe55b27`）破发档 12/12 全负 Σ−0.15 零翻案：破发域断流的票
 *   恰是还在阴跌的票，多等 3 分钟没有恢复期权只有延迟离场代价（用户裁定
 *   「破发档撤销吧」2026-11-19）；**缺省关**（显式 `breakdownStallMs > 0` 可恢复，
 *   T120 buySignalCooldownTicks 缺省退役同款留档形态）。同窗对照：50s 基础档
 *   14 票 +0.096（9正/5负）+2 张等到流量不再断流 +0.093=正贡献保留。
 *   ⚠口径立法（用户点名，历史档）：破发判定**不能用 currentVsLaunchPct**——
 *   该键分母=min(常量, 首买价, 滚动最低)（T139 完整地板），历史破发过的票滚动
 *   最低会垫低地板使 curVs 显示高涨幅。破发档锚=FA 键 `currentVsFloorPct`
 *   （现价 vs min(常量, 首买价)，无滚动最低）——键保留纯观察+显式开启时判档。
 *
 * 语义（两引擎共用，实时墙钟/回测虚拟时钟同判）：
 *   - 档位判定（断流期 state 冻结，检测时点与延长点因子无差）：
 *       floorPct ≤ −5（且破发臂显式开）→ 破发档（显式阈值，恒 max(stallMs, ·)）
 *       else curVs ≤ +10（含破发，且 almost 臂开）→ almost 档（90s）
 *       else → 不延长（原阈值照卖）
 *   - 因子 null（未见可靠价/未知平台无锚）→ 对应臂不触发（fail-closed：缺证据
 *     不给恢复期权，与 FA null 语义族同向）。
 *   - stallClose 段未配 → almost 档缺省 90s / 破发档缺省关；显式
 *     almostLaunchStallMs / breakdownStallMs ≤0 → 对应臂关。
 *
 * 零 DB 零网络纯函数；单测 scripts/_test_stall_close.cjs E 段。
 */

/** almost_launch 域上界（%）：与 BP43/BP50 price_level 六桶分界同线，含破发（负值） */
const STALL_CLOSE_ALMOST_LAUNCH_PCT = 10;

/** 破发档阈值（%）：现价 vs T130 地板（min(常量, 首买价)，无滚动最低）≤ −5 */
const STALL_CLOSE_BREAKDOWN_PCT = -5;

/** almost_launch 档缺省（T170b 2026-11-18 用户裁定「延长到 1 分半」） */
const DEFAULT_ALMOST_LAUNCH_STALL_MS = 90000;

/**
 * 配置归一化（两引擎 ctor 同一段 stallClose 配置调用）。
 * @param {object|null} stallCloseCfg 实验配置 stallClose 段（stallMs/minTickBnb
 *   既有键外：almostLaunchStallMs / breakdownStallMs 两档可分别覆盖）
 * @param {number|null} stallCloseMs 已归一化的基础断流阈值（null=机制整体未启用）
 * @returns {{almostLaunchMs: number|null, breakdownMs: number|null}} 各档生效阈值
 *   （恒 ≥ stallCloseMs 只延长不缩短；null=对应臂关）；机制整体关 → 两臂全 null。
 *   破发臂**缺省关**（d345c 否证撤回）——显式 breakdownStallMs > 0 才启用。
 */
function resolveStallCloseExtension(stallCloseCfg, stallCloseMs) {
  if (stallCloseMs == null) return { almostLaunchMs: null, breakdownMs: null };
  const cfg = stallCloseCfg || {};
  const rawA = Number(cfg.almostLaunchStallMs);
  const a = Number.isFinite(rawA) ? rawA : DEFAULT_ALMOST_LAUNCH_STALL_MS;
  const rawB = Number(cfg.breakdownStallMs);
  const b = Number.isFinite(rawB) ? rawB : 0; // T170c（2026-11-19）：缺省关（d345c 12/12 全负撤回）
  return {
    almostLaunchMs: a > 0 ? Math.max(stallCloseMs, a) : null,
    breakdownMs: b > 0 ? Math.max(stallCloseMs, b) : null,
  };
}

/**
 * 档位判定唯一出口：给定检测时点因子，返回生效延长阈值与档位。
 * 断流期 state 冻结——检测时点与延长耗尽点两处调用结果恒一致（无档位漂移）。
 * @param {{almostLaunchMs: number|null, breakdownMs: number|null}} ext
 *   resolveStallCloseExtension 产物（引擎 ctor 归一化一次）
 * @param {number|null} currentVsLaunchPct 现价 vs T139 完整地板（含滚动最低）
 * @param {number|null} currentVsFloorPct 现价 vs T130 地板（min(常量, 首买价)，
 *   无滚动最低——破发档专用锚，防历史破发回弹票被滚动最低垫高地板漏判）
 * @returns {{ms: number, tier: 'breakdown'|'almost'}|null} null=不延长（域外/
 *   双臂关/对应因子 null fail-closed）
 */
function effectiveStallExtension(ext, { currentVsLaunchPct, currentVsFloorPct }) {
  if (!ext) return null;
  // 破发档优先（更深域更长窗；floorPct ≤ −5 时即使 curVs 因滚动最低垫底显示
  // 高涨幅也在破发域内——T170b 立法核心：破发判定与「经历过最低价」解耦）
  if (ext.breakdownMs != null
    && currentVsFloorPct != null && currentVsFloorPct <= STALL_CLOSE_BREAKDOWN_PCT) {
    return { ms: ext.breakdownMs, tier: 'breakdown' };
  }
  if (ext.almostLaunchMs != null
    && currentVsLaunchPct != null && currentVsLaunchPct <= STALL_CLOSE_ALMOST_LAUNCH_PCT) {
    return { ms: ext.almostLaunchMs, tier: 'almost' };
  }
  return null;
}

/**
 * T219 大户在场豁免（2026-11-23 用户裁定「断流卖出策略，加个限制，有大户在场，
 * 不断流卖出（否则与我们的理念违背）」+「≥3 个普通大户，但是一个特大户也行」
 * +「全局生效」）：stallClose 判定时刻 factors 在场证据——
 *   bigBuyersHeldDust ≥ minDustHolders（缺省 3，与黄金坑入场线同值）
 *   ∨ top1HolderCircPct ≥ top1CircPct（缺省 30%——特大户单钱包占流通 30%+，
 *     T198 arb_bot 持筹线同量级）。
 * 语义：断流期 FA state 冻结（无新 tick），因子=最后一笔交易时刻快照——「大户
 * 还没走」as-of 正确（没有新交易=没有新卖出）。证据缺失 fail-closed 不豁免
 * （stall 是保护机制，豁免证据缺席宁卖）。
 * 全局生效=两引擎 stall 判定点无配置开关直接判（显式 bigHolderExempt:false 关）。
 * @param {object|null} cfg stallClose 段
 */
function normalizeStallBigHolderExempt(cfg) {
    const b = cfg && cfg.bigHolderExempt;
    if (b === false) return null; // 显式关
    const c = b && typeof b === 'object' ? b : {};
    const d = Number(c.minDustHolders);
    const t = Number(c.top1CircPct);
    return {
        minDustHolders: Number.isFinite(d) && d > 0 ? d : 3,
        top1CircPct: Number.isFinite(t) && t > 0 ? t : 30,
    };
}

/**
 * @param {object|null} factors FA 因子表（stall 判定时刻 buildFactorMap 产物）
 * @param {object|null} norm normalizeStallBigHolderExempt 产物
 * @returns {boolean} true=大户在场 → 跳过本次 stall（继续持有）
 */
function stallBigHolderExempt(factors, norm) {
    if (!norm || !factors) return false;
    const held = factors.bigBuyersHeldDust;
    const top1 = factors.top1HolderCircPct;
    if (typeof held === 'number' && Number.isFinite(held) && held >= norm.minDustHolders) return true;
    if (typeof top1 === 'number' && Number.isFinite(top1) && top1 >= norm.top1CircPct) return true;
    return false;
}

module.exports = {
  STALL_CLOSE_ALMOST_LAUNCH_PCT,
  STALL_CLOSE_BREAKDOWN_PCT,
  DEFAULT_ALMOST_LAUNCH_STALL_MS,
  resolveStallCloseExtension,
  effectiveStallExtension,
  normalizeStallBigHolderExempt,
  stallBigHolderExempt,
};
