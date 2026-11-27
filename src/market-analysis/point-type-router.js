/**
 * 点位类型辨别与对应策略（pointType 模块 / T216，2026-11-23 用户提案「T213b 泛化」）
 *
 * 定位：信号 fire 后、门链（FP→AF1→CD→BP）前的**纯因子分类层**——按优先级阶梯
 * 把当前点位分类，每类型携带一份门控策略（policy：FP 臂集/AF1/cheat 门/BP 门
 * 各自可开可关）。现行普通代币流程收编为 normal 兜底类型（policy={} = 现行全门
 * 语义）；类型注册表全局维护随模块版本走（用户裁定 2026-11-23，像 FP 臂：识别器
 * =全局知识），包经 modules.pointType:'v1' 启用；不启用 = 不分类 = 行为 bit 不变。
 * 每类型带 `active` 布尔字段（用户裁定 2026-11-25「给 pointType 增加一个是否激活的
 * 参数，像这个还在迭代中的，激活为否，不生效」）：active:false = 分类跳过（不命中/
 * 无 policy/无 metadata 留痕，回落后续类型），迭代完成翻 true 时 bump POINT_TYPE_VERSION。
 *
 * T242 实验级激活（2026-11-26 用户指令「将 pointType 的开关激活改为实验层面可配置项」）：
 * 注册表 active = 全局缺省（随代码走）；实验 config.pointTypes.active = {类型 id: 布尔}
 * 逐类型覆盖（未列出的类型沿用注册表缺省）。同一份有效激活表管两处——
 *   ① 分类：classifyPointType 跳过未激活类型（信号回落后续类型/normal 兜底）；
 *   ② 专属触发腿：买腿可携带 `pointType: <类型 id>` 绑定（p16~p20 自触发同款），
 *      类型未激活即该腿不组装（引擎 _buildStrategyConfig 过滤）——只关分类不关腿时，
 *      「关掉类型」只是把它的信号改道 normal 走全门（类型空转、腿照触发），开关量不到
 *      类型本身的贡献。绑定是包数据（策略本体），激活是实验数据（对拍可切）。
 *
 * 形态仿 factor-pre-buy-check.js：CJS 纯函数 + 版本常量；改判定/加类型必 bump
 * POINT_TYPE_VERSION（module-registry v1 键解析本常量落 strategyResolved 审计）。
 * condition 复用腿条件同款 ConditionEvaluator（FA 因子表达式）；启动防线
 * assertPointTypesValid 用 FA getFactorKeys 三防线同款未知因子 throw。
 *
 * policy 值域（StrategyLibraryService.validatePack 白名单镜像——改值域两侧同步）：
 *   factorCheckArms: 'cheatOnly'（FP 只留严重作弊臂）| 'skip'（FP 整门直通）
 *   actFront:        'pass'（AF1 直通，cheat 门照走）
 *   cheatCheck:      'skip'（跳 16 题 Jev 判定——引擎拉黑短路在门链外层保留）
 *   buyPoint:        'stuffingOnly'（BP 只评塞单门）| 'skip'（BP 整门直通）
 * 未列出的维度 = 该门现行行为。
 */
'use strict';

const { ConditionEvaluator } = require('../strategies/ConditionEvaluator');

