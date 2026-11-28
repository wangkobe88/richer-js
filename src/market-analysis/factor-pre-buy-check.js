'use strict';

// T205 活跃度阶段前提共享线（零依赖叶子互引安全——act-stage 本身零项目依赖）
const { isColdStage } = require('./act-stage');
// T210 停滞再启动通路（纯函数判定；线值与头注=stall-restart.js）
const { evaluateStallRestart } = require('./stall-restart');

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
/** （T205b 三反锚常量已随 FP38 撤回整链移除——撤回档见 judgeActivityLevel 段注释） */
/** B1 burst 语境豁免：出口簇买 ≥0.3（CD402 波质量线；背景冷同 T143） */
const ACT_BURST_WAVE_BUY_BNB = 0.3;
/** U1 协同出货臂：末 10s 独立卖钱包 ≥10 ∧ 买入趋零（≤2 笔 ∧ <0.1 BNB——c84a 双边在场防线） */
const ACT_ULTRA_SELL_WALLETS = 10;
const ACT_ULTRA_BUY_N_MAX = 2;
const ACT_ULTRA_BUY_BNB_MAX = 0.1;
/** U2 极端密度臂：≥150 笔/分 ∧ idlePct<5（题面「每秒十笔级」下界；常量 ULTRA_TPM=140 参照） */
const ACT_ULTRA_TPM = 150;
const ACT_ULTRA_IDLE_PCT = 5;

