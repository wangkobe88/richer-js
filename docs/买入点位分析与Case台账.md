# 买入点位分析与 Case 台账（BP）

## 分工声明与写作纪律

本台账与《叙事引擎改进与Case台账.md》（C 编号）、《交易策略改进与Case台账.md》（T 编号）、《作弊盘检测与Case台账.md》（CD 编号）并列：**买入点位分析模块**（Jev 驱动的入场时机判定）的机制演进与案史归档。

- **BP 编号全局唯一、永不回收**；新案插 Case 节顶部，编号 = 现有 max + 1
- 每案必带：**token 地址 + 点位锚**（anchorTickCount）、用户裁定原话（如有）、验证数据、对应单测名
- 机制/题集改动 = 新 BP 条目 + 必要时 bump `BUY_POINT_QUESTIONS_VERSION` + 回归收录（测试集 set 重跑）
- 决策过程细节、反复推翻的中间方案可简写；现行机制以代码与本文「机制一屏」为准

## 现行机制一屏（BP1 起，2026-11-03 立项）

**买入点位分析 = Jev 驱动的入场时机判定模块**。动机（用户原话）：「感觉简单指标无法满足要求……通过 ticks 判断当前点位是否可以买入」。与反作弊模块（CD）分工：**输入同样是 ticks（wss_price_ticks 锚截窗），CD 判「盘面是否作弊」，本模块判「当前点位是否适合买入」**——入场时机好坏（时点判定，非 token 终身属性、非盘面性质）；协同/作弊形状在题面里只作降档参考，结论归 CD。

**BP2（2026-11-05）起第二步引擎融合已做（T117 信号源门链）**：新服务 `BuyPointCheckService` + 新表 `buy_point_analyses` + 引擎挂点——携带 `signalGate` 的买腿（初始买入信号源）触发后依次过作弊门（二元版）→ **BP 门**（`buy_point_assessment` 桶 ∈ bpPassLevels（缺省 good/neutral）过/拒），两门都过才买；BP 门**全 fail-closed**（超时/Jev 错/insufficient/disabled 均拒——BP 是点位判定唯一来源无据不买），回测恒拒（signalGate 腿全量排除）。详档交易台账 T117 案与下方 BP2 案。判定形态=用户裁定「Jev 综合判定」：维度题组给档位，综合题 `buy_point_assessment` 由 Jev 直接给 good/neutral/poor/insufficient；代码纯透传无规则映射层，与 CD D3.5「判断一律 Jev」同哲学。**BP3（题集版本，案号 BP4）起判读总纲=分类框架**：新增类别题 `point_category`（早鸟/回调/追高/难分类四桶，只判类别事实），综合题先分类后按各类忌讳权衡（早鸟忌极快拉高/回调忌没跌到位与奔着归零/追高本轮先等等一律 poor）。

### 模块分层（与 CD 模板同构，口径单点复用）

```
src/market-analysis/
  buy-point-snapshot.js      CJS 纯函数：cheat buildSnapshotFromRows 复用 + buyDerived
                             （近窗 30/60/120s 族/动量/节奏/参与结构/卖压/价格 20 桶）
  buy-point-state-builder.js CJS 纯函数：[TOKEN]/[ANCHOR]/[PRECOMPUTED]/[PRICE]/[TICKS]/[WALLETS]/
                             [判定指引]，20k 预算；[TICKS] 展示=首 50+末 250（近端为主）
  buy-point-result-mapper.js CJS 纯函数：answers→{dimensions, assessment, anchors} 纯透传
  llm/buy-point-questions.mjs ESM 题集：BUY_POINT_QUESTIONS_VERSION（BP1 起，改题面必 bump）
scripts/buy-point/
  lib.mjs       测试集纯函数（dedupeBuySignals/anchorCountAt re-export/computeForwardReturns/
                buildEpisodes/episodePnlBnb/quoteTokenOf）
  build-set.mjs 182 跑：最近 4 live 实验 BUY 信号 → 60s 去重 → per token ticks 窗
                （token_create 起 ∥ 缺失回退最早信号−10min，最晚信号+15min；id 水位翻页
                4000×15=6 万行帽 capped）→ 锚+前向收益+trades join 预计算 → set JSON
  run.mjs       182 跑：sliceAsOf 锚截窗 → snapshot → state → JevClient 真调 → mapper →
                两行制输出 + 「综合判定 × 前向收益」观察组；--dry/--only/--limit
scripts/_test_buy_point_lib.cjs  单测（零 DB 零网络，A-L 组）
```

