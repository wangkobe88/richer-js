# CLAUDE.md

Richer-js：BSC four.meme + flap meme 币自动交易引擎（BSC-only）。代币发现与价格 = **实验进程内嵌 ANKR WSS collector 直连**（订阅 four.meme TokenManager + flap Portal，全事件驱动无轮询）：实验进程自己持有 WSS 订阅，引擎直接消费 collector 内存回调，DB 落库（`wss_price_ticks`/`wss_events`）仅作持久化（回测/web/离线分析数据源）。支持虚拟（模拟盘）、回测（tick 回放）、live 实盘；内含叙事分析引擎（Jev 结构化决策模型）。

**本文只留现行机制、铁律与操作入口。** 决策过程、case 复盘、验证数据不写入：
- 叙事 case 全档案：`docs/叙事引擎改进与Case台账.md`（卷三，C56 起）+ `docs/叙事引擎改进与Case台账-卷二归档.md`（C36-C54，C55 跳号）+ `docs/叙事引擎改进与Case台账-卷一归档.md`（C1-C35）；**每个新 case/改进须同步追加台账**
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

无测试框架/CI。单测 = `scripts/_test_*.cjs`，**零 DB 零网络**（打桩 dbManager/provider/fetch），`node scripts/_test_xxx.cjs` 直接跑，断言失败退出非零；改到哪块跑哪块（名字自述，事故背景见 memory/台账）：

- **采集/直连**：`_test_embedded_collector_architecture`（引擎接线/stop 顺序/setExperimentId 防线）、`_test_run_engine_graceful_stop`、`_test_sender_resolver`、`_test_fa_deferred_wallet_feeding`、`_test_watcher_quote_conversion`、`_test_recent_ticks_scan`、`_test_early_replay_index`、`_test_tick_buffer_watermark`、`_test_wss_event_writer_retry`
- **回测**：`_test_backtest_tick_cache`、`_test_backtest_chain_order`、`_test_backtest_keyset_paging`（⚠锚定无序重构后存量失败待裁定，新形状由 tick_cache 覆盖）、`_test_backtest_narrative_gate`、`_test_backtest_perf_probe`、`_test_backtest_write_buffer_async`、`_test_backtest_load_pool`、`_test_backtest_preload_overlap`、`_test_backtest_platform_parallel`、`_test_fa_prefilter`、`_test_backtest_fa_prune`、`_test_backtest_tick_build_skip`
- **引擎机制**：`_test_card_position_mechanisms`、`_test_holdings_replay_precision`、`_test_stop_loss_rules`、`_test_sell_leg_scan_fallback`、`_test_prebuy_peak_backfill`（fire 窗峰值回填/双时长/回测 parity）、`_test_graduation_sell_and_anchor`、`_test_sell_debounce_mechanisms`、`_test_token_pool_buytime`、`_test_token_age_sec`、`_test_activity_window_factors`、`_test_fourmeme_fa_factors`、`_test_fa_wallet_denomination`、`_test_market_regime`、`_test_live_prefilter_parity`、`_test_permanent_block_cache`、`_test_k_group_no_materialize`、`_test_wallet_net_single_pass`、`_test_signal_metadata_cache`、`_test_token_pool_eviction`、`_test_timeseries_removal`、`_test_holder_series_rebuild`、`_test_price_series_rebuild`
- **pre-buy/钱包**：`_test_sniper_factor`（+`_test_sniper_cache_probe`）、`_test_top1_buy_share`、`_test_sender_switch_and_router`、`_test_corpus_lag_factor`、`_test_same_name_snapshot`、`_test_gmgn_check_layer`、`_test_prebuy_known_factor_short_circuit`、`_test_prebuy_creator_dev_cache`、`_test_prebuy_overlap`、`_test_wallet_profile_builder`、`_test_wallet_scorer`、`_test_tpa`、`_test_tpa_live_ticks_trim`、`_test_token_classifier`
- **策略/条件/stats**：`_test_strategy_library_validate_legs`、`_test_unknown_factor_reject`、`_test_experiment_stats_fifo`
- **live**：`_test_live_hardening`、`_test_tx_seen_receipt`、`_test_live_decimals_guard`、`_test_live_executor_loading`、`_test_executors_routes`、`_test_manual_trade_queue`、`_test_fourmeme_actual_received`、`_test_nonce_manager`、`_test_gas_dynamic`、`_test_live_nonbnb_buy_allowed`、`_test_buy_circuit_breaker`、`_test_live_dual_platform`、`_test_approve_max_grant`（卖出 MaxUint256 一次授权：两 trader 参数口径/条件结构保留/精确额度残留反证/常量核验）、`_test_live_record_trade_clamp`（P11 记账精度钳制：GROK …907 vs …906 事故现场反证（双字符串构造真精度差，double 同值构造不出）/全 Decimal 比较/真超卖不钳/cash 不足原对账路径/1e-9 阈值边界）、`_test_flap_minout_signal_anchor`（蓝蛙案 minOut 锚取较低者：事故数字反证 473,860<旧 523,926<上块真实可得/平稳暴跌臂 bit 一致/边界等值/L1 正交）、`_test_live_buy_failure_observability`（买入失败 warn 行必打+reason 透传+tradeResult.reason 落库形状）、`_test_logger_console_same_file`（console 复读同 inode 禁用/fd1/fd2/stat 异常保守/缓存）
- **叙事链路**：`_test_precheck_fail_retry`、`_test_narrative_signal_gate`、`_test_narrative_memcache`、`_test_narrative_preload`、`_test_tweet_pull_optimization`、`_test_narrative_timing_probe`、`_test_narrative_parallel_fetch`、`_test_ipfs_race`、`_test_narrative_prefetch`、`_test_same_name_appendix_shortcut`、`_test_same_name_snapshot`、`_test_narrative_leader_incremental`、`_test_rule5_pass_through`、`_test_data_fetch_failed_rating`、`_test_issuer_ca_detection`、`_test_narrator_two_shapes`、`_test_unrated_elimination`、`_test_prestage_project_downgrade`、`_test_daily_parse_summary`、`_test_news_monitor`、`_test_narrative_middle_parallel`、`_test_narrative_vision_prefetch`、`_test_vision_gate`、`_test_website_fetch_removal`、`_test_precheck_parallel_queries`、`_test_twitter_urls_expansion`、`_test_twitter_bucket_overlap`、`_test_http_keepalive`、`_test_justoneapi_timeouts`、`_test_narrative_repo_save_thin`、`_test_jev_client_backoff`、`_test_narrative_account_ttl`、`_test_account_corpus_invalidation`、`_test_narrative_retry_config`、`_test_angle_timing_override`（C68 找角度载体窗 6h+C75 叙事源头陈旧门 30d 双 override：FLY 事故现场 495d 翻 low 反证/宣告推不救/双门 type 互斥/边界/fail-open）、`_test_precheck_tweet_freshness_bucket`、`_test_search_fallback`（C77 空语料搜索兜底：★达阈值才落缓存/旁路行 pre_check_result=null/未达阈值保重试域/lag 隔离源码锁/off=bit-identical/残缺 throw）、`_test_corpus_gate`（C79 语料充分门：陷阱① await 后展开/门关不等 twitter 时序反证/race 2s 上界/清单剔 twitter+websites/douyin 专属版删除反证）、`_test_data_prefetch`、`_test_corpus_ready_prefetch`
- **Jev 门/豁免**：`_test_publisher_proxy`、`_test_web3_fit`、`_test_web3_fit_anchor`、`_test_cashtag_w_route`、`_test_jev_product_entity`、`_test_notable_other_exit`、`_test_referent_memeability`、`_test_subject_carrier`、`_test_brand_hijack_pun_exemption`、`_test_w_interaction_exempt`、`_test_superip_relevance_exempt`、`_test_name_image_consistency`、`_test_community_name_exemption`、`_test_jev_resonance`（C80 E 类感染力折损：蝙蝠侠摇 70.68→75.68 现场 bit-identical 复现/mild 42.84/indifferent 28.92 双拦/strong ×1/A 类不折/W 不触达/缺答案 fail-open/审计四件套）、`_test_gmgn_risk_factors`、`_test_gmgn_superip_tweet_enrich`
- **抓取器**：`_test_instagram_pipeline`、`_test_twitter_community_pipeline`、`_test_tweet_image_analysis`、`_test_web_fetcher_jina_fallback`、`_test_youtube_fetcher`

## 架构总览

### 入口

`main.js`（实验 CLI）/ `src/run-engine.js`（单实验）/ `src/web-server.js`（Web 3010）/ `src/narrative/engine/start.mjs`（叙事 worker）。

### 引擎与采集（直连架构）

