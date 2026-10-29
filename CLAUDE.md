# CLAUDE.md

Richer-js：BSC four.meme + flap + gang meme 币自动交易引擎（BSC-only）。代币发现与价格 = **实验进程内嵌 ANKR WSS collector 直连**（订阅 four.meme TokenManager + flap Portal + gang LaunchpadV2，全事件驱动无轮询）：引擎直接消费 collector 内存回调，DB 落库（`wss_price_ticks`/`wss_events`）仅作持久化（回测/web/离线分析数据源）。支持虚拟（模拟盘）、回测（tick 回放）、live 实盘（gang 仅采集+虚拟+回测）；内含叙事分析引擎（Jev 结构化决策模型）。

**本文只留现行机制、铁律与操作入口**；决策过程、case 复盘、验证数据、事故数字、各臂现行阈值/版本号一律不写入（完整判据/案史/豁免链在台账，策略条件串以 strategy_library 最新版为准；压缩前版本在 git 历史）：
- 叙事 case 全档案：`docs/叙事引擎改进与Case台账.md`（卷四 C181 起；卷三/卷二/卷一=同目录 `-卷三归档.md`/`-卷二归档.md`/`-卷一归档.md`）；**每个新 case/改进须同步追加台账**
- 交易机制案档案：`docs/交易策略改进与Case台账.md`（T 编号；买/卖腿门、因子口径、集中度、止损/毕业、live 事故、回测口径、机制迁移；详档 auto-memory）；**每个新交易侧 case/改进须同步追加台账**
- 历史实现：git 历史

## 常用命令

```bash
npm start                                  # 实验管理 CLI（交互式 start/stop）
npm run dev
npm run web                                # Web 界面（端口 3010）
node src/run-engine.js <experiment_id>     # 单实验直跑（virtual；live 显式拒绝）
npm run narrative-engine                   # 叙事分析 worker
npm run case-regression [-- --only C98,C104 | --list | --add <addr> --case C112 --note .. | --update-expect C97 --because ..]
                                           # 叙事 case 回归集（票数随案渐增；重析对拍在 182 跑，工具文档 docs/case-regression-tool.md）
npm run narrative-sample-build -- --exps <id,...> --name <set> --top 60 --bottom 60 --random 60 --seed N
npm run narrative-sample -- --set <set>    # 叙事抽样测试集构建/重析（C136 统计评估姊妹资产；涨幅分层，182 跑）
node scripts/scan-unknown-factor-conditions.cjs   # 存量条件未知因子扫描（退出码 1=有命中）
NODE_OPTIONS=--max-old-space-size=12288 node scripts/build-wallet-profiles.cjs --threshold 3 --days 14
                                           # TPA 离线画像（只在 182 跑；须在 build-token-profiles 之后，依赖 flash_crash_period）
```

## 单测

无测试框架/CI。单测文件=`scripts/_test_<名>.cjs`，**零 DB 零网络**（打桩 dbManager/provider/fetch），直接跑、断言失败退出非零；**改到哪块跑哪块**（名字自述；每键口径/事故现场反证断言在文件内，案史见台账/memory）：

- **采集/直连**：embedded_collector_architecture、run_engine_graceful_stop、experiment_instance_lock、sender_resolver、fa_deferred_wallet_feeding、watcher_quote_conversion、flap_session_created_backfill_bypass、recent_ticks_scan、early_replay_index、tick_buffer_watermark、wss_event_writer_retry、gang 六件（gang_collector_decode、gang_graduation_progress、gang_architecture、gang_corpus_enrich、gang_baw_trader、gang_live_wiring）
- **回测**：backtest_tick_cache、backtest_chain_order、backtest_narrative_gate、backtest_perf_probe、backtest_write_buffer_async、backtest_load_pool、backtest_preload_overlap、backtest_platform_parallel、fa_prefilter、backtest_fa_prune、backtest_tick_build_skip、backtest_trigger_leg、backtest_keyset_paging（⚠锚定无序重构后存量失败待裁定，新形状由 tick_cache 覆盖）
- **引擎机制**：card_position_mechanisms、holdings_replay_precision、stop_loss_rules、sell_leg_scan_fallback、prebuy_peak_backfill、graduation_sell_and_anchor、sell_debounce_mechanisms、token_pool_buytime、token_age_sec、activity_window_factors、fourmeme_fa_factors、bundle_cluster_factors、even_cluster_factors、circ_denominator_cap、top2_holder_circ、top_holder_supply、fa_wallet_denomination、market_regime、live_prefilter_parity、permanent_block_cache、k_group_no_materialize、wallet_net_single_pass、signal_metadata_cache、token_pool_eviction、timeseries_removal、holder_series_rebuild、price_series_rebuild、fa_narrative_factors、fa_early_trades_factors、netbuy_window_factors、narrative_trigger_condition、account_health_monitor、account_recheck_engine、fa_issuer_account_state、observation_signals、observation_config
- **pre-buy/钱包**：sniper_factor（+sniper_cache_probe）、top1_buy_share、sender_switch_and_router、corpus_lag_factor、same_name_snapshot、gmgn_check_layer、gmgn_attention_ratio、gmgn_wallet_stats_service、gmgn_wallet_stats_layer、prebuy_known_factor_short_circuit、prebuy_creator_dev_cache、prebuy_overlap、copy_wallet_roster_factors、copy_roster_orphan_rescue、sybil_cluster_factor、sybil_build_clusters、wallet_profile_builder、wallet_scorer、tpa、tpa_live_ticks_trim、token_classifier
- **策略/条件/stats**：strategy_library_validate_legs、unknown_factor_reject、experiment_stats_fifo、replay_observation_factors（回放本体 182 跑）
- **web/数据服务**：trades_filter_columns、api_status_service
- **live**：live_hardening、tx_seen_receipt、live_decimals_guard、live_executor_loading、executors_routes、manual_trade_queue、graduated_pcs_routing、fourmeme_actual_received、nonce_manager、gas_dynamic、live_nonbnb_buy_allowed、buy_circuit_breaker、live_dual_platform、approve_max_grant、live_record_trade_clamp、live_dust_close、flap_minout_signal_anchor、live_buy_failure_observability、logger_console_same_file
- **叙事链路**：precheck_fail_retry、narrative_signal_gate、narrative_memcache、narrative_preload、case_regression_lib（runner=`npm run case-regression`，工作流=docs/case-regression-tool.md）、tweet_pull_optimization、narrative_timing_probe、narrative_parallel_fetch、ipfs_race、narrative_prefetch、same_name_appendix_shortcut、narrative_leader_incremental、rule5_pass_through、data_fetch_failed_rating、issuer_selflaunch_account_route、issuer_ca_detection、narrator_two_shapes、unrated_elimination、isproject_coin_url_not_ca_hit、prestage_web3ip_account_only、prestage_project_downgrade、daily_parse_summary、news_monitor、narrative_middle_parallel、narrative_vision_prefetch、vision_gate、website_fetch_removal、precheck_parallel_queries、twitter_urls_expansion、twitter_bucket_overlap、http_keepalive、justoneapi_timeouts、narrative_repo_save_thin、narrative_save_sanitize、token_info_narrative_fallback、jev_client_backoff、narrative_account_ttl、account_corpus_invalidation、narrative_retry_config、angle_timing_override、precheck_tweet_freshness_bucket、search_fallback、corpus_gate、corpus_ready_prefetch、gmgn_social_fetcher、ave_social_fetcher、narrative_rounds_route、narrative_review_fixes、parent_tweet_metrics、isproject_coin_aggregator_urls、jev_question_consolidation、superip_no_prestage_route、knowledge_base、bluechip_dedup_gate、tweet_image_analysis
- **Jev 门/豁免**：publisher_proxy、web3_fit、web3_fit_anchor、cashtag_w_route、jev_product_entity、notable_other_exit、referent_memeability、subject_carrier、brand_hijack_pun_exemption、w_bsc_user_appeal、superip_standard_path、name_image_consistency、community_name_exemption、jev_resonance、jev_finding_recap_statement_gate、jev_regional_binance_anchor、empty_content_img_exempt、event_trivial_gate、emotional_impact_carrier、massive_influence_carrier、image_depicts_exempt、image_carrier_nature、image_name_text_gate、gmgn_risk_factors、gmgn_superip_tweet_enrich
- **抓取器**：instagram_pipeline、twitter_community_pipeline、web_fetcher_jina_fallback、youtube_fetcher

## 架构总览

### 入口

`main.js`（实验 CLI）/ `src/run-engine.js`（单实验）/ `src/web-server.js`（Web 3010）/ `src/narrative/engine/start.mjs`（叙事 worker）。

### 引擎与采集（直连架构）

- 三引擎（`src/trading-engine/implementations/`）：`FourMemeWssTradingEngine`（virtual+live 同体）、`FlapWssTradingEngine`（extends 前者）、`GangWssTradingEngine`（extends 前者，gang 单平台薄子类）、`BacktestEngine`（回放同一因子-策略管线）
- WSS 订阅由实验进程自己持有：`_createCollectors()` per `_wsPlatforms()`（both=双 collector）；`factorsUpdated → OPB/卖腿实时/买腿 debounce` 管线
- collector 要点：
  - tick 三路输出（`_emitTick` 实时）：pool.updatePrice / tickBuffer 批量落库（500ms flush）/ FA.processTick；price_outlier 行入 buffer 前定值（首写者口径）；尘 tick（< minTickBnb）只落表不进因子；tickBuffer 水位告警**全程零 splice/shift/drop 绝不丢行**
  - `token_create` → FA.registerToken（meta 带 platform 键）+ `_handleNewToken`；`graduation` → `_handleGraduation` 毕业卖
  - `WssEventWriter`（共享单实例）持续写 wss_events：per-row 独立重试队列，**create 行丢=token 永久不可见，绝不丢事件**；`SenderResolver`（共享单实例，`config.senderResolve` 默认开）解析 `sender_address`=tx.from：EOA 缓存命中同步进 buffer，合约/未知走 RPC 回查，失败/溢出/停机 → NULL 保行不丢（绝不冒充）
  - **FA 两阶段喂食**（resolver 开启时）：submit 前 `_feedFa(…, {deferWallet:true})` 先喂**价格段**（WSS 到达即喂——fire 价/lastTickAt 不被 RPC 回查延迟与乱序污染），pushRow 回推时 `_feedWallet` → `FA.applyWalletTick` 补 **wallet 段**（holders/K 组/GMGN routedBuy/smartBot 用真 sender 精确计数）。EOA 快路两段同 tick=零时序差；合约行乱序回推，wallet 聚合任意序重放收敛；无 resolver 直推路径单段零变化（回测同）
  - **chainLate 迟到旧价拦截**：`_lastChainBlock/_lastChainLogIdx` 复合水位，`block < last || (== && logIdx <= last)` 判迟到（`<=` 含同位重复行）→ 跳过 outlier 判定/价格追踪/可靠价链（`_acceptPrice` 有副作用须短路防窗污染），流量/滑窗照计；链证据缺失 fail-open；`lastTickAt` 取 Math.max 不回拨
  - **holderTrend 双路径**：非 defer（直推/回测正序）`_pushHolderSeriesPoint` 覆盖快照；defer 路径 `_recordHolderEvent` 事件环形缓冲（≤64），消费点 `_rebuildHolderSeries` 逆向撤销 touched 钱包窗内 delta 再按 block 稳定排序正放（唯一序无关解）
