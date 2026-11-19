'use strict';

/**
 * T143 因子购买前检查门（FACTOR_PREBUY_VERSION='FP1'）——纯代码零 Jev 的最前门
 * （2026-11-15 duanju 0x65aebe91…7777 案立法；用户裁定三件同车：
 * ①BP84 retail_pvp 判定从 Jev market_pattern 题迁入本模块纯代码（「逻辑完全
 *   定死……准确，且不需要燃烧 Jev 的 token」）+ 0.2994 视同 0.3（「本身应该
 *   就是一笔 0.3B 的交易只是支付了 gas」→ 线定 ≥0.29，与 ≥0.19 视同 0.2 的
 *   ±0.01 幅度对齐，落大户参与臂+量维度豁免臂两处；同块捆绑合计 >0.3 不动
 *   ——合计无 gas 贴线）；
 * ②CD408 四条纯数值臂升格独立阻挡门（CD400/CD403/CD405 全票检命中即拒；
 *   CD401 走用户两分法路线 1=burst 认定机械化代理线，预扫描校准不过则该臂
 *   留 cheat 门内）；CD380 wash 臂依赖 Jev washPair 档留 cheat 不迁；
 * ③门链最前（用户裁定「因子门的代价最小，在最前面」）：因子门→cheat 门→
 *   BP 门——被拒票零 Jev 消耗。
 *
 * 输入=buildBuyPointSnapshot 产物（一次拉数同时携带 wallets/buyDerived/
 * cheatDerived——nearDump/burstWaveSeg/burstWaveBundle 锚全在 cheatDerived），
 * 纯函数零 DB 零网络零 Jev；as-of 纪律=只读已截窗 rows，idle 用锚末 tick dt
 * 不用 Date.now（回测回放无前视）。
 *
 * null 语义总则（宁拦不冒充的双向版）：豁免方向的证据缺席→不豁免（更拦）；
 * 拒方向的证据缺席→不拒（证据坐实才拦）——与 mapper「拒=有证据的拒绝」同哲学。
 *
 * 判定树与常量均为单源：cheat 侧 _exemptDeniedReason 四臂线值 import 本文件
 * （cheat 侧行为零改动，豁免收紧语义与全票拦截分层并存——同票双码双留痕）。
 */

// ═══════════════ 常量（单源导出） ═══════════════

// ── T144 活跃度门（BP act 题整题迁入：low+ultra 五桶全代码化，2026-11-15 用户
//    裁定「活跃度低可以全部通过因子表达」——省 cheat 16 题+BP 4 题 Jev/信号；
//    题面七要素+四臂+burst 档的机械翻译，线值=题面明线/代码常量先例） ──
/** L1 大比例无交易期（题面①参考 ≥50；T144 预扫描校准收紧=**极端档联立**：
 * idle ≥60 ∧ 吞吐 <0.5 BNB/min 同时成立才拦——单臂 50 时 Go Brrrrr 39s 蓄势窗
 * 等高 idle 票大量误伤（Newly-blocked +0.45 主源），用户裁定「只过滤极端的
 * 拿得准的情况，不要误伤」） */
const ACT_LOW_IDLE_PCT = 60;
const ACT_LOW_IDLE_THROUGHPUT = 0.5;
/** L2/L5 尘埃线（题面③：买盘中位常见交易档参照 0.05） */
const ACT_DUST_MEDIAN_BNB = 0.05;
/** L2/L4/L5 吞吐死寂线（题面⑤：<1 BNB/分钟=金额死寂） */
const ACT_DEAD_THROUGHPUT_BNB_MIN = 1;
/** L3 单向死水：笔比 ≥5:1 ∧ 额比 ≥3:1 ∧ 回撤 <5% */
const ACT_ONESIDED_BUY_SELL_N = 5;
const ACT_ONESIDED_BUY_SELL_BNB = 3;
const ACT_ONESIDED_MAX_DD_PCT = 5;
/** L3 极早窗反锚：窗 <60s ∧ <30 笔 两腿同时（价格发现期常态） */
const ACT_EARLYWIN_SEC = 60;
const ACT_EARLYWIN_TICKS = 30;
/** L5 全窗四腿联立：密度 <10 笔/分 ∧（idlePct ≥25 或最长空窗 ≥40s） */
const ACT_SPARSE_TPM = 10;
const ACT_SPARSE_IDLE_PCT = 25;
const ACT_SPARSE_MAX_GAP_SEC = 40;
/** B2 尾段激活豁免（题面⑥三段形状明线：尾 5s 买 ≥3 笔 ∧ ≥0.3 BNB） */
const ACT_TAIL5_ACTIVATE_N = 3;
const ACT_TAIL5_ACTIVATE_BNB = 0.3;
/** B1 burst 语境豁免：出口簇买 ≥0.3（CD402 波质量线；背景冷同 T143） */
const ACT_BURST_WAVE_BUY_BNB = 0.3;
/** U1 协同出货臂：末 10s 独立卖钱包 ≥10 ∧ 买入趋零（≤2 笔 ∧ <0.1 BNB——c84a 双边在场防线） */
const ACT_ULTRA_SELL_WALLETS = 10;
const ACT_ULTRA_BUY_N_MAX = 2;
const ACT_ULTRA_BUY_BNB_MAX = 0.1;
/** U2 极端密度臂：≥150 笔/分 ∧ idlePct<5（题面「每秒十笔级」下界；常量 ULTRA_TPM=140 参照） */
const ACT_ULTRA_TPM = 150;
const ACT_ULTRA_IDLE_PCT = 5;

const FACTOR_PREBUY_VERSION = 'FP22'; // FP22=T188 持仓均等作弊仓臂（筹码结构维度二连——2026-11-19 用户裁定「HHI 这么低是作弊票的概率比较高」「这一窗算是持仓均等异常的作弊仓，没有明显误伤，可以落」+同日二修流通腿「只控流动筹码比例高一些的——『不对劲』这种我还想救一救」线值三裁取 16.5：HHI<0.10 ∧ 流通≥16.5 → 拒 even_split_crew 团伙分仓已派发指纹〔四窗验证：拦 11 票 −0.252 大亏全拦〔0x531d/CEPE/DND/低电量/치이카와/Burn〕/救 16 票 +0.473 大肉全保〔不对劲 +131/猫厨师 +55/프론티어 +38/大美 +24〕；键源 cheat-snapshot holderHHI+circSupplyPct→buyDerived.chip；HHI=Σ份额² 对尾部尘埃免疫与基尼互补〕；FP21=T187 持有者打散臂（筹码结构维度立法——2026-11-19 用户裁定「代币已经交易了一段时间，参与者比较多，筹码已经完全打乱形不成主力了」+「通过 top1-2 的集中度把薄肌俱乐部救回来」+「落到因子过滤模块即可」：正净持有者 ≥25 ∧ top1-2 集中度不足 → 拒 holder_scatter，豁免=top1HoldCircPct≥45 ∨ top1Top2HoldCircPct≥60（有主力承接在场——两窗 bt-v155/156 全成交面 16 票 −0.30 止血/误伤 3 正票 +0.109 用户知情接受〔雅迪X5 0x0c959153 realPct+24 但闪跌闪拉真实交易吃不到点位〕；键源 buyDerived.chip〔CD 锚窗口径 posHolderCount/holdingsProfile circPct，D3.35 在场流通分母〕；两窗豁免臂零触发=纯前瞻保护，薄肌 0x51a17dda h=19 天然不进门）；FP20=T167d FP10 豁免换轨：末卖后在外流通谷值≤9%（T167c 10s 冷却线随退役——距锚随时间过线=多信号自愈 bt-v154 实证仅推迟 4s；谷值只随真实卖回下降，出清更深=语义自洽），0x6075 苏琳案二修；FP19=T167c FP10 豁免最短冷却（破发豁免须距 famous 末卖 ≥10s——末卖数秒内深破=砸落进行时非清场完成，0x6075 苏琳案四张真空接刀 −0.149 止血、28ad dist=16s 精确保留豁免，10s 取线留 6s 余量防同型票 dist 浮动误杀 +1.4 级尾部）；FP18=T182 尾部接刀臂（域内崩塌进行时不接刀：拉高过+回低位 ∧ chg5<-5 ∧ chg30<-5 → 拒 tail_dip_knife，bt-v147 0x51d9e360…7777 案研究立法——域腿不可去掉，对照组接刀是肥尾机会）；FP17=T180 首两波大部队×高占比（wave≥8 ∧ dom≥30 不买，0x17b09420…7777 案；首落 ladder v32 后同日用户裁定迁移本模块「放到因子过滤模块吧，不要放到信号触发模块了」——键源 buyDerived.launchSquad 两锚）；FP16=大周期 burst 残局（走过一轮+burst 不买，bt-v147 瓦尔哈案）；FP15=T174b burst 弱波大户合并口径（同块∨同额并为一个钱包，M4GA 案）；T175 N 升格臂同日证伪撤回（见 enableCheatArms 段注释）

// ── FP8a 慢拉卸货臂（2026-11-17 btv140 复审 BP-T024 币安一直都在 0x7e99d2d9…7777
//    案用户裁定：「024 需要挡，它属于涨幅跟量不匹配的票，作弊方自己慢速拉盘然后卸货，
//    你可以看一下它的交易，其实是不正常的，这个可以增加一个独立的因子门」——案形
//    取证：102 分钟窗 0~40min 直线缓推（59 点 R²=0.951 斜率 2.48%/min 边拉几乎零卖）
//    → 45~50min 单段卸货 1.62B（−30%）→ 50~90min 段段纯卖阴跌砸穿 → 95~100min 完全
//    死寂 → 买点=死盘后 3 户 0.53B 的反弹（win120 仅此 3 户、tpm 0.27）。判据四腿：
//    长直线缓推（pumpStablePoints ≥30 ∧ R² ≥0.95=机器缓推痕迹，D3.57 线 15 的两倍
//    =「慢速」）∧ 峰后远端（secSinceAth ≥600s=卸货已发生）∧ 尾声死流量（win120 吞吐
//    <1 BNB/min）。127 票扫描 2 票全负零误伤（T024 −0.020/T096 币安共建 −0.008——
//    后者 FP5 腿1 已拦，本臂独立覆盖同族） ──
const SLOW_PUMP_MIN_POINTS = 30;
const SLOW_PUMP_MIN_R2 = 0.95;
const SLOW_PUMP_MIN_SEC_SINCE_ATH = 600;
const SLOW_PUMP_MAX_TPM120 = 1;

// ── FP8b famous 收割完残局臂（2026-11-17 同日 BP-T025 memes 0x2bef2b61…7777 案
//    用户裁定：「memes 我看了一下，比较典型的 famous 收割完的形态，famous 离场（或者
//    基本离场）并且已经大涨过，这种肯定不能碰，看看怎么控吧」——判据四腿：大涨过
//    （athVsLaunchPct ≥+100%）∧ famous 已离场（famousTraces 自卖比 ≥0.9=卖了九成）∧
//    参与度门槛（占买 ≥10% 防路过型）∧ 已砸落（chg30 ≤−20）。127 票扫描 3 票：
//    memes −0.051/CEPE −0.026 止血 + 鯨 +0.052 误伤（dom=100/自卖比 0.97 与 memes 全轴
//    同形状却赢——同形状不可分，知情代价；鯨同时是 FP6 observe 面 5 票之一）。比 FP6
//    observe（dom 轴）更精确表达「收割完」：自卖比轴从 observe 5 票切出收割完成度
//    最高的 3 张，小树 0.845/XXX 0.768 留观察 ──
const FAM_HARVEST_MIN_ATH_PCT = 100;
const FAM_HARVEST_MIN_SOLD_RATIO = 0.9;
const FAM_HARVEST_MIN_BUY_PCT = 10;
const FAM_HARVEST_MAX_CHG30_PCT = -20;

// ── FP9 famous 系突发波臂（2026-11-17 btv140 复审 BP-T048 TYB 0x21bf04d3…7777
//    案用户裁定：「burst 是纯 famous 带起来的，这种 burst 得阻挡住」）——案形：
//    499s 完全静默 → 1 秒内 3 笔完全等额 0.264B（其一=famous roster 0x20ff…e756，
//    另两笔=同块同额镜像跟单/分仓）+1 笔 0.099 GMGN 路由单 → 拉起 +30%，锚点即
//    波内；cheat 门 A_strong 等额分仓+缓推+尖刺集中 originalGrade=cheat 被
//    activity_high 豁免翻 healthy 放行（撑起 act=high 的流量正是 famous 系这
//    0.891B 自己）→ 止损 −0.036。既有 famous 臂全失明：FP3 分子只计本人不含跟单
//    （占买 14.7%）、FP6 要 chg30≤−20（拉升起点还没砸）、FP8b 要 ath≥100+收割完。
//    判据四腿（键源 buyDerived.famBurstWave——波=CD407 口径最后 ≥30s 静默出口
//    gap<5s 连续簇；famous 系=roster 本人∪同块同额镜像簇）：波贴近锚 ∧ 波买
//    ≥0.3B ∧ famous 系占波买 ≥80% ∧ famous 本人波内首进（发动者，非早就在场
//    持仓者）。127 票扫描精确命中主案 1 票零误伤（次高 Cashless 60.2%+0.064
//    散单参与真实放行）；与 FP6 observe（dom 轴 post-dump）正交：本臂管
//    pre-dump 的进场波 ──
/** FP9 波买下限（BNB）：≥0.3（CD401/CD402 波量级线同源——尘埃波不构成「带起来」） */
const FAM_BURST_MIN_WAVE_BUY_BNB = 0.3;
/** FP9 famous 系占波买下限（%）：≥80（主案 88.9 vs 次高 60.2，分离带 28.7pp） */
const FAM_BURST_MIN_SHARE_PCT = 80;

