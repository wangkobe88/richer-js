/**
 * 前置活跃度门因子判定（AF3，2026-11-26 用户指令「活跃度判定这块尽量对齐 Jev，
 * 并且同样需要拦截 low/ultra，总体上买入量级需要跟之前保持基本一致」+「可以单独
 * 为活跃度这块，单独设计一些因子，对齐 Jev 的理念」）
 *
 * 定位：Jev AF1 活跃度题（activity_level）判序的全量因子化——输入 cheat-snapshot
 * 已算好的活跃度数值锚（「数值行已算好直接采信」的题面口径），产出 act 四档
 * （low/mid/high/ultra）+ 命中臂留痕。判序与题面逐臂对应（判据单一真相源=
 * llm/cheat-questions.mjs activity_level 题面；本文件是它的代码实现，改题面须同步）：
 *
 *   ⑥ burst 反锚（由调用方判定 sbw 传入）：静默后买入涌入不判低（中档起判）
 *   ⑦ 临近买点段四臂（出货→衰减→密集→死寂，逐臂判定首中即停）：
 *      出货臂 → ultra：末 10s ≥10 独立卖方钱包几乎纯卖（买入趋零/纯尘）——协同撤离
 *      衰减臂 → 至多中：末 10s 吞吐较此前 20s 断崖（跌去大半）∧ 尾 5s 趋零/无买
 *      密集臂 → 至少高：近段吞吐可观（≥2 BNB/分）∧ 未断崖 ∧ 尾 5s 仍有真实买入
 *        〔成色反锚：近段卖额 ≥ 买额 3 倍=出货拉起的假吞吐〕
 *        〔段前背景反锚：尾 10s 脉冲前静默 ≥15s ∧ 段前 120s 独立钱包 ≤2=孤立脉冲〕
 *      死寂臂 → 低：近段买盘中位尘埃级 ∨ 近段金额吞吐死寂（<1 BNB/分）
 *   全窗背景校验（只压不抬）：①无交易期 ≥50% ③买盘中位尘埃∧吞吐死寂 ④单向死水
 *     （笔比 ≥5:1∧额比 ≥3:1∧回撤 <5%∧非极早窗） 全窗量级四腿联立稀疏
 *   D3.73 时间结构：非 burst 时加权活跃 ≪ 近段吞吐（单点脉冲）→ 至多中
 *
 * 版本常量 ACT_JUDGE_VERSION='AF3' 落 signal metadata actFrontGate.version（模块键
 * actFrontGate:v2 不变=键内演进，旧 AF2「不判档」随代码升级消失；Jev 代 v1 键保留）。
 *
 * 线值=题面参考线直译+类整数线纪律（1.0/0.5/0.3/0.05→0.99/0.49/0.29/0.049 同族）；
 * 标定=182 act-calib 的 1361 个 Jev AF1 带标签信号（见 scripts/tmp-act-judge-calib.cjs）。
 * 零 DB 零网络纯函数（单测 `scripts/_test_act_judge.cjs`：题面真实样本转写断言）。
 */

'use strict';

const ACT_JUDGE_VERSION = 'AF3';

/** ⑦密集臂吞吐线（题面参考 ≥2~3 BNB/分钟；首轮标定 2.0 对 Jev high 欠认
 *   （idle_major 误伤 144 的主因=没认「临近仍活」），取 1.5——死寂线 1.0 与
 *   参考线 2 之间的灰色带归「仍活」方向） */
const NEAR_ALIVE_BPM_MIN = 1.5;
/** 金额吞吐死寂线（题面参考 <1 BNB/分钟——死寂臂/③/四腿联立共用） */
const THROUGHPUT_DEAD_BPM = 1.0;
/** 全窗 high 档吞吐相称线（题面参考 ≥10 BNB/分钟） */
const THROUGHPUT_HIGH_BPM = 10;
/** 全窗 high 档密度线（D3.2 ACTIVITY_HIGH_TPM 同线） */
const TPM_HIGH = 70;
/** 全窗 ultra 档密度线（D3.2 ACTIVITY_ULTRA_TPM 同线——对倒级机器节奏） */
const TPM_ULTRA = 140;
/** 全窗量级四腿联立密度线（题面「密度个位数」，取 <10） */
const TPM_SPARSE = 10;
/** 节奏稀疏参考线（题面「<15 笔/分钟偏稀」；D3.2 ACTIVITY_LOW_TPM 同线） */
const ACTIVITY_LOW_TPM_REF = 15;
/** 买盘中位尘埃线（题面「尾笔 0.11 外全是 <0.002 尘单滴答」样本尘埃级；首轮标定
 *   0.01 线对 Jev high/mid 误伤 104（near_dead），0.005=尘埃滴答与真实小买的界）
 *   ——「中位 0.05 上下只是稀疏」是 mid 方向，尘埃是「尘单堆笔数」） */