- **gang collector**（`gang-ankr-ws-collector.js`，机制层与 flap collector 三份复制关系）：订阅双 pad（V2 `0x1B8F…966E` + V3 GangLaunchpad `0x15CF…4365`——**V2 收缩期仍创建，Created 的 V2 分支必须保留**）；Buy/Sell/Graduated/VQL 两 pad 同签名共享白名单，**仅 Created 各自签名**（V2 五事件签名+V3 Created 实测常量 `0x416fe98c…`（签名串反推未中勿改回 ethers.id）+动态 ABI `['string×3','uint256×2']`）；**V3 gradAmt 逐票各异**（WNB 盘恒 15e18、quote 盘逐票各异——「恒 15」只是 V2 口径）；w3 未识别字段 hex 存档不消费（≠0 ⟺ quote 盘）+ `pad:'v3'` 世系标记随 payload 落库；**tick 全净额口径**（Buy dw0=净入金/dw3=tokensOut、Sell dw0=tokensIn/dw3=净收款，1% 税已含在事件净额——FA 净入金系数恒 1.0/1.0 无 flap 0.98/1.0204）；totalSupply 恒 1e9；**quote 终态固定**（Created topics[3] 定终身，无运行时 QuoteSet）→ 启动重建读 wss_events token_create 行（48h 窗，实时正源不覆盖；V3 refPair=null 天然兼容）；**未知 token trade 暂存队列**（≤2000 溢出丢最老 fail-loud；Created 到达/DB 重建完成重放；绝不以 quote 价冒充 BNB 价）；非 WNB 盘换算多一档源⓪ refPair（仅当池两侧恰 {quote,WBNB} 才采用）；**indexed topic 地址必须 `topicAddr` 剥 padding**（32 字节左填充→20 字节小写，WNB 比较须小写同域，单测锁定）；**V3 Graduated 形状未实证**（若同签名走 V2 三字段解码、形状不同 decodeFailed fail-loud，首个毕业票须人工对拍=观察点）；语料补采走 gang indexer `/api/tokens/:addr`（creatorHandle=.ai handle 仅 corpus 留痕不冒充 twitterUrl）；legacy soft pad 不订阅；CLI/BAW 形状档案 `docs/gang-cli-shapes.md`
- **TokenPool 监控票淘汰**（默认关 `tokenPoolEvictMinAgeMs` null=关）：5min prune 内仅删 monitoring 超时条目，过滤 protected set（持仓∪buying/selling∪debounce pending∪恢复锚点）；sold/inactive/exited 刻意不删（sold 票 20min 后可再买）
- **时序快照机制已停**（用户裁定「代码全停，表保留」）：`experiment_time_series_data` 不再写；signals 页 Holder 走势图与 trades 页价格线图改 `wss_price_ticks` 重建（`/api/tokens/holder-series`、`/api/tokens/price-series`，口径与 FA 对拍锁定：wallet=sender||trader COALESCE / 尘 tick 剔除 / 链上真序 / 降采样 ≤2000 点）
  - TPA live 三件套 + `_onTickBuffered` 钩子 → 运行期零 DB ticks 查询；缺口只计数不回退 DB
  - 60s 断流自愈（静默≥5min forceReconnect）+ 15min wss_down 告警（判据 `collector.getLastMessageAt()`）
  - logs 订阅带 topic0 白名单（TOPIC0_MAP）；unknownTopic0 计数归零=新事件类型发现盲化，诊断时临时去掉 topics 字段重订阅
- **stop 顺序：eventWriter → senderResolver → collectors（★尾两步顺序错误=丢行）**
- 采集覆盖口径（用户裁定）：现役 both 实跑实验即事实采集器（单平台实验只持单 collector，兜底实验必须是 both）；无实验运行期接受采集空洞；实验进程崩溃=采集断流，接受风险不加 watchdog；flap quote 缺口由下次 flap collector 启动 getLogs 增量回放自动补齐

### 直连口径

1. `wss_price_ticks` 新行 `experiment_id=NULL`（免疫删实验级联）；引擎**绝不调 `collector.setExperimentId`**（单测锁定）
2. tvl 因子恒 0（对齐 DB 行/回测口径，虚拟/回测不分叉）
3. price_outlier INSERT 携带最终 flag（多实验并发 UNIQUE first-writer-wins）
4. 实验级 collector 配置覆盖：实验 config 的 `fourmemeWs/flapWs` 段（contracts/tickBuffer/reconnect/endpoint）per-platform 浅合并
5. wss-down-guard 判据 `collector.getLastMessageAt()`（≥5min 每轮踢 forceReconnect，≥15min status='wss_down'）
6. flap QuoteSet 映射持久化：非 BNB 计价盘 token→quote 实时落 wss_events（kind='token_quote_set'）；collector 启动 `_loadQuoteMapFromDb` 重建终态（乱序行按 blockNumber,logIndex 排序应用），回放窗 [水位-100, head] 补停机缺口，回放结果不落库；DB 空首启走 `flapWs.quoteRate.fullBackfillMinutes`（默认 43200）。汇率三级源（PCS V2 reserves → PCS V3 最深池 slot0 → V3 quote/USDT ÷ bnbUsd）；零流动性 V3 池挂价不可信必须拦；三级全 miss 跳行宁跳不冒充；BNB 盘 quote_token=NULL。**盲期暂存白名单（T87）**：`_loadQuoteMapFromDb` 加载期（数百万行 ~分钟级，首个 logs 订阅确认即启动）trade/graduation 全暂存（含 BNB 盘）——白名单票（本进程 Created 的 `_sessionCreatedTokens` ∪ 实时 QuoteSet 已 apply 的 `_nonBnbQuoteTokens`）即时处理不暂存（计价当下即为链上真值：QuoteSet 与 trade 同订阅流、链上 log 序必先于依赖它的 trade）；历史票维持暂存；decode 失败保守暂存；观察计数 `sessionBypassDuringBackfill`

### BacktestEngine

- **token 集合 + platform 口径**（不按 experiment_id）：地址 100/批 `.in` + platform **单值 `.eq` 循环**（`.in` 多值 planner 弃索引超时）；分块拉取后全局**链上真序 `(block_number, log_index)` 归并排序**（bigserial 分配序≠提交序，`sort(id)`=前视；倒退 block_time 行 WARN）
- **ticks 装载缓存** `src/trading-engine/core/BacktestTickCache.js`：粒度 `(sourceExperimentId, platform)` 一文件 `data/tick-cache/backtest/<src>/<platform>.jsonl.gz`+.meta.json；**缓存存全量、运行期过滤**（任意窗口共用、与直拉 bit-identical）。状态机 MISS/FRESH/STALE/bypass（探针失败直拉）/表回缩。**探针与装载都必须锚定无序形状**（`id > 锚` + 无序 limit；`ORDER BY id` 形状 planner 弃索引 8s 超时）；装载闭区间 `.lte(id, headAnchor)` 封死中途新写入；`maxTickRows` 默认 100 万，**多天大窗口须实验级显式放宽**；加列=全量重拉一次（设计内）；磁盘无自动清理。**P15 delta 侧车**：STALE 增量落明文 `<platform>.delta.jsonl`（tmp+rename 原子重写；meta 行数不符/文件缺失=损坏 drop 重拉；撕裂尾读满 meta 行数即停+下次幂等自愈）；delta ≥30 万行才全量合并重压缩
- **graduation 回放 + 止损双腿**（虚拟↔回测一致性）：`_loadGraduationEvents` → 主循环 `_consumeGraduationEvents(tickTs)` 消费指针（未持仓仅推进；卖出失败不推进=每 tick 重试）+ 收尾 drain + 买入成功点补卖 → `_emitGraduationSell` 等价全清（幂等标记后置到卖出成功）。**`_graduatedTokens` 标记在消费点填充，禁止装载即填**（前视防线）。止损 `_stopLossHit` tick 路径优先于策略腿 + `_scanHoldingsStopLoss(tickTs)` 节流扫描兜底断流票
- **`backtest.stripSenderAddress` 对照臂**：剥内存 tick 的 sender → 消费侧 COALESCE 全部回退 trader（=修正前 bit-identical；不动缓存 raw 行）
- **`backtest.tickBuildSkip` 默认开**：出窗票 `FA.shouldSkipTickBuild` 跳过 build、买窗内 C 类票喂最小 factors（fire 时 `_runBuyEvaluation` 独立全量重建，快照白名单不受影响）；显式 `false` 恢复旧行为；act\* 纯函数读取天然兼容
- 回测不嵌 OPB；`_alignClassifiedAsOf=true`（TPA 防前视）；叙事直调同链路（时漏已知，只比相对增量）

### 双平台实验（platform='both'）与 gang 单平台

- **gang 平台已停止（T86/T86b，2026-10-28 用户裁定）**：全自动所有子空间否证（.ai 门不可绕 + 毕业票 PCS 市场上限 + 打新破发）。代码/collector/GangBawTrader/单测全部留档不删——官方 `setAgentGate` 关门即翻案复用。留档机制要点：`GangBawTrader`=官方 gang CLI 子进程封装 + Binance Agentic Wallet（**不 extends BaseTrader**——签名链全在 CLI/App 侧）：买全自动（V2 分步 wrap→approve→buy / V3 直付）、卖恒须 App 确认（PENDING_CONFIRMATION→Telegram 告警+轮询，`approvalTimeoutMs` 300s 上限，超时告警「勿再确认旧单」防双卖）；**防双买/双卖状态机**（execute 状态未知/回执超时→`_unresolved` 锁同 token，reverted=终态确定解锁；expired requestId 重跑 preview 恰一次）；**单飞行队列串行**；V2 1% 帽 `expectRefund≠0`→preflightReject 拒单**不计买入熔断**；卖出到账 **WNB（WBNB ERC20）非 native BNB**（实收=WNB balanceOf 差）；351802/351803 devMode 类 fatal 告警 1h 去重；**钱包=BAW 地址 address-only 第三形态**（`walletConfig.address && !privateKey && includes('gang')` 仅 gang 放行，fourmeme/flap EOA trader 缺 privateKey 刻意拒绝 fail-closed）；**毕业票不路由 PCS**（BAW 无 EOA 签名链）——`_graduatedManualIntercept` 钩子（基类恒 false，gang 子类告警 30min 去重+返回 true）三处拦截
- 归一化唯一入口 `resolvePlatforms(platform)`（`src/trading-engine/core/platforms.js`）：'both'→fourmeme+flap 两平台，'gang'→['gang']，其余→fourmeme。**'both' 语义恒 fourmeme+flap 刻意不含 gang**（创建页 checkbox 互斥双防线+服务端校验）
- 单引擎 per-token 分派：`_handleNewToken(info, platform)` 按 collector 回调平台分派 record builder，共用买卖策略与单一资金池
- virtual+backtest+live 全支持（live=单引擎 per-platform trader map——fourmeme→FourMemeDirectTrader / flap→FlapPortalTrader 同一钱包，非首 trader `shareSignerFrom` 共享 wallet+NonceManager=同地址单一 nonce 源；`_liveTraderFor(tokenAddress)` 按池/FA 平台标记分派，未知平台 throw fail-closed）
- gang 毕业进度=资金口径阈值链 `graduationThresholdBnb ?? 15`（Created gradAmt 事件终态，registerToken set-once；noteGraduation 不学 gang）；innerPair 后缀 `_ga`
- 引擎级配置恒读 fourmemeWs 段（`_wsConfigSectionName()`，flap/gang 子类才覆盖）；**实验级 ws 配置键 flap/gang 实验经 `_mergedWsConfig` 同键生效**（gmgnCheck/narrativePrefetch/narrativeRetry/faPreFilter 等下文不再重复注记）；创建页平台选择=多选 checkbox（gang 互斥）

### 钱包口径地图（sender/trader——改任何聚合前先查）

`trader_address` = 事件 msg.sender（公共路由 0x1de460…4bc = **GMGN BSC 聚合路由**）；`sender_address` = 真实发起 EOA（tx.from）；NULL = 未解析回退 trader。

- **wallet = `sender_address || trader_address` 已切**：EarlyParticipant 90s 窗全部因子（top1/sniper/netBuy/uniform/WalletCluster）、FA holders 族（holderCount/P 组集中度/bigHolder 交叉/K 组对敲/cumBuy/滑窗/smartBot 名单）
- **TPA + 离线画像库：wallet 口径**（GMGN 用户刻意不剔 retention）
- **刻意不切**：`uniqueTraders`（classifier 契约锁定防漂移）；routerPct 因子判 **trader 层**（`AGGREGATOR_ROUTER_ADDRS`，`src/trading-engine/pre-check/aggregator-routers.js`）
- GMGN 行为 map：FA `processTick` 写 `_walletRoutedBuyBnb`（GMGN 行归 sender EOA，只记买腿）→ TPA gmgnFilter 消费
- OPB 全史路径/离线 build-token-profiles 不动（trader 口径链）

### Pre-Buy 检查（`src/trading-engine/pre-check/`）

`PreBuyCheckService.performAllChecks()` → EarlyParticipantCheckService（首 90s 窗，查 `wss_price_ticks`）+ TokenHolderService（AVE holder 黑名单）。**因子恒算无开关**，落 signal metadata `preBuyCheckFactors`；只在买策略定义 `preBuyCheckCondition`/`repeatBuyCheckCondition` 时生效（老克隆实验无此字段=裸买）。空窗返回真实零统计（拒绝语义），查询错误才走宽松值。**legacy 专属（C84 后新模型腿不走此层——新因子一律先进 FA）**。

- **已知因子合取项短路（P4a+P4b）**：条件顶层 AND 项内全部因子「检查前已知」（引擎 options 透传 17 键）且当次恒假 → 整条条件必 false——P4a 跳过全部子检查（数学等价，rating 翻正自动解除）；P4b 判定点在直调拉黑登记后、龙头检查前。live 默认关；回测 `backtest.knownFactorShortCircuit ?? true` 默认开。防线：项内混未知因子一律不评（undefined→false 误拦）；龙头三键判定点无值从已知集排除（fail-open）；knownCtx 与生产 context 逐键对拍防漂移
- 因子注入链 legacy 五步：service → 引擎 → context（键集真相源=空壳跑捕获）→ FactorBuilder 时序快照；**勿再新增**
- **earlyTrades\* FA 宿主已删（T71）**：FA 出生锚 90s 冻结窗 10 键整族退役（门已换 T70/T77 实时载体，无消费者）；`getEarlyTopBuyers` 数据口随删。存续=legacy preBuy 宿主（DB trailing 90s 窗，旧腿专用）与 launch\* 独立窗（`earlyUniformDustBnb` 尘埃门/`_LAUNCH_MAX_WALLETS` 帽被 launch uniform 臂复用保留）。条件引用已删键=三防线拒启 → 存量实验须换车（copy-in 快照）

