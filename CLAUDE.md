# CLAUDE.md

Richer-js：BSC four.meme + flap meme 币自动交易引擎（BSC-only）。代币发现与价格 = **实验进程内嵌 ANKR WSS collector 直连**（订阅 four.meme TokenManager + flap Portal，全事件驱动无轮询）：实验进程自己持有 WSS 订阅，引擎直接消费 collector 内存回调，DB 落库（`wss_price_ticks`/`wss_events`）仅作持久化（回测/web/离线分析数据源）。支持虚拟（模拟盘）、回测（tick 回放）、live 实盘；内含叙事分析引擎（Jev 结构化决策模型）。

**本文只留现行机制、铁律与操作入口。** 决策过程、case 复盘、验证数据不写入：
- 叙事 case 全档案：`docs/叙事引擎改进与Case台账.md`（卷二，C36 起）+ `docs/叙事引擎改进与Case台账-卷一归档.md`（C1-C35）；**每个新 case/改进须同步追加台账**
- 交易机制案档案：auto-memory（`~/.claude/.../memory/`，索引 MEMORY.md）
- 历史实现：git 历史

## 常用命令

```bash
npm start                                  # 实验管理 CLI（交互式 start/stop）
npm run dev
npm run web                                # Web 界面（端口 3010）
node src/run-engine.js <experiment_id>     # 单实验直跑（virtual；live 显式拒绝）
npm run narrative-engine                   # 叙事分析 worker
node scripts/scan-unknown-factor-conditions.cjs   # 存量条件未知因子扫描（退出码 1=有命中）
NODE_OPTIONS=--max-old-space-size=12288 node scripts/build-wallet-profiles.cjs --threshold 3 --days 14
                                           # TPA 离线画像（只在 182 跑；须在 build-token-profiles 之后，依赖 flash_crash_period）
```

无测试框架/CI。单测 = `scripts/_test_*.cjs`（69 个），**零 DB 零网络**（打桩 dbManager/provider/fetch），`node scripts/_test_xxx.cjs` 直接跑，断言失败退出非零；改到哪块跑哪块。分组速查（名字自述的不再注释）：

- **采集/直连**：`_test_embedded_collector_architecture`（引擎接线/stop 顺序/setExperimentId 防线）、`_test_run_engine_graceful_stop`（信号注册先于 start+回测停机刷缓冲）、`_test_sender_resolver`（sender=tx.from 解析）、`_test_watcher_quote_conversion`（flap quote 映射持久化/回放）、`_test_recent_ticks_scan`、`_test_early_replay_index`
- **回测**：`_test_backtest_tick_cache`（装载缓存状态机/锚定无序拉取）、`_test_backtest_chain_order`（链上真序回放）、`_test_backtest_keyset_paging`（⚠498f3ff 锚定无序重构后存量失败待裁定，新形状由 tick_cache 覆盖）、`_test_backtest_narrative_gate`、`_test_backtest_perf_probe`、`_test_backtest_write_buffer_async`（P4c flush 异步化：swap/串行化/同批合并锚点/段边界源码口径）、`_test_backtest_load_pool`（P5 装载段并发池：顺序保真/有界并发/fail-loud/三处接线+查询形状锁定）、`_test_backtest_preload_overlap`（P13 装载流水线：组 A 与 ticks 并行/组 B 依赖序/TPA 末位/失败语义三态/源码口径）、`_test_fa_prefilter`
- **引擎机制**：`_test_card_position_mechanisms`、`_test_holdings_replay_precision`（重放精度钳制+单票隔离）、`_test_stop_loss_rules`（止损+graduation 回放矩阵）、`_test_graduation_sell_and_anchor`、`_test_sell_debounce_mechanisms`、`_test_token_pool_buytime`、`_test_token_age_sec`、`_test_token_cycle_routing`、`_test_fourmeme_fa_factors`、`_test_fa_wallet_denomination`（holders 族 wallet 口径）、`_test_market_regime`
- **pre-buy/钱包**：`_test_sniper_factor`（+`_test_sniper_cache_probe` P11 查询探针+P12 全表预载：计数透传/预载后 miss 零查询/中途失败 fail-open 回退现查/源码口径）、`_test_top1_buy_share`、`_test_sender_switch_and_router`（sender COALESCE+router 因子）、`_test_corpus_lag_factor`、`_test_same_name_snapshot`（AVE 同名快照 as-of/发布前过滤/SI 事故反证）、`_test_prebuy_known_factor_short_circuit`（P4a 恒假合取项短路：等价性采样对拍/knownCtx 防漂移/未知因子防误拦；P4b 引擎层上移：排除键防线/判定点顺序/单源对拍）、`_test_prebuy_creator_dev_cache`（P9 dev 名单进程内缓存：一次查询/失败重试/大小写/import 移除结构性锁）、`_test_prebuy_overlap`（P10 早发并发：三项早发时序/cluster-strong 依赖序/拒绝传播/unhandled 防线/源码口径）、`_test_wallet_profile_builder`、`_test_wallet_scorer`、`_test_tpa`、`_test_token_classifier`
- **策略/条件**：`_test_strategy_library_groups`（groups 转换/等价/validateLegs）、`_test_unknown_factor_reject`（未知因子 fail-fast 三层防线）
- **live**：`_test_live_hardening`（assertMinOut/_awaitReceipt/FlapPortalTrader）
- **叙事链路**：`_test_precheck_fail_retry`、`_test_narrative_signal_gate`、`_test_narrative_memcache`、`_test_narrative_preload`、`_test_tweet_pull_optimization`（CA 早停+userId 缓存）、`_test_same_name_appendix_shortcut`、`_test_same_name_snapshot`（AVE 同名快照 as-of/发布前过滤）、`_test_narrative_leader_incremental`（同叙事龙头 L1/L2 增量缓存 + P3d 批量聚合 + P6 回放内存行源三实例 bit-identical 对拍）、`_test_rule5_pass_through`、`_test_data_fetch_failed_rating`、`_test_issuer_ca_detection`、`_test_narrator_two_shapes`、`_test_unrated_elimination`、`_test_daily_parse_summary`、`_test_news_monitor`
- **Jev 门/豁免**：`_test_publisher_proxy`、`_test_web3_fit`、`_test_web3_fit_anchor`、`_test_cashtag_w_route`、`_test_jev_product_entity`、`_test_notable_other_exit`、`_test_referent_memeability`、`_test_subject_carrier`、`_test_brand_hijack_pun_exemption`、`_test_w_interaction_exempt`、`_test_superip_relevance_exempt`、`_test_community_name_exemption`、`_test_gmgn_risk_factors`、`_test_gmgn_superip_tweet_enrich`
- **抓取器**：`_test_instagram_pipeline`、`_test_twitter_community_pipeline`、`_test_tweet_image_analysis`、`_test_web_fetcher_jina_fallback`、`_test_youtube_fetcher`