- 三引擎（`src/trading-engine/implementations/`）：`FourMemeWssTradingEngine`（virtual+live 同体）、`FlapWssTradingEngine`（extends 前者）、`BacktestEngine`（回放同一因子-策略管线）
- WSS 订阅由实验进程自己持有：`_createCollectors()` per `_wsPlatforms()`（both=双 collector）。引擎直接消费 collector 内存回调（零 DB 中转），`factorsUpdated → OPB/卖腿实时/买腿 debounce` 管线
- collector 要点：
  - tick 三路输出（`_emitTick` 实时）：pool.updatePrice / tickBuffer 批量落库（500ms flush）/ FA.processTick；price_outlier 在行入 buffer 前定值（首写者口径）；尘 tick（< minTickBnb）只落表不进因子；tickBuffer 水位告警（`alertThresholdRows` 默认 10 万，超阈节流+回落恢复日志）**全程零 splice/shift/drop 绝不丢行**
  - `token_create` → FA.registerToken（meta 带 platform 键）+ `_handleNewToken`；`graduation` → `_handleGraduation` 毕业卖
  - `WssEventWriter`（共享单实例）持续写 wss_events：per-row 独立重试队列（一条坏行不再堵全队、survivors 保相对序），**create 行丢=token 永久不可见，绝不丢事件**；`SenderResolver`（共享单实例，`config.senderResolve` 默认开）解析 `sender_address`=tx.from：EOA 缓存命中同步进 buffer，合约/未知走 RPC 回查，失败/溢出/停机 → NULL 保行不丢（绝不冒充）
  - **FA 两阶段喂食**（resolver 开启时）：resolver 分支 submit 前 `_feedFa(…, {deferWallet:true})` 先喂**价格段**（WSS 到达即喂，零回查依赖——fire 价/lastTickAt 不被 RPC 回查延迟与乱序污染），pushRow 回推时 `_feedWallet` → `FA.applyWalletTick` 补 **wallet 段**（holders/K 组/GMGN routedBuy/smartBot 用真 sender 精确计数；`price_accepted` 由价格段 faResult 透传）。EOA 快路两段同 tick 先后执行=零时序差；合约行按回查完成序乱序回推，wallet 聚合任意序重放收敛。无 resolver 直推路径单段零变化（回测同）
  - **chainLate 迟到旧价拦截**：`_lastChainBlock/_lastChainLogIdx` 复合水位，`block < last || (== && logIdx <= last)` 判迟到（`<=` 含同 (block,li) 重复行）→ 跳过 outlier 判定/价格追踪/可靠价链（`_acceptPrice` 有 push/shift 副作用须短路防窗污染），流量/滑窗照计；链证据缺失 fail-open；`lastTickAt` 取 Math.max 不回拨；非 defer 路径 smartBot 原位跑、defer 由 wallet 段补跑
  - **holderTrend 双路径**：非 defer（直推/回测正序）`_pushHolderSeriesPoint` 覆盖快照；defer 路径 `_recordHolderEvent` 事件环形缓冲（≤64 事件），消费点（`buildFactorMap`）`_rebuildHolderSeries` 反推正放重放——窗前态=终态 holderCount 逆向撤销 touched 钱包窗内 delta，再按 block 稳定排序正放（唯一序无关解）
- **TokenPool 监控票淘汰**（默认关）：引擎 5min prune 内仅删 monitoring 超时条目（`tokenPoolEvictMinAgeMs` null=关），过滤 protected set（持仓∪buying/selling∪debounce pending∪恢复锚点）；sold/inactive/exited 刻意不删（sold 票 20min 后可再买）；monitoring 删除副作用=OPB 分类时延粗化到 ≤60s 扫描兜底
- **时序快照机制已停**（用户裁定「代码全停，表保留」）：引擎 30s 时序写入/observer 页/trades 价格线图/StrategyAnalysisService 时序重建分支全删，`experiment_time_series_data` 表与历史数据保留不再写
  - TPA live 三件套（initLiveTicksBuffer/preloadRecentTicks/ingestLiveTick）+ `_onTickBuffered` 钩子 → 运行期零 DB ticks 查询；缺口只计数不回退 DB
  - 60s 断流自愈（静默≥5min forceReconnect）+ 15min wss_down 告警（判据 `collector.getLastMessageAt()`）
  - logs 订阅带 topic0 白名单（TOPIC0_MAP）；unknownTopic0 计数归零=新事件类型发现盲化，诊断时临时去掉 topics 字段重订阅
- **stop 顺序：eventWriter → senderResolver → collectors（★尾两步顺序错误=丢行）**
- 采集覆盖口径（用户裁定）：现役 both 实跑实验即事实采集器（单平台实验只持单 collector，兜底实验必须是 both）；无实验运行期接受采集空洞；实验进程崩溃=采集断流，接受风险不加 watchdog；flap quote 缺口由下次 flap collector 启动 getLogs 增量回放自动补齐

### 直连口径

1. `wss_price_ticks` 新行 `experiment_id=NULL`（免疫删实验级联；删历史实验仍级联删其名下旧行）；引擎**绝不调 `collector.setExperimentId`**（单测锁定）
2. tvl 因子恒 0（对齐 DB 行/回测口径，虚拟/回测不分叉）
3. price_outlier INSERT 携带最终 flag（多实验并发 UNIQUE first-writer-wins）
4. 实验级 collector 配置覆盖：实验 config 的 `fourmemeWs/flapWs` 段（contracts/tickBuffer/reconnect/endpoint）per-platform 浅合并
5. wss-down-guard 判据 `collector.getLastMessageAt()`（≥5min 每轮踢 forceReconnect，≥15min status='wss_down'）
6. flap QuoteSet 映射持久化：非 BNB 计价盘 token→quote 映射实时落 wss_events（kind='token_quote_set'）；collector 启动先 `_loadQuoteMapFromDb` 重建终态（乱序行按 blockNumber,logIndex 排序应用），回放窗 [水位-100, head] 增量补停机缺口，回放结果不落库；DB 空首启走 `flapWs.quoteRate.fullBackfillMinutes`（默认 43200）。汇率换算三级源（PCS V2 reserves → PCS V3 最深池 slot0 → V3 quote/USDT ÷ bnbUsd）；零流动性 V3 池挂价不可信必须拦；三级全 miss 跳行宁跳不冒充；BNB 盘 quote_token=NULL

### BacktestEngine

- **token 集合 + platform 口径**（不按 experiment_id）：token 地址 100/批 `.in` + platform **单值 `.eq` 循环**（`.in` 多值等价无过滤，planner 弃索引 statement timeout）；分块拉取后全局**链上真序 `(block_number, log_index)` 归并排序**（bigserial 分配序≠提交序，`sort(id)` 会把未来行提前喂进 FA=前视；真序下 block_time 应单调，倒退行 WARN）
- **ticks 装载缓存** `src/trading-engine/core/BacktestTickCache.js`：粒度 `(sourceExperimentId, platform)` 一文件 `data/tick-cache/backtest/<src>/<platform>.jsonl.gz` + .meta.json；**缓存存全量、运行期过滤**（时间窗/映射在内存层，任意窗口共用、与直拉 bit-identical）。状态机 MISS/FRESH/STALE（锚定探针+锚行 PK 核验→增量 `.gt(id, maxId)`）/bypass（探针失败 WARN+直拉）/表回缩（drop 重拉）。**探针与装载拉取都必须锚定无序形状**（`id > 锚` + 无 ORDER BY LIMIT 1 / 无序 limit N；`ORDER BY id DESC` 和 `ORDER BY id + in(N)` 形状 planner 稳定弃索引 8s 超时）；装载闭区间 `.lte(id, headAnchor)` 封死中途新写入；`maxTickRows` 护栏默认 100 万，**多天大窗口须实验级显式放宽**；加列（columnsTag 漂移）→ 缓存全量重拉一次（设计内）；磁盘无自动清理。**P15 delta 侧车**：STALE 增量不再重压缩 base——落明文 `<platform>.delta.jsonl`（tmp+rename 整文件原子重写；meta 真源 baseMaxId/baseRows/deltaRows，行数不符/文件缺失=损坏 drop 重拉；撕裂尾读满 meta 行数即停+下次 STALE 幂等自愈）；delta ≥30 万行才全量合并重压缩（deltaCompactionRows）；投机读 `_readBaseAndDelta` 与探针并行发起（catch sink 防 unhandled rejection）；v1 旧 meta 缺 delta 键读作无 delta 零强制重建
- **graduation 事件回放 + 止损双腿**（虚拟↔回测一致性）：`_loadGraduationEvents`（wss_events kind='graduation'，tsMs 锚=payload.blockTimeMs||block_time）→ 主循环 `_consumeGraduationEvents(tickTs)` 消费指针（未持仓仅推进；卖出失败不推进=每 tick 重试）+ 回放收尾 drain(Infinity) + 买入成功点补卖 → `_emitGraduationSell` 等价 `graduationSell` 全清（幂等标记 `_graduationSoldTokens` 后置到卖出成功）。**`_graduatedTokens` 事件到达标记在消费点填充，禁止装载即填**（前视防线）。止损 `_stopLossHit`/`_emitStopLossSell`（虚拟时钟）tick 路径优先于策略腿 + `_scanHoldingsStopLoss(tickTs)` 节流扫描兜底断流票
- **`backtest.stripSenderAddress` 对照臂开关**：剥内存 tick 的 sender → 消费侧 COALESCE 点全部回退 trader（=修正前行为 bit-identical；只剥内存 tick 不动缓存 raw 行）
- **`backtest.tickBuildSkip` 默认开**：未持仓票 tick 路径不再全量 build——出窗票 `FA.shouldSkipTickBuild` 谓词跳过、买窗内 C 类票喂最小 factors（fire 时 `_runBuyEvaluation` 独立全量重建，快照白名单不受影响）；显式 `false` 恢复恒 build 旧行为；act\* 滑窗因子纯函数读取与 skip 天然兼容
- 回测不嵌 OPB（无写表副作用）；`_alignClassifiedAsOf=true`（category_visible_at > asOf 的分类视为未见，TPA 防前视）；回测侧叙事直调同链路（时漏已知，只比相对增量）

