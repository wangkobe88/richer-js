# CLAUDE.md

Richer-js：BSC four.meme + flap + gang meme 币自动交易引擎（BSC-only）。代币发现与价格 = **实验进程内嵌 ANKR WSS collector 直连**（订阅 four.meme TokenManager + flap Portal + gang LaunchpadV2，全事件驱动无轮询）：引擎直接消费 collector 内存回调，DB 落库（`wss_price_ticks`/`wss_events`）仅作持久化（回测/web/离线分析数据源）。支持虚拟（模拟盘）、回测（tick 回放）、live 实盘（gang 仅采集+虚拟+回测）；内含叙事分析引擎（Jev 结构化决策模型）。

**本文只留现行机制、铁律与操作入口**；决策过程、case 复盘、验证数据、事故数字、版本演进、各臂现行阈值/版本号一律不写入（完整判据/案史/豁免链/版本演进全在台账，策略条件串以 strategy_library 最新版为准；压缩前版本在 git 历史）：
- 叙事 case 全档案：`docs/叙事引擎改进与Case台账.md`（卷四 C181 起；卷三/卷二/卷一=同目录归档卷）；**每个新 case/改进须同步追加台账**
- 交易机制案档案：`docs/交易策略改进与Case台账.md`（T 编号；详档 auto-memory）；**每个新交易侧 case/改进须同步追加台账**
- 作弊盘检测案档案：`docs/作弊盘检测与Case台账.md`（CD 编号；题集版本演进表；详档 auto-memory）；**每个作弊盘 case/题集改动须同步追加台账**
- 买入点位分析案档案：`docs/买入点位分析与Case台账.md`（BP 编号；详档 auto-memory）；**每个买点 case/题集改动须同步追加台账**
- **当前最优买卖策略快照**：`docs/当前最优买卖策略.md`（现行最优买/卖腿 condition 全文+机制配置+证据链，版本以 strategy_library 最新版为准；**每次策略演进同步维护**）
- **聪明钱涌入信号专题台账**：`docs/聪明钱涌入信号专题台账.md`（SI 编号；famous/聪明钱连续涌入备选策略专题，与现行 ladder 体系刻意隔离）
- **金狗 Case 集合台账**：`docs/金狗Case集合台账.md`（JG 编号；金狗集合 a8414632 的用户观点/数据验证/处理留档——集合=用户筛选高涨幅基准资产、发现系统性误拦用；触发机制改动的 case 同步对应主台账，**集合内新 case 同步追加**）
- 历史实现：git 历史

## 常用命令

