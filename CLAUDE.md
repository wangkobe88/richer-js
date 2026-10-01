# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Richer-js is an automated trading engine for **BSC four.meme + flap tokens** (BSC-only). Token discovery and prices come from a **常驻 WSS watcher**（ankr WSS event subscription on four.meme TokenManager + flap Portal, fully event-driven, no polling）: watcher 落库 `wss_price_ticks`/`wss_events`，实验进程（virtual / live / backtest，任意数量各自策略）从 DB 增量消费同一份数据流. It supports virtual trading (simulation), backtesting (tick replay), and live trading modes. It also includes a **narrative analysis engine** (Jev structured decision model) that evaluates meme coin events.

## Common Commands

```bash
# Experiment runner (interactive CLI; start/stop experiments)
npm start

# Dev mode
npm run dev

# Web server (port 3010)
npm run web

# Run engine for one experiment directly (virtual mode)
node src/run-engine.js <experiment_id>

# Narrative analysis engine (standalone worker)
npm run narrative-engine

# WSS watcher daemon (常驻双平台采集，182 screen 部署；本地不跑——ANKR key 在 182)
node src/watcher/index.js

# Watcher 架构本地零 DB 单测（打桩 dbManager）
node scripts/_test_watcher_architecture.cjs

# sender_address 解析（真实买家 tx.from）零 DB 零网络单测（打桩 provider/collector）
node scripts/_test_sender_resolver.cjs

# TPA 离线画像构建（step4；只在 182 跑，须在 build-token-profiles 之后——依赖 flash_crash_period）
NODE_OPTIONS=--max-old-space-size=12288 node scripts/build-wallet-profiles.cjs --threshold 3 --days 14

# TPA 本地零 DB 单测（builder/scorer/TPA 三件）
node scripts/_test_wallet_profile_builder.cjs && node scripts/_test_wallet_scorer.cjs && node scripts/_test_tpa.cjs

# IG 链路三处死链修复 + 影响力兜底锚零 DB 零网络单测（打桩 fetch，fixture=C44 真实响应）
node scripts/_test_instagram_pipeline.cjs

# Twitter Community 链路两处死链修复零 DB 零网络单测（C48 CREPE 案；含全库 twitter-validation import 逐条 resolve）
node scripts/_test_twitter_community_pipeline.cjs

# 叙事 precheck fail 重试 + 分类提取本地零 DB 单测（打桩 dbManager/analyze）
node scripts/_test_precheck_fail_retry.cjs

# live 加固层零 DB 单测（assertMinOut/_awaitReceipt/FlapPortalTrader 打桩）
node scripts/_test_live_hardening.cjs

# sender 口径切换 + 聚合路由占比因子零 DB 单测（0x1de460 GMGN 案）
node scripts/_test_sender_switch_and_router.cjs

# FA holders 族钱包口径切换零 DB 单测（GMGN 案 B，bSTOCKS 案衍生）
node scripts/_test_fa_wallet_denomination.cjs

# 回测 ticks 装载缓存零 DB 单测（BacktestTickCache 状态机/引擎级对拍）
node scripts/_test_backtest_tick_cache.cjs
```

No test framework or CI is configured.

## Architecture Overview

### Main Entry Points

- **`main.js`** - Experiment runner (interactive CLI)
- **`src/run-engine.js`** - Run a single experiment's engine directly (virtual mode)
- **`src/web-server.js`** - Web interface (Express.js, port 3010)
- **`src/narrative/engine/start.mjs`** - Narrative analysis engine
- **`src/watcher/index.js`** - WSS watcher daemon（常驻采集进程）

### Trading Engine Flow (watcher 架构：订阅与消费剥离)

WSS 订阅由**常驻 watcher**（`src/watcher/`，单进程双平台，182 screen + pid 单实例锁）长期持有，不随实验起停；实验进程（任意数量、各自策略）从 DB 增量消费同一份数据流：

```
┌ watcher 进程（src/watcher/WssWatcherService.js，常驻）─────────────────┐
│ FourMemeAnkrWsCollector + FlapAnkrWsCollector（FA/tokenPool=null）      │
│   tick(500ms flush)      → wss_price_ticks (experiment_id=NULL)        │
│   token_create/graduation/quote_set → wss_events (kind 行；重试队列)     │
│   60s heartbeat 行 → 实验侧断供判据 + 人工查活（7 天清理）               │
│   60s 断流自愈（消息静默≥5min → forceReconnect；自引擎迁入）             │
│   SenderResolver（共享实例传两 collector，config.senderResolve，默认开）： │
│     新行 sender_address = tx.from（真实发起 EOA）。trader 参数是          │
│     msg.sender——公共路由（flap 0x1de460 占 27.9% 行）落的是 router 合约。│
│     EOA kind 缓存命中同步进 buffer 零延迟；合约/未知走 getCode +          │
│     getTransactionByHash 反查后回推（RPC=dataseed 池轮询，可切            │
│     ankrFromEnv）；失败/溢出/停机 → NULL 保行不丢（绝不冒充）。           │
│     消费侧已切 sender 口径（2026-09-30 案 A）：早期窗口因子 wallet 聚合    │
│     COALESCE(sender, trader)；TPA/离线画像仍 trader（二期裁定）          │
│   logs 订阅带 topic0 白名单（TOPIC0_MAP，2026-09-28 ANKR 降费 flap -74%/  │
│   fourmeme -42%；unknownTopic0 计数归零=新事件类型发现盲化，诊断时临时    │
│   去掉订阅 params 的 topics 字段重订阅一天）                              │
└─────────────────────────────────────────────────────────────────────────┘
     │ wss_price_ticks (exp_id=NULL)        │ wss_events
     ▼                                      ▼
┌ 实验进程 ×N（FourMemeWssTradingEngine / FlapWssTradingEngine）─────────┐
│ SharedTickConsumer（src/trading-engine/core/，1s 轮询 id watermark）：  │
│   events: registerToken → pool.addToken → 引擎._handleNewToken/_handle │
│           Graduation（heartbeat 只推水位不派发）                        │
│   ticks:  pool.updatePrice → minTickBnb 门 → FA.processTick            │
│           (emitFactors:true) → priceOutlier 命中行批量回写              │
│ 引擎既有 factorsUpdated → OPB/卖腿实时/买腿 debounce 管线零改动         │
└─────────────────────────────────────────────────────────────────────────┘
```

**SharedTickConsumer 关键机制**：首拉 `select max(id)` 对齐（只消费启动后新行，等价旧订阅行为）；水位延迟一周期提交 + `(tx_hash,log_index)` 去重集（对抗 bigserial 分配序≠提交序的双写者竞态）；**禁止服务端 platform 过滤**（异平台行须进结果集推水位，本地过滤）；先 events 后 ticks 串行（同周期 create 先应用）。乱序自愈：FA.processTick 对未注册 token 自动建 state，registerToken 幂等回填更早 createdAtMs。

Two engines via `src/trading-engine/implementations/`:
- **FourMemeWssTradingEngine** - virtual (simulated accounting) and live (`FourMemeDirectTrader` on-chain trades) modes in one engine; platform via `_wsConfigSectionName()`/`_wsPlatforms()`（flap 子类覆盖）
- **BacktestEngine** - replays `wss_price_ticks` through the same factor-strategy pipeline（**token 集合 + platform 口径**：`_tokenMeta` 全集 100 地址/批 `.in` + platform 按单值 `.eq` 循环（`.in` 多值等价无过滤，planner 弃索引致 statement timeout），分块后全局 id 归并排序；不再按 experiment_id——watcher 新行 exp_id=NULL）
  - **ticks 装载本地缓存**（`src/trading-engine/core/BacktestTickCache.js`，2026-09-29 参照 pumpfun TickDataCache 机制）：raw 行装载默认经缓存——粒度 `(sourceExperimentId, platform)` 一文件 `data/tick-cache/backtest/<src>/<platform>.jsonl.gz` + `.meta.json`；**缓存存全量、运行期过滤**（存原始 DB 行原样 JSON，时间窗/映射维持内存层零改动 → 任意窗口回测共用、结果与直拉 bit-identical）。状态机：MISS（data/meta 缺、gzipBytes 失配=crash 窗口、columnsTag 漂移→全量拉）/ FRESH（探针 chunk×platform 反取 max(id) === meta.maxId → 纯读零拉）/ STALE（增量 `.gt(id, meta.maxId)` 补拉合并重写）/ bypass（探针失败→WARN+直拉不读写缓存，数据正确性优先）；表回缩（probe < meta 或 probe null 而 meta 非空）→ drop 重拉；读损坏自动删缓存重拉不中断。开关 `backtest.cacheEnabled`（默认开）+ `backtest.forceRefreshCache`；`_fetchPlatformTicksRows` MISS/STALE 共用（afterId 起点参数化）；pid 后缀 tmp+rename 原子写、4MB 背压、行 id 超 MAX_SAFE_INTEGER fail-loud throw。磁盘无自动清理（clear() 手动）。单测 `node scripts/_test_backtest_tick_cache.cjs`（47 断言）
- **FlapWssTradingEngine** - extends FourMemeWssTradingEngine（virtual + live：`FlapPortalTrader` Portal `swapExactInput`，见 Live Trading 节）

### 双平台实验（config.platform='both'，2026-09-27 上线）

一个实验同时交易 fourmeme+flap 两平台代币：**单引擎实例 per-token 分派**（基类 `_handleNewToken(info, platform)` 按 consumer 传入的行平台分派 `_buildFourMemeTokenRecord`/`_buildFlapTokenRecord`），共用同一套买/卖策略与单一资金池（PM 单组合）；FlapWssTradingEngine 改薄（`_handleNewToken` 逻辑入基类，保留 constructor/`flapWs` 段/`_buildTokenInfo` 无 name 版/live throw）。

- **归一化唯一入口** `resolvePlatforms(platform)`（`src/trading-engine/core/platforms.js`）：`'both'`→`['fourmeme','flap']`、`'flap'`→`['flap']`、其余→`['fourmeme']`
- **范围 virtual + backtest + 单平台 live（fourmeme/flap 各自）**；双平台 live 三重防线禁止：web-server POST 400（live && platform='both'）/ main.js `_createEngine` throw / 前端提交拦截
- **引擎级配置恒读 fourmemeWs 段**（`_wsConfigSectionName()` 基类返回值，flap 子类才覆盖 flapWs）；FA 构造键名固定 fourmemeWs；corpusEnrich per-token 分派
- **创建页平台选择 = 多选 checkbox**（结构保证至少一勾；双勾 POST 标量 `'both'`；live 模式 flap 禁用联动；复制链路 both→双勾回填）
- 存量单平台实验零行为变化（182 重启回归验证：引擎身份/配置段/水位对齐保持）
### Watcher 架构口径变化（2026-09-24 切换）

1. **`wss_price_ticks` 新行 `experiment_id=NULL`**：watcher 写的行免疫删实验级联；删历史实验仍级联删其名下旧行（FK 仍在，混合保留语义）
2. **tvl 因子恒 0**：DB 行无 offers/funds_bnb（four.meme 虚拟对齐回测口径；flap 一直如此）
3. **price_outlier 消费侧回写**：新行落库 false，consumer 判离群后批量 UPDATE（延迟 ~1s）
4. **实验级 collector 配置失效**：实验 config 的 `fourmemeWs/flapWs` 段 contracts/tickBuffer/reconnect/endpoint 覆盖无效（watcher 只读 default.json）；debounce/FA 参数/conpusEnrich 仍实验侧生效
5. **端到端延迟 +~1.5s**：flush(≤0.5s) + 轮询(1s)；卖腿止损同此
6. **wss-down-guard 改判据**：consumer `lastIngestAt` 15min 停滞（watcher 60s 心跳行保证市场安静时不误报）→ status='wss_down'；自愈 forceReconnect 已迁 watcher，实验侧只告警
7. **flap QuoteSet 映射持久化（2026-09-27 事故根治，1920701）**：flap 非 BNB 计价盘的 token→quote 映射实时落 `wss_events`（kind='token_quote_set'，watcher 重试队列）；collector 启动先 `_loadQuoteMapFromDb` 重建终态（乱序行按 (blockNumber,logIndex) 排序应用、零地址压制更早非零记录），回放窗缩为 [水位-100, head] 增量补停机缺口，**回放结果不落库**（水位驱动下次重启自动重拉）；DB 空首启走 `flapWs.quoteRate.fullBackfillMinutes`（默认 43200=30 天）全量窗。单测 `node scripts/_test_watcher_quote_conversion.cjs`（85 断言，T15 覆盖持久化分支）。事故档案见记忆 flap-quote-impersonation-incident（两段冒充窗口 20 token 776+ 行，重算脚本幂等）

