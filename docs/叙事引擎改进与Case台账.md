# 叙事引擎改进与 Case 台账（卷三）

> **卷二前段已归档（2026-10-14）**：C36-C54（C55 跳号；2026-10-01 ~ 2026-10-03
> GMGN 蓝筹验证簇 / 链路修复大扫除 / J1.23-J1.26 + P1.8-P1.9 题集密集演进期）
> 与卷二期版本表尾部见 `docs/叙事引擎改进与Case台账-卷二归档.md`；卷二后段
> C56-C65（J1.27 起）并入本卷（切卷不拆活跃段）。卷一（C1-C35，
> 2026-09-20 ~ 2026-10-01）见 `docs/叙事引擎改进与Case台账-卷一归档.md`。
> 本卷自 C56 起，只续新记录与活跟踪项。
> 分工原则（多 Case 反复验证）：**LLM 管叙事价值判断，代码管市场事实**——凡是市场事实
> （谁先发、涨了多少、有没有同名）一律代码侧判定，不指望 LLM。
> 写作纪律（C35 确立）：case dump 一律 jq/node 抽窄字段，不整读（防 autocompact thrashing）。

---

## 一、现行架构一屏（2026-10-14 时点）

```
Token URL → URL 分类（含 IPFS metadata 解包 + GMGN 社媒补源 + 推文配图视觉分析
   C58→C65 img-v3：visible_text 图内文字逐字转写 + maxTokens 2500）→ 数据抓取
   （C62/C63 提速：N1 分段探针 / N2 平台桶并发+IPFS 竞速 / N3 叙事预触发 /
   三泳道并发 / websiteFetch 总开关 / undici keepAlive / precheck 四查询并行）
   → Pre-Check（纯规则，无 LLM）
                                   ├─ account/community token / 发行方自发宣告（字面法+CA 时间线）→ prestage Jev（P1.10，4 题）
                                   ├─ super-IP 账号 → 快速通道（标准题集 + 代码预评分；referent_memeability/图豁免 C59）
                                   └─ 标准路径 → 单次 Jev 调用（J1.30：16 常驻题——web3_fit 第 14 /
                                      subject_entity 15 / referent_memeability 16a / subject_carrier 16b
                                      均恒带 + brand_hijack / name_image_consistency（C65）条件携带）
分类/量级/时机/阻断/W类/关联性/质量/Web3偏好/形象载体/名图一致 原子化同问；聚合/阈值/截断全部代码端（jev-result-mapper）
```

- **Jev**（TypeSafe System One，api.typesafe.ai）：结构化决策模型（Choice/Score/Noul 三原语），
  无文本生成，单 token 一次投机性 fan-out 调用（秒级）
- **版本规则**：改任何题的 instructions/criteria 必须 bump `JEV_QUESTIONS_VERSION`（现 J1.38）/
  `JEV_PRESTAGE_QUESTIONS_VERSION`（现 P1.10）；DB 列 prompt_type/prompt_version 标识
  （`jev(J1.38/…)`、`prestage-jev(P1.10/…)`）
- **prestage P1.10 四题**：token 类型（「币本身即IP」双形状：新称号 OR 社区/文化 meme
  主账号，年龄非反证）/ abm 名字关联 / abm Web3 流量 / 社区活跃度。**账号基本面门
  全删（C70 bunker 案）**：粉丝底线 <20、推文 <5、注册 <30 天三道门 + P1.5 实度豁免
  （`prestage_project_quality` 题随之删除）全删——粉丝带**只定档不拦截**（账号 0-299
  mid / ≥300 high；社区 ≥100+high 才 high）
- **代码门族**（mapper 端确定性切分）：nameReferentBlock（阻断侧合计 ≥0.5，全域
  仅累计 minor+common——J1.26 notable_other 全域退出，知名度轴移交 web3_fit）/
  rideDetourBelow（B/C 骑乘改道 W）/ cashtag 改道 W（J1.17）/ detectPublisherProxy
  发布者指代（J1.18，量级 A 档锚）/ routineContentProductBlock（A 类角色豁免 J1.16）/
  negativeHardNewsBlock / web3FitBlock（unfit ≥0.5）/ referent 豁免（J1.21，仅 superIP）/
  punExempt 戏谑关联豁免（J1.24：P≥0.5+within_7d+S/A 档+可信事件源全中时豁免
  品牌劫持与 relevance≤10 双截断，计分照常）/ productEntityAcceptanceBlock
  产品实体接纳门（J1.27，se∈{product_functional,product_character}×fitMass<0.5；
  币安/平台官方源豁免）/ referentMemeabilityLowBlock 指代 meme 低档门（J1.28，
  mem≤1 拦）/ subjectCarrierBlock 形象载体门（J1.29：C/D+非existing、E+no_visual 拦）/
  imgNameExempt 名图一致豁免（J1.30：图证据+name_image_consistency 合并 ≥0.5+0<关联≤10
  → 豁免 Stage3 ≤10 截断，分照常计入；仅标准路径，superIP 走 C59 门）
- **交易引擎直调**：策略 `narrativeCallCondition` 触发 → `NarrativeDirectCaller.getRating()`
  同步调 analyze（30s 超时，失败/超时/未配置 normalize 9 放行）；N3 预触发
  （`fourmemeWs.narrativePrefetch.enabled`）tick 时刻条件满足即后台 getRating+inflight
  join（回测侧装载批量预载 preloadCache）；rating=1 终端 veto 进
  `_narrativeBlockedTokens` 短路（address 形状 <300s 豁免，§4.8 重试域配套）；
  preBuy `narrativeCorpusLagSec` 早晚票门 `< 300 OR earlyReturn >= 100`（C60 立，
  C64 锚点=语料最新推文 Math.max）
- **结果全局缓存**：`token_narrative` 按 token_address 全局唯一，不挂实验；失效靠行删 /
  `updateIsValid(addr,false)` / 窗口脚本 `scripts/narrative/invalidate-*-window.cjs`
  （题集语义变更后历史回测前置批量失效；机制化自动失效未建，见 §四-4）
- **代码侧 pre-check 规则族**（无 LLM）：0.5/0.55/0.58 同名 /
  ~~0.52 同名蓝筹~~（C47 废除：同名≠蹭名，蹭名判定移交叙事层）/ 0.7 语料复用 /
  no_public_info 重试域（30min 窗 GMGN 缓存失效重析）/ 0.5x 爆款短路收窄（有推文文本或视频标题进 Jev）

---

## 二、Case 研究（倒序，卷三自 C56 起——卷二后段 C56-C65 并入）

### C98 粉红豹法国骚乱「IP 成为抗议象征」rating 3 过审——J1.38 negative_hard_news 题面扩政治暴力边界（2026-10-18 用户裁定原话「对应的事件是个涉及政治的负面事件，影响力也不够，不应该支持 meme 币成立」+方案 B「你先试试B」；Le Panthère rose 0x9df97d4239818411237d19a09303262269c47777 案）★

- **案发现场（Le Panthère rose）**：中文转述号 @Oringold_（2,789 粉，verified）reply 挂西语发图推 @yosoyandrepro（3,293 粉，父推 11.2 万浏览/1,081 转/1.29 万赞——C92 父推互动数透传后进 state）宣告「法国失控上微博热搜第一——抗议物价上涨示威演变为打砸抢烧，143 年利摩日市政厅被纵火焚毁，这个粉红豹子成为抗议的象征」→ token 创建（07:49:25）后 40s 评级 **high 71.78**（J1.36 worker 路），v23（b07fbe84 live）07:51:06 实盘买入 0.004 BNB → 07:56:56 清仓 **-19.4%**。flap 平台、税币、creator_hold。
- **放行链还原（为何 J1.36 拦不住）**：①**类别赌赢**——event_category A 0.52 vs E 0.47 argmax 走「角色 IP」线（粉红豹 character_ip 0.59/super_ip 0.8/exact_match 0.54 法语名 Le Panthère rose 精确=粉红豹）；②**量级+传播双借壳**——事件分 27（B 档）采信「全国级骚乱+微博热搜第一」（CG2.0 采信陈述），传播 26.24 由「粉红豹=世界级 IP」撑（dimension2 5 档 0.48），实际 meme 化传播证据只有父推 1.29 万赞（C 档社区级）；③**web3 借壳**——strong_fit 0.72（粉红豹梗在币圈确实流行，判据没错但被骚乱票借用）；④C88 五腿命中（mem 2.09/fresh/strongFit/relPositive 0.97/superIp 0.8）豁四门不送分；⑤**negative_hard_news 仅 0.22**（argmax=none 0.67 放行，概率门 0.5 也没够着）——J1.11 边界「主体是机构/平台不自嘲、无梗无二创」不含政治暴力，且明确「其他负面不选本项正常评估」：粉红豹是卡通角色有强二创空间，Jev 按题面语义判「有玩味空间」不选。**0.22 说明 Jev 语义上识别到了负面性，只差题面许可——这是题面扩边界能一次生效的结构基础**（对比 J1.13 六轮措辞分不动：那些 case Jev 语义上就不认为该拦）。
- **修复（J1.38，题面-only，mapper 零改动）**：negative_hard_news criteria 三处扩展——①类别扩：安全事故族 + **政治暴力/社会动荡**（抗议/示威/罢工**演变为**打砸抢烧/骚乱/纵火/冲突/恐袭/战争/动乱，演变词锚定暴力门槛）；②语料形态扩：事故通报/官方公告/新闻报道 + **时事转述**（本案是转述微博热搜非事故通报）；③**政治暴力臂不看载体玩味空间**：即便有可爱形象/知名 IP 被当作抗议或声援的象征传播，其热度来自现实暴力与苦难而非该形象自身的玩梗文化——现实中的打砸烧抢不是梗，受灾受难的一方不参与自嘲式传播，蹭此类事件的命名只是消费苦难热度，必选本项。反向窄边界同刻：监管罚款/项目失败/名人去世等其他负面不选（J1.11 原文）+ **和平政治事件/政策辩论/选举玩梗（无暴力与灾难）不选本项正常评估**。拦截机制全靠 J1.11 已就位的双挂（BLOCK_SCOPE all argmax + ≥0.5 概率门 negativeHardNewsBlock，标准+superIP 双路径），本题面零 mapper 改动。
- **定向重放验证（4 票，jev_dryrun --token）**：本案 Le Panthère rose **0.22→0.97**（argmax 命中+概率门双过）阻断「负面硬新闻」high→low ✅；同族变体 Piccolo 0xa1cc…7777（「比克大魔王现身法国骚乱😭」角色+骚乱混合形状）**0.76** 拦 ✅；防误伤臂 Ants 0x3dd8…7777（Anthropic 研究员辞职抗议，公司新闻带「抗议」词）**none 0.93** 未触发——其翻 low 来自 C88 mem 地板（J1.29→J1.38 累计版本差异）非本题面 ✅；历史回忆形状 Pepé 0x814e…7777（「多年前人们 front ran 法国骚乱发了个 Pepé」）**none 0.39** 未触发，翻 low 来自时效/量级（timing=older 事件分 45.8<60）✅。
- **影响面扫描（存量 jev 行 35 票关键词命中）**：A 组法国骚乱同事件 10-18 当天 ~16 票（Panthère/Panther/粉红豹/Piccolo×2/Pepé/Riotter/FINE×2/ハッチャン/马卡龙×2/青蛙大军/RIOTZ/MOHA/弹跳猫）——其中 7 票 J1.36/J1.37 下 high（72.78-78.22）为正向翻转目标，8 票已被既有门拦（mem 地板/web3 unfit/事件分不足/营销噱头）；B 组印度政党镇压 3 票（CJP/蟑螂/तिलचट्टा）当时已 low；C 组撞词非政治暴力（漫蛙=平台用户抗议/蚂蚁×5=AI 辞职/Greg=CSGO 玩梗/伏羲=机器人新闻/共和=@clashreport 撞词）全数旧评级 low 或空——**无误伤面**。
- **断言**：无新单测（题面-only 无 mapper 逻辑，红线 13 不适用）；版本锁断言同步四处（`_test_jev_resonance` D5 / `_test_name_image_consistency` A1 / `_test_jev_finding_recap_statement_gate` A1 / `_test_superip_standard_path` D2 → J1.38），题面相关七测全绿（cashtag_w_route 21/resonance 13/name_image 41/finding_recap 52/superip_standard 20/superip_slogan 51/web3_fit 26）。
- **部署语义**：版本 J1.38 断代（存量 J1.36/J1.37 行不重评，观察期语义）；182 worker+v23 实验进程重启后生效（重启 v23 前按规程确认持仓）；7 票骚乱 high 存量行不批量失效（10-18 当天热点已过窗口，重析无买入意义）。

### C97 币安地域子账号量级锚——@BinanceArabic 借壳母机构「币安游戏」rating 3 过审案（2026-10-18 用户裁定原话「虽然是币安的事件，但是只是阿拉伯账号，并且只是要上一个游戏节目罢了，撑不起"币安游戏"这个meme币。币安的地域账号，所发布的局部地域的事件，也不要被视为超级IP事件」；币安游戏 0xf37bbaea289a67af00ac0ee58421553e11987777 案）★

- **案发现场（币安游戏）**：@BinanceArabic（179,946 粉，币安阿语地域子账号）发假设性互动推「想象币安要办电视问答节目帮起名」（0 赞 0 转），token 名「币安游戏」直取该概念 → rating 3 / 74.45 high 过审。三重放行链还原：①**量级借壳**——binanceCorpus（币安 superIP 语料）命中 → J1.36 判 D 0.84 档的同时 magnitude 档判 A（4.2 分）借壳母机构全球影响力 → 事件分吃满 34；②**五腿豁载体门**——C88 superIpSlogan 五腿全中（sipProb 0.55/relMass 0.55/mem 2.39/strong_fit 0.73/时效新鲜）把 subjectCarrier no_visual 0.98 豁出 J1.29 载体门（E 类 no_visual 原本拦死）；③baseless_speculation 0.3 只在 G 域不拦 D 类（线上放行一致）。
- **结构基础（为何锚 D 即拦）**：量级门 D/E 档臂（tierScore<2 → 事件分不足拦）**只有 punExempt（J1.24）与 imgNameExempt（J1.30）两条豁免路径，五腿不豁该臂**——这是 C88 上线时刻意保留的形状（五腿借壳口号放行的是「载体/截断/劫持」三截断位，量级硬门永不豁）。因此 regionalAnchorActive 锚 D 后即使五腿全中仍拦，锚是本案唯一新增拦截位。
- **修复（mapper-only，C42 先例不 bump 版本）**：`detectBinanceRegionalAccount`——主推作者 handle 以 `binance` 前缀开头 ∧ 不在 `GLOBAL_BINANCE_HANDLES`（binance/binancelabs/binanceresearch/binancesquare 四全球号白名单）→ 且 binanceCorpus 借壳语料在场 → `regionalAnchorActive=true` → `effTier='D'`。**锚降优先于两锚升**：effTier 三元链 `regionalAnchorActive ? 'D' : (pubProxy 锚 A / web3FitAnchored 锚 B / 原判 tier)`——地域子账号不借壳把 A/B 两锚升全部压住，量级门 label 落 `A档→D档·币安地域子账号不借壳`；magnitudeTier 原判保留（审计不受锚影响）。
- **口径细节**：只查主推不查父推（BOB 案先例——转发链上的地域号不构成借壳源）；`binancefan123` 类冒充号一并命中（fail-safe 偏拦方向，刻意不加 verified 门）；作者字段双形状 `author_screen_name ?? screen_name`；作者缺失/null 语料 → 不锚 fail-open。作用域刻意限 binance 前缀：注册表其余机构（特斯拉/SpaceX 等）无「全球主号+海量地域子号」的账号矩阵形状，不做泛化。
- **四对照臂（防误伤验证）**：@binance 全球主号不锚（真全球事件照常借壳）/ @binancelabs 等职能臂不锚 / 非 binance 前缀大 V（如 cz_binance 个人号）不锚走原判 / binance 前缀但无借壳语料（binanceCorpus 缺席）不锚——四臂全维持原行为，锚只在「地域子号 + 语料确实在借母机构壳」同时成立时激活。
- **事故反证（单测 C 组）**：C1 案值全值快照（D 0.84/A 档 4.2/super_ip 0.55/mem 2.39/strong_fit 0.73/no_visual 0.98/baseless 0.3）五腿 hit 形状下 rating 仍 low=锚是唯一拦截位；C2 `subjectCarrierBlock=null` 证拦截来自量级门非载体门；C3 label 带 `A档→D档·币安地域子账号不借壳`；C4 magnitudeTier 原判 4.2 保留。D 组锚互斥：regional 赢 web3FitAnchored（同票双锚只有锚降生效）；对照 cz_binance 个人号源不锚 → 原 A 档锚 B 翻案路径不受影响。
- **断言**：`_test_jev_regional_binance_anchor` 28 断言（A 检测真值表/B 四对照臂/C 事故反证/D 锚互斥/E 审计 stage1 `regionalSubAccount:{handle,followers}`/F 源码口径——F6 父推地域号+主推路人号不锚）。28/28 绿；mapper 家族 13+6 全绿回归。
- **部署语义**：零 DDL、零版本 bump（mapper 纯切分）、存量行不重评；182 narrative worker 未重启=生产仍 J1.32 快照（C88 起所有 mapper 改动含本案均待重启生效，见 C96 部署段）。

### C96「币安上电视」陈述句名目击转述 rating 3 过审——J1.37 双新题（finding_vs_recap + name_form）+ F→E 改道（2026-10-18 用户裁定双立项「1」+「陈述句门 我认为也对，也加吧」；币安上电视 0xc6d089d749409f7646de440d637ac9db0e047777 案）★

- **案发现场（币安上电视）**：token 名「币安上电视」= 新闻转述的目击事件（CZ 转推币安上电视节目的新闻），rating 3 过审。**三借壳病根**（用户「这算哪门子meme币？这是一个陈述不是一个实体」直指要害）：量级轴（CZ 1,299 万粉媒体事件吃满）/ mem 轴（币安 super_ip 指代分借给陈述句名字）/ web3_fit 轴（BNB strong_fit 0.93 借给转述内容）——**三轴全是事件成分属性，无一轴衡量「名字本身」作为 meme 载体的资格**。名字是主谓宾陈述句（谁+做了什么），不是可指代的实体/梗词，买家喊不出「币安上电视」这个名。
- **分类逃逸（为何既有门全不拦）**：J1.32 把「目击新闻」判进 F 类（Discovery 的 author-discovered 臂被「spotted/发现」转述语气满足）——F 不吃 J1.29 载体门、不吃 J1.36 折损、mem 轴借壳照常给分；若同语料判 E/D，no_visual 0.97 会被载体门当场拦死。**F 档成了「新闻转述币」的逃逸通道**。
- **修复①（F→E 改道，方向 1）**：新题 `finding_vs_recap`（三态 narrative_finding/news_recap/unclear；判别锚=「发现语气不构成发现」——作者转述目击的新闻是 recap，作者本人发掘出未被公众注意的事实才是 finding）+ F 档 criteria 澄清（NOT a news event the author merely witnessed/reported）。mapper：`recapForced = (category==F ∧ finding_vs_recap==news_recap)` → category 强制改道 E——**改道不是放行是换考官**：E 类既有门（J1.29 载体门 no_visual 拦 / J1.36 折损 / mem 轴不再借 super_ip）全部接管。
- **修复②（陈述句门，方向 2）**：新题 `name_form`（三态 entity_phrase/statement/unclear；锚=「判名字本身的语言结构，不判指向对象的影响力」「口号/宣言不算陈述」「中英文名取更完整的一个判」）。mapper：`statementNameBlock`——choice!=='statement' 短路 null 零开销；=='statement' → 全类别硬拦（label「币名是事件陈述非实体指代（陈述句门）」），**C88 五腿不豁本门**（借壳口号豁的是载体/截断位，救不了名字本身不合格）。unclear fail-open 不拦。门链序 rm→st(atement)→memFloor→sc→tier（陈述句门先于 C88 mem 地板与载体门）。
- **事故反证（单测 D 组，J1.32 答案快照重放）**：D1 双门同命中（news_recap+statement）；D2 recap+entity → 改道 E 后载体门拦（mem 2.5+super_ip 0.3 破五腿隔离，防 C88 地板先手遮蔽）；D2b 案值 mem 1.72 → C88 地板拦（J1.32 线上漏放位今已被 C88 收编）；D3 narrative_finding+entity 维持 F 仍拦（真发现不误伤）；D4 mem 2.5 五腿全中形状 → **陈述句门是唯一拦截位**（其余门全被豁）；D5 statement 换 entity 对照 pass=true（门的必要性正证）。
- **断言**：`_test_jev_finding_recap_statement_gate` 52 断言（A 问卷形状 19 题+两新题三态/B 改道真值表/B4 改道后 E 载体门接管/C 陈述句门全域 8 类别+放行臂+五腿不豁专项/D 事故现场反证/E 审计 stage1 nameForm/findingVsRecap/categoryForced+stage2 双写+probabilities 两键/F 源码口径门链序+改道公式+fail-open）。52/52 绿。
- **随动与回归**：版本 bump J1.36→J1.37（两新题 17→19），三个 pin 随动 `_test_jev_resonance` D5（题数 17→19）/_test_superip_standard_path D2/_test_name_image_consistency A1；`_test_web3_fit` B8 断言改隔离轴（E 类 fit mass 0.2<0.5 由 J1.36 折损另拦属正确行为，C93 遗留非本次引入，git stash 验证 HEAD 同败）。mapper 家族 13+6 全绿（`_test_jev_product_entity` D2b 存量失败已知非本次引入）。
- **部署语义**：零 DDL；**版本 bump=断代**——J1.37 起旧缓存行（J1.32 快照）与新题集不互评，存量行不重评（观察期语义）；新题答案缺失（旧调用形状）fail-open 不拦不误伤。182 narrative worker 未重启=生产仍 J1.32（C88/C93/C96 改动全部待重启生效，重启前须核实实验持仓）。

### C95 永生蝴蝶「代币名=账号名」项目形状调查——整案撤销：名单号=作弊嫌疑，现状拦截即正确防线（2026-10-18 用户终裁原话「实际命中分支 A 频繁发币者名单，如果是这样，这个票可以不改。恐怕是作弊」；永生蝴蝶 0x6ac90ad607ead644148962458f298f1e42e27777 案）★

- **案发现场（永生蝴蝶）**：fourmeme 2026-10-18 05:42:51 创建、06:03:56 毕业（21 分钟）无信号。时序全表：①05:37:24 主推 @BurnFloor_（早于创建 327s）正文「多重托底共识协议/三大IP联盟」**通篇无「永生蝴蝶」字样**（token name「首创多拖底协议」拖 vs 正文「托」一字差）；②作者 display name=「永生蝴蝶」**全等** token symbol；粉丝 129；③05:42:51.43-52.79 C84 触发模型 round 1 真跑 1.36s → rating=1；④05:47:36 作者发 CA 宣告推（x.com/BurnFloor_/status/2111695673850733027，og:description 全文即 CA，已验证）——**晚 round 1 结束 4 分 44 秒**；⑤无补轮（语料推文型 accountOnly=false 设计内，轮次表实证仅 1 轮）。
- **逐层根因（为何没走账号路径）**：①classifyTweetType 命中**分支 A 频繁发币者名单**（frequent-issuers.mjs:167 `'burnfloor_'`，C76 收录 40 次发币；上等羊×2/八仙共建×2）→ angle_seeking（优先级高于分支 B，129 粉 0 互动也会命中）；②precheck 规则 2.1 expired_tweet 非豁免桶 300s 窗（lag=327s 超 27s）→ 拦 → rating=1；③detectIssuerSelfLaunch（C7）条件 1 品牌同一性**命中**（author_name≡symbol）但条件 2 宣告指纹 miss（正文无品牌词）→ null；④NarrativeAnalyzer 执行序 precheck 早退（:531/:543）先于 prestage 路由（:634）——即使 issuerDetected 命中 expired_tweet 仍先拦死；⑤走到 prestage 也会死在地址门（129 粉质量门不过+语料无 CA+issuerSelfLaunch 不在 :643 skip 名单）。
- **决定性证据（用户指出，已验证）**：CA 宣告推 05:47:36 晚到——round 1 时刻 issuerCa 归属实锤尚不存在，且 rating=1 后非账号型永不重析（「issuerCa fail-open 等下次」在触发模型里没有「下次」）。若 05:47:36 后重析：issuerCa 命中 → 转 prestage（:643 现有 skip）→ Jev P1.10 project mid（129 粉定档不拦截）→ rating=2 可买，距毕业还有 16 分钟——「走账号判断应该能过」推演成立。
- **中间设计推演（已全案撤销，留档防重复劳动）**：曾按用户四项中间裁定设计全套修复——display name 同一性新臂+名单压制（弱证据臂）/issuerDetected 豁免 expired_tweet/地址门交 Jev（P1.10 已有 `prestage_abm_name_link` 题但仅 addressVerified=false 臂采信）/CA 证据探针（30s 拉作者时间线零 Jev 找 CA，命中发起 ca_probe 轮）。设计期两关键技术发现一并留档：①`narrative_analysis_rounds.trigger_reason` 有 CHECK 约束 `IN ('condition','retry')`，新增 reason 值必须 DDL；②round 1 未命中 CA 会把无 CA 列表写进全量 key `twitter_user_tweets:<uid>`（6h TTL），round 2 的 invalidateAccountCorpus 对推文型语料被形状门拦下 → issuerCa 泳道吃旧缓存再 miss——探针命中必须预热 CA 专属 key `…:ca:<addr>`（读序先于全量 key）。完整方案存 plan 档案 web3-eager-deer。
- **终局裁定（整案撤销）**：典型受益者就是 frequent-issuers 名单号（40 次发币作业号）——名单号=作业号=作弊嫌疑，classifyTweetType 分支 A → angle_seeking → expired_tweet 拦截链**现状即正确防线**，本形状不留任何豁免口。四项中间裁定与「维持 C85」裁定全部被终裁取代，**不得据中间裁定直接实施**；C85 GMGN serial issuer 门（project 类 gmgnIssuerTokenCount≤1）对 burnfloor_ 也仍拦（即使全链修复也买不到，佐证撤销无损）。
- **复查条件**：未来出现**真实非名单号**案例（display name 全等 + CA 宣告晚到 + 发币 <30 次 + Jev web3_fit/量级判据过得去）再重启此案调查——台账此条与 plan 档案为完整出发点。
- **部署语义**：零代码改动、零 DDL、零测试、零部署。纯调查结案。

- **案发现场（京小安）**：北京日报官微源（weibo.com/1893892941/Rn6Y2CPcP）的「全市首款 AI 警犬」新闻，1 粉小号 @PFIKTP 找角度转述（0 赞 0 转，lag 3s）+ 配图。Jev 信号全判对：B 类 0.52 / **web3_fit strong_fit 0.57**（AI 警犬形象契合）/ subject_entity=product_character 0.53 / exact_match 0.96 / 载体 existing 0.49——但 `event_magnitude 1.35 → D 档（0.75 置信）` 量级门拦截 low。微博原文未进 state（CG2.0 语料充分门判推文可理解跳过，stateStats others=0）=证据缺失，Jev 按「1 粉转述无传播证据」判小主体，方向上无可指摘——但发布主体量级在这类票上本不该有否决权。
- **裁定（三条）**：①「web3_fit 如果高，豁免发布主体…发布这个新闻的是什么主体就无所谓了，地方媒体，全国媒体，都可以」→ J1.23 A 类量级锚扩展到 B 类（effTier 锚 B）；②豁免力度选**双锚**——量级轴+传播轴（dim2<18 锚 18，C44「证据缺失≠零影响力」同款语义：dim2 B 类=发布方权重，小号转述票量的是转述者不是原始事件源）；③C88 mem 地板**维持拦**（名字玩味是独立于发布主体的拦截轴，不为京小安 mem 1.88<2 开洞）。哲学总纲（用户原话）：「web3 用户喜欢，符合用户需求才是最根本的。事件本身影响力如果特别大，可以豁免，但本质还是 web3 用户喜欢」——影响力特别大的票走 S/A 档高分既有通路（与本豁免正交），web3_fit 才是根本轴。
- **作用域边界**：仅 A/B 类（C/D/E 类量级=人物影响力/热点传播的客观规模，偏好不替代规模——J1.23 原限制保留）；纯功能产品票结构性不触达（web3_fit 题面「纯功能型不高于 marginal」→ strong_fit≥0.5 天然不满足，无需防线）；与 pubProxy 锚互斥（tierAnchored 锚 A 更强，`!tierAnchored` 前置保持）；B 类骑乘改道（rideMass）走 W 数学不进标准分支天然不触达；unfit≥0.5 负门先挂（J1.19，不喜欢→锚不救）。
- **锚值口径**：量级轴锚 B（27 分，J1.23 同值——B 档=过线最低量级带，不越权 A/S）；传播轴锚 18（J1.23 dimension2「风格契合 Web3 偏好」带下限=C44 IG 锚同值，只升不降 dim2<18 才锚）；京小安形状（mem≥2 版）落点 27+18+15=**60 恰过线**。
- **审计形状**：`web3FitAnchored:'B'` 复用（stage1 jev 段，B 类扩展后同键）；新键 `web3FitDim2Anchor:{from:原dim2}`（stage2 details，instagramDim2Anchor 同位）；reason `·Web3偏好锚(原判D档,strong_fit 57%)` + `·Web3偏好传播豁免(原7)`；finalReason 前缀 `Web3偏好传播豁免(C94)｜`；magnitudeTier 原判保留不受锚影响。
- **断言**：`_test_web3_fit_anchor` D 组 8 断言——D1 京小安实测快照 mem 1.88<2 **C88 地板拦维持**（维持拦裁定反证，先于量级门）/ D2 mem 2.2 形状 60 恰过线+审计三键+reason 双标 / D3 strong_fit 0.49 贴线 fail-closed 量级门拦维持 / D4 dim2 高带只升不降（锚 null 量级锚照常）/ D5 C 类双锚均不触达 / D6 B 类 unfit 0.88 负门先拦；A3 原「B 类不锚」反证改 C 类（作用域变化本身=断言更新）。20/20 绿；mapper 回归 10 文件仅 `_test_jev_product_entity` D2b 存量失败（2e92c54 基线同败，C93 已记录待裁定，非本次引入）。
- **部署语义**：mapper-only 切分，题集版本不动（J1.23/J1.24 同款先例——题面锚移不动 Jev 的分，代码切分才决定性）；182 git pull + 回归 → 重启叙事 worker 生效；存量 B 类 D/E 档缓存行不重评（观察期语义）。**影响面待观察**：B 类 + strong_fit≥0.5 + tier∈{C,D,E} 的存量拦截票是豁免新增放行面（182 可扫 `stage1_raw_output->answers` 复放 mapper 量化）；京小安自身重析仍死在 mem 地板（1.88<2，裁定维持拦）——本 case 救的是「名字有玩味点但主体证据缺失」的同形状票。

- **案发现场（C92 遗留议题）**：유과 강아지 案同一次作答 `web3_fit` **strong_fit 0.97**（J1.19 题面「动物/萌宠形象」本来就是强契合典型）vs `event_resonance` **mild_amusement 0.79**——「web3 用户强偏好这个主题，但不会被触动去参与」两句放一起不成立。用户问「萌宠这个类别 web3 用户很偏好，mild 是为什么」，终裁升维：判定轴不该存在圈内圈外之分。
- **根因（题的判定轴对 Jev 不可观测）**：resonance 量的「事件对 Web3 用户的情绪行动力」——Jev 只见语料不见链上行为，它推断「web3 用户会不会被触动」的唯一素材就是「主题合不合 web3 口味」，与 web3_fit **信息集完全同源**；独立作答不产生新信息，只产生矛盾作答面。叠加例文锚定：「轻度有趣=圈外有趣现象」把「圈外」焊死在 mild 档定义、「无感=圈外传播量再大也不改」，Jev 实际按**圈层归属**归档而非**情绪强度**。C80 立项本意（蝙蝠侠摇「web3 用户纯旁观」）被例文腐化成「圈内/圈外」proxy 轴。
- **两案数据（B 案裁定的实证基础）**：①蝙蝠侠摇（J1.30 历史行）web3_fit 实测 strong 0.38+fit 0.38=**0.76**≥0.5 → 替换后**不折=放行**——C80 防线的唯一已证拦截案失效，用户明示接受（web3_fit 0.76=Jev 认为口味契合，当年 31s -12.4% 归盘面/时机非叙事错判；且 J1.29 载体门 E 类只拦 no_visual、J1.19 负门要 unfit≥0.5 实测仅 0.08，该票本来靠不上其它门）；②유과 0.97 → 不折（本案 J1.31 mild×0.5=35.64 误拦修复）。
- **裁定落地（B 案：机制保留、判据源替换）**：`event_resonance` 题删除（**18→17 题**）；E 类折损机制保留，判据源换 web3_fit——`(strong_fit+fit) < 0.5`（marginal 占优=Web3 用户不太喜欢）→ tierScore+effDim2 ×0.5（时效不折不变）；≥0.5 → 原公式。0.5 阈值与 J1.19 负门/J1.23 锚/J1.27 接纳门同一条线（心智一致）；unfit≥0.5 全域负门已拦不归本层；「喜不喜欢」单轴连续语义：strong/fit 多数→不折、marginal 偏多→折半、unfit→负门拦。A/B/C/D/W/F/G 不折（裁定域 E 类 only 不变）。
- **fail-open 边界**：web3_fit 答案整体缺失（**J1.19 前**旧缓存行）→ 不折（hasW3f 门：probabilities 空=缺证据，宁放不误折）；J1.31-J1.35 行有 web3_fit 答案可重放新逻辑（存量不重评=观察期语义，回测/校准重放生效）。
- **审计形状**：`resonanceFitMass` 恒落数值（=strong_fit+fit 概率和，缺答案 null，阈值事后校准免重跑）；`resonanceDamp {fitMass, coef}` 命中才落；`eventResonance` 档位字段与 `probabilities.event_resonance` 随题删除退役（J1.31-J1.35 历史行不再产生该键）；reason 段 `｜感染力折损×0.5(web3_fit契合30%<50)`（判据源可追溯）。
- **断言**：`_test_jev_resonance` 重写 13 断言——A 双案反证（蝙蝠侠摇 0.76 不折 70.68→75.68 high 放行裁定 bit-identical / 유과 0.97 不折 / marginal 0.3 →×0.5=42.84 拦 C80 数字沿用）、B 边界（web3_fit 缺失 fail-open / fitMass 恰 0.5 严格 <）、C 作用域（A 类不折/W 不触达/D 档归因量级门）、D 审计与源码（damp 载荷/字段退役/题集 17 题无 event_resonance+版本锁 J1.36）；`_test_superip_standard_path` D2 / `_test_name_image_consistency` A1 版本锁 → J1.36（20+41 绿）；`_test_jev_product_entity` A2 题数反向 bump 18→17（⚠D2b「C56 平台官方源豁免三处接线」存量失败，2e92c54 基线同败非本次引入，待另行裁定）；`_test_superip_slogan_class` 四 fixture 带旧 event_resonance 键（历史行形状兼容性天然验证，51 绿）。
- **部署语义**：182 git pull + 单测回归 → 重启叙事 worker + 实验进程（重启前持仓确认规程）后生效；存量 J1.31-J1.35 缓存行不重评；E 类历史窗口回测要触发新折损逻辑用既有 invalidate-resonance-window.cjs 同款失效（prompt_version 升版本身即天然断代线）。行为变化点明示：**蝙蝠侠摇形状（E 类大传播+web3_fit≥0.5）由 mild 折损拦变放行**——观察期盯 E 类 marginal 带（fitMass<0.5 拦截面）与放行票盈亏。

