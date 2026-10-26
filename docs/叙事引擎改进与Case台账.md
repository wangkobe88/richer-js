# 叙事引擎改进与 Case 台账（卷四）

> **卷三已归档（2026-10-23）**：C56-C180（2026-10-03 ~ 2026-10-23）全档见
> `docs/叙事引擎改进与Case台账-卷三归档.md`（含卷三期期末架构一屏与 J1.27-J1.109
> 版本表）；卷二 C36-C54 见 `-卷二归档.md`；卷一 C1-C35 见 `-卷一归档.md`。
> 本卷自 C181 起，只续新记录与活跟踪项。
> 分工原则（多 Case 反复验证）：**LLM 管叙事价值判断，代码管市场事实**——凡是市场事实
> （谁先发、涨了多少、有没有同名）一律代码侧判定，不指望 LLM。
> 写作纪律（C35 确立）：case dump 一律 jq/node 抽窄字段，不整读（防 autocompact thrashing）。

## 一、现行架构一屏（2026-10-23 时点，卷四开卷）

```
Token URL → URL 分类（IPFS metadata 解包 C112：任意 http(s) meta 直链 JSON 判定）
  → 数据抓取（C62/C63 提速族：三泳道并发/keepAlive/precheck 并行；GMGN 补源；
     空语料推特搜索兜底 C77 searchFallback：按 symbol+since 搜推特，非空即旁路 no_public_info）
  → Pre-Check（纯规则）
     ├─ 账号/社区 token / 发行方自发宣告（detectIssuerSelfLaunch 字面法+CA 时间线）
     │    → prestage Jev（P1.14，4 题；粉丝带只定档不拦截；project 分支官网核验 C164）
     └─ 标准路径（superIP 快车道 C83 已删——注册表命中走全量题+state 注入认证/反混淆行）
          → vision 前置门 G1.2（文本已讲清免图）+ corpusGate C79（语料充分跳待抓）并行
          → 单次 Jev 调用（J1.109：10 常驻题 + name_image_consistency/image_depicts_name
             条件题）→ [KNOWLEDGE_BASE] 注入段 C165（蓝筹/准蓝筹/手册/概念五文件热载；
             蓝筹家族偏好指引 C177——改 Prompt 不魔改分数）
分类/量级/时机/质量/关联/W类/Web3偏好/名图一致 原子化同问；聚合/阈值/截断全部代码端（jev-result-mapper）
```

- **Jev**（TypeSafe System One，api.typesafe.ai）：结构化三原语（Choice/Score/Noul）无文本生成秒级；
  版本规则=改题必 bump（现 J1.139 / P1.14），DB prompt_version 可按版本筛历史
- **现役拦截门链**（mapper 端，C189 时点）：蓝筹去重门 C168（首臂：name_exact 撞 b: 域蓝筹拦 low；
  条目级 dedupExempt + 新陈述豁免 C173 + 新事件豁免 C242）→ web3UnfitBlock（unfit≥0.5）→ web3FitMassBlock C141
  （sf+fit<0.5 全域拦）→ quality_veto argmax（empty_content/baseless/ip_reuse 三桶；图证在场豁免
  C114）→ 实体类型门 C184（unacceptable_type≥0.5 全域拦，pubProxy 豁免）→ wrong_entity C139
  （全域）→ **词句门 C189 恢复拦截**（weBlock 后量级门前，全域无豁免；C187 三因素理顺判据后
  拆 C180 两病灶自愈）→ 量级门 D/E 档臂 → W 数学
  （appeal 单轴 pass 32；三档 Choice 15/47/66 C177）/标准数学（eventCompositeScore≥60）→
  Stage3 三截断（关联≤10/拼写 C78/关联性不足）
- **C180 纯观察化（词句臂已 C189 恢复）**：nameEntityLowBlock（unknown 实体低影响力）臂维持
  退役纯观察（题照问、nameEntityLowMass 照落档）；web3UserAcceptabilityBlock（词句接纳度）
  C189 恢复拦截；50 张被拦票收回归集 C180-C229 观察票待逐张裁定
- **整轴退役史**：载体轴 J1.102/C171（题集 12→10）、品牌劫持 J1.103/C172（判据归 J1.92 三桶）、
  negative_hard_news J1.101/C170、superIP 快车道 C83、superIP 指代豁免 J1.21/C83
- **交易侧链路**（C84 主模型）：narrativeTriggerCondition（FA 因子）→ 后台多轮 getRating（重试臂
  accountOnly/corpusEmpty C162）→ 单一买条件（narrativeRating==2|3）→ GMGN 条件（API 失败
  fail-open 2026-10-20 裁定）；legacy 直调腿 narrativeCallCondition 并存（互斥 fail-fast）；
  观察信号 2026-10-23（叙事 2|3 或市值超阈留痕 OBSERVE 不触发交易，实验级默认关）
- **结果全局缓存**：token_narrative 按 token_address 全局唯一不挂实验；题集语义变更后历史回测
  前置批量失效（scripts/narrative/invalidate-*-window.cjs）
- **代码侧 pre-check 规则族**（无 LLM）：0.5/0.55/0.58 同名（strictSameNameTokenCount=as-of 快照
  优先）/ 0.7 语料复用 / no_public_info 与 address 双重试域（PrecheckFailRetryService）/
  0.5x 爆款短路收窄

---

## 二、Case 研究（倒序，卷四自 C181 起）

### C242 撞名蓝筹新事件豁免——事件同一性条件题三腿（BNC 案，2026-10-26 用户裁定，J1.139）★

- **案发动机**：用户问「0x5cbc7a8faab57f22dd2addd22a01b249a8f57777 这个为啥没通过叙事分析」。票=**BNC**（four.meme），语料=**BNB Standard 官方宣告今日敲纳斯达克开市钟**——蓝筹主体（BNB Standard BNC，ATH≈$1.56M 已在册）发生的新事实事件。final low 被 C168 蓝筹去重门首臂拦（name_exact "bnc" 撞 BNB Standard 条目），而 Jev 分数本身全好（impact none 0.71/fit strong_fit 0.74/关联 exact_match 0.76）。
- **用户裁定（基本原则）**：「名字一样，但是新代币有真实新事件做背景，就不要被拦截。这也是一个基本原则。像已有的熊猫头 case 不是这个形态（熊猫头 case 是重新发布了形象化 IP）。」——**撞名≠重复，新事件自带入场资格**。
- **两阶段实现（关键：双条件版自检翻车）**：①两条件版（efb321b，noneProb≥0.5 ∧ timing∈FRESH_TIMING_C88）部署后自检发现**会误放 C121 牛来姐妹票**（none 0.67+within_7d 双过，但它是用户 2026-10-22 裁定「拦没问题」的同事件姐妹复制品）——代码侧无可靠判据：蓝筹条目无叙事源锚、姐妹票载体推与蓝筹语料各自独立、时间线分不开 C121 与 BNC 形状。**事件同一性=叙事判断归 Jev**（「LLM 管叙事价值判断，代码管市场事实」同源）。②三腿版 J1.139（77fd95b）：新条件题 **bluechip_event_identity** 三桶 same_event/new_event/unclear——撞名才问（`bluechipDuplicate` flag，同 J1.30/J1.39 条件题模式防幻觉），撞名蓝筹已在 [KNOWLEDGE_BASE] state 段=材料现成零接线；题面判据核心=**事实内容是否新**（载体推新/措辞新/发币账号新都不算；只有蓝筹主体确实又发生了新事情才算）+BNC/牛来/熊猫头三例证。豁免三条件=`new_event≥0.5 ∧ noneProb≥0.5 ∧ FRESH_TIMING`；答案缺失/旧缓存行无此题 → fail-保守照拦（历史行零翻转）；audit `bluechipDedupNewEvent` 增 newEventProb 三判据留痕（命中才落）；与 C173 同构豁免只翻门分数照算（后续门链 unfit/契合门/量级门照常接管）。
- **三形状分界（豁免域地图）**：形象复刻（熊猫头，重新发布形象化 IP 无新事件依托）→ same_event 拦｜同事件姐妹复制品（C121 牛来，复述同一冠军事件/仍在发酵期）→ same_event 拦｜蓝筹主体新事件（BNC 敲纳斯达克钟）→ new_event 放。
- **对拍（182 定向重析，77fd95b 部署 worker 55681 后）**：**两案全中** ✓✓——BNC `high 74.83`（bluechipDedupNewEvent={newEventProb 0.81, noneProb 0.79, timing within_7d} 三腿全过，event:W）；**C121 牛来姐妹票 `low 照拦`**（dedupNewEvent=null，三腿设计的动机票=双条件版会误放、三腿版接住）。C242 回归单票 PASS（fresh 重析 high 74.65 非缓存）；单测九文件全绿（bluechip_dedup_gate 77 断言含 B6 真值表七臂：BNC 放/熊猫头拦/牛来形状拦/缺题拦/new_event 0.49 掷骰拦/unclear 拦/old timing 拦）+版本断言四处 bump+一处存量漏网修复（name_entity_acceptance 锁 J1.137 未随 J1.138 更新）。回归集收 C242（expect high/mid+auditIncludes bluechipDedupNewEvent/bluechipDuplicate；rating 只锁可买档不锁 band）。

### C241 平台官方号方向性表态≠trivial+W 域收窄「发布新项目」+fourdotmemezh 入 superIP（밈 案，2026-10-26 用户裁定，J1.138）★

- **案发动机**：用户问「0x34f5a1bb5f4a7eb1da3c0b8be92b071bee59ffff 为啥叙事分析没过」。票=**밈**（韩语「meme」通用词，four.meme，第三方抢注 creator 0x06c5…0703 非官方），语料=**Four.meme 现行主号 fourdotmemezh 首条韩语推**（向韩国用户打招呼/以后常来，官方推未提币）。final low：impact **trivial 0.44 argmax** 拦（none 0.33/empty 0.20 近 tie）+ 分类 **W 0.88** 且 W 数学 **low 0.47**（不过 32 线）+ 名字 not_entity 0.74→词句 not_acceptable 0.62。
- **误判机制三层**：①「开始发韩语」被读成日常运营（C237 域）；②币=第三方抢注蹭平台官方语料，C230「项目主体性陈述归 W」没区分「项目币 vs 蹭项目官方语料」→ W 数学评错对象（评 밈 无项目实质→low；评平台本身对 BSC 用户吸引力显然不低——两方向都拧巴）；③主号身份失认（fourdotmemezh 被当区域子号降档——实际原主号 @four_meme_ 2025-10-28 被 X 封禁后它就是主号，生态号 @Four_FORM_ 确认）。
- **用户三裁定**（2026-10-26）：①**打招呼=表态**——「打招呼就够了，不需要什么战略陈述/合作内容，这是一个表态（一个直接的沟通），用户看到它之后就理解平台要做什么了，注意从用户出发！这跟纯粹的日常抽个奖不是一个性质的」：平台官方直接沟通传递**市场方向信号**（开语言/开市场扩张触达）=有分量事件，推文形态再轻不降信号、不要求公告/战略陈述要件；与 C237 划界=读者获得**方向信号 vs 活动信息**；与 C235 不同轴（开语言/开市场不改变机构与加密行业关系，不走加密立场动作豁免）。②**W 域收窄**——「W 是发布新项目（评判的也是项目），不是这种成熟平台的公告」：成熟平台/产品官方运营公告与市场动作归 **D** 走事件轴+量级门（C239 同精神）；W 数学资格轴只留「币=项目币」形状（AIFLY 形状）。③**fourdotmemezh 入 superIP**（institution/A，5ecaac7 先行）——性质=Four.meme 现行主号/平台官方自我陈述语料源非 KOL；tier A 与 four_meme_fora 同档（C137 精神消费臂只看在册）。
- **落地**：J1.138=trivial 反锚⑦（方向信号锚+用户裁定原话例证）+ W 桶排除锚（成熟平台公告归 D/W=发布新项目）+ 注册表条目 + 版本断言三处 bump（angle_timing_override/jev_question_consolidation/web3_fit）+ `_test_event_trivial_gate` C6/C7 源码断言（25 全过）。
- **对拍（182 定向重析，c755586 部署 worker 29972 后已收）**：**四票全中** ✓✓✓✓——밈 主票 `event:D`（W→D 生效）+ `blockChoice=none`（trivial 反锚⑦放行）+ `effectiveImpactTier=S`（注册表认证行生效）+ 终态 low 落**词句门 not_acceptable 0.53 近 tie**（entity=not_entity；authorUtterance 臂未命中 hit=false）=预期内「救形状不救这张」；**不翻锚三票零扰动**：BLACKBELT C231 low trivial 拦维持（礼节性荣誉不在⑦域）/BPC C237 南瓜营 low trivial 拦维持 P=0.94（营销活动不被⑦洗白，划界生效）/NMS mid 维持（真 W 项目票零扰动）。回归集 C241 expect 全中（rating=low+tokenCategoryExcludes event:W+reasonExcludes 事件意义太小）。**附验（用户追加，C126 こんにちは `0xf0ffa405…7777` 同族打招呼票，J1.124 后跨 14 版首次复测）**：J1.138 重析 **high 82.39 维持零扰动**——phrase acceptable 0.73（J1.117 主体符号锚稳定，vs 修复后 79%）+ blockChoice=none + 关联 exact_match + 事件分 A 档 76%（strong 61%+fit 15%）；分类 B→E 掷骰域（observe 票不锁）。**两臂对照成立**：人物号打招呼（何一）由反锚①（圈内符号人物表态）+词句主体符号锚承载=high 维持，不依赖反锚⑦；平台号打招呼（fourdotmemezh/밈 案）走⑦+D 类+名字泛关联拦——两条臂各自工作互不越界。

### C240 Web3 用户切身相关事件——fit 锚+持续运动时效豁免+impact 反锚⑥（火蚁案 불개미 姐妹票，2026-10-26 用户裁定，J1.136+J1.137 两批）★

- **案发动机**：用户两问「0x502592d3c980a25ed52a11d389b0ffe1eb8c7777 为啥没过叙事分析？」「还有这个 0x988635ef13f78daf7022f6109dbf6b02f35c7777」。两票为**同叙事姐妹票**（불개미/火蚁，flap 平台）——韩国币圈散户以「火蚁（fireant）」为群体图腾发起抗议、集结投资人力量、给 EVM 地址并通过 flap 把活动税收给他；载体推 `@UnderDogXmm`（747 粉）转述。两票均被「事件分不足」拦：E 类事件分 **51%/50% < 60**（fit 四桶分散 strong_fit 0.22/fit 0.29/marginal 0.24/unfit 0.26——fit 与 unfit **紧咬**），W 吸引力 low 领先但分类归 E。实测后续涨幅 **3 分钟内 11.41x / 8.56x**（flap 平台大肉票被拦）。
- **误判机制**：fit 题判据核心两问之「受众与 crypto 圈是否重叠」被「韩国」地域词带偏——「币圈用户的抗议」被读成「韩国社会的本地事件」，**unfit 的「地域性社群文化」臂被激活**（unfit 0.26 与 fit 0.29 近 tie 挤压）→ 事件分差 9-10 分拦死。载体形状 angle_seeking+news_recap（旁观转述）亦无豁免臂。
- **用户裁定（两条）**：①「显然这俩是必须要过的。这不是韩国本地事件，这不是 Web2 的事件，是 Web3 的事件，而且跟用户密切相关。你看一下这俩代币的后续上涨情况就知道了」；②「是 Web3 用户切身相关的事情」。
- **实施（J1.136，纯题面锚 mapper 零改动）**：**只改 fit 题契合层，不动 event_category 分类层**——W 留给项目/产品是 C230/C239 硬边界，群体事件归 E 分类合理，卡点在契合层不重分类。fit 题加锚：事件主体是 **Web3/crypto 用户群体自己的集体行动或切身事务**（币圈散户维权/抗议/联合行动、加密用户群体身份与权益叙事〔散户对抗机构/爆仓维权/交易所事件中的用户群体反应/链上社区集体身份〕、群体性链上行为〔集体进某资产/集体迁移/集体打金〕）→ 受众与 crypto 圈**完全重叠**（参与主体就是 Web3 用户自己）、对 BSC meme 用户切身相关、**至少 fit**；有**群体身份图腾**（「火蚁」式散户军团自称、动物图腾昵称、社区集体外号）可 **strong_fit**。发生地/报道语言/地域限定词（韩国/某国/某语种报道）**不改变主体归属**——「韩国币圈用户抗议」的主体是「币圈用户」不是「韩国社会」；与 BSC 生态平台（flap/four.meme/币安链）的直接关联（合作/收税/链上地址交互）=圈内直连正向。criteria strong_fit/fit 各补一句。
- **边界三连（防误伤）**：①只认**参与主体=Web3 用户群体**——纯圈外人群的抗议/维权/社会事件（无 crypto 参与主体）仍按原判据评（C193 齐天大圣旁观热点不适用）；②平台官方组织的运营活动（做任务赚积分，C237 币安南瓜营）是平台动作不是用户群体自己的行动，不适用本锚（C237/C239 票零扰动）；③消费具体个人苦难/死亡的猎奇叙事仍走 unfit 臂（负向锚优先，C160 消费弱势面防线不动）。
- **测试**：web3_fit **33 断言**（新增 A10 锚句在场+A10b 边界三连在场+A10c criteria 两句+版本断言）；版本断言 bump **四处**——name_entity_acceptance（47 绿）/angle_timing_override（47 绿）/jev_question_consolidation（90 绿，后两处系 C239 bump J1.135 时漏改存量失败，同款坑再现：**bump 版本必须 grep 全仓旧版本号，正则转义形状 `J1\.xxx` 也要扫**）；关联批次 event_trivial_gate 23/emotional_impact_carrier 7/massive_influence_carrier 7/w_bsc_user_appeal 37/vision_gate 37 全绿。
- **J1.136 对拍翻出两臂（同源病灶延伸）**：J1.136 部署后两票重析 fit 锚**完全生效**（strong 0.96+fit 0.04=100% 契合）但**仍 low**——票 1 卡时效三重 older（rawTiming older + C75 源头 lagSec 2934416≈34d + J1.39 translation_or_repost 父推 override）→「旧源封顶 30」30<60 拦；票 2 卡 impact trivial 0.46 argmax（none 0.45 近 tie 掷骰）。取证：主推=fireant_korea **9-22 加密税宣言推**（34 天前，宣言=运动起点）、token **10-26 当天创建**、website_tweet=小欧小O 当天转述宣告推（in_reply_to 主推）+EVM 地址+flap 收税合作；分类翻 C 0.73/W 0.18。同源病灶：fit 题被「韩国」带偏、timing/impact 题被「宣言推日期/圈外小事件」带偏——判据核心（发酵状态/感染力）本来就该放行，全被带偏锚挤掉。
- **J1.137 续批实施（三落点）**：①**event_timing 题加持续运动锚**——源头/宣言推较早≠叙事陈旧：事件是持续展开的运动（币圈散户维权/抗议/集体行动）时宣言推日期=运动起点非事件终点，看**主体新进展证据**定档（同运动主体近期仍在行动：新抗议/递交/合作/官方宣告/发币 → 按发酵状态判 within_7d/within_30d；仅小号转述/重复提及旧宣言而主体无新行动=运动已停照常按日期判）；火蚁例证（9 月宣言+持续行动+10 月底官方发币+flap 合作）。②**impact 题反锚⑥**——Web3/crypto 用户群体切身相关的集体行动与权益事件对 BSC meme 用户切身相关（是自己的事）意义不小不选 trivial；地域限定词不降事件分量；与反锚②分工（本臂管群体切身利益/②管玩梗空间，其一在场即不算 trivial）。③**mapper C75/C103 override 加发行方自发宣告豁免 `issuerTimingExempt`**——issuerSelfLaunch 检出（truthy 对象非布尔）=主推作者即宣告主体（detectIssuerSelfLaunch 品牌同一性+宣告指纹已隐含），讲自己的事源头早=运动史而非蹭：**C75 全量豁免；C103 收紧为同主体链父推**（isSameSourceParent 三层证据任一：父推 author=主推 author/tweet_id 相同/归一文本同头——翻译**自己**的宣言≠洗白**别人**的旧闻；BAI 形状父推作者 binancezh≠主推作者参赛小号不豁免）；**C102 币安借壳语料刻意不豁免**（BAI 案防线）；豁免只放 override 压制不保 Jev 判档（Jev 判 older 照拦——防线在题面「主体新进展证据」要求）；审计键 issuerTimingExempt 命中才落；NarrativeAnalyzer context 传 issuerSelfLaunch。**不动 event_category 分类层**（W 留给项目/产品=C230/C239 硬边界维持）。
- **测试（J1.137）**：angle_timing_override **58 断言**（新 G 段八断言：G1 火蚁现场豁免双不打+within_7d 保留+审计 true/G2 未检出零侵入 bit 一致/G3 Jev 判 older 豁免票照拦/G4 BAI 形状 C102 无豁免+异主体父推 C103 照拦/G5 源码口径四点锁〔truthy gate+skipSameSourceParent+isSameSourceParent+C102 无 gate+timing 锚+impact 反锚⑥〕）；版本断言 bump 三处（web3_fit A10c/angle_timing_override/jev_question_consolidation）+ name_entity_acceptance D5 正则转义形状漏改修复；关联批次 narrative_signal_gate/precheck_tweet_freshness_bucket 97/narrator_two_shapes/superip_standard_path/corpus_gate 54/jev_client_backoff/unrated_elimination/issuer_ca_detection/daily_parse_summary 全绿。
- **对拍（182 定向重析，J1.137 部署 worker 14572 后已收）**：**两票全翻 high 96.52** ✓✓（票 1 low 30→high：审计 effectiveTiming=**within_7d**〔持续运动锚生效〕+issuerTimingExempt=true〔staleSrc/staleRel 双 null〕+impact **none 0.67**/trivial 0.27〔反锚⑥掷骰消除〕+fit 100%〔J1.136〕——三臂全按设计生效；票 2 trivial 拦→high 同链）。**零扰动五票全中**：AIFLY low 维持/NMS mid 63.85 维持/BLACKBELT low trivial 拦维持/股城 mid 64.09 维持（issuer 票但 meta 自带 twitter，豁免臂不触发路径不同）/BPC C237 币安南瓜营 low 维持（**反锚⑥不洗白日常营业票**——与火蚁群体行动划界生效）。回归集收录两票（C240×2，expect rating=high+tokenCategoryExcludes event:W——分类掷骰面不锁 C111 纪律）。
- **关联**：C230/C239（W 边界不动——本案在契合层不在分类层）/C237（平台动作 vs 用户群体行动划界锚）/C160（情感路径互补：公益纪念走情感臂、群体行动走本锚）/C161（影响力豁免退役后 fit 层本就是事件分量的落点）。