### 双平台实验（platform='both'）

- 单引擎实例 per-token 分派：`_handleNewToken(info, platform)` 按 collector 回调平台分派 `_buildFourMemeTokenRecord`/`_buildFlapTokenRecord`，共用买/卖策略与单一资金池（PM 单组合）
- 归一化唯一入口 `resolvePlatforms(platform)`（`src/trading-engine/core/platforms.js`）：'both'→两平台，其余→fourmeme
- virtual+backtest+live 全支持（live=单引擎 per-platform trader map——fourmeme→FourMemeDirectTrader / flap→FlapPortalTrader 同一钱包，非首 trader `shareSignerFrom` 共享 wallet+NonceManager=同地址单一 nonce 分配源；买/卖点 `_liveTraderFor(tokenAddress)` 按 token 池/FA 平台标记分派，未知平台 throw fail-closed 拒跨协议盲发；单测 `_test_live_dual_platform`）
- 引擎级配置恒读 fourmemeWs 段（`_wsConfigSectionName()`，flap 子类才覆盖 flapWs）；创建页平台选择=多选 checkbox

### 钱包口径地图（sender/trader——改任何聚合前先查）

`trader_address` = 事件 msg.sender（公共路由 0x1de460…4bc = **GMGN BSC 聚合路由**）；`sender_address` = 真实发起 EOA（tx.from，BSC 恒 EOA）；NULL = 未解析回退 trader（=EOA 直连旧行为等价）。

- **wallet = `sender_address || trader_address` 已切**：EarlyParticipant 90s 窗全部因子（top1/sniper/netBuy/uniform/WalletCluster）、FA holders 族（holderCount/P 组集中度/bigHolder 交叉/K 组对敲/cumBuy/滑窗/smartBot 名单）
- **TPA + 离线画像库：wallet 口径**（GMGN 用户刻意不剔 retention）
- **刻意不切**：`uniqueTraders`（classifier metrics 契约字段，与离线 classifyToken 口径锁定防漂移）；routerPct 因子判 **trader 层**（`AGGREGATOR_ROUTER_ADDRS`，`src/trading-engine/pre-check/aggregator-routers.js`，Set 便于扩展）
- GMGN 行为 map：FA `processTick` 写 `_walletRoutedBuyBnb`（GMGN 行归 sender EOA 累加，只记买腿）→ TPA gmgnFilter 消费
- OPB 全史路径/离线 build-token-profiles 不动（trader 口径链）

### Pre-Buy 检查（`src/trading-engine/pre-check/`）

`PreBuyCheckService.performAllChecks()` → EarlyParticipantCheckService（首 90s 窗，查 `wss_price_ticks`，行映射 AVE-trade 形状供 WalletCluster/WalletLabel/TokenHolder 复用）+ TokenHolderService（AVE holder 黑名单）。**因子恒算无开关**，落 signal metadata `preBuyCheckFactors`；只在买策略定义 `preBuyCheckCondition`/`repeatBuyCheckCondition` 时生效（老克隆实验无此字段=裸买）。空窗返回真实零统计（拒绝语义），查询错误才走宽松值。

- **已知因子合取项短路（P4a+P4b）**：条件顶层 AND 项内全部因子「检查前已知」（引擎 options 透传：narrativeRating/platform/earlyReturn/lag/GMGN 等 17 键）且当次评估恒假 → 整条条件必 false——P4a 跳过全部子检查直接 canBuy=false（数学等价，rating 翻正透传值即变自动解除）；P4b 引擎层判定点在直调拉黑登记后、龙头检查前，命中再跳过龙头+preBuy。live 默认关零变化；回测 `backtest.knownFactorShortCircuit ?? true` 默认开。防线：项内混未知因子（earlyTrades* 检查产物）一律不评（undefined→false 误拦）；龙头三键在判定点无值从已知集**排除**（fail-open 防默认值 0 误短路，由 P4a 内层在龙头跑完后接管）；knownCtx 17 键与生产 context 逐键对拍防漂移（`_test_prebuy_known_factor_short_circuit`）
- 因子注入链（新增因子五步）：service → 引擎 → PreBuyCheckService context（键集真相源=空壳跑 `_evaluateWithCondition` 捕获实收键）→ FactorBuilder 时序快照

90s 窗因子族（同一窗 trades 零额外查询）：

| 因子族 | 口径 | 拦截写法（策略侧） |
|---|---|---|
| `earlyTradesTop1BuySharePct`（+Top1BuyBnb/BuyBnb/Covered） | 首窗**纯买入** BNB 按钱包聚合最大占比；协议地址双地址层剔除；刻意不含卖腿 | `tokenAgeSec < 90 AND pct < 60 AND covered == 1`（90s 窗+covered 必须带） |
| `earlyTradesRouterPct`（+Covered） | **trader 层**落聚合路由合约的买入占比 | `< 60` |
| `earlyTradesSniperHoldingPct`（+SniperWallets/SniperHolders/Covered） | sniper（`isSniperProfile`：`tokenCount>=100 AND (medianHoldSeconds∈[0,300) OR (null AND sym<0.1 AND 笔数>=40))`，协议地址排除，画像 miss=非 sniper；`pre-check/sniper-detector.js`）正持仓 Σ/正持仓池 Σ×100 | `< 50`（伴随 SnipersWallets ≥2） |
| `narrativeCorpusLagSec` | FA 出生锚（live=TokenCreate 块时间/回测=discovered_at）−语料**最新**推文时间（主推/父推/第二推文取 Math.max）；负值=宣告竞态按早票放行；null=无语料/无锚 | **v13 起纯观察键**（计算链不动照落 metadata）；时效硬拦在叙事 precheck 规则 2.1 分桶（C74，见下） |
| `strictSameNameTokenCount`（AVE 同名簇） | **回测=as-of 快照优先**：实时引擎真调 AVE 成功后 append 写 `ave_same_name_snapshots`（6h 节流/7 字段裁剪，全局资产不挂实验 FK；写端 snapshotWriter 由 PreBuyCheckService 注入，supabase 缺=不写）；回测取 `searched_at<=asOf` 最近快照，miss 才兜底实时且行级过滤 `created_at>0 && <=launchAt`（未来同名盘不计入，宁拦不冒充） | `>= 3` |

- **covered 语义**（top1/router/sniper 同构）：age>90s 或 launchAt 缺失 → 0 值放行（null 会让 `<N` 恒 false 误拦）

### 买腿第三层 GMGN 条件（`gmgnCheckCondition`）

买腿条件分**三层**：触发（fire `condition` + `narrativeCallCondition` 直调）→ 预检查（`preBuyCheckCondition`/`repeatBuyCheckCondition`）→ **GMGN 条件（可选字段）**——第三层因子在前两层全过、确定要买时才构建=**此刻才真调 GMGN getTokenInfo**（配额最小化+数据天然新鲜；repeat 轮与首轮统一同一条件串）。

- `GmgnRiskCheckService`（`pre-check/GmgnRiskCheckService.js`）：5s 超时 / per-token 5s 成功 TTL（0=每次硬调）+ inflight join / 失败 10s 冷却；**只认自己 fetch 的结果**（不读叙事直调 gmgn_info 快照、不回写 external_resource_cache，防 1d TTL 污染「买前新鲜」语义）；配置 `fourmemeWs.gmgnCheck`（flap 实验经 `_mergedWsConfig` 同键）
- **fail-closed 机制硬拒**：API 失败/超时/GMGN 未索引/key 缺失 → covered=0 直接拒（不评估表达式——「不确定就不买」由机制保证；与 preBuy 键集 gmgn 三键 covered=0 放行语义刻意相反：被动顺带数据宽容 vs 显式风险门严格）
- 因子固定四键 `gmgnBundlerWalletRatio/gmgnIssuerTokenCount/gmgnRiskCovered/gmgnVisitingCount`（`mapGmgnRiskFactors` 单点映射；info→risk 提取抽 `src/core/gmgn-api/risk-fields.js` 与叙事侧共用防漂移；visitingCount=GMGN 顶层 `visiting_count` 当前访问人数——观测键，**刻意不参与 hasAny**：仅注意力可观测的票不得翻 covered=1）
- 回测同位挂点**不真调 API**：消费直调快照 `narrativeCallInfo.gmgnRisk` → 同款 `evaluateFactors`（快照缺失同 fail-closed 拒；既有时序穿越声明偏拦方向）
- 库 buy-v2 **v11** 门：`gmgnBundlerWalletRatio <= 75`；signal metadata 落 `gmgnCheck` 审计轨迹（拒/过两路径）
- `gmgnCheckCondition` 进未知因子 fail-fast 三层防线（loadStrategies 第四键集 / validateLegs / scan 脚本同口径）

### 条件未知因子 fail-fast（三层防线）

写错因子名的条件子句静默恒真/恒假（比较恒 false / IS NULL 恒 true），必须拒启而非 warn：① `ConditionEvaluator.validateCondition` 含 IS NULL/IS NOT NULL operand 检查；② `StrategyEngine.loadStrategies` 校验失败 **throw**（`condition`/`narrativeCallCondition` 用 FA 因子集，`preBuyCheckCondition`/`repeatBuyCheckCondition` 用 PreBuy 键集，`gmgnCheckCondition` 用 GMGN 三键集——第四参数缺省不校验，存量调用形状零影响，分集防双向误报）；③ `StrategyLibraryService.validateLegs` 入库同口径 400。上线前跑 `scan-unknown-factor-conditions.cjs`。

