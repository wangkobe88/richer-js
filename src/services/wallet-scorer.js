'use strict';
/**
 * WalletScorer — 钱包质量评分（TPA 独立维度，不接壤任何买入过滤）
 * （pumpfun 回迁批 4；SOL/lamports → BNB 浮点口径，SOL 阈值 ×0.4 换算惯例，曲线形状逐字保留）
 *
 * 评分思想：
 *   - 高质量钱包（交易量大 / 平均额高 / 少 bad_action）= 大户真金白银做筹码的"诚意"或散户跟单大户 → 强盘特征。
 *   - 低质量钱包（交易量小 / 平均额低 / 大额交易全是 bad_action）= 低成本刷量耗材 → 流水盘/操纵盘特征。
 *   - ★持仓时长不参与评分（母版 2026-08-19 用户拍板「持仓时间短不能作为钱包的惩罚标准，快速 sniper 本身无害；
 *     TPA 核心目的=检测恶意大户，只要不是恶意大户的币就可以」）：hold 维度与 holdShort 重罚 cap 全删，恶意检测
 *     完全由 bad 维 cap 链（malicious/lowLevel/tier2/badActionByHuman）承担，与持仓时长解耦。
 *
 * 0-4.5 分制：volume(0-2) + avgBnb(0-2) + hold(flat 0.25) = 4.5；bad 只降不加分。
 *   - volume：累计 BNB 交易额（log-linear 饱和：0.4→0 / 80→满分 2.0 封顶；"背书够用"即饱和，不鼓励也不惩罚大交易额）
 *   - avgBnb：平均交易额（★聚合口径=连续同向 <5s 合并为 1 意图后的平均，非逐笔），log-linear 连续映射（dust=低分；大户=高分；无阈值跳变）
 *   - bad：bad_action 靶向率 effBadRatio，【只降不加分】dim3 恒 0（无 bad 不奖励"清白"），降分靠恶意 cap（靶向率越高总分上限越低）
 *   - hold：flat 0.25 不奖不罚（medianHoldSeconds 仍计算——classifyHolder sniper 否决与前端展示用，但不进评分）。
 *     4.5 分制与既有阈值刻度（tokenScore 门 1.5/1.8/1.2、verdict ts>2、fallback 3.25）保持不变。
 *
 * 输入 profile（来自 TokenPositionAnalyzer._packProfile，含 as-off raw 统计量）：
 *   totalBnb / tickCount / aggregatedTradeCount / avgBnb（★聚合口径，=totalBnb/aggregatedTradeCount）/ largeTradeCount / badCount14d / badRatio
 *   rawTotal / tokenCount / sampleApprox / scoreFallback（本模块不读 isSniper，评分不含持仓时长惩罚）
 *
 * 单位（BSC 迁移口径）：profile 内 totalBnb/avgBnb 是 BNB 浮点（母版 lamports/1e9 入口转换已废），
 *   本模块直读。DEFAULT_PARAMS 的 BNB 阈值=母版 SOL 值 ×0.4 写字面量；注释中的母版历史案例数字
 *   （6EDaVs=536SOL 等）保留 SOL 原值作审计锚点，勿与 BSC 现网数据直接对比。
 *
 * ⚠️ 阈值 DEFAULT_PARAMS 是【BSC 初始占位值】（×0.4 保形换算），待 wss_price_ticks 分布回测校准后
 *   由实验 config.walletScore.params 覆盖。breakdown.raw 保留各维度原始值供校准分析。
 *
 * 多策略：STRATEGIES 注册表，opts.strategy dispatch。v1 实现，v2 预留（新增只加一行注册）。
 */

