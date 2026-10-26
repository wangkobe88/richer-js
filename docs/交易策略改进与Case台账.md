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

## 一、现行买腿门链一屏（buy-v2 v39 快照；live v40 实跑本屏；v39 实验=库 v38 快照已过代）

```
(tokenAgeSec < 90 OR tradeCount >= 25)                    -- 时窗：90s 快窗 OR 慢热臂（T70/v39：非尘成交≥25 笔，去 600s 帽；preFilter age 无上界=不裁慢热票）
AND marketCap > 3500 AND marketCap < 20000                -- 市值窗 USD（v34 起 20K）
AND (narrativeRating == 2 OR narrativeRating == 3)        -- 叙事过门（C84 触发模型）
AND holderTrendSlope > 0                                  -- 趋势（slot 化 4 块窗，NULL fail-closed）
AND bundleClusterHoldCircPct < 35                        -- 同块协同簇存量持仓占比（v36 起存量口径；v19-v35 流量口径 bundleClusterSharePct，T1）
AND top2BundleClusterHoldCircPct < 55                    -- 最大两块买家并集持仓（T67/v37；AIFLY 案第二道门，单块退化=top1）
AND top3BundleClusterHoldCircPct < 75                    -- 最大三块买家并集持仓（T68/v38；邪恶卡皮案第三道门，不足三块退化=top2）
AND top1HolderCircPct < 35                                -- 单钱包最大持仓
AND maxCopyWalletHolderCircPct < 20                       -- 跟单名单单钱包最大（NULL fail-closed）
AND (platform != 'flap' OR tradesRouterPct >= 30)         -- flap 臂：聚合路由占比（T70/v39 换全史实时载体；v38 前 early 冻结版）
AND earlyTradesPerWallet < 4                              -- 均匀度
AND famousCopyWalletCircPct < 15                          -- 极著名钱包（0 语义）
AND (buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10) -- 人气门（v28 起 OR）
AND tradesNetBuyRatio >= 40                               -- 卖压门（T70/v39 换全史实时载体 50→40；v38 前 early 冻结版 50）
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

### T70 全史实时净买/路由两键换载体——智子/币安1986 双案（2026-10-26，buy-v2 v39；early 90s 冻结窗对慢热票结构性失真）
- 案：v39 71f87b50 运行期两票叙事全放行（智子 mid/event:W/64.96 rating 投影正常、币安1986 high/event:E/88.84）却都没买，**拦点全在买腿因子**——
  - **智子 0x4451f373e343fb95c5121863d048597cec5b7777**（four.meme，create 04:53 UTC）：唯一拦点 `earlyTradesNetBuyRatio >= 50` 恒不满足——90s 窗终值 **49.8%**（买 3.19/卖 1.60 BNB，25 钱包真热闹票），rating 就绪后逐 tick 全程 9%→49.8% 差 0.2pp 没上穿；routerPct 44.5/perWallet 1.56/buyVolume 3.19/市值 4291 全过。**40 分钟后毕业（funds 12.59 BNB）=被净买比门拦掉的盈利票**
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