```bash
npm start                                  # 实验管理 CLI（交互式 start/stop）
npm run dev
npm run web                                # Web 界面（端口 3010）
node src/run-engine.js <experiment_id>     # 单实验直跑（virtual；live 显式拒绝）
node scripts/clone-experiment.cjs --src <expId> --name <新名> [--desc ..] [--dry] [--pack <策略包名|uuid>] [--mode live|virtual] [--executor <id>|--reuse-wallet <expId>]
                                           # 正式克隆工具：整包 config 复制+策略包引用转换——旧形状基底（内嵌腿）必须 --pack（取库最新版，产物 config.strategyId=包 id）；新形状基底缺省沿用其包、显式 --pack=换包（对拍工作流）；T202 归包键一律剥离留痕；--mode live 转换链保留；--no-gates 已废弃传即报错；只建行不启动
npm run narrative-engine                   # 叙事分析 worker
npm run case-regression [-- --only C98,C104 | --list | --add <addr> --case C112 --note .. | --update-expect C97 --because ..]
                                           # 叙事 case 回归集（重析对拍在 182 跑，工具文档 docs/case-regression-tool.md）
node scripts/cheat-detection/run.mjs [--only CD1 | --list | --add <addr> --case CD2 --note .. | --update-expect CD2 --because ..]
                                           # 作弊盘回归集（as-of 锚截窗重析在 182 跑；anchor 必填防全史马后炮）
node scripts/buy-point/build-set.mjs --name <set> [--source trades|signals] [--live-exp-count 3 | --exps <id,...>] [--dedupe-sec N] [--horizon-min 15] [--legs-lib <名|none>]
                                           # 买入点位测试集构建（182 跑）。trades 源=最近 live 实验成交买点+ladder 腿 FA 重放挖掘（per token×leg 首触发，--legs-lib 缺省 signal-source-ladder-v1）；signals 源=旧口径 BUY 信号 60s 去重
node scripts/buy-point/run.mjs --set <set> [--only BP-S001 | --limit N | --dry]
                                           # 买入点位重析（182 跑真调 Jev；--dry 只组装；`sets/*-ticks/` 不进 git）
node scripts/deploy-trading-strategy.cjs [--commit]
                                           # 交易策略包部署（T202 唯一部署通道：条目=完整策略包 trading-standard-v1；本地 dry-run/182 --commit；validatePack 预检；同名 upsert 键序无关比较 SKIP/version+1；旧 deploy-signal-source-strategies.cjs 已退役）
node scripts/backtest-token-case.cjs --src <基底expId> --token <addr> [--pack trading-standard-v1] [--commit]
                                           # 单 token case 门链回测工具（182 跑；--pack 整包换（腿不可内联，混搭对拍=先建混搭包）+tokenAddresses 单票限定；防呆=基底须 signalGateReal+strategyId+包 modules 带 cheatCheck/buyPointCheck；run=setsid 后台+终态防呆（重跑终态实验=BUY 信号行翻倍污染，拒绝）；report=信号×门×盈亏对照 [--token] [--baseline <基底>]）
node scripts/sync-case-collection.cjs --collection <名|uuid> [--token <addr>] | --list
                                           # Case 集合同步 CLI（182 跑；web 端按钮只适合本地小票，真实同步走本脚本；退出码 2=部分票失败）
npm run narrative-sample-build -- --exps <id,...> --name <set> --top 60 --bottom 60 --random 60 --seed N
npm run narrative-sample -- --set <set>    # 叙事抽样测试集构建/重析（涨幅分层，182 跑）
node scripts/scan-unknown-factor-conditions.cjs   # 存量条件未知因子扫描（退出码 1=有命中）
NODE_OPTIONS=--max-old-space-size=12288 node scripts/build-wallet-profiles.cjs --threshold 3 --days 14
                                           # TPA 离线画像（只在 182 跑；须在 build-token-profiles 之后）
node scripts/build-gmgn-wallet-profiles.cjs --days 14 --limit 5000 --commit
                                           # GMGN 钱包画像库回填（gmgn_wallet_profiles 30d 快照，182 跑；--rank-by tokens|trades|bnb；增量跳过；429 退避）
node scripts/gmgn-token-forensics.cjs --token <addr> [--anchor <ISO> --window <sec>] [--fetch-miss]
                                           # 任意票参与者画像复盘（零配额全查库；--fetch-miss 补拉 miss top20 显式烧配额）
```

## 单测

无测试框架/CI。单测文件=`scripts/_test_<名>.cjs`，**零 DB 零网络**（打桩 dbManager/provider/fetch），直接跑、断言失败退出非零；**改到哪块跑哪块**（名字自述；每键口径/事故现场反证断言在文件内，案史与版本演进见四台账与 auto-memory）：

- **采集/直连**：embedded_collector_architecture、run_engine_graceful_stop、experiment_instance_lock、sender_resolver（router-events 纯函数+三 collector 订阅锁+WSS 单笔通道+源码锁）、fa_deferred_wallet_feeding、watcher_quote_conversion、flap_session_created_backfill_bypass、recent_ticks_scan、early_replay_index、tick_buffer_watermark、wss_event_writer_retry、gang 六件（gang_collector_decode、gang_graduation_progress、gang_architecture、gang_corpus_enrich、gang_baw_trader、gang_live_wiring）
- **回测**：backtest_tick_cache、backtest_chain_order、backtest_narrative_gate、backtest_perf_probe、backtest_write_buffer_async、backtest_load_pool、backtest_preload_overlap、backtest_platform_parallel、fa_prefilter、backtest_fa_prune、backtest_tick_build_skip、backtest_trigger_leg、backtest_keyset_paging（⚠锚定无序重构后存量失败待裁定，新形状由 tick_cache 覆盖）、backtest_window_token_universe（双通道 token 宇宙）、backtest_case_channel（Case 集合通道+表源 select 先行形状锁）、case_collections_service（集合服务全链：复制执行器/串行链/租约）、case_routes
- **引擎机制**：card_position_mechanisms、holdings_replay_precision、stop_loss_rules、stall_close（流动性止损+足额门+两档域+burst 承接冷盘夹具）、sell_leg_scan_fallback、prebuy_peak_backfill、graduation_sell_and_anchor、sell_debounce_mechanisms、tick_debouncer（T208 买评估去抖到期即结算：fireTs=真实到期时刻非推进时刻），factor_sell_filter（T157 因子卖出过滤门全形状）、sec_since_peak、mcap_arc_exit、since_entry_factors、token_pool_buytime、token_age_sec、activity_window_factors、fourmeme_fa_factors、activity_window_multi（T218 多粒度冷窗四键：actTotalBnb15s/30s/60s/300s——窗口边界/乱序/裁剪保留/探针收键）、bundle_cluster_factors、even_cluster_factors、circ_denominator_cap、top2_holder_circ、top_holder_supply、holders_ex_dust、fa_wallet_denomination、market_regime、live_prefilter_parity、permanent_block_cache、k_group_no_materialize、wallet_net_single_pass、signal_metadata_cache、token_pool_eviction、timeseries_removal、holder_series_rebuild、price_series_rebuild、fa_narrative_factors、fa_early_trades_factors、netbuy_window_factors、launch_bundle_factors（开盘簇/首两波口袋门等价性锁）、golden_pit_factors（T213 黄金坑三键：athVsLaunchPct/bigBuyers 两键——0.2B 买家队列增量维护+乱序收敛）、retail_path_gate_policy（T213b 好散户币通路门链策略：filterArmsByClass 决策核〔T217 含 exempt 臂差集〕+gatePolicy 退役断言）、point_type_router（T216 点位类型辨别与对应策略：类型阶梯首匹配/normal 兜底/启动防线/引擎未启用 null 语义；T217 cheatCheck 规则集 g23/g23NoSlowGrind）、narrative_trigger_condition、account_health_monitor、account_recheck_engine、gmgn_entry_check、fa_issuer_account_state、observation_signals、observation_config、signal_gate_engine（T117 门链）、fp_retry_gate（T203 FP 拒后门内重试：tracker 状态机+0xb6ee 锚相位反证+两引擎 resume 源码锁）、stall_restart（T210 停滞再启动通路：六腿纯函数边界/null 语义+真实成交夹具键保真+因子门让位/AF1 restart_exempt 分流）、signal_source_factors（FA 五触发键）
- **pre-buy/钱包**：sniper_factor（+sniper_cache_probe）、top1_buy_share、sender_switch_and_router、corpus_lag_factor、same_name_snapshot、gmgn_check_layer、gmgn_attention_ratio、gmgn_wallet_stats_service、gmgn_wallet_stats_layer、prebuy_known_factor_short_circuit、prebuy_creator_dev_cache、prebuy_overlap、copy_wallet_roster_factors、copy_roster_orphan_rescue、sybil_cluster_factor、sybil_build_clusters、wallet_profile_builder、wallet_scorer、tpa、tpa_live_ticks_trim、token_classifier、cheat_detection_lib（题集 10 题为 buildCheatQuestions() 函数产物非顶层常量）、cheat_detection_service、cheat_grade、cheat_gate_engine、cheat_market_reset（BP 侧口径锁）、cheat_mem_pull_ticks、buy_point_lib、buy_point_check_service、participant_profile
- **策略/条件/stats**：strategy_pack（T202 包校验/_resolveStrategyPack）、clone_experiment、strategy_library_validate_legs、unknown_factor_reject、experiment_stats_fifo、replay_observation_factors（回放本体 182 跑）、buy_phase_routing
- **web/数据服务**：trades_filter_columns、api_status_service
- **live**：live_hardening、tx_seen_receipt、live_decimals_guard、live_executor_loading、executors_routes、manual_trade_queue、graduated_pcs_routing、fourmeme_actual_received、nonce_manager、gas_dynamic、live_nonbnb_buy_allowed、buy_circuit_breaker、live_dual_platform、approve_max_grant、live_record_trade_clamp、live_dust_close、flap_minout_signal_anchor、live_buy_failure_observability、logger_console_same_file
- **叙事链路**：precheck_fail_retry、narrative_signal_gate、narrative_memcache、narrative_preload、case_regression_lib、tweet_pull_optimization、narrative_timing_probe、narrative_parallel_fetch、ipfs_race、narrative_prefetch、same_name_appendix_shortcut、narrative_leader_incremental、rule5_pass_through、data_fetch_failed_rating、issuer_selflaunch_account_route、issuer_ca_detection、narrator_two_shapes、unrated_elimination、isproject_coin_url_not_ca_hit、prestage_web3ip_account_only、prestage_project_downgrade、daily_parse_summary、news_monitor、narrative_middle_parallel、narrative_vision_prefetch、vision_gate、website_fetch_removal、precheck_parallel_queries、twitter_urls_expansion、twitter_bucket_overlap、http_keepalive、justoneapi_timeouts、narrative_repo_save_thin、narrative_save_sanitize、token_info_narrative_fallback、jev_client_backoff、narrative_account_ttl、account_corpus_invalidation、narrative_retry_config、angle_timing_override、precheck_tweet_freshness_bucket、search_fallback、corpus_gate、corpus_ready_prefetch、gmgn_social_fetcher、ave_social_fetcher、narrative_rounds_route、narrative_review_fixes、parent_tweet_metrics、isproject_coin_aggregator_urls、jev_question_consolidation、superip_no_prestage_route、knowledge_base、bluechip_dedup_gate、tweet_image_analysis
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
  - `WssEventWriter`（共享单实例）持续写 wss_events：per-row 独立重试队列，**create 行丢=token 永久不可见，绝不丢事件**
  - `SenderResolver`（共享单实例，`config.senderResolve` 默认开）解析 `sender_address`=tx.from。解析链（快→慢）：EOA kind 快路（零 RPC）→ 路由事件映射（`router-events.js`：三 collector 订阅聚合路由事件，双键 (address,topic0) 查表+地址形状门，聚合路由行零 RPC 定值）→ txFrom 缓存 → **ANKR WSS 同连接单笔 `eth_getTransactionByHash`（主路径，per-tx in-flight join；连续 5 错熔断 10min）** → 块预取 join（dataseed 回退，**裸调 `eth_getBlockByNumber`——ethers `getBlock(n,true)` 抽象路径恒返回 hash 数组致 join 静默失效**，形状校验放 `_rpcCall` 内 throw 触发 failover）→ 单行 getTransaction fallback → 重试耗尽 NULL 保行不丢（绝不冒充）；映射复查三点接住竞态 miss（WSS 未定值后/块路径后/重试前）。三 collector `_rpcRequest` 通用通道；per-token 观测 `waitTokenIdle(token, deadlineMs)`/`pendingFor`（`_enqSeq/_doneSeq` watermark——等待期新入队不打断）供 cheat 门事件驱动 settle。堆栈细节见台账 CD376-CD378
  - **FA 两阶段喂食**（resolver 开启时）：submit 前 `_feedFa(…, {deferWallet:true})` 先喂**价格段**（WSS 到达即喂——fire 价/lastTickAt 不被 RPC 回查延迟与乱序污染），pushRow 回推时 `_feedWallet` → `FA.applyWalletTick` 补 **wallet 段**（holders/K 组/GMGN routedBuy/smartBot 用真 sender 精确计数）。EOA 快路两段同 tick=零时序差；合约行乱序回推，wallet 聚合任意序重放收敛；无 resolver 直推路径单段零变化（回测同）
  - **chainLate 迟到旧价拦截**：`_lastChainBlock/_lastChainLogIdx` 复合水位判迟到（含同位重复行）→ 跳过 outlier 判定/价格追踪/可靠价链，流量/滑窗照计；链证据缺失 fail-open；`lastTickAt` 取 Math.max 不回拨
  - **holderTrend 双路径**：非 defer `​_pushHolderSeriesPoint` 覆盖快照；defer 路径事件环形缓冲（≤64），消费点 `_rebuildHolderSeries` 逆向撤销再按 block 稳定排序正放（唯一序无关解）
- **gang collector**（`gang-ankr-ws-collector.js`，机制层与 flap collector 复制关系）：订阅双 pad（V2 + V3——**V2 收缩期仍创建，Created 的 V2 分支必须保留**）；Buy/Sell/Graduated/VQL 两 pad 共享白名单，**仅 Created 各自签名**（V3 Created 实测常量 `0x416fe98c…`——签名串反推未中勿改回 ethers.id）；tick 全净额口径（FA 净入金系数恒 1.0，无 flap 0.98/1.0204）；quote 终态固定（Created topics[3] 定终身）→ 启动重建读 wss_events token_create 行（48h 窗）；未知 token trade 暂存队列（≤2000，fail-loud，绝不以 quote 价冒充 BNB 价）；indexed topic 地址必须 `topicAddr` 剥 padding；**V3 Graduated 形状未实证**（decodeFailed fail-loud=观察点）；CLI/BAW 形状档案 `docs/gang-cli-shapes.md`
- **TokenPool 监控票淘汰**（默认关 `tokenPoolEvictMinAgeMs` null=关）：仅删 monitoring 超时条目，过滤 protected set；sold 票 20min 后可再买
- **时序快照机制已停**：`experiment_time_series_data` 不再写；signals/trades 页走势图改 `wss_price_ticks` 重建（`/api/tokens/holder-series`、`/api/tokens/price-series`，口径与 FA 对拍锁定）
  - TPA live 三件套 + `_onTickBuffered` 钩子 → 运行期零 DB ticks 查询；缺口只计数不回退 DB
  - 60s 断流自愈（静默≥5min forceReconnect）+ 15min wss_down 告警（判据 `collector.getLastMessageAt()`）
  - logs 订阅带 topic0 白名单（TOPIC0_MAP）；unknownTopic0 计数归零=新事件类型发现盲化
- **stop 顺序：eventWriter → senderResolver → collectors（★尾两步顺序错误=丢行）**
- 采集覆盖口径（用户裁定）：现役 both 实跑实验即事实采集器；无实验运行期接受采集空洞；实验进程崩溃=采集断流，接受风险不加 watchdog；flap quote 缺口由下次 flap collector 启动 getLogs 增量回放自动补齐

### 直连口径

1. `wss_price_ticks` 新行 `experiment_id=NULL`（免疫删实验级联）；引擎**绝不调 `collector.setExperimentId`**（单测锁定）
2. tvl 因子恒 0（对齐 DB 行/回测口径）
3. price_outlier INSERT 携带最终 flag（多实验并发 first-writer-wins）
4. 实验级 collector 配置覆盖：实验 config 的 `fourmemeWs/flapWs` 段 per-platform 浅合并
5. wss-down-guard 判据 `collector.getLastMessageAt()`
6. flap QuoteSet 映射持久化：非 BNB 计价盘 token→quote 实时落 wss_events（kind='token_quote_set'）；collector 启动 `_loadQuoteMapFromDb` 重建终态+回放窗补停机缺口；DB 空首启走 `flapWs.quoteRate.fullBackfillMinutes`。汇率三级源（PCS V2 reserves（WBNB 侧储备 < `quoteRate.v2MinWbnbReserve` 默认 0.01 BNB 挂价不可信降级 V3）→ PCS V3 最深池 slot0 → V3 quote/USDT ÷ bnbUsd）；零流动性 V3 池挂价不可信必须拦；三级全 miss 跳行宁跳不冒充；BNB 盘 quote_token=NULL。**盲期暂存白名单（T87）**：加载期 trade/graduation 全暂存——白名单票（本进程 Created ∪ 实时 QuoteSet 已 apply）即时处理，历史票维持暂存

### BacktestEngine

- **token 宇宙三通道**：①源实验=`backtest.sourceExperimentId` → 源实验 experiment_tokens（创建页复制链经 hidden input 保真透传）；②时间窗=无源 id 且 `startTime`+`endTime` 均在（缺一 fail-fast 拒启）→ 窗口内 `wss_events` kind='token_create' 派生 token 集——**count exact + 无序 limit 一次拉全并对账，count>1000 不可用 id-cursor keyset，改窗口时间中点二分递归；禁 ORDER BY（同表 8.2s timeout 实证）**；七键逐键对齐旧通道（`core/token-create-meta.js` 共享纯函数映射防漂移）；③Case 集合=`backtest.caseCollectionId`（与源 id 互斥 fail-fast）→ 读 `case_collection_tokens.token_meta` 冻结快照；ticks 改读 `case_ticks`（`_tickSourceQuery` 表源辅助，**supabase-js filter 只在 .select() 之后——from().eq() 非法链**）；scopeKey=`case-<id>` 缓存隔离；含未 synced 成员拒启（`allowPartialCaseSync:true` 显式豁免）+空集合拒启。展示侧读重定向点均为条件取值；`tokenAddresses` 单票裁剪在三通道汇合点统一生效
- **token 集合 + platform 口径**（不按 experiment_id）：地址 100/批 `.in` + platform **单值 `.eq` 循环**（`.in` 多值 planner 弃索引超时）；分块拉取后全局**链上真序 `(block_number, log_index)` 归并排序**（`sort(id)`=前视）
- **ticks 装载缓存** `core/BacktestTickCache.js`：粒度 `(scopeKey, platform)` 一文件（窗口通道 scopeKey=`buildWindowCacheScopeKey` 单一出口防同窗分裂）；**缓存存全量、运行期过滤**（与直拉 bit-identical）。**探针与装载都必须锚定无序形状**（`id > 锚` + 无序 limit；装载闭区间 `.lte(id, headAnchor)` 封死中途新写入）；`maxTickRows` 默认 100 万，多天大窗口须实验级显式放宽；P15 delta 侧车（STALE 增量明文文件，tmp+rename 原子重写，行数不符=drop 重拉）
- **graduation 回放 + 止损双腿**（虚拟↔回测一致性）：`_loadGraduationEvents` → 主循环消费指针 + 收尾 drain + 买入成功点补卖。**`_graduatedTokens` 标记在消费点填充，禁止装载即填**（前视防线）。止损 tick 路径优先于策略腿 + 节流扫描兜底断流票
- **`backtest.stripSenderAddress` 对照臂**：剥内存 tick 的 sender → 消费侧 COALESCE 回退 trader（=修正前 bit-identical）
- **`backtest.tickBuildSkip` 默认开**：出窗票跳过 build；显式 `false` 恢复旧行为
- 回测不嵌 OPB；`_alignClassifiedAsOf=true`（TPA 防前视）；叙事直调同链路（时漏已知，只比相对增量）

### Case 集合管理（多层面问题 Case 资产统一维护）

四表（`scripts/sql/create-case-collections.sql`，全局资产不挂 experiment FK）：`case_collections`（name UNIQUE）/ `case_collection_tokens`（UNIQUE(collection_id,token_address)；token_meta 冻结快照；sync_state+双源水位）/ `case_ticks`（复合 PK，UNIQUE(collection_id,tx_hash,log_index) 幂等；复合 FK CASCADE）/ `case_events`（token_create/graduation/token_quote_set 镜像）。Service `src/web/services/CaseCollectionService.js`：添加代币（查 token_create 取最早行，零行 400 宁拒不漏）→ 自动后台复制（**进程内 `_chain` 全局串行链——同集合并发复制会使 IDENTITY 分配序≠提交序=回测 headAnchor 封闭后永久漏行，绝不并发**；单 token 等值 keyset 500/批+upsert ignoreDuplicates+每批回写水位；单次护栏 20 万行可续传；租约 10min+重启 sweep）；页面 `/case-collections`；创建页回测三来源（radio）。**红线**：DDL 先于部署；复制重查询只在 182 web 进程跑（真实同步走 `scripts/sync-case-collection.cjs`）；回测未 synced 拒启双保险。

### 双平台实验（platform='both'）与 gang 单平台

- **gang 平台已停止（T86/T86b 用户裁定）**：全自动所有子空间否证。代码/collector/GangBawTrader/单测全部留档不删（要点：BAW 地址 address-only 第三形态仅 gang 放行；卖恒须 App 确认；防双买/双卖状态机；毕业票不路由 PCS）。官方 `setAgentGate` 关门即翻案复用
- 归一化唯一入口 `resolvePlatforms(platform)`（`core/platforms.js`）：'both'→fourmeme+flap，'gang'→['gang']，其余→fourmeme。**'both' 语义恒 fourmeme+flap 刻意不含 gang**（创建页 checkbox 互斥双防线+服务端校验）
- 单引擎 per-token 分派：`_handleNewToken(info, platform)` 按 collector 回调平台分派 record builder，共用买卖策略与单一资金池
- virtual+backtest+live 全支持（live=per-platform trader map——fourmeme→FourMemeDirectTrader / flap→FlapPortalTrader 同一钱包，非首 trader `shareSignerFrom` 共享 wallet+NonceManager=同地址单一 nonce 源；`_liveTraderFor(tokenAddress)` 未知平台 throw fail-closed）
- gang 毕业进度=资金口径阈值链 `graduationThresholdBnb ?? 15`；引擎级配置恒读 fourmemeWs 段（`_wsConfigSectionName()`，子类覆盖）；实验级 ws 配置键 flap/gang 实验经 `_mergedWsConfig` 同键生效（gmgnCheck/narrativePrefetch/narrativeRetry/faPreFilter 等）；创建页平台选择=多选 checkbox（gang 互斥）

### 钱包口径地图（sender/trader——改任何聚合前先查）

`trader_address` = 事件 msg.sender（公共路由=**GMGN BSC 聚合路由**）；`sender_address` = 真实发起 EOA（tx.from）；NULL = 未解析回退 trader。

- **wallet = `sender_address || trader_address` 已切**：EarlyParticipant 90s 窗全部因子、FA holders 族（holderCount/P 组集中度/bigHolder 交叉/K 组对敲/cumBuy/滑窗/smartBot 名单）
- **TPA + 离线画像库：wallet 口径**（GMGN 用户刻意不剔 retention）
- **刻意不切**：`uniqueTraders`（classifier 契约锁定防漂移）；routerPct 因子判 **trader 层**（`AGGREGATOR_ROUTER_ADDRS` 9 址聚合路由全集，`pre-check/aggregator-routers.js`）
- GMGN 行为 map：FA `processTick` 写 `_walletRoutedBuyBnb`（GMGN 行归 sender EOA，只记买腿）→ TPA gmgnFilter 消费
- OPB 全史路径/离线 build-token-profiles 不动（trader 口径链）

### Pre-Buy 检查（`src/trading-engine/pre-check/`）

`PreBuyCheckService.performAllChecks()` → EarlyParticipantCheckService（首 90s 窗，查 `wss_price_ticks`）+ TokenHolderService（AVE holder 黑名单）。**因子恒算无开关**，落 signal metadata `preBuyCheckFactors`；只在买策略定义 `preBuyCheckCondition`/`repeatBuyCheckCondition` 时生效（老克隆实验无此字段=裸买）。**legacy 专属（C84 后新模型腿不走此层——新因子一律先进 FA）**。

- **已知因子合取项短路（P4a+P4b）**：条件顶层 AND 项内全部因子「检查前已知」且当次恒假 → 整条条件必 false。live 默认关；回测默认开。防线：项内混未知因子一律不评；knownCtx 与生产 context 逐键对拍防漂移
- 因子注入链 legacy 五步：**勿再新增**
- **earlyTrades\* FA 宿主已删（T71）**：FA 出生锚 90s 冻结窗 10 键整族退役。存续=legacy preBuy 宿主（DB trailing 90s 窗）与 launch\* 独立窗。条件引用已删键=三防线拒启 → 存量实验须换车（copy-in 快照）

| 因子族 | 现状 | legacy preBuy 口径（旧腿） |
|---|---|---|
| earlyTrades{PerWallet,MaxWalletTrades}/NetBuyRatio/UniformBuyCluster\* | FA 键已删（T71）；净买观察改 `tradesNetBuyRatioLongWin` 长窗 | （无此键） |
| earlyTradesTop1BuySharePct（+Top1BuyBnb/BuyBnb） | FA 键已删 | 同名键 trailing 窗+covered |
| earlyTradesRouterPct | FA 键已删；门换 `tradesRouterPct` | 同名键+covered |
| earlyTradesSniperHoldingPct（+SniperWallets/SniperHolders） | （无此键） | sniper 正持仓 Σ/池 Σ×100 |
| narrativeCorpusLagSec | FA 出生锚−语料最新推文时间 | **纯观察键**；时效硬拦在叙事 precheck 分桶 |
| strictSameNameTokenCount | 回测=as-of 快照优先（实时 append 写 `ave_same_name_snapshots`，6h 节流；回测取 `searched_at<=asOf` 最近快照，miss 才兜底实时且行级过滤未来行） | `>= 3` 拦 |

**covered 语义**（top1/router/sniper 同构）：age>90s 或 launchAt 缺失 → 0 值放行（null 会让 `<N` 恒 false 误拦）

**T70 实时载体**：`tradesRouterPct`=Σ(trader∈聚合路由的买)÷Σ买×100，写点=processTick 计数段——**全史累计无窗无冻结**。**净买窗三键（T77+T87+T88）**：`tradesNetBuyRatioLongWin`=最近 `netBuyWinLongTrades`（默认 100）笔主趋势、`tradesNetBuyRatioShortWin`=最近 `netBuyWinTrades`（默认 20）笔即时流、`tradesNetBuyShortWinBnb`=观察键。**买腿净买门（两臂 AND）**：`(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)`。**null 语义**：环空=null fail-closed（门恒 false）；尾窗全卖=-100 有证据零值。旧键名条件串配新 FA=三防线拒启。

### 买腿链路（C84）与 GMGN 条件（`gmgnCheckCondition`）

买腿多模型并存，**按腿激活**：腿携带 `signalGate` → T117 信号源门链；腿携带 `narrativeTriggerCondition` → C84 新模型；否则 legacy（触发 fire `condition`+`narrativeCallCondition` 直调 → preBuy 预检查 → GMGN）。

- **T117 信号源门链（纯盘面）**：`signalGate` 腿（仅买腿；归一化 `{maxTriggers 缺省 1, cheatRecheck 缺省 false, recheckCondition 缺省 null, bpPassLevels 缺省 ['good','neutral'], fpRetry 缺省 0}`——**fpRetry（T203）=FP 门拒后门内重评次数上限，归策略包腿定义**：拒后 pending 挂起，后续 tick ≥200ms 间隔（=买腿 debounce 节奏；**T203c：原 2s 间隔被 bt-v178 0xb6ee 案源本尊饿死——拒后 +0.8s/+1.9s 三笔 tick 即断流 30s 零重评，间隔越大越接不住快波**）以当前时刻为锚重评 FP（30s 地平线过期）；过=同一信号续跑 actFront→cheat→BP→执行〔不另落行/不耗新触发/不走 T110〕，不过=耗一次预算耗尽终态；**T203d 重评资格门控（2026-11-22 用户裁定「每一个条件的重试，也是要满足因子表达式条件的基础上进行的」）：重评前以当刻 factors 复评腿触发条件（`_fpRetryLegConditionPasses`，AST 纯读），翻假/评估异常=跳过本次重评——不烧预算、pending 保留到 30s 地平线（案源 bt-v179 GWC 0xb712：重评锚落拉升波首 tick curVs 31.4% 已出腿门 28.5 线，重评两头死路——FP 拒白烧预算/FP 过被 BP 统一位置门拦还白烧 cheat/BP Jev；刻意不做「翻假即终态」=保 T203c 0xb6ee 证据发育期价格上移形状的救回面）；skips 落 metadata.fpRetry.skipped**；attempts 落 metadata.fpRetry；回测虚拟时钟同款）condition=**触发条件**，fire 且 signal 落库成功后依次走：**因子购买前检查门（FP 族，`_factorGateEvaluate` → `BuyPointCheckService.evaluateFactorPreBuy` → `factor-pre-buy-check.js` 纯函数：retail_pvp 判定树+CD 四臂升格+dump/burst/死盘/残局/机器持筹等 30+ 臂——现行臂清单与判据以代码与交易台账为准；灰度 `fourmemeWs.buyPointCheck.factorCheck.enabled` 缺省 false=fail-open；insufficient_ticks 放行）** → **前置活跃度门（AF1，`_actFrontGateEvaluate` → Jev 3 题（题面引用 buildCheatQuestions 同一构建产物）分流：act=low/ultra∧sbw≠burst 拒（**T205 阶段前提：灰度 `cheatCheck.gate.actStageColdExempt` ∧ 锚前 ATH<80 未火过 → low 改走 mid_full 照走全链**） / low/ultra∧sbw=burst 豁免直进 BP / high∧wash=strong 拒 / high 其余跳过 cheat / mid 照走 cheat 全链；检测层故障 fail-open）** → **作弊门（`_cheatGateEvaluateBinary`：cheat 拉黑+清仓硬拒 / unhealthy 拒（recheckCondition 表达式真=真调重判，非 cheat=翻案解除拉黑）/ healthy 过；检测层故障 fail-open 放行进 BP）** → **BP 门（`_bpGateEvaluate` fail-closed：assessed→bucket∈bpPassLevels 过、poor/timeout/fail/disabled/insufficient_ticks 全拒——BP10「数据不够就挡住」；minTicks 预门在 service 不烧 Jev 配额；pumpExempt 透传位置门）**——两门都过才买；无叙事/GMGN/preBuy 层。**触发即消耗**：per (token, legId) 计数（进程态），门拒/超时不返还；耗尽腿评估期排除次腿顶上（阶梯接棒）。signal metadata 落 `signalGate/factorCheck/cheatCheck/buyPoint` 四段。**T132 触发腿 per-tick 评估绕 debounce**（触发腿 tick 时刻因子直评，`_signalGatePerTickExcludedIds` 返回 **Set**；回测 C 类票现补全量 build）。**回测受控解禁（T121）**：实验 `backtest.signalGateReal:true` 时真调门链（cheat 16 题+BP 题集 Jev；服务 `opts.anchorMs` 截窗防前视 + `persist:false` 硬编码注入零写全局表），缺省 false=全量排除 signalGate 腿。FA 五触发键：`recentBlockDropPct`/`mcapFromPeakPct`/`quietSpanMs`/`quietSurgeBuyBnb`/`quietSurgeSec`（阈值 factorParams `quietThresholdMs` 缺省 60000）。**现行版本/门串全文以 strategy_library 最新版（trading-standard-v1，ladder v34 十四腿：t0 6 笔最早臂起十四档，含 NL/RL 重启臂族、开盘簇门/首两波口袋/破发豁免臂、全腿 `actTotalBnb >= 0.1`+`tokenAgeSec >= 15` 抢速门等）与 `docs/当前最优买卖策略.md` 为准；v1~v33 演进史见交易台账**。卡牌形状：买腿缺省无 `cards`=每笔 1 卡；回测口径=买腿 `cards:4` + `perCardBNB:0.05`。引用实验须 `buySignalMaxPerToken >= 15` + `cheatCheck.enabled` + `buyPointCheck.enabled`。与七个旧门字段互斥 fail-fast
- **T210 停滞再启动通路（`src/market-analysis/stall-restart.js`，金狗 中文房间 0x76b0…7777/铁匠 0x39ed…7777 案）**：定位=「给一个好票模式一条通路，不求召回」。形状六腿全事前可算——最后 ≥30s 静默段的出口行是非尘买单 ∧ 孤笔 ∧ 信号锚在其上（≤2s）∧ 沉寂 ≥60s ∧ 沉寂前独立钱包 ≥12 ∧ 仍持仓者 ≥6 且占前期像样买家 ≥55% ∧ 锚前最高价较发行价 <80% ∧ 出口行之前总成交 <5B（原料=cheat 快照 `stallRestart*` 九键，**不进 state/题面/FA 投影=Jev 输入零变化**）。命中时：**因子门低活跃五臂+burst 弱波臂让位（FP44）**、**AF1 `act=low → restart_exempt` 与 burst 同等跳过作弊门直进 BP**（cheat/unhealthy 一并豁免，用户知情）；**散户 PVP（像样买方缺席）与其它臂照常**——因子门拒因链「低活跃优先」会盖住 `pvp_no_big_participation`，低活跃让位后它自动露出（四窗 19 张零右尾须保持拦）；未命中票行为 bit 不变；无灰度键（包无需重部署）。结构性根因=信号在静默后首笔 tick 上触发，AF1 的 as-of 锚就是这笔→CD422「出口行孤笔」→sbw=none→拒，首笔评估不可能是 burst。改线值须同步台账；详档交易台账 T210+金狗台账 JG-37。
- **新模型（C84）**：`叙事发起条件（FA 因子表达式）→ 后台多轮叙事分析 → 单一买条件（condition，含 narrativeRating == 2 OR == 3）→ GMGN 条件 → 执行`。全部因子在 fire 时刻同一 FA 因子表上评估，virtual/live/backtest 三态同源
- GMGN 条件（两模型共用）：前序条件全过、确定要买时才构建=**此刻才真调 GMGN getTokenInfo**（配额最小化+数据新鲜）
- `GmgnRiskCheckService`（`pre-check/GmgnRiskCheckService.js`）：5s 超时 / per-token 5s 成功 TTL + inflight join / 失败 10s 冷却；**只认自己 fetch 的结果**（防 TTL 污染）；配置 `fourmemeWs.gmgnCheck`
- **fail-open 放行**（用户裁定）：API 失败/超时/未索引/key 缺失/冷却 → covered=0 → 放行——GMGN 是附加风控层，API 不可用不得拦住买点。**条件表达式评估异常（键集外/语法）仍 fail-closed 拒**
- 因子五键 `gmgnBundlerWalletRatio/gmgnIssuerTokenCount/gmgnRiskCovered/gmgnVisitingCount/narrativeCategory`（前四键 `mapGmgnRiskFactors` 单点映射；风险提取 `src/core/gmgn-api/risk-fields.js` 与叙事侧共用；visitingCount 观测键不参与 hasAny；narrativeCategory 从 fire 因子表透传）
- 注意力空转观测四键（T76，纯观察）：`gmgnBuyWallets`/`gmgnBuyVolumeBnb`+`gmgnVisitorsPerBuyer`/`gmgnVisitorsPerBuyBnb`——`computeGmgnAttentionFactors` 静态纯函数单一真相源
- **叙事类型 × issuer 分档门（C85+T73）**：适用集 `{project, account_based_meme, web3_native_ip_early}` 内 `gmgnIssuerTokenCount <= 1`（serial issuer 拦截）；**null IS NULL 臂放行 fail-open**；条件串必须带 `narrativeCategory IS NULL OR` 前置臂
- 回测挂点**不真调 API**：消费直调快照 `narrativeCallInfo.gmgnRisk` → 同款 `evaluateFactors`（快照缺失同 fail-open）
- **GMGN 钱包画像层（C89，默认关 `fourmemeWs.gmgnWalletStats.enabled`）**：引擎接线已随 T71 删除；纯函数层保留。**表已建库（T193）**：`gmgn_wallet_profiles` 30d 快照，离线脚本回填；**BP 门挂观察段**：`fourmemeWs.buyPointCheck.participantProfile.enabled` 缺省 false——开=BP 门锚窗 top10 买家查表聚合 `participantProfile` 段（PP1 三标签）落 digest+signal metadata，**观察键不进门**；回测 persist=false 不跑=时序穿越防线
- 库 buy-v2 门：bundler 组已整组退役（T108）；bundler 形状由 cheatCheck 分级门接棒

### 作弊盘检测（CD1，默认关 `fourmemeWs.cheatCheck.enabled`——缺段即关=门跳过放行；flap 经 `_mergedWsConfig` 同键）

Jev 驱动**买信号驱动同步式盘面检测门（GMGN 式，作弊模块=最后一层买条件）**：**买腿携带 `cheatCheckCondition`（FA 因子表达式，cheat 键域）才走门**（无字段=零作弊交互；挂点=preBuy 过后 GMGN 之前；仅买腿可配）。

- **门评估**：service `gateBuyPoint` await 竞速（`gate.awaitMs` 默认 15s；超时 fail-open 放行本笔+late 链续跑补拉黑/清仓）→ grade 三态：**cheat**（拉黑+清仓联动+signal failed，唯一硬拒；拉黑短路盖入口+链内复检两处秒回）→ 拉黑终态不再判；**unhealthy**（每买信号自动重判、永不拉黑）；**healthy**（同题集版本秒回零 Jev）。grade 真值出来后 FA 投影 `buildFactorMap` 重算因子表 → 腿表达式 ConditionEvaluator 直调（**评估异常 fail-closed 拒**；buildFactorMap null → fail-open 放行）
- **CD379 活跃度豁免（`gate.activityExemptLevels` 缺省 ['high']——ultra 档豁免已退役 CD409）**：grade=unhealthy ∧ activityLevel∈豁免集 → healthy+`exempt` 落 metadata（四出口全覆盖）；cheat 档豁免资格=high 档（ultra 不豁免，CD391）；**CD383/CD397 burst 资格臂**：sbw==1（levels.stallBurstWave）单条件，对 cheat ∧ unhealthy 两档生效；**CD380 不豁免臂（denied=原判保持）现行五臂**：wash_pair（同块对敲 strong）/dump_no_absorption（CD400）/dump_low_absorption（CD403）/burst_exit_sell_pressure（CD401，限 sbw=1）/burst_bundled_wave（CD405）——均为纯代码数值门，锚进 levelsFromObservation 白名单不进 FA 投影/state/题面；出口 `_applyActivityExempt` denied 优先 → 资格臂 → 豁免，四点统一（出口/拉黑登记/bootstrap/sticky 重判同构）；cheat 豁免票不粘滞每信号重判
- **CD389 `gate.alwaysRecheck`（缺省 false）**：flag 开 → 粘滞全部失效，每买信号恒真调 Jev 重判（重检非 cheat=翻案解除拉黑）；回测/研究工具开关
- **判定粘滞**：cheat=拉黑终态；healthy=同题集版本秒回；unhealthy=自动重判。配额由 T110 买信号节流封顶。引擎信号链前段另有拉黑双源短路（引擎 Set ∪ service.isGateBlocked）
- **D3.5 判定层停产——只识别现象与强度，不产「作弊/不健康/健康」结论**（判断一律 Jev、代码只组数据；as-of 时点语义，`cheat_detection` 多行留观测轨迹）
- **模块=`src/market-analysis/`**（盘面分析域，与叙事平级；Service+snapshot/state-builder/mapper+grade+题集 `llm/cheat-questions.mjs` 独立版本常量）。链路：settle（引擎恒注入 `waitIdle`=resolver per-token watermark 清空即出窗 `Promise.race` 帽 `settleDelayMs` 默认 4s）→ 拉数**双源**（`memSource.enabled` 默认 false：开→三 collector per-token 行环优先零 DB，`auditShadow` 对拍；关/miss→DB 单 tail 查询）→ cheat-snapshot 纯函数（top1/top2 剔聚合路由伪钱包）→ state → JevClient（10 题；**现行题集版本/判据全档=作弊台账版本演进表**）→ mapper 容缺读档+未知桶 throw → `buildObservation` 观测记录落表：**verdict='observed'（⚠DDL 红线：表 CHECK 域须先加 'observed' 再启用）**、gate 模式另落 grade 四键。**snapshot 现行锚族**（计算口径/演进=台账 D3.x 版本演进表）：簇/等额/脉冲/pump/断流重启段/尾窗七键/贴锚砸块承接六键/burst 波族（段定位 BURST_STALL_GAP_SEC=30；CD422 波=断流出口行起 5s 固定窗孤笔不成波；CD424 判定行集剔尘埃 0.03；CD402/CD423 量级参考线 0.29 BNB 净额+≥2 钱包资格线）/burst 流量簇三键/burst 捆绑收割两键/routerEntryBuyPct/creator 三域匹配/活跃度数值族等——**刻意不进 FA 投影的锚只落 digest+state 供 Jev 直采**。`minTicks 7` 以下不调 Jev。**bootstrap 门状态跨进程恢复**（`.eq(question_version)` 版本域）。**回测=非 signalGateReal 实验零接线**（FA cheat 键恒 null）。回归集 `scripts/cheat-detection/run.mjs`（anchor 必填，182 跑）
- **分级门（cheat-grade.js，`gate.enabled` 显式 true 才启用——现行规则 G23/题集 D3.81；版本常量 `CHEAT_GRADE_RULES_VERSION`/`CHEAT_QUESTIONS_VERSION`——改规则必须 bump+同步台账+跑黄金集）**：`gradeObservation` 纯函数=「档位→交易动作」策略映射（判断仍一律 Jev）。现行通道：**cheat**=A 主判任一 strong；降级豁免=唯一 pump strong∧sbw=burst∧mod<3；**unhealthy**=E（act=low ∧ sbw≠burst 单条件——**T205/G23 阶段腿：灰度 `cheatCheck.gate.actStageColdExempt` ∧ 锚前 ATH<80 未火过（cheat snapshot 键 `athVsLaunchPct` 地板锚，与 FP act 臂/AF1 同原则贯通 `act-stage.js` 共享线）→ E 不产 unhealthy**）∨ L（insider∈{moderate,strong} ∧ noBuySellPct≥25）∨ M（activity_level=ultra）∨ N（`AGGREGATOR_ROUTER_ADDRS` 锚窗买入**笔数**占比 <10% 严格小于=无散户入场通道；买 <15 笔 null fail-open）；其余 **healthy**。已退役通道（D famous/G8 弱 burst/J holdings/R abnormal/spike 题/cr bundled/sbp/holdings_balance 题）历史行留档。**FA 投影 56 键可进条件串**：`cheatGrade`（healthy=0/unhealthy=1/cheat=2）/`cheatUnhealthyGrades` 计数/`cheatBlocked` 0/1 + 题档位键（`CHEAT_LEVEL_SCORES` 映射，未知档位→null）+ 数值锚 37 键——**全键清单以 FA `getFactorKeys()` 探针与 `_test_cheat_gate_engine` D 段为真相源**；**⚠回测恒 null**——未判定放行须显式 `cheatGrade IS NULL OR` 前置臂。cheat 拉黑+**持仓立即清仓联动**（`_cheatExitPosition`）。42 票黄金集锁定（改规则破坏须重新裁定）。单测三件 `_test_cheat_gate_engine`/`_test_cheat_detection_service` Z 段/`_test_cheat_grade`

### 买入点位分析（BP1 模块）

- **定位（与 CD 分工）**：输入同样是 ticks 锚截窗，CD 判「盘面是否作弊」，本模块判「**当前点位是否适合买入**」；协同形状只作降档参考。引擎融合=T117 门链 BP 门（`BuyPointCheckService`+`buy_point_analyses` 表+`_bpGateEvaluate` 全 fail-closed）；代码无规则映射层/grade
- **判定形态（BP67/题集 BP67 起=纯门链五道）**：⓪塞单门（`exactEqualBlockMaxWallets >= 8` 代码门 stuffing_gate，门链最前，锚缺席容缺不拦——「不搞代码门」唯一例外=用户明裁机械形状）→ 盘型门 → 点位门（entry_shape 五桶）→ 活跃度门 → 筹码门，全过=neutral（good 档不再产出；两质量题已退役 BP48）：
  - **①盘型门**：market_pattern 现行四桶=retail_pvp 散户 PVP/famous_monopoly famous 独食/one_wave_dump 一波拉高出货（`PATTERN_GATE_POOR_BUCKETS=['retail_pvp','famous_monopoly','one_wave_dump']` 硬拒）/none 其余一切盘面（强庄/融合/重启等正常形状不细分 BP58/BP60 收口）；⑥sustained_climb 桶已退役归 none 统一门。判据=开盘段结构行+[WALLETS] 前列行+筹码结构行+活跃度行+卖压行+[PRICE] 行六源并读；材料不足按⑤融合桶不硬归类；门题缺席容缺
  - **②点位门（entry_shape）**：`ENTRY_GATE_POOR_BUCKETS=['crash','malicious_dump']`——crash=数值四臂命中进形态复核（急跌只看买点本地窗急缓与累计幅度无关 BP66；急跌进行时轴 chg5≈chg10 同深无铺垫 BP59；判序四步制：先判反弹两件套→买入力在场豁免（尾 10s 买 ≥3 笔∧≥0.1 BNB 照放）→臂 A 本地买方缺席/臂 B 暴跌余波才坐实；打断家族唯一放行出口=反弹两件套不享买力豁免）；malicious_dump=Jev 四腿判读（卖额 ≥0.5 BNB∧块内跌幅 ≥10%∧卖方 ≥4 剔路由∧砸后承接比 <0.5；贴锚 <10s 改「砸后已见买入」判承接 BP82；总成交额 `totalVolumeBnb` ≥20 BNB 豁免 BP78——贴锚形状不吃豁免；**BP88 时间隔断：砸块末行距锚 ≥120s 的旧一轮砸盘不进 dump 候选（snapshot 侧剪除 `BP_DUMP_MAX_SEC_TO_ANCHOR`，限窗递补、相邻对以对末块判距、tEnd 缺失容缺——沉寂隔断后的买点不受上一轮砸盘压判，题面/state/mapper 零改动）**）；spike 判型保留落档不拦（BP68）；normal_dip=目标形状
  - **③活跃度门**：activity_level∈{low,ultra} → poor（low=买点前全窗量级，判读倾向临近买点段，⑦=临近买点段定档主锚四臂判序：协同出货/衰减/密集/死寂只压不抬+三反锚；**第五档 burst=cheat 门输入桶不拦**——cheat sbw 经 ctx.cheatBurst 透传，行缺席按七要素照常判）；门题答案缺席 null 不拦
  - **④筹码门（现行停用 `CHIP_GATE_ENABLED=false` BP54）**：holder_concentration=strong 单臂（CD240 分层线直译+一人控盘例外）；**BP15 价格豁免锚**：currentVsLaunchPct ≤ +10% 贴发行价时持有不均衡不坐实 strong；恢复=true 一键还原
  - **⑤统一位置门**：none+LEGACY 全部走 `NORMAL_ENTRY_LAUNCH_PCT=28.5`（curVs≤+28.5% 放行含破发、已拉离拒、**锚缺失宁拦不冒充一律拒**）；⑥桶位置门 `SUSTAINED_CLIMB_LAUNCH_PCT=10` 已随桶退役；pump 豁免票同走统一位置门（BP55 专属门退役）
- **6 维度题现行**（题序=`['market_pattern','entry_shape','price_trend','activity_level','holder_concentration','price_level']`；tree/追高/famous_domination/entry_position/market_heat/sell_pressure 已退役）：price_trend 六桶（动量窗 5/10/30s）｜activity_level 五档（见③）｜holder_concentration 四桶（strong 进④）｜price_level 六桶（参照系=发行价：almost_launch ≤+10 含破发/near_launch +10~40/low +40~80/mid +80~600/high/very_high）｜market_pattern 四桶（见①）｜维度题容缺机制天然忽略旧存档答案。**容错双轨**：门桶 strict（缺答案/未知桶 throw）；维度题容缺 null
- **文件** `src/market-analysis/buy-point-{snapshot,state-builder,result-mapper}.js` + 题集 `llm/buy-point-questions.mjs`（现行 `BUY_POINT_QUESTIONS_VERSION='BP67'`，改题面必 bump；题集版本号与台账 BP 案号错位详台账）。zigzag 摆动结构锚族/openSeg 七键/phaseSplit/swingRise 等锚照算落 digest（部分纯留档无消费者）
- **口径**：近窗=锚末 tick 时刻为终点的 W∈{30,60,120}s 半开窗；价格动量短窗 5/10/30s；wallet=sender||trader、集中度剔路由伪钱包；资金不滤 outlier、价格族仅可靠价；缺证据两态（无行=0/无原料=null）；锚=anchorCountAt；trades 源点位锚=成交时刻（`created_at: executed_at || created_at`）；ladder 源锚=腿首触发 tick 时刻
- **测试集**（`scripts/buy-point/`，182 跑）：trades/signals 双源+ladder 挖掘（`mine-ladder.mjs`）；结局观测预计算；token-ticks 页 `?bp=<set>` 点位叠画；`sets/*-ticks/` 不进 git、data/ 存档进 git；**人工锚点集 `data/manual-anchors.json`**（tick 锚+set 点锚，expect=用户裁定，换代对拍用；锚不驱动代码）

### C84 叙事触发模型（`narrativeTriggerCondition`）

- **触发状态机**（引擎 `_narrativeTriggerCheck`，挂 `_onFactorsUpdated` 买腿分支 N3 同位）：per-token `{rounds,inFlight,hasInitial,lastRating,…}`；tick 时刻评发起条件 → 过门发起后台 `getRating`（fire-and-forget）；首轮 reason='condition'，补轮 reason='retry' 仅当 lastRating==1 ∧（accountOnly ∨ corpusEmpty）∧ rounds<maxAnalyses ∧ 距完成≥intervalMs；补轮带 `overrideOptions:{ignoreCache:true, invalidateAccountCorpus:true}`。每轮发起/完成即 `FA.setNarrativeFactors` 投影；完成回填 identity 校验。**重启全内存语义**（rounds 按进程计）
- **FA 叙事四键**：`narrativeRating`（null|1|2|3|9；**9=无法理解**固化不接翻案域）/`narrativeRounds`/`narrativeRetryDue`（**now 用 buildFactorMap 入参禁 Date.now**）/`narrativeCategory`。rating null/1/9 ⇒ 单一买条件恒 false ⇒ 天然无信号（unrated 放行政策在新链路废止）
- **轮次留痕表 `narrative_analysis_rounds`**（CASCADE 挂 experiments）；查询 `ExperimentDataService.getExperimentNarrativeRounds` + `GET /api/experiment/:id/narrative-rounds`（service key 红线）
- **互斥 fail-fast**：同腿 `narrativeTriggerCondition` ∧ `narrativeCallCondition` 均非空 → loadStrategies throw / validateLegs 400
- **回测口径**：无状态机；`_preloadNarrativeRows` 门扩至 trigger 腿 + FA 常量注入；fire 链 trigger 腿不评触发条件直接 getRating 仅为取 gmgnRisk；**不登记拉黑/不跑 P4b 与同叙事龙头检查**；stop 清 FA 注入
- **dataPrefetch/visionPrefetch 退役**（机制整链删除）：存量实验带该段=静默丢机制（上线前 SQL 核查 running 实验）
- **刻意行为变化（用户裁定）**：①rating=9 拦截 ②sniper 持仓/同名簇观察键不再采集 ③同叙事龙头检查不跑 ④`_narrativeBlockedTokens` 不消费 ⑤earlyTradesPerWallet 分子偏 SQL 行数略低
- **关键不变量**：发起条件量门 < 买条件量门（库条目维护该序）；N3 与触发模型 per-leg 互斥共存

### 条件未知因子 fail-fast（三层防线）

写错因子名的条件子句静默恒真/恒假，必须拒启而非 warn：① `ConditionEvaluator.validateCondition` 含 IS NULL/IS NOT NULL operand 检查；② `StrategyEngine.loadStrategies` 校验失败 **throw**（`condition`/`narrativeCallCondition`/`narrativeTriggerCondition` 用 FA 因子集——trigger 与 call 同腿共存=互斥 throw；`preBuyCheckCondition`/`repeatBuyCheckCondition` 用 PreBuy 键集；`gmgnCheckCondition` 用 GMGN 键集——分集防双向误报）；③ `StrategyLibraryService.validateLegs` 入库同口径 400。上线前跑 `scan-unknown-factor-conditions.cjs`。

### FA（`src/services/FourMemeFactorAggregator.js`）

- `_buildFactorMap` 字面量键（`getFactorKeys()` 探针自动收键，勿手维护清单）；`tokenAgeSec`=`age×60` 同源双路径
- **roster 三名单**（模块级 Set 加载）：
  - 跟单簇 `config/rosters/copy-wallet-roster.json` + `maxCopyWalletHolderCircPct`：因子=名单钱包**单钱包最大**净持仓÷流通；名单 null→恒 null→`<N` 门恒 false=**fail-closed**。生成=`scripts/scan-copy-trade-clusters.cjs`（pair 统计缓存 `data/offline-cache/copy-trade-pairs.json.gz`）；维护=182 重跑 `--commit` → push → 重启实验生效（静态快照）
  - 极著名钱包 `famous-copy-wallets.json` + `famousCopyWalletCircPct`：**独立于主名单**；**0 语义**：集合 null/空/无命中→恒 0→裸比较放行（无 IS NULL 臂）；roster v3 起=「GMGN kol 前排 ∪ 用户点名」（数据源 data/kol-study/kol-wallet-stats.json）
  - sybil 大簇 `sybil-clusters.json` + `sybil-clusters-manual.json`（manual 人工锚定不覆盖）+ `sybilClusterHolderCircPct`：因子=簇内钱包**合计**正净持仓÷流通×100；同 0 语义
- **preFilter live 平移默认开**（`fourmemeWs.faPreFilter !== false`）：从各买腿 condition **AST**（必须 AST 直传，String() 化恒 null 静默失效）提取 age 区间注入 `setPreFilter`——出窗未持仓票 build 返回 null → 不 emit factorsUpdated
- **act\* 9 键滑窗**（`activityWinMs` 默认 10000，`factorParams` 可覆盖）：`actBuyBnb/actSellBnb/actNetBnb/actTrades/actTraders/actBuyers/actSellers/actNewTraders`+**`actTotalBnb`**（买+卖合计——现行买腿低活跃门载体）；wallet=sender||trader；写点 `_applyWalletAggregation` 尾部；读点纯函数（空窗全 0）；**禁 Date.now（now 由 buildFactorMap(state, asOf) 传入）**；序列不可重建，FactorBuilder 两处快照透传（不落库即丢）
- **holderTrend slot 化**（11 键）：blockNumber 桶×8 块；与价格接受链解耦；W=8 与 HolderTrendDetector maxPoints=8 **必须同改**；门槛：growthRatio 族 ≥2 点、slope/direction 族 ≥4 点；slim 快照含 11 键
- **集中度门族**：条件串现行为 top1/top2 轴两键（`bundleClusterHoldCircPct` + `top2HolderCircPct`）+ 跟单簇/famous 门；**各臂现行阈值以 strategy_library 最新版为准**。纯观察键（bundle 流量 6 键/evenCluster 三键/`top1/top2HolderSupplyPct`/`sybilClusterHolderCircPct` 等）照算不进条件串；`_blockBuyWalletsAll`/`_evenBuyBuckets` 全史不裁
- **T91a 流通分母口径**：全部 ÷circ 键分母统一 `max(_circTokens, Σ正净持仓)`——恒 ≤100、读取点单趟求和序无关
- **`tradesRouterPct`（T70）与净买窗三键**为现行流量门载体（见 preBuy 段）；`buyWallets`（T76）=K 组 `_buyerAddresses` 全史 Set size
- **`currentVsLaunchPct`（T122/T127/T130/T134/T139 现行口径）**=现价较发行价涨幅。**launch=T139 完整地板 `floorLaunchPriceBnb(平台常量, 滚动最低||首买价)`**：four.meme 主流档常量 4496173469e-18、flap（含 quote 盘）FL 常量 ≈5.546e-9；`_firstBuyPriceBnb` write-once（只认 BUY）+`_minRelPriceBnb` 滚动最低（BUY/SELL 皆更，乱序回放收敛）；null（gang/未知平台）才回落首可靠价。`priceBackToAlmostLaunch` 经此键自动吃新锚；BP/CD snapshot 地板原料同源；**null=未见可靠价 fail-closed 裸比较恒 false**
- **`holdersExDust`（T98）=人气门现行载体**：净持仓按首可靠价折算 ≥ `holderDustBnb`（默认 0.015）的钱包数；首价冻结点固化；无可靠价票退化=holders fail-open；holders 旧键保留纯观察

### 策略库（T202：交易策略唯一来源）

- `strategy_library` 表（全局，name UNIQUE/**definition jsonb**/version 乐观并发 409）——条目=**完整交易策略包**：`{buyLegs[], sellLegs[], stallClose{}, burstCooldown{}, modules{factorCheck|cheatCheck|actFrontGate|buyPointCheck: 版本键}}`；**卡牌张数在腿上（策略本体），每卡 BNB（positionManagement.perCardBNB）=实验层**
- **实验 config 只存顶层 `strategyId`**（uuid）；引擎 `initialize` 经 `_resolveStrategyPack` 查库解析（**启动时取最新 version——改包重启生效**），缓存 + 写回 `config.strategyResolved` 审计；`_buildStrategyConfig` 薄读缓存=两引擎腿唯一入口。**旧内嵌腿形状（strategiesConfig.buy/sellStrategies）拒启 fail-fast**；strategiesConfig 仅存 stats/eventRecording/permanentBlockCondition
- **门链 enabled 归包**：`modules` 键在场=模块启用（版本键经 `src/market-analysis/module-registry.js` 解析，未知键 fail-fast；代码同时维护 ≤2 代）；实验 config 携带四 enabled 键/顶层 stallClose/burstCooldown → web 创建 400+克隆剥离（引擎读包不看 config）
- **stallClose/burstCooldown 归包 definition**；factorSellFilter/stopLoss/ops 旋钮留实验层
- 部署=`scripts/deploy-trading-strategy.cjs`；库页=策略包编辑器（双侧腿编辑+「从旧实验导入」迁移路径+模块版本下拉 `/api/strategy-library/module-versions` 单一真相）；创建页=策略包选择器
- **routes 必须走 `dbManager.getClient()`（service key）**；**部署红线：DDL 先于新 web-server/引擎重启存在**
- **groups/cycle 已废**：腿带 groups（非空）/cycle 字段 fail-fast throw 拒启
- 对拍工作流：对比两策略=两个包条目（clone --pack / backtest-token-case --pack 整包换）；**腿不可内联**（策略唯一来源不变式）