### FA（`src/services/FourMemeFactorAggregator.js`）

- `_buildFactorMap` 字面量键（getFactorKeys 探针自动收键，策略 condition 直接引用）；`tokenAgeSec`=`age×60` 同源双路径（FA 字面量 + FactorBuilder 推导），preFilter 提取 /60 归并 age 区间，快照白名单落库
- **跟单簇名单 + `maxCopyWalletHolderCircPct`**（FLY 案 2026-10-16）：`config/rosters/copy-wallet-roster.json`（172=37 著名+135 跟班）模块级 Set（sniper/smartBot 同款 loader，两引擎构造器接线）；因子=名单钱包**单钱包最大**净持仓÷流通（刻意最大非合计——热门票聪明钱合计必误伤）；名单 null→因子恒 null→`<N` 门恒 false=拒买 fail-closed。生成=`scripts/scan-copy-trade-clusters.cjs`（档 B：pair co≥50 + memberNeedsLeader 挂靠门 + 成对指纹≥5 同步清仓或≥10 等额复制；pair 统计缓存 `data/offline-cache/copy-trade-pairs.json.gz`，`--from-cache` 调参零网络）；维护=182 重跑 `--commit` → push → 重启实验生效（静态快照）；单测 `_test_copy_wallet_roster_factors`
- **preFilter live 平移默认开**：实时引擎 `_initializeDataSources` 从各买腿 condition **AST**（e50 教训：String() 化恒 null 静默失效，必须 AST 直传）提取 age 区间注入 `setPreFilter`——出窗未持仓票 build 返回 null → processTick/applyWalletTick 尾部不 emit factorsUpdated（出窗票零买腿/卖腿/TPA/OPB per-tick 评估，与回测 tickBuildSkip build-null 同族副作用序列）。持仓豁免=`_positions.size===0` 门结构性保证；状态累计照常（emit 严格子集、共同 ts factors bit 一致，`_test_live_prefilter_parity` 对拍锁定）。开关 `fourmemeWs.faPreFilter !== false` 默认开（flap 经 `_mergedWsConfig` 同键）。单次 build 内部等价削减：K 组对敲两趟无 Set 物化、`_walletNetTokens` 三趟合一（top3/5 从 top20 前缀派生）——bit 一致单测锁定
- **交易活跃度滑窗 act\* 8 键**（取代 cycle 分桶路由）：`actBuyBnb/actSellBnb/actNetBnb/actTrades/actTraders/actBuyers/actSellers/actNewTraders`——`activityWinMs`（默认 10000，用户裁定新发布 Meme 10s 已不小；`fourmemeWs.factorParams` 可覆盖）窗内单趟派生；wallet=`sender||trader` 口径（null wallet 行计量不计人）；actNewTraders=首见时刻也落窗内的钱包数（`_walletFirstSeenTs` 全史 min，per-wallet 恰一次）。写点 `_applyWalletAggregation` 尾部（到达序 push `_activityEvents` + 首见 min + 摊销裁剪：>64 且头部越过 2×窗才 splice，2× 余量保护 defer 乱序晚到行）；照计语义（无 priceReliable/chainLate 过滤，与 tradeCount 同口径）；读点 `_activityFactors` 纯函数（空窗全 0=有证据零值非 null）→ **与 tickBuildSkip 天然无互斥勿再加防线**；**禁 Date.now（now 由 buildFactorMap(state, asOf) 传入，防前视红线）**；序列不可重建，FactorBuilder 两处快照透传（不落库即丢，holderTrend 先例）
- **holderTrend 族 slot 化**（11 键语义原地改·历史断代，改造前信号 metadata/回测不可比）：原料序列=**blockNumber 桶×8 块≈4s 窗**（`_pushHolderSeriesPoint`，同块覆盖/新块追加/8 块封顶；W=8 与 HolderTrendDetector 内部 maxPoints=8 **必须同改**）；与价格接受链**解耦**（离群/零价 tick 照样推进持有者桶）、blockNumber 缺失不推进；价格 `_priceSeries` 10s 桶不变（trend 族）。门槛：growthRatio 族 ≥2 点、slope/direction 族 ≥4 点（≈2s 出值）。slim 快照含 11 键（序列不可重建）；web 时序直读快照不重算

### 策略库

- `strategy_library` 表（全局，name UNIQUE/side 锁死/legs jsonb/version 乐观并发 409）：腿集合包条目；创建页「📚 从库引用」浮层展开**只读快照卡**（copy-in：实验 config 自包含，改库不影响已建实验，改库须重启实验进程）；`strategiesConfig.libraryRefs` 纯 provenance 元数据
- **routes 必须走 `dbManager.getClient()`（service key）**——anon 被 RLS 静默过滤（wss_price_ticks 同款坑）；**部署红线：DDL 先于新 web-server 重启存在**
- **groups/cycle 已废**：`loadStrategies` 遇腿带 groups（非空）/cycle 字段 **fail-fast throw 拒启**（静默失效=腿恒可见是危险方向）；引擎 strategyArray 刻意原样透传两字段供 fail-fast 识别，**不得剥除**。存量库条目在库页重新保存/从实验导入时前端自然剥离该字段；存量带 cycle 腿的回测重跑会撞 fail-fast——清理字段后重跑（活跃度维度改用 act\* 滑窗因子）
- 创建页只读化：腿只能来自库引用，无手写入口；`card.dataset.rawConfig` 整包存取（机制字段零损失）；复制链路高级段（stopLoss/tokenPositionAnalyzer/fourmemeWs）经 `window._copyAdvancedConfig` 表单回填保真；卖腿平铺展示、提交序=DOM 序（与买侧同构）

### 卡牌 / 止损 / 毕业卖（引擎级机制，实验 opt-in）

- **卡牌**：开关=`positionManagement.perCardBNB` 存在且 >0（不配=字段全忽略）。策略级 `cards`（卖腿额外接受 'all'）+`cooldownSec`（独立于卡牌）。买入=perCardBNB×cards（virtual 现金门不足=买失败不降张）；卖 sizing soldN/tokenCards（全清腿恒精确 1）；卡账本 `_tokenCards` 维护在 `_executeSell` 成功分支，trades.metadata `cardTrade:{cards,before,after}` 绝对值重放恢复。**重放精度钳制**：遇 `Insufficient token balance` 且差异≤相对 1e-9 → 钳到持有量重试（double 往返固有误差）；真超卖照常失败且**单票失败只跳过不中断其余恢复**
- **止损双腿**：开关=`stopLoss` 段存在任一腿参数。时间止损（持有超 N 分钟仍 `profitPercent <= 0`——`<=` 刻意：断流冻结票 profit 恒 0）/价格止损（`<= 负阈值`）全清，双命中标 price。双挂点=tick 即时（`_stopLossHit` 优先于策略腿）+ `scanIntervalSec` 扫描（**断流票唯一触发路径**，buildFactorMap 必传 Date.now()）；`_emitStopLossSell` 等价策略 `stopLossPrice/stopLossTime` 复用全清链；仅虚拟系引擎（回测有自己的版本）。用户裁定「所有卖出归卖出策略管」：现行实验以卖腿表达止损（bypass=false 走确认窗、刻意不设 maxExecutions=卖出失败每轮重试直到清仓）；其余带 stopLoss 段实验不动
- **持仓卖腿兜底扫描**：`_scanHoldingsStopLoss` 除引擎级止损外新增卖腿评估——断流票（>60s 无 tick，FA `lastTickAt` 判据）调 `_evaluateSellPath`（bypass 腿立即卖/默认腿 touch 确认去抖，real 模式 setTimeout fire 重评）；活跃票不评（tick 路径已实时覆盖）。启用=存在卖腿（`_sellLegScanEnabled`）；周期 `stopLoss.scanIntervalSec ?? sellScanIntervalSec ?? 30s`；stopLoss 段启用但未配 scanIntervalSec 的存量实验止损仍仅 tick 路径（存量语义不变），卖腿部分按缺省周期起
- **买锚 fire 价口径 + 双时长/执行键（2026-10-15 双口径裁定）**：FA `buyPriceBnb` 定在买信号 **fire 时刻**（`_runBuyEvaluation` 捕获 `factorResults.currentPriceBnb`，fire→执行间的市场移动不再漂移成本锚），profitPercent/peakProfitPct/drawdown 族全程按 fire 价起算；记账锚 `buyPriceUsd` 不变（live=实际成交价/虚拟=signal.price）；fire 价缺失（quote 映射未就绪）回落执行时刻价；回测 fire==执行同 tick 天然一致零改动；重启恢复锚点（重启后首价近似）与手工交易锚点不动
- **fire 窗峰值回填（0xc7fe…7777 案）**：fire→成交窗（live preBuy/GMGN 检查实测 10-17s）冲高计入信号口径峰值——引擎 fire 点 `markBuyFire(token, firePriceBnb)` 开 pending 双轨峰（peakAny=任意接受价/peakRel=可靠价，推进点与持仓峰同门同价流，outlier/chainLate 天然不推进），买入成功 `setBuyState` 消费回填 `highestPriceSinceBuyBnb`/`peakProfitPct`；失败/异常 finally `clearBuyFire` 兜底；**无 pending 标记时 setBuyState 三项逐位退化为旧行为（回测 parity 红线，单测 `_test_prebuy_peak_backfill`）**
- **双时长 + 执行口径键**：`holdDuration` 重定义=信号（fire）时刻起算（条件触发用；`buySignalAt` 缺省回落 buyTime=手工/恢复锚点/旧形状 bit 一致）；新增 `realHoldDuration`=成交时刻起算（物理持有）；执行键 `buySignalAt/buyExecutedAt/buyExecutedPriceBnb`（live=余额差法成交价，虚拟/回测=null 诚实语义）。两引擎 `_stopLossHit` 时间臂改读 `realHoldDuration`（保命腿=物理持有）；策略腿内 `holdDuration` 语义保持信号口径（用户裁定），P4 市值清仓腿（`marketCap<4500 AND holdDuration>10`）须显式改 `realHoldDuration > 10` 保住「成交后 10s 缓冲」原语义；信号页图表双标记（信号竖线+成交细点线+▲▼成交价点位，`_buildTradeAnnotations`）
- **毕业事件驱动卖**：virtual 持仓票 `_handleGraduation` 直接 `_emitGraduationSell` 全清（余仓按断流前最后可靠价落袋；`graduationSell` 幂等，graduation 事件会重复派发）。三挂点：事件路径 + 买入成功点补卖（查 FA `graduated` 标记，事件先于买入的竞态）+ `_scanHoldingsStopLoss` 扫描兜底（事件路径失败的唯一重试）。**flap 毕业锚 per-token**：`graduationProgress` 分母=首市值×`graduationAnchorRatio`(12.5)，仅首 tick 距创建<60s 启用否则退 72 默认锚；platform 经 registerToken meta.platform 键注入（迟到 registerToken 回填更早 createdAt → 窗变大自动退锚）；BacktestEngine 不传 platform=恒 72。live 毕业=Telegram 告警人工处置（TM2 毕业卖出必 revert）

