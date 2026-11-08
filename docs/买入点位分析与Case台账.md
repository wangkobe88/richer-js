# 买入点位分析与 Case 台账（BP）

## 分工声明与写作纪律

本台账与《叙事引擎改进与Case台账.md》（C 编号）、《交易策略改进与Case台账.md》（T 编号）、《作弊盘检测与Case台账.md》（CD 编号）并列：**买入点位分析模块**（Jev 驱动的入场时机判定）的机制演进与案史归档。

- **BP 编号全局唯一、永不回收**；新案插 Case 节顶部，编号 = 现有 max + 1
- 每案必带：**token 地址 + 点位锚**（anchorTickCount）、用户裁定原话（如有）、验证数据、对应单测名
- 机制/题集改动 = 新 BP 条目 + 必要时 bump `BUY_POINT_QUESTIONS_VERSION` + 回归收录（测试集 set 重跑）
- 决策过程细节、反复推翻的中间方案可简写；现行机制以代码与本文「机制一屏」为准

## 现行机制一屏（BP1 起，2026-11-03 立项）

**买入点位分析 = Jev 驱动的入场时机判定模块**。动机（用户原话）：「感觉简单指标无法满足要求……通过 ticks 判断当前点位是否可以买入」。与反作弊模块（CD）分工：**输入同样是 ticks（wss_price_ticks 锚截窗），CD 判「盘面是否作弊」，本模块判「当前点位是否适合买入」**——入场时机好坏（时点判定，非 token 终身属性、非盘面性质）；协同/作弊形状在题面里只作降档参考，结论归 CD。