### 口径要点（BP1 定版）

- **锚**：`anchorCountAt`=block_time ≤ 信号 created_at 的行数（宁多勿少近似，沿 cheat `--experiment` 同款——引擎墙钟 vs 链钟偏差已知）；sliceAsOf 行数不足=fail-loud（set 锚与 ticks 文件漂移防线）
- **近窗**：以锚末 tick 时刻 tEnd 为终点的 W 秒半开区间 `(tEnd−W, tEnd]`（dt 恰=界不入窗，单测锁死）
- **钱包**：wallet=COALESCE(sender, trader)；集中度/人数剔聚合路由伪钱包；资金不滤 outlier、价格族仅可靠价
- **缺证据两态**：窗内无行=0（有证据零值）；缺原料=null（不以 0 冒充）——与 CD 同纪律
- **结局观测（构建期预计算随 set 落盘）**：前向收益 entry=锚末可靠价，+1/+5/+15min 各窗 maxRise/last/pullbackFromMax（horizon 窗内可靠价 <2→null）；trades join=signal_id 匹配买腿（成功/失败/无匹配三态）+ episode 盈亏（mcap replay 口径：qty 闭合切分，pnl=Σ卖 output−Σ买 input；未平仓 pnl=null 只记 openQty）
- **测试集 git 卫生**：set JSON + data/（run 存档+prompts=断代对拍证据）进 git；`sets/*-ticks/`（per token ticks 大文件）不进
- **thin/anchorZero**：锚 <8 笔=thin 保留照跑（insufficient 桶真实素材）；锚=0（信号时刻前零 tick=数据洞）=anchorZero 跳过留痕

## 题集版本演进

| 版本 | 日期 | 变更 | 验证 |
|---|---|---|---|
| BP1 | 2026-11-03 | 初版八题（7 维度 + 综合题）：price_momentum / buy_pressure_quality / chip_flow / sell_pressure / market_heat / pace_trend / entry_position + buy_point_assessment；形状样本段标「初版待校准」（无实盘校准样本，测试集跑出分布后按案补充） | 单测 F 组形状锁；测试集首跑全量收官（bp-2026-11-03-live4，232 点位零失败，判定×前向收益末值中位单调——见下方首跑观测） |
| BP2 | 2026-11-05 | **综合题按用户五条判读框架重写**：①活跃度门槛（太低拒）②拉高拒+低市值豁免（mcapBnb ≈8-9 BNB 以下）③急砸深跌=抄底正向④阴跌流失拒（holdersDelta60 为负）⑤常态可买+激烈不合理拉盘拒；维度题反锚补强（market_heat 活跃下限 / momentum+entry_position 追高豁免臂 / chip_flow 阴跌+holder 流失形状）；snapshot 增 5 锚（mcapBnb/mcapPeakBnb/mcapFromPeakPct=priceArc×totalSupply 自算、holdersNow/holdersDelta60 两遍重放）；state [PRECOMPUTED] 增市值位置/holder 流向两行；**同批引擎融合（T117 BP 门）** | 单测 `_test_buy_point_lib` 144 断言（BP2 版本+5 锚手算+五条框架措辞锁）；BP1→BP2 对拍（182 重析 232 点位）待跑（跑前知会用户） |
| BP3 | 2026-11-05 | **分类判读框架（案号 BP4——题集版本号与 BP 案号体系撞号：BP3 案号已被同日测试集换源案占用，题集版本照 BP1/BP2 序数顺延）**：新增类别题 `point_category` 四桶（early_bird/pullback_entry/high_chase/unclear——只判类别事实不下买卖结论，三轴并读=时间轴 tokenAgeSec+位置轴 currentVsAthPct/mcapPeakBnb/mcapFromPeakPct+轨迹轴 chg30/60/120 与 PRICE 形状）；综合题判读总纲改「第一步先按类别分路，再按各类忌讳权衡」；BP2 五条框架收编（拉高拒+低市值豁免并入早鸟类、急砸抄底+阴跌流失拒并入回调类、活跃门槛/协同降档/薄窗 insufficient 作通用条保留）；**assessment 四桶域不动=服务端/bpPassLevels/引擎门零改动** | 单测 `_test_buy_point_lib` 182 断言（F 组重写：9 题/8+1 对齐/POINT_CATEGORY_LEVELS 双副本锁/分类框架措辞锁）；对拍待跑（跑前知会用户） |

