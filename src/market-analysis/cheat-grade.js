/**
 * 作弊盘检测三级分级规则（G1，2026-11-01 用户裁定立项）——纯函数，零 DB 零网络
 *
 * 输入=buildObservation 观测产物（Jev 档位 + 代码数值锚），输出交易三级
 * cheat / unhealthy / healthy。**D3.5 判定层停产的修订边界（2026-11-01 用户裁定，
 * 案号见台账 G1 段）**：判断仍一律 Jev——本题集只消费 Jev 档位（现象/EXT/活跃度/
 * 捆绑）与少量代码数值联立键（burst 波三键/纯卖占比/跟单集中度锚——E/D/L 通道
 * 联立臂，G9-G11 纯数值门全退役），**不做任何「档位→现象强度」的新判断**；本
 * 模块做的是「档位→交易动作」的策略映射（哪些组合算作弊盘不交易/不健康盘重判/
 * 健康盘放行），属引擎侧策略决策（类似条件串评估），非代码产作弊结论。
 *
 * 规则（G18=G17−G8 弱 burst 代码臂（2026-11-11 CD397 族三 14 票取证收官，
 * 用户四条裁定第 3 条原话「burst 的判定被代码魔改了，我的建议依然是不要魔改，
 * 用 Jev 判断」）：E 通道 burst 豁免的弱波承接前提（sbw=burst ∧ 最长停滞 ≥60s
 * ∧ 波买入 <1.05 BNB ∧ 波内钱包 <13 → 维持 low 拦截）整臂退役，E 恢复
 * sbw 单条件——sbw=burst 即跳过 E（「停滞后只涌入一点小流量」的排除教学移交
 * sbw 题 D3.67 题面四判轴：跨度 secSinceWaveEnd/尘埃 户均+中位/流向 净额+卖回
 * 率/位置参考 exitVs，锚 state 直供；Jev 判 none 的「假 burst」E 恢复拦截）。
 * 同批：CD383 豁免四腿同退役为 sbw 单条件（资格判定收在 CheatCheckService 侧）
 * +snapshot 单段绑定波族十键（旧全窗波两键语义不动=strongbacker §七.5 统计
 * 口径保护）。E_low_activity_weak_burst 码随臂退役（历史行留档）。
 * 此前 G17=G16+N 通道聚合路由入口占比（2026-11-05 CD350 流量画像侦察立项
 * ——用户提案原话「我觉得一个简单点的方法，就是把 GMGN 路由的流量占比给过去，
 * 如果太低就不行」+立法放行「门可以加」：锚窗买入笔走聚合路由
 * （AGGREGATOR_ROUTER_ADDRS，2026-11-05 扩录 9 址）占比 <10% 且买入 ≥15 笔
 * → unhealthy 留痕 N_no_retail_entry。语义=无散户入场通道——公共聚合器是
 * 散户最主流入口，正常热度盘总有相当份额散户从聚合器进。定线（363 票锚窗
 * 分布 tmp-router-dist@182，9 址笔数口径）：healthy 52 票 min 23.8/中位 75、
 * strongbacked 8 票 min 50（不拦域零误伤且强庄盘入口最足——「庄+散户合力」
 * 直觉再验证）；<10% 共 21 票全在 cheat 17/unhealthy 4；低占比票窗长
 * 7-1862s 无「极早窗聚合器未索引」时序噪声。与 2026-10-31 删 routerPct
 * state 行的裁定不冲突——彼裁「高占比方向」无判别价值（作弊钱包同样走路由
 * ），本通道判「低占比方向」=入口缺失，方向相反；锚不进 state/题面（Jev
 * 输入零变化），纯代码数值门+FA 投影观测。null（买 <15 笔/零买入/旧档断代
 * 缺键）不触发 fail-open。**拒买级非拉黑级**（unhealthy 留重判域）；
 * **独立通道不进 A 主判**。此前 G16=G15+D 通道邻界联立臂（CD323 huh 案，2026-11-05 v72 终审用户裁定
 * 「我也认为是 famous 主导，unhealthy，可以 fix 一下」：dom=high ∧ 跟单 top3
 * ≥35 ∧ 集团买 ≥70 双贴线（距豁免线 45/80 各 <10 点）→ 豁免双臂证据均不
 * 显著不豁免，留痕 D_famous_near_band；G5/G6 豁免哲学不变=豁免须显著成立——
 * 分散要 <35、承接要 <70。v72 批影响面=仅 CD323 新拦，CD302（gb 67.5）豁免
 * 保持、CD299/CD327 主条件既有零变化）；G15=G14+第 15 题 burst_spike_concentration 进 A 主判（D3.51，2026-11-03
 * CD157 가나+CD102 SAFU 两票用户裁定立项——原话「burst 没有问题，但是这里的
 * burst明显是一个尖刺。单独这一个 block 持仓比例多少呢？这一个block 在这个
 * burst中流动性占比多少？一算就知道这是作弊行为」+「这个裁定为 cheat」+立法
 * 批准「好，落吧」：25 票分离度实证占比硬门不可行（healthy CD104/CD98 数值
 * 孪生落群），结构判读交 Jev 题档、A 主判 strong→cheat 自动吸收（EXT 清单
 * filter 勿需改 MAIN_IDS——sbw/holdings_balance 排除项不含本题）；两锚
 * spikeBuyPctInBurst/spikeHoldPctAll 随 observation 透传 FA 投影，无门侧数值
 * 消费（G9-G11 死指标退役红线不破）。此前 G14=G13+M 通道超高活跃度，2026-11-03
 * v68 成交票扩集第一批 CD138 立项
 * ——用户裁定原话「CD138 活跃度过高我建议给 unhealthy，可以分析下。也可以
 * 单独的立 sniper 锚，但是 GMGN 网站上有 sniper 的标记，但是我们自己的算法
 * 如何做这个锚？我给 unhealthy」+ sniper 两口径否证（跨盘画像 isSniperProfile
 * 命中 meme 仅 0.1% 买入反而人工 healthy 的 Mamesuke 42.8%；创建后 ≤10s 首买
 * 覆盖 meme 73% vs Mamesuke 91%=打新盘全员早期买入是常态，GMGN sniper 徽标=
 * per-token 早期买入标记非跨盘画像）后续裁定「对，我们的这个不太好用。如果
 * 没有太好的办法，就超高活跃度 unhealthy 吧」+「『超高活跃度 → unhealthy』
 * 没问题，接受 Mamesuke 错杀」）：
 *   M. activity_level=ultra → unhealthy 留痕 M_hyper_activity
 * 定线（v68 20 票）：ultra 六票 ticksPerMin 86.7-436、high 档最高 65.5 断崖
 * 清晰；「过度密集/活跃度太过」的载体就是活跃度档本身。已知代价=CD141
 * Mamesuke（86.67/min ultra@0.50 人工 healthy）被错杀——用户明示接受（拒买
 * 可重判）。七通道=A/D/E/J/L/R/M（M 与 E act=low 对称：Jev 判档、代码只映射
 * 交易动作；act 档 null 断代不触发，mid/high 不触发）。
 * 此前 G13=G12 R 通道改制，2026-11-03 用户裁定理念重构+改名——原话「这个
 * 模块的问题在于“需要证明有真实用户参与”，但是这个理念是不对的，我认为
 * 应该改为 “异常行为识别与比例计算”，明确它要做的事情，并且不作有罪推定。
 * 就是说，如果交易序列不能明显看出有问题，不需要去证明自己一定是“真实
 * 用户”。而新发的 meme 币前期，确实是庄家拿筹码/狙击手活跃的阶段，但是
 * 只要不是呈现出异常例如“单个区块挤进去大量同金额交易”，“冷寂期一下子
 * 来了一个区块塞进去大量交易” 等等这样的明显异常就问题不大」：第 14 题
 * real_participation→abnormal_behavior_ratio（D3.39，四桶 negligible/noticeable/
 * dominant/unclear 异常占比轴），R 通道触发腿 minimal_genuine→dominant：
 *   R. abnormal_behavior_ratio=dominant → unhealthy 留痕 R_abnormal_dominant
 * 异常形状主导盘面流量（无罪推定翻转：无可见异常即正常——negligible/
 * noticeable/unclear/null 全不触发；unclear=证据不足不硬判，映射表刻意不含
 * →null；<D3.39 旧档（含 D3.35-D3.38 real_participation 期答案）断代 null
 * 不触发（黄金集旧档重放零变化））=拒买级非拉黑级（unhealthy 留重判域
 * CD134 缺省门，不用尽不拉黑——「宁可放过」基调）。**独立通道不进 A 主判**
 * ——综合结论与单现象 strong 证据链不同类（A 管单现象铁证拉黑，R 管整体
 * 异常占比拒买，取最重 cheat 仍压 unhealthy）。
 * 此前 G12=G11+R 通道真实参与度，2026-11-02 用户裁定「将 Jev 转化为一个真实
 * 的交易者」——D3.35 新增第 14 题 real_participation（四桶 mostly_genuine/
 * meaningful_genuine/minimal_genuine/unclear，Jev 以 BSC meme 狙击交易者身份
 * 通读 [TICKS]/[WALLETS] 序列回答「参与的钱包真实的用户有多少」；协同买入
 * 参考四键进 state 作参考数值非门槛；G13 起题改名+判读方向翻转为异常占比，
 * 交易者角色代入保留）：
 *   R.（G12 形状）real_participation=minimal_genuine → unhealthy 留痕
 *   R_minimal_genuine（G13 起退役为 dominant→R_abnormal_dominant）
 * holdings_balance 题面同批补腿（窗口早期在场流通口径适用域+创建者曾持峰值
 * 锚——CD10 双失明：早期供应口径全员 <3% 全失明+创建者清仓后正净口径消失，
 * 见 D3.35 题面）。
 * 此前 G11=G10−G 通道−state 簇锚渲染，2026-11-02 CD133 用户裁定：
 * 用户原话「那肯定不行的呀，GMGN的散户是有默认交易额的，大多数都是0.1/0.05，
 * 大户则是 0.2/0.25/0.3 之类的，这要是能跨区块，误伤就太大了！同块同额度误伤
 * 可能小一些，可以作为参考。如果这种死指标不好用，还是把原始数据输入给Jev，
 * 通过现象描述，去综合判断与考量里面是否有协同行为吧」——否证 sb∪eq 并集
 * 圈定：①eq 臂跨块等额带圈的就是 GMGN 前端默认档位本身（MAI 全窗 0.0986~
 * 0.1005 带 62 钱包 77 笔跨 80 分钟匀速流入=0.1 档整档跟风散户，CD130 同源）；
 * ②sb 臂同块不看金额（RAM block 131207746 三笔 0.2500/0.1037/0.1086 金额各异
 * 的独立买家撞块即入簇），RAM 首析 bundleBuyPct 87.1 的分子 82% 来自 sb 臂
 * （2.181/2.655）——门侧唯一的簇锚消费（G 通道豁免前提 bundleBuyPct<80）骨架
 * 塌，**G 通道整体退役**；「同块∧同额」交集不再造死指标门（用户「作为参考」
 * =题面素材，D3.34 equal_amount_split/same_block_buy_wave 加 GMGN 前端默认档
 * 位反锚与同块同额双协同判据），协同现象判断全交 Jev 题档（A 主判 strong 才
 * 拉黑）。state [PRECOMPUTED] 三行死指标（同块簇持仓占比/近等额簇持仓占比/
 * 簇买入占比）与持仓分布段「同块簇∪等额簇成员正净合计」句同批撤除（同一圈
 * 定，CD133 问二用户选定三行全撤——Jev 从 [TICKS]/[WALLETS] 原始逐笔归纳）；
 * digest 存档与 FA 34 键投影照常计算（研究侧自由消费）；bd 档位
 * （bundled_trade_dominance）照判照投影门侧零消费。五通道=A/D/E/J/L。
 * 此前 G10=G9−sbHold/eqHold 门侧消费−B 通道，2026-11-02 四票复盘续裁定：
 * 用户原话「sbHold 让我感觉不适，这个指标的问题在于，如果代币活跃度极高，
 * 是不是直接它就被拉的很高，基于它进行判断不合理。eqHold 有一定的合理之处，
 * 可是如果能通过语言描述现象，就不要使用这种死指标可能会更好」——撤掉本
 * 模块全部 sbHold/eqHold 数值消费：B 联立 sbHold≥50、A 降级豁免 sbHold<50、
 * G 豁免 sbHold<20∧eqHold<50 双锚腿（G 豁免只剩组织买入占比 bundleBuyPct<80
 * 单腿，G6 用户裁定承接前提保留）。实证（tmp-act-sbhold 本地 55 票基线）：
 * sbHold 是活跃度的函数——act=low 中位 31%→mid/high/ultra 全 ~50%、高活跃∧
 * sbHold≥50 现场 10 票值域 53-88（BSC 0.75s 出块，高活跃盘同一块天然挤满独立
 * 真实买家，同块簇圈定把散户整个吞进簇并集——sbHold 高≠组织性，是被活跃度
 * 拉高的）；eqHold 高活跃组中位反而回落 ~20%（等额带天然滤掉金额分散的散户
 * =「有一定合理之处」），但其现象已由 equal_amount_split/same_block_buy_wave
 * 题面语言承载（D3.29 组织性结构三条+结构簇买入占比不足两成不给明显及以上
 * 档），死指标退位。两锚照常产出（state [PRECOMPUTED] 事实行+FA 数值锚+
 * digest 供条件串/研究自由消费），只不作门——Jev 看数值行判档位，门只吃
 * 档位。**B 通道随之整体退役（重放裁定）**：骨架=「现象共振∧sbHold≥50 联立」，
 * 佐证撤后只剩裸 moderate 共振→新增错杀 CD98/CD124 两票人工 healthy（拉黑
 * 不可逆）且 B 在 G1-G9 黄金集正命中为零=从未校准——「多现象共振」证据交
 * A 主判（strong 档）与题面档位校准。G10 黄金集重放 34/42 八票偏差（与 G9
 * 持平：CD98/CD124 由 B 退役回正；台账 CD132）。生效须 182 重启。
 * 此前 G9=G8−五纯数值门，2026-11-02 线上首日四票复盘用户裁定：「首先我认为
 * 需要先去掉不经过Jev的门，使用Jev 是因为它有能力处理复杂状况，使用了硬门
 * 与我们理念背离，Jev 描述现象，我们通过现象给结论」——退役五条判罚不经任何
 * Jev 档位的纯数值通道：C（sbHold≥85）/F（sbHold≥50）/H（washPairSellPct≥60
 * ∧≥3 对）/I（top1HoldSupplyPct≥40）/K（noBuySellPct≥40）。定线依据（黄金集
 * 锚角色量化，本地纯重放）：五门 42 票命中面 15 票但反事实抽锚终判仅翻 1 票=
 * 与 Jev 通道高度冗余；B（Jev 联立门）黄金集零命中=阈值从未校准；healthy 组
 * 高锚值样本为零=「锚高值×健康票」象限零覆盖，线上四票全落该空象（RAM
 * sbHold60 整档散户/MAI eqHold73.6 前端快捷档）。相关现象改由 Jev 题档承载：
 * 对倒=wash_pair（A 主判）、独大=holdings_balance/insider（J/L）、纯卖方=L
 * insider 联立；sbHold/eqHold 佐证消费（B 联立/A·G 豁免臂）随后亦随 G10 整体
 * 退役。锚照常产出于 state/FA 34 键（观察不变，门不读）。G9 黄金集重放
 * 34/42（唯一 grade 变化 CD97 cheat→unhealthy——C_sbHold90 独载票；偏差七→
 * 八票；台账 CD131）。
 * 此前 G8=G7+三改动，2026-11-02 批次六 CD37/CD79/CD4/CD68/CD5 review 收官，
 * 用户三项裁定落地——①「我建议分析一下有 burst 票的 burst 强度，长期停滞突然
 * 涌入一波小流量，依然应该算低活跃度，但是如果涌入流量大，才能推翻 低活跃度
 * 结论」（选「弱 burst 代码臂」落法）→ E 通道 burst 豁免加弱波承接前提：锚
 * burstMaxGapSec≥60 ∧ burstWaveBuyBnb<1.05 ∧ burstWaveWallets<13（最长停滞
 * ≥60s ∧ 波买入 <1.05 BNB ∧ 波内钱包 <13=长期停滞后只涌入一点小流量，不构成
 * 推翻低活跃度的证据）；**D3.56（CD163）起波两键=锚前 120s 临近段最密 5s 窗
 * （snapshot 口径，用户裁定「burst 是指临近购买点位的 burst，不是整体的，
 * 前面有不算」——开盘/中段波不进波额判断；grade 逻辑零改动，仅消费数值
 * 换临近段口径）**；定线研究（tmp-burst-strength@182 17 票 sbw=burst）：
 * 豁免挡住的全是自己人（14 票 Jev act 已判 low），弱波线三票 CD79/CD108/CD70
 * 转 unhealthy 全与人工一致、healthy 零误伤（人工 healthy 4 票中 3 票 maxGap
 * 仅 19~43s=无停滞开盘密集正常形状，停滞深度是必要第三维）；三键任一 null
 * （旧档断代/dt 缺失）→ 不算弱 burst 维持 G7 豁免（新切口对存档重放零变化）。
 * ②「创建者已经卖了，而且应该是通过代币转入的方式卖的……明显的作弊行为」
 * （CD5 链上实锤：创建块同块 Transfer 分光 3.18 亿 token、6 接收户零买入同块
 * 卖出 2.09 BNB 占总卖 45%——Transfer 不在采集域，swap 侧写=零买入纯卖方）+
 * 双修裁定 → K 通道：noBuySellPct≥40 → unhealthy（零买入纯卖方卖出占全窗总卖
 * ≥40%=链外分仓出货形状）；定线（tmp-nobuysell-calibrate@182 128 票）：≥40
 * 触发 14 票（13 人工 cheat/unhealthy+1 unclear）零误伤、30 线误伤 CD45(37.7)
 * 挡住下探。③insider 题升格联立臂 L：insider_supply_sell∈{moderate,strong} ∧
 * noBuySellPct≥25 → unhealthy（Jev 内幕卖出档位+纯卖方数值锚联立——五票
 * CD67/CD70/CD82/CD71/CD123 全对、CD60 反例（insider strong 人工 healthy、纯卖
 * 24.8<25）恰被排除；25 线低于 K 40 线=档位证据补足数值证据）。K/L 均 unhealthy
 * 档（拒买可重判不清仓——分仓证据强于组合垄断但弱于对敲铁指纹，与 F/G/J 同档
 * 语义）；noBuySellPct null（总卖=0/旧档断代）两通道均不触发。
 * 此前 G7=G6+J 通道持仓组合垄断，2026-11-02 批次五 CD122 用户裁定立项——
 * 「大户持仓太多了，因为我们似乎只考虑了 top1，这个案例可能不太够，如果
 * top2 跟 top1 紧邻买的，更危险」+「给 Jev 增加 持仓均衡 门吧。注意总供应量
 * 占比最重要，第二 CD122 的 top2 不是单一钱包，而是捆绑簇。需要利用 Jev 的
 * 能力处理复杂情况」+两分叉裁定「strong→unhealthy 独立通道」+「完整持仓
 * 图景」：新增第 13 题 holdings_balance（D3.32，四档 EXT 容缺）判前几大持仓
 * 组合垄断（主口径=占总供应量%——单一独大/前二合计/第1大∪簇并集三口径
 * 参考量级 40%+同源协同迹象），strong → unhealthy 留痕 J_holdings_strong
 * **不进 A 八主判清单**（组合垄断=拒买级非拉黑级，与 F/G 同档语义）；I 通道
 * （单一钱包 ≥40 供 → cheat）不受影响——本题覆盖 I 够不着的组合形状（CD122：
 * top1 供 25.6<40，但 top2=同块捆绑簇成员背靠背块进场 3 秒后卖一半，第1大∪
 * 簇并集 40.1% 人工裁定 unhealthy）。新题对 D3.26 旧档重放=答案缺席 null 不
 * 触发 → 黄金集 34/42 沿用（G3/G4/G5/G6 同款先例）。
 * 此前 G6=G5+③豁免前提「组织买入占比」，2026-11-02 用户补充裁定「著名/绑定钱包
 * 的豁免还是要有一个前提，就是它们砸跑了是砸跑了，但是盘面正常用户流量涌入
 * 依然要比较明显，否则如果整个盘面全部是它们的砸盘，盘子也死了」——D/G 两豁
 * 免共同加前提：组织买入占锚窗总买 <80（正常用户承接至少两成）才豁免；≥80=
 * 盘面流量构成基本是组织方独角戏（死盘形状）豁免不成立。锚（snapshot G6）：
 * D 段=famousGroupBuyPct（famous∪跟单买入占比）、G 段=bundleBuyPct（sb∪eq
 * 簇买入占比）；null（旧档断代/组织集空）→ 不豁免 fail-closed（无承接证据
 * 不给豁免，sbw null 同哲学）。128 票锚窗分布（tmp-flow-exempt-precond@182）：
 * D 豁免形状 8 票中 ≥80 五票（CD47:80 恰界/CD66:90.3/CD86:87.7/CD103:92.9/
 * CD113:87.4）不豁免——批次四两代价票 CD86/CD103 回 unhealthy 与人工一致；
 * CD42:71.7/CD90:49.8/CD116:62.8 维持豁免（CD90 残留 healthy 偏差用户知情）。
 * G 豁免形状 17 票 bundleBuy 全 <44（最高 CD124:43.9 人工 healthy）→现状零
 * 翻转，语义对称落地防未来「簇撤退但买入占九成」对倒洗筹死盘形状。定线 80=
 * 与 D3.29 bw 题「组织不足两成不给档」互为镜像（正常承接两成线）。
 * 此前 G5=G4+两处豁免修正，2026-11-02 批次四裁定：
 * ①G 通道双锚簇残余豁免——用户裁定「其实这里还有一个豁免点，就是如果持仓已经
 * 卖出，也已经对盘面没影响了，也没关系」「如果有已经卖出，且流动性占比不是
 * 特别大，也可以豁免」+CD121 口子收紧裁定：豁免须同块簇与等额簇都基本撤退
 * （sbHold<20 ∧ eqHold<50），sbHold/eqHold 锚 null 不豁免（fail-closed；eqHold
 * =null 例外=该轴零残余）。128 票豁免区仅 CD128（12.6/29.2，A_strong:pump 保底
 * grade 仍 cheat）；CD121（11.4/**54.0**）/CD126（10.7/**59.6**）eqHold≥50 不豁
 * 免→黄金集 34/42 重放零变化（D3.26 旧档含 eqHold 键，CD121 锚 54.0 恰不豁免）；
 * 批次四 G_bd 误伤组五票 sbHold 20.1-73.0 簇全在仓、豁免零受益（价值=未来票
 * 语义正确）。
 * ②D 通道跟单集中度豁免——用户裁定「它们的跟单量是不是高估了？因为聪明钱的
 * 跟单一定程度也不算完全不健康的」「也不能把所有的后续买入全看成 famous 的跟
 * 单」：dom=high ∧ 跟单 top3 占跟单正净 Σ<45%（分散形=几十个散户小额跟进）不
 * 触发；≥45%（集中形=少数大户贴身重仓，疑似分仓）维持触发；null（无跟单/旧档
 * 断代）触发（无跟随时 dom 分子全靠 famous 本人=直接控盘）。16 票研究：跟单窗
 * 覆盖买家数中位 80%+、本人持中位 ~10%——修正前 dom 度量的多是「famous 买入后
 * 60s 内盘面热」。已知代价（用户知情）：分散形 9 票 D 不再触发（CD42/CD47/
 * CD65/CD66/CD86/CD90/CD103/CD113/CD116），其中 CD103/CD113 人工 cheat 无 A
 * strong 时翻 healthy、CD65 人工 unhealthy 同翻——由其余通道（F/G/E）或放行
 * 语义承担。此后 G4=G3+I 通道 t1 供应独大单档，2026-11-01 批次二 CD69 两段裁定：立项
 * 「大户集中度不能只是观察锚，持仓太多了不行，至少这么大总量占比肯定不行的」
 * →口径「我觉得不要看流通占比吧，看总量占比，否则如果检测时间靠前，结果就
 * 不对了」（流通分母=已买入筹码，开盘早期池浅占比虚高时间不无偏；供应分母恒
 * totalSupply）→定线「单档 ≥40 → cheat」；G3 基线 42 票 D3.26 存档对拍 34/42
 * （八票偏差见台账 G2 修订段），G4 对存档重放零变化——t1供 ≥40 全 128 票唯一
 * 命中 CD69(46.5) 不在黄金集；断层 46.5↔31.6（CD104 31.6 人工 healthy 挡住
 * 下探，30 线即误伤；25-30 七票人工混杂不能切；35-40 无票做不出 unhealthy
 * 中间档=空转）：
 *
 *   cheat（优先级最高）:
 *     A. 八主判题（四现象剔 cr + tier/bw/rat/pump/wash）任一 strong
 *        豁免降级 unhealthy：唯一 strong=pump ∧ sbw=burst ∧ 八主判 moderate
 *        合计<3（CD99 形状——停滞后涌入的自然 pump，非协同推价；G10 起
 *        sbHold<50 腿退役，头注 G10 段）
 *     （G9 退役：C sbHold≥85 / H washPair 数值 / I t1 供≥40——纯数值门不经
 *      Jev，头注 G9 段；git 历史留档）
 *     （G10 退役：B 四现象 mod≥3∧sbHold≥50∧dom≠high——sbHold 联立撤后裸
 *      moderate 共振错杀 CD98/CD124 且 G1-G9 零正命中，用户裁定整体退役，
 *      头注 G10 段；git 历史留档）
 *   unhealthy:
 *     D. famous dom=high ∧（跟单 top3 ≥45% ∨ 跟单锚 null ∨ 组织买入占比 ≥80
 *        ∨ 组织买入锚 null）（G5 前纯 dom=high；跟单集中度豁免见头注②——分散形
 *        「聪明钱带散户」不触发；G6 组织买入 ≥80 死盘形状豁免不成立，见头注③）
 *     E. Jev activityLevel=low ∧ sbw≠burst（G2 简化，2026-11-01 用户裁定「活跃度
 *        这一臂为 low 的，也判为 unhealthy，不过流量 burst 命中的不要判定为
 *        活跃度 low」——G1 期 t1流<40 吃独食豁免（CD105/CD122）与卖笔≤1 对手盘
 *        豁免（CD107）撤销，改由题面 D3.27 burst 反锚在档位源头修正；sbw=burst
 *        豁免保留为通道层双保险；**G8 弱 burst 代码臂已随 G18 退役（CD397 判定
 *        权归 Jev——弱波排除教学移交 sbw 题 D3.67 题面，E_low_activity_weak_burst
 *        码随臂退役历史行留档）**）
 *     F. （G9 退役：sbHold≥50——纯数值门不经 Jev，头注 G9 段）
 *     （G11 退役：G. bd=high ∧ ¬簇买入占比<80——豁免前提 bundleBuyPct 的
 *      sb∪eq 并集圈定把 GMGN 前端默认档位散户整档吞入（用户裁定 CD133，
 *      7746 例证：0.2500/0.1037/0.1086 同块各异金额入 sb 臂），死指标门退役；
 *      协同现象由 A 题档承载（D3.34 题面反锚），头注 G11 段；git 历史留档）
 *     J. holdings_balance=strong（G7 新增，前几大持仓组合垄断——第一大+紧邻
 *        第二大+捆绑簇凑成垄断总供应量一大截（CD122 形状）或单一独大档位
 *        补充；主口径=占总供应量%；独立通道不进 A 清单=拒买级非拉黑级；
 *        <D3.32 旧档答案缺席 null 不触发）
 *     K. （G9 退役：noBuySellPct≥40——纯数值门不经 Jev，头注 G9 段；纯卖方
 *        现象由 L insider 档位联立承载）
 *     L. insider_supply_sell∈{moderate,strong} ∧ noBuySellPct≥25（G8 新增，
 *        insider 题升格联立臂——Jev 内幕卖出档位补足纯卖方数值证据，25 线低于
 *        K 40 线；CD60 反例（insider strong 人工 healthy、纯卖 24.8）恰被排除；
 *        insider weak/none/null 不触发）
 *     R. abnormal_behavior_ratio=dominant（G12 新增 minimal_genuine 腿，G13 改制
 *        ——D3.39 异常行为占比「异常形状主导盘面流量」→拒买级；negligible/
 *        noticeable/unclear/null 不触发；独立通道不进 A 主判）
 *   healthy: 其余
 *
 * cr（创建者抢跑）刻意不进主判=辅助判定（用户语义；CD75 cr strong 人工判
 * unhealthy 反证 cr strong 不足以定 cheat）。
 *
 * 容缺语义（fail-open 放行方向，与 GMGN 层「数据不可用不得拦买点」同向）：
 * 档位 null（旧档断代/容缺）不计 strong/moderate；数值锚 null 不触发比较门。
 * 已知例外：sbw null 按「非 burst」处理（burst 豁免需在场证据，无证据不豁免）。
 *
 * 改规则必须 bump CHEAT_GRADE_RULES_VERSION 并同步台账 G 段+跑 42 票黄金集
 * （scripts/cheat-detection/data/cheat-grade-golden-42.json，单测
 * _test_cheat_grade.cjs 对拍锁定防漂移）。
 */