### 卡牌 / 止损 / 毕业卖（引擎级机制，实验 opt-in）

- **卡牌**：开关=`positionManagement.perCardBNB` 存在且 >0。策略级 `cards`（卖腿额外接受 'all'）+`cooldownSec`。买入=perCardBNB×cards（virtual 现金门不足=买失败不降张）；卖 sizing soldN/tokenCards（全清腿恒精确 1）——**sellPercentage 已退役（卡牌是唯一卖 sizing）**：携带该键的存量卖腿拒启。卡账本 `_tokenCards` 维护在 `_executeSell` 成功分支，trades.metadata `cardTrade` 绝对值重放恢复。**重放精度钳制**：`Insufficient token balance` 且差异≤相对 1e-9 → 钳到持有量重试
- **止损双腿**：开关=`stopLoss` 段存在任一腿参数。时间止损（持有超 N 分钟仍 `profitPercent <= 0`）/价格止损全清；双挂点=tick 即时+扫描（**断流票唯一触发路径**，buildFactorMap 必传 Date.now()）；仅虚拟系引擎（回测有自己的版本）。现行实验以卖腿表达止损（bypass=false 走确认窗、不设 maxExecutions=卖出失败每轮重试直到清仓）
- **持仓卖腿兜底扫描**：`_scanHoldingsStopLoss` 除止损外新增卖腿评估——断流票（>60s 无 tick）调 `_evaluateSellPath`；启用=存在卖腿；周期 `stopLoss.scanIntervalSec ?? sellScanIntervalSec ?? 30s`
- **流动性止损 stallClose（配 `stallClose` 段即启用，已归包 definition）**：持仓票距上一笔链上成交 > `stallMs` 全清（bypass 立即路径——空窗期零 tick，卖确认窗永远凑不齐）；实时 1s 墙钟/回测虚拟时钟。**T118 足额门 `minTickBnb`（0.02）**：微量成交不算流动性证据——水位从 `lastTickAt` 切 `lastSubstantialTickAt`；水位 null=fail-open 不卖。**T170/T170b 两档域延长**：①almost 档=检测时点 `currentVsLaunchPct ≤ +10` → 放宽到 `almostLaunchStallMs`（缺省 90s）；②破发档 `breakdownStallMs` **缺省关（T170c 撤回）**，显式 >0 可恢复；两档恒 max(stallMs,·) 只延长不缩短、因子 null fail-closed。**基础 stallMs 模板默认 50000**；卖出信号 metadata 落 `stallClose` 段；纯函数 `core/stall-close-almost-launch.js` 两引擎同判
- **burst 承接冷盘 burstCooldown（T189 两批卖出，配段即启用 {}=全默认，已归包）**：burst 触发买入成交后观测「承接」=**非 burst 成员钱包**（触发波窗=fire 前最密 5s 窗、平手破除=T199c 窗末更晚）的买额——批1（fire+15s 承接<0.1B）立即 bypass 全清；批2（15~30s 段承接<0.05B ∧ 枯竭 8s 快线或段末兜底）补卖；30s 承接≥0.05B 解除。与 stallClose 互补（管「有成交但无新钱包承接」）。纯函数 `core/burst-cooldown-exit.js`+FA ring/arm/view 三接口；**T189b arm 资格线：门链 sbw（levels.stallBurstWave==1）非 burst 不 arm**（fail-closed sbw 缺席不 arm）；留痕 signal metadata `burstCooldownArm`
- **账号信息复检卖臂（C166，默认关 `fourmemeWs.accountHealthCheck.enabled`）**：持仓期检测宣告账号删号/删推 → FA `issuerAccountState` → 卖臂条件全清。检测裸调 apidance（**绝不走 TwitterFetcher 缓存层**）；删号只认「用户不存在」特异 message、删推严格 tweet_id 全等；故障归 null fail-open；回测零接线
- **GMGN 进场验证卖臂（T116，默认关 `fourmemeWs.gmgnEntryCheck.enabled`）**：持仓 `holdSec`（默认 180s）检查点查一次 GMGN `wallet_tags_stat`（smart/whale/renowned 三类在场数），全零=无人接力 → FA 五键 → 卖臂全清；**unknown fail-open 不投影不误卖**；write-once per 持仓轮；买点观察帧 T116b（买入成功点 fire-and-forget 观察不进门）；回测零接线
- **买锚 fire 价口径**：FA `buyPriceBnb` 定在买信号 **fire 时刻**，profitPercent/peak 族全程按 fire 价起算；fire 价缺失回落执行时刻价
- **fire 窗峰值回填**：fire 点 `markBuyFire(token, firePriceBnb)` 开 pending 双轨峰，买入成功 `setBuyState` 消费回填；**无 pending 标记时逐位退化为旧行为（回测 parity 红线）**
- **双时长 + 执行口径键**：`holdDuration`=信号（fire）时刻起算；`realHoldDuration`=成交时刻起算（物理持有）；执行键 `buySignalAt/buyExecutedAt/buyExecutedPriceBnb`（live=余额差法成交价，虚拟/回测=null 诚实语义）。`_stopLossHit` 时间臂读 `realHoldDuration`
- **T113 自入场累计净买三键**：`sinceEntryNetBuyRatio`（本仓成交锚以来 (Σ买−Σ卖)÷(Σ买+Σ卖)×100）+原料观察键；入场后零交易 → null fail-closed；卖腿 `pump-imbalance-exit` v3（`realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90 AND sinceEntryBuyBnb >= 1` 全清——T168 买入额度门 ≥1 BNB）
- **T133 famous 进场撤离+low 区滞涨撤离两卖臂**：①`famous-entry-exit` v2（`sinceEntryFamousNearLaunchBuyBnb >= 0.5`——T136 金额门：两笔 0.2~0.3 常见档或一笔 0.5+ 才算像样 famous 进场；FA 键=roster 钱包 near_launch 区间买入金额 latch）bypass cards:'all' 全清。②`low-zone-stall-exit` v1（`currentVsLaunchPct > 40 AND currentVsLaunchPct <= 80 AND actTotalBnb < 0.1` bypass 全清——low 区刻意不含 near_launch）。**T147 锚后等额捆绑撤离臂 `bundle-wave-exit`**：FA `sinceEntryEqualBundleWallets`（同块等额簇流式检测单调 max，尘门 0.01 剔路由）`>= 8` bypass 全清。现行库卖腿另有 `peak-protect-exit` v2 深回撤保护腿（bypass 立即路径已退役，走默认 3.5s+5tick 确认窗）。**T161 famous-trim 两段减仓**：FA 三键 `sinceEntryFamousLaunchZone{Buy,Sell,Net}Bnb`（发行价上方域 **(+10,+60] 地板锚**，Net 可负）；卖腿 A=`BuyBnb >= 0.2` cards:2；B=`BuyBnb >= 0.2 AND NetBnb <= 0` cards:2。与 famous-entry-exit 成阶梯；未持仓 null fail-closed
- **毕业事件驱动卖**：virtual 持仓票 `_handleGraduation` → `_emitGraduationSell` 全清（幂等标记后置到卖出成功）。三挂点：事件路径+买入成功点补卖+扫描兜底。**flap graduationProgress=资金口径**：池净入金 Σ(0.98×buy)−Σ(1.0204×sell)÷毕业阈值（per-quote 毕业事件 `noteGraduation` 学习值 write-once）；**gang 同资金口径但净额直计**（系数恒 1.0）÷ `graduationThresholdBnb ?? 15`；platform 由 registerToken meta 注入、tick.platform 兜底回填；累积器进程内存态，重启后跨重启池进度低估（毕业事件全清/人工兜底）。**live 毕业=Telegram 告警人工处置 + 毕业票卖出路由 PCS V2 外盘**：统一 `_executeSellLive` → `_ensurePcsTrader`（shareSignerFrom nonce 红线）；flap 非 BNB 计价盘毕业对二跳 [token,quote,WBNB]；PCS 分支 options 不带 minOutRatio/expectedNativeOut