### C92 E 类证据层级重写（J1.35）——缺数据=信陈述，找角度票不再被结构性封顶 C（2026-10-18 用户裁定原话「它陈述了爆火就信爆火，它给了传播数据就依赖传播数据判断，它给了社交网络链接就去取数据判断；除非它说了爆火，但是传播数据很弱」+「这只是个找角度推文，它的传播数据并不是这个事件的传播数据」；유과 강아지 0x9d956023c76a23509b8195e9cb635178a35e7777）★

- **案发现场（E 类四层连环）**：韩网疯传长条白柯基，中文找角度号（302 粉）发射、父推=韩文原发帖（june_kyuuu 2177 粉）。Jev 判 `event_magnitude` C 档（P(B)=0.25 压线未过）+传播 19.28+时效 15 → 原始 56.28<60，再叠 C80 感染力 mild_amusement 0.79 ×0.5 → **35.64<60 拦**（blockReason「事件分不足」）。用户两级质疑：①传播/量级不该被找角度推文数据锚定；②「韩网爆火」不该落区域小热点档。
- **根因一（题面规则自相矛盾，本次修复）**：J1.20 同日落了两句打架的规则——dimension2「爆火/热搜/疯传直接采信」vs event_magnitude「任意 2 项→B / 仅 1 项→C」升级规则 + B 档量化锚（播放 100万+/点赞 50万+）。找角度语料天然无量化数据（发射推+父推两条推，连父推互动数都没进 state），2 项凑不齐是**语料形态决定的常态非票的缺陷**——实际效果=E 类找角度票结构性封顶 C 档 22 分起点，把「直接采信」架空。Jev 在矛盾中打折执行（本票 dim2 概率摊在小圈子 0.39/强+极强 0.33、mag P(B)=0.25）。
- **裁定落地（四行证据层级，题面重写）**：①有事件层量化数据（被引述源头/父推帖互动数、转述播放量/热搜位次、媒体大规模报道）→按数据定档；②无任何量化数据、仅热度陈述→**直接采信**（爆火/疯传/大爆/热搜级→B 档起，全国/全球级→A/S）；③说爆火但事件层数据明显弱→数据推翻陈述降档；④发射推/找角度推/回复者自己的粉丝与互动数**不是事件传播数据**（十万粉级以上父推=大V扩散通道证据照常计——那是「事件出圈到大V层」，与拿父推互动数当事件数据两回事）。「任意 2 项→B」升级规则废除。C 档「无源可溯」封顶收窄为**主体存在性**（查无主体/编造嫌疑）——程度无量化数据不再触发（7777 作业票防线保留在主体查无臂）。
- **根因二（fetch 层丢数据，本次已修）**：父推 `in_reply_to` 组装只映射 text/作者/粉丝数/media（`twitter-fetcher.mjs` ~255），**互动数全丢**——实测该父推（事件源头帖）API 返回点赞 **58,730**/转发 10,324/引用 582/浏览 **932,891**（getTweetDetail 响应里字段现成；`quoted_status`/`retweeted_status` 都有 metrics 映射唯独父推没有，渲染层三个被引述段也全无互动行），分析时刻 Jev 一无所知，只看到 2177 粉作者 → C 档。裁定第③行「给了链接就去取数据判断」：取了、回来了、**组装层扔掉**。修复：fetcher `in_reply_to` 补 favorite/retweet/view/quote 四字段；`twitter-section.mjs` 【回复的推文】/【引用推文】/【转发推文】三段渲染互动行（`【推文互动】点赞 X / 转发 Y / 浏览 Z / 引用 W`，view/quote null 不显示；存量缓存行无 metrics 键不渲染=bit-compat）；**主推自身互动行刻意保持旧两项口径**（陈述者自己的数据不是事件数据，层级④）。
- **遗留议题（感染力轴自相矛盾，待裁定）**：同一次作答 `web3_fit` 给 **strong_fit 0.97**（主题极度合 web3 口味）而 `event_resonance` 判 mild 0.79（crypto 圈不会主动传播）——两题答案互斥。resonance 题 strong 档例文全是圈内事件（黑天鹅/大瓜/自嘲/喊单），Jev 被例文锚定成「圈内/圈外」主轴，把「web3 用户天然偏好但源自圈外」的萌宠梗（DOGE 先例形态）误归 mild；C80 下 E类+mild 数学封顶 49.5 必死。本票即使量级修到 B（27+19.28+15=61.28 过线）仍需感染力翻 strong 才能真正通过。
- **断言**：新增 `_test_parent_tweet_metrics`（11 断言：事故现场数字反证 58730/10324/932891/582 全渲染、存量旧形状 bit-compat 恰 1 处互动行、引用/转发段补显、null 收窄、fetcher 源码四字段映射、主推口径不变）；`_test_superip_standard_path` D2 / `_test_name_image_consistency` A1 版本锁 → J1.35（20+41 项绿）；`_test_referent_memeability` 不涉版本锁（20 绿）。mapper 零改动（证据层级纯题面，档位映射/分表不动）。
- **部署语义**：新析/直调进程重启后生效；存量 J1.32-J1.34 缓存行不重评（观察期语义）；E 类找角度票历史窗口回测先跑 invalidate-*-window 系列同款失效。

### C91 mem 题主轴重定义（J1.34）——玩味价值=web3 当前或潜在影响力，对象类型中立（2026-10-18 用户裁定原话「币安的产品在币安链上怎么就没有 meme 玩味价值？你不能认为是个产品就没有meme玩味价值，跟不能认为是个人就没有玩味价值一样，所谓玩味价值就是Web3的影响力吧？」+ 补「或 Web3的潜在影响力」；commit 8d3d31b）★

- **三段演化现场（BI 0x3891…7777，C88 立案四票之一）**：①C88 时五腿全中 mem 2.19 → 救回 mid 56.11；②J1.33（C90 人物高度修正）重析——该修正帮不到 BI（指代对象非人物：subject_entity=product_functional 0.6），mem 1.86<2 五腿差 mem 腿落地板 low；③J1.34 重析 **mid 56.12**——mem 2.4（3 档 0.40+4 档 0.17，重心移入 3-4 档）五腿全中 `superIpSlogan.hit=true` + J1.30 名图一致豁免双命中（事件 65.76×0.6=39.46+质量 15.66+关联 1）。
- **根因（J1.33 同族病灶的产品臂）**：mem 题 1 分档例文「普通公司/组织名」、2 分档例文「产品功能名」把产品/机构类对象**按类型**压向低档——BI 指代币安系产品（币安链上圈内顶流），本该高分却被例文锚到 1-2 档。与 C90「是人→0 档」同款：类型≠玩味价值，对象自身在 web3 圈的高度才是。
- **修正（主轴重定义，非逐类打补丁）**：instructions 主轴句改「玩味价值的核心=对象在 web3 圈内的**当前或潜在影响力**和符号性——圈内用户认不认它、玩不玩它，或对象自身禀赋（量级/题材/与 crypto 的关联）是否足以让圈内用户大概率接住它」+「对象类型（人物/产品/公司/机构/事件）不作分档依据：『是个人』或『是个产品』不构成低分理由，『**无名且无潜力**』才无玩味空间」；币安级顶流产品与「尚未出圈但禀赋足以预期圈内接住的新事物」（潜在影响力臂）显式点名按 3-5 档评。档位收窄：0 档「无名普通对象」（人/小东西并列）、1 档「**圈外**严肃对象」（圈内顶流机构显式排除）、2 档「**无人知晓的**普通产品功能名」、3 分档补「圈内知名产品/平台/人物」例。
- **消费点零改动**（J1.28 ≤1 门/C88 五腿 mem≥2 腿/mem 地板均纯分数门）：无名圈外票口径不变照拦；圈内产品/机构票 mem 上移 C88 五腿可达。与 web3_fit 分工不变（fit=事件主题口味，mem=指代对象符号性）。
- **断言同步**：`_test_referent_memeability` A4 更新（类型中立+潜在影响力+3 档产品例三断言）；`_test_superip_standard_path` D2/`_test_name_image_consistency` A1 版本锁 → J1.34；五单测 154 项全绿。
- **部署语义**：182 已 pull 8d3d31b（新析/直调进程即刻生效）；worker 未重启=生产链路仍 J1.32，随 C88 部署门同批；存量 J1.32/J1.33 缓存行不重评（观察期语义）。

### C90 mem 题人物高度口径修正（J1.33）——0 档「人名」一刀切废除，玩味空间按人物自身高度评（2026-10-18 用户裁定原话「这个扯淡，要看人是什么样的人嘛，普通人当然没有，CZ当然可以」；commit 3440275 message 误写 C89 已勘误——C89 已被 GMGN 钱包画像层占用）★

- **三段演化现场（暗号資産の覹者 0x926ce819…7777，CZ 出书簇 C88 立案票）**：①J1.32 初跑（10-18 00:14）low——rcp argmax 五五开（rcp 0.44 vs none 0.41）误拦；②C88 部署后重析（03:54）仍 low——Jev 答案全面翻清晰（量级 A 档 4.81/block none 0.48/super_ip 0.79/strong_fit 0.97/exact_match 0.84），五腿**四中差一**：mem 1.96<2（差 0.04），落 mem 地板臂拦；③J1.33 修正后重析（04:06）**80.56 high**——mem 3.53（4-5 档概率质量 0.57）+ super_ip 0.88 → 五腿全中 → C88 口号票豁免命中（事件 78.44×0.6=47.06+关联 20+质量 13.5；量级 Jev 自判 S 档 39，两次调用 A→S 属模型波动）。
- **根因（用户点破「明明是强口号性」追问而来）**：mem 题评估对象钉死为「币名指向的指代对象本身」——本票指代对象=super_ip（CZ 真人），原 0 分档「人名/账号名/周边人物是『一个人』不是内容」把一切人物压向无玩味方向；**名字文本自身的宣言式口号性被该限定排除在评分范围外**。Jev 概率分裂（0 档 0.28 按人名口径 vs 3 档 0.33 按口号口径——题面 3 分档明明列着「口号」）加权落 1.96：不是 Jev 觉得名字不口号，是尺子量不到名字。C88 五腿 mem≥2 腿/mem 地板拿「对象玩味」的尺子量「名字口号性」，暗号票（名字口号强+指代对象是人）正落错位缝里。
- **修正（语义修正类措辞，非分数锚定）**：0 档收窄为「无名普通人名/账号名/周边人物」并内嵌反例声明「人物不因『是人』恒归本档——已是圈内文化符号/被大规模玩梗二创的超级人物（如 CZ）按 3-5 档评」；instructions ① 同步（「无名普通人归 0 档；超级人物其人物符号性即内容载体，按 3-5 档正常评分」）。**消费点零改动**：J1.28 ≤1 低档门/C88 五腿 mem≥2 腿/mem 地板均纯分数门——无名普通人票口径不变照拦（minor_other 票无影响），超级人物票 mem 上移 C88 五腿可达。
- **断言同步**：`_test_referent_memeability` A4 正则更新（0分：无名普通人名+「只有无名普通人才归本档」）；`_test_superip_standard_path` D2/`_test_name_image_consistency` A1 版本锁 → J1.33；四单测 132 项全绿。
- **部署语义**：182 已 pull（新析/直调进程即刻生效，reanalyze 即此路径）；**narrative worker 未重启=生产链路仍 J1.32**，随 C88 部署门同批重启生效（存量翻转面 137 行/mem 地板拦截面 287 行两清单已随 C88 待过目——**J1.33 后者拦截面子集预期收缩**，重启用 scan-c88-flip-surface.cjs 重扫）；存量 J1.32 缓存行不重评（观察期语义，C74/C88 同款）。

### C89 GMGN 钱包画像层（wallet_stats 接入）——Agentum 快枪捆绑/Konasu 对倒/7777 sybil 三案的跨盘维度补轴（2026-10-18 用户调研指令「GMGN的钱包API，似乎提供了钱包的进一步信息…请帮忙调研一下，它的API提供的信息有没有我们想要的」；架构用户裁定「先把系统中钱包的画像下载下来，存储到数据库中，否则Live 引擎效率满足不了」+分阶段先观察后上门）★

- **调研结论（182 实测 12 case 钱包 + 3 新盘钱包）**：`GMGNPortfolioAPI.getWalletStats`（已有封装此前零消费，单钱包端点 ~300-800ms）关键字段=`common.tags`（fresh_wallet/gmgn/gmgn_go/fomo/smart_degen/launchpad_smart/arbitrager）+ **`common.created_at` 钱包创建时间（秒级）** + fund_from + buy/sell/token_num 三元组。**bundler/sniper 钱包标签在 case 钱包全部未出现**（GMGN 网页「捆绑」标记是交易聚类展示≠钱包 tags）——如实告知；`smart_degen` 正面标签出现在 Konasu 对倒 creator=**方向性陷阱，任何单标签不得作好/坏判据，只用簇指纹**。时效实测通过：33 秒前刚交易的钱包立即返回完整画像（全史属性不依赖本盘索引）。
- **指纹判别力（三案现场）**：①同分钟创建簇最强——Agentum B 差 61s/Konasu 差 1min 都命中，**滑动窗 300s 不用固定分钟桶**（61s 跨分钟边界漏）；部分老钱包 created_at=null 不进分母不误伤。②镜像行为统计强但只在 ≥2 钱包一致——**精确相等两案都不命中**（Konasu 707/707/710 差 0.42%、Agentum A 7/7/24~25 差 4.2%），容差臂 buy/sell≤1% ∧ tok≤10% ∧ buy≥5（低频噪音门）两案都命中。③fund_from 同源中（刻意分散入金即失效）；④fresh_wallet 弱（BSC 新散户多）——簇状双门槛（数量∧占比）单钱包永不拦。
- **架构（离线建库优先）**：新表 `gmgn_wallet_profiles`（address PK 全局资产不挂实验 FK，wallet_offline_profiles 同款；**与合表方案三硬冲突后用户裁定新建**：threshold≥3 HF 门行域错位/空行结论短路 7 消费方 miss 分支/双写者 upsert 互相覆盖）+ 离线批量 `scripts/build-gmgn-wallet-profiles.cjs`（182：近 N 天 ticks 买入钱包去重→逐钱包→upsert，增量=fetched_at 新于 refresh-days；**GMGN 无记录空数据行也落表**——表 miss ≠ 无记录，空行=已确认结论，7777 sybil 全新钱包场景不重复烧配额）+ 触发窗增量回写（引擎 `_walletProfilePrefetchCheck`：tokenAgeSec≥25s + 500ms 节流 + 仅配 gmgnCheckCondition 的实验）+ fire 查表（miss 补查 ≤2/次、join ≤1.5s、日预算 2000/失败冷却 10s/RATE_LIMIT 全局冷却 60s）——**fire 延迟常态 0**。
- **gwp* 18 键并入 `checkAndEvaluate` 第五参**（null/缺省不并键=存量零影响；GMGN_CONDITION_FACTOR_KEYS 5→23 键）。**gwpCovered 三态**：selected=0（early 窗冻结/无买家）→ null（条件串 IS NULL 臂放行，C85 narrativeCategory 同款）；任何钱包无结论（失败/预算耗尽/冷却）→ 0 fail-closed 拒；全结论（含空数据行）→ 1。young 用 created_at 龄判不依赖 fresh 标签（标签滞后 4 天才打上），young/fresh 分开计数观察口径差。
- **回测不接线**（emptyFactors 显式 null）：gwp 动态计数是今日取值对历史 fire=时序穿越，跳过比穿越诚实；结论口径=「不含 gwp 门的相对增量」显式声明。
- **单测**：`_test_gmgn_wallet_stats_service` 39 项（A 纯函数 17：两案容差臂/滑动窗跨分钟双反证/null 不进分子/低频噪音门/young 闭区间边界；B 标签陷阱 3：键集零正向放行键源码反证；C 状态机 14：表命中零 API/补查回写合成簇/空行结论/失败冷却零重打/预算截断/selected=0 null/inflight join/预取暖库；D 门草案 ConditionEvaluator 真跑 6：Konasu 拒/Agentum A 放行两臂分工/IS NULL 放行/covered=0 拒/7777 sybil young 臂拦）+ `_test_gmgn_wallet_stats_layer` 29 项（键集 23 恰好/第五参存量零影响/硬拒优先/引擎源码口径八断言/FA getEarlyTopBuyers 五臂/回测不构造/17 键漂移防线/validateLegs）。回归：`_test_gmgn_check_layer` 56 + `_test_gmgn_risk_factors` 20 + `_test_narrative_trigger_condition` 37（E5/H5 源码口径随第五参/预取插位更新，防线语义不变）+ `_test_fa_early_trades_factors` 33 全绿。
- **上线节奏（用户裁定分阶段）**：Phase 0=代码落地默认关（enabled:false 物化，存量 bit-identical）→ 182 DDL 建表→离线回填（dry-run 先行）→ Phase 1 观察模式（v22 实验级 enabled:true，gwp 键只落 metadata 不进条件串，观察期 ≥1 周/≥200 次评估）→ Phase 2 门生效另行裁定（门草案 `(gwpCovered IS NULL OR (gwpCovered==1 AND cCluster<3 AND nMirror<3 AND (young<3 OR youngBnbPct<60)))` 阈值由观察期分布校准）。

### C88 CZ 出书事件簇四票两向失败——超级IP事件口号票五腿救援 + mem 口径地板（J1.28 扩展臂）+ narrativeSuperIp/Slogan 零列标签（2026-10-18 用户裁定「是否超级IP，可以作为一个代币的叙事分析标签，也同样返回给实验引擎并展示在界面上」；编号撞车 09c121c 误用 C87→勘误 C88，commit 3aa0690 + bc432ad）★

- **两向失败四票（同一 CZ 出书事件簇）**：①暗号資産の覹者 11.8x 毕业 rating low——rcp argmax 臂（referent_memeability 档位）拦；②BI（关联票）4.86x low——J1.29 载体门拦；③币安上电视 high 77；④CZDOODOO high 76——③④在跑全死。**同一簇「真超级IP事件+名字有口号性」被现有门系两向误拦/跑死**＝识别缺口：事件真、名字像口号（slogan-like）、关联分低是因为名字走暗号而非蹭名。
- **五腿救援（superIpSlogan hit）**：`super_ip≥0.5 ∧ 关联腿含引申（relPositive≥0.3 且 relNone<0.5）∧ mem≥2 ∧ timing fresh ∧ strong_fit≥0.5` 全中 → 豁免 rcp 双臂 / J1.29 载体门 / Stage3 品牌劫持臂+关联≤10 截断 / C86 D-1 magExempt<60 量级门事件分不足臂；**刻意不豁**：nhn/w3/pe/nr/rm/quality、D/E 档量级臂、W 数学 pass 线（弱量级代价在总分）。**不送分**：BI 诚实 mid 56.11（五腿只拆拦截不抬分）。审计 `stage2.jev.superIpSlogan {hit,superIp,relPositive,relNone,mem,timing,strongFit}` C88 后恒落（旧行缺键→null）。
- **mem 口径地板（J1.28 扩展臂，memFloorBlock）**：标准数学域 ∧ timing fresh ∧ `mem<2` 拦——「蹭热点但名字无口号性」（③④形状：事件真、关联可建，但名字是描述性/玩笑性蹭法而非口号，在跑全死）。审计 `stage2.jev.memFloorBlock {mem,timing}` 命中才落。
- **narrativeSuperIp / narrativeSuperIpSlogan 零列标签**：`deriveSuperIpLabels(stage1,stage2)`（`src/core/narrative/superip-labels.js`，CJS 单实现双生态）从既有 stage JSON 推导不落 DB 列——superIp=`stage1 jev.probabilities.name_referent.super_ip≥0.5→1/0`、slogan=`stage2 jev.superIpSlogan.hit===true→1/0`；三态（1/0/null）与 narrativeCategory null 放行臂同形；三路消费（response-parser 缓存路 / NarrativeAnalyzer 新鲜路 / BacktestEngine preload）+ `getExperimentNarratives` 出列 + FA fire 因子表两字面量键（引擎可写策略腿 `narrativeSuperIpSlogan == 1`）+ token-returns badge；**GMGN 条件键集刻意不加两键**（G16 反证：爆炸面最小，只进 FA fire 因子表）。
- **★ 落库信封 bug（上线后当日发现修复，bc432ad）**：初版 `deriveSuperIpLabels` 只认 `parsed_output` 键，而落库经 `buildStageSaveData` 把 parsed_output 整包转进 **`details`** 键——三条 DB 路（formatResult 缓存路/回测 preload/getExperimentNarratives）恒 null，v22 659 票实测全 null 实锤，仅内存新鲜路可用。修复=`s?.details ?? s?.parsed_output ?? null` 双形状（不递归搜索防掩盖形状漂移）。**漏测根因=单测 F 组只测内存形状**，补 F8（落库信封 details 形状）/F9（Supabase 惰性 text JSON 字符串）两臂，51 passed。教训：**跨形态消费的推导函数单测必须覆盖落库信封形状**（DB 行≠内存形状）。
- **实验叙事结果页整页重写（bc432ad，web 层）**：`/experiment/:id/narrative` 从极薄页重写为实验层面叙事分析结果页（交互参考 c88-review）：评级 tab+类型 chips+搜索+排序+行展开明细（管线 6 段卡/Jev 关键答案/C88 审计盒/涨幅三键面板/C84 轮次表/拦截点五级定位）；service additive `final_change_percent/peak_mcap_usd` 两字段（profileMap 已取回零额外查询）。旧行 mem 从 raw answers 兜底、C88 审计盒正确缺席。
- **部署门（进行中）**：182 narrative worker 未重启——`superIpSlogan`/`memFloorBlock` 键 mapper 恒落需 worker 进程加载新代码，重启前 v22 slogan 列全 null 属预期；**两清单待用户过目后才重启**（C88 五腿存量翻转面 137 行 / mem 地板拦截面 287 行，`scripts/scan-c88-flip-surface.cjs`）；superip-labels bug 修复随该次重启一并生效。存量叙事缓存行不带五腿键=救援不翻旧案，新析才生效（观察期语义，C74 同款先例）。
- **单测**：`_test_superip_slogan_class.cjs` 51 项（四票事故反证精确值+五腿负臂+mem 地板边界+豁免域+标签三态+F8/F9 落库信封+16 源码口径断言）；`_test_fa_narrative_factors` 30 项全绿。

### C87 pumpfun 专职找角度 dev 批量黑名单——「大量发币 + 宣发全英文」跨链作业号 51→49 收录（2026-10-18 用户标准「我所谓的专职 pumpfun dev 的特点是，大量发币，并且都使用英文」+「基于这些账号的推文，不应该在 BSC 链发币」；黑名单 11→62，cef31a6/13addcf/09c121c）★

- **语义（与 C76 对立分层）**：黑名单命中=precheck 规则 1 `low/'blacklist'` **终判全拦**（先于 classifyTweetType）；C76 frequent-issuers 命中=angle_seeking→C74 300s 快发票窗（放行语义）。同号在两侧时黑名单先执行。
- **收录构成**：点名 2（grok12_john/thedudethatdev）+ A 档 43（低粉 <2000 + 英文推样本验证 + 被挂 n≥25 实锤；推文模板直提 pumpfun）+ B 档 8（dev/sol 风格高 n 无语料证据：quantsdev1223 n=619 等 + gewortra 经 tundukbsc/bleachfan2000 推文 @ 它作业交叉实锤）。**2116dd5 勘误剔 2**：wangzbnb（2/4 条成段中文=CZ/BNBC/MALI 叙事 BSC 本土号，1 粉被挂 186 次）+ 123greenapple（3/8 条成句中文=BNB Chain L1/PRIVACY Cat 同款）——**误收根因=语言验证单样本 limit 1 恰为英文推；判定尺度=宣发以中文为主/成句中文才算中文号，英文推夹中文专名（乌兰察布市/猪小肠/啾啾）保留**；复查脚本 `verify-blacklist-language.cjs` 62 号×8 样本，其余无中文混发。（dev/sol 风格高 n 无语料证据：quantsdev1223 n=619 等 + gewortra 经 tundukbsc/bleachfan2000 推文 @ 它作业交叉实锤）。
- **甄别链（可复跑）**：`scripts/scan-angle-devs-blacklist.cjs`（182 跑，experiment_tokens 579216 行全量 (creator,handle) 边表——v1 只存 creator top6 会漏轮换号）→ token 全名零 CJK 过滤候选 725（n≥15）→ `scripts/fetch-followers-for-candidates.cjs`（token_narrative.**twitter_info 独立 jsonb 列** contains 单号查，非 raw_api_data 内）取粉丝+推文文本 → 分层。
- **必剔原则**：①品牌/官方（robinhoodapp/pancakeswap/pumpfun/kalshi/google/openai/vladtenev/binance 系）②真人媒体/名人（≥5 万粉 52 个）③中文推文号（genyrational/beyourloverboy/haishenling 等 6 个——token 名全英文但推文中文，**语言判定必须用推文文本不能只看 token 名**）④大 IP（uniqC 巨大+creator 长尾）。
- **关键数据洞察**：bigC 高（被 ≥100 高发 creator 挂）=公共英文语料源信号（媒体/品牌），不是 dev 自有号；自有号签名=低粉+英文+creator 相对集中（top1Share）。139 rich-js DB 无 pumpfun creator/twitter 元数据——BSC 投影（experiment_tokens）是唯一可行源。
- **待裁定**：C 档 28（2k-5万粉，cis_binance 推文带未洗涤 `<think>` 标签=AI 假号嫌疑、esotericpigeon n=319/4073 粉）+ B 档无风格 15（sonny_crypto n=635 等）；C76 frequent-issuers 148 成员中的英文号是否升级黑名单（语义冲突需用户拍板）。
- **生效**：182 git pull + 重启叙事 worker + live 实验（重启前查持仓）；全档案 memory `pumpfun-angle-dev-blacklist-batch`。

### C86 叙事模块全量 Review 修复批——quoted_status 幽灵字段三消费点 + A/B/C 三级 15 项收口 + D-1 量级门豁免贯穿（2026-10-17 开放性 review 任务 → 用户裁定「修一下这些小问题」；全档案 `docs/叙事模块Review与流程整理-2026-10-17.md` §十一）★

- **A-1 幽灵字段（头条）**：producer `twitter-fetcher:186` 写 `quoted_status`，状态组装主链（twitter-section/account-backgrounds/tweet-type-classifier）读 `quoted_status` 本就正确；但三个消费点读 `quoted_tweet`（生产恒 undefined）——①mapper C68 找角度 6h override 载体源（引用推永远缺席=门退化）②precheck C74 分桶 tweetSources（引用推不计入「任一新即放」）③narrative-utils isProjectCoin CA 检查。**修复方向勘误：review 文档初稿写「统一 quoted_tweet」是反的**——多数正确+上游 API 归一（new-apis.js:573）双重证据，改三消费点读 `quoted_status`。**测试自洽掩盖教训**：`_test_angle_timing_override` 夹具同款错名 → 断言与错名自洽全绿但生产瞎（夹具改生产形状后 A7/B4 即事故反证）。
- **A-2~A-5**：fetcher 层黑名单大小写归一（d8dac73 只修了 config 层）；classifyTweetType followers 缺失 `?? 0` 归 angle 桶 → 改 `?? null` 落 unknown「粉丝数字段缺失」（**行为变化：粉丝缺失票移出 angle 桶=C68 override 覆盖面收窄，unknown 桶 300s 硬拦不受影响，偏放方向**；显式 0 粉仍 angle、likes/retweets `?? 0` 刻意保留=真 0 语义）；rule 2.2 视频时效五平台键对齐（youtube=published_at/weixin=publish_time 原取值链静默跳过 + tiktok fetcher 补 create_time 产出键）；t.me 正则边界锚 `/(?:^|[/@.])t\.me|telegram\.org/i`（rocket.meme 子串误归修复，`[/@.]` 不误伤 foo.t.me 子域）。
- **B-1~B-9 工程缺陷**：引擎轮询防重入锁（`_dispatchInProgress` try/finally）+ start() 孤儿 processing→pending 回收；B-4 缓存命中刷 analyzed_at（`meta.fromCache` 现成标记零新机制）；web-fetcher body 读取纳入超时窗（clearTimeout 移 finally）；weibo/tiktok/youtube JustOneAPI 家族 30s 超时纪律补齐；github 回退正则字面量 `[\\d,]` 死字符类（永不匹配数字）→ `[\d,]`；规则 1.2 回退正则补 twitter.com+边界锚；Worker dotenv 4 级出仓库→3 级；Worker parentPort error/exit 死监听删除。
- **C 级 ~850 行死代码**：response-parser 旧协议三解析器（:8-591，保留段零依赖 awk 核验）；twitter-media-extractor 整文件（含 data-fetch-service 第二处死 import——review 初稿漏记删除时补获）；rule 5 骨架（墓碑注 NIGGALON 案源流；`_test_rule5_pass_through` 升级「骨架整块不存在」源码反证+行为断言保留防直发复活）；rule 3.6/3.7 骨架（墓碑注 C66）；weibo 死函数对。prompt-builder 刻意保留（单调用点内联收益小）。
- **D-1 量级门豁免贯穿（同日裁定「修吧」=遗漏，豁免应贯穿）**：Stage2 量级门（tier+dim2）在 else-if 短路序中先于 C40 戏谑豁免/J1.30 名图豁免执行——豁免只豁 Stage3 截断不豁量级门，全条件豁免票若 tier D/E（J1.30 无 tier 前置可达）或事件分<60 会在到达豁免语义前被拦死。**修复**：豁免判定整块（relevance/brandHijackP/punExempt/nicMatchP/imgNameExempt，纯函数依赖全在门链前就绪）前移至门链之前，豁免本体条件一字不动；量级门两拦截位对 `magExempt=punExempt||imgNameExempt` 放行——①D/E 档臂（punExempt 要求 S/A 结构性死守保留=防豁免定义漂移，C85 IS NULL 臂同款语义）②事件分不足 pass 线 `stage2Total<60 && !magExempt`。被救票照常进标准数学（D/E tierScore=0，弱量级代价在总分 0.6×低事件分上体现——与豁免「relevance 10 分照常计入」同款计分语义），stage2 reason 落 `量级门豁免(J1.24戏谑/J1.30名图：D档臂与事件分<60臂不拦，弱量级代价在总分)` 可检索标注。**W 数学 pass 线刻意不豁免**（W 有 C42 专用豁免与 cashtag 改道拦截语义，量级门不属于 W 数学，测试锁定）；punExempt 自身 S/A 条件继续承担「tier 不足纯蹭名盘」拦截方向（C40 裁定原文语义不变）。mapper-only 题集版本不动；存量 token_narrative 缓存行不自动重评（C66 惯例，重析自然获得）。
- **测试**：新 `_test_narrative_review_fixes.cjs` 22 断言（A-3 三态真值表/A-4 五平台键/A-5 边界含子域正形/源码口径六条）+ `_test_rule5_pass_through` 升级 + `_test_angle_timing_override` 夹具修正（A7/B4 事故反证 + b4r 重声明笔误修复）；D-1 补 `_test_brand_hijack_pun_exemption` F 节（59<60 全条件戏谑票救援精确值/无锚对照照拦/W 线不豁免/源码三臂形状）+ `_test_name_image_consistency` G 节（D 档名图票双臂救援 totalScore=43 精确值/无图对照照拦/E 档一致性不足对照照拦）；回归 30 叙事文件 + Jev 门豁免 13 文件全绿。
- **部署**：本地 commit；**182 需重启叙事 worker + 引擎进程才生效**（未部署待用户指令）。