const { PHENOMENON_IDS, EXT_PHENOMENON_IDS } = require('./cheat-result-mapper');

const CHEAT_GRADE_RULES_VERSION = 'G18';

/**
 * 档位→数值映射（G1 因子化投影，2026-11-01 用户指令「以因子的形式放到表达式中」）：
 * 全族数值序（narrativeRating 1/2/3/9 先例同构）——条件串可直接 >=/</== 比较，
 * 调阈值免改枚举；null=未判定/档位断代/容缺（条件比较恒 false，fail-closed 方向
 * 由条件串作者自定：未判定放行须显式 `cheatGrade IS NULL OR` 臂）。
 * 未知档位值（题集演进新增桶）→ null 不冒充（fail-loud 单测锁）。
 */
const CHEAT_LEVEL_SCORES = {
  grade: { healthy: 0, unhealthy: 1, cheat: 2 },
  level: { none: 0, weak: 1, moderate: 2, strong: 3 }, // 四档现象/EXT 题
  sbw: { none: 0, burst: 1 },                          // 停滞突发二桶
  activity: { low: 0, mid: 1, high: 2, ultra: 3 },     // 活跃度档
  dominance: { low: 0, mid: 1, high: 2 },              // 捆绑主导度档
  abnormal: { negligible: 0, noticeable: 1, dominant: 2 }, // 异常行为占比（D3.39 改名 abnormal_behavior_ratio；unclear 不在表→null 不冒充）
};

