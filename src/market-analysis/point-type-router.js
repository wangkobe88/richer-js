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

const POINT_TYPE_VERSION = 'PT36'; // PT36=类型 active 激活参数（2026-11-25 用户裁定「给 pointType 增加一个是否激活的参数，像这个还在迭代中的，激活为否，不生效」）：每类型带 active 字段，classifyPointType 跳过 active:false 类型（不命中/无 policy/无留痕），assertPointTypesValid 校验 active 必填；slow_develop_early 置 active:false——2026-11-24 OOS 裁定「这一个臂只能处于非激活状态」的延续（触发臂零引用之外，豁免层同样停用；bt-v258 24h 窗实证 37/692 信号〔5.3%，与 OOS 覆盖面同数字〕被三刀形状全豁执行，긴와 0x6862 P1·首买案）；重做三刀〔流量上界〕翻 true 时再 bump // PT35=T236 二修（2026-11-24 用户裁定「holder_quiet_unload 判它大户静默卸货、tail_no_buyer 肯定都是要豁免的，因为这是低速慢热票，其它不合理阻挡的因子门也请先豁免；cheat Jev 检测跟活跃度高的票一样，也是豁免」）：slow_develop_early policy 改全豁+塞单门 {factorCheckArms:'skip', actFront:'pass', cheatCheck:'skip', buyPoint:'stuffingOnly'}（T234 famous_conviction_pit 定稿同款——三刀形状=已验证好票背书：FP 整门直通〔慢速低活跃与 act 族/尾段/卸货臂结构性冲突，逐臂差集会漏〕/cheat 16 题跳过〔一姐案 cheat A_strong coordinated_sell_back+slow_grind_pump 双 strong 即本类型形状本征——引擎拉黑短路在门链外层保留〕/BP 只评塞单门〔BP 活跃度门对 low 形状必拦=放行链必须连坐，塞单门 BP67 明裁机械防线零成本兜底〕） // PT34=T236 新类型 slow_develop_early（2026-11-24 用户提案「前期币没涨过，慢速的相对大额交易」三刀：athVsLaunchPct<60 ∧ sinceLaunchTrades≤40 ∧ bundledAvgTradeBnb300∈[0.13,0.2)——案源 一姐 0xfc23…7777 flap 前期 avgTrade 0.189/26 笔/athVs 39.9 锚后 +499% 毕业；bt-v252 死 cheat A_strong、bt-v254 死 AF1 act=low；两窗+金狗扫描 A 面 84 票基线 中位ATH 4%/≥50% 14% → 三刀全过 22 票 中位 41%/36%〔0.15 下沿误杀 0x5731 +1016/0xbd48 +614、0.2 上沿切 0xf057 +419 留待观察；线值以 A/B 对拍校准〕；policy actFront:'pass' 只豁 AF1——慢速低活跃是形状本征非风险，cheat/BP 照走〔一姐类 A_strong 强庄签名仍拦=知情边界〕） // PT33=T234 九修：athVsFloorPct 线 200→150（用户裁定「保守一点吧」——永生 0x9f70 案：fire 时峰值=配置价 2.86 倍〔+186.15%〕未过 200 线买入后亏 −0.063，用户质疑「过了 2 倍了吧」；线 150=2.5 倍语义：w1003 切 CZCOIN +0.149/与我相关 +0.010 两赢家+永生/梅姿/MEMEROOM/人生决策/JARVIS 等亏票 −0.237 → 9 票 +0.486 vs 200 线 21 票 +0.373；金狗双案源 137.6/114.8 均在 150 内不受影响） // PT32=T234 八修：athVsFloorPct 线 140→200（用户裁定链：小赵=作弊票切掉没问题〔已由龄门 1605s>900 切〕；地板口径 20 票换算=10 票超 140 含 3 赢家〔CZCOIN 198.6/BIGNANCE 140.9/小赵 144.8〕→线 200 保全部赢家、只切加密英雄 235.4〔−0.032 亏票〕；与龄门合算=13 票 +0.606） // PT31=T234 七修：condition 加 tokenAgeSec ≤900 龄上界（2026-11-24 用户裁定「这个策略希望的是 famous 认同明确、流动性潜力没有释放的时候低价入场，肯定偏前期而不是后期」——15 分钟内；w1003 20 票龄分布：≤200s 13 票含全部大赢家〔0x28ea 66s/0x2ee9 72s/CZCOIN 115s/BIGNANCE 74s〕、891~1605s 3 票、3550~4269s 2 票、101832s 福 28h 老票；900s 切 6 票净 +0.012〔代价=切小赵 +0.033〕；金狗双案源均在 900 内不受影响） // PT30=T234 六修：ath 上限换地板口径键 athVsFloorPct（用户裁定「athVsLaunchPct 的相对价格应该跟 currentVsLaunchPct 保持一致，否则首买入价太高就会允许太高的买入点位——或者换个因子」→ 换新键：分母=与 currentVsLaunchPct 逐字同源 T139 地板，首买价太高时如实放大涨幅〔0x28ea 132.09→137.6、0x2ee9 113.92→114.8 均仍 ≤140〕；T213 athVsLaunchPct 首可靠价锚不动〔golden pit 已锁口径〕） // PT29=T234 定稿：policy buyPoint 'skip'→'stuffingOnly'（用户裁定「全豁+stuffingOnly」——塞单门 BP67 明裁机械防线零成本加回，0x28ea 塞单锚 3<8 零影响） // PT28=T234 五修：ath 上限 130→140（0x28ea 贴线误伤案：fire 时 ath=132.09——10× 金狗被 130 帽切出类型〔pt=normal 死 FP〕，2.09 点贴线正是「金额阈值不用类整数线」纪律形状；w1003 分布 130~140 区间空档〔128.36 下一位 141.37〕→抬线零新增死票、唯一新增=0x28ea） // PT27=T234 四修：policy 全豁观察版（2026-11-24 用户裁定「让这一个 pointType 豁免触发后后续的门控，然后回测观察，有一些门可能还是加回来好」：factorCheckArms:'skip'/actFront:'pass'/cheatCheck:'skip'/buyPoint:'skip'——FP 整门直通+cheat 16 题跳过〔引擎拉黑短路在门链外层保留〕+BP 整门直通；观察期形状，结束后按裁定加回或回滚） // PT26=T234 三修：①condition 加 athVsLaunchPct ≤130（2026-11-24 用户裁定「限制代币历史上涨的最大幅度——上涨幅度很大的票流动性已彻底释放、生命周期走完，期望的是小热一把后砸出来的坑」：w1003 全窗 31 类型成交票 fire 时 ath 分布=≥141 死区 16 票 −0.334〔212/190/185/177/169/167/164/163/158/153/151/149/144/141 全亏或碎亏〕vs 赢家聚集带 ≤125〔CZCOIN 122.04/躺赢人生 113.92/小赵 121.5〕；线 130=赢家留 8 点安全距、只多放 FFR/福 −0.014；0x28ea 案 fire 时 ath ~+30 不受影响）②FA 臂 A 剔除臭名昭著钱包（用户裁定「臭名昭著钱包就不算在 famous 命中数量中」：notorious 高位买不构成好票背书——a83b 案；w1003 9 票含 notorious 贡献、剔除后 8 票 N<3 失去匹配免损 +0.165、赢家与我相关 N=5→3 仍过零受损） // PT25=T234 二修：policy cheatCheck g23NoE→g23NoSlowGrind（bt-v241 实证：0x2ee9/0x28ea 两票全被 slowGrindPump=3 唯一 strong 进 A 主判拒 grade=cheat——famous 带量入场形状天然触发 slowGrindPump，黄金坑 g23NoSlowGrind 差集案源 0xa04ee1 同款形状；g23NoSlowGrind=A 主判排 slowGrindPump+去 E 通道两件套正合本类型，差集选型错误修正） // PT24=T234 famous_conviction_pit 新类型（2026-11-24 用户提案「famous/聪明钱强认同健康盘深坑」+裁定：臂 A famous∪smart 高位重参与〔买时 curVs≥+40%、单笔≥0.02B、累计≥0.5B、≥3 钱包〕+深回撤低位坑〔域保留：不开更高 curVs 阈、亏损有限〕+反弹确认+同块跟单≤8 宽松形状门；policy 全套豁免：FP cheatOnly+arb_bot_holdings 豁免〔0x2ee9 死因臂〕/AF1 pass/cheat g23NoE/BP stuffingOnly；案源=躺赢人生 0x2ee9…7777 两信号死 AF1 act_front_low+T198b，锚后 6.9×；四窗探针：域内池臂 A n=333 ge2x 6.9% vs 基线 4.8%、end60mean 1.040 vs 0.995；JG-40「买过」口径否证面由坑底+反弹确认+低位域三锚兜底；域外高 curVs 形状刻意不做〔用户裁定〕） // PT23=T232 补 3 差额键换买侧口径（2026-11-24 用户裁定「是不是区分一下买卖行为」：fire 前 (15,60]/(60,90] 段只计**买入**——MOYNOK 带 0.1022 全为上一波离场卖=坑位回撤本身不该拦，0x4509 带卖 0.25 同族；买侧两案源都=0 零影响；线 0.15/0.12 避开 0.1 类整数） // PT22=T232 补 2 90Ex60 0.1→0.12（bt-v239 回测误伤 MOYNOK 0xc66b：fire 前 60~90s 带 0.1022 全为上一波离场卖单〔rel −71/−69/−67s 三笔 0.0955/0.0051/0.0015〕非热度——黄金坑形状允许的回撤卖压被差额线误拦，−0.4521；0.12 留 17% 余量，仍拦真热形状） // PT21=T232 冷窗 15s 线 0.31→0.4（2026-11-24 用户裁定放宽：0x4509…7777 fire 时刻 15:02:26.2 act15s=0.349 差 0.039——debounce fire +200ms 把 15:02:21 双胞胎离场卖 0.2506 与回场买 0.0988 同窗计入，「由冷转热第一笔买入」本身 0.0988 被离场卖污染；PT10「大于 0.31 再砍」复议兑现；嵌套约束 15s≤30s 在 0.4/0.4 处仍成立）+ 差额上界两线（2026-11-24 用户裁定「act15s 比较大的时候 60s 跟 15s 的差额要控制」→ 60Ex15≤0.15；「应该是还有个 90s」→ 新键 90Ex60≤0.1——火起前一分半都基本冷；MOYNOK 60Ex15=0.108/90Ex60=0、0x4509 两差额=0 零误伤） // PT20=T231 龄上界撤除（2026-11-24 用户裁定「年龄没必要要求小于 900——这个模式空窗期时间长一些根本没关系」：0x4509…7777 案 12 分 10 秒断流把 famous 双胞胎回场推到 910s——窗口关闭后 10 秒错过的黄金坑形状；剩余龄约束=买量带 [4,15B] 事实封顶；同轮 FA 侧 bigBuyerCohortMinBnb 0.2→0.19 类整数线 GAS 裁定） // PT19=T225 五修：condition 加 quietSurgeSellBnb≤0.05（ZEC 0x5bd4…7777 案用户裁定「同一个 slot 上绑着卖出（对倒交易）这种形态应该被拦截」——fire@135s 同秒买 0.604∧卖 0.5084 绑定）+factorCheckArmExempt 加 oversell_residual（用户裁定「也要豁免（不豁免不合理）」） // PT18=T225 三修：condition 加 quietExitOthersBuyBnb≤0.3（用户指令「记录大户之外的总买入不能超过一个线」——湖南 0.597 闪进闪出团伙案；8 票引擎口径：毕业票 max 0.267/湖南 0.597，区间内任意线干净分）+policy factorCheckArmExempt=['fam_holding_thin']（개구리씨 毕业票被 FP3 拦 ×4 案，用户裁定豁免） // PT17=T225 独舞 policy 补 cheatCheck:'g23NoE'（E 通道差集规则集——用户裁定「这一个 pointType 豁免 act=low∧sbw=none」覆盖 AF1 与 cheat E 两道同源拒；不借 T205 全局灰度） // PT16=T225 独舞尾窗口径换 actTotalBnb60Ex15≤0.05（用户裁定 2026-11-23「一分钟活跃度等于 15 秒活跃度」——固定 180s 尾窗对短周期票〔개구리씨 0.1175〕把开盘老买入盖成跟进假阳性；8 票验证 LAB/개구리씨=0、ZEC 1.37 被切、湖南/Willow 等 5 死盘临门段亦 0=死透非胜负手由门链接力筛） // PT15=T225 新类型 strongbacker_solo_dance（用户裁定 2026-11-23「这一个 pointType 豁免 act=low∧sbw=none」）：独舞形态八键（出口快照四键+四件套）+policy={actFront:'pass'} 只豁 AF1（cheat/BP 照走）——bt-v217 实证 LAB 腿触发+FP 过后唯一卡点=AF1 reject_low（T210 stall_restart 同款结构性冲突：死而复生形状锚前窗天然低活跃） // PT14=T224 类型 id 改名（用户裁定「retail_golden_pit 这个名字太泛了」）：retail_golden_pit → famous_holder_cold_pit（label 六要素的 id 化：famous 入场背书+大户在场+冷寂考验+低价坑；「有买入」=机制、「二波潜力」=目标不入 id）——policy/condition 零变化，id 为审计维度 bump // PT13=T223 补 4 curVs 硬上限 33.5（用户裁定 2026-11-23「无论 earlyReturn 多少，curVs 最高 33.5」：挡 0x2c3fdb 94.12/0x94c3cd 38.11 极端背离票——首价尺低但地板尺已拉到天；MOYNOK 30.13 留 3.4 余量，v214 触发面其余全 ≤29.4 零误伤） // PT12=T223 补 3 价格域双尺 OR 线值修正（用户裁定 2026-11-23「那就 earlyReturn < 15」：v16 线 5 实测差 3.2 点——MOYNOK 波首笔引擎真值 earlyReturn=+8.2%〔flap 非 BNB quote 盘换算后口径，−0.9 系我方 quote 域价直除错算〕、地板尺 30.13，两尺背离 22 点；由冷转热第一笔像样买盘不该被地板尺拦） // PT11=T223 补 2 价格域双尺 OR（用户裁定 2026-11-23「给 currentVsLaunchPct 条件增加一个或，如果 earlyReturn 小于 5% 也可以」：地板尺 ≤28.5 ∨ 首价尺 <5——MOYNOK 波首笔案首版线值） // PT10=T223 补 冷窗线放宽（用户裁定 2026-11-23「15 秒窗大于 0.31 再砍好了——由冷转热的第一笔买入可能比较大，如果大的话反而好」+「30 秒窗也得稍微变大一点」：15s 0.12→0.31 / 30s 0.25→0.4——MOYNOK 波首笔 0.13 近失案；嵌套约束 15s≤30s 窗值恒成立故 30s 必须同抬且留余量；60s 0.5/90s 1.0 不动） // PT9=T223 锚点买盘存在门（用户提案「买入点是个买入 或 15s 内有 ≥0.03B 买→死寂不回弹概率大降」+「所有后面要上涨的币都需要有买入」——死寂点不买、等第一笔像样买盘落地〔被挡票更晚点位重 fire=反弹确认等价形式〕；线值用户裁 2026-11-23） // PT8=T222 臭名昭著钱包门 notoriousWalletCircPct≤30（用户点名 bf00 大割「真的用户看到就想躲」；线值用户裁定 2026-11-23：拦 0x37d131 38.9/0xfc305b 43.2/0xcc6b2e 50.3 垄断档，MOYNOK 18.7 距线 11 点安全）+T221 跟单键改全生命周期单调 max 语义（0x2a05 簇 t+23s/fire t+411s 读环剪掉案；≤8 线值不变） // PT7=90s 冷窗 ≤1.0（用户裁定 2026-11-23「是否 1.5 分钟好一些」→选 ≤1.0——0x53691a 盘子刚冷一分钟不够，冷窗扩到 90s 线放宽到 1.0 避过杀正票）+ famous 跟单拥挤门 ≤8（用户裁定「跟单算 famous 买入后 1-2 个 slot」——0x2a05 同块 16 钱包挤爆案，MOYNOK 买点前 4/金鲨号 0 分界） // PT6=v11 冷窗线值收紧（15s≤0.12/30s≤0.25/60s≤0.5——用户裁定「15 秒没有什么特殊的，1 分钟内都要低」；杀 0xa04ee1 类退潮热买） // PT4=v8 裁定 arb_bot_holdings 臂豁免真正落地（PT3 时期该豁免只存在于 commit 信息未写入文件——bt-v202 0xd64e 仍被拦实锤；教训二连：线值改动必须写完跑测试断言全 policy）；PT3=龄 160-900/famous 帽撤除

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
        id: 'normal',
        active: true,
        label: '普通点位',
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
 * 点位类型分类（纯函数，信号 fire 时刻 FA 因子表求值——回测/虚拟/live 三态同源）
 * @param {Object} factorResults - fire 时刻 FA 因子表（与腿条件同一张表）
 * @returns {{type:string,label:string,policy:Object,version:string,snapshot:Object}|null}
 *          null=未启用模块（调用方=全现行）；normal 兜底恒非 null。
 */
function classifyPointType(factorResults) {
    for (const type of POINT_TYPES) {
        if (type.active === false) continue; // 迭代中类型不激活：不分类不生效（2026-11-25 用户裁定）
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
};