### 信号机制

- **观察信号（实验级默认关 `fourmemeWs/flapWs.observationSignals.enabled`，仅 virtual+live 回测零接线）**：叙事评级==2|3 或市值>`marketCapThreshold`（默认 12000 USD）→ 每票最多 `maxPerToken`（3）行 `signal_type='OBSERVE'`（action='hold' 恒不触发交易）；`ObservationSignalService`（`_onFactorsUpdated` 同步直调）；init() DB 分页重建计数；启动/构造失败=机制不启用交易照跑；signals 页观察筛选+手工买按钮
- **strategy_signals 进程内缓存**：缓存命中→本地 merge→UPDATE→**成功才提交缓存，失败 delete 回退 SELECT**；终态落库后 delete。前提：实验进程是 signal 行唯一写者
- **永久阻断条件编译缓存**：`new Function` 结果按 `${jsExpr}\0${keys}` 模块级缓存，catch fail-open
- **去抖**：买腿 `signalDebounceMs 200 / signalDebounceMaxWaitMs 1000`（slot 级合并）；卖腿确认窗 `sellDebounceMs 3500` + **双门槛确认** `sellDebounceMinTicks 5 / sellDebounceMaxWaitMs 120000`（首真起计**不重置**、恢复 clear 不卖、fire 重评仍真才卖；断流票窗内零 tick 不得按陈旧快照卖，后续 touch 凑齐即时 fire，maxWait 绝对上限强制逃生；minTicks=0 缺省纯时间语义存量 bit-identical）；**T109 证据口径**：同笔链上 tick（`txHash:logIndex`）只计一份证据；**T109 腿级覆盖**：卖腿可配 `sellDebounce:{minTicks,debounceMs,maxWaitMs}`（`normalizeSellDebounce` fail-fast，仅卖腿）；bypassDebounce 腿/止损/毕业卖走立即路径。实验级键可覆盖，跑中实验须重启生效
- **买信号发射节流（T110，全局机制所有实验生效，回测同步）**：per-token 冷却时间窗（`buySignalCooldownMs` 默认 3000，0=关）+发射帽 `buySignalMaxPerToken`（默认 5，0=不限）——**无论上次信号是否通过均不退还**；被拦不记账；live=拉黑短路后静默拦截（不落信号行）；回测=叙事否决短路后同款；OBSERVE/手工买不走本层；发射帽同时=作弊检测每代币检测次数上限。**tick 增量门 `buySignalCooldownTicks` 缺省 0=关（T120 退役）**
- **因子卖出过滤门（T157/T183/T185/T186 现行态，`fourmemeWs.factorSellFilter`，flap/gang 配各自 ws 段，回测 wsSection 同键）**：卖出环节纯代码因子过滤模块（零 Jev/零网络）——**所有卖出信号统一过门**（腿字段 factorSellFilter 已退役携带即拒启）。**管辖判定=`profitPercent >= 50`（T211 2026-11-22 管辖线 100→50，案源 bt-v179 0x4509…7777 pp=92.8 smart 1s 前大买 0.33B 照卖）∨ pump 臂签名（触发腿 condition 引用 `sinceEntryNetBuyRatio` 子串匹配——**T183a：判定读 `legConditionText()` 双形状兼容，纯 AST 无原文不管辖 fail-open**）∨ recoveryHold 独立管辖（`peakProfitPct >= 80` 本身）**；pp<50 且非管辖的卖信号恒放行。拦截（留痕序 pump_arm>famous>smart>recovery）：①**pumpArmHold（T186 默认拦）**：pump 签名管辖成立即拦 rule='pump_arm_hold'，无需 HOLD 证据；②famousHold：`sinceLastFamousBigBuySec<=180 ∧ recentFamousSellBnb<0.4`；③smartHold（T183）：`sinceLastSmartBigBuySec<=180 ∧ recentSmartSellBnb<0.4`；④recoveryHold（T185）：`peakProfitPct >= 80 ∧ currentVsLaunchPct <= 40 ∧ chg5Pct > 0`（FA chg5/10/30Pct 短窗动量键）→ 拒绝卖出 rule='recovery_hold'；null 任一缺席 fail-open 放行宁卖不冒充买点。配置缺省 `50/180/0.4（minProfitPct=50，T211）+ smart 180/0.4 + recovery 80/40/0 + pumpArm 开`，各段整体省略=全默认、`enabled:false` 单关；缺段=关；非法 throw 拒启。**smartHold 名单=`data/kol-study/smartmoney-accum.json`**（文件缺失=空 Set=恒放行；静态快照更新须重启进程）。挂点=`_evaluateSellPath`+`_reconfirmAndSell`（透传触发腿对象）——**拦截=视同腿未触发**（清 pending，240 帧等价对拍单测锁定）。拦截留痕：连续拦截 per (token,腿) 只落首行 SELL blocked 信号行+signals 页徽章+图表标注。纯函数单一真相源 `core/factor-sell-filter.js`
- **叙事直调** `narrativeCallCondition`（legacy 腿）：fire 因子满足 → 拉黑检查后、pre-buy 前同步 `NarrativeAnalyzer.analyze()`；30s Promise.race 超时（超时后台续跑落缓存）；失败/超时 normalize 9 放行。**语法 AND/OR only，`&&`/`||` 被静默截断**
- **叙事预触发（N3，legacy 腿专属）**：开关 `fourmemeWs.narrativePrefetch.enabled`（**默认开**：删段=开）；tick 时刻评估首条买腿 `narrativePrefetchCondition ?? narrativeCallCondition`，满足且未 write-once → 后台 `getRating`；rating=1 提前登记 `_narrativeBlockedTokens`
- **叙事一票否决**：直调 `numericRating=1` → 内存拉黑（后续 fire 写 signal 行前短路）；豁免=`precheckStage === 'address'`（宣告竞态）且 age<300s；rating 9 永不拉黑
- **账号型 TTL 穿透重析**：语料入口只有账号且 rating=1 的缓存行，行龄≥TTL → 穿透 `analyze({ignoreCache:true, invalidateAccountCorpus:true})`；per-token 真跑上限；走独立 '!ttl' inflight 槽
- **叙事重试配置 `fourmemeWs.narrativeRetry`**（默认开）：`intervalMs` 缺省 10000 / `maxAnalyses` 缺省 3（**计含首析**）/ `windowSec` 缺省 300（⚠️**不得低于 worker retryWindowSec**）/ `noCorpusIntervalMs`/`noCorpusMaxAnalyses`（C162 零语料臂独立节奏）。C84 兼供触发轮；BacktestEngine 零接线；UI 物化语义：显式关写 enabled:false、回测剥离
- **叙事结果=token 级全局缓存**：`token_narrative` 按 token_address upsert 跨实验共享；失效=行删或 `updateIsValid(addr,false)`；**历史窗口回测前先失效缓存**：`scripts/narrative/invalidate-referent-window.cjs` / `invalidate-carrier-window.cjs`（范围刻意只收窄基底买过的 token）
- `token_category` 列写入：`deriveTokenCategory(prestage, stage1)`；终态重析无分类由 final save 显式 `clearTokenCategory` 置 NULL——**重跑必须反映本次判定**（C146）