/** 档位→数值（未知值/null → null 不冒充） */
function scoreLevel(map, value) {
  if (value == null) return null;
  return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : null;
}

/**
 * 观测产物 → FA 因子投影原料（service 分析链尾部调用，随返回形状透传引擎）：
 * levels=15 题数值档（FA 出口键；washPair D3.28/holdingsBalance D3.32/burstSpike D3.51 起入列）、buckets=字符串原值
 * （metadata/日志研究友好）、anchors=数值锚九键（2026-11-01 用户补点「著名钱包
 * 掌控/持仓极不均衡」：obs.anchors 持仓占比四键 sb/eq/t1 供/流 + extras famous
 * 数值/档位；D3.28 同块对敲三键 washPair 数量/卖占/买占。**G10 起 sb/eq 两锚
 * 门侧消费退役**——投影照常产出，条件串/研究侧自由消费不变，头注 G10 段）。
 * activityLevel/bundledDominance/washPair 缺席（<D3.5/<D3.8/<D3.28 旧档）→ null。
 */
function levelsFromObservation(observation, extras = {}) {
  const obs = observation || {};
  const ph = obs.phenomena || {};
  const ex = obs.extLevels || {};
  const fx = extras || {};
  const act = obs.activityLevel && obs.activityLevel.bucket ? obs.activityLevel.bucket : null;
  const dom = obs.bundledDominance && obs.bundledDominance.bucket ? obs.bundledDominance.bucket : null;
  const pt = obs.abnormalBehavior && obs.abnormalBehavior.bucket ? obs.abnormalBehavior.bucket : null;
  const levels = {
    equalAmountSplit: scoreLevel(CHEAT_LEVEL_SCORES.level, ph.equal_amount_split),
    coordinatedSellBack: scoreLevel(CHEAT_LEVEL_SCORES.level, ph.coordinated_sell_back),
    creatorFrontRun: scoreLevel(CHEAT_LEVEL_SCORES.level, ph.creator_front_run),
    sellDispersion: scoreLevel(CHEAT_LEVEL_SCORES.level, ph.sell_dispersion),
    stallBurstWave: scoreLevel(CHEAT_LEVEL_SCORES.sbw, ex.stall_burst_wave),
    amountTiering: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.amount_tiering),
    sameBlockBuyWave: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.same_block_buy_wave),
    insiderSupplySell: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.insider_supply_sell),
    slowGrindPump: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.slow_grind_pump),
    washPair: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.wash_pair),
    holdingsBalance: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.holdings_balance), // D3.32（G7 J 通道）
    burstSpikeConcentration: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.burst_spike_concentration), // D3.51（G15 A 主判）
    strongBackerPressure: scoreLevel(CHEAT_LEVEL_SCORES.level, ex.strong_backer_pressure), // D3.52（CD159 观察期——**无通道消费**：MAIN_IDS 显式排除不进 A，档位只进 FA 投影攒分布，豁免规则攒 case 后再裁）
    activityLevel: scoreLevel(CHEAT_LEVEL_SCORES.activity, act),
    bundledDominance: scoreLevel(CHEAT_LEVEL_SCORES.dominance, dom),
    abnormalBehavior: scoreLevel(CHEAT_LEVEL_SCORES.abnormal, pt), // D3.39（G13 R 通道 abnormal_behavior_ratio；unclear→null）
  };
  const buckets = {
    equalAmountSplit: ph.equal_amount_split ?? null,
    coordinatedSellBack: ph.coordinated_sell_back ?? null,
    creatorFrontRun: ph.creator_front_run ?? null,
    sellDispersion: ph.sell_dispersion ?? null,
    stallBurstWave: ex.stall_burst_wave ?? null,
    amountTiering: ex.amount_tiering ?? null,
    sameBlockBuyWave: ex.same_block_buy_wave ?? null,
    insiderSupplySell: ex.insider_supply_sell ?? null,
    slowGrindPump: ex.slow_grind_pump ?? null,
    washPair: ex.wash_pair ?? null,
    holdingsBalance: ex.holdings_balance ?? null,
    burstSpikeConcentration: ex.burst_spike_concentration ?? null,
    strongBackerPressure: ex.strong_backer_pressure ?? null, // D3.52（CD159 观察期攒数据）
    activityLevel: act,
    bundledDominance: dom,
    abnormalBehavior: pt,
  };
  const an = obs.anchors || {};
  const famousLevel = typeof fx.famousDominanceLevel === 'string' ? fx.famousDominanceLevel : null;
  const anchors = {
    sameBlockHoldPct: _pct(an.sameBlockHoldPct),
    equalBandHoldPct: _pct(an.equalBandHoldPct),
    washPairCount: _pct(an.washPairCount),
    washPairSellPct: _pct(an.washPairSellPct),
    washPairBuyPct: _pct(an.washPairBuyPct),
    top1HoldSupplyPct: _pct(an.top1HoldSupplyPct),
    top1HoldCircPct: _pct(an.top1HoldCircPct),
    // D3.32 持仓分布锚族（G7 J 通道 holdings_balance 的数值源；缺席=null 不冒充）
    top2HoldSupplyPct: _pct(an.top2HoldSupplyPct),
    top1Top2HoldSupplyPct: _pct(an.top1Top2HoldSupplyPct),
    top1Top2FirstBuyGapSec: _pct(an.top1Top2FirstBuyGapSec),
    clusterHoldSupplyPct: _pct(an.clusterHoldSupplyPct),
    t1PlusClusterSupplyPct: _pct(an.t1PlusClusterSupplyPct),
    // G8（批次六）burst 波强度三键（G18 起纯观察——弱波代码臂退役，锚照常产出
    // 供 FA 投影/研究侧）+ K/L 通道零买纯卖占比
    burstMaxGapSec: _pct(an.burstMaxGapSec),
    burstWaveBuyBnb: _pct(an.burstWaveBuyBnb),
    burstWaveWallets: _pct(an.burstWaveWallets),
    // CD392 burst 波起点价锚（D3.66 起纯观察）+ D3.66 burst 起来起点价锚（最后
    // ≥50s 静默段出口首可靠价 vs launch 地板 %；G18 起第四腿代码门退役=题面
    // 「位置参考」事实）+ CD398 burst 波流向锚（波钱包全窗 Σ(买−卖) BNB 可负
    // ——净负=波是卖方主导（谷歌SI 单笔 -0.590 卖出），burst 豁免流向硬腿消费）
    burstWaveStartVsLaunchPct: _pct(an.burstWaveStartVsLaunchPct),
    burstExitVsLaunchPct: _pct(an.burstExitVsLaunchPct),
    burstWaveWalletNetBnb: an.burstWaveWalletNetBnb === null || an.burstWaveWalletNetBnb === undefined
      ? null
      : Number(an.burstWaveWalletNetBnb),
    // CD398 二修：波窗自身净流（主判量，BNB 原值域可负不 _pct 归一）——卖家
    // 发起的波只有此键可见（谷歌SI 案波钱包全窗净额 +0.0367 误放、波窗净流
    // -0.583 拒）；service 侧 CD398 流向硬腿消费
    burstWaveNetBnb: an.burstWaveNetBnb === null || an.burstWaveNetBnb === undefined
      ? null
      : Number(an.burstWaveNetBnb),
    // CD400 贴锚组织性砸出零承接锚族六键（CheatCheckService._exemptDeniedReason
    // dump_no_absorption 臂判据源——非 FA 投影消费（引擎投影显式挑键不带本族）；
    // 无达标块→null=臂不触发（不扩大收紧面），头注见 cheat-snapshot 计算段）
    nearDumpQualBlocks: _pct(an.nearDumpQualBlocks),
    nearDumpMinAbsorbBnb: _pct(an.nearDumpMinAbsorbBnb),
    nearDumpWorstSellers: _pct(an.nearDumpWorstSellers),
    nearDumpWorstSellBnb: _pct(an.nearDumpWorstSellBnb),
    nearDumpWorstSecToAnchor: _pct(an.nearDumpWorstSecToAnchor),
    nearDumpWorstSameBlkBuyBnb: _pct(an.nearDumpWorstSameBlkBuyBnb),
    // CD401 出口段卖压三键（burst_exit_sell_pressure 不豁免臂判据源——出口整窗
    // 买/卖/卖%；非 FA 投影消费（CD400 同形）；无 ≥50s 静默段→null=臂不触发，
    // 头注见 cheat-snapshot 计算段）
    burstExitSegBuyBnb: _pct(an.burstExitSegBuyBnb),
    burstExitSegSellBnb: _pct(an.burstExitSegSellBnb),
    burstExitSegSellPct: _pct(an.burstExitSegSellPct),
    // CD405 burst 捆绑收割两键（burst_bundled_wave 不豁免臂判据源——波窗（最后
    // ≥50s 静默段出口+60s）单块/相邻两 slot 去尘捆绑钱包数；非 FA 投影消费
    // （CD400/CD401 同形）；无 ≥50s 静默段→null=臂不触发，头注见 cheat-snapshot）
    burstWaveBundleMaxWallets: _pct(an.burstWaveBundleMaxWallets),
    burstWaveBundleAdjPairSum: _pct(an.burstWaveBundleAdjPairSum),
    noBuySellPct: _pct(an.noBuySellPct),
    // D3.50 总交易量占比（÷买+卖合计）——insider 题⑤单钱包隐藏筹码豁免的伤害
    // 量级标尺（观察/审计键：L 通道仍消费 noBuySellPct，本键无门侧消费）
    noBuySellVolumePct: _pct(an.noBuySellVolumePct),
    // D3.51 burst 尖刺两锚（burst_spike_concentration（A 主判 G15）同源数值：
    // 尖刺买入占簇买入%/尖刺钱包正净占全窗正净%；题面判读原料非门侧消费）
    spikeBuyPctInBurst: _pct(an.spikeBuyPctInBurst),
    spikeHoldPctAll: _pct(an.spikeHoldPctAll),
    // D3.52 锚窗买卖比（strong_backer_pressure 题判读原料——CD159 强庄币锚
    // 观察期：**无门侧消费**，只进 FA 投影/研究侧攒分布；窗口卖=0 → null）
    anchorBuySellRatio: _pct(an.anchorBuySellRatio),
    // D3.53 精确等额同块簇三键（CD160：题面判读原料——**无门侧消费**（用户裁定
    // 「把这个现象描述出来给 Jev」），state 事实行+FA 投影同源；无合格簇→null）
    exactEqualBlockBuyPct: _pct(an.exactEqualBlockBuyPct),
    exactEqualBlockClusterCount: _pct(an.exactEqualBlockClusterCount),
    exactEqualBlockMaxWallets: _pct(an.exactEqualBlockMaxWallets),
    // D3.54 同块脉冲节拍三键（CD161：题面判读原料——**无门侧消费**（G15 通道
    // 不动，R 通道消费的是题档非数值），state 事实行+FA 投影同源；null 不冒充）
    pulseBlockCount: _pct(an.pulseBlockCount),
    pulseBlockBuyPct: _pct(an.pulseBlockBuyPct),
    pulseMaxGapBlocks: _pct(an.pulseMaxGapBlocks),
    // D3.35 协同买入参考四键 + 创建者曾持峰值（abnormal_behavior_ratio（D3.39 前
    // real_participation）/ holdings_balance
    // 补腿同源数值；参考锚非门——R 通道消费档位不消费数值）
    maxBlockBuyCount: _pct(an.maxBlockBuyCount),
    maxBlockBuyPct: _pct(an.maxBlockBuyPct),
    maxBlockPreGapSec: _pct(an.maxBlockPreGapSec),
    sameAmountWalletPct: _pct(an.sameAmountWalletPct),
    creatorPeakHoldSupplyPct: _pct(an.creatorPeakHoldSupplyPct),
    famousDominancePct: _pct(fx.famousDominancePct),
    famousDominanceLevel: famousLevel,
    famousDominance: scoreLevel(CHEAT_LEVEL_SCORES.dominance, famousLevel),
  };
  return { levels, buckets, anchors };
}