const FACTOR_PREBUY_VERSION = 'FP48'; // FP48=crash 形态复核迁因子门（T243，2026-11-26 用户裁定「crash 形态复核（纯代码：无回调 + 无换手的单边下跌）没有必要做复核了吧，直接就是作为一个因子门不就好了」）：judgeCrashForm 从 BP 因子应答器（BPF2）整体迁入本模块成普通因子臂 crash_form——数值提示臂四选一 ∧ chg5≤-1.5（无回调）∧ 尾 10s 买=0（无换手）∧ 尾 10s 有卖 → 拒；挂在臂链末位（前面各臂都没命中才轮到=原 BP 位置可达的同一批形状），不进 CHEAT_CLASS_ARM_CODES（cheatOnly 类型让位，与 crash_numeric 同约定）；BP 因子代回到只评塞单门（BPF3）。FP47=entry_shape 两因子化（2026-11-24 用户裁定「把一部分 Jev 门改为因子门……有一些地方 Jev 执行的也是死板的计算，使用因子反而更加稳定」+「A 档这几个全都搞吧」——判据已全部数值直供、Jev 只做比较的题改纯代码因子；FP47a judgeMaliciousDump=BP69 malicious_dump 桶四腿/单鲸版/相邻两块臂/贴锚臂（BP82）/总成交额豁免（BP78）代码化；FP47b judgeCrashNumeric=crash 数值判序（急跌进行时 chg5≈chg10 同深/趋势打断三口/臂 A/臂 B 判序四步制）代码化，「无回调+无换手」形态复核（价格拱归纳）留 Jev 兜底——**BP 题面不动、BUY_POINT_QUESTIONS_VERSION 不 bump**（FP 灰关/漏判时 Jev 照判全判据，BP68「E 通道保留兜底」同哲学）；拦截在门链最前=省 AF1+cheat+BP 整次 Jev 调用。FP46=oversell_residual 沉寂豁免（T235，2026-11-24 用户裁定「这个庄的洗筹码的手段，洗完了后沉寂要比较久，可以通过买入前的沉寂时间豁免」——案源 神龙犬 0x3beb…7777：账本零买入钱包 09:24:14 低于发行价卖 1.4481B（curve 外筹码 transfer 分仓指纹）→ 58s 沉寂 → 09:25:12 苏醒买波触发 P1 → FP29 拦 → 前向 +960% 毕业）：oversellSecToAnchor（超卖户最后一笔卖距锚秒数）≥ 55 → 不拦——洗筹离场与买点间隔足够久=洗筹阶段已结束、新一轮启动非接刀；null=证据缺席不豁免保持拦〔FP33/36/39/42/43/45 惯例〕。198 命中面扫描（182 全 factorCheck 实验去重）：≥55s 豁免面 47 行=21 票含 3 mega 赢（3beb +960/7c3ad817 +688/f82b045c +298）+2 中赢（+59/+35）、深跌 5 行多为赢家回撤（唯一坏例 4d31428c flat→-25）；<30s 保持拦面大赢率 4.7%（贴锚出货=接刀盘核心猎区不动）；55s 线与 stall 断流卖腿同族（非类整数线）；60s 最干净但案源 58.2s 恰好被挡。台账 T235+T197 补档。FP45=FP27 换手豁免（T230，2026-11-24 用户裁定「这个门应该是拦截 top 持有者砸盘，但这个 case 其实就是换个手」——GWC 0xb712…7777 波钱包 8s 止盈 23~32% 留仓 68~77% 被误拦、锚后 +900% 案）：top5 每个 60s 窗卖出大户都是窗内净买入者（bigHolderSellerMinBuyRatio60 ≥ 1）→ holder_quiet_unload 不拦——先买后卖留仓=换手/止盈非离场砸盘；null=证据缺席不豁免保持拦；170 命中面扫描：豁免面 fwd30m 中位 14.9% vs 保持拦 7.3%（单调梯度 7.3→14.9→19.1→22.2）。FP44=停滞再启动通路（T210，2026-11-22 金狗 中文房间 0x76b0dc29…7777/铁匠 0x39ed13cc…7777/胖橘貓 0x2335bc48…7777 低活跃误拦案，用户裁定「这个策略从来也不是为了召回所有的好票，只是给一个好票模式一个通路」+「这个通路跟 burst 一样，豁免前面的 cheat/unhealthy（可能会有一些 bad case 但是再看）」）：形状=最后 ≥30s 静默段的出口行是非尘买单且孤笔且信号锚在其上 ∧ 沉寂 ≥60s ∧ 沉寂前独立钱包 ≥12 ∧ 仍持仓者 ≥6 且占前期像样买家 ≥55% ∧ 锚前 ATH<80% ∧ 出口行前总成交 <5B（stall-restart.js 单点，原料=cheat 快照 stallRestart* 九键）；命中时**低活跃五臂整体让位+burst 弱波臂让位**（「低活跃」是沉寂本身；弱波与低活跃同一逻辑=小流量推不翻低活跃），散户 PVP（像样买方缺席——四窗 19 张零右尾）与其它臂照常；活跃度前置门侧同形状走 restart_exempt 跳过作弊门直进 BP（CheatCheckService）。四窗 6.5 天面：83 张松口径形状票→严口径命中 14、补丁后能通过 9（翻倍 4）；无灰度键（FP39/42/43 先例，用户直接裁定）；Jev 题面/state 零改动。台账 T210+金狗 JG-37。FP43=launch_fail_dead 换手豁免腿（2026-11-22 登天猫 0xf38f48cf…7777 案，用户裁定「launch_fail_dead 门，做跟大户买入门同样的豁免」+「确保这个票，在所有门能开的前提下买入」）：FP28 臂加 FP42 同款三键豁免（首波 as-of 全清仓 ∧ 后波 ≥2 家持有 ∧ famous 所在块买入占比 <15%）→ 不拦——早窗点火相位（ath 未爬过 40 线即 fire）与「启动失败死盘」同形，但换手结构自证传播力（首波 sniper 走光+后波有机接盘）。案源：登天猫首评 @19.2s ath 33.5<40 被 FP28 拦（FP42 豁免 big_buy_defer 后首拒点漂移到 FP28=本腿），豁免三键全真（首波清仓✓/后波持3/fam 0%）；FP 全关对照臂（bt-v180）同锚买进 +256%。首评过后 fpRetry 不再发生=T198 arb_bot（26s 机器瞬时库存窗）路径自然绕开。null 任一=豁免证据缺席不豁免保持拦〔FP33/36/39/42 惯例〕；无灰度键（同 FP39/40/42 先例）；豁免线与 FP42 共线（BIG_BUY_DEFER_EXEMPT_* 同源改须两处同改）。台账 T209；FP42=big_buy_defer 换手豁免腿（2026-11-22 JG-32f 立法，用户裁定「go」；用户框架原话「前期 sniper 走光，有人接盘（初步证明了传播力），但接盘的力量不能是 famous + 跟单买入，否则就成了 famous 收割票」——只用于本门豁免场景）：豁免条件=首波（开盘 10s 内买 ≥0.1B）as-of 全清仓（净持≤10% 买）∧ 后波 ≥2 家持有（净持≥50%）∧ famous 所在块（≥2 买钱包）买入占比 <15% → 不推迟直接放行。域内 2×2 验证（182 tmp-jg32f-domain.cjs，FP32 域 374 拒点四窗）：B∧fam<15 n=16 stall +1.62B（唯一正组）fwd 中位 54.6% 肥尾 2（登天猫 918/Greg 222）；B∧fam≥15 n=8 stall −0.20B 零肥尾（B' 臂端到端 5 负 1 微正=丁真/女大/人生指南/MEME 全拦在豁免外）；非 B 组 350 张 stall −4.5B=豁免严格限 B 不外溢。全域独立门已否证勿重提（famBlkBun 无条件分层无判别力+杀金狗尾部，金狗重合 5/30=干净换手型子族）。新键源=buy-point-snapshot launchDefer 三锚扩 firstWaveCleared/laterHolders/famBlockPct（roster 缺失 famBlockPct=null）；null 任一=豁免证据缺席不豁免保持拦〔FP33/36/39 惯例〕。无灰度键（同 FP39/FP40 先例）。台账 T208+金狗 JG-32f；FP41=even_split_crew 实体口径豁免（2026-11-22 JG-31 立法，用户裁定「捆绑购买看成是一个钱包」+「直接立法快速推进先粗糙」：臂加豁免腿 holderHHIEntities ≥0.10 → 不拦——同首买块捆绑钱包合并成实体再算 Σ份额²（用户理念原话「这个门主要是控制在交易中筹码完全分散无主力的票，但如果聚合购买说明多个钱包实质是一个，这与基本理念违背」：本门的对象是『实质主体』而非钱包数，聚合购买的多钱包=一个主体，钱包口径 HHI 把『一个主体分 N 路进场』误量成『N 独立持有者均分』=度量与理念错位，实体口径是忠实度量而非放水豁免）（GMGN 捆绑行为单位口径复现：ZKind 0xa79e 锚同块 6 钱包 0.1B 档全走 GMGN 路由 to=0x1de460f3 gas 全 1M，散户 HHI 0.0746→合并 0.3475=新实体接管 51% 主力盘；等额/等量指纹〔T74/T172〕对滑价序列判不出；FP14 whaleWallets 同块并实体先例同构）；null=豁免证据缺席不豁免保持拦〔FP33/FP36/FP39 惯例〕。全域验证（182 tmp-jg24-fp22-ent.cjs，w1003+w1019 even 命中 161 行）：豁免面 43 行 fwdPeak 中位 +10.8 vs 照拦 +1.7、≥50% 密度 3 倍、零深亏峰、跨窗稳定；单臂真实放行 4 行=ZKind +256%（本尊）+国际脸/0x2bb16aef/만세 三险票知情；伤害面=币安锁型拉高中段簇在场秒砸时点（16 采样 6 豁免 1 个 120s 内遭大卖）知情留档；反证=正票系（不对劲/猫厨师）40/41、6/6 仍拦。新键源=cheat-snapshot holderHHIEntities（firstBuyBlockOf 同首买块合并）→ buy-point-snapshot chip 切片透传；不进题面/state/FA 投影。台账 T207+金狗 JG-31；FP40=tail_no_buyer_pressure 深破豁免（2026-11-22 一姐案 JG-18 续，用户裁定「tail_no_buyer_pressure 同样豁免破发」：FP26 臂加同款豁免腿 launchMinVsFloorPct < TAIL_KNIFE_BREAK_EXEMPT_VS_PCT（与 FP39 同一把线 -10）→ 不拦——深破=跌穿发行价 10pt 跌无可跌，「跌完仍无人接」的下方风险模型同样不再适用；null=豁免证据缺席不豁免保持拦。三窗验证（tmp-fc23-tnb-fwd.cjs 182，单臂拒行 304 首拒行票锚后 30min，w1012 冷窗无单臂拒行）：深破层 51 票损耗最轻（中位 fwd −4.3/深跌仅 1 票〔0xe8cb 吕吕 −39.7 锚后价维度，实际买入走 stallClose 止损 −0.07 级=FP26 原档案案源票知情放回〕）vs 浅破层 117 票较重（−10.2/深跌 2）=与 tail_dip 面（FP39）同构分层方向；右尾薄（0x6d7b minVs−21.4 peak +100%）但期权语义同源。案源链：一姐 FP39 单票实证（cf51c210）t1 被 FP26 接棒拒（15:42:05 尾5s买1∧30s卖5）、t2 即使触发 FP26 同命中（15:42:31 win30卖6∧尾5s买0）——同域围堵臂族二连豁免；一姐 t1 时刻 minVsFloor −5.45 浅破仍拦=线内知情。gates tail_no_buyer 门行 value 加破发%；无灰度键（同 FP39 先例）。台账 T206b+金狗 JG-18；FP39=tail_dip_knife 深破豁免（2026-11-22 一姐 0xfc23…7777 案 JG-18，用户裁定「基于破发的情况豁免 tail_dip_knife——基本到了很底部，没啥可以跌的了」：臂加豁免腿 launchMinVsFloorPct < −10（锚窗滚动最低 vs 地板锚深破 10pt，FP16/FP25/FP32 深破豁免 G1 五连收线同线；CD412 破发豁免 ≤0 是拦方向另一族先例）→ 不拦——破发=这轮下杀已跌穿发行价、下方空间结构性有限，「从高点崩塌进行时别接刀」的风险模型不再适用；null=豁免证据缺席不豁免保持拦（FP33/FP36 fail-closed 惯例）。三窗跨验（bt-v164/w1003 热+bt-v159/w1019 中+bt-v155/w1012 冷，单臂拒行〔arms 恰只含 tail_dip=豁免后真正放回形状〕per-token 首拒行锚后 30min 前向收益）：深破层（<-10）183 票损耗最轻（中位 fwd −3.9/深跌 ≤−30% 仅 2 票〔−34.8/−45.2〕）而浅破层 [-10,0] 306 票最重（中位 −14.0/深跌 10 票）=「刚破一点还在跌的路上，深破才是跌无可跌」分层方向与用户语义精确吻合；右尾 5 票 ≥+100%（一姐 +585% fwd/+607% peak 领衔、0xe7b1 +587%/0xbb7b +124% fwd/+424% peak）=FP33 同款期权结构；敏感性：线放 ≤0（CD412 同线）面翻倍至 489 票且浅破层损耗最重不取；0x6dc1（−9.66，peak +107%）卡线外留拦=知情代价。案源：一姐 15:42:32 P1 第二次触发被 tail_dip_knife 拒（minVsFloor −11.21/chg30 −32.8），预算 2/2 耗尽后 15:43:02 主升 burst 0.76B 单秒穿 28.5% 域（debounce 末笔重读吞窗=必然机制非问题，用户裁定），价格 +350% 毕业零成交。无灰度键（三窗验证毕+用户直接裁定，FP36 同款先例）；gates 门行 value 加破发%展示。台账交易 T206+金狗 JG-18；FP38=T205b 三反锚撤回（2026-11-22 v174 对拍否证——A 纯卖触发/B 复活已展开/C mbc≤2 三腿标定 41.9%→50% 但重放反降 39.9%/+1.17 vs v173 41.9%/+1.41：C 腿代理失真切正脸 28 票 +0.35、三键保真漂移漏切 55 张坏面；「留痕 metadata 标定→运行时快照实现」链路结构性不可靠+Jev 重掷面不稳；撤回=放行条件回到纯 isColdStage(ath<80)；FP37 仅存在于研究臂 v174 未投产；勿重提同族提案除非键保真先解）；FP37=T205b 阶段放行三反锚（2026-11-21 用户裁定「落 ABC，胜率保持的高一点」——T205 对拍增量面 215 票（both−ctrl）胜率 41.9% 净 +1.408，三个坏面刀口组合后 110 票胜率 50.0% 净 +1.838 双升；**只作用于 stageCold 放行路径**（actStageColdExempt 开且未火过时才评，火过票/非放行票行为不变），三腿全 fail-closed（证据缺席不释放）：A=触发窗买方在场 nearTail10BuyN≥1（=0 纯卖漂移触发的信号不释——20 票 20% 胜率 Σ−0.243 零尾；⚠GWC 原案 0xb712 即此形状=知情代价，重放中它本就死 FP27 top5 卖 0.164B 轻出货臂，救赎在 FP27 攒批另案）；B=窗口真静 idlePct≥40（<40=放行时复活已全面展开、追进行中的泵不释——56 票 34% 胜率 Σ−0.471 零尾）；C=同块买入波在场 cd.maxBlockBuyCount>2（D3.35 数值锚代理 cheat levels sameBlockBuyWave=0 死区——Jev 答案 FP 时序拿不到；代理标定：mbc≤2 面 60 票 33% 胜率 Σ−0.02 与 sbwLv=0 面交集 46/49，mbc[3,4] 段 112 票 43% Σ+0.99 是肉必须放线不可上移）。否证留档：D=ath[40,80) 段收回净额亏（切面 +0.209 在切盈利质量）不落；A∪B∪C∪E(curVs<10) 胜率 59.3% 但净额跌破基线不落。灰度键 rides actStageColdExempt（无新键， attribution=v173 vs v174 对拍）；台账金狗 JG-15+交易 T205b）；FP36=T198b arbBot 持筹垄断臂流通腿豁免（2026-11-21 案源 0x2ee9…7777 误伤票——两镜像 sandwich_bot〔0xedcbcc31/0x073c01e7，等额同块差 ~30 log 位全天往返、30d 画像 3k 笔/1.5k 票/胜率 23-28%〕锚点瞬时库存 31→35% 被「机器坐筹」误读，5 分钟后两波砸给拉升、锚后 ~6.9×；信号页已加 ⚙️机器钱包图标记同窗落地）：流通小时「在场流通占比」被小分母放大、机器占总供应比例小（0x2ee9 流通 13.7%×35%≈总供应 4.8%）垄断名不副实砸不深——**arb_bot_holdings 加流通腿：chip.circSupplyPct <16.5（FP22 同线）豁免放行**；四窗验证（v164 热窗 419 命中行 metadata 真值+182 replay 老三窗 v159/v155/v145 现存真身 14 命中）：深跌分离稳健——放回面（流通<16.5）288 行前向 **0 票 ≤−30%**（最差 −26.9%）vs 保留面 130 行 15 票深跌；右尾集中热窗（放回面 ≥+100% 9 行全在 v164）；期权结构知情：冷窗放回面 9 行 ret30 全负 0 右尾=损耗面、期望靠 0x2ee9 单票撑（纯成交面 31 行约打平）；敏感性线 10/12 丢右尾（0x2ee9@14.5/Username123@16.1）；null=流通证据缺席不豁免保持拦（FP33 豁免 fail-closed 惯例）；无灰度键（四窗验证已毕用户直接裁定立法，FP22 流通腿同款先例）；台账 T198b）；FP35=T205 活跃度阶段前提+尾部接刀量腿（2026-11-21 金狗 GWC 0xb71209cb…7777 复活拉回误杀案——死盘 56min→0.84B 真金复活→4 笔尘埃卖 0.164B 在空簿打出 -6% 被 tail_dip_knife+act_low 双拦，锚后 +932% 毕业；用户两原则：①活跃度拦截的价值在「火过一段时间后 low=流动性失去」，前期（未火过）不该管——**act low 家族加阶段前提 isColdStage(athVsLaunchPct)=锚前 ATH<80（FP27 同线，共享线 act-stage.js）时 low 五臂让位**（ultra 刻意不受影响=协同出货是当下事实非静默语义；ath null=照拦 fail-closed；灰度键 buyPointCheck.factorCheck.actStageColdExempt 缺省 false）；②量极少的跌不是从高点下来的——**tail_dip_knife 加必要腿锚前 30s 卖额≥0.3B**（TAIL_KNIFE_MIN_DIP_SELL_BNB，CD401 像样卖压同线；灰度键 buyPointCheck.factorCheck.tailDipVolumeLeg 缺省 false；win30 缺席=臂不触发）。同原则贯通 AF1 reject_low 与 cheat 分级门 E 通道（cheatCheck.gate.actStageColdExempt，CheatCheckService/cheat-grade 侧）——低活跃票的最终守门员是 cheat E 通道，不贯通则 FP/AF1 放行的 low 票死在下游（新 snapshot 键 cheat derived.athVsLaunchPct 地板锚）。三窗面（bt-v164/159/155）：act 语义拒绝 2054 票 ATH<80 带右尾 8.7%/死 63% vs ≥80 带 6.5%/71%（未火过带全面更肥；金狗 30 票 9 票 ≥100% 右尾死于此面）；量轴：td+act 双拦∧卖<0.3∧ATH<80=149 票右尾 9.4%/死 44% 全场最肥（纯 td∧卖<0.3 131 票 4.6%=量腿单独放行价值一般、与阶段前提交集才是肥面=空簿漂移让 act 与 tail_dip 同时误命中的同源误读）；台账金狗 JG-15+交易 T205）；FP34=JG-6c 豁免族扩两臂（2026-11-21 用户裁定「只豁免 tail_dip_knife + tail_no_buyer_pressure」：983 票全集首拦行伴随臂实证两臂互为同域围堵主力[130 张重叠/tail_no_buyer 伴随 16 张在 JG6 面]，lifecycle 两臂拦截极准[42 张仅 2 右尾]不进豁免族、act 族不进[首拦行零伴随命中只挡加仓路径]；灰度键/九腿形状/null 语义同 FP33 不变；留痕新增 verdict.tailNoBuyerExempt+trace.tailNoBuyerExempt）；FP33=JG6 tail_dip 有机盘豁免（2026-11-21 金狗 쿠우타 0xc0e896dd…7777 案——金狗集合 30 票 25 拦引出「因子门合理性」专项：T182 尾部接刀臂 w1003 被拦 375 票里右尾 9%（32 票 ≥+100%、金狗 6 张全头部）真实存在但流量筹码轴（trendFactors AUC 扫描）与做市商痕迹轴（cheatDerived AUC 扫描）双双分离不足（最佳单键 AUC 0.73、组合后右尾覆盖 60-78% 必然带 26-46% 主体误伤、命中主体一半死透）→ 用户五轮肉眼精化迭代出「有机盘豁免」形状：**tail_dip_knife 命中时九腿全真豁免放行**（washPairCount=0 无对敲〔null=零对敲与 0 同判〕∧ noBuySellPct<10 无 insider 抛货 ∧ holderHHI<0.2 筹码分散 ∧ totalBuyBnb∈[3,8] 量级带〔**上界 8=零损失强腿**——右尾 10 票全 ≤7.6B、巨量主体 22 张被滤=「量特别多注意力释放完毕」用户判据〕∧ routerEntryBuyPct≥60 散户通道 ∧ top1BuyPct<15 无大户主导 ∧ sameBlockHoldCircPct≤60 无捆绑持仓〔cd 口径替代 FA bundleClusterHoldCircPct——Eagle 反例 83.2%/쿠우타 53.1%/SI 20.5%〕∧ famousTraces.groupBuyBnb≥0.1 famous 参与〔**杠杆最大腿**——损耗面 w1019 10→2/w1012 10→6/w1003 主体无一 ≥30% 峰全死透止损干净；放弃的 3 张全在 +103~208% 低段、保住的 5 张全 ≥+494% 头部〕∧ famousCohortMaxWallets≤3 famous 无重跟单〔kroea 反例=4 vs 쿠우타=3〕）；**三窗跨验（w1003 bt-v164/w1019 bt-v159/w1012 bt-v155——w1103 实验早于 T182 上线无拒行）**：右尾 5（+494~+1030%）/损耗 21（其中中国奶娃/地鼠有 cheat 拉黑白名单+清仓联动快刀、4 张 40-77% 中间带）=期权结构（平时小额损耗换行情日爆发，粗估 0.2B/票 30% 兑现三窗净 +1.5B）；AF1 门链验证：28 张命中 27 张 act=mid/high 全过（T182 触发域=急跌中有成交天然不 low，AF1 与本形状正交）；门链时序验证：右尾 5/5 首个纯 tail_dip 行在场豁免即成交（洛天依首行 big_buy_defer 双臂、45s 推迟窗后 11:33 纯行）；「其他臂兜底损耗」否证（libido/持枪仓鼠 fam_low_exit 命中晚于首买 1 分钟=时序错开先买后被砸）；「距 famous 末卖」不可成腿（损耗组 1~57s 与正例组 55~59s 同分布——libido 的 famous 是砸盘主角/쿠우타 是 8% 小配角，盘面锚不可分）；灰度键 buyPointCheck.factorCheck.tailDipOrganicExempt **缺省 false=关**（enableTailDipExempt opts 透传）；null 语义=豁免证据缺席不豁免保持拦（宁拦不冒充，各腿 typeof 校验）；**新 snapshot 键 famousCohortMaxWallets**（famous 任一买块内非 famous 独立买钱包数 max——人头口径与 famousFollowBnb 金额口径刻意分开）；台账 JG-6（金狗）+交易台账 FP33）；FP32=T201 大户推迟臂 big_buy_defer（2026-11-20 행복의 날개 0x7b0c9b1b…7777 案引出——用户裁定「放到因子过滤模块后，才能支持比较复杂的策略（后续的改进）」选 A 形态迁移：ladder v34 G2 大户推迟门自条件串整段迁入本模块，T180/FP17 同款迁移先例；判定线与条件串时代逐字一致（≥0.79 档→首笔交易+45s、≥1 档→60s、深破<−10 豁免），键源 buyDerived.launchDefer 三锚=FA launchBigBuyBnb（0.19 线+T172/T173 同块等额合并镜像）/sinceFirstTradeSec（T149 首笔可靠买价锚镜像）/launchMinVsFloorPct（T145 锚窗版直传）；键缺席不评=放行（launchSquad 同约定）；⚠消耗语义变化（用户知情）：FP 拒=fire 已消耗 maxTriggers+T110 桶，推迟窗近触发现在落行留痕可定位（此前 condition 层零留痕——本案排查需逐 tick 手工重放条件串才能定位即此痛点）；台账 T201）；FP31=fam_holding_thin 中等跟单豁免（2026-11-20 bt-v163 对拍 5 张方差票引出 famous 跟单研究——YC 案 roster 漂移误拦暴露 thin 分支、用户假设「不怕 famous 砸盘怕跟单卖压」四窗 98 票 famous 在场票真重放验证：宽定义〔首买后全窗非 fam 买〕fam<0.2∧跟单≥1.5 唯一负组表面支持，但用户裁定**slot 级窄定义**〔同 slot+2 内非 fam 买，block 差∈[0,2]≈2.25s〕归因更干净——宽定义把远端独立买入错归因〔蚊脑 0x..宽 3.39B 窄仅 0.002B〕；窄定义下 fam<0.2 域呈 **U 型非单调**：零响应 <0.05B 5 票 win20%〔对倒无人问津〕/中等响应 [0.05,0.2) 7 票 **win71% 最好带**〔有机热度〕/重跟单 ≥0.2 13 票 win31%〔泡沫〕；fam≥0.3 大买域跟单再重也正〔29 票 Σ+2.07 memes/PIKACAT 在此〕=「不怕 famous 砸除非买很大」半句成立；famous 老仓〔首买距锚>180s〕17 票 win82% 最稳；用户裁定「中等跟单 0.05~0.2 可以先豁免」——thin 分支〔soldRatio<0.7∧totalBuy<3∧wallets>0〕命中且 famousFollowBnb∈[0.05,0.2) → 豁免放行 branch=fam_holding_thin_exempt_follow；**新 snapshot 键 famousFollowBnb**〔famousTraces 同源：群体首买 block 起 3 slot 内非 fam BUY 合计；首买 block 缺失→null 豁免证据缺席不豁免保持拦宁拦不冒充〕；thin 四窗成交面仅 3 票存在感极低=本豁免主要价值在前瞻保护+YC 类 roster 漂移误拦的减害；豁免带两端外〔<0.05 零响应/≥0.2 泡沫〕照拦；台账 T200；FP30=机器持筹垄断臂（2026-11-20 用户裁定「arbBot 持仓占比直接落因子门」：arbBot 组净持筹占在场流通 ≥30%〔D3.35 Σ正净分母；snapshot 注入钱包集（GMGN 画像 arbitrager/sandwich_bot/wash_trader 并集）service 进程启动预加载静态快照——**信号路径零查库**〕→ 拒 arb_bot_holdings——「机器坐着筹码」存量口径死盘：套利/三明治/洗盘机器组合计坐掉三成在场流通=无有机持有人纯机器互吃；**流量轴结构性失明的补集**——机器买完停止买入后流量降回 11~18% 但筹码坐着（0x788fd8a9 流 11%/持 45%、0x64ed2dab 流 9%/持 61% 类形状只有本口径可见）；案源链=0x4fe71b 庄 55s 脉冲案引出用户洞察「不能光看参与者，得看买入点位的持仓比例」——持仓口径把流量同形的赢/输分开（28ad top1 29%/正持人 8 筹码摊开 vs 死盘 top1 36~76%/正持人 3~7 坐着等接盘）；四窗跨验〔w1003 热 v162/w1019 中 v158/w1012 中 v150/w1103 冷 v145〕23 票 6 胜净 −0.23 **四窗全负**（−0.15/−0.04/−0.01/−0.03）零大赢误伤（28ad arb 持 24%/ba5e 0% 天然门外=与流量版 r60/arbBot 流量轴的本质差异）；线值 30=四窗校准（10~30% 带 +1.93 正不带中间带）；净额可负（组清仓离场恒放行）/null 容缺不拦〔钱包集未注入/wallets 空〕/空集 fail-open 臂钝化；同轮发现存档（memory router-entry-gate-not-viable）：流量版 arbBot≥20% 18 票 −0.29 四窗全负（攒批并入本臂域）、arbBot 流量 (0,5%)=全场最优带（正向倾斜候选勿拦）、画像占比/gmgnUser 占比=有梯度无负袋（28ad 永在大头格=人群质量轴负端不可拦的结构性天花板）；台账 T198；FP29=分仓出货残局盘臂（2026-11-20 CI 0xf818ac2c/MOLLY 0xd657ad14 工厂流水线死盘取证立法——用户点「味道很像」深查出同一生态：CI creator 0x6ce58d1f 三天发 92 票的 flap 工厂、MOLLY 出货户 0x04d7cae5 买 0.246 卖 1.321（筹码全来自 creator 链上 transfer 分仓）+ 三胞胎等额同块对倒 0.247×3 + 真实外部买方=0，引擎买入后 90s 断流 stallClose 离场 −26%/−33%；用户裁定立法「这个需要立一个门……放到活跃度检测这个环节，或者在因子过滤环节拦住也行」→ 研究三轮收敛（等额簇/self-wash 无分离力否证、「同步卖出」腿买点不可见结构性不可用）→ **落 FP 因子门（纯代码数值臂，挂点=门链最前省 Jev+零判读模糊，CD400 先例路线）**：**oversellBnb≥0.5B（超卖钱包合计——单钱包卖 ≥0.3B ∧ 卖>买×1.5=curve 外筹码来源账户，transfer 分仓在买卖账本上的唯一可见指纹）∧ anchorWalletN≤12（锚窗独立钱包数=微型盘无真实参与者群体）→ 拒 oversell_residual**——「活跃度是自产的」：分仓账户在出货+盘面参与者极少，对倒制造的假活跃骗过 act 门。四窗跨窗验证〔w1003 热 v162/w1019 中 v158/w1012 中 v150/w1103 冷 v145〕**9 票全负零正票 Σ−0.147**（MOLLY −0.0654/ZEC −0.0627/OOC 超卖最重 1.44B/BI 1.20B/nissan/岳不群 OOC ZEC calico FROGE FLOW 平），与 FP26/27/28 命中面零重叠净增量 8~9 票（MOLLY 或被 FP28 先拦）；**两腿缺一不可=组合分离**：超卖单腿 92 票 Σ+0.71 正（creator 预留筹码兑现遍地——Tiltpad +0.246/ASTER +0.15/PIKACAT +0.28 正票都有「买 0.00 卖 0.3」钱包）、钱包≤10 单腿 114 票 Σ+1.21 正（小盘本身非空头信号）、合取才全负；敏感性：钱包 12→14 翻正（Σ+0.047，13/14 钱包票有真实参与者群——**钱包 ≤12 是硬腿**）、量线 0.4 引 2 正票 Σ0.023/0.6 丢 4 票=0.5 最优带；同轮否证勿重跑：**等额同块买入簇**（56 票 26 正 Σ+1.35——GMGN 跟单生态常态，memes +1.43 即 7 钱包等额 0.11 跟单）/ **self-wash 同钱包先卖后买**（11 票 3 正 Σ+0.29）均无分离力不可立法；**「同步卖出」维度买点不可见**（三胞胎 07:32:01 才同块卖、买点 07:31:54 看不到——只能做卖出侧信号 T161/T167 同族，买点门结构性用不了）；**CI 型（纯对倒无 transfer 超卖）不在域内=知情缺口**（CI oversell=0：creator 0.625/0.497=1.26 倍、对倒手 0.889/1.004=0.88 倍均真实买卖闭环）待 creator 维度（连环发币工厂指纹）另案研究；新 snapshot 键 oversellBnb/oversellerN/anchorWalletN（aggregateWallets per-wallet 买/卖账本剔路由，两处常量 BP_OVERSELL_WALLET_MIN_BNB=0.3/BP_OVERSELL_BUY_RATIO=1.5 提取口径线在 snapshot 侧、门线 0.5/12 在臂侧）；null 容缺不触发〔宁漏不冒充〕；台账 T197；FP28=早窗启动失败死盘臂（2026-11-20 bt-v162〔d29420e7 10-03~05 48h sender 完备热窗首测〕因子分析立法，用户看 43 票信号页后裁定「改成 7 秒吧，然后落吧」：**athVsLaunchPct<40（开盘以来从没拉起来过——FP18 域〔ath≥40「涨过又崩」〕的镜像盲区）∧ tokenAgeSec<90（早窗开盘段）∧ nearTail7BuyN≤2（锚前最后 7s 买入笔数——买点此刻尾段没人买）→ 拒 launch_fail_dead**——「启动失败死盘」：开盘一分半内 ATH 没超过 40%、买点时刻尾 7 秒至多 2 笔买入、卖单寥寥（selN 大多 1~4=FP26 的 selN≥5 卖压带够不着）——买入后直接断流出场。四窗跨窗验证〔w1003 热 v162/w1019 中 v158/w1012 中 v150/w1103 冷 v145，全部 sender 完备窗〕**43 票胜 8 净 −0.631 四窗全负**（−0.312/−0.087/−0.069/−0.164），误伤面 8 张正票全部 ≤+0.043 零大赢（最大 Bramble +0.043/Missy +0.0405/车水马龙 +0.039）；**t5N 腿是分离关键**：去掉该腿（仅 ath<40∧age<90）四窗合计 +0.70 正——同样低 ATH 早龄但尾段买力 ≥3 的票是「正在启动」的好票，三腿合取=「启动失败」的精确定义；**7s 窗取代 5s 窗=用户裁定**（Missy 0x89aa…7777 实证：尾 5s 0 笔但 t-6s 三笔真实买力恰在格外=5s 窗边界效应，6/7s 窗=3 笔即救出 +0.0405；唐三角 0x5be3…7777 对照 [2,2,2] 三窗同值=真死盘救不回；凑凑 0xb921…7777 同款边界票 t-6s 有 0.49B 买力）；**新 snapshot 键 nearTail7BuyN**（锚前 7s 买入笔数，行数口径与 nearTail5 族同构并存——5s 族仍是 BP 题面判读原料题集不 bump，7s 单键仅本臂消费）；案源亏票：Maggie −0.068/MOLLY −0.065/小团子 −0.046〔热窗〕、Ardot −0.045〔冷窗〕、小克劳德 −0.040/AU −0.039〔中温〕全带 exit=stall:almost；与 FP18 正交=域互补（涨过又崩 vs 从没涨起）、与 FP26 正交=卖压带外（selN 无要求）、act 门外（AF 常判 high/mid 有流量）；挂 FP26 后同「尾段买力」族相邻（FP26 更具体的卖压证据先认领）；null 容缺不触发〔宁漏不冒充〕；同轮否证勿重跑：W3 未收复深跌热窗版〔三窗大翻正 w1103 +1.58〕、W4 单庄轻出货〔三窗翻正〕、W2 FP27 域外 bhs 带〔混合〕、W5 t5N≤2∧轻卖压带〔w1012 +0.089 翻正攒批〕）；FP27=大户静默卸货臂（2026-11-19 bt-v158 因子分析续挖立法，用户裁定「先落吧」：bigHolderSellBnb60∈[0.1,0.3)〔top5 正净持仓者 60s 轻量出货带——锚窗全量 ticks 算 per-wallet 净 token 持仓〔买加卖减、剔 9 址聚合路由伪钱包〕取正净 top5，**清仓离场者净 ≤0 自动出局**=本键天然只量在场持有者〕∧ athVsLaunchPct<80〔票还没走完一轮大周期〕→ 拒 holder_quiet_unload——「上升/中途庄提前离场」：还持有大量筹码的人在偷偷卖而生命周期尚未走完，此时出货=阴跌抽血前兆非兑现；三窗重放〔w1019/w1012/w1103〕**21 票胜 5 净 −0.374 三窗全负**（w1019 −0.250〔9 票含 Tự do −0.074/大小姐 −0.070〕/w1012 −0.100/w1103 −0.024），误伤面仅 5 张全部 ≤+0.03〔最大天狗 +0.029/水军 +0.026/Doki +0.0096〕零大赢票；与 FP16/FP25〔ath≥100 走完一轮残局门〕互补=**生命周期两方向闭环**（ATH<80 途中离场 vs ≥100 走完残局）；**⚠上界 0.3 必须=非单调实证**：bhs≥0.3 重出货三窗反而 +0.30 正——重砸=换手完成有人接走〔ASTER 类深砸重启形状〕，轻出货 0.1~0.3 才是抽血；ath<80 单独三窗 +5.13 正=分离来自组合非 ath 腿；**famous/聪明钱不合并**〔2026-11-19 三口径对拍否证：top5∪famous(37址)∪smartmoney(158址) 独有增量三窗净 +1.44 伤——memes famous 卖 0.35 仍 +142% 一票否决、CMC sm 卖 0.31 仍 +17%；名单钱包「在场重仓持有」已在 top5 隐式覆盖、已边卖边走〔top5=0〕的裸卖出额无分离力——现有 famous 门族全带形状腿〔FP10 全清+低价域/FP9 波内占比/FP11 快闪〕正因如此，维持纯结构口径〕；与 FP26 命中面重叠〔大小姐/라이언断流族〕→ 挂 FP26 后=断流预测器先认领、本臂接住非 FP26 的出货票；键源 buyDerived.bigHolderSellBnb60+athVsLaunchPct 现成键零新增；null 容缺不触发〔宁漏不冒充〕）；FP26=尾段买力枯竭+卖压在场臂（2026-11-19 bt-v158〔7ae8e398 win1019 48h 全门链〕交易数据因子分析立法——用户确认形状「30 秒内的活跃度相当部分被卖出掌控，买入又偏弱」+裁定落 FP26：win30 卖单 ≥5 笔〔流量被卖方掌控〕∧ 尾 5s 买入 ≤1 笔〔买点此刻接盘的人已经走了〕→ 拒 tail_no_buyer_pressure——「卖压驱动的假活跃」死盘：卖单滚动维持吞吐 4~5B/min〔act 族 L1~L5「吞吐死寂 <1B/min」线结构性失明——方向性信息无消费者〕、买方缺席，买入后唯一流动性来源=新买家进场而尾段明示不在场；三窗重放〔w1019 bt-v158/w1012 bt-v150/w1103 bt-v145，273 成交票〕**20 票 0 胜 17 负 2 平净 −0.44**，w1019 命中 8 票含该窗前两大亏〔大小姐 0x1ec898…7777 −0.0699/吕吕 0xe8cb59…7777 −0.0693〕且 8/8 全部断流出场〔stallClose〕；阈值敏感性 selN=5 最优〔4 引入 3 张赢票/8 丢命中面〕；sbw 腿可省〔sbw=burst 子集仅 1 票 −0.018 也负——纯数值版无前视问题可直接挂最前门〕；与 CD414（重砸盘 15 钱包/2B/净−1.5）正交=互斥序在 cd414 后重砸盘码先认领、本臂管线外轻量阴跌；与 FP18（进行时崩塌 chg5/chg30 双负）正交=不限动量管「跌完仍无人接」〔命中面 FP18 形状仅 5/20〕；BP74「买入力在场豁免」〔尾10s 买≥3∧0.1B 放行〕的纯代码反向镜像——题面判读 Jev 未稳定执行〔BP61 铁律又一支〕；边缘命中票阿峰理论 0x0524…57777〔开盘收割余波型：净流 +0.44 但尾 5s 仅 1 笔买、unrec −9.71 恰浅于已否证 A1 臂 −10 线从缝里漏过被本臂接住〕；否证面勿重跑：D1 尾10s卖钱包≥2∧win30卖≥7 三窗全伤〔w1103 +1.62〕、A2/A3 未收复深跌族 win1012/1103 翻坏、sbw 数值代理 burst5Bnb<0.3 分布重叠不可行；键源 buyDerived.activity.nearTail5BuyN+win[30].sellN〔纯现成键零新增 snapshot 键〕；null 容缺不触发〔宁漏不冒充〕）；FP25=T192 大周期卖压残局臂（2026-11-19 bt-v156 0x54e33173…7777 案，用户裁定「这个不是 burst，但从我的角度也应该被拦」+「这种小反弹在代币尾声状态应该都起不来」：走完一轮 ath124.4%/总额15.67B 的票 32s 静默后卖单砸簇〔簇卖占 58.7%/0.49B，+10s 4 钱包同秒卖 0.338B〕+17s 双买反弹，ladder 腿恰在反弹瞬间 fire〔chg5 +7.91 废 FP18「进行时」两腿刀〕→ 买入 90s 断流 almost 延长档平手出局 −0.0034。FP16 六腿里总额/ath/静默/波买全过、卡在 D3.67 波锚 null——按笔数最密 5s 窗被卖簇劫持窗内零 BUY → sinceWaveEnd 无法计算 → 波近锚腿证据缺席 fail-open〔FP16 与 CD401 的簇键/D3.67 波键两族口径混用结构性缝〕。臂=FP16 同主干〔ath≥100∧总额≥11∧静默≥30s∧深破豁免<−10 全复用〕+CD407 最大流量簇两腿〔卖占比≥50∧卖额≥0.3=CD401 同线〕+簇贴近锚〔**新 snapshot 键 burstSecSinceSegEnd**=簇末行距窗末秒，D3.67 波锚卖簇劫持形状结构性 null 本键以簇自身末行定位〕→ 拒 lifecycle_sell_residual；买入涌入归 FP16、卖出砸出归本臂两臂对称分工不修波定位器；今晨双门 FP21〔posH=22<25 户数腿失〕/FP22〔HHI=0.126≥0.10 集中度腿失〕均差一点且均系筹码维度非生命周期维度天然不管此形）；FP24=T191 FP16 总额线降线 15→11（chibi 0x854d4f2f…7777 案：总额 11.5295<15 漏面，用户裁定「接受这个误伤」案源锚定取整；T∈[10,11.5] 两窗拦面全同=带内数据等价；深破豁免腿不动两张真重启票正确放行）；FP23=T190 相邻双块捆绑砸盘尾承接臂（2026-11-19 bt-v156 0x2b63c82e…7777 ASCEND「大量捆绑砸盘尾声票」案立法，用户选线 CD403 卖方 ≥8 只拦极端+追裁定「偏前期」案特性（后期代币下跌段连续两 slot 砸盘 8 个=正常市场化抛售不拦，注意误伤）：**前期域 票龄≤600s** ∧ dump2Block 卖方≥8 ∧ 合并卖额≥0.5B ∧ 跌幅≤-10% ∧ 距锚≤60s ∧ 承接比<0.3 → 拒 dump_pair_low_absorption〔CD403 单块 ≥0.5B 达标口径对跨两块分摊捆绑砸盘结构性失明的补集；BP78 总额≥20B 豁免照抄；三窗重放拦本案 1 票全负零误伤、AZ 案票 0x397a 五卖方用户知情漏〕；键源 buyDerived.dump2Block+tokenAgeSec——sellers 剔路由/dropPct 含 outlier 事实口径/followBuyBnb 已剔 BP85 闪进闪出）；FP22=T188 持仓均等作弊仓臂（筹码结构维度二连——2026-11-19 用户裁定「HHI 这么低是作弊票的概率比较高」「这一窗算是持仓均等异常的作弊仓，没有明显误伤，可以落」+同日二修流通腿「只控流动筹码比例高一些的——『不对劲』这种我还想救一救」线值三裁取 16.5：HHI<0.10 ∧ 流通≥16.5 → 拒 even_split_crew 团伙分仓已派发指纹〔四窗验证：拦 11 票 −0.252 大亏全拦〔0x531d/CEPE/DND/低电量/치이카와/Burn〕/救 16 票 +0.473 大肉全保〔不对劲 +131/猫厨师 +55/프론티어 +38/大美 +24〕；键源 cheat-snapshot holderHHI+circSupplyPct→buyDerived.chip；HHI=Σ份额² 对尾部尘埃免疫与基尼互补〕；FP21=T187 持有者打散臂（筹码结构维度立法——2026-11-19 用户裁定「代币已经交易了一段时间，参与者比较多，筹码已经完全打乱形不成主力了」+「通过 top1-2 的集中度把薄肌俱乐部救回来」+「落到因子过滤模块即可」：正净持有者 ≥25 ∧ top1-2 集中度不足 → 拒 holder_scatter，豁免=top1HoldCircPct≥45 ∨ top1Top2HoldCircPct≥60（有主力承接在场——两窗 bt-v155/156 全成交面 16 票 −0.30 止血/误伤 3 正票 +0.109 用户知情接受〔雅迪X5 0x0c959153 realPct+24 但闪跌闪拉真实交易吃不到点位〕；键源 buyDerived.chip〔CD 锚窗口径 posHolderCount/holdingsProfile circPct，D3.35 在场流通分母〕；两窗豁免臂零触发=纯前瞻保护，薄肌 0x51a17dda h=19 天然不进门）；FP20=T167d FP10 豁免换轨：末卖后在外流通谷值≤9%（T167c 10s 冷却线随退役——距锚随时间过线=多信号自愈 bt-v154 实证仅推迟 4s；谷值只随真实卖回下降，出清更深=语义自洽），0x6075 苏琳案二修；FP19=T167c FP10 豁免最短冷却（破发豁免须距 famous 末卖 ≥10s——末卖数秒内深破=砸落进行时非清场完成，0x6075 苏琳案四张真空接刀 −0.149 止血、28ad dist=16s 精确保留豁免，10s 取线留 6s 余量防同型票 dist 浮动误杀 +1.4 级尾部）；FP18=T182 尾部接刀臂（域内崩塌进行时不接刀：拉高过+回低位 ∧ chg5<-5 ∧ chg30<-5 → 拒 tail_dip_knife，bt-v147 0x51d9e360…7777 案研究立法——域腿不可去掉，对照组接刀是肥尾机会）；FP17=T180 首两波大部队×高占比（wave≥8 ∧ dom≥30 不买，0x17b09420…7777 案；首落 ladder v32 后同日用户裁定迁移本模块「放到因子过滤模块吧，不要放到信号触发模块了」——键源 buyDerived.launchSquad 两锚）；FP16=大周期 burst 残局（走过一轮+burst 不买，bt-v147 瓦尔哈案）；FP15=T174b burst 弱波大户合并口径（同块∨同额并为一个钱包，M4GA 案）；T175 N 升格臂同日证伪撤回（见 enableCheatArms 段注释）

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
/**
 * T205 量腿（fix②，2026-11-21 金狗 GWC 0xb71209cb…7777 案）：尾部接刀的「崩塌
 * 进行时」必须是**有量的跌**——锚前 30s 卖额 < 此线=空簿尘埃漂移非「从高点
 * 下来」（用户判据），不拦。CD401/CD403/T192「像样卖压」同线 0.3B。案源
 * GWC：56 分钟死盘上 4 笔尘埃卖共 0.164B 打出 -6%（chg5=chg10=chg30 全等
 * =30s 窗内唯一一组变价）触发本臂误拦，锚后 +932% 毕业；三窗面：卖<0.3B
 * 子面右尾 6.5-8.6%/死透 43-60%（≥0.5B 有量崩塌带 7.4%/67%），td+act 双拦
 * ∧卖<0.3∧ATH<80 的 GWC 类面 149 票右尾 9.4%/死透 44%=全场最肥。灰度键
 * buyPointCheck.factorCheck.tailDipVolumeLeg 缺省 false=关（enableTailDipVolumeLeg
 * opts 透传）；win30 卖额缺席=臂不触发（本臂 null 容缺同哲学）。
 */
