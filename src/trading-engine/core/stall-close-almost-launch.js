'use strict';

/**
 * T170 almost_launch 域断流延长（2026-11-17，bt-v140 Cashless 0xfd571fd6…7777 案）
 *
 * 用户裁定原话：「如果价格都跌到 almost launch 这个范围，断流时间就延长到 1 分钟吧，
 * 没啥等待成本，但是有可能可以救回来大票」。
 *
 * 案形：40s 断流止损卖在 11:30:54（检测时点 curVs≈0% 已贴地板），5s 后 11:30:59 即来
 * 4×0.11B 足额买盘重开流量（水位本会重置），66s 后 11:32:00 价格到卖出价 ~2.4 倍
 * （+140%）——断流边界恰好砍在大票恢复前夜。价格已在 almost_launch（≤+10 含破发，
 * BP50 域）时再跌空间极小=延长几乎无等待成本，换「断流尾声恰有第二波」的恢复期权。
 *
 * 语义（两引擎共用，实时墙钟/回测虚拟时钟同判）：
 *   - 断流阈值仅在「检测时点 currentVsLaunchPct ≤ +10（含破发）」时放宽到
 *     almostLaunchStallMs（缺省 60s；恒 max(stallMs, ·)——只延长不缩短）
 *   - curVs null（未见可靠价/未知平台）不延长=原阈值照卖（fail-closed：缺证据
 *     不给恢复期权，与 FA null 语义族同向）
 *   - stallClose 段未配/显式 almostLaunchStallMs<=0 → 延长臂关（存量实验零变化）
 *
 * 零 DB 零网络纯函数；单测 scripts/_test_stall_close.cjs E 段。
 */

/** almost_launch 域上界（%）：与 BP43/BP50 price_level 六桶分界同线，含破发（负值） */
const STALL_CLOSE_ALMOST_LAUNCH_PCT = 10;

/** 延长窗缺省值：用户裁定「延长到 1 分钟」 */
const DEFAULT_ALMOST_LAUNCH_STALL_MS = 60000;

/**
 * 配置归一化（两引擎 ctor 同一段 stallClose 配置调用）。
 * @param {object|null} stallCloseCfg 实验配置 stallClose 段（stallMs/minTickBnb 既有键外新增 almostLaunchStallMs）
 * @param {number|null} stallCloseMs 已归一化的基础断流阈值（null=机制整体未启用）
 * @returns {number|null} almost_launch 域生效断流阈值（恒 ≥ stallCloseMs）；null=延长臂关
 */
function resolveAlmostLaunchStallMs(stallCloseCfg, stallCloseMs) {
  if (stallCloseMs == null) return null; // 机制整体未启用（stallClose 段缺失/非法）
  const raw = Number((stallCloseCfg || {}).almostLaunchStallMs);
  const val = Number.isFinite(raw) ? raw : DEFAULT_ALMOST_LAUNCH_STALL_MS; // 缺省 60s（裁定值）
  if (!(val > 0)) return null; // 显式 0/负 = 关延长臂
  return Math.max(stallCloseMs, val); // 只延长不缩短
}

/**
 * almost_launch 域判定（null=缺证据不在域，与延长判定同向 fail-closed）。
 * 回测侧延长耗尽重锚检测点时仅对域内票生效（域外票保持 T104 基础检测点 parity）。
 */
function isAlmostLaunchDomain(currentVsLaunchPct) {
  return currentVsLaunchPct != null && currentVsLaunchPct <= STALL_CLOSE_ALMOST_LAUNCH_PCT;
}

/**
 * 断流延长判定（仅在各引擎已越过基础阈值 stalledMs > stallCloseMs 后调用）。
 * @returns {boolean} true=延长窗内继续持仓（本轮跳过卖出）；false=照卖（域外/缺证据/窗已耗尽/臂关）
 */
function shouldExtendStallWindow({ almostLaunchStallMs, stalledMs, currentVsLaunchPct }) {
  if (almostLaunchStallMs == null) return false; // 延长臂关
  if (stalledMs > almostLaunchStallMs) return false; // 延长窗已耗尽 → 照卖（> 语义与基础阈值同）
  return isAlmostLaunchDomain(currentVsLaunchPct); // almost_launch 域（含破发）
}

module.exports = {
  STALL_CLOSE_ALMOST_LAUNCH_PCT,
  DEFAULT_ALMOST_LAUNCH_STALL_MS,
  resolveAlmostLaunchStallMs,
  shouldExtendStallWindow,
  isAlmostLaunchDomain,
};
