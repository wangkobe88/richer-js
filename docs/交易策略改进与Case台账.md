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

## 一、现行买腿门链一屏（buy-v2 v35 快照；live v36 cf3d8177 实跑仍 v34 形状=快照语义）

```
(tokenAgeSec < 90 OR (tradeCount >= 25 AND tokenAgeSec < 600)) -- 时窗：90s 快窗 OR 慢热臂（T63/v35：非尘成交≥25 笔+10min 帽）
AND marketCap > 3500 AND marketCap < 20000                -- 市值窗 USD（v34 起 20K）
AND (narrativeRating == 2 OR narrativeRating == 3)        -- 叙事过门（C84 触发模型）
AND holderTrendSlope > 0                                  -- 趋势（slot 化 4 块窗，NULL fail-closed）
AND bundleClusterSharePct < 35                            -- 同块协同簇流量占比（v30 起锚 35）
AND top1HolderCircPct < 35                                -- 单钱包最大持仓
AND maxCopyWalletHolderCircPct < 20                       -- 跟单名单单钱包最大（NULL fail-closed）
AND (platform != 'flap' OR earlyTradesRouterPct >= 30)    -- flap 臂：聚合路由占比
AND earlyTradesPerWallet < 4                              -- 均匀度
AND famousCopyWalletCircPct < 15                          -- 极著名钱包（0 语义）
AND (buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10) -- 人气门（v28 起 OR）
AND earlyTradesNetBuyRatio >= 50                          -- 卖压门（v29）
AND sybilClusterHolderCircPct < 35                        -- sybil 大簇合计持仓（0 语义）
AND drawdownFromHighest > -70                             -- 崩盘接刀门①（v27）
AND crashSpeedPctPerSec > -10                             -- 崩盘接刀门②（v27）
```

第二层（条件串外，`gmgnCheckCondition`）：`gmgnBundlerWalletRatio <= 65`（v31 起 65）；叙事类型×issuer 分档门（C85）；GMGN API 失败 fail-open 放行（T14）。

## 二、现行卖腿机制要点

- **sizing=卡牌唯一表达**（cards；sellPercentage 已退役 2026-10-24）；全清腿恒精确 1；卡账本 `cardTrade` 绝对值重放恢复
- 全部卖腿 bypass=false 走 **3.5s+5tick 双门槛确认**（首真起计不重置、断流票不得按陈旧快照卖、maxWait 逃生）
- 引擎级止损双腿（时间 `profitPercent<=0` / 价格）+ 断流票扫描兜底；用户裁定「所有卖出归卖出策略管」，现行实验以卖腿表达止损
- 毕业卖：four.meme 市值/72 锚 + flap **资金口径**（池净入金，2026-10-24 替换价格锚）；live 毕业票路由 **PCS V2 外盘**（quote 盘二跳）
- 卖臂族：P4 市值清仓 4.5K / 120s 死票清仓 / rug-exit-account-arm（宣告账号删号删推→全清，v29）
- 手动交易四按钮（live/virtual，2s 轮询 CAS + 停止卖出锁）

---

## 三、Case 档案

### 甲、买腿门与策略库

### T63 买窗慢热或臂——灰灰案（2026-10-25，buy-v2 v35，0x0da1d47f702d04e72eb8482e2f4c214eb5dd7777）
- 案：flap 慢热票 90s 窗内人气臂差 0.109 BNB / 2 holders 没买（rating=3 age 10s 早已过）；主升全在窗外——146s 人气臂过但 bundle 100%/slope 负拦，**223s 全臂首过**（mcap 5736=1.18× 开盘），峰值 55796（x11.5）毕业；mcap<20K 永久死线 667s
- 改动：v34→v35 age 门 `(tokenAgeSec < 90 OR (tradeCount >= 25 AND tokenAgeSec < 600))`——「交易数据走过一定量」（FA `tradeCount`=非尘 tick 累计，live/回测同口径）；其余 15 臂不动
- 阈值依据：灰灰 90s 关窗 tc=19 / 223s 买点 tc=29 → N=25（高于死票终值且留 4 笔余量）；600s 帽=20K 死线圆整
- **外层 600s 帽是必要件非参数**：裸 `OR tradeCount >= N` 臂无 age 约束 → `extractBuyRangeFromCondition` OR 侧 null 降级 → preFilter 整体失效（监控池淘汰默认关=未持仓票永久逐 tick 构建）；带帽则 OR 并包络 {max 1.5}∪{max 10}=10min 窗，构建成本有界。`_test_fa_prefilter` A13/A14 形状锁死（A14=无帽反证）
- 生效路径：改库不影响已建实验（快照语义）——live v36 仍 v34 形状，起新实验/重启引用 v35 才生效
- 归因法：182 逐 tick FA 重放（尘门 0.001/链上真序/rating 完成时刻注入/sybil roster 预载）——同 T10 迟买归因法；GMGN 第二层历史快照不可得未重放

### T1 bundleClusterSharePct 两口径 A/B 对比——月亮币案（2026-10-25，待裁定）
- 票：实验 cf3d8177 全部 13 笔买入（月亮币 0xcb69aab56621eb562563254f682931f50d717777 / OST 0x290203a898eecc537fd89afcea281d44e2177777 / BNB Legend 0x0b66b5d4dc76dc7cae9e8f94df97026062057777 等，全清单见实验 trades）
- 用户观点：该键名字=「最大区块协同钱包群的持仓占比」，持仓占比不应有 10s 滚动窗。B 版口径=每钱包记录其有购买行为的块簇，簇成员**当前正净持仓合计**÷流通，全块取 max
- 方法：真 FA 逐 tick 重放（v34 全门同构、其余门逐字相同、叙事取 rounds 首个 2|3 轮完成时刻注入），对比两口径各自**首破时刻/价格**，盈亏按同卖出路径缩放
- 结果：合计 retA（现行流量口径）66.5% → retB（存量口径）**107.8%（+41.3pp）**；9/13 票 B 更早或同刻放行、4/13 更晚。最大赢家月亮币 B 提前 15s（age 25s 放行 vs 40s）+29.5pp；最大代价 OST −40.1pp——流A=100/存B=64 说明拉升簇**真囤 64% 流通**，存量门等消化 47s 买贵 22%（票终仍 +123.8%）；BNB Legend 流A=100/存B=19=快进快出交易簇被流量门误拦 34s
- 语义分歧本质：流量门拦「10s 内簇主导买盘」（误伤交易簇），存量门拦「簇真持仓≥35%」（对真囤簇更晚放）
- caveat：13 票全是流量门实际放行过的票（选择偏差），无 tB=never 样本；换门是策略库/因子改动须用户裁定，建议方向=加新键（如 bundleClusterHoldCircPct）保留旧键观察
- 详档：auto-memory `bundle-ab-compare`（待写）

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