### 信号机制

- **strategy_signals 进程内缓存**（AbstractTradingEngine 层 `Map<signalId,{row,metadata}>`）：save() 后登记完整行；`_updateSignalMetadata`/`_updateSignalStatus` 缓存命中→本地 merge→UPDATE→**成功才提交缓存，失败 delete 回退 SELECT**（绝不以缓存遮蔽落库失败）；通知侧 createEvent 字段本地组装去重复读；终态落库后 delete（有界）。正确性前提：实验进程是 signal 行唯一写者（单进程直连架构）
- **永久阻断条件编译缓存**：`_evaluatePermanentBlock` 的 `new Function` 结果按 `${jsExpr}\0${keys}` 模块级缓存（两引擎各自 Map），catch fail-open 不变
- **去抖**：买腿 `signalDebounceMs 200 / signalDebounceMaxWaitMs 1000`（slot 级合并：200ms≈0.25×BSC 0.75s 出块，同 slot burst 并成一个、slot 结束即评）；卖腿确认窗 `sellDebounceMs 2500`（与买腿语义相反：首真起计**不重置**、窗口内恢复 clear 不卖、fire 重评仍真才卖——「怕被震下去」防线；0.45s 出块下 2.5s≈5-6 块足够针收回）；bypassDebounce 腿/引擎级止损/毕业卖/强平走立即路径——**现行全部卖腿（含止损臂）已按裁定 bypass=false 走 2.5s 窗**（真跌代价≈多扛 2.5s；2026-10-15 沙县案 :59 回升 tick 晚 0.3s 未能取消 fire，2s→2.5s）。实验级 fourmemeWs 键可覆盖，跑中实验须重启进程生效
- **叙事直调** `narrativeCallCondition`（策略字段）：fire 因子满足（不含 narrativeRating 自身）→ 买腿黑名单检查后、pre-buy 前同步 `NarrativeAnalyzer.analyze()`（`pre-check/NarrativeDirectCaller.js`）；Jev 秒级，30s Promise.race 超时（超时的分析后台续跑落缓存，下轮命中）；失败/超时 normalize 9 放行——由 `preBuyCheckCondition` 里 `narrativeRating` 决断；未配置/未触发=恒 9 旧行为。**语法 AND/OR only，`&&`/`||` 被静默截断**。触发轨迹落 metadata `narrativeCall`（N1 探针含 `timing` 全链分段；N3 含 `prefetchLeadMs` 提前量）
- **叙事预触发（N3）**：开关=`fourmemeWs.narrativePrefetch.enabled`（默认 false；flap 实验配 flapWs 段同键；回测不适用有 preloadCache）。挂 `_onFactorsUpdated` 买腿分支：tick 时刻评估首条买腿 `narrativePrefetchCondition ?? narrativeCallCondition`（新可选字段，不配=用现有条件），满足且未 write-once → 后台 `getRating`（fire-and-forget+catch）。与 fire 直调共用同一 NarrativeDirectCaller 实例：inflight join（fire 等待=剩余时间）/ 已完成行缓存秒回，fire 侧零改动；write-once per-token 无论成败；rating=1 提前登记 `_narrativeBlockedTokens`（address-fail 豁免同款）
- **数据预取门**：开关+条件=`fourmemeWs.dataPrefetch {enabled, condition}`（默认关；flap 单平台实验配 flapWs 段同键；仅实时引擎，BacktestEngine 零接线，回测提交时创建页自动剥离）。挂 `_onFactorsUpdated` 买腿分支（N3 同位）：tick 时刻 FA 因子表评 `condition`（与 fire 同集），过门 write-once 后台预取**宣告推文+首图 vision 分析**（TwitterFetcher.fetchFromUrl → analyzeTweetImage 串联，被调侧 URL 级/同图缓存+inflight 幂等，fire 直调命中同缓存塌缩 fetch+vision 段）；Jev/GMGN 决策类调用刻意不预取。语料来源=`_enrichCorpus` 内存镜像 `_tokenCorpusMap`（miss=补采未完成，不标 write-once 下 tick 天然重试）；账号 URL（无 /status）标 done 跳过（防 fetchFromUrl markFailed 污染冷却行）。未知因子三防线：引擎启动 throw / web 创建 route 400（advancedSections 同时透传 flapWs）/ scan 脚本同口径。**提速②a+②b**：②a `_enrichCorpus` 回调（`_tokenCorpusMap.set` 后）queueMicrotask 即评门 `_dataPrefetchOnCorpusReady`（三重门对齐 tick 路径；buildFactorMap null 容忍不标 done 由 tick 兜底）——补采完成即刻发起不等下 tick；②b `TokenCorpusEnricher.ipfsCacheWriter` 注入（引擎构造点 `createIpfsCacheWriter`）：flap IPFS 分支解包 metadata 后 `await` 写 `external_resource_cache`（键=`normalizeIpfsRef(metaUrl)` 与叙事读侧同函数，resourceType='ipfs_metadata'，TTL 730 天；裸 CID→pinata 形态/S3→null 不写；upsert 顺带覆盖 markFailed 冷却行），叙事直调 ipfs 段塌缩为 DB 读
- **叙事一票否决**：直调返回 `numericRating=1` → 引擎内存 `_narrativeBlockedTokens` 拉黑（后续 fire 在写 signal 行前短路：无信号无重复调用）；豁免=`precheckStage === 'address'`（宣告竞态）且 age<300s 保留重试窗；rating 9（未知）永不拉黑；内存态重启丢、首 fire 经缓存重建
- **账号型未过缓存 TTL 穿透重析**：语料入口只有账号（`isAccountOnlySource`：twitter 桶非空且全部 type==='account'，账号时间线=动态语料）且 rating=1 的缓存行，行龄≥TTL → 当次穿透 `analyze({ignoreCache:true, invalidateAccountCorpus:true})` 重析——**invalidateAccountCorpus 失效 external_resource_cache 三键**（`twitter_user_info:<handle>` 30d + `twitter_user_tweets:<userId>` + `…:ca:<addr>`；userId 从失效前旧行读，读不到只失效 userKey；`twitter_account` 层刻意不失效）；失效下沉 getAccountWithFullTweets 内部且带同款语料形状门（非账号型传了也零失效）。per-token 真跑上限（穿透发起即计+常规真跑完成补计，缓存命中不计；达上限回终态缓存行为）；穿透走独立 `'!ttl'` inflight 槽；观测标记 `ttlReanalyze`
- **叙事重试实验级配置 `fourmemeWs.narrativeRetry`**（flap 实验配 flapWs 段同键；引擎默认开 `enabled !== false`——删段=开，与 dataPrefetch「关=删段」物化语义刻意相反）：`intervalMs`（穿透 TTL 毫秒 [1000,600000] 缺省 10000）/ `maxAnalyses`（真跑上限 [1,50] 缺省 3，**计含首析故名 maxAnalyses 非 maxRetries**）/ `windowSec`（叙事否决豁免窗 [60,7200] 缺省 300；⚠️**不得低于 worker retryWindowSec**——拉黑先于末次重析翻正=误拉黑且 `_narrativeBlockedTokens` 无撤销路径）；BacktestEngine 零接线（回测禁穿透=语料前视防线）；UI 物化语义：显式关写 enabled:false（数字键不写）、开+数字写段（浅合并保留复制携带 windowSec）、回测剥离
- **叙事结果=token 级全局缓存**：`token_narrative` 按 token_address upsert，跨实验共享；失效=行删或 `NarrativeRepository.updateIsValid(addr,false)`；**历史窗口回测前先失效缓存**（题集变更后旧缓存行缺新题答案）：`scripts/narrative/invalidate-referent-window.cjs` / `invalidate-carrier-window.cjs`（&lt;基底实验ID&gt; --commit，范围刻意只收窄基底买过的 token）
- `token_category` 列写入：`deriveTokenCategory(prestage, stage1)`；NULL（precheck fail/no_data）**不写键**——失败重析不会抹掉已存分类