## 架构总览

### 入口

`main.js`（实验 CLI）/ `src/run-engine.js`（单实验）/ `src/web-server.js`（Web 3010）/ `src/narrative/engine/start.mjs`（叙事 worker）。

### 引擎与采集（直连架构）

- 三引擎（`src/trading-engine/implementations/`）：`FourMemeWssTradingEngine`（virtual+live 同体）、`FlapWssTradingEngine`（extends 前者）、`BacktestEngine`（回放同一因子-策略管线）
- WSS 订阅由实验进程自己持有：`_createCollectors()` per `_wsPlatforms()`（both=双 collector）。引擎直接消费 collector 内存回调（零 DB 中转），既有 `factorsUpdated → OPB/卖腿实时/买腿 debounce` 管线零改动
- collector 要点：
  - tick 三路输出（`_emitTick` 实时）：pool.updatePrice / tickBuffer 批量落库（500ms flush）/ FA.processTick；price_outlier 在行入 buffer 前定值（首写者口径）；尘 tick（< minTickBnb）只落表不进因子
  - `token_create` → FA.registerToken（meta 带 platform 键）+ `_handleNewToken`；`graduation` → `_handleGraduation` 毕业卖
  - `WssEventWriter`（共享单实例）持续写 wss_events（30s 重试队列，create 行丢=token 永久不可见）；`SenderResolver`（共享单实例，`config.senderResolve` 默认开）解析 `sender_address`=tx.from：EOA 缓存命中同步进 buffer，合约/未知走 RPC 回查，失败/溢出/停机 → NULL 保行不丢（绝不冒充）
  - TPA live 三件套（initLiveTicksBuffer/preloadRecentTicks/ingestLiveTick）+ `_onTickBuffered` 钩子 → 运行期零 DB ticks 查询；缺口只计数不回退 DB
  - 60s 断流自愈（静默≥5min forceReconnect）+ 15min wss_down 告警（判据 `collector.getLastMessageAt()`）
  - logs 订阅带 topic0 白名单（TOPIC0_MAP）；unknownTopic0 计数归零=新事件类型发现盲化，诊断时临时去掉 topics 字段重订阅
- **stop 顺序：eventWriter → senderResolver → collectors（★尾两步顺序错误=丢行）**
- 采集覆盖口径（用户裁定）：现役 both 实跑实验即事实采集器（单平台实验只持单 collector，兜底实验必须是 both）；无实验运行期接受采集空洞；实验进程崩溃=采集断流，接受风险不加 watchdog；flap quote 缺口由下次 flap collector 启动 getLogs 增量回放自动补齐

### 直连口径

1. `wss_price_ticks` 新行 `experiment_id=NULL`（免疫删实验级联；删历史实验仍级联删其名下旧行）；引擎**绝不调 `collector.setExperimentId`**（单测源码口径锁定）
2. tvl 因子恒 0（对齐 DB 行/回测口径，虚拟/回测不分叉）
3. price_outlier INSERT 携带最终 flag（多实验并发 UNIQUE first-writer-wins）
4. 实验级 collector 配置覆盖生效：实验 config 的 `fourmemeWs/flapWs` 段（contracts/tickBuffer/reconnect/endpoint）per-platform 浅合并
5. 端到端延迟实时（内存回调零中转；尾部新鲜度由 tickBuffer 500ms 对齐）
6. wss-down-guard 判据 `collector.getLastMessageAt()`（≥5min 每轮踢 forceReconnect，≥15min status='wss_down'）
7. flap QuoteSet 映射持久化：非 BNB 计价盘 token→quote 映射实时落 wss_events（kind='token_quote_set'）；collector 启动先 `_loadQuoteMapFromDb` 重建终态（乱序行按 blockNumber,logIndex 排序应用），回放窗 [水位-100, head] 增量补停机缺口，回放结果不落库；DB 空首启走 `flapWs.quoteRate.fullBackfillMinutes`（默认 43200）。汇率换算三级源（PCS V2 reserves → PCS V3 最深池 slot0 → V3 quote/USDT ÷ bnbUsd）；零流动性 V3 池挂价不可信必须拦；三级全 miss 跳行宁跳不冒充；BNB 盘 quote_token=NULL

### BacktestEngine