### C85 Nightshift 案 0x3ff9da6fd5f4608307bc4b71ec82c313a224ffff——叙事类型因子化（narrativeCategory）+ GMGN issuerTokenCount 分档门：serial issuer 的推特维度拦截（2026-10-17 用户裁定「把叙事分析分析出的叙事类型作为一个因子，Web3项目应该是其中一类，如果属于这一类，那么GMGN中返回信息的账号创建代币数量就不能超过1」+ AskUserQuestion 双裁定=适用集/fail-open）★

- **案情**：v21 双跑期买入净 -0.004116 BNB。作弊指纹：GMGN `twitter_create_token_count=6`（serial issuer）+ 回收 2011 年休眠老号 `___nightshift`（仅 1 条宣告推）+ top20 持仓 90% fresh 钱包 + 链上 creator=首买 0.4854 庄家已清仓。**fire 时刻（token 40s）该字段=0**（GMGN 索引未填充，covered=1 调用成功 251ms ≠ 数据就绪）——门对 40s 快 fire 天然失效，有效面=关联已建立的票/repeat 轮/晚 fire 票（用户接受 fail-open）。
- **信号方向否决史（本案三轮收敛）**：①「15 年号龄但只发过 1 条推文」被否——正常项目同形状（老号休眠多年、发币才发首推）②`gmgnIssuerTokenCount` 全量收紧被否——事件源账号被多方蹭发多币是常态，需按叙事类型分档 ③本案 category=`project`（prestage 路径，rating=mid 过门）而非标准路径 W——适用集经用户修正为「反而是 project/account_based_meme，Web3 原生项目也可以遵照这个标准，但是一般来讲，我们不要求Web3原生项目发币，而是一个特别有趣的项目，由其它用户自己发币（meme）了，也算适用」。
- **语义模型**：适用集 `{project, account_based_meme, web3_native_ip_early, event:W}`（前三是 prestage 裸值、第四是标准路径前缀值）=「推特账号是发行主体或项目号被反复发盘」的类；事件/梗/名人类（event:A-E/F/G）不适用。GMGN OpenAPI 无推特维度发币明细端点（created_tokens 只按钱包地址，一次性 EOA 名下仅本票）——`twitter_create_token_count` 是唯一推特归因计数。
- **条件串终稿（IS NULL 前置臂是 null 放行的必要条件）**：`gmgnBundlerWalletRatio <= 75 AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early' AND narrativeCategory != 'event:W')) OR gmgnIssuerTokenCount <= 1)`——ConditionEvaluator 对左值 null 的**任何**比较（含 `!=`）恒 false，裸 `!=` 链在 null+issuer>1 时误拒（真值表 9/9 + 无臂旧形状=拒反证锁死防未来简化）；`gmgnIssuerTokenCount` null→0 同臂覆盖（快 fire 未就绪=0≤1 放行）。
- **实现链（tokenCategory 三路透出→FA 第四键→GMGN 第五键）**：①analyzer 顶层键 `tokenCategory`——formatResult（response-parser.mjs，覆盖缓存+fallback 两路，record 来自 select('*') 含 token_category 列）+ 新鲜路 return 显式覆盖（save 回读瘦列 SAVE_RETURN_COLS 闭集不含该列，用 deriveTokenCategory 在手变量；刻意不改 SAVE_RETURN_COLS）②DirectCaller ratingResult 加 `narrativeCategory`（catch 形状 null；memory cache 自动同形）③FA `_buildFactorMap` 叙事块第四键 + `setNarrativeFactors` snapshot 加 category④引擎状态机 st 加 category（完成时刻 `r.narrativeCategory ?? null` 回填，异常轮保持 null）+ `_projectNarrativeFactors` 投影⑤GMGN 层：`GMGN_CONDITION_FACTOR_KEYS` 第五键 `narrativeCategory`（三防线自动跟随）+ `checkAndEvaluate` 第四参（fire 因子表透传，与单一买条件同刻同源防 Pingus 案式两门错位；factors 返回携带拒单复盘可见）⑥回测：preload 注入环 `row.token_category ?? null`（rowCache select('*') 零额外查询）+ evaluateFactors spread 同位；本案 gmgn_info 空 → 快照层 covered=0 fail-closed 拒（偏拦方向既有声明）。legacy 直调腿无投影点 → 恒 null = 门 no-op（fail-open）。
- **测试（4 文件扩 137 断言 + 17 回归文件全绿）**：`_test_gmgn_check_layer`（56：分档门真值表 project+6 拒/project+0 放/四类各拒/event:C+6 放/issuer=1 放/null+6 放+**无 IS NULL 臂反证**/bundler 并联臂/checkAndEvaluate 第四参/回测 spread/两引擎源码口径）`_test_fa_narrative_factors`（29：B1 四元组/B6 category 三形状）`_test_narrative_trigger_condition`（36：B1 inFlight null/B3 完成回填/D1 异常轮 null/E5 四点源码）`_test_backtest_trigger_leg`（12：B1 token_category 透传/B2 缺列 null）；回归面 `_test_gmgn_risk_factors`/`_test_narrative_repo_save_thin`/`_test_narrative_memcache`/`_test_narrator_two_shapes`/`_test_search_fallback` 等 17 文件零改动全绿；scan 仅存量 legacy tokenCycle 9 处（cycle 删除时已知）零新命中。
- **部署链（代码先行，无 DDL——token_category 列已存在）**：182 pull → 库条目 buy-v2 升版（gmgnCheckCondition 换终稿条件串，以 182 实查现版为准）→ v21 config 直改 gmgnCheckCondition → 重启前持仓确认规程（[[live-restart-positions-check]]）→ 重启生效。
- **附带查证（同日 0x827a…7777/Konasu 案）**：signals 页疑似「没买」实为已成交（R1 rating=3 → 55s 后量门 1.33 攒满 fire → GMGN passed → 0.004 BNB 买 528,387 枚）——「叙事完成后隔段时间才买」= 量门在攒（发起门 0.5<买门 1.0 保序），非条件拦截。

### C84 买腿链路重构——叙事分析发起条件（narrativeTriggerCondition）+ 单一购买条件 + GMGN 第二层（2026-10-17 用户四点需求+AskUserQuestion 双裁定=信号页加叙事事件列表 / sniper·同名簇观察键不保留）★

- **动机（两阶段因子漂移）**：legacy 链 fire（FA 因子表）与预检查（EarlyParticipant 查 `wss_price_ticks` trailing 90s 窗+引擎注入键）两套数据源两套时刻——用户立项原文「消除信号发起/购买前预检查两阶段时间差导致的因子不一致」。新链路 `叙事发起条件（buyVolumeBnb >= 0.5 OR narrativeRetryDue == 1）→ 后台多轮叙事分析 → 单一买条件（含 narrativeRating == 2 OR == 3）→ GMGN 第二层 → 执行`，全部因子 fire 时刻同一 FA 表上评估，virtual/live/backtest 三态同源。
- **机制（按腿激活，legacy 整链原样保留——v20 bbbe2561 零变化）**：
  | 部件 | 要点 |
  |---|---|
  | FA 叙事三键 | 模块级 Map（RAW 地址键）`narrativeRating/narrativeRounds/narrativeRetryDue`；retryDue 的 now 用 buildFactorMap 入参（禁 Date.now 红线）；config 由引擎 ctor 从 narrativeRetry 段投影（intervalMs/maxAnalyses 同源 C70 键） |
  | 触发状态机 | `_narrativeTriggerCheck` 挂 `_onFactorsUpdated` 买腿分支（N3 同位）；per-token `{rounds,inFlight,hasInitial,lastRating,lastCompletedAt,accountOnly,currentRowId}`；首轮 reason='condition'/补轮 reason='retry'（判据与 FA retryDue 逐字一致=双侧冗余把刻意的，补轮走 '!ttl' 槽 ignoreCache+invalidateAccountCorpus）；完成回填 identity 校验防 stop 后旧投影污染下一实验 |
  | earlyTrades\* 10 键 | 迁自 EarlyParticipant DB trailing 90s 窗 → FA 出生锚定累计窗（firstTickAt 锚、窗 90000 含边界、首出窗 tick 冻结、`_EARLY_MAX_WALLETS` 5000 帽）；trader 层（总量/router/rows）无 outlier/price_usd 过滤照计、wallet 层 defer 乱序收敛 |
  | 轮次留痕 | 新表 `narrative_analysis_rounds`（CASCADE 挂 experiments，trigger_reason∈{condition,retry}）；insert/update catch+warn 观测 fail-open；信号页叙事事件列表（`GET /api/experiment/:id/narrative-rounds`）+图表标注（析起紫虚线/析毕琥珀虚线）+信号卡 narrativeRoundsSummary{rounds,finalRating,leadMs} |
  | 互斥 fail-fast | 同腿 trigger×call 共存 → loadStrategies throw / validateLegs 400 / scan 同口径；trigger 字段进未知因子 FA 集三防线 |
  | 回测口径 | 无状态机（不发起不补轮）；preload 门扩至 trigger 腿+FA 常量注入（categoryToRating 数值链，非 1/2/3 归 9；**rating=token 常量=已知时序穿越，结论只看相对增量**）；ctor `setNarrativeFactorConfig({intervalMs:Infinity,maxAnalyses:0})` 锁死 retryDue；fire 链不评触发条件直接 getRating（memoryCache≈0ms）仅为取 gmgnRisk 供 GMGN 快照层；**不登记拉黑/不算 lag/不跑 P4b 与同叙事龙头检查**；stop 清 FA 注入防同进程下轮回测继承上轮 rating |
- **单一买条件（库条目逐字，`narrativeCorpusLagSec < 300` 刻意删——时效归叙事 precheck C74 管）**：`buyVolumeBnb >= 1.0 AND tokenAgeSec < 90 AND holders > 3 AND (marketCap < 4500 OR holderTrendSlope > 0) AND marketCap < 12000 AND (marketCap < 5000 OR (bundleClusterSharePct < 50 AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20)) AND (narrativeRating == 2 OR narrativeRating == 3) AND (platform != 'flap' OR earlyTradesRouterPct >= 30) AND earlyTradesPerWallet < 4`。**关键不变量：发起门 0.5 < 买门 1.0（量轴序保证分析先于买门可满足而发起，库条目维护该序）**。
- **earlyTrades\* 口径 delta（vs legacy preBuy，实现与方案的偏差=有意）**：①trader 层无 outlier/price_usd 过滤（照计）②尘埃门 earlyUniformDustBnb 0.01 **只影响 uniform 簇**（钱包计数/总买/top1 无尘埃过滤——方案稿曾有 dust 过滤钱包计数，实现裁定偏放行）③协议双地址层剔除只作用于 top1 ④null wallet 行进分子不计人 ⑤perWallet 分子偏 SQL 行数略低 → `<4` 门偏放行（首月观察）。
- **删除清单（dataPrefetch/visionPrefetch 退役）**：分析提前到触发时刻发起，预取失去意义——`DataPrefetchService.js` 整文件/引擎 ctor 段/挂点/启动校验/web 校验+UI 三段/scan 段/`_tokenCorpusMap` 镜像/`analyzeOptions.visionPrefetch` 穿透全删（C72 vision 门本体不动）；**ipfsCacheWriter 注入保留**（语料链路通用加速）。存量实验带 dataPrefetch 段=静默丢机制，上线前 SQL 核查 running 实验。
- **刻意行为变化（用户裁定或条件内含）**：①rating=9（失败/超时归一）拦截——**unrated 放行政策在新链路废止**（条件只写 ==2|3）②sniper 持仓/同名簇观察键不再采集（AVE 快照全局资产停增）③同叙事龙头检查不跑（新条件未引用龙头键）④`_narrativeBlockedTokens` 不消费（条件即门，retry 上限即调用预算）。
- **测试（5 新文件 117 断言 + 存量回归 153 文件全绿）**：`_test_fa_narrative_factors`（28）/`_test_fa_early_trades_factors`（33）/`_test_narrative_trigger_condition`（35，含**launch 不入 Map 重复发起真 bug 反证**——实现期被单测抓出修复）/`_test_narrative_rounds_route`（9）/`_test_backtest_trigger_leg`（12）；存量锚点同步 6 处（retry_config B3 剥注释口径/prefetch D7 三键/vision_gate D2·D9·E3 段退役/tweet_image L2/parallel_fetch C8a/router_gate E）；`_narrativeTriggerCheck` 补激活门（`_narrativeTriggerStates` ctor 成员，`_narrativePrefetchEnabled` 同款先例）。
- **部署**：DDL `narrative_analysis_rounds` **先于** web 重启（红线 4）→ scan-unknown-factor 零命中 → dataPrefetch SQL 核查 → 库条目 buy-v2 升 v16（narrativeTriggerCondition=`buyVolumeBnb >= 0.5 OR narrativeRetryDue == 1` + 单一买条件全文 + gmgnCheckCondition 照抄）→ 新实验（both、narrativeRetry={enabled:true,intervalMs:10000,maxAnalyses:3}）→ 观察 leadMs 分布/轮次轨迹/评级分布对照 v20。


### C83 BI 簇案 0x2f8d…7777 等——super_ip_fast 快车道整体退役：registry 命中信息（认证事实行+反混淆提示行）注入标准路径 state，评分全归 Jev 题集（2026-10-17 用户裁定「随着Jev的引入，叙事分析速度提升巨大，其实已经不必要非要有"快车道"了……对于顶级IP的处理方式与普通IP会有不同」；AskUserQuestion 双裁定=registry 进 state 评分归 Jev 不加代码侧 tier 锚定 / 本案只动叙事模块同源簇限频另行立项）★

- **现象（「引用即 IP」结构性敞口）**：bbbe2561（v20 live both）全量叙事体检 11 项机制健康，唯一造成实际亏损的结构性问题=快车道判据仅「语料推文作者 screen_name 在 SUPER_IP_REGISTRY（34 账号）」，无「票与 IP 真实关联」甄别。**BI 簇 6 票**（Binance Inu 系，均引用同一条 binance/status/2111291116364464469 推文）全拿 S 级 84-86 分 high 且 **6 票全亏**；快车道整体 10 票 9 亏净 **-0.0085 BNB（占总亏 21%）**。三重病因：①量级被 S40/A32+时效15/10/0 代码预分**喂饱**（蹭票与真热点票同分，event_magnitude 题被绕过）；②reason 不落库（35/35 全空，复盘无据）；③J1.21≥3 豁免+institution_routine 全域注册表豁免使 9/18 题的消费被绕过。对照组 0x2919d3（CZ 转发特朗普晚宴真热点）拿 95 分 high 盈利——快车道对真热点票的多付溢价（量级恒满格）与蹭票无区分度。
- **机制（净减法+state 两行注入）**：NarrativeAnalyzer 快车道分支整段删除；superIP 语料票改走标准 18 题全量评估。`buildJevState` PRECOMPUTED 块注入两行：`super_ip_hit: {name}（{type}/{tier}级，{desc}）` 认证事实行（格式与快车道时代一致，Jev 见惯形状）+ `super_ip_note` 反混淆提示行（**作者身份≠代币背书**——代币与该 IP 的实际关联、主体资格、事件量级仍须按题集逐题判定）。preScores 代码预分刻意废（用户裁定：Jev 自判 event_magnitude，题面档带与注册表 tier 语义对齐）。
- **五项能力迁移去向**：
  | 快车道能力 | 去向 |
  |---|---|
  | preScores 量级预分（S40/A32+时效15/10/0） | 刻意废（评分归 Jev） |
  | J1.21 指代豁免（≥3 双达标） | J1.28 低档门（mem≤1 拦）覆盖同意图 |
  | C59 图豁免（meme≥3） | J1.30 名图一致豁免（C65）覆盖 |
  | institution_routine 全域注册表豁免 | **刻意收紧**为仅 platformOfficial {binance, flapdotsh}（mapper 既有标准路径豁免面） |
  | token_category='super_ip_fast' 落库 | 不再产生；deriveTokenCategory 分支保留读旧行（历史行重放防御） |

- **快车道语义分叉欠账自动修复**（卷一§六-25/卷二:727 记录的已知欠账）：cashtag 改道 W（C28）与 J1.24 punExempt 快车道均未挂，删除后 superIP 票自动获得；`credibleEventAnchor` 的 superIPInfo 项从恒 false 残留变真实可达。
- **版本断代**：`JEV_QUESTIONS_VERSION` J1.31→J1.32——题面零改动，变更在 state 输入形状（superIP 票 state 从「预分行」变「认证行+提示行」）；新行评级与 J1.31 前不可比，按 prompt_version 过滤（项目惯例）。
- **CUE 教训风险标注**（J1.18 历史）：「语料里看不出知名度」的失败模式靠直接采信块补盲区——super_ip_hit 进 [PRECOMPUTED]（直接采信，无需 Jev 重判身份）。若 182 观察 superIP 票量级仍系统性低估，属题面校准问题另行处理，不是回加代码锚的理由。
- **诚实预期**：BI 簇不保证翻 low——brand_hijack 0.28-0.30<0.5 不触发 J1.24；marketing_gimmick 概率门不拦；拦它们的希望在 relevance 带反混淆行重判（Jev 对「引用币安推文的第三方盘」关联度/主体资格的重新评估）。**系统性防线是同源簇限频（另行立项）**。本轮观察重点：量级不再恒 S（蹭票预期 A/B 档）+ 18 题跑齐 + reason 完整落库。
- **测试**：新增 `_test_superip_standard_path.cjs`（20 断言：注入形状/源码口径/detectSuperIP 回归/边界；**A5 红线=非 superIP 票 state 逐字节 bit-parity**）；删 `_test_superip_relevance_exempt.cjs`（C59 意图由 J1.30 标准链覆盖）；14 文件同步改造——快车道切片断言 `slice(indexOf('mapSuperIPAnswers'))` 删后 indexOf=-1 变空真假绿，统一改 `!includes('mapSuperIPAnswers')` 不存在性断言（防语义反转）。校准脚本 super_ip_fast 类不再抽样（无重放通道）。
- **部署**：182 git pull → 重启叙事 worker → v20 实验进程**先按 live-restart-positions-check 规程处置死仓**（兔星星/菲菲鼠）再重启（叙事直调在实验进程内，不重启实验不生效）。验证：BI 簇 6 票+0x2919d3 ignoreCache 重析，观察 prompt_type=jev-*、token_category=event:X、state 含 super_ip_hit+super_ip_note 无 pre_scores、量级自判、reason 落库、institution_routine 收紧面（binancezh/BNB Chain 注册表机构票 argmax 拦=预期，误伤实质内容推按 C56 模式扩 PLATFORM_OFFICIAL_HANDLES）。

### C82 JDI 案 0x4688681cd5f1882b3ba12f6f4a79951914e87777——「缩写低置信降档」门（候选 A）存量扫描否决：abbrP/weakP 对盈亏无区分度，命中族=7777 sybil 缩写盘（2026-10-17 用户裁定「那就先不做吧」）；附 @Fouzia69513878 入推特黑名单 ★

- **现象（B 类高分买入 15 秒 -31.7%）**：JDI（flap，2026-10-16 20:10 创建，尾号 7777）语料=空 description IPFS + @Polymarket（202 万粉）20:09 新闻推「中国机器人公司发布 13 英尺/2400 磅人形机器人」。唯一名字线索=vision 图内文字转写「**JD 阿尔法工业**」（展厅背景墙）。Jev：B 类 0.93/product_functional 0.85/web3_fit 0.69（机器人=极客风不触 J1.27 产品实体门）/notable_other 0.37（J1.26 退出阻断）/no_visual_entity 0.86（J1.29 不碰 B 类）/mild_amusement 不折（J1.31 仅 E 类）→ 事件分 39.31+**关联 17（abbreviation_alias，但 argmax 置信仅 0.48：none 0.18/exact 0.18/semantic 0.15）**+质量 14.87=71.18 high → v20 买 0.004 BNB 15 秒后 -31.7% 清仓。**名字↔事件绑定弱只减分不阻断，事件分+传播分（202 万粉大 V 报道=传播 23.52）把底分抬过线**。
- **候选 A（缩写低置信降档，mapper 侧）**：argmax=abbreviation_alias 且置信<T1 且弱侧（none+semantic）合计≥T2 时 relevance 降档计。182 全表扫描 26335 行（`scripts/scan-abbrev-low-confidence.cjs`，74 票 abbreviation 评分票）：**A-semantic 变体天然无效**（lv2=12>10 截断线→只降 5 分 high→mid，买腿 ==2 OR ==3 照买，整表仅翻 1 票）；A-none 变体拦截面真实（T1<0.6/T2≥0.25 命中 26 票全翻 low，JDI 反证命中）但**实际买入票净效应负**：救回 0.58（优优 -0.33/SSI -0.15/UNI -0.10/JDI ≈0）< 误伤 0.90（村村 +0.54/UNI +0.24/马上U钱 +0.12）= **净 -0.32 BNB**；窄参数（<0.35/≥0.4）只拦优优净 +0.33 但 **JDI 不命中**（救不了立案票）。7 买入票 4 亏 3 赢方向随机=与 holderTrendCV 门否决案（拦放胜率 52%=52%）同形状。
- **意外发现（观察项）**：26 票翻拦明细几乎全部尾号 7777（SI×5/U 族×8/村村×2/SSI/SXSICAT/SANTACZ/SIF/Umi/ZeroK/JDI/尊界V800/이상혁…，集中 10-03~10-11）——**低置信 abbreviation ≈ 7777 sybil 团伙指纹**（vanity-7777-sybil-gang 族）。若未来要拦这族，正确轴在地址尾号/发射簇特征（pre-buy 因子层，如 vanityTailCount）而非叙事层；叙事门不动。
- **@Fouzia69513878 入黑名单**（同日用户指令）：`config/default.json → narrative.twitterBlacklist` 第 8 账号（1 粉小号；precheck 层命中即 low）。注意 twitter-fetcher.mjs 硬编码 `NARRATIVE_TWITTER_BLACKLIST`（fetch 层 4 账号）与 config 层（8 账号）历史漂移未同步——权威层=config（precheck 拦截），fetcher 层旧名单未动。
- **改动面**：config 一行 + 本台账 + 扫描脚本入库（零机制改动、无单测负担）；叙事 worker 重启生效（实验进程不依赖该名单无需动）。

### C81 롱캣案 0xd97a9847ee249c36b01b14eecffa73c425d57777——语料充分门判据改「推文可理解即 sufficient」（CG2.0 采信原则）：验证宣告陈述不是门的任务，douyin 2.8-4.4s 验证代价买腿不可接受（2026-10-17 用户裁定「我们基本原则是相信推文的陈述，不要去验证，验证的代价太大」「只要能通过推文直接理解清楚叙事的，就都不要去取进一步语料」）★

- **现象（CG1.0 判据漂移）**：롱캣（韩国跑者 meme，宣告推自述「甚至在抖音都有了官方账号…特别火爆」+尾部抖音分享口令残留 → douyin 桶非空）fire 时票龄 2.95s，叙事直调 9105ms 中 **douyin fetch 3625ms**。corpusGate 260ms 正常返回判 **need_fetch**——宣告推已把叙事说清（韩国 meme/롱캣/情绪表达载体/未代币化），但 CG1.0 need_fetch 判据①「叙事主体疑在未抓平台原生（中文梗源头常在抖音/微博）」被 Jev 按平台敏感性命中：**「meme 源头在抖音」被当成了抓取理由，尽管推文文字已经完成了叙事转述**。事后 douyin 语料确实进了 state（传播分 28.76=评级 70.76 过线第二大项），但用户裁定验证本身就不该做——发币者陈述默认采信，一手验证的秒级代价拖延买腿（本案 fire→成交 10.85s，成交价较 fire 价 +66%，N3 预触发同批默认开对冲）。
- **机制（CG2.0 题面重锚）**：`corpus_gate_sufficiency` 题面重写——**TRUST PRINCIPLE 段置顶**：推文语料中的陈述（meme 是什么/来自哪/多火爆/谁创作）默认为真，验证真实性不是本判断的任务；唯一问题=**叙事能否仅凭文本理解**。need_fetch 收紧为两臂：①主体不可辨（文本无法陈述也无法推断指代什么）②名字指代唯一载体在未抓内容（视频标题/创作者名/图内文字/仓库文档）；**明确写出「热度/真实性/来源是否属实 NEVER 是 need_fetch 理由」+「未抓链接仅是对已可理解叙事的再承载/插图/补充（如宣告推文字已描述的 meme 的抖音视频）不是抓取理由」**。删除 CG1.0 的「源头平台敏感性」独立臂（中文梗源头常在抖音/微博、tech 盘吃 github——github 场景并入名字指代臂：推文没说清+repo 名=token 名才算）。`judgeCorpusGate` 聚合零改动（choice+p≥0.6 语义不变，题面语义修正翻 argmax 正是 CLAUDE.md 修正教训①的「语义修正类措辞」有效方向）；版本 bump CG1.0→CG2.0（`JEV_CORPUSGATE_QUESTIONS_VERSION`）。
- **误判方向不变**：误 sufficient=证据少=评级偏 low=偏拦（fail-closed）；误 need_fetch/失败/超时=照抓原行为。CG2.0 整体向 sufficient 移动=跳过率上升=直调更快，代价是部分票非主语料证据缺席（评级证据变薄，方向仍安全）。
- **同批裁定**：N3 `narrativePrefetch.enabled` 默认开（`!== false`，46f7a1a）——本案 fire→成交 10.85s 中叙事直调同步段占 9.1s 的另一半对冲；maxCopyWalletHolderCircPct 门本案如实工作无 bug（fire=0 真实值，0xddac…2127=GMGN renowned 不在 172 名单且 fire 后 6s 才进场，成交时 15.74%<20 即使在名单也拦不住——亏损结构是极速票 fire→成交窗口漂移，非控盘集中度，另见 memory d97a-7777 案档案）。
- **审计**：沿用 CG1.0 三件套（timing `fetch.corpusGate`/日志 `[CorpusGate] … v=CG2.0`/`dataFetchResults.skipped='corpus_gate'`），版本号进日志可直接区分两代判据的线上分布。
- **改动面**：`llm/jev-corpusgate-questions.mjs` 题面重写+版本 bump；单测 `_test_corpus_gate.cjs` A6/A7 断言同步（A7 锚从「会否改变判定」换「TRUST PRINCIPLE/采信/NEVER 理由」三锚）；部署=实验进程（直调内嵌）+narrative worker 双重启。
- **观察项**：CG2.0 上线后 sufficient 率应显著上升（日志 v=CG2.0 分布）；若跳过过猛致评级整体下移（偏拦放大），再校 minSufficientProb（0.6 是唯一旋钮，题面不动）。

### C80 蝙蝠侠摇案 0x4547dae7757fb4043e034d27ed02dfabe9aa7777——E 类情绪感染力折损（event_resonance，J1.31）：现象传播广度≠Web3 用户情绪转化（观众≠买家），mild ×0.5 / indifferent ×0.25 只折事件分+传播分（2026-10-16 用户裁定「我觉对时事现象热度，其实也应该度量事件对Web3用户度的情绪感染力。这个事件没啥情绪感染力，我不会被它有任何触动，也并非一个大时事。」）★

- **现象（E 类高分买入 31 秒 -12.4%）**：蝙蝠侠式蹦迪（flap，2026-10-16 12:29 创建）Jev E 类 0.99 + B 档 27 + 传播 28.68 + 时效 15 = 事件分 70.68 过线 → 总分 75.68 high → v20 买 0.004 BNB（4 卡）→ **31 秒后 -12.4% 卖出**；全程 54 ticks / 18min 冷市场。证据链全在：subject_entity character_ip 仅 0.14（**无形象纯现象**，meme_word 0.67 是借名）；vision 对抖音搜索页截图判「动作非角色」；宣告者=105 粉小布丁（C76 找角度名单形状）；借 DC 蝙蝠侠名 super_ip 0.43。用户诊断「没有形象只是现象，不太能成为 meme 币」——**现有题集的量级/传播/时效三轴全是「现象在圈外有多大」的旁观者度量，缺「Web3 买家会不会被触动」的转化率轴**：土味舞蹈挑战在抖音百万级刷屏，crypto 圈纯旁观。
- **机制（J1.31 恒带题 + mapper 系数折损）**：标准路径新增第 18 题 `event_resonance` 三档 choice——strong_reaction（强感染：圈内黑天鹅大瓜/币圈自嘲财富叙事/币圈名人喊单名场面/圈内疯转乐子梗/身份认同事件）/ mild_amusement（轻度有趣：圈外有趣现象，会心一笑划走）/ indifferent（无感：与 crypto 圈情感无交集，圈外传播量再大也不改）。题面钉死两锚：①判据=**站在 BSC meme 买家立场的情绪行动性**（会不会主动讨论/玩梗/二创/站队/产生参与冲动），不是泛大众「好不好笑」也不是传播量级（另有题评）；②与 web3_fit 分工=静态口味偏好 vs 动态情绪行动力。mapper 标准数学分支：`category==='E'` 且档位系数<1 时 `stage2Total = (tierScore + effDim2)×coef + timeliness`。
- **设计裁定①（系数形式非硬门）**：mild ×0.5 数学上拦死全部档位（max (39+30)×0.5+15=49.5<60）——刻意保留系数形式而非 mild 直接 blocked：分数梯度可观察（42.84 vs 28.92 审计可辨）+ 阈值事后校准留口（与 J1.28「中间档不设门」同思路，只是本案两档全拦是数学事实非额外门）。
- **设计裁定②（时效不折）**：timeliness 照常计入——新鲜是客观属性（事件确实 7 天内），折的是「事件对 Web3 圈层的情绪转化」而非事件本身的任何客观维度。
- **设计裁定③（作用域 E 类 only）**：裁定域=「时事现象热度」=E 类；A/B/C/D/W/F/G 不折（A 类形象 IP 的情绪卷入由 subject 系题判；W 数学分支 `tierScore=null` 天然不触达——蝙蝠侠摇若被 Jev 判成形象 IP 走 W 也不受本门）。E 类 D 档量级票折损前后同为拦（量级门先拦，归因不变）。
- **边界**：旧缓存行无 event_resonance 答案 → fail-open 不折（J1.28/J1.29 先例）；未知档位值不折（防脏数据打崩）；strong ×1 bit-identical 原公式；superIP 快车道不消费（mapSuperIPAnswers 域外）；prestage 不触达；W 数学与骑乘改道在上分支（isW || rideMass），进标准分支的票天然不受改道干扰。
- **审计**：stage2 `jev.eventResonance` 恒落（旧缓存行 null）/ `jev.resonanceDamp {resonance, coef}` 命中才落 + `probabilities.event_resonance` 落库（档间梯度可观察）；reason 带「｜感染力折损×0.5(轻度有趣)」段。
- **单测**：`scripts/_test_jev_resonance.cjs`（14 断言零 DB 零网络）：A 事故现场反证（70.68→75.68 DB bit-identical 复现 + mild 42.84 拦 + indifferent 28.92 拦）/ B 系数边界（strong ×1 / 缺答案 fail-open / 未知档位）/ C 作用域（A 类不折 / W 类不触达 / E+D 档量级门归因）/ D 审计四件套。fixture 坑留档：**DB breakdown 落的是 bandInterpolate 换算后值**（spelling 4.8/reasonability 2.47），原始分反解 2.8/1.47（BANDS 按 floor(score) 取带，≥3 分全落 [6,7] 带——写 fixture 前先对表，J1.30 同款教训）。
- **配套**：既有断言 bump `_test_jev_product_entity` A2 题数 17→18、`_test_name_image_consistency` A1 版本 J1.30→J1.31（`_test_superip_relevance_exempt` H5 存量失败系 C72 visionSkipped 改造遗留断言漂移，与本改动无关）；历史窗口回测前置失效 `scripts/narrative/invalidate-resonance-window.cjs`（carrier/referent 同模式：基底买腿 signal distinct token，dry-run 默认，--commit 分块 100）。
- **部署**：182 git pull+单测回归 → `jev_calibration.mjs` 校准（评级一致性+无买线翻转：蝙蝠侠摇类→low、啾啾案类 direct_tweet 时事票不得翻）→ 重启叙事 worker+实验进程（重启前持仓确认规程）。

### C79 偷窥狂案 0x57efcdb41b8107fd6b6db8d06591d67274e27777——语料充分门（非主语料外部抓取前置 Jev 预判，CG1.0）：twitter 等齐后一次判「其余待抓平台还需要吗」（2026-10-16 用户裁定「跟之前设置的『需不需要走图片分析流程』一样，我觉得如果对叙事理解已经没问题了，也就不需要再调用抖音」+ 当日泛化裁定「不仅仅是抖音的调用，很多外部资源的调用都是类似思路，就是如果对叙事的理解已经不需要其它信息补充，那就不用去取了」）★