### TPA / OPB

- **TPA**（`src/services/TokenPositionAnalyzer.js`，`config.tokenPositionAnalyzer` 段存在才构造）：触发门命中（write-once）对 top20 持仓 as-of 画像，`TPAPre_*` 因子族注入 FA；策略引用未触发的 `TPAPre_*` 恒 null → false=**fail-closed 不买（去门控化）**；触发门校验 fail-fast（时间门 blocks/ageSeconds 恰一，数量门非负）。三路径：离线 fresh 直用/stale 增量/miss 实时现算；retention 基准=触发刻峰值枚举大户集冻结后 running 净持仓重算。**liveTicksRetainHours**（默认关 null=不裁）：删头段须同步推进 `_liveTicksBufferStartMs`。**gmgnFilter**（`{enabled, exemptPct}` 缺省关）：①GMGN 用户钱包不参与分数 ②前期参与者 GMGN 占比≥exemptPct → **豁免放行**（不能做成 null——null 在 `TPAPre_tokenScore > 2.5` 下 fail-closed 拦死）③minHolders 同步剔；`TPAPre_gmgnExempt=1`+verdict 改写。BSC 新钱包中性分 2.2
- **OPB**（`src/services/OnlineProfileBuilder.js`，`fourmemeWs.onlineProfile.enabled` 默认 false）：实时代币分类，双门触发+60s 扫描补救，写 `token_profiles`（全局 PK，不挂实验防级联删）；阈值判定与离线 classifyToken 共用 `scripts/shared/token-classifier.js`（单一真相）。**重启过渡期全史路径**：水位对齐前自动改走 wss_price_ticks 全史+classifyToken（防涨幅失真）；失败 fail-closed 不写失真行

