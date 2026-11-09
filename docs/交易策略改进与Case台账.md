# 交易策略改进与 Case 台账（卷一）

> **归档**：本台账 2026-10-25 建立，初始收录建卷前全部交易侧案（素材=auto-memory 详档 + git 历史；日期、commit 以案发时点为准，凭记忆整理处已标注）。

与 `docs/叙事引擎改进与Case台账.md` 对等的交易侧档案。分工：
- **叙事链路**（URL 分类 / 数据抓取 / Jev 题集 / 叙事门 / 评级 / case 回归）→ 叙事台账（C 编号）
- **交易侧**——买/卖腿门与策略库、因子口径、集中度与对倒、止损与毕业卖、live 执行与事故、回测与数据口径、引擎机制迁移 → 本台账（T 编号）
- 现行机制速览 = 项目 CLAUDE.md（本文不重复维护机制文档）；研究过程详档 = auto-memory（`~/.claude/.../memory/`，索引 MEMORY.md），本文收结论、关键数字与裁定

## 写作纪律

- 案号 T<n> 全局唯一不回收；新案插入所属分节**顶部**，号取全局 max+1
- 每案必带：日期、token 合约地址（symbol 重名不可靠）、事实/根因、裁定、验证数据；有单测则记名
- 已废机制标【已废】并注明继任；「版本」指 strategy_library buy-v2 版本或实验代号，谱系以 DB 各版本 legs 快照为准
- 归因「没买入」先查 strategy_signals + 引擎日志（无日志=条件评估恒假），tick 重放须用已 fire 票快照校准后再下结论（T8 三坑）

## 一、现行买腿门链一屏（buy-v2 v55 快照；live v67 起实跑本屏——T89 门放宽+二次入场+T90 人气门 AND+T91 集中度瘦身+T93 保护瘦身+T96 净买门换轨+T98 剔尘埃人气换键+T105 剔狙击趋势键+T106 删集中度两门/短窗净买 20+T108 GMGN bundler 组退役/CD1 反作弊分级门上线；**T110（2026-11-03）起条件 fire 后加买信号发射节流（3000ms∧10 ticks∧帽 5 全局机制，见 T110 案；**T120（2026-11-05）tick 增量门默认退役——缺省 0=只剩时间窗+帽，显式正值可恢复，见 T120 案**）**；**T115（2026-11-04）v71 实验级发射帽 5→2（第三次检测=退场段接刀观察，见 T115 案）**；早期臂已撤（T84 撤臂 2026-10-29）；**T108b（2026-11-02）起 v67 二次买入关闭（repeat 腿删）+首买 cards 3→4（v55）**——单卡 BNB 0.001，单票首仓 0.004；**T112（2026-11-04）起 v70 实验级变体：净买门拆臂去 netL、短窗 20→12 笔（见 T112 案；库 v56 未动）**）

**T117（2026-11-05）起并存第二条买腿门链——「初始买入信号源门链」（signalGate 腿，纯盘面）**：携带 `signalGate` 段的买腿 condition 语义变为**触发条件**，fire 且 signal 落库成功后依次走**作弊门（二元版，grade 直接决策不走腿表达式）→ 买入点位分析门（BP 门，good/neutral 过）**两门都过才买；无叙事/GMGN/preBuy 任何层（与七个旧门字段互斥 fail-fast throw/400，见 T117 案）。首版载体=库条目 `signal-source-ladder-v1`（**现行 v10 十一腿**：t0b 12 笔·1 BNB·6 真持有者起步即最早臂 + t2-t4 热度递升 + N30/36/45 纯热度 + NL15/20/25 接近发行价三臂（v9 起带 `tradeCount >= 10` tick 数源头门）+ **RL15 重启臂（v10 新增，用户条件串原文）**，v10 起七 t/N 臂加价格门 `AND currentVsLaunchPct <= 80`（low 上界）+ **cheatRecheck 布尔全删、`recheckCondition` 因子表达式接棒（CD381：早臂族=`preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1`、NL 三臂=`priceBackToAlmostLaunch == 1`）**，全腿 `buyPhase:'first'` 每代币只买一次；谱系 v1 七腿→v3 十三腿→v5 九腿回测腿形→v6 删 t0a→v7 删 t1 8 笔档→v8 增 NL 三臂→v9 NL 加 tick 门→v10 价格门+RL15+recheck 表达式，见 T117/T119/T121/T122/T123 案；卡牌形状：引用实验买腿宜配 `cards:4`+`perCardBNB:0.05`——缺省 1 卡下「卖 1 卡」即清光=阶梯退化，T122 bt-v79 案）；触发即消耗（maxTriggers=1，门拒/超时不返还）+ 耗尽腿评估期排除次腿顶上（阶梯接棒）；**回测受控解禁（T121，2026-11-07）**——实验 `backtest.signalGateReal:true` 真调门链（缺省 false=signalGate 腿全量排除恒拒现状不变）。⚠ 引用实验须 `buySignalMaxPerToken ≥ 11` + `cheatCheck.enabled=true` + `buyPointCheck.enabled=true`（BP 门 disabled=fail-closed 全拒零买入）。

```
(tokenAgeSec < 90 OR tradeCount >= 25)                    -- 时窗：90s 快窗 OR 慢热臂（T70/v39：非尘成交≥25 笔，去 600s 帽；preFilter age 无上界=不裁慢热票）
AND marketCap > 4.7 AND marketCap < 27                   -- 市值窗 BNB 域（T84/v43 起 priceBnb×totalSupply 全域 BNB 断代；v34 曾 USD 3.5K-20K）
AND (narrativeRating == 2 OR narrativeRating == 3)        -- 叙事过门（C84 触发模型）
AND holderTrendSlopeExSniper > 0                          -- 趋势（T105/v52：跳过有 tick 的前 4 个不同 block=狙击手段，第 5 块起 ≥4 点上涨才出键，<4 点键缺失 fail-closed；旧键 holderTrendSlope 转纯观察）
AND maxCopyWalletHolderCircPct < 20                       -- 跟单名单单钱包最大（NULL fail-closed）
AND famousCopyWalletCircPct < 15                          -- 极著名钱包（0 语义）
AND (buyVolumeBnb >= 1.25 AND holdersExDust >= 10)        -- 人气门（T90/v46 起 AND「量人双达标」防刷量/多钱包微买；**T98/v50 换键 holders→holdersExDust**——剔尘埃口径：净持仓按首可靠价折算 ≥0.015 BNB 才计持有人（10-29 追裁定 0.002→0.015≈$10.5，$10 以下钱包不算有效承接），刷 holder 的尘埃钱包（单笔刚过 tick 尘门 0.001）不计；无可靠价票退化=holders fail-open；阈值 10/早期 5 不动=口径变小同阈更严）
AND (tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 20) -- 净买门 AND 形状（T96/v49 换轨「短期开始涨，长期下跌趋势解除」∧ 长窗尾 100 笔净比非负；**T106/v53 短窗 40→20 放宽半档**——放行「短期温和上涨」形状；T88/v48 键名断代：长窗尾 100 笔 LongWin/短窗尾 20 笔 ShortWin，环空=null fail-closed/尾窗全卖=-100；阈值 40 承 T77/T70、20=T106；**T112（2026-11-04）v70 实验级：本行换 `tradesNetBuyRatioShortWin >= 20` 单门——netL 臂拆、短窗 netBuyWinTrades 20→12（factorParams 实验级覆盖，见 T112 案）**）
AND drawdownFromHighest > -70                             -- 崩盘接刀门①（v27）
AND crashSpeedPctPerSec > -10                             -- 崩盘接刀门②（v27）
```

**T93 退出三键 + T106 退出两键（纯观察键，FA 照算照落不进条件串）**：flap 路由门 `(platform != 'flap' OR tradesRouterPct >= 30)`（T70/v39 立——BI 案 router 份额爬坡独拦 12s，25s 行情里只剩拖慢）、`sybilClusterHolderCircPct < 60`（T72 立/T89 放宽 60——Meecot 案 100→59 稀释 150s 接顶全亏，sybil 高位票本身是关联簇拉盘形状）、`top2BundleClusterHoldCircPct`（T67 立/T91 后唯一簇门——换轴 top2HolderCircPct 前两大持有人合计）；**T106/v53 追加退出**：`top2HolderCircPct < 55`（T93 换轴门）+ `top1HolderCircPct < 35`（单钱包最大，T1 谱系）——持有人集中度门整族退役（T91 瘦身/T93 换轴/T95 早期臂放宽谱系终局），对倒/集中度形状改由 copy/famous 名单门+T105 ExSniper 趋势门+T104 stallClose 10s 快出接棒。

**T91a 流通分母口径（v47 起代码侧生效）**：全部 ÷circ 键分母=`max(_circTokens, Σ正净持仓)`——flap 税币零买入纯卖出钱包（初始筹码/税币接收方，Sell 在 Buy 永无）曾把 Σ买−Σ卖 分母压到低于真实在外筹码 → 键值虚高超 100%（孙权 top3=114% 案）；恒等式保证 ≤100、正常票逐输入 bit 不变。

第二层（条件串外，`gmgnCheckCondition`）：**T108/v54 起 bundler 组 `(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100)` 整组退役**（谱系：T82/v42 起 <8K→T84 10.7 BNB 早期豁免臂；bundler 门 v31 起 65→T89/v45 放宽 100=恒真死条件，删组与现行行为 bit 等价）；**buy-v2 v55 仅存叙事类型×issuer 分档门**（C85 适用集三类；event:W 已撤出=T73），GMGN API 失败 fail-open 放行（T14）；**buy-v2-repeat v4 整键删除**（T100 已删 issuer 臂后仅剩恒真组=GMGN 层不再真调 getTokenInfo，省配额）。GMGN bundler 维度的盘面形状改由 CD1 反作弊分级门接棒（同 v67 上线）。买腿 `maxExecutions=2`（**T89/v45 二次入场**：卖出后同腿可再成交一次）——**T108b 起 v67 repeat 腿整腿移除=二次买入关闭**（卖出后同票永不再进，库条目 buy-v2-repeat v4 留档可复挂）；首买 `cards=4`（T108b，v55）。

## 二、现行卖腿机制要点

- **sizing=卡牌唯一表达**（cards；sellPercentage 已退役 2026-10-24）；全清腿恒精确 1；卡账本 `cardTrade` 绝对值重放恢复
- 全部卖腿 bypass=false 走 **3.5s+5tick 双门槛确认**（首真起计不重置、断流票不得按陈旧快照卖、maxWait 逃生）；**T109（2026-11-03）起证据口径修正**：同笔链上 tick（txHash:logIndex）两段喂食双 touch 只计一份、扫描 null-touch 不凑证据（minTicks=5 恢复设计意图的 5 真笔），且卖腿可配 `sellDebounce:{minTicks,debounceMs,maxWaitMs}` 腿级覆盖（首真起算固化腿门）；**唯一例外 gang-trail-exit bypass=true**（T83：gang 曲线价纯函数无 tick=价格真冻结+App 确认分钟级人在环，与 AMM 快照失真语境刻意不同）
- 引擎级止损双腿（时间 `profitPercent<=0` / 价格）+ 断流票扫描兜底；用户裁定「所有卖出归卖出策略管」，现行实验以卖腿表达止损
- **T104 流动性止损 stallClose（2026-10-29 v63 起实跑；2026-11-02 v67 曾退役=用户指令「卖出臂中的断流臂（断流XX秒全部卖出）删除」；**2026-11-04 v71 复活（T114 用户指令「增加一个断流卖出的卖出臂，断流30秒以上，全部卖出」）——`stallClose:{stallMs:30000}` 配段即生效（机制代码留档未删的本意）**）**：持仓票距上一笔链上成交（FA lastTickAt）**>stallMs 全部清仓**——引擎级 `stallClose` 段（bypass 立即路径 + lockTokenAfterSell=false 放行再买臂），不配=关；实时 1s 墙钟扫描/回测 processTick 前虚拟时钟节流，10s 档回放净 +0.077 BNB/8d、代价=大票利润 −21%（详档 T104）
- 毕业卖：four.meme 市值/72 锚 + flap **资金口径**（池净入金，2026-10-24 替换价格锚）；live 毕业票路由 **PCS V2 外盘**（quote 盘二跳）
- 卖臂族：P4 市值清仓 4.5K / 120s 死票清仓 / rug-exit-account-arm（宣告账号删号删推→全清，v29）/ T79 地板 5500 全类目泛化（v43 起 5500+冻结 10s；**2026-10-28 追裁定冻结 10→16s**，现行 BNB 域形状 `<7.4 AND realHoldDuration>16 AND entryMcap 豁免臂`，v46 生效）/ **T80 回撤锁盈减仓臂·中档 -15（`peakProfitPct>=10 AND dd<=-15 AND 6K<=mcap<20K` 卖 1 卡 cd300s，priority 10 先于拱形 -35 全清；v44 `5be4c248` 2026-10-28 02:30 UTC 起实跑）** / **T97 高点停滞减仓臂（`peakProfitPct>=10 AND secSincePeak>60` 卖 1 卡 cd60 maxExecutions=2；FA 新键 secSincePeak=距持仓期峰值秒数；priority 10 数组序在 T80 前=时间停滞层先于幅度回撤层，打盈转亏 P13 全清之前；v55 编号被 T98 占用后重建 create-v56 换车，v56 `4ac10e23` 2026-10-29 04:05 UTC 起实跑）** / **T99 拱形回撤收紧 -25 下放低两档·减 1 卡（`peakProfitPct>=10 AND dd<=-25` `<8.1` 与 `8.1-27` BNB 两档卖 1 卡 p11/max1，三层梯队 T80 -15 减1卡→T99 -25 减1卡→拱形 -35 全清；SPERM 0x0590…7777 案 dd -41% 才 fire 动机；v58 `12ef2c48` 2026-10-29 起实跑）** / **T107 市值拱形时间全清臂（`mcapPeakBnb > 20.1 AND secSinceMcapPeak >= mcapRiseHalfSec` 全清 p10；FA 三键 token 全生命口径——X=首交易→最高市值耗时，峰值市值超 15K USD（=20.1 BNB @745）后距峰 ≥ X/2 秒未再破新高→全清；库 mcap-arc-fullclose v1，v65 `aed2091d` 2026-10-29 14:33 UTC 起实跑）** / **T113 pump 失衡全清臂（`realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90` 全清 p5；FA 新键 sinceEntryNetBuyRatio=本仓成交锚以来 (Σ买−Σ卖)÷(Σ买+Σ卖)×100，锚=setBuyState 快照全史累计差值、补买轮各自重锚、入场后零交易 null fail-closed；v70 13 票探针：入场后 30s 仍单边买的 6 票 4 亏 -7~-37%（比特币银行/蝴蝶喊单/蝴蝶池/共建共赢全亏）；库 pump-imbalance-exit v1，v71 起实跑）**
- 手动交易四按钮（live/virtual，2s 轮询 CAS + 停止卖出锁）
- **T114（2026-11-04）v71 卖臂大修剪——12 删 3 改 1 增，26→15 条**（详档 T114 案）：退役=P4 市值地板/死票族 4 条（快跑 3.5-4K/底部等待/地板 5.5K/死票 120s）、rug-exit-account-arm（去叙事后无推特检测输入）、超买止盈 T85/T78、T84 早期臂离场族 3 条（上位/protect20/600s）；合并=P0(-50)+P2(-35) → 单一 `-40`（minTicks 8 继承）；调参=T99 两档 -25 减仓 max1→**4**+cd**60s**、拱形低档全清 **-35→-45**；新增=stallClose 30s 断流全清（T104 复活）。**现行 v71 15 条：-40 止损 / 时间止损 1h / 毕业①② / T113 失衡 / 收益 100%+50% / T99 -25 两档(max4) / 拱形 -45/-35/-25 三档 / T107 拱形时间 / T97 停滞 / T80 锁盈 -15 + stallClose 引擎级**
- **T116（2026-11-04）GMGN 进场验证卖臂（默认关未接线）**：`fourmemeWs.gmgnEntryCheck` 段（enabled 显式 true 才开；flap 经 _mergedWsConfig 同键）——持仓 holdSec（默认 180s）检查点查一次 GMGN `wallet_tags_stat`（smart/whale/renowned 三类在场数，探针实证分钟级票已填充），全零=无人接力 → FA 五键（gmgnEntryChecked/gmgnEntryPresent+三类计数）→ 卖臂 `realHoldDuration >= 180 AND gmgnEntryChecked == 1 AND gmgnEntryPresent == 0` 全清；任一在场=entered 留仓；unknown（失败/未索引/tags 残缺）fail-open 不投影不误卖 30s 重试；write-once per 持仓轮+清仓自清理+再买入重置；回测零接线因子恒 null（详档 T116 案）

---

## 三、Case 档案

### 甲、买腿门与策略库

### T126 ladder v13 NL/RL 五臂量门提高：15 笔/2.5 BNB——冲高砸落小票放行收紧（2026-11-08；bt-v83 完整窗口 -1.9158 复盘裁定 B；commit `44ee397a`，同车 CD384 fail-closed=裁定 A，详档见作弊盘台账 CD384 段）

**动机（用户裁定原话「A/B 两个建议接受」）**：bt-v83 完整窗口（`b0b3bf11`，11-05 全量票 × v12 十三腿）净 -1.9158，其中 87 票净 -1.383 为 reset 截窗 fail-open 放行的 30~120 行生命周期小票（CD384 收 cheat 侧），量门侧「10 笔/1.5 BNB」对同形状小票无区分度——30 行票 tradeCount 也能到 20-30、1.5 BNB 买量几分钟凑满；87 票腿分布 NL15 19 票 -0.39/RL15 23 票 -0.28/NL20 6 票 -0.11/NL25 3 票 -0.08/NL 触发占比过半。腿级亏损全景（194 成交票）：t0b 27 票 -0.70/NL15 42 票 -0.60/NL20 21 票 -0.41/RL15 26 票 -0.28 全负，唯 t0a 36 票 +0.33 大正。

**改动**：NL15/NL20/NL25+RL15/RL10 五臂 `tradeCount >= 10→15 ∧ buyVolumeBnb 统一 ≥2.5`（NL25 原即 2.5 不变量门只抬笔数）——量门抬到 NL25 既有线五臂同线；t0a/t0b/t2-t4/N 系刻意不动（t0a 9 笔档为「点火即拉飞」早臂语义，t0b 27 票 -0.70 是 activity 豁免域问题非量门问题——豁免通道票留给门链侧处置）。腿数/结构/priority/recheckCondition 零变化（13 腿不变）；库 version 13→14。

**部署链**：本地 dry-run validateLegs 零错误（p9-p13 全 tradeCount >= 15 AND buyVolumeBnb >= 2.5）→ commit+push → 182 pull+`--commit` → strategy_library version 13→14（腿形变化=true）。

**验证（bt-v84 `cd5759bf` 完整窗口同窗重跑，11-08 达成）**：净 -0.4902（bt-v83 -1.9158）。NL/RL 五臂全收缩：NL15 42 票 -0.60→18 票 -0.1475、NL20 21 -0.4136→12 -0.2249、NL25 5 -0.1305→6 **+0.0589 转正**、RL15 26 -0.2779→6 **+0.0193 转正**、RL10 1→0 消失；同窗 t0a 36 +0.3295→22 +0.0855（部分 t0a 票本就是 reset 小票被 CD384 硬拒）、t0b 27 -0.70→24 -0.2308（activity 豁免域残余，非量门域）；正腿扩大（t2 +0.1451/t4 +0.0828）。完整差异分解见 CD384 段验证。

### T125 ladder v12 十三腿：t0a 更早人气臂（9 笔档）——「点火即拉飞」形状接住（2026-11-08；高大上 0x838657df…7777 单票回测零触发案）

**动机（用户裁定原话）**：「增加一个 tradeCount >= 9 AND buyVolumeBnb >= 1 AND holdersExDust >= 6 AND currentVsLaunchPct <= 80」（条件串原文直用）。案由：高大上 0x838657df…7777（06:43:53 创建→08:18:05 毕业 94 分钟 10.12x）单票回测（gaodashang-bp46=63a5c315，v11 十二腿）**全窗零触发**——FA 真重放确认「点火即拉飞」形状：前 13 分钟死盘（仅 1 笔 0.70 BNB）→ 06:57:05 第二笔 0.70 BNB 点火 2 秒 9 笔 → 06:57:07 tc=11 时 t0b（12 笔门）差 1 笔（curVs +47.4 其余三门全过）→ 06:57:11 tc=12 时 curVs 已 +82.5 破 ≤80 门（差 2.5 个点）→ 15 秒后 +368%→毕业。**量门攒够与价格拉离是同一场爆发**——t0b 十二笔门槛差一笔错过全窗。

**ladder v12 十三腿**（库 signal-source-ladder-v1 version 12→13，`scripts/deploy-signal-source-strategies.cjs`，commit 07e5903a）：

1. **t0a 更早人气臂新增 p1**：`tradeCount >= 9 AND buyVolumeBnb >= 1 AND holdersExDust >= 6 AND currentVsLaunchPct <= 80`——点火初段（tc 9-11、价格尚 ≤+80）即可触发；recheckCondition=RECHECK_EARLY（早臂族）；`buyPhase:'first'`/maxTriggers:1/cards:4 与全腿同。命名= v5 旧 t0a（6 笔档，v6 删）重生，参数不同（9 笔/1 BNB/6 持有者）注释留痕。
2. **priority 顺移**：t0a=1 起步即最早臂，原 t0b(1→2)/t2(2→3)/t3(3→4)/t4(4→5)/N30(5→6)/N36(6→7)/N45(7→8)/NL15(8→9)/NL20(9→10)/NL25(10→11)/RL15(11→12)/RL10(12→13)。
3. 引用实验须 `buySignalMaxPerToken ≥ 13`（腿数 12→13）+cheatCheck.enabled+buyPointCheck.enabled；谱系：v11 RL10 深重启臂 → **v12 t0a 9 笔档**。

**部署链**：本地 dry-run validateLegs 13 腿零错误 → commit+push → 182 pull + `--commit` → strategy_library version 12→13（腿形变化=true）。

**验证（gaodashang-v12=4b3fa2a9 单票回测，同窗对照 63a5c315）**：**t0a 触发达成**——06:57:07（点火后 2 秒、+47% 区）触发 p1 腿；cheat 门判 **cheat 三臂 pump,holdings strong**（A 主判拒）——死盘 13 分钟+2 秒爆发形状 activity_level 判 low（全窗 idlePct 极高），不在 CD379 豁免集 {high,ultra} → 原判保持拒，无 pumpExempt（豁免出口才打标）。零成交=门链设计内行为：单庄点火拉飞票 cheat 体系定性 pump 盘照拒（10x 毕业错过=「死盘点火」形状的已知保守面，与 CD380 四修「高活跃 pump 豁免+位置钳制」不冲突——该豁免域 activity high 以上，本票 low）。生产首跑对拍攒批（t0a 触发面分布/点火票 cheat 拒率/activity 边界票豁免面）。

### T124 ladder v11 十二腿：RL10 深重启臂（≤+10 含破发）——重启臂成对分档（2026-11-08；bt-s01 0x28ad2c7d cheat 翻案迟滞案同日收口链，CD380 三修/CD382 同车）

**动机（用户裁定原话）**：「再增加一个买入臂 tradeCount >= 10 AND buyVolumeBnb >= 1.5 AND currentVsLaunchPct <= 10」（条件串原文直用）。案由链：bt-s01 0x28ad2c7d 复盘——CD382 截窗+CD380 三修后 07:15:58（almost_launch 买窗内）cheat 翻案 healthy 达成，但生产翻案在 07:16:15（价格已 +70% 拉离）且 RL15 触发即消耗不返——**翻案速度与入场臂位置门联合决定 almost_launch 买窗能否吃到**；RL15（≤+20）在砸回段一旦触发消耗，破发深半区（≤+10）无臂可接。RL10=重启臂成对分档的深档：与 RL15 同 tradeCount/buyVolumeBnb 门槛，位置门更深（≤+10=almost_launch 深半区含破发）。

**ladder v11 十二腿**（库 signal-source-ladder-v1 version 11→12，`scripts/deploy-signal-source-strategies.cjs`）：

1. **RL10 深重启臂新增 p12**：`tradeCount >= 10 AND buyVolumeBnb >= 1.5 AND currentVsLaunchPct <= 10`——BP43 restart 第七桶的深档入场点（涨起后洗回 almost_launch 深半区/破发段=BP44「盘面重置判序」最优先形状）；recheckCondition=RECHECK_EARLY（`preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1`——重启臂天然要 almost_launch 重检）；`buyPhase:'first'`/maxTriggers:1 与全腿同。
2. 腿序 p12 追加在 RL15（p11）之后；引用实验须 `buySignalMaxPerToken ≥ 12`（腿数 11→12）+cheatCheck.enabled+buyPointCheck.enabled。
3. 谱系补一条：v10 价格门+RL15+recheck 表达式 → **v11 RL10 深重启臂**（T123 段谱系句同步）。

**部署链**：本地 dry-run validateLegs 12 腿零错误（version 11→12 UPDATE）→ commit+push → 182 pull + `--commit` → strategy_library version 11→12 回读 → 下次引用实验 copy-in 快照生效（改库不影响已建实验）。

**验证**：单测 `_test_signal_gate_engine` 119/`_test_cheat_gate_engine` 118 同批全绿（库形状变化不涉引擎代码）；生产首跑对拍攒批（RL10 vs RL15 触发分布/破发段入场前向收益/CD381 forceRecheck 联合）。

### T123 ladder v10 十一腿：全臂价格门 ≤+80+RL15 重启臂+cheatRecheck→recheckCondition 表达式接棒（2026-11-08；用户六条批量需求之 4/5，CD381/BP43 同车）

**动机（用户原话）**：「4. 所有的买入臂都要加入价格要求，都要在 low 范围内（现在除了强庄币开 low 外，其它都不开）」+「5. 增加买入臂 tradeCount >= 10 AND buyVolumeBnb >= 1.5 AND currentVsLaunchPct <= 20」（条件串原文直用）；同车需求 3「重检以或的形式放到作弊检测的因子表达式中，所有买腿都要加」=cheatRecheck 布尔全删、recheckCondition 因子表达式接棒（CD381 案，见 CD 台账——本侧只记库条目形状）。

**ladder v10 十一腿**（库 signal-source-ladder-v1 version 10→11，`scripts/deploy-signal-source-strategies.cjs`）：

1. **七臂加价格门**（t0b/t2/t3/t4/N30/N36/N45）：condition 尾加 `AND currentVsLaunchPct <= 80`——low 上界新档（BP43 六桶分界 low=+40~80）；null（未见可靠价）裸比较恒 false=宁拦不冒充，与 NL 臂 fail-closed 方向一致。NL15/20/25/RL15 自带 ≤50/…/≤20 价格门不加。
2. **RL15 重启臂新增 p11**：`tradeCount >= 10 AND buyVolumeBnb >= 1.5 AND currentVsLaunchPct <= 20`（用户条件串原文）——BP43 restart 重启盘第七桶的入场点载体（BP 侧判「交易量充分后洗回起点」的票，位置 ≤+20=almost_launch 档）；recheckCondition=RECHECK_EARLY。
3. **recheckCondition 两式接棒 cheatRecheck**：RECHECK_EARLY=`preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1`（t0b/t2/t3/t4/N30/N36/N45/RL15 八腿——早臂族语义：unhealthy 每信号重检 + 价格回到 almost_launch 重检）；RECHECK_STICKY=`priceBackToAlmostLaunch == 1`（NL15/20/25 三腿——高热度臂原 cheatRecheck=false 粘滞省配额，只有价格重检才真调）；全腿 signalGate `{maxTriggers:1, recheckCondition, bpPassLevels:['good','neutral']}`，cheatRecheck 字段全删（CD381 回落兼容字段，库条目不再携带）。
4. 引用实验须 `buySignalMaxPerToken ≥ 11`（腿数 10→11）+cheatCheck.enabled+buyPointCheck.enabled。

**部署链**：本地 dry-run validateLegs 零错误（version 10→11 UPDATE）→ commit+push → 182 pull + `node scripts/deploy-signal-source-strategies.cjs --commit` → 下次引用实验 copy-in 快照生效（改库不影响已建实验，须新建/换车）。

**验证**：单测 signal_gate_engine 119/cheat_gate_engine 118/validate_legs 同批全绿；生产首跑对拍攒批（重启臂触发面/价格门拦截分布/CD381 forceRechecks 计数）。

### T122 接近发行价三臂（ladder v8 十腿：NL15/NL20/NL25）+ FA 新键 currentVsLaunchPct + bt-v78 跑后两纠（2026-11-07；bt-v77 完整窗口复盘同轮两改之一，与 CD379 活跃度豁免同车）

**动机**：用户原话「参考购买前检测中『接近发布价』的判断，在买入触发条件中，增加一个 buyVolumeBnb >= 1.5 且『接近发行价』｜buyVolumeBnb >= 2 且『接近发行价』｜buyVolumeBnb >= 2.5 且『接近发行价』三个触发条件」——热度够+价格还贴发行价的入场点（BP near_launch 判据搬运：currentVsLaunchPct ≤ +50% 含破发）。

**FA 新键 `currentVsLaunchPct`**：`(state._relPriceBnb > 0 && state._relFirstPriceBnb > 0) ? parseFloat((100 * (state._relPriceBnb / state._relFirstPriceBnb - 1)).toFixed(2)) : null`——分子分母同可靠价链（与 BP snapshot 的 arc.last/rel[0] 同源；T98 尘门首可靠价冻结基准同源）；null=未见可靠价 fail-closed（裸比较恒 false 不触发=宁拦不冒充）；与 TPA `TPAPre_asofRelFirst`（审批时刻冻结快照）语义刻意分开（单测 F 段锁两键分叉：setAsofMs 后冻结键停、实时键推进）。FactorBuilder 快照白名单透传（fourmeme_fa_factors 白名单 132→133 键）。新单测 `_test_current_vs_launch_factor`（15 断言：精确值/冻结基准/null 语义/探针收键/透传/TPA 分叉/源码口径锁）。

**ladder v8 十腿**（库 signal-source-ladder-v1 version 8→9）：NL15 p8 `buyVolumeBnb >= 1.5 AND currentVsLaunchPct <= 50` / NL20 p9 `>= 2` / NL25 p10 `>= 2.5`——三条 cheatRecheck=true（t0b 早臂族同款每买信号重判）、无 tradeCount/holders 门=比 t 系更早可触发；引用实验须 buySignalMaxPerToken ≥ 10。

**bt-v78 首跑**（完整窗口对照 bt-v77，CD379 同车）：1461 信号 114 买（NL15 臂 243 信号 70 买=最大贡献者；t0b 228→34、t2 156→8、NL20/25 因首买已耗 0-1 买）29 赢 85 亏 **-0.00883 BNB**；**跑后用户两纠**：

1. **卖腿全清缺陷**：用户裁定「卖出应该是以卡牌的形式逐步卖出的……参考 Live 实验中的卡牌设置」+补充「一部分卖出臂是卖出一个卡牌仓位，还有的是清仓，不同臂设置不同」——bt-v77/78 卖腿只抄了 v74 的 3 条全清臂（p5 pump 失衡/p6 GMGN 进场/p10 mcap 拱），任何退出整仓倒；**bt-v79 换 v74 全量 16 腿卡牌阶梯**（1 卡×6/2 卡×2/全清×8：止损双腿+毕业两档 0.9/0.98+止盈 >100%/50% 卖 1 卡+峰回撤族 1 卡/全清混合+cd/maxExecutions 原样），perCardBNB=0.001 不变。
2. **BP10 翻案**（见 BP 台账 BP10 案）：insufficient_ticks 数据不足从放行改拒——bt-v78 中 **53/114 买入走 insufficient_ticks 漏网**（例票 0x18cf6407884dddfa54442a6becea915f850c7777 anchorTickCount=3 放行买入 15s 后止损 -0.00053，用户点名）；BP10 后这类票全拒。

**bt-v79**（1b1f9ee3）：bt-v78 基座+ladder v8 十腿+CD379 豁免+v74 全量 16 卖腿+BP10 拒——三改同车的干净窗口对照。

**bt-v79 跑中三纠（2026-11-07，用户三条裁定）→ ladder v9 + bt-v80**：

1. **卡牌买入形状修正**：用户观察 bt-v79「还是没有按照卡牌来卖出」+「应该是买入买 4 个卡牌，是不是买入就买了一个呢」——实证**判断正确**：bt-v79（及 v74 live 原配置）买腿无 `cards` 字段=缺省 1 卡（`cards ?? 1`，引擎 `_buyAmountFor` 口径），31 笔买入 input_amount 全 0.0010、31 笔卖出 cardTrade 全 `{before:1, after:0}`、**零票有第二次卖出**——持 1 卡时任何「卖 1 卡」腿 `min(cards=1, 余卡=1)`=清光，卡牌阶梯完全退化成整仓倒。裁定**买腿 cards=4 + perCardBNB 0.001→0.05（单卡 0.05 BNB、每笔 0.2 BNB）**——「卖 1 卡」=25% 仓位、卡牌语义真正生效；回测 initialBalance 缺省 100 BNB 资金充足。
2. **NL 三臂 tick 门（ladder v9，库 version 9→10）**：用户裁定「NL 三臂也根据问题调整一下，tickCount >= 10」——FA `state.tickCount`（846 行）与发射键 `tradeCount`（889 行）之间**零 return 恒等**（每进 FA 的 tick 两键同步 +1），且 BP 锚 `anchorTickCount`（落库行含尘 tick）≥ tradeCount ⇒ 条件串用 `tradeCount >= 10` 即用户所指 tickCount ≥ 10，且保证 NL 触发时 BP 锚窗必过 minTicks=8（三臂不再产生 insufficient_ticks；bt-v78 53/114 漏网主源头从触发侧封堵，BP10 拒从门侧兜底=双防线）。NL15/20/25 三臂条件变为 `tradeCount >= 10 AND buyVolumeBnb >= 1.5/2/2.5 AND currentVsLaunchPct <= 50`。
3. **bt-v80**（7a8ac18a）=bt-v79 基座+买腿库 v9 copy-in（全腿 cards=4）+perCardBNB 0.05——卡牌卖出形状+NL tick 门+BP10 三改同车的最终对照；bt-v79 跑完留档（BP10 拒效果对照仍有价值：买入信号/门链判定与 sizing 无关）。



### T121 回测门链真调受控解禁（backtest.signalGateReal）+ ladder v5/v6 两跑 + signals 页门链明细展示（2026-11-07；推翻 T117 裁定④「回测恒拒」，用户裁定基于 v73 时段数据回测真实调用 cheat+BP 门链）

**受控解禁机制**（缺省 `false`=恒拒现状 bit 不变，其它回测实验零影响——sim-8a51 等不受波及）：
- **服务层防前视+隔离**：`CheatCheckService/BuyPointCheckService.gateBuyPoint(..., opts)` 新增 `opts.anchorMs`——有限正数时 `_pullTicksDb` 的 tail/head 两查询均加 `.lte('block_time', new Date(anchorMs).toISOString())`（回测时 DB 已有全史，纯 tail 查询=拉信号时刻之后的行=马后炮；截窗后锚计数 anchorCountAt 语义不变=「≤anchor 行中最新 pullLimit 行」；生产不传=bit 一致）；`config.persist:false`（**回测恒由 BacktestEngine ctor 硬编码注入、不走实验 config**）→ `_writeRow` 跳过（stats.persistSkipped 留观测，**绝不写 cheat_detection/buy_point_analyses 全局表**——防污染生产 bootstrap/粘滞判定域）+ CheatCheckService `_bootstrapHistory` 直接 return（禁读生产历史行——生产判定锚窗≠回测锚窗，复用=秒回错判定）；进程内粘滞/拉黑/inflight 照常（回测进程内语义完整）
- **门链三方法搬 `core/AbstractTradingEngine.js`**（单一真相源）：`_cheatGateEvaluateBinary`/`_cheatGateHardReject`/`_bpGateEvaluate` + 辅件 `_projectCheatFactors`/`_cheatExitPosition`/`_cheatGateLateConsume`/`_sgTriggerCount`/`_sgRecordTrigger` 从 FourMemeWssTradingEngine 物理搬移，FourMeme 调用点 `this.*` 不变；`_cheatExitPosition` 内部 `Date.now()` 改可传 nowMs（FourMeme 调用点显式传 bit 一致、回测传虚拟时钟）
- **BacktestEngine 接线**：`_signalGateReal = config.backtest?.signalGateReal === true`——仅 false 时组装 `_sgExcludedIds` 排除集（现状锁定）；true 时 signal 落库成功后与 FourMeme 同位真调门链（metadata 三段 `signalGate/cheatCheck/buyPoint` 照落 signal 行，triggerNo 预读+1；`anchorMs` 传当刻虚拟时钟）；服务构造读 `config.fourmemeWs` 同键，不注入 waitIdle/pullTicks（无 collector/resolver——数据已在 DB 无 flush 边界，settleDelayMs:0）
- **单测**：`_test_cheat_detection_service`/`_test_buy_point_check_service` 补 anchorMs 截窗（lte 传参）+ persist 跳写/禁 bootstrap 断言；`_test_signal_gate_engine` 搬移后全绿；排除集条件化断言（false=组装、true=null）

**ladder v5 九腿首跑**（库 version 6，commit `41013aa9`；实验 `415749ba-8bac-418e-bfe2-04b8624973eb`「bt-v75」）：v4 十三腿删 t6 暴跌抄底整腿 + D25-D55 五档回撤臂（回撤族整体退役），增 t0a `tradeCount >= 6 AND buyVolumeBnb >= 0.75 AND holdersExDust >= 4` / t0b `>= 12 AND >= 1 AND >= 6` 两条更早人气臂，全腿 `buyPhase:'first'`（T100 纯配置零新代码）。源=v73 `c6efed13-ce9d-41b0-89a5-8ca8b029a609`（2026-11-05 11:31:27→13:45:10 UTC，both）窗；gate.awaitMs 60000 + settleDelayMs 0 + memSource 关 + `buySignalMaxPerToken 9`。**结果**：13 token 买入全平仓，合计 **-0.0020 BNB**（未平仓 0）。

**v6 八腿第二跑**（库 version 7，commit `c515da0b`；实验 `b67513a8-a389-4297-86d0-868a5b8eab1a`「bt-v76」）：用户裁定原话「去掉买腿 tradeCount >= 6 AND buyVolumeBnb >= 0.75 AND holdersExDust >= 4 再跑一次」——t0a 删除、priority 重排 t0b→1 … N45→8。**结果**：287 BUY 信号（腿触发分布 P1 t0b 48 / P2 t1 55 / P3 t2 39 / P4 t3 31 / P5 t4 31 / P6 N30 29 / P7 N36 27 / P8 N45 27）→ 作弊门 186 cheat 拉黑 + 81 unhealthy + 20 healthy（cached 粘滞 13）→ BP 门 20 assessed = 15 拒（poor/else_poor 10 + poor/pattern_gate 4 + poor/activity_gate 1）+ 5 放 → **5 笔买入全平仓全亏合计 -0.0010 BNB**（팔꿈치 매수 0x1ff6da98 -0.0001 / 29 0xdc191037 -0.0002 / SI 0x04a65d5c -0.0003 / 羊王 0x5a8d94c6 -0.0002 / 热搜拼好歌 0xcba062de -0.0002）；insufficient_ticks 放行 0。**persist 隔离验证**：cheat_detection/buy_point_analyses 按 source_experiment_id 与 analyzed_at≥回测窗双查**均零行**。

**两跑对照**：共同买入 4 token（팔꿈치 매수 0x1ff6da98 / SI 0x04a65d5c / 羊王 0x5a8d94c6 / 热搜拼好歌 0xcba062de）；t0a 边际=+8 token 买入（13 vs 5，竖琴海豹 0xbc6c3459 / 刘家郡 0x996e6d92 / 坟头蹦迪 0x1417a158 / SI 0x1f24d0af / SI 0xea7dc082 / 钱从四面八方来 0x6f1d06df / 玩币归赵 0x6c06ee23 / FOR 0xa7cc6168 / 小奶格 0x0710b38f）且 8 票全亏——**t0a 6 笔档更早入场点的票未被门链拦下且全亏，t0a 价值未证实**（删 t0a 后 v6 亏损同步减半 -0.0020→-0.0010）。

**v7 七腿第三跑·完整窗口**（库 version 8，commit `edc451b9`；实验 `ff1c8725-e6dd-46fb-a877-43fb6f463098`「bt-v77」）：用户裁定原话「tradeCount >= 8 AND buyVolumeBnb >= 0.75 AND holdersExDust >= 6 删除」——t1 8 笔档删除、priority 重排 t2→2…N45→7；**窗口 2026-11-05T00:00:00Z→13:45:10Z 完整一天**（源实验 token 集 3629 不变、ticks 全进窗；`forceRefreshCache:true` 防 BacktestTickCache token 集变化 STALE 增量静默缺行——缓存判定不看 addresses，token 集变化须全量重建）。**结果**：1153 BUY 信号 → 13 token 买入全平仓 4 赢 9 亏，胜率 30.8%，净 **-0.0008 BNB / -6.20%**（最好 0x78cd05cf +0.00053 / 最差 0x68690152 -0.00049）。**完整窗口兑现**：BP39 回归集 8 通过锚 token **全部产生 BUY 信号**（前两跑窗起点 11:31 锚在窗外结构性买不到——清零）；3/8 执行（0x275c17eb -0.00008 / 0xb88113c9 +0.00023 / 羊王 0x5a8d94c6 -0.00019），5/8 门链拒，拒因全挖出：**無為 0xb97d5772** cheat 拉黑 `A_strong:slow_grind_pump + R_abnormal_dominant + N_no_retail_entry0.0`（首信号即拉黑、后续 gate_blocked 秒回）；**SB 0x92aac04f** 前 2 信号 unhealthy[J_holdings_strong+M_hyper_activity]→第 3 信号起 cheat healthy 但 **BP 门 pattern_gate early_sniper_decay(0.58) 连拒 5**（锚窗 11-27s：athVsLaunchPct +82.2% ∧ currentVsAth −23.7% ∧ 开盘段占比 100%——正是 BP39「④开盘拉高出货盘」目标形状）；**Shellbank 0x24436292** unhealthy[N_no_retail_entry 6.7→5.3]×6；**RI 0xc88bf785** unhealthy[J_holdings_strong]；**CR 0xbcb27c14** unhealthy[D_famous_dominance+J_holdings_strong+R_abnormal_dominant+N0.0]×7。

**锚时刻错位实证（离线 BP 重析 vs 门链实判）**：BP39 离线 run 对同 token 不同锚时刻判定不同——RI S125 neutral(anchorTicks=11) / S126 poor·early_sniper_decay(32)；CR S138 neutral(11) / S139+ poor·famous_monopoly(48-188)。回测门链锚=信号时刻（阶梯腿各触发点），与回归集锚（成交时刻/腿首触发）天然错位；且 5 拒中 4 票拒在 **cheat 层**（离线 BP 重析不含该层）——「回归集通过锚」不等于「门链在信号时刻放行」，两口径对拍须锚时刻对齐后再比。

**三跑对照**：bt-v75 九腿 13 买 **-0.0020** / bt-v76 八腿 5 买 **-0.0010** / bt-v77 七腿 13 买 **-0.0008**（信号量 415749ba≈290→287→1153 随窗口放宽递增；三跑均零整体正收益，删臂轨迹 t0a/t1 的边际亏损贡献递减）；门链联合通过率 13/1153≈1.1%。

**signals 页门链明细展示**（commit `a9de5e78`，模板 `?v=4.32`；起因=用户看 v73 突突车 0x78cd05cf…777 「为什么没有买入」——该票实际买过两轮（P1 healthy+good 0.61 执行、P7 good 0.5 执行），P2-P5 BP poor 拒仅一行拒因不可读）：signalGate 段（legId/第 N 次·触发即消耗/BP 放行档/cheatRecheck/门序）+ cheatCheck「16 题档位明细」details（中文题名+英文键+词档徽章按严重度着色降序+L=数值）+ buyPoint 完整明细（综合徽章+p/rule/passed+质量题两行+九维度+「盘面锚值 N 锚」四列网格）+ `cheat_gate_*/bp_gate_*` 门链拒因中文映射。

**余留观察**：①门链联合通过率三跑 1.7%→1.1%，三跑零整体正收益票——触发条件侧（人气里程碑）与门链质量侧联合校准待更多时段样本；②回测门链 Jev 配额消耗速率未单独计量（gateAwaitMs 60s 下全程零竞速超时）；③cheat 拉黑 65%（186/287）与生产分布（CD158 系列）量级一致性待对照；④**两门语义张力待裁定**：無為 0xb97d5772=BP29 案「强庄教科书」翻案票（BP 侧 strong_backer=最好类型、三大户锁仓缓推），cheat 侧 D3.57 slow_grind_pump strong+A 通道拉黑——BP「强庄最好」与 CD「缓推机器盘拉黑」对同一形状结论相反，须用户裁定豁免链（候选=庄家身份非 famous+锁仓未卖不适用 A 通道）；⑤SB 0x92aac04f 门链实判 poor 与 BP39 新判据方向一致（开盘拉高出货目标形状），但该票未进 BP39 换代对拍集——离线 neutral 0.92 是 BP36 旧版判定，重抛对拍待做。

### T117 买入策略整体调整：signalGate 信号源门链（触发条件 → 作弊门二元版 → BP 门）+ 阶梯策略库条目 + FA 五触发键 + BP2 题面改版+引擎融合（2026-11-05 落码；用户方案「之前增加了买入点位的 Jev 分析，尚未跟实验引擎融合，我梳理了一下方案，不仅仅涉及买入点位 Jev 分析，算是买入策略的一次整体调整」）

**用户四裁定（2026-11-05）**：①**纯盘面**（新链路不看叙事评级，叙事引擎继续服务其他腿）；②**BP 通过档=good 或 neutral**（poor/insufficient 拒）；③**触发即消耗**（进门链就计数，门拒/超时不返还——7 条阶梯策略递进阈值=多次机会设计）；④**回测恒拒**（带 signalGate 的腿回测天然不触发）。

**机制（signalGate 腿字段，字段存在性即门）**：

- 腿归一化段 `{maxTriggers(缺省 1), cheatRecheck(缺省 false), bpPassLevels(缺省 ['good','neutral'])}`（`normalizeSignalGate` 单点，loadStrategies throw / validateLegs 400 同口径）；仅买腿可配；**与七个旧门字段互斥 fail-fast**（narrativeTrigger/Call/Prefetch、preBuyCheck、repeatBuyCheck、gmgnCheck、cheatCheckCondition——并存=两套门行为未定义）；StrategyEngine `evaluate` 加第 6 参 `opts.excludeStrategyIds`
- **门链块**（signal 落库成功后）：①`_sgRecordTrigger` 计数 +1（触发即消耗，进程态重启归零；落库失败不消耗）②作弊门二元版 `_cheatGateEvaluateBinary`：cheat→拉黑+清仓+signal failed `cheat_gate_cheat` 硬拒；unhealthy→signal failed `cheat_gate_unhealthy` 拒（**cheatRecheck=true 下个买信号重判 ≈CD158 现行；=false service 侧粘滞秒回拒省配额**——CheatCheckService `gateBuyPoint` opts 新增 `recheckUnhealthy`，默认 true=存量零变化）；healthy→过；**检测层故障（insufficient_ticks/fail/disabled/超时）fail-open 放行进 BP**（BP 门兜底）③BP 门 `_bpGateEvaluate`：assessed→bucket ∈ bpPassLevels 过/拒（`bp_gate_assessment`）；**timeout/fail/insufficient/disabled/异常全 fail-closed 拒**（`bp_gate_*` 域；disabled=配置矛盾 loud warn+signal failed）——BP 是点位判定唯一来源无据不买，与 cheat 门 fail-open 刻意不同向；通过/拒绝均落 signal metadata `buyPoint` 段（研究主数据）
- **计数三件套**：`_signalSourceTriggerCounts` Map<token, Map<legId, count>>；`_signalGateExcludedIds(token)` 耗尽腿 id Set 传 evaluate 第 6 参（**阶梯接棒**：t1 耗尽后次 tick t2 顶上）；signal metadata `signalGate` 段带 `triggerNo`（落库前预读 +1）
- **finally 收口补丁**：买路径退出点复查 cheat 拉黑补清仓（`cheat 迟到判定（买路径收口）`）——超时放行→迟到拉黑在 buying 窗内到达时 `_cheatGateLateConsume` 被拦截=持仓滞留缺口（CD158 秒级窗已有；门链串 BP 门放大至 ~30-50s 一并修好）
- **回测恒拒**：BacktestEngine loadStrategies 后一次性 `_sgExcludedIds`=全部 signalGate 腿（fail-fast 校验保留、运行期天然不触发）
- **透传白名单**：`signalGate: s.signalGate || null` 实时+回测两处（漏透传=门静默失效，v15 GMGN/v69 cheat 透传事故同款形状，源码锁）

**FA 五触发键（T117，t5-t7 条件原料）**：`recentBlockDropPct`（≤4 已闭合块收盘环+当前块实时收盘、1/2/3 块窗最深跌幅、环 <2 null、块号单调 guard 免疫乱序——迟到块丢弃不污染=刻意语义）、`mcapFromPeakPct`（100×(1−现价×supply/mcapPeakBnb)，任一缺失 null）、quiet 静默段三键 `quietSpanMs/quietSurgeBuyBnb/quietSurgeSec`（静默状态机挂 lastTickAt 更新**前**、gap≥quietThresholdMs（factorParams 缺省 60000）定格+重开 surge 波、surge 带 ts≥startTs guard 防迟到污染、quietSurgeSec 用 buildFactorMap 入参 now 禁 Date.now）

**库条目 `signal-source-ladder-v1`**（`scripts/deploy-signal-source-strategies.cjs`，本地 dry-run 零错误；182 --commit）：t1 `tradeCount>=8 AND buyVolumeBnb>=0.75 AND holdersExDust>=6`（cheatRecheck:true）/ t2 `>=16/>=1/>=9`（true）/ t3 `>=20/>=1.2/>=12`（true）/ t4 `>=24/>=1.5/>=12`（false）/ t5 `recentBlockDropPct>=12`（占位待校准）/ t6 `marketCap>0 AND marketCap<=7.5 OR mcapFromPeakPct>=60`（marketCap>0 前卫防 supply 缺失=0 误触发）/ t7 `mcapFromPeakPct>=60 AND quietSpanMs>=60000 AND quietSurgeBuyBnb>=0.5`；maxTriggers 全 1、priority 1-7（t1 最优先）

**BP2 题面改版+引擎融合**：题集版本 BP1→**BP2**（综合题按用户五条判读框架重写：①活跃度门槛②拉高拒+低市值豁免（mcapBnb ≈8-9 BNB 以下）③急砸抄底④阴跌流失拒（holdersDelta60 为负）⑤常态可买+激烈不合理拉盘拒）；snapshot 增 5 锚（mcapBnb/mcapPeakBnb/mcapFromPeakPct=priceArc×totalSupply 自算、holdersNow/holdersDelta60 两遍重放）；新表 `buy_point_analyses`（DDL `migrations/create_buy_point_analyses.sql`，182 手工执行）+ 新服务 `BuyPointCheckService`（五状态 assessed/timeout/fail/insufficient_ticks/disabled；settle 双模/mem 行环双源/首行 prompt 全文/冷却/inflight 镜像 CheatCheckService）；配置 `fourmemeWs.buyPointCheck`（flap 经 _mergedWsConfig 同键）——详档 BP 台账 BP2 案

**单测六件**：`_test_signal_gate_engine`（新，91 断言：双门全分支/计数三件套/互斥/透传源码锁/finally 收口）、`_test_signal_source_factors`（新，43：FA 五键手算/乱序语义/quiet 状态机）、`_test_buy_point_check_service`（新，26：五状态/迟到丢弃/首行 prompt/inflight/settle/冷却）、`_test_buy_point_lib`（扩至 144：BP2 版本+5 新锚+渲染+透传）、`_test_strategy_library_validate_legs`（扩 H 段）、`_test_fourmeme_fa_factors`（白名单补 T117 五键+存量欠账 73 键清点补登：T107/T113/T116/CD cheat 族/holderTrend——前批加键未同步白名单断言的欠账一并清）

**余留**：①182 手工 DDL（`buy_point_analyses`，DDL 先于代码红线）→ 182 `deploy-signal-source-strategies.cjs --commit` ②新虚拟实验（引用 ladder 条目+cheatCheck.enabled+buyPointCheck.enabled+**buySignalMaxPerToken≥7 显式**）③BP2 对拍（182 跑 `run.mjs --set bp-2026-11-03-live4` 232 点位，跑前知会）④冒烟观察门链三段 metadata（signalGate/cheatCheck/buyPoint）

### T120 tick 增量门默认退役：buySignalCooldownTicks 缺省 10→0（T110 双门拆单门；2026-11-05；用户翻案原话「关 ticks 门（我并未要求增加这个机制的）」+质疑原话「前期这个间隔的笔数太大了，何况我在买臂里头就增加了 tradecount 条件，为何还要再加一个机制」）

- **案由（v73 逐代币复审 #11 白猪AI `0x11e20998df0c514ae8c9e829f983bc2868a97777` 滑走 22.9%）**：t1 三键（tradeCount≥8∧buyVolume≥0.75∧holdersExDust≥6）06:19:06 第 9 笔首齐，但被 tick 增量门拦到**第 12 笔**才发射（06:19:06 之前 t6 v1 盲买腿 06:18:54 已发射记账——throttle 锚=lastFireTicks 当时 WSS 只到第 2 笔，12−2=10 恰满半开窗），@5.777→@7.099=**+22.9% 滑走**→ATH 成交→-40.2%。**结构性发现：token 级 throttle 锚=lastFireTicks 被任何腿的发射记账垫高（13 腿共享，t6 盲买腿 1.5s 触发即垫锚）——腿级里程碑设计被 token 级增量门整体后移**。
- **职能重叠论证（用户质疑成立，翻案依据）**：T110 立法时（2026-11-03）防重复职能=「担心纯时间窗在高频 tick 流下烧光次数帽」；T119 v3 十三腿上线后该前提消失——①**全腿 maxTriggers=1 触发即消耗**（per (token,legId) 计数，无重复发射形状）②**腿自带 tradeCount 里程碑**（8/16/20/24/30/36/45 七档天然间隔）③时间门 3000ms+发射帽（v74=13）兜底配额。tick 门只剩「延迟首发射」负作用。实跑拦截占比佐证：**v74 93/108（86%）、v73 2900/3212（90%）的 throttle 拦截来自 tick 门**（时间门只拦 10-14%）。
- **改动（缺省翻转，机制代码保留——0=关既有语义，显式正值仍生效）**：`BuySignalThrottle` 构造缺省 cooldownTicks `10→0` + 头注翻案段；`config/default.json` **三平台段**（fourmemeWs/flapWs/gangWs）`10→0`；两引擎构造注释同步；单测 `_test_buy_signal_throttle.cjs` A 组断言缺省 3000/5/10→3000/5/0（47 断言全绿）+头注 T120 段+**A9 组 tick 门全量用例保留**（显式传 10 的机制行为维持锁定——机制在、只是默认关）；创建页节流区块文案更新（「冷却ticks(0=关)」placeholder 0+T120 说明）。admit 挂点/半开窗/被拦不记账语义零改动。
- **部署链**：commit+push → 182 pull → v74 `7cb423af` config `buySignalCooldownTicks` 10→0（DB update）→ **重启前持仓确认**（live-restart-positions-check 铁律：卡账本净额口径）→ 重启进程生效。注意缺省翻转只影响「无显式配置」的新实验——v74 config 显式带 10 须 DB 改 0（clone 脚本 copy-in 的显式值优先于缺省）。
- **余留**：①冒烟验证=tick 门零拦截（tickDropped 不再增长）、时间门照常（cooldownDropped 正常计数）②throttle 锚垫高效应随 tick 门退役整体消失（时间锚同理被垫但 3s 窗小、非结构性）③未来翻案恢复=显式配正值即可（单测 A9 锁定行为不漂移）。

### T119 信号源阶梯 v3：13 腿多臂版——三条纯热度腿+五档回撤臂上车、t5/t7 删臂（库条目 signal-source-ladder-v1 version 2→3；2026-11-05 吉祥 0xea7886d5 复盘五轮裁定）

- **案（v73 `c6efed13` 票 `0xea7886d5…7777` 吉祥，复盘数据全 182 真跑）**：05:48 开盘 43 秒 45 笔急拉 → 首峰 $9.5k（13.3 BNB）→ 05:49:33 首波深回撤 -31.7%（vs 发行 +37%）→ V 反 ATH $29.7k。生产仅 t4@+88% 买入（信号时刻双截窗重析 t1=neutral 0.76 应过门——被 BP settle ~6s 锚窗漂移吞成 poor 0.90，settle 延迟治理归用户线 B11）。用户问「充分回撤点（05:49:33）为何没触发，有必要增加最高点下跌幅度的臂」→ 五轮裁定落 v3。
- **裁定链（五轮）**：①加臂（条件串用户给定原文）：三条纯热度腿 N30/N36/N45（`tradeCount>=30/36/45 AND buyVolumeBnb>=1.5 AND holdersExDust>=12`）+ 五档回撤臂 D25-D55（纯阈值+峰门 `mcapPeakBnb>=15`，AskUserQuestion 选定；不加活跃度门——BP 门 market_heat 已兜底）；②**急拉票回撤点 BP11 接受现状复裁维持**（见下实证）；③合并制探索（「间隔族/回撤族各合并为一腿、全部因子表达」）——`maxTriggers>1`+T110 节流机制版与 `tradeCount == N` 等值 OR 链全因子版均验证可行（求值器 ==/OR 支持、三防线 validate 通过），**用户否决：等值带被 debounce 吞**（买腿 signalDebounceMs 200 slot 合并+fire 重评，等值点窗尾重评时 tradeCount 已 +1=翻假丢里程碑；范围带 `>=N AND <=N+k` 能撑但每带一条=变相多臂）——「实在不好搞，还是原来的多臂方案」；④删臂：t5 急砸（`recentBlockDropPct>=12` 阈值本为占位）与 t7 跌底放量（`mcapFromPeakPct>=60 AND quietSpanMs>=60000 AND quietSurgeBuyBnb>=0.5`）两臂删除；⑤配额约束（用户明示「每一次触发要消耗 Jev 额度，但错过点位又很可惜，这是个折中」）：每触发=cheat 首析 1 Jev（healthy 粘滞后免）+BP 1 Jev，13 腿最坏 ~14 Jev/票。
- **v3 终稿（13 腿，priority 1-13，maxTriggers 全 1 触发即消耗）**：t1/t2/t3/t4 原样（cheatRecheck true/true/true/false）→ N30(p5)/N36(p6)/N45(p7) 纯热度（false）→ t6 低市值 OR ≥60% 深回撤（p8，v2 峰门版条件不动）→ D25(p9)/D30(p10)/D35(p11)/D45(p12)/D55(p13)（`mcapPeakBnb>=15 AND mcapFromPeakPct>=N`，全部 false）。排布=N30-45 插 t4 后 t6 前（流量里程碑递进）；D 臂浅到深排 t6 后——回撤进行时先穿浅档先消耗、加深后深档接力=「每个深度一次机会」；t6（低市值 OR 超深 60%）优先于 D 档可见。**引用要求：新实验 `buySignalMaxPerToken >= 13` + cheatCheck.enabled + buyPointCheck.enabled**；copy-in 隔离（v73 引用 v1 快照不动，v3 须新实验/换车）；mine-ladder 按名拉最新 version 自动跟进。
- **实证留档（182 真跑，部署依据）**：①全阶梯重放（含阶梯接棒+T110 节流 3s∧10ticks 串行消耗）——吉祥案 N30/N36/N45 实际触发落点 -4.7%/-15.6%/-14.9%（vs 发行 +70~92%）全在贴高段与 t2/t3 同域=BP 大概率 poor 烧配额，慢热票（0.2 tick/s 节流 10ticks≈50s）里程碑才摊开；②**峰门 15 意外后果**：吉祥首峰 13.3 BNB<15——D 臂在用户想要的 05:49:33 首波回撤点根本不触发，实际首触滑到 ATH 后贴高回落段（BP12 重析 poor 0.98 阴跌无反弹）；③首波点位 BP12 真跑：W25@-25%（前向 5 分 +267%）/W30@-30%（+290%）均 **poor 0.67**——BP11「maxChg5 过线+near_launch+浅回调」接受现状同形状，急拉票回撤点 BP 拒=设计内代价、回撤臂价值在慢推票（maxChg5 温和深回撤企稳=good/neutral 正路径）；④重放节拍=每腿 max(3s, 10 ticks)≈6-7s（快票 ~1.6 tick/s）。
- **删臂留档**：t5 recentBlockDropPct 与 t7 quiet 三键（quietSpanMs/quietSurgeBuyBnb/quietSurgeSec）FA 触发键保留无消费者——未来翻案可复用（FA 五触发键注释同步）。
- **部署链**：deploy 脚本回写 13 腿+注释五轮裁定链 → dry-run（validateLegs 零错误 v2→v3 UPDATE）+单测复跑（signal_gate_engine 92/validate_legs 46 全绿）→ 182 `--commit` version 2→3 回读 13 腿 → **换车兑现：v74 `7cb423af-9505-47c6-a200-79f77139908a`「v74-实盘-both-T119十三腿-CD376router-1105」2026-11-05 13:45:11 UTC 起跑**（用户指令「建74吧，router 的改良也一起上」；clone-v74 脚本防呆=库 v3 十三腿/t5t7 零残留/D 臂五档/源 v73 七腿 v1+帽 10/stallClose 30s+0.02/cheat·BP 双开/卖腿 16 全过 → 13 腿 copy-in+帽 13+refs v3×13；29 策略=13买+16卖装载确认、双平台 platforms=fourmeme,flap；**CD376 路由事件映射扩 5 源（cef0bcd4）随新进程生效**）。停机切换=零持仓确认（企飞文创 13:42:27 自清、国风 13:43:39 自清 -23%，266 token 净额全 0）→ v73 SIGTERM 12s 优雅停置 stopped 留行。顺带解决 v73 t6 v1 开盘盲买（v3 峰门版条件）。
- **v4 追加（2026-11-06 t6 双流动性门；v73 复审 T029/T032 案，库 version 3→4）**：t6 两臂（跌回低市值 OR ≥60% 深回撤）各加 `AND buyVolumeBnb >= 1.5 AND actBuyBnb >= 0.3`，t1-t4/N 腿/D 臂五档不动。用户指令「marketCap > 0 AND marketCap <= 7.5 需要加峰门/流动性门，这个希望能接住暴跌的底，而不是第一个 tick」（峰门 v3 已修首笔盲触发一半，v4 补流动性门；AskUserQuestion 裁定「actBuyBnb >= 0.3 跟 buyVolumeBnb >= 1.5 都加」）。双门语义：`buyVolumeBnb >= 1.5`=全局累计买入量（到过 15 峰的票近冗余，防极端无量形状）；`actBuyBnb >= 0.3`=近 10s 滑窗有人真金白银买=底部承接证据（防阴跌死盘底/首 tick 级盲触发）。**BPA-035 关联发现（T029 无税人生 t6#1 首笔触发）**：极早点即便过 BP9 insufficient_ticks 放行，BP15 活跃度门（market:low+activity:low 双 low）仍 activity_gate 拒——首笔入场结构性死路；v4 在触发层就拦掉无量首笔=不烧 cheat/BP Jev 配额。T032 FFFF=换代改善实例（BP2 good 0.49 放行吃到 -20.5% vs BP15 poor 0.64 拦）。阈值 1.5/0.3=用户裁定原值无分布依据待票池校准；13 腿数/引用要求（帽 ≥13+cheat·BP 双开）不变；v74 引用 v3 copy-in 快照不动，v4 生效须换车重引用（下次启动新实验按此）。

### T118 断流足额门：微量成交不算流动性证据（stallClose.minTickBnb ≥0.02 BNB；0x48ce 案；2026-11-05；用户指令「『4 笔微量成交（0.002/0.002/0.0067/0.01）』这个级别的交易就给忽略掉吧，至少 0.02 吧」）

- **案（v73 `c6efed13` 票 `0x48ce…7777`）**：05:32:46 最后一笔足额成交（0.07 BNB）后，庄家 05:32:52-05:33:20 连续 4 笔微量成交（0.002/0.002/0.0067/0.01 BNB）——**全部过尘门 0.001 进 FA、逐笔推进 `lastTickAt`**，30s stallClose 判据永不满足；随后 05:33:29 起 0.39 BNB pump 拉高 +11% 再同秒砸盘，我们被 T116 进场验证臂（realHoldDuration=202s）在 05:34:32 深度回落位全清。**足额门若在场：水位停在 05:32:46，05:33:16 即触发全清，早 2min、价位高约 11%**。微量成交=挂单撑盘/维持「还活着」表象的控盘手段，撑不起真实对手盘——「有流动性」的证据必须够格。
- **机制（水位切换，非条件因子）**：FA 新增 `lastSubstantialTickAt` 水位（state 工厂缺省 null；`processTick` 价格段 `bnbAmount ≥ 阈值` 才推进，与 `lastTickAt` 同点同 `Math.max` 防回拨；**买卖两向同判**——大卖也是流动性；阈值经 `setSubstantialTickBnb(v)` 由引擎 ctor 注入，`Number.isFinite && >0` 否则关）；两引擎 `_scanStallClose` 判据水位：`stallClose.minTickBnb` 配置（`_stallCloseMinTickBnb`）→ 切 `lastSubstantialTickAt`，不配 → 原 `lastTickAt` 口径 bit 一致（存量实验零变化）。**水位 null fail-open 不卖**（本进程未见过足额 tick——与 lastTickAt-null 重启恢复语义同向；刻意不做入场锚定 v1：重启恢复重放 setBuyState 带历史 buyTime，锚定=恢复即秒卖的陷阱形状）。回测 `_scanStallClose` 同判据镜像（parity 红线；asOf=lastSubstantialTickAt+stallMs 检测时点不变式保持）。策略名带档 `流动性止损-无成交超时(30s,≥0.02BNB)` 观测留痕；`lastTickAt` 全量口径照推（idleSecSinceLastTick/act* 滑窗等既有消费者零影响）。
- **单测**：`_test_stall_close.cjs` 21→38 断言新增 D 段三件——D1 真 FA 水位（0x48ce 事故现场反证：微量三连不推进/lastTickAt 照推/恰等阈值 ≥ 推进/足额卖推进/迟到旧足额不回拨/阈值关恒 null/后补开启不追溯）；D2 实时引擎水位切换（同形状开=触发、关=零触发/水位 null fail-open/策略名后缀）；D3 回测镜像（asOf parity）。**顺手修存量竞速**：A 段「恰等阈值不触发」断言依赖测试体与引擎内部两次 `Date.now()` 间隔 0ms（晚 1ms 即 stalledMs=10001 翻越边界，stash 验证原始版 5/8 次假红）——runScan 扫描期冻结墙钟（锚=调用方同一 now），10 连跑全绿。受影响回归 11 件（fa_factors/signal_source/since_entry/stop_loss_rules/sell_leg_scan/sell_debounce/card_position/holdings_replay/mcap_arc/sec_since_peak/backtest_trigger_leg）全绿。
- **部署链**：v73 config `stallClose` 段 `{stallMs: 30000}` → `{stallMs: 30000, minTickBnb: 0.02}`（实验级单键，重启进程生效）；**生效前置=重启前持仓确认**（live-restart-positions-check 铁律）。
- **余留**：①足额门触发频率/早出代价观察（大票二次起飞形状 vs 微量撑盘形状分布）②阈值 0.02 校准（现值=用户指令原值，无分布依据）。

### T115 买信号发射帽收紧 5→2：砍掉第三次作弊检测的退场段接刀（v71 `936e1bd9` 实验级 config 变更+重启生效；2026-11-04；用户指令「买入策略也改一下，当前的买入策略只允许发出两个购买信号。（我发现检测第三次，往往是 unhealthy 的现象已经起了作用，在退场的时候买入，盘面起不来了）」）

- **机制对应（非买腿 maxExecutions）**：「发出两个购买信号」的载体=T110 节流键 `fourmemeWs.buySignalMaxPerToken`（发射帽，**无论信号是否通过都计数**：门拒/执行失败/save 失败均不退还），非买腿 `maxExecutions`（那是**成交**上限，v71 早已是 2）；发射帽同时=**每代币作弊检测次数上限**（CD158 粘滞配额封顶——cheat 门烧配额在执行层之前）→ 帽 2 = 同 token 第 1/2 次发射各检测一次，**第三次 admit 直接 capDropped 静默拦截**（不落信号行不烧后续门），「检测第三次」根本不发生
- **动机（用户观察）**：第三次检测时点盘面往往已在退场段（unhealthy 现象已起作用）——前两次信号抓启动段、第 3+ 次信号时间上越拖越接近庄家出货段，买入即接刀、盘面起不来；与其依赖检测滞后于盘面（cheat 粘滞评级追不上出货节奏），不如直接砍发射次数=更早的时点截断
- **改动**：v71 config `fourmemeWs.buySignalMaxPerToken` 5→2 单键（另两键 3000ms/10ticks 不动）；both 实验引擎级恒读 fourmemeWs 段=双平台同生效；机制零改码（T110 键既有），`_test_buy_signal_throttle.cjs` 47 断言全绿复跑确认
- **风险留观**：①首两次信号全被门拒（如 cheatGrade=unhealthy 拒买不拉黑可重判——但 unhealthy 每信号自动重判也吃发射数）的好票彻底没机会（放行=依赖首两次窗口内 rating 翻正）②观察信号/手工买不走本层不受影响；与 T114 同批待重启一次双吃
- **生效条件**：须重启 v71 进程（与 T114 卖臂修剪同批）

### T113 pump 失衡全清臂：FA 新键 sinceEntryNetBuyRatio（自入场累计净买比）+ 库新条目 pump-imbalance-exit v1 + create-v71（2026-11-04；用户指令「我想卖出策略上也可以加强一下，如果买入后比较长阶段，例如 30 秒后买/卖比例依然严重失衡 就全部卖出」+「针对 pump 的卖出策略…放到 V71 里头」）

- **动机（v70 `f0898589` 五 pump 漏网家族的卖侧保险）**：CD165/CD166/CD175/CD181/CD182 五案同构轨迹「E 拦前 N 信号→act 抖动翻 healthy→放行买入→20 分钟 -50%+」——买侧 D3.57 已立法拦截（v71 起吃到），本臂=入场后盘面维度的最后一道：**买入成交 30s 后若盘面仍单边买（没有形成健康双向流）= 机器推盘无真实对手盘，趁推着走全部卖出**，等来的就是砸盘。
- **v70 13 票探针分离度（182 跑，入场锚=我们钱包首笔链上 buy tick；净买比=(Σ买−Σ卖)÷(Σ买+Σ卖)×100）**：入场后 30s 窗净买比 =100（纯单边）的 6 票中 **4 票全亏**：比特币银行 -37.3%、蝴蝶喊单 -32.2%、蝴蝶池 -27.4%、共建共赢 -7.0%；仅火龙果树 +3.7%、7DOGE +6.6% 微利（30s 时点 pump 仍在推，早卖同向正收益）。T=90 与 T=100 在 13 票同触发集（90=容 1 笔尘卖 ≤5% 卖占比，取 90 防抖）。
- **载体选型（滚动窗反证）**：现有 `tradesNetBuyRatioShortWin`（尾 12 笔滚动窗）被**入场前买潮污染**——同锚对拍 S12@+30s ≥90 只中 3/6 票（比特币银行 76/蝴蝶池 39/蝴蝶喊单 0 全漏），且死盘时滚动窗静止在入场前旧值=语义漂移 → 必须新增**自入场语义**专用键。act* 滑窗需因子间算术（求值器无算术文法）且 30s 滚动窗随持有增长漂移，弃。
- **FA 实现（零新增累计器）**：锚=setBuyState 时刻快照全史累计 `totalBuyBnb/totalSellBnb`（processTick 价格段每行恰一次推进，defer 路径价格段即时喂）→ pos 记 `entryTotalBuyBnb/entryTotalSellBnb`，`_positionFactors` 差值派生三键 `sinceEntryNetBuyRatio/sinceEntryBuyBnb/sinceEntrySellBnb`（差值 Math.max(0,·) 防 defer 乱序瞬时负；加法交换律收敛真值；入场前旧 tick 晚到两侧同污染方向抵消，竞态窗=锚点附近 1-3s 接受）。**null 语义**：入场后零交易 → b+s≤0 → ratio null 恒 false fail-closed（死盘不靠本键触发，归断流扫描/止损管——与滚动窗死盘误触发的关键差异）。补买轮各自重锚=每仓独立「入场以来」。差值不消费 now → 回测虚拟时钟天然兼容（asOf 推进读数不变，单测 E 段锁定）。自身买入 tick 计入「自入场买」（0.004 BNB 占比微小，与探针口径一致）。
- **分轨边界（刻意不覆盖）**：FLAP世界 -48.6%/MAX -43.0% 两大重灾是「入场即反转」形状（30s 窗净买比 48/21 已现卖压，不属「持续失衡」）——由 D3.57 买侧拦截管；负向失衡臂（入场后净卖为主）13 票最负仅 -25（厉娜 -10.7）无分离度证据，不立。
- **腿形状**：`realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90`，cards='all' 全清，priority 5（rug-exit p2 > T113 p5 > mcap-arc p10——失衡出场先于拱形时间维度），bypass=false 走 3.5s+5tick 双门确认，maxExecutions 刻意不设（卖出失败每轮重试直到清仓）。库 `pump-imbalance-exit` v1（id 49862cfe，validateLegs 400 口径入库）。
- **单测**：`_test_since_entry_factors.cjs` 24 断言（A 精确公式/B null fail-closed/C 未持仓全清复位/D 补买重锚/E 时间无关/F 卖腿真值表/G 探针收键/H FactorBuilder 透传/I 源码口径：派生段禁 Date.now+Math.max(0)+锚快照字段+累计器位置）；受影响回归 netbuy_window/card_position/holdings_replay/sec_since_peak/mcap_arc/stop_loss/sell_leg_scan/sell_debounce/strategy_library_validate_legs/prebuy_short_circuit/signal_metadata_cache 全绿。
- **部署**：v71 克隆 v70 config + 第四卖腿引用；停 v71 前置=v70 两未清仓（7DOGE/蝴蝶池）已由用户手动全清+链上 balanceOf 归零复核（2026-11-04 07:36 UTC）。

### T112 净买门拆臂：去 tradesNetBuyRatioLongWin 臂 + 短窗 netBuyWinTrades 20→12（v70 `f0898589` 实验级 config 变更+重启生效，库 buy-v2 v56 未动；2026-11-04 VETO 案）

- **案**：VETO `0xb96e4da8…7777`（flap），12:40:32 创建（UTC+8）→ 12:41:26 冲首峰 1.08e-8 → 12:42-12:45 回落横盘 4.3~6.6e-9 → 12:45:59 二次拉升 → 引擎 12:46:13 首买（fire 价 5.97e-9，成交 6.10e-9）。用户裁定级提问「买入为何晚了？最好的加仓点位没买上，是否市值限制？」+「我的感觉是在 12:43:19 就该买了」。
- **诊断（链上真序重放对拍，重放首放行 tick 04:46:12 ↔ 生产 fire 04:46:13 秒吻合=引擎链路零额外延迟）**：12:43:19 时 12 个子句 10 过——市值门 5.91 BNB ∈ (4.7,27) 宽松过（**排除市值限制**）、buyVol 7.98、ExDust 14、slopeEx 0.043、drawdown -45.3 全过；**唯一拦=净买双键 netL=-18.15 ✗ / netS=9.24 ✗**（T96 AND 形状）。轨迹：长窗（尾 100 笔≈40s 记忆）被 12:41:26 峰后砸盘段拖住（-14→-45），12:43:28-12:44:07 短窗一度过 20（23→72）但长窗最接近 12:43:44 只到 **-0.6** 差 0.6 没归零；12:44:17-12:45:35 二次回踩短窗深负（-158）；12:45:59 拉升启动 netS=39.6，**12:46:12 砸盘段滑出 100 笔窗长窗首转正（27.3）∧ netS=24 双门同过即买**——等门代价 = 较 12:43:19（5.9e-9）贵约 44% 进场。
- **用户裁定**：①「把条件 tradesNetBuyRatioLongWin ≥ 0 给去了」——T96 AND 形状拆臂，净买门只剩短窗单门；②短窗窗口「直接改为 12」——`fourmemeWs.factorParams.netBuyWinTrades` 20→12（factorParams 实验级覆盖机制，T87 立项键；引擎 `new FA({fourmemeWs: wsMerged})` 直达 `_fp`）。
- **四窗重放支撑（20/15/12/10 同票对比，新条件首放行时刻）**：win=20 → 12:43:26（价 6.32e-9）；win=15/12/10 → **12:43:19 价 5.906e-9 = 用户点位（age 167s，netS@12=32.9）**。副作用检查：12:41 冲高段（12:41:30-12:42:47 回踩）四窗 netS 全深负不放行、12:44-12:45 回踩段深负不放行；放行覆盖 93~94/393 tick 断续 7-8 段四窗同族（无断续恶化）。**N=12 vs N=10**：10 窗 12:43:50 即翻负（9）、12:47 后频繁深负（-43/-177）更敏感——T87 立项时 N=10 曾因「0xdf7a fire 帧 -531 集中卖压形状」排除（彼时有 netL 兜底），netL 拆臂后 N=10 单门裸奔风险更高，12=「该点位能进+不过敏」折中档。
- **生效动作**：v70 config 两处改（condition 净买门组 `(L >= 0 AND S >= 20)` → `S >= 20`；factorParams 加 `netBuyWinTrades: 12`）+ 回读校验 + 优雅重启（PID 3459248 → 3552466，05:24 UTC，26 策略零 ERROR）；重启前账本持仓确认零未清仓（8 token 全平）。**库 v56 未动**——v70 的「去叙事」克隆本就实验级未升库（v56 仍带 narrativeRating 臂），同性质实验级调参，形状稳定后再裁定是否固化库版本。
- **风险留观**：netL 拆臂=「长窗净卖压未解除」形状不再拦截（首峰砸盘票短窗反弹即可进场——本票 12:43:19 正是该形状，用户裁定接受换取 2m54s 早进场）；12 笔窗单笔大卖更快打穿翻负（断续段数 8 vs 20 窗 6，同族）——v70 观察点：进场提前量 vs 首峰砸盘票损耗。

### T110 买信号发射节流：per-token 冷却双门（时间 AND ticks）+ 发射帽（引擎级全局机制 `BuySignalThrottle`；2026-11-03 CD158 重构同批立法，用户五点需求之 3/5——机制案无 token）

- **用户需求原话（CD158 五点之 3、5）**：「购买信号发出增加冷却期（实验层配置），默认 3 秒，3 秒内不允许再发信号（无论上次是否通过）」「买入信号有数量限制（无论是否通过），每代币默认最多 5 次 → 每代币最多 5 次作弊检测」。**裁定②（AskUserQuestion）**：冷却/上限=**全局买信号机制**（所有实验生效，回测同步生效）——非作弊门专属配置。
- **追裁定（同日）**：「改一个小细节，信号发出的冷却时间 3 秒，改为 3 秒 + 10 个 ticks，也就是说，不仅仅有时间作为冷却条件，再加一个 ticks 冷却条件（还是担心很快把次数用光了，后续好机会上不了车）」——动机=纯时间窗在高频 tick 流（BSC 0.75s 出块+act=ultra 票实测 436 ticks/min）下 3s 内即可连发把帽烧光；ticks 门保证两次发射之间必有新链上交易证据（新证据=新信息，不是同一形状反复射击）。
- **机制**（`src/trading-engine/core/BuySignalThrottle.js`，两引擎共用单一类）：配置三键 `fourmemeWs.buySignalCooldownMs`（默认 3000，0=关）/`buySignalCooldownTicks`（默认 10，0=关）/`buySignalMaxPerToken`（默认 5，0=不限）；flap/gang 经 `_mergedWsConfig` 同键；创建页「买信号发射节流」独立区块三输入（回测不剥离）。放行条件=帽未超 ∧（cooldownMs≤0 ∨ now−lastFireAt≥cooldownMs）∧（cooldownTicks≤0 ∨ tickCount 非有限 ∨ tickCount−lastFireTicks≥cooldownTicks）——**双门 AND 半开窗**（恰等于阈值放行）。
- **ticks 口径=FA `state.tradeCount`**（全量链上交易数，live/回测同源 processTick 每行恰一次递增；fire 时 factorResults.tradeCount 恒在场——tickBuildSkip 出窗票不 emit factorsUpdated，fire 时 `_runBuyEvaluation` 独立全量重建）——无平行计数器漂移。
- **被拦不记账**（时间锚/tick 锚/计数均不动=连续拦不续窗不烧帽）；首发射锚=−Infinity 天然过；**tickCount 非有限=该门跳过退化纯时间**（fail-open 放行不吞发射机会——tradeCount 恒有值，缺席=接线异常形状；与「好机会上不了车」立法本意同向；非兜底而是显式缺失语义，注释+单测锁死）。
- **挂点**：live=`FourMemeWssTradingEngine` 作弊拉黑双源短路后、latestPrice 前（`admit(tokenAddress, Date.now(), factorResults.tradeCount)` 真墙钟；拦截=静默 return 先于 markBuyFire/信号落库——不落信号行不烧后续门，metrics.buySignalThrottled 计数）；回测=`BacktestEngine` 叙事否决短路后同款（`admit(tokenAddress, nowTs, …)` fireTs 虚拟时钟，核心类禁 Date.now 红线）；stop clear（进程内存态重启归零）。
- **「无论是否通过」**：admit 检查+记账一体——门拒（叙事/作弊/GMGN）/执行失败/save 失败均不退还（用户原话语义）。OBSERVE 观察信号/手工买不走本层（独立路径零引用）；**发射帽同时=作弊检测每代币检测次数上限（CD158 粘滞配额封顶——无帽连续分析的安全阀）**；观测计数 cooldownDropped/tickDropped/capDropped 分键。
- **验证**：`_test_buy_signal_throttle.cjs` 47 断言全绿（A 段 core：半开窗/被拦不记账铁证（冷却锚不重置）/帽封顶不加计/0=关/缺省 3000/5/10/token 级隔离/clear/源码禁 Date.now；A9 段 tick 门七组：双门 AND 独立拦/恰 +10 放行/被拦不记 tick 锚铁证/首发射 tc=0 天然过/undefined·NaN 退化放行零 tickDropped/tickDropped·cooldownDropped 分键；B 段两引擎接线源码锁：挂点序/时钟源/构造三键/`_buySignalThrottle` 恰 4 处引用=OBSERVE 手工买零引用）+`_test_backtest_trigger_leg.cjs` 桩补真实 throttle 全关中性。
- **已知后果**：进程内存态重启归零（叙事触发状态机同款先例）；同 token 跨策略腿共享节流（per-token 语义=腿间不重复发射）。

### T108 v67 反作弊分级门上线 + GMGN bundler 组退役 + T104 断流臂退役（库 buy-v2 v53→v54 / buy-v2-repeat v3→v4 / 新实验 `e3d00085` 换车三变更；2026-11-02 用户指令「可以新建实验了，将反作弊模块上线。其中 GMGN 的检测条件 gmgnBundlerWalletRatio <= 100 删除，卖出臂中的断流臂（断流XX秒全部卖出）删除」+ 追认「(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100) 全部删除即可」）

- **三变更（v66 `4012ce39` 基底逐项改，其余 bit 一致）**：①**CD1 反作弊模块上线**——cheatCheck 双开 `enabled:true + gate.enabled:true`（G8 十二通道分级买门 D3.33 13 题；首析门走缺省 `tradeCount >= 15`、重判走增量门缺省 60s∧20tick、FA 34 键投影；cheat 拉黑秒回零 Jev+持仓立即清仓联动、unhealthy 拒买 3 次用尽拉黑）②**GMGN bundler 组整组删除**——buy-v2 v53→v54 `gmgnCheckCondition` 删 `(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100) AND ` 前缀仅存 issuer 分档门；buy-v2-repeat v3→v4 整键删除（T100 已删 issuer 臂后整条即恒真组）③**T104 断流臂退役**——stallClose 段移除（机制代码留档，配段即复活；断流票交 30s 持仓卖腿兜底扫描 + P13 时间止损接管）。
- **bundler 组删除语义**：ratio 为 0-100 百分比，`<=100` 恒真 → 整组 OR 恒真 → **删组与现行行为 bit 等价**（并省 GMGN getTokenInfo 配额）；**只删 ratio 项会留 `marketCap < 10.7` 单臂=大票全拒语义灾难**，故整组删（用户追认「全部删除即可」）。GMGN bundler 维度盘面形状改由 CD1 分级门接棒（E/G/H/K 通道簇/对敲/纯卖形状覆盖面远大于单一 ratio 键）——两变更同批上线刻意互补。
- **实现链（无代码改动=纯配置+库版本）**：UPDATE strategy_library 两腿（version 乐观并发 `.eq('version',旧)` 守卫，description 追加留痕）→ 本地组装 v67 config（克隆 v66 深拷贝改三处+两买腿换库新快照 copy-in+libRefs 版本对齐）→ `loadStrategies` 四因子集校验（与引擎 627/712 行同实参，27 策略装载过）→ `ExperimentFactory.createFromConfig` 走 web 同链 INSERT（validate+upsert 全字段）。
- **部署链（已上线 v67，2026-11-02 06:29 UTC 起跑）**：182 HEAD `66980ac` 已含 cheatCheck 全链（先日批次八收官提交，无需新 pull）→ `setsid nohup node main.js start-experiment -e e3d00085-b796-4973-91fc-05013c438488`（PID 1696674；⚠️启动 ssh 会挂住——先例命令尾部 `exit 0` 不可省，本次漏带靠 TaskStop 杀 ssh 收场，setsid 进程组脱离不受影响=v13 事故防护生效）→ 验证：27 策略装载（P1·首买 issuer 门 / P1·再买无 gmgn 键）、config dump 三变更全落地（cheatCheck 双开/stallClose 缺席/两腿 v54·v4）、ERROR 级=0、「🛡️ 流动性止损已启用」行 **0 次**=stallClose 退役断言、platforms=[fourmeme,flap] 双 trader 连接成功、DB status=running、尾部实时处理新 token（语料补采流动）。
- **观察点**：①CD1 分级门线上实效——首析频率（tradeCount>=15 门）、gate 买点 await 竞速 15s 内完成率、cheat/unhealthy 拦截分布（对照回归集 128 票 G8 基线）、拉黑+清仓联动首次触发案例；②GMGN 配额节省幅度（repeat 臂不再真调+buy-v2 仅 issuer 门票真调）；③断流票出场路径变化——stallClose 10s 全清退役后断流票依赖 30s 卖腿扫描（P13 时间止损 60min 深处兜底），断流阴跌票持有时长分布对比 v63-v66；④buy-early-narrative v10 / buy-v2-momentum v1 库条目仍带死条件组（未被 v67 引用未改，复挂前须先清）。

### T108b v67 首日事故修复 + 两调参 + signal-stats 反作弊列（CheatCheckService require 路径 `4d7f4207` / buy-v2 v54→v55 cards 3→4 + 实验删 repeat 腿关闭二次买入 / 页面列 `5397e062`；2026-11-02 同日追记，用户指令「请把代币的二次买入也关闭吧」+「第一次买入 4 张卡」）

- **CheatCheckService 生产路径 require 事故（v67 上线 2h 内反作弊全灭零可见度）**：`_client()` 写成 `require('../../services/dbManager')`——market-analysis 在 `src/` 下、services 同层须一层 `../`，错误路径解析到项目根 services → MODULE_NOT_FOUND 被 `_chain` 外层 catch 吞成 `{status:'fail'}`：CheatPrefetch 43 次预触发发起**全部灭**、cheat_detection 零表行、「盘面观测」零日志、gate 买点恒 fail 放行（fail-open 语义反成放风）。定位链=零日志零表行 → 182 单票 probe（注入 console logger 直跑 noteBuyPoint）复现 stack 落 `_client()`。**漏网面=单测 `deps.dbClient` 注入短路生产 require 路径从未被走到**——修复后补防线四断言（源码反证不含错误路径/require 字面量在场/一层上层/require.resolve 真实模块系统烟测，零 DB 零网络），detection_service 84→88。
- **两调参（v67 config+库同步）**：①**关闭二次买入**——v67 `strategiesConfig.buyStrategies` 删 buy-v2-repeat v4 整腿+libRefs 移除该条（**库条目留档不删**，重启 repeat 实验直接引用即可）；②**首买 4 张卡**——库 buy-v2 v54→**v55**（cards 3→4，description 留痕；乐观并发 `.eq('version',54)` 守卫），v67 首买腿换 v55 快照 copy-in。首仓=perCardBNB 0.001×4=0.004 BNB（原 3 卡 0.003）；卖 sizing 走 tokenCards 账本自动跟随无需动卖腿。
- **重启链与教训**：kill 旧进程（1696674）→ **裸重启被拒**（kill 时关停钩子置 stopped，start-experiment 只认 initializing → 需 `--force`；本次先裸启吃了一次 failed 状态再 --force 拉起，PID 1716301 07:00 UTC 起）→ 启动 ssh 挂住 120s 教训**再现**（命令尾 `& exit 0` 带了仍挂=setsid 后台进程持有 sshd 会话，TaskStop 杀本地 ssh 收场，远端脱离进程组无恙）→ 验证：**26 策略装载**（`P1·首买: 买入 ×2 | 优先级:1 | 4卡` ✓/无再买腿✓）、status=running、ERROR=0。
- **signal-stats 反作弊列**：新端点 `GET /api/experiment/:id/cheat-detections`（cheat_detection 按 source_experiment_id 瘦列拉行，analyzed_at desc 前端首见即最新）+ 表头「人工评级」后「反作弊」列（可排序 cheat=2/unhealthy=1/healthy=0；badge 🚫作弊/⚠️不健康/✅健康/⏱超时·❗错误·已观测灰，title=版本+时间+通道明细；无分析 '-'；js v4.12）。本地 3010 playwright 真实 DOM 四形状+排序+空态全验证。
- **观察点**：①修复后 cheatCheck 首析/表行/「盘面观测」日志恢复（对照事故期 2h 空窗）；②反作弊列首批真实数据形态（badge 分布对照回归集基线）；③首买 4 卡仓位节奏（单票敞口 0.004）与触发频率变化；④二次买入关闭后「卖出后同票永不再进」的错过/避免分布（对照 T89 二次入场初衷）。

### T108c v67 首日事故第二弹：cheat gate 调用点 faState 块外越界引用炸断全部买点（`_evaluateBuyPath` 作用域事故；2026-11-02 与 T108b 同窗叠爆，J1.151 重启换车时发现）

- **现场**：重启前持仓点查（卡账本净额 trades 零行+两行「持仓恢复完成: 0 个代币」）→ 日志尾暴露 `[ERROR][BuyEval] 买腿评估异常: faState is not defined`——**128 次全灭、≥4 票受害**（八小/币安一直都在/猴子币/豆豆），首次 07:16:52 UTC，每 tick 重现（07:39 猴子币 1s 内两连炸）。gate/观察两分支同炸：`gate 分析 0 行`、trades 零行=v67 gate 开启后**买路径全程瘫痪**（gate 竞速从未真正跑过一次）。
- **根因**：`const faState` 原声明在 `_evaluateBuyPath` 的 **preBuy 块内部**（2203），而 CD1 gate 调用 `_cheatGateEvaluate(tokenAddress, token, faState, …)`（2352）与观察分支 noteBuyPoint meta 的 `faState?.platform/totalSupply`（2361/2366）在**块外**——C84 新模型腿（v67 buy-v2 v55 全腿）跳过 preBuy 时块不执行，块外引用未声明标识符 → ReferenceError。观察分支被同段 catch 吞成 warn（CD1 上线以来买点观察挂点从未成功过——与 T108b require 事故同窗叠加，两事故各自独立全灭）。**影响面恰=v67**（此前实验 cheatCheck 全关，该块零执行）。
- **漏网面**：gate 单测直调 `_cheatGateEvaluate`（faState 显式传参），从未走 `_evaluateBuyPath` 调用点；`faState?.` 可选链形状让人误以为空安全——**可选链防的是值 null，防不了标识符未声明**。
- **修复**：faState 提升到 `_evaluateBuyPath` 函数入口（`getTokenState` 返回活引用 `Map.get`，提升零语义变化——preBuy 块消费同一对象）；块内原声明删。单测防线 E7（源码口径锁两断言）：声明必须先于 preBuy 块条件+函数体内恰一处声明（块级重复声明回流即红），`_test_cheat_gate_engine` 65→67 断言全绿；直调买路径四件复跑全绿（gmgn_check_layer 78/manual_trade_queue 127/stop_loss_rules 69/cheat_detection_service 92）。
- **部署链**：随 J1.151（C259）+T108b `_log` 修复同批重启生效（182 pull→零持仓确认→TERM 优雅停→--force 起）；重启后首验=买点 gate 真跑。事故期对照事实：cheat_detection 已落 207 行**全部来自预触发通道**（T108b require 修复后恢复，verdict=observed 无 error）——买点观察与 gate 两挂点因本事故从未执行过一次。
- **观察点**：①重启后 gate 买点竞速 15s 完成率首见（事故期全部没跑成）；②事故窗 07:16-重启 期间 4 票行情结局（错过 vs 避坑对照）；③重启后预触发/买点两通道行量对照（事故期买点通道占比 0）。

### T107 市值拱形时间全清臂（FA 新因子三键 + 库新条目 mcap-arc-fullclose v1 + create-v65；2026-10-29 用户指令「再增加一个卖出臂，持续记录代币从首次交易到最高市值的时间，假设这个时间为 X 秒，代币市值大于 15K 后，如果代币从最高点已经经过了时间长度 X/2 秒（没有再次突破最高点），则全部清仓」；初稿 7K/X 后同日改 15K/X/2）

- **形状（卖腿 24→25，全清 `cards:'all'` p10，插 T97 secSincePeak 腿前——p10 同档稳定排序首中即赢：拱形完成全清 ⊃ T97/T80 减 1 卡；bypass=false 走 3.5s+5tick 双门；maxExecutions 刻意不设=卖出失败每轮重试直到清仓）**：`mcapPeakBnb > 20.1 AND secSinceMcapPeak >= mcapRiseHalfSec`——X=首次交易→最高市值耗时；峰值市值超 15K USD（=20.1 BNB，T84 换算率 bnbUsd≈745）后距峰已流逝 ≥ X/2 秒且未再破新高 → 全部清仓。**时间维度出场**，与 T99 回撤深度维度互补：浅回落阴跌票 -25/-35 永远够不着，本臂按「再等半个涨程还没新高」截断；与 T104 stallClose 也互补（断流票归 stallClose，本臂管仍在成交但再不起飞票）。
- **FA 三键（token 级全生命口径，与持仓期 secSincePeak/peakMarketCapSinceLastBuy 分轨；零新状态——复用既有 `highestPriceBnb/highestPriceAt` 全生命峰+`firstTickAt` 首 tick 锚）**：`mcapPeakBnb`=highestPriceBnb×totalSupply（峰=任意接受价轨：outlier 不推/chainLate 不推/尘价照推，与 drawdownFromHighest 同峰同价流）；`secSinceMcapPeak`=(now−highestPriceAt)/1000（now=buildFactorMap 入参，回测虚拟时钟）；`mcapRiseHalfSec`=（highestPriceAt−firstTickAt)/2000——**X/2 预计算**（条件求值器无算术文法，除法不能写条件串）。
- **语义细节**：再破高 → 峰推进=计时归零+X 变大（X/2 只会长不会缩）；无接受价/totalSupply 缺失 → null 恒 false fail-closed（marketCap 族惯例，时间键独立照出观察）；**首峰即首 tick（开跌即峰票）X=0 → X/2=0 → secSinceMcapPeak>=0 恒真：过市值门即清（忠实用户口径，非兜底）**；进程晚接管/回测窗口晚于真实首交易 → firstTickAt 偏晚 X 低估 → 提前触发（保守出场方向，trend age 家族同限）。
- **实现链**：FA 三键发射+FactorBuilder 快照白名单三键 → 单测 `_test_mcap_arc_exit.cjs`（37 断言：X/2 精确值/再破高重置/outlier 不推峰/尘价推峰/X=0 退化/supply 缺失 fail-closed/asOf 虚拟时钟/源码口径锁/快照透传/探针收键/条件四态）→ `bump-t107-mcap-arc-fullclose.cjs --commit`（库 v1 `7d51d440` 已建，防呆=条目防重/条件串与单测 COND 逐字/三键探针/腿形状）→ `create-v65.cjs`（克隆 v64 单变量插腿；防呆=源 24 腿+插位锚定 T97 前/剥除新腿恢复原文逐字节/refs 恰追加 3→4）。⚠️部署红线：182 须先 pull 至含 FA 三键提交再建/跑 v65（旧 FA=未知因子三防线拒启）。
- **部署链（已上线 v65，2026-10-29 14:33 UTC 起跑）**：用户「换吧」→ 182 HEAD 已含 `3c1a74d`（"Already up to date"，新键代码就位）→ v64 `0e7c7e09` 零持仓确认（trades 2 行 1 token：AGENC 0xad05…7777 buy 13:46:45 output 534925.9198285847 → sell 13:48:10 input 逐位一致=全清，净 0）→ TERM 2631956 优雅停（5s 退出，status=stopped）→ `create-v65.cjs --commit` 出 **`aed2091d-f22f-4660-ae62-42f48a9048de`**（T107 idx14 P10 cards=all 插 T97 腿前✓/refs 4 条含 mcap-arc-fullclose v1✓/防呆全过）→ 启动 PID **2663184**（setsid+--force）→ 验证：27 腿装载（P1·首买 ExSniper·ShortWin20·无集中度门✓/P1·再买 (-70,-40)✓/**启用卖腿精确 25 含 T107 P10 全清卡**）、stallClose {stallMs:10000}✓、双平台 platforms=[fourmeme,flap] 双 collector 双 trader✓、ERROR 级=0（唯一 error 字样=火星羊头叙事直调 30s 超时 INFO 字段 rating=9 正常语义）、叙事 worker 2586282 跨换车不动✓、wallet 同 0xc3c9…cf20。
- **观察点**：①触发频率与峰值市值分布（>20.1 BNB 峰票占比）；②被清票事后走势（V 反打脸率 vs 阴跌截断收益）；③X 分布（快泵票 X 小=X/2 窗窄更凶，慢牛票宽窗耐心）；④与 T97/T99/stallClose 的实际分工占比（谁先触发）；⑤开跌即峰 X=0 即清形状票的结局。

### T106 主腿放宽：删集中度两门 + 短窗净买门 40→20（buy-v2 v52→v53；2026-10-29 用户指令「……AND holderTrendSlope > 0 AND top2HolderCircPct < 55 AND top1HolderCircPct < 35 AND …… 中 top2HolderCircPct < 55 AND top1HolderCircPct < 35 直接删除，tradesNetBuyRatioShortWin >= 40 改为 tradesNetBuyRatioShortWin >= 20」；同批撤 T84 early 臂语境「触发太少了，没有啥用」）

- **形状（仅首买主腿；repeat v3/early 不涉——early 同批整腿撤）**：①`top2HolderCircPct < 55 AND top1HolderCircPct < 35 AND ` 整段删除——持有人集中度门整族退役（top1=T1 谱系 35、top2=T93 换轴 55；T91 瘦身→T93 换轴→T95 早期臂放宽→本条终局），两键转纯观察 FA 照算照落（一屏「T93+T106 退出五键」段）；②`tradesNetBuyRatioShortWin >= 40 → >= 20`——T96 AND 形状的「短期开始涨」臂放宽半档，放行「短期温和上涨」形状；**LongWin >= 0 不动**（「长期下跌趋势解除」语义保留，短窗 20 ∧ 长窗净卖的反弹票仍拦）。
- **动机**：买腿触发太少，整体放宽提高交易频率（同日撤 T102 momentum、撤 T84 early 同向三连放宽）。集中度门此前两次收紧谱系（T91 删单块门/T93 换轴）均围绕对倒防护，本条反向全删=把对倒形状防护交给 copy/famous 名单门+T105 ExSniper 趋势门（狙击手段已剔）+T104 stallClose 10s 快出兜底。
- **新条件串（库 v53 全文）**：`(tokenAgeSec < 90 OR tradeCount >= 25) AND marketCap > 4.7 AND marketCap < 27 AND (narrativeRating == 2 OR narrativeRating == 3) AND holderTrendSlopeExSniper > 0 AND maxCopyWalletHolderCircPct < 20 AND famousCopyWalletCircPct < 15 AND (buyVolumeBnb >= 1.25 AND holdersExDust >= 10) AND (tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 20) AND drawdownFromHighest > -70 AND crashSpeedPctPerSec > -10`
- **实现链**：`bump-t106-concentration-slim-shortwin20.cjs --commit`（v52→v53；防呆=源 v52 锚定 ExSniper 恰一次/两门+ShortWin40 恰一次 → 换后两键零出现/ShortWin20 恰一次/KEEPS 全门锚定/first 路由 buyPhase+maxEx2/trigger+gmgn 不动）→ `create-v64.cjs --commit`（四变量同批，见 T105 部署链）。单测：无新机制（纯条件串删段+阈值变更，两键 FA 照算既有形状）。
- **观察点**：①触发率上升幅度（三连放宽合流后 P1·首买频次）；②集中度形状票（top1≥35/top2≥55 段）混入率与其结局——名单门+趋势门+stallClose 是否接得住；③ShortWin 20-40 段「弱反弹」票胜率（T96 拦的「短反弹长净卖」形状是否仍在 LongWin 臂拦住）；④对倒簇票（猪五花/Konasu/鲸元卷同款）在新门链下的实际亏损面。

### T105 剔狙击段 holder 趋势新键 holderTrendSlopeExSniper（FA 新因子两键；2026-10-29 用户指令「扣除有交易后前 4 个 slot 的数据，前四个 slot 都是狙击手，是否真的有流动性涌入得看后面；扣除后最少 4 个 slot 有 holder 上涨趋势即可」+「跳过的 slot 需要有交易」）

- **动机**：holderTrendSlope 现口径的 8 点滑窗在票出生初期被狙击手段污染——前几个 slot 的狙击手买入把斜率推高，火点看到的是「狙击手冲高」而非「真流动性涌入」。v60 六张亏损票火点 age 5.4-50s、dp 4-8，全部在这个污染窗内火。
- **语义/口径**：跳过段=**有 tick 的前 4 个不同 block**（HOLDER_TREND_SKIP_SLOTS=4；无交易的块既不产生序列点也不计入跳过数——slot=有交易的 slot，E2 断言锁定）；ExSniper 序列=第 5 个不同 block 起的 `_holderSeries` 子集（同源 8 点滑窗、同块覆盖语义）；≥4 点才出 `holderTrendSlopeExSniper`（`>0` 门），点数恒出 `holderTrendDataPointsExSniper`（观察键）；<4 点 slope 键缺失 → `>0` 恒 false **fail-closed**。边界 `_holderExSniperStartBlock` write-once：非 defer 路径新不同 block 计数定型；defer 路径 `_rebuildHolderSeries` 排序后首扫定型（环裁剪保最近 10 块≥8 点窗、先于定型不可达；万一发生=边界偏晚多剔=更严 fail-closed，E6 全倒序回推对拍）。**旧 11 键 bit 不动**（新键加在 holderTrend 段尾，旧序列/旧 slope 零分叉，E3b/E5 锚定）。
- **改动面**：FA 新增两键（getFactorKeys 手动并入 slope 键；dataPoints 探针自收）+ FactorBuilder 两处快照白名单透传（E8 源码断言）；代码 commit `ddc0f3c`（2026-10-29）。单测=`_test_holder_trend_slot_series.cjs` E 节 8 case（前 4 slot 全剔/无交易块不计跳过/斜率手算对拍/旧键不受污染/狙击爆发后横盘反证 slope=0 拦/窗滑出后与旧键 bit 一致/defer 倒序回推一致/白名单源码断言），34/34。
- **部署链**：用户裁定 2026-10-29「好，换吧」→ `bump-t105-exsniper-slope.cjs --commit`（**buy-v2 v51→v52 已入库存**，仅换主腿趋势段 `holderTrendSlope > 0 → holderTrendSlopeExSniper > 0`；early v10/repeat v3/momentum 库条目不动——repeat/momentum 火点时窗早滑出出生段=换键零行为差，early 无此门）→ `create-v64.cjs`（克隆 v63=T103+T104+撤 momentum 版，源按 experiment_name 'v63-' 运行时发现；防呆=旧段恰一次/新段恰一次/剥 ExSniper 无裸残留/全门锚定/除 condition 外库腿与源主腿逐字一致/stallClose 逐字保留；**执行时升版并入 T106+撤 T84 early 成四变量同批**，库锚定相应 v52→v53、refs buy-v2 51→53 且 early 条目移除 3→2，early 撤腿防呆=repeat 腿 JSON 逐字不动断言）→ **已上线 v64**（2026-10-29 13:41 UTC 起跑）：v63 daf868b7 零成交零持仓 TERM 优雅停 → create-v64 --commit 出 `0e7c7e09-5b3c-4e14-b039-fce040199f83`（PID 2631956）→ 启动日志验证 26 腿（P1·首买 ExSniper 段✓/P1·再买 v3 (-70,-40) 区间段逐字保留✓/24 卖腿）、stallClose 启用行在、ERROR=0、双 collector 4 订阅；182 HEAD 已含 ddc0f3c（旧 FA 三防线 throw 未触发=新键代码就位）。
- **v60 8 票重放对拍（tmp-t103-exsniper-replay.cjs 双口径）**：火点快照 dp≤7 ⟹ 序列未滑出出生段 → dpEx=dp−4<4 **火点必拦**；dp=8 用链上真序重放判（wallet 段追平后形状）。P1·首买 5 票：MWEZI 0x20d2fa63…7777（−0.002011，dp5）、大肚柴犬 0x763ef316…7777（−0.001888，dp6）、날다람쥐 0x297d33af…7777（−0.001727，dp6）火点拦；WOFL 0x681c4dc9…7777（−0.000166，dp8，链上 dpEx=5 slopeEx=0.121>0）**不拦**；赢单 0x5ca91444…7777（+0.004565，dpEx=8 slopeEx=0.042>0）**不拦=保住**。P2 三票（柴犬大肚 −0.001399/饕小宝 −0.000685/赢单 0x4a4417ad +0.004534）——**early 腿条件无此门，换键零影响**（要拦 P2 亏损票须 early 加门，另行裁定）。
- **实效=延迟语义而非拦死（关键结论）**：live 火点 dp 是 wallet 段滞后态（sender RPC 回推 1-3s，比链上真序少 1-4 点；MWEZI live 序列指纹 [1,1,6,9,12] dp5 vs 链上 9 块）→ 新门在 live 实效**比回测口径更严**；火点被拦后引擎 per-tick 重评，wallet 段追平（1-3s）后 ExSniper 补齐——MWEZI/大肚柴犬链上口径火点 slopeEx 已 >0（0.060/0.043）=**追平即放行照买**；仅 0x297d 真晚 9s 且价低 7%（dpEx 火点仍 3<4）。v60 亏损票共性=前 4 slot 后 holder 仍在涨 → 该门对这批票是「等第 5 slot 起的证据」；**真拦死形状=前 4 slot 冲高后横盘/回落**（slopeEx≤0，E4 单测形状，v60 无此形状票）。
- **重放校准三坑复发实录**：trades metadata 腿名不存在（正确源=strategy_signals.metadata.strategyName）；roster 异步 loader 不 await → maxCopyWalletHolderCircPct 恒 null 拦死；registerToken 不带 totalSupply → marketCap 恒 0 拦死。对拍火点 oldOk 全 false 即这三坑信号。
- **观察点**：①换键上线后 P1·首买触发率下降幅度与火点 age 分布右移；②被拦票追平后放行的「晚进场成本」分布（v60 样本=1-9s、价差 −7%~0）；③真拦死（slopeEx≤0 永不放行）票占比与其躲过的结局；④dpEx=4-5 贴边放行票 vs dpEx≥6 票胜率差；⑤P2 early 是否补同门（另裁）。

### T103 再买臂腰斩门放宽：drawdownFromHighest 区间 (-70,-50) → (-70,-40)（buy-v2-repeat v2→v3；2026-10-29 用户指令「把 drawdownFromHighest ∈ (-70,-50) 改为 drawdownFromHighest ∈ (-70,-40)」）

- **案由（날다람쥐 浅腰斩 rebound 零再买问询→裁定放宽）**：v60 `0x5ca91444c8ab56f50a4117232c06ed4eff7d7777`（four.meme，날다람쥐，12:08:06 创建）——12:08:26 P1·首买 3 卡（0.006 BNB，价 8.3e-9/mcap≈8.3）→ 12:09:11/28/50 三腿各卖 1 卡全清（卖价 1.25-1.6e-8）→ **12:09:53 卖出后最低 1.079e-8=距全时峰 -45.2%（未过 -50 门）**→ 12:10:51 起新高推进，12:23:23 全时峰 3.55e-8（较低点 **+230%**）零再买。三买腿逐一对照（机制全按设计运行）：首买腿 T100 轮次路由完成一轮后永久不可见；再买腿 T101 区间门全程 0 tick 进入 (-70,-50)；early 腿 mcap 6.0-6.7 窗卖出后未回（最低≈10.8）∧ 12:18 后 age>600 关死——**-40~-50 段浅腰斩 rebound 是 T101 上线首日即现的实际形状**（T101 观察点③贴边分布的答案：贴的不是 -50/-70 边，是 -50 内侧）
- **语义**：仅上界 -50→-40（「从最高点跌超 40% 即可再买」）；下界 -70（v27 接刀门）不动；口径不变（任意接受价轨全时峰回撤、非 position 域键清仓后可评估、无最高价=0 fail-closed）；首买/early/momentum 臂不动
- **改动面**：仅库条件串（零代码、无新因子、无新单测需求）；`bump-t103-repeat-drawdown-40.cjs` 防呆=T101 同款（源区间段恰一次→新区间段恰一次+换后残留 -50 反证/T100 全门锚定/repeat 路由 buyPhase+maxEx=1/trigger+gmgn 不动）
- **部署链**：bump-t103-repeat-drawdown-40.cjs（v2→v3 committed 2026-10-29）→ create-v62.cjs 已备未跑 → **并入 create-v63.cjs 同批换车**（T103+T104 stallClose+撤 T102 momentum 三变量一批；防呆=源四腿 v61 形状+库 v3 锚定（version/buyPhase/maxEx/新区间段在+旧段无/trigger/gmgn/全门锚定）+除 condition 外库腿与源再买腿逐字一致+主腿/early 逐字不动+refs 仅 buy-v2-repeat 2→3 且 momentum 条目移除）→ **v63 已上线生效（13:23 UTC，再买腿 (-70,-40) 区间段装载验证过）**
- **观察点**：①-40~-50 新增段触发率（对照 -50~-70 段）②浅腰斩 rebound 票胜率（-45% 案形状：腰斩浅=砸盘者筹码清洗可能不充分）③-40 贴边分布（-35~-40 被拦票结局，将来再放宽依据）④buyPhase 互斥下与首买/momentum 同票零竞争不变

### T102 低评级强势独立买入臂 buy-v2-momentum（新库条目 v1：rating==1 镜像臂 + buyWallets≥40 动量门 + tokenAgeSec<600 快窗；2026-10-29 用户重申目标函数「快速交易，快速买入试图高点卖出，只要增长是用户带来的、不是作弊票、峰值高就行」+ 裁定「给 rating==1 但强势的票一个单独的买入臂」）

- **案由（Ragu 品味否决误拦）**：flap 票 0xf1dca9bf42c5f565063f493f693455c86dff7777（Ragu，10-29 09:42:31 创建）——作者 @AnaMariaNicoar4（display name「Ana-Maria \| BNB Chain」，蓝V，875 粉）gm 随笔推+狗图 → Jev 判 `bsc_meme_user_event_fit` sf+fit=0.26<0.5 → **web3FitMassBlock（C141 硬门）拦 low**；另一拦截桶 event_empty_content 0.73。市场结局：**61 秒 6.7x**（09:42:54 首价 → 09:43:55 峰），前 60s **71 个 distinct 钱包**/126 笔买/净买 +51%/top1 买占比 8%/89% 走 GMGN 聚合路由=干净用户盘；同一推 3 分钟内 spawned 19 个仿盘（全 low，17 个峰 ≤1.8x）。评级 09:42:58 已落地（首 tick 后 4s——管线速度不是瓶颈），逐门回放 buy-v2 v51 @rating+10s：**除 narrativeRating 外全部因子门已过**——唯一拦点=叙事质量否决
- **裁定链**：用户先裁定方向 A（库改不动的 OR 臂方案）后细化为**独立臂**（主/early 腿零改动、独立阈值/归因/关停）；同轮建议「币安员工+蓝V 等同 superIP A 档」经定量否决（见下）改由本臂承接交易目标：**叙事评级诚实留 low，买层按「非作弊+用户增长」判据放行**
- **臂形（create-buy-v2-momentum.cjs，整腿复制 buy-v2 v51 四处差异）**：①评级门换向 `(narrativeRating == 2 OR == 3)` → `narrativeRating == 1`（与主臂 rating 互斥=同票零竞争，P1 同级无遮蔽问题）②`buyWallets >= 40`（T76 K 组全史买家数——「用户带来的增长」判据载体）③`tokenAgeSec < 600` 快窗上限 ④maxExecutions 2→1（快打一枪）；集中度 55/35/copy 20/famous 15/人气 1.25&ExDust 10/净买 AND 门/崩盘双门/GMGN（含 issuer 分档臂——首买时点计数干净，T100 裁定沿用）**逐字不动=作弊票防线不变**
- **7 天全量回放定阈值（8415 终态评级票逐 tick 因子重放，182 跑；因子近似口径见脚本头注：roster 门不评/holderTrend 10s 桶代理/crashSpeed 滑窗代理/arrival=rounds 首行回落 analyzed_at）**：X=0（纯评级换门）958 fire 峰30min 中位 1.31x/≥3x 9%/≥2x 21%——与 rating 2|3 对照组（385 fire 中位 1.33x/13%/26%）**同质=质量否决在这些因子门之上无可测分选力**；buyWallets 门在新鲜票（≤600s）内分选力真实：buyW≥40 → 134 fire ≥3x **13%**/≥2x **31%**/<1.2x 28%（对照 13%/27%/34%，完全对齐）vs 无门 21% ≥2x；age>600 老票 fire 劣质（<1.2x 占 50%，多为 analyzed_at 回退工件，live C84 trigger 创建秒级发起分析不会有此形状）→ 600s 上限；first-day 截断样本教训=PostgREST **max-rows=1000 截 range 分页**（每页必须 ≤1000 判断翻页）
- **回放关键数字**：进场倍率中位 1.90x（对照组 1.47x——动量门等crowd 证据入场偏晚，Ragu 实测 X=40 进场 3.97x 峰 +68%）；到峰中位 ~2-3min；fire 量 ~19/天（对照 ~49/天）；平台分布 flap 121/fourmeme 13——**动量价值集中 flap**，four.meme 低评级票过门后中位 1.06x（量级可容忍不专门拦）
- **蓝V/员工注册表建议（同轮裁定=不动）**：注册表消费臂（C117 强制标准路径/J1.56 作者原话票/J1.58 空洞豁免）**只看在册不看 tier**（C137 案头注）——「等同 A 档」实际=进注册表=CZ 同权救援链。定量否决：近 7 天 **49% 发币带蓝V**（5430/11020，X 蓝V=$8/月付费商品）、蓝V+自称 BNB/Binance/币安关联名 1599（~230/天）vs 注册表现仅 ~25 手工锚定账号——开闸=每天 230+ rug 伪装拿 CZ 级救援，方向与 C97/C250/C256（反伪关联）相反；且叙事翻正对买门的边际价值≈0（主臂与动量臂过同一套因子门）。备选落点=state 事实行（「作者蓝V（付费可得）；自称 BNB Chain 员工（未核验）」信息注入不触发豁免链）待用户裁定
- **机制零改动面**：trigger 状态机 per-token 单份（`_narrativeTriggerCondition()` 取首条买腿 trigger 串）——多 trigger 腿零额外 Jev 调用；rating==1 票 retry 臂语义不变；拉黑不消费（C84 trigger 腿天然）；引擎/FA/回测零代码改动
- **部署链（已完成）**：create-buy-v2-momentum.cjs（committed v1 2026-10-29，id=d10e968a-7ca8-4398-af4c-4d797fc002bb）→ create-v61.cjs 克隆 v60 追加 momentum 腿（a5e0631）→ 停 v60（27 trades 8 票全平零持仓，净额+cardAfter 双口径）→ **v61 `5298b7bd-8374-458d-b9e3-c5fe581e681d` 12:28 UTC 起跑 PID 2585490**（28 腿：P1·首买 ×2/P2 ×2/P1·再买 ×1/P1·首买×1 momentum + 24 卖腿装载全对，ERROR=0，起跑即实时处理新票）；换车同批部署 C257/C258（worker 同步重启 PID 2586282）
- **【撤臂】2026-10-29 用户指令「帮忙把叙事分析不通过的强势票臂给下了吧，看了一下新实验，亏的有点惨，再看看」→ 当日撤下（v63 起不在装载，库条目 v1 留档随时可复挂）**。v61 实跑核查（`scripts/tmp-v61-momentum-check.cjs`，45 成交/14 round，rating 归属=买点 `metadata.factors.trendFactors.narrativeRating`）：**momentum 臂 7 round 已实现 +0.01058 BNB**（docusaurus 0xc26dd111…/0x5d9d61c2… 两轮 +0.0048/+0.0064 即 +80%/+107% 贡献全部利润；ALICE/LOTTERY/超级TeslaSI/1105 小亏 −0.0001~-0.0026）vs **rated 臂 rating=3 的 7 round 全军覆没 −0.01067 BNB**（永笑/喵古拉伯爵/AGF×2/甘米熊/熊猫和甘米熊/bMeme，无一正）——「亏的有点惨」的实际主体是 rated 臂 rating=3 票，momentum 臂当日是盈利主力；按指令撤 momentum 臂、亏损归因已如实呈报（rated 臂亏损面留观察，未动）。样本量注：14 round/半日样本极小，docusaurus 形状（ConsenSys 关 docusaurus 梗，真事件票）复现频率未知
- **观察点**：①momentum 触发率与被拦仿盘占比（19 仿盘形状里 buyW≥40 能进几个）②进场偏晚成本（1.9x vs 对照 1.47x——若放行票普遍峰值 ≤2x 可降门 30）③four.meme 侧中位 1.06x 是否持续（若持续可评估平台分臂）④rating==1 票 retry 翻正为 2|3 时主臂接管轮次（momentum maxEx=1 已耗则不再买）⑤对照组差距（≥3x 13% vs 9%@X=0）是否被 buyW≥40 完全收平（回放已收平，live 复核）⑥【撤臂后】rated 臂 rating=3 全亏面是否持续（若持续=评级质量门本身的问题，另立案）

### T101 再买臂加腰斩门：drawdownFromHighest 区间 (-70,-50)（buy-v2-repeat v1→v2；2026-10-29 用户指令「再次买入的条件，增加一个从最高点下跌超过 50%」）

- **案由与语义**：再买臂（T100 buy-v2-repeat）此前与首买主条件逐字一致（唯一区隔=GMGN 删 issuer 分档臂）；用户裁定再买须额外满足「从最高点下跌超过 50%」——再买轮定位=**深回调抄底形状而非趋势中继**。与既有崩盘接刀门 `drawdownFromHighest > -70`（v27）合并成区间 `(-70, -50)`：跌幅不足 50%（含新高票/浅回调票）或崩穿 -70 的票，再买轮均不可见（首买臂 buy-v2 v51/early v10 不动）
- **口径**：`drawdownFromHighest`=(当前价−全时最高价)/最高价×100，**任意接受价轨**（outlier/chainLate 不推峰，FA `_acceptPrice` 推进最高价）——非 position 域键，清仓后再买轮（无持仓）可评估，与 profitPercent/peakProfitPct 族（fire 价锚、持仓域）刻意不同源；无最高价/无现价=0 有证据零值 → `< -50` 恒 false **fail-closed**（没见过正价谈不上回撤，拦合理）
- **改动面**：仅库条件串（零代码、无新因子，无新单测需求）；`bump-t101-repeat-drawdown-50.cjs` 防呆=T100 移植全门锚定（tokenAge/tradeCount、mcap 窗、叙事门、holderTrendSlope、集中度 55/35、copy 20/famous 15、ExDust 人气门、T96 净买 AND 门、crashSpeed）+ repeat 路由（buyPhase='repeat'/maxExecutions=1）+ trigger/gmgn（T100 删 issuer 臂形状）不动 + 新区间段恰一次/段外无裸 -70 残留
- **部署链**：bump-t101-repeat-drawdown-50.cjs（v1→v2 committed 2026-10-29）→ create-v60.cjs（克隆 v59 260e9339，防呆=源再买腿 v1 裸 -70 形状+库 v2 五重锚定+区间段恰一次+主/early 逐字不动+refs 1→2）→ 停 v59（持仓确认 5 票全平卡账本净额 0，TERM 优雅停）→ **v60 `c53a703a-5b9a-4c03-a874-64e3f65fd6f8` 11:09 UTC 起跑（27 腿装载：P1·首买 ×2/P2 ×2/P1·再买 ×1，ERROR=0；换车同批带上 C255/C256 叙事侧代码）**
- **观察点**：①再买臂触发率——区间门与其余门同真窗口多窄（腰斩 50%+ 票还须 narrativeRating 2/3 ∧ holderTrendSlope>0 ∧ 短窗净买≥40 ∧ 崩速>-10/s，可能极稀）②被放行票结局（腰斩票+短窗强净买=rebound 形状的胜率 vs 首买）③贴边分布（-50/-70 边界票占比，将来阈值微调依据）

### T100 首买/再买策略层分臂 `buyPhase` 路由（买腿 2→3：buy-v2 v50→v51 加 `buyPhase:'first'` + 新库条目 buy-v2-repeat v1 `buyPhase:'repeat'` 删 GMGN issuer 分档臂 maxEx=1；2026-10-29 用户裁定「把首买买入臂跟再买买入臂区分开来。当前表达式跟首买一致，但是把这个发币数量条件给删除」+ 再买次数 1 + early 臂不动 + 立即换车）

- **案由（Sprout 二次入场误拦问询→裁定分臂）**：用户问 v56 内 `0x33196e0763841a198b48507885f6ce46c7877777`（Sprout，flap，project 类叙事票）首买成功后二次入场（06:16-06:17，已全清 round 1）为何被拒「推特账号发代币的数据更新了？」——信号 metadata GMGN 拒因 `gmgnIssuerTokenCount <= 1` 不满足。**链上实证（非 serial issuer，是借壳污染）**：宣告推特 @sproutbnb 真实（10-28 注册、0 粉、仅本币宣告）；06:08:56-06:09:09 **13 秒内 4 个不同钱包用同一 meta CID（同推特/同网站）连发 4 个 Sprout 票**（nonce 3630980-3630984 相邻=同一 Gas 中枢批量操作）+1 抢名票——恶意用户借壳该推特账号发币，GMGN **推特维度归因计数** `twitter_create_token_count`（risk-fields.js→`gmgnIssuerTokenCount`）时间线：06:09:59 首买时=1（干净，issuer 分档门 C85+T73 判断**正确**）→ 06:16 拒买时=5（污染）→ 现查=8
- **裁定语义**：首买时点该计数干净，issuer 门保留（正主首买过滤有效）；再买时点计数被借壳者污染不可参考——**首买/再买在策略层分成两条独立腿**，再买臂主 condition/trigger 与首买逐字一致，仅 GMGN 条件删 issuer 分档臂（剩 T82 mcap 豁免 OR bundler 两臂）；再买 maxExecutions=1（总买入=首买 1+再买 1，对齐现行 v50 maxEx=2 语义）
- **机制（显式路由字段，防条件分叉绕门）**：纯靠 priority/maxExecutions 隐式分流在两臂条件分叉时会漏（首买轮走再买臂绕过 issuer 门）→ 腿字段 `buyPhase: 'first' | 'repeat'`（缺省 null=不限，存量 bit 一致）：loadStrategies 值域+side 校验 throw 拒启、validateLegs 同口径 400（三防线风格）；`evaluate()` 腿循环内路由——'first' 仅 `completedPairs.length===0` 可见、'repeat' 仅 `>0` 可见（判据与现行 currentRound/repeatBuyCheckCondition 同源；tokenData 缺失视作 round 0=repeat 不可见，保守防首买绕门）；GMGN/preBuy 条件串天然跟随选中腿（GmgnRiskCheckService 零改动）；FourMeme/Backtest 装载映射白名单透传（v15 漏透传事故防线）+ 腿名后缀 `·首买`/`·再买`（两臂同 P1 的 signals 页唯一区分位）
- **priority=1 刻意不降（快票遮蔽反证）**：Sprout 形状=7 分钟内买→全清→再买，此时 tokenAgeSec≈450<600 early 臂（P2，带 issuer 门）仍真——再买臂若 P3 会被 early 遮蔽误拦；再买臂 P1+buyPhase 互斥（首买轮 repeat 不可见）保两臂同 P1 不竞争（单测 C4 锁序）
- **单测**：`_test_buy_phase_routing.cjs` 30 断言全过——A 透传/值域拒启/B 轮次路由（round0 只见 first、round1 只见 repeat、无标记两轮恒见、tokenData 缺失保守）/C ★**事故现场反证**（round0 首买臂带 issuer 全串被选中、repeat 不可顶上=首买必须过门；round1 选中删臂版）/D validateLegs 400/E 源码透传+后缀锁定/F **web 链路保真+展示锁定**（复制按钮整包/创建页 rawConfig 整包取回/库编辑器 spread 基底+空值显式删/六处展示位——任一环剥字段=repeat 腿轮次无条件可见=首买绕 issuer 门）
- **部署链**：create-buy-v2-repeat.cjs（v51+v1，五重锚定）→ create-v59.cjs（克隆 v58，防呆=买腿 T98/T96 形状+卖 24 含 T99 拱形腿+再买腿五重锚定+refs v50→v51/v1）→ 停 v58（持仓确认零持仓）→ **v59 起跑（buy 3 腿：P1·首买 + P2 early + P1·再买）**
- **Web 展示层补齐（e45af0e，同日用户指令「复制按钮也都需要调整」）**：数据链路核验全部安全（复制=腿数组整包/sessionStorage；创建页=addBuyStrategy 存 rawConfig 整包、collectFormData 整包取回；库编辑器=原始 JSON spread 基底+表单覆盖；从实验导入=rest spread）——补的是**可见性**六处：①创建页腿卡徽章（首买轮/再买轮，紧跟 P 徽章——复制 v59 后两 P1 腿凭徽章可区分）②创建页库浮层 legLines（buy-v2 与 buy-v2-repeat 主条件同串，凭标记区分）③库页列表 legLines ④库页从实验导入 legLines ⑤库页腿编辑器加 buyPhase 下拉（可见+可编辑；空值**显式删**——spread 基底保留原值，不删则 UI 改不回「不限」）⑥实验详情页策略卡轮次徽章
- **撞号注记**：本案原拟 T99/v57——T99 与 v57/v58 编号均被并行会话拱形回撤案占用（git 5345620/171a1e2），按 T92 撞号先例改号 **T100**、换车目标改 **v59**（SRC=v58 12ef2c48 现役，卖腿 24 快照全承继）
- **观察点**：①再买臂触发率与被放行票结局（借壳污染形状的票二次入场是否正确放行）②首买臂误放面（issuer 门仅保 round 0，round 0 内计数已被污染的形状仍拦不住——已知边界）③buyPhase 路由与 repeatBuyCheckCondition 并存语义（再买臂无该字段=裸评，旧轮检查不叠加）④early 臂再买轮遮蔽是否绝迹（P1·再买恒压 P2）

### T99 拱形回撤收紧 -25 下放低两档·减 1 卡（卖腿 22→24：`<8.1` 与 `8.1-27` BNB 两档 `dd<=-25` 卖 1 卡臂，p11/cards:1/max1；2026-10-29 用户指令「增加2个卖出臂 peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap >= 8.1 AND marketCap < 27 以及 peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap < 8.1」+ 纠正「只是卖一个卡，不是全清」）

- **案由（SPERM 高点回撤问询→裁定收紧）**：用户问 0x059019085d8899589e3863d08b284616db8e7777（v56 flap 税币）「为什么高点下跌 35% 止损臂没有触发」——查证：**触发了且票已全清**，只是执行腿挂 P4 名下。事实链：05:03:32 买 3 卡（fire 价锚 8.7427e-9）→ 05:04:39 峰 1.25253e-8（peakProfitPct=+43.27%）→ 05:05:31 价 7.649e-9 时 dd=-38.9% ≤ -35 ∧ mcap 7.65<8.1 ∧ peak≥10 → **拱形 -35 低档臂首真**建立 3.5s+5tick 确认窗 → 窗内 05:05:34 跌破 7.4 地板（mcap 7.3815 擦边）**P4 地板清仓臂（priority 4）也变真** → 05:05:35.249 fire（=首真+3500ms 毫秒吻合）重评全腿择优 **P4 以 priority 4<11 抢走执行名分**（两腿均 all 全清实质无差）→ 链上成交成本口径 -29.3%（dd 执行时已 -41.1%，比 -35 首真时深 6+ 点）。用户裁定把 -25 下放低两档收紧
- **新臂语义（三层回撤梯队）**：T80 -15 减 1 卡（13.4-27，p10 先评保 V 反余仓）→ **T99 -25 减 1 卡（<27 全域，p11，max1 恰一次——dd 回升再落 -25 不重卖，max1 已耗）**→ 拱形 -35 全清（同 p11 数组序在后=深跌兜底）+ >=27 档 -25 全清；dd 单调下探时 -25 恒先于 -35 首真=确认窗（3.5s+5tick）前移——SPERM 案反事实 -25 首真 05:05:27（早 4s、价位高 ~25%）
- **已知交互（观察点）**：低档 <7.4 段 P4 地板臂（p4 全清）同刻双真恒先评=直接全清，T99 减 1 卡在该段被压制（余 2 卡交 -35/deeper 臂处置=与 8.1-27 段行为有差，观察）；dd=fire 价锚起算与链上实价（税+冲击 ~17%）差异照旧
- **部署链（两次换车）**：v57 版（`create-v57.cjs` 5345620，T99 双腿误配 cards:'all'）06:32:21 UTC 起跑后发现用户意图=1 卡 → v57 零成交零持仓 → 06:4x UTC TERM 停 → `create-v58.cjs`（171a1e2，cards all→1 修正，防呆=T99 双腿 cards:'all' 原状反证+改后恰两条 cards:1+T97/T80/拱形 -35×2/-25 高档锚定）→ **v58 `12ef2c48-3bf5-45cb-a874-6b87f5433190` 起跑（26 策略装载、ERROR=0、T99 双腿 idx 9/10 cards=1 落库验证）**；v56 六票全平零持仓 → 06:31:52 UTC 优雅停（源链：v56 4ac10e23=T98+T97 同车）；零代码改动纯 config（三因子全在 FA）
- **观察点**：①-25 触发率与被 V 反打脸率（7cat 案 -45 容忍的反面=收紧代价）②减 1 卡后余 2 卡终局（-35 全清接管的占比 vs V 反回本）③SPERM 同形状票的执行 dd 分布（-25 首真→fire 间确认窗损耗是否收窄到 ~3 点内）④<7.4 段 P4 压制行为差

### T98 人气门换键 holders→holdersExDust 剔尘埃口径（两臂同改：buy-v2 v49→v50 + buy-early-narrative v9→v10 + FA 新键 `holdersExDust`；2026-10-29 用户裁定「我认为还是极小持仓者剔除（这样不会让假活跃票进门），可以新搞一个因子，替换现有的 holders 因子」）

- **案由（holders 口径问询→裁定）**：用户问「holders 这个因子，有没有去掉持仓数量已经清零或者非常小的持有者？」——查证：①清零者已剔（跨 0 边界 ±1 增量维护）②极小持仓无任何门槛——唯一相关的门是 collector tick 尘门 0.001 BNB 拦**单笔成交行**落因子，「卖剩渣」残仓与刷 holder 钱包照计 holders。用户裁定剔极小持仓者，新因子替换
- **口径**：`holdersExDust` = 净持仓按**首可靠价**折算 ≥ `holderDustBnb`（初版 0.002 → 同日追裁定 **0.015** 现行，factorParams 可覆盖、显式 0=关）的钱包数——刷 holder 的假活跃票（多钱包各买刚过 tick 尘门的 0.001-0.0015 BNB）不再计入人气门分子
- **阈值 0.002 依据**：0.001 只能剔「卖剩渣」剔不掉刷量钱包（单笔刚过 tick 尘门的钱包恰是刷 holder 主力档）；0.002=2× tick 尘门+perCardBNB 单卡仓位——低于单卡仓位的钱包不构成有效承接
- **实现（FA 增量维护，非读取点过滤）**：尘门=**token 域常量 T=holderDustBnb÷首可靠价**（价格涨跌不扰动计数=「投入」口径）；首价冻结点（`_relFirstPriceBnb` 首次非零）固化 T 并一次性全 map 重扫纠 T=0 期间计数（每 token 一生恰一次 O(map)，P2a 回测热点零影响）；此后与 holderCount 跨 0 同点做**跨尘门边界 ±1 增量**（门=常量→单钱包变动不影响他钱包跨界→归纳等价、任意序重放收敛——defer 乱序回推无害）；读取点全扫方案被否（回测 130 万 tick × 万钱包 map 热点回归）
- **fail-open 方向**：无可靠价票 T=0 退化=holders（宁多计不放大门拦截力）；显式 holderDustBnb:0 恒等 holders（关=旧口径）
- **单测**：`_test_holders_ex_dust.cjs` 21 断言全过——A 基础口径/B 卖剩渣出局（holders 照计=对照口径不动）/C 尘钱包清仓/D ★**假活跃票现场反证**（10 钱包各 0.0015 BNB+1 大钱包：holders=11 过旧门 vs holdersExDust=1 新门拦死——门语义反转实证）/E 首价缺失退化/F 首价晚到固化重扫/G 显式 0 恒等/H 乱序 parity/I 探针收键+FactorBuilder 快照透传/J 源码口径断言；连带 `fourmeme_fa_factors` 白名单补 5 只存量欠账键（T93 top2HolderCircPct/T94 top1S+top2S/T97 secSincePeak/T98 holdersExDust）→ 35 通过 0 失败
- **部署链**：代码 023befb + 部署脚本 e20aa9b → 182 pull → `bump-t98-holders-exdust.cjs --commit`（v50/v10，防呆=旧段恰一次/裸 `holders >=` 零残留/兄弟门 12+11 段锚定）→ v54 持仓确认（握手小猫 `0x3b942497…7777` OPEN 885031 token≈0.006 BNB 3 卡，T95 先例同形状弃管）→ v54 TERM 优雅停（03:49:29 UTC，PID 2248290）→ `create-v55.cjs` → **v55 `7ab210a5-3133-4f58-90e4-5bceb23efbfa` 03:49:58 UTC 起实跑**（PID 2275098；ERROR=0、23 策略装载、两腿 holdersExDust 段各恰一次、双 collector 实时采正常）。阈值不动（主 10/早期 5）：口径变小同阈=更严，观察后可调
- **撞号注记**：T97 案卷原「v55 create 脚本备好待换车」——v55 编号被本案占用（T98 先行换车）；T97 已重建 `create-v56.cjs`（fa6058d，克隆 v55/T98 快照+插腿，防呆锁 T98/T96/T95/T93 形状）并于同日上线 v56 `4ac10e23`——两改进同车无覆盖
- **追裁定（同日晚，holderDustBnb 0.002→0.015）**：用户问「dust 是过滤了持仓市值多少的代币？我观察买入的时候，持仓稍微大一点的钱包应该没几个」——澄清口径（尘门过滤的是**钱包**非代币；按**首可靠价**折算=买入成本口径非当前市值，涨价不洗白/跌价不误伤）+ Jenner 票 `0xa3362c21c25e5da5236e8b60d461af512e897777` BUY 时刻 16 持仓钱包折算分布实查（≥0.2 BNB 仅 4 个、0.0096-0.002 档 7 个）印证「稍大钱包没几个」属实 → 裁定「把阈值改为 0.015」（≈$10.5，$10 以下钱包不算有效承接）。影响预估：Jenner 形状票 holdersExDust 16→9，主腿 `>= 10` 门过不了=触发率显著收紧；**条件串阈值 10/5 不动、库不 bump**（收紧由尘门口径实现）。FACTOR_PARAM_DEFAULTS 进程启动读入——v58 `12ef2c48` running 不动（换车链并行会话管理），重启/下次换车生效。单测同步：A-I 组显式传 `{holderDustBnb: 0.002}` 锁原语义（设计原则=**测机制非默认值**，以后调默认不破测试），J4 断言默认 0.015，21 断言全过
- **观察点**：①触发率变化（口径变小同阈=更严的拦截面；0.015 后显著收紧——两档收紧叠加）②被拦「假活跃票」结局（D 组形状：多尘埃钱包凑 holders 过旧门、真实承接 wallets 数少）③holdersExDust 与 holders 差值分布（0.002/0.015 双档对照——差值大=尘埃钱包浓度高）④holderCount 与 holderCountExDust 双键并存，holders 旧键保留纯观察

### T96 净买门换轨 OR→AND「短期开始涨，长期下跌趋势解除」（两臂同改：buy-v2 v48→v49 + buy-early-narrative v8→v9；2026-10-29 用户裁定「把买入条件 tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40 改为 tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40」「两个臂都改」）

- **新形状**：`(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)`——短窗（尾 20 笔）须强净买 ≥40（短期开始涨）∧ 长窗（尾 100 笔）净比非负（长期下跌趋势解除）。**严格收紧（新 ⊆ 旧 OR 门）**：旧过新不过=①长≥40 但短<40（长强短弱，短期已熄火）②短≥40 但长<0（短窗反弹、长窗仍在净卖=下跌趋势未解除）。null 语义不变：长短窗同源于 `_activityEvents` 环（环空两者皆 null，`>=` 恒 false fail-closed；T87/T88 口径零变化）
- **部署链**：库 bump-t96-netbuy-reshape.cjs（v49/v9，防呆=两源段恰一次/旧 OR 臂零残留/兄弟门锚定）→ v53 f1cd791b 起跑 5min 零成交即停（T95 刚部署就被本批换车替代，无弃管）→ create-v54.cjs → **v54 `0007ff5a-8a17-4e31-928f-53af7e3f2d2e` 03:08:41 UTC 起实跑**（PID 2248290；日志 config 两腿新净买段 ×2、旧段零残留、ERROR=0、23 策略装载）
- **观察点**：①触发率（净买门收紧的拦截面——「长强短弱」形状票占比）②被新门拦截票的结局（若「短弱」其实是买点更早的代价，拦掉的是入场太晚的票则属正向）③「短反弹长负」形状票结局（拉盘出货中段 vs 真反转初段）④与 T95 放宽的合流效应（早期臂双向变动：集中度放宽放行 + 净买收紧拦截）

### T95 早期臂集中度门放宽 +10（buy-early-narrative v7→v8：top1HolderCircPct 35→45 / top2HolderCircPct 65→75；2026-10-29 用户裁定「低市值臂的当前 top1/top2 因子再放宽一些」）

- **依据（3 天 13 live 实验 1050 票、492 有窗票阈值网格，tmp-top-supply-analysis 182 跑）**：top1 是主 binder（单维 35→45 新增 13 票 up 中位 32.8%；top2 边际小——65→75 单维仅 1 票）；组合档 `t1<45 ∧ t2<75` 新增 18 票 up 中位 41.6%、up≥30% 占 11/18、dn 中位 -15%、pnlΣ +0.0039；**再宽 t1<65 up 中位掉到 20.9%=质量下滑**，故 +10 封顶（T85 同节奏）。机制背景=Binancians 0x04c1 案早期流通分母小占比虚高（窗内 top1 49.9-62.5 从未达 35，早期臂结构性失明——T94 supply 分母观察键同步落码攒分布，门是否换分母待观察后再裁）
- **部署**：bump-t95-early-arm-loosen.cjs（库 early v8）→ 查 v52 持仓（2 票 OPEN 各 0.006 BNB：「42」0x027804cc/「할머니 강아지」0xd49e4375，用户裁定「直接停，弃管两票」）→ 停 v52 bc77ac6c → create-v53.cjs → v53 f1cd791b 03:03:20 UTC 起实跑（**5min 后被 T96 换车替代**，零成交零弃管）。主腿 buy-v2 v48 逐字不动=对照臂
- **观察点**：①早期臂触发率（新增面=top1 45-55 段票形状）②对照臂分歧（同票主臂/早期臂先后 fire 形状）③被放行票结局（对倒票混入面——top1 45-55 段的坏人浓度）

### T94 前 1/2 大净持仓占总量比例观察键（FA 新键 `top1HolderSupplyPct`/`top2HolderSupplyPct`，纯观察不进条件串；2026-10-29 Binancians 早期臂失效归因用户裁定「早期 top1 top2 持仓流通量占比一般来讲就是会很高……不应该以流通量为分母，而是以总量为分母」「先新增占总量比例的因子，再继续观察一段时间再说怎么用」）

- **驱动案（Binancians 0x04c172a2bcf8ac8cae1518e028a3335bbfab7777，flap）**：早期臂 mcap 窗 6.0-6.7 BNB 仅 01:16:57-01:17:07 开 10s（首 tick 6.78 高开在窗上方→回落进窗→拉走出窗），窗内 `top1HolderCircPct` 49.9-62.5 / `top2HolderCircPct` 78.8-98.7 **全程高企**——早期流通未铺开（分母 circ 只占总量小部分），首买家占比天然虚高；`top1<35` 翻真时刻 01:17:29 已出窗 22s——**集中度稀释速度赶不上市值出窗速度，早期臂窄窗对该形状结构性失明**（最终主臂 01:17:32 fire）。用户裁定方向：占比应看「买到总量的多大比例」，先落观察键攒分布，换门与否及阈值后续再定
- **键口径**：分子与 top1/top2HolderCircPct 完全同源（`_top1Net` / top20 前缀 `_nA+_nB`，只收正净、净卖者出局、<2 正持有人退化=top1），分母换 `state.totalSupply`（TokenCreate 终态；flap/gang 恒 1e9）——度量「前 1/2 大持仓者买到总量的比例」不受流通进度污染。null 语义：totalSupply 缺失(=0) → null（marketCap/shares 族同惯例 fail-closed）；supply 在无 tick → 0 有证据零值。不变量：恒 ≤ 同名 circ 键（supply ≥ _circDen）、恒 ≤100（正净持仓源自池内买入，Σ正净 ⊆ 池累计流出 ≤ supply）
- **纯观察（T74/T76 先例）**：不进任何条件串、不 bump 库版本；FactorBuilder 快照白名单透传（OBSERVE/signal metadata 落库可后验），旧 FA 历史信号无键 → null 不掩盖
- **交付**：FA `_buildFactorMap` 计算段+发射字面量两键 + FactorBuilder 白名单 + `_test_top_holder_supply.cjs`（20 断言：A 公式精确值双分母对照/B ★早期流通反证 circ 60 虚高 vs supply 3（30M/1e9）/C 恒 ≤ 不变量/孙权纯卖形状分离（circ 分母被压 supply 不动）/退化负净出局/乱序 parity/supply 缺失 null+空窗零值/探针/快照透传/源码锁）。分析工具 `tmp-top-supply-analysis.cjs`（182 跑，3 天 13 live 实验 BUY+OBSERVE 候选池双口径逐 tick 重放，窗内决策原料落 JSON 供阈值网格）
- **观察点**：①快照攒 top1S/top2S 分布及其与票结局的相关性（circ 口径同帧对照）②早期臂 top1/top2 门是否换 supply 分母及阈值（用户裁定后再动）③flap 与 four.meme 票两平台分布差异（flap 税币纯卖钱包只影响 circ 分母，supply 口径天然免疫）

### T93 保护条件瘦身：删 flap 路由门+sybil 门，top2 块簇门→top2 持有人门（buy-v2 v47→v48 + buy-early-narrative v6→v7 + FA 新键 `top2HolderCircPct`；2026-10-29 BI/Meecot 迟买归因用户裁定「恐怕这些保护条件还要再进一步瘦身，不然真的没法搞了。sybil 门 直接去掉，tradesRouterPct 直接去掉，top2BundleClusterHoldCircPct 改为 top2 持有者的门」；阈值拍板 主 55/早期 65 承接；v52 起实跑。注：与戊段 T92（KYA 恢复轮询案）同日并行撞号，本案编号 T93）

- **驱动案一（BI/Binance Inu 0xa7ef3d3d483aab96228a331af89321ef38eb7777，flap 税币，整段行情 25s 走完）**：rating=3 +4.4s 就绪（leadMs=22.6s 全耗在条件门等待）→ binder=flap 路由门 `(platform != 'flap' OR tradesRouterPct >= 30)` **独拦 12s**（GMGN 聚合路由份额 +20s 才过 30%——路由主导盘的占比爬坡是结构性慢变量）+ top2 块簇门最后收口（+25s，一号买家 0.99 BNB 顶门上；重放 at-fire DEMOTED=DB sender 回填偏差形状，OBSERVE live 轨迹佐证）→ fire=+27s 买在顶部右侧 2.194e-8（反事实 +17s @1.476e-8 价差 +48.6%，ΔF=+0.000849），11.6s 后 -68% 止损——快速事件票的门时间常数（routerPct/holders 积累速度）与行情节奏不匹配的典型形状
- **驱动案二（Meecot 0x8671d681ee38039892bbad010b89813fb25e7777，flap，同名三连发之一）**：rating=3 +4.4s 就绪 leadMs=179s，长杆=sybil 大簇门——OBSERVE 轨迹 sybil=100(+13s)→77.3(+73s)→66.4(+133s)→**59(+183.5s 擦线 1 点过 60 门 fire)**，其余门 +31s 起已全真；期间盘整卖潮把净买窗（nBLW 48→16/nBSW 94→32）与 slope 打翻负、fire 前一瞬恢复（nBSW 91.9）；反事实 +31s @6.64e-9 vs fire 9.65e-9（ΔF=+0.0033），两段 episode 全亏（-38%/-33%）——**sybil 高位票本身就是关联簇拉盘形状，等散户稀释 150s 换来的仍是接顶**（T89 35→60 放宽后 sybil 未退场，只是拦的票变少）
- **三处瘦身（两腿同款）**：①删 ` AND (platform != 'flap' OR tradesRouterPct >= 30)` ②删 ` AND sybilClusterHolderCircPct < 60` ③`top2BundleClusterHoldCircPct < 55/65` → `top2HolderCircPct < 55/65`（阈值承接）。**三键全部退为纯观察键**（FA 照算、roster loader 不动、OBSERVE/signal metadata 照落——同 T91 删门留键先例；sybil 扫描建库链路 `scan-sybil-clusters` 不动）
- **新键 `top2HolderCircPct` 口径**：前两大净持仓**合计** ÷ 同一 `_circDen`（T91a max(circ,Σ正净)）×100——与 top1HolderCircPct 同口径同分母；原料复用 top20 降序前缀 `_nA/_nB`（只收正净 `v<=0 continue` → 恒 ≥ top1、恒 ≤100 恒等式天然成立）；<2 个正持有人退化=top1 值（bundle top2「不足两块退化 top1」同款语义）；0=有证据零值非 null；净卖者自然出局。**与块簇门语义差（换轴非微调）**：块簇门按「块」聚合并集去重（同块 4 钱包等额簇=全簇合计 100 拦），持有人门只看前两大（同形状 (10+10)/40=50 放）；反向跨块复买囤筹两门同拦（wallet 域聚合力天然在，单测 C4）
- **交付**：FA `top2HolderCircPct` 计算+发射（FactorBuilder 快照白名单透传）+ `_test_top2_holder_circ.cjs`（24 断言：公式精确值/巨鲸+二号仍拦/★块簇 vs 持有人口径分离反证/退化与负净出局/T91a 孙权形状 ≤100 反证/乱序 parity/探针/快照透传/源码锁/ConditionEvaluator 55/65 直评）+ `bump-t93-protect-slim.cjs`（删除段恰一次+换名源段恰一次+三旧键零残留+platform 子句零残留+KEEP 兄弟门锚定+trigger/gmgn/maxExecutions=2 不动锚）+ `create-v52.cjs`（克隆 v51 d41b9c29 唯一变量=两买腿 ←库 v48/v7 copy-in）
- **观察点**：①触发率与买点提前量（BI/Meecot 类快速事件票的三门等待形状应消失）②对倒/sybil 票漏拦面（top1<35+top2Holder 55/65+跟单/著名名单四门接棒；sybil 观察键照落可后验）③flap 路由盘无 router 门后的亏损分布（T70 立门动机=flap GMGN 路由盘质量差，但占比是慢变量在秒级行情里只剩拖慢）④top2Holder 阈值 55/65 的实际拦截分布（恒 ≥ top1=35，两者兼拦=单户垄断形状；OBSERVE 帧分布后验再调）

### T91 集中度族瘦身 + 流通分母口径修复（buy-v2 v46→v47 + buy-early-narrative v5→v6 + FA 分母 max 修法；2026-10-28 孙权 0x3b1b…7777 top3=114% 案用户裁定「便宜门只保留 top1 top2 集中度条件吧。但无论如何一个，都要解决大于 100 的问题」；v51 起实跑）
- **驱动案（孙权 0x3b1b28cf8e4ba5699670b5628691a3f9e5577777，flap 税币 taxToken:true，14:20:36 创建）163s 成交延迟归因**：叙事 14:20:48 完成（age=12s 单轮 high，`leadMs=162s`=叙事领先买点的量非耗时——初判「叙事轮次在等」系归因错误）；便宜门（净买/mcap 窗/routerPct/人气 AND/tradeCount）14:20:50 全过；top1 14:20:38 早过；**bundle<35 与 top3<75 拖到 14:23:17 才过（161s 最后收口门）**→ BUY 14:23:31 mcap 17.0（OBSERVE 帧序列：14:22:56 mcap=6.25 → 14:23:31 mcap=17.0 拉升段过门，买贵 ~63%）
- **top3=114%>100 病根**：flap 税币零买入纯卖出钱包（初始筹码/税币接收方 40 个，Σ−226M≈22.6% 供给：Sell 事件在、Buy 事件永无）把 `_circTokens`=Σ买−Σ卖 压到低于真实在外筹码 → 所有 ÷circ 键（top1/copy/famous/sybil/bundle 三门/top2/top3/even）系统性虚高偏严——OBSERVE 帧 top3 序列 91.8→**114（14:21:51，signals 页所见帧）**→87.2→BUY 时 48.5
- **T91a 分母修法（FA `FourMemeFactorAggregator`）**：全部 ÷circ 键分母统一 `max(_circTokens, Σ正净持仓)`——恒等式：分子只计正净持仓（top1/名单族/块簇并集/even 并集 ⊆ Σ正）→ 分母取 max 后**恒 ≤100**；正常票（无纯卖钱包）Σnet(买入钱包)=circ ⇒ Σ正 ≤ circ ⇒ max 恒取 circ=**逐输入 bit 不变**（four.meme 全量历史键值零扰动）；读取点单趟求和（`_bundleClusterFactors` 签名扩第三参 `circDen`，scan-bundle-clusters 直调点同步）；写点零改动。修正分母重放孙权：top3 age=12s 即 <75、top2 14:21:07、bundle 14:21:54——**163s gap 几乎全是口径虚高假拦截**
- **T91b 条件瘦身**：两买腿删 `bundleClusterHoldCircPct`（35/45）与 `top3BundleClusterHoldCircPct`（75/85）两门，留 `top1HolderCircPct < 35` + `top2BundleClusterHoldCircPct < 55/65`（top3 恒 ≥ top2 ≥ top1 共线性高、边际拦截价值小；top1/top2+名单门四道仍在）。T67/T68 两门退役留档
- **交付**：`bump-t91-concentration-slim.cjs`（删除段恰一次+删后零残留+KEEP 兄弟门锚定+T89/T90 形状锚）+ `create-v51.cjs`（克隆 v50 ced5d5a9 唯一变量=两买腿 ←库 v47/v6 copy-in）+ `_test_circ_denominator_cap.cjs`（孙权现场反证/正常票 bit 不变/负净抵扣/全清仓零值/混合恒等式扫描/乱序 parity/源码锁七组 19 断言；既有 bundle/even 测试源码锁同步新签名）；FA 改动点=`_buildFactorMap` 分母入口+`_bundleClusterFactors` 五处分母位+top1/copy/famous/sybil 四处
- **观察点**：①孙权类税币票买点提前量（拦截窗消失）②删两门后对倒票漏拦面（top1/top2/名单门接棒，T74 even 观察键仍在）③÷circ 键 >100 是否绝迹（恒等式保证，OBSERVE 帧抽查）

### T90 人气门 OR→AND（buy-v2 v45→v46 + buy-early-narrative v4→v5 同批；2026-10-28 用户裁定「买入量/持有者必须改为与的关系，防止前期就很少的人刷量，或者多钱包极小量买入；强势臂同样至少需要一个与条件，这两个必须都满足基础要求」；v50 `ced5d5a9` 14:55 UTC 起实跑）
- **两腿改动（阈值拍板）**：主腿 `(buyVolumeBnb >= 1.25 OR holders >= 10)` → `(buyVolumeBnb >= 1.25 AND holders >= 10)`（阈值原值直接 AND）；早期臂 `(buyVolumeBnb >= 0.25 OR holders >= 4)` → `(buyVolumeBnb >= 0.25 AND holders >= 5)`（人臂 +1）。其余门/sybil 60/bundler 100/maxExecutions=2 承 T89 不动
- **分界分析（`tmp-pop-and-gate-analysis.cjs`，182 跑，样本=10d 叙事通过池 rating high|mid stride4 → 127 活跃：dead 全史 buyB<3 共 58 / mid 3-10 共 34 / alive ≥10 共 35）**：①600s 时点死票 buyB p50=1.35/holders p50=8，活票 buyB p50=14.46/holders p50=62——死/活分界带 ≈buyB 2 / holders 10-18；②早期臂 OR(0.25|4) 下死票 **100% 过门**（52/58 首达标帧=「量到 0.25 而人 <4」单钱包/寡头刷量形状——用户担心形状实证）；AND(0.25&4) 死票 91%、**AND(0.25&5) 83%**，mid/alive 100% 不动；③主腿 OR(1.25|10) 死票 57%/mid 97%/alive 66%；AND(1.25&10) 死票 33%/alive 63%（活票损失 3pp）；主腿 OR 过门死票 23/33=buyB≥1.25 但 holders<10（量到人不到）
- **交付**：`bump-t90-pop-and.cjs`（OR/AND 子串恰一次防呆+KEEP_SEGS 兄弟门锚定+T89 形状锚）+ `create-v50.cjs`（克隆 v49 596bfb92 唯一变量=两买腿 condition ←库 v46/v5 copy-in；库-实验 gmgn/trigger 逐字一致+条件除人气门段外逐字一致防线）；停 v49 前零仓确认（兔咯咯 0x7b18…7777 已被引擎 14:45:49 自动全清 -28%，孙权 0x3b1b…7777 早全平）→ v50 `ced5d5a9-6d24-49b2-80bd-5fbb069a81ec` 起跑 0 ERROR，两条 AND 串装载确认
- **换车插曲（182 部署防线实证）**：首跳 `git pull` 被本地未跟踪同名分析脚本挡道静默失败（`tail -1` 吞了 error）——重跑显错后删除再拉成功；教训=pull 后必须 `git log` 核对 HEAD 到位再跑下游脚本
- **观察点**：①触发率变化（v49 短跑 14:20-14:55 为对照段；主腿死票 57%→33% 拦截面、早期 100%→83%）②被拦票结局抽样（新拦的 OR 过 AND 不过票是死票还是被误伤活票——矩阵说 3pp 损失，实盘验证）③刷量形状是否再现（量到人不到首达标帧应消失）

### T89 门放宽三处 + 二次入场 maxExecutions 1→2（buy-v2 v44→v45 + buy-early-narrative v3→v4 同批；2026-10-28 用户裁定「叙事通过的票无人问津占大多数，流动性非常不好，条件明显偏严格，导致买入的票在高位」；v49 `596bfb92` 14:20 UTC 起实跑）
- **四处改动（两腿同批）**：①人气门 ExSybil 键→原键 `(buyVolumeBnb >= 1.25 OR holders >= 10)`（用户澄清「就是 buyVolumeBnbExSybil/holdersExSybil 恢复回 buyVolumeBnb/holders」——纯键替换，OR 结构与阈值不动：主 1.25/10、早期 0.25/4；FA 两键常驻发射，ExSybil 键保留观察）②sybil 簇门 `sybilClusterHolderCircPct < 35 → < 60`（用户拍板 60；0 语义不变）③GMGN bundler 门 `<= 65 → <= 100`（用户拍板 100；10.7 豁免臂/issuer 分档门/C85 适用集保留）④`maxExecutions 1 → 2`（二次入场）
- **二次入场机制链（引擎零代码改动，纯策略字段）**：成交计数闸（StrategyEngine evaluate，per-token per-strategy）2 次后才封；持仓中 `status==='bought'` 不进买腿分支=单仓语义「买了没卖不会再买」；全清卖删卡账本（`_tokenCards.delete`）→ 再买满 3 卡（**卡牌总数 6 帽跨轮共享不变**——非每轮新 3 卡，累加制 cardTrade before/after）；completedPairs 轮次>0 走 `repeatBuyCheckCondition`（两腿未配=跳过 preBuy 检查不拦截）；GMGN repeat 轮同条件串照评。案发=**BATCOIN `0xd1459d41ff9651101ace78770e38f0508e557777`**：v47 首轮止损离场后被震荡拉起，卖后 77min 条件多次可满足但 maxExecutions=1 拦死
- **归因依据（v47 四票样本，tmp-buy-delay-attribution-v47）**：sybil 门 2/4 binder（Michistellar 独拦 36.4s/+4.5%）；蝙蝠币 0xc79a 滞后 267s 全在 GMGN bundler 层（114.3>65 ∧ mcap 13.15>10.7 豁免线，33 连拒等砸盘）；v48 全程零成交（起跑 2h trades=0）亦佐证触发面过窄
- **交付**：`bump-t89-gate-loosen.cjs`（四处旧形状恰一次防呆+兄弟门锚定+trigger 不动+maxExecutions===1 锚点+expectedVersion 乐观并发）+ `create-v49.cjs`（克隆 v48 f9c2ec74 换腿 v45/v4 三字段 copy-in：condition/gmgn/maxExecutions；库-实验=变更段替换后逐字一致防线）；v48 优雅停（2s 退出零仓）→ v49 `596bfb92-b07a-452e-b437-988db6e2438d` 起 14:20 UTC（引擎装载「买入 ×2」确认 maxExecutions 生效）
- **观察点**：①交易数量提升幅度（v48 零成交基线）与买点位置是否仍高位；②sybil 60/bundler 100 新拦截面——被拦票分布与误放对倒票（T72 反演「<35 是排除器非排序器」边界外移后的净效应）；③二次入场轮胜率（BATCOIN 形状震荡下车票 vs 死票二次接刀）；④人气门回原键=对倒票自拉自买重新计数进分子（ExSybil 当年的动机），与 bundle 三门（不动）的交叉防线是否足够

### T88 净买门全史臂断代换长窗 M=100 笔（tradesNetBuyRatio → tradesNetBuyRatioLongWin；三键改名 ShortWin/LongWin/ShortWinBnb；2026-10-28 用户两段裁定「全量买卖比我觉得没必要，还是为了检测一个趋势」+「先定 100 吧」）
- **裁定链**：用户提议全史键换窗口键+两窗改名（ShortWin/LongWin）并授权我定 M → 首版 M=300（数据最优档）→ 用户质疑「两个窗大小差异过大，不太合理」并要求拿**叙事分析通过的代币**回测 → 补第三套回放证实买点行为全档同帧（用户直觉成立）→ 用户拍板 **M=100**（20:100=5 倍配比）
- **键名三断代**：`tradesNetBuyRatio`（全史）删 → `tradesNetBuyRatioLongWin`（尾 `netBuyWinLongTrades`=100 笔）；`tradesNetBuyRatioWin` → `tradesNetBuyRatioShortWin`（尾 20 笔不变）；`tradesNetBuyWinBnb` → `tradesNetBuyShortWinBnb`（观察键）。OR 臂 `(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)`，**阈值 40 不动**。`tradesRouterPct` 刻意维持全史（路由占比无「砸盘拖低」形状，分子分母同源无时漂）。**null 语义断代**：环空=null fail-closed（旧全史键「全空=0」退役——`>=40` 门下等价恒 false）；尾窗全卖=-100 有证据零值；M>n 时长窗=全史值（中小票 bit 一致最小干预）；prune floor=max(短,100,32)
- **三套回放数据（182，tmp-nwin-long-scan/pool + tmp-nwin-narrative-pool）**：①fire 样本 302 已买票——首放行帧六档（50/80/100/150/200/300）**零扰动**；决策帧翻车面 15/5/**4**/2/2/0，翻车票全为「近期砸盘+长史强净比」的**第二波大赢家**（M=100 四票 0x8daaf48c/0xb1ab482264/0x55d32194cf/0x43abc54aa0 win100=14.8/−23.3/33.7/19.5，peak 235~487%，n=495~1485 长命票）——M 越小「死记忆」截得越狠；②全量池 208 活跃票——六档**纯新增=0**（换轨不创造新买点），n≥100 仅 72 票；③**叙事通过池**（用户质疑驱动补测）——10d high|mid 234 活跃（stride2，197 买点满足）**六档买点完全同帧**（早 0 晚 0）：tN 决策帧票龄中位 **7 笔**（p75=14），M≥票龄即=全史 → **M 实质=长命票记忆上限而非买点参数**，M=100 与 300 买点零差异，差异只在 n>100 的二波票
- **M=100 裁定依据**：配比直觉（5 倍）+③同帧实证零买点代价；已知接受代价=①的 4/302≈1.3% 长命二波票误拦（peak 200%+ 赢家）
- **交付**：FA（factorParams 长窗参数+`_netBuyWinFactors` 三键+floor 长窗入保底）+ FactorBuilder 快照白名单三键 + 单测四文件全绿（netbuy_window 44[新增 K/K2 长窗边界：150 笔密集流 50 卖滚出长窗→100、151 笔新卖 97.47 精确值/floor=100 不裁穿]/activity_window 43[floor=100 文案]/fa_early_trades 21[断代声明+M>n 序列 bit 一致]/fa_factors 35[49 键清单三新键]）；策略库 bump `bump-t88-netbuy-window.cjs`（buy-v2 v43→v44 + buy-early-narrative v2→v3，旧 OR 臂子串恰一次防呆+兄弟门锚定）；**v47→v48 换车**（copy-in 快照+旧键名配新 FA=三防线拒启 → 必须新建实验，不能原地改 config）
- **观察点**：①长命二波票（n>100 且 win100<40 但全史≥40）误拦面实跑频率与峰值分布——攒批后可议 M 上调或加「全史过线+短窗不塌」三臂；②ShortWin 放行票证据薄形状（`tradesNetBuyShortWinBnb` 过小，T87 观察点承继）；③重启自愈=重启后 M 笔内 LongWin 为「重启后史」（全史键同款已知形状，M 笔后恢复）

### T87 flap collector 盲期暂存白名单 + 净买窗换轨 N 笔尾窗（2026-10-28 0xdf7a5f8356ef771128e8bde49527409981c47777 案用户三问①③；commit ebe880e + 201f225）
- **案发**：0xdf7a（flap BNB 盘）09:12:14 Created、09:14:37 才首次进 FA——QuoteSet 持久映射 **362 万行惰性加载 ~2m53s**（触发点=启动后首个 logs 订阅确认帧，已是尽早点；耗时在加载本身），盲期内**全部 trade/graduation 暂存（含 BNB 盘）**，0xdf7a 家族三票恰创建于盲窗内 → +47% 涨幅盲区、叙事发起/买点整段推迟；用户三问①「叙事分析为何这么晚」②「中途为何不能买」（已答：fire 时已涨停帽/市值窗出带+涨后回撤门，非机制拒绝）③「10 秒窗口换交易数窗口吧，取一定数量的交易数量，否则慢热 10s 内无腥味」
- **修复①盲期白名单（ebe880e）**：本进程 Created 的 token（`_sessionCreatedTokens`）或实时 QuoteSet 已 apply 的 token（`_nonBnbQuoteTokens` 命中）计价当下即为链上真值（QuoteSet 事件与 trade 同订阅流、按链上 log 序必先于依赖它的 trade 到达）→ **即时处理不暂存**；历史票（重启前创建、映射未加载完）维持原暂存语义；decode 失败保守暂存。已知暴露面=QuoteSet tx 与 trade tx 间断连卡缝低概率形状，不加兜底（用户确认）。量级=flap 日创建数百票常驻数天仅百 KB 级。单测 `_test_flap_session_created_backfill_bypass` 34 断言（T9=0xdf7a 五连 tick 现场反证全程零暂存）+回归 watcher_quote_conversion 85/tick_buffer_watermark 73/embedded_collector_architecture 42
- **修复③净买窗换轨（201f225，T77 承继）**：FA `netBuyWinMs`(10000) → `netBuyWinTrades`(20)，`tradesNetBuyRatioWin`=**尾 N 笔**（到达序环尾）(Σ买−Σ卖)÷Σ买×100。**null 语义随换轨统一**：环空=null fail-closed；尾窗全卖=−100 有证据零值（T77「10s 零买=null」退役——慢热票 10s 内常无行情，时间窗 null 恰好掐掉目标形状：0xdf7a fire 帧 win10=−531.67 集中卖压 / win20=**82.05**）；`tradesNetBuyWinBnb`=尾窗买量观察键照旧。OR 臂条件串零改动（`tradesNetBuyRatioWin >= 40` 键名不变=23 策略零拒启）
- **N=20 裁定数据**（tmp-nwin-scan 318 fire 票 + tmp-nwin-pool 全量池 stride40 抽样 197 活跃票，均 182 跑）：fire 样本三值拆解——全史臂扛 273、10s 窗臂扛 **0**、win10=null 基数 0（被净比门拦的票无 signal 行不可见=选择偏差实证，fire 样本只能量回归不能量收益）；全量池——拦截面（现行放 N 版拦）全 N=0 零回归风险，新增面 N=20 peak p50 24.3%/peak≤0 仅 11% 最优，**add 帧全晚于 base 帧**=N 窗真实行为是砸盘后残余证据非提前量；两案票决策帧 N=20 最强（MUSK2028 87.1/0xdf7a 82.0）；**N=10 排除**（0xdf7a 决策帧 −531=尾窗恰含集中卖压段，笔数太少被单笔大卖主导）
- **实现细节**：读点 `_netBuyWinFactors(state)` 去 now 参数=零周期判定（asOf 推进读数不变）；裁剪 `_pruneActivityEvents` **环尾 floor=max(netBuyWinTrades,32) 笔永不裁**（`maxCut=evts.length−floor` 上限）——纯时间界会把稀疏票 N 窗证据裁穿（每 tick 裁头部后环恒剩 ~2×activityWinMs 行）；act\* 读点按 ts 过滤对滞留旧行天然不可见无损；复用 `_activityEvents` 事件环（求和交换律=defer 乱序回推无害）。单测 `_test_netbuy_window_factors` 重写 33 断言 + activity_window 43/fa_factors 35；**fa_factors 存量失败顺手收口**（stash 验证 main 同败）：T84（722cd8e）marketCap/fdv/peakMarketCapSinceLastBuy BNB 域断代漏登记豁免+entryMarketCap 白名单 48→49，契约由 _test_mcap_bnb_domain 锁定
- **观察点**：①N=20 放行票盯 `tradesNetBuyWinBnb`（尾窗买量过小=证据薄的形状是否成亏票主力）；②对倒放量形状（尾窗净比先回 40 的短暂正净流）是否需收紧——T77 同名观察点换轨后重开；③flap 盲区修复实跑验证=`sessionBypassDuringBackfill` 计数增长且新票 Created→首 tick 秒级

### T86b gang 全自动第二轮穷尽分析终局——毕业票 PCS/打新子空间市场否证，项目停止（2026-10-28 用户指令「你再分析一遍，尽最大努力，如果不行，就先停止项目了」→ 结论=全部子空间不成立，用户批准停止）
- **源码级复核（第一轮八条链攻击未破）**：gangfun/gang-launchpad 全源码逐行——`CurveLogic.sol` L169/L281 buy/sell 全查 `_requireAgent(c, trader)` **无豁免臂**（「issuer 豁免」是 Four.meme protocol=2004 特性 gang 没有）；`buyFor/sellFor` 走 `_forTrader` 只许 listed router+`trader==tx.origin`；`FairLogic` create 查当前 gate/mint 查快照 gate/withdraw 无门但份额=pad 内部记账不可转；链上实测 `agentGateEnabled()`（selector 0x4753600b）V3/V2 pad 均=true；V2/Soft/U/S pad 停止新创建（CLI help 原文）=存量市场无流量
- **毕业票 PCS 空间（第二轮唯一技术面突破）→ 市场面否证**：毕业票在公开 AMM（PCS V2 router），**EOA 直签不需要 .ai/BAW/GangRouter，全自动零技术障碍**（引擎 graduated_pcs_routing 分支可复用）——但 182 实测回放（/tmp/graduated-pcs-replay.json）：V3 track 全历史毕业票仅 **3 张**（GBOT/AGORA/TICK，≈3-4 张/天）；轨迹无稳定形态（GBOT 5m 0.90→0.67 活跃 12min 死透；AGORA 5m 冲 1.86→1h 0.86 全回吐；TICK 慢牛 2.3x 但 1h -25% 洗盘=div 100 持有分红型）；**swapBack 结构性持续卖压**（毕业 unsold token 按块预算卖回池 ~1M tokens/block，卖/买笔数比 1.5-1.6x 恒逆风）；池深 14-23 BNB；完美捕获 10-20% 的绝对收益上限 ≈ **0.01-0.02 BNB/天（$7-14/day）**——工程投入不成比例
- **打新（fair mint）子空间彻底否证**：21 条 sale 17 minting 滞留/4 launched（**完成率 ~19%**，81% 资金只能 withdraw 保本+gas）；FairLogic L315-316 migrate 无扣费全额进池（10000×sharePrice+LP_SUPPLY 5 亿枚）→ **PCS 首价≡mint 成本价（比值恒 1.0）无结构性价差**；launch 后相对 mint 成本 **4/4 全面破发**（Gangstar now 0.51/杠 0.80[5m 冲 6.22→1h 0.47 腰斩=抢首块者即砸盘者]/MYT-a 0.26/MYT-b 0.39），抢筹者卖/买比 1.7-3.9x 结构性集体出逃——mint 自动+launch 后任何时点卖出=负期望
- **其余路径快速排除**：曲线期「BAW 买入持有到毕业再 PCS 卖」=接 92.6% 纯互割全程阴跌；曲线期 token 锁仓不可转（`pullFor` 仅锁仓 token）退出唯一路径=pad.sell 查 .ai；poolSell requireConfirmation 即使自动也已无意义（毕业票市场否证在先）
- **终局裁定（plan 批准）**：gang 全自动所有子空间不成立，**项目停止**。gang-live-v1 `0bf223e5` 已于 07:59 UTC 停妥（status=stopped/零持仓/试单 8 笔闭环留行）；gang 引擎/collector/GangBawTrader/单测全部留档不删（官方 `setAgentGate(false)` 关门或开放 Agent ID 代注册即可翻案复用——观察哨不建，翻案条件记录在案届时一轮 getLogs 即可确认）；four.meme/flap 主战场不受影响
- 教训：**平台接入前先算市场账**——gang 全链路技术投入（采集/虚拟/回测/BAW 半自动 live/EOA 考察）前置，而「供给量×可捕获利润×全自动可行性」三轴的市场账在第二轮才算清；技术上可行的子空间（毕业票 PCS EOA 直签）市场上限 $7-14/day 不足以支撑工程。翻案三条件（gate 关/代注册/GangRouter 加曲线 sell）任一落地时先重算市场账再谈工程

### T86 gang 创建即买半自动否证 + EOA 全自动终局判定——.ai 门不可绕（2026-10-28 用户指令「必须搞定全自动交易，否则这个事情只能停」；结论=EOA 直签路线死路，三选一待裁定）
- **创建即买实跑否证（策略侧定案）**：半自动通道（买自动/卖 App 确认）下 E2 创建即买不成立——三票实测同批对比 **0s 买入 +11.77% / +5s +2.72% / +22s -2.24%**，利润窗口 <5s 而 App 确认分钟级=结构性不成立；持仓已全部清仓（T2/T3/GFIRST 卖出闭环，HONK 粉尘跳过）。曲线票卖出**恒 PENDING_CONFIRMATION**（3/3 稳定，与金额/pad/时间窗无关；abnormalTxnHandling 无全放行档）
- **requireConfirmation 判定机制（external-sign.md 补齐）**：baw 后端风控对 calldata 知识库判定——经 GangRouter（白名单合作合约）的买=自动 BROADCASTED；pad.sell 直调=medium_risk 须确认。**GangRouter 刻意无曲线 sell 入口**（头注明示 sellFor/withdrawFor only for listed aggregators）=结构性差异绕不开
- **EOA 直签路线证据链（八条全闭合）**：①claim 落点=BAW 地址**不可选**（官方 FAQ 原文「claim tx from that wallet」——五步全在 App 内）；②soulbound **Non-transferable**+One ID per user（nobody88.ai 已绑 BAW）；③registry.register 需 Binance 后端 signer `0x457C…5882` EIP-712 签名，无公开 API；④BAW sign-message 可签任意 EIP-712 但签名者=BAW MPC key≠后端 signer 不被接受；⑤adminRegister 被官方自定性 **backdoor**（agent-id-monitor README critical 事故级）；⑥**链上全历史扫描**：registry 部署块 127950748（~2026-10-08）至 130255537 共 230 万块 **127,160 条 mint，抽样 59 笔全部 tx.from==to 零代铸形状**（工具 182 /tmp/tmp-agentid-mint-full.cjs v2：网络重试+checkpoint 续跑；v1 死于瞬时网络错静默退出教训）；⑦BAW MPC 密钥不可导出+官方 CLI 零私钥路径；⑧**Agent ID 体系横跨 Four.meme（protocol=2004）与 gang 同 registry `0x60B9…022F` 同 1B/10M 帽**=Binance 级身份层非 gang 单平台问题；issuer 豁免只救「发行者卖自己的票」不解决跟单买
- **EOA trader 设计输入已齐（.ai 打通即可开工）**：V3 买=GangRouter.v3BuyBNB 单 tx（wrap→approve→buyFor→残余 unwrap 全在一个 tx，无需预 approve）；V3 卖=直调 pad sell（approve pad，WNB 到手）；V2=WBNB approve V2 pad+buy/sell；pad Registry previewBuy/previewSell 可作 L1；NonceManager 复用+余额差法实收
- **观察点（官方放开即翻案）**：①`agentGateEnabled` 开关——`setAgentGate(bool,address) onlyOwner`（owner=48h Timelock→Safe），gate 关闭时 EOA 直调 pad 自由（router 反 revert RouterNeedsGate），可挂 setAgentGate 事件监控观察哨；②GangRouter 若未来加曲线 sell 入口且风控按「入口白名单」放行→半自动变全自动（poolSell 的 requireConfirmation 判定未实测——模拟 revert 拿不到风控字段，须真金 0.002 BNB 买毕业票实测，留用户裁定）；③毕业迁 PCS 后（rankType 30）任何 EOA 可交易但利润窗口已过
- **三选一待裁定**：a. 等官方渠道/开关（观察哨可选）；b. 二号 Binance 账号+BAW 仍半自动（不解决问题）；c. 项目停

### T85 早期叙事臂 bundle 三门放宽 +10（2026-10-28 用户直接指令「bundleClusterHoldCircPct < 35 AND top2BundleClusterHoldCircPct < 55 AND top3BundleClusterHoldCircPct < 75 改为 … < 45 … < 65 … < 85」；库 buy-early-narrative v1→v2 + create-v47，待用户确认后换车）
- **背景（T84 余留项收口）**：早期臂回放 +0.0328/119 票是**乐观上界——bundle 三门未计**（tmp-early-narrative-arm-replay 未算三门；T84 观察点①已记「实跑更严」）。三门阈值 35/55/75 原为主腿 4.7-27 全带池标定（T1/T67/T68 三案：BITCAT/AIFLY/邪恶卡皮，票池含成熟期分散盘）；早期臂 6.0-6.7 BNB 带票龄 <600s、买家基数小，集中度天然更高——原阈值对该带偏紧，放宽 +10=向回放口径（三门未计）收回偏移
- **裁定与形状**：仅早期臂（库 `buy-early-narrative` 独立条目）三门各 +10：`bundleClusterHoldCircPct < 45 / top2 < 65 / top3 < 85`；**主腿 buy-v2 v43 维持 35/55/75 不动**=两带同键分歧的天然 A/B 对照。其余门/rating 2|3/600s 窗/6.0-6.7 带/承接 0.25/4/净买 40/top1 35/copy 20/famous 15/sybil 35/flap router/崩盘双门全部不动
- **已知放行形状（诚实记录）**：三门原为 T67（AIFLY top2=57.2）/T68（邪恶卡皮 top3=77.8）两对倒案所立——新阈值 65/85 下**两案票 fire 形状均放行**（57.2<65、77.8<85；top1 门两案本就过）。邪恶卡皮在早期臂回放中即输家（-35%，被 600s 止损兜住）——放宽=接受早期带内由 600s 止损/protect20/27 上位离场兜底对倒形状，代价待实跑分布裁定
- **实现链**：`bump-buy-early-narrative-v2.cjs`（v1→v2：三子串各恰一次替换，13 兄弟门+top1/sybil `< 35` 键名区分防误伤锚定，gmgn 10.7 臂/trigger/cards 3 防呆）；`create-v47.cjs`（克隆 v46 `6581c288`，唯一变量=买腿[1] condition ← 库 v2 copy-in，libraryRefs buy-early-narrative 1→2；库/实验 gmgn+trigger 逐字一致+「v2 条件=源条件仅三门段差异」防漂移断言）。**copy-in 红线**：v46 在跑持 v1 快照，生效须停 v46→建 v47→启 v47 同批（重启前持仓确认卡账本净额口径）
- 单测：无新机制（纯条件串阈值变更，FA 因子与评估器既有形状）；防线=脚本断言+三防线未知因子检查不涉新键
- **观察点**：①放宽后早期臂触发率 vs 回放 ~6%（三门收紧差收窄）；②三门放行的对倒形状亏损频次（-35% 级止损兜底出现率）；③主腿 35/55/75 对照臂分歧（同键异阈的自然实验）

### T84 早期叙事臂 + 市值量纲全局 BNB 切换 + entryMarketCap 入场锚（2026-10-28 用户三裁定「可以按照你的方案试试，把这个买入策略加上……两个买入策略，一共 6 张卡，每次买入 3 张卡。卖腿按照你的思路调整……市值都是用的美金……建议全部换成 BNB 市值」；库 buy-v2 v43 + buy-early-narrative v1 + create-v46，待 virtual 验证后换车）
- **回放依据（scripts/tmp-early-narrative-arm-replay.cjs，182 跑 8 天 2599 叙事通过票）**：v3 矩阵最优 g3-hiBand×e1=市值带收窄 4500-5000 USD（BNB 域 6.0-6.7）+ 时间止损 600s → 119 票净 +0.0328 BNB、胜率 18%、+13.8%/票（v2 的 +7.5% 翻倍；九天全正；对照同期 live 实际成交 -0.0285）。门验证两结论：**可松承接量门**（0.25/4→0.10/2 零增益零损失=门本不构成约束）、**不可松净买质量门**（40→25 有害，放进来的是卖压票）。4000-4500 USD 死亡带（46 张非断流票仅 1 赢家）→ 带收窄至 4500-5000；断流死亡票占全池亏损 38%（hc90 折价敏感性≈无损）；stop600>stop900、mcapExit 2 万优于 4 万。买入窗口真实且快：passAt→fire p50=24s（C84 不变量「发起门量级<买门量级」保证分析先于主腿可满足，中间即窗口）
- **市值量纲切换（甲）**：FA `marketCap`/`fdv`/`peakMarketCapSinceLastBuy` 三键 USD 域（×lastImpliedBnbUsd）→ BNB 域（priceBnb×totalSupply）——BNB 价 731-745 波动使 USD 阈值漂移 ±2%；观察信号默认阈值 12000→16。**附带收益**：price_usd 缺失/为 0 时 USD 域恒 0/死臂，新域免疫（单测 B 段反证）。阈值换算（bnbUsd≈745）：buy-v2 带 3500/20000→4.7/27；T82 gmgn 豁免臂 8000→10.7；P4 清仓带 3500-4000→4.7-5.4；<3500 地板→4.7；T80 三档 6000/10000/20000→8.1/13.4/27；T79 地板 5500→7.4；观察信号 v44 显式 20000→27。**上线红线**：旧 USD 数字配新 BNB 域因子=市值门恒死，库条目/实验快照/进程代码必须同批
- **entryMarketCap 入场锚（乙，零新引擎机制——全落 FA setBuyState 生命周期）**：首买 fire 价口径市值（anchorBnb×totalSupply，BNB 域）记入 pos；**补买不覆盖**（臂身份=首买锚定，clearBuyState 全清重置）；锚/总量缺失→null fail-closed（豁免臂 `>=X` 恒 false=原腿照管、专属臂 `<X` 恒 false=不触发，两侧退回现行卖腿保护）；重启恢复继承 buyPriceBnb「重启后首价近似」语义；`getHolderFactors` 同源输出+FactorBuilder 快照白名单透传+getFactorKeys 探针自动收键（未知因子三防线自动认得）
- **卖腿适配（丙，v46=18→21 腿）**：T79 地板（10s 冻结）与流动性衰竭腿（120s+buyVolumeBnb<2）对早期仓=买完就卖 → 两腿加 `AND (entryMarketCap >= 7.4 OR realHoldDuration > 1800)`（1800s 后地板回归兜底）；P4 清仓带（4.7-5.4）与 <4.7 地板**刻意不豁免**=深度坠落保护。新增三条早期臂专属腿（`entryMarketCap < 7.4` 域限定）：27 上位离场（mcap_exit 全清）/ protect20（曾 +20% 回落≤0 全清）/ 600s 止损（10min 无利润全清）
- **6 卡制（丁）**：主腿 buy-v2 cards 4→3 + 早期臂 cards 3（两腿共 6 卡、每腿每次买 3 卡=0.006 BNB/腿 fire；回放口径 0.002/票，仓位 3 倍化后滑点冲击待 virtual 观察点）
- 单测：`_test_mcap_bnb_domain.cjs` 14 断言（精确公式/price_usd 扰动恒等/bnbUsd=0 免疫反证/fdv 镜像/峰值 BNB 域/源码禁 bnbUsd 乘子防复活）+ `_test_entry_market_cap.cjs` 28 断言（首买锚/补买不覆盖双向/全清重置/null fail-closed/T79 豁免 7 臂真值表/专属腿 10 臂真值表/快照透传）；观察信号缺省断言 12000→16 同步；setBuyChange 相关存量 6 件零回归
- **部署序（copy-in 红线）**：182 pull → bump-buy-v2-v42（T82 臂）→ bump-buy-v2-v43（BNB+cards3）→ create-buy-early-narrative-v1 → create-v46（克隆 v44 重建买腿+卖腿换算+obs 27）→ create-v46-virtual 验证轮（run-engine 直跑）→ 人工核对后停 v44 启 v46（重启前持仓确认）。**v44 在跑进程持旧代码+旧 USD 快照=自洽，窗口期不得单独重启 v44**
- **观察点**：①早期臂实跑触发率（回放 6%≈15 票/天；bundle 三门回放未计=实跑更严）；②0.006 BNB 单腿 fire 的滑点；③entryMarketCap 重启近似对豁免臂的漂移（重启后首价≠首买价）；④null 锚仓退通用腿的分布；⑤mid 评级占比（回放 9 票 +0.0008 无贡献不推翻用户裁定）
- **【撤臂】2026-10-29 用户指令整腿删除（「触发太少了，没有啥用」；随 v64 同批生效，库 buy-early-narrative v10 条目留档可复挂，refs/腿 3→2、P2 通道关闭）**：撤前实跑核查（v46 起 1.3 天，P2 归属=strategy_signals `metadata.strategyName='买入策略 P2'`；BNB 口径 buy→input_amount/sell→output_amount）：**27 信号/24 成交 round，净 -0.0289 BNB、胜率 3/24=12.5%**——唯一像样赢单 0x4a4417ad…7777 +0.0045（T105 对拍同款赢单，ExSniper 门亦不拦），死仓 -0.006 ×3（0xac1a6fc5/0x3b942497/0x80b81993）。观察点①（回放 6%≈15 票/天）实跑远低于回放且净亏=触发少且亏，撤得有数据支撑；②滑点/③锚漂移/⑤mid 占比随撤臂终结；④通用腿退路=卖腿族照常兜底。早期带（mcap 6.0-6.7）票此后唯一通道=P1·首买腿（4.7-27 带覆盖）。
### T83 gang live 通道全链打通——GangBawTrader 半自动 + trailing -5% 卖腿（2026-10-28 用户裁定「直接使用 trailing -5%（30min 超时），直接实盘……Trader 使用 Gang 特有的，WSS 只订阅 Gang 相关的事件」）
- **卖腿数据定论（裁定依据）**：72h getLogs /378 WNB 票/0.002 BNB 同批对拍——E2 trailing -5%@30min **+22.27%**（胜率 89.2%、中位 +16.94%）vs 固定 5min +13.58% vs 固定止盈 +20% +12.89%；回撤挡单调递增（-5>-10>-15>-20>-30，无「震出后二次冲高」形状）；30min 超时≈6h（22.27 vs 22.15）。机理=gang 出生冲量市场（到峰中位 12s、峰值中位 ×1.30、峰后长尾阴跌不回头），trailing 出场点=峰值×0.95 远优于 5min 时点价
- **通道架构**：trader=`GangBawTrader`（不 extends BaseTrader——签名链全在官方 gang CLI+Binance App 侧）：两段式 preview→requestId→execute；买全自动 BROADCASTED（V2 `gang buy --bnb` 分步 wrap-bnb→approve-quote / V3 `gang v3 buy --amount` 直付）；卖恒 medium_risk→PENDING_CONFIRMATION→Telegram 告警+轮询 `baw wallet tx-history`（300s 上限，超时告警「勿再确认旧单」防迟到确认双卖）。**防双买/双卖状态机**：execute 状态未知/回执超时→`_unresolved` 锁同 token 拒绝后续（绝不自动重发，`_syncHoldings` 余额差对账接盘链上事实）；reverted=终态确定解锁；expired requestId 重跑 preview 恰一次；单飞行队列串行（BAW 外部状态机）。卖出到账 **WNB（WBNB ERC20）非 native BNB**——实收=WNB balanceOf 差（gas 从 native 扣不混入，比 EOA 余额差法少一步补偿）
- **引擎接线**：BAW 第三形态钱包（address-only 无 privateKey，仅 gang 放行）；`_liveTraderTypeFor('gang')='gang'`；preflightReject 分流（V2 1% 帽 `expectRefund≠0` 拒单不计买入熔断——非 token 买不进是金额形状问题）；**毕业票不路由 PCS**（BAW 无 EOA 签名链，`_ensurePcsTrader` 读 privateKey 必炸）——`_graduatedManualIntercept` 钩子三处拦截（自动卖/手工卖/上游 graduatedManual 分流不计卖熔断+长冷却 30min 告警去重）；web 三防线解除+BAW 第四源（address-only 仅 gang 放行）+liveDefaults 查表 gangWs
- **策略库条目**（deploy-gang-live-strategies.cjs，182 跑 --commit）：`gang-genesis-buy`（`currentPrice > 0 AND tokenAgeSec < 60`，裸条件腿=叙事链路整机零激活——buy-v2 的 narrativeRating 腿对 gang 恒 miss 永不买；maxExecutions=1、cards=1 × perCardBNB=0.002 试单额度）+ `gang-trail-exit`（`drawdownFromHighestSinceLastBuy <= -5 OR holdDuration >= 1800`，cards='all' 全清；**bypassDebounce=true**：gang 曲线价=纯函数（Q=Q0+dw4）无 tick=价格真冻结，等 tick 确认无意义+App 确认是分钟级人在环，与现行「卖腿 bypass=false」裁定的 AMM 快照失真语境刻意不同）；实验级 stopLoss {priceStopPercent:-50, scanIntervalSec:30} 断流兜底
- 单测：`_test_gang_baw_trader.cjs` 47 断言（防双买反证=状态未知后零新 CLI 调用+序列锁定）+ `_test_gang_live_wiring.cjs` 25 断言（毕业拦截行为级 throw 桩=绝不调 _ensurePcsTrader）+ `_test_gang_architecture.cjs` E 项反转 33 断言；受影响存量单测 6 件零破坏
- **观察点（首日）**：PENDING→confirmed 确认延迟分布；CLI 失败率；devMode 续期（`baw wallet settings` 日检）；1% 帽命中（0.002 不应触）；首笔买卖闭环 txHash+`_syncHoldings` 对账 diff；确认超时后旧单滞留 App 双卖风险；trailing 实盘 vs 模拟对拍

### T82 GMGN bundler 门 mcap 早期豁免臂——分母个位数段 ratio 是采样噪声（0xa44e…7777 案，2026-10-28 用户裁定「如果价格小于 8K 就豁免一下这个条件」；库 buy-v2 v42 + create-v45，待 v45 上线生效）
- **案发路径**：v44 `5be4c248` signals 页 0xa44ef3ea…7777（event:E）`gmgnBundlerWalletRatio` 出现 **>100 值**（111.1/166.7）。归因：ratio=`bundler_wallets/top_wallets×100` 直出 GMGN `wallet_tags_stat`（`risk-fields.js` 提取→`mapGmgnRiskFactors` 映射），**分子分母不是子集/全集关系**——GMGN 不保证 bundler≤top；39 个 BUY 信号值序列 58.8→66.7→71.4→90.9→100→111.1→166.7 反推全为小整数分数（10/17→2/3→5/7→10/11→n/n→10/9→**5/3**），分母个位数到十几=超早期标签统计窗口极小，一两个标签变动即 ±30pp 跳变。**超早期读数=采样噪声的机制化承认**：同盘 3min 内 58.8→166.7 剧变本身证明该窗口的值无判定力（首评 58.8 恰过门买入 -22%，40s 后 66.7 起锁死=两读数都只是噪声抽样）
- **裁定与形状**：市值 <8000 USD（严格小于）时豁免 bundler 门——`(marketCap < 8000 OR gmgnBundlerWalletRatio <= 65) AND (原 narrativeCategory/issuer 分档门不动)`。**豁免只盖 bundler 门**：serial issuer 分档门与市值无关不被牵连放行（mcap<8K + project + issuer=6 仍拒，单测锁定）。marketCap=FA fire 因子表 USD 市值（观察信号同源键），引擎经 buyContext 第三键透传（T76 buyContext 加键，与 buyWallets/buyVolumeBnb 共存互不污染）、回测 context 直并同刻同源（重放=fire 时刻真值无穿越）；**null=市值证据缺失不豁免**（豁免门保守方向——ConditionEvaluator 对 null 比较恒 false 天然落地，与 famous/sybil 拦截门「名单缺失恒 0 放行」刻意相反）；covered=0 fail-open 放行语义不变（API 不可用优先于一切门）
- **实现链**：`GmgnRiskCheckService` 键集+`marketCap`（27→28 键，loadStrategies/validateLegs 三防线自动认得）+checkAndEvaluate buyContext.marketCap 并入（`typeof number` 才收，旧形状不带键=null 照拒）；引擎/回测双向透传挂点各一处；库 `bump-buy-v2-v42.cjs`（唯一变量=gmgn 串整串替换，fire/trigger/兄弟门防呆锚定）；实验 `create-v45.cjs`（克隆 v44 5be4c248，唯一变量=gmgn 串←库 v42 copy-in，libraryRefs 41→42）。（2026-10-28 注：create-v45.cjs 已删——T84 v43/v46 以 10.7 BNB 形状吸收该豁免臂实跑，v45 编号未使用，库 v42 行留档）
- 单测：`_test_gmgn_check_layer.cjs` G 段 15 断言（7500 放/7999.9 放/**8000 恰好拒**（严格 <）/9000 拒/null 不豁免/project+issuer=6 仍拒/58.8 与 166.7 在 <8K 段等价放行=案发现场反证/covered=0 fail-open 不变/checkAndEvaluate 透传三形状/T76 注意力键共存/存量条件串零影响/键集/源码口径双向）78/0；`_test_gmgn_wallet_stats_layer.cjs` A3 键计数 27→28 同步 19/0
- **观察点**：豁免放行票的 bundler 真值分布（≥8K 后是否被原门接住）；与早期叙事臂（mcap 3500-5000）叠加的进场前置量变化

### T78 evenCluster amountKey 四位舍入——历史回放反证 6 位严格键对案票恒 0（2026-10-27，用户裁定「增加的特征，可以利用历史数据算一下值」直接救回 T74 键）
- **案发路径**：T76 观察键回放（`scripts/replay-observation-factors.cjs`，182 全量 28230 BUY 信号/6686 token）核对 T74 案票 `0x8c4aa42debd1b1015af12945adc589c7e4ae7777`——生产键 fire 时（19:30:01.379）evenClusterHoldCircPct=**0**，台账记录 **81.6%**。取证（fire 前 25 笔买行）：25 档 distinct 金额 **11 个间隔 <0.001**（0.16471/0.16474 式刻意微差）——`toFixed(6)` 严格相等下三档簇（0.1647×6 / 0.2470×6 / 0.1314×3）**全部 size<3 不成桶=键对设计目标形状失效**；四位舍入三档全中。根因=T74 分析时用四位舍入分组、落地键却照抄 launch uniform 臂 6 位口径——**分析口径≠键口径**的失误；团伙微差金额正是对精确等额检测的规避手段，6 位键天然打不中
- **修复**：FA amountKey=`(Math.round(b*1e4)/1e4).toFixed(4)`（数值归一后定 4 位，规避浮点累加误差形状）；launch uniform 臂 6 位口径刻意不动（snipe 精确等额场景，误报率另案评估）；回放脚本同步。**若不做历史回放直接部署=死键**——观察键先回放分布的流程价值实证
- **六位口径分布先跑一轮的副产品**（回放 CSV key6 口径留档 182 `/tmp/obs-factors-key6.csv`）：evenPct>60 断崖在 6 位口径已可见（去重 925 成交票：>60 桶 15 票胜率 13% vs (40,60] 47%）；evenWallets>15 六票全亏——断崖由**精确等额**团伙贡献，微差团伙在 6 位口径落 evenPct=0 桶（口径失效偏置）；四位口径重跑分布见 T76 回放记录
- 单测：`_test_even_cluster_factors.cjs` incidentTicks 档一/档二改案票真实微差形状（A1-A3 断言值不变即 T78 反证）+ I 段四断言（微差成桶/跨档不并桶/源码防复活 `toFixed(6)` 写点不得复活/缩微现场锁三笔互异），26/0；`_test_replay_observation_factors.cjs` 12/12
- **部署注意**：代码侧 FA/脚本 hunk 被并行 T77 会话 commit 卷入 `ad06287`、I 段在 `f4575eb`；182 v41 进程重启才吃到新口径（与 T74/T76 观察键同批）

### T77 净买门滚动窗 OR 臂——MUSK2028 迟买案（2026-10-27 落地 W=10s，用户裁定先跑观察）
- **案发**：MUSK2028 `0x8f531e8ebcbad9ec2c402e112b6b22bea52f7777`（flap，live v41 `40754e0d`）叙事 23:13 rating 3 完成，fire 23:21:01（**+467s 迟买**）→ -39.8%。逐臂重放：rating 落定后其余 16 臂陆续全过、**净买门独拦全程**——开盘砸盘把全史 `tradesNetBuyRatio` 拖低（23:17 十秒窗净比已回 100%、全史 23:21 才爬回 51.5 过线=买在恢复完成的局部顶）。用户洞察定案：「大幅度下跌的那一端，成为了 netBuy 的负担，其实只要 netBuy 窗口大于阈值就可以买，这样买入就早了」
- **OR 臂设计**：`tradesNetBuyRatio >= 40` → `(tradesNetBuyRatio >= 40 OR tradesNetBuyRatioWin >= 40)`——结构上零拦截回归（全史臂保持原判），窗口臂只新增放行位。FA 两键：`tradesNetBuyRatioWin`（`netBuyWinMs` 默认 10000，factorParams 可覆盖；窗内 (Σ买−Σ卖)÷Σ买×100）+ `tradesNetBuyWinBnb`（窗买量观察键不进条件串）；**null 语义刻意分叉**：窗内零买=null 缺近期证据 fail-closed（`>=40` 恒 false），全史键无买=-100 有证据零值；复用 `_activityEvents` 事件环（求和交换律=defer 乱序回推无害；wallet 段喂食 GMGN 回推 1-3s 竞速缝隙与 famous/act\* 同款已知形状），`_pruneActivityEvents` cutoff 两窗取 max
- **W 扫描（182，177 票 8 窗 10-120s，全史重放+真卖腿模拟）**：fired 7/7 baseline 复现（priceMatch≈1）；案票 W10 23:17:07 进 +46.85 / W20 23:17:23 进 +46.51（wb 0.27/0.028）——**6/7 其余 fired 全窗 bit-identical**；blocked 170 票仅 2 张新开（币安舰队 W10 -13.88 / 国库币 W10 -22.28，均已知代价）。W15 最差选择（案票进场点 wb=0.0089 微买 100% 假信号形状）；0.05 地板伤 W20 案票（wb=0.0278）不伤 W10（0.27）——**最终不设地板**（null 语义天然 fail-closed，最简）
- **国库币 `0xf8fd797df01ec05383ef48e720f2e6c2b6ac7777` 新开亏损剖析（收紧观察点）**：前 20s 买 31.9/卖 26.2 BNB、开盘 3s 内三大买家全净卖（0x16b1 买 3.33/+3s 卖 4.33 等）、全史净比峰值仅 18.4% 从未接近 40——**从第一秒起的对倒放量**，非「先砸后回」；W10 臂放进的是对倒流里滚动窗恰为正的反弹瞬间（进场后 40-80s 两桶连续净卖、价腰斩、-35 止损）——**窗口臂对「对倒放量中的短暂正净流」无区分度**，后续收紧候选（窗口×全史双确认类）待观察期数据
- **W 裁定**：20（直觉）→ W10/W20 数据分不开（案票差 0.34pp、三票合计差为噪声）→ 用户终裁 W10「先跑一段时间看看」
- 单测：`_test_netbuy_window_factors.cjs` 27/0（公式/边界/乱序回推对拍/null vs 全史 -100 分叉/防前视 asOf/裁剪两窗 max/参数覆盖/探针/FactorBuilder 透传/源码口径+OR 臂真值表三态）；`_test_fourmeme_fa_factors.cjs` 键集 46→48；`_test_activity_window_factors.cjs` H2 断言随裁剪 max 形状更新（43/0）
- 部署（已收口 2026-10-27）：库 buy-v2 v41（乐观并发 40→41，validateLegs 预检过）；live v42 `99c106e8`（06:29 UTC PID 628434）实跑；观察期盯窗口臂独立放行的票（metadata 有 tradesNetBuyWinBnb 审计）

### T76 注意力空转观测键四键 + GMGN 零区分度观测键清理（2026-10-27，用户裁定；阈值待分布另议）
- **背景（gmgnVisitingCount 全量调查）**：起于用户问「近期的买入是不是都记录下 visiting count 了？这个变量能看出什么规律不？」——182 上 10-24 起 **184 条 BUY 信号**全量回读：①覆盖 **184/184 covered=1**（唯一 covered=0 行=BNC 13:54:43 GMGN 超时 fail-open 放行→-43.5%，即 T73 案现场那笔，逐秒对上台账）②vc 本质=**GMGN 滚动窗口非累计值**（BNC 3 分钟内 10→36 后回落 9），fromCache 102/184（TTL 5s 命中即同值）③盈亏三桶（vc 低/中/高）胜率 33%/36%/22% **无单调**——vc 单独不构成门④对倒票 0x8c4a（T74 案）vc=11：链上流量大而外部注意力低，比值有信号但太新/索引延迟期失真
- **裁定（用户 2026-10-27 三条）**：①「错位信号」（链上流量大/外部注意力低的反向比值）**不做**——「我同意你的观点“错位信号”比较不好」（GMGN 索引延迟+票太新页面无人看，时机敏感）②**新增注意力空转因子**：「VC 高但买入者少（获得了注意力但没有吸引力）」+「或者说 VC 高买入量小」——**钱包宽度与 BNB 深度两条口径都要**③**GMGN 零区分度观测键清理**：「如果 GMGN 其它观测键的区分度极低，可以把因子去掉节约资源」——whaleWallets/creatorCreatedCount 47 票全零
- **实现（观察键不进条件串，T74 同纪律）**：
  - FA 新键 `buyWallets`（独立买入钱包数=K 组 `_buyerAddresses` 全史 Set size——曾买入即计入、清仓不回退，与 holders 分母分离；复用既有原料零新增维护；与 buyVolumeBnb 同刻同源；FactorBuilder 快照白名单透传）
  - GMGN 层四键：`gmgnBuyWallets`/`gmgnBuyVolumeBnb`（原料透传）+ `gmgnVisitorsPerBuyer`（vc÷buyWallets）/`gmgnVisitorsPerBuyBnb`（vc÷buyVolumeBnb）——`GmgnRiskCheckService.computeGmgnAttentionFactors` 静态纯函数单一真相源；实时=checkAndEvaluate **第六参 buyContext**（引擎 fire 因子表传入、不占第五参位=存量零影响）；回测=BacktestEngine 组装点 spread 同一函数（快照 vc 是 token 级常量=已知时序穿越，同 narrativeRating 常量注入声明；buyWallets/buyVolumeBnb 回测 FA 同源无穿越）
  - 零值语义（famous 0 语义裁定同向）：buyWallets=0 且 vc>0 → 比值取 vc（零买家全额空转上限形状，**有数不 null**——null 使 `<=N` 门恒 false 误拦）；vc=0 → 0（正常新票恒放行）；covered≠1 → 比值 0 不合成（fail-open 形状一致）；round1 保留 1 位小数。合成键写进 `{...factors}` 拷贝**不污染 TTL 缓存共享对象**（下次命中不带陈旧比值）
  - 键集：GMGN_CONDITION_FACTOR_KEYS 扩四键（23→27，条件可引用；观察期不部署条件串）
  - whale/creator 清理三断面：`risk-fields.js` 提取删（hasAny 判定自然收窄；narrative 侧 grep 无消费）/`mapGmgnRiskFactors` 映射删（renowned/smart 保留）/_noDataResult 删；**同一次 API 响应字段，删除不省配额**——省映射与审计体积；历史快照行含旧键被忽略（防复活反证=「键:」定义形状正则）
- 单测：`_test_gmgn_attention_ratio.cjs` 21/0（A 纯函数真值表 8：各零值/零买家上限/round1/covered 门；B 第六参集成 4：透传合成/缺省不并键/缓存不污染/fail-open；C FA buyWallets 5：计数/复买幂等/清仓不回退对照 holders/null wallet/defer 两阶段 parity；D 键集+ConditionEvaluator+FactorBuilder 4；E 源码口径 4 含 whale/creator 三文件防复活）；`_test_gmgn_risk_factors.cjs` 21/0 翻新（OBS0 删两键/猪五花输入带旧字段被忽略+防复活断言）；`_test_fourmeme_fa_factors.cjs` 键集 45→46；`_test_gmgn_wallet_stats_layer.cjs` A3 键集 23→27+C2 第五参恒 null 形状同步（19/0）
- 遗留：①阈值=v22-v40 fire 票池回放分布裁定（含 buyWallets 与两比值键）②182 v41 进程重启才吃到新键（与 T74 观察键同批重启）③vc 滚动窗口语义：fire 时刻读数=近期窗口非累计，门设计若用须记此口径

### T74 等额买簇三观察键——0x8c4a…7777 对倒案（2026-10-27 落观察键，用户裁定；阈值待分布另议）
- **案**：0x8c4aa42debd1b1015af12945adc589c7e4ae7777（four.meme，10-26 19:29:31 UTC 创建，live v41 40754e0d）——19:30:01.378 fire 买 4 张卡、19:30:51 清仓 **-46.1%**（9.59e-9→5.17e-9）。fire 窗（30s）30 钱包 **28 个双向操作（两栖 93%）**、两栖钱包买入占总买入 **92.1%**；等额档簇 0.1647×6 / 0.2470×6 / 0.1314×3 / 0.1643×3 / 0.1232×2 成批同秒进出
- **节奏化绕门实证**：fire 前最后 10s 连续 7 笔买入 0 卖出，把全史 `tradesNetBuyRatio` 推到 **40.73** 恰过 40 门；fire 后 0.8s 起簇钱包集中出货（19:30:02–19:30:55），全窗终值净买仅 3.1%——「先买后卖」节奏对协同簇无免疫力。**五门全部擦线放行**：bundle 32.4/35、top2 52.1/55、top3 69.7/75、sybil 23.4/35、netBuy 40.73/40——对准门刻度打的形状（sybil 名单 T72 版只盖 8/30，22 新钱包不在册）
- **反事实**：等额买簇（≥3 钱包同额）并集持仓 fire 时 **81.6%**（≥2 口径 89.4%）——bundle 门按块/时间聚合对「每块 2-3 钱包、跨 5 块 5 档金额」分批形状结构性稀释，金额指纹跨块一把聚合；且证据在**买入当刻**可见，不受延迟卖出掩护（两栖判据 fire 时仅 39% vs 事后 92%——「看卖出行为」判据被时间差打对折，本键无此软肋）
- **裁定（用户 2026-10-27）**：落 **观察键不进条件串**，票池分布出来再议门（22 钱包补 sybil 名单另议）
- **实现**：FA 三键 `evenClusterHoldCircPct`（合格桶钱包**并集去重**当前正净持仓 ÷ `_circTokens` ×100）/ `evenClusterWallets`（并集钱包数）/ `evenClusterGroups`（合格桶数）；合格桶=size≥3 金额桶（<3=常见巧合，launch 等额臂同款裁定）；原料 `state._evenBuyBuckets`（amountKey=`bnb.toFixed(6)`；尘门 `earlyUniformDustBnb` 0.01 以下不入，launch 臂同款参数；全史不裁不进 `_pruneBundleEvents`，Set.add 幂等 defer 乱序收敛）；写点 `_applyWalletAggregation`（wallet 段=sender 真值，GMGN 路由行不假聚合）；读点 `_bundleClusterFactors` 纯函数；FactorBuilder 快照白名单三键透传（不落库即丢）；回测同构（processTick 同管线）；0=无合格桶/流通≤0 有证据零值
- 单测：`_test_even_cluster_factors.cjs` 22/0（A 事故缩微反证 even 74.3 ≫ top3 44.6 ≫ 单块 14.9 语义分离度／并集去重（桶相加错口径虚超 111%）／清仓不计分子但 wallets/groups 照计／尘门／逆序+defer 两阶段 parity／源码口径断言：写点体内禁 Date.now、桶不进 prune、白名单三键）；`_test_fourmeme_fa_factors.cjs` 键集白名单 42→45
- 遗留：①阈值=v22-v40 fire 票池回放分布后裁定（回测同构可直接跑）②launch 等额臂（流量口径+出生窗冻结）与本案存量全史口径正交互补不重复③「全簇延迟卖出」形状（fire 前零卖出）本键仍可见（等额买入指纹即证据）；纯手动不同额分仓不在射程

### T73 event:W 撤出 GMGN issuer 分档门适用集——BNC开市钟案（2026-10-26，用户裁定；buy-v2 v40）
- **案**：0xd0b89e79167a375e93d614ee23357b8039fc777（BNC开市钟🔔，four.meme，10-26 13:50 UTC，live v40）——即 C242 新事件豁免对拍票（BNC 撞 BNB Standard 蓝筹、语料=敲纳斯达克钟）。叙事 high 75.58（rating 3）全链过门，13:50:46→13:54:42 连续 **28 次 BUY 信号全被 GMGN 条件拦**：`narrativeCategory='event:W'` 落 C85 分档门适用集 → 要求 `gmgnIssuerTokenCount <= 1`，GMGN 真调成功返回 issuer **25 连发**（bundler=0 过臂、含 5s TTL 缓存命中同数据）→ 拦 4 分钟；13:54:43 那次 GMGN **超时 5000ms → fail-open 放行**（T14 裁定设计行为，evaluated=false 留痕）买入 0.004 BNB，14:02:15 全清 0.00226 BNB **-43.5%**
- **裁定（用户 2026-10-26）**：「event:W 本质跟其它类一样，都是基于事件/传播的 meme 币，叙事往往由第三方推文陈述，肯定不要求 gmgnIssuerTokenCount <= 1」——**event:W 撤出适用集**，剩余 `{project, account_based_meme, web3_native_ip_early}`。C85 当时把 event:W 收进适用集的映射（2026-10-17 原话「由其它用户自己发币（meme）了，也算适用」→标准路径前缀值）废止；与 C85 否决史②「事件源账号被多方蹭发多币是常态」同精神；T70 曾把该臂记为智子票残余风险（「实调时 creator serial>1 会拦」），本案实证咬人
- **连带发现（BNC 分类错误，叙事侧）**：event_category choice=W conf 0.86（W 0.88/D 0.10/E 0.02）——但 **v40 进程 08:50 UTC 起跑锁定 J1.135**，C241 的 W 域收窄锚（J1.138：W=发布新项目、成熟平台公告/市场动作归 D、第三方抢注不进 W 数学）不在实验进程题集（引擎叙事直调进程内嵌、不消费 worker——当天 worker 已迭代至 J1.141/142）。按 J1.138 判据 BNC（第三方票 + BNB Standard 敲纳斯达克开市钟=成熟平台市场动作）应归 **D** 不进 W 数学。顺带实验进程的 J1.135 分析覆盖了 token_narrative 全局缓存行（C242 对拍写的 J1.139 行被冲掉）。→ 换代实验拉最新代码解决；v41 起跑后 BNC 定向重析验证归 D，J1.138+ 下仍 W 再立叙事侧新案补「上市敲钟/成熟项目里程碑动作→D」锚
- **实现**：库 buy-v2 升 **v40**（gmgnCheckCondition 撤 `AND narrativeCategory != 'event:W'`，bundler 65/IS NULL 臂/其余不动）；实验 v41 config 内嵌同款；单测 `_test_gmgn_check_layer.cjs` 真值表翻新：`event:W+issuer=3 → 放`（T73 反证，防未来把 event:W 加回 != 链）、noNullArm 反证形状同步撤臂（59/0）
- **部署（补记，2026-10-26 完成）**：v40 14:55 UTC 优雅停（stop 顺序 eventWriter→senderResolver→collectors ✓，ticksBuffered==ticksWritten 2688/2688、45908/45908 零丢行，卡账本零持仓 ✓）；**v41 `40754e0d-ef67-4c8a-99df-78c4374ecb37`**（`v41-实盘-both-eventW撤适用集-1026`，both/live）15:00 UTC 182 起跑 PID 108161，18 策略零拒启、双 collector、sybil 1228 实载；代码 9157817（v41 进程锁定 J1.142=C244 题集）。叙事侧后续：BNC 在 J1.142 重析仍 W（锚缺口坐实）→ **C245/J1.143 里程碑划界锚**（既有项目上市敲钟类动作归 D；970f698 部署 worker 113686，对拍 BNC W→D high 92.89、W 四对照零翻转——详档叙事台账 C245）；v41 下次换代拉 J1.143

### T72 sybil 名单扩判据——0x2fe5 flap 团伙案：二档强边+分发号通道+manual 锚定（2026-10-26，用户裁定）
- **案**：0x2fe5328cf2ea8cd632161564464c1e6c2e347777（flap，10-26 06:12 UTC）用户盘感「前期参与者不像真实用户」——证实为 **377 票规模作业团伙**常规作业：开盘 90s 离散等额档簇（0.0987×9 / 0.1973×8，显化之歌 9-28 案同款档位制）+同块对倒（+3s 同块等额 0.2488×2→同块卖）+**+96s 场外分发货批**（8 钱包零买入纯卖同一秒进场）+同块 10 钱包齐出（blk 129847718）；GMGN 路由占买 53.3%、top1 买入占比仅 2.6%（分仓绕单钱包集中度门）；峰值 +213% 后 -54%。**flap 代币尾号 7777=平台常态非 vanity 指纹**（四.meme 语境才成立，本案修正）
- **跨票铁证**：纯卖批 9 钱包 10-06 21:53 同批出生、39/40 团伙票必到；0xefb1dc×0x24a57c 586 票镜像共现（co=192 even=192 满级）；0x7154c0…2022 分发号 **2686 票零买入纯卖**；钱包分批滚动养号（10-06/10-16/10-17/10-20 批）
- **名单漏网三根因**（10-25 版 570 钱包名单 vs 本团伙）：①**co≥50 物理盲区**——新批次总票数没刷够 50，比例指纹再强（三胞胎批 co=33-35、同步卖/等额 0.85-0.91）也进不了一档；②**size=2 镜像对被 minSize=3 剪**——0xefb1dc 对 co=192 满级强边照漏（FLY 形态假定主名单覆盖不成立于本案）；③**分发号 pair 域结构性隐身**——scan pair 只统计首买滑窗，零买入钱包在 pairs 里不存在（0x7154c0 2686 票查无 pair 的真因）
- **裁定（用户）**：①重扫 pair 缓存重建名单 ②加第二档强边 co≥20 且 同步卖/等额≥0.85（补根因①；0.85 收紧防误咬真跟单——leader-follower 的 even/sellSync 比例天然高，低比例档全靠 co≥50 兜底）+分发号通道 buys==0 且 sells>0 且 tokens≥50（补根因③；真实用户零买入纯卖 50+ 票不可能）③manual 人工锚定 3 对镜像钱包（补根因②，`config/rosters/sybil-clusters-manual.json`，famous 同款惯例用户裁定增删，build --commit 不覆盖，FA loader 合并）——「谨慎一些防止误伤」：manual 只收铁指纹（pair 满级镜像对+本票同块对倒实证），扩展候选 190 个跨票钱包**刻意不收**（内含 ANCHOR 真跟车大户 0xbf004b 等，单维共现误伤）
- **实现**：scan `dumpPairs` 增 `meta.wallets`（per 钱包 tokens/buys/sells，active 域）；build 重构抽纯函数 `buildClustersFromPairs`（一二档边+连通分量+分发号，CLI `--tier2-co/--tier2-ratio/--dist-tokens` 参数化）；产物 json params/clusters/distributors 审计；FA `loadSybilClusters` 合并 manual（缺文件 ENOENT 静默=无锚定常态，schema 错 fail-loud）
- 单测：`_test_sybil_build_clusters.cjs` 22/0（真值表全打桩自 182 实测 pair 值：乌龟批/三胞胎二档/0xd5155c 0.846 边界外/镜像对 size=2/分发号三断言/老缓存兼容/参数化）；`_test_sybil_cluster_factor.cjs` 31/0（D2b manual 并入、F6 判据锁扩档）
- **部署（2026-10-26 完成并生效）**：182 重扫 pair 缓存（923 万行全表→14 天窗 252 万行，76.4 万 pair+wallets 段 24079 个，8 分钟）→ build --commit → **238 簇+95 分发号/1222 钱包**（旧 155 簇/570）push（95debb7）；182 单测 31+22 全绿。探针全命中：乌龟四钱包（簇 #95）/纯卖批 9/9（簇 #6）/0x7154c0 分发号；镜像对 4/4 仍不进=manual 兜底生效。**v40 已重启生效（11:35 UTC PID 4189609，用户裁定）**：停机零持仓（0 trades）零丢行；FA loader 启动日志实载 **sybil 1228 = 主名单 1222 + manual 6**；18 策略装载零拒启/双 collector 订阅确认/DB running/0 ERROR
- 遗留观察：①0xd5155c×0x00c60c（co=26 比例 0.846）差 0.4pp 在二档外——重扫后 co/比例会动，连续漏网再议 tier2Ratio 0.8（F1 参数化已备）②**名单∩主名单重叠 230 个（旧版 215）既有形状**：sybil 一档判据从 10-25 起就与 copy-wallet-roster 大面积重叠（同钱包双口径计入：copyWallet 单钱包+syb 合计+人气双扣）——T66 删门反演带着 215 重叠验证过门价值，非 T72 引入的回归；ANCHOR 0xbf004b×0xd6ab395c co=434 even=1.00 满级镜像连入 syb 名单=同形状。**「排除主名单成员」=改一档既有口径**（215 旧成员掉出，门行为大变）——未擅动，须用户裁定+回放验证后再议（排除后 union 1222→937，团伙票探针不受影响）

### T71 earlyTrades\* 族整族删除——冻结窗无消费者（2026-10-26，用户裁定；T70 换载体次日收尾）
- 裁定：用户指令「earlyTrades 的系列因子可以删除」——T70 已把净买/路由门换 `tradesNetBuyRatio`/`tradesRouterPct` 全史实时载体，FA 出生锚 90s 冻结窗 10 键（PerWallet/MaxWalletTrades/NetBuyRatio/Top1BuySharePct/Top1BuyBnb/BuyBnb/RouterPct/UniformBuyCluster{Ratio,Wallets,N}）无剩余消费者，整族退役。T70 的「十键保留观测对照」维持一日即翻案
- **连带作废：C89 GMGN 钱包画像层数据口**——`FA.getEarlyTopBuyers`（early 窗 top-N 买家）随族删除，引擎接线整链删（ctor service 构造/`_walletProfilePrefetchCheck` 预取挂点/`_gwpConditionLegExists` 门/stop 清态/fire 补查段），`checkAndEvaluate` 第五参恒 null=存量零影响形状。纯函数层保留：`GmgnWalletStatsService`（可被任意钱包榜调用）、`gmgn_wallet_profiles` 表、离线建库脚本、单测——将来重启 gwp 层须换**全史**数据源重新接线（Phase 1 观察模式未上线即随本批搁置）
- **刻意保留（launch\* 复用面）**：`earlyUniformDustBnb`(0.01) 尘埃门与 5000 钱包帽——launch uniform 等额臂唯一消费者，常量改名 `_LAUNCH_MAX_WALLETS`（语义=launch 首买 map 帽）；launch\* 独立窗宽不受本批影响。legacy preBuy 宿主（`EarlyParticipantCheckService` DB trailing 90s 窗+FactorBuilder :213 起观测键+router-gate-state+BacktestEngine preBuyResult 透传）独立存续不删——旧腿语境仍可用
- 删除面（FA）：processTick early trader 段 / applyWalletTick early wallet 段 / state `_early*` 14 字段 / `_earlyWindowAdvance`+`_earlyTradesFactors` 两函数 / `_buildFactorMap` 10 键发射 / `getEarlyTopBuyers` / PROTOCOL_ADDRS import（FA 内唯一消费者=early top1 剔除，留墓碑）；FactorBuilder 10 键透传删（历史信号 JSONB 快照中的旧值保留展示，新快照 → null 不掩盖）
- **部署红线（fail-fast 三防线设计内）**：v39 实验 71f87b50 条件引用 `earlyTradesPerWallet`/`earlyTradesRouterPct` 已删键——拉 T71 代码后重启 loadStrategies 即拒启。切序必须同批：182 pull → **停 v39** → `bump-buy-v2-v39.cjs --commit`（第 4 替换删 ` AND earlyTradesPerWallet < 4`，防呆=替换后条件不含任何 `earlyTrades` 子串）→ `create-v40.cjs --commit` → 启 v40。跑中进程不受 pull 影响（内存已载）
- 单测：`_test_fa_early_trades_factors` **整文件重写**（主体=trades\* 两键公式/口径/trader 层/只计买腿/全史实时性/零值/探针；F 段防复活三级反证：getFactorKeys 无 earlyTrades\* 前缀键 / buildFactorMap 十键全 undefined / `getEarlyTopBuyers`·`_earlyWindowAdvance`·`_earlyTradesFactors` 无实现 / 源码墓碑外无活标识 / state 无 `_early*` 字段）21/0；`_test_fourmeme_fa_factors` 白名单 −10 键+探针防复活 35/0；`_test_gmgn_wallet_stats_layer` C 段翻接线删除反证 19/0；`_test_narrative_trigger_condition` E5 第五参恒 null 形状 47/0；launch_bundle 17/0；legacy 侧（early_per_wallet 30/router_gate_state 66/sniper 59/top1_buy_share 33/sender_switch 46/prebuy 系）全绿——legacy 宿主零扰动
- **反事实验证（`scripts/tmp-t70-two-token-replay.cjs`，182 逐 tick 重放 v39 新条件 17 门，rating 按轮次完成时刻注入=币安1986 +7.4s/智子 +10.5s，dust≥0.001）**：**两票均会买入**——智子 fire **+110s**（价格 9.40e-9/mcap 6946，净买 **54.19**、路由 55.62，最后过门=top2 门 54.9<55；旧冻结版 49.8<50 永拦）；币安1986 fire **+222s**（净买 **80.03**、路由 **51.66**、holders 32/vol 2.28，实时路由占比 +150s 上 35.45 后全门过；旧冻结版路由 0 永拦）。**GMGN 第二层不可历史重放**（无 API 快照，缺数据按 fail-open 语义放行；残余风险=智子 event:W 适用集的 issuer 分档臂实调时 creator serial>1 会拦）。40 分钟后毕业的智子=新条件下 +110s 进场的盈利票实证

### T70 全史实时净买/路由两键换载体——智子/币安1986 双案（2026-10-26，buy-v2 v39；early 90s 冻结窗对慢热票结构性失真）
- 案：v39 71f87b50 运行期两票叙事全放行（智子 mid/event:W/64.96 rating 投影正常、币安1986 high/event:E/88.84）却都没买，**拦点全在买腿因子**——
  - **智子 0x4451f373e343fb95c5121863d048597cec5b7777**（flap——token_create/ticks 双证；T70 初稿误记 four.meme，T71 反事实重放时勘误，create 04:53 UTC）：唯一拦点 `earlyTradesNetBuyRatio >= 50` 恒不满足——90s 窗终值 **49.8%**（买 3.19/卖 1.60 BNB，25 钱包真热闹票），rating 就绪后逐 tick 全程 9%→49.8% 差 0.2pp 没上穿；routerPct 44.5/perWallet 1.56/buyVolume 3.19/市值 4291 全过。**40 分钟后毕业（funds 12.59 BNB）=被净买比门拦掉的盈利票**
  - **币安1986 0xd6c7e7c95c11524c43e5d13506843fb18aed7777**（flap，create 04:18 UTC）：决定性拦点 `earlyTradesRouterPct >= 30`（flap 臂）——前 90s 仅 creator EOA 自倒 2 笔（1 买 0.299+1 卖 0.149），路由买入 0 → **冻结 0% 恒拦**；次要拦点量门（0.299<1.25 且 holders 1<10 冻结）。90-300s 散户蜂拥 **110 笔 77 钱包**也改不了冻结快照=「慢热票」结构性盲区
- 根因：earlyTrades* 族=出生锚定 90s 累计窗**冻结因子**（首个出窗 tick 后读数恒定）——设计假设「首窗定盘」，当前流动性不足市场慢热票普遍，窗后真实的散户参与/净买方向永远进不了门
- 用户三裁定（2026-10-26）：①净买比门放宽 50→**40**；②买窗改「90s **或** ticks≥25」（流动性不足市场，去掉 T63 的 600s 时间上限）；③**换实时载体**——不消费 early 冻结键，新键直接取买点时刻值
- 因子：`tradesNetBuyRatio`=(Σ买−Σ卖)÷Σ买×100（全史 BNB 额口径；纯买 100/全卖 −100/全空 0 有证据零值）/ `tradesRouterPct`=Σ(trader∈AGGREGATOR_ROUTER_ADDRS 买入 BNB)÷Σ买×100（trader 层只计买腿，口径逐字对齐 early 同名臂）。恒累计无窗无冻结——买点评估即当时真值；分子累计 `state.totalRouterBuyBnb` 写点与 early 版同走 AGGREGATOR_ROUTER_ADDRS（单一真相源）
- 部署：FA state+processTick 累计+`_buildFactorMap` 发射两键 + FactorBuilder 快照白名单透传（旧 FA/历史信号 → null 不掩盖）；库 buy-v2 v38→v39（bump-buy-v2-v39.cjs 三替换：`earlyTradesNetBuyRatio >= 50`→`tradesNetBuyRatio >= 40`、`earlyTradesRouterPct >= 30`→`tradesRouterPct >= 30`、`(tokenAgeSec < 90 OR (tradeCount >= 25 AND tokenAgeSec < 600))`→`(tokenAgeSec < 90 OR tradeCount >= 25)`；16 兄弟门锚定+gmgn/trigger 逐字不动）；live v40 克隆 v39 71f87b50 库 v39 整条 copy-in（create-v40.cjs 防呆：源=v38 快照形状含 early 两键消费+600s 帽/库 v39 含 trades* 两键/谱系逐字一致）
- 刻意保留：earlyTrades* 十键**照常产出落快照**（观测对照——同盘冻结值 vs 实时值漂移量可复盘）；`earlyTradesPerWallet < 4` 等其余 early 消费不动（用户只点名两键）；T63 慢热或臂的 ticks 阈值沿用 25
- **preFilter 影响（设计内）**：去 600s 帽后 `extractBuyRangeFromCondition` OR 侧 null 降级 → age 无上界 → preFilter 不再裁剪慢热票（T63 曾以帽为必要件保 10min 包络；本批取舍反转=慢热票覆盖优先，未持仓票逐 tick 构建 CPU 上升接受）。`_test_fa_prefilter` A14 注释随改（A14 形状=v39 线上形状）
- 单测：`_test_fa_early_trades_factors` H 段 10 断言（H2 核心反证=复刻币安1986 形状：窗内 dev 自倒 2 笔→出窗路由蜂拥 3×0.4，`tradesRouterPct` 0→80 而 `earlyTradesRouterPct` 冻结 0 不变；H4=智子 49.8 差 0.2pp 形状的解：后续 tick 继续改实时值；公式精确值/trader 层口径/只计买腿/零值形状/探针收键/G6 源码锚定）44/0；`_test_fourmeme_fa_factors` 白名单 +2 键 34/0；fa_prefilter/live_prefilter_parity/bundle/activity/backtest_tick_build_skip/strategy_library_validate_legs 全绿
- 诊断教训（本轮两踩）：wss_events 无 block_number 列（真列=block_time）、token_narrative 无 rating 列（真列=final_rating）——supabase-js error 不打印时 data null 被 `||[]` 吞成「无行」假象；查前先 select('*') limit 1 探列名+每次检查 error

### T68 top3 门 top3BundleClusterHoldCircPct < 75——第三块并集（2026-10-26，buy-v2 v38，4ef5109；当日观察键→转门）
- 动因：用户要求扩展看第三块——邪恶卡皮 0x4e7ef189e1e1a0b4c59940d13cc6110544887777（v38 e5438645 fire 2026-10-25 16:20:33，rating=2）fire 时刻 top1=28.5 / top2=53.4 **均过门**（35/55），但 top3=**77.8**——前三块买家并集囤走流通 3/4。同日对照：BLACKBELT 0x46ea…7777（v37，T67 反事实重放票）fire 时刻 top2=56.2 被 55 门拦、top3 同刻 63+。邪恶卡皮持有 4 分钟即触发卖腿（16:24:27 卖出）
- 因子：`top3BundleClusterHoldCircPct`=最大三块（持仓口径选块）买家集合**并集去重**当前正净持仓合计 ÷ 流通 ×100；不足三块退化=top2；恒 ≥ top2 ≥ top1（并集域单调扩）；三槽级联扫描（top1/2/3 维护法，级联降位）；全零块不占首槽防线与 top2 同款
- 阈值裁定：用户拍板 **75**（拦邪恶卡皮 77.8、放 74 以下）——样本 2（BLACKBELT 63+/邪恶卡皮 77.8）由用户直接裁定不再攒
- 部署：FA `_bundleClusterFactors` 三槽级联 + `_buildFactorMap` 发射 + FactorBuilder 白名单 + 快照 10 键（4ef5109 观察键批次）；库 buy-v2 v37→v38（bump-buy-v2-v38.cjs，top2 臂后恰一追加 `AND top3BundleClusterHoldCircPct < 75`，兄弟门锚定防误伤）；live v39 71f87b50-fe47-442a-8933-f22ea5d78d3d 实跑本屏（库 v38 整条 copy-in，create-v39.cjs 防呆：源 v37 快照形状/库 v38/gmgn+trigger 逐字一致；首启 2026-10-26 02:53 UTC PID 3922871 崩于 4ef5109 边角见下事故段，de5b163 修复后二启 03:19 UTC PID 3937184）。**v38 e5438645 终态**：零持仓全平后停（02:40 UTC graceful，卡账本净额 0 核查；02:40:09~02:45 插曲见下）
- 单测：`_test_bundle_cluster_factors` Q1-Q6（三块阶梯 100/复买跨块 tie 占两槽去重 83.3 非 113/退化链 单块=两块=三块/清仓块零贡献 65/65/逆序 parity/Q6 零和块抢占第三槽事故反证+源码锁守卫）+ L1 快照 10 键；`_test_fourmeme_fa_factors` 白名单 +1 键 34/0
- 校准：重放 fire tick（16:20:32.000）t1=28.5/t2=53.4 与引擎 fire 快照**逐位一致**（T8 校准锚纪律）
- **A3生活指南反事实（2026-10-26 用户问「新策略能不能拦」+「盘面感觉大多参与者不是真人」）**：0xe55177ee49cce65ec2f9ee05a45031fd3de87777（flap，rating=3，v38 实买 01:47:26 0.004 BNB → 02:06:44 P4 卖 -28%）。110 ticks 链上真序重放（尘门 0.001；⚠️mcap 链需 price_usd 而 wss_price_ticks 无此列——live collector 内存 tick 才有，重放补 price_bnb×718 由 fire 价 USD/BNB 反推）；首可买 01:47:22 ≈ 真实 fire 01:47:26 校准锚成立。**结论：v39 拦不住**——fire 时刻 top3=50.2 < 75 照买；v38 可买窗（01:47:22→01:52:22 共 10 tick）top3 min 34.6 / max 50.3 全 <75，v38/v39 可买集完全一致，top3 门对本票零拦截。「不是真人」直觉的量化印证：earlyTradesRouterPct=**64.2%**（买量近 2/3 走 GMGN 聚合路由）、b1=34.0 贴 35 门线、b2=50.2 贴 55 门线内、top1Holder=17.9、47 钱包 110 行人均 1.35 笔、sybil/famous/copy 名单全零命中（新钱包群不在任何名单）；最近的拦截位=b1/b2（收紧 1pp/5pp 即拦，代价未扫描）——未动，待用户裁定
- v38 终态插曲（已定性收案）：v38 原进程 3584931 收到 TERM 02:40:00 UTC 优雅停（停时零持仓）；02:40:09 有一次**来源不明**的同实验重启（PID 3914763，main log 仅一行引擎创建，重启起源至今未明——疑用户本人操作）；其 02:45:55 消亡**已定性=top3 级联 null 崩溃**（见下事故段：TickDebouncer 路径无 catch → uncaughtException 静默崩死，无停止日志行=崩死形状而非人为 stop；「疑人为操作」作废）。切 v39 前以「净持仓 0+进程消亡+pgrep 确认」三查放行，v39 由实例锁防线接管
- **v39 首启事故（已收案，根因=4ef5109 top3 观察键批次边角）**：首启 02:53 UTC（PID 3922871）后 02:53~03:04 flap 37 条 `[TokenBought]/[TokenSold] 解码失败: Cannot read properties of null (reading 'has')`（tx 未落 wss_price_ticks，占同窗 flap ticks ~2%），03:05 前后进程崩死（/tmp/v39-start.log 捕获 uncaught 栈：`_bundleClusterFactors` 2400:48 → buildFactorMap → _runBuyEvaluation → TickDebouncer onFire——timer 路径无 catch 直接 uncaught；「03:04 后自愈归零」作废，实为进程死了没人再报错）。**根因**：恰两块票第二块持仓和=0（买家全清仓）时，三槽级联第三分支 `_s(0) > _top3Sum(-1)` 恒真——零和块抢占 `_top3Ws` 而 `_top2Ws` 仍 null，读点裸 `_top2Ws.has(_w)` 即炸；37 条「解码失败」是同一 bug 的 flap handleLog 路径表现（catch 吞成解码失败，feedFa→buildFactorMap 同源）；v38@3914763 的消亡同因。**修复 de5b163**：读点 null 守卫（`_top2Ws !== null &&`）零语义变化（零和块买家净持仓非正，`_v>0` 守卫下占哪槽分子贡献都是 0）；单测 Q6/Q6b/Q6c 事故现场反证（恰两块+第二块清仓不崩、退化值=top1、源码锁守卫形状）；修复后 v39 二启 03:19 UTC PID 3937184（双 collector 就位/零 ERROR）。代价：flap 37 ticks 永久丢失（quote 缺口由下次 flap collector getLogs 回放自愈）、v39 首启 03:05~二启 03:19 间双平台采集空洞（无实验运行期空洞=接受口径）、无持仓损失（崩时零持仓）

### T67 top2 存量第二道门 top2BundleClusterHoldCircPct < 55——AIFLY 案（2026-10-25，buy-v2 v37，0x0baecc80613610f8c6051e55c136505a4750777）
- 案：AIFLY fire 时刻筹码结构重放——块 129715692（创建块）4 bundler 等额毛买 179.87M 后 9s 起分批协同卖出洗白到零；块 129715693 单钱包 0xf539901b4c4830ef118ccd2745ca725341577bc6 囤筹 58.58M（当时流通 88.4%）。fire 时 top1（bundleClusterHoldCircPct，存量口径）=34.8 **恰擦线低于 35 门放行**（分子=bundler 剩余持仓块），top2（最大两块买家并集）=57.2——两块合计囤筹过半的盘放行即亏
- 因子：`top2BundleClusterHoldCircPct`=最大两块（持仓口径选块）买家集合**并集去重**当前正净持仓合计 ÷ 流通 ×100；同钱包复买跨块只计一份（相加口径双计可虚超 100%）；不足两块退化=top1；恒 ≥ top1（并集域 ⊇ top1 域）；原料 `_blockBuyWalletsAll` 全史 Map（与 T1 同源同防线）；0=无买入块/流通≤0 有证据零值
- 阈值裁定：95 票 fire 时刻重放扫描（近 3 天 BUY 信号票、真 FA 全量重放、尘门 0.001、链上真序、喂至 fireTs）——50 拦增量含净赢家 +0.0068（拦截率 62% 误伤面大）；**55** 拦 AIFLY 57.2、增量仅漏 1 张 55.3 赢家（净 +0.0023）；60 数据最优但漏 AIFLY。用户裁定 55
- 部署：库 buy-v2 v36→v37（`AND top2BundleClusterHoldCircPct < 55`）；live v38 e5438645-4274 实跑本屏（2026-10-25 15:32 UTC 起，库 v37 整条 copy-in，PID 3584931）；v37 ca8f9493 停前全平（BLACKBELT 0x46ea…7777 引擎卖腿 15:27:46 自动卖清 -43.5%，豆奶/K线人生/初一卡账本 after=0 手验全平）
- **BLACKBELT 反事实验证（2026-10-25）**：真 FA 全窗重放（99 ticks）v36 形状首破 15:23:27 ≈ 实际 fire 15:23:30.872 校准成立；top2 全窗最低 56.2（fire 时刻 56.2/63.2，之后 61.5→242 一路走高）从未 <55，31s 后 top1 亦破 35——**v38 下该票全窗无 tick 可 fire=买信号根本不产生**，-43.5% 亏损票被门拦下，正是本门设计形状
- 单测：`_test_bundle_cluster_factors` P1-P6（并集去重 66.7 非 133/不重叠两块 100/单块退化=top1/AIFLY 现场缩微 34.8+57.1/BITCAT 不变量 top2 85.8≥top1 63.3/逆序 parity）83/0；`_test_fourmeme_fa_factors` 白名单 +2 键（bundleClusterHoldCircPct 漏登记随本批补）34/0；create-v38.cjs 防呆（源=v36 快照形状无 top2 臂/库必须 v37/gmgn+trigger 逐字一致）
- 编号裁定：24126eb commit message 与 create-v38 脚本注释曾误标「T65」——T65 已被卖臂矩阵案占用（11c19e9 先入台账），按「先入台账者得号」本案取 **T67**，git 历史不改

### T63 买窗慢热或臂——灰灰案（2026-10-25，buy-v2 v35，0x0da1d47f702d04e72eb8482e2f4c214eb5dd7777）
- 案：flap 慢热票 90s 窗内人气臂差 0.109 BNB / 2 holders 没买（rating=3 age 10s 早已过）；主升全在窗外——146s 人气臂过但 bundle 100%/slope 负拦，**223s 全臂首过**（mcap 5736=1.18× 开盘），峰值 55796（x11.5）毕业；mcap<20K 永久死线 667s
- 改动：v34→v35 age 门 `(tokenAgeSec < 90 OR (tradeCount >= 25 AND tokenAgeSec < 600))`——「交易数据走过一定量」（FA `tradeCount`=非尘 tick 累计，live/回测同口径）；其余 15 臂不动
- 阈值依据：灰灰 90s 关窗 tc=19 / 223s 买点 tc=29 → N=25（高于死票终值且留 4 笔余量）；600s 帽=20K 死线圆整
- **外层 600s 帽是必要件非参数**：裸 `OR tradeCount >= N` 臂无 age 约束 → `extractBuyRangeFromCondition` OR 侧 null 降级 → preFilter 整体失效（监控池淘汰默认关=未持仓票永久逐 tick 构建）；带帽则 OR 并包络 {max 1.5}∪{max 10}=10min 窗，构建成本有界。`_test_fa_prefilter` A13/A14 形状锁死（A14=无帽反证）
- 生效路径：改库不影响已建实验（快照语义）——2026-10-25 05:01 UTC 起 live v37 ca8f9493（买腿=库 v36 整条 copy-in，T63+T1 一并生效）实跑本屏；v36 cf3d8177 已停（停前卡账本净额全零核查）
- 归因法：182 逐 tick FA 重放（尘门 0.001/链上真序/rating 完成时刻注入/sybil roster 预载）——同 T10 迟买归因法；GMGN 第二层历史快照不可得未重放

### T1 bundleClusterSharePct 两口径 A/B 对比——月亮币案（2026-10-25，已裁定：换门）
- 票：实验 cf3d8177 全部 13 笔买入（月亮币 0xcb69aab56621eb562563254f682931f50d717777 / OST 0x290203a898eecc537fd89afcea281d44e2177777 / BNB Legend 0x0b66b5d4dc76dc7cae9e8f94df97026062057777 等，全清单见实验 trades）
- 用户观点：该键名字=「最大区块协同钱包群的持仓占比」，持仓占比不应有 10s 滚动窗。B 版口径=每钱包记录其有购买行为的块簇，簇成员**当前正净持仓合计**÷流通，全块取 max
- 方法：真 FA 逐 tick 重放（v34 全门同构、其余门逐字相同、叙事取 rounds 首个 2|3 轮完成时刻注入），对比两口径各自**首破时刻/价格**，盈亏按同卖出路径缩放
- 结果：合计 retA（现行流量口径）66.5% → retB（存量口径）**107.8%（+41.3pp）**；9/13 票 B 更早或同刻放行、4/13 更晚。最大赢家月亮币 B 提前 15s（age 25s 放行 vs 40s）+29.5pp；最大代价 OST −40.1pp——流A=100/存B=64 说明拉升簇**真囤 64% 流通**，存量门等消化 47s 买贵 22%（票终仍 +123.8%）；BNB Legend 流A=100/存B=19=快进快出交易簇被流量门误拦 34s
- 语义分歧本质：流量门拦「10s 内簇主导买盘」（误伤交易簇），存量门拦「簇真持仓≥35%」（对真囤簇更晚放）
- caveat：13 票全是流量门实际放行过的票（选择偏差），无 tB=never 样本
- **裁定（2026-10-25）**：不加键并存，**直接替换**——FA 新因子 `bundleClusterHoldCircPct`（全史 max over 块(该块买家集合当前正净持仓合计)÷流通×100；原料 `_blockBuyWalletsAll` 全史不裁刻意不与 `_blockBuyAgg` 共引用；恒 ≥ maxBlockBuyCircPct——后者按毛买入最大选块、本键按持仓最大选块；0=无买入块/流通≤0 有证据零值）替换门位，阈值 35 不动；旧键 bundleClusterSharePct 保留发射（纯观察）。库 buy-v2 v36（v35 被 T63 慢热或臂占用）、单测 O1-O8（两键分离/清仓回落/全史不裁/prune 回推并集防线）、v37 实验 create-v37.cjs（买腿整条取库 copy-in，T63+本批一并生效）
- 详档：auto-memory `bundle-ab-compare`

### T2 buy-v2 v34 市值窗 15K→20K + 观察信号——₿DOG 案（2026-10-23，71b7e3a，live v35 ddc51b6d）
- 票：₿DOG 0x85cd…7777（flap 11 秒毕业盘）
- 叙事 high 87.32 落地时市值 29K 已出 15K 买窗——「叙事过但没买」的票 condition false=零行零日志零留痕；其余因子全过（GMGN 路由 68.4%、buyVolume 12+ BNB、netBuyRatio 95%）
- 裁定：市值门 `<15000`→`<20000` + **观察信号**（叙事 2|3 或市值>20K → ≤3 行/票 `signal_type='OBSERVE'` 恒不触发交易，事件首记+60s 补采，重启重建续接）
- ⚠️copy-in 快照语义：改库不动在跑实验，须新建实验引用 v34 才生效

### T3 buy-v2 v30 五腿 AND 化+bundle 35+去 NULL——v29 形状诊断（2026-10-22，1a307a0，实验 v31 8ddda72d）
- 起因：bundle 50→35 提问牵出 v29 形状诊断——`(famous<40 OR 五腿)` 中 287 票 fire 快照 famous≥40 **零出现**（max 14.6）=五腿死代码
- 裁定三件：①五腿（slope/bundle/top1/copy）无条件 AND——静态回放拦 179/287、被拦净 -0.0211，误伤 27 正票 ②bundle 50→35 增拦 55 票净 -0.0291（与 sybil 同锚）③famous/sybil/crashSpeed 三键 null→0（「famous 不应有 NULL，最低是 0」），裸比较与原 IS NULL 臂逐输入等价；主名单 copy 维持 null fail-closed
- 单测：fa_factors 零 diff 豁免形状 / recent_ticks_scan / sybil / copy_roster 四文件

### T4 earlyTradesNetBuyRatio>=50 门——e8da 批次（2026-10-22，buy-v2 v29）
- 23 票 fire 时刻净/毛比回放：赢家 3/3 全 **69-73%** 干净下界；输家 <50% 的 6 只全拦（MAYA-eb2f 19/喵方丈 49/SUMMER 48/binance 41/MEOW 37/PIKACAT 25）；误伤仅 PHP +0.0001；阈值 50-58 稳健平台
- 语义=「买入时刻卖压已吃掉一半买盘（换手出货盘）不接」；null/除零不可达（fire 必过人气门蕴含买行）
- **netBuyVolumeBnb 绝对净量轴否决**：7777 族是真实买入后砸盘非对倒刷量，输家 12/12 fire 前净≥1.25 与赢家完全重叠；净量曲线不单调，「等冲破」语义不成立

### T5 maxBlockBuyCircPct 门上线即撤——乌龟案后续（2026-10-20，5b4eca8，buy-v2 v24；门当日移除）
- 口径变更：10s 滚动窗最大单块买入 → **全史最大单块买入**（滚动版大块滑出窗后归零只能当冷却；乌龟 0xb2782a4a27b1fc104c377a06e3cf455ca0fe7777 fire 真值 29.0% 恰过 `<30` 门）
- v27 `<25` 门 111 票回放 **110/111 全拦**、11 笔实盘拦 10（含 3 正票）→ 当日裁定先行移除，口径待重议（因子仍发射不进条件）
- 口径断代：2026-10-20 前落库快照的该键值不可比
- 单测：_test_bundle_cluster_factors（滚动簇键出窗归零、maxBlockBuyCircPct 保留反证）

### T6 崩盘接刀双门——7777 马斯克人生案（2026-10-20，实验 v27 37b19a9f）
- 单块 -88% 接刀：暴跌把市值砸进买入窗（量门市值门全过）是结构性漏洞
- 裁定：`drawdownFromHighest > -70 AND crashSpeedPctPerSec > -10`；mbd（maxBlockBuy）不单用

### T7 GMGN 三层门与 fail-open——乌龟/FAKER 案族（2026-10-17~20）
- 三层链：fire 因子 → preBuy → GMGN（`GmgnRiskCheckService` 5s 超时/5s TTL/inflight join；前序全过才真调=配额最小化）
- **fail-open 裁定（2026-10-20 乌龟案）**：API 失败/超时/未索引/冷却 → covered=0 放行——事故=GMGN IP 级 RATE_LIMIT_BANNED 三连拒买、恢复后 47s 才成交；GMGN 是附加风控层，不可用不得拦买点。**条件表达式评估异常（键集外/语法）仍 fail-closed 拒**
- bundler 门 75→65（2026-10-22 库 v31；65-75 段 17 票净 +0.0101=收紧略亏代价，样本薄照指令执行）；visitingCount 刻意不参与 hasAny
- 事故教训（v15 映射白名单 b053b87）：因子映射键集变更须对拍存量

### T8 e8da MAYA 极速票挤压——没买归因（2026-10-21/22）
- 票：MAYA 0xe8da305a…7777（flap 税币，18s 毕业）；v28 买了兄弟票 0xeb2f6eab…7777（26.4s fire）
- 叙事 R1 16:00:35 就绪，但全门通过窗仅 16:00:36.0-37.3（11 tick）；fire 评估节拍（200ms/1s 去抖）每次恒假
- 根因=**holders>=10（钱包段，sender 回查滞后 >1.5-2s）× mcap<12000（价格段，即时）评估时刻不相交**——极速票的买窗本质是「钱包段滞后 vs 价格段即时」的赛跑 → v28~v30 批次由此触发（T3/T4）
- 三坑：uuid 列范围查询静默空（22P02）；列名陷阱（无 side/name/created_at）；「blockNumber 桶×8 块」=每块一点 8 点封顶非「8 块一桶」

### T9 C84 买腿链路重构——触发模型上线（2026-10-17，v21 cf92cbd3）
- 新链路：叙事发起条件（FA 因子）→ 后台多轮分析 → 单一买条件（含 rating==2 OR ==3）→ GMGN；全部因子同一 FA 因子表评估，消除 fire/预检查两阶段因子漂移；unrated(9) 放行废止
- v19 量门撤销抢第一波（买条件删 buyVolumeBnb>=1.0、发起门 0.5→0.1）；关键不变量：**发起门量轴 < 买门可满足点**（库条目须维持）
- 发起门 0.1 调用量验证（200 新 token 抽样）：发起率 12%→17.5% 仅 +46%，绝对量 7-14 次/h 离瓶颈差 2-3 数量级
- Pingus 0xe786…7777 延迟归因：leadMs 9.9s 不是引擎慢——市值臂真那 5s 量门没攒满，量门攒满时市值刚上穿，等 slope 出值（≥4 块桶）才全过
- 互斥 fail-fast：trigger×call 同腿拒启；legacy 链整链保留

### T10 buy-v2 v15 三门+市值豁免——0x581a 案（2026-10-16 前后）
- 三门：量 1.0 / holders>3 / 市值<5K 豁免三门
- 方法论沉淀：**迟买归因=真 FA 逐 tick 重放法**（重放全量 ticks 记首破点，绝不能 fire 时点静态快照——方向都能反；后成全部买门分析的标准方法）

### T11 g80u40 双门案——桂花小鸟（2026-10-13/14，0xbe5a8a5a…7777）
- 回测对拍（220 票级）：g80（bundler≤80）拦 69 票净 **-26.0**（猪五花/SNORKL/CAT 大赢家全在高段，与 09-27 否决结论一致）→ 撤；u40（userPct≥40）拦 62 票净 -9.41（大赢家与亏票同挤 20-37 区间区分度不足）→ 留实跑观察
- 小王子 0x71b58f07…7777 案：TPAPre 快照 write-once 不翻案（「好票后面 GMGN 用户会增加」）→ FA 实时因子 gmgnUserPct（66ed250），90s 买窗内实时翻正过门

### T12 v7 三门对拍终局（2026-10-13）
- sameName 门删 / er 右臂 +0.77 / GMGN 门 +2.23；P4b=门拦截归因权威分类器

### T13 TPA tokenScore 门消融终局（2026-10-12，129 票对拍）
- 门净效应 **-6.99 BNB**、阈值曲线全档负单调（≥0.8 拦 5 票 -0.84 → ≥2.5 拦 60 票 -6.99）；拦截票胜率 52%=放行票 52%（分数零区分度）
- 13 票全景（09-28 定稿阈值 2.2）：score-only 拦 5/13 全亏票 0 误拦；「拦作弊需作弊形状信号（同秒等额批次等时间维度），非 TPA 调参」
- uniform 前置门同日否决（全阈值负；高 uniform 桶净正——「作弊者卖掉后散户接盘」定量成立）
- 谱系：09-27 母版 6(SOL)→BSC 1 BNB→2.2 score-only→10-12 消融→10-17 v21 TPA 段删除（enforce 无门控差异，条件不引用即无拦）

### T14 holderTrendCV 门否决（2026-10-03，231 票）
- 单主题类 35 票 in-sample 最优档，全类每档翻负（>0.25 档 -3.448）；火热票 holder 快速涌入本身就是高 CV 形状，高 CV≠对倒
- 结构性盲区：首买 <10s 票 CV=null fail-open，85 张 null 票净 +4.872 占全类总净额 **41%**——快枪票是利润大头，CV 门天然管不到
- 教训：立门前必须全类验证；同语料家族甄别因子缺口仍开放

### T15 d46b1b6c 买过滤 LLM 逐票归因（2026-10-0x）
- 评 3 胜率<评 2；虚高重灾区=产品发布簇；label-leak 教训（归因分母须剔除决策用了该标签的票）

### T16 再入场腿扩窗定论（2026-09-30，B0w2/B1w2）
- P2 扩窗配对回测 **+0.665/19h**（50 fires/10 exec）；机会后段集中（8/10 在 20:35Z 后）——首轮 12h 窗「微正」是截尾假象
- vr 门 B2 取消：router 门接管 71 票（净 -2.26）、vr 独有 19 票亏率 73.7% 但净额 +1.173 → 零增量负贡献
- 操作成规：回测对重建后必核验三件套（token 集合覆盖窗/追加腿 condition 有效措辞/窗口参数）——v1 追加腿恒 null 零触发与基线 bit-identical 假象

### 乙、因子口径

### T127 发行价口径换平台 curve 常量锚——currentVsLaunchPct 族分母不再用首笔成交价（2026-11-08；commit `df9c7a6b`）

- **问题**（用户发现，例票苍蝇 0x2a5fdaaf…7777/实验 68017ac6、小四 0xca7b4ed5…ffff/实验 cd5759bf）：`currentVsLaunchPct` 全族（BP 位置门/黄金点/CD reset 截窗、FA 因子、ladder v13 价格门）的发行价锚=**锚窗首可靠价**（≈首笔成交后价格），不是 curve 定义的真发行价。合约实证（详档 auto-memory launch-price-curve-constants）：**两平台都是 curve 定义的固定发行价**——four.meme 模板制 143 档（主流档 P₀=4496173469e-18 BNB/枚=初始市值 4.4962 BNB 占绝大多数，跨档闭式 P₀=K×8.66989e-19 五档全验，143 档初始市值横跨 ~700 倍）；flap BNB 盘 tier 制（主力档 CURVE_RH_BNB(20)：r=6.14、h=107036752 → P₀≈5.546e-9=初始市值 5.55 BNB，LibCurve `(1e9+h−s)×(eth+r)=k`）。旧锚失真两源：①首单滑点抬锚（主流档票 92% <1.33 倍，温和）②高价位模板票旧锚贴首笔均价、真发行价高得多（小四 maxRaising=1988.1 档 P₀=6.34e-7，旧锚 7.68e-7 失真 +21%；「首单抬锚 170 倍」旧归因**错误**——该票是模板高价档非滑点）
- **裁定**（用户原话）：「不需要我认为 fourmeme 使用主流档即可。flap 也是使用主力档即可。价格门的话只能是重新回测看一下效果了。」——**统一平台常量，不逐票 eth_call**；ladder/位置门阈值不重设计，换锚后重新回测对照
- **落码**：新模块 `src/market-analysis/launch-price.js`（零依赖叶子，防循环依赖）三态接口 `resolveLaunchPriceBnb(platform, quoteToken)`：'fourmeme'→FM 常量；'flap'∧无 quoteToken→FL 常量；其余（flap quote 盘/gang/未知/null）→**null=调用方保留旧口径**。五个消费点：①BP snapshot launch 族（launchPriceBnb/currentVsLaunchPct/athVsLaunchPct/minVsLaunchPct——常量锚恒有效不看 launchCovered，截窗长票/高价模板票失真消除；null 平台走 launchCovered 门+toFixed(10) bit 不变）②CD `computeMarketResetIndex(rows, platform)`（quote 盘判 rows 行 quote_token；service 调用点传 tokenMeta.platform；回归 runner 三调用点同步）③FA `currentVsLaunchPct` 分母 `_resolveLaunchPriceBnb(state.platform, state.quoteToken) ?? _relFirstPriceBnb`（_relFirstPriceBnb 首值冻结保留=quote/gang/TPA 域仍用；_asofRelFirst 审批时刻冻结刻意不动）④回测 TICK_SELECT_COLUMNS 加 `quote_token`（BacktestTickCache columnsTag 漂移→全量重拉一次设计内 ~4.5min/平台）⑤**顺手修回测两门 supply 断链**：BacktestEngine `_cheatGateEvaluateBinary`/`_bpGateEvaluate` 曾把 factorResults（因子表）当 faState 传→BP 市值族+CD supply 族锚恒 null（bt-v83/v84 702/707）；改传 `getTokenState(tokenAddress)`（与实时侧 FourMemeWssTradingEngine 同姿势）
- **单测七件**（策略=夹具 platform 缺席锁旧口径 bit 回归+常量锚专段价格域乘常量保百分比断言数值不变）：cheat_market_reset 35（B 段旧口径锁+C 段常量锚 FM/FL/quote/gang 四臂）/current_vs_launch_factor 21（G 段公式源码锁+常量字面量锁+H 段四平台臂）/buy_point_lib 455/cheat_detection_service 142（priceTicks 工厂价乘 FL 走真常量链路）/cheat_gate_engine 136（CD381 轨迹价换 FM 域百分比 bit 不变）/buy_point_check_service 39（pump 门常量锚专断言）/fourmeme_fa_factors 35（顺手补 CD381 漏更的 preCheatResult/priceBackToAlmostLaunch 白名单）
- **对照回测 bt-v85**（`ba242cca-2237-4e31-9807-75a87871b7ba`，克隆 bt-v84 同窗 2026-11-05 00:00~13:45:10 同配置 ladder v13+CD384+全量卖腿+signalGateReal，唯一变量=发行价锚代码；总时长 ~14min，含 tick 缓存 columnsTag 漂移全量重拉 ~9min）——**净 -0.4902 → +0.8112 BNB（改善 +1.30，完整窗口首次正收益）**：

| | bt-v84 旧首可靠价锚 | bt-v85 curve 常量锚 |
|---|---|---|
| BUY 信号 | 1442 | 1776（fire 面变化本身=锚差异读数） |
| 成交票 | 128（花 25.60 收 25.11） | **37（花 7.40 收 8.21）** |
| 胜率/每票期望 | 28.1% / -0.0038 | 29.7% / **+0.0219** |
| reset_insufficient 拒 | 281 | 346（破发域扩大→reset 触发面+65） |
| ④ early_sniper_decay 成交 | 100 票净 **-0.5693** | 29 票净 **+0.9485** |
| ⑦ restart / ① strong_backer | 14 票 +0.3169 / 7 票 -0.0866 | 6 票 -0.0855 / 0 票（被 ≤40 位置门拒） |
| t2/t3/N36 腿成交 | 15/8/3 | 0/1/0（价格门拦掉） |

- **读数**：①新锚下 curVs 分母换 curve 零点——主流档票（首可靠价>FM 常量）curVs 整体上移、flap 部分开盘砸盘票下移（来财 52.19→29.27），**价格门（≤80/50/20/10/40）实质大幅收紧**：开盘冲高④票批量被拒，剩下贴近发行价的④票=黄金形状大正；②大正票三保二——M4GA 0xba5ed45b +0.5152 与 0x78cd05cf +0.4088 两实验都成交，**来财 0xc84a0ff2…7777（+0.3017）v85 被 BP 门综合评估拒（bp_gate_assessment，8 信号全拒；curVs 更低非位置门——BP 盘型判读随锚输入变化，单票 Jev 方差待观察）**；③小四 0xca7b4ed5…ffff（高价档票，v84 -0.0109）如预期被拒；④v85 独有成交仅 3 票全小负（-0.06/-0.004/-0.009）；⑤误拒代价=restart/strong_backer 正票（0x962ba5c2 +0.2234、0x165d20f5 +0.2008、0x373b917c +0x2002 等被位置门拒）——价格门阈值按旧锚校准，换锚=阈值等效收紧，**是否重新校准阈值待用户裁定**（现状=严格版已净正）
- **⚠️断链事故（2026-11-09，用户复盘 0x32f18a98…7777 涨幅质疑发现）：上表 bt-v85 对照结论作废**——TICK_SELECT_COLUMNS 加了 quote_token 列、FA state.quoteToken write-once 捕获点（processTick tick.quote_token）也在，但**两处上游组装对象都漏传该键**：①BacktestEngine._loadWssTicks 的 this._ticks.push 组装；②flap collector _feedFa 的 FA.processTick 组装（decoded.quoteToken 在场未透传）→ flap quote 盘票 state.quoteToken 恒 null → resolveLaunchPriceBnb('flap', null) 误判 BNB 盘用 FL 常量分母（正确=quote 盘无常量锚→旧口径首可靠价）。**bt-v85 信号面 162 token 中 128（79%）是 quote 盘票 curVs 全部失真**（例票 0x32f18a98：正确口径 07:06:19=+11.12、误 FL=+13.24；首可靠价 6.03e-9 vs FL 5.546e-9 per 票失真方向不定）；**cheat 门 CD 侧（service 拉 DB 行自带 quote_token 列判对=旧口径）与 FA/腿门/BP 门分母分裂**——CD382 日志「最低 11.1%/6.5%」=旧口径、trendFactors curVs=FL 口径同信号两读数。**实时链（虚拟/live）同款断链但零污染**（T127 部署 df9c7a6b 后无实时实验运行）。修复=两处组装对象各补一行 quote_token 透传；单测 _test_backtest_quote_token_passthrough.cjs 9 断言锁死（FA 三态互异功能锁+两处源码锁+write-once 首个非空捕获语义）；**对照须 bt-v86 重跑**（bt-v85 终态不能重跑——BUY 信号行翻倍污染红线）

### T127 续：quote 盘发行价锚同 FL 常量——赵公主案（2026-11-09；commit `242f5769`）

- **案由**（赵公主 `0x5793b7ead75851206529f98cfe89db54511a7777`，bt-v89 `b7941b0c` 亏损 Top1 -0.0867，BP53 ultra_router_entry 豁免放行票）：用户目测「买入的价格是 near_launch 吗？目测要更高」——门链判 curVs=38.5（≤40 放行），但该分母=**首 tick 8.26e-9**（quote 盘首笔成交价=常量×1.49，开盘 1.675 BNB 大单冲击后）非 curve 零点。四轮追问（定了常量吗→这是 BNB 价格吗→默认初始价格对的上不→落码）实证：**quote 盘（flap 非 BNB 计价）池初始价就是 FL 常量**——wss_events token_quote_set 近 400 票中 389 零成交（97% 无人交易顺带留档）、11 张有成交票首 tick（price_bnb=换算后 BNB 域）全部 5.10~5.68e-9、**p50=5.55e-9=FL 常量 1.00x**（11/11）——T127 调研「per-token snapshot 定价（QuoteCurveAuth fromPrice USD 逐票可变）无常量可言」结论**实证错误**，生态同 four.meme「43 档但主流档占绝大多数」
- **域澄清（调查中误判教训留档）**：FA signal metadata 的 `launchPrice=0.000005897` 是 **USD 域旧前端兼容键**（=price_bnb×lastImpliedBnbUsd≈714，FA 注释「兼容旧前端」）非 BNB 域分母——曾据此误推「quote 盘发行价 1063 倍高于常量、用常量会 +170,000% 全灭」后认错修正；DB `wss_price_ticks.price_bnb`=**BNB 域**（flap collector 落库前 quote→BNB 换算，赵公主首 tick 三列自洽：bnb_amount/token_amount=6.45e-9 均价 < 边际价 8.258e-9，大单冲击 28%）；FA curVs/BP snapshot 全 BNB 域同源自洽无双重换算
- **裁定**（用户原话）：「落码吧，quote 盘也直接用常量」——`resolveLaunchPriceBnb` flap 分支恒返回 `FLAP_LAUNCH_PRICE_BNB`，**curVs 分母三态塌缩成两态**（flap 无论 quote 与否=FL 常量；fourmeme=FM 常量；gang/未知=null 旧口径）；quoteToken 参数保留（调用方签名不变，透传链现存消费者=毕业阈值学习 per-quote/PCS 二跳路由）
- **影响面**：quote 盘票全部 curVs 族载体一致收紧（锚下移 8.26e-9→5.55e-9 → curVs 变大 → 价格门更严）——BP 位置门（⑥≤10/⑦①⑤⑧=40）、CD381 priceBackToAlmostLaunch（锚 ≤+10）、CD382 reset 截窗（exitThreshold=launch×1.1）、FA 因子、ladder NL/RL 价格门；与 BP56「门链全部放行出口价格上界统一 near_launch」同向
- **对拍（182 达成）**：赵公主 11:17:12 锚 BP 门重判——curVs 38.5→**107.3**、综 neutral(ultra_router_entry exempt curVs:38.5/router:30.7)→**poor(pattern_gate)** 翻拒 ✓（④桶 early_sniper_decay 0.90、router60=30.7 照旧 ≥30 但 BP56 价格腿 curVs≤40 失效拦截）；CD 侧 grade=healthy 不变（散户盘非作弊盘，拦截本就在 BP 门层）。买点价 1.1498e-8÷FL=+107.3% 超 near_launch ≤40 近 3 倍——-0.0867 亏损正是 quote 盘首 tick 锚偏松放走的
- **单测三件同步**：current_vs_launch H 段 quote 盘断言改常量口径（3FL/FL−1=+200 vs 旧口径 +50 数值互异锁死）/backtest_quote_token_passthrough 三态→两态改写（A/D 段口径统一锁，B/C 源码锁保留防透传链再删）/cheat_market_reset C4 quote 盘=FL 常量；本地+182 全绿。**存量失败留档**：cheat_mem_pull_ticks D2 `pull.fromMem` 源码锁断言（现实现为 `pull0.fromMem`，rename 时断言未跟上，与本轮无关待裁定）
- **回测记账域留档不修（调查副产品）**：BacktestEngine 虚拟成交价 `signal.price` 为 USD 域 → ÷BNB 预算枚数虚低 ~714 倍，但买卖同域抵消**净盈亏正确**（=0.2×卖买价比）；trades 行 unit_price 语义标错域——是否立案待用户
- **回测对照 bt-v90 `cebf56f5`**（v89 克隆同窗，唯一变量=quote 盘 FL 常量锚；BUY 1642 信号/成交 65 票/净 **+0.6126** vs v89 +0.9261/73 票，-0.3135 仍正收益）：
  - **赵公主细读（核心验证票）**：v89 11:17:12 executed（ultra_router_entry curVs 38.5）-0.0867 → v90 四条信号常量口径 curVs 逐步回落 **75.5→62.5→48.7→31.5**，前三条 pattern_gate 拒（>40），11:18:16 第四条 **BP46 高热近价豁免放行**（sniper_decay_heat_price：heat=high ∧ openShare 66.2<80 ∧ curVs 31.5≤40）gates_passed 成交 → 净 **-0.0112**（-0.0867→-0.0112 缩 87%）——新锚不是把票拒掉，是**把买点从 +107% 山顶压到回落段 +31.5%**，位置门按设计工作
  - 换手面：v89 独有 15 票合计 ≈**+0.09**（翻拒面=收紧代价，含 0xea7886d5 +0.2941 大正票——BP53 对拍正票被新锚价格腿误拒）；v90 独有 7 票 ≈**-0.12**（新增面全小亏）；其余净差在共有票买点移动
  - **豁免通道×净额（v90 票级）**：stall_burst 4 票 +0.4506 ＞ activity_ultra 12 票 +0.1603 ＞ activity_high 42 票 +0.0698 ＞ healthy 直过 7 票 **-0.0682（唯一净负通道）**；**亏损 Top5 单票全部 activity_ultra**（0x45ec0489 -0.0948 t0b/0x68bb8cd4 -0.0740 t0a/0xc62d2dff -0.0660 t3/0x04323e04 -0.0634 t0a/0x75d5286d -0.0614 t2=BEM）——「单票亏损深度集中 ultra 豁免」成立（用户观察印证），但 ultra 通道净额为正（0xc84a0ff2 +0.4023/0x32f18a98 +0.1592 两张正票同域）——**与 CD384 挂账「activity 豁免域=唯一亏损源待裁定（CD379×门链联合校准）」同形状并档**
  - 结论：quote 常量锚方向正确（单票最大亏损直接砍掉、BP56 价格腿钳制生效），代价=误拒面 ≈+0.09 与买点整体后移——口径修正非策略优化，窗口净额下降为知情取舍
- **余留**：生产 quote 盘票 curVs 分布观察（首个引用实验吃到）；价格门阈值按旧锚校准问题（T127 原余留）在 quote 盘侧同解——换锚=等效收紧，重校与否待裁定

### T17 信号/执行双口径——0xc7fe 案（2026-10-15）
- 事故：fire 锚 1.1445e-8 → 检查 12s 冲高 +23.6% → 成交价介于中间 → 峰值从成交时刻起算 → P11 回撤臂不具资格走 P2 止损 -53%（反事实 P11 提前 75s 多回收 ~+50%）
- 裁定：**信号体系全用 fire 时刻/价格**（markBuyFire pending 双轨峰，peakAny/peakRel）；`holdDuration`=fire 起算，新键 `realHoldDuration`（物理持有）+ `buyExecutedPriceBnb`；止损时间臂读 realHoldDuration，**P4 腿须显式 realHoldDuration>10** 保「成交后 10s 缓冲」
- 回测 parity 红线：无 pending 标记时 setBuyState 逐位退化旧行为；单测 _test_prebuy_peak_backfill

### T18 holderTrend slot 化 11 键（2026-10-14，d0cf735，buy-v2 v10）
- 10s 墙钟桶 80s 窗 → **blockNumber 桶×8 块≈4s 窗**（同块覆盖/8 块封顶；与价格接受链解耦——离群/零价 tick 照推进）；slope 出值 ≥4 点≈2s（旧 40s）
- W=8 定长数据：182 重放 48h 6000 盘/941 票/86,508 评估点——区分度对 W 平坦（22-25pp），翻转率是主效应（W4 15.5%→W8 7.1%）
- 买门配套：`holderTrendSlope > 0` **NULL fail-closed**（旧 OR NULL 臂在 4s 语义下近乎恒真=门不存在）
- 历史断代：键名原地改语义，旧信号 metadata 不可比；FactorBuilder slim 补 11 键（序列不可重建，不落库即丢=买门复盘唯一数据源）

### T19 act* 8 键活跃度滑窗（2026-10-15，155cb0b）
- 取代同日删除的 cycle 分桶路由【T34】；`actBuyBnb/actSellBnb/actNetBnb/actTrades/actTraders/actBuyers/actSellers/actNewTraders`，`activityWinMs` 默认 10s
- 要点：wallet=sender||trader；照计语义（无 outlier/chainLate 过滤，与 tradeCount 同口径）；空窗全 0 非 null（写条件不用 IS NULL 防 null 拦）；禁 Date.now；与 tickBuildSkip 天然无互斥
- 单测 _test_activity_window_factors（44 断言）

### T20 sniper 判定+持仓因子（2026-09-22~24）
- 判定标准：tc>=100 & (hold<300s | null+sym<0.1)；画像 miss=非 sniper
- sniperHoldingPct <50 门 354 票验证；拦截伴随 SnipersWallets≥2

### T21 top1BuySharePct + tokenAgeSec 秒键（2026-09-24，fc574c2）
- 90s 过期洞（EarlyParticipant 窗过期后 top1 不再更新）→ FA 加 tokenAgeSec=age×60 同源双路径修正；+2.114 验证回测

### T22 FA 因子清理+周期冷档（2026-10）
- 删 68 死键（保留三类：条件引用/白名单/观察键）；tps 分母按存活归一+cycleEarlySec(90) 修冷档起步延迟

### 丙、对倒 / sybil / 集中度案族

### T66 sybil 买门删门反演——维持现状（2026-10-25，v37 ca8f9493+v36 cf3d8177 全量 10,389 票逐 tick 重放）
- 假设：「syb 高不是坏事」→ 删 `sybilClusterHolderCircPct < 35` 子句 A/B 重放（v36 买门 JS 化、叙事门恒真做差分；名单=10-25 版 570 钱包；**对拍=实际成交 24/24 全落 BOTH**）
- **NEW 14 票**（其余门全过、仅 sybil 拦）× 真卖腿模拟（17 腿全形状：3.5s+5tick 确认窗/cooldown/4 卡记账）：**14/14 全亏，均值 -24.6%（-11.4%~-38.5%）**；出场=[11] 回撤×6、[4] 市值带+量弱×7、[2] 止损×1；无一摸到 +50 止盈腿（卖前最高峰 +47.9%）；全窗峰 +112~+133% 的三张（金铲铲 0xeeb391a7c79a5e38470ba8ab345b4d5f0e5f7777 / 币安拉新 0xac02e7b4383958b7da3993082b36ce2d57277777 / 小航 0x760a0ec0a95ce61a158616dcb94d9542df647777）全被 [11] 回撤门在暴涨前甩下车（峰 +17%~+48% 后回撤 35% 触发全清，大 pump 在清仓之后）
- **关键形状**：[11] 出场主力是回撤门非止盈门（峰≥+10% 后自买后高点回撤 -35 全清）→「涨超 35% 就不赔」不成立，保本需峰值 ≥+53.8%（0.65×峰值 ≥ 买点）；与 T64 同一 whipsaw 课题
- **EARLIER 20 票**：等 syb<35 平均买贵 ~12%（BNCB Bank 0xc0c17f622c… +53.9%、火星人马文 0x4b0da40d73… +36.2%、松弛蛙 0x1d2e1ad229af6c7809d2a3d87939559eb4c47777 +28.4%；20 中 14 票提前买更便宜、仅 2 票实际更便宜）——等待代价真实存在但小于拦截收益
- 裁定（2026-10-25）：**sybil 门维持现状**；代价面在意时方向=调阈值/豁免形状而非删门
- caveat：narrativeCategory/issuerAccountState 两腿重放无源恒不触发（保护性早清缺席=模拟偏乐观，实际只会更差）；flap 毕业腿无 funds_bnb 不触发（14 张全未毕业无影响）；只测单一子句（人气门 buyVolumeBnbExSybil/holdersExSybil 本身仍扣簇钱包）
- 工具=scripts/sybil-gate-ab-replay.cjs、scripts/sybil-new-sell-sim.cjs（182 跑）

### T23 GMGN 蓝筹验证八族 FAIL（2026-10-23）
- 八族验证全 FAIL 收口；48 票+182 重启待裁定。详档 auto-memory gmgn-bluechip-validation

### T24 copy 名单+双因子——FLY 案（2026-10-16，2026-10-18 扩编）
- `maxCopyWalletHolderCircPct`=名单钱包**单钱包最大**净持仓÷流通（刻意最大非合计）；名单 null→恒 null→`<N` 恒 false=**fail-closed**
- famous 名单独立于主名单（scan --commit 不影响）：`famousCopyWalletCircPct < 15` 主门 20 的收紧门
- 名单=350 钱包；维护=重跑 scan --commit → push → 重启实验（静态快照，滑掉的手工钱包人工保留）

### T25 sybil 大簇合计门——乌龟案（2026-10-20，bcc786a，buy-v2 v25）
- 乌龟 0xb2782a4a27b1fc104c377a06e3cf455ca0fe7777 四钱包 co=116~165、同步卖 84~142、等额买 88~122 却不在 350 名单——主名单 memberNeedsLeader+minFollowers 剪掉「三五钱包闭环抱团谁都不算 leader」的 sybil 小簇
- 单钱包口径对分仓簇天然漏检：fire 时单钱包 10.4% 过 famous 15 门，**合计 38.9%**
- `sybilClusterHolderCircPct`=簇内钱包合计正净持仓÷流通×100；<35（v22-v24 111 票回放：拦 26 票、误伤 5 正票，被拦净 -0.0217=总亏损 58%）；155 簇/783 钱包
- 0 语义（2026-10-22 同 famous）：文件缺失/空→恒 0 放行；生成脚本 build-sybil-clusters.cjs（强边 co≥50 ∧ 同步卖/等额≥0.5 → 连通分量 size≥3）

### T26 Agentum project 地板+launch* 等额簇（2026-10-0x，4671b01）
- project 类 5.5K 地板；launch* 前缀等额簇 4 键；币安丝删门；GMGN BSC 量字段不填充坑

### T27 鲸元卷同块等额簇（2026-10-0x）
- **同块等额簇相对差<1e-5 才是分离信号**（松散同额不算）；详见 auto-memory equal-amt-cluster-jingyuanjuan-case

### T28 猪五花 tpw<4 门（2026-09-2x，0x…7777 sybil 案）
- tradesPerWallet<4 拦职业钱包簇；六裁定；uuid 无序 keyset 跳行坑

### T29 Konasu bundle 门时序洗白（2026-10-01 前后）
- 首买+10s 窗时序洗白（bundle 门只看首买块，跟单块分离）；豁免臂短路 90.7%

### T30 7777 尾号团伙（2026-10-0x）
- vanity 地址尾号团伙 sniper-like→retail 反向盲区（先快抢后接盘的反向画像）；TPA 双盲区

### 丁、卖腿 / 止损 / 毕业卖

### T128 拱形臂持仓期化：mcapPeakBnb/secSinceMcapPeak/mcapRiseHalfSec 三键从 token 全生命口径换入场后峰轨道（2026-11-09；commit `3641316a`；用户指令「卖出策略也需要调整一下 mcapPeakBnb > 20.1 AND secSinceMcapPeak >= mcapRiseHalfSec mcapPeakBnb/secSinceMcapPeak/mcapRiseHalfSec 改为持有后的 Peak（其它的类似臂也要换）。否则如果Peak在持有之前，会很快卖出」）

- **事故形状（用户报告「如果 Peak 在持有之前，会很快卖出」）**：T107 三键原口径=token 全生命（`state.highestPriceBnb/highestPriceAt/firstTickAt`）——票先冲高大峰（mcap 30 过 20.1 门）后回落、策略在回落段入场（入场市值 15 未过门）→ 旧口径拿**持有前**的峰 30 过市值门 + secSinceMcapPeak 已流逝巨大 + X/2（=全生命涨程/2，持有前完成）也早过 → **入场即秒清**（拱形臂把上一轮行情的峰当作本仓的拱顶）。bt-v90 系回测多票「买入数秒即 T107 全清」同形状。
- **换轨道（与 secSincePeak/peakMarketCapSinceLastBuy 持仓期族并轨）**：`mcapPeakBnb`=`pos.highestPriceSinceBuyBnb×totalSupply`（入场后峰价；setBuyState 初始化 `Math.max(buyPriceBnb, state.currentPriceBnb, pend.peakAnyBnb)`——入场时刻现价/挂起峰不低于锚，fire→成交窗冲高不丢）、`secSinceMcapPeak`=(now−`pos.highestPriceSinceBuyAt`)/1000（now=buildFactorMap 入参回测虚拟时钟）、`mcapRiseHalfSec`=max(0,(峰时刻−`pos.buyTime` 成交锚))/2000（**X=本仓入场→峰的涨程**——条件求值器无算术文法预计算惯例保留）；峰推进任意接受价轨（outlier/chainLate 不推、尘价照推，与 secSincePeak 同门同价流）；无持仓 → 三键 null fail-closed（marketCap 族惯例；卖腿仅持仓期评估零影响）。消费面唯一=mcap-arc-fullclose v1 卖腿（BP snapshot 的 mcapPeakBnb 是锚窗口径独立实现不动；FactorBuilder 快照键名不变）→ **in-place 语义改：库条件串零改动、无版本 bump**。
- **语义细节**：再破新高 → 峰推进=计时归零+X 变大（X/2 只会长不会缩）；**X=0 退化保留**（入场即峰且入场市值>20.1 → secSinceMcapPeak>=0 恒真=过门即清——忠实口径非兜底；当前 ladder 入场市值普遍 <8 BNB 该形状罕见）；fire→成交窗冲高回填使峰时刻可早于 buyTime → max(0,·)=0 同归 X=0；事故形状反证=持有前峰 30+入场 15 → 持仓期峰 15 不过门**不再秒卖**。
- **单测** `_test_mcap_arc_exit.cjs` 重写 44 断言（A 未持仓 null／**B 事故形状反证（全生命峰 30 不泄漏进持仓期键）**／C 持仓期拱形 rise→half-time→fire+恰在线上含等／C6 持仓期峰不过门恒 false／D 再破高重置计时+X 变大／E 不新高峰值时刻不动／F outlier 幽灵峰不推+尘价新高推峰／G X=0 过门即清／H supply 缺失 fail-closed／I 清仓归 null+asOf 虚拟时钟差值精确+源码锁（发射式形状 `positionFactors.X ?? null`+旧全生命口径反证锁）／J FactorBuilder 快照透传+白名单源码锁／K 探针收键+条件四态）；关联 9 件单测全绿（fa_factors/cheat_detection_service/cheat_grade/signal_gate_engine/stop_loss_rules/stall_close/sell_debounce/sell_leg_scan/graduation_sell）。
- **对照回测 bt-v91**（`94c89601-427b-42b1-8828-9c6d47d05f9b`「bt-v91-完整窗口-cheat每信号重判-拱臂持仓期化」，克隆 bt-v90 同窗 2026-11-05 00:00~13:45:10 同配置 ladder v14，**三变量叠加**：①CD388 ultra∧cheat 不豁免（0fbc3c88，bt-v90 跑于其前未含）②本案拱臂持仓期化③CD389 gate.alwaysRecheck=true（唯一 config 变量——cheat 门拉黑/粘滞/bootstrap 秒回全绕每买信号真调 Jev，跑时长预计数小时）；基线 bt-v90 净 +0.6126/65 成交）——**结果见本案续段（跑毕补录）**。

**bt-v91 读数（2026-11-09 跑毕，07:49 UTC completed）**：净 **+0.9039 / 62 成交（17 正 45 负，27.4%）** vs 基线 +0.6126/65（15 正 50 负，23.1%）——净额 +0.2913（+47.6%）、胜率 +4.3pp。差异票 Δ 合计 +0.2848（消失 11/新成交 8/双侧 7）。
- **本案（拱臂持仓期化）专属验证**：<30s 卖 9 笔 → 4 笔，**消失的 5 笔全部 P10（拱臂）负收益秒卖**——苍蝇 hold=4s prof=-14.9%（事故原案：买点对 10min 后毕业 ~9x、卖在 4s 局部底）、SI 4s -13.3%、Dawn 10s -15.5%、Stockless 17s -8.6%、4 23s -7.0%；P7/P9 快腿止盈（+64.5%~+197%）零影响；持有中位 87→89s；P10 总触发 20→15；流动性止损 51→55 次（持有变长副产品，断流票等待拱臂归 stallClose 管=设计内）。
- 三变量合成读数（拆分归因见 CD388/CD389 案）：豁免矩阵 ultra|cheat 格子 20 票 -0.395 → **消失**（CD388 拦截）；非豁免 healthy 直过 7 票 -0.068 → 11 票 **+0.416**（重判翻案贡献）；唯一显著正票损失=谷谷 +0.1592 未买（v91 拦截面内）；high|unhealthy 格子 19 票 +0.122 → 21 票 -0.368（重判后更多票落 unhealthy 豁免且买亏——豁免域内部结构变化，挂账 CD379×门链联合校准）。

### T116 GMGN 进场验证卖臂：持仓 180s 无聪明钱/鲸鱼/KOL 在场全清 + 买点观察帧（新机制 GmgnEntryCheckService + FA 五键 + 引擎扫描，默认关；2026-11-04 落码 / 2026-11-05 v72 接线+买点观察帧；用户指令「我还想再增加一个卖出臂，就是如果持仓3分钟，调用一下 GMGN API，无聪明钱/鲸鱼/KOL 进场，就全部卖出。你觉得合适吗？感觉不好分析，可以先帮我做一下实现。」+「V72 买入的时候，GMGN API 也需要调用一次，只进行辅助数据观察，暂时先不设置条件」）

- **可行性探针（落码前置，2026-11-04 `scripts/tmp-gmgn-entry-probe.cjs` 六票 0.3-1.0min）**：GMGN `getTokenInfo` 的 `wallet_tags_stat` 对分钟级票**已完整填充**（0.3min=18 秒票 tags/holders 全在动）——索引近乎实时，**无「数据滞后退化成 3 分钟无脑全清」风险**；`whale_wallets` 字段在原始响应里（extractGmgnRisk 未提取，本侧自提），三类 `smart_wallets`（聪明钱）/`whale_wallets`（鲸鱼）/`renowned_wallets`（KOL）**一次调用全覆盖**，零额外配额（=买侧 GmgnRiskCheckService 同款 getTokenInfo，per 持仓轮恰一次）
- **「在场口径」论证（holders-stat ≠ 进场过，但殊途同归）**：GMGN tags 统计的是**当前在场**标签钱包数——聪明钱 3min 内进出后离场 → 计 0 → 卖，而「聪明钱已经跑路」的票本来也是该卖的形状；三类任一 >0=entered 留仓。top_traders+tag 过滤口径（真「进场过」）每票多烧 2 调用且「进过已走」形状同样该卖，弃
- **机制形状（C166 AccountHealthMonitor 母版）**：`fourmemeWs.gmgnEntryCheck {enabled（**默认关 enabled===true 物化**）/holdSec 180/scanIntervalSec 10/retryIntervalSec 30/timeoutMs 8000/failCooldownMs 60000}`（flap 经 _mergedWsConfig 同键；default.json 段已入）；引擎 10s 扫描 → `realHoldDuration ≥ holdSec`（成交时刻起算，断流期继续走=断流票到点照查）→ Service 检查**恰一次**（write-once per 持仓轮——「3 分钟无人进场」单向判定不随盘面滚动翻案）→ FA 五键投影 `gmgnEntryChecked`（1=检查完成）/`gmgnEntryPresent`（1=三类任一在场/0=全零/null=未确定）+ 三类计数观测键（gmgnEntrySmart/Whale/RenownedWallets）
- **fail-open（与买侧 2026-10-20 GMGN 裁定同向）**：失败/超时/未索引/key 缺失/冷却/**tags 三键任一非有限数（tags_malformed——缺失键当 0=「查不到当零进场」误卖方向，宁可不判定）** → state='unknown' 引擎**不投影**（因子 null → 卖臂条件恒 false 不误卖），retryIntervalSec 30s 后重试；inflight join+失败冷却 60s（GmgnRiskCheckService 同款组织，但无 TTL 复用——per 持仓轮 write-once 无重复调用语义）
- **卖臂条件形状（建议，v72 未接线待裁定）**：`realHoldDuration >= 180 AND gmgnEntryChecked == 1 AND gmgnEntryPresent == 0`，cards='all' 全清（priority 建议 6：T113 p5 失衡之后收益族之前），bypass=false 走 3.5s+5tick 双门——活跃票 5 真笔秒级确认；断流票凑不齐证靠 maxWait 120s 逃生链重评仍真卖出
- **生命周期**：清仓自清理（扫描轮全量比对）+ 再买入重置（策略买/手工买两处 `_resetGmgnEntryFor` 双保险，防 sold→rebuy 残留 'none' 首tick误卖）+ stop 逐 token 清；回填竞态防线=st 实例同一性校验（narrative identity 同款，防重置后旧结果冒充新轮）
- **回测零接线**（BacktestEngine 无本链路，因子恒 null 条件恒 false——动态网络数据对历史 fire 时序穿越，accountHealthCheck/gwp 同款裁定）
- **单测**：`_test_gmgn_entry_check.cjs` 39 断言（A 三态判定+残缺反证/inflight/冷却/无 key；B 五键投影+getFactorKeys 探针收键+条件实评 fail-open 方向；C 扫描 write-once/重试节流/自清理/竞态/重置/卖中跳过；D 源码口径九条）；受影响回归 account_recheck_engine/signal_metadata_cache/stop_loss_rules/sell_debounce_mechanisms 全绿（18+56+69+86）
- **适配性意见（用户问「你觉得合适吗」）**：合适——与 T113 失衡全清/stallClose 同族「入场后盘面质量保险丝」，且探针证实数据源可靠；边界留观：①3min 检查点后聪明钱才进场的票会被误卖（固有代价，换「无人接力早离场」的截断收益，T115 同逻辑：晚到的信号质量差）②极小盘 top_wallets 个位数时三类恒 0 属常态（分母噪声）——好票本来就少人接，方向可接受；首版先跑观察 grade/触发频率再调 holdSec
- **T116b 买点观察帧（2026-11-05 用户指令，追加）**：买入成功点（策略买+手工买双挂点 `_recordGmgnEntryBuyObs`）fire-and-forget 查一次三类在场数，结果（含 unknown）落 **signal metadata `gmgnEntryObs`**（`_updateSignalMetadata` 缓存通道）——与 180s 检查点构成「买点 vs 3min」两帧对照，攒分布后再裁定是否进条件；**纯观察不进任何门**（用户「暂时先不设置条件」）；每笔成交恰一次调用（补买轮各记一帧）；调用频次裁定（用户确认问「是在3分钟的时候进行一次 GMGN 调用吗？其它时间不会调用吧？」——答：0~180s 零调用（扫描只读 FA 内存因子）、到点恰一次 write-once 终结、失败 unknown 才 30s 重试且 service 60s 冷却打网 ≤1 次/分/票、不到 180s 被清的仓零调用）；v72 买腿无 gmgnCheckCondition（T108 后）=买点此前零 GMGN 调用，本钩子为买点唯一一次
- **生效条件**：v72 config 加 `gmgnEntryCheck` 段+卖腿引用+进程重启（代码已 push，182 pull 后生效）

### T114 v71 卖臂大修剪：12 删 3 改 1 增（26→15 条）+ stallClose 30s 复活（2026-11-04，v71 `936e1bd9` 实验级 config 变更+重启生效，库未动；用户九点指令）

- **用户指令原文（九点）**：①「profitPercent <= -50 跟 profitPercent <= -35 矛盾了，改为 profitPercent <= -40 吧，原先两臂全部删除」②「反作弊不走推特检测了，"Rug 前兆臂" 可以删除」③「市值地板/死票清仓族（4 条，全部 P4）全部退役」④「超买止盈族 全部退役」⑤「T84 早期臂专属离场族 全部退役」⑥「增加一个断流卖出的卖出臂，断流30秒以上，全部卖出」⑦⑧「dd <= -25（<8.1 档与 8.1-27 档）最大执行次数改为4，冷却1分钟」⑨「dd <= -35 AND marketCap < 8.1 改为 dd <= -45 AND marketCap < 8.1」
- **删 12 条**：P0 `<= -50` 与 P2 `<= -35`（①合并）、P2 rug-exit-account-arm（②动机=v71 去叙事（v56b）后推特账号检测无输入， issuerAccountState 恒 null 腿恒 false 形同虚设；libraryRefs 同步删孤儿 ref）、P4 四条（③快跑 3.5-4K/底部等待 <3.5K/地板 5.5K（minTicks 10 覆盖随腿删）/死票 120s）、T85 `rsi>85` 与 T78 `(78,85]`（④）、T84 三条（⑤上位离场 27/protect20/600s）。**残余语义接管**：地板/死票族的「阴跌归零票截断」→ 拱形回撤三档+T107 时间维度+stallClose 30s（死票即断流）+时间止损 1h 兜底；超买减仓 → 收益阶梯 50%/100% + T99 -25 两档（max4 后可打光 4 卡=全清等效）接管
- **增 1 条（①合并臂）**：P2 `profitPercent <= -40` 全清，minTicks 8 继承原 -35 主止损确认门（T109b 全窗去重后=8 真笔），maxExecutions 不设（失败每轮重试），profitPercent null 恒 false fail-closed；断流冻结票归 stallClose 管
- **⑥实现选型=配 `stallClose:{stallMs:30000}` 段（T104 复活）而非卖腿形状**：卖腿走确认窗双门（minTicks 需新 tick 凑证——断流票零新 tick 永远凑不齐，只能 maxWait 120s 强制逃生）+ 卖腿兜底扫描断流判据 60s 起评+30s 周期，实际离场 ≥90-150s 且语义拧巴；stallClose=bypass 立即路径+1s 墙钟扫描+lockTokenAfterSell=false 放行再买，30s 语义精确成立（机制代码/单测全程留档，配段即生效——T104 退役时「配段即复活」设计兑现）
- **改 3 条**：⑦⑧ T99 两档 `dd<=-25`（<8.1/8.1-27）maxExecutions 1→4 + cooldownSec 60——原「max1 恰一次、dd 回升再落不重卖」语义退役，改为「持续/反复回撤每 60s 减 1 张、最多 4 张」（4 卡票可打光=减仓腿兼全清）；⑨ 拱形低档全清 -35→-45（低市值档噪声容忍回深，向 v2-A 模板原文「低市值档 -45」回归——原条件 -35 与模板描述 -45 不一致即本次纠正；中档 -35/高档 -25 不动）
- **改后 v71 15 条卖腿（priority 序）**：p1 时间止损 1h / p2 止损 -40（minTicks 8）/ p3 毕业① 0.9 卖2 / p5 T113 失衡全清 / p7 收益 >100% cd80 max2 / p8 毕业② 0.98 卖2 / p9 收益 >50% cd300 / p10 T107 拱形时间全清 / p10 T97 停滞减仓 cd60 max2 / p10 T80 锁盈 -15 cd300 / p11 T99 -25 低档 max4 cd60 / p11 T99 -25 中档 max4 cd60 / p11 拱形 -45 低档全清 / p11 拱形 -35 中档全清 / p11 拱形 -25 高档全清；+引擎级 stallClose 30s 断流全清
- **验证**：改动脚本 12 删除+3 修改目标 condition 等值断言各恰 1 命中+改后 15 条回读核对；15 条全过 loadStrategies 等价校验（parseCondition→validateCondition vs FA getFactorKeys 探针，零未知因子）；stallMs=30000 单测 `_test_stall_close.cjs` 既有形状覆盖（机制未改码，纯 config 数值）
- **生效条件**：须重启 v71 实验进程（182 现跑进程持旧 config 内存态）；库未动（12 删 3 改均为实验 config 快照本体；-40 合并臂是否升库 replacement 待形状稳定后裁定——同 T112「实验级调参先跑再固化」先例）

### T109 卖确认去抖 tick 去重 + 腿级 sellDebounce 覆盖段（SellConfirmDebouncer/FA emit/StrategyEngine/validateLegs/库页五处；2026-11-03 0x89e4…7777 flap 梗案诊断后用户指令「解决一下 touch 两次的问题吧。此外，能不能把 debounce 的条件放到卖出臂中，作为卖出臂的配置，这样，这个止损臂我可以再增加一些 ticks 的要求」）

- **事故现场（0x89e4 flap 梗，live `67803108`）**：P2 止损腿 `profitPercent <= -35` 首 true 16:53:28.5，3 真笔 true tick（16:53:28/32、16:54:08）后 fire 16:54:08.094——`sellDebounceMinTicks=5` 的证据门被 3 笔凑满，**实际证据稀释减半**
- **根因（touch 两次）**：FA 两阶段喂食下 `processTick`（价格段）与 `applyWalletTick`（wallet 段回推，EOA 快路 ~1ms 后）**各 emit 一次 factorsUpdated** → `_onFactorsUpdated` → 卖腿评估每笔链上 tick 跑两次 → 真条件时 touch 两次 ticksSeen 双计（3 笔 ×2 −首真 1 =5 恰好 fire）。回测单段喂食无此形状=虚拟↔回测证据口径分叉
- **修复①（tick 去重）**：`SellConfirmDebouncer.tickIdentity`=`txHash:logIndex`（实时 collector camelCase/回测 snake_case 双命名既定支持；FA 两处 emit 的精简 tick 补透传 `tx_hash/log_index`——emit 对象原本不含链上标识，修复前置）；同键重复 touch **零效应**（stats.deduped 计数）；**tick=null（扫描兜底快照评估）不再凑 ticksSeen**（旧实现 30s 扫描周期当证据凑数，违背 2026-10-16「窗后新 tick 数」裁定语义；仍可起 pending，maxWait 逃生链起点保留）；无链上键 tick 对象按独立证据计（存量兼容）
- **修复②（腿级 sellDebounce 段）**：卖腿可选 `sellDebounce: {minTicks, debounceMs, maxWaitMs}` 逐键覆盖引擎级缺省（fourmemeWs/flapWs `sellDebounce*`），缺省回落；**pending entry 首真起算时固化当时的腿门**（窗口内不同腿命中 touch 不改门，防优先级竞争下门参数抖动；fire 重评命中另一腿不读门）；`_tryFire/advance` 全改读 entry 级参数；debounceMs=0 腿级=即时卖（bypass 同效）。实时/回测两引擎同构（回测构造补存 MinTicks/MaxWaitMs 实例字段对齐 `_applyWsConfig`）
- **校验链（buyPhase T100 同款 fail-fast）**：`normalizeSellDebounce`（StrategyEngine 模块函数单一真相源，值域 minTicks 整数 0-1000/两时长 0-600000ms、键白名单、空段{}=null 等价未配）→ loadStrategies 非法 throw 拒启 + 非卖腿携带 throw ↔ `validateLegs` 400 共享同函数防双路径漂移；库页卖腿表单折叠区三输入（空=不覆盖）+ 列表 bits 展示 `卖确认≥Ntick`
- **行为变化说明（存量实验无 sellDebounce 字段=腿级零变化；tick 去重对存量是收紧）**：同笔 tick 不再双计 → minTicks=5 的实质门槛从 ~3 笔恢复为设计意图的 5 笔——这正是修复目的
- **单测**：`_test_sell_debounce_mechanisms.cjs` 41→75 断言（新增六段：事故现场反证 3 笔×双投递凑不满 5 不 fire/snake_case 去重/聚合交易同 tx 不同 logIndex 各计/null tick 扫描不凑证据/腿级四参数覆盖+固化+缺省回落/装载校验六拒启形状+validateLegs 同口径）；受影响存量 sell_leg_scan_fallback/stop_loss_rules/graduation_sell_and_anchor/card_position/buy_phase_routing/validate_legs/fa_deferred_wallet_feeding 等 14 件全绿
- **生效条件**：须重启实验进程（v68 PID 2072229@182 现跑旧代码）；**P2 止损臂已应用腿级覆盖（2026-11-03 追记，用户拍板 minTicks=8）**：实验 `67803108` config 卖腿 `profitPercent <= -35` 加 `sellDebounce:{minTicks:8}`（DB 单行更新+validateLegs 单腿校验+回读断言腿数 25 不变；**该腿不在策略库**——库 sell 侧仅 3 条无一含此条件，改的是实验 config 快照本体；rug-exit 的另一条 P2 腿 issuerAccountState 未误伤）；UI 同批=创建页只读卡逐键徽章（卖确认≥Ntick/确认窗ms/确认帽ms）+库引用浮层 bits+实验详情页三徽章（experiment_detail.js ?v=5.2→5.3）。效果=-35 止损臂须 **8 真笔** true tick 确认（去重后口径，debounceMs/maxWaitMs 回落引擎级 3500ms/120s），其余卖腿维持引擎级 minTicks=5；**P4 市值地板卖臂已应用腿级覆盖（2026-11-03 再追记，用户裁定 5→10）**：0x5694…7777（Mamesuke flap）卖飞案诊断后用户指令「这一腿的 debounce 也多加一些 ticks 数量吧，从 5 改为 10」——实验 `67803108` config 卖腿 idx19 `marketCap > 0 AND marketCap < 7.4 AND realHoldDuration > 16 AND (entryMarketCap >= 7.4 OR realHoldDuration > 1800)` 加 `sellDebounce:{minTicks:10}`（DB 单行更新+validateLegs 单腿校验+回读断言腿数 25/P2 腿 minTicks=8 未碰/带覆盖腿恰 2）。**语义提示**：0x5694 案 fire 时间线（首 true 16:56:44→第 5 真笔 16:57:01 fire，盘面薄凑证 16.8s）——minTicks=10 在薄盘上凑证可能拖到 **maxWaitMs=120s 强制逃生窗**（fire 仍重评，翻假不卖）：地板臂对薄盘票的实效≈首 true 后 ≤120s 离场（证据先齐则更早），比旧 5 笔口径显著更钝，方向=让渡 V 反谷底离场换确认厚度，与用户意图一致；该腿同样不在策略库（实验 config 快照本体）
- **残留渗漏发现（2026-11-04 0x1cffe…7777 币圈首富案，v69 `8a51f2fd`，用户问「debounce 生效了吗」）**：P4 地板臂（minTicks=10 同款 idx19 腿）02:10:16.118 fire（日志「卖出策略 P4（去抖确认后）」）——**机制生效面**：①确认窗+恢复清除生效：第一窗 02:09:45 首真（mcap 7.386<7.4）→ 02:09:47 回升 7.406 条件翻假 pending clear 没卖（mcap 随后回弹 8.85=假破位，恢复清除按设计防住）②时间窗满足（第二窗 arm≈02:10:11 → fire ~4.7s ≥3.5s）③fire 走去抖确认路径且重评因子 marketCap=6.8846<7.4 仍真。**缺陷=T109 相邻去重挡不住 defer 交错回推**：第二窗 arm（blk131542453 li58 7.3248）→ fire 期间链上真序 true tick 仅 6 笔（blk453 li58/blk454 li50 7.0798/blk459 li59 7.0111/blk461 li113 7.2229+li138 6.9736/blk463 li51 6.8846）——arm 首真不自计，价格段证据最多 5 份 <10 → **≥5 份证据只能来自 wallet 段回推 touch**（SenderResolver 首见钱包 cache miss → RPC 回查 1-3s 乱序回推，applyWalletTick emit 的 tick 携带旧 tick 的 `txHash:logIndex`）。实锤=fire 时刻因子 marketCap=6.8846=li51 价而下一笔价格 tick li114（7.0938）在 fire 之后——触发 fire 的是回推 touch（或 li51 价格 touch 但计数已被回推撑满）。根因：`tickIdentity` 去重只挡**相邻同 key**（`key === existing.lastTickKey`），交错序（A价,B价,A钱包,B钱包）每步 key≠lastTickKey 全部计证据 → **证据门实质 ≈ minTicks/2**（0x89e4 原案恰是 EOA 快路同 tick 背靠背双投递=相邻形状所以奏效；首见钱包——meme 盘狙击一次性钱包高占比——恰是 cache miss 乱序回推主人群）。语义注意：回推 touch 评估时 state 价格=最新价（applyWalletTick factors 从 state 构建），**条件判定不被旧价污染，污染的只有证据计数**。影响：现行 P2 minTicks=8 实质≈4-5 真笔、P4 minTicks=10 实质≈5-6 真笔即 fire；本笔 fire 价 6.8846、成交 −21.33%，后续链上价回升（li114 7.0938/02:10:20 7.234）——不渗漏口径 fire 更晚可能卖在略高价。**候选修复（待用户裁定，未落码）**：pending entry 维护 seenKey Set（有界 ≤minTicks+1），key 已在 Set=零效应；落码须配交错回推形状反证单测（A价,B价,A钱包,B钱包 序列恰计 2 证据）
- **修复③（T109b，2026-11-04 同日用户拍板「修吧」落码）**：去重键从相邻单值 `lastTickKey` 升级为 **entry 级 `seenKeys` Set 全窗去重**——arm 首真 key 预占 Set（arm 自身 wallet 段回推零效应），touch 时 key 已在 Set=零效应（stats.deduped）；**有界 ≤minTicks+1**（封顶时点=证据门已满足 ticksSeen≥minTicks，此后记不记录零行为差异——ticksOk 单调为真，封顶后重复 key 不拦截=文档化无害，省薄盘长窗内存）。语义后果：minTicks 恢复设计意图真笔数（P2=8 恢复 8 真笔、P4=10 恢复 10 真笔）——薄盘票确认窗实质变厚，可能拖到 maxWait=120s 强制逃生（fire 仍重评翻假不卖），与 T109 修复初衷一致。单测 `_test_sell_debounce_mechanisms.cjs` 75→86 断言（T109b 新段：0x1cffe 现场缩形 6 真笔×12 交错投递（含 arm 回推、同 tx 双 logIndex）恰攒 5 证据不 fire=旧相邻去重 11 凑满提前 fire 反证/Set 有界 30 key 封顶 4 且计数照计/封顶后重复不再拦截/arm key 预占回推零效应）；相邻回归 sell_leg_scan_fallback/stop_loss_rules/graduation_sell_and_anchor/card_position/buy_phase_routing/validate_legs/fa_deferred_wallet_feeding/backtest_trigger_leg/run_engine_graceful_stop 九件全绿。生效条件=重启实验进程（v70 现跑旧代码）

### T104 流动性止损 stallClose：持仓票无成交 >10s 全部清仓（引擎级机制 `stallClose` 段，v63 起实跑；2026-10-29 用户提案「如果发现有10秒钟没有交易，全部清仓」→ 看完回放裁定「可以，上吧。二次起飞的看看再买臂能不能捕捉到，我想如果一个票没流动性了，就是要赶紧跑。」）

- **动机**：meme 币断流=庄撤/池死的先导信号，持仓滞留死票占用资金且终局多为阴跌归零；现行栈只有 P4 120s 死票清仓（mcap<4.5K 才触）与断流卖腿兜底扫描（>60s 无 tick 才评卖腿、还得过确认窗）——都偏晚
- **回放定标（`scripts/tmp-stall10s-close-analysis.cjs` + `-sweep.cjs`，182 跑，近 8 天 199 live round，tick 级反事实；触发口径=持仓中距上一笔链上成交（wss_price_ticks，含 outlier 行）>10s，买入时空窗已 ≥10s=即买即触发）**：
  - **10s 档**：触发 131/199 round（66%）；**净 Δ +0.0773 BNB/8d**（实际 −0.0684 → 模拟 +0.0089）；改善 111 round（Σ+0.1185）/代价 20 round（Σ−0.0412）
  - **代价面（大票）**：峰值 ≥100% 的 34 round 被截 16、利润被砍 11——大票利润 0.110→0.087 BNB（**−21%**）
  - **阈值扫描 10/15/20/30/45/60s**：10s 净Δ最大但大票损失也最大；60s 大票捕获反而 +0.0017（与断流判据 60s 同口径）——净Δ与右尾保全是单调度交换，**用户拍板取 10s**（目标函数=资金周转快跑）
  - **信号本质**：10s 空窗本身非预测信号——触发后恢复交易的 round 中 44% 恢复价更高，p50=−0.3%；价值=截断左尾（死票不拖）+资金周转，非择时
- **再买臂接回面（`scripts/tmp-stall-close-repeat-recapture.cjs`，用户第二问「二次起飞的看看再买臂能不能捕捉到」）**：触发后再涨 ≥30% 的 37 round 里——**可接回仅 6**（落 T103 腰斩区间 (−70,−40) ∧ T96 净买双窗过 ∧ 近似门过；含派大星 接回后 +410%）；**24 个落过腰斩区间但净买双窗从未过**（跌 40% 时短期窗必是砸盘净卖=T96 结构性时点错配，等净买转正时价格多已离开区间）；**7 个从未跌进区间**（V 型不回头：OST +739%、小航 +710%、佩狗 +350% 等，永失）——结论：stall-close 与再买臂衔接存在结构性缝隙，属已知接受面（T103 放宽到 −40 已把缝隙收窄一档）
- **机制（引擎级，对齐 stopLoss 家族——非卖腿、非库条目）**：实验 config `stallClose: { stallMs: 10000 }`，不配=机制关闭（存量实验零变化）；判据=FA `lastTickAt`（进程内 tick 时戳，非尘 tick 口径——尘 tick 不推进 lastTickAt）距 now **> stallMs**（严格大于）；触发→`_emitSellSignal` 全清链（cards='all'/sellPercentage=1）+ **bypassDebounce=true 立即路径**（空窗期零 tick，卖确认窗 3.5s+5tick 双门的 tick 证据永远凑不齐——bypass 是机制成立前提）+ **lockTokenAfterSell=false**（清仓≠拉黑，放行再买臂接回）；strategy id='stallClose' 命名档位随 stallMs
- **挂点两态**：实时=`_runMainLoop` 1s 墙钟 setInterval（`Math.min(1000, stallMs)`；tick 驱动路径在空窗期全部沉默，墙钟是唯一活体）；回测=主循环 **processTick 之前**虚拟时钟 1s 节流扫描（feed 后 lastTickAt 已推进会漏检自己的空窗——顺序红线）；**因子 asOf=lastTickAt+stallMs（检测时点 parity）**：实时检测刻=空窗满 10s 的下一扫描拍、回测=同刻虚拟时钟，价格冻结在空窗前末 tick 两侧同价
- **守卫族**：selling/buying 执行中跳过（不重入）；token.status!=='bought' 跳过；`lastTickAt` 缺失（重启恢复初期）fail-open 不卖；`buildFactorMap` null（prune 后）跳过；`_stallCloseMs=null` 自守卫 no-op（不依赖调用方门）
- **单测**：`scripts/_test_stall_close.cjs`（零 DB 零网络，22 断言）——A 实时扫描八形状（超时/窗内/恰等阈值 `>` 语义/lastTickAt 缺失/执行中/sold/build null/未配置）+ B strategy 构造（cards='all'/sellPercentage=1/bypass/lockTokenAfterSell=false/tick=null）+ C 回测（★asOf=lastTickAt+stallMs 非 nowTs 断言=检测时点 parity 红线）；相邻回归 stop_loss_rules 69 / sell_leg_scan_fallback 21 / run_engine_graceful_stop 24 / backtest_trigger_leg 12 / graduation_sell_and_anchor 49 / card_position_mechanisms 28 全过
- **部署链**：create-v63.cjs（克隆 v61 `5298b7bd`，T103 再买腿 v2→v3 + 注入 `stallClose={stallMs:10000}` + **撤 T102 momentum 臂（4 买腿→3，同批第三变量，用户同日指令）**；防呆=源无 stallClose 段+新实验恰 10s 档+momentum 腿恰移除+T103 全套锚定承继；refs 防呆二次修复=动态计数+rug-exit 锚定，59c87e1）→ **v63 `daf868b7` 已上线（2026-10-29 13:23:52 UTC PID 2619969：27 腿=3 买+24 卖装载全对/momentum 已不在、「🛡️ 流动性止损已启用」行在、ERROR=0、双 collector 各 2 订阅确认；源 v61 13:22:49 UTC TERM 优雅停、45 trades 15 token 净额全 0 零持仓换车）**
- **观察点**：①触发频率与触发时点距买点分布（即买即触发占比=买腿门放进死票的信号）②触发后 30min 票价走势（截断左尾实证）③大票被截面（−21% 代价的实跑复现）④再买臂接回实际成交（回放预测 6/37 形状）⑤与 P4 120s 死票清仓/断流兜底扫描的分工重叠（stall 10s 先触后两者基本退化为冗余层）⑥停机窗口期（换车时）在持票的 stall 计时重启归零语义（进程内存态，接受）

### T97 高点停滞减仓臂 secSincePeak（FA 新键 + 卖腿 `peakProfitPct >= 10 AND secSincePeak > 60` 卖 1 卡 cd60 maxExecutions=2；2026-10-29 用户提案+拍板；v56 `4ac10e23` 已上线）

- **动机（用户原话）**：「止损臂触发的太多，往往导致盈利流失，卖在了低点」——盈转亏票（曾冲高 +20% 终局 ≤0）在拱形/止损全清臂以低点价整仓认赔；在**时间停滞**早段先减仓锁盈，余仓留给现行栈
- **载体（FA 新键 `secSincePeak`）**：`(now − pos.highestPriceSinceBuyAt)/1000`——距持仓期峰值秒数，创新高归零重计。**峰推进=任意接受价轨（priceAccepted 块）与武装门 peakProfitPct 的可靠价轨（尘门 0.002+outlier）分轨**：outlier（>1000× 中位数判）不推峰；尘 tick 不卡尘门——尘价新高可重置计时但不可武装（单测 F 组分轨反证）；now=buildFactorMap 入参禁 Date.now（回测=虚拟时钟同源）；无持仓/无峰 → null，`> 60` 恒 false fail-closed；FactorBuilder 快照白名单透传（不落库即丢）；getFactorKeys 探针自动收键（三防线认得）
- **定标（`scripts/tmp-since-high-arm-scan.cjs`，182 跑，5 天 16 live 实验 113 episode 反事实回放；FA 口径 tick + 3.5s+5tick 双门状态机；Δ=Σ_fires[qtyPerCard×firePrice − 实际每卡所得]）**：
  - **N=60 统一窗最优 +0.0109 BNB**（90s=+0.0074 稳健档；用户「先定 60」拍板）；maxFires=2 峰值（3 张 +0.0089/1 张 +0.0069）；peak≥10 优于 20/30
  - **盈转亏子集（峰≥+20% 终局≤0，n=29）Δ+0.0107≈全量收益**——结构干净：收益全部来自痛点票
  - **双阈值（首张 N1 短+第 2+ 张 N2 长窗 120-300）全面差于统一 60s**——崩盘票等确认的落袋损失 > 火箭误杀节省（用户提案「一长一短配合」被数据否证）；**profitGate>0 反而 -0.0024**——主力贡献在跌回成本线下仍未收复段
  - 误杀面=二次腾飞火箭（佩狗 99c106e8 峰+263% 终+502% Δ-0.0022、创业时代 71f87b50 Δ-0.0020、OST cf3d8177 Δ-0.0015，合计≈-0.0072）
  - Caveat：单周偏跌 regime，「N 越短越好」可能部分是行情特性；回放口径偏差（一阶近似）：锚=入场后首接受价（FA 真实=fire 价）、尘 tick 扫描全跳 vs 引擎峰轨不卡尘门（重置方向=保守）
- **与 T80 的双层梯队**：同 priority 10、数组序 T97 在前=同 tick 双真先评——T97 打**时间停滞**（峰后 60s 未创新高即减仓，无需回撤幅度）；T80 打**幅度回撤**（dd≤-15）。T97 fire 后 60s 冷却中 T80 可顶上（StrategyEngine 每 tick 单腿 fire+冷却跳过低优先级顶上语义）。打点在盈转亏主通道 P13（`peak>=20 AND profit<=0` 全清）之前
- **落地**：代码 9fa07aa（FA 发射+快照+单测 `_test_sec_since_peak.cjs` 25 断言全过+create-v55.cjs）；v55=克隆 v54 `0007ff5a` 21→22 卖腿插 T80 前，买腿 T96 形状/库 49/9/其余 config 逐字不动（防呆锁定）；**已知口径差异**：扫描 maxFires=min(2,nCards−1) 保 1 卡，引擎 maxExecutions=2 不保——2-3 卡票（部分成交少数形状）停滞可全清，接受
- **上线**（2026-10-29 04:05:32 UTC，v56 `4ac10e23-83a7-4177-80f1-c3e7ed3bdddd`，PID 2285542，代码=182 HEAD fa6058d）：用户批准「上吧（本事件中途上了其它改进，所以请不要覆盖了哈）」。中途改进=T98 剔尘埃人气键先行完成 v54→v55 换车（v55 `7ab210a5` 03:49 UTC 起跑仅 ~16min）；本案重建 create-v56（fa6058d）克隆 v55/T98 快照+插 T97 腿（idx 12、T80 顺移 13），买腿 holdersExDust 双腿/库 refs v50/v10/rug-exit:1/其余 21 卖腿逐字不动=不覆盖。停 v55（SIGTERM ~5s 优雅停「引擎已停止」）→ 建 v56 → 起跑，停机窗口 <2min。验证：22 卖腿零拒启、**T97 启用行「P10: 卖出 ×2 | 优先级:10 | 1卡 | 冷却60s」**、T80「P10 冷却300s」共存、ERROR=0、双 WSS（FlapPortalTrader 连接成功）、famous roster 3 个（7749c39 同 pull 生效）。**停机持仓遗留（弃管先例 v52 同款）**：v55 币安圣子 2×0.006 BNB（04:03 R1 rating=3 触发 2 笔买入，停机在持）+ v54 遗留握手小猫 0.006 BNB——均不再被引擎监控，可手动处置。**追注（同日早）**：v55 编号被 T98 占用的撞号史见上文速览行
- **观察点**：①触发频率与 fire 时点的 secSincePeak/profitPct 分布（是否打在「横盘阴跌未触 -15」预期域）②被减仓票余仓终局（减仓保余仓是否换回）③二次腾飞误杀面（佩狗形状复现频率）④与 T80/P9 同冷却域互不抢 ⑤60s 冷却内新高的归零重计形状（fire 前刻回弹救回比例）

### T80 回撤锁盈减仓臂·中档 -15（2026-10-28 用户指令；v44 `5be4c248-1fe3-423f-a26e-9383ae76e451` 已上线）
- **指令**：「增加 `peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -15 AND marketCap >= 6000 AND marketCap < 20000` 卖臂，冷却时间5分钟」——市值区间与拱形中档 -35 全清腿完全相同，回撤容忍收紧到 -15 且带 5min 冷却
- **形状**：cards=**1**（逐卡减仓）/ priority=**10**（空位，先于拱形族 11 评估）/ cooldownSec=**300** / maxExecutions 刻意不设（冷却即节奏上限，P9 同款）/ bypass=false 走 3.5s+5tick 双门；peakProfitPct=fire 价起算 running max（拱形臂同源）；dd null（未武装/无峰）→ 恒 false fail-closed；marketCap=fire 时刻实时市值（刻意非 peakMarketCapSinceLastBuy）
- **cards=1 是推断非指令原文**：用户未说明卖量；带「冷却」的现役腿仅 P7/P9 两条且均为逐卡减仓节奏臂，而全清臂（cards='all'）全部 cooldownSec=null——全清成功后持仓即零冷却冗余，且与「卖出失败每轮重试直到清仓」惯例冲突 → 取 P9 同款逐卡减仓。**若意图为全清，改本腿 cards 即可**（v44 零数据行零风险）
- **与拱形中档 -35 的梯队语义**：同区间两臂并存——-15 先评（10<11）卖 1 卡锁盈保 V 反余仓；持续满足每 5min 逐张减仓；深跌穿 -35 由全清臂兜底认赔。-35 腿从「中档唯一回撤出口」变「减仓后深跌层」（7cat 案 V 反保护初衷余留：-35 前的震荡只丢 1 卡）
- **落地**：v44 克隆 v43（T79 换代同款流程）——17→18 卖腿（新腿插 P9 后/拱形三档前），buy-v2 v41 引用/perCardBNB 0.002/钱包均不动；validateLegs 单腿通过；18 腿整包在库校验器下 4 条**存量**腿报 cards 形状警告（`"1"` 字符串，v43 同形状在跑=引擎侧兼容的既有宽松差，非本次引入、未顺手改）
- **上线**（2026-10-28 02:30:03 UTC，PID 1326761，代码=182 HEAD f6d34a9）：停机前持仓三查全零——①trades 减账 6 平 1「开」（普通人 `0x934b16d6…7777` 净余 17,936 枚=DB 记账口径差异）②**链上 balanceOf 终裁 2.5e-11=零持仓**；v43 SIGTERM ~5s 优雅停零丢行（ticksWritten==ticksBuffered 5135/5135+76817/76817）；v44 起跑 19 策略零拒启，**新腿日志行「P10: 卖出 | 优先级:10 | 1卡 | 冷却300s」**，拱形 P11×3 与 P9 冷却腿共存；live 持仓恢复 0 代币；flap 回放缺口 589 条停机窗口自动补齐；停机窗口 ~4min
- **修订**（2026-10-28 03:06 UTC 用户指令「改成 … marketCap >= 10000 AND marketCap < 20000」，上线 ~35min 后）：市值下限 6K→10K——中档 6K-10K 段回落到只走拱形 -35 全清（无 -15 减仓层），触发域收窄到中高段；改 config 后同实验 kill+setsid 重启生效（PID 1351348），零成交零持仓直接重启免清仓，19 策略零拒启、新 condition 进启动 config 日志（旧 6000 形状零残留）
- **观察点**：①触发后 V 反回升票的余仓收益（减仓保余仓是否换回）②与 P9（同 5min 冷却、profitPercent>50 域）互不抢——peak>10 武装且回落 +2% 时 profitPercent 大概率 <50，两臂条件域近不重叠 ③dd<=-15 持续满足的连环减仓节奏（4 卡票最坏 5min×3 卖光）是否需要 maxExecutions 帽

### T79 市值地板卖臂 5500 全类目泛化——反事实四方案对拍（2026-10-27 用户裁定；v43 `7dd26b85` 备好待启动）
- **用户假设**：「买入的票，做的假设是强势票。如果假设不成立，就需要立即止损，当前的止损点还是有点低了，一旦亏损就会比较大。但可能导致好票提前卖」→ 地板全清臂（明确走标准 debounce 双门，不 bypass）+ 追问「冻结 10 秒持仓时间会不会防止好票误伤」
- **方法**（`scripts/mcap-floor-sell-replay.cjs`，182 跑）：近 5 天 10 个 live 实验全部 **83 持仓 episode**（含 open 双侧盯市；弃买=0 无截断偏差）；FA 口径 tick 回放（接受价：尘 tick 不喂/outlier 不推价 × bnbUsd 前向填充 × totalSupply token_create 终态；fdv 对拍 0.85-1.2 验证）；fire 状态机全语义（3500ms+5tick 双门首真起计不重置/翻假 clear/120s maxWait 强制逃生）；fire 时刻余量强平、fire 后实际交易丢弃；冻结=入场 N ms 内条件恒 false（=realHoldDuration>N 门）
- **四方案**（Δ 合计 BNB，83 episode 对齐）：
  - 5000 无冻结：**+0.0113** 零误杀（割针底 3 桶合计仅 -0.00034；10 实验全正 Δ）
  - 5000+冻结10s：+0.0083——**比无冻结纯亏 -0.003**（崩塌票头 10s 价差最大：ZECsy 改善翻割针底、火箭云 4997→4351 才卖）；低线零误杀时冻结=纯推迟代价
  - 5500 无冻结：+0.0067 误杀 3（松弛蛙入口 5817 回踩 5355=-8% 即被割、Δ-0.0087 本窗口第二大赢家；胜率 26→23）
  - **5500+冻结10s：+0.0161 全场最优**——误杀 3→1（初一 7.8s 触发被救、松弛蛙 10.0s 边界被救、富途牛牛 16.5s 站住后破线的 V 反救不了且卖价更低）；胜率 26→28/83
- **收益折算**：+0.0161 BNB（÷0.336 总投入=83 笔×0.004）→ 5 天回合收益 **3.8%→8.6% ×2.2**；不改变买入频率与本金占用，纯截亏损。结构证据：触发票平均终局 **-29%/票 vs 未触发 +73%**（5K 线本窗口完美分隔强弱）；debounce 成交价中位=阈值×0.90（P10 -27%）；冻结只救「入场头 10s 内破线」的误杀（防误杀第一杠杆=线高，冻结=第二杠杆只对高线有意义）；20s+ 更长冻结无案例支撑不采
- **落地形状**＝泛化现行 P4 类似腿（去分类限定）：`(project OR web3) AND marketCap>0 AND <5500 AND realHoldDuration>10` → `marketCap > 0 AND marketCap < 5500 AND realHoldDuration > 10`（cards=all/bypass=false 不变）——模拟臂恰=该腿全类目形状，+0.0161 是叠在现行栈（#14 已覆盖 project/web3）上的纯增量。**冗余说明**：卖腿 #2（3500-4000/>10s）与 #3（<3500/>120s）被泛化腿完全蕴含变死代码，留存无害不删（最小改动）。买门 marketCap>3500 与臂交叠（入口<5K 票被秒卖）已在模拟覆盖内，买门不动
- **Caveat**：单周单 regime 样本（5K 完美分隔可能是行情特性）；5500+冻结 vs 5000 无冻结差距 +0.005 中 ~+0.002 是路径噪声（橘祥/火箭云/BPC fire 价碰巧更高）；反事实=tick 价无滑点（0.004 小单影响可忽略且 debounce 回落价已按保守方向计入）
- **上线**（2026-10-27 14:55 UTC）：v42 零持仓优雅停（咯咯慈善/罗小黑战记已自行清仓）→ v43 `7dd26b85-16ac-43dd-a4f7-98840198cebf` 起跑（182 PID 938474，双 WSS 连接/零 ERROR/零拒启）；同批裁定 **perCardBNB 0.001→0.002 ×2**（单票买入 0.004→0.008，v43 config 内）；182 叙事 worker 同日重启至 b6ab961。**观察点**：触发后 30min 内回到 5.5K 以上的票数（误杀探测器）；下周可再对拍验证 5500+冻结 vs 5000 无冻结排序稳健性
- **追裁定（2026-10-28）：冻结 10→16s**（用户指令 `realHoldDuration>10`→`>16`，原 USD 5500 形状随 T84 已是 BNB 域 7.4）；v46 `6581c288` 实验行改定（改行脚本 182 `scripts/tmp-update-v46-t79-16s.cjs`，子串恰一次断言/库侧无同条件条目防漏），07:26 UTC 重启生效（PID 1520024，23 策略零拒启/停机持仓复核 2 trades 全平/0 ERROR）。现行形状：`marketCap > 0 AND marketCap < 7.4 AND realHoldDuration > 16 AND (entryMarketCap >= 7.4 OR realHoldDuration > 1800)`——地板 7.4 与 T84 豁免臂不动，只改冻结；P4 清仓带的 10s 缓冲刻意不动

### T65 卖臂阈值错开矩阵+holders 档位——不立 syb/top1 卖门（2026-10-25，v37 ca8f9493+v36 cf3d8177 成交票反事实回放）
- 缘起：「sybil≥35 / top1≥35 / holders≤N 卖点阈值不能跟买点一样，否则容易被震下去」→ 21 臂更宽阈值矩阵（syb 50/70/90、top1 50/65/80、×3tick 持续确认、syb≥50∧h<0.6h0 双因子、h≤2..6 档位）
- **绝对阈值臂全灭**：阈值拉多宽都救不回——松弛蛙 0x1d2e1ad229af6c7809d2a3d87939559eb4c47777 在宽臂 -134pp 误杀保留；止血集中在窄档、拉宽后止血先消失误杀还在。结构根因：**赢家早期筹码天然集中=拉盘形态**（豆奶 0xf3065ae23e3199f0b26840675f59dc5770567777 h0=8、OST 0x290203a898eecc537fd89afcea281d44e2177777 h0=5——人气门 OR 语义放进场的高集中赢家）
- **holders 相对回落臂**区分度完美（赢家 7/7 零触发）但触发滞后（触发时价格已跌透）=无操作价值
- **h 档位**：h≤2 唯一打平（+0.3pp 零误杀）；h≤2/3/4 全零误杀净效应≈0；**h≤4→h≤5 悬崖（Σ -139.1pp）**——OST 买点 holders 恰 5，h≤5 含等值=第一 tick 即触发收益 0%，h≤4=严格 <5 对恒 5→5 永不触发；h≤6 多杀李平安 0x707e838bbc16ce1de95e33b077e28ee657457777 / BNB传奇 0xbd2a3d13f4b59b8d58badeea9749dc3d22387777（晚触发更差）
- 裁定（2026-10-25）：**不立 syb/top1 卖门；holders h≤4 是零误杀上限但不新增（净效应≈0）**
- 工具=scripts/sell-gate-wide-matrix.cjs、scripts/sell-gate-h-tiers.cjs（182 跑）

### T64 止盈臂 trailing 改造对拍——暂缓（2026-10-25，live v36 cf3d8177 反事实回放）
- 提议：`profitPercent>50 / >100 即卖` 两止盈臂改 trailing——「峰值>50 且回撤>10」「峰值>100 且回撤>7.5」。语义三防线：峰值=买后运行 max 只增不减（瞬时 profit 会自关开关：峰 80 回到 45 时条件翻假）；回撤=当前回撤非历史 max（越过前的坑不得触发）；价格域+可靠峰值轨（outlier 不推峰，防幽灵峰值假触发）。逐 tick 评 `peak>50 AND dd>10` 与「上涨 50% 后回撤>10%」数学等价，无需带状态新因子
- 方法：cf3d8177 全部 13 success 买入（live 真实成交路径）× wss_price_ticks 链上真序回放；outlier 剔除；锚=成交后 tick 市价（**v36 记账量纲事故致 trades.unit_price 域不可信**：11/13 票 USD 域落库，uR 自检 [0.001,0.98] 实证；2 票 BNB 域 [0.96,709]）；两臂同加 +5tick 延迟口径（对齐 3.5s+5tick 双门确认窗，不对称比较会偏袒旧臂）
- 结果（受影响=峰值过 50 的 6 票；其余 7 票两案同不触发）：即时口径 sum −17.2pp / 双延迟口径 sum −19.1pp，3 好 3 坏：
  - 松弛蛙（峰 85.5）：旧臂确认窗**免费跟涨 54.7→85.5**，new 延迟口径反输 −22.9
  - 土狗（峰 56.8=触发即巅峰）：两臂同挨刀，延迟口径 new +7.1（即时口径 −39.2 是不对称比较的假象）
  - OST（峰 79.3）：−10.4；慈善币安（峰 51.0）/传奇之路（峰 53.6）：边缘峰 whipsaw −1.8/−21.9
  - BNB传奇（峰 103.8）：arm2 右尾捕获 +27.2~+36.1，**唯一结构性强赢**
- 结论：**暂缓上线**（n=6 单日全 flap，样本薄不足以调参）。结构洞察：①双门确认窗让旧臂在上涨票上天然带 ~3.5s 免费跟涨，「即卖吃不到涨幅」的前提在本引擎已弱化 ②右尾捕获只在 peak>100 成立 ③主要亏损源=峰值 51-57 边缘带刚 arming 即死
- 备选假设（下批样本再验，勿按 n=6 定参）：仅加 arm2（50 固定保留+峰值>100 后 trail7.5；本样本独立 +27.2 且不动其余 5 票）/卡牌分仓（一卡固定落袋+余卡 trailing）。工具=scripts/ab-sell-trailing-compare.cjs（182 跑）

### T31 graduation 资金口径+PCS 路由+sellPercentage 退役——豆皮/水案（2026-10-24，063f659+00339fc+32bf002）
- 豆皮 0x1fad…7777 / 水 0x25e2…7777（两票均 quote 盘，水=USD1）出内盘未清仓
- **flap graduationProgress 价格锚替换资金口径**：R=毕业市值/首市值恒比假设实证不成立（两票峰值 0.716/0.754 够不着 0.9/0.98 毕业臂=死臂）；新口径=池净入金 Σ(0.98×buy)−Σ(1.0204×sell) ÷ 毕业阈值，零价格依赖
- **PCS trader 构造崩溃**：PancakeSwapV2Trader 缺 log() 构造期即崩——毕业票手工卖自 10-22 上线起**从未成功过**（用户两次按钮清仓全失败的真因）；修复+quote 盘二跳 [token,quote,WBNB]
- **旧 L1 锚事故形状**：PCS 分支带 minOutRatio/expectedNativeOut=断流后恒陈旧信号价（0.17-0.39×）quote 活报价必拒→30min 熔断 7 连败
- sellPercentage 退役：sizing 唯一表达=cards（存量携带 fail-fast 拒启）；P3/P8 毕业臂 cards 1→2
- 单测：graduated_pcs_routing / graduation_sell_and_anchor / card_position / validate_legs / stop_loss_rules

### T32 止损「不回头」拐点调研+protect 三臂否决（2026-09-29，233 票）
- 三结构性结论：①回峰拐点 -15% 后不足半数回峰（43%），但「弹≥5%」概率任何深度 40-60% 不归零——震荡下车的真实代价是 5-10% wick ②击穿后持有期望恒 **-33%**（衰减不减速，不存在「跌够了会稳」）③flap 市值死地板 5-6 BNB（跌破 66% 不回；拐点带 8-10 BNB）
- 分层：flat 峰值<1.1×（36% 的票）击穿时刻中位买后 0-1min——现行 60min/-50 平均晚 30-60min 在终局价接刀
- protect 腿三臂配对回测全净负不采纳：A 无门 +2.33 / B(-25) +1.43 / C(-30) +1.26；2 票误杀 -2.29（CUE dd -32.5 时浮盈 +22.7% 全清 11 秒后冲 5.2×）——「冲顶前最后深蹲」横截面与真死不可分；-35 静态甜点仅 2 票依据不立门

### T33 v12 卖臂谱系+买入熔断（2026-10-15，a5d34af）
- 卖臂族：P7 分卡止盈/P2 止损/P4 市值清仓 4.5K（**marketCap>0 防线必带**——无值票 marketCap=null 恒 false 误放）/P9；tick 滞后教训（死票靠扫描路径）
- **买入熔断**：连败≥3（只计发单后链上失败，前置拒绝/资金不足不计）拉黑至进程重启+Telegram；「2 败 1 成」翻正清零
- 手工清仓=插 manual_trade_requests 行（后升级四按钮 T42）

### T34 引擎级 stopLoss 整包继承（2026-10-13）
- P11 与止损臂管的风险不同（回撤保护 vs 保命），整包继承而非二选一；鸡蛋案 c402609 同批=卖腿确认窗 2000ms+v12 全卖腿 bypassDebounce=false

### T35 账本票 -50% 价格止损 V 反误杀（2026-09-28，0xb47acc41…7777）
- score 4.20 全场最高=TPA 正确放行的好票；买入后 10s 闪跌 -56% 触发无确认窗价格止损全清，随后 V 型反弹至买价 3 倍
- 定性：无确认窗价格止损对「闪崩即 V 反」盘卖在坑底（卖侧结构性问题，确认窗/分级减仓候选——后由 3.5s+5tick 双门槛确认落地）

### T36 P4 120s 死票清仓臂（v26 批次内，2026-10-19）
- 持仓 >120s 无 tick 的死票清仓，配对 +0.0373 该批次最大单项。详档 auto-memory popularity-gates-v26

### T37 rug-exit-account-arm 账号健康卖臂（C166 交易侧，2026-10-2x）
- 持仓期检测宣告账号删号/删推（rug 前兆早于价格）→ FA issuerAccountState → 卖臂条件全清；裸调 apidance 绝不走 TwitterFetcher 缓存层（失败 1h 冷却会吞删号信号）；回测零接线因子恒 null（时序穿越防线）；库卖腿 v29 已上

### 戊、live 执行与事故

### T111 flap quote 汇率 V2 主源灰尘池挂价污染——买入口径失真+卖出 L1 恒拒熔断循环（MAX/METAB 案，2026-11-04 v70 首日）
- 案：v70 `f0898589`（both live 去叙事）02:46:29 买入 MAX 0xbe0d62b9a00a9ca8ba917a3f790c25af68cb7777（flap，0.004 BNB→453,550.85 tokens）；7s 后 P10 卖腿 fire，live 卖出**连续 5 次被 L1 预成交校验拒**（`报价到手 0.0040 < 预期 0.0097 × minOutRatio 0.5 (ratio=0.4156)`，02:46/02:48/02:49/02:51/02:53）→ per-token 卖出熔断 30min 循环（熔断按 tokenAddress 计，其它票不受影响）；账面 profitPercent -43%（虚高口径），链上真实浮亏 ≈-40%（可卖 0.0024 BNB vs 成本 0.004）
- 根因=**三级源①PCS V2 quote/WBNB reserves 无最小流动性门槛**：MAX 是 METAB 计价盘（quote=0x7425889fe94f9d693e8daefe88bcced6acfef4c0，QuoteSet 正常到达），METAB/WBNB 的 V2 池是灰尘池——WBNB 侧储备仅 **1.4e-5 BNB**，挂价 rate=**2.0966** vs 真实市场价 ≈0.87（V3 USDT fee2500 池流动性 1.9e22 充足），**虚高 ~2.4 倍**；V2 主源命中即 return（只拦「储备=0」）→ 全部 METAB 计价盘 tick price_bnb 系统性虚高 2.42 倍 → ①买入侧预期 tokensOut 少算 2.43 倍=「实收更多」不触发买侧滑点防护放行买入；②卖出侧 expectedNativeOut=qty×虚高信号价 → 链上真实报价恒 0.41× → L1 恒拒。对齐既有设计原则「零流动性 V3 池挂价不可信必须拦」——V2 侧漏了同款防线
- 修复（用户裁定「修门槛+重启」）：`_fetchQuoteRateV2` 加灰尘门槛——WBNB 侧储备 < `flapWs.quoteRate.v2MinWbnbReserve`（默认 **0.01 BNB**）→ null 降级 V3（WBNB→USDT 中转）；静态纯函数 `FlapAnkrWsCollector.isDustV2WbnbReserve` + stats `v2DustPairDowngraded` 计数 + debug 日志
- 自愈路径已验证成立：METAB 走 V3 USDT 中转拿真实 rate → tick 回归真实 → FA 价格修正 → 卖腿预期锚修正 → L1 通过自动清仓；同 quote 另一票 0x5771…7777 零信号未买入（无第二受损仓）。**实际自愈时间线**：03:09:46 重启 → 03:13:01 汇率源切 V3 USDT 中转（pool=0xC215…D80B fee2500）→ **03:15:01 MAX 全仓卖出成交 0.0022781 BNB（-43.0% 认损）**，修复生效→清仓仅 2 分钟；同窗新进程上 0xea44…7777 票完整闭环（03:08 买 0.004 → 03:13 卖 0.004148，+3.7%）
- 单测：`_test_watcher_quote_conversion.cjs` T16 段（100/100）——事故池值 1.42e-5 BNB 拦/恰界 0.01 不拦/自定义阈值；降级链三形状（主源短路/V2 灰尘→V3 WBNB/USDT 中转换算 ÷bnbUsd）+ bnbUsd 未就绪宁 miss 不冒充；源码口径锁（门槛在 V2 函数内+降级计数先于 rate 计算+stats 键+配置默认在场）
- 取证坑留档：182 对 wss_price_ticks/wss_events 的 token_address 无索引查询（ilike 前导通配/无 id 窗的 eq）statement timeout **被吞成空 data**（假象「表无行」）——验证落库活性须用 id 探针窗（`gte id desc`）；trades 列名=price 不存在（真列 price_bnb）

### T92 already-known 恢复轮询单端点全 miss→卖出误判失败丢 trade 行——多端点并行恢复（KYA 案，2026-10-29）
- 案：v51 `d41b9c29` KYA 0x587c61b4a5052b7e5e0563be61b9be0a0aa27777（flap，3 卡 0.006 BNB）21:02:16 全清卖出 tx `0x0fff…c83` **已上链成交**（status=1 块 130349778，gasUsed 697289，实收 0.0042089268551733835 BNB 进钱包），但请求层响应丢失重发同一 raw → 节点 `-32000 "already known"` → `_recoverTxFromAlreadyKnown` 取证成功进入恢复轮询，**主 provider（bsc-dataseed1.binance.org，LB 集群）getTransaction 12×500ms=6s 全 miss** → 恢复失败 fail-closed 判「卖出失败」不落账 → trade 行缺失；21:05:33 卖腿再 fire 时链上仅剩 4.4973e-11 零头被 T75 粉尘门就地清账（out=0 行）→ token-returns 页 FIFO 把 0.006 本金记成 **-100%**（真实 -29.85%）
- 根因=恢复路径单端点依赖：tx 实际已上链，但同一 LB 端点的事务索引滞后 6s+ 即饿死轮询；已有机制（T38/T69 三形状取证 + 恢复追踪）链路无恙，缺的是轮询视野
- 修复两件（用户批准「修正吧」）：①**数据补账**：补 21:02:16 真实卖出 trade 行（input 939203.17/output 0.0042089268551733835 BNB，unit_price=USD 域换算 bnbUsd≈752.18，cardTrade 3→0，`metadata.manualCorrection` 案号留痕幂等）+ ExperimentStatsService 重算 stats（totalReturn -15.53→-11.64、bnbChange -0.0168→-0.0126）；重放安全核对：`_loadHoldingsLive` 卖行 remainRatio=max(0,…) 钳 0、qty=0 跳过粉尘行、卡账本只认 after 绝对值——补行即可、粉尘行免改；②**代码加固**：BaseTrader 新增 `_recoveryProviders()`（主 provider + `BSC_RECOVERY_RPC_URLS` 同源备用池 dataseed2/3+defibit1/2，懒构造 `_recoveryProviderCache` 测试可注入锁单端点）+ `_pollTxResponse` 重写为 `Promise.allSettled` 多端点**并行**轮询（任一端点见 tx 即恢复；单端点 throw/miss 不吞恢复；12 轮×500ms 窗不变，超时日志改「全部端点未见」）
- 单测 _test_nonce_manager [3e]（44 通过 0 失败）：(a) 主端点恒 miss+备用第 2 轮命中→恢复成功（含双端点调用计数断言）；(b) 主端点 throw ECONNRESET+备用命中→allSettled 隔离仍恢复；(c) 源码口径三断言（`_recoveryProviders`+`Promise.allSettled(providers.map`+池含 dataseed2）；既有 5 处 provider 打桩全部预置 `_recoveryProviderCache=[t.provider]` 锁单端点（零网络红线，含 3b-b 换 provider 同步换 cache）；相邻套件 live_hardening/tx_seen_receipt/gas_dynamic/approve_max_grant/flap_minout_signal_anchor 全绿
- 观察点：**182 上运行中的 v51 进程（PID 1833938）持旧代码，多端点恢复下次重启/部署才生效**；同实验 28 SELL 中仅此 1 笔 already known（同周 T38 双发同族）；排查/补账脚本 `tmp-check-587c-{meta,ticks,trades}.cjs` / `tmp-fix-587c-trade-backfill.cjs` 入库留档
- 方法论：already-known 恢复失败≠交易失败，凡恢复超时先人工核链上回执再改账（本案回执 status=1 直接反证）；LB 公共端点不可作唯一取证视野

### T81 税币买卖数量不闭合→web FIFO 误判「持仓中」——全清腿残量归零（普通人案，2026-10-28，3b71f7c）
- 案：v43 `7dd26b85` 普通人 0x934b16d660628ea14174a2387b1ca50585e67777（flap 税币）00:21 UTC 买 0.008 BNB 余额差法实收 717,544.49；00:46 全清卖出时链上余额仅 699,608.24（~2.5% 持有期内被税/反射抽走）→ live 卖出行 `input_amount`=链上实际卖量（账面>链上按链上卖）→ trades 买卖数量天然不闭合，token-returns/trades 两页 FIFO 剩 17,936 被误判「持仓中」，**并误渲染「卖出全部」手动按钮**（renderManualTradeButtons 以 hasUnmatchedBuy 判持仓——显示 bug 兼功能 bug，点了会对已清仓票发起真实卖出）
- 口径事实（引擎侧无恙）：PM 全清腿 ledgerQty=账面原值精确清零（T75 链路）、experiment_tokens.status='sold'、cardTrade 4→0；trades 行如实记链上事实（买=balanceOf 前后差、卖=链上实际卖量），不闭合是税币链上事实非记账错误——**修复放 web 解释层，不改 trade 行真值**
- 修复（experiment_token_returns.js / experiment_trades.js 两处 FIFO 卖出分支）：全清判据 `metadata.sellPercentage>=1 OR cardTrade.after===0`（virtual 2838 行/live 3262 行/毕业卖/手工卖统一写点）命中且队列仍有剩余时——剩余数量归零（持仓判定/status/CSV/手动按钮全走 hasUnmatchedBuy/remaining 族）、剩余成本并入本对成本（税损已实现，pairCost=0.008 全部买成本实现，returnRate −29.03%=诚实全回路）；案票验证 exited/零剩余 + 三对照=无标记历史形状 bit 不变/部分卖（sellPercentage=0.5）不清零/虚拟精确买卖 drain 空转
- 关联残留（未动非事故）：`_loadHoldingsLive` 重启重放 trades 净额同样得出 17,936 账面 → 链上 balanceOf 对账兜底（数量以链上为准，实际剩 ~3.5e-8 粉尘=卖量 6 位小数舍入尾差）；卡账本重放 after=0 → 无卖腿 sizing，粉尘仓静置，T75 粉尘门为第二道防线

### T75 全清腿记账 undershoot 幽灵仓——Number 往返吃 ulp 留 3e-11 + 粉尘残仓清理门（ELON2028 案，2026-10-27）
- 案：v41 40754e0d ELON2028 0xf5f3f01bacbfc2a8f08451eee501712693377777（flap）已全部卖出后卖腿持续 fire——23:26-03:01 共 **11 笔 revert**（每笔 337,726 gas ≈ 0.0000168863 BNB，合计 ~0.000186 BNB），L3 熔断 30min 冷却 + 卖腿「失败每轮重试」= **~31min 一轮永动烧 gas**+TG 告警循环；web 侧「部分卖出 100%|余仓=0.0000 余卡=0」假象（显示格式掩蔽 3e-11 残仓）
- 根因两层：①**记账 undershoot**——`_executeSellLive` 卖量 `new Decimal(Number(holding.amount)).mul(sellPct).toNumber()` Number 往返吃末位 ulp：PM Decimal 账面 `296034.40598014063` → double 化 `296034.4059801406` → 残仓恰 **3e-11** → PM `remainingAmount.eq(0)` 删仓判据不成立 → 持仓不删 status=bought 幽灵仓常驻；**E5d 当年只修了虚拟路径（2807 行 Decimal 直通），live 路径漏了同款**。②**终止路径缺失**——链上真粉尘 1.7684893e-11 > 0 → externalDisposal 臂（只认链上=0）接不住 → SyncHoldings 每 5min「按链上数量卖出」1.77e-11 个 → flap Portal 产出 ~3.34e-19 BNB 必 revert（custom error 0x76baadda）
- 修复两件（用户批准「两件一起做」）：①全清腿（sellPct>=1）记账量=账面 Decimal 原值 `ledgerQty`（PM remaining 精确归零删仓；部分卖保持链上请求量，余仓本就允许非零，下一条全清腿精确清掉）；②**粉尘残仓清理门** `dustCloseValueBnb`（default.json fourmemeWs.live 1e-4 BNB ≈ $0.06，显式 0 关门）——预期卖出所得 `expectedNativeOut=qty×信号价/bnbUsd` < 线 → 不发链上卖单，`_closeDustPosition` 就地清账删仓+落清仓 trade 行（inputAmount=账面原值/outputAmount='0'，重放 remainRatio 钳 0 防复活；metadata.dustClose 留痕）+warn+TG 告警；**锚缺失（价/汇率任一 ≤0 → expectedNativeOut=null）fail-open 照发**（不误杀正常仓）；externalDisposal（链上=0）语义不变先于粉尘门；部分腿命中同清全账（部分腿所得已 < 线时整仓必然也不值 gas）
- 单测 _test_live_dust_close 27 断言：T1 事故现场反证（ELON2028 实数 buy 394712.54130685417 + partial 98678.13532671354 → holding 296034.40598014063 全清 → PM 精确删仓；**旧 Number 往返形状 PM2 重放 → 残仓恰 '3e-11' 与日志账面值逐位一致不删仓**）/T2 门命中 0 tx+PM 删仓+trade 行留痕+告警恰 1 次/T3 正常仓照发/T4 锚缺失 fail-open/T5 externalDisposal 原样/T6 部分腿余仓语义不变/T7 显式 0 关门
- 受影响既有套件 12 个全绿（live_record_trade_clamp 17、graduation_sell_and_anchor 49、sell_leg_scan_fallback 21、manual_trade_queue 119、holdings_replay_precision 21、graduated_pcs_routing 25 等）；live_dual_platform 源码断言正则一并修正（存量失败=2026-10-24 PCS 路由重构后未跟上，git stash 验证与本次无关）
- 重启后行为预判：重放 book 残差+链上粉尘可能再注入粉尘仓，但首个卖腿 fire 即被粉尘门就地清掉（一次性，无 gas 无告警风暴）——链条闭合；全实验仅此一票中招
- 方法论：日志「余仓=0.0000」显示格式不可作清仓证据，须看 PM positions 键是否存在+SyncHoldings 偏差告警；ulp 级事故反证必须字符串/Decimal 构造（T46 同坑）

### T69 nonce 取证第三形状——NONCE_EXPIRED transaction 字段（邪恶千问幽灵卡案，2026-10-26）
- 案：v38 e5438645 邪恶千问 0xb05b2024f03fb05aa7229e168bfb014f4e567777（flap 税币，4 卡 0.004 BNB）16:23:00 第 1 卡卖出 tx nonce 1777 **已上链成交**（0xc01d…a01，block 129737025，实收 0.0014973 BNB 进钱包），但 ANKR 节点 getTransaction 索引滞后 → ethers broadcastTransaction 轮询超时后查 nonce 已消费 → 抛 NONCE_EXPIRED，首发 raw 在 **error.transaction** 字段（info 里只有 error 无 payload.params）→ T2/T38 取证只认 info.payload → 取证 undefined → fail-closed 判「卖出失败」不落账 → 账面 4 卡、链上 3 卡
- 连锁：后续 3 次卖出全部成功但错位记账（16:26/16:28/16:29:53 各 1 卡，此后链上只剩 1.4e-11 尘埃）；16:31:14 起「账面第 4 卡」（幽灵）按链上余额 1.4e-11 报价卖出 → revert "AS" 每轮重试，每 ~31min（断流票扫描节拍）熔断+TG 告警循环，至修复已连败 21 次
- 资金无损：4 卖合计 0.007462 BNB > 成本 0.004（+86%），幽灵卖出 BNB 真实到账，纯记账缺失
- 修复：`_errorRawTx(error)` 共用取证源（payload.params[0] 臂 + **transaction 臂**：raw 字符串 / TransactionResponse.serialized 两形状）；`_recoverTxFromAlreadyKnown`/`_probeNonceErrorTx` 双双改走——取证命中 → 轮询 getTransaction 恢复首发追踪（上链则照常 awaitReceipt 记账）；两源全缺仍 fail-closed。至此 nonce/already-known 三形状齐（T38 payload 臂 / T2 nonce payload 臂 / 本案 transaction 臂）
- 单测：_test_nonce_manager [3d]（transaction raw 字符串与 serialized 两形状恢复反证 / 双源全缺 fail-closed 语义不变 / 源码口径）38 断言
- DB 修正：补 16:23 幽灵卖出 trade 行（cardTrade 4→3，metadata.manualRepair 留痕）+ 后三行 cardTrade 顺次改 3→2/2→1/1→0——重放恢复只认 cardTrade.after 绝对值（后写覆盖），**只补行不改后行=最终仍挂 1 幽灵卡**；修正后重放 0 卡 0 仓与链上一致
- 对账方法增量：balanceOf 按 block 回放定位余额消失点（eth_call 带 blockNumber 逐块二分）；幽灵卡排查先看 SELL 信号 metadata.tradeResult.reason 是否 NONCE_EXPIRED（nonce too low: next N+1, tx nonce N 的 N+1 即证明首发已上链）

### T38 v36 三记账事故——卖出实收记零/already-known 双发/读零虚增（2026-10-25，412cb77）
- 三独立形状（同根因族：ANKR HTTP 负载均衡滞后读+发送层 already-known 误判）：①卖出实收记零（旧谓词 `(after-before+gas)>0n` 撞滞后读 diff=0+gas 恒正→实收记成纯 gas）②already-known 当拒收重发（首发响应丢失但 tx 已入 mempool，重发撞 already known 误归类→reset+重签 nonce+1：BNB传奇 0xbd2a3d13…7777 幽灵卖出+松弛蛙 0x1d2e1ad2…7777 双买各 0.004）③余额差读零→估算兜底虚增 11%
- 修复：谓词改 `after > bnbBefore`；`_recoverTxFromAlreadyKnown`（从 error payload 提取 raw→Transaction.from(raw).hash→getTransaction 轮询，**绝不 reset 重发**）；单测 _test_sell_settle_predicate / _test_nonce_manager
- DB 修正 6 项（幂等 guard+metadata.correction 留痕）；13 token 重放归零后重启
- 对账方法论坑：ERC20 to=wallet 查 topics[**2**]；getLogs 块窗≤4999 且 head 留 500 块余量；多段路由买入需 filter+sum

### T39 手动交易双支持上线（2026-10-22，a784f99+e8cde92）
- token-returns 页四按钮（买一卡/卖一卡/卖全部/停止卖出锁）+引擎 2s 轮询 CAS；手动操作落 signals+trades（isManualTrade+cardTrade）
- 真实资金闭环实测 +0.95%（BNC stock 0x78a7c4ca…7777）
- 两上线修复：POST 列名 PGRST204（experiments 无 name 列→「实验不存在」误报全挂；打桩单测拦不住真实列名错→T11.10 源码口径反证）；非 cards 全清 cardTrade 缺键→重启后卡数虚高
- 尘 tick 死盘票买拒是正确行为（FA 价格链真无价 fail-closed）

### T40 妹珠买入量纲事故（2026-10-20，2c04c2e）
- fallback 漏乘 bnbUsd 低估 **719×**；残仓处置成规=DB 修正留痕→重启对账→manual 全清

### T41 蓝蛙 minOut revert 案（2026-10-21，a944127 四件）
- quote 滞后块虚高卡死 minOut+8.6s 盲区；修复=`minOutAnchor=min(信号价期望,quote)` 取较低者（平稳/暴跌盘锚 quote、暴涨盘锚信号价期望）

### T42 滑点 5→20——BI 案（2026-10-19，39c32e2）
- 内盘高滑点≠浪费（拉盘期滑点付的是即时成交权）+「暴涨期没买到=解盘」；web 兜底硬编码复发同批修复

### T43 双跑事故族——重启竞态+粉尘+v21 双记账（2026-10-18/20）
- --force 不杀旧进程双跑坑（同 txHash 双记账实证；**轮次表并行 R1 是发现特征**）→ 单实例锁 7118e3b
- 粉尘 1e-11 即恢复持仓（阈值必须 0）；重启 SOP 四步（kill→确认真死→核持仓→setsid nohup --force）
- 实盘重启前持仓确认规程：复核口径=**卡账本净额非 trades 行计数**（中国龙案=超龄窗卖腿停摆成死仓）

### T44 d97a fire→成交 9.1s→N3 默认开（2026-10-17，0xd97a…7777）
- copy 门如实工作（31.2%>20 拦）；9.1s 主因叙事链路时延 → 叙事预触发（N3）默认开（tick 时刻预评+后台 getRating，与 fire 直调共用 inflight join）

### T45 live 买入提速四件套（2026-10-14，41e1dcb）
- WSS 快速回执（自家 WSS 见成交 tick 即轮询拿 receipt；拿不到让位原路径 bit 一致）/语料就绪即评门/vision 预判门 C72（1 题判语料是否已足够免图）

### T46 卖出延迟 13-17s 三段——GROK 案（2026-10-15，ac1da67）
- 三段病因：每笔重复 approve（最大项，精确额度卖即耗光）/receipt 4s 栅格（ethers pollingInterval 默认 4000 全仓未设）/预发串行
- 修复：MaxUint256 一次授权（首卖一笔此后恒充足跳过）+记账精度钳制（**全 Decimal 比较**——double 吞 1e-11 差异致钳制静默失效）；修复后纯路径 1.33s（~10×）
- 遗留：每票首卖仍付一笔 approve ~8.4s（Approval 事件不在 WSS 白名单管不到；候选=成交后后台预 approve 待裁定）
- 部署时点幽灵大扫除：7+1 核销（账面尾数幽灵会让卖腿空转 revert 烧熔断计数）；JS double 精度坑：事故现场反证必须双字符串/Decimal 构造

### T47 v11 live 首验（2026-10-14）
- hardCap OOG 假 revert（estimateGas 拒绝≠链上必败）；市值门 15K（极速拉盘票不买）；非 BNB 计价盘放开买入（元宝案）；卖出分派错案翻案 fcc639a；gas 下限 8ec4ec5

### T48 live 验收遗留（2026-10-1x）
- 加固全部完成（L1 assertMinOut/L3 卖出熔断/买入熔断/L5 回执绝不自动重发/maxPositionTokens）；**真实资金 0.001 BNB 闭环 runbook 待用户执行**（docs/live-acceptance-runbook.md）

### 己、回测与数据口径

### T49 回放链上真序修复——凑凑案（2026-10-08）
- 根因：`sort(id)` bigserial 分配序≠提交序（watcher 延迟落库产生 id 序与 block_time 交叉）→ 未来 3s 的峰提前喂进价格史，P11 算出 +49% 假峰→-35% 假回撤提前全清 -3.5%（真时序该票涨到买价 4.8 倍）
- 修复：`compareByChainOrder`（block_number, log_index, id tie-break）；单测 _test_backtest_chain_order
- A/B 对拍：**纯排序效应 +4.74 BNB**（R0 旧 +2.01 → R1 新 +6.75）；乱序前视系统性伤害卖腿（假峰提前触发回撤保护提早离场）
- 可比性断裂：历史回测绝对数字失真；同窗相对比较仍成立（同批行同 id 序，乱序确定性）

### T50 虚拟↔回测一致性对拍（2026-10-10，a21fa102）
- 配对口径：sourceExperimentId=虚拟自身（虚拟自己就是采集器→两边数据完全同源）；对拍须用 metadata.timestamp（executed_at=运行墙钟）
- 差距演进：A -1.243 → B -1.029 → **C -0.989（差 +0.1045 反转为回测略优）**；CZ 案「价按 fire、时按完成」口径纠缠待裁定
- **graduation 前视事故**：`_loadGraduationEvents` 装载即填 `_graduatedTokens` → 买入成功点查到 14s 后才毕业的标记直接@买价补卖 0%——修复=标记挪到消费点填充（红线 6）
- 「零毕业卖出日志」谜底：毕业票全被 P11 在事件前竞速卖掉，机制正常非 bug
- 坑：`.in()` URL 超 8KB 批 50 上限；trades 列名 trade_direction；wss_events.block_time=落库墙钟（链上块时间在 payload.blockTimeMs）

### T51 BacktestTickCache+回测性能（2026-10-0x~10-1x）
- (sourceExperimentId,platform) 粒度全量缓存运行期过滤（任意窗口共用 bit-identical）；**探针与装载必须锚定无序形状**（`ORDER BY id` planner 弃索引 8s 超时）；maxTickRows 默认 100 万大窗口须放宽
- P3-P18 性能批次（STALE delta 侧车 tmp+rename 原子重写等）；_test_backtest_keyset_paging 存量失败待裁定

### T52 flap USD/BNB 量纲坑（2026-09-28 首犯，10-14 再犯）
- trades.unit_price=USD 口径，wss_price_ticks.price_bnb=BNB 口径，比值≈BNB/USD（~777）——直接比价得出「-99% 归零」错误结论，正确口径下实为 +540%
- 同族再犯：快照因子键 firstPrice/currentPrice/fdv/marketCap 全是 USD，`*Bnb` 后缀键才是 BNB
- 同秒多块票对拍必须 (block_number, log_index)

### T53 four.meme 盘型语义（2026-10-03 链上实测）
- **quote=0x0 是正常 BNB 盘**（不是 WBNB）；ERC20 quote 盘 78% 但绝大多数 funds=0 死盘；`version=0+mgr=0x0+全零`=毕业删档
- BSC getLogs 端点矩阵：dataseed 禁/publicnode 只服务链头 5k 块/**ANKR 付费连接 wss→https 同路径即 HTTP RPC**（历史 getLogs 唯一可用源）

### T54 flap QuoteSet 冒充事故（2026-10-0x）
- quote_token 误标致价格换算冒充；全量回填闭环（协议真起点块 51,316,728）。详档 auto-memory flap-quote-impersonation-incident

### T55 PCS V3 Swap 改版签名（2026-10-0x）
- Swap 事件尾多两个 uint128 fee 字；标准签名扫池全 0 静默假象（「池子不存在」误判）。详档 auto-memory pcs-v3-swap-signature

### T56 双平台口径（2026-10-0x）
- platform='both' 单引擎 per-token 分派；**回测/查询 platform 单值 `.eq` 循环勿 `.in` 多值**（planner 弃索引）；live=单引擎双 trader 同一钱包共享 NonceManager（shareSignerFrom 红线）

### 庚、机制迁移与架构

### T57 FA 两阶段喂食+chainLate——鸡蛋案（2026-10-14，0x906e95e2…7777）
- WSS 实测不慢（flap p50=0.72s/p99=1.24s）；3.6s 断供真因三段：①sender RPC 回查（并发 4）阻塞 FA 喂食乱序 ②lastTickAt 无条件赋值被迟到 tick 回拨 ③currentPrice 被迟到旧价覆盖→**fire 价低锚 61% 的直接来源**
- 修复=两阶段喂食：价格段 WSS 到达即喂（fire 价不被回查延迟污染），wallet 段 pushRow 回推补（holders/K 组/GMGN routedBuy 用真 sender）；chainLate 复合水位（block,logIdx）拦迟到旧价；holderTrend 事件环形缓冲+逆向撤销重放（唯一序无关解）
- 测试坑：合成 tick 须全局递增 log_index（真实链上块内 li 严格递增，恒 0 撞 chainLate 判据）
- 单测 _test_fa_deferred_wallet_feeding（49 断言含事故现场反证）

### T58 watcher 架构废除回迁直连（2026-10-09，c4abb88）
- 动机：watcher DB 中转 ~1.5s+bigserial 乱序失真 → 实验进程内嵌 ANKR WSS collector（引擎直消费内存回调，DB 仅持久化）
- 三约束：采集覆盖=现役 both 实跑实验即事实采集器（单平台实验只持单 collector）；ticks 新行 experiment_id 恒 NULL；watcher 四正交改进全部随迁（topic0 白名单/SenderResolver/quote map 持久化/断流自愈）
- 首启 27s 崩溃教训：logger 实例方法解引用裸调用丢 this → unhandledRejection（Node 24 默认 fail-loud）——**桩方法体内必须用 this 才能暴露解引用丢失**
- TPA 触发耗时：live 缓冲 2ms/offline 111ms（watcher 时代 1-2s/批，三个数量级）；断流风险用户裁定接受不加 watchdog
- 单测 _test_embedded_collector_architecture（42 断言）

### T59 卡牌仓位机制迁移（2026-09-27，96e32d4）
- 迁自 rich-js：perCardBNB 开关（不配零变化）；卡账本 `_tokenCards` 维护在卖出成功分支，trades metadata cardTrade 绝对值重放恢复
- 重放精度钳制：`Insufficient token balance` 差异≤相对 1e-9 → 钳到持有量重试；单票失败只跳过不中断恢复

### T60 策略库上线+创建页只读化（2026-09-28，2e18361+77fac2b）
- `strategy_library` 快照 copy-in（引用=只读快照卡，改库不影响已建实验，**改库须重启实验进程**）；脏 groups/cycle fail-fast throw 拒启（静默失效=腿恒可见是危险方向）
- 创建页只读化（77fac2b）：腿只能来自库引用（用户裁定：所有实验策略必须来自库引用，不手写腿）；routes 必须走 dbManager service key（anon 被 RLS 静默过滤）
- 2026-10-24 sellPercentage 加入 fail-fast 族；groups/cycle 由 act* 接棒【cycle 分桶路由已废 2026-10-15】

### T61 OPB 在线分类+dataPrefetch 退役（2026-10-0x / 10-17）
- OPB：实时代币分类双门触发+60s 扫描补救，写 token_profiles（全局 PK 不挂实验防级联删）；重启过渡期全史路径防涨幅失真；阈值判定与离线 classifyToken 共用单一真相
- dataPrefetch/visionPrefetch 随 C84 整链退役（存量实验带该段=静默丢机制）

### T62 效率优化六批次（2026-10-15）
- preFilter live 平移默认开（**AST 直传防线**——String() 化恒 null 静默失效）；strategy_signals 进程内缓存（成功才提交，绝不以缓存遮蔽落库失败）；永久阻断条件编译缓存（new Function 模块级）
- 规程：一个阶段只跑一个实验（起新前先停旧，须用户确认）；验收实验只用最佳策略不自编极简