/** 四现象题（B 通道现象门原料） */
const PHEN_IDS = PHENOMENON_IDS; // [equal_amount_split, coordinated_sell_back, creator_front_run, sell_dispersion]

/** 九主判题：四现象剔 cr + EXT 剔 sbw（cr/sbw=辅助判定不进主判；wash_pair D3.28
 *  随 EXT 清单自动入列；**holdings_balance D3.32 刻意排除**——G7 用户裁定独立
 *  J 通道（strong→unhealthy）不进 A 主判清单，组合垄断=拒买级非拉黑级；
 *  burst_spike_concentration D3.51 随 EXT 清单自动入列（G15——伏击尖刺=
 *  拉黑级铁证，与 G7 拒买级通道不同类）；**strong_backer_pressure D3.52 刻意
 *  排除——CD159 强庄币锚观察期**：用户裁定「这个锚先实现，但是可以先不起作用，
 *  我们攒个一批数据看看」，豁免方向题绝不拉黑（EXT 自动吸收 strong→cheat 与
 *  豁免意图相反），档位只进 FA 投影攒分布，豁免规则（预期作用点=J/R/M/E 等
 *  unhealthy 通道、绝不绕 A 主判）攒 ~10 张干净强庄 case 后再裁 */
const MAIN_IDS = [
  'equal_amount_split',
  'coordinated_sell_back',
  'sell_dispersion',
  ...EXT_PHENOMENON_IDS.filter((id) => id !== 'stall_burst_wave' && id !== 'holdings_balance' && id !== 'strong_backer_pressure'), // tier/bw/rat/pump/wash/spike（sbp 观察期排除）
];

