# CLAUDE.md

Richer-js：BSC four.meme + flap meme 币自动交易引擎（BSC-only）。代币发现与价格 = **实验进程内嵌 ANKR WSS collector 直连**（订阅 four.meme TokenManager + flap Portal，全事件驱动无轮询）：引擎直接消费 collector 内存回调，DB 落库（`wss_price_ticks`/`wss_events`）仅作持久化（回测/web/离线分析数据源）。支持虚拟（模拟盘）、回测（tick 回放）、live 实盘；内含叙事分析引擎（Jev 结构化决策模型）。

**本文只留现行机制、铁律与操作入口**；决策过程、case 复盘、验证数据、事故数字一律不写入：
- 叙事 case 全档案：`docs/叙事引擎改进与Case台账.md`（卷三 C56 起；卷二 C36-C54/卷一 C1-C35 = 同目录 `-卷二归档.md`/`-卷一归档.md`）；**每个新 case/改进须同步追加台账**
- 交易机制案档案：auto-memory（`~/.claude/.../memory/`，索引 MEMORY.md）
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

无测试框架/CI。单测文件=`scripts/_test_<名>.cjs`，**零 DB 零网络**（打桩 dbManager/provider/fetch），直接跑、断言失败退出非零；**改到哪块跑哪块**（事故背景见台账/memory，名字自述）：

- **采集/直连**：embedded_collector_architecture（引擎接线/stop 顺序/setExperimentId 防线）、run_engine_graceful_stop、experiment_instance_lock（双跑防线）、sender_resolver、fa_deferred_wallet_feeding、watcher_quote_conversion、recent_ticks_scan、early_replay_index、tick_buffer_watermark、wss_event_writer_retry
- **回测**：backtest_tick_cache、backtest_chain_order、backtest_keyset_paging（⚠锚定无序重构后存量失败待裁定，新形状由 tick_cache 覆盖）、backtest_narrative_gate、backtest_perf_probe、backtest_write_buffer_async、backtest_load_pool、backtest_preload_overlap、backtest_platform_parallel、fa_prefilter、backtest_fa_prune、backtest_tick_build_skip、backtest_trigger_leg
- **引擎机制**：card_position_mechanisms、holdings_replay_precision、stop_loss_rules、sell_leg_scan_fallback、prebuy_peak_backfill、graduation_sell_and_anchor、sell_debounce_mechanisms、token_pool_buytime、token_age_sec、activity_window_factors、fourmeme_fa_factors、fa_wallet_denomination、market_regime、live_prefilter_parity、permanent_block_cache、k_group_no_materialize、wallet_net_single_pass、signal_metadata_cache、token_pool_eviction、timeseries_removal、holder_series_rebuild、price_series_rebuild、fa_narrative_factors、fa_early_trades_factors、narrative_trigger_condition、account_health_monitor（C166 宣告账号四态检测）、account_recheck_engine（C166 引擎接线：懒解析/双档节流/竞态防线）、fa_issuer_account_state（C166 因子投影+卖臂真值表）
- **pre-buy/钱包**：sniper_factor（+sniper_cache_probe）、top1_buy_share、sender_switch_and_router、corpus_lag_factor、same_name_snapshot、gmgn_check_layer、gmgn_wallet_stats_service、gmgn_wallet_stats_layer、prebuy_known_factor_short_circuit、prebuy_creator_dev_cache、prebuy_overlap、copy_wallet_roster_factors、copy_roster_orphan_rescue、sybil_cluster_factor、wallet_profile_builder、wallet_scorer、tpa、tpa_live_ticks_trim、token_classifier
- **策略/条件/stats**：strategy_library_validate_legs、unknown_factor_reject、experiment_stats_fifo
- **web/数据服务**：trades_filter_columns（trades 过滤列名 PGRST 42703 事故形状反证）
- **live**：live_hardening、tx_seen_receipt、live_decimals_guard、live_executor_loading、executors_routes、manual_trade_queue、fourmeme_actual_received、nonce_manager、gas_dynamic、live_nonbnb_buy_allowed、buy_circuit_breaker、live_dual_platform、approve_max_grant、live_record_trade_clamp、flap_minout_signal_anchor、live_buy_failure_observability、logger_console_same_file
- **叙事链路**：precheck_fail_retry、narrative_signal_gate、narrative_memcache、narrative_preload、case_regression_lib（case 回归集断言器+收录/预期更新纯函数：四信封判读/expect DSL/CSV 转义/涨幅分层抽样 stratifySample；runner=`npm run case-regression` 重析对拍在 182 跑，票数随案渐增，抽样集 runner=run-sample.mjs，工作流=docs/case-regression-tool.md）、tweet_pull_optimization、narrative_timing_probe、narrative_parallel_fetch、ipfs_race（+C112 任意 http(s) meta 直链解包）、narrative_prefetch、same_name_appendix_shortcut、same_name_snapshot、narrative_leader_incremental、rule5_pass_through、data_fetch_failed_rating、issuer_ca_detection、narrator_two_shapes、unrated_elimination、isproject_coin_url_not_ca_hit、prestage_web3ip_account_only、prestage_project_downgrade、daily_parse_summary、news_monitor、narrative_middle_parallel、narrative_vision_prefetch、vision_gate、website_fetch_removal、precheck_parallel_queries、twitter_urls_expansion、twitter_bucket_overlap、http_keepalive、justoneapi_timeouts、narrative_repo_save_thin、narrative_save_sanitize（C144 lone surrogate/NUL 清洗）、jev_client_backoff、narrative_account_ttl、account_corpus_invalidation、narrative_retry_config、angle_timing_override、precheck_tweet_freshness_bucket、search_fallback、corpus_gate、corpus_ready_prefetch、gmgn_social_fetcher（CRO 案：GMGN 补源 raw 全量落库+5s TTL）、narrative_rounds_route、narrative_review_fixes、parent_tweet_metrics、isproject_coin_aggregator_urls、jev_question_consolidation（C109 J1.43 题集收敛）、superip_no_prestage_route（C117 超大账号强制标准路径+自发宣告粉丝门）、knowledge_base（C165 五件套：matcher 6 级规则/section 注入 bit-parity/loader 五文件合并热载/feedback 回写原子性/builder_core ATH 两形态+窗口纯函数）、bluechip_dedup_gate（C168 蓝筹去重：检测真值表+mapper 门链首臂+源码口径/熊猫头 alias 数据反证）
- **Jev 门/豁免**：publisher_proxy、web3_fit、web3_fit_anchor、cashtag_w_route、jev_product_entity、notable_other_exit、referent_memeability、subject_carrier、brand_hijack_pun_exemption、w_bsc_user_appeal、superip_standard_path、name_image_consistency、community_name_exemption、jev_resonance、jev_finding_recap_statement_gate、jev_regional_binance_anchor、empty_content_img_exempt（C114 DND 案：empty_content 图证在场豁免+J1.47 通用梗缩写锚）、emotional_impact_carrier（C160 动物救助/纪念 E 类强情感路径载体豁免）、massive_influence_carrier（C161 全球级爆火事件载体门豁免）、image_depicts_exempt（C118 DND 二轮：载体豁免演绎臂 image_depicts_name+J1.30 零污染）、image_carrier_nature（C167 梗王大乱斗：配图=所指物实录≠形象载体，图证豁免第四臂 fail-closed）、gmgn_risk_factors、gmgn_superip_tweet_enrich
- **抓取器**：instagram_pipeline、twitter_community_pipeline、tweet_image_analysis、web_fetcher_jina_fallback、youtube_fetcher

## 架构总览

### 入口

`main.js`（实验 CLI）/ `src/run-engine.js`（单实验）/ `src/web-server.js`（Web 3010）/ `src/narrative/engine/start.mjs`（叙事 worker）。

### 引擎与采集（直连架构）

- 三引擎（`src/trading-engine/implementations/`）：`FourMemeWssTradingEngine`（virtual+live 同体）、`FlapWssTradingEngine`（extends 前者）、`BacktestEngine`（回放同一因子-策略管线）
- WSS 订阅由实验进程自己持有：`_createCollectors()` per `_wsPlatforms()`（both=双 collector）；`factorsUpdated → OPB/卖腿实时/买腿 debounce` 管线
- collector 要点：
  - tick 三路输出（`_emitTick` 实时）：pool.updatePrice / tickBuffer 批量落库（500ms flush）/ FA.processTick；price_outlier 行入 buffer 前定值（首写者口径）；尘 tick（< minTickBnb）只落表不进因子；tickBuffer 水位告警**全程零 splice/shift/drop 绝不丢行**
  - `token_create` → FA.registerToken（meta 带 platform 键）+ `_handleNewToken`；`graduation` → `_handleGraduation` 毕业卖
  - `WssEventWriter`（共享单实例）持续写 wss_events：per-row 独立重试队列，**create 行丢=token 永久不可见，绝不丢事件**；`SenderResolver`（共享单实例，`config.senderResolve` 默认开）解析 `sender_address`=tx.from：EOA 缓存命中同步进 buffer，合约/未知走 RPC 回查，失败/溢出/停机 → NULL 保行不丢（绝不冒充）
  - **FA 两阶段喂食**（resolver 开启时）：submit 前 `_feedFa(…, {deferWallet:true})` 先喂**价格段**（WSS 到达即喂——fire 价/lastTickAt 不被 RPC 回查延迟与乱序污染），pushRow 回推时 `_feedWallet` → `FA.applyWalletTick` 补 **wallet 段**（holders/K 组/GMGN routedBuy/smartBot 用真 sender 精确计数）。EOA 快路两段同 tick=零时序差；合约行乱序回推，wallet 聚合任意序重放收敛；无 resolver 直推路径单段零变化（回测同）
  - **chainLate 迟到旧价拦截**：`_lastChainBlock/_lastChainLogIdx` 复合水位，`block < last || (== && logIdx <= last)` 判迟到（`<=` 含同位重复行）→ 跳过 outlier 判定/价格追踪/可靠价链（`_acceptPrice` 有副作用须短路防窗污染），流量/滑窗照计；链证据缺失 fail-open；`lastTickAt` 取 Math.max 不回拨
  - **holderTrend 双路径**：非 defer（直推/回测正序）`_pushHolderSeriesPoint` 覆盖快照；defer 路径 `_recordHolderEvent` 事件环形缓冲（≤64），消费点 `_rebuildHolderSeries` 逆向撤销 touched 钱包窗内 delta 再按 block 稳定排序正放（唯一序无关解）
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
6. flap QuoteSet 映射持久化：非 BNB 计价盘 token→quote 实时落 wss_events（kind='token_quote_set'）；collector 启动 `_loadQuoteMapFromDb` 重建终态（乱序行按 blockNumber,logIndex 排序应用），回放窗 [水位-100, head] 补停机缺口，回放结果不落库；DB 空首启走 `flapWs.quoteRate.fullBackfillMinutes`（默认 43200）。汇率三级源（PCS V2 reserves → PCS V3 最深池 slot0 → V3 quote/USDT ÷ bnbUsd）；零流动性 V3 池挂价不可信必须拦；三级全 miss 跳行宁跳不冒充；BNB 盘 quote_token=NULL