### TPA / OPB

- **TPA**（`src/services/TokenPositionAnalyzer.js`，`config.tokenPositionAnalyzer` 段存在才构造）：触发门命中（write-once）对 top20 持仓 as-of 画像，`TPAPre_*` 因子族注入 FA；策略引用未触发的 `TPAPre_*` 恒 null → ConditionEvaluator false=**fail-closed 不买（去门控化）**；触发门校验 fail-fast（时间门 blocks/ageSeconds 恰一，数量门 tradeCount/buyBnb/minHolders 非负）。三路径画像：离线画像 fresh 直用/stale 增量合并/miss 实时拉窗现算。retention 基准=触发刻峰值枚举大户集冻结，此后 running 净持仓重算（净卖<1=走人）。**live ticks 缓冲窗口裁剪**（默认关）：`liveTicksRetainHours`（null=不裁）挂引擎 5min prune——删头段旧行须同步推进 `_liveTicksBufferStartMs`（不推进=缺口计数漏报=掩盖问题），miss 请求走既有缺口计数分支 fail-loud 不回退 DB。**gmgnFilter**（`{enabled, exemptPct}` 缺省关=存量零变化）：①GMGN 用户钱包（本盘内经聚合路由买入>0）不参与 TPA 分数计算 ②前期参与者 GMGN 占比≥exemptPct → **豁免放行**（不能做成 null——null 在 `TPAPre_tokenScore > 2.5` 下 fail-closed 拦死，与散户盘语义相反）③触发门 minHolders 同步剔非 GMGN；豁免救回时 `TPAPre_gmgnExempt=1` + verdict 改写 approve（blockReasons=['gmgn_exempt']）；`TPAPre_gmgnUserPct` 恒落（disabled 也落纯观察）。BSC 新钱包中性分 2.2（`scoreTokenFromHolders`，非 creator 只升不降——刻意偏离 pumpfun 母版，观察期后去留用户再定）
- **OPB**（`src/services/OnlineProfileBuilder.js`，`fourmemeWs.onlineProfile.enabled` 默认 false）：实时代币分类，双门触发（idle 60s 无 tick / bigTickIdle 600s 无大额 tick）+ 60s 扫描补救，写 `token_profiles`（token_address 全局 PK，source='online'，不挂实验防级联删）；阈值判定与离线 classifyToken 共用 `scripts/shared/token-classifier.js`（单一真相）；TPA 联动 `onProfileClassified` 喂分类缓存。**重启过渡期全史路径**：水位对齐前的存量活跃 token（FA tick 自动建 state）价格史不完整 → 分类时自动改走 wss_price_ticks 全史 + classifyToken（防涨幅失真）；失败 fail-closed 不写失真行、待扫描重试

### 叙事引擎（`src/narrative/`）

所有 LLM 决策走 **Jev**（api.typesafe.ai，结构化三原语 Choice/Score/Noul，无文本生成，一票一次 fan-out 调用秒级）。

```
Token URL → URL 分类（含 IPFS metadata 解包）→ 数据抓取 → Pre-Check（纯规则）
   ├─ 账号/社区 token 或自发宣告（detectIssuerSelfLaunch 代码判）→ prestage Jev（4 题 P1.10，粉丝带只定档不拦截）
   ├─ superIP（prompts/super-ip/super-ip-registry.mjs）→ 快车道（标准题集+代码预分）
   └─ 标准路径：单次 Jev 调用（18 题+brand_hijack/name_image_consistency 条件题，J1.31）
```