const POINT_TYPE_VERSION = 'PT65'; // PT65=T240 做市类型十四修（2026-11-27 开放任务「因子过滤分析·胜率优先」）：actNewTraders ≥15 ∧ tradesNetBuyRatioShortWin ≤40——v319 面板分离度 top〔actNewTraders AUC 0.88 正 29/负 16；shortWin 倒置 正 −51.8/负 +29.9〕；两窗交叉验证〔v319 拒 11 正 0 胜率 55% PnL +1.037 / v315 拒 26 正 1 胜率 52% PnL +0.619〕；语义=死票不做（10s 无新钱包）＋追高不接（20 笔净买 >40%），做市坑正确入场=砸盘尾段；赢家 12 张 actNewTraders 全 ≥19、shortWin 全 ≤24.6；引擎 A/B=bt-v320 检验中 // PT64=T240 做市类型十三修（2026-11-27 用户提案「做市代币价格前期不会太低」）：curVs 下界 50——fire 点扫描正票 curVs 中位 102 vs 负票 58〔curVs<50 切 21 票=2 小正 +0.035 vs 19 负 −0.739，净 +0.70；头冠全安全 Faceless 59/DYOR 58/ZGIVE 121/oddspad 88/SXSI 172；出生价维度零分离否决〔bonding floor 恒定 4~7e-9，<5e-9 切 4 正 1.87〕；fire 绝对价 <8e-9 地板切 23 票净 −0.16 否决〕；语义=「离发行价太近的坑不做——做市商还没把价格做上去的坑是死坑」；推迟语义引擎 A/B=bt-v319 检验中 // PT63=T240 做市类型十二修·v9 回滚（2026-11-27 bt-v318 A/B 否决 chg3Pct≥-5 秒级暴跌地板：切 22 票含 7 正 −2.36〔oddspad +0.824/牛 +0.550/ZGIVE +0.507/BI +0.156/币安神学 +0.118/ERIKAZ +0.080〕vs 15 负只省 +0.90+换点 −0.09 = 净 −1.56——深坑票 chg3 回正时龄窗/节奏键已衰减永久错过，与 v8 龄界同构；fire 点扫描「切 18 票零正」被引擎打脸=扫描只看 fire 时刻不算推迟后窗口关闭；同轮用户提议「买入前 block 的涨跌」= recentBlockDropPct 地板扫描否决〔正票 rbd 中位 43.8 比负票 40.4 还深，任何线切 14~16/17 正——深坑入场天然在暴跌块里，与 PT58 rbd 否决同构，价格速度维度不可分〕；回滚后条件=PT57 v6 形状 // PT62=T240 做市类型十一修（2026-11-27 用户裁定「临近买入的数秒在暴跌，或者买入时在暴跌」）：chg3Pct≥-5 秒级暴跌地板——新键 3s 微观动量〔正票中位 +11.4 vs 负票 −3.0〕，重放扫描切 18 票零正〔蝴蝶飞轮 −46.8/躺赢 −41.7/淘宝 −38.1/抖音 −10.7 点名全切；GLEAF −3.0/SI −3.2 顽固残留=边界〕；保留 39 票含全部 17 赢家 PnL +4.68 // PT61=T240 做市类型十修·v8 回滚（2026-11-27 bt-v317 A/B 否决「好票不会买入不上」：龄下界 12 版 13 张 age<12 赢家仅 2 张再触发〔11 张秒级窗口永久错过〕，砍 27 负票省 +1.61 vs 赢家丢失 −3.44 = 净 −2.28；回滚后条件=PT57 v6 形状 // PT60=T240 做市类型九修（2026-11-27 用户裁定「回测一下年龄控制策略——好票不会买入不上，差票却大概率被砍掉」）：龄下界 3→12 推迟入场版——age<12 的 40 票〔13 正 27 负〕按「延迟非丢失」语义引擎重评，条件持续满足者 12s+ 再触发；fire 点扫描 vs 引擎 A/B 的差异即用户假设的检验 // PT59=T240 做市类型八修·v7 回滚（2026-11-27 bt-v316 A/B 否决：actTotalBnb 2→0.1——v7 推迟 6 票含 1 正+换点连锁净 −0.66〔+2.3086 vs v6 +2.9702〕，胜率微升不抵总额降；回滚后条件=PT57 v6 形状，v6 为当前最优 // PT58=T240 做市类型七修（2026-11-27 用户第二批 review 标签「临近买入大量空窗/做市形态丢失」Taigan 案）：actTotalBnb 基线 0.1→2（10s 窗买卖合计——做市形态在场下限；推迟 6 票 1 正〔Taigan 1.73/实用币 0.67 等〕，金狗票 act10 全部 ≥2.40 零误伤）；同批「买入点位暴跌」组〔近块跌幅 rbd 20~51〕与「过热」组〔athVs 273/340〕两线数据否决——rbd>20 切 42 票含 14 正〔深坑入场天然买在暴跌块里，与赢家同构〕、athVs≥250∧mcapFP<50 切面净 +1.22〔切掉反而丢利润〕；作弊票 指哪打哪式调研 单票留边界 // PT57=T240 做市类型六修（2026-11-27 用户裁定「再增加 1 分钟趋势，5 分钟趋势，需要全部为正，拒绝接刀」+「买入点位本身是个暴跌，这也不行」+「市值非常低的做市代币区间可以试着豁免，但中途接刀太危险」）：①chg5Pct≥-10 暴跌点位地板〔SI −11/STAND −19 案；推迟 26 票 3 正，保留 51 票 PnL +2.5072〕②chg60Pct≥0∧chg300Pct≥0 长窗趋势新键〔年轻票退化首可靠价=earlyReturn 口径；本窗口 3-60s 内恒正惰性=语义保险〕③crashSpeed/市值两线数据否决〔cs 地板切光深坑赢家——坑底天然砸速最高；市值 6~16 无分离度〕——GLEAF 类全键正暴跌反弹接刀留作已知边界〔止损 −0.12 封顶〕 // PT56=T240 做市类型五修（2026-11-27 用户裁定「B 吧」）：节奏键深坑冷却豁免臂——blockGapLe1Pct64≥85 ∨ (mcapFP≥50 ∧ blockGapLe1Pct64≥75)——DYOR 案（全局+金狗双料最大赢家 +1.12）：出坑再买再触发时刻所有趋势键全过、唯独节奏键衰减到 83~84（冷却段稀释 64-tick 环）差 1-2 点被 85 线卡死、v4 引擎零信号；深坑票的「深跌冷却再启动」形状冷却段天然稀释节奏（75 仍远高于对照 61.2），浅坑票保持严格节奏识别 // PT55=T240 做市类型四修（2026-11-27 用户裁定「跟『上涨趋势』pointType 一样，近买入点位需要是上涨趋势，否则接刀就会非常多；错过的好票实际只是推迟入场」+「15 秒趋势也加一个限制」+「10 秒趋势在坑里，可以等出坑再买」）：双轨 (mcapFP≥50∨chg30≥40) 替换为无条件 chg30Pct≥0+chg10Pct≥0——出坑再买模拟（v312 成交 129 票 fire 时 chg10<0 占 114）：推迟中位 10.8s/入场价代价中位 +1.4%/正票率 14.5→17.4%/大赢家几乎无损（DYOR 出坑 fwd 696 vs 原 721/超级汪汪队 379 vs 365）/错过 39% 多为继续阴跌接刀票；金狗兼容性=除 CZ 抢跑票外全过 // PT54=T240 做市类型三修（2026-11-27 用户 review 全局 fire 集后裁定「先修一波」）：条件 v3=①坑加深 mcapFP 30→40〔「价格再压」=更深坑，赢家 dd 中位 −45~−50〕②前期过热否决臂 (athVsLaunchPct<400 OR chg30Pct>20)〔标签 10/10「前期过热/涨太高」坐实；切 BTI/超智/Realcoin/JACKET/BDARK 5 负 2 正零右尾〕③深坑企稳/浅坑动量双轨 (mcapFP≥50 OR chg30≥40)〔防误切 DYOR/memeless 型深坑企稳赢家〕④earlyReturn≤30 辅助臂移除〔扫描零边际〕⑤**极端热帽 actTotalBnb30s≤40**〔2026-11-27 用户裁定「使用修改后的基于因子的活跃度检测部件跑一下」+「不仅仅看买入的 BNB，卖出的一样也要算进去」——T244 部件同款键〔买卖合计〕极端尾部：≥40 的 12 张票零正零右尾〔躺赢×3 最高 4128/大结果 2208/CROCS 1540〕，每秒口径 psTotal≤5 切同族 8 张零正〔2.56~23.5 空档线稳〕；⚠窗级 act 帽〔act30s≤6 等〕经数据否决=赢家 fire 更热，只有极端尾部是纯输家〕——fire 点粗估 PnL −8.83→+3.09〔保留 85 票 19 正 66 负〕；引擎 A/B=bt-v312 集合通道对拍 bt-v311 // PT53=T244 活跃度三类型（2026-11-26 用户指令「之前的 normal，改为因子实现后，需要拆分，活跃度高/中/burst 在当前需要对应 3 个 point Type，这样有利于分开进行优化」）：normal 前加 activity_high（临近 30s 成交额 ≥0.99 ∧ 近 10s 独立交易者 ≥4）/ activity_mid（≥0.49 ∧ ≥2）/ activity_burst（≥30s 静默后 ≤30s 内买入涌入 ≥0.29 BNB ∧ ≥3 笔 ∧ 卖 <0.049；原料=FA 新键 burstStallMs/burstWaveSec/burstWaveBuyBnb/burstWaveSellBnb/burstWaveBuyN，静默阈 30s 独立状态机）；三者 policy={} 同 normal=只拆分类零行为变化；normal 标签改「普通点位（低活跃 / 未进活跃度类型）」；线值=Jev 参考线直译（标定 1361 标签信号三类一致 ~61%，详见类型注释）。PT52=T239 四修回滚（2026-11-25 用户裁定「回滚吧」——chg30≤30+反磨顶门引擎对拍 bt-v281 v33 vs bt-v278 v30：246 票 +3.6771→191 票 +0.2913 = Δ −3.3859 否决；扫描预测 +0.70 失准的机制=门在腿条件上推迟触发点而非删除杀集——快涨期 chg30 恒 >30 的票唯一达标时刻其它键已出窗被永久错过〔SI +0.44/SIGIL +0.23/heyi.ai +0.22/AID +0.21 等合计 +2.7 被切〕+时序扰动新买 35 张负票 ≈−1.2；case 目标虽打中〔大小姐/老板发财/빵쏭 被切〕但代价不可接受；**教训：门效果预测必须引擎级 A/B，fire 点扫描只可粗筛**——PT47/PT48 的引擎 A/B 流程正确、PT49 扫描预测流程翻车） // PT51=T239 四修 G1 暴起门+G4b 反磨顶门（2026-11-25 用户裁定「好，那就这么搞吧」——纯数据优化收刀：chg30Pct≤30〔单变量扫线最优净 +0.262，防冷寂后单 slot 暴起——大小姐 31.4/Kedaengee 64.9 案源；5s 窗实测杀 SI 级大赢家不可用〕+(secSincePeak<15 OR mcapFromPeakPct>10)〔反贴峰久磨，合取净 +0.364——OAO/빵쏭/HSI6900 案源；深回调豁免臂保股城/彪弟〕；两刀杀集重叠小合计 +0.70；⚠案号说明：PT49/PT50 已被并行会话 T240 做市类型二修/三修占用，本条目四修编号顺延 PT51） // PT50=T240 做市类型翻 active:true（2026-11-25 用户裁定「翻 active:true 直接对拍」——bt-v263 实证 v2 识别层兑现：17 fire 含 6 张闪电票全在深砸谷内〔MINI CAO 20:54:54 谷底 curVs=114〕，全被 FP 门拦=全豁 policy 理由逐条实证；翻 true 后全豁实买，bt-v264 对拍 bt-v263 逐票看增量） // PT49=T240 做市类型二修（2026-11-25 用户裁定「使用 curVs，阈值可以调整，但 earlyReturn 的定价太依赖首次购买的额度，可以作为辅助」：价格域改 curVs≤200 主键+earlyReturn≤30 辅助臂——v1=120 实测 bt-v262 闪电票零 fire〔引擎口径坑谷+回测 debounce 200ms 网格双夹击下单 tick 通过窗撞不上〕，组合扫描 200/30 档召回 7 张闪电票且假阳性面 10 最小；案号订正 T237→T240〔T237 已被 Jev 因子化四题占用〕） // PT48=T237 新类型 market_maker_rhythm_pit（2026-11-25 用户提案「做市痕迹票：有庄在搞事，一般来讲会很强势」——金狗集合做市/操控 32 票实证：24 张闪电毕业票 flap 生命 9~72s〔graduation 事件实证〕，节奏三指标与对照干净分离〔tps 中位 2.47 vs 0.57/blkCov 81% vs 17%/gapLe1 95.1% vs 61.2%〕；识别键=tradesPerSecSinceLaunch+blockGapLe1Pct64〔T237 新 FA 键〕；入场价格用户裁定「那就取 120% 试试」〔curVs≤120，坑=拉盘中途深砸 mcapFromPeakPct≥30〕；龄窗 3-60s〔超快票 live 物理接不住，用户裁定「可以不跟」〕；active:false 迭代期，bt 对拍后翻 true 时 bump） // PT47=T239 二修 act30s 上限 3.9→1.9（2026-11-25 用户裁定「砍吧」——24h 全局窗口 bt-v269 档层实证：act30s [2,3.9) 档 23 票合计 −0.721/正票率仅 17.4%（高流量=出货段形状，fire 后多断流被 stallClose 清仓）；用户逐票翻信号页后裁；线取 1.9 非 2.0=类整数线纪律〔0.2→0.19 同族〕，[1.9,2) 实测仅 2 票均非赢家零成本；代价=切 [2,3.9) 档 4 个正票〔케로로 +0.016/코하쿠 +0.055/放屁车 +0.070/진로 두꺼비 +0.165〕知情接受） // PT46=T238 famous_participation_pit 九修：破发豁免臂（2026-11-25 用户裁定「破发豁免吧」）：斜率门加 OR launchMinVsFloorPct < 5——binance 案〔触发@40s 评估时历史最低 vs 地板=+4.22 尚未破发〔键值正确——77s 才砸到 −7.2% 真破发，在触发点之后〕；线 <5=近破发线恰好兜住 40s 点；代价=奶龙中央大学 0 也放行〔漏 1 张 −17% 负票，净账仍正〕；币安之夜 6.95/Fora 8.24/开源圣人 17.45 在首点位仍拦〔其更晚深砸真破发后经本臂换点位重触发〕〕；⚠过程修正：首轮误诊「BNB 域汇率抹平破发」不成立——键无失真，40s 的 +4.22 是时间线真相〔破发在触发后〕 // PT45=T238 famous_participation_pit 八修：陡升+famous 主导豁免组合（2026-11-25 用户裁定「只控拉升斜率」+「可以，就这么落」）：新键 max5sRisePct（5s 窗历史最大涨幅单调 max）+famousEarlyBuySharePct（前 10s famous 买占比）——条件加 (max5sRisePct <= 50 OR famousEarlyBuySharePct >= 30)：开源圣人案 2s +74% 垂直拉∧famous 仅占 30%→拦；来财案 2s +109% 更陡但 famous 占 66%=famous 承认的拉升→放（纯斜率线会先误伤案源——「谁在拉」是真分界）；小狗山 15s +52% 渐进不触发 ✓；Fora/币安之夜 斜率缓不触发（其做市/阴跌判据仍暂缓） // PT44=T238 famous_participation_pit 七修：龄上界 900→300 + 买量下界 buyVolumeBnb≥3（2026-11-25 用户裁定双线「可以」）：①龄上界 300——「famous/聪明钱承认的票回调低点入场，不是吃最后的尾气」（用户原话），24h 扫描 11 票触发分布 24~802s，远尾 KOK 377s〔fwd −6%〕/코하쿠 802s〔fwd −19%〕两负票被砍零误伤，金狗 5 票全 ≤101s 不受影响；②buyVolumeBnb≥3——「没有多少交易量的形态也要拒绝掉」（PinkCare 案：触发@28s buyVol=2.42/trades=19 死盘形状，案源最低小狗山 4.26，2.42~4.26 空档 1.8B 线干净）；⚠快速到峰卸货判据（Fora 案：34s 内 143 行/51 块/ath 182 早期到峰+回撤 54.6%）**暂缓**——用户观察「小狗山 24s 触发 ath 72.6 也是早期快速小峰，到峰速度阈值不好定」，待宽度控制议题一并设计 // PT43=T238 famous_participation_pit 六修：N=2 时 smart 参与众豁免（2026-11-25 用户裁定「N 为 2 的话，看看聪明钱的购买数量，如果超过 2，也可以豁免」）：新键 smartLifetimeBuyN（smart 名单全史参与钱包数，同 famousLifetimeBuyN 口径）——N 必要条件改 (famousLifetimeBuyN>=3 OR (famousLifetimeBuyN==2 AND smartLifetimeBuyN>=3))；小狗山案 24s 时 famous N=2 但 smart 3 钱包已参与（15s 0x1c2b/0x2993/0x8866）→ 解锁；famous=1 不豁免（用户未裁定） // PT42=T238 famous_participation_pit 五修：famous 参与钱包数下界 N≥3 必要条件（2026-11-25 用户纠正「为什么没有限制 famous 的参与者数量？我应该是要求至少为 3 个」——PT37 初版设计遗漏：只放了金额线 0.5B〔沿用 T234 BuyBnb 线〕，N 线仅 PT39 豁免臂〔N≥5〕无下界门槛，T234 conviction 的 N≥3 同款线未移植）：famousLifetimeBuyN>=3 加为必要条件——24h 扫描 74 命中票 N 分布 46/24/3/1，N≥3 收窄到 4 票〔彪弟 N=5 +9.23/binance N=3 +0.555/2 负〕；代价=bibi N=1 右尾票〔f600 +3.84〕被砍+小狗山召回点 24s→31s〔N=2→3，31s 锚 tick 买入仍召回〕+changpengzhao/Pepina 等 N=1/2 右尾被砍——知情接受；5 票专题来财/彪弟/ChillGuy N 均 ≥3 不受影响 // PT41=T239 新类型 steady_trend_climb（2026-11-25 用户提案「金狗『上涨趋势形成后一直拉盘』『散户慢速拉升盘』两分类单独成立一个 pointType」+四项裁定：①价格域最多接受 +80%「先看召回」②斜率带 5~60+act30s≤3.9 双管③policy 先全豁再收紧④前期暴拉断点先跑分布——分布实证无分离度刻意不加；新键 priceMa60SlopePct=MA60 均线 60s 地平线涨跌 %，用户方法「均值回归线往上，拒绝太陡峭也拒绝太平」；182 校准 48 目标票召回 14〔80 档窗口 95% 30min 内翻倍、反例渗透 1/17〕；详见类型注释与交易台账 T239） // PT40=ath 150→200 + 龄下界 30→20（2026-11-25 用户裁定双线放宽）：①ath 线（T234 用户裁 150「保守一点」）抬回 200——ChillGuy 案 190.65 深坑回撤到 +19.9% 价格到位但被 150 拦（用户判据「最高点并不算高；刚放出来暴涨到很高点位才危险」——190 vs 小狗山 580/超汪汪队 357 的分界，200 抬线解锁 ChillGuy 且两票仍拦）；用户预告「涨太高就有死盘，之后还要加宽度控制」留档；②龄下界 30→20——小狗山案 24s 点全过只挂龄（famous 参与 0.554B 已达标+锚 15s 买 0.277B 买盘在场，30s 等待纯误伤；24s 买入后 ath 580=+680%）；15s 抢速门基线不碰（T135 age<15 bot 抢速盘） // PT39=famous 参与众豁免锚买盘门（2026-11-25 用户裁定「豁免 famous 特别多的（5 个或以上）」+「可能过拟合，如果之后发现问题再回退」——知情接受）：新键 famousLifetimeBuyN（famous 全史参与钱包数）≥5 时锚买盘门豁免（famous 众多=最强买盘确认，比等一笔 0.03B 买单强；彪弟案 6 F 钱包快进快出+86s 死寂点锚前 15s 无买=锚门挡死，但 famous 众背书下死寂点是拉盘方起点非死盘）；豁免臂只开锚门（ath 150 线/域/龄等照判） // PT38=famous_departure_pit 二修改名 famous_participation_pit + 删离场门（2026-11-25 用户裁定「那就不要要求非要完全离场。其实如果价格降低到位了，没有离场有什么关系？famous 持有并不是坏事」）：famousCopyWalletCircPct<=1 离场门整段删除——famous 在场持有=背书而非风险（JG-43 补的否证面是「famous 在场作为活跃度豁免的宽口径」，本类型窄口径=参与痕迹+坑位域+反弹确认三锚，坑位域已挡追高）；id 改名审计维度 bump（PT14 先例）；famousLifetimeBuyBnb>=0.5 自身即防「从未参与」票（0 恒 false），离场门删除后联立必要性消失语义安全 // PT37=famous_departure_pit 新类型（2026-11-25 用户裁定「增加这个新的 pointType」——金狗集合 JG 专题：5 票「希望进 famous 坑臂」召回研究归因=现有 famous 两键（净持仓在场/高位重参与）都抓不住「famous 低价参与后离场的坑」形状，新增 famousLifetimeBuyBnb 参与痕迹键；形状三锚=参与痕迹（famous 全史累计买 ≥0.5B）+已离场（famousCopyWalletCircPct ≤1 与上式联立）+坑位域（curVs 双尺/athVsFloor ≤150/mcapFromPeak ≤62）+反弹确认（锚买盘门）；案源=来财 0xc84a…7777 30s 时刻〔famous 3 钱包 1s 买 2.4B 后 4~16s 卖光、curVs=23.07、athVsFloor=148.79 贴 150 线 1.2 点、锚买盘=1，锚后 60s +103%/600s +1200%〕；专属触发腿 priority 18（p16/p17 自触发同款）——ladder 主流腿挂开盘簇门（首波 11 钱包+waves 3）30s 窗口零触发，无腿则类型空转；5 票其余 4 票（彪弟/ChillGuy/超汪汪队/小狗山）形状不符或域外刻意不召回（T210「不求召回」同款定位）；policy 全豁+stuffingOnly（用户裁定 T234 定稿同款——开场 famous 大买大卖形状 act 族必误伤，低活跃风险由三锚兜底） // PT36=类型 active 激活参数（2026-11-25 用户裁定「给 pointType 增加一个是否激活的参数，像这个还在迭代中的，激活为否，不生效」）：每类型带 active 字段，classifyPointType 跳过 active:false 类型（不命中/无 policy/无留痕），assertPointTypesValid 校验 active 必填；slow_develop_early 置 active:false——2026-11-24 OOS 裁定「这一个臂只能处于非激活状态」的延续（触发臂零引用之外，豁免层同样停用；bt-v258 24h 窗实证 37/692 信号〔5.3%，与 OOS 覆盖面同数字〕被三刀形状全豁执行，긴와 0x6862 P1·首买案）；重做三刀〔流量上界〕翻 true 时再 bump // PT35=T236 二修（2026-11-24 用户裁定「holder_quiet_unload 判它大户静默卸货、tail_no_buyer 肯定都是要豁免的，因为这是低速慢热票，其它不合理阻挡的因子门也请先豁免；cheat Jev 检测跟活跃度高的票一样，也是豁免」）：slow_develop_early policy 改全豁+塞单门 {factorCheckArms:'skip', actFront:'pass', cheatCheck:'skip', buyPoint:'stuffingOnly'}（T234 famous_conviction_pit 定稿同款——三刀形状=已验证好票背书：FP 整门直通〔慢速低活跃与 act 族/尾段/卸货臂结构性冲突，逐臂差集会漏〕/cheat 16 题跳过〔一姐案 cheat A_strong coordinated_sell_back+slow_grind_pump 双 strong 即本类型形状本征——引擎拉黑短路在门链外层保留〕/BP 只评塞单门〔BP 活跃度门对 low 形状必拦=放行链必须连坐，塞单门 BP67 明裁机械防线零成本兜底〕） // PT34=T236 新类型 slow_develop_early（2026-11-24 用户提案「前期币没涨过，慢速的相对大额交易」三刀：athVsLaunchPct<60 ∧ sinceLaunchTrades≤40 ∧ bundledAvgTradeBnb300∈[0.13,0.2)——案源 一姐 0xfc23…7777 flap 前期 avgTrade 0.189/26 笔/athVs 39.9 锚后 +499% 毕业；bt-v252 死 cheat A_strong、bt-v254 死 AF1 act=low；两窗+金狗扫描 A 面 84 票基线 中位ATH 4%/≥50% 14% → 三刀全过 22 票 中位 41%/36%〔0.15 下沿误杀 0x5731 +1016/0xbd48 +614、0.2 上沿切 0xf057 +419 留待观察；线值以 A/B 对拍校准〕；policy actFront:'pass' 只豁 AF1——慢速低活跃是形状本征非风险，cheat/BP 照走〔一姐类 A_strong 强庄签名仍拦=知情边界〕） // PT33=T234 九修：athVsFloorPct 线 200→150（用户裁定「保守一点吧」——永生 0x9f70 案：fire 时峰值=配置价 2.86 倍〔+186.15%〕未过 200 线买入后亏 −0.063，用户质疑「过了 2 倍了吧」；线 150=2.5 倍语义：w1003 切 CZCOIN +0.149/与我相关 +0.010 两赢家+永生/梅姿/MEMEROOM/人生决策/JARVIS 等亏票 −0.237 → 9 票 +0.486 vs 200 线 21 票 +0.373；金狗双案源 137.6/114.8 均在 150 内不受影响） // PT32=T234 八修：athVsFloorPct 线 140→200（用户裁定链：小赵=作弊票切掉没问题〔已由龄门 1605s>900 切〕；地板口径 20 票换算=10 票超 140 含 3 赢家〔CZCOIN 198.6/BIGNANCE 140.9/小赵 144.8〕→线 200 保全部赢家、只切加密英雄 235.4〔−0.032 亏票〕；与龄门合算=13 票 +0.606） // PT31=T234 七修：condition 加 tokenAgeSec ≤900 龄上界（2026-11-24 用户裁定「这个策略希望的是 famous 认同明确、流动性潜力没有释放的时候低价入场，肯定偏前期而不是后期」——15 分钟内；w1003 20 票龄分布：≤200s 13 票含全部大赢家〔0x28ea 66s/0x2ee9 72s/CZCOIN 115s/BIGNANCE 74s〕、891~1605s 3 票、3550~4269s 2 票、101832s 福 28h 老票；900s 切 6 票净 +0.012〔代价=切小赵 +0.033〕；金狗双案源均在 900 内不受影响） // PT30=T234 六修：ath 上限换地板口径键 athVsFloorPct（用户裁定「athVsLaunchPct 的相对价格应该跟 currentVsLaunchPct 保持一致，否则首买入价太高就会允许太高的买入点位——或者换个因子」→ 换新键：分母=与 currentVsLaunchPct 逐字同源 T139 地板，首买价太高时如实放大涨幅〔0x28ea 132.09→137.6、0x2ee9 113.92→114.8 均仍 ≤140〕；T213 athVsLaunchPct 首可靠价锚不动〔golden pit 已锁口径〕） // PT29=T234 定稿：policy buyPoint 'skip'→'stuffingOnly'（用户裁定「全豁+stuffingOnly」——塞单门 BP67 明裁机械防线零成本加回，0x28ea 塞单锚 3<8 零影响） // PT28=T234 五修：ath 上限 130→140（0x28ea 贴线误伤案：fire 时 ath=132.09——10× 金狗被 130 帽切出类型〔pt=normal 死 FP〕，2.09 点贴线正是「金额阈值不用类整数线」纪律形状；w1003 分布 130~140 区间空档〔128.36 下一位 141.37〕→抬线零新增死票、唯一新增=0x28ea） // PT27=T234 四修：policy 全豁观察版（2026-11-24 用户裁定「让这一个 pointType 豁免触发后后续的门控，然后回测观察，有一些门可能还是加回来好」：factorCheckArms:'skip'/actFront:'pass'/cheatCheck:'skip'/buyPoint:'skip'——FP 整门直通+cheat 16 题跳过〔引擎拉黑短路在门链外层保留〕+BP 整门直通；观察期形状，结束后按裁定加回或回滚） // PT26=T234 三修：①condition 加 athVsLaunchPct ≤130（2026-11-24 用户裁定「限制代币历史上涨的最大幅度——上涨幅度很大的票流动性已彻底释放、生命周期走完，期望的是小热一把后砸出来的坑」：w1003 全窗 31 类型成交票 fire 时 ath 分布=≥141 死区 16 票 −0.334〔212/190/185/177/169/167/164/163/158/153/151/149/144/141 全亏或碎亏〕vs 赢家聚集带 ≤125〔CZCOIN 122.04/躺赢人生 113.92/小赵 121.5〕；线 130=赢家留 8 点安全距、只多放 FFR/福 −0.014；0x28ea 案 fire 时 ath ~+30 不受影响）②FA 臂 A 剔除臭名昭著钱包（用户裁定「臭名昭著钱包就不算在 famous 命中数量中」：notorious 高位买不构成好票背书——a83b 案；w1003 9 票含 notorious 贡献、剔除后 8 票 N<3 失去匹配免损 +0.165、赢家与我相关 N=5→3 仍过零受损） // PT25=T234 二修：policy cheatCheck g23NoE→g23NoSlowGrind（bt-v241 实证：0x2ee9/0x28ea 两票全被 slowGrindPump=3 唯一 strong 进 A 主判拒 grade=cheat——famous 带量入场形状天然触发 slowGrindPump，黄金坑 g23NoSlowGrind 差集案源 0xa04ee1 同款形状；g23NoSlowGrind=A 主判排 slowGrindPump+去 E 通道两件套正合本类型，差集选型错误修正） // PT24=T234 famous_conviction_pit 新类型（2026-11-24 用户提案「famous/聪明钱强认同健康盘深坑」+裁定：臂 A famous∪smart 高位重参与〔买时 curVs≥+40%、单笔≥0.02B、累计≥0.5B、≥3 钱包〕+深回撤低位坑〔域保留：不开更高 curVs 阈、亏损有限〕+反弹确认+同块跟单≤8 宽松形状门；policy 全套豁免：FP cheatOnly+arb_bot_holdings 豁免〔0x2ee9 死因臂〕/AF1 pass/cheat g23NoE/BP stuffingOnly；案源=躺赢人生 0x2ee9…7777 两信号死 AF1 act_front_low+T198b，锚后 6.9×；四窗探针：域内池臂 A n=333 ge2x 6.9% vs 基线 4.8%、end60mean 1.040 vs 0.995；JG-40「买过」口径否证面由坑底+反弹确认+低位域三锚兜底；域外高 curVs 形状刻意不做〔用户裁定〕） // PT23=T232 补 3 差额键换买侧口径（2026-11-24 用户裁定「是不是区分一下买卖行为」：fire 前 (15,60]/(60,90] 段只计**买入**——MOYNOK 带 0.1022 全为上一波离场卖=坑位回撤本身不该拦，0x4509 带卖 0.25 同族；买侧两案源都=0 零影响；线 0.15/0.12 避开 0.1 类整数） // PT22=T232 补 2 90Ex60 0.1→0.12（bt-v239 回测误伤 MOYNOK 0xc66b：fire 前 60~90s 带 0.1022 全为上一波离场卖单〔rel −71/−69/−67s 三笔 0.0955/0.0051/0.0015〕非热度——黄金坑形状允许的回撤卖压被差额线误拦，−0.4521；0.12 留 17% 余量，仍拦真热形状） // PT21=T232 冷窗 15s 线 0.31→0.4（2026-11-24 用户裁定放宽：0x4509…7777 fire 时刻 15:02:26.2 act15s=0.349 差 0.039——debounce fire +200ms 把 15:02:21 双胞胎离场卖 0.2506 与回场买 0.0988 同窗计入，「由冷转热第一笔买入」本身 0.0988 被离场卖污染；PT10「大于 0.31 再砍」复议兑现；嵌套约束 15s≤30s 在 0.4/0.4 处仍成立）+ 差额上界两线（2026-11-24 用户裁定「act15s 比较大的时候 60s 跟 15s 的差额要控制」→ 60Ex15≤0.15；「应该是还有个 90s」→ 新键 90Ex60≤0.1——火起前一分半都基本冷；MOYNOK 60Ex15=0.108/90Ex60=0、0x4509 两差额=0 零误伤） // PT20=T231 龄上界撤除（2026-11-24 用户裁定「年龄没必要要求小于 900——这个模式空窗期时间长一些根本没关系」：0x4509…7777 案 12 分 10 秒断流把 famous 双胞胎回场推到 910s——窗口关闭后 10 秒错过的黄金坑形状；剩余龄约束=买量带 [4,15B] 事实封顶；同轮 FA 侧 bigBuyerCohortMinBnb 0.2→0.19 类整数线 GAS 裁定） // PT19=T225 五修：condition 加 quietSurgeSellBnb≤0.05（ZEC 0x5bd4…7777 案用户裁定「同一个 slot 上绑着卖出（对倒交易）这种形态应该被拦截」——fire@135s 同秒买 0.604∧卖 0.5084 绑定）+factorCheckArmExempt 加 oversell_residual（用户裁定「也要豁免（不豁免不合理）」） // PT18=T225 三修：condition 加 quietExitOthersBuyBnb≤0.3（用户指令「记录大户之外的总买入不能超过一个线」——湖南 0.597 闪进闪出团伙案；8 票引擎口径：毕业票 max 0.267/湖南 0.597，区间内任意线干净分）+policy factorCheckArmExempt=['fam_holding_thin']（개구리씨 毕业票被 FP3 拦 ×4 案，用户裁定豁免） // PT17=T225 独舞 policy 补 cheatCheck:'g23NoE'（E 通道差集规则集——用户裁定「这一个 pointType 豁免 act=low∧sbw=none」覆盖 AF1 与 cheat E 两道同源拒；不借 T205 全局灰度） // PT16=T225 独舞尾窗口径换 actTotalBnb60Ex15≤0.05（用户裁定 2026-11-23「一分钟活跃度等于 15 秒活跃度」——固定 180s 尾窗对短周期票〔개구리씨 0.1175〕把开盘老买入盖成跟进假阳性；8 票验证 LAB/개구리씨=0、ZEC 1.37 被切、湖南/Willow 等 5 死盘临门段亦 0=死透非胜负手由门链接力筛） // PT15=T225 新类型 strongbacker_solo_dance（用户裁定 2026-11-23「这一个 pointType 豁免 act=low∧sbw=none」）：独舞形态八键（出口快照四键+四件套）+policy={actFront:'pass'} 只豁 AF1（cheat/BP 照走）——bt-v217 实证 LAB 腿触发+FP 过后唯一卡点=AF1 reject_low（T210 stall_restart 同款结构性冲突：死而复生形状锚前窗天然低活跃） // PT14=T224 类型 id 改名（用户裁定「retail_golden_pit 这个名字太泛了」）：retail_golden_pit → famous_holder_cold_pit（label 六要素的 id 化：famous 入场背书+大户在场+冷寂考验+低价坑；「有买入」=机制、「二波潜力」=目标不入 id）——policy/condition 零变化，id 为审计维度 bump // PT13=T223 补 4 curVs 硬上限 33.5（用户裁定 2026-11-23「无论 earlyReturn 多少，curVs 最高 33.5」：挡 0x2c3fdb 94.12/0x94c3cd 38.11 极端背离票——首价尺低但地板尺已拉到天；MOYNOK 30.13 留 3.4 余量，v214 触发面其余全 ≤29.4 零误伤） // PT12=T223 补 3 价格域双尺 OR 线值修正（用户裁定 2026-11-23「那就 earlyReturn < 15」：v16 线 5 实测差 3.2 点——MOYNOK 波首笔引擎真值 earlyReturn=+8.2%〔flap 非 BNB quote 盘换算后口径，−0.9 系我方 quote 域价直除错算〕、地板尺 30.13，两尺背离 22 点；由冷转热第一笔像样买盘不该被地板尺拦） // PT11=T223 补 2 价格域双尺 OR（用户裁定 2026-11-23「给 currentVsLaunchPct 条件增加一个或，如果 earlyReturn 小于 5% 也可以」：地板尺 ≤28.5 ∨ 首价尺 <5——MOYNOK 波首笔案首版线值） // PT10=T223 补 冷窗线放宽（用户裁定 2026-11-23「15 秒窗大于 0.31 再砍好了——由冷转热的第一笔买入可能比较大，如果大的话反而好」+「30 秒窗也得稍微变大一点」：15s 0.12→0.31 / 30s 0.25→0.4——MOYNOK 波首笔 0.13 近失案；嵌套约束 15s≤30s 窗值恒成立故 30s 必须同抬且留余量；60s 0.5/90s 1.0 不动） // PT9=T223 锚点买盘存在门（用户提案「买入点是个买入 或 15s 内有 ≥0.03B 买→死寂不回弹概率大降」+「所有后面要上涨的币都需要有买入」——死寂点不买、等第一笔像样买盘落地〔被挡票更晚点位重 fire=反弹确认等价形式〕；线值用户裁 2026-11-23） // PT8=T222 臭名昭著钱包门 notoriousWalletCircPct≤30（用户点名 bf00 大割「真的用户看到就想躲」；线值用户裁定 2026-11-23：拦 0x37d131 38.9/0xfc305b 43.2/0xcc6b2e 50.3 垄断档，MOYNOK 18.7 距线 11 点安全）+T221 跟单键改全生命周期单调 max 语义（0x2a05 簇 t+23s/fire t+411s 读环剪掉案；≤8 线值不变） // PT7=90s 冷窗 ≤1.0（用户裁定 2026-11-23「是否 1.5 分钟好一些」→选 ≤1.0——0x53691a 盘子刚冷一分钟不够，冷窗扩到 90s 线放宽到 1.0 避过杀正票）+ famous 跟单拥挤门 ≤8（用户裁定「跟单算 famous 买入后 1-2 个 slot」——0x2a05 同块 16 钱包挤爆案，MOYNOK 买点前 4/金鲨号 0 分界） // PT6=v11 冷窗线值收紧（15s≤0.12/30s≤0.25/60s≤0.5——用户裁定「15 秒没有什么特殊的，1 分钟内都要低」；杀 0xa04ee1 类退潮热买） // PT4=v8 裁定 arb_bot_holdings 臂豁免真正落地（PT3 时期该豁免只存在于 commit 信息未写入文件——bt-v202 0xd64e 仍被拦实锤；教训二连：线值改动必须写完跑测试断言全 policy）；PT3=龄 160-900/famous 帽撤除