### BacktestEngine

- **token 集合 + platform 口径**（不按 experiment_id）：地址 100/批 `.in` + platform **单值 `.eq` 循环**（`.in` 多值 planner 弃索引超时）；分块拉取后全局**链上真序 `(block_number, log_index)` 归并排序**（bigserial 分配序≠提交序，`sort(id)`=前视；倒退 block_time 行 WARN）
- **ticks 装载缓存** `src/trading-engine/core/BacktestTickCache.js`：粒度 `(sourceExperimentId, platform)` 一文件 `data/tick-cache/backtest/<src>/<platform>.jsonl.gz`+.meta.json；**缓存存全量、运行期过滤**（任意窗口共用、与直拉 bit-identical）。状态机 MISS/FRESH/STALE/bypass（探针失败直拉）/表回缩。**探针与装载都必须锚定无序形状**（`id > 锚` + 无序 limit；`ORDER BY id` 形状 planner 弃索引 8s 超时）；装载闭区间 `.lte(id, headAnchor)` 封死中途新写入；`maxTickRows` 默认 100 万，**多天大窗口须实验级显式放宽**；加列=全量重拉一次（设计内）；磁盘无自动清理。**P15 delta 侧车**：STALE 增量落明文 `<platform>.delta.jsonl`（tmp+rename 原子重写；meta 行数不符/文件缺失=损坏 drop 重拉；撕裂尾读满 meta 行数即停+下次幂等自愈）；delta ≥30 万行才全量合并重压缩
- **graduation 回放 + 止损双腿**（虚拟↔回测一致性）：`_loadGraduationEvents` → 主循环 `_consumeGraduationEvents(tickTs)` 消费指针（未持仓仅推进；卖出失败不推进=每 tick 重试）+ 收尾 drain + 买入成功点补卖 → `_emitGraduationSell` 等价全清（幂等标记后置到卖出成功）。**`_graduatedTokens` 标记在消费点填充，禁止装载即填**（前视防线）。止损 `_stopLossHit` tick 路径优先于策略腿 + `_scanHoldingsStopLoss(tickTs)` 节流扫描兜底断流票
- **`backtest.stripSenderAddress` 对照臂**：剥内存 tick 的 sender → 消费侧 COALESCE 全部回退 trader（=修正前 bit-identical；不动缓存 raw 行）
- **`backtest.tickBuildSkip` 默认开**：出窗票 `FA.shouldSkipTickBuild` 跳过 build、买窗内 C 类票喂最小 factors（fire 时 `_runBuyEvaluation` 独立全量重建，快照白名单不受影响）；显式 `false` 恢复旧行为；act\* 纯函数读取天然兼容
- 回测不嵌 OPB；`_alignClassifiedAsOf=true`（TPA 防前视）；叙事直调同链路（时漏已知，只比相对增量）

### 双平台实验（platform='both'）

- 单引擎 per-token 分派：`_handleNewToken(info, platform)` 按 collector 回调平台分派 record builder，共用买卖策略与单一资金池
- 归一化唯一入口 `resolvePlatforms(platform)`（`src/trading-engine/core/platforms.js`）：'both'→两平台，其余→fourmeme
- virtual+backtest+live 全支持（live=单引擎 per-platform trader map——fourmeme→FourMemeDirectTrader / flap→FlapPortalTrader 同一钱包，非首 trader `shareSignerFrom` 共享 wallet+NonceManager=同地址单一 nonce 源；`_liveTraderFor(tokenAddress)` 按池/FA 平台标记分派，未知平台 throw fail-closed）
- 引擎级配置恒读 fourmemeWs 段（`_wsConfigSectionName()`，flap 子类才覆盖 flapWs）；**实验级 ws 配置键 flap 实验经 `_mergedWsConfig` 与 fourmeme 同键生效**（gmgnCheck/gmgnWalletStats/narrativePrefetch/narrativeRetry/faPreFilter 等下文不再重复注记）；创建页平台选择=多选 checkbox

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

**earlyTrades\* 双宿主**：新宿主=FA 出生锚定累计窗（`firstTickAt` 锚、`earlyTradesWindowMs` 90000、首个出窗 tick 冻结快照、10 键——单一买条件直接消费，三态同源）；legacy 宿主=preBuy DB trailing 90s 窗（旧腿）。口径 delta：①FA trader 层无 outlier/price_usd 过滤照计 ②尘埃门 0.01 只影响 uniform 簇 ③协议双地址层剔除只作用于 top1 ④null wallet 行进分子不计人 ⑤defer 价格段先行收敛 ⑥5000 钱包帽只停新入册

| 因子族 | FA 口径（新宿主） | legacy preBuy 口径（旧腿） |
|---|---|---|
| earlyTrades{PerWallet,MaxWalletTrades} | 累计窗行数÷钱包数 / 单钱包最大笔数（尘行照计分子） | （无此键） |
| earlyTradesNetBuyRatio | (买−卖)÷买×100，全卖=−100 纯买=100 | （无此键） |
| earlyTradesTop1BuySharePct（+Top1BuyBnb/BuyBnb） | 纯买 BNB 按钱包聚合最大占比（协议双地址层剔除；刻意不含卖腿） | 同名键 trailing 窗+covered |
| earlyTradesRouterPct | **trader 层**聚合路由买入占比（无尘埃/协议过滤） | 同名键+covered |
| earlyTradesUniformBuyCluster{Ratio,Wallets,N} | 尘埃门以上钱包等额簇占比 | （无此键） |
| earlyTradesSniperHoldingPct（+SniperWallets/SniperHolders） | （无此键） | sniper 正持仓 Σ/池 Σ×100（`isSniperProfile` 见 `pre-check/sniper-detector.js`；画像 miss=非 sniper）；拦截伴随 SnipersWallets ≥2 |
| narrativeCorpusLagSec | FA 出生锚−语料最新推文时间（主推/父推/第二推文取 Math.max）；负值=宣告竞态按早票放行；null=无语料/无锚 | **纯观察键**（照落 metadata）；时效硬拦在叙事 precheck 分桶（速查表 C74/C104 行） |
| strictSameNameTokenCount | **回测=as-of 快照优先**：实时引擎成功后 append 写 `ave_same_name_snapshots`（6h 节流，全局资产不挂实验 FK）；回测取 `searched_at<=asOf` 最近快照，miss 才兜底实时且行级过滤未来行（宁拦不冒充） | `>= 3` 拦 |

- **covered 语义**（top1/router/sniper 同构）：age>90s 或 launchAt 缺失 → 0 值放行（null 会让 `<N` 恒 false 误拦）

### 买腿链路（C84）与 GMGN 条件（`gmgnCheckCondition`）

买腿两模型并存，**按腿激活**：腿携带 `narrativeTriggerCondition` → 新模型；否则 legacy（触发 fire `condition`+`narrativeCallCondition` 直调 → preBuy 预检查 → GMGN）。