// ── FP10 famous 低价全清冷却臂（2026-11-17 btv140 复审 BP-T055 Muuchan
//    `0x20574150…7777`/BP-T056 MUCHAN `0x6ac55462…7777` 两信号页案，用户裁定原话
//    「famous 低价全清之后，立马接盘，不是个好策略。famous 低点位卖出，后续一般来讲
//    就跟着砸盘。至少冷却一段时间再说」）——案形取证（182 famousTraces 重放）：
//    T055=famous 0xfb4e…3953 t+93s 买 0.2878B（+39% 入场）→ t+115s 砸 0.2642B
//    （卖在 +21.2%，hold 22s，残仓 0.024）→ 17s 后我们接盘 → 15min −22.3%；T056=
//    famous 0xb4e1e5 t+236s 买 0.2815B（+16%）→ t+266s 全清 0.2802B（卖在 +21%，
//    hold 30s）→ 8s 后接盘 → 5min −16.8%。既有 famous 臂全失明：FP3 二法占卖 ≥20
//    不达（8%/14.3%）+一法要自卖比 <0.7（已清完）、FP8b 要 ath≥100+chg30≤−20
//    （ath 62/39、chg30 −10 双出线）、FP9 要 burst 波语境（非静默后波）。判据五腿
//    （键源 famousTraces 群体退出四键——T167 新直供）：像样参与（群体买 ≥0.2B 绝对额
//    **刻意不用占比门**——T055 占买仅 6.7% 出线，0.2 级=大户参与族同线）∧ 全清
//    （自卖比 ≥0.9 FP8b 同线 ∧ 在场残仓 ≤0.05B BP70 尘埃残仓线）∧ 卖在低价域
//    （末笔卖价较地板发行价 ≤+40%=near_launch 上界，T161 域/位置门 40 同线）∧
//    冷却未满（末笔 famous 卖距锚 ≤120s=「立马接盘」；窗外=冷却完成照常放行）→
//    拒 fam_low_exit_cooldown。127 票边际扫描（对照现行 FP 门放行面 27 famous 票）：
//    拦 4 票净 −0.047——T055 −0.042/T107 漏洞獵人 −0.020 止血 + T029 +0.009/T056
//    +0.006 两张小正票误伤（T056 fwd15m −16.8%=用户「跟着砸盘」点名票本身）；
//    gap 分布全 ≤25s、60/120/300 窗等效取 120；Xilo/小微/食蟹猴（自卖比 0.81~0.83
//    未全清）刻意不拦 ──
/** FP10 像样参与绝对额下限（BNB）：≥0.2（PVP 0.2 级/FP 大户参与族同线；占比门弃用） */
const FAM_LOW_EXIT_MIN_BUY_BNB = 0.2;
/** FP10 全清线①：自卖比 ≥0.9（FP8b FAM_HARVEST_MIN_SOLD_RATIO 同线） */
const FAM_LOW_EXIT_MIN_SOLD_RATIO = 0.9;
/** FP10 全清线②：在场残仓 ≤0.05 BNB（BP70 尘埃残仓线——T055 残 0.0236/T056 0.0012） */
const FAM_LOW_EXIT_MAX_PRESENCE_BNB = 0.05;
/** FP10 低价域线：末笔卖价较地板发行价 ≤+40%（near_launch 上界，T161 域同线） */
const FAM_LOW_EXIT_MAX_VS_PCT = 40;
/** FP10 冷却窗：末笔 famous 卖距锚 ≤120s 内不接盘（「至少冷却一段时间」） */
const FAM_LOW_EXIT_COOLDOWN_SEC = 120;
/** FP10 破发豁免线（T167b，2026-11-17 bt-v143 28ad 案用户裁定「famous 买入后破发豁免
 *  ——破发意味着这个 famous 带来的流量已经基本清场了，之后这一波起来基本不受影响」；
 *  破发锚=盘面跌破 famous 买入价）：群体首买后盘面最低较 famous 加权成本深破 ≥20% →
 *  豁免不拦。定标：28ad 破深 28.8 vs 现行 FP10 四命中票全 ≤14.3（T029 14.3/T055 13.1/
 *  T056 12.4/T107 4.4）分离带 14.5pp 取中偏保守 20；「末卖价低于成本」口径刻意不用
 *  （T055 sellBreach 13.1 ≈ 28ad 11.5 分不开，182 对拍实证）；null 不豁免宁拦不冒充 */
const FAM_LOW_EXIT_BREACH_EXEMPT_PCT = 20;
/** FP10 豁免在外流通谷值线（T167d，2026-11-19 0x6075 苏琳案二修，用户裁定原话
 *  「famous卖出后，最低的在外流通量还剩多少。如果没有多少了，代表抛压彻底清除，
 *  之后的流量算是新一波，所以就可以豁免」）：豁免须末卖后在外流通谷值 ≤9%当时流通
 *  （Σ(BUY−SELL) token 的末卖后最小值÷谷值时刻曲线累计流出）。替代同日 T167c 的
 *  10s 冷却线（距锚随时间单调过线=多信号自愈，bt-v154 端到端实证 0x6075 仅推迟 4s
 *  未阻止成交；谷值只随真实卖回下降，出清更深=语义自洽方向）。定标：豁免面 11 票
 *  谷值分布 8baf 0.0/28ad 2.9/c2af 5.3/d23b 8.5 全正 Σ+1.469 vs 0x6075 10.0/e15f
 *  11.7/f63f 11.7/f73e 11.9/ee83 18.5/0c90 19.0/a035 40.3（6 负 Σ−0.171+1 正
 *  误伤 +0.007）——线取 d23b 8.5 与 0x6075 10.0 gap 中点 9；净止血 +0.164、
 *  28ad 余量 3 倍（2.9 对 9）。null（无 famous 卖行/末卖后零 tick）不豁免宁拦。 */
const FAM_LOW_EXIT_TROUGH_EXEMPT_MAX_PCT = 9;

// ── FP11 famous 早窗快闪双支臂（2026-11-17 bt-v141 复审用户点名两票立法：
//    거침없이 0x288b3aad…7777（−0.0553 全窗最差）/ SI 0x13ccc4b9…7777（−0.0508
//    最差 3），裁定原话「famous 非常早期就上车了，感觉基本无救」「直接立法直接拦吧，
//    当然也看看有没有误伤」）——案形取证（182 famousTraces 重放）：거침없이=famous
//    0xe1e3…9407 t+4s 买 0.23B（+8.7%）→ t+23s 卖清 0.248B（19 秒快闪）+0xef39…55s
//    进 130s 清光，峰值 +33% 落在 +12s（峰=famous 自己打的），53h 尾态 −18%；SI=
//    0xa83b…73 t+7s 买 0.749B（+25.9%）→ 36s 内卖 75%（0.564B）残仓 0.185 挂着，
//    峰 +50%@+48s 买完即峰，尾态 −18%（cheat 原判 cheat 被 activity_high 豁免放行）。
//    既有 famous 臂全失明：FP10 全清双线（卖比 0.9/残仓 0.05B）SI 双出线+거침없이
//    距末卖 193032s 冷却窗外；FP8b 要 ath≥100（两案 69/48）；FP3 一法占卖 ≥20 不达。
//    双支判据（前提三腿：极早入场（二修用户裁定收紧「这次先控极早入场——就是前
//    几个顺位，或者前几秒入场」：首买 groupFirstBuyDt ≤10s ∨ 全盘 BUY 顺位
//    groupFirstBuyRank ≤5；SI 0xe18f 同名票 67s/位 54 出前提放行）∧ 群买 ≥0.2B
//    FP10 同线 ∧ 证据在场）：
//    A 支（砸到一半+大额残仓挂剑）fam_early_flip_partial：自卖比 ≥0.7 ∧ 残仓比
//      （presenceNet/groupBuy）≥0.15——famous 卖了大头但剩 ≥15% 残仓挂着，任何反弹
//      都是它的出货机会（SI 0.247/Xilo 0.188/食蟹猴 0.186）；
//    B 支（清仓走人连底仓不留）fam_early_flip_exit：在场净 ≤0.01B ∧ 自卖比 ≥1.0
//      ——卖光还多卖了利润=纯粹过路收割，票对它已无价值（거침없이 1.111/富个鸟
//      1.344/SI 同名票 1.623 全残仓 0）。
//    btv141 54 成交票全量对拍（famous 早窗参与票 11 张）：双支拦 6 张全负 Σ−0.181
//    零正票误伤；放行 5 张 famous 正票全自然出线（悲伤蛙残仓比 0.072/GIGA 0.041/
//    情书 0.030/不对劲 0.076 全 <0.15 且残仓 >0.01；我画地为牢在场持有 1.07 卖比
//    0.557=famous 仍在场非快闪）——残仓有无=「票还活着」的信号（famous 留底仓=
//      还有参与利益），分离带：残仓比 0.072~0.186（线 0.15）/卖比 0.964~1.111
//      （线 1.0）。知情代价（用户「看看有没有误伤」披露）：ladder 面不对劲早窗 13
//    点（fwd5max +298%）中 B 支——事前视角与 거침없이 同形状不可分，且该批点在
//    现行门链无成交（实际成交锚 famous 买 1.94B 残仓 0.148 不中臂）；富个鸟 2 点
//    （fwd5max +21%）同。臂序挂 FP10 后（低价域+距锚 ≤120s 子集形状 FP10 码更具体
//    先认领） ──
/** FP11 极早入场·秒轴：famous 群体首买距票出生 ≤10s（两案 4s/7s、止血面 4~9s；用户裁定「这次先控极早入场——就是前几个顺位，或者前几秒入场」） */
const FAM_EARLY_FLIP_EARLY_SEC = 10;
/** FP11 极早入场·顺位轴：famous 群体首买=全盘第 ≤5 笔 BUY（SI 0x13cc 位 2/거침없이 位 2；慢速开盘票前 10s 无几笔交易的补充轴，两轴 ∨） */
const FAM_EARLY_FLIP_EARLY_RANK = 5;
/** FP11 像样参与绝对额下限（BNB）：≥0.2（FP10 FAM_LOW_EXIT_MIN_BUY_BNB 同线） */
const FAM_EARLY_FLIP_MIN_BUY_BNB = 0.2;
/** FP11 A 支自卖比线：≥0.7（大头已走；FP3 一法「自卖比 <0.7 还没卖」互补分界） */
const FAM_EARLY_FLIP_A_MIN_SOLD_RATIO = 0.7;
/** FP11 A 支残仓比线：presenceNet/groupBuy ≥0.15（拦面 0.186~0.247 vs 放行面 0.030~0.076） */
const FAM_EARLY_FLIP_A_MIN_PRESENCE_RATIO = 0.15;
/** FP11 B 支残仓绝对额线：在场净 ≤0.01B（清仓走人连底仓不留；BP63 netBnb≤0.005 同族取宽） */
const FAM_EARLY_FLIP_B_MAX_PRESENCE_BNB = 0.01;
/** FP11 B 支自卖比线：≥1.0（卖得比买得多=连利润全带走；放行面最高 0.964） */
const FAM_EARLY_FLIP_B_MIN_SOLD_RATIO = 1.0;

// ── FP18 尾部接刀臂（T182，2026-11-18 bt-v147 0x51d9e360…7777「选择」案触发的
//    研究立法。用户直觉「活跃很久+深跌+性价比位买入应配不同卖出策略（见好就收/
//    不涨快卖）」→ 卖出侧六模拟全否证（现状多卡+stallClose 已近最优：TP/timeout/
//    极速止损在尾部组全输现状，负票 p50 137s 已快出局——亏损根源在买入侧）→ 起涨/
//    死盘事前分离研究（5 实验 428 买点）落地本臂。规律=「尾部域接刀死、早期域
//    接刀活」：买时 5s 动量 3/3 跨窗分离（死盘 p50=0.0% vs 起涨 +2.9%）；域内
//    （拉高过 athVs≥40 ∧ 已回到触发线内 curVs≤28.5）∧ chg5<-5 ∧ chg30<-5（崩塌
//    进行时非插针——dae106 chg30=-1.7 企稳插针 → mx+204/ep+88 被双腿正确放行）
//    → 全量重放命中 43 票 epΣ=-276pp 全负（尾部 8 票 Σ-136/E 组 35 票 Σ-140；
//    正票仅 7 张 +159.8pp 知情代价，最大 935d1464 +57.6）；跨窗 v141/v142/v147
//    3/3 方向一致 + v149 同窗复验三重复现。**域腿是臂的灵魂**：对照组（早期/薄
//    量票）无域接刀全量 epΣ=+295.7 肥尾在场（dae106 +88/40efb3 +86 深针=入场
//    机会）——去掉域腿做全票通用门=砍早期肥尾（act-heat/volume-threshold 胜率
//    否证族镜像）。null 容缺不拦（T143 哲学：拒方向证据缺席） ──
/** FP18 域腿①：锚窗曾拉高 athVsLaunchPct ≥+40%（「活跃过一轮」——对照组早期票 p50=26 出线） */
const TAIL_KNIFE_MIN_ATH_VS_PCT = 40;
/** FP18 域腿②：现价已回到触发线内 currentVsLaunchPct ≤+28.5%（ladder v17+ 价格门/T133 统一门同线） */
const TAIL_KNIFE_MAX_CUR_VS_PCT = 28.5;
/** FP18 刀腿①：买点 5 秒急跌 chg5Pct <-5%（BP59 急跌进行时轴同语义） */
const TAIL_KNIFE_MAX_CHG5_PCT = -5;
/** FP18 刀腿②：30 秒同向 chg30Pct <-5%（崩塌进行时非插针——排除横盘中瞬间深针的 V 型反弹票） */
const TAIL_KNIFE_MAX_CHG30_PCT = -5;

// ── FP6 famous 高控+砸落观察臂（2026-11-17 btv140 复审 BP-T007 小树 0x92598590…7777
//    案用户裁定：「这样吧，这个场景（持有不多还没砸）先不阻挡购买，不过可以在因子
//    过滤这个环节中，把这种情况标记一下（不阻挡过滤），留待之后再寻找方案」——
//    famousDominancePct（famous∪跟单者在场筹码控制度，cheatDerived 筹码口径——与
//    famousTraces 流量口径互补：小树 dom=100% 但本人占买仅 9.6%）≥90 ∧ chg30≤−20
//    （已砸落）→ observe 标记不拦截。btv140 19 票 D 码豁免口袋扫描：该形状 5 票
//    （memes/小树/XXX/CEPE/鯨）止血 4 Σ−0.15 与误伤 1（鯨 +0.052）同形状不可分
//    ——净 −0.099/窗，故先观察攒分布后找分化轴。同批：FP 输出整理为门/值对
//    （gates——用户裁定「跟 Jev 购买前检查模块由各个锚组成门控一样…在信号页面
//    中也要展示各个门的值」） ──
/** 观察臂线：famous∪跟单筹码控制度 ≥90% */
const FAM_DOM_FALL_DOM_PCT = 90;
/** 观察臂线：chg30 ≤−20%（盘面已砸落） */
const FAM_DOM_FALL_CHG30_PCT = -20;

// ── FP3 famous 两法（btv134 复审轮立法，2026-11-16 用户两分法裁定：「第一种，
//    盘面尚未起来，famous 抢跑，如果持有过多，就很危险，它一般会选择砸盘；
//    第二种，盘面已经热了一段时间，有 famous 参与比较多，它（们）已经收割
//    一遍了，然后我们的低价策略在下跌后接到。这两种需要拦住」+追裁定
//    「第二种不仅看占买也看占卖」）。键源=buyDerived.famousTraces（roster v7）
//    + cheatDerived.totalBuyBnb（锚窗总买）+ buyDerived.chg30Pct。
//    61 张 famous 票全量验证（btv134-famous-full）：一法 17 张亏 15 赢 2
//    （Σ−0.31）、二法双门 15 张亏 11 赢 4（净改善 +0.318）；合计净改善 ~+0.46） ──
/** 一法线：自卖比 <70%=在场持有（收割未完成） */
const FAM_HOLDING_SOLD_RATIO = 0.70;
/** 一法线：薄盘=锚窗总买 <3 BNB（盘面尚未起来——famous 是唯一流动性来源） */
const FAM_THIN_TOTAL_BUY_BNB = 3;
/** 一法线：正在砸=chg30 < −15%（持有未卖+深跌=砸盘进行时——6/6 全亏零误伤带） */
const FAM_DUMPING_CHG30_PCT = -15;
/** 二法线：自卖比 ≥70%（收割完成=跌的倒计时，无论当下跌没跌——Kiki/天仔/币安
 *  联盟 chg30 正五票全亏实证） */
