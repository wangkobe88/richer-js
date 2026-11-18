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
 * ①almost_launch 档延长 60s → **90s（1 分半）**；
 * ②新增**破发档**：现价相对 min(平台常量, 首笔买入价) 锚（T130 地板，**刻意不吃
 *   T134 滚动最低**）≤ **−5%** → 延长到 **180s（3 分钟）**。
 *   ⚠口径立法（用户点名）：破发判定**不能用 currentVsLaunchPct**——该键分母=
 *   min(常量, 首买价, 滚动最低)（T139 完整地板），历史破发过的票滚动最低会垫低
 *   地板，curVs 变成「相对历史最低价的涨幅」：票曾深砸 −50% 后回弹到发行价下
 *   方 −7%，curVs 显示 +86%（almost_launch 域外！）而真实位置是破发。破发档
 *   锚=FA 新键 `currentVsFloorPct`（现价 vs min(常量, 首买价)，无滚动最低）。
 *
 * 语义（两引擎共用，实时墙钟/回测虚拟时钟同判）：
 *   - 档位判定（断流期 state 冻结，检测时点与延长点因子无差）：
 *       floorPct ≤ −5（且破发臂开）→ 破发档（180s，恒 max(stallMs, ·)）
 *       else curVs ≤ +10（含破发，且 almost 臂开）→ almost 档（90s）
 *       else → 不延长（原阈值照卖）
 *     两域取更深档（破发域 ⊂ 价格更低区域，180 > 90 只延长不缩短）。
 *   - 因子 null（未见可靠价/未知平台无锚）→ 对应臂不触发（fail-closed：缺证据
 *     不给恢复期权，与 FA null 语义族同向）。
 *   - stallClose 段未配 → 各档缺省 90s/180s；显式 almostLaunchStallMs/
 *     breakdownStallMs ≤0 → 对应臂关（存量实验可分别关闭）。
 *
 * 零 DB 零网络纯函数；单测 scripts/_test_stall_close.cjs E 段。
 */

/** almost_launch 域上界（%）：与 BP43/BP50 price_level 六桶分界同线，含破发（负值） */
const STALL_CLOSE_ALMOST_LAUNCH_PCT = 10;

/** 破发档阈值（%）：现价 vs T130 地板（min(常量, 首买价)，无滚动最低）≤ −5 */
const STALL_CLOSE_BREAKDOWN_PCT = -5;

/** almost_launch 档缺省（T170b 2026-11-18 用户裁定「延长到 1 分半」） */
const DEFAULT_ALMOST_LAUNCH_STALL_MS = 90000;

/** 破发档缺省（T170b 2026-11-18 用户裁定「延长到 3 分钟」） */
const DEFAULT_BREAKDOWN_STALL_MS = 180000;

/**
 * 配置归一化（两引擎 ctor 同一段 stallClose 配置调用）。
 * @param {object|null} stallCloseCfg 实验配置 stallClose 段（stallMs/minTickBnb
 *   既有键外：almostLaunchStallMs / breakdownStallMs 两档可分别覆盖）
 * @param {number|null} stallCloseMs 已归一化的基础断流阈值（null=机制整体未启用）
 * @returns {{almostLaunchMs: number|null, breakdownMs: number|null}} 各档生效阈值
 *   （恒 ≥ stallCloseMs 只延长不缩短；null=对应臂关）；机制整体关 → 两臂全 null
 */
function resolveStallCloseExtension(stallCloseCfg, stallCloseMs) {
  if (stallCloseMs == null) return { almostLaunchMs: null, breakdownMs: null };
  const cfg = stallCloseCfg || {};
  const rawA = Number(cfg.almostLaunchStallMs);
  const a = Number.isFinite(rawA) ? rawA : DEFAULT_ALMOST_LAUNCH_STALL_MS;
  const rawB = Number(cfg.breakdownStallMs);
  const b = Number.isFinite(rawB) ? rawB : DEFAULT_BREAKDOWN_STALL_MS;
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

module.exports = {
  STALL_CLOSE_ALMOST_LAUNCH_PCT,
  STALL_CLOSE_BREAKDOWN_PCT,
  DEFAULT_ALMOST_LAUNCH_STALL_MS,
  DEFAULT_BREAKDOWN_STALL_MS,
  resolveStallCloseExtension,
  effectiveStallExtension,
};
