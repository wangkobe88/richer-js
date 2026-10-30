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

- 首批负例/unhealthy 候选票收录（CD2+，待 182 选票——需各自买点时刻锚）
- CD1 182 定向重析对拍未跑（本地不烧 Jev 配额）
- 观察期上线=v66 换车（enabled:true，用户指令后执行）
- 进门（进买条件串/做因子键）待观察攒批后裁定（T74/T76/T94 同款纪律）
- flap quote 盘注记与等额簇跨汇率窗碎裂的近似性（首例 quote 盘票出现时验证 state 表现）
- `is_valid` 失效写入者：首个题集断代时补 invalidate 脚本（照 invalidate-*-window 先例）