### 叙事引擎（`src/narrative/`）

所有 LLM 决策走 **Jev**（api.typesafe.ai，结构化三原语 Choice/Score/Noul，无文本生成，一票一次 fan-out 调用秒级）。

```
Token URL → URL 分类（含 IPFS metadata 解包）→ 数据抓取 → Pre-Check（纯规则）
   ├─ 账号/社区 token 或自发宣告 → prestage Jev（3 题；C251 同名自发宣告走账号路径，例外=影响力极大走 meme 路线 C117 双门+C251 豁免）
   └─ 标准路径：单次 Jev 调用（主干题+条件题；superIP 注册表命中 → state 注入认证行，评分全归 Jev）
```

- **文件**（`analyzer/llm/`）：`JevClient.mjs`（缺答案 id 直接 throw；429/5xx 退避，Retry-After 头优先、钳 [500,15000]ms）/ `jev-questions.mjs` / `jev-prestage-questions.mjs` / `jev-state-builder.mjs`（60k/20k 预算）/ `jev-result-mapper.mjs` / `jev-prestage-mapper.mjs`（**聚合/阈值/截断全在代码侧**）
- **版本规则**：改任何题面必须 bump `JEV_QUESTIONS_VERSION` / `JEV_PRESTAGE_QUESTIONS_VERSION`（落库标识）；校准验证=标准题集定向重析对拍（182 `reanalyze-tokens.mjs`）
- **时间基准**：新鲜度对 **token 创建时间**（`raw_api_data.created_at`）计，绝不用墙钟；缺创建时间 pre-check 跳过时效规则、Jev state 退墙钟
- **修正教训（改校准必读）**：①题面改锚分不动（反复实证）——语义修正措辞能翻 argmax，分数锚定必须代码侧 mapper 门；②校准重跑必须**逐字复用线上 jev_prompt.state**（token_narrative 不落部分语料段，重建 state 缺语料致档位漂移）
- **图分析（vision，C243 图片直连）**：主推第一张图**直接内嵌主 Jev 调用**——`getTweetImageAsset` 归一化图本体（EXIF 转正/缩放/letterbox，产物二次校验 fail-closed null）→ `JevClient.ask(state, questions, { assets })`；state 渲染 `【主推配图】:main_tweet_image` 引用行**恰一次**。**剥图重发防线**：主调用 HTTP 4xx ∧ 图片特征词 → 剥 asset 无图 state 重发恰一次。**provider 开关** `vision.provider`（默认 jev）：`siliconflow` 臂=旧 captioner 链保留；对称守卫双保险。**前置 Jev 预判门（C72）**：`vision.gate {enabled 默认 true, minSufficientProb 0.6}`——1 题 Choice 判语料是否已足够，sufficient≥阈 → 整段跳过
- **提速要点（改挂载点/序须保持内容 bit 一致）**：website 内容抓取总开关 `websiteFetch.enabled` 默认 false；中段三泳道 precheck∥账号链∥issuerCa 并发；precheck 三 DB 查询并行；第二推文/双账号并发；undici 全局 keepAlive 30s；dbSave 瘦身
- **语料充分门（C79）**：`corpusGate {enabled 默认 true, minSufficientProb 0.6}`——twitter 主语料等齐后 1 题 Choice，sufficient≥阈 → 待抓段整段跳过；资格=twitterInfo 非空+有待抓平台；`Promise.race` 2s 上限；**陷阱：资格判定与 `{...results}` 展开都必须在 `await twitterPromise` 之后**
- **web-fetcher**：直抓失败（403/Cloudflare/超时/抽取<50 字）→ `https://r.jina.ai/<url>` 回退一次（**不得带浏览器 UA**，用 `richer-js-narrative/1.0`）；发布时间前插正文供时效题；失败 fail-closed=null
- **推文拉取缓存**（getAccountWithFullTweets 两层）：userInfo handle 级+tweets userId 级全量 key + **CA 惰性早停**（截断列表落 `…:ca:<addr>` 专属 key）；**刻意不走 CachedFetcher.fetchWithCache**（失败 1h 冷却会灭宣告竞态重试窗）；只缓存成功
- **AVE/GMGN 社媒补源双链（C238/C238b）**：源优先级链 **meta/appendix → IPFS 解包 → AVE token detail → GMGN link → C77 搜索（最后手段）**，逐层必要门 `!hasTwitterLink`（判据单一真相由 gmgn-social-fetcher 导出）。AVE 层 `utils/ave-social-fetcher.mjs`（完整 URL 直传不拼接；成功缓存 60s/null 进 1h 冷却）；GMGN 层**串行在 AVE 之后**（免费版易 IP 封禁配额最省着烧）；`enrichSocialByGmgn` 默认 true。**C238b 双臂**：①`isTweetLevelUrl` 判 AVE 补到账号级还是推文级——`aveOnlyAccountLevel` 穿透臂使 GMGN 仍走；②prestage 地址核验失败（stage='address'）回落标准路径 W 评估（skipAddressValidation 票不回落）
- **空语料推特搜索兜底（C77+C130）**：语料全空票按 token symbol（不可用才回落 name）+`since:<创建-7d>` 搜推特作 `[TWITTER_SEARCH]` 独立段；**C130：去重剔转推后语料非空即旁路 `no_public_info`**：pre_check_result 置 null 走 Jev；零语料/失败 → ruleName 保留（1800s 重试域）+**零语料不落缓存**；**★lag 隔离红线=证据只走 `raw_api_data.search_evidence`**，与 extractCorpusTs 三路径结构性无交叠
- **PrecheckFailRetryService**（`engine.precheckFailRetry` 配置）：两域重试——`address`（宣告竞态窗 300s，重析带 `invalidateAccountCorpus:true`）/`no_public_info`（语料晚到窗 1800s，先 invalidate GMGN 缓存再 `enrichSocialByGmgn:true`）；门：token age（wss_events 最早 token_create 锚，缺锚不重试 fail-closed）+ 新 ticks 增量≥20 自节流 + 尝试<5；DB 一律 dbManager
- **叙事知识库（C165，`analyzer/knowledge/`）**：5 文件聚合（config/knowledge/{concepts,bluechips,manual-entries}.json 进 git + data/knowledge/{quasi-graduations,quasi-feedback}.json 不进 git），按 id 合并读覆盖；id 域 `b:`/`q:`/`concept:`。匹配 5 级规则（address>name_exact>name_substring LCS>corpus_contains>concept_keyword）+防噪三防线。命中注入 `[KNOWLEDGE_BASE]` header 段（标准+prestage 双路径）；蓝筹家族偏好指引（C177）=改 Prompt 交 LLM、代码侧不加分；反馈回写：rating∈captureRatings 自动沉淀 quasi-feedback.json（tmp+rename 原子写）；蓝筹口径=**ATH 市值>$1M**；builder 只在 182 跑（`scripts/narrative/build-knowledge-{bluechips,quasi}.mjs`，详见 docs/knowledge-base.md）。config `knowledgeBase` 段（缺段静默关/残缺 throw）；mtime 热载；**JEV_QUESTIONS_VERSION 不 bump**（state-only）；**回归依赖知识文件 commit 态**
- **已定案规则**：规则 5 高影响力+媒体直发**已废**（自填 twitterUrl 攻击面，放行走 Jev）；rule 0.52 同名蓝筹**整体废除**（移交叙事层）；规则 0.5/0.6 **死代码整链删除**（引擎侧 strictSameNameTokenCount 独立活链路不碰）；expired_tweet 分桶=速查表 C74/C104 行；无锚语料（account/纯 IG）放宽评级 2/3 即可买