### C239 站内金融化玩法不是 Web3 项目——event_category W 负边界锚（英雄联盟股币案，2026-10-26 用户裁定，J1.135）★

- **案发动机**：英雄联盟股币 `0x2fe5328cf2ea8cd632161564464c1e6c2e347777`（four.meme，symbol=股币）mid 64.45 rating 2 一次过无阻断（v39 轮次表 06:12 8 秒完成；执行侧买腿其余门没全过无信号行未实际买入）。用户两条质疑：①「虎扑（不是一线产品）上线的一个功能，对 bsc meme 币用户重要度不够」；②「股币（web3 重要概念）——事件-概念不匹配」。
- **取证（J1.129 判定链）**：语料=328 粉载体推（回复 CZ 12 天前 LoL 梗推）报道虎扑世界赛上线「联盟股」玩法（站内币「股币」买选手股票、表现好涨价）+知识库 concept:stock-tokens 注入（语料关键词「股票」命中）。**event_category 掷 W 0.8（B 仅 0.13）=根因**——站内金融化玩法的交易语汇（股币购买/选手股票/涨跌）+股票概念币背景注入，把 Web2 平台活动玩法读成 crypto 实验。W 成立后链式放行：impact none 0.42（conf 仅 0.27，trivial 0.27 近 tie 掷骰；且 W 路径下 trivial 被反锚④结构性豁免「Web3 项目发布不由本题否决」）→ fit strong_fit 0.79（竞猜玩法判强契合）→ W 资格轴 mid 0.6（虎扑按形态二「较为知名的组织」过线，low 仅 0.13）→ W 数学 47+关联 20+质量 16.25=64.45 mid。ne 题 accepted 0.34（conf 0.18 严重掷骰，entity_event_mismatch 0.25 第三高——质疑② Jev 部分看到未拦）；parent_relationship new_angle 0.65 亦歪（载体与父推内容无关）只影响时效分不动。
- **事实核验**：①虎扑联盟股=App 内活动玩法（活动币非链上资产，非腾讯/英雄联盟官方——载体推「英雄联盟推出选手股票」表述失实）；②「股票概念币」=BSC 正式叙事簇（four.meme 2026-09-08 官方 4Stock 机制，meme 币与美股标的配对，GPU/NVDAB/BNC4 等）——币名撞 web3 既有概念光环、事件却是圈外平台玩法=概念域错位，知识库条目恰在本票命中注入。
- **用户裁定（三条）**：①「可以，修吧」；②「我建议把股票概念币放到知识库中」（条目已在库，本案做增强）；③「我估计那个纳斯达克的 case 的分类就换了，这也是对的」（NMS 预期换类认可）。
- **实施（J1.135，纯题面锚 mapper 零改动）**：event_category 加两条边界——①**W vs B/D 边界（站内金融化玩法不是 Web3 项目）**：站内虚拟货币/积分/模拟炒股/选手股票/竞猜，即使玩法用「币/股/交易/涨跌」语汇、即使币名/活动币名与既有加密概念撞名（如「股币」撞股票概念币），只要活动资产不是链上/crypto 资产=产品功能更新：机构官方渠道上线=机构动作 D、非机构主体=B，均不由 W 评（虎扑联盟股例证锚）；②**D vs W 边界扩写**：圈外/Web2 机构在自家官方渠道上线的功能/活动/示例（含涉 crypto 试水、官网代币化资产示例页、站内金融化玩法）=机构动作 D——第三方发现/转述「机构做了 X」主体仍是该机构。W criteria 桶尾补同判据短句。**知识库 concept:stock-tokens 条目增强**：补 4Stock 机制背景（four.meme 2026-09 官方、正式叙事簇）+撞名划界（叙事域=真实上市公司/股价/美股市场；币名撞「股票/股币」但事件主体是圈外平台游戏化玩法/站内活动≠本概念叙事，属撞名蹭概念）——state-only 不 bump 题集版本，mtime 热载。版本断言两处 bump（angle_timing_override/jev_question_consolidation）。
- **分流预期**：虎扑票→D→C237 锚接住（圈外机构与行业立场无关的常规营业=trivial 拦）；NMS→D（换类，用户认可）→C235 反锚⑤不拦（立场性动作）+机构量级 D 档→mid 应保持；真 W 票（AIFLY dev 自发项目宣告/股城社区发）主体=项目本身不触新边界。质疑②概念错配不单独立法（emm 桶是「实体极大∧事件极小」形状不匹配、硬扩搅浑 C194）——由 W 负边界「与加密概念撞名不改变平台属性」+知识库条目划界句双覆盖。
- **对拍（182 定向重析，J1.135 部署后已收）**：0x2fe5 → **low「事件意义太小」** ✓（event_category **W 0.8 → B 0.78、W 归零**，impact trivial 0.5 argmax 拦——W 路径豁免消失后 C237 日常营业锚正常接住；ne not_entity 0.48 主导=概念错配侧面印证）；NMS `0xa9cb21aac801301711a13b69d76f2af8216c7777` → **mid 63.94 维持**（分类**未换**仍 W 47——「第三方陈述一个 Web3 产品」正向识别臂仍在竞争，D vs W 扩写锚未翻转此票；评级零扰动 64.03→63.94 属正常抖动，用户「换了也是对的」容许下不换也不错）；AIFLY `0x0baecc80613610f8c6051e55c136505a47507777` → **low 维持**（W 15<32——18 粉 dev 资格判据零扰动，W 正向识别无误伤）✓；股城复验归 C238 部署批（AVE 语料补源后 W 资格轴复验）。回归集已收录 C239（rating low+reasonIncludes 事件意义太小+tokenCategoryExcludes event:W——B/D 均可接受不锁掷骰面，C111 纪律）。
- **关联**：C230（W 识别强化——本案补其负边界：W 是项目/产品主体形状，机构渠道动作与站内玩法不是）/C235（NMS 换类后的 trivial 兜底位）/C237（虎扑票分流落点=日常营业锚）/C238（同期股城对拍批）。

### C238 社媒补源源优先级链——AVE token detail 新接入 + GMGN 全链路放开（股城语料缺口案，2026-10-26 用户裁定）★

- **案发动机**：C237 部署（J1.134）后股城 `0xaacbc156435dbab7815a61bccba1c827e52a7777` 二次翻 low（W 臂 low **0.93 conf 0.89** 两轮稳定，质变非掷骰）——用户追问「股城代币没有语料吗？应该有的呀」。取证链：股城=flap 票（meta JSON 仅 name/symbol/一句 description/头像图，**无任何链接字段**）→ URL 提取全空 → C77 搜索兜底 15 条玩家推成唯一推特语料（官方号 @STOCK__OPOLIS 被玩家@在场但链路无消费点）→ C236 资格判据「Dev 有一定发帖数粉丝量+介绍中说明身份」要看的证据（官方号页面）在语料里**结构性不存在** → 高置信判「完全无名」low。
- **双源实测（2026-10-26 curl）**：①GMGN `getTokenInfo` link.twitter_username=`"MEJ50749/status/2112469093156630545"`（用户指出该推文现挂 GMGN 代币页）——**宣告推文直链**形状（GMGN 裸 handle 拼接规则天然兼容）；②AVE `/v2/tokens/<addr>-bsc` appendix JSON twitter=`https://x.com/STOCK__OPOLIS`——**官方账号页**。**BRF 案「AVE appendix=元数据镜像」结论修正：只对 four.meme 票成立，flap 票 AVE 是独立聚合源**（meta 无链接而 AVE 聚合出官方号）。AVE/GMGN 互补分工：AVE=官方号（粉丝量/发帖数=W 资格轴证据）、GMGN link=宣告推直链。两源当时都未被消费：AVE token detail 不在叙事链路（AVE 只做同名/holder 工具）；GMGN 补源 `enrichSocialByGmgn` 只在 fire 直调+PrecheckFailRetry 传 true（BRF 案配额裁定），重析/worker 队列整链不执行。
- **用户裁定（三条）**：①「**ave api 确认使用**」；②GMGN 补源「我从来没有要求关闭过，我的期望是打开，不过**一定是所有的数据都失效后才走这一路**，因为 GMGN API 无付费版本，容易因为流量封锁使用」；③「搜索兜底可以保留，作为最后的手段」。
- **实施（纯抓取层，Jev 题集零改动无版本 bump）**：①新 `src/narrative/utils/ave-social-fetcher.mjs`——appendix JSON 的 twitter/website **完整 URL 直传不拼接**（与 GMGN 裸 handle 不同）、空串/非 http 不当有效值、成功缓存 60s（一轮 retry 补轮内不重打）/null 进 1h 失败冷却（晚到聚合由 GMGN 5s 层与 C77 接住）、appendix 原文随 raw 落库；②data-fetch 源优先级链 **meta/appendix → IPFS 解包 → AVE → GMGN → C77 搜索（末位）**——AVE 与 IPFS 同一 Promise.all 并行（AVE 门=pre-IPFS allUrls，IPFS 补出 twitter 的罕见票白调一次接受）、**GMGN 串行在 AVE 之后**（原 IPFS∥GMGN 并行结构退役；判据升级为含 IPFS+AVE 的 allUrls=重叠白调消失只省配额）；③`enrichSocialByGmgn` **默认 true 全链路放开**（原 fire 直调特权废止；no_public_info 缓存行穿透重析随之全链路生效——无语料票每轮重析吃补源直到语料到手）。逐层必要门 `!hasTwitterLink`（判据单一真相由 gmgn-social-fetcher 导出）。
- **测试**：新 `_test_ave_social_fetcher.cjs` 28 断言（A 股城现场 appendix 完整 URL 不拼接/坏 JSON/空串/B TTL 60s+cache key/C 源优先级链串行接线五断言+enrichSocialByGmgn 默认 true+C77 保留/D 双源分工反证——AVE 层无 handle 消费无 x.com 拼接、股城 appendix 不含 MEJ50749 宣告推）；gmgn_social_fetcher E 段随改 41 断言（E3 GMGN 串行在 AVE 后+E3b IPFS∥GMGN 旧形状防回潮+E4 默认 true）；gmgn_superip_tweet_enrich B6/narrative_parallel_fetch C4 随新结构（17/31 全绿）；precheck_fail_retry/search_fallback/corpus_gate/ipfs_race/corpus_ready_prefetch 等 16 个相邻单测全绿。
- **对拍（182 定向重析，部署后）**：股城 → 预期 AVE 拿到 STOCK__OPOLIS 官方号 → twitterInfo 有官方语料+粉丝量 → W 资格轴有据（C133 expect [mid,high] 复验）；AIFLY/NMS/BLACKBELT 复验零扰动。
- **关联**：C236（资格判据降档——本案=其证据供给侧补全：判据要看发帖/粉丝/身份自证，得先把官方号抓进语料）/C182（GMGN 必要门+失败 2 次封顶维持不变——门语义正是「失效才走」）/BRF 案（AVE 镜像结论修正：flap 票独立源）/C77（搜索兜底降为末位保留）。

### C238b 账号臂/W 臂双臂贯通——地址核验失败回落标准路径 + GMGN 宣告推穿透臂 + utter.cash 聚合器页（股城三卡点收口，2026-10-26 用户双臂裁定）★

- **案发动机**：C238 源优先级链上线后股城重析卡点转移——AVE 补到官方号 `@STOCK__OPOLIS` 后走账号臂，仍被拦。三层取证：①**简介 CA 缓存冻结**——用户指出「介绍中有 CA 吧？」，实测当前简介含 `CA:0xaacbc156435dbab7815a61bccba1c827e52a7777`，但 twitter_user_info/twitter_account 两层缓存（10-18 抓，maxAge 30 天）冻结的是**无 CA 旧简介**——冻结期内 verifyTokenAddress（只扫 description+推文文本）永远扫不到，地址核验恒失败；MEJ50749 宣告推（76709 粉大号）全文 444 字零 0x 地址、42 条相关推也零地址 → **官方号简介是账号臂唯一 CA 源，缓存冻结=卡点真因**（非「推文无 CA 结构性恒拦」——我先前的误判被用户推翻）。②**terminal 拦拓扑**——地址核验失败（账号质量未达标∧无 CA）stage='address' 直接 precheck 拦死，无 W 臂出路；质量达标无地址票有 account_quality_no_address 通路（不动）。③**C164 官网核验门误吃聚合器页**——AVE appendix website 给的就是 `utter.cash/bnb/<CA>/taxinfo`，被当项目官网抓 →「网站空壳」误判拦（地址门过了之后卡在这）。
- **用户裁定（双臂原话）**：「走 web3 原生项目（也就是有 CA 账号的臂）是一条路，股城该过；**走 W 类，也就是不提供 CA 这一臂，我认为也应该过**。」——两条路都要通：有 CA（简介/推文宣告）→ 账号臂 prestage 项目评级；无 CA → W 臂标准路径 Jev 评估（W 资格轴 J1.130 本就是判「发布者配不配」的地方，小号冒名票 W 臂自会评 low），地址核验失败不再 terminal 拦死。
- **实施（四处代码+一处运维，Jev 题集零改动无版本 bump）**：①`utter.cash` 进 AUTO_TOKEN_PAGE_DOMAINS（C99 清单）——聚合器自动税信息页不算项目官网，C164 官网核验门不再吃它；②gmgn-social-fetcher 导出 `isTweetLevelUrl`（twitter 域+/status(es)/<id> = 推文级宣告证据；账号级=身份档案）——判 AVE 补到的 twitter 是哪级；③data-fetch **GMGN 穿透臂+宣告推并入臂**——`gmgnNeeded` 含 `aveOnlyAccountLevel`（AVE 只补到账号级 twitter → GMGN 仍走：宣告推证据未到手，W 臂评估需要；meta/IPFS 自带 twitter 的票不触发=C182「有 twitter 不调」语义不变），GMGN twitterUrl 推文级∧不在场 → 并入 allUrls（宣告推直链进语料，排 C51 superIP 臂后 superIP 行为 bit 不变）；④NarrativeAnalyzer **address 回落**——`preCheckData.result?.validationStage === 'address' ∧ !options.skipAddressValidation` → `shouldUseAccountCommunity = false` 回落标准路径（C117 superIP 强制标准路径同构；performRulesValidation 纯规则先行不烧 prestage Jev 额度）；name/data_fetch_failed 等 stage 照旧 terminal；skipAddressValidation 票（C100 内容臂已验地址）不回落=已验证据不丢；⑤运维：股城 twitter_user_info/twitter_account 两键失效重拉（缓存冻结非代码问题——其他票同形状靠 GMGN 穿透臂+重析自愈，因为 enrichSocialByGmgn 默认 true 后每次重析都重取账号数据）。
- **测试**：gmgn_social_fetcher **52 断言**（新增 F 段 isTweetLevelUrl 判定矩阵八断言〔MEJ50749 宣告推 true/STOCK__OPOLIS 官方号 false/search 页 false〕+E5 穿透臂判据在位+E5b 宣告推并入臂+E5c 排 C51 臂后）；ave_social_fetcher 29（C4d 穿透臂在位）；data_fetch_failed_rating **38**（新增 A3/A3b/A3c 回落三断言：三键合取分流在位/其余 stage 照旧 terminal/回落票由 Jev 标准判定接管）；isproject_coin_aggregator_urls 38（utter.cash 事故现场断言）；superip B6 随新形状；39 个关联叙事单测全绿；顺手修 name_entity_acceptance D5 版本锚 J1.134→J1.135（C239 bump 漏改的存量失败，与本案无关）。
- **对拍（182 部署后 5aac1dc，worker 4137577，四票全中，已收）**：股城 `0xaacbc156435dbab7815a61bccba1c827e52a7777` → **mid 64.12 W 类** ✓（BSC 用户接纳度 47>32——与 C236 对拍 mid 63.82 同档；**穿透臂生效实证**：GMGN 宣告推直链 `MEJ50749/status/2112469093156630545` 进语料 twitterType=tweet+76709 粉 direct_tweet 豁免 2.1+**时间线 CA 宣告命中**〔tweetId 2113195456192999506，不只简介——账号臂证据也在场〕；语料双源齐备下走标准路径 W 评估=双臂裁定落地形状）；AIFLY → low 15 ✓（零扰动——meta 自带 twitter 穿透臂不触发）；NMS → mid 64.15 ✓（零扰动）；BLACKBELT → low「事件意义太小」✓（trivial 拦截零扰动）。
- **关联**：C238（源优先级链——本案补其第四层语义：AVE 补到账号级≠宣告证据到手，推文级归 GMGN）/C117（superIP 强制标准路径先例——回落同构）/C100（skipAddressValidation 不回落红线）/C99（AUTO_TOKEN_PAGE_DOMAINS 清单延伸）/C164（官网核验门误吃聚合器页修复）/C236（形态一降档——W 臂回落票的资格判据承载者）。