## 首跑观测（BP1，2026-11-03，set=bp-2026-11-03-live4，232 点位全量零失败）

**取样**：最近 4 live 实验（v65 `aed2091d` 151 点 / v66 `4012ce39` 23 点 / v67 `e3d00085` 43 点 / v68 `67803108` 在跑 15 点）BUY 信号 812 → 60s 去重 **232 点位 / 190 token**；thin(<8)=0、anchorZero=0、capped=0、窗回退=0；结局对拍买成 145 / 买败 0 / 无匹配 87。Jev 成本 ~300ms/点、~11k tokens/点。

**综合判定分布**：good=9 / neutral=64 / poor=159 / insufficient=0。

**判定 × 前向收益（末值中位 %，最实际口径；均值受少数脉冲票拉高不作判读）**：

| 桶 | n | +1min 末 | +5min 末 | +15min 末 | 引擎 ep.pnl 均 |
|---|---|---|---|---|---|
| good | 9 | +1.4 | -0.9 | **+12.1** | +0.0001（3 胜/4 亏） |
| neutral | 64 | -2.1 | -9.9 | **-25.8** | -0.0002（36 胜/28 亏） |
| poor | 159 | -7.6 | -21.1 | **-30.1** | -0.0002（72 胜/68 亏） |

**读数**：三桶末值中位在全部三个 horizon **严格单调**（good > neutral > poor），引擎实际成交 ep.pnl 同向——BP1 首版判定方向有效。校准观察点：①good 偏保守（n=9）=追高反锚（「急拉窜升 near_high 不给高评价」）的刻意代价，poor 桶峰高中位仍 +9.4%@1min/+23.8%@15min——即「差点位」也常见尖峰只是回落深（末值深负），提示卖腿时机另议（非本模块口径）；②insufficient=0：本 set 无薄窗票（thin=0），该桶未受检验；③JAGENT（BP-S001）判 poor(0.55) 实际 +15min 峰 +107.85/末 +67.72——追高反锚误伤真启动票的实形，攒案后供题面校准。

## Case 档案

### BP4 题面分类判读框架（题集版本 BP3）（2026-11-05，机制案；⚠案号说明：题集版本号 BP3 与本台账案号体系撞号——BP3 案号已被同日「测试集换源 trades+ladder 挖掘」案占用，题集版本照 BP1/BP2 序数顺延为 BP3，本案记 BP4）

**用户指令原话**：「我想，我们把买入点分为几类，一类是代币刚出时候的早鸟入场，一类是跌下来后回调入仓，还有一类应该是强庄币追高入场，但是这一类先等等。早鸟入场的核心在于不要买极快速上涨/高价票，跌下来入场的忌讳是没跌到位或者这次下跌是奔着归零去的。这个分类我建议放到 Jev Prompt 中。」

**设计（分类进 Jev Prompt，代码不建分类规则层）**：新增第 8 题 `point_category`（Choice 四桶 `early_bird/pullback_entry/high_chase/unclear`）——**只判类别事实不下买卖结论**（各类利弊权衡归综合题，与「维度题不下入场结论」同纪律）。判读三轴并读：时间轴（tokenAgeSec+轨迹行数）、位置轴（currentVsAthPct/secSinceAth/mcapBnb/mcapPeakBnb/mcapFromPeakPct）、轨迹轴（PRICE 形状+chg30/60/120Pct）——全部为既有 snapshot/state 材料，**零新锚**（buyDerived 探针实证三类材料齐全）。反锚三条：①早鸟/回调分界=「是否已走完一波明显拉升再跌下来」非绝对 tokenAge（首波拉升中贴高仍 early_bird，不因涨了改判 pullback）②贴高≠自动 high_chase（低市值早期爬坡贴高归早鸟——追高豁免权衡归综合题）③类别本身无好坏。

**综合题判读总纲重构（9 题版）**：`第一步先按类别题分路，再按各类忌讳权衡`——
- **【早鸟类】**核心忌讳=不买极快速上涨/已拉高票（秒级垂直窜升/chg30 极陡无回踩/已陡峭拉高=拒）；温和爬坡+多元买压=good/neutral 候选；BP2 低市值豁免臂（mcapBnb ≈8-9 BNB 以下）收编为「自动成立」。
- **【回调类】**两忌=①没跌到位（回撤浅/半山腰=接飞刀，至多 neutral 倾向拒）②下跌奔着归零去（阴跌+holdersDelta60 净流失+买盘枯竭+bigHolderSellBnb60/exitSellerCount60 派发=趋势性死亡拒）；可买=深回撤后企稳（急砸非阴跌+买压回流+holder 稳+跌底放量）。
- **【追高类】本轮先等等：无论盘面多强一律 poor**（类别锚留痕——将来策略放开该类只改本段题面；poor 桶描述同步带「追高类本轮先等等」）。
- **【unclear】→insufficient**；通用条保留（活跃度门槛/协同降档不下作弊结论/材料太薄 insufficient）。

