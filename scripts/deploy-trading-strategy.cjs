#!/usr/bin/env node
// 交易策略包部署脚本（T202 策略库二期，2026-11-20 立）——策略库唯一正式部署通道：
// 条目 = 完整交易策略包（买/卖腿 + stallClose/burstCooldown + 四检测模块版本键）。
//
// 内容来源（provenance，双源烘焙）：
//  * 买 14 腿 = ladder **v39**（v34 十四腿，T201 大户推迟已迁 FP32；v38/T224 黄金坑+v38/T225 独舞两臂并入；v39/T229 十四腿价格门早回场 OR 臂——详见 ENTRY_DESC 与台账 T229）——逐字取自退役前
//    deploy-signal-source-strategies.cjs 的 LEGS 产物（bt-v163 模板仍带 v33 条件串，
//    G2 未迁出，故买腿不走模板提取）；cards:4 为烘焙时按「卡牌张数入包」裁定统一补
//    （旧链由 clone Tier1 自动补，张数恒 4——bt-v163 实跑腿同值，bit 等价）。
//  * 卖 18 腿 + stallClose{55s,足额0.01} + burstCooldown{} 全默认 = bt-v163-all-arms-48h-
//    win1003（7d60bc05-8c4e-4f0d-993c-6f2d02428ea7，2026-11-20 现行最优模板）config 逐字提取
//    （16 条现行 + T161 famous-trim 两段）；提取规范化一处：卖腿「profitPercent > 100」
//    cards='1'（字符串）烘焙为数字 1（引擎 normalizeCards 等价归一，非策略变化）。
//  * modules 四键 v1 = 模板四门全开形状（FP32/D3.81/AF1/BP69 经 module-registry 解析）。
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