### C237 币安日常运营豁免收窄——trivial 反锚①只豁免 meme 相关动作/表态，运营营销活动拦（BPC 币安南瓜营案，2026-10-26 用户裁定，J1.134）★

- **案发动机**：BPC `0x478a2cc43f67b860f0f9f3d9a4374b499a947777`（Binance Pumpkin Camp）**high 94.63 误放**——主推=币安官号「Binance Pumpkin Camp is Live! Play & Earn Points to Unlock Your Rewards」（万圣节积分营销活动）。用户裁定：「很纯粹的日常运营，无玩梗空间」。
- **误判机制（取证）**：①impact none 0.70/trivial 仅 0.16——C231 trivial 反锚①「圈内符号级人物/机构（CZ、何一、币安等）的**公开动作与表态**=可玩事件素材」被 Jev 泛化成「币安官号发什么都算事件」，主体是币安 → 不敢选 trivial；②fit **strong_fit 0.85**——「Play & Earn Points」被读成「可参与空间」（反锚②语义），平台营销的任务参与被当成 meme 参与空间；③event_category D 0.59/W 0.41 近 tie 归 D（圈内）；三层连环放行 → 事件分 97 → high。
- **实施（J1.134，纯题面 mapper 零改动）**：①trivial 反锚①收窄——只豁免「**meme 相关动作与表态**（发言/立场/重大官宣/上 meme 币等对 meme 市场本身是可玩素材的动作）」；**日常运营与营销活动不算 ①的豁免**（节假日主题活动/积分任务/Play & Earn 营销/常规产品运营推）——任务参与（做任务赚积分）≠ meme 玩梗空间，主体再核心（币安官号直发）也是日常营业，选本项拦（BPC 例证锚）；②fit 题判据核心两问后补锚——「平台运营活动的『任务参与』（做任务赚积分/解锁奖励，如交易所节假日活动）≠ meme 参与空间；参与空间指 meme 意义上的可玩、可二创、可传播」（BPC 第二落点）。
- **测试**：event_trivial_gate 23 断言全绿（新增 A8 反锚①收窄全锚句+币安南瓜营例证 / A9 fit 题参与空间锚）；三处严格版本断言 bump J1.134。
- **对拍（J1.134 部署后，已收）**：BPC → **low「事件意义太小」** ✓（trivial 接住币安日常运营）；BLACKBELT 维持拦 ✓；NMS 维持 mid ✓；AIFLY 维持 low ✓；股城 W 臂 low 0.93 二次翻 low ⚠️——后由 **C238 定因=官方语料缺口**（GMGN/AVE 双源未消费）非题集问题，AVE 补源上线后复验。
- **关联**：C231（trivial 立桶）/J1.58（作者层级锚——本案=其机构臂过宽的首次校准：动作/表态≠日常运营）；与 C235 反锚⑤互补（⑤管圈外重量级机构涉加密立场动作放行、本案管圈内机构日常运营拦截——两轴方向相反）。

### C236 W 资格轴形态一门槛降档——新项目 Dev 有发帖粉丝+身份自证即可（股城翻 low 案，2026-10-26 用户裁定两条，J1.133）★

- **案发动机**：C235 对拍四票中股城 `0xaacbc156435dbab7815a61bccba1c827e52a7777`（形态一原型）在 J1.131「卡项目 Dev（构建者）」措辞下连续两轮 W 臂 argmax low（0.46/0.51，第二轮领先 16pp）→ 终态 low 15，C133 回归 expect [mid,high] 翻 FAIL——Jev 按 direct low 臂「零影响力、零传播、无第三方讨论」评新项目 Dev：**W 类票都是新项目，传播/讨论只是预期、大概率尚未落地，该判据形状下形态一 Dev 全不过线**。
- **用户裁定（两条）**：①形态一例证删「股城」——争议票不作例证锚（「里头的『股城』得删了吧」）；②门槛降档——「都是新项目，影响力/传播/第三方讨论只是预期但是大概率没有落地，所以第一类对 Dev 的要求是多少**有一定的发帖数粉丝量，介绍中如果说明自己的身份不是完全无名即可**；**形态二，才要求发布者是高影响力用户**」。
- **实施（J1.133，纯题面 mapper 零改动）**：①形态一资格句改「项目 Dev（项目的构建者）有一定的发帖数、粉丝量，介绍中说明了自己的身份——不是完全匿名无名即可」+显式禁令「**不得以『零传播/无第三方讨论』为由判资格不合格**」（影响力/传播/讨论=预期不落地）；②形态二补「（高影响力门槛只在形态二）」；③direct low 形状一改「零发帖零粉的匿名账号、介绍中无任何身份说明——新项目的传播与第三方讨论只是预期，不作为判据」；④例证锚删股城（只留人生K线）；⑤criteria.low 同步（「新项目不要求传播/讨论已落地」+「须高影响力的知名组织或人」）。
- **测试**：w_bsc_user_appeal G6 重写（新门槛锚三句+防回潮 `!includes('股城')`+`!includes('至少是一个看起来不错的 Dev')`）+G6b 例证锚反转（股城已撤）+G7 加两新锚（37 全绿）；三处严格版本断言 bump J1.133；event_trivial_gate C5 版本断言放宽 ≥132（J1.133 轮 C235 段不动）。
- **对拍（182 定向重析，J1.133 部署，四票全中）**：①**股城 → mid 63.82** ✓（W 臂 mid 0.48/low 0.22/high 0.30——low 从 0.46 掉到 0.22 不再领先，门槛降档生效；C133 expect 恢复）；②**AIFLY → low 15** ✓（W 臂 **low 0.88 conf 0.82 高置信**——「有一定发帖数粉丝量」边界 Jev 把握住：18 粉≠有一定粉丝量，C230 expect 继续命中）；③**NMS → mid 64.09** ✓（形态二轴零扰动）；④**BLACKBELT → low「事件意义太小」** ✓（trivial 轴零扰动）。
- **关联**：C234（两形态立轴）/C234 追裁 J1.131（卡构建者）——本案=J1.131 落地后首案校准，形态一「有一定影响力」具体化为可观察的账号表面证据（发帖/粉丝/身份自证）。

### C235 事件意义太小门第三正形状——重量级圈外机构加密/代币化立场性动作不算小（NMS 纳斯达克示例 tokenized stock 案，2026-10-26 用户裁定，J1.132）★

- **案发动机**：C231 trivial 桶上线后 NMS `0xa9cb21aac801301711a13b69d76f2af8216c7777`（Not My Stock，326 粉小号发现报道纳斯达克官网放出示例 tokenized stock，配 WSJ 反代币化广告战语境）终态连续三轮被 trivial 近 tie 掷骰拦（0.29/0.31/0.30，choice confidence 仅 **0.12**；trivial 0.30/empty 0.30/none 0.22 三桶全近 tie）——C232/C234 两轮修正后 W 臂资格已稳定过线（mid 0.52/0.55），唯一拦点就是这个低置信掷骰 → 呈报裁定。
- **用户裁定**：「『纳斯达克官网示例 tokenized stock（配 WSJ 反代币化广告战语境）』算不算『事件意义太小』——**显然不算，何止不算小，这是一个很有意思的事件**。」
- **误判机制（取证）**：C231 题面只有两极判据——负极「圈外名人/机构的礼节性荣誉、日常琐事、例行公事（…日常营业内容）+主体再著名也不能把日常小事抬成事件」、正极反锚③「圈外广泛传播/多方参与/持续发酵」。「纳斯达克**官网放出一个示例页**」被读成机构网站的日常/演示内容落负极；语料只有 326 粉小号发现推，反锚③救不回。缺第三正形状：**重量级机构的立场性/信号性动作**——纳斯达克官网出现 tokenized stock 示例是传统金融巨头公开摆代币化立场的行业级信号（WSJ 反代币化广告战语境=直接对立事件），对 crypto 原生 BSC meme 用户是有意思、可玩梗的大事件；载体是「示例页」不降低信号强度。
- **实施（J1.132，纯题面锚 mapper 零改动）**：①trivial 典型形状「日常营业内容」补划界——指与行业立场无关的常规营业（日常发推/推广/服务通知/内容更新），机构涉加密/代币化动作不算日常营业；②反锚加⑤——重量级圈外机构（交易所/银行/传统金融巨头/科技巨头）的加密/代币化**立场性动作**（官网出现代币化资产示例、官方涉 crypto 产品试水/表态、与加密行业对立/竞争动作如反向唱空广告战）=行业信号级事件不拦；**载体形态（一个示例页/一次试水/单方动作）不降低信号分量、无多方传播也不变（信号本身就是分量）**；例证锚=纳斯达克 NMS 案。与反锚①（圈内符号 CZ/币安动作）互补：①管圈内主体、⑤管圈外重量级主体的涉 crypto 立场动作。
- **测试**：`_test_event_trivial_gate.cjs` 21 断言全绿（新增 A6 反锚⑤全锚句/A7 日常营业划界/C5 版本注释段+版本断言 J1.132）；三处严格版本断言随 bump（question_consolidation A10d/angle C5/name_entity D5）。
- **对拍（182 定向重析，J1.132 部署 worker 3952751，四票三中一观察）**：①**NMS → mid 64.03** ✓（trivial 拦截消失：impact none 0.42 argmax；W 数学事件分 28.2+关联 20+质量 15.83=64.03，reason=「W类 BSC用户接纳度与影响力47=47（pass线32）」——C235 修正完全生效）；②**AIFLY → low 15** ✓（J1.131 追裁下 W 臂 low 高置信维持，C230 expect 命中）；③**BLACKBELT → low「事件意义太小」** ✓（C231 正锚票不误放——名誉黑带=礼节性荣誉非立场性动作，修法精准）；④**股城 → low 15** ⚠️观察（W 臂 low 0.46/mid 0.35 两轮连续 argmax low〔第二轮 0.51/0.35〕，非掷骰=J1.131「卡项目 Dev（构建者）」措辞系统性影响——构建者本人分量证据弱于「发布者」泛指读法；C133 回归 expect [mid,high] 翻 FAIL，待用户裁定）。
- **关联**：C232（W 资格第三方视角）/C234（两形态判据：NMS=形态二原型主体=创建者知名过线）——三案串起 NMS 全链：资格过线→事件分量过线→W 数学 mid。观察点存档：NMS 评级形状稳定后收回归集（expect=mid）。

### C234 W 资格轴两形态判据——BSC 链项目发布者须像样 / Web2·Web3 涌现项目主体须知名（人生K线·股城·NMS 三原型，2026-10-26 用户裁定，J1.130）★

- **案发动机**：C233 部署对拍发现 AIFLY（C230 回归票，18 粉 dev 自发币+无 CA，expect=low）连续两轮 W 臂 **mid 0.46/0.42 近 tie 误判**（三桶分散 low 0.21/mid 0.46/high 0.33）→ mid 60.98 过线，资格轴「直接判 low」形状 Jev 拿不稳 → 用户裁定 W 资格轴判据重构。
- **用户裁定（四条合成）**：①机制前提——「走到 W 类的项目，应该都是没有提供 CA 的，否则会走更靠前的账号判断逻辑」；②两形态——「BSC meme 玩家能接受的项目类型分两种：**第一种极有特色的 BSC 链项目**（人生K线 `0x1a1e69f1e6182e2f8b9e8987e83c016ac9444444` 为代表，代币是 BSC 社区自己发的不是 Dev 发的，项目质量佳有特点有构建影响力的潜力，**股城是这一种**），它要求发布者有一定影响力不能是完全的无名之辈**至少是一个看起来不错的 Dev**；**第二种 Web2/Web3 领域里特别有影响力/有趣味/有梗的项目涌现**（如 NMS `0xa9cb21aa…7777`），一般来讲**发布主体就需要有更大的影响力了，需要是较为知名的组织或人发布的**，然后结合项目本身的情况进行判断」；③澄清——「发布主体」=**项目主体即项目的创建者，不是找角度账号**；④补充——**人生K线现在已经是蓝筹币**（形态一有实证赢家背书）。
- **判据定稿**：形态一（BSC 链特色项目）代币可 Dev 发也可社区发，**发布者须有一定影响力（不能完全无名，至少是看起来不错的 Dev）**；形态二（Web2/Web3 涌现项目）**项目主体（创建者）须是较为知名的组织或人**，找角度/陈述账号无名不卡（C232 陈述者豁免维持、嵌形态二）；直接 low=形态一发布者完全无名 ∨ 形态二项目主体不知名。C232 台账观察点「无名小号报道无名小项目」就此落锤：主体不知名=资格不过线（非仅接纳度低）。
- **实施（J1.130，纯题面+版本 bump）**：W 臂题资格轴重写两形态主轴（C232 的 dev 视角/第三方视角两臂表述退役——视角方法论融入形态描述：第一人称介绍项目=发币者即项目方〔形态一 dev 发币〕；陈述者只是载体〔形态二〕）+机制前提全局化（本题票全无 CA 背书，本题不假设任何票有地址背书——J1.126「按无地址处理」从 dev 臂提升为题级前提）；low criteria 同步两形状（dev 自发币或社区发同判）。mapper 零改动（C233 分值表双键已覆盖）。
- **测试**：w_bsc_user_appeal G6 重写两形态锚（机制前提/形态一句锚/形态二句锚/direct low 两形状）+G6b 改 C234 例证锚（NMS 形态二原型+人生K线蓝筹实证+股城）+G7 加两形态 low 断言（37 全绿）；question_consolidation A11b 随改；三处版本断言 bump J1.130；event_trivial_gate/angle/name_entity 批次全绿。
- **对拍（182 定向重析，J1.130 部署 worker 3944055）**：①**AIFLY → low 15**（W 臂 **low 0.85** 高置信——mid 0.46/0.42 两轮近 tie 完全消失，资格形状稳定接住；reason=「W类总分不足（15<32）」=C230 回归 expect 完整命中）✓；②**股城 → mid 64 维持**（W 臂 mid 0.39/low 0.39 tie、choice=mid 过线）——形态一原型不动 ✓；③**NMS → W 臂 mid 0.52 维持**（形态二陈述者不卡）+终态仍拦 C231 trivial（P=0.30 掷骰观察点不动，待用户裁定）✓。
- **追裁（J1.131，同日用户澄清）**：形态一「发布者有一定影响力」明晰为**项目 Dev（项目的构建者）**——「找角度推文账号无影响力没关系」（社区成员发币不是缺陷，资格卡的是项目构建者的分量；与形态二「项目主体=创建者非找角度账号」同构）；direct low 形状随改「项目 Dev 完全无名」（代币 dev 自发或社区发同判）。两形态至此完全对齐：**卡的都是项目方（构建者/创建者），陈述/发币账号一律不卡**。测试：G6 锚随改（「项目 Dev（项目的构建者）有一定影响力」+「找角度推文/发币账号无影响力没关系」）+G7/A11b 桶断言随改+三处版本断言 bump J1.131（五批次全绿）。对拍：AIFLY 期望仍 low（18 粉 dev=构建者无名）；股城/NMS 不受影响。
- **观察点**：股城 W 臂 low/mid 0.39 并列 tie（choice=mid 过线）——形态一原型票置信度一般，哪轮 argmax 翻 low 即变「W类总分不足」拦（C133 回归 expect [mid,high]），攒批观察；形态二「较为知名的组织或人」门槛边界由 Jev 按例证锚把握。

### C233 W 臂桶 id 断代——weak/moderate/strong → low/mid/high 与评级词汇统一（2026-10-26 用户裁定，J1.129）★

- **案发（词汇呈现动因）**：C232 对拍汇报「NMS W 臂 weak 0.77→moderate 0.55」时两套词汇并存——W 臂题桶叫 weak/moderate/strong、评级叫 low/mid/high，用户问「也用 low/mid/high 呗？」→ 裁定 W 臂桶 id 断代与评级词汇统一。
- **实施（J1.129）**：`bsc_meme_user_web3_project_acceptance_and_impact` criteria 三桶 id 断代 `weak/moderate/strong → low/mid/high`（桶名措辞弱/中/强→低/中/高，instructions 全量同步「弱/中/强三档」→「低/中/高三档」、「直接判 weak」→「直接判 low」、例证锚「不因陈述者无名判 weak」→「判 low」）；**分值 15/47/66、pass 32、C230/J1.125-J1.128 资格轴语义零改动**。
- **mapper 零行为变化**：`W_APPEAL_CHOICE_SCORES` 分值表双键同分 `{ low:15, mid:47, high:66, weak:15, moderate:47, strong:66 }`——J1.107-J1.128 旧缓存行（旧 choice）与新行（新 choice）直读同分，旧行重放零翻转（零分支归一读，同 q() 归一读旧键惯例）；消费点 `W_APPEAL_CHOICE_SCORES[appealAnswer.choice] ?? 0` 不动；审计投影键 `w_bsc_user_appeal` 不动。
- **测试**：w_bsc_user_appeal F 区改标「旧桶名 choice 重放锚」（F1-F5 旧桶喂入 15/47/66 不变=旧行零翻转反证）+F6 分值表源码双键断言+G1/G2/G4/G5/G6/G6b/G7 随新桶名（G2=AIFLY 锚「资格轴不合格直接 low」）=37 断言全绿；question_consolidation A11b 三桶断言随新桶名+版本断言 A10d/angle C5/name_entity D5 bump J1.129；cashtag_w_route/superip_slogan_class/web3_fit_anchor/jev_product_entity/instagram_pipeline/event_trivial_gate/timing_probe/jev_client_backoff 相邻批次全绿。
- **对拍（182 定向重析，J1.129 部署 worker 3936727）**：①NMS → W 臂 choice=**mid**（low 0.25/mid 0.54/high 0.21）——新桶名生效、47 分对齐上轮 moderate 0.55；终态仍 low 拦 C231 trivial（P=0.31，掷骰观察点不受影响）✓；②股城 → mid 64.12 维持 ✓；③AIFLY → **意外翻面 low→mid 60.98**（W 臂 mid 0.46 近 tie 三桶分散 low 0.21/mid 0.46/high 0.33；impact empty_content 0.33 argmax 但图证在场走 C114 豁免不拦；上轮被 empty_content 0.59 拦=图证在场性跨轮波动）——重跑第三样本仍 mid 60.98（W 臂 mid 0.42/low 0.19/high 0.39）=Jev 对「18 粉 dev 自发币」资格形状连续两轮拿不准，**触发 C234 两形态判据重写**（C230 回归 expect=low 撞 FAIL 待 C234 修复后复验）。
- **性质**：纯词汇统一，无拦截位变化；旧缓存行不重析即零翻转，重析亦同分（分值表双键）。

### C232 W 资格轴适用域修正——第三方视角不看陈述者影响力（NMS 纳斯达克示例 tokenized stock 案，2026-10-26 用户裁定，J1.128）★