**桶域不变=零改动面确认**：`ASSESSMENT_LEVELS`（good/neutral/poor/insufficient）不动 → `bpPassLevels` 门语义、`buy_point_analyses` DDL CHECK、引擎 `_bpGateEvaluate` 全部零改动；`BuyPointCheckService` `_runJev` 整包 `buildBuyPointQuestions()` 透传+`question_version` 自动落 BP3。mapper 仅加 `point_category` 进 `DIMENSION_IDS`/`POINT_CATEGORY_LEVELS` 副本+`DIMENSION_LEVELS` 映射（维度轨道容缺 null、在场未知桶 throw 同纪律）；runner `run.mjs` 纯遍历透传自动兼容（输出行自动多 `point:<类别>` 段）。

**单测**：`_test_buy_point_lib.cjs` 168→**182 断言**——E 组 fullAnswers 加类别题答案+dimensions 8 键+透传/容缺断言；F 组重写（版本=BP3/恰 9 题/类别题居综合题前/8+1 对齐/POINT_CATEGORY_LEVELS 双副本对锁/类别题三轴材料引用+只判类别+反锚/综合题先分类后权衡总纲+四类分路+四忌讳措辞锁（不买极快速上涨/没跌到位/奔着归零/先等等一律 poor）+通用条保留+豁免臂收编；BP2 四维度反锚断言原样保留）。服务单测 `_test_buy_point_check_service.cjs` 26 断言照跑全绿（加题自动透传验证）。

**余留**：BP3 题面对拍（182 `run.mjs --set bp-2026-11-05-live3-t6gate` 363 点位重析 vs BP2 生产 10 行对照，看分类分布与 good/neutral/poor 迁移；跑前知会用户烧 Jev 配额）；类别题分布观察（早鸟/回调/追高/unclear 四桶占比——追高票占比=将来放开该类的样本池规模）。

### BP2 题面改版（五条判读框架）+ 引擎融合落地（2026-11-05，机制案·T117 同批；用户方案「不仅仅涉及买入点位 Jev 分析，算是买入策略的一次整体调整」）

**题面改版**：综合题 instructions 从 BP1 泛化措辞改为用户五条判读框架（原话骨架）：①**活跃度门槛**——活跃度太低不适合短线入场（「活跃度是入场的必要条件」锚入 market_heat 反锚）；②**拉高拒+低市值豁免**——价格已拉高时追入风险大，但「市值位置行 mcapBnb 尚低（约 8-9 BNB 以下）」豁免（早期空间大于回撤风险）；③**急砸抄底**——急砸深跌后的低位=抄底机会（正向，区别于阴跌）；④**阴跌流失拒**——阴跌+「holder 流向行 holdersDelta60 为负」（持有人流失）=不宜入场形状；⑤**常态可买+非理性拉盘拒**——波动/横盘/温和上涨常态可买，「激烈不合理的拉盘」拒（momentum/entry_position 反锚④带同款豁免臂）。桶域不动（good/neutral/poor/insufficient，mapper/题集锁死）。

**5 新锚（snapshot 自算，引擎/runner 单点同源）**：`mcapBnb/mcapPeakBnb/mcapFromPeakPct`（priceArc 末价/ATH × meta.totalSupply；supply 或可靠价缺失 null fail-closed——与 FA `marketCap` 的 0 语义刻意不同，BP 材料宁缺勿错）；`holdersNow/holdersDelta60`（正净持仓钱包数与近 60s 变化，两遍重放：pass1 `dt≤tEnd−60` 行、pass2 全行，delta=差；`t.tok` 任一缺失 null；剔路由伪钱包）。