- **token 集合 + platform 口径**（不按 experiment_id）：token 地址 100/批 `.in` + platform **单值 `.eq` 循环**（`.in` 多值等价无过滤，planner 弃索引 statement timeout）；分块拉取后全局**链上真序 `(block_number, log_index)` 归并排序**（bigserial 分配序≠提交序，`sort(id)` 会把未来行提前喂进 FA=前视；真序下 block_time 应单调，倒退行 WARN）
- **ticks 装载缓存** `src/trading-engine/core/BacktestTickCache.js`：粒度 `(sourceExperimentId, platform)` 一文件 `data/tick-cache/backtest/<src>/<platform>.jsonl.gz` + .meta.json；**缓存存全量、运行期过滤**（时间窗/映射在内存层，任意窗口共用、与直拉 bit-identical）。状态机 MISS/FRESH/STALE（锚定探针+锚行 PK 核验→增量 `.gt(id, maxId)`）/bypass（探针失败 WARN+直拉）/表回缩（drop 重拉）。**探针与装载拉取都必须锚定无序形状**（`id > 锚` + 无 ORDER BY LIMIT 1 / 无序 limit N；`ORDER BY id DESC` 和 `ORDER BY id + in(N)` 形状 planner 稳定弃索引 8s 超时——两轮事故终版）；装载闭区间 `.lte(id, headAnchor)` 封死中途新写入；`maxTickRows` 护栏默认 100 万，**多天大窗口须实验级显式放宽**；加列（columnsTag 漂移）→ 缓存全量重拉一次（设计内）；磁盘无自动清理
- **graduation 事件回放 + 止损双腿**（虚拟↔回测一致性）：`_loadGraduationEvents`（wss_events kind='graduation'，tsMs 锚=payload.blockTimeMs||block_time）→ 主循环 `_consumeGraduationEvents(tickTs)` 消费指针（未持仓仅推进；卖出失败不推进=每 tick 重试）+ 回放收尾 drain(Infinity) + 买入成功点补卖 → `_emitGraduationSell` 等价 `graduationSell` 全清（幂等标记 `_graduationSoldTokens` 后置到卖出成功）。**`_graduatedTokens` 事件到达标记在消费点填充，禁止装载即填**（前视事故防线：装载即填把「未来才毕业」提前暴露给补卖判据）。止损 `_stopLossHit`/`_emitStopLossSell`（5 参虚拟时钟）tick 路径优先于策略腿 + `_scanHoldingsStopLoss(tickTs)` 节流扫描兜底断流票
- **`backtest.stripSenderAddress` 对照臂开关**：剥内存 tick 的 sender → 消费侧 COALESCE 点全部回退 trader（=修正前行为 bit-identical；只剥内存 tick 不动缓存 raw 行）
- 回测不嵌 OPB（无写表副作用）；`_alignClassifiedAsOf=true`（category_visible_at > asOf 的分类视为未见，TPA 防前视）；回测侧叙事直调同链路（时漏已知，只比相对增量）

### 双平台实验（platform='both'）

- 单引擎实例 per-token 分派：`_handleNewToken(info, platform)` 按 collector 回调平台分派 `_buildFourMemeTokenRecord`/`_buildFlapTokenRecord`，共用买/卖策略与单一资金池（PM 单组合）
- 归一化唯一入口 `resolvePlatforms(platform)`（`src/trading-engine/core/platforms.js`）：'both'→两平台，其余→fourmeme
- 范围 virtual+backtest+单平台 live；**双平台 live 三重防线禁止**（web 400 / main `_createEngine` throw / 前端拦截）
- 引擎级配置恒读 fourmemeWs 段（`_wsConfigSectionName()`，flap 子类才覆盖 flapWs）；创建页平台选择=多选 checkbox

### 钱包口径地图（sender/trader——改任何聚合前先查）

`trader_address` = 事件 msg.sender（公共路由 0x1de460…4bc = **GMGN BSC 聚合路由**，flap 27.9% 行落它）；`sender_address` = 真实发起 EOA（tx.from，BSC 恒 EOA）；NULL = 未解析回退 trader（=EOA 直连旧行为等价）。

- **wallet = `sender_address || trader_address` 已切**：EarlyParticipant 90s 窗全部因子（top1/sniper/netBuy/uniform/WalletCluster）、FA holders 族（holderCount/P 组集中度/bigHolder 交叉/K 组对敲/cumBuy/滑窗/smartBot 名单）
- **TPA + 离线画像库：wallet 口径**（二期起，含 retention 基准 `_walletNetTokens` 双 map；GMGN 用户刻意不剔 retention）
- **刻意不切**：`uniqueTraders`（classifier metrics 契约字段，与离线 classifyToken 口径锁定防漂移）；routerPct 因子判 **trader 层**（`AGGREGATOR_ROUTER_ADDRS`，`src/trading-engine/pre-check/aggregator-routers.js`，Set 便于扩展）
- GMGN 行为 map：FA `processTick` 写 `_walletRoutedBuyBnb`（GMGN 行归 sender EOA 累加，只记买腿）→ TPA gmgnFilter 消费
- OPB 全史路径/离线 build-token-profiles 不动（trader 口径链）

### Pre-Buy 检查（`src/trading-engine/pre-check/`）

