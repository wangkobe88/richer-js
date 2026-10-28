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

## 一、现行买腿门链一屏（buy-v2 v46 快照；live v50 `ced5d5a9` 2026-10-28 14:55 UTC 起实跑本屏——T89 门放宽+二次入场+T90 人气门 AND；单卡 BNB 0.002（×2 裁定同日），单票买入 0.008）

```
(tokenAgeSec < 90 OR tradeCount >= 25)                    -- 时窗：90s 快窗 OR 慢热臂（T70/v39：非尘成交≥25 笔，去 600s 帽；preFilter age 无上界=不裁慢热票）
AND marketCap > 4.7 AND marketCap < 27                   -- 市值窗 BNB 域（T84/v43 起 priceBnb×totalSupply 全域 BNB 断代；v34 曾 USD 3.5K-20K）
AND (narrativeRating == 2 OR narrativeRating == 3)        -- 叙事过门（C84 触发模型）
AND holderTrendSlope > 0                                  -- 趋势（slot 化 4 块窗，NULL fail-closed）
AND bundleClusterHoldCircPct < 35                        -- 同块协同簇存量持仓占比（v36 起存量口径；v19-v35 流量口径 bundleClusterSharePct，T1）
AND top2BundleClusterHoldCircPct < 55                    -- 最大两块买家并集持仓（T67/v37；AIFLY 案第二道门，单块退化=top1）
AND top3BundleClusterHoldCircPct < 75                    -- 最大三块买家并集持仓（T68/v38；邪恶卡皮案第三道门，不足三块退化=top2）
AND top1HolderCircPct < 35                                -- 单钱包最大持仓
AND maxCopyWalletHolderCircPct < 20                       -- 跟单名单单钱包最大（NULL fail-closed）
AND (platform != 'flap' OR tradesRouterPct >= 30)         -- flap 臂：聚合路由占比（T70/v39 换全史实时载体；v38 前 early 冻结版）
AND famousCopyWalletCircPct < 15                          -- 极著名钱包（0 语义）
AND (buyVolumeBnb >= 1.25 AND holders >= 10)              -- 人气门（T90/v46 起 AND「量人双达标」防刷量/多钱包微买；v28-v45 曾 OR；T89/v45 恢复原键不去 sybil——ExSybil 键退役出条件串，FA 键保留）
AND (tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40) -- 卖压门 OR 臂（T88/v48 键名断代：全史键 tradesNetBuyRatio 删→长窗尾 100 笔 LongWin、Win→ShortWin 尾 20 笔，环空=null fail-closed/尾窗全卖=-100；回放实证 M 档买点行为全档同帧=断代最小干预，阈值 40 承 T77/T70）
AND sybilClusterHolderCircPct < 60                        -- sybil 大簇合计持仓（0 语义；T89/v45 放宽 35→60）
AND drawdownFromHighest > -70                             -- 崩盘接刀门①（v27）
AND crashSpeedPctPerSec > -10                             -- 崩盘接刀门②（v27）
```

第二层（条件串外，`gmgnCheckCondition`）：`(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100)`（T82/v42 起 <8K→T84 10.7 BNB 早期豁免臂——分母个位数段 ratio 是采样噪声；bundler 门 v31 起 65 → **T89/v45 放宽 100**——蝙蝠币 114.3 连拒 33 次等 mcap 砸回豁免臂）；叙事类型×issuer 分档门（C85 适用集三类；event:W 已撤出=T73；**不被 mcap 豁免盖住**）；GMGN API 失败 fail-open 放行（T14）。买腿 `maxExecutions=2`（**T89/v45 二次入场**：卖出后同腿可再成交一次；卡牌 6 卡帽/单仓语义不变）。

## 二、现行卖腿机制要点

- **sizing=卡牌唯一表达**（cards；sellPercentage 已退役 2026-10-24）；全清腿恒精确 1；卡账本 `cardTrade` 绝对值重放恢复
- 全部卖腿 bypass=false 走 **3.5s+5tick 双门槛确认**（首真起计不重置、断流票不得按陈旧快照卖、maxWait 逃生）；**唯一例外 gang-trail-exit bypass=true**（T83：gang 曲线价纯函数无 tick=价格真冻结+App 确认分钟级人在环，与 AMM 快照失真语境刻意不同）
- 引擎级止损双腿（时间 `profitPercent<=0` / 价格）+ 断流票扫描兜底；用户裁定「所有卖出归卖出策略管」，现行实验以卖腿表达止损
- 毕业卖：four.meme 市值/72 锚 + flap **资金口径**（池净入金，2026-10-24 替换价格锚）；live 毕业票路由 **PCS V2 外盘**（quote 盘二跳）
- 卖臂族：P4 市值清仓 4.5K / 120s 死票清仓 / rug-exit-account-arm（宣告账号删号删推→全清，v29）/ T79 地板 5500 全类目泛化（v43 起 5500+冻结 10s；**2026-10-28 追裁定冻结 10→16s**，现行 BNB 域形状 `<7.4 AND realHoldDuration>16 AND entryMcap 豁免臂`，v46 生效）/ **T80 回撤锁盈减仓臂·中档 -15（`peakProfitPct>=10 AND dd<=-15 AND 6K<=mcap<20K` 卖 1 卡 cd300s，priority 10 先于拱形 -35 全清；v44 `5be4c248` 2026-10-28 02:30 UTC 起实跑）**
- 手动交易四按钮（live/virtual，2s 轮询 CAS + 停止卖出锁）

---

## 三、Case 档案

### 甲、买腿门与策略库

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