- **新模型（C84）**：`叙事发起条件（FA 因子表达式）→ 后台多轮叙事分析 → 单一买条件（condition，含 narrativeRating == 2 OR == 3）→ GMGN 条件 → 执行`。全部因子在 fire 时刻同一 FA 因子表上评估，virtual/live/backtest 三态同源，消除两阶段因子漂移
- GMGN 条件（两模型共用）：前序条件全过、确定要买时才构建=**此刻才真调 GMGN getTokenInfo**（配额最小化+数据新鲜；repeat 轮与首轮同一条件串）
- `GmgnRiskCheckService`（`pre-check/GmgnRiskCheckService.js`）：5s 超时 / per-token 5s 成功 TTL（0=每次硬调）+ inflight join / 失败 10s 冷却；**只认自己 fetch 的结果**（不读不回写叙事缓存，防 TTL 污染「买前新鲜」语义）；配置 `fourmemeWs.gmgnCheck`
- **fail-open 放行**（2026-10-20 乌龟案裁定，原 fail-closed 翻转）：API 失败/超时/未索引/key 缺失/冷却 → covered=0 → 放行（不评估表达式，`evaluated=false`+reason 留审计，日志打「GMGN 无数据放行」）——GMGN 是附加风控层，API 不可用不得拦住买点（事故：GMGN IP 级 RATE_LIMIT_BANNED 三连拒买、恢复后 47s 才成交）；同时与 preBuy 键集 gmgn 三键 covered=0 放行语义一致。**条件表达式评估异常（键集外/语法）仍 fail-closed 拒**（配置/实现错误，与 API 不可用刻意不同）
- 因子五键 `gmgnBundlerWalletRatio/gmgnIssuerTokenCount/gmgnRiskCovered/gmgnVisitingCount/narrativeCategory`（前四键 `mapGmgnRiskFactors` 单点映射；风险提取 `src/core/gmgn-api/risk-fields.js` 与叙事侧共用；visitingCount 观测键**刻意不参与 hasAny**；narrativeCategory 非 GMGN 产物——从 fire 因子表透传，回测同位 spread）
- **叙事类型 × issuer 分档门（C85）**：适用集 `{project, account_based_meme, web3_native_ip_early, event:W}` 内 `gmgnIssuerTokenCount <= 1`（serial issuer 拦截），事件/梗/名人类不适用；**null IS NULL 臂放行 fail-open**（null→0 同覆盖 fire 未就绪形状——fire 时刻 GMGN 未填充显 0 是常态）；条件串必须带 `narrativeCategory IS NULL OR` 前置臂（裸比较对左值 null 恒 false 误拒，单测锁死）
- 回测挂点**不真调 API**：消费直调快照 `narrativeCallInfo.gmgnRisk` → 同款 `evaluateFactors`（快照缺失同 fail-open 放行，与实时同判）
- **GMGN 钱包画像层（C89，默认关 `fourmemeWs.gmgnWalletStats.enabled`）**：fire 时刻 early 窗 top-N 买家（FA `getEarlyTopBuyers`）查 `gmgn_wallet_profiles` 表（PK 毫秒级；离线建库优先）→ `GmgnWalletStatsService` 聚合 gwp* 18 键并入 `checkAndEvaluate` **第五参**（null/缺省不并键=存量零影响）。离线建库=`scripts/build-gmgn-wallet-profiles.cjs`（182 跑；**GMGN 无记录空数据行也落表**=已确认结论防重复烧配额）；触发窗增量回写=引擎 `_walletProfilePrefetchCheck` fire-and-forget 预取 miss 钱包；fire 补查上界 refetchBudget=2/missJoinMs=1500/日预算 2000/失败与 RATE_LIMIT 冷却。**gwpCovered 三态**：selected=0（出窗冻结/无买家）→ null 放行；任何钱包无结论 → 0 fail-closed 拒（token 层 2026-10-20 已改 fail-open，gwp 层是否跟进待用户裁定）；全结论（含空数据行）→ 1。指纹=三臂簇状：同分钟创建簇（created_at_sec 滑动窗 300s，**不用固定分钟桶**）+ 近镜像容差 + young/fresh（created_at 龄≤7d）；**零正向放行键**；gwpGmgnUserPct 仅观察。回测不接线（动态计数对历史 fire=时序穿越，跳过比穿越诚实）。**Phase 1 观察模式（gwp 键只落 metadata 不进条件串），Phase 2 门生效另行裁定**；DDL `migrations/create_gmgn_wallet_profiles.sql`（目录不进 git），部署序列=DDL→离线回填→才可开实验级 enabled
- 库 buy-v2 门：`gmgnBundlerWalletRatio <= 75`；signal metadata 落 `gmgnCheck` 审计轨迹（拒/过两路径）

### C84 叙事触发模型（`narrativeTriggerCondition`）

- **触发状态机**（引擎 `_narrativeTriggerCheck`，挂 `_onFactorsUpdated` 买腿分支 N3 同位）：per-token `{rounds,inFlight,hasInitial,lastRating,lastCompletedAt,accountOnly,corpusEmpty,currentRowId,category}`；tick 时刻评发起条件 → 过门发起后台 `getRating`（fire-and-forget)；首轮 reason='condition'（token 级缓存秒回），补轮 reason='retry' 仅当 lastRating==1 ∧（accountOnly ∨ corpusEmpty（C162 零自有语料臂——`hasNoOwnedCorpus`：classifiedUrls 各桶全空=宣告推/GMGN link 晚到竞态，走 noCorpus* 独立节奏））∧ rounds<maxAnalyses（按臂选参，双臂同真 accountOnly 优先）∧ 距完成≥intervalMs（判据与 FA narrativeRetryDue 逐字一致，双侧冗余把刻意的）；补轮带 `overrideOptions:{ignoreCache:true, invalidateAccountCorpus:true}` 走 '!ttl' inflight 槽。每轮发起/完成即 `FA.setNarrativeFactors` 投影；完成回填 identity 校验（states.get !== st → 只收尾不投影）。**重启全内存语义**（rounds 按进程计）
- **FA 叙事四键**：`narrativeRating`（null|1|2|3|9）/`narrativeRounds`/`narrativeRetryDue`（=1 当且仅当 rating==1 ∧（accountOnly ∨ corpusEmpty）∧ !inFlight ∧ rounds<maxAnalyses（按臂选参）∧ now−completedAt≥intervalMs（按臂选参），**now 用 buildFactorMap 入参禁 Date.now**）/`narrativeCategory`（token_category 同形状，GMGN 分档门因子源）——模块级 Map（RAW tokenAddress 键）；config 由引擎 ctor 从 `narrativeRetry` 段投影（四键全传）。rating null/1/9 ⇒ 单一买条件恒 false ⇒ 天然无信号（**unrated 放行政策在新链路废止**）
- **轮次留痕表 `narrative_analysis_rounds`**（CASCADE 挂 experiments；insert/update 观测 fail-open）；查询 `ExperimentDataService.getExperimentNarrativeRounds` + `GET /api/experiment/:id/narrative-rounds`（service key 红线）
- **互斥 fail-fast**：同腿 `narrativeTriggerCondition` ∧ `narrativeCallCondition` 均非空 → loadStrategies throw / validateLegs 400（新模型腿天然跳过 legacy 直调/预检查/拉黑短路——字段存在性即门）
- **回测口径**：无状态机；`_preloadNarrativeRows` 门扩至 trigger 腿 + FA 常量注入（非 1/2/3 归 9；**rating=token 常量=已知时序穿越，结论只看相对增量**）；ctor `setNarrativeFactorConfig` 四键全锁 `{intervalMs:Infinity, maxAnalyses:0, noCorpusIntervalMs:Infinity, noCorpusMaxAnalyses:0}` 锁死 retryDue；fire 链 trigger 腿不评触发条件直接 getRating 仅为取 gmgnRisk 供 GMGN 快照层；**不登记拉黑/不算 lag/不跑 P4b 与同叙事龙头检查**；stop 清 FA 注入防下轮回测继承
- **dataPrefetch/visionPrefetch 退役**（机制整链删除）：存量实验带该段=静默丢机制（上线前 SQL 核查 running 实验）；ipfsCacheWriter 注入保留
- **刻意行为变化（用户裁定）**：①rating=9 拦截（旧 unrated 放行废止）②sniper 持仓/同名簇观察键不再采集 ③同叙事龙头检查不跑 ④`_narrativeBlockedTokens` 不消费（条件即门，retry 上限即调用预算）⑤earlyTradesPerWallet 分子偏 SQL 行数略低 → `<4` 门偏放行（首月观察）
- **关键不变量**：发起条件量门 < 买条件量门 ⇒ 分析必然先于买门可满足而发起（库条目维护该序）；N3 与触发模型 per-leg 互斥共存（trigger 腿无 call/prefetch 条件 → N3 天然 no-op）

### 条件未知因子 fail-fast（三层防线）

写错因子名的条件子句静默恒真/恒假（比较恒 false / IS NULL 恒 true），必须拒启而非 warn：① `ConditionEvaluator.validateCondition` 含 IS NULL/IS NOT NULL operand 检查；② `StrategyEngine.loadStrategies` 校验失败 **throw**（`condition`/`narrativeCallCondition`/`narrativeTriggerCondition` 用 FA 因子集——trigger 与 call 同腿共存=互斥 throw；`preBuyCheckCondition`/`repeatBuyCheckCondition` 用 PreBuy 键集；`gmgnCheckCondition` 用 GMGN 键集——分集防双向误报）；③ `StrategyLibraryService.validateLegs` 入库同口径 400。上线前跑 `scan-unknown-factor-conditions.cjs`。

### FA（`src/services/FourMemeFactorAggregator.js`）

