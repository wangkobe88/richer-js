# 买入点位分析与 Case 台账（BP）

## 分工声明与写作纪律

本台账与《叙事引擎改进与Case台账.md》（C 编号）、《交易策略改进与Case台账.md》（T 编号）、《作弊盘检测与Case台账.md》（CD 编号）并列：**买入点位分析模块**（Jev 驱动的入场时机判定）的机制演进与案史归档。

- **BP 编号全局唯一、永不回收**；新案插 Case 节顶部，编号 = 现有 max + 1
- 每案必带：**token 地址 + 点位锚**（anchorTickCount）、用户裁定原话（如有）、验证数据、对应单测名
- 机制/题集改动 = 新 BP 条目 + 必要时 bump `BUY_POINT_QUESTIONS_VERSION` + 回归收录（测试集 set 重跑）
- 决策过程细节、反复推翻的中间方案可简写；现行机制以代码与本文「机制一屏」为准

## 现行机制一屏（BP1 起，2026-11-03 立项）

**买入点位分析 = Jev 驱动的入场时机判定模块**。动机（用户原话）：「感觉简单指标无法满足要求……通过 ticks 判断当前点位是否可以买入」。与反作弊模块（CD）分工：**输入同样是 ticks（wss_price_ticks 锚截窗），CD 判「盘面是否作弊」，本模块判「当前点位是否适合买入」**——入场时机好坏（时点判定，非 token 终身属性、非盘面性质）；协同/作弊形状在题面里只作降档参考，结论归 CD。

**本期=第一步（模块本体 + 测试集）**；第二步（实验引擎融合：Service/DB 表/FA 投影/引擎挂点/回测接线）**未做**——无任何规则映射层/grade（判定形态=用户裁定「Jev 综合判定」：维度题组给档位，综合题 `buy_point_assessment` 由 Jev 直接给 good/neutral/poor/insufficient；代码纯透传，与 CD D3.5「判断一律 Jev」同哲学）。

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
scripts/_test_buy_point_lib.cjs  单测（零 DB 零网络，A-I 九组）
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

（暂无——测试集首跑后按点位校准开案）
