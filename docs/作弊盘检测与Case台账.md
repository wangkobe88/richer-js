# 作弊盘检测与 Case 台账（CD）

## 分工声明与写作纪律

本台账与《叙事引擎改进与Case台账.md》（C 编号）、《交易策略改进与Case台账.md》（T 编号）并列：**作弊盘检测模块**（Jev 驱动的盘面健康判定）的机制演进与案史归档。

- **CD 编号全局唯一、永不回收**；新案插 Case 节顶部，编号 = 现有 max + 1
- 每案必带：**token 地址**、用户裁定原话（如有）、验证数据、对应单测名
- 机制/题集改动 = 新 CD 条目 + 必要时 bump `CHEAT_QUESTIONS_VERSION` + 回归集收录（`scripts/cheat-detection/run.mjs --add`）
- 预期变化的既有票必须 `--update-expect --because "<CD 编号> <一句话>"` 留痕；fixtures **只增不删**
- 决策过程细节、反复推翻的中间方案可简写；现行机制以代码与本文「机制一屏」为准

## 现行机制一屏（CD1 起，观察期）

**作弊盘检测（cheatCheck）= Jev 驱动的买点同步式盘面健康观察层**。动机（用户原话）：「作弊行为也多变，并且与正常的用户行为糅杂在一起，简单规则往往拦截着拦截者又因为瞬时条件通过而直接买到更高点」——综合判别交给 Jev 深度思考。

- **三分类语义（用户裁定原话）**：「作弊盘 / 不健康盘 / 健康盘。其中不健康盘跟健康盘可以相互转化，买点不同，性质可能会有差异」——cheat=协同资金主导的既成事实（不可逆）；unhealthy/healthy=**时点状态**→ 每个买点独立 as-of 判定，`cheat_detection` 表多行历史留转化轨迹
- **链路**：买点触发（preBuy 过、GMGN 块外——无 GMGN 条件腿/被 GMGN 拒的票也进样本）→ settle 4s（tickBuffer flush+sender 回查窗）→ **单 tail 查询** wss_price_ticks（链上真序倒序 limit 3000；锚=该单次查询返回行数，**绝不 count+select 两次**——撕裂防线）→ 满帽才补 head 300（launch 窗）→ `cheat-snapshot` 纯函数（与回归 runner 同源 bit-identical；**权威锚由调用方传入**，head 补充行不参与锚）→ `cheat-state-builder`（20k 预算纯文本：[TOKEN]/[ANCHOR]/[PRECOMPUTED]/[TICKS]/[WALLETS]/判定指引）→ `JevClient.ask`（ESM dynamic import）→ `cheat-result-mapper` → insert `cheat_detection`
- **增量语义**：重析条件 = `(新tick>0 ∧ 距上次≥minIntervalMs 60s) OR 新tick≥20`；0 新 tick=复用；满帽行数饱和时增量改判尾行水位（block:log 不变=0 新 tick）；顶帽 `maxAnalysesPerToken 20`（per question_version，DB 行数兜底跨进程；error/timeout 也烧预算防故障环）；`minTicks 8` 以下不调 Jev 不落表；失败冷却 10s
- **口径**：wallet=COALESCE(sender, trader)（FA 同款单点）；top1/top2 集中度**剔除聚合路由伪钱包**（未解析 sender 的 GMGN 行并包成巨型伪钱包=向 cheat 方向系统性偏置）；资金口径不滤 outlier/尘 tick，priceArc 仅可靠价行；routerPct/unresolvedSenderTickCount 单列进 state（证据洞告知）；bnb_amount 恒 BNB 域（flap quote 盘写入时已换算，读侧照抄）
- **观察期纪律**：fire-and-forget 绝不影响买决策；signal metadata 落 `cheatCheck` 轨迹（发起/joined_inflight/lastVerdict）；异步结果只进表不回填信号行；实验 stop 不清理表行（token 级全局资产）；stop drain 上限 5s
- **失败语义**：Jev 超时/失败落 timeout/error 行带 fail_reason（loud 留痕）+冷却；落库失败 loud warn 不重试；链内全吞错绝不 throw 进交易链
- **落库**：jev_prompt 仅每 (token, question_version) 首行落全文（多行历史无界增长防线）；answers_raw 恒落（断代对拍证据）
- **回测零接线**（BacktestEngine 不继承 `_runBuyEvaluation`，用户裁定首期不接回测——历史票用回归 runner 离线重析）
- **配置**：`fourmemeWs.cheatCheck { enabled 默认 false（物化语义：缺段/缺 enabled=关）, timeoutMs 30000, settleDelayMs 4000, reanalyzeTickDelta 20, minIntervalMs 60000, minTicks 8, maxAnalysesPerToken 20, failCooldownMs 10000, pullLimit 3000, headLimit 300 }`；flap 实验经 `_mergedWsConfig` 同键生效
- **回归集**：`scripts/cheat-detection/`（fixtures.json **anchor 必填**=防全史马后炮 / lib.mjs 纯函数 / run.mjs 182 跑：`--only/--list/--add/--update-expect --because/--dry`；jev_prompt 存档 data/prompts/）