| 因子族 | 现状 | legacy preBuy 口径（旧腿） |
|---|---|---|
| earlyTrades{PerWallet,MaxWalletTrades}/NetBuyRatio/UniformBuyCluster\* | FA 键已删（T71）；净买观察改 `tradesNetBuyRatioLongWin` 长窗（T88） | （无此键） |
| earlyTradesTop1BuySharePct（+Top1BuyBnb/BuyBnb） | FA 键已删（T71） | 同名键 trailing 窗+covered |
| earlyTradesRouterPct | FA 键已删（T71）；门换 `tradesRouterPct` | 同名键+covered |
| earlyTradesSniperHoldingPct（+SniperWallets/SniperHolders） | （无此键） | sniper 正持仓 Σ/池 Σ×100（`isSniperProfile` 见 `pre-check/sniper-detector.js`；画像 miss=非 sniper）；拦截伴随 SnipersWallets ≥2 |
| narrativeCorpusLagSec | FA 出生锚−语料最新推文时间（主推/父推/第二推文取 Math.max）；负值=宣告竞态按早票放行；null=无语料/无锚 | **纯观察键**（照落 metadata）；时效硬拦在叙事 precheck 分桶（速查表 C74/C104 行） |
| strictSameNameTokenCount | **回测=as-of 快照优先**：实时引擎成功后 append 写 `ave_same_name_snapshots`（6h 节流，全局资产不挂实验 FK）；回测取 `searched_at<=asOf` 最近快照，miss 才兜底实时且行级过滤未来行（宁拦不冒充） | `>= 3` 拦 |

**T70 实时载体（buy-v2 v39 起路由门载体）**：`tradesRouterPct`=Σ(trader∈聚合路由的买)÷Σ买×100，写点=processTick「计数与地址统计」段（全量 tick 照计、只计买腿、router 判 trader 层）——**全史累计无窗无冻结**（买点评估即当时真值；慢热票散户参与照抬升；T88 净比同族键换长窗后本键**刻意维持全史**——路由占比无「砸盘拖低」形状，分子分母同源无时漂）。early 90s 冻结窗对慢热票结构性失真 → 买腿换实时载体；慢热或臂不设 600s 帽（`tokenAgeSec < 90 OR tradeCount >= 25`）→ preFilter age 无上界=不裁剪慢热票。

**T77+T87+T88 净买窗三键（buy-v2 v44 起载体）**：`tradesNetBuyRatioLongWin`=**最近 `netBuyWinLongTrades`（默认 100，factorParams 可覆盖）笔**主趋势（全史键 tradesNetBuyRatio 断代载体——全史被前期砸盘卖量永久拖低；M>n 时=全史值=中小票 bit 一致；M 实质=长命票记忆上限）、`tradesNetBuyRatioShortWin`=最近 `netBuyWinTrades`（默认 20）笔即时流、`tradesNetBuyShortWinBnb`=短窗买量观察键不进条件串。**买腿净买门（T96/v49 起两臂 AND 形状）**：`(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)`「短期开始涨，长期下跌趋势解除」——严格收紧新⊆旧（v44-v48 曾 OR 臂 `(L>=40 OR S>=40)`；拦「长强短弱」与「短反弹长窗净卖」两形状；阈值 40 承 T77/T70）。**null 语义（T87/T88 统一）**：环空=null fail-closed（门恒 false）；尾窗全卖=-100 有证据零值。复用 `_activityEvents` 事件环（求和交换律=defer 乱序回推无害），`_pruneActivityEvents` **环尾 floor=max(netBuyWinTrades, netBuyWinLongTrades, 32) 笔永不裁**（maxCut=evts.length−floor 上限防稀疏票窗证据被纯时间界裁穿）；旧键名条件串配新 FA=三防线拒启 → 存量实验须换车。

- **covered 语义**（top1/router/sniper 同构）：age>90s 或 launchAt 缺失 → 0 值放行（null 会让 `<N` 恒 false 误拦）

### 买腿链路（C84）与 GMGN 条件（`gmgnCheckCondition`）

买腿两模型并存，**按腿激活**：腿携带 `narrativeTriggerCondition` → 新模型；否则 legacy（触发 fire `condition`+`narrativeCallCondition` 直调 → preBuy 预检查 → GMGN）。

- **新模型（C84）**：`叙事发起条件（FA 因子表达式）→ 后台多轮叙事分析 → 单一买条件（condition，含 narrativeRating == 2 OR == 3）→ GMGN 条件 → 执行`。全部因子在 fire 时刻同一 FA 因子表上评估，virtual/live/backtest 三态同源，消除两阶段因子漂移
- GMGN 条件（两模型共用）：前序条件全过、确定要买时才构建=**此刻才真调 GMGN getTokenInfo**（配额最小化+数据新鲜；repeat 轮与首轮同一条件串）
- `GmgnRiskCheckService`（`pre-check/GmgnRiskCheckService.js`）：5s 超时 / per-token 5s 成功 TTL（0=每次硬调）+ inflight join / 失败 10s 冷却；**只认自己 fetch 的结果**（不读不回写叙事缓存，防 TTL 污染「买前新鲜」语义）；配置 `fourmemeWs.gmgnCheck`
- **fail-open 放行**（2026-10-20 用户裁定，原 fail-closed 翻转）：API 失败/超时/未索引/key 缺失/冷却 → covered=0 → 放行（不评估表达式，`evaluated=false`+reason 留审计）——GMGN 是附加风控层，API 不可用不得拦住买点。**条件表达式评估异常（键集外/语法）仍 fail-closed 拒**（配置/实现错误，与 API 不可用刻意不同）
- 因子五键 `gmgnBundlerWalletRatio/gmgnIssuerTokenCount/gmgnRiskCovered/gmgnVisitingCount/narrativeCategory`（前四键 `mapGmgnRiskFactors` 单点映射；风险提取 `src/core/gmgn-api/risk-fields.js` 与叙事侧共用；visitingCount 观测键**刻意不参与 hasAny**；narrativeCategory 非 GMGN 产物——从 fire 因子表透传，回测同位 spread）
- **注意力空转观测四键（T76）**：`gmgnBuyWallets`/`gmgnBuyVolumeBnb`（原料透传）+ `gmgnVisitorsPerBuyer`/`gmgnVisitorsPerBuyBnb`（比值）——`computeGmgnAttentionFactors` 静态纯函数单一真相源，实时=checkAndEvaluate **第六参 buyContext**（fire 因子表，不占第五参位）、回测=组装点 spread 同构；零值语义 famous 0 同向（buyWallets=0 且 vc>0 → 取 vc 零买家空转上限；vc=0 → 0 正常新票恒放；covered≠1 → 比值 0 不合成）；合成键写 `{...factors}` 拷贝不污染 TTL 缓存；**纯观察不进条件串**（阈值待票池分布裁定）；vc 本质=GMGN 滚动窗口非累计。whale/creator 两观测键已随 T76 删
- **叙事类型 × issuer 分档门（C85+T73）**：适用集 `{project, account_based_meme, web3_native_ip_early}` 内 `gmgnIssuerTokenCount <= 1`（serial issuer 拦截），事件/梗/名人类不适用（event:W 已撤出适用集，T73）；**null IS NULL 臂放行 fail-open**（null→0 同覆盖 fire 未就绪形状——fire 时刻 GMGN 未填充显 0 是常态）；条件串必须带 `narrativeCategory IS NULL OR` 前置臂（裸比较对左值 null 恒 false 误拒，单测锁死）
- 回测挂点**不真调 API**：消费直调快照 `narrativeCallInfo.gmgnRisk` → 同款 `evaluateFactors`（快照缺失同 fail-open 放行，与实时同判）
- **GMGN 钱包画像层（C89，默认关 `fourmemeWs.gmgnWalletStats.enabled`）**：**引擎接线已随 T71 删除**（数据口 `FA.getEarlyTopBuyers` 随 early 族退役，第五参恒 null=存量零影响）；纯函数层（Service/表/离线建库脚本/单测）保留，将来重启须换全史数据源重新接线
- 库 buy-v2 门：`gmgnBundlerWalletRatio <= 65`；signal metadata 落 `gmgnCheck` 审计轨迹（拒/过两路径）

### C84 叙事触发模型（`narrativeTriggerCondition`）

- **触发状态机**（引擎 `_narrativeTriggerCheck`，挂 `_onFactorsUpdated` 买腿分支 N3 同位）：per-token `{rounds,inFlight,hasInitial,lastRating,lastCompletedAt,accountOnly,corpusEmpty,currentRowId,category}`；tick 时刻评发起条件 → 过门发起后台 `getRating`（fire-and-forget）；首轮 reason='condition'（token 级缓存秒回），补轮 reason='retry' 仅当 lastRating==1 ∧（accountOnly ∨ corpusEmpty（C162 零自有语料臂——`hasNoOwnedCorpus`：classifiedUrls 各桶全空=宣告推/GMGN link 晚到竞态，走 noCorpus\* 独立节奏））∧ rounds<maxAnalyses（按臂选参，双臂同真 accountOnly 优先）∧ 距完成≥intervalMs（判据与 FA narrativeRetryDue 逐字一致，双侧冗余把刻意的）；补轮带 `overrideOptions:{ignoreCache:true, invalidateAccountCorpus:true}` 走 '!ttl' inflight 槽。每轮发起/完成即 `FA.setNarrativeFactors` 投影；完成回填 identity 校验（states.get !== st → 只收尾不投影）。**重启全内存语义**（rounds 按进程计）
- **FA 叙事四键**：`narrativeRating`（null|1|2|3|9）/`narrativeRounds`/`narrativeRetryDue`（**now 用 buildFactorMap 入参禁 Date.now**）/`narrativeCategory`（token_category 同形状，GMGN 分档门因子源）——模块级 Map（RAW tokenAddress 键）；config 由引擎 ctor 从 `narrativeRetry` 段投影（四键全传）。rating null/1/9 ⇒ 单一买条件恒 false ⇒ 天然无信号（**unrated 放行政策在新链路废止**）
- **轮次留痕表 `narrative_analysis_rounds`**（CASCADE 挂 experiments；insert/update 观测 fail-open）；查询 `ExperimentDataService.getExperimentNarrativeRounds` + `GET /api/experiment/:id/narrative-rounds`（service key 红线）
- **互斥 fail-fast**：同腿 `narrativeTriggerCondition` ∧ `narrativeCallCondition` 均非空 → loadStrategies throw / validateLegs 400（新模型腿天然跳过 legacy 直调/预检查/拉黑短路——字段存在性即门）
- **回测口径**：无状态机；`_preloadNarrativeRows` 门扩至 trigger 腿 + FA 常量注入（非 1/2/3 归 9；**rating=token 常量=已知时序穿越，结论只看相对增量**）；ctor `setNarrativeFactorConfig` 四键全锁锁死 retryDue；fire 链 trigger 腿不评触发条件直接 getRating 仅为取 gmgnRisk 供 GMGN 快照层；**不登记拉黑/不算 lag/不跑 P4b 与同叙事龙头检查**；stop 清 FA 注入防下轮回测继承
- **dataPrefetch/visionPrefetch 退役**（机制整链删除）：存量实验带该段=静默丢机制（上线前 SQL 核查 running 实验）；ipfsCacheWriter 注入保留
- **刻意行为变化（用户裁定）**：①rating=9 拦截（旧 unrated 放行废止）②sniper 持仓/同名簇观察键不再采集 ③同叙事龙头检查不跑 ④`_narrativeBlockedTokens` 不消费（条件即门，retry 上限即调用预算）⑤earlyTradesPerWallet 分子偏 SQL 行数略低 → `<4` 门偏放行（T71 键与门同批删除）
- **关键不变量**：发起条件量门 < 买条件量门 ⇒ 分析必然先于买门可满足而发起（库条目维护该序）；N3 与触发模型 per-leg 互斥共存（trigger 腿无 call/prefetch 条件 → N3 天然 no-op）

### 条件未知因子 fail-fast（三层防线）