/**
 * CD159 强庄形状规则（SB1，2026-11-04 §七/§七.5 落码——**纯观察臂，grade 零消费**）：
 * 「曾经命中」粘滞语义的当轮判定纯函数——强庄池 10 张 vs 226 票人工裁定对照的首轮
 * 系统研究定形（docs/强庄币锚立项分析.md §七.5）：数值规则 R ∧ 对敲零排除臂，池命中
 * 7/10、有害误豁 13/184≈7%（对照组作弊票活不到大锚=晚锚区误豁 ≈1%）。
 * - 庄侧：明面第二大户 top2HoldSupplyPct ≥4.5（AUC 0.74）+ burst 波资金
 *   burstWaveBuyBnb ≥2.2（AUC 0.76，合力侧「庄跟用户合力」的波形状）
 * - 排除臂（作弊形状三剔）：sameAmountWalletPct ≥15 剔（分仓等额是作弊形状）；
 *   washPairCount >0 剔（对敲=强庄从不同向）；代码 act=low 剔（死盘）
 * - **null 语义与研究脚本逐字一致**（改语义=改统计口径，须重跑 §七.5 对拍）：
 *   sameAmountWalletPct null=无等额簇**按不过**（保守，研究口径 ??99）；washPairCount
 *   null=无配对**按干净**；activityLevel null≠low **按过**（排除臂缺证据不剔）
 * - 粘滞由 CheatCheckService 持有（`_strongbackerLike` Set，任一轮命中即置位，
 *   进程内存态重启清零）；本函数只答「当轮命中吗」——**绝不进 gradeObservation**
 *   （G15 不变、黄金集零变化；豁免立法攒生产分布后再裁，CD159 案）
 */