const TAIL_KNIFE_MIN_DIP_SELL_BNB = 0.3;

/** FP39/FP40 深破豁免线（tail_dip_knife + tail_no_buyer_pressure 两臂共用）：
 *  launchMinVsFloorPct < 此值（锚窗滚动最低 vs 地板锚）→ 豁免不拦（一姐 0xfc23
 *  案用户裁定；FP16/FP25/FP32 深破豁免 G1 五连收线同线；
 *  null=豁免证据缺席不豁免保持拦） */
const TAIL_KNIFE_BREAK_EXEMPT_VS_PCT = -10;

// ── FP33/JG6 tail_dip 有机盘豁免线（2026-11-21 金狗 쿠우타 案三窗跨验线；
//    全部 cd/famousTraces 自足键——不依赖 FA 因子，回测/实时同源）──
const TAIL_DIP_EXEMPT_MIN_TOTAL_BUY_BNB = 3;      // 量级下界：火过（足量真实买入）
const TAIL_DIP_EXEMPT_MAX_TOTAL_BUY_BNB = 8;      // 量级上界：巨量=注意力释放完毕（右尾 10 票全 ≤7.6B）
const TAIL_DIP_EXEMPT_MAX_NO_BUY_SELL_PCT = 10;   // 只卖不买钱包占比（insider 抛货指纹）
const TAIL_DIP_EXEMPT_MAX_HOLDER_HHI = 0.2;       // 正净持仓 HHI（筹码分散度）
const TAIL_DIP_EXEMPT_MIN_ROUTER_ENTRY_PCT = 60;  // 聚合路由入口买入占比（散户通道）
const TAIL_DIP_EXEMPT_MAX_TOP1_BUY_PCT = 15;      // 第一大买家买入占比（无大户主导）
const TAIL_DIP_EXEMPT_MAX_SAME_BLOCK_HOLD_CIRC_PCT = 60; // 同块簇持仓占在场流通（捆绑持仓；Eagle 反例 83.2）
const TAIL_DIP_EXEMPT_MIN_FAMOUS_GROUP_BUY_BNB = 0.1;    // famous 群体买入额（参与=自然流量背书）
const TAIL_DIP_EXEMPT_MAX_FAMOUS_COHORT_WALLETS = 3;     // famous 同块跟单最大钱包数（kroea 反例=4）

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
/** T200/FP31 薄盘分支中等跟单豁免带（slot 级即时跟单 [0.05,0.2)——四窗 U 型
 *  最好带 win 71%；零响应与重跟单带不豁免保持拦） */
const FAM_THIN_FOLLOW_EXEMPT_MIN_BNB = 0.05;
const FAM_THIN_FOLLOW_EXEMPT_MAX_BNB = 0.2;
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

// ── FP47a malicious_dump 桶因子化（2026-11-24 用户裁定「A 档四题全搞」：
//   BP69 entry_shape 恶意砸盘桶判据 100% 数值直供——四腿/单鲸版/相邻两块臂/
//   贴锚臂（BP82）/总成交额豁免（BP78）全部代码化；Jev 题面不动兜底
//   （FP 灰关/漏判时 Jev 照判，BP68「E 通道保留兜底」同哲学）） ──
/** MD 腿① 砸块卖额下限（题面直供 ≥0.5 BNB；dumpBlock 候选预筛 0.3 线宽于此，四腿必须自验） */
const MD_MIN_SELL_BNB = 0.5;
/** MD 腿② 块内跌幅上限（dropPct≤此；snapshot 口径=末价/首价−1，负值域） */
const MD_MIN_DROP_PCT = -10;
/** MD 腿③ 卖方阵列下限（剔路由口径，snapshot 已剔） */
const MD_MIN_SELLERS = 4;
/** MD 腿④ 砸后 60s 承接比上限（<此=承接不足坐实） */
const MD_MAX_FOLLOW_RATIO = 0.5;
/** MD 单鲸版：卖额下限（≥1.0 BNB 独砸，不要求卖方数） */
const MD_WHALE_MIN_SELL_BNB = 1.0;
/** MD 单鲸版：最大卖家占比下限（≥30%） */
const MD_WHALE_MIN_TOP_SELLER_PCT = 30;
/** MD 贴锚臂：距锚 <此秒=承接观察窗未启（BP82；ratio 恒 null 不冒充承接） */
const MD_ANCHOR_MAX_SEC = 10;
/** MD 贴锚臂：砸后已见买入占砸卖额 <此=尚无人接（BP82「参考 <30%」） */
const MD_ANCHOR_MAX_BUY_RATIO = 0.30;
/** MD 总成交额豁免线（BP78；与 mapper DUMP_EXEMPT_TOTAL_VOLUME_BNB=20 同源——
 *  市场化恐慌抛售≠庄出逃；贴锚形状不吃豁免（BP82 收紧）） */
const MD_TOTAL_VOLUME_EXEMPT_BNB = 20;

// ── FP47b crash 数值判序因子化（同裁定）：急跌进行时/趋势打断三口/臂 A/臂 B
//   判序四步制代码化；「无回调+无换手」形态复核（价格拱归纳）留 Jev 兜底。
//   ⓟ=候选定线（对拍校准后用户裁定）──
/** 急跌进行时 chg5 深负线 ⓟ（题面「两位数级」；样本 -22~-44.7） */
const CRASH_CHG5_DEEP = -10;
/** chg5≈chg10 同深差 ⓟ（题面样本 0~3pp；≤此=无铺垫进行时） */
const CRASH_CHG_SAME_DEPTH_GAP = 5;
/** 摆点轴：最近确认摆高距今 ≤此秒 */
const SWING_NEAR_SEC = 60;
/** 摆点轴：现价距该摆高 ≤此% */
const SWING_VS_HIGH_PCT = -25;
/** 打断家族形态前提：上升腿时长 ≥此秒（秒级开盘脉冲不算） */
const SWING_RISE_MIN_SEC = 60;
/** 打断家族形态前提：上升腿涨幅 ≥此% */
const SWING_RISE_MIN_PCT = 20;
/** 打断余波域：锚前 30s 内深 5s 段 ≤此% */
const DIP_WAVE_PCT = -15;
/** 打断余波域/臂 B 坐实：现价距段起点未收复 ≤此% */
const DIP_UNRECOVERED_PCT = -20;
/** 深段距今 ≤此秒 */
const DIP_MAX_SEC_AGO = 30;
/** 臂 B 深段坐实：深 5s 段 ≤此% */
const DIP5_MIN_PCT = -18;
/** 臂 A：尾 10s 卖可观推进线 ⓟ（题面「0.4~1B 推进」参考） */
const ARM_A_TAIL_SELL_BNB = 0.4;
/** 臂 A/臂 B 共用：尾 10s 买「纯尘/归零」量级线（<此=买力不在场；单笔大额不弱） */
const ARM_A_DUST_BUY_BNB = 0.1;
/** 臂 B 买入力在场：尾 10s 买 ≥此笔 */
const ARM_A_MIN_BUY_N = 3;
/** 臂 A 反例区分：近窗像样单笔 ≥此 BNB（题面直供 0.19） */
const ARM_A_BIG_SINGLE = 0.19;
/** 臂 A 反例区分：近窗买入 ≥此级且含像样单笔=换手在场不落（题面「≥0.5B 级」） */
const ARM_A_NEAR_BUY_BNB = 0.5;

// ── FP48 crash 形态（无回调 + 无换手的单边下跌；T243）：原 BP 因子应答器 BPF2 的
//   crash 形态复核因子臂整体迁入——「复核」这一步不再存在于 BP 门，就是因子门的一条臂。
//   judgeCrashNumeric（FP47b：急跌进行时/打断三口/臂A/臂B）在臂链更前，本臂只接它
//   放行后剩下的「缓跌 / 阴跌」形状。──
/** 提示臂①现价较锚窗最高价深跌（题面直供） */
const CRASHFORM_VS_ATH_MAX = -25;
/** 提示臂②近 30s 动量深跌（题面直供） */
const CRASHFORM_CHG30_MAX = -25;
/** 提示臂③临近段单 5s 段急跌（题面直供） */
const CRASHFORM_NEAR_DN5_MAX = -15;
/** 提示臂④现价贴锚窗最低价（题面直供，百分点） */
const CRASHFORM_MIN_GAP_MAX = 2;
/** 无回调：5 秒动量 ≤ 此 = 仍在线性下行 / 无反弹台阶（ⓟ 候选线；研究集 11 命中
 *  300s 末值 100% 为负；放宽到 ≤0 会多放进 2 张正在反弹的正票） */
const CRASHFORM_CHG5_MAX = -1.5;
/** 无换手：尾 10 秒买单笔数 ≤ 此（含尘埃的买 tick 一笔都没有=买方归零；ⓟ 放宽到
 *  ≤1 笔负率 100%→76%） */
const CRASHFORM_TAIL_BUY_N_MAX = 0;

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

/** FP26 尾段买力枯竭+卖压在场两线（2026-11-19 bt-v158 因子分析立法）：
 *  win30 卖单 ≥5（流量被卖方掌控）∧ 尾 5s 买入 ≤1（接盘者已走）——
 *  阈值敏感性三窗实测：卖 5 最优（4 引入 3 张赢票、8 丢命中面） */
const TAIL_NO_BUYER_MIN_SELL_N = 5;
const TAIL_NO_BUYER_MAX_BUY_N = 1;

/** FP27 大户静默卸货三线（2026-11-19 bt-v158 三窗立法）：bhs∈[0.1,0.3) ∧
 *  ath<80——带状下界 0.1=轻量抽血、上界 0.3 必须（≥0.3 重出货三窗 +0.30 反而
 *  正=换手完成有人接走，非单调）；ath 严格 <80（80 恰线不拦） */
const HOLDER_QUIET_UNLOAD_MIN_BNB = 0.1;
const HOLDER_QUIET_UNLOAD_MAX_BNB = 0.3;
const HOLDER_QUIET_UNLOAD_MAX_ATH_PCT = 80;

/** FP28 早窗启动失败死盘三线（2026-11-20 bt-v162 热窗首测立法）：
 *  ath<40（FP18 域界同值镜像）∧ age<90（早窗）∧ 尾 7s 买入 ≤2 */
const LAUNCH_FAIL_MAX_ATH_PCT = 40;
const LAUNCH_FAIL_MAX_AGE_SEC = 90;
const LAUNCH_FAIL_MAX_TAIL_BUY_N = 2;

/** FP29 分仓出货残局盘两线（2026-11-20 CI/MOLLY 工厂盘取证立法，台账 T197）：
 *  超卖钱包合计 ≥0.5B ∧ 锚窗独立钱包 ≤12。钱包界 12=硬腿（12→14 引入
 *  Σ+0.263 正票——13/14 钱包的票有真实参与者群）；量线 0.4 引 2 正票/
 *  0.6 丢命中面=0.5 最优带 */
const OVERSELL_MIN_BNB = 0.5;
const OVERSELL_MAX_WALLETS = 12;
// FP46/T235 沉寂豁免线（秒）：超卖户最后一笔卖距锚 ≥ 此值 → 洗筹阶段已结束不拦。
// 55s 与 stall 断流卖腿线同族；案源 3beb 58.2s 过线；60s 会挡掉案源（见版本头 FP46）。
const OVERSELL_QUIET_EXEMPT_SEC = 55;

/** FP30/T198 arbBot 持筹垄断一线（2026-11-20 用户裁定「arbBot 持仓占比直接落
 *  因子门」）：arbBot 组净持筹占在场流通 ≥30%（D3.35 Σ正净同域分母）。
 *  四窗校准〔w1003 热 v162/w1019 中 v158/w1012 中 v150/w1103 冷 v145〕23 票
 *  6 胜 净 −0.23 **四窗全负**（−0.15/−0.04/−0.01/−0.03）；28ad(24%)/ba5e(0%)
 *  天然门外=不挡大赢票（与流量版 r60/arbBot 流量轴的本质差异——重启团伙
 *  票流量上同形、存量上筹码摊开）；10~30% 带 +1.93 正=30 线不带中间带。
 *  键源 buyDerived.arbBotHoldCircPct（snapshot 注入钱包集，service 预加载）；
 *  null（未注入/证据缺席）容缺不拦；负值（组清仓离场）恒放行 */
const ARB_BOT_HOLD_MIN_CIRC_PCT = 30;