**引擎融合（T117）**：新服务 `src/market-analysis/BuyPointCheckService.js`（镜像 CheatCheckService 骨架：settle 双模 waitIdle/固定帽、mem 行环双源 miss 回 DB、`_ensureLlm` dynamic import 共用 ESM JevClient、超时竞速迟到链 service 内部落行、首行 prompt 全文防线、失败冷却、inflight join；**无**粘滞/拉黑/grade——mapper 纯透传）；新表 `buy_point_analyses`（verdict CHECK assessed/error/timeout + assessment 四桶 + dimensions/answers_raw/jev_prompt/snapshot_digest/anchor_tick_count/fail_reason/signal_id/source_experiment_id；DDL `migrations/create_buy_point_analyses.sql` 182 手工执行）；配置 `fourmemeWs.buyPointCheck`（enabled/gate.awaitMs 15000/memSource，flap 经 _mergedWsConfig 同键）；引擎 `_bpGateEvaluate` 全 fail-closed（bp_gate_* 域）+ metadata `buyPoint` 段。

**单测**：`_test_buy_point_lib.cjs` 扩至 144 断言（A 组 5 锚手算：supply=1e9/末价 1.6e-9 → mcapBnb=1.6、峰 2.0e-9 → mcapFromPeakPct=20；holdersNow=7（净 0 不计）/holdersDelta60=−1（60s 前含未清仓 W_D=8）；supply null 市值族 null 但 holder 族不受影响=证据门独立；D 组渲染两新行；E 组 mapper anchors 透传；F 组 BP2 版本+五条框架措辞+豁免臂引用断言）；新 `_test_buy_point_check_service.cjs` 26 断言（五状态/迟到丢弃/首行 prompt 恰一次/版本换挡/inflight/settle 双模/signalInfo 进 state/冷却可控时钟/dbManager 单层路径锁）。

**余留**：BP1→BP2 对拍（182 `run.mjs --set bp-2026-11-03-live4` 232 点位重析，看 good/neutral/poor 迁移与 +15min 末值中位单调性不劣化；跑前知会用户）；生产首析 grade 轨迹观察（新虚拟实验冒烟后）。

### BP3 测试集换源 trades + ladder 挖掘 + ticks 页叠画（2026-11-05，机制案·T117 同日续案）

**用户指令**：①测试集换源——「换成最新的三个 Live 实验中所有的交易点位，但是当前如果已经是 cheat/unhealthy 了就不要收录了」；②「买入点位这里就不要用信号页面了，ticks 页面更加适合」——点位画到 token-ticks 页图表上；③「对于代币的点位，我认为也通过新的买入条件再挖掘一波，一个代币可以对应多个点位，多条测试数据」。

**trades 源口径**：`--source trades`（build-set 新参数，默认即 trades；`--source signals`=旧 BUY 信号口径保留）：trades 表 `trade_direction='buy' AND success=true` 全量成交买点（**不去重**——每笔成交都是独立点位，dedupe-sec 缺省 0；signals 源缺省 60 不变）；entry 价=`input_amount/output_amount` 精确换算（trades.unit_price 是 USD 口径禁冒充 BNB fire 价；非 BNB input_currency 行 priceBnb=null 不冒充）；cheat/unhealthy 剔除=cheat_detection 最新有效行 grade（grade 藏 `snapshot_digest` jsonb 非独立列；`.eq('is_valid',true)` 批 25 查、analyzed_at desc 批内首见），healthy/null 放行。

**ladder 挖掘（`scripts/buy-point/mine-ladder.mjs`）**：T117 阶梯库条目（`--legs-lib` 缺省 `signal-source-ladder-v1`，`none`=关）七条腿在 per token 历史 ticks 上 **FA 真本体重放**——`registerToken → processTick(逐行,{emitFactors:false}) → buildFactorMap(addr,ts) → ConditionEvaluator.evaluate`（与回测/生产同一取数路径）；**per (token, legId) 首次满足=一点位**（对齐生产 maxTriggers=1 触发即消耗；t1-t7 阈值递进=同 token 多点位沿时间轴排开=阶梯接棒形状）。腿标识从 priority 派生 `t${priority}`（库条目腿无 id/name——引擎 config→strategy 映射时才生成 `buy_${idx}_${priority}`）；点位携带九键因子摘要（tradeCount/buyVolumeBnb/holdersExDust/recentBlockDropPct/marketCap/mcapFromPeakPct/quietSpanMs/quietSurgeBuyBnb/quietSurgeSec）。单测 L 组真 FA 跑（5 buy+1 sell 票三腿首真点/因子快照值锁定）。