/** 类型注册表（有序=优先级阶梯，首匹配胜出；normal 兜底恒在末位） */
const POINT_TYPES = [
    {
        id: 'famous_holder_cold_pit',
        active: true,
        label: 'Famous入场-大户在场-长时间冷寂-有买入的低价坑-二波潜力币',
        // 迁自 T213b retail-good-path-v1 包 gatePolicy（用户裁定 2026-11-23 迁入模块
        // 作首个类型）：正常对倒票第一小波（ATH 1.4-2.0x）回撤 30-50% 后的域内坑位
        // （首价尺 ≤+28.5%），量 4-15B，≥3 尘线大买家在场 + famous 持有。
        // 与 retail-good-path-v1 买腿条件同款但独立维护（腿=何时触发，类型=触发后
        // 怎么走门——两者演化节奏不同）。
        condition: 'tokenAgeSec >= 160 AND buyVolumeBnb >= 4 AND buyVolumeBnb <= 15 AND (currentVsLaunchPct <= 28.5 OR earlyReturn < 15) AND currentVsLaunchPct <= 33.5 '
            + 'AND athVsLaunchPct >= 40 AND athVsLaunchPct <= 100 '
            + 'AND mcapFromPeakPct <= 50 '
            + 'AND bigBuyersCount >= 3 AND bigBuyersHeldDust >= 3 AND famousCopyWalletCircPct > 0 '
            + 'AND actTotalBnb15s <= 0.4 AND actTotalBnb30s <= 0.4 AND actTotalBnb60s <= 0.5 '
            + 'AND actTotalBnb90s <= 1.0 AND actTotalBnb60Ex15Buy <= 0.15 AND actTotalBnb90Ex60Buy <= 0.12 AND famousFollowSlotMaxWallets <= 8 '
            + 'AND notoriousWalletCircPct <= 30 '
            + 'AND (anchorTickIsBuy == 1 OR anchor15sMaxBuyBnb >= 0.03)',
        // T217：cheatCheck 规则集差集（g23NoSlowGrind=A 主判排除 slow_grind_pump+去 E
        // 通道——案源 0xa04ee1ed：唯一 strong=slowGrindPump、famous 在场自然带量入场、
        // max60 9.11x 错过）；FP 同形状臂差集（slow_pump_unload=FP8a 慢拉卸货）
        policy: {
          factorCheckArms: 'cheatOnly',
          factorCheckArmExempt: ['slow_pump_unload', 'arb_bot_holdings'],
          actFront: 'pass',
          cheatCheck: 'g23NoSlowGrind',
          buyPoint: 'stuffingOnly',
        },
    },
    // ── 未来类型占位（v1 不实现，追加时 bump POINT_TYPE_VERSION）──
    // 'strongbacker_egg'   强庄币雏形：已立（T225，见上 strongbacker_solo_dance）
    // 'strongbacker_pump'  强庄币拉盘前期形态：……
    {
        id: 'strongbacker_solo_dance',
        active: true,
        label: '一个钱包的独舞：独自持大仓不全卖出的强庄爆拉币',
        // T225（2026-11-23 用户时序版，LAB 0x1a08…7777 案）：「开盘大户小户买→大户
        // 小户卖→(大户留仓)沉寂→拉盘；盘面干净=卖出潮后无新资金跟进」。八键与
        // solodance-test-v1 包独舞买腿同串独立维护（腿=何时触发、类型=触发后怎么走门）。
        // 快照四键=出口时刻（≥60s 静默定格，上界=定格前一笔）：
        //   quietExitBigBuyers==1 活跃窗(600s)唯一大户（累计买 ≥0.3B 钱包数；
        //     ZKind 1.47B 持续接力盘被切）；quietExitLatchHoldPct>0 大户留仓
        //   （LAB 出口 39.85%——清仓型 Fomies 被切）；quietExitEndWithSell==1 卖收尾
        //   （从未活过的死票被切）；quietExitTailBuyBnbEx<=0.1 尾窗(180s)新买剔
        //   latch 自买（LAB=0 死透；湖南/ZEC/Willow 0.3~1.5 持续跟进被切）
        // 门控豁免语义（用户裁定 2026-11-23「这一个 pointType 豁免 act=low∧sbw=none」）：
        //   actFront:'pass'=AF1 直通——独舞形状的信号锚前 60s 窗天然是死寂+重启首波
        //   （几笔），act=low∧sbw=none 是必然而非风险信号（bt-v217 实证：LAB 腿触发
        //   +FP 过后唯一卡点=AF1 reject_low，T210 stall_restart 同款结构性冲突）；
        //   cheat 16 题与 BP 门**照走**——强庄盘的性质由 cheat 门说话，豁免面刻意只到 AF1。
        condition: 'quietSpanMs >= 60000 AND quietSurgeBuyBnb >= 0.4 AND quietSurgeSec <= 30 '
            + 'AND quietExitVsLaunchPct >= 0 AND quietExitVsLaunchPct <= 28.5 '
            + 'AND currentVsLaunchPct > 0 AND currentVsLaunchPct <= 28.5 '
            + 'AND quietExitBigBuyers == 1 AND quietExitLatchHoldPct > 0 '
            + 'AND quietExitEndWithSell == 1 AND actTotalBnb60Ex15 <= 0.05 AND quietExitOthersBuyBnb <= 0.3 AND quietSurgeSellBnb <= 0.05 '
            + 'AND actTotalBnb >= 0.1 AND tokenAgeSec >= 15 '
            + 'AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 '
            + 'AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0',
        policy: {
          actFront: 'pass',
          // T225 二修（用户裁定「聚焦当前方案」，2026-11-23）：E 通道差集规则集
          // g23NoE——豁免封装在本类型 policy（非全局灰度/非 T205 岔路）；A/L/M/N
          // 真作弊通道照判
          cheatCheck: 'g23NoE',
          // T225 三修（用户裁定 2026-11-23「豁免 fam_holding_thin」）：FP 臂差集——
          // 개구리씨 案（毕业票被 FP3 famous 持仓薄臂拦 ×4：独舞形状无 famous 持仓
          // 是常态非风险）；其余 FP 臂（act 族/oversell/对倒族）照判
          factorCheckArmExempt: ['fam_holding_thin', 'oversell_residual'],
          // T225 五修（用户裁定「oversell_residual 也要豁免（不豁免不合理）」）：残局
          // 形状与独舞语义不冲突——庄出货的一部分；ZEC 真正该拦的是同 slot 对倒
          // （quietSurgeSellBnb≤0.05 承接）
        },
    },
    {
        id: 'famous_conviction_pit',
        active: true,
        label: 'Famous/聪明钱高位重参与-深回撤低位坑-反弹确认-二波潜力币',
        // T234（2026-11-24 用户提案「famous/聪明钱强认同健康盘深坑」+裁定）：案源
        // 躺赢人生 0x2ee9…7777——famous 首波高位买入（curVs +64~85%）快速翻手砸坑
        // → 坑底（域内 +28%、坑深 −40%）P1 首买信号 fire → 死 AF1 act_front_low
        // +T198b arbBot 臂，锚后 6.9×。形状三锚：臂 A 高位重参与（买时 curVs≥+40%、
        // 单笔 ≥0.02B、累计 ≥0.5B、≥3 钱包——用户裁定「参与要重」；「买过」口径与
        // JG-40 否证面的分野=坑底+反弹确认+低位域三锚）+ 深坑（拉到 ≥2× 后回撤
        // ≥38%）+ 反弹确认（PT9 锚买盘门）。域裁定（用户原话「不开当前VsLaunchPct
        // 的更高购买阈，确认买在低位，即使亏损也是有限亏损」）：低位域保留（黄金坑
        // PT23 双尺同款），域外高 curVs 坑刻意不做（亏损无界；四窗探针域外池 stall
        // 出血 46%）。跟单门（用户裁定「famous 跟单一般看同区块…尤其是同区块」）=
        // 同块语义 famousFollowBlockMaxWallets ≤8 宽松形状门（域内池线扫中性——
        // 形状定义非胜负手；0x2ee9 同块 max=3，2s 口径 14 是顶部追高段跟单）。
        // 域内池臂 A 探针：n=333 ge2x 6.9% vs 基线 4.8%、end60mean 1.040 vs 0.995。
        // policy 全套豁免（用户裁定）：FP cheatOnly（+slow_pump_unload/arb_bot_holdings
        // 臂豁免——后者=案源死因臂，T198b 流通腿之外的兜底）、AF1 pass（坑时活跃度
        // 天然低=结构性必死）、cheat g23NoSlowGrind（A 主判排 slow_grind_pump+去 E
        // 通道——famous 带量入场天然触发 slowGrindPump 假阳性〔0xa04ee1/0x2ee9 同款〕
        // 且 act=low∧sbw=none 结构性必死；A 其余通道/L/M/N 照判）、BP stuffingOnly
        // （点位评判全豁只留塞单门）。
        condition: 'tokenAgeSec >= 60 AND tokenAgeSec <= 900 '
            + 'AND mcapFromPeakPct <= 62 '
            + 'AND athVsFloorPct <= 150 '
            + 'AND (currentVsLaunchPct <= 28.5 OR earlyReturn < 15) AND currentVsLaunchPct <= 33.5 '
            + 'AND famousSmartHighBuyBnb >= 0.5 AND famousSmartHighBuyN >= 3 '
            + 'AND famousFollowBlockMaxWallets <= 8 '
            + 'AND (anchorTickIsBuy == 1 OR anchor15sMaxBuyBnb >= 0.03)',
        // T234 定稿 policy（2026-11-24 用户裁定「全豁+stuffingOnly」）：famous/聪明钱
        // 重参与=已验证好票背书 → FP 整门直通 / AF1 直通 / cheat 16 题跳过（引擎
        // 拉黑短路在门链外层保留）/ BP 只评塞单门（BP67 用户明裁机械防线零成本兜底
        // ——0x28ea 塞单锚 3<8 不拦兑现票）。逐门估价（w1003+金狗）：cheat 等额簇
        // 通道本样本该豁（拦 kroea 免损 +0.017 vs 拦 0x28ea 错失 +0.134 净 −0.117，
        // 假阳性已被 ath≤140+notorious 剔除收紧吸收）；FP dump 族噪声级（净 ≈−0.03）；
        // 生产/新窗若见等额簇死票成群再议 cheat 差集加回（g23NoEql）。
        policy: {
          factorCheckArms: 'skip',
          actFront: 'pass',
          cheatCheck: 'skip',
          buyPoint: 'stuffingOnly',
        },
    },
    {
        id: 'famous_participation_pit',
        active: true,
        label: 'Famous参与-坑位-反弹确认-二波潜力币',
        // T238（2026-11-25 用户裁定「增加这个新的 pointType」）：金狗集合 JG 专题
        // 5 票「希望进 famous 坑臂」召回研究归因——现有 famous 两键抓不住本形状：
        // famousCopyWalletCircPct（净持仓在场）对「快进快出后离场」恒 0、
        // famousSmartHighBuyBnb/N（买时 curVs≥40% 高位重参与）对「低价段参与」恒 0。
        // 案源=来财 0xc84a…7777（用户标签「famous 离场形成黄金坑+冷却后启动」）：
        // famous 3 钱包 1s 内买 2.4B、4~16s 卖光（快进快出离场）→ 39~42s 坑位
        // 窗口（curVs=26.6/athVsFloor=148.79 贴 150 线 1.2 点/mcapFromPeak=50.5/
        // 锚买盘=1/followBlock=2）→ 锚后 60s +103%/600s +1200%。对拍 bt-v262
        // +1.2966 案源完整兑现（39.2s p18 fire→+648%），SI −0.0013 全豁代价首证。
        // **PT38 二修（2026-11-25 用户裁定「那就不要要求非要完全离场。其实如果
        // 价格降低到位了，没有离场有什么关系？famous 持有并不是坏事」）**：离场门
        // famousCopyWalletCircPct<=1 整段删除——famous 在场持有=背书（JG-43 补的
        // 否证面是「famous 在场作为活跃度豁免的宽口径」，本类型窄口径=参与痕迹+
        // 坑位域+反弹确认三锚，坑位域已挡追高）；id 改名 famous_participation_pit
        // （departure=离场不再贴切，审计维度 bump PT14 先例）。famousLifetimeBuyBnb
        // >=0.5 自身即防「从未参与」票（0 恒 false），联立必要性消失语义安全。
        // **PT39 三修（2026-11-25 用户裁定「豁免 famous 特别多的（5 个或以上）」+
        // 「可能过拟合，如果之后发现问题再回退」——知情接受）**：锚买盘门加 famous
        // 参与众豁免臂——famousLifetimeBuyN≥5 时锚门豁免（famous 众多=最强买盘确认，
        // 比等一笔 0.03B 买单强）。彪弟案：6 F 钱包快进快出、86s 死寂点锚前 15s
        // 无买（0.002<0.03）被锚门挡死——但 5 famous 参与背书下，死寂点是拉盘方
        // 起点而非死盘（锚后 100s +244%/600s +1195%）；T210 stall-restart 同款
        // 结构（信号在静默后首笔 tick 触发，锚前窗天然空）。豁免臂只开锚门
        // （ath 150 线/域/龄等照判——ChillGuy 4 F 钱包<5 不豁免仍挂 ath 线）。
        // **PT40 四修（2026-11-25 用户裁定「都执行」——ath 150→200+龄下界 30→20）**：
        // ①ath 线抬 200：ChillGuy 案 190.65（30s 已 +152%、70s 封顶 190.65——「刚
        // 放出来快速涨但高度不算高」形状）深坑回撤到 +19.9% 价格到位被 150 拦；
        // 用户判据「最高点并不算高；刚放出来暴涨到很高点位（过热/被操盘）才危险」
        // ——200 抬线解锁 ChillGuy，小狗山 580/超汪汪队 357 仍拦；用户预告「涨太高
        // 就有死盘，之后还要加宽度控制」留档。②龄下界 20：小狗山 24s 点全过只挂
        // 龄 30（famous 0.554B 达标+锚 15s 买 0.277B 在场，30s 等待纯误伤；24s
        // 买入后 ath 580=+680%）；15s 抢速门不碰。
        // 形状三锚：①参与痕迹 famousLifetimeBuyBnb ≥0.5B（famous 名单全史累计
        // 买入额，单调「参与过」口径——famous 参与过的盘，离场=坑更干净、在场=
        // 持有背书，两可）②坑位域（curVs 双尺 + athVsFloor ≤200 + mcapFromPeak
        // ≤62，T234 同款线〔ath 线 PT40 抬〕）③反弹确认（PT9 锚买盘门）+ 同块
        // 跟单 ≤8 宽松形状门。
        // 刻意不放 act 冷窗族——开场 famous 大买大卖形状本征 act 窗必高（来财 30s
        // act30s=13.4），低活跃风险由 policy actFront pass + 三锚兜底。刻意不召回
        // 域外/超涨票（超汪汪队 curVs 最低 36.8 域外、ath 357 超线，T210
        // 「给一个好票模式一条通路，不求召回」同款定位）。
        condition: 'tokenAgeSec >= 20 AND tokenAgeSec <= 300 '
            + 'AND buyVolumeBnb >= 3 '
            + 'AND athVsFloorPct <= 200 '
            + 'AND mcapFromPeakPct <= 62 '
            + 'AND (currentVsLaunchPct <= 28.5 OR earlyReturn < 15) AND currentVsLaunchPct <= 33.5 '
            + 'AND famousLifetimeBuyBnb >= 0.5 '
            + 'AND (max5sRisePct <= 50 OR famousEarlyBuySharePct >= 30 OR launchMinVsFloorPct < 5) '
            + 'AND (famousLifetimeBuyN >= 3 OR (famousLifetimeBuyN == 2 AND smartLifetimeBuyN >= 3)) '
            + 'AND famousFollowBlockMaxWallets <= 8 '
            + 'AND (famousLifetimeBuyN >= 5 OR anchorTickIsBuy == 1 OR anchor15sMaxBuyBnb >= 0.03)',
        // T234 定稿同款全豁+stuffingOnly（用户裁定 2026-11-25）：famous 离场砸盘
        // 形状天然触发 FP dump 族与 cheat slowGrind 假阳性，且 act 族臂对开场
        // famous 大买大卖必误伤——全豁观察版起步，对拍后按数据收（T234 PT27→
        // PT29 同路径）。引擎拉黑短路在门链外层保留；BP67 塞单门零成本兜底。
        policy: {
          factorCheckArms: 'skip',
          actFront: 'pass',
          cheatCheck: 'skip',
          buyPoint: 'stuffingOnly',
        },
    },
    {
        id: 'steady_trend_climb',
        active: true,
        label: '趋势成形-中低速持续拉盘-低位域入场-持续上涨币',
        // T239（2026-11-25 用户提案「金狗『上涨趋势形成后一直拉盘』『散户慢速拉升盘』
        // 两分类单独成立一个 pointType」+四项裁定）：形状=酝酿后趋势成形、以中低速
        // 持续拉盘、位低价域（用户裁定「最多接受上涨 80% 的点位，先看看召回」）。
        // 用户方法（原话观察）「价格均值回归线，线是否往上（拒绝太陡峭的向上，也
        // 拒绝太平）」→ MA60 斜率带 [5,60] %/60s（新键 priceMa60SlopePct）+ 30s
        // 总流量帽 actTotalBnb30s≤3.9（类整数线纪律 4→3.9——垂直发射段买量 5~19
        // 全切、Percy 峰值 6.3 切尾段点知情接受；用户裁定「双管」）。
        // 182 校准（48 目标票 × 17 反例，case_ticks 5s 网格）：域 30-80/斜率带/双管
        // 下召回 14/48（29%）——窗口 +300s 中位 2.00x、30min 内 ≥2x 95%、反例渗透
        // 仅 1/17（BNB͏ 0xf8ab 同带黄金坑标签）；cap 扫描 120/150/200/300/500 =
        // 召回 18/20/23/26/29 渗透 6/8/11/13/15（80 档后每抬档窗口质量缓降）。
        // **PT47 二修（2026-11-25 用户裁定「砍吧」）**：act30s 上限 3.9→1.9——
        // 24h 全局窗口 bt-v269 档层实证 [2,3.9) 档 23 票 −0.721/正票率 17.4%
        // （高流量=出货段形状）；1.9=类整数线纪律 2→1.9，[1.9,2) 实测 2 票均
        // 非赢家零成本；4 个正票被切知情接受。
        // **PT48 三修（2026-11-25 用户裁定「先卡 athVsFloor 小于 150」）**：
        // 案源 콕——多轮涨跌后回落点被 MA 斜率惯性误入（ath 343%）；athVsFloor
        // <150=「历史峰值未超地板 2.5 倍」与 T234/T238 宽度控制同族（T236 三刀
        // athVsLaunch<60 是更严的「没涨过」口径，本类型允许一定涨幅的持续趋势
        // 但拒绝多轮大振幅）；null=无可靠价 fail-closed 不命中。
        // **PT49 四修（2026-11-25 用户裁定「好，那就这么搞吧」）**：①chg30Pct
        // ≤30 暴起门——「趋势要摊在时间上」：真趋势 30s 匀速（SI 24.1），冷寂后
        // 单 slot 暴起 30s 总量爆表（大小姐 31.4/Kedaengee 64.9）；5s 窗实测杀
        // SI 级大赢家不可用。②反磨顶门 (secSincePeak<15 OR mcapFromPeakPct>10)
        // ——峰值必须近期（15s 内）或价格必须离峰 ≥10%（深回调=合法形状，贴峰
        // 久磨=趋势缺失）；单变量回撤下界全负=合取必要性实证。null=无可靠价
        // fail-closed。
        // 「前期暴拉断点」分布实证无分离度（目标 v60 中位 184.9 vs 反例 184.8）——
        // 80 cap 本身即抗暴拉主闸，断点刻意不加。age≥60s 替代「趋势持续」语义
        // （120s 与 curVs≤80 自相矛盾：30~80% 域窗多在前 120s，校准实证零候选窗）。
        // policy 全豁+stuffingOnly（用户裁定 2026-11-25「先全部豁免，然后再看如何
        // 收紧」）：慢速低活跃是形状本征（FP act 族/尾段/卸货臂结构性冲突，
        // T236 slow_develop_early 同款论证）；cheat 16 题跳过（slow_grind_pump 即
        // 本类型形状本征，引擎拉黑短路在门链外层保留）；BP 只评塞单门（BP67 明裁
        // 机械防线零成本兜底——T234/T236/T238 定稿同款）。
        // 排位=famous 系类型之后（famous 背书票保持更强豁免 policy 优先命中，
        // slow_develop_early 先例）。
        condition: 'tokenAgeSec >= 60 '
            + 'AND currentVsLaunchPct >= 30 AND currentVsLaunchPct <= 80 '
            + 'AND priceMa60SlopePct >= 5 AND priceMa60SlopePct <= 60 '
            + 'AND actTotalBnb30s <= 1.9 '
            + 'AND athVsFloorPct < 150',

        policy: {
          factorCheckArms: 'skip',
          actFront: 'pass',
          cheatCheck: 'skip',
          buyPoint: 'stuffingOnly',
        },
    },
    {
        id: 'slow_develop_early',
        // ★active:false = 不激活（2026-11-25 用户裁定「像这个还在迭代中的，激活为否，
        // 不生效」+2026-11-24 OOS 裁定「这一个臂只能处于非激活状态」的延续）：分类
        // 跳过（不命中/无 policy/无留痕），回落 normal 走全门链。重做三刀（流量上界
        // 约束慢速）翻 true 时 bump POINT_TYPE_VERSION。
        active: false,
        label: '缓慢发育潜力币早期点位',
        // T236（2026-11-24 用户提案「前期币没涨过，慢速的相对大额交易」三刀）：
        // 案源=一姐 0xfc23…7777（flap）——前期 75s 26 笔/tpm 20.8/捆绑 avgTrade
        // 0.189/athVs 39.9，锚后 +499% 毕业；bt-v252 死 cheat A_strong、bt-v254
        // 死 AF1 act=low。三刀（用户逐条裁定）：
        //   ①买入点位之前没涨过：athVsLaunchPct < 60（锚前最高价较发行价涨幅——
        //     「发布之后没涨过太多」；null=无可靠价 fail-closed 不命中）
        //   ②总交易数量不多（慢速）：sinceLaunchTrades ≤ 40（FA 全史总笔数新键）
        //   ③相对大额：bundledAvgTradeBnb300 ∈ [0.13, 0.2)（FA 捆绑口径新键——同块
        //     等额 ≥2 钱包并一个实体；0.15 下沿会误杀 0x5731 +1016/0xbd48 +614、
        //     0.2 上沿切 0xf057 +419——线值以 A/B 对拍校准，FA 键口径与扫描地板
        //     分母略异）
        // 两窗+金狗扫描：A 面 84 票基线 中位ATH 4%/≥50% 14% → 三刀全过 22 票
        // 中位 41%/≥50% 36%（赢家梯队 0xbd48 +614/一姐 +499/0x824c +487/0x042b
        // +146/0xe637 +98/0x8cf3 +68/0x09f0 +58/0xf6bd +56；代价 ~14 票平庸/死盘）。
        // 排位=著名类型之后（famous 背书票保持更强豁免 policy 优先命中）。
        // policy 全豁+塞单门（PT35 二修，2026-11-24 用户裁定）：三刀形状=已验证好票
        // 背书——FP 整门直通（慢速低活跃与 act 族/尾段/卸货臂结构性冲突，逐臂差集会
        // 漏：对拍 1 面上 act_near_dead/fam_holding/holder_quiet_unload 均命中过类型票）；
        // cheat 16 题跳过（一姐案 A_strong coordinated_sell_back+slow_grind_pump 即本
        // 类型形状本征=用户裁定「跟活跃度高的票一样豁免」；引擎拉黑短路在门链外层
        // 保留）；BP 只评塞单门（BP 活跃度门对 low 形状必拦=放行链必须连坐，
        // BP67 塞单门明裁机械防线零成本兜底——T234 famous_conviction_pit 定稿同款）。
        condition: 'athVsLaunchPct < 60 '
            + 'AND sinceLaunchTrades <= 40 '
            + 'AND bundledAvgTradeBnb300 >= 0.13 AND bundledAvgTradeBnb300 < 0.2',
        policy: {
            factorCheckArms: 'skip',
            actFront: 'pass',
            cheatCheck: 'skip',
            buyPoint: 'stuffingOnly',
        },
    },
    {
        id: 'market_maker_rhythm_pit',
        // ★active:true（2026-11-25 用户裁定「翻 active:true 直接对拍」——PT50）：
        // 识别层 bt-v263 已兑现（17 fire 含 6 张闪电票全在深砸谷内），翻 true 后
        // 本类型全豁 policy 生效实买；假阳性面（11 张非 MM fire）以 bt-v264 对拍
        // 逐票验证，如需收紧再 bump。
        active: true,
        label: '做市节奏盘-每块有交易-机械阶梯拉盘-中途深砸次低价坑-闪电毕业暴拉币',
        // T237（2026-11-25 用户提案「做市痕迹票：有庄在搞事，一般来讲会很强势」）：
        // 金狗集合「做市/操控痕迹」32 票实证（case_ticks + graduation 事件，182 跑）——
        // 24 张闪电毕业票：flap 生命 9~72s（MINI CAO 17s/币安生活 9s/BABYSTAR 15s），
        // 节奏三指标与对照干净分离（30min 窗中位：tps 2.47 vs 0.57、blkCov 81% vs
        // 17%、gapLe1 95.1% vs 61.2%）；早期窗（龄 3-60s fire 口径）MM 28/32 命中
        // 对照 2/14。识别键（T237 FA 新键）：
        //   tradesPerSecSinceLaunch=全史笔数÷秒龄 ≥1.5（对照最高 1.23）
        //   blockGapLe1Pct64=最近 64 tick 块间隔 ≤1 占比 ≥85（「每 block 都有交易」）
        // 入场价格（v2 二修 2026-11-25 用户裁定「使用 curVs，阈值可以调整，但
        // earlyReturn 的定价太依赖首次购买的额度，可以作为辅助」）：主价键 curVs
        // ≤200〔平台地板锚稳定；v1=120 实测 bt-v262 闪电票零 fire——组合扫描
        // 200/30 档召回 7 张闪电票且假阳性面 10 最小〕，辅助臂 earlyReturn≤30
        // 〔首价尺救援兜底，扫描实测零边际〕。坑=拉盘中途深砸（深度 ≥30% 谷后
        // 回升 ≥50% 谷深，n=166 个坑谷位分布 −34%~+527% 中位 +148%）。
        // 龄窗 3-60s：做市票 fire 窗口秒级（现行腿 15s 抢速门+价格门结构性够不着，
        // bt-v261 实证 32 票 28 张零信号）；超快票（生命 <5s）live 物理接不住，
        // 用户裁定「可以不跟」——virtual 照抓，live 认漏。
        // policy 全豁+塞单门（同 T234 定稿）：秒级生命 Jev 门物理赶不上（awaitMs
        // 15s 级 vs 坑持续 1-3s），且做市形状天然触发 wash/slow_grind 假阳性
        // （一姐案 A_strong 同款）；引擎拉黑短路在门链外层保留；塞单门 BP67
        // 明裁机械防线零成本兜底。假阳性面=非 MM 落地票（200/30 档 10 张），
        // 以回测对拍验证后定夺线值收紧；召回上限 ~10/28（币安生活/BSI 类坑浅或
        // 坑晚于 +300%——「超快拉盘票不跟」自然边界）。
        // v3 三修（2026-11-27 用户 review 全局 fire 集第一批后「先修一波」）：
        //   ①mcapFP 30→40=「价格再压」的正确实现（降 curVs 帽会切右尾 10/26，
        //     加深坑不伤金狗票——MINI CAO 64.95/BABYSTAR 63.69 全 ≥40）
        //   ②前期过热否决臂 (athVsLaunchPct<400 OR chg30Pct>20)：用户标签 10/10
        //     「前期过热/涨太高」+「已到过高点砸下来不接」；athVs 单键不分离
        //     （赢家中位 234 > 输家 132），与 chg30 联立才是「过热后无反弹」形状
        //   ③双轨 (mcapFP≥50 OR chg30≥40)：深坑企稳型（DYOR chg30=6/memeless
        //     13.7 金狗赢家）免动量要求；浅坑 40-50 需 chg30 确认
        //   ④earlyReturn≤30 辅助臂移除（扫描零边际，v2 遗留）
        //   ⑤极端热帽 actTotalBnb30s≤40（用户裁定「使用修改后的基于因子的活跃度
        //     检测部件跑一下」+「卖出的一样也要算进去」——T244 部件同款键买卖
        //     合计口径的极端尾部：≥40 的 12 张票零正零右尾；窗级帽〔act30s≤6〕
        //     经数据否决=赢家 fire 更热（actBuyBnb 4.8 vs 2.84），只有极端尾部
        //     是纯输家；每秒口径 psTotal≤5 切同族 8 张零正——线 40 覆盖且不加
        //     新键。做市票秒级生命无静默段（quietSpanMs 恒 0），「小冷却」=
        //     深坑本身（mcapFP 承载）。
        // v4 四修（2026-11-27 用户裁定趋势双线）：双轨撤销，chg30Pct≥0 ∧
        //     chg10Pct≥0 无条件——「近买点须上涨趋势否则接刀多」「10 秒趋势在坑
        //     里就等出坑再买」；出坑再买模拟（v312 成交 129 票 fire chg10<0 占
        //     114）：推迟中位 10.8s/价代价 +1.4%/正票率 +3pp/大赢家几乎无损/
        //     错过 39% 多为继续阴跌接刀票；深坑企稳型（卷王/BI/19）按用户
        //     「推迟入场」语义知情接受。
        // v5 五修（2026-11-27 用户裁定「B 吧」）：节奏键深坑冷却豁免臂——
        //     (blockGapLe1Pct64≥85 ∨ (mcapFP≥50 ∧ blockGapLe1Pct64≥75))。DYOR
        //     案：出坑再触发时刻趋势键全过、节奏键衰减到 83~84 被 85 线卡死
        //     （v4 引擎零信号——冷却段稀释 64-tick 间隔环）；深坑票「深跌冷却
        //     再启动」形状冷却段天然稀释节奏，75 线仍远高于对照 61.2。
        // v6 六修（2026-11-27 用户裁定「1 分钟/5 分钟趋势全正，拒绝接刀」+
        //     「买入点位本身是个暴跌，这也不行」）：chg5Pct≥-10 暴跌点位地板
        //     （SI −11/STAND −19 点名案；5s 严格正线太噪 20 正被切、−10 只切
        //     3 正）；chg60Pct/chg300Pct 长窗趋势新键（无前窗回落首可靠价=
        //     出生以来口径；本窗口 3-60s 恒正=惰性语义保险，扩龄窗即生效）；
        //     ⚠crashSpeed 地板数据否决（坑底天然砸速最高，切光深坑赢家）、
        //     低市值豁免数据否决（市值 6~16 无分离度）——GLEAF 类全键正的
        //     暴跌反弹接刀=已知边界（每票止损 −0.12 封顶）。
        // v7 七修（2026-11-27 用户标签「临近买入大量空窗/做市形态丢失」）：
        //     actTotalBnb 基线 0.1→2——bt-v316 A/B 否决回滚（PT59）：推迟 6 票
        //     含 1 正+换点连锁净 −0.66，胜率微升不抵总额降。「买入点位暴跌」
        //     组与「过热」组两线数据否决（见 PT58 版本注）。
        // v8 八修（2026-11-27 用户裁定「回测一下年龄控制策略」）：龄下界 3→12——
        //     bt-v317 A/B 否决回滚（PT61）：13 张 age<12 赢家仅 2 张再触发（11 张
        //     秒级窗口永久错过）。
        // v9 九修（2026-11-27 用户裁定「临近买入的数秒在暴跌，或者买入时在暴跌」）：
        //     chg3Pct≥-5 秒级暴跌地板——bt-v318 A/B 否决回滚（PT63）：切 22 票含
        //     7 正 −2.36（oddspad +0.824/牛 +0.550/ZGIVE +0.507 等）vs 15 负只省
        //     +0.90+换点 −0.09 = 净 −1.56；fire 点扫描「切 18 票零正」被引擎打脸
        //     ——深坑票 chg3 回正时龄窗/节奏键已衰减，推迟=永久错过（与 v8 龄界
        //     同构）。同轮用户提议「买入前 block 的涨跌」= recentBlockDropPct 地板
        //     扫描否决：正票 rbd 中位 43.8 比负票 40.4 还深，任何线值切 14~16/17
        //     正——深坑入场天然就在暴跌块里（与 PT58 rbd 两线否决同构），价格
        //     速度维度（秒级/块级）无法区分坑底入场与接刀。
        // v10 十修（2026-11-27 用户提案「做市代币价格前期不会太低」）：curVs 下界
        //     50——fire 点扫描正票 curVs 中位 102 vs 负票 58：curVs<50 切 21 票
        //     （2 小正 +0.035 vs 19 负 −0.739）净 +0.70，头冠全安全（Faceless 59/
        //     DYOR 58/ZGIVE 121/oddspad 88/SXSI 172）；出生价维度零分离否决
        //     （bonding floor 恒定 4~7e-9，<5e-9 地板切 4 正 1.87 反向）；fire 绝对
        //     价 <8e-9 地板切 23 票净 −0.16 否决（Faceless 6.23e-9 被切）。语义=
        //     「离发行价太近的坑不做——做市商还没把价格做上去的坑是死坑」。
        //     ⚠推迟语义（curVs<50 的票等价格抬到 +50% 再触发=买贵）须引擎 A/B
        //     验证（bt-v319）。
        // v11 十一修（2026-11-27 开放任务「因子过滤分析·胜率优先」用户裁定「收益率
        //     不低但胜率不够理想」）：actNewTraders≥15 ∧ tradesNetBuyRatioShortWin≤40
        //     ——v319 33 票面板分离度 top（actNewTraders AUC 0.88 正 29/负 16；
        //     shortWin 倒置 正 −51.8/负 +29.9）；两窗交叉验证（v319 拒 11 正 0 胜率
        //     55% PnL +1.037 / v315 拒 26 正 1 胜率 52% PnL +0.619）。语义=「死票
        //     不做（10s 无新钱包）＋追高不接（最近 20 笔净买 >40%）」——做市坑的
        //     正确入场=砸盘尾段：短窗净卖（恐慌尾声）+新钱包涌入；赢家 12 张
        //     actNewTraders 全 ≥19、shortWin 全 ≤24.6（余量 4~15 点）。null 语义：
        //     act 键空窗=0 fail-closed 同向、shortWin 环空=null fail-closed 拒。
        //     ⚠两键 tick 时刻可变（新钱包累积/净买比翻转）推迟语义须引擎 A/B
        //     （bt-v320 检验中）。
        condition: 'tokenAgeSec >= 3 AND tokenAgeSec <= 60 '
            + 'AND actTotalBnb >= 0.1 '
            + 'AND tradesPerSecSinceLaunch >= 1.5 AND (blockGapLe1Pct64 >= 85 OR (mcapFromPeakPct >= 50 AND blockGapLe1Pct64 >= 75)) '
            + 'AND mcapFromPeakPct >= 40 '
            + 'AND currentVsLaunchPct >= 50 AND currentVsLaunchPct <= 200 '
            + 'AND (athVsLaunchPct < 400 OR chg30Pct > 20) '
            + 'AND chg30Pct >= 0 AND chg10Pct >= 0 AND chg5Pct >= -10 '
            + 'AND chg60Pct >= 0 AND chg300Pct >= 0 '
            + 'AND actNewTraders >= 15 AND tradesNetBuyRatioShortWin <= 40 '
            + 'AND actTotalBnb30s <= 40',
        policy: {
            factorCheckArms: 'skip',
            actFront: 'pass',
            cheatCheck: 'skip',
            buyPoint: 'stuffingOnly',
        },
    },
    // ── T244 活跃度三类型（2026-11-26 用户指令「之前的 normal，改为因子实现后，需要拆分，
    //    活跃度高/中/burst 在当前需要对应 3 个 point Type，这样有利于分开进行优化」）──
    // 定位：把 Jev 退役后「一律 normal」的普通通路按**触发时刻 FA 因子**的活跃度拆成可
    // 分别优化的桶。排在全部形状类型之后（形状类型优先认领）、normal 之前；三者 policy
    // 全部 = {}（与 normal 同一份全门语义）——本次只拆分类、零行为变化，后续按桶分别
    // 调门/调腿。线值=Jev 活跃度题的参考线直译到 FA 窗口键（非拟合：标定集仅 1361 个
    // 带标签信号，拟合线不跨窗）：
    //   高：临近买点 30s 成交额 ≥0.99 BNB（≈2 BNB/分钟——Jev「临近段吞吐可观 ≥2~3 BNB/
    //       分钟」线）∧ 近 10s 独立交易者 ≥4；
    //   中：≥0.49 BNB（≈1 BNB/分钟——Jev「金额死寂 <1 BNB/分钟」线）∧ 独立交易者 ≥2；
    //   burst：≥30s 完全静默后秒级买入涌入（Jev「停滞突发波」形状；静默阈 30s=CD422
    //       burst 族同线；波 ≤30s ∧ 波内买 ≥0.29 BNB ∧ ≥3 笔 ∧ 波内卖 <0.049——纯买涌入）。
    // 类整数线纪律：1.0/0.5/0.3/0.05 → 0.99/0.49/0.29/0.049。
    // 排序 高→中→burst：吞吐达高/中线的强 burst 归高/中（Jev 里 high|burst 走 high_skip、
    // mid|burst 走 mid_full 同理），burst 桶只认领吞吐在中线以下的「沉寂后小涌入」。
    // 落不到三类的 = normal 兜底（≈ Jev 的 low / 极少数 ultra / 因子缺席）——Jev 时代
    // low 被 AF1 拒买，因子代放行；要单独处置低活跃面时优化 normal 桶即可。
    // 标定（1361 个 Jev AF1 带标签信号 × 触发时刻因子，182 act-calib）：T30 对
    // low vs 非 low 的 AUC 0.89~0.93；high vs mid 是连续谱（单因子 AUC 0.6~0.7），三类
    // 总一致约 61%（high 召回 67% / mid 47% / low 68%）——档位语义按本表线值重新定义，
    // 不以复刻 Jev 标签为目标。
    {
        id: 'activity_high',
        active: true,
        label: '高活跃度低价票：临近买点成交密集、多钱包在场',
        condition: 'actTotalBnb30s >= 0.99 AND actTraders >= 4',
        policy: {},
    },
    {
        id: 'activity_mid',
        active: true,
        label: '中活跃度低价票：临近买点有持续成交',
        condition: 'actTotalBnb30s >= 0.49 AND actTraders >= 2',
        policy: {},
    },
    {
        id: 'activity_burst',
        active: true,
        label: 'burst 涌入低价票：长时间沉寂后秒级买入涌入',
        condition: 'burstStallMs >= 30000 AND burstWaveSec <= 30 AND burstWaveBuyBnb >= 0.29 '
            + 'AND burstWaveBuyN >= 3 AND burstWaveSellBnb < 0.049',
        policy: {},
    },
    {
        id: 'normal',
        active: true,
        label: '普通点位（低活跃 / 未进活跃度类型）',
        condition: null, // null=兜底（前面全不中即普通）
        policy: {},      // {}=现行全门语义（FP 全臂→AF1→CD〔g23 规则集〕→BP 全链）
    },
];