- **文件**（`analyzer/llm/`）：`JevClient.mjs`（缺答案 id 直接 throw 无吞错；429/5xx 退避，Retry-After 头优先于固定表、钳 [500,15000]ms）/ `jev-questions.mjs`（标准题集，`buildStandardQuestions`）/ `jev-prestage-questions.mjs`（P1.10：4 题；`rateProject` 粉丝带只定档 0-299 mid/≥300 high 不拦截）/ `jev-state-builder.mjs`（60k/20k 预算）/ `jev-result-mapper.mjs` / `jev-prestage-mapper.mjs`（**聚合/阈值/截断全在代码侧**）
- **版本规则**：改任何题面必须 bump `JEV_QUESTIONS_VERSION` / `JEV_PRESTAGE_QUESTIONS_VERSION`（prompt_type/prompt_version 落库标识）；校准验证 `scripts/narrative/jev_calibration.mjs` / `jev_prestage_calibration.mjs`（评级一致性+无买线翻转）
- **时间基准**：新鲜度对 **token 创建时间**（`raw_api_data.created_at`）计，绝不用墙钟——重跑/回测/延迟分析幂等；缺创建时间 pre-check 跳过时效规则、Jev state 退墙钟
- **修正教训（改校准必读）**：①题面改锚分不动（反复实证）——语义修正类措辞能翻 argmax，分数锚定类必须代码侧 mapper 门；②校准重跑必须**逐字复用线上 stage1_prompt.state**（token_narrative 只持久化 twitter_info/classified_urls/extracted_info，binance_square/instagram/website 等语料段不落库，重建 state 会缺语料致档位漂移）
- **图分析**（vision）：主推文第一张图 → Qwen/Qwen3-Omni-30B-A3B-Captioner @ SiliconFlow（OpenAI 兼容端点，key=182 `.env` SILICONFLOW_FALLBACK_KEY；调用恒传 format jpeg）。**prompt 不含 token 名**（视觉层 token 无关=跨 token 缓存健全性；指代判定留给 Jev）；**img-v3 含 `visible_text` 图内可见文字逐字转写**（梗名常只在配图图内文字里，渲染「图内文字（逐字转写）」行进 state）+ maxTokens 2500（旧值 1500 会把 key_elements 截断成垃圾；config vision.maxTokens 显式覆盖须同步改）；同图结论缓存（external_resource_cache resourceType=tweet_image，TTL 730 天，行带版本号升版自动判 miss 重析）+ in-flight 去重；图片本体缓存 resourceType=`tweet_image_raw`（dl-v1 压缩后 base64，TTL 730 天同源，跨进程复用——分析过期/prompt 升版重析零重下载；版本不符全量重拉）；失败=warn+无图证据（=开启前行为）+不写缓存（失败冷却会灭宣告竞态重试窗）；配置 `config/narrative-engine.json → vision`，enabled 但 key/baseUrl 残缺 throw fail-loud。**前置 Jev 预判门（C72，G1.0）**：`vision.gate {enabled 默认 true, minSufficientProb 0.6}`——analyzer 主链 await vision 前先 1 题 Choice 判「文字语料是否已足够确认叙事」（`vision-gate-service.mjs`，state=与主 Jev 同语料无图形态），sufficient≥阈 → 整段跳过 vision=本票无图语义（与无配图票/失败降级票同语义，J1.30 不问/C59 豁免不触发，下游零改动）；误判方向 fail-safe（误 sufficient=偏拦；误 need_image/失败=跑 vision 原行为）；已挂 image_analysis（预取完成/缓存命中）不问门直接用图；门跳过时 `jevFetchResults` 浅拷贝剥 image_analysis + 三布尔前置 `!visionSkipped`（防 visionPrefetch 后台挂载竞态），后台预取照常写缓存不受影响、重析 reassemble 复原后幂等用图；prestage 路径不接门；审计=timing `vision.gate` 段+日志行含 G 版本（不动 DB 列/prompt_version）；单测 `_test_vision_gate`
- **提速改造要点（N1-N3+代码层；改挂载点/序须保持内容 bit 一致）**：①website 内容抓取总开关 `config/narrative-engine.json → websiteFetch.enabled` 默认 false=内容抓取段整段跳过（纯 website 语料票落「无语料 low」属预期漂移；t.co 展开保留——URL 分类/pubProxy 判据吃）②中段三泳道 precheck∥账号链∥issuerCa 并发（值层互不消费）③vision 预启动：实验级 `fourmemeWs.visionPrefetch.enabled`（默认 false——预检拦截票不烧视觉；经 NarrativeDirectCaller analyzeOptions 穿透）④precheck 0.55/0.58/0.7 三 DB 查询并行（0.7 创建时间刻意 raw 口径无回退，勿与 0.55/0.58 合并）⑤apidance GraphQL `url_entities` (t.co,终链) 对直取（缺项回退 HEAD）⑥第二推文与主推并发 / collect 双账号并发⑦undici 全局 keepAlive（`http-keepalive.mjs`，keepAliveTimeout 30s）⑧dbSave 瘦身（save 第二参 `{existing}` 非 null 跳 pre-select 肥行往返；upsert 回读瘦列 `SAVE_RETURN_COLS`）
- **语料充分门（C79，CG1.0）**：`corpusGate {enabled 默认 true, minSufficientProb 0.6}`——`fetchDataSequentially` 编排层 twitter 主语料等齐后 1 题 Choice 判「其余待抓平台语料还需要吗」（`corpus-gate-service.mjs`，state=同语料 partial 形态+末尾 `[UNFETCHED SOURCES]` 待抓清单附加段），sufficient≥阈 → justoneapi 串行桶+github 桶全部待抓段整段跳过（`results.<x>Info` 保持 null=无 URL/失败同形状下游零改动；`dataFetchResults.<platform>.skipped='corpus_gate'` additive 标记）。门管清单剔 twitter（判据来源）/websites（websiteFetch.enabled 独立开关）；资格=twitterInfo 非空+有待抓平台（twitter 失败 fail-safe 照抓）；`Promise.race` 2s 上限（JevClient 重试尾部锁死，安全界非配置键）；误判方向 fail-safe（误 sufficient=偏拦；误 need_fetch/失败/超时=照抓原行为）；陷阱①：资格判定与 `{...results}` 展开都必须在 `await twitterPromise` 之后（runTwitter 完成时才原地写 twitterInfo）；审计=timing `fetch.corpusGate`+日志 `[CorpusGate] … v=CG1.0`；单测 `_test_corpus_gate`
- **web-fetcher**：直抓失败（403/Cloudflare/超时/抽取<50 字）→ `https://r.jina.ai/<url>` 回退一次（**不得带浏览器 UA**——r.jina.ai 403 伪装 UA，用 `richer-js-narrative/1.0`）；发布时间前插正文供时效题；失败 fail-closed=null 旧行为；单测 `_test_web_fetcher_jina_fallback`
- **推文拉取缓存**（getAccountWithFullTweets 两层）：userInfo handle 级（跨 token 复用）+ tweets **userId 级全量 key**（只存翻满窗口的完整列表，oldestSec≤untilSec 判覆盖）+ **CA 惰性早停**（每页推文地址匹配命中即停，截断列表落 `…:ca:<addr>` 专属 key **不跨 token 共享**；同 token 三调用点共享）；**刻意手工 get/set 不走 CachedFetcher.fetchWithCache**（失败 1h 冷却会灭宣告竞态重试窗）；只缓存成功（防空 stub 毒缓存）
- **空语料推特搜索兜底**（C77，`config/narrative-engine.json → searchFallback` **默认关**；flap 无平台分键，worker/直调 config 同源）：语料全空票（classifiedUrls 各桶全空+twitterInfo null）中段并发按 token 全名+`since:<创建-7d>` 搜推特（apidance SearchTimeline Top+Latest，timeout 5s）作 `[TWITTER_SEARCH]` 独立段进 state header（**不占四区配额**；段内声明非宣告语料，关联由 Jev 判）；双达标（去重剔转推 ≥3 条且单推 fav+2×rt ≥200）→ **旁路 `no_public_info`：pre_check_result 置 null 走 Jev**（保留 low 会 resolveFinalRating 遮蔽 Jev 结论/enrichSocialByGmgn 穿透/preload 排除）；未达阈值/失败/零结果 → ruleName 原样保留（1800s 重试域）+ additive `details.searchEvidence` 摘要，**不落缓存**（TTL 会冻死重试窗内全部重析）+analyzer 维持原拒 bit-identical；★lag 隔离红线=证据只走 `raw_api_data.search_evidence`，与 extractCorpusTs 三路径结构性无交叠；enabled 残缺 throw fail-loud；段缺失=静默关
- **PrecheckFailRetryService**（`engine/PrecheckFailRetryService.mjs`，`engine.precheckFailRetry` 配置）：两域重试——`address`（宣告竞态，窗 300s；**带语料形状门**：非账号型语料（推文型/混合型/null）skip `'not-account-source'` 不烧 Jev 配额——「重取数重析」仅限账号类代币；重析 analyzeOpts 带 `invalidateAccountCorpus:true` 重取账号数据）/`no_public_info`（语料晚到，窗 1800s，先 invalidate GMGN 成功缓存再 `enrichSocialByGmgn:true`——**该域不在收窄范围**）；门：token age（wss_events 最早 token_create 锚，缺锚不重试 fail-closed）+ 新 ticks 增量≥20 自节流 + 尝试<5；DB 一律 dbManager（service key）
- **已定案规则**：规则 5 高影响力+媒体直发**已废**（自填 twitterUrl 白拿 mid 的攻击面，放行走 Jev）；rule 0.52 同名蓝筹**整体废除**（同名≠蹭名，移交叙事层）；规则 0.5 duplicateNarrative+0.6(q60) **死代码整链删除**（appendix 仅旧 AVE 发现链路≤2026-05 写入、wss 组装行恒无；same-name-check-service.mjs 整文件删，`_normalizeName` 迁 pre-check-service 本地，AVE 搜索链一次不发；引擎侧 strictSameNameTokenCount 独立活链路不碰）；expired_tweet **分桶（C74）**：非豁免桶（classifyTweetType∈{angle_seeking,interpretive_reply,unknown}）窗 6h→300s（relocate 买腿 lag<300 门，秒粒度 300 整拦），direct_tweet（粉≥5000 或 赞≥500 或 转≥100，高影响力新闻推）跳过硬拦交 Jev event_timing 软评；无锚语料（account/纯 IG）随之放宽评级 2/3 即可买（观察期盯盈亏）；旧分钟窗 config 键废止删除

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
| 名图一致豁免（J1.30） | **标准路径**：图证据+name_image_consistency（条件题，有图才问）same_entity/same_visual_category 合并≥0.5+0&lt;关联≤10 → 豁免 Stage3 关联截断（分照常计入；答案缺失 fail-closed；superIP 不消费） | C65 |
| 找角度时效门（C68） | angle_seeking/interpretive_reply 载体推文→发币 lag>6h → mapper 时效归 older=0（mapper-only 代码侧 override，题集不动；载体取主推/website/quoted/retweeted 最新一条「任一新即活」）；C74 后与 precheck 不再同窗——上游 300s 分桶吞主力拦截，本门降级纵深防御（兜 ignoreExpired 穿透/锚缺失/缓存残例）；precheck expired_tweet 锚回退 tokenCreatedAtSec（IPFS 行 created_at 缺失静默跳过） | C68 |
| 推文时效分桶（C74） | precheck 规则 2.1 按 classifyTweetType 分桶：非豁免桶（angle/interpretive/unknown）lag<300s 放、≥300 拦（relocate 买腿 `narrativeCorpusLagSec < 300`，秒粒度 300 整拦）；direct_tweet（粉≥5000 或 赞≥500 或 转≥100=高影响力新闻推，非找角度被人发现得晚）豁免跳过硬拦、时效全交 Jev event_timing 软评不设硬界；豁免是语料级（主推判 direct 即整组放）；ruleName 保持 'expired_tweet'+details 落 tweetType/freshWindowSec | C74 |
| 叙事源头陈旧门（C75） | direct_tweet **主推**（仅主推，宣告/第二语料刻意不计入）距 token 创建锚 >30d（SOURCE_STALE_SEC，对齐 within_30d/older 档边界）→ mapper 时效归 older=0 分（C74 豁免桶的软评层客观锚——Jev 被当天宣告推误答新鲜档的防线；与 C68 type 互斥：C68 管 angle 类载体窗 6h，本门管 direct 类源头窗 30d）；angle/interpretive/unknown 不触达；锚缺失 fail-open；审计 stage1.jev.staleSourceOverride | C75 |
| 图文名不符拼写门（C78） | 币名 CJK ≥3 字 + 图内文字（image_analysis stringify 全文，标点当分隔符）存在等长独立段恰一位不同且 ≥2 次 + 币名整体不在图内 → Stage3 截断（`detectNameImageSpellingMismatch` 纯代码，与 misspellingP≥0.5 双臂 OR——Jev 探针 0.28 拦不住+题面加判据重放反降 0.13）；例外天然编码：有意变形全语料一致（图内也是变形字）不触发；拉丁名不判/换位形状不覆盖；审计 stage3.jev.spellingMismatch | C78 |
| E 类感染力折损（J1.31） | `event_resonance` 恒带三档（强感染/轻度有趣/无感，判据=BSC 买家立场情绪行动性，与 web3_fit=静态口味 vs 动态感染分工）；**仅 category=E** 消费：系数<1 时 `事件分+传播分整体 ×coef`（mild 0.5/indifferent 0.25）+时效不折——mild 数学上拦死全部档位（max 49.5<60）刻意保留系数形式（梯度可观察）；strong ×1/缺答案 fail-open/superIP 不消费；审计 jev.eventResonance 恒落+resonanceDamp 命中才落 | C80 |

### Live 交易

