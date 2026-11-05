# 买入点位分析与 Case 台账（BP）

## 分工声明与写作纪律

本台账与《叙事引擎改进与Case台账.md》（C 编号）、《交易策略改进与Case台账.md》（T 编号）、《作弊盘检测与Case台账.md》（CD 编号）并列：**买入点位分析模块**（Jev 驱动的入场时机判定）的机制演进与案史归档。

- **BP 编号全局唯一、永不回收**；新案插 Case 节顶部，编号 = 现有 max + 1
- 每案必带：**token 地址 + 点位锚**（anchorTickCount）、用户裁定原话（如有）、验证数据、对应单测名
- 机制/题集改动 = 新 BP 条目 + 必要时 bump `BUY_POINT_QUESTIONS_VERSION` + 回归收录（测试集 set 重跑）
- 决策过程细节、反复推翻的中间方案可简写；现行机制以代码与本文「机制一屏」为准

## 现行机制一屏（BP1 起，2026-11-03 立项）

**买入点位分析 = Jev 驱动的入场时机判定模块**。动机（用户原话）：「感觉简单指标无法满足要求……通过 ticks 判断当前点位是否可以买入」。与反作弊模块（CD）分工：**输入同样是 ticks（wss_price_ticks 锚截窗），CD 判「盘面是否作弊」，本模块判「当前点位是否适合买入」**——入场时机好坏（时点判定，非 token 终身属性、非盘面性质）；协同/作弊形状在题面里只作降档参考，结论归 CD。

**BP2（2026-11-05）起第二步引擎融合已做（T117 信号源门链）**：新服务 `BuyPointCheckService` + 新表 `buy_point_analyses` + 引擎挂点——携带 `signalGate` 的买腿（初始买入信号源）触发后依次过作弊门（二元版）→ **BP 门**（`buy_point_assessment` 桶 ∈ bpPassLevels（缺省 good/neutral）过/拒），两门都过才买；BP 门 **fail-closed**（超时/Jev 错/disabled 均拒——BP 是点位判定唯一来源无据不买；**insufficient_ticks 唯一例外放行（BP9 2026-11-05 用户裁定「反作弊检测中 bp_gate_insufficient_ticks 请去掉」——极早触发锚窗 tick<minTicks=early_bird 场景常态不判不拦，minTicks 预门保留在 service 不烧 Jev 配额）**），回测恒拒（signalGate 腿全量排除）。详档交易台账 T117 案与下方 BP2 案。**现行判定形态（题集 BP8，案号 BP8 圣诞树+BP10 速度锚校准）=活跃度门+三类质量题制**：综合判定=**代码侧两层**——①活跃度门（market_heat=low → poor，rule=activity_gate，「活跃度不够不参与交易」）；②三类质量题聚合（early_bird_quality / pullback_entry_quality / high_chase_quality，桶域 good/neutral/poor/insufficient，Jev 三视角**并行独立评估**，每题先判场景适用非场景→insufficient 不贡献；用户原话「这三者有任何一个为 good 则为 good，为 neutral 则为 neutral，否则为 poor」：任一 good→good，否则任一 neutral→neutral，否则 poor；三题全 insufficient→poor 且 prob=null）——替代 BP3-BP5「类别题路由+综合题」两步制（对拍实证 Jev 常忽略路由指令，形态从根消除路由依赖）；维度题（6 题）纯参考不进聚合；追高题=策略停买留痕（场景成立一律 poor，放开只改该题面）。**早鸟/回调忌讳现行口径（BP10）=maxChg5Pct 回看速度锚+判序**：早鸟①=第一分支价格低救（maxChg5 过线∧near_launch→命中即停 neutral）→第二分支暴涨忌讳（过线∧low+→poor）；回调=⓪价格低优先救（near_launch∧早鸟窗∧浅回调→neutral；深回撤不救）→①崩塌第一腿（maxChg5 过线后的下跌无论深浅）→②没跌到位→③奔零。6 维度现行：price_trend 六桶（动量窗 **5/10/30s 短窗**——BP6 用户裁定）｜ sell_pressure ｜ market_heat ｜ entry_position 相对价格高低四桶 ｜ price_level 绝对价格高低五桶·参照系=发行价 ｜ **tree_position 圣诞树形状与位置六桶=观察档（BP8——用户裁定「暂时圣诞树这一锚，先不参与决策吧。我觉得判断起来有点太难了，但是可以先放里头」：题照问、zigzag 摆动锚照算、digest 照落攒分布，mapper 不消费任何 tree 桶；后续启用只改 mapper 聚合+题面措辞届时 bump）**。

### 模块分层（与 CD 模板同构，口径单点复用）