- `_buildFactorMap` 字面量键（`getFactorKeys()` 探针自动收键）；`tokenAgeSec`=`age×60` 同源双路径，preFilter 提取 /60 归并 age 区间，快照白名单落库
- **跟单簇名单 + `maxCopyWalletHolderCircPct`**：`config/rosters/copy-wallet-roster.json` 模块级 Set（sniper/smartBot 同款 loader）；因子=名单钱包**单钱包最大**净持仓÷流通（刻意最大非合计）；名单 null→恒 null→`<N` 门恒 false=**fail-closed**。生成=`scripts/scan-copy-trade-clusters.cjs`（pair 统计缓存 `data/offline-cache/copy-trade-pairs.json.gz`，`--from-cache` 调参零网络）；维护=182 重跑 `--commit` → push → 重启实验生效（静态快照，滑掉的手工钱包人工保留）
- **极著名钱包名单 + `famousCopyWalletCircPct`**：`config/rosters/famous-copy-wallets.json` **独立于主名单**（scan --commit 不影响它；增删用户裁定）——被跟单特别重的钱包单独更紧的门（<15，主门 20）；**0 语义**（2026-10-22 用户裁定去 NULL「最低是 0」）：集合 null/空/无命中→恒 0→条件串裸比较放行（无 IS NULL 臂）。fire 就绪度依赖 sender 回查（GMGN 路由行 wallet 段回推 1-3s，fire 前最后 1-2s 行有竞速缝隙）。**五腿集中度组 v30 起无条件 AND**（2026-10-22 用户裁定：famous<40 豁免臂删除——被 famous<15 独立门蕴含，v29 形状 287 票 famous≥40 零出现=五腿死代码）；库 buy-v2 v30 起平铺无豁免
- **sybil 大簇合计 + `sybilClusterHolderCircPct`**（2026-10-20 乌龟案用户裁定，C84 后首个合计口径集中度门）：`config/rosters/sybil-clusters.json`（`scripts/build-sybil-clusters.cjs` 从 14 天 pair 缓存建「强边 co≥50 且 同步卖/等额≥0.5 → 连通分量 size≥3」，182 `--commit` 生成；**独立文件**，重跑 scan/主名单不影响）——因子=**簇内钱包合计**正净持仓 ÷ 流通 ×100。补主名单盲区：主名单 `memberNeedsLeader`+minFollowers 剪掉「三五钱包闭环抱团、谁都不算 leader」的 sybil 小簇（乌龟案四钱包 co=116~165、同步卖 84~142、等额买 88~122 却不在 350 名单）；单钱包口径对分仓簇天然漏检（四钱包 fire 时单钱包 10.4% 过 famous 15 门，合计 38.9%）。**0 语义**（2026-10-22 去 NULL 裁定，同 famous）：文件缺失/空集合→恒 0→条件串裸比较放行（无 IS NULL 臂）。阈值 `<35`（v22-v24 111 票回放：拦 26 票、误伤 5 正票 +0.0011、被拦净 -0.0217=总亏损 58%，v22/23 与 v24 两子集断崖一致；v30 起 bundle 同锚 35）；库 buy-v2 v25 起部署、v30 去臂；维护=重扫 pair 缓存后重跑生成脚本 `--commit` → push → 重启实验进程
- **preFilter live 平移默认开**（`fourmemeWs.faPreFilter !== false`）：从各买腿 condition **AST**（必须 AST 直传，String() 化恒 null 静默失效）提取 age 区间注入 `setPreFilter`——出窗未持仓票 build 返回 null → 不 emit factorsUpdated（零 per-tick 评估，与回测 tickBuildSkip 同族）。持仓豁免=`_positions.size===0` 结构性保证。build 内部等价削减：K 组对敲两趟无 Set 物化、`_walletNetTokens` 三趟合一——bit 一致对拍锁定
- **act\* 8 键滑窗**（`activityWinMs` 默认 10000，`fourmemeWs.factorParams` 可覆盖）：`actBuyBnb/actSellBnb/actNetBnb/actTrades/actTraders/actBuyers/actSellers/actNewTraders`；wallet=sender||trader（null wallet 行计量不计人）；actNewTraders=首见时刻也落窗内的钱包数；写点 `_applyWalletAggregation` 尾部（摊销裁剪：>64 且头部越过 2×窗才 splice，2× 余量保护 defer 乱序晚到行）；读点纯函数（空窗全 0=有证据零值非 null）；照计语义（与 tradeCount 同口径）；**禁 Date.now（now 由 buildFactorMap(state, asOf) 传入）**；序列不可重建，FactorBuilder 两处快照透传（不落库即丢）
- **holderTrend slot 化**（11 键·历史断代）：原料序列=blockNumber 桶×8 块≈4s（同块覆盖/8 块封顶；W=8 与 HolderTrendDetector maxPoints=8 **必须同改**）；与价格接受链**解耦**（离群/零价 tick 照推进）、blockNumber 缺失不推进；价格 `_priceSeries` 10s 桶不变（trend 族）。门槛：growthRatio 族 ≥2 点、slope/direction 族 ≥4 点；slim 快照含 11 键（序列不可重建）

### 策略库

- `strategy_library` 表（全局，name UNIQUE/side 锁死/legs jsonb/version 乐观并发 409）；创建页「从库引用」=**只读快照卡 copy-in**（实验 config 自包含，改库不影响已建实验，改库须重启实验进程）；`strategiesConfig.libraryRefs` 纯 provenance
- **routes 必须走 `dbManager.getClient()`（service key）**——anon 被 RLS 静默过滤；**部署红线：DDL 先于新 web-server 重启存在**
- **groups/cycle 已废**：`loadStrategies` 遇腿带 groups（非空）/cycle 字段 **fail-fast throw 拒启**（静默失效=腿恒可见是危险方向）；引擎 strategyArray 刻意原样透传两字段供 fail-fast 识别，**不得剥除**；存量库条目在库页重存/导入时前端自然剥离；活跃度维度改用 act\* 滑窗因子
- 创建页只读化：腿只能来自库引用；`card.dataset.rawConfig` 整包存取；复制链路高级段（stopLoss/tokenPositionAnalyzer/fourmemeWs）经 `window._copyAdvancedConfig` 回填保真；卖腿平铺展示、提交序=DOM 序

### 卡牌 / 止损 / 毕业卖（引擎级机制，实验 opt-in）

- **卡牌**：开关=`positionManagement.perCardBNB` 存在且 >0（不配=字段全忽略）。策略级 `cards`（卖腿额外接受 'all'）+`cooldownSec`（独立于卡牌）。买入=perCardBNB×cards（virtual 现金门不足=买失败不降张）；卖 sizing soldN/tokenCards（全清腿恒精确 1）；卡账本 `_tokenCards` 维护在 `_executeSell` 成功分支，trades.metadata `cardTrade:{cards,before,after}` 绝对值重放恢复。**重放精度钳制**：遇 `Insufficient token balance` 且差异≤相对 1e-9 → 钳到持有量重试；真超卖照常失败且**单票失败只跳过不中断其余恢复**
- **止损双腿**：开关=`stopLoss` 段存在任一腿参数。时间止损（持有超 N 分钟仍 `profitPercent <= 0`——`<=` 刻意：断流冻结票 profit 恒 0）/价格止损（`<= 负阈值`）全清，双命中标 price。双挂点=tick 即时（优先于策略腿）+ `scanIntervalSec` 扫描（**断流票唯一触发路径**，buildFactorMap 必传 Date.now()）；`_emitStopLossSell` 复用策略 `stopLossPrice/stopLossTime` 全清链；仅虚拟系引擎（回测有自己的版本）。用户裁定「所有卖出归卖出策略管」：现行实验以卖腿表达止损（bypass=false 走确认窗、刻意不设 maxExecutions=卖出失败每轮重试直到清仓）；其余带 stopLoss 段实验不动
- **持仓卖腿兜底扫描**：`_scanHoldingsStopLoss` 除止损外新增卖腿评估——断流票（>60s 无 tick，FA `lastTickAt` 判据）调 `_evaluateSellPath`（bypass 腿立即卖/默认腿 touch 确认去抖）；活跃票不评。启用=存在卖腿；周期 `stopLoss.scanIntervalSec ?? sellScanIntervalSec ?? 30s`；stopLoss 段启用但未配 scanIntervalSec 的存量实验止损仍仅 tick 路径（存量语义不变）
- **账号信息复检卖臂（C166，默认关 `fourmemeWs.accountHealthCheck.enabled`）**：持仓期检测宣告账号删号/删推（rug 前兆早于价格）→ FA `issuerAccountState`（'active'|'deleted'|'tweets_gone'|null）→ 卖臂条件全清。检测=`AccountHealthMonitor` 裸调 apidance（**绝不走 TwitterFetcher 缓存层**——失败 1h 冷却会吞删号信号）；删号只认「用户不存在（空响应骨架）」特异 message、删推严格 tweet_id 全等（getTweetDetail tweets[0] 兜底坑）、故障归 unknown 投影 null fail-open；引擎 30s interval 扫描+懒解析 token_narrative.twitter_info（负缓存防重查）+双档节流（前 10min 每 30s/之后每 2min）+回填竞态防线+清仓自清理+再买入重置；回测零接线因子恒 null（时序穿越防线）；库卖腿条目 `rug-exit-account-arm`（bypass=false 双门确认，已上 v29）
- **买锚 fire 价口径**：FA `buyPriceBnb` 定在买信号 **fire 时刻**（`_runBuyEvaluation` 捕获 `factorResults.currentPriceBnb`），profitPercent/peakProfitPct/drawdown 族全程按 fire 价起算；记账锚 `buyPriceUsd` 不变（live=实际成交价/虚拟=signal.price）；fire 价缺失回落执行时刻价；回测 fire==执行同 tick 天然一致；重启恢复锚点与手工锚点不动
- **fire 窗峰值回填**：fire 点 `markBuyFire(token, firePriceBnb)` 开 pending 双轨峰（peakAny=任意接受价/peakRel=可靠价，outlier/chainLate 不推进），买入成功 `setBuyState` 消费回填；失败 finally `clearBuyFire` 兜底；**无 pending 标记时 setBuyState 逐位退化为旧行为（回测 parity 红线）**
- **双时长 + 执行口径键**：`holdDuration`=信号（fire）时刻起算（`buySignalAt` 缺省回落 buyTime=旧形状 bit 一致）；`realHoldDuration`=成交时刻起算（物理持有）；执行键 `buySignalAt/buyExecutedAt/buyExecutedPriceBnb`（live=余额差法成交价，虚拟/回测=null 诚实语义）。`_stopLossHit` 时间臂读 `realHoldDuration`（保命腿=物理持有）；策略腿内 `holdDuration` 保持信号口径，P4 市值清仓腿须显式 `realHoldDuration > 10` 保住「成交后 10s 缓冲」原语义
- **毕业事件驱动卖**：virtual 持仓票 `_handleGraduation` → `_emitGraduationSell` 全清（幂等标记后置到卖出成功；graduation 事件会重复派发）。三挂点：事件路径 + 买入成功点补卖（FA `graduated` 标记竞态）+ 扫描兜底（事件路径失败的唯一重试）。**flap 毕业锚 per-token**：`graduationProgress` 分母=首市值×`graduationAnchorRatio`(12.5)，仅首 tick 距创建<60s 启用否则退 72 默认锚；platform 经 registerToken meta.platform 注入（迟到 registerToken 回填更早 createdAt → 窗变大自动退锚）；BacktestEngine 恒 72。live 毕业=Telegram 告警人工处置（毕业卖出必 revert）

### 信号机制