写错因子名的条件子句静默恒真/恒假（比较恒 false / IS NULL 恒 true），必须拒启而非 warn：① `ConditionEvaluator.validateCondition` 含 IS NULL/IS NOT NULL operand 检查；② `StrategyEngine.loadStrategies` 校验失败 **throw**（`condition`/`narrativeCallCondition`/`narrativeTriggerCondition` 用 FA 因子集——trigger 与 call 同腿共存=互斥 throw；`preBuyCheckCondition`/`repeatBuyCheckCondition` 用 PreBuy 键集；`gmgnCheckCondition` 用 GMGN 键集——分集防双向误报）；③ `StrategyLibraryService.validateLegs` 入库同口径 400。上线前跑 `scan-unknown-factor-conditions.cjs`。

### FA（`src/services/FourMemeFactorAggregator.js`）

- `_buildFactorMap` 字面量键（`getFactorKeys()` 探针自动收键，未知因子三防线自动认得，勿手维护清单）；`tokenAgeSec`=`age×60` 同源双路径，preFilter 提取 /60 归并 age 区间，快照白名单落库
- **roster 三名单**（模块级 Set 加载，sniper/smartBot 同款 loader）：
  - 跟单簇 `config/rosters/copy-wallet-roster.json` + `maxCopyWalletHolderCircPct`：因子=名单钱包**单钱包最大**净持仓÷流通（刻意最大非合计）；名单 null→恒 null→`<N` 门恒 false=**fail-closed**。生成=`scripts/scan-copy-trade-clusters.cjs`（pair 统计缓存 `data/offline-cache/copy-trade-pairs.json.gz`，`--from-cache` 调参零网络）；维护=182 重跑 `--commit` → push → 重启实验生效（静态快照，滑掉的手工钱包人工保留）
  - 极著名钱包 `famous-copy-wallets.json` + `famousCopyWalletCircPct`：**独立于主名单**（scan --commit 不影响它；增删用户裁定），单独更紧的门；**0 语义**（用户裁定去 NULL）：集合 null/空/无命中→恒 0→条件串裸比较放行（无 IS NULL 臂）；fire 就绪度依赖 sender 回查（GMGN 路由行 wallet 段回推 1-3s 竞速缝隙）
  - sybil 大簇 `sybil-clusters.json` + `sybil-clusters-manual.json`（FA loader 合并；manual=人工锚定铁指纹镜像对，build 不覆盖）+ `sybilClusterHolderCircPct`：判据（T72 三通道）一档强边 co≥50 且同步卖/等额≥0.5 + 二档强边 co≥20 且 ≥0.85 + 分发号通道 buys==0 且 sells>0 且 tokens≥50 → 连通分量 size≥3；因子=簇内钱包**合计**正净持仓÷流通×100（单钱包口径对分仓簇天然漏检）；同 0 语义；维护=重扫 pair 缓存后重跑生成脚本 `--commit` → push → 重启实验进程
- **preFilter live 平移默认开**（`fourmemeWs.faPreFilter !== false`）：从各买腿 condition **AST**（必须 AST 直传，String() 化恒 null 静默失效）提取 age 区间注入 `setPreFilter`——出窗未持仓票 build 返回 null → 不 emit factorsUpdated（零 per-tick 评估，与回测 tickBuildSkip 同族）。持仓豁免=`_positions.size===0` 结构性保证。build 内部等价削减：K 组对敲两趟无 Set 物化、`_walletNetTokens` 三趟合一——bit 一致对拍锁定
- **act\* 8 键滑窗**（`activityWinMs` 默认 10000，`fourmemeWs.factorParams` 可覆盖）：`actBuyBnb/actSellBnb/actNetBnb/actTrades/actTraders/actBuyers/actSellers/actNewTraders`；wallet=sender||trader（null wallet 行计量不计人）；actNewTraders=首见时刻也落窗内的钱包数；写点 `_applyWalletAggregation` 尾部（摊销裁剪：>64 且头部越过 2×窗才 splice，2× 余量保护 defer 乱序晚到行）；读点纯函数（空窗全 0=有证据零值）；**禁 Date.now（now 由 buildFactorMap(state, asOf) 传入）**；序列不可重建，FactorBuilder 两处快照透传（不落库即丢）
- **holderTrend slot 化**（11 键·历史断代）：原料序列=blockNumber 桶×8 块≈4s（同块覆盖/8 块封顶；W=8 与 HolderTrendDetector maxPoints=8 **必须同改**）；与价格接受链**解耦**（离群/零价 tick 照推进）、blockNumber 缺失不推进；价格 `_priceSeries` 10s 桶不变（trend 族）；门槛：growthRatio 族 ≥2 点、slope/direction 族 ≥4 点；slim 快照含 11 键（序列不可重建）
- **集中度门族（演进=T1→T67/T68→T91→T93→T95，详见 T 台账）**：条件串现行为 top1/top2 轴两键（`bundleClusterHoldCircPct` 块簇存量 + T93 起持有人口径 `top2HolderCircPct`——前两大净持仓合计÷同一 `_circDen`×100，恒 ≥ top1、恒 ≤100、<2 正持有人退化=top1、0=有证据零值）+ 跟单簇/famous 门；**各臂现行阈值以 strategy_library 最新版为准**。以下键**纯观察 FA 照算不进条件串**（阈值须票池分布裁定）：bundle 流量 6 键、top2/top3 块簇存量键、evenCluster 三键（T74 等额买簇：amountKey=**四位舍入 0.0001 BNB**（T78）；合格桶 size≥3 同额并集去重；尘门 `earlyUniformDustBnb` 以下不入桶）、`top1HolderSupplyPct`/`top2HolderSupplyPct`（T94：前 1/2 大净持仓÷totalSupply 不受流通进度污染；supply 缺失 null fail-closed）、`sybilClusterHolderCircPct`（T93 起退出条件串）。原料 `_blockBuyWalletsAll`/`_evenBuyBuckets` 全史不裁（`_blockBuyWalletsAll` 刻意不与 `_blockBuyAgg` 共引用——滑窗淘汰后晚到回推行重建条目会断裂同引用语义）。**T91a 流通分母口径**：全部 ÷circ 键分母统一 `max(_circTokens, Σ正净持仓)`——flap 税币零买入纯卖出钱包曾把 Σ买−Σ卖 分母压到低于真实在外筹码 → 键值虚高超 100%；恒等式（分子只计正净 ⊆ Σ正）保证 ≤100、正常票逐输入 bit 不变；读取点单趟求和序无关
- **`tradesRouterPct`（T70）与净买窗三键（T77/87/88+T96）**为现行流量门载体（见 preBuy 段）；`buyWallets`（T76）=K 组 `_buyerAddresses` 全史 Set size——曾买入即计入、清仓不回退（与 holders 分母分离），GMGN 层注意力空转比值键的买侧原料

### 策略库

- `strategy_library` 表（全局，name UNIQUE/side 锁死/legs jsonb/version 乐观并发 409）；创建页「从库引用」=**只读快照卡 copy-in**（实验 config 自包含，改库不影响已建实验，改库须重启实验进程）；`strategiesConfig.libraryRefs` 纯 provenance
- **routes 必须走 `dbManager.getClient()`（service key）**——anon 被 RLS 静默过滤；**部署红线：DDL 先于新 web-server 重启存在**
- **groups/cycle 已废**：`loadStrategies` 遇腿带 groups（非空）/cycle 字段 **fail-fast throw 拒启**（静默失效=腿恒可见是危险方向）；引擎 strategyArray 刻意原样透传两字段供 fail-fast 识别，**不得剥除**；存量库条目在库页重存/导入时前端自然剥离；活跃度维度改用 act\* 滑窗因子
- 创建页只读化：腿只能来自库引用；`card.dataset.rawConfig` 整包存取；复制链路高级段（stopLoss/tokenPositionAnalyzer/fourmemeWs）经 `window._copyAdvancedConfig` 回填保真；卖腿平铺展示、提交序=DOM 序

### 卡牌 / 止损 / 毕业卖（引擎级机制，实验 opt-in）

- **卡牌**：开关=`positionManagement.perCardBNB` 存在且 >0（不配=字段全忽略）。策略级 `cards`（卖腿额外接受 'all'）+`cooldownSec`（独立于卡牌）。买入=perCardBNB×cards（virtual 现金门不足=买失败不降张）；卖 sizing soldN/tokenCards（全清腿恒精确 1）——**sellPercentage 已退役（卡牌是唯一卖 sizing）**：携带该键的存量卖腿 loadStrategies fail-fast 拒启（透传防线同 groups/cycle）；validateLegs 卖腿必配 cards；signal.sellPercentage 为内部比例 plumbing（0-1）保留。卡账本 `_tokenCards` 维护在 `_executeSell` 成功分支，trades.metadata `cardTrade:{cards,before,after}` 绝对值重放恢复。**重放精度钳制**：遇 `Insufficient token balance` 且差异≤相对 1e-9 → 钳到持有量重试；真超卖照常失败且**单票失败只跳过不中断其余恢复**
- **止损双腿**：开关=`stopLoss` 段存在任一腿参数。时间止损（持有超 N 分钟仍 `profitPercent <= 0`——`<=` 刻意：断流冻结票 profit 恒 0）/价格止损（`<= 负阈值`）全清，双命中标 price。双挂点=tick 即时（优先于策略腿）+ `scanIntervalSec` 扫描（**断流票唯一触发路径**，buildFactorMap 必传 Date.now()）；`_emitStopLossSell` 复用策略 `stopLossPrice/stopLossTime` 全清链；仅虚拟系引擎（回测有自己的版本）。用户裁定「所有卖出归卖出策略管」：现行实验以卖腿表达止损（bypass=false 走确认窗、刻意不设 maxExecutions=卖出失败每轮重试直到清仓）；其余带 stopLoss 段实验不动
- **持仓卖腿兜底扫描**：`_scanHoldingsStopLoss` 除止损外新增卖腿评估——断流票（>60s 无 tick，FA `lastTickAt` 判据）调 `_evaluateSellPath`（bypass 腿立即卖/默认腿 touch 确认去抖）；活跃票不评。启用=存在卖腿；周期 `stopLoss.scanIntervalSec ?? sellScanIntervalSec ?? 30s`；stopLoss 段启用但未配 scanIntervalSec 的存量实验止损仍仅 tick 路径（存量语义不变）
- **账号信息复检卖臂（C166，默认关 `fourmemeWs.accountHealthCheck.enabled`）**：持仓期检测宣告账号删号/删推（rug 前兆早于价格）→ FA `issuerAccountState`（'active'|'deleted'|'tweets_gone'|null）→ 卖臂条件全清。检测=`AccountHealthMonitor` 裸调 apidance（**绝不走 TwitterFetcher 缓存层**——失败 1h 冷却会吞删号信号）；删号只认「用户不存在（空响应骨架）」特异 message、删推严格 tweet_id 全等（getTweetDetail tweets[0] 兜底坑）；故障归 unknown 投影 null fail-open；引擎 30s 扫描+懒解析 token_narrative.twitter_info（负缓存）+双档节流（前 10min 每 30s/之后每 2min）+回填竞态防线+清仓自清理+再买入重置；回测零接线因子恒 null（时序穿越防线）；库卖腿条目 `rug-exit-account-arm`
- **买锚 fire 价口径**：FA `buyPriceBnb` 定在买信号 **fire 时刻**（`_runBuyEvaluation` 捕获 `factorResults.currentPriceBnb`），profitPercent/peakProfitPct/drawdown 族全程按 fire 价起算；记账锚 `buyPriceUsd` 不变（live=实际成交价/虚拟=signal.price）；fire 价缺失回落执行时刻价；回测 fire==执行同 tick 天然一致；重启恢复锚点与手工锚点不动
- **fire 窗峰值回填**：fire 点 `markBuyFire(token, firePriceBnb)` 开 pending 双轨峰（peakAny=任意接受价/peakRel=可靠价，outlier/chainLate 不推进），买入成功 `setBuyState` 消费回填；失败 finally `clearBuyFire` 兜底；**无 pending 标记时 setBuyState 逐位退化为旧行为（回测 parity 红线）**
- **双时长 + 执行口径键**：`holdDuration`=信号（fire）时刻起算（`buySignalAt` 缺省回落 buyTime=旧形状 bit 一致）；`realHoldDuration`=成交时刻起算（物理持有）；执行键 `buySignalAt/buyExecutedAt/buyExecutedPriceBnb`（live=余额差法成交价，虚拟/回测=null 诚实语义）。`_stopLossHit` 时间臂读 `realHoldDuration`（保命腿=物理持有）；策略腿内 `holdDuration` 保持信号口径，P4 市值清仓腿须显式 `realHoldDuration > 10` 保住「成交后 10s 缓冲」原语义
- **毕业事件驱动卖**：virtual 持仓票 `_handleGraduation` → `_emitGraduationSell` 全清（幂等标记后置到卖出成功；graduation 事件会重复派发）。三挂点：事件路径 + 买入成功点补卖（FA `graduated` 标记竞态）+ 扫描兜底（事件路径失败的唯一重试）。**flap graduationProgress=资金口径**：池净入金 Σ(0.98×buy)−Σ(1.0204×sell)（BNB 域，processTick 每行恰一次；quote 盘 ±3% 汇率换算噪声）÷ 毕业阈值（per-quote 毕业事件 `noteGraduation` 学习值 write-once ?? 全局 15.99808481559237）；**gang 同资金口径但净额直计**（系数恒 1.0——tick bnb_amount 已是事件费后净值，套 flap 系数=双重折算）÷ `graduationThresholdBnb ?? 15`；与 indexer 进度的已知偏差=累计卖税 ~1%×卖量（progress 仅展示/条件用，实际毕业走 Graduated 事件，详档 docs/gang-events.md）；零价格依赖；four.meme 原市值/72 锚不动；platform 由 registerToken meta 注入、tick.platform 兜底回填（回放同口径，含尘 tick ~+0.2%）；累积器进程内存态，重启后跨重启池进度低估（毕业事件全清/人工兜底）。**live 毕业=Telegram 告警人工处置 + 毕业票卖出路由 PCS V2 外盘**：FA graduated 票自动卖腿（策略/止损/扫描）与手工按钮统一 `_executeSellLive` → `_ensurePcsTrader`（setLogger+shareSignerFrom nonce 红线）；flap 非 BNB 计价盘毕业对=token/quote → 二跳 [token,quote,WBNB]（quoteToken 由 FA state write-once 捕获）；PCS 分支 options=slippage 小数+quoteToken，**不带 minOutRatio/expectedNativeOut**（旧 L1 锚=断流后恒陈旧信号价，quote 活报价必拒）