- **案发**：`0xa9cb21aac801301711a13b69d76f2af8216c7777`「NMS / Not My Stock」2026-10-25 18:53 评 low。语料：主推 @bwamwifprivacy（**326 粉 0 赞 0 转**）「qr code takes u to official nasdaq website where they give us an example tokenized stock! its called NMS / Not My Stock」——第三方**发现并报道**纳斯达克官网放出的示例代币化股票；父推 @mikemaccana（6638 粉）「Full page ad in WSJ against tokenized equities」。
- **误拦链**：event_category=W 0.92（tokenized stock=crypto 语境项目）→ W 臂题 `bsc_meme_user_web3_project_acceptance_and_impact` 走 C230/J1.125 资格轴「**纯第三方陈述者须有一定影响力**」臂 → 326 粉陈述者判无影响力 → weak 0.77 → 15<32 拦「W类总分不足」。
- **用户裁定（原话）**：「规则错了，『陈述者无名』是指陈述者是 Dev 的情况，也就是陈述的语句中并不是第三方视角，只是介绍了一个项目，并不是说『XX做了什么项目』，而直接就是『XX项目是什么』。而这个才是找角度推文，才是第三方视角，第三方视角找角度推文并不看发布者影响力，陈述的是『XX做了什么项目』，XX 才是主体，这个 case 里纳斯达克才是主体。」
- **语义修正**：资格轴「陈述者无名→weak」只适用 **dev 视角臂**（介绍「XX项目是什么」、语句无第三方主语——发布者=dev 本人，无名即无人背书）；**第三方视角臂**（「XX 做了什么」，主体=XX 项目方；找角度/报道/发现形状）**不看陈述者/发布者影响力**——陈述者只是载体，资格与吸引力按**主体自身分量**评（项目方级别/项目自身传播/事件分量），无名小号报道大主体不失格。C230 立的「第三方陈述者须有影响力（股城原型）」臂撤销——股城过线本就靠主体自身，不靠陈述者。
- **实施（J1.128，纯题面+版本 bump，mapper 零改动）**：W 臂题资格轴重写为两臂——①dev 视角臂（资格轴唯一看发布者的形状）：dev 视角语料一律按无地址处理（J1.126 第一锚保留），dev 须有影响力；②第三方视角臂（不看陈述者/发布者影响力）：主体=XX 项目方本身，按主体自身分量评，NMS 案例证锚；③直接判 weak 只剩一种形状=dev 视角自发币+dev 全无影响力+无地址。weak criteria 同步（第三方视角陈述不因陈述者无名判 weak——按主体评接纳度）。
- **测试**：w_bsc_user_appeal G6 重写（两臂适用域+weak 收窄）+新增 G6b（NMS 例证锚+第三方臂落 weak 禁令）=37 断言全绿；question_consolidation A10d/angle C5/name_entity D5 版本断言 bump J1.128；event_trivial_gate 等相邻批次全绿。
- **对拍（182 定向重析，J1.128 已部署 worker 3926383）**：①NMS → W 臂 **weak 0.77→moderate 0.55**（weak 残 0.17）=资格轴修正生效实证（资格不再被 326 粉陈述者卡死，接纳度按主体评）；但终态仍 low——**被 C231 event_trivial 桶 0.29 拦**（impact 三桶近 tie 掷骰：trivial 0.29/empty 0.28/none 0.24，none<0.5+argmax=trivial 即拦）=C231×C232 交界新观察点（见下）；②AIFLY → **low 维持**（dev 视角臂不动：18 粉 dev+无地址=weak 形状保留，本轮 impact empty_content 0.59 拦、终态 low 意图一致）；③股城 → **mid 64.15 维持**（J1.126 轮 64.09，第三方陈述过线理由换轨不翻面）。
- **观察点（待用户裁定）**：NMS 终态拦在 C231 trivial 0.29 低置信掷骰——「纳斯达克官网放出示例 tokenized stock（配 WSJ 整版反代币化广告战语境）」算不算「事件意义太小」（圈外机构示例性动作 vs tokenize 试水有分量信号）：若裁定=有分量事件，则 trivial 门在这票是误拦（且 0.29 置信=Jev 自己拿不准）；若裁定=示例小动作，则 trivial 桶正确接住、NMS 应 low。评级形状稳定前**暂不收回归集**（trivial 掷骰翻 none 时该票会走 W 数学 moderate≈mid）。
- **观察点**：第三方视角+主体自身也小的票（无名小号报道无名小项目）——资格天然过线后由接纳度轴接住（无叙事记忆点/参与理由弱→weak 第二肢），若出现误放票再裁。

### C231 事件意义太小门——impact 题第 4 个 event_* 桶 event_trivial（BLACKBELT 黄仁勋名誉黑带案，2026-10-26 用户裁定，J1.127）★

- **案发**：`0x46eaec0f241a0782b107d77fb5d0ed49974d7777`「The Black Belt」（BLACKBELT，four.meme）2026-10-25 评 **high 87.61**（D 类/A 档）。语料=黄仁勋获国际柔道联合会名誉黑带：@NVIDIAAI（35.5 万粉官号）direct_tweet + 父推 @nvidianewsroom 官宣（赞 290/浏览 1.9 万）。
- **用户裁定（原话）**：「我认为事件没有感情感染力/影响力，作为一名用户（bsc meme 币交易者），看一眼就划过了。虽然是黄仁勋，但是事情本身意义很小。」→ 应 low。**=C191 币安传奇观察点①（大 IP+小事件 fit 派生 tier 无仲裁位）第二例落锤，本案即接棒修**。
- **归因（完整链）**：① `bsc_meme_user_event_impact` argmax=**none 0.81**——none 是放行桶（「事件成立、对 BSC 用户有影响力」），Jev 认为名誉黑带是有效事件（用户直觉与 Jev 分歧在判定本身：题集没有「事件成立但意义太小」的否决桶）；② fit **strong_fit 0.62** → J1.79 事件分/tier 全由 fit 派生 **A 档**；③ 量级轴锚黄仁勋（世界级名人）→ high 87.61；④ C194 entity_event_mismatch 0.04 管不到（挂币名实体轴：币名「黑带」映射概念非黄仁勋本人，实体与事件未脱节——两轴正交，C231 在 impact 题管**事件本体**）。
- **实施（J1.127，题面一桶+mapper 两行）**：
  - impact 题加第 4 个 event_\* 桶 `event_trivial`（插在 event_baseless_speculation 前）：**事件意义太小**——事件真实成立（有官宣/事实/主体明确）但对 BSC meme 币用户感染力/影响力太低；典型形状=圈外名人/机构的礼节性荣誉、日常琐事、例行公事（名誉头衔授予/颁奖纪念/周年活动/常规合作官宣/日常营业内容）：**主体再著名（世界级名人/巨头公司）也不能把日常小事抬成 BSC meme 用户会玩的事件**；判据=模拟 BSC meme 买家看到时的反应：看一眼就划过（不讨论、不玩梗、不参与）；例证锚=黄仁勋获国际柔道联合会名誉黑带（C231）。
  - 四反锚：①圈内符号级人物/机构（CZ、何一、币安等 J1.58 同源）公开动作与表态=对 meme 市场本身是可玩事件素材；②有玩梗/二创/参与空间的事件与全球级可参与热点（C160/C161 族）；③事件引发圈外广泛传播/多方参与/持续发酵（事件本体有分量正常评估）；④Web3 项目/产品自身发布与进展交 `bsc_meme_user_web3_project_acceptance_and_impact`（w 臂题）评，不由本题否决。
  - 与 `event_empty_content` 划界（J1.111 事件层优先同源）：无名作者一句话/无主体闲聊（**根基=没有事件**）选 empty_content；trivial 只管**事件已成立但意义太小**的票。
  - mapper：`BLOCK_SCOPE.event_trivial='all'`（全域拦，C184b 快狗案「类型不合全域拦」同判——主体著名度不构成豁免，主体维度与事件维度正交）+`BLOCK_LABELS`「事件意义太小」；argmax 门自动接入（`blockChoice!=='none' && noneProb<0.5`），拦截消费点零改动；旧缓存行无该桶键 fail-open 零翻转。审计键走既有 `jev.blockChoice/blockChoiceProbability`。
  - **不加豁免臂**：图证在场救不了事件小（C114 豁免臂只挂 empty_content）；registry/J1.58 反锚已进题面由 Jev 判；pubProxy 不适用（发布者代理豁免管名互斥类，与事件大小无关）。
- **测试**：`_test_event_trivial_gate.cjs` 18 断言（A 题面 5：五桶/黄仁勋例证/看一眼就划过/四反锚/empty 划界；B 集成 9：BLACKBELT 现场复刻 D+strong_fit 救不了→low、blockChoice 审计、none 0.81 放行、旧行 fail-open、E/W/B/D 全域、none≥0.5 不拦；C 源码 4：BLOCK_SCOPE/LABELS/C191 接棒注释/版本 J1.127）；question_consolidation A8 桶数锁 4→5+新桶正查、A10d/angle C5/name_entity D5 版本断言 bump J1.127；批次全绿（90+47+47+18+17+16+106+34 全 0 fail）。
- **观察点**：①C191 币安传奇票 `0x5971dbed27e5ac8f278546c0a7d21f1b2b397777` 重析——语料是 BNB 历程视频+CZ 点名（圈内符号级人物语料），若 Jev 走反锚①不落 trivial 仍 high=设计内（圈内事件可玩性高）；若落 trivial 翻 low → C191「不修」裁定需用户复核（台账已预告该依赖）；②圈外名人**实质大事件**误拦风险（黄仁勋如果宣布收购/重大产品发布=有分量事件，反锚③罩住，掷骰留观察）；③下轮全量回归盯 event_trivial 误拦面。

### C230 Web3 项目分类/主体归属/发布者影响力资格轴（AIFLY 案，2026-10-25 用户裁定三轮+追裁，J1.125/J1.126）★

（编号跳段：C196 已被 PHP 观察票占用、C197-C229 为 C180 批回归集观察票编号段，本案取 C230。）

- **案发**：AIFLY `0x0baecc80613610f8c6051e55c136505a47507777`（AI bSTONK Fly，four.meme）引擎误判 **high 75.3**（J1.121）。取证：IPFS meta name="AI bSTONK Fly"、website=bstonkfly.vercel.app（纯 DEMO 玩具页**无 CA**）、twitter=@StockCZ 宣告推与 token 创建相隔 **32 秒**（creator 0xd0be17b3…）=**项目方自发币**；@StockCZ **18 粉零影响力**。命中用户三段判准第三段（应 low）。
- **三个漏点**：① **分类/主体归属**：18 粉+0 互动被 tweet-type-classifier（纯代码预分类）判 angle_seeking → 分类题「Subject attribution: angle-seeking → 主体=被借势原始事件」规则错位 → **C 0.56 压过 W 0.33**；② **fit/tier**：strong_fit 0.67 与 C175「无名作者一句口号不是事件」分量锚冲突（Jev 层未吃透），tier=fit 派生 A 档；③ **质量门差线**：impact argmax=empty_content 0.48<0.5 且图证豁免在场（C191「impact none 桶零消费」观察点又一例）。
- **用户裁定三轮（2026-10-25）**：①「这个代币肯定是应该属于 W 类……分类当前最大的功能就是把 Web3 项目识别出来，因为只有这一路走 bsc_meme_user_acceptance_and_impact」+分类题英文检查（结论：P2 英文化=迁移期校准手段非裁定，主体已全中文，题面中文重写）；② 走 W 类后该臂需判发布者影响力，题名改 **bsc_meme_user_acceptance_and_impact**（C183 bsc_meme_user_* 命名惯例）；③ angle_seeking 判定修正——找角度=第三方视角借势与项目无关的外部事件；「单纯提及一个项目=视为项目的 dev，这个 dev 必须有一定影响力」。
- **判准（三段，题面资格轴原文锚）**：① 项目方自己发的币（web3 原生项目一路）需要提供地址（CA）背书；② 纯第三方发币/陈述，发布者至少是有一定影响力的正常用户（**股城 C133 先例原型**：官宣+官方号+社区转述）；③ 发布者全无影响力+项目不提供地址 → weak（W 数学 15<32 恒 low）。**〔2026-10-26 C232/J1.128 追裁修正：第②段「第三方陈述者须有影响力」臂撤销——该臂只适用 dev 视角（介绍「XX项目是什么」无第三方主语）；第三方视角（「XX 做了什么」主体=XX）不看陈述者影响力按主体自身分量评，NMS 纳斯达克案触发，详见 C232〕**
- **机制（J1.125）三件**：
  - **① event_category 中文重写 + W 强化 + 主体归属修正**：W 判据扩「不要求机构背景或协议级基础设施，个人/小团队自发项目与第三方陈述的项目同样归本类」（crypto 语境项目：AI×crypto 实验/交易终端/DeFi/工具）；主体归属新增段——项目陈述推主体=项目本身→W（第一人称/单纯提及=dev 自发宣告；明确说「XX 做了」=第三方陈述），「找角度/借势」不适用于项目陈述推（借势**与该项目无关**的外部事件才是找角度），低粉低互动作者宣告自己项目≠找角度；C 判据加反锚「宣告/陈述 crypto 项目本身归 W 不归本类」。
  - **② w_bsc_user_appeal 键名断代 → `bsc_meme_user_web3_project_acceptance_and_impact` + 资格轴**：题面复合两轴先判资格——dev 自发币须 CA 背书（语料/官网/元数据任一处）否则 dev 须有影响力；第三方陈述者须有影响力；全无影响力+无地址 → **直接判 weak**。桶 id（weak/moderate/strong）/分值 15/47/66/pass 线 32 全不变（零存量翻转）；mapper `q(answers, 新键, 旧键)` 归一读旧行、审计投影键 `w_bsc_user_appeal` 保留（跨版本前端/审计形状不变）、reason 文案改「BSC用户接纳度与影响力」（gateBlockReason 模板不动）。**J1.126 追裁两项（2026-10-25 用户裁定）**：(a) 键名再调整 `bsc_meme_user_acceptance_and_impact` → `bsc_meme_user_web3_project_acceptance_and_impact`（加 web3_project 域限定——该题仅 W 类评估；题面/桶/分值零改动，纯键名断代）；q() 归一读链=新键→`w_bsc_user_appeal` 旧键（J1.125 中间键 182 存活窗口仅 ~1h，重析即覆盖、评级终态缓存不重读 answers，**不设三级 fallback**）。(b) **资格轴第一锚改写**：正经 dev 自发币提供了 CA 背书的会走 **web3 原生项目路径（账号路径）** 评估，无需在本题陈述资格——落到本题的 dev 视角语料**一律按没有提供地址处理**（dev 须有影响力才过线；删除「CA 背书=资格过线」臂——标准路径 W 臂里的 dev 视角票=路由层未识别成 project 的漏检形状，默认无背书才对）。
  - **③ state-builder `tweet_type_note2`**：tweet_type 仅时效分桶不判事件主体（分类题主体归属修正的 state 侧同款声明，防 classifier 弱信号标签再污染主体判定）。
- **路由层残余（不修）**：detectIssuerSelfLaunch（品牌同一性 AIFLY/bSTONK↔StockCZ 不匹配）与 isProjectCoin（内容臂 CA 命中，官网无 CA）双漏检——项目型自发宣告走标准路径：主体归属修正后标准路径本身即可正确评 W 类（分类治本，路由豁免非必需）。
- **验证**：`_test_w_bsc_user_appeal` 36 断言（新增 G 区：新键 choice/score 双形状归一读、双键共存新键优先、审计投影、资格轴题面三锚、weak criteria「资格轴不合格」、state-builder note2、分类题锚）；存量同步 8 文件（product_entity A3c/finding_recap A10 英文锚词随中文重写、question_consolidation A10d/A11b、angle_timing C5、name_entity D5 版本断言、china_politics/entity_event_mismatch/web2_emotional_impact 版本断言放宽 ≥、**brand_hijack B1 存量漂移修正**：C194 第五桶 entity_event_mismatch 落地时漏更的四桶断言）；32 个 event_category 相关测试全绿。J1.126 批次：测试键名全量随改+版本断言 bump（w_bsc_user_appeal E1 ≥126、question_consolidation A10d 'J1.126'、angle_timing C5/name_entity D5 严格等同步），36+90+47+47+题集批次全绿。
- **预期对拍（待 182 部署定向重析）**：AIFLY → 主体=项目/W 类 → 资格轴 18 粉 dev+无 CA → weak 15<32 → **low**；股城 C133 `0xaacbc156435dbab7815a61bccba1c827e52a7777` → 稳定 W 类（原 A/A/A/C 掷骰消解）+有运营传播资格过线 → mid/high 兼容 expect。全量回归需用户同意后跑。

### C195 零语料臂补轮节奏收紧 60s×8 → 10s×10（感染者案，2026-10-25 用户裁定）★

- **案发**：感染者 `0xac823d9b973574210a3322804182e3b599e67777`（flap 税币，creator `0x904974…4c06` 批量连发簇之一）。11:07:27 token 创建同秒触发 R1，此刻 meta 只有 IPFS 描述、宣告推/GMGN link 未到（corpusEmpty）→ Jev 仅靠名字+知识库匹配评 low；**宣告推 `@agentganranzhe/status/2114312327076184250` 11:08:00 才由语料补采拿到**（晚 33s），但 noCorpus 臂固定 60s 节奏等满 → 11:08:38 才 R2，W 类吸引力 47（pass 32）翻 mid → 11:08:54 成交 @12.26e-06；R1 完成时刻价 ~6.8e-06=**晚 87s 贵 ~80%**，11:10 卖 6.84e-06 **-44.2%** 出局。语料到位后 retry 白等 38s 是主因。
- **裁定（用户原话语义）**：完成一次分析失败后等 10s 即下一轮、每 token 最多 10 次 → `noCorpusIntervalMs` 缺省 60000→10000、`noCorpusMaxAnalyses` 8→10（缺省值改在 FA `_NARRATIVE_FACTOR_DEFAULTS` 单一真相源，引擎/CLAUDE.md/单测同步）。
- **代价（明示 trade-off）**：总覆盖窗 480s→100s，C162 立门时「宣告推晚 4min」正案形状不再覆盖；单 token 真跑上限 +2 轮（Jev 配额微增）。实验级 `fourmemeWs.narrativeRetry.noCorpus*` 显式覆盖仍优先（键覆盖语义不变）；accountOnly 臂（intervalMs 10000/maxAnalyses 3）不动。
- **验证**：`_test_fa_narrative_factors` E5/H1-H3 断言更新至新值（10s 边界含等/上限 10）、H4 反证文案同步；`_test_narrative_retry_config` 新增 E4 FA 字面量锁定（10000/10）+E1/E2 文案；`_test_narrative_trigger_condition` 47、`_test_jev_regional_binance_anchor` 29 全绿。
- **生效条件**：缺省在引擎构造读取——**在跑实验须重启进程才生效**（live v37 重启前按规程核持仓）。

### C194 实体-事件影响力脱节——实体题第 5 桶 entity_event_mismatch（2026-10-25 用户裁定，J1.124）★