/** policy 值域白名单（维度→合法值；改值域此处+头注同步） */
const POLICY_VALUE_DOMAIN = {
    factorCheckArms: ['cheatOnly', 'skip'],
    actFront: ['pass'],
    // T217 观测级门控：CD 门从三态结论门控改为规则集消费原始观测（'full' 退役——
    // g23=现行 G 语义等价迁移；g23NoSlowGrind=retail 差集；skip=跳 16 题）
    cheatCheck: ['g23', 'g23NoSlowGrind', 'g23NoE', 'skip'],
    buyPoint: ['stuffingOnly', 'skip'],
};

// ── 内部：condition 一次性解析缓存（evaluator 无缓存，模块级 Map 防每信号重解析）──
const _evaluator = new ConditionEvaluator();
const _astCache = new Map();
function _astOf(type) {
    let ast = _astCache.get(type.id);
    if (ast === undefined) {
        ast = _evaluator.parseCondition(type.condition);
        _astCache.set(type.id, ast);
    }
    return ast;
}

// condition 引用因子提取（快照用——标识符 token ∩ 传入因子键集）
const _refCache = new Map();
function _refsOf(type) {
    let refs = _refCache.get(type.id);
    if (refs === undefined) {
        refs = [...new Set((type.condition.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])
            .filter((t) => !['AND', 'OR', 'IS', 'NOT', 'NULL'].includes(t)))];
        _refCache.set(type.id, refs);
    }
    return refs;
}