- **strategy_signals 进程内缓存**（AbstractTradingEngine `Map<signalId,{row,metadata}>`）：缓存命中→本地 merge→UPDATE→**成功才提交缓存，失败 delete 回退 SELECT**（绝不以缓存遮蔽落库失败）；终态落库后 delete（有界）。前提：实验进程是 signal 行唯一写者
- **永久阻断条件编译缓存**：`new Function` 结果按 `${jsExpr}\0${keys}` 模块级缓存，catch fail-open
- **去抖**：买腿 `signalDebounceMs 200 / signalDebounceMaxWaitMs 1000`（slot 级合并：200ms≈0.25×BSC 0.75s 出块）；卖腿确认窗 `sellDebounceMs 3500` + **双门槛确认** `sellDebounceMinTicks 5 / sellDebounceMaxWaitMs 120000`（首真起计**不重置**、窗口内恢复 clear 不卖、fire 重评仍真才卖；minTicks>0 时 fire=时间窗 AND 窗后新 tick 数——**断流票窗内零 tick 不得按陈旧快照卖**，timer 到点证据不足转等待、后续 touch 凑齐即时 fire（real），maxWaitMs 首真起计绝对上限强制逃生（fire 仍重评，翻假不卖；stats.forceFired 计数）；minTicks=0 缺省纯时间语义存量 bit-identical；virtual advance 同口径但死票时钟静止=回测偏保守缝隙）；bypassDebounce 腿/引擎级止损/毕业卖/强平走立即路径——**现行全部卖腿（含止损臂）按裁定 bypass=false 走 3.5s+5tick 双门**。实验级键可覆盖，跑中实验须重启进程生效
- **叙事直调** `narrativeCallCondition`（legacy 腿）：fire 因子满足（不含 narrativeRating 自身）→ 拉黑检查后、pre-buy 前同步 `NarrativeAnalyzer.analyze()`（`pre-check/NarrativeDirectCaller.js`）；Jev 秒级，30s Promise.race 超时（超时后台续跑落缓存，下轮命中）；失败/超时 normalize 9 放行——由 `preBuyCheckCondition` 里 `narrativeRating` 决断。**语法 AND/OR only，`&&`/`||` 被静默截断**。轨迹落 metadata `narrativeCall`（含 timing 分段）
- **叙事预触发（N3，legacy 腿专属——trigger 腿天然 no-op）**：开关=`fourmemeWs.narrativePrefetch.enabled`（**默认开**：删段=开、显式 false 才关；回测不适用有 preloadCache）；tick 时刻评估首条买腿 `narrativePrefetchCondition ?? narrativeCallCondition`（不配=用现有条件；没配叙事条件的腿恒不预取），满足且未 write-once → 后台 `getRating`。与 fire 直调共用同一 DirectCaller（inflight join/缓存秒回，fire 侧零改动）；write-once per-token 无论成败；rating=1 提前登记 `_narrativeBlockedTokens`
- **叙事一票否决**：直调 `numericRating=1` → 内存 `_narrativeBlockedTokens` 拉黑（后续 fire 写 signal 行前短路：无信号无重复调用）；豁免=`precheckStage === 'address'`（宣告竞态）且 age<300s；rating 9 永不拉黑；内存态重启丢、首 fire 经缓存重建
- **账号型 TTL 穿透重析**：语料入口只有账号（`isAccountOnlySource`）且 rating=1 的缓存行，行龄≥TTL → 穿透 `analyze({ignoreCache:true, invalidateAccountCorpus:true})`——失效 external_resource_cache 账号三键（user_info/user_tweets/…:ca；userId 从失效前旧行读；`twitter_account` 层刻意不失效）；失效下沉 getAccountWithFullTweets 内部且带同款语料形状门；per-token 真跑上限（缓存命中不计）；穿透走独立 '!ttl' inflight 槽；观测 `ttlReanalyze`
- **叙事重试配置 `fourmemeWs.narrativeRetry`**（默认开 `enabled !== false`——删段=开）：`intervalMs` [1000,600000] 缺省 10000 / `maxAnalyses` [1,50] 缺省 3（**计含首析故名 maxAnalyses 非 maxRetries**）/ `windowSec` [60,7200] 缺省 300（⚠️**不得低于 worker retryWindowSec**——拉黑先于末次重析翻正=误拉黑且无撤销路径）/ `noCorpusIntervalMs` [1000,600000] 缺省 60000、`noCorpusMaxAnalyses` [1,50] 缺省 8（**C162 零语料臂独立节奏**——60s×8=8 分钟窗覆盖宣告推/GMGN link 分钟级晚到；仅 corpusEmpty 臂消费，双臂同真 accountOnly 优先）。C84 兼供触发轮（四键投影 FA narrativeRetryDue 与状态机）；BacktestEngine 零接线（回测禁穿透/禁补轮=语料前视防线）；UI 物化语义：显式关写 enabled:false、开+数字写段（浅合并）、回测剥离（noCorpus* 无表单项，复制链路浅合并原样携带）
- **叙事结果=token 级全局缓存**：`token_narrative` 按 token_address upsert 跨实验共享；失效=行删或 `NarrativeRepository.updateIsValid(addr,false)`；**历史窗口回测前先失效缓存**（题集变更后旧缓存行缺新题答案）：`scripts/narrative/invalidate-referent-window.cjs` / `invalidate-carrier-window.cjs`（&lt;基底实验ID&gt; --commit，范围刻意只收窄基底买过的 token）
- `token_category` 列写入：`deriveTokenCategory(prestage, stage1)`；终态重析无分类（precheck fail/no_data）由 final save 显式 `clearTokenCategory` 置 NULL——**重跑必须反映本次判定**（C146，C101 回归实证旧分类残留）；dbSave.intermediate 不传标记=保留旧值

### TPA / OPB

- **TPA**（`src/services/TokenPositionAnalyzer.js`，`config.tokenPositionAnalyzer` 段存在才构造）：触发门命中（write-once）对 top20 持仓 as-of 画像，`TPAPre_*` 因子族注入 FA；策略引用未触发的 `TPAPre_*` 恒 null → false=**fail-closed 不买（去门控化）**；触发门校验 fail-fast（时间门 blocks/ageSeconds 恰一，数量门非负）。三路径：离线 fresh 直用/stale 增量/miss 实时现算；retention 基准=触发刻峰值枚举大户集冻结后 running 净持仓重算（净卖<1=走人）。**live ticks 缓冲窗口裁剪**（默认关）：`liveTicksRetainHours`（null=不裁）挂 5min prune——删头段须同步推进 `_liveTicksBufferStartMs`（不推进=缺口漏报=掩盖问题），miss 请求 fail-loud 不回退 DB。**gmgnFilter**（`{enabled, exemptPct}` 缺省关）：①GMGN 用户钱包（本盘内经聚合路由买入>0）不参与分数 ②前期参与者 GMGN 占比≥exemptPct → **豁免放行**（不能做成 null——null 在 `TPAPre_tokenScore > 2.5` 下 fail-closed 拦死，与散户盘语义相反）③minHolders 同步剔非 GMGN；豁免救回 `TPAPre_gmgnExempt=1`+verdict 改写；`TPAPre_gmgnUserPct` 恒落纯观察。BSC 新钱包中性分 2.2（非 creator 只升不降）
- **OPB**（`src/services/OnlineProfileBuilder.js`，`fourmemeWs.onlineProfile.enabled` 默认 false）：实时代币分类，双门触发（idle 60s / bigTickIdle 600s）+ 60s 扫描补救，写 `token_profiles`（全局 PK，source='online'，不挂实验防级联删）；阈值判定与离线 classifyToken 共用 `scripts/shared/token-classifier.js`（单一真相）；TPA 联动喂分类缓存。**重启过渡期全史路径**：水位对齐前的存量活跃 token 价格史不完整 → 自动改走 wss_price_ticks 全史+classifyToken（防涨幅失真）；失败 fail-closed 不写失真行、待扫描重试

### 叙事引擎（`src/narrative/`）

所有 LLM 决策走 **Jev**（api.typesafe.ai，结构化三原语 Choice/Score/Noul，无文本生成，一票一次 fan-out 调用秒级）。

```
Token URL → URL 分类（含 IPFS metadata 解包——meta 任意 http(s) URL 直抓+JSON 内容判定，形状判定已废 C112）→ 数据抓取 → Pre-Check（纯规则）
   ├─ 账号/社区 token 或自发宣告（detectIssuerSelfLaunch 代码判）→ prestage Jev（3 题，粉丝带只定档不拦截——P1.12 删社区活跃题后社区臂恒 mid；isProjectCoin 的网站/URL 证据臂不采信聚合器自动 token 页——AUTO_TOKEN_PAGE_DOMAINS 清单，推文/简介宣告臂不受影响）
   └─ 标准路径：单次 Jev 调用（主干题+name_image_consistency/parent_relationship 条件题，J1.43；brand_hijack 条件题 J1.86/C143 并入实体题 brand_mismatch 桶；superIP 注册表命中 → state 注入认证/反混淆行，评分全归 Jev）
```