## Case 倒序

### CD52 elun：creator 一买四卖+等额蜂群+三连块砸盘（2026-10-30，live 窗新收）

**案发**：live 观察窗新票（基线 06:41 跑完后引擎 08:39:38 买入 → 不在 CD2-51 基线）。token `0x92d82b1d8951358b02d917c8afd19f179c277777`（elun，flap，creator `0xb00271859e6e8fb82c7ff2fd13e3c9dbe0985adb`）。

**裁定**（2026-10-30 用户原话）：「是作弊盘，前面一个钱包买，四个卖。随后入场的都是协同钱包」。

**盘面**（131 tick 全量，锚=36=引擎首买+settle 4s 口径）：
- creator t+0s 一笔买 2.4979 BNB → t+4-5s **四笔卖出**（0.1624/0.1567/0.1513/0.1461，档位递减）
- t+8-13s 等额蜂群入场：0.0198×8 同块两连、0.0247×6、0.0701/0.0700——与 CD13 同批跨票集群钱包（0x278e/0x93a3/0x040f/0xaa28/0x18a5…）
- t+15-16s 蜂群立即回吐小额（0.0024/0.0012/0.0061…）对倒节奏
- t+28-30s 六钱包（0x3195/0x84f6/0x10c6/0x65e0/0x677a/0xdd4c）**三连块协同砸盘**（0.119/0.116/0.109/0.082/0.078…）价格 1.108e-8 → 8.88e-9
- 全景 @锚40：top1（creator）=81.4%、churn 5、同块簇 4、等额簇 2

**收录**：`--add --anchor 36`（as-of=引擎买点，与基线同语义）；expect=cheat（用户裁定；机器判读见 182 收录输出）。

### CD2-CD51 aed2091d 首买基线批量收录（2026-10-30，待逐票 review）

**指令**（用户原话）：「收录一下 aed2091d-f22f-4660-ae62-42f48a9048de 有交易的所有代币吧，基于其第一次成功购买信号。你可以先跑一下，跑一个基线，给我一个结果的表格，然后我们一起一个一个的去 review 一下结果」+「这些代币全部放入回归集合中」。

**执行**：`run.mjs --experiment` 模式（commit d028f26）——trades 表每 token 首笔成功买入（trade_direction='buy' ∧ success），**锚=首笔成功买 created_at + settle 4s 内的链上真序 tick 行数**（对齐实时 service settle 语义；回放无法重放落库延迟=链上时间近似宁多勿少）。51 票全部有成功买入（全 flap 平台），真调 Jev D1.1 逐票判读，**全部收录 CD2-CD51**（expect=判读现状快照，review 后 `--update-expect` 校准）；CD1 ZERODAY 属本实验票、addr 去重跳过（锚 66 保留人工立案值，--experiment 算出 47=口径差：66 是立案分析时的人工窗口）。对拍存档 `data/cd-baseline-aed2091d-*.json`（含 answersRaw）。