const FAM_HARVEST_SOLD_RATIO = 0.70;
/** 二法线：占买 ≥10%（参与度门槛——排除路过型） */
const FAM_HARVEST_BUY_PCT = 10;
/** 二法线：占卖 ≥20%（主杀伤轴：famous 卖出占全盘卖出 1/5+=这轮下跌就是它
 *  砸的；屁屁/鯨/悲伤蛙占卖 14~16% 不达线=盘面自己换手→正确放行） */
const FAM_HARVEST_SELL_PCT = 20;

// ── PVP（BP84 迁入；BP19/BP26/BP55/BP71/BP73/BP79 判据谱系） ──
/** 0.3 视同线（≥0.29；duanju 0.2994 案——±0.01 与 0.19↔0.2 对齐） */
const PVP_TREAT03_BNB = 0.29;
/** 0.2 级线（≥0.19 视同，BP19 既有线不动） */
const PVP_LEVEL02_BNB = 0.19;
/** 同块捆绑合计线（严格 >；BP73——合计无 gas 贴线） */
const PVP_BUNDLE_BNB = 0.3;


// ── CD 四臂升格（CD408；线值=cheat 侧单源，CheatCheckService import 本文件） ──
/** CD400 贴锚砸块零承接：块后承接 < 此 */
const DUMP_NO_ABSORB_BNB = 0.05;
/** CD403 超大量捆绑砸盘承接比臂：达标砸块卖方 ≥ 此（与 BP77 塞单门同线） */
const DUMP_RATIO_MIN_SELLERS = 8;
/** CD403 承接比 < 此（与 BP82「达三成=承接形成」同线） */
const DUMP_LOW_ABSORPTION_RATIO = 0.3;
/** CD405 burst 捆绑收割：去尘捆绑钱包 ≥ 此（单块或相邻两 slot 任一） */
const BURST_BUNDLE_MIN_WALLETS = 7;
// CD412 极端捆绑砸盘独立臂（2026-11-16 btv134 R3 POORNANCE 0x7f25…7777 案用户裁定
// 「按道理如果流量来自正常传播下跌到这个幅度也算好点位，但这个出现了非常严重的捆绑
// 砸盘（异常作弊，散户感觉不会砸这么快）」）：同块独立卖方 ≥15 ∧ 块卖 ≥1 BNB →
// denied 不看承接比（20 个独立卖方本身已构成极端组织性，承接可能是对倒——POORNANCE
// 20 sellers/4.13B/承接比 0.49 被两条既有臂放行）。**破发豁免**（用户裁定「如果下跌
// 到最底部破发，这个作弊行为也被豁免=防止归零后新庄入场」）：launchMinVsFloorPct
// ≤0（经历过破发）→ 不拦。btv134 验证：176 token 唯一命中=主案，零误伤。
const EXTREME_DUMP_MIN_SELLERS = 15;
const EXTREME_DUMP_MIN_BNB = 1;

// ── FP5 尾声延伸活跃度门（2026-11-17 btv140 复审 BP-T013 1105 `0x3fe6ec12…7777`
//    案立法，用户裁定原话：「如果买入点位，是属于『代币曾经充分上涨了』（可以
//    使用代币的上涨幅度/交易总额来标记），那么活跃度要求进行一下延伸，不仅仅
//    是最近的30秒活跃度要求高，买入点位前2分钟，都要求高活跃度。主要是因为，
//    代币到了尾声有些小波动，但是已经完全支撑不起上涨了，除非活跃度持续保持」。
//    案形状：ath +233.7%→距峰 −63.5% 尾声、总成交 47.3 BNB；尾 10s 流量
//    2.35 BNB/min（30s 活跃度判过）但 win120 买入 0.2475 全部集中在最后 30s
//    ——前 90 秒零买入、win120 吞吐 0.42 BNB/min（低于 1 BNB/min 死寂线）。
//    btv140 127 票扫描：命中 3 票（T013/T019/T096，tpm≤0.6）与充分上涨但持续
//    活跃放行面（tpm≥6.1、延伸段买入 ≥4.9 BNB）分离带极宽，线 1↔2/0.1↔0.2
//    不翻动命中面；实现位置=用户裁定「在因子过滤（层）搞」） ──
/** 充分上涨标记线①：锚窗最高较发行价 ≥+100%（曾到 2 倍） */
const TAIL_ATH_VS_LAUNCH_PCT = 100;
/** 充分上涨标记线②：锚窗总成交额 ≥20 BNB（与 BP78 dump 豁免「交易了比较久」同线） */
const TAIL_TOTAL_VOLUME_BNB = 20;
/** 延伸活跃腿1线：win120 整体吞吐 <1 BNB/min（CD 死寂线同源） */
const TAIL_WIN120_TPM_BNB = 1;
/** 延伸活跃腿2线：前 90s 延伸段买入（win120BuyBnb−win30BuyBnb）<0.1（尘埃级
 *  ——买入只发生在最后 30s=小波动，30s 前无人在买） */
const TAIL_EXT_BUY_BNB = 0.1;
/** 延伸活跃腿3线（FP7，2026-11-17 btv140 复审 BP-T009 猴子币 0xd827bc26…7777 案
 *  用户裁定：「不要接『已经交易了很久，盘子整体已经到了末尾』的情况，未起来/小波
 *  一次的票都可以，但是这种已经经历了大涨/丰富交易的票，不可抄底（我们抄底的
 *  点位，基本上是走向灭亡的点位）」——minVsLaunchPct（锚窗涨起后最低价较发行
 *  价 %）≤3=大涨+丰富交易后**砸穿过/贴近发行价**（灭亡确认），活跃持续不救
 *  （猴子币 win120 131 笔/min/85 买家=砸盘流量自身制造的高活跃）。127 票扫描：
 *  ath≥100∧vol≥20∧minVs≤3 面 4 票全负 Σ−0.045 零误伤（猴子币/币安兄弟/币安共建/
 *  Echo——后两张 FP5 腿1 已拦）；vsAth 深回撤轴（≤−50/−60）误伤 GCB +0.032
 *  （回落深但未砸穿发行价=还有救）——「砸穿发行价」才是走向灭亡的精确操作化；
 *  分离带：命中面 max 0.3 vs 正票最近 5.9（GIGA +0.031），取 3 中偏保守） */
const TAIL_BROKE_FLOOR_PCT = 3;

// ── CD414 短窗持续密集砸盘臂（FP7，2026-11-17 btv140 复审 BP-T009 猴子币
//    0xd827bc26…7777 案用户裁定）：「这个票出现了捆绑密集砸盘，是非常明显的
//    作弊了，出现这种现象的票，也要挡住」+判据澄清「异常是这十几秒综合体现的，
//    所以这个感觉是一个持续稍微长时间段的，密集砸盘」——案形：锚前 15 秒
//    **54 笔卖出 3.73 BNB/47 个独立卖钱包**（买侧仅 0.44），含同组 5 钱包连续
//    两块等衰减序列（0.0574→0.0556→0.0539…程序化分仓抛售）+单块 5 笔 0.13~0.19
//    级齐砸。判据=**win30 持续段综合**：独立卖钱包 ≥15 ∧ 卖出 ≥2 BNB ∧ 净流
//    ≤−1.5 BNB（散户不可能 30 秒内十几个钱包协调砸出净 1.5B+ 卖压）。
//    127 票扫描：5 票（猴子币 48/3.76/−3.2、币安兄弟 45/9.7/−2.6、XXX 27/2.6/
//    −1.6、MEOW 16/2.7/−1.8、鯨 22/2.3/−1.8）——**排除 FP6 observe 命中票**
//    （XXX/鯨=上轮「famous 高控+砸落先不阻挡购买」裁定面，两轴正交各管各的）：
//    实拦 3 票全负 Σ−0.056 零新误伤。与 CD412（单块 ≥15 户极端）正交：本臂看
//    持续段协同、不看单块不看承接 ──
const DENSE_DUMP_MIN_SELLERS = 15;
const DENSE_DUMP_MIN_SELL_BNB = 2;
const DENSE_DUMP_MAX_NET_BNB = -1.5;

// ── CD401 sbw 机械化代理线（用户两分法路线 1；预扫描校准点） ──
/** 波贴近锚：出口波末笔距今 ≤ 此秒（「当下事件」非历史遗迹） */
const SBW_PROXY_WAVE_NEAR_SEC = 60;
/** 波钱包中位尘埃线（sbw 主体判轴=沉积后小散涌入） */
const SBW_PROXY_MEDIAN_DUST_BNB = 0.05;

// ── FP13 burst 弱波拦截线（T174，2026-11-18 burst 复审立法，用户裁定「落线A」；
//    **FP15/T174b 二修（2026-11-18 bt-v144 M4GA 0xba5ed45b…e444 案）**：波内大户
//    计数改**合并口径**——「同块捆绑 ∨ 同额」的钱包视为一个钱包（T172 同族，
//    用户裁定原话「burst 中钱包购买是捆绑或者同额，视为一个钱包。这样这个可以
//    豁免无大户」）；M4GA=CD420 豁免票（锚后 +730%）被首版逐户计数误拦（frenzy
//    波 0.02~0.04 级杂单堆起、逐户无一大户、合并后单实体 0.3B+）。口径在
//    snapshot 侧 burstWaveQuality（whaleWallets/whaleMergedGroups，并查集聚合）。
//    burst 三维度分析：大户轴单调（0/1/≥2 → 均 +0.013/+0.012/+0.037）、压箱轴单调
//    （<1B/1~3B/≥3B → 均 +0.015/+0.021/+0.023）、波涨幅/出口位置中性。线=两轴
//    **联立**：波内无 ≥0.15 大户 ∧ 出口前压箱 <1B=「既无大户认可又无交易沉淀」
//    的空波 → 拒 burst_weak_wave。用户追问「或」口径否证：单轴命中组均 +0.030~
//    +0.034（Cashless 3 户+184%/给币安的一封情书 压箱 4.9B+43%）——或口径拦 40
//    票误伤全部利润主力，两轴互补证据非独立风险。经济口径（用户裁定净收益 ≤5%
//    计损——手续费滑点高昂）：联立面 16 票账面 +0.012/净胜仅 3/13 计损，扣磨损
//    真实价值 ≈−0.15 该拦；误伤 3 张小正票（프론티어+38%/duanju+14.7%/野猪ins
//    +6.8%）知情接受。键源 buyDerived.burstWaveQuality（T174 直供三键）；无 ≥30s
//    静默段整体 null=非 burst 语境不拦（宁不拦——拒方向证据缺席） ──
/** FP13 压箱额线（BNB）：出口前锚窗累计买入 <此=薄盘空波（复审 <1B/≥1B 分档线） */
const BURST_WEAK_PRE_WAVE_BNB = 1;
/** FP13 波内大户判定线（BNB）：单钱包波窗买合计 ≥此=大户在场（snapshot 侧
 * BP_BURST_WHALE_BNB=0.15 计算口径；此处仅文档线，whaleWallets 计数在 snapshot） */

// ── FP16 大周期 burst 残局（2026-11-18 用户裁定「已经走过一轮比较大生命周期的
//    代币，不买 burst」，bt-v147 瓦尔哈 0x5fb747c6…7777 案）：票 18.6min 走完主
//    周期（ATH +138% 地板口径/总量 17.63B/57 买入钱包）→ 静默 343s → 14s burst
//    波（12 笔买 0.70B/5 笔卖 0.55B，仅 5 钱包）→ RL15 臂触发（T139 滚动地板
//    溶解价格门：一路阴跌票滚动最低≡现价 → launch 地板随现价下移 → curVs 恒 0）
//    → AF1 act=high∧sbw=burst high_skip 跳 cheat → BP 全过（act 题第五档 burst
//    不拦 BP54）→ 买入后 95s 断流 stallClose 逃生。现行体系无任何一层以「生命
//    周期已完成」为输入——FP5 尾声门四证据中三全中唯总额 17.63<20B 差 2.37B
//    漏网、CD401 卖压 44.6% 过线但 sbw 代理中位尘埃腿（波内 0.1 级）不成立。
//    三腿联立：ATH 相对发行价 ≥+100%（用户原话「上涨超过一倍」）∧ 锚窗总额
//    ≥15B（「交易量也够」，本案 17.63 锚定；FP5 线 20 拦不住本案）∧ burst 结构
//    在场（最后静默段 ≥30s ∧ 波贴近锚 ≤60s ∧ 波买 ≥0.3B——CD401 结构前提去
//    中位尘埃腿：大周期票的 burst 波可以有非尘埃钱包，正是本案被 CD401 放过的
//    原因）；深破豁免 launchMinVsFloorPct < -10（G1 五连收线同线，保 ASTER
//    −38%/28ad 类真重启票——本案浅破 -5.6 照拦）──
/** 生命周期门：ATH 相对发行价 ≥+100%「涨超一倍」 */
const LIFECYCLE_MIN_ATH_PCT = 100;
/** 生命周期门：锚窗总成交额（BNB）——本案 17.63 锚定（FP5 尾声门 20 线差 2.37B 漏网） */
const LIFECYCLE_MIN_TOTAL_VOLUME_BNB = 15;
/** burst 结构前提：最后静默段时长（CD406 BURST_STALL_GAP_SEC 同线） */
const LIFECYCLE_BURST_STALL_GAP_SEC = 30;
/** 深破豁免线：launchMinVsFloorPct < 此值放行（G1 五连收线同线；豁免证据缺席不豁免） */
const LIFECYCLE_BURST_EXEMPT_FLOOR_PCT = -10;

// ═══════════════ retail_pvp 判定（BP84 二修：纯买入侧极简口径） ═══════════════

/**
 * retail_pvp 纯代码判定（BP84 从 Jev market_pattern ②桶迁入）。
 * **二修（2026-11-15 用户裁定「pvp 盘的检测，不是只看买入侧，不看持有吗。
 * 为何搞这么复杂」）**：判定=买入侧有无像样买方，**买入过就算**——不看持有/
 * 在场/卖压/承接（首版承接轴 bigHolderSellBnb60 与 absorb 族与在场三分全删——
 * Go Brrrrr 案 39 秒蓄势静默被「持有+承接归零=死盘」误伤；承接/卖压语义本
 * 就属盘面其它门不管 PVP）。像样买方三口径任一在场即不落 PVP：
 * （单笔 ≥0.19（0.2 级视同）钱包 ≥2 个）∨（单笔 ≥0.29（0.3 视同，duanju
 * 0.2994 案）≥1 笔）∨（同 block 捆绑买入合计 >0.3——BP73 组织性买入）。
 * @returns {{hit:number, branch:string|null, reason:string|null, trace:object}}
 */