- four.meme 走 `FourMemeDirectTrader`（TokenManager2），flap 走 `FlapPortalTrader`（Portal swapExactInput）；双平台（both）live=单引擎 per-platform 双 trader 同一钱包（`_liveTraderMap`+共享 NonceManager；live 参数恒读 fourmemeWs.live）；**买入不区分计价盘**（用户裁定「所有非 BNB 盘都可以买，只要能正常买入」——买入可行性由 estimateGas 天然保证：多跳路径不通 estimate 失败即买入失败，不发垃圾 tx；卖出 quote 池死风险自担）；卖出 token→0x0 全盘支持；单测 `_test_live_nonbnb_buy_allowed` 反向锁定防防线回流
- live 实验只能 `node main.js start-experiment -e <id>` 启动（run-engine 对 live 显式拒绝）
- 实收解析**余额差法**（买入 balanceOf 前后差=税后真相；卖出 BNB 差+gasUsed×gasPrice 补偿）——对税币/非 BNB quote 盘免疫
- **flap minOut 锚取较低者**（2026-10-16 蓝蛙 0x9499…7777 案：quote staticCall 滞后块状态暴涨盘虚高 10.5%，minOut=quote×滑点卡死 revert 烧 gas+8.6s WSS 盲区等回执）：`minOutAnchor = min(信号价期望 expectedTokenOut, quote)`——平稳/暴跌盘锚 quote 行为不变，暴涨盘锚信号价期望（WSS 实时 tick）；L1 预成交校验不动；Decimal 域取整；单测 `_test_flap_minout_signal_anchor`（事故数字反证）。**live 买入失败可观测性**：`_executeBuyLive` 失败分支单次必打 warn 行 + `tradeResult.reason` 落库（与 execution_reason 同源双口径，signals 页 reason 链取兜底）；trader 日志三参形状 `setLogger(logger, experimentId)` 接进实验日志文件（BaseTrader console 直打全改 this.log）；`Logger._consoleEchoDisabledFor` 同文件禁复读（fd1/fd2 与目标 dev+ino 比对，stdout 重定向到日志文件时防双写/交错）；单测 `_test_live_buy_failure_observability`/`_test_logger_console_same_file`
- **卖出 approve 大额一次授权**（2026-10-15 GROK 案：旧精确额度=卖出即耗光 allowance，每笔卖出重发 approve+等回执 3.5-8s；两 trader 改 `approve(spender, ethers.MaxUint256)`，条件结构保留 `currentAllowance < amountOutWei` 才发——首卖一笔此后恒充足跳过；单测 `_test_approve_max_grant`）
- **live 记账精度钳制**（P11 幽灵持仓案：qtySold 链上高精度 …907 vs 账面 Decimal …906 被 PM 以 Insufficient token balance 拒 → 账面永久挂账+SyncHoldings 误报外部处置；`_liveRecordTrade` 卖出方向差值 ≤相对 1e-9 时钳到账面持有量重试，**全 Decimal 比较**——double 会吞掉 1e-11 差异致钳制静默失效；真超卖照常失败；单测 `_test_live_record_trade_clamp`）
- 防御层（参数在 default.json `fourmemeWs.live`/`flapWs.live`）：L1 `assertMinOut`（报价/预期 ratio<0.5 拒单；expected 契约必传缺即 throw；卖出无锚 fail-closed 拒裸奔）/ L3 卖出熔断（连败≥5 → 30min 冷却+Telegram）/ **买入熔断**（连败≥3 `buyCircuitBreakerFailures` 拉黑至进程重启+告警；只计发单后链上失败——前置拒绝/资金不足不计；「2 败 1 成」翻正清零；手工买不走检查）/ L5 `_awaitReceipt`（超时回查一次，**绝不自动重发防双买**；reverted throw。**WSS 快速回执①默认开**：`fourmemeWs.live.txReceiptViaWss !== false`——引擎 `_txSeenSignal`（TxSeenSignal，Map<txHash 小写归一，超时自清理）+ collector `_emitTick` 首行 `_onTickEmitted` 钩子 → 两 trader `_awaitReceipt` 内 `Promise.race([WSS 路径, waitForTransaction])`：自家 WSS 见到成交 tick → 轮询 getTransactionReceipt 拿真 receipt，回执 8.2s→~0.5s；拿不到（approve/PCS 卖出不在订阅内/revert 无事件/WSS 永未见）= 永续 pending 让位原路径 **bit 一致绝不冒充绝不 reject**；flap 经 `_mergedWsConfig` 同键）/ `maxPositionTokens`（0=不限只拦新开仓）/ 毕业告警人工处置
- 钱包复用：web 创建 live 实验「复用历史钱包」下拉（`GET /api/live-wallets`，私钥永不回传；两端 ENCRYPTION_KEY 一致）
- runbook `docs/live-acceptance-runbook.md`；**真实资金验收未做**（0.001 BNB 闭环待用户执行）；flap 毕业/非 BNB 盘卖出 revert 属预期 fail-closed

### Web / 数据库 / 配置

- Web：`src/web/` + `src/web-server.js`（3010）；K 线/现价走 wss_price_ticks（tick-kline-service）；AVE 工具端点（/api/ave-*）保留；叙事 UI /narrative-analyzer、/narrative-tasks；TPA 展示 /experiment/:id/position-analysis；signals 页因子 chip 条件驱动（买/预检查条件有啥因子展示啥）
- **RLS 坑**：SUPABASE_ANON_KEY 对 wss_price_ticks/wss_events/strategy_library 被 RLS **静默过滤成空**——远程脚本/routes 一律 `dbManager.getClient()`（service key）
- 删实验=DB 级联（每张实验归属表 experiment_id → experiments ON DELETE CASCADE，web 层只删行）
- 关键表：experiments / strategy_signals / trades / experiment_tokens / experiment_time_series_data（**停写 2026-10-15**，历史数据保留；signals 页 Holder 走势图与 trades 页时序价格线图已改 `wss_price_ticks` 重建——`/api/tokens/holder-series` + `src/web/services/holder-series.js`、`/api/tokens/price-series` + `src/web/services/price-series.js`，口径与 FA 对拍锁定：wallet=sender||trader COALESCE / 尘 tick（bnb<minTickBnb 0.001）剔除 / tokenAmount>0 / 净持仓跨 0 边界 / (block,log) 链上真序；降采样 ≤2000 点）/ token_monitoring_pool / `wss_price_ticks`（UNIQUE(tx_hash,log_index) 首写者持有行；sender_address=tx.from；quote_token 标记 flap 非 BNB 计价盘）/ `wss_events`（token_create/graduation/token_quote_set 低频事件通道，token 级全局不挂实验）/ strategy_library / token_profiles / wallet_offline_profiles（address PK 全局）/ token_position_analyses（CASCADE 挂 experiments）/ token_narrative（叙事侧 NarrativeRepository 管）
- 链支持 BSC-only：其它链历史实验可读（未知 chain id 原样落穿），交易/配置查询非 BSC throw
- 配置：`config/default.json`（fourmemeWs/flapWs 段：contracts/reconnect/tickBuffer/debounce/live 执行参数 + 策略默认 buyTimeMinutes 1.33 / earlyReturn 80-120 / TP +30% 卖 50%、+50% 清 / 观察窗 30min）；`config/narrative-engine.json`（jev+engine 段，JSON 单一真相源，env 覆盖已移除）；`config/.env`（ANKR_WS_URL / AVE_API_KEY / SUPABASE_URL / SUPABASE_ANON_KEY / ENCRYPTION_KEY / SILICONFLOW_FALLBACK_KEY 等）
- AVE API token 格式 `{address}-{chain}`（如 0x123…abc-bsc）；AVE 只用于 holder/预检工具与分析端点，不用于发现或价格

## 红线汇总

1. **绝不删有数据的实验行**——删=级联删 wss_price_ticks 历史行（按 experiment_id 竞速归属），全局永久丢；误跑/污染实验只停进程+置 stopped 留行，是否删除必须用户裁定
2. **引擎绝不调 `collector.setExperimentId`**（exp_id=NULL 防线，单测锁定）
3. **远程脚本/routes 查 wss_price_ticks/wss_events/strategy_library 一律 dbManager service key**（anon RLS 静默空）
4. **DDL 先于进程重启**（新列/新表在引用它的代码上线前存在）
5. **回测查询 platform 单值 `.eq` 循环勿 `.in` 多值**；token 地址批 `.in` ≤100；Supabase `.in()` URL 超 8KB（批 50 上限）
6. **FA 周期判定/回测路径禁 Date.now**（now 由 buildFactorMap(state, asOf) 传入，防前视）；`_graduatedTokens` 禁装载即填
7. **narrative 是 ESM（.mjs），交易引擎是 CJS（.js）**——勿混 import
8. BSC-only；live 只能 main.js start-experiment 启动；双平台 live 的 nonce 唯一性靠共享 NonceManager（shareSignerFrom），新 trader 接入必须走它不得自建
9. **本地不跑重查询/重实验**（直连 Supabase 全表聚合/全史扫描本地 VPN 必超时）——去远程服务器跑；本地只做单条/小结果读取
10. 历史窗口回测先失效叙事缓存（invalidate-*-window.cjs）；校准重跑逐字复用线上 state
11. BacktestTickCache 探针/装载保持锚定无序形状（ORDER BY id 形状会 planner 超时）；maxTickRows 默认 100 万，大窗口显式放宽
12. collector stop 顺序 eventWriter → senderResolver → collectors，不可换
13. 新机制一律配零 DB 零网络单测；事故修复配「事故现场反证」断言（源码口径断言锁定防线）

## 操作指南

### 新增 pre-buy 因子（五步）

1. 因子计算加进对应 service（如 WalletClusterService）；2. 加进该 service `getEmptyFactorValues()`；3. 加进 `PreBuyCheckService._evaluateWithCondition()` context；4. 加进 `FactorBuilder.buildPreBuyCheckFactorValues()`（回测兼容）；5. 加进 `FourMemeWssTradingEngine.js` preBuyCheckFactors 构造（virtual/live）

### 修改 Jev 题集

1. 改 `jev-questions.mjs`/`jev-prestage-questions.mjs` 题面；2. bump 版本常量；3. 聚合语义变了同步对应 mapper；4. 跑校准脚本验证评级一致且无买线翻转；5. **case 与裁定同步台账**（docs/叙事引擎改进与Case台账.md 卷三倒序追加）
