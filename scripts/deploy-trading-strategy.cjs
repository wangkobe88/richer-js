#!/usr/bin/env node
// 交易策略包部署脚本（T202 策略库二期，2026-11-20 立）——策略库唯一正式部署通道：
// 条目 = 完整交易策略包（买/卖腿〔断流卖出=T233 腿化 stall 卖腿〕 + burstCooldown + 四检测模块版本键）。
//
// 内容来源（provenance，双源烘焙）：
//  * 买 14 腿 = ladder **v39**（v34 十四腿，T201 大户推迟已迁 FP32；v38/T224 黄金坑+v38/T225 独舞两臂并入；v39/T229 十四腿价格门早回场 OR 臂——详见 ENTRY_DESC 与台账 T229）——逐字取自退役前
//    deploy-signal-source-strategies.cjs 的 LEGS 产物（bt-v163 模板仍带 v33 条件串，
//    G2 未迁出，故买腿不走模板提取）；cards:4 为烘焙时按「卡牌张数入包」裁定统一补
//    （旧链由 clone Tier1 自动补，张数恒 4——bt-v163 实跑腿同值，bit 等价）。
//  * 卖 18 腿 + stallClose{55s,足额0.01}（T233 起腿化为 stall 签名卖腿——55s/almost 域 90s）
//    + burstCooldown{} 全默认 = bt-v163-all-arms-48h-
//    win1003（7d60bc05-8c4e-4f0d-993c-6f2d02428ea7，2026-11-20 现行最优模板）config 逐字提取
//    （16 条现行 + T161 famous-trim 两段）；提取规范化一处：卖腿「profitPercent > 100」
//    cards='1'（字符串）烘焙为数字 1（引擎 normalizeCards 等价归一，非策略变化）。
//  * modules 四键 v1 = 模板四门全开形状（FP32/D3.81/AF1/BP69 经 module-registry 解析）。
//    2026-11-26 主包切因子代（T241 Jev 退役，用户裁定）：cheatCheck/actFrontGate/buyPointCheck
//    三键 v1 → v2（CF1/AF2/BPF3）；factorCheck/pointType 仍 v1。专属触发腿 P16~P20 带
//    pointType 绑定（T242 实验级类型激活：未激活类型的专属腿不组装）。
// docs/当前最优买卖策略.md §二/§三/§四 为核对闸——修改包内容必须同步 docs 与交易台账。
//
// 版本语义：同名 upsert——definition 键序无关深比较无变化 SKIP、有变化 version+1；
// 引用实验「启动时取最新」——部署后重启实验进程生效。
// 卡牌张数在包腿上（cards:4 / 'all' / N）；每卡 BNB（positionManagement.perCardBNB）
// 是实验层配置不进包。门链 ops 旋钮（gate.awaitMs/alwaysRecheck/activityExemptLevels/
// memSource）同属实验层（clone-experiment.cjs LIVE_STD 注入）。
//
// 用法：node scripts/deploy-trading-strategy.cjs [--commit]（缺省 dry-run 本地可跑；
//       --commit 须在 182 跑写库——本地 VPN 写库不可靠）
'use strict';
const { buildStallLegConditionTier90, buildStallLegConditionTier55 } = require('../src/trading-engine/core/stall-sell-leg');
const STALL_LEG_CONDITION_TIER90 = buildStallLegConditionTier90();
const STALL_LEG_CONDITION_TIER55 = buildStallLegConditionTier55();

const ENTRY_NAME = 'trading-standard-v1';
const ENTRY_DESC = '现行最优交易策略包：ladder v39 十九腿（v34 十四腿+T224 黄金坑臂+T225 独舞臂 priority 17+T238 famous 参与坑臂 priority 18+T239 持续趋势臂 priority 19+T237 做市节奏臂 priority 20〔2026-11-25 用户提案「做市痕迹票：有庄在搞事，一般来讲会很强势」——金狗集合做市/操控 32 票实证 24 张闪电毕业票，节奏键 tradesPerSecSinceLaunch/blockGapLe1Pct64 识别+深砸坑 curVs≤120 入场〔用户裁定「那就取 120% 试试」〕+pointType market_maker_rhythm_pit active:false 迭代期，详见包腿 description 与交易台账 T237〕〔2026-11-25 用户提案「金狗『上涨趋势形成后一直拉盘』『散户慢速拉升盘』两分类单独成立一个 pointType」——steady_trend_climb 类型（PT41；PT47 act30s 3.9→1.9「砍吧」；PT48 athVsFloor<150「先卡」；PT49 chg30≤30+反磨顶「就这么搞吧」）专属自触发腿，域 30~80%+MA60 斜率带 5~60+act30s≤1.9+ath 幅宽门 双管，policy 全豁+stuffingOnly 先豁再收，详见包腿 description 与交易台账 T239〕〔2026-11-25 用户裁定「增加这个新的 pointType」+同日二修「那就不要要求非要完全离场……famous 持有并不是坏事」——famous_participation_pit 类型（PT38）专属自触发腿，案源来财 0xc84a…7777：famous 参与过+坑位+反弹确认形状，详见包腿 description 与金狗台账 JG-39〕；〔2026-11-23 用户裁定「把这个 pointType 对应的策略正式发布，合并到系统当前的交易策略中」——pointType strongbacker_solo_dance（PT19，policy actFront:pass+cheatCheck:g23NoE+臂豁免 fam_holding_thin/oversell_residual）；bt-v224 验证 LAB +225.81%/개구리씨 +138.48%/6 死盘全拦〕〔2026-11-23 用户裁定「把这个策略正式落定成当前策略的一部分」+「跟当前策略合并在一起」——T213~T223 系好散户币黄金坑买腿并入主包 priority 16 兜底臂〔T231：队列线 0.19+龄上界撤除；T232：冷窗 15s 线 0.4〕〕；T214/v35 初版强庄臂（firstBigBuyerHoldPct≥40 线）经 T215 命中面否证已回退留档——终版独舞九键重立为 T225）+ **T229 早回场 OR 臂**〔2026-11-24 用户指令「给常规的所有臂，也增加一个 earlyReturn 的或条件」——十四腿价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))，GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命），常量与黄金坑臂同族〕+ 卖 18 腿（16 现行+famous-trim 两段）+ stall 断流卖腿×2（T233 腿化：55s 基础/almost 域 90s，idleSecSinceLastSubstantialTick 因子表达式，进入 factorSellFilter 统一过滤；2026-11-27 用户指令「可以拆分两臂，不要用 OR 连接」→ 拆成 stallCloseAlmost(90s)/stallCloseBase(55s) 两独立腿互斥等价）+ 五门 v1（FP32/D3.81/AF1/BP69）；T203 fpRetry=2 全买腿（2026-11-22 T203c 用户裁定「重评最多两次，一共 3 次」+「不需要延迟，只要 debounce 过了就行」——FP 拒后门内重评至多两次〔首评+重评共 3 评〕，重评间隔=debounce 节奏 200ms，30s 地平线；原 v2 fpRetry=1+间隔 2s 被 bt-v178 0xb6ee 案源本尊饿死；p18 参与坑臂 fpRetry=0——policy 全豁后 FP 恒过重评无意义）；burstCooldown 段已移除（2026-11-22 用户裁定「对金狗伤害太大」临时关闭 T189 两批卖出——批1/批2 承接窗对慢热承接形状结构性过短〔JG-4/13/19/34 攒批族：ZKind 24s 切+牛屁 29s 切均卖后 ×10 级〕，恢复=definition 加回 burstCooldown:{} 即可）；〔2026-11-26 用户裁定「Jev 已经充值，但系统可以不用再使用了；主包切因子代」（T241 Jev 退役）：cheatCheck/actFrontGate/buyPointCheck 三门 modules 版本键 v1（Jev 代 D3.81/AF1/BP69）→ v2（因子代 CF1/AF2/BPF3〔T243 起 BP 门只评塞单门，crash 形态是因子门 FP48 的一条臂〕，结论出自 factor-responders 纯函数零 Jev；Jev 代代码原样保留——回滚=键改回 v1 重部署）；factorCheck（FP47 本就纯代码）与 pointType 不变〕；〔同日 T242 用户指令「将 pointType 的开关激活改为实验层面可配置项」：专属触发腿 P16~P20 各带 pointType 绑定（腿↔类型绑定是包数据，类型激活是实验 config.pointTypes.active——未激活类型的专属腿不组装）；注册表缺省全激活=本包零行为变化〕';