### 信号机制

- **观察信号（实验级默认关 `fourmemeWs/flapWs.observationSignals.enabled`，仅 virtual+live 回测零接线）**：叙事评级==2|3 或市值>`marketCapThreshold`（默认 12000 USD 严格大于）→ 每票最多 `maxPerToken`（3）行 `signal_type='OBSERVE'` 信号（action='hold' 恒不触发交易），事件首记+`intervalMs`（60s）间隔补采；`ObservationSignalService`（`_onFactorsUpdated` 买腿分支同步直调，天然继承未持有判定；sold 票 repeat-buy 轮可再观察、上限全局兜底）；init() DB 分页重建计数（重启续接）；写行 fire-and-forget 先记内存态防双发、失败不回滚；启动/构造失败=机制本次不启用交易照跑。signal_type CHECK 含 OBSERVE（DDL）；signals 页观察筛选+灰徽章+手工买按钮（POST manual-trade）；创建页观察区默认不勾、关=删段、回测剥离
- **strategy_signals 进程内缓存**（AbstractTradingEngine `Map<signalId,{row,metadata}>`）：缓存命中→本地 merge→UPDATE→**成功才提交缓存，失败 delete 回退 SELECT**（绝不以缓存遮蔽落库失败）；终态落库后 delete（有界）。前提：实验进程是 signal 行唯一写者
- **永久阻断条件编译缓存**：`new Function` 结果按 `${jsExpr}\0${keys}` 模块级缓存，catch fail-open
- **去抖**：买腿 `signalDebounceMs 200 / signalDebounceMaxWaitMs 1000`（slot 级合并：200ms≈0.25×BSC 0.75s 出块）；卖腿确认窗 `sellDebounceMs 3500` + **双门槛确认** `sellDebounceMinTicks 5 / sellDebounceMaxWaitMs 120000`（首真起计**不重置**、窗口内恢复 clear 不卖、fire 重评仍真才卖；minTicks>0 时 fire=时间窗 AND 窗后新 tick 数——**断流票窗内零 tick 不得按陈旧快照卖**，timer 到点证据不足转等待、后续 touch 凑齐即时 fire（real），maxWaitMs 首真起计绝对上限强制逃生（fire 仍重评，翻假不卖；stats.forceFired 计数）；minTicks=0 缺省纯时间语义存量 bit-identical；virtual advance 同口径但死票时钟静止=回测偏保守缝隙）；bypassDebounce 腿/引擎级止损/毕业卖/强平走立即路径——**现行全部卖腿（含止损臂）按裁定 bypass=false 走 3.5s+5tick 双门**。实验级键可覆盖，跑中实验须重启进程生效
- **叙事直调** `narrativeCallCondition`（legacy 腿）：fire 因子满足（不含 narrativeRating 自身）→ 拉黑检查后、pre-buy 前同步 `NarrativeAnalyzer.analyze()`（`pre-check/NarrativeDirectCaller.js`）；Jev 秒级，30s Promise.race 超时（超时后台续跑落缓存，下轮命中）；失败/超时 normalize 9 放行——由 `preBuyCheckCondition` 里 `narrativeRating` 决断。**语法 AND/OR only，`&&`/`||` 被静默截断**；轨迹落 metadata `narrativeCall`（含 timing 分段）
- **叙事预触发（N3，legacy 腿专属——trigger 腿天然 no-op）**：开关=`fourmemeWs.narrativePrefetch.enabled`（**默认开**：删段=开、显式 false 才关；回测不适用有 preloadCache）；tick 时刻评估首条买腿 `narrativePrefetchCondition ?? narrativeCallCondition`（不配=用现有条件；没配叙事条件的腿恒不预取），满足且未 write-once → 后台 `getRating`。与 fire 直调共用同一 DirectCaller（inflight join/缓存秒回，fire 侧零改动）；write-once per-token 无论成败；rating=1 提前登记 `_narrativeBlockedTokens`
- **叙事一票否决**：直调 `numericRating=1` → 内存 `_narrativeBlockedTokens` 拉黑（后续 fire 写 signal 行前短路：无信号无重复调用）；豁免=`precheckStage === 'address'`（宣告竞态）且 age<300s；rating 9 永不拉黑；内存态重启丢、首 fire 经缓存重建
- **账号型 TTL 穿透重析**：语料入口只有账号（`isAccountOnlySource`）且 rating=1 的缓存行，行龄≥TTL → 穿透 `analyze({ignoreCache:true, invalidateAccountCorpus:true})`——失效 external_resource_cache 账号三键（`twitter_account` 层刻意不失效）；失效下沉 getAccountWithFullTweets 内部且带同款语料形状门；per-token 真跑上限（缓存命中不计）；穿透走独立 '!ttl' inflight 槽
- **叙事重试配置 `fourmemeWs.narrativeRetry`**（默认开 `enabled !== false`——删段=开）：`intervalMs` [1000,600000] 缺省 10000 / `maxAnalyses` [1,50] 缺省 3（**计含首析故名 maxAnalyses 非 maxRetries**）/ `windowSec` [60,7200] 缺省 300（⚠️**不得低于 worker retryWindowSec**——拉黑先于末次重析翻正=误拉黑且无撤销路径）/ `noCorpusIntervalMs` 缺省 10000、`noCorpusMaxAnalyses` 缺省 10（**C162 零语料臂独立节奏**，仅 corpusEmpty 臂消费，双臂同真 accountOnly 优先）。C84 兼供触发轮（四键投影 FA narrativeRetryDue 与状态机）；BacktestEngine 零接线（回测禁穿透/禁补轮=语料前视防线）；UI 物化语义：显式关写 enabled:false、回测剥离
- **叙事结果=token 级全局缓存**：`token_narrative` 按 token_address upsert 跨实验共享；失效=行删或 `NarrativeRepository.updateIsValid(addr,false)`；**历史窗口回测前先失效缓存**（题集变更后旧缓存行缺新题答案）：`scripts/narrative/invalidate-referent-window.cjs` / `invalidate-carrier-window.cjs`（&lt;基底实验ID&gt; --commit，范围刻意只收窄基底买过的 token）
- `token_category` 列写入：`deriveTokenCategory(prestage, stage1)`；终态重析无分类（precheck fail/no_data）由 final save 显式 `clearTokenCategory` 置 NULL——**重跑必须反映本次判定**（C146）；dbSave.intermediate 不传标记=保留旧值

### TPA / OPB

- **TPA**（`src/services/TokenPositionAnalyzer.js`，`config.tokenPositionAnalyzer` 段存在才构造）：触发门命中（write-once）对 top20 持仓 as-of 画像，`TPAPre_*` 因子族注入 FA；策略引用未触发的 `TPAPre_*` 恒 null → false=**fail-closed 不买（去门控化）**；触发门校验 fail-fast（时间门 blocks/ageSeconds 恰一，数量门非负）。三路径：离线 fresh 直用/stale 增量/miss 实时现算；retention 基准=触发刻峰值枚举大户集冻结后 running 净持仓重算（净卖<1=走人）。**live ticks 缓冲窗口裁剪**（默认关）：`liveTicksRetainHours`（null=不裁）挂 5min prune——删头段须同步推进 `_liveTicksBufferStartMs`（不推进=缺口漏报=掩盖问题），miss 请求 fail-loud 不回退 DB。**gmgnFilter**（`{enabled, exemptPct}` 缺省关）：①GMGN 用户钱包（本盘内经聚合路由买入>0）不参与分数 ②前期参与者 GMGN 占比≥exemptPct → **豁免放行**（不能做成 null——null 在 `TPAPre_tokenScore > 2.5` 下 fail-closed 拦死，与散户盘语义相反）③minHolders 同步剔非 GMGN；豁免救回 `TPAPre_gmgnExempt=1`+verdict 改写；`TPAPre_gmgnUserPct` 恒落纯观察。BSC 新钱包中性分 2.2（非 creator 只升不降）
- **OPB**（`src/services/OnlineProfileBuilder.js`，`fourmemeWs.onlineProfile.enabled` 默认 false）：实时代币分类，双门触发（idle 60s / bigTickIdle 600s）+ 60s 扫描补救，写 `token_profiles`（全局 PK，source='online'，不挂实验防级联删）；阈值判定与离线 classifyToken 共用 `scripts/shared/token-classifier.js`（单一真相）；TPA 联动喂分类缓存。**重启过渡期全史路径**：水位对齐前的存量活跃 token 价格史不完整 → 自动改走 wss_price_ticks 全史+classifyToken（防涨幅失真）；失败 fail-closed 不写失真行、待扫描重试

### 叙事引擎（`src/narrative/`）

所有 LLM 决策走 **Jev**（api.typesafe.ai，结构化三原语 Choice/Score/Noul，无文本生成，一票一次 fan-out 调用秒级）。

```
Token URL → URL 分类（含 IPFS metadata 解包——meta 任意 http(s) URL 直抓+JSON 内容判定，形状判定已废 C112）→ 数据抓取 → Pre-Check（纯规则）
   ├─ 账号/社区 token 或自发宣告 → prestage Jev（3 题，粉丝带只定档不拦截——P1.12 删社区活跃题后社区臂恒 mid；isProjectCoin 的网站/URL 证据臂不采信聚合器自动 token 页——AUTO_TOKEN_PAGE_DOMAINS 清单）
   │    · C251 同名自发宣告走账号路径：发布者与代币同名（detectIssuerSelfLaunch 品牌同一+宣告指纹）即令推文内容丰富也走 prestage（J1.68「有内容推文」豁免对该臂废止，issuerCa 臂维持）；prestage 地址核验 low 对该臂终局不回落 W（C238b 回落对非同名臂存续）；例外=账号影响力极大走 meme 路线（C117 双门：≥100 万粉不判+superIP 短路）+C251 追裁定影响力豁免（hasInfluentialAuthor 粉/赞/转任一过 C74 同尺 THRESHOLDS 5000/500/100 → 路由层豁免改道走标准路径；豁免不动检出门=C240 issuerTimingExempt 链依赖检出）
   └─ 标准路径：单次 Jev 调用（主干题+条件题 name_image_consistency/image_depicts_name/parent_relationship/bluechip_event_identity/image_name_text_match（C243/J1.141）；品牌劫持轴已废 C172——判据归 bsc_meme_user_name_event_acceptance（J1.112/C183 全族断代 bsc_meme_user_*，评估主体=BSC meme 币用户）；superIP 注册表命中 → state 注入认证/反混淆行，评分全归 Jev）
```