**BP2（2026-11-05）起第二步引擎融合已做（T117 信号源门链）**：新服务 `BuyPointCheckService` + 新表 `buy_point_analyses` + 引擎挂点——携带 `signalGate` 的买腿（初始买入信号源）触发后依次过作弊门（二元版）→ **BP 门**（`buy_point_assessment` 桶 ∈ bpPassLevels（缺省 good/neutral）过/拒），两门都过才买；BP 门 **fail-closed**（超时/Jev 错/disabled 均拒——BP 是点位判定唯一来源无据不买；**insufficient_ticks 唯一例外放行（BP9 2026-11-05 用户裁定「反作弊检测中 bp_gate_insufficient_ticks 请去掉」——极早触发锚窗 tick<minTicks=early_bird 场景常态不判不拦，minTicks 预门保留在 service 不烧 Jev 配额）**），回测恒拒（signalGate 腿全量排除）。详档交易台账 T117 案与下方 BP2 案。**现行判定形态（题集 BP15，案号 BP8 圣诞树+BP10 速度锚+BP11 吉祥低点案回调三层+BP12 ZELDA 活跃度双题+BP14 BEM 筹码门+BP15 谷谷价格豁免锚）=活跃度门+筹码门+三类质量题制**：综合判定=**代码侧三层**——①活跃度门（market_heat=low **或** activity_level=low（BP13 扩双题，CD 七要素判法搬运）→ poor，rule=activity_gate，「活跃度不够不参与交易」）；①b **筹码门（BP14 BEM Miner 案——用户裁定「全部搬过来直接用于判定」）**：famous_domination=dominant（famous+跟单正净持仓 ≥50 控盘主导）**或** holder_concentration=strong（CD240 分层线：≥10 持有者单一 >45%/前二 >55%/前三 >70% 过线坐实；≤5 豁免域但 top1>90%+参与/持有分叉极端=一人控盘；**BP15 价格豁免锚：currentVsLaunchPct ≤ +50%（含破发）贴发行价时持有不均衡不坐实 strong——「极早期有大户在场没有问题」，头部持仓无可兑现浮盈，只豁 holder 轴不豁 famous 轴**）→ poor（rule=chip_gate，「famous 掌控的盘子/筹码垄断的盘子不参与」；heavy/moderate 观察不拦防误伤；活跃度门先裁 rule 留痕首命中门）；②三类质量题聚合（early_bird_quality / pullback_entry_quality / high_chase_quality，桶域 good/neutral/poor/insufficient，Jev 三视角**并行独立评估**，每题先判场景适用非场景→insufficient 不贡献；用户原话「这三者有任何一个为 good 则为 good，为 neutral 则为 neutral，否则为 poor」：任一 good→good，否则任一 neutral→neutral，否则 poor；三题全 insufficient→poor 且 prob=null）——替代 BP3-BP5「类别题路由+综合题」两步制（对拍实证 Jev 常忽略路由指令，形态从根消除路由依赖）；维度题（8 题）中六题纯参考不进聚合（两筹码题门桶由 mapper 硬消费）；追高题=策略停买留痕（场景成立一律 poor，放开只改该题面）。**早鸟/回调忌讳现行口径（BP10 判序+BP11 回调三层）=maxChg5Pct 回看速度锚+判序**：早鸟①=第一分支价格低救（maxChg5 过线∧near_launch→命中即停 neutral）→第二分支暴涨忌讳（过线∧low+→poor）；回调题=**内部三层结构（BP12 终稿）**：第一层·场景判别（有过明显高点+现价处回落后位置，非此→insufficient）→第二层·**核心规则（先于一切忌讳，命中即定档 neutral 不再评估第三层）：价格跌到很低（near_launch ≤+50% ∧ 非深崩 near_high/shallow_pullback——half_off/ankle_cut 跌过头走第三层）+ 活跃度没有丧失（heat≠low）→中等**（依据三句：脉冲已被消化/奔零叙事对贴发行价票不成立/跌到位要求只对 low+ 票适用；**证据闭包=卖压/holder 流向不否决本规则**——用户裁定「我当前设计的体系中，没有这两个指标」）→第三层·忌讳五行清单（①崩塌第一腿 maxChg5 过线②没跌到位③奔零④断流⑤协同）只服务 low+/深崩票。**maxChg5 过线+near_launch+浅回调形状（S021/S071）十轮题面迭代 Jev 稳定倾向 poor=终裁「先接受现状」留档（设计内代价，BP11 案）**。8 维度现行（题集 BP9 起 sell_pressure 整题删除——用户裁定「我当前设计的体系中，没有这两个指标」；BP13 增 activity_level；BP14 增两筹码题）：price_trend 六桶（动量窗 **5/10/30s 短窗**——BP6 用户裁定）｜ market_heat ｜ activity_level 四档（BP13——CD 七要素判法搬运，买点前全窗口径+临近买点段倾向，**门桶 low 进活跃度门**）｜ **famous_domination 四桶（BP14——CD D3.2 三档切点 50/25+G17 联立加重臂；门桶 dominant 进筹码门）**｜ **holder_concentration 四桶（BP14——CD240 分层线直译+一人控盘例外+参与/持有分叉；门桶 strong 进筹码门）**｜ entry_position 相对价格高低四桶 ｜ price_level 绝对价格高低五桶·参照系=发行价 ｜ **tree_position 圣诞树形状与位置六桶=观察档（BP8——用户裁定「暂时圣诞树这一锚，先不参与决策吧。我觉得判断起来有点太难了，但是可以先放里头」：题照问、zigzag 摆动锚照算、digest 照落攒分布，mapper 不消费任何 tree 桶；后续启用只改 mapper 聚合+题面措辞届时 bump）**。

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
| BP9 | 2026-11-05 | **sell_pressure 维度题整题删除+⓪升裁定级（案号 BP11 吉祥低点案一改）**：维度题 9→8（5 维度+3 质量）——用户裁定原话「现在系统没有让评估 sell_pressure high + holders−3 流失这几个指标」「我当前设计的体系中，没有这两个指标」；回调忌讳段前置⓪价格低优先救升**裁定级**（near_launch∧早鸟窗∧浅回调→命中即停 neutral）；维度题容缺机制天然忽略旧存档答案（runner 重放兼容零改动）；卖压痕迹仅存忌讳③数值锚（bigHolderSellBnb60/exitSellerCount60）；mapper DIMENSION_IDS/桶域/导出、service 日志行、单测桩同批（commit 48d0e835） | 定向双票 S021 poor 0.92 / S071 poor 0.96（未翻）；单测 248+26（E 组五维度反证） |
| BP10 | 2026-11-05 | **①忌讳内部开 near_launch 例外（案号 BP11 二改）**：回调忌讳①崩塌第一腿加「maxChg5 过线但 price_level=near_launch→至多 neutral」内部例外——⓪救 vs ①拒同域冲突源从根消除（commit bdfc7550） | S021 poor 0.68 / S071 poor 0.61（忌讳教学 0.9→0.6 松动，仍未翻 neutral） |
| BP11 | 2026-11-05 | **⓪升场景层前置分流+②加 low+ 排除句（案号 BP11 三改）**：回调题前置场景判别（⓪命中的浅回调贴低分流出去非回调场景）；②没跌到位限定 low+ 票（commit 40aaee2a；⚠带病提交：单测 FAIL 被 `&&` 链中 `tail` 吞 exit code——`node …|tail` 的退出码是 tail 的，教训留档） | S021 翻 neutral 0.61 / S071 poor 0.50（S021 疑 run-to-run 噪声抽中） |
| BP12 | 2026-11-05 | **回调题三层结构重写终稿（案号 BP11 四改，用户确认版）+接受现状收口**：第一层场景判别（有高点+回落；圣诞树 right_bottom/left_side 佐证）→第二层核心规则置顶直译用户裁定「**价格跌到很低+活跃度没有丧失→中等**」（near_launch∧非深崩 ∧ heat≠low；依据三句+证据闭包卖压/holder 不否决）→第三层忌讳五行清单只服务 low+/深崩票；**终裁「先接受现状，然后下一个，不搞代码门」**：十轮迭代 9 poor 1 neutral，maxChg5 过线+near_launch+浅回调形状 Jev 稳定倾向 poor=设计内代价留档（commit 8b575324） | S021 poor 0.71 / S071 poor 0.69（双票退回 poor=终裁接受）；单测 248→252（F 组三层结构七组锚句）+26 |
| BP13 | 2026-11-05 | **CD activity_level 七要素判法搬运+活跃度门扩双题（案号 BP12——ZELDA 误放案）**：新维度题 **activity_level 四档**（low/mid/high/ultra，CD 同名同词表——判法全文 BP 语境化：①无交易期占比（≥20s 静默段，idlePct）②笔密度③买盘中位为主笔均为辅（尘埃假活跃判读）④双向性+开盘极早窗反锚（<60s ∧ <30 笔两腿同时）⑤金额吞吐（<1 BNB/min 死寂，≥10 配高档）⑥停滞突发反锚（静默后买入涌入中档起判）⑦**临近买点段（锚窗末端 30s=买点前最后 30 秒，开盘段密集不救临近死寂）+全窗量级综合锚 D3.61 四腿联立**；题头声明判读倾向临近买点段=用户裁定原话「活跃度检测要倾向于检测买入点位之前的」；与 market_heat（近 30/60s 密度视角）分工并读，**原 market_heat 题保留不删**）；**活跃度门扩双题：market_heat low OR activity_level low → poor**（rule=activity_gate 不变，prob=触发臂最大；BP12 旧档无 activity_level 答案=该臂失效容缺、market_heat 臂照常=存档重放兼容）；snapshot 零改动——buyDerived 新增 activity 嵌套 13 键（cheatDerived 同名单点照抄不重算：spanSec/tickCount/idlePct/buyMedianBnb/throughputBnbPerMin/maxDrawdownPct/临近段七键）；state 活跃度数值行扩容（中位/吞吐/静默占比/回撤/窗口两原料）+新增「临近买点段(最后30秒)」行；mapper anchors 增 act 前缀 13 观察键 | 单测 `_test_buy_point_lib` 252→**282 断言**（E 组门双臂/双 low 取 max/旧档容缺/优先质量题+act 锚透传；D 组两新行；C 组 activity 同源+恰 13 键；F 组 BP13 九题=6 维度+3 质量/七要素段在场/分工句/门消费声明）+`_test_buy_point_check_service` 26 零影响+CD 三件零影响；ZELDA 单点对拍=见 BP12 案 |
| BP14 | 2026-11-06 | **筹码门立法：CD 筹码结构判法全族搬运直接进判定（案号 BP14——BEM Miner 案；题集版本与案号自 BP14 起重新对齐）**：新维度题两道 **famous_domination 四桶**（none/light/heavy/dominant——CD D3.2 三档切点 50/25+G17 D 通道联立加重臂：跟单集中度 ≥45 或集团买入 ≥80 任一从重往 dominant 靠；反锚①**买过 ≠ 持有**一律正净持仓口径）+ **holder_concentration 四桶**（none/weak/moderate/strong——CD240 案分层线直译：持有者 ≥10 单一 >45%/前二 >55%/前三 >70% 任一过线=垄断坐实 strong、6~9 过线+簇持仓佐证 strong、≤5 筹码少豁免域至多 moderate 但 **top1 >90%+参与/持有分叉极端=一人控盘可 strong**；反锚①极早窗筹码集中=价格发现常态从宽）；**筹码门：dominant ∨ strong → poor**（rule=chip_gate，门序=活跃度门后/质量题聚合前；**heavy/moderate 观察档不拦防误伤豁免域**；两题答案缺席容缺=BP13 旧档重放零影响）；buyDerived 新增 chip 嵌套 10 键（famous 三键+分层三键 top1HoldCircPct 自 holdingsProfile[0] 派生+簇持仓两键+**buyersTotal=BP 侧新增计数**（snapshot.wallets 中 buyN>0，路由伪钱包天然不计）——其余 cheatDerived 同名零重算）；state 新增「筹码结构」行（famous 控盘/分层三键/参与持有分叉/簇持仓，? = 缺证据如实判缺）+判定指引改三层（①活跃度门②筹码门③三质量题）；题集 11 题=8 维度+3 质量；mapper anchors 增 chip 前缀 10 键 | 单测 `_test_buy_point_lib` 282→**318 断言**（E 组筹码门六分支：dominant/strong→poor·chip_gate、双臂取 max、优先质量题、**活跃度门先裁**（rule=activity_gate）、heavy/moderate 不拦、两题缺席容缺、在场未知桶 throw；chip 锚手算 A fixture Σ正净 2596M top1=55.08%+BEM 形状透传；D 组筹码行渲染+三层指引；F 组 11 题/桶域对锁/两题反锚与门消费声明）；**182 验收=BEM 5 点全 poor chip_gate**（L057-060+T018，famous 全 dominant；L057 早鸟仅 neutral 0.65=单靠质量题会放行、筹码门拦住的点；5 点前向 -34%~-38% 全拦对）+**吉祥 4 反例零误伤**（L034/T011/L046/T016 famous 全 none/light 无一 chip_gate 拒，L034 neutral 放行与 BPA-024 裁定一致） |
| BP15 | 2026-11-06 | **holder_concentration 反锚⑥价格豁免锚（案号 BP15——谷谷 T020 复审案）**：价格临近发行价（currentVsLaunchPct ≤ +50% 含破发=price_level 的 near_launch 档）时**持有不均衡不坐实 strong**（降为观察至多 moderate）——用户裁定原话「极早期有大户在场没有问题，价格临近发布价豁免持有者不均衡」：贴发行价=头部持仓**没有可兑现的浮盈**（这个位置砸不出暴利），与早鸟题「价格低救」臂同一哲学=**位置先于集中度**；价格已脱离发行价区间（>+50%）分层线照常适用；**只豁 holder 轴不豁 famous 轴**（famous 集团控盘是组织行为问题，不因价格低而豁免——BEM 验收零翻案防线）；形状样本加谷谷正例（6~9 过线+同块簇佐证但 +25% 贴发行价→豁免落观察档）。附带核查留档：posHolderCount 含尘埃（T020 锚 9=8 实质+1 尘埃 0.001 BNB，剔除后仍 6~9 区间不改变分层——**dust 计数不决定性，暂不加剔尘键**） | 单测 `_test_buy_point_lib` 318→**321 断言**（F 组豁免锚三断言：反锚⑥在场/只豁 holder 不豁 famous/谷谷正例样本）；**182 定向三面验证**：谷谷 T020 **poor 0.91 chip_gate→neutral 0.77 any_neutral**（holder strong→moderate 豁免生效、早鸟 neutral 聚合放行）；**BEM 5 点零翻案**（L057-060+T018 全仍 poor chip_gate——L057 holder 亦豁免落 moderate 但 famous dominant 独拦=「不豁 famous」防线实证）；**吉祥反例不翻**（L034 neutral 0.49 保持/T011/T016/L046 poor 保持） |
| BP16 | 2026-11-06 | **回调题「大户未清场」立法初版·三源判据（案号 BP16 第一改——Lily T049 案，用户裁定原话「给 Poor，买入的时候，完全没有大户在了，就只剩下几个小散户，这种情况不要抄（改一下 prompt 吧）」）**：核心规则第二条件「活跃度没有丧失」由 market_heat≠low 单条件扩为**热度∧大户双条件**，大户在场=清仓式卖出钱包数少+全窗 top5 大持仓近 60s 卖出不放量+持仓前三仍占实质流通份额（state 现成三源零新增计算）；大户清场=活跃度实质丧失→核心规则不命中走忌讳；缺证 fail-open（? 行不以清场否决，判缺不猜） | 182 定向 8 点对拍**翻车**：翻案组仅 1/6（T035-S3）、**正例 T041 误伤**（neutral 0.54→poor 0.65）——占比/清仓数与用户「大户」语义错位（Lily 前三占流通 89.2% 但绝对买入全 0.05~0.075 尘级；T041 清仓式卖出 6 个仍 good）=判据修正触发，见 BP17 行与 BP16 案 |
| BP17 | 2026-11-06 | **大户判据修正·绝对买入金额两臂（案号 BP16 第二改）**：大户判据从占比三源换成「全窗持仓前三」**绝对买入金额**（盘子小时小散买 0.05 也占前三，占比高≠大户）；大户清场两臂任一成立=活跃度实质丧失——①**规模臂**：持仓前列买入全是小散尘级（最大也就 0.1~0.2 BNB 级，第一大占比再高也只是小散互捅）②**撤退臂**：在场大户正离场（top5 近 60s 卖出合计已占前列持仓者买入额的大半，过半即撤退信号）；「清仓式卖出钱包」数降级快进快出噪音不作清场主判据（剥头皮清仓常态化——T041 清仓 6 个仍 good 反证）；缺证 fail-open 不变 | 单测 321→**325 断言**（F 组两臂/绝对金额锚/噪音降级锚三断言组）；**182 定向 8 点对拍收口**：翻案 4（T040 poor 0.58/T049 poor 0.48 立法启动案/T035-S3 回调 poor 0.50/T045 综合 activity_gate poor）+贴线未翻 2（T046/T047 neutral，poor 概率 0.37~0.45 两次未过线）+误伤 1（T041 poor 0.66 坚决——WALLETS 前列 73% 快进快出 vs 第 1 大 0.412 锁仓=两可形状）+零翻动 1（T036 与 BP15 同 poor）；净效果=正确翻 4 vs 误伤 1（BP11「接受现状」先例收口），余留攒批见 BP16 案 |
| BP18 | 2026-11-06 | **盘面分类锚·五类型学（案号 BP18——53 点复审收官立法案；用户裁定五类型原话直译）**：新第 9 维度题 **market_pattern 五桶**——①strong_backer 强庄盘（开盘大额进+未拉爆+盘面仍活，**最好的类型**不拦）②retail_pvp 散户 PVP 盘（全场无任何真金大额，**不要参与**）③famous_monopoly famous 独食盘（占比大且绝对额大拿了太多筹码，**不要参与**）④early_sniper_decay 狙击衰竭盘（购买力完全集中最早数 slot 随之衰竭，**不要参与**）⑤blended_unremarkable 融合盘（无明显特征，**好点位可以赌一赌**中性不拦）；反锚三界（①④分界=同为开盘大额**后段死活定类**、②⑤分界=**全场无任何真金大额**才落②、③门槛=famous 占比∧绝对额双大）+材料不足按⑤不硬归类；**盘型门 pattern_gate：②③④→poor**（rule 六值=activity_gate/chip_gate/pattern_gate/any_good/any_neutral/else_poor；门序活跃度→筹码→盘型→质量题聚合；门题缺席 null 容缺=旧档重放兼容）；snapshot 新增**开盘段结构锚族 openSeg 七键**（首 30s 买入额/笔数/占比/大额单(≥0.3 BNB 与 BP16 大户线同线)笔数额+开盘段后买入额/密度——①④直接判据；截窗未覆盖开盘段全族 null 不冒充；窗口 ≤30s late 族 null 开盘段内锚照出）；state 新增开盘段结构数值行+判定指引②c；题集 12 题=9 维度+3 质量 | 单测 325→**352 断言**（E 组门①c 断言组：三拒买桶→poor·pattern_gate/①⑤不拦/优先质量题/门序 activity·chip 先裁/旧档容缺/未知桶 throw；A 组 openSeg 手算+短窗/截窗 fixture；F 组 MARKET_PATTERN_LEVELS 对锁+五桶原话句+反锚三界+门桶声明）；**182 全量 53 点重抛（用户放行）**：盘型分布 blended 27/retail_pvp 12/strong_backer 8/sniper 4/monopoly 2，桶分布 poor 34→43/neutral 19→10，翻动 15 票=**盘型门新拦 8 票**（币股人生×2/ZELDA/긴와/KIBI/谷谷/阿里美股/突突车 neutral→poor·pattern_gate）+Jev 方差摆动 7 票（详见 BP18 案：T045/T049 立法票未复现属 run-to-run 边际摆动）；commit 6706e1f |
| BP19 | 2026-11-06 | **②⑤边界修正·多笔 0.2 级双臂（案号 BP19 第一改——突突车 T052 复核案；用户裁定原话「突突车，我不认同啊，买入点位之前有 3 个 0.2 BNB 左右的买入呢。其它都没问题」）**：BP18 盘型门拦 8 票人工复核（7 页 token-ticks 叠画），T052 不认同→经数据确认裁定②「无大户参与」边界从「单笔 0.3+」扩为**双臂：多笔 0.2 BNB 级左右（≥2~3 笔）或单笔 0.3+ 在场均算有参与不落②**；全场买单全在 0.1 级及以下尘埃档才落②；「其它都没问题」=其余 7 票盘型拒全认同（BPA-061 긴와 expect neutral→poor 改判落锚） | 题面三处（②描述句「没有任何像样的买单」/②⑤反锚句/criteria）+版本 bump+单测 F 段同步（352 断言）；**182 定向重抛 7 票**：T052(0.224/0.198/0.247)/T017 KIBI(0.247×2/0.238)/T013 ZELDA(0.246/0.217/0.298)/T025 阿里美股(0.198×2) 翻出②→blended·neutral ✓、谷谷 T022(0.157/0.148/0.099 零笔 0.2 级) 维持 retail_pvp·poor ✓——**但 T006/T008 币股人生（各仅一笔 0.200）也被判 blended 翻出②**（复验稳定非方差）=Jev 宽松执行「单笔 0.2」当多笔，与裁定相悖→触发第二改 BP20；commit fbe12803 |
| BP20 | 2026-11-06 | **②「多笔」硬笔数边界（案号 BP19 第二改，先例 BP16/BP17 同案两版本）**：BP19 重抛暴露 Jev 把「恰好一笔 0.2 级」当有参与（T006=0.200+0.136/0.120、T008=0.200+0.148/0.099 判 blended 稳定复现）→ 题面加**硬笔数句：「多笔」=买入额到 0.2 BNB 级（≥0.19 BNB 视同 0.2 级左右）的钱包 ≥2 个，仅一笔 0.2 级+其余全 0.1 级及以下=凑不成多笔仍落②**（单笔 0.2 不构成大户参与）；0.19 线设计对拍 8 票全复现裁定（T025 两笔 0.198 过线不误伤） | 单测 352→**353 断言**（F 组硬笔数锚断言）；**182 定向重抛 7 票 7/7 全对齐**：T006 retail_pvp(0.62)/T008 retail_pvp(0.76)/T022 retail_pvp(0.57)→poor·pattern_gate ✓、T052 blended(0.90)/T017 blended(0.93)/T013 blended(0.86)/T025 blended(0.82)→neutral ✓；**门方向与结局 7/7 一致**（翻出②四票 T052 +5min 峰 +448.7%/T017 +15min +24.6% 有肉、维持②三票 T006/T008/T022 末段全 −19%~-24% 全跌）；commit ca7b0bbd |
| BP21 | 2026-11-06 | **①②分界补「大户卖出后的承接结构」轴（案号 BP21——53 点复审第 1 批两案：정책콕 T001/SB T003；用户裁定原话「정책콕 不是庄盘，大户卖出后，承接大户卖量的，是一堆很小的散户，最终这个是 pvp 盘」「SB 是庄盘，开盘明显大户，且大户卖出有承接」）**：①「此后盘面仍有交易」收紧为「**大户卖出后有像样的承接**（0.2~0.3+ 级像样买盘接走=对倒换手流动性在场）」+「价格未被拉爆」降为典型形状**不再排除①**（拉高对倒也是庄行为，定类看承接不看价格高度=SB 案）；②扩第二形状 **(b) 大户卖出、散户承接**（开盘段大额单 >0 不自动排除②：大户向小散出货、接盘全 0.0x~0.1 零散单=盘面散户化仍②=정책콕 案）；反锚新增①②分界轴「**大户卖出后谁在接**」+「多笔不落②」补前提=**像样买方买点时刻仍在场**（已卖离场接盘全小散走②(b)）；「怎么算」补卖压行（近 60s 卖出额/清仓式钱包）作承接对照源 | 题面四处+版本 bump+单测 353→**354 断言**；**182 定向重抛 17 票**（两裁定票+①桶全部+②桶全部防误翻）：**两裁定全达成**（T001 strong_backer→retail_pvp·pattern_gate 拒 5min 末 −20.6% 方向对；T003 blended→strong_backer·综合仍 else_poor 0.92=①不拦点位归质量题、5min 末 −50.1% 质量题拒对）；**外溢 8 票全部正当翻**：T045/T046/T047/T049 ①→②=**BP16 大户清场校准组被 (b) 形状正当收编**（T045 第 1 大买 1.300 卖 1.247/T047 近 60s 卖 1.036 清仓 7 个，承接买盘中位 0.049~0.075；其中 T045/T046/T049 综合 neutral→poor·pattern_gate **收紧 +3**、5min 末 −31%~−33%/−4.7% 方向对）；T010/T019/T023/T027 ②→⑤=**硬笔数规则一致化**（前列多笔 0.2 级本就不落②——T010: 0.200+0.198、T019/T023: 0.247×2+0.238、T027: 0.230/0.209/0.219；BP20 判②是漏网非裁定，综合桶四票零变化全 activity_gate/else_poor 同拒）；T005 HAUL ①→⑤=**实现缺陷**（大户零卖出被承接句卡死）→触发第二改 BP22；commit 114a7311 |
| BP22 | 2026-11-06 | **①零卖出满足路径（案号 BP21 第二改，先例 BP16/BP17、BP19/BP20 同案两版本）**：BP21 重抛暴露 HAUL T005 第 1 大买 0.350@t+0 零卖出持有 39.6%（卖压行 0.0000×0、top5 近 60s 卖出 0.0000）被「大户卖出后有像样的承接」卡住**无证据可评翻⑤** → 补满足路径：**大户尚未卖出（卖压行近 60s 卖出 0、持仓前列只买未卖）=强庄仍在场持有，承接条件直接满足**——卖出承接只在大户已卖出时才须评，大户零卖出而盘面仍活的照常落① | 单测 354 断言（F 组①断言扩零卖出两句）；**182 复验 4 票 4/4**：T005 blended→**strong_backer** ✓（综合桶不变 activity_gate 0.89 拦=BP20 同款）、T016 ①稳/T045 ②(b) 稳（pattern_gate 复拦 0.65）✓、T051 综合回 poor·else_poor 0.82=**BP21 轮 neutral 确认为早鸟题方差尖峰**（pattern 两轮都稳 strong_backer、eb 桶 insufficient(0.35)↔neutral(0.34) 刀口摆动）；commit ced3e256 |
| BP23 | 2026-11-06 | **两轴立法（案号 BP23=159 点 signals 集复审第 2-3 批）**：①回调题庄盘豁免（开盘段大额单 ≥1 ∧ 持仓前列大买家未清场=庄盘语境——忌讳①②不适用+核心规则「价格跌到很低」同步放宽「庄盘加仓范围比普通盘宽，稍微高一点也可以」；只解除①②不解除③④⑤；判据用 state 材料不引用盘型题答案）②盘型题②(b) 收窄（落②(b) 须「一眼可辨的大量小散单」两要件：中位尘埃级 0.0x+前列再无像样买方；大户在场∧承接 0.1~0.2 常见交易档=至少⑤）；轴①三案票 SB S005/吉祥A S016/吉祥B S021、轴②吉祥B S018（BPA-063~065 先行落锚） | 单测 353→360；**182 定向 8 点：翻案 4/4（S005 0.49/S016 0.58/S018 0.78 盘型翻 blended/S021 0.48）+反例 4/4 零翻动**（S023/S026/S027/S030）；S023 盘型 retail_pvp→blended=收窄外溢留档；commit 1b959862 |
| BP24 | 2026-11-06 | **盘型题②(b) 大户离场后持续承接臂立项（案号 BP24 第一改——159 点复审第 4 批 VirusSI 案；用户裁定原话「大户离场后，持续有承接，盘面较强，可以给判为混合盘。这个币部分点位判为 PVP 有点不合适」）**：大户（开盘段大额进场者）已卖出离场但此后承接持续+盘面较强 → ⑤融合盘不落②；②(b) 针对=承接断绝/盘面转死的散户化出货 | 单测 360→362；**182 对拍暴露反例冲突**：S039 翻 blended ✓ 但 **T001 정책콕（BP21 立法案票）被误翻 blended(0.33)**——其锚窗材料（d60=+8/新买家 10/11/买卖比 20:1/贴发行价）完全符合初版判据，BP21/BP24 两裁定正面冲突→用户消解裁定触发 BP25；commit a6e7af9a |
| BP25 | 2026-11-06 | **持续承接臂判据改卖压消化过程性（案号 BP24 第二改——用户消解裁定原话「如果大户离场后，一波散户接了没下文了，我倾向认为是 PVP，如果大户持续卖，持有有接盘者，无论是散户还是什么，我倾向于混合盘」）**：大户卖出仍在进行（近 60s 大户卖出额 >0）∧ 承接持续（身份不限）→ ⑤；大户已卖完离场+散户一波接没下文 → ②(b)；实证锚完美自洽：VirusSI P2/P3/P4 bigSell60=0.48/0.83/1.00（持续卖）vs T001 bigSell60=0+exitSellers=3（卖完） | 单测 362；**182 对拍**：**S038 翻 blended+neutral 0.72 ✓**（VirusSI P2 错杀 +204% 翻案）、S039 维持 ✓、**T001 仍 blended(0.41) 未回②**——触发时散户承接正处高潮 Jev 被「承接活跃」带走，「一波接没下文」为前向结局（1min max +5.77% 后 −20%）锚窗内不可见→判序问题触发 BP26；commit dfec9334 |
| BP26 | 2026-11-06 | **卖方在场性优先三分（案号 BP24 第三改）**：判序改卖方状态三分——①卖压行 >0 持续卖+承接持续 → ⑤（持续卖压=盘面活跃引擎，双边在场=流动性真实）；②卖压归零 ∧ 清仓式卖出成批/前列走空+承接只剩散户 → ②(b)（**「一波接没下文」是必然结局判结构、不判承接当下活跃度**）；③卖压归零但前列大买家在场持有未卖 → 走 BP23 在场承接路径不落②（中间档原路径保护） | 单测 362（版本+三分立法锁定）；**182 定向 5 点终版对拍**：S037 零影响 ✓/S038 blended(0.54)+neutral(0.71) ✓/S039 blended(0.74) 盘型翻案+筹码门独立拒 ✓/S018 中间档反例 blended(0.81)+neutral 稳定 ✓/**T001 仍 blended(0.48) 收口=锚窗信息 vs 后见裁定合理分歧**（锚窗内 top1 持流通 50.4% 巨鲸在场+承接高潮，②(b) 要件均不成立；防线=筹码门 top1 50.4% strong·chip_gate 拒；BPA-066/067 落锚）；commit f97fa891 |
| BP27 | 2026-11-06 | **price_level low 档收窄+庄盘豁免一档帽（案号 BP25——S043 高点接盘案；159 点复审第 5 批、按代币分组审工作流首案）**：①low 档收窄 **+50~200%→+50~100%**（mid 相应 +100~600%）——原 low 装进了最低价近三倍的票；②**庄盘豁免只放宽一个档位**：核心规则「价格跌到很低」从 near_launch 放宽到 low 档为止，**+100% 以上（mid 及以上）不在豁免范围**（庄盘也不追二倍以上的位置——坑要够深，高位浅回调对庄盘同样没跌到位）；③忌讳②补句 **price_level=mid 及以上（>+100%）的浅回调一律没跌到位**（+100% 以上不开口：高位浅回调没有可参与路径，庄盘豁免也不覆盖）；反锚④新增较发行价 >+100%=已明显脱离发行价区不构成「价格低」证据 | 单测 362→**366 断言**（low 档收窄句/反锚④不开口句/一档帽句/忌讳② mid+ 一律句）；**182 定向 5 点对拍**：**S043 翻案达成** neutral(0.69,any_neutral)→**poor(0.71,else_poor)**（回调题 poor 0.71——+155% 落 mid、豁免不适用、忌讳②拒；前向 15min 末 −31.07% 高点接盘）✓、反例零翻动 S018 neutral(0.75)/S040 neutral(0.57)（均 near_launch 豁免路径内）/S044 neutral(0.51)（+78% 落新 low 档内不受收窄影响）✓；S038 桶级翻动=Jev 方差非 BP27 语义（holder moderate(0.5)→strong 跨筹码门线，BP27 未动 holder 题/筹码门；同票 S039 基线本就 strong·chip_gate 拦=贴线票）留档；commit 9501dc75 |
| BP28 | 2026-11-06 | **盘型题大户参与判序前置（案号 BP26——S045 谷谷② 灰区单误判案；用户裁定原话「大户参与不满足是直接 pvp 盘的，满足之后根据承接再次分类」）**：②(a) 从自由裁量改硬判序——**先判「大户参与」（BP20 硬笔数双臂：0.2 级（≥0.19 视同）钱包 ≥2 个或单笔 0.3+ 且买点时刻在场）**；不满足（前列最大 0.1x 级灰区单/尘埃档）→ **直接落②，不再看承接、不看盘面活跃度**（0.1~0.19 灰区单不构成大户参与；小散互捅的盘面再活跃也只是散户 PVP 不是融合盘）；满足后才按承接分类（BP21/BP22/BP23/BP26 承接轴全保留）。反锚②⑤分界句（「全场无任何像样买单才落②」自由裁量句）与 criteria retail_pvp 同步判序化 | 单测 366→**371 断言**（判序前置声明/双臂+直接落②/活跃度不救+承接后置/反锚判序化/criteria 同步；BP19 双臂语义断言迁移）；**182 定向 5 点对拍**：**S045 翻案达成** blended(0.85)→**retail_pvp**、综合 neutral(0.72)→**poor(0.81,pattern_gate)**（前向 1min 峰 +0.03 后一路阴跌 −19% 零反弹=②裁定实证）✓、反例零翻动 S044 strong_backer（48 行开盘大额票大户参与满足）/S018 blended/S038 blended（综合 chip_gate=BP27 已留档贴线筹码方差）✓；**S048 复核反转非翻案目标**：锚窗 0.19848/0.19760 两笔均 ≥0.19=0.2 级钱包恰 2 个→大户参与满足（贴线满足）→走承接分类→卖 0=大户零卖出→①strong_backer 为判序正确执行（前会话误归类灰区，0.3+ 大额 0 笔但双臂之一凑成）；commit 41ae286c |
| BP29 | 2026-11-06 | **①庄时序锚：最早的买入（至少次早）得有大户（案号 BP27——S048 阿里美股 散户接力盘误判①案；用户裁定原话「S048 也不是庄盘，如果你是庄，肯定一开盘最早期买入大额，然后对倒分仓，它是一开始先小散户，然后有稍微大一点的散户接了罢了」+措辞更正「应该是最早的买入（至少是次早）得有大户」）**：S048 出生段 36 行 0.3+ 大额 0 笔——最早的买入（开局第一秒 5 笔）全 0.03~0.14 小散铺垫、13 秒后 0.1985/0.1976 两笔贴线单接力，BP28 判序下双臂满足走承接分类、卖 0=零卖出被读作「强庄在场」判①=把 0.198 当「大额」的违规宽松执行。①补庄时序锚三处：**大额=单笔 0.3+（与 openSeg 大额线同线，0.19~0.2 贴线单是「稍微大一点的散户」不是大额）∧ 最早的买入（至少次早）得有大户（庄最早/次早就大额进场随后对倒分仓）∧ 反锚：最早的买入全小散铺垫+之后 0.2 级贴线单接力=散户接力盘不是庄建仓不走①（双臂满足按承接分类至多⑤）**；criteria strong_backer 同步 | 单测 371→**374 断言**（①时序锚三句/反锚时序/criteria 同步）；**182 定向 4 点对拍**：**S048 翻案达成** strong_backer→**blended_unremarkable**（综合 neutral(0.72) 维持=BP20 T025 0.198×2=blended 先例路径）✓、真庄反例零翻动 S044 strong_backer（谷谷本尊 48 行开盘大额）/S005 strong_backer（SB 三大户 1.000/0.772/0.303 开盘进场=BP21 ①立法票）/S016 blended 维持 ✓；commit 3a1ec72e |
| BP30 | 2026-11-06 | **第 4 组 16 点复审三裁定一案三改（案号 BP28——159 点复审第 4 组：太空逆袭 0x0cd4cee3×5/无税人生 0xfba95a4e×5/FIGHT 0x490da05a×2/谷谷本尊/桃豆世界/持械入宋/:-) 散点）**：**改一（activity ⑥反锚三段形状句，S053 太空逆袭案）**用户裁定原话「cheat 检测中有burst检测，豁免低活跃度，可以搬过来。S053 是中等」——S053 三段形状（开局 7s 冲 7 笔→中段 24s 完全静默无交易期占比 54.5%→锚前 2s 内 8 笔 0.928 BNB 同块集中涌入含三笔 0.2 级）activity=low 拦（1min 后 +55.6%），BP13 已搬⑥反锚但「先冲一波后长时间静默不保护」句被 Jev 读成三段不保护→补三段形状归属句：静默之后、买点之前有集中买入涌入=「静默后买入涌入」中档起判，判读锚定买点时刻即时状态，「静默在涌入之后」不保护臂只管涌入后死到锚点的形状；**改二（早鸟题第三分支·累计位置硬腿，S055 太空逆袭案）**用户裁定原话「S055 poor，这个给中等不对吧，涨了 100% 以上了」——现价较发行价 +126.8%（mid）但 maxChg5=39.38% 未过 +40~50% 速锚线→第二分支不命中误 neutral（5m 末 -11.6%），速度锚测不到慢涨→补位置硬腿：**现价较发行价 +100% 以上（price_level=mid 及以上）一律 poor 无论 maxChg5 过没过线**（+100% 以内才有「价格低」可谈，low 档维持 BP25 口径）；**改三（盘型③famous_monopoly 复数 famous 扩句+FIGHT 案 roster 收录，S064 FIGHT 案）**用户裁定原话「Fight 是 famous 盘，0xfb4e4fa492217d8401aa9e893c78707b61923953 0x550647e8faf10116f0367526080c1005809b4653 这两个著名钱包（加入到著名钱包中），他俩入仓太早了拿的太多，起不来」——0xfb4e t+7s 买 0.252+0x5506 t+13s 买 0.343 合计 0.595 BNB 极早抢筹零卖出，BP29 误判 strong_backer neutral(0.72) 放行即 -41.5%→**famous-copy-wallets.json 收录两址**+③扩句：**两个及以上 famous 钱包极早入场（开盘段内首买）合计拿筹过多（控盘 ≥25~30 且合计绝对额大）同样落③**（famous 抢筹建仓盘）；单 famous 占比 <25 边缘参与不落③（S062 无税人生 0xfb4e 单钱包 24.4% 反例保护，扩句边界安全） | 单测 374→**380 断言**（版本+⑥三段形状句+反例样本+第三分支硬腿+③复数 famous 三处+③门槛既有断言跟随单复数句式）；**182 定向 8 点对拍**：**S055 翻案达成** 早鸟 poor(0.74)/综合 **poor(0.79)** ✓、**S064 翻案达成** famous dominant(1.0)/盘型 **famous_monopoly**(0.75)/综合 **poor(1.00,chip_gate)** ✓、S054/S062 维持 neutral ✓（当时）、S057/S067/S117 维持 poor ✓；**S053 未达成**（三连跑稳定 activity=low 0.58/0.54/0.61 vs mid 0.39）——纯题面救不动，真因=state 时序盲区（临近段 totals 无时序）→ 触发四改 BP31；**roster 外溢**：S062 无税人生 famous none→dominant（两址在该票控盘 100%/集团买入 98.9%）neutral→poor(chip_gate)=「famous 掌控不参与」立法语义内（257% 是 famous 自己拉的）；commit 3715a5e5 |
| BP31 | 2026-11-06 | **锚前尾段三键（案号 BP28 四改——S053 三段形状 state 时序盲区补位）**：BP30 三段形状句对拍 S053 三连跑稳定 low 证实题面救不动——**临近段行只有段 totals（8 笔/16 笔每分钟/段内最大间隔 24s），「锚前 2s 涌入」被段 totals 稀释，Jev 结构性看不到**（「无交易期占比 54.5%+段内最大间隔 24s」整体呈现为临近死寂）→ snapshot 加**锚前尾段三键 nearTail5{TickN,BuyN,BuyBnb}**（锚前最后 5s 固定子窗行数/买笔数/买额，BP 侧自算 CD 层零改动）+state 渲染「锚前尾段(最后5秒)」行+activity 题⑥句挂尾段行判读锚（**多笔且金额可观（参考 ≥3 笔/合计 ≥0.3 BNB 级）=锚点落在涌入波内直接证据；仅 1 笔/尘级=锚点即静默边界**——末行 dt=tEnd 恒在窗内尾段最少 1 笔、0 笔数学上不存在）；mapper actNearTail5* 三键透传；语义分层：⑥三段形状句（BP30）管归属教学、尾段行（BP31）管判读原料——判尾段行不判段内最大间隔（临近段最大间隔覆盖整段 30s 测不出涌入在段尾） | 单测 380→**387 断言**（BP_TAIL_SEC 常量+A fixture 手算 dt>210 只行18@215=1 笔 0.1+三段形状迷你 fixture 4 笔 0.8 涌入臂+死寂臂 1 笔 0.02+activity 16 键锁+state 尾段行渲染+act 三键透传+⑥尾段行判读锚句）；**182 定向复跑**：**S053 翻案达成** activity low→**mid**、综合 poor→**neutral(0.62)** ✓✓ 三连稳定（0.62/0.59/0.63）；S054 维持 neutral（首跑 low=概率平手 0.41/0.41 argmax 边缘方差，复跑两连 neutral 0.44/0.44 留档）；S055/S057/S117 维持 poor ✓；S117 盘型桶 blended→strong_backer 漂移留档（门不走 strong_backer 综合维持 poor 无实质影响）；commit 16e8ada0 |
| BP32 | 2026-11-06 | **早鸟忌讳①前置庄盘豁免（案号 BP29——159 点复审第 5 组 無為 S072 强庄教科书形状被「已拉高」拖死）**：用户裁定原话「無為 是非常典型强庄币啊，第一个点位至少是中等。其它没啥问题」——S072（無為 P1）三大户 0.327/0.294/0.245 **全部 t+0s 首买+只买未卖（卖压 0.0000）**+开盘段大额单 1 笔+锚前尾段 8 笔 1.137 BNB 涌入（BP27 ①庄时序锚+BP22 零卖出满足全命中），low 档（+50~100%）拉升是**强庄最早锁仓拉起的第一波**非散户接力，BP31 早鸟忌讳①第二分支「low 档贴高=已拉高」判 poor(0.54) 拖死综合错过 1m 峰 +97.2% → 忌讳①前置庄盘豁免段（BP23 回调题庄盘豁免同构、判据用 state 材料不引用盘型题答案保质量题独立性）：**开盘段大额单 ≥1 ∧ 持仓前列大买家仍在场（只买未卖零卖出=最强形状）=庄盘语境——庄拉的第一波贴高点位不是接力风险**（买点贴高也是对倒拉升的早期位置而非散户追高），忌讳①「价格已不低」前提不坐实+第一分支救位同步放宽一档 near_launch→low，典型=庄盘第一波早期至少 neutral；**豁免域只到 low 档为止 mid+ 界外**（与 BP25 回调题一档帽同界——庄盘也不追二倍以上的位置）；豁免只解除①不解除②活跃度断流③协同（庄盘断流/协同阵列照常 poor）；criteria neutral 同步补句 | 单测 387→**391 断言**（版本+豁免置顶四句+一档帽+边界不解除②③+criteria 同步）；**182 定向 6 点对拍**：**S072 翻案达成** 早鸟 poor→**neutral(0.71)**/综合 **neutral(0.71,any_neutral)** ✓；**S073 同票 mid 界外照拒** poor(0.91) ✓；**反例 S007 SB P2 平水票照拒** poor(0.93) 未误放 ✓；S083 我画地为牢早鸟虽翻 neutral(0.61) 但 famous dominant **综合仍 chip_gate 拒**（poor 0.99，前向 5m 末 -43%）=豁免只在质量题层门层照拦多层防线生效 ✓；S019 吉祥翻 neutral（前向 5m 峰 +229% 豁免波及方向正确=BP23 庄盘语境票语义连贯）；S006 SB P1 未翻（poor 0.56 边缘保守，前向 +20.6% 保守侧损失可接受留档）；豁免影响域全量摸底=31 张早鸟 poor 中 26 张 strong_backer 盘（前向除 S007 平/S083 -4% 外全部为正 +5~+276%）=「强庄盘最好类型」语义实证；commit 00d04f22 |
| BP33 | 2026-11-07 | **盘型前置预判断+famous heavy/ultra 门扩+tree/追高题退役（案号 BP30——159 点复审第 6 组 15 点一案六改：Sun×2/疯狂星期四×2/我画地为牢×3/로켓급(火箭级)×4/雪球SI×4）**：用户裁定原话「我画地为牢 既然是 famous 为啥还给中？famous 主导就不玩； 로켓급(火箭级) 也是一样，分类是互斥的，如果是famous也不玩，act为altra也不玩。雪球SI 从我的角度应该是early_sniper_decay，也不能玩。 此外，tree_position 可以去掉，market_pattern 要放到很靠前的位置，因为这是个预判断。high_chase_quality 也删除，不开这个选项。」——六改：**改一（筹码门 famous heavy 升拦截档）** famous_domination 拦截域 dominant→**{heavy,dominant}**（≥25=famous 主导就不玩；light 正常参与不拦）——BP32 疯狂星期四 S080 famous heavy 走 strong_backer neutral(0.81) 放行即违例；**改二（盘型分类互斥前置检查）** market_pattern 题头置顶加互斥检查教学——**famous 控盘占比已达 heavy 及以上（筹码结构行 famous 控盘 ≥25）的盘子不是强庄盘也不是融合盘**（强庄的「庄」不能是著名跟单钱包——famous 的货是要出货的，不是锁仓拉盘的庄），famous 主导票盘型只能在③famous_monopoly/②④等散户/衰竭桶内选——BP32 根因=7 张 famous heavy/dominant 票被判 strong_backer（S080/S082/S083/S086/S087/S088/S092）；**改三（活跃度门 ultra 臂）** activity_level 拦截域 {low}→**{low,ultra}**（对齐 CD G17 M 通道=机器盘级极端密集，正常散户参与盘到不了这个密度）；market_heat ultra 刻意不拦（热度高≠机器盘）；**改四（雪球SI=early_sniper_decay 判读锚）** ④狙击衰竭判据补强：**开盘段买入占全窗买入比例极高（参考 ≥70~80%）∧ [WALLETS] 前列钱包首买全在 t+0~几秒 ∧ 开盘段后金额吞吐骤降（金额衰减比笔数衰减更本质）∧ 早期大买家清仓式撤退或只出不进**；**①与④分界=大户在场性+盘面死活**——同为开盘大额，庄在场持续运营=①、开局抢完即衰竭=④（庄跑了的开盘大额只是狙击痕迹）；**改五（market_pattern 前置预判断）** 题序首位+题头「本题是预判断——先于其它题作答、先定盘面性质再谈点位」+判定链门序最前（pattern_gate 先于 activity_gate/chip_gate 裁）；**改六（tree_position 与 high_chase_quality 两题退役）** 聚合两题化（早鸟/回调）——追高形状的拦截由早鸟忌讳（速度/累计位置硬腿）与门链承接，将来策略放开追高时恢复本题（改题面+bump）；snapshot zigzag 数值锚（8 标量）保留落 digest=纯留档无消费者；旧档 answers 带两题答案不被消费不 throw（重放兼容）；质量题三视角变两视角，树佐证句整链删除（早鸟场景判别改「刚出的票首波拉升中贴高仍属早鸟场景」） | 单测 391→**388 断言**（版本 BP33+用户裁定原话全文+10 题形状/首键 market_pattern/QUALITY_IDS 两键化+门桶常量 ACTIVITY_GATE_POOR_BUCKETS{heat:[low],act:[low,ultra]}/CHIP_GATE_FAMOUS_POOR_BUCKETS[heavy,dominant]+门序翻转三组断言 pattern_gate 先裁+heavy 拦截断言翻转+ultra 三断言+tree/high_chase 退役反证段（旧答案不被消费不 throw）+TREE_POSITION_LEVELS 常量绝迹+互斥/预判断/④判据四新断言）+service 测 26 断言（baseAnswers 删两题+qualities 两键化）；**182 定向 20 点对拍（BP33 首跑）**：**翻案组全达成**——S080 疯狂星期四 neutral(0.81)→**poor(0.93,pattern_gate)**（互斥教学：heavy 票 strong_backer→famous_monopoly）✓、S086 로켓급 neutral(0.76)（strong_backer+act=ultra+fam=heavy 三重违例放行票）→**poor(0.95,pattern_gate)** ✓、S082/S083 我画地为牢 poor(chip_gate)→poor(pattern_gate) 盘型分类修正（strong_backer→famous_monopoly=「famous 为啥还给中」根因修复）✓、S092 雪球SI neutral(0.89)→**poor(0.63,activity_gate)**（ultra 臂首中）✓、S100 雪球SI poor(0.47,activity_gate)→poor(0.57,**pattern_gate**,pat=early_sniper_decay)=用户裁定判读达成 ✓、S081/S084/S085/S087/S088 维持拒（门序前移 pattern_gate 先裁留痕）✓；**维持组** S077/S078 Sun neutral 维持、S094/S096 雪球SI neutral 维持 ✓；**反例 5 点零翻动**——**S072 無為（BP29 立法票）neutral(0.80) 零翻动**（fam=none/act=high 不触新门、pat strong_backer 维持=BP29 庄盘豁免与 BP30 六改零冲突无需豁免链）✓、S073 mid 界外照拒 poor(0.96)（chip_gate→pattern_gate 门序）、S045 pattern_gate 维持 poor(0.83)、S018/S040 neutral 维持 ✓；20 点分布 good=0/neutral=7/poor=13；commit 0fced27b |
| BP34 | 2026-11-07 | **盘型六桶⑥sustained_climb 持续拉升弱回调+①散户入场机会双臂+⑥代码侧位置门（案号 BP31——159 点复审第 7 批 59 点收官：Shellbank/羊王 案）**：用户裁定原话「Shellbank 是个不健康的币，最终也证明是个cheat。强庄币，需要增加一个标准，就是有一定的卖出，买卖不是完全不平衡的，庄筹码对倒，给散户进场机会，一开盘一直拉几乎无回调的都不是啥好东西。 但确实这种在分类中没有（我默认cheat中已经干掉了），请给另一个类别吧：持续拉升弱回调类，这种只能临近发布价格参与。 所以 0x5a8d94c69998daffcfdc365f1d333dc4ab087777 也应该是判成这个类型，它第一个点也应该给中等，但是其它应该给poor。」+补充「或者，拉盘的速度不是那么快，给散户入场机会」+「也可以视为是强庄盘（否则容易误伤）」——五改：**改一（①散户入场机会双臂）** ①强庄盘补双臂判据「拉升过程（近窗）有一定的卖出、买卖不是完全不平衡的（庄筹码对倒分仓）∨ 拉盘的速度不是那么快（缓推）——两臂至少占一；一开盘一直拉、几乎无回调、几乎无卖出的纯买拉高=两臂全失走⑥」；**改二（⑥新桶）** MARKET_PATTERN_LEVELS 五桶→六桶 +sustained_climb（几乎无回调（窗内最大回撤极小参考 <10%）∧ 买卖几乎完全不平衡（近窗买占比参考 ≥90% 卖出稀薄——无对倒无换手不给散户入场机会））；**改三（⑥身份豁免·BP35 已重写）** 开盘段大额 ≥1 ∧ 前列大买家未清场=强庄身份证据在场视为①不落⑥；**改四（⑥代码侧位置门）** mapper `SUSTAINED_CLIMB_LAUNCH_PCT=10`——现价较发行价 ≤+10%（含破发）起点段放行走质量题、已拉离（>+10%）或锚缺失（宁拦不冒充）拒（rule=pattern_gate；⑥刻意不入 PATTERN_GATE_POOR_BUCKETS 三桶硬拒表=位置拒与盘型拒分治；界由羊王 S154 −4.2% 放与 S155 +17.1% 拒之间取 10）；**改五（state 判定指引行）** ⑥位置门声明「判型归你、位置归代码」；①⑥分界=散户入场机会双臂、④⑥分界=死活（④开局抢完即衰竭、⑥持续在拉不衰竭） | 单测 388→403 断言（版本 BP34+⑥位置门五行为（60% 拒/−4.2 放/17.1 拒/null 拒/good 不救）+`!PATTERN_GATE_POOR_BUCKETS.includes('sustained_climb')`+六桶对锁+⑥题面/criteria 断言）；**182 定向 9 点对拍（BP34 首跑）=⑥桶零命中**：9 点全 strong_backer/early_sniper_decay 无一落⑥——**根因=改三身份豁免句被系统性吞掉**（羊王 t+0/t+1 大额+零卖钱包=「拉升的执行者就是大户」，身份证据在强庄拉盘票上恒真→⑥恒被豁免；無為与羊王身份证据同形、①⑥唯一客观分界=双臂本身）；S072 红线保住 neutral(0.84)✓、S154 被④误杀（63s 极早窗开盘段占比天然高+近 60s 买 1.385 卖 1.575 双向活跃无衰竭）poor(0.34)✗、S155 act=low 拒（桶级对路径不对）△、S156/S157 误放 neutral ✗✗；commit 01f10f4b |
| BP35 | 2026-11-07 | **①⑥家族归属句替代身份豁免+④极早窗反锚+①承接臂收紧（案号 BP31 对拍修正一——BP34 九点⑥零命中后三处收口）**：修正一⑥「强庄身份豁免」句重写——「也可以视为是强庄盘（否则容易误伤）」重定义为**①⑥同属强庄家族的归属说明不是逃逸门**（开盘大额与大户在场不区分①⑥——拉升的执行者就是大户，两桶在这点上同形；身份证据在场不豁免双臂判据，近窗纯买零卖+急拉的即便大户在场也落⑥）；**防误伤的从宽方向=双臂材料混合/证据薄时从宽①不落⑥**（真强庄的对倒节奏可能间歇——拒买类从严、拿不准从宽；有对倒证据（近窗有像样卖出）的照①评估）；修正二④补**极早窗反锚**（窗口极短 tokenAge<90s 时开盘段买入占比天然高——窗口内几乎全是开盘段，**占比高本身不是④的证据**，④的成立必须落在衰竭臂上：锚窗末段/近窗实际吞吐买卖双向活跃、金额吞吐可观的=盘面没有衰竭不落④——S154 误杀修复）；修正三①补**承接臂收紧句**（近窗零买/纯卖无承接的不落①：近窗流量行买入归零或只剩卖出（近 60s 买 0 卖 0.5+ 级纯卖）、卖压行卖出放量而接盘稀薄=大户在向市场出货、没有换手——承接臂不满足不落①按②(b) 散户化/出货形状判——S157 误放修复） | 单测 403→406 断言（版本 BP35+④极早窗反锚句+①承接臂收紧句+⑥家族句/从宽①句）；**182 定向 9 点对拍=S072 红线失守**：S154 neutral(0.78)✓（④反锚生效）、S155 poor(activity_gate)✓桶级、S110/S128/S138 neutral 稳定✓、S108 Shellbank 落⑥ +32.9% 位置拒（与用户「不健康」观点一致）；**S072 無為落⑥(0.44) 被位置门 +86.6% 拒=poor✗**（窗仅 7s、三大户零卖+买占 94.8%=锚窗内⑥形状与羊王同构，12min 大户对倒证据不可见于锚窗）、S156 仍 strong_backer(0.72)✗（第 1 大 0xb036 全窗买 1.097 卖 0.756 对倒痕迹把 Jev 带去①）、S157 仍①(0.51)✗（「在场持有未卖→不落②」缺承接归零例外）；**①⑥分界需客观线**：無類 S072 近窗卖 0.128 vs 羊王 S156 近窗卖 0.0000——分界在近窗卖出额；commit 2ada8fea |
| BP36 | 2026-11-07 | **①⑥分界近窗锚定 0.1 线+⑥现在进行时/价格拱回针+②⑤承接归零例外（案号 BP31 对拍修正二）**：改一（**①⑥对倒臂=近窗卖出 0.1 线**）①对倒臂判据客观化「近窗卖出合计 ≥0.1 BNB 级=对倒痕迹在场；卖出归零/仅尘埃级（<0.1）=对倒臂失」——⑥对倒臂失=近窗流量行（30s/60s）卖出完全归零或仅尘埃级（参考合计 <0.1 BNB）∧ 买占比 ≥90%（定标：無類 S072 近窗卖 0.128≥0.1→①红线保住、羊王 S156 卖 0.0000→⑥、S155 0.0011→⑥、S108 Shellbank 0.05→⑥ 与用户「不健康」观点一致、反例 S110 0.2464/S128 1.085/S138 0.707→①稳定）；改二（**⑥看现在进行时+回针豁免**）「⑥看拉升的『现在进行时』：全窗更早段的对倒（如开盘大额买进后部分兑现）不救近窗纯拉段——拉升进行时近窗零卖纯买没给散户入场机会的就是本桶」+⑥「几乎无回调」改**看全窗价格拱形状不看单根回针**（「窗内最大回撤」行是临近段口径：单根深而急的回针但迅速收复、末价≈ATH 刚创新高的=洗盘针不是回调结构——S156 回针 35.3% 后 0s 前创新高不破坏一路向上）；改三（**②⑤第三臂承接归零例外**）「大户在场持有未卖→不落②」补例外「近窗买入归零/仅尘埃（买占比 ≈0、无人接盘）=没有任何人在接，无论谁在卖、无论大户在不在场——没有买方的盘面不是⑤（⑤须有换手/活跃），落②(b)（在场持有+零承接=对倒停摆的死盘）」——S157 近窗买 0.0001 卖 0.661 | 单测 406→**410 断言**（版本 BP36+①对倒臂 0.1 线+⑥价格拱回针句+⑥现在进行时句+②⑤承接归零例外+criteria 两桶近窗 0.1 线同步）；**182 定向 9 点对拍+三点三连**：**S072 红线保住且三连稳定**（strong_backer 0.82→neutral 0.75/0.78/0.73，0.1 线把無類拉回①）✓、**S155 落⑥** sustained_climb(0.66)+位置门 +17.1% 拒（路径达成；九点跑另一次 act=low 拒=双门冗余）✓、S157 桶级 poor(0.53,activity_gate)✓（pat 仍① 0.51 低置信——②(b) 承接归零例外的判型采纳待观察）、S154 neutral（BP35）↔poor(act=low 0.45) 摆动=**act 题 mid/low 边缘方差**（三连 2/3 neutral，吞吐 21.1 BNB/min+120 笔/min 材料 mid 起步合理判 low 缺材料依据——act 判读方差留档非本案权限）、S110/S128/S138 反例稳定 neutral ✓、S108 落⑥位置拒（观点一致）；**S156 三代稳定误放留档**（BP34 0.72/BP35 0.72/BP36 0.57~0.76 neutral——Jev 对「0xb036 全窗买 1.097 卖 0.756+开盘段后 2.378 买入承接」材料稳定权衡为①「大户卖出有像样承接」，现在进行时句未能 override 全窗对倒；分歧本质=用户整币后见（t+370 崩 −38%）vs 锚窗材料合理权衡——BP11 案 SB S021 同类先例，**待用户裁定**：接受现状留档 or 继续磨判序优先级）；锚 BPA-075~078 落（S154 neutral/S155 poor/S156 poor（分歧锚）/S157 poor）；commit 25d80b29 |
| BP37 | 2026-11-07 | **⑥对倒臂 0.1→0.12 收紧：贴线微小卖出不豁免（案号 BP32——BP36 全量重抛复审第 5 批 太空逆袭 S054 案）**：用户裁定原话「我认为还是应该维持 sustained_climb，有非常微小的卖出力量不豁免」——太空逆袭 S054（t+67s 近 30s 卖 0.1021、买占比 93.9%）BP36 下刚过 0.1 线被 Jev 从宽判 blended neutral(0.40) 放行；**贴线微小卖出（0.10x 级）不构成对倒证据**，线抬至 **0.12**（定标=S054 0.1021→⑥ 与 無為 S072 0.128→① 之间，BP31 立法票红线不翻）；题面六处同步（①桶对倒臂句/⑥桶判据句/反锚段/strong_backer 桶描述/sustained_climb 桶描述）+「贴线微小卖出不豁免」判读锚 | 单测 410 断言同步（版本 BP37+三处 0.12 线断言+贴线句）；**182 定向 7 点对拍+关键票三连**：**S054 翻案达成** blended neutral(0.40)→**sustained_climb poor 三连稳定**（0.58/0.60/0.69 pattern_gate）✓、**S072 红线保住三连稳定**（strong_backer 0.78 neutral 0.75/0.75/0.68——0.128≥0.12 对倒臂成立仍走①）✓、S053/S037/S048 维持⑥拒 ✓、S155 poor（act low 0.54 activity_gate）桶级一致 ✓、S157 neutral(0.77) act mid/low 方差（BPA-078 已知）△；锚 78→79 枚（**BPA-079**=S054 expect poor 立法锚+**BPA-071 改判** S053 expect neutral→poor——太空逆袭组⑥方向用户接受，activity 翻案记录仍有效、锚语义收窄为 act 档位锚）；commit 1636103c |
| BP38 | 2026-11-07 | **strong_backer ultra 豁免+④极早窗衰竭三证据（案号 BP33——159 点复审 ultra 专题 ALPHA S011 案）**：用户裁定原话「盘型 如果是 strong_backer ，活跃度 ultra 豁免，不给 poor；ALPHA 的盘形应该是 early_sniper_decay，除了最最早期无任何购买力」。①**mapper activity_gate ultra 臂加 strong_backer 豁免**——强庄盘拉盘天然密集，ultra 密度不是拒买证据；豁免域刻意收窄=low 臂（heat/activity）不豁免、盘型缺席照拦保守、famous/②④⑥拒票轮不到本门不受影响；②**④极早窗衰竭三证据**（S011 t+3s top1 64.8% 独食+正净持有 3 人+破发 −24.9%+大户已卖 1.05 形状，不依赖开盘段占比——窗极短时占比臂天然失明）：正净持有人个位数且 top1 独食（60%+）+现价已破发+开盘大额买家已在卖=开局抢完无人接判④不判①（开局大额单本身不救①——①须大买家买点时刻仍在场）；①④分界反锚同步极早窗句；activity_level 题收尾豁免教学句 | 单测 410→**416 断言**（版本 BP38+豁免五臂：strong_backer+ultra 豁免走质量题/豁免后质量题生效/low 臂不豁免/heat 臂不豁免/盘型缺席照拦+④三证据断言）；**182 定向 10 点对拍**：**S011 翻案达成** strong_backer 0.36→**early_sniper_decay 0.98**（poor 0.98 pattern_gate——判型从摇摆到坚定）✓、**SB 四点豁免生效** S004 neutral 0.87/S008 neutral 0.46 放行（裁定方向内代价：前向 1m −32.2%/−47.7%）、S006 poor 0.52/S007 poor 0.90 else_poor（质量题接棒拒：low 贴线/+100% 硬腿）✓、五张反例照拒零翻动（S073 無為 0.98/S085 로켓급 0.95/S091 作茧 0.96/S092 雪球 0.74/S090 作茧一点 neutral 0.84 维持）✓；锚 79→80 枚（**BPA-080**=S011 expect poor 立法锚）；commit 456d03a9 |
| BP39 | 2026-11-07 | **④开盘拉高出货盘+三证据弱化+①④分界两判例+真庄保护反锚（案号 BP34——159 点复审第 8 批 S103/S104/S119/S120 三裁定）**：用户裁定原话「영복이 也是 early_sniper_decay；Lily 一个大户入场，吸引了一堆狙击手，然后大户离场，狙击手立场，盘面没有任何承接。"大户卖出后无承接"，怎么能算强庄盘？FlapGuy 则是第一波购买太强了，卖出后承接力量不够，太弱了，这个我认为是 "开盘拉高然后出货盘"，这种我觉得作为 early_sniper_decay 的一种形态吧，就是开盘拉太高了，后续承接力不够。 其实现在看，只要开盘拉的过高，都不行，都可以直接划为 early_sniper_decay，只要开盘太高，基本没啥好。」。①**④桶新增「开盘拉高出货盘」形态**（不看开盘段占比）：开局第一波购买力太强——很短窗内把价格拉得过高（maxChg5 ≥+40~50% 级，或锚窗最高价较发行价过大（参考 +50% 以上））∧ 随后已砸回（现价较锚窗最高价回落两位数 %/已破发）∧ 承接力量太弱（尾段近窗买入与拉升幅度不匹配——拉高几倍的价格尾段只剩零散小单甚至归零）=开局拉高出货，落④（FlapGuy S119/S120 判例：第一波购买太强、卖出后承接接不住）；②**BP38 极早窗三证据弱化**：三件充分非必要——任两件在场且方向同向即落④（영복이 S103 判例：正净持有 2 人+top1 近 60%+已破发+大户在卖=④，BP36 run 旧版判 blended 放行 −15%）；③**①④分界补两判例**：大户卖出后无承接（大户入场吸来狙击手→大户离场+狙击手离场+盘面无承接——清仓成批/前列走空/尾段买入归零）≠强庄盘走④（Lily S104 判例，「大户卖出后无承接，怎么能算强庄盘」）；开盘拉得过高通则句（开局短窗拉得过高∧已砸回或承接太弱=开局拉高出货盘）；④**真庄保护反锚**：现价仍贴锚窗最高价（回落 <5% 级=拉升进行时）∧ 尾段/近窗有与拉升同量级的重承接（对倒换手在场）=庄拉第一波仍在推进**不落④**（走①⑥分界）；缓推盘（maxChg5 不过线）不算拉过高——定标实证=真庄票贴顶（vsAth 0~−4%）+尾段重承接（0.44~2.56 BNB），翻案票已砸回（−15~−27%）+承接弱/零（0~0.34）；⑤**snapshot 新增 athVsLaunchPct 锚**（锚窗最高可靠价（arc.ath）较发行价 %——「开盘拉得过高」直接度量；Jev 结构性组合不了 currentVsLaunch+currentVsAth 两数故直供，BP31「结构性看不到就补锚」先例；launchCovered 域内 fail-closed）+state-builder 发行价位置行渲染+判定指引行 BP39 句 | 单测 416→**427 断言**（版本 BP39 重写+④桶三断言：弱化句/拉高出货六子串/真庄保护+反锚两断言：Lily 判例/拉过高通则+criteria 三句+athVsLaunchPct 渲染锚断言+纯函数两断言：A 段 +100（ATH 2e-9÷发行价 1e-9）/C 段 null fail-closed+渲染两断言）；**182 定向 12 点对拍+六点三连**：**翻案组 4/4 三连稳定** S103 영복이 blended→**early_sniper_decay**（poor 0.88/0.90/0.92）✓、S104 Lily strong_backer→**early_sniper_decay**（0.38/0.33/0.39）✓、S119 FlapGuy strong_backer→**early_sniper_decay**（0.82/0.79/0.75）✓、S120 FlapGuy→**early_sniper_decay**（0.72/0.77/0.72）✓；**贴顶真庄全保住** S072 無為红线 strong_backer neutral 0.67 ✓、S004 neutral 0.92 ✓、S110 Shellbank neutral 0.90（近窗卖 0.25≥0.12 对倒臂照走①）✓；**S005 SB 三连稳定落④**（0.50/0.49/0.53——BP22「大户零卖出在场」立法票被新通则吸收：现/ATH −23.7% 已砸回+开盘拉高形状，真庄保护反锚（贴顶 <5%）不适用；前向 1m 末 −34.5%/15m 末 −44.3% 支持拦——**新旧立法边界留档待用户裁定**）；**S109 突突车②三连稳定落⑥**（0.62/0.59/0.56 pattern_gate——近 60s 卖 0.105<0.12 对倒臂失+currentVsLaunch >10% 位置门拒=**BP37 0.12 线收紧的滞后效应非 BP39**（BP36 判 blended 时线还是 0.1：0.105≥0.1 对倒臂成立）；前向 5m 峰 +448.9% 大肉被拦=BP37 代价面，与本案无关留档）；S008 综合回落 poor 0.49（早鸟 neutral↔poor 质量题方差，盘型三代稳定 strong_backer 非本案）；S090 holder moderate→strong 触发 chip_gate 拦（holder 维度题 run-to-run 方差非本案，+97.7% 峰错杀留档）；锚 80→84 枚（**BPA-081~084**=S103/S104/S119/S120 expect poor·early_sniper_decay 立法锚）；commit 6894f58e |
| BP40 | 2026-11-07 | **④开盘拉高出货盘收紧：拉得过高单独成立（案号 BP35——bt-v79 六票漏网复盘③裁定三票 b788e63b/d0fbcc7b/4b3f1f7a；用户裁定原话「一开盘就拉高太多的票没有好，不玩」+「这样，买入检测不用做重复的事情了」）**：①**拉得过高单独成立即落④**——锚窗最高价较发行价过大（参考 **+35% 以上**，BP39 +50 下调——三票锚 37.6/47.4/54.4 全 ≥35）或 maxChg5 ≥+40~50% 级暴力拉升，**不再要求「已砸回∧承接太弱」两要件**（BP39 两要件降为「更落」的加重描述）；**仍在拉升中的（现价贴锚窗最高价）除真庄保护反锚外同样落④**（开局拉离发行价过远的位置本身就是风险，无论其后走势）；②**真庄保护反锚维持两腿**（贴顶 <5% 级+同量级重承接——無為 S072 保护不变；刻意不加「大买家未清场」第三腿防误杀庄 A→大户 B 对倒换手=①形状）；③**缓推盘豁免收两臂**：maxChg5 不过线**且**锚窗高点 <35% 两臂全中才算「缓推不算拉过高」（缓推但高点已 ≥35% 照落④——位置不看速度）；④**⑥桶补④⑥分位句**：拉得过高（≥35%）的持续拉升归④开盘拉高形态不落⑥（⑥收拉得不高 <35% 的持续纯拉——两桶门行为同效都拒，分位只明归类）；⑤**与 CD380 分工**：剧烈对倒（cb70708e）/pump 形状（94ea754b）/同区块对倒刷量（06810806）三案=cheat 门三不臂拦截，BP 不加桶不加锚渲染——BP 侧只收位置判断（无三臂证据的拉高票 cheat 照放，④兜底） | 单测 427→**429 断言**（版本 BP40+④单独成立句+已砸回/承接降加重描述+真庄反锚两臂新措辞+缓推两臂+④⑥分位句+criteria 同步）；`_test_buy_point_check_service` 33 全过；**182 对拍=BP40 题面版三保护票全破防**（S072 48.7/贴顶 0、S006 28.9/−2.59、S109 56.6/贴顶 0 两腿证据全在场仍判④0.71-0.78）→ **BP41 收口**（见下行） |
| BP41 | 2026-11-07 | **④真庄反锚判序前置+腿②机械化尾段占比锚+mapper 代码门收口（案号 BP36——BP40 S072 红线破防修正；用户裁定原话「不好处理就先不要误伤」）**：BP40 题面版对拍三保护票全破防（救臂写在忌讳后=BP10 同款病灶 Jev 恒选崩塌腿——判序前置写在题面 Jev 仍忽略）。两步收口：①**题面版**（commit 7dab0763）：④桶反锚**判序前置**（先判反锚后判拉高命中即停）+腿②「同量级重承接」落实为 snapshot 代码锚 `nearTail5BuySharePct`（锚前尾段最后 5s 买÷全窗买×100）——≥ 约三分之一=拉升进行时不落④（無為 48.7/突突车 56.6）；两成及以下=burst 已过不救（b788e63b 判例 20.5%：t+0s 巨单 1.5 BNB 占全窗买近半、尾段绝对额可观但流量已枯——**绝对额判别子被否**：S006 top1=1.0 BNB 受保护票会破）；两成~三分之一边缘**从宽救**；②**mapper 机械门**（commit a2737d39）：Jev 选④ ∧ 腿①贴顶（`currentVsAthPct ≥ −5`）∧ 腿②尾段占比 ≥**25** → ④不成立改判⑤融合桶走质量题聚合（CD379 exempt 同款留痕：`strong_backer_first_wave`/originalBucket/两腿数值）——25 线=1/3 硬线+从宽带的代码化（S006 SB 28.9 真庄 in / b788e63b 20.5 巨单顶 out）；任一锚 null=反锚不成立照拒（拒买类从严 fail-closed）；仅④桶适用（②③桶不受机械门——反锚语义=庄拉第一波非④开盘拉高）；**版本不 bump**（mapper 门在 BP41 版本内定稿，BP41 未部署生产实验）——**⚠mapper 机械门已于 BP42 整段拆除（见下行），题面版判序前置+尾段占比锚保留现行** | 单测 429→**440 断言**（机械门 E 段八断言：命中改判⑤+exempt 留痕/走质量题聚合 neutral/两保护票 28.9·56.6/腿②20.5 拒/腿①−6.01 拒/锚缺失 fail-closed/仅④桶/常量 5·25 对锁）；**182 定向 7 点对拍全达成**：三拒买票保持④（b788e63b 尾段 20.5/d0fbcc7b 回落 −6.01（尾段 100 也不救——贴顶是必要腿）/4b3f1f7a 尾段 10.8）、**S072 红线恢复**④→blended→neutral(0.73)、S073 界外照拒 famous_monopoly poor(0.71)、S006 反锚命中不落④但被 activity_gate 拦（act=low 临近死寂——反锚只解除④设计内）、S109 反锚命中 neutral(0.72)；commit 7dab0763+a2737d39 |
| BP42 | 2026-11-08 | **机械门整段拆除：回归 BP12「不搞代码门」两次明裁（用户裁定原话「等一下，怎么会有代码门，我们不是说不要这种东西吗」——用户在 signals 页看到蛙币 0x275c 盘型显示 blended_unremarkable 无从分辨改判来源，追问前端补展示时引出）**：①**拆除范围**=`buy-point-result-mapper.js` 机械门段（④∧贴顶≥−5∧尾段≥25→改判⑤）+两常量（STRONG_BACKER_ATH_DRAWDOWN_PCT/STRONG_BACKER_TAIL_SHARE_PCT）+导出，**代码不改写 Jev 桶判定**为铁律句写入 mapper 注释；②**保留不动**=题面层④桶反锚判序前置句+snapshot 尾段占比锚 `nearTail5BuySharePct`（数据供给照算落 digest）——题面三度实证 Jev 不执行判序前置=该形状（S072/S006/S109 类真庄贴顶票被④吞）为**设计内代价入攒批池**（复审候选=题面独立前置题形态，仍非代码门——台账 774 行「候选方向仍非代码门」句延续）；③**三选项呈报后用户选拆除**：拆门回归接受现状（推荐）/保留收紧 25→30/保留现状 25；④**bt-v81 数据留档不作机制依据**（机械门豁免 4 票净 +0.4219=整跑正收益全部来源、蛙币 −0.063 贴线误救——一次回测正负不构成机制立法依据，机制原则优先）；⑤**版本不 bump**（题面未动，mapper 回到 BP41 题面版行为） | 单测 440→**433 断言**（机械门 E 段八断言换拆除反证一断言：贴顶 0%+尾段 48.7（BP41 救臂证据全在场）照拒④+dimensions 无 exempt 留痕=BP41 机制绝迹锁）；`_test_cheat_gate_engine` 104/`_test_buy_point_check_service` 33/`_test_signal_gate_engine` 102 全绿；前端 experiment_signals.js 的机械门改判标记改动同步回滚（工作区零残留） |

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
### BP35 ④开盘拉高出货盘收紧：拉得过高单独成立即落④（题集 BP40，2026-11-07，bt-v79 六票漏网复盘③裁定三票）