function judgeRetailPvp(snapshot) {
  const wallets = snapshot.wallets || [];
  const bd = snapshot.buyDerived || {};
  const bigSingles = wallets.filter((w) => (w.maxBuyBnb || 0) >= PVP_LEVEL02_BNB);
  const act30 = bigSingles.filter((w) => (w.maxBuyBnb || 0) >= PVP_TREAT03_BNB).length;
  const volBundledBnb = bd.bundledBlock ? bd.bundledBlock.buyBnb : null;
  const trace = { act20: bigSingles.length, act30, volBundledBnb };
  const pass = bigSingles.length >= 2 || act30 >= 1
    || (volBundledBnb !== null && volBundledBnb > PVP_BUNDLE_BNB);
  if (pass) return { hit: 0, branch: 'big_buyers_present', reason: null, trace };
  return { hit: 1, branch: 'pvp_no_big_participation', reason: 'pvp_no_big_participation', trace };
}

// ═══════════════ 活跃度门（T144：BP act 题整题迁入——low+ultra 全代码化） ═══════════════

/**
 * 活跃度判定（BP act 题五桶的机械翻译：low/ultra 拦，null=正常域不拦）。
 * 键源：buyDerived.activity 嵌套 24 键（含 BP 自算 nearTail10BuyN/BuyBnb）+
 * cheatDerived 扁平（totalBuyBnb/totalSellBnb/buyN/sellN/burstWaveSegBuyBnb）。
 * 判序：先 B1/B2 豁免（burst 语境/尾段激活）再评 low；ultra 独立评（两臂）。
 * null 容缺：关键锚缺失该臂不触发（宁不拦——拒方向证据缺席，T143 同哲学）。
 * 题面判读谱系：①idlePct≥50 ③⑤尘埃+死寂 ④单向死水（极早窗反锚）⑦临近死寂臂
 * 综合锚四腿联立 ⑥反锚（尾段行明线）burst 输入桶（T143 机械化替代）。
 */
function judgeActivityLevel(snapshot) {
  const act = (snapshot.buyDerived && snapshot.buyDerived.activity) || {};
  const cd = snapshot.cheatDerived || {};
  const trace = {
    idlePct: act.idlePct ?? null, ticksPerMin: act.ticksPerMin ?? null,
    buyMedianBnb: act.buyMedianBnb ?? null, throughputBnbPerMin: act.throughputBnbPerMin ?? null,
    maxDrawdownPct: act.maxDrawdownPct ?? null, spanSec: act.spanSec ?? null, tickCount: act.tickCount ?? null,
    nearSegBuyMedianBnb: act.nearSegBuyMedianBnb ?? null, nearSegBnbPerMin: act.nearSegBnbPerMin ?? null,
    nearTail5BuyN: act.nearTail5BuyN ?? null, nearTail5BuyBnb: act.nearTail5BuyBnb ?? null,
    nearTail10SellWallets: act.nearTail10SellWallets ?? null,
    nearTail10BuyN: act.nearTail10BuyN ?? null, nearTail10BuyBnb: act.nearTail10BuyBnb ?? null,
  };

  // ── B1 burst 语境豁免（替代原 cheat sbw 输入桶：沉积前提+出口簇真实买入，T143 同源） ──
  const burstCtx = typeof cd.burstWaveSegBuyBnb === 'number' && cd.burstWaveSegBuyBnb >= ACT_BURST_WAVE_BUY_BNB
    && burstContextBackgroundCold(cd);
  // ── B2 尾段激活豁免（题面⑥三段形状：锚前尾段买 ≥3 笔 ∧ ≥0.3 BNB=正被流量激活） ──
  const tailActive = trace.nearTail5BuyN !== null && trace.nearTail5BuyBnb !== null
    && trace.nearTail5BuyN >= ACT_TAIL5_ACTIVATE_N && trace.nearTail5BuyBnb >= ACT_TAIL5_ACTIVATE_BNB;

  // ── low 五臂（豁免后任一成立） ──
  if (!burstCtx && !tailActive) {
    // L1 大比例无交易期（极端联立：静默 ≥60% ∧ 吞吐近死寂——预扫描校准）
    if (typeof trace.idlePct === 'number' && trace.idlePct >= ACT_LOW_IDLE_PCT
      && typeof trace.throughputBnbPerMin === 'number' && trace.throughputBnbPerMin < ACT_LOW_IDLE_THROUGHPUT) {
      return { level: 'low', branch: 'act_low_idle', trace: { ...trace, burstCtx, tailActive } };
    }
    // L5 全窗四腿联立（间歇死水：密度/吞吐/中位/静默可观）
    if (typeof trace.ticksPerMin === 'number' && trace.ticksPerMin < ACT_SPARSE_TPM
      && typeof trace.throughputBnbPerMin === 'number' && trace.throughputBnbPerMin < ACT_DEAD_THROUGHPUT_BNB_MIN
      && typeof trace.buyMedianBnb === 'number' && trace.buyMedianBnb < ACT_DUST_MEDIAN_BNB
      && ((typeof trace.idlePct === 'number' && trace.idlePct >= ACT_SPARSE_IDLE_PCT)
        || (typeof act.maxGapSec === 'number' && act.maxGapSec >= ACT_SPARSE_MAX_GAP_SEC))) {
      return { level: 'low', branch: 'act_low_sparse_quad', trace: { ...trace, burstCtx, tailActive } };
    }
    // L2 尘埃假活跃（中位尘埃 ∧ 吞吐死寂两腿）
    if (typeof trace.buyMedianBnb === 'number' && trace.buyMedianBnb < ACT_DUST_MEDIAN_BNB
      && typeof trace.throughputBnbPerMin === 'number' && trace.throughputBnbPerMin < ACT_DEAD_THROUGHPUT_BNB_MIN) {
      return { level: 'low', branch: 'act_low_dust_dead', trace: { ...trace, burstCtx, tailActive } };
    }
    // L3 单向死水推进（笔比+额比+浅回撤三腿；极早窗反锚两腿同时则不适用）
    const earlyWin = (trace.spanSec !== null && trace.tickCount !== null
      && trace.spanSec < ACT_EARLYWIN_SEC && trace.tickCount < ACT_EARLYWIN_TICKS);
    if (!earlyWin && typeof cd.buyN === 'number' && typeof cd.sellN === 'number' && cd.sellN > 0
      && cd.buyN / cd.sellN >= ACT_ONESIDED_BUY_SELL_N
      && typeof cd.totalBuyBnb === 'number' && typeof cd.totalSellBnb === 'number' && cd.totalSellBnb > 0
      && cd.totalBuyBnb / cd.totalSellBnb >= ACT_ONESIDED_BUY_SELL_BNB
      && typeof trace.maxDrawdownPct === 'number' && trace.maxDrawdownPct < ACT_ONESIDED_MAX_DD_PCT) {
      return { level: 'low', branch: 'act_low_onesided', trace: { ...trace, burstCtx, tailActive, earlyWin } };
    }
    // L4 临近死寂臂（⑦主锚；预扫描校准=**两腿联立**：中位尘埃 ∧ 吞吐死寂同时
    // 成立才拦——单腿时近窗偶发空档即拦，321 行主误伤源）
    const nearDead = (typeof trace.nearSegBuyMedianBnb === 'number' && trace.nearSegBuyMedianBnb < ACT_DUST_MEDIAN_BNB)
      && (typeof trace.nearSegBnbPerMin === 'number' && trace.nearSegBnbPerMin < ACT_DEAD_THROUGHPUT_BNB_MIN);
    if (nearDead) {
      return { level: 'low', branch: 'act_low_near_dead', trace: { ...trace, burstCtx, tailActive } };
    }
  }

  // ── ultra 两臂（独立于豁免——协同出货/极端密度是当下事实非沉积语境） ──
  // U1 协同出货臂（末 10s ≥10 独立卖钱包 ∧ 买入趋零；c84a 双边在场不落）
  if (typeof trace.nearTail10SellWallets === 'number' && trace.nearTail10SellWallets >= ACT_ULTRA_SELL_WALLETS
    && typeof trace.nearTail10BuyN === 'number' && trace.nearTail10BuyN <= ACT_ULTRA_BUY_N_MAX
    && typeof trace.nearTail10BuyBnb === 'number' && trace.nearTail10BuyBnb < ACT_ULTRA_BUY_BNB_MAX) {
    return { level: 'ultra', branch: 'act_ultra_coordinated_selling', trace: { ...trace, burstCtx, tailActive } };
  }
  // U2 极端密度臂（几乎无空窗每秒十笔级下界）
  if (typeof trace.ticksPerMin === 'number' && trace.ticksPerMin >= ACT_ULTRA_TPM
    && typeof trace.idlePct === 'number' && trace.idlePct < ACT_ULTRA_IDLE_PCT) {
    return { level: 'ultra', branch: 'act_ultra_density', trace: { ...trace, burstCtx, tailActive } };
  }

  return { level: null, branch: burstCtx ? 'burst_ctx' : (tailActive ? 'tail_active' : 'normal'), reason: null, trace: { ...trace, burstCtx, tailActive } };
}

// ═══════════════ 尾声延伸活跃度门（FP5：充分上涨过的票，活跃度要求延伸到前 2 分钟） ═══════════════

/**
 * 尾声延伸活跃度判定（FP5，纯机械）。前提=「曾充分上涨」（涨幅 ≥+100% ∧
 * 总成交 ≥20 BNB 双标记同时成立——明确的大轮次）；此前提下若前 2 分钟活跃度
 * 不足（任一腿）：腿1 win120 整体吞吐 <1 BNB/min（2 分钟合计死寂）；腿2 前
 * 90s 延伸段买入 <0.1 BNB（买入只集中在最后 30s=尾声小波动）→ 拒 act_tail_flat。
 * 未充分上涨的票不适用（普通票活跃度语义归 judgeActivityLevel）；锚缺失
 * （ath/vol/win 族 null）不拦（拒方向证据缺席，T143 哲学）。
 * 正在拉升的票天然豁免：win120 持续活跃两腿均不命中（btv140 放行面 tpm≥6.1）。
 */
function judgeTailPhaseActivity(snapshot) {
  const bd = snapshot.buyDerived || {};
  const w30 = bd.win && bd.win[30] ? bd.win[30] : null;
  const w120 = bd.win && bd.win[120] ? bd.win[120] : null;
  const trace = {
    athVsLaunchPct: typeof bd.athVsLaunchPct === 'number' ? bd.athVsLaunchPct : null,
    totalVolumeBnb: typeof bd.totalVolumeBnb === 'number' ? bd.totalVolumeBnb : null,
    tpm120: w120 && typeof w120.buyBnb === 'number' && typeof w120.sellBnb === 'number'
      ? +(((w120.buyBnb + w120.sellBnb) / 120) * 60).toFixed(2) : null,
    extBuyBnb: w120 && w30 && typeof w120.buyBnb === 'number' && typeof w30.buyBnb === 'number'
      ? +(w120.buyBnb - w30.buyBnb).toFixed(4) : null,
    minVsLaunchPct: typeof bd.minVsLaunchPct === 'number' ? bd.minVsLaunchPct : null, // FP7 腿3
  };
  if (trace.athVsLaunchPct === null || trace.totalVolumeBnb === null) {
    return { hit: 0, branch: 'anchors_missing', reason: null, trace };
  }
  if (trace.athVsLaunchPct < TAIL_ATH_VS_LAUNCH_PCT || trace.totalVolumeBnb < TAIL_TOTAL_VOLUME_BNB) {
    return { hit: 0, branch: 'not_fully_risen', reason: null, trace };
  }
  // 腿3（FP7）：砸穿过/贴近发行价=灭亡确认，活跃持续不救（用户裁定「不可抄底」）
  if (trace.minVsLaunchPct !== null && trace.minVsLaunchPct <= TAIL_BROKE_FLOOR_PCT) {
    return { hit: 1, branch: 'tail_broke_floor', reason: 'act_tail_flat', trace };
  }
  if (trace.tpm120 === null && trace.extBuyBnb === null) {
    return { hit: 0, branch: 'win_missing', reason: null, trace };
  }
  const tpmLow = trace.tpm120 !== null && trace.tpm120 < TAIL_WIN120_TPM_BNB;
  const extLow = trace.extBuyBnb !== null && trace.extBuyBnb < TAIL_EXT_BUY_BNB;
  if (tpmLow || extLow) {
    return { hit: 1, branch: tpmLow ? 'tail_tpm_dead' : 'tail_ext_buy_gap', reason: 'act_tail_flat', trace };
  }
  return { hit: 0, branch: 'sustained', reason: null, trace };
}

/** FP8a 慢拉卸货：长直线缓推 ∧ 峰后远端 ∧ 尾声死流量 → 拒 slow_pump_unload */
function armSlowPumpUnload(snapshot) {
  const bd = snapshot.buyDerived || {};
  const cd = snapshot.cheatDerived || {};
  const w120 = bd.win && bd.win[120];
  if (typeof cd.pumpStablePoints !== 'number' || typeof cd.pumpStableR2 !== 'number') return false;
  if (cd.pumpStablePoints < SLOW_PUMP_MIN_POINTS || cd.pumpStableR2 < SLOW_PUMP_MIN_R2) return false;
  if (typeof bd.secSinceAth !== 'number' || bd.secSinceAth < SLOW_PUMP_MIN_SEC_SINCE_ATH) return false;
  if (!w120 || typeof w120.buyBnb !== 'number' || typeof w120.sellBnb !== 'number') return false;
  const tpm120 = (w120.buyBnb + w120.sellBnb) / 2;
  return tpm120 < SLOW_PUMP_MAX_TPM120;
}

/** FP8b famous 收割完残局：大涨过 ∧ famous 已离场（自卖比≥0.9）∧ 参与度（占买≥10%）∧ 已砸落 → 拒 fam_harvested_final */
function armFamousHarvestFinal(snapshot) {
  const bd = snapshot.buyDerived || {};
  const ft = bd.famousTraces;
  if (!ft || !Array.isArray(ft.wallets) || ft.wallets.length === 0) return false;
  if (typeof bd.athVsLaunchPct !== 'number' || bd.athVsLaunchPct < FAM_HARVEST_MIN_ATH_PCT) return false;
  if (typeof bd.chg30Pct !== 'number' || bd.chg30Pct > FAM_HARVEST_MAX_CHG30_PCT) return false;
  const groupBuy = typeof ft.groupBuyBnb === 'number' ? ft.groupBuyBnb : 0;
  const groupSell = typeof ft.groupSellBnb === 'number' ? ft.groupSellBnb : 0;
  const soldRatio = groupBuy > 0 ? groupSell / groupBuy : null;
  if (soldRatio === null || soldRatio < FAM_HARVEST_MIN_SOLD_RATIO) return false;
  return typeof ft.groupBuyPct === 'number' && ft.groupBuyPct >= FAM_HARVEST_MIN_BUY_PCT;
}

