/**
 * 「前期停滞再启动」通路（T210，2026-11-22 用户裁定「这个策略从来也不是为了召回所有
 * 的好票，只是给一个好票模式一个通路」+「这个通路跟 burst 一样，豁免前面的
 * cheat/unhealthy（可能会有一些 bad case 但是再看）」）。
 *
 * 用户定义（原话）：「这是一个代币经历了前期的交易期（有一定的交易丰富度），但是
 * 没有明显上涨以及很大流量（所以依然处于生命周期前期），一部分用户持续持仓不肯
 * 卖出，如果是庄家可能要做庄，如果是散户一般是真心看好。很久未卖，这种情况下，
 * 经过较长的沉寂期（证明持仓意愿）后，又有购买进入」。
 *
 * 案源：金狗 中文房间 0x76b0dc29…7777（bt-v179 唯一拦截=AF1 act=low∧sbw=none）、
 * 铁匠 0x39ed13cc…7777 / 胖橘貓 0x2335bc48…7777（死在更前的因子门低活跃臂）。
 * 结构性根因：信号在静默后第一笔 tick 上触发，AF1 的 as-of 锚就是这笔——CD422
 * 「出口行孤笔」→ sbw=none → reject_low；首笔评估结构性不可能是 burst。
 *
 * 六条腿（全部事前、代码可算；线值=用户用「2 张认可+6 张否决」校出的初值）：
 *   ① 结构：最后一个 ≥30s 完全静默段（非尘行集，CD424 口径）的出口行是一笔非尘
 *      买入（≥SR_EXIT_MIN_BNB），出口行起 5s 波窗内非尘行恰 1 行（孤笔——多行即
 *      真波，归 sbw=burst 既有通路），且信号锚在这笔上（≤SR_EXIT_MAX_SEC）
 *   ② 较长的沉寂期：沉寂 ≥SR_STALL_MIN_SEC（「证明持仓意愿」）
 *   ③ 前期交易丰富度：沉寂之前出现过 ≥SR_EARLY_WALLETS_MIN 个独立钱包（买卖都算）
 *   ④ 持仓不卖：出口行之前仍有 ≥SR_HOLDERS_MIN 个像样持仓者（净持仓按窗内首个
 *      可靠价折算 ≥SR_HOLDER_DUST_BNB，FA holdersExDust 同线），且占前期像样买家
 *      的 ≥SR_RETENTION_MIN
 *   ⑤ 生命周期前期：锚前最高价较发行价 <SR_ATH_MAX_PCT（act-stage isColdStage 共享线）
 *   ⑥ 没有很大流量：出口行之前总成交 <SR_VOL_MAX_BNB
 *
 * 效果（挂点三处，均只在本形状命中时改变行为）：
 *   - 因子门：低活跃五臂让位、burst 弱波臂（无大户+无压箱）让位；散户 PVP
 *     （像样买方缺席）与其它臂照常——四窗实证「像样买方缺席」19 张零右尾
 *   - 活跃度前置门：act=low ∧ 命中 → restart_exempt，与 burst 同等跳过作弊门直进
 *     买入点位门（cheat/unhealthy 一并豁免，用户知情）；sbw 保持 none=T189 不 arm
 *
 * null 语义：任一腿证据缺席 → 不命中（放行方向 fail-closed，不冒充）。
 * 四窗（1103/1012/1019/1003，6.5 天）面：83 张松口径形状票 → 严口径命中 14、
 * 补丁后能通过 9（翻倍 4：英伟达SI/牢猫/铁匠/中文房间）。详档=交易台账 T210 +
 * 金狗台账 JG-37。
 */
'use strict';

const { ACT_STAGE_HOT_MIN_ATH_VS_PCT } = require('./act-stage'); // ⑤ 阶段线单点（零依赖叶子，T205 共享）