- **文件**（`analyzer/llm/`）：`JevClient.mjs`（缺答案 id 直接 throw；429/5xx 退避，Retry-After 头优先、钳 [500,15000]ms）/ `jev-questions.mjs` / `jev-prestage-questions.mjs` / `jev-state-builder.mjs`（60k/20k 预算）/ `jev-result-mapper.mjs` / `jev-prestage-mapper.mjs`（**聚合/阈值/截断全在代码侧**）
- **版本规则**：改任何题面必须 bump `JEV_QUESTIONS_VERSION` / `JEV_PRESTAGE_QUESTIONS_VERSION`（落库标识）；校准验证=**标准题集定向重析对拍**（182 `reanalyze-tokens.mjs` 案票翻转+带父推 high 票不翻；`jev_calibration.mjs` 抽样源已灭绝）
- **时间基准**：新鲜度对 **token 创建时间**（`raw_api_data.created_at`）计，绝不用墙钟——重跑/回测/延迟分析幂等；缺创建时间 pre-check 跳过时效规则、Jev state 退墙钟
- **修正教训（改校准必读）**：①题面改锚分不动（反复实证）——语义修正措辞能翻 argmax，分数锚定必须代码侧 mapper 门；②校准重跑必须**逐字复用线上 stage1_prompt.state**（token_narrative 不落 binance_square/instagram/website 等语料段，重建 state 缺语料致档位漂移）
- **图分析**（vision）：主推第一张图 → Qwen3-Omni Captioner @ SiliconFlow（key=182 `.env` SILICONFLOW_FALLBACK_KEY；恒传 format jpeg）。**prompt 不含 token 名**（跨 token 缓存健全性；指代判定留给 Jev）；img-v3 含 `visible_text` 图内文字逐字转写（渲染「图内文字」行进 state）+ maxTokens 2500（config vision.maxTokens 显式覆盖须同步改）；同图结论缓存（tweet_image，TTL 730 天，带版本号升版自动判 miss）+ in-flight 去重；图片本体缓存 `tweet_image_raw`（TTL 730 天同源跨进程复用；版本不符全量重拉）；失败=warn+无图证据+不写缓存（失败冷却会灭宣告竞态重试窗）；配置 `config/narrative-engine.json → vision`，enabled 但 key/baseUrl 残缺 throw fail-loud。**前置 Jev 预判门（C72/G1.2）**：`vision.gate {enabled 默认 true, minSufficientProb 0.6}`——await vision 前 1 题 Choice 判语料是否已足够，sufficient≥阈 → 整段跳过=本票无图语义（下游零改动）；**判据=文本已把叙事陈述清楚才免图**（G1.1：裸口号/官方措辞无上下文/只重复币名/只给链接二维码 → need_image 走图片流程；G1.2：文本已讲清热点 meme 的名字/来源/二创时附视频截图只是佐证，不判 need_image）；误判方向 fail-safe（误 sufficient=偏拦）；已挂 image_analysis 不问门；门跳过剥 image_analysis 防互相污染；prestage 不接门
- **提速要点（改挂载点/序须保持内容 bit 一致）**：website 内容抓取总开关 `websiteFetch.enabled` 默认 false=整段跳过（t.co 展开保留——URL 分类/pubProxy 判据吃）；中段三泳道 precheck∥账号链∥issuerCa 并发；precheck 三 DB 查询并行（0.7 创建时间刻意 raw 口径无回退，勿与另两个合并）；第二推文/双账号并发；undici 全局 keepAlive 30s；dbSave 瘦身（save `{existing}` 跳 pre-select；upsert 回读瘦列）
- **语料充分门（C79）**：`corpusGate {enabled 默认 true, minSufficientProb 0.6}`——twitter 主语料等齐后 1 题 Choice（CG2.0 判据=TRUST PRINCIPLE 采信推文陈述，验证真实性不是门的任务；need_fetch 仅剩两臂=主体不可辨/名字指代唯一载体在未抓内容），sufficient≥阈 → 待抓段整段跳过（`results.<x>Info` 保持 null=下游零改动；`skipped='corpus_gate'` additive）。门管清单剔 twitter（判据来源）/websites（独立开关）；资格=twitterInfo 非空+有待抓平台；`Promise.race` 2s 上限；**陷阱①：资格判定与 `{...results}` 展开都必须在 `await twitterPromise` 之后**；误判 fail-safe
- **web-fetcher**：直抓失败（403/Cloudflare/超时/抽取<50 字）→ `https://r.jina.ai/<url>` 回退一次（**不得带浏览器 UA**——r.jina.ai 403 伪装 UA，用 `richer-js-narrative/1.0`）；发布时间前插正文供时效题；失败 fail-closed=null
- **推文拉取缓存**（getAccountWithFullTweets 两层）：userInfo handle 级（跨 token 复用）+ tweets **userId 级全量 key**（只存翻满窗口的完整列表）+ **CA 惰性早停**（每页地址匹配命中即停，截断列表落 `…:ca:<addr>` 专属 key 不跨 token 共享）；**刻意不走 CachedFetcher.fetchWithCache**（失败 1h 冷却会灭宣告竞态重试窗）；只缓存成功（防空 stub 毒缓存）
- **空语料推特搜索兜底**（C77，`searchFallback` 现开启 `enabled:true`，config 顶层段）：语料全空票（classifiedUrls 各桶全空+twitterInfo null）按 **token symbol（用户看到的币名；symbol 不可用才回落 name）**+`since:<创建-7d>` 搜推特（`minTermChars:2`，2 字 CJK 可搜）作 `[TWITTER_SEARCH]` 独立段进 state header（不占四区配额；段内声明非宣告语料，关联由 Jev 判）；**★C130 用户裁定「为什么要卡互动呢？不卡，只通过语料了解叙事」——去重剔转推后语料非空即旁路 `no_public_info`：pre_check_result 置 null 走 Jev**（engagement 只作 state 展示/审计，绝不作门槛；原 bypass.minTweets/minTopEngagement 已删；保留 low 会遮蔽 Jev 结论）；零语料/失败 → ruleName 原样保留（1800s 重试域）+ additive `details.searchEvidence`，**零语料不落缓存**（TTL 会冻死重试窗内全部重析）+analyzer 维持原拒；★**lag 隔离红线=证据只走 `raw_api_data.search_evidence`**，与 extractCorpusTs 三路径结构性无交叠；enabled 残缺 throw fail-loud；段缺失=静默关
- **PrecheckFailRetryService**（`engine/PrecheckFailRetryService.mjs`，`engine.precheckFailRetry` 配置）：两域重试——`address`（宣告竞态，窗 300s；**带语料形状门**：非账号型语料 skip 不烧 Jev 配额；重析带 `invalidateAccountCorpus:true` 重取账号数据）/`no_public_info`（语料晚到，窗 1800s，先 invalidate GMGN 成功缓存再 `enrichSocialByGmgn:true`——该域不在收窄范围）；门：token age（wss_events 最早 token_create 锚，缺锚不重试 fail-closed）+ 新 ticks 增量≥20 自节流 + 尝试<5；DB 一律 dbManager
- **叙事知识库（C165，`src/narrative/analyzer/knowledge/`）**：5 文件聚合（config/knowledge/{concepts,bluechips,manual-entries}.json 进 git + data/knowledge/{quasi-graduations,quasi-feedback}.json 不进 git），按 id 合并后读覆盖（manual 兜底生成件、feedback 覆盖 graduations）；id 域 `b:`/`q:`/`concept:`。匹配 5 级规则（address>name_exact>name_substring LCS>corpus_contains>concept_keyword；concept 条目不参与 substring；**twitter_exact 已退役**——2026-10-22 用户裁定「同 Dev 关联不恰当：同一个 Dev 发的绝大多数代币叙事根本无关」，同 C168 撤去重臂判据），防噪三防线=代码 denylist/条目 corpusTrigger:false/maxEntries=5 封顶。命中注入 `[KNOWLEDGE_BASE]` header 级段（标准+prestage 双路径，用户裁定；空命中 state bit-parity）；匹配挂 `raw_api_data.knowledge_matches` 审计。**反馈回写**（用户裁定要）：分析完成后 rating∈captureRatings 或（毕业∧非low）自动沉淀客观字段（intro/rating/reason，不让 LLM 自由编写）至 quasi-feedback.json（tmp+rename 原子写，同 id upsert 留最新）。蓝筹口径=**ATH 市值>$1M**（用户裁定），**蓝筹去重门（C168，`duplicateGate` 缺省开）**：新票 name_exact 撞蓝筹条目（b: 域）→ mapper 门链首臂拦 low（quasi 小蓝筹刻意不拦——短期热门叙事连发姐妹票是常态；twitter_exact 上线即撤——蓝筹条目 twitter=借壳大 V 语料源非票身份；detectDuplicateNarrative 窄跑独立检测，注入与去重各自旁路；蓝筹本体 selfAddress 自排除）**蓝筹叙事两级来源**：`--enrich`（token_narrative/experiment_tokens/AVE）优先，`--enrich-desc`（CoinGecko 公开简介，非 LLM 编写）只填占位不覆盖已富化（narrativeSource 审计；CG 免费档限频 15s+断点续）；builder 只在 182 跑（`scripts/narrative/build-knowledge-{bluechips,quasi}.mjs`，蓝筹周级/准蓝筹日级，详见 docs/knowledge-base.md）。config `knowledgeBase` 段（searchFallback 同语义：缺段静默关/残缺 throw）；知识文件 mtime 热载免重启；**JEV_QUESTIONS_VERSION 不 bump**（state-only）。**回归依赖知识文件 commit 态**——case-regression 跑前 bluechips/concepts/manual 须已 push，漂移排查先 diff 知识文件
- **已定案规则**：规则 5 高影响力+媒体直发**已废**（自填 twitterUrl 白拿 mid 的攻击面，放行走 Jev）；rule 0.52 同名蓝筹**整体废除**（同名≠蹭名，移交叙事层）；规则 0.5 duplicateNarrative+0.6(q60) **死代码整链删除**（引擎侧 strictSameNameTokenCount 独立活链路不碰）；expired_tweet **分桶**=速查表 C74/C104 行（旧分钟窗 config 键废止删除）；无锚语料（account/纯 IG）放宽评级 2/3 即可买（观察期盯盈亏）

**叙事门/豁免速查**（判据全文见台账对应 case；审计字段落 stage1.jev.*）：