**背景**：bt-v79（`1b1f9ee3`，ladder v9+卡牌 4×0.05 首跑）六票买点漏网复盘。同日用户四条裁定将原 BP40 立项（①剧烈对倒盘/②sustained_climb 参照 pump/④同区块对倒刷量三案）**整体移交 cheat 门收豁免**（=CD380 案，本侧不做重复检测），BP 侧只剩③位置收紧。用户裁定原话：

> 「0xb788e63b15c2dfa508bb9c52b34d287d07f47777 按照我们的定义，应该是 early_sniper_decay，一开盘就拉高太多的票没有好，不玩。还有 0xd0fbcc7be56f6e8eb1e9be01f456de0093ee7777 0x4b3f1f7a70fbc09b54c4ca209749c5124055ffff 也是一样的问题」
> 「这样，买入检测不用做重复的事情了」

**六票诊断**（漏网根因=CD379 活跃度豁免系统性放走刷量型作弊盘——刷量/锁仓形状天然制造高活跃度，六票放行信号 originalGrade 全∈{cheat,unhealthy} 全经豁免放走；cheat 侧收口=CD380 三不臂，见 CD 台账）：

| 票 | 位置锚 athVsLaunchPct | cheat 三臂证据（CD380 拦截） | BP 侧落法 |
|---|---|---|---|
| b788e63b | 47.4（=currentVsLaunch 贴顶拉升中） | holdingsBalance=3（唯一拦截臂） | **④开盘拉高（本案）** |
| d0fbcc7b | 37.6 | slowGrindPump=3 | **④开盘拉高（本案）** |
| 4b3f1f7a | 54.4 | pump 3/2 + holdings=3 | **④开盘拉高（本案）** |
| cb70708e | 57（maxChg5=98.47） | pump=3+equal=3+coord=3+holdings=3 | cheat 三不臂（BP 不做） |
| 94ea754b | 79 | pump 3/2 | cheat 三不臂（BP 不做） |
| 06810806 | 35.5 | washPair=3 | cheat 三不臂（BP 不做） |

**立法五件**（题面④桶/反锚通则/criteria/⑥桶/版本，BP39 口径上收紧）：

1. **拉得过高单独成立即落④**：锚窗最高价较发行价过大（参考 **+35% 以上**——自 BP39 +50 下调，三票锚 37.6/47.4/54.4 全 ≥35）或 maxChg5 ≥+40~50% 级暴力拉升——**不再要求「已砸回∧承接太弱」两要件**（BP39 形态两要件降为「更落」的加重描述）；**仍在拉升中的（现价贴锚窗最高价）除真庄保护反锚外同样落④**——开局拉离发行价过远的位置本身就是风险，无论其后走势如何（b788e63b 即贴顶拉升中形状，BP39 需「已砸回」要件天然失明）。
2. **真庄保护反锚维持两腿**：现价贴锚窗最高价（回落 <5% 级）∧ 尾段/近窗同量级重承接=庄拉第一波仍在推进不落④——無為 S072 红线保护不变；**刻意不加「大买家未清场」第三腿**（庄 A 卖给大户 B 继续拉=①对倒换手形状，加腿误杀）。
3. **缓推盘豁免收两臂**：maxChg5 不过线**且**锚窗高点较发行价 <35% 两臂全中才算「缓推不算拉过高」——缓推但锚窗高点已 ≥35% 的照落④（**位置不看速度**：BP39 缓推豁免只剩 maxChg5 单臂，慢涨拉离发行价一截的票从豁免逃逸）。
4. **⑥桶补④⑥分位句**：锚窗最高价已拉得过高（≥35%）的持续拉升归**④开盘拉高形态**不落⑥（拉得过高=位置风险归④；⑥收拉得不高 <35% 的持续纯拉——两桶门行为同效都拒，分位只影响归类）。
5. **与 CD380 分工**（用户裁定「买入检测不用做重复的事情了」「这种豁免全部在 cheat 检测模块内部进行」）：剧烈对倒（cb70708e）/pump 形状（94ea754b/d0fbcc7b/4b3f1f7a）/同区块对倒刷量（06810806）的**形状本体检测归 cheat 门三不臂**，BP 不加桶不加锚渲染；BP 侧只收**位置判断**——无三臂证据的拉高票 cheat 照放时④兜底（两层各拦一半漏网面：CD380 拦有作弊证据的高活跃票、BP40 拦位置拉高的票）。

**单测**：`_test_buy_point_lib` 427→**429 断言**（版本 BP40 完整描述+④单独成立句+已砸回/承接降加重描述+真庄反锚两臂新措辞+④⑥分位句+criteria 同步）；`_test_buy_point_check_service` 33 全过。

**对拍**：182 定向（三票④达成+無為 S072 真庄反锚红线保住+S044/S005 真强庄反例零翻动）——**待跑**（部署后按 CD 改动对拍纪律执行，与 CD380 六票 cheat 重放同批）。

**余留**：+35% 参考线若致無為 S072（athVsLaunch ≥50% 档）翻动须收紧真庄保护反锚再对拍；cheat/BP 两门联合校准待 bt-v80（等用户确认启动）首跑 grade×判定分布。