**叙事门/豁免速查**（一句话判据；完整判据/案史/豁免链见台账对应 case；审计字段落 stage1.jev.\*；已废门（角色 IP 豁免/戏谑关联/形象载体/superIP 指代/巨大影响力载体/negative_hard_news/事件太小/指代 meme 低档）判据已归 acceptance·event_fit 口径层，详档台账）：

| 门/豁免 | 一句话判据 | case |
|---|---|---|
| cashtag 改道 W（J1.17） | 语料（含父推）$TICKER 全等 token symbol → 强制 W 数学 | C28 |
| 发布者代理（J1.18） | 域名词根=token 名+粉丝≥10万+名互斥+非版本词（代码门） | C29 |
| web3 买家视角锚（J1.23+C94） | A/B 类 strong_fit≥0.5 且 tier<B → effTier 锚 B（只升不封顶）；B 类另享 dim2<18 锚 18 | C38/C94 |
| event_category 主体归属 | crypto 语境项目主体性陈述归 W；站内金融化玩法/既有项目里程碑归 D；借势发币≠发布项目（主体=被借势热点不归 W）；无项目实体不选 W | C230-C249 |
| W 类数学（C142/C154） | **单轴：项目对 BSC 用户吸引力(0-75)，pass 32**；时效仅对 older/unknown/override 封顶 30；发布者影响力资格轴（Dev 非完全匿名可过/Web2 涌现项目须较知名）；被提及资产形状臂：语料只是 $TICKER 提及 → 评被提及对象 | C142/C154/C232-C249 |
| IG 影响力两层（C44） | IG 真数据进 state 评分；有链接没数据：A 类+dim2<18 → 锚 18 | C44 |
| 产品实体+接纳门（J1.27） | **web3FitMassBlock 通用硬门：strong_fit+fit 合计<0.5 → 拦，全域**；豁免 pubProxy/isW/binanceCorpus/平台官方号 | C56/C141 |
| 图载体豁免（C59） | 图证据+0<关联≤10+name_entity_memeability≥3 → 豁免 Stage3 关联截断 | C59 |
| 名图一致豁免（J1.30） | 图证据+name_image_consistency 合并≥0.5+0<关联≤10 → 豁免关联截断+量级门两拦截位；答案缺失 fail-closed | C65/C86 |
| 找角度时效门（C68） | angle_seeking/interpretive_reply 载体推 lag>6h → mapper 时效归 0 | C68 |
| 推文时效分桶（C74+C104+C120+C255） | 非豁免桶 lag≥300s 拦；direct_tweet（粉≥5000 或 赞≥500 或 转≥100）豁免交 Jev——主从结构门：主推 lag>24h 须 website_tweet/quoted/retweeted 任一 ≤24h 新载体才豁免；**C255：S 级 super IP 源头年龄界独立 30min**；C120：interpretive 作者粉≥5000 且主推 lag≤24h 跳过硬拦；主推 created_at 缺失 fail-open | C74/C104/C120/C255 |
| 叙事源头陈旧门（C75） | direct_tweet 主推距 token 创建锚 >30d → mapper 时效归 0；仅主推；锚缺失 fail-open | C75 |
| 图文名不符拼写门（C78） | 币名 CJK≥3 字 ∧图在场 → `image_name_text_match`：one_char_diff ≥0.5 → Stage3 截断；exact_match/unrelated 不拦；缺失 fail-open | C78 |
| E 类感染力折损（J1.36） | `(strong_fit+fit) < 0.5` → 仅 category=E tierScore+effSpread ×0.5；缺失 fail-open | C93 |
| F→E 改道（J1.37）+ 名字门（J1.42） | **改道**：event_finding_vs_recap==news_recap ∧ F → 强制改道 E。**名字门**：①实体轴 `bsc_meme_user_name_entity_acceptance` 四桶——accepted/unacceptable_type（圈外商业品牌/严肃机构→≥0.5 全域拦+pubProxy 豁免）/wrong_entity（指歪指残→≥0.5 全域拦含 A/E；有意义变形不选）/not_entity（泛称词无专名搭配+无命名故事才落→词句门接管）②词句轴 `bsc_meme_user_phrase_acceptability` 只评 not_entity 票（C189 全域无豁免）③门链序 ne→em→we→ua | C96-C190 |
| 币安地域子账号量级锚 | 主推作者 handle `binance` 前缀 ∧ 非五全球号白名单 ∧ binanceCorpus 在场 → effTier 锚 D；只查主推；缺失 fail-open | C97 |
| 借壳语料陈旧门（C250） | 账号级借壳+全语料陈旧=首发抢注形状代码硬锚，**两腿全真才拦**：①无推文级语料 ②全部语料源（载体/父推/square/website/账号注册时间）距创建锚 >30d（任一新鲜即照放）；缺失 fail-open | C250 |
| 蓝筹账号借壳门（C256） | **三腿联立才拦**：①symbol 名变体撞 b: 蓝筹 ②主推作者=该蓝筹注册账号 ③语料文本（主推/bio）不含本票 symbol（=蓝筹宣告了本票才放）；纯图推/作者缺失 fail-open | C256 |
| 借壳语料父推源头窗 | binanceCorpus 票主推 in_reply_to 父推 lag>24h → timing 归 older；不限 tweet_type；缺失 fail-open | C102 |
| 载体↔父推关系源头窗（J1.39） | parent_relationship 四选——new_angle_on_original 豁免（父推可老）/translation_or_repost/explains_derivative/unclear；翻译/二手臂 ∧ 父推 lag>30d → timing 归 older；J1.137/C240：发行方自发宣告票翻译**同主体链**父推不拦 | C103/C240 |
| 中国政治主题否决（J1.122） | `bsc_meme_user_event_fit` 第 5 桶 `china_politics`（独立否决项不参与四档比较）→ mapper 确定性拦、无豁免链；C192b 官媒非政治内容不选本项；C248 反击性 meme（玩梗对象是辱华行为方）不选本项 | C192/C248 |
| 超IP原话票 + 实体门（J1.56） | 作者在册 ∧ 币名逐字主推文本 → `authorUtterance` 补位；**unacceptable_type ≥0.5 全域拦**（性质定义优先于认知度）；概念实体锚（圈内概念/行业热词=accepted） | C126/C247 |
| 空洞内容门（C114/C159）+ 无名口号臂 | **图证豁免**：empty_content ∧ imageEvidence → 不拦（C114b：image_depicts_name 明确 decorative ≥0.5 → 豁免失效照拦）；**无名口号臂（J1.110）**：无名作者单条口号/喊话/宣言→拦（veto 键=bsc_meme_user_event_impact；三排除锚=作者层级/梗主体/成型叙事）；**事件层优先（J1.111）**：两层同命中 empty_content 优先；通用梗缩写合格、机构职位缩写不合格 | C114/C159/C181 |
| 背景信息严重不足桶（C269） | impact 题第四桶 `background_info_insufficient`（三层优先序 背景层>事件层>代币层）：全部在场证据都无法建立「币名↔叙事内容」对应 → 概率 ≥0.5 → narrativeRating=9；同批 no_public_info/no_data 两域 low→unrated；**门链短路**+argmax 排除+Stage3 清零；**排除锚③（C269a）**：宣告推携带主体内容载体（视频/图宣告、大影响力转发指认）→ 不选本桶；技术失败形状保持 low | C269/C269a |
| 实体-事件影响力脱节（J1.124） | `entity_event_mismatch`：实体量级极大 ∧ 事件影响力极小 → 概率 ≥0.5 全域拦+pubProxy 豁免；门链 ne→em→we | C194 |
| 事件意义太小门 | **已拆出退役为独立观察题**（`bsc_meme_user_think_event_too_trivial_for_meme` 不进 blockAnswers 零门零评分；恢复拦截须用户裁定） | C231/C244 |
| Web2 旁观热点情感冲击门槛（J1.123） | Web2 圈外**旁观式热点**（无情感冲击也无可玩空间）→ 至多 marginal；边界=全球级可参与产品/公益纪念路径不适用 | C193 |
| Web3 用户切身相关事件锚（J1.136/137） | 事件主体是 Web3 用户群体集体行动/切身事务 → 受众完全重叠**至少 fit**；地域限定词不改主体归属；mapper `issuerTimingExempt`：issuerSelfLaunch 检出 C75 全量豁免、C103 收紧同主体链父推、C102 刻意不豁免 | C240 |
| 强情感冲击/动物救助路径（J1.96） | 真实广泛传播的公益/纪念故事（尤其流浪猫狗救助）→ 至少 fit；消费弱势真人苦难仍 unfit | C160 |
| 蓝筹去重门（C168） | 新票 name_exact 撞蓝筹库条目（ATH>$1M）→ mapper 门链**首臂**拦 low。豁免三臂：C173 新陈述（direct_tweet+作者在册）/C242 新事件（bluechip_event_identity new_event≥0.5 ∧ FRESH_TIMING，缺题 fail-保守照拦）/条目级 dedupExempt | C168/C173/C242 |
| fit 事件本体分量锚（J1.105/106） | 事件源自公共热点等**币外分量**时宣告者无名不减分；事件本体只是无名作者一句口号 → 至多 marginal；**空口号 vs 成型叙事边界（C175b）**：成型叙事（持续行为记录/有情节/被命名主体来历）正常评估；互动数字不作加减分依据 | C94-C106/C175 |