`PreBuyCheckService.performAllChecks()` → EarlyParticipantCheckService（首 90s 窗，查 `wss_price_ticks`，行映射 AVE-trade 形状供 WalletCluster/WalletLabel/TokenHolder 复用）+ TokenHolderService（AVE holder 黑名单）。**因子恒算无开关**，落 signal metadata `preBuyCheckFactors`；只在买策略定义 `preBuyCheckCondition`/`repeatBuyCheckCondition` 时生效（老克隆实验无此字段=裸买）。空窗返回真实零统计（拒绝语义），查询错误才走宽松值。**P4a 已知因子合取项短路**（2026-10-12）：条件顶层 AND 项内全部因子「检查前已知」（引擎 options 透传：narrativeRating/platform/earlyReturn/lag/GMGN 等 17 键）且当次评估恒假 → 整条条件必 false → 跳过全部子检查直接 canBuy=false（数学等价，rating 翻正透传值即变自动解除；宣告竞态重试窗语义不变）。live 默认关零变化；回测 `backtest.knownFactorShortCircuit ?? true` 默认开（perf3 画像 44.5% 检查 rating=1 恒拦纯浪费 ≈墙钟 23%）。防线：项内混未知因子（earlyTrades* 检查产物）一律不评（undefined→false 误拦）；knownCtx 17 键与生产 context 逐键对拍防漂移（单测 `_test_prebuy_known_factor_short_circuit`）。**P4b 引擎层短路上移**（2026-10-12）：P4a 挡不住引擎层同叙事龙头检查（perf4 对拍龙头 6767 次全等 avg 72ms≈段墙钟 23%）——判定点移到直调拉黑登记后、龙头检查前，命中恒假项跳过龙头+preBuy；龙头三键在判定点无值从已知集**排除**（`_evaluateKnownFalseTerm` 第三参 excludeKeys，含龙头键的项不评 fail-open 防默认值 0 误短路 `narrativeLeaderHot != 0` 形状，由 P4a 内层在龙头跑完后接管）；lastPairReturnRate/faBirthMs/lag 计算上移单源防双源漂移。

90s 窗因子族（同一窗 trades 零额外查询）：

| 因子族 | 口径 | 拦截写法（策略侧） |
|---|---|---|
| `earlyTradesTop1BuySharePct`（+Top1BuyBnb/BuyBnb/Covered） | 首窗**纯买入** BNB 按钱包聚合最大占比；协议地址双地址层剔除；刻意不含卖腿 | `tokenAgeSec < 90 AND pct < 60 AND covered == 1`（90s 窗+covered 必须带，过期洞事故修正版） |
| `earlyTradesRouterPct`（+Covered） | **trader 层**落聚合路由合约的买入占比 | `< 60` |
| `earlyTradesSniperHoldingPct`（+SniperWallets/SniperHolders/Covered） | sniper（`isSniperProfile`：`tokenCount>=100 AND (medianHoldSeconds∈[0,300) OR (null AND sym<0.1 AND 笔数>=40))`，协议地址排除，画像 miss=非 sniper；`src/trading-engine/pre-check/sniper-detector.js`）正持仓 Σ/正持仓池 Σ×100 | `< 50`（伴随 SnipersWallets ≥2） |
| `narrativeCorpusLagSec` | FA 出生锚（live=TokenCreate 块时间/回测=discovered_at）−语料最早推文时间（主推与父推取更早）；负值=宣告竞态按早票放行；**null=无语料/无锚 → 落晚票严格门 fail-closed**（早票是证据门，无证据不放行） | `lag < 300 OR earlyReturn >= 100` |
| `strictSameNameTokenCount`（AVE 同名簇） | **回测=as-of 快照优先**：实时引擎真调 AVE 成功后 append 写 `ave_same_name_snapshots`（6h 节流/7 字段裁剪，全局资产不挂实验 FK）；回测取 `searched_at<=asOf` 最近快照，miss 才兜底实时且行级过滤 `created_at>0 && <=launchAt`（未来同名盘不计入，宁拦不冒充）；实时路径零变化。写端 snapshotWriter 由 PreBuyCheckService 注入（supabase 缺=不写） | `>= 3` |

- **covered 语义**（top1/router/sniper 同构）：age>90s 或 launchAt 缺失 → 0 值放行（null 会让 `<N` 恒 false 误拦）
- 因子注入链（narrativeCorpusLagSec 同款五步）：service → 引擎 → PreBuyCheckService context（键集真相源=空壳跑 `_evaluateWithCondition` 捕获实收键）→ FactorBuilder 时序快照

### 条件未知因子 fail-fast（三层防线，hg55 事故）

写错因子名的条件子句静默恒真/恒假（比较恒 false / IS NULL 恒 true），必须拒启而非 warn：① `ConditionEvaluator.validateCondition` 含 IS NULL/IS NOT NULL operand 检查；② `StrategyEngine.loadStrategies` 校验失败 **throw**（`condition`/`narrativeCallCondition` 用 FA 因子集，`preBuyCheckCondition`/`repeatBuyCheckCondition` 用 PreBuy 键集，分集防双向误报）；③ `StrategyLibraryService.validateLegs` 入库同口径 400。上线前跑 `scan-unknown-factor-conditions.cjs`。

### FA（`src/services/FourMemeFactorAggregator.js`）

- `_buildFactorMap` 字面量键（getFactorKeys 探针自动收键，策略 condition 直接引用）；`tokenAgeSec`=`age×60` 同源双路径（FA 字面量 + FactorBuilder 推导），preFilter 提取 /60 归并 age 区间，快照白名单落库
- **周期分桶路由**：双主量 `tps30s`（30s 滑窗密度，分母=min(存活,30s)）/`gapMedianMs`（5min 窗间隔中位数）→ 3 热（tps≥0.5 或 gap≤2000）/2 中（≥0.08 或 ≤12000）/1 冷（有证据但低于中档，**或证据不足但已过 warmup=判冷不判 null**）；null 仅 warmup(<15s)/无锚点。hysteresis `_cycleLatch`：升降档驻留 30s；存活<90s（cycleEarlySec）升档免驻留 earlyUp；断流>30s 立即降 1（stale）。**判定内 now 由 `buildFactorMap(state, asOf)` 传入，禁 Date.now（防前视红线）**。参数 11 键三级合并：`FACTOR_PARAM_DEFAULTS < fourmemeWs.factorParams < tokenCycle.params`（`mapCycleParams`，键清单单一事实源 group-variables.js）；开关=`tokenCycle.enforce`（缺段=不写 cycleTag=路由不生效）；带 cycle/groups 腿在 token 无档时 **fail-closed 隐身**（低优腿可顶上，桶切换计数跨桶保留）；切换打 `[CycleSwitch]` 固定格式日志
- 新因子键 5 个：`tokenCycle/tokenCycleRaw/tokenCycleAgeSec/cycleTps30s/cycleGapMedianMs`