- **案发**：同 C193 齐天大圣 `0x4a6a6c8b3c15eb8422ad7b95c5c6280ed68d7777`。C193 情感臂已把它压到 low，但用户追加指出另一条更本质的轴：「齐天大圣是中国非常著名的超级 IP，但是这个事件影响力明显不大。这样就是代币 IP 很大，事件本身影响力极小，两者脱节，事件明显支撑不起这个代币，这种情况需要据掉」。
- **机制（J1.124）**：`bsc_meme_user_name_entity_acceptance` 新增第 5 桶 `entity_event_mismatch`（拦截位）——**双轴脱节判据**：①实体量级极大（全国级/世界级知名符号、公认超级 IP，在 BSC meme 用户认知里地位很高）∧ ②事件本身影响力极小（单个普通博主/账号的局部行为、单一平台小热点、无多方参与、无持续传播、无官方或大范围响应）→ 选本项。反向边界：事件有足够分量（官方发布/多方参与/大范围传播/全民讨论/持续发酵成社会现象）=不脱节按类型轴正常评；实体量级本身不大（普通词/小 IP/自创角色）=不适用本项。与类型轴正交：类型可接纳但事件撑不起→本项；类型不可接纳→unacceptable_type；指歪→wrong_entity。
- **mapper**：`entityEventMismatchBlock` 概率 **≥0.5 全域拦**（与 unacceptable_type/wrong_entity 同形状的概率门，对抗 argmax 跨 run 抖动）+ pubProxyActive 豁免（官方域名=产品落地，发布者指代票事件=官宣产品发布而非旁观小热点，C29 同源）；门链 ne → em → we 同层；审计 `nameEntityEventMismatchMass` 命中才落；旧缓存行无该桶→概率 0 fail-open 零翻转。
- **与 C193 并存**：C193=fit 层（Web2 旁观热点 → 至多 marginal，不选 strong_fit/fit）；C194=实体题层（大 IP + 小事件脱节 → 直接拦）。同一张齐天大圣两臂都命中；C194 更本质（看实体/事件量级匹配），C193 看口味契合。
- **与 C191 的关系（待观察）**：C191「币安传奇」（大 IP=BNB + 小事件=13k 粉账号转的视频，fit strong_fit 0.70 → high 77.34，用户 2026-10-25 早间裁定「不修」）在 C194 双轴下可能被本门翻面——需实际重析确认，若翻面则 C191 的「不修」裁定需要用户复核。
- **验证**：新单测 `_test_entity_event_mismatch` 16 断言（题面五桶/双轴锚/0.6 拦/0.49 边界/旧行 fail-open/E-W-B 全域/审计键/门链顺序/pubProxy 接线）；存量 `_test_name_entity_acceptance` 47、`_test_jev_question_consolidation` 90（A6/A6b 四桶→五桶断言同步）、`_test_jev_product_entity` 38、`_test_bluechip_dedup_gate` 54、`_test_web3_fit_anchor` 27、`_test_china_politics_gate` 16、`_test_web2_emotional_impact` 11、`_test_angle_timing_override` 47 全绿。
- **影响面（J1.124 全量回归 98P/3F/2O/0ERR，对比 J1.123 95P/6F/2O）**：C194 命中 **1 张**——C80 蝙蝠侠摇（`entity_event_mismatch 71%`，大 IP + 小事件典型）基线 low→low **PASS**（拦截理由切换为实体-事件脱节，结果不变）；**零误伤**。中国政治门本轮命中 0 次；上一轮 4 张 FAIL（京小安/小黑/DND/BINA/股城）本轮全部 PASS=确认掷骰。3F 全为已知分歧票：C193 流浪小狗（词句门独杀观察票，0.79）、C210 C（用户 10-24 裁定 low、机制不动）、C212 Bot（同）——均与本次改动无关。
- **门序调整（2026-10-25 用户裁定「可以挪」）**：C194 门从实体段（ne→we 之间）迁到 **fit 概率门之前**（cp→em→w3 顺序）——资格层面的脱节先于口味概率门，label 归属更准：齐天大圣类票不再被「契合证据不足」抢先，真实理由显示为实体/事件量级脱节。结果不变（两门都拦），只改归因；pubProxy 豁免随迁。

### C193 Web2 旁观热点情感冲击臂——至多 marginal（2026-10-25 用户裁定「那就这样」，J1.123）★

- **案发**：`0x4a6a6c8b3c15eb8422ad7b95c5c6280ed68d7777`「齐天大圣」2026-10-25 05:05 UTC **high 88.88**（E 类 0.84 / fit **strong_fit 0.78** / impact none 0.64 / 实体 accepted 1.0，J1.121）。语料=@DveBNB（1 粉）搬运「抖音博主用树枝搭了一个齐天大圣主题游乐园，门口的巨型齐天大圣特别帅，不到一天七十万点赞，还在发酵！现在博主还在直播，后面肯定很多人会去打卡」。
- **用户裁定**：「对 BSC Meme 币用户，没有感情冲击力。因为是一件 Web2 的事情，缺少感情冲击力，哪怕有个形象，也不够。可以在 bsc_meme_user_event_fit 增加一臂试试，但是不知道这一臂会影响多少 case，可以帮我跑一下」。
- **机制（J1.123）**：`bsc_meme_user_event_fit` 加 C193 判据臂——Web2 圈外平台（抖音/快手/微博/小红书）的**旁观式热点**（博主做了个东西/才艺/造景/打卡），无情感冲击（不引发共情/感动/愤慨/纪念，也不提供可参与可二创的玩梗空间）→ **哪怕热度极高、有知名 IP 形象（齐天大圣）、持续发酵，至多 marginal（不选 strong_fit/fit）**。**不加桶**（marginal 档 + 既有 web3FitMassBlock sf+fit<0.5 执行拦截）；边界：C161 全球级可参与产品/网站/游戏/生成器不适用（那是可玩空间）、C160 公益救助/纪念情感路径不适用。
- **同批 C192b（中国政治门收窄）**：J1.122 首跑回归（94P/5F/4O）反证两张误拦——C94 京小安 `china_politics 0.61`（北京日报报道 AI 警犬产品）、C194 小黑 `0.54`（交警救助流浪狗 #中国故事，本属 C160 情感路径）；题面加边界：官媒/党政机构的**非政治内容**（产品发布/科技成果/萌宠/民生暖心）不选 china_politics，按事件本身评估；只拦政治议题/政治人物/政治事件/政治宣传内容与符号（学习强国官方 IP 征名仍拦）。
- **验证（定向重析三张）**：齐天大圣 high 88.88 → **low**（sf+fit 2%）；京小安 low → **high 80.38**（china_politics 0.01，C192b 生效）；小黑 low → **high 91.01**（C160 情感路径恢复）。
- **影响面（J1.123 全量回归 95P/6F/2O/0ERROR）**：**C193 零命中**——回归集无票 fit 概率被降档（DND strong_fit 0.57 / BINA 0.65 / 京小安 0.6 均未动），唯一实测效果=齐天大圣翻 low，影响面=精准打新票。6F 归因：C94 京小安=空洞门 empty_content 0.48 vs none 0.47 近 tie（C192b 已生效，空洞门接手，**待裁定**是否给「新闻转述+配图」形状豁免——vision 门 sufficient 跳过 vision 致 C114 图证豁免不触发）；C114 DND=category A/E/W 25/25/27 近 tie 落 W + W 总分 15<32（掷骰）；C162 BINA=关联题 unacceptable 5 分截断（掷骰）；C133 股城=W 15<32（J1.122 同形状）；C205 Maya/C212 Bot=既有意图分歧票（用户裁定留档）。
- **裁定结果（2026-10-25）**：用户「C193 那就这样」——保留题面 marginal 臂，不升级独立桶/不加代码门；影响面已确认可控。
- **部署**：J1.123 已 182 生效（worker 重启，05:50 UTC）。

### C192 中国政治主题否决——bsc_meme_user_event_fit 新增 china_politics 桶（2026-10-25 用户裁定，J1.122）★

- **案发**：`0x7f9fce00af76ac1c4cf5760f047e71b6852b7777`「强强国国」2026-10-25 05:19 UTC 分析 **mid 65.49**（event A 0.78 / impact none 0.71 / fit **strong_fit 0.43**·fit 0.2·marginal 0.17·unfit 0.2 / 实体 accepted 0.52，J1.121 标准路径；未成交：trades/signals 均 0）。语料=@Hugo_grupillo（177 粉）「学习强国最新IP 给了名字 并向全网征集形象创意 学习强国不用多说了吧」+ 配图——学习强国（中共中央宣传部出品的学习平台）官方 IP 的拟人化/征名，中国政治属性明确，Jev 因「IP 征集形象创意」给了 strong_fit。
- **用户裁定**：「BSC 链用户多是中文用户，而且中国政治方面非常敏感，跟中国政治相关的票，建议在 bsc_meme_user_event_fit 拦住。中国政治事件对 Web3 用户并非没有影响力，但是这种影响力绝大多数情况并不适合构建 meme 币。」——判据落在**第二层口味契合**（影响力存在≠适合做 meme），不进第一层 impact 门。
- **机制（J1.122）**：①题面 `bsc_meme_user_event_fit` 新增第 5 桶 `china_politics`（**独立否决项，不参与四档连续比较**；四档保留）——中国党政机构/官方宣传平台与符号（学习强国等）/中国领导人/中国国内政治事件政策会议/政治口号与政治表态；instructions 钉死「**本项不看玩味空间**」（形象征集/二创空间/正面情绪/官方 IP 化/可爱拟人不改变本判，C98 政治暴力臂同款写法）、港澳台同标、非中国政治（其它国家/国际关系）不选本项按四档评估。②mapper `chinaPoliticsBlock`：fit 题 **argmax choice** = china_politics → rating 1 确定性拦（不看 fit 概率；旧缓存行无该桶 fail-open 零翻转）；**无豁免链**（pubProxy/isW/binanceCorpus/platformOfficial 均不适用）。③门链挂位在 `web3UnfitBlock` 之前（主题类别否决先于概率门，label 归属更准）；审计 `jev.chinaPoliticsBlock` 命中才落。④加桶不加题（题集维持 10 题，C109 收敛纪律）。
- **验证**：新单测 `_test_china_politics_gate` 16 断言全绿（题面/集成/门序/无豁免/旧行 fail-open/源码口径）；受影响存量 12 项全绿（`_test_jev_product_entity` 38 / `_test_bluechip_dedup_gate` 54 / `_test_web3_fit_anchor` 27 / `_test_jev_resonance` 13 / `_test_empty_content_img_exempt` 34 / `_test_jev_finding_recap_statement_gate` 106 / `_test_angle_timing_override` 47 / `_test_name_image_consistency` 41 / `_test_unrated_elimination` 32 / `_test_narrative_signal_gate` 13 / `_test_jev_question_consolidation` 90 / `_test_name_entity_acceptance` 47；后三者版本精确断言同步 J1.122）。
- **残余面**：argmax 未判 china_politics 的票仍可能漏（如本票旧版 strong_fit 0.43 的黏性）——题面锚已钉死「不看玩味空间」，实际翻面待 182 重析该票验证；不设代码关键词兜底（避免「中国龙」类文化符号误伤，用户未裁定）。
- **部署与首跑回归（2026-10-25）**：182 pull + worker 重启（05:44 UTC）→ 重析本票翻 **low**（`china_politics` P=0.69）→ 全量回归 94P/5F/4O/0ERR。5F 中两张为本门误拦（C94 京小安 0.61 / C194 小黑 0.54）→ 题面加 C192b 边界收窄（官媒非政治内容不选本项，见 C193 条目），三张为掷骰/既有分歧票。收窄后复跑 95P/6F/2O，小黑恢复 high 91.01。
- **同批**：`web3_user_event_fit` 的键名引自用户原话 `bsc_meme_user_event_fit`（J1.112/C183 已断代——用户口径与当前键名一致）。

### C191 币安传奇——impact none 与 fit strong_fit 两轴打架、实体臂不看发布者影响力（2026-10-25，J1.121，不修）

（案号 C191 与回归集观察票 C191 撞号——本条为台账案号，沿用 C190 连续编号）

- **案发**：`0x5971dbed27e5ac8f278546c0a7d21f1b2b397777`「币安传奇」2026-10-25 02:31 评 **high 77.34**（E 类：事件 49.2=82×0.6 + 关联 15 acceptable + 质量 13.14），用户质疑「是口号且陈述者没啥影响力，为啥过了」。
- **语料事实（极薄）**：主推=@zhuifei008（13,286 粉）`@cz_binance 大表哥你看下这个视频非常燃😄`（15 赞 3 转）——即用户说的口号；父推=同作者自推 `从 0.1 美元到今天，BNB 走过了怎样的一段传奇？这条视频会带你看懂。`（307 赞/35 转/14.7 万浏览）；此外零语料（无网站/图证，twitter_info 0 条推文）。
- **归因（完整链）**：
  ① **Jev 内部两轴打架**：`bsc_meme_user_event_impact` argmax=**none 0.64**（对 BSC 用户无影响力——用户直觉 Jev 自己同意）vs `bsc_meme_user_event_fit` **strong_fit 0.70**；
  ② J1.79 事件分/tier 全由 fit 派生：(0.70+0.12)×100=82 → tier A；**impact 题 none 桶零消费点**（BLOCK_SCOPE 只吃 empty_content/ip_reuse/baseless 三桶，none=中性放行）——impact 题现为纯观察键，不决定量级也不拦截；
  ③ C181/J1.110 无名口号臂没接住：`event_empty_content` 只有 0.28（argmax 是 none）——主推依托「BNB 历程视频」=币外既成事实（finding_vs_recap=news_recap 0.94），不落 C175「无名作者一句口号不算事件」的空口径（C175b 成型叙事边界罩住）；
  ④ **知识库撞名注入放大**：`币安传奇` name_substring 双段撞名——「币安」撞 3 蓝筹（币安人/币安股票/币安蝴蝶）+「传奇」撞 2 quasi（bnb传奇 82.19 high、BNB的传奇之路 78.63 high），5 条命中 + C177 蓝筹家族偏好指引行（「叙事家族相近→契合度与规模给正向偏好」）整段进 prompt；
  ⑤ 词句题 `not_acceptable 0.54`（掷骰边缘，acceptable 0.41）但实体题 **accepted 0.68** → 词句门只评 not_entity 票，跳过（C139 设计内）；
  ⑥ 时效 within_7d、13k 粉过 direct_tweet 粉≥5000 臂全放行。
- **用户裁定（2026-10-25，不修——行为=设计内）**：「币安传奇看成是实体也对，而在实体臂其实是不看发布者影响力的，也确实有弱影响力发好内容起来的先例，先这样吧」——即：**影响力维度刻意不参与实体臂判定**（fit/事件分按事件本体评，发布者无名不削减），与 C94/C175「事件有币外分量时宣告者无名不减分量」一脉；「陈述者没影响力」不构成拦截理由。
- **遗留观察点（不修，攒批盯）**：① impact 题 none 高置信与 fit 派生 tier 的矛盾无仲裁位（77.34 仅高出线 2.34，全部来自该轴）——若后续出现同形状误放票再裁。**〔2026-10-26 已接棒：C231/J1.127 impact 题加 event_trivial 桶（BLACKBELT 黄仁勋名誉黑带案第二例落锤），「大 IP+小事件」形状现由该桶仲裁；本案票是否翻面待 C231 部署后重析（语料含 CZ 点名，若走圈内反锚仍 high=设计内）〕**；② C177 偏好指引在「语料只有自喊口号+纯 substring 撞名」场景的放大作用。**未收回归集**（无 expect 变化；防漂移需求出现时再收）。

### C190 实体题专名即实体锚——not_entity=「不是实体」边界收口（混混猫案，2026-10-24，J1.121，fa105c2）

（案号 C190 与回归集观察票 C190 撞号——本条为台账案号，沿用 C184-C189 台账系列连续编号）

- **案发**：C132 混混猫 `0xb10b2c022a717a66fa627c9c9ce73779b5347777` 词句门恢复后稳定翻面 low，用户裁定「不应该被拦，可以看看具体原因」→查因呈报：实体题判 not_entity 0.66（自创社区 mascot 名无词典收录）→ 落词句臂 → not_acceptable 0.64 贴阈拦（04:36 轮 0.95/复跑 0.64 方向稳定）；其余全高质量（fit strong_fit 0.78/S 档/时效③类豁免照常）；authorUtterance=true 不豁词句门。
- **用户裁定（边界纠正）**：「『混混猫』是自创社区 mascot 名，不映射任何已知实体/IP/品牌——这个不对，not_entity 是『不是实体』，这个情况也是实体名字呀，不应该因为这个理由拦截。这应该在评判标准中说清楚了，因为看的是性质，所以退役了 new_entity 门」——即 C184/J1.113 性质轴（新旧不是维度、退役 new_entity）的自然延伸：**「实体」判定看性质不看新旧/知名度/词典收录**；名字被用作特定主体的称谓/专名就是实体名，不该落 not_entity 中性桶再被词句臂拦。
- **缺口分析**：C174 故事主体锚有「须语料确实陈述命名行为/讲过故事」逃逸门——本案语料只有称谓使用（官方 recap 以「混混猫社区」称呼+宣布社区开聊），没有给 mascot 起名/讲它的故事的行为，锚救不到；泛称词蹭名票防线（逃逸门初衷）与「称谓在场即实体」新入口需要划界。
- **实施（J1.121，题面三处+mapper 零改动）**：①实体题 instructions ⚠️ 新增「专名即实体」段：名字被用作特定主体的称谓/专名（社区名/mascot/吉祥物名/角色名/外号/组织名——「XX社区」「XX家族」式专名搭配在场、官方以该名运营社区/形象）→ 映射该主体按类型轴评，**无论自创还是已知、无论知名与否、无论语料是否讲过它的故事/是否陈述命名行为**（称谓在场使用即可）；「实体」不要求已存在/知名/词典收录；自创 mascot/社区形象=可玩梗具象角色类型可接纳即 accepted；not_entity 只留给名字本身不映射任何主体的形状（泛称普通词无专名化搭配+无 C174 命名故事陈述，逃逸门原判保留）。②accepted 桶补「被用作特定主体称谓的自创专名」臂；③not_entity 桶补称谓反锚（混混猫=自创社区 mascot 专名不落本项）。
- **对拍**：C132 定向重析（182，worker 2545982 J1.121）→ **high 91.72**（事件分 57.6+关联 exact_match 20+质量 14.12）实体臂 accepted 放行，词句臂不再触达——expect mid/high 内自然 PASS；正样本回归攒批待下轮全量。
- **单测**：nea D5 版本断言 J1.121+锚句三断言（instructions ⚠️ 段/accepted 臂/not_entity 反锚）；consolidation A10d、angle C5 常量断言同步；14 个 mapper/questions 消费方单测全绿（47+106+34+20+9+22+30+54+30+27+41+47+17+43 全 0 fail）。
- **观察点（下轮全量回归盯）**：专名即实体锚的放宽面=裸泛称词票（「树/猫/橙子」类）是否有专名化搭配被误认——C174 逃逸门反锚仍在，理论分界=有无「XX社区/XX家族」式专名搭配，掷骰风险留观察。



### C189 词句门恢复拦截（C96 币安上电视追裁）+ 事件承载臂重要度门槛 + ip_reuse 原生热点锚——103 票全量回归六裁定批（2026-10-24，J1.120，2fa48bc）

（案号 C189 与回归集观察票 C189 撞号——本条为台账案号，沿用 C184-C188 台账系列连续编号）