- **文件**（`analyzer/llm/`）：`JevClient.mjs`（缺答案 id 直接 throw；429/5xx 退避，Retry-After 头优先、钳 [500,15000]ms）/ `jev-questions.mjs` / `jev-prestage-questions.mjs` / `jev-state-builder.mjs`（60k/20k 预算）/ `jev-result-mapper.mjs` / `jev-prestage-mapper.mjs`（**聚合/阈值/截断全在代码侧**）
- **版本规则**：改任何题面必须 bump `JEV_QUESTIONS_VERSION` / `JEV_PRESTAGE_QUESTIONS_VERSION`（落库标识）；校准验证=**标准题集定向重析对拍**（182 `reanalyze-tokens.mjs` 案票翻转+带父推 high 票不翻）
- **时间基准**：新鲜度对 **token 创建时间**（`raw_api_data.created_at`）计，绝不用墙钟——重跑/回测/延迟分析幂等；缺创建时间 pre-check 跳过时效规则、Jev state 退墙钟
- **修正教训（改校准必读）**：①题面改锚分不动（反复实证）——语义修正措辞能翻 argmax，分数锚定必须代码侧 mapper 门；②校准重跑必须**逐字复用线上 jev_prompt.state**（token_narrative 不落 binance_square/instagram/website 等语料段，重建 state 缺语料致档位漂移）
- **图分析（vision，C243/J1.140 图片直连）**：主推第一张图**直接内嵌主 Jev 调用**——`getTweetImageAsset` 归一化图本体（dl-v2：EXIF 转正/长边>1568 缩/短边<280 放大/极端长宽比白底 letterbox/baseline JPEG q85，镜像 API 硬限制；产物二次校验 fail-closed null）→ `JevClient.ask(state, questions, { assets })` 顶层 assets map+头 `TypeSafe-Danger-Zone-Images`；state 渲染 `【主推配图】:main_tweet_image` 引用行**恰一次**（每出现一次计一次图 token）。图相关条件题对照对象=图本体；C78 拼写门判据源=条件题 `image_name_text_match` 三桶；落库前剥 `image_asset`（base64 不入 token_narrative）。**剥图重发防线**：主调用 HTTP 4xx ∧ 图片特征词（`_isImageRejectionError`）→ loud warn+剥 asset 无图 state 重发恰一次=无图证据语义；其它 4xx 照常 throw（不掩盖问题）。**provider 开关** `vision.provider`（默认 jev）：`siliconflow` 臂=旧 captioner 链原样保留（Qwen3-Omni @ SiliconFlow，key=182 `.env` SILICONFLOW_FALLBACK_KEY，恒传 format jpeg；配置键仅此臂消费）；对称守卫双保险（getTweetImageAsset 在 siliconflow 模式恒 null / analyzeTweetImage 在非 siliconflow 模式恒 false），analyzer 顺序调用 asset 优先 miss 才 caption 天然路由。图片本体缓存 `tweet_image_raw` dl-v2 版本键（dl-v1 行不失效互存）；jev 模式 tweet_image 结论缓存停读停写（表与历史行保留）；失败=warn+无图证据+不写缓存。**前置 Jev 预判门（C72）**：`vision.gate {enabled 默认 true, minSufficientProb 0.6}`——await vision 前 1 题 Choice 判语料是否已足够，sufficient≥阈 → 整段跳过=本票无图语义（判据=文本已把叙事陈述清楚才免图）；误判方向 fail-safe；已挂图不问门；门跳过剥 image_asset/image_analysis 防互相污染；prestage 不接门
- **提速要点（改挂载点/序须保持内容 bit 一致）**：website 内容抓取总开关 `websiteFetch.enabled` 默认 false=整段跳过（t.co 展开保留——URL 分类/pubProxy 判据吃）；中段三泳道 precheck∥账号链∥issuerCa 并发；precheck 三 DB 查询并行（0.7 创建时间刻意 raw 口径无回退，勿与另两个合并）；第二推文/双账号并发；undici 全局 keepAlive 30s；dbSave 瘦身（save `{existing}` 跳 pre-select；upsert 回读瘦列）
- **语料充分门（C79）**：`corpusGate {enabled 默认 true, minSufficientProb 0.6}`——twitter 主语料等齐后 1 题 Choice（判据=TRUST PRINCIPLE 采信推文陈述，验证真实性不是门的任务），sufficient≥阈 → 待抓段整段跳过（`results.<x>Info` 保持 null=下游零改动；`skipped='corpus_gate'` additive）。门管清单剔 twitter（判据来源）/websites（独立开关）；资格=twitterInfo 非空+有待抓平台；`Promise.race` 2s 上限；**陷阱①：资格判定与 `{...results}` 展开都必须在 `await twitterPromise` 之后**；误判 fail-safe
- **web-fetcher**：直抓失败（403/Cloudflare/超时/抽取<50 字）→ `https://r.jina.ai/<url>` 回退一次（**不得带浏览器 UA**——r.jina.ai 403 伪装 UA，用 `richer-js-narrative/1.0`）；发布时间前插正文供时效题；失败 fail-closed=null
- **推文拉取缓存**（getAccountWithFullTweets 两层）：userInfo handle 级（跨 token 复用）+ tweets **userId 级全量 key**（只存翻满窗口的完整列表）+ **CA 惰性早停**（每页地址匹配命中即停，截断列表落 `…:ca:<addr>` 专属 key 不跨 token 共享）；**刻意不走 CachedFetcher.fetchWithCache**（失败 1h 冷却会灭宣告竞态重试窗）；只缓存成功（防空 stub 毒缓存）
- **AVE/GMGN 社媒补源双链（C238/C238b）**：源优先级链 **meta/appendix → IPFS 解包 → AVE token detail → GMGN link → C77 搜索（最后手段）**，逐层必要门 `!hasTwitterLink`（判据单一真相由 gmgn-social-fetcher 导出）——twitter 已到手不烧下一层配额。AVE 层=`utils/ave-social-fetcher.mjs`（appendix JSON 的 twitter/website **完整 URL 直传不拼接**；flap 票 AVE 是独立聚合源，「AVE=元数据镜像」只对 four.meme 票成立；成功缓存 60s/null 进 1h 失败冷却；与 IPFS 同一 Promise.all 并行）；GMGN 层=**串行在 AVE 之后**（用户裁定「一定是所有的数据都失效后才走这一路」——免费版易 IP 封禁配额最省着烧；判据升级为含 IPFS+AVE 的 allUrls）；`enrichSocialByGmgn` **默认 true 全链路放开**（no_public_info 缓存行穿透重析随之全链路生效）。AVE=官方账号页（W 资格轴证据）、GMGN link=宣告推文直链——双源互补。**C238b 双臂贯通**：①`isTweetLevelUrl` 判 AVE 补到的是账号级还是推文级——`aveOnlyAccountLevel` 穿透臂使 GMGN 在「AVE 只补到账号级」时仍走（宣告推未到手），GMGN 推文级 URL ∧ 不在场 → 并入 allUrls（排 C51 superIP 臂后）；②prestage 地址核验失败（stage='address'）**不再 terminal 拦死**——回落 `shouldUseAccountCommunity=false` 走标准路径 W 评估（C117 同构；skipAddressValidation 票不回落防丢已验证据；name/data_fetch_failed 照旧 terminal）；③`utter.cash` 在 AUTO_TOKEN_PAGE_DOMAINS
- **空语料推特搜索兜底（C77+C130）**：语料全空票（classifiedUrls 各桶全空+twitterInfo null）按 **token symbol（用户看到的币名；不可用才回落 name）**+`since:<创建-7d>` 搜推特（`minTermChars:2`，2 字 CJK 可搜）作 `[TWITTER_SEARCH]` 独立段进 state header（不占四区配额；段内声明非宣告语料，关联由 Jev 判）；**★C130 用户裁定「不卡互动，只通过语料了解叙事」——去重剔转推后语料非空即旁路 `no_public_info`：pre_check_result 置 null 走 Jev**（engagement 只作 state 展示/审计绝不作门槛；保留 low 会遮蔽 Jev 结论）；零语料/失败 → ruleName 原样保留（1800s 重试域）+ additive `details.searchEvidence`，**零语料不落缓存**（TTL 会冻死重试窗内全部重析）；★**lag 隔离红线=证据只走 `raw_api_data.search_evidence`**，与 extractCorpusTs 三路径结构性无交叠；enabled 残缺 throw fail-loud；段缺失=静默关
- **PrecheckFailRetryService**（`engine/PrecheckFailRetryService.mjs`，`engine.precheckFailRetry` 配置）：两域重试——`address`（宣告竞态，窗 300s；**带语料形状门**：非账号型语料 skip 不烧 Jev 配额；重析带 `invalidateAccountCorpus:true` 重取账号数据）/`no_public_info`（语料晚到，窗 1800s，先 invalidate GMGN 成功缓存再 `enrichSocialByGmgn:true`——该域不在收窄范围）；门：token age（wss_events 最早 token_create 锚，缺锚不重试 fail-closed）+ 新 ticks 增量≥20 自节流 + 尝试<5；DB 一律 dbManager
- **叙事知识库（C165，`src/narrative/analyzer/knowledge/`）**：5 文件聚合（config/knowledge/{concepts,bluechips,manual-entries}.json 进 git + data/knowledge/{quasi-graduations,quasi-feedback}.json 不进 git），按 id 合并后读覆盖（manual 兜底、feedback 覆盖 graduations）；id 域 `b:`/`q:`/`concept:`。匹配 5 级规则（address>name_exact>name_substring LCS>corpus_contains>concept_keyword；concept 条目不参与 substring；twitter_exact 已退役——同 Dev 关联不恰当），防噪三防线=代码 denylist/条目 corpusTrigger:false/maxEntries=5 封顶。命中注入 `[KNOWLEDGE_BASE]` header 级段（标准+prestage 双路径；空命中 state bit-parity）；**蓝筹家族偏好指引（C177）**=段内命中 b: 域时尾加指引行，**改 Prompt 交给 LLM、代码侧不加分**；quasi/concept 不给；name_exact 撞名仍由 C168 mapper 首臂拦 low 代码层优先；匹配挂 `raw_api_data.knowledge_matches` 审计。**反馈回写**：分析完成后 rating∈captureRatings 或（毕业∧非low）自动沉淀客观字段（intro/rating/reason，不让 LLM 自由编写）至 quasi-feedback.json（tmp+rename 原子写，同 id upsert 留最新）。蓝筹口径=**ATH 市值>$1M**；蓝筹去重门（C168）见速查表；蓝筹叙事两级来源：`--enrich`（token_narrative/experiment_tokens/AVE）优先、`--enrich-desc`（CoinGecko 公开简介）只填占位；builder 只在 182 跑（`scripts/narrative/build-knowledge-{bluechips,quasi}.mjs`，详见 docs/knowledge-base.md）。config `knowledgeBase` 段（searchFallback 同语义：缺段静默关/残缺 throw）；知识文件 mtime 热载免重启；**JEV_QUESTIONS_VERSION 不 bump**（state-only）。**回归依赖知识文件 commit 态**——case-regression 跑前 bluechips/concepts/manual 须已 push，漂移排查先 diff 知识文件
- **已定案规则**：规则 5 高影响力+媒体直发**已废**（自填 twitterUrl 攻击面，放行走 Jev）；rule 0.52 同名蓝筹**整体废除**（同名≠蹭名，移交叙事层）；规则 0.5 duplicateNarrative+0.6(q60) **死代码整链删除**（引擎侧 strictSameNameTokenCount 独立活链路不碰）；expired_tweet **分桶**=速查表 C74/C104 行（旧分钟窗 config 键废止删除）；无锚语料（account/纯 IG）放宽评级 2/3 即可买（观察期盯盈亏）

**叙事门/豁免速查**（一句话判据；完整判据/案史/豁免链见台账对应 case；审计字段落 stage1.jev.\*）：