/** CD414 短窗持续密集砸盘：win30 独立卖钱包 ≥15 ∧ 卖 ≥2B ∧ 净 ≤−1.5B → 拒
 *  （observe fam_dominance_fall 命中票由调用点排除——上轮 famous 观察裁定） */
function armDenseDump(bd) {
  const w30 = bd && bd.win && bd.win[30];
  if (!w30 || typeof w30.sellers !== 'number' || typeof w30.sellBnb !== 'number' || typeof w30.netBnb !== 'number') return false;
  return w30.sellers >= DENSE_DUMP_MIN_SELLERS
    && w30.sellBnb >= DENSE_DUMP_MIN_SELL_BNB
    && w30.netBnb <= DENSE_DUMP_MAX_NET_BNB;
}

/** FP9 famous 系突发波：静默 ≥30s 后的波由 famous∪同块同额镜像簇带起
 *  （占波买 ≥80% ∧ famous 本人波内首进）→ 拒 fam_burst_wave——撑起活跃度的
 *  流量全是 famous 系自己（cheat originalGrade 常为 cheat 被 activity_high
 *  豁免翻正——豁免所依据的「活跃」正是要挡的这波本身；键源
 *  buyDerived.famBurstWave，null/键缺失不触发=宁漏不冒充） */
function armFamousBurstWave(bd) {
  const w = bd && bd.famBurstWave;
  if (!w) return false;
  if (w.anchorNearWave !== true) return false;
  if (typeof w.waveBuyBnb !== 'number' || w.waveBuyBnb < FAM_BURST_MIN_WAVE_BUY_BNB) return false;
  if (typeof w.famSysSharePct !== 'number' || w.famSysSharePct < FAM_BURST_MIN_SHARE_PCT) return false;
  return w.famousFirstInWave === true;
}

/** FP10 famous 低价全清冷却：famous 群体像样参与（≥0.2B）∧ 全清（自卖比 ≥0.9
 *  ∧ 残仓 ≤0.05B）∧ 末笔卖在低价域（较地板发行价 ≤+40%）∧ 冷却未满（末笔卖
 *  距锚 ≤120s）→ 拒 fam_low_exit_cooldown——famous 低点位清仓是后续砸盘的前导
 *  信号，冷却窗内不接盘（窗外=冷却完成照常评估）。键源 famousTraces 群体退出
 *  四键（T167 直供）；roster 缺失 famousTraces=null / 无可靠价卖行全族 null
 *  → 不触发（宁漏不冒充）。 */
function armFamousLowExit(snapshot) {
  const ft = snapshot.buyDerived && snapshot.buyDerived.famousTraces;
  if (!ft || !Array.isArray(ft.wallets) || ft.wallets.length === 0) return false;
  if (typeof ft.groupBuyBnb !== 'number' || ft.groupBuyBnb < FAM_LOW_EXIT_MIN_BUY_BNB) return false;
  const groupSell = typeof ft.groupSellBnb === 'number' ? ft.groupSellBnb : 0;
  if (ft.groupBuyBnb <= 0 || groupSell / ft.groupBuyBnb < FAM_LOW_EXIT_MIN_SOLD_RATIO) return false;
  if (typeof ft.presenceNetBnb !== 'number' || ft.presenceNetBnb > FAM_LOW_EXIT_MAX_PRESENCE_BNB) return false;
  if (typeof ft.lastSellVsLaunchPct !== 'number' || ft.lastSellVsLaunchPct > FAM_LOW_EXIT_MAX_VS_PCT) return false;
  return typeof ft.lastSellToAnchorSec === 'number' && ft.lastSellToAnchorSec <= FAM_LOW_EXIT_COOLDOWN_SEC;
}

/** FP10 破发豁免（T167b/28ad 案）：盘面（famous 群体首买后、锚窗内）最低价较 famous
 *  加权入场成本深破 ≥FAM_LOW_EXIT_BREACH_EXEMPT_PCT → famous 带来的流量已清场
 *  （famous 清仓=上一轮遗迹，重启波不受残留影响）→ FP10 不拦。键源 T167b 直供
 *  groupEntryAvgBnb/postEntryMinBnb；任一 null/非正 → 不豁免（保持拦截）。
 *  注意「末卖价低于成本」不是豁免判据（T055 立法案同形状，182 对拍 13.1≈11.5
 *  分不开）——深破必须是盘面事实而非 famous 自己的卖价。 */
function famousBreachExemptPct(ft) {
  if (!ft || typeof ft.groupEntryAvgBnb !== 'number' || !(ft.groupEntryAvgBnb > 0)) return null;
  if (typeof ft.postEntryMinBnb !== 'number' || !(ft.postEntryMinBnb > 0)) return null;
  return (1 - ft.postEntryMinBnb / ft.groupEntryAvgBnb) * 100;
}

/** FP11 famous 早窗快闪双支：极早入场（首买 ≤10s ∨ 全盘 BUY 顺位 ≤5——用户裁定
 *  「这次先控极早入场，就是前几个顺位或者前几秒入场」）∧ 群买 ≥0.2B 前提下
 *  A 支（自卖比 ≥0.7 ∧ 残仓比 ≥0.15 → 'fam_early_flip_partial'：砸到一半+大额
 *  残仓挂剑，反弹即它的出货位）/ B 支（在场净 ≤0.01B ∧ 自卖比 ≥1.0 →
 *  'fam_early_flip_exit'：清仓走人连底仓不留=纯粹过路收割）→ 拒。键源 famousTraces
 *  群体键+T171 直供 groupFirstBuyDt/groupFirstBuyRank；roster 缺失 famousTraces=null /
 *  首买 dt 与顺位全缺 → 前提不成立不触发（宁漏不冒充，与 famous 族容缺同向；
 *  单轴在场即评——慢速开盘票 dt 缺失但顺位在场照判）。 */
function armFamousEarlyFlip(snapshot) {
  const ft = snapshot.buyDerived && snapshot.buyDerived.famousTraces;
  if (!ft || !Array.isArray(ft.wallets) || ft.wallets.length === 0) return null;
  const earlySec = typeof ft.groupFirstBuyDt === 'number' ? ft.groupFirstBuyDt <= FAM_EARLY_FLIP_EARLY_SEC : false;
  const earlyRank = typeof ft.groupFirstBuyRank === 'number' ? ft.groupFirstBuyRank <= FAM_EARLY_FLIP_EARLY_RANK : false;
  if (!earlySec && !earlyRank) return null;
  if (typeof ft.groupBuyBnb !== 'number' || ft.groupBuyBnb < FAM_EARLY_FLIP_MIN_BUY_BNB) return null;
  const groupSell = typeof ft.groupSellBnb === 'number' ? ft.groupSellBnb : 0;
  if (ft.groupBuyBnb <= 0) return null;
  const soldRatio = groupSell / ft.groupBuyBnb;
  if (typeof ft.presenceNetBnb === 'number' && ft.presenceNetBnb <= FAM_EARLY_FLIP_B_MAX_PRESENCE_BNB
    && soldRatio >= FAM_EARLY_FLIP_B_MIN_SOLD_RATIO) return 'fam_early_flip_exit';
  if (soldRatio >= FAM_EARLY_FLIP_A_MIN_SOLD_RATIO
    && typeof ft.presenceNetBnb === 'number' && ft.presenceNetBnb / ft.groupBuyBnb >= FAM_EARLY_FLIP_A_MIN_PRESENCE_RATIO) {
    return 'fam_early_flip_partial';
  }
  return null;
}

// ═══════════════ famous 高控+砸落观察臂（FP6：标记不拦截，留待找方案） ═══════════════

/**
 * famous 高控+砸落观察判定（FP6，纯观察零拦截）：famousDominancePct（cheatDerived
 * 筹码口径=famous∪60s 跟单者合计控制在场筹码 %）≥90 ∧ chg30Pct ≤−20 → observe
 * 标记（fam_dominance_fall）。原料值（自卖比/占卖/在场净）随 trace 落盘供后续
 * 找分化轴；锚缺失不标记（同 T143 容缺哲学——观察方向证据缺席不标）。
 */
function judgeFamousDominanceFall(snapshot) {
  const bd = snapshot.buyDerived || {};
  const cd = snapshot.cheatDerived || {};
  const dom = typeof cd.famousDominancePct === 'number' ? cd.famousDominancePct : null;
  const chg30 = typeof bd.chg30Pct === 'number' ? bd.chg30Pct : null;
  const trace = { domPct: dom, chg30Pct: chg30 };
  if (dom === null || chg30 === null) {
    return { observe: false, branch: 'anchors_missing', trace };
  }
  if (dom >= FAM_DOM_FALL_DOM_PCT && chg30 <= FAM_DOM_FALL_CHG30_PCT) {
    return { observe: true, branch: 'fam_dominance_fall', trace };
  }
  return { observe: false, branch: 'clear', trace };
}

// ═══════════════ 门/值对组装（FP6：FP 输出整理为门控形态，信号页展示各门值） ═══════════════

/**
 * 组装 FP 门/值对（用户裁定 2026-11-17：「因子过滤这个环节其实也是形成了好多个
 * 门控，跟 Jev 购买前检查模块由各个锚组成门控一样，所以因子过滤的输出也整理
 * 一下形成门/值对这样的格式，在信号页面中也要展示各个门的值」）。
 * 每门 {id,label,value,line,hit,observe}——value/line 为预拼展示串（null 一律 '-'）；
 * hit=该门拦截命中（进 arms/reason）；observe=观察标记门（不拦截）。
 * @param {object} parts evaluateFactorPreBuy 组装中的各判定结果
 */