### 策略库 + groups 组路由

- `strategy_library` 表（全局，name UNIQUE/side 锁死/legs jsonb/version 乐观并发 409）：腿集合包条目；创建页「📚 从库引用」浮层展开**只读快照卡**（copy-in：实验 config 自包含，改库不影响已建实验，改库须重启实验进程）；`strategiesConfig.libraryRefs` 纯 provenance 元数据
- **routes 必须走 `dbManager.getClient()`（service key）**——anon 被 RLS 静默过滤（wss_price_ticks 同款坑）
- **部署红线：DDL 先于新 web-server 重启存在**（新表/新列同口径）
- groups 表达式（`cycle==3`，支持 AND/OR）：`parseGroupsExpression`（AST 级拒 IS NULL/非数字字面量/未知变量 throw——变量集是注册表闭集）；**脏 groups → 实验拒绝启动**；v1 `cycle` 数字永久接受（loadStrategies 单点转 `cycle==N`）；引用变量任一 null → 腿隐 fail-closed
- 创建页只读化：腿只能来自库引用，无手写入口；`card.dataset.rawConfig` 整包存取（机制字段零损失）；复制链路高级段（tokenCycle/stopLoss/tokenPositionAnalyzer/fourmemeWs）经 `window._copyAdvancedConfig` 表单回填保真；卖腿按桶分组展示但提交序=插入序（`dataset.seq`）

### 卡牌 / 止损 / 毕业卖（引擎级机制，实验 opt-in）

- **卡牌**：开关=`positionManagement.perCardBNB` 存在且 >0（不配=字段全忽略）。策略级 `cards`（卖腿额外接受 'all'）+`cooldownSec`（独立于卡牌）。买入=perCardBNB×cards（virtual 现金门不足=买失败不降张）；卖 sizing soldN/tokenCards（全清腿恒精确 1）；卡账本 `_tokenCards` 维护在 `_executeSell` 成功分支，trades.metadata `cardTrade:{cards,before,after}` 绝对值重放恢复。**重放精度钳制**：遇 `Insufficient token balance` 且差异≤相对 1e-9 → 钳到持有量重试（double 往返固有误差）；真超卖照常失败且**单票失败只跳过不中断其余恢复**
- **止损双腿**：开关=`stopLoss` 段存在任一腿参数。时间止损（持有超 N 分钟仍 `profitPercent <= 0`——`<=` 刻意：断流冻结票 profit 恒 0）/价格止损（`<= 负阈值`）全清，双命中标 price。双挂点=tick 即时（`_stopLossHit` 优先于策略腿）+ `scanIntervalSec` 扫描（**断流票唯一触发路径**，buildFactorMap 必传 Date.now()）；`_emitStopLossSell` 等价策略 `stopLossPrice/stopLossTime` 复用全清链；仅虚拟系引擎（回测有自己的版本）
- **毕业事件驱动卖**：virtual 持仓票 `_handleGraduation` 直接 `_emitGraduationSell` 全清（余仓按断流前最后可靠价落袋；`graduationSell` 幂等，graduation 事件会重复派发）。三挂点：事件路径 + 买入成功点补卖（查 FA `graduated` 标记，事件先于买入的竞态）+ `_scanHoldingsStopLoss` 扫描兜底（事件路径失败的唯一重试）。**flap 毕业锚 per-token**：`graduationProgress` 分母=首市值×`graduationAnchorRatio`(12.5)，仅首 tick 距创建<60s 启用否则退 72 默认锚；platform 经 registerToken meta.platform 键注入（迟到 registerToken 回填更早 createdAt → 窗变大自动退锚）；BacktestEngine 不传 platform=恒 72。live 毕业=Telegram 告警人工处置（TM2 毕业卖出必 revert）

### 信号机制

- **去抖**：买腿 `signalDebounceMs 200 / signalDebounceMaxWaitMs 1000`（slot 级合并：200ms≈0.25×BSC 0.75s 出块，同 slot burst 并成一个、slot 结束即评）；卖腿确认窗 `sellDebounceMs 200`（与买腿语义相反：首真起计**不重置**、窗口内恢复 clear 不卖、fire 重评仍真才卖——「怕被震下去」防线）；bypassDebounce 腿/止损/毕业卖/强平走立即路径。实验级 fourmemeWs 键可覆盖，跑中实验须重启进程生效
- **叙事直调** `narrativeCallCondition`（策略字段）：fire 因子满足（不含 narrativeRating 自身）→ 买腿黑名单检查后、pre-buy 前同步 `NarrativeAnalyzer.analyze()`（`src/trading-engine/pre-check/NarrativeDirectCaller.js`）；Jev 秒级，30s Promise.race 超时（超时的分析后台续跑落缓存，下轮命中）；失败/超时 normalize 9 放行——由 `preBuyCheckCondition` 里 `narrativeRating` 决断；未配置/未触发=恒 9 旧行为。**语法 AND/OR only，`&&`/`||` 被静默截断**。触发轨迹落 metadata `narrativeCall`
- **叙事一票否决**：直调返回 `numericRating=1` → 引擎内存 `_narrativeBlockedTokens` 拉黑（后续 fire 在写 signal 行前短路：无信号无重复调用）；豁免=`precheckStage === 'address'`（宣告竞态）且 age<300s 保留重试窗；rating 9（未知）永不拉黑；内存态重启丢、首 fire 经缓存重建
- **叙事结果=token 级全局缓存**：`token_narrative` 按 token_address upsert，跨实验共享；失效=行删或 `NarrativeRepository.updateIsValid(addr,false)`；**历史窗口回测前先失效缓存**（题集变更后旧缓存行缺新题答案）：`scripts/narrative/invalidate-referent-window.cjs` / `invalidate-carrier-window.cjs`（&lt;基底实验ID&gt; --commit，范围刻意只收窄基底买过的 token）
- `token_category` 列写入：`deriveTokenCategory(prestage, stage1)`；NULL（precheck fail/no_data）**不写键**——失败重析不会抹掉已存分类