// 占位阈值（回测校准覆盖）。breaks 升序，scores.length === breaks.length+1。
const DEFAULT_PARAMS = {
  largeTradeBnb: 1.0, // 大额笔数阈值(BNB)，默认对齐 BAD_BUY（保证 badCount ⊆ largeCount → badRatio∈[0,1]）（母版 2.5 SOL ×0.4）
  // ★volume 维度 log-linear 饱和映射（母版 2026-08-05，用户指令"也搞线性加权；不鼓励/不惩罚大交易额，有背书能力就够了"）：
  //   累计 BNB 高=刷量规模≠更多诚信——达到"背书够用"即封顶：不因交易额大奖励(不鼓励)，也不降分(不惩罚)。
  //   log10(totalBnb) 在 [volFloor, volCeil] 线性映射到 [0, volMax]，≥volCeil 封顶 volMax（饱和 plateau）。
  //   锚点：volFloor=0.4BNB→0(无背书) / volCeil=80BNB→满分(背书够用饱和)。效果(volMax=2.0)：1.2→0.41 / 4→0.87 / 12→1.28 / 40→1.74 / 80→2.0。
  //   （=母版 1/10/30/100/200 SOL 的 ×0.4 对应位）。远程校准时只调 floor/ceil 两个数。满分 volMax=2.0。见 _volumeScore()。
  volFloor: 0.4,   // 累计 BNB 下界（≤此值=0 分；几乎无背书能力）（母版 1 SOL）
  volCeil: 80,     // 累计 BNB 饱和点（≥此值=满分 volMax；背书"够用"封顶，大额不再加分也不降分）（母版 200 SOL）
  volMax: 2.0,     // volume 维满分（饱和映射已防过度奖励大额→恢复 2.0；总分 vol2+avg2+hold0.25=4.5）
  // ★avg 维度 log-linear 连续映射（母版 2026-08-05，用户指令"搞线性算分规避阈值分档"）：单笔金额重尾分布，
  //   分档阈值难选且跳变；改 log10(avgBnb) 在 [avgFloor, avgCeil] 线性映射到 [0, avgMax]。
  //   两个直觉锚点：avgFloor=dust 下界(0.04BNB→0分)，avgCeil=whale 上界(4BNB→满分)。效果平滑：
  //   0.2BNB→0.70 / 0.4→1.0 / 0.8→1.30 / 2→1.70 / 4→2.0（=母版 0.5/1/2/5/10 SOL 的 ×0.4 对应位）。见 _avgBnbScore()。
  //   远程校准时只调 floor/ceil 两个数，不必找 4 个断点。
  avgFloor: 0.04,  // avg BNB 下界（≤此值=0 分；dust/sniper 级小单）（母版 0.1 SOL）
  avgCeil: 4,      // avg BNB 上界（≥此值=满分 avgMax；大户/whale）（母版 10 SOL）
  avgMax: 2.0,     // avg 维满分（维持总分 vol2+avg2+hold0.25=4.5）
  // —— bad 维靶向率阈值（无量纲，母版原值不换算）——
  // 口径已改：effBadRatio = max(可信 badBuyRatio, badSellRatio)，分母=候选交易（早期快速买入 buy / 闪崩期 sell），
  // 不再被跟风大额交易稀释。靶向率基线因流水盘占比偏高（low_quality+wash+pdump 是多数），阈值相应上调。
  badRatioHigh: 0.8, // ≥ → 恶意 cap 高位（靶向率 80%+ 几乎专挑流水盘）；_maliciousCeiling 锚点
  badRatioMid: 0.5,  // 【legacy】bad 维改 penalty-only 后不再进评分路径，仅留历史靶向率分档参考
  badRatioLow: 0.2,  // 【legacy】同上（旧 dim3 阶梯已移除）
  badRatioSevere: 0.95, // ≥ → 恶意 cap 重度（近乎纯流水盘早期买入/集中抛售）；_maliciousCeiling 锚点
  // ★连续恶意降分曲线（母版 2026-08-05，用户指令"打压太粗暴，0.61 跟 0.79 一样不合理，搞连续降分公式"）：
  //   旧三档阶跃 if-else（<0.6 不罚 / 0.6→3.0 / 0.8→1.0 / 0.95→0.5）在档位间零区分度——0.61 与 0.79
  //   同落 [0.6,0.8) 桶一律 cap 3.0，0.75 恶意率只压到 3.0 太轻。改 effBadRatio→ceiling 分段线性插值：
  //   保留已校准锚点(0.6/0.8/0.95)不变，锚点之间线性填充 + 加 1.0→maliciousFloorPure 纯恶意地板。
  //   见 _maliciousCeiling()。锚点值仍由下方 badRatioMidPenalty/maliciousFloorMid 等单一真相源派生。
  //   原 2026-08-04 三档语义保留作锚点比例：mid(0.6)→60% / high(0.8)→20% / severe(0.95)→10% / pure(1.0)→6%。
  //   ★母版 2026-08-05 bad 去加分后总分制 5.0→4.0：所有 cap/floor 锚点等比 ×0.8 保惩罚力度不变（见各值注释）。
  badRatioMidPenalty: 0.6, // ≥ → 恶意 cap 起罚点（60%+ 开始降分；区别于 dim3 断点 badRatioMid=0.5）
  maliciousFloorMid: 2.4,  // effBadRatio≥0.6 总分上限（×0.8 旧 3.0；小惩罚，介于无罚与 high 0.8 之间）
  // ★软 ramp 起点（母版 2026-08-25 用户拍板「接近 60% 的也适当惩罚」）：[0.45,0.6) 从「不罚」改为
  //   ceiling 3.2 线性降到 2.4——打「贴线重犯」通道。母版 08-23 五高亏损票审计（_ana_tpa_split_diag.cjs，
  //   复算与落表 tokenScore 5/5 差 0.000）：EEFJJihh eng r=0.58→4.25 分单钱包 26.3% float 拉过线、
  //   2KP9mi r=0.55→3.78、Aefwt 小队 r=0.50×3→3.1-3.5——全部停在 0.6 起罚点下方一分不罚。
  //   <0.45 仍不罚（恶意占比不足半=跟风混合，不构成定向信号）。分母≥1 即罚语义不变（08-03 用户指令）。
  badRatioRampStart: 0.45,   // 软 ramp 起罚点（<_maliciousCeiling 首锚点）
  maliciousRampCeiling: 3.2, // ramp 起点 0.45 处总分上限（温和：多数未罚分 3-4，3.2 只削头部）
  // 分母下界=1：候选≥1 即施罚（母版用户 2026-08-03 指令"分母小也要惩罚，只有一个高市值行为但是流水盘
  //   恶意卖出这种肯定要惩罚"）。单次明确的恶意早期买入/集中抛售（age<3s≥1.0BNB 或 闪崩段≥2.0BNB 且分类命中）
  //   本身就是强操纵信号，不因"样本少"豁免；仅当完全无候选（earlyBuy=0 且 crashSell=0）才无操纵信号→豁免。
  minEarlyBuyForPenalty: 1,   // badBuyRatio 分母下界（早期大额买入次数，≥1 即罚）
  minCrashSellForPenalty: 1,  // badSellRatio 分母下界（闪崩期大额集中抛售次数，≥1 即罚）
  fallbackScore: 3.2, // 无数据降级固定分（×0.8 旧 4.0；满分 4.0 下给 80% 中高分）
  maliciousFloorHigh: 0.8,   // effBadRatio=badRatioHigh(0.8) 处的 ceiling（×0.8 旧 1.0；连续曲线锚点：大罚）
  maliciousFloorSevere: 0.4, // effBadRatio=badRatioSevere(0.95) 处的 ceiling（×0.8 旧 0.5；连续曲线锚点：重罚）
  maliciousFloorPure: 0.24,  // effBadRatio=1.0（纯恶意）总分上限地板（×0.8 旧 0.3；连续曲线末锚点）
  // ★hold 维度 flat 化（母版 2026-08-19 用户拍板「持仓时间短不能作为钱包的惩罚标准，快速 sniper 本身无害；
  //   TPA 核心目的=检测恶意大户，只要不是恶意大户的币就可以」）：原 holdBreaks/holdScores 阶梯（<10s→0 … ≥300s→0.5）
  //   与 holdShort 重罚 cap（medianHold<18 → 总分压 1.6，母版 2026-08-09 61d079ed 校准版）全删——
  //   case ALXrznx2：bad 维全零（badBuy/badSell/badCount14d/tier2/lowLevel 全 0）的干净快速交易钱包
  //   被 cap 从 2.608 压到 1.6，恶意大户检测被持仓时长劫持。holdFlatScore=原豁免值不奖不罚；
  //   4.5 分制与既有阈值刻度（tokenScore 门 1.5/1.8/1.2、verdict ts>2、fallback 3.25）不变。
  //   medianHoldSeconds 仍由 profile-builder 计算：classifyHolder sniper 否决（短持仓→豁免大户判定）
  //   与前端展示用，但不进评分。
  holdFlatScore: 0.25,
  // ★低交易额中性化 cap（母版 2026-08-05，用户指令"交易额低于阈值的压制到中等分"）：
  //   低 totalBnb=低样本 → avg(=总额/笔数)/bad/hold 难辨别好坏（非作恶信号，是样本不足不可信）。
  //   处理=中性化到中等分（不确定性→中性），不是大幅压低当惩罚。case 3QRT: tickCount=2/totalSol=2.78，
  //   avg/bad/hold 三维 exempt/失真送高分 3.25 → 拉回中等 2.46。
  //   连续曲线 _lowVolumeCeiling（分段线性），totalBnb 越低 ceiling 略低（"极少交易"比"较少"更难辨别→稍低）；
  //   纯总分 cap 不碰维度分，与恶意 cap 取 min（最严）。
  //   锚点 [0→1.6, 1.2→2.0, 4→2.4]（=母版 [0,3,10] SOL ×0.4 对应位；_ana_lowvol_floor.cjs 校准：钱包均分≈中等）。
  lowVolThreshold: 4,     // totalBnb(BNB) >= 此值不中性化（母版 10 SOL；分布远低于 P10，仍属"没啥交易"→ < 此值才中性化）
  lowVolMidBnb: 1.2,     // 连续曲线中间锚点（BNB）（母版 3 SOL）
  lowVolFloorZero: 1.6,  // totalBnb→0 总分上限（×0.8 旧 2.0；极少交易，略低；中等偏下）
  lowVolFloorMid: 2.0,   // totalBnb=lowVolMidBnb 总分上限（×0.8 旧 2.5；=钱包均分中等）
  lowVolCeilingHigh: 2.4,// totalBnb→lowVolThreshold 总分上限（×0.8 旧 3.0；仍难辨别→中等偏上，非不限）
  // ★Token 级低流通降权（母版 2026-08-05）。
  //   case FenDc…：Gzaq 买约 1 SOL 占净持仓 18%（topNet≈5.5 SOL），历史换手巨大但当前净流通极小、资金已撤出
  //   → floatPct / wallet score 都不代表真实市场，分数参考价值低。
  //   单信号 walletHoldingPct（代币从池子流入钱包占比%）= Σ(买代币−卖代币)/totalSupply*100（curve 消耗进度，
  //     BSC 版分母=faState.totalSupply，four.meme=TokenCreate d[5] / flap=1e9 固定），
  //     持仓类因子【全量无 skip】，语义≈无skip的资金净流入 → 单变量足够。
  //   ★netBuyBnb 已弃用：FA 侧 _activeTotalBuyBnb/totalSellBnb 双 skip 且无全量 sell BNB 累加器，
  //     lowFloat 依赖数据须「无 skip」（与触发条件同口径）故砍 netBuyBnb，单用 walletHoldingPct。
  //   walletHoldingPct < walletHoldingPctThresh → 温和压到 penaltyCeiling（不归零、不判死：低流通只是「参考价值低」的弱信号）。
  //   见 applyLowFloatPenalty()。阈值待校准脚本验证。
  lowFloat: {
    // netBuyBnbThresh 已删（netBuyBnb 弃用；lowFloat 只用全量 walletHoldingPct）
    walletHoldingPctThresh: 12, // 代币从池子流入钱包占比(%) 下限（全量无 skip）。低于=吸筹不足/砸回池子。待校准
    penaltyCeiling: 2.0,        // 命中且原分更高 → 温和压到此（中等偏低，参考 lowVolFloorMid=2.0；不归零、不判死）。待校准
  },
  // ★Tier2 暴力block集中抛售衰减（母版 2026-08-08，用户定 ratio+count 结合·中等力度）：multiplier 叠加在 cap 链后（双重恶意双罚）。
  //   ratio 主衰减（士兵：低频高占比）+ count 辅衰减（专业户：反复集中抛售 count 大被 eff 稀释）。
  //   count 须配 ratioFloor 排除大户偶发（ratio<0.02 不触发）。ratio=null（eff=0）→ count 必=0，两衰减都不触发。
  tier2: {
    ratioThreshold: 0.05,    // ratio 起罚点（≥才衰减）
    ratioFloor: 0.02,         // count 触发的 ratio 下界（排除大户偶发 ratio 极低）
    countThreshold: 10,       // count 起罚点（≥ 且 ratio≥ratioFloor 才衰减）
    ratioAnchors: [[0.05, 0.92], [0.15, 0.75], [0.30, 0.55], [0.50, 0.40], [1.0, 0.30]],
    countAnchors: [[10, 0.90], [20, 0.82], [50, 0.68], [100, 0.55]],
  },
  // ★大户偶发坏行为豁免恶意 cap（母版 2026-08-06，6EDaVs/6LZFEakt 案驱动）：局部靶向率 effBadRatio 在小分母(earlyLargeBuyCount 极少)
  //   下方差极大不可信（如 2/2=100% 纯属偶然）。真实大户(交易基数大)+整体交易脏度极低(偶发,>0.4BNB有效交易分母)
  //   → 跳过恶意 cap（仅此 cap，lowVol 照常）。不区分 buy/sell（sell 偶发也算偶然）。
  //   case 6EDaVs: 536SOL/105token/earlyLargeBuy 仅 2/effBadRatio=1.0 被压 0.24 → 豁免回 3.62。
  //   case 6LZFEakt: 1545SOL/486token/大额(≥2.5SOL)仅30笔 → largeTradeCount 分母脏度 8/30=26.7% 虚高；
  //     改用 effectiveTradeCount(≥1SOL,含1-2.5SOL) 分母后脏度~2% → 豁免。
  //   边界：系统性作恶大户脏度高(>exemptBadRatioMax)不豁免；小户 tokenCount/totalBnb/effectiveTradeCount 不足不豁免。
  //   ★偶发用【比例】(badCount14d/effectiveTradeCount) 非绝对次数；effectiveTradeCount(≥0.4BNB有效交易)排除 dust 不被稀释。
  exemptTokenCountMin: 400,       // 交易代币数下限：50→400（母版 2026-08-09 回测 61d079ed 验证：收紧 maliciousCap 大户偶发豁免门槛，减少惯犯 wash 逃逸）。≥此值=交易很多=真实大户；6EDaVs=105/6LZFEakt=486
  exemptTotalBnbMin: 40,          // 累计交易额下限 BNB（≥此值=真实大额基数）（母版 100 SOL ×0.4；6EDaVs=536SOL/6LZFEakt=1545SOL 历史锚点）
  exemptEffectiveTradeMin: 50,    // ≥0.4BNB 有效交易笔数下限——"至少要大于这个交易量"：样本足才可信脏度比例；
                                  //   防 dust 刷量(effectiveTradeCount=0)脏度算0误豁免。6EDaVs≈170/6LZFEakt≈400 远超
  exemptBadRatioMax: 0.03,        // 整体脏度上限=badCount14d/effectiveTradeCount（≤此值=偶发；6EDaVs≈1.2%/6LZFEakt≈2%；系统性>10%。初值待远程校准）
  exemptEffBadRatioMax: 0.8,      // ★豁免靶向率上限（母版 2026-08-25）：effBadRatio≥0.8 的高靶率大钱包不豁免（专项异常户≠偶发；见 scoreV1 豁免块注释）
  // ★独立 low-level 补充 cap（母版 2026-08-11，baseline badExempt 漏掉的小额早期快速买入钱包；PhaseB mean PnL 验证接入）。
  //   baseline 恶意 cap 靠 ≥1.0BNB 早期买入分母，badExempt(无大额早期买入)钱包完全逃过 → low-level 降阈 0.6BNB 补回。
  //   误伤面天然受限：cap 降 walletScore 经 tokenScore 按 floatPct 加权(Σscore×floatPct/100)，只在 W 高持仓 token
  //   才显著拉低 tokenScore；PhaseB(b2cdc515) 高持仓子集 winRate 1.2%(误伤≤2)。min 语义；仅 badExempt 触发(纯补充非重复)。
  //   校准见母版 _ana_lowlevel_independent_cap.cjs；回测 A/B 阈值可调。
  llCandThreshold: 3,      // low-level 候选(early+crash)下限：≥3 次小额早期买入/集中抛售才可信（去 llCand=1 噪声）
  llSevereThreshold: 0.95, // low-level 靶向率(llBad/llCand)严重门槛：≥0.95 近乎纯恶意小额（校准分布尾部；CSV 导出边界）
  llSevereFloor: 0.4,      // low-level 严重 cap 地板（对齐 maliciousFloorPure；纯恶意小额。回测 A/B 可调）
  // ★独立 tiny-level 补充 cap（母版 2026-08-20 LOL CftCfBqr 卡线军团案，用户拍板「独立特性不影响已有机制」）：
  //   bad_action(1.0/2.0BNB) 与 low-level(0.6/1.0BNB) 双双被「单笔卡线」绕过——军团单笔精确卡 0.5-0.9BNB：
  //   ≥1.0 档 0 笔(bad exempt)、[0.2,0.6) 连 ll 档也漏、闪崩分片抛售多在 0.2-1.0（ll sell 档 1.0 之下），
  //   且好盘掩护买入稀释靶向率至 0.84<ll 的 0.95。tiny 0.2/0.2BNB 档（profile.tinyLevelBadAction）补口。
  //   count 门为主（绝对笔数无法靠稀释绕过：稀释本身增加 tlCand）+ eff 连续锚点（仿 _maliciousCeiling）。
  //   仅 badExempt 触发（同 ll 语义：baseline 已 cap 不重复压）；min 语义；复用大户偶发豁免。
  tinyLevel: {
    candThreshold: 10,   // count 起罚门（母版 1b 基线 _ana_tiny_baseline.cjs）：军团 18/20 cand≥10（2 个 cand=0 由人工标注覆盖）；
                         //   正常散户 P50 cand=0（一半无候选）；cand<10 挡掉跟单散户。防稀释：稀释本身增加 cand。
    effThreshold: 0.8,   // 靶向率起罚门：军团 eff 全部 ≥0.84（好盘掩护稀释下限）；R 0.5→0.8 再挡对照池 ~1.5pp 低靶向混合户
    effAnchors: [[0.8, 1.5], [0.9, 0.9], [1.0, 0.4]],  // 连续 ceiling（仿 _maliciousCeiling）：军团主力 eff~0.88→~1.2；
                         //   纯恶意小号 eff=1.0→0.4。对照池表观命中 ~20% 经核实为同型未标注卡线惯犯（elb=0/eff 0.9+），非误伤
  },
  // ★ll/tl 扩展激活档（母版 2026-08-26，paramsOverride A/B 臂专用；默认 null=完全关闭=行为不变，不动生产）。
  //   反事实定位（母版 _ana_p12_fg10_ts22_leak + _ana_p12_fg10_heavycut，a772 窗 1442 轮净口径 6%/轮折损）：
  //   ll/tl cap 只在 badExempt 激活 → R2(badExempt 未达 severe 门 0.95/0.8)+R5(非豁免且 effBadRatio<0.45
  //   baseline 不罚)两通道的中靶率带钱包完全不压——E4EzXdwf 型大户(vol 19105SOL/llEff 0.56-0.67)满分供分，
  //   全池惯犯贡献第一。本档不看 badExempt：max(llEff,tlEff)≥effThreshold 且 max(llCand,tlCand)≥candThreshold
  //   → 压 ceiling；激活面=badExempt || effBadRatio<badRatioRampStart（镜像反事实 R2+R5；R4 偶发豁免带与
  //   R7 ramp 段不含）；不套大户偶发豁免（反事实未豁免，靶子正是大户）；min 语义。
  //   反事实数字: Δ净+16.3 SOL(基线-16.2→+0.1 打平)，wash 深亏 95% 压下 vs nor winner 误伤 53%——
  //   生产取舍待新窗 A/B 裁定。A/B 臂挂载=实验 config.walletScore.params.lltlExtended 整对象（浅合并覆盖）：
  //   { "lltlExtended": { "effThreshold": 0.6, "candThreshold": 10, "ceiling": 1.2 } }
  lltlExtended: null,
};