### BP36 ④真庄反锚判序前置+尾段占比锚+mapper 机械门收口（题集 BP41，2026-11-07，BP40 S072 红线破防修正）

**背景**：BP40 定向对拍（commit d2f72d41 部署后 182 跑）三拒买票达成，但**三张真庄贴顶保护票全破防**——無為 S072（BP29/BP32 立法保护票：贴顶回落 0%+尾段 8 笔 1.137 BNB，反锚两腿证据全在场）被「拉得过高单独成立」判④0.74、SB S006（回落 −2.59%+尾段占比 28.9%）④0.78、突突车 S109（贴顶 0+尾段 56.6%）④0.71。BP40 立法句「仍在拉升中的除真庄保护反锚外同样落④」的救臂写在忌讳之后——**BP10 同款病灶复发**：Jev 恒选崩塌腿，题面判序措辞不改变 argmax。用户裁定方向：「**不好处理就先不要误伤**」——边缘从宽救、优先保护真庄票。

**两步收口**：

1. **题面版**（commit 7dab0763）：④桶反锚**判序前置**（「先判反锚后判拉高，反锚命中即停不判④」）+腿②「同量级重承接」落实为 snapshot 代码锚 `nearTail5BuySharePct`（锚前尾段最后 5s 买÷全窗买×100）：≥ 约三分之一=拉升进行时不落④（無為 48.7/突突车 56.6 全过）；两成及以下=burst 已过不救（b788e63b 判例 20.5——t+0s 巨单 1.5 BNB 占全窗买近半、尾段绝对额可观但流量已枯；**绝对额判别子被否**：S006 top1=1.0 BNB 受保护票会破）；两成~三分之一边缘从宽救。state-builder 锚前尾段行补占比口径。单测 429→432。**对拍结果：题面版失效**——三保护票两腿证据全在场仍判④0.71-0.78（判序前置写在题面 Jev 仍忽略），BP10「分数锚定必须代码侧 mapper 门」教训第三次实证（BP10/S053 → BP41）。
2. **mapper 机械门**（commit a2737d39）：`buildBuyPointObservation` 内 qualities 循环后、四层判定链前——Jev 选④ ∧ 腿①贴顶（`currentVsAthPct ≥ −5`）∧ 腿②尾段占比 ≥25 → 桶改判⑤`blended_unremarkable`（prob 保留 Jev 原④ prob）+exempt 留痕 `{code:'strong_backer_first_wave', originalBucket:'early_sniper_decay', drawdownFromAthPct, nearTail5BuySharePct}`（CD379 同款形状）→ 走质量题聚合。**25 线定标**=题面 1/3 硬线+两成~1/3 从宽带的代码化取四分之一线：S006 28.9 真庄 in / b788e63b 20.5 巨单顶 out。任一锚 null=反锚不成立照拒（拒买类从严 fail-closed）；仅④桶适用（②③桶不受机械门）。版本不 bump（BP41 未部署生产实验，对拍 persist:false）。

**182 定向 7 点对拍（全达成）**：

| 点位 | BP40 题面版 | BP41 mapper 门 | 达成 |
|---|---|---|---|
| b788e63b | ④0.87 | ④0.88（尾段 20.5 <25 腿②不足） | ✓ 照拒 |
| d0fbcc7b | ④0.86 | ④0.81（回落 −6.01 腿①不足——尾段占比 100 也不救，贴顶是必要腿） | ✓ 照拒 |
| 4b3f1f7a | ④0.77 | ④0.80（尾段 10.8+回落 −8.49 双腿不足） | ✓ 照拒 |
| **無為 S072** | ❌④0.74 | **blended（exempt 48.7/0）→ neutral(0.73) any_neutral** | ✓ 红线恢复 |
| 無為 S073 | poor 0.72 | poor(0.71) pattern_gate——famous_monopoly（③桶不受反锚） | ✓ 界外照拒 |
| SB S006 | ❌④0.78 | blended（exempt 28.9/−2.59）→ poor(0.75) **activity_gate**（act=low 临近死寂） | ✓ 不落④（act 门另拦设计内） |
| 突突车 S109 | ❌④0.71 | blended（exempt 56.6/0）→ neutral(0.72) | ✓ 反锚命中 |

**留档**：S006 反锚命中后走⑤被活跃度门拦（BP12/BP13 立法：买点前最后 30s 死寂不救）——反锚只解除④、不豁免其它门，方向=用户「不误伤」对④误伤面成立；S006 若须放行属活跃度门校准范畴（另行攒案）。

**bt-v81 生产回测首验（2026-11-07）**：bt-v80（7a8ac18a）首跑 20%（15000/74821 tick）中断且运行于 pre-BP40/CD380/BP41 代码（回测信号 created_at=虚拟时钟，重跑同 ID 追加行不可区分→用户裁定克隆），bt-v81（a5b43ad1）同 config 全窗重跑：**12 票 +0.3164 BNB（+13.18%，胜率 4/12）——T119 阶梯系列（bt-v75~v80）首次整体正收益**。机械门豁免首验 **7 条**：4 条 neutral 全成交（突突车 0x78cd 豁免@08:58 tail=56.6 → +0.409、太空逆袭 0x0cd4@07:20 tail=71.2 → +0.0716、FLAP 突突车 0x600c@08:56 tail=31.5 → +0.0043、蛙币 0x275c@09:33 tail=29.2 → **−0.063 豁免票唯一亏损**）+2 条 activity_gate（SB S006 两条 28.9/29.6）+1 条 chip_gate（0x6869 famous 控盘）；**豁免 4 票净 +0.4219=本跑正收益全部来源**，非豁免 8 票合计 −0.1055——无 BP41 则整跑为负。蛙币=tail 29.2 贴 25 线的边缘误救（−31.5%），组合上豁免票净正。旁证：CD380 六判例（bt-v79 六票）在 bt-v81 全拒零成交，b788e63b 后续 cheatRecheck 重判 healthy 的 6 条信号全被 BP pattern_gate 挡住=双门纵深实证。

**BP42 机械门拆除（2026-11-08 用户裁定）**：用户看 signals 页蛙币盘型显示 blended_unremarkable 无从分辨改判来源，追问时发现 BP41 的 mapper 机械门与 BP12「不搞代码门」两次明裁相悖（用户原话「等一下，怎么会有代码门，我们不是说不要这种东西吗」）——BP41 收口时把「不好处理就先不要误伤」的方向裁定当成了代码门手段的背书，属收口越权（方向≠手段）。三选项呈报（拆门回归接受现状/保留收紧 25→30/保留现状）用户选**拆除**：机械门段+两常量+导出整段删除，代码不改写 Jev 桶判定为铁律；题面层④桶反锚判序前置句+`nearTail5BuySharePct` 锚保留（数据供给照算落 digest）；S072/S006/S109 类真庄贴顶票被④吞=设计内代价入攒批池，复审候选=题面独立前置题形态（仍非代码门，延续 774 行终裁句）。bt-v81 机械门贡献数据（豁免 4 票净 +0.4219/蛙币贴线误救 −0.063）留档**不作机制依据**。版本不 bump（题面未动）。单测 440→433（八断言换拆除反证一断言：贴顶 0%+尾段 48.7 照拒④+无 exempt 留痕）。

**拆门代价首验（bt-v82 `d8d3f246`，2026-11-08 克隆 bt-v81 跑于 BP42 拆门+CD380 两轮修正代码）**：14 票 +0.1191 BNB（胜率 4/14）。v81 四票机械门豁免票**全部回④拒**——0x78cd05（v81 最大盈利票 +0.409，tail=56.6 豁免成交；v82 七条信号全 poor(pattern_gate/early_sniper_decay)）、0x0cd4ce（+0.0716，tail=71.2；v82 回④/②拒）、0x600c92（+0.0043，tail=31.5）、0x275c17 蛙币（−0.063，tail=29.2；拆门后回④拒=少亏一笔），合计 +0.4219 利润随拆门收回。同车 CD380 修正（三臂统一 strong+wash 臂收窄仅 washPair）放行面：cheat 门过 128→343（+215 获 BP 评估资格），其中 96% 被 BP 盘型门兜住（early_sniper_decay 拒 62→175、famous_monopoly 43→142——cheat 形状票盘型同落②③④，两门语义重叠=双门纵深），新进 6 票成交净 +0.2246（0x73d03d +0.187/0x32f18a +0.142 两盈利 strong_backer neutral，0x459f1d/0xd16d9a 两票豁免←cheat 均亏）；CD380 六判例仍全拒（b788e63b/4b3f1f7a 恢复豁免的信号全被 pattern_gate 挡）。净效应 +0.3164→+0.1191（−0.1973=拆门收回 −0.4219+修正放行 +0.2246）——**拆门代价的首次全窗实证，与 CD380 修正效果解耦清晰**。

**余留**：159 点 BP36 全量重抛复审第 11 批起继续；S156 分歧终裁；~~蛙币边缘误救（tail 29.2 贴线）攒批观察是否收紧 25 线~~（随 BP42 拆门撤销）；S072/S006/S109 真庄贴顶④误伤攒批（复审候选=题面独立前置题形态）；cheat/BP 两门联合校准（bt-v81 grade×bucket 分布已采：1758 BUY→cheat 拒 1630→128 进 BP→neutral 12 全成交，pattern_gate 113 拒中 early_sniper_decay 62/famous_monopoly 43）。

### BP10 BP 门 insufficient_ticks 改拒：数据不足=挡住（2026-11-07，门语义案·BP9 翻案；bt-v78 例票用户点名）

**动机**：用户原话「如果购买前检查认为数据不够，那么挡住，而不是放行」，例票 `0x18cf6407884dddfa54442a6becea915f850c7777`（signals 页 bt-v78）——P8（NL15）信号 anchorTickCount=3 → insufficient_ticks 放行 → EXEC 买入 → 15s 后卖出止损 -0.00053。**推翻 BP9（2026-11-05 放行裁定）**。

**改动**（`_bpGateEvaluate` 引擎分支，题集版本不 bump——门语义非题面）：insufficient_ticks 分支 `pass=true` 放行 → **fail-closed 拒**：打 signal failed `reason='bp_gate_insufficient_ticks'`（message 带锚窗 tick 数 `N<minTicks`），metadata buyPoint 段 `passed:false`+anchorTickCount 留痕；minTicks 预门保留在 service（不烧 Jev 配额——数据不足本来就不调 Jev）。signals 页拒因标签同步（「BP 门锚窗 tick 不足拒（数据不足=挡住，BP10 翻案 2026-11-07）」+?v=4.38）。`_test_signal_gate_engine` B5 分支翻案锁定（102/0）。

**影响面实证（bt-v78）**：1461 BUY 信号中 insufficient_ticks 放行 **53 条全部买入**（占 114 买入的 46%）——极早触发票（NL/t0b 早臂）锚窗 tick<8 是常态形状，BP9 放行口径下近乎半数买入无点位判定裸奔；BP10 后这 53 笔全拒（其中多少本会盈亏由 bt-v79 对照验证）。

### BP34 ④开盘拉高出货盘+三证据弱化+①④分界两判例+真庄保护反锚（题集 BP39，2026-11-07，159 点复审第 8 批 S103/S104/S119/S120 三裁定）

**背景**：BP36 题集 159 点全量重抛逐代币复审推进至第 8 批（BP33 案后）。三张翻案票：영복이 `0xe86b81fcd1dad72ea53ad59b8a357542c4b04444` S103（thin 两人盘+大户在卖，BP36 判 blended neutral 放行，前向全程阴跌 −15.3%）、Lily `0x617590a52829d3165d5539344d9e570d6f4b7777` S104（BP36 判 strong_backer 回撤位 neutral 放行，前向 −5.4%）、FlapGuy `0x3acb26b17dabef7b12edfc57ab1145f32eee7777` S119/S120（BP36 判 strong_backer 放行，前向 −24.2%/−21.5%）。用户裁定原话：

> 「영복이 也是 early_sniper_decay；Lily 一个大户入场，吸引了一堆狙击手，然后大户离场，狙击手立场，盘面没有任何承接。"大户卖出后无承接"，怎么能算强庄盘？FlapGuy 则是第一波购买太强了，卖出后承接力量不够，太弱了，这个我认为是 "开盘拉高然后出货盘"，这种我觉得作为 early_sniper_decay 的一种形态吧，就是开盘拉太高了，后续承接力不够。 其实现在看，只要开盘拉的过高，都不行，都可以直接划为 early_sniper_decay，只要开盘太高，基本没啥好。」

**立法四件**：

1. **④桶新增「开盘拉高出货盘」形态**（题面，不看开盘段占比）：开局第一波购买力太强——很短窗内把价格拉得过高（maxChg5 ≥+40~50% 级，或锚窗最高价较发行价过大（参考 +50% 以上））∧ 随后已砸回（现价较锚窗最高价回落两位数 %/已破发）∧ 承接力量太弱（尾段近窗买入与拉升幅度不匹配）=开局拉高出货，落④（FlapGuy 判例句）。
2. **BP38 极早窗三证据弱化**（题面）：三件充分非必要——任两件在场且方向同向即落④（영복이 S103 判例：正净持有 2 人+top1 59.5%≈60+已破发 −3.0%+大户卖 0.39——三证据实际全命中，BP36 旧版判 blended 是版本前判定）。
3. **①④分界补两判例**（反锚块）：「大户卖出后无承接=④不走①」（Lily 判例——大户入场吸来狙击手→大户离场+狙击手离场+盘面无承接；「强庄」的前提是庄还在/卖出有像样承接）+「开盘拉得过高=④」通则句。
4. **真庄保护反锚**（④桶+反锚双写）：现价仍贴锚窗最高价（回落 <5% 级=拉升进行时）∧ 尾段重承接=庄拉第一波仍在推进**不落④**（走①⑥分界）；缓推盘（maxChg5 不过线）不算拉过高。**定标实证**（锚对齐表）：真庄票=贴顶（vsAth 0~−4%）+尾段重承接 0.44~2.56 BNB（無為 S072 0/1.14、S004 0/2.56、S006 −2.6/1.85、S109 0/+449% 肉）；翻案票=已砸回（vsAth −15~−27%）+承接弱/零 0~0.34（S103 −14.3、S104 −19.9、S119 −26.5、S120 −20.9）。

**新锚**：snapshot `athVsLaunchPct`（锚窗最高可靠价 arc.ath ÷ 发行价 −1，BP39「开盘拉得过高」直接度量——Jev 结构性组合不了 currentVsLaunch+currentVsAth 两数故直供，BP31「结构性看不到就补锚」先例；launchCovered 域内 arc.ath≤0 时 null fail-closed）+state-builder 发行价位置行渲染「锚窗最高价较发行价 X%」+判定指引行 BP39 句。

**对拍结果**（182 定向 12 点+六点三连，BP39）：

| 点位 | 代币 | BP36 | BP39 三连 | 达成 |
|---|---|---|---|---|
| S103 | 영복이（thin 两人+破发+大户在卖） | blended neutral 放行 −15.3% | **early_sniper_decay → poor 0.88/0.90/0.92 pattern_gate** | ✓ 翻案三连稳定 |
| S104 | Lily（大户离场+狙击手离场无承接） | strong_backer neutral 放行 −5.0% | **early_sniper_decay → poor 0.38/0.33/0.39 pattern_gate** | ✓ 翻案三连稳定 |
| S119 | FlapGuy（第一波太强+砸回 −26.5%） | strong_backer 放行 −24.2% | **early_sniper_decay → poor 0.82/0.79/0.75 pattern_gate** | ✓ 翻案三连稳定 |
| S120 | FlapGuy（拉高砸回 −20.9%） | strong_backer 放行 −21.5% | **early_sniper_decay → poor 0.72/0.77/0.72 pattern_gate** | ✓ 翻案三连稳定 |
| S072 | 無為（红线：贴顶 0/尾段承接 1.14） | strong_backer neutral | strong_backer neutral 0.67 维持 | ✓ 真庄保护红线保住 |
| S004 | SB（贴顶 0/重承接 2.56） | poor（activity_gate） | neutral 0.92 维持（BP38 豁免后） | ✓ |
| S110 | Shellbank（近窗卖 0.25≥0.12 对倒臂） | strong_backer neutral 0.91 | strong_backer neutral 0.90 维持 | ✓ |
| S005 | SB（BP22 立法票：大户零卖出在场） | strong_backer neutral 0.55 | **early_sniper_decay → poor 0.50/0.49/0.53**（砸回 −23.7%+开盘拉高，保护反锚（贴顶 <5%）不适用） | △ 新通则吸收旧立法票（前向 15m −44.3% 支持拦；待用户裁定） |
| S109 | 突突车②（近 60s 卖 0.105） | blended neutral 放行 +449% 峰 | **sustained_climb → poor 0.62/0.59/0.56 pattern_gate**（0.105<0.12 对倒臂失+位置门拒） | △ BP37 0.12 线滞后效应非本案（BP36 时线 0.1：0.105≥0.1 对倒臂成立） |
| S008 | SB | poor 0.72（activity_gate） | poor 0.49 else_poor（早鸟 neutral↔poor 方差；盘型三代稳定①） | ○ 桶级与 BP36 一致 |
| S090 | 作茧自缚一点 | neutral 0.82/0.84 | poor 0.51 chip_gate（holder moderate→strong 维度题方差非本案） | ○ 方差留档（+97.7% 峰错杀） |

**落锚**：manual-anchors 80→84 枚——**BPA-081~084**=S103/S104/S119/S120 set 点锚 expect=poor（BP39 立法锚：④开盘拉高出货/三证据弱化/大户离场无承接判型，note 存用户裁定原话）。

**余留**：①S005 SB（BP22 大户零卖出立法票）被新通则吸收=新旧立法边界待用户裁定（接受新通则 or 大户在场臂加豁免）；②S109 +449% 大肉被拦=BP37 0.12 线代价面延续（与 S111/S113/S114 +100% 硬腿池合并攒批）；③S090 holder 维度方差+S008 早鸟方差=质量/维度题 run-to-run 方差池（三连跑惯例化候选）；④159 点 BP39 全量重抛待用户裁定（⑥/④ 影响面）；⑤生产 v74 stopped 无运行实验，下次启动自动吃 BP39。

### BP33 strong_backer ultra 豁免+④极早窗衰竭三证据（题集 BP38，2026-11-07，159 点复审 ultra 专题 ALPHA S011 案）

**背景**：BP37 收官后用户专题问询「这些点位出现活跃度 ultra 都有哪些」——159 点中 act=ultra 共 **14 点（7 代币）全部被拒**，全量呈报。用户两裁定原话：

> 「盘型 如果是 strong_backer ，活跃度 ultra 豁免，不给 poor；ALPHA 的盘形应该是 early_sniper_decay，除了最最早期无任何购买力」

**立法两件**：

1. **strong_backer ultra 豁免（mapper 代码侧）**：activity_gate ultra 臂加 `market_pattern==='strong_backer'` 豁免条件——强庄盘拉盘天然密集，ultra 密度不是拒买证据（SB 四点 S004/S006/S007/S008 与 S011 均为此形状被 activity_gate 拦）。豁免域刻意收窄：**low 臂（heat/activity）不豁免**（活跃度死寂强庄盘照拦）、**盘型缺席照拦**（保守方向）、famous/②④⑥拒票轮不到本门不受影响。
2. **④极早窗衰竭三证据（题面判据补强）**：ALPHA `0x672f509c5d78c29aa051a55e216974256f877777` S011（t+3s，开盘大额 2+top1 64.8% 独食+正净持有 3 人+破发 −24.9%+大户已卖 1.05）判 strong_backer 0.36 拦于 ultra——用户改判④。④判据补「极早窗内可见的衰竭形态（不依赖开盘段占比——窗极短时占比臂天然失明）」：①窗内正净持有人极少（个位数）且 top1 独食（60%+）②现价已破发（开局购买力没铸成价格）③开盘大额买家已在卖（最早大额正在撤退）——三证据在场=开局抢完无人接，判④不判①（①须大买家买点时刻仍在场；开局大额单本身不救①）。①④分界反锚同步补极早窗句。

**对拍结果**（182 定向 10 点，BP38）：

| 点位 | 代币 | BP36 | BP38 | 达成 |
|---|---|---|---|---|
| S011 | ALPHA（t+3s top1 64.8%+破发+大户已卖） | strong_backer 0.36 拒于 activity_gate | **early_sniper_decay 0.98 → poor 0.98 pattern_gate** | ✓ 翻案达成（判型从摇摆 0.36 到坚定 0.98） |
| S004 | SB（t+3s maxChg5 34.7 near_launch） | activity_gate 拒 | **neutral 0.87 any_neutral 放行**（豁免生效走质量题） | ✓ 豁免生效（前向 1m −32.2%/15m −42.4%=裁定方向内代价） |
| S006 | SB（t+16s vsLaunch 98.8%） | activity_gate 拒 | poor 0.52 else_poor（质量题早鸟拒——low 贴线） | ✓ 豁免后质量题接棒拒 |
| S007 | SB（t+20s vsLaunch 106.4% mid） | activity_gate 拒 | poor 0.90 else_poor（+100% 硬腿） | ✓ 同上 |
| S008 | SB（t+23s vsLaunch 65.8%） | activity_gate 拒 | **neutral 0.46 放行**（低置信） | ✓ 豁免生效（前向 1m −47.7%=裁定方向内代价） |
| S073 | 無為（famous dominant+ultra） | pattern_gate 拒 | famous_monopoly 0.98 拒 维持 | ✓ 反例零翻动 |
| S085 | 로켓급（famous heavy+ultra） | pattern_gate 拒 | famous_monopoly 0.95 拒 维持 | ✓ |
| S090 | 作茧自缚一点（strong_backer act high） | neutral 放行 | strong_backer 0.65 neutral 0.84 维持 | ✓ 非 ultra 不受影响 |
| S091 | 作茧自缚（famous dominant+maxChg5 93.6%） | pattern_gate 拒 | famous_monopoly 0.96 拒 维持 | ✓ |
| S092 | 雪球SI（t+1s sustained_climb+ultra） | pattern_gate 拒 | sustained_climb 0.74 拒 维持 | ✓ |

**落锚**：manual-anchors 79→80 枚——**BPA-080**=S011 set 点锚 expect=poor（BP38 立法锚：盘型④+三证据判读，note 存用户裁定原话+对拍）。

**余留**：①S004/S008 放行后前向负（−42.4%/−53.3% 15m）=豁免方向内代价，攒批观察 strong_backer ultra 票的质量题拦截率；②14 点 ultra 全景已呈报（拦对 12/吞肉 2：S037 +148.7%/로켓급 1m 尖峰）——「⑥/ultra 极早窗反锚」悬裁族仍在攒批（S037 t+1s/S053 t+44s/로켓급对），本案权限外。

### BP32 ⑥对倒臂 0.1→0.12 收紧：贴线微小卖出不豁免（题集 BP37，2026-11-07，BP36 全量重抛复审第 5 批 太空逆袭 S054 案）

**背景**：BP36 题集 159 点全量重抛（neutral 46/poor 113）逐代币复审推进至第 5 批。太空逆袭 `0x0cd4cee39ed16ad3e39e3b261dc592648d137777` 第二点 **S054**（t+67s，近 30s 卖出合计 0.1021、买占比 93.9%）在 BP36 下刚过 0.1 线被 Jev 从宽判 **blended_unremarkable neutral(0.40) 放行**。用户裁定原话：

> 「0x0cd4cee39ed16ad3e39e3b261dc592648d137777 在第二个点改为 blended 是为什么？我认为还是应该维持 sustained_climb，有非常微小的卖出力量不豁免。」

**立法**：贴线微小卖出（0.10x 级刚过 0.1）不构成对倒证据——「非常微小的卖出力量不豁免」。①⑥对倒臂判据线由 0.1 抬至 **0.12**，定标=太空逆袭 S054 0.1021→⑥ 与 無為 S072 0.128→① 之间（BP31 立法票红线不翻）。题面六处同步（①桶对倒臂句/⑥桶判据句/反锚段/strong_backer 桶描述/sustained_climb 桶描述）+补「贴线微小卖出不豁免」判读锚；版本 BP36→BP37（commit 1636103c）。

**对拍结果**（182 定向 7 点+关键票三连）：

| 点位 | 代币 | BP36 | BP37 | 达成 |
|---|---|---|---|---|
| S054 | 太空逆袭二点（近窗卖 0.1021） | blended neutral(0.40) 放行 | **sustained_climb poor 三连稳定**（0.58/0.60/0.69 pattern_gate） | ✓ 翻案达成 |
| S072 | 無為红线（近窗卖 0.128≥0.12） | strong_backer neutral | strong_backer 0.78 neutral 三连（0.75/0.75/0.68） | ✓ 红线保住 |
| S053 | 太空逆袭一点（t+44s） | sustained_climb 拒 | sustained_climb 0.61 拒 维持 | ✓ 同组方向 |
| S037 | VirusSI（t+1s） | sustained_climb 拒 | sustained_climb 0.75 拒 维持 | ✓ |
| S048 | 阿里美股（t+21s） | sustained_climb 拒 | sustained_climb 0.58 拒 维持 | ✓ |
| S155 | 羊王（+17.1%） | poor | poor（act low 0.54 activity_gate） | ✓ 桶级一致 |
| S157 | 羊王（+26.9%） | poor | neutral(0.77, any_neutral) | △ act mid/low 方差（BPA-078 已知） |

**落锚**：manual-anchors 78→79 枚——**BPA-079**=S054 set 点锚 expect=poor（BP37 立法锚，note 存用户裁定原话+三连对拍）；**BPA-071 改判**：S053 expect neutral→poor（太空逆袭组⑥方向用户接受，activity 翻案记录仍有效、锚语义收窄为 act 档位锚）。

**余留**：BP37 换代后 159 点是否全量重抛（⑥桶影响面）待用户裁定；生产 v74 stopped 无运行实验，下次启动自动吃 BP37。

### BP31 ⑥持续拉升弱回调+①散户入场机会双臂+近窗 0.1 线：羊王四点定位与無為红线（题集 BP34/BP35/BP36 三代，2026-11-07，159 点复审第 7 批 Shellbank/羊王 案）

**背景**：第 7 批 59 点 review 完。Shellbank（S108/S110 `0x24436292ae46bb4f0bdc4389d7180eaa82747777`）与羊王（S154-S157 `0x5a8d94c69998daffcfdc365f1d333dc4ab087777`）形状：开盘即持续单边拉升、几乎无回调、近窗卖出归零纯买拉高——现有五桶无类可归（Jev 硬塞 strong_backer/early_sniper_decay）。用户三段裁定：

> 「Shellbank 是个不健康的币，最终也证明是个cheat。强庄币，需要增加一个标准，就是有一定的卖出，买卖不是完全不平衡的，庄筹码对倒，给散户进场机会，一开盘一直拉几乎无回调的都不是啥好东西。 但确实这种在分类中没有（我默认cheat中已经干掉了），请给另一个类别吧：**持续拉升弱回调类，这种只能临近发布价格参与**。 所以 0x5a8d94c69998daffcfdc365f1d333dc4ab087777 也应该是判成这个类型，它第一个点也应该给中等，但是其它应该给poor。」
> 「补充一下，或者，拉盘的速度不是那么快，给散户入场机会」
> 「也可以视为是强庄盘（否则容易误伤）」

**验收标准**：羊王四点——S154（−4.2% 贴发行价）neutral、S155（+17.1%）/S156（+45.8%）/S157（+26.9%）poor；無為 S072（BP29 立法票）neutral 红线零翻动。