/**
 * 启动防线（三防线同款）：全类型 condition 跑 validateCondition——未知因子/语法
 * throw 拒启（绝不静默恒真/恒假）。引擎 _resolveStrategyPack 在包携带
 * modules.pointType 时调用。
 * @param {Iterable<string>} factorKeys - FA getFactorKeys() 产物
 */
function assertPointTypesValid(factorKeys) {
    const known = new Set(factorKeys);
    for (const type of POINT_TYPES) {
        if (typeof type.active !== 'boolean') {
            throw new Error(`[pointType] 类型 ${type.id} 缺 active 布尔字段（2026-11-25 起必填）`);
        }
        if (type.condition == null) continue;
        const ast = _evaluator.parseCondition(type.condition);
        const v = _evaluator.validateCondition(ast, known);
        if (v && v.valid === false) {
            throw new Error(`[pointType] 类型 ${type.id} condition 非法：${(v.errors || []).join('；')}`);
        }
        for (const dim of Object.keys(type.policy)) {
            if (dim === 'factorCheckArmExempt') {
                // T217 FP 臂差集：非空字符串数组（码域宽松——未知码=无害空操作）
                if (!Array.isArray(type.policy[dim]) || !type.policy[dim].length
                    || !type.policy[dim].every((c) => typeof c === 'string' && c)) {
                    throw new Error(`[pointType] 类型 ${type.id} policy.factorCheckArmExempt 须为非空字符串数组`);
                }
                continue;
            }
            if (!POLICY_VALUE_DOMAIN[dim]) {
                throw new Error(`[pointType] 类型 ${type.id} policy 携带未知维度 ${dim}`);
            }
            if (!POLICY_VALUE_DOMAIN[dim].includes(type.policy[dim])) {
                throw new Error(`[pointType] 类型 ${type.id} policy.${dim} 非法值 "${type.policy[dim]}"（可用：${POLICY_VALUE_DOMAIN[dim].join('/')}）`);
            }
        }
    }
    if (POINT_TYPES[POINT_TYPES.length - 1].id !== 'normal') {
        throw new Error('[pointType] normal 兜底类型必须位于阶梯末位');
    }
}