// ── FP23 相邻双块捆绑砸盘尾承接臂（T190，2026-11-19 bt-v156 0x2b63c82e…7777
//    ASCEND 案立法，用户裁定原话「大量捆绑砸盘尾声票，看看怎么拦截」+选线
//    「这个 case 极端多了，捆绑卖方远大于 4，并且跌幅也足够大（砸盘的流动性
//    占比高），这是核心特征。按照我们的原则，只拦极端情况，不造成隐含误伤」
//    =CD403 线卖方 ≥8）——案形：t0 首发 0.7013B 大买+t+8s 同块 3 钱包等额捆绑
//    3×0.2296 拉 ATH +49% → t+17s 起连续出货（0.474/0.455 单笔大卖）→ t+29s
//    **相邻双块 12 卖方砸 0.761B（块内 -21%）** → 买点 t+39s 落砸盘末笔后
//    「缓跌尾声」（chg5=-3.39 恰好躲过 FP18「进行时」-5 线）→ 买后无 V 反
//    90s 断流止损 -16.4%。全链缺口：CD400/CD403 的 nearDump 达标块=**单块
//    ≥0.5B**，本案最恶性单块 9 卖方仅 0.418——跨两块分摊的捆绑砸盘在 CD 单块
//    口径下结构性失明；AF1 act=high（吞吐 7.36B/min——砸盘流量本身制造高
//    活跃）skip 掉整个 cheat 门；BP 锚全在场（dump2Block 十键）但 Jev 判
//    normal_dip 0.43（BP82 贴锚臂判读拼装失败，BP61 铁律又一支）。判据五腿
//    （键源 buyDerived.dump2Block——BP77 相邻 block 对合并同款：sellers 剔
//    router/dropPct 含 outlier 价格影响事实口径/followBuyBnb 已剔 BP85 同块
//    闪进闪出/secToAnchor=砸块末距锚秒数）：卖方 ≥8（CD403/BP77 塞单门同线）
//    ∧ 合并卖额 ≥0.5B ∧ 跌幅 ≤-10%（BP77 判读线；snapshot 预筛 -8 一档宽）
//    ∧ 距锚 ≤60s（「尾声」窗——历史砸盘遗迹已充分换手不拦）∧ 承接比 <0.3
//    （贴锚 secToAnchor<10s followBuyRatio 恒 null 时回落 followBuyBnb÷卖额
//    ——BP82 贴锚臂同款）。BP78 总额豁免照抄：锚窗总额 ≥20 BNB（市场化
//    恐慌抛售≠庄出逃）不拦。三窗重放（10-19/10-12/11-04，268 成交）：CD403
//    双块线命中 1 票=本案 −0.0328 全负零误伤；AZ 案票 0x397a（5 卖方/0.698B/
//    -13.5%/承接 14.2%）用户知情选择 ≥8 线漏（选项披露）；未命中最差面承接
//    ≥58%/跌幅 ≤8.5%/单鲸——分离带宽。null 容缺不拦（FP 哲学：拒方向证据
//    缺席不拒） ──
/** FP23 合并卖额线（BNB）：≥0.5（BP77 恶意砸盘判读线同线；snapshot 预筛 0.3 一档宽防截断） */
const DUMP_PAIR_MIN_BNB = 0.5;
/** FP23 合并跌幅线：≤-10%（BP77 判读线；单块内首末行价含 outlier 事实口径） */
const DUMP_PAIR_MAX_DROP_PCT = -10;
/** FP23 尾声窗：砸块末距锚 ≤60s（历史遗迹已充分换手不拦——砸完不久我们接刀才是本案形状） */
const DUMP_PAIR_NEAR_SEC = 60;
/** FP23 BP78 总额豁免线：锚窗总成交 ≥20 BNB=市场化恐慌抛售不拦（「交易了比较久」立法线照抄） */
const DUMP_PAIR_TOTAL_VOLUME_EXEMPT_BNB = 20;
/** FP23 前期域线：买点票龄 ≤600s 才评（用户裁定「这个 case 还有一个特性，就是它偏前期，
 *  后期代币的下跌段，出现连续两个 slot 砸盘 8 个，我认为也算正常。反正，注意误伤」——
 *  前期=开盘操纵/分仓团伙建仓即出货域；后期下跌段的双块 8+ 卖方=市场化恐慌抛售放行）。
 *  600s=十分钟宽线（本案 38s；90s 出生窗/600s 慢热帽族先例量级）；null 容缺不拦宁漏。 */
const DUMP_PAIR_EARLY_MAX_AGE_SEC = 600;

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
/** 生命周期门：锚窗总成交额（BNB）——T181 立法 17.63→15；T191 降 15→11（chibi 案 11.53
 *  漏面引出，用户裁定接受同构误伤 0x8fbb5ae7 +0.0321；案源向下取整同构，带内两窗
 *  T∈[10,11.5] 拦面全同=数据等价取整） */
const LIFECYCLE_MIN_TOTAL_VOLUME_BNB = 11;
/** burst 结构前提：最后静默段时长（CD406 BURST_STALL_GAP_SEC 同线） */
const LIFECYCLE_BURST_STALL_GAP_SEC = 30;
/** 深破豁免线：launchMinVsFloorPct < 此值放行（G1 五连收线同线；豁免证据缺席不豁免） */
const LIFECYCLE_BURST_EXEMPT_FLOOR_PCT = -10;
// ── T192/FP25 大周期卖压残局（2026-11-19 0x54e33173…7777 案：走完一轮 ath124.4%
//    总额 15.67B 的票 32s 静默后卖单砸簇（簇卖占 58.7%/0.49B）+17s 双买反弹，
//    ladder 腿恰在反弹瞬间 fire（chg5 +7.91 废 FP18「进行时」）→ 买入 90s 断流
//    平手出局。FP16 六腿里总额/ath/静默/波买全过，卡在 D3.67 波锚 null——按笔数
//    最密 5s 窗被 +10s 4 钱包同秒卖簇劫持、窗内零 BUY → sinceWaveEnd 无法计算 →
//    波近锚腿证据缺席放行。用户裁定「这个不是 burst，但从我的角度也应该被拦」+
//    「这种小反弹在代币尾声状态应该都起不来」：卖出方向的残局流量与买入方向的
//    burst（FP16）对称，同不接。臂=FP16 同主干（ath/总额/静默/深破豁免线全复用）
//    + CD407 最大流量簇两腿（卖主导 segSellPct≥50 ∧ 卖额 segSellBnb≥0.3=CD401
//    同线）+ 簇贴近锚（新 snapshot 键 burstSecSinceSegEnd≤60s——簇末行距窗末，
//    D3.67 波锚在卖簇劫持形状下结构性 null，本键以簇自身末行定位「流量事件
//    结束距锚」）──
/** T192 卖主导线：簇卖占簇总成交 ≥ 此值（本案 58.7；<50=买主导归 FP16 域） */
const LIFECYCLE_SELL_MIN_SELL_PCT = 50;
/** T192 簇卖额线：≥ 此值才构成像样卖压（CD401 0.3 同线；本案 0.4937） */
const LIFECYCLE_SELL_MIN_SELL_BNB = 0.3;

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
 * T205 阶段前提（fix①，灰度 enableActStageCold，act-stage.js 单点）：**未火过**
 * （锚前 ATH<80，isColdStage）的票 low 五臂整体让位——「活跃度拦截的价值在
 * 火过一段时间后（low=流动性失去）；前期活跃度检测不重要」（金狗 GWC 复活
 * 拉回误杀案）。athVsLaunchPct null=照拦（放行方向证据缺席不释放）；ultra
 * 两臂刻意不受阶段前提影响（协同出货/极端密度=当下事实非静默语义）。
 */
function judgeActivityLevel(snapshot, opts = {}) {
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
  // ── T205 阶段前提（fix①）：未火过（ATH<80）low 家族让位 ──
  const stageAth = (snapshot.buyDerived && typeof snapshot.buyDerived.athVsLaunchPct === 'number')
    ? snapshot.buyDerived.athVsLaunchPct : null;
  // （T205b 放行三反锚 ABC 已撤回 FP38——2026-11-22 v174 对拍否证：A 纯卖触发/
  // B 复活已展开/C mbc≤2 三腿在 6fd0372f 集合增量面上标定 41.9%→50%，但重放
  // 验证反降（168 票 39.9%/净 +1.17 vs v173 215 票 41.9%/+1.41）——切走 63 票
  // 净Σ+0.14（C 腿独切 28 票 +0.35 正脸）+ 漏切 55 张标定坏面（Σ−0.43）。根因=
  // 「在留痕 metadata 上标定分离轴、再到运行时快照上实现」的键保真链路结构性
  // 不可靠（A: FA actBuyBnb vs BP nearTail10BuyN；B: BP 锚 actIdlePct vs cheat
  // 窗 idlePct；C: cheat 门时刻锚 vs FP 时快照——不同 cap/settle）且重放 Jev
  // 重掷使面不稳定。增量面 41.9% 胜率=期权结构本体（125 张亏损全 ≤0.06 断流
  // 止损干净、90 张赢家肥尾），胜率化妆的实证代价=净额回撤。勿重提同族提案
  // 除非键保真问题先解——留档 v173/v174 对拍与逐票归账。FP37 仅存在于研究臂
  // v174 从未投产（三键缺省关），撤回随 FP38 生效）
  const stageCold = opts.enableActStageCold === true && isColdStage(stageAth);
  trace.stageAth = stageAth; trace.stageCold = stageCold;
  // ── T210 停滞再启动通路（stall-restart.js；调用点传 hit）：形状命中=「低活跃」
  // 就是沉寂本身（较长的沉寂期证明持仓意愿，随后重启买单进场）——low 五臂整体
  // 让位；ultra 两臂照常（协同出货/极端密度=当下事实）。留痕只在命中时加键
  // （未命中票 trace 形状 bit 不变） ──
  const stallRestartHit = opts.stallRestartHit === true;
  if (stallRestartHit) trace.stallRestart = 1;

  // ── low 五臂（豁免后任一成立；T205 冷阶段/T210 停滞再启动整体让位） ──
  if (!burstCtx && !tailActive && !stageCold && !stallRestartHit) {
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

  return { level: null, branch: burstCtx ? 'burst_ctx' : (tailActive ? 'tail_active' : (stageCold ? 'act_stage_cold' : (stallRestartHit ? 'stall_restart_exempt' : 'normal'))), reason: null, trace: { ...trace, burstCtx, tailActive } };
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

/** FP28 早窗启动失败死盘：ath<40（从没拉起来过=FP18 域镜像）∧ age<90（早窗）
 *  ∧ nearTail7BuyN≤2（锚前 7s 买入笔数——买点此刻尾段没人买）→ 拒
 *  launch_fail_dead。三腿合取=「启动失败」精确定义：t5N 腿是分离关键
 *  （去掉后四窗 +0.70 正=同域但尾段买力 ≥3 的是「正在启动」好票）；
 *  7s 窗=用户裁定（Missy 实证 5s 窗边界效应：t-6s 三笔买力恰在格外）；
 *  与 FP26 正交=卖压带外（selN 无要求，命中票 selN 大多 1~4）；
 *  四窗全负 43 票胜 8 净 −0.631、误伤 8 张全 ≤+0.043 零大赢。
 *  null 容缺不触发（宁漏不冒充）。 */
function armLaunchFailDead(bd) {
  if (!bd) return false;
  if (typeof bd.athVsLaunchPct !== 'number' || bd.athVsLaunchPct >= LAUNCH_FAIL_MAX_ATH_PCT) return false;
  if (typeof bd.tokenAgeSec !== 'number' || bd.tokenAgeSec >= LAUNCH_FAIL_MAX_AGE_SEC) return false;
  const act = bd.activity || {};
  if (typeof act.nearTail7BuyN !== 'number' || act.nearTail7BuyN > LAUNCH_FAIL_MAX_TAIL_BUY_N) return false;
  // FP43/T209 换手豁免腿（用户裁定「launch_fail_dead 门，做跟大户买入门同样的
  // 豁免」——FP42 三键原样镜像，线共源）：首波 sniper 走光 ∧ 后波有机接盘 ≥2 家
  // ∧ famous 同块 <15% → 换手结构自证传播力，「没拉起来过」的启动失败定性不
  // 成立不拦。null 任一=豁免证据缺席不豁免保持拦〔FP33/36/39/42 惯例〕；
  // launchDefer null（截窗未覆盖出生段/零买）同=证据缺席照拦。案源=登天猫
  // 0xf38f48cf…7777 首评 @19.2s（ath 33.5<40 ∧ 三键全真；FP 全关对照臂同锚
  // 买进 +256%）。台账 T209。
  const ld = bd.launchDefer;
  if (ld && ld.firstWaveCleared === true
    && typeof ld.laterHolders === 'number' && ld.laterHolders >= BIG_BUY_DEFER_EXEMPT_LATER_HOLDERS
    && typeof ld.famBlockPct === 'number' && ld.famBlockPct < BIG_BUY_DEFER_EXEMPT_FAM_BLOCK_PCT) return false;
  return true;
}

/** FP29/T197 分仓出货残局盘：oversellBnb≥0.5（超卖钱包合计——单钱包卖 ≥0.3B
 *  ∧ 卖>买×1.5=curve 外筹码来源账户，链上 transfer 分仓在买卖账本上的唯一
 *  可见指纹）∧ anchorWalletN≤12（锚窗独立钱包数=微型盘，无真实参与者群体）
 *  → 拒 oversell_residual——「活跃度是自产的」：分仓账户在出货+盘面参与者
 *  极少，对倒/出货制造的假活跃骗过 act 门（MOLLY 主案 0xd657ad14…7777：
 *  出货户 0x04d7 买 0.246 卖 1.321 全部来自 creator transfer，三胞胎等额
 *  对倒伪装散户抢筹，真实外部买方=0，引擎买入后 90s 断流离场 −32.7%）。
 *  四窗跨窗验证〔w1003 热 v162/w1019 中 v158/w1012 中 v150/w1103 冷 v145〕
 *  **9 票全负零正票 Σ−0.147**（MOLLY −0.065/ZEC −0.063/BI/OOC/nissan…），
 *  与 FP26/27/28 命中面零重叠（净增量）。**两腿缺一不可**（组合分离）：
 *  超卖单腿 92 票 Σ+0.71 正——creator 预留筹码兑现遍地（Tiltpad/ASTER/
 *  PIKACAT 正票都有「买 0.00 卖 0.3」钱包）；钱包少单腿 114 票 Σ+1.21 正
 *  ——小盘本身非空头信号。同轮否证勿重跑：等额同块买入簇（56 票 26 正
 *  Σ+1.35——GMGN 跟单生态常态，memes +1.43 即 7 钱包等额 0.11 跟单）/
 *  self-wash 同钱包先卖后买（11 票 3 正）均无分离力；「同步卖出」腿买点
 *  不可见（快闪簇卖出在买点后）结构性不可用=只能做卖出侧信号。**CI 型
 *  （纯对倒无 transfer 超卖）不在域内=知情缺口**，待 creator 维度另案。
 *  null 容缺不触发〔宁漏不冒充〕；键源 buyDerived.oversellBnb/anchorWalletN
 *  （snapshot 新键，aggregateWallets per-wallet 买/卖账本剔路由同口径）。台账 T197。
 *  FP46/T235 沉寂豁免：buyDerived.oversellSecToAnchor ≥ 55 → 不拦（判据与
 *  扫描数据见版本头 FP46；键源 snapshot oversell 族第四键）。 */
function armOversellResidual(bd) {
  if (!bd) return false;
  if (typeof bd.oversellBnb !== 'number' || bd.oversellBnb < OVERSELL_MIN_BNB) return false;
  if (typeof bd.anchorWalletN !== 'number' || bd.anchorWalletN > OVERSELL_MAX_WALLETS) return false;
  // FP46/T235 沉寂豁免：超卖户最后一笔卖距锚 ≥55s → 洗筹离场与买点间隔足够久
  // =洗筹阶段已结束、新一轮启动非接刀。null=证据缺席不豁免保持拦〔惯例〕。
  if (typeof bd.oversellSecToAnchor === 'number' && bd.oversellSecToAnchor >= OVERSELL_QUIET_EXEMPT_SEC) return false;
  return true;
}

/** FP30/T198 arbBot 持筹垄断：arbBotHoldCircPct ≥30 → 拒 arb_bot_holdings——
 *  「机器坐着筹码」的存量口径死盘：套利/三明治/洗盘机器组合计坐掉在场流通
 *  三成以上=没有有机持有人，纯机器互吃（流量轴结构性失明：机器买完停止
 *  买入后流量降回 11~18% 但筹码坐着——0x788fd8a9 流 11%/持 45%、0x64ed2dab
 *  流 9%/持 61% 类形状只有本口径可见）。案源链：0x4fe71b 庄 55s 脉冲案引出
 *  「光看参与者不够，得看买入点位的持仓比例」——持仓口径把流量分不开的
 *  赢/输分开（28ad top1 29%/正持人 8 筹码摊开 vs 死盘 top1 36~76%/正持人
 *  3~7 筹码坐着等人接盘）。四窗 23 票 6 胜净 −0.23 全负、28ad/ba5e 门外
 *  （28ad arb 持筹 24%——重启票第三次从人群质量轴逃生，本口径天然不伤它）。
 *  净额可负（组清仓离场=卖光的不坐庄恒放行）；null（未注入钱包集/证据
 *  缺席/wallets 空）容缺不拦〔宁漏不冒充〕；空集=表空 fail-open 臂钝化。
 *  键源 buyDerived.arbBotHoldCircPct（snapshot T198 族注入制）。台账 T198。
 *
 *  T198b/FP36 流通腿豁免（2026-11-21 用户裁定，案源 0x2ee9…7777 误伤票——
 *  两镜像 sandwich_bot 锚点瞬时库存 31→35% 被「坐筹」误读，5 分钟后两波砸
 *  给拉升、锚后 ~6.9×）：流通小时机器「在场流通占比」被小分母放大、占总
 *  供应比例小（0x2ee9 流通 13.7%×机器 35%≈总供应 4.8%），垄断名不副实、
 *  砸不深——**流通 ≥16.5%（FP22 同线「筹码已充分派发」）才构成真垄断**。
 *  四窗验证（v164 热窗 419 命中行 metadata 真值+182 replay 老三窗 v159/v155/
 *  v145 14 命中）：深跌分离稳健——豁免放回面（流通<16.5）288 行前向 **0 票
 *  ≤−30%**（最差 −26.9%）vs 维持拦截面 130 行 15 票深跌；右尾集中在热窗
 *  （放回面 ≥+100% 9 行全在 v164，0x2ee9 两行领衔）；期权结构知情：中温冷窗
 *  放回面 9 行 ret30 全负 0 右尾=纯损耗面，期望靠 0x2ee9 单票撑（纯成交面
 *  31 行热窗粗算 +0.13B/老三窗 −0.15B 约打平）。敏感性：线 10/12 丢右尾
 *  （0x2ee9@14.5/Username123@16.1）。circSupplyPct null（totalSupply 缺席）
 *  =无法确认低流通，**不豁免保持拦**（FP33 豁免证据缺席惯例——豁免方向
 *  fail-closed）。台账 T198b */
const ARB_BOT_HOLD_EXEMPT_MAX_CIRC_PCT = 16.5; // FP22 HOLDER_EVEN_CREW_MIN_CIRC_PCT 同线（「筹码已充分派发」阈值共享语义，改须两处同改）
function armArbBotHoldings(bd) {
  if (!bd) return false;
  if (typeof bd.arbBotHoldCircPct !== 'number') return false;
  if (bd.arbBotHoldCircPct < ARB_BOT_HOLD_MIN_CIRC_PCT) return false;
  // T198b/FP36 流通腿豁免：低流通（筹码尚未充分派发）时机器占比被小分母
  // 放大、占总供应比例小——<16.5 豁免放行；null=证据缺席不豁免保持拦。
  const circ = bd.chip && typeof bd.chip.circSupplyPct === 'number' ? bd.chip.circSupplyPct : null;
  if (circ !== null && circ < ARB_BOT_HOLD_EXEMPT_MAX_CIRC_PCT) return false;
  return true;
}

/** FP27 大户静默卸货（未走完周期）：bigHolderSellBnb60∈[0.1,0.3)（top5 正净
 *  持仓者 60s 轻量出货带）∧ athVsLaunchPct<80（票还没走完一轮大周期）→ 拒
 *  holder_quiet_unload——「上升/中途庄提前离场」：筹码结构里还持有大量筹码的
 *  人在偷偷卖（清仓离场者净持仓 ≤0 自动出局不计——本键天然只量在场持有者），
 *  而 ATH 未及 80%=生命周期尚未走完，此时出货=阴跌抽血前兆非兑现。与
 *  FP16/FP25（ath≥100 走完一轮的残局门）互补=生命周期两方向闭环。
 *  ⚠上界 0.3 必须（非单调实证）：bhs≥0.3 重出货三窗反而 +0.30 正——重砸=
 *  换手完成有人接走（ASTER 类深砸重启形状），轻出货 0.1~0.3 才是抽血；
 *  ath<80 单独三窗 +5.13 正——分离来自组合非 ath 腿。famous/聪明钱不合并
 *  （2026-11-19 三口径对拍否证：top5∪famous∪sm 独有增量三窗净 +1.44 伤——
 *  memes famous 卖 0.35 仍 +142% 一票否决；名单钱包「在场重仓持有」已在
 *  top5 隐式覆盖、已边卖边走〔top5=0〕的裸卖出额无分离力——现有 famous
 *  门族全带形状腿正因如此）。三窗重放 21 票胜 5 净 −0.374、误伤 5 张全部
 *  ≤+0.03（最大天狗 +0.029）；与 FP26 有命中面重叠（大小姐/라이언等断流
 *  族）→ 挂 FP26 后=断流预测器先认领、本臂接住非 FP26 的出货票。null 容缺
 *  不触发（宁漏不冒充）。 */
function armHolderQuietUnload(bd) {
  if (!bd) return false;
  if (typeof bd.bigHolderSellBnb60 !== 'number') return false;
  if (bd.bigHolderSellBnb60 < HOLDER_QUIET_UNLOAD_MIN_BNB || bd.bigHolderSellBnb60 >= HOLDER_QUIET_UNLOAD_MAX_BNB) return false;
  if (typeof bd.athVsLaunchPct !== 'number' || bd.athVsLaunchPct >= HOLDER_QUIET_UNLOAD_MAX_ATH_PCT) return false;
  // T230/FP45 换手豁免（用户裁定「这个门应该是拦截 top 持有者砸盘，但这个 case 其实就是换个手」；
  // 案源 GWC 0xb712…7777 波钱包 8s 止盈 23~32% 留仓 68~77% 被误拦、锚后 +900%）：
  // 卖出大户均为窗内净买入者（min 买/卖比 ≥1，快照键 bigHolderSellerMinBuyRatio60——
  // 0=存在纯卖方=老庄离场照拦）；null=证据缺席不豁免保持拦〔FP33/36/39/40/42/43 惯例〕。
  if (typeof bd.bigHolderSellerMinBuyRatio60 === 'number' && bd.bigHolderSellerMinBuyRatio60 >= 1) return false;
  return true;
}

/** FP26 尾段买力枯竭+卖压在场：win30 卖单 ≥5 笔 ∧ 尾 5s 买入 ≤1 笔 → 拒
 *  tail_no_buyer_pressure——「卖压驱动的假活跃」：30s 窗流量被卖方掌控（方向）
 *  ∧ 买点此刻接盘者已走（尾 5s 即时买力——30s 整体买入可以不小/净流可正，
 *  「曾经来过」不算数）。act 族 L1~L5 盯吞吐死寂，卖单撑起的 4~5B/min 假活跃
 *  结构性失明；CD414 管重砸盘（15 户/2B/净−1.5），本臂管线外轻量阴跌；与
 *  FP18（chg5/chg30 双负进行时）正交=不限动量管「跌完仍无人接」。BP74「买入
 *  力在场豁免」判读的纯代码反向镜像（Jev 未稳定执行——BP61 铁律）。
 *  三窗重放 20 票 0 胜 17 负 2 平净 −0.44（w1019 8 票含大小姐/吕吕两大亏、
 *  8/8 全部断流出场）。null 容缺不触发（宁漏不冒充）。
 *  FP40 深破豁免（一姐 0xfc23 案 JG-18 续，用户裁定「同样豁免破发」）：
 *  launchMinVsFloorPct < -10（TAIL_KNIFE_BREAK_EXEMPT_VS_PCT 与 FP39 同一把线）
 *  → 不拦——深破=跌穿发行价 10pt 跌无可跌，「跌完仍无人接」的下方风险模型
 *  同样不再适用；三窗（w1012 冷窗无单臂拒行）：深破层 51 票损耗最轻（中位
 *  −4.3/深跌 1）vs 浅破层 117 票较重（−10.2/深跌 2）=与 tail_dip 面同构分层；
 *  null=豁免证据缺席不豁免保持拦（FP33/FP36/FP39 惯例）。 */
function armTailNoBuyerSellPressure(bd) {
  if (!bd) return false;
  const act = bd.activity || {};
  const w30 = bd.win && bd.win[30];
  if (typeof act.nearTail5BuyN !== 'number' || act.nearTail5BuyN > TAIL_NO_BUYER_MAX_BUY_N) return false;
  if (!w30 || typeof w30.sellN !== 'number' || w30.sellN < TAIL_NO_BUYER_MIN_SELL_N) return false;
  if (typeof bd.launchMinVsFloorPct === 'number' && bd.launchMinVsFloorPct < TAIL_KNIFE_BREAK_EXEMPT_VS_PCT) return false; // FP40 深破豁免
  return true;
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
 * 每门 {category,id,label,value,line,hit,observe}——value/line 为预拼展示串（null 一律 '-'）；
 * hit=该门拦截命中（进 arms/reason）；observe=观察标记门（不拦截）；
 * category=因子门分类 id（T241b 注册表 FACTOR_GATE_CATEGORY_BY_ID，未登记=null）。
 * @param {object} parts evaluateFactorPreBuy 组装中的各判定结果
 */
// ═══════════════ 因子门分类（T241b，2026-11-26 用户提案「这次修改过后，因子门就很多了，
// 建议进行一下因子分类。在信号页面，也已分类为分块展示数据」）═══════════════
// Jev 退役后门链上的拦截全部落在因子门：①因子门（FP 各臂）+ ⑤BP 门的塞单门（纯代码；
// crash 形态自 FP48 起是因子门门行 crash_form，历史 BPF2 行由信号页按 buyPoint 合成）。
// 按「这道门回答买家的什么问题」归类——同一道门只归
// 一类；顺序 = 信号页分块顺序。门行 buildFactorGates 逐行带 category；信号页
// experiment_signals.js 持同份镜像（历史信号行无 category 字段，按门 id 归类）——
// 两份由 scripts/_test_factor_gate_categories.cjs 对锁，改分类两侧同步。
const FACTOR_GATE_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'participation', label: '参与结构', question: '有没有像样的买家和主力' }),
  Object.freeze({ id: 'organized', label: '组织性协同', question: '是不是有组织的人在做事（捆绑 / 分仓 / 机器）' }),
  Object.freeze({ id: 'dumping', label: '砸盘出货', question: '是不是有人在砸盘出货、有没有人接' }),
  Object.freeze({ id: 'liquidity', label: '活跃度流动性', question: '盘面是死了还是过热' }),
  Object.freeze({ id: 'entry', label: '点位形态', question: '这个买点是不是在接刀' }),
  Object.freeze({ id: 'famous', label: 'famous / 聪明钱行为', question: '名单钱包在这个盘做了什么' }),
  Object.freeze({ id: 'pathway', label: '通路', question: '好票形状（命中 = 豁免放行，不拦截）' }),
  // T245 上涨趋势认知（2026-11-28 用户指令「把上涨趋势因子作为因子门中的一个类别，
  // 在信号页面中作为因子门的子块展示」）：十键观察门（observe 不拦截——买侧拒绝臂
  // fire 点扫描全负不成立，键作观察+卖侧原料；值经 opts.trendFactors 从 fire 因子表透传）
  Object.freeze({ id: 'trend', label: '上涨趋势', question: '这个上涨趋势是健康持续还是出货集中' }),
]);