### Live 交易

- four.meme=`FourMemeDirectTrader`（TokenManager2），flap=`FlapPortalTrader`（Portal swapExactInput）；双平台 live=单引擎双 trader 同一钱包（live 参数恒读 fourmemeWs.live）；**买入不区分计价盘**（可行性由 estimateGas 天然保证）；卖出 token→0x0 全盘支持
- live 实验只能 `node main.js start-experiment -e <id>` 启动（run-engine 对 live 显式拒绝）
- 实收解析**余额差法**（买入 balanceOf 前后差=税后真相；卖出 BNB 差+gas 补偿）——对税币/非 BNB quote 盘免疫
- **flap minOut 锚取较低者**：`minOutAnchor = min(信号价期望, quote)`；Decimal 域取整
- **卖出 approve 大额一次授权**：`approve(spender, ethers.MaxUint256)`，条件结构保留 `currentAllowance < amountOutWei` 才发
- **live 记账精度钳制**：卖出方向差值 ≤相对 1e-9 → 钳到账面持有量重试，**全 Decimal 比较**；真超卖照常失败
- **全清腿记账精确清零 + 粉尘残仓清理门（T75）**：live 全清腿 PM 记账量=账面 Decimal 原值（`ledgerQty`）；粉尘门 `dustCloseValueBnb`（默认 1e-4 BNB，显式 0 关）：预期卖出所得 < 线 → 不发链上卖单，`_closeDustPosition` 就地清账+告警；externalDisposal 语义先于粉尘门
- **买入失败可观测性**：失败分支单次必打 warn + `tradeResult.reason` 落库
- 防御层（参数在 default.json `fourmemeWs.live`/`flapWs.live`）：L1 `assertMinOut`（卖出无锚 fail-closed 拒裸奔）/ L3 卖出熔断（连败≥5 → 30min 冷却+Telegram）/ **买入熔断**（连败≥3 拉黑至进程重启；只计发单后链上失败；「2 败 1 成」翻正清零）/ L5 `_awaitReceipt`（**绝不自动重发防双买**；WSS 快速回执默认开——自家 WSS 见到成交 tick 即轮询拿真 receipt，拿不到=让位原路径 bit 一致）/ `maxPositionTokens`（0=不限只拦新开仓）/ 毕业告警人工处置
- 钱包复用：web 创建 live 实验「复用历史钱包」下拉（`GET /api/live-wallets`，私钥永不回传；两端 ENCRYPTION_KEY 一致）
- runbook `docs/live-acceptance-runbook.md`；实盘恢复对齐 checklist 见 auto-memory（live-restore-alignment）；flap 毕业/非 BNB 盘卖出 revert 属预期 fail-closed

### Web / 数据库 / 配置

- Web：`src/web/` + `src/web-server.js`（3010）；K 线/现价走 wss_price_ticks（tick-kline-service）；AVE 工具端点保留；叙事 UI /narrative-analyzer、/narrative-tasks；TPA /experiment/:id/position-analysis；signals 页因子 chip+**门链五层展示（T175：①信号触发→②因子检查→③活跃度→④作弊→⑤BP 买点逐层徽章；段缺席=灰度关直通或前层拒未到达；AF1 独立卡片；JS 改动 bump 模板 ?v=；渲染冒烟 `scripts/tmp-signals-five-layer-smoke.cjs` 改 signals 页展示须跑）**；**API 现状页 /api-status**（apidance 剩余次数+SiliconFlow 余额+探活；60s 内存缓存）
- **RLS 坑**：SUPABASE_ANON_KEY 对 wss_price_ticks/wss_events/strategy_library 被 RLS **静默过滤成空**——远程脚本/routes 一律 `dbManager.getClient()`（service key）
- 删实验=DB 级联（每张实验归属表 experiment_id → experiments ON DELETE CASCADE，web 层只删行）
- 关键表：experiments / strategy_signals / trades / experiment_tokens / token_monitoring_pool / `wss_price_ticks`（UNIQUE(tx_hash,log_index) 首写者持有行；sender_address=tx.from；quote_token 标记 flap 非 BNB 计价盘）/ `wss_events`（token_create/graduation/token_quote_set 低频事件通道，token 级全局不挂实验）/ strategy_library / token_profiles / wallet_offline_profiles / token_position_analyses、narrative_analysis_rounds（CASCADE 挂 experiments）/ token_narrative / case_collections 四表 / gmgn_wallet_profiles / experiment_time_series_data（**停写**，历史保留）
- 链支持 BSC-only：其它链历史实验可读（未知 chain id 原样落穿），交易/配置查询非 BSC throw
- 配置：`config/default.json`（fourmemeWs/flapWs 段）/ `config/narrative-engine.json`（jev+engine 段，JSON 单一真相源）/ `config/.env`（ANKR_WS_URL / AVE_API_KEY / SUPABASE_URL / SUPABASE_ANON_KEY / ENCRYPTION_KEY / SILICONFLOW_FALLBACK_KEY 等）
- AVE API token 格式 `{address}-{chain}`（如 `0x123…abc-bsc`）；AVE 只用于 holder/预检工具与分析端点，不用于发现或价格

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

1. 改题面；2. bump 版本常量；3. 聚合语义变了同步对应 mapper；4. 跑定向重析对拍验证评级一致且无买线翻转；5. **case 与裁定同步台账**（卷四倒序追加）并**收录回归票**（`npm run case-regression -- --add <addr> --case C<n>`，预期变化票 `--update-expect --because` 留痕，工作流见 docs/case-regression-tool.md）；6. 部署前跑 `npm run case-regression` 全量对拍
