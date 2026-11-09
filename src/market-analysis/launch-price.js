/**
 * 发行价常量（2026-11-08 合约实证 + 用户裁定「fourmeme 使用主流档即可，flap 也是
 * 使用主力档即可」）——currentVsLaunchPct 族（BP 位置门/黄金点、CD reset 截窗、FA
 * 因子、ladder 价格门）的分母从「锚窗首可靠价」换为平台 curve 初始价常量。
 *
 * ## 实证出处（全档调研详见 memory/launch-price-curve-constants.md 与 T 台账本案）
 * - four.meme：模板制曲线（TokenManager2 0x5c95…762b `_tokenInfos(token)` 可链上直读
 *   per-token K/maxRaising）；143 档横跨 ~700 倍（初始市值 4.5→3194 BNB），但**主流档
 *   maxRaising=14.1（raw 14100000000000000000）/ K=5185963595112328765205010321 占当前
 *   活跃票绝大多数**。主流档 P₀=零成交票（funds=0）链上 lastPrice 直读原值
 *   **4496173469 wei = 4.496173469e-9 BNB/枚（初始市值 4.4962 BNB）**，与统计首可靠价
 *   锐下限 4.50 完全吻合；跨档闭式 P₀ = K×8.66989e-19 = maxRaising×3.1888e-10 五档
 *   全验（误差 <0.01%）。用户裁定不逐票 eth_call 读曲线参数——**统一用主流档常量**
 *   （高价位模板票如小四 0xca7b4ed5…ffff 真发行价 6.34e-7，按主流档常量判为深度破发
 *   =设计内取舍）。
 * - flap：tier 制常量表（Portal 0xe2cE…C9De0，ICurveModule `curveByType` external pure）；
 *   LibCurve `(1e9+h−s)×(eth+r)=k`，初始价 P₀=r/(h+1e9)。**BNB 盘主力档
 *   CURVE_RH_BNB(20)：r=6.14、h=107036752 → P₀=6.14/(107036752+1e9)=5.546e-9（初始市值
 *   5.55 BNB）**，落统计主簇 [4,6)。用户裁定统一用主力档常量。
 * - quote 盘（flap 非 BNB 计价）：T127 调研曾判「per-token snapshot 定价
 *   （signed QuoteCurveAuth，fromPrice USD 逐票可变）无常量可言」——2026-11-09
 *   182 实证推翻：wss_events token_quote_set 近 400 票中 11 张有成交票首 tick
 *   （price_bnb=换算后 BNB 域）全部 5.10~5.68e-9、p50=5.55e-9=FL 常量 1.00x
 *   （池初始价即常量，生态同 four.meme「43 档但主流档占绝大多数」）；赵公主
 *   0x5793b7ea…7777 案（bt-v89 亏损 Top1 -0.0867）11:17:12 买点首 tick 口径
 *   +38.5% 实为常量口径 +107.3%>40 被放走——用户裁定「落码吧，quote 盘也直接
 *   用常量」。quoteToken 参数保留（调用方签名不变）但不再影响返回值。
 * - gang：已停（T86），未调研 → 返回 null=旧口径。
 *
 * ## 接口语义
 * resolveLaunchPriceBnb(platform, quoteToken) → number|null：
 * - 'fourmeme' → 主流档常量（quote 盘概念不存在于 four.meme）
 * - 'flap' → 主力档常量（2026-11-09 起 quote 盘同常量，quoteToken 不再分流）
 * - 其余（gang/未知/null）→ null=调用方走旧口径（首可靠价）
 *
 * 零依赖叶子模块（不 require 本项目任何文件）——BP/CD/FA/引擎任意层可安全引入。
 */
'use strict';

// four.meme 主流档（模板 maxRaising=14.1）P₀：零成交票链上 lastPrice raw 原值 4496173469 wei
const FOURMEME_LAUNCH_PRICE_BNB = 4496173469e-18; // = 4.496173469e-9 BNB/枚

// flap BNB 盘主力档 CURVE_RH_BNB(20)：r=6.14, h=107036752 → P₀ = r/(h+1e9)
const FLAP_LAUNCH_PRICE_BNB = 6.14 / (107036752 + 1e9); // ≈ 5.546e-9 BNB/枚

/**
 * 平台 curve 发行价（常量锚）解析。
 * @param {string|null} platform 平台标识（'fourmeme'|'flap'|'gang'|null）
 * @param {string|null} quoteToken flap 非 BNB 计价盘 quote 地址——2026-11-09 起
 *   不再影响返回值（quote 盘同常量，保留参数为调用方签名兼容；透传链另有
 *   毕业阈值学习/PCS 二跳路由消费者）
 * @returns {number|null} 发行价 BNB 常量；null=无常量锚（gang/未知，调用方保留旧口径首可靠价）
 */
function resolveLaunchPriceBnb(platform, quoteToken) {
  if (platform === 'fourmeme') return FOURMEME_LAUNCH_PRICE_BNB;
  if (platform === 'flap') return FLAP_LAUNCH_PRICE_BNB;
  return null; // gang/未知平台：旧口径
}

/**
 * T130 地板补丁（2026-11-09 用户裁定，67ad68e0/6efa11ce 案）：「很多币的第一次购买
 * 价格低于普遍代币的发布价格……如果代币首次购买价格低于我们配置的代币初始价格，
 * 那么地板改为首次购买价」——launch 锚取 min(平台常量, 首笔买入价)。
 *
 * 形状：flap quote 盘/低开票首笔成交价可显著低于常量（67ad68e0 -4.9%、6efa11ce
 * -20.2%），以常量为地板会把这类票的 currentVsLaunchPct 整体抬高（首 tick 即 +20%
 * =low 档），near_launch/almost_launch 位置判定系统性失真。
 *
 * @param {number|null} launchConstBnb resolveLaunchPriceBnb 结果（null=无常量锚，
 *   返回 null=调用方保留旧口径首可靠价，不应用地板）
 * @param {number} firstBuyPriceBnb 代币首笔买入可靠价（write-once 冻结值；0/null=
 *   未见首买，返回常量原值）
 * @returns {number|null} 地板修正后 launch 锚；null=无常量锚（透传，调用方走旧口径）
 */
function floorLaunchPriceBnb(launchConstBnb, firstBuyPriceBnb) {
  if (launchConstBnb === null || !(launchConstBnb > 0)) return null;
  if (firstBuyPriceBnb != null && firstBuyPriceBnb > 0 && firstBuyPriceBnb < launchConstBnb) {
    return firstBuyPriceBnb;
  }
  return launchConstBnb;
}

module.exports = {
  FOURMEME_LAUNCH_PRICE_BNB,
  FLAP_LAUNCH_PRICE_BNB,
  resolveLaunchPriceBnb,
  floorLaunchPriceBnb,
};