/** 门 id → 类别 id（键集 = 门链全部因子门：①因子门门行 + ⑤BP 门 stuffing_gate / crash_form） */
const FACTOR_GATE_CATEGORY_BY_ID = Object.freeze({
  // 参与结构：像样买方 / 大户进场节奏 / 有没有主力
  pvp: 'participation', big_buy_defer: 'participation', holder_scatter: 'participation',
  // 组织性协同：捆绑大部队 / 均等分仓 / curve 外筹码分仓 / 机器持筹 / 机器式缓推 / burst 捆绑 / 同块等额塞单
  launch_squad: 'organized', even_split_crew: 'organized', oversell_residual: 'organized',
  arb_bot_holdings: 'organized', slow_pump: 'organized', cd405: 'organized', stuffing_gate: 'organized',
  // 砸盘出货：各类砸盘与承接 / 大户出货 / 卖压残局
  cd400: 'dumping', cd403: 'dumping', dump_pair: 'dumping', cd412: 'dumping', cd414: 'dumping',
  cd401: 'dumping', holder_quiet_unload: 'dumping', tail_no_buyer: 'dumping', lifecycle_sell: 'dumping',
  // 活跃度流动性：低活跃四臂 + 超高两臂 / 尾声延伸 / 启动失败 / 弱波与残局 burst
  act_idle: 'liquidity', act_sparse: 'liquidity', act_dust: 'liquidity', act_near_dead: 'liquidity',
  act_ultra_sell: 'liquidity', act_ultra_density: 'liquidity', tail_activity: 'liquidity',
  launch_fail_dead: 'liquidity', burst_weak: 'liquidity', lifecycle_burst: 'liquidity',
  // 点位形态：接刀族（尾部接刀 / 恶意砸盘 / crash 数值判序 / crash 形态〔FP48 起，原 BP 门复核〕）
  tail_dip_knife: 'entry', malicious_dump: 'entry', crash_numeric: 'entry', crash_form: 'entry',
  // famous / 聪明钱行为
  fam_holding: 'famous', fam_harvest: 'famous', fam_harvest_final: 'famous', fam_burst_wave: 'famous',
  fam_low_exit: 'famous', fam_early_flip: 'famous', fam_dom_fall: 'famous',
  // 通路
  stall_restart: 'pathway',
});

/** 门 id → 类别 id（未登记的门返回 null——绝不冒充归类；新门须先登记） */
function factorGateCategory(gateId) {
  return Object.prototype.hasOwnProperty.call(FACTOR_GATE_CATEGORY_BY_ID, gateId)
    ? FACTOR_GATE_CATEGORY_BY_ID[gateId] : null;
}

/**
 * T245 上涨趋势十键观察门（2026-11-28 用户指令「把上涨趋势因子作为因子门中的一个
 * 类别」）：observe=true 不拦截——买侧拒绝臂 fire 点扫描全负不成立（右尾同构），
 * 十键作观察展示+卖侧原料。值经 opts.trendFactors 透传（fire 因子表直取，无则 '-'）。
 */
function buildTrendObserveGates(trend) {
  const t = trend || {};
  const v = (x, unit = '') => (x === null || x === undefined ? '-' : `${x}${unit}`);
  return [
    { category: 'trend', id: 'riseLegSec', label: '上涨腿时长', value: v(t.riseLegSec, 's'), observe: true, hit: false, line: '当前上涨腿已持续（下跌腿=0；未定向=缺证据）' },
    { category: 'trend', id: 'riseLegAmplPct', label: '上涨腿涨幅', value: v(t.riseLegAmplPct, '%'), observe: true, hit: false, line: '当前腿自确认低点累计涨幅' },
    { category: 'trend', id: 'riseConcentrationPct', label: '拉升集中度', value: v(t.riseConcentrationPct, '%'), observe: true, hit: false, line: '腿内最大 10s 桶涨幅占比（均匀≈低、突然一波≈高）' },
    { category: 'trend', id: 'launchPullbackN', label: '历史回调次数', value: v(t.launchPullbackN, ' 次'), observe: true, hit: false, line: '发出后 ≥10% 回调次数（0=从无回调）' },
    { category: 'trend', id: 'launchMaxPullbackPct', label: '最大回调深度', value: v(t.launchMaxPullbackPct, '%'), observe: true, hit: false, line: '历史最大单腿回调深度（0=从无回调）' },
    { category: 'trend', id: 'riseLegStartVsFirstPct', label: '腿起点vs首价', value: v(t.riseLegStartVsFirstPct, '%'), observe: true, hit: false, line: '当前腿起点价较首可靠价（≈0=趋势含发出点）' },
    { category: 'trend', id: 'swingDirSwitchN', label: '300s方向切换', value: v(t.swingDirSwitchN, ' 次'), observe: true, hit: false, line: '最近 300s 摆动方向切换次数（0=单向明确）' },
    { category: 'trend', id: 'actTradersPerBnb', label: '钱包密度', value: v(t.actTradersPerBnb, '/B'), observe: true, hit: false, line: '10s 窗每 BNB 独立钱包数（高=散户抢筹、低=大额对倒）' },
    { category: 'trend', id: 'actNewTradersRatio', label: '新钱包占比', value: v(t.actNewTradersRatio, '%'), observe: true, hit: false, line: '10s 窗新钱包占比（过热钱包太多标签）' },
    { category: 'trend', id: 'actAvgTradeBnb', label: '笔均成交额', value: v(t.actAvgTradeBnb, 'B'), observe: true, hit: false, line: '10s 窗笔均成交额（与密度互补）' },
  ];
}