**锚窗对照（無為 vs 羊王——①⑥分界的客观基础）**：
- 無為 S072：窗仅 7s，三大户 0.327/0.294/0.245 全 t+0s 首买零卖出，买占 94.8%，7 秒 +87%——锚窗内与羊王⑥形状同构；但 12min 全窗外 8 大户人人有卖（对倒平衡），近窗卖 0.128 BNB
- 羊王 S156：近窗 30s 卖出 0.0000×0（对倒臂失）、买占比极高；第 1 大 0xb036 全窗买 1.097 卖 0.756+开盘段后 2.378 买入承接——①材料部分成立但**近窗归零**；t+370 崩 −38%（用户整币后见）

**三代演进（BP34→BP35→BP36）**：
- **BP34 立法五改**（01f10f4b）：①补散户入场机会双臂（对倒∨缓推两臂至少占一）；②新桶 sustained_climb（几乎无回调+买卖几乎完全不平衡）；③「强庄身份豁免」（开盘大额+前列未清场视为①不落⑥）；④mapper 代码侧位置门 `SUSTAINED_CLIMB_LAUNCH_PCT=10`（≤+10% 含破发放、>+10% 或锚缺失拒；⑥不入 PATTERN_GATE_POOR_BUCKETS 硬拒表=位置拒与盘型拒分治）；⑤state 判定指引行。**对拍=⑥桶零命中**——根因：身份豁免句被系统性吞掉（羊王 t+0/t+1 大额+零卖钱包=「拉升的执行者就是大户」，身份证据在强庄拉盘票上恒真→⑥恒被豁免）；S072 neutral(0.84)✓、S154 被④误杀✗（63s 极早窗开盘段占比天然高+近 60s 双向活跃无衰竭）、S156/S157 误放✗✗
- **BP35 三修正**（2ada8fea）：⑥身份豁免重写为**家族归属句**（「也可以视为是强庄盘」=①⑥同属强庄家族的归属说明不是逃逸门——身份证据不豁免双臂判据；防误伤从宽方向=双臂材料混合/证据薄时从宽①）；④补**极早窗反锚**（tokenAge<90s 开盘段占比天然高，占比高本身不是④证据，④必须落在衰竭臂）；①补**承接臂收紧**（近窗零买/纯卖无承接不落①，按②(b) 散户化判）。对拍：S154 neutral(0.78)✓、S108 Shellbank 落⑥ +32.9% 位置拒（与「不健康」观点一致）、S110/S128/S138 反例稳定✓；**S072 红线失守**（锚窗 7s 内⑥形状同构被 Jev 忠实判⑥ 0.44→位置门 +86.6% 拒）✗、S156 仍①(0.72)✗、S157 仍①(0.51)✗——①⑥分界需客观线
- **BP36 修正二**（25d80b29）：**①⑥对倒臂=近窗卖出 0.1 线**（①近窗卖出合计 ≥0.1 BNB=对倒痕迹在场；卖出归零/仅尘埃 <0.1=对倒臂失走⑥——定标于無為 0.128 与羊王 0.0000 之间，S108 0.05→⑥ 与「不健康」一致，反例 S110 0.2464/S128 1.085/S138 0.707→① 稳定）；**⑥看现在进行时**（全窗更早段对倒不救近窗纯拉段）；**⑥回针豁免**（「窗内最大回撤」是临近段口径——单根深急回针迅速收复创新高=洗盘针不是回调结构，看全窗价格拱；S156 回针 35.3% 后 0s 创新高不破坏一路向上）；**②⑤承接归零例外**（在场持有+近窗买占比 ≈0 无人接=对倒停摆的死盘落②(b)，没有买方的盘面不是⑤——S157 近窗买 0.0001 卖 0.661）

**BP36 九点对拍结果**（set 保序 S072,S108,S110,S128,S138,S154,S155,S156,S157；三点三连验证）：

| 点位 | 代币 | 判定 | 桶/prob | 达成 |
|---|---|---|---|---|
| S072 | 無為 `0xb97d5772` | neutral 0.73-0.82 三连稳定 | strong_backer | ✓ 红线 |
| S108 | Shellbank `0x24436292` | poor（⑥+32.9% 位置拒） | sustained_climb | ✓ 与「不健康」一致 |
| S110 | Shellbank 同票二点位（近窗卖 0.2464→①） | neutral 稳定 | strong_backer | ✓ 反例零翻动 |
| S128 | 反例（近窗卖 1.085→①） | neutral 稳定 | strong_backer | ✓ 反例零翻动 |
| S138 | 反例（近窗卖 0.707→①） | neutral 稳定 | strong_backer | ✓ 反例零翻动 |
| S154 | 羊王 `0x5a8d94c6` | neutral（BP35）/poor(act low 0.45) 摆动 | — | △ act 方差 3/5 neutral |
| S155 | 羊王 | poor ✓ | sustained_climb 0.66+位置拒 | ✓ 桶级达成 |
| S156 | 羊王 | **neutral 0.57-0.76 三代稳定** | strong_backer | ✗ 分歧留档 |
| S157 | 羊王 | poor 0.53 activity_gate | strong_backer 0.51 低置信 | ✓ 桶级（路径=act 门） |

**分歧留档**：
- **S156（BPA-077 分歧锚）**：机器 BP34-BP36 三代稳定 strong_backer neutral（0.57~0.76）——锚窗内 0xb036 全窗对倒+2.378 承接=①「大户卖出有像样承接」材料成立，Jev 稳定权衡为①；「现在进行时」句未能 override 全窗对倒材料。分歧本质=用户裁定来自整币后见（t+370 崩 −38%）vs 锚窗材料合理权衡——**BP11 案 SB S021 同类先例**（后见裁定与锚窗信息合理分歧，接受现状留档）。待用户终裁：接受现状 or 继续磨判序优先级
- **S154（BPA-075）**：act 门 mid/low 边缘方差——吞吐 21.1 BNB/min+120 笔/min+0% 静默材料 mid 起步合理，Jev 判 low（0.45）无材料依据；三连 2/3 neutral。act 题判读方差非本案权限，留档

**落锚**：manual-anchors 74→78 枚——BPA-075=S154 neutral、BPA-076=S155 poor、BPA-077=S156 poor（分歧锚）、BPA-078=S157 poor（locator：S154 2026-11-05T12:31:55Z 锚41 / S155 12:33:37Z 锚67 / S156 12:34:44Z 锚81 / S157 12:37:01Z 锚102）。

### BP30 盘型前置预判断+famous heavy/ultra 门扩+tree/追高题退役：第 6 组 15 点一案六改（题集 BP33，2026-11-07，159 点复审第 6 组）

**背景**：159 点 signals 集第 6 组 15 点（Sun×2（S077/S078 `0x68690152`）/疯狂星期四×2（S080/S081 `0xeefe9f2f`）/我画地为牢×3（S082-S084 `0x3816a4ab`）/로켓급(火箭级)×4（S085-S088 `0x9cbe7b5a`）/雪球SI×4（S092/S094/S096/S100 `0x92a130f2`））BP32 重析（poor=9/neutral=6）人工审毕，用户一案六改裁定原话：「我画地为牢 既然是 famous 为啥还给中？famous 主导就不玩； 로켓급(火箭级) 也是一样，分类是互斥的，如果是famous也不玩，act为altra也不玩。雪球SI 从我的角度应该是early_sniper_decay，也不能玩。 此外，tree_position 可以去掉，market_pattern 要放到很靠前的位置，因为这是个预判断。high_chase_quality 也删除，不开这个选项。」

**BP32 基线违例形状（六改的靶子）**：
- **S080 疯狂星期四**（famous=heavy）判 strong_backer → neutral(0.81) 放行——heavy 控盘票走「强庄」路径放行=改一靶
- **S086 로켓급**（fam=heavy ∧ act=ultra ∧ pat=strong_backer）三重违例 → neutral(0.76) 放行——分类互斥+ultra 门=改二改三靶
- **S082/S083/S087/S088 我画地为牢/로켓급**（fam=dominant）盘型题全判 strong_backer、靠 chip_gate 兜底拒——盘型分类本身错了（dominant 票不可能是强庄盘）=改二根因
- **S092 雪球SI**（act=ultra）→ neutral(0.89) 放行——ultra 门=改三靶
- **S100 雪球SI**（开盘段占比极高+前列首买全在最初几秒+后段骤降）判 strong_backer、activity_gate 拒——判读角度错（形状是④狙击衰竭不是强庄）=改四靶

**六改全文**：

1. **筹码门 famous heavy 升拦截档（改一）**：`famous_domination` 拦截域 dominant→**{heavy,dominant}**（≥25=famous 主导就不玩）；light（<25 正常参与）不拦。题面 famous 反锚⑤同步：「买在这样的盘面=把出场交给 famous 的出货节奏，这正是 heavy/dominant 两档（占比 ≥25）被代码侧硬门拒买的原因」。

2. **盘型分类互斥前置检查（改二，根因修复）**：market_pattern 题头置顶互斥教学——「**分类互斥前置检查（BP33）**：famous 控盘占比已达 heavy 及以上（筹码结构行 famous 控盘 ≥25）的盘子**不是强庄盘也不是融合盘**——强庄的「庄」不能是著名跟单钱包：famous 的货是要出货的，不是锁仓拉盘的庄；famous 主导的盘子盘型只能在 famous_monopoly（独食）/散户 PVP/狙击衰竭等桶内选」。BP32 根因=盘型题把 famous heavy/dominant 票判 strong_backer（把 famous 巨鲸当「庄」）——「庄」与「famous」是两种对立角色：庄锁仓拉盘、famous 跟单出货。

3. **活跃度门 ultra 臂（改三）**：`activity_level` 拦截域 {low}→**{low,ultra}**（对齐 CD G17 M 通道语义=机器盘级极端密集，正常散户参与盘到不了这个密度）；`market_heat` ultra 刻意不拦（热度高本身不是机器盘证据）。activity_level 题尾句同步：「低档与超高档均由代码侧活跃度门直接消费拒买」。

4. **④狙击衰竭判据补强+①④分界（改四，雪球SI S100 案）**：④判据四要件——开盘段买入占全窗买入比例极高（参考 **≥70~80%**）∧ [WALLETS] 前列钱包首买全在 t+0~几秒 ∧ 开盘段后**金额吞吐骤降（金额衰减比笔数衰减更本质）** ∧ 早期大买家清仓式撤退或只出不进；**①与④分界=大户在场性+盘面死活**：同为开盘大额，庄在场持续运营=①强庄盘，开局抢完即衰竭=④（庄跑了的开盘大额只是狙击痕迹）。

5. **market_pattern 前置预判断（改五）**：题序首位（questions 数组第一题）+题头「本题是预判断——先于其它题作答、先定盘面性质再谈点位」+mapper 判定链门序最前（pattern_gate 先于 activity_gate/chip_gate 裁，rule 留痕首个命中门）。

6. **tree_position 与 high_chase_quality 两题退役（改六）**：聚合三视角→**两视角**（早鸟/回调）；追高形状的拦截由早鸟忌讳（maxChg5 速度锚+BP28 累计位置硬腿）与门链承接；将来策略放开追高时恢复本题（改题面+bump）。tree_position 题删除后 snapshot zigzag 数值锚（swingHighCount 等 8 标量）保留落 digest=**纯留档无消费者**（历史 run 对拍兼容）；早鸟/回调题树佐证句整链删除（早鸟场景判别改「刚出的票首波拉升中贴高仍属早鸟场景」非树形依赖）；旧档 answers 带两题答案=不被消费不 throw（重放兼容）。

**判定链 BP33 四层**（mapper）：**①盘型门 pattern_gate（预判断最前）**——retail_pvp/famous_monopoly/early_sniper_decay → poor → **②活跃度门 activity_gate**——market_heat=low 或 activity_level∈{low,ultra} → poor → **③筹码门 chip_gate**——famous_domination∈{heavy,dominant} 或 holder_concentration=strong → poor → **④两质量题聚合**——任一 good→good/任一 neutral→neutral/否则 poor（insufficient 不贡献；两题全 insufficient→poor 且 prob=null）。

**单测**：`_test_buy_point_lib.cjs` 391→**388 断言**全绿（版本 BP33+用户裁定原话全文锁定+10 题形状/首键 market_pattern/QUALITY_IDS 两键化+门桶常量 `ACTIVITY_GATE_POOR_BUCKETS`/`CHIP_GATE_FAMOUS_POOR_BUCKETS` 断言+门序翻转三组断言（pattern_gate 先裁）+heavy 拦截断言由放行翻转为拦截+ultra 三断言+tree/high_chase 退役反证段（legacyTree 旧答案不被消费不 throw）+`TREE_POSITION_LEVELS` 常量绝迹+互斥/预判断/④判据四新断言）；`_test_buy_point_check_service.cjs` 26 断言（baseAnswers 删两题+qualities 两键化+high_chase 键绝迹）。

**182 定向 20 点对拍（BP33 首跑，`--only` 第 6 组 15 点+反例 5 点）**：

| 点位 | 代币 | BP32 | BP33 | 判定 |
|---|---|---|---|---|
| S077 | Sun `0x68690152…` | neutral(0.79) | neutral(0.73) blended | 维持 ✓ |
| S078 | Sun | neutral(0.79) strong_backer | neutral(0.81) blended | 维持（盘型桶漂移无门影响）✓ |
| S080 | 疯狂星期四 `0xeefe9f2f…` | **neutral(0.81)** strong_backer+fam=heavy | **poor(0.93,pattern_gate)** famous_monopoly | **翻案达成**（互斥教学+heavy 门）✓ |
| S081 | 疯狂星期四 | poor(1,chip_gate) | poor(0.94,pattern_gate) | 维持拒（门序前移）✓ |
| S082 | 我画地为牢 `0x3816a4ab…` | poor(1,chip_gate) strong_backer | poor(0.94,pattern_gate) famous_monopoly | **分类修正**（famous dominant 不落①）✓ |
| S083 | 我画地为牢 | poor(0.99,chip_gate) | poor(0.95,pattern_gate) | 分类修正 ✓ |
| S084 | 我画地为牢 | poor(0.8,activity_gate) | poor(0.96,pattern_gate) | 维持拒 ✓ |
| S085 | 로켓급 `0x9cbe7b5a…` | poor(0.3,pattern_gate) | poor(0.89,pattern_gate) | 维持拒（prob 收敛）✓ |
| S086 | 로켓급 | **neutral(0.76)** strong_backer+act=ultra+fam=heavy | **poor(0.95,pattern_gate)** famous_monopoly | **翻案达成**（三重违例票）✓ |
| S087 | 로켓급 | poor(1,chip_gate) | poor(0.95,pattern_gate) | 维持拒 ✓ |
| S088 | 로켓급 | poor(1,chip_gate) | poor(0.95,pattern_gate) | 维持拒 ✓ |
| S092 | 雪球SI `0x92a130f2…` | **neutral(0.89)** act=ultra | **poor(0.63,activity_gate)** | **翻案达成**（ultra 臂首中）✓ |
| S094 | 雪球SI | neutral(0.6) | neutral(0.59) | 维持 ✓ |
| S096 | 雪球SI | neutral(0.6) | neutral(0.71) | 维持 ✓ |
| S100 | 雪球SI | poor(0.47,activity_gate) strong_backer | poor(0.57,**pattern_gate**) **early_sniper_decay** | **判读达成**（用户裁定形状）✓ |
| S072 | 無為 `0xb97d5772…` | neutral(0.71)（BP29 立法票） | **neutral(0.80) 零翻动**（fam=none/act=high/pat strong_backer 维持） | **立法票安全**——BP29 庄盘豁免与 BP30 六改零冲突、无需豁免链 ✓ |
| S073 | 無為 | poor(0.91,chip_gate) | poor(0.96,pattern_gate) | mid 界外照拒 ✓ |
| S045 | 谷谷② `0xbd74373a…` | poor(0.81,pattern_gate) | poor(0.83,pattern_gate) | 维持 ✓ |
| S018 | 吉祥B | neutral | neutral(0.87) | 反例稳定 ✓ |
| S040 | 吉祥反例 | neutral | neutral(0.64) | 反例稳定 ✓ |

20 点分布 good=0/neutral=7/poor=13；commit `0fced27b`。

**余留**：159 点 BP33 全量重抛待用户裁定时机（tree/追高退役后 10 题形状全量重分布+互斥教学对 101 张 strong_backer 盘的重分类影响面=最大观察点）；S078 盘型桶漂移（strong_backer→blended，fam=none 不触门综合不变）方差观察；追高题退役后追高形状票的实际拦截路径验证（早鸟忌讳+门链承接是否完备）；生产首验待下实验启动。



**背景**：159 点 signals 集第 5 组 16 点（突突车×6（S109-S114）/無為×5（S072-S076）/作茧自缚×5（S091-S095））BP31 重析（poor=14/neutral=2）人工审毕，用户裁定：「無為 是非常典型强庄币啊，第一个点位至少是中等。其它没啥问题」——15 点认同（含突突车 S111/S113/S114 mid 位置硬腿拒、無為/作茧自缚后段 chip_gate 拒=roster 外溢全认），S072 一点翻案目标至少 neutral。

**S072（無為 P1 `0xb97d5772bf70814161d29243b0e39ec62f734444`）state 强庄证据教科书级**：三大户 0.327/0.294/0.245 BNB **全部 t+0s 首买**（开盘即进）+**只买未卖（近 60s 卖压 0.0000）**+开盘段大额单 1 笔+锚前尾段 8 笔 1.137 BNB 涌入——BP27 ①庄时序锚（最早买入有大户）与 BP22 ①零卖出满足路径（大户只买未卖=强庄在场承接条件直接满足）全命中，盘型题已判 strong_backer(1.0)。但**质量题与盘型题独立评估**（材料独立、判读独立——这是三层框架的设计）：早鸟题只见 price_level=low（较发行价 +50~100%）∧ entry=near_high（现/ATH=0% 贴高）∧ maxChg5 过线，忌讳①第二分支「low 档贴高=已拉高」判 poor(0.64) 拖死综合 else_poor(0.54)，错过 1m 峰 +97.2%。

**立法（忌讳①前置庄盘豁免段）**：与 BP23 回调题庄盘豁免同构（判据用 state 材料不引用盘型题答案，保质量题独立性）：**开盘段结构行大额单 ≥1 笔（开盘便有真金大户进场）∧ 持仓前列大买家仍在场（前列有大额买家且未清场；只买未卖零卖出=最强形状）=庄盘语境——庄拉的第一波贴高点位不是接力风险**：强庄最早（次早）进场锁仓拉起的第一波拉升，买点贴着高点也是对倒拉升的早期位置而非散户追高——忌讳①的「价格已不低」前提不坐实（第一分支救位同步放宽一档：near_launch→low 档），按速度外的证据（买家结构/热度/尾段涌入）定档，典型=**庄盘第一波早期至少 neutral**。**边界三界**：①豁免域只到 low 档（较发行价 +50~100%）为止，mid 及以上（+100% 以上）不在豁免范围（与回调题庄盘豁免一档帽同界——庄盘也不追二倍以上的位置）；②豁免只解除忌讳①，不解除②活跃度断流③协同（庄盘断流/协同阵列照常 poor）；③开盘无大额单/大户已清场=非庄盘，照常走①判序。criteria neutral 同步补句。

**对拍（182 定向 6 点）**：

| 点位 | 事实 | BP31 | BP32 | 判定 |
|---|---|---|---|---|
| S072 無為 P1 | 三大户 t+0s+零卖出+尾段 8 笔 1.137 BNB | 早鸟 poor(0.64)/综合 poor(0.54) | 早鸟 **neutral(0.71)**/综合 **neutral(0.71,any_neutral)** | **翻案达成** ✓（前向 1m 峰 +97.2%） |
| S073 無為 P2 | mid 档（+100% 以上） | poor | 早鸟 poor(0.91)/综合 poor(1.00,chip_gate) | mid 界外照拒 ✓（豁免域硬边界+筹码门双拦） |
| S007 SB P2 | 平水票 | poor(0.61) | **poor(0.93)** | 反例守住未误放 ✓（前向 -0.06%） |
| S083 我画地为牢 | famous dominant 盘 | 早鸟 poor(0.55) | 早鸟 neutral(0.61)/综合 **poor(0.99,chip_gate)** | 豁免只在质量题层、筹码门照拦 ✓（前向 5m 末 -43%）多层防线生效 |
| S019 吉祥 | BP23 庄盘语境票 | 早鸟 poor(0.72)/综合 poor | 早鸟 **neutral(0.50)**/综合 **neutral(0.50)** | 豁免波及、前向 5m 峰 +229% 同向（与回调题豁免语义连贯） |
| S006 SB P1 | strong_backer+low | 早鸟 poor(0.68) | 早鸟 poor(0.56) 未翻 | 保守侧留档（前向 +20.6%，Jev 方差内可接受损失） |

**豁免影响域全量摸底（BP22 基线 159 点）**：早鸟 poor 共 31 张，其中 strong_backer 盘 26 张（豁免条件可能命中）、非 strong_backer 仅 3 张（S065/S066 无税人生 blended/S093 TRENCHER blended）；26 张前向收益除 S007 平（-0.06%）/S083 -4.1% 外**全部为正（+5%~+276%）**——「强庄盘=最好类型」语义的实证支撑；S065/S066/S093 三张 blended 票不在豁免判据内（开盘无大额单/大户不在场）不受影响。对拍 6 点 neutral 组 5m 峰均值 +163% vs poor 组 +6.7%——豁免分层与前向高度一致。

**单测**：`_test_buy_point_lib.cjs` 387→**391 断言**全绿（版本 BP32+豁免置顶四句+一档帽句+边界不解除②③句+criteria neutral 同步句）。

**关联留档**：BPA-074（S072 expect neutral，note=强庄证据全链+边界对拍三点）落档（73→74）；commit 00d04f22；第 5 组 16 点收官（roster 外溢扩面——0xfb4e/0x5506 当天连打多盘（無為/作茧自缚/突突车/FIGHT/无税人生）chip_gate 拦截主源全为这对钱包、前向全负（-9~-73%）=用户「其它没啥问题」全认，「famous 掌控一视同仁」豁免口不开维持现状）。

**余留**：S006 保守未翻方差观察；159 点 BP32 全量重抛待用户裁定时机（与 BP31 三改叠加的 159 点重分布）；生产首验待下实验启动。


### BP28 第 4 组 16 点复审三裁定一案四改：S053 三段形状/S055 累计位置硬腿/S064 复数 famous（题集 BP30+BP31，2026-11-06，159 点复审第 4 组）

**背景**：159 点 signals 集第 4 组 16 点（太空逆袭 `0x0cd4cee39ed16ad3e39e3b261dc592648d137777`×5（S053/054/055/057/117）、无税人生 `0xfba95a4e00883f82f04a459b107bd4788e2c4444`×5（S062/063/065/066/068）、FIGHT `0x490da05a44bd886391d48f6cbfb1d7bbc7584444`×2（S064/067）、谷谷本尊/桃豆世界/持械入宋/:-) 各 1）BP29 重析（poor=13/neutral=3）人工审毕，用户三条裁定+13 点认同：「1. cheat 检测中有burst检测，豁免低活跃度，可以搬过来。S053 是中等；2. S055 poor，这个给中等不对吧，涨了 100% 以上了；3. Fight 是 famous 盘，0xfb4e4fa492217d8401aa9e893c78707b61923953 0x550647e8faf10116f0367526080c1005809b4653 这两个著名钱包（加入到著名钱包中），他俩入仓太早了拿的太多，起不来；其它无问题。」

**改一（S053 太空逆袭，activity ⑥反锚三段形状→BP31 尾段三键）**：S053 时序=开局 7s 冲 7 笔→中段 24s 完全静默（无交易期占比 54.5%）→锚前 2s 内 8 笔 0.928 BNB 同块集中涌入（含 0.209/0.219/0.209 三笔 0.2 级），activity=low(0.74) 拦（activity_gate poor 0.68），1min 后 +55.6%。初判「题面缺条款」细查证伪——BP13 已搬⑥反锚+反例样本，真因是**执行缝隙**：「先冲一波后长时间静默（静默在涌入之后）不保护」句被 Jev 读成三段形状不保护（漏看静默之后的尾段涌入）。BP30 补三段形状归属句（静默居中不压档、买点时刻盘面正被激活=中档起判）后**三连跑仍稳定 low**（0.58/0.54/0.61 vs mid 0.39）——纯题面救不动，**真因在 state 时序盲区**：临近段行只有段 totals（8 笔/16 笔每分钟/段内最大间隔 24s），「锚前 2s 涌入」被段 totals 稀释、Jev 结构性看不到（判读锚定「买点时刻即时状态」却无时序原料可判）。**BP31 四改**：snapshot 加锚前尾段三键 `nearTail5{TickN,BuyN,BuyBnb}`（锚前最后 5s 固定子窗行数/买笔数/买额，`BP_TAIL_SEC=5`，BP 侧自算 CD 层零改动）+state 渲染「锚前尾段(最后5秒)」行+⑥句挂尾段行判读锚（多笔且金额可观（参考 ≥3 笔/合计 ≥0.3 BNB 级）=锚点落在涌入波内直接证据；仅 1 笔/尘级=锚点即静默边界——末行 dt=tEnd 恒在窗内尾段最少 1 笔、0 笔数学上不存在）+mapper actNearTail5* 透传。**判尾段行不判段内最大间隔**（临近段最大间隔覆盖整段 30s 测不出涌入在段尾）。

**改二（S055 太空逆袭，早鸟题第三分支·累计位置硬腿）**：S055 现价较发行价 +126.8%（price_level=mid）但 maxChg5=39.38% 未过 +40~50% 速锚线→第二分支不命中→早鸟 neutral(0.36) 综合放行（后 5m 末 -11.6%）。用户裁定「涨了 100% 以上了」——速度锚测不到慢涨（分波缓爬/多段拉升到 mid+ 同样是接力位不是早鸟位）→ 补位置硬腿：**现价较发行价 +100% 以上（mid 及以上）一律 poor 无论 maxChg5 过没过线**；「位置先于速度」在累计维度同样成立，+100% 以内才有「价格低」可谈（low 档维持 BP25 口径）；本腿与第二分支殊途同归 poor。**边界安全验证**：S054 +62.4%/S062 +33%/S063 +71.9% 等用户认同票全在界外零影响；S057 +141.2%/S065 +135.7%/S066 +140.5%/S117 +102.4% 已 poor 方向一致。

**改三（S064 FIGHT，盘型③复数 famous 扩句+roster 收录）**：S064 开盘段 t+7s/t+13s 两著名钱包极早抢筹（0xfb4e…3953 买 0.252+0x5506…4653 买 0.343=合计 0.595 BNB、零卖出、第 2 大占流通 15.8%），BP29 Jev 判 strong_backer neutral(0.72) 放行即 -41.5%。用户裁定「加入到著名钱包中」→ **famous-copy-wallets.json 收录两址**（6→8 址）+③扩句三处（instructions/反锚/criteria）：**两个及以上 famous 钱包极早入场（开盘段内首买）合计拿筹过多（famous 控盘 ≥25~30 且合计绝对额大）同样落③**——famous 抢筹建仓盘，入仓太早拿的是最便宜的筹码、散户盘子起不来（拉升要给 famous 抬轿、famous 一砸就崩）；单个 famous 巨鲸独食原臂保留；单 famous 占比 <25 边缘参与不落③（S062 反例保护——BP29 时 0xfb4e 单钱包 24.4%<25）。