### TPA / OPB

- **TPA**（`src/services/TokenPositionAnalyzer.js`，`config.tokenPositionAnalyzer` 段存在才构造）：触发门命中（write-once）对 top20 持仓 as-of 画像，`TPAPre_*` 因子族注入 FA；策略引用未触发的 `TPAPre_*` 恒 null → ConditionEvaluator false=**fail-closed 不买（去门控化）**；触发门校验 fail-fast（时间门 blocks/ageSeconds 恰一，数量门 tradeCount/buyBnb/minHolders 非负）。三路径画像：离线画像 fresh 直用/stale 增量合并/miss 实时拉窗现算。retention 基准=触发刻峰值枚举大户集冻结，此后 running 净持仓重算（净卖<1=走人）。**gmgnFilter**（`{enabled, exemptPct}` 缺省关=存量零变化）：①GMGN 用户钱包（本盘内经聚合路由买入>0）不参与 TPA 分数计算 ②前期参与者 GMGN 占比≥exemptPct → **豁免放行**（不能做成 null——null 在 `TPAPre_tokenScore > 2.5` 下 fail-closed 拦死，与散户盘语义相反）③触发门 minHolders 同步剔非 GMGN；豁免救回时 `TPAPre_gmgnExempt=1` + verdict 改写 approve（blockReasons=['gmgn_exempt']）；`TPAPre_gmgnUserPct` 恒落（disabled 也落纯观察）。BSC 新钱包中性分 2.2（`scoreTokenFromHolders`，非 creator 只升不降——BSC 节奏刻意偏离 pumpfun 母版裁定，观察期后去留用户再定）
- **OPB**（`src/services/OnlineProfileBuilder.js`，`fourmemeWs.onlineProfile.enabled` 默认 false）：实时代币分类，双门触发（idle 60s 无 tick / bigTickIdle 600s 无大额 tick）+ 60s 扫描补救，写 `token_profiles`（token_address 全局 PK，source='online'，不挂实验防级联删）；阈值判定与离线 classifyToken 共用 `scripts/shared/token-classifier.js`（单一真相）；TPA 联动 `onProfileClassified` 喂分类缓存。**重启过渡期全史路径**：水位对齐前的存量活跃 token（FA tick 自动建 state）价格史不完整 → 分类时自动改走 wss_price_ticks 全史 + classifyToken（防涨幅失真）；失败 fail-closed 不写失真行、待扫描重试

### 叙事引擎（`src/narrative/`）

所有 LLM 决策走 **Jev**（api.typesafe.ai，结构化三原语 Choice/Score/Noul，无文本生成，一票一次 fan-out 调用秒级）。

```
Token URL → URL 分类（含 IPFS metadata 解包）→ 数据抓取 → Pre-Check（纯规则）
   ├─ 账号/社区 token 或自发宣告（detectIssuerSelfLaunch 代码判）→ prestage Jev（5 题 P1.9）
   ├─ superIP（prompts/super-ip/super-ip-registry.mjs）→ 快车道（标准题集+代码预分）
   └─ 标准路径：单次 Jev 调用（16 题，J1.29）
```