**结果**：**51/51 全判 cheat**（cheatP 0.56-1.00，中位≈0.97）；pattern：same_block_burst 36 / dev_self_trade 6 / equal_amount_split 5 / rapid_churn 1 / null(P<0.4) 3；retail_participation 全部 0.66-2.76（10 分制）。

**关键观察（待 review 裁定）**：零区分度分布，两种解释——
1. **样本先验**：这批=实验实际买入的票（aed2091d 整体亏损=买的票质量差）+ 锚在首买时点（token 年龄普遍 <90s，flap 早期几乎全是 bot/抢跑钱包）→「全 cheat」可能部分为真
2. **题集偏置**：D1.1 判据可能未分开「正常新票的 bot 抢跑阶段」（几乎所有 meme 票前 60s 形态）与「协同资金对倒」（cheat 本义）——same_block_burst 主导（36/51）指向此：同块簇在 flap 早期是常态而非例外
3. **负例缺失**：评估区分度必须补对照组（未买入的票/涨了的健康票/更晚时点锚）

**review 入口建议**：从 cheatP 最低票开始人工对拍盘面（JAGENT 0.56 / 币安信任 0.64 / Bstocks 0.65 / 币安黑客 0.69 / 我们会活下去 0.74——Jev 最不确信的）vs cheatP=1.00 票（CBF / SAFU#51）；人工判定哪些实为正常盘 → `--update-expect --because` 校准 + 明确 D1.1 的偏置方向。

**review 进展（2026-10-30 逐票裁定，进行中，5/51）**：

| case | token | 裁定（用户原话摘） | expect |
|---|---|---|---|
| CD1 ZERODAY | `0x23f1…7777` | 确认作弊：「单笔购买的 BNB 数量明显偏大」 | cheat（不变） |
| CD30 放心 | `0xa5f6…7777` | 确认作弊：「前面两次购买都是一大堆钱包且额度近似」 | cheat（不变） |
| CD48 PZ | `0x75f4…7777` | 确认作弊：「作弊痕迹也有一些（有协同砸盘的行为）」 | cheat（不变） |
| CD8 NOT SAFU | `0xc2d7…7777` | **翻案**：「盘面由几个跟随钱包群掌控，但是不算是作弊」 | cheat → **unhealthy** |
| CD16 PAOLO | `0x1a28…7777` | **翻案**：「不算作弊，但盘面被 KOL `0x7a2363a401b2340c7941dd2eeff0196a5078d2e6` 掌控，它以及跟单持仓太多，它跑了就嗝屁了」 | cheat → **unhealthy** |
| CD13 SAFU | `0x8a18…7777` | **翻案 healthy（首个 healthy 正例）**：「是个正常的盘子，不过买入的时候被 `0xffbd…6dcc` 钱包主导」 | cheat → **healthy** |
| CD27 0 | `0xa021…7777` | 确认作弊：「典型作弊盘，对倒交易看起来很明显」 | cheat（不变） |