- **现象（延迟解剖，非评级错误）**：live v19 fire→成交 7.54s 中叙事直调占 5.35s，其中 **douyin fetch 4.37s（82%）**是买腿关键路径最大单点（DouyinFetcher 走 JustOneAPI，182 当日 6 次实测 2.8-4.4s 全在直调链路，worker 侧零调用）。票本身终局 -9.52%（买点/卖点归因另案：fire 卡 holderTrendSlope、卖腿 debounce 差 3.7s——本 case 只治外部抓取耗时）。当日先实现 douyin 专属门（D1.0），用户随即泛化裁定推广到全部非主语料外部抓取——**同日重构为语料充分门（corpusGate，CG1.0），douyin 专属版未上线即被替换，不留双机制**。
- **机制（照 C72 vision gate 模式，CG1.0 题集）**：`fetchDataSequentially` 编排层 hoist `twitterPromise` 后构造 `corpusGatePromise`——**twitter 主语料等齐后 1 题 Choice `corpus_gate_sufficiency` 判「其余待抓平台语料还需要吗」**，sufficient 且 p≥0.6 则 justoneapi 串行桶（weibo/youtube/douyin/tiktok/bilibili/binanceSquare/weixin/amazon/xiaohongshu/instagram）+ github 桶**全部待抓段整段跳过**（各 `results.<x>Info` 保持 null=无该平台 URL/抓取失败同形状，下游零改动）。题面锚定「未抓内容会不会**改变判定**」非「有没有用」（G1.0 同款锚法）；need_fetch 三判据：①叙事主体疑在未抓平台原生（**中文梗源头常在抖音/微博、tech 盘常吃 github 仓库证据**）②币名指代可能只在视频标题/创作者名/图内文字/仓库文档③推文没说清指代。待抓平台清单+首 URL 作 `[UNFETCHED SOURCES]` 附加段进 state 末尾（Jev 平台敏感地整体判）。
- **泛化架构裁定（一次门判全部待抓平台，非 per-platform 门）**：JevClient 最坏 3×30s+退避≈105s，per-platform 门会把 insufficient 票拖成 N 次门调用（串行桶 10 平台）——**清单进 state 一次整体判**是成本下限；全或无语义也贴用户原话（「不需要**其它信息**补充」是整体判断）。多数票待抓平台 ≤2 个，全或无与 per-platform 实际差异小。
- **门管清单口径**：twitter 刻意不在（判据来源/主语料，不可跳）；**websites 刻意不在**（`websiteFetch.enabled` 独立开关=显式 opt-in，尊重显式意愿，且默认关）；telegram/discord 无抓取段不计。**资格判定=门开+存在待抓平台+twitterInfo 非空**（account 型也算；纯非 twitter 票不问门直接抓——主语料缺席无从判「已足够」；twitter 抓取失败同 fail-safe 照抓）。
- **twitter 主语料依赖（与 C72 的结构差异①）**：挂点在 fetch 编排层而非 analyzer 主链，N2 四桶并行下门判定时 twitter 未完——`corpusGatePromise` 内先 `await twitterPromise.catch(()=>{})` 再判。**`isCorpusGateOn()`+待抓非空守卫包住 twitter await，门关/无待抓=零等待零行为变化**（桶并发形状 bit 一致）。**陷阱①（单测锁定）：twitterInfo 资格判定与 partial state 的 `{...results}` 展开都必须在 await 之后**——runTwitter 完成时才原地写 `results.twitterInfo`，提前判定/展开会拿到 null 永不更新。
- **外层 race 2s（结构差异②）**：JevClient 内部重试最坏 ≈105s，换的是 4.4s 级抓取段——超时尾部不可接受，`runCorpusGate` 内 `Promise.race` 2s 上限（服务内常量非配置键：安全界不是校准旋钮，单测可经 `options.gateTimeoutMs` 注入）；超时/失败→`{skipped:false}` fail-safe 照抓，飞行中的门调用自然作废（单 POST 无副作用）。
- **方向安全性（对齐 C72 裁定）**：误 sufficient→待抓段缺席→证据少载体最坏评级偏 low→**偏拦**（损失是错过票不是买入风险）；误 need_fetch/Jev 失败/超时→照抓原行为（多付 ≤2s）。
- **已知边界**：①跳过使消费对应语料的 precheck 规则静默（如规则 3.5.6 douyin user_profile 粉丝数）+binanceCorpus 豁免链（跳过=币安广场语料缺席=豁免判不到）——全偏拦方向；②insufficient 票 justoneapi/github 桶多付 twitter await+门调用（偷窥狂口径 ~0.9s；github 桶原本与 twitter 并行，现在被门串到 twitter 之后——N2 桶间并行的局部让渡，墙钟由 max 桶主导影响有限）；③跳过票不写各平台外部缓存（90/30 天 TTL）——提速与缓存预热不可兼得，接受；④prestage 共用 fetchAllData：prestage state 不消费 douyinInfo，github 缺席对产品盘 prestage 的影响=偏拦（sufficient 判定本身就含「tech 盘常吃 github 证据」反向判据）。
- **延迟收支（偷窥狂口径）**：sufficient 时 fetch 相 ≈0.93s vs 原 4.37s（**省 ~3.4s**，门调用 ~0.4s+twitter 0.53s 并行重叠）；多平台票（weibo+douyin+weixin）跳过收益更大；insufficient ~5.3s；门失败上界 +2s。
- **审计**：timing 段 `fetch.corpusGate`（跳过时无 `fetch.<platform>` 段，镜像 C72「跳过时无 vision 段」口径）+ 日志 `[CorpusGate] 门判定=… p=… Xms → 跳过待抓语料[weibo,douyin]/照抓待抓语料 v=CG1.0` + `dataFetchResults.<platform>.skipped='corpus_gate'`（additive，无消费方，事后可区分「门跳过 vs 无 URL vs 抓取失败」）。
- **改动面**：新 `llm/jev-corpusgate-questions.mjs`（CG1.0）+ 新 `services/corpus-gate-service.mjs`（`pendingCorpusPlatforms`/`isCorpusGateOn`/`shouldAskCorpusGate`/`runCorpusGate`）+ `data-fetch-service.mjs` 编排层接线（`corpusGatePromise` hoist+两桶闭包门控+跳过标记循环；`runDouyin` 恢复无参原形状）+ `config/narrative-engine.json` 顶层 `"corpusGate": {"enabled": true, "minSufficientProb": 0.6}`（默认开=部署即生效；worker/直调 config 同源同时生效；race 2s 是安全界非配置键）。
- **单测**：`scripts/_test_corpus_gate.cjs`（54 断言零 DB 零网络）：A 纯函数/B 服务行为（state 含主语料+[UNFETCHED SOURCES] 附加段/4xx fail-safe/race 上界/options.config 注入）/C 资格矩阵（清单剔 twitter/websites/telegram）/D 源码口径锁（陷阱①/D11 douyin 专属门文件已删防双机制回流）/E 端到端（fetchDataSequentially 级类静态打桩：sufficient 三平台桩零调用+跳过标记+timing 门段无抓取段/need_fetch 照抓/门关不等 twitter 时序反证/慢 twitter 门后置/github 待跳/websites-only 不问门/门挂起 2s race 照抓/twitter 失败照抓/门 4xx 照抓）。`_test_narrative_parallel_fetch.cjs` A 段 fixture 关门（N2 并发原形状锁定+防真 Jev POST）+ C1/C2/C3 源码锁随形状升级（+顺手修 C8a 存量漂移：C70 加 invalidateAccountCorpus 键时锁未跟上）。
- **部署**：182 git pull+单测回归 → 重启叙事 worker+实验进程（双进程吃 configCache；重启前持仓确认规程）→ 观察 24-48h CorpusGate 跳过率与 timing 分布 → 校准 minSufficientProb。

### C78 鲸元卷案 0xe0cf0905310fc63cd8192513883d7426fc1e7777——功能性补偿券过 meme 名门（rating 2 / 66.31 贴线 60）：J1.27 产品实体切分未覆盖 referent_memeability + 假叙事账号黑名单（2026-10-16 用户裁定「鲸元券不能当 meme 名字，币安发的才行；名字还错了（鲸元卷）」）★

- **现象**：v19 首亏票 -28.6%（交易侧结构另案：as-of-fire 同块等额簇占买量 82%，auto-memory `equal-amt-cluster-jingyuanjuan-case`）。主推 @in927772（1869 粉/0 赞/0 转，bio「SOL、BSC、Base、Robinhood 全链建设玩家」）lag 13s：「？？？DeepSeek 的 Token 货币？DeepSeek 官方给大家的补偿通知」+3 图。vision 逐字转写假券全貌（手绘「鲸元**券**」面额 10,000,000、反向乱码 'biegleew indnse mep'、宣传语「宕机 5 小时，DeepSeek 给钱啦！」、底部署名机器之心 1047）——蹭 2026-10-15 DeepSeek 真宕机补偿事件；**token 名还写错一字：鲸元卷 ≠ 鲸元券**。
- **用户双裁定（定调，推翻首轮「冒充官方轴」提案）**：① **叙事描述一律当真——真伪不可验证是基本原则**，分析层不做信源真伪/冒充判定（首轮 fake_official 题面提案作废）；② **给过假叙事的账号事后拉黑**（罕见路径）：`config/default.json → narrative.twitterBlacklist`（precheck 硬 low，ruleName='blacklist'，文案即「该账号专门制造虚假叙事」，gampsito 先例）。@in927772 候选（DeepSeek 事后可验证未发币）待确认入册。
- **探针级解剖（用户轴=「鲸元券能不能当 meme 名」）**：Jev 其实**认对了主体**——`subject_entity=product_functional`（0.38 argmax）= 功能性产品（补偿券）；但下游三探针全部失守：
  - **`referent_memeability=3.48`（峰在 4 档 0.58）**——J1.28 的 1 分档 legend 就是「严肃对象/事务性名称——机构日常事务、普通公司/组织名」，补偿券 100% 落此形状；Jev 被手绘荒诞假券的讽刺艺术抬到 4 档。**锚定失守**（「题面改锚分不动」家族——修法必须是 mapper 代码侧门）。
  - **`block_misspelling=0.28`（noul）**——鲸元卷≠鲸元券一字差只答 0.28；quality 已扣（reasonability 1.32/spelling 2.53 → quality 14.85 低分）但权重不足以翻。
  - **`web3_fit=strong_fit 0.97`**——J1.27 题面边界「纯功能型产品不高于 marginal」彻底失守（产品簇预期 sf+f 19-60%，此票 100%）；J1.27 接纳门方向是「fit 低才拦」，探针被「有人想买」污染 → 门没开。
  - **连锁放大**：mem 3.48≥3 恰好满足 C59 图载体豁免第三条件（+name_image_consistency same_entity 0.88）→ relevance 15 不被截断——mem 虚高不只放过 J1.28 门，还放大图证据信任。stage2 60.76=事件 22（C 档）+传播 23.76+时效 15（事件真新鲜）→ 66.31 贴线过 60。
- **修复终局（2026-10-16 用户第二轮双裁定）**：① **mem 钳制不落地**——「它理解这是个荒诞事件，我觉得也有道理，可以先不改」（Jev 被手绘假券荒诞讽刺感抬 4 档被判可接受，荒诞事件本身可以当梗）；② **拼写错误必须阻断**——「这个肯定要阻断（除非是引申等等，但这里就是拼写错误了）」→ **图文名不符拼写门已落地**：
  - 先试题面改（block_misspelling 加「图内文字写法对照」判据）+ 本票线上 state 逐字重放 → **实证失败**：misspelling 0.270 → 0.130 反降（「题面改锚分不动」家族第三实证）→ 题面回滚 J1.30 零漂移，判据改代码接管（C28 cashtag 改道同款先例）
  - **`detectNameImageSpellingMismatch`**（jev-result-mapper.mjs 纯函数，stage3 截断 `misspellingP >= 0.5 || spellingMismatch.hit` 双臂）：币名 CJK（Han/Hangul/Kana）≥3 字 + 图内文字存在等长独立段恰一位不同（substitution-1）且全文 ≥2 次 + 币名整体不在图内（名字被图内使用过=有意变形/双写法不拦——**天然编码「除非是引申」例外口径**：有意变形全语料一致，图内也是「卷」不触发）。图内文字源=twitterInfo.image_analysis stringify（结构无关，visible_text/key_elements 全覆盖）；C72 门跳过已剥 image_analysis → 无从对照不触发（fail-safe 偏拦）。审计 stage3.jev.spellingMismatch {name, variant} 命中才落
  - **误伤面两轮扫描**（600+ 票只读）：初版 30 命中暴露三噪声源——标点黏连（neon》/调教”）、短拉丁 OCR（CTS/ces、RAM/rom）、语流语境词（中国龙↔「中国的」）→ 收紧（非字母数字全当分隔符/拉丁名不判/独立段+≥2 次）→ 终版 646 票 **5 命中**：鲸元卷（本案）+ 萌宝特攻队（图内「特工队」≠币名「特攻队」，真拼写错误，正确命中）+ 오케어（真不一致）+ 喵喵瞄/우땅이（2 票 high 疑 vision 形近转写，偏拦方向残余误伤 ≈0.3%）
  - 单测 `_test_name_image_spelling_mismatch`（24 项：事故现场反证/例外口径/独立段噪声三源/原门共存/源码锁定）；换位形状（pepe/peep）与 2 字名刻意不覆盖，真实 case 再扩
- **@in927772 黑名单候选**（假叙事账号：宣称 DeepSeek 官方补偿币，事后可验证未发币）→ `config/default.json → narrative.twitterBlacklist`，**待用户确认入册**。
- **关联证据（同票全景）**：GMGN issuerTokenCount 54（观测键，用户裁定不进拦截）；bundlerRatio 64.3 过 75 门；…7777 尾号；首窗 9 秒 shove（oneShot 87.5%/span 9s）+ fire→成交滑 -20.8%。



- **机制**：token 语料为空（classifiedUrls 各桶全空 + twitterInfo null，FTR `0x109afc17…7777` 形状）→ 泳道 4 并发按 token 全名 + `since:<创建-7d>` 搜推特（Top+Latest 各 1 调，timeout 5s）；证据=`[TWITTER_SEARCH]` 独立段进 state header（**不占四区配额**，段内显式声明「非本代币宣告语料，代币与事件关联需自行判断」）；双达标（去重剔转推 ≥3 条 && 单推最大互动 fav+2×rt ≥200）→ **旁路 `no_public_info` 让 Jev 用真实事件量级判定**。CA 直搜 404 死（C73 冒烟），主用例是事件量级证据非宣告推救援。
- **裁定①旁路行 `pre_check_result=null`（不是保留 low）**——四消费方反证：保留 low 则 ①resolveFinalRating 阶段优先级遮蔽 Jev 结论（旁路白做）②直调 enrichSocialByGmgn 每次穿透重析（烧配额）③PrecheckFailRetryService 无限重试已终态结论 ④preloadCache 永久排除（回测退化）。**未达阈值/搜索失败/零结果则 ruleName 原样保留**（1800s 重试域保真——重析再搜，晚到的推文/涨上去的互动能翻案）+ additive `details.searchEvidence` 摘要（观测为什么搜索没救它）。
- **裁定②只有达阈值才落缓存**（`twitter_search:<product>:<query>`，TTL 1800s）：未达阈值若缓存会把重试窗内全部 ≤5 次重析冻死在首析快照上（=no_public_info 重试域时长）。手工 get/set 不走 CachedFetcher.fetchWithCache（失败 1h 冷却灭重试窗，getAccountWithFullTweets 同款先例）；模块级 inflight Map 按 rawQuery 去重。
- **裁定③lag 隔离红线**：证据只走 `tokenData.raw_api_data.search_evidence`，与 `extractCorpusTs` 三路径（主推/父推 in_reply_to/第二推文 website_tweet，从不读 raw_api_data）**结构性无交叠**——`narrativeCorpusLagSec` 不被搜索结果污染（搜索结果日期≠宣告日期）；两新模块可执行代码零 `twitterInfo` 引用（单测源码锁）。回测 fresh 分析实时搜属已声明「回测时漏」家族（无 until: 上界，硬化留扩展）。
- **失败语义**：搜索永不 throw（失败→null→analyzer 维持原拒 **bit-identical**，J2 逐键锁定）；段缺失=静默关、enabled:false=零触达（J4）；enabled 但 products/count/bypass 残缺=throw fail-loud（vision 同语义）。无证据时 state 逐字节与现状一致（H2 关系锁：空语料票四区恒空，state1=state0+section+'\n\n'）。
- **改动面**：`new-apis.js` searchTimeline（GraphQL 两路径+TweetWithVisibilityResults 下钻+timeoutMs 透传）/ `services/twitter-search-fallback.mjs`（新建）/ `prompts/sections/twitter-search-section.mjs`（新建）/ `jev-state-builder.mjs` 两行接线（prestage 刻意不接）/ `NarrativeAnalyzer.mjs` 五处（泳道 4 发起+四元 join+旁路判定+第二道门 `|| bypassedBySearch`+meta.searchBypassed）/ `config/narrative-engine.json` searchFallback 段（enabled:false）。旁路挂 analyzer 层，performPreCheck 9 参签名不动。
- **验证**：`_test_search_fallback.cjs` 90 断言全绿（A API 层/B 查询构造/短名无锚 fail-safe/C 阈值边界/D ★达阈值才 set+缓存命中零真调+get throw 降级/E inflight+失败清理/F section 渲染截断/G lag 隔离事故反证/H state bit-parity/I 源码口径锁/J 端到端 J1-J6：旁路/失败 bit-identical/未达阈值保重试域/关零触达/残缺 fail-loud/非空语料不触发）；回归九件全绿（`_test_narrative_middle_parallel` D5 三元→四元 join 断言随形状升级）。
- **部署注意**：182 代码同步→单测+回归→重启叙事 worker+实验进程（d3be1662 重启前按规程确认无持仓）+web 3010→观察 24h 零 [SearchFallback] 日志→flip enabled:true→再重启→首例旁路票（`0x109a` 形状零 URL 新票）记台账。回滚=enabled:false+重启（J4 保证）。**误归因风险 R3**（token 名撞大热词）由 section 来源声明+Jev name_referent/brand_hijack 题兜底，Jev 评 low 即终态不误买。