function buildFactorGates(parts) {
  const d = (v, unit = '') => (v === null || v === undefined ? '-' : `${v}${unit}`);
  const g = [];
  // T245 上涨趋势十键观察门（类别分块首位——观察键不拦截，恒附加）
  if (parts.trend) g.push(...buildTrendObserveGates(parts.trend));
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
  // T201 大户买入推迟（ladder v34 G2 迁入；FP42 加 JG-32f 换手豁免腿）
  {
    const ld = (parts.bd && parts.bd.launchDefer) || null;
    g.push({
      id: 'big_buy_defer', label: 'T201·大户买入推迟',
      value: ld ? `大户合计${d(ld.bigBuyBnb, 'B')} 距首笔交易${d(ld.sinceFirstTradeSec, 's')} 破发${d(ld.minVsFloorPct, '%')} 首波清仓${ld.firstWaveCleared === true ? '✓' : ld.firstWaveCleared === false ? '✗' : '-'} 后波持${ld.laterHolders ?? '-'} famous同块${d(ld.famBlockPct, '%')}` : '-',
      line: '≥0.79档→45s ∧ ≥1档→60s（深破<−10豁免；FP42 换手豁免=首波清仓∧后波≥2家持∧famous同块<15%）', hit: parts.armHits.includes('big_buy_defer'),
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
      value: chip ? `HHI${chip.holderHHI != null ? chip.holderHHI.toFixed(3) : '-'} 实体${chip.holderHHIEntities != null ? chip.holderHHIEntities.toFixed(3) : '-'} 流通${chip.circSupplyPct != null ? chip.circSupplyPct.toFixed(1) + '%' : '-'}` : '-',
      line: 'HHI<0.10 ∧ 流通≥16.5%（团伙分仓已派发——残局接刀；低流通=拉升中段救回；FP41 实体HHI≥0.10=捆绑并钱包后有主力豁免）', hit: parts.armHits.includes('even_split_crew'),
    });
  }
  // FP18 尾部接刀（T182；T205 量腿显示）
  {
    const bdk = parts.bd || {};
    const w30s = bdk.win && bdk.win[30] && typeof bdk.win[30].sellBnb === 'number' ? bdk.win[30].sellBnb : null;
    g.push({
      id: 'tail_dip_knife', label: 'T182·尾部接刀',
      value: `ath${d(bdk.athVsLaunchPct, '%')} curVs${d(bdk.currentVsLaunchPct, '%')} chg5${d(bdk.chg5Pct, '%')} chg30${d(bdk.chg30Pct, '%')} 卖30s${d(w30s, 'B')} 破发${d(bdk.launchMinVsFloorPct, '%')}`,
      line: '域(ath≥40∧curVs≤28.5) ∧ chg5<-5 ∧ chg30<-5（崩塌进行时非插针；T205 量腿=卖30s≥0.3B 有量才拦，灰度；FP39 深破<−10 豁免）', hit: parts.armHits.includes('tail_dip_knife'),
    });
  }
  // T210 停滞再启动通路（命中=低活跃臂与弱波臂让位+活跃度前置门 restart_exempt；
  // exempt=true 渲染为通路徽标——hit 在本表语义=拦截，通路命中不是拦截）
  {
    const sr = parts.stallRestart || null;
    const L = sr ? sr.legs : {};
    g.push({
      id: 'stall_restart', label: '通路·前期停滞再启动',
      value: sr ? `沉默${d(L.stallSec, 's')} 出口${L.exitSide === 'BUY' ? '买' : '-'}${d(L.exitBnb, 'B')}→锚${d(L.exitToAnchorSec, 's')}s 波窗${d(L.waveRows, '行')} 前期钱包${d(L.earlyWallets)} 额${d(L.volPreBnb, 'B')} 持${d(L.holders)}/${d(L.buyers)} 留${L.retention == null ? '-' : (L.retention * 100).toFixed(0) + '%'} ath${d(L.athVsLaunchPct, '%')}` : '-',
      line: '沉寂≥60s ∧ 出口=非尘买单孤笔∧锚在其上 ∧ 前期钱包≥12 ∧ 持仓者≥6∧留存≥55% ∧ ath<80% ∧ 额<5B',
      hit: false, exempt: !!(sr && sr.hit),
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
    // FP23 相邻双块捆绑砸盘尾承接（T190——CD403 单块口径跨块分摊盲区）
    {
      const d2 = (parts.bd && parts.bd.dump2Block) || null;
      const d2Ratio = d2 && typeof d2.sellBnb === 'number' && d2.sellBnb > 0
        ? (typeof d2.followBuyRatio === 'number' ? d2.followBuyRatio : (typeof d2.followBuyBnb === 'number' ? d2.followBuyBnb / d2.sellBnb : null))
        : null;
      g.push({
        id: 'dump_pair', label: 'FP23·双块捆绑砸盘尾承接',
        value: d2 ? `卖方${d(d2.sellers)} 卖${d(d2.sellBnb, 'B')} 跌${d(d2.dropPct, '%')} 距锚${d(d2.secToAnchor, 's')} 承接${d2Ratio !== null ? (d2Ratio * 100).toFixed(1) + '%' : '-'} 龄${d(parts.bd && parts.bd.tokenAgeSec, 's')}` : '-',
        line: '前期龄≤600s ∧ 卖方≥8 ∧ 卖≥0.5B ∧ 跌≤10% ∧ 距锚≤60s ∧ 承接<30%（总额≥20B豁免；后期下跌段不评）', hit: parts.armHits.includes('dump_pair_low_absorption'),
      });
    }
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
      line: 'ath≥100% ∧ 总额≥11B ∧ burst结构（静默≥30s∧波近锚∧波买≥0.3B）；深破<−10豁免', hit: parts.armHits.includes('lifecycle_burst_residual'),
    });
    g.push({
      id: 'lifecycle_sell', label: 'T192·大周期卖压残局',
      value: `ath${d(parts.bd && parts.bd.athVsLaunchPct, '%')} 总额${d(parts.bd && parts.bd.totalVolumeBnb, 'B')} 静默${d(cd.burstLastGapSec, 's')} 簇距${d(cd.burstSecSinceSegEnd, 's')} 簇卖占${d(cd.burstWaveSegSellPct, '%')} 卖${d(cd.burstWaveSegSellBnb, 'B')}`,
      line: 'ath≥100% ∧ 总额≥11B ∧ 静默≥30s ∧ 簇距≤60s ∧ 簇卖占≥50% ∧ 卖≥0.3B；深破<−10豁免', hit: parts.armHits.includes('lifecycle_sell_residual'),
    });
    g.push({
      id: 'cd412', label: 'CD412·极端捆绑砸盘',
      value: `卖方${d(cd.nearDumpWorstSellers)} 块卖${d(cd.nearDumpWorstSellBnb, 'B')}`,
      line: '≥15户 ∧ ≥1B（破发豁免）', hit: parts.armHits.includes('cd412_extreme_dump_sellers'),
    });
    const w30g = (parts.bd && parts.bd.win && parts.bd.win[30]) || null;
    const actTailG = (parts.bd && parts.bd.activity) || null;
    g.push({
      id: 'cd414', label: 'CD414·短窗持续密集砸盘',
      value: `30s卖方${d(w30g && w30g.sellers)} 卖${d(w30g && w30g.sellBnb, 'B')} 净${d(w30g && w30g.netBnb, 'B')}`,
      line: '≥15户 ∧ ≥2B ∧ 净≤−1.5B（observe 命中票除外）', hit: parts.armHits.includes('cd414_dense_dump'),
    });
    g.push({
      id: 'tail_no_buyer', label: 'FP26·尾段买力枯竭+卖压在场',
      value: `尾5s买${d(actTailG && actTailG.nearTail5BuyN)}笔 30s卖${d(w30g && w30g.sellN)}笔 破发${d(parts.bd && parts.bd.launchMinVsFloorPct, '%')}`,
      line: '尾5s买≤1 ∧ 30s卖单≥5（卖压假活跃——货在砸、接盘者已走；FP40 深破<−10 豁免）', hit: parts.armHits.includes('tail_no_buyer_pressure'),
    });
    const ldLfd = (parts.bd && parts.bd.launchDefer) || null;
    g.push({
      id: 'launch_fail_dead', label: 'FP28·早窗启动失败死盘',
      value: `ath${d(parts.bd && parts.bd.athVsLaunchPct, '%')} 龄${d(parts.bd && parts.bd.tokenAgeSec, 's')} 尾7s买${d(actTailG && actTailG.nearTail7BuyN)}笔${ldLfd ? ` 首波清仓${ldLfd.firstWaveCleared === true ? '✓' : ldLfd.firstWaveCleared === false ? '✗' : '-'} 后波持${ldLfd.laterHolders ?? '-'} famous同块${d(ldLfd.famBlockPct, '%')}` : ''}`,
      line: 'ath<40 ∧ 龄<90s ∧ 尾7s买≤2（没拉起来过+尾段没人买=启动失败；FP43 换手豁免=首波清仓∧后波≥2家持∧famous同块<15%）', hit: parts.armHits.includes('launch_fail_dead'),
    });
    g.push({
      id: 'oversell_residual', label: 'T197·分仓出货残局盘',
      value: `超卖${d(parts.bd && parts.bd.oversellBnb, 'B')}(${d(parts.bd && parts.bd.oversellerN)}户) 钱包${d(parts.bd && parts.bd.anchorWalletN)} 距锚${d(parts.bd && parts.bd.oversellSecToAnchor, 's')}`,
      line: '超卖≥0.5B(单户≥0.3∧卖>买×1.5=curve外筹码) ∧ 钱包≤12（活跃度自产+无真实参与者）；FP46 洗筹距锚≥55s 豁免', hit: parts.armHits.includes('oversell_residual'),
    });
    g.push({
      id: 'arb_bot_holdings', label: 'T198·机器持筹垄断',
      value: `持筹${d(parts.bd && parts.bd.arbBotHoldCircPct, '%')}(${d(parts.bd && parts.bd.arbBotHolderN)}户) 流通${d(parts.bd && parts.bd.chip && parts.bd.chip.circSupplyPct, '%')}`,
      line: '≥30%在场流通 ∧ 流通≥16.5%（机器坐筹码无有机持有人；低流通=占比被小分母放大、占总供应小 → T198b 豁免；流通缺席照拦）', hit: parts.armHits.includes('arb_bot_holdings'),
    });
    g.push({
      id: 'holder_quiet_unload', label: 'FP27·大户静默卸货',
      value: `top5卖${d(parts.bd && parts.bd.bigHolderSellBnb60, 'B')} ath${d(parts.bd && parts.bd.athVsLaunchPct, '%')}`,
      line: '60s top5卖∈[0.1,0.3)B ∧ ath<80%（未走完周期庄提前离场；≥0.3=换手完成放行；T230 换手豁免=卖出大户均为窗内净买入者不拦）', hit: parts.armHits.includes('holder_quiet_unload'),
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
  // FP47a/b 两条数值臂的门行（T241b 分类补齐：每条因子臂都有门行；两者只在命中时
  // 才产 trace——未命中的值 '-'，不冒充判据数值）
  {
    const md = parts.md || null;
    const mdt = md && md.trace ? md.trace : {};
    g.push({
      id: 'malicious_dump', label: 'FP47a·恶意砸盘',
      value: md && md.hit
        ? `块${mdt.row === 'pair' ? '双' : '单'} 卖${d(mdt.sellBnb, 'B')} 跌${d(mdt.dropPct, '%')} 卖方${d(mdt.sellers)} 承接比${d(mdt.followBuyRatio)} 距锚${d(mdt.secToAnchor, 's')}`
        : (md && md.exempt ? `总额${d(mdt.totalVolumeBnb, 'B')}→豁免` : '-'),
      line: '卖≥0.5B ∧ 块内跌≥10% ∧ 卖方≥4（剔路由）∧ 承接比<0.5（单鲸版 / 相邻两块 / 贴锚臂；总额≥20B 豁免）',
      hit: parts.armHits.includes('malicious_dump'),
    });
  }
  {
    const cr = parts.crash || null;
    const crt = cr && cr.trace ? cr.trace : {};
    g.push({
      id: 'crash_numeric', label: 'FP47b·crash数值判序',
      value: cr && cr.hit
        ? `分支${cr.branch} chg5${d(crt.chg5Pct, '%')} chg10${d(crt.chg10Pct, '%')}${crt.recentDip5UnrecoveredPct != null ? ` 未收复${d(crt.recentDip5UnrecoveredPct, '%')}` : ''}`
        : '-',
      line: '急跌进行时（chg5≤-10 ∧ chg5≈chg10）∨ 趋势打断三口 ∨ 臂B（深段未收复 ∧ 买力不在场）∨ 臂A（尾段买归零 ∧ 卖≥0.4B）',
      hit: parts.armHits.includes('crash_numeric'),
    });
  }
  // FP48 crash 形态门行（T243：自 BP 因子应答器 BPF2 迁入——此前是信号页按 metadata.buyPoint
  // 合成的门行，现在后端门行自带）：进了复核（提示臂命中）才显示分支与判据数值，未进
  // 复核 '-'（不冒充判据）；锚缺席如实标「不判」
  {
    const cf = parts.crashForm || null;
    const cft = cf && cf.trace ? cf.trace : {};
    const FORM_BRANCH = { crash_form: '无回调+无换手', rebounding: '有回调', turnover_present: '有换手', no_sell: '卖单已停' };
    const reviewed = !!(cf && FORM_BRANCH[cf.branch]);
    g.push({
      id: 'crash_form', label: 'FP48·crash形态（无回调无换手）',
      value: reviewed
        ? `${FORM_BRANCH[cf.branch]} chg5${d(cft.chg5Pct, '%')} vsAth${d(cft.currentVsAthPct, '%')} chg30${d(cft.chg30Pct, '%')} 近5s跌${d(cft.nearMaxDn5Pct, '%')} 贴底${d(cft.curVsMinGapPct, 'pt')} 尾10s买${d(cft.nearTail10BuyN, '笔')} 卖${d(cft.nearTail10SellBnb, 'B')}`
        : (cf && cf.branch === 'anchors_missing' ? '锚缺席不判' : '-'),
      line: '提示臂（vsAth≤-25 ∨ chg30≤-25 ∨ 近段5s跌≤-15 ∨ 贴锚窗最低≤2pt）∧ chg5≤-1.5（无回调）∧ 尾10s买=0（无换手）∧ 尾10s卖>0',
      hit: parts.armHits.includes('crash_form'),
    });
  }
  return g.map((row) => ({ category: factorGateCategory(row.id), ...row }));
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

/** FP23 相邻双块捆绑砸盘尾承接（T190/0x2b63 案）：**前期域**（票龄 ≤600s——
 *  用户裁定「偏前期」是案特性，后期下跌段双块 8+ 卖方=市场化抛售放行）∧
 *  dump2Block 卖方 ≥8 ∧ 合并卖额 ≥0.5 ∧ 跌幅 ≤-10% ∧ 距锚 ≤60s ∧ 承接比
 *  <0.3 → 拒 dump_pair_low_absorption——CD403 单块 ≥0.5B 达标口径对「跨两块
 *  分摊的捆绑砸盘」失明的补集臂；承接比非贴锚用 followBuyRatio（60s 完整窗）、
 *  贴锚（<10s ratio 恒 null 观察窗未启）回落 followBuyBnb÷卖额（BP82 贴锚臂
 *  同款）；BP78 总额 ≥20B 豁免（市场化抛售）；锚缺失全族 null 容缺不拦
 *  （宁漏不冒充）。 */
function armDumpPairLowAbsorption(bd) {
  if (!bd || typeof bd.tokenAgeSec !== 'number' || bd.tokenAgeSec > DUMP_PAIR_EARLY_MAX_AGE_SEC) return false; // 前期域（后期下跌段不评）
  const d2 = bd.dump2Block;
  if (!d2 || typeof d2.sellers !== 'number' || d2.sellers < DUMP_RATIO_MIN_SELLERS) return false;
  if (typeof d2.sellBnb !== 'number' || d2.sellBnb < DUMP_PAIR_MIN_BNB) return false;
  if (typeof d2.dropPct !== 'number' || d2.dropPct > DUMP_PAIR_MAX_DROP_PCT) return false;
  if (typeof d2.secToAnchor !== 'number' || d2.secToAnchor > DUMP_PAIR_NEAR_SEC) return false;
  if (typeof bd.totalVolumeBnb === 'number' && bd.totalVolumeBnb >= DUMP_PAIR_TOTAL_VOLUME_EXEMPT_BNB) return false;
  const ratio = typeof d2.followBuyRatio === 'number' ? d2.followBuyRatio
    : (typeof d2.followBuyBnb === 'number' && d2.sellBnb > 0 ? d2.followBuyBnb / d2.sellBnb : null);
  return ratio !== null && ratio < DUMP_LOW_ABSORPTION_RATIO;
}

/**
 * FP47a 恶意砸盘桶因子化（BP69 entry_shape malicious_dump 四腿代码化）：
 * 判据=「恶意砸块」行四腿联立（卖额≥0.5 ∧ 块内跌幅≥10% ∧ 卖方≥4 剔路由 ∧
 * 承接比<0.5）∨ 单鲸版（卖额≥1.0 ∧ 最大卖家占≥30 ∧ 承接<0.5，不要求卖方数）
 * ∨ 相邻两块臂同款合并口径；贴锚臂（距锚<10s 承接观察窗未启 ratio 恒 null）：
 * 第四腿改「砸后已见买入 < 砸卖额 30%」（BP82）；BP78 总成交额豁免（≥20 BNB
 * 且非贴锚形状=市场化恐慌抛售非庄出逃）——mapper L313-333 逐字同款内联。
 * null 容缺：任一腿键缺失 → 该腿不立（宁漏不误伤——FP 门 fail-open 同向；
 * 漏判由 BP Jev 兜底）。注意：dumpBlock 候选预筛线（0.3B/8%）宽于本臂四腿
 * （0.5/10%），不能假设候选行已达标——四腿必须自验。
 * @param {Object} bd - snapshot.buyDerived
 * @returns {{hit:boolean, branch:string|null, exempt:string|null, trace:Object}}
 */
function judgeMaliciousDump(bd) {
  const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const trace = {
    row: null, sellBnb: null, dropPct: null, sellers: null, followBuyRatio: null,
    followBuyBnb: null, secToAnchor: null, topSellerPct: null, followKind: null,
  };
  if (!bd) return { hit: false, branch: null, exempt: null, trace };
  const d1 = bd.dumpBlock || null, d2 = bd.dump2Block || null;
  // 第四腿（承接不足）：true 语义由 followKind 承载——'ratio'=完整窗承接比坐实、
  // 'anchor'=贴锚臂已见买入占比坐实（BP82）；null=证据缺席不立（距锚≥10s 且
  // ratio null 不应出现/距锚秒数缺失，保守不立）
  const followKindOf = (row) => {
    if (!row) return null;
    const ratio = fin(row.followBuyRatio);
    if (ratio !== null) return ratio < MD_MAX_FOLLOW_RATIO ? 'ratio' : null;
    const sec = fin(row.secToAnchor);
    if (sec !== null && sec < MD_ANCHOR_MAX_SEC) {
      const buy = fin(row.followBuyBnb), sell = fin(row.sellBnb);
      if (buy === null || sell === null || sell <= 0) return null;
      return buy / sell < MD_ANCHOR_MAX_BUY_RATIO ? 'anchor' : null;
    }
    return null;
  };
  const assess = (row) => {
    if (!row) return null;
    const sell = fin(row.sellBnb), drop = fin(row.dropPct), sellers = fin(row.sellers);
    if (sell === null || drop === null || sellers === null) return null;
    const followKind = followKindOf(row);
    if (followKind === null) return null;
    const legs = sell >= MD_MIN_SELL_BNB && drop <= MD_MIN_DROP_PCT && sellers >= MD_MIN_SELLERS;
    const top = fin(row.topSellerPct);
    const whale = sell >= MD_WHALE_MIN_SELL_BNB && top !== null && top >= MD_WHALE_MIN_TOP_SELLER_PCT;
    if (!legs && !whale) return null;
    return { kind: whale && !legs ? 'whale' : (whale ? 'legs_whale' : 'legs'), followKind };
  };
  const a1 = assess(d1), a2 = assess(d2);
  if (!a1 && !a2) return { hit: false, branch: null, exempt: null, trace };
  // BP78/BP82 豁免（mapper L313-333 逐字同款）：总成交额 ≥20 ∧ 非贴锚形状
  // （砸块行在场 ∧ 两条承接腿均 null=<10s 观察窗未启=贴锚，脉冲砸盘非市场化
  // 恐慌抛售）。砸块行缺席（越题形状）保持存量豁免行为 bit 不变。
  const tv = fin(bd.totalVolumeBnb);
  const r1 = d1 ? fin(d1.followBuyRatio) : null, r2 = d2 ? fin(d2.followBuyRatio) : null;
  const hasDumpRow = !!d1 || !!d2;
  const obsBlocked = hasDumpRow && r1 === null && r2 === null;
  if (tv !== null && tv >= MD_TOTAL_VOLUME_EXEMPT_BNB && !obsBlocked) {
    return { hit: false, branch: null, exempt: 'dump_total_volume', trace: { ...trace, totalVolumeBnb: tv } };
  }
  const row = a2 ? d2 : d1;
  const { kind, followKind } = a2 || a1;
  const t = {
    row: a2 ? 'pair' : 'single', sellBnb: fin(row.sellBnb), dropPct: fin(row.dropPct),
    sellers: fin(row.sellers), followBuyRatio: fin(row.followBuyRatio),
    followBuyBnb: fin(row.followBuyBnb), secToAnchor: fin(row.secToAnchor),
    topSellerPct: fin(row.topSellerPct), followKind,
  };
  return { hit: true, branch: `${a2 ? 'pair' : 'single'}_${kind}${followKind === 'anchor' ? '_anchor' : ''}`, exempt: null, trace: t };
}

/**
 * FP47b crash 数值判序因子化（BP69 entry_shape crash 桶的判序四步制+打断家族
 * 代码化；「无回调+无换手」形态复核（价格拱归纳）留 Jev 兜底——FP 灰关/漏判
 * 时 Jev 照判全判据）：
 * 判序（逐字题面）：①反弹两件套（chg5 转正 ∧ 未收复收窄 >-20）→ 放行
 * （打断家族唯一放行出口，判序必须①在前）→ 打断家族（急跌进行时 chg5 深负
 * ∧ chg5≈chg10 同深无铺垫 ∨ 摆点轴三腿〔形态前提=上升腿 ≥60s ∧ ≥20%，秒级
 * 开盘脉冲不算〕∨ 打断余波域）→ hit → 深段在场（锚前 30s 内 ≤-18 级）→
 * 臂 B：②买入力在场（尾10s ≥3笔 ∧ ≥0.1B）→ 放行（打断家族已在上游 hit，
 * 此处只剩非打断家族）③深段坐实（未收复 ≤-20 ∧ 买力不在场）→ hit('arm_b')
 * → 非深段 → 臂 A（本地买方缺席的单边下跌段；反例区分腿=近窗换手在场不落）。
 * null 容缺：键缺失 → 对应腿不立（宁漏不误伤；漏判由 BP Jev 兜底）。
 * @param {Object} bd - snapshot.buyDerived
 * @returns {{hit:boolean, branch:string|null, trace:Object}}
 */
function judgeCrashNumeric(bd) {
  const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const act = (bd && bd.activity) || {};
  const trace = {
    chg5Pct: null, chg10Pct: null, secSinceSwingHigh: null, currentVsSwingHighPct: null,
    swingRiseSec: null, swingRisePct: null, recentDip5Pct: null, recentDip5SecAgo: null,
    recentDip5UnrecoveredPct: null, nearTail5BuyN: null, nearTail10BuyBnb: null,
    nearTail10SellBnb: null, win120BuyBnb: null, win120MaxBuyBnb: null, win120SellBnb: null,
  };
  if (!bd) return { hit: false, branch: null, trace };
  const chg5 = fin(bd.chg5Pct), chg10 = fin(bd.chg10Pct);
  const unrecovered = fin(bd.recentDip5UnrecoveredPct);
  const tailBuyBnb = fin(act.nearTail10BuyBnb), tailSellBnb = fin(act.nearTail10SellBnb);
  const tailBuyN = fin(act.nearTail10BuyN), tail5BuyN = fin(act.nearTail5BuyN);
  trace.chg5Pct = chg5; trace.chg10Pct = chg10; trace.recentDip5UnrecoveredPct = unrecovered;
  trace.nearTail5BuyN = tail5BuyN; trace.nearTail10BuyBnb = tailBuyBnb; trace.nearTail10SellBnb = tailSellBnb;
  // ① 反弹两件套（chg5 转正 ∧ 未收复收窄 -20 内）→ 放行——打断家族唯一放行出口，判序必须①在前
  if (chg5 !== null && chg5 > 0 && unrecovered !== null && unrecovered > DIP_UNRECOVERED_PCT) {
    return { hit: false, branch: 'rebound_kit', trace };
  }
  // 急跌进行时（chg 同深轴同式——题面明言两轴同式）
  const momentumCrash = chg5 !== null && chg10 !== null
    && chg5 <= CRASH_CHG5_DEEP && Math.abs(chg5 - chg10) <= CRASH_CHG_SAME_DEPTH_GAP;
  // 摆点轴三腿（含上升腿形态前提：≥60s ∧ ≥20% 的持续上涨）
  const riseSec = fin(bd.swingRiseSec), risePct = fin(bd.swingRisePct);
  const riseLeg = riseSec !== null && riseSec >= SWING_RISE_MIN_SEC
    && risePct !== null && risePct >= SWING_RISE_MIN_PCT;
  const swingCrash = riseLeg
    && fin(bd.secSinceSwingHigh) !== null && fin(bd.secSinceSwingHigh) <= SWING_NEAR_SEC
    && fin(bd.currentVsSwingHighPct) !== null && fin(bd.currentVsSwingHighPct) <= SWING_VS_HIGH_PCT;
  // 打断余波域（摆高停旧形状：上升腿形态前提 + 锚前 30s 内 ≥15% 深段 + 未收复 ≤-20）
  const dipPct = fin(bd.recentDip5Pct), dipSecAgo = fin(bd.recentDip5SecAgo);
  const waveAftermath = riseLeg
    && dipPct !== null && dipPct <= DIP_WAVE_PCT
    && dipSecAgo !== null && dipSecAgo <= DIP_MAX_SEC_AGO
    && unrecovered !== null && unrecovered <= DIP_UNRECOVERED_PCT;
  trace.secSinceSwingHigh = fin(bd.secSinceSwingHigh); trace.currentVsSwingHighPct = fin(bd.currentVsSwingHighPct);
  trace.swingRiseSec = riseSec; trace.swingRisePct = risePct;
  trace.recentDip5Pct = dipPct; trace.recentDip5SecAgo = dipSecAgo;
  if (momentumCrash || swingCrash || waveAftermath) {
    return { hit: true, branch: momentumCrash ? 'momentum' : (swingCrash ? 'swing' : 'wave_aftermath'), trace };
  }
  // 深段在场（锚前 30s 内 ≤-18 级）→ 臂 B 判序
  const dipDeep = dipPct !== null && dipPct <= DIP5_MIN_PCT
    && dipSecAgo !== null && dipSecAgo <= DIP_MAX_SEC_AGO;
  const tailBuyPresent = tailBuyN !== null && tailBuyBnb !== null
    && tailBuyN >= ARM_A_MIN_BUY_N && tailBuyBnb >= ARM_A_DUST_BUY_BNB;
  if (dipDeep) {
    // ② 买入力在场豁免 → 放行（打断家族不享本豁免——但其已在上游 hit 返回）
    if (tailBuyPresent) return { hit: false, branch: 'arm_b_buyforce', trace };
    // ③ 深段未收复坐实（买力不在场）→ 拒；未收复已收窄（>-20）不坐实=Jev 兜底
    if (unrecovered !== null && unrecovered <= DIP_UNRECOVERED_PCT) {
      return { hit: true, branch: 'arm_b', trace };
    }
    return { hit: false, branch: 'arm_b_pass', trace };
  }
  // 臂 A（本地买方缺席的单边下跌段——「先买入拉起、然后只有卖出」）；
  // 反例区分腿（必复刻，G9/CD133 红线）：近窗双边像样换手在场不落
  if (chg5 !== null && chg5 < 0) {
    const w120 = (bd.win && bd.win[120]) || {};
    const w120Buy = fin(w120.buyBnb), w120Max = fin(w120.maxBuyBnb), w120Sell = fin(w120.sellBnb);
    trace.win120BuyBnb = w120Buy; trace.win120MaxBuyBnb = w120Max; trace.win120SellBnb = w120Sell;
    const nearSwap = w120Buy !== null && w120Buy >= ARM_A_NEAR_BUY_BNB
      && w120Max !== null && w120Max >= ARM_A_BIG_SINGLE;
    if (!nearSwap) {
      // 尾段路径：尾 10s 买归零/纯尘（合计 <0.1B；单笔大额不弱）∨ 尾 5s 买笔 0
      const tailBuyDead = tailBuyBnb !== null && tailBuyBnb < ARM_A_DUST_BUY_BNB;
      const tail5Dead = tail5BuyN === 0;
      const tailSellStrong = tailSellBnb !== null && tailSellBnb >= ARM_A_TAIL_SELL_BNB;
      const tailArm = (tailBuyDead || tail5Dead) && tailSellStrong;
      // 近窗延展路径：近 120s 买归零/仅纯小单（无 ≥0.19 单笔）∧ 卖 ≥0.4 级
      const nearBuyDead = w120Buy !== null
        && (w120Buy === 0 || (w120Max !== null && w120Max < ARM_A_BIG_SINGLE))
        && w120Sell !== null && w120Sell >= ARM_A_TAIL_SELL_BNB;
      if (tailArm || nearBuyDead) return { hit: true, branch: 'arm_a', trace };
    }
  }
  return { hit: false, branch: 'pass', trace };
}

/**
 * crash 形态（FP48；T243 自 BP 因子应答器 BPF2 迁入）——「数值臂只是进入复核的提示，
 * 定桶看价格拱形态 + 近窗买卖结构」的因子直译，判序逐条对应原题面：
 *  ⓪ 锚缺席不判（反锚①「窗极短 / 各锚 ? 缺失不判 crash——判缺不猜」；研究集里锚
 *     缺失面含金狗 쿠우타 +55%）；
 *  ① 数值提示臂四选一命中才进复核；
 *  ② 有回调 → 放行（chg5 已转正 / 走平 = 出现反弹）；
 *  ③ 有换手 → 放行（尾 10 秒有买单 = 买方在场）；
 *  ④ 卖单未停（尾 10 秒有卖出）∧ 以上全过 = 无回调 + 无换手的单边下跌 → hit。
 * judgeCrashNumeric（急跌进行时 / 趋势打断 / 臂 A / 臂 B）在臂链更前，本函数只接
 * 它放行后剩下的「缓跌 / 阴跌」形状。
 * @param {Object|null} bd - 买点快照 buyDerived
 * @returns {{hit:boolean, branch:string, trace:Object}}
 */
function judgeCrashForm(bd) {
  const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const act = (bd && bd.activity) || {};
  const chg5 = fin(bd && bd.chg5Pct);
  const chg30 = fin(bd && bd.chg30Pct);
  const vsAth = fin(bd && bd.currentVsAthPct);
  const nearDn5 = fin(bd && bd.nearMaxDn5Pct);
  const minGap = fin(bd && bd.curVsMinGapPct);
  const dip5 = fin(bd && bd.recentDip5Pct);
  const tailBuyN = fin(act.nearTail10BuyN);
  const tailSellBnb = fin(act.nearTail10SellBnb);
  const trace = {
    chg5Pct: chg5, chg30Pct: chg30, currentVsAthPct: vsAth, nearMaxDn5Pct: nearDn5,
    curVsMinGapPct: minGap, recentDip5Pct: dip5, nearTail10BuyN: tailBuyN, nearTail10SellBnb: tailSellBnb,
  };
  if (!bd) return { hit: false, branch: 'no_snapshot', trace };
  if (chg5 === null || dip5 === null || tailBuyN === null || tailSellBnb === null) {
    return { hit: false, branch: 'anchors_missing', trace };
  }
  const hint = (vsAth !== null && vsAth <= CRASHFORM_VS_ATH_MAX)
    || (chg30 !== null && chg30 <= CRASHFORM_CHG30_MAX)
    || (nearDn5 !== null && nearDn5 <= CRASHFORM_NEAR_DN5_MAX)
    || (minGap !== null && minGap <= CRASHFORM_MIN_GAP_MAX);
  if (!hint) return { hit: false, branch: 'no_hint', trace };
  if (chg5 > CRASHFORM_CHG5_MAX) return { hit: false, branch: 'rebounding', trace };
  if (tailBuyN > CRASHFORM_TAIL_BUY_N_MAX) return { hit: false, branch: 'turnover_present', trace };
  if (!(tailSellBnb > 0)) return { hit: false, branch: 'no_sell', trace };
  return { hit: true, branch: 'crash_form', trace };
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

/** T201 大户推迟臂（ladder v34 G2 自条件串迁入 FP——T180 同款迁移，用户裁定
 *  「放到因子过滤模块后，才能支持比较复杂的策略（后续的改进）」）：判定线与
 *  条件串时代逐字一致——大户合计买入 ≥0.79 档推迟到首笔交易+45s、≥1 档 60s
 *  （T151/T169/T173 线不动）、深破 <−10 豁免（T173）；键源 buyDerived.launchDefer
 *  三锚（FA launchBigBuyBnb/sinceFirstTradeSec/launchMinVsFloorPct 镜像）。
 *  键缺席（launchDefer null=截窗未覆盖出生段/零买；sFT null=窗内无可靠买价）
 *  → 不评=放行（老票 sFT>60 域放行语义等价，T180 launchSquad 同约定）。
 *  ⚠消耗语义变化（用户知情裁定 A 形态）：FP 普通臂拒=fire 已消耗 maxTriggers+
 *  T110 信号桶——推迟窗内的近触发现在落行留痕可定位（此前 condition 层零留痕），
 *  代价是推迟期触发烧桶、60s 后的入场改由剩余腿/触发数接棒。 */
const BIG_BUY_DEFER_TIER079_BNB = 0.79;
const BIG_BUY_DEFER_TIER1_BNB = 1;
const BIG_BUY_DEFER_SEC_TIER079 = 45;
const BIG_BUY_DEFER_SEC_TIER1 = 60;
const BIG_BUY_DEFER_EXEMPT_FLOOR_PCT = -10;
// FP42/JG-32f 豁免腿线：famous 同块捆绑占比线 15%+后波持有 ≥2 家
const BIG_BUY_DEFER_EXEMPT_FAM_BLOCK_PCT = 15;
const BIG_BUY_DEFER_EXEMPT_LATER_HOLDERS = 2;
function armBigBuyDefer(bd) {
  const ld = bd && bd.launchDefer;
  if (!ld || typeof ld.bigBuyBnb !== 'number' || typeof ld.sinceFirstTradeSec !== 'number') return false;
  if (typeof ld.minVsFloorPct === 'number' && ld.minVsFloorPct < BIG_BUY_DEFER_EXEMPT_FLOOR_PCT) return false;
  // FP42/JG-32f 豁免腿（用户框架「前期 sniper 走光，有人接盘（初步证明传播力），但接盘
  // 力量不能是 famous+跟单买入，否则成 famous 收割票」——只用于本门豁免场景）：
  // 首波（开盘 10s 内买 ≥0.1B）as-of 全清仓（净持≤10%买）∧ 后波 ≥2 家持有（净持≥50%）
  // ∧ famous 所在块（≥2 买钱包）买入占比 <15% → 不推迟直接放行。
  // 域内 2×2 验证（182 tmp-jg32f-domain.cjs，FP32 域 374 拒点四窗）：B∧fam<15 n=16
  // stall +1.62B（唯一正组）fwd 中位 54.6% 肥尾 2（登天猫 918/Greg 222）；B∧fam≥15
  // n=8 stall −0.20B 零肥尾（B' 臂端到端 5 负 1 微正=丁真/女大/人生指南/MEME 全拦）；
  // 非 B 组 350 张 stall −4.5B=豁免严格限 B 不外溢。null 三键任一=豁免证据缺席
  // 不豁免保持拦（FP33/FP36/FP39 惯例）。台账 T208+金狗 JG-32f。
  if (ld.firstWaveCleared === true
    && typeof ld.laterHolders === 'number' && ld.laterHolders >= BIG_BUY_DEFER_EXEMPT_LATER_HOLDERS
    && typeof ld.famBlockPct === 'number' && ld.famBlockPct < BIG_BUY_DEFER_EXEMPT_FAM_BLOCK_PCT) return false;
  if (ld.bigBuyBnb < BIG_BUY_DEFER_TIER079_BNB) return false;
  if (ld.bigBuyBnb < BIG_BUY_DEFER_TIER1_BNB && ld.sinceFirstTradeSec > BIG_BUY_DEFER_SEC_TIER079) return false;
  return ld.sinceFirstTradeSec <= BIG_BUY_DEFER_SEC_TIER1;
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
 *  null（totalSupply 缺失）→ 不拦（流通腿=救回条件，null 走放行 fail-open）。
 *  FP41 实体口径豁免腿（2026-11-22 JG-31 立法，用户裁定「捆绑购买看成是
 *  一个钱包」直接立法先粗糙；理念=本门拦「筹码实质分散无主力」，聚合购买的
 *  多钱包实质是一个主体——钱包口径把一个主体误量成 N 个独立持有者与基本
 *  理念相违背，实体口径为忠实度量）：holderHHIEntities（同首买块捆绑钱包合并成
 *  实体的 Σ份额²，GMGN 捆绑行为单位口径——实证 ZKind 0xa79e 锚同块 6 钱包
 *  0.1B 档全走 GMGN 路由 to=0x1de460f3、gas 全 1M，六路独立滑点但同块同通道
 *  同档；散户 HHI 0.0746 → 合并 0.3475=新实体接管 51% 筹码的主力盘，非
 *  「均分无主力」残局；等额/等量指纹〔T74/T172〕对滑价序列判不出）≥0.10
 *  → 不拦——伪分散（捆绑/跟单矩阵在场=有主）与真分散（独立散户残局=无主）
 *  分开，双腿全低才拦。全域验证（w1003+w1019 even 命中 161 行 182 重放，
 *  tmp-jg24-fp22-ent.cjs）：豁免面 43 行 fwdPeak 中位 +10.8% vs 照拦 118 行
 *  +1.7%、≥50% 密度 3 倍、零深亏峰、跨窗稳定；单臂真实放行 4 行=ZKind
 *  +256%/国际脸/0x2bb16aef/만세 三险票（有峰可逃）知情。伤害面=币安锁型
 *  「拉高中段簇在场→豁免→秒砸」时点（全史扫描 16 采样 6 豁免含 1 个 120s
 *  内遭大卖）知情留档。null=豁免证据缺席不豁免保持拦（FP33/FP36/FP39
 *  惯例）。台账 T207+金狗 JG-31。 */
const HOLDER_EVEN_CREW_MAX_HHI = 0.10;
const HOLDER_EVEN_CREW_MIN_CIRC_PCT = 16.5;
const HOLDER_EVEN_CREW_EXEMPT_ENT_HHI = 0.10;
function armEvenSplitCrew(bd) {
  const chip = bd && bd.chip;
  if (!chip || typeof chip.holderHHI !== 'number') return false;
  if (chip.holderHHI >= HOLDER_EVEN_CREW_MAX_HHI) return false;
  // FP41 实体口径豁免：合并捆绑钱包后仍无主力（实体 HHI 也 <0.10）才是真均分残局；
  // 合并后 ≥0.10=有主力结构（新实体接管/团伙矩阵在场）→ 不拦；null=证据缺席保持拦
  if (typeof chip.holderHHIEntities === 'number'
    && chip.holderHHIEntities >= HOLDER_EVEN_CREW_EXEMPT_ENT_HHI) return false;
  if (typeof chip.circSupplyPct !== 'number') return false; // 流通腿缺席=无法确认高流通，救回方向 fail-open
  return chip.circSupplyPct >= HOLDER_EVEN_CREW_MIN_CIRC_PCT;
}

/** FP18 尾部接刀：域（拉高过 ∧ 回到触发线内低位）∧ 5s 急跌 ∧ 30s 同向 → 拒
 *  tail_dip_knife（T182）。双腿刀缺一不拦：chg30 企稳（≥-5）的瞬间深针=V 型
 *  反弹入场点（dae106 chg30=-1.7/chg5=-13.1 → ep+88 正票）刻意保护。
 *  T205 量腿（fix②，灰度 enableTailDipVolumeLeg）：崩塌必须有量——锚前 30s
 *  卖额 ≥0.3B 才构成「从高点下来」（空簿尘埃漂移不拦，GWC 案 0.164B 误杀反证）；
 *  卖额缺席（旧档/无 win30）=臂不触发（本臂 null 容缺同哲学）。
 *  FP39 深破豁免（一姐 0xfc23 案，用户裁定）：launchMinVsFloorPct < -10（锚窗
 *  滚动最低深破发行价 10pt，FP16/FP25/FP32 深破豁免 G1 同线）→ 不拦——破发=
 *  这轮下杀已跌穿地板、「别接崩塌进行时」的风险模型不再适用（三窗：深破层
 *  损耗最轻中位 −3.9/深跌 2 票 vs 浅破层 −14.0/10 票=分层同向）；null=豁免
 *  证据缺席不豁免保持拦（FP33/FP36 惯例）。 */
function armTailDipKnife(bd, opts = {}) {
  if (!bd) return false;
  if (typeof bd.athVsLaunchPct !== 'number' || bd.athVsLaunchPct < TAIL_KNIFE_MIN_ATH_VS_PCT) return false;
  if (typeof bd.currentVsLaunchPct !== 'number' || bd.currentVsLaunchPct > TAIL_KNIFE_MAX_CUR_VS_PCT) return false;
  if (typeof bd.chg5Pct !== 'number' || bd.chg5Pct >= TAIL_KNIFE_MAX_CHG5_PCT) return false;
  if (typeof bd.chg30Pct !== 'number' || bd.chg30Pct >= TAIL_KNIFE_MAX_CHG30_PCT) return false;
  if (typeof bd.launchMinVsFloorPct === 'number' && bd.launchMinVsFloorPct < TAIL_KNIFE_BREAK_EXEMPT_VS_PCT) return false; // FP39 深破豁免
  if (opts.enableTailDipVolumeLeg === true) {
    const w30 = bd.win && bd.win[30];
    if (!w30 || typeof w30.sellBnb !== 'number' || w30.sellBnb < TAIL_KNIFE_MIN_DIP_SELL_BNB) return false;
  }
  return true;
}

/** FP33/JG6 tail_dip 有机盘豁免（金狗 쿠우타 0xc0e896dd…7777 案，2026-11-21）：
 *  T182 命中时九腿全真 → 豁免放行——「famous 快闪砸出黄金坑+散户自然传播」形状：
 *  做市商痕迹弱（无对敲/无 insider 抛货/筹码分散/无捆绑持仓）∧ 散户通道主导
 *  ∧ 量级带 [3,8]（火过但注意力没释放完）∧ famous 参与（自然流量背书）∧
 *  famous 无重跟单（粉丝团冲量非自然）。**null=豁免证据缺席不豁免保持拦**
 *  （宁拦不冒充——与 FP 臂族拒方向容缺同哲学但方向相反：豁免方向要求证据齐全）。
 *  cd=cheatDerived（washPairCount null=零对敲与 0 同判）；ft=buyDerived.famousTraces。 */
function tailDipOrganicExempt(cd, ft) {
  if (!cd) return { ok: false, failLeg: 'noCheatDerived' };
  if (typeof cd.washPairCount === 'number' && cd.washPairCount > 0) return { ok: false, failLeg: 'washPairCount' }; // null=零对敲放行
  if (typeof cd.noBuySellPct !== 'number' || cd.noBuySellPct >= TAIL_DIP_EXEMPT_MAX_NO_BUY_SELL_PCT) return { ok: false, failLeg: 'noBuySellPct' };
  if (typeof cd.holderHHI !== 'number' || cd.holderHHI >= TAIL_DIP_EXEMPT_MAX_HOLDER_HHI) return { ok: false, failLeg: 'holderHHI' };
  if (typeof cd.totalBuyBnb !== 'number' || cd.totalBuyBnb < TAIL_DIP_EXEMPT_MIN_TOTAL_BUY_BNB || cd.totalBuyBnb > TAIL_DIP_EXEMPT_MAX_TOTAL_BUY_BNB) return { ok: false, failLeg: 'totalBuyBnb' };
  if (typeof cd.routerEntryBuyPct !== 'number' || cd.routerEntryBuyPct < TAIL_DIP_EXEMPT_MIN_ROUTER_ENTRY_PCT) return { ok: false, failLeg: 'routerEntryBuyPct' };
  if (typeof cd.top1BuyPct !== 'number' || cd.top1BuyPct >= TAIL_DIP_EXEMPT_MAX_TOP1_BUY_PCT) return { ok: false, failLeg: 'top1BuyPct' };
  if (typeof cd.sameBlockHoldCircPct !== 'number' || cd.sameBlockHoldCircPct > TAIL_DIP_EXEMPT_MAX_SAME_BLOCK_HOLD_CIRC_PCT) return { ok: false, failLeg: 'sameBlockHoldCircPct' };
  if (!ft || typeof ft.groupBuyBnb !== 'number' || ft.groupBuyBnb < TAIL_DIP_EXEMPT_MIN_FAMOUS_GROUP_BUY_BNB) return { ok: false, failLeg: 'famGroupBuyBnb' };
  if (typeof ft.famousCohortMaxWallets !== 'number' || ft.famousCohortMaxWallets > TAIL_DIP_EXEMPT_MAX_FAMOUS_COHORT_WALLETS) return { ok: false, failLeg: 'famCohortMaxWallets' };
  return { ok: true, failLeg: null };
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
 * FP16 大周期 burst 残局：走过一轮大生命周期（ATH ≥+100% ∧ 总额 ≥11B——T191
 * 自 15 降线，chibi 0x854d4f2f…7777 案）的票，burst 结构在场（静默 ≥30s →
 * 出口波贴近锚 ≤60s ∧ 波买 ≥0.3B）→ 拒——「不买 burst」。深破豁免
 * launchMinVsFloorPct < -10（真重启票放行，G1 五连收线同线）。
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

/**
 * T192/FP25 大周期卖压残局：走过一轮大生命周期（FP16 同主干 ath≥100 ∧ 总额≥11）
 * 的票，最后静默段（≥30s）出口的 CD407 最大流量簇**卖主导**（卖占比 ≥50 ∧ 卖额
 * ≥0.3B）且贴近锚（簇末距窗末 ≤60s=当下事件非历史遗迹）→ 拒——「尾声的卖出
 * 流量与买入 burst 对称，都不接」。深破豁免与 FP16 同线（<−10 真重启放行）。
 * 与 FP16 的分工：FP16 管**买入涌入**（D3.67 波锚+波买 ≥0.3）；本臂管**卖出
 * 砸出**——D3.67 波锚（按笔数最密 5s 窗）在卖簇劫持形状下结构性 null（窗内
 * 零 BUY），本臂以 CD407 簇键+簇末距锚独立成腿，不修波定位器。
 * null 语义同 FP16：拒方向证据缺席不拒（ath/总额/静默/簇锚任一 null → 不拦）；
 * 豁免证据缺席不豁免（launchMinVsFloorPct null → 照拦）。
 */
function armLifecycleSellResidual(bd, cd) {
  if (!bd || !cd) return false;
  if (typeof bd.athVsLaunchPct !== 'number' || bd.athVsLaunchPct < LIFECYCLE_MIN_ATH_PCT) return false;
  if (typeof bd.totalVolumeBnb !== 'number' || bd.totalVolumeBnb < LIFECYCLE_MIN_TOTAL_VOLUME_BNB) return false;
  if (typeof cd.burstLastGapSec !== 'number' || cd.burstLastGapSec < LIFECYCLE_BURST_STALL_GAP_SEC) return false;
  if (typeof cd.burstSecSinceSegEnd !== 'number' || cd.burstSecSinceSegEnd > SBW_PROXY_WAVE_NEAR_SEC) return false;
  if (typeof cd.burstWaveSegSellPct !== 'number' || cd.burstWaveSegSellPct < LIFECYCLE_SELL_MIN_SELL_PCT) return false;
  if (typeof cd.burstWaveSegSellBnb !== 'number' || cd.burstWaveSegSellBnb < LIFECYCLE_SELL_MIN_SELL_BNB) return false;
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
      // T200/FP31 薄盘分支中等跟单豁免（用户裁定「中等跟单 0.05~0.2 可以先豁免」）：
      // famous 首买后**即时跟单**（slot 级窄定义=同 slot+2 内非 famous 买入）落在
      // [0.05,0.2) 有机热度带 → 放行不拦——四窗 U 型实证该带 win 71% 最好（零响应
      // <0.05 win 20% 与重跟单 ≥0.2 win 31% 都差）；豁免证据缺席（famousFollowBnb
      // null=famous 首买 block 缺失）不豁免保持拦（宁拦不冒充——原 thin 证据仍在场）
      const fb = typeof ft.famousFollowBnb === 'number' ? ft.famousFollowBnb : null;
      const followExempt = fb !== null && fb >= FAM_THIN_FOLLOW_EXEMPT_MIN_BNB && fb < FAM_THIN_FOLLOW_EXEMPT_MAX_BNB;
      if (!followExempt) {
        return { hit: 1, branch: 'fam_holding_thin', reason: 'fam_holding_thin', trace: { ...trace, famousFollowBnb: fb, followExempt } };
      }
      return { hit: 0, branch: 'fam_holding_thin_exempt_follow', reason: null, trace: { ...trace, famousFollowBnb: fb, followExempt: true } };
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
// ── T213b 好散户币通路包策略（2026-11-23 用户裁定「FP 只留严重作弊门」）──
// 作弊类臂全集（armClass='cheat' 时唯一参与拦截的码集）：捆绑/团伙分仓/砸盘承接族/
// 机器持筹/慢拉卸货 + act_ultra（协同出货/极端密度=wash 密度流——刻意保留的假流量
// 维度，与「活跃度要求降低」撤的 low 档不同轴）。效果提升类（pvp/act_low/尾声/famous
// 族/大户推迟/接刀/残局族/launch_fail/静默卸货/burst 承接族 cd401）全撤——CD 16 题
// 作弊门在门链后段兜底流量真实性。
const CHEAT_CLASS_ARM_CODES = new Set([
  'launch_squad_dominance', 'even_split_crew', 'oversell_residual', 'arb_bot_holdings',
  'cd400_dump_no_absorption', 'cd403_dump_low_absorption', 'dump_pair_low_absorption',
  'cd405_burst_bundled_wave', 'cd412_extreme_dump_sellers', 'cd414_dense_dump',
  'slow_pump_unload', 'act_ultra',
]);

/**
 * 臂类别过滤（纯函数，armClass 策略的决策核——单测锁定）：
 * null=现行全臂语义 bit 不变；'cheat'=只留作弊类臂（act_ultra 优先级保持）。
 * exempt=T217 pointType 臂差集（如 retail 去 slow_pump_unload——FP8a 慢拉卸货与
 * CD slowGrindPump 同形状先验：famous 自然带量入场≠虚假拉盘）；对全臂语义同样
 * 适用（normal 类型也可携差集，缺省空=零变化）。
 * @returns {{arms: string[], reason: string|null}}
 */
function filterArmsByClass(parts, armClass, exempt = []) {
  const ex = Array.isArray(exempt) && exempt.length ? new Set(exempt) : null;
  // T225 修（개구리씨 案）：臂差集此前只过滤 arms 数组（cd 族）——famous/tail/pvp 三族
  // 的 reason 在优先级链里不经过 exempt=fam_holding_thin 豁免无效的根因；三族 reason
  // 同过差集（命中豁免=该族不产拒因，观察臂照算）
  const _fx = (r) => (ex && r && ex.has(r) ? null : r);
  if (armClass !== 'cheat') {
    const eff = ex ? parts.arms.filter((c) => !ex.has(c)) : parts.arms;
    const reason = parts.actLevel === 'low' ? 'act_low'
      : (parts.actLevel === 'ultra' ? 'act_ultra'
        : (_fx(parts.pvpReason) || _fx(parts.tailReason) || _fx(parts.famousReason) || (eff.length ? eff[0] : null)));
    return { arms: eff, reason };
  }
  const arms = (ex ? parts.arms.filter((c) => !ex.has(c)) : parts.arms)
    .filter((c) => CHEAT_CLASS_ARM_CODES.has(c));
  const reason = arms.includes('act_ultra') ? 'act_ultra' : (arms.length ? arms[0] : null);
  return { arms, reason };
}

function evaluateFactorPreBuy(snapshot, opts = {}) {
  const enableCheatArms = opts.enableCheatArms !== false;
  const enablePvp = opts.enablePvp !== false;
  const enableActivity = opts.enableActivity !== false;
  const enableFamous = opts.enableFamous !== false;
  const enableTail = opts.enableTail !== false;
  // FP33/JG6 tail_dip 有机盘豁免灰度（缺省 false=关=FP32 行为 bit 不变）
  const enableTailDipExempt = opts.enableTailDipExempt === true;
  // T205 两灰度（缺省 false=FP34 行为 bit 不变）：fix① act low 家族阶段前提 /
  // fix② tail_dip 量腿（BuyPointCheckService 从 factorCheck.actStageColdExempt /
  // factorCheck.tailDipVolumeLeg 透传）
  const enableActStageCold = opts.enableActStageCold === true;
  const enableTailDipVolumeLeg = opts.enableTailDipVolumeLeg === true;
  const pvp = enablePvp
    ? judgeRetailPvp(snapshot)
    : { hit: 0, branch: 'disabled', reason: null, trace: {} };
  const arms = [];
  const cd = snapshot.cheatDerived || {};
  // T210 停滞再启动通路（纯函数判定，原料=cheat 快照 stallRestart* 九键）：命中时
  // 低活跃五臂让位（judgeActivityLevel）+burst 弱波臂让位（armBurstWeakWave 调用点）
  // ——散户 PVP 的 pvp.reason 与其它臂照常（「像样买方缺席」四窗 19 张零右尾须保持拦）
  const stallRestart = evaluateStallRestart(cd);
  // FP33/JG6 tail_dip 有机盘豁免（单点计算留痕：豁免命中=tail_dip 域内且九腿全真）
  const _tdArmHit = armTailDipKnife(snapshot.buyDerived, { enableTailDipVolumeLeg });
  const _tdExemptTry = _tdArmHit && enableTailDipExempt
    ? tailDipOrganicExempt(cd, snapshot.buyDerived && snapshot.buyDerived.famousTraces) : null;
  const tailDipExempted = _tdExemptTry ? _tdExemptTry.ok : false;
  // FP34/JG-6c 豁免族扩两臂：tail_no_buyer_pressure 同款豁免（用户裁定 2026-11-21
  // 「只豁免 tail_dip_knife + tail_no_buyer_pressure」——983 票全集首拦行伴随臂
  // 实证两臂互为同域围堵主力[130 张重叠]，lifecycle 两臂拦截极准[42 张仅 2 右尾]
  // 不进豁免族；act 族不进[首拦行零伴随命中，只挡加仓路径不挡首买]）
  const _tnbArmHit = armTailNoBuyerSellPressure(snapshot.buyDerived);
  // JG-6d 可观测性：豁免 fail 留痕挂腿名（SI 案排查靠手工重放九腿才发现 HHI 时变
  // 0.11→0.28 破线——腿时变是崩塌窗本性，fail 腿必须可查）
  const _tnbExemptTry = _tnbArmHit && enableTailDipExempt
    ? tailDipOrganicExempt(cd, snapshot.buyDerived && snapshot.buyDerived.famousTraces) : null;
  const tailNoBuyerExempted = _tnbExemptTry ? _tnbExemptTry.ok : false;
  // FP6 observe（famous 高控+砸落）前置判定——CD414 臂排除消费（上轮裁定先观察）
  const domFall = judgeFamousDominanceFall(snapshot);
  // FP47 entry_shape 两因子化（2026-11-24 用户裁定「A 档四题全搞」）：在 cheat 臂链
  // dump 族尾拦截（与 cd400/cd403/dump_pair 同域相邻）；命中才注 trace 留痕
  // （未命中票返回形状 bit 不变）；不进 CHEAT_CLASS_ARM_CODES——armClass='cheat'
  // 的 pointType 场景让位（该场景买点形状由 pointType policy 决定，存量对拍零扰动）
  const _md = judgeMaliciousDump(snapshot.buyDerived);
  const _crash = judgeCrashNumeric(snapshot.buyDerived);
  // FP48 crash 形态臂（T243：自 BP 因子应答器 BPF2 迁入）——与 _crash 同款：命中才注
  // trace 留痕；不进 CHEAT_CLASS_ARM_CODES（cheatOnly 类型让位）
  const _crashForm = judgeCrashForm(snapshot.buyDerived);
  const _mdHit = _md.hit && !_md.exempt;
  const _crashHit = _crash.hit;
  const _crashFormHit = _crashForm.hit;
  if (enableCheatArms) {
    // （T175 N 通道升格臂 n_no_retail_entry 2026-11-18 同日对拍证伪撤回：全量
    // 升格会拦 3 张 A_strong∧high 豁免放行票——萨摩耶 N=6.3 −0.014/我画地为牢
    // N=0.0 +0.0875/PAYAI N=9.5 +0.0762，净 −0.15 大于 FFFF 单 token 损失
    // （0x6af6cd7f 0 成交、5 行信号 4 行 act=low/mid 提案下仍拒）——N 免疫
    // 拦截面在豁免链有 A 主判优先语义，无条件臂超范围；AF1 跳过路径接受的
    // 丢失面=「act 恒 high∧纯 N」票，三窗 0 成交实证。版本不 bump：N 臂从未
    // 在任何窗口生效过（commit 与撤回同日，FP15 并行改动叠上））
    if (armLaunchSquad(snapshot.buyDerived)) arms.push('launch_squad_dominance'); // T180 首两波大部队×高占比（ladder v32 迁入 FP17——用户裁定归因子过滤模块；结构指纹臂置链首）
    if (armBigBuyDefer(snapshot.buyDerived)) arms.push('big_buy_defer'); // T201 大户买入推迟（ladder v34 G2 迁入——0.79/45s+1/60s 两档+深破<−10 豁免，线值与条件串时代逐字一致；挂 launch_squad 后=绝对 veto 优先认领）
    if (armHolderScatter(snapshot.buyDerived)) arms.push('holder_scatter'); // T187/FP21 持有者打散无主力（筹码结构维度：posH≥25 ∧ top1-2 集中度不足）
    if (armEvenSplitCrew(snapshot.buyDerived)) arms.push('even_split_crew'); // T188/FP22 持仓均等作弊仓（HHI<0.10 团伙分仓指纹）
    if (armOversellResidual(snapshot.buyDerived)) arms.push('oversell_residual'); // T197/FP29 分仓出货残局盘（独立 if 不进互斥链——结构证据臂与 launchSquad 同族；四窗 9 票与 FP26/27/28 命中面零重叠）
    if (armArbBotHoldings(snapshot.buyDerived)) arms.push('arb_bot_holdings'); // T198/FP30 机器持筹垄断（独立 if——存量口径与流量臂正交；null=钱包集未注入容缺不拦）
    if (armDumpNoAbsorption(cd)) arms.push('cd400_dump_no_absorption');
    else if (armDumpLowAbsorption(cd)) arms.push('cd403_dump_low_absorption');
    else if (armDumpPairLowAbsorption(snapshot.buyDerived)) arms.push('dump_pair_low_absorption'); // FP23 相邻双块捆绑砸盘尾承接（T190/0x2b63 案——CD403 单块口径的跨块分摊盲区补集）
    else if (armBurstExitSellPressure(cd)) arms.push('cd401_burst_exit_sell_pressure');
    else if (armBurstBundledWave(cd)) arms.push('cd405_burst_bundled_wave');
    else if (_mdHit) arms.push('malicious_dump'); // FP47a BP69 恶意砸盘桶因子化（四腿/单鲸/贴锚臂/BP78 豁免；Jev 题面不动兜底）
    else if (_crashHit) arms.push('crash_numeric'); // FP47b BP69 crash 数值判序因子化（急跌进行时/打断三口/臂A/臂B；形态复核留 Jev 兜底）
    else if (!stallRestart.hit && armBurstWeakWave(snapshot.buyDerived)) arms.push('burst_weak_wave'); // FP13 burst 弱波（无大户认可+无压箱，T174 联立线）；T210：停滞再启动命中时让位（弱波与低活跃同一逻辑=小流量推不翻低活跃）
    else if (armLifecycleBurstResidual(snapshot.buyDerived, cd)) arms.push('lifecycle_burst_residual'); // FP16 大周期 burst 残局（走过一轮+burst 不买，2026-11-18）
    else if (armLifecycleSellResidual(snapshot.buyDerived, cd)) arms.push('lifecycle_sell_residual'); // T192 大周期卖压残局（走过一轮+静默后卖簇主导不接——FP16 卖出方向对称臂，2026-11-19）
    else if (_tdArmHit && !tailDipExempted) arms.push('tail_dip_knife'); // FP18 尾部接刀（T182：域内崩塌进行时不接刀——域腿不可去掉，对照组接刀是肥尾机会；FP33 有机盘豁免见 tailDipExempted）
    else if (armExtremeDumpSellers(cd, snapshot.buyDerived)) arms.push('cd412_extreme_dump_sellers');
    else if (armDenseDump(snapshot.buyDerived) && !domFall.observe) arms.push('cd414_dense_dump'); // FP7 短窗持续密集砸盘（observe 命中票排除——famous 场景归观察）
    else if (_tnbArmHit && !tailNoBuyerExempted) arms.push('tail_no_buyer_pressure'); // FP26 尾段买力枯竭+卖压在场（卖压假活跃——act 族死寂线的方向性补集，cd414 重砸盘线外轻量阴跌；FP34 有机盘豁免同款=与 tail_dip 同域围堵臂）
    else if (armLaunchFailDead(snapshot.buyDerived)) arms.push('launch_fail_dead'); // FP28 早窗启动失败死盘（从没拉起来过+早龄+尾7s没人买——FP18「涨过又崩」的镜像盲区；FP26 卖压带外）
    else if (armHolderQuietUnload(snapshot.buyDerived)) arms.push('holder_quiet_unload'); // FP27 大户静默卸货（未走完周期 ath<80 的 top5 轻量出货带——与 FP16/FP25 残局门成生命周期两方向闭环；FP26 先认领断流族）
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
    // FP48 crash 形态臂挂臂链末位（T243）：前面各臂都没命中才轮到——原 BP 门位置
    //（因子门全过后才评）可达的就是这批形状；与更具体的臂同时命中时仍报前臂的码
    else if (_crashFormHit) arms.push('crash_form');
    else { // FP11 famous 早窗快闪双支（T171 거침없이/SI 案；FP10 子集形状已被上面更具体码认领）
      const earlyFlip = armFamousEarlyFlip(snapshot);
      if (earlyFlip) arms.push(earlyFlip);
    }
  }
  // T144 活跃度门（BP act 题整题迁入）：PVP 后、CD 臂前；T205 阶段前提 opts 透传
  const activity = enableActivity
    ? judgeActivityLevel(snapshot, { enableActStageCold, stallRestartHit: stallRestart.hit })
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
  // T213b armClass 策略：'cheat' → 效果提升类臂全撤（决策与展示同步用 effArms）
  const armClass = opts.armClass === 'cheat' ? 'cheat' : null;
  const { arms: effArms, reason } = filterArmsByClass({
    arms, pvpReason: pvp.reason, actLevel: activity.level,
    tailReason: tail.reason, famousReason: famous.reason,
  }, armClass, opts.armExempt);
  const gates = buildFactorGates({ pvp, activity, famous, tail, domFall, cd, bd: snapshot.buyDerived || {}, armHits: effArms, stallRestart, md: _md, crash: _crash, crashForm: _crashForm,
    // T245 上涨趋势十键观察门（fire 因子表透传；缺省 undefined=零行 bit 不变）
    ...(opts.trendFactors ? { trend: opts.trendFactors } : {}) });
  return { pass: reason === null, reason, version: FACTOR_PREBUY_VERSION, pvp, activity, tail, famous, arms: effArms,
    ...(armClass ? { armClass } : {}),
    gates,
    observe: domFall.observe ? { code: 'fam_dominance_fall', ...domFall.trace } : null,
    // T210 停滞再启动通路留痕（命中才注=未命中票返回形状不变；FP33 豁免留痕同款）
    ...(stallRestart.hit ? { stallRestart: { code: 'stall_restart_path', version: FACTOR_PREBUY_VERSION, hit: true, ...stallRestart.legs } } : {}),
    // FP33/JG6 豁免留痕（灰度关/域外/腿不全=false 不注=形状不变；FP34 两臂各注）
    ...(tailDipExempted ? { tailDipExempt: { code: 'tail_dip_organic_exempt', version: FACTOR_PREBUY_VERSION } } : {}),
    ...(tailNoBuyerExempted ? { tailNoBuyerExempt: { code: 'tail_no_buyer_organic_exempt', version: FACTOR_PREBUY_VERSION } } : {}),
    trace: { ...pvp.trace, act: activity.branch, tail: tail.branch, fam: famous.branch, domFall: domFall.branch,
      ...(stallRestart.hit ? { stallRestart: 'hit' } : {}),
      ...(tailDipExempted ? { tailDipExempt: 'organic' } : {}),
      ...(tailNoBuyerExempted ? { tailNoBuyerExempt: 'organic' } : {}),
      // FP47 命中才注（未命中票形状 bit 不变；BP78 豁免票 hit=false 但 exempt 在场=留痕豁免不拦）
      ...((_md.hit || _md.exempt) ? { maliciousDump: { branch: _md.branch, ...(_md.exempt ? { exempt: _md.exempt } : {}), ..._md.trace } } : {}),
      ...(_crash.hit ? { crashNumeric: { branch: _crash.branch, ..._crash.trace } } : {}),
      // FP48 crash 形态命中才注（形状不变约定同上）
      ...(_crashForm.hit ? { crashForm: { branch: _crashForm.branch, ..._crashForm.trace } } : {}),
      // JG-6d fail 腿留痕（灰度开且域内但腿挂=排查线索；'noCheatDerived' 等腿名）
      ...(!_tdExemptTry || _tdExemptTry.ok ? {} : { tailDipExemptFail: _tdExemptTry.failLeg }),
      ...(!_tnbExemptTry || _tnbExemptTry.ok ? {} : { tailNoBuyerExemptFail: _tnbExemptTry.failLeg }) } };
}

module.exports = {
  FACTOR_PREBUY_VERSION,
  CHEAT_CLASS_ARM_CODES, filterArmsByClass,
  TAIL_DIP_EXEMPT_MIN_TOTAL_BUY_BNB, TAIL_DIP_EXEMPT_MAX_TOTAL_BUY_BNB,
  TAIL_DIP_EXEMPT_MAX_NO_BUY_SELL_PCT, TAIL_DIP_EXEMPT_MAX_HOLDER_HHI,
  TAIL_DIP_EXEMPT_MIN_ROUTER_ENTRY_PCT, TAIL_DIP_EXEMPT_MAX_TOP1_BUY_PCT,
  TAIL_DIP_EXEMPT_MAX_SAME_BLOCK_HOLD_CIRC_PCT, TAIL_DIP_EXEMPT_MIN_FAMOUS_GROUP_BUY_BNB,
  TAIL_DIP_EXEMPT_MAX_FAMOUS_COHORT_WALLETS, tailDipOrganicExempt,
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
  LIFECYCLE_SELL_MIN_SELL_PCT, LIFECYCLE_SELL_MIN_SELL_BNB, armLifecycleSellResidual,
  HOLDER_SCATTER_MIN_HOLDERS, HOLDER_SCATTER_EXEMPT_TOP1_PCT, HOLDER_SCATTER_EXEMPT_TOP12_PCT,
  armHolderScatter,
  HOLDER_EVEN_CREW_MAX_HHI, HOLDER_EVEN_CREW_MIN_CIRC_PCT, armEvenSplitCrew,
  HOLDER_EVEN_CREW_MAX_HHI, armEvenSplitCrew,
  FAM_LOW_EXIT_MIN_BUY_BNB, FAM_LOW_EXIT_MIN_SOLD_RATIO, FAM_LOW_EXIT_MAX_PRESENCE_BNB,
  FAM_LOW_EXIT_MAX_VS_PCT, FAM_LOW_EXIT_COOLDOWN_SEC,
  DUMP_NO_ABSORB_BNB, DUMP_RATIO_MIN_SELLERS, DUMP_LOW_ABSORPTION_RATIO, BURST_BUNDLE_MIN_WALLETS,
  DUMP_PAIR_MIN_BNB, DUMP_PAIR_MAX_DROP_PCT, DUMP_PAIR_NEAR_SEC, DUMP_PAIR_TOTAL_VOLUME_EXEMPT_BNB,
  DUMP_PAIR_EARLY_MAX_AGE_SEC,
  EXTREME_DUMP_MIN_SELLERS, EXTREME_DUMP_MIN_BNB,
  SBW_PROXY_WAVE_NEAR_SEC, SBW_PROXY_MEDIAN_DUST_BNB,
  BURST_WEAK_PRE_WAVE_BNB,
  BURST_CONTEXT_PRESEG_MIN_BNB, BURST_CONTEXT_PRESEG_MIN_TICKS, burstContextBackgroundCold,
  FAM_HOLDING_SOLD_RATIO, FAM_THIN_TOTAL_BUY_BNB, FAM_DUMPING_CHG30_PCT,
  FAM_THIN_FOLLOW_EXEMPT_MIN_BNB, FAM_THIN_FOLLOW_EXEMPT_MAX_BNB,
  FAM_HARVEST_SOLD_RATIO, FAM_HARVEST_BUY_PCT, FAM_HARVEST_SELL_PCT,
  judgeRetailPvp, judgeActivityLevel, judgeFamousDanger, judgeTailPhaseActivity,
  judgeFamousDominanceFall, buildFactorGates,
  armDumpNoAbsorption, armDumpLowAbsorption, armBurstExitSellPressure, armBurstBundledWave,
  judgeMaliciousDump, judgeCrashNumeric, judgeCrashForm,
  CRASHFORM_VS_ATH_MAX, CRASHFORM_CHG30_MAX, CRASHFORM_NEAR_DN5_MAX, CRASHFORM_MIN_GAP_MAX,
  CRASHFORM_CHG5_MAX, CRASHFORM_TAIL_BUY_N_MAX,
  FACTOR_GATE_CATEGORIES, FACTOR_GATE_CATEGORY_BY_ID, factorGateCategory,
  MD_MIN_SELL_BNB, MD_MIN_DROP_PCT, MD_MIN_SELLERS, MD_MAX_FOLLOW_RATIO,
  MD_WHALE_MIN_SELL_BNB, MD_WHALE_MIN_TOP_SELLER_PCT, MD_ANCHOR_MAX_SEC,
  MD_ANCHOR_MAX_BUY_RATIO, MD_TOTAL_VOLUME_EXEMPT_BNB,
  CRASH_CHG5_DEEP, CRASH_CHG_SAME_DEPTH_GAP, SWING_NEAR_SEC, SWING_VS_HIGH_PCT,
  SWING_RISE_MIN_SEC, SWING_RISE_MIN_PCT, DIP_WAVE_PCT, DIP_UNRECOVERED_PCT,
  DIP_MAX_SEC_AGO, DIP5_MIN_PCT, ARM_A_TAIL_SELL_BNB, ARM_A_DUST_BUY_BNB,
  ARM_A_MIN_BUY_N, ARM_A_BIG_SINGLE, ARM_A_NEAR_BUY_BNB,
  BIG_BUY_DEFER_TIER079_BNB, BIG_BUY_DEFER_TIER1_BNB, BIG_BUY_DEFER_SEC_TIER079,
  BIG_BUY_DEFER_SEC_TIER1, BIG_BUY_DEFER_EXEMPT_FLOOR_PCT, BIG_BUY_DEFER_EXEMPT_FAM_BLOCK_PCT, BIG_BUY_DEFER_EXEMPT_LATER_HOLDERS, armBigBuyDefer,
  armDumpPairLowAbsorption,
  armBurstWeakWave,
  TAIL_NO_BUYER_MIN_SELL_N, TAIL_NO_BUYER_MAX_BUY_N, armTailNoBuyerSellPressure,
  TAIL_KNIFE_MIN_DIP_SELL_BNB, armTailDipKnife,
  HOLDER_QUIET_UNLOAD_MIN_BNB, HOLDER_QUIET_UNLOAD_MAX_BNB, HOLDER_QUIET_UNLOAD_MAX_ATH_PCT, armHolderQuietUnload,
  LAUNCH_FAIL_MAX_ATH_PCT, LAUNCH_FAIL_MAX_AGE_SEC, LAUNCH_FAIL_MAX_TAIL_BUY_N, armLaunchFailDead,
  OVERSELL_MIN_BNB, OVERSELL_MAX_WALLETS, OVERSELL_QUIET_EXEMPT_SEC, armOversellResidual,
  armExtremeDumpSellers, armDenseDump, armSlowPumpUnload, armFamousHarvestFinal, armFamousBurstWave,
  armFamousLowExit, famousBreachExemptPct, FAM_LOW_EXIT_BREACH_EXEMPT_PCT,
  armFamousEarlyFlip,
  evaluateFactorPreBuy,
};