- **背景**：C188 批后全量回归 103 票（03:51 存档 90P/9F/4O/0E）呈报，用户六项裁定（2026-10-24）。本条收裁定 1/2/6 三项实施+4/5 查证留档，3（C167 梗王大乱斗接受判不对）明确不改。
- **裁定 2（词句门恢复拦截，核心）**：C96 币安上电视 `0xc6d089d749409f7646de440d637ac9db0e047777` 用户原话「应该是先走实体门，然后走 phrase 门，因为币安上电视不是实体，是陈述，既然是陈述就属于口号类。所以要不被实体拒绝，要不应该被口号拒绝，这个是 low，不能改」——推翻 C188/J1.118「事件陈述归实体门域」的中性放行语义：**实体臂判 not_entity 后落词句臂按三因素评**，不是交评分层。mapper 门链 uaBlock 臂恢复（weBlock 后量级门前；形状=8d63253 前史：全域无豁免，五腿不豁、pubProxy 不豁）；C180 拆臂的两个病灶已根治才敢恢复——判据混杂→C187 三因素（J1.116-J1.119）理顺；越权拦实体票→函数内实体臂优先路由 gate（entityChoice!=='not_entity' → null）。**unknown 臂维持退役不动**（C184 类型门独立存续）。追加裁定：「如果要走『一个重大事件促生了一个口号』这条路（跟中国人能飞类似），那么事件的重要度明显不够的」→ **事件承载臂补重要度门槛**（题面锚：民族级/全球级重大事件（航天发射/国家级胜利）才够格；平台级/媒体级露出（上电视/上热搜/上了新闻/平台公告）不构成来由；对照=中国人能飞箭体五大字=民族级、币安上电视=媒体级露出且喊出者非币安本人）。
- **裁定 1（ip_reuse 原生热点锚）**：C129 彪弟 `0x3b5c3271fb581e503389dd2c52a75065f36f7777` 回归 low（IP低质复用 误掷）用户裁定「低质复用明显不合适，请检查Prompt」→ token_ip_reuse 补**原生热点锚**：原生热点梗/人物/事件主体自身的代币化（名字直接取自热点主体、热点事件在场、语料可证）=meme 币正常叙事参与**不选本项**，蹭名/契合/传播由关联题/fit 题/量级题正常评估；本项只管同一 IP **反复换皮/多处收割**的复用形状（无新事件依托的重复发币）；分界=有无新的事件依托。重析实测：high 83.32（event:A 46.8+关联 20+质量 16.52）✓ mid|high 意图达成。
- **裁定 6**：C220 功夫小猫 `0xc2765441c4dc724f60ec92c2e3e5b83868c27777` 「high 也可以」→ fixtures expect 双收 [low,high]（实体类型门 49% 贴线两可域，手编双值——--update-expect 只写单值）。
- **裁定 4 查证（股城 GMGN 缺口，未实施待裁）**：C133 股城 `0xaacbc156435dbab7815a61bccba1c827e52a7777` 用户问「GMGN 上有语料的，没有取到吗？」——实证=**GMGN 有语料**（182 实调 GMGN API：twitter_username="MEJ50749/status/2112469093156630545" 推文 URL 在场）但正常链路取不到：`enrichSocialByGmgn` 仅 no_public_info 重试域传 true，而股城语料全空被 C77 搜索兜底救活（searchEvidence 非空旁路 no_public_info）→ GMGN 补源永不触发。即 C77 兜底与 GMGN 补源存在**覆盖空洞**（兜底救活≠语料完整，GMGN 的语料增量进不来）。修复选项（弱语料票也走 GMGN 补源 vs 不改）待用户裁定。
- **裁定 5**：C211 No `0xd139d3b905468f544e75abca1a1a7b0376867777` 「关联门需要加强，确实也比较边缘化，主要是我不认为用户能接纳这个关联，如果处理不好可以先算了，预期结果不要改」——expect 维持 low 不动；词句门恢复后重析 low（not_acceptable 0.59）=自然 PASS，机制零改动。关联题判轴强化留档（C109c 关联掷骰家族第六例方向证据）。
- **实施**：J1.120 四处题面（词句题首段陈述句=口号类+①事件承载臂重要度门槛+划界段重写+对照锚补币安上电视不能接纳）+ip_reuse 原生热点锚；七单测文件 C180 退役反证翻回拦截形状（nea E5/E6/D10、statement_gate C/C0/C2/D1/D3/D4/D7/D8/G1b/G2/G4/A14/F2/F3、notable B5、empty_content D1、depicts F1、consolidation A12c/A12d、referent B1）+三处版本断言 J1.119→J1.120；referent A3 顺手修 C187 漏更的陈旧措辞断言；28 个 mapper/questions 消费方单测全绿。部署=2fa48bc push→182 pull→worker 重启（PID 2524825 单实例确认）。
- **全量回归终态（04:36 存档 91P/8F/4O/0E）**：裁定票全部落位——C96 low 词句门拦 ✓「不能改」达成、C129 high ✓、C205 Maya low 词句门 ✓（用户意图 low 自然达成，机制未动）、C211 low ✓、C220 high 91.61 双收内 ✓；C109c/C167 掷骰回正。**新增稳定翻面 6 张=词句门恢复的代价面（全部定向复跑确认稳定非掷骰，待用户裁定）**：C132 混混猫（not_acceptable 0.95 高置信）`0xb10b2c022a717a66fa627c9c9ce73779b5347777`、C201 罗马 `0x4c981997877a34d3bea50e5d4ee385c51af77777`、C202 砖 `0x08d3e05347b939474f714c360ab75a96da047777`、C206 未来 `0x949f21b0f64194472146c3fa14415a4d82a07777`、C219 🌮🦆🎩 `0x9714e14b046aebc11aef79d1f5d9a0dbe167ffff`（**当日早前用户曾裁「C219 high 维持」**——词句门恢复与之冲突，呈报最高优先）均词句门拦；C162 BINA `0x3384960b045905cea62da32ac5679177ee647777` 关联性不足 Stage3 截断（score 87 仍拦，关联题 unacceptable 稳定非掷骰）。正样本零漂移：DND high 81.22、こんにちは high 87.79（词句门恢复+重要度门槛对正样本无损）。
- **事故留档（C96 token_narrative 行外部删除）**：04:31 直跑 C96 重析报「代币不存在」（experiment_tokens 与 token_narrative 双空，DB 实查确认）；03:51 回归备份证明行在场、04:33 仍空、04:36 回归又能全量分析（行回归）——**03:55-04:36 窗口内行被外部删除又恢复**（本仓库无任何删 token_narrative 行的代码路径，全仓 grep 确认；疑并行会话或人工直连 DB 操作，删除者待确认）。C96 的 mapper 行为验证由单测 D1-D4 事故快照锁定不受影响。
- **翻面票终裁（2026-10-24 用户裁定，词句门恢复代价面验收）**：六张稳定翻面逐张呈报后——①C219 🌮🦆🎩 **「low 就更好了」推翻 2026-10-23「high 维持」**（词句门恢复后纯 emoji 组合名字形态不过三因素③，与用户前日「名字太难传播」体感一致收敛）→ expect 收紧 low；②C201 罗马/C202 砖/C206 未来 **被拦可接受** → expect 收紧 low（三张均为币安广场 KOL 评选/挖角长文票 fit 高但词句名不过三因素，验收=词句门对长文 recap 类票名的固有拦截面）；③**C132 混混猫 `0xb10b2c022a717a66fa627c9c9ce73779b5347777` 「不应该被拦，看看具体原因」**——expect 维持 mid/high 不动（FAIL 留信号），原因查明：实体题 not_entity 0.66（自创社区 mascot 名非实体）→ 落词句臂 → `bsc_meme_user_not_acceptable 0.64`（04:36 回归轮 0.95，复跑 0.64=贴阈但方向稳定）拦；其余全高质量（fit strong_fit 0.78/S 档/timing within_30d 0.96 豁免/C132 案③类时效豁免照常）；`authorUtterance=true`（four_meme_Fora 23917 粉官方 recap 里 $混混猫 逐字在场=J1.56 作者原话票形状）但词句门 C189 恢复形状全域无豁免不豁作者原话票——**暴露的判据缺口=Jev 对「无词典收录的自创具象角色名」（XX猫式形象构词）按字面判无来由**，与 C180 审计拆臂依据之一的「具象名误拦」（流浪小狗/中国熊）同族；修复方向待用户裁定（题面形象构词锚/作者原话票豁免臂/暂不改观察）；④C162 BINA 未逐张表态（关联性不足 Stage3 截断，关联臂非词句臂）——expect high 不动留观察（C109c 关联掷骰家族证据链）。

### C188 C187 对拍追裁三连——事件陈述臂退役归实体门（J1.118）+①有来由来由扩展（J1.119）+中国人能飞样本

- **裁定①（事件陈述归实体门，J1.118 bbd5c43）**：用户原话「『币安上电视』这个 case，是一个具体的事件，所以走实体门才对的」——事件陈述名（币名主谓重述事件）=具体事件形状，归实体门域：实体题判 not_entity 中性放行，事件分量/关联/时效由评分层判，**词句题不先验拦事件陈述**（not_acceptable 臂「事件陈述（X 上电视/X 破产）无独立 meme 载体同拦」佐证删除+对照锚反锚删除+A14 断言改退役反证防复活）。C96 案旧拦截语义（事件冷了名字就死）退役——生死交评分层。
- **裁定②（①有来由补事件承载臂，J1.119）**：用户原话「『有来由』如果是影响力巨大/情感触动极强的事件为基础也可以，例如这个中国人能飞」——词句承载自**影响力巨大或情感触动极强的事件本身**（口号/宣言就在事件中、是事件的组成部分：中国航天发射箭体上拼出「中国人能飞」五个大字，民族自豪极强，无需谁单独喊出）→ ①来由满足。补为①第三臂。
- **中国人能飞样本 `0x108876c3df3d893350e9b780563b3697aa3e7777`（flap 盘，用户「非常好的币，口号就在事件中」）**：现状=2026-10-01 旧缓存行被**已死的截词门**拦 low（blockReason=「截词（非超级IP话中词）」，J1.4x 时代），之后从未重析。**重析断点**：experiment_tokens 行已随旧实验删除（级联）+wss_events 无 token_create（flap 票仅 token_quote_set）→ fetchTokenData 返回 null「代币不存在」；token_narrative 旧行语料尚在（twitter 社区 binanciens bsc+website binanciensbsc.lol）。**裁定（2026-10-24）**：用户「是蓝筹币，可以走蓝筹币链路，并且如果蓝筹币没收录要收录的」——蓝筹侧收口如上；追裁「那就1呗」= **fetchTokenData token_narrative 旧行回退已实施**（0 行→全局表身份列 token_symbol/platform/blockchain+raw_api_data 快照撑重析，created_at 锚同主路径序 raw→wss_events→null 不冒充墙钟；两层全空才报「代币不存在」；回退只读身份列不碰分析结果列；单测 `_test_token_info_narrative_fallback` 13 断言）——顺带修复全部「experiment_tokens 已级联删」历史票的重析能力。**重析实测（182，d205aef）**：跑通→mid（web3_native_ip_early：twitter 语料=社区 binanciens bsc 972 成员+官网 binanciensbsc.lol 地址验证过→项目币/社区路径 prestage 3 题定档；知识库 address_exact 自命中+flying tesla roadster 等 name_substring 姊妹命中、偏好指引在场）；旧死截词门 low 已覆盖。注：prestage 终态形状不吃 J1.119 词句题（那是标准路径题集）——事件承载臂对这票语料形状不参与，故事由知识库+社区基本面承载。实况=builder 生成件 bluechips.json **已在册**（ATH $10,513,973 远超 $1M 蓝筹线、renowned24h 榜 48，2026-10-22 入册），但叙事字段是占位垃圾「本系统评 low」+rating low（builder 从 token_narrative 死截词门旧行富化，isPlaceholderNarrative 判据认得但 --enrich-desc 未跑到）→ **manual-entries.json 最高覆盖权补录修条目**（19175bb：叙事=箭体五大字事件承载口号全档+rating 置 null 清误导、ATH/ranks/twitter 原样保留；防 builder 周级重建冲掉=手工补录一律走 manual 惯例）；182 已 pull，知识文件 mtime 热载免重启 worker，合并验证 manual 生效。效果：后续航天/民族情感家族姐妹票命中（name_substring/corpus_contains）即带真叙事入 [KNOWLEDGE_BASE]+C177 蓝筹偏好指引；名 exact 撞「中国人能飞火箭」由 C168 蓝筹去重门接管。
- **部署事故（顺手修）**：J1.118 重启时 kill 只杀一个旧 worker 致**双 worker 并行**（2457245+2461808），发现后杀旧留单实例；J1.119 重启 kill 旧再起（2463683 单实例确认）。
- **J1.118/J1.119 重析终态（三票）**：币安上电视 high 88.4——实体题 not_entity 96% 中性放行、评级走评分层（fit 90/关联 68）=「走实体门」生效；词句题观察面 not_acceptable 100%→86%（事件陈述佐证删除后 Jev 惯性仍判弱，纯观察不拦截，留观察）；DND acceptable 97% 防漂移 ✓；こんにちは acceptable 77%（J1.117 修复稳定）。

### C187 词句题三因素重构——梗/口号 meme 的接纳判据理顺（J1.116）

- **裁定（2026-10-24，用户原话）**：「当前我们判断的是『币名是不是 BSC 链用户能接受的 meme 币名字』，但应该是：1. 事件是非常具体的事件 → 走实体题（事件核心实体作名）；2. 事件是『谁谁说了一个梗、一个口号』→ ①喊口号的人必须具备强影响力（否则代币完全无来由，普通用户喊的口号恐怕不行）②口号本身要有感染力（『you are still early』有感染力、『我要去滑雪』毫无感染力）③名字可以被接纳为 meme 币名字（原主要判断逻辑）。梗 meme 不同于其它，不是只判 token 层面，要综合更广泛因素——本质仍是 BSC 链用户能不能接纳它作为一个 meme 币。」追裁①：「CRO 对照锚删掉——Chief Risk Officer 是玩梗呢，可以接受」（C114 判例翻案）。追裁②（路由）：「某些人强调/提及/陈述了某一个实体（heyi.ai 是个域名、何一发了它）→ 走实体臂，实体臂不接受（判 not_entity）再过 phrase 臂」。
- **fix 的冲突与重复（题面级）**：①影响力两臂方向打架——J1.66/C126「高影响力主体说的词」当**加分臂** vs J1.80/C138 超IP来源极端否证**反向放宽**拦截（保护票），皆非「门槛」；新框架=①有来由门槛（普通用户喊的口号完全无来由，不能接纳）②J1.61 可玩臂与 C116 姿态臂重复判同一件事 → 并入②有感染力③原单一「名字形态」判据保留为③。J1.80 极端否证段+J1.94 官方措辞引用臂并入①（官方措辞=强影响力主体产出，采信陈述原则保留）；heyi.ai 形状在新逻辑①自然过门，不再需要反向放宽。
- **CRO 翻案**：C114「机构职位/品牌内部缩写不合格」半边退役（币安员工工牌 CHIEF RISK OFFICER=玩梗可接受），DND 正样本（通用梗缩写）保留、缩写分界句随之退役；防复活反证入 empty_content_img_exempt H5/H7。
- **路由确认**：具体事件→实体题（not_entity 才进本题，已有结构）；「强调/提及/陈述实体」（域名/代称/缩写指代形）→ 题面补路由句先实体臂、实体臂不接受才落本题、实体臂拦截不经过本题。
- **改动面（commit b259084）**：jev-questions.mjs 词句题 instructions/criteria 重写（三因素缺一不可+对照锚 Early/我要去滑雪/DND/只是一只猫/币安上电视）+J1.115→J1.116；**choice 三态键不动，mapper 零改动**（C180 后纯观察落档——本题重构暂不恢复拦截，恢复与否待对拍后裁定）。
- **单测**：七文件全绿——name_entity_acceptance 47P（D5 版本 J1.116）/empty_content_img_exempt 34P（H4-H7 CRO 翻案反证+H5/H7 切片=词句题题面本体防注释史实误伤）/jev_question_consolidation 90P（A10d 版本链）/angle_timing 47P（C5 版本链）/jev_finding_recap 106P（A7-A17 七断言适配三因素形态+A17 补实体臂路由句）/subject_carrier 30P/notable_other_exit 22P/jev_product_entity 38P。
- **对拍（定向重析，梗/口号家族八票，b259084 部署后）**：DND `0x4dbcb10e68626b6f663bd596905d41cdc6b07777` high 79.72 **acceptable 90%**（正样本保持）；C138 heyi.ai `0x1774c0cc851a777c89fb0e1d73712bc7564b7777` high 91.82——**实体臂优先路由生效**（实体题 accepted 50%，词句答案被 mapper not_entity gate 丢弃=观察残留）；C96 币安上电视 high 88.4 not_acceptable 100%（事件陈述臂，当日 C188 追裁退役见下）；C204 4人生 low 89 not_acceptable 57% 贴线（①来由方向对置信弱）；C217 中 high 87.47 not_acceptable 83%（与用户裁定 low 的意图同向）；C219 🌮🦆🎩 high 89.52 not_acceptable 67%（三 emoji 纯符号形态判弱——与用户「名字太难传播」体感一致，观察合理）；C196 PHP low not_acceptable 89%（实际拦截=类型门 73%）。**唯一翻面事故=こんにちは**（见 C188）。
- **对拍翻面事故（C126 正样本）→J1.117 修复（6477c5b）**：こんにちは `0xf0ffa405a08a3abd1de1b2d88fdec7cbd9f37777` 首轮 not_acceptable 95%——①臂列「问候」为主体词句形态 vs ②臂「日常礼貌套话」无感染力，**两臂打架**。修复=②臂回填 J1.66/J1.67 主体符号锚：「主体本人说出的问候/口头禅/情绪表达按模拟反应判——玩家会把它当**该主体的符号**拿来玩（C126 何一「こんにちは」）→有感染力；普通寒暄→无感染力」。用户裁定原话「用户还是接受的（何一回复CZ日本书发售事件，不算是一个礼貌客套回复，而是对日本用户群体喊话），但确实换个语境未必可以，如果不好修可以先这样」——修复语义与裁定吻合。重析终态：**not_acceptable 95%→acceptable 79%**（评级 high 87.19 保持）、DND acceptable 93% 防漂移 ✓。

### C186 image_depicts_name 演绎题「同域非演绎」反锚——ATM 案两臂打架（J1.115）