- **动机**：C74 分桶落地后名单价值放大——`classifyTweetType` 优先级 2（名单）先于优先级 3（direct_tweet 高粉/高互动豁免臂），名单号哪怕 10 万粉也直接落 angle_seeking 桶走 300s 硬拦，**不烧 Jev 配额不进软评**；而老名单（94+gampsito=95 个）自 2026-04-17 停更，这半年头部发币作业号已换血（≥100 次档老名单仅占 10/233）。
- **扫描 v1 频次口径的坑**：全量 562,494 行 experiment_tokens（207,776 带宣告推 / 28,410 唯一 handle）扫出的 TOP 全是**被蹭大 IP**——cz_binance 9169 次 / binance 6192 / heyibinance 4406 / elonmusk 3539 / flapdotsh 3093（别人发币挂他们的推）。频次≠找角度博主。
- **v2 creator 聚合甄别**（`scripts/scan-frequent-issuers.cjs`，182 只读 0.6min）：handle 关联 `creator_address` 集中度三分类——self_issuer（top1≥0.6 或 top3≥0.9=自营发币号 19 个）/ hijacked_ip（top1<0.2 且 ≥10 creator=被蹭 IP，**自动排除 1644 个**含全部大 V）/ hybrid（共享作业源 1253 个：多人共用同一宣告号作业，如 shanyizk9 428 次 167 creator）。
- **人工分拣裁定**（C74 语义：事件源享受 direct_tweet 新闻豁免不收；无名作业号/共享角度源收录）：用户裁定**只收 ≥30 次高频段**。收录 52 个（shanyizk9 428/burbering1 200/bobod9vv 172/…/fcmao_bsc 30，币名全中文乱炖+symbol 复制粘贴画像）；剔除 10 个事件源——whitehouse/pmarca/cnbc/blockbeatsasia（媒体；某 dev 固定蹭快讯致 creator 集中 0.74 仍剔——creator 集中度是辅助非充分证据）/jessepollak（Base 创始人）/bnbchainzh/aster_dex/flaps_launchpad（平台官方）+ fourdotmemezh/bnbveil（疑似生态官方，用户裁定剔除）。**低频段不收**（8-29 次 1194 个 + 自营批量号 15 个如 kamojo×4/币安羊×4——观察期后重跑脚本降 `--min` 再补）。
- **爆炸半径可控**：名单命中只是落非豁免桶 300s 窗（挂该号推 **300 秒内**发币照放进 Jev），不杀快发票只拦迟发跟风票；存量 token_narrative 缓存行不受影响。
- **验证**：`_test_precheck_tweet_freshness_bucket` J 组 25 断言——名单规模 ≥147/全小写/无重复/收录抽查在册/**事件源 15 个剔除反证**（whitehouse…cz_binance 不在名单防回流）/**名单压豁免机制锁**（shanyizk9 50 万粉+5 千赞仍判 angle_seeking，reason 落「频繁发币者」）。53/53 全绿；关联回归 5 测（angle_timing 31/narrator_two_shapes 22/parallel_queries 18/vision_gate 35/fail_retry 42）全绿。
- **部署注意**：与 C74/C75 同批——182 磁盘同步后，叙事 worker + 实验进程重启生效（直调走引擎进程内 NarrativeAnalyzer）；名单维护入口=`scripts/scan-frequent-issuers.cjs`（可复跑，`--min N` 降阈值收低频段）。

### C75 FLY 案 0x4ec2c14230a818fcb8947c3999f7a4a872437777——叙事源头陈旧门（direct_tweet 主推>30d → mapper 时效归 older）：「找角度推文是新的，但币安的推文已经一年多以前了，这种控一下吧」（2026-10-16 用户裁定）★

- **案发**：four.meme 2026-10-16 02:25 发币。语料两推：主推=**币安 2025-06-08 FLY 上线公告**（1612 万粉，lag **495 天**）；第二语料 website_tweet=gapJ 当天宣告推（「币安发过的 FLY 1 token，我们应该在链上发射它，今天是最好的发射时机」，lag 7s）。Jev 被当天宣告推误答 `within_7d` 拿满时效分 → **77.32 high 放行**，v18 实跑 0.004 BNB 买入 -36%。
- **分类路径**：主推=币安高粉 → `classifyTweetType` 判 **direct_tweet**（推文即事件源）→ C68 找角度门（angle/interpretive 专用）不适用；C74 分桶后 direct_tweet 又是 precheck 豁免桶（无硬拦）→ 该形态此前**无任何时效防线**，全靠 Jev event_timing 软评——而软评恰恰被宣告推污染。
- **裁定**（用户 2026-10-16）：源头语料太老的 direct 票要控。落地=**mapper-only 分轴 override**（J1.16/J1.23/J1.24/C68 同款：分数锚定类必须代码侧，题集/版本不动）：`tweet_type=direct_tweet` 且主推 lag > `SOURCE_STALE_SEC=30d`（对齐 Jev within_30d/older 档边界）→ timing 归 older=0 分。
- **判定轴（与 C68 刻意相反）**：只看**主推**（twitterInfo）时间且仅主推——direct_tweet 语义「主推即事件源」，主推=源头本体；website_tweet/quoted/retweeted **刻意不进集合**：发币人当天的宣告推新是当然的，不构成「事件新鲜」证据（C68 载体集合取最新一条「任一新即活」救 angle 类，本门宣告推救不了 direct 类）。angle_seeking/interpretive_reply 不触达（C68 域，两门 type 互斥精确实位）；unknown 不触达（留给 Jev 自判）；锚=tokenCreatedAtSec||raw_api_data.created_at（与 C68 同链）缺失 fail-open。
- **与 C74 协同**：C74 把 direct_tweet 从 precheck 硬拦豁免交 Jev 软评（高粉新闻推被人发现得晚，300s 硬拦误杀啾啾案）——豁免口子打开后，真·陈旧源头（翻旧闻发币）正是本门在软评层接住：30d 客观锚替代被宣告推污染的 Jev 时效判断。两案同日裁定，一放一收互为补丁。
- **存量影响面**（182 扫描 7177 有效行）：主推>30d 的 direct 票 117——**high 20 票全是骑 CZ/币安/何一/雷军 35d~5.7y 老推形状**（CZ 同一条 2087 天前的推被骑两个盘；评级两极分布无 mid 残例：Jev 答新鲜=high、答 older=low）；48 low 零变化；49 rating undefined（precheck 拦形状）。实跑对照：6 票被买过 **5 亏 1 赢**（麻婆豆腐 -25%/价值币 -51%/Cherry -21%/币安侠 -25%/FLY -36%，唯 CRAZYCOIN +139%）——门上线后连偶发大赢一起拦，方向与裁定一致。
- **验证**：`_test_angle_timing_override` D 组（D1 事故现场反证：direct+495d+宣告推当天不救 → 53.4<60 翻 low，对照 unknown 同形状 71.54 high；D2 边界 2592001/2591999；D3 type 互斥；D4/D5 锚与主推时间缺失 fail-open；D6 Jev 已答 older 零变化审计仍落）+ C3 源码口径（`SOURCE_STALE_SEC = 30 * 86400` + 仅 direct_tweet 域锁定），31 断言全绿。
- **部署注意**：mapper 属叙事 worker/直调共用代码——生效=叙事 worker 重启（182 `nohup node src/narrative/engine/start.mjs`）+ 实验进程重启（直调走引擎内 NarrativeAnalyzer）；存量 token_narrative 缓存行不自动重析（与 C74 同款混合期语义）；FLY 本票已死无需失效缓存，后续同类新票自然生效。审计键 `stage1.jev.staleSourceOverride`（lagSec/staleSec/rawTiming 可追溯）。

### C74 啾啾案 0x21bfeeddb550e3e84d3c9783523e1153e19a7777——推文时效分桶（expired_tweet 6h→300s relocate 买腿 lag 门）+ direct_tweet 高影响力新闻推豁免：「时效三情况——新闻热点选早票/找角度须立即发币严格，高影响力用户发的新闻被人发现得晚应豁免」（2026-10-16 用户裁定）★

- **案发**：flap 非 BNB 盘 2026-10-15 22:51 发币，语料=@KarluskaP（41.7 万粉 verified）新闻转发推（视频源 Douyin→IG→Twitter 跨平台扩散），推文 14:01 UTC → **lag 8.8h**。token **116 秒毕业、峰值 11.6x**，但被 precheck `expired_tweet`（6h 一刀切）拦成 rating=1 → 一票否决永久拉黑（precheckStage=null 无重试窗），**Jev 从未运行**；即使过了，v12 买腿裸 `narrativeCorpusLagSec < 300`（C71 删 earlyReturn 右支后残余左支）也独立拦死；earlyReturn 检查时已 92%（最终 11.6x）逃生通道同样失效——三层杀伤链。
- **结构性发现**：粗筛（precheck 6h 一刀切）杀得比细筛（C68 mapper 6h 只打 angle/interpretive 两桶）狠且挡在前面；direct_tweet 类（推文即事件源）没有任何精细时效评估路径——而「高影响力用户的新闻推文」正是最不该按「发推→立即发币」假设对待的形态（被人发现得晚，不一定有推文立即有人发币）。
- **三情况裁定**（用户 2026-10-16）：①新闻时事热点（买家选早票）→时效严格；②找角度推文（找到角度立即发币，迟发有问题）→时效严格（C68 已有）；③**高影响力用户发的新闻**（≠找角度，易混淆）→**时效大幅放宽**。架构裁定：买腿 `narrativeCorpusLagSec < 300` **移入叙事引擎**。
- **四决策**（AskUserQuestion 确认）：情况③判定线=复用 `classifyTweetType` 现行 `direct_tweet` 线（粉≥5000 或 赞≥500 或 转≥100）；放宽幅度=**不设硬界**，全交 Jev `event_timing` 软评（7d/30d/older 事件尺度，正在发酵=满档；题面零改动 JEV_QUESTIONS_VERSION 不动）；规则位置=precheck 层按桶参数化窗宽；无推文锚语料（account 型/纯 IG 型）=**接受放宽**（旧买门 null-lag 拦截是因子形状副作用非有意设计，迁移后评级 2/3 即可买——观察期盯这类票实际盈亏）。
- **改动面**：①`pre-check-service.mjs` 规则 2.1 分桶——`classifyTweetType(twitterInfo)` 判 direct_tweet 跳过 kill（日志「规则2.1豁免」），其余桶（angle_seeking/interpretive_reply/unknown 含中间地带字段缺失兜底）窗 6h→**300s**（`NON_EXEMPT_TWEET_FRESH_SEC=300`，秒粒度 `<`：299 放/300 整拦，对齐旧买门口径；旧 precheck 是分钟粒度 `<=`）；ruleName 保持 `'expired_tweet'`（监控口径连续），details 新增 `tweetType`+`freshWindowSec`；**豁免是语料级**（主推判 direct 即整组放，旧 website_tweet 也放——时效全交软评）。②旧分钟窗 config 键 `expiredTweetMinutesThreshold` 废止删除（pre-check-service fallback + NarrativeAnalyzer 死拷贝两处；config/default.json 本就未设）。③C68 mapper `ANGLE_TWEET_STALE_SEC` 6h **保留作纵深防御**（兜 ignoreExpired 穿透/precheck 锚缺失跳过/缓存残例），注释更新不再同窗。④库 buy-v2 v12→**v13**（`scripts/bump-buy-v2-v13.cjs`）：删 preBuyCheckCondition 裸 lag 子句；因子计算链不动转**纯观察键**（signal metadata 照落）。
- **边界/风险**：301s~6h 非豁免票从「precheck 放、买门拦」变「评级直接 low」（评级层爆炸半径）；豁免桶反向翻案；**存量 token_narrative 缓存行不重析 → 新旧评级混合期分布不可比**；中间态安全（v18 持 v12 快照+新引擎=豁免票 rating 翻 2/3 也被残余 lag<300 拦住，双门一致无空窗，v13 引用实验建出才真正放开）；分类器依赖字段缺失落 unknown 偏拦 fail-safe。
- **锚集合不一致备忘**（刻意不统一，差异边际）：因子 `narrativeCorpusLagSec` 3 源（主推/父推/第二推文 Math.max）/ precheck 4 源（+website_tweet 任一新即活）/ C68 4 源（最新一条）——逻辑上 quoted/retweeted/in_reply_to 都早于主推，主推为准的因子口径最严。
- **验证**：`_test_precheck_tweet_freshness_bucket`（28 断言：啾啾现场豁免 A/现场反证 A'（同形状只改粉丝 1500→angle 拦，证翻转来自分桶非窗变宽）/边界 299-300-301/三桶回归/负 lag/多源对称/互动臂 7d30d/account/ignoreExpired/源码八防）；`_test_angle_timing_override` 同步（B2 窗内 fixture 1h→60s 表新窗，C2 改「6h 纵深防御+300s 分桶共存」）；`_test_precheck_tweet_freshness_bucket`+回归七测全绿；`scan-unknown-factor-conditions` 零新命中（9 处存量 tokenCycle 不变）。
- **部署注意**：改库 copy-in 不即时生效（v18 持 v12 快照）；生效=叙事 worker + 实验进程重启 + 新实验引用 v13；啾啾端到端现场反证（182：`updateIsValid(addr,false)` → `analyze(addr,{ignoreCache:true})` 断言无 expired_tweet、stage1.jev.* 有落）待跑。

### C73 特斯拉飞行汽车三票案——轰动事件波三票三种病：①量级证据缺失撞载体门 ②空语料 no_public_info ③gmgnUserPct fire 门（叙事未触达）；裁定=空语料推特搜索兜底先行（SearchTimeline 冒烟已过）+「大事件」跨票共享记忆立项（2026-10-16 用户裁定）★

- **背景**：Tesla Roadster「飞行」reveal 2026-10-15 直播（官方 @Tesla 24.8M 粉 43.7K 赞；SawyerMerritt 26.8K 赞"OMG the Tesla Roadster just flew"；Polymarket 2M 粉 BREAKING）→ 同波 36+ 同名票（0xec2a 分析时 strictSameNameTokenCount 已=36），且 0x109a 与 0xec2a 同 creator `0x9049…f4c06` 九小时两发（波 farming）。三票全部毕业（2.5/4/10 分钟）但零买入。
- **票 1 `0xec2a0f1c…7777` 特斯拉能飞（flap）**：fire 21s，直调 5.7s，**J1.29 形象载体门拦**（C 类 + subject_carrier=no_visual_entity 0.44，existing 0.34 惜败）。语料其实有：宣告推文+YouTube+图分析（vision 0ms=dataPrefetch 预取缓存命中，链路正常）。**主死因是量级证据缺失**：推文文本「ONDO stocks, NOT BSTOCKS」与事件无关、配图是预测市场截图（TSLAON/SPCXON）、推文 20s 龄 metrics 全 null → **Jev event_magnitude 只打 1-2 档（magnitudeTier=C）**，它不知道这是世界级事件。关键推断：单独给载体门加轰动豁免救不了这票（C 档量级评分数学上本就不过线）——先修事件证据，豁免才有触发面。
- **票 2 `0x109afc17…7777` FTR（flap）**：fire 67s，**precheck no_public_info 拦**（IPFS metadata 抓到但 creator 零字段）→ 搜索兜底的标准场景。
- **票 3 `0x20613905…7777` Rocket Car（four.meme）**：**无 signal 无叙事行**。90s 窗 92 ticks 重建：buyVolumeBnb t=44s 过 1.5 ✅ / holders t=45s 过 5 ✅ / mcap 7-13K ✅ / slope>0 ✅，**唯独 gmgnUserPct 峰值 16% 撞 40% fire 门**——轰动事件 FOMO 买单直连进场不走 GMGN 路由。票内 GMGN 钱包 11 个（52 参与钱包 21%）、买入 top1 1.97 BNB 占 26%（庄拉盘观感成立但不极端）。用户裁定：**不动门**（「不能因为一个票完全改底层规则…如果砸盘同样的限制就对了」）；组合规则 `pct OR gmgnWallets>=K` 语义成立但 K 无消融数据支撑（holderTrendCV 单类拟合否决案同款），列为可选后续（gmgnWallets 尚非 FA 因子，_walletRoutedBuyBnb size 现成）。
- **冒烟验证（apidance SearchTimeline，2026-10-16）**：`GET /graphql/SearchTimeline?variables={rawQuery,count,product,…}` apikey 头，与既有调用同基座。**事件名搜索可用**（"Flying Tesla Roadster" Latest 1.6s 22 条带互动数据；Top 给出官方高互动证据链）；**CA 直搜 404 死**（裸/引号均拒）——宣告推救援走不通，事件证据为主用例。
- **三提案裁定**：①空语料→推特搜索兜底（挂 precheck 空 classified_urls 路径，本就必拒零回退风险，搜索结果互动数据同时是量级证据）**先行**；②轰动事件免形象载体门（形状窄：effTier∈{S,A}）**等①落地**（本案实证 Jev 从 token 局部语料打量级不可靠，题面改锚分不动教训又+1）；③**「大事件」跨票共享记忆立项**（用户 2026-10-16 提出）：分析发现大事件→存全局事件行（key=事件词根，value=量级/关联票数/互动样本，TTL 7d），后续票 state-builder 注入「已知热点事件背景」**作证据不作 override**（匹配须语料级防错配放行）；自家同名簇计数（strictSameNameTokenCount）即是波规模硬证据可同管道进 state；23.5k 历史行可离线回填事件库。①③共享「事件证据进 state」管道。
- **教训**：轰动事件的 token 局部语料（宣告推 20s 龄无 metrics/预测市场截图/角度推）撑不起量级判定——事件量级是**外部+跨票累积**证据，单票孤岛 state 结构性缺这个信息。

### C72 小黑案 0x9641293a72d25a00982dc711425c9a2f74fc7777——vision 前置 Jev 预判门（G1.0）：「文字已足够确认叙事就免掉 vision 图分析」（2026-10-15 用户裁定）★

- **案发**：v17 live 买入延迟归因（用户问「也稍微晚了一点」）。21.9s 总延迟三分：fire 门市场积累 8.5s（39%，策略语义不动）+ **vision 图像分析 6.6s（30%，真正瓶颈）** + live 发单执行 4.6s（21%，正常水位）。细看直调 8054ms 内 vision 段 6625ms 占 82%——单图全程 11.17s（下载+Qwen3-Omni 推理），dataPrefetch 预取门已工作（提前 3.4s 发起）但预取追不上 fire。
- **用户思路与裁定**：「如果通过文字已经足够确认代币的叙事，是可以免去 vision 的。在真正进行图像分析之前，让 Jev 给个『是否需要分析图片』的判断。当然这个 Jev 的判断流程不影响图片信息的预先获取流程」；①`vision.gate.enabled` **默认 true** 直接全链生效；②本地完成后即部署 182。
- **方向安全性论证（裁定依据）**：误判 sufficient → 本票无图语义 → J1.30/C59 图证据豁免不触发 → **偏拦 fail-closed**（损失是错过票，不是买入风险）；误判 need_image / Jev 失败 → 跑 vision = 原行为（多付 ~0.5s 门调用）。「无图」是链路既有自洽形态（无配图票/vision 失败降级票）：state 不渲染图块、J1.30 条件题不问（imageConsistency=false 防幻觉）、图证据豁免恒不触发——跳过 vision 与之完全同语义，**下游零改动**。
- **改动面 1（题集 G1.0）**：新增 `jev-visiongate-questions.mjs`——1 题 Choice `vision_gate_sufficiency`，state=与主 Jev 同语料的无图形态（buildJevState 不带 superIPInfo/preScores 装饰——判「文字够不够」必须看与主调用同样的语料）。题面锚定「**图会不会改变判定**」而非「图有没有用」（文字指代已清晰时纯表情包/氛围配图也算 sufficient）；need_image 三判据（名字证据可能在图内文字/视觉翻案证据/文字指代弱）；`judgeVisionGate` 概率门 `sufficient ≥ minSufficientProb(0.6)`，`probabilities.sufficient` 缺失 → 0 不跳（**宁跑勿跳** miss 方向）。
- **改动面 2（门服务）**：新增 `vision-gate-service.mjs`——`shouldAskVisionGate`（门开 + tweet 型 + 有首图 + **未挂 image_analysis**；已挂=预取完成/缓存命中零耗时直接用图不问门）；`runVisionGate` catch 永不 throw（失败 `{skipped:false, error}` fail-safe）；日志一行 `门判定=choice p=prob Nms → 跳过/跑vision v=G1.0`。
- **改动面 3（analyzer 接线 + 竞态屏蔽）**：门 wrap（`timing.wrap('vision.gate')`）在原 vision await **之前**；`if (!visionSkipped)` 外层 if 跳过形状（跳过时 timing 无 `vision` 段，统计口径干净）。**竞态防线**：visionPrefetch 泳道 0 后台 visionPromise 跑完会原地挂 `twitterInfo.image_analysis` → 门跳过后主链消费点可能中途读到图证据——`jevFetchResults = visionSkipped && twitterInfo ? {...fetchResults, twitterInfo: {...twitterInfo, image_analysis: undefined}} : fetchResults` 浅拷贝屏蔽（superIP/standard 两处 state 构建 + `imageEvidence`×2/`imageConsistency`×1 布尔前置 `!visionSkipped &&`）保证确定性无图语义。浅拷贝不动原对象：后台 vision 照常挂载/写缓存（预取不受影响）；若随 dbSave 落库，下次重析 reassemble 复原 → 幂等门直接放行用图（**重析时图免费**，行为良好）。
- **改动面 4（config 默认开）**：`narrative-engine.json` vision 节追加 `"gate": {"enabled": true, "minSufficientProb": 0.6}`（getConfig 有 configCache，改后须重启生效）。
- **已知边界**：门判定与 vision 段内部缓存命中不可兼得（预知缓存需查一次 DB，门本身就想省时间）——缓存里其实有图但门判 sufficient 跳过时按无图评，方向仍偏拦可接受。prestage 路径零消费 image_analysis 不接门；superIP/标准路径接。
- **审计口径**：timing 段 `vision.gate`（门延迟）+ 日志行含 G 版本；**不新增 DB 列、不覆盖 prompt_version**（门是过程不是评级，token_narrative 行形状零变化）。观察项：线上跳过率与误跳过 case 反馈 → 后续校准 `minSufficientProb`。
- **单测**：`scripts/_test_vision_gate.cjs`（35 断言，零 DB 零网络）：A judgeVisionGate 纯函数 / B 服务行为（门关零 fetch、400 不 throw）/ C 资格矩阵 / D 源码口径锁接线（import 行、门在前、外层 if、布尔恰 3 处、jevFetchResults 恰 2 处、config 默认开防线）/ E 端到端 analyze()（门开 sufficient→timing 有门段无 vision 段+tweet_image 缓存零读+主 Jev state 无图块；门关对照→vision 段在场；visionPrefetch+门跳过→竞态屏蔽，vision 桩延迟 80ms 才能构造「预启动仍在飞」场景——瞬间 resolve 会在门判定前挂载完毕走「已挂=直接用图」分支，非竞态）。配套 `_test_name_image_consistency` F3/F4 源码锁同步新正典形状（`!visionSkipped &&` 前缀）。

### C71 猪五花案 0x7603c74b6c0236e3284ca3a37c82799498d87777——每钱包笔数门（tpw）+ 删 earlyReturn>=100 豁免右支 + gampsito 黑名单（语言门裁定后撤销）+ GMGN 真人标签四观测键：等额分仓对倒拉盘的摊薄攻击（2026-10-15 用户裁定）★

- **案发**：flap 非 BNB 盘 PorkBelly 2026-10-15（v17 live 203570e3 首亏 -59.9%）。时间线：@gampsito（4642 粉英文找角度号，「Imma redeploy it 猪五花」挂 TikTok 真猫主 20 万粉）→ 发盘 lag 545s → t+6s **14 钱包同刻起跑等额分仓**（0.594×3 / 0.414×3 / 0.298×3 精确到 0.001）→ 90s 内 183 笔/24 钱包 = **7.63 笔/钱包**（散户 1~2）、买入 5.42 BNB、拉盘 +103% → 引擎 t+93s 顶点买入（earlyReturn 103.27 **刚过 100 解锁豁免**）→ t+150s 崩 -15% → t+163s 止损离场。GMGN 归因 creator EOA t+6s **零买纯卖** 0.542 BNB（creator_close）。
- **防线失效复盘（摊薄攻击五型）**：单钱包浓度门被 N 钱包等额分仓稀释（top1 10.9%、bundler 0、sniper 0.2% 全放行）；机器可制造指标反向利用（earlyReturn 拉盘精确卡线解锁豁免、routerPct 87.9% 反超 [50,80) 上限、gmgnUserPct>=40 豁免反成买入理由）；观测键未进门（visitingCount 买时 3 vs 顶点 38、renowned/smart/whale 全零=真人标签缺失指纹、dev.creator_created_count=11 均已采集未映射）。
- **用户裁定**（六条）：①tpw 门 `earlyTradesPerWallet < 4`（signal 子集活票 1552 上 tpw>=4 拦 8 票**零正值误伤**：PorkBelly -55.3/FANQIE -16.4/Fin -41.1 等 4 大亏+4 中性；tpw>=5 更精准但覆盖窄）②删晚票门 `(OR earlyReturn >= 100)` 右支（7d signal 集 2029 票：豁免面 118 票中位 -0.3% 中性非利润来源，拉盘可精确制造 earlyReturn=结构性攻击面，删=安全方向）③`lag < 300` 左支保留（区分度弱但无害，语义=叙事新鲜度早票证据门）④**语言门撤销不加**（用户澄清「只针对找角度推文」而数据是全量语言分布非该子集；中文为主桶 -8.3% 反而差于纯英文 -6%，无收益优势；只把 gampsito 加黑名单单拦）⑤`creatorCreatedCount` 仅观测不进门（老发币 Dev 发新币是常态，硬门误伤）⑥uniformBuyCluster 谨慎进门（GMGN 默认购买额度使等额簇自然形成——数据反证：等额值 Top15 全是整数档 0.10/0.05/0.02，低簇占比才是分仓拆散的作弊形态）。
- **改动面 1（每钱包笔数因子三处键点）**：`EarlyParticipantCheckService._calculateBasicStats` 聚合 `tradesPerWallet/maxWalletTrades`（wallet=participant 归一、买卖照计与 tradeCount 同源）→ result 组装 `earlyTradesPerWallet/earlyTradesMaxWalletTrades` + `_getEmptyResult`（查询异常 0 值）+ `getEmptyFactorValues`（未执行检查 0 值）**三处全等缺一不可**（null 会使 `<N` 写法恒 false 误拦；拦截写法 `< 4` 下 0 恒放行单边安全，无 covered 键）。同一 90s 窗零新增查询；FactorBuilder.buildPreBuyCheckFactorValues 透传（回测兼容）；单测 `_test_early_per_wallet_factors`（A 聚合矩阵/B 猪五花 183 笔 24 钱包事故现场反证 tpw=7.63≥4 必拦/C 集成/E 源码口径恰 3 处注入断言）。
- **改动面 2（策略库 buy-v2 v11→v12）**：preBuyCheckCondition 删 `(narrativeCorpusLagSec < 300 OR earlyReturn >= 100)` 右支 + 加 `AND earlyTradesPerWallet < 4`；scan-unknown-factor-conditions 零新命中（9 处存量 tokenCycle 遗留为已知面）。⚠库条目 copy-in 语义：实跑 v17 仍持旧条件快照，新门生效需重建实验。
- **改动面 3（gampsito 黑名单）**：`config/default.json narrative.twitterBlacklist` 追加（存量 6 个保留）→ precheck 规则 1 low 终判；`frequent-issuers.mjs` FREQUENT_ISSUERS 同步（[2000,5000) 粉中间地带分类盲区修复：gampsito 形态落 angle_seeking high confidence——纯分类路由不改评级，C68 时效门照常消费载体）。刻意不加 fetch 层拦截（拦 fetch 会让 precheck 拿不到 author 只剩 TikTok 语料照样 mid）。**生效需重启 182 叙事 worker**。
- **改动面 4（语言门先落再撤）**：本案先落了 angle 推 CJK>=0.2 门（pre-check 规则 `_cjkRatio`），用户复核数据后终裁撤销——**零残留删除**（pre-check-service 规则块+函数+import、config `angleTweetCjkGate` 段；单测 F4/F5 零残留防回流断言锁定）。教训：策略性收窄类门先跑影响面数据再落。
- **改动面 5（GMGN 真人标签四观测键）**：`extractGmgnRisk` 已含 creatorCreatedCount/renownedWallets/smartWallets/whaleWallets（提取层）→ `mapGmgnRiskFactors` 补透传 `gmgnRenownedWallets/gmgnSmartWallets/gmgnWhaleWallets/gmgnCreatorCreatedCount`（因子层，缺省 0）→ 第三层 `metadata.gmgnCheck` 自动带四键（数据积累备未来门）；`_noDataResult` fail-closed 形状同步八键全 0。**GMGN_CONDITION_FACTOR_KEYS 刻意保持四键**（观测键不进条件键集=防未经校准的门被引用；KOL 豁免通道 `renownedWallets>=1` 与注意力背离门 `earlyReturn>50 AND visitingCount<N` 为候选，待数据积累后裁定）。单测 `_test_gmgn_risk_factors` 补猪五花形状（真人标签全零+creator 11 币）。
- **扫描方法学坑（uuid 无序 keyset 跳行第三犯）**：strategy_signals/token_narrative 分页用 `reduce(max(id))` 游标无 `order`，planner 走 block_time 索引序≠uuid 序大量跳行——7d signal 集 197/2029 **只捞到 10%**（猪五花本身都被跳掉，「门拦不到票」是假象）；修复=`.order('id', {ascending:true})` 标准有序 keyset。同族：wss_events create 锚批量分页跳行（17680/17133/15998 三次漂移）改 per-token 点查。临时脚本 `tmp-scan24h.cjs`（A 24h 全市场/B 7d lag/er/C 语言）/`tmp-scan-signalset.cjs`（D signal 子集门模拟）存档可复跑。
- **画像疑点更正**：猪五花 90s 窗买入钱包离线画像覆盖 18/20（初判「0/15 命中」有误）；miss 2 个=当日新钱包（历史 0 票）=固有盲区非构建滞后（画像库 10-14 22:56 UTC 构建）。

### C70 bunker 案 0x2ec1e08c2c6343671728ef7c6e7fde0bd6f07777——prestage 账号基本面三道门全删（粉丝带只定档不拦截）+ 账号语料缓存失效（穿透必重取数）+ 叙事重试实验级参数化：「交易者不会因为项目方粉丝少/账号新/推文少拒绝一个项目」（2026-10-15 用户裁定）★

- **案发**：flap 盘 bunker 2026-10-15 07:20:16 UTC 创建（依托 @bunkeronbnb），**21 分钟毕业**。时间线复盘：发币后 5 秒（07:20:21）首析拉取 userInfo——2 粉、4 推、当天 04:26 注册（3h 新号）；**宣告推（含 CA）07:22:31 才发**；worker PrecheckFailRetry 三次重试（07:21:49 / 07:22:19 / 07:23:49）**全部命中 07:20:21 的 `twitter_user_info` 缓存行**（maxAge 30 天，日志「缓存命中」×3 实证）；第三次推文层拉到 CA（新号「覆盖深度不足」判据使推文层每次真拉）→ address 验证过 → prestage Jev 判 project → **粉丝 2 < 20 底线 → low 终判**（07:23:51）。实时：94 粉、17 推——发币后 10 小时全部涨出来，粉丝轴对「当天新号发币」场景系统性失真（首析 5 秒快照必然是最低点）。
- **数据背书**：近 7 天粉丝底线拦截 168 票、其中 16 票毕业（9.5%）——底线门判别力接近随机；删门方向由此定案。
- **用户裁定**（多条原文）：①「我的想法是，我们要模拟用户（交易者）的思维，交易者会不会因为粉丝量/注册时间拒绝这个一个项目？我觉得不会。所以我还是觉得把分析量/账号注册时间等要求删除即可」②方案三边界（AskUserQuestion）：删门范围=三道全删（粉丝<20/推文<5/注册<30 天 + P1.5 实度豁免）；worker 去留=实验级为主 worker 兜底保留；触发形态=扩展 C67 fire 时顺带穿透；`performRulesValidation` 质量门保留 ③（强调）「叙事未通过→重新取数→重析」机制**仅仅限于依托推特账号类的代币，其它不需要**——三层形状门收窄（引擎 isAccountOnlySource / analyze 内失效形状门 / worker 语料形状门）。
- **改动面 1（mapper 删门，P1.9 → P1.10）**：`rateProject` 重写为纯粉丝带定档——账号 0-299 mid / ≥300 high（**不拦截只定档**）；社区 ≥100 且 activityChoice==='high' 才 high；`baselineMet` 恒 true。删三道门 + P1.5 实度豁免逻辑（`qualityExempt`/`downgrade` 全删）；`prestage_project_quality` 题随豁免逻辑删除（唯一消费方已不存在，**5 题→4 题**，无消费方的题不烧 Jev 配额）；`prestage_token_type` 判据措辞同步（"follower baseline is checked separately in code" → "follower count decides nothing here — it only sets the rating tier in code, it never blocks"）。题面判据一处修正+mapper 语义变更，按 a3de68c/31d1bc4 先例 bump 版本（P1.10），同 token 两版本评级不可比（**low→mid 单向翻转**）。
- **改动面 2（账号语料缓存失效——C67 机制缺陷修复）**：C67 `ignoreCache` 只跳过 `token_narrative` 行缓存，**数据抓取层全吃 external_resource_cache**——`twitter_user_info` 30 天 TTL 使穿透重析不重拉 bio/时间线（= bunker 三次重试吃同一份 2 粉快照的根因；项目方把 CA 后补进 bio 时 30 天缓存导致永远匹配不到）。修复：失效下沉 `getAccountWithFullTweets` 内部（外部失效提取 handle 会漏 worker 被析账号），`invalidateAccountCorpusCache` 失效**三键最小集**：`twitter_user_info:<handle>`（30d，bio 后补 CA 载体）+ `twitter_user_tweets:<userId>`（宣告推载体）+ `…:ca:<addr>`（CA 早停行）；userId 从失效前旧行 getRow 读，读不到只失效 userKey（首析成功⇒userInfo 行必在，重试域内罕见）。**`twitter_account` 层刻意不失效**（已核验 address 验证/prestage state 只消费上两层；少删一行少一次真拉）。option 线程穿透 `analyze({invalidateAccountCorpus})` 带语料形状门（twitter 桶非空且全部 type==='account' 才失效——非账号型票传了也零失效零重取，静态语料无重取价值）。
- **改动面 3（C67 参数化 → 实验级 `fourmemeWs.narrativeRetry` 四键）**：`enabled`（默认开 `!== false`——与 dataPrefetch「关=删段」物化语义**刻意相反**，引擎默认开删段=静默重开）/ `intervalMs`（穿透 TTL 毫秒，校验 [1000,600000] 缺省 10000）/ `maxAnalyses`（真跑上限 [1,50] 缺省 3；**计含首析的全部真实分析故名 maxAnalyses 非 maxRetries**，缓存命中不计）/ `windowSec`（叙事否决豁免窗 [60,7200] 缺省 300；⚠️**不得低于 worker retryWindowSec**——拉黑先于末次重析翻正=误拉黑且 `_narrativeBlockedTokens` 无撤销路径，引擎构造点 ≥60 校验）。穿透执行点带 `{ignoreCache:true, invalidateAccountCorpus:true}` 双键（穿透必失效账号缓存）；`shouldBlockOnNarrative` 第 4 参 windowSec（缺省 300 存量零影响）+ 引擎闭包包装（三个消费点签名零改动）；flap 实验经 `_mergedWsConfig` 自动读 flapWs 段；**BacktestEngine 零接线保持**（历史行 analyzed_at 恒早于墙钟，穿透=语料前视）。
- **改动面 4（worker 兜底同构）**：`_shouldRetry` 加语料形状门——address 域非账号型（推文型/混合型/null 语料）skip `'not-account-source'`（计 `stats.notAccountSourceSkips`，不烧 Jev 配额）；address 分支 `analyzeOpts` 改 `{ignoreCache:true, invalidateAccountCorpus:true}`（失效在 analyze 内部执行且自带形状门，与 GMGN 分支「失效失败前置跳过」语义刻意不同——DB delete 失败≈DB 故障 analyze 自会失败）。**no_public_info 域不动**（GMGN 补语料入口，FOMOON 案独立裁定，不在收窄范围）。
- **边界（已裁定/已记录）**：①`performRulesValidation` 账号质量门保留（粉≥500+推≥20 等——address 重试域**构成机制**，CA 命中后不参与评级）②穿透成本放大（缓存读 ~70ms → apidance 真拉+Jev 秒级）：C67 已接受 N+3 口径，失效后单价再升（每穿透=真拉 userInfo+UserTweets），配额由 maxAnalyses 封顶③机制适用域仅账号类语料（三层形状门收窄）。
- **UI**：创建页「🔁 叙事重试」区块（nr-enabled 默认勾选 / 穿透 TTL ms / 真跑上限；windowSec 无表单项=复制链路整段携带）；collectFormData 物化语义三分支：回测剥离 / 显式关写 `enabled:false`（数字键不写——引擎 `enabled!==false` 短路在先，写了是死配置）/ 开+数字写段（浅合并保留复制携带的 windowSec、按平台选段删另一段防双段并存）。
- **单测（6 个）**：`_test_prestage_project_downgrade.mjs` 重写 29（bunker 反证：2 粉 4 推当天号双路径 mid + baselineMet true；299/300 边界；**输入不再消费锁定**——只改 statuses/created_at rating 不变；全链 P1.10）；`_test_unrated_elimination.cjs` 32（版本锁+四门形改 mid）；`_test_narrative_account_ttl.cjs` 53（+J 参数化生效/K 穿透 options 双键/L bunker 现场反证/M windowSec 第 4 参矩阵）；新 `_test_account_corpus_invalidation.cjs` 20（A 三键纯断言/B 失效→真拉→回写时序**事故现场反证**——不带失效=吃 2 粉旧行零网络即 bunker 事故/C 未传 invalidateCache 零失效机器证明/D 源码口径五锚）；`_test_precheck_fail_retry.cjs` 42（+address 域失效断言+L 形状门矩阵：推文/混合/null skip，no_public_info 照旧）；新 `_test_narrative_retry_config.cjs` 31（源码口径四层：引擎构造段/BacktestEngine 零接线残留反证/route 校验/模板三处物化语义）。回归 17 项全绿（vision_prefetch 18——C8 destructure 行尾随追加 `invalidateAccountCorpus = false` 同步锁双默认值）。
- **生效面与缓存**：无 DDL；**实验引擎进程与叙事 worker 两者都必须重启**（各自缓存旧 mapper 直到重启；顺序可互换）；P1.10 前存量 low 缓存行不自动重评（同 token 跨版本评级不可比）；worker 形状门对存量非账号型 address-fail 候选即刻生效（skip 不再烧配额）。

### C69 Hatchan 双盘案 0x40b4b42b6b3c18e67e0fdc9755ac32c9ae8a7777 / 0x5f107c3aadf89fb784acaf997df3b8a0d9c87777——expired_tweet 6h 窗唯二误杀（新闻发酵型形态）：双盘同叙事 105 秒前后脚全毕业，256 票全量扫描背书规则整体健康（误杀率 2/256 且同一事件），存档不改（2026-10-15 用户裁定「先存档」）

- **案发**：秋田犬机器狗防熊真实新闻（日文媒体，秋田县立大学，RT 160/赞 332，2026-10-14 06:00:50 UTC）→ 18:44:34 **Hatchan**（英文 symbol，creator `0x5ad4…10d1`，**quote=宇树股票代币 `0x34b658a2815f2a34c752a051a7c84bbc39b07777`** ERC20 盘——主题契合创意部署：机器狗叙事 × 机器人顶级股票）13 分钟 ×14.3 **毕业**；+105 秒 `0x5f10` **ハッチャン**（日文 symbol，不同 creator `0x10e2…a8a7`，另一 ERC20 盘 `0x02fc…7436`）69 分钟 ×12.1 **毕业**。双盘均被 precheck `expired_tweet` 终判 low 20 分（主推 lag 12.7h/12.8h > 360min 窗）未进 Jev；v15 引擎层 fire 门未满足零 signal（无实际交易损失，纯信号层失明）。
- **256 票全量扫描**（2026-10-15，182 `scripts/tmp-scan-expired-tweet.cjs` 可复跑）：expired_tweet 历史拦截 256 票中 **x3+ 或毕业的仅此双盘 2 票（0.8%，且同一条主推文=同一个事件）**，其余 254 票全部 x<3 零毕业——规则整体校准正确，无放宽依据（放行进 Jev = 烧 256 次调用换 1 个事件召回）。
- **反思存档**：①「lag 单变量终判」的结构性风险在**真实新闻发酵型**形态失灵——媒体转载链 12h 后仍处上升期（与 C68 找角度形态相反方向的压力 case，时效轴一收一放两面挨打记录在案）；②**宇树股票交易对=部署用心度维度引擎零感知**（quote 选材契合、105 秒克隆盘跟进=叙事跨盘持续拉力信号，用户观察）；③250/256 历史 reason 文本 lag 不可解析（格式漂移），未来常态化监控此桶须换锚源（twitter_info 主推 created_at）。候选信号（媒体型推文高互动 + lag 6-24h 发酵窗 + 部署创意）挂 §四-16 未决，**再攒 2-3 个同类 case 才议分窗/豁免**。
- **裁定**：不改规则、不建机制——用户 2026-10-15「这个币的部署方式是有一些创新的，它使用了宇树科技股票作为交易对……如果你没有更好的主意，可以先存档」；扫描数据出来后确认存档正确（误杀率极低，双盘为孤立事件）。

### C68 제로案 0x0a27c1232ffe46f296af9afb68448dff7ad37777——找角度推文时效门（双层）：「找角度推文都是发出来后立马发币的」——载体推文→发币 lag 是 angle_seeking 的时效锚，不是叙事首次发生时间；IPFS 语料行锚缺失静默跳过=漏网根因（2026-10-14 用户裁定「1/2 都做」）★

- **案发**：fourmeme 盘 제로(Zero) 2026-10-14 14:00 发币，依托推文是 @rega_sport 2026-10-03 02:04 的「陈述韩国网红猫 Zero 叙事」找角度推文（`tweetType=angle_seeking`，Jev 判 A 类 character_ip 0.99 / B 档 3.4 / within_30d 0.96）——**载体推文 lag=993367s≈11.5 天**。叙事评级 high 73.89（stage2 事件 27+传播 26.8+时效 10=63.8 压线过）；实跑 8e271a2d 买门 `narrativeCorpusLagSec<300 OR earlyReturn>=100` 前几轮拦截（lag 993367），**earlyReturn 涨破 100 从 OR 通道翻入买入**（0.004 BNB，31 秒后 +6.8% 卖出——结果侥幸，机制漏网坐实）。
- **漏网链（两层叠加）**：①precheck `expired_tweet` 6h 窗本该拦（11.5 天必判 low），但 `raw_api_data.created_at` 缺失（IPFS 语料行无平台创建时间）→ 规则**静默跳过**——而同文件 0.5/0.55/0.58 规则早已用 `tokenCreatedAtSec ||` 回退链（fetchTokenData 的 wss_events token_create 回退锚，token-info-service 73-82 行现成算好），唯独规则 2 裸读，同文件内不一致；②Jev `event_timing` 锚「叙事首次发生时间」（猫走红 within_30d→10 分），对找角度形态语义错位——发币者蹭的是**载体推文的曝光窗口**，叙事再热、载体推文过期=角度已死。
- **用户裁定**：「angle_seeking 也就是找角度推文的实效性也需要有要求，找角度推文都是发出来后立马发币的」——找角度票的时效锚=「载体推文发布→发币」lag（分钟级为正常形态）；「陈述某个叙事」不豁免时效，反而要求更严。
- **改动面（修复①pre-check-service 规则 2）**：锚改 `tokenData.tokenCreatedAtSec || tokenData.raw_api_data?.created_at`（一行回退链对齐，零新查询——锚 fetchTokenData 已投机并发算好）。
- **改动面（修复②jev-result-mapper，mapper-only 题集版本不动——时效分本来就是代码查表，J1.16/J1.23/J1.24 教训分数锚定类必须代码侧）**：`overrideAngleTiming`（纯代码）——`tweetClassification.type ∈ {angle_seeking, interpretive_reply}`（解读型蹭大 IP 事件窗口同构，纳入）且载体推文 lag > `ANGLE_TWEET_STALE_SEC`(6h，与 precheck `expiredTweetMinutesThreshold` 同窗，改窗两处同步) → timing 归 `older`=0 分，覆盖 Jev 原判档。**direct_tweet 不动**（推文即事件，event_timing 锚事件发生时间语义本就正确）。载体时间取主推/website_tweet/quoted/retweeted **最新一条**（与 precheck tweetSources 同集，「任一新即活」对称——主推老但引用新推=角度窗口仍活）；锚或载体时间缺失不 override（fail-open，与 precheck 锚缺失跳过语义对称）。审计落 stage1.jev.`angleTimingOverride`={lagSec, staleSec, rawTiming}（Jev 原判档可追溯）。override 在 timing 变量源头生效：W/标准数学 + J1.24 punExempt 全下游一致消费（时效死票豁免无意义，punExempt 自然不命中）。
- **事故现场反证（单测 A1）**：제로 形状（A 类 B 档 3.4→27 分 + dim2 4.1→25 分 + within_30d）angle_seeking lag 993367 → override → stage2 27+25+0=52<60 **翻不过线**，终评不再 high；对照组（同形状非找角度形态）62>60 压线过——同票翻转锁定。
- **单测**：`scripts/_test_angle_timing_override.cjs` 20 断言全绿——A mapper 矩阵（事故反证/窗内 1h 不干预/direct_tweet 不干预/interpretive_reply 命中/锚缺失 fail-open/载体时间缺失 fail-open/主推老+quoted 新/6h 边界 21601|21599/rawTiming 审计）+ B precheck 锚回退（tokenCreatedAtSec 回退拦/窗内放/两锚皆缺跳过现状回归/raw created_at 在仍拦原行为）+ C 源码口径（回退链字符串锁定/两窗同源共存）。回归：web3_fit 29 / notable_other 22 / pun 18 / referent 39 / carrier 43 / superip 23 / name_image 36 / community 16 / precheck_parallel 20 / cashtag / publisher / narrator_two_shapes 全绿。
- **生效面与缓存**：182 pull + 叙事 worker/实验进程重启后生效；**本案存量 high 缓存行不自动重评**（token_narrative 行龄已 11.5 天 lag、载体时间客观存在，重跑会被新门拦——需要重评须手工失效该行）。

### C67 Virusking 案 0xa25cad994ca02755f0d9b6fe451077401b397777——账号型未过缓存 10s TTL 穿透重析：「如果叙事分析基于的信息是账号且没有通过，那么缓存10秒过期即10秒后可以再次分析，最多分析三次」（2026-10-14 用户裁定）★

- **案发**：flap 税币盘 07:19:00 创建（@Virusking_bsc 主页入口），事后 5 分钟 +230%（4.35e-6→1.44e-5 USD），实验全程未买。时间线复盘：07:19:0x 首析时宣告推**未发**（07:19:45 才发，正文含完整 CA）→ 账号质量门不达标 + verifyTokenAddress 未命中 → precheckStage='address' rating=1 落行（07:19:05.75）→ 此后 35 轮买评估（07:19:05→07:20:10）全部命中该缓存行（`is_valid=true` 短路，rating 恒 1）→ worker PrecheckFailRetry 两次重析：第 2 次 07:20:09.7 发起（07:20:10.9 resolved:true，宣告推已发 CA 验证过）→ 但 prestage 快车道 web3_native_ip_early **粉丝 15<20 底线门** → 仍 low；最后一轮买评估 07:20:10.335 比重析完成早 0.6s，此后买窗走完无信号。
- **两层归因（如实）**：首拦=宣告竞态（address fail，重试机制正常工作）；终拦=粉丝底线（独立门，重析翻正了 CA 验证也过不了）。本案形态下 10s TTL 穿透也难直接救回（3 次预算约 30s 内耗尽在宣告推发出前，且粉丝底线照拦）——机制救的是**宣告竞态+账号质量达标**的常见形态：首析 fail 落行后不等 worker ~30s 慢周期，~10s 即穿透拉到刚发出的宣告推翻案，买窗内放行。
- **用户裁定**（机制语义）：账号型语料=**动态**（账号时间线随时可能出新推），low 缓存行会失真；10s 过期即穿透重析，最多 3 次。推文型/website 型语料静态，无此语义（形状判据排除）。
- **改动面**：`src/trading-engine/pre-check/NarrativeDirectCaller.js`——①形状判据 `isAccountOnlySource`（classifiedUrls.twitter 非空且全部 type==='account'，导出纯函数）；②穿透块：getRating 首次结果 `meta.fromCache && rating=1 && account-only && 行龄≥10s && 真跑计数<3` → 当次 `_startAnalysis(..., { ignoreCache: true })` 强制重析（独立 `'!ttl'` inflight 槽：与常规调用互不 join——join 到缓存命中 promise 等于没穿透；并发穿透互相 join）；③`MAX_ANALYSES_PER_TOKEN=3` 双计费点：穿透发起即计（ignoreCache 恒真跑，失败/超时配额已烧——防穿透失败风暴绕过上限）+ 常规真跑完成补计（首析/miss 重跑；缓存命中 ~70ms DB 读不计）；④观测标记 `ttlReanalyze: true` 落 ratingResult。引擎构造点 `accountFailTtlReanalyze: true`（FourMemeWssTradingEngine）。
- **前视防线（回测禁穿透）**：开关默认 **false**——历史行 analyzed_at 恒早于墙钟，开了=每 token 命中都判「TTL 已过」→ 用「现在」抓的推文重评历史时点=语料前视。BacktestEngine 构造点不传=零穿透（fail-closed 方向：漏改也不会出前视事故）。
- **单测**：`scripts/_test_narrative_account_ttl.cjs` 32 断言全绿——A 纯函数五形状 / B 默认关零变化 / C 回测形状事故反证（memoryCacheResults 不带开关历史行恒老不穿透）/ D TTL 未到 / E 穿透翻正+标记 / F 计数封顶（穿透恰 3 次后回终态缓存行为，缓存命中不烧预算）/ F2 首析占名额（穿透仅 2 次）/ G 非目标形状三反证 / H 并发穿透 join（analyze 恰 2 次、计费恰 1 次）/ I Virusking 事故现场反证（首析 address-fail low → 次轮穿透翻正 3 → shouldBlockOnNarrative 不拉黑）。回归：_test_narrative_memcache 20 / _test_narrative_prefetch 38 / _test_narrative_timing_probe 42 / _test_narrative_vision_prefetch 18 / _test_narrative_leader_incremental 66 / _test_narrative_signal_gate 13 全绿。
- **计费口径修正过程**（首版 bug）：发起时无条件计数把缓存命中的常规调用（~70ms DB 读不烧 Jev/抓取配额）也计入预算 → 每轮命中 +1、3 次预算两轮耗尽、穿透实际只发生 1 次；修正为双计费点（穿透发起+常规真跑完成）后「防的是配额消耗不是结果」语义成立。
- **生效面**：182 pull + 实验进程重启后生效（机制在引擎进程内）；worker/回测/web routes 零变化。

### C66 红山动物园案 0xd73292fc…7777 / 0x05fec7c0…7777——陈述者交互终判四条删除（主体不是陈述者）：precheck 不再用「单帖交互数」代表「叙事主体传播力」毙票，交给 Jev 结合主体综合评（2026-10-14 用户裁定「四条全删」）★

- **案发**：同叙事（南京红山森林动物园梗）三票命运分叉——0x4360e611（twitter 源）评 high 买入 +21.2% 落袋；0xd73292fc / 0x05fec7c0（微博源，作者「南京市红山森林动物园」单帖交互 17<150）被规则 3.7 `weibo_low_engagement` 硬拦 rating=1 引擎拉黑，其中 0xd73292fc 随后**毕业（funds 13.26 BNB）**。同叙事评级由「token 网站恰好贴了哪个平台的链接」这一偶然性决定，与叙事主体价值无关。佐证案：土谛 0x20e4c2b7…7777 引**新华社**帖（转发11+评论1+点赞92=104<150）同被拦——官媒信源主体的传播力被单帖交互代表。
- **用户裁定（原话「同一个叙事，不同的陈述者，为啥有的过有的不过，这个叙事跟陈述者没关系，主体不是陈述者」→ 方案选定「四条全删」）**：precheck 的陈述者**帖子交互类**终判整体废除——①规则 3.7 微博帖交互 <150→low；②规则 3.6 微信阅读数 <1000→low；③规则 3.5.5 Instagram 帖点赞<50 且评论<10→low；④规则 3.5.8 YouTube 频道播放 <1000→low。四处的 low 分支删除改为放行日志（「不再终判，交给Jev综合评估」）；**高影响 mid 分支与中间分支保留不动**（放行性质不误拦）；**主页类三条刻意保留**（3.5.6 抖音 / 3.5.7 微博用户 / 3.5.9 TikTok 粉丝<100 且作品<5→low）——门槛语义=死号/刚注册小号，真实机构（新华社粉丝千万）不会命中，不产生本案形态的误拦。
- **语义归位**：陈述者交互数据（微博 metrics / 微信阅读数等）**本来就渲染进 Jev state**（weibo-section 等平台 section），Jev 层有 event_magnitude / subject_entity / 影响力轴可以结合主体知名度综合评——precheck 用陈述者单帖数据终判叙事主体传播力，是把「叙事价值判断」从 LLM 抢到代码侧的越权（违反卷三分工原则「LLM 管叙事价值判断，代码管市场事实」）。删终判后：主体知名（新华社/红山动物园类）Jev 自然给高档，无名小号自述帖 Jev 仍会评 low（语料交互数据在 state 里可见），不是无脑放行。
- **改动面**：仅 `pre-check-service.mjs` 四处 low 分支（纯代码侧，**无题集改动 J1.30 不 bump、无版本号变化**）；四个 fail code（weibo_low_engagement / weixin_low_reads / instagram_low_engagement_post / youtube_low_influence_channel）全库无单测断言无外部引用，影响面封闭。precheck 族单测 109 断言全绿（_test_precheck_fail_retry 35 / _test_data_fetch_failed_rating 30 / _test_precheck_parallel_queries 20 / _test_justoneapi_timeouts 24）。
- **生效面**：新分析即时生效；存量 low 缓存行不自动重评（is_valid 不动）——历史被拦票要重评须失效缓存（token_narrative 行删 / updateIsValid(addr,false)）。今日该规则共拦 5 票（红山×2 / 八元引印象新闻交互0 / 土谛引新华社104 / 가나디引一兜满星29），其中 genuinely 死帖（印象新闻交互 0）预期 Jev 仍评 low——删终判不是放垃圾，是把「垃圾/非垃圾」的判断权还给 Jev。

### C65 巴巴鸡案 0x1ea2…7777——J1.30 名图一致豁免 + img-v3 图内文字转写：「名字是一只鸡、图片也是一只鸡，恐怕认为这俩有关联就好了」——梗名只在配图的图内文字里，字面证据被图分析截断吞掉（2026-10-14 用户裁定「都做」）★

- **案发**：0x1ea2152c68a3cba1cd3ffe68abd97d95f9ac7777（巴巴鸡）叙事评级 low 被引擎 `_narrativeBlockedTokens` 拉黑。链路复盘：stage1 A 类（character_ip 0.84、strong_fit 0.92→web3FitAnchored B）→ stage2 66.32 过线 → **stage3 关联 cultural lv1=5 分 ≤10 截断 low**。语料：@in927772（1852 粉）2026-10-14 03:10 UTC「抖音新梗，无敌了，全网火了……」+2 图（mcp analyze_image 视觉核实图 1 = 抖音 APP 截图：**搜索框「巴巴鸡给鸡给巴巴视频」、视频标题「巴巴🤔鸡给鸡给😍鸡给鸡给😡哇哇🥵 #第五人格 #偷鸡舞 #律师」**、大萌芽 1 天前 9.8万赞——角色=第五人格律师戴红鸡冠皮肤跳偷鸡舞）。**误拦定性**：梗的本名就叫「巴巴鸡」（图内文字实证），Jev 判 cultural 弱关联是证据缺失下的自洽误判。
- **根因三层**：① 图分析（img-v2）prompt 无文字转写指令且 maxTokens 1500 截断——线上该票 key_elements 被截断成「猪八'"垃圾，「巴巴鸡给鸡给」字面证据根本没进 Jev state；② Jev 只剩「名字含鸡+图是鸡形角色」弱证据 → cultural 0.29 argmax（exact_match 0.14 次之）；③ 豁免位缺席——punExempt 不适用（无品牌预检命中）、C59 只挂 superIP 快车道（标准路径无豁免位）且 referent_memeability 1.86<3 也不满足（低估同样源于证据缺失）。
- **用户裁定（原话「这种情况，如果名字是一只鸡，图片也是一只鸡，恐怕认为这俩有关联就好了，因为给的信息可能很难判断」+ 两提案裁定「都做」）**：**P1 根因修复**——image-analysis-service `img-v3`：prompt 新增 `visible_text` 字段（图内可见文字逐字转写：标题/搜索框/水印/对话气泡/界面文字，无文字写「无」）+ 默认 maxTokens 1500→2500；config vision.maxTokens 显式覆盖同步 2500；twitter-section 渲染「图内文字（逐字转写）」行；旧 img-v2 缓存行版本不符自动重析（图片本体 tweet_image_raw dl-v1 不受影响不重下载）；**prompt 不含 token 名红线不动**（visible_text 是 token 无关的感知转写，指代判定仍归 Jev）。**P2 兜底豁免**——第 17 题 `name_image_consistency`（J1.30 条件题，choice 3 档 same_entity/same_visual_category/unrelated，仅主推配图分析挂载时问——brand_hijack 同款条件题模式，无图不问防幻觉作答）+ mapper（mapStandardAnswers）`imgNameExempt` 三门豁免 Stage3 关联≤10 截断：①imageEvidence（twitterInfo.image_analysis 存在，与 C59 条件①同源；答案缺失 nicMatchP=0 fail-closed——旧缓存行零影响）②same_entity+same_visual_category 合并 ≥0.5（合并质量抗跨 run 抖动）③0<relevance≤10（纯零关联不救，C59 条件②同款）。**relevance 分照常计入总分**（弱字面关联代价在分数上体现，J1.24/C59 同款计分语义）；与 punExempt 正交并存；品牌劫持/拼写/质量门不受豁免；superIP 快车道不消费本题（C59 的 meme≥3 门语义自洽不动）。
- **改动面**：`image-analysis-service.mjs`（img-v3/visible_text/2500）+ `config/narrative-engine.json`（maxTokens 2500）+ `twitter-section.mjs`（渲染行）+ `jev-questions.mjs`（J1.29→**J1.30** + 条件题）+ `jev-result-mapper.mjs`（imgNameExempt 三门 + 截断链 `!punExempt && !imgNameExempt` + 审计命中才落 + reason 前缀「名图一致豁免(J1.30)｜」）+ `NarrativeAnalyzer.mjs` 标准分支接线两处（buildStandardQuestions imageConsistency / mapStandardAnswers imageEvidence，同源 `!!twitterInfo?.image_analysis`）。
- **单测**（零 DB 零网络）：新增 `_test_name_image_consistency.cjs`（36 断言：问卷形状/巴巴鸡事故现场反证 B1-B6 含「修正前 vs 修正后」对照臂+relevance 5 分照常计入总分数值锚定/三门防线逐门 fail-closed/边界（恰 0.5 过线、单档过线、>10 不触发、劫持与拼写门不受豁免）/审计/源码口径含 P1 配套六项）；`_test_tweet_image_analysis.cjs` 扩 B10/B11/K3（visible_text 指令+透传+渲染）+ B5/C1 版本 img-v3；`_test_superip_relevance_exempt.cjs` H4 更新（标准路径截断链 J1.30 子句并存，C59 superIP 版 H1/H2 锁定不变）；`_test_subject_carrier.cjs` A1 放宽 ≥29。全量 13 项相关回归全绿。fixture 取整教训：`Math.round(1.4)=1`（none lv1=1 分仍 >0）与 `round(2.5)=3`（半分向上）——写 RELEVANCE_TABLE 锚定断言前先对表。
- **窗口缓存失效配套**：`scripts/narrative/invalidate-nameimage-window.cjs`（J1.28/J1.29 模式：基底买 signal distinct token → is_valid=false，--commit 才真跑；旧缓存行无 name_image_consistency 答案 → 豁免 fail-closed 不触发，历史窗口回测前须失效重析）。
- **部署与验证待办**：182 pull + 叙事 worker 重启后生效（题集/图分析都在 worker 进程内；跑中实验无需动 config）；J1.30 题集校准（`jev_calibration.mjs`——加题不改旧题语义，存量无图样本理论零漂移，实跑验证评级一致+无买线翻转放部署后）；新票自然验证豁免命中（审计 stage3 jev.imgNameExempt 可追溯）与 img-v3 转写质量（visible_text 进 state 后 exact_match 档应自然判出，豁免兜「图里没有文字、只有视觉主体」的现金猫型形状）。

### C64 朴蛋案 0x3c4c…7777——narrativeCorpusLagSec 锚点语义反转：取最新不取更早（「lag 卡最新的不要卡老的」）+ 价格口径分裂疑云查否（2026-10-14 用户裁定）★

- **案发**：2ad6a39b flap 票 0x3c4ca09c642541ffbcef0ae7310b420485627777（朴蛋）开盘后持续被 `narrativeCorpusLagSec < 300 OR earlyReturn >= 100` 左臂拦截（lag=3263s）。复盘语料：**主推=原梗推（byeol_ice 12:42:42，开盘前 54 分钟）+ 第二推文=宣告推（Gap2026_Dev 13:36:58，开盘前 7 秒）**——旧口径「主推/父推取更早 Math.min」把锚定在旧梗推上，「旧梗新盘/热点二次发酵」形状被机制性误判为预热盘；右臂 earlyReturn 在买窗内峰值 77（fire 价口径）够不着 100，整窗拦死。0fed29f9（C60）立门时的语料形状是「事件锚（父推）早于开盘=晚票」，朴蛋是「最新推（宣告）贴开盘=早票」——min 语义只对前者成立。
- **裁定与修复（2026-10-14 用户原话「lag 卡最新的不要卡老的」）**：`extractCorpusTs` 改 **Math.max**（主推/父推/**第二推文 website_tweet** 三候选取最新；website_tweet 候选为本案权威来源——宣告推挂在第二推文位）。语义边界：有新鲜宣告即按早票放行；纯预热盘（旧梗+更旧父推、无新推）仍取最新=旧梗照卡（A5d 反证锁定）。改动面：`NarrativeDirectCaller.extractCorpusTs` + corpusTs 注释；`_test_corpus_lag_factor.cjs` A3/B1 改主推锚 + 新增 A5b/A5c/A5d 三断言（34 通过 0 失败）。**null 语义不变**（无语料→晚票严格门 fail-closed）；负值=宣告竞态保留。
- **价格口径分裂疑云（查否留档）**：同案排查中我一度判「FA 吃 raw quote 价冒充 BNB（失真 479 倍）、DB 落换算价，两口径分裂」——**复查推翻**：信号快照里的 `firstPrice=4.0377e-6` 是 **USD 因子**（=firstPriceBnb 5.459e-9 × impliedBnbUsd 739.65，逐位吻合），我误当 `firstPriceBnb` 读。交叉验证两票（朴蛋 + 0xc079662f…7777）：快照 currentPrice/fdv 与 DB price_usd/换算价序列逐位同量纲（开盘 fdv $6.2k/$4.2k 正常 flap 量级），**引擎消费的确实是换算后 BNB 价，主干单喂食管（`_emitTick`→`_feedFa` 同一 decoded.priceBnb）无分裂无 bug**。教训（与 [[flap-usd-bnb-denomination]] 同族量纲坑）：快照/因子里 `firstPrice/currentPrice/fdv/marketCap` 全是 USD 口径，`*Bnb` 后缀键才是 BNB——对比 DB `price_bnb` 列前必须先对键名，且快照白名单本就不含 *Bnb 键（推导须借 impliedBnbUsd）。另：同秒多块票按 block_time 排序会打乱 log 序（li 按块重置），对拍须按 (block_number, log_index)。
- **部署**：跑中实验（d32f9d96 v9）须重启进程才吃到新 lag 语义（内存态语料缓存不回填，重启后新 fire 即新口径；存量 token_narrative 缓存行不含 corpusTs，无失效需求）。

### C63 叙事直调提速第二批（代码实现层）——N2 后基线 avg 6.2s 再压：三泳道并发 / vision 预启动 / website 去除 / keepAlive 等 15 项三批落地（2026-10-13 用户裁定「除了这种方法层面的提速，我想请再深度的分析一下代码实现，看看还能不能让耗时再短一点。毫无疑问，每节约一点时间，都能多赚一些」）★

- **基线实测**（182 a21fa102 新进程，N1+N2 代码，首跑 47 样本）：**avg 6.2s / p50 4.0s / p90 13.0s / max 25.6s**（N2 兑现 11.5→6.2s 预期）；缓存命中 55/102。分段画像：vision 2889ms（双峰：21 次同图缓存 ~0ms + **20 次真调用均值 5.9s 全在主链串行**）> fetch.website 3803ms（12/47 票，15s 超时+jina 长尾）> fetch.twitter 1138 > accountCollect 918 > issuerCa 385（28/38 缓存命中正来自与账号链的串行 handoff）> ipfs∥gmgn ~400（N2 已兑现）> jev 349 > DB 小头 ~190。两项 Explore agent 扫链产出 16 候选 + 「已确认不能再压」清单（IPFS 竞速/四桶并发/翻页最优/Jev 单调用等 14 项封死，防重复劳动）。
- **用户三项裁定（本回合 AskUserQuestion）**：① **vision 预启动=完整版+开关默认关**（保 C58「预检拦截票不烧视觉调用」约束，182 实验显式开启观察 24-48h 配额消耗与提速幅度后再定默认值）；② **website 下载直接去除**（原话「网站内容现在就基本上没用到，我认为网站的信息下载是可以去除的」，超出原「超时收紧」选项）；③ **图片资源下载+分析结论都跨 token 复用**（结论缓存已是现状；本体下载是缺口）。全量语料预取维持否决。
- **批 1（L296-426 中段区间四者同动合入）**：**1A 三泳道**——fetch 桶返回后 precheck / 账号链 / issuerCa 三 promise 并发（值层互不消费已核验；唯一强耦合在缓存层：账号链与 issuerCa 双 key 对同一作者 getAccountWithFullTweets 无 inflight 去重，盲并行=双真拉——**issuerCa 按 chainPullsAuthor 同步预判分派**：链拉作者→排链后吃全量 key 缓存 handoff=今天顺序，链不拉→与 precheck 并行；isProjectCoin/detectIssuerSelfLaunch 纯同步预判提前算，issuerCa push 判定移 join 后）；**1B vision 预启动穿透链**——`fourmemeWs.visionPrefetch.enabled`（默认 false）经引擎构造点→NarrativeDirectCaller._analyzeOptions→analyze options 泳道 0：图 URL 已知即后台全链（fire-and-forget+悬空 catch），主链 pre-check 后 join（analyzeTweetImage 三层幂等：已挂门/inflight join/90 天缓存，无 start/join 拆分必要）；**1C website 去除**——`narrative-engine.json websiteFetch.enabled` 默认 false：runWebsite 桶首行守卫 + enrichWithLinkContent 仅砍内容抓取段（t.co 展开保留，pubProxy J1.18 判据吃）；hasIndependentWebsite 只看 URL 域名→shouldCollectAccounts 门不变；纯 website 语料票 hasValidDataForAnalysis 可能 true→false 落「无语料 low」=预期漂移；**1D tweet_image_raw**——图片本体缓存 resourceType=tweet_image_raw（dl-v1 压缩后 base64 ~133KB/图，TTL 90 天，`_downloadForAnalysis` v 不符全量重拉；覆盖分析过期重析/prompt 升版全量重析/跨进程三场景；结论缓存不动）。
- **批 2（近零行为变更，逐项独立）**：**2a SameNameCheckService 模块级单例**（原每次 performPreCheck new 一份，60s BSC 搜索实例缓存跨调用永不命中=bug 修复型，constructor 纯内存零 IO）；**2b precheck 0.55/0.58/0.6/0.7 四 DB 查询并行**（safeQuery 归一 reject→error 形状防后位规则悬空；前置同步计算/按原序消费；★创建时间双口径陷阱：0.55/0.58 用回退口径 tokenCreatedAtSec||raw.created_at，**0.7 原文只用 raw 口径无回退（wss 行跳过 0.7）——分离 createdAtSec/createdAtSec70 勿合并**；三消费块各套 try/catch 保原整规则兜底语义）；**2c apidance url_entities**——GraphQL entities.urls 自带 (t.co,终链) 对，result 透传→fetchTweetLinks pair 等值直取替代 t.co HEAD（尾标点不匹配/缺项回退 HEAD=现状；多重短链首跳 vs HEAD 终链低频漂移接受）；**2d 第二推文与主推并发**（secondTweetUrl 只读 classifiedUrls 同步可判；挂载保持 enrich 后原位=内容 bit 一致，双推文票省 0.5-5.5s）；**2e collect 双账号 Promise.all**（primary/originalAuthor 都来自 twitterInfo 同步输入；push 序保持 primary→original_author；回复票冷路径省 1-3s）。
- **批 3（基建与尾部）**：**3a undici 全局 keepAlive**（`http-keepalive.mjs` setGlobalDispatcher(Agent keepAliveTimeout 30s)，data-fetch-service 顶层 installKeepAlive 幂等接线——同上游连续调用省 TCP+TLS ~50-300ms/次，node 内置 fetch 零调用点改动）；**3b dbSave.final 瘦身**（save 增第二参 `{existing}`：analyze 入口 cacheLookup/rowCache 快照非 null 直传跳 pre-select 35 列肥行往返，**null 刻意仍现查**——并发窗口新插行的 gmgn_info/未产阶段列不被 null 假设清掉，x-0「重析不清积累」语义保持；upsert 回读瘦列 SAVE_RETURN_COLS 13 列=formatResult 消费闭集，*_prompt/*_raw_output 等肥列零回读；web reanalyze 路由不传=现行为）；**3c justoneapi/github 7 处 fetch 补 AbortController**（weixin×2+amazon+bilibili JustOneAPI 15s、b23.tv+github API+网页回退 10s；原理论挂 undici 默认 300s，尾部从分钟级压到 10-15s 级）；**3d JevClient Retry-After**（429/5xx 带 Retry-After 头优先于固定 [500,1500] 表，钳 [500,15000]ms——上界防买门同步路径被长冷却拖死，delta-seconds/HTTP-date 双格式，过去时间=无效回落表）；**3e 微项**（tokenData wss_events 回退查询投机并发 ~20ms / reassembleTwitterInfo 第二推文 get 并发 ~25ms / new-apis.js 38 处高频 console.log 降 debug——`APIDANCE_DEBUG=1` 恢复，error/warn 不动）。
- **单测**（零 DB 零网络）新增 10 个：`_test_narrative_middle_parallel`（24）/ `_test_narrative_vision_prefetch` / `_test_website_fetch_removal`（14）/ `_test_tweet_image_analysis` 扩 raw 缓存 5 断言（38）/ `_test_precheck_parallel_queries`（20）/ `_test_twitter_urls_expansion`（11）/ `_test_twitter_bucket_overlap`（15）/ `_test_http_keepalive`（11）/ `_test_justoneapi_timeouts`（24）/ `_test_narrative_repo_save_thin`（25）/ `_test_jev_client_backoff`（26）；全量回归 27 项全绿（含 N1-N3 既有 9 项）。并发测试桩教训：**并发下 `calls[length-1].end` 指向漂移——必须先持 entry 引用再 push 后写 end**（_test_twitter_bucket_overlap A3 误报教训）。
- **预期收益**（典型 fresh 直调票）：vision 预启动开启后 ~3s/有图票（真调用均值 5.9s 转入预启动窗与主链重叠）；website 3.8s 整段退出（12/47 票）；三泳道 ~0.9s（precheck+账号链串行段折叠）；批 2 各 0.3-2s 级；批 3 各 50-300ms；尾部分钟级→10-15s。**182 已部署（2026-10-13，commit 8e641f5）**：pull + npm install（undici 8.11.2）→ UPDATE 2ad6a39b config 开 visionPrefetch（onlineProfile 完好保留，引擎启动 config dump 回读确认）→ 双进程优雅停（fourmeme 1802/1802、flap 35557/35557 ticks 零丢失）→ worker + 引擎重启（停机窗口约 3 分钟）；8 策略加载/双 collector 订阅确认/组合快照 100.13 BNB。观察 24-48h 与 N2 基线（avg 6.2/p50 4.0/p90 13.0）对比 + 评级占比无漂移 + SiliconFlow 配额，数据回来后由用户定 visionPrefetch 默认值。部署操作教训：ssh 里 `cd X && nohup Y … & cmd2` 的 `&` 作用于整个复合体（主 shell 未 cd，后续相对路径重定向失败=引擎没起来，10 秒内发现补发）；后台 nohup 必须 `</dev/null` 显式脱离 stdin、stdout 重定向到日志文件（worker 曾短暂 stdout→/dev/null 丢可观测性，当日修复重启恢复日期日志文件）。

### C62 叙事直调提速三批（N1 探针 / N2 零变更提速 / N3 预触发）——首跑 11.5s vs fire 时刻 token 中位年龄 4s 的矛盾：耗时大头在数据抓取且全链串行（2026-10-13 用户裁定「请制定一个方案，尽可能优化到极致」；全量语料预取否决「除非数据证明有效」）★

- **基线实测**（182 a21fa102，4 天 1602 次直调 / 首跑样本 822）：**首跑 avg 11.49s / 中位 10.74s / p90 18.83s**（30s race 上限）；缓存命中 48.7%；**fire 时刻 token 年龄中位 4s**（52% <5s、62% <10s）——meme 节奏下买评估同步干等 11.5s 不可接受。定因：耗时在数据抓取不在判定（Pre-Check 拦下的 11.85s ≈ 完整跑 11.47s），全链 100% 串行（IPFS 4 网关×8s 轮询 → GMGN 10s → 13 平台逐个 await → 中段 DB save → 账号收集 → precheck → Jev ~1.5s 非瓶颈）；计时盲区（IPFS/GMGN/账号收集/precheck/DB 无分段）；t.co 展开无超时。
- **N1 分段计时探针**（commit 3918e4d，零行为变化）：analyze options `_timing` 收集数组，全链分段（cacheLookup/tokenData/ipfs/gmgn/fetch.<平台>×13/accountCollect×4/issuerCa/precheck/vision/jev.prestage/jev.superip/jev.standard/dbSave.intermediate/dbSave.final/reassemble）随 getRating 结果 `timing` 落 signal metadata `narrativeCall.timing`；慢调用（≥3s 真跑）现场打印 top3 耗时段。行为变更类优化（twitter 减页 10→3-4 / website 超时收紧 15s→8s / 30s race 收紧）本轮刻意不做——等探针数据回来单独裁定臂验证。
- **N2 零变更提速**（commit e6a9cd7，抓取内容 bit 一致）：① **平台桶并发**——13 平台按真实上游域分四桶 `Promise.allSettled`（apidance:twitter ∥ justoneapi 10 平台桶内串行防限流 ∥ github ∥ websites；桶内序=原全局序，段体逐字保留只改等待顺序）；② **IPFS∥GMGN 前缀并行**（两者都先于 URL 分类，应用顺序保持 IPFS→GMGN）；③ **IPFS 4 网关 `Promise.any`** 竞速（内容寻址一致）；④ **t.co 展开 5s AbortController 总超时**（HEAD+GET 共用 signal；原挂死场景本就被 30s race 掐死，加超时只是让失败显式化）；⑤ **getRow 两查合一**（isFailed+get 两次 DB 往返 → 单次拉行行内判定，3→2 次往返；isFailed 零引用死码删除）；⑥ **skipIntermediateSave**（直调语境跳过「供前端轮询」中段 save 省 1 次往返；fallback 早退路径补同形状 save 保 url_extraction_result/classified_urls 落库 bit 一致）。deferred 两项：#8 undici keepAlive / #9 账号收集 analyze 内共享——两层缓存已覆盖大头+内存缓存失效语义风险，按「数据证明才做」裁定留观。预期首跑 11.5s → 6-7s。
- **N3 叙事预触发**（commit 00f72fb，实验级开关 `fourmemeWs.narrativePrefetch.enabled` 默认 false，flap 实验配 flapWs 段同键；回测不适用——BacktestEngine 有 preloadCache 预载机制）：挂点 `_onFactorsUpdated` 买腿分支（`_scheduleDebouncedBuy` 前），tick 时刻因子评估首条买腿 **`narrativePrefetchCondition ?? narrativeCallCondition`**（新可选策略字段，不配=用现有条件；配更宽松=更早发起，API 消耗与提前量由策略侧权衡），满足且未 write-once → 后台 `getRating`（fire-and-forget+catch，OPB/TPA 同款先例）。与 fire 直调共用同一 NarrativeDirectCaller 实例：**仍在跑时 fire join 同一 inflight promise（等待=剩余时间）；已完成时 analyze 命中 token_narrative 行缓存秒回——fire 侧直调代码零改动**。write-once per-token 无论成败（失败由 fire 时直调兜底重试）；rating=low 终态提前登记 `_narrativeBlockedTokens`（address-fail 宣告竞态 300s 重试窗豁免同款 `shouldBlockOnNarrative`）；`prefetchLeadMs`（fire 时刻−预触发发起时刻）随 narrativeCall 落 signal metadata 供 182 统计真实提前量。收益 = 去抖窗 200-1000ms 前置 + 条件先满足的 token 更早（prefetch 条件配宽松可接近 token 出生即析）。
- **单测**（零 DB 零网络）：`_test_narrative_timing_probe`（42 断言）/ `_test_narrative_parallel_fetch`（31：桶并发行为级+getRow 判定矩阵+源码口径）/ `_test_ipfs_race`（9）/ `_test_narrative_prefetch`（38：开关门/write-once/条件分派/rating=1 登记+豁免/reject 不崩/fire join inflight analyze 恰 1 次/源码口径）；回归 7 项全过。
- **验证待办**：182 实跑 24-48h 对比基线（首跑分布 + 评级 1/2/3/9 占比无漂移监控）+ 开 prefetch 实验的 prefetchLeadMs 分布与 fromCache 命中率（当前 48.7%）；数据回来后裁定 deferred 两项与行为变更类是否开臂。

### C61 bddd3578——J1.29 形象载体门（subject_carrier）：「叙事主体没有具体的形象/梗载体」病根 + 三档判别题 + M2 门挂载（2026-10-09 用户裁定「可以按照你的想法挂门。然后我的建议是将292票全部跑一遍，将不符合要求的过滤掉后，虚拟的算一下总收益情况」）★

- **案由**：回测 bddd3578（「回测-lag门-36a2c12a窗口-叙事重析-1009」，J1.28 重析，292 票全部有交易）递归分析——C 类 15 票 + D 类 20 票净 -2.85 的逐 case 对照发现共同病根：**叙事主体没有具体的形象/梗载体**（BNC `0xf5362fdf641d31e9ca1a9e6210ae193087167777`「binance cat」币安从未有过猫 / WECAT `0x67496bf3b731ba5450fa075759e284beaa747777`「WECHAT CAT SHOULD BE TENCENT」路人许愿 / SI/安犬/SAFUINU「好像还没发过 SAFU INU」对未来发行的想象）。主体无形象（se 无形象桶全域 70 票 winR 17% 净 -5.37）时叙事再好（C/D 29/35 票 strong_fit≥0.9 而 winR 7%）web3 用户也没有可抓的玩梗载体。用户裁定病根成立并否决最初 5 个外围代理方向（「没有针对这个问题」），要求直接判定载体存在性本身。
- **新题**：第 16 题 `subject_carrier`（choice 三档，恒带——照 J1.28 先例 dry-run opt-in 参数 `carrier` 废弃传不传均含；superIP 快车道复用同题集但不消费本题答案）。评估对象=代币名所指代实体本身（与 name_referent/subject_entity 同口径）；三档：**existing_entity**（形象已在事件语料/推文配图/官方渠道真实出现——bCAT `0x5becb5cb498b62e5986f5693bdbe4e41b79e7777` 币安 APP 钱包横幅置顶 meme 头像 / Cherry 雷军收养真实狗配图出现）/ **improvised_entity**（脑补许愿形象——名字暗示形象但官方/事件本体从未展示）/ **no_visual_entity**（人物言行/公司/功能产品/事件/概念/缩写不以形象为存在形式）。题面钉死三个关键判别：①形象须真实出现（只在币名或想象中不算）②名字含形象词（cat/inu/狗/猫）≠载体存在③人物/公司/产品/事件不以形象为存在形式。
- **dry-run**（`scripts/narrative/_carrier-dryrun-bddd.mjs`，state 保真复用线上 stage1_prompt.state verbatim，236 标准路径票）：冒烟 12/12 方向全对（含 CHONK/达摩两观察票）；全域判别力锐利——existing 140 票 winR 39% 净 +11.694 / improvised 24 票 winR 8% 净 -1.111 / no_visual 72 票 winR 24% 净 -3.784。
- **门矩阵（M1-M6）与 M2 裁定**：M2 = C/D+非existing 拦 + E+no_visual 拦 + A/B/W/F/G 不碰。虚拟收益（用户口径 292 票全跑过滤）：**+21.895 → +26.225 BNB（净效应 +4.33 = 避亏 +7.41 − 放弃赢 3.08，winR 35%→41%）**；M1 +23.983 / M5 +26.261（与 M2 打平差 0.04 但打击面多 16 票）。E 只拦 no_visual 的依据：E+improvised 有肉（6 票 +1.19，Ants +1.42「Anthropic 员工自称蚂蚁」型戏谑票——热点梗自带传播可容忍脑补形象；M3 E 全拦净效应反亏 -1.19）。已知代价：误伤面 13 张 +3.08 大头是「XX人生」概念梗家族（通透人生 `0xfd7475f24c6fdec2739711c6c866203c719d7777` +0.55 / 幕后人生×2 / 极简人生 / 我是个耻辱 等 ~+1.6）。
- **挂载**：mapper `subjectCarrierBlock`（CARRIER_LABELS：improvised→脑补形象 / no_visual→无形象实体），挂位 rmBlock（J1.28）之后、量级 D/E 门之前（指代层门链尾，nr/rm 先拦的票 label 归属前者）；审计 `subjectCarrier` 恒落（旧缓存行 null）/ `subjectCarrierBlock {carrier}` 命中才落 / `probabilities.subject_carrier` 照落。56 票 prestage/superIP 无 stage1 不适用（门只挂标准路径 mapper）。cashtag 改道票 category='W' 天然不进门（iNu 案拦截语义自持）。旧缓存行无答案门不触发——历史窗口回测前置失效 `scripts/narrative/invalidate-carrier-window.cjs <基底实验ID> --commit`（J1.28 模式：基底 buy signals distinct token → is_valid=false 分块 100）。单测 `node scripts/_test_subject_carrier.cjs`（43 断言：判定矩阵 15 形状/M2 边界/挂位序 D1-D4/审计 E 段/bddd 案锚定 F 段 BNC·bCAT·通透人生·Ants/源码口径 G 段）。
- **生产链语义**：门命中 → rating 翻 low → 经 rating 门（narrativeRating==2 OR ==3）起作用，与 J1.28 同形式；`stage2_result.reason` 前缀「叙事主体无形象载体」即判别位。
- **门臂回测实证（2026-10-10，用户裁定「可以回测验证，我的建议是，叙事如果重新跑了就不必再跑一遍了」）**：零 Jev 重跑的答案注入对照——`backfill-carrier-bddd.mjs --commit` 把 dry-run checkpoint 的 subject_carrier 答案合并进 J1.28 缓存行 → J1.29 mapper 重映射 update（236 行 skip 0；对拍自验 = 不注入重放 rating 与原行一致才回填，mismatch skip 保单变量）→ 门臂 **7bee34f9-e8bc-4539-b64c-3fbd2b27dd05**（config 与基底零差异，两侧同删 name/description 后逐字节全同校验）→ diff vs 基底 = 纯 M2 门净效应（其余 16 题答案 bit-identical，机制化规避 C60 换题集重析方差 −0.72）。**净效应 +4.4210 BNB**（trades 口径；stats +4.2210 / portfolio +4.6869 三口径同向）：基底 292 票 +21.8947 → 门臂 220 票 +26.3157，winR 35.6%→41.4%；dry-run 预测 +4.33 兑现（差 0.09）。分解：被拦 72 = 避亏 59 张 **+7.5017** + 放弃赢 13 张 **−3.0807**；**M2 命中 71 ≡ 被拦 71**（门精确性闭环，唯一例外见 CORLEO）；共同票 220 张漂移 **0.0000**（回放确定性机器证明）；门臂独有 0 张。避亏大头：BNC `0xf5362fdf641d31e9ca1a9e6210ae193087167777` improvised −0.2697 / Bicat `0xdc5ad2e2913fc96ee281633a764cf682c20b7777` −0.2686 / ZODLER `0xc4aaa42309aee06c058ba25f553ffb5976337777` no_visual −0.2410 / 智脑 `0xc2d9ffa6…7777` −0.2237；放弃赢大头：通透人生 `0xfd7475f24c6fdec2739711c6c866203c719d7777` +0.5469 / 智脑 `0x112462bd53bdd1d8a940e2a322430be271467777` +0.5010（智脑同名三张两拦一放——载体判定按票分离）/ 幕后人生 `0x8292e7a3…7777` +0.3380——误伤面与 dry-run 预告的「XX人生」概念梗家族一致。**唯一非 M2 被拦票 CORLEO `0x986af582b43d7717f9c02aaf22dbed2fe1497777`**（C 类 + existing_entity 0.81 川崎四足车配图真实出现，M2 正确行为=放行，基底净 −0.0909 恰好避亏）：门臂 16:13:13 直调缓存命中返回 low(1) → veto 短路未买；已排除多行命中/resolveFinalRating 算法（现同代码同行全链复现=high(3)）/进程内存缓存（52ms≠0 且 rating=1 不入缓存）/no_public_info 穿透/超时异常路径（那是 unrated），当时返回 low 的确切机制未定位（DB 无 update 前历史，最可能=回填 236 条逐条提交窗口的读取时序竞争一过性）——如实记录为缓存链路未解一例，+0.0909 计入净效应但在 71 张 M2 闭环之外。门臂实验行 completed 留行（级联删红线）；对拍脚本一次性已删。

### C60 0fed29f9——早晚票语料滞后门（lag<300 OR er≥100）+ J1.28 指代 meme 低档门：三臂配对回测终局（2026-10-08 用户裁定「早票正常买，晚票要求更高——确定用户认同（或强庄）才入场」+「币安汽车/日产类要拦，JACKET/永生类不敢一棒子打死→只上低档门」）★

- **两道门**：① **lag 门**（交易侧，`narrativeCorpusLagSec` 因子 commit 888adb8）= 买腿 preBuyCheckCondition 追加 `(narrativeCorpusLagSec < 300 OR earlyReturn >= 100)`——早票（lag<300，负值=宣告竞态原创点）正常买，晚票须 `earlyReturn>=100` 的用户认同/强庄证据；null（无语料时间/无出生锚）落晚票严格门 fail-closed。② **J1.28 meme 低档门**（叙事侧 mapper `referentMemeabilityLowBlock`，commit 73e0e21）= `referent_memeability` 恒带标准路径，mem≤1（人名/账号/严肃事务性对象，无梗无二创空间）→ blocked「不适合成为meme币」→ **rating=low**——生产链形式即 rating 翻 low 经 rating 门起作用，与交易侧门无直接耦合。
- **三臂配对回测**（基底 3473dbc0 buy-v2 v6 实跑，10-07~10-08 同窗；R0=基线 / R1=+lag 门 / R2=+lag 门+J1.28 重析；J1.28 上线前置 = 基底 664 buy token 缓存失效 `invalidate-referent-window.cjs` → R2 全量重析 J1.28 题集）：
  - **R1 vs R0：+0.9784**（R0 114 票 +7.5416 → R1 89 票 +8.5200）= 拦 25 张避亏 **+3.0155**（误拦仅 小团子 `0xcbc84748…7777` +0.066 / 中国猫能飞 `0xa5f7632b…7777` +0.139）− 晚票追高 **−2.0371**；
  - **R2 vs R0：+0.6465**（R2 86 票 +8.1881）；**R2 vs R1：−0.3319**——**本窗口双门不如单 lag 门**，且 −0.3319 的主体不是 meme 门本身（见分解）。
- **R2−R1 = −0.3319 完全分解（账目自洽 ✓）**：① meme 门实锤拦截 3 张避亏 **+0.3138**（小赵 `0x3a2b1479…7777` mem=0.1 −0.220 / SI `0xac697873…7777` mem=0.75 −0.109 / 卷王 `0xcb6a6429…7777` mem=0.85 误拦 +0.015）；② J1.28 换题集重析方差拦 5 张 **+0.0700**（避亏 +0.663：永生 `0x9f70bfd4…7777`「截词」−0.286 / XSI `0xec092332…7777`「改道W 25.8」−0.260 / You `0x00e425e4…7777`「机构日常」−0.093 / SIF `0x171e5cfe…7777` −0.024；弃赢 SI `0x68c64d21…7777` 买窗内 rating=1 放弃 +0.593）；③ 重析方差放行 5 张 **−0.5560** 全亏（超级汪汪队 `0x125edfb9…7777` −0.197 / 人生决策 `0xcf3595ee…7777` −0.106 / 企鹅微单 `0x30f8c17b…7777` −0.102 / SI `0x0182ddfc…7777` −0.087 / 大表鸽 `0x5c83f64b…7777` −0.065，重析翻 high/mid 60.28~83.16 过线放行）；④ 共同票 81 张重析漂移 **−0.1597**（评级到达时序/买入轮次微移）。
- **归因方法论三连钻（182）**：`token_narrative.stage2_result` 是轻量摘要形状 `{pass,error,model,score,rating,reason}`——**reason 列即拦截文案**，判别 meme 门命中看「不适合成为meme币」前缀；prestage 路径票（如 SI `0x68c64d21…7777`）stage1/2/3 全 null、J1.28 不覆盖；signal `metadata->preBuyCheckFactors->>narrativeRating` 是买入时刻真值（全局缓存行可能被后续轮次 upsert 覆盖，与 signal 时刻值可不同）。
- **结论与张力**：meme 门本身净贡献 +0.31/窗口且语义精准（实锤 3 张中 2 张是设计目标亏票）；但 J1.28 上线必然伴随的全量重析在本单窗口引入方差成本 −0.72（放行 5 亏票 + 共同漂移）吃掉全部收益——方差项长期多窗口期望归零，单窗口 R2<R1 不构成否决依据；永生被拦是重析「截词」翻转**非 meme 门**，与「不敢一棒子打死」裁定不冲突；SI er=355.9 弃赢 +0.593 提示右臂强证据票对 rating 时序敏感（重析耗时 vs 缓存命中秒差）。共同票 R1 vs R0 早票桶（lag<300）漂移恰 0.0000 = 回放确定性机器证明（虚拟时钟去抖）。
- **遗留**：脚本 `scripts/create-corpus-lag-pair.cjs`（三臂）/ `compare-corpus-lag-pair.cjs`（对拍，executed 布尔列 + 冒号别名 + lastSig 因子快照，157be2d）；R1/R2 回测实验行保留（有数据，级联删红线）。

### C59 现金猫续二——superIP 通道「指代载体在图」关联截断豁免：三门全中（图证据 + 0<关联≤10 + meme≥3）豁免 Stage3 ≤10 截断，关联分照常计入总分（2026-10-07 用户裁定「恐怕这里还是要修一下。我认为关联应该很强了」）★

- **案由**：C58 E2E 终局——图分析开启后 Jev 拿到真图证据（白猫举金币），relevance 0→10（none_related 0.45→0.43 仍 argmax，10=cultural lv2 弱语义档），**但 10 分恰触 ≤10 关联截断 → 维持 low**「截断:关联性不足（10分）｜事件分50.4(84×0.6)」。感知层已如实交付，剩下的是截断线的口径错位：relevance 题面是**纯文本关联判据**（exact_match 要求字面语义），指代载体在图时 Jev 最高只能给到弱语义档 10 分——这道截断把「图承载的强指代」永远压死在门外，与 C58 补感知层的意图直接顶牛。用户裁定原文：「恐怕这里还是要修一下。我认为关联应该很强了」。
- **方案（AskUserQuestion 三选一，用户选 mapper 三门豁免）**：superIP 通道加「指代载体在图」豁免——三门全中时豁免 Stage3 关联≤10 截断，relevance 分照常计入总分（弱字面关联的代价在分数上体现，J1.24 戏谑关联豁免同款计分语义）。mapper-only，不 bump 题集版本。
- **三门**：① `imageEvidence`（analyzer 传 `!!twitterInfo?.image_analysis`——图分析成功才挂载，精确限定「指代载体在配图」子形状）；② `0 < relevance ≤ 10`（只救本会被拦的票，纯零关联 none 0 分不救——Jev 判出「有关联」是前提）；③ `referent_memeability ≥ 3`（J1.21 阈，superIP 通道恒带此题——指代对象有 meme 生命力的高置信背书）。
- **图门必要性（182 存量扫描实证，`scripts/tmp_scan_superip_relevance_exempt.mjs`）**：superIP 通道 1311 行 / 可解析 answers 336 行——三门全中**恰现金猫 1 行**，零外溢；若无图证据门会额外翻 8 行（GM×2 generic_concept lv3=7、HODL lv1=4、牛马×4 cultural lv1=5 同名量产家族、🙈 cultural lv2=10）——全是「文化词蹭 superIP 语料、无图承载」形状，图门是防误放的必要条件。对照组 relevance=0 且 meme≥3 共 0 行（>0 门纯理论位）。
- **豁免后数值锚定（本案预测）**：eventTotal = 55+29 = 84（×0.6=50.4）+ 关联 10 + 质量 15.63（3 汉字 8 + 拼写 4.78 + 合理 2.85）= **76.03 → high(3)**。
- **正交性**：不绕任何阻断门（web3 unfit/negative_hard_news/rcp/block_reason/nameReferentBlock 照拦——G/F 节单测锁）；与 J1.21 正交叠加（nrBlock 命中票先 J1.21 放行、再 C59 救关联截断，两豁免独立判分）；标准路径（mapStandardAnswers）零触达——豁免域仍仅 superIP 块。
- **审计**：`jev.imgReferentExempt {relType, relScore, memeScore}`（命中才落，J1.24 模式）+ 非截断 reason 前缀「指代载体在图豁免(C59)｜」。
- **单测**：`node scripts/_test_superip_relevance_exempt.cjs`（23 断言零 DB 八节：三门全中数值锚定 76.03/缺图门/relevance=0 不救/relevance>10 不落键/meme 缺失·<3 fail-closed/阻断门不受影响/J1.21 叠加/源码口径）。回归：referent_memeability 30、brand_hijack_pun 18、tweet_image_analysis 34、web3_fit_anchor 12、w_interaction 17、notable_other 22、jev_product_entity 41 全过。
- **E2E 终局（182 部署 commit `93a0e16` 后重析）**：现金猫 `0x56dc26bd…7777` ignoreCache 重析——**low → high 76.1**（预测 76.03，微差=Jev 概率跨 run 抖动：meme 3.47→3.45、质量分微变；计分骨架 50.4+10+15.7 不变）。审计实录 `imgReferentExempt {relType:cultural, relScore:10, memeScore:3.45}` 命中 + `nameReferentExempt:true`——本轮 nrBlock 恰过半，实走「J1.21 放行 + C59 救关联截断」**叠加路径**（单测 G 节锁定的正交形状在真实链路一并验证）；prompt_type `super_ip_fast(币安官方/S级/jev-J1.27)`。图证据走 90 天缓存命中（同图零 API 成本，复蹭簇后续票同享）。部署链：pull → narrative engine 重启（3528604，旧 3522116）+ 实验 screen exp-36a2c12a 重建（3539057）→ watcher 与 6f92e2f9 对照臂刻意不动。

### C58 现金猫续——推文配图视觉分析开启（Qwen3-Omni Captioner @ SiliconFlow）：指代载体在图的子形状补上感知层（2026-10-07 用户裁定「开一下图片分析」+ 两点约束；同日三模型 A/B + 看图仲裁终选）★

- **案由**：C57 落地后重析双票终局里，现金猫 `0x56dc26bde1ee2f9159351de1ade5188d06157777`（name=cashcat/symbol 现金猫，binance「POV: TradersLeague 排行榜」语料簇最大赢票 +9.515 BNB）mid → low「截断：关联性不足（0分）｜事件分50.5」。复盘拦截现场：`name_referent` argmax none_related 0.45（压过 common_word 0.41）→ relevance 0 分——**按纯文本语料完全自洽**（推文文字零「现金猫/cashcat/猫/cash/现金」字样），指代映射的唯一载体是配图 `https://pbs.twimg.com/media/HTeSnpDXAAAMv9P.jpg`（与 C51 龙虾案「判定所需事实不在引擎语料集合」同构）。其余维度全顶配（tierScore 40 / 时效 15 / 传播 29.16 / strong_fit 0.96），唯独缺图里那块事实。用户问「是不是只能打开图片分析」→ 复核：不开图的旁路（J1.24 punExempt 挂 superIP / J1.21 放宽）全是对整个 superIP 通道开口，×32 复蹭簇必翻案；裁定开启图片分析。
- **模型选型三段演化（同日三轮，全部同图生产同款 prompt 实测）**：
  ① **glm-5.3 废案**：智谱 anthropic 兼容端点，部署 182 后 E2E 暴露「看不到图」——用户点破 glm-5.3 是**文本模型**；A/B 实证 webp 图块被智谱端点**静默丢弃**（`media_type:image/webp` 不报错但模型看不到：或纯文字脑补零视觉细节、或烧光 max_tokens 空输出 [stop=max_tokens blocks=[thinking]]；jpeg 正常）——ImageDownloader 压缩默认输出 webp 是首跑根因；v1 缓存行全是废结果（毒缓存）。
  ② **glm-4.6v 废案**：jpeg + thinking disabled 3.4s 出 JSON 看似诚实（「名字因分辨率限制无法清晰辨认」），但与 Qwen 描述完全互斥。
  ③ **亲眼看图仲裁（定案证据）**：下载原图亲验——真相 = **白猫举金币**（白色猫咪、黄色连帽衫兜帽、金边墨镜、金表、金币散落、蓝天白云背景、**无任何排行榜界面、无可读文字**）。glm-4.6v 的「手机屏幕排行榜截图、深色背景」整段是从推文文字脑补的**编造**（A/B 时判它「诚实」是错的——它只是把编造包装得像诚实）；而 **Qwen/Qwen3-Omni-30B-A3B-Captioner @ SiliconFlow**（3861ms，in=1193 out=311）描述全对且诚实标注「屏幕上没有显示任何可读的文字」，meme_meaning 还正确整合了 TradersLeague 登顶语境。**cashcat 的指代载体正是这只猫**——只有 Qwen 看到了本案要的视觉事实，终选 Qwen（用户 mid-turn 指令点名尝试 + 提到余额余量）。
- **端点与 key 事实（SiliconFlow）**：OpenAI 兼容 `https://api.siliconflow.cn/v1/chat/completions`（`Authorization: Bearer` + content 数组 `image_url` data URI + `text` 块；响应 `choices[0].message.content` 字符串——实测形状，不做数组兜底，形状漂移 fail-loud 不写缓存）。key：182 与本地 `.env` 的 `SILICONFLOW_API_KEY`（sk-cp-）均 401 无效（且被 llm-client/analyze_narratives_llm 别处消费不能动值）；**有效的是 `SILICONFLOW_FALLBACK_KEY`（sk-lbeyh，182 已配）**——vision 节 apiKeyEnv 指它。`SILICONFLOW_API_URL=https://api.minimax.io/v1` 名不副实（minimax 端点）勿用；真端点 `VISION_API_URL=https://api.siliconflow.cn/v1`。A/B 脚本：`scripts/tmp_ab_vision_models.mjs`（智谱三发）/ `scripts/tmp_ab_qwen_captioner.mjs`（SiliconFlow Qwen）。
- **用户两点约束**：① 同一图片分析结果缓存不重复分析；② 每代币多图只分析其一（时间成本）。落地：`external_resource_cache` 按**图片 URL** 键控（resourceType=`tweet_image`，TTL 90 天，`promptVersion=img-v2` 版本校验防旧形状毒缓存——v1 行全是 glm-5.3 废结果自动失效）+ **进程内 in-flight 去重**（复蹭簇同分钟并发分析同图只打一次 API）+ 只取**主推文第一张图**（website_tweet/quoted/第二张都不分析）。压缩输出恒 jpeg（`downloadAsBase64(url, { format:'jpeg' })`——downloader 默认 webp，webp 只在智谱端点实测过被丢弃，jpeg 是三模型实测正常格式）。
- **★架构裁定：视觉层 token 无关（跨 token 缓存健全性）**：缓存按图 URL 键控而分析结果会被多个 token 共享——prompt 一旦掺 token 名，token B 会拿到为 token A 算的关联结论（毒缓存，复蹭簇正是多 token 共享同图的形状）。因此 prompt 只含推文作者/文字/图，产出纯感知字段（description/key_elements/meme_type/meme_meaning，与 twitter-section 既有【图片内容分析】渲染块同构——渲染层零改动）；**指代判定留给 Jev 的 name_referent 题**（[TOKEN] 头与图片描述天然在那儿对上），旧渲染块的 token_relevance 字段恒空跳过。
- **挂点与失败语义**：`NarrativeAnalyzer` 正常流程分支（pre-check 通过后、state 构建前）`await analyzeTweetImage(twitterInfo)`——预检拦截票不烧视觉调用；superIP fast-track 与标准路径共用（现金猫形状正是 superIP 通道）。下载/API/解析失败 → warn + 无图证据（= 开启前行为）+ **不写缓存**（下次重试语义与无缓存一致，刻意不走 CachedFetcher.fetchWithCache——其失败 1h 冷却会灭掉宣告竞态重试窗，与 account-analysis 同裁定）；配置 enabled 但 key/baseUrl 残缺 → throw fail-loud。配置节 `config/narrative-engine.json → vision`（baseUrl=api.siliconflow.cn/v1、model=Qwen/Qwen3-Omni-30B-A3B-Captioner、apiKeyEnv=SILICONFLOW_FALLBACK_KEY）。
- **范围边界**：只修「指代载体在配图」子形状（C51 已记的「纯世界知识代称无图承载」仍不覆盖，属模型升级域）；prestage 账号路径不进图（buildPrestageState 语料是账号时间线，无 twitterInfo 位）；twitter_info 列随 image_analysis 持久化（审计可见）。
- **单测**：`node scripts/_test_tweet_image_analysis.cjs`（34 断言零 DB 零网络十三节：关闭态/miss 全链（只下首图·缓存键形状·prompt 无 token 维度·OpenAI 请求体 Bearer+image_url data URI+无 thinking·围栏剥离）/缓存命中/版本不符重析/跳过形状/幂等/5xx 重试耗尽不写缓存/4xx 不重试/解析降级原文进 description/in-flight 并发去重/state 渲染/源码挂点+format jpeg+无 anthropic 残留/配置残缺 throw）。
- **E2E 终局（182 部署 commit `8b4fcf9` 后重析，全链真实验证）**：现金猫 `0x56dc26bd…7777` ignoreCache 重析——SiliconFlow 真调用成功（缓存行 `model=Qwen/Qwen3-Omni-30B-A3B-Captioner`、`pv=img-v2`，v1 毒缓存被 upsert 覆盖），「白猫举金币」描述全文进 prestage state【图片内容分析】块（superIP 通道）；Jev 拿到真图证据后：**relevance 0 → 10**（无图 none_related 0.45 → 带图 0.43 仍 argmax，图片微降不翻档；10 = semantic 弱语义档保底分）但仍触 ≤10 关联截断 → **维持 low**「截断:关联性不足（10分）｜事件分50.4(84×0.6)」。**定性：感知层如实交付（描述全对、渲染块零改动进 state、跨模态 meme_meaning 正确整合 TradersLeague 语境），翻案没发生是 Jev 在真实证据下的裁定**——「cashcat ↔ 白猫金币」被判弱语义关联而非强指代，不再是数据缺失代判（与 C51 龙虾 fail-closed 的本质区别）。同图 ×32 复蹭簇后续票将命中缓存零成本。部署链：pull → narrative engine 重启（3522116）+ 实验 screen exp-36a2c12a 重建（3523763）→ 6f92e2f9 对照臂与 watcher 刻意不动。

### C57 NIGGALON——规则5高影响力+媒体直发 mid 废除：自填 twitterUrl 白拿 mid 的零成本攻击面（2026-10-06 用户裁定「方案A」）★

- **案由**：NIGGALON `0xb62ec51dd713c16dcbb4325ca53aaf555a507777`（fourmeme，
  2026-10-04 mint）mint 后 12-14 秒两实验即出 BUY 信号。查 `token_narrative`
  行：`stage1_result`/`prestage_result` 全 null、分析仅 5 秒——评级来自
  pre-check 规则 5 `high_influence_with_media` 直发 mid，**Jev 全程未跑**。
  语料是发币者自填的 twitterUrl：elonmusk 的一条**转推**（RT @AlyssaSolen
  「Stop the Model. Humanity is Losing Control.」AI 警告视频，原作者 1,238
  粉）；token 名 nigga+elon 蹭名拼词与语料内容零指代关联。语料作者影响力
  被直接当成了叙事质量。
- **盲区量化**（`scripts/scan-high-influence-media-tokens.cjs`，182，A 集 776
  行 + B 集对照）：语料 74% 币安系（binance 410/BNBCHAIN 85/cz 78/heyibinance
  31/Four_FORM_ 12…）；**79%（610/776）集中在 133 个「同推文复蹭簇」**——同
  一条推文被多张 token 反复引用（×32「what are we calling this emoji?」、×29
  CZ 转推「Stretch for BNB」、×21「Redraw Binance logo」、×14 CZ「Soon...」
  被买 12 张净 -2.04、×12「know the difference!」BINANCESTOCKS 家族），可解析
  语料时间的 121/127 张是 >30 天存量旧推文——发币者拿热门推文库批量作业。被买
  147 票全部发生在近 30 天：win rate 28%（41W/103L）、净 **-1.718 BNB**（投入
  242.6）；对照 Jev/其他路径 mid 121 票净 +23.968（均值 +0.303）high 62 票净
  +26.753（均值 +1.274）——**同标 mid 质量差 25 倍，被买 mid 票 65% 来自本规
  则（mid 信号被稀释）**。
- **反例（一刀切全废的代价边界）**：×12「POV: TradersLeague 排行榜」簇被买 7
  张净 **+14.9**、×12「know the difference!」净 +2.1——币安官方活动梗推确实带
  动过 meme 盘。放行进 Jev 后此类真关联票仍可凭叙事拿级（binance 语料簇走
  fast-track），不损失。
- **裁定与改动（方案 A）**：规则 5 的存在理由是旧图片识别逻辑弃用后的速度补丁
  （「图片下载耗时久，识别准确率不稳定」→「直接给 mid 抢最早的筹码」），Jev
  单次秒级后理由消失。改 `pre-check-service.mjs` 规则 5 块不再 return
  buildPreCheckResult（放行日志「规则5放行: …进入Jev叙事分析」）；放行后语料
  作者（elonmusk/cz_binance/heyibinance/binance 均在 super-ip-registry S 级）
  走 fast-track + J1.21 referent_memeability 条件题，蹭名/无指代关联票由叙事
  层拦下。高交互腿（赞>5000/转>2000）随规则整体放行。
- **存量处置**：776 行直发 mid 是未经叙事判定的旧口径，批量置 is_valid=false
  （`scripts/narrative/invalidate-high-influence-media.cjs`，182 --commit），
  下次遇同 token 自动重析走 Jev（数据保留不删）。
- **验证与单测**：`node scripts/_test_rule5_pass_through.cjs`（6 节：名单账号
  放行/高交互腿放行/无媒体不触发/symbol_too_long 不受影响/superIP registry
  覆盖头部账号/源码防直发回退）。**182 重析双票终局（正例 + 已知代价兑现）**：
  NIGGALON `0xb62ec51d…7777` mid → **low**——放行日志实锤 → elonmusk superIP
  fast-track → J1.21 nameReferentBlock「截词（非超级IP话中词）」拦（nameReferent=
  none_related、strong_fit 0.83 但关联不成立），设计目标达成；现金猫
  `0x56dc26bd…7777`（TradersLeague 簇最大赢票 +9.515 BNB）mid → **low**「截断：
  关联性不足（0分）｜事件分50.5」——binance 官方 fast-track 下 token 名与推文
  无指代关联被 relevance 截断，评估阶段预告的反例簇代价（+14.9 BNB）实际兑现，
  如实记录（**续案：该 low 引出 C58——图片分析开启补上指代载体在图的感知层**）。部署链：commit `27b209a` → 182 pull → 191 行存量置 is_valid=false →
  narrative engine（PID 3194016）+ 实验进程 36a2c12a（screen exp-36a2c12a）重启
  吃新代码；watcher 无改动未动；6f92e2f9 为实验 description 明示的旧代码对照臂
  刻意不重启。

### C56 中国公司产品发布簇——产品实体主体切分 + web3 接纳门（J1.27，2026-10-03 用户裁定「好，落地吧」+ mid-turn「要豁免币安」）★

- **案由**：评3 161 票主题归类发现中国公司产品发布簇（华为麒麟 Mate90
  0x967e4a52…7777、龙芯狗剩×4（-0.042~-0.228 BNB）、腾讯 TDreamQQ/EB/小久、
  网易子曰、多多进宝、大吉等）几乎全亏。用户裁定原话：「这里面的主体并不是
  『华为』/『网易』，而只是它们发布的产品（实体）。要不就是事件形成了大影响力
  （并不需要一定是顶级IP），要不就是玩梗/有趣，对应着一个可爱的形象，本质上
  还是web3用户能不能喜欢与接纳的问题」。mid-turn 补充：「要豁免币安」。
- **切分语义（J1.27 题面）**：①event_magnitude 形状③收窄——公司产品发布的
  量级不按母公司知名度评，按**产品实体自身的事件影响力**评（第三方自传播才算
  大影响力，通稿/官宣矩阵不算）；②新增第 15 题 `subject_entity` 八档主体标注
  （product_functional / product_character / person / event_hotspot /
  character_ip / organization / crypto_native / account）；③dimension2 形状③
  配套（产品实体票的传播影响力看事件自身出圈度）；④币安豁免三处——D/W 边界
  句（crypto 机构官宣自家产品→D 类不判 W）+ magnitude 豁免句（主体量级按机构
  自身量级评档）+ fit 豁免句（crypto 原生机构产品天然强契合）。
- **mapper 产品实体接纳门** `productEntityAcceptanceBlock`：`subject_entity ∈
  {product_functional, product_character}` 且 `(strong_fit+fit) < 0.5` → 阻断
  「产品实体未被web3买家接纳(J1.27)」。豁免链：pubProxyActive / isW / rideMass
  / binanceCorpus（`detectBinanceCorpus`：语料主推+父推+代币名含 binance/币安）
  / superIP 快车道。fit≥0.5 的产品票放行（两出路之「可爱形象/强契合」路径，
  例：火腿肠笔 fit 85-94% 放行、波兰球 high）。
- **校准三轮 + state 保真缺口大发现**：r1/r2（J1.27 重建 state）+ ctrl（J1.25
  题面重建 state 对照臂）三轮后追查币安 5 票「翻 low」异常，发现
  **`token_narrative` 只持久化 twitter_info/classified_urls/extracted_info——
  binance_square_info/instagram_info/website_info/douyin_info/xiaohongshu_info/
  weixin_info/youtube_info 等全不持久化**，校准脚本重建 state 必缺这些语料节
  （161 票中 **94 票** 含非持久化节；币安智能案实证：线上 675 字符含
  【币安广场内容】官方认证发布会节 vs 重建 466 字符 → mag A→B/C 掉档）。
  **重跑对比线上前必须先验证 state bit-identical**——r1/r2 对 94 缺节票的绝对
  评级不可信（净效应两臂同缺节仍自洽，但题面×缺节交互会不对称放大打击面：
  13 票重验实证净降 10 中 5 翻案、净升 3 全是 ctrl 缺节 artifact）。修正法=
  直接复用线上 `stage1_prompt.state` 原文（buildCallPromptMeta full=true 落库）
  + context 全键复刻（credibleEventAnchor 三源：superIP/issuer/广场官方认证
  从 state 文本推导；instagramLinked/InfoFetched；tweetClassification）——已
  固化进 `_calib-product-entity.mjs`。
- **币安豁免闭环（5/5 全 high，双轮稳定）**：币安智能1 0x4a674ed3…7777、币安
  智能2 0xb4705a35…7777、币智 0x1e5b6706…7777、智安 0x7536fa09…7777、
  bIntelligence 0x5439b534…7777——真 state 下 cat 全 D、mag 3.08-3.64（A 档）、
  se=product_functional+fit 93-99% 产品门直接放行（detectBinanceCorpus 豁免
  分支未被用到——fit 高先过门，豁免是兜底层）、72.51-79.36 vs 线上 73.26-80.34。
  之前 r2「翻 low」全是 state 缺节假阴性。
- **终校准（真 state 156/161 有效，145 线上原文+11 重建旧行）**：迁移矩阵
  high→high 125 / **high→low 27 / high→mid 2**（其余 low→low 1、null→low 1；
  161 票全为线上评3=high 票）。拦因分布：产品门 **11 票全中设计目标**（腾讯微笑
  ×3 fit 16-18%、麒麟 19%、狗剩×3 45-48%、EB 39%、多多进宝 5%、Express 12%、
  大吉 10%——清一色中国/大厂功能产品票）+ 事件分贴线掉 7 + 机构日常运营 4 +
  截词 3 + W 数学 1 + 量级 D 档 1。产品簇 18 票内 6 产品门拦+TDreamQQ 事件分拦
  56.3+METI mid 68.73；福来/小久/YOYO/小财/子曰/MeMe 保 high/放行（fit≥0.5 或
  product_character 可爱形象路径，设计内双出路）。对照赢 5 票：猪能飞/小八/
  LIARA/CHOUCHOU 保 high，**金六根 high→low 59.08**（E 类 mag 2.4 双轮稳定
  59.32/59.56 贴线，形状③对时事形象票的真实收紧，非方差）。
- **C42 条件③ J1.27 适配修复（同日）**：RedCoin 0x40278f10…7777 终校准偶发
  43.17 低分——J1.27 形状③下 Jev 把世界级产品发布的概率质量移向 P4/P5 高档
  （P2+P3=0.47<0.5），C42 豁免条件③ `newProductP=P(2)+P(3)≥0.5` 意外失效 →
  W 轮交互轴 0 分重新计入。修复：`newProductP = 1−P(0)−P(1)`（P2 新产品/P3
  创新/P4/P5 更高档全是产品发布档，排除 minor update/ordinary feature 的原
  裁定语义不变）；修复后双轮 high 79.06/81.37 稳定。
- **flap 平台官方源豁免（mid-turn 裁定闭环，原 §四-15 遗留点）**：用户裁定原话
  「flap 是 币安链的 meme 币发布平台，也是我们交易代币主要来源，跟币安链一个
  道理」——flap 官方 IP 票与币安官方票同构。落地 `detectPlatformOfficial`（主推
  作者 handle 硬集 `PLATFORM_OFFICIAL_HANDLES={binance, flapdotsh}`，大小写归一；
  刻意不查 in_reply_to 父推；作者字段双形状 tweet 型 author_screen_name /
  account 型 screen_name——182 实查 FlapGuy 行=author_screen_name:"flapdotsh"
  命中）。**豁免位三处**：① rcp 概率门（routineContentProductBlock
  opts.platformOfficial）② **block_reason argmax 链 institution_routine /
  routine_content_product 子句**——FlapGuy 实测拦截点在此（argmax 0.55 / none
  0.30，rcp 概率仅 0.10 够不着概率门；初版只挂两处豁免时 FlapGuy 仍 low，
  argmax 位是复验发现的必要豁免；与 superIP 通道 institution_routine 豁免同
  语义）③ 产品实体接纳门（productEntityAcceptanceBlock opts）。审计
  `rcpPlatformExempt`（官方源 + 无豁免时概率门 OR argmax 位会拦才落键，忠实
  复算 argmax 链判定）；superIP 通道不传 opts（C23 域语义不变；币安官方号在
  注册表走快车道本就豁免 institution_routine，此处置标准路径兜底位）。
- **BOB 定性修正（原 §四-15 记「BNB Chain 官方 campaign」有误）**：182 dump
  实证主推是 228 粉路人号 @zhangxuanhui 回复 CZ 玩香蕉梗（父推才是
  cz_binance）——非官方源不豁免；J1.27 累计四轮 3 low（截词×3 / 骑乘改道 W
  37.66×1）+1 high 高方差，common_word 拦截维持合理。
- **182 复验（真 Jev 双轮）**：FlapGuy **low→high 74.42/75.87**（cat=D、
  mag 3.04-3.05 B 档、se=character_ip、blk=无——豁免生效主线）；RedCoin
  high 77.52/81.75（C42 修复基线不变）；金六根 R1 low 59.24 / R2 high 71.07
  （60 线贴线票天然抖动：C 档 dim2 2.63→事件分 60.04 恰过线，语料非官方源
  豁免不触达）；BOB 双轮 low（minor+common 0.52 拦截词维持）。
- **单测**：`node scripts/_test_jev_product_entity.cjs`（30 断言零 DB：产品门
  矩阵/豁免链五路/币安语料检测/版本头/题面豁免句五节）；回归
  `_test_w_interaction_exempt` 17、`_test_brand_hijack_pun_exemption` 18、
  `_test_notable_other_exit` 22、`_test_web3_fit_anchor` 12、
  `_test_narrator_two_shapes` 22 全过。
- **校准脚本/产物**（182）：`_calib-product-entity.mjs`（正式版：线上 state
  原文优先+context 全键）→ `/tmp/calib-j127-final.json`；辅助 `_verify-binance
  -j127.mjs`/`_verify-netdown-state.mjs`/`_verify-anomalies-j127.mjs`/
  `_audit-state-sections.mjs`/`_diff-state.mjs`/`_dump-binance-rows.mjs`。



- **案由**：并集回测 d46b1b6c（50442571/02c60e50 双实验 66 万 tick）叙事分析
  累计 89.1 分钟 ≈ 回测墙钟 92%——瓶颈全在多平台外部 IO，非 Jev（708 次调用
  秒级）。两个死重定位：①账号收集无缓存：`getAccountWithFullTweets`（账号
  信息+推文列表路径）是 ExternalResourceCache 唯一漏网的外部拉取，单次分析内
  三调用点（collectAllAccountsWithFullInfo → detectIssuerByCaTimeline →
  prestage 规则验证）各自独立重拉同一作者，回测实测「获取用户信息」985 次调用
  vs 302 唯一 handle ≈3.3 倍冗余（高频账号翻页凑满 100 条 = 单次调用 10 页
  API）；②SameNameCheck AVE 搜索恒死重：duplicateNarrative 过滤要求目标
  token `raw_api_data.appendix` 非空——appendix 是 AVE API 发现链路专属字段，
  watcher 时代 wss 组装行没有 → targetAppendix=null → isCopycat **恒 false**
  （回测日志实证 960/960 次「重复叙事： 0」），而 BSC 300 条 + Solana 逐关键词
  300 条搜索（多词 token 单次 5-15s）全白拉——不止 Solana，BSC 也是死重。
- **改动 1（两层缓存）**：`account-community-rules.mjs` `getAccountWithFullTweets`
  手工 get/set ExternalResourceCache——层1 userInfo `twitter_user_info:<handle小写>`
  （跨 token 复用，消除同作者连环发币重复拉取）；层2 tweets
  `twitter_user_tweets:<userId>:<untilSec|c<count>>`（窗口级，单分析内三调用点
  同窗全命中 + 同 token 重析幂等）。TTL：userInfo{30d,365d}（同 twitter_account
  档）/ tweets{6h,90d}（时间线头部随新推文增长）。**刻意不走
  CachedFetcher.fetchWithCache**：其失败 1h 冷却会静默灭掉宣告竞态重试
  （PrecheckFailRetryService 300s 窗内重试全被冷却挡掉）；只缓存成功（userInfo
  需 screen_name 非空防 C53 空 stub 毒缓存、tweets 需 Array.isArray），失败零
  缓存痕迹 = 重试语义与无缓存时一致。
- **改动 2（appendix 短路）**：`same-name-check-service.mjs` 把 targetAppendix
  解析提前到 AVE 搜索之前；null → 直接返回等价结果
  （`isCopycat:false` + `details.skipped='no_target_appendix'`）零 AVE 调用。
  逻辑等价证明：targetAppendix=null → duplicateNarrative filter 恒 false →
  isCopycat=false（960/960 实证）。AVE 时代老票（appendix 存在）仍走完整链
  （同叙事+起来过 → isCopycat=true 语义保留，A5 单测锁定）。
- **预期收益**：回测场景单分析内 ×3 调用点 → ×1 真拉 + 跨 token userInfo
  复用（985→≤302 次 UserByScreenName）；SameNameCheck 每次 5-15s AVE 搜索全免
  （watcher 时代 token 占绝对多数）。
- **单测**：`node scripts/_test_same_name_appendix_shortcut.cjs`（38 断言零 DB
  零网络三节：A 短路矩阵六路+wss 行 AVE 零调用+老票完整链回归/B 两层缓存矩阵
  miss·命中·大小写归一·untilSec 独立 key·网络失败零缓存痕迹·C53 空 stub
  不落缓存/C TTL 档+调用透传+源码序）。回归：_test_twitter_community_pipeline
  14、_test_precheck_fail_retry 35 全过。
- **生效**：回测/直调进程重启后生效（node 已加载旧代码的进程不受影响）；
  narrative engine 重启同理（§四-10 同批决策点）。

---

## 三、Jev 问题集版本演进（卷三起）

| 版本 | 日期 | 改动 | 触发 Case / 依据 | commit |
|---|---|---|---|---|
| J1.32 | 2026-10-17 | **题面零改动；变更在 state 输入形状**——superIP 注册表命中票改走标准路径全量 18 题（快车道删除），state PRECOMPUTED 注入 `super_ip_hit` 认证事实行（name/type/tier/desc，格式与快车道时代一致）+ `super_ip_note` 反混淆提示行（作者身份认证≠代币背书，关联/主体资格/量级仍归题集逐题判定）；preScores 预分行删除（评分归 Jev）；非 superIP 票 state 逐字节 bit-parity（单测 A5 红线）；新行评级与 J1.31 前不可比按 prompt_version 过滤 | C83 BI 簇案（bbbe2561 体检：快车道「引用即 IP」6 票引用同一 binance 推文全拿 S 级 84-86 high 全亏，10 票 9 亏净 -0.0085 BNB 占总亏 21%；量级被预分喂饱+reason 不落库；用户裁定 registry 进 state 评分归 Jev） | 本 commit |
| J1.31 | 2026-10-16 | 新增第 18 题 `event_resonance`（事件情绪感染力 choice 三档：strong_reaction 强感染 / mild_amusement 轻度有趣 / indifferent 无感）**恒带**；题面锚定 BSC meme 买家立场的情绪行动性（主动讨论/玩梗/二创/站队/参与冲动），与 web3_fit 分工=静态口味 vs 动态感染，圈外传播量级明确排除（另有题评）；mapper 标准数学分支 E 类系数折损：`category==='E'` 且系数<1 时 `stage2Total=(tierScore+effDim2)×coef+timeliness`（时效不折），strong ×1 bit-identical；mild 0.5/indifferent 0.25 数学上拦死全部档位（max 49.5<60）但刻意保留系数形式（梯度可观察+阈值校准留口）；旧缓存行缺答案 fail-open 不折；superIP 快车道不消费；审计 `jev.eventResonance` 恒落/`jev.resonanceDamp {resonance,coef}` 命中才落/`probabilities.event_resonance`；历史窗口回测前置失效 `scripts/narrative/invalidate-resonance-window.cjs`；单测 `node scripts/_test_jev_resonance.cjs`（14 断言；fixture 坑=quality 原始分需从 DB breakdown 反解 bandInterpolate） | C80 蝙蝠侠摇案 0x4547dae7…7777（用户裁定「对时事现象热度，其实也应该度量事件对Web3用户的情绪感染力」；E 类 70.68→75.68 high 买入 31s -12.4%，无形象纯现象+抖音搜索页截图+105 粉宣告者；折损后 mild 42.84/indifferent 28.92 双拦） | 本 commit |
| G1.0 | 2026-10-15 | **vision 前置预判门题集（独立小调用非标准题集成员）**：1 题 Choice `vision_gate_sufficiency`（sufficient/need_image），state=与主 Jev 同语料无图形态；`judgeVisionGate` 概率门 sufficient≥minSufficientProb(0.6, config `vision.gate`)，probabilities 缺失→0 宁跑勿跳；误判方向 fail-safe（误 sufficient→无图=偏拦；误 need_image/失败→跑 vision 原行为）；接线与竞态屏蔽见 C72；单测 `_test_vision_gate`（35 断言） | C72 小黑案 0x9641293a…7777（用户裁定「文字已足够确认叙事就免掉 vision」+默认开；vision 6.6s 占直调 8.05s 的 82% 为最大延迟单点） | 本 commit |
| P1.10 | 2026-10-15 | **账号基本面门全删**：粉丝底线 <20、推文 <5、注册 <30 天三道门 + P1.5 实度豁免逻辑删除；`prestage_project_quality` 题随之删除（唯一消费方已不存在，5 题→4 题）；`rateProject` 重写为纯粉丝带定档（账号 0-299 mid / ≥300 high 不拦截；社区 ≥100+activity high 才 high；baselineMet 恒 true）；token_type 判据措辞同步（follower count "only sets the rating tier, never blocks"）；web3ip/project 双路径同删（mapPrestageAnswers 的 downgrade/qualityExempt 键全删）。同 token 两版本评级不可比（low→mid 单向翻转） | C70 bunker 案 0x2ec1e08c…7777（用户裁定「交易者不会因为粉丝量/注册时间拒绝一个项目」；近 7 天底线拦截 168 票 16 票毕业 9.5% 判别力接近随机；发币后 5 秒快照对当天新号系统性失真） | 本 commit |
| J1.30 | 2026-10-14 | 新增第 17 题 `name_image_consistency`（名图一致 choice 三档：same_entity 同一对象 / same_visual_category 同类视觉主体 / unrelated 无视觉对应）**条件题**——仅 `options.imageConsistency=true`（主推配图分析挂载）时问，brand_hijack 同款模式无图不问防幻觉作答；meme 盘惯例锚（名字是动物/角色词、图主体恰是该类形象→至少 same_visual_category）+ 图内文字与币名关系计入 + 反例锚；mapper `imgNameExempt` 三门豁免 Stage3 关联≤10 截断：①imageEvidence（twitterInfo.image_analysis 存在）②same_entity+same_visual_category 合并 ≥0.5（答案缺失 nicMatchP=0 fail-closed，旧缓存行零影响）③0<relevance≤10（纯零关联不救）；relevance 分照常计入总分（J1.24/C59 同款计分语义）；与 punExempt 正交并存；劫持/拼写/质量门不受豁免；superIP 快车道不消费本题（C59 的 meme≥3 门语义分工）；审计 `jev.imgNameExempt {relType,relScore,matchP}` 命中才落 + reason 前缀「名图一致豁免(J1.30)｜」；配套 img-v3 图分析（visible_text 逐字转写+maxTokens 1500→2500+config 显式覆盖同步）；历史窗口回测前置失效 `scripts/narrative/invalidate-nameimage-window.cjs`；单测 `node scripts/_test_name_image_consistency.cjs`（36 断言） | C65 巴巴鸡案 0x1ea2152c…7777（用户裁定「都做」：P1 根治梗名只在配图图内文字里的形状（字面证据被 img-v2 截断吞掉→Jev 只剩弱证据判 cultural lv1=5 分触截断拉黑），P2 兜「图里没有文字、只有视觉主体」的现金猫型形状；fixture 取整教训=写 RELEVANCE_TABLE 锚定断言前先对表） | 9ed48ef |
| （C64 交易侧，题集不动） | 2026-10-14 | `narrativeCorpusLagSec` 语料锚语义反转：主推/父推/第二推文取 **Math.max（最新）** 不取更早——「旧梗新盘/热点二次发酵」形状（最新宣告推贴开盘=早票）不再被 min 语义误判预热盘；负值=宣告竞态按早票放行、null=晚票严格门 fail-closed 不变 | C64 朴蛋案 0x3c4ca09c…7777（用户裁定「lag 卡最新的不要卡老的」；旧口径锚定旧梗推 lag=3263s 整窗拦死、右臂 earlyReturn 峰值 77 够不着 100；同案价格口径分裂疑云查否留档=快照 firstPrice 是 USD 因子勿当 firstPriceBnb） | d1fbca4 |
| J1.29 | 2026-10-09 | 新增第 16 题 `subject_carrier`（形象载体存在性 choice 三档：existing_entity 已真实出现 / improvised_entity 脑补许愿形象 / no_visual_entity 非形象存在形式）**恒带**（dry-run opt-in 参数 `carrier` 废弃，传不传均含——J1.28 先例）；superIP 快车道复用同题集但不消费本题答案；题面钉死三判别（形象须真实出现/名字含形象词≠载体/人物公司产品事件不以形象为存在形式）；mapper `subjectCarrierBlock`（M2）：C/D+非existing 拦、E+no_visual 拦、A/B/F/G/W 不进门，挂 rmBlock 后、量级 D/E 门前；审计 `subjectCarrier` 恒落（旧缓存行 null）/ `subjectCarrierBlock {carrier}` 命中才落；历史窗口回测前置失效 `scripts/narrative/invalidate-carrier-window.cjs`；单测 `node scripts/_test_subject_carrier.cjs`（43 断言） | C61 bddd3578 案（用户裁定病根「叙事主体没有具体的形象/梗载体」+ 否决 5 个外围代理方向「没有针对这个问题」+「可以按照你的想法挂门…292 票全部跑一遍过滤后虚拟算总收益」；dry-run 236 票：existing 140 票 winR 39% +11.694 / improvised 24 票 8% −1.111 / no_visual 72 票 24% −3.784；虚拟收益 +21.895 → +26.225 净效应 +4.33，winR 35%→41%；E 只拦 no_visual 依据 = E+improvised 6 票 +1.19 Ants 戏谑票有肉；已知误伤 = 「XX人生」概念梗家族 ~+1.6） | 本 commit |
| J1.28 | 2026-10-08 | `referent_memeability`（J1.21 superIP 条件题）改**标准路径恒带**；mapper `referentMemeabilityLowBlock`：mem≤1（人名/账号/周边人物、严肃对象/事务性名称——无梗无二创空间）→ blocked「不适合成为meme币（指代对象meme价值X分≤1）」，挂 nameReferentBlock 后、量级门前；生产链形式 = rating 翻 low 经 rating 门起作用；中间档 1.5-2.5（币安汽车 1.75/2.35、隔音舱 1.77、日产途乐 2.12）无单调性**刻意不设门**；审计 `referentMemeabilityScore` 恒落（旧缓存行无此题→null，校准免重跑）/ `referentMemeabilityBlock {score}` 命中才落；历史窗口回测前置失效 `scripts/narrative/invalidate-referent-window.cjs`；单测 `node scripts/_test_referent_memeability.cjs`（39 断言，G 段低档门矩阵） | C60 0fed29f9 早晚票+低档门双门案（用户裁定「币安汽车/日产这些蹭得过头根本不可能成为 meme 币要拦，但 JACKET/永生/Taigan/皮草类不敢一棒子打死——只上低档门」；dry-run 96 票：mem≤1 拦 4 票净 −0.354 避亏、误拦仅卷王 +0.013；三臂终局见 C60：meme 门实锤 +0.3138，重析方差成本 −0.72 单窗口吃掉收益，多窗口期望归零） | 73e0e21 |
| （C60 交易侧，题集不动） | 2026-10-08 | `narrativeCorpusLagSec` 早晚票语料滞后因子（lag = FA 出生锚 − corpusTs，null→晚票严格门 fail-closed）+ `earlyReturn` 注入 preBuy context；买腿门 `(narrativeCorpusLagSec < 300 OR earlyReturn >= 100)` | C60（用户裁定「早票正常买，晚票要求更高——确定用户认同（或强庄）才入场」；R1 vs R0 配对回测 +0.9784 = 避亏 +3.0155 − 晚票追高推迟 −2.0371；早票桶共同漂移 0.0000 = 回放确定性机器证明） | 888adb8 |
| （C59 mapper-only，题集 J1.27 不动） | 2026-10-07 | superIP 通道「指代载体在图」豁免 `imgReferentExempt`：三门全中（①analyzer 传 imageEvidence = twitterInfo.image_analysis 存在 ②0<relevance≤10 ③referent_memeability≥3，J1.21 阈）豁免 Stage3 关联≤10 截断，relevance 分照常计入总分（J1.24 同款计分语义）；不绕任何阻断门（web3 unfit/negative/news/rcp/nrBlock 照拦）；标准路径零触达；审计 `jev.imgReferentExempt {relType,relScore,memeScore}` 命中才落 + reason 前缀「指代载体在图豁免(C59)｜」 | C59 现金猫续二案 0x56dc26bd…7777（用户裁定「恐怕这里还是要修一下。我认为关联应该很强了」——C58 图分析后 relevance 0→10 恰触截断线的口径错位；182 扫描 336 可解析行三门全中恰 1 行零外溢，无图门会误放 8 行文化词蹭票；本案预测 76.03 high） | 本 commit |
| J1.27 | 2026-10-03 | ①event_magnitude 形状③收窄：公司产品发布量级按**产品实体自身**事件影响力评（母公司知名度不转移；第三方自传播才算大影响力，通稿不算）②dimension2 形状③配套 ③新增第 15 题 subject_entity 八档主体标注 ④币安豁免三处（D/W 边界句/magnitude 豁免句/fit 豁免句）⑤mapper `productEntityAcceptanceBlock` 产品实体接纳门：se∈{product_functional,product_character} 且 (strong_fit+fit)<0.5 → 阻断；豁免链 pubProxy/isW/rideMass/binanceCorpus（`detectBinanceCorpus`）/superIP ⑥C42 条件③ J1.27 适配：newProductP 改 1−P(0)−P(1)（形状③下概率质量移向 P4/P5，原 P2+P3 口径意外失效——RedCoin 43.17 偶发低分案） | C56 中国公司产品发布簇案（用户裁定「主体不是华为/网易而是它们发布的产品实体；要不事件形成大影响力，要不玩梗可爱形象——本质是 web3 用户能不能接纳」+ mid-turn「要豁免币安」；终校准真 state 156 票：产品门 11 票全中设计目标、币安 5/5 high、high→low 27/→mid 2；state 保真缺口 94/161 发现与校准方法论见案内） | 本 commit |
| （C56 mapper-only，题集 J1.27 不动） | 2026-10-03 | 平台官方源豁免三处：`detectPlatformOfficial` 主推作者 handle 硬集 `{binance, flapdotsh}`（大小写归一；刻意不查 in_reply_to 父推——BOB 路人号形状；作者字段双形状 tweet `author_screen_name`/account `screen_name`）→ ① rcp 概率门（routineContentProductBlock opts.platformOfficial）② **block_reason argmax 链 institution_routine/routine_content_product 豁免子句（FlapGuy 实测拦截位：argmax 0.55/none 0.30 而 rcp 概率仅 0.10，概率门盖不住——与 superIP 通道 institution_routine 豁免同语义）** ③ 产品实体接纳门；审计 `rcpPlatformExempt`（救票形状才落，忠实复算 argmax 链）；superIP 通道不传 opts（C23 域语义不变，币安官方号走注册表快车道） | C56 FlapGuy 案（用户裁定「flap 是 币安链的 meme 币发布平台，也是我们交易代币主要来源，跟币安链一个道理」；FlapGuy 0x2fb77ad0…7777 low→high 74.42/75.87、BOB 0xf2fca4cf…7777 路人号照拦双 low、RedCoin 77.52/81.75 基线不变、币安 5 票 flap 改动后复验全 high 不触达） | 本 commit |
| （卷二期版本史：J1.23-J1.26 / P1.8-P1.9 见卷二归档 §三；卷一 J1.8→J1.22、P1.2→P1.7 全历史见卷一归档 §三） | | | | |

**版本规则**：改题必 bump；DB prompt_type/prompt_version 可按版本筛历史结果。

---

## 四、未决事项（活项跨卷累积；卷一/卷二已解决项与原始排查过程见各归档）

1. **SHIELDCAT**（卷一 §六-1）：J1.10 下阻断侧 0.67 → low，待用户裁定是否预期行为
2. **OneKey Flork 纠纷语料**（-2）：需「币名指向 ≠ 计分主体」新维度，待设计
3. **主路径带语料端到端**（-3）：事实上已达成（C9 起多轮真实语料 case 落
   `jev(J1.x/…)` 行），待确认收口
4. **叙事缓存失效清理机制**（-5）：模块改动后批量置 is_valid=false 的机制 planned 未建；
   现行手动行删或 `NarrativeRepository.updateIsValid(address, false)`
5. **material_id 映射覆盖率**（-6）：全表 22184 行仅 10159 有值——龙头门只对挂了
   material_id 的候选生效，无映射仿盘漏拦（fail-open 方向已接受）
6. **龙头门拦截力未激活**（-4）：窗口内 hot=1 信号 0 条——天鹏型仿盘活跃度不足买门
   从未 fire；拦截场景需等虚拟实跑自然出现
7. **同推文仿盘群盲区**（-10 后半）：「首发+全没火」结构（9 盘 16s 抢发）龙头门/
   同名规则均无覆盖，需并发仿盘门（pre-check 密度口径）方向待裁定
8. **E5 卖侧小票窗口盲区三方向**（-9）：市值门降档 / 加不依赖 RSI warmup 的中段
   止盈腿 / 维持现状——待裁定（后续引擎级止损双腿、周期路由卖腿已部分缓解，
   条目未正式收口）
9. **e3 virtual 孪生**（-7）：待建虚拟实跑积累拦截场景（条目陈旧，V2+ 已多轮迭代）
10. **多进程 mapper 版本漂移**（-11）：token_narrative 缓存行由 narrative engine +
    交易引擎直调进程多进程写入，mapper 改动要彻底生效需重启所有直调进程——重启
    节奏属用户决策点（长期操作约束）
11. **prestage 行 stage_final_result 旧残留**（-12）：prestage 分支不写/不清
    stage_final_result，改道 token 残留旧主路径终局误导 web 展示；修法待裁定
12. **apidance makeRequest body 阶段无超时**（-13 遗留观察项）：abort 只覆盖响应头
    阶段，body 读取可挂死 120s+；是否延长待裁定
13. **executed 信号 0 成交——个别买入静默失败**（-14）：哦/Cz黄鞋两 token BUY
    executed 但 trades 0 行（极新盘 16-65s fire 共同特征）；是否深查待裁定
14. **377cc0a6 回测题面版本混杂**（-15）：J1.12 部署时未重启回测进程——回测大概率
    已结束，条目或已失效，待确认
15. **（完结留档）crypto 原生机构豁免边界**（C56 遗留）：用户裁定「flap 是
    币安链的 meme 币发布平台，也是我们交易代币主要来源，跟币安链一个道理」
    ——落地平台官方源豁免（`detectPlatformOfficial` 三处豁免位，详见 C56 条目
    与版本表 mapper-only 行）：FlapGuy 0x2fb77ad0…7777 low→high 74.42/75.87；
    BOB 0xf2fca4cf…7777 定性修正为 228 粉路人号 @zhangxuanhui 回复 CZ 玩香蕉梗
    （父推才是 cz_binance）——非官方源不豁免，common_word 拦截维持合理
16. **新闻发酵型 expired_tweet 误杀观察**（C69）：真实新闻事件（媒体转载链）发币
    lag 6-24h 仍可能处上升期，expired_tweet 6h 终判对此形态失明——256 票扫描
    误杀仅 Hatchan 双盘（同一事件），暂不改；特征组合（媒体型推文高互动+发酵窗
    lag+部署创意如宇树股票 quote）再攒 2-3 个同类 case 才议分窗/豁免
16. **token_narrative 非持久化语料列缺口**（C56 校准方法论发现）：fetch 结果只有
    twitter_info/classified_urls/extracted_info 等落列，binance_square_info/
    instagram_info/website_info/douyin_info/xiaohongshu_info/weixin_info/
    youtube_info 等全不持久化——重建 state 必缺节（评3 161 票中 94 票受影响；
    币安智能案实证 mag 掉档）。线上行为不受影响（实时分析 state 完整），只影响
    事后重跑/校准/回放的保真——是否加列或把 full fetchResults 打包落
    data_fetch_results，待裁定
15. **「牛来」0xbeea1d61 完全未进系统**（-16）：watcher 断供窗口漏采嫌疑，
    是否排查 09-26 前后心跳连续性待裁定
16. **≤J1.12 豁免/骑乘区脏 high 缓存 21 行**（-17）：实时实验无买入风险（全过观察窗），
    回测会吃到——回测前按 E5e2 流程 ignoreCache 批量刷新；彻底解法是 §四-3 缓存失效机制
17. **E 类 name_referent 阻断 scope**（-19）：共合 E 类 common_word 0.93 但 E 不在
    scope → S 档事件分放行；扩 E 有误伤风险（Zen Monkey E 类 +68%），需全量重放验证，
    待裁定
18. **GMGN 风险因子拦截门启用**（-21）：全链路已落地（三因子进 context），25 样本校准
    否决现行阈值（issuer 语义混淆/ratio 量纲不稳）；建议不写门，待更好判据
    （如按叙事路径拆分 issuer 语义）出现后再启用
19. **pre-check 5 处 created_at 消费点是否切 wss_events 回退源**（-22）：flap 盘时效
    检查维持跳过（fail-open）；扩面会改变拦截面（flap 过期语料从放行变可能拦截），
    待裁定
20. **历史视频类 token 时效系统性低估 + TikTok/B站 fetcher 时间字段**（-25）：
    ① 历史视频币行时效恒 0，是否批量重放刷新（可先筛「时效=unknown 且差距≤15」
    候选集给用户过目）② TikTok/B站 fetcher 补抓发布时间。待裁定
21. **CA 宣告路由两个残余形态**（-26）：① 短链不展开（GMGNPaid 型，低收益）② 宣告
    竞态的改道形态无重试（标准路径 low 不在 §4.8 重试域）。待裁定是否值得覆盖
22. **IP 首币时效豁免**（-27）：知名 IP 首币骑乘应豁免时效（NEARkat 型）；暂缓——
    判定「该 IP 名下无先币」需全史代币名匹配数据，待数据积累
23. **久留美案开播后自然验证**（-28）：角色 IP 通道已开（A 类豁免 rcp、量级门把关），
    10/1 动画开播为自然实验点——开播后爆梗则后续角色名币可到 B 档过线（通道价值
    实证）；无声息则归档为「开播前抢跑资金盘」。另案：快拉金狗买腿窗口可达性
    （叙事放行≠买得进）独立观察。
    **开播日中间状态（2026-10-01 UTC 上午快照，首播尚未播出）**：首播 =
    当晚 UTC 12:30（AT-X 21:30 JST），二分判定时点未到，建议 10-02 执行。
    已采事实：① 官号 @fxkurumi_info 开播日宣传密集（UTC 00:00-04:00 至少
    9 条：倒计时插画/主题曲映像三本一挙公開/放送情報/配信開始告知），粉丝
    2.3 万（C25 时）→ 25,620（四天 +2.6k）；② 角色名跟风票共 11 个
    （experiment_tokens 09-29 00:00Z 起分页扫描 260,532 行命中，09-29×9 /
    09-30×2 / **开播日 10-01 至今 0 个**——越临近开播反而无新票；22:53
    一秒内三票裸名「久留美」为典型同推文抢发群形状）：
    0xd2111c14 / 0x0faa553d / 0xa9512665 / 0x67105f85 / 0x7bec93ae /
    0x97f3696f / 0xd1599c0f / 0x17a968b6 / 0x24a5813f / 0x474148c9 /
    0xbe95dc15；③ 11 票全部死盘（ticks ≤1 ×8、0 ticks ×3，最高
    0x7bec93ae 26 ticks 峰值 1.57x / 0xd1599c0f 35 ticks 1.25x）——
    活跃度不足买门从未 fire → 叙事直调从未触发（token_narrative/
    token_profiles 全无行，定性闭环非链路故障）；④ 本尊 0xfedf1975 已毕业
    断流（100min 12.6x 后无新 ticks，毕业盘预期行为——用户在 GMGN/PCS 侧
    看到「交易量不错」与系统内断流同时为真：毕业后交易迁 PCS，watcher 只
    采内盘）；⑤ **开播日重析幂等验证**（用户问「现在交易量不错，依然
    不通过吗」触发）：182 ignoreCache 重析（J1.22 现行题面）→ **low
    55.56 维持**，与 J1.20 时逐分一致（A 类 + C 档 22 + 传播 18.56 + 时效
    15）——语料锚定创建时刻（09-27 官推宣传推，角色未开播 → C 档无名
    角色），首播未播重析不翻案 = 时效锚定设计的一手实证；叙事评分不消费
    盘面数据（12.6x 毕业/PCS 交易量不反哺量级档——量级只认语料证据）。
    爆梗验证（二创/梗图证据形态 + 后续角色名币 A 类量级是否到 B 档）待
    10-02——本尊语料固定（IPFS metadata 挂官推链接），开播后能吃到新语料
    的是后续新发角色名币；本尊已毕业过观察窗，实跑实验不会再买
24. **0.55 appendix 适配 + 蓝筹阈值实跑校准**（-29）：① 0.55 对 wss 票空转（status id
    提取未适配）② 组合门阈值按富贵案定标，误拦率待实跑回看；C34 已积累 AVE 假 fdv
    素材（$1T 帽先落豁免比较层，组合门是否叠加脏值过滤一并裁定）
25. **J1.17 cashtag 改道生效面**（-30）：① superIP 快车道未挂改道（CZ 荐币式场景）
    ② 版本漂移同 §四-10；存量 high 缓存重析走 ignoreCache
26. **J1.18 发布者指代门已知边界**（-31）：① 媒体号转述与自宣不可分（可加转述指纹
    词）② 「重大升级」形状被版本指纹词排除，边界待案例积累 ③ 10 万粉阈值分领域
    待回看 ④ 生效面同 §四-10 ⑤ 同事件豁免窗 ±1h 若现「真蓝筹恰在 1h 内上线」
    误放形状再议
27. **J1.19 web3_fit 门校准**（-32）：① marginal 档现不拦只落库观察，积累分布后回看
    是否收严 ② unfit 0.5 门若现「偏好不合票反而赢」对账反例再调 ③ 题面典型清单按
    新 case 补充（每改必 bump）④ 规则 3.5/3.5.5/3.5.6（小红书/Instagram/抖音主页
    高影响力 mid 短路）同款「只看数据不看内容」结构未动，同类票漏出再按 C30/C31
    模式收窄 ⑤⑥ 馒头「计价单位形似」误放观察：用户裁定接受判定，积累 2-3 个同类
    再议是否 bump 补边界
28. **再入场买腿 v2 配对回测**（-34）：扩窗 +0.665/19h 零挤出；待议 ② P2 实际语义
    是「90s 后追入」与「全清后再入场」混在同一腿，是否拆腿或加「曾持有过」前置
    ③ 与扫描口径差异（毕业锚 72 vs 69.3、扫描无叙事门）
29. **回测 vs 实跑 4.16 BNB 差距——top1BuyShare 实时高估偏差**（-35）：watcher flush
    +提交延迟使 90s 窗尾端散单未入库 → 实跑 top1 高估 15-25pp 误拦（3 票 +2.95 机会）；
    候选调研：实测偏差分布决定 60 门放宽 5-10pp 或窗沿后置 2s；窗沿票候选
    tokenAgeSec 门留链路余量。教训：远程查询必 .range 分页
30. **正龟案关联性谐音梗盲区**（-36）：量级修复后唯一拦截点移到 relevance none 0.85
    ——「正龟」≈「正规」纯中文谐音推理，代码无可判事实；三方向待裁定（cultural 题
    补提示有开口风险 / 接受盲区 / 积累 case 再定）。另：J1.20 形状② E 类措辞对存量
    E 类票档位扰动为校准观察点
31. **（完结留档）prestage data_fetch_failed 路径 rating=null 落库 bug**（-37）：
    **C53（2026-10-02）四处修复闭环**（B1 源头判空骨架 throw / B2 缓存出口拦截毒行 /
    A 早退补 preCheckData / A2 no_data 补载体），实证扩至 18 行 + no_data 分支同病，
    三票重跑三条路径全部 null→low。遗留：15 行历史存量不自动失效（重析即修）；3 行
    prompt_type=null 的 Jev unrated catch 形状另案。附带：GMGN creation_timestamp
    部分不可靠（负年龄 10 张，降档方向恰好保守）
32. **（完结留档）0.52 AVE 同名搜索波动两问**（-38）：同 token 两跑一拦一放（now-based
    快照漂移）；① minFdv 100K 门允许 $130K 撒币小盘拦 $1.7M 票门槛过松 ② 快照波动
    致判定不稳定——**C47（2026-10-01）整体废除 0.52 后两问皆失对象**，规则本体与
    蓝筹门配置一并移除
33. **（完结留档）YouTube 语料链路**（-33）：①②③ 已全部收口（extractVideoId 扩
    pattern / 8aca25e2 重启 / 熊熊波西重析端到端），④ 畸形 URL 维持 null 合理
    （事实陈述非待办）