/**
 * T242 实验级激活覆盖解析（纯函数；引擎 _resolveStrategyPack 调用，启动防线同款 throw
 * 拒启——脏覆盖静默生效=实验跑的不是所配的类型集）。
 * @param {*} cfgPointTypes - 实验 config.pointTypes（undefined/null = 无覆盖段）
 * @returns {Object|null} null=无覆盖段；否则=覆盖表 {类型 id: 布尔}（仅实验列出的键）
 * @throws {Error} 形状非法 / 未知键 / 未知类型 id / 非布尔 / normal 停用 / 空覆盖
 */
function resolvePointTypeOverride(cfgPointTypes) {
    if (cfgPointTypes === undefined || cfgPointTypes === null) return null;
    if (typeof cfgPointTypes !== 'object' || Array.isArray(cfgPointTypes)) {
        throw new Error('[pointType] 实验 config.pointTypes 须为对象 {active: {类型 id: 布尔}}');
    }
    const unknownKeys = Object.keys(cfgPointTypes).filter((k) => k !== 'active');
    if (unknownKeys.length > 0) {
        throw new Error(`[pointType] 实验 config.pointTypes 携带未知键 ${unknownKeys.join('/')}（仅支持 active）`);
    }
    const active = cfgPointTypes.active;
    if (!active || typeof active !== 'object' || Array.isArray(active)) {
        throw new Error('[pointType] 实验 config.pointTypes.active 须为对象 {类型 id: 布尔}');
    }
    const ids = Object.keys(active);
    if (ids.length === 0) {
        throw new Error('[pointType] 实验 config.pointTypes.active 为空（无覆盖请删除该段）');
    }
    const known = POINT_TYPES.map((t) => t.id);
    for (const id of ids) {
        if (!known.includes(id)) {
            throw new Error(`[pointType] 实验 config.pointTypes.active 未知类型 "${id}"（可用：${known.join('/')}）`);
        }
        if (typeof active[id] !== 'boolean') {
            throw new Error(`[pointType] 实验 config.pointTypes.active.${id} 须为布尔，实际 ${JSON.stringify(active[id])}`);
        }
    }
    if (active.normal === false) {
        throw new Error('[pointType] normal 兜底类型不可停用——未命中任何类型的信号恒走 normal 全门语义，'
            + '停用只会丢分类留痕（要停的是各类型时 normal 恒保留）');
    }
    return { ...active };
}