- **现场**：C228 ATM `0x209fefa087ba1b32ae9a5a628f6e26d743b77777`（第五批观察票待终裁票，重析 mid 54.1 过买线）。用户挑战「再进一步看一下感觉名字跟图里的名字不匹配，如果名字叫 圆芯侠 还好」→ 图证坐实：图内=中国银行数字人民币 IP「圆芯侠」（Yuan Xin Xia，白兔造型科技英雄，抖音帖截图，图内文字含完整 IP 介绍），币名=ATM 与图内实体名不匹配。
- **机制层两臂打架**：`name_image_consistency=unrelated 91%`（Jev 自判名字与图**不相关**）vs `image_depicts_name=depicts_name 70%`——C118 演绎臂（depicts≥0.5）豁免关联截断，关联题 unacceptable 93% 的明确判定被兜底，救到 mid 54.1=会真买。
- **归因（题面缝隙）**：三对照锚（DND 动作演绎→depicts / CRO 异域猫图→decorative / 香蕉实体同一→decorative）恰好漏掉「**同域但未画面化名字含义**」形状：ATM 是缩写，命中「概念名/抽象名重点」段正向鼓励，Jev 把银行吉祥物图当 ATM 金融含义的画面化——**域联想冒充演绎**。mapper 不能加「unrelated 高置信则演绎臂失效」：DND 正样本本身就是 unrelated+depicts 共存（题面明说两题独立），会误伤 C114/C118 形状。
- **修复（J1.115，用户裁定「修一下吧」）**：对照锚补第四锚——「名字 ATM 配银行吉祥物/数字人民币 IP 图 → decorative（图与名字同在金融域，但图没有画面化 ATM（自动取款）的含义、演的是数字人民币吉祥物——同域/同话题联想不等于演绎）」+ 分界句尾「同域联想（图与名字恰好同属一个领域/话题但名字含义本身未被画面化演出）判 decorative」。事故现场反证入题面（红线 13）。mapper 零改动（演绎臂判据不变）。
- **单测**：八个涉题文件全绿——consolidation 90P（A10d 版本链 J1.115）/name_entity_acceptance 47P（D5 版本）/angle_timing 47P（C5 版本链）/empty_content_img_exempt 34P/image_depicts_exempt 20P/image_carrier_nature 8P/jev_finding_recap 106P/subject_carrier 30P。
- **对拍（三票定向重析，2026-10-24 e1100a5 部署 worker 2426990 后）**：ATM 目标翻 low（depicts 降 → 演绎臂失效 → 关联 unacceptable 拦）；DND `0x4dbcb10e68626b6f663bd596905d41cdc6b07777`（C114/C118 双案票）保 depicts（猫拉窗帘=动作演绎正样本）；C205 Maya `0x1b420e70cef832de51a3556558958be5b4b57777` 防漂移（图内人物名命名路径）。**终态（全中预期）**：①ATM **mid 54.1→low 56**——`image_depicts_name: decorative 100%`（原 depicts_name 70%→0%，反锚直击事故形状），演绎臂失效；fixtures C228 收 low ②DND **high 81.43 保持**——关联题自判 exact_match 95% 满分不走演绎臂；⚠观察点：depicts 答案从正样本翻 decorative 85%=**反锚泛化迹象**（把「unrelated+有图」形状全抹向 decorative，DND 前文正锚未压住；评级零影响——DND 不靠演绎臂，但未来「真演绎+关联掷骰」票会失去兜底，攒批观察）③Maya **high 86.08 零漂移**（exact_match 74% 原路径）。

### C185 实体题题面精炼去重（J1.114）+ C180 批观察票逐张过票五批裁定 + binancezh 核心号 + 薄肌理论蓝筹补录（2026-10-23）


- **起因（用户指令）**：①「bsc_meme_user_name_entity_acceptance 的 instructions/criteria 内容太多了，精炼一下（最重要的是检查逻辑是否有重复/冲突，有的话调整）」②「不要一次展示一个，一次展示多个」③观察票逐张过票继续。
- **审查结论：无逻辑冲突**。七类逐字重复：类型清单三处（instructions 尾段/accepted 桶/unacceptable_type 桶）、「不评认知度」三处、C151 有意义变形三处、C174 故事主体三处、C175 性质定义三处、C162 交易池两处、J1.81 指歪两处。性质定义锚（京小安）与陈述句反锚（币安上电视）互为边界自洽；形象考量=加分项与类型轴兼容（C171 裁定）。
- **精炼（J1.114，commit 1e8e063）**：判据轴不变、各归单一宿主——类型清单归 instructions 尾段唯一、C151 归 wrong_entity 桶主锚+accepted 收录短句、C174 归 instructions 完整版（含逃逸门）+桶文短句、C175 性质定义归 instructions 完整版、C162 交易池归 wrong_entity 桶、J1.81 指歪归 instructions 一行区分句+wrong_entity 桶完整三形态。instructions 3100→1599 字。教训：D9 语义锚「即便句中提及著名实体也不因此 accepted」曾精炼丢失→补回（精炼必须逐锚过清单）。
- **对拍（九票，J1.113→J1.114）**：八票零翻转（Microsoft 98%/快狗 97%/TAIGAN 99% 类型门、DietCoke/浙商空洞门、行云 sf+fit、天狗 mid 65.08 bit 一致、恩恩崽 high 87.82 同档）；**唯一翻转=乐宝豆 `0x0a000d6f43de25855263d0ed218fdd0387c27777`** high 81.58→low（类型门 unacceptable_type 50% vs accepted 47% 贴线踩线）——用户裁定「low 能接受，预期三档均可」恢复全收；「机器人昵称」类型轴边缘语义留档。
- **观察票三批裁定（全部带地址收 fixtures）**：
  - 第三批（C188-C197）：C188 パルワールド `0xe51bcbae82c597574964c753e400b4cb0d107777` high（IP 实体票 fit 79/accepted 88%）；C192 奶龙理论 `0xff3e7b781855bf8624c363a8996278de94cb7777` high（用户留档关联疑虑：「奶龙理论」主推是体脂梗回复、关联 exact_match 64% 存疑但从用户视角可接受）；C193 流浪小狗 `0x6c79cc6086c495288b0e659f9f4eb410a59a7777`/C194 小黑 `0x6cb96c4fdf9829bb9eff35353f00c8045cbe7777` high（同主推姐妹票 S 级 93.59/95.44，C160 动物救助路径；同叙事涨幅核查=姐妹票均死票 1.0x，「狗」主题涨幅榜首=天狗 11.4x/赵长鹏的狗 4.7x high）；C195 中国熊 `0x66f0e87527931a4d9414dded1b8f3797d2417777` high（WatcherGuru 熊市快讯）；C197 宇宙行 `0x1f9f6b1411e06efb3edb9ebaeccee4754de77777` low（工行外号零事件 sf+fit 43%）；**C196 PHP `0x5f6de4cd7bd63d1033b2f8417cb640951f727777` 已裁 low（2026-10-24）**（主推=Flap 官方辟谣「Flap doesn't use PHP anywhere in our tech stack. Your funds are safe」，用户裁定原话「陈述的是对 PHP 的否认，也无法支撑 PHP 这个代币。我认为是 事件性质或事件代币关系的锅」→追裁修正「事件代币关系，不能是否定关系。fit 判 strong_fit 没问题，这事儿本身是对 web3 用户挺符合的」——锅单一归因=关联题 bsc_meme_user_name_event_acceptance：否认句判 exact_match 87% 虚高，否定关系不构成接纳关系；fit strong_fit 95% 维持正确；实际拦截=类型门 unacceptable_type 68% 兜住=结果对理由错位，机制不动留观察，观察点=关联题「否认性语料=反向证据」判据）。
  - 第四批（C198-C207）：C198 SUPERCOMPUTER `0x2ddcaac3fb078ee82dd02be2bd10212c30127777` low（类型门 70%；用户留档关联意见：超算是事件配角元素不能代表事件主体、关联 exact_match 76% 偏高——**事件配角元素命名关联判读观察点**）；C199 ヤギ `0xb31726097f9866f516423a9e5bf02df363637777` high（山羊除草话题新闻）；C200 大小姐 `0xd862061088c14a54b83d435ce1f44c3f074b7777` low（零事件）；C201 罗马 `0x4c981997877a34d3bea50e5d4ee385c51af77777`/C202 砖 `0x08d3e05347b939474f714c360ab75a96da047777` high（币安广场 KOL 评选官方长文姐妹票 S 级 94.45/94.21）；C203 姨妈巾 `0xe3bec71d099384dba6b4b4734903e35effa87777` low（卫生用品类型门 63%）；C204 4人生 `0x019fb31a221d6efb103ba35942702918abd37777` low（关联题三桶 35/33/32 平铺掷骰 unacceptable 拦、score 90 被卡=C109c 同款待裁问题，用户裁定 low 可接受）；C206 未来 `0x949f21b0f64194472146c3fa14415a4d82a07777` high（何一挖角长文；用户留档「相关度有点牵强但能接受」）；**C205 Maya `0x1b420e70cef832de51a3556558958be5b4b57777` 已裁**（用户裁定原话「拦起来有点麻烦，我觉得预期可以为 low，但是先不处理」：深挖结论=主推 @binance 主号零文本纯链接推、配图链式吐槽梗图，「Maya」是图内对话梗人物名，Jev 靠图证判关联 exact_match 75%/fit 77 → high 83.08——**图内人物名命名路径**引擎层拦不动，预期收 low 留档、机制不动）。
  - 第五批（C208-C229 = 词句门独杀·纯符号名八张 + 关联门重复拦截十四张，2026-10-23 重析呈报；十四张已裁、八张待裁）：
    - **C216-C229 十四张裁定（fixtures 已收紧 13 张，C228 待终裁）**：C216 `,` `0x2d58da00605bd3d2e8a4f5ab81cef2f7a4487777` low（用户裁定「low 没问题，但基于『关联度』不合适，语料中是提及了逗号的」——拦截臂归因存疑留观察、机制不动）；C217 `中` `0x241d8a0c687e5c901f47fcc3fa05d4def3257777` **low 翻案**（重析 high 87.08，用户裁定「『中』作为币的名字指代什么实体很模糊，无法被理解」→ 意图分歧票，回归 FAIL 属预期留档）；C218 pool `0x27f580ea584179d3b87ca4777c12d502f3deffff` low（「没问题」；score 98 高分被关联 unacceptable 贴线掷骰拦=C109c 掷骰**第四例**，@binance 链式梗图系列与 C205 同源）；C219 🌮🦆🎩 `0x9714e14b046aebc11aef79d1f5d9a0dbe167ffff` **high 维持**（TrustWallet 官方点名「3 emojis = 1 token」，用户裁定「喊口号的对象影响力不小，但是代币名字太难传播，这个 case 体感不太行，但是又想不好怎么拒绝，可以先这么着」——名字难传播无拒绝机制留观察）；C220 功夫小猫 `0xc2765441c4dc724f60ec92c2e3e5b83868c27777` low（「抖音链接是个小猫，可拦可不拦吧」；重析拦截位=实体类型门 unacceptable_type 54% 贴线=误拦嫌疑留观察）；C221 小象勇士 `0x28d57ff3d72b88cf0979c2fb4d50d9223d267777` low（「没问题」，关联 unacceptable 95% 明确拦=正确工作样本；与 C217 同主推=Flap 中行 wBANKCx 公告姐妹票）；C222 久留美 `0x33289c5c34c447cb21d5027bedfb2c19b6957777` low（空洞内容）；C223 福音 `0x3e1610a330dfa83f1e2bad12c011c85cc2d57777` low（事件分不足 30<60）；C224 BINA `0x3ba02d6155ac4492bee1e0f752f6b5cfa6337777` low（空洞内容）/C225 태리 `0x81d15edc685b29cf58dbe8ea4c7798e375197777` low（关联 unacceptable 47 分）/C226 한글 `0x0e4582f447f6f60b7b2ab5293cf0780b09457777` low（事件分不足 59<60 贴线）/C227 ジジ `0x2752ab658fc7973a420c971b0e6ae72916f77777` low（空洞）/C229 지지 `0x1e9ec2097922b21f028fc6d6e9866f76d8b37777` low（空洞）——后五张用户合列未附异议，按无异议收 low（重析均 low 无争议）。**C228 ATM `0x209fefa087ba1b32ae9a5a628f6e26d743b77777` 待终裁**：重析 mid 54.1（会真买）；用户「再进一步看一下感觉名字跟图里的名字不匹配，如果名字叫 圆芯侠 还好」→ 图证坐实：图内=中国银行数字人民币 IP「圆芯侠」（Yuan Xin Xia，白兔造型科技英雄，抖音帖截图），币名=ATM 与图内实体名不匹配；机制层 `name_image_consistency=unrelated 91%` 与 `image_depicts_name=depicts_name 70%` **两臂打架**，C118 演绎臂（depicts≥0.5）豁免关联截断救回——演绎臂与一致性题互斥时无校验。
    - **C208-C215 八张已裁（2026-10-24，低分五张未附异议按无异议收）**：C208 `1` `0x2c092d46e05b2d32ff5013ea1c41d8c8460677777` low（蓝筹去重撞 Ucan fix life in1day+空洞门 73%）；C209 `做` `0x138f7834f8a48e651fbe0424a242234d48727777` low（score 97 关联 47 vs 43 掷骰=C109c **第三例**）；C210 `C` `0xa959ce0dd0248df36df907667ee9a44c5d3b7777` **low 翻案**（用户裁定「事件撑不起代币——事件是普通的 crypto 事件，名字是 crypto 太大了；用户不应该接受事件/代币之间的联系」：关联题 exact_match 96% 虚高=「C」=Crypto **缩写首字母联想≠完整指代**——bsc_meme_user_name_event_acceptance 判据观察点、机制不动；重析 high 81.76=意图分歧票）；C211 `No` `0xd139d3b905468f544e75abca1a1a7b0376867777` low（score 96 掷骰=C109c **第二例**、词句 83% 同方向）；C212 `Bot` `0x2887546ae9524f8298884900ec135031d3cc7777` **low 翻案**（用户裁定「事件有点弱给 low 更合适——Grok 发推点名 @Bot 帮修信用评分；只是提出这个事的是马斯克，不太好处理，可以先放放」=机制不动；重析 high 84.34=意图分歧票）；C213 `here` `0x191108e1479938e83cd87c0d33b8af7d545c7777` **三档皆可维持全收**（用户裁定「可以接受 high，但是用户不接纳这个做 meme 币同样也正常」——expect 不收紧）；C214 `P@ssw0rd!` `0x14287dae87b3fb6a4545658c1aa7ac1ed8fb7777` low（空洞门 48% 贴线拦）；C215 `0x77` `0x064a0a233ccd631d5d79afb56cc88d7ab0347777` low（W 类 15<32）。
- **binancezh 核心号（C97 域扩展，用户裁定原话「binancezh 改为币安核心号，因为 BSC 多是中文用户」）**：GLOBAL_BINANCE_HANDLES 四键→五键（+binancezh），binancezh 语料不再锚 D；单测 29P（A 表加 binancezh 不锚臂+F2 五键源码断言）；CLAUDE.md C97 行同步。
- **薄肌理论蓝筹补录（用户裁定著名代币）**：`0x22dbe570df85c36515da1f244617123aebea7777` manual-entries b: 域条目（最高覆盖权，同熊猫头先例）；BSC DEX 票（PCS/Uniswap 双池非 four.meme 内盘，与奶龙同体脂梗系）；ATH≈719K USD（AVE 1h K 线 725 根窗口估算、8 月早期未覆盖已标注）。
- **提交链**：1e8e063（J1.114 精炼）→ b7f682a（第三批收紧+薄肌理论）→ 本批（第四批收紧+binancezh）。worker 2093117 已跑 J1.114；曾发生双跑（旧 2078763 kill 未死）已清理——ssh 单行 kill 变量展开时机坑。

### C184 实体题类型轴重构——unknown 断代 unacceptable_type + new_entity 删桶 + 实体类型门恢复拦截（J1.113）

- **背景**：C180 拆臂后用户逐张过观察票第三批（C183-C187 五张该拦票 + C189/C190/C191 三张该放票）后的裁定。五张该拦票（回归集观察票编号，非台账案号）：DietCoke `0x13acc80ee1802e4baac1b9165e9e047c009d7777`（accepted 0.64 掷骰放行）、快狗打车 `0x497ebe5c2ef7c3393c874a9e7ecde2cf1e027777`（unknown 0.61 拆臂后放行）、行云科技 `0x62cce4b6ee90c3d80181873c0e940402a66a7777`（unknown 0.87）、浙商银行 `0x52550b3628d5c4cac7408a186486f9e423087777`（unknown 0.63）、TAIGAN `0xbccb27a6a086517634423919dd9eec033e9c7777`（犬种学名，accepted 0.68）。三张该放票：天狗 `0xe9e82d1fa74283991dec5543453373ec836b7777`、恩恩崽 `0x3ddf95a0aafa3cfdc7bd336c7c30ab5f1f9d7777`、乐宝豆 `0x0a000d6f43de25855263d0ed218fdd0387c27777`。
- **用户裁定四轮递进（2026-10-23）**：
  1. 「这几个事件并非对用户群体无触动，只是事件中的实体（可乐，银行名字，狗的品种），也就是币的名字无法被接纳为 meme 币。但给出的拒绝理由 unknown 并不适合——问题在于实体的性质与类型才决定不能被 web3 用户接纳，并不应该以『接受度/影响力低』为理由拒绝，而是很直接的，作为 meme 币不被用户接纳（可乐，银行名字，狗的品种）。实体的类型/性质是判断的关键点」——题存在仍必要，判据换轴；「再深入的理顺与修改一下，可以用」=授权实施。
  2. 「我认为就不需要考虑『认知度』，因为已经有事件了，这个实体又与事件相关（关联度门），那么 bsc meme 用户就知晓了。所以并非认知度，就是看实体类型与性质」——认知度轴整体删除（推翻我最初「类型先决+符号性两问」设计，只留类型单轴）。
  3. 「所以也就不用评 new_entity」——new_entity 桶删除。
  4. 「性质没问题即可，是否新旧都没事」——五桶断代为四桶，新实体语义并入 accepted。