| 门/豁免 | 一句话判据 | case |
|---|---|---|
| cashtag 改道 W（J1.17） | 语料（含父推）$TICKER 全等 token symbol → 强制 W 数学 | C28 |
| 发布者代理（J1.18） | 域名词根=token 名+粉丝≥10万+名互斥+非版本词（代码门） | C29 |
| 角色 IP 豁免（J1.16） | 【无消费点——routine 桶 C145 退役后】角色 IP 仍按 A 类评估；作品名币不豁（历史语义） | C25/C145 |
| web3 买家视角锚（J1.23+C94） | A/B 类 strong_fit≥0.5 且 tier<B → effTier 锚 B（正门，只升不封顶）；B 类另享 dim2<18 锚 18 双锚；C/D/E 维持客观规模口径 | C38/C94 |
| 戏谑关联豁免（J1.24） | 【已废 C172 品牌劫持轴整轴退役】判据归 bsc_meme_user_name_event_acceptance（acceptable 过线=戏谑关联正名、unacceptable 落 ≤10 截断拦真蹭名）；预检表+brand_mismatch 桶+punExempt 整链删 | C40/C143/C172 |
| event_category 主体归属 | crypto 语境项目主体性陈述归 **W 不归 C**（C230；项目陈述推主体=项目本身，「找角度」只适用借势与该项目无关的外部事件）；站内金融化玩法（站内虚拟币/积分/模拟炒股，活动资产不上链）+成熟平台日常运营/营销/扩张表态归 **D**（C239/C241）；既有项目/平台的里程碑/庆典/上市类动作归 **D** 走事件轴+量级门不进 W（C245）；**借势发币≠发布项目**——币名取自外部热点且语料陈述不出功能实体 → 主体=被借势热点（E/梗/热点人物、A/形象角色）不归 W（C246）；W 桶两排除：Web3 语境≠Web3 项目（无项目实体不选 W）、圈外 AI/科技产品无 crypto 组件→B（C249） | C230/C239/C241/C245/C246/C249 |
| W 类数学（C142/C154） | **单轴：项目对 BSC 用户吸引力(0-75)，pass 32**；时效仅对 older/unknown/override **封顶 30**（TIMING_SCORES_W 正向表已删）；币安交互臂 C134 退役；发布者影响力资格轴两形态（C234）：形态一（BSC 链项目）项目 Dev 非完全匿名即可过线（新项目传播/第三方讨论不作资格判据 C236）、形态二（Web2/Web3 涌现项目）项目主体须较为知名（C232 陈述/发币账号无名不卡）——两形态对齐=卡的都是项目方，陈述/发币账号一律不卡；被提及资产形状臂（C249）：语料只是 $TICKER 提及已存在对象 → 评被提及对象知名度，与项目 Dev 资质解耦 | C142/C154/C134/C230/C232/C233/C234/C236/C249 |
| IG 影响力两层（C44） | IG 真数据进 state 评分（无锚）；有链接没抓到数据：A 类+dim2<18 → 锚 18 | C44 |
| notable_other 退出（J1.26） | 拦截位 C108 整体退役（责任移交名字门）；题保留只喂评分/豁免链 | C54/C108 |
| 产品实体+接纳门（J1.27） | `event_subject_entity` 已删（C141 判据并入 event_fit unfit 桶）；门一般化 **web3FitMassBlock 通用硬门：strong_fit+fit 合计<0.5 → 拦，全域**（挂 web3UnfitBlock 后 veto 链前）；豁免 pubProxy/isW/binanceCorpus/平台官方号（PLATFORM_OFFICIAL_HANDLES={binance,flapdotsh}），刻意不豁 imgNameExempt | C56/C141 |
| 指代 meme 低档门（J1.28） | 【已废 C108，拦截位退役并档名字门】「用户不接纳」子集由词句题 `bsc_meme_user_phrase_acceptability` 承载；题保留喂五腿 | C60/C108 |
| 形象载体门（J1.29） | 【已废 C171 整轴退役——形象考量并入 acceptance 题面锚句（加分项非否决项）】随门整链退役：三死题（visuality/event_influence/image_carrier_nature）+六豁免臂+审计十键；避亏功能由 web3FitMassBlock/量级门/实体门接棒；**image_depicts_name 演绎题保留改挂 J1.30 关联豁免第二臂** | C61-C171 |
| superIP 指代豁免（J1.21） | 【已废 C83】意图由名字门（J1.42）覆盖 | C33 |
| 图载体豁免（C59） | 图证据+0&lt;关联≤10+name_entity_memeability≥3 → 豁免 Stage3 关联截断（分照常计入） | C59 |
| 名图一致豁免（J1.30） | 图证据+name_image_consistency（条件题）合并≥0.5+0&lt;关联≤10 → 豁免关联截断+量级门两拦截位（D/E 档臂+事件分不足臂）；答案缺失 fail-closed | C65/C86 |
| 找角度时效门（C68） | angle_seeking/interpretive_reply 载体推 lag>6h → mapper 时效归 0（mapper-only；precheck 锚回退 tokenCreatedAtSec） | C68 |
| 推文时效分桶（C74+C104+C120） | 非豁免桶（angle/interpretive/unknown）lag≥300s 拦；direct_tweet（粉≥5000 或 赞≥500 或 转≥100）豁免交 Jev 软评——**主从结构门：主推 lag>24h 须 website_tweet/quoted/retweeted 任一 ≤24h 新载体才豁免**，无载体裸旧推回落 300s 拦；C120：interpretive 作者粉≥5000 且主推 lag≤24h → 跳过硬拦（粉丝缺失 fail-保守）；主推 created_at 缺失 fail-open | C74/C104/C120 |
| 叙事源头陈旧门（C75） | direct_tweet **主推**（仅主推）距 token 创建锚 >30d → mapper 时效归 0；angle/interpretive/unknown 不触达；锚缺失 fail-open | C75 |
| 图文名不符拼写门（C78） | 币名 CJK≥3 字（`isCjkLongName` 代码前提）∧图在场 → 条件题 `image_name_text_match` 三桶：**one_char_diff**（图内与币名等长恰一位差的独立文字段，**次数不构成豁免**）≥0.5 → Stage3 截断；exact_match（含子串）/unrelated_or_none 不拦；答案缺失 fail-open（C243 图片直连起判据源=看图条件题，纯代码门已退役防复活） | C78/C108/C243 |
| E 类感染力折损（J1.36） | 判据源=bsc_meme_user_event_fit：`(strong_fit+fit) < 0.5` → 仅 category=E `tierScore+effSpread ×0.5`（时效不折）；≥0.5 原公式；缺失 fail-open 不折 | C93 |
| F→E 改道（J1.37）+ 名字门（J1.42，C184 类型轴） | **改道**：event_finding_vs_recap==news_recap ∧ F → 强制改道 E（换考官非放行，E 既有门全部接管）。**名字门**：①实体轴 `bsc_meme_user_name_entity_acceptance` 四桶——accepted（类型可接纳实体；**新旧不是维度**（new_entity 删桶 C184）；性质定义具象角色即 accepted（J1.105）；故事主体（C174）/有意义变形（C151）/概念实体（C247 映射看所指不看词形）均 accepted）/unacceptable_type（圈外商业品牌/金融机构/动物品种学名/严肃机构/事务性公司→无论多著名，≥0.5 **全域拦（C184b）**+pubProxy 豁免；旧 unknown 键断代不归一读）/wrong_entity（指歪/指残：拼写错/不忠实呈现/版本残片——≥0.5 全域拦含 A/E；有独立背景故事/文化来源的有意义变形不选）/not_entity（泛称词无专名搭配+无命名故事陈述才落（C190 专名即实体：名字被用作特定主体称谓即映射按类型轴评）→ 词句门接管）②词句轴 `bsc_meme_user_phrase_acceptability` 只评 not_entity 票（entityChoice 为实体桶全跳过、缺失照评；**C189 恢复拦截**：全域无豁免；题面锚=陈述句名落本题、事件承载臂须民族级/全球级重大事件、ip_reuse 原生热点锚=热点主体自身代币化不选复用）③门链序 ne（类型门）→em（脱节门）→we（wrong）→ua（词句门）；形象轴（C139）已随 C171 退役 | C96-C190 |
| 币安地域子账号量级锚 | 主推作者 handle `binance` 前缀 ∧ 非五全球号白名单（主号/Labs/Research/Square/binancezh——币安中文视同核心号）∧ binanceCorpus 借壳语料在场 → effTier 锚 **D**（锚降优先于锚升两臂；量级门 D/E 档臂五腿不豁=唯一新增拦截位）；只查主推；缺失 fail-open | C97 |
| 借壳语料陈旧门（C250） | 账号级借壳+全语料陈旧=首发抢注形状，代码侧硬时间锚，**两腿全真才拦**：①无推文级语料（`hasTweetLevelCorpus`：主推+载体槽位+in_reply_to 全空，账号主页≠宣告）②全部语料源（载体槽位/父推/square publishedAt/website publishedTime/**账号注册时间**——纯裸账号形状唯一时间源；**账号推文时间刻意不入源**）距创建锚 >30d（max 源语义=最新语料也要超窗——新鲜宣告推/新文任一在场即照放；新注册账号裸账号照放）；时间源全缺失/锚缺失 fail-open；mapper-only 不 bump 题集版本；prestage 不接；veto 链挂蓝筹去重首臂后 | C250 |
| 借壳语料父推源头窗 | binanceCorpus 票主推 `in_reply_to.created_at` 父推 lag>24h → timing 归 older；**不限 tweet_type**；载体推刻意不进判定（新载体不构成源头新鲜证据）；缺失 fail-open | C102 |
| 载体↔父推关系源头窗（J1.39） | parent_relationship 条件题四选——new_angle_on_original（载体借原生推有新解读=豁免，父推可老）/translation_or_repost/explains_derivative/unclear；翻译/二手臂 ∧ 任一槽位父推 lag>24h → timing 归 older（取最老父推）；仅 hasReplyParent 才问（无父推不问防幻觉）；**J1.137/C240 豁免**：发行方自发宣告票（issuerTimingExempt）翻译**同主体链**父推（isSameSourceParent）不拦，翻译**别人**的老内容照拦 | C103/C240 |
| negative_hard_news 门退役（J1.101/C170） | 【已废 C170 整门退役】题集删桶+BLOCK_SCOPE 空域+概率门+audit 键全退役；负面事件玩味空间改由 event_fit 口径层判（unfit≥0.5 负门 + C141 sf+fit<0.5 硬门接棒）；第一层质量概率门至此全部退役 | C170/C9/C98 |
| 中国政治主题否决（J1.122/C192） | `bsc_meme_user_event_fit` 第 5 桶 `china_politics`（**独立否决项**，不参与四档比较）：中国党政机构/官方宣传平台与符号/领导人/国内政治事件/政治口号 → 不适合构建 meme 币；**不看玩味空间**；港澳台同标；非中国政治按四档评估 → mapper `chinaPoliticsBlock` 按 argmax **确定性拦、无豁免链**、旧缓存行无该桶 fail-open；门链挂 `web3UnfitBlock` 前。**C192b**：官媒/党政机构的非政治内容不选本项按事件评估；**C248**：外部人物辱华 ∧ 代币=反对辱华反击立场（骂/嘲讽辱华者）→ 反击性 meme 不选本项按四档评（划界=**玩梗对象是谁**——币名/形象直接把中国政治人物/符号当笑点照拦） | C192/C192b/C248 |
| 超IP原话票 + 实体门（J1.56） | **作者原话票**：作者在册 ∧ 币名逐字主推文本 → `authorUtterance` 补位 C88 五腿第一腿+著名免形象资格第三源，问候语在实体题如实 not_entity 不升档；**unacceptable_type ≥0.5 全域拦**（C184/C184b 类型轴：不评认知度）；性质定义优先于认知度（J1.105「首款AI警犬」式具象角色定义即 accepted，不以知名为前提）；陈述句反锚（J1.106「XX上电视」式说事句不构成性质定义）；new_entity 桶已删（C133 股城/C174 TREE/C151 变形均归 accepted）；概念实体锚（C247：语料定义的概念/行业术语按概念自身类型评，圈内概念/行业热词=accepted；映射判定看所指不看词形） | C126/C133/C139/C247 |
| 空洞内容门（C114/C159）+ 通用梗缩写名字锚（J1.47） | **图证豁免**：block_reason argmax=empty_content ∧ context.imageEvidence（=twitterInfo.image_analysis 存在）→ 不拦（图就是内容）；**C114b 收窄**：image_depicts_name 明确 decorative（≥0.5）→ 豁免失效照拦（缺失/未问/unclear fail-open 照豁免）；无图票照拦。**无名口号臂（J1.110/C181）**：无名作者单条口号/喊话/宣言/许愿（说事/喊话/表态非具名玩梗，**点名知名对象也算**；无外部热点/情节/第三方）→ 拦（veto 键=bsc_meme_user_event_impact；三排除锚=作者层级/梗主体/成型叙事；纯缩写/符号/表情组合不适用）；**事件层优先（J1.111）**：两层缺陷同命中 empty_content 优先，token_ip_reuse 只管 meme IP/形象/梗换皮复用。**名字锚（题面）**：通用网络梗/文化缩写（DND/FOMO/LFG）合格、机构职位/品牌内部缩写不合格——分界=用户侧感知 | C114/C159/C181 |
| 实体-事件影响力脱节（J1.124/C194） | `entity_event_mismatch` 拦截桶：实体量级极大（全国级/世界级超级 IP）∧ 事件影响力极小（单个博主局部行为/单一平台小热点/无多方参与）→ 选本项；mapper 概率 ≥0.5 **全域拦**+pubProxy 豁免；门链 ne→em→we；旧行无该桶 fail-open | C194 |
| 事件意义太小门→已废 C244 | 【已拆出退役为独立观察题】原 C231 impact 删桶+`BLOCK_SCOPE.event_trivial=[]` 显式空域（旧缓存行 argmax 重放零拦截）；判据整体迁独立观察题 `bsc_meme_user_think_event_too_trivial_for_meme`（不进 blockAnswers=零门零评分；四维度框架=主体圈内地位/主体量级×动作性质/生态归属切身相关/玩梗参与空间，横切锚=评事件不评陈述者；审计恒落 trivialProbe\*）；恢复拦截须用户裁定 | C231/C244 |
| Web2 旁观热点情感冲击门槛（J1.123/C193） | event_fit 判据臂：Web2 圈外平台**旁观式热点**（博主做了个东西/才艺/造景/打卡），无情感冲击（不引发共情/愤慨/纪念，也无可玩空间）→ 哪怕高赞+知名 IP 形象+持续发酵，至多 marginal；边界=C161 全球级可参与产品不适用、C160 公益/纪念情感路径不适用 | C193 |
| Web3 用户切身相关事件锚（J1.136+J1.137/C240） | 事件主体是 Web3/crypto 用户群体自己的集体行动或切身事务（散户维权/抗议/联合行动/群体身份权益叙事）→ 受众完全重叠**至少 fit**（群体身份图腾可 strong_fit）；地域限定词**不改主体归属**；与 BSC 生态平台直接关联=圈内直连正向；宣言推=运动起点非终点（主体新进展证据在场按发酵判档）；impact 反锚=切身相关事件意义不小不选 trivial；mapper `issuerTimingExempt`：issuerSelfLaunch 检出 C75 全量豁免、C103 收紧同主体链父推、C102 刻意不豁免（防洗白）；边界：纯圈外抗议/平台运营活动/个人苦难猎奇不适用 | C240 |
| 强情感冲击/动物救助路径（J1.96/C160） | 真实正向、广泛传播的公益/纪念故事（尤其流浪猫狗救助）→ 至少 fit，强共鸣可 strong_fit；情感币/纪念币不要求玩梗/二创；载体豁免臂已随 C171 退役（题面判据保留）；消费弱势真人苦难/猎奇/虚假悲情仍 unfit | C160 |
| 巨大影响力事件载体豁免（J1.97/C161） | 【已废 C171——题+豁免臂随载体门整轴退役（唯一消费点=载体豁免）】strong_fit 高分直接放行，豁免需求消失 | C161 |
| 蓝筹去重门（C168） | 新票 name_exact 撞蓝筹库条目（b: 域 ATH>$1M）→ mapper 门链**首臂**拦 low（mapper-only 不 bump 题集版本；Jev 照跑留档案；prestage 不接；quasi 小蓝筹刻意不拦；蓝筹本体 selfAddress 自排除）。豁免三臂：**C173 新陈述**（direct_tweet+作者在册双条件）；**C242 新事件**（撞名主体新独立事实事件——条件题 bluechip_event_identity new_event≥0.5 ∧ noneProb≥0.5 ∧ FRESH_TIMING 三腿；同事件姐妹复制品/形象复刻判 same_event 照拦；缺题 fail-保守照拦）；条目级 dedupExempt（口号泛名/同部署者连发名 manual 标记） | C168/C173/C242 |
| fit 事件本体分量锚（J1.105/C175+J1.106/C175b） | 事件源自公共热点/新闻/圈内人物表态等**币外分量**时宣告者无名不减分量（无名账号报道已传播的热点仍是热点）；事件本体只是无名作者**一句口号/一次玩梗**（无外部热点依托、无第三方讨论）→ 不是事件至多 marginal；**空口号 vs 成型叙事边界（C175b）**：marginal 臂只限无事可讲的空口号，成型叙事（持续行为记录/有情节故事/被命名主体来历）事件本体已成立正常评估契合；互动数字不作加减分依据（C130 不推翻），本锚判事件有无币外来源非数字大小 | C94/C101/C106/C96/C175/C175b |

### Live 交易

- four.meme=`FourMemeDirectTrader`（TokenManager2），flap=`FlapPortalTrader`（Portal swapExactInput）；双平台 live=单引擎双 trader 同一钱包（live 参数恒读 fourmemeWs.live）；gang=`GangBawTrader`（已停，留档见双平台段）；**买入不区分计价盘**（用户裁定——可行性由 estimateGas 天然保证：多跳路径不通 estimate 失败即买入失败，不发垃圾 tx；卖出 quote 池死风险自担）；卖出 token→0x0 全盘支持
- live 实验只能 `node main.js start-experiment -e <id>` 启动（run-engine 对 live 显式拒绝）
- 实收解析**余额差法**（买入 balanceOf 前后差=税后真相；卖出 BNB 差+gasUsed×gasPrice 补偿）——对税币/非 BNB quote 盘免疫
- **flap minOut 锚取较低者**：`minOutAnchor = min(信号价期望 expectedTokenOut, quote)`——平稳/暴跌盘锚 quote 行为不变，暴涨盘锚信号价期望（防 quote staticCall 滞后块状态虚高卡死 revert）；L1 预成交校验不动；Decimal 域取整
- **卖出 approve 大额一次授权**：两 trader `approve(spender, ethers.MaxUint256)`，条件结构保留 `currentAllowance < amountOutWei` 才发——首卖一笔此后恒充足跳过
- **live 记账精度钳制**：`_liveRecordTrade` 卖出方向差值 ≤相对 1e-9 → 钳到账面持有量重试，**全 Decimal 比较**（double 吞掉 1e-11 差异致钳制静默失效）；真超卖照常失败
- **全清腿记账精确清零 + 粉尘残仓清理门（T75）**：live 全清腿（sellPct>=1）PM 记账量=账面 Decimal 原值（`ledgerQty`——Number 往返吃 ulp 留 1e-11 幽灵仓=永动 revert 熔断循环）；粉尘门 `dustCloseValueBnb`（默认 1e-4 BNB，显式 0 关门）：预期卖出所得（qty×信号价/bnbUsd）< 线 → 不发链上卖单，`_closeDustPosition` 就地清账删仓+落清仓 trade 行（重放钳 0 防复活）+告警；锚缺失 fail-open 照发；externalDisposal（链上=0）语义先于粉尘门
- **买入失败可观测性**：`_executeBuyLive` 失败分支单次必打 warn + `tradeResult.reason` 落库；trader 日志 `setLogger(logger, experimentId)` 进实验日志；`Logger._consoleEchoDisabledFor` 同文件禁复读（stdout 重定向到日志文件时防双写）
- 防御层（参数在 default.json `fourmemeWs.live`/`flapWs.live`）：L1 `assertMinOut`（报价/预期 ratio<0.5 拒单；expected 契约必传缺即 throw；卖出无锚 fail-closed 拒裸奔）/ L3 卖出熔断（连败≥5 → 30min 冷却+Telegram）/ **买入熔断**（连败≥3 `buyCircuitBreakerFailures` 拉黑至进程重启+告警；只计发单后链上失败——前置拒绝/资金不足不计；「2 败 1 成」翻正清零；手工买不走检查）/ L5 `_awaitReceipt`（超时回查一次，**绝不自动重发防双买**；reverted throw。**WSS 快速回执默认开** `txReceiptViaWss !== false`：引擎 `_txSeenSignal` + collector `_onTickEmitted` → trader `Promise.race([WSS 路径, waitForTransaction])`——自家 WSS 见到成交 tick 即轮询拿真 receipt；拿不到（approve/PCS 卖出/revert 无事件/WSS 永未见）=让位原路径 **bit 一致绝不冒充**）/ `maxPositionTokens`（0=不限只拦新开仓）/ 毕业告警人工处置
- 钱包复用：web 创建 live 实验「复用历史钱包」下拉（`GET /api/live-wallets`，私钥永不回传；两端 ENCRYPTION_KEY 一致）
- runbook `docs/live-acceptance-runbook.md`；**真实资金验收未做**（0.001 BNB 闭环待用户执行）；flap 毕业/非 BNB 盘卖出 revert 属预期 fail-closed

### Web / 数据库 / 配置

- Web：`src/web/` + `src/web-server.js`（3010）；K 线/现价走 wss_price_ticks（tick-kline-service）；AVE 工具端点（/api/ave-\*）保留；叙事 UI /narrative-analyzer、/narrative-tasks；TPA /experiment/:id/position-analysis；signals 页因子 chip 条件驱动；**API 现状页 /api-status**（`api-status-service.js`：apidance 剩余次数 + SiliconFlow 余额实查 + TypeSafe/AVE/智谱/ai.6551.io 探活；60s 内存缓存 `?refresh=1` 强刷；key 与生产同源）
- **RLS 坑**：SUPABASE_ANON_KEY 对 wss_price_ticks/wss_events/strategy_library 被 RLS **静默过滤成空**——远程脚本/routes 一律 `dbManager.getClient()`（service key）
- 删实验=DB 级联（每张实验归属表 experiment_id → experiments ON DELETE CASCADE，web 层只删行）
- 关键表：experiments / strategy_signals / trades / experiment_tokens / token_monitoring_pool / `wss_price_ticks`（UNIQUE(tx_hash,log_index) 首写者持有行；sender_address=tx.from；quote_token 标记 flap 非 BNB 计价盘）/ `wss_events`（token_create/graduation/token_quote_set 低频事件通道，token 级全局不挂实验）/ strategy_library / token_profiles / wallet_offline_profiles（address PK 全局）/ token_position_analyses、narrative_analysis_rounds（CASCADE 挂 experiments）/ token_narrative（叙事侧 NarrativeRepository 管）/ experiment_time_series_data（**停写 2026-10-15**，历史数据保留）
- 链支持 BSC-only：其它链历史实验可读（未知 chain id 原样落穿），交易/配置查询非 BSC throw
- 配置：`config/default.json`（fourmemeWs/flapWs 段：contracts/reconnect/tickBuffer/debounce/live 执行参数+策略默认）/ `config/narrative-engine.json`（jev+engine 段，JSON 单一真相源）/ `config/.env`（ANKR_WS_URL / AVE_API_KEY / SUPABASE_URL / SUPABASE_ANON_KEY / ENCRYPTION_KEY / SILICONFLOW_FALLBACK_KEY 等）
- AVE API token 格式 `{address}-{chain}`（如 0x123…abc-bsc）；AVE 只用于 holder/预检工具与分析端点，不用于发现或价格

## 红线汇总

1. **绝不删有数据的实验行**——删=级联删 wss_price_ticks 历史行（按 experiment_id 竞速归属），全局永久丢；误跑/污染实验只停进程+置 stopped 留行，是否删除必须由用户裁定
2. **引擎绝不调 `collector.setExperimentId`**（exp_id=NULL 防线，单测锁定）
3. **远程脚本/routes 查 wss_price_ticks/wss_events/strategy_library 一律 dbManager service key**（anon RLS 静默空）
4. **DDL 先于进程重启**（新列/新表在引用它的代码上线前存在）
5. **回测查询 platform 单值 `.eq` 循环勿 `.in` 多值**；token 地址批 `.in` ≤100；Supabase `.in()` URL 超 8KB（批 50 上限）
6. **FA 周期判定/回测路径禁 Date.now**（now 由 buildFactorMap(state, asOf) 传入，防前视）；`_graduatedTokens` 禁装载即填
7. **narrative 是 ESM（.mjs），交易引擎是 CJS（.js）**——勿混 import
8. BSC-only；live 只能 main.js start-experiment 启动；双平台 live 的 nonce 唯一性靠共享 NonceManager（shareSignerFrom），新 trader 接入必须走它不得自建
9. **本地不跑重查询/重实验**（直连 Supabase 全表聚合/全史扫描本地 VPN 必超时）——去远程服务器跑；本地只做单条/小结果读取
10. 历史窗口回测先失效叙事缓存（invalidate-\*-window.cjs）；校准重跑逐字复用线上 state
11. BacktestTickCache 探针/装载保持锚定无序形状（ORDER BY id 形状 planner 超时）；maxTickRows 默认 100 万，大窗口显式放宽
12. collector stop 顺序 eventWriter → senderResolver → collectors，不可换
13. 新机制一律配零 DB 零网络单测；事故修复配「事故现场反证」断言（源码口径断言锁定防线）

## 操作指南

### 新增买腿因子（C84 起一律先进 FA）

1. 因子计算加进 `FourMemeFactorAggregator`（累计态挂 token state 或模块级 Map，周期判定禁 Date.now——now 由 `buildFactorMap(state, asOf)` 传入）；2. `_buildFactorMap` 发射键（无数据=有证据零值非 null，缺证据=null——fail-closed 方向想清楚）；3. `getFactorKeys()` 探针自动收键（未知因子三防线自动认得，勿手维护清单）；4. FactorBuilder 时序快照白名单两处透传（不落库即丢）；5. 配零 DB 零网络单测（公式精确值+口径反证）。legacy preBuy 注入五步仅旧腿维护用，**勿再新增**。

### 修改 Jev 题集

1. 改题面；2. bump 版本常量；3. 聚合语义变了同步对应 mapper；4. 跑定向重析对拍验证评级一致且无买线翻转；5. **case 与裁定同步台账**（卷三倒序追加）并**收录回归票**（`npm run case-regression -- --add <addr> --case C<n>`，预期变化票 `--update-expect --because` 留痕，工作流见 docs/case-regression-tool.md）；6. 部署前跑 `npm run case-regression` 全量对拍