/**
 * 有效激活表（纯函数）：注册表缺省 ∪ 实验覆盖 → 全注册表类型的布尔表。
 * @param {Object|null} override - resolvePointTypeOverride 产物
 * @returns {Object} {类型 id: 布尔}（注册表每个类型恰一键）
 */
function effectivePointTypeActive(override) {
    const out = {};
    for (const type of POINT_TYPES) {
        out[type.id] = override && Object.prototype.hasOwnProperty.call(override, type.id)
            ? override[type.id] === true
            : type.active !== false;
    }
    return out;
}

/**
 * T242 买腿↔点位类型绑定启动防线（纯函数，引擎 _resolveStrategyPack 调用）：携带
 * `pointType` 的腿必须是买腿、绑定注册表内非 normal 类型 id，且策略包启用了
 * modules.pointType（无模块=绑定无消费点）。
 * @param {Array<Object>} buyLegs - 策略包买腿
 * @param {boolean} moduleEnabled - 包是否启用 modules.pointType
 * @returns {Array<{index:number,priority:*,pointType:string}>} 绑定清单
 */
function assertLegPointTypeBindings(buyLegs, moduleEnabled) {
    const known = POINT_TYPES.map((t) => t.id);
    const bindings = [];
    (buyLegs || []).forEach((leg, i) => {
        if (!leg || leg.pointType === undefined || leg.pointType === null) return;
        const id = leg.pointType;
        if (typeof id !== 'string' || id === 'normal' || !known.includes(id)) {
            throw new Error(`[pointType] 买腿[${i}]（P${leg.priority ?? '-'}）pointType 绑定非法 ${JSON.stringify(id)}`
                + `（须为注册表内非 normal 类型 id：${known.join('/')}）`);
        }
        if (!moduleEnabled) {
            throw new Error(`[pointType] 买腿 P${leg.priority} 携带 pointType 绑定 ${id} 但策略包未启用 modules.pointType——`
                + '绑定无消费点（腿↔类型绑定依赖类型路由），拒启');
        }
        bindings.push({ index: i, priority: leg.priority, pointType: id });
    });
    return bindings;
}