- **改动①（J1.113 题集，五桶→四桶）**：桶=accepted / **unacceptable_type**（全新桶：圈外商业品牌/消费品（可乐、快狗打车）、金融机构/银行（浙商银行）、动物品种/生物分类学名（犬种学名 TAIGAN）、严肃机构/组织/政府主体、事务性公司/工具产品——「判据=类型/性质不合，不是认知度；实体再著名也不改变类型不可接纳；新实体类型不合照样归本项」）/ wrong_entity / not_entity。instructions 尾段单一判据版：「只看实体的类型/性质能否被 BSC meme 币用户接纳为 meme 币名，不评认知度/知名度/影响力——事件已成立且实体与事件关联在场时，用户已知晓该实体（知晓由事件与关联度保证）；量级归量级门 effTier D/E 档；玩味/二创潜力归 name_entity_memeability」。锚迁移：C174 故事主体锚（TREE/BNB Tree）落点 new_entity→**accepted**（「不因名字字面是普通词判 not_entity」+逃逸门保留）；C151 有意义变形锚（哭哭奶龙/dogwifhat）同迁 accepted（「性质没问题即可，新旧不是维度」）；**J1.105/C175 性质定义锚保留**（京小安「首款AI警犬」——活锚与类型轴兼容，曾误删后补回）；C133「新实体≠无名实体」段删除。词句题三处引用同步（instructions 划界句/J1.57 划界/not_acceptable 桶内→「实体题 unacceptable_type 轴」）。
- **改动②（mapper 门恢复，C180 拆臂推翻）**：`nameEntityLowBlock`→`nameEntityTypeUnfitBlock`，判据 `probabilities?.unacceptable_type >= 0.5`，域 B/C/D/F/G/W 不变，**不归一读旧 unknown**（历史缓存行零翻转，重析后自然更新）；门链臂恢复于 weBlock 之前（`!pubProxyActive && neBlock != null`——pubProxyActive 豁免随拦截恢复，官方域名=具体产品落地 C29）；词句门 web3UserAcceptabilityBlock 维持 C180 退役纯观察。审计键断代：`nameEntityLowMass` 停产出（历史行保留展示），新键 `nameEntityTypeUnfitMass` 命中才落 mass。**new_entity 历史行兼容**：桶删除后旧缓存行 choice=new_entity 时词句门照跳过（`entityChoice !== 'not_entity'` 结构性兼容）；new_entity argmax 时概率和为 1 ⇒ unacceptable_type 必 <0.5 天然不触类型门。
- **门链序（C184 后）**：…web3UnfitBlock → web3FitMassBlock → impact veto（含 C114/C126 豁免）→ **neBlock（类型门恢复）** → weBlock（wrong_entity）→ 量级门 D/E → W 数学/标准数学。
- **单测（13 文件全绿）**：name_entity_acceptance 45P（C 段新真值表：六域 unacceptable_type 0.6 拦/旧 unknown 0.6 断代不拦/0.49 门槛/历史行 new_entity 0.62 不触门；D5 四桶断言）、subject_carrier 30P（D1 类型门+G4 门链序）、notable_other_exit 22P、jev_finding_recap 106P（A17 划界句新锚/G3b 断代零翻转）、jev_question_consolidation 90P（A6/A6c 四桶+类型轴锚）、brand_hijack 16P、angle_timing 47P（C5 版本链）、empty_content 34P、image_carrier 19P、massive_influence 9P、referent 51P、superip_slogan 52P（C5 断代零翻转）、superip_standard 20P。
- **验证锚点（用户指定八票）**：重析后五张该拦票（C183-C187）应被类型门或既有门拦；三张该放票（天狗 mid/恩恩崽 high/乐宝豆）不被挡。乐宝豆现无 token_narrative 行=首次重析。
- **部署+八票重析（2026-10-23，47fd43c/a004f58，worker PID 1923082）**：七票符合裁定——TAIGAN low（**实体类型门 unacceptable_type 97%=类型门首次生产命中**）、DietCoke/浙商 low（空洞内容门）、行云 low（web3FitMassBlock）、天狗 mid 65.08（cashtag W 47≥32）/恩恩崽 high 88.57/乐宝豆 high 81.58（首次重析）；fixtures 七票收紧（a004f58）。
- **C184b 快狗打车漏放案（`0x497ebe5c2ef7c3393c874a9e7ecde2cf1e027777`）→ 方案一全域化**：重析翻 high 86.57 漏放。勘察：**实体题判对了**（unacceptable_type 0.9、accepted 仅 0.05——「狗」字没把实体题带偏），根因=event_category 掷骰 E（置信仅 0.32，D 0.22/B 0.19 平铺）→ E 不在类型门域 B/C/D/F/G/W → 域门 miss 放行。域排除 A/E 是 J1.56 认知度轴遗留（当时理由=圈内事件/meme 类实体的认知度豁免），类型轴下「实体是银行/可乐/犬种学名」与事件分类正交、理由不成立。**用户裁定方案一（2026-10-23）：去域限制全域拦，对齐 wrong_entity**——mapper 删 `NAME_ENTITY_TYPE_UNFIT_SCOPE` 常量与 category 参数（`nameEntityTypeUnfitBlock(answers)` 单参），单测 C2 反转为快狗案形状断言（A/E 域 unacceptable_type 0.9 照拦=事故现场反证）；13 文件全绿。**182 重析验证（c4e38bc 部署后，2026-10-23）**：快狗打车 → **low，拦截位=实体类型门 unacceptable_type 92%**——category 仍掷骰 E 但不再域外豁免，方案一预期形状闭合（重析排查中曾误报「代币不存在」，实为命令行手抄地址多打一个 7 的 43 字符串查空，DB 数据无损虚惊）。

### C183 web3_user_* 键名族整体断代 bsc_meme_user_*——评估主体收窄 BSC meme 币用户（J1.112）

- **用户裁定（2026-10-23）**：「我觉得再改一改，web3 用户 其实还是范围有点太大了，我的想法是，都改成 bsc_meme_user_ 这样其实是最准确的。有的事件不是说在 Web3 不重要，而是对 BSC 的 meme 币用户不重要。 例如 0x27ff2020350977ca43115502c976762c9e257777 ，并非对 Web3 用户偏好不和，而是对 BSC Meme 币用户的偏好不合（评 low 没有问题）。 这里不仅仅是锚的名字，Prompt 也要适当调整下」——例证票 JPM（C180 观察票，W 类）现 low 由 `web3UnfitBlock` label「Web3用户偏好不合」拦截，评级不变、**归因主体修正**。
- **改动①（J1.112 题集）**：活题五键全族断代——`bsc_meme_user_event_impact`（veto，四代链 event_token_block_reason→event_quality_veto→web3_user_event_impact→本代）/`bsc_meme_user_event_fit`（fit）/`bsc_meme_user_name_event_acceptance`（关联三桶）/`bsc_meme_user_name_entity_acceptance`（实体五桶）/`bsc_meme_user_phrase_acceptability`（词句）；桶值 `bsc_meme_user_acceptable`/`bsc_meme_user_not_acceptable`；桶 id/choice 值域**全部不变**（五桶/四档/三桶/veto 桶）。题面评估主体措辞全量替换（34 处：veto「对 BSC meme 币用户的影响力」/fit「BSC meme 币用户偏好契合度」/实体「该实体对 BSC meme 币用户（链上 meme 买家）」/词句「BSC meme 币用户能否接纳」等）；W 题 `w_bsc_user_appeal` 不改键（已 bsc 命名），题面主体「BSC 链 Web3 用户」→「BSC 链 Meme 币用户」。顺手修 fit 题面两处 J1.110 漏改旧键引用（`event_quality_veto` 残句 → 新 veto 键）。
- **改动②（mapper，C123 先例：改名不改判据）**：模块级 `q(answers, key, legacyKey)` 归一读 helper 覆盖全部读点（新键优先/旧键兼容=存量 token_narrative 行/旧 fixture 走同一门）；`blockAnswers` 四键链头插新键；词句链 `web3UserAcceptabilityChoice` 四键链；`WEB3_USER_NOT_ACCEPTABLE_CHOICES` 收新桶值+全旧桶值；dump 键换新名（stage1/stage2 probabilities 新行落 `bsc_meme_user_*`，旧键历史行保留展示）；`web3UnfitBlock` label「Web3用户偏好不合」→「**BSC meme 用户偏好不合**」（用户直接指出的归因锚）。mapper 内部函数名（web3UnfitBlock/web3FitMassBlock）与落 DB 历史审计键不动。历史断代注释（J1.50/J1.53/J1.93/J1.110 事件）**还原当时事实键名**防改写史档。
- **改动③（前端）**：experiment_narrative.js 12 处双键归一读+label「Web3 适配」→「BSC meme 适配」；experiment_token_returns.js 超级IP tooltip 键名。
- **单测**：28 个涉键文件全绿。⚠ 教训：批量正则把测试 **answers 桩访问**误改新键（`delete noFit.bsc_meme_user_event_fit` 半新半旧=桩内部断裂，5 文件行为类假红：基线 stash 对比定位）——桩键还原旧键（喂旧行形状=归一读兼容的正确测法），仅题集取题键（qs.*）换新；dump 键/label/桶值/题面锚句断言按断代事实更新（web3_fit B5、jev_finding E5/F1/F1b/F11、consolidation A13f/A14 系、nea D5/D5b/D6、angle C5、resonance D5 等 30+ 处）。
- **fixtures**：C181（JPM 例证票）expect 全收收紧 `['low']`，because=用户裁定原文——评级不变归因修正的首张裁定票。
- **验证/部署**：commit `0d009e9` 已 push；182 pull+worker 重启（PID 1896229）完成。定向回归三票全 PASS（`--only C180,C181,C106`，2026-10-23T07:36Z）：①C181 JPM 保持 **low**，实际拦截位=**W 类总分不足（15<32）**——比预期的 web3UnfitBlock 文案更干净：JPM 是 W 票，W 数学单轴本身就是「项目对 BSC meme 币用户吸引力」，归因与裁定语义完全一致；②C180 RichardTeng 保持 low 不回翻（拦截位=空洞内容门，非 unknown 臂）；③C106 TREE 带父推 fit 长链 high 保持 80.92（基线 81.58，-0.66 属 Jev 非确定性波动，评估主体措辞改动无翻面）。全量回归攒批等用户通知（[[regression-batch-timing]]）。

### C182 GMGN 补源必要门+失败封顶——IP 级 RATE_LIMIT_BANNED 事故（2026-10-23 用户裁定「ave api 信息够了就不需要补充」+「抓不成功最多再尝试一次，就往下走」）★

- **现场**：live v34 `1ecc097b`（2026-10-22 15:09 UTC 起）15h 实测——₿i `0xe3c41d37…7777` 02:54 信号 metadata `gmgn_check_no_data`（GMGN 429）；叙事侧 GmgnSocialFetcher 与交易侧 GmgnRiskCheckService 共用 182 出口 IP，叙事侧 GMGN 成功调用 **694 次/492 token**、429 共 99 次，而真正并入社媒仅 **37 次（≈5%）**——交易侧同期仅 3 次调用却陪绑被 ban。
- **根因（x-0 案「无条件调」设计缺陷）**：2026-09-27 x-0 案把叙事直调的 GMGN 调用设计成「总是调用」——同一次 getTokenInfo 想两用（社媒补源+dev 风险快照落 token_narrative.gmgn_info），但风险快照 **live 买门不消费**（GmgnRiskCheckService 刻意隔离「只认自己 fetch 的结果」；engine legacy preBuy 注入是唯一消费点而 v34 全是 C84 trigger 腿）+ 缓存 5s TTL（CRO 案买前新鲜）=每轮分析都真打；C84 多轮（maxAnalyses 3/noCorpus 8）×N3 预取×repeat 轮放大。ban 窗口内「每轮重打续封」（Repeated requests can extend the ban）恶性循环。
- **裁定①必要门**：data-fetch 层 `gmgnNeeded = enrichSocialByGmgn && !hasTwitterLink(allUrls)`——AVE 元数据 URL 集已含 twitter/x.com 链接（含子域/尾参）→ 整段跳过 GMGN 不发包。判据=pre-IPFS 的 allUrls（IPFS∥GMGN 并行结构不动，pre-IPFS 无 twitter 而 IPFS 解包补出的重叠接受——串行化省这点配额不值）；`hasTwitterLink` 从 gmgn-social-fetcher 导出，与社媒并入门（原 data-fetch 内联正则）**同源单一真相**。no_public_info 重试域不受伤：该域票本就无 twitter 链接，GMGN 补源照常可达。
- **裁定②C51 例外臂随门退役**：superIP 推文并入例外（卷二 C51 龙虾案）主要触发源=「AVE 已有 twitter 仍并入」——随必要门消失（v34 实测 6/29 命中属该源）；例外分支代码保留，残余形状=pre-IPFS 无 twitter 而 IPFS 补出的罕见票仍可命中。
- **裁定③失败封顶进程内封死**：per-token 连续 **2 次真失败**（throw 形状：429/超时/网络）→ 本进程内不再发包、入口直接 null（重启清零；封顶=ban 续封恶性循环的斩断点）。成功即清零；GMGN 正常返回空数据（null 结果）**不算失败**——API 健康空形状走既有失败冷却。null 语义与 GMGN 无数据/未索引一致，调用方按无补源继续。
- **裁定④x-0 缓存补调退役**：NarrativeAnalyzer 缓存命中路径的 GMGN 风险字段补调块删除（`cached.gmgn_info?.risk ?? null` 直读），`NarrativeRepository.updateGmgnInfo` 死代码删除。后果=回测 GMGN 快照缺失时 fail-open 放行更常见（快照本供回测消费），与「API 不可用放行」既定语义同向；live 买门零影响（本就不消费该快照）。
- **单测**：`_test_gmgn_social_fetcher` 扩 C/D/E 组（hasTwitterLink 判据矩阵 / 2 次封顶+成功清零+空数据不计+源码口径 / 必要门接线+补调块退役反证）38 过；`_test_gmgn_superip_tweet_enrich` 扩 B6/B6b（必要门在位+判据单一真相）17 过；16 个相邻单测重跑全绿。
- **部署挂起**：须 182 git pull + live v34 重启生效（重启前按规程核对卡账本无持仓，待用户通知）。

### C181 RichardTeng 无名口号——veto 键名断代 + empty_content 无名口号臂（J1.110）

- **现象**：`0x007f5ddb6b5d2377f17089a7835bc61beee97777`（RichardTeng，C180 观察票拆臂后 26.8 high 放行）——无名账号单条口号式提及 Richard Teng，事情全部内容只是作者自己的一句话，对 Web3 用户不构成影响力事件。
- **用户裁定（2026-10-23 逐张过票第一张）**：预期 **low**——「只是个无名氏喊了这么一句话罢了」。`event_quality_veto` 键名同步改 **Web3 用户视角**：`web3_user_event_impact`（对 Web3 用户的影响力），「这一锚侧重评估事情质量+重要性，也就是对 web3 用户的影响力。0x007f…应该在这层堵住」。题面中「第二层 fit 含事件重要度」与「产品/内容型日常宣传不由本题判」两段尸体句删除（用户裁定无保留意义——前者与新主轴冲突、后者指向已删桶）。
- **改动**（J1.110，桶 id 不变零断代）：
  1. **键名断代链**：`event_token_block_reason`（J1.82 前）→ `event_quality_veto`（J1.82）→ `web3_user_event_impact`（J1.110）。mapper `blockAnswers` 三键归一读旧行（C123 改名先例：改名不改判据）；前端 experiment_narrative.js 两处三键读；审计键 `jev.web3_user_event_impact` 落新名（旧键历史行保留展示）。⚠ 撞名史：J1.79 删除的旧 score 事件分题恰同名 `web3_user_event_impact`——缓存行直接返回评级不经 mapper=生产无害；测试基底喂旧 score 形状会遮蔽 veto（nea/referent 基底已修，narrator/resonance/product_entity/consolidation「已删题清单」断言改锁 `type === 'choice'` 防变回 score 题）。
  2. **无名口号臂**（empty_content ②类形状，C175 fit 锚判据前移 veto 层）：无名作者的单条口号/喊话/宣言/许愿——句子是说事/喊话/表态而非具名玩梗，对人物/机构/品牌口号式提及**即使点名 Richard Teng/币安等知名对象也算**；无外部热点依托、无情节、无第三方参与 → `event_empty_content` 桶拦。三排除锚随行：①J1.58 圈内高影响力账号本人短句（影响力看作者层级不看句子）②C159 具名 meme 指认/提问/玩梗（措辞收窄「实体」→「梗主体」+句式限定，防吃掉无名喊话形状）③C175b 成型叙事（有情节/持续记录/被命名主体来历，无名作者不减已成立事件分量）。
  3. **instructions 重写**：主轴=「评估事情的质量与重要性——是否是真实、有分量、对 Web3 用户有影响力的事件」第一层；负面事件/口味契合交第二层 fit；event_*/token_* 选项分类说明保留。
- **验证**：单测 9 文件全绿（nea 46 含 C5 新键/C5b 旧键回落/C6 豁免、img_exempt 29 含 H9 无名口号臂四点锚、consolidation 90、resonance/product_entity/narrator/angle/referent 适配）；signal_metadata_cache E7/E13 计数断言顺手修（71b7e3a 观察信号登记点漏适配，非本批引入）；fixtures C180 expect 收紧 `low`。定向重析+全量回归挂起攒批（[[regression-batch-timing]]）。
- **部署**：182 pull+重启 narrative worker 后 `--only C180` 定向对拍翻 low（单票定向=改动验证，全量回归等用户通知）。

### C181b RichardTeng 堵截三层收尾——J1.111 事件层优先划界 + C114b 图证豁免收窄

- **现象（J1.110 后两道残留放行）**：①定向重析仍 **high 71.11**——Jev 答 `token_ip_reuse` 0.52 / `event_empty_content` 0.31 分票：argmax 被 token_ip_reuse 拿走但 `BLOCK_SCOPE` 域 `['A']` 对该票 category C 域外不采信 → veto 整体放行（无名口号语义已吃到 empty_content 桶、概率面只 0.31 不够赢）。②J1.111 划界后重析 veto 翻 `event_empty_content` 0.95 / none 0.01 但**仍 high 73.06**——C114 图证豁免吞掉拦截；该票配图 Jev 自判 `image_depicts_name` decorative **0.93**（装饰图与币名无关），违背 C114「图就是内容」豁免假设（DND 案图=梗图本体）。
- **改动①（J1.111，541b474）事件层优先划界**：veto instructions 加优先序——两层缺陷同时命中时**事件层优先**：无名作者单句口号/喊话式提及（事情全部内容=作者一句话）→ 票的根基是没有事件，选 `event_empty_content`（名字是否蹭人名是次要缺陷，不由 token_* 承载）；`token_ip_reuse` 桶加划界句=只管 meme IP/形象/梗的换皮复用（仅套用真实人物/机构名而无 meme IP 复用、事件本体=无名作者一句话 → 归 empty_content）。
- **改动②（C114b，772de13，mapper 不 bump 题集）图证豁免收窄**：`image_depicts_name` 明确 decorative（choice 且概率 ≥0.5）→ 豁免失效照拦；答案缺失/未问/unclear/depicts_name → 照旧豁免（fail-open 与 C114 同方向，存量历史行零翻转；条件题与 imageEvidence 同源、无图不问=天然不触发）。审计键 `emptyContentImgOverride` 同步收窄（decorative 不再误标豁免）。
- **验证**：定向重析 `0x007f5ddb…7777` → **low「阻断:空洞内容｜P=0.96」**；C180 `--only` 单票 PASS（low→low）。单测 img_exempt 34/0（新增 C114b 段四断言：照拦/审计不落/depicts_name 对照照豁免/缺失臂 fail-open）+ nea/consolidation/image_depicts_exempt 等 10 相邻文件全绿。全量回归攒批等用户通知。

## 三、Jev 问题集版本演进（卷四起）

> J1.109 及之前全史见卷三归档 §三（J1.87-J1.109 为 2026-10-23 归档时补录的简式索引）；
> 卷四起新版本行在此追加。

| 版本 | 日期 | 触发 Case | 改动 |
|---|---|---|---|
| J1.110 | 2026-10-23 | C181 | `event_quality_veto` 键名断代 `web3_user_event_impact`（Web3 用户视角：对 Web3 用户的影响力；桶 id 不变，mapper 三键归一读旧行）；empty_content 新增②无名口号臂（无名作者单条口号/喊话即使点名知名对象也算，三排除锚 J1.58/C159 收窄/C175b）；instructions 重写+尸体句删除 |
| J1.112 | 2026-10-23 | C183 | `web3_user_*` 活题五键全族断代 `bsc_meme_user_*`（event_impact/event_fit/name_event_acceptance/name_entity_acceptance/phrase_acceptability）+桶值 acceptable/not_acceptable；评估主体措辞全量收窄「BSC meme 币用户」（34 处，JPM 案例证）；桶 id 不变零断代，mapper q() 归一读旧行；web3UnfitBlock label 改「BSC meme 用户偏好不合」；fit 题面两处 J1.110 漏改旧键引用顺手修 |
| J1.111 | 2026-10-23 | C181b | veto instructions 事件层优先序（两层缺陷同命中时 empty_content 优先：无名口号的根基是没有事件）；token_ip_reuse 桶划界句（只管 meme IP/形象/梗换皮复用，仅套用人物/机构名+事件本体=无名一句话 → 归 empty_content）；C114b mapper 收窄同批（decorative≥0.5 图证豁免失效，不 bump 题集） |

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