### Narrative Analyzer (Jev Structured Decision Engine)

**Location**: `src/narrative/`

The narrative analyzer evaluates whether a meme coin's underlying event has narrative value. All LLM decisions run through **Jev** (TypeSafe System One, `api.typesafe.ai`): a structured decision model with three primitives (Choice/Score/Noul), no text generation, one speculative fan-out call per token (~seconds). The former 3-stage generative pipeline (Stage 1 preprocessing → Stage 2 category scoring → Stage 3 token analysis) was fully replaced.

```
Token URL → URL Classification (incl. IPFS metadata unpack) → Data Fetching → Pre-Check (rules, no LLM)
                                                        ↓
                              account/community token? ── yes → prestage Jev (4 questions, P1.2)
                                                        │       rules validation first (account-community-rules.mjs)
                                                        │       → account_based_meme / web3_native_ip_early / project
                                                        │         (rating math in jev-prestage-mapper.mjs)
                              issuer self-launch? ────── yes → prestage Jev (same flow)
                              (brand identity + announcement fingerprint, code-only)
                                                        ↓ no
                              super-IP account? ── yes → super-IP fast track (standard question set + code pre-scores)
                                                        ↓ no
                              standard path: single Jev call (13 questions, J1.10)
                              classification/magnitude/timing/block/W-class/relevance/quality asked atomically;
                              aggregation/thresholds/truncation in jev-result-mapper.mjs (code-side)
```

**Two-path model (user decision 2026-09-24)**: rider coins (issued by a third party riding an influential product) stay on the standard path where W-class math requires the *ridden product* to have extreme influence; issuer self-launched coins (announced by the brand owner's own account) must NOT be gated on current influence — `detectIssuerSelfLaunch` (narrative-utils.mjs, code-only: token symbol/name bidirectionally contains the tweet author's handle/nickname + the author's own text mentions the brand) reroutes them to prestage account judgment. Word-extraction rider coins (C3/CONVICTION class: word from a tweet but unrelated to the author's identity) fail brand identity and stay on W-math. **Cashtag detour (user decision 2026-09-28, C28 iNu case, J1.17)**: when the corpus tweet (incl. in_reply_to parent) contains a `$TICKER` cashtag exactly matching the token symbol/name (normalized equality, `detectCorpusCashtag` code-only), the event is by definition about an existing web3 asset — category is force-routed to W in the mapper regardless of Jev's event_category argmax (iNu case: KOL reply "$INU" about another chain's INU token, token minted 14s later, passed as C-class 67.4 → now W math 25.66 < 60 blocked).