const BUY_MEDIAN_DUST_BNB = 0.005;
/** 买盘中位常见交易档（四腿联立「低于常见交易档」线，题面参考 <0.05） */
const BUY_MEDIAN_COMMON_BNB = 0.05;
/** ④单向死水回撤浅线（题面参考 <5%） */
const DRAWDOWN_FLAT_PCT = 5;
/** ④单向死水买卖笔比（题面 ≥5:1） */
const IMBALANCE_N_RATIO = 5;
/** ④单向死水买卖额比（题面 ≥3:1） */
const IMBALANCE_BNB_RATIO = 3;
/** ④开盘极早窗反锚：窗口时长 <60s 且总笔数 <30 两腿同时成立才豁免 */
const EARLY_WIN_SEC = 60;
const EARLY_WIN_N = 30;
/** ①大比例无交易期（题面参考 ≥50%） */
const IDLE_PCT_MAJOR = 50;
/** 全窗量级四腿联立：静默占比 ≥1/4 */
const IDLE_PCT_QUARTER = 25;
/** 全窗量级四腿联立：最长空窗 ≥40s */
const MAX_GAP_LONG_SEC = 40;
/** ⑦衰减臂断崖比（「跌去大半」；案值 3.9 vs 33.7≈跌九成，取 <1/2） */
const TAIL_DROP_RATIO = 2;
/** ⑦密集臂成色反锚：近段卖额 ≥ 买额 ×此值=出货拉起的假吞吐（题面参考 ≥3 倍） */
const SELL_DOMINANCE_RATIO = 3;
/** ⑦密集臂段前背景反锚：尾 10s 脉冲前纯静默（题面参考 ≥15s） */
const PRE10_GAP_SEC = 15;
/** ⑦密集臂段前背景反锚：段前 120s 独立钱包 ≤此值（题面参考 ≤2） */
const PRE10_WALLETS_MAX = 2;
/** D3.73 单点脉冲比：加权活跃 < 近段吞吐 ×此值=不给高档（案值 1.02/1.86≈0.55） */
const TIME_STRUCT_RATIO = 0.6;
/** ⑦出货臂协同卖方钱包数（题面参考 ≥10 个独立钱包） */
const SELL_WALLETS_COOP = 10;
/** 尘埃买入线（minTickBnb 同族 0.001——「只剩尘埃单」的尘埃口径） */
const TAIL_BUY_DUST_BNB = 0.001;
/** 成色反锚的最小卖额证据线（卖额 <此值=无出货证据，反锚不成立） */
const SELL_EVIDENCE_BNB = 0.001;
/** sbw「一定流量」波买额线（Jev stall_burst_wave 题 criteria 参考 ≥0.29 BNB 级；
 *   与 T244 activity_burst 类型同线） */
const BURST_WAVE_MIN_BNB = 0.29;
/** sbw 波钱包户均尘埃线（尘埃行剔除线同值 0.03——「户均 0.016/0.021 尘埃堆波不算
 *   流量」样本 vs「户均 0.070 真实」样本） */
const BURST_WAVE_AVG_MIN_BNB = 0.03;
/** sbw 跨度线：波末笔距锚 ≤60s（「锚点时刻的当前状态」；波已结束很久=盘面已走完） */
const BURST_WAVE_MAX_SEC_SINCE_END = 60;

/** 档位全序（cap/抬档用） */
const ACT_ORDER = { low: 0, mid: 1, high: 2, ultra: 3 };

/**
 * 活跃度档位因子判定（Jev activity_level 题判序全量因子化）。
 * @param {Object} derived - cheat-snapshot 的 derived 活跃度锚（dt 缺失全族 null 由
 *   snapshot 保证；null 键=无证据，本函数 fail-open 语义=对应臂不成立/不适用）
 * @param {Object} [opts]
 * @param {boolean} [opts.sbwBurst] 调用方 sbw 判定结果（judgeStallBurstWave 产物
 *   === 'burst'）——⑥反锚原料
 * @returns {{act: 'low'|'mid'|'high'|'ultra'|null, arm: string|null, trace: Object}}
 *   act=null=证据不足不可判（上游 fail-open 放行）；arm=命中臂名（留痕）
 */