**对拍（182 定向 8 点，BP30 首轮+BP31 复跑）**：

| 点位 | 事实 | BP29 | BP31 终态 | 判定 |
|---|---|---|---|---|
| S053 太空逆袭 P1 | 三段形状（静默 24s+锚前 2s 8 笔 0.928 BNB） | activity low / poor(0.68) | activity **mid** / **neutral(0.62)** | **翻案达成** ✓✓ 三连稳定 0.62/0.59/0.63（BP30 未达成→BP31 尾段锚达成） |
| S054 太空逆袭 P2 | +62.4%、盘面活跃 | neutral(0.43) | neutral(0.44) | 零翻动 ✓（首跑 low=平手 0.41/0.41 argmax 边缘方差，复跑两连 neutral 留档） |
| S055 太空逆袭 P3 | +126.8% mid、maxChg5=39.38% | 早鸟 neutral(0.36) | 早鸟 **poor(0.74)** / 综合 **poor(0.79)** | **翻案达成** ✓ |
| S057 太空逆袭 P4 | +141.2% 死盘 | poor | poor(0.76) | 零翻动 ✓ |
| S062 无税人生 P1 | 0xfb4e/0x5506 控盘 100%/集团买 98.9% | famous none / neutral(0.78) | famous **dominant** / poor(1.00,chip_gate) | **roster 外溢**（见下） |
| S064 FIGHT P1 | 两址 t+7s/t+13s 抢筹 0.595 BNB | strong_backer neutral(0.72) | **famous_monopoly**(0.75) / **poor(1.00,chip_gate)** | **翻案达成** ✓ |
| S067 FIGHT P5 | 同盘死盘回落 | poor(0.98) | famous_monopoly / poor(0.98) | 零翻动 ✓（盘型桶同步翻③方向一致） |
| S117 太空逆袭 P5 | 死盘 | poor(0.97) | poor(0.98) | 零翻动 ✓（盘型桶 blended→strong_backer 漂移留档，门不走 strong_backer 无实质影响） |

**roster 外溢（S062 无税人生）**：0xfb4e/0x5506 在无税人生同样大量持仓——roster 收录后 famous none→dominant(1.0)（famous 控盘 100.0%/跟单集中度 88.8%/集团买入 98.9%/正净持有者仅 7 个），盘型 strong_backer→famous_monopoly(0.75)、综合 neutral(0.78)→poor(1.00, chip_gate)。该票前向 5m 峰 88.6%/15m 峰 257.7%——但 **257% 是 famous 自己拉的**：同一对钱包的另一个盘，「famous 掌控的盘子不参与」（BP14 竹码门立法）语义内；跟它买=给 famous 抬轿、famous 出货时接盘。留档待用户裁定（若认为「盘面极活跃+famous 拉升中」可参与，需另立豁免形状——暂未开口）。

**单测**：`_test_buy_point_lib.cjs` 374→**387 断言**全绿（BP30 三改 6 断言+BP31 四改 7 断言+③门槛既有断言跟随单复数句式+activity 16 键锁）。

**关联留档**：BPA-071（S053 expect neutral，note=三段形状+BP30 题面不达+BP31 尾段锚达成全链）/BPA-072（S055 expect poor，note=累计位置硬腿+边界安全）/BPA-073（S064 expect poor，note=复数 famous+roster 收录+S062 外溢）三锚落档（70→73）；FIGHT 案两址收录后 FA 生产侧 famousCopyWalletCircPct 同步生效（v72/v74 无运行实验，下次启动吃到）；commit 3715a5e5（BP30）+16e8ada0（BP31）。

**余留**：159 点 BP31 全量重抛待用户裁定时机（activity 尾段锚+累计硬腿+复数 famous 三改叠加的 159 点重分布）；S062 外溢豁免形状待裁；S054 平手方差观察；生产首验待下实验启动。



### BP27 ①庄时序锚：S048 阿里美股 散户接力盘误判案（题集 BP29，2026-11-06，159 点复审谷谷组续案）

**背景**：BP26 案对拍汇报「S048 复核反转非翻案目标（0.1984/0.1976 双臂贴线满足→承接分类→零卖出→①strong_backer=判序正确执行）」后用户裁定纠正：**「S048 也不是庄盘，如果你是庄，肯定一开盘最早期买入大额，然后对倒分仓，它是一开始先小散户，然后有稍微大一点的散户接了罢了」**+措辞更正**「应该是最早的买入（至少是次早）得有大户」**——BP28 判序本身没执行错（双臂满足→承接分类），错的是①的判据缺庄时序画像：Jev 把 [WALLETS] 前列 0.198/0.198+卖 0 读作「大户进场+零卖出」判①，但 0.198 达不到大额线（openSeg 大额线 0.3+）。

**S048 时序事实（182 出生段 36 行）**：07:12:18 开局第一秒 5 笔全 0.0329~0.1402 小散铺垫（0.0992/0.0329/0.0992/0.1002/0.1402）→ 07:12:31（13 秒后）才来 0.1985/0.1976 两笔贴线单 → 之后 0.0099/0.0139/0.0010 尘埃+0.1129/0.1032 小散二买；**全程 0.3+ 大额 0 笔**。最早的买入（及次早批次）全无大户=无庄；0.2 级贴线单=「稍微大一点的散户」中途接力。

**改动（①三处+版本 bump BP28→BP29）**：①定义句补庄时序锚——「开盘段结构行大额单 ≥1 笔（**大额=单笔 0.3+ BNB，与开盘段结构行大额线同线；0.19~0.2 BNB 级贴线单是『稍微大一点的散户』不是大额**）∧ **最早的买入（至少次早）得有大户**（庄的行动特征：最早或次早的买入里就有大额（0.3+）、随后才对倒分仓；最早的买入全小散铺垫、之后才来 0.2 级稍大单接盘=散户接力盘不是庄建仓，不走①至多⑤）」；反锚补「**①的时序反锚=最早的买入（至少次早）得有大户**：真庄在最早（至少次早）的买入里就有大额（0.3+）、随后对倒分仓；开局最早的买入全小散铺垫、之后才来 0.19~0.2 级贴线单接盘（『一开始先小散户，然后有稍微大一点的散户接了罢了』）=散户接力盘不是庄建仓，不走①——大户参与双臂满足的按承接分类至多⑤」；criteria strong_backer 同步。**语义分层**：BP28 判序管「有没有大户参与」（双臂），本案管「是不是庄」——0.2 级贴线单双臂满足不落②，但也不构成①的「开盘大额进」；散户接力盘落⑤blended。

**对拍（182 定向 4 点）**：

| 点位 | 事实 | BP28 | BP29 | 判定 |
|---|---|---|---|---|
| S048 阿里美股 | 最早买入 5 笔全 0.03~0.14、13s 后 0.198×2、0.3+ 全程 0 笔 | strong_backer neutral(0.73) | **blended_unremarkable** neutral(0.72) | **翻案达成** ✓ 散户接力盘不走①；综合维持 neutral=BP20 T025（0.198×2）blended 先例路径，用户未裁综合桶 |
| S044 谷谷本尊 | 48 行、开盘最早大额满足 | strong_backer neutral(0.52) | strong_backer neutral(0.48) | 零翻动 ✓ 真庄不受时序锚影响（prob 0.52→0.48 正常方差） |
| S005 SB | 三大户 1.000/0.772/0.303 开盘最早进场 | strong_backer neutral(0.50) | strong_backer neutral(0.50) | 零翻动 ✓ BP21 ①立法票稳定 |
| S016 吉祥A | 庄盘回调票 | blended neutral(0.52) | blended neutral(0.52) | 零翻动 ✓ |

**单测**：`_test_buy_point_lib.cjs` 371→**374 断言**全绿——版本=BP29（描述=S048 案+两裁定原话）；新增 3 断言（①时序锚三句/反锚时序反锚含原话直译/criteria strong_backer 同步）。

**关联留档**：BPA-070 落锚（S048 expect neutral，note 记盘型裁定 strong_backer 错、应 blended）；「最早的买入（至少次早）」的「次早」边界（第二/第三批进场的大额算不算）=贴线观察留档；与 BP26 案同日连环——BP26 管②（参与门）、BP27 管①（庄画像），盘型题三桶判据全链补齐。

**余留**：159 点 BP29 全量重抛待用户裁定时机（strong_backer 101 票重分布=「最早的买入无大户」票应翻⑤/blended）；「次早」边界执行方差观察；生产首验待下实验启动。

### BP26 盘型题大户参与判序前置：S045 谷谷② 灰区单误判案（题集 BP28，2026-11-06，159 点复审谷谷组立法案）

**背景**：用户点名复审「谷谷S045为何给中等？ pvp 盘吧」+「无像样大户参与」。S045=谷谷②（`0xbd74373a464021a15afab2e389bb1451a8477777`，与谷谷本尊 `0x32f18a98…`=S044/S047/S056 **不同 token**——同系列借名发币），锚 14 行（07:08:54-07:09:15 仅 22 秒）：买入 8 钱包 9 笔合计 0.8117 BNB，**最大单笔 0.1568**、0.2 级（≥0.19）钱包 **0 个**、单笔 0.3+ **0 笔**、中位 0.0988、8 全新买家；卖出全为已买钱包小额快进快出。机器判定 blended(0.85)+综合 neutral(0.72)；前向 1min 峰 +0.03% 后一路阴跌 −10→−19% 零反弹——用户②裁定实证。

**成因链（灰区缝隙）**：BP27 题②(a) 判据「前列买入全在 0.1 级及以下尘埃档」与 BP20 硬笔数反锚「0.2 级（≥0.19 视同）钱包 ≥2 个或单笔 0.3+ 不落②」之间存在 **0.1~0.19 灰区**：S045 前列 0.1568/0.1484/0.1090 三笔灰区单既不满足②(a) 字面（不全 ≤0.1）、也不触发双臂「明确不落②」，Jev 在灰区自由裁量被 activity high（22 秒 14 笔≈38 笔/min+8 全新买家+买盘中位 0.0988）带走判 blended(0.85)——「盘面活跃」误当「参与结构健康」。前会话曾把 S048（阿里美股）归为同款灰区，BP28 对拍时复核反转：S048 锚窗 0.19848/0.19760 两笔**均 ≥0.19**=0.2 级钱包恰 2 个→大户参与满足（贴线满足）→走承接分类→卖 0=大户零卖出→①strong_backer 为判序正确执行，**非翻案目标**（教训：归类前须先验锚窗买入分布贴线值，非只看 0.3+ 大额计数）。

**用户裁定原话**：「大户参与不满足是直接 pvp 盘的，满足之后根据承接再次分类」——判序两步：大户参与是前置门，不满足直接②；满足才进承接分类。

**改动（题面三处+版本 bump BP27→BP28）**：①②(a) 判序化——「先判『大户参与』：买入额到 0.2 BNB 级（≥0.19 视同）的钱包 ≥2 个，或单笔 0.3+ BNB 级买入，且买点时刻在场=满足；不满足（前列最大也就 0.1x 级灰区单/尘埃档）→ **直接落②，不再看承接、不看盘面活跃度**——0.1~0.19 灰区单不构成大户参与；小散互捅的盘面再活跃（新买家多、吞吐高、笔密度大）也只是散户 PVP 不是融合盘；满足后才按承接分类（走 (b) 承接轴与①⑤分界）」；②反锚②⑤分界句硬判序化——「全场无任何像样买单才落②」自由裁量句退役，改「大户参与（硬笔数双臂）不满足直接落②……盘面活跃度不救」；③criteria retail_pvp 桶描述同步判序。**兼容性核对**：BP20 正例四票（T052 0.224/0.198/0.247 满足→blended、T017/T013/T025）与 T001 ②(b)（大额满足走承接）、S044 ①路径（开盘大额满足）全不受影响——判序只收紧「双臂不满足」票的去路。

**对拍（182 定向 5 点）**：

| 点位 | 事实 | BP27 基线 | BP28 | 判定 |
|---|---|---|---|---|
| S045 谷谷② | 最大 0.1568、0.2 级 0 个、0.3+ 0 笔 | blended(0.85) neutral(0.72) | **retail_pvp poor(0.81,pattern_gate)** | **翻案达成** ✓ 判序前置直接②，activity high 不再救；前向 −19% 零反弹实证 |
| S044 谷谷本尊 | 48 行、开盘大额满足 | strong_backer neutral(0.52) | strong_backer neutral(0.52) | 零翻动 ✓ 大户参与满足走原路径 |
| S018 吉祥B | 大户在场+承接 0.1~0.2 档 | blended neutral(0.79) | blended neutral(0.79) | 零翻动 ✓ |
| S038 VirusSI | 持续卖+持续承接 | blended neutral(0.71) | blended poor(0.51,chip_gate) | 盘型零翻动 ✓ 综合 chip_gate=BP27 已留档贴线筹码方差（holder moderate↔strong），非 BP28 语义 |
| S048 阿里美股 | 0.1984/0.1976 均 ≥0.19=2 个 0.2 级钱包 | blended(0.67) neutral(0.74) | **strong_backer** neutral(0.73) | **非翻案目标**（复核反转）：双臂之一满足→承接分类→零卖出→①=判序正确执行；贴线满足（0.1976 距线 +4%）留观察 |

**单测**：`_test_buy_point_lib.cjs` 366→**371 断言**全绿——版本=BP28（描述=S045 案+裁定原话）；新增 5 断言（②(a) 判序前置声明/双臂+直接落②/活跃度不救+承接后置/反锚判序化/criteria retail_pvp 同步）；BP19 双臂断言语义迁移（「全场无任何像样买单」句已退役，双臂文本保留为前置门判据）。

**关联留档**：S048 贴线满足（0.1976/0.19 线 +4%）=双臂边界第二例观察（首例 T008 单笔 0.2 级 BP20 收口），攒批；BPA-069 落锚（S045 expect poor，model BP27 blended 0.85 错放原值留档）；灰区成因归档=「activity high ≠ 参与结构健康」——活跃度题与盘型题判据正交，判序前置后活跃度不再能为灰区单背书。

**余留**：159 点 BP28 全量重抛待用户裁定时机（灰区单票重分布）；S048 类贴线满足票的「0.19~0.2 视同线」执行方差观察；生产首验待下实验启动。

### BP25 price_level low 档收窄+庄盘豁免一档帽：S043 高点接盘案（题集 BP27，2026-11-06，159 点复审第 5 批立法案）

**背景**：第 5 批复审（S041-S050）起工作流改**按代币分组审**（用户裁定「同一个代币的点放在一起审吧」——set 内 ≥3 点 token 共 21 个，先报下组代币名单→补齐该 token set 内全部点位→分组出表）。首组=VirusSI `0x92e56dabe394a5fde578ab2f65f72cec9ff07777`（set 内 6 点：S037-S040 出生段 85 秒四连点 + S043/S058 成熟段）。出生段四点前向 15min +149~+231% 全大肉（S038/S040 大户持续卖+承接=BP24 三分①正命中），**成熟段 S043（P5=N30 纯热度臂触发，出生 15min 后）BP26 判 neutral(0.69) 放行、前向 15min 末 −31.07% 高点接盘**——用户裁定原话「S043 是poor，高点接盘了呀」。

**成因链完整还原（S043 neutral(0.69) 判读路径）**：回调场景成立（currentVsAthPct −22.97%/secSinceAth 84s/entry shallow_pullback(1.00)/tree right_side）→ 第二层核心规则价格条件不满足（+154.7% 非 near_launch）**但 BP23 庄盘豁免救活**（openSegBigBuyN=1 ∧ 开盘单笔 1.55 BNB ∧ bigHolderSellBnb60=0 卖压归零）→ 价格条件放宽至 +155% 高位 → 第三层忌讳②「没跌到位」本该拒但被豁免解除（其余忌讳全不过：maxChg5 18.4%<40%/Δh60 +12/sameBlock 13.9%）。**假庄盘反证**（豁免材料在场且被消费才是成因，锚窗=行数窗从出生覆盖 spanSec=1001s 含开盘段、openSeg 七键全有值）：chipTop1HoldCircPct 仅 4.0%（真庄对照 HAUL T005=39.6%/정책콕 T001=50.4%）、chipPosHolderCount 170 分散、exitSellerCount60=14 清仓成批——「卖压归零」是**卖完了不是没卖**（BP26 三分②形状，豁免判据没做这个区分）。单笔 1.55 开盘大额=庄证据太弱（真庄 SB 三笔 1.0/0.77/0.30）。

**用户裁定（两改同启）**：原话「庄盘，价格要求只是豁免一个档位。这里low这个档位我认为太高了，这个应该是最低价的三倍了，我认为low，应该是较发行价 50%-100%，100% 以上应该只有非常少的情况才入，暂时还没有开这个口。」——不走「豁免补庄持仓证据腿」路线，从 price_level 档位层根治。

**三改（题面三处+版本 bump BP26→BP27）**：

1. **low 档收窄**：price_level 分界 +50~200%→**+50~100%**（mid +200~600%→+100~600%）；形状样本偏低=+80%、criteria low=约 +50~100%（1.5~2 倍）；反锚④新增「较发行价 >+100%（2 倍以上）=已明显脱离发行价区——正常路径不构成『价格低』的可参与证据，+100% 以上的位置只有非常少的情况才可参与，此类豁免口暂未开设」。
2. **庄盘豁免一档帽**：核心规则价格条件放宽「但只放宽一个档位：从 near_launch 放宽到 low 档（较发行价 +50~100%）为止，+100% 以上（price_level=mid 及以上）不在豁免范围（庄盘也不追二倍以上的位置——下跌的坑是好东西，但坑要够深；高位浅回调对庄盘同样没跌到位）」→ low 档内的浅回调位同样 neutral。
3. **忌讳② mid+ 一律句**：「price_level=mid 及以上（较发行价 >+100%）的浅回调一律没跌到位（+100% 以上不开口：高位浅回调没有可参与路径，庄盘豁免也不覆盖）」。

**对拍（182 定向 5 点，真调 Jev）**：

| 点位 | 价格位 | BP26 基线 | BP27 | 判定 |
|---|---|---|---|---|
| **S043** VirusSI | +155% mid | neutral(0.69, any_neutral) 回调 neutral | **poor(0.71, else_poor)** 回调 poor(0.71) | **翻案达成** ✓（豁免不适用+忌讳②拒；前向 15min 末 −31.07%） |
| S018 吉祥B | +26% near_launch | neutral(0.73) | neutral(0.75) | 零翻动 ✓（BP23 豁免正例，near_launch 路径内） |
| S040 VirusSI | −0% near_launch | neutral 回调 0.58 | neutral(0.57) 回调 0.57 | 零翻动 ✓（豁免路径内） |
| S044 谷谷 | +78% low | neutral 0.54 | neutral(0.51) | 零翻动 ✓（落新 low 档 +50~100% 内不受收窄影响——改前预核判断实证） |
| S038 VirusSI | +9% near_launch | neutral(0.71) holder moderate(0.5) | poor(0.54, chip_gate) holder strong | **Jev 方差非 BP27 语义**留档：BP27 未动 holder 题/筹码门，moderate(0.5)↔strong 跨线摆动；同票 S039 基线本就 strong(0.56)·chip_gate 拦=筹码集中贴线票，S038 早鸟题仍 neutral(0.65) |

**单测**：`_test_buy_point_lib.cjs` 362→**366 断言**全绿——版本=BP27（描述=S043 案+两裁定原话）；新增 4 断言（low 档收窄句/反锚④不开口句/一档帽句「但只放宽一个档位」+「庄盘也不追二倍以上的位置」/忌讳② mid+ 一律句）；旧断言 619 行庄盘豁免文本匹配同步（`稍高的浅回调位同样 neutral`→`low 档内的浅回调位同样 neutral`）。

**关联留档**：S032（utility，+55%）庄盘豁免外溢第一例落新 low 档 +50~100% 内**不受 BP27 影响**维持可豁免，留档；BPA-068 落锚（expect poor，model BP26 neutral/0.69 错放原值留档）；「豁免补庄持仓证据腿」（chipTop1HoldCircPct 低值反证假庄盘）候选方向未采纳、攒批观察。

**余留**：159 点 BP27 全量重抛待用户裁定时机（+100~200% 区间票 low→mid 重分布+S038 贴线筹码方差观察）；生产首验待下实验启动。

### BP24 大户持续卖+持续承接=混合盘轴：VirusSI 案三改（题集 BP24→BP25→BP26，2026-11-06，159 点 signals 集复审第 4 批立法案）

**背景**：第 4 批（S031-S040）复审，VirusSI `0x92e56dabe394a5fde578ab2f65f72cec9ff07777` 四连点（P1-P4，06:49-06:51 两分钟内）前向 15m 全部 +148~231%，但 P2/P3 判 retail_pvp 拒（P3 另有 hold=strong 筹码门拒）——用户裁定「大户离场后，持续有承接，盘面较强，可以给判为混合盘。这个币部分点位判为 PVP 有点不合适」立项。

**三改过程（一轴三版本，判据逐轮锐化）**：

- **BP24 初版（离场后承接）**：大户已离场后承接持续（买盘/holders 流入）+盘面较强 → ⑤。对拍：S039 翻 blended ✓；**反例 T001 정책콕（BP21 立法案票）被误翻 blended**——其锚窗材料完全符合初版判据（d60=+8、新买家 10/11、买卖比 20:1、贴发行价），BP21/BP24 两裁定在该形状正面冲突，用户消解。
- **BP25 二版（卖压消化过程性）**：用户消解裁定原话「如果大户离场后，一波散户接了没下文了，我倾向认为是 PVP，如果大户持续卖，持有有接盘者，无论是散户还是什么，我倾向于混合盘」——判据改**卖方在场性**：大户卖出仍在进行（bigSell60 >0）∧ 承接持续（身份不限）→ ⑤；大户卖完离场+散户一波接没下文 → ②。实证锚完美自洽：VirusSI P2/P3/P4 bigSell60=0.48/0.83/1.00（持续卖）vs T001 bigSell60=0+exitSellers=3（卖完）。对拍：**S038 翻 blended+neutral 0.72 ✓**（P2 错杀 +204% 翻案）、S039 维持 ✓；**T001 仍 blended(0.41) 未回②**——触发时散户承接正处高潮，Jev 被「承接活跃」带走，而「一波接没下文」是前向结局（1min max +5.77% 后 −20%、实际成交亏 −23%）锚窗内不可见。
- **BP26 三版（卖方在场性优先三分）**：判序改卖方状态三分——①卖压行 >0 持续卖+承接持续 → ⑤；②卖压归零 ∧ 清仓式卖出成批/前列走空+承接只剩散户 → ②(b)（**「一波接没下文」是这种结构的必然结局、不是锚窗内可见的状态——判结构不判承接当下的活跃度**）；③卖压归零但前列大买家在场持有未卖 → 走 BP23 在场承接路径不落②（中间档原路径保护）。

**对拍（182 定向，真调 Jev，BP26 终版 5 点）**：

| 点位 | 卖方材料 | BP23 | BP26 终版 | 判定 |
|---|---|---|---|---|
| S037 VirusSI P1 | bigSell=0/exit=0（无卖压，超活跃） | neutral(0.59) strong_backer | **neutral(0.64)** strong_backer(0.70) | ✓零影响 |
| S038 VirusSI P2 锚19 | **bigSell=0.48 持续卖**+d60=+15 | poor(0.52,pattern_gate) retail_pvp | **neutral(0.71)** **blended(0.54)** | ✓✓翻案（BPA-066 主案点，+204% 错杀） |
| S039 VirusSI P3 锚30 | **bigSell=0.83 持续卖**+d60=+21 | poor(0.53,chip_gate) retail_pvp | poor(0.56,chip_gate) **blended(0.74)** | ✓盘型翻案；综合 hold=strong 筹码门独立拒（BP14 立法不动） |
| S018 吉祥B 锚14 | bigSell=0.28（③在场路径保护区） | neutral(0.78) blended | **neutral(0.73)** blended(0.81) | ✓中间档反例稳定（BP23 翻案票不被三改回翻） |
| T001 정책콕 锚26 | bigSell=0+exit=3+**top1 持流通 50.4% 在场** | poor(0.57,pattern_gate) retail_pvp（BP21 对拍） | poor(0.51,chip_gate) **blended(0.48)** | ✗盘型未回②——见分歧收口 |

**T001 分歧收口（锚窗信息 vs 后见裁定合理分歧，BP11 SB 案同款先例）**：锚窗内 T001 top1 持流通 50.4%（巨鲸在场未走、top1SellPct60=76% 但绝对额 ~0.017 BNB 尘级微卖）+散户承接正处高潮——②(b) 两要件（前列无像样买方）与「卖完离场」（50% 在场）在锚窗内**均不成立**，BP24-BP26 三轮 Jev 稳定判 blended（0.33→0.41→0.48）；用户「PVP」判读由前向结局（−20%）支撑=后见，锚窗内不可见。**处置=接受现状不硬掰**（第四改边际收益存疑+BP11「题面改锚分不动」教训）：综合防线移交筹码门——top1 50.4% 单一 >45% 过线坐实 strong、chip_gate 拒，50% 独食巨鲸在场本身即拒买理由，比盘型门更本质；锚 BPA-067 落档（expect 盘型 retail_pvp 留意图、综合 poor 达成）。

**锚点**：BPA-066（VirusSI S038 expect neutral+blended，note 带 S039/S040 同裁定与 bigSell 实证）/BPA-067（T001 分歧留档）两枚已落 `scripts/buy-point/data/manual-anchors.json`。

**单测**：`_test_buy_point_lib.cjs` 360→**362 断言**全绿——版本=BP26（三改过程全录）；卖方在场性三分两断言（「必然结局判结构不看承接当下活跃度」/「①持续卖⑤②卖完走③在场未卖看承接档位」立法锁定）。

**余留**：159 点 BP26 全量重抛对拍（VirusSI 形状全集分布+retail_pvp 30 点重分布+S032 庄盘豁免外溢面复核）；题集=BP24 案三版本演进已录题集版本演进表；生产首验待下实验启动。

### BP23 两轴立法：回调题庄盘豁免+盘型题②(b) 承接收窄（题集 BP23，2026-11-06，159 点 signals 集复审第 2-3 批立法案；题集=案号对齐）

**背景**：测试集换 signals 触发源（`bp-2026-11-06-v73-signals`，159 点/70 token，P6 盲买腿 1056 点剔除）BP22 全量重抛（good=0/neutral=32/poor=127）后逐批页面复审。第 2 批（S016/S018「为啥 poor」两问）+第 3 批（S021 5min 峰 +215.98% 全集最大错杀、吉祥A 四点全拒）暴露两轴系统性分歧——用户裁定「非常明显的问题了」并直接立法。

**轴①回调题庄盘豁免**（三案票：SB S005 `0x92aac04f03278ce7ac82ba0367dbaf9686437777` 锚 27 / 吉祥A S016 `0x4aac4818c1f71a7dbe9967498e65ba60d3b17777` 锚 15 / 吉祥B S021 `0xea7886d590ba1d7d6d4e7761148ba26405c67777` 锚 56，三票盘型 BP22 均已判 strong_backer）：