| 门/豁免 | 一句话判据 | case |
|---|---|---|
| cashtag 改道 W（J1.17） | 语料（含父推）$TICKER 全等 token symbol → 强制 W 数学 | C28 |
| 发布者代理（J1.18） | 域名词根=token 名+粉丝≥10万+名互斥+非版本词（代码门） | C29 |
| 角色 IP 豁免（J1.16） | 【C145/J1.87 routine 桶退役后本豁免无消费点】角色 IP 仍按 A 类评估；作品名币不豁（历史语义） | C25/C145 |
| web3 买家视角锚（J1.23+C94） | A/B 类 strong_fit≥0.5 且 tier<B → effTier 锚 B（正门，只升不封顶）；B 类另享 dim2<18 锚 18 双锚；C/D/E 维持客观规模口径（mem 地板 C108 退役） | C38/C94 |
| 戏谑关联豁免（J1.24） | brandMismatchP≥0.5（实体题 brand_mismatch，J1.86/C143 校准）+within_7d+effTier S/A+可信事件锚全中 → 豁免劫持与关联≤10 截断+量级门事件分不足臂（**W 数学 pass 线刻意不豁免**） | C40/C86/C143 |
| W 类数学（C142/C154） | **单轴：项目对 BSC 用户吸引力(0-75)**，pass **32**；J1.91/C154 删除 `TIMING_SCORES_W` 正向表（25 分对 ~70% W 票是常数偏移）——时效仅对 older/unknown/override **封顶 30**；C68 angle override（774 行 0 命中）同批退役；J1.84 双轴合并 `w_product_score`(0-35) 与 `w_bsc_user_appeal`（J1.79 W 票 Spearman 0.847/R² 0.711）；币安交互臂 C134 退役 | C142/C154/C134 |
| IG 影响力两层（C44） | IG 真数据进 state 评分（无锚）；有链接没抓到数据：A 类+dim2<18 → 锚 18 | C44 |
| notable_other 退出（J1.26） | 知名度是错误轴：nameReferent 阻断质量只留 minor_other+common_word；全类退出；**nr 拦截位 C108 整体退役**（EARLY common_word 0.92 误拦案——责任移交 J1.42 名字门；题保留只喂评分/豁免链） | C54/C108 |
| 产品实体+接纳门（J1.27） | 【C141/J1.83 题退役判据并入 fit】`event_subject_entity` 删除，判据入 event_fit unfit 桶「公司产品实体不被接纳」臂（华为麒麟锚句；母公司影响力不转移）；门一般化 **web3FitMassBlock 通用硬门：strong_fit+fit 合计<0.5 → 拦，全域**（挂 web3UnfitBlock 后 veto 链前）；豁免 pubProxy/isW/binanceCorpus/平台官方号（PLATFORM_OFFICIAL_HANDLES={binance,flapdotsh}），刻意不豁 punExempt（前提 S/A 无冲突）/imgNameExempt（救回总分必<60 评级等价）；**同轴遮蔽**：量级门 D/E 臂域⊂门域归因迁移、IG 锚 floor50 抬分域重合=非豁免票死代码（计算/审计照落）、J1.36 折损臂收窄为豁免路径 | C56/C141 |
| 指代 meme 低档门（J1.28） | 【已废 C108，拦截位退役并档 J1.42 名字门】原判据 mem≤1（人名/账号/严肃事务性名称）——「用户不接纳」子集由词句题（现 `web3_user_phrase_acceptability`，前名 web3_user_name_acceptability/J1.53 前名 name_form）承载；题保留喂五腿 | C60/C108 |
| 形象载体门（J1.29） | C/D 类+carrier∈{improvised,no_visual} 拦；E 类只拦 no_visual；A/B/W/F/G 不碰；**C109 图证覆盖豁免（C118 扩演绎臂）**：imageEvidence ∧ (名图一致 same_entity≥0.5 ∨ image_depicts_name depicts_name≥0.5) → 不拦（配图=载体事实证据：名实同一/同类 or 图在演绎名字含义——猫拉窗帘=DND「别打扰」画面演绎；J1.30 刻意不消费演绎题两豁免面不互扩；audit `subjectCarrierImgOverride` 带 via:match\|depicts，stage2 拦截票段同形键可归因 fallthrough）；**C139/J1.81 著名免形象资格**：题改名 `web3_user_entity_visuality`（新旧双键读）——accepted≥0.5 ∨ 超IP认证行在册（corpusAuthorInRegistry）∨ authorUtterance → 整门跳过（audit `subjectCarrierFamousExempt` 命中才落）；C88 五腿载体门臂随批退役（五腿第一腿两前提各自仍豁免=行为不可见，新增豁免面=著名但五腿不达标票）；**C167 载体性质第四臂（J1.100 image_carrier_nature）**：图证豁免一律须 nature=carrier_visual（形象级载体）——配图=名字所指【非形象事物】（游戏/产品/网站/活动）自身实录 → referent_itself/unclear/答案缺失 fail-closed 不豁（C109/C118 两臂与 C159 近 tie 臂同受管；事物自我实录不算演绎=真香蕉锚升格、图内第三方 IP 不成本币载体；J1.30 关联豁免不消费本题；audit `subjectCarrierReferentVeto`） | C61/C109/C118/C139/C167 |
| superIP 指代豁免（J1.21） | 【已废 C83，快车道删除】意图由名字门（J1.42）覆盖 | C33 |
| 图载体豁免（C59） | 图证据+0&lt;关联≤10+name_entity_memeability≥3 → 豁免 Stage3 关联截断（分照常计入） | C59 |
| 名图一致豁免（J1.30） | 图证据+name_image_consistency（条件题）合并≥0.5+0&lt;关联≤10 → 豁免关联截断+量级门两拦截位（D/E 档臂+事件分不足臂）；答案缺失 fail-closed | C65/C86 |
| 找角度时效门（C68） | angle_seeking/interpretive_reply 载体推 lag>6h → mapper 时效归 0（mapper-only；C74 后降级纵深防御；precheck 锚回退 tokenCreatedAtSec） | C68 |
| 推文时效分桶（C74+C104+C120） | 非豁免桶（angle/interpretive/unknown）lag≥300s 拦；direct_tweet（粉≥5000 或 赞≥500 或 转≥100）豁免交 Jev 软评——**主从结构门：主推 lag>24h 须 website_tweet/quoted/retweeted 任一 ≤24h 新载体才豁免**，无载体裸旧推回落 300s 拦；主推 created_at 缺失 fail-open；**C120 interpretive_reply 巨粉豁免**：作者粉≥HIGH_FOLLOWERS(5000，classifier THRESHOLDS 同尺) 且主推 lag≤24h → 跳过硬拦交 Jev 软评（粉丝缺失 fail-保守不豁；桶分类不动，豁免只在 precheck 消费侧） | C74/C104/C120 |
| 叙事源头陈旧门（C75） | direct_tweet **主推**（仅主推）距 token 创建锚 >30d → mapper 时效归 0（C74 豁免桶的客观锚层）；angle/interpretive/unknown 不触达；锚缺失 fail-open | C75 |
| 图文名不符拼写门（C78） | 币名 CJK ≥3 字+图内文字等长独立段恰一位不同且 ≥2 次+币名整体不在图内 → Stage3 截断（纯代码；misspellingP 探针臂 C108 退役=代码门唯一拼写拦截位；有意变形全语料一致不触发） | C78/C108 |
| E 类感染力折损（J1.36） | 判据源=web3_user_event_fit：`(strong_fit+fit) < 0.5` → 仅 category=E `tierScore+effSpread ×0.5`（时效不折）；≥0.5 原公式；缺失 fail-open 不折；审计 web3FitDampMass 恒落（J1.54 改名） | C93 |
| F→E 改道（J1.37）+ 名字门（J1.42 统一） | **改道**：event_finding_vs_recap==news_recap ∧ F → 强制改道 E（换考官非放行，E 既有门全部接管）；**名字门（C108 四分支=唯一名字拦截位；C139/J1.81 三轴重构）**：①实体轴 `web3_user_name_entity_acceptance` 五桶（C139）：accepted（著名）/unknown（无认知，B/C/D/F/G/W 域拦——J1.56 不变）/new_entity（J1.72 不触门；**已知 IP 的有意义衍生新造型/错版玩偶/二创角色也归本项，C151**）/**wrong_entity（指歪/指残：拼写错/不忠实呈现/版本残片——prob≥0.5 全域拦含 A/E，C105 版本臂+C108 拼写臂迁入；**有独立背景故事/文化来源的有意义变形（错版/错印/玩偶/新造型/二创造型/致敬变体/联名）不选本项，J1.89/C151 哭哭奶龙案**；audit `nameWrongEntityMass`）**/not_entity（原 no_entity 改名，不映射实体，拦截交词句门）②形象轴 `web3_user_entity_visuality`（C139 改名，见 J1.29 行）③词句轴 `web3_user_phrase_acceptability`（C139 改名，**只评 not_entity 票**——entityChoice 为实体桶全跳过、缺失照评；三键读 `phrase ?? name_acceptability ?? name_form` 旧行 bit 不变；判据=web3_user_not_acceptable 全类别硬拦：圈内符号合格、无名实体/无感知句片段不合格、圈内文化词（Early/HODL/LFG）合格、通用梗缩写锚（J1.47）/超IP来源极端否证段（J1.80）随行；兼容 Set {not_meme_name, statement, functional_label}；unclear/缺失 fail-open）；门链序 ne→we→ua→sc→tier；版本断代 | C96/C105/C107/C108/C139 |
| 币安地域子账号量级锚 | 主推作者 handle `binance` 前缀 ∧ 非四全球号白名单 ∧ binanceCorpus 借壳语料在场 → effTier 锚 **D**（锚降优先于锚升两臂；量级门 D/E 档臂五腿不豁=唯一新增拦截位）；jevImpactTier 原判保留（J1.54 改名）；只查主推；缺失 fail-open | C97 |
| 借壳语料父推源头窗 | binanceCorpus 票主推 `in_reply_to.created_at` 父推 lag>24h → timing 归 older；**不限 tweet_type**；真正拦截机制=C88 五腿 FRESH_TIMING_C88 断 → J1.29 载体门接管；载体推刻意不进判定（新载体不构成源头新鲜证据）；缺失 fail-open；与 C68/C75 并存双 override 各落 | C102 |
| 载体↔父推关系源头窗（J1.39） | **通用语料版 C102**：parent_relationship 条件题四选——new_angle_on_original（载体借原生推有新解读=豁免，父推可老）/translation_or_repost/explains_derivative/unclear；翻译/二手臂 ∧ 任一槽位（主推/website_tweet/quoted/retweeted）父推 lag>24h → timing 归 older（取最老父推）；仅 hasReplyParent 才问（无父推不问防幻觉）；答案/锚/父推时间缺失 fail-open；版本断代 | C103 |
| negative_hard_news 扩政治暴力边界（J1.38） | 题面扩：安全事故族+政治暴力/社会动荡（抗议/示威/罢工**演变为**打砸抢烧/骚乱/纵火/冲突/恐袭/战争/动乱）+语料形态加「时事转述」+**政治暴力臂不看载体玩味空间**（消费苦难不是梗）；反向窄边界：和平政治/政策辩论/选举玩梗不选正常评估；mapper 零改动；版本断代 | C98 |
| 超IP原话票 + 实体低影响力门（J1.56） | **作者原话票**：作者在册 ∧ 币名逐字主推文本 → `authorUtterance` 补位 C88 五腿第一腿（accepted≥0.5 ∨ authorUtterance）+C139 著名免形象资格第三源，问候语在实体题如实 `not_entity`（前名 no_entity）不升档；**实体门**：`web3_user_name_entity_acceptance.unknown ≥0.5` → 拦（域 B/C/D/F/G/W，规格=旧 J1.10 nrBlock；not_entity 中性、A/E 不入域——wrong_entity 另立全域门见 J1.42 行）；**`new_entity`（J1.72/C133 股城案）=刚诞生且已向 BSC 用户群发出信息的新项目/新品牌/新角色——不按认知度判、不触门**（unknown 收窄为已存在实体无认知）；骑乘改道退役 | C126/C133/C139 |
| 空洞内容门（C114/C159）+ 通用梗缩写名字锚（J1.47） | **图证豁免（mapper 臂）**：block_reason argmax=empty_content ∧ context.imageEvidence（=twitterInfo.image_analysis 存在，与 J1.30 同源）→ 不拦——极短主推+配图/视频在场=图就是内容（DND 😾+猫拉窗帘 0.36 vs 0.31 掷骰边缘）；只翻本门，名字/载体/量级门照常接管（DND 终局=地域子账号 D 档量级门，理由干净）；无图票照拦；audit `emptyContentImgOverride`（stage2 jev，命中才落）。**C159 近 tie**：empty_content 与 none 掷骰（emptyP≥0.4）且图证在场时，载体门仍按「图就是内容」豁免（`emptyContentImgCarrierOverride`；audit `subjectCarrierEmptyImgOverride`），防 J1.95 锚点让 DND 类票随机改由载体门拦。**题面（J1.95/C159）**：短句/疑问句点名具体 meme/实体/已知 IP 的完整名称（chinese nubcat?/XX猫？）不算空洞；纯缩写/符号/表情组合（DND 😾）不适用该排除；低质 IP 复用交 token_ip_reuse。**名字锚（题面）**：通用网络梗/文化缩写（DND/FOMO/LFG）合格、机构职位/品牌内部缩写（工牌 Chief Risk Officer→CRO）不合格——分界同总则=用户侧感知 | C114/C159 |
| 强情感冲击/动物救助路径（J1.96/C160） | 真实正向、广泛传播的公益/纪念故事（尤其**流浪猫狗救助**——web3 用户天然喜欢猫猫狗狗）→ 至少 fit，强共鸣可 strong_fit；情感币/纪念币不要求玩梗/二创。**载体豁免**：E 类 + fit 质量≥0.5 + 文本事实锚（动物救助词 ∧ 纪念/离世词）→ `entityVisualBlock` 不拦（audit `subjectCarrierEmotionalImpactExempt`）；代码锚只防泛 E 热点（C79 无救助/纪念词照拦），真实性/正向性仍归 Jev。消费弱势真人苦难/疾病死亡猎奇/虚假未证实悲情仍 unfit | C160 |
| 巨大影响力事件载体豁免（J1.97/C161） | `event_influence` 3 档（massive/notable/limited，**只作载体门豁免输入，不参与事件分**）：massive=全球/全网/跨平台/主流报道 → 载体门不拦（C/D/E；audit `subjectCarrierMassiveInfluenceExempt`；`eventInfluence` 恒落观察）；notable=单平台热搜 / limited / 旧缓存缺题 → 不豁免（fail-closed）。明确锚：写出「全球爆火/全球热议」+ 官网/维基/新闻报道 → massive；单平台热搜/作者自夸无外部证据不选 massive | C161 |
| 蓝筹去重门（C168） | 新票 name_exact 撞蓝筹库条目（b: 域 ATH>$1M，**quasi 小蓝筹刻意不拦**——短期热门叙事连发是常态；**twitter_exact 臂上线即撤**——twitter=语料出处非票身份，借壳大 V 同源多票是常态，回归 9 票误拦实证；**条目级 dedupExempt 豁免**——名字全等≠叙事同一，口号泛名/同部署者连发名 manual 标记不拦，C137「白宫 memes will continue」裁定）→ mapper 门链**首臂**拦 low（mapper-only 不 bump 题集版本；Jev 照跑留档案；detectDuplicateNarrative 窄跑独立于注入截断，蓝筹本体 selfAddress 自排除；audit `bluechipDuplicate` 命中才落；prestage 不接） | C168 |