const PACK_DEFINITION = {
  "buyLegs": [
    {
      "action": "buy",
      "priority": 1,
      "condition": "tradeCount >= 6 AND buyVolumeBnb >= 1 AND holdersExDust >= 4 AND (currentVsLaunchPct <= 28.5 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND tokenAgeSec >= 15 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 2,
        "recheckCondition": "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "最早臂（v15/T131 新增——吉祥 ea78 开盘 25 秒窗差一笔错过全窗案；v17/T133：6 笔+两次 Jev——maxTriggers 2 首次门拒后再判一次，单仓语义防双买；cheat/BP minTicks 同线 7→6；v18/T135：加 tokenAgeSec >= 15——bt-v102 因子分析 age<15s 30 票胜率 27% 净 -0.37 开盘 bot 抢速盘，15s 内走完 6 笔=抢速非人气）：6 笔/1 BNB/4 真持有者；价格 ≤+28.5%；10s 窗买卖合计 ≥0.1 BNB（低活跃度不买）；年龄 ≥15s；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 2,
      "condition": "tradeCount >= 9 AND buyVolumeBnb >= 1 AND holdersExDust >= 6 AND (currentVsLaunchPct <= 28.5 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND tokenAgeSec >= 15 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "更早人气臂（v12 新增，用户条件串原文——高大上零触发案：点火即拉飞形状 t0b 十二笔门槛差一笔错过全窗）：9 笔/1 BNB/6 真持有者；价格 ≤+80%（v14 收紧 ≤+27.5%；v17 微放宽 ≤+28.5+actTotalBnb 门；v18/T135 加 tokenAgeSec >= 15 同 t0 抢速门；v15 顺移 p2）；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 3,
      "condition": "tradeCount >= 12 AND buyVolumeBnb >= 1 AND holdersExDust >= 6 AND (currentVsLaunchPct <= 28.5 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "人气臂 b（v5 新增，v12 前为最早臂——t0a 6 笔档 2026-11-07 首跑对照后用户裁定删除、v12 以 9 笔档重生）：12 笔/1 BNB/6 真持有者；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p3；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 4,
      "condition": "tradeCount >= 16 AND buyVolumeBnb >= 1 AND holdersExDust >= 9 AND (currentVsLaunchPct <= 28.5 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "阶梯 2（v4 原文）：16 笔/1 BNB/9 真持有者；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p4；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 5,
      "condition": "tradeCount >= 20 AND buyVolumeBnb >= 1.2 AND holdersExDust >= 12 AND (currentVsLaunchPct <= 28.5 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "阶梯 3（v4 原文）：20 笔/1.2 BNB/12 真持有者；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p5；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 6,
      "condition": "tradeCount >= 24 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12 AND (currentVsLaunchPct <= 28.5 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "阶梯 4（v4 原文）：24 笔/1.5 BNB/12 真持有者；高热度 unhealthy 粘滞秒回省配额（v10=表达式化）；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p6；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 7,
      "condition": "tradeCount >= 30 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12 AND (currentVsLaunchPct <= 28.5 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "热度腿（T119 用户给定条件串原文，v4 原文）：30 笔/1.5 BNB/12 真持有者——阶梯接棒+节流下实际落点由步进节奏决定，慢热票里程碑摊开；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p7；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 8,
      "condition": "tradeCount >= 36 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12 AND (currentVsLaunchPct <= 28.5 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "热度腿（T119，v4 原文）：36 笔/1.5 BNB/12 真持有者；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p8；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 9,
      "condition": "tradeCount >= 45 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12 AND (currentVsLaunchPct <= 28.5 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "热度腿（T119，v4 原文）：45 笔/1.5 BNB/12 真持有者——极高热度确认，任何节奏的票 45 笔=强活跃；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p9；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 10,
      "condition": "tradeCount >= 15 AND buyVolumeBnb >= 2.5 AND (currentVsLaunchPct <= 28.5 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "接近发行价臂 a（v8 新增 T122；v9 加 tradeCount>=10；v13 量门提高 15 笔/2.5 BNB——bt-v83 87 票小票放行实证；v14 价格门 50→27.5、v17 微放宽 ≤+28.5+actTotalBnb 门）：现价较发行价 ≤+28.5%（含破发）——热度够+价格贴发行价；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 11,
      "condition": "tradeCount >= 15 AND buyVolumeBnb >= 2.5 AND (currentVsLaunchPct <= 28.5 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "接近发行价臂 b（v8 新增 T122；v9 加 tradeCount>=10；v13 量门提高 15 笔/2.5 BNB；v14 价格门 50→27.5、v17 微放宽 ≤+28.5+actTotalBnb 门）：现价较发行价 ≤+28.5%（含破发）；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 12,
      "condition": "tradeCount >= 15 AND buyVolumeBnb >= 2.5 AND (currentVsLaunchPct <= 28.5 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "接近发行价臂 c（v8 新增 T122；v9 加 tradeCount>=10；v13 量门提高 tradeCount 10→15，量 2.5 不变；v14 价格门 50→27.5、v17 微放宽 ≤+28.5+actTotalBnb 门）：现价较发行价 ≤+28.5%（含破发）——三档中最高热度确认；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 13,
      "condition": "tradeCount >= 15 AND buyVolumeBnb >= 2.5 AND (currentVsLaunchPct <= 20 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "重启臂（v10 新增；v13 量门提高 15 笔/2.5 BNB；v17 加 actTotalBnb 门）：现价较发行价 ≤+20%（含破发）——经历交易量后回到 almost_launch 的重启盘入场点；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 14,
      "condition": "tradeCount >= 15 AND buyVolumeBnb >= 2.5 AND (currentVsLaunchPct <= 10 OR (earlyReturn < 15 AND currentVsLaunchPct <= 33.5)) AND actTotalBnb >= 0.1 AND ((launchBundleClusterSize < 3 AND launchFirstBlockWallets < 2 AND launchFirstWaveWallets < 3) OR (tokenAgeSec > 60 AND sinceFirstTradeSec > 45) OR launchMinVsFloorPct < -10) AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "深重启臂（v11 新增；v13 量门提高 15 笔/2.5 BNB；v17 加 actTotalBnb 门）：现价较发行价 ≤+10%（含破发）——回到 almost_launch 深半区的更贴发行价入场点；v34/T201 大户推迟门（G2）迁出：自条件串整段撤出至 FP 因子门 big_buy_defer 臂（T180 同款迁移；A 形态=FP 拒消耗 maxTriggers+信号桶知情接受——推迟窗近触发落行可定位；判定线不变 0.79/45s+1/60s+深破<−10；键源 buyDerived.launchDefer=FA launch 键镜像；灰度随 factorCheck.enabled）；v25/T151 前期买入太多推迟门（launchBigBuyBnb<1 OR sinceFirstTradeSec>60——首60s大户合计买≥1B 的票推迟到首笔交易 60s 后入场，t* 中位 +15~90s 抛压释放窗）；v20/T141 首两波扩展门（先头在首块+同波续单在下一块的狙击小队形状簇键抓不到，60s 后放行）；v21/T142+v22/T145 破发豁免臂（launchMinVsFloorPct < 0——历史最低跌破 min(常量,首买价)=经历过破发、首两波收割完成筹码换手完毕的重启位放行，ASTER 案；v22 起 f0/wave 任一达线即挡）；v23/v24/T149 年龄门加 sinceFirstTradeSec > 45（首笔交易起算 45s，与 tokenAgeSec > 60 AND 联立——0x3441cc2a 案创建后静默 50s 首两波满员 72s 单门放行接刀）；v29/T172+T173（2026-11-18 bt-v143 两案）三件：①launchBigBuyBnb 同块等额合并口径（FA 侧——首买同块四位归一全等 ≥2 钱包组累计合并过 0.19 线计入视为单用户，案源 0x683165bf…7777 0.846→1.1177≥1 进 60s 档）②破发豁免线 <0→<−10（浅回落=大额首买抬高锚的噪声非真破发——Ardot −0.96 案首裁 −5、案 3 驴来 0x531ddef1…7777 −8.75 被豁免放行 −0.0625 引出用户深化 −10：−5~−10 带窗内票全负 驴来 G1 clu=3 接住+油宝 −6.3 双门拦，≤−10 的 4 张 Σ+0.2832 与 ASTER −38.4 深破发照豁免）③大户推迟门加 0.79 档中间窗 45s（驴党 0xf37fe6de…7777 bigBuy=0.7934 36s fire 断流止损 −0.0148 案——0.79~0.8 视同 0.8 级 T169 惯例；45s 与 T149 同线，≥1 档维持 60s；豁免臂 −10 同享两档）；v30/T177（2026-11-18 0x65104a55…7777 案）≥10 捆绑绝对 veto（launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10——早期交易 10+ 钱包捆绑无论买入砸盘一律不买，无年龄放行无破发豁免；案源：10 户同块买 0.99B→同块砸 0.87B 块内 −24.5%→反弹 12s 洗白全链买入 93s 流动性止损 −62.4%）；v31/T178（2026-11-18 0xa025b8d8…7777 案）两波捆绑买入绝对 veto（(launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30)——2 次 ≥5 钱包同块捆绑买入且占出生窗买入 ≥30% 不买，raw 含复购波〔G3 首买簇键看不见的形状〕；案源：7 钱包同块 0.92B→同组相邻块复购 0.98B 占窗买 33.2%→同组 9 户两相邻块全清砸 2.08B→双信号放行买入 −6.7%；同窗对照 waves≥2∧dom≥30 恰 3 命中 2 负 1 小正）；v31/T179 同车（2026-11-18 bt-v147 瞬时V案 0x6b03…7777/0x66ca…7777 两案）做市/作弊团队黑名单绝对 veto（cheatCrewBuyBnb == 0——名单钱包〔config/rosters/cheat-crew-wallets.json 用户裁定集合〕本 token 有过买入一律不买；案源=砸盘砸到底→≤2s 瞬时拉起流水线，pull 被门链当「买力在场」放行；形状层否证〔瞬时V面净 +0.24 肥尾在内〕钱包层分离〔三件套足迹 37 票 -0.42 vs 其余 +2.00〕；FA 新键=K 组读时扫 famous 同款，0 语义裸比较放行；roster 只收 pull 角色，openers/churn/跟单生态不收；无年龄放行无破发豁免=身份 veto；被挡不消耗 maxTriggers；⚠名单数周轮换须定期扩簇）；v32/T180 首两波大部队×高占比 veto 首落 ladder 后同日迁移因子过滤模块 FP17 launch_squad_dominance 臂（用户裁定「放到因子过滤模块吧，不要放到信号触发模块了」——判定线不变 wave≥8 ∧ dom≥30，键源 buyDerived.launchSquad；ladder 尾门回 G1~G5）；v39/T229 早回场 OR 臂（2026-11-24 用户指令：价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))——GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命，域内=静默/活跃=出域），常量与黄金坑臂 p16 同族）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 16,
      "pointType": "famous_holder_cold_pit",
      "condition": "tokenAgeSec >= 160 AND buyVolumeBnb >= 4 AND buyVolumeBnb <= 15 AND (currentVsLaunchPct <= 28.5 OR earlyReturn < 15) AND currentVsLaunchPct <= 33.5 AND athVsLaunchPct >= 40 AND athVsLaunchPct <= 100 AND mcapFromPeakPct <= 50 AND bigBuyersCount >= 3 AND bigBuyersHeldDust >= 3 AND actTotalBnb15s <= 0.4 AND actTotalBnb30s <= 0.4 AND actTotalBnb60s <= 0.5 AND actTotalBnb90s <= 1.0 AND actTotalBnb60Ex15Buy <= 0.15 AND actTotalBnb90Ex60Buy <= 0.12 AND famousFollowSlotMaxWallets <= 8 AND notoriousWalletCircPct <= 30 AND (anchorTickIsBuy == 1 OR anchor15sMaxBuyBnb >= 0.03) AND famousCopyWalletCircPct > 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1",
        "fpRetry": 0,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "黄金坑臂（T224 2026-11-23 用户裁定「把这个策略正式落定成当前策略的一部分」+「跟当前策略合并在一起」——T213~T223 系 retail-good-path-v1 v18 买腿并入主包 priority 16 兜底臂；pointType 类型=famous_holder_cold_pit（旧名 retail_golden_pit）〔label「Famous入场-大户在场-长时间冷寂-有买入的低价坑-二波潜力币」〕）。形状=正常对倒票第一小波（ATH 1.4-2.0x）回撤 30-50% 后的域内坑位：龄 ≥160s 无上界（T231 2026-11-24 用户裁定「年龄没必要要求小于 900——这个模式空窗期长一些根本没关系」：0x4509…7777 案 12 分 10 秒断流把 famous 回场推到 910s——窗口关闭后 10 秒错过的黄金坑；交易了一段时间大户不肯卖）∧ 量 4-15B（早期未交易完）∧ 价格域双尺+硬帽（(地板尺 ≤28.5 ∨ 首价尺 <15) ∧ 地板尺 ≤33.5——接深坑拉回 MOYNOK 波首笔 30.13/8.2 案、不接极端背离 0x2c3fdb 94.12 案）∧ ≥3 个 0.19B 级大买家过尘线在场（T231 队列线 0.2→0.19——类整数线被 GAS 压线错过：0x4509 双胞胎累计 0.1975 差 0.0025） ∧ famous 底仓持有 ∧ 冷窗 15s≤0.4/30s≤0.4/60s≤0.5/90s≤1.0（T232 2026-11-24 用户裁定 15s 0.31→0.4：0x4509 fire 时刻 0.349 被 5s 前离场卖污染——由冷转热第一笔买入可能比较大，大的反而好）∧ 差额上界买侧 60Ex15Buy≤0.15/90Ex60Buy≤0.12（用户裁定「act15s 比较大的时候 60s 与 15s 的差额要控制」+「还有个 90s」+「区分一下买卖行为」——热度只计买入，离场卖=坑位回撤照放；首版 total 口径 0.1 类整数线误伤 MOYNOK fire 带离场卖 0.1022〔−0.4521〕，换买侧后两案源带买都=0 零影响）∧ famous 跟单 ≤8（2s 窗非 famous 买入钱包数全生命周期单调 max，0x2a05 同块 16 钱包挤爆案）∧ notorious ≤30（臭名昭著钱包集合 notorious-wallets.json 先只放 bf00）∧ 锚买门（锚 tick 是买入 ∨ 15s 内 ≥0.03B 买——死寂点不买等第一笔像样买盘落地，「所有后面要上涨的币都需要有买入」）。门链=pointType retail policy（FP cheatOnly+臂豁免〔slow_pump_unload/arb_bot_holdings〕/AF1 pass/CD g23NoSlowGrind/BP stuffingOnly——好散户币通路接纳策略）。刻意不带 ladder 尾部 veto 组（G1/G3/G4/G5/cheatCrew）——出生窗簇键对 160s+ 坑位语义不同、捆绑/作弊由 FP cheatOnly 臂+CD 16 题兜底（T216 裁定）。验证=89 票集合 golden-pit-35 bt-v215 +0.9147/6 票/胜率 83.3%/零亏损；跨窗初验 win1012 30898 票 4 命中 2 正 2 负。⚠buyPhase first 语义：集合票早期多被 ladder t0/t2 族先买——本腿为早期未被买走的票的坑位兜底/重启接棒臂",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 17,
      "pointType": "strongbacker_solo_dance",
      "condition": "quietSpanMs >= 60000 AND quietSurgeBuyBnb >= 0.4 AND quietSurgeSec <= 30 AND quietExitVsLaunchPct >= 0 AND quietExitVsLaunchPct <= 28.5 AND currentVsLaunchPct > 0 AND currentVsLaunchPct <= 28.5 AND quietExitBigBuyers == 1 AND quietExitLatchHoldPct > 0 AND quietExitEndWithSell == 1 AND actTotalBnb60Ex15 <= 0.05 AND quietExitOthersBuyBnb <= 0.3 AND quietSurgeSellBnb <= 0.05 AND actTotalBnb >= 0.1 AND tokenAgeSec >= 15 AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 2,
        "recheckCondition": "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1",
        "fpRetry": 2,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "独舞臂（T225 2026-11-23 用户裁定「把这个 pointType 对应的策略正式发布，合并到系统当前的交易策略中」；pointType 类型=strongbacker_solo_dance〔label「一个钱包的独舞：独自持大仓不全卖出的强庄爆拉币」，PT19〕）。用户时序画像：「开盘大户小户买→大户小户卖→(大户留仓)沉寂→拉盘；盘面干净=卖出潮后无新资金跟进」。九键：①quietSpan≥60s 死透沉寂②surge≥0.4∧≤30s 拉盘涌入③出口价∈[0,28.5] 未破发（T130 地板）④现价∈(0,28.5] 低位⑤quietExitBigBuyers==1 活跃段唯一大户（ZKind 1.47B 接力盘切）⑥quietExitLatchHoldPct>0 出口留仓（清仓型切）⑦quietExitEndWithSell==1 卖收尾（从未活过死票切）⑧actTotalBnb60Ex15≤0.05 临门 60s 段成交≈0（用户口径「一分钟活跃度=15秒活跃度」——替代 180s 尾窗周期重叠假阳性）+quietExitOthersBuyBnb≤0.3 大户之外总买入线（湖南 0.597 闪进闪出团伙案）⑨quietSurgeSellBnb≤0.05 拉盘波不绑卖（ZEC 同 slot 买 0.604∧卖 0.5084 对倒案）。门链=pointType 独舞 policy（actFront:pass + cheatCheck:g23NoE〔E 低活跃通道差集——AF1/cheat E 两道同源拒一并豁免〕+ factorCheckArmExempt〔fam_holding_thin/oversell_residual〕——A/L/M/N 真作弊与 BP 照走）。验证=solodance-8 集合 bt-v224（T226 卖出侧）：LAB +225.81%/개구리씨 +138.48%、6 死盘全拦（湖南/ZEC 腿层、Willow/Fomies/庄周/吕吕 FP 层）、净 +0.7286/胜率 100%。前期否证留档：T215 ③线无分离度、出口口径画像修正（latch 占流通 vs 占首笔量）、FP 臂差集 famous/tail/pvp 盲区修复（T225 三修）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 18,
      "pointType": "famous_participation_pit",
      "condition": "tokenAgeSec >= 20 AND tokenAgeSec <= 300 AND buyVolumeBnb >= 3 AND athVsFloorPct <= 200 AND mcapFromPeakPct <= 62 AND (currentVsLaunchPct <= 28.5 OR earlyReturn < 15) AND currentVsLaunchPct <= 33.5 AND famousLifetimeBuyBnb >= 0.5 AND (max5sRisePct <= 50 OR famousEarlyBuySharePct >= 30 OR launchMinVsFloorPct < 5) AND (famousLifetimeBuyN >= 3 OR (famousLifetimeBuyN == 2 AND smartLifetimeBuyN >= 3)) AND famousFollowBlockMaxWallets <= 8 AND (famousLifetimeBuyN >= 5 OR anchorTickIsBuy == 1 OR anchor15sMaxBuyBnb >= 0.03) AND max5sRisePct >= 39 AND (priceMa60SlopePct IS NULL OR priceMa60SlopePct >= 0)",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": "priceBackToAlmostLaunch == 1",
        "fpRetry": 0,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "famous 参与坑臂（T238 2026-11-25 用户裁定「增加这个新的 pointType」+二修「那就不要要求非要完全离场。其实如果价格降低到位了，没有离场有什么关系？famous 持有并不是坏事」+三修「豁免 famous 特别多的（5 个或以上）……可能过拟合，如果之后发现问题再回退」+四修「都执行」〔ath 150→200 解锁 ChillGuy 190.65+龄下界 30→20 解锁小狗山 24s 点〕+五修「为什么没有限制 famous 的参与者数量？我应该是要求至少为 3 个」〔famousLifetimeBuyN≥3 必要条件——初版遗漏，T234 conviction N≥3 同款线移植〕+六修「N 为 2 的话，看看聪明钱的购买数量，如果超过 2，也可以豁免」〔N 必要条件加 smart 豁免臂：famous N=2 ∧ smartLifetimeBuyN≥3 也过——小狗山 24s 解锁；新键 smartLifetimeBuyN〕+七修「可以」×2〔龄上界 900→300 不吃尾气+buyVolumeBnb≥3 拒低交易量死盘；快速到峰卸货判据暂缓——小狗山 24s ath 72.6 早期小峰教训〕+八修「只控拉升斜率」〔(max5sRisePct≤50 OR famousEarlyBuySharePct≥30)：陡升∧famous 占比低=野拉盘拦——开源圣人 2s +74%/famous 30% 拦、来财 2s +109%/famous 66% 放；新键 max5sRisePct/famousEarlyBuySharePct〕+九修「破发豁免吧」〔OR launchMinVsFloorPct<5：binance quote 域真破发被 BNB 域键失真抹平案，线 5 救 4.22；代价奶龙 0 漏放〕+**十修（2026-11-27 用户指令「至少买入点位，在临近购买点位的趋势，应该是上涨的，而不是下跌的，否则就会接刀太多」+「把所有的命中票放到一个 case 集合里头，然后通过价格趋势做一下分析」）**：两臂 AND 进判据——①反弹下界 max5sRisePct≥39（与八修 ≤50 陡升门合成 [39,50] 带：坑里必须有像样拉升=正票全部经历过 ≥40% 的 5s 暴拉段〔famous 拉盘痕迹〕，9 张「没被拉起来」的负票死票被切；39=类整数线 40 偏移纪律，正票 p25=51.1 距 12pt）②趋势臂 (priceMa60SlopePct IS NULL OR priceMa60SlopePct≥0)——60s 均线斜率非负=临近买点趋势上涨〔T239 steady 腿同款键；null=龄<60s 放行，保住小狗山 24s 案源〕；三窗 79 命中票〔case 集合 famous参与坑三窗命中〕实证：两臂合计切 20 负 +0.565B、误伤仅猫头鹰 w1003 +0.024〔ma60 负但反弹成功〕、边际 +0.541B；集合 A/B 对拍逐位兑现〔A=v55-baseline 79 票 +0.6406 → B=v56 58 票 +1.1817，Δ+0.5410，未切票 pnl 差 0.0000〕；先例教训=面板扫描三候选门〔uniqueTraderCount≥12/recentBlockDropPct≥19.5/LongWin≤-5〕w1003 零误伤但 w1019 全翻车〔A 切 ChillGuy trader=23/B 切彪弟小狗山/C 切 4 大正票——LongWin 极负恰是 famous 快进快出本征〕，本修两键均慢变量且跨三窗方向验证+**十一修（2026-11-27 用户指令「把最近数秒的趋势一样也要改为向上，像 0x4754…7777 明显的下跌趋势票不能接」+「收益最大的几个票都是跌到底后反弹，而且快速拉盘不给低价时间，如果将趋势改为正，很多票会损失，就只能把价格要求放宽」）**：短趋势门 chg3Pct≥0+价格域放宽 curVs 上限 33.5→50——v57 A/B 实证 Δ−1.48B〔5 张庄操纵赢家 ChillGuy/彪弟/躺赢/VETO/超智整个生涯无 tick 同时满足趋势翻正+价格域永不触发，追高口径剩 36 票 5 正 31 负依然 −0.30B〕+**十二修（2026-11-27 用户裁定「回退到 v332 版本的策略。然后整个这个 pointType 设置为不激活……这个臂的起源是那几个被操盘严重的票，但是其盘形并不常见，通用价值不太行，要召回它们损失票就会太多，先恢复到最好的策略版本吧但是设置为不激活，之后如果再有想法再试试」）**：判据回退十修版〔chg3 门与 curVs50 全部撤销〕+ 类型 active:false〔分类跳过+专属腿不组装〕——类型经济性不成立：真实分布三窗盈利全靠庄操纵运气票，纪律化后不盈利；pointType 类型=famous_participation_pit〔PT41；PT37 初版 id famous_departure_pit 已随二修改名〕）。案源=来财 0xc84a…7777（金狗 JG 专题 5 票「希望进 famous 坑臂」召回研究）：famous 3 钱包 1s 内买 2.4B、4~16s 卖光（快进快出离场）→ 39~42s 坑位窗口 → 锚后 60s +103%/600s +1200%；对拍 bt-v262 +1.2966 案源完整兑现（39.2s p18 fire→+648%）、SI −0.0013 全豁代价首证。形状三锚：①参与痕迹 famousLifetimeBuyBnb≥0.5B（famous 名单全史累计买入额单调「参与过」口径——famous 参与过的盘，离场=坑更干净、在场=持有背书两可，PT38 起不要求离场；≥0.5 自身防「从未参与」票）②坑位域（curVs 双尺+athVsFloor≤200〔PT40 抬线：190=「高度不算高」、580/357=「开盘暴涨」仍拦，宽度控制留待后续〕+mcapFromPeak≤62，T234 同款线）③反弹确认（锚买盘门）+同块跟单≤8。**PT39 锚门豁免臂**：famousLifetimeBuyN≥5（新键 famous 全史参与钱包数）时锚买盘门豁免——famous 众多=最强买盘确认；彪弟案 6 F 钱包快进快出+86s 死寂点锚前 15s 无买（0.002<0.03）被锚门挡死但 famous 众背书下死寂点=拉盘方起点（锚后 600s +1195%）；豁免臂只开锚门（ath 线/域/龄照判）。刻意不放 act 冷窗族（开场 famous 大买大卖形状本征 act 窗必高——来财 30s act30s=13.4），低活跃风险由 policy 全豁（FP skip/AF1 pass/cheat skip/BP stuffingOnly，T234 定稿同款）+三锚兜底；引擎拉黑短路在门链外层保留。专属腿自触发（p16/p17 同款）：ladder 主流腿挂开盘簇门（首波 11 钱包+waves 3）30s 窗口零触发，无腿则类型空转。刻意不召回域外/超涨票（超汪汪队 39s ath 357+mcap 73.58 双锁「开盘暴涨」、小狗山 20:19 北京时刻=创建后 24s 点已由龄 20 解锁——T210「不求召回」同款定位）。验证=金狗集合 bt-v261 基线对拍（bt-v262 v18 包；bt-v263/264/265=v19/v20/v21 二三/四修对拍，5 票小集合 famous坑5票）+ 三窗生产分布（w1003/w1019/w1102 全命中 79 票，十修数据源）",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 19,
      "pointType": "steady_trend_climb",
      "condition": "tokenAgeSec >= 60 AND currentVsLaunchPct >= 30 AND currentVsLaunchPct <= 80 AND priceMa60SlopePct >= 5 AND priceMa60SlopePct <= 60 AND actTotalBnb30s <= 1.9 AND athVsFloorPct < 150 AND actTotalBnb >= 0.1 AND tokenAgeSec >= 15 AND chg10Pct >= 0 AND chg30Pct >= 0 AND anchorTickIsBuy == 1 AND (mcapFromPeakPct <= 30 OR launchMinVsFloorPct < 0) AND (lifetimeBuyVolumeBnb <= 12 OR launchMinVsFloorPct < 0) AND (sinceLastFamousBigBuySec > 60 OR sinceLastFamousBigBuySec IS NULL) AND (quietSpanMs >= 120000 OR actTotalBnb300s >= 0.5) AND (tokenAgeSec <= 1200 OR quietSpanMs < 300000 OR maxBlockBuyCircPct < 20) AND (tradesRouterPct < 90 OR chg10Pct >= 3 OR chg30Pct >= 3) AND freshWalletHoldPct < 80 AND (riseLegSec >= 15 OR (chg5Pct > 0 AND chg10Pct > 0 AND chg30Pct > 0 AND surgeStartSec >= 15)) AND (tradedBlkConcPct < 60 OR tradedBlkConcPct IS NULL) AND (tradedBlkChg5Pct >= 0 AND (tradedBlkChg5Pct < 40 OR tradedBlkConcPct < 60) OR tradedBlkChg5Pct IS NULL)",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": null,
        "fpRetry": 0,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "持续趋势臂（T239 2026-11-25 用户提案「金狗『上涨趋势形成后一直拉盘』『散户慢速拉升盘』两分类单独成立一个 pointType」+四项裁定：①价格域最多接受 +80%「先看召回」②斜率带 5~60%/60s+act30s≤3.9 双管（类整数线纪律 4→3.9）③policy 先全豁再收紧④前期暴拉断点先跑分布——分布实证无分离度刻意不加；pointType 类型=steady_trend_climb〔PT41，label「趋势成形-中低速持续拉盘-低位域入场-持续上涨币」〕）。用户方法（原话）「价格均值回归线，线是否往上（拒绝太陡峭的向上，也拒绝太平）」：新键 priceMa60SlopePct=MA60 均线在 60s 地平线上的涨跌 %。形状五键：①龄 ≥60s（趋势形成最短年龄——120s 与 curVs≤80 自相矛盾：30~80% 域窗多在前 120s，182 校准实证 age≥120 零候选窗）②域 30~80%（用户裁定「最多接受上涨 80% 的点位」——80 cap 本身即抗暴拉主闸：驴来 v30=134/WISP/PONZI 等快票全被域本身杀掉）③斜率带 5~60（<5=太平死寂、>60=垂直发射接盘期——CZ AI 71~176/BIAGENCY 51~78 全切）④act30s≤1.9（**PT47 二修 2026-11-25 用户裁定「砍吧」：3.9→1.9**——24h 全局 bt-v269 档层实证 [2,3.9) 档 23 票 −0.721/正票率 17.4%=高流量出货段形状；1.9=类整数线纪律 2→1.9；垂直段买量 5~19B/30s 全切、Percy 峰值 6.3 切尾段点知情接受）⑤athVsFloorPct<150（**PT48 三修 2026-11-25 用户裁定「先卡 athVsFloor 小于 150」**——案源 콕 0x42d5：多轮涨跌后回落点 ath 343% 被 MA 斜率惯性误入；严格 <150=历史峰值未超地板 2.5 倍，T234/T238 宽度控制同族）⑥chg30Pct≤30+反磨顶门(secSincePeak<15 OR mcapFromPeakPct>10)（**PT49 四修 2026-11-25 用户裁定「好，那就这么搞吧」**——纯数据优化收刀：暴起门=趋势要摊在时间上〔单变量扫线最优 +0.26，防冷寂后单 slot 拉盘；5s 窗实测杀大赢家不可用〕+反磨顶门=峰值近期或离峰≥10%〔合取净 +0.36，OAO/빵쏭/HSI6900 案源；单变量回撤下界全负=必须合取〕；跨窗验证 10-19/10-21）⑤ladder 全腿基线 actTotalBnb≥0.1+age≥15。182 校准（case_ticks 5s 网格，48 目标票=两标签∪17 反例=快拉标签差集）：召回 14/48（29%）——窗口 +300s 中位 2.00x、30min 内 ≥2x 95%（36/38）、反例渗透 1/17（BNB͏ 0xf8ab 同带黄金坑标签）；cap 扫描 120/150/200/300/500=召回 18/20/23/26/29、渗透 6/8/11/13/15——80 档后每抬档窗口质量缓降（≥2x 95→91→92→86→82→66%），用户裁定先 80 落 V1 跑真实回测再看放宽。门链=pointType 全豁 policy（FP skip/AF1 pass/cheat skip/BP stuffingOnly——慢速低活跃是形状本征，FP act 族/尾段/卸货臂结构性冲突，T236 slow_develop_early 同款论证；slow_grind_pump 即本类型形状本征 cheat 16 题跳过；引擎拉黑短路在门链外层保留；BP67 塞单门零成本兜底；「先全部豁免，然后再看如何收紧」）。⚠已知边界：calib 结局统计有金狗集合幸存者偏差，真实 A/B 以金狗回测对拍为准；已买入对照 我画地为牢/Muu-chan/AGENTINE 从 80 档起命中、RESILIENT/胖五（垂直票）不命中=形状筛选与可买性对齐；**T246 趋势确认门（2026-11-28 用户裁定「砍第一刀试试」+「这一臂被称为上涨趋势确认臂，肯定是必须基于上涨趋势没入的」+「增加过滤条件 riseLegSec 大于一定阈值（存在上涨趋势且持续一段时间），如果 chg5Pct chg10Pct chg30Pct 全正豁免」）**：尾门 AND (riseLegSec >= 15 OR (chg5Pct > 0 AND chg10Pct > 0 AND chg30Pct > 0))——案源范德彪 0x0fb1542a…7777（fire 22:27:12 落在 +87.67% 暴拉后 −12.93% 回调腿内 riseLegSec=0，但 chg5/10/30 全正 +2.2/+3.8/+9.6=打断后承接回升豁免通过）与蝴蝶人生2.0 0x0136e490…7777（+58.23% 拉升后 −11.77% 单笔 0.505B 大卖打断，fire 1s 后 chg 全正 +6.8/+15.2/+15.3 豁免通过）；N=15 初值=粗筛 579 信号 riseLegSec 分布〔0-5 桶 49 票/5-10 11 票/10-15 20 票/30+ 451 票；非豁免拒绝面 rl≈0 集中 23 票 +0.468B（含 AGI +0.77——存储 rl=0 为 fpRetry 重评快照，fire 时刻 rl=68s 主门通过，A/B 见真章）；5~20 之间非豁免仅 1 票=N 档位几乎无差别，15=「持续一段时间」保守起点〕；豁免臂覆盖 ≈97% 命中信号〔steady 腿固有 chg10>=0∧chg30>=0，豁免实际门槛≈chg5Pct>0=最近 5s 在涨〕；null 语义 fail-closed（riseLegSec/chg 族无可靠价=新门恒假不触发）；**T248 豁免臂加 surge 门槛（2026-11-28 用户裁定「落这个过滤试试」）**：chg 全正豁免再 AND surgeStartSec >= 15——「打断后承接」豁免只给已有 ≥15s 像样拉升段的票（案源范德彪 surge=35.2/蝴蝶 132.2 都过；恶心票 0x9f196c…7777 surge=4.2 第二段脉冲刚启动 4s 被拦——盘面=两个短上涨阶段〔23s+4.2s〕中间下跌、无上涨趋势但判据全过，pnl −0.106）；粗筛=豁免臂 59 票合计 −0.615〔rl<15∧chg 全正〕，surge≥15 门槛拦 35 票 −0.458（误伤 8 张小正票最大 +0.129）；等额捆绑线〔≥9 近似等额簇 ±1%〕同轮扫描仅 3 票命中〔含 1 正 +0.036〕覆盖面否决；surgeStartSec 键语义=最近明显拉升段起点距今秒数〔苏醒首笔 gap≥30s∧涨幅≥8% ∨ 苏醒前局部谷，取更晚；校准=−32° 案 11:00:25 放量突破/蝴蝶 21:35:01/中国龙 38s〕；**T249 块版集中度门（2026-11-28 用户裁定「那就 bc ≥ 60 好了」）**：尾门 AND (tradedBlkConcPct < 60 OR tradedBlkConcPct IS NULL)——块版集中度=zigzag 腿段内单块涨幅/腿总涨幅〔有交易块口径，时间版 conc 对活跃度不均的票失真：0x732b 案 9s +42.7% 时间版 80.1 虚高/块口径 16.05「9 秒是上涨区间中比较大的一块」；0x71fe 案 92s 静默+1s 5 笔等额拉盘 bc=100〕；60-90 区 55 票 −0.618 内部 5 档非单调不可再拆〔[60,65) −0.393 最差/[65,70) +0.037 唯一正档〕，bc≥60 整段杀 76 票 −0.868 误伤 18 张小正票〔最大 0x7c79 +0.121〕；IS NULL 臂=无当前上涨腿〔dir==-1 回调中，范德彪/蝴蝶形状〕放行由 T247/T248 门管——bc null 恒假不加臂会误杀豁免臂票；null 语义=腿涨幅≤0/块链缺 fail-closed 放行〔由其它门兜〕；**T250 块窗涨幅 c5 带门（2026-11-28 用户裁定「<0 按照我们理念应该砍，何况不赚就是亏（磨损很大），≥40 砍掉也没问题」）**：尾门 AND (tradedBlkChg5Pct >= 0 AND tradedBlkChg5Pct < 40 OR tradedBlkChg5Pct IS NULL)——只放行 [0,40) 带：<0=最近 5 个有交易块在跌〔0x5287 案 c5=−1.86 时间窗 chg30=+13.9 假阳〕砍、≥40=5 块内暴拉尾端〔12 票 −0.189 正 1〕砍；IS NULL=块数<6 放行〔cnt<6 的 20 票 +0.382 正 6，块数硬门槛已否决〕；c10/c20 不设门〔下端反向：c20<0 37 票 +0.980=深坑反弹买点；上端被 c5≥40 超集覆盖——c5 两端是块窗涨幅唯一可用形状〕；**T250 二修（2026-11-28 用户裁定「上端加 bc 联立：c5≥40 AND bc≥60 才砍，改一下吧，不用回测了」）**：上端改 (c5<40 OR bc<60)——0x209ed159 误伤案〔bt-v346 被砍 9 票唯一正票 +0.169：c5=41.24 但 rl=195s 长腿/bc=27.26 均匀健康，「长腿均匀票尾段加速」被裸 c5 上端误判暴拉〕；bc 联立后只砍「块集中且暴拉」真尾端〔0x71fe 型 bc=100〕；bc null 时 c5≥40 拦〔fail-closed，面极小〕；下端 c5<0 不动",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 20,
      "pointType": "market_maker_rhythm_pit",
      "condition": "tokenAgeSec >= 3 AND tokenAgeSec <= 60 AND actTotalBnb >= 0.1 AND tradesPerSecSinceLaunch >= 1.5 AND (blockGapLe1Pct64 >= 85 OR (mcapFromPeakPct >= 50 AND blockGapLe1Pct64 >= 75)) AND mcapFromPeakPct >= 40 AND currentVsLaunchPct >= 50 AND currentVsLaunchPct <= 200 AND (athVsLaunchPct < 400 OR chg30Pct > 20) AND chg30Pct >= 0 AND chg10Pct >= 0 AND chg5Pct >= -10 AND chg60Pct >= 0 AND chg300Pct >= 0 AND (gmgnProfiledBuyerPct <= 80 OR gmgnProfiledBuyerPct IS NULL) AND actTotalBnb30s <= 40",
      "maxExecutions": null,
      "buyPhase": "first",
      "signalGate": {
        "maxTriggers": 1,
        "recheckCondition": null,
        "fpRetry": 0,
        "bpPassLevels": [
          "good",
          "neutral"
        ]
      },
      "description": "做市节奏臂（T240 2026-11-25 用户提案「做市痕迹票：有庄在搞事，一般来讲会很强势」——金狗集合做市/操控 32 票实证，pointType 类型=market_maker_rhythm_pit〔PT50，label「做市节奏盘-每块有交易-机械阶梯拉盘-中途深砸次低价坑-闪电毕业暴拉币」，active:false 迭代期〕）。形状六键：①龄窗 3~60s（★刻意不含全腿 15s 抢速门——bt-v261 实证 32 票 28 张零信号：做市票 15s 时价格已 +200~500% 或已毕业，现行腿结构性够不着；3s 下界=节奏键至少 2 个间隔有据）②tradesPerSecSinceLaunch≥1.5（新 FA 键=全史笔数÷秒龄；做市中位 2.47 vs 对照 0.57，对照最高 1.23）③blockGapLe1Pct64≥85（新 FA 键=最近 64 tick 块间隔 ≤1 占比=「每 block 都有交易」的因子化；做市中位 95.1 vs 对照 61.2）④mcapFromPeakPct≥30（坑=拉盘中途深砸——深度≥30% 谷后回升≥50% 谷深，n=166 坑实证）⑤价格域（**v2 二修 2026-11-25 用户裁定「使用 curVs，阈值可以调整，但 earlyReturn 的定价太依赖首次购买的额度，可以作为辅助」**：主价键 curVs≤200〔平台地板锚稳定；v1=120 实测 bt-v262 闪电票零 fire——引擎口径坑谷分布+回测 debounce 200ms 评估网格双重夹击下单 tick 通过窗撞不上，组合扫描 200/30 档召回 7 张闪电票且假阳性面 10 最小〕OR 辅助臂 earlyReturn≤30〔首价尺救援兜底，扫描实测零边际〕）⑥actTotalBnb≥0.1（ladder 全腿基线）。实证基础（182 case_ticks+graduation 事件）：24 张闪电毕业票 flap 生命 9~72s（MINI CAO 17s +598%/币安生活 9s +955%/BABYSTAR 15s +597%，graduation 事件逐票核实）；节奏三指标与对照干净分离（30min 窗中位 tps 2.47 vs 0.57/blkCov 81% vs 17%/gapLe1 95.1% vs 61.2%）；早期窗（龄 3-60s fire 口径）MM 28/32 命中、对照 2/14（假阳性面以回测对拍定夺）；召回上限 ~10/28〔币安生活/BSI 类坑浅或坑晚于 +300%，任何合理线值接不住=「超快拉盘票不跟」自然边界〕。门链=pointType 全豁 policy（FP skip/AF1 pass/cheat skip/BP stuffingOnly——秒级生命 Jev 门物理赶不上〔awaitMs 15s 级 vs 坑持续 1-3s〕，做市形状天然触发 wash/slow_grind 假阳性〔一姐案 A_strong 同款〕；引擎拉黑短路在门链外层保留；BP67 塞单门零成本兜底；T234 定稿同款论证）。超快票（生命 <5s）live 物理接不住，用户裁定「可以不跟」——virtual 照抓，live 认漏。active:true（2026-11-25 翻 true 对拍 bt-v264 +3.8973 兑现；**v3 收紧 2026-11-27 用户 review 全局 fire 集后「先修一波」**：①坑加深 mcapFP 30→40〔价格再压〕②前期过热否决臂 athVs<400∨chg30>20〔标签 10/10〕③双轨已随 v4 撤销→无条件 chg30Pct≥0∧chg10Pct≥0〔用户裁定「近买点须上涨趋势/出坑再买」；出坑模拟推迟 10.8s/价代价 1.4%/正票率 +3pp〕④极端热帽 actTotalBnb30s≤40；**v5 节奏键深坑冷却豁免臂 gapLe1≥85∨(mcapFP≥50∧gapLe1≥75)**〔DYOR 案出坑时刻节奏键衰减 83~84 被卡〕；**v6 暴跌点位地板 chg5≥-10+长窗趋势 chg60≥0∧chg300≥0**〔用户裁定「1/5 分钟趋势全正拒绝接刀」「买入点位本身是暴跌也不行」；crashSpeed/市值线数据否决〕；**v7 actTotalBnb 0.1→2 已回滚（PT59）〔bt-v316 A/B 净 −0.66 否决；暴跌组/过热组两线数据否决〕**；**v8 龄下界 3→12 已回滚（PT61）〔bt-v317 A/B 否决：13 张 age<12 赢家仅 2 再触发，净 −2.28〕**；**v9 秒级暴跌地板 chg3Pct≥-5 已回滚（PT63）〔「临近买入的数秒在暴跌/买入时在暴跌」；bt-v318 A/B 否决：切 22 票含 7 正 −2.36 vs 15 负只省 +0.90+换点 −0.09 = 净 −1.56——深坑票 chg3 回正时龄窗/节奏键已衰减永久错过，fire 点扫描「切 18 票零正」被引擎打脸；同轮「买入前 block 涨跌」recentBlockDropPct 地板扫描否决——正票 rbd 中位 43.8 比负票 40.4 还深，任何线切 14~16/17 正，深坑入场天然在暴跌块里〕**；**v10 curVs 下界 50（PT64）**〔「做市代币价格前期不会太低」——fire 点扫描正票 curVs 中位 102 vs 负票 58，curVs<50 切 21 票〔2 小正 +0.035 vs 19 负 −0.739〕净 +0.70；出生价维度零分离否决〔bonding floor 恒定，<5e-9 切 4 正 1.87〕、fire 绝对价 <8e-9 否决〔Faceless 6.23e-9 被切〕；语义=离发行价太近的坑不做；bt-v319 A/B 兑现 +0.6608〕**；**v11 actNewTraders≥15 ∧ shortWin≤40（PT65）已回滚（PT66）**〔「因子过滤分析·胜率优先」；bt-v320 A/B 否决：净 −0.145——DYOR 头号赢家 +0.962 fire 点 actNewTraders=14 差 1 钱包被 15 线切掉永不回；面板 dump 漏 DYOR〔信号 strategyName=undefined〕+v315「拒 26(正1)」未查身份；actNewTraders 轴降线 ≤12 待重验〕**；**v12 shortWin≤40 单轴（PT67）已回滚（PT68）**〔「追高盘不接」；bt-v321 A/B 否决：净 −0.4597——DYOR 又被切〔引擎 fire 时刻 shortWin 51.07 vs 重放 23.98，净买环到达序尾 20 笔快变量 fire 点重放无法对齐〕；慢变量键扫描可信、快变量键不可信〕**；**v13 GMGN 画像保护臂 gmgnProfiledBuyerPct≤80（PT69）**〔「GMGN 钱包比例因子作为保护」——FA 新键=全史买家中画像库命中占比〔名单快照 5271 址〕；扫描 ≥86% 4 张全负、赢家天花板 SXSI 74、DYOR 64.3 距线 15.7pt；v10 之上边际 ≈+0.07；引擎 A/B=bt-v322 检验中〕〔买卖合计；T244 部件同款键极端尾部 12 张零正零右尾〕⑤earlyReturn 辅助臂移除）",
      "cards": 4
    }
  ],
  "sellLegs": [
    {
      "id": "stallCloseAlmost",
      "name": "流动性止损-无成交超时(almost_launch域90s)",
      "action": "sell",
      "priority": 0,
      "condition": STALL_LEG_CONDITION_TIER90,
      "cards": "all",
      "bypassDebounce": true,
      "cooldownSec": null,
      "maxExecutions": null,
      "stalledScanAfterSec": 45,
      "description": "T104/T118/T170b/T228i/T233 断流卖出腿·almost 域 90s 臂（2026-11-27 用户指令「可以拆分两臂，不要用 OR 连接」——原单腿 OR 版拆成两独立腿，各自落信号行=分档统计/分别 review；真值表逐位等价、两臂互斥）：距上笔足额成交 ≥90s 且 curVs≤+10（almost_launch 域）全清；idleSec 水位 null=阈值未注入 fail-closed 不触发；bypassDebounce=true 是机制成立前提（空窗零 tick 确认窗永不凑齐）；priority 0 全卖腿最高=保命方向（T228i 铁律：永久保留只可条件化调参）；进入 factorSellFilter 统一过滤（stall 签名 recoveryHold 豁免防冻结永久拦）。驱动=45s 预扫门+1s 评估（两引擎同款）"
    },
    {
      "id": "stallCloseBase",
      "name": "流动性止损-无成交超时(55s基础)",
      "action": "sell",
      "priority": 0,
      "condition": STALL_LEG_CONDITION_TIER55,
      "cards": "all",
      "bypassDebounce": true,
      "cooldownSec": null,
      "maxExecutions": null,
      "stalledScanAfterSec": 45,
      "description": "T104/T118/T170b/T228i/T233 断流卖出腿·基础 55s 臂（2026-11-27 用户指令拆分双臂，与 almost 域 90s 臂互斥）：距上笔足额成交 ≥55s 且 (curVs>+10 ∨ curVs null) 全清（破发档 d345c 否证不回迁；curVs null 不延长=基础档）；idleSec 水位 null fail-closed 不触发；bypassDebounce=true 机制成立前提；priority 0 保命方向；stall 签名 recoveryHold 豁免；驱动=45s 预扫门+1s 评估（两引擎同款）"
    },
    {
      "id": "mmShapeBreak",
      "name": "做市形态破位-浮亏全清",
      "action": "sell",
      "priority": 1,
      "condition": "boughtByPointType == 'market_maker_rhythm_pit' AND blockGapLe1Pct64 < 75 AND profitPercent <= -20",
      "cards": "all",
      "bypassDebounce": true,
      "cooldownSec": null,
      "maxExecutions": null,
      "description": "T240 做市专属卖腿（2026-11-27 用户裁定「走这一臂的，一旦明显失去了做市商形态，就得卖出，不能等流动性彻底枯竭」）：boughtByPointType=本仓买入臂 pointType（FA 写一次键，买成交点引擎标记、重启从 trade metadata 回填；null=非做市臂 → == 比较恒 false 惰性零影响其它臂）∧ blockGapLe1Pct64<60（64-tick 环破位=「每块都有交易」节奏死亡——环要 60+ tick 才衰减到位=天然持续确认）∧ profitPercent≤-20（破位时刻浮亏才卖——赢家洗盘停顿全部发生在浮盈段〔DYOR +65/Faceless +44/币安神学 +122〕，−20 线零误杀：负票 6/7〔Ghost Good −58/mib −54/指哪打哪 −44/企鹅微单 −36/FROGE −33/푸데푸데 −32，Namechanger −12 漏〕价差 +8.6~+40.6%；−10 线会误杀超级智能 −12〔破位持续 345s 后恢复最终 +0.219〕否决）；线 75（bt-v326 后用户质疑范围小——60 线检测滞后于价格崩塌，死票可捞只剩 3~5%/票；75 线扫描负票 10/19 中位 45s 破位价差 +42.1% vs 60 线 16.6%，赢家穿透由 pp 门挡=更早破位价格更高不可能浮亏）；bypassDebounce=true 立即卖（bt-v325 审计：确认窗 2tick 在破位死票上=10~60s 时延——mib 破位 +100s 实际 155s 才卖、Ghost Good 确认失败重来差 96s 反而更晚；gapLe1<60 本身是环级持续形状单 tick 抖动几乎不可能，pp≤−20 挡赢家浮盈停顿，两门即安全）；priority 1=stall 保命腿(0)之后、止损-40(2)之前；null 语义：boughtByPointType/gapLe1/profitPercent 任一 null → 恒 false 不触发（fail-closed）。走 factorSellFilter 统一过滤（pp≤−20<50 管辖不成立恒放行）"
    },
    {
      "cards": "all",
      "priority": 2,
      "condition": "profitPercent <= -40",
      "cooldownSec": null,
      "description": "止损臂-40（2026-11-04 用户指令：原 P0(-50)/P2(-35) 两臂阈值交叠——-35 恒先触发致 -50 成死腿，裁定两臂全删合并为单一 -40）：fire 时刻成本锚起算浮亏达 40% 全清；profitPercent null（无锚）→ 恒 false fail-closed 同 P0 口径；maxExecutions 刻意不设（卖出失败每轮重试直到清仓）；minTicks 8 继承原 -35 主止损确认门；断流冻结票归 stall 断流卖腿（T233 腿化，55s）管",
      "sellDebounce": {
        "minTicks": 8
      },
      "bypassDebounce": false
    },
    {
      "cards": 2,
      "priority": 3,
      "condition": "graduationProgress >= 0.9",
      "cooldownSec": null,
      "description": "毕业臂①（拱形v2 保留腿）：可靠价市值达毕业锚 90% 卖半（起步 0.9 留尘价余量）；迁移自 6f92e2f9 P3 原文，去 cycle==3 全周期可见（2026-10-06 裁定：17 腿唯 P3/P8 保留）；高价发行票 grad 超界（躺赢案 38.9）恒真触发秒卖——卖后 -49%~-74% 实证歪打正着",
      "maxExecutions": 1,
      "bypassDebounce": false
    },
    {
      "cards": "all",
      "priority": 5,
      "condition": "realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90 AND sinceEntryBuyBnb >= 1",
      "cooldownSec": null,
      "description": "T113 pump 失衡全清臂（2026-11-04）：成交后 30s 若盘面仍单边买（自入场累计净买比 >= 90 = 卖占比 <= 5%）→ 全部清仓——无真实对手盘的机器推盘趁推着走，等来的是 CD165/166/175/181/182 五 pump 案的 20 分钟 -50%+ 形状。v70 13 票探针实证：入场后 30s 仍 100% 单边买的 6 票中 4 票 -7%~-37%（比特币银行 -37/蝴蝶喊单 -32/蝴蝶池 -27/共建共赢 -7 全亏），仅 2 票 +4%/+7% 微利（30s 时点 pump 仍在推，早卖同向）；滚动窗载体 tradesNetBuyRatioShortWin 被入场前买潮污染接不住（S12@+30s >= 90 只中 3/6 票）→ 专用自入场语义。FA sinceEntryNetBuyRatio = 本仓成交锚（setBuyState 快照全史累计）以来的 (Σ买−Σ卖)÷(Σ买+Σ卖)×100，补买轮各自重锚；入场后零交易 → null 恒 false fail-closed（死盘归断流扫描/止损管）；与 FLAP世界/MAX 型「入场即反转」（30s 窗 48/21 已现卖压）刻意分轨——该形状由 D3.57 买侧拦截管，本臂只吃持续单边族。插位 rug-exit(2) 与 mcap-arc(10) 之间；maxExecutions 刻意不设（卖出失败每轮重试直到清仓）；bypass=false 走 3.5s+5tick 双门确认；回测差值口径 asOf 无关天然兼容。详档 docs/交易策略改进与Case台账.md T113 T165 v2（2026-11-17，bt-v140 05d2/bea7 双案）：确认窗腿级减弱 3500/5→2000/2——纯买单墙票（bea7 入场后 39 笔零卖 ratio 恒 100）fire 后 5-tick 证据在砸盘 tick 前凑不齐被掐（实跑 -7.9%；2000/2 在砸盘前最后纯买 tick +9.6% 成交，救回 +0.035）；再松档（1500/1 以下/阈值 80）放进有换手拉升票早卖砍利润（bypass 最差 -0.086），127 票矩阵 2000/2 唯一正收益档 +0.027；阈值 90 与全腿 bypass=false 裁定不动。 T168 v3（2026-11-17，bt-v140 fa99 0xfa99d9b5…7777 案）：买入额度门 AND sinceEntryBuyBnb >= 1——用户裁定「至少买入额度要有一定限制，不要一点小额度买就下车」；fa99 案 39s 内他人买仅 0.399B（一笔 0.197+尘埃单）零卖=净买比 100% 触发全清 +14.6%，卖后 10min +214.6%（真 pump 延迟到来，后续买 12.08B）。11 实验全触发面扫描（去重 5 次）：4 次卖早（0.399→+214.6%/0.895→+22.9%/1.183→+60.3%/1.348→+47.1%）、1 次（0.236）持有 10min 末仅差 1pp 非避险；v70 时代的崩盘保护对象（30s 单边买 4/6 崩）已被买侧门链结构性前置拦截，触发面变质为健康票首波拉升。定线 1.0：拦 0.399/0.236/0.895 三次，1.183/1.348 巨量形状保留逃生门；sinceEntryBuyBnb=入场锚以来他人链上买累计（不含本仓虚拟成交），未持仓 null fail-closed。",
      "sellDebounce": {
        "minTicks": 2,
        "debounceMs": 2000
      },
      "bypassDebounce": false
    },
    {
      "cards": 1,
      "priority": 7,
      "condition": "profitPercent > 100 AND chg5Pct < 0 AND chg30Pct < 0",
      "cooldownSec": 80,
      "description": "收益臂-100% 趋势化（2026-10-14 用户指令「持有收益超过 100% 卖出一个卡」；2026-11-24 用户裁定「如果还在上涨趋势就延迟，如果已经处于下跌就放行，作为一个盈利落定腿」→ 加 chg5∧chg30 双负动量门）：fire 时刻成本锚起算收益超 100% 且短长双窗动量同负（趋势已转）才卖 1 张卡——上涨中双窗为正延迟让利润跑，转跌即落定；80s 冷却内不再触发本腿；profitPercent/chg 任一 null（无锚/未见可靠价）→ 恒 false fail-closed；maxExecutions 刻意不设（冷却即节奏上限）",
      "maxExecutions": 2,
      "bypassDebounce": false
    },
    {
      "cards": 2,
      "priority": 8,
      "condition": "graduationProgress >= 0.98",
      "cooldownSec": null,
      "description": "毕业臂②（拱形v2 保留腿）：≥0.98 再卖半（若①已触发余半仓的 50%）；迁移自 6f92e2f9 P8 原文，去 cycle==3 全周期可见",
      "maxExecutions": 1,
      "bypassDebounce": false
    },
    {
      "cards": 1,
      "priority": 11,
      "condition": "peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap < 8.1",
      "cooldownSec": 60,
      "description": "T99 拱形回撤收紧·低市值档 -25（2026-10-29 用户指令加两臂+纠正「只是卖一个卡，不是全清」）：峰值利润 >=10% 武装 + 距峰回撤 25% 卖 1 卡（cards=1 max1 恰一次，dd 回升再落不重卖）。三层梯队：T80 -15 减 1 卡（13.4-27，p10 先评）→ 本腿 -25 减 1 卡（p11）→ 拱形 -35 全清（同 priority 数组序在后=深跌兜底）+ >=27 档 -25 全清。SPERM 案（0x0590…7777）动机：峰 +43.3% 回撤 -35 首真 05:05:31 → 3.5s+5tick 确认窗 fire 时已 -41.1%；-25 首真 05:05:27 早 4s=确认窗前移。低档 <7.4 段 P4 地板臂（p4 全清）同刻双真先评=直接全清，本腿在该段被压制（少卖余 2 卡，观察点）。dd null（未武装/无峰）→ 恒 false fail-closed；marketCap=fire 时刻实时市值（BNB 域，刻意非 peakMarketCapSinceLastBuy） | 2026-11-04 用户指令：maxExecutions 1→4、cooldownSec 60——持续/反复满足回撤条件最多减 4 张卡（4 卡票可打光），每 60s 一张；原 max1 恰一次语义退役；同批 P4 地板族退役，低档 <7.4 段 P4 同刻压制关系解除",
      "maxExecutions": 4,
      "bypassDebounce": false
    },
    {
      "cards": 1,
      "priority": 11,
      "condition": "peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap >= 8.1 AND marketCap < 27",
      "cooldownSec": 60,
      "description": "T99 拱形回撤收紧·中市值档 -25（2026-10-29 用户指令加两臂+纠正「只是卖一个卡，不是全清」）：峰值利润 >=10% 武装 + 距峰回撤 25% 卖 1 卡（cards=1 max1 恰一次，dd 回升再落不重卖）。三层梯队：T80 -15 减 1 卡（13.4-27，p10 先评）→ 本腿 -25 减 1 卡（p11）→ 拱形 -35 全清（同 priority 数组序在后=深跌兜底）+ >=27 档 -25 全清。SPERM 案（0x0590…7777）动机：峰 +43.3% 回撤 -35 首真 05:05:31 → 3.5s+5tick 确认窗 fire 时已 -41.1%；-25 首真 05:05:27 早 4s=确认窗前移。低档 <7.4 段 P4 地板臂（p4 全清）同刻双真先评=直接全清，本腿在该段被压制（少卖余 2 卡，观察点）。dd null（未武装/无峰）→ 恒 false fail-closed；marketCap=fire 时刻实时市值（BNB 域，刻意非 peakMarketCapSinceLastBuy） | 2026-11-04 用户指令：maxExecutions 1→4、cooldownSec 60——持续/反复满足回撤条件最多减 4 张卡（4 卡票可打光），每 60s 一张；原 max1 恰一次语义退役；同批 P4 地板族退役，低档 <7.4 段 P4 同刻压制关系解除",
      "maxExecutions": 4,
      "bypassDebounce": false
    },
    {
      "cards": "all",
      "priority": 11,
      "condition": "peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -45 AND marketCap < 8.1",
      "cooldownSec": null,
      "description": "拱形v2-A 纯兜底腿·市值三档（2026-10-16 用户指令，7cat 0xffa4aef3…db7777 案：48s 阴跌 -42.5% 触发后 60s 内 V 反 +97%，卖在 V 底前 1s）：峰值利润 >=10% 武装 + 按当前市值分档回撤容忍全清——marketCap<6000 容忍 -45（低市值波动噪声大）/6000-20000 保持 -35/>=20000 收紧 -25（高市值回撤 25% 更危险快跑）。marketCap=fire 时刻实时市值（USD，同买腿 15K 门因子）；刻意非 peakMarketCapSinceLastBuy（2026-10-06 砍档裁定针对的失真因子不复活）；marketCap=0（无价票）落 <6K 档但 dd null -> 恒 false 不触发（fail-closed 原语义保持）；dd null（未武装/无峰）-> 比较恒 false 不触发（fail-closed）；本臂=低市值档 -45 | 2026-11-04 用户指令：回撤阈值 -35→-45（低市值档噪声容忍回深，向本模板原文低档 -45 回归；中档 -35/高档 -25 不动）",
      "maxExecutions": 1,
      "bypassDebounce": false
    },
    {
      "cards": "all",
      "priority": 11,
      "condition": "peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -35 AND marketCap >= 8.1 AND marketCap < 27",
      "cooldownSec": null,
      "description": "拱形v2-A 纯兜底腿·市值三档（2026-10-16 用户指令，7cat 0xffa4aef3…db7777 案：48s 阴跌 -42.5% 触发后 60s 内 V 反 +97%，卖在 V 底前 1s）：峰值利润 >=10% 武装 + 按当前市值分档回撤容忍全清——marketCap<6000 容忍 -45（低市值波动噪声大）/6000-20000 保持 -35/>=20000 收紧 -25（高市值回撤 25% 更危险快跑）。marketCap=fire 时刻实时市值（USD，同买腿 15K 门因子）；刻意非 peakMarketCapSinceLastBuy（2026-10-06 砍档裁定针对的失真因子不复活）；marketCap=0（无价票）落 <6K 档但 dd null -> 恒 false 不触发（fail-closed 原语义保持）；dd null（未武装/无峰）-> 比较恒 false 不触发（fail-closed）；本臂=中市值档 -35（原 2026-10-06 单臂口径）",
      "maxExecutions": 1,
      "bypassDebounce": false
    },
    {
      "cards": "all",
      "priority": 11,
      "condition": "peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap >= 27",
      "cooldownSec": null,
      "description": "拱形v2-A 纯兜底腿·市值三档（2026-10-16 用户指令，7cat 0xffa4aef3…db7777 案：48s 阴跌 -42.5% 触发后 60s 内 V 反 +97%，卖在 V 底前 1s）：峰值利润 >=10% 武装 + 按当前市值分档回撤容忍全清——marketCap<6000 容忍 -45（低市值波动噪声大）/6000-20000 保持 -35/>=20000 收紧 -25（高市值回撤 25% 更危险快跑）。marketCap=fire 时刻实时市值（USD，同买腿 15K 门因子）；刻意非 peakMarketCapSinceLastBuy（2026-10-06 砍档裁定针对的失真因子不复活）；marketCap=0（无价票）落 <6K 档但 dd null -> 恒 false 不触发（fail-closed 原语义保持）；dd null（未武装/无峰）-> 比较恒 false 不触发（fail-closed）；本臂=高市值档 -25",
      "maxExecutions": 1,
      "bypassDebounce": false
    },
    {
      "cards": "all",
      "priority": 10,
      "condition": "mcapPeakBnb > 20.1 AND secSinceMcapPeak >= mcapRiseHalfSec AND mcapRiseHalfSec >= 60 AND chg5Pct < 0 AND chg30Pct < 0",
      "cooldownSec": null,
      "description": "T107 市值拱形时间全清臂（2026-10-29 用户裁定）：X=首次交易→最高市值耗时（token 全生命口径，首 tick 锚 write-once）；峰值市值超 15K USD（=20.1 BNB，T84 换算率 745）后，距峰已流逝 ≥ X/2 秒且未再破新高 → 全部清仓——涨多久跌多久没新高=拱形走完，时间维度与 T99 回撤深度维度互补（浅回落阴跌票 -25/-35 永远够不着，本臂按「再等半个涨程还没新高」截断）。峰=任意接受价轨（outlier/chainLate 不推、尘价照推，与 drawdownFromHighest 同峰同价流）；再破高 → 峰推进=计时归零+X 变大（X/2 只会长不会缩）；无接受价/totalSupply 缺失 → null 恒 false fail-closed（marketCap 族惯例）；首峰即首 tick（开跌即峰）X=0 → 过门即清（忠实口径）；**T228f（2026-11-24 用户裁定补丁）X 下限 60s：mcapRiseHalfSec >= 60——入场即峰（X<60s）不武装，由 P11 回撤族/毕业卖接管**（金狗集合 9/9 笔 arc 卖出全为 X=0 天花板秒清、7/9 卖后 +77~619%，T107「形状罕见」假设被数据打穿）；**T228h（2026-11-24 用户裁定「也可以改为上涨趋势不卖」）加 chg5∧chg30 双负动量门**——拱形走完但仍在涨势（MOYNOK 案 60s 均价 +22%）不卖，转跌才清；进程晚接管/回测窗口晚于真实首交易的票 X 低估 → 提前触发（保守出场方向）。maxExecutions 刻意不设（卖出失败每轮重试直到清仓）；bypass=false 走 3.5s+5tick 双门确认。FA 三键 mcapPeakBnb/secSinceMcapPeak/mcapRiseHalfSec（X/2 预计算——求值器无算术文法）。插位=T97 secSincePeak 腿前（p10 同档首中即赢：拱形完成全清 ⊃ T97/T80 减 1 卡）。详档 docs/交易策略改进与Case台账.md T107",
      "bypassDebounce": false
    },
    {
      "cards": 1,
      "priority": 10,
      "condition": "peakProfitPct >= 10 AND secSincePeak > 60",
      "cooldownSec": 60,
      "description": "T97 高点停滞减仓臂（2026-10-29 用户拍板：峰值利润>=10% 且距峰 >60s → 卖 1 卡，冷却 60s，最多 2 张）。定位=盈转亏主通道（P13 全清）前的时间停滞层先手减仓，与 T80 回撤锁盈（幅度层）同 priority 10 数组序在前=同 tick 双真先评时间层。secSincePeak 峰推进走任意接受价轨（outlier 不推峰、尘 tick 不卡尘门）与武装门 peakProfitPct 可靠价轨分轨。定标：5 天 113 episode 反事实 N=60 最优 +0.0109 BNB。",
      "maxExecutions": 2,
      "bypassDebounce": false
    },
    {
      "cards": 1,
      "priority": 10,
      "condition": "peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -15 AND marketCap >= 13.4 AND marketCap < 27",
      "cooldownSec": 300,
      "description": "回撤锁盈减仓臂·中档-15（2026-10-28 用户指令「增加 peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -15 AND marketCap >= 10000 AND marketCap < 20000 卖臂，冷却时间5分钟」）：峰值利润 >=10% 武装 + 从峰回撤 15% 在中高市值档（2026-10-28 用户修订 6K→10K）先减 1 张卡锁盈，持续满足每 5min 逐张减仓直到回落或清卡（P9 同款冷却节奏）；与拱形中档 -35 全清（priority 11）成梯队——本腿 priority 10 先评减仓保 V 反余仓，深跌 -35 由全清兜底；peakProfitPct=fire 价起算 running max（拱形臂同源）；dd null（未武装/无峰）→ 恒 false fail-closed；marketCap=fire 时刻实时市值同拱形臂口径（刻意非 peakMarketCapSinceLastBuy）；cards=1 为 P9 同款推断（带冷却的现役腿均为逐卡减仓；若意图为全清改本腿 cards）；maxExecutions 刻意不设（冷却即节奏上限）；bypass=false 走 3.5s+5tick 双门",
      "bypassDebounce": false
    },
    {
      "cards": "all",
      "priority": 1,
      "condition": "holdDuration > 3600 AND profitPercent <= 0",
      "cooldownSec": null,
      "description": "止损臂-时间（2026-10-13 迁自引擎级 stopLoss.timeStopMinutes=60）：持有超 60min 仍浮亏或持平全清（<=0 与引擎口径一致：断流冻结票 profit 恒 0 也要能触发）；断流票由 30s 持仓卖腿兜底扫描评估（同日上线）",
      "bypassDebounce": false
    },
    {
      "cards": "all",
      "action": "sell",
      "priority": 1,
      "condition": "sinceEntryFamousNearLaunchBuyBnb >= 0.5",
      "description": "famous 进场撤离臂 v3（T162 2026-11-17 2s 延迟，案 0xa32a8fd1…272477 FOM 跟单潮）：触发后等 2s 再全清——famous 进场引来跟单追买（触发面 2 票数据：+1s +7~12%/+2s +3~23% 皆正/+3s 潮头逝转负/+7s 峰 +35%），bypass:false+腿级 sellDebounce{minTicks:0,debounceMs:2000}（时间锚=0.5 线过线那刻；fire 重评 BuyBnb 单调 latch 恒真必卖；表达式拼 sinceLastFamousBigBuySec 路线被小笔过线案否决——过线笔 0.0736<0.1 大买线不刷新锚=零延迟失效）。金额门与区间 (10,40] 沿袭 v2（T136 来财案 0.5 线），T161 发行价上方域 (10,60] 三键与本腿两域并存",
      "sellDebounce": {
        "minTicks": 0,
        "debounceMs": 2000
      },
      "maxExecutions": null,
      "bypassDebounce": false
    },
    {
      "cards": "all",
      "action": "sell",
      "priority": 1,
      "condition": "peakProfitPct >= 80 AND drawdownFromHighestSinceLastBuy <= -35",
      "cooldownSec": null,
      "description": "高浮盈保护全清臂 v1（bt-v107 卖侧模拟立法 2026-11-12）：peakProfitPct >= 80 武装（期内可靠价轨峰浮盈曾达 80%+——大票专属资格）AND drawdownFromHighestSinceLastBuy <= -35（当前价距持仓期峰回撤 ≥35%，与峰同源离群剔除链负值）→ bypass 立即全清不等确认窗。bt-v107 52 轮 trailing 矩阵：无条件 15/20% 大负（洗掉拉升途中票）、25% 单票主导；G80/R35 Δ+0.86（+31%）误伤面最小——两波拉盘（来财）-0.014 零伤、慢拉（谷谷）未触发零伤、87%/92% 浮盈变亏票（b881/13d7）救回；28ad 锁利 +0.69。与 P11 族（10% 低武装+市值分桶+确认窗）分轨：P11 管低浮盈常态回撤分卡卖，本臂只管高浮盈大票快速锁利全清；未持仓两键恒 null fail-closed；maxExecutions 不设（卖出失败每轮重试直到清仓）",
      "maxExecutions": null,
      "bypassDebounce": true
    },
    {
      "cards": 2,
      "action": "sell",
      "priority": 1,
      "condition": "sinceEntryFamousLaunchZoneBuyBnb >= 0.2",
      "description": "腿 A famous 域内进场→2s 后卖 2 卡（T161/T162）：FA 因子 sinceEntryFamousLaunchZoneBuyBnb=本仓入场锚以来 famous roster 在发行价上方域（curVs ∈ (+10,+60] 地板锚，首版 80 收窄 60 防误伤好票）的可靠价买入 BNB 累计（T133 旧域 (10,40] 对低开票拉升段零命中盲区——Qmini 0x7008466b 案 famous 买 +52% 不计；两域并存互不污染）。≥0.2 即减半仓（低于 famous-entry-exit 0.5 全清门=阶梯：0.2 卖 2 卡→(10,40] 内 ≥0.5 全清）；T162 2s 延迟砸跟单潮头（bypass:false+sellDebounce 2000ms）；maxExecutions=1 成交口径一次即止（失败重试兼容）；未持仓 null fail-closed",
      "sellDebounce": {
        "minTicks": 0,
        "debounceMs": 2000
      },
      "maxExecutions": 1,
      "bypassDebounce": false
    },
    {
      "cards": 2,
      "action": "sell",
      "priority": 1,
      "condition": "sinceEntryFamousLaunchZoneBuyBnb >= 0.2 AND sinceEntryFamousLaunchZoneNetBnb <= 0",
      "description": "腿 B famous 域内全部砸光→立即再卖 2 卡（T161）：Net=域内买−域内卖 ≤0=famous 净清仓（砸存量老底仓同计=净撤退语义；Qmini 案 0.3456 买 55s 后砸 0.3576→Net=−0.012→阴跌 −6→−19.5% 四段止损引出）。刻意不加延迟（T162：famous 已在砸=跌势，等 2s 逆势）——bypass 立即路径；maxExecutions=1 同 A；A+B=4 卡全离场",
      "maxExecutions": 1,
      "bypassDebounce": true
    }
  ],
  "modules": {
    "factorCheck": "v1",
    "cheatCheck": "v2",
    "actFrontGate": "v2",
    "buyPointCheck": "v2",
    "pointType": "v1"
  }
};