/**
 * avg 维度 log-linear 连续映射：avgBnb ∈ [avgFloor, avgCeil] 在 log10 空间线性映射到 [0, avgMax]。
 * 重尾金额分布下 log 空间线性 = 常见区间有合理区分度（0.2→0.70/0.4→1.0/0.8→1.30/2→1.70/4→2.0），无需阈值分档。
 * ≤avgFloor→0（dust/sniper 级小单）；≥avgCeil→avgMax（whale）。
 */
function _avgBnbScore(avgBnb, p) {
  if (avgBnb <= p.avgFloor) return 0;
  if (avgBnb >= p.avgCeil) return p.avgMax;
  const t = (Math.log10(avgBnb) - Math.log10(p.avgFloor)) / (Math.log10(p.avgCeil) - Math.log10(p.avgFloor));
  return Number((t * p.avgMax).toFixed(3));
}

/**
 * volume 维度 log-linear 饱和映射：totalBnb（累计 BNB）∈ [volFloor, volCeil] 在 log10 空间线性映射到 [0, volMax]。
 * 语义=背书能力（非越多越好）：≤volFloor→0（无背书）；[volFloor,volCeil] 对数增长；≥volCeil→volMax（饱和，大额不鼓励也不惩罚）。
 * volMax=2.0：0.4→0 / 4→0.87 / 40→1.74 / 80→2.0（≥80 封顶）。
 */
function _volumeScore(totalBnb, p) {
  if (totalBnb <= p.volFloor) return 0;
  if (totalBnb >= p.volCeil) return p.volMax;
  const t = (Math.log10(totalBnb) - Math.log10(p.volFloor)) / (Math.log10(p.volCeil) - Math.log10(p.volFloor));
  return Number((t * p.volMax).toFixed(3));
}

/**
 * 连续恶意降分曲线：effBadRatio → 总分上限（ceiling）。分段线性插值，锚点由 DEFAULT_PARAMS 的 floor 值
 * 单一真相源派生：[badRatioRampStart→maliciousRampCeiling, badRatioMidPenalty→maliciousFloorMid,
 *   badRatioHigh→maliciousFloorHigh, badRatioSevere→maliciousFloorSevere, 1.0→maliciousFloorPure]。
 * - ratio < badRatioRampStart → null（不罚，cap 不生效；保留"恶意占比不足半不罚"语义）
 * - [badRatioRampStart, badRatioMidPenalty) → 软 ramp（0.45→3.2 线性降到 0.6→2.4；母版 2026-08-25 贴线重犯通道）
 * - 锚点上 → 该锚点 ceiling（与旧阶跃在锚点处取值一致，仅把档间补连续）
 * - 锚点间 → 线性插值（0.65→2.5 / 0.75→1.5 / 0.765→1.35 …，0.61≠0.79）
 * - ratio ≥ 1.0 → maliciousFloorPure（纯恶意地板）
 */