```
src/market-analysis/
  buy-point-snapshot.js      CJS 纯函数：cheat buildSnapshotFromRows 复用 + buyDerived
                             （近窗 30/60/120s 族/动量/节奏/参与结构/卖压/价格 20 桶）
  buy-point-state-builder.js CJS 纯函数：[TOKEN]/[ANCHOR]/[PRECOMPUTED]/[PRICE]/[TICKS]/[WALLETS]/
                             [判定指引]，20k 预算；[TICKS] 展示=首 50+末 250（近端为主）
  buy-point-result-mapper.js CJS 纯函数：answers→{dimensions, qualities, assessment, anchors}
                             （BP6 起聚合=代码侧确定性 any_good→any_neutral→else_poor）
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
| BP3 | 2026-11-05 | **分类判读框架（案号 BP4——题集版本号与 BP 案号体系撞号：BP3 案号已被同日测试集换源案占用，题集版本照 BP1/BP2 序数顺延）**：新增类别题 `point_category` 四桶（early_bird/pullback_entry/high_chase/unclear——只判类别事实不下买卖结论，三轴并读=时间轴 tokenAgeSec+位置轴 currentVsAthPct/mcapPeakBnb/mcapFromPeakPct+轨迹轴 chg30/60/120 与 PRICE 形状）；综合题判读总纲改「第一步先按类别分路，再按各类忌讳权衡」；BP2 五条框架收编（拉高拒+低市值豁免并入早鸟类、急砸抄底+阴跌流失拒并入回调类、活跃门槛/协同降档/薄窗 insufficient 作通用条保留）；**assessment 四桶域不动=服务端/bpPassLevels/引擎门零改动** | 单测 `_test_buy_point_lib` 182 断言（F 组重写：9 题/8+1 对齐/POINT_CATEGORY_LEVELS 双副本锁/分类框架措辞锁）；60 点抽样对拍=台账 BP5 案 |
| BP4 | 2026-11-05 | **BP3 对拍后执行修正（案号 BP5）——两处 Jev 分路未执行修正**：①追高类升级**硬路由**（「无条件一律 poor」+总纲「分路是硬路由：追高路内维度档位再强也输出 poor」+**good 桶描述显式排除追高类**——桶描述级防线）；②早鸟豁免臂收紧：忌讳「不买极快速上涨/已拉高」**无条件不因低市值豁免**，豁免仅限温和爬坡（chg30 个位数/多桶缓升有回踩整理）+「**位置先于动能**：贴高急拉下的强买压（price:strong+buy:strong）是接力风险不是入场信号」（已拉高形状锚=现价贴全窗高点∧chg30 两位数/垂直窜升无回踩） | 同 60 点复跑：good 23→3 / poor 35→56；追高点 good(0.44)→poor(0.75) 兑现；新 good 3 点全为回调贴低企稳（2/3 结局为正）；pullback 分化更纯（good +8.49% vs poor -15.93% 末中位）；错失面=猫咪天团单票 5 连点（设计内代价，见 BP5 案） |
| BP5 | 2026-11-05 | **维度瘦身+双价格轴（案号 BP6——60 点逐点复审中用户裁定）**：删 chip_flow / pace_trend / buy_pressure_quality 三题（9→7 题=5 维度+1 类别+1 综合，「维度太多决策困难」）；price_momentum→**price_trend 六桶**（fast_up/slow_up/fast_down/slow_down/flat/volatile——快/慢参照 \|chg30\| 两位数界）；entry_position 改**相对价格高低四桶**（near_high/shallow_pullback/half_off/ankle_cut——回撤分界 <10%/10~35%/35~70%/>70%）；新增 **price_level 绝对价格高低五桶**（near_launch/low/mid/high/very_high——参照系=**发行价**，分界 ≤+50%（含破发）/+50~200%/+200~600%/+600~2000%/>+2000% 初版待校准）；snapshot 新增**发行价位置族三锚**（launchPriceBnb=全数组首个可靠价、launchCovered=出生段覆盖判据 min dt≤BP_LAUNCH_COVER_TOL(90s) 截窗不冒充、currentVsLaunchPct 可破发为负）；综合题总纲同步（已删维度引用改数值锚：买压→参与结构行买家数/新买家；「位置先于速度」；并读轴=**相对/绝对价格双轴交叉定位**）；state [PRECOMPUTED] 增发行价位置行（fmtPrice 口径） | 单测 `_test_buy_point_lib` 187→**197 断言**（E/F 组重写+A 组发行价手算+C 组截窗 null fail-closed+D 组发行价行渲染）；BP5 题面 60 点重跑对拍**未及执行即被 BP6 形态替代**（价格轴/发行价锚并入 BP6 后一起跑） |
| BP6 | 2026-11-05 | **三类质量题制+动量短窗（案号 BP7——用户裁定原话「将 early_bird/pullback_entry/high_chase 三者作为题本身，good/neutral/poor/insufficient 分别用于评估这三者的质量。这三者有任何一个为 good 则为 good，为 neutral 则为 neutral，否则为 poor」）**：①类别题+综合题两步制**整体退役**（对拍实证 Jev 常忽略路由指令——BP-T009 判 high_chase(0.66) 却给 good），改为 **3 类别质量题**（early_bird_quality / pullback_entry_quality / high_chase_quality，桶域 good/neutral/poor/insufficient）三视角并行独立评估——每题先判场景适用（非场景/材料薄→**insufficient 不贡献聚合**），场景成立按各类忌讳权衡（早鸟忌极快拉高/已拉高无条件不因低市值豁免·位置先于速度/断流/协同；回调忌没跌到位/奔着归零（阴跌+holdersDelta60 负+大持仓派发）/断流/协同，good=深回撤后企稳；**追高=策略停买留痕：场景成立一律 poor**，good/neutral 桶留「放开时改本题面」占位）；②**综合判定=代码侧确定性聚合**（mapper 内 any_good→any_neutral→else_poor 三臂；prob=该 tier 最大；rule 键=any_good/any_neutral/else_poor 聚合来源留痕；三题全 insufficient→poor 且 prob=null）——assessment 不再有 insufficient 桶（薄窗票聚合落 poor，门行为不变：poor/insufficient 都拒）；③**动量短窗 30/60/120→5/10/30s**（用户裁定「窗口太大了，我们要判断的是近窗口的趋势」——snapshot chg 族/state 近窗动量行/mapper 锚/price_trend 题面与早鸟题怎么算段同批；短窗内无更早价自全窗首可靠价起算=可得最早价以来动量，state 行显式声明）；④消费面：service 日志行换三质量题档位+`qualities` 透传（gateBuyPoint 返回+digest 落表——无独立列随 snapshot_digest 落）、引擎 BP 门 info 组装 additive `qualities`、run.mjs 判定行两行制+results 落 qualities；⑤题集 8 题=5 维度+3 质量（每题均含「怎么算」段）；**容错双轨**：质量题 strict（缺答案/未知桶 throw——综合判定唯一来源），维度题容缺照旧 | 单测 `_test_buy_point_lib` 197 断言重写（E 组聚合三臂+strict throw+全 insufficient prob=null；F 组 8 题/QUALITY_LEVELS 双副本锁/三题忌讳与停买锚/短窗锚）+`_test_buy_point_check_service` 26 断言（8 题桩+qualities 形状）；BP6 题面 60 点重跑对拍=待跑（烧 Jev 配额先知会；兼作 price_level 分界校准素材） |
| BP7 | 2026-11-05 | **圣诞树锚三层框架+活跃度门（案号 BP8——用户三层框架原话「1.判断活跃度，活跃度不够不参与交易（所以可以把活跃度作为第一个锚）；2. 判断在圣诞树中的位置，价格历史不是圣诞树或者位置不对不交易（第二个锚）；3.得到其它所有现象锚的情况，然后用于判断是三种买入点位的哪一种」）**：①**活跃度门落地**（market_heat=low → poor，rule=activity_gate——热题反锚④同步「low 档=短线进出无流动性承接，代码侧活跃度门直接消费 low 档拒买」，删旧矛盾句「热度低也不等于不能买」）；②**圣诞树形状与位置题 tree_position 六桶**（left_side 待涨/top 待跌/right_side 下跌/right_bottom 树脚/not_tree 暴涨暴跌反常/unclear 判不出≠not_tree——前期首树左侧早段本来就没有完整树形可辨，用户补充裁定原话「圣诞树形状在前期可能是很难判断的，如果判断不出来，那就可以通过」）；③**zigzag 摆动结构锚族**（snapshot：BP_SWING_THRESHOLD_PCT=20 阈值化峰谷交替——dir=0 期双向追踪 runMax/runMin 反向幅度先触阈者确认首摆点（两阈同点命中峰确认优先=确定性声明），进段后涨段找峰/跌段找谷（回落/反弹 ≥20% 确认），ext=当前段极值候选；8 标量锚 swingHighCount/swingLowCount/swingLastDir/secSinceSwingHigh/secSinceSwingLow/currentVsSwingHighPct/currentVsSwingLowPct/swingMaxAmplPct+swingPoints/swingLegs 数组=state 渲染原料不进锚；<2 可靠价全族 null；state ②a 摆动结构行+mapper 锚透传）；④三质量题场景判别挂树佐证（早鸟≈首树左侧早段 left_side/unclear、回调≈树脚 right_bottom「狙击手脉冲买入后的回调=小圣诞树结束+可能的大圣诞树开始」、追高≈树顶 top·首树左侧爬坡中贴高不是追高）；⑤**圣诞树门裁定暂不参与决策**（用户原话「暂时圣诞树这一锚，先不参与决策吧。我觉得判断起来有点太难了，但是可以先放里头」）——tree_position=观察档：题照问、锚照算、digest 照落攒分布（T74/T76 同构），mapper 聚合不消费任何 tree 桶（not_tree/top/right_side 一律不拦）；rule 域=activity_gate/any_good/any_neutral/else_poor 四值；后续启用只改 mapper+题面措辞（届时 bump）；⑥判定结构=①活跃度门→②三质量题聚合两层（原三层框架第②层缓议） | 单测 `_test_buy_point_lib` 236 断言（A 组 zigzag 手算 9 断言·谷@5/峰@110/lastDir −1/距峰 105s 距谷 210s/较峰 −20% 较谷 +60%/最大摆幅 100%；C 组 <2 可靠价全 null；D 组摆动行渲染+两层指引；E 组活跃度门 3 断言+tree 各桶不拦观察档反证+rule 域绝迹断言；F 组 tree_position 题面 8 锚句+门语义措辞绝迹反证+三题挂树）；`_test_buy_point_check_service` 26 断言（tree 桩 additive 零影响）；BP7 题面重跑对拍=待跑（tree_position 分布+摆动锚素材攒批） |
| BP8 | 2026-11-05 | **早鸟/回调忌讳校准：5 秒回看速度锚+判序版题面（案号 BP10——SB 六点复审六段用户裁定；⚠题集版本与案号错位续：BP8 案号已被圣诞树案占用、BP9 被 insufficient_ticks 放行案占用）**：①**maxChg5Pct 回看速度锚**（snapshot 新增：锚窗内任意 5 秒段最大涨幅=「前期上涨速度」的稳定度量——用户裁定原话「我的感觉是前期最重要是参考5秒的上涨速度，我的意思并不是看累计涨幅，涨幅不是速度」；滑动窗最低价单调队列 O(n)，起点取窗内最低非最旧；<2 可靠价=null；当前时点 chg5 测不到此前段暴涨=四跑大倒退根因）；②早鸟忌讳①重写=**判序两分支**（第一分支·价格低救：maxChg5 过线但 price_level=near_launch（累计涨幅还小）→**命中即停判 neutral 不判 poor**——「早期快涨本身正常不拒，单纯看上涨速度快至多可买可不买之间，不过如果价格低也没问题」；第二分支·暴涨忌讳：maxChg5 ≥ +40~50% 级 ∧ 价格已不低（low+）→ poor——「位置先于速度」，市值低不豁免）；③回调忌讳重写=**⓪分支前置**（⓪价格低优先救：near_launch ∧ 早鸟窗 ∧ 浅回调（near_high/shallow_pullback）→命中即停 neutral；**深回撤 half_off/ankle_cut 不走本分支**——S026 分界锁定；①崩塌第一腿：maxChg5 过线后的下跌=「崩塌不是健康回撤」无论回撤深浅与企稳迹象——用户裁定原话「前期上涨太快的下跌点很危险，这个基本原则，放到回调的判断标准中」；②没跌到位（⓪未命中的浅回撤才走）；③奔零）；④「怎么算」/criteria 桶全量速度口径同步；state [PRECOMPUTED] ②b 回看速度行（明写「涨幅不是速度，判前期暴涨以此为速锚而非累计涨幅」） | SB 六点七轮对拍 5/6（S020/S021=neutral、S022-S026=poor 裁定全兑现除 S021——救臂三条件全命中仍 poor 0.93，**后见裁定与锚窗信息合理分歧，用户裁定接受收口**，详 BP10 案）；单测 `_test_buy_point_lib` 242→248 断言（A 组 maxChg5 手算+单调队列反证+F 组判序锚句）；53 点集全量重跑=待跑 |

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

### BP10 早鸟/回调忌讳校准：5 秒回看速度锚 maxChg5Pct + 判序版题面（题集版本 BP8）（2026-11-05，校准案·SB 六点复审；六段用户裁定+七轮对拍）

**触发背景**：SB（`0x92aac04f03278ce7ac82ba0367dbaf9686437777`，v73 `c6efed13`）六点复审（set=bp-2026-11-05-v73-signals，S020/S021/S022/S023/S025/S026——T117 阶梯 P1-P6 六信号沿时间轴排开）。

**用户裁定原话（六段，按时间序）**：
1. 「所以这个代币，前两个点 中等，第3之后都是poor」——六点裁定基线：S020/S021=neutral，S022/S023/S025/S026=poor。
2. 「前两个点之所以 中等， 是因为价格低」——价格低是 neutral 的**依据**（充分理由非弱豁免）。
3. 「“chg30 +39.4%” 我认为参考这个指标不行，代币刚发出来没有多久，得看代币活跃交易到当前点的上涨幅度」——chg30 滚动窗对 age 短的票失真。
4. 「我的感觉是前期最重要是参考5秒的上涨速度，我的意思并不是看累计涨幅，涨幅不是速度。」——主锚=5 秒上涨速度（涨幅≠速度）。
5. 「刚发出的代币，前期上涨快是正常的，我只希望不要是那种直接暴涨太大的即可（这个单纯看上涨速度我觉得在可买可不买之间），不过如果价格低也没问题。」
6. 「这个代币靠后的买入点位判负，原因是前期上涨过快，而前期上涨太快的下跌点很危险，这个基本原则，放到回调的判断标准中。前两个点位判 neutral。」

**SB 六点锚数据（对拍基线，182 真实 ticks 探针 /tmp/sb-maxchg5.cjs）**：S020 age3s/maxChg5+34.7/vsLaunch+34.3/near_launch→neutral；S021 age12s/**maxChg5+58.3**/vsLaunch+39.4/near_launch/浅回调23.7%→neutral；S022 +58.3/+99.3/**low**→poor；S023 +72.4/+107/low→poor；S025 +72.4/+66.3/low/回撤30.8%→poor；S026 +72.4/−14.8破发/深回撤64.5% half_off→poor——**速度×价格组合分界自洽**：速度过线但 near_launch（累计涨幅还小）→neutral；速度过线∧价格已不低（low+）→poor；深回撤（half_off）不走价格低救（S026 分界锁定）。

**主锚演进（七轮迭代链，题面 commit 序）**：①BP8 原版「chg30 两位数快涨正常不拒」对 SB 过严 → ②暴涨级收窄（chg30 三位数翻倍级无条件）+崩塌腿（8493de1a）→ ③secSinceAth 降佐证+涨幅幅度主锚（c37bde31，一跑 S021 误伤根因=ATH 恰在 1s 前命中「秒级」）→ ④价格低可救升判定指令（cc7c3ea4）→ ⑤速度口径当前时点 chg5（7a80e5f6）→ ⑥**maxChg5Pct 回看速度锚**（a3547aac）→ ⑦总指令（138e2400）→ ⑧判序版（9ff0f920，终稿）。

**maxChg5Pct 回看速度锚（snapshot 纯事实，代码只组数据快慢判读归 Jev）**：锚窗内任意 5 秒段最大涨幅——解决「当前时点 chg5 测不到此前段暴涨」失真（四跑大倒退根因：S022 锚落脉冲后平台当前 chg5 仅 +9.1 但此前 5 秒段 +58.3，被翻 neutral）。实现=可靠价滑动窗**最低价单调队列 O(n)**（对每个终点 j 取 5s 窗内最低价为起点——起点取窗内最低非最旧，先跌后涨段不被低估）；<2 可靠价/无 ≤5s 跨行段=null。state [PRECOMPUTED] ②b 回看速度行（题面明写「涨幅不是速度，判前期暴涨/上涨过快以此为速锚而非累计涨幅」）；mapper 锚透传。

**判序版终稿题面（并列硬指令打架的结构化解法）**：五/六跑教训=救臂与忌讳**并列**时（maxChg5 过线→poor vs 价格低→neutral）Jev 恒选崩塌腿（数值锚 +58.3 高调压过文字指令，弱豁免/总指令两档语气升级均无效）——正解=**结构化判定顺序**：早鸟①拆「**第一分支·价格低救**（maxChg5 过线但 price_level=near_launch=累计涨幅还小→**命中即停判 neutral 不判 poor**：早期价格发现+快涨脉冲未形成存量风险，单纯看上涨速度快至多可买可不买之间）→**第二分支·暴涨忌讳**（maxChg5 ≥ +40~50% 级 ∧ 价格已不低 low+→poor，位置先于速度）」；回调忌讳段前置「**⓪价格低优先救**（near_launch ∧ 早鸟窗 ∧ 浅回调 near_high/shallow_pullback→命中即停 neutral；**深回撤 half_off/ankle_cut 不走本分支**=S026 分界）→①崩塌第一腿（maxChg5 过线→此后的下跌是崩塌不是健康回撤，无论回撤深浅与企稳迹象）→②没跌到位（⓪未命中的浅回撤才走）→③奔零」。

**七轮对拍矩阵（SB 六点 vs 裁定 neutral/neutral/poor/poor/poor/poor）**：

| 跑 | 版本 | S020 | S021 | S022 | S023 | S025 | S026 | 计 |
|---|---|---|---|---|---|---|---|---|
| 一 | 暴涨级+崩塌腿 | ✓0.72 | ✗poor 0.88 | ✓ | ✓ | ✓ | ✓ | 5/6 |
| 二 | secSinceAth 降佐证 | ✓ | ✗0.55 | ✓ | ✓ | ✓ | ✓ | 5/6 |
| 三 | 可救升判定指令 | ✓ | ✗0.53 | ✓ | ✓ | ✓ | ✓ | 5/6 |
| 四 | 当前 chg5 速度口径 | ✗poor | ✗0.67 | ✗neutral | ✓ | ✓ | ✓ | 3/6 |
| 五 | maxChg5 回看锚 | ✓ | ✗0.93 | ✓ | ✓ | ✓ | ✓ | 5/6 |
| 六 | 总指令 | ✓0.72 | ✗0.94 | ✓ | ✓ | ✓ | ✓ | 5/6 |
| 七 | 判序版（终稿） | ✓0.77 | ✗0.93 | ✓0.89 | ✓0.82 | ✓0.95 | ✓0.97 | **5/6** |

**S021 分歧留档（用户裁定接受 5/6 收口，2026-11-05）**：七跑 S021 救臂三条件**全部命中**（price_level=near_launch ✓ / entry_position=shallow_pullback ✓ / tokenAgeSec=12 ✓）仍 poor(0.93)，概率分布 good=0/neutral=0.03——压倒救臂的锚=`maxChg5+58.3 ∧ secSinceAth=1s ∧ vsAth−23.7%`（5 秒近六成暴涨→顶点后 1 秒内已回落 23.7%），锚窗视角就是「崩塌第一腿正在发生」，Jev 对该形状判断比文字指令硬。本质=**后见裁定（SB 后续走好）与锚窗信息的合理分歧**；且 S021 拒单实盘代价≈0（S020 三秒前第一信号 neutral 已过门买入，同 token 已持仓，S021 为同票第二信号）——接受分歧不改。从五跑起 S021 概率反升并稳定 0.93+：maxChg5 锚锁死 S022-26 全 poor（设计目的）同时把 S021 一起带走，两者只差 price_level 一档，Jev 给速度证据权重远大于价格档位——后续若同类误伤攒批再议（候选=速度锚与价格档的显式乘法门），单票不动。

**单测**：`_test_buy_point_lib` 242→248 断言（A 组 maxChg5 手算 fixture：33s 段 0.9→1.35=+50% 最陡/44s 先跌后涨 1.0→1.3=+30% 锁「起点取窗内最低价非最旧」/间隔 ≥10s 无 5s 跨行段=null 反证；E 组透传；F 组判序锚句两处：『第一分支·价格低救（命中即停，判 neutral 不判 poor）』『深回撤（half_off/ankle_cut）不走本分支』）。

**余留**：53 点集全量重跑对拍（BP8 vs 旧版分布）；v73 换代吃 BP8 题面；同类 S021 形状误伤攒批。

### BP9 BP 门 insufficient_ticks 拒单去掉（放行）（2026-11-05，门语义案·T117 BP 门；用户指令）

**触发背景**：T117 信号源门链（signal-source-ladder-v1 七腿阶梯）生产运行中，`bp_gate_insufficient_ticks` 成为高频拒单来源——阶梯触发键（recentBlockDropPct ≤4 块收盘环 / quietSurge 静默段突刺）本就瞄准**极早触发点**，触发时刻锚窗 tick 数常 <minTicks(8)，BP 门 minTicks 预门返回 insufficient_ticks 后引擎 fail-closed 拒（reason=`bp_gate_insufficient_ticks`）——信号源要抓的早鸟点位被 BP 门系统性拦截，机制自相矛盾。

**用户指令原话**：「反作弊检测中 bp_gate_insufficient_ticks 请去掉」。

**改动（引擎 `_bpGateEvaluate` 单点）**：`insufficient_ticks` 从 fail-closed 拒分支拆出为**唯一例外放行**——tick 不足不判不拦：pass=true、不打 signal failed、info 落 signal metadata `buyPoint` 段（status=insufficient_ticks + anchorTickCount + passed=true 留痕）+引擎 info 日志。**service 侧 minTicks 预门保留**（不调 Jev 不落表）：材料薄（tick<8）照调 Jev 只会三质量题全 insufficient→聚合 poor（BP7 规则三题全 insufficient→poor）=换皮仍拒且烧配额——预门保留=配额防线，拒单语义的消灭在引擎消费侧。其余门语义不动：assessed→bucket∈bpPassLevels 过/poor 拒（bp_gate_assessment）、timeout/fail/disabled/异常全拒（bp_gate_* 域）、cheat 门 fail-open 放行进 BP 兜底链不变。

**门语义张力留档（刻意接受）**：BP 门「无据不买」原则对 insufficient_ticks 开口子后，极早票（tick<8）在 cheat 门 fail-open + BP 门放行的叠加下无 BP 判定直接进执行层——两门对该形状同向放行=设计意图（早鸟场景 tick 少是常态非异常，正是信号源阶梯的目标点位）；timeout/fail 等真故障仍全拒兜底。

**验证**：`_test_signal_gate_engine` 92 断言（B5 改写：insufficient_ticks → 放行+不打 failed+metadata anchorTickCount 留痕；原 B5-B7 拒单循环收窄为 timeout/fail 两态）+`_test_buy_point_check_service` 26 断言复验（service 返回形状不变零回归）。**题集零改动**（BP7 版本不动、不 bump）。**余留**：v73 换代生效；生产 insufficient_ticks 放行量与该形状买点结局观测（早鸟票无 BP 判定的实际盈亏=本裁定代价/收益的直接证据）。

### BP8 圣诞树锚三层框架+活跃度门（题集版本 BP7）（2026-11-05，机制案·BP7 续案；三连用户指令+缓议裁定）

**触发背景**：BP7 三类质量题制落地后（commit `3e5e69f2`），用户提出 meme 币价格「圣诞树」生命周期锚——从低点随传播到高点、随传播结束回落死寂、有波折可多树串联、前期狙击手买入后的回调=小圣诞树结束+可能的大圣诞树开始。

**用户指令原话**：①（原始需求）「请帮忙再增加一个锚：meme币的价格变化，类似于圣诞树……我们首先需要判断，价格是否符合圣诞树形状，如果前期呈现的价格形态，是暴涨暴跌，那么这个币背后并非正常用户行为，就不参与交易。否则需要判断当前在价格圣诞树中的位置，树的左侧（待涨），树的顶部（待跌），树的右侧（下跌）。一般来讲，我们交易的位置，需要在树的左侧。或者右侧到了底部，这样可以期待下一个圣诞树。」②（三层框架）「整体逻辑是这样的：1.判断活跃度，活跃度不够不参与交易（所以可以把活跃度作为第一个锚）；2. 判断在圣诞树中的位置，价格历史不是圣诞树或者位置不对不交易（第二个锚）；3.得到其它所有"现象锚"的情况，然后用于判断是三种买入点位的哪一种。」③（unclear 放行）「补充一下，圣诞树形状在前期可能是很难判断的，如果判断不出来，那就可以通过。」④（缓议裁定）「暂时圣诞树这一锚，先不参与决策吧。我觉得判断起来有点太难了，但是可以先放里头。」

**改动一：活跃度门（层①，现行生效）**：mapper 聚合前置代码侧硬门——`market_heat=low → poor`（rule=activity_gate，「活跃度不够不参与交易」=短线进出无流动性承接）；门题答案缺席 null 不拦（拒=有证据的拒绝）；market_heat 反锚④同步改写并删旧矛盾句「热度低也不等于不能买（吸筹段常安静）」。

**改动二：圣诞树形状与位置题 tree_position（六桶，观察档）**：left_side 待涨（含首树早段与回落企稳新树左侧）/top 待跌/right_side 下跌未到底/right_bottom 树脚企稳/not_tree 暴涨暴跌脉冲反复或死水（非正常用户行为形状）/unclear 判不出≠not_tree（前期首树左侧早段本来就没有完整树形可辨——指令③；unclear 与 not_tree 分界=**有无明确反常证据**：脉冲反复/死水有证据→not_tree，树形未成形/材料不足→unclear）。两步判读=先形状后位置；反锚六条（贴高≠自动 top·首树左侧爬坡进行时/右侧未到底≠不再跌·right_bottom 需企稳证据/不作弊结论归 CD/小树回调点两可优先按新传播启动证据定 left_side/unclear-not_tree 分界/摆动行 ? →unclear 诚实不猜）。

**改动三：zigzag 摆动结构锚族（snapshot 纯事实，判形状归 Jev——「代码只组数据」纪律）**：`BP_SWING_THRESHOLD_PCT=20` 阈值化峰谷交替——dir=0 期双向追踪 runMax/runMin（反向幅度先触阈者确认首摆点；两阈同点命中峰确认优先=确定性声明）；进段后涨段找峰（回落 ≥20% 确认）/跌段找谷（反弹 ≥20% 确认）；ext=当前段极值候选（未完成段暂态不冒充树峰）。8 标量锚（swingHighCount/swingLowCount/swingLastDir 1\|-1\|0/secSinceSwingHigh/secSinceSwingLow/currentVsSwingHighPct/currentVsSwingLowPct/swingMaxAmplPct——secSince/currentVs 锚定**最近已确认**摆点）+swingPoints/swingLegs 数组=state 渲染原料不进锚；<2 可靠价全族 null fail-closed；state ②a 摆动结构行（峰谷序列/现处段/段幅度耗时/较峰谷）；service bp 摘要 7 键。初版阈值 20% 待校准。

**改动四：三质量题场景判别挂树佐证**（additive）：早鸟≈首树左侧早段（tree_position=left_side/unclear 佐证——树形未成形正是早鸟窗口）；回调≈上一棵树右侧（right_bottom 树脚企稳/新树 left_side 启动佐证——狙击手脉冲回调=小树结束+可能的大树开始）；追高≈树顶贴高（top 佐证；首树左侧爬坡中的贴高不是追高）。

**裁定：圣诞树门暂不参与决策（指令④）**：实现中途裁定缓议——tree_position=**观察档**：题照问、摆动锚照算、digest 照落攒分布（T74/T76 观察键同构），**mapper 聚合不消费任何 tree 桶**（not_tree/top/right_side 一律不拦、不产出 not_tree/position_gate rule）；判定结构=①活跃度门→②三质量题聚合**两层**（三层框架第②层缓议）。后续启用只改 mapper 聚合+题面门语义措辞（届时 bump 版本）。

**验证**：`_test_buy_point_lib` 236 断言全绿（A 组 zigzag 手算：17 行夹具谷@t+5s/峰@t+110s/lastDir=−1/距峰 105s 距谷 210s/较峰 −20% 较谷 +60%/最大摆幅 100%/段幅度 +100%/105s、−30%/75s；E 组活跃度门+tree 各桶不拦+rule 域圣诞树门值绝迹反证；F 组题面 8 锚句+门语义措辞绝迹反证）；`_test_buy_point_check_service` 26 断言（tree 桩 additive 零影响）；`_test_signal_gate_engine` 91 复验全绿。**余留**：BP7 题面重跑对拍（tree_position 桶分布+摆动锚与前向收益关系=启用圣诞树门的校准素材；烧 Jev 配额先知会）；zigzag 阈值 20% 校准；BP8 案后生产换代待 v73。

### BP7 三类质量题制+动量短窗（题集版本 BP6）（2026-11-05，机制案·BP6 续案；两连用户指令）

**触发背景**：BP5 维度瘦身后（commit `5df736b1`），用户对判定形态再裁定——不再要「类别题路由+综合题」两步制，三类入场形态直接各成一道质量题；随后审视题面发现动量窗口过大。

**用户指令原话**：①「将 early_bird/pullback_entry/high_chase 三者，作为题本身，然后 good/neutral/poor/insufficient 分别用于评估这三者的质量。这三者有任何一个为good则为good，为neutral则为neutral，否则为poor」②「“价格在近 30/60/120 秒的运动方向与速度” 窗口太大了，我们要判断的是近窗口的趋势，5秒，10秒，30秒 差不多」③「看看其它地方有没有这个问题」（窗口口径审查，结论见下）。

**改动一：三类质量题制（题集 7→8 题=5 维度+3 质量）**：

- **类别题 point_category 与综合题 buy_point_assessment 整体删除**——BP3-BP5 两步制（类别题路由→综合题权衡）的对拍痼疾=Jev 常忽略路由指令（BP-T009 判 high_chase(0.66) 却给 good 0.44；BP4 硬路由措辞仍靠 Jev 自觉执行），新形态从根消除路由依赖：三视角**并行独立**评估，聚合归代码。
- **early_bird_quality**：场景=tokenAgeSec 短且未走完一波拉升（贴高首波仍属早鸟——分界非绝对 tokenAge）；忌讳=极快拉高/已拉高（**无条件不因低市值豁免**·位置先于速度）/活跃度太低断流/协同阵列主导；good=温和爬坡+买家多元+热度尚可+绝对价位尚低；非场景或材料薄→insufficient。
- **pullback_entry_quality**：场景=有过明显高点且现价处回落后的位置；忌讳=没跌到位（接飞刀，企稳证据极强时至多 neutral）/奔着归零（阴跌+holdersDelta60 负+买盘枯竭+bigHolderSellBnb60/exitSellerCount60 派发放量）/断流/协同；good=**深回撤后企稳**（急砸非阴跌+买盘回流+holder 稳定/跌底放量）。
- **high_chase_quality**：场景=贴高且已兑现高位非首波；**本轮先等等=场景成立一律 poor（策略停买留痕）**——good/neutral 桶留「（本轮策略停买——放开时改本题面）」占位，与 BP4 硬路由精神同源但由聚合天然保证执行（追高题恒不贡献 good/neutral → 聚合实质=early_bird∨pullback）。
- **聚合（mapper 代码侧确定性）**：`tier('good') 有 → good（prob=该 tier 最大，rule=any_good）→ tier('neutral') 有 → neutral（any_neutral）→ 否则 poor（else_poor；三题全 insufficient → prob=null）`；insufficient 不贡献；good 优先于 high-prob poor（tier 序非概率序，单测锁）；**rule 键=聚合来源留痕非档位结论**（无 verdict/grade 键纪律不破）。
- **assessment 不再有 insufficient**：统计上三题全 insufficient 的薄窗票聚合落 poor（门行为不变——poor/insufficient 都拒）；对拍统计退化为看三题分布+rule 列，run.mjs 判定行改两行制（维度行/质量行）。
- **容错双轨**：质量题=综合判定唯一来源 strict（缺答案/空答案/未知桶 throw fail-loud）；维度题容缺 null 照旧（在场未知桶仍 throw）。
- **消费面**：`BuyPointCheckService.gateBuyPoint` 返回加 `qualities`+assessment.rule（日志行 `质量 早鸟=x/回调=x/追高=x ｜ 综合=bucket(prob,rule)`）；落表 `snapshot_digest.qualities`（**无独立列不加 DDL**，完整概率在 answers_raw）；引擎 `_bpGateEvaluate` info additive `qualities`（signal metadata `buyPoint` 段）；run.mjs results 加 qualities。

**改动二：动量短窗 30/60/120→5/10/30s**：

- snapshot `chgOf` 窗族换 5/10/30（chg5Pct/chg10Pct/chg30Pct，删 chg60Pct/chg120Pct）；短窗内无更早价**自全窗首可靠价起算**（=可得最早价以来动量，state 近窗动量行显式声明该语义——诚实不冒充）；state/mapper 锚/price_trend 题面（「近 5/10/30 秒」+chg5/10/30Pct 引用+波动=chg5/chg10 与 chg30 符号相反）/早鸟题怎么算段同批；速度参照仍 **|chg30| 两位数界**（30s 仍为最长窗）。
- **窗口口径全模块审查（「看看其它地方」结论——以下维持不动，各有结构角色）**：win 流量族 30/60/120（资金/参与结构证据窗非趋势判定，题面消费主 60s 参与结构）；halfTpmEarly/Late 120s 前后半（节奏密度趋势，半窗 60s——缩到 30s 半窗稀疏票会 0/0 无统计意义）；burst5In120（与 CD BURST_NEAR_SEC=120 跨模块同口径）；madeHigh120（secSinceAth 已有精确值，120s 布尔仅佐证）；holdersDelta60/bigHolderSellBnb60/exitSellerCount60（承接/派发证据需累积窗）；[WALLETS] 近 120s 字段（大持仓近端动向）；[PRICE] 全窗 20 桶轨迹（背景形状非近窗趋势载体）。待用户对个别窗再裁定可另案。

**验证**：`_test_buy_point_lib` 197 断言全绿（E 组聚合三臂+strict+键绝迹反证；F 组 8 题/双副本锁/三题忌讳锚/短窗锚；A 组 chg5/10/30 手算 6.67/6.67/14.29）；`_test_buy_point_check_service` 26 断言（8 题桩+qualities/rule 形状）；`_test_signal_gate_engine` 91 断言复验通过。**余留**：BP6 题面 60 点重跑对拍（烧 Jev 配额先知会；三题分布+rule 列+兼作 price_level 分界校准）；批 2-4 逐点复审以新口径继续；v73 换代。

### BP6 维度瘦身+双价格轴（题集版本 BP5）（2026-11-05，机制案·BP5 续案；60 点逐点复审第一批裁定后用户指令）

**触发背景**：BP4 复跑 60 点逐点人工复审进行中（第一批 4 token 已裁定：龙虾AI=cheat 盘全拒正确、暴力雪球两票认同、猫咪天团 BP-L016=最好点位应 good / L017/L018 也可给 good）；用户审视维度表后问「有临近点位的上涨/下跌速度吗？有价格优势吗？都有哪些维度？」，随即裁定维度瘦身。

**用户指令原话**：①「首先我觉得先简化一下这些维度吧，太多了，决策起来更加困难。chip_flow pace_trend buy_pressure_quality删除。然后 price_momentum 改为 price_trend 判定结论改为：快升，慢升，快跌，慢跌，平稳，波动」②「entry_position 改为相对价格高低：接近最高价，浅回调，腰斩，脚脖子斩」③「然后再增加一个绝对价格高低：接近代币发出时价格，偏低，不高不低，偏高，很高」。

**改动（题集 9→7 题=5 维度+1 类别+1 综合）**：

- **删三题**：chip_flow / pace_trend / buy_pressure_quality——已删维度的引用面收敛：综合题总纲中「买压档位」引用改**数值锚**（参与结构行买家数/新买家），holder 流向/节奏趋势事实行保留在 state（卖压/热度原料）不受题删影响。
- **price_trend 六桶**（快升/慢升/快跌/慢跌/平稳/波动）：方向×速度两轴；速度参照 **|chg30| 两位数界**（≥10% 陡峭/垂直=快，个位数缓进=慢——数据层区分度实证：雪梨 chg30=47.8~62% vs AGENTINE 4.8~9.5%，AGENTINE 错失是判读权重问题非数据缺失）；波动=chg30 与 chg60 符号相反或轨迹大起大落；反锚⑤只述事实不判买卖（快升≠该追）。
- **entry_position→相对价格高低四桶**（near_high 接近最高价 / shallow_pullback 浅回调 / half_off 腰斩 / ankle_cut 脚脖子斩）：回撤深度分界 <10%（含贴顶 secSinceAth 秒级）/10~35%/35~70%（中心 -50%）/>70%（只剩零头）——大致参照非硬线以 [PRICE] 轨迹互证；反锚保留 BP2「贴高与市值位置并读」臂+新增「两口径不一致以价格口径（currentVsAthPct）为主」。
- **price_level 绝对价格高低五桶**（near_launch 接近发行价 / low 偏低 / mid 不高不低 / high 偏高 / very_high 很高）：**参照系=发行价**（价格发现起点）非全窗高点；分界 ≤+50%（含破发负值）/+50~200%（1.5~3 倍）/+200~600%（3~7 倍）/+600~2000%（7~21 倍）/>+2000%（21 倍以上）——**初版待校准**（倍数分界占位，60 点重跑后按 currentVsLaunchPct 分布校准）。
- **发行价位置族三锚（snapshot 新增）**：`launchPriceBnb`=全数组首个可靠价（非 outlier∧price>0 链上真序首行）；`launchCovered`=出生段覆盖判据（数组最早 dt ≤ BP_LAUNCH_COVER_TOL=90s，锚窗截窗长票**null fail-closed 截窗不冒充**——生产 DB tail 模式拉数不含出生段→长票该维度容缺设计内）；`currentVsLaunchPct`=(末可靠价/发行价−1)×100 可破发为负。数据来源=ticks 数组自算**不查 DB**（182 token_address 无索引坑+run.mjs 走 set 本地 ticks 文件）。
- **综合题总纲**：BP4 硬路由（追高无条件一律 poor）与无条件忌讳（早鸟不买极快拉高/已拉高、豁免仅限温和爬坡）措辞全保留；「位置先于动能」改写「**位置先于速度**：贴高+快升是接力风险不是入场信号」；并读轴加「**相对/绝对价格双轴**：接近最高价∧绝对价位低=早期爬坡中段；深回撤∧绝对很高=高位派发后的残局」。
- **state-builder**：[PRECOMPUTED] 增①a 发行价位置行（fmtPrice 同 [PRICE] 口径，? = ticks 未覆盖出生段不冒充）；判定指引「综合题五条主权衡轴」（BP2 旧措辞残留）对齐为分类框架措辞（先分类后按类忌讳/位置先于速度/双轴并读）。

**mapper/服务端**：`DIMENSION_IDS` 8→6、桶域常量换新（PRICE_TREND/ENTRY_POSITION/PRICE_LEVEL 三组双副本锁）、anchors 加发行价三键（launchCovered boolean→1/0 数值化——mapper 锚数值域纪律）；`ASSESSMENT_LEVELS` 不动=bpPassLevels 门语义/DDL/引擎零改动；BuyPointCheckService 观测日志行换新维度集；run.mjs 判定行动态序列化（`id.split('_')[0]+':'+bucket`）维度增删零改动。

**单测**：`_test_buy_point_lib.cjs` 187→**197 断言**——A 组发行价三键手算（1e-9/+60.0%/覆盖=true）；C 组截窗反证（首行 dt=200>90s → 全 null fail-closed）；D 组发行价行渲染（+60.0% / 1.00e-9 fmtPrice）；E 组 fullAnswers 七题重写+发行价锚透传（launchCovered→1）+维度数 6 反证；F 组重写（版本 BP5/恰 7 题/旧四题缺席反证/维度序 price_trend…entry/level 落位/PRICE_TREND+PRICE_LEVEL 双副本锁/速度参照+回撤分界+发行价反锚④（? 行不猜）+破发归 near_launch/「位置先于速度」+双轴断言）。`_test_buy_point_check_service.cjs` 桩答案换七题（26 断言照跑全绿）。

**余留**：BP5 题面 60 点重跑对拍（烧 Jev 配额先知会）——产出新判定+`currentVsLaunchPct` 分布（price_level 分界校准素材）+逐点复审批 2 起以新口径继续；price_level 倍数分界校准归档；生产换代（v73 仍 BP2 题面）。

### BP5 题面分类判读框架（题集 BP3）60 点对拍观测 + BP4 执行修正（2026-11-05，机制案·BP4 续案）

**BP3 题面 60 点抽样对拍**（用户裁定抽样档：set=bp-2026-11-05-live3-t6gate，trades 20/t1 10/t2 6/t3 4/t4 4/t5 5/t6 10/t7 1=60 点 27 独立 token，~72 万 tokens）：

- **类别题判读准确**：early_bird=40 / pullback_entry=19 / high_chase=1 / unclear=0——BP-T009（CeBM，age=951s、5min 前创高、贴高 -5.5%）正确落 high_chase(0.66)；回调类内部判别有效（pullback good 末中位 +8.49% vs poor -15.93%）。
- **问题①追高分路未执行**：BP-T009 类别判 high_chase(0.66) 但综合给 good(0.44)——「一律 poor」段落指令被 Jev 忽略。
- **问题②早鸟豁免臂吞掉忌讳**：贴高早鸟点（entry:near_high ∧ early_bird）35 个里 good 15；good 里 +15min 末最差 5 点全为 `price:strong+buy:strong+entry:near_high` 贴高票（雪梨 -44.4%/胖五 -36.5%/龙虾AI -34.6%）——正是用户忌讳「极快速上涨/已拉高」的形状，但 BP2 继承的低市值豁免臂（本批票市值普遍 <8-9 BNB）把忌讳整个豁免掉了；early_bird/good 末中位 **-29.3% 反差于 early_bird/poor -19.4%**（类内分化方向反了）。

**BP4 修正（commit `1f12dd87`）**：①追高类升级**硬路由**——「无条件一律 poor，即使动能/买压/热度全维 strong」+总纲加「分路是硬路由：追高路内维度档位再强也输出 poor」+**good 桶 criteria 显式排除追高类**（桶描述级防线）；②早鸟忌讳无条件化——「不买极快速上涨/已拉高的票（无条件，不因低市值豁免）」+已拉高形状数值锚（currentVsAthPct≈0/secSinceAth 秒级 ∧ chg30 两位数/垂直窜升无回踩）+「位置先于动能」教学（贴高急拉的强买压=接力风险非入场信号）+豁免臂收紧仅限温和爬坡（chg30 个位数/多桶缓升有回踩整理）。

**BP4 复跑（同 60 点）**：good 23→3 / neutral 0 / poor 35→56 / insufficient 2→1；迁移 good→poor=21、poor→good=1。

- **两修正均兑现**：BP-T009 good(0.44)→**poor(0.75)**；新 good 3 点**全部为 pullback_entry+entry:near_low**（回调贴低企稳=框架设计「最该买」形状；L073 +8.49%/L190 +14.36% 结局为正，L007 -25.88%）；pullback 分化保持且更纯（good +8.49% vs poor -15.93%）。
- **错失面（设计内代价，非执行错误）**：old=good ∧ +15min 末>0 被杀 5 点全部=**猫咪天团单票**（0x0b181cce…f5c7777）age 30~96s 的 5 个连续点位——现/ATH -26.1%→0.0% 收敛贴顶+净买 0.8~1.1 BNB，正是「早鸟已拉高」忌讳形状，该票后续走出 +68%~+163%。**忌讳执行正确但错过单票行情**——「避雪梨式贴高深跌」与「错失猫咪天团式强势票」的净效须更大样本裁定（60 点抽 27 token，单票权重过高）。
- **观察点**：neutral=0 两轮均为零——Jev 在四桶上倾向给明确 good/poor；样本扩大后若仍恒零可考虑措辞引导（暂不动，等全量分布）。

**余留**：全量 363 点对拍（跑前知会用户）；「猫咪天团式错失 vs 雪梨式避损」净效大样本裁定；生产换代（v73 仍 BP2 题面在跑——重启吃到 BP4 需换代）；类别分布随 set 扩充观察（high_chase 仅 1 点=本批票中小峰形状为主，追高类样本池待攒）。

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

**余留**：60 点抽样对拍已完成（发现两处分路未执行→题集 BP4 修正，见 BP5 案）；全量 363 点对拍与类别分布观察归 BP5 案余留。

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