const ENTRY_NAME = 'trading-standard-v1';
const ENTRY_DESC = '现行最优交易策略包：ladder v39 十六腿（v34 十四腿+T224 黄金坑臂+T225 独舞臂 priority 17〔2026-11-23 用户裁定「把这个 pointType 对应的策略正式发布，合并到系统当前的交易策略中」——pointType strongbacker_solo_dance（PT19，policy actFront:pass+cheatCheck:g23NoE+臂豁免 fam_holding_thin/oversell_residual）；bt-v224 验证 LAB +225.81%/개구리씨 +138.48%/6 死盘全拦〕〔2026-11-23 用户裁定「把这个策略正式落定成当前策略的一部分」+「跟当前策略合并在一起」——T213~T223 系好散户币黄金坑买腿并入主包 priority 16 兜底臂〔T231：队列线 0.19+龄上界撤除；T232：冷窗 15s 线 0.4〕〕；T214/v35 初版强庄臂（firstBigBuyerHoldPct≥40 线）经 T215 命中面否证已回退留档——终版独舞九键重立为 T225）+ **T229 早回场 OR 臂**〔2026-11-24 用户指令「给常规的所有臂，也增加一个 earlyReturn 的或条件」——十四腿价格门改 (基线 OR (earlyReturn<15 ∧ curVs≤33.5))，GWC 0xb712 重生波回踩 30.26% 一窗错过案（JG-38 第二生命），常量与黄金坑臂同族〕+ 卖 18 腿（16 现行+famous-trim 两段）+ stallClose 55s/足额0.01（2026-11-24 用户裁定 50→55s——断流清仓延迟 5s，金狗 stall 卖点复流面）+ 五门 v1（FP32/D3.81/AF1/BP69）；T203 fpRetry=2 全买腿（2026-11-22 T203c 用户裁定「重评最多两次，一共 3 次」+「不需要延迟，只要 debounce 过了就行」——FP 拒后门内重评至多两次〔首评+重评共 3 评〕，重评间隔=debounce 节奏 200ms，30s 地平线；原 v2 fpRetry=1+间隔 2s 被 bt-v178 0xb6ee 案源本尊饿死）；burstCooldown 段已移除（2026-11-22 用户裁定「对金狗伤害太大」临时关闭 T189 两批卖出——批1/批2 承接窗对慢热承接形状结构性过短〔JG-4/13/19/34 攒批族：ZKind 24s 切+牛屁 29s 切均卖后 ×10 级〕，恢复=definition 加回 burstCooldown:{} 即可）';

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
      "condition": "tokenAgeSec >= 160 AND buyVolumeBnb >= 4 AND buyVolumeBnb <= 15 AND (currentVsLaunchPct <= 28.5 OR earlyReturn < 15) AND currentVsLaunchPct <= 33.5 AND athVsLaunchPct >= 40 AND athVsLaunchPct <= 100 AND mcapFromPeakPct <= 50 AND bigBuyersCount >= 3 AND bigBuyersHeldDust >= 3 AND actTotalBnb15s <= 0.4 AND actTotalBnb30s <= 0.4 AND actTotalBnb60s <= 0.5 AND actTotalBnb90s <= 1.0 AND actTotalBnb60Ex15 <= 0.15 AND actTotalBnb90Ex60 <= 0.1 AND famousFollowSlotMaxWallets <= 8 AND notoriousWalletCircPct <= 30 AND (anchorTickIsBuy == 1 OR anchor15sMaxBuyBnb >= 0.03) AND famousCopyWalletCircPct > 0",
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
      "description": "黄金坑臂（T224 2026-11-23 用户裁定「把这个策略正式落定成当前策略的一部分」+「跟当前策略合并在一起」——T213~T223 系 retail-good-path-v1 v18 买腿并入主包 priority 16 兜底臂；pointType 类型=famous_holder_cold_pit（旧名 retail_golden_pit）〔label「Famous入场-大户在场-长时间冷寂-有买入的低价坑-二波潜力币」〕）。形状=正常对倒票第一小波（ATH 1.4-2.0x）回撤 30-50% 后的域内坑位：龄 ≥160s 无上界（T231 2026-11-24 用户裁定「年龄没必要要求小于 900——这个模式空窗期长一些根本没关系」：0x4509…7777 案 12 分 10 秒断流把 famous 回场推到 910s——窗口关闭后 10 秒错过的黄金坑；交易了一段时间大户不肯卖）∧ 量 4-15B（早期未交易完）∧ 价格域双尺+硬帽（(地板尺 ≤28.5 ∨ 首价尺 <15) ∧ 地板尺 ≤33.5——接深坑拉回 MOYNOK 波首笔 30.13/8.2 案、不接极端背离 0x2c3fdb 94.12 案）∧ ≥3 个 0.19B 级大买家过尘线在场（T231 队列线 0.2→0.19——类整数线被 GAS 压线错过：0x4509 双胞胎累计 0.1975 差 0.0025） ∧ famous 底仓持有 ∧ 冷窗 15s≤0.4/30s≤0.4/60s≤0.5/90s≤1.0（T232 2026-11-24 用户裁定 15s 0.31→0.4：0x4509 fire 时刻 0.349 被 5s 前离场卖污染——由冷转热第一笔买入可能比较大，大的反而好）∧ 差额上界 60Ex15≤0.15/90Ex60≤0.1（用户裁定「act15s 比较大的时候 60s 与 15s 的差额要控制」+「还有个 90s」——火起前一分半都基本冷；MOYNOK 0.108/0 与 0x4509 0/0 零误伤）∧ famous 跟单 ≤8（2s 窗非 famous 买入钱包数全生命周期单调 max，0x2a05 同块 16 钱包挤爆案）∧ notorious ≤30（臭名昭著钱包集合 notorious-wallets.json 先只放 bf00）∧ 锚买门（锚 tick 是买入 ∨ 15s 内 ≥0.03B 买——死寂点不买等第一笔像样买盘落地，「所有后面要上涨的币都需要有买入」）。门链=pointType retail policy（FP cheatOnly+臂豁免〔slow_pump_unload/arb_bot_holdings〕/AF1 pass/CD g23NoSlowGrind/BP stuffingOnly——好散户币通路接纳策略）。刻意不带 ladder 尾部 veto 组（G1/G3/G4/G5/cheatCrew）——出生窗簇键对 160s+ 坑位语义不同、捆绑/作弊由 FP cheatOnly 臂+CD 16 题兜底（T216 裁定）。验证=89 票集合 golden-pit-35 bt-v215 +0.9147/6 票/胜率 83.3%/零亏损；跨窗初验 win1012 30898 票 4 命中 2 正 2 负。⚠buyPhase first 语义：集合票早期多被 ladder t0/t2 族先买——本腿为早期未被买走的票的坑位兜底/重启接棒臂",
      "cards": 4
    },
    {
      "action": "buy",
      "priority": 17,
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
    }
  ],
  "sellLegs": [
    {
      "cards": "all",
      "priority": 2,
      "condition": "profitPercent <= -40",
      "cooldownSec": null,
      "description": "止损臂-40（2026-11-04 用户指令：原 P0(-50)/P2(-35) 两臂阈值交叠——-35 恒先触发致 -50 成死腿，裁定两臂全删合并为单一 -40）：fire 时刻成本锚起算浮亏达 40% 全清；profitPercent null（无锚）→ 恒 false fail-closed 同 P0 口径；maxExecutions 刻意不设（卖出失败每轮重试直到清仓）；minTicks 8 继承原 -35 主止损确认门；断流冻结票归 stallClose（30s，T104 复活）管",
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
  "stallClose": {
    "stallMs": 55000,
    "minTickBnb": 0.01
  },
  "modules": {
    "factorCheck": "v1",
    "cheatCheck": "v1",
    "actFrontGate": "v1",
    "buyPointCheck": "v1",
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
  console.log('内容: 买 ' + buyN + ' 腿 / 卖 ' + sellN + ' 腿 | stallClose=' + JSON.stringify(PACK_DEFINITION.stallClose)
    + ' | burstCooldown=' + (PACK_DEFINITION.burstCooldown ? JSON.stringify(PACK_DEFINITION.burstCooldown) : '(关——2026-11-22 金狗伤害临时关闭)') + ' | modules=' + mods);
  for (const [i, l] of PACK_DEFINITION.buyLegs.entries()) {
    console.log('  📈 P' + (l.priority ?? '-') + ' cards=' + (l.cards ?? '-') + ' mt=' + ((l.signalGate && l.signalGate.maxTriggers) ?? '-') + ': ' + (l.condition || '').slice(0, 72));
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
