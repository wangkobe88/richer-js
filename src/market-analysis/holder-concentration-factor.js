/**
 * holder_concentration 观察因子（FP47 第四题，2026-11-24 用户裁定「A 档四题全搞」）
 * ——零依赖纯函数，零 DB 零网络。
 *
 * 定位：BP69 holder_concentration 题分层判法的机械翻译。BP 侧 chip gate 停用中
 * （CHIP_GATE_ENABLED=false，BP54）——本因子=FA 观察键（bpHolderConcentration，
 * 条件串可直接引用；恢复筹码门时直接消费），Jev 题照判落档不动。
 *
 * 题面分层线（逐字直译）：
 * - 持有者 ≥10：top1>45% ∨ 前二>55% ∨ 前三>70% 任一过线=垄断坐实 → strong
 *   （免协同迹象）；未过线 → none/weak 按 top 占比高低分档 ⓟ
 * - 持有者 6~9：过线 ∧ 簇持仓佐证（同块簇/等额带簇持仓占比高 ⓟ）→ strong；
 *   过线无佐证 → moderate
 * - 持有者 ≤5：筹码少豁免域 → 一般至多 moderate；top1>90% ∧ 买过 ≥10 钱包只有
 *   1~2 人拿货（参与/持有分叉极端）=一人控盘 → strong
 * - 价格豁免（题面⑥）：currentVsLaunchPct ≤ +10%（含破发，almost_launch 区）时
 *   持有不均衡不坐实 strong（降观察至多 moderate）——头部持仓无浮盈可砸，大户
 *   在场本身不是此刻的风险；vsLaunch null=缺席不豁免
 * - 反锚①极早窗由 ≤5 豁免域天然覆盖（题面明言）；⑤只述事实不作弊结论（观察键语义）
 *
 * 档位数值化（CHEAT_LEVEL_SCORES.level 同序）：none=0/weak=1/moderate=2/strong=3；
 * null=原料全缺失不可评（fail-closed——条件串裸比较恒 false，放行须显式
 * `IS NULL OR` 臂，cheatGrade 先例）。
 * ⓟ=候选定线（题面无硬线，对拍校准后用户裁定）。
 *
 * 单测：scripts/_test_holder_concentration_factor.cjs
 */

/** 垄断坐实三线（题面直供：>45/>55/>70） */
const HOLDER_STRONG_TOP1_PCT = 45;
const HOLDER_STRONG_TOP2_PCT = 55;
const HOLDER_STRONG_TOP3_PCT = 70;
/** 持有者分层线（题面直供：≥10 免佐证域 / 6~9 需佐证 / ≤5 豁免域） */
const HOLDER_LAYER_MIN_WALLETS = 10;
const HOLDER_LAYER_MIN_MID_WALLETS = 6;
/** 一人控盘（题面直供：top1>90% ∧ 分叉极端） */
const HOLDER_SOLO_TOP1_PCT = 90;
const HOLDER_SOLO_MIN_BUYERS = 10;
const HOLDER_SOLO_MAX_HOLDERS = 2;
/** 簇持仓佐证线 ⓟ（题面「同块簇持仓占比/等额带簇持仓占比高」无硬线） */
const HOLDER_CLUSTER_MIN_CIRC_PCT = 50;
/** none/weak 分界 ⓟ（题面「top1 低个位数~十余% vs 二成上下/前二三四成」） */
const HOLDER_WEAK_TOP1_PCT = 15;
const HOLDER_WEAK_TOP2_PCT = 35;
/** 价格豁免线（题面⑥直供：≤+10% 含破发=almost_launch 区） */
const HOLDER_PRICE_EXEMPT_MAX_VS_LAUNCH_PCT = 10;

const LEVEL_BUCKETS = ['none', 'weak', 'moderate', 'strong'];

/**
 * holder_concentration 档位机械翻译。
 * @param {Object} a - 锚键 {posHolderCount, top1HoldCircPct, top1Top2HoldCircPct,
 *   top3HoldCircPct, sameBlockHoldCircPct, equalBandHoldCircPct, buyerWalletCount}
 *   （cheat 投影锚同口径；null=该键证据缺失）
 * @param {number|null} vsLaunchPct - currentVsLaunchPct（现价较发行价 %；null=缺席）
 * @returns {{level:number|null, bucket:string|null, branch:string, trace:Object}}
 */