async function main() {
  const { validatePack } = require('../src/web/services/StrategyLibraryService');
  const check = validatePack(PACK_DEFINITION);
  if (!check.valid) {
    console.error('FATAL 包校验失败（不入库）:\n  - ' + check.errors.join('\n  - '));
    process.exit(1);
  }
  const buyN = PACK_DEFINITION.buyLegs.length, sellN = PACK_DEFINITION.sellLegs.length;
  const mods = Object.entries(PACK_DEFINITION.modules).map(([k, v]) => k + ':' + v).join(' ');
  console.log('条目: ' + ENTRY_NAME);
  console.log('内容: 买 ' + buyN + ' 腿 / 卖 ' + sellN + ' 腿 | 断流卖出=stall 卖腿（' +
    (PACK_DEFINITION.sellLegs.some((l) => (l.condition || '').includes('idleSecSinceLastSubstantialTick')) ? '在包' : '不在包') + '）'
    + ' | burstCooldown=' + (PACK_DEFINITION.burstCooldown ? JSON.stringify(PACK_DEFINITION.burstCooldown) : '(关——2026-11-22 金狗伤害临时关闭)') + ' | modules=' + mods);
  for (const [i, l] of PACK_DEFINITION.buyLegs.entries()) {
    console.log('  📈 P' + (l.priority ?? '-') + (l.pointType ? '→' + l.pointType : '') + ' cards=' + (l.cards ?? '-') + ' mt=' + ((l.signalGate && l.signalGate.maxTriggers) ?? '-') + ': ' + (l.condition || '').slice(0, 72));
  }
  for (const [i, l] of PACK_DEFINITION.sellLegs.entries()) {
    console.log('  📉 P' + (l.priority ?? '-') + ' cards=' + (l.cards ?? '-') + ' bypass=' + (l.bypassDebounce ? 1 : 0) + ': ' + (l.condition || '').slice(0, 72));
  }

  if (!process.argv.includes('--commit')) {
    console.log('\n[dry] 校验通过，未写库（--commit 在 182 执行写入）');
    return;
  }
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const norm = (o) => JSON.stringify(sortKeys(o));
  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
      return out;
    }
    return v;
  }
  const existing = await svc.list();
  const cur = existing.find((x) => x.name === ENTRY_NAME);
  if (!cur) {
    const row = await svc.create({ name: ENTRY_NAME, description: ENTRY_DESC, definition: PACK_DEFINITION });
    console.log('\n✅ 已创建: ' + ENTRY_NAME + ' v' + row.version + '（id=' + row.id + '）');
    return;
  }
  const full = await svc.getById(cur.id);
  if (norm(full.definition) === norm(PACK_DEFINITION)) {
    console.log('\nSKIP: ' + ENTRY_NAME + ' v' + full.version + ' definition 无变化');
    return;
  }
  const row = await svc.update(cur.id, {
    name: ENTRY_NAME,
    description: ENTRY_DESC,
    definition: PACK_DEFINITION,
    expectedVersion: full.version,
  });
  console.log('\n✅ 已更新: ' + ENTRY_NAME + ' v' + full.version + ' → v' + row.version + '（引用实验重启生效）');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
}
module.exports = { ENTRY_NAME, PACK_DEFINITION };