- **文件**（`analyzer/llm/`）：`JevClient.mjs`（缺答案 id 直接 throw 无吞错；429/5xx 退避）/ `jev-questions.mjs`（标准题集，`buildStandardQuestions`）/ `jev-prestage-questions.mjs`（P1.9）/ `jev-state-builder.mjs`（60k/20k 预算）/ `jev-result-mapper.mjs` / `jev-prestage-mapper.mjs`（**聚合/阈值/截断全在代码侧**）
- **版本规则**：改任何题面必须 bump `JEV_QUESTIONS_VERSION` / `JEV_PRESTAGE_QUESTIONS_VERSION`（prompt_type/prompt_version 落库标识）；校准验证 `scripts/narrative/jev_calibration.mjs` / `jev_prestage_calibration.mjs`（评级一致性+无买线翻转）
- **时间基准**：新鲜度对 **token 创建时间**（`raw_api_data.created_at`）计，绝不用墙钟——重跑/回测/延迟分析幂等；缺创建时间 pre-check 跳过时效规则、Jev state 退墙钟
- **修正教训（改校准必读）**：①题面改锚分不动（J1.16/J1.23 反复实证）——语义修正类措辞能翻 argmax，分数锚定类必须代码侧 mapper 门；②校准重跑必须**逐字复用线上 stage1_prompt.state**（token_narrative 只持久化 twitter_info/classified_urls/extracted_info，binance_square/instagram/website 等语料段不落库，重建 state 会缺语料致档位漂移）
- **图分析**（vision，C58 开启）：主推文第一张图 → Qwen/Qwen3-Omni-30B-A3B-Captioner @ SiliconFlow（OpenAI 兼容端点，key=182 `.env` SILICONFLOW_FALLBACK_KEY；调用恒传 format jpeg）。**prompt 不含 token 名**（视觉层 token 无关=跨 token 缓存健全性；指代判定留给 Jev）；同图缓存（external_resource_cache，resourceType=tweet_image，TTL 90 天）+ in-flight 去重；失败=warn+无图证据（=开启前行为）+不写缓存（失败冷却会灭宣告竞态重试窗）；配置 `config/narrative-engine.json → vision`，enabled 但 key/baseUrl 残缺 throw fail-loud
- **web-fetcher**：直抓失败（403/Cloudflare/超时/抽取<50 字）→ `https://r.jina.ai/<url>` 回退一次（**不得带浏览器 UA**——r.jina.ai 403 伪装 UA，用 `richer-js-narrative/1.0`）；发布时间前插正文供时效题；失败 fail-closed=null 旧行为；单测 `_test_web_fetcher_jina_fallback`
- **推文拉取缓存**（getAccountWithFullTweets 两层）：userInfo handle 级（跨 token 复用）+ tweets **userId 级全量 key**（只存翻满窗口的完整列表，oldestSec≤untilSec 判覆盖）+ **CA 惰性早停**（每页推文地址匹配命中即停，截断列表落 `…:ca:<addr>` 专属 key **不跨 token 共享**；同 token 三调用点共享）；**刻意手工 get/set 不走 CachedFetcher.fetchWithCache**（失败 1h 冷却会灭宣告竞态重试窗）；只缓存成功（防空 stub 毒缓存）
- **PrecheckFailRetryService**（`engine/PrecheckFailRetryService.mjs`，`engine.precheckFailRetry` 配置）：两域重试——`address`（宣告竞态，窗 300s）/`no_public_info`（语料晚到，窗 1800s，先 invalidate GMGN 成功缓存再 `enrichSocialByGmgn:true`）；门：token age（wss_events 最早 token_create 锚，缺锚不重试 fail-closed）+ 新 ticks 增量≥20 自节流 + 尝试<5；DB 一律 dbManager（service key）
- **已定案规则**：规则 5 高影响力+媒体直发**已废**（自填 twitterUrl 白拿 mid 的攻击面，放行走 Jev）；rule 0.52 同名蓝筹**整体废除**（同名≠蹭名，移交叙事层）；规则 0.5 duplicateNarrative appendix 短路（无 appendix 跳 AVE 搜索）；expired_tweet 窗 6h

**叙事门/豁免速查**（判据全文见台账对应 case；审计字段落 stage1.jev.*）：

| 门/豁免 | 判据一句话 | case |
|---|---|---|
| cashtag 改道 W（J1.17） | 语料（含父推）$TICKER 全等 token symbol → 强制 W 数学 | C28 |
| 发布者代理（J1.18） | 骑乘产品影响力由发布者代理：域名词根=token 名+粉丝≥10万+名互斥+非版本词（detectPublisherProxy 代码门） | C29 |
| 角色 IP 豁免（J1.16） | 作品内角色（含音译）归 A 类，routine_content_product 门豁免；作品名币不豁免 | C25 |
| web3 买家视角锚（J1.23） | A 类 strong_fit≥0.5 且 tier<B → effTier 锚 B（正门，只升不封顶 A/S；D/E 档阻断被绕过） | C38 |
| 戏谑关联豁免（J1.24） | 缩写/谐音/拼名梗蹭新鲜热点：brandHijackP≥0.5+within_7d+effTier S/A+可信事件锚全中 → 豁免劫持与关联≤10 截断（关联分照常计入） | C40 |
| W 交互豁免（C42） | native W+effTier S/A+新产品带 P(2)+P(3)≥0.5+wInteraction<10 → 产品/时效双轴归一百分制 | C42 |
| IG 影响力两层（C44） | IG 真数据进 state 评分（无锚）；有链接没抓到数据：A 类+dim2<18 → 锚 18 | C44 |
| notable_other 退出（J1.26） | 知名度是错误轴：nameReferent 阻断质量只留 minor_other+common_word；全类+superIP 通道退出 | C54 |
| 产品实体+接纳门（J1.27） | 主体=产品实体非母公司；se∈{product_functional,product_character} 且 (strong_fit+fit)<0.5 拦；豁免链 pubProxy/rideMass/binanceCorpus/平台官方账号（PLATFORM_OFFICIAL_HANDLES={binance,flapdotsh}）/superIP | C56 |
| 指代 meme 低档门（J1.28） | referent_memeability 标准路径恒带；mem≤1（人名/账号/严肃事务性名称）拦；挂 nameReferent 后、量级门前 | C60 |
| 形象载体门（J1.29） | subject_carrier 三档恒带；C/D 类+carrier∈{improvised,no_visual} 拦；E 类只拦 no_visual；A/B/W/F/G 不碰 | C61 |
| superIP 指代豁免（J1.21） | superIP 语料里的无名对象按类型分流：人名 0 档拦/内容作品 ≥3 双达标豁免 | C33 |
| 图载体豁免（C59） | 图证据（image_analysis 存在）+0&lt;关联≤10+referent_memeability≥3 → 豁免 Stage3 关联截断（分照常计入） | C59 |

### Live 交易

- four.meme 走 `FourMemeDirectTrader`（TokenManager2），flap 走 `FlapPortalTrader`（Portal swapExactInput）；**live 只买 BNB 计价盘**（非 BNB 盘 revert=天然 fail-closed；卖出 token→0x0 全盘支持）
- live 实验只能 `node main.js start-experiment -e <id>` 启动（run-engine 对 live 显式拒绝）
- 实收解析**余额差法**（买入 balanceOf 前后差=税后真相；卖出 BNB 差+gasUsed×gasPrice 补偿）——对税币/非 BNB quote 盘免疫
- 防御层（参数在 default.json `fourmemeWs.live`/`flapWs.live`）：L1 `assertMinOut`（报价/预期 ratio<0.5 拒单；expected 契约必传缺即 throw；卖出无锚 fail-closed 拒裸奔）/ L3 卖出熔断（连败≥5 → 30min 冷却+Telegram）/ L5 `_awaitReceipt`（超时回查一次，**绝不自动重发防双买**；reverted throw）/ `maxPositionTokens`（0=不限只拦新开仓）/ 毕业告警人工处置
- 钱包复用：web 创建 live 实验「复用历史钱包」下拉（`GET /api/live-wallets`，私钥永不回传；两端 ENCRYPTION_KEY 一致）
- runbook `docs/live-acceptance-runbook.md`；**真实资金验收未做**（0.001 BNB 闭环待用户执行）；flap 毕业/非 BNB 盘卖出 revert 属预期 fail-closed