function judgeHolderConcentration(a, vsLaunchPct) {
  const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const an = a || {};
  const holders = fin(an.posHolderCount);
  const top1 = fin(an.top1HoldCircPct);
  const top2 = fin(an.top1Top2HoldCircPct);
  const top3 = fin(an.top3HoldCircPct);
  const sbCirc = fin(an.sameBlockHoldCircPct);
  const eqCirc = fin(an.equalBandHoldCircPct);
  const buyers = fin(an.buyerWalletCount);
  const trace = {
    posHolderCount: holders, top1HoldCircPct: top1, top1Top2HoldCircPct: top2,
    top3HoldCircPct: top3, sameBlockHoldCircPct: sbCirc, equalBandHoldCircPct: eqCirc,
    buyerWalletCount: buyers, currentVsLaunchPct: fin(vsLaunchPct),
  };
  // 原料全缺失（token 数量证据缺失/未投影）→ null 不可评 fail-closed
  if (holders === null || (top1 === null && top2 === null && top3 === null)) {
    return { level: null, bucket: null, branch: 'unrated', trace };
  }
  // 垄断线（任一轴过线；键 null=该轴不立）
  const overLine = (top1 !== null && top1 > HOLDER_STRONG_TOP1_PCT)
    || (top2 !== null && top2 > HOLDER_STRONG_TOP2_PCT)
    || (top3 !== null && top3 > HOLDER_STRONG_TOP3_PCT);
  // 簇持仓佐证（6~9 过线 strong 资格；键 null=无佐证）
  const clusterBacking = (sbCirc !== null && sbCirc >= HOLDER_CLUSTER_MIN_CIRC_PCT)
    || (eqCirc !== null && eqCirc >= HOLDER_CLUSTER_MIN_CIRC_PCT);
  // 参与/持有分叉极端（一人控盘：买过的人不少、拿货的只有 1~2 个）
  const soloControl = holders <= HOLDER_SOLO_MAX_HOLDERS
    && top1 !== null && top1 > HOLDER_SOLO_TOP1_PCT
    && buyers !== null && buyers >= HOLDER_SOLO_MIN_BUYERS;
  let level, branch;
  if (holders >= HOLDER_LAYER_MIN_WALLETS) {
    if (overLine) { level = 3; branch = 'monopoly_sat'; } // ≥10 过线免佐证坐实
    else if ((top1 !== null && top1 >= HOLDER_WEAK_TOP1_PCT) || (top2 !== null && top2 >= HOLDER_WEAK_TOP2_PCT)) { level = 1; branch = 'weak_top'; }
    else { level = 0; branch = 'scattered'; }
  } else if (holders >= HOLDER_LAYER_MIN_MID_WALLETS) {
    if (overLine && clusterBacking) { level = 3; branch = 'monopoly_cluster'; }
    else if (overLine) { level = 2; branch = 'monopoly_unsupported'; }
    else if ((top1 !== null && top1 >= HOLDER_WEAK_TOP1_PCT) || (top2 !== null && top2 >= HOLDER_WEAK_TOP2_PCT)) { level = 1; branch = 'weak_top'; }
    else { level = 0; branch = 'scattered'; }
  } else { // ≤5 筹码少豁免域
    if (soloControl) { level = 3; branch = 'solo_control'; }
    else if (overLine) { level = 2; branch = 'small_pool_over'; }
    else if ((top1 !== null && top1 >= HOLDER_WEAK_TOP1_PCT) || (top2 !== null && top2 >= HOLDER_WEAK_TOP2_PCT)) { level = 1; branch = 'weak_top'; }
    else { level = 0; branch = 'scattered'; }
  }
  // 价格豁免（题面⑥）：贴发行价持有不均衡不坐实 strong——头部无浮盈可砸，降观察档
  const vsLaunch = fin(vsLaunchPct);
  if (level === 3 && vsLaunch !== null && vsLaunch <= HOLDER_PRICE_EXEMPT_MAX_VS_LAUNCH_PCT) {
    level = 2;
    branch = 'price_exempt';
  }
  return { level, bucket: LEVEL_BUCKETS[level], branch, trace };
}

module.exports = {
  judgeHolderConcentration,
  HOLDER_STRONG_TOP1_PCT, HOLDER_STRONG_TOP2_PCT, HOLDER_STRONG_TOP3_PCT,
  HOLDER_LAYER_MIN_WALLETS, HOLDER_LAYER_MIN_MID_WALLETS,
  HOLDER_SOLO_TOP1_PCT, HOLDER_SOLO_MIN_BUYERS, HOLDER_SOLO_MAX_HOLDERS,
  HOLDER_CLUSTER_MIN_CIRC_PCT, HOLDER_WEAK_TOP1_PCT, HOLDER_WEAK_TOP2_PCT,
  HOLDER_PRICE_EXEMPT_MAX_VS_LAUNCH_PCT, LEVEL_BUCKETS,
};