- 用户裁定原话①「S016 为庄盘，它的逻辑不一样，既然认为它是庄盘，下跌的坑是好东西」；②（立法中追加）「如果是庄盘，加仓范围比普通盘要宽一些，不仅仅是临近购买点，稍微高一点也可以」
- 题面（回调题第三层忌讳清单前插豁免段）：开盘段结构行大额单 ≥1 笔 ∧ 持仓前列大买家未清场=庄盘语境——忌讳①崩塌/②没跌到位**均不适用**，且核心规则「价格跌到很低」条件**同步放宽**（庄在场+盘面仍活即可，不要求 near_launch）→ 庄盘回落位/稍高的浅回调位**均 neutral**，急砸后买盘回流/holder 稳定可 good；**豁免只解除①②不解除③奔零④断流⑤协同**（庄盘阴跌失血/断流/协同照判 poor）；判据用开盘段结构行/持仓前列 state 材料**不引用盘型题答案**（质量题/维度题并行独立性不破坏）；忌讳①句内加豁免回指；非庄盘（开盘无大额/大户已清场）照常忌讳清单
- 与 BP11「先接受现状」终裁的关系：S016/S021 正是 maxChg5 过线（41.04）+浅回调形状（BP11 案十轮 Jev 稳定 poor 两明裁接受）——庄盘豁免=该形状的**语境化解**：非庄盘票照旧 poor（BP11 终裁不被推翻），庄盘票豁免翻案

**轴②盘型题②(b) 承接收窄**（吉祥B S018 `0xea7886d590ba1d7d6d4e7761148ba26405c67777` 锚 14，BPA-001 standing 锚 token，早鸟题与用户旧裁同向 0.76/0.78 唯一压死=盘型门）：

- 用户裁定原话「S018 有大户参与，且承接不是零散小散户（有大量零散小散户的可以明显看出来），至少也是混合盘，不是 PVP 盘」
- 题面：②(b) 更名「大户卖出、零散小散承接」+落桶须**「一眼可辨的大量小散单」两要件缺一不落②**——①买盘中位尘埃级（0.0x 级，不是 0.1 级常见交易档）②买点时刻前列再无任何像样买方；**大户在场参与 ∧ 承接单 0.1~0.2 BNB 级常见交易档（中位 0.1 级）→ 不落②至少⑤融合盘**（承接 0.2~0.3+ 像样级走①）；①②分界反锚补承接中间档；retail_pvp criteria 同步。S018 判读事实（上批深挖）：大户 0.998 买/0.279 卖在场、纯卖方 0.274 占卖 49.5%、承接中位 0.11+0.198/0.160 级单——정책콕 T001（BP21 立法案票）中位 0.02 才是「零散小散」形状，方法论锚「大量零散小散户可明显看出来」
- BP19/BP20 硬笔数刀口（②(a) 仅一笔 0.2 级凑不成多笔仍落②）**刻意不动**——S018 走②(b) 路径非②(a)，用户未翻②(a) 的线

**锚点**：BPA-063（S005 expect neutral）/BPA-064（S016 expect neutral「庄盘下跌坑是好东西」）/BPA-065（S018 expect neutral「盘型应 blended+零散小散判读方法论锚」）三枚 kind='signal' 锚已先行落 `scripts/buy-point/data/manual-anchors.json`（commit d470a600，立法前落锚）。

**对拍（182 定向 8 点，commit 1b959862，真调 Jev）**——翻案 4/4 达成+反例 4/4 零翻动：

| 点位 | BP22 | BP23 | 判定 |
|---|---|---|---|
| S005 SB 锚27 | poor(0.76,else_poor) 回调 poor(0.76) | **neutral(0.49,any_neutral)** 回调 neutral(0.49) | ✓翻案（BPA-063） |
| S016 吉祥A 锚15 | poor(0.66,else_poor) 回调 poor(0.66) | **neutral(0.58,any_neutral)** 回调 neutral(0.58) | ✓翻案（BPA-064） |
| S018 吉祥B 锚14 | poor(0.69,pattern_gate) 盘型 retail_pvp | **neutral(0.78,any_neutral)** 盘型 **blended_unremarkable**+早鸟 0.78 维持 | ✓翻案（BPA-065；「至少混合盘」原话精准命中） |
| S021 吉祥B 锚56 | poor(0.87,else_poor) 回调 poor(0.87) | **neutral(0.48,any_neutral)** 回调 neutral(0.48) | ✓翻案（5min 峰 +215.98% 最大错杀） |
| S023 币股人生 锚96 | poor(0.91,activity_gate) | poor(0.92,activity_gate) 维持 | ✓零翻动（盘型 retail_pvp→blended=收窄外溢，activity_gate 先裁仍拒） |
| S026 吉祥A 锚134 | poor(0.77,activity_gate) | poor(0.75,activity_gate) 维持 回调 poor(0.41) | ✓零翻动（庄盘豁免不解除④断流——活跃 low 照拒） |
| S027 ZELDA 锚15 | neutral(0.69,any_neutral) | neutral(0.71,any_neutral) 维持 | ✓零翻动（方差内） |
| S030 VND 锚2·thin | poor(0.90,activity_gate) | poor(0.90,activity_gate) 维持 | ✓零翻动（thin sniper 拒干净） |

**外溢观察**：S023 盘型 retail_pvp→blended=②(b) 收窄自然外溢（新两要件下其承接不达「一眼可辨小散堆」）——结果仍拒且方向与 S018 一致属设计内；retail_pvp 全集 30 点的盘型分布变化待全量重抛观察。

**单测**：`_test_buy_point_lib.cjs` 353→**360 断言**全绿——F 组版本=BP23；庄盘豁免四断言（置顶/价格条件放宽「稍高也可以」/豁免边界只解除①②/忌讳①回指）+②(b) 收窄两断言（一眼可辨两要件缺一不落/至少⑤+承接中间档）。

**余留**：159 点 BP23 全量重抛对拍（攒批翻案面外溢观察+盘型分布）；159 点复审从第 3 批起继续推进；庄盘豁免生产首验（v74 等下实验重启后）。

### BP21 ①②分界「大户卖出后的承接结构」轴：정책콕/SB 两案→零卖出缺口两改（题集 BP21→BP22，2026-11-06，53 点复审第 1 批立法案）

**案由**：53 票挨个复审第 1 批（T001~T010）页面复核后用户两案裁定+一问：**「정책콕 不是庄盘，大户卖出后，承接大户卖量的，是一堆很小的散户，最终这个是 pvp 盘。看看怎么改；SB 是庄盘，开盘明显大户，且大户卖出有承接；还有一个问题，你现在跑的结果，是信号触发的时候，还是成交时候的点位？」**。

**锚口径答（一并留档）**：trades 源锚=**成交时刻**——`buildTradePoints` 造点 `created_at: r.executed_at || r.created_at`（trade 行成交时间优先），锚窗截行、Jev state、前向收益起算全部锚成交时刻；run 输出「信号=」是 provenance 展示字段（信号 fire 时刻），fire→成交一般差亚秒。

**两案数据形状（182 BP18 prompt 核验，与裁定完全对上）**：

| 票 | 开盘段 | 大户动向 | 承接方 | 用户裁 | 机器 BP20 |
|---|---|---|---|---|---|
| 정책콕 T001 0x9d14…7777 | 2 笔大额 1.003（第 1 大买 0.605@t+0 占流通 50.4%） | 卖 0.251 | 买盘中位 **0.02**、第 2/3 大只买 0.100/0.101——小散堆接 | ②pvp | strong_backer(0.6)·neutral ❌ |
| SB T003 0x92aa…7777 | 7 笔大额 4.055（1.000/0.772/0.303 三大户） | 卖 0.378/0.512 | 卖 6.56×54 全被接走、吞吐 37 BNB/分、买盘中位 **0.13** | ①庄盘 | blended(0.76)·poor ❌ |

缺口=①②分界没有「大户卖出后的承接结构」轴：정책콕 开盘段大额单 >0 使②（全场无像样买单）结构性不可达、①「盘面仍有交易」又太松（小散堆接也算活）→ 落①；SB ①「价格未被拉爆」把垂直脉冲形状挡在①外 → 落⑤。

**第一改（BP21，commit 114a7311）题面四处**：①「此后盘面仍有交易」收紧为「**大户卖出后有像样的承接**——大持仓者卖出时接盘的是 0.2~0.3+ BNB 级像样买盘（卖出被像样单接走=筹码对倒换手、流动性在场）」+「价格未被拉爆」降为典型形状**不再排除①**（拉高对倒也是庄的行为，定类看承接结构不看价格高度——开盘明显大户+大户卖出有像样承接=庄盘即便价格已被拉过一波=SB 案）；②改双形状——(a) 从来无像样买单（原 BP20 硬笔数句原文保留）+(b) **大户卖出、散户承接**（开盘段大额单 >0 不自动排除②：大户向小散出货、承接卖量的全是 0.0x~0.1 级零散单、买盘中位尘埃级、买点时刻前列再无像样买方=盘面散户化=정책콕 案）；反锚头新增①②分界轴「**大户卖出后谁在接**」（像样单接=①对倒/小散堆接=②，「卖出量级不小但接盘的全是小单」是②(b) 铁形状）+「多笔不落②」补前提=**像样买方买点时刻仍在场**（大额买单主人已卖离场、接盘全小散不适用走②(b)）；「怎么算」补卖压行（近 60s 卖出额/清仓式钱包——大户卖出动向与承接方量级对照）。

**第一改定向重抛 17 票**（两裁定票+①桶全部 8+②桶全部 8 防误翻；blended 27 票不动=留给复审逐批）：**两裁定全达成+外溢 8 票全部正当翻+1 实现缺陷**：

| 票 | BP20→BP21 | 判读 | 综合桶变化 |
|---|---|---|---|
| T001 정책콕 | strong_backer→**retail_pvp** ✓ | (b) 形状命中 | neutral→**poor·pattern_gate**（5min 末 −20.6% 方向对） |
| T003 SB | blended→**strong_backer** ✓ | 价格腿降级生效 | poor·else_poor 不变（①不拦、点位归质量题——eb poor 0.46/pb poor 0.92 拒对，5min 末 −50.1%） |
| T045/T046 雪球SI | strong_backer→**retail_pvp** | (b) 正当翻：第 1 大买 1.300 卖 1.247（top5 近 60s 卖 1.247）、承接买盘中位 0.075 小额档 | neutral→**poor·pattern_gate** ×2（5min 末 −32.9%/−31.1% 方向对） |
| T047 作茧自缚二/T049 Lily | strong_backer→**retail_pvp** | (b) 正当翻：T047 近 60s 卖 1.036×8 清仓式 7 个；**恰为 BP16 大户清场校准组**——新轴把当年回调题翻案组在盘型维度同向收编 | T047 同拒（拒因 else_poor→pattern_gate）；T049 neutral→**poor·pattern_gate**（5min 末 −4.7%） |
| T010/T019/T023/T027 | retail_pvp→**blended** | **硬笔数规则一致化**（前列多笔 0.2 级本就不落②：T010 0.200+0.198、T019/T023 0.247×2+0.238、T027 0.230/0.209/0.219——BP20 判②是漏网非裁定） | **综合桶四票零变化**（activity_gate/else_poor 同拒，门方向无实质松动） |
| T005 HAUL | strong_backer→blended | **实现缺陷**：第 1 大买 0.350@t+0 零卖出持有 39.6%（卖压行 0.0000×0）被「卖出后承接」卡死无证据可评 | 综合桶不变（activity_gate 0.89 拦）→触发第二改 |
| T051 FLAP 突突车 | strong_backer 稳 | pattern 稳① | poor→neutral→复验回 poor=**早鸟题方差尖峰**（eb insufficient(0.35)↔neutral(0.34) 刀口摆动，非 BP21 效果——BP21 只动 market_pattern 题） |
| T006/T007/T008/T016/T022 | 全稳 | — | 全稳（同门同拒） |

**第二改（BP22，commit ced3e256）零卖出满足路径**：①追加「**大户尚未卖出（卖压行近 60s 卖出 0、持仓前列只买未卖）=强庄仍在场持有，承接条件直接满足**——卖出承接只在大户已卖出时才须评，大户零卖出而盘面仍活的照常落①」。**182 复验 4 票 4/4**：T005 blended→**strong_backer** ✓（综合 activity_gate 0.89 拦=BP20 同款零变化）、T016 ①稳、T045 ②(b) 稳（pattern_gate 复拦 0.65）、T051 综合回 poor·else_poor 0.82（方差尖峰确认）。

**净效果**：17 票=收紧 +4（T001/T045/T046/T049 neutral→poor，5min 末 −4.7%~−33% 方向全对）+正当收编 4（BP16 组+硬笔数漏网 4 票综合零变化）+零卖出修复 1+方差尖峰 1（复验回基线）；门方向无一处错误松动。**锚影响**：无（BPA 无这批票的 expect 变更需求——T001/T003 无独立锚，T045/T046/T049 属 BP16 翻案组锚本就 poor 语义）。**余留**：blended 27 票未重抛（复审第 2 批起逐批 BP22 重抛展示）；T051 早鸟题 insufficient↔neutral 刀口方差攒批观察。

### BP19 ②⑤边界修正：多笔 0.2 级双臂→硬笔数两改（题集 BP19→BP20，2026-11-06，BP18 盘型门 8 票人工复核立法案）

**案由**：BP18 全量重抛盘型门新拦 8 票，用户逐票复核（7 页 token-ticks 叠画）后裁定：**「突突车，我不认同啊，买入点位之前有 3 个 0.2 BNB 左右的买入呢。其它都没问题」**——T052 前列=0.224/0.198/0.247 三笔 0.2 级在场却被判 retail_pvp 拒；其余 7 票（币股人生×2/ZELDA/긴와/KIBI/谷谷/阿里美股中除 T052 外的盘型拒）全部认同。经 AskUserQuestion 带八票前列数据确认边界：**多笔 0.2 BNB 级左右（≥2~3 笔）=不落②**（突突车/KIBI/ZELDA/阿里美股一起翻出②重抛验证；谷谷/币股人生 0.2 级笔数不足维持②拒）。

**第一改（BP19，commit fbe12803）**：②描述句「没有任何大户参与（无一笔到 0.3 BNB 级）」→「没有任何像样的买单（既无单笔 0.3+ 大额、也无多笔 0.2 BNB 级左右的像样买入）」；②⑤反锚句「全场无任何真金大额才落②——前列只要有 0.3+ 买家就不属纯散户 PVP」→「全场无任何像样买单才落②——前列只要有多笔 0.2 BNB 级左右的买入（≥2~3 笔）或单笔 0.3+ 买家就不属纯散户 PVP」；criteria 同步；BPA-061 긴와 expect neutral→poor 落锚（「其它都没问题」=sniper 拒认同，回调核心规则命中的中性点位评估被盘型背景否决——盘型先于点位质量）。

**第一改重抛翻车（宽松执行）**：182 定向 7 票——T052/T017/T013/T025 翻出②→blended·neutral ✓、T022 维持② ✓，**但 T006/T008（各仅一笔 0.200+若干 0.1 级）也被判 blended(0.63/0.43) 翻出②**；复验一次稳定 blended 非方差=Jev 把「恰好一笔 0.2 级」当成了有像样买单，与裁定「多笔 ≥2~3 笔」相悖（对照 T022 零笔 0.2 级判②：Jev 内部分界线落在「有无 0.2」而非「笔数」）。

**第二改（BP20，commit ca7b0bbd）硬笔数句**：反锚句追加「**『多笔』是硬笔数**——买入额到 0.2 BNB 级（≥0.19 BNB 视同 0.2 级左右）的钱包须 ≥2 个，**仅一笔 0.2 级+其余全 0.1 级及以下=凑不成多笔仍落②**（单笔 0.2 不构成大户参与）」；②描述句与 criteria 同步补「仅一笔 0.2 级凑不成多笔」。**0.19 线设计**：对拍 8 票全复现裁定——T052(0.224/0.198/0.247)/T017(0.247×2/0.238)/T013(0.246/0.217/0.298)/T025(0.198×2) ≥2 笔过线不落②；T006/T008 仅 1 笔过线、T022 零笔过线=落②（0.148/0.157 不入 0.2 级、0.198 入——数值线写死防 Jev「级左右」弹性）。

**第二改重拍（7/7 全对齐）**：

| 点 | 代币 | 前列 0.2 级笔数(≥0.19) | BP18 | BP19 | BP20 | 裁定预期 |
|---|---|---|---|---|---|---|
| BP-T052 | 突突车 0x78cd…7777 | 3 笔 | retail_pvp 拒 | blended neutral ✓ | blended(0.90) neutral ✓ | 翻出② |
| BP-T017 | KIBI 0x9fb4…7777 | 3 笔 | retail_pvp 拒 | blended neutral ✓ | blended(0.93) neutral ✓ | 翻出② |
| BP-T013 | ZELDA 0x3ca2…7777 | 3 笔 | retail_pvp 拒 | blended neutral ✓ | blended(0.86) neutral ✓ | 翻出② |
| BP-T025 | 阿里美股 0x9914…7777 | 2 笔(0.198×2) | retail_pvp 拒 | blended neutral ✓ | blended(0.82) neutral ✓ | 翻出② |
| BP-T006 | 币股人生 0x80b3…7777 | 1 笔(0.200) | retail_pvp 拒 | blended ✗宽松 | retail_pvp(0.62) poor·pattern_gate ✓ | 维持②拒 |
| BP-T008 | 币股人生 0x80b3…7777 | 1 笔(0.200) | retail_pvp 拒 | blended ✗宽松 | retail_pvp(0.76) poor·pattern_gate ✓ | 维持②拒 |
| BP-T022 | 谷谷 0xbd74…7777 | 0 笔 | retail_pvp 拒 | retail_pvp ✓ | retail_pvp(0.57) poor·pattern_gate ✓ | 维持②拒 |

**门方向×结局交叉验证（7/7 一致）**：翻出②四票有肉——T052 +5min 峰 +448.7%/末 +317.4% ep+0.0007 实赚（用户不认同拒买完全正确）、T017 +15min 峰 +24.6%、T013/T025 +1min 峰 +9/+11%；维持②拒三票全跌——T006/T022 +15min 末 −19%、T008 −19%（②「涨跌全靠散户情绪流动性说没就没」题面语义与结局同向）。

**锚影响**：BPA-059 突突车 expect=neutral（BP20 后重新对上）；BPA-061 긴와 expect 已改 poor；币股人生 T006/T008 无独立锚（BPA-057 突突车一是同 token 不同点、无关）。

**余留**：①「≥0.19 视同 0.2 级」数值线为 8 票对拍设计值，更长尾形状（0.18/0.19 边缘、0.2 级笔数 2 vs 3）攒批观察 Jev 执行；②盘型门 8 票中 긴와 T014（sniper 桶）用户认同维持 BP18 判定（BPA-061 已改判落锚），53 点分布中其余 sniper 3/monopoly 2 票非新拦（此前已 poor）不在本案范围。

### BP18 盘面分类锚：五类型学维度题+盘型门+开盘段结构锚族——53 点全量重抛对拍（2026-11-06，53 点复审收官立法案；题集 BP18=案号 BP18 对齐）

**案由**：53 点复审收官（62 锚封箱，BPA-060/061/062 落锚 T053/T014/T015）后用户立法：**「请帮忙增加盘面分类锚，这个锚增加以后，我估计一些买入点位的结论也要调整一下（有一部分点位认为没有拒绝的理由即使损失也接受了中等，但可能为 poor）。增加了以后，请把 53 点全部再次抛一遍」**——五类型学原话直译入题面（见版本演进表 BP18 行五桶语义）。

**落码（commit 6706e1f5，四文件+单测+锚）**：题面（market_pattern 五桶+怎么算五源+反锚三界+材料不足按⑤）/mapper（pattern_gate 门链第三道+MARKET_PATTERN_LEVELS/PATTERN_GATE_POOR_BUCKETS 常量+openSeg 七键透传）/snapshot（openSeg 锚族：开盘段=dt<30s、大额线 0.3 BNB 与 BP16 大户判据同线、截窗未覆盖开盘段（首行 dt>90 同 launchCovered 判据）全族 null）/state（开盘段结构行——①「开盘大额进」vs ④「开局抢完即衰竭」的直接数值判据；判定指引②c）。设计决策：①强庄「最好类型」第一版纯不拦不直接给 good（点位质量仍归三质量题，控制变量）；盘型与筹码门重叠票 rule 留痕 chip_gate（阈值硬线优先）。

**182 全量 53 点重抛（bp-2026-11-05-v73-trades，真调 Jev，用户放行）对拍基线=BP15 全量+BP16/17 定向覆盖合并**：

- **盘型分布**：blended_unremarkable 27 / retail_pvp 12 / strong_backer 8 / early_sniper_decay 4 / famous_monopoly 2。
- **桶分布**：poor 34→43、neutral 19→10（good 恒 0）；翻动 15/53。
- **盘型门直接拦截 8 票（全部 neutral→poor·pattern_gate，立法预期方向）**：币股人生 T006(0.63)/T008(0.77)、ZELDA T013(0.49)、긴와 T014(0.45)、KIBI T017(0.50)、谷谷 T022(0.67)、阿里美股 T025(0.70)、突突车 T052(0.57)。
- **锚冲突 2 票（立法前裁定 vs 盘型硬门，属立法自然结果待用户复核）**：긴와 T014（BPA-061 用户裁 neutral）被 early_sniper_decay 拒、突突车 T052（BPA-059 用户裁 neutral）被 retail_pvp 拒——五类型学「②③④不要参与」是硬规则，锚 expect 为立法前记录；是否 update-expect 待裁定。
- **Jev 方差摆动 7 票（与盘型门无关的边际摆动，归因留档）**：
  - T001 정책콹 poor→neutral（回调 0.43→0.45 刀口摆动）；T045 雪球SI poor→neutral（activity_level 0.35→0.36 摆动致 activity_gate 失守，非回调路径）；T049 Lily poor→neutral（回调 0.48→0.47 刀口——**BP17 立法票未复现**：Lily 前列买入 0.075/0.05/0.05 全尘级按规模臂①应判清场，本次 Jev 未执行两臂判读，与 cheat 侧 CD319 同版摆动同族）；
  - T028 持械入宋/T035 Sun/T047 作茧自缚二 neutral→poor（回调 0.55/0.60/0.61 过线——T047 与 BPA-055 expect poor **同向**（贴线票终于过线）、T028 与 BPA-032 expect neutral 反向）；T038 我画地为牢 neutral→poor·chip_gate（famous_domination none(1)→dominant(1) **硬翻转**，同 token T039 判 famous_monopoly(0.36) 联动读出 famous 控盘证据——同版 Jev 摆动）；
  - 白猪AI T015 维持 neutral（blended 0.82）——已知分歧票（BPA-062）盘型不拦不救，留档不变。
- **锚对拍总账**：可对拍 41 锚命中 23（BP18 前已存在的既有未中=吉祥 BPA-001~007/024、無為 BPA-039、疯狂星期四 BPA-043、作茧自缚一 BPA-049、雪球SI T046 BPA-054、白猪AI BPA-062 等复盘时已留档分歧/贴线票）；BP18 新增未中 5（T014/T052 盘型门立法冲突 + T045/T049 立法票方差回摆 + T028 方差）。

**余留**：①盘型分布攒批观察（strong_backer 8 票中 T005/T016/T051 仍被活跃度门/质量题拒=①不拦不救设计内，生产轨迹验证「最好类型」是否需要正向加权待票池）；②T045/T049/T038 同版摆动三例攒批（回调两臂执行方差与 famous 硬翻转——与 CD 侧摆动案同族，攒例后再议代码侧锚定的必要性）；③锚 expect 复核（T014/T052 是否按盘型立法 update-expect 归用户）。

### BP16 回调题「大户未清场」立法：初版三源判据翻车→绝对买入金额两臂修正（题集 BP16→BP17 两改，2026-11-06，复审 #49 立法案）

**案由**：v73 逐代币复审回调题「浅回撤核心规则误放」校准组积累 **7 例**机器 neutral/用户 poor：Sun S3（BPA-041）、中囯人能飞 T040（BPA-048）、雪球SI T045/T046（BPA-053/054）、作茧自缚二 T047（BPA-055）、Lily T049（BPA-056）；唯一正例=作茧自缚一 T041（BPA-049 good：vsFirst +0.5% 贴价+ultra 活跃+净买正+第 1 大 0.412 真金刚进场锁仓 68.5%）。#49 Lily 卡用户裁定原话收口并启动立法：**「给 Poor，买入的时候，完全没有大户在了，就只剩下几个小散户，这种情况不要抄（改一下 prompt 吧）」**——机器「活跃度没有丧失」只看热度档，用户真实口径=大户在场与否。

**BP16 初版（commit 8e7463c）三源判据+对拍翻车**：大户在场=清仓式卖出钱包数少+top5 大持仓近 60s 卖出不放量+持仓前三仍占实质流通份额（state 现成三源）。182 定向 8 点对拍：翻案组仅 1/6（T035-S3 翻 poor）、**正例 T041 误伤**（清仓式卖出钱包 6 个+top5 卖 0.252→Jev 判清场→poor 0.65）、Lily 本尊没翻（前三占流通 89.2%+top5 卖 0=按三源「大户在场」）。

**诊断（state 材料逐点对照）=判据与用户语义错位**：用户说的「大户」是**绝对金额**——Lily 前三占流通 89.2% 但绝对买入全 0.075/0.05/0.05 尘级（小盘票散单买 0.05 也占「前三」）；T047 第 1 大占流通 64.2% 只买 0.020 BNB=小散互捅教科书案；T041 清仓式卖出 6 个仍 good——0.412 真金第 1 大刚进场零卖出，「清仓钱包数」在 meme 短命票里是剥头皮常态噪音。**占比≠大户、清仓数≠清场，钱才是**。

**BP17 修正（commit 00821c9e）两臂**：大户判据看「全窗持仓前三」行**绝对买入金额**（真金大额≈单笔 0.3+ BNB 级）——①**规模臂**：前列买入全是小散尘级（最大 0.1~0.2 BNB 级）=从未有真大户，清场；②**撤退臂**：top5 近 60s 卖出合计已占前列持仓者买入额**大半**（过半即撤退——手验分界：T036 10%/T041 34% 不触发、T045 76%/T035-S3 77% 触发）=大户正在走，清场；清仓钱包数降级噪音参考；缺证 fail-open 不变。

**验证（182 定向 8 点，2026-11-06）**：

| 点 | 前三买入额 | top5 卖÷前列买 | BP15→BP17 回调题 | BP17 综合 | 用户期望 | 结果 |
|---|---|---|---|---|---|---|
| T049 Lily | 0.075/0.05/0.05 全尘 | 0% | neutral→**poor 0.48** | **poor** | poor | ✅ 立法启动案翻案 |
| T040 中囯人能飞 | 0.099/0.098/0.001 全尘 | 0% | neutral→**poor 0.58** | **poor** | poor | ✅ |
| T035-S3 Sun | 0.462/0.294/0.401 真金 | 77% | neutral→**poor 0.50** | neutral（早鸟 neutral 0.55 挡） | poor | ✅ 回调维度达成（综合被早鸟题挡=聚合语义正常） |
| T045 雪球SI 一 | 第 1 大 1.300 买 | 76% | neutral 0.66→neutral 0.50 | **poor**（activity_gate） | poor | ✅ 综合翻案（走活跃度门路径留档） |
| T046 雪球SI 二 | 0.210/0.138/0.148 尘级 | 0% | neutral→neutral 0.52/0.59 | neutral | poor | ❌ 贴线未翻（poor 概率 0.37） |
| T047 作茧自缚二 | 0.020/0.0098/0.001 尘埃 | 0% | neutral→neutral 0.48/0.64 | neutral | poor | ❌ 贴线未翻（0.45 差 0.02 后退） |
| T041 作茧自缚一（正例） | 0.412 第 1 大锁仓 0 卖 | 34% 不过半 | neutral 0.54→poor 0.66/0.67 | poor | good | ⚠️ 误伤（见下） |
| T036 疯狂星期四二 | 0.495/0.513 第 1 大 0 卖 | 10% | poor 0.82→poor 0.50 | poor 0.81 | neutral（分歧票） | ✅ 零翻动（BP15 即 poor） |