/** ② 较长的沉寂期（秒）——CD406 30s 线加倍（「沉寂较久」） */
const SR_STALL_MIN_SEC = 60;
/** ① 结构：出口行非尘买入下限（BNB，CD424 BURST_SCAN_DUST_BNB 同值） */
const SR_EXIT_MIN_BNB = 0.03;
/** ① 结构：出口行→信号锚上限（秒）——信号就是被这笔重启买单触发的 */
const SR_EXIT_MAX_SEC = 2;
/** ③ 前期交易丰富度：沉寂前独立钱包数下限 */
const SR_EARLY_WALLETS_MIN = 12;
/** ④ 像样持仓者折算线（BNB，FA holderDustBnb 默认 0.015 同线） */
const SR_HOLDER_DUST_BNB = 0.015;
/** ④ 仍持仓者数下限 */
const SR_HOLDERS_MIN = 6;
/** ④ 留存率下限（仍持仓者 ÷ 前期像样买家） */
const SR_RETENTION_MIN = 0.55;
/** ⑤ 生命周期前期：锚前最高价较发行价上限（%，act-stage 共享线单点——勿另写字面量） */
const SR_ATH_MAX_PCT = ACT_STAGE_HOT_MIN_ATH_VS_PCT;
/** ⑥ 出口行之前总成交额上限（BNB） */
const SR_VOL_MAX_BNB = 5;

/**
 * 停滞再启动形状判定（纯函数；输入=cheat 快照 derived 的 stallRestart* 键族）。
 * @param {Object} d cheat 快照 derived（缺键=证据缺席）
 * @returns {{hit:boolean, legs:Object, fail:string[]}} legs=各腿数值快照（留痕用）；
 *   fail=未成立/缺席的腿名（命中时为空数组）
 */
function evaluateStallRestart(d) {
  const legs = {
    stallSec: d && d.burstLastGapSec,
    exitSide: d && d.stallRestartExitSide,
    exitBnb: d && d.stallRestartExitBnb,
    exitToAnchorSec: d && d.stallRestartExitToAnchorSec,
    waveRows: d && d.stallRestartWaveRows,
    earlyWallets: d && d.stallRestartEarlyWallets,
    volPreBnb: d && d.stallRestartVolPreBnb,
    holders: d && d.stallRestartHolders,
    buyers: d && d.stallRestartBuyers,
    retention: d && d.stallRestartRetention,
    athVsLaunchPct: d && d.athVsLaunchPct,
  };
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const fail = [];
  // ② 较长的沉寂期（无静默段=burstLastGapSec null → 结构腿一并缺席）
  if (!num(legs.stallSec) || legs.stallSec < SR_STALL_MIN_SEC) fail.push('stall');
  // ① 结构：出口行=非尘买入 ∧ 孤笔 ∧ 锚在出口行上
  if (legs.exitSide !== 'BUY' || !num(legs.exitBnb) || legs.exitBnb < SR_EXIT_MIN_BNB) fail.push('exitBuy');
  if (!num(legs.waveRows) || legs.waveRows !== 1) fail.push('loneExit');
  if (!num(legs.exitToAnchorSec) || legs.exitToAnchorSec < 0 || legs.exitToAnchorSec > SR_EXIT_MAX_SEC) fail.push('exitNearAnchor');
  // ③ 前期交易丰富度
  if (!num(legs.earlyWallets) || legs.earlyWallets < SR_EARLY_WALLETS_MIN) fail.push('earlyWallets');
  // ④ 持仓不卖
  if (!num(legs.holders) || legs.holders < SR_HOLDERS_MIN) fail.push('holders');
  if (!num(legs.retention) || legs.retention < SR_RETENTION_MIN) fail.push('retention');
  // ⑤ 生命周期前期（athVsLaunchPct null=照拦，T205 同哲学）
  if (!num(legs.athVsLaunchPct) || legs.athVsLaunchPct >= SR_ATH_MAX_PCT) fail.push('coldStage');
  // ⑥ 没有很大流量
  if (!num(legs.volPreBnb) || legs.volPreBnb >= SR_VOL_MAX_BNB) fail.push('volume');
  return { hit: fail.length === 0, legs, fail };
}

module.exports = {
  SR_STALL_MIN_SEC, SR_EXIT_MIN_BNB, SR_EXIT_MAX_SEC, SR_EARLY_WALLETS_MIN,
  SR_HOLDER_DUST_BNB, SR_HOLDERS_MIN, SR_RETENTION_MIN, SR_ATH_MAX_PCT, SR_VOL_MAX_BNB,
  evaluateStallRestart,
};