### Web / 数据库 / 配置

- Web：`src/web/` + `src/web-server.js`（3010）；K 线/现价走 wss_price_ticks（tick-kline-service）；AVE 工具端点（/api/ave-*）保留；叙事 UI /narrative-analyzer、/narrative-tasks；TPA 展示 /experiment/:id/position-analysis；signals 页因子 chip 条件驱动（买/预检查条件有啥因子展示啥）
- **RLS 坑**：SUPABASE_ANON_KEY 对 wss_price_ticks/wss_events/strategy_library 被 RLS **静默过滤成空**——远程脚本/routes 一律 `dbManager.getClient()`（service key）
- 删实验=DB 级联（每张实验归属表 experiment_id → experiments ON DELETE CASCADE，web 层只删行）
- 关键表：experiments / strategy_signals / trades / experiment_tokens / experiment_time_series_data / token_monitoring_pool / `wss_price_ticks`（UNIQUE(tx_hash,log_index) 首写者持有行；sender_address=tx.from；quote_token 标记 flap 非 BNB 计价盘）/ `wss_events`（token_create/graduation/token_quote_set 低频事件通道，token 级全局不挂实验）/ strategy_library / token_profiles / wallet_offline_profiles（address PK 全局）/ token_position_analyses（CASCADE 挂 experiments）/ token_narrative（叙事侧 NarrativeRepository 管）
- 链支持 BSC-only：其它链历史实验可读（未知 chain id 原样落穿），交易/配置查询非 BSC throw
- 配置：`config/default.json`（fourmemeWs/flapWs 段：contracts/reconnect/tickBuffer/debounce/live 执行参数 + 策略默认 buyTimeMinutes 1.33 / earlyReturn 80-120 / TP +30% 卖 50%、+50% 清 / 观察窗 30min）；`config/narrative-engine.json`（jev+engine 段，JSON 单一真相源，env 覆盖已移除）；`config/.env`（ANKR_WS_URL / AVE_API_KEY / SUPABASE_URL / SUPABASE_ANON_KEY / ENCRYPTION_KEY / SILICONFLOW_FALLBACK_KEY 等）
- AVE API token 格式 `{address}-{chain}`（如 0x123…abc-bsc）；AVE 只用于 holder/预检工具与分析端点，不用于发现或价格
- `scripts/smart-wallet-mining/` 仍按 experiment_id 口径拉 ticks——对新实验（exp_id=NULL）会**静默拉空**，待改 token 集合口径

## 红线汇总

1. **绝不删有数据的实验行**——删=级联删 wss_price_ticks 历史行（按 experiment_id 竞速归属），全局永久丢；误跑/污染实验只停进程+置 stopped 留行，是否删除必须用户裁定
2. **引擎绝不调 `collector.setExperimentId`**（exp_id=NULL 防线，单测锁定）
3. **远程脚本/routes 查 wss_price_ticks/wss_events/strategy_library 一律 dbManager service key**（anon RLS 静默空）
4. **DDL 先于进程重启**（新列/新表在引用它的代码上线前存在）
5. **回测查询 platform 单值 `.eq` 循环勿 `.in` 多值**；token 地址批 `.in` ≤100；Supabase `.in()` URL 超 8KB（批 50 上限）
6. **FA 周期判定/回测路径禁 Date.now**（now 由 buildFactorMap(state, asOf) 传入，防前视）；`_graduatedTokens` 禁装载即填
7. **narrative 是 ESM（.mjs），交易引擎是 CJS（.js）**——勿混 import
8. BSC-only；双平台 live 三重防线禁止；live 只能 main.js start-experiment 启动
9. **本地不跑重查询/重实验**（直连 Supabase 全表聚合/全史扫描本地 VPN 必超时）——去远程服务器跑；本地只做单条/小结果读取
10. 历史窗口回测先失效叙事缓存（invalidate-*-window.cjs）；校准重跑逐字复用线上 state
11. BacktestTickCache 探针/装载保持锚定无序形状（ORDER BY id 形状会 planner 超时）；maxTickRows 默认 100 万，大窗口显式放宽
12. collector stop 顺序 eventWriter → senderResolver → collectors，不可换
13. 新机制一律配零 DB 零网络单测；事故修复配「事故现场反证」断言（源码口径断言锁定防线）

## 操作指南

### 新增 pre-buy 因子（五步）

1. 因子计算加进对应 service（如 WalletClusterService）；2. 加进该 service `getEmptyFactorValues()`；3. 加进 `PreBuyCheckService._evaluateWithCondition()` context；4. 加进 `FactorBuilder.buildPreBuyCheckFactorValues()`（回测兼容）；5. 加进 `FourMemeWssTradingEngine.js` preBuyCheckFactors 构造（virtual/live）

### 修改 Jev 题集

1. 改 `jev-questions.mjs`/`jev-prestage-questions.mjs` 题面；2. bump 版本常量；3. 聚合语义变了同步对应 mapper；4. 跑校准脚本验证评级一致且无买线翻转；5. **case 与裁定同步台账**（docs/叙事引擎改进与Case台账.md 卷二倒序追加）