**首跑（set=bp-2026-11-05-live3-trades，182 构建）**：v70/v71/v72 三 live 实验 → 59 成交买点（cheat/unhealthy 剔除后）+ **ladder 挖掘 343 点**=**402 点位 / 59 token**；腿分布 t1=59/t2=59/t3=56/t4=55/t5=56/t6=57/t7=1。阶梯接棒实形（SI 票）：t6 锚 4 → t1 锚 11 → t2 锚 17 → t3 锚 22 → t4 锚 25 → 成交 BP-T055 锚 30。

**⚠事故留档（TICK_COLS 漏列 → FA 因子恒零）**：首跑 59 token ladder 全零触发；探针复跑发现 tradeCount/buyVolumeBnb 全窗=0——`processTick` 首行守卫 `if (!tokenAddress || !tick.timestamp) return null` 对 token_address=undefined 的行**全行静默跳过**（ticks 拉取列清单漏 `token_address`，行数据本身在但字段缺失）。修复=TICK_COLS 加列 + mineLadderPoints 入口 fail-loud throw（rows[0].token_address 缺即 throw，防再次静默全零）——「静默零值=因子链路断裂被掩盖」与条件未知因子三防线同哲学。

**ticks 页叠画（token_ticks.html/token-ticks.js）**：BP 小节（set 下拉+点位表：源徽章 trades 橙/ladder 紫、腿名 title=条件串、锚 ticks、+1/+5/+15min 前向、episode pnl）+ 两图 scatter 叠画（trades=橙三角 triangle、ladder=紫菱形 rectRot；y=锚时刻最近 tick price_usd 二分+回扫；窗外无价跳过不冒充）；`?bp=<set>` 直达。**Chart.js 倒序绘制坑**：datasets 数组靠前者**最后画=最上层**——scatter 排尾部会被几百个半透明气泡堆叠近似不透明埋掉（实测像素采样橙 0/紫 8），修复=BP datasets 排数组最前（气泡图建图时 spread 在首位 + K 线图 unshift），修复后像素橙 72/紫 697。

**t6 低市值臂观察点（阈值归用户裁定）**：`marketCap > 0 AND marketCap <= 7.5 OR mcapFromPeakPct >= 60` 在多数票**出生几笔内即触发**（BP-L316 锚=4、marketCap=5.8）——市值从 0 涨起的前几笔必 ≤7.5 BNB，t6 实际形状=「出生即触发」门（无 age/热度前卫）；57/59 票 t6 命中与 t1-t4 几乎全票首穿同因（样本=引擎已成交票天然热度达标）。t7=1（静默段放量形状最稀有，符合设计预期）。

**t6 峰门修正（2026-11-05 用户澄清同日裁定：低市值臂「希望从高点跌下来的时候触发，不是给早期用的」；AskUserQuestion 选峰 ≥15 BNB）**：条件改 `(mcapPeakBnb >= 15 AND marketCap > 0 AND marketCap <= 7.5) OR mcapFromPeakPct >= 60`——峰门=「涨出 7.5 低线至少翻倍再跌回」（数学上隐含回撤 ≥50%），与第二臂（深回撤 60% 管高峰值票）互补；出生票峰值未到 15 前低市值臂天然不触发。**59 票探针对拍**（tmp-t6-probe.mjs，182 跑 FA 重放零 Jev）：OLD 锚中位 1/52 票锚≤5/触发时回撤中位 0% → 峰≥15 版 9 命中/锚中位 237/零锚≤5/回撤中位 61%；峰>7.5 宽松版回撤中位仅 15.8%（贴线蹭形状）被否。全史峰值分布 <7.5=3/[7.5,15)=43/[15,30)=9/≥30=4——本批成交票多为中小峰，t6 命中 57→10（严格化=预期）。**落地**：deploy 脚本加同名 UPDATE 分支（buy-v2 系惯例 version+1 而非新名，legs/description 变化才写）+库条目 signal-source-ladder-v1 v1→2（182 --commit）+重建 set=`bp-2026-11-05-live3-t6gate`（363 点位=61 trades+302 ladder，t6=10 点锚 15~624 全部「跌回」形状；源点位 61>59=live 实验仍在产出新成交、cheat/unhealthy 剔 0=T117 门链生效后成交票天然过门）。⚠v73 引用的是 copy-in 快照（v1 条目），**须重建实验/换代才吃到 t6 新形状**。

**余留**：BP2 对拍换 set 跑（bp-2026-11-05-live3-t6gate 363 点位或旧 232 点位重析，跑前知会用户）；v73 是否立即换代吃到 t6 峰门（v73 起跑首日，T117 首跑观察期——换代时点归用户）；生产 BP 门轨迹观察。