function judgeActLevel(derived = {}, opts = {}) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const sbwBurst = opts.sbwBurst === true;

  // 证据门：dt 族缺失（无有效时间轴）→ 不可判
  const spanSec = num(derived.spanSec);
  const tickCount = num(derived.tickCount);
  if (spanSec === null || tickCount === null || tickCount < 1) {
    return { act: null, arm: 'no_evidence', trace: { spanSec, tickCount } };
  }

  const t = (arm, extra) => ({
    arm,
    trace: {
      spanSec, tickCount,
      ticksPerMin: num(derived.ticksPerMin),
      idlePct: num(derived.idlePct),
      maxGapSec: num(derived.maxGapSec),
      buyMedianBnb: num(derived.buyMedianBnb),
      throughputBnbPerMin: num(derived.throughputBnbPerMin),
      maxDrawdownPct: num(derived.maxDrawdownPct),
      buyN: num(derived.buyN), sellN: num(derived.sellN),
      totalBuyBnb: num(derived.totalBuyBnb), totalSellBnb: num(derived.totalSellBnb),
      nearSegBnbPerMin: num(derived.nearSegBnbPerMin),
      nearSegBuyMedianBnb: num(derived.nearSegBuyMedianBnb),
      nearSegBuyBnb: num(derived.nearSegBuyBnb), nearSegSellBnb: num(derived.nearSegSellBnb),
      nearTail10BnbPerMin: num(derived.nearTail10BnbPerMin),
      nearPre20BnbPerMin: num(derived.nearPre20BnbPerMin),
      nearTail5BuyN: num(derived.nearTail5BuyN),
      nearTail5BuyBnb: num(derived.nearTail5BuyBnb),
      nearTail10SellWallets: num(derived.nearTail10SellWallets),
      nearTail10BuyN: num(derived.nearTail10BuyN),
      nearTail10BuyBnb: num(derived.nearTail10BuyBnb),
      nearPre10GapSec: num(derived.nearPre10GapSec),
      nearPre10Wallets: num(derived.nearPre10Wallets),
      actWeightedThroughputBnbPerMin: num(derived.actWeightedThroughputBnbPerMin),
      ...(extra || {}),
    },
  });

  let act = null;
  let arm = null;

  // ── ⑦ 临近买点段四臂（出货→衰减→密集→死寂）。出货/衰减/密集三臂用 CD394
  //    尾窗键（按绝对位置窗恒算——短窗票照出，26s 窗 60 笔断崖样本）；死寂臂用
  //    D3.59 近段键（spanSec ≤ 30 全 null=临近=全窗无对比）──
  const hasNear = num(derived.nearSegTickN) !== null;

  // 出货臂 → ultra（照实定档、不因失衡降档、不受背景压制——直接返回）
  const sellWallets = num(derived.nearTail10SellWallets);
  const t10BuyN = num(derived.nearTail10BuyN);
  const t10BuyBnb = num(derived.nearTail10BuyBnb);
  if (sellWallets !== null && sellWallets >= SELL_WALLETS_COOP
    && (t10BuyN === null || t10BuyN <= 1 || (t10BuyBnb !== null && t10BuyBnb < TAIL_BUY_DUST_BNB))) {
    return {
      act: 'ultra', arm: 'coop_dump',
      trace: t('coop_dump', { sellWallets, tail10BuyN: t10BuyN, tail10BuyBnb: t10BuyBnb }).trace,
    };
  }

  const t10Bpm = num(derived.nearTail10BnbPerMin);
  const pre20Bpm = num(derived.nearPre20BnbPerMin);
  const t5N = num(derived.nearTail5TickN);
  const t5BuyN = num(derived.nearTail5BuyN);
  const t5BuyBnb = num(derived.nearTail5BuyBnb);
  const notDropped = pre20Bpm === null || pre20Bpm === 0
    || (t10Bpm !== null && t10Bpm >= pre20Bpm / TAIL_DROP_RATIO);

  // 衰减臂 → 至多中（cap 语义：后续背景校验只压不抬自动生效）
  if (pre20Bpm !== null && pre20Bpm > 0 && t10Bpm !== null
    && t10Bpm < pre20Bpm / TAIL_DROP_RATIO
    && (t5N === null || t5N <= 1 || t5BuyN === null || t5BuyN === 0)) {
    act = 'mid';
    arm = 'near_decay';
  } else {
    // 密集臂 → 至少高（三反锚：成色反锚 + 段前背景反锚）
    // 吞吐腿：近段键（spanSec>30）缺席时以尾 10s 吞吐作短窗代理（CD394 短窗盲区修复）
    const segBpmRaw = num(derived.nearSegBnbPerMin);
    const segBpm = segBpmRaw !== null ? segBpmRaw : t10Bpm;
    let dense = segBpm !== null && segBpm >= NEAR_ALIVE_BPM_MIN
      && notDropped
      && t5BuyN !== null && t5BuyN >= 1
      && t5BuyBnb !== null && t5BuyBnb >= TAIL_BUY_DUST_BNB;
    let denseDenied = null; // 'color' | 'bg' | null
    if (dense) {
      // 成色反锚：近段卖额 ≥ 买额 3 倍（含买额≈0 的纯卖段）=出货拉起的假吞吐；
      // 近段买卖额拆分锚缺席（短窗代理口径）→ 反锚不评（fail-open 方向不扩大收紧）
      const segBuy = num(derived.nearSegBuyBnb);
      const segSell = num(derived.nearSegSellBnb);
      if (segSell !== null && segSell >= SELL_EVIDENCE_BNB
        && (segBuy === null || segSell >= segBuy * SELL_DOMINANCE_RATIO)) {
        dense = false;
        denseDenied = 'color';
      }
      // 段前背景反锚：孤立脉冲（gap ≥15s ∧ 段前独立钱包 ≤2）；两键 null=段前无行
      // （整窗都在尾 10s 内=极早价格发现窗）→ 反锚不适用
      if (dense) {
        const gap = num(derived.nearPre10GapSec);
        const bgW = num(derived.nearPre10Wallets);
        if (gap !== null && bgW !== null && gap >= PRE10_GAP_SEC && bgW <= PRE10_WALLETS_MAX) {
          dense = false;
          denseDenied = 'bg';
        }
      }
    }
    if (dense) {
      act = 'high';
      arm = 'near_alive';
    } else if (hasNear && denseDenied === null) {
      // 密集臂不成立（主腿缺失）→ 死寂臂
      const segBuyMedian = num(derived.nearSegBuyMedianBnb);
      if ((segBuyMedian !== null && segBuyMedian < BUY_MEDIAN_DUST_BNB)
        || (segBpmRaw !== null && segBpmRaw < THROUGHPUT_DEAD_BPM)) {
        act = 'low';
        arm = 'near_dead';
      }
    } else if (denseDenied === 'bg') {
      // 段前背景反锚：至多中（不落死寂臂——脉冲本身有量，是孤立而非死寂）
      act = 'mid';
      arm = 'near_alive_bg_denied';
    } else if (denseDenied === 'color' && hasNear) {
      // 成色反锚：落死寂臂判读（题面「任一反锚命中=密集臂不成立，落死寂臂判读」）
      const segBuyMedian = num(derived.nearSegBuyMedianBnb);
      if ((segBuyMedian !== null && segBuyMedian < BUY_MEDIAN_DUST_BNB)
        || (segBpmRaw !== null && segBpmRaw < THROUGHPUT_DEAD_BPM)) {
        act = 'low';
        arm = 'near_dead';
      }
      // 死寂臂两腿都不中（近段买中位正常且吞吐正常、但卖主导）→ 全窗综合
    }
  }

  // ── 均不命中 → 全窗+临近段综合定档（题面「按全窗+临近段综合要素定档」；
  //    临近段双向活跃=密集臂主腿（尾 5s 买）缺失时的综合 high 腿——「买入暂歇
  //    非出货」样本：临近 30s 20 笔买卖双向、尾 10s 买入暂歇 → 落高档）。
  //    低档腿「节奏稀疏笔均尘埃」（题面「节奏稀疏笔均尘埃→低」）：单笔量级
  //    正常（中位 0.05 上下）的稀疏盘不属此腿（只是节奏稀疏=mid 方向）──
  const tpm0 = num(derived.ticksPerMin);
  const avg0 = num(derived.avgTradeBnb);
  if (tpm0 !== null && tpm0 < ACTIVITY_LOW_TPM_REF
    && avg0 !== null && avg0 < BUY_MEDIAN_COMMON_BNB) {
    act = 'low';
    arm = 'sparse_dust';
  }
  if (act === null) {
    const tpm = num(derived.ticksPerMin);
    const thr = num(derived.throughputBnbPerMin);
    const segTickN = num(derived.nearSegTickN);
    const segBuyN = num(derived.nearSegBuyN);
    const segSellN = num(derived.nearSegSellN);
    const segBpmRaw3 = num(derived.nearSegBnbPerMin);
    // 近段双向活跃综合腿：近段 ≥12 笔 ∧ 买卖各 ≥3 笔（双向在场）∧ 吞吐过线
    // ∧ 未断崖——尾 5s 无买不压它（「买入暂歇≠买方枯竭」，题面高档对照样本）
    const nearTwoWay = segTickN !== null && segTickN >= 12
      && segBuyN !== null && segBuyN >= 3
      && segSellN !== null && segSellN >= 3
      && segBpmRaw3 !== null && segBpmRaw3 >= NEAR_ALIVE_BPM_MIN
      && notDropped;
    if (tpm !== null && tpm >= TPM_ULTRA && thr !== null && thr >= THROUGHPUT_HIGH_BPM) {
      act = 'ultra';
      arm = 'whole_window_ultra';
    } else if (nearTwoWay || (tpm !== null && tpm >= TPM_HIGH && thr !== null && thr >= THROUGHPUT_HIGH_BPM)) {
      act = 'high';
      arm = nearTwoWay ? 'near_two_way' : 'whole_window_high';
    } else {
      act = 'mid';
      arm = 'whole_window';
    }
  }

  // ── 全窗背景校验（只压不抬）。near_alive（⑦密集臂）豁免「全窗稀疏」族
  //    （①静默——题面「全窗稀疏不抹临近真实涌入」，与①的调和由段前背景反锚与
  //    D3.73 承担；③尘埃假活跃与密集臂吞吐线数学互斥）；④单向死水与全窗四腿
  //    联立是**独立臂**（题面「两臂独立，任一成立即可压低档位」「即使交易持续
  //    不断也压低档位」）——照压一切档；D3.73 时间结构是密集臂本身的金额轴约束
  //    （cap 高）──
  const cap = (level, capArm, force = false) => {
    if (!force && arm === 'near_alive') return;
    if (ACT_ORDER[act] > ACT_ORDER[level]) { act = level; arm = capArm; }
  };
  // ① 大比例无交易期（⑥ burst 抬档在最后统一处理）
  const idlePct = num(derived.idlePct);
  if (idlePct !== null && idlePct >= IDLE_PCT_MAJOR) cap('low', 'idle_major');
  // ③ 尘埃假活跃：买盘中位尘埃 ∧ 吞吐死寂
  const buyMedian = num(derived.buyMedianBnb);
  const thr2 = num(derived.throughputBnbPerMin);
  if (buyMedian !== null && buyMedian < BUY_MEDIAN_DUST_BNB
    && thr2 !== null && thr2 < THROUGHPUT_DEAD_BPM) cap('low', 'dust_fake_active');
  // ④ 单向死水：买入主导失衡 + 回撤浅 + 非极早窗
  const buyN = num(derived.buyN);
  const sellN = num(derived.sellN);
  const buyBnb = num(derived.totalBuyBnb);
  const sellBnb = num(derived.totalSellBnb);
  const dd = num(derived.maxDrawdownPct);
  const earlyWin = spanSec < EARLY_WIN_SEC && tickCount < EARLY_WIN_N;
  if (buyN !== null && sellN !== null && buyN >= 3 && sellN >= 1
    && buyN >= sellN * IMBALANCE_N_RATIO
    && buyBnb !== null && sellBnb !== null && buyBnb >= sellBnb * IMBALANCE_BNB_RATIO
    && dd !== null && dd < DRAWDOWN_FLAT_PCT
    && !earlyWin) cap('low', 'one_way_dead', true);
  // 全窗量级四腿联立稀疏（间歇死水）
  const tpm3 = num(derived.ticksPerMin);
  const thr3 = num(derived.throughputBnbPerMin);
  const maxGap = num(derived.maxGapSec);
  if (tpm3 !== null && tpm3 < TPM_SPARSE
    && thr3 !== null && thr3 < THROUGHPUT_DEAD_BPM
    && buyMedian !== null && buyMedian < BUY_MEDIAN_COMMON_BNB
    && (idlePct !== null && idlePct >= IDLE_PCT_QUARTER || maxGap !== null && maxGap >= MAX_GAP_LONG_SEC)) {
    cap('low', 'sparse_four_legs', true);
  }
  // D3.73 时间结构：非 burst 单点脉冲不给高档（至多中）
  if (!sbwBurst && act === 'high') {
    const segBpm2 = num(derived.nearSegBnbPerMin);
    const weighted = num(derived.actWeightedThroughputBnbPerMin);
    if (segBpm2 !== null && segBpm2 > 0 && weighted !== null
      && weighted < segBpm2 * TIME_STRUCT_RATIO) cap('mid', 'time_structure', true);
  }
  // ⑥ burst 反锚：静默后买入涌入不判低（中档起判）
  if (sbwBurst && act === 'low') { act = 'mid'; arm = 'burst_raised'; }

  return { act, arm, trace: t(arm).trace };
}