### Live 交易

- four.meme=`FourMemeDirectTrader`（TokenManager2），flap=`FlapPortalTrader`（Portal swapExactInput）；双平台 live=单引擎双 trader 同一钱包（live 参数恒读 fourmemeWs.live）；**买入不区分计价盘**（用户裁定——可行性由 estimateGas 天然保证：多跳路径不通 estimate 失败即买入失败，不发垃圾 tx；卖出 quote 池死风险自担）；卖出 token→0x0 全盘支持
- live 实验只能 `node main.js start-experiment -e <id>` 启动（run-engine 对 live 显式拒绝）
- 实收解析**余额差法**（买入 balanceOf 前后差=税后真相；卖出 BNB 差+gasUsed×gasPrice 补偿）——对税币/非 BNB quote 盘免疫
- **flap minOut 锚取较低者**：`minOutAnchor = min(信号价期望 expectedTokenOut, quote)`——平稳/暴跌盘锚 quote 行为不变，暴涨盘锚信号价期望（防 quote staticCall 滞后块状态虚高卡死 revert）；L1 预成交校验不动；Decimal 域取整
- **卖出 approve 大额一次授权**：两 trader `approve(spender, ethers.MaxUint256)`，条件结构保留 `currentAllowance < amountOutWei` 才发——首卖一笔此后恒充足跳过
- **live 记账精度钳制**：`_liveRecordTrade` 卖出方向差值 ≤相对 1e-9 → 钳到账面持有量重试，**全 Decimal 比较**（double 吞掉 1e-11 差异致钳制静默失效）；真超卖照常失败
- **买入失败可观测性**：`_executeBuyLive` 失败分支单次必打 warn + `tradeResult.reason` 落库；trader 日志 `setLogger(logger, experimentId)` 进实验日志；`Logger._consoleEchoDisabledFor` 同文件禁复读（stdout 重定向到日志文件时防双写）
- 防御层（参数在 default.json `fourmemeWs.live`/`flapWs.live`）：L1 `assertMinOut`（报价/预期 ratio<0.5 拒单；expected 契约必传缺即 throw；卖出无锚 fail-closed 拒裸奔）/ L3 卖出熔断（连败≥5 → 30min 冷却+Telegram）/ **买入熔断**（连败≥3 `buyCircuitBreakerFailures` 拉黑至进程重启+告警；只计发单后链上失败——前置拒绝/资金不足不计；「2 败 1 成」翻正清零；手工买不走检查）/ L5 `_awaitReceipt`（超时回查一次，**绝不自动重发防双买**；reverted throw。**WSS 快速回执默认开** `txReceiptViaWss !== false`：引擎 `_txSeenSignal` + collector `_onTickEmitted` → trader `Promise.race([WSS 路径, waitForTransaction])`——自家 WSS 见到成交 tick 即轮询拿真 receipt；拿不到（approve/PCS 卖出/revert 无事件/WSS 永未见）=让位原路径 **bit 一致绝不冒充**）/ `maxPositionTokens`（0=不限只拦新开仓）/ 毕业告警人工处置
- 钱包复用：web 创建 live 实验「复用历史钱包」下拉（`GET /api/live-wallets`，私钥永不回传；两端 ENCRYPTION_KEY 一致）
- runbook `docs/live-acceptance-runbook.md`；**真实资金验收未做**（0.001 BNB 闭环待用户执行）；flap 毕业/非 BNB 盘卖出 revert 属预期 fail-closed

### Web / 数据库 / 配置

- Web：`src/web/` + `src/web-server.js`（3010）；K 线/现价走 wss_price_ticks（tick-kline-service）；AVE 工具端点（/api/ave-*）保留；叙事 UI /narrative-analyzer、/narrative-tasks；TPA /experiment/:id/position-analysis；signals 页因子 chip 条件驱动
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
10. 历史窗口回测先失效叙事缓存（invalidate-*-window.cjs）；校准重跑逐字复用线上 state
11. BacktestTickCache 探针/装载保持锚定无序形状（ORDER BY id 形状 planner 超时）；maxTickRows 默认 100 万，大窗口显式放宽
12. collector stop 顺序 eventWriter → senderResolver → collectors，不可换
13. 新机制一律配零 DB 零网络单测；事故修复配「事故现场反证」断言（源码口径断言锁定防线）

## 操作指南

### 新增买腿因子（C84 起一律先进 FA）

1. 因子计算加进 `FourMemeFactorAggregator`（累计态挂 token state 或模块级 Map，周期判定禁 Date.now——now 由 `buildFactorMap(state, asOf)` 传入）；2. `_buildFactorMap` 发射键（无数据=有证据零值非 null，缺证据=null——fail-closed 方向想清楚）；3. `getFactorKeys()` 探针自动收键（未知因子三防线自动认得，勿手维护清单）；4. FactorBuilder 时序快照白名单两处透传（不落库即丢）；5. 配零 DB 零网络单测（公式精确值+口径反证）。legacy preBuy 注入五步仅旧腿维护用，**勿再新增**。

### 修改 Jev 题集

1. 改题面；2. bump 版本常量；3. 聚合语义变了同步对应 mapper；4. 跑定向重析对拍验证评级一致且无买线翻转；5. **case 与裁定同步台账**（卷三倒序追加）并**收录回归票**（`npm run case-regression -- --add <addr> --case C<n>`，预期变化票 `--update-expect --because` 留痕，工作流见 docs/case-regression-tool.md）；6. 部署前跑 `npm run case-regression` 全量对拍