/**
 * 点位类型分类（纯函数，信号 fire 时刻 FA 因子表求值——回测/虚拟/live 三态同源）
 * @param {Object} factorResults - fire 时刻 FA 因子表（与腿条件同一张表）
 * @param {Object|null} [activeById] - T242 有效激活表（effectivePointTypeActive 产物；
 *        省略=注册表缺省，存量调用零变化）
 * @returns {{type:string,label:string,policy:Object,version:string,snapshot:Object}|null}
 *          null=未启用模块（调用方=全现行）；normal 兜底恒非 null。
 */
function classifyPointType(factorResults, activeById = null) {
    for (const type of POINT_TYPES) {
        const active = activeById && Object.prototype.hasOwnProperty.call(activeById, type.id)
            ? activeById[type.id] === true
            : type.active !== false;
        if (!active) continue; // 未激活类型（注册表 active:false / T242 实验级停用）：不分类不生效
        if (type.condition == null) {
            // normal 兜底：snapshot 取空（无引用因子）
            return { type: type.id, label: type.label, policy: type.policy, version: POINT_TYPE_VERSION, snapshot: {} };
        }
        let hit = false;
        try {
            hit = _evaluator.evaluate(_astOf(type), factorResults) === true;
        } catch (_e) {
            hit = false; // 评估异常=不命中（宁走 normal 不误配策略——fail-safe 方向=现行门链）
        }
        if (hit) {
            const snapshot = {};
            for (const k of _refsOf(type)) {
                if (k in factorResults) snapshot[k] = factorResults[k];
            }
            return { type: type.id, label: type.label, policy: type.policy, version: POINT_TYPE_VERSION, snapshot };
        }
    }
    return null; // 不可达（normal 兜底恒在）
}

module.exports = {
    POINT_TYPE_VERSION,
    POINT_TYPES,
    classifyPointType,
    assertPointTypesValid,
    resolvePointTypeOverride,
    effectivePointTypeActive,
    assertLegPointTypeBindings,
};