function _maliciousCeiling(ratio, p) {
  const noPenalty = p.badRatioRampStart;
  if (ratio < noPenalty) return null;
  const anchors = [
    [p.badRatioRampStart, p.maliciousRampCeiling],
    [p.badRatioMidPenalty, p.maliciousFloorMid],
    [p.badRatioHigh, p.maliciousFloorHigh],
    [p.badRatioSevere, p.maliciousFloorSevere],
    [1.0, p.maliciousFloorPure],
  ];
  if (ratio >= 1.0) return anchors[anchors.length - 1][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (ratio < x1) {
      const t = (ratio - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return anchors[anchors.length - 1][1];
}

/**
 * 通用分段线性插值：x 落在 anchors（[[x,y],...] 升序）锚点间线性插值。
 * x < anchors[0][0] → null；x ≥ 末锚点 x → 末锚点 y。tier2 衰减函数共用。
 * （_maliciousCeiling/_lowVolumeCeiling 各自内联同款逻辑，已校准不动；新增衰减统一走本 helper。）
 */
function _interpLinear(x, anchors) {
  if (x < anchors[0][0]) return null;
  if (x >= anchors[anchors.length - 1][0]) return anchors[anchors.length - 1][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1], [x1, y1] = anchors[i];
    if (x < x1) { const t = (x - x0) / (x1 - x0); return y0 + t * (y1 - y0); }
  }
  return anchors[anchors.length - 1][1];
}

/**
 * Tier2 ratio 衰减因子：tier2Ratio（暴力block集中抛售次数/有效交易）越高 → 因子越小（罚越重）。
 * 分段线性插值（ratioAnchors）。ratio<ratioThreshold 或 null → null（不衰减）。
 * 抓「士兵」：低频高占比（偶发大户 ratio 低被 threshold 挡）。
 */
function _tier2RatioFactor(ratio, p) {
  if (ratio == null || ratio < p.tier2.ratioThreshold) return null;
  return _interpLinear(ratio, p.tier2.ratioAnchors);
}

/**
 * Tier2 count 衰减因子：tier2CrashBlockSellCount（暴力block内 0.6-2BNB 集中抛售绝对次数）越高 → 因子越小。
 * 仅 count≥countThreshold 且 ratio≥ratioFloor 才衰减——ratioFloor 排除大户偶发（count 大但 ratio 极低）。
 * 抓「专业户」：反复集中抛售 count 大被 effectiveTradeCount 稀释、ratio 中低（ratio 主衰减漏网）。
 */
function _tier2CountFactor(count, ratio, p) {
  if (ratio == null || ratio < p.tier2.ratioFloor || count < p.tier2.countThreshold) return null;
  return _interpLinear(count, p.tier2.countAnchors);
}

/**
 * 低交易额压制 ceiling：totalBnb（累计 BNB）→ 总分上限。分段线性插值，锚点
 *   [0→lowVolFloorZero, lowVolMidBnb→lowVolFloorMid, lowVolThreshold→lowVolCeilingHigh]。
 * - totalBnb >= lowVolThreshold → null（不压；高交易额钱包不受限）
 * - totalBnb 越低 ceiling 越低（与 _maliciousCeiling 方向相反：ratio 越高越严，totalBnb 越低越严）
 * - 锚点间线性插值；totalBnb<=0 → lowVolFloorZero
 */
function _lowVolumeCeiling(totalBnb, p) {
  if (totalBnb >= p.lowVolThreshold) return null;
  const anchors = [
    [0, p.lowVolFloorZero],
    [p.lowVolMidBnb, p.lowVolFloorMid],
    [p.lowVolThreshold, p.lowVolCeilingHigh],
  ];
  if (totalBnb <= 0) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (totalBnb < x1) {
      const t = (totalBnb - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return anchors[anchors.length - 1][1];
}

/**
 * Token 级低流通降权：直接作用于加权总分 Σ(score×floatPct/100)。
 * （原 applyConcentrationPenalty 集中度惩罚已于母版 2026-08-19 删除：TPA 触发交易量要求调小后，
 *   决策时刻落在开盘几秒、在场持仓者仅个位数，top1/前2/前3 占比天然畸高 → 三条控盘线几乎必中，
 *   惩罚退化成「早期盘必罚」，与钱包质量无关，属系统性误杀。）
 *
 * 单信号 walletHoldingPct（代币从池子流入钱包占比 % = Σ(买代币−卖代币)/totalSupply*100，持仓类因子全量无 skip；
 *   语义≈无skip的资金净流入，与原 netBuyBnb 共线故取单变量）< walletHoldingPctThresh → 命中，
 *   温和压到 penaltyCeiling（不归零、不判死：低流通只是「参考价值低」的弱信号，不必然是死盘）。
 * ★netBuyBnb 已弃用：FA 侧 _activeTotalBuyBnb/totalSellBnb 双 skip 且无全量 sell BNB 累加器，
 *   为保 lowFloat 依赖数据「无 skip」（与触发条件同口径）砍掉 netBuyBnb。
 *
 * 任一信号缺失（null/undefined，如回填前的历史快照 / 数据未就绪）→ 不降权（保守放行，避免误杀）。
 * prev.totalScore==null（holder 全 failed 等）→ 透传，仅附 lowFloat 供展示。
 *
 * @param {{totalScore:number|null, penalized:boolean, penaltyReason:string|null}} prev 加权总分（含四舍五入）
 * @param {{netBuyBnb:number|null, walletHoldingPct:number|null}} ctx 两信号
 * @param {Object} [p=DEFAULT_PARAMS] 读 p.lowFloat（TPA 传实验覆盖后的合并 params；web 用默认）
 * @returns {{totalScore:number|null, penalized:boolean, penaltyReason:string|null, lowFloat:Object}}
 */
function applyLowFloatPenalty(prev, ctx, p = DEFAULT_PARAMS) {
  const lp = p.lowFloat;
  const walletHoldingPct = ctx?.walletHoldingPct;
  // 只用 walletHoldingPct（持仓类因子全量无 skip）；netBuyBnb 已弃用（FA 双 skip 无全量 sell BNB）
  const hit = walletHoldingPct != null && walletHoldingPct < lp.walletHoldingPctThresh;
  const lowFloat = { walletHoldingPct: walletHoldingPct ?? null, hit };
  if (prev.totalScore == null) return { ...prev, lowFloat };
  if (hit && prev.totalScore > lp.penaltyCeiling) {
    return { ...prev, totalScore: lp.penaltyCeiling, penalized: true, penaltyReason: 'low_float', lowFloat };
  }
  return { ...prev, lowFloat };
}

// ── 庄散（zhuang-retail）分析轴：wallet 性质判定 + token 级实时聚合（评分模块内部子模块）──
// ★大户=中性大资金行为特征(大额/早期快速买入/刷量)，不挂钩恶意(bad_action)——恶意大户/作弊归操纵标签轴。
// 数据分层：profile(基础,落 wallet_offline_profiles) → 庄散(派生,实时算不落库)。画像源 scoreHolderAtDecisionTime().profile。
// 4 桶互斥全覆盖，优先级 new_wallet > zhuang(行为且非sniper-like) > retail > neutral：
//   retail(sniper-like 或 广撒网 tc>100) / new_wallet(rawTotal<3) / zhuang(命中大户维度且非sniper-like) / neutral(中频正常)。
// 大户行为 3 维度（任一命中即 zhuang，优先于 retail 广撒网）：
//   ① lowTiny≥0.5 低额刷量   ② bigDom buckets.big/total>0.3 大额主导≈avgBnb过高
//   ③ earlyLargeBuy 3秒大额早期快速买入：比例≥0.3 OR 次数≥10（纯行为不分 token 类别；或关系扩大召回）
// ★sniper 否决：广撒网(tokenCount≥300, 母版 09-02 用户修订单条件) → sniper-like，豁免大户判定（即使③rush命中也归retail）。
//   creator 无条件豁免（发币者=控盘方）。依据：代币多默认职业快速买入散户，控盘不可能广撒网。
// ⚠高频钱包(tokenCount>=200) _packProfile 置空 buckets/lowTinyRatio → ①②失效，仅③可判 zhuang（已知限制，接受）。
// ⚠仅展示观察：不进 aggregateTokenScore 惩罚链、不影响 totalScore/condition/category（未来影响评分须 backtest A/B）。
const ZR_EARLY_LARGE_BUY_RATIO_THR = 0.3; // ③比例阈值：3秒早期快速买入/买入笔数
const ZR_EARLY_LARGE_BUY_COUNT_THR = 10;  // ③绝对数阈值：3秒早期快速买入次数
// ★sniper 否决阈值（sniper-like，豁免大户判定）。母版 09-02 用户修订：简化为单条件——交易 token 数 ≥300 即 sniper，
//   原 medHold≤5s 分支删除（tc∈[80,500)∧秒级平仓的移出：HiD1SoW5 型拆单大户不再被否决归 retail，命中大户维度归 zhuang）。
const ZR_SNIPER_TOKENCOUNT_THR = 300; // 广撒网代币数：≥此值默认散户(sniper)，无充足理由不推翻
function _bucketTotal(b) {
  if (!b) return 1;
  if (b.total != null) return b.total || 1;
  return ((b.dust || 0) + (b.tiny || 0) + (b.small || 0) + (b.medium || 0) + (b.big || 0)) || 1;
}
/**
 * 大户 3 维度命中明细（单一真相源，classifyHolder/zhuangSubtype/classifyHolderDetail 共用它）。
 *   ①lowTiny 低额刷量(lowTinyRatio≥0.5)  ②bigDom 大额主导(buckets.big/total>0.3)  ③rush 3秒大额早期快速买入
 */
function _zhuangDims(p) {
  const lowTinyRatio = p.lowTinyRatio ?? 0;
  const bigDomRatio = p.buckets ? (p.buckets.big ?? 0) / _bucketTotal(p.buckets) : 0;
  const earlyLargeBuyCount = p.earlyLargeBuyCount ?? 0;
  const earlyLargeBuyRatio = earlyLargeBuyCount / Math.max(p.buyCount ?? 0, 1);
  return {
    lowTiny: lowTinyRatio >= 0.5,
    bigDom: bigDomRatio > 0.3,
    rush: earlyLargeBuyRatio >= ZR_EARLY_LARGE_BUY_RATIO_THR || earlyLargeBuyCount >= ZR_EARLY_LARGE_BUY_COUNT_THR,
  };
}

/**
 * 判单个 wallet 性质 + 命中维度明细（Layer1，wallet 级）。
 * @param {Object} p  profile 画像（tokenCount/rawTotal/lowTinyRatio/buckets/earlyLargeBuyCount/buyCount/medianHoldSeconds）
 * @returns {{bucket, dims:{lowTiny,bigDom,rush}, subtype:{dust,big}, rawTotal, tokenCount}}
 *   bucket 庄散单一真相源；dims=命中的大户维度；subtype=大户子类（dust=① / big=②||③）。
 *   优先级 new_wallet(rawTotal<3) > zhuang(任一维度且非sniper-like) > retail(sniper-like或tc>100) > neutral。
 *   ★sniper 否决：isSniperLike(tokenCount≥300) 豁免大户判定→归 retail；creator 豁免。
 */
// ★sniper 否决判定（单一真相源：classifyHolderDetail 桶级否决 + scoreV1 badActionByHuman cap 豁免共用）：
//   母版 09-02 用户修订：单条件 tc≥300（原 tc≥500 OR (tc≥80∧medHold≤5) 简化放宽）。
//   广撒网(≥300代币)=职业快速买入散户；控盘方不可能广撒网。
//   ★creator(token 发币者=控盘方)无条件豁免 sniper：发币者持仓集中抛售是控盘行为，非狙击。
//   ⚠flap 平台 creator=工厂共享地址 → isCreator 事实失效：真实操纵者不获豁免（更严方向，安全），不加特判。
function _isSniperLike(p) {
  const tc = p.tokenCount ?? p.rawTotal ?? 0;
  let isSniperLike = tc >= ZR_SNIPER_TOKENCOUNT_THR;
  if (p.isCreator) isSniperLike = false;
  return isSniperLike;
}

function classifyHolderDetail(p) {
  const tc = p.tokenCount ?? p.rawTotal ?? 0;
  const rawTotal = p.rawTotal ?? tc;
  const dims = _zhuangDims(p);
  const isZhuang = dims.lowTiny || dims.bigDom || dims.rush;
  const isSniperLike = _isSniperLike(p);
  let bucket;
  if (rawTotal < 3) bucket = 'new_wallet';
  else if (isZhuang && !isSniperLike) bucket = 'zhuang';
  else if (isSniperLike || tc > 100) bucket = 'retail';
  else bucket = 'neutral';
  // ★bad_action_by_human（人工标注集中抛售参与者，wallets.tags，_badActionByHumanSet 模块级单例）归 zhuang：
  //   人工定性恶意大户，最高优先级覆盖 new_wallet/retail（与算法 bad_action[badAction 单一源] 不同源）。
  //   母版实例 HiD1SoW5：大额拆单集中抛售大户，medHold 虚低被 sniper 误杀，人工标注后强制归 zhuang 入 retention 大户集。
  //   ★母版 09-02 修订（用户拍板）：sniper-like（跨大量代币的职业快速买入钱包）不再被人工标覆盖——人工标对象=组织者；
  //   TPA blocks:1 快照 top20 按构造全是早期买家，职业快速买入钱包被 cap 0.5 经 tokenScore(浮点加权)票级放大，
  //   实测压塌 69% 历史买点。sniper-like 被标照旧归 retail（HiD1SoW5 型 tc<80 拆单大户不受影响，仍强制 zhuang）。
  if (p.address && _badActionByHumanSet && _badActionByHumanSet.has(p.address)) {
    bucket = isSniperLike ? 'retail' : 'zhuang';
  }
  return {
    bucket,
    dims: { lowTiny: dims.lowTiny, bigDom: dims.bigDom, rush: dims.rush },
    subtype: { dust: dims.lowTiny, big: dims.bigDom || dims.rush },
    rawTotal, tokenCount: tc,
  };
}

/**
 * 判单个 wallet 性质（Layer1 桶名，classifyHolderDetail 的便捷封装）。
 * @returns {'new_wallet'|'zhuang'|'retail'|'neutral'}  庄散单一真相源（TPA/离线脚本/前端均走它）
 */
function classifyHolder(p) {
  return classifyHolderDetail(p).bucket;
}
/**
 * 大户子类（Layer1 子分类，可重叠累加）：dust=①低额刷量 / big=②大额主导||③早期快速买入。
 * @returns {{dust:boolean, big:boolean}}
 */
function zhuangSubtype(p) {
  const d = classifyHolderDetail(p);
  return { dust: d.subtype.dust, big: d.subtype.big };
}

/**
 * Token 级庄散比例 + 庄散加权分聚合（Layer2，评分模块附属数据，不影响 totalScore）。
 * 调用方：web 实时路径（holder-scores API）+ TPA（computeScores 时，将庄散分注入 holdingFactors）。
 * 落库边界：retailPct/zhuangPct/ratio/balance 等比例与均衡度不落库（web 实时附属）；
 *   庄散分（zhuangScore/retailScore/minZR/gapZR 等）经 TPA 注入 holdingFactors 会随其落库。
 * @param {Array<{floatPct:number, score?:number, tokenCount?, rawTotal?, lowTinyRatio?, buckets?, earlyLargeBuyCount?, buyCount?}>} scoredHolders
 *   每项带 floatPct + score（已评分）+ profile 画像字段（web 从 scoreHolderAtDecisionTime().profile 补拍）。holder=null/floatPct<=0/score=null 跳过。
 * @returns {{retailPct,newWalletPct,zhuangPct,neutralPct,zhuangDustPct,zhuangBigPct,ratio,balance,holderCount,
 *   zhuangScore,retailScore,newWalletScore,neutralScore,minZR,gapZR,
 *   zhuangScoredCount,retailScoredCount,newWalletScoredCount,neutralScoredCount}}
 *   庄散分 = 桶内 floatPct 加权均分（Σscore×fp/Σfp，0-5，与 holder score 同量纲，区别于 tokenScore 的 Σscore×fp/100 聚合分）；
 *   minZR=min(庄,散)、gapZR=庄-散（两者均非 null 才有值）。各桶 scoredCount 为评分样本数（诊断用）。
 */
function computeZhuangRetail(scoredHolders) {
  const acc = { retail: 0, new_wallet: 0, zhuang: 0, neutral: 0 };
  // 桶内加权评分累加：{wSum: Σ(score×floatPct), w: ΣfloatPct, cnt: 评分样本数}
  const scoreAcc = {
    retail: { wSum: 0, w: 0, cnt: 0 }, new_wallet: { wSum: 0, w: 0, cnt: 0 },
    zhuang: { wSum: 0, w: 0, cnt: 0 }, neutral: { wSum: 0, w: 0, cnt: 0 },
  };
  let zhuangDust = 0, zhuangBig = 0, holderCount = 0;
  for (const h of (scoredHolders || [])) {
    if (h == null) continue;
    const fp = +(h.floatPct || 0);
    if (fp <= 0) continue;
    if (h.score == null) continue; // 未评分（无 ticks/失败，无 profile 字段）跳过，避免误判 new_wallet
    holderCount++;
    const bucket = classifyHolder(h);
    acc[bucket] += fp;
    const sc = scoreAcc[bucket];
    sc.wSum += h.score * fp; sc.w += fp; sc.cnt++;
    if (bucket === 'zhuang') {
      const sub = zhuangSubtype(h);
      if (sub.dust) zhuangDust += fp;
      if (sub.big) zhuangBig += fp;
    }
  }
  const sum = acc.retail + acc.new_wallet + acc.zhuang + acc.neutral;
  const pct = v => sum > 0 ? Number((v / sum * 100).toFixed(2)) : 0;
  // 桶内 floatPct 加权均分（Σscore×fp/Σfp，0-5）；桶内无评分 holder → null。
  const wavg = b => (b && b.w > 0) ? Number((b.wSum / b.w).toFixed(3)) : null;
  const zhuangScore = wavg(scoreAcc.zhuang);
  const retailScore = wavg(scoreAcc.retail);
  const minZR = (zhuangScore != null && retailScore != null) ? Number(Math.min(zhuangScore, retailScore).toFixed(3)) : null;
  const gapZR = (zhuangScore != null && retailScore != null) ? Number((zhuangScore - retailScore).toFixed(3)) : null; // 正=大户分高于散户
  return {
    retailPct: pct(acc.retail),
    newWalletPct: pct(acc.new_wallet),
    zhuangPct: pct(acc.zhuang),
    neutralPct: pct(acc.neutral),
    zhuangDustPct: pct(zhuangDust),
    zhuangBigPct: pct(zhuangBig),
    ratio: Number((acc.zhuang / Math.max(acc.retail, 0.01)).toFixed(2)),       // 庄/散比（≈1 均衡，>1 庄多）
    balance: Number((1 - Math.abs(acc.retail - acc.zhuang) / (acc.retail + acc.zhuang + 0.01)).toFixed(3)), // 0-1 均衡度
    holderCount,
    // 庄散加权分（floatPct 加权均分，0-5）
    zhuangScore, retailScore, newWalletScore: wavg(scoreAcc.new_wallet), neutralScore: wavg(scoreAcc.neutral),
    minZR,         // min(大户分, 散分)，两者均非 null 才有值；预测力最强（母版极差 +11%）
    gapZR,         // 大户分 - 散分；正=大户分高于散户
    zhuangScoredCount: scoreAcc.zhuang.cnt, retailScoredCount: scoreAcc.retail.cnt,
    newWalletScoredCount: scoreAcc.new_wallet.cnt, neutralScoredCount: scoreAcc.neutral.cnt,
  };
}

/**
 * 庄散比（verdict 决策口径）：(大户+新钱包)/散户。单一真相源，供 TPA _analyze 注入 holdingFactors +
 * _decideVerdictZhuangScore verdict + PositionAnalysisService 落表读取三处共用，根治 ratio 公式分叉。
 * 注意：与 computeZhuangRetail.ratio（庄/散，上文）不同——verdict 用 (庄+新)/散（TokenPositionAnalyzer 原口径）。
 * @param {Object} zr computeZhuangRetail 的返回
 * @returns {number|null|Infinity} 散户=0 → ∞（大户+新绝对主导，视为满足）；无庄散数据 → null
 */
function computeZhuangRetailRatio(zr) {
  if (!zr || (zr.holderCount ?? 0) <= 0) return null;
  const retail = zr.retailPct ?? 0;
  const zhuangNew = (zr.zhuangPct ?? 0) + (zr.newWalletPct ?? 0);
  return retail > 0 ? zhuangNew / retail : Infinity;
}

/**
 * v1 策略：四维度（volume/avg/bad/hold）+ 无数据降级 + 恶意 cap + 低交易额 cap。
 */
function scoreV1(profile, opts) {
  const p = opts.params;

  // 降级（fetch 失败/无 raw 统计量，scoreFallback=true）：直接走固定 fallbackScore（无数据不奖不罚的中高分）。
  if (profile.scoreFallback) {
    return {
      score: Number(p.fallbackScore.toFixed(3)),
      breakdown: {
        volume: { raw: null, score: null, fallback: true },
        avg: { raw: null, score: null, fallback: true },
        bad: { raw: null, score: 1.0, exempt: true, fallback: true },
        hold: { raw: null, score: 0, exempt: true, fallback: true },
        totalBeforeCap: Number(p.fallbackScore.toFixed(3)),
      },
      approx: true,
      fallback: true,
      version: 'v1',
      strategy: 'v1',
    };
  }

  const totalBnb = profile.totalBnb || 0;
  const avgBnb = profile.avgBnb || 0;

  // 维度1 volume：累计 BNB 交易额（log-linear 饱和，封顶 2.0）。"背书够用"即饱和——不鼓励也不惩罚大交易额。
  //   交易额巨大且持仓久的钱包（哪怕高频）依然可拿满分（vol2+avg2+hold0.25=4.5，bad 不再加分）。
  const dim1 = _volumeScore(totalBnb, p);

  // 维度2 avg（★聚合口径：连续同向 <AVG_AGG_GAP_MS[5s] 合并为 1 意图后的平均交易额，见 wallet-profile-builder；
  //   分批扫单大户[同 token 连续多笔拆单]不再被逐笔口径误判 dust）—— log-linear 连续映射
  const dim2 = _avgBnbScore(avgBnb, p);

  // 维度3 bad：靶向率口径 effBadRatio = (badBuy+badSell)/(earlyBuy+crashSell) 汇总（buy/sell 合并）
  //   - badBuy = 早期大额快速买入恶意类（age<3s+≥1.0BNB，cat∈BAD_BUY_CATEGORIES）；earlyBuy = 同条件不分 cat（分母）
  //   - badSell = 闪崩期大额集中抛售 wash 类（闪崩段+≥2.0BNB，cat∈BAD_SELL_CATEGORIES）；crashSell = 同条件不分 cat（分母）
  //   ★汇总而非 max(buyRatio,sellRatio)：sell 候选稀少(闪崩段≥2.0BNB 门槛高)致 badSellRatio 小样本不稳（如 5/5=1.0 偶发），
  //     max 会被偶发高 sellRatio 主导（母版 case 8T9ychy4: buy48%/sell100%→max=1.0 触发 severe cap，但整体恶意仅 50%）。
  //     汇总分母=buy+sell 变大、方差降，反映整体恶意占比（8T9ychy4→53/105=0.505）。
  //   可信门 hasDenom=任一侧候选≥minXxx（保留双侧护栏）；完全无候选→该维豁免。单侧 ratio 仅留作诊断/side 判定。
  // ★bad 维【只降不加分】（母版 2026-08-05，用户指令"bad action 只用于降分，不用于加分"）：
  //   dim3 恒 0——"无 bad_action"不再奖励清白分（旧 dim3 对低靶向率给 1.0 满分=变相加分）。
  //   降分完全由下方恶意 cap（_maliciousCeiling，靶向率越高总分上限越低）承担。effBadRatio/hasDenom 仍需计算供 cap。
  let dim3 = 0;
  let badExempt = false;
  const earlyBuy = profile.earlyLargeBuyCount || 0;
  const crashSell = profile.crashLargeSellCount || 0;
  const buyRatioOk = earlyBuy >= p.minEarlyBuyForPenalty;
  const sellRatioOk = crashSell >= p.minCrashSellForPenalty;
  const buyRatio = buyRatioOk ? (profile.badBuyRatio || 0) : 0;   // 单侧（诊断+side 判定）
  const sellRatio = sellRatioOk ? (profile.badSellRatio || 0) : 0;
  const hasDenom = buyRatioOk || sellRatioOk;
  const totalCand = earlyBuy + crashSell;                          // 汇总候选分母
  const totalBad = (profile.badBuyCount || 0) + (profile.badSellCount || 0);  // 汇总恶意分子
  const effBadRatio = (hasDenom && totalCand > 0) ? totalBad / totalCand : 0;
  if (!hasDenom) {
    badExempt = true; // 完全无候选（无早期大额买入/闪崩集中抛售）→ 无操纵能力信号 → cap 不触发（dim3 已 0，不再豁免送分）
  }

  // 维度4 hold：flat 0.25 不奖不罚（母版 2026-08-19 用户拍板「持仓时间短不能作为钱包的惩罚标准，快速
  //   sniper 本身无害；TPA 核心目的=检测恶意大户」）。medianHold 仍取出供 breakdown 展示（不进评分）。
  const medianHold = profile.medianHoldSeconds ?? null;
  const dim4 = p.holdFlatScore;

  const totalBeforeCap = dim1 + dim2 + dim3 + dim4;

  let total = totalBeforeCap;

  // 恶意惩罚 modifier（连续降分曲线）= bad 维【唯一的降分机制】（dim3 已恒 0 不加分）：靶向率极高的钱包危害最大——
  // 高 volume/avg 的恶意大户，资金投入是作恶弹药而非诚信信号 → 总分 hard cap 到 _maliciousCeiling(effBadRatio)。
  // 候选门 hasDenom 已在 bad 维算（候选≥1 即施罚）。分段线性插值档间连续降分（0.61≠0.79），锚点 0.6/0.8/0.95 已 ×0.8 到 4.0 制。
  let maliciousCapApplied = false;
  let maliciousCapReason = null;
  let maliciousCapSide = null;
  let maliciousCeilingVal = null; // 连续 ceiling（ratio≥badRatioMidPenalty 时非 null；applied 仅当 total>ceiling）
  // ★大户偶发豁免（母版 2026-08-06，6EDaVs/6LZFEakt 案）：靶向率在小分母(earlyLargeBuyCount 极少)下方差极大不可信——
  //   真实大户(交易基数大)+整体交易脏度极低(偶发,>0.4BNB有效交易分母)→ 跳过恶意 cap（仅此 cap，
  //   lowVol 照常取 min）。不区分 buy/sell（sell 偶发也算偶然）。
  //   系统性作恶大户(脏度高)/小户(基数不足)均不豁免。
  let incidentalExempt = false;
  let incidentalExemptDetail = null;
  if (hasDenom && effBadRatio >= p.badRatioMidPenalty) { // 仅本来要触发 cap 才考虑豁免（<0.6 本就不罚）
    const tokenCount = profile.tokenCount ?? profile.rawTotal ?? 0;
    const effectiveTradeCount = profile.effectiveTradeCount || 0; // ≥0.4BNB 有效交易笔数（比 largeTradeCount[≥1.0BNB] 宽，含 0.4-1.0BNB，排除 dust）
    const overallBadRatio = effectiveTradeCount > 0 ? (profile.badCount14d || 0) / effectiveTradeCount : 0;
    // 真实大户：代币多 + 累计额大 + 有效交易笔数足（样本足才可信脏度比例；防 dust 刷量 effectiveTradeCount=0 脏度算0误豁免）
    const isLargeTrader = tokenCount >= p.exemptTokenCountMin && totalBnb >= p.exemptTotalBnbMin && effectiveTradeCount >= p.exemptEffectiveTradeMin;
    const isIncidental = overallBadRatio <= p.exemptBadRatioMax; // 比例门：badCount14d/effectiveTradeCount（>0.4BNB 有效交易分母，自适应操作规模）
    // ★靶率上限（母版 2026-08-25 用户拍板）：effBadRatio ≥ exemptEffBadRatioMax 不豁免——「偶发」语义修正：
    //   偶发=低频，不是高靶率。tok≥400 且靶向率≥0.8 的大钱包=专项异常户（大额早期买入几乎全在异常票上，
    //   正常小额交易把整体脏度冲淡到 3% 以下）。母版 08-23 审计实证：24678Q 0.90/13544tok、Anubis 0.92/1871tok、
    //   4Ht2 三人组 1.00/406-408tok、EaVboaPx/AxUfULyB 1.00——全部靠豁免拿 3.2-3.6 分。
    if (isLargeTrader && isIncidental && effBadRatio < p.exemptEffBadRatioMax) {
      incidentalExempt = true;
      maliciousCapReason = 'incidental_exempt';
      incidentalExemptDetail = {
        tokenCount, totalBnb: Number(totalBnb.toFixed(2)), effectiveTradeCount,
        overallBadRatio: Number(overallBadRatio.toFixed(4)), badCount14d: profile.badCount14d || 0,
        badBuyCount: profile.badBuyCount || 0, badSellCount: profile.badSellCount || 0,
        effBadRatio: Number(effBadRatio.toFixed(4)), totalCand, totalBad,
      };
    }
  }
  if (hasDenom && !incidentalExempt) {
    maliciousCeilingVal = _maliciousCeiling(effBadRatio, p);
    if (maliciousCeilingVal != null) {
      if (total > maliciousCeilingVal) { total = maliciousCeilingVal; maliciousCapApplied = true; }
      // 粗档标签（命中的锚点区间，仅前端展示用；实际 ceiling 见 capValue）
      maliciousCapReason = effBadRatio >= p.badRatioSevere ? 'severe'
        : effBadRatio >= p.badRatioHigh ? 'high'
        : effBadRatio >= p.badRatioMidPenalty ? 'mid' : 'ramp';
      maliciousCapSide = (buyRatio >= sellRatio) ? 'buy' : 'sell';
    }
  }

  // ★独立 low-level 补充 cap（baseline badExempt 漏掉的小额早期快速买入钱包；母版 2026-08-11 接入）：
  //   baseline 恶意 cap 靠 ≥1.0BNB 早期买入分母，badExempt(无大额早期买入)钱包完全逃过 → low-level 降阈 0.6BNB 补回。
  //   仅 badExempt 触发（baseline 已 cap 的不重复压=纯补充非重复）；误伤面天然受限（tokenScore floatPct 加权，
  //   高持仓子集 winRate 1.2%）。复用大户偶发豁免（badExempt 钱包独立判，同校准口径）。
  //   口径：llCand=buy['0.6'].early+sell['1'].crash(候选分母)；llBad=buy['0.6'].bad+sell['1'].bad(恶意分子)；
  //   llEff=llBad/llCand。badExempt 钱包 baseline 分母=0 → 仅 low-level 能抓其小额早期买入。
  let lowLevelCapApplied = false;
  let lowLevelCapDetail = null;
  let llEff = 0, llCand = 0; // 提升作用域：下方 lltlExtended 扩展档复用（不依赖 badExempt）
  const ll = profile.lowLevelBadAction;
  if (ll) {
    const llEarly = (ll.buy && ll.buy['0.6'] && ll.buy['0.6'].early) || 0;
    const llCrash = (ll.sell && ll.sell['1'] && ll.sell['1'].crash) || 0;
    const llBad = ((ll.buy && ll.buy['0.6'] && ll.buy['0.6'].bad) || 0) + ((ll.sell && ll.sell['1'] && ll.sell['1'].bad) || 0);
    llCand = llEarly + llCrash;
    llEff = llCand > 0 ? llBad / llCand : 0;
    if (badExempt && llCand >= p.llCandThreshold && llEff >= p.llSevereThreshold) {
      // 大户偶发豁免（badExempt 钱包 baseline 不判 incidental，此处独立判，同 _ana_lowlevel_independent_cap 口径）
      const _tc = profile.tokenCount ?? profile.rawTotal ?? 0;
      const _etc = profile.effectiveTradeCount || 0;
      const _obr = _etc > 0 ? (profile.badCount14d || 0) / _etc : 0;
      const _isLargeTrader = _tc >= p.exemptTokenCountMin && totalBnb >= p.exemptTotalBnbMin && _etc >= p.exemptEffectiveTradeMin;
      const _isIncidental = _obr <= p.exemptBadRatioMax;
      if (!(_isLargeTrader && _isIncidental) && total > p.llSevereFloor) {
        total = p.llSevereFloor;
        lowLevelCapApplied = true;
        lowLevelCapDetail = { llEff: Number(llEff.toFixed(4)), llCand, llBad, llEarly, llCrash, ceiling: p.llSevereFloor };
      }
    }
  }

  // ★独立 tiny-level 补充 cap（母版 2026-08-20 LOL 卡线军团案；字段链 src/services/tiny-level-bad-action.js）：
  //   0.2/0.2BNB 档低阈值恶意行为（tlCand=buy['0.2'].early+sell['0.2'].crash，分子 tlBad 同口径）。
  //   badExempt 钱包「卡线小额早期买入 + 分片抛售」的唯一拦截层；count 门为主防稀释绕过 +
  //   连续锚点 ceiling（_interpLinear，仿 _maliciousCeiling）；min 语义；复用大户偶发豁免（独立判，同 ll 口径）。
  let tinyLevelCapApplied = false;
  let tinyLevelCapDetail = null;
  let tlEff = 0, tlCand = 0; // 提升作用域：同 ll（计算移出 badExempt 门为纯代码搬移，判定条件不变）
  const tl = profile.tinyLevelBadAction;
  if (tl) {
    const tlEarly = (tl.buy && tl.buy['0.2'] && tl.buy['0.2'].early) || 0;
    const tlCrash = (tl.sell && tl.sell['0.2'] && tl.sell['0.2'].crash) || 0;
    const tlBad = ((tl.buy && tl.buy['0.2'] && tl.buy['0.2'].bad) || 0) + ((tl.sell && tl.sell['0.2'] && tl.sell['0.2'].bad) || 0);
    tlCand = tlEarly + tlCrash;
    tlEff = tlCand > 0 ? tlBad / tlCand : 0;
    if (badExempt && tlCand >= p.tinyLevel.candThreshold && tlEff >= p.tinyLevel.effThreshold) {
      // 大户偶发豁免（badExempt 钱包独立判，同 ll 段口径）
      const _tcT = profile.tokenCount ?? profile.rawTotal ?? 0;
      const _etcT = profile.effectiveTradeCount || 0;
      const _obrT = _etcT > 0 ? (profile.badCount14d || 0) / _etcT : 0;
      const _isLargeTraderT = _tcT >= p.exemptTokenCountMin && totalBnb >= p.exemptTotalBnbMin && _etcT >= p.exemptEffectiveTradeMin;
      const _isIncidentalT = _obrT <= p.exemptBadRatioMax;
      const tlCeil = _interpLinear(tlEff, p.tinyLevel.effAnchors);
      if (tlCeil != null && !(_isLargeTraderT && _isIncidentalT) && total > tlCeil) {
        total = tlCeil;
        tinyLevelCapApplied = true;
        tinyLevelCapDetail = { tlEff: Number(tlEff.toFixed(4)), tlCand, tlBad, tlEarly, tlCrash, ceiling: Number(tlCeil.toFixed(3)) };
      }
    }
  }

  // ★ll/tl 扩展激活档（母版 2026-08-26，见 DEFAULT_PARAMS.lltlExtended 注释；默认 null=本块整体不执行=行为不变）：
  //   镜像反事实口径（母版 _ana_p12_fg10_heavycut S5：R2_exempt_raw+R5_below_ramp 通道 maxEff≥0.6∧maxCand≥10 压 1.2）
  //   —— 激活面排除 R4(effBadRatio≥0.45 偶发豁免带)与 R7(ramp/mid/high 已 cap 段)；ll/tl severe 档已压
  //   （floor 0.4 / tl 连续 ceiling ≤1.5）不重复压（本档 ceiling 1.2 更松或已达标，min 语义天然短路，
  //   !applied 守卫同时保证 breakdown 归因唯一）；不套大户偶发豁免（反事实未豁免，E4EzXdwf 型大户即靶子）。
  let lltlExtCapApplied = false;
  let lltlExtCapDetail = null;
  if (p.lltlExtended && !lowLevelCapApplied && !tinyLevelCapApplied
      && (badExempt || effBadRatio < p.badRatioRampStart)) {
    const extEff = Math.max(llEff, tlEff);
    const extCand = Math.max(llCand, tlCand);
    if (extEff >= p.lltlExtended.effThreshold && extCand >= p.lltlExtended.candThreshold
        && total > p.lltlExtended.ceiling) {
      lltlExtCapDetail = {
        eff: Number(extEff.toFixed(4)), cand: extCand,
        llEff: Number(llEff.toFixed(4)), llCand, tlEff: Number(tlEff.toFixed(4)), tlCand,
        ceiling: p.lltlExtended.ceiling,
      };
      total = p.lltlExtended.ceiling;
      lltlExtCapApplied = true;
    }
  }

  // ★低交易额压制 cap：totalBnb 低=低样本，avg/bad/hold 不可信 → 总分封顶。连续曲线 _lowVolumeCeiling；
  //   min 语义——恶意 cap 已把 total 压更低时不再重复压。
  let lowVolCapApplied = false;
  const lowVolCeilingVal = _lowVolumeCeiling(totalBnb, p);
  if (lowVolCeilingVal != null && total > lowVolCeilingVal) {
    total = lowVolCeilingVal;
    lowVolCapApplied = true;
  }

  // ★Tier2 暴力block集中抛售衰减（multiplier，叠加 cap 链后；双重恶意双罚）。
  //   ratio 主（士兵低频高占比）+ count 辅（专业户反复集中抛售），乘法叠加。
  //   位置：lowVolCap 后、badActionByHuman 前（人工定性 0.5 地板不被算法衰减再压破）。
  const tier2Ratio = profile.tier2Ratio ?? null;
  const tier2Count = profile.tier2CrashBlockSellCount ?? 0;
  const tier2RatioFactor = _tier2RatioFactor(tier2Ratio, p);
  const tier2CountFactorVal = _tier2CountFactor(tier2Count, tier2Ratio, p);
  let tier2Applied = false;
  if (tier2RatioFactor != null) { total *= tier2RatioFactor; tier2Applied = true; }
  if (tier2CountFactorVal != null) { total *= tier2CountFactorVal; tier2Applied = true; }

  // ★人工标注 bad_action_by_human 强制降权 cap（人工定性恶意：集中抛售参与者等；与算法 bad_action[badAction 单一源] 不同源）：
  //   引擎/web 启动时 loadBadActionByHumanSet 加载 wallets.tags 含 'bad_action_by_human' 的地址到模块级 _badActionByHumanSet，
  //   命中则该 holder 总分硬压到 0.5（4.5 满分制下低于所有自动 cap floor[maliciousFloor 0.4-2.4 / lowVol 1.6-2.4]，
  //   等同人工定性恶意 → tokenScore/庄散比降权）。min 语义（已 ≤0.5 不重复压）。
  //   profile.address 由 TPA _computeWalletProfilesBatch 注入；web 路径在 scoreHolderAtDecisionTime 注入（否则 cap 不命中）。
  //   Set=null（未加载/加载失败 fail-open）→ cap 不生效，不阻断交易。
  //   ★母版 09-02 修订（用户拍板）：sniper-like（_isSniperLike，与 classifyHolderDetail 否决同源，creator 豁免含）豁免本 cap——
  //   人工标对象=组织者；跨代币职业快速买入钱包（9999hu 11286 币 0 案底实测）被 cap 0.5 经 tokenScore(top20 浮点加权)
  //   票级放大压塌 69% 历史买点。豁免只跳过本 cap，算法 cap 链(malicious/lowVol/tier2/ll/tl)照常约束。
  //   ⚠️richer-js 现网 wallets 无 bad_action_by_human tags 数据（空集 no-op）；本钩子保留不挂引擎启动加载，
  //   未来启用时再在引擎/web 启动序列接 loadBadActionByHumanSet。
  let badActionByHumanCapApplied = false;
  let badActionByHumanSniperExempt = false;
  if (_badActionByHumanSet && profile.address && _badActionByHumanSet.has(profile.address)) {
    if (_isSniperLike(profile)) {
      badActionByHumanSniperExempt = true;
    } else if (total > 0.5) {
      total = 0.5;
      badActionByHumanCapApplied = true;
    }
  }

  return {
    score: Number(total.toFixed(3)),
    breakdown: {
      volume: { raw: Number(totalBnb.toFixed(4)), score: dim1, sampleApprox: !!profile.sampleApprox },
      avg: { raw: Number(avgBnb.toFixed(4)), score: dim2 },
      bad: {
        raw: effBadRatio,                   // 汇总靶向率 (badBuy+badSell)/(earlyBuy+crashSell)
        score: dim3,
        buyRatio: profile.badBuyRatio ?? null, earlyLargeBuyCount: earlyBuy, badBuyCount: profile.badBuyCount ?? 0,
        sellRatio: profile.badSellRatio ?? null, crashLargeSellCount: crashSell, badSellCount: profile.badSellCount ?? 0,
        totalCand, totalBad,                // 汇总分母/分子（effBadRatio = totalBad/totalCand）
        largeTradeCount: profile.largeTradeCount, effectiveTradeCount: profile.effectiveTradeCount ?? 0, badCount14d: profile.badCount14d,
        exempt: badExempt,
      },
      totalBeforeCap: Number(totalBeforeCap.toFixed(3)),
      hold: { raw: medianHold, score: dim4, flat: true },
      lowVolumeCap: { applied: lowVolCapApplied, ceiling: lowVolCeilingVal != null ? Number(lowVolCeilingVal.toFixed(3)) : null, threshold: p.lowVolThreshold, totalBnb: Number(totalBnb.toFixed(4)) },
      tier2Penalty: { applied: tier2Applied, ratio: tier2Ratio, count: tier2Count, ratioFactor: tier2RatioFactor != null ? Number(tier2RatioFactor.toFixed(3)) : null, countFactor: tier2CountFactorVal != null ? Number(tier2CountFactorVal.toFixed(3)) : null },
      badActionByHumanCap: { applied: badActionByHumanCapApplied, ceiling: 0.5, address: profile.address ?? null, loaded: _badActionByHumanSet != null, sniperExempt: badActionByHumanSniperExempt },
      maliciousCap: { applied: maliciousCapApplied, capValue: maliciousCeilingVal != null ? Number(maliciousCeilingVal.toFixed(3)) : null, reason: maliciousCapReason, side: maliciousCapSide, effBadRatio, totalCand, totalBad, buyRatio, sellRatio, earlyLargeBuyCount: earlyBuy, crashLargeSellCount: crashSell, incidentalExempt, incidentalExemptDetail },
      lowLevelCap: { applied: lowLevelCapApplied, ...(lowLevelCapDetail || { llEff: null, llCand: null, llBad: null, llEarly: null, llCrash: null, ceiling: p.llSevereFloor }) },
      tinyLevelCap: { applied: tinyLevelCapApplied, ...(tinyLevelCapDetail || { tlEff: null, tlCand: null, tlBad: null, tlEarly: null, tlCrash: null, ceiling: null }) },
      lltlExtCap: { applied: lltlExtCapApplied, ...(lltlExtCapDetail || { eff: null, cand: null, llEff: null, llCand: null, tlEff: null, tlCand: null, ceiling: p.lltlExtended ? p.lltlExtended.ceiling : null }) },
    },
    approx: !!profile.sampleApprox,
    fallback: false,
    version: 'v1',
    strategy: 'v1',
  };
}

const STRATEGIES = { v1: scoreV1 };

/**
 * 评分入口。
 * @param {Object} profile _packProfile 产出（含 raw 统计量 + tokenCount/sampleApprox/scoreFallback）
 * @param {Object} [opts] { strategy:'v1', params:{...覆盖 DEFAULT_PARAMS} }
 * @returns {{score, breakdown, approx, fallback, version, strategy}}
 */
function scoreProfile(profile, opts = {}) {
  const strategy = opts.strategy || 'v1';
  const fn = STRATEGIES[strategy];
  if (!fn) throw new Error(`[WalletScorer] unknown strategy: ${strategy}`);
  const mergedOpts = {
    strategy,
    params: { ...DEFAULT_PARAMS, ...(opts.params || {}) },
  };
  return fn(profile, mergedOpts);
}

/**
 * Token 级评分链（聚合 + 低流通惩罚）—— TPA / web / 分析脚本 共用的【唯一链】。
 * 输入【已评分】holders（带 .score + .floatPct），输出 token 总分。不含 per-holder 评分：
 *   per-holder 评分由各调用方自决——TPA=scoreProfile(_computeWalletProfile 产出)；web=scoreHolderAtDecisionTime。
 *
 * ★单一链真相源：未来新增/调整 token 级惩罚步骤（如新 cap）只改本函数，TPA/web 全自动一致，
 *   根治「分析脚本抄一份链 → 改链得手动同步 → web/CSV 分叉」的老问题。
 *
 * 行为对齐：
 *   - totalScoreAll = Σ(score×floatPct/100)，跳过 score==null（web 的 failed holder；TPA 路径 scoreProfile 恒非空不受影响）
 *   - topN/topNMode 由 walletScore 给（'all' 模式下 topN 不影响 totalScore）
 *
 * @param {Array<{score:number|null, floatPct:number, address?:string}>} scoredHolders
 * @param {Object} holdingFactors  仅消费 walletHoldingPct（lowFloat）；其余字段不读
 * @param {Object} walletScore  { topN, topNMode }（TPA=this._walletScore；web 传同结构或默认）
 * @param {Object} [paramsOverride]  实验 walletScore.params 覆盖 DEFAULT_PARAMS
 * @returns {{totalScore,totalScoreAll,totalScoreTopN,penalized,penaltyReason,lowFloat,topN}}
 */
function aggregateTokenScore(scoredHolders, holdingFactors, walletScore = {}, paramsOverride = {}) {
  const mergedParams = { ...DEFAULT_PARAMS, ...(paramsOverride || {}) };
  let totalScoreAll = 0, totalScoreTopN = 0;
  for (const h of scoredHolders) {
    if (h.score == null) continue;
    if ((h.floatPct || 0) > 0) totalScoreAll += h.score * h.floatPct / 100;
  }
  const topRows = [...scoredHolders]
    .filter(h => h.score != null)
    .sort((a, b) => (b.floatPct || 0) - (a.floatPct || 0))
    .slice(0, walletScore.topN)
    .map(h => ({ address: h.address, score: h.score, floatPct: h.floatPct }));
  for (const t of topRows) totalScoreTopN += (t.score || 0) * (t.floatPct || 0) / 100;
  // 集中度惩罚已删（母版 2026-08-19，用户拍板）：TPA 触发交易量要求调小后决策时刻落在开盘几秒，
  //   在场持仓者个位数 → top1/前2/前3 占比天然畸高，三条控盘线几乎必中，退化为「早期盘必罚」系统性误杀。
  const useTop = walletScore.topNMode === 'top';
  const rawScore = useTop ? totalScoreTopN : totalScoreAll;
  // 低流通降权（唯一 token 级惩罚）：walletHoldingPct 偏低 → 温和压到 ceiling
  const lowFloatGate = applyLowFloatPenalty(
    { totalScore: Number(rawScore.toFixed(3)), penalized: false, penaltyReason: null },
    { walletHoldingPct: holdingFactors?.walletHoldingPct },
    mergedParams
  );
  return {
    totalScore: lowFloatGate.totalScore,
    totalScoreAll: Number(totalScoreAll.toFixed(3)),
    totalScoreTopN: Number(totalScoreTopN.toFixed(3)),
    penalized: lowFloatGate.penalized,
    penaltyReason: lowFloatGate.penaltyReason,
    lowFloat: lowFloatGate.lowFloat,
    topN: topRows,
  };
}

/**
 * BSC 新钱包中性分（用户 2026-09-29 裁定）：scoreTokenFromHolders 内非 creator 新钱包
 * （source='realtime' 且 tokenCount<=1）分数低于此值抬到此值（只升不降）。观察期参数，
 * 详见 scoreTokenFromHolders 内注释。creator 维持 1.5 中性分档不动。
 */
const NEW_WALLET_NEUTRAL_SCORE = 2.2;

/**
 * Token 级钱包评分完整入口（per-holder scoreProfile + aggregateTokenScore）—— TPA 决策落库专用。
 * web 用 scoreHolderAtDecisionTime 评分后直接调 aggregateTokenScore（它们不走本函数）。
 * 1:1 等价于 TPA _computeWalletScores 旧内联实现（抽函数纯 refactor，零行为变化；
 * 2026-09-29 起加 BSC 新钱包 2.2 中性分豁免——与母版的用户裁定偏离）。
 * @returns {Object} walletScoreSummary（落 token_position_analyses.holding_factors 附带）
 */
function scoreTokenFromHolders(walletProfiles, holdingFactors, walletScore = {}, paramsOverride = {}) {
  const mergedParams = { ...DEFAULT_PARAMS, ...(paramsOverride || {}) };
  const opts = { strategy: walletScore.strategy, params: mergedParams };
  let scored = 0, sampleApproxCount = 0, fallbackCount = 0;
  for (const p of walletProfiles) {
    const r = scoreProfile(p, opts);
    p.score = r.score;
    p.scoreBreakdown = r.breakdown;
    p.scoreApprox = r.approx;
    p.scoreFallback = r.fallback;
    // 创建者新钱包中性分（母版用户 2026-08-19 拍板，仅创建者）：多数创建者是新钱包，
    // 持仓不好不坏；source='realtime'（无 offline 历史）且 tokenCount<=1（除本币外零历史）
    // → 提到 1.5 中性分（只升不降），替代 volume/avg 双零维度给出的 ~0.24 低分。
    // ⚠️flap creator=工厂共享地址 → 该豁免对 flap 不生效方向=误伤工厂地址（1e9 固定 totalSupply 下
    //   工厂钱包 floatPct 极小，影响可忽略），不加特判。
    if (p.isCreator && p.source === 'realtime' && (p.tokenCount ?? 0) <= 1 && r.score < 1.5) {
      p.score = 1.5;
      p.scoreBreakdown = { ...r.breakdown, creatorNewNeutral: true, scoreBefore: r.score };
    }
    // BSC 新钱包中性分 2.2（用户 2026-09-29 裁定，先观察再定）——★与母版的有意偏离：
    // 母版仅 creator 豁免、一般新钱包维持原判（2026-08-19 FfeDVN2n 四 burner 同秒成簇
    // farm 案，solana 链节奏下低分正确）。BSC 节奏不同（gas 廉价散户新钱包常见 + 单块 3s
    // 装下整簇买入），用户裁定 BSC 先豁免观察：source='realtime' 且 tokenCount<=1
    // （与 creator 门同源同阈值）且非 creator（creator 维持 1.5 档——发币者控盘语义
    // 低半档，不被本门再抬）→ 分数低于 2.2 抬到 2.2（只升不降，与 creator 豁免同向）。
    // 观察期后去留由用户再定；回滚 = 删本块。
    if (!p.isCreator && p.source === 'realtime' && (p.tokenCount ?? 0) <= 1
      && r.score < NEW_WALLET_NEUTRAL_SCORE) {
      p.score = NEW_WALLET_NEUTRAL_SCORE;
      p.scoreBreakdown = { ...r.breakdown, newWalletNeutral: true, scoreBefore: r.score };
    }
    scored++;
    if (r.approx) sampleApproxCount++;
    if (r.fallback) fallbackCount++;
  }
  const agg = aggregateTokenScore(walletProfiles, holdingFactors, walletScore, paramsOverride);
  return {
    ...agg,
    scorerVersion: 'v1',
    strategy: walletScore.strategy,
    topNMode: walletScore.topNMode,
    holderCount: walletProfiles.length,
    scoredHolderCount: scored,
    sampleApproxCount,
    fallbackCount,
  };
}

// ★人工标注 bad_action_by_human 地址集合（模块级单例，避免透传链）：
//   引擎/web 启动时 loadBadActionByHumanSet(supabase) 从 wallets.tags 加载 → Set，scoreV1 命中则 cap 到 0.5。
//   Set=null（未加载/加载失败 fail-open）→ cap 不生效，不阻断交易。
//   与算法 bad_action（wallet_offline_profiles.profile.badAction 单一源）不同源——本集合来自 wallets.tags 人工标注（集中抛售参与者等）。
let _badActionByHumanSet = null;
let _badActionLoadedAt = 0;        // 上次成功加载/显式 set 的时钟（maybeRefresh TTL 判定）
let _badActionRefreshInFlight = false;
const BAD_ACTION_REFRESH_TTL_MS = 60 * 1000;
function setBadActionByHumanSet(set) {
  _badActionByHumanSet = set;
  _badActionLoadedAt = Date.now();
}
/**
 * TTL 后台热刷新 bad_action_by_human 集合（母版 2026-09-01 用户令：打标后立即生效，不再等引擎重启）。
 * 调用方（引擎命令轮询 / web decision 评分路由）周期性 fire-and-forget 本函数：
 * 距上次加载超过 TTL(60s) 才真正重查 wallets.tags，否则同步返回。永不 reject（内部全 catch）。
 * 失败保留旧集合（不置 null，cap 持续生效）并推进时钟退避，避免高频调用方每次都打 DB。
 * BacktestEngine 不调用（回放中滚动吸收外部标签会破坏可复现性，保持启动时快照）。
 * ⚠️richer-js：现网无 tags 数据（空集），本函数暂无调用方——钩子保留，启用时再挂。
 */
async function maybeRefreshBadActionByHumanSet(supabase, ttlMs = BAD_ACTION_REFRESH_TTL_MS) {
  if (!supabase) return false;
  if (Date.now() - _badActionLoadedAt < ttlMs) return false;
  if (_badActionRefreshInFlight) return false;
  _badActionRefreshInFlight = true;
  try {
    await loadBadActionByHumanSet(supabase);
    return true;
  } catch (e) {
    _badActionLoadedAt = Date.now(); // 失败退避一个 TTL 周期，旧集合继续生效
    console.warn(`[WalletScorer] bad_action_by_human 热刷新失败(保留旧集合 ${_badActionByHumanSet ? _badActionByHumanSet.size : 'null'} 个): ${e.message}`);
    return false;
  } finally {
    _badActionRefreshInFlight = false;
  }
}
/**
 * 启动时从 wallets.tags 加载 bad_action_by_human 地址集合到模块级单例（cursor 分页，pageSize 1000，4 次重试）。
 * BSC 过滤（richer-js BSC-only；wallets 有 chain 列，跨链历史行不混入）。
 * supabase 缺省 → Set 置 null（fail-open）。成功返回 Set，供调用方日志。
 */
async function loadBadActionByHumanSet(supabase) {
  if (!supabase) { _badActionByHumanSet = null; return _badActionByHumanSet; }
  const pageSize = 1000;
  let lastId = 0;
  const addresses = [];
  while (true) {
    let data = null, error = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      ({ data, error } = await supabase
        .from('wallets')
        .select('id, address')
        .eq('chain', 'bsc')
        .contains('tags', ['bad_action_by_human'])
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(pageSize));
      if (!error && data) break;
      if (attempt < 4) {
        console.warn(`[WalletScorer] bad_action_by_human 分页查询失败 ${attempt}/4: ${error?.message || error}，重试...`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) addresses.push(row.address);
    lastId = data[data.length - 1].id;
    if (data.length < pageSize) break;
  }
  const set = new Set(addresses);
  setBadActionByHumanSet(set);
  console.log(`[WalletScorer] 加载 bad_action_by_human 钱包集合: ${set.size} 个`);
  return set;
}

module.exports = { scoreProfile, scoreTokenFromHolders, aggregateTokenScore, applyLowFloatPenalty, classifyHolder, classifyHolderDetail, zhuangSubtype, computeZhuangRetail, computeZhuangRetailRatio, STRATEGIES, DEFAULT_PARAMS, NEW_WALLET_NEUTRAL_SCORE, setBadActionByHumanSet, loadBadActionByHumanSet, maybeRefreshBadActionByHumanSet, isSniperLikeProfile: _isSniperLike };