function buildFactorGates(parts) {
  const d = (v, unit = '') => (v === null || v === undefined ? '-' : `${v}${unit}`);
  const g = [];
  // PVP
  {
    const t = parts.pvp.trace || {};
    g.push({
      id: 'pvp', label: 'PVP·像样买方在场',
      value: `0.2级×${d(t.act20)} 0.3级×${d(t.act30)} 同块捆绑${d(t.volBundledBnb, 'B')}`,
      line: '钱包≥2 ∨ 0.3级≥1 ∨ 捆绑>0.3B', hit: !!parts.pvp.reason,
    });
  }
  // T180 首两波大部队×高占比（FP17——ladder v32 迁入）
  {
    const ls = (parts.bd && parts.bd.launchSquad) || null;
    g.push({
      id: 'launch_squad', label: 'T180·首两波大部队×高占比',
      value: ls ? `wave${d(ls.waveWallets)} dom${d(ls.domPct, '%')}` : '-',
      line: 'wave≥8 ∧ dom≥30（首2s尘线钱包挤入 ∧ 捆绑块占窗买）', hit: parts.armHits.includes('launch_squad_dominance'),
    });
  }
  // T187 持有者打散无主力（FP21）
  {
    const chip = (parts.bd && parts.bd.chip) || null;
    g.push({
      id: 'holder_scatter', label: 'T187·持有者打散无主力',
      value: chip ? `posH${d(chip.posHolderCount)} top1${d(chip.top1HoldCircPct, '%')} 前2${d(chip.top1Top2HoldCircPct, '%')}` : '-',
      line: '持有者≥25 ∧ top1<45 ∧ 前2<60（豁免=主力承接在场）', hit: parts.armHits.includes('holder_scatter'),
    });
  }
  // T188 持仓均等作弊仓（FP22）
  {
    const chip = (parts.bd && parts.bd.chip) || null;
    g.push({
      id: 'even_split_crew', label: 'T188·持仓均等作弊仓',
      value: chip ? `HHI${chip.holderHHI != null ? chip.holderHHI.toFixed(3) : '-'} 流通${chip.circSupplyPct != null ? chip.circSupplyPct.toFixed(1) + '%' : '-'}` : '-',
      line: 'HHI<0.10 ∧ 流通≥16.5%（团伙分仓已派发——残局接刀；低流通=拉升中段救回）', hit: parts.armHits.includes('even_split_crew'),
    });
  }
  // FP18 尾部接刀（T182）
  {
    const bdk = parts.bd || {};
    g.push({
      id: 'tail_dip_knife', label: 'T182·尾部接刀',
      value: `ath${d(bdk.athVsLaunchPct, '%')} curVs${d(bdk.currentVsLaunchPct, '%')} chg5${d(bdk.chg5Pct, '%')} chg30${d(bdk.chg30Pct, '%')}`,
      line: '域(ath≥40∧curVs≤28.5) ∧ chg5<-5 ∧ chg30<-5（崩塌进行时非插针）', hit: parts.armHits.includes('tail_dip_knife'),
    });
  }
  // act 族（trace 同源 judgeActivityLevel）
  {
    const t = parts.activity.trace || {};
    const branch = parts.activity.branch;
    g.push({
      id: 'act_idle', label: '活跃·静默死寂',
      value: `静默${d(t.idlePct, '%')} 吞吐${d(t.throughputBnbPerMin, 'B/min')}`,
      line: '≥60% ∧ <0.5B/min', hit: branch === 'act_low_idle',
    });
    g.push({
      id: 'act_sparse', label: '活跃·稀疏死水',
      value: `${d(t.ticksPerMin, '笔/min')} 吞吐${d(t.throughputBnbPerMin, 'B/min')} 中位${d(t.buyMedianBnb, 'B')}`,
      line: '<10笔/min ∧ <1B/min ∧ <0.05B', hit: branch === 'act_low_sparse_quad',
    });
    g.push({
      id: 'act_dust', label: '活跃·尘埃假活跃',
      value: `买中位${d(t.buyMedianBnb, 'B')} 吞吐${d(t.throughputBnbPerMin, 'B/min')}`,
      line: '<0.05B ∧ <1B/min', hit: branch === 'act_low_dust_dead',
    });
    g.push({
      id: 'act_near_dead', label: '活跃·临近死寂',
      value: `临近中位${d(t.nearSegBuyMedianBnb, 'B')} 临近吞吐${d(t.nearSegBnbPerMin, 'B/min')}`,
      line: '<0.05B ∧ <1B/min', hit: branch === 'act_low_near_dead',
    });
    g.push({
      id: 'act_ultra_sell', label: '活跃·协同出货',
      value: `末10s卖钱包${d(t.nearTail10SellWallets)} 买${d(t.nearTail10BuyN, '笔')}/${d(t.nearTail10BuyBnb, 'B')}`,
      line: '≥10钱包 ∧ ≤2笔 ∧ <0.1B', hit: branch === 'act_ultra_coordinated_selling',
    });
    g.push({
      id: 'act_ultra_density', label: '活跃·极端密度',
      value: `${d(t.ticksPerMin, '笔/min')} 静默${d(t.idlePct, '%')}`,
      line: '≥150笔/min ∧ <5%', hit: branch === 'act_ultra_density',
    });
  }
  // CD 四臂+CD412（cd 输入重取）
  {
    const cd = parts.cd || {};
    g.push({
      id: 'cd400', label: 'CD400·贴锚砸出零承接',
      value: `达标块${d(cd.nearDumpQualBlocks)} 最恶承接${d(cd.nearDumpMinAbsorbBnb, 'B')}`,
      line: '≥1块 ∧ 承接<0.05B', hit: parts.armHits.includes('cd400_dump_no_absorption'),
    });
    g.push({
      id: 'cd403', label: 'CD403·捆绑砸盘低承接',
      value: `卖方${d(cd.nearDumpWorstSellers)} 承接比${(typeof cd.nearDumpMinAbsorbBnb === 'number' && typeof cd.nearDumpWorstSellBnb === 'number' && cd.nearDumpWorstSellBnb > 0) ? (cd.nearDumpMinAbsorbBnb / cd.nearDumpWorstSellBnb).toFixed(2) : '-'}`,
      line: '卖方≥8 ∧ 比<0.3', hit: parts.armHits.includes('cd403_dump_low_absorption'),
    });
    g.push({
      id: 'cd401', label: 'CD401·burst出口卖压',
      value: `簇卖占${d(cd.burstWaveSegSellPct, '%')} 卖额${d(cd.burstWaveSegSellBnb, 'B')}`,
      line: '≥30% ∧ ≥0.3B（sbw=1 资格）', hit: parts.armHits.includes('cd401_burst_exit_sell_pressure'),
    });
    g.push({
      id: 'cd405', label: 'CD405·burst捆绑收割',
      value: `单块${d(cd.burstWaveBundleMaxWallets, '户')} 相邻slot${d(cd.burstWaveBundleAdjPairSum, '户')}`,
      line: '去尘捆绑≥7户', hit: parts.armHits.includes('cd405_burst_bundled_wave'),
    });
    g.push({
      id: 'burst_weak', label: 'FP15·burst弱波（无大户+无压箱）',
      value: `波内大户${d(parts.bd && parts.bd.burstWaveQuality && parts.bd.burstWaveQuality.whaleWallets, '实体')}(合并${d(parts.bd && parts.bd.burstWaveQuality && parts.bd.burstWaveQuality.whaleMergedGroups, '组')}) 压箱${d(parts.bd && parts.bd.burstWaveQuality && parts.bd.burstWaveQuality.preWaveBuyBnb, 'B')}`,
      line: '联立：大户=0 ∧ 压箱<1B（同块∨同额并为一个钱包；无段不拦）', hit: parts.armHits.includes('burst_weak_wave'),
    });
    g.push({
      id: 'lifecycle_burst', label: 'FP16·大周期burst残局',
      value: `ath${d(parts.bd && parts.bd.athVsLaunchPct, '%')} 总额${d(parts.bd && parts.bd.totalVolumeBnb, 'B')} 静默${d(cd.burstLastGapSec, 's')} 波买${d(cd.burstWaveSegBuyBnb, 'B')}`,
      line: 'ath≥100% ∧ 总额≥15B ∧ burst结构（静默≥30s∧波近锚∧波买≥0.3B）；深破<−10豁免', hit: parts.armHits.includes('lifecycle_burst_residual'),
    });
    g.push({
      id: 'cd412', label: 'CD412·极端捆绑砸盘',
      value: `卖方${d(cd.nearDumpWorstSellers)} 块卖${d(cd.nearDumpWorstSellBnb, 'B')}`,
      line: '≥15户 ∧ ≥1B（破发豁免）', hit: parts.armHits.includes('cd412_extreme_dump_sellers'),
    });
    const w30g = (parts.bd && parts.bd.win && parts.bd.win[30]) || null;
    g.push({
      id: 'cd414', label: 'CD414·短窗持续密集砸盘',
      value: `30s卖方${d(w30g && w30g.sellers)} 卖${d(w30g && w30g.sellBnb, 'B')} 净${d(w30g && w30g.netBnb, 'B')}`,
      line: '≥15户 ∧ ≥2B ∧ 净≤−1.5B（observe 命中票除外）', hit: parts.armHits.includes('cd414_dense_dump'),
    });
  }
  // FP3 famous 两法
  {
    const t = parts.famous.trace || {};
    g.push({
      id: 'fam_holding', label: 'FP3·famous持重危险',
      value: `自卖比${d(t.soldRatio)} 总买${d(t.totalBuyBnb, 'B')} chg30${d(t.chg30Pct, '%')}`,
      line: '自卖比<0.7 ∧（总买<3B ∨ chg30<-15%）', hit: parts.famous.reason === 'fam_holding_thin' || parts.famous.reason === 'fam_holding_dumping',
    });
    g.push({
      id: 'fam_harvest', label: 'FP3·famous收割砸盘',
      value: `自卖比${d(t.soldRatio)} 占买${d(t.groupBuyPct, '%')} 占卖${d(t.groupSellPct, '%')}`,
      line: '≥0.7 ∧ 占买≥10% ∧ 占卖≥20%', hit: parts.famous.reason === 'fam_harvested_dump',
    });
  }
  // FP5 尾声延伸
  {
    const t = parts.tail.trace || {};
    g.push({
      id: 'tail_activity', label: 'FP5/FP7·尾声延伸活跃',
      value: `ath${d(t.athVsLaunchPct, '%')} 总额${d(t.totalVolumeBnb, 'B')} win120吞吐${d(t.tpm120, 'B/min')} 前90s买${d(t.extBuyBnb, 'B')} minVs${d(t.minVsLaunchPct, '%')}`,
      line: 'ath≥100% ∧ 总额≥20B ∧（吞吐<1B/min ∨ 延伸买<0.1B ∨ 砸穿发行价 minVs≤3%）', hit: !!parts.tail.reason,
    });
  }
  // FP6 famous 高控+砸落（观察门——不拦截）
  {
    const t = parts.domFall.trace || {};
    g.push({
      id: 'fam_dom_fall', label: 'FP6·famous高控+砸落（观察）',
      value: `dom${d(t.domPct, '%')} chg30${d(t.chg30Pct, '%')}`,
      line: 'dom≥90% ∧ chg30≤−20%（标记不拦截，留待找方案）', hit: false,
      observe: parts.domFall.observe === true,
    });
  }
  // FP8a 慢拉卸货（键源 cd.pumpStable*+bd.secSinceAth+win120）
  {
    const cd2 = parts.cd || {};
    const w120g = (parts.bd && parts.bd.win && parts.bd.win[120]) || null;
    g.push({
      id: 'slow_pump', label: 'FP8a·慢拉卸货',
      value: `稳定段${d(cd2.pumpStablePoints, '点')} R²${d(cd2.pumpStableR2)} 峰后${d(parts.bd && parts.bd.secSinceAth, 's')} 吞吐${d(w120g ? (w120g.buyBnb + w120g.sellBnb) / 2 : null, 'B/min')}`,
      line: '≥30点 ∧ R²≥0.95 ∧ 峰后≥600s ∧ 吞吐<1B/min', hit: parts.armHits.includes('slow_pump_unload'),
    });
  }
  // FP8b famous 收割完残局
  {
    const ft = parts.bd && parts.bd.famousTraces;
    const sr = ft && typeof ft.groupBuyBnb === 'number' && ft.groupBuyBnb > 0 && typeof ft.groupSellBnb === 'number' ? (ft.groupSellBnb / ft.groupBuyBnb).toFixed(2) : null;
    g.push({
      id: 'fam_harvest_final', label: 'FP8b·famous收割完残局',
      value: `ath${d(parts.bd && parts.bd.athVsLaunchPct, '%')} 自卖比${d(sr)} 占买${d(ft && ft.groupBuyPct, '%')} chg30${d(parts.bd && parts.bd.chg30Pct, '%')}`,
      line: 'ath≥100% ∧ 自卖比≥0.9 ∧ 占买≥10% ∧ chg30≤−20%', hit: parts.armHits.includes('fam_harvested_final'),
    });
  }
  // FP9 famous 系突发波
  {
    const w = parts.bd && parts.bd.famBurstWave;
    g.push({
      id: 'fam_burst_wave', label: 'FP9·famous系burst波',
      value: `静默${d(w && w.stallSec, 's')} 波买${d(w && w.waveBuyBnb, 'B')} famous系${d(w && w.famSysSharePct, '%')} 首进${w && w.famousFirstInWave ? '波内' : '否'}`,
      line: '静默≥30s ∧ 波买≥0.3B ∧ famous系≥80% ∧ 首进波内', hit: parts.armHits.includes('fam_burst_wave'),
    });
  }
  // FP10 famous 低价全清冷却
  {
    const ft2 = parts.bd && parts.bd.famousTraces;
    const breach = famousBreachExemptPct(ft2);
    // T167d 豁免标注与判定同构：深破≥20 ∧ 末卖后在外流通谷值≤9%（渲染层谷值容缺判 false=不标）
    const exempted = breach !== null && breach >= FAM_LOW_EXIT_BREACH_EXEMPT_PCT
      && ft2 && typeof ft2.postSellTroughPct === 'number' && ft2.postSellTroughPct <= FAM_LOW_EXIT_TROUGH_EXEMPT_MAX_PCT;
    g.push({
      id: 'fam_low_exit', label: 'FP10·famous低价全清冷却',
      value: `末卖@+${d(ft2 && ft2.lastSellVsLaunchPct, '%')} 距锚${d(ft2 && ft2.lastSellToAnchorSec, 's')} 买${d(ft2 && ft2.groupBuyBnb, 'B')} 残仓${d(ft2 && ft2.presenceNetBnb, 'B')} 破深${d(breach !== null ? +breach.toFixed(1) : null, '%')} 谷值${d(ft2 && ft2.postSellTroughPct, '%')}${exempted ? '→破发豁免' : ''}`,
      line: '买≥0.2B ∧ 自卖比≥0.9 ∧ 残仓≤0.05B ∧ 卖价≤+40% ∧ 距锚≤120s ∧ 破深<20%（深破≥20%∧末卖后流通谷值≤9%=抛压已出清豁免）', hit: parts.armHits.includes('fam_low_exit_cooldown'),
    });
  }
  // FP11 famous 早窗快闪双支
  {
    const ft3 = parts.bd && parts.bd.famousTraces;
    const sr = ft3 && typeof ft3.groupBuyBnb === 'number' && ft3.groupBuyBnb > 0 && typeof ft3.groupSellBnb === 'number'
      ? (ft3.groupSellBnb / ft3.groupBuyBnb).toFixed(2) : '-';
    const pr = ft3 && typeof ft3.groupBuyBnb === 'number' && ft3.groupBuyBnb > 0 && typeof ft3.presenceNetBnb === 'number'
      ? (ft3.presenceNetBnb / ft3.groupBuyBnb).toFixed(2) : '-';
    g.push({
      id: 'fam_early_flip', label: 'FP11·famous早窗快闪',
      value: `首@+${d(ft3 && ft3.groupFirstBuyDt, 's')} 位${d(ft3 && ft3.groupFirstBuyRank)} 买${d(ft3 && ft3.groupBuyBnb, 'B')} 卖比${sr} 残仓${d(ft3 && ft3.presenceNetBnb, 'B')}(比${pr})`,
      line: '首@≤10s∨顺位≤5 ∧ 买≥0.2B ∧ (A:卖比≥0.7∧残仓比≥0.15 ∨ B:残仓≤0.01B∧卖比≥1.0)',
      hit: parts.armHits.includes('fam_early_flip_partial') || parts.armHits.includes('fam_early_flip_exit'),
    });
  }
  return g;
}

// ═══════════════ CD 四臂升格（CD408；判据=cheat 侧 _exemptDeniedReason 数值照抄） ═══════════════

/** CD400 贴锚砸块零承接：qualBlocks ≥1 ∧ 最恶性块承接 <0.05 */
function armDumpNoAbsorption(cd) {
  if (typeof cd.nearDumpQualBlocks !== 'number' || cd.nearDumpQualBlocks < 1) return false;
  return typeof cd.nearDumpMinAbsorbBnb === 'number' && cd.nearDumpMinAbsorbBnb < DUMP_NO_ABSORB_BNB;
}

/** CD403 超大量捆绑砸盘承接比：卖方 ≥8 ∧ 承接比 <0.3 */
function armDumpLowAbsorption(cd) {
  if (typeof cd.nearDumpQualBlocks !== 'number' || cd.nearDumpQualBlocks < 1) return false;
  if (typeof cd.nearDumpWorstSellers !== 'number' || cd.nearDumpWorstSellers < DUMP_RATIO_MIN_SELLERS) return false;
  if (typeof cd.nearDumpMinAbsorbBnb !== 'number' || typeof cd.nearDumpWorstSellBnb !== 'number') return false;
  return cd.nearDumpWorstSellBnb > 0 && cd.nearDumpMinAbsorbBnb / cd.nearDumpWorstSellBnb < DUMP_LOW_ABSORPTION_RATIO;
}

/**
 * CD401 burst 出口段卖压（sbw 机械化代理线——用户两分法路线 1）：
 * 代理=burstWaveSeg 簇存在（≥30s 静默段+出口簇=burst 结构前提）∧ 波贴近锚
 * ≤60s（当下事件）∧ 波钱包中位尘埃级（小散涌入主体）∧ 波净流入 >0（流量
 * 涌入非卖出引发）；代理 ∧ 簇卖占比 ≥30% ∧ 卖额 ≥0.3 → 拒。
 * 无段/锚缺失全族 null → 代理不成立（宁不拦——拒方向证据缺席不拒）。
 */
function armBurstExitSellPressure(cd) {
  if (!burstContextBackgroundCold(cd)) return false; // 背景腿（T143 追裁定）：高活跃背景不构成 burst 语境
  if (typeof cd.burstWaveSegSellPct !== 'number' || cd.burstWaveSegSellPct < 30) return false;
  if (typeof cd.burstWaveSegSellBnb !== 'number' || cd.burstWaveSegSellBnb < 0.3) return false;
  if (typeof cd.burstSecSinceWaveEnd !== 'number' || cd.burstSecSinceWaveEnd > SBW_PROXY_WAVE_NEAR_SEC) return false;
  if (typeof cd.burstWaveWalletMedianBnb !== 'number' || cd.burstWaveWalletMedianBnb >= SBW_PROXY_MEDIAN_DUST_BNB) return false;
  if (typeof cd.burstWaveWalletNetBnb !== 'number' || cd.burstWaveWalletNetBnb <= 0) return false;
  return true;
}

/**
 * CD401 背景腿线（T143 追裁定 2026-11-15，Go Brrrrr 0xdae106c8…7777 案）：
 * burst 语义前提=**背景活跃度低/中**（用户裁定「这个活跃度本来就高，不属于
 * 突然涌入是连着的，那就活跃度直接就是 high 就行了」）——静默段前 60s 背景
 * 窗 ≥0.5 BNB/min 或 ≥6 笔/min=高活跃背景（流量连着的，30s+ 喘息只是节奏
 * 间隙非沉积）→ 不构成 burst 语境，臂不触发。锚缺失（无段）null=语境缺席
 * 不触发（宁不拦——拒方向证据缺席）。
 */