const STRONGBACKER_RULE_VERSION = 'SB1';
const STRONGBACKER_RULE = {
  burstWaveBuyBnbMin: 2.2,   // burst 波 Σ买（BNB）下限
  top2HoldSupplyPctMin: 4.5, // 第二大户占总供应量 % 下限
  sameAmountWalletPctMax: 15, // 等额分仓钱包占买方 % 上限（≥此值=作弊形状剔）
};

function strongbackerShapeHit(derived) {
  if (!derived) return false;
  if (!((derived.burstWaveBuyBnb ?? 0) >= STRONGBACKER_RULE.burstWaveBuyBnbMin)) return false;
  if (!((derived.top2HoldSupplyPct ?? 0) >= STRONGBACKER_RULE.top2HoldSupplyPctMin)) return false;
  const sa = derived.sameAmountWalletPct;
  if (!(sa != null && sa < STRONGBACKER_RULE.sameAmountWalletPctMax)) return false; // null 不过（研究口径）
  const wash = derived.washPairCount;
  if (!(wash == null || wash === 0)) return false; // null=无配对=干净
  if (derived.activityLevel === 'low') return false;
  return true;
}

/** 数值锚读取（null/非有限/负数按缺席——绝不冒充） */
function _pct(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * 观测记录 → 交易三级
 * @param {Object} observation - buildObservation 产物
 *   {phenomena, extLevels, activityLevel:{bucket}|null, bundledDominance, anchors}
 * @param {Object} [extras] - 分级附加原料
 *   {famousLevel: 'low'|'mid'|'high'|null, famousFollowerTop3Pct: number|null,
 *    famousGroupBuyPct: number|null, anchorSellCount: number|null}
 *   （famousLevel=snapshot.derived.famousDominanceLevel；famousFollowerTop3Pct=
 *   snapshot.derived.famousFollowerTop3Pct（G5 D 通道跟单集中度豁免判据）；
 *   famousGroupBuyPct=snapshot.derived.famousGroupBuyPct（G6 D 通道豁免前提：
 *   famous∪跟单买入占锚窗总买 %，≥80=正常承接不足两成不豁免）；anchorSellCount=
 *   锚窗卖笔数，service 从 pull.rows 现数——G2 起 E 通道不再消费（历史 D3.x
 *   豁免原料），字段保留为 service/digest 兼容形状）
 * @returns {{grade:'cheat'|'unhealthy'|'healthy', reasons:Array<{level:string,code:string}>, version:string}}
 */
function gradeObservation(observation, extras = {}) {
  const obs = observation || {};
  const ex = extras || {};
  const ph = obs.phenomena || {};
  const ext = obs.extLevels || {};
  const lv = {};
  for (const id of PHEN_IDS) lv[id] = ph[id] ?? null;
  for (const id of EXT_PHENOMENON_IDS) lv[id] = ext[id] ?? null;

  const sbw = ext.stall_burst_wave ?? null;
  const strongHit = MAIN_IDS.filter((k) => lv[k] === 'strong');
  const modAll = MAIN_IDS.filter((k) => lv[k] === 'moderate').length;
  const dom = typeof ex.famousLevel === 'string' ? ex.famousLevel : null;
  const act = obs.activityLevel && typeof obs.activityLevel.bucket === 'string'
    ? obs.activityLevel.bucket : null;
  const anchors = obs.anchors || {};
  // （G10 退役 sbHold/eqHold 门侧消费——sbHold 是活跃度函数非组织性度量，
  //  现象由题面语言承载，头注 G10 段；两锚照常产出供观察/条件串）
  // （G11 退役 bd/bundleBuy 门侧消费——sb∪eq 圈定吞 GMGN 前端默认档散户
  //  （CD133），G 通道整体退役，头注 G11 段；bd 档位与锚照常产出供投影）
  const folTop3 = _pct(ex.famousFollowerTop3Pct);
  const famousBuyPct = _pct(ex.famousGroupBuyPct);
  // （G8 弱 burst 三键读取已随 G18 退役——CD397 判定权归 Jev，锚照常产出供投影；
  //   K/L 通道零买纯卖占比保留）
  const noBuySell = _pct(anchors.noBuySellPct);

  const reasons = [];

  // A：七主判任一 strong → cheat；单 pump+burst 形状降级 unhealthy
  if (strongHit.length > 0) {
    const lonePumpBurst = strongHit.length === 1
      && strongHit[0] === 'slow_grind_pump'
      && sbw === 'burst'
      && modAll < 3;
    if (lonePumpBurst) {
      reasons.push({ level: 'unhealthy', code: 'A_downgrade_single_pump_burst' });
    } else {
      reasons.push({ level: 'cheat', code: `A_strong:${strongHit.join('+')}` });
    }
  }

  // （G10 退役 B 通道：四现象 moderate≥3 → cheat。骨架=「现象共振 ∧ sbHold≥50
  //  联立」，sbHold 佐证随 G10 退役后只剩裸 moderate 共振——黄金集重放新增错杀
  //  CD98/CD124 两票人工 healthy（拉黑不可逆），且 B 在 G1-G9 黄金集正命中为零
  //  =阈值从未校准；用户裁定整体退役，「多现象共振」证据交 A 主判（strong 档）
  //  与题面档位校准，头注 G10 段；git 历史留档）

  // （G9 退役五纯数值门：C sbHold≥85 / H washPair 数值 / I t1 供≥40 /
  //   F sbHold≥50 / K noBuySell≥40——判罚不经任何 Jev 档位，头注 G9 段；
  //   对倒→wash_pair 题 A 主判、独大→holdings_balance/insider 题 J/L、
  //   纯卖方→L insider 联立；锚照常产出只不作门）

  // D：著名钱包主导（G5 补跟单集中度豁免，2026-11-02 批次四用户裁定「它们的跟单
  // 量是不是高估了？因为聪明钱的跟单一定程度也不算完全不健康的」+「也不能把所有
  // 的后续买入全看成 famous 的跟单」——dom=high 16 票研究：60s 跟单窗覆盖买家数
  // 中位 80%+（最高 95%），dom 分子主体是跟单者而非 famous 本人（本人持中位 ~10%）
  // → dom 高很大程度度量「famous 买入后 60s 内盘面热」。跟单 top3 合计占跟单正净
  // Σ <45%=分散形（几十个散户小额跟进、首买中位 0.05-0.17 BNB、最大单钱包 <10%）
  // =「聪明钱带散户」豁免不触发；≥45%=集中形（少数大户贴身重仓=疑似分仓/协同，
  // CD63 top3 87%/最大 26%、CD80 81%）维持触发。null（无跟单/跟单正净 Σ=0/旧档
  // 断代）→ 触发：无跟随时 dom 分子全靠 famous 本人=直接控盘更该触发；旧档无键
  // 保持 G4 行为（黄金集 D 段重放零变化）。
  // G6 豁免前提（用户补充裁定，头注③）：组织买入占比 ≥80（正常用户承接不足两
  // 成）→ 不豁免——盘面流量构成基本是 famous∪跟单的独角戏，即使它们已部分撤退
  // 也是死盘形状。famousGroupBuyPct null（旧档断代）→ 不豁免（fail-closed 与
  // sbw null 同哲学：承接证据缺席不给豁免；生产链 dom=high 下该锚必产出数值）。
  // G16 邻界联立臂（CD323 huh 案，2026-11-05 v72 终审用户裁定「我也认为是
  //  famous 主导，unhealthy，可以 fix 一下」）：豁免双臂必须**显著成立**——
  //  足够分散（top3<35）或承接充分（gb<70）；双双贴线（top3≥35 ∧ gb≥70，
  //  距原豁免线各 <10 点）=两臂证据都不显著，dom=high 语义（famous 生态主导
  //  盘面）优先，豁免不成立 → 拦（留痕 D_famous_near_band 与主条件码区分）。
  //  v72 批 dom=high 六票影响面：仅 CD323（40.9/75.7）新拦；CD302（37.5/67.5
  //  gb<70 不中）豁免保持；CD299/CD327 top3≥45 主条件既有零变化；CD300 gb≥80
  //  主条件既有。null 语义不变（top3 null 触发主条件、gb null 不豁免，G5/G6
  //  原哲学）。
  const dMain = !(folTop3 !== null && folTop3 < 45
    && famousBuyPct !== null && famousBuyPct < 80);
  const dNearBand = folTop3 !== null && folTop3 >= 35
    && famousBuyPct !== null && famousBuyPct >= 70;
  if (dom === 'high' && (dMain || dNearBand)) {
    reasons.push({ level: 'unhealthy', code: dMain ? 'D_famous_dominance' : 'D_famous_near_band' });
  }

  // E：活跃度低（G2 简化，2026-11-01 用户裁定「活跃度这一臂为 low 的，也判为
  // unhealthy，不过流量 burst 命中的不要判定为活跃度 low」——t1流<40 吃独食豁免
  // 与卖笔≤1 对手盘豁免撤销；sbw=burst 豁免保留为通道层双保险，主修正前移到
  // 题面 D3.27：burst 形状（长静默后集中涌入）Jev 不再产 low 档）
  // G8 弱 burst 代码臂已随 G18 退役（2026-11-11 CD397 用户裁定「burst 的判定被
  // 代码魔改了，我的建议依然是不要魔改，用 Jev 判断」——代码硬线（≥60s/<1.05/
  // <13）与豁免四腿同批拆除；「停滞后只涌入一点小流量」的排除教学移交 sbw 题
  // D3.67 题面（尘埃=户均/中位锚判读），弱波判定权归 Jev。E 通道恢复 sbw 单条件
  // ——sbw=burst 即跳过 E；sbw 题 D3.67 按单段绑定波族判（波不在沉积出口附近/
  // 尘埃流量/卖出引发 → Jev 判 none，E 恢复拦截）。案史：G8 定线时 17 票
  // sbw=burst 豁免挡住的全是自己人（14 票 Jev act 已判 low）——退役后该防线
  // 由 D3.67 题面四判轴接棒，E_low_activity_weak_burst 码随臂退役（历史行留档）
  if (act === 'low' && sbw !== 'burst') {
    reasons.push({ level: 'unhealthy', code: 'E_low_activity' });
  }

  // G：（G11 整体退役，2026-11-02 CD133 用户裁定——sb∪eq 并集圈定吞 GMGN 前端
  //  默认档散户「误伤就太大了」，豁免前提 bundleBuyPct 骨架塌；协同现象由 A 题
  //  档承载（equal_amount_split/same_block_buy_wave，D3.34 题面加前端默认档反锚
  //  与同块同额双协同判据），头注 G11 段；git 历史留档）

  // J：前几大持仓组合垄断（G7，2026-11-02 批次五 CD122 立项——用户裁定「给 Jev
  // 增加 持仓均衡 门吧。注意总供应量占比最重要，第二 CD122 的 top2 不是单一
  // 钱包，而是捆绑簇。需要利用 Jev 的能力处理复杂情况」+「strong→unhealthy
  // （独立通道，不进 A 通道）」）：holdings_balance（D3.32 第 13 题）strong →
  // unhealthy。组合垄断=拒买级非拉黑级（F/G 同档语义）；单一钱包独大 ≥40 供仍
  // 由 I 通道 cheat 管并取最重——本题补 I 够不着的形状（CD122：top1 供 25.6<40
  // 但第1大∪簇并集 40.1%+第二大背靠背块紧邻进场 3 秒卖一半）。档位 null
  // （<D3.32 旧档断代/总供应量缺失缺主口径）不触发（EXT 容缺语义同族）。
  if (lv.holdings_balance === 'strong') {
    reasons.push({ level: 'unhealthy', code: 'J_holdings_strong' });
  }

  // L：insider 题升格联立臂（G8 双修第二落法——insider_supply_sell 原为 EXT 纯
  // 观察题不进任何通道，CD5 分仓形状该题 moderate 但 G7 无消费点）：Jev 内幕
  // 卖出档位 ∈{moderate,strong} ∧ noBuySellPct≥25 → unhealthy。档位证据补足
  // 数值证据故联立线（25）低于 K 单锚线（40）；定线（128 票）：五票
  // CD67/CD70/CD82/CD71/CD123 全对、CD60 反例（insider strong 人工 healthy、
  // 纯卖 24.8<25）恰被排除。insider weak/none/null 不触发；noBuySellPct null
  // 不触发
  if ((lv.insider_supply_sell === 'moderate' || lv.insider_supply_sell === 'strong')
    && noBuySell !== null && noBuySell >= 25) {
    reasons.push({ level: 'unhealthy', code: `L_insider_sell${noBuySell.toFixed(0)}` });
  }

  // R：异常行为占比（D3.35 新增独立通道 G12，G13 改制——用户裁定 2026-11-03
  // 原话「这个模块的问题在于“需要证明有真实用户参与”，但是这个理念是不对的，
  // 我认为应该改为 “异常行为识别与比例计算”，明确它要做的事情，并且不作有罪
  // 推定。就是说，如果交易序列不能明显看出有问题，不需要去证明自己一定是
  // “真实用户”」：题改名 real_participation→abnormal_behavior_ratio（D3.39，
  // 判读方向翻转为无罪推定——找出看得见的异常并估其合计流量占比，无可见
  // 异常即正常），dominant（异常形状合计解释了盘面流量的主要部分——同块同额
  // 挤入/冷寂期突现密集块/规整阵列/对倒等）→ unhealthy。**拒买级非拉黑级**
  // （与 J 通道同档语义——「宁可放过」基调：unhealthy 留重判域（CD134 缺省门
  // cheatGrade==1 仍可再判），不用尽不拉黑）；negligible/noticeable/unclear
  // 不触发（unclear=证据不足不硬判）；档位 null（<D3.39 旧档断代/题缺席——
  // 含 D3.35-D3.38 real_participation 期答案，改名=换键语义镜像不可比）不
  // 触发（EXT 容缺语义同族——黄金集旧档重放零变化）。**独立通道不进 A 主判**
  // （综合结论与单现象 strong 的证据链不同类——A 管单现象铁证拉黑，R 管整体
  // 异常占比拒买，取最重时 cheat 仍压过 unhealthy）
  const pt = obs.abnormalBehavior && typeof obs.abnormalBehavior.bucket === 'string'
    ? obs.abnormalBehavior.bucket : null;
  if (pt === 'dominant') {
    reasons.push({ level: 'unhealthy', code: 'R_abnormal_dominant' });
  }

  // M：超高活跃度（G14，2026-11-03 v68 成交票扩集 CD138 立项——用户裁定原话
  // 「CD138 活跃度过高我建议给 unhealthy，可以分析下。也可以单独的立 sniper 锚，
  // 但是 GMGN 网站上有 sniper 的标记，但是我们自己的算法如何做这个锚？我给
  // unhealthy」+ sniper 两口径否证后续裁定「对，我们的这个不太好用。如果没有
  // 太好的办法，就超高活跃度 unhealthy 吧」「『超高活跃度 → unhealthy』没问题，
  // 接受 Mamesuke 错杀」）：activity_level=ultra → unhealthy 留痕 M_hyper_activity。
  // 定线（v68 20 票）：ultra 六票 ticksPerMin 86.7-436（meme 436/币安兄弟 250.6/
  // 凯伦 153.3/DPRKaptcha 124/CZ 100/Mamesuke 86.7；high 档最高 65.5 断崖清晰）；
  // sniper 两口径均无区分度——跨盘画像 isSniperProfile（tokenCount≥100+闪进闪出）
  // 命中 meme 仅 0.1% 买入反而人工 healthy 的 Mamesuke 42.8%、가나 36.2%；创建后
  // ≤10s 首买覆盖 meme 73% vs Mamesuke 91%（职业 sniper 打新与打新盘全员早期买入
  // 都是常态，GMGN sniper 徽标=per-token 早期买入标记非跨盘画像）→「过度密集/
  // 活跃度太过」的载体就是活跃度档本身。**已知代价=CD141 Mamesuke（86.67
  // ticks/min ultra@0.50、人工 healthy、1.92 BNB 小盘）被错杀——用户明示接受**
  // （unhealthy=拒买可重判，CD134 缺省门留重判域）。与 E 通道 act=low 对称
  // （Jev 判档、代码只映射交易动作，D3.5 边界）；act 档 null（题缺席/旧档断代）
  // 不触发；mid/high 不触发
  if (act === 'ultra') {
    reasons.push({ level: 'unhealthy', code: 'M_hyper_activity' });
  }

  // N：聚合路由入口占比（G17，2026-11-05 CD350 侦察立项——用户提案「把 GMGN
  // 路由的流量占比给过去，如果太低就不行」+「门可以加」）：锚窗买入笔走聚合
  // 路由占比 <10% → unhealthy 留痕 N_no_retail_entry（带数值）。纯代码数值门
  // （Jev 零参与——与 E 弱 burst 代码臂/G16 邻界臂同族：数据分布铁证+用户裁定
  // 立线，锚不进 state/题面）。清单=AGGREGATOR_ROUTER_ADDRS 9 址全集（同日扩录
  // ——GMGN 单址口径会把「流量走其他聚合器」的票误判无入口，如 CD36 真实
  // 散户盘 GMGN 单址 5.9%、9 址合计 23.8%=healthy 组 min）。null（snapshot 层
  // 买 <15 笔样本薄/零买入；<D3.62 旧档断代缺键）不触发 fail-open；恰 10.0
  // 不触发（严格小于）。**拒买级非拉黑级，独立通道不进 A 主判**
  const retailEntry = _pct(anchors.routerEntryBuyPct);
  if (retailEntry !== null && retailEntry < 10) {
    reasons.push({ level: 'unhealthy', code: `N_no_retail_entry${retailEntry.toFixed(1)}` });
  }

  const grade = reasons.some((r) => r.level === 'cheat') ? 'cheat'
    : (reasons.some((r) => r.level === 'unhealthy') ? 'unhealthy' : 'healthy');
  return { grade, reasons, version: CHEAT_GRADE_RULES_VERSION };
}

module.exports = {
  gradeObservation, CHEAT_GRADE_RULES_VERSION, MAIN_IDS,
  CHEAT_LEVEL_SCORES, scoreLevel, levelsFromObservation,
  strongbackerShapeHit, STRONGBACKER_RULE, STRONGBACKER_RULE_VERSION,
};