**校准信号（草稿，攒票后再定题面改法——改题面须 bump 版本+回归对拍）**：
1. **对倒的充要证据=买-卖回吐配对**：真作弊票卖回明显（CD1 36买/30卖≈1:1、CD48 43买/23卖协同砸盘）；两翻案票几乎无卖回（CD8 42买/**2卖** churn 仅 1、CD16 39买/7卖=买了拿着）——「集群买入+持有」≠对倒。Jev 在两翻案票上只看 same_block_burst（两票主导桶都是它）不看卖回=**最大过判源**
2. **集中度方向不能单变量判**：CD16（unhealthy，KOL 掌控）top1 35.5% vs CD48（cheat，协同砸盘）top1 33.9%——top1 高低分不开 cheat/unhealthy；分开它们的仍是**卖回行为**（砸盘 vs 拿着）
3. routerPct 高（CD8 71.5%）=跟随钱包群走聚合路由的指纹，指向 unhealthy（跟单结构）而非 cheat
4. **跨票常驻蜂群=全判 cheat 偏置的根源**：CD13（10-29 21:18 创建）与 CD52 elun（10-30 08:39 创建）的等额小额蜂群是**同一批钱包**（0x278e/0x93a3/0x040f/0xaa28/0x18a5/0xb114/0xeb3e…）——跟单名单里 coTokens 608 即同批钱包扫过 608 张票。每张 flap 新票早期窗口都在场 → 任意锚上「等额簇+同块簇」必然出现，是**背景噪音非本票协同**。cheat 判据应收窄到本票特异性协同（creator 买后秒卖/本票砸盘配对）
5. **creator 首买大额+部分卖出=flap 常态**（CD13 实证）：CD13 creator `0x3195…4cd8` 首买 2.50（top1 51.4%）+窗口内卖 0.64=用户裁定正常盘；CD52 creator 同为 ~2.50 买但 **5s 内四笔卖**=作弊——差异在卖出速度与节奏，非「creator 大额首买」本身
6. **CD13 焦点钱包 0xffbd…6dcc 档案**：跟单名单成员（coTokens 608/followers 6/syncedSells 525）+sybil 簇 #15（size 8/maxCo 346）；t+10s 买 0.4356 → 锚后 t+24s 卖 0.4270（+8.9%）→ t+34s 卖 0.0825（-22%）快翻离场——已知集群钱包的个体翻转 ≠ 本票协同

工具侧同步修：`latestArchivedInterp` 此前只扫 `cd-run-*.json` → 基线存档行（只带 addr 不带 caseId）不可见，`--update-expect` 对 CD2-51 会误报无存档；已扩为双 pattern+addr 匹配（翻案票 expect 仍须人工直改——`--update-expect` 只会抄机器判读，方向相反时不可用）。

### CD1 作弊盘检测立项案：ZERODAY 27 钱包分仓对倒盘（2026-10-30）

**案发**：v65 live 实验 `aed2091d-f22f-4660-ae62-42f48a9048de` 实买亏损。token `0x23f1c4afb4ec09fbde68166bff0adbc5d1d57777`（ZERODAY，flap）。用户问「从盘面上看，是不是一个作弊代币（流动性不来自真实用户）？」——人工盘面分析（66-tick 买点切片，全部数字被 `_test_cheat_detection_lib.cjs` 锁定）：

- 66 笔内 36 买 / 30 卖（买卖比≈1:1 的对倒节奏），Σ买 7.6439 BNB / Σ卖 7.1103 BNB
- **dev `0x8eda8b7b24130a1d4f2b8ab2cfdec41fd2e5482c` 抢跑自卖**：t+0s 买 0.5 → t+6s 卖 0.4（税后 0.3999）
- 27 个钱包、20 个快进快出（首买→首卖 <60s）≈3/4 钱包纯对倒
- 同块三连簇 7 个（如 blk 130554077 Σ0.99=0.33×3）；等额簇 **0.2475×4** 恰好等额
- **top1 集中度仅 7.45% / top2 14.89%**——分仓后全部现有集中度门失效；routerPct 22.02%（7 笔 GMGN）
- 价格拱 6.467e-9 → ATH 1.835e-8（t+70s）→ 5.98e-9：对倒拉高后出货

**裁定**（2026-10-30，四项决策+补充语义，原话）：
1. 触发时机=「买点同步式」（模仿 GMGN 检查层：前序条件全过、确定要买时才真调 Jev，配额最省）
2. 首期=「先观察后进门」（不进买条件串，只落库+metadata 轨迹；攒回归集验证准确率后再裁门）
3. 首期不接回测（历史票用离线重析工具建回归集）
4. 新台账=本文档，CD1/CD2… 前缀
5. 三分类：「作弊盘 / 不健康盘 / 健康盘。其中不健康盘跟健康盘可以相互转化，买点不同，性质可能会有差异」→ as-of 多行历史

**处置**（全部落地，单测 68+44 断言零 DB 零网络）：
- 表 `cheat_detection`（DDL 用户已执行；多行历史非 upsert；verdict CHECK 六值含 error/timeout；token 级全局资产不挂实验 FK，stop 不清理）
- `src/trading-engine/pre-check/`：`CheatCheckService`（settle/单查询锚/增量水位/顶帽/冷却/inflight/drain）+ `cheat-snapshot`（纯函数；router 伪钱包剔除；等额簇 T74 口径 0.0001 舍入/≥0.001；同块簇 ≥3 笔无金额门；churn 窗 60s）+ `cheat-state-builder`（20k 预算六段）+ `cheat-result-mapper`（argmax+cheat P≥0.5 硬门+runner-up+桶名→列值映射 `unclear_insufficient→unclear`；pattern 仅 cheat 域 P≥0.4）
- `src/narrative/analyzer/llm/cheat-questions.mjs`（**D1.1**：Q1 三分类四桶 / Q2 cheat 模式六桶 / Q3 散户参与度 Score；改题面必须 bump 版本）
- 引擎接线：ctor 物化构造 + `_runBuyEvaluation` GMGN 块外挂点 + 拒买/通过双路径 metadata `cheatCheck` 轨迹 + stop drain（源码口径锁断言在 service 单测 H 段）
- 回归套件 `scripts/cheat-detection/`（CD1 已收录 @66 锚=买点 fire 时刻 tick 数）

**开发中发现并修复的实现 bug**（事故现场反证类）：
- `buildSnapshotFromRows` 曾不设 `snapshot.capped` → state [ANCHOR] 截断注记永不渲染（满帽=Jev 不知道中段缺失）；权威锚曾从 rows.length 反推 → 满帽时锚=head+tail 行数≠tail 单查询行数（**锚必须由调用方传入**——单测 D/E 段锁定）

**刻意的非目标**：不进买条件串；不接回测；不做独立 web 面板（signal 卡观察轨迹够用）；不动现有 FA 因子/门（纯旁路）；不做 worker/队列。

**182 待办**：①定向重析 CD1 对拍（真调 Jev，`run.mjs --only CD1`）②选干净负例与 unhealthy 候选票 `--add` 收录（CD2+，锚取各自买点 tick 数）③v66 换车实验 config 显式 `cheatCheck.enabled: true` 上线观察。

**观察点**：触发量/配额消耗（v65 级别买点频率下 20/token 顶帽够不够）；cheat P 分布与 pattern 分布；unhealthy↔healthy 转化实例（多行历史首例）；settle 4s 是否覆盖尾部突发簇（GMGN sender 回查长尾）。

## 题集版本演进表

| 版本 | 日期 | 触发 | 改动 |
|---|---|---|---|
| D1.1 | 2026-10-30 | CD1 立项 | 首版 3 题：market_health_verdict（cheat/unhealthy/healthy/unclear_insufficient 四桶）/ cheat_pattern（dev_self_trade/same_block_burst/equal_amount_split/rapid_churn/wash_pump/none_apparent）/ retail_participation（Score 0-10） |

## 未决事项

- **CD2-CD51 逐票 review**（2026-10-30 基线全 cheat 零区分度；**7/51 已裁**：CD1/CD30/CD48/CD27 确认 cheat、CD8/CD16 翻案 unhealthy、**CD13 翻案 healthy（首个正例）**；另有 live 窗新收 CD52 elun=cheat；D1.1 偏置根源=跨票常驻蜂群+creator 常态首买被读本票协同，判据草稿见上；余 44 票继续）
- 负例/healthy 对照票收录（未买入票/涨了的票——区分度评估必需）
- CD1 182 定向重析对拍未跑（本地不烧 Jev 配额）
- 观察期上线=v66 换车（enabled:true，用户指令后执行）
- 进门（进买条件串/做因子键）待观察攒批后裁定（T74/T76/T94 同款纪律）
- flap quote 盘注记与等额簇跨汇率窗碎裂的近似性（首例 quote 盘票出现时验证 state 表现）
- `is_valid` 失效写入者：首个题集断代时补 invalidate 脚本（照 invalidate-*-window 先例）