const BURST_CONTEXT_PRESEG_MIN_BNB = 0.5;
const BURST_CONTEXT_PRESEG_MIN_TICKS = 6;
/** 背景腿（CD401/CD405 两臂共用，用户裁定两臂同加）：true=低/中背景（burst
 * 语境成立）；false=高活跃背景或缺锚（不触发——宁不拦） */
function burstContextBackgroundCold(cd) {
  if (typeof cd.burstPreSegBnbPerMin !== 'number' || typeof cd.burstPreSegTicksPerMin !== 'number') return false;
  return cd.burstPreSegBnbPerMin < BURST_CONTEXT_PRESEG_MIN_BNB && cd.burstPreSegTicksPerMin < BURST_CONTEXT_PRESEG_MIN_TICKS;
}

/** T180 首两波大部队×高占比（2026-11-18 0x17b09420…7777 案，用户裁定「这个阻挡
 * 没问题，放到因子过滤模块吧，不要放到信号触发模块了」——自 ladder v32 条件串
 * 迁入）：出生窗（首 90s）首块+首块后 ≤2s 内 **8+ 尘线钱包挤入** ∧ 捆绑块（≥5 户
 * 同块）占出生窗买入 **≥30%** → 拒。两轴联立才是「组织性大部队拿走流动性」——
 * wave≥8 单轴三窗全负收益切赢家（有机热门盘 8~21 钱包 2s 挤入常见：bt-v147 17 命中
 * 净 +0.416 含 da405bd0 wave13 +0.2538/bt-v141 +0.051/bt-v134 +0.065），占比轴才分离
 * （三窗 436 票命中=案源 −0.0218 救回+0x384fef57 wave21 dom37.8 +0.0034 近零知情
 * +G3/G4 已拦冗余票+bt-v141 零命中）。键源 buyDerived.launchSquad（buy-point-snapshot
 * FA launch 键镜像：waveWallets=T150 launchFirstWaveWallets 口径/domPct=T178
 * launchBuyBundleDominancePct 口径，尘线 0.015/router 归一/raw 含复购波）；锚缺失
 * （截窗不覆盖出生段/零买）null=不评宁不拦（FP 模块「拒方向证据缺席不拒」惯例）。 */
const LAUNCH_SQUAD_MIN_WALLETS = 8;
const LAUNCH_SQUAD_MIN_DOM_PCT = 30;
function armLaunchSquad(bd) {
  const ls = bd && bd.launchSquad;
  if (!ls || typeof ls.waveWallets !== 'number' || typeof ls.domPct !== 'number') return false;
  return ls.waveWallets >= LAUNCH_SQUAD_MIN_WALLETS && ls.domPct >= LAUNCH_SQUAD_MIN_DOM_PCT;
}

/** T187/FP21 持有者打散臂（2026-11-19 筹码结构维度立法，bt-v155/156 两窗成交面
 *  归因）：「代币已经交易了一段时间，参与者比较多，筹码已经完全打乱形不成主力
 *  了」——正净持有者 ≥25 ∧ top1-2 集中度不足 → 拒 holder_scatter。
 *  · 键源 buyDerived.chip（CD 锚窗口径：posHolderCount 正净持有者/holdingsProfile
 *    circPct 在场流通分母 D3.35——与 FA holders 族同构、分母略异，线值已按 CD 口径
 *    预留余量：进场票实测 t2c（T91a 口径）最高 45%，CD 口径放大约 1.1-1.2× 后
 *    仍 <60 豁免线）
 *  · 豁免臂（用户裁定「通过 top1-2 的集中度把薄肌俱乐部救回来」）：
 *    top1HoldCircPct ≥45 ∨ top1Top2HoldCircPct ≥60 = 有主力承接在场，筹码虽散
 *    但有人主导 → 放行。两窗零触发=纯前瞻保护（薄肌 0x51a17dda h=19 不进门）。
 *  · 锚缺席（posHolderCount null）不评宁不拦（FP 惯例）；top1/top1-2 缺席
 *    （holdingsProfile 空）只走另一豁免键，双缺=无豁免证据照拒（fail-closed
 *    方向=分散盘宁拦）。 */
const HOLDER_SCATTER_MIN_HOLDERS = 25;
const HOLDER_SCATTER_EXEMPT_TOP1_PCT = 45;
const HOLDER_SCATTER_EXEMPT_TOP12_PCT = 60;
function armHolderScatter(bd) {
  const chip = bd && bd.chip;
  if (!chip || typeof chip.posHolderCount !== 'number') return false;
  if (chip.posHolderCount < HOLDER_SCATTER_MIN_HOLDERS) return false;
  if (typeof chip.top1Top2HoldCircPct === 'number'
    && chip.top1Top2HoldCircPct >= HOLDER_SCATTER_EXEMPT_TOP12_PCT) return false;
  if (typeof chip.top1HoldCircPct === 'number'
    && chip.top1HoldCircPct >= HOLDER_SCATTER_EXEMPT_TOP1_PCT) return false;
  return true;
}

/** T188/FP22 持仓均等作弊仓臂（2026-11-19 筹码结构维度二连，四窗归因；同日
 *  二修加流通腿——用户裁定「只控流动筹码比例高一些的——『不对劲』这种我还想
 *  救一救」）：HHI < 0.10 ∧ 流通占比 ≥15% → 拒 even_split_crew。
 *  HHI=Σ(份额²)——平方加权头部敏感、对尾部尘埃人数免疫（与基尼互补：基尼
 *  被散户人数推高、HHI 不受「同样 top1=89% 尾部从 2 户变 60 户」影响）。团伙
 *  分仓（多钱包近似均分防集中度检测——拉盘/出货协同）天然压低 HHI：
 *  · 币安锁 0x426c0aca（bt-v155）：开盘 6 钱包分批买 → +35% 后两秒三块
 *    7 笔协同齐砸 0.8B（卖方名单与开盘买方一一对应）33s 直线砸 −44pp
 *  · 大美 0x61a1f7cf：0.033B×3/0.123B×4 同块等额捆绑拉盘进行时
 *  · 猫厨师 0xdc212d5b：拉到 +116% 后成对钱包两块 6 笔协同卖 0.87B
 *  · 「不对劲」0xb84e7e0e/프론티어 0x0b46c992（bt-v140 正票）：同块等额
 *    双买反复双卖/每块 5 钱包成组进场——正票均为团伙拉盘中段浮盈（砸前
 *    侥幸），与负票同生态两个时点。
 *  流通腿（二修，线值三裁 15→18→16.5 折中）：流通占比=Σ正净÷总量——低流通
 *  =团伙筹码尚未派发（拉升中段，四窗大肉全在此侧：不对劲 +131%@13.7%/猫
 *  厨师 +55%@12.4%/프론티어 +38%@12.1%/大美 +24%@15.3 → <16.5% 放行救回
 *  16 票 +0.473）；高流通=已充分派发（残局接刀）→ 拒 11 票 −0.252（0x531d
 *  −31%@17.9/CEPE@18.0/DND@19.3/低电量@20.6/치이카와@21.6/Burn@22.4
 *  大亏全拦，BNCBSI +19%@16.9/0x5793 +15%@17.2 误伤知情）；15-16.5 混合
 *  带（大美/币安共建/币安一直都在/누룽쥐 五正二负）划给放行侧。
 *  锚缺席容缺（FP 惯例）：holderHHI null（<2 正净持有人）或 circSupplyPct
 *  null（totalSupply 缺失）→ 不拦（流通腿=救回条件，null 走放行 fail-open）。 */
const HOLDER_EVEN_CREW_MAX_HHI = 0.10;
const HOLDER_EVEN_CREW_MIN_CIRC_PCT = 16.5;
function armEvenSplitCrew(bd) {
  const chip = bd && bd.chip;
  if (!chip || typeof chip.holderHHI !== 'number') return false;
  if (chip.holderHHI >= HOLDER_EVEN_CREW_MAX_HHI) return false;
  if (typeof chip.circSupplyPct !== 'number') return false; // 流通腿缺席=无法确认高流通，救回方向 fail-open
  return chip.circSupplyPct >= HOLDER_EVEN_CREW_MIN_CIRC_PCT;
}

/** FP18 尾部接刀：域（拉高过 ∧ 回到触发线内低位）∧ 5s 急跌 ∧ 30s 同向 → 拒
 *  tail_dip_knife（T182）。双腿刀缺一不拦：chg30 企稳（≥-5）的瞬间深针=V 型
 *  反弹入场点（dae106 chg30=-1.7/chg5=-13.1 → ep+88 正票）刻意保护。 */
function armTailDipKnife(bd) {
  if (!bd) return false;
  if (typeof bd.athVsLaunchPct !== 'number' || bd.athVsLaunchPct < TAIL_KNIFE_MIN_ATH_VS_PCT) return false;
  if (typeof bd.currentVsLaunchPct !== 'number' || bd.currentVsLaunchPct > TAIL_KNIFE_MAX_CUR_VS_PCT) return false;
  if (typeof bd.chg5Pct !== 'number' || bd.chg5Pct >= TAIL_KNIFE_MAX_CHG5_PCT) return false;
  if (typeof bd.chg30Pct !== 'number' || bd.chg30Pct >= TAIL_KNIFE_MAX_CHG30_PCT) return false;
  return true;
}

/** CD412 极端捆绑砸盘：同块独立卖方 ≥15 ∧ 块卖 ≥1 BNB → 拦（不看承接比）；破发豁免 */
function armExtremeDumpSellers(cd, bd) {
  if (typeof cd.nearDumpWorstSellers !== 'number' || cd.nearDumpWorstSellers < EXTREME_DUMP_MIN_SELLERS) return false;
  if (typeof cd.nearDumpWorstSellBnb !== 'number' || cd.nearDumpWorstSellBnb < EXTREME_DUMP_MIN_BNB) return false;
  // 破发豁免：经历过破发（launchMinVsFloorPct ≤0=滚动最低 vs min(常量,首买)）→ 归零后新庄入场豁免
  if (bd && typeof bd.launchMinVsFloorPct === 'number' && bd.launchMinVsFloorPct <= 0) return false;
  return true;
}

/** CD405 burst 捆绑收割：单块或相邻两 slot 去尘捆绑钱包 ≥7 */
function armBurstBundledWave(cd) {
  // 背景腿（用户裁定两臂同加）：高活跃背景不构成 burst 语境——捆绑收割臂
  // 同为 ≥30s 段波窗绑定，高活跃盘喘息误触发同病（bt-v131 拒 24 行零实伤预防性收紧）
  if (!burstContextBackgroundCold(cd)) return false;
  if (typeof cd.burstWaveBundleMaxWallets === 'number' && cd.burstWaveBundleMaxWallets >= BURST_BUNDLE_MIN_WALLETS) return true;
  if (typeof cd.burstWaveBundleAdjPairSum === 'number' && cd.burstWaveBundleAdjPairSum >= BURST_BUNDLE_MIN_WALLETS) return true;
  return false;
}

/** FP13/FP15 burst 弱波拦截线（T174/T174b）：burst 语境（≥30s 静默段出口波
 *  在场）∧ 波内无 ≥0.15 大户（**FP14 合并口径**：同块捆绑 ∨ 同额的钱包并为
 *  一个实体再过线——M4GA 案；whaleWallets===0 有证据零值）∧ 出口前压箱 <1B → 拒
 *  burst_weak_wave——两轴联立才是「既无大户认可又无交易沉淀」的空波（单轴
 *  命中=有厚底子或有大户带队，均为健康票刻意放行）。键源
 *  buyDerived.burstWaveQuality；无段 null/键缺失 → 不拦（宁不拦不冒充）。 */
function armBurstWeakWave(bd) {
  const w = bd && bd.burstWaveQuality;
  if (!w || typeof w.whaleWallets !== 'number' || typeof w.preWaveBuyBnb !== 'number') return false;
  if (w.whaleWallets > 0) return false;
  return w.preWaveBuyBnb < BURST_WEAK_PRE_WAVE_BNB;
}

/**
 * FP16 大周期 burst 残局：走过一轮大生命周期（ATH ≥+100% ∧ 总额 ≥15B）的票，
 * burst 结构在场（静默 ≥30s → 出口波贴近锚 ≤60s ∧ 波买 ≥0.3B）→ 拒——「不买
 * burst」。深破豁免 launchMinVsFloorPct < -10（真重启票放行，G1 五连收线同线）。
 * null 语义：拒方向证据缺席不拒（ath/总额/静默段/波锚任一 null → 不拦）；
 * 豁免证据缺席不豁免（launchMinVsFloorPct null → 照拦）。
 */
function armLifecycleBurstResidual(bd, cd) {
  if (!bd || !cd) return false;
  if (typeof bd.athVsLaunchPct !== 'number' || bd.athVsLaunchPct < LIFECYCLE_MIN_ATH_PCT) return false;
  if (typeof bd.totalVolumeBnb !== 'number' || bd.totalVolumeBnb < LIFECYCLE_MIN_TOTAL_VOLUME_BNB) return false;
  if (typeof cd.burstLastGapSec !== 'number' || cd.burstLastGapSec < LIFECYCLE_BURST_STALL_GAP_SEC) return false;
  if (typeof cd.burstSecSinceWaveEnd !== 'number' || cd.burstSecSinceWaveEnd > SBW_PROXY_WAVE_NEAR_SEC) return false;
  if (typeof cd.burstWaveSegBuyBnb !== 'number' || cd.burstWaveSegBuyBnb < ACT_BURST_WAVE_BUY_BNB) return false;
  if (typeof bd.launchMinVsFloorPct === 'number' && bd.launchMinVsFloorPct < LIFECYCLE_BURST_EXEMPT_FLOOR_PCT) return false;
  return true;
}

// ═══════════════ famous 两法门（FP3：btv134 复审轮用户两分法立法） ═══════════════

/**
 * famous 危险判定（纯机械，键源 famousTraces/cheatDerived.totalBuyBnb/chg30Pct）。
 * 一法（持重危险）：famous 在场持有（自卖比 <70%——收割未完成）∧（薄盘未起
 *   锚窗总买 <3 BNB ∨ 正在砸 chg30 <−15%）→ 拦。薄盘=它是唯一流动性来源，
 *   砸盘无对手盘；砸盘中=持有未卖+深跌（btv134 验证 6/6 全亏零误伤带）。
 * 二法（收割砸盘）：自卖比 ≥70%（收割完成=跌的倒计时，无论当下跌没跌）∧
 *   占买 ≥10%（参与多，排除路过型）∧ 占卖 ≥20%（这轮下跌就是它砸的——
 *   占卖主杀伤轴：屁屁/鯨/悲伤蛙占卖 14~16%=盘面自己换手→正确放行）。
 * null 容缺：roster 缺失 famousTraces=null→不拦（轴不可评宁不拦）；窗内无
 * 名单命中 wallets=[]→放行（有证据的缺席）；关键数值缺失该臂不触发。
 */