/**
 * 停滞突发波（sbw）因子判定（Jev stall_burst_wave 题的代码版；CD422 波绑定 +
 * CD398 流向硬腿 + criteria 量级线同源）：最后 ≥30s 静默段（burstLastGapSec 非
 * null=有段）出口后波窗内买入主导、波钱包 ≥2（孤笔不成波）、波买额 ≥0.29
 * （一定流量）、户均非尘埃（≥0.03 堆波不算）、波距锚 ≤60s（当前状态）。
 * 量级/户均/跨度锚缺席（旧档断代）容缺照判（不扩大收紧面，CD398 同哲学）；
 * 无波证据 fail-closed none。返回 'burst'|'none'。
 * @param {Object} derived
 * @returns {'burst'|'none'}
 */
function judgeStallBurstWave(derived = {}) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const lastGap = num(derived.burstLastGapSec);
  if (lastGap === null) return 'none'; // 无 ≥30s 静默段=无停滞前提
  const waveBuy = num(derived.burstExitWaveBuyBnb);
  const waveWallets = num(derived.burstExitWaveWallets);
  if (waveBuy === null || waveWallets === null || waveBuy <= 0 || waveWallets < 2) {
    return 'none'; // 无波/孤笔不成波（CD422）
  }
  // 一定流量：波买额 ≥0.29（「一两笔常见档买单＋零星尘单的量级」不入；criteria 参考线）
  if (waveBuy < BURST_WAVE_MIN_BNB) return 'none';
  // 非尘埃堆波：户均 ≥0.03（「几十个钱包户均/中位全挤 0.0X 尘埃档」不算流量）
  const avg = num(derived.burstWaveWalletAvgBnb);
  if (avg !== null && avg < BURST_WAVE_AVG_MIN_BNB) return 'none';
  // 跨度：波末笔距锚 ≤60s（「锚点时刻的当前状态」；波在窗早期=盘面已走完）
  const since = num(derived.burstSecSinceWaveEnd);
  if (since !== null && since > BURST_WAVE_MAX_SEC_SINCE_END) return 'none';
  // CD398 流向硬腿：波窗自身净流 / 波钱包全窗净额任一净负=卖方主导不属 burst
  const winNet = num(derived.burstWaveNetBnb);
  if (winNet !== null && winNet < 0) return 'none';
  const walletNet = num(derived.burstWaveWalletNetBnb);
  if (walletNet !== null && walletNet < 0) return 'none';
  return 'burst';
}

module.exports = {
  ACT_JUDGE_VERSION,
  judgeActLevel,
  judgeStallBurstWave,
  // 线值导出（单测边界断言与标定脚本调参用）
  LINES: {
    NEAR_ALIVE_BPM_MIN, THROUGHPUT_DEAD_BPM, THROUGHPUT_HIGH_BPM, TPM_HIGH, TPM_ULTRA, TPM_SPARSE,
    BUY_MEDIAN_DUST_BNB, BUY_MEDIAN_COMMON_BNB, DRAWDOWN_FLAT_PCT,
    IMBALANCE_N_RATIO, IMBALANCE_BNB_RATIO, EARLY_WIN_SEC, EARLY_WIN_N,
    IDLE_PCT_MAJOR, IDLE_PCT_QUARTER, MAX_GAP_LONG_SEC, TAIL_DROP_RATIO,
    SELL_DOMINANCE_RATIO, PRE10_GAP_SEC, PRE10_WALLETS_MAX, TIME_STRUCT_RATIO,
    SELL_WALLETS_COOP, TAIL_BUY_DUST_BNB, SELL_EVIDENCE_BNB,
  },
};