**T041 误伤路径留档**：手验两臂均不该命中（0.412 第 1 大锁仓零卖、top5 卖 34% 不过半），但 [WALLETS] 段买入额前列钱包 0xcd47（买 0.275 卖 0.252）/0xd7fb（买 0.269 卖 0.270）/0xfb4e（买 0.196 卖 0.167）/CREATOR（买 0.495 卖 0.512）全部 1~2 秒快进快出——**前列买入合计 73% 已卖出**，Jev 按全局快出阵列判撤退（两次 poor 0.66/0.67 坚决非方差）；用户裁 good 依据=第 1 大 0.412 刚进场锁仓 68.5%。**两可形状**：锁仓新大户 vs 剥头皮互捅阵列并存，误伤留档不迭代（BP11「先接受现状」先例——边际改动方差淹没）。

**收口裁定**：净效果=正确翻案 4 vs 误伤 1（两可票）+贴线 2——方向性成果显著，BP17 收口。**余留攒批**：①T046/T047 贴线（前列 0.1~0.2 级尘单+0 尘埃，规模臂证据极强但 Jev 两次不过线——方差内攒批观察，不单独加码）；②T041 形状（锁仓大户+剥头皮阵列并存）判读边界；③Jev 方差观察：T045 翻案路径走 activity_gate 而非回调题（activity_level 维度方差），路径不稳定但桶级一致。

### BP15 价格豁免锚：贴发行价豁免持有者不均衡——谷谷 T020 翻 neutral（2026-11-06，复审 #16 立法案）

**案由**：v73 复审 #16 谷谷 `0x32f18a98e4fc3b33013f80454faae710a6367777`（flap 非 BNB 盘）三笔连环买 T020/T021/T024。BP14 重析三点全 poor，其中 **T020（开盘 3 秒、涨幅 +25%=near_launch、前向 +5min 峰 +114%）= chip_gate 首个「拦掉盈利点」样本**（BEM 5 点全拦对 -34~-38% 后首次反向）。用户两段裁定：

1. 「T020 持有者有 9 个吗？需要去除 dust 仓位，这个是 good/中等也行，但是 poor 不行」
2. 「极早期有大户在场没有问题，价格临近发布价豁免持有者不均衡」

**dust 核查（182 探针锚 14 行手算，2026-11-06）**：posHolderCount=9 属实——**8 个实质仓位 + 1 个尘埃**（0xc3c9a4f7 净 0.15M tok 现值 0.001 BNB），另有 2 钱包快进快出已全平不计；top1=78929c49 净 55.6M tok（0.372 BNB）/前二 56.5%（334366b0 0.222 BNB）。**dust 剔除后 8 个持有者仍在 6~9 区间、前二 56.5% 不变——单靠剔尘计数救不了 T020**（分层判读前提不变）；决定性的是价格豁免锚（裁定 2）。posHolderCount 含尘埃的口径事实留档，暂不加剔尘键（豁免锚已盖极早窗场景；非豁免场景尘埃计数争议攒案再立）。

**豁免锚设计（BP15）**：holder_concentration 反锚⑥——currentVsLaunchPct ≤ +50%（含破发）时持有不均衡**不坐实 strong**（降观察至多 moderate）：贴发行价=头部持仓**没有可兑现的浮盈**（这个位置砸不出暴利），极早期筹码集中在抢购者手里是价格发现常态——与早鸟题「价格低救」臂（BP10 判序第一分支）同一哲学=**位置先于集中度**。**只豁 holder 轴不豁 famous 轴**：famous 集团控盘是组织行为问题不因价格低而豁免——BEM 5 点验收零翻案的防线。谷谷正例进形状样本（6~9 过线+同块簇 78% 佐证但 +25% 贴发行价→豁免落观察档）。

**验证（182 定向三面，2026-11-06，commit 7a187462）**：
1. **T020 翻案**：poor 0.91 chip_gate（holder strong 0.91）→ **neutral 0.77 any_neutral**（holder→moderate 豁免生效、famous none、早鸟 neutral 0.77 聚合放行）——「good/中等也行，但是 poor 不行」裁定兑现；
2. **BEM 5 点零翻案**：L057-060+T018 全仍 poor chip_gate——L057（near_launch）holder 亦被豁免落 moderate，但 **famous dominant 独拦**=「不豁 famous」防线实证；L058-060/T018 价格档 low 不在豁免域、famous dominant 照拦；
3. **吉祥反例不翻**：L034 neutral 0.49 保持（豁免不影响放行侧）、T011/T016/L046 poor 保持。

**同案其余裁定**：T021（else_poor 0.64——pullback poor 0.64+high_chase poor 0.61 双 poor，chg60 +53% 追高二买）与 T024（famous 控盘 68.8% dominant，G17 联立臂 33.2/40.9 未过线但主臂 ≥50 直判；前向 -27.5% 拦对）**poor 均用户认同**；T024 与 BEM 同款（famous 臂主场、holder 反而 weak）=筹码门 famous 臂第二命中。生产侧留档：五轮信号腿序 t6（v1 盲买，3 秒 mcap 7.08≤7.5 无峰门先触发——t1 同刻 holdersExDust<6 未过）→t1→t2→t3→t4，第四五轮 BP2 生产门自行拦对（poor 0.80/0.84 bp_gate_assessment）；三轮连环买票净 +0.000312 BNB。**t6 开盘盲买形状（T119 已加峰门 15 修复）本票再+1 实证**。

### BP14 筹码门立法：CD 筹码结构判法全族搬运直接进判定——BEM Miner 5 点位全 poor 验收（2026-11-06，立法案；题集版本与案号自本案起重新对齐）

**案由**：v73 复审 #14 BP-T018 BEM Miner `0x75d5286d3ac478334fe098f015624486d7a77777` 用户认同 poor（BPA-025 落锚）后提出新层面原话：「但是还有另一个层面的问题，恐怕也是需要从 cheat 检测迁移过来一些模块：第一这个是被 famous 掌控的盘子，第二持有者数量不小了，但是TOP持仓比例太大。」→ 迁移范围与挂点终裁原话「**全部搬过来直接用于判定，这个代币页面上展示了5个点位，全部 poor**」——①famous 控盘+持仓集中全族搬（非挑选）②**直接进判定**（非观察档，与 BP8 圣诞树「先放里头」刻意不同向）③验收标准=BEM 页面 5 点位（ladder L057-060 四点+trades T018 一点）全部 poor。

**BEM 实测证据链（182 探针 `tmp-bem-chip.cjs` 多刀时点扫描，57 行全量+六刀截窗）**：
1. **famous 掌控实锤且买点可得**：出生 +5s（锚 25 笔）famousDominancePct 已 **74.5%**（famousFollowerTop3Pct 64.5/groupBuy 74.5），随建仓推到 87.5%——非事后展开，v3 十三腿全部触发点（t1 最早要求 tradeCount≥8）锚窗必有 50%+ 证据；
2. **参与/持有分叉实锤**：29 个钱包买过但正净持有仅 3 人，top2 合计占流通 94→99%（holdingsProfile=[{circPct:65.4},{circPct:34.6}] 两人分掉全盘）；
3. **生产代价实证**：v1-t6 出生盲买 07:03:39 信号→BP12 good 0.53 放行→+5s 买入 6.57e-9→15s 闪崩 -33.4% 全清（07:03:59 卖 4.38e-9）——cheat 门 insufficient_ticks（锚 7<8）fail-open 免检，「该拦没拦」方向第三实证（白猪/吉祥同族）。

**搬运内容（CD 侧现成立法直译，非新发明）**：famous_domination 判法=CD D3.2 三档切点（≥50 dominant/25~50 heavy/<25 light）+G17 D 通道联立臂（followerTop3≥45/groupBuy≥80 从重）；holder_concentration 判法=**CD240 案用户亲自定的分层线**（≥10 持有者单一 >45%/前二 >55%/前三 >70% 过线坐实；≤5 豁免域「3 个持有者还好说」）+一人控盘例外（top1>90%+分叉极端）。两臂互补：famous 臂管控盘主体是谁、holder 臂管「持有者多+集中」形状——BEM 3 持有者落豁免域 holder 臂可不动、famous 臂全拦；CD240 BOSS 案（23 持有者 top1=73%）则 holder 臂主场。锚全部 cheatDerived 顶层同名单点照抄零重算（holdingsProfile top3 截断数组照搬），唯 buyersTotal 为 BP 侧新增计数+top1HoldCircPct 自 holdingsProfile[0] 派生。

**门设计三要点**：①只取最高档拒（dominant/strong），heavy/moderate 观察不拦——25~50 famous 参与/豁免域集中都是正常盘面，防误伤优先（「拒=有证据的拒绝」纪律）；②门序=活跃度门先裁（rule 留痕首个命中门）→筹码门→质量题聚合，rule 域扩为五值；③两题答案缺席=容缺放行（BP13 及更早旧档重放零影响，维度题容缺机制天然兼容）。

**验收（182 定向重析 2026-11-06，真调 Jev BP14）**：BEM 5 点 **5/5 全 poor 全 chip_gate**（famous 全 dominant 1.00；L057 锚 13 笔时 holder 亦 strong=一人控盘臂首触发，L058-060 holder weak=豁免域从宽——famous 臂全拦与设计自洽）；**L057 关键验证点：锚 13 笔时早鸟题仅 neutral 0.65**——单靠 BP13 质量题会放行、筹码门拦住（速度锚来不及起效的极早触发点正是筹码门射程）；5 点前向收益 -34%~-38% 全拦对。**反例 4 点零误伤**（吉祥 L034/T011/L046/T016）：famous 全 none/light 无一 chip_gate 拒，L034 neutral 0.55 放行与 BPA-024「二波前夜 neutral」裁定一致、T016 走 activity_gate、T011/L046 走质量题——原判定路径零扰动。

**余留**：53 点集全量 BP14 重跑须用户放行（现应升级为 BP14 口径）；chip 锚 10 键分布校准（healthy 盘 famous/holder 档位分布攒批）；CD240 BOSS 案形状反向对拍（holder 臂主场正例）待攒。

### BP13 v3 阶梯触发点复审：16 点判定全认同+人工锚点集建立（2026-11-06，复审案·v73 逐代币复审延伸到 v3 十三腿重放触发点；题集版本维持 BP13 不变——案号 BP13 本次首用，与题集版本号错位续）

**案由**：用户指令「开 ticks 页面，并且需要在里头收集所有触发的点位（不仅仅是交易点位）」→ 182 重建 ladder 集 `bp-2026-11-06-v73-ladder`（451 点=244 trades+207 ladder，v3 十三腿 FA 真重放 per token×leg 首触发）→ 四票 16 个 ladder 触发点 BP13 真调重析（good 0 / neutral 4 / poor 12）→ 用户裁定「吉祥我认同所有的当前结果……其它结果我都认同」+补锚指令「请加入锚，ticks 9-14，全部为 neutral；13:49:33 的 ticks 也加入，也是 neutral」。

**判定对照三点**（生产 v1 发射点判定 vs v3 重放首触发点重析；腿名=v3 语义名，库 id t5-t13 ↔ N30/N36/N45/t6峰门/D25-D55）：

1. **吉祥 t1 时刻差跨价格低救窗**：重放点 05:48:33（29s，maxChg5=+9.7%）重析 neutral 0.49；生产发射点 05:48:36（33s，maxChg5 已 +89.8%）BP12 判 poor 0.55 拒——**非题集漂移，是 debounce/throttle 3s 在急拉票上跨过整个「价格低救」窗口**（4 秒 16 笔）；第 9-14 笔（05:48:36 六笔，价 7.33→8.57e-9）人工裁定全 neutral=早鸟可买窗口人工划定，第 16 笔起（+39% 以上段）模型 poor 用户认同。
2. **吉祥 t4 反向**：生产发射点 05:48:54 BP12 neutral 0.42 买入（#8 复审实买笔）→ 重放点 05:48:37 重析 poor 0.79——17s 时刻差+BP12→BP13 换代叠加，同形状重析更严。
3. **ZELDA/白猪 t1 重析仍放**：ZELDA 生产 good 0.72 买入（复审「放行好了」）→ 重析 neutral 0.79；白猪生产 good 0.66 买入实亏 -40.2%（T120 案票）→ 重析 neutral 0.75——**BP13 题面拦不住白猪形状**，「该拦没拦」攒批案素材；白猪 t2 生产无信号行（距 t1 发射仅 +3 笔，与 T120 tick 门拦截形状一致，被拦不落行无从留痕）、重析 neutral 0.44 前向 -33.2%。

**D 臂在急拉票上拦对**（v3 新腿生产无判定，重析即首验）：吉祥 D25-D45 五点（05:55:24-05:56:07 回撤 -37%~-47% 段）重析 poor 0.96-0.97，前向 5min 末 -31.8%~-15.5% 全拦对；D55/t6峰门两点拒掉前向 -12.9%/+24.4%（后者=接受现状设计内代价同族）。**重析档位与前向收益负相关**（neutral 组中位 -28.2% / poor 组 +86.6%）主要由吉祥 12 点贡献——poor 拒掉的全是急拉大涨段，BP11/BP12「接受现状」终裁在 v3 新腿上的复现。**긴와 v3 零触发**（生产靠已删的 v1-t5 急砸臂买入）=删臂方向正确的又一实证。

**人工锚点集建立（`scripts/buy-point/data/manual-anchors.json` v1，23 锚）**：tick 锚 7（吉祥链上真序第 9-14 笔 tick id 11146886-11146891 + 05:49:33 深回撤点 id 11147037）+ ladder 锚 16（四票 v3 重放触发点，expect=用户认同的重析值）。**锚不驱动代码**：分歧锚留档不改模型（05:49:33 人工 neutral vs BP12 真跑 W25/W30 poor 0.67 接受现状维持——「急拉票回撤点 BP 拒」终裁不因人工锚翻案）；题集换代/全量重跑时对拍用（对照口径：expect.bucket vs 新版 assessment.bucket）。locator：tick 锚=wss_price_ticks 主键 id+block/log 双保险；ladder 锚=set pointId+legId+triggeredAt。

**复审序列裁定追加（2026-11-06 逐票进行）**：#12 BP-T016 吉祥二波前夜=「neutral 可以」（BPA-024，分歧锚②）；#13 KIBI 0x9fb4…7777（T017/T019+四轮快进快出 -23%）**用户裁定「这个币整体跳过」**——人工认定作弊币但 cheat 门首析 healthy（07:00:59 前 60s 首冲段干净）后**粘滞免检四轮全放行**（作弊形状 07:04+ 才展开=「干净票转恶」结构性盲区留档，healthy 复检口未立不预动）；T017/T019 不裁不落锚；#14 起（BP-T018 BEM Miner）继续推进。

**余留**：①锚集消费机制（run.mjs 加载对拍列）未接——手动对照即可，接机制时机归用户；②「该拦没拦」（ZELDA 误放/S021/S071 误伤/白猪）攒批池继续攒；③53 点全量 BP13 重跑仍待用户放行；④人工锚 vs 模型分歧锚 2 个（BPA-007 吉祥 05:49 深回撤、BPA-024 吉祥 06:33 二波前夜「neutral 可以」vs 模型 poor 0.94——**同族形状：回调忌讳①崩塌第一腿 maxChg5 全史恒含，暴涨段距当前 >45min 长间隔失效反例**，+193% 二波主升被模型定性崩塌），攒到多个再议是否触发校准（候选=忌讳①时近性约束）；⑤KIBI 形状（cheat healthy 粘滞漏判+BP13 活跃度门兜底拦对 T019）=cheat 门 healthy 复检口候选素材，归 CD 侧裁定。



**token**：ZELDA（完整地址见 set `bp-2026-11-05-v73-trades` BP-T013 点位的 tokenAddress；signal 05:56:59 t1 阶梯腿）｜**锚**=BP-T013（测试集点位，锚窗=信号前 ticks 截窗）。

**案由（#9 复审实证）**：t1 信号 05:56:59 cheat healthy+BP2 good 放行买入 0.001@6.02e-9 → 05:57:43 stallClose 30s 断流全清 **-16.4%**（44s 无成交；vs 持到 900s -29% 省约 13 点）。误放根因=**market_heat 纯密度口径无绝对成交额门槛**：60s 窗 17 笔/12 买家/笔均 0.11 字面擦到「数十笔/分」high 下沿判 high，但每分钟成交额仅 **1.71 BNB**——用户质询「这个票活跃度不达标吧？」+裁定原话「**每分钟的交易量多少 BNB？这个是更加重要的指标**」。53 点集吞吐分布：p25=1.15 / p50=2.10 / p75=3.31 / max=16.10——1.71 落 p25-p50 区=**买点之前盘面已经很冷**（同窗「突突车」1.34 BNB/min 却 +317% 证明吞吐与收益非单调，判读归 Jev 权衡非代码硬门）；BP12 真跑 market_heat 仍判 high、综合 neutral(0.42)=放行（早鸟价格低救臂拖住、high_chase poor 0.80 方向对）=「不该放放了」形状，与 S021/S071（该救没救）反方向。用户指令原话：「**你把 cheat 检测的活跃度搬到买入点位分析一份吧（原来的不要删），活跃度检测要倾向于检测买入点位之前的，这个票买入点位之前已经很冷了**」。

**搬运形状（题集 BP13）**：CD activity_level 题（D3.49/D3.55/D3.59/D3.61 四代演进成熟判法）整份 BP 语境化进新维度题——七要素判法（①无交易期占比 ②笔密度 ③买盘中位为主笔均为辅 ④双向性+开盘极早窗反锚 ⑤金额吞吐 ⑥停滞突发反锚 ⑦临近买点段+全窗量级综合锚四腿联立）+ 真实样本段全量照搬；题头声明「判读倾向临近买点段」=用户裁定直译。**BP 锚窗天然=买点前窗口**（锚=买点信号时刻，临近段=锚窗末端 30s=买点前最后 30 秒——CD 的「临近买点段」在 BP 语境无需改口径）；数值零重算（cheatDerived 同名 13 键透传，cheat-snapshot 单点）；**原 market_heat 保留不删**（近 30/60s 密度视角与全窗量级视角分工并读）。**活跃度门扩双题**：market_heat low OR activity_level low → poor（rule=activity_gate；BP12 旧档重放无 activity_level 答案=该臂失效容缺、heat 臂照常）。

**验证**：单测 `_test_buy_point_lib` 282 断言（门双臂/双 low 取 max/旧档容缺/七要素段/act 13 键同源）+`_test_buy_point_check_service` 26+CD 三件零影响全绿；**ZELDA BP-T013 单点 BP13 重析对拍（182 真调 Jev，14:15 UTC）=未拦**：activity_level **mid(0.59)**（low 仅 0.02）+market_heat high(0.69)→双门都不触→综合 neutral(0.46,any_neutral)=仍放行。act 13 键首跑生产数据全透传（actSpanSec=44/actTickCount=17/actIdlePct=**0**/actBuyMedianBnb=0.0597/actThroughputBnbPerMin=**2.33**/临近段 7 笔 1.71 BNB/min 段内最大间隔 15s）。**根因=判法合理执行而非搬运失效**：ZELDA 锚窗（买点前 44s）零静默（idlePct=0，无任何 ≥20s 间隔）+笔密度 23 笔/分+中位 0.06 正常量级（0.05 档上下不属尘埃假活跃）+吞吐 2.33 高于 CD 死寂线 <1——按 CD 七要素判法就是 mid；**44s 断流发生在买点之后，锚窗（买点前）看不到**。用户感知「已经很冷」（2.33 BNB/min 小额匀速）与 CD low 线（<1 死寂）之间的 gap=**阈值校准问题非机制问题**。**锚窗口径 53 点吞吐分布（本地 ticks 重算）**：p25=2.43/p50=5.28/p75=9.93/max=37.16，ZELDA 排 13/53——比它冷的 12 点（KIBI 0.19-0.46×3、币股人生 0.25-0.49×3、HAUL 0.49、吉祥 BP-T012 0.96 等）；**对照两点方向性验证生效**：BP-T026 KIBI（0.19 最冷）activity low+market low→门拒 poor(1.00,activity_gate)✅（但 +15min +10.4% 后涨=冷票误伤素材留档）；BP-T005 HAUL（0.49、14 行 119s 窗>60s 不满足④反锚两腿）activity low→门拒 poor(0.88)✅（+15min -24.7% 拦对）。**校准决策点（归用户）**：low 档吞吐线维持 <1 攒分布，或上调至 ~2.5-3（可拦 ZELDA 形状，但同时拦掉 53 点中前 ~13 个 ≈25%——KIBI 后涨 +10.4% 已示误伤面）；53 点全量重跑攒分布=待用户放行。

**余留**：①low 档吞吐线校准裁定（维持 <1/上调 2.5-3，见验证段决策点）；②act 观察锚 13 键攒 53 点分布（吞吐 <1 BNB/min 死寂线/中位 0.05 尘埃线在买点集的覆盖率）；③market_heat 与 activity_level 两题答案一致性观察（同判 low 率=分工句教学有效性）；④t1 极早腿（8 笔触发）与④开盘极早窗反锚（<60s∧<30 笔）的交互——BP13 生效后 t1 票 activity_level 分布观察（HAUL 119s 窗不属反锚域未测到）。

### BP11 吉祥低点案：sell_pressure 维度题删除+回调题三层结构重写（题集 BP9→BP12 四改）（2026-11-05，校准案·v73 逐代币复审 #7；两问+七段裁定+冲突环诊断+十轮对拍+接受现状收口）

**触发背景**：v73（`c6efed13`）逐代币复审 #7 吉祥 `0x4aac4818…` 低点信号 S071（T117 阶梯 P2 热度腿 05:49:28 自然触发）生产 BP2 门拒（bp_gate_assessment）+离线重析 poor 0.96。用户两问：①**信号为什么能发出来**——P2 热度腿 `tradeCount/buyVolumeBnb/holdersExDust` 三键过线自然触发（触发即消耗设计，门拒不返还）；②**为什么过不了 BP 门**——pullback_entry_quality poor 0.96：maxChg5 +58 过崩塌线+浅回调+阴跌+holdersDelta60 −3，忌讳①②③三比一压过⓪救臂。

**用户裁定链（七段，按时间序）**：
1. 「现在系统没有让评估 sell_pressure high + holders−3 流失 这几个指标」「我当前设计的体系中，没有这两个指标」——卖压/holder 流向不是体系内评估指标。
2. 「活跃度没问题，并且价格 near_launch∧浅回调 肯定要给中等。sell_pressure 直接删掉」——⓪两条件命中=必须 neutral；sell_pressure 维度题整题删除。
3. 「不搞这种代码门，再看一下 shallow_pullback 的规则。明确一下问题在哪里」——（BP9 验证双票未翻后我自作主张在 mapper 聚合段加 priceLowSave 代码侧救门，被打断回退）转诊断模式。
4. 「可以，按这个方向改题面，改完定向跑 S021 和 S071 验证」——①忌讳内部开 near_launch 例外（BP10）。
5. 「pullback_entry_quality 的陈述感觉好冗长……刚刚说了半天就是 价格跌到很低，活跃度又没有丧失，可以给中等。」——核心规则一句话化。
6. 「请理顺一下这一臂整体逻辑」→ 呈现三层结构 →「可以」——BP12 三层重写。
7. **终裁**：「先接受现状，然后下一个，不搞代码门」——题面工程在该形状上实测到头，接受 Jev 倾向 poor 为设计内代价；不搞代码门两次明裁。

**冲突环诊断（「问题在哪里」的答案）**：⓪救臂两条件在 S021/S071 维度判定**全命中**（shallow_pullback prob=1.0、near_launch 0.77-0.87）判档无误；冲突=忌讳①②③与⓪**同票命中三比一**——①maxChg5 +41.04(S021)/+58.33(S071) 过 +40~50% 线「无论回撤深浅」、②「没跌到位」的触发条件=浅回调与⓪**完全同域**（⓪救浅回调、②拒浅回调，同域反号）、S071 另命中③（阴跌+holdersDelta60 −3）；S020 对=maxChg5 +34.7 未过线无对手。maxChg5 数值锚在 state [PRECOMPUTED] 回看速度行高调在场=注意力锁定。

**十轮对拍概率史（S021/S071 两票×5 版题面，182 真调 Jev）**：

| 题集 | 改动 | S021 | S071 |
|---|---|---|---|
| BP8（判序版） | 案发前现行 | poor 0.93 | poor 0.96（离线重析） |
| BP9 | 删卖压+⓪裁定级 | poor 0.92 | poor 0.96 |
| BP10 | ①内部 near_launch 例外 | poor 0.68 | poor 0.61 |
| BP11 | ⓪升场景层分流 | neutral 0.61 | poor 0.50 |
| BP12 | 三层结构终稿 | poor 0.71 | poor 0.69 |

**Jev run-to-run 方差发现**：early_bird 题五版未改一字，S071 概率 0.49-0.58 漂移；S021 在 BP11 抽中 neutral 0.61、BP12 退回 0.71——**同题面重跑方差 ±0.1+，边际题面改动被方差淹没**（BP11 的 S021 neutral 判噪声抽中）。

**BP12 三层结构终稿（回调题内部，用户确认版）**：第一层·场景判别（有过明显高点+现价处回落位置；圣诞树视角 right_bottom 树脚/left_side 新树佐证；非此→insufficient）→第二层·核心规则（先于一切忌讳，命中即定档 neutral 不再评估第三层）=「价格跌到很低+活跃度没有丧失→中等」（near_launch ≤+50% ∧ 非深崩；heat≠low；依据三句+证据闭包卖压/holder 不否决）→第三层·忌讳五行清单（①崩塌第一腿②没跌到位③奔零④断流⑤协同）只服务 low+/深崩票。

**接受现状收口（终裁，2026-11-05）**：十轮 9 poor 1 neutral——S021/S071 形状（maxChg5 过线+near_launch+浅回调）Jev 稳定倾向 poor，三层结构+证据闭包+同域反号消除全用上仍跨不过 neutral 线，边际改动被 run-to-run 方差淹没。裁定：BP12 三层结构为现行题面，该形状判 poor=**设计内代价**（宁可错杀贴发行价的快涨回落票，不放松崩塌第一腿防线）；不搞代码门（mapper 聚合保持 activity_gate→any_good→any_neutral→else_poor 原样）；不再做题面迭代；S021/S071 形状误伤与 BP10 案 S021 留档**同池攒批**（若攒批后再议，候选方向仍非代码门）。

**事故教训（过程性留档）**：①自作主张上代码门（mapper priceLowSave 救门）被用户打断回退——裁定级意图必须走题面/题序结构，不进代码聚合层；②带病提交（BP11 题 40aaee2a 时单测 FAIL 被 `&&` 链中 `| tail` 吞 exit code）——管道后必须看退出码或不用管道；BP12 重写时深崩排除句收进第二层顺带修复该断言。

**单测**：`_test_buy_point_lib` 248→**252 断言**（E 组五维度反证；F 组回调题三层结构七组锚句：三层结构声明/核心规则原话/两条件可判化/证据闭包/奔零排除/跌到位限 low+/深崩排除走第三层）；`_test_buy_point_check_service` 26 断言（8 题桩 sell_pressure 绝迹）。

**余留**：53 点集 BP12 全量重跑对拍（须先经用户放行）；v73 换代吃新题面（生产仍 BP2）；S021/S071 形状误伤攒批观察。

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