function judgeFamousDanger(snapshot) {
  const bd = snapshot.buyDerived || {};
  const cd = snapshot.cheatDerived || {};
  const ft = bd.famousTraces;
  if (!ft || !Array.isArray(ft.wallets) || ft.wallets.length === 0) {
    return { hit: 0, branch: ft ? 'no_famous' : 'roster_missing', reason: null,
      trace: { groupBuyPct: ft && ft.groupBuyPct !== undefined ? ft.groupBuyPct : null } };
  }
  const groupBuy = typeof ft.groupBuyBnb === 'number' ? ft.groupBuyBnb : 0;
  const groupSell = typeof ft.groupSellBnb === 'number' ? ft.groupSellBnb : 0;
  const soldRatio = groupBuy > 0 ? groupSell / groupBuy : null;
  const trace = {
    groupBuyPct: typeof ft.groupBuyPct === 'number' ? ft.groupBuyPct : null,
    groupSellPct: typeof ft.groupSellPct === 'number' ? ft.groupSellPct : null,
    soldRatio: soldRatio !== null ? +(soldRatio.toFixed(3)) : null,
    totalBuyBnb: typeof cd.totalBuyBnb === 'number' ? cd.totalBuyBnb : null,
    chg30Pct: typeof bd.chg30Pct === 'number' ? bd.chg30Pct : null,
    presenceNetBnb: typeof ft.presenceNetBnb === 'number' ? ft.presenceNetBnb : null,
    wallets: ft.wallets.length,
  };
  // 一法：在场持有 ∧（薄盘 ∨ 正在砸）
  if (soldRatio !== null && soldRatio < FAM_HOLDING_SOLD_RATIO) {
    if (trace.totalBuyBnb !== null && trace.totalBuyBnb < FAM_THIN_TOTAL_BUY_BNB) {
      return { hit: 1, branch: 'fam_holding_thin', reason: 'fam_holding_thin', trace };
    }
    if (trace.chg30Pct !== null && trace.chg30Pct < FAM_DUMPING_CHG30_PCT) {
      return { hit: 1, branch: 'fam_holding_dumping', reason: 'fam_holding_dumping', trace };
    }
  }
  // 二法：收割完成 ∧ 参与多 ∧ 占卖主导
  if (soldRatio !== null && soldRatio >= FAM_HARVEST_SOLD_RATIO
    && trace.groupBuyPct !== null && trace.groupBuyPct >= FAM_HARVEST_BUY_PCT
    && trace.groupSellPct !== null && trace.groupSellPct >= FAM_HARVEST_SELL_PCT) {
    return { hit: 1, branch: 'fam_harvested_dump', reason: 'fam_harvested_dump', trace };
  }
  return { hit: 0, branch: 'fam_clear', reason: null, trace };
}

// ═══════════════ 主入口 ═══════════════

/**
 * 因子购买前检查（纯函数）。臂序：PVP 判定树 → CD400 → CD403 → CD401 → CD405。
 * @param {object} snapshot buildBuyPointSnapshot 产物
 * @param {object} [opts] { enableCheatArms=true, enablePvp=true }（预扫描/灰度分臂开关）
 * @returns {{pass:boolean, reason:string|null, version:string, pvp:object, arms:string[], trace:object}}
 */
function evaluateFactorPreBuy(snapshot, opts = {}) {
  const enableCheatArms = opts.enableCheatArms !== false;
  const enablePvp = opts.enablePvp !== false;
  const enableActivity = opts.enableActivity !== false;
  const enableFamous = opts.enableFamous !== false;
  const enableTail = opts.enableTail !== false;
  const pvp = enablePvp
    ? judgeRetailPvp(snapshot)
    : { hit: 0, branch: 'disabled', reason: null, trace: {} };
  const arms = [];
  const cd = snapshot.cheatDerived || {};
  // FP6 observe（famous 高控+砸落）前置判定——CD414 臂排除消费（上轮裁定先观察）
  const domFall = judgeFamousDominanceFall(snapshot);
  if (enableCheatArms) {
    // （T175 N 通道升格臂 n_no_retail_entry 2026-11-18 同日对拍证伪撤回：全量
    // 升格会拦 3 张 A_strong∧high 豁免放行票——萨摩耶 N=6.3 −0.014/我画地为牢
    // N=0.0 +0.0875/PAYAI N=9.5 +0.0762，净 −0.15 大于 FFFF 单 token 损失
    // （0x6af6cd7f 0 成交、5 行信号 4 行 act=low/mid 提案下仍拒）——N 免疫
    // 拦截面在豁免链有 A 主判优先语义，无条件臂超范围；AF1 跳过路径接受的
    // 丢失面=「act 恒 high∧纯 N」票，三窗 0 成交实证。版本不 bump：N 臂从未
    // 在任何窗口生效过（commit 与撤回同日，FP15 并行改动叠上））
    if (armLaunchSquad(snapshot.buyDerived)) arms.push('launch_squad_dominance'); // T180 首两波大部队×高占比（ladder v32 迁入 FP17——用户裁定归因子过滤模块；结构指纹臂置链首）
    if (armHolderScatter(snapshot.buyDerived)) arms.push('holder_scatter'); // T187/FP21 持有者打散无主力（筹码结构维度：posH≥25 ∧ top1-2 集中度不足）
    if (armEvenSplitCrew(snapshot.buyDerived)) arms.push('even_split_crew'); // T188/FP22 持仓均等作弊仓（HHI<0.10 团伙分仓指纹）
    if (armDumpNoAbsorption(cd)) arms.push('cd400_dump_no_absorption');
    else if (armDumpLowAbsorption(cd)) arms.push('cd403_dump_low_absorption');
    else if (armBurstExitSellPressure(cd)) arms.push('cd401_burst_exit_sell_pressure');
    else if (armBurstBundledWave(cd)) arms.push('cd405_burst_bundled_wave');
    else if (armBurstWeakWave(snapshot.buyDerived)) arms.push('burst_weak_wave'); // FP13 burst 弱波（无大户认可+无压箱，T174 联立线）
    else if (armLifecycleBurstResidual(snapshot.buyDerived, cd)) arms.push('lifecycle_burst_residual'); // FP16 大周期 burst 残局（走过一轮+burst 不买，2026-11-18）
    else if (armTailDipKnife(snapshot.buyDerived)) arms.push('tail_dip_knife'); // FP18 尾部接刀（T182：域内崩塌进行时不接刀——域腿不可去掉，对照组接刀是肥尾机会）
    else if (armExtremeDumpSellers(cd, snapshot.buyDerived)) arms.push('cd412_extreme_dump_sellers');
    else if (armDenseDump(snapshot.buyDerived) && !domFall.observe) arms.push('cd414_dense_dump'); // FP7 短窗持续密集砸盘（observe 命中票排除——famous 场景归观察）
    else if (armSlowPumpUnload(snapshot)) arms.push('slow_pump_unload'); // FP8a 慢拉卸货（长直线缓推+峰后远端+尾声死）
    else if (armFamousHarvestFinal(snapshot)) arms.push('fam_harvested_final'); // FP8b famous 收割完残局（大涨过+已离场+已砸落）
    else if (armFamousBurstWave(snapshot.buyDerived)) arms.push('fam_burst_wave'); // FP9 famous 系突发波（burst 纯 famous 带起来的）
    else if (armFamousLowExit(snapshot)) { // FP10 famous 低价全清冷却（立马接盘 → 拒；豁免=破深≥20 ∧ 末卖后在外流通谷值≤9%，T167b/T167d/28ad 案）
      const ftLow = snapshot.buyDerived && snapshot.buyDerived.famousTraces;
      const breach = famousBreachExemptPct(ftLow);
      // T167d 豁免换轨：出清谷值足够小才算「famous 流量已清场」（null 不豁免保持拦）
      const troughOk = typeof ftLow.postSellTroughPct === 'number' && ftLow.postSellTroughPct <= FAM_LOW_EXIT_TROUGH_EXEMPT_MAX_PCT;
      if (breach === null || breach < FAM_LOW_EXIT_BREACH_EXEMPT_PCT || !troughOk) arms.push('fam_low_exit_cooldown');
    }
    else { // FP11 famous 早窗快闪双支（T171 거침없이/SI 案；FP10 子集形状已被上面更具体码认领）
      const earlyFlip = armFamousEarlyFlip(snapshot);
      if (earlyFlip) arms.push(earlyFlip);
    }
  }
  // T144 活跃度门（BP act 题整题迁入）：PVP 后、CD 臂前
  const activity = enableActivity
    ? judgeActivityLevel(snapshot)
    : { level: null, branch: 'disabled', trace: {} };
  if (activity.level === 'low') arms.push('act_low');
  else if (activity.level === 'ultra') arms.push('act_ultra');
  // FP5 尾声延伸活跃度门：act 族（充分上涨过的票活跃度延伸到前 2 分钟）
  const tail = enableTail
    ? judgeTailPhaseActivity(snapshot)
    : { hit: 0, branch: 'disabled', reason: null, trace: {} };
  if (tail.hit === 1) arms.push(tail.reason);
  // FP3 famous 两法门（一法持重危险/二法收割砸盘）：act 后评（act 拒因优先）
  const famous = enableFamous
    ? judgeFamousDanger(snapshot)
    : { hit: 0, branch: 'disabled', reason: null, trace: {} };
  if (famous.hit === 1) arms.push(famous.reason);
  // FP6 famous 高控+砸落观察臂（标记不拦截——留待找方案；判定已前移 CD414 排除消费）
  const reason = activity.level === 'low' ? 'act_low'
    : (activity.level === 'ultra' ? 'act_ultra' : (pvp.reason || tail.reason || famous.reason || (arms.length ? arms[0] : null)));
  const gates = buildFactorGates({ pvp, activity, famous, tail, domFall, cd, bd: snapshot.buyDerived || {}, armHits: arms });
  return { pass: reason === null, reason, version: FACTOR_PREBUY_VERSION, pvp, activity, tail, famous, arms,
    gates,
    observe: domFall.observe ? { code: 'fam_dominance_fall', ...domFall.trace } : null,
    trace: { ...pvp.trace, act: activity.branch, tail: tail.branch, fam: famous.branch, domFall: domFall.branch } };
}

module.exports = {
  FACTOR_PREBUY_VERSION,
  PVP_TREAT03_BNB, PVP_LEVEL02_BNB, PVP_BUNDLE_BNB,
  ACT_LOW_IDLE_PCT, ACT_DUST_MEDIAN_BNB, ACT_DEAD_THROUGHPUT_BNB_MIN,
  ACT_ONESIDED_BUY_SELL_N, ACT_ONESIDED_BUY_SELL_BNB, ACT_ONESIDED_MAX_DD_PCT,
  ACT_EARLYWIN_SEC, ACT_EARLYWIN_TICKS, ACT_SPARSE_TPM, ACT_SPARSE_IDLE_PCT, ACT_SPARSE_MAX_GAP_SEC,
  ACT_TAIL5_ACTIVATE_N, ACT_TAIL5_ACTIVATE_BNB, ACT_BURST_WAVE_BUY_BNB,
  ACT_ULTRA_SELL_WALLETS, ACT_ULTRA_BUY_N_MAX, ACT_ULTRA_BUY_BNB_MAX, ACT_ULTRA_TPM, ACT_ULTRA_IDLE_PCT,
  TAIL_ATH_VS_LAUNCH_PCT, TAIL_TOTAL_VOLUME_BNB, TAIL_WIN120_TPM_BNB, TAIL_EXT_BUY_BNB,
  FAM_DOM_FALL_DOM_PCT, FAM_DOM_FALL_CHG30_PCT,
  TAIL_BROKE_FLOOR_PCT,
  DENSE_DUMP_MIN_SELLERS, DENSE_DUMP_MIN_SELL_BNB, DENSE_DUMP_MAX_NET_BNB,
  SLOW_PUMP_MIN_POINTS, SLOW_PUMP_MIN_R2, SLOW_PUMP_MIN_SEC_SINCE_ATH, SLOW_PUMP_MAX_TPM120,
  FAM_HARVEST_MIN_ATH_PCT, FAM_HARVEST_MIN_SOLD_RATIO, FAM_HARVEST_MIN_BUY_PCT, FAM_HARVEST_MAX_CHG30_PCT,
  FAM_BURST_MIN_WAVE_BUY_BNB, FAM_BURST_MIN_SHARE_PCT,
  LIFECYCLE_MIN_ATH_PCT, LIFECYCLE_MIN_TOTAL_VOLUME_BNB, LIFECYCLE_BURST_STALL_GAP_SEC,
  LIFECYCLE_BURST_EXEMPT_FLOOR_PCT, armLifecycleBurstResidual,
  HOLDER_SCATTER_MIN_HOLDERS, HOLDER_SCATTER_EXEMPT_TOP1_PCT, HOLDER_SCATTER_EXEMPT_TOP12_PCT,
  armHolderScatter,
  HOLDER_EVEN_CREW_MAX_HHI, HOLDER_EVEN_CREW_MIN_CIRC_PCT, armEvenSplitCrew,
  HOLDER_EVEN_CREW_MAX_HHI, armEvenSplitCrew,
  FAM_LOW_EXIT_MIN_BUY_BNB, FAM_LOW_EXIT_MIN_SOLD_RATIO, FAM_LOW_EXIT_MAX_PRESENCE_BNB,
  FAM_LOW_EXIT_MAX_VS_PCT, FAM_LOW_EXIT_COOLDOWN_SEC,
  DUMP_NO_ABSORB_BNB, DUMP_RATIO_MIN_SELLERS, DUMP_LOW_ABSORPTION_RATIO, BURST_BUNDLE_MIN_WALLETS,
  EXTREME_DUMP_MIN_SELLERS, EXTREME_DUMP_MIN_BNB,
  SBW_PROXY_WAVE_NEAR_SEC, SBW_PROXY_MEDIAN_DUST_BNB,
  BURST_WEAK_PRE_WAVE_BNB,
  BURST_CONTEXT_PRESEG_MIN_BNB, BURST_CONTEXT_PRESEG_MIN_TICKS, burstContextBackgroundCold,
  FAM_HOLDING_SOLD_RATIO, FAM_THIN_TOTAL_BUY_BNB, FAM_DUMPING_CHG30_PCT,
  FAM_HARVEST_SOLD_RATIO, FAM_HARVEST_BUY_PCT, FAM_HARVEST_SELL_PCT,
  judgeRetailPvp, judgeActivityLevel, judgeFamousDanger, judgeTailPhaseActivity,
  judgeFamousDominanceFall, buildFactorGates,
  armDumpNoAbsorption, armDumpLowAbsorption, armBurstExitSellPressure, armBurstBundledWave,
  armBurstWeakWave,
  armExtremeDumpSellers, armDenseDump, armSlowPumpUnload, armFamousHarvestFinal, armFamousBurstWave,
  armFamousLowExit, famousBreachExemptPct, FAM_LOW_EXIT_BREACH_EXEMPT_PCT,
  armFamousEarlyFlip,
  evaluateFactorPreBuy,
};