**Publisher proxy (user decision 2026-09-29, C29 Cue/Manus case, J1.18)**: riding a third-party product requires ① an independent new-product launch (or major upgrade — version updates/feature improvements/platform ports don't count, Muse desktop semantics stays blocked) and ② the product's influence is proxied by its publisher (domain-known publisher counts as big IP, e.g. Manus in AI). Question-set wording carries the semantics (super_ip publisher-proxy branch + event_magnitude/dimension2 B-class anchoring), but the effective layer is the code gate `detectPublisherProxy` (four code-readable criteria: expanded-link domain stem equals token name + corpus author followers ≥100k + token name mutually exclusive with author name + no version-fingerprint words) — wording experiments topped out at super_ip 0.31 <0.5, J1.16 precedent. When pubProxyActive (B/C domain only, cashtag detour takes precedence): nameReferentBlock / ride-detour / marketing_gimmick-argmax are exempted, magnitude is anchored to tier A (effTier; S never downgraded, A untouched, Jev's original verdict kept in `magnitudeTier`, anchoring audited in `tierAnchored`); rcp/negativeHardNews gates are NOT exempted (content products keep the C12 ruling). Unit test: `node scripts/_test_publisher_proxy.cjs`.

**Character-IP exemption (user decision 2026-09-28, C25 久留美案, J1.16)**: tokens named after a CHARACTER inside a work (including transliterations, くるみ↔久留美) route to category A (visual IP) — the work's official promo tweet is only corpus for the character, NOT a product announcement; the `routine_content_product` gate is exempted for category A in the standard path (`routineContentProductBlock` category param + argmax gate; superIP channel keeps the gate). Gatekeeping moves to A-class magnitude math: unknown/not-yet-aired characters stay blocked on tier or <60 event score (the C25 case itself: 56.04), known/memed characters (B tier ≈61) can pass. Work-title coins (绣春刀3) are unaffected (category B, gate still blocks).

**Web3-buyer-view magnitude anchor (user decision 2026-10-01, C38 久留美续案, J1.23)**: A-class magnitude is evaluated from the Web3 meme buyer's standpoint ("占到用户角度看叙事"), NOT mass popularity — cute/moe style, geek style (AI/programming/sci-fi/trading-culture themes), and weird/quirky things are native Web3 preferences (style fit alone can reach B tier even pre-air/unknown to the general public); traditional serious style (正剧/历史/文艺) does NOT convert mass fame into Web3 appeal (usually ≤C — a heavily-promoted serious film ranks BELOW a niche cute IP). Question-side rewording proved insufficient (Jev kept C-tier at 0.94 confidence while web3_fit gave strong_fit 0.88 on the same run), so the mapper adds the symmetric positive gate `web3FitAnchored`: category A + strong_fit ≥0.5 + tier <B → effTier anchored to B (J1.18 tierAnchored pattern; never boosts to A/S; D/E tier blocks are bypassed — preference evidence overrides "insufficient magnitude"; A-class only). web3_fit's "niche" boundary is now judged from the buyer's view (anime/game/geek themes are NOT niche for crypto). Unit test: `node scripts/_test_web3_fit_anchor.cjs`.

**Pun/playful-association hijack exemption (user decision 2026-10-01, C40 Binance Inu 案 `0xcaf66eb2…7777`, J1.24)**: "这里我觉得不是『劫持』，而是一种web3用户特有的戏谑/趣味性关联。当然它也必须得是当前的热门新鲜事，否则就成了无病呻吟了" — abbreviation-pun/name-mashup tokens (BI = Binance Intelligence 缩写 × Inu 狗形象) riding a fresh hot event are meme craft, not brand hijacking: they ride the event's incremental heat, not the brand's存量认知. Two-layer fix: ① brand_hijack exemption ③ wording expanded (pun/homophone/image-mashup + fresh-event anchor semantics); ② mapper `punExempt` deterministic gate (J1.16/J1.23 lesson: question-side anchors don't move Jev's scores — 0.72→0.69 — code splitting is decisive). Exemption requires ALL: includeBrandHijack && brandHijackP≥0.5 (only rescues tickets the gate would block) + timing within_7d (当前) + effTier S/A (热门) + `credibleEventAnchor` (analyzer-computed: superIP corpus anchor / issuer self-launch / Binance-Square officially-verified source — event authenticity must be backed). Exempted gates: brand-hijack truncation AND relevance≤10 truncation (weak literal association is intrinsic to pun association — semantic/lv1 = 10 pts still counts into the total); misspelling/quality gates NOT exempt. Audit: `jev.punExempt {timing,tier}` + reason prefix 「戏谑关联豁免(J1.24)」. Legacy impact: 12 stock candidates (P≥0.5+within_7d+S/A) all blocked by the anchor gate (corpora are no-name accounts / phish sites) — zero overturns. superIP fast-track not covered (phase 1). Unit test: `node scripts/_test_brand_hijack_pun_exemption.cjs` (18 assertions).

**World-class-entity Binance-interaction exemption (user decision 2026-10-01, C41/C42 RedCoin 案 `0xe2881a7ac454c473a8b4c858732402154e107777`, mapper-only under J1.24)**: "世界级主体发布产品（不是版本更新），可以豁免跟币安交互" — HSBC naming its HKD stablecoin RedCoin is a world-class entity's product launch; the W-math interaction axis (0-40, its largest weight, designed for Binance-ecosystem narrative tickets) factually scores 0 for non-Binance institutions and structurally drowns such tickets (41.45 < 60 while every other dimension is world-class). Mapper `wInteractionExempt` gate in the W-math branch, ALL four required: ① native W only (isW && not rideDetour && not cashtagForced — detoured tickets keep their own blocking semantics, iNu cashtag detour is meant to block); ② effTier S/A; ③ new-product band P(2)+P(3)≥0.5 (product launch, excluding tier-0 minor updates/version bumps and tier-1 ordinary features); ④ interaction already in the no-interaction band (wInteraction<10 — tickets with ≥10 keep all three axes; removing a positive axis would lose points). Effect: product+timeliness two-axis renormalized to percent ((wProduct+timeliness)/60×100), pass line 60 unchanged; wInteraction still computed and persisted for audit but excluded from the total. Audit `jev.wInteractionExempt {tier,newProductP}` + reason prefix 「世界级主体产品豁免币安交互(C42)」. Unit test: `node scripts/_test_w_interaction_exempt.cjs` (17 assertions). E2E re-run: low 41.45 → high 77.39 PASS.

**Subject-qualification criterion fix (user decision 2026-10-01, C43 土豪猫猫案 `0xfade76ef97ada757be21a4a1aba87d576eda7777`, J1.25)**: block_reason `subject_unqualified` was judging the *narrating account* (anonymous poster) as the subject; the subject is the core entity the token name refers to (image/person/IP/event protagonist) — the posting account's follower count never constitutes subject disqualification, and image-type subjects are judged by the image's own fame (source account followers are a proxy). Semantic-fix-class question edits DO move Jev (unlike score-anchoring edits, J1.23 contrast): re-run flipped block argmax to none; the ticket then died on 事件分 51.7<60 (dim2 9.7 — IG data unfetchable), which led to C44.

**Instagram pipeline fix + two-layer influence handling (user decision 2026-10-01, C44 土豪猫猫案, mapper-only under J1.25)**: "因为我们无法知道在Ins上这个猫的影响力多大…如果引用了Insgram的链接，就认为影响力达标" + mid-turn upgrade to fetch real data via JustOneAPI IG endpoints first. **Three dead links fixed** (the IG data path had NEVER worked): ① `classifyAllUrls` switch missing `case 'instagram'` — classifyUrl identified IG correctly but it fell into the websites bucket → `selectFirstUrl('instagram')` always null → fetcher never invoked (root cause); ② fetcher used dead endpoints (`post-details/v1`/`user-profile/v1` → path 404; real endpoints `get-post-detail/v1`/`get-user-detail/v1` — doc slug ≠ API path); ③ parser read flat `metrics.like_count`/`user`/`taken_at` but the real response is native IG GraphQL shape (`edge_media_preview_like.count`/`owner`/`taken_at_timestamp`/`edge_media_to_caption`; user is triple-nested `{data:{data:{user:{}}}}` + `edge_followed_by.count`). Output shape preserved (buildInstagramSection + pre-check rule 3.5.5 unchanged — the latter now actually fires for the first time). Existing key covers both IG endpoints (code:0, unlike web/html/v1's code:300 package gap). **Two-layer design**: ① real data fetched → goes into state, Jev scores on real evidence (NO anchor); ② IG link present but data unfetched → mapper `igDim2Anchor = A类 && instagramLinked && instagramInfoFetched!==true && dim2<18` → effDim2=18 (J1.23 A-class style-fit band floor; raise-only). Boundaries: doesn't rescue the magnitude gate; W-math untouched (no dim2); web3FitBlock unfit negative gate still blocks; superIP fast-track not covered (phase 1); non-A categories not anchored. Analyzer passes `instagramLinked`/`instagramInfoFetched`. Audit `jev.instagramDim2Anchor {from}` + reason prefix 「IG影响力豁免(C44)」. Unit test: `node scripts/_test_instagram_pipeline.cjs` (31 assertions, fixtures = the case's real API responses). E2E re-run: 51.7 low → high 72.29 PASS via the REAL-DATA layer (dim2 9.7→22.32 on 19,596 likes + 128,737 followers; fallback anchor never triggered).

**Twitter Community pipeline dead-link fix (user decision 2026-10-01, C48 CREPE case `0xeb2b7d5691878627eff20492ca7c9a71228d931d`)**: the community fetch path had NEVER worked — two import-level bugs silently zeroed `twitterInfo` for every token whose twitterUrl is a community link (they all fell to the standard path blind, e.g. CREPE: state twitter section 0 chars → magnitude D + name_referent truncation low, while the community actually has 4,145 members): ① `data-fetch-service.mjs` main community branch dynamic-imported `'../../utils/twitter-validation/communities-api.js'` (resolves to nonexistent `src/narrative/utils/…`; the fallback branch at line ~432 has the correct `'../../../…'`) — fetch threw → `markFailed` → 60min isFailed cooldown meant re-runs didn't retry either; ② `account-community-rules.mjs` `getCommunityWithFullTweets` dynamic-imported a three-level path from a four-level-deep file → always null → every prestage community ticket died `data_fetch_failed` (fixing ① alone would just move the failure). Fix: ① aligned to `'../../../utils/…'`; ② replaced the dynamic import with a top-level static import straight from `communities-api.js` (index.js requires `fetchCommunityById` but never re-exports it; the CJS shorthand module.exports of communities-api.js IS statically analyzable for named imports). E2E re-run: low → mid(2) via prestage P1.9 `web3_native_ip_early` («成员4145，活跃度?»). Unit test: `node scripts/_test_twitter_community_pipeline.cjs` (14 assertions; includes a repo-wide scan that resolves every twitter-validation relative import from its file location — closes the "dynamic import never parsed until executed" blind spot).

**Jev layer** (`analyzer/llm/`):
- `JevClient.mjs` - HTTP client; `ask(state, questions, {label})` → answers (throws on missing answer ids — no error swallowing); 429/5xx backoff
- `jev-questions.mjs` - Standard 13-question set (`buildStandardQuestions({includeBrandHijack})`; version = `JEV_QUESTIONS_VERSION`, per-change bump — history in the file header)
- `jev-prestage-questions.mjs` - Prestage 5-question set `P1.9` (token type / abm name link / abm web3 traffic / community activity / project quality 0-5——P1.5 项目实度题（2026-10-01 WIRED 案裁定）：恒带，账号新(<30d)+实度≥3 豁免 P1.3 年龄降档走粉丝带、<3/缺分 fail-closed 维持 low、推文<5 保留拦；P1.8 判据尺度校准（THESIS 案）：一篇产品陈述即达标 + 链上新币相对尺度；P1.9（C46 MarsCoin 案）：token 类型「币本身即IP」双形状（新称号 OR 社区/文化 meme 主账号，账号随币而生/社区后建、年龄非反证），project 侧显式反例（社区 meme 主账号有官网/品牌/认证不算 project），配套 mapper web3ip 评级不吃年龄门/实度门（`rateProject` opts.accountAgeGate，推文<5 保留拦）+ state 预计算措辞中性化)
- `jev-state-builder.mjs` - `buildJevState` (60k budget) + `buildPrestageState` (20k budget): state assembly with section quotas
- `jev-result-mapper.mjs` - Standard/super-IP answer mapping: stage1/2/3 result construction, scale calibration constants (MAGNITUDE_TIER_SCORES, DIM2_BANDS)
- `jev-prestage-mapper.mjs` - Prestage mapping: project rating table (followers/members floors), abm two-condition verdict, all deterministic math code-side

**Version rule**: editing any question's instructions/criteria requires bumping its version constant (`JEV_QUESTIONS_VERSION` / `JEV_PRESTAGE_QUESTIONS_VERSION`); prompt_type/prompt_version columns identify them (`jev(J1.10/…)`, `prestage-jev(P1.2/…)`).

**Super IP** (`prompts/super-ip/super-ip-registry.mjs`): Known high-influence accounts (CZ, Elon Musk, Binance official, etc.) reuse the standard question set with code pre-scores; tier S (world-class) / A (known).

**Key supporting services** (`analyzer/services/`):
- `tweet-type-classifier.mjs` - Pre-classifies tweets (feeds Jev standard path context)
- `frequent-issuers.mjs` - Registry of ~94 accounts that frequently create tokens
- `pre-check-service.mjs` - Validates data quality before analysis (rules, no LLM). **Time-base rule (user decision 2026-09-23)**: staleness is measured against the **token creation time** (`raw_api_data.created_at`), never wall-clock analysis time — "was the corpus fresh at mint". This applies to expired tweet (10min) / expired video (365d) pre-checks, Jev state timeliness (`buildJevState({now})`), prestage state, and super-IP `calculateTimeliness` — making re-runs/backtests/delayed analysis idempotent. Missing creation time: pre-check skips the expiry rules; Jev state falls back to wall clock. **Same-name rules created_at fallback (2026-09-28, 富贵案)**: rules 0.5/0.55/0.58 read `tokenData.tokenCreatedAtSec || raw_api_data?.created_at` — wss-assembled rows have no `created_at` in raw_api_data (only row-level column + flap's archived `eventTs`), the bare read made ALL watcher-era tokens silently skip the same-name rules. **Rule 0.52 same_name_blue_chip ABOLISHED (2026-10-01, C47 AST 案 `0x265b3982…ffff`, user decision 「A跟C，根治——该怎么样怎么样」)**: the rule (2026-09-28 富贵案立规: AVE normalized-symbol match + blue-chip gate → low hard block) conflated 同名 with 蹭名 — ast.fun vs Alpha Struct Token are entirely different tokens that merely share the symbol "AST" by abbreviation coincidence. A+ C 裁定：**C 为体**——0.52 分支与 `checkBlueChipConflict`（含 C29 同事件 ±1h / C37 叙事锚 / C45 绝对体量 / C34 名实不符四层豁免补丁，全部随之成死代码）已整体删除；蹭名判定移交叙事层（prestage account 路径评级挂 CA 自发宣告票 / nameReferentBlock 截词蹭名 / brand_hijack / cashtag 改道）。**A 的语义由叙事层既有防线天然承载**。验证：族三 10 票重跑——AST 翻案 high（prestage project 4274 粉+实度4.3 自发宣告票）、CREPE 被 Jev「截词蹭名」拦、其余 8 票换正确理由维持 low（no_public_info×4 / abm no_traffic×2 / 13 粉底线 / fetch_failed）。规则 0.5/0.55/0.58 不受影响；`narrative.sameNameCheck.blueChip` config 段与专用单测 `scripts/_test_blue_chip_check.cjs` 一并移除。
- `data-fetch-service.mjs` - Coordinates multi-platform data fetching; includes four.meme IPFS metadata unpacking (`ipfs-metadata-fetcher.mjs`): when API twitterUrl/webUrl are empty, real social links live only in the on-chain metadata JSON (`raw_api_data.meta` IPFS URL) — fetched via multi-gateway (pinata primary, ipfs.io is sunset) and merged into URL classification; unpack success removes the meta URL from the websites bucket
- `web-fetcher.mjs` - Generic website content fetcher (**C41 2026-10-01, jina fallback**): direct fetch (Chrome UA) fails (403/Cloudflare JS challenge/timeout/extraction <50 chars) → fallback to `https://r.jina.ai/<url>` once — free, no key, bypasses Cloudflare (SCMP etc.); **jina requests must NOT carry a browser UA** (r.jina.ai 403s spoofed-Chrome UA, anti-abuse; use `richer-js-narrative/1.0`). `parseJinaReaderOutput` extracts Title/Published Time/Markdown Content; Published Time is prepended into content (`[发布时间: …]`, twitter-section pattern) so the timing question has time info; return shape identical to direct + `fetchedVia: 'r.jina.ai'` audit field; fallback also failing → null (fail-closed = old behavior). Success is cached in ExternalResourceCache as usual. Unit test: `node scripts/_test_web_fetcher_jina_fallback.cjs`
- `account-analysis-service.mjs` - Account/community prestage flow (rules validation → Jev prestage)

**Rules (no LLM)**: `prompts/account/account-community-rules.mjs` - account quality gates, address verification, name matching; `prompt-builder.mjs` only provides `getPromptTypeDesc`.

**Platform data fetchers** (`utils/`): twitter, weibo, github, youtube, douyin, bilibili, xiaohongshu, instagram, tiktok, weixin, amazon, binance-square, web

**Narrative Analysis Engine** (`engine/`): Multi-threaded worker architecture with task queue, polling from DB, concurrency 30. Config in `config/narrative-engine.json` (`engine` + `jev` sections; JSON is the single source of truth — env overrides were removed). Worker task timeout = `engine.taskTimeout`.

### Pre-Buy Check System

`src/trading-engine/pre-check/` — evaluates token risk before purchase:

```
PreBuyCheckService.performAllChecks()
    ├── EarlyParticipantCheckService (first 90 seconds trades, from `wss_price_ticks`)
    │   └── WalletClusterService (cluster detection, reuses trades data)
    └── TokenHolderService (holder blacklist via AVE API)
```

EarlyParticipantCheckService queries `wss_price_ticks` (market-wide per token, rows mapped to AVE-trade-compatible shape so WalletCluster/WalletLabel/TokenHolder are unchanged). An empty window returns real zero stats (reject semantics), not the legacy "probably graduated" pass-through values — those remain only for query errors.

All pre-buy factors stored in signal metadata under `preBuyCheckFactors`. Pre-buy checks only run when the buy strategy defines `preBuyCheckCondition` (first round) / `repeatBuyCheckCondition` (later rounds) — strategies cloned from legacy configs without these fields buy without pre-checks.

**Sniper holding factors**（虚假流动性拦截，2026-09-29 显化之歌 0x1684e8f4…17777 案衍生，用户裁定防线分工：作弊票 TPA / sniper 聚集票 sniperPct / uniformBuyCluster 已弃用——因子保留计算不被策略引用）：

- **sniper 判定 = 运行时条件判断纯函数**（`src/trading-engine/pre-check/sniper-detector.js` `isSniperProfile`，不落 wallets 标签——打标签方案已否决回滚）：`tokenCount >= 100 AND (medianHoldSeconds ∈ [0,300) OR (null AND sym < 0.1 AND 笔数>=40))`，sym = |buy−sell|/(buy+sell)；排除 hold>=300（库存调仓/CEX 热钱包）与协议地址 0x000006b7…0091（four.meme 内盘官方，`PROTOCOL_ADDRS`）。画像源 `wallet_offline_profiles.profile`（step4 预计算几天一更）；画像 miss = 非 sniper。与 wallet-scorer `_isSniperLike`（tc>=300，TPA 豁免大户判定的机器人检测）语义不同勿混
- **因子口径**（`EarlyParticipantCheckService._calculateSniperHolding`，复用 90s 窗 trades 零新 tick 查询）：每钱包净持仓 = Σ买 token_amount − Σ卖 token_amount，只留正持仓池；`earlyTradesSniperHoldingPct` = Σ(sniper 正持仓)/Σ(正持仓)×100（拦截写法 `< 50`），伴随 `earlyTradesSniperWallets`（次要门 ≥2 有效）/ `earlyTradesSniperHolders` / `earlyTradesSniperCovered`。covered 语义与 netBuy/uniform 同构：age>90s 或 launchAt 缺失 → 0 值放行（null 会让 `<50` 恒 false 误拦）
- **画像查询缓存**：`SniperFlagCache` 实例级 Map（进程生命周期，miss 也缓存为 false；查询失败 fail-open 全放行且不写缓存），批 100 IN 查询走注入 supabase（两引擎均 dbManager service key）；回测 bc4f756e 性能口径——缓存命中后零重查
- **验证结论**（182 创建锚定口径 354 closed 票）：拦 pct>=50 → 拦 201 票（亏率 78.6%），避免亏 22.50 / 放弃赢 11.56 BNB，留票净额 −6.7 → +4.2；已知盲区：协同簇小号（tc<100）归 TPA/uniformBuyCluster，画像 miss 低频钱包
- **单测**：`node scripts/_test_sniper_factor.cjs`（59 断言零 DB：判定矩阵/缓存/净持仓聚合/performCheck 集成/源码口径五节）

**Top1 买入集中度因子**（单钱包主导拦截，2026-09-29 buy-dominance 扫描案上线；用户裁定「买的时候就一个钱包占据绝大多数流动性（购买量）」才拦——叙事好、后期多人稀释的不算）：

- **口径**（`EarlyParticipantCheckService._calculateTop1BuyShare`，复用 90s 窗 trades 零新 tick 查询）：首窗**纯买入量**（BNB）按钱包聚合，`earlyTradesTop1BuySharePct` = 最大钱包买入/窗口总买入×100，伴随 `earlyTradesTop1BuyBnb` / `earlyTradesBuyBnb` / `earlyTradesTop1BuyCovered`。**刻意不含卖腿**（既有 `walletTop1VolumeRatio` 是买卖混合口径，不重复）；协议地址**双地址层剔除**（wallet 层 COALESCE 后协议行落 tx.from EOA，trader 裸字段层恒可识别）。扫描脚本 `scripts/find-buy-dominance-tokens.cjs`（182，75 万买行 0.5min）。**钱包口径已切 sender（2026-09-30 案 A，0x1de460 GMGN 路由案）**：`_mapTickRow` 单点 `wallet_address = sender_address || trader_address`（NULL 回退 = 旧行为等价），top1/sniper/netBuy/uniform/WalletCluster 全下游自动生效——公共路由行不再聚成单一巨型钱包虚抬集中度；GMGN 主导盘负信号由下述 routerPct 因子显式接管
- **拦截写法**：`earlyTradesTop1BuySharePct < 60 OR earlyTradesBuyBnb < 1`——OR 腿复刻验证口径的 1 BNB 尘埃豁免（首窗买入不足 1 BNB 份额噪声大不拦）。covered 语义与 sniper 同构：age>90s 或 launchAt 缺失 → 0 值放行
- **验证结论**（share≥0.6 且首窗≥1 BNB，109 closed 票）：亏率 86.2%，避免亏 12.684 / 放弃赢 0.559 BNB（22:1）；单实验 9e413cbe 55 票拦 28 票净额 +0.198→+2.072。**与 sniperPct 互补**：7777 家族（top1 sniper 率 69%）画像门可拦，4444 家族（低频新钱包 sniper 率 3%、单笔可占 98%）只靠本因子；叙事 2/3 级命中 0 张零误伤。0.6→0.7 少拦的 59 票净 -6.6 BNB（0.6 是正确档）
- **单测**：`node scripts/_test_top1_buy_share.cjs`（33 断言零 DB：聚合矩阵/0x01bf 案数值锚定/performCheck 集成/源码口径四节）
- **配对回测 expired 洞（2026-09-29，a7e34059 基线 vs 8bd5ef0b 加门，9e413cbe 克隆同窗并发）**：净额打平（拦 5 亏票 +0.658 vs 20 张「过期票」晚进车 −0.914 恰好抵消）——根因 = top1 因子 covered=0（>90s 窗过期）0 值放行语义 × 买腿 30min 年龄窗错配，主导票 35-115s 高价接盘。象限验证：全部盈利买点 ≤74s（early_clean +1.611），90s 上限零误伤。修正写法 `tokenAgeSec < 90 AND earlyTradesTop1BuySharePct < 60 AND earlyTradesTop1BuyCovered == 1`（修正版回测 120caca6 预测 ≈ +2.23）

**聚合路由买入占比因子**（GMGN 主导盘拦截，2026-09-30 0x1de460 案上线，与 sender 口径切换配套——单切口径不配套新门会放走差票）：

- **身份鉴定**：`0x1de460f363af910f51726def188f9004276bf4bc` = **GMGN BSC 聚合路由**（TransparentUpgradeableProxy 代理壳 1810 万 tx 多链部署；init data 内嵌 GMGN fee collector `0xb8159b…931c9c8` 自证 + impl 选择器 pancakeV3SwapCallback/algebraSwapCallback/V4 swapCallback/多协议结构化 swap 聚合路由指纹 + Dune GMGN dashboard 直接引用）。flap 27.9% 成交行 trader 落它——GMGN 是 BSC meme 盘最大散户流量入口之一，用户自有钱包直连路由下单（tx.from = 真实买家）
- **口径**（`EarlyParticipantCheckService._calculateRouterShare`，复用同一 90s 窗 trades 零新查询）：首窗纯买入量（BNB，与 top1 同窗同构）中 `trader_address`（msg.sender 层，**与 wallet COALESCE 无关**）落在 `AGGREGATOR_ROUTER_ADDRS`（现仅 GMGN 一址，Set 便于扩展）的行占比×100 → `earlyTradesRouterPct` / `earlyTradesRouterCovered`。covered 语义与 top1 同构（age>90s 或 launchAt 缺失 → 0 值放行）
- **对拍依据**（8aca25e2 回填 16,393 行后双口径终审）：被拦 signal 459/token 192；sender 口径翻案 174（top1 62-87 → 4.9-20.5），但假想放行 TP **-8.566 BNB**（亏票 114/173=66%、单票均值 -0.0495；峰值 +45 是 7777 家族对倒深 V 幻觉）——router 主导盘 = 散户热度/bot 蜂拥盘，top1 门歪打正着当「bot 盘代理」；仍拦 4 票（真实主导）TP +0.019。拦截写法 `earlyTradesRouterPct < 60`（对拍锚定档）
- **配对回测验证（2026-09-30，R0 `8e9fa667` top1 门 vs R1 `21fe0e8b` top1+router 门，同窗 09-29 14:51Z→09-30 10:00Z both、同 sender 新口径引擎，差分 = router 门净效应）**：R0 73 票净 -0.709 vs R1 48 票净 **+1.099 BNB**，**净效应 +1.808**；拦掉 25 token 全部 routerPct 63-86% 且 top1 全 <60（sender 翻案票形状，门精确接管）、亏 20/赢 5（亏率 80%）、避亏 -1.680 BNB；唯一显著代价 BM +1.016（放弃）。共同票差异仅 2 个（时序扰动 ±0.1 量级）
- **回测装载链**：BacktestEngine `TICK_SELECT_COLUMNS` 加 `sender_address`（columnsTag 漂移 → 缓存全量重拉一次，设计内）+ `_loadWssTicks` tick 对象透传 + replay 索引伪行透传
- **单测**：`node scripts/_test_sender_switch_and_router.cjs`（46 断言零 DB 六节：COALESCE 矩阵/router 矩阵/翻案票形状集成/协议双地址层剔除/回测装载链/源码口径）；旧 `_test_top1_buy_share.cjs` 零改动仍过（无 sender 输入 COALESCE 等价旧行为的机器证明）

**FA 钱包口径切换——holders 族**（GMGN 案 B，2026-10-01，bSTOCKS 0x0ad6…7777 案衍生；案 A 只切了 EarlyParticipantCheck 的 90s 窗因子，FA 层聚合漏在审视清单缝里——42 个真实散户被 GMGN 合并成 1 个「持有人」，`holders > 5` 买门严重失真）：

- **改动**：FA `processTick` 单点 `walletAddr = sender_address || trader_address || null`（NULL 回退 = 旧行为等价）；切 wallet 口径的聚合：`holderCount`（holders 因子/`_holderSeries` holderTrend 原料，新增 `_walletNetTokens` map）、P 组 top3/top5 净持仓集中度、sniperHolderShare top20、bigHolder 族交叉（`_buyerVolume` × 净持仓）、K 组对敲重叠（`_buyerAddresses`/`_sellerAddresses`/`_buyerVolume` 等——trader 口径下经路由的对倒反成「GMGN 买 GMGN 卖」假重叠）、cumBuy（`_traderBoughtTokens` 改名 `_walletBoughtTokens`）、滑窗（`_slideTraderCounts`/`_walletFirstTs`）、smartBot 名单匹配（EOA 维度名单）
- **刻意不切两处**：①`_traderNetTokens`/`_traderMaxNetTokens`（TPA 基准——`wallet_offline_profiles` 画像库是 trader 口径建的，单切持仓侧会画像 miss 错配，二期整套切；GMGN 在 TPA 里仍呈现为单一巨户合并像）②`uniqueTraders`（classifier metrics 契约字段，与离线 classifyToken/token-classifier `tick.traderAddress` 口径锁定，防在线/离线分类输入漂移）
- **链路**：SharedTickConsumer `TICK_COLUMNS` 加 `sender_address` + processTick 透传（实时链）；BacktestEngine `_loadWssTicks` 09-30 已透传（回测链零改动、columnsTag 不漂移）+ **`backtest.stripSenderAddress` 对照臂开关**（H0 臂剥回放对象 sender → 消费侧全部 COALESCE 点回退 trader = 修正前行为 bit-identical；只剥内存 tick 不动 BacktestTickCache raw 行，H0/H1 两臂共用同一缓存文件）；OPB 全史路径/离线 build-token-profiles 不动（trader 口径链）
- **实证**（bSTOCKS 79 ticks 重放对拍）：修正前 holders=6（与实跑 BUY 信号逐位吻合）→ 修正后 holders=44（`_walletNetTokens` 48 键 44 净持仓>0）；`holders > 5` 从「险过」变「明确放行」，GMGN 高占比盘从「误拦」变「正确评估分散度」
- **配对回测**：`scripts/create-holders-denomination-pair.cjs`（H0 旧 trader 口径 vs H1 wallet 口径，基底=02c60e50 buy-v2 v4 实跑；182 串行启动）
- **单测**：`node scripts/_test_fa_wallet_denomination.cjs`（40 断言零 DB 六节：COALESCE 矩阵/GMGN 合并复现（含零 sender 旧行为 bit-identical）/K 组·滑窗·smartBot·cumBuy/读取时聚合出口/链路透传源码口径（含 strip 开关接线）/买门翻案形状）

**tokenAgeSec 秒口径年龄因子**（2026-09-29 同案上线；用户裁定方案 B——`age` 单位是分钟、改单位会静默翻转存量实验条件语义（红线），故新增独立秒键）：

- **口径**：`(now − createdAtMs)/1000`，与 `age` 同创建锚 ×60 关系；FA `_buildFactorMap` 字面量键（getFactorKeys 探针自动收 → 策略 condition 可直接引用）+ FactorBuilder `buildFactorsFromTimeSeries` 同源推导（`age * 60`，两条路径一致）。秒级买窗写 `tokenAgeSec < 90`（ConditionEvaluator 字面量 parseFloat 支持小数，`age < 1.5` 亦等价）。缺锚 → `_createEmptyState` 注册时刻 `Date.now()` 兜底（age 同行为）
- **preFilter 提取**：`ConditionEvaluator._walkBuyRange` 识别 tokenAgeSec 比较子句，/60 归一到分钟区间与 age 子句合并（AND 取最紧/OR → null 降级）；FA preFilter 越界跳过对新键同等生效
- **勿混 E 组 `_ageSec`**（首 tick 锚点，tickFlow 分档内部量）：锚点不同，非倍数换算关系
- **时序快照落库**（2026-10-01 裁定 A/B 都做）：`buildFactorValuesForTimeSeries` 白名单含 tokenAgeSec（新信号 trendFactors 直读，signals 页因子 chip 用；值 = age×60 同源）；旧信号由 signals 页前端 age×60 推导兜底（`_renderConditionFactorChips`，chip 标注「age×60 推导」）；tokenCycleAgeSec 仍不落（可差分推）
- **单测**：`node scripts/_test_token_age_sec.cjs`（31 断言零 DB：FA 发射/键审计/真值表/preFilter 提取/集成/时序重建/快照白名单/前端推导源码口径八节）

**signals 页因子 chip 条件驱动化**（2026-10-01，experiment_signals.js）：买/预检查条件有啥因子展示啥——`_renderConditionFactorChips(condition, metadata)` 内部 `_parseConditionClauses` 逐子句解析（同名因子多子句各自成 chip，如 narrativeRating == 2 OR == 3；支持 `!=` 与 `IS [NOT] NULL` 子句），值查找 trendFactors → tpaFactors → preBuyCheckFactors → metadata 顶层；预检查区块删除四个废弃硬编码块（趋势因子网格/黑白名单持有者/早期参与者明细/强势交易者），保留条件检查详情、TPA 明细块与原始交易数据链接（挂在预检查条件行）。


**Narrative rating direct call** (`narrativeCallCondition`, strategy field): when a buy strategy defines it and the condition holds at fire time (evaluated over the same fire factors as the strategy condition — `age`/`earlyReturn`/activity/trend, NOT narrativeRating itself), the buy leg synchronously calls `NarrativeAnalyzer.analyze()` via `NarrativeDirectCaller` (`src/trading-engine/pre-check/NarrativeDirectCaller.js`) after the blacklist check and before the pre-buy check. Jev is seconds-fast; 30s timeout via Promise.race (the timed-out analysis keeps running in the background, upserts, and the next round hits the cache), failure/timeout normalize to 9 and pass through — the strategy decides via `narrativeRating` in `preBuyCheckCondition`. Not configured / not triggered = always 9, identical to legacy behavior. BacktestEngine uses the same direct-call path (temporal leakage: analyze uses current corpus on historical tokens — absolute returns are not real-time achievable, compare relative increments only). Trigger trail lands in signal metadata as `narrativeCall`. Condition syntax: AND/OR only — `&&`/`||` are silently truncated (rest of the expression is dropped, no error).

**Narrative-veto signal short-circuit** (2026-09-27, user decision): once the direct call returns `numericRating=1` (low = terminal narrative veto), the token is registered in the engine's in-memory `_narrativeBlockedTokens` set — subsequent buy-leg fires return before the signal row is written (no signal, no repeated narrative call / pre-buy checks). Exemption (`shouldBlockOnNarrative` in NarrativeDirectCaller.js): `precheckStage === 'address'` (announcement-race shape, the PrecheckFailRetryService retry domain) AND token age < 300s keeps the token un-blocked so the 5min re-analysis window can still rescue it — window expiry aligns with the retry service stop, so no rescue-after-block race. Only applies to strategies that define `narrativeCallCondition`; rating 9 (unknown, non-terminal) is never blocked. In-memory only — restart loses the set, first fire re-checks via cache and re-registers (cost: one signal row). Unit test: `node scripts/_test_narrative_signal_gate.cjs`.

**Narrative results are token-level global cache**: `token_narrative` is keyed by `token_address` (global upsert) and is NOT attached to experiments — the same token shares one result across all experiments/callers; `analyze()` reuses any valid (`is_valid`) cache hit regardless of experiment, `ignoreCache: true` forces re-analysis. `experiment_id` is no longer written on save (legacy values in old rows are left as-is); to invalidate stale results use row delete or `NarrativeRepository.updateIsValid(address, false)` — a cleanup mechanism (e.g. invalidate all rows when the narrative module changes) is planned but not built yet.

**Token category output** (`token_narrative.token_category`, 2026-09-27): narrative analysis writes the token's classification via `deriveTokenCategory(prestageDataToSave, stage1DataToSave)` (NarrativeAnalyzer) — three mutually exclusive sources: prestage path `project`/`account_based_meme`/`web3_native_ip_early`, superIP channel `super_ip_fast` (same prestage slot), standard path `event:<A~W>` (stage1 eventClassification.primaryCategory). NULL (precheck fail / no_data) does NOT write the key — repository keeps the old value, so a failed re-analysis never erases an already-saved category. DDL: `scripts/sql/add-token-narrative-token-category.sql` (⚠️ deploy-order red line: column must exist before process restart, same as gmgn_info).

**Precheck-fail retry service** (`src/narrative/engine/PrecheckFailRetryService.mjs`, 2026-09-27 fPay/FOMOPAY announcement-race cases; 2026-09-28 no_public_info domain added, FOMOON case): a resident scanner on the engine main thread (`config/narrative-engine.json` → `engine.precheckFailRetry`) rescues two fail shapes (details shapes are mutually exclusive, resolved by `classifyFailShape`): `address` (announcement race — issuer mints first, posts the CA tweet seconds later) and `no_public_info` (corpus arrives late — tweet/website added minutes after mint; four.meme metadata & IPFS are immutable-empty, GMGN link aggregation is the only mutable source, C10/BRF conclusion). Retry fires when ALL hold: row shape hits either domain; token age (wss_events earliest token_create, missing anchor = no retry, fail-closed) < per-domain window — address `retryWindowSec` 300s / no_public_info `noPublicInfoRetryWindowSec` 1800s (FOMOON: tweet 12m38s after mint; independent windows, address semantics unchanged), hard stop out of window; new ticks since `analyzed_at` ≥ `tradeSurgeThreshold` (20 — incremental, not total, so it self-throttles); per-token attempts < 5, ≤2 per scan. no_public_info retries additionally: `ExternalResourceCache.invalidate('gmgn:token:bsc:<addr>')` first (the GMGN success cache maxAge is 1d — without invalidation every retry hits the stale empty-socials cache and spins; invalidate failure → skip this round, no analyze burn, no attempt counted) and pass `enrichSocialByGmgn: true` to `analyze` (without it the GMGN enrichment chain never runs — retries would always re-fail). GMGN paid-quota policy extended by user ruling from "direct-call only" to include retries (low frequency: ticks gate + attempts cap + per-scan cap). Success = trigger shape no longer failing (corpus arrived then Jev rated low counts as resolved). DB access goes through **dbManager (service key)** — wss_price_ticks/wss_events are RLS-empty for the anon key used by NarrativeRepository. Unit test: `node scripts/_test_precheck_fail_retry.cjs` (35 assertions, zero DB).

### OnlineProfileBuilder（在线代币分类；pumpfun 批 3.1 回迁）

`src/services/OnlineProfileBuilder.js` — 内嵌 FourMemeWssTradingEngine 的实时代币分类器，交易活跃度下降时触发（双门：idle 60s 无 tick / bigTickIdle 600s 无 ≥clsBigTickBnb 大额 tick；`_onFactorsUpdated` tick 入口 + 60s `_scanIdleTokens` 扫描补救死后零 tick token），写 `token_profiles` 表（token_address 全局 PK upsert，source='online'，不挂实验维度防级联删）。阈值判定与离线 classifyToken 共用 `scripts/shared/token-classifier.js`（单一真相）；metrics 直接读 FA state 标量（`_clsTicks`/`_relHighest*`/`_lastBigTickAt`/afterFirst9s 三元组），maxMarketCap = 可靠价峰 USD × totalSupply。

- **opt-in**：`config.fourmemeWs.onlineProfile.enabled` 默认 false（default.json 与实验级均可配；both 实验引擎级配置恒读 fourmemeWs 段）；启动时构造——改 config 须重启实验进程。BacktestEngine 不嵌（回测无写表副作用）
- **TPA 联动**：落库成功回调 `onProfileClassified` → `TokenPositionAnalyzer.upsertTokenProfileCache` 喂分类缓存（修 stuck-null；TPA 未启用时传 null 不挂钩）
- **重启过渡期全史路径（2026-09-27 修复，失真首例 0x125a…17777 真实 +292% 落库 0.05%）**：水位对齐之前的存量活跃 token 不派发 create → FA tick 自动建 state（`registered!==true`）→ FA 价格史不完整（`_relFirstPriceBnb` 锚在重启后中途价、totalSupply=0 mcap 恒 0）。此类 token 分类时**自动改走全史 DB 路径**：wss_price_ticks 全史（`mapDbTickRow` 共享映射）+ classifyToken（与离线同口径，base=真实首价）、totalSupply 取 wss_events token_create（flap 固定 1e9）；minTicks 门放行给 classifyToken 自带 MIN_TICKS 判（FA tradeCount 只计重启后 tick）。失败 fail-closed：不写失真行、解除 `_profiled` 标记待扫描重试，token 被 prune 后由离线 build-token-profiles.cjs 重跑兜底。registered=true 的常规路径零变化
- **单测**：`node scripts/_test_token_classifier.cjs`（分类阈值/visible_at/FA 对拍/触发门/扫描/过渡期全史路径 dbManager 打桩，零 DB）；2026-09-27 起在虚拟实验 c5945f36 实跑开启

### Token Position Analyzer（TPA，触发点 as-of 钱包画像；pumpfun 批 4 回迁）

`src/services/TokenPositionAnalyzer.js` — 代币触发门命中时（write-once，一 token 一次）对 top20 持仓者做 as-of 画像，产出 `TPAPre_*` 因子族（17 持仓键）注入 FA（`setHoldingFactors`/`setRetentionBasis` 静态注入 + `setAsofMs` 冻结审批价），FA `buildFactorMap` 尾部 spread 后 `TPAAnalyzed`/`TPAPre_retention`/`TPAPre_asofRelFirst` 可读；策略 condition 引用未触发的 `TPAPre_*` 恒 null → ConditionEvaluator false = **fail-closed 不买（去门控化）**。verdict 收口 `zhuangCondition`（默认 `TPAPre_tokenScore > 2 AND TPAPre_zhuangRetailRatio > 0.3`；`∞` 庄散比落表 null + `TPAPre_zhuangRetailRatioInfinite` 布尔）。

- **BSC 新钱包中性分 2.2（2026-09-29 用户裁定，先观察再定）**：`wallet-scorer.js` `scoreTokenFromHolders` 内（TPA 落表链专用；web 手动评分不走）非 creator 新钱包——`source==='realtime' && tokenCount<=1`（与 creator 门同源同阈值）且 `!isCreator`（creator 维持 1.5 档不叠加）——分数 < `NEW_WALLET_NEUTRAL_SCORE`(2.2) 抬到 2.2，只升不降，breakdown 打 `newWalletNeutral`+`scoreBefore`。★与 pumpfun 母版的有意偏离：母版 2026-08-19 明确否决一般新钱包豁免（FfeDVN2n 同秒 burner 簇案，solana 节奏）；BSC 节奏不同（gas 廉价 + 单块 3s 装整簇），触发源 = THESIS 0xa21bb591…7777 案（158s 死盘后 44 新钱包单块 burst 拉爆毕业，burner 画像被排他上界切空 0.27 分把 tokenScore 拖到 1.445 被 2.2 门拦；豁免后 ≈2.56 过门）。观察期后去留由用户再定，回滚 = 删该块。单测 `_test_wallet_scorer.cjs` 第 12 节 F-J + THESIS 形状锚定。

- **opt-in 挂载**：`config.tokenPositionAnalyzer == null` → 不构造（存量实验零影响）；段存在才构造并走 trigger fail-fast（时间门 blocks/ageSeconds 恰一，数量门 tradeCount/buyBnb/minHolders 非负）。live/回测引擎 `_onFactorsUpdated`/主循环触发，落表 `token_position_analyses`（enforce 落表标记；**shadow 姿态默认 enforce=false，策略条件暂不引用 TPAPre_*，纯观察**）
- **三路径画像**（钱包=地址属性，跨平台无过滤）：`wallet_offline_profiles`（step4 预计算）fresh 直用 / stale 增量 `mergeOfflineProfile` 合并 / miss 实时拉 `[asOf-14d, asOf]` ticks 现算（`wallet-profile-builder.js`，bad_action 口径单一源）
- **retention 基准**：触发刻从 `faState._traderMaxNetTokens` 峰值枚举大户集（含已清仓）冻结 `netZAtDecision`，此后每 tick 用 running `_traderNetTokens` 求和重算（净卖 → <1 走人实锤）
- **回测防前视**：BacktestEngine `_alignClassifiedAsOf=true` — `category_visible_at`（回退 `classified_at`）> asOf 的 token_profiles 分类视为未见（bad_action 不计）；回测侧 `setHistoricalTicks` 内存索引 + `persistSink` 走 BacktestWriteBuffer 批量落表
- **离线构建（step4）**：`build-wallet-profiles.cjs`（182 专用，`--threshold 3 --days 14`）两阶段聚合（HF 筛选 → 64 磁盘桶 → token_profiles 预查 → buildProfileFromTicks(asOfMs:null)），跑完删 `data/offline-cache/wallet_offline_profiles.jsonl.gz`；**必须在 build-token-profiles 之后跑**（依赖 flash_crash_period）；上线读侧前必须先全量跑完（`mergeOfflineProfile` 的 `aggregatedTradeCount` 哨兵 throw 防错配）
- **web 展示**：`/experiment/:id/position-analysis`（PositionAnalysisService + `experiment_position_analysis.*`），verdict/holding_factors/分类对照/表达式过滤

### Chain Support (BSC-only)

`src/utils/BlockchainConfig`: BSC only. Historical experiments on other chains (solana/base/ethereum) remain readable for display — unknown chain IDs fall through `normalizeBlockchainId` as lowercase originals instead of throwing; trading/config lookups throw for non-BSC.

### Web Interface

`src/web/` + `src/web-server.js`:
- Trading engine dashboard
- Narrative analyzer UI (`/narrative-analyzer`, `/narrative-tasks`)
- API: `/api/narrative/analyze`, `/api/narrative/tasks`, `/api/narrative/result/:address`
- K-line / current prices come from `wss_price_ticks` (via `src/web/services/tick-kline-service.js`); AVE tool endpoints (`/api/ave-*`) are kept for ad-hoc analysis

### Database

Supabase backend via `src/services/dbManager.js`. Key tables: `experiments`, `strategy_signals`, `trades`, `token_holders`, `wallets`, `experiment_tokens`, `experiment_time_series_data`, `token_monitoring_pool`, `wss_price_ticks` (raw trade ticks; UNIQUE(tx_hash, log_index), first writer owns the row; watcher 写入行 experiment_id=NULL; `sender_address` = 真实交易发起者 tx.from（BSC 恒 EOA，watcher 侧 SenderResolver 解析，2026-09-30 0x1de460 公共路由案——`trader_address` 是事件 msg.sender，0x1de460f3…4bc = **GMGN BSC 聚合路由**（代理壳 + init data 内嵌 GMGN fee collector 0xb8159b…9c8 自证），flap 27.9% 行落它；消费侧已切 sender 口径（案 A 同日）：早期窗口因子 wallet 聚合 COALESCE(sender, trader)、router 因子判 trader 层、协议地址双地址层剔除；FA holders 族已切（案 B 2026-10-01，见 Pre-Buy 节）；TPA 基准/离线画像仍 trader（二期）；NULL=未解析回退 trader（= EOA 直连旧行为等价）；8aca25e2 被拦窗 16,393 行已回填（备份 data/backfill-8aca-sender-backup.json）；存量全量回填 42 万行暂缓；DDL `scripts/sql/add-wss-ticks-sender-address.sql`）；`quote_token` 标记 flap 非 BNB 计价盘——collector 按三级汇率源换算 price_bnb/bnb_amount 后落库（2026-09-30 wTCENTx 案：① PCS V2 quote/WBNB reserves ② PCS V3 quote/WBNB 各 fee 档 liquidity>0 最深池 slot0 ③ PCS V3 quote/USDT 同门槛 → ÷ bnbUsd 中转；零流动性 V3 池挂价不可信必须拦——同案 WBNB 对挂价偏离真值 20%），三级全 miss 跳行（宁跳不冒充），BNB 盘为 NULL，历史 ~10,971 盘未回填), `wss_events` (token_create/graduation/heartbeat/token_quote_set 低频事件通道，token 级全局表不挂 experiment 维度；token_quote_set 为 flap quote 映射持久化行，payload 含 blockNumber/logIndex 供水位增量回放), `wallet_offline_profiles` (step4 钱包离线画像，address PK 全局无 platform), `token_position_analyses` (TPA 触发落表，UNIQUE(experiment_id,token_address,trigger_no); CASCADE 挂 experiments), plus narrative-specific tables managed by `src/narrative/db/NarrativeRepository.mjs`.

Experiment deletion is DB-level: every experiment-owned table carries `experiment_id → experiments(id) ON DELETE CASCADE` (see `scripts/sql/migrate-experiment-cascade-delete.sql`), so deleting the experiments row removes all its data — the web layer just deletes the row, no per-table cleanup.

## Configuration

- **`config/default.json`** - `fourmemeWs` section (contracts, reconnect, tickBuffer, debounce, live execution params) + strategy defaults (buyTimeMinutes: 1.33, earlyReturnMin: 80, earlyReturnMax: 120)
- **买/卖腿去抖（2026-10-01 修正 1500/5000/0 → 200/1000/200，fourmemeWs+flapWs 两段）**：`signalDebounceMs` 1500 是 pumpfun 母版 08-18 重复买入事故的临时补丁值（母版当天 v3.10.1 因「去抖饥饿事故」9a86E7n2 案已降 100ms≈0.25 slot；`signalDebounceMaxWaitMs` 兜底母版从未上线），BSC 迁移 Phase 3 误抄成默认——热门票全程连续 tick 静默分支永不满足，被饿到 5s 强制采样一次（0x7e3b…7777 案：条件 21:01:26 已全齐、fire 拖到 21:01:29，TPA as-of→fire 价差 +23%）。修正语义 = slot 级合并：200ms≈0.25×BSC 0.75s 出块，同 slot 批量推送并成一个 burst、slot 结束即评；maxWait 1000 退化为极端兜底。`sellDebounceMs` 0→200：走去抖的默认卖腿（TP/移动止盈/保本/时间衰减）进 SellConfirmDebouncer 200ms 确认窗（与买腿语义相反：首真起计**不重置**、窗口内恢复 clear 不卖、fire 重评仍真才卖——「卖的时候怕被震下去」防线）；bypassDebounce 腿（P1-P9 针臂/硬底/RSI/毕业臂）、止损双腿、毕业卖、强平全走立即路径不受影响。实验级 `fourmemeWs.signalDebounceMs` 等键可覆盖（引擎参数，不受 watcher 收权影响）；跑中实验须重启进程才生效
- **`config/narrative-engine.json`** - Jev client settings (`jev` section: endpoint/model/TYPESAFE_API_KEY env/timeout) + engine concurrency/timeouts
- **`config/.env`** - Environment variables (ANKR_WS_URL, AVE_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, MINIMAX_API_KEY, ENCRYPTION_KEY for live wallet private keys, etc.)

## Strategy Parameters

- **Buy timing**: 1.33 minutes after token creation
- **earlyReturn range**: 80-120% (key buy signal)
- **Take profit**: +30% sell 50%, +50% sell remaining
- **Observation window**: 30 minutes

## Card Position Management (migrated from rich-js, 2026-09-27)

Token-level card ledger（用户裁定：组合级现金卡不迁）。**机制开关 = `experiment.config.positionManagement.perCardBNB` 存在且 >0**；不配 → 卡牌字段全忽略，存量实验零变化。

- **策略级字段**（买/卖腿均可）：`cards`（正整数；卖腿额外接受 `"all"`=全清）+ `cooldownSec`（正数秒，独立于卡牌，任何实验可用）。归一化在 `StrategyEngine.loadStrategies` 的 `normalizeCards`（脏值→null=旧语义）
- **买入**：金额 = `perCardBNB × (strategy.cards ?? 1)`（Decimal；virtual 现金门不足返 0=买失败不降张；live 用 `_buyAmountFor(signal)` 不走 PM cash 门，链上余额才是真门）。买成功 `_tokenCards[addr] += cards`
- **卖出 sizing**（`_emitSellSignal` 解析进 signal）：`soldN = cards==='all' ? tokenCards : min(cards, tokenCards)`；`sellPct = soldN >= tokenCards ? 1 : soldN/tokenCards`（全清腿恒精确 1 → PM `remainingAmount.eq(0)` 删仓判据成立）。未启用/未配 cards → 旧 `sellPercentage ?? 1` 路径
- **卡账本**：引擎实例 `_tokenCards = Map()`（原始地址 key，同 `_roundLedger` 口径）；维护在 `_executeSell` 成功分支——`cardTrade ? (after>0 ? set : delete) : (fullyClosed ? delete : 不动)`（强平腿/sellPct=1 腿不带 cardTrade 但全清→delete 防重买后卡数虚高）
- **重启恢复**：trades.metadata 记 `cardTrade: { cards, before, after }`（信号构造时点的绝对值）；`_loadHoldings`/`_loadHoldingsLive` 重放读 `after` 绝对值 set/delete。**重放精度钳制 + 单票隔离（2026-09-29 Adventures 案）**：DB 金额列是 double，实时链路 PM 20 位 Decimal 余量 Number 化落库后与重放 Decimal 累加值有 ~1e-12 相对尾差——全清腿卖量恰好略超持有量被 PM 严格 `lt` 校验拒绝，旧代码此 throw 逃出循环 →「加载持仓失败」→ 一票尾差全灭 49 票持仓恢复。修复（E5d 同族）：重放卖单遇 `Insufficient token balance` 且差异 ≤ 相对 1e-9（double 往返固有误差量级）→ 钳到持有量重试（余量归零删仓 = 实时全清语义）；真超卖（更大差异 = 数据异常）不钳制照常失败，且单票失败只跳过该票（error log 留痕）不中断其余恢复。单测 `node scripts/_test_holdings_replay_precision.cjs`（21 断言零 DB，T0 案发现场反证/T1 钳制/T2 真超卖/T3 隔离/T4 回归/T5 卡账本独立）
- **冷却**：`StrategyEngine.evaluate` 内 maxExecutions 检查后；期内腿返回 null→低优先级腿可顶上（与 maxExecutions 跳过语义一致）。回测传虚拟时钟（`recordStrategyExecution` 第 4 参），实时墙钟缺省
- **UI**：create_experiment.html 表单键 `cards`/`cooldownSec`/`per_card_bnb`；`card.dataset.rawConfig` 整包存复制源策略，collectFormData 的 `mergeRawConfig` 合并表单白名单外键（复制链路保真 bypassDebounce/sellPercentage 等无 UI 输入字段）
- **单测**：`node scripts/_test_card_position_mechanisms.cjs`（归一化/冷却/Decimal 精度边界三节，零 DB）

## 引擎级止损双腿（2026-09-27，c5945f36 11 买 0 卖冻结实跑触发）

E5c 8 腿对「不冲毕业的 flap 小票」结构性盲区的保命兜底（f3ae56d3 回测 / E5e 回测 / c5945f36 实跑三次实证：grad<0.05 够不着 P1 硬底、市值门/毕业臂/RSI warmup 全不可达，断流票 tick 驱动卖腿整体冻结）。**机制开关 = `experiment.config.stopLoss` 段存在任一腿参数**；不配段 = 完全关闭（存量实验零变化），不占策略位。

- **配置**：`stopLoss: { timeStopMinutes: 60, priceStopPercent: -50, scanIntervalSec: 30 }`——① 时间止损：持有超 60min 仍 `profitPercent <= 0`（浮亏或持平）全清（2026-09-28 盘古案改 `<=0`：断流冻结票 FA 价格不动 profit 恒 0，`<0` 永不触发）；② 价格止损：`profitPercent <= -50` 全清（FA 因子，相对 buyState 成本）；双腿独立可配，双命中标注 price
- **双挂点**：tick 即时路径（`_onFactorsUpdated` 卖腿分支 `_stopLossHit` 优先于策略腿判定）+ 持仓扫描 `_scanHoldingsStopLoss`（scanIntervalSec 驱动，**断流票唯一触发路径**——无 tick 永不进 `_onFactorsUpdated`）；扫描只判止损双腿不跑策略腿（P1-P8 断流「不评估」语义维持），`buildFactorMap(addr, Date.now())` 必传 Date.now()（断流期 holdDuration 继续走）
- **执行**：`_emitStopLossSell` 构造等价 strategy（`id: stopLossPrice/stopLossTime`、`cards: 'all'`、`sellPercentage: 1`、`bypassDebounce: true`、`lockTokenAfterSell: false`）直接走 `_emitSellSignal` 全清链——signals/trades/卡账本/累亏记账副作用全复用零新逻辑；卖出失败下周期扫描自然重试
- **范围**：仅 FourMemeWssTradingEngine（含 flap/both 子类）；BacktestEngine 不动（回测已有强平兜底）
- **单测**：`node scripts/_test_stop_loss_rules.cjs`（29 断言零 DB：判定矩阵/构造/扫描链/tick 挂点四节）

## 毕业事件驱动卖出 + flap per-token 毕业锚（2026-09-28，王之蔑视 0x7abcc1 案，用户裁定「2+1」）

王之蔑视（flap funds=14.2 非标准盘）毕业断流后余 3 卡冻结 4 天：progress 峰值 88.9%（72 固定锚失真）→ P3(≥0.9)/P8(≥0.98) 全程够不着，断流后 tick 驱动卖腿整体冻结。两项改动：

- **②毕业事件驱动卖出**：`_handleGraduation` virtual 持仓票直接 `_emitGraduationSell` 全清（等价 strategy `id: graduationSell` 与止损腿同构，余仓按断流前最后可靠价落袋；选全清而非等价 P3+P8 卖 3/4——virtual 冻结与全清估值同价只差 0.5% 费，全清释放 PM 资金与卡牌）。`_graduationSoldTokens` Set 幂等（graduation 事件实测重复派发两遍）；**竞态修复（2026-09-28 盘古案，graduation 事件先于买入到达 1.9s → `_handleGraduation` 因 status!=='bought' no-op 买入即冻结）三挂点**：幂等标记后置到卖出成功（失败不标记可重试；并发双调被 `_sellingTokens` 挡住）+ 买入成功点补卖（查 FA `graduated` 标记 fire-and-forget，virtual-only，不依赖 stopLoss 段）+ `_scanHoldingsStopLoss` 扫描兜底（virtual-only，先于止损判定，事件路径卖出失败的唯一重试路径）；live 维持 Telegram 告警人工处置不动；BacktestEngine 不动（无 graduation 事件消费路径）
- **①flap 专属毕业锚**：`graduationProgress` 分母经 `FA._graduationAnchorBnb(state)` per-token 化——flap 盘 = 首市值（`_relFirstPriceBnb × totalSupply`）× `graduationAnchorRatio`(12.5，R 恒比：断流市值/funds≈4.50 与初始/funds≈0.36 两恒比合成，182 实测 4/5 样本 ±2%，funds 跨 10.9~17.3 固定锚数学无解)；**仅当首 tick 距 token 创建 < `graduationAnchorFirstTickMaxMs`**(60s，首 tick≈开盘锚有效；脏样本 0x84439e 首价 5.8 倍开盘 R=2.17) 才启用，否则退 72 默认锚。platform 由 SharedTickConsumer token_create 传入 FA state（乱序自愈：迟到 registerToken 回填更早 createdAt → 窗变大自动退锚）；BacktestEngine 不传 platform → 恒 72，回测行为零变化
- **附带修复（b24879e0 09-28 03:53 裸崩根因）**：`_computePriceTrendFactors` 分桶 OLS 假设输入升序，但 `_recentTicks` 是 FIFO 到达序且 tick 行存在「bigserial 分配序≠提交序」乱序（watcher 双写者竞态）→ 负 idx `buckets[-k].push` TypeError 进程死。修复 = `reliable` 归一时间升序（排序假设修复非兜底）
- **单测**：`node scripts/_test_graduation_sell_and_anchor.cjs`（35 断言零 DB：锚矩阵/progress 端到端/毕业卖幂等·live 门/乱序崩溃复现四节；旧代码崩溃用例 git stash 反向复现验证）

## 行为周期分桶·周期路由（2026-09-28，用户思路 v1；51ea69e7 20 买 14 割肉 1 止盈触发）

结构性盲区：8 条卖腿全是暴涨型条件（针臂要 5m 涨 15%、RSI 梯队要涨速、毕业臂要 progress 0.9+），**会割肉不会止盈**——普通代币涨 20-50% 回落无腿可接。用户思路：按盘面交易热度判「用户行为周期」（K 线因子周期：秒级/分钟级/5-15min 级），代币分桶到不同策略集合、可自动切换；「毕业」保留捕捉金狗，普通代币靠普通因子。

- **判定（FA `_cycleFactors` 读取时聚合，与 `_rateFactors` 并列 spread 进 `_buildFactorMap`）**：双主量 `tps30s`（30s 滑窗 tick 密度，读取时按 now 过滤防断流残留虚高）OR `gapMedianMs`（5min 窗相邻 tick 间隔中位数，尾部 `cycleGapSamples` 个样本，乱序负间隔丢弃）→ 三档：**3 热桶**（tps≥0.5 或 gap≤2000ms）/ **2 中桶**（tps≥0.08 或 gap≤12000ms）/ **1 冷桶**（有证据但低于中桶门槛，**或证据不足：5min 窗 tick<12 且已过 warmup → 判冷不判 null**）；**null 仅 warmup 期**（tokenAge<15s，新票未分桶多为火票早买，短窗代价小；无 createdAtMs 锚点同 null）。**2026-09-28 修正（1c68478f 回测 36 强平票 -6.27 BNB 根因）**：原「5min 窗 tick<12 → null 全隐」拦掉的恰是「从热到冷的衰减必经段」——熄火票冷桶时间衰减腿隐身无人接管，回放结束强平收尸；改判冷桶后稀疏衰减段（tick 未全断、每笔稀疏 tick 仍触发评估）保护腿上线接管，tick 全断后回测仍无评估时机（主循环纯 tick 驱动，强平收尾不变）。warmup 60→15s 同日（用户裁定「甚至可以更短」：tps30s 按 30s 窗归一、age=15s 时分子天然减半自带保守性）
- **hysteresis `_cycleLatch`**（state 字段 `{current, since, candidate, candidateSince}`，每次 buildFactorMap 推进）：升/降档驻留均 30s（**2026-09-29 用户裁定 120→30**：8bd5ef0b 断流票案——flap 7777 票暴跌全程 gap 中位数钉热桶无腿可接，衰减段首判冷 02:15 后驻留差 60s 遇断流，拖到 04:11 孤儿 tick 才完成降档补卖 -58.5%；降档太慢的代价 > 瞬抖误降档）；stale 快速通道（now−lastTickAt>30s 且 current>1 → 立即降 1，断流即冷；同案 120s→30s）；切换打 `[CycleSwitch] token=… from=… to=… tps30s=… gapMedMs=… reason=init/upDwell/downDwell/stale` 固定格式日志（console.log 非 logger）
- **5 新因子键**：`tokenCycle/tokenCycleRaw/tokenCycleAgeSec/cycleTps30s/cycleGapMedianMs`（getFactorKeys 探针自动收键，策略 condition 可直接引用）；10 个 `cycle*` 参数进 `FACTOR_PARAM_DEFAULTS`（`config.fourmemeWs.factorParams` 浅合并覆盖）；**防前视红线：判定内 now 由 `buildFactorMap(state, asOf)` 传入，禁 Date.now**——回测虚拟时钟天然防前视
- **路由（方案 A：evaluate 内过滤）**：strategy 字段 `cycle`（1|2|3，脏值→null=全周期=旧语义）× `token.cycleTag` 等值匹配；带 cycle 腿在 cycleTag null 时不可见（fail-closed），不带 cycle 腿恒可见（存量零变化）；与 maxExecutions/cooldown 同构——被隐高优腿不遮蔽低优腿，`strategyExecutions` 按 strategyId 分桶跨桶保留。**同日 v2 泛化**：字段升级为 `groups` 表达式（`cycle: 3` → `groups: 'cycle==3'`，见策略库节）——loadStrategies 单点转换，存量 config.cycle 永久接受
- **开关 = `experiment.config.tokenCycle.enforce`**（缺段=不写 cycleTag=路由不生效）；cycleTag 同步点 7 处：实时 4（`_onFactorsUpdated`/`_runBuyEvaluation`/`_onSellDebounceFire`/`_scanHoldingsStopLoss`——扫描点是断流票 stale 降档同步）+ 回测 3（主循环/买去抖 fire/卖去抖 fire）
- **判定参数配置化（2026-09-28 同日，用户裁定「cycle 判定是实验层面的策略」）**：`tokenCycle.params`（10 键去 cycle 前缀：hotTps/midTps/hotGapMs/midGapMs/minTicks/warmupSec/upDwellSec/downDwellSec/staleMs/gapSamples）成为实验级显式配置——**三级合并优先级** `FACTOR_PARAM_DEFAULTS < fourmemeWs.factorParams（旧入口保留）< tokenCycle.params（最高）`，注入在两引擎 FA 构造点（`mapCycleParams` 纯函数，group-variables.js；CYCLE_PARAM_KEY_MAP 键清单单一事实源，web-server 校验复用）；FA 零改动（`_fp` 合并链天然吃到）；flap/both 实验经基类构造点同注入。存量不带 params 实验 mapCycleParams 返回 {} 行为零变化。创建页「🌡️ 行为周期判定」配置区（enforce 开关 + 10 参数输入框预填默认值，`_test_strategy_library_groups` H2 段锁「模板预填 ≡ FACTOR_PARAM_DEFAULTS」防双源漂移）；tokenCycle 从复制链路 `_copyAdvancedConfig` 暂存移出改表单回填（暂存只剩 stopLoss/tokenPositionAnalyzer/fourmemeWs 三段）
- **创建页卖腿按桶分组展示（同日，纯展示层零数据形状改动）**：`cycleGroupOf`（groups/v1 cycle 归一后全等 `cycle==N` → 桶 N；无表达式 → none；其他 → cross）× `reflowSellGroups`（组序 3→2→1→cross→none，组标题带腿数，空组清理，全局编号跨组连续）；挂点 addSellStrategy/removeStrategy 卖侧。**提交腿序保插入序**：`dataset.seq` 单调计数，collectFormData 卖侧按 seq 排序回插序——DOM 分组重排不改变 `sellStrategies` 数组序（同 priority 平局胜者由插入序决出的复制保真语义）
- **时序快照**：FactorBuilder `buildFactorValuesForTimeSeries` 白名单 +4 键（tokenCycleAgeSec 可差分推不进）——档位快照进 `experiment_time_series_data` 供阈值事后校准；旧 FA 无键 → null 不掩盖
- **token-returns 页展示（2026-09-28 同日）**：主行「行为周期」列（叙事评级与最高涨幅之间）= 各笔**卖信号** fire 时刻的 cycle 档位徽章序列（3=🔥 2=🌤️ 1=❄️ null=∅），hover title 逐笔 `北京时间 档位 tps gap 触发腿名`；数据源 `strategy_signals.metadata.trendFactors` cycle 键（同白名单落库，实时/回测全覆盖，引擎侧零改动），新轻量端点 `GET /api/experiment/:id/cycle-signals`（`getCycleSellSignals`：action='sell' + jsonb 路径窄列 `metadata->trendFactors->>tokenCycle` 不拉 metadata 大字段 + URL 原始 experimentId 不跳源实验——回测的 signals 挂回测实验名下）；`experiment_time_series_data` 对回测不可用（`_shouldRecordTimeSeries` false）故不走时序
- **生效矩阵**：腿无 cycle + 无段 → 零行为变化；带 cycle 腿 + 无段 → 腿隐身（fail-closed）；带 cycle 腿 + enforce=true → 生效。**直接 enforce 无 shadow 期**（用户裁定：快照/日志照常收集事后纠偏）
- **单测**：`node scripts/_test_token_cycle_routing.cjs`（59 断言零 DB：判定三档+双 null 门/hysteresis 升降档驻留/stale/归一/路由矩阵/桶切换计数保留/键集/遗留修复 G 段/H 段注入链三级合并优先级；2026-09-28 v2：C 段改 groups 断言 + 单一事实源断言 `'cycle' in strategy === false`）+ `_test_strategy_library_groups.cjs` H 段（mapCycleParams 键映射矩阵 + H2 模板预填防漂移）

## 策略库 + 组路由泛化（2026-09-28，rich-js 参照落地）

策略定义从「每实验 config 内嵌整包复制」升级为**可复用库条目**：`strategy_library` 表（全局无实验维度）存「腿集合包」条目（「热桶卖侧 9 腿」「V2 买门」各成条目），创建页「📚 从库引用」展开进表单混搭组装；组路由同期从 cycle 数字标签泛化为 **groups 表达式**（`cycle: 3` → `groups: 'cycle==3'`，求值支持 AND/OR 为多维度铺路）。四项用户裁定：条目粒度=腿集合包 / 一期组维度=cycle 泛化 / UI=库管理页+创建页引用 / 热更一期不做。

- **表结构**（`scripts/sql/create-strategy-library.sql`）：id uuid PK / name UNIQUE（人读维度，引用走 id）/ side CHECK('buy','sell') 编辑锁死 / legs jsonb（形状 = strategiesConfig.buy/sellStrategies 数组元素同构，快照展开=纯数组拼接零转换，CHECK 空腿拒绝）/ version int（PUT 成功 +1 乐观并发，前端带 expectedVersion 不匹配 409）。RLS service_role-only——**routes 必须走 `dbManager.getClient()`（service key），勿照抄 narrative.routes 的 anon 客户端**（wss_price_ticks anon 静默过滤的同款坑）。**部署红线：表必须先于新 web-server 重启存在**（新 routes 启动即查询），同 token_category 列先于进程的口径
- **groups 机制（v2）**：`src/strategies/group-variables.js` 变量注册表（`GROUP_VARIABLES.cycle`，一期单变量二期加键即扩展）+ `parseGroupsExpression`（内部复用 ConditionEvaluator parseCondition；**AST 级拒绝** `IS NULL`/`IS NOT NULL`——一期不开放「专门处理无档 token」逃生口、右操作数非数字字面量拒绝、未知变量 throw——变量集是注册表闭集，只可能是书写错，warn 会导致腿永远隐身）+ `buildTagContext`（cycle 取 tokenData.cycleTag）；`StrategyEngine.loadStrategies` 单点转换（groups 非空串 > cycle∈{1,2,3} 转 `cycle==N` > null=恒可见），**脏 groups → throw 实验拒绝启动**（condition 语法错同款 re-throw 链；warn+降 null=腿恒可见，危险方向静默变化）；`evaluate` 内 null 门先于表达式求值（引用变量任一 null → 腿隐 fail-closed；比较类操作数 null→false 双保险）；strategy 对象 `groups/groupAst/groupVars` 三字段替 `cycle`，`_groupEvaluator` 独立 AST 缓存域；两引擎日志过滤 `s.cycle != null` → `s.groups != null`
- **快照语义（copy-in）**：展开发生在前端（创建页浮层逐腿 addXxxStrategy 插只读快照卡，见下方「创建页只读化」），服务端只存 `strategiesConfig.libraryRefs` 元数据（`{libId,name,side,version,legCount,snapshotAt}` 纯 provenance，POST 校验形状后透传，运行链零消费）；实验 config 自包含——改库/删库不影响已建实验运行，改库重启实验进程才生效（热更一期不做的自然推论）；groups 不在 STRATEGY_FORM_KEYS 白名单 → rawConfig 整包保真机制自动携带零改动；腿序稳定（strategyId 下标派生强耦合）：库引用固定追加尾部、priority 冲突不重排
- **Web 层**：`src/web/services/StrategyLibraryService.js`（list 带 usageCount / create / update 409 / remove / getUsage——扫近 200 条 experiments config JS 端过滤 libId / `validateLegs`——每腿 condition 必填 + groups 过 parseGroupsExpression，**库是 groups 第一编辑面，脏 groups 入库前拦截 400 带腿序号**；side 与腿字段错配放行——引擎本就「携带不生效」）+ `src/web/routes/strategy-library.routes.js` 七端点（GET 列表 `?side=` / GET :id / POST / PUT 409 / DELETE / GET :id/usage / GET meta/variables 注册表下发前端帮助单源）+ web-server 挂载与 `/strategy-library` 页面路由；「从实验导入」无专用端点——`GET /api/experiment/:id` 取 config 客户端勾腿入库（复用同一 validateLegs 防双路径校验漂移）
- **前端**：`strategy-library.html` 单文件页（条目卡片列表 side 徽章/version/被引用数、编辑表单 side 锁死、腿 repeater 复刻创建页全量字段含 groups 输入、从实验导入面板——腿上 cycle 数字自动转 `groups:"cycle==N"` 预填，转换语义与 loadStrategies 单点一致）；create_experiment.html 买/卖区头「从库引用」按钮 + 浮层 + `libraryRefs` 页级数组进提交载荷 + 帮助面板「组路由」节；experiments.html nav 加链接
- **seed v1**（`scripts/sql/seed-strategy-library-v1.sql`，ON CONFLICT (name) DO NOTHING 幂等）：51ea69e7 实跑 19 腿导出 4 条目——**buy-v2**（1 腿：量价门 + TPA tokenScore>2.2 + 叙事门评级∈{2,3}，cards:4）/ **sell-hot-v1**（9 腿 cycle==3，P1-P9：硬底/针臂两档/毕业臂两档/RSI 三互斥带/快速移动止盈，全 bypassDebounce）/ **sell-mid-v1**（5 腿 cycle==2，P10-P14：TP1 冷却 600s/TP2/移动止盈/保本/时间衰减，走去抖）/ **sell-cold-v1**（4 腿 cycle==1，P15-P18：紧移动止盈/保本/时间衰减两档）。⚠️ seed SQL 字符串字面量必须**单引号**定界（PG 双引号是标识符引用会报 column does not exist）
- **buy-v2 v2（2026-09-29 上线，182 DB 直改 + git pull）**：condition/narrativeCallCondition `age < 30` → `tokenAgeSec < 90`（90s 买窗，过期洞修复）；preBuyCheckCondition 追加 `earlyTradesTop1BuySharePct < 60 AND earlyTradesTop1BuyCovered == 1`（top1 门，120caca6 验证 +2.11 vs 基线 +1.171）。seed SQL 保留 v1 措辞（ON CONFLICT DO NOTHING 不覆盖存量库）——全新环境重 seed 得 v1，需再跑同款升级
- **buy-v2 v3（2026-09-29 上线，182 DB 直改，零代码）**：condition 追加买侧冷档门 `AND (tokenCycle != 1 OR tokenCycle IS NULL)`（不买冷档：warmup null/中/热放行、冷档 1 拦截；narrativeCallCondition 不加——condition 不过根本不触发叙事调用）。G 系列配对验证（同窗 unified 口径）：G1(90s+冷档) +4.7861 vs G0(90s 基线) +2.4335 净效应 **+2.3526**（不烧心误标病例票 +2.2873 大头 + 拦 5 小亏票 +0.13）；**90s 窗与 30min 窗在冷档门下 trades 51/51 逐笔一致**、全部买点 ≤74s——90s 窗够不用扩 30min；四态真值表 + loadStrategies + 89/91s 边界全校验过。实验须配 `tokenCycle.enforce`（无段则 tokenCycle 恒 null=冷档门恒放行，无害但不生效）
- **单测**：`node scripts/_test_strategy_library_groups.cjs`（53 断言零 DB，A-G 七节：normalizeGroups 转换矩阵 / parseGroupsExpression 脏值矩阵 / evaluate 过滤矩阵 / **v1⇔v2 全积等价**（cycle∈{1,2,3} × cycleTag∈{1,2,3,null} 12 组合逐一相等——存量实验零变化的机器证明）/ 无配置恒可见 / maxExecutions·桶切换计数保留 / validateLegs）
- **创建页只读化（2026-09-28 用户裁定，两条）**：①「之后实验所有的买入/卖出策略都要来自于策略库」；②「实验创建页面应该是从策略库中选择交易策略，创建页面本身不能编辑交易策略」。落地：create_experiment.html 删「+ 添加」手写入口 / preset 模板 / 腿编辑输入框，只留「📚 从库引用」——腿 = **只读快照卡**（condition 等宽块 + badges 徽章组 P{priority}/执行≤N/🃏cards/⏱️cooldown/卖N%/旁路去抖/🏷️groups + 高级字段 details 折叠，textContent 填充防注入）；机制 = `card.dataset.rawConfig` 整包存储，`collectFormData` 从 DOM 卡整包取回（取代旧「表单白名单收集 + mergeRawConfig 合并」双轨——bypassDebounce/sellPercentage/groups/description/cards 等机制字段零损失，description 白名单误删 bug 的类别整体消失）；`permanentBlockCondition` 从首买腿快照提取放 strategiesConfig 顶层（引擎读点）后从腿上删除保持旧提交形状；删除腿只重编号不重渲染。**复制链路腿同样整包只读回填**（51ea69e7 源 v1 `cycle` 数字格式原样保留——loadStrategies 永久接受，运行等价，不做迁移转换）
- **复制链路高级段保真（2026-09-28）**：此前复制丢 `tokenCycle/stopLoss/tokenPositionAnalyzer/fourmemeWs` 四引擎级段（copyData 组装白名单 + 服务端 POST 白名单双重丢弃——复制 51ea69e7 出的实验 18 cycle 腿全隐/无止损/TPA 买腿 fail-closed/OPB 不采集）。修复链：experiments.js copyData 组装四段 → 创建页 `window._copyAdvancedConfig` 暂存（表单无输入 UI）→ collectFormData 顶层 spread → web-server POST 解构+形状校验（非对象 400；tokenCycle.enforce 非布尔 400；fourmemeWs 与 live 分支已写的 {live} 段合并且 live 优先）→ config 顶层 → Experiment.fromConfig 无损；非复制路径 `window._copyAdvancedConfig` undefined → 无段与现状一致

## Live Trading（实盘加固，2026-09-27）

双平台 live 全链路已通：four.meme 走 `FourMemeDirectTrader`（TokenManager2），flap 走 `FlapPortalTrader`（Portal `swapExactInput`；**live 只买 BNB 计价盘**——非 BNB 盘合约 revert = 天然 fail-closed；卖出 token→0x0 全盘支持）。live 实验只能 `node main.js start-experiment -e <id>` 启动（`src/run-engine.js` 对 live 显式拒绝，防被静默当虚拟盘）。实收解析用**余额差法**（买入 token `balanceOf` 前后差 = 税后真相；卖出 BNB `getBalance` 差 + `gasUsed×gasPrice` 补偿），对税币/非 BNB quote 盘免疫（TokenSold 事件 `eth` 字段非 BNB 盘记 quote 币，事件解析不可用）。

防御分层（参数在 default.json `fourmemeWs.live`/`flapWs.live`，验收 runbook `docs/live-acceptance-runbook.md`）：

- **L1 预成交校验 `assertMinOut`**（`traders/core/preTradeCheck.js` 纯函数）：trader 签名前校验「报价到手 vs 引擎信号价预期」，ratio < `minOutRatio`(默认 0.5) 拒单——BURNIE 报价错位/尘埃报价防线（相对滑点对尘埃失效）。`expectedTokenOut`/`expectedNativeOut` **契约必传**（缺即 throw，逼调用方显式表态）；卖出侧预估失败（trySell/quote）且有预期锚 → fail-closed 拒绝裸奔卖出（无锚独立工具路径保留旧行为）。事前/事后 ratio 语义刻意不统一，勿"统一"
- **L3 卖出熔断**：引擎 `_sellFailStreak` 连败 ≥ `sellCircuitBreakerFailures`(5) → `sellCircuitBreakerCooldownMs`(30min) 长冷却 + Telegram 告警；成功清零
- **L5 `_awaitReceipt`**：`waitForTransaction(hash,1,txWaitTimeoutMs 120s)` 超时回查一次 `getTransactionReceipt`，仍未上链 throw 带 txHash——**绝不自动重发防双买**；reverted throw
- **持仓数上限 `maxPositionTokens`**（0=不限，只拦新开仓）；**毕业告警**：live+bought 毕业 → Telegram 告警人工去 PCS 处置（TM2 毕业卖出必 revert）
- **多态 `_liveTraderType()`**：基类 'fourmeme' / FlapWssTradingEngine 覆盖 'flap'（`_initializeLiveTrader` 走 `traderFactory.createTrader`）；钱包解密/余额门/BNB-USD 锚定/恢复全复用父类
- **钱包复用（轻量版钱包管理）**：web 创建 live 实验时「复用历史钱包」下拉（`GET /api/live-wallets` 去重地址列表，不含私钥）→ 提交 `wallet.reuseExperimentId` → 服务端从源实验拷贝加密私钥密文（地址一致性校验 400），私钥永不回传前端；要求两端 ENCRYPTION_KEY 一致
- **单测**：`node scripts/_test_live_hardening.cjs`（零 DB：assertMinOut 全分支含 BURNIE 数值复现、`_awaitReceipt` 超时语义、FlapPortalTrader quote 方向/拒单在签名前/余额差记账/钳制/approve/实收=余额差+gas 补偿——真实 JsonRpcProvider+Wallet 实例 + 实例级 RPC 方法覆盖打桩；ethers v6 导出属性 getter-only，`ethers.Contract` 不可 monkey-patch）
- **真实资金验收未做**（需用户钱包，见 live-acceptance-deferred 记忆与 runbook）；flap 毕业/非 BNB 盘卖出 revert 属预期 fail-closed 行为

## Important Notes

- **Pre-buy check factors are always calculated** - No enable/disable configuration
- **Wallet cluster data reuse** - WalletClusterService reuses trades from EarlyParticipantCheckService
- **AVE API token format**: `{address}-{chain}` (e.g., `0x1234...abcd-bsc`) — AVE is now only used for holder/pre-check tooling and `/api/ave-*` analysis endpoints, not for discovery or prices
- **Snapshot ID format**: `{token_address}_{timestamp}`
- **Case sensitivity**: Wallet addresses are case-sensitive when querying database
- **Factor building**: Use `FactorBuilder.buildPreBuyCheckFactorValues()` when adding new pre-buy factors
- **Narrative prompts are ESM** (`.mjs`) while trading engine is CommonJS (`.js`) — don't mix import styles
- **Never delete experiment rows that have produced data** — deleting cascades to `wss_price_ticks` rows (race-owned by experiment_id) and loses them globally forever（watcher 架构后新行 exp_id=NULL 免疫级联，但历史行仍级联——删历史实验前必须用户裁定）
- **smart-wallet-mining 待迁**（watcher 架构遗留批次）：`scripts/smart-wallet-mining/` 仍按 experiment_id 口径拉 ticks（data-fetcher.js / mine-smart-wallets.cjs pickSources / verify-smart-wallets.cjs）——对新实验（exp_id=NULL ticks）会静默拉空，需改 token 集合或 received_at 全局窗口+platform 口径
- **Watcher 单实例**：`pids/wss-watcher.pid` 锁 + kill(pid,0) 探活；watcher 挂掉 → 实验侧 15min wss_down 告警（不自愈，需人工/监控重启 watcher）

## Adding New Pre-Buy Factors

1. Add factor calculation to appropriate service (e.g., `WalletClusterService`)
2. Add factor to `getEmptyFactorValues()` in the service
3. Add factor to `PreBuyCheckService._evaluateWithCondition()` context
4. Add factor to `FactorBuilder.buildPreBuyCheckFactorValues()` (for backtest compatibility)
5. Add factor to `FourMemeWssTradingEngine.js` preBuyCheckFactors construction (for virtual/live trading)

## Modifying Jev Question Sets

1. Edit the question's `instructions`/`criteria` in `src/narrative/analyzer/llm/jev-questions.mjs` (standard path) or `jev-prestage-questions.mjs` (prestage)
2. Bump `JEV_QUESTIONS_VERSION` / `JEV_PRESTAGE_QUESTIONS_VERSION`
3. If aggregation semantics change, update the mapping in `jev-result-mapper.mjs` / `jev-prestage-mapper.mjs`
4. Validate with `node scripts/narrative/jev_calibration.mjs` (standard) or `jev_prestage_calibration.mjs` (prestage) — check rating agreement and that no rating flips cross the buy boundary
