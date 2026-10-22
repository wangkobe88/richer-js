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
                                   ├─ account/community token / 发行方自发宣告（字面法+CA 时间线）→ prestage Jev（P1.14，4 题）
                                   ├─ super-IP 账号 → 快速通道（标准题集 + 代码预评分；referent_memeability/图豁免 C59）
                                   └─ 标准路径 → 单次 Jev 调用（J1.30：16 常驻题——web3_fit 第 14 /
                                      subject_entity 15 / referent_memeability 16a / subject_carrier 16b
                                      均恒带 + brand_hijack / name_image_consistency（C65）条件携带）
分类/量级/时机/阻断/W类/关联性/质量/Web3偏好/形象载体/名图一致 原子化同问；聚合/阈值/截断全部代码端（jev-result-mapper）
```

- **Jev**（TypeSafe System One，api.typesafe.ai）：结构化决策模型（Choice/Score/Noul 三原语），
  无文本生成，单 token 一次投机性 fan-out 调用（秒级）
- **版本规则**：改任何题的 instructions/criteria 必须 bump `JEV_QUESTIONS_VERSION`（现 J1.56）/
  `JEV_PRESTAGE_QUESTIONS_VERSION`（现 P1.14）；DB 列 prompt_type/prompt_version 标识
  （`jev(J1.41/…)`、`prestage-jev(P1.11/…)`）
- **prestage P1.14 四题**：token 类型（「币本身即IP」双形状：新称号 OR
  社区/文化 meme 主账号，年龄非反证；**C101：推文语料不采信 web3ip，回落 abm 双条件**）/ abm 名字关联 / abm Web3 流量 / **项目币官网核验（C164：恒带，
  仅 project 分支消费——substantiates/non_infra 放行，空壳/抓不到/基础设施类无站 → low）**。社区活跃题 P1.12 已删（社区臂恒 mid）。**账号基本面门
  全删（C70 bunker 案）**：粉丝底线 <20、推文 <5、注册 <30 天三道门 + P1.5 实度豁免
  （`prestage_project_quality` 题随之删除）全删——粉丝带**只定档不拦截**（账号 0-299
  mid / ≥300 high；社区恒 mid）
- **代码门族**（mapper 端确定性切分）：nameEntityLowBlock（J1.56：币名映射实体
  Web3 用户不认得 unknown≥0.5，域 B/C/D/F/G/W；no_entity 中性）/ authorUtterance
  作者原话票（J1.56：注册表作者 ∧ 币名逐字主推 → C88 第一腿补位；不要求 Jev 升档）/
  cashtag 改道 W（J1.17）/ detectPublisherProxy
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

### C175b 双锚边界收口——fit「空口号 vs 成型叙事」+ 实体陈述句反锚（2026-10-22，C175 回归修复）★

- **误伤①（C106 TREE `0xd50e11204f7f3d63598b0118ee4151bf95917777` 翻 low，三跑 30%/23%/22% sf+fit 全 J1.83 拦）**：J1.105 fit 锚「事件本体分量」把「作者自述种树故事」读进「无币外分量」臂 → marginal 0.61（J1.104 下三跑稳定 high 81.55/82.21/80.44 的票被本锚误伤）。根因=锚句只写了空口号臂的否定面，未给「成型叙事」正例——TREE 类个人叙事（持续行为记录/有情节故事）有事可讲，不是空口号。
- **误伤②（C96 币安上电视 `0xc6d089d749409f7646de440d637ac9db0e047777` 稳定翻 high 80-83 三跑）**：实体题 accepted 0.40/not_entity 0.33 近 tie 掷 accepted（币安=著名实体）→ J1.139 词句题只评 not_entity 票 → 「Web3 用户不接纳该名字」拦截位（该票 expect low 的锚）失效放行。根因=C175 实体锚整体把实体题保守度降低，陈述句名字的 not_entity 份额被挤向 accepted。
- **改动（J1.106）**：①fit 锚补边界句——「至多 marginal」臂只限**空口号**形状（无叙事内容、无事可讲，除谐音/点名外没有任何情节）；事件是**成型叙事**（持续行为记录/有情节故事/被命名主体来历——如个人种树记事、救助流浪猫的过程）时事件本体已成立，全部由作者个人产生不减分量，正常评估契合（第三人称报道非必要条件）。②实体锚补陈述句反锚——「性质定义」是给币名主体定身份（警犬/吉祥物式命名）；名字是**陈述句/事件描述**（「XX上电视」「XX要来了」式——说一件事非命名主体）不构成性质定义，句中提及著名实体不因此 accepted，仍归 not_entity 由词句题接管接纳判定。
- **单测**：web3_fit A9（边界句五点在场，30/0）+ name_entity_acceptance D9（反锚五点在场，44/0）+ 两处版本断言 J1.106 随动（angle_timing C5/question_consolidation A10d，47/0、89/0）。
- **部署（82a0313，J1.106）**：182 pull → worker 重启（15:12:39 单实例）→ 定向重析四票全达：**C106 TREE 三跑 high 83.44/82.21/81.58**（事件分 75-78 恢复，C174 成果保住）；**C101 OK❌ 两跑 low 7%/9% 不回弹**；**C96 三跑 low「Web3 用户不接纳该名字（词句接纳度门）」拦截位恢复**（expect reasonIncludes 命中）；**C94 京小安两跑 high 76.15/77.98**——fit 边界句连带把警犬故事（成型叙事）事件分从 53/55/59 抬到 66/69 过 B 类 60 线，**五跑历史首次 high，用户裁定「实体非常明确」达成**。C109c BI 仍 mid 62.29-63.46（关联题 unacceptable 5 分卡 1.5 分差 high 线——C175b 未碰关联题，J1.92 轴遗留待裁）。
- **回归终态（52 票 41P/5F/6O/0E，15-16-20 批，J1.106）**：**C94 京小安 PASS high 77.38**（event:B；定向 76.15/77.98+回归批 77.38——五跑历史首次 high，用户裁定「实体是北京警犬的名字，应该非常明确」达成）；**C101 OK❌ PASS low**（sf+fit 7-10%<50%，用户裁定「无名用户单条口号推不应该是 fit」达成）；**C96 PASS low**「Web3 用户不接纳该名字（词句接纳度门）」（陈述句反锚拦截位恢复，expect reasonIncludes 命中）；**C106 TREE PASS high 81.58**（C174 成果保住）。J1.105 批 8F→5F。5 FAIL=**C109c**（mid 67.24 差 2.76——关联题 unacceptable 落 5 分卡分，J1.92 轴遗留待裁，C175/C175b 均未碰关联题；同簇 C83a/C83b high）+C79/C133/C162/C167 四前段遗留（与 C174 收口批同集零新增）。6 OBSERVE（C100/C72/C80/C85/C126/C130）同前轮零变化。⚠️ live v34 1ecc097b（并行会话 15:09 所起，@e0c58c2）=J1.105 代码，落后 J1.106 一版，是否重启待用户裁定（重启前查持仓）。

### C175 双臂：实体题「性质定义优先于认知度」锚 + fit 题「事件本体分量」锚（2026-10-22 用户裁定）★

- **案由①（C94 京小安 `0xcb98accaa8040a7e839c305b8aca08e113c87777`，symbol=京小安/name=首款AI警犬，flap IPFS meta 票）**：长期 FAIL 票（expect mid|high），本轮死因=实体题 `unknown 0.50`（new_entity 0.43 紧随，accepted 0.01）恰压 unknown 门 50% 线（B 域拦）。判读链：name「首款AI警犬」已给币名主体明确定义（警犬角色），但 Jev 以「认知度」轴评估（评估者不认识京小安）落 unknown。
- **案由②（C101 OK❌ `0x0195119e4806441c871adada6256296265ed7777`，symbol=OK❌/name=尽管东奔西走 欧易全部没有，无名用户 @Notickernowif 单条口号推）**：C172 删品牌劫持轴后四跑稳定 high 70.62 误放（本轮 strong 0.46+fit 0.17=63% 事件分 37.8 + J1.92 exact_match 0.58）。根因：J1.79 改造后事件分=fit 质量（口味契合），「无名作者单句口号」的事件本体量级维度被挤掉——谐音梗合口味就给高分，一句口号被当成了事件。
- **裁定（用户，2026-10-22）**：「『首款AI警犬』给实体定了性质，我认为能被 web3 用户接受是根本的（符合我们的门控名字），而不是知名/广泛报道」「OK的匹配我觉得没问题，OK 是指欧易，但主要是『无名用户 @Notickernowif 单条口号推』这个事件对 web3 用户无影响力，不应该是 fit」——①实体接纳根本判据=性质可接纳（角色定义清晰且形象用户乐于接纳），不以认知度为前提；②J1.92 谐音匹配判定**保留**（OK❌→欧易 exact_match 无错），修的是 fit 层：无名口号=无事件分量。
- **改动（J1.105，题面双臂）**：①实体题三锚——instructions ⚠️「性质定义优先于认知度」段（name/语料已明确性质定义+用户天然接纳的具象角色形象→accepted，不以知名/被广泛报道/评估者是否听说过为前提；unknown 限于语料未给出可接纳性质定义）+accepted criteria 主锚+unknown criteria 反锚；逃逸门=空泛自称（无具体角色内容的口号式自称）不适用。②fit 题 ⚠️「事件本体的分量是契合的前提」段——事件源自公共热点/新闻/圈内人物表态等**币外分量**时宣告者无名不减分量（无名账号报道已被传播的热点仍是热点事件，保 C94 类票活路）；事件本体只是无名作者自己的一句口号/一次玩梗（无外部热点依托、无第三方讨论）→ 不是事件，至多 marginal，名字与品牌的谐音匹配再巧也不能凭空造出事件。与传播数据锚显式划界：互动数字不作加减分依据（C130 裁定不推翻），本锚判事件有没有币外来源。
- **单测**：`_test_name_entity_acceptance` D8（三锚+逃逸门在场，43/0）+ D5 版本随动；`_test_web3_fit` A8（事件分量锚五点在场，29/0）；angle_timing_override C5 / jev_question_consolidation A10d 版本断言 J1.105 随动（47/0、89/0）；相邻 6 单测（brand_hijack/w_bsc_appeal/superip_slogan/name_image_consistency/empty_content）全绿无锚文本碰撞。
- **部署（e1e9b69，J1.105）**：182 pull → worker 重启（14:59:55 单实例）→ 定向重析：**C101 OK❌ 三跑全 low 收口 ✓**（fit marginal 0.75 → sf+fit 8-12% < 50% J1.83 硬门拦）；**C94 实体锚生效干脆**（unknown 0.50 → accepted 0.99）但事件分 53/55/59 差 1-7 分仍 low（B 类需 ≥60）——卡点=事件分贴边，预期 C175b 边界句连带抬升（见下）。**52 票回归 38P/8F/6O 暴露两处误伤**（C101 转 PASS 对冲后净 +2 FAIL）→ C175b 立即收口。

### C173 蓝筹去重新陈述豁免——新推直陈概念不算重复（2026-10-22 用户裁定）★

- **案由（「4」`0x972e6c994b45570fa46791f1cdbbfc301c8d7777`）**：eMudhra 印度 CA 私钥事故（10-20 @IntCyberDigest 496 万阅读爆推：116 位私钥其中一把就是「4」）10-21 已出同名蓝筹 `0x0a43fc31a73013089df59194872ecae4cae14444`（ATH $306M，source=gmgn，本系统当时评 low）；10-22 12:05 UTC **CZ 本人**（@cz_binance，1299 万粉，回复 IntCyberDigest 推）新推直陈概念「Can't make this sh!t up. A large part of the internet was encrypted by '4' 🤣」→ 30 秒后「4」票发出。C168 门 name_exact 撞前蓝筹 → 拦 low「蓝筹去重：撞已验证蓝筹叙事（4）」。stage1 本体面（12:06 行，J1.100）：E 0.8 / strong_fit 0.89 / S 档 / tweetType=direct_tweet。
- **裁定（用户）**：「4 是基于当前的推文发出的币，是新的推文陈述的概念，即使跟之前名字一样，不算重复」「发起者是 CZ，有足够的动能，让它活一阵。但如果是一个陈述老叙事的找角度推文，显然不行」——名字一样 ≠ 叙事同一：新推文直接陈述的概念自带入场资格；边界=找角度/复述形状照拦。
- **改动（mapper-only，不 bump 题集版本——C168 同款切分）**：C168 门首臂加豁免条件 `dedupNewStatement = tweetClassification.type === 'direct_tweet' && context.corpusAuthorInRegistry`。①主推=direct_tweet（新陈述形态；angle_seeking/interpretive_reply/unknown=找角度/解读复述/不确定照拦，tweet-type-classifier 既有分桶零新逻辑）；②语料作者在 super-ip 注册表在册（context.corpusAuthorInRegistry，J1.58 同源传参——CZ/何一/币安官方等=作者有足够动能再点燃同名叙事；无名小号 direct_tweet 复述=无动能复制品照拦）。缺一即拦（fail-保守），豁免后票回门链正常评估（unfit/契合门/量级门照常接管）。在册巨触达作者老推被翻出的「用烂」形状不归本臂（C104 主从结构门/C132 MEGA_REACH 时效层既有职责）。审计 `bluechipDedupNewStatement` 命中才落（tweetType；撞名证据照记 bluechipDuplicate——豁免理由与撞名事实各自可追溯，后续门拦截位不被去重 label 掩盖）。
- **刻意不用 dedupExempt 数据侧豁免**：manual 条目级豁免是全量放行（对该条目名字的所有后续票解除去重），会把用户点名的「陈述老叙事的找角度推文」边界一起放开——条件豁免（按语料形状判定）才是本案形状；b:0x0a43…4444 条目不标 dedupExempt。
- **存量票影响面核查（改前逐票验证）**：C121 牛来（作者 @Meechieftw/unknown 桶）、C168 BIAOQING（@Chilldev69/2830 粉/unknown 桶）均不在册非 direct_tweet → 照拦零翻转；C106 TREE/C138a Heyi 非去重路径不受影响。
- **单测**：`_test_bluechip_dedup_gate` 扩 B5 真值表（direct_tweet+在册→豁免非 low+双 audit 键；angle_seeking/interpretive_reply/unknown 作者在册照拦；direct_tweet 不在册照拦；分类缺失照拦 fail-保守；无撞名证据豁免臂零侵入）+ C 组判据源码锚，54/0；mapper 消费面 13 门族测试+知识库五件套全绿。
- **部署（已收口，2026-10-22）**：263db36+d70d4d5+87a8d33 → 182 pull → 叙事 worker 重启（旧实例 SIGTERM 不死 SIGKILL 清掉单实例确认；v32 实盘当时已停无需重启）→ 「4」定向重析 **high 86.52**（S 档 92/关联 exact_match 20；J1.103），DB 行审计 `bluechipDedupNewStatement={tweetType:'direct_tweet'}`+`bluechipDuplicate` 双落地=豁免路径精确生效；票收录回归集（expect high+双审计键，d70d4d5）。**全量回归 52 票 39P/7F/6O**（14-02-47 批，C173 票 PASS high 87.7）：7 FAIL 与 C172 收口批（12:59）同集 6 票（C94/C106/C79/C162/C167+并行会话已呈报的 C101）零新增；唯一评级漂移 **C133 股城 high 89.38→low** 经 DB 行确证与 C173 零关联（`bluechipDuplicate=null` 未撞去重门；event_category W 0.42/C 0.38/E 0.14 三方掷骰 argmax 落 W → W 数学 29.08<32 拦——C133 本即 C171 台账在案的阈值抖动票）。

### C174 实体题「被命名+被讲故事的故事主体」锚——TREE 归位 new_entity（2026-10-22 用户裁定「那这个不应该是 not_entity 应该是 new_entity 吧？」）★

- **案由（TREE `0xd50e11204f7f3d63598b0118ee4151bf95917777`，C172 部署后回归遗留）**：品牌劫持臂退役后 TREE 三连跑稳定 low，新死因=词句接纳度门 not_acceptable 0.59~0.81。呈报判读链后用户指出归位问题：**BNB Tree 该判 new_entity 而非 not_entity**——主推（@TCryptochicks 45412 粉）「I also call it my BNB Tree」+完整故事（种橙子树 1.5 年教儿子耐心+BNB $600 长期持有双关+实拍图）=向用户群宣告了一个新称号所指的具体故事主体；not_entity 题面定义是「不映射任何实体——普通词汇/话中截词」，BNB Tree 有明确所指，不是中性词。
- **Jev 判歪根因**：new_entity 桶锚例全是「主体先在、币名=主体名」官宣形状（新项目/新品牌/IP 衍生角色），**缺「语料里被命名+被讲故事、名字字面是普通词」形状的锚**——Jev 看 symbol=TREE 字面普通词顺手掉 not_entity（分布 not_entity 0.47/accepted 0.35/new_entity 仅 0.09=没找到对的桶而非确信）；J1.139 结构下 not_entity 触发词句题 → not_acceptable 拦。
- **改动（J1.104）**：实体题三锚——①instructions ⚠️ 新实体段补「被命名+被讲故事的故事主体是新实体」（TREE 案现场作锚例+不因字面普通词判 not_entity+逃逸门=语料须确实陈述命名行为/讲过故事，币名=普通词而语料无命名行为的蹭名票不满足）；②new_entity criteria 同款主锚；③not_entity criteria 反锚（语料已陈述命名行为/已讲故事的主体不属本项）。
- **效果链**：TREE → new_entity → 实体门不触+**词句题整体跳过**（J1.139 只评 not_entity 票）→ 计分 ≈81 → high（C106 expect 达成）。
- **反向风险（呈报过）**：逃逸面要求语料确实陈述命名行为+讲故事——真蹭名票（币名=普通词、语料无命名行为）不满足锚句，仍走 not_entity→词句题照拦。
- **单测**：name_entity_acceptance D7 故事主体锚三点在场+逃逸门断言（42/0）；版本断言随动 3 处（angle_timing C5/question_consolidation A10d/name_entity D5→J1.104）。叙事侧全量单测零失败。
- **部署（已完成）**：2613482 push → 182 pull → worker 重启（14:09 UTC，J1.104）→ TREE 定向重析三跑 **high 81.55/82.21/80.44 稳定**，实体题 new_entity 0.09→**0.99**（锚生效干脆）；phrase 题照答 not_acceptable 0.58 但 new_entity 选择下词句门不消费（J1.139 结构按设计工作，答案留审计）。
- **回归终态（52 票 40P/6F/6O）**：C106 TREE **FAIL→PASS**（expect high 达成，C174 收口）；C173 收录「4」票 PASS（51→52 票）；6 FAIL=C94/C101/C79/C133/C162/C167 **全部前段遗留待裁**（C172 后同名单），**零新增漂移**。⚠️ live v33 引擎 8eca4890（并行会话 14:00 所起）早于本次 pull=仍 J1.103 代码，是否重启待用户裁定。

### C172 品牌劫持轴整轴退役——判据归位 web3_user_name_event_acceptance 用户视角（2026-10-22 用户裁定）★

- **案由（TREE `0xd50e11204f7f3d63598b0118ee4151bf95917777`，C106 j7tracker 直链解锁票，C171 回归遗留 expect 冲突票）**：C171 载体门退役后 TREE 仍 low，用户质疑「TREE 不应该有什么品牌劫持一说」。182 实测归因：预检表命中（BNB Tree 归一化含 bnb 关键词）→ 实体题 `brand_mismatch` 0.74 → punExempt 断第四腿 credibleEventAnchor（语料=TCC 种橙子树故事推，非 superIP 注册表/非自发宣告/非币安广场）→ **品牌劫持截断把 81 分票拦成 low**。铁证=同一次调用里 Jev 自己给出 `name_event=exact_match 0.74`（名字-事件关联明确）与 `entity=brand_mismatch 0.74`（品牌劫持）**自相矛盾**——TREE/BNB Tree 是复合创意名（品牌词作修饰、名词主体=事件主体「树」），被实体轴误吃。
- **裁定（用户）**：「品牌劫持其实本质是事件/代币关系层面的，如果要放，也是放到 web3_user_name_event_acceptance，而如果 web3_user_name_event_acceptance 已经站在了用户视角进行判断了，那么其实 品牌劫持 可以删掉」——判据归位：J1.92 用户视角三桶（exact_match 20/acceptable 15 过 ≤10 线放行、unacceptable 5 落截断）天然覆盖「真蹭名→用户不接受→关联低分→拦」；C40 Binance Inu 类戏谑关联票的正名=acceptable。
- **改动（J1.103）**：①题集——`BRAND_HIJACK_KEYWORDS` 预检表+`shouldIncludeBrandHijackCheck` 函数删除、实体题 `brand_mismatch` 桶删除（六桶回五桶 accepted/unknown/new_entity/wrong_entity/not_entity）、`brandMismatch:true` 传参静默忽略、版本 bump J1.102→J1.103；②mapper——`brandMismatchP` 计算+`punExempt`（J1.24 戏谑豁免，C40 立门）+品牌劫持截断臂+`credibleEventAnchor` 参数整链删除，`magExempt = imgNameExempt || recognizedEntitySlogan`（豁免源收窄，J1.24戏谑 tag 移除）、量级门 D/E 臂唯一守卫 `!imgNameExempt`、Stage3 spelling 臂升链首、关联臂守卫 `!imgNameExempt && !recognizedEntitySlogan`、审计键 brandMismatchP/punExempt 停产出（历史行保留展示）；③analyzer——includeBrandHijack/credibleEventAnchor 两处传参删除；④工具脚本（scan-c88-flip-surface/jev_dryrun/jev_calibration）随动清参。
- **旧缓存行兼容**：实体题 probabilities 残留 brand_mismatch 键 mapper 不读（桶退役=不产出+不消费，双停，单测 A3 bit 一致锁定）。
- **回归影响面**：TREE（81 分被拦→预期翻 high，expect 已是 high=fail-first 达成）；C40 BI Inu 类票在新题集下由 J1.92 acceptable 15 分自然放行（复核在案票重析）。品牌关键词票不再有预检门=Jev 少答一桶（fan-out token 微降）。
- **单测**：`_test_brand_hijack_pun_exemption` 整体重写为退役反证（A 案票终态：acceptable 15 放行/unacceptable 5 由关联≤10 截断拦/残留键 bit 一致；B 桶退役恒五桶+传参静默忽略；C 源码防复活预检表/函数/劫持臂/punExempt/analyzer 传参+spelling 链首；D 审计停产出+magExempt 收窄；E 版本 ≥J1.103；F 量级门豁免源收窄）16/0；随动 8 文件（web3_fit A5/question_consolidation A6+A10d/name_image_consistency A7+D3+F1/superip_slogan_class D1+E4+G2+G4-G6/name_entity_acceptance D5+D6/spelling H1/angle_timing C5）；**顺手收口 C171 存量漏网**（superip_slogan_class D1/G2、name_entity D5 版本+D6 visuality 在册——两文件不在 CLAUDE.md 单测清单当时未跑）+ 本案新发现 superip_standard_path B5（credibleEventAnchor 断言随轴翻反证）。叙事侧全量单测零失败。
- **部署（已完成）**：f00d4a1 push → 182 pull → worker 单实例+live v32 f04861ee 重启（13:54 UTC，重启前零持仓确认）→ 全量回归 **38P/7F/6O**（上轮 39P/6F/6O）。
- **回归终态**：6 FAIL 与上轮完全相同（C94/C106/C79/C133/C162/C167=C171 前段遗留待裁，非本案引入）；**唯一新增漂移 = C101 OK❌ `0x0195119e…7777` expect low（空洞内容锚）→ high 70.68 四跑稳定**（69.94/71.12/72.54 复核）——删品牌维度后 Jev 各题稳定正向（accepted 0.57/phrase acceptable 0.67/exact_match 0.63/strong_fit≈0.46），「OK❌」极短符号票旧世界疑似被品牌锚（OKX 预检）带偏 empty_content，删桶后全绿放行。**待用户裁定 expect 是否 update**。
- **TREE 死因迁移（重要发现）**：三连跑稳定 low——品牌劫持臂消失后 entity 判 not_entity 0.47 argmax → **词句题开评**（J1.139：phrase 只评 not_entity 票；**旧世界 brand_mismatch 桶曾结构性屏蔽词句题**）→ web3_user_not_acceptable 0.59-0.81 拦。关联 exact_match 0.74 与词句 not_acceptable 并存=两题轴语义可分（名字↔事件关系 vs 名字形状用户接纳），expect high 冲突待裁。

### C171 形象载体轴整轴退役——形象考量并入实体接纳度（2026-10-22 用户裁定「有形象接纳度会高，但是也不是说没有形象就不行，一切看情况」）★★

- **案由（三票连环）**：①**股城 `0xaacbc156435dbab7815a61bccba1c827e52a7777`**（C133 已知阈值抖动票）：web3 项目票被 `no_visual_entity` 0.91 拦——用户裁定「web3 项目不适用载体门」；②**TREE `0xd50e11204f7f3d63598b0118ee4151bf95917777`**（C106 漂移遗留）：三桶 0.44/0.39/0.17 掷骰边缘——用户裁定「实体是树，有形象载体」；③**Heyi.ai `0xa1cb5a5915c43829a33c7cb508f65eebed177777`**（C138a）：choice=accepted 但 0.25<0.5 概率线，著名豁免臂吃不到——用户裁定「实体是何一/域名不需要形象载体」。
- **深度评估（呈报后用户裁定整轴退役）**：门的结构性三病灶——①argmax 无置信门槛（0.44 掷骰即定生死，TREE 案实证）；②著名豁免 `entityVisualBlock` 的 accepted≥0.5 概率线对**间接指代**卡死（Heyi 案：choice 层已判 accepted，概率层 0.25 差一分）；③类型学错位（「web3 项目有无吉祥物形象」不是用户偏好轴——股城案：发行的是完整叙事产品，有无吉祥物与用户是否买账无关）。+4.42 立门时的避亏功能（BNC/Bicat 类无形象纯口号票）九连打洞后已大幅弱化（C59 图豁免/C88 五腿/C109+C118 图证豁免/C139 著名免形象/C160 情感豁免/C161 massive 豁免/C167 第四臂），门的可达面只剩「无形象+无图+非著名+非救助+非爆火」的交集窄缝，而这条窄缝里的误拦（三票全是）已多于真拦。
- **裁定（用户）**：「是否去掉 web3_user_entity_visuality 这一个轴？实体的可视化有形象，其实也是实体的 web3 用户接纳度的一部分（web3_user_name_entity_acceptance），有形象接纳度会高，但是也不是说没有形象就不行，一切看情况。」——形象考量并入 acceptance 题面锚句（加分项非否决项），门+豁免臂整链退役。
- **中途裁定（image_depicts_name 保留）**：初始方案连演绎题一起退役，用户质疑「image_depicts_name 这个需要删除吗？这我觉得是事/币关联的一个维度」——**保留并改挂**：演绎臂从载体门图证豁免迁入 **J1.30 imgNameExempt 关联豁免第二臂**（判据 imageEvidence ∧ (nicMatchP≥0.5 ∨ depictP≥0.5) ∧ 0<关联≤10，同阈同窗；magExempt 聚合自然继承；审计 `imgNameExempt.via='match'|'depicts'`）。「配图在演绎名字含义」=币名↔叙事的关联证据，与主体有无形象正交。
- **改动（J1.102，C170 后紧接着的编号撞车规避——C170/J1.101 被并行会话占用）**：
  - **题集**：删 `web3_user_entity_visuality`（J1.81/C139 立）、`event_influence`（J1.97/C161 立，唯一消费=载体豁免）、`image_carrier_nature`（J1.100/C167 立，唯一消费=第四臂）三题——死题不白烧 fan-out token，基础题数 12→10；`image_depicts_name` 条件题保留（挂点迁移）；acceptance 题插入锚句「有形象可上调 accepted 概率，但无形象本身不构成否决」；phrase 题三处 visuality 引用清理。
  - **mapper**：`entityVisualBlock` 门+六豁免臂（famousEntity/authorUtterance/imgCarrierOverride/emptyContentImgCarrierOverride/emotionalImpactCarrierExempt/massiveInfluenceCarrierExempt）+正则事实锚（ANIMAL_RESCUE_STORY_RE/MEMORIAL_STORY_RE）+审计十键（subjectCarrier 族+eventInfluence）+probabilities 段 name_entity_carrier dump 键整链删除；门链序变为 duplicateNarrative→w3Block→peBlock→blockChoice→neBlock→weBlock→uaBlock→量级门 D/E 臂→W 数学→标准数学（scBlock 分支消失）；imgNameExempt 扩 depictP 臂。
  - **旧缓存行兼容**：visuality/nature/influence 残留键 mapper 不读（题退役=不产出+不消费，双停）。
- **回归影响面（7 票行为变化，均 182 重析对拍后呈报）**：C79 偷窥狂/C80 蝦蝠侠摇/C109b 暗号資産の覹者/C167 梗王大乱斗（现 expect low 引擎跟随型，载体门退役后 E 类 strong_fit 放行翻面）；C133 股城（no_visual 0.91 拦→放行，web3Fit/量级门/实体门接棒）；C106 TREE（三桶掷骰消失）；C138a Heyi（C169 遗留 expect 冲突随本案收口——expect 本就 high，门退役后应翻 high 转 PASS）。
- **已观察风险（呈报过）**：C61 避亏功能无等价替代（BNC/Bicat 类纯口号票改由 web3FitMassBlock/量级门/实体门接棒，无法机器证明，回归盯盈亏）；E+improvised 细分丢失；C167「实录图不产生形象信息」昨日臂撤销（与 C171 同日，寿命 <1 天——按整轴退役裁定随动，不单独恢复）。
- **单测**：直接相关 6 文件改写全绿（subject_carrier 30/0 退役反证+源码口径防复活、image_depicts_exempt 20/0 新挂点、image_carrier_nature 8/0、emotional_impact_carrier 7/0、massive_influence_carrier 7/0、empty_content_img_exempt 28/0）；随动 13 文件（版本硬等号→≥J1.102、题数 12→10、载体门行为断言改新语义——finding_recap B4/D2 改放行、regional_binance C2 改不产出、name_image_consistency E3 同）；**顺手收口 cashtag_w_route B1c/B5**（C154 删 W 正向时效表存量失败，C170 台账标注「待另修」——0.18+25→0.18、47+25→47，pass 线 57→32，行为结论不变）；superip_standard_path D2 版本随动漏网补修。叙事链路+Jev 门+抓取器三组全量零失败。
- **部署（待执行）**：commit（甄别并行会话脏文件）→ push → 182 pull → 重启叙事 worker+live 引擎 → 定向重析 7 票 → 全量 case-regression → 翻票 expect 逐张呈报用户裁定。

### C170 negative_hard_news 门整体退役——负面事件交 web3 契合度判（2026-10-22 用户裁定「去掉 negative_hard_news 得了，直接让 web3 契合度去处理」）★

- **案情（RSA4 `0x3486657430a3c3ba1cf66b3a00976e9667877777`）**：IntCyberDigest 安全新闻（印度 CA eMudhra 8 张证书私钥泄露，其中一把本应 116 位的私钥**就是「4」**，496 万浏览）发布约 1 天后，CZ（@cz_binance，1299 万粉）回复玩梗「A large part of the internet was encrypted by '4'. 🤣」——**主推发布 1 分钟内**发币 RSA4（名字=RSA 算法+那把「4」私钥，exact_match 0.58）。J1.100 判 `event_quality_veto=event_negative_hard_news` 0.88（J1.38 安全事故族边界）→ mapper 负面硬新闻门拦 low；但同票 **strong_fit 0.87 / E 类 0.7 / within_7d 0.97 / S 级 / new_angle_on_original / 词句 acceptable 0.71 / 载体门已过著名免形象豁免（CZ 在册）**——其余门全绿，唯一拦截臂即 nhn 一票否决。这是「圈内强相关安全事件 + S 级作者本人玩梗」形状：TLS/证书/私钥是 BSC 用户天然懂的话题，CZ 的调侃是圈内可玩的梗，与 J1.38 想拦的「消费苦难/灾难猎奇」距离远。
- **裁定（用户）**：「去掉 negative_hard_news 得了，直接让 web3 契合度去处理」——负面事件是否有 meme 玩味空间、值不值得玩，不再由第一层质量否决一刀切，改由第二层 `web3_user_event_fit` 判（C140/C145/C150 同构第三例：质量层桶逐个交口径层）。接棒链条=**unfit≥0.5 负门（J1.19）+ C141 sf+fit<0.5 通用硬门**——真不适合 web3 用户的负面事件（纯灾难猎奇）fit 会低，口径层拦得住；圈内梗型负面事件（本案）strong_fit 放行。
- **改动（J1.101）**：①题集 `event_quality_veto` 删 `event_negative_hard_news` 桶（J1.11/C9 bitget被盗案立、J1.38/C98 粉豹法国骚乱案扩政治暴力边界——**整门退役**），instructions 删「是否负面」维度描述+加迁移句，版本 bump J1.100→J1.101；②mapper：`BLOCK_SCOPE.event_negative_hard_news` 显式空域（防旧缓存行/旧 fixture 重放照拦，C145 先例）、`negativeHardNewsBlock` 概率门删除（门链臂退役）、audit `negativeHardNewsMass` 键退役（历史行保留展示）、BLOCK_LABELS 保留（防未知选项 fallback 打裸键名）；③第一层质量概率门至此全部退役（rcp J1.87/nhn J1.101），argmax 链只剩 empty_content/baseless/ip_reuse 三桶，web3UnfitBlock 升级为事件质量/口味唯一否决入口。
- **验证**：`_test_web3_fit` B10 翻面为退役反证（旧形状 nhn 0.6 不再拦，同票 unfit 0.7 接管拦截）；`_test_bluechip_dedup_gate` B4 链首先手改锚 web3UnfitBlock+源码反证锚（`function negativeHardNewsBlock` 不存在）；`_test_name_entity_acceptance` D5b 桶集断言翻面；`_test_jev_question_consolidation` A8 桶数 5→4；版本断言全仓 grep 替换（C119 纪律，13 文件 14 处）。18 个受影响单测全绿（_test_cashtag_w_route B1c/B5 两处为 **C154 删 W 正向时效表的存量失败**，stash 对照原版同样挂，与本 case 无关待另修）。
- **回归票**：收录 RSA4 本票（C170，expect=mid|high + reasonExcludes 负面硬新闻，**意图断言 fail-first**：收录时现行行仍为旧门拦的 low，J1.101 部署重析对拍后翻正）；票数 50→51（F2 同步）。**C98 粉豹 `0x9df97d42…7777` expect 待重析后 update**（现行 expect low+reasonIncludes「负面硬新闻」锚在本门上，删门后拦位消失，新死因由 fit 层/量级门/名字门何者接手需 182 定向重析实证再改写，--update-expect --because 留痕）。
- **部署**：182 pull + 定向重析 RSA4/C98 → C98 update-expect → 全量 51 票回归对拍 → 重启叙事 worker 与 live 引擎进程（题集版本变更，C84 直调/触发链路在引擎进程内生效）。

### C169 知识注入 twitter_exact 臂退役——「同 Dev」不作叙事关联（2026-10-22 用户裁定「同一个 Dev 发的绝大多数代币叙事根本无关」）★

- **案情（C138a 收录牵出）**：Heyi.ai 本票 `0xa1cb5a59…7777` 收录回归集（C138a，用户裁定「最热票肯定 high」）后排查其知识注入——BINA 复刻票 `0x3384960b…7777` 的注入命中 Heyi.ai 蓝筹条目（twitter_exact @goldencatdev，注入段带「本系统评 low」叙事给 Jev 当背景）。先做三轮对照实验（原状 / 摘 Heyi.ai 注入 / 连 quasi Bina 全摘）：stateChars 5428→5331→5130，关联题 acceptable↔unacceptable 反复横跳——**注入非稳定致拦因素**（真因=Jev 非确定性，该票语料通篇无币名=J1.99 豁免边缘形状），但实验暴露机制问题：**同 Dev 前作被当叙事背景注入**（GoldenCatDev 是高频部署者，Heyi.ai/C138/BINA 复刻都是他发的，叙事互不相干）。
- **裁定（用户）**：「通过『同 Dev』关联信息不恰当，因为同一个 Dev 发的绝大多数代币叙事根本无关」——部署者账号同号 ≠ 叙事相关。与 C168 撤去重 twitter 臂同判据：twitter 字段=语料出处/部署者账号，既非票身份（C168 结论）也非叙事关联（本案结论），两条链路（注入/去重）现都不消费。
- **改动**：`knowledge-matcher.mjs` matchKnowledge 规则 2 twitter_exact **退役**（源头不评估，原位注释留档防复活）；RULE_ORDER 六级→五级；`matchInput.twitterHandle` 保留参数形状但不再归一化不消费（analyzer 调用侧零改动=最小侵入）。单测 B2-B4 改退役反证：twitter 同号落 name_exact / 同 Dev 无关票零命中 / 条目裸 handle 同号零命中。
- **影响面**：①高频部署者（GoldenCatDev 等）前作不再作注入背景；②C106 TREE 原 high 85.15 含 tcryptochicks 姐妹 twitter_exact 注入（C165 时唯一实质漂移源、用户曾裁 expect high 收口）——退役后重析验证，结果呈报裁定；③蓝筹库条目 twitter 字段保留（数据不删，规则退役；与 C168 同惯例）。
- **部署与验证**：worker 重启（代码变更，数据热载不覆盖代码）→ 定向重析 C106/C138a → 全量回归 50 票。
- **C106 裁定收口（同日第三轮裁定）**：退役后 C106 重析回 low（卡载体门），与上午「expect high（85.15）」裁定冲突呈报——**用户裁定：维持 high 作 fail-first，「不要因为不符合预期就改结果」**（原则性表述：expect=意图断言，引擎实际≠预期时不改 expect 改引擎；--update-expect 只在意图本身变化时用，不因摇摆/漂移自动改）。当前 FAIL 即 fail-first 生效，等引擎从正当路径（名字/语料证据，非同 Dev 背景）放行。C138a Heyi.ai 本票同语义（expect high fail-first）。退役后全量回归 50 票 39P/6F/5O：C101/C114 摇摆回 PASS；C133 股城本轮翻 FAIL（阈值抖动既有域）；C94/C109c/C162 摇摆域。
- **C109c expect 裁定（同日第四轮，2026-10-22）**：C109c BI `0x3891aeb8…7777`（摇摆域票）原 expect=low（2026-10-21 以引擎实际结果收录）——**用户裁定 expect 改 high**（同簇 C83a 94.27 / C83b 92.14 均 high，本票摇摆域内 high 面 78.61 与簇一致）。改后定向重析 high 79.12（名图一致豁免 J1.30+事件分 58.2）直接 PASS——意图与引擎对齐后 C109c 退出摇摆 FAIL 名单，回归终态预期 40P/5F/5O。

### C168 蓝筹去重门——新票 name/twitter 双 exact 撞已验证蓝筹 → 门链首臂拦 low（2026-10-22 用户裁定两轮）★

- **案情**：BIAOQING 三连发 `0x329c64d1…7777` / `0xa3b903b4…7777` / `0x923168f0…7777`（The Chinese Bear，2026-10-22 07:30-07:31 一分钟内三张）全部评 high 94-95 并自动回写 quasi-feedback——同一分钟三张同叙事票全过线，没有「这叙事已经有冠军票」的概念。用户两轮裁定合并口径：**「新发的票，如果跟老 meme 币蓝筹重复（BIAOQING 三连发），那么肯定要拦住；如果是跟近期新发的小蓝筹币重复，则不需要拦住」**——撞已验证蓝筹（b: 域，ATH>$1M curated 库=叙事已定型出过冠军）= 纯复制品，入场资格否决；撞近期新发小蓝筹（q: 域=quasi feedback/graduations，未验证 $1M）= 短期热门叙事连发姐妹票，meme 常态不拦（BINA 复刻 C162/C163、毕业姐妹 C106 形状天然放行）。
- **机制（C165 知识库的消费臂，mapper-only 不 bump 题集版本）**：①检测 `detectDuplicateNarrative`（knowledge-matcher 导出纯函数）——复用 matchKnowledge **窄输入独立跑**（`address:null` 使 address_exact 不触发、`corpusText:''` 使 corpus/concept 级不触发=只可能命中 twitter_exact/name_exact 两级）+ 过滤 `kind==='bluechip'` + `selfAddress` 自排除（蓝筹本体票重析不误拦自己，如熊猫头 0xf352…4444）；maxEntries 放大 50=**门检测不依赖注入截断结果**（maxEntries=5 封顶可能把 exact 命中挤出，此为注入防噪不适用于检测）。②analyzer 挂载（NarrativeAnalyzer）：twitterHandle 提升出注入 try 块（`knowledgeHandle`）——注入与去重两条消费**各自旁路不连坐**（匹配失败不废去重、去重抛错不废注入审计）；开关 `knowledgeBase.duplicateGate`（缺省=开，显式 false 单独关去重不影响注入，残缺 throw）。③mapper 门链**首臂**（jev-result-mapper，NHN 之前）：资格否决先于内容质量评估，label 归属干净（撞蓝筹票不再被 NHN/unfit 等 label 掩盖）；`eventScoreBlocked=true` → rating low；Jev 照跑留完整档案（区别于 pre_check fail 形状）；审计 `bluechipDuplicate:{rule,entry,entryId,matchedOn}` 命中才落（subjectCarrierBlock 同款模式）。
- **刻意边界**：quasi 全忽略（裁定核心）；name_substring 不拦（哭哭奶龙×哭哭马 C151 有意义变体）；corpus_contains 不拦（背景注入语义 C165）；prestage 路径不接（C72 先例）；**rule 0.52 谱系接棒**——引擎侧同名蓝筹门 2026-09 废除时裁定「同名≠蹭名，移交叙事层」，本门=叙事层用 curated 蓝筹库+双 exact 接住（判据从宽口径同名升级为 curated 库+双 exact）；存量 token_narrative 缓存不重析=旧结论不变。
- **数据修复（事故现场反证）**：熊猫头蓝筹条目原 aliases 只有 `["Panda Head","panda-head"]`——三连发 symbol=BIAOQING/name=The Chinese Bear **撞不上**（用户点名案例反而漏拦）；补录 `BIAOQING`+`The Chinese Bear` 两路 alias（symbol 路+name 路）后实测命中（单测 C 段真实条目形状反证锁定）。
- **验证**：`_test_bluechip_dedup_gate` 32 断言全绿（A 检测真值表 10 组：exact 两级命中/quasi 全等刻意不拦/substring·corpus 不拦/自地址排除大小写不敏感/address 传入被忽略/空形状/多条截断免疫；B mapper 臂 4 组：无证据对照原评级不变/证据→low+reason+audit/twitter label 带 @handle/链首先手 NHN；C 源码口径 10 条：analyzer 接线+旁路 catch+开关默认开、mapper 链首序+审计键、config 段、熊猫头 alias 数据口径+三连发形状实测命中）；knowledge 系 5 件套回归 116 断言全绿。
- **回归反证：twitter_exact 臂上线即撤（同日）**：首轮全量回归 48 票 **9 票被本门误拦**（29P/13F/6O）——twitter_exact 撞 8 票（@czbinance 系拦 C96/C108、@binance 系拦 C109a 交易猫/C110 币安菠萝/C83a/C83b BI 簇、@heyibinance 拦 C138、@goldencatdev 拦 C162 BINA）+ name_exact 拦 C137。归因：**蓝筹条目的 twitter 字段记录的是该票引用的语料源而非票的身份**——库里 24 条 twitter 撞源条目（15 蓝筹）绝大多数是借壳大 V（binance/cz_binance/heyibinance/GoldenCatDev，如龙虾/CZ/币安人/宇宙所/Heyi.ai 等借壳票本身入册蓝筹），后来的票引用同一大 V 的推 ≠ 复制品，恰是「短期热门叙事连发多票」的另一种形态；且直接顶翻 C109a/C110/C83/C138/C162 五个用户裁定票（C162「相信叙事的陈述」在案）。裁定：撤 twitter 臂，**门只认 name_exact**（BIAOQING 案本就是 name 撞）；撤臂反证锚入单测（34 断言）。撤臂后回归 35P/7F/6O：twitter 误拦全消，C109a/C110/C83a/C83b/C96/C162 全回 PASS；剩 FAIL=C137（本案）+C138（本案）+C94/C106/C109c/C114（C165 摇摆/C167 首轮验证域，非 C168 引入）。
- **C137 裁定→条目级豁免（同日用户裁定）**：「『memes will continue』口号泛名真撞蓝筹不算——memes will continue 蓝筹是白宫说的，现在这俩名字一样，但**本质叙事不一样**」。判据升级：**名字全等 ≠ 叙事同一**——「独占 meme 名」（熊猫头=15 年老 meme 专属）拦，口号级泛名（白宫口号）/同部署者连发名（非独占）不拦。落地=**条目级 `dedupExempt: true`**（corpusTrigger 同族数据开关，manual-entries 同 id 整条覆盖标记，默认拦+逐条人工豁免）：①b:0xf745…4444「memes will continue」（白宫口号叙事，用户明裁）；②b:0xa1cb…7777「Heyi.ai」（同部署者 GoldenCatDev 同叙事连发+本条目系统自评 low=借壳蹭票过 ATH 线入册，名字撞它不应拦 C138 用户裁定票——同形状推断豁免，可撤）。检测过滤 `!entry.dedupExempt`（find 跳过豁免条目继续扫：同票撞豁免+未豁免两条时未豁免者照拦）。单测 38 断言（A11 豁免三例+manual 豁免条目在册数据口径）。实弹：C137→high 96.61 / C138→high 91.01 恢复。
- **终态（第三轮回归 3178190 部署后）**：36P/6F/6O——**C168 域 FAIL 清零**（13F→7F→6F：twitter 误拦 8 票+豁免 2 票全修复），门净效应=只拦 BIAOQING 形状真复制品。剩 6 FAIL 全非 C168 域，移交归因：C94/C101/C162=Jev 非确定性摇摆票（C165 已实证域；**C162 J1.99 收口时三跑稳定 84 high，本轮两连 low「关联性不足」需另查**——J1.100 新条件题入 state 可能改变答案分布）；C106 同日收口（用户裁定 expect low→high：重析翻 high 85.15 没问题——C165 遗留的「姐妹票 twitter_exact 注入漂移待裁」终结，6044442）；C109c/C114=C167 J1.100 **首轮全量验证漂移**（C167 部署时未跑回归；C114 DND 奠基票「不翻」预期未达成，仍被载体门拦，需定向重析看 subjectCarrierReferentVeto 审计键）。
- **回归票收录与 expect 更新（同日用户裁定）**：①收录三连发主票 0x329c64d1…7777（C168，expect=low，锁门防线）；②**C121 牛来 0x3618d122…7777 expect high→low**——被门拦（name_exact 撞 $163M 大蓝筹 0xbeea1d61…7777「牛来」，币安 Discord 牛来梗冠军票，同叙事同名复制品），用户裁定「被拦没问题」；该票名字门本来就是 7:8 边缘掷骰票，去重门给出确定性拦截位。资产提交 b40c794（含 10-20 起多轮结果存档）。
- **部署**：182 pull + 重启叙事 worker（代码改动，知识文件热载不够）；重析 0x329c64d1…7777 实弹验证翻 low（reason=蓝筹去重：撞已验证蓝筹叙事（name_exact:熊猫头）→ 撤臂后 label=（熊猫头））+ 撤臂后全量回归重跑；三连发是否收录回归票待裁定。

### C167 移出 @BinanceAngels（误登记超级IP条目）（2026-10-22 用户裁定）★

- **案由**：`binanceangels` 原在 super-ip 注册表机构类（`type:'institution'`/`tier:'A'`/desc「币安天使投资」）——但 @BinanceAngels 实际是币安**社区大使/志愿者项目**运营号，不是投资机构（desc 系误登记）。superIP 消费臂**只看在册、不看 tier**：在册即与 CZ/币安官方同权——C117 强制标准路径（绕过 prestage 账号判定）、C139 著名免形象资格（J1.29 载体门整门跳过）、J1.58 empty_content 作者豁免、J1.56 作者原话票（主推逐字含币名即命中，不看语义）、J1.24 可信事件锚、C51 GMGN 推文补源例外、C132 缺粉时的用烂风险证据。社区运营号的日常活动推不配这套权重。用户裁定移出。
- **改动**：注册表删除该条目，原位留注释防误加回（`super-ip-registry.mjs`，删除位置在 binanceus 与 bnbchain 之间）。**JEV_QUESTIONS_VERSION 不 bump**（注册表非题面，state-only；C137 增 eth_cedric / C165 同例）。全仓无其他 `binanceangels` 引用；HIGH_INFLUENCE_ACCOUNTS 名单不含该号，无需同步。
- **影响面（仅命中该号的票）**：恢复普通账号路径（prestage 账号判定可进）；state 不再注入 `corpus_author_identity` 认证行；`corpusAuthorInRegistry=0` → 载体门/空洞门/作者原话票/可信事件锚全部回到普通口径；GMGN 补源回到 C10 语义；回复/引用它的推不再是 interpretive_reply；缺粉旧推不再按在册判用烂。**已缓存 token_narrative 行不重析=存量结论不变**（注册表只在分析时消费）。
- **验证**：superIP 相关单测 6 项全绿（`_test_superip_standard_path` 20/`_test_superip_no_prestage_route` 14/`_test_superip_slogan_class` 52/`_test_gmgn_superip_tweet_enrich` 15/`_test_narrative_timing_probe` 42/`_test_rule5_pass_through`）——测试只锚 binance/bnbchain/cz_binance 等条目，无 binanceangels 依赖。
- **部署**：182 pull + 重启叙事 worker 生效；不改题面版本，case-regression 无期待翻转（重建 state 逐字复用线上语料的纪律不变）。

### C167 图证豁免载体性质第四臂——配图=名字所指物实录 ≠ 形象载体（J1.100 image_carrier_nature）（2026-10-22 用户裁定「方案 A」）★

- **案情**：0x4ded0c77fcaa9bec730e450d48abb4192a647777「梗王大乱斗」（four.meme，event:E）S 档 92 high 放行。名字=抖音手搓网页游戏标题（@kenyarafiki 找角度推，配 3 图），载体题如实判 no_visual 0.85——但配图=该游戏界面截图（vision img-v3 转写：仿大乱斗对战界面，图内文字恰含 #梗王大乱斗# hashtag）→ name_image_consistency 按题面字面判 same_entity 0.65+same_visual_category 0.22=**0.87**（match 臂，「图内文字写明其名」半句正是为巴巴鸡抖音截图写的）∧ image_depicts_name **0.98**（演绎臂，「游戏叫大乱斗、截图正在乱斗」被判为演绎）→ C109/C118 图证豁免救回载体门 → high 89.81=rating 3 过买线。用户挑战成立：「梗王大乱斗是一个游戏，没有一个可视化的形象IP跟它匹配，配图也是游戏」「这是叙事本身的问题」。
- **洞的本质**：豁免把「名-图所指对应」当「载体存在」用。奠基票所指物都是**具象形象**（交易猫的鸡/DND 的猫/短尾猫的猫）→ 对应成立即载体成立；本票所指物=**非形象事物**（游戏），配图=所指物实录，证明的是所指存在（E 类事件分已在量），不是形象载体存在——名图一致/演绎对「所指物本身」是**同义反复**（真香蕉锚：香蕉图就是香蕉，实录非演绎——该锚已在 depicts 题内但被「截图在字面乱斗」绕过，且 match 臂无此防线）。Jev 三题都按题面字面答对，失真在豁免判据语义前提，非校准。
- **改动（J1.100）**：新条件题 image_carrier_nature 三档（carrier_visual/referent_itself/unclear，仅 imageConsistency 时问=与 10.7/10.8 同条件，条件题 18）——问名字与配图的对应是否落在【形象】级；题面两锚=①事物自我实录不算演绎（它在干它本来干的事，非为名字含义配的画面）②截图内第三方 IP 形象属原 IP 不因出现在所指物实录里就成为本币载体。mapper（jev-result-mapper）imgCarrierOverride 与 emptyContentImgCarrierOverride（C159 近 tie 臂）统一加第四臂 carrierNature==='carrier_visual' 才豁免；referent_itself/unclear/答案缺失 fail-closed 不豁；审计键 subjectCarrierReferentVeto 命中才落（stage2 主段+stage3 段同形；与 subjectCarrierImgOverride 互斥可辨）。**J1.30 imgNameExempt 关联豁免不消费本题**（名实一致对关联豁免仍成立，豁免面不互扩——名字与图确为同一所指时弱字面关联的代价仍在分数上体现）。
- **刻意边界**：C159 近 tie 臂同受管但 DND 掷骰防抖语义保留给形象票（nature=carrier_visual 照豁）；C114 empty_content 门图证豁免**不动**（那是内容存在性问题非载体问题，本票 emptyContentMass 0.01 未触）；著名免形象/authorUtterance/C160/C161 豁免正门不受第四臂影响（它们不依赖图证）。存量 token_narrative 行不重析=旧结论不变（mapper 消费时点在分析期）。
- **验证**：新单测 _test_image_carrier_nature 22 断言全绿（A 事故现场反证：nicMatch 0.87+depict 0.98 两臂够阈+nature=referent_itself → 载体门照拦 low+两审计键互斥；B 奠基票 carrier_visual 照旧豁免；C/D 答案缺失与 unclear fail-closed；E C159 近 tie 臂同受管；F J1.30 零污染；G 无图票 bit 一致；H 源码口径四反证）。存量套件同步：_test_subject_carrier（交易猫/E 覆盖形状补第四臂答案）、_test_image_depicts_exempt（dndAnswers 基座补 carrier_visual+H1 源码形状改双条件+H5 版本钉）、_test_empty_content_img_exempt（近 tie fixture 补第四臂+H3 版本钉）+ 版本钉批次 11 件（name_image_consistency/brand_hijack_pun_exemption/angle_timing_override/jev_question_consolidation/jev_finding_recap_statement_gate/jev_resonance/name_entity_acceptance/narrator_two_shapes/referent_memeability/superip_standard_path/w_bsc_user_appeal）全绿。182 定向重析+全量回归待跑（预期：本票 → low+subjectCarrierReferentVeto；C109 交易猫/C114 DND/C159 短尾猫/C158 智能时代四奠基票不翻）。
- **部署**：182 pull + 重启叙事 worker（J1.100 题面）；回归票收录 --add 0x4ded…7777 --case C167。

### C166 账号信息复检卖臂——持仓期宣告账号删号/删推检测 → issuerAccountState 因子全清（2026-10-22 用户裁定四项）★

- **案情**：C164 官网核验案的交易侧延伸——SL `0x58417f3f…affff` / FOURGE `0xf9de0ca2…ffff` 一次性专号 rug 家族买入后 3 分钟内同块协同砸盘 -56%，价格止损（-35 静态甜点）永远吃残值；账号删除/宣告推删除是**比价格更早的 rug 前兆**。用户四裁定：①删推判据=宣告推被删 OR 推文清零（不含推文数骤降）；②复检窗口=持仓前 10 分钟每 30s 高频+之后每 2min 低频持续到清仓；③适用票=所有有宣告账号的持仓票（不限叙事类型）；④卖臂走双门确认（bypass=false，与现行全部卖腿一致）。
- **设计四层**：①检测服务 `AccountHealthMonitor`（GmgnRiskCheckService 同款组织）：裸调 apidance `getUserByScreenName`+有宣告推时 `getTweetDetail`，四态 active/deleted/tweets_gone/unknown；**防误报三防线**=删号只认「用户不存在（apidance 空响应骨架）」特异 message（new-apis C53 分支；HTTP/网络故障走「用户信息获取失败」分支结构性不误判）、删推严格 `tweet_id` 全等比对（getTweetDetail 对不匹配 ID 有 tweets[0] 宽松兜底坑 :311-320）、失败归 unknown 保留上次确定值不回拨（fail-open 不置信号）；per-handle 30s 结果缓存+inflight join+连续失败退避。②引擎接线（FourMemeWssTradingEngine，Flap 子类继承）：start() 30s interval 扫描 `_getAllHoldings()`，宣告账号**懒解析**（dbManager 直查 token_narrative.twitter_info 最新行，tweet 型取 author_screen_name+tweet_id、account 型取 screen_name、无则负缓存防每轮重查），双档节流按持仓时长（firstHeldAt 首见时刻），fire-and-forget 回填；回填竞态防线（清态后晚到结果丢弃）；清仓自清理；再买入重置（买入成功点 `_resetAccountRecheckFor`——sold 票 20min 可再买，残留 deleted 会误卖）；stop 逐 token 清 FA+destroy。③FA 因子 `issuerAccountState`（narrativeCategory 同款字符串因子）：模块级 Map 三件套+`_buildFactorMap` 字面量投影，unknown 投影 null（故障不产生信号形状），探针自动收键（三防线零校验改动）；FactorBuilder 快照白名单透传。④卖腿（库条目 `rug-exit-account-arm`，sell 侧新条目——库已有 sell-cold/hot/mid/protect 老条目，非首例）：`issuerAccountState == 'deleted' OR issuerAccountState == 'tweets_gone'`，cards:'all'/priority:2（与 -35 止损臂同级）/bypassDebounce:false（双门确认 3.5s+5tick）/maxExecutions 不设（卖出失败每轮重试）；null（未检测/无宣告账号/unknown）恒 false fail-closed 不误卖。config `fourmemeWs.accountHealthCheck` 默认关（gwp 物化语义），实验级显式开。
- **刻意边界**：回测零接线（动态网络数据对历史 fire=时序穿越，gwp/TTL 穿透同款裁定；因子恒 null 卖臂恒 false 零影响，源码正则单测锁死）；不走 TwitterFetcher/CachedFetcher（缓存层失败写 1h 冷却行会吞删号/删推信号——**裸调红线**）；lazy 解析 DB 查询带 60s 错误重试节流；apidance 配额未知，失败退避+per-handle 去重兜底（频繁 429 再议降频）。
- **验证**：三单测 60 断言全绿（`_test_account_health_monitor`：四态 9 例+缓存/inflight/退避+超时竞速+源码口径锁；`_test_fa_issuer_account_state`：三件套/投影/真 ConditionEvaluator 真值表含「null 对 != 恒 false」事故反证/探针收键/回测不接线反证；`_test_account_recheck_engine`：懒解析/双档节流/回填竞态/清仓自清理/再买入重置+源码口径）+存量 11 项（fa_narrative_factors/narrative_trigger_condition/stop_loss_rules 等）全绿；`_test_fourmeme_fa_factors` 键集白名单 44→45（issuerAccountState 刻意新增）。部署脚本 `deploy-c166-account-arm.cjs`（validateLegs 纯函数预检+防重复+库幂等）。
- **部署（2026-10-22 执行）**：用户裁定**并入 v29 一批上线**——停 v28（3 粉尘持仓 e-11 级 totalValue==cash 零价值，披露）→ 人气门案 create-v29（v29=b2f02dce-…ff27）→ `deploy-c166-account-arm.cjs --exp <v29id> --commit`（库条目 416dc5de-…0447 + 卖腿 16→17 + accountHealthCheck 开）→ v29 启动回查 18 策略/双 collector/复检扫描静默零报错；「宣告账号复检接线」日志待首笔持仓观察。

### C165 叙事分析知识库——蓝筹/准蓝筹/BSC 概念三类背景匹配注入（2026-10-22 用户裁定三项）★

- **案情**：理解代币叙事常缺背景知识（理解「彪弟」需知「彪哥」；「哭哭奶龙」需知「哭哭马」），系统无背景致一簇误拦（C129 彪弟案为典型）。用户三项裁定：①蓝筹口径=**ATH 市值>$1M**；②**反馈回写要**（分析完自动沉淀客观字段，不让 LLM 自由编写）；③**标准 Jev+prestage 双路径都注入**。编号归属：并行官网核验案先入台账得 C164（L85 裁定），本案改用 C165。
- **机制（5 文件聚合，`src/narrative/analyzer/knowledge/`）**：`config/knowledge/{concepts,bluechips,manual-entries}.json`（进 git）+`data/knowledge/{quasi-graduations,quasi-feedback}.json`（不进 git），合并序后读覆盖同 id；id 域 `b:`/`q:`（feedback 与 graduations 同域=沉淀优先）/`concept:`。匹配 6 级规则 address_exact>twitter_exact>name_exact>name_substring（LCS，CJK≥2/latin≥4，concept 不参与）>corpus_contains（concept 无门——全名语料提及是有意义信号，C129 设计路径）>concept_keyword；防噪三防线=代码 denylist（只压 substring/corpus）+条目级 corpusTrigger:false+maxEntries=5 封顶。注入 `[KNOWLEDGE_BASE]` header 级独立段（≤2000 字符不占四区配额+免责声明；null/空命中 bit-parity）；命中挂 `raw_api_data.knowledge_matches` 审计。loader mtime 热载免重启；config `knowledgeBase` 段缺/enabled:false→null 静默关，残缺 throw fail-loud。**JEV_QUESTIONS_VERSION 不 bump**（state-only 上下文，C76/C83 先例）。
- **builder（182 only）**：蓝筹=GMGN 三榜 24h×{marketcap,renowned,volume}各 100→getTokenInfo 逐票 ATH 验证→叙事富化（token_narrative+experiment_tokens）→`--commit` 快照进 git push；准蓝筹=trenches completed 两平台→7d 窗+`wss_events` graduation 点查（GMGN 索引时间晚链上 ~9min 只作粗滤）→`data/` 落盘。**Phase 0 冒烟实证**：GMGN `ath_price` 偶发污染（XRP 克隆票 2190×supply=$713B 全球不可能）→ **$20B sanity 上界**越界降级 current floor 留痕 `sanity_floor`（G 组单测反证锚定）；trenches 行 twitter 键=`twitter_handle`（twitter 键=status URL 杂烩）、毕业时间=`complete_timestamp`；normalizeTwitterUrl 三形状归一（status URL 剥 handle/搜索页 null/非 twitter URL 不冒充）。
- **部署（2026-10-22）**：bluechips 153 条（c93c7b4 从 182 提交推送）/quasi 65 条/concepts 5 条（含彪哥人工种子 concept 条目：alias「小彪哥」承接 C129 票 raw name）；worker 已重启（config 段生效，此后知识文件热载）。
- **回归（47 票 36P/6F/5O）+归因**：双红线达成——**C129 彪弟 PASS**（high 86.89，alias name_exact+宣告推语料双路命中）、**哭哭奶龙 C113 PASS**（high 91.85）。6F 剥离归因：①**Jev API 输出非确定性实证**——02:13↔03:51 两轮零代码变更（C165 代码 04:10 后才到 182）翻 4 票（C94 PASS→FAIL、C114 PASS→FAIL、C162 PASS→FAIL、C129 FAIL→PASS），C94 unknown 56%↔54% 为 argmax 边缘摇摆形状；②知识库唯一实质漂移=**C106 TREE low→high 83.44**：quasi 姐妹票「翱翔天际的巨鸟」twitter_exact 同号（tcryptochicks）注入同 issuer 前作毕业背景。**待用户裁定**：twitter_exact 姐妹票注入=特性（同 issuer 前作是真背景）or 噪声（C106 expect low 是否 update）；C94/C114/C162 摇摆票处置（非 C165 引入，属回归基线固有噪声）。
- **缺陷修复（回归现场反证）**：**feedback 自反馈排除**（ab0e2f9）——CUR 轮回归中 22 票 high 逐条回写 quasi-feedback，其中 C106 票（BNB Tree high）自己入册 → 下轮 address_exact 命中自己「本系统评 high」=自锚定锁死（reanalyze 目的是重新判断，上轮主观评级不得当本轮证据）；`excludeSelfFeedback` 纯函数挂 analyzer+prestage 双点，蓝筹（客观 ATH）/graduations（客观毕业）自命中保留，feedback 姐妹票跨地址保留；J 组 5 断言。
- **manual 补录首例：熊猫头（2026-10-22 用户裁定「典型蓝筹币」）**：`0xf3525965a4ad3ca0ac13f4d2f237113691194444`（熊猫头/Panda Head，four.meme 生态本体 meme，82,687 holders）——ATH 市值 **$4.05M**（CG ath.usd $0.00405×10 亿流通，2026-09-06）超 $1M 线 4 倍但已掉出 GMGN 24h 三榜=builder 抓不到，走 manual-entries 人工兜底（设计用途首例）；narrative=CG 简介同款 cleanCoinGeckoDescription 清洗（与库内 CG 条目同形状）；alias 含 Panda Head。起因=BIAOQING case（`0x329c64d1…7777`，The Chinese Bear，event:A high 94.42）——表情包族票分析时语料提「熊猫头」经 corpus_contains 注入背景。本地三路径实测：同名票 name_exact 命中/语料提及 corpus_contains 命中/不提及零命中无误报；95ba6cb（含 182 pull 热载，总条目 279）。
- **叙事补齐 `--enrich-desc`（2026-10-22 用户指令「补一补叙事吧」）**：盘点发现蓝筹 153 条有效叙事仅 6 条（主体=身份信息），补齐走 **CoinGecko 公开简介**（客观外部数据源，非 LLM 编写——合「不让 LLM 自由编写知识」裁定）。两级来源：`--enrich`（token_narrative/experiment_tokens/AVE）优先，`--enrich-desc` **只填占位**（空/「本系统评 X」/≤12 字，`isPlaceholderNarrative`），已富化条目绝不覆盖。匹配收紧宁缺毋冒配：symbol 全等 ∧ name 全等或词级前缀（词内包含拒配：NIGHT↔Midnight、XRP≠XRping，K3-K7 反证）；清洗剥 HTML 实体/≥20 字/截 320 句号边界；审计 `narrativeSource:'coingecko'`（K11/K12 透传）。**限频事故（182 实测）**：CG 免费档 ~10 req/min 且有突发惩罚窗——7s 限速仍每请求吃 429（65s 退避后成功）、连拉 90+ 条后惩罚窗内全 429（连续 5 轮 exit 2 ×2、冷却 10min 第三波仍拒）；修复=限速 7s→15s（93a3b4a）+ 窗口恢复即断点续（cg-map.json 缓存 done/no-match+coins/list 全量）跑完，第四波零 429。**终态：153=53（CG 简介）+6（原富化保留）+94（仍占位——CG done 空简介+no-match；BSC 本土长尾票 CG 无页面/无简介是诚实结果，宁缺毋冒充）**；快照 626a64a 从 182 commit+push；COINGECKO_API_KEY（demo key 10k/月）可彻底解除限频，蓝筹周级重建时断点自动重试剩余。
- **运维红线**：①回归跑前知识文件必须全就位（commit 态）——**回归运行中 feedback 回写会中途改变知识态**（CUR 轮 quasi-feedback 首落盘于 04:23=轮中，污染对照条件），跑前确认 quasi-feedback 已存在且稳定；②builder 只在 182 跑；③蓝筹快照 commit 后须 push。手册 `docs/knowledge-base.md`。

### C164 项目币官网核验——prestage project 分支加门：看网站+查叙事才能过（P1.14）（2026-10-22 用户裁定）★

- **案情（一次性专号 rug 家族案，v28 exp a97e4f25 四连亏之二）**：FOURGE `0xf9de0ca25d667c7dedbc1765bb05680a1828ffff`（launchpad pitch，fourge.fun）与 SL `0x58417f3f9ac500ee40a3882119cbb8a4686affff`（sloploss.si）——一次性 creator EOA+买粉新推特号（各 1 币各 2 推，serial-issuer 门 C85 结构性失效），模板 pitch 一篇「产品陈述」即 prestage 粉丝带 mid（73/67 粉）→ narrativeRating==2 过买门；买入后 48s~3min 同块 8/9 钱包协同砸盘（2.06/2.23 BNB），卖出反应 4s 仍 -56%/-58%。**官网从未被看过一眼**（websiteFetch 默认关），事后取证 fourge.fun HTTP 000 死链、sloploss.si 503。**用户裁定**：「如果是原生项目币，一定要看一下网站了（其它类型不需要），也检查一下代币叙事，没问题才能给过」+ 两项配套裁定：①无官网**仅基础设施/平台类宣称才拦**（launchpad/交易平台/工具平台/数据服务——产品本体就是网站，无站=无产品；内容/文化/社区型无站不拦）②**网站抓不到=拦**（fail-closed）。同案提案 D（协同砸盘簇黑名单）用户否决「容易误伤」，方向改画像库买前门（另行裁定，不在本 case）。
- **机制（分层四段，P1.14 bump）**：
  1. **代码端事实层** `resolveWebsiteCheck`（account-analysis-service）：addressVerified=true 才抓（project 分支消费；abm/web3ip 题恒带但不消费）；URL=classifiedUrls.websites 桶首个**非聚合器自动页**（C99 红线沿袭）；三态 reachable（抓到）/unreachable（有站抓不到）/none（无有效站）——reachability 是代码判定，Jev 只判内容与宣称；isProjectCoin 路径已抓过的站直接复用零重复抓；抓取复用 `fetchWebsiteContent`（jina 回退保「源活着但被反爬挡」不死判 unreachable；timeout=config `prestageWebsiteCheck.fetchTimeoutMs` 默认 10s）；**失败缓存 null sticky**（1h 冷却）——同 token 重析同形状照拦，与「抓不到=拦」方向一致；config `prestageWebsiteCheck.enabled` 默认开（显式 false 才关，关=state 无行→Jev 默认 pass 臂→门惯性放行）。
  2. **state 注入**（jev-state-builder）：PRECOMPUTED 加 `website_check: reachable/unreachable/none` 状态行（unreachable 行明示「死链不等于没提供站」防 Jev 误读成 none）；reachable 时【网页内容】段携带（优先于旧 websiteInfo，isProjectCoin 路径内容同源 bit 一致）。
  3. **题面** `prestage_website_check`（恒带第 4 题，五选）：website_substantiates / website_shell_or_mismatch（空壳模板页/与宣告叙事不符）/ website_unreachable / no_website_infra_claim / no_website_non_infra；判据=web3 用户两分钟尽调视角，「简单但具体的站（做什么/功能/用法）即足够，不要求精致」；不要求实证产品可用（P1.7 裁定沿袭，只判抓到的内容）。
  4. **mapper 门**（project 分支唯一拦截位，题面改锚分不动）：substantiates/non_infra 放行走粉丝带；shell_or_mismatch/unreachable/infra_claim → **low 拦**（reason 带「→ low（C164）｜原粉丝带：…」可复算）；答案值异常（不在五选项）→ 同拦 fail-closed；answer 整体缺失 JevClient throw→9→C84 无信号；归因键 `details.websiteCheck`+`jevDetails.websiteCheck`+jev probabilities。
- **验证**：`_test_prestage_website_check` 43P（mapper 五臂+异常臂/不消费面三路/state 三态+功能关+双保险/resolveWebsiteCheck 六态含 throw 不冒泡+isProjectCoin 复用计数/接线源码口径锁）；三存量 prestage 套件 bump 后全绿（unrated_elimination 32/32、project_downgrade 32/32、web3ip_account_only 17/17——fixture 补 pass 臂）。
- **回归票**：FOURGE `0xf9de…ffff` 收录 C164（expect：rating low + reasonIncludes 官网核验未过/C164/粉丝73 原文——拦截位+粉丝带可复算）；SL `0x5841…ffff` 同案同臂（website_unreachable）按 C162「一案一票」先例不重复收录。
- **边界（诚实面）**：本门抓的是「连站都懒得维护」的一次性专号形状；**域名活着+模板页做得像回事的 rug 拦不住**（substantiates 判过）；网站正常的项目币 rug（有真站有真产品但砸盘）不归叙事层管——协同砸盘簇的拦截走画像库买前门（待裁定）。
- **部署（2026-10-22 执行）**：182 定向重析两票**双双翻正实锤**——FOURGE low「项目币官网核验未过（官网抓取失败（死链/超时/被拦——抓不到=拦））→ low（C164）｜原粉丝带：粉丝73 → mid」、SL 同款（粉丝67 → mid）；全量回归+worker/live v28 重启见后续。
- **事故与修复（同日）**：eae169a 提交时混入并行 knowledge 会话在三个共享文件（state-builder/account-service/config）的未提交 hunks，而 knowledge/ 模块本体未提交 → 干净 checkout ERR_MODULE_NOT_FOUND（182 重析首跑实证失败；本地测试未暴露=对方未跟踪文件恰在本地存在）。a57f242 从 55dd507 基底仅重放 C164 hunks 修复（git-only 不动共享工作树，隔离 worktree 验证 43/32/32/17 全绿），knowledge hunks 随并行会话整包落盘时自然回归。**C164 编号归属**：本官网核验案先入台账（C107 协议=先登记者得号）；并行知识库案代码注释亦标 C164，应改用 C165。

### C163 宣告采信豁免——关联题已有门内加豁免，不立独立锚（J1.99）（2026-10-22 用户裁定）★

- **案情（C162 遗留第三道拦截的裁定）**：复刻 BINA `0x3384960b…7777` J1.98 消除 wrong_entity 后暴露 Stage3 关联性不足（关联题 unacceptable 5 分 ≤10 截断，三次独立 Jev 调用稳定复现）。证据链：复刻票自身语料通篇无币名 "Bina"——宣告推只说 "the name is confirmed" 不点名、配图（总统 IG slide 截图）图内无名字（vision 描述在案）；名字与事件的关联全靠**部署者宣告+币名字段**承载。**用户裁定**：「代币[发]的推文的评论的截图中，有狗的名字出现，正是币名。但是这种对于一个程序，验证起来会非常麻烦，我认为还是相信叙事的陈述，走你推荐的加宣告锚，不过是不是不用加独立的锚，而是在已有的门中加入豁免」——采信陈述方向执行，但形式=**J1.92 关联题（已有门）内加豁免**，不立独立锚/独立审计键。
- **机制（题面 J1.99，mapper 零改动）**：关联题 instructions ③ unacceptable 行后 + acceptable criteria 尾部双处加「宣告采信豁免」——发币者自己的宣告推声称事件主体的名字已确认/已揭晓/就是本币名（如 "the name is confirmed / 名字已确认，就是本币 / name revealed"），且币名正是承载该名字的代币 → 用户读宣告即能建立币名与事件的关联，判 **acceptable 起步**（acceptable 15 分 > 10 截断线）；币名逐字出现在语料仍判 exact_match（20 分）；**不得因币名未逐字出现在语料文本/配图中而判 unacceptable**——验证宣告真实性不是本题任务（C79 TRUST PRINCIPLE 采信陈述同则）。题数不变；豁免只动题面锚点，门/分值/截断线全部原样。
- **验证**：12 文件 13 处版本钉死断言 J1.98→J1.99 bump 后 12 个题集套件 0 失败（433 断言）+ case 回归断言器 44 断言全绿。182 部署验证见下条 C162 部署验证后续。
- **回归票**：复用 C162 票 0x3384…7777（J1.99 后预期翻正，`--update-expect` 留痕；若未翻正=豁免措辞不够强，不得直接放过）。

### C162 双 BINA 案——零自有语料补轮臂（corpusEmpty）+ wrong_entity 交易池语句误读排除（J1.98）（2026-10-22 用户裁定「修吧」）★

- **案情（同叙事两张毕业票均被叙事层拒）**：CZ 新犬 Taigan 名字揭晓叙事，flap 平台同名 BINA 两票——**正主 `0xed71b42b07cc1664c0f82361d48d0417a6ed7777`**（13min 毕业 6.6×，最佳一档）与**复刻 `0x3384960b045905cea62da32ac5679177ee647777`**（38s 毕业 11×）。正主：首评 4s 时 classifiedUrls 各桶全空（宣告推 `@Whatsyourcards` 晚发 4min + GMGN link 聚合滞后，仅搜索兜底同名词噪声）→ rating=1，且非 accountOnly（桶全空不满足「twitter 桶非空」前提）→ 无补轮资格终局拒——**抢跑发币票的语料竞态形状，现有 accountOnly 补轮臂结构性覆盖不到**（入口=账号时间线 / 入口=尚不存在，两端）。复刻：tier S + strong_fit 0.67 全对，但 Jev 把宣告推里 "it should be paired to BNC"（**该币用 BNCB 做交易池计价币**——链上 token_quote_set quote_token symbol=BNCB 实锤）误读成「狗名应配 BNC、币名 Bina 指歪」→ wrong_entity 0.55 全域拦（用户纠正关键误读：这句是池子配置说明不是名字证据，定性=Jev 误拦非按设计工作）。
- **机制①（引擎/FA corpusEmpty 补轮臂，正主案）**：`NarrativeDirectCaller.hasNoOwnedCorpus`（纯函数：classifiedUrls 缺失或各桶全空=true）→ getRating 返回带 `corpusEmpty`（catch 路径显式 false——超时/异常语料形状未知保守不补轮）→ 引擎补轮资格扩第二臂：`rating==1 ∧（accountOnly ∨ corpusEmpty）`，**两臂互斥分流、双臂同真 accountOnly 优先（参数选臂不叠加）**；corpusEmpty 臂走独立节奏键 `narrativeRetry.noCorpusIntervalMs`（缺省 60000）/`noCorpusMaxAnalyses`（缺省 8）——60s×8=8 分钟窗覆盖宣告推/GMGN link 分钟级晚到；FA `_NARRATIVE_FACTOR_DEFAULTS` 四键、`narrativeRetryDue` 判据同步双臂（与引擎逐字一致双侧冗余）；BacktestEngine 四键全锁 `{Infinity,0,Infinity,0}`（回测禁补轮=语料前视防线不变）；语料到位后的轮次自然 corpusEmpty=false 转常规形状（真拒不补轮）。
- **机制②（题面 J1.98，复刻案）**：instructions + wrong_entity criteria 双处加显式排除句——交易池/计价配置语句（「paired to X / X pair / trade against X / 用 X 做交易对 / 流动性池计价币」）说的是这个币与 X 币配对交易（池子配置），与币名映射哪个实体、币名有没有指歪**毫无关系**，不得据此判 wrong_entity。mapper 零改动（门不变，靠 Jev 判读翻正，C151 先例）；题数不变。
- **验证**：单测新增三处全绿——`_test_narrative_trigger_condition` I 组 10 项（hasNoOwnedCorpus 真值表/60s 节奏到才发/8 轮上限/双臂优先/翻常规形状即止/异常保守 false）共 47P；`_test_fa_narrative_factors` H 组 7 项（60s 边界/8 上限/config 独立注入与非法值拒绝/回测锁死）共 37P；`_test_narrative_retry_config` C8/C9/E 组（route 校验 + 引擎接线形状）共 36P；J1.97→J1.98 全仓 13 处版本钉死断言 bump 后 12 个题集套件 0 失败。182 部署验证结果见下条。
- **回归票**：0x3384…7777 收录 C162（expect 锁稳定不变量 `rating low + reasonIncludes 关联性不足 + reasonExcludes wrong_entity`——类别在 event:A↔E 间摆动不钉）；0xed71…7777 作 corpusEmpty 补轮观测票（机制在引擎侧非题面，回归集不覆盖行为）。
- **182 部署验证（2026-10-22）**：①全量回归 46 票 **38P/4F/4O**——FAIL=C109c/C129/C133（上批已知三连，J1.98 零新增漂移）+ C162 自身（旧 expect 钉 event:A，见②后已按新 expect `--only` 复跑 PASS）；②**J1.98 生效实锤**：wrong_entity 0.55→**0.37**（<0.5 门不再拦，`nameWrongEntityMass=null`），三次独立 Jev 调用（全量/定向/复跑）判读稳定；fit 面全对（88 分 A 档、impactTier A、blockChoice none 0.87）。③**暴露下一道拦截（三次稳定复现，待裁定）**：Stage3 关联性不足（5 分/unacceptable）——复刻票自身语料通篇无币名 Bina（宣告推只说 "the name is confirmed" 不点名、总统 IG slide 图内亦无名字），名字与事件的关联全靠部署者宣告+币名字段承载；**叙事背景**：CZ 第二只狗=吉尔吉斯总统所赠 Taigan 猎犬（NYT 2026-10-01 报道），官方从未公布名字（语料："No name for the Taigan"/"we'll tell you the name later, Not Aikol"），"Bina" 是部署者宣称已确认的名字（正主 BINA 同叙事 13min 毕业 6.6×、复刻 38s 11×=市场接住了这个名字）；Jev 判 unacceptable vs 采信宣告推陈述（C79 TRUST PRINCIPLE）两读并存，是否加 J1.92「部署者宣告主体名+币名承载」锚待用户裁定。④live v28 a97e4f25 重启完成（969180 单跑：持仓恢复 0 代币=链上余额差法与卡账本口径互证、17 策略、双 collector 连接；narrative worker 未重启仍跑 J1.97 题面）。

### C161 巨大影响力事件载体门豁免——全球级爆火事件不要求形象载体（J1.97）（2026-10-21 用户裁定）★

- **裁定**：用户「需要形象载体是大部分情况，某则 meme 币没有一个落脚点。但是对于影响力巨大的事件（这个网站确实爆火），是应该可以豁免的」——`0x1214a8cceff27ef355f803e06ec5511cb4f97777`（80억분의1，韩国爆火人生模拟网站）因 E 类 `no_visual_entity` 0.99 被载体门拦；vision 门判文本 sufficient 1.0 跳过图片，图内其实有网站名/界面。
- **机制（题面 J1.97）**：新增 `event_influence` Choice 3 档（只作载体门豁免输入，**不参与事件分/评级**）：`massive`=全球级/全网级爆火、跨平台跨圈层、主流媒体或大量外部报道；`notable`=单一平台/单一圈层热搜；`limited`=小范围/无外部传播证据。明确锚：写出「一经推出全球爆火/全球热议/全球刷屏」+ 官网/维基/新闻报道等外部来源 → massive（采信陈述，不因没逐条列媒体降档）；单平台热搜不选 massive；作者自夸无外部证据不选 massive。fit 题同步加全球级爆火产品/网站/游戏锚：至少 fit，可参与/讨论/二创可 strong_fit。
- **机制（mapper C161）**：`event_influence=massive` → `entityVisualBlock` 早退（覆盖 C/D/E 三类载体门：C/D 的 improvised+no_visual、E 的 no_visual）；审计 `subjectCarrierMassiveInfluenceExempt {carrier,influence:'massive'}`，`eventInfluence` 恒落观察。旧缓存行无本题 → null 不豁免（fail-closed，存量行为不变）。
- **验证**：80억분의1 3 连跑 **high 95.02/95.56/94.87**（event:E；fit 98–99% strong）；C79 偷窥狂 3 连跑 low（influence=notable，载体门照拦）；全量 45 票 **39 PASS / 3 FAIL / 3 OBSERVE**（FAIL=C109c/C129/C133——C133 为已知 W 阈值抖动：全量 30.7<32，隔离 3 连跑 mid 32.5–33.76；OBSERVE=C72/C126/C130）；`_test_massive_influence_carrier` 13P + 相关套件 0 失败。
- **观察项**：全球爆火是强影响力声明，也可能被虚假叙事利用；`eventInfluence`/`subjectCarrierMassiveInfluenceExempt` 已落库，后续按买点结果回看，必要时收紧为「跨平台外部报道/维基/官网证据」。
- **部署**：随 J1.97 一批；worker/live 未重启。

### C160 强情感冲击/动物救助路径——真实公益纪念故事可作为 fit 路径（J1.96）（2026-10-21 用户裁定）★

- **裁定**：用户「这个币出内盘了，这是属于对 web3 用户能造成强情感冲击的事件，算是另一条能打动用户的路径」「尤其是 web3 用户，喜欢猫猫狗狗」——秦思雨 `0x843b2515ccc775bbe4c9e56dbed710e602317777`（中国狗妈，一生救助流浪猫狗后早逝）原判 W 类 + `web3_user_event_fit` unfit 0.91 拦死。
- **机制（题面 J1.96）**：①`event_category` 加 memorial/charity real-person 归属：事件主体=人物/故事 → **E**，不因文本提到「部署代币」判 W；W 只留给 crypto 产品/项目本身是事件主体。②`web3_user_event_fit` 加强情感冲击/动物救助路径：真实正向公益/纪念（尤其流浪猫狗救助，web3 用户天然喜欢猫狗）→ 至少 fit，强共鸣可 strong_fit；情感币/纪念币是真实路径，不要求玩梗/二创。边界=消费弱势真人苦难/土味网红悲剧/疾病死亡猎奇/虚假未证实悲情仍 unfit。
- **机制（mapper C160 载体豁免）**：E 类 + fit 质量（strong_fit+fit）≥0.5 + 文本事实锚（动物救助词 ∧ 纪念/离世词）→ `entityVisualBlock` 不拦；审计 `subjectCarrierEmotionalImpactExempt {carrier,fitMass,animalRescueMemorial}`。代码锚只防泛 E 热点（C79 偷窥狂无救助/纪念词），语义是否真实正向仍归 Jev。
- **验证**：秦思雨 3 连跑 **high 83.41/81.67/80.62**（event:E；fit 79/76/74%；载体门豁免）；C79 偷窥狂仍 low（载体门照拦）；C114 DND high、C133 mid PASS；全量 45 票 **39 PASS / 2 FAIL / 4 OBSERVE**（FAIL=C109c/C129；OBSERVE=C100/C72/C126/C130）；`_test_emotional_impact_carrier` 11P（A/B/C/D/E 五段）+ 既有套件 0 失败。
- **观察项（承接 C159 用户担忧）**：动物救助/纪念是强情感路径，也可能被虚假叙事利用；`subjectCarrierEmotionalImpactExempt` 与 `emptyContentMass` 均落库可回看，后续按买点结果收紧为「真实报道/公益主体证据」。
- **部署**：随 J1.96 一批；worker/live 未重启。

### C159 event_empty_content 与 fit 矛盾修正——短句点名具体 meme 不算空洞（J1.95）（2026-10-21 用户裁定）★

- **裁定**：用户「这个矛盾了，又认为空洞，又认为符合 web3 审美」——短尾猫 `0x25e1c479a91f0108591ac6e156bda79127b27777` 主推「chinese nubcat?」，Jev 判 event_empty_content 0.54，同时 web3_user_event_fit strong_fit 0.83，两层自相矛盾。
- **机制（J1.95 题面）**：event_empty_content 加排除——短句/疑问句点名具体 meme/实体/已知 IP 的**完整名称/名词主体**（chinese nubcat?/XX猫？）→ 主体指代明确，属有内容的叙事素材，不选空洞；纯缩写/符号/表情+缩写组合（DND 😾）不适用本锚；低质 IP 复用交 token_ip_reuse 另判。版本 J1.94→J1.95。
- **机制（mapper C159 近 tie）**：J1.95 让 DND 类票的 empty vs none 变 0.43/0.47 掷骰；C114 图证载体豁免原本只在 blockChoice=event_empty_content 触发，argmax 翻 none 会重开载体门。新增 `emptyContentImgLike = imageEvidence ∧ (blockChoice=event_empty_content ∨ (blockChoice=none ∧ emptyP≥0.4))` 作为 `emptyContentImgCarrierOverride`；审计 `subjectCarrierEmptyImgOverride {carrier,emptyP,noneP}` 只记近 tie 新增面，既有 `emptyContentImgOverride` 不变。
- **验证**：短尾猫 3 连跑 **high 88.18/90.46/89.35**（event:A；empty 0.16 / none 0.52 / ip_reuse 0.32 → 无否决）；C114 DND 3 连跑 **high 85.64/86.80/85.68**（近 tie 豁免，载体门不拦）；C79 偷窥狂仍 low（文本已讲清热点 meme，G1.2 门 sufficient 跳过 vision）；全量 45 票 **40 PASS / 2 FAIL / 3 OBSERVE**（FAIL=C109c/C129；C133 本轮 mid PASS）；`_test_empty_content_img_exempt` 27P（I1/I2 近 tie + H8 题面锚）。
- **观察项（用户 2026-10-21 追加担忧）**：短句点名 meme 的锚可能被虚假叙事利用（只蹭名字、无实质事件）——`emptyContentMass` 恒落 stage2 jev 作为观察键（不参与任何门），后续按买点结果回看；必要时收紧为「完整名称 + 至少一条实质证据（图/链接内容/账号宣告）」。
- **部署**：随 J1.95 一批；worker/live 未重启。

### C158 vision 前置门判据校准——文本讲清叙事才免图，裸口号/官方措辞无上下文必须走图片流程（G1.1+G1.2）（2026-10-21 用户裁定）★

- **裁定**：用户「『这里只能相信陈述的叙事，不需要去验证』如果文本已经把叙事陈述清楚了，就无需再去验证，如果叙事无法单独从文本搞明白，那就再走图片下载与处理流程」。
- **现象**：智能时代 `0xd633b60f8eb0beac680185bce7f57cbe84a77777` 主推只有「币安官方称之为智能时代」+ 下载链接/二维码截图；G1.0 门以「币名有字面证据」判 sufficient 0.91 跳过 vision → 无图语义 → 载体门（D + no_visual）拦死 low。图片缓存其实已有 img-v3 结论（visible_text「欢迎来到智能时代」），但门跳过连缓存都不读。
- **机制（G1.1，先）**：`vision_gate_sufficiency` 的 sufficient 判据加「文本须独立讲清叙事（读者看图前不会问『这是什么』）」；need_image 新增裸口号/官方措辞引用臂——只断言/引用口号、只重复币名、只给链接/二维码/下载页 = 叙事无法仅凭文本理解，必须走图片流程。版本 G1.0→G1.1。
- **机制（G1.2，回归校准）**：G1.1 让偷窥狂 C79（抖音热搜 meme，文本已说明名字/来源/二创）也判 need_image → 图证救活为 high，破坏用户 2026-10-21「期望 low」。补充分侧反锚：文本已讲清热点 meme 是什么/来源/二创时，附带视频/截图只是佐证，不得仅因「看视频」或附图判 need_image。版本 G1.1→G1.2。
- **验证（3 连跑）**：智能时代 need_image p=0.01~0.02 → 跑 vision（tweet_image 缓存命中）→ **high 85.25/87.05/87.05**（event:D，载体门图证豁免）；C79 sufficient p=0.97~0.98 → 跳过 vision → **low 3/3**（载体门原样）。全量 45 票 **38 PASS / 3 FAIL / 4 OBSERVE** 不变（FAIL=C109c/C129/C133）；`_test_vision_gate` 37P，相关叙事套件 0 失败。
- **部署**：随 J1.94 一批；worker/live 未重启。

### C157 官方措辞引用纳入超级IP来源臂——只相信陈述、不验证来源（J1.94）（2026-10-21 用户裁定）★

- **裁定**：用户「把官方措辞引用纳入超级IP来源臂；这里只能相信陈述的叙事，不需要去验证」。
- **机制**：`web3_user_phrase_acceptability` 的超级IP极端否证段新增官方措辞引用臂——语料陈述某词句是超级IP/平台官方渠道的官方措辞/口号/命名（如「币安官方称之为智能时代」），采信陈述，不要求验证来源/页面；第三方转述也按超级IP来源判；官方命名/口号优先于通用短语判据（即使字面是通用词也不按非实体普通词拦）。版本 J1.93→J1.94。
- **验证**：币安时代 `0x5137927f6ecd2f096278536b7b023a253dc17777` **high 86.46**（acceptable 0.91）；智能时代词句接纳度门由 not_acceptable 0.67 翻 acceptable 0.69，但当时仍被载体门（D+no_visual）拦为 low——载体门的图片流程缺口由 C158 收口；全量 45 票 **38 PASS / 3 FAIL / 4 OBSERVE**。
- **部署**：随 J1.94 一批；worker/live 未重启。

### C156 name_event_relevance 题键改名 web3_user_name_event_acceptance——全部用户视角命名（J1.93）（2026-10-21 用户裁定）★

- **裁定**：用户「name_event_relevance 我建议也是把名字换了，全部都是用户角度」——与 `web3_user_event_fit` / `web3_user_name_entity_acceptance` / `web3_user_phrase_acceptability` / `web3_user_entity_visuality` 前缀对齐。
- **改动（J1.93）**：题集键 `name_event_relevance` → **`web3_user_name_event_acceptance`**；判据/3 桶/分值零改动。mapper 双键读：`answers.web3_user_name_event_acceptance?.choice ?? answers.name_event_relevance?.choice`（旧缓存行 bit 不变）；stage3 审计 `probabilities` 新键落库（旧行历史键保留展示）；C88 关联腿/relMass 同款双读。版本 J1.92→J1.93。
- **验证**：C137 MEMES **high 96.34**、币安时代 **high 87.54**（J1.92 行为不变）；智能时代仍 low（词句接纳度门）；全量 45 票 **38 PASS / 3 FAIL / 4 OBSERVE**（与 J1.92 同集：FAIL=C109c/C129/C133；OBSERVE=C100/C72/C126/C130）。全叙事套件 0 失败；question_consolidation A5 新键 89P。
- **部署**：随 J1.79→J1.93 一批（题集+mapper；无 DDL）。worker/live 未重启。

### C155 name_event_relevance 收敛为 3 用户视角桶——明确匹配 / 用户能接受 / 不接受（J1.92）（2026-10-21 用户裁定）★

- **案由**：币安时代 `0x5137927f6ecd2f096278536b7b023a253dc17777`（何一「大人，时代变了。💁‍♀️」）J1.91 被 Stage3 关联判 `semantic_weak 9` 截断（事件分 96、fit 0.96 本来过线）。用户裁定：「如果不是何一说的，我可以认同；但是因为是何一说的，meme 币用户去如此引申理解是正常的」——name_event_relevance 改成「**BSC meme 用户能不能理解与接受事件跟代币的关联关系**」，不要 semantic_clear 等细分；「要不明确匹配上，要不就是看用户能不能接纳」；并明确「币安/何一等超级IP的陈述被一定程度引申关联是正常的」。
- **改动（J1.92）**：题集 9 桶 → **3 桶**：`exact_match` / `acceptable` / `unacceptable`；instructions 只问「用户能不能理解并接受」。mapper 新桶分 **exact_match 20 / acceptable 15 / unacceptable 5**（旧 9 桶分数保留供旧缓存行重放；Stage3 ≤10 截断不变——acceptable 过线、unacceptable 截断）。**逐字锚**：币名（去 emoji/大小写）逐字出现在事件文本/主推中 → exact_match（含普通词/问候语/圈内文化词，不因通用概念降档；C108 EARLY/C114 DND/C126 こんにちは/C137 MEMES 案）。**超级IP引申锚**：币安/何一等超级IP的公开陈述被一定程度引申关联是正常的（「时代变了」→「币安时代」判 acceptable）。版本 J1.91→J1.92。
- **验证**：币安时代 **high 86.4**（事件分 95 + 关联 15 acceptable + 质量 14.4）；智能时代 `0xd633b60f…7777` 仍 **low**（词句接纳度门 `web3_user_not_acceptable`，名字门未动）；C137 MEMES **high 96.28**（exact_match 20，3 连跑稳定）；C108 EARLY **high 91.69 **、C114 DND **high 86.22**、C126 こんにちは **high 90.46**（observe 票，期望 mid）。全量 45 票（J1.92）：**38 PASS / 3 FAIL / 4 OBSERVE**——FAIL=C109c（high 78.94，快照 low/Jev 方差面）、C129（unknown 59%）、C133（W appeal 23.68<32，Jev 方差）；OBSERVE=C100/C72/C126/C130。
- **单测**：question_consolidation A5 3 桶（89P）、name_entity/name_image/jev_finding_recap/empty_content/image_depicts/jev_resonance/superip_slogan/brand_hijack/referent/narrator/angle/W 版本锁 J1.92 全绿；全叙事套件 **0 失败**。
- **部署**：随 J1.79→J1.92 一批（题集+mapper；无 DDL）。worker/live 未重启。

### C154 时效体系清理批次 1→3——C68 退役 + event_timing 收窄 + W 正向时效表删除（J1.91）（2026-10-21 用户裁定）★

- **裁定链**：用户先问「正向分只有 W 的 TIMING_SCORES_W 一张表，是不是可以删除？」→「这个时效体系中哪些机制是冗余或者无意义的，都可以删除」→「好，搞吧」→「按 1→2→3 逐批改」。
- **批次 1（C68 退役 + unknown 不再归零）**：`ANGLE_TWEET_STALE_SEC`/`overrideAngleTiming`/`angleTimingOverride` 审计整链删除——最近 774 行 **0 命中**；angle_seeking >300s 已由 precheck 2.1 拦，interpretive 有 C120 巨粉豁免，C68 6h 窗被上游吃掉。W 表 `unknown:0` 一并消失（原 247 张 W 票 raw timing unknown 60 张/24.3%，走到 W 评分 16 张全部被 0 分——unknown=没证据不是 old）。
- **批次 2（event_timing 收窄，J1.90→J1.91）**：题集删 `expected_within_30d`/`expected_beyond_30d`（247 张 W 票：expected_beyond 0 次、expected_within 6 次）——未来事件预期 30 天内归 within_30d，超过 30 天/无法判断归 unknown；题面/单测版本锁同步 J1.91。
- **批次 3（W 正向时效表删除）**：删 `TIMING_SCORES_W`（within_7d=25/within_30d=15/older=0）——J1.79+ W 评分 81 张中 within_7d 55（69.6%），25 分是常数偏移；W 数学改 **wAppeal(0-75) 单轴，pass 57→32**（=57-25，保持 fresh 通过集）；时效不再正向计分，仅对 `older/unknown` 或 C75/C102/C103 override **封顶 30**（与标准路径 J1.71 后同构）；`scoringResult.timingScore=null`、`timingPenalty=30` 审计。
- **验证**：C133 股城 J1.91 **mid 56.17 PASS**（J1.90 旧表 55.52<57 low；新表 appeal-only 过 32）；REPEG J1.91 **low 13.14 / W**（吸引力 13.14<32；C153 豁免后不再 precheck 硬拒）；C95 永生蝴蝶仍 **low/expired_tweet PASS**（名单号防线）。单测 `_test_angle_timing_override` 47P（C68 退役反证+保留 C75/C102/C103）、`_test_w_bsc_user_appeal` 19P（单轴/pass32/cap30）、question_consolidation 89P；全叙事套件 **0 失败**；14 个版本锁 J1.91。
- **全量 45 票（J1.91）**：**38 PASS / 4 FAIL / 3 OBSERVE-DEVIATION / 0 ERROR**——FAIL=C109a 交易猫（关联 0）、C109c BI（high 82.88，快照 low；非时效清理链，J1.90/Jev 方差面待复核）、C114 DND（关联 0）、C129 彪弟（unknown 57%）；OBSERVE=C100/C72/C130（已知面）。C133 已从 FAIL 转 PASS。
- **保留**：precheck 300s + C74/C104/C132/C120/C153 豁免；C75（4 命中）/C102（17）/C103（13）backstop；`narrativeCorpusLagSec` 仍为纯观察因子（策略库 0 引用，删 metadata 单独裁定）。
- **部署**：随 J1.79→J1.91 一批（题集+mapper+utils+analyzer；无 DDL）。worker/live 未重启。

### C153 发行方 CA 证据豁免 expired_tweet 硬窗——小项目自己晒地址不卡 300 秒（2026-10-21 用户裁定）★

- **案由**：REPEG `0x88900da3c4b3418708d99d880129cacd9b037777`，@thresiltech（894 粉/1 赞/0 转）发「重启一场关于稳定币的实验 / 重新锚定 / Restarting a stablecoin experiment. / Re-pegging.」，作者时间线另有含 CA 的宣告（issuerCaTimeline 命中）。主推早于创建 4,315s（约 72 分钟）→ classifyTweetType=angle_seeking（低粉+低互动）→ precheck 规则 2.1 的 300s 硬窗拦，LLM 未跑。用户裁定：「这个推文直接在推文中晒了地址，其实是一个小项目，确实不应该卡 300 秒」。
- **改动**：`narrative-utils.mjs` 新增 `shouldExemptIssuerCaExpired(preCheckResult, {issuerCaTimeline, authorScreenName, mainTweetText, tokenAddress})`——仅对 `details.ruleName='expired_tweet'` 生效；主推文本逐字含 CA **或** 作者时间线 CA 宣告命中；作者必须在册且**不在频繁发币者名单**（C95 防线）；issuerCa 作者与语料作者不一致/作者缺失 → fail-closed 不豁免。`NarrativeAnalyzer` 在 issuerCa 泳道 join 之后、`isPreCheckTriggered` 判定之前调用，命中则 `preCheckResult=null` 继续走 Jev（时效交 event_timing/C68/C75 软评）。题集不变；precheck 代码层豁免。
- **验证**：REPEG 重析——日志「发行方 CA 证据豁免 expired_tweet（C153）」→ Jev **W 类 / low 13.32**（W 吸引力 13.32<57），不再是 precheck 硬拒；C95 永生蝴蝶（@burnfloor_ 频繁发币者）重跑 **PASS low / expired_tweet**（防线生效）。单测 `_test_issuer_ca_expired_exempt` 11P（issuerCA/主推 CA/名单号/非 expired/作者不一致/缺失/大小写 + 源码口径）。
- **全量 45 票（J1.90+C153）**：35 PASS / 6 FAIL / 4 OBSERVE——FAIL=C109a/C109c/C114/C129/C133/C137；C109c（high 82.91）、C133（low 55.52）、C126（OBSERVE high 77.15）为本轮 Jev/J1.90 方差面，非 C153 直接改道；C137 仍卡 Stage3 关联（generic_concept 5，J1.91 未实施）。
- **REPEG 期望留档（2026-10-21 用户追加）**：REPEG 的期望评级是 **high/mid**，但当前 J1.91 结果 low 13.14（W 吸引力<32）**接受、不进一步修**；C153 只负责解除 300s 硬窗，叙事分不再追改。
- **部署**：随 J1.79→J1.90/C153 一批（precheck+utils+analyzer；无 DDL）。worker/live 未重启。

### C152 MEMES fit 锚——圈内平台/项目核心开发者本人表态至少 fit（J1.90）（2026-10-21 用户裁定「可以」）★

- **案由**：C137 MEMES `0xeeed1ed1b6bd0eae15bb651490a7e8b3057f7777`，@eth_cedric（Flap 平台 dev，46,539 粉）发「Memes will continue.」；empty_content 已被作者豁免翻掉，但 fit 判 unfit 0.33 / marginal 0.29 / strong_fit 0.27 / fit 0.11（sf+fit 0.38<0.5）→ `web3FitMassBlock` low。用户：「这个事件本身就是 Flap 的开发者自己说的话，跟何一说的话类似（弱一档），怎么会不符合 web3 用户呢？」
- **改动（J1.90，纯 Prompt）**：①`web3_user_event_fit` instructions 加强契合锚——圈内平台/项目官方账号或核心开发者本人的公开表态/口号（Flap dev「Memes will continue」、何一/币安高管发言）发言者身份本身是 web3 圈内事件，不因字面普通短语/口号/无具体形象判 unfit/marginal，至少 fit，按发言者层级/话题强度可 strong_fit；普通路人/媒体账号不适用。②strong_fit/fit criteria 同步补该档。③`jev-state-builder` 的 `corpus_author_identity_note` 补作用域澄清：本约束仅针对币名映射实体题，fit 题可按发言者身份判。mapper 零改动；版本 J1.89→J1.90。
- **验证**：C137 重析 fit **strong_fit 0.85 / fit 0.15 / unfit 0 / marginal 0**，fit 门放行；但随后卡 **Stage3 关联**——`name_event_relevance: generic_concept 0.73 / exact_match 0.18` → relevance 5≤10 截断，仍 low。即 C152 只解决了 fit 层，C137 达 high/mid 还需 J1.91 关联锚（未实施）。
- **单测**：`_test_web3_fit` A6/A7 锁新锚与 state note（28P）；13 个版本锁测试 J1.90；全叙事套件 0 失败。
- **部署**：随 J1.79→J1.90 一批（题集+state builder；无 DDL）。

### C151 哭哭奶龙 wrong_entity 误判修正——有意义错版/二创造型不选 wrong_entity（J1.89）（2026-10-21 用户裁定「改吧」）★

- **案由**：用户观察 C113 哭哭奶龙（`0xe9356facf0558ab0d7025e2898f51d111d517777`）被判 `wrong_entity` 有点奇怪，怀疑是 Prompt 问题。现场：币名「哭哭奶龙」，主推「错版奶龙玩偶 哭哭奶龙 / 奶龙这波致敬哭哭马了 / 这个号是第七印象，奶龙官方」；Jev 实体题 **wrong_entity 0.51 / unknown 0.25 / accepted 0.15 / new_entity 0.03**，wrong_entity≥0.5 全域门拦死（event:A 0.89 / fit strong 0.92，ips 0.24 非拦点）。根因=J1.81/C139 实体题的 `wrong_entity` 锚把「错版」误读为「版本/形态标注残片」、把「哭哭奶龙」误读为「不忠实呈现」——而 C113 原裁定（J1.46）早已确认「错版/哭哭是有具体新梗对象的变形，有意义的修改为什么不行？」；ip_reuse 轴已修，实体轴又误伤一次。
- **改动（J1.89，纯 Prompt）**：①实体题 instructions「指歪≠指到」段后加显式排除——有独立背景故事/文化来源的有意义变形（错版/错印/玩偶/新造型/二创造型/致敬变体/联名，如「错版奶龙玩偶→哭哭奶龙」「doge→dogwifhat」）不选 wrong_entity；映射原 IP 可判 accepted/unknown，作为新角色/新变体可判 **new_entity**。②`wrong_entity` criteria 同步加排除句（J1.89/C151）；③`new_entity` criteria 明确「已知 IP 的有意义衍生新造型/错版玩偶/二创角色也归本项」。mapper 零改动（wrong_entity≥0.5 门不变，靠 Jev 判读翻正）；题数不变；版本 J1.88→J1.89。
- **验证（182 定向重析，2026-10-21）**：C113 **high 92 / event:A PASS**——实体题翻为 **new_entity 0.94 / wrong_entity 0**；对照 C105 日本語版仍 **low**（真版本残片）、C78 鲸元卷仍 **low**（真拼写错误），证明排除只放有意义变形、不放真指歪。全量 45 票（J1.89）**39 PASS / 4 FAIL / 2 OBSERVE**——FAIL=C109a 交易猫（关联 0）、C114 DND（关联 0）、C129 彪弟（unknown 59%）、C137 MEMES（fit 38%<50%）；C113 已从 FAIL 转 PASS。
- **单测**：`_test_name_entity_acceptance` D5d 锁新锚句（41P）；14 个版本锁测试 J1.89；全叙事测试套件 0 失败。
- **部署**：随 J1.80-J1.89 一批（题集；无 DDL）。worker/live 仍 J1.79 未重启。

### C150 event_quality_veto 删除 event_institution_routine 桶——机构日常交 web3_user_event_fit（J1.88）（2026-10-21 用户裁定）★

- **案由**：C132 混混猫（`0xb10b2c022a717a66fa627c9c9ce73779b5347777`）复核时发现其唯一拦点是 `event_institution_routine` argmax（0.85 / none 0.14，D 类域内）——用户问「现在不是已经没有机构日常运营这一门了吗？」澄清后裁定：「那我觉得 event_institution_routine 也没必要存在，都让 web3_user_event_fit 去判断」。与 C145 同族：机构日常/重要度属第二层用户口味，不作第一层事件质量否决。
- **改动（J1.88）**：①题集 `event_quality_veto` 删 `event_institution_routine` criterion（6→5 桶含 none：`none / event_empty_content / event_baseless_speculation / token_ip_reuse / event_negative_hard_news`），instructions 第一层从「三问」收为「是否有意义/是否负面」，明确机构日常与产品/内容日常都交第二层 `web3_user_event_fit`；②mapper `BLOCK_SCOPE.event_institution_routine = []` 显式空域（旧缓存行/旧 fixture 的 institution choice 不再拦），argmax 链 `platformOfficial ∧ event_institution_routine` 子句删除（platformOfficial 仍服务 web3FitMassBlock），`BLOCK_LABELS` 保留历史展示；③`JEV_QUESTIONS_VERSION J1.87 → J1.88`。
- **行为变化（实测）**：C132 **high 91.18 / event:D PASS**（原 low 机构日常）；C117 BNB **high 81.63 / event:C PASS**（原 low 机构日常，同版本另一跑 high 的掷骰面消失）；C97 币安游戏、C109c BI 仍 low（由名字/载体/事件分等其它门接管，非机构日常）；C133 股城 high 70.68 不受影响。
- **回归（J1.88 全量 45 票，2026-10-21 11:39 UTC）**：**38 PASS / 5 FAIL / 2 OBSERVE-DEVIATION / 0 ERROR**——FAIL=C109a 交易猫（关联 0 分）、C113 哭哭奶龙（wrong_entity 51%）、C114 DND（关联 0 分）、C129 彪弟（unknown 68%）、C137 MEMES（sf+fit 40%<50%）；OBSERVE=C72 小黑（负面硬新闻）、C100 rebondit（负面硬新闻/已知面）。C117/C132 两个机构日常目标票全 PASS。
- **单测**：question_consolidation 89P（A8 5 桶）、name_entity 40P（D5b 删 institution 源锚）、empty_content 24P（E1 改为退役反证）、product_entity 38P（D2b 删 argmax 子句断言 / F1c/F2 退役行为）、angle_timing 59P；9 个版本锁测试 J1.88；全叙事测试套件 **0 失败**。
- **部署**：随 J1.80-J1.87→J1.88 一批（题集+mapper；无 DDL）。live/worker 仍 J1.79 未重启。

### C149 Telegram 链接不作账号币证据 + 原生项目/IP 须推特账号或独立站点（2026-10-21 用户裁定）★

- **裁定原话**：「t.me（电报）存在不能作为账号币的证据，只有推特账号才可以」「提供推特账号或者提供站点（不是系统中的子页面）才能是被判为原生项目或者原生IP」。
- **改动一（Telegram 断源）**：`narrative-utils.mjs` 新增 `isTelegramUrl`（t.me/telegram.me/telegram.dog），`isProjectCoin` 的 URL 臂在 `isAutoTokenPageUrl`（C99）之外再排除 Telegram——`t.me/#<CA>` 只是社群入口线索，不构成项目方自公示/账号币证据。C101 OK❌ 的 t.me 单臂触发账号链补收 → prestage 路由链被切断。
- **改动二（原生项目/IP 资格门）**：`shouldRouteToAccountCommunity` 的项目币臂从 `isProjectCoinResult && relatedAccounts.length > 0` 收紧为 **`isProjectCoinResult && (hasAccountCorpus || hasOwnSite) && relatedAccounts.length > 0`**——`hasAccountCorpus`=twitterInfo.type account/community（推特账号资格）；`hasOwnSite`=`hasIndependentWebsite`（独立站点，已剔聚合器自动页与第三方平台）。只有推文/系统子页面（CMC dex、t.me 等）皆无资格；账号/社区语料与 issuerDetected 两臂不变。
- **行为变化（C101 实证）**：C101 的 metadata 只有 status 推文 URL + t.me/#CA + CMC dex 自动页 → `isProjectCoin=false`、路由条件不满足 → 走**标准路径**，Jev 判 `event:C`、low（空洞内容）；原「地址验证拒」文案退役。fixture C101 期望更新为 `{rating:'low', tokenCategory:'event:C', reasonExcludes:['未在账号简介或推文中找到完整代币地址']}`，重跑 **PASS**。真正的项目币（独立站正文含 CA）与 Twitter 账号票（account/community）路由不变。
- **单测**：`_test_isproject_coin_url_not_ca_hit` 22P（事故形状全语义 false + 推特 URL 含 CA true + 源码锁）、`_test_account_route_tweet_corpus` 12P（A3 独立站 true / A3b 仅推文+系统子页面 false / A3c 账号语料 true）、`_test_isproject_coin_aggregator_urls` 37P、`_test_narrative_middle_parallel` 22P 全绿。
- **部署**：随 J1.80-J1.87 一批（路由层，无题集 bump/DDL）。站点-only 且无 relatedAccounts 的票当前仍不路由（prestage 账号链需要账号入口；必要条件门已保证「无账号无站点不得判 project/web3ip」）。

### C148 剔除 @GETGEORGEMEME 推特黑名单（2026-10-21 用户指令）★

- **裁定**：用户指令「GETGEORGEMEME 从黑名单剔除」。`config/default.json → narrative.twitterBlacklist` 删除该 handle（唯一在册处，无其它变体）。
- **影响与验证**：C92 유과 강아지（`0x9d956023c76a23509b8195e9cb635178a35e7777`）原 low 单因即该黑名单（「推文作者@GETGEORGEMEME在黑名单中」）；剔除后重跑 **high 95.5 / event:E / PASS**（observe 票，fixture 只记录不断言）。该票的「E 类感染力折损」案内矛盾（J1.36 折损方向 vs 实际盈亏）随之回到观察面，不再被黑名单遮蔽。
- **部署**：config 改动需重启叙事 worker / 实验进程生效；随 J1.80-J1.87 一批。无代码/DDL/版本 bump。

### C147 回归集 12 票期望按用户裁定修正（2026-10-21）★

- **裁定原话**：「首先修正一轮数据，以我发的为准，写到数据集合中」——12 票期望值以用户当次消息为准：
  - `0xc8a55fed967db1f1be1fac90c3a453c1c4187777`（C108 EARLY）→ **high**
  - `0xc929c8d1e57569b706d7cfdc3487c7d33b287777`（C109a 交易猫）→ **high**
  - `0x57efcdb41b8107fd6b6db8d06591d67274e27777`（C79 偷窥狂）→ **low**
  - `0x4688681cd5f1882b3ba12f6f4a79951914e87777`（C82 JDI）→ **low**
  - `0xe9356facf0558ab0d7025e2898f51d111d517777`（C113 哭哭奶龙）→ **high**
  - `0x4dbcb10e68626b6f663bd596905d41cdc6b07777`（C114 DND）→ **high/mid**
  - `0x9d956023c76a23509b8195e9cb635178a35e7777`（C92 유과 강아지）→ **high/mid**（追加裁定）
  - `0x3b5c3271fb581e503389dd2c52a75065f36f7777`（C129 彪弟）→ **high/mid**（追加裁定）
  - `0xf8abd6a6bdc0d87291b4f79abc6188c48a807777`（C117 BNB）→ **high/mid**（追加裁定）
  - `0xb10b2c022a717a66fa627c9c9ce73779b5347777`（C132 混混猫）→ **high/mid**（追加裁定）
  - `0xaacbc156435dbab7815a61bccba1c827e52a7777`（C133 股城）→ **high/mid**（追加裁定）
  - `0xeeed1ed1b6bd0eae15bb651490a7e8b3057f7777`（C137 MEMES）→ **high/mid**（追加裁定）
- **改动**：`fixtures.json` 十二票 `expect.rating` 按上表直写，删除原 `observe` 软断言（改为硬断言），逐票补 `expectSince/expectBecause` 留痕；C108 删除与新期望冲突的 `reasonIncludes: 叙事主体无形象载体`，保留名字门 reasonExcludes；C113 保留 `reasonExcludes: IP低质复用` 与 `tokenCategory: event:A`；C114 期望改为 `["mid","high"]`；C92 由 `rating:null` 观察票改为 high/mid；C129 删除原 low/event:C/unknown reason 断言，改为 high/mid；C117 删除 observe，改 high/mid；C132/C133/C137 改 high/mid（C133 删除原 W总分不足 reason 断言）。
- **验证（重跑，2026-10-21）**：6 票首轮 **3 PASS / 3 FAIL**——C108 EARLY high 84.03 PASS、C79 low PASS、C82 low PASS；C109a low「关联性不足」FAIL、C113 low「wrong_entity」FAIL、C114 low「关联性不足」FAIL。追加两票：C92 **high 95.47 PASS**（黑名单剔除后）；C129 重跑 **low event:C（unknown 实体）FAIL**——同票另有 high event:A 84.34 跑次（Jev 掷骰；根因=抖音背景未进语料），目标 high/mid 尚未稳定达成。追加四票：C117 **high 81.57 PASS**、C133 **high 70.65 PASS**（W 分掷骰，前跑 low 54.26）、C132 **low「机构日常运营」FAIL**、C137 **low「载体门 no_visual」FAIL**。**全量 45 票（11:31 UTC）：36 PASS / 7 FAIL / 2 OBSERVE**——FAIL=C109a/C113/C114/C117/C129/C132/C137；其中 C117（institution_routine 掷骰）与 C113（wrong_entity 51% 边缘）在同版本另一跑为 high（PASS），C133 本轮 high 通过。当前工作集=这 7 张；C113 本轮 high 已通过（掷骰）。
- **验证纪律修订（2026-10-21 用户裁定「叙事引擎跑出来是什么结果就是什么结果呀」）**：case 回归**每票必须有 `rating` 主断言**，禁用 `rating:null`/「禁 expired_tweet」这类替代性机制断言——原写法只能证明门没回来，不能证明结果对（引擎落 low 仍可 PASS）。8 张 null 票全部补引擎实际结果：C74 high、C75 low、C106 low、C109b low、C109c low、C83a high、C83b high、C121 high（+observe 标注掷骰面）；审计/分类键只作附加定位。重跑 **8 PASS / 0 FAIL**。`docs/case-regression-tool.md` DSL 规则同步（rating 必填，null 禁用）。
- **部署**：纯 fixtures 数据改动，随 J1.80-J1.87 一批；无代码/DDL/版本 bump。

### C146 终态重析无分类时清空 token_category——重跑数据必须反映本次判定（2026-10-21 回归发现）★

- **案由**：C145 全量回归展示 C101 OK❌ 时，用户质疑「0x0195119e…7777 为什么被判为 web3_native_ip_early？」并指出「我让你重新跑数据的呀」。核查：本轮 J1.87 该票 precheck 硬拒（`validationStage=address`，0 粉/3 推/简介推文无 CA），prestage/stage1 均 null，`deriveTokenCategory` 返回 null；但 `token_narrative.token_category` 仍显示旧值 `web3_native_ip_early`（C101 修复前 t.me URL 臂伪造 addressVerified 那轮 prestage 的产物）。根因=落库规则「有分类才写键，null 不覆盖旧值」（2026-09-27 裁定，原意保护瞬时失败重析不清旧分类），导致重跑数据不刷新分类，回归表与 web 展示均可能误导。
- **改动**：`NarrativeRepository.save` 第二参新增 `clearTokenCategory`（默认 false）；`result.token_category` 非空仍直写新值，为空且 `clearTokenCategory=true` 时显式写 null。`NarrativeAnalyzer` **只在 `dbSave.final`** 传 `clearTokenCategory: !tokenCategory`；`dbSave.intermediate` 不传=保留旧值（避免分析中途清列）。终态分析失败无缓存（unrated）同样清空——该行评级已是本次结果，旧分类不应残留。
- **语义变化**：推翻 2026-09-27「失败重析不抹旧分类」规则中「precheck fail/no_data 不写键」的部分；瞬时失败且命中缓存 fallback 的路径仍在 final save 前返回，不受影响。无题集版本 bump（save 层）。
- **测试**：`_test_narrative_repo_save_thin` 31P——C3 三态（无分类+clear→null / 无标记→不写键 / 有分类→直写）+ D 源码锁（final 传标记、intermediate 不传）。
- **数据修正（重跑实证）**：J1.87 全量 45 票重跑（`case-regression-result-2026-10-21T10-50-22-093Z`）后，5 张 precheck fail 行的旧分类全部清空——C101 OK❌、C99 传奇蝴蝶（原 web3_native_ip_early）、C68 제로（原 event:A）、C92 유과 강아지（原 event:E）、C104 バイナンス人生（原 event:C）现均为 `null`；终态 **37 PASS / 0 FAIL / 8 OBSERVE-DEVIATION / 0 ERROR**，与 C145 基线一致（无票翻档）。未手工改库。
- **部署**：随 J1.80-J1.87 一批（save 层无 DDL）。

### C145 event_quality_veto 删除 event_routine_content_product 桶——产品日常交 web3_user_event_fit（J1.87）（2026-10-21 用户裁定）★

- **案由**：C119 猫票复核时确认其唯一拦截位是 `event_quality_veto` 的 `event_routine_content_product` argmax 桶（其他门全过）。用户裁定原话：「event_routine_content_product 我认为应该直接删除（从 event_quality_veto 中也删），是不是 产品日常 不应该是事件符不符合要求的最终判定，应该直接到 web3 用户那边，看用户接纳度」「也就是说使用 web3_user_event_fit 即可」。定位：产品/内容型日常宣传是否成立属**第二层 Web3 用户口味**，不属**第一层事件质量否决**；质量层只保留「是否有意义/重要度/是否负面」的客观否决（空洞/机构日常/无据猜测/负面硬新闻/IP 复用）。
- **改动（J1.87）**：①题集 `event_quality_veto` 删 `event_routine_content_product` criterion（7→6 桶含 none：`none / event_empty_content / event_institution_routine / event_baseless_speculation / token_ip_reuse / event_negative_hard_news`），instructions 明示产品/内容日常不再由本题判、交 `web3_user_event_fit`；②mapper 删 `routineContentProductBlock` 概率门、`rcpBlock/rcpArgmaxWouldBlock/rcpPlatformExempt` 审计键与 argmax 子句、`routineContentProductMass`；`BLOCK_SCOPE.event_routine_content_product = []` 显式空域（旧缓存行/旧 fixture 的 routine choice 不再拦，J1.43 先例），`BLOCK_LABELS` 保留历史展示；③`event_institution_routine` **保留**（机构日常仍是事件质量/重要度臂，scope [C,D] + platformOfficial argmax 豁免不变）——本次只删「产品/内容日常」而不是整个日常运营轴。
- **行为变化（刻意）**：产品/内容日常票不再被第一层截断，改由第二层 `web3_user_event_fit` + 名字/载体/关联/质量门判定。C119 猫 high；C94 京小安（用户裁定替换为 `0xcb98accaa8040a7e839c305b8aca08e113c87777`，旧票 `0xad55993d…7777` 保留 DB 行不删）high；C138 heyi.ai 随之按本意翻 high（routine 原是其唯一残余拦截位，名字门/载体门已由 J1.80/J1.81 放行）。
- **C94 替换裁定**：用户原话「0xad55993…7777 low 是对的，改数据」→（删桶后该票翻 high 与用户刚确认的 low 冲突）→ 用户改裁「京小安替换为 0xcb98accaa8040a7e839c305b8aca08e113c87777，可以过。它的叙事没问题，只是有的币起来，有的没有」。fixture C94 换地址，断言 `mid|high` + 不得出现「常规内容产品宣传」；旧地址数据保留。
- **C117 掷骰面（本批发现，已改 observe）**：同版本 J1.87 多跑对 C117 BNB 给出不同结果——6 次重析 **3 low / 3 high**（全量两跑 low/high 各一，单票 3 连探 2 high/1 low，末跑 low）。低分跑 `event_institution_routine` argmax 拦，高分跑该桶仅 0.33 < none 0.45 未达 argmax（high 82-83）；所有跑次都走标准路径（stage≥2，未进 prestage abm），C117 的确定性语义（superIP 强制标准路径）未被破坏。按 C111 纪律「勿写死 Jev 掷骰面」已将 fixture 改 `observe`（保留 low 期望作方向参考，失败只警示）；确定性断言目标是路由而非终评。
- **回归**：J1.87 全量 45 票三跑（182 temp repo `richer-js-j185`）——首跑（C138 期望仍 low）**34 PASS / 1 FAIL / 10 OBSERVE-DEVIATION / 0 ERROR**，FAIL=C138 low→high（预期）；更新 C138 期望 `mid|high` 后次跑 **36 PASS / 1 FAIL / 8 OBSERVE-DEVIATION / 0 ERROR**（FAIL=C117 掷骰）；C117 改 observe 后末跑 **37 PASS / 0 FAIL / 8 OBSERVE-DEVIATION / 0 ERROR**。目标票：C94 新票 **high 84.01 PASS**、C119 猫 **high 83.79 PASS**、C138 heyi.ai **high 80.18 PASS**；C102/C105/C109b 维持 low（载体门/名字门接管）。C100 rebondit 三跑在 low/high 间摆动（observe 票），同证 Jev 采样方差。
- **单测**：`_test_jev_question_consolidation` 89P（A8 6 桶 + routine 缺席反证）、`_test_name_entity_acceptance` 40P（D5b 删 routine 源锚）、`_test_jev_product_entity` 38P、`_test_publisher_proxy` 29P、`_test_superip_slogan_class` 52P、`_test_jev_finding_recap_statement_gate` 106P、`_test_subject_carrier` 60P、`_test_web3_fit_anchor` 27P 等 16 文件全绿。
- **部署语义**：未部署——182 主仓 worker 仍 J1.79、live `37b19a9f` 未重启；J1.87 与 J1.80-J1.86（C138/C139/C140/C141/C142/C143/C144）一批待用户裁定后部署；部署前按规程跑全量回归 + live 持仓核验。

### C144 叙事 save PGRST102 lone surrogate 清洗（2026-10-21 全量回归发现）★

- **案由**：全量 45 票 J1.86 case-regression 中 **C133 股城** 重析成功（Jev low / W 总分 49.58<57）但落库报 `PGRST102 Empty or invalid json`。定位：save payload 的 `raw_api_data.search_evidence.products.Latest.tweets[0].text` 结尾截断在 emoji 代理对中间（孤立 `\ud83d`）——`JSON.stringify` 产出 lone surrogate escape，PostgREST 解析拒绝；NUL（`\u0000`）Postgres 同样不接受。与题集/门无关，是 save 路径对搜索兜底推文截断的 Unicode 健壮性缺口。
- **修复**：`NarrativeRepository` 新增纯函数 `sanitizeJsonValue`（递归替换 lone surrogate/NUL 为 U+FFFD，合法代理对保留，不 mutate 入参；copy-on-write，干净子树返回原引用以保 save 快照 identity；`stats.replaced` 供观测），save 落库前清洗并 warn 计数。单测 `_test_narrative_save_sanitize.cjs` 11P（合法对/孤立高低代理/NUL/嵌套/不 mutate/JSON 往返/Date）。C133 重跑 **PASS**（low, W 49.58<57），清洗日志命中 1 处。
- **影响**：所有叙事 save 路径（搜索兜底推文/state/answers/stage 载荷）；有效文本不变，只修非法 Unicode。**题集版本不动**（save 层修复）。
- **回归**：全量 45 票（J1.86 + C144）原始 34 PASS / 2 FAIL / 8 OBSERVE-DEVIATION / 1 ERROR（C133 PGRST102）。C133 清洗后重跑 PASS；用户裁定 **C94 京小安评级 low 正确**（2026-10-21），fixture expect 收敛为 `{rating:'low'}`（移除 stale reasonIncludes；expectSince/Because 留痕），C94 重跑 PASS。最终 **36 PASS / 1 FAIL / 8 OBSERVE-DEVIATION / 0 ERROR**；C143 品牌票 C96/C97/C109c/C110/C117 全 PASS。唯一 FAIL=**C119 猫**（low vs 预期 mid|high，routine gate 0.43/none 0.28 argmax 拦；非品牌关键词，走五桶实体题，非 C143；待裁）。

### C143 品牌劫持并入实体轴——name_brand_hijack 条件题退役，实体题新增 brand_mismatch 桶（J1.86）（2026-10-21 用户裁定「C」）★

- **案由**：用户在 W 双轴合并后继续观察「name_brand_hijack 本质上是事件/代币的概念扩大或者不匹配」，提议并入 `name_event_relevance`。数据复核否掉 relevance 落点：J1.79 **123 条 brand 题 / 39 条 brandP≥0.5 中品牌门实际拦截 0 条**（最终拦截位 name 接纳度 22 / 机构日常 6 / W 分 5 / 无形象 3 / 地域锚 2 / 放行 1）；**33/39 brand-high 的 relevance>10**（exact_match 17 / semantic_clear 10 / abbreviation_alias 6）——relevance 认为它们强相关，且真正的拦截位是 name 接纳度门（品牌门在 Stage3，位于 name 门之后，多数票到不了）。历史 140 条品牌门拦截中可解析 48 条 relevance 全 `none`/0-2（≤10），relevance 截断本可接住。用户裁定改并入实体轴（方案 C）。
- **改动（J1.85）**：①`name_brand_hijack` 条件题**整题退役**（题/概率审计键/问出闸）；②`web3_user_name_entity_acceptance` 新增第六桶 **`brand_mismatch`**（品牌劫持/概念扩大：币名指向知名品牌/机构/人物/资产但事件核心实体不是它，且无正当关系；**优先于 accepted**；官方/本人/事件主体不选）；③mapper `brandMismatchP = includeBrandHijack ? 实体题 brand_mismatch 概率 : 0`；`punExempt`/Stage3 品牌劫持臂改吃它；`brandHijackP` 审计键改名 `brandMismatchP`（历史行保留展示）；④keyword 预检 `shouldIncludeBrandHijackCheck` 保留为**题集/门开关**——仅关键词票实体题携带 `brand_mismatch` 桶（六桶）并启用该门/`punExempt`；非关键词票实体题保持 J1.84 五桶原形（防新增桶稀释 accepted/unknown 概率扰动既有门）；⑤基础题仍 11（brand 为条件题）。
- **punExempt 保留**：显式戏谑双关仍由 mapper 政策层豁免（题面不预豁免，保证 `brandMismatchP` 信号仍在）；C88 `superIpSlogan` 豁免链不变。
- **J1.86 校准（182 定向重析 9 票，2026-10-21）**：J1.85 首版暴露两个题面锚问题——①**C96 币安上电视回归**（含品牌名陈述句：entity accepted 0.53 / not_entity 0.24 → 词句门被实体票跳过，low→high）；②**C110 币安菠萝**（官方品牌产物：entity brand_mismatch 0.49 阈值边缘，虽保持 high 但语义错误）。J1.86 补两条题面锚：含品牌名的陈述句/短语（币安上电视/バイナンス人生/币安游戏）判 `not_entity`，不选 accepted/unknown/brand_mismatch；官方品牌事件的具体产物/符号（币安官方菠萝→「币安菠萝」）不选 brand_mismatch。桶集/判据结构不变，仅题面锚点。
- **J1.85 首轮重析结果（9 票）**：8 PASS / 1 FAIL（C96）；C97/C102/C104/C109c/C110/C117/C83a/C83b 通过。C109c BI entity `brand_mismatch` 0.59（最终被「机构日常运营」先拦）；C83a/C83b 用 BI 名未命中关键词预检（旧品牌题同样不问）。
- **J1.86 重跑（9 票，2026-10-21）**：**9 PASS / 0 FAIL / 0 OBSERVE-DEVIATION / 0 ERROR**——C96 entity **not_entity** 0.03 → 词句门 low（回归修复）；C110 entity **accepted** / brand_mismatch **0.16** → high（官方产物语义修复）；C109c BI entity **brand_mismatch 0.54**（「机构日常运营」先拦，low）；C117 BNB not_entity 0.11 low；C97 not_entity 0.04 low。存档 `data/case-regression-result-2026-10-21T07-33-13-443Z.{json,csv}`（J1.85 首轮同目录 `07-30-26`）。**观察**：C83a BI（名 BI 未命中关键词预检，走五桶实体题）baseline low→high，非 C143 影响（J1.8x 工作树既有变化），留待后续裁定。重析覆盖 9 票 token_narrative 行为 J1.86；跑前备份在 182 `/tmp/case-regression-backup-*.json`；live worker 仍 J1.79 未重启。
- **单测**：`_test_brand_hijack_pun_exemption` 重写（26P：豁免矩阵/实体 brand_mismatch 信号/审计/relevance 接力/源码反证）；question_consolidation A1/A6、name_entity D5、name_image A7/D3、web3_fit A5、subject_carrier A8、superip_slogan E4/E5/G2 同步；版本锁 J1.85。
- **遗留**：实体题新增桶=题集语义变化，历史行无 `brand_mismatch` 概率（重放=0，不回溯拦截）；上线前需 182 定向重析样本验证 Jev 判读（官方 Binance / BI 戏谑 / 纯蹭品牌三类），并跑 case-regression；部署随 J1.85。

### C142 W 数学双轴合并为单轴——w_product_score 退役，BSC 用户吸引力 0-75 + 时效 25（J1.84）（2026-10-21 用户裁定「方案A」）★

- **案由**：用户观察「w_product_score 跟 w_bsc_user_appeal 两个轴基本上是重叠的」。复核确认这是两次改锚叠加的结果：①J1.52/C121 把 product 主轴从「客观创新性」切到「web3 用户关注与兴奋度」；②J1.74/C134 把币安交互轴换成「项目对 BSC 用户吸引力」——两题都变成「用户会不会讨论/参与/FOMO」的同一构念。J1.79 实跑（10-19~10-21，1088 行 / 141 张 W 票）：W 票 Pearson 0.843 / Spearman 0.847 / R² 0.711；两轴合计方差仅 ~9.6% 独立；97.2% 两轴差 <1 带；product 系统性高 0.28 带（111/141 product>appeal，29 张反号）；非地板样本（两轴 max≥0.5，n=84）Spearman 0.699、两轴都≥1（n=26）0.540、top20 重合 14/20。对照旧设计（J1.55 product+币安交互，W n≈32）Spearman 0.231、独立方差 62.5%——旧第二轴是「0/3 档」双峰外部验证信号，换成 appeal 后变成 product 的连续影子。product 的残差主要是已退役 C42 的形态先验（新产品基线 20；wNewProductP 代码零消费，仅注释/测试 A11b 锁形态词）。
- **改动（J1.84）**：①`w_product_score` 整题退役（0-35 轴/形态锚/`W_PRODUCT_BANDS`/`scoringResult.wProductScore`/`probabilities.w_product_score` 全删；旧缓存行残留答案键 mapper 忽略，历史行 UI 保留展示）；②`w_bsc_user_appeal` 0-40→**0-75**（四带 [0,18]/[19,37]/[38,56]/[57,75]，语义档位不变；Jev Score 原语仍回 0-3 期望带，mapper band 映射）；③W 数学 = 吸引力(0-75)+时效(0-25)，pass 线 60→**57**——J1.79 141 张 W 票按新轴分布校准：60→1 张、57→4 张（精确保持旧三轴 top4 通过集）、56→6、55→7、50→11；选 57=保持现状，放宽留待用户另裁；④题数 12→11（W 专用题 2→1）。
- **行为变化（刻意）**：W 通过集在 J1.79 样本上不变（4 张，旧分 60.89-61.62 / 新分 57.14-60.02）；product 不能再给低 appeal 票补分（旧 C42 形状 product 2.9+appeal 0.1 由 51.1 变 26.8 拦）；C134 案主股城新轴 0.94→16.92+25=41.92<57 仍 low——C134「新 BSC 项目可过」的动机未由本合并解决，留待 appeal 判据/刻度单独裁定。
- **遗留校准问题（本版刻意不动）**：appeal argmax band3 在 J1.79 实跑 0/881（product 1/881），W 门实质仍是「band2 高位+时效」；通过率 4/141=2.8%，全部依赖 timing=within_7d。合并只解决双轴重复计权，不解决刻度压缩；是否放宽 pass 线/改带界另裁。
- **单测**：`_test_w_bsc_user_appeal` 重写（19P：单轴数学/时效两档/product 残留零消费/旧 C42 形状不救/题集形状 11 题/源码反证/版本）；`_test_cashtag_w_route` B1c/B5、`_test_web3_fit_anchor` A8、`_test_brand_hijack_pun_exemption` F3、`_test_superip_slogan_class` C4、`_test_jev_question_consolidation` A1/A2/A11、`_test_jev_product_entity` A1/A2、`_test_referent_memeability` A1、`_test_jev_resonance` D5、`_test_jev_finding_recap_statement_gate` A19 同步；13 个版本锁测试 J1.84；叙事链 70+ 测试全绿（存量 `_test_instagram_pipeline`/`_test_publisher_proxy`/`_test_case_regression_lib` 失败为 J1.83/C141 工作树与回归集票数存量问题，本版未引入）。
- **部署**：待用户裁定——需 182 重启叙事 worker 加载 J1.84；全量 case-regression 对拍（W 票看新轴通过集/股城仍 low）；live 实验进程按持仓核验规程重启。

### C141 event_subject_entity 题退役——判据并入 event_fit unfit 桶 + 契合证据通用硬门 web3FitMassBlock（J1.83）（2026-10-21 用户裁定）★

- **案由**：用户质询「event_subject_entity 存在的价值是？」后裁定原话「我觉得这个也是口味契合的大类，应该放到 web3_user_event_fit 中，如果C/D 类没有通用硬门 可以加。」——事件主体是不是「产品实体/公司产物」本质是 web3 用户口味问题（用户接不接纳该主体做梗），不是独立叙事轴。与 C140（圈层并入 unfit）、J1.36（resonance 并入 fit）同族：判据素材同源的独立题只产生矛盾面。
- **两件套**：①**题整题退役**（标准 13→12 题）：`event_subject_entity`（J1.27 立，se∈{product_functional,product_character} 桶）删除；判据并入 `web3_user_event_fit` unfit 桶新臂「公司产品实体不被接纳」（锚句：华为发布麒麟芯片≠链上用户接纳麒麟；天然强契合刻意不选本项——强契合票本就该落 fit 档）+ fit 题尾三锚句（公司产品实体 J1.27/J1.83；无形象无玩梗空间→unfit；母公司影响力/规格不转移给产品）。②**门一般化**：mapper `productEntityAcceptanceBlock`（域=se 两桶×fitMass<0.5）退役 → `web3FitMassBlock` 通用硬门——**strong_fit+fit 合计 <0.5 → 拦，全域**（用户裁定「C/D 类没有通用硬门可以加」的落地取全域：口味不足对任何类别都是拦截理由，与 C140 unfit 负门全域化同构）。拦截 label「Web3用户契合证据不足(J1.83)（sf+fit 合计 N%<50%）」。
- **门链挂点与豁免集**：挂 `web3UnfitBlock`（负门）之后、veto argmax 链之前——「明显不想要（unfit）」先拦，「想要证据不足（sf+fit<0.5）」后拦，两层口味门与质量门（nhn/rcp）构成完整序。豁免四条件 `pubProxyActive || isW || binanceCorpus || platformOfficial`（发布者代理/W 数学/币安语料/平台官方号——C86 D-1、C88 五腿、C44 IG 锚、J1.18 锚等豁免路径的行为面完整保留）。**刻意不豁 punExempt/imgNameExempt**：punExempt 前提 effTier S/A（fitMass≥0.7）与新门结构无冲突；imgNameExempt 低 fit 票豁免救回后总分必 <60（事件分 20×0.6+关联 5 上界），评级等价不变——直接拦归因更干净（豁免救一个必拦票无意义）。`magExempt`（pun/imgName/口号票聚合）只豁量级门两臂不豁新门。
- **同轴遮蔽（J1.79 派生数学的必然后果）**：J1.79 后 tier 完全由 fitMass 派生（`MAGNITUDE_TIERS[round(fitMass*5)]`）→ ①量级门 D/E 档臂域 [0.1,0.3) ⊂ 新门域 [0,0.5)：非豁免票「事件主体量级不足（D/E 档）」label 被遮蔽，归因迁移至契合门（拦截语义等价迁移，无票翻放）；②「事件分不足（<60）」臂域 [0.3,0.6) 只剩 [0.5,0.6) 段活跃；③C44 IG 锚 floor 50 的有效抬分域 fitMass<0.5 与门域完全重合——非豁免票抬分路径死代码（锚计算/审计 `instagramSpreadAnchor`/`influenceFloor` 照落，归因在门）；④J1.36 E 类折损臂收窄为豁免路径（非豁免低 fit 票先被门拦，折损数学对豁免票照常工作）。
- **单向收紧证明**：旧门拦截条件（se 两桶 ∧ fitMass<0.5）⊂ 新门拦截条件（fitMass<0.5，豁免链相同）→ 无票翻放；历史行 se 答案键 mapper 忽略、`subjectEntity` 审计键照落只读展示（断代不删值）。
- **单测**：`_test_jev_product_entity` 整文件重写（38P：题退役/锚句/unfit 桶臂/无 se 照拦/label/审计 `{fitMass}`/历史行 se 照落/character_ip 行为翻转/C/D 通用硬门/豁免链四条件/FlapGuy 官方源豁免/挂点序/版本头条目）；22 个测试同步——遮蔽 label 迁移（web3_fit_anchor A6/A7、publisher_proxy B9b、resonance B1/C3、narrator B5、empty_content A2、image_depicts A2、instagram E1/E1c）；fixture 双策略保豁免链可达（币安语料豁门=name_image_consistency G 段 C86 D-1 原断言全保/subject_carrier D3/D4 门链序/superip_slogan E1b 五腿/resonance A3 折损数学；fitOk 过线=empty_content/image_depicts B+ 段豁免链）；版本链头插 J1.83=C141。
- **部署**：随 C138+C139+C140+C142 四案一批 182（J1.84 题集）——定向重析对拍 + 全量回归 + worker/live 重启（live 重启前持仓核验）。



- **案由**：用户裁定原话「token_circle_reachability 是不是没必要单独存在？放到 web3_user_event_fit 即可？」「web3 圈层不可达，就是不适合 web3 用户呗」。`event_token_block_reason.token_circle_reachability`（J1.53 由 niche_subculture 改名，A 域 argmax 桶）与 `web3_user_event_fit` 判定素材完全同源（同一份语料+同一 web3 用户视角），「get 不到」与「不想要」处置完全相同（都拦）——独立作答只产生矛盾面，同 **J1.36 删 event_resonance** 先例（用户同款问法第二次）。C122「不合并」裁定对象=并入名字接纳度，不冲突；其「A-only 域只能靠独立桶」前提在 unfit 负门（`web3UnfitBlock`，全域）已生效下不成立。
- **三件套（缺一即开洞）**：①题集删桶；②**unfit 档吸收圈层判据**（圈外亚文化 get 不到梗=unfit；「圈外」唯一口径=crypto 圈用户能不能 get 非大众出圈前景；PEPE/doge 圈内梗反向臂+品牌营销物料边界句随迁——C110 实证缺句会漂移 argmax）；③**marginal 圈外臂删除**（原「不重叠小众领域落 marginal 不拦」=删桶逃逸洞——圈外亚文化形象票有形象可玩恰落 marginal；C122 时 5/23 张票靠该桶独活拦截即此形状）——marginal 收窄为「圈内能 get、有部分契合要素、玩味空间有限」；可达性轴（get 不到）整体归 unfit。
- **拦截形状迁移**：原 A 域 argmax 桶（须独占最突出阻断才拦）→ 全域 unfit≥0.5 概率门（`web3UnfitBlock` 零逻辑改动承接）。mapper `BLOCK_SCOPE` 新旧键（token_circle_reachability/niche_subculture）显式空域退役（J1.43 先例，防 legacy choice 照拦）；BLOCK_LABELS 保留防 fallback 裸键名。
- **同批两层定位句（用户裁定「先判断事件质量，然后事件是否符合 web3 用户，这两个过了，事件算过了」）**：`event_token_block_reason` 定位句从「硬阻断检查/无叙事价值」改**事件质量否决三问**——①是否有意义（空洞/无据）②重要度（机构日常/常规内容产品宣传）③是否负面（硬新闻）——题头显式声明两层结构（本题=第一层质量，event_fit=第二层口味）；桶群零改动（现有桶天然映射三问）。门链执行顺序不动：nhn/rcp 质量概率门本就在 unfit 口味门前，argmax 链归因顺序维持现状（调序只改标签会致回归票 reason 无谓漂移）。
- **键名断代（同裁定「event_token_block_reason 的名字也要改」）**：`event_token_block_reason` → **`event_quality_veto`**——对齐定位句「事件质量否决」两层结构第一层（与第二层 `web3_user_event_fit` 构成 veto↔fit 对仗；J1.17 曾因 token_* 桶加对象前缀，现定位收敛为质量否决）。mapper `blockAnswers()` 双键归一读存量 token_narrative 行（C123 改名先例：改名不改判据，旧行 bit 不变——J1.82 上线后未重析行拦截不丢失）；审计 probabilities 新行落新键（旧行历史键保留展示）；Web 叙事页/jev_calibration 双键读；dryrun 题集 id 校验切新键；22 个测试 fixture 切新键（superip_slogan 的 JSON 历史行快照刻意保留旧键=顺带覆盖旧键路径）。
- **行为变化（刻意）**：全域原 marginal 圈外票（E/C/D 传统行业/地域文化热点）移档 unfit≥0.5 → rating 1，**拦截面扩大**；A 域圈外票从「argmax 独占才拦」变「unfit 概率门」。
- **单测**：question_consolidation 87P（A11c/c2 锚句迁址断言+A11d 空域+A11e marginal 圈外臂删除=A11c2 同级防线+A12b 桶退役反证+A12e/f unfit 0.62 概率门 A/B 域同拦=全域语义+**G5 旧键行双键归一照拦断言**）；angle_timing_override C5 版本断言存量债修复（J1.79→J1.82）+ E1d 已由 J1.81 会话修复（59P 全绿）。改名批次 22 个测试 fixture 切新键全绿（含 product_entity D1 挂点序/name_entity_acceptance D5b 键存在两处源码锚点断言同步）。
- **部署**：随 C138+C139 三案一批（见 C139 部署行）；**定向重析对拍=C122 5 张存活拦截票（防逃逸）+ SAND/潘多拉佩吉两张待裁释放样本（看移档后反被 unfit 拦的正反两向数据）**；全量回归 46 票对拍。


### C139 名字三轴重构（J1.81）——实体五桶 wrong_entity + 词句题 phrase 收窄 + 载体题 visuality + 著名免形象资格（2026-10-21 用户裁定）★

- **案由**：用户发现名字门三题职责纠缠（`web3_user_name_entity_acceptance`/`name_entity_carrier`/`web3_user_name_acceptability`），裁定理顺为三轴：「通过实体题判断是否是实体，对于非著名实体，要求有形象；词句题改名，用于判断非实体（口号/玩梗等）的情况」。锚票：日本語版（wrong_entity 正主，C105 版本臂）/EARLY/CRO（拼写臂）/币安上电视（陈述句→not_entity）/heyi.ai（著名免形象资格）。
- **三轴结构**：①**实体轴** `web3_user_name_entity_acceptance` 五桶判「指向什么」——accepted（著名实体）/unknown（已存在实体无认知，B/C/D/F/G/W 域拦，J1.56 不变）/new_entity（不触门，J1.72 不变）/**wrong_entity（新桶：指向实体但指歪/指残——拼写错/不忠实呈现/版本标注残片；版本残片即便逐字出自高影响力主体原话也不接纳，日本語版案）**/**not_entity（原 no_entity 改名：不映射实体=口号/玩梗/陈述句，拦截责任交词句门）**；②**形象轴** `web3_user_entity_visuality`（原 name_entity_carrier 改名，三态档位与判定不变）——非著名实体要求有形象；③**词句轴** `web3_user_phrase_acceptability`（原 web3_user_name_acceptability 改名）**只评不映射实体的名字**——实体票（accepted/unknown/new_entity/wrong_entity）全跳过；J1.80/C138 超IP来源判据段随行（判据文字不动）。
- **wrong_entity 门（全域）**：`wrongEntityBlock` = `probabilities.wrong_entity >= 0.5` **全域拦（A/E 域也拦）**——与 ne 门 B/C/D/F/G/W 域刻意不同（指歪是客观错误非认知度问题）；审计 `nameWrongEntityMass`；C105 版本臂+C108 拼写臂拦截责任迁入（词句题版本/拼写两 choice 删除，判据文字挪实体题）。
- **词句门收窄**：`web3UserAcceptabilityBlock` 头部分流——entityChoice ∈ {accepted, unknown, new_entity, wrong_entity} → return null 跳过；not_entity 照评；no_entity=旧行兼容读（旧行 bit 不变）；缺失照评（fail-open 语义不变）；拦截 Set 兼容不动。
- **著名免形象资格（用户裁定「1，可以」）**：`famousEntity = accepted_prob ≥ 0.5 ∨ 超IP认证行在册（corpusAuthorInRegistry）∨ authorUtterance` → 形象门整门跳过（前两源在调用点 hoist，authorUtterance 臂留门内）；审计 `subjectCarrierFamousExempt` 命中才落。**C88 五腿豁免臂中载体门臂退役**（rcp/劫持/关联豁免与评分贡献不动；图证覆盖豁免 C109/C118 保留）——行为不可见论证：五腿第一腿前提=accepted≥0.5（→著名资格仍豁免）∨ authorUtterance（→臂保留仍豁免），载体门行为完全一致；**新增豁免面=著名但五腿其余腿不达标的票**（heyi.ai 认证行型：S 级+fit 0.94 达标但非五腿全绿，原被载体门管、现著名资格直通——配合 C138 题面判据即本案预期翻案路径）。
- **载体门域维持现状（用户裁定「2.维持现状」）**：C/D 拦 improvised+no_visual、E 只拦 no_visual、A/B/W/F/G 不碰。
- **门链序**：ne 实体门 → we 指歪门 → ua 词句门 → sc 形象门 → 量级 D/E 门。**键名断代**：词句三键读 `web3_user_phrase_acceptability ?? web3_user_name_acceptability ?? name_form`；visuality 双键读（新旧）；审计 dump 键 `name_entity_carrier` 沿用历史名（行格式稳定）；Web 叙事页旧缓存行双键读。
- **边界效应观察位**：A 类 unknown 五五开票 J1.81 三轴全放（原 C108 靠 name_form 兜底拦——词句门收窄后不再管非 not_entity 票）；C 类 unknown 0.62 仍被 ne 门拦（无名实体拦截语义保住）。A 类著名边缘票留观察。
- **单测**：subject_carrier 全文件重写（60P：visuality 键名/著名资格 I 组/五腿退役反证 G1b+G2c/链序 G2）；name_entity_acceptance 40P（E 组 wrong_entity 全域+阈值 0.5+entityChoice 分流）；finding_recap 106P（fixture 实体调参「choice 迁 not_entity+accepted 概率保留」同时保五腿/著名两路径——mapper 只读 probabilities 不校验 argmax）；question_consolidation 85P；referent_memeability/product_entity/notable_other_exit 适配（B4 改写=accepted 实体票词句门同放为分流边界）；jev_resonance/narrator_two_shapes 补 J1.80 起漏 bump 的版本断言存量债。叙事链 35+ 测试全绿。
- **并行案备注**：C140/J1.82（圈层可达性桶退役并入 event_fit unfit 档）由并行会话同批追加，版本常量现为 J1.82（C138+C139+C140 三案一批）；各测试版本断言统一 J1.82 并标注归属。
- **部署（用户裁定「3.一起吧」C138+C139 合并一轮）**：182 定向重析对拍（heyi.ai 预期翻案 mid/high、日本語版预期 wrong_entity 维持拦、EARLY/CRO 维持）→ 全量回归对拍（45 票——日本語版已以 C105 在集，断言=必拦不锁门，J1.81 换门 wrong_entity 拦亦满足，一票一 case 不重复收录）→ 翻案票 `--update-expect --because` 留痕 → worker+live 37b19a9f 重启（live 重启前持仓核验）——待执行。

### C138 名字门超IP来源判据（J1.80）——heyi.ai 案：原判据不动，超IP票不能接纳标准提高为极端否证（2026-10-21 用户裁定「方案B」）★

- **案由**：`0x1774c0cc851a777c89fb0e1d73712bc7564b7777`（heyi.ai，flap 非 BNB quote 盘、税币；叙事行 platform 误标 fourmeme，2026-10-20 15:17 UTC）——何一 @heyibinance 推文宣告 Binance Agent ID 后 **10 秒**发币、**14 秒拉满毕业**（内盘 6.7x）、PCS 毕业盘 vol24 $103K 后 h24 -89%（庄家砸盘）。J1.79 判读：tier S / strong_fit 0.94 / relPositive 1 / new_entity 0.78 / 载体被 C109 图证豁免（match 0.86）/ authorUtterance=false（推文无「heyi.ai」逐字）——全门放行，唯 J1.42 名字门 `web3_user_not_acceptable 0.62` 拦（读法=「heyi.ai=产品/域名」，忽视「heyi=何一圈内代称+.ai 概念后缀」的符号面）。
- **归因与框架修正**：名字门拦截假设「名字当不了符号→传播不发生→热度聚不起来」被市场反证——14s 毕业=短窗聚热 S 级、购买意愿真实存在；传播动力=主体背书（何一）非名字玩味性。用户裁定框架：**引擎=新发 meme 快速交易（刚发买短窗卖），case 判断只看短窗聚热/接盘/进场点，绝不用长期价格论证**（-89% 是砸盘路径非名字质量证据）；判据错位（该不该放）与执行抓不住（叙事链 6-7s 进场=毕业顶）分开回答。
- **改动（方案B，用户四轮措辞定稿）**：原判据一字不动；`web3_user_name_acceptability` 题 instructions/criteria 追加「超级IP来源判据（J1.80/C138）」段——判断信息=state `corpus_author_identity` 认证行在册（super-ip 注册表命中注入，代码事实零掷骰；heyibinance 在册 tier S）∧ 名字与主体相关（其代称/名字/缩写/官宣事物名/本人词句）→ 不能接纳标准提高为极端否证：「**这个名字，从 BSC 链 meme 币交易者角度，即使是超级IP即影响力超大的用户讲的话，也完全当不了符号，完全不适合作为 meme 币，不会产生购买意愿**」——只有完全没戏才拦（陈述句/版本词/纯功能词/无姿态生活陈述照拦，「币安上电视」「日本語版」语料作者本就是超IP，案史自洽）；主体背书产生购买意愿的名字（heyi+.ai 概念后缀型）算能接纳。choice 仍三态、mapper 门函数零改动（拦截 Set 不变），语义翻转全由 Jev 按新判据出 choice；旧缓存行不重放 mapper 零影响。JEV_QUESTIONS_VERSION J1.79→J1.80。
- **单测**：版本断言 9 文件同步+D5c 锁新段存在性；superip_slogan_class G2 顺手同步并行案 scBlock 签名（authorUtterance 臂）。
- **并行案备注**：mapper 内 eth_cedric 案注释标「C138」实为台账 C137（编号笔误，待其会话修正）。
- **部署**：182 定向重析（heyi.ai 票预期翻案 mid/high）+ 全量回归对拍 + worker/live 实验进程重启待执行（live 重启前须持仓核验）。

### C137 eth_cedric（Flap dev）注册 super-ip——J1.58 表态豁免臂吃到（2026-10-21 用户裁定）★

- **案由**：`0xeeed1ed1b6bd0eae15bb651490a7e8b3057f7777`（MEMES / "Memes will continue"，four.meme，2026-10-20 15:02 UTC）——@eth_cedric（46539 粉认证号）发纯文字表态「Memes will continue.」（无图、无父推、9 赞 1 转），60s 后发币。J1.79 判 `event_empty_content` 0.93 拦（low）。用户质询「web3_user_event_fit 说明接受度高，为何又是空洞内容」后裁定：**eth_cedric 是 flap 的 dev，在 BSC 链 meme 币场景影响力极高，注册进 super-ip 注册表**。
- **归因**：fit（strong 0.49，confidence 仅 0.32）与 empty_content 是正交轴（口味质量 vs 叙事存在性，题面明文分工）不构成矛盾；真拦截原因是 J1.58 表态豁免两层都没吃到——题面豁免口径被 Jev 锚在「CZ/何一/币安」级符号人物（4.6 万粉腰部 KOL 没够档），代码臂 `corpusAuthorInRegistry` 注册表 miss。注册后表态票豁 empty_content 臂（mapper `emptyContentAuthorOverride`），名字/载体/量级门照常接管（与 C114 图证豁免同构）。注意本案 symbol=MEMES 逐字出自主推文本——J1.56 作者原话票（C88 第一腿补位）随注册同时激活，但五腿 strongFit 腿 0.49<0.5 是否随 state 认证行翻过待重析验证。
- **改动**：`super-ip-registry.mjs` 加 `'eth_cedric': { name: 'Cedric', type: 'person', tier: 'A', desc: 'Flap平台dev' }`。tier=A 对齐 haze0x（GMGN 创始人）/four_meme_fora 同级——注册表消费臂（J1.58 豁免/C117 强制标准路径/J1.56 原话票）均不看 tier，tier 仅入 state 认证行；4.6 万粉给 S 会与世界级认证行措辞矛盾。影响面=注册表六消费点全激活：①J1.58 empty_content 豁免 ②C117 强制标准路径（eth_cedric 自发宣告票不再被 prestage abm 评）③J1.56 作者原话票 ④state `corpus_author_identity` 认证行 ⑤J1.24 戏谑豁免可信事件锚 ⑥tweet-type-classifier。
- **单测**：注册表消费相关 7 文件全绿（superip_standard_path / superip_no_prestage_route / brand_hijack_pun_exemption / gmgn_superip_tweet_enrich / name_entity_acceptance / precheck_tweet_freshness_bucket / vision_gate）。
- **部署**：182 worker + live 实验进程重启 + MEMES 定向重析对拍待执行（live 直调链路在实验进程内，重启实验前须持仓核验）。

### C136 叙事抽样测试集（180 票三实验分层抽样）——评级与涨幅首轮零相关观察（2026-10-21 用户指令）★

- **案由**：用户指令「基于 6209342e/37b19a9f/05222b30 实验，取样代币加入叙事分析测试集合，涨幅最高/最低各 50+随机 50（后扩至各 60+60=180），取样后跑当前叙事分析结果」。两项裁定：①**独立抽样集资产**（不并入 case 回归集 fixtures——回归集保持 caseId=台账编号纯净，抽样集 `--set` 单独跑）；②**随机层仅从涨幅已知池抽**（180 票全带涨幅，三层都可做「评级 vs 涨幅」对拍）。
- **资产**（`scripts/narrative/case-regression/`）：`build-sample.mjs`（构建器，`npm run narrative-sample-build`：experiment_tokens 并集 → token_profiles 涨幅已知池 → 排除回归集票 → 分层落盘）；`run-sample.mjs`（runner，`npm run narrative-sample`：整链重析 + 分层×评级矩阵 + CSV/JSON 存档 data/，`--only top|bottom|random`/`--dry`）；`sample-sets/2026-10-21-three-exp-180.json`（本体，seed=20261021 可复现，.gitignore 否定规则保入）；分层纯函数 `stratifySample`/`mulberry32` 收进 lib.mjs（单测 36→44 断言，红线 13）。
- **抽样口径**：涨幅=`token_profiles.max_change_percent`（峰值涨幅，BNB 计价可用价链）；三实验并集 15290（6209342e 3167/37b19a9f 8761/05222b30 6529），涨幅已知 2525（**flap 2368/fourmeme 157**——fourmeme 票画像行覆盖仅 24% 且有行者 86% 无可用价 tick=尘票，两层叠加致池结构性偏 flap，抽样 171/180 flap），排除回归集票 9 → 抽样池 2516；top60 max∈[520.9%,1420.5%]；bottom60 并列 max=0 按 final 升序（跌最狠优先）。
- **首轮结果**（题集 J1.79+P1.13，2026-10-21 182 跑，180/180 完成 0 异常 ~5min；存档 `data/sample-2026-10-21-three-exp-180-result-*.csv/json`）：top60 low54/mid1/high5；bottom60 low55/mid0/high5；random60 low53/mid2/high5——**三层评级分布几乎相同，与涨幅零相关**（high 组 maxGain 均值 292.1% vs low 组 297.2%，中位 16.0% vs 15.6%）；15 票基线→现评翻转（10 翻 high=跨题集版本差，实验期旧行多为 J1.7x 前版本）；21 票 precheck 硬拒（expired_tweet 8/blacklist 6/no_public_info 5/fetch_failed 2/symbol_too_long 1/instagram_high_influence 1）。
- **观察（未裁定不动门）**：评级对结局涨幅无区分度的两种读法——①评级测叙事质量而非涨幅预测（样本以尘票为主、本就不是买候选，且涨幅 top 里 54/60 仍 low 说明「会涨」≠「叙事合格」）；②若诉求是涨幅区分度，需与人气门联合评估而非单看叙事层。方向待用户裁定。

### C135 事件层收敛为 Web3 用户口味契合——事件分=web3_user_event_fit（impact 题删除）（J1.79）（2026-10-20 用户裁定）★

- **案由**：事件分从 J1.71 三合一（impact+spread+timing）起，J1.75 被动波及口径/J1.76 证据口径/J1.77 原事件采信多轮迭代仍分不开高低分（用户批评「死板的分级」，且明确否决「无条件 +1.8」校准）。用户最终裁定：「事件分，我们的方案不是改用 fit 吗？」「改吧」——事件价值直接取 Web3 用户对叙事的口味契合（`web3_user_event_fit`），叙事存在性/名字/拼写/载体/实体由既有臂负责过滤（用户：「叙事存在性、名字、拼写、载体、实体这些臂应该都有了」）。
- **改动（J1.79，`e2bf2f3`）**：①删除 `web3_user_event_impact` 题（题库 14→13），`web3_user_event_fit` 标注为事件价值题；②标准路径 `eventCompositeScore = round2(min(1, strong_fit+fit)×100)`（pass 60）；③`influenceScore = round2(likedMass×5)` 派生 impactTier，仅供 J1.24 戏谑关联豁免/J1.30 名图一致/C86/C94 等量级锚与审计，**不再有独立影响力题**；④旧源时效 override 由「-18 分」改为「事件分封顶 30」；⑤E 类感染力折损（J1.36）与 `unfit≥0.5` 负门保留；⑥J1.78 动作/趋势名（「蝙蝠侠式蹦迪」「XX摇」）判 no_visual 载体规则随批生效；⑦DND `empty_content` 图证载体豁免接线（要求 block_reason=empty_content）。五臂过滤全部保留、零新增拦截位。
- **回归（182，43 票，2026-10-20 14:51 UTC）**：35 PASS / 1 FAIL / 7 OBSERVE-DEVIATION / 0 ERROR。FAIL=C94 京小安 low→high 88.33（实体题 `new_entity` 放行实体门后事件分过线——C133 新实体选项与实体门的交互面，待裁定）。目标票：C130 돼지 H **high 77.89 PASS**；C109a 交易猫 low（**Stage3 关联分 none 0 分拦截**，非事件分——既有 relevance 臂，待裁定）；C114 DND low（empty_content 图证豁免要求 `block_reason=empty_content`，本跑 `blockChoice=none` 未触发；载体门仍拦，待裁定）。OBSERVE 另含 C79/C82/C100/C126 等既有掷骰面。
- **单测**：27 文件 972 断言全绿（`_test_web3_fit_anchor`/`_test_narrator_two_shapes` 按新标准重写；其余数值/label/题数/版本断言同步）。
- **部署**：182 `e2bf2f3`；叙事 worker 14:58 UTC 重启（PID 4186716，JEV version 探针=`J1.79`）；live `37b19a9f` 14:59:57 UTC 重启（重启前 trades 20 行净持仓 0 核验）；新建虚拟 `6209342e-959f-4634-b190-dffd2e9695ab`（v27-虚拟-both-J1.79事件分fit-1020）15:01:44 UTC 起，config=live 行整包克隆去 wallet（strategiesConfig/positionManagement 逐字相同）。
- **回归集**：`d3a36c7` 已将 C109a/C130/C114 期望置 high（`expectBecause`/`expectSince` 留痕）；本 case 不新增单票，沿用三票断言。
- **待裁定**（本批遗留）：①C109a 交易猫 Stage3 关联分 none 0 分（图证关联是否给豁免）；②C114 图证豁免扩面（block_reason=none 但主推极短+配图/视频在场）；③C94 `new_entity` 与实体门交互（新实体是否绕过实体低影响力门）。④**单块门移除=同日用户裁定**（买腿 description 留痕）：`maxBlockBuyCircPct < 25` 全史口径在 111 票回放 110/111 全拦、11 笔实盘拦 10 含 3 正票，用户裁定先行移除、口径待重议；sybil 大簇门保留——live/虚拟买腿现均不含单块门，实验行 name/description 的 v27 文本为历史残留。

### C134 W 类数学去掉币安交互臂，改为项目对 BSC 用户吸引力——J1.74 股城案延续（2026-10-20 用户裁定）★

- **案由**：`0xaacbc156435dbab7815a61bccba1c827e52a7777`（symbol `股城`，name `STOCKOPOLIS`，flap）。实体门由 new_entity 放行后，W 类数学 = 产品 16.28 + 币安交互 1.44 + 时效 25 = 42.72 → low。用户裁定：「发在 BSC 链的项目，一开始刚发出，基本上不可能有币安交互，把币安交互这一臂去掉，改为分析项目本身对 BSC Web3 用户的吸引力」。
- **改动（J1.74）**：①删除 `w_binance_interaction` 题（币安交互 0-40 轴整链退役）；②新增 `w_bsc_user_appeal`（项目对 BSC 链 Web3 用户的吸引力，0-40 同权重）——评估项目自身的叙事题材/玩法与参与机制/参与门槛/传播点，模拟 BSC 链用户/Meme 币玩家第一次看到项目的反应（想不想参与/讨论/转发/拉人）；**明确不评币安官方交互**（刚发布项目不可能有，不扣分）、不评发布后实测热度；③W 数学 = 产品(0-35) + BSC用户吸引力(0-40) + 时效(0-25)，pass 线 60；**C42 世界级主体产品豁免币安交互随被豁免的轴退役**（三轴恒全额参与）；④`scoringResult.wInteractionScore` → `wAppealScore`，reason 文案「交互」→「BSC用户吸引力」。题数不变。
- **实测（182，13:53:33 UTC，J1.74）**：实体题保持 `new_entity 0.99`（实体门放行）；W 数学 = 产品 16.2 + **BSC用户吸引力 17.11** + 时效 25 = **58.31 < 60** → low（差 1.69）。吸引力题概率质量 band2 0.68 / band1 0.24，但 score=1.79（概率期望）→ `bandInterpolate` 落 band1 [10,19] 得 17.11；若 score≥2.0（band2）即 20+ 过线——属 band 1/2 边缘票。
- **单测**：新增 `_test_w_bsc_user_appeal`（16/0：三轴精确值/低吸引力拦截/C42 退役反证/题集形状/源码口径反证）；旧 `_test_w_interaction_exempt` 删除；16 个相关测试版本断言与 fixture 键名同步 J1.74，全绿。
- **部署**：`4ee5fb1`；182 已 pull。worker/实盘重启后对新分析生效。
- **并行会话备注**：本批与另一会话未提交的 J1.73（C132 事件价值=web3_fit 单臂，删除 impact 题）在共享工作区并存——本批在隔离 worktree 提交，未触碰对方改动；两批合并时版本以 J1.74+ 为准（J1.72 亦曾出现两批同号撞车）。

### C133 币名映射实体新增 new_entity（新实体）——J1.72 股城案（2026-10-20 用户裁定）★

- **案由**：`0xaacbc156435dbab7815a61bccba1c827e52a7777`（symbol `股城`，name `STOCKOPOLIS`，flap）。空语料搜索兜底命中 29 条（毛毛姐 @MEJ50749 官宣、官方号 @STOCK__OPOLIS 进展、涨幅转述），但 J1.69/71 实体题判 `unknown 0.60` → 实体低影响力门拦（「币名映射实体在 Web3 用户侧无名」）。用户裁定：「这是新发的项目，并且已经在 BSC 链用户群发出了信息，那为何说『用户不认得该实体』？我觉得可以算是 new_entity，也就是新实体」。
- **改动（J1.72）**：`web3_user_name_entity_acceptance` 新增第四选 **new_entity**——刚诞生/刚发布、且已在 BSC 链用户群（推特/社区/官方渠道）发出自己的信息（官宣/自我介绍/进展/社区讨论）的新项目/新品牌/新角色/新资产；用户此前没听说过是正常的，**不按「认知度不足」判**；`unknown` 收窄为**已存在的实体**在用户侧无认知（YAYA 型）。mapper 实体门**只读 unknown 概率**（new_entity 为 argmax ⇒ unknown<0.5，概率和为 1，天然不触门），新实体的名字形态/内容由名字门与下游评分题判。题数不变。
- **实测（182，13:34:14 UTC，J1.72）**：实体题 `unknown 0.60 → new_entity 0.99`（unknown 0）→ **实体门不再拦**；下游 W 类数学 = 产品 16.28 + 交互 1.44 + 时效 25 = **42.72 < 60** → low（死因变为「W 类总分不足」）。实体门问题收口；本票仍 low 属 W 类对独立 BSC 项目交互轴天然低分，不再是实体认知题责任（交互轴随后由 C134/J1.74 退役）。
- **单测**：`_test_name_entity_acceptance` 31/0（新增 new_entity 0.62 不触门、new_entity argmax+unknown 0.40 不拦）；题集收敛 4 桶断言 + 10 个版本断言文件同步 J1.72，全绿。
- **Case 收录**：C133 录入 case-regression（票数 42→43），断言 `rating=low` + `tokenCategory=event:W` + `reasonIncludes=W类总分不足`（实体门回退 unknown 会成为回归信号）。
- **部署**：`4c0a940`；182 已 pull。题集在 worker/实验进程内，重启后对新分析生效（存量缓存行不重放题面）。

### C132 时效豁免四类框架——用烂风险触达量主轴（C104 回落拦适用集收窄）（2026-10-20 用户裁定）★

- **案由**：`0xb10b2c022a717a66fa627c9c9ce73779b5347777`（symbol `混混猫`，name `THugcat`，fourmeme，taxToken）。语料=Four.Meme Fora（`four_meme_Fora`，23917 粉认证号）2026-10-09 10:13 UTC 的「DeBox｜BNC4 社区之星交易赛圆满结束，恭喜 $混混猫 社区荣获社区之星」活动收官 recap；token 2026-10-20 10:12 UTC 创建（分析距创建仅 2s），主推 lag 950348s（≈11d）→ direct_tweet 豁免桶被 C104 主从结构门回落（源头 >24h 无新载体=「旧推用烂形状」）→ expired_tweet low，Jev 未跑。用户裁定：**主推不属于时效洗白**——「作者不是超级IP。影响力中等偏上，被发现这个叙事可能需要时间，而且也不会被用烂，反而可以豁免」。
- **四类框架（用户裁定）**：①超级 IP 新鲜推（≤24h）：豁免（C74 立案原型保持）②**高用烂风险作者**旧推（>24h 无新载体）：拦（C104 形状保持）③**中等偏上触达作者**旧推：豁免交 Jev 软评（本裁定新增——慢热叙事发酵需要时间+触达有限用不烂，活动收官 recap 是自然节奏非洗白）④angle_seeking 等非豁免桶：300s 拦（保持）。第③类上界由 C75 mapper 30d 软锚管（precheck 层不拦，Jev 层归 older）。
- **用烂风险判据（三轮裁定收敛，`isHighWearRiskAuthor`）**：触达量是真轴，注册表收录只是粉缺失时的辅助——**粉已知 → ≥ `MEGA_REACH_FOLLOWERS`(50万) 即拦**（收录与否无关：CZ 1299 万/未收录 Dexerto 145 万同形，「粉≥50万即拦」）；粉已知 <50万 → 第③类豁免（`four_meme_fora` 在 SUPER_IP_REGISTRY tier A 但 23917 粉——**注册表 tier 无触达维度是本案暴露的归类偏差**，机械查表与本裁定矛盾由触达门修正）；**粉缺失（null）→ 看收录**：注册表/高影响力名单命中拦（fail-保守：收录是唯一触达证据，C86 null≠0 同教训），未命中放（普通作者默认非超级 IP）。
- **改动**：①`tweet-type-classifier.mjs`：THRESHOLDS 增 `MEGA_REACH_FOLLOWERS: 500000` + 导出 `isHighWearRiskAuthor(twitterInfo)`；②`pre-check-service.mjs` 规则 2.1 C104 门：无新载体回落前判作者层级——高用烂风险照旧回落拦，否则第③类豁免（log 留痕，放行票无落库 details）；③题集/mapper 零改动（precheck 纯代码门，不 bump JEV_QUESTIONS_VERSION）。
- **单测**（`_test_precheck_tweet_freshness_bucket.cjs` M 节 + F 节改写，97/0）：混混猫现场反证（four_meme_Fora 11d 裸推 → 放）/注册表命中+巨粉（60 万）→ 拦/未收录巨粉（80 万，Dexerto 形状）→ 拦/未收录中等粉+互动臂 → 放/cz_binance 粉缺失 → 拦（fail-保守）/未收录粉缺失（互动臂进桶）→ 放/触达门边界 499999-500000/C75 30d 软锚源码锁/`staleDirectLagSec` 审计键回落形状保持。F 节翻转=裁定内（互动臂小作者 4500 粉裸旧推从 C104 拦改第③类豁免，新增 60 万粉反证锚拦截面）。
- **编号坑再现**：立案时 C130/C131 已被并行会话占用（돼지 H 名字门案/股城搜索兜底案），本 case 顺延 C132——**立 case 前必须 grep 台账+git log 双查**。
- **部署与验证（`cb50989`）**：182 已 pull + 叙事 worker 重启（11:56 UTC）。混混猫定向重析：C132 豁免日志生效（第③类放行）→ Jev 真跑 329ms → **low，阻断=机构日常运营（D 类 P=0.51 掷骰边缘）**——死因从「时效过期」变「叙事性质=平台日常活动播报」，拦截职责按裁定移交 Jev 软评。全量回归 41 票 **36 PASS / 0 FAIL / 5 OBSERVE / 0 ERROR**（与 C131 后基线逐位一致，零回归；存档 `case-regression-result-2026-10-20T11-56-45-881Z`）；混混猫已收录回归集（41→42，断言 rating=low+event:D，刻意不断言死因——机构日常运营 0.51 是掷骰面）。live 实验 `37b19a9f` 引擎内直调须实验重启才对新分析生效。

### C131 空语料搜索兜底不卡互动——语料非空即交 Jev 判叙事（2026-10-20 用户裁定）★

- **案由**：`0xaacbc156435dbab7815a61bccba1c827e52a7777`（symbol `股城`，name `STOCKOPOLIS`，flap）。flap metadata 只有「股城是建在 BNB Chain 上的链上城市」（IPFS 不可变），无任何社媒/网站链接 → precheck 规则 4-A `no_public_info` 秒拒，Jev 从未运行（low 10）。用户指令「你再取一下数据看看。空语料搜索兜底也开启呀」→ 开启 searchFallback 后实测：英文名查询 `"STOCKOPOLIS" since:2026-10-13` 命中 9 条、最大互动 4（旧阈值 200 不可达）；手工查中文 symbol `"股城"` 命中 16 条、最大互动 155（@MEJ50749 毛毛姐官宣 131 赞+12 转，官方号 @STOCK__OPOLIS 在场）——仍低于旧阈值。用户随即裁定：「为什么要卡互动呢？不卡，只通过语料了解叙事」。
- **改动**：①`searchFallback.enabled:true`（config 顶层）；②删除 `bypass.minTweets/minTopEngagement`（config + 服务层校验 + 文档），`meetsBypassThreshold` → `hasSearchCorpus`（去重剔转推后 `uniqueTweets > 0`）；③证据字段 `thresholdMet` → `hasCorpus`；engagement 只在 `[TWITTER_SEARCH]` state/审计里展示，**不参与准入**；④零语料不落缓存（保 1800s 重试域）；⑤单测 `_test_search_fallback.cjs` C/J 段改「低互动 2 条语料仍旁路」+ 源码反证（可执行代码无 minTweets/minTopEngagement）。
- **实测（182，11:52:47 UTC 重析，题集 J1.69）**：搜索兜底旁路 `no_public_info`（9 条、maxEngagement 4）→ Jev 真跑 330ms → **low 41.5**：category W 0.97 / impact 2 档 0.73（effTier C）/ `w_product_score` 2 档 0.72→15.24 + `w_binance_interaction` 0 档 0.87→1.26 + 时效 25 = 41.5 < 60（W 类总分不足）。名字门 `web3_user_acceptable` 0.63 放行；实体题 `no_entity` 0.62 中性；载体门不覆盖 W。**新失败点从 precheck 前移到 W 类数学（币安交互轴）**，语料已进 Jev 判断链。
- **追加裁定（同日）**：用户「搜索应该主要搜索 symbol，用户看到的主要是 symbol」→ `buildSearchQuery` 搜索词 **symbol 优先**（symbol 缺失/过短才回落 name）；`minNameChars:4` → `minTermChars:2`（2 字 CJK 币名可搜）；证据字段 `query.name` → `query.term`（commit e79e7c3）。
- **实测②（symbol 搜索，13:02:11 UTC 重析）**：查询 `"股城" since:2026-10-13` 命中 **29 条**（Top 16 / Latest 20，union 29）、maxEngagement 161；语料含 @MEJ50749 毛毛姐官宣、官方号 @STOCK__OPOLIS 进展、GMGN/涨幅转述（$4.3K→$208K, 48.3x）。→ Jev 真跑 360ms → **low**，死因变为 **实体低影响力门**：`web3_user_name_entity_acceptance unknown 0.60 ≥0.5`（category W 0.95 在域内）→ 「币名映射实体在 Web3 用户侧无名」。其后 W 类数学也不足（product 2 档 0.71 / interaction 0 档 0.81 / 时效 25），属双重拦截。
- **遗留/裁定点**：①**新项目名本身是否应判 unknown 实体**——「股城」是当日新发布项目名（毛毛姐团队），实体门按「用户不认得该实体」拦；C126 规格针对低影响力既有实体（普通币安员工），新项目名是否应走 `no_entity`/accepted 或豁免待用户裁定；②搜索词现按 symbol，name 仅回落；Jev state 的 `[TWITTER_SEARCH]` 段已显示 29 条精选。
- **部署**：`9d73911`（enabled）+ `f6869b4`（去互动门槛）+ `e79e7c3`（symbol 优先）+ 台账；182 已 pull。运行中的叙事 worker / 实盘 `37b19a9f` 进程仍持旧配置（进程内 config 缓存），重启后生效。

### C130 名字门判定对象收敛为链上 Symbol（币名）（J1.69）——돼지 H 案（2026-10-20 用户裁定）★

- **案由**：`0xcfc39a869380200949685d16197e93f100207777`（symbol `돼지 H`，name `구제역에서 살아 돌아온 돼지`，flap，live 实验 `37b19a9f`）。J1.55 分析（09:03:10 UTC）通过名字门以外的全部前置：`event_category A=0.91`（形象 IP·猪主角）、`jevImpactTier C`、`web3_user_impact=3`、`timing within_30d`、`subject_carrier=existing_entity`；但名字门按**链上全名**（韩语电影全名，一句陈述/作品名）判 `web3_user_not_acceptable 0.80` → low，无信号。用户裁定原话：「币名不是 돼지 H 吗？」「**币名应该看 Symbol**」。
- **改动（J1.69，commit 495fd69）**：`web3_user_name_acceptability` 判定对象从「代币 Name/Symbol 取更完整的一个」收敛为**链上 Symbol（币名/ticker）**——链上 Name（全名/描述句）不作本题判据；判据内容（能接纳/不能接纳各形态）一字不动，只改判谁。版本 J1.67→J1.69（J1.68 已被 C129 彪弟路由案占用）。范围=**只名字门**（用户选定）：实体低影响力门/形象载体门/关联/名图一致/brand hijack/prestage name_link 仍按 Symbol+Name 识别所指对象。
- **实测（J1.69 重析同票）**：名字门 `web3_user_acceptable 0.55` vs `not_acceptable 0.43`（掷骰边缘）→ **放行**（不再按电影全名拦）；实体门 A 类不入域、载体门 A 类不触达；最终事件分 **56.76 < 60**（27 B 档〔strong_fit 0.51 锚 B〕+ 传播 19.76 + 时效 10）→ **仍 low，但死因变为「事件分不足」**。改动改变的是拦截位，不是本票结局；回归轮二次重析 51.84 仍 low。
- **回归（182，41 票）**：**36 PASS / 0 FAIL / 5 OBSERVE-DEVIATION / 0 ERROR**；5 张=既有掷骰面（C108/C79/C80/C82/C113）；存档 `scripts/narrative/case-regression/data/case-regression-result-2026-10-20T11-51-08-107Z.{csv,json}`。相关零 DB 单测（名字门/题集版本断言 9 个文件）全绿。
- **Case 收录**：C130 已录入 case-regression（票数 40→41，commit 56d79f9），断言 `rating=low` + `tokenCategory=event:A`（**刻意不断言死因**——名字门 0.55/0.43 与 spread 2-vs-3 都是掷骰边缘，翻名字门时评级仍 low）；observe 记录两个边缘面。
- **命名收尾（J1.70，零判据零行为）**：用户问「mapper 变量能否直接使用名字？」「现在还有 stage2 吗？stage2Total 还有存在价值吗？」——确认 **stage2 作为阶段已不存在**（J1 单次 Jev 调用，stage1/stage2/stage_final 只是逻辑信封），「事件分」=`impactTierScore + spreadScore + timingScore` 的合成分（`stage2Total` 是历史名字）。J1.70 把局部变量与审计键全部语义化（`stage2Total`→`eventCompositeScore`、`tierScore`→`impactTierScore`、`effSpread`→`spreadScore`、`spread`→`rawSpreadScore`、`timeliness`→`timingScore`、加权项 `eventScore`→`weightedEventScore`、`stage2TotalScore`→`eventCompositeScore`），前端/扫描工具双键读旧行，UI 文案对齐（「事件分」=合成分 / 「事件加权分」=×0.6 项）；24 个 mapper 单测全绿。
- **部署**：题集在 worker 与实验进程（引擎惰性 import）内，需重启 182 叙事 worker + live 实验 `37b19a9f` 才对新分析生效；存量缓存行不重放题面（断代），只有重析/新分析走 J1.69/J1.70。
- **遗留/观察点**：①名字门答案无概率 mass（choice argmax），0.55/0.43 这类边缘票会随 Jev 掷骰翻转，评级由分数兜底（本票两臂都是 low）；②Symbol 为空或纯符号（emoji/数字）票的判据未单列——按题面「去 emoji/数字/特殊字符后」自然落到无法判断/低信息，待自然案例校准。

### C129 推文语料不被发行方检出劫进账号路径 + 抖音引用页不抓取（J1.68）——彪弟案（2026-10-20 用户裁定）★

- **案由**：`0x3b5c3271fb581e503389dd2c52a75065f36f7777`（symbol `彪弟`，name `小彪哥`，flap）。@jiaodudashi232 发推「彪哥的主人有了新的宠物 取名为彪弟…」+ 抖音账号页引用；作者时间线另有一条含 CA 的推文 → `detectIssuerByCaTimeline` 命中 → 旧路由 `|| !!issuerDetected` 把票劫进 account/community prestage → 标成 `account_based_meme`（web3ip 被 C101 拒后回落 abm）→ 账号 129 粉无 Web3 流量 → low。用户裁定：「这个不是 account_based_meme，account_based_meme 是指有推特账号的」；「抖音账号页，只是一个信息引用，而且推文本身的信息够了，无需获取其信息」。
- **改动（J1.68）**：①抽出纯函数 `shouldRouteToAccountCommunity`——issuer 检出臂（`issuerSelfLaunch || issuerCaTimeline`）**仅当语料不是「有内容的推文」时**才转账号路径；账号型语料/项目币臂原样保留。②data-fetch：推文语料有内容时，抖音 `user_profile` 仅作引用**跳过抓取**（`dataFetchResults.douyin={skipped,reason:'tweet_corpus_reference'}`；视频仍抓）。③新增零 DB 单测 `_test_account_route_tweet_corpus.cjs`（路由真值表+源码口径）。
- **实测**：彪弟案重析走**标准路径**（event:C），死因变为 **实体低影响力门**（`web3_user_name_entity_acceptance.unknown 93%≥50%`——「彪弟」这个实体 BSC 链 Meme 用户不认得），不再是误分类的 account_based_meme/无 Web3 流量。该票 11:12:52 创建、11:20:16 毕业（7.5 分钟），是未吃到的毕业盘。
- **回归**：182 全量 39 票 **33 PASS / 0 FAIL / 6 OBSERVE / 0 ERROR**（路由改动零回归）；全量零 DB 单测除存量 `_test_backtest_keyset_paging` 外全绿。
- **Case 收录（用户指令「先放到案例库中，其实是缺少背景信息导致的，之后再修」）**：C129 已录入 case-regression（票数 39→40），断言 `rating=low` + `reasonIncludes=币名映射实体在 Web3 用户侧无名`；observe 记录根因=**缺少背景信息**（彪弟=抖音「彪哥」的新宠物，账号 129 粉、圈外宠物账号，账号/视频背景未进语料 → 实体题 unknown 93% 属信息不足而非事实错误）——补背景信息的采集方案之后再做，届时用 `--update-expect` 留痕。

### C128 影响力口径改用户侧（J1.64）——账号规模只作覆盖上限 + 删营销噱头桶（2026-10-20 用户裁定）★

- **案由**：C110 币安菠萝 `0x8ce87ffebe62e6f7ea87173b441520f659307777` 与 C83 BI 簇（`0x11bec867…7777` / `0x28d8d2c2…7777` / `0x3891aeb8…7777`）。用户裁定原话：「走 B，A 是明显不对的，BI 我认为也可以给过」；并纠正方法论：「不是『影响力不足』，而是『影响力很大、但内容没有实质』——注意我们是从 Web3 用户侧判断影响力的，所以不应该有影响力大但内容无实质这种情况，如果有，本质就是用户侧没啥影响力，就是标准不太对」。
- **改动（J1.64）**：①`web3_user_event_impact` 重写为 **B 标准**——影响力一律按 Web3 用户侧的认知与可调动性评档；形状①与六档锚点去掉粉丝数映射，账号粉丝量/机构规模只作覆盖上限；品牌具象视觉物料（币安符号菠萝、币安脸梵高像）B 档起评（可到 A）；机构边缘活动（节目征名）D 档（「事件撑不起币」）。②删除 `event_token_block_reason.event_marketing_gimmick`（选项 9→8）——「影响力大但无实质」在用户侧口径下不成立，噱头并入影响力轴；mapper 删除该选项的 argmax 豁免臂与 J1.63 平台官方图证豁免/审计。
- **实测（J1.64）**：**C110 → high**（用户裁定给过）；**C83a BI → high / C83b BI → mid**（BI 簇给过）；C109c BI → low（impact C 档，总分 46.18 未过线；C88 口号票命中但分数不足）；C97 币安游戏 impact 1 档 0.96（D 档，用户侧无认知）→ low（首因文案=机构日常运营，D 档量级门在其后）；C119 猫恢复 mid。
- **回归（182，39 票）**：32 PASS / 1 FAIL（C110 fixture 旧预期「low+营销噱头」——已更新为 high）/ 6 OBSERVE / 0 ERROR；C110 复跑确认 **PASS high 73.12**。全量零 DB 单测除存量 `_test_backtest_keyset_paging` 外全绿。
- **遗留裁定点**：①C97「事件撑不起币」首因被 `event_institution_routine` 抢先（门链序/是否也删该桶待裁定）；②C109c BI 是否也应给过（impact C 档导致总分不足）待裁定。

### C127 营销噱头收窄 + 事件影响力口径（J1.62）——「事件撑不起币」由影响力/量级轴判（2026-10-20 用户裁定）★

- **案由**：C97 币安游戏 `0xf37bbaea289a67af00ac0ee58421553e11987777`（BinanceArabic 电视节目征名推：「تخيل أن بينانس ستطلق برنامج مسابقات تلفزيوني…نحتاج اسماً للبرنامج」）。J1.61 实测死因=`event_marketing_gimmick 0.48`。用户裁定原话：「原因应该是事件撑不起币，而不应该是什么营销噱头。事件是『币安要推出一档电视游戏节目。我们需要给节目起个名字。』，我认为这应该不足以支撑任何一个 meme 币，但是『营销噱头』中好的营销，恐怕是可以的。度量的应该是『事件对 Web3 用户的影响力』」。
- **改动（J1.62）**：①`event_marketing_gimmick` 收窄——有实质对象/参与机制的营销活动（产品发布/活动官宣/节目征名/赛事报名/抽奖机制等有具体落地对象和参与方式）不选本项；纯标题党/引流/无实质信息才是噱头。「好的营销」不是阻断理由。②`web3_user_event_impact` 补营销事件口径——营销/征名/节目/活动类事件按**事件本身对 Web3 用户的影响力**评档，不按机构规模直接映射（大机构的一次边缘活动≠大事件）。
- **实测（J1.62）**：C97 `event_marketing_gimmick` 0.48→0.28（argmax 回到 none 0.38），`web3_user_event_impact` 5 档 0.53→3 档 0.45（S→B）；effTier 仍 D（地域子账号锚）→ 终态 low 维持。当前首个拦截位=名字门（币名「币安游戏」不可接纳）；D 档量级门（事件撑不起币）在其后，两轴同向。
- **回归（182，39 票）**：**34 PASS / 0 FAIL / 5 OBSERVE-DEVIATION / 0 ERROR**（较 J1.61 少 1 张 observe：C72 小黑掷骰面翻 high；C97/C106/C78 仅拦截位/评级小幅移动）。全量零 DB 单测除存量 `_test_backtest_keyset_paging` 外全绿。
- **遗留**：用户期望的首因文案「事件撑不起币」当前被名字门抢先（门链序：名字门→载体门→量级门）。若要让事件/量级门成为首因，需调整门链序或让名字门在 D/E 量级票上让位——属未裁定项。

### C126 币名映射实体接受度轴（J1.56）——概念解耦 + 命名按对象显式化（2026-10-20 用户裁定）★

- **案由**：何一 `0xf0ffa405…7777`「こんにちは」（flap，CZ《Freedom of Money》日文版发售当天何一回复问候语）。C120 巨粉豁免已过时效门（主推 lag 2.88h、作者 647k 粉），Jev 真跑后仍 low：`empty_content 0.36` / `mem 1.97` / 名字门 0.90。用户裁定三条：①「super_ip 本来就应该使用语料作者身份，这应该算 super_ip 喊出的口号类」；②「name_referent 改成『币名映射实体对 Web3 用户的接受度/影响力』，低影响力例如普通币安员工就不通过——但这个 case 根本不是实体（问候语），不影响判定」；③「命名规则尽量从用户角度出发，一个针对事件、一个针对币」。
- **改动**：①**题名按评估对象显式化**（纯 id 改名，判据零改动）：`event_finding_vs_recap` / `event_block_reason` / `event_subject_entity` / `web3_user_event_impact` / `web3_user_event_spread` / `web3_user_event_fit` / `name_event_relevance` / `name_brand_hijack` / `name_entity_memeability` / `name_entity_carrier` / `web3_user_name_acceptability` / `token_name_quality`。②`name_referent` → `web3_user_name_entity_acceptance`（**accepted / unknown / no_entity**；`no_entity` 中性不拦——问候语/截词/陈述句交名字形态门）。③`unknown ≥0.5` → **实体低影响力门**（域 B/C/D/F/G/W，规格=旧 J1.10 nrBlock；pubProxyActive 豁免；刻意 delta=截词归 no_entity 不拦，C108 已把形态责任交名字门）。④**作者原话票**：`detectAuthorUtterance`（注册表作者 ∧ 币名归一化后逐字出自主推文本）→ C88 五腿第一腿 `accepted≥0.5 ∨ authorUtterance`；state `super_ip_hit` → `corpus_author_identity`；**不要求 Jev 在实体题里因作者身份升档**（问候语如实 no_entity）。⑤`rideDetourMass` **退役**（新实体门覆盖 B/C 低影响力实体面，W 数学不触达）。⑥审计键 `nameReferent*` → `nameEntityAcceptance*`、`superIpSlogan` → `recognizedEntitySlogan`（含 FA 标签推导/前端展示链）。
- **版本**：`JEV_QUESTIONS_VERSION` J1.55→J1.56→**J1.60**（同批次三连）。
- **后续清理（J1.57-J1.60，同日用户追加裁定）**：
  - **J1.57 三轴归位**（「一个概念只出现一次」）：`name_entity_memeability` 删去 J1.34 越界到实体接受度轴的「影响力和符号性」措辞，只留内容载体与二创潜力（认得≠好玩；认知度归实体题、契合归偏好题）；`web3_user_name_acceptability` 收窄为纯名字形态轴——删「指向圈内符号实体」与「指向无名实体」两分支（前者归 accepted、后者归 unknown→实体门）；`token_circle_reachability` 加划界句。
  - **J1.58 empty_content 判据收窄**（用户裁定「何一发一个问候语，在 BSC meme 币场景不是空洞行为，何况是回复另一个实质性事件」）：无主体无上下文的日常闲聊才是空洞；高影响力主体本人的公开问候/表态/简短回应=事件素材，回复实质性事件的简短回应=对该事件的参与；mapper 配套 `corpusAuthorInRegistry` → empty_content 臂不拦（审计 `emptyContentAuthorOverride`，与 C114 图证豁免同构）。
  - **J1.59 block reason 按对象分类**（用户裁定「block reason 也要划分针对事件还是针对代币」）：`event_block_reason` → `event_token_block_reason`；选项前缀化 `event_empty_content` / `event_institution_routine` / `event_marketing_gimmick` / `event_baseless_speculation` / `event_negative_hard_news` / `event_routine_content_product`（事件层）、`token_ip_reuse` / `token_circle_reachability`（代币层）；判据/阈值/作用域零改动。题面划界：empty_content/institution_routine 与 `web3_user_event_impact` 分工（是否存在事件 vs 事件多大）。
  - **J1.60 priming 修复**：J1.59 分类说明里的类别枚举（空洞/机构日常/营销噱头…）导致 C119 猫案 none 0.58→0.16、marketing 0.26→0.43（mid→low，3 次采样稳定）；删枚举只留「event_*=事件层 / token_*=代币层」短说明后恢复 mid 64.74（判据零改动）。
  - **J1.61 玩味题删除**（用户裁定「name_entity_memeability 合并到 web3_user_name_acceptability 然后删除」）：删除独立 0-5 分玩味题（基础题 15），「内容载体/二创潜力」并入名字门（能接纳新增「所指对象有可玩/可二创内容」臂、不能接纳新增「所指对象没有任何可玩内容」臂；认知度仍归实体题）；**C88 五腿→四腿**（去 mem≥2），名字形态/玩味责任由名字门单点承担；mapper 停止读取该题、新行不再产出 referentMemeabilityScore（历史行保留）。数据依据：39 票中 mem 是唯一区分腿的仅 4 张（币安游戏/日本語版/EARLY/こんにちは），其中 3 张死因本就是名字形态、名字门已管。
  - **J1.65 名字门超IP原话臂**（用户裁定「这个标准就是有问题——在 Web3 用户侧，何一发这一句作为 meme 名字是应该能被认同的」）：`web3_user_name_acceptability` 能接纳新增「高影响力主体本人说出的词句（原话/口令/问候/口头禅，主体有用户侧认知）」；版本/功能标注反锚强化（即便逐字出自超IP原话也不接纳——C105 日本語版）；C126 终态 mid 66.94。
  - **J1.66 手臂边界按用户模拟**（用户裁定「绝不是说什么话都可以——问候/口号/自创口号/简短情绪表达可以；说自己要去滑雪爬山、单纯一句谢谢还是不行；还是站在用户角度」+「尽可能不要加入非常死板的规则，而是始终模拟用户」）：超IP臂判据改为「模拟 Web3 用户会不会把这句原话当符号/梗拿来玩」——不套词表/固定句式；日常陈述、个人行动、礼貌套话按用户反应自然不构成符号。C126 复跑 **mid 67.03**；全量回归 **33 PASS / 0 FAIL / 6 OBSERVE / 0 ERROR**（6 张=既有掷骰面），C105 日本語版维持 low。
  - **J1.67 措辞细化**（用户裁定「BSC 链的用户，或者说 Meme 币的玩家看到这句话」+「何一这句话之所以能过，是因为她对 BSC 链 Meme 币用户的特殊影响力」）：模拟对象收紧为 **BSC 链用户 / Meme 币玩家**；判定锚写明=**该主体在 BSC 链 Meme 币玩家群体里的特殊影响力**（何一/CZ 级：一句话本身在 BSC 圈就是梗/符号）。C126 复跑 **mid 67.24**；全量回归 **33 PASS / 0 FAIL / 6 OBSERVE / 0 ERROR** 不变。
- **测试**：新增 `_test_name_entity_acceptance.cjs`（作者原话检测/第一腿双源/实体门域/empty_content 作者豁免/block 分类/源码口径）；全量零 DB 单测除存量 `_test_backtest_keyset_paging` 外全绿。
- **182 全量回归（39 票，J1.61）**：**33 PASS / 0 FAIL / 6 OBSERVE-DEVIATION / 0 ERROR**（与 J1.60 同形；6 张=既有掷骰面 C100/C72/C79/C80/C82/C113）。J1.61 唯一显著位移：C108 EARLY low→high——mem 腿删除后四腿全中，C88 豁免接管原本的载体门（C108 fixture 的「是否豁载体门」新决策点由本裁定自动落为豁；fixture observe 面内）。J1.56 首轮为 31P/1F/6O（FAIL=C94 拦截位标签变化，已更新）。
- **C126 票终态（J1.65）**：`web3_user_name_entity_acceptance = no_entity 0.99`（中性）+ `authorUtterance=true`；empty_content 已被作者在册豁免（J1.58）；C88 四腿全中（J1.61）；**J1.65 名字门增「高影响力主体本人说出的词句」能接纳臂 → 放行**，事件分 27(B档)+传播 27.04+时效 15 = 69.04 → **mid 66.94**。版本词反锚（日本語版）确保 C105 不被误放。
- **部署**：commit `aa50424`（J1.56）→ `08cf0bd`（J1.57-59）→ `1bff74a`（J1.60 修复）→ `ef4a352`（J1.61）；182 pull + 全量回归；worker/实验进程待重启加载 J1.61。

### C125 prestage_abm_name_link 用户感知锚（P1.13）——按 web3 用户自然联想判名称关联（2026-10-20 用户裁定；批次 3）★

- **案由**：web3 用户视角批次 3（计划批次 3）。`prestage_abm_name_link` 是 prestage 的 abm 条件一，消费位仅 `nameLink !== 'none'` 二值（jev-prestage-mapper.mjs:46），exact/abbreviation/semantic 三档只进 reason label——四档结构全重构性价比极低，**最小改法=只给 none 档与各档 label 加用户感知口径**，行为边界移动属预期。
- **改动（题面文案，四档/choice 键/二值消费全不变）**：①instructions 加「按 web3 用户视角判：只看币名，web3 用户会不会自然联想到该账号/人物」；②exact/abbreviation/semantic 三档 label 加「web3 用户会立即/自然联想到」；③none 档改「web3 用户看到这个币名**不会**自然联想到该账号/人物（名字与账号无关）」。
- **版本**：`JEV_PRESTAGE_QUESTIONS_VERSION` P1.12→P1.13 + changelog；同步更新版本锁（`_test_prestage_project_downgrade` promptType/版本、`_test_prestage_web3ip_account_only`、`_test_unrated_elimination` 的 P1.11 存量陈旧锁顺修）；`case-regression/run.mjs` 题集版本显示改动态（原硬编码 J1.45+P1.12 已陈旧）。
- **测试**：新增 A15a-c（name_link 主轴 web3 用户自然联想 / none 档不会自然联想 / 四档结构键名不变）；prestage 相关单测全绿。
- **182 全量回归（38 票）**：**33 PASS / 0 FAIL / 5 OBSERVE-DEVIATION / 0 ERROR**（4 票已知掷骰面 + C113 掷骰面，与 J1.55 基线一致；prestage 票 C101/C117 等全 PASS）。
- **部署**：commit 2f83a35；182 pull + 全量回归 + worker 重启加载 J1.55+P1.13；**live 实验进程 37b19a9f（v27 both）按用户授权重启**（重启前对账 0 持仓；启动日志确认 live 持仓恢复 0 个、双 collector 订阅、事件循环启动）——J1.52→J1.55 题面与 P1.13 首次进入实盘 in-process 链路。

### C124 name_referent super_ip 圈内符号级锚（J1.55）——「被当符号使用」的证据级，不是听说过/大众量级（2026-10-20 用户裁定）★

- **案由与裁定**：用户原则「一切从 web3 用户视角出发」的延续。`super_ip` 旧定义以「世界级名人/顶级机构/全球性IP/全国级人物或国民级IP」为锚——大众量级即升档，与用户视角冲突。用户裁定（本批计划）：超级IP 的判据应是 **web3 用户普遍认作符号**（被拿名字/形象/绰号玩梗、当标签当口号）的**证据级**，不是「听说过」的知晓级；大众侧量级不要求——大众量级不高但圈内是符号（哭哭奶龙型）照判本档；纯大众知名但圈内不认作符号（圈外明星/传统品牌）不因大众量级升入本档。⚠️ 本题只判身份量级，不评玩味/二创潜力（referent_memeability 另评）——认得≠好玩。
- **改动（题面判据，mapper 零改动）**：①`name_referent.instructions` 主轴改「在 web3 用户（链上 meme 买家）眼中的身份量级，不是事件热度、也不是大众媒体量级」；②`super_ip` 桶主定义切「认作符号/被当符号使用证据级」+ 大众量级不要求 + 圈外知名不升档 + 认得≠好玩；**J1.18 发布者指代分支（独立分支）/三前提/关于自己的原话词/亲口提及实体/官方产出物口号/配图形象指代臂（J1.43）全部保留**；③`other_referent ①` 承接句同步「知名但非符号级——未达『被 web3 用户当符号使用』的证据级（十万粉 KOL/行业知名机构/纯大众知名的圈外明星/传统品牌）」。
- **182 定向对拍（8 票，sip=name_referent.super_ip 概率）**：

  | 票 | sip 前→后 | 评级 前→后 | 备注 |
  |---|---|---|---|
  | PEPE（正向） | 0.75 → **0.97** | high → high（82.21，C88） | 圈内符号升档符合预期 |
  | C109b 暗号資産の覇者 | 0.87 → 0.84 | low → low（常规内容产品宣传） | 稳定 |
  | C83a BI | 0.64 → 0.70 | low → low（营销噱头） | 稳定 |
  | 兔八哥（反向） | 0.89 → **0.35** | mid → mid（69.53） | 大众动画角色降档，符合预期 |
  | 뽀로로（反向） | 0.88 → **0.03** | high → high（77.35，标准数学） | 降档但事件分仍够 |
  | JENSEN（反向） | 0.90 → **0.31** | high → high（77.68） | 降档但标准数学过线 |
  | Elmo（反向） | 0.68 → 0.61 | high → high（73.93，C88） | 仍 ≥0.5，未降穿符号门槛 |
  | C113 哭哭奶龙（计划预期升） | 0.44 → **0.12** | low → low（58.9 事件分不足） | **未达计划预期**：模型判 other_referent 0.76（不认为奶龙是圈内符号） |

  **防通胀专项**：样本 sip≥0.5 占比 **7/8 → 4/8**（PEPE 升、三个大众 IP 降、Elmo 勉强保持、C113 降）——方向=收紧符号面，未出现通胀。
- **偏差诚实记录**：计划预期「C113 型（圈内符号但大众量级不高）应升 sip→C88 五腿可达」**未成立**——Jev 对哭哭奶龙的判断是「非圈内符号」（other_referent 0.76）。该票的评级未变（事件分 58.9<60 回拦，原 J1.54 亦同）；是否要为「圈内二创/错版变体形象」补显式符号证据句，留待用户裁定（本批不擅自扩判据）。
- **测试**：8 处版本锁 J1.55；consolidation 新增 A14a-e（主轴/符号证据级/保留分支/other 承接句/配图臂）；24 个 mapper 相关单测全绿。
- **182 全量回归（38 票）**：**33 PASS / 0 FAIL / 5 OBSERVE-DEVIATION / 0 ERROR**（4 票已知掷骰面 + C113 本轮落事件分不足 observe 臂；C100 本轮 translation 臂通过）。
- **部署**：commit 24982b4；182 pull + 全量回归 + worker 重启加载 J1.55；live 实验进程仍持旧题面（in-process 模块缓存）待持仓确认后重启。

### C123 门名/题键语义化（J1.54）——event_magnitude→web3_user_impact、dimension2→web3_user_spread + 门函数/审计键改名（2026-10-20 用户指令）★

- **用户指令**：「其它门的名字也请梳理下，以类似思路，做一下调整」——沿用 C122（J1.53）思路：门名必须表达现行语义（尤其 web3 用户视角），名不副实者统一改名，判据零改动。
- **全量盘点（题键 16+4）**：只发现两个题键名与现行语义错位——①`event_magnitude`（J1.50/J1.51 起主轴已是「Web3 用户对事件的接纳与被影响程度」，键名仍停在客观量级）→ **`web3_user_impact`**；②`dimension2`（无语义占位名；J1.23/J1.45/J1.50/J1.51 后语义=用户侧传播面/调动面）→ **`web3_user_spread`**。其余 14 题键名与判据一致（relevance_type/brand_hijack/w_product_score/referent_memeability 的名字指代所评对象、评估镜头已在题面锚定，不改；prestage `abm` 前缀作用域已扩到 tweet 回落，属文档说明不改）。
- **门函数/常量改名**：`notMemeNameBlock`→`web3UserAcceptabilityBlock`、`nameFormChoice`→`web3UserAcceptabilityChoice`、`NOT_MEME_NAME_CHOICES`→`WEB3_USER_NOT_ACCEPTABLE_CHOICES`、`web3FitBlock`→`web3UnfitBlock`（实为 P(unfit) 负门）、`rideDetourBelow`→`rideDetourMass`（返回 mass 非 below）、`RESONANCE_FIT_*`→`WEB3_FIT_DAMP_*`（event_resonance 题 J1.36 已删，现语义=E 类 web3_fit 折损）、`DIM2_BANDS`→`SPREAD_BANDS`、`magnitudeTier()`→`impactTierOf()`；名字门审计对象 `{form:choice}`→`{choice}`。
- **P1 审计键语义修正（用户裁定纳入）**：`magnitudeTier`→`jevImpactTier`（Jev 原判档）+ 新增 `effectiveImpactTier`（锚后档）；`timing`→`effectiveTiming`（override 后生效；原判在 `*Override.rawTiming`）；`tierAnchored`→`anchoredTier`、`web3FitAnchored`→`web3FitAnchoredTier`（值本就是档位字符串非布尔）；`web3FitStrongP`→`web3FitStrongPAnchored`（仅锚定命中时落）；`blockProbability`→`blockChoiceProbability`（所选 choice 的概率，非拦截概率）；`web3FitMass`→`web3UnfitMass`（实为 P(unfit)，与正向 fitMass 同名不同义）；`resonanceFitMass/resonanceDamp`→`web3FitDampMass/web3FitDamp`；`instagramDim2Anchor`→`instagramSpreadAnchor`、`web3FitDim2Anchor`→`web3FitSpreadAnchor`；`scoringResult.dimension2`→`scoringResult.spreadScore`；`jevDetails.{tier,timing,dim2}`→`{impactTier,effectiveTiming,spread}`。
- **label**：`ip_reuse`「IP二次利用」→「IP低质复用」（题面判据只拦纯蹭名/无意义修改，旧 label 过宽）；reason 段「感染力折损」→「Web3偏好折损」（判据源 J1.36 起已是 web3_fit）。
- **兼容策略**：mapper answers 双键读（`web3_user_impact ?? event_magnitude`、`web3_user_spread ?? dimension2`）——生产工具 `scan-c88-flip-surface.cjs` 读历史行 `stage1_raw_output.answers` 重放仍可 map；概率键输出新名；审计键只写新名，前端 `experiment_narrative.js` 新键优先+旧键回退（历史行可读）；`jev_dryrun`/`jev_calibration` 双读。无 DB DDL（全部 JSONB/text）、无 config 改动、fixtures expect 数组无候选键。
- **测试**：24 个 mapper 相关单测全绿；consolidation 新增 A13a-j（新键在场旧键缺席 / 题面跨题引用同步 / 旧形状与新形状 answers 结果逐位等价 / 审计键新名落旧名缺席 / `anchoredTier` 值形态 / 概率与 scoringResult 键 / `web3UnfitMass` / E 类 `web3FitDamp` / B 类 `web3FitSpreadAnchor` / 源码门函数改名）；8 处版本锁 J1.54；顺修两处存量陈旧断言（`_test_narrator_two_shapes` C4 措辞随 J1.45 重写失效、`_test_case_regression_lib` F2 票数 37→38 补 C121）。
- **182 全量回归（38 票）**：首轮 33 PASS/1 FAIL/4 OBSERVE——C113 哭哭奶龙事件分 58.2-59.5 卡 60 线（原 note 已声明「事件分不足回拦不算翻案失败」，补 observe）；次轮 32 PASS/1 FAIL/5 OBSERVE——C100 rebondit `parent_relationship` 掷骰逃逸（unclear 0.32 vs translation 0.27，4 次采样 3 次 translation 拦截 46.1-46.3 / 1 次 unclear 放行 72.7，补 observe，`staleRelParentOverride` 核心断言保留）；最终轮 **32 PASS / 0 FAIL / 6 OBSERVE-DEVIATION / 0 ERROR**（4 票已知掷骰面 + C100/C113 两张新增 observe 票本轮均落偏差臂）。**方法论留档**：Jev 单次 fan-out 改题键/题面可微移条件题答案分布（C100 的 parent_relationship、C113 的 spread 带），边缘票以 observe 追踪不阻塞；改题后全量回归必须覆盖非目标题。
- **部署**：commit `8d63253`（代码+测试）+ `4ced895`/`4a8b68b`（C113/C100 observe）；182 pull + 全量回归 + worker 重启加载 J1.54。live 实验进程仍持旧题面（in-process 模块缓存），按持仓确认规程待重启。

### C122 门名断代（J1.53）——name_form→web3_user_acceptability / niche_subculture→web3_circle_reachability（niche 是否合并进接纳度的数据裁定）（2026-10-20 用户问询）★

- **用户问询**：「niche_subculture 是否应该合并到 Web3 用户接纳度上？」（背景：J1.52 把 niche 判据切到「web3 用户接不接得住」，与 J1.50 的 name_form「web3 用户能否接纳这个名字」字面同轴）。
- **数据裁定（不合并）**：
  1. **判的不是同一对象**：name_form=名字作为 meme 符号的**形态**可否被接纳（实体有名/无名、圈内词、陈述句、版本词、拼写变体；全域门、choice、无概率质量）；niche=名字/形象所指文化的**圈层可达性**（圈外黑话 get 不到；block_reason 桶、**只拦 A 类**）。
  2. **实测不冗余**：niche 35 票中有 name_form 答案的 21 票——**11 票名字门本来就拦**（重合面）、**10 票名字门判合格**（niche 是唯一拦截位）。合并进 name_form 而不加新分支=放行这 10 票；加新分支=把 A 域拦截扩到全类别。
  3. **机制合并的真实代价**：niche 的 A-only 域只能靠「block_reason 独立桶 + BLOCK_SCOPE 按类别过滤」实现（name_form 是全域门，无类别域）；历史 niche choice 的非 A 空洞 76 行（C28/E28/W12/F5/G2/D1）合并后会开始被拦——这是拦截面扩大决策，不是零成本重构。
  4. **J1.52 后 niche 没死**：35 票中 27 票送重析、23 票成功——**5 票仍 niche argmax（全 pixelcats/像素猫系，P 0.46-0.53）**；其余 18 票全部被后腿门接住（名字门 5/营销噱头 6/事件分 3/W 1/ip_reuse 1/时效 2）。释放样本：SAND → mid、潘多拉佩吉 0x926bb6c24f4ecb766ae7b98ee0ca96ef1a0a7777 → high 73.51（C88 五腿豁免；语料薄：806 粉、正文「CHINESE」+链接）——两票放行质量待用户后续裁定。
- **用户裁定**：「可以分开，不过建议 name_form/niche_subculture 等门的名字都改一下，现在表达的含义是『Web3 用户接纳度』/『Web3 用户圈层可达性』」。
- **实施（J1.53，零行为意图的键名断代）**：
  1. 题键 `name_form` → **`web3_user_acceptability`**（题面/三态键/判据零改动）；桶键 `niche_subculture` → **`web3_circle_reachability`**（J1.52 判据零改动）。
  2. mapper `nameFormChoice()` 双键读（新键优先、旧键=存量缓存行/旧 fixture 兼容——断代 bit 兼容红线，同 NOT_MEME_NAME_CHOICES 先例）；审计键 `nameForm`/`nameFormBlock` → `web3UserAcceptability`/`web3UserAcceptabilityBlock`；`probabilities.name_form` → `probabilities.web3_user_acceptability`。
  3. `BLOCK_SCOPE`/`BLOCK_LABELS` 新旧双键并存（旧键 scope ['A'] 保留=存量行/旧 fixture 语义不变）；label：名字门 → 「Web3 用户不接纳该名字（用户接纳度门）」、圈层桶 → 「Web3 用户圈层可达性不足」（旧 label '小圈子亚文化' 保留给旧键）。
  4. 回归票期望同步（意图不变、文案更新）：C94 京小安 / C96 币安上电视 reasonIncludes、C108 EARLY / C119 猫 reasonExcludes 由「币名不适合作为 meme 符号」换新 label。
- **测试**：7 处版本锁 J1.53 全绿；consolidation 新增 A12a-g（题集新键在场/旧键缺席；双键读行为等价=新键拦且旧键同门；新桶 A 域拦/B 域不拦；审计键改名）；17 个涉及 name_form/niche_subculture 的测试全部通过（旧形状输入=断代兼容的正证）。
- **验证与部署**：182 全量回归（38 票）**33 PASS / 0 FAIL / 4 OBSERVE-DEVIATION / 1 无断言 PASS（C121）**；worker 重启加载 J1.53。

### C121 web3 用户视角批次一（J1.52）——w_product_score 用户兴奋度锚 + niche_subculture 认知可达性锚（2026-10-20 用户裁定；五批次之 1）★

- **案由**：用户「再次分析一下，还有哪些维度，应该切换为 web3 用户视角，我认为只有切换 web3 用户视角，从用户需求角度出发，而不是硬性匹配，效果才能好」。J1.50/J1.51（C119 猫案四题）之后全体系盘点（16 基础题+4 条件题+prestage 3 题+mapper 代码侧锚+precheck 硬窗）。用户裁定：**Tier1 全切**（niche_subculture / w_product_score / name_referent）+ **Tier2 全纳入**（prestage_abm_name_link / institution_routine 桶族 / precheck 硬数字门），分五批串行——本批=批次 1（两项正交一版）；name_referent=批次 2 单独成版保归因（翻转全部可归本版）。
- **不切维度留档（防重复盘点）**：event_timing（时效是客观属性）/ finding_vs_recap / parent_relationship / subject_entity / name_image_consistency / image_depicts_name / brand_hijack（事实轴=反洗白防线）/ token_quality（拼写可读性≈用户可读性，边际低）/ w_binance_interaction（客观 fact-check，伪装用户镜头会放松它）/ prestage_abm_web3_traffic（反自封证据轴刻意客观）/ event_category（分类学路由）/ empty_content、baseless_speculation（内容存在性/证据轴）；mapper 代码侧数学（MAGNITUDE_TIER_SCORES / 60 线 / J1.23、C94、C97 锚）不动——「分数锚定必须代码侧」设计原则，J1.50「三维参考非定死」已在题面锚体现。
- **改动 1（w_product_score）**：主轴切「web3 用户（链上 meme 买家）对这个发布的关注与兴奋度」——会不会被当话题讨论/转发玩梗/产生 FOMO；产品客观重要程度（创新性/功能量级/发布方规格）降为参考锚、非定死映射（客观创新高但链上无感不升带；轻量但有梗按用户兴奋度评带）；**显式否定实测读法**（「评的是预期兴奋度，不是发布后实测数据」——J1.51 教训：用户侧认知面轴必须显式否定「实际被调动/多少人注意到」类措辞，否则 Jev 读成观测数据）；四带形态结构词（版本更新/新功能/新产品/创新产品）**刻意保留**——C42 豁免 `wNewProductP = 1−P(0)−P(1)` 依赖「0/1 带=小改进、2/3 带=产品发布」带结构。mapper 零改动。
- **改动 2（niche_subculture）**：判据从「圈外人无法理解/无出圈可能」（大众出圈视角，与用户视角原则相反）切「web3 用户接不接得住」（认知可达性）：圈外亚文化=名字/形象源自与 crypto 圈不重叠的垂直领域黑话/圈子内部梗/地域性社群文化，web3 meme 买家 get 不到；**crypto 圈内梗/黑话≠小圈子**（对 web3 用户=原生强契合，PEPE/doge/币圈自嘲梗型形象不选本项）；与 web3_fit 分工：本题问 get 得到/get 不到，web3_fit 问想要/不想要（两种失败不同）。**前置扫描（182，31388 行全表）**：niche argmax 35 行全 `event:A` **活桶**（非死桶）→ 改锚不退役；`BLOCK_SCOPE.niche_subculture` 维持 `['A']`（改锚不改域）。
- **批内修正（C110 币安菠萝 0x8ce87ffebe62e6f7ea87173b441520f659307777 归因）**：全量回归首轮 32 PASS/1 FAIL——C110（J1.45 marketing_gimmick 扩全域的**设计票**：D 档空洞营销票，扩域前逃逸实买）low→high 75.16。同票重复跑（stateChars 1274 恒定）A/B 隔离：

  | 题面组合 | 次数 | gimmick 拦截 |
  |---|---|---|
  | 旧/旧（J1.51 全套） | 6 | 6/6 |
  | 混合 A（新 niche + 旧 w_product_score） | 18 | 13/18 |
  | 混合 B（旧 niche + 新 w_product_score） | 18 | 18/18 |
  | 新/新（J1.52 修前） | 15 | 7/15 |

  元凶=niche 措辞泄漏：「crypto 圈内梗=原生强契合」被推广成「带币安/crypto 品牌=圈内契合」，block_reason argmax 从 marketing_gimmick 漂到 none（gimmick P 0.30-0.34 掷骰边缘）。**修**=niche 加品牌营销边界：「圈内梗只指社区自发形成的文化梗；交易所/项目方的品牌营销物料、官方周边、活动噱头不是社区梗——名字带币安/crypto 品牌不等于圈内契合，无实质产品/事件内容的仍归营销噱头」。修后 C110 **12/12 拦**。
- **定向重析（182）**：20 票送重析、15 票成功（5 票「代币不存在」=老票已清）。niche 组 8 票修正后**全部维持 low 且拦截位归位**（名字门 5 / 营销噱头 1 / W 线 1 / 时效 1）——改锚后 A 域拦截由名字门等后腿接管，无意外放行。W 组近线同票对拍 6 票：**产品分 +1.7~+3.2**（新锚微升非塌档；4 张 60-61 线通过票维持 high、PHANTOM 55.33→58.99 仍拦、无 high→low）；RedCoin（C42 原型票，10-02 老行 79.05 high）重析 low 39.53——归因=w_binance_interaction 19.05→0.09（本题未改，跨版本语料漂移，非 J1.52 效应）。牛来（0x3618d1227425548a51209d591dfc11b41a717777，币安 Discord 社区梗）旧行 niche 拦 → 现达标准路径（终态=名字门掷骰面 acceptable 0.49-0.50 vs not_acceptable 0.48-0.59，15 次 low 7/high 8）——收录 C121 回归票（`rating: null` + observe 说明，链路可达即正确）。
- **验证**：本地 7 处版本锁单测 J1.52 全绿 + consolidation A11a/A11b/A11c/A11c2/A11d（niche 锚句+品牌营销边界+C42 形态词保形+BLOCK_SCOPE 域）；182 全量回归 **33 PASS / 0 FAIL / 4 OBSERVE-DEVIATION / 0 ERROR**（4 票=C72/C79/C80/C82 已知掷骰面，与 J1.51 基线一致）；对拍存档 `data/case-regression-result-2026-10-20T03-39-17-776Z`（修前 32/1/4）+ `03-47-18-075Z`（修后 33/0/4）+ `03-49-54-617Z`（C121 收录）。
- **方法论留档**：①「设计票在措辞改动后掷骰边缘漂移」——单次对拍只能发现翻转，**A/B 隔离（只换一处题面重复跑同票）**才能定位措辞泄漏源；②跨题面组合效应真实存在：新旧混合臂（13/18）≠ 单变量纯效应，联合调用下两处措辞可相互放大；③Jev 单次 fan-out 调用内改任一题面都可能移动其它题的 argmax——改题后对拍必须覆盖「非目标题」的既有拦截票。

### C120 interpretive_reply 桶巨粉豁免——C74 时效硬拦的作者量级旁路（2026-10-19 f8ab/Burn N Burn 案二轮）★

- **现场**（C117 后续）：C117 双门修好路由后 f8ab
  `0xf8abd6a6bdc0d87291b4f79abc6188c48a807777` 定向重析确认走标准路径（无
  prestage 轨迹），但被 **C74 时效桶**拦——`classifyTweetType` 优先级 1 判
  `interpretive_reply`（回复 cz_binance registry 命中；**作者量级在 classifier
  不可见**，389 万粉官推与小号同桶）→ 非豁免桶主推 lag 23min ≥300s →
  `expired_tweet` 硬拦 low（score 20），Jev 没见到票。原始分析未被拦的原因=
  GMGN 未索引→created_at 缺失→时效规则跳过（两腿各归各位，C117/C120 正交）。
- **用户交互**：「300 秒改为半小时是不是就可以了？」——存量扫描否决全局放宽：
  417 票 expired_tweet 拦截面（10-16~10-19，批 50 查 wss_events token_create
  锚补 lag），5-30min 窗 191 票中 angle_seeking 125 / unknown 37 /
  interpretive_reply 29——全局放宽=放行 ~64 票/天且主力是小号找角度票。f8ab
  的特质是**作者量级**非 lag → 方案 B（interpretive_reply 巨粉豁免）→「好，B」。
- **实现**（pre-check 规则 2.1 消费侧豁免枝，桶分类零改动不 bump 版本）：
  `type=interpretive_reply ∧ author_followers_count ≥ THRESHOLDS.HIGH_FOLLOWERS
  (5000) ∧ 主推 lag ≤ 24h` → 跳过 `expired_tweet` 硬拦交 Jev event_timing
  软评。设计要点：①**THRESHOLDS 从 classifier export**（`tweet-type-classifier.mjs`
  单一真相源，direct_tweet 桶与豁免门同一把「高影响力」尺跟动）；②24h 上界
  复用 `DIRECT_TWEET_STALE_SEC` 常量（C104 设计语言：豁免非无界，陈旧回流不烧
  Jev 配额）；③粉丝缺失 fail-保守不豁免（C86 followers null≠0 同教训）；④主推
  created_at 缺失 fail-open 豁免（对齐 C104 K7）；⑤**桶分类刻意不动**——
  jev-state-builder 同消费 classifyTweetType 做 Jev prompt 路由，改桶=动题集
  路由，豁免只能在 precheck 消费侧；⑥angle_seeking/unknown 刻意不豁（125+37
  主力票型是小号找角度，豁免面缩一个数量级）；⑦独立成枝不与 C104 主从门
  纠缠（无载体臂——巨粉回复票源头即主推本体，>24h 直接回落拦，救援臂等真案再扩）。
- **验证**：单测 `_test_precheck_tweet_freshness_bucket.cjs` L 节 13 断言
  （f8ab 现场反证 389 万粉 lag 23min 放 / 1500 粉同形状拦 / 4999-5000 边界 /
  粉丝缺失照拦 / 24h 恰界放+1s 拦 / created_at 缺失 fail-open / 名单巨粉 50 万
  angle_seeking 照拦 / 桶分类不动锁 / INTERPRETIVE_EXEMPT_STALE_SEC+
  THRESHOLDS.HIGH_FOLLOWERS+export 三源码口径锁），全量 78/78。
- **部署与终局（2026-10-19）**：代码随 ed834b2 上 182（worker 3528617 加载）。
  f8ab 定向重析行为级验证=三级拦截面接力确认——C74 放行（不再 expired_tweet）
  → Jev 标准路径真实评价 → 终态 **J1.29 载体门拦**（「叙事主体无形象载体（无
  形象实体）」P=0.41，C 类事件票）：rating 维持 low 但考官归位，tokenCategory
  `account_based_meme → event:C`（prestage 旧分类翻标准路径分类）。回归票
  `--update-expect C117` 留痕后全量对拍 37 票 **33 PASS / 0 FAIL / 4
  OBSERVE-DEVIATION / 0 ERROR**（4 票=已知掷骰偏差，无新增）。BNB 销毁类
  机构事件票在现行题集下的真实评价即载体门拦——是否救援属新案，未擅自扩。
- **台账事故顺修**：C118/C119 并行会话写台账时基于旧版覆盖，C117 条目标题行
  被碰掉（正文完好）——本次从 9e18ff5 恢复标题；跨会话动台账前先 grep 锚点。

### C119 用户视角三题统一 + name_form 键名断代——「一切从用户角度出发」（2026-10-19 猫案三轮）★

- **现场**：`0x21573053e3ecda168007315f9153be78afa17777`（「只是一只猫」，C116 案
  三轮）。C116 名字门修掉后重析：nameForm 翻 meme_name，但**量级门拦**——
  stage2Total 59.72<60（事件分 22·C 档+传播面 22.72+时效 15）。归因：猫梗事件
  对 web3 用户接纳度高，但 event_magnitude/dimension2 按客观规模带（主体量级/
  粉丝/传播数据）判档，社区级传播的猫梗被压在 C 档——「客观传播数据小」≠
  「web3 用户无感」。
- **用户裁定**（成体系，非单点）：「nameForm 改成『web3 用户能否接纳作为 meme
  名字』，事件与名字的关联改为『web3 用户能否理解并接纳这种关联』，一切从
  用户角度出发」；事件分「也改成『Web3用户对事件的接纳与被影响程度』，三个
  维度作为参考吧，不是定死的」——三个维度=**既有公式三项**（事件分/传播面/
  时效），从定死映射降为参考锚。键名「我的建议是 web3_user_acceptable」→
  三态 `web3_user_acceptable / web3_user_not_acceptable / unclear`。
- **实现**（J1.50 题集 bump，题数不变 16/条件 17）：
  ①**name_form 问法收敛+键名断代**：问法改「web3 用户能否接纳这个名字作为
  meme 币的名字——能否接纳是唯一问法与唯一判据」；三态键改名，对照锚措辞
  合格/不合格→能接纳/不能接纳。mapper `NOT_MEME_NAME_CHOICES` 收新拦键
  `web3_user_not_acceptable` + 全旧键（not_meme_name/statement/
  functional_label 存量缓存行照拦，C107 断代 bit 兼容先例）；正臂结构不变
  ——Set 外即放行（web3_user_acceptable/meme_name/entity_phrase/unclear/
  缺失 fail-open），无需枚举。
  ②**relevance_type 主轴换用户理解度**（Stage3 关联分，不进 Stage2 60 分线）：
  「web3 用户能否理解并接纳这种关联」——各档=「关联方式×用户理解度」刻画，
  非客观语言学自足分类；用户 get 不到的关联不因论证成立而升档。
  ③**event_magnitude 判定主轴**改「Web3 用户对事件的接纳与被影响程度」+
  **dimension2 同主轴**「实际被调动起来的传播面」：客观规模维度（主体量级/
  粉丝/传播数据/关联形状）降为参考锚与证据来源；**Web3 meme 原生母题**
  （猫狗/动物梗、doge 系、圈内梗、AI 极客梗、可爱萌系；J1.23 圈内偏好同款）
  按用户侧实际被影响程度**升档**，圈外传统热点不因规模大而升档。**聚合/
  阈值/截断全在代码侧不动**（MAGNITUDE_TIER_SCORES/60 分线照旧——只有判档
  判据换轴，分数锚定不变，C108「题面改锚分不动」纪律反向适用：改的是档位
  判据非分数映射）。
- **验证**：`_test_jev_finding_recap_statement_gate` 104 断言全绿（新增 C0 新键
  真值表臂：web3_user_not_acceptable 同门同 label+stage1 nameForm 透传+
  nameFormBlock form 落新键；passArms 增 web3_user_acceptable 臂）；7 文件
  版本锁 J1.49→J1.50；**存量漏 bump 顺手修复**：consolidation 测试 J1.47
  （J1.48/J1.49 两轮漏）+ case_regression_lib F2 票数 34→36（C114/C117 两批
  收录漏）。邻接 6 叙事测试全绿（subject_carrier/product_entity/
  referent_memeability/notable_other_exit/narrative_trigger_condition/
  case_regression_lib）。
- **断代语义**：存量缓存行不重放 mapper，行为 bit 不变；重析票按新键新判据
  出档。182 部署+猫票定向重析（关注 stage2Total 是否过 60——名字门已过，
  卡点纯在事件档）+回归票收录+全量对拍待办。
- **J1.50 初版实测与 J1.51 批内修正（同日）**：J1.50 上 182 后猫票定向重析
  =名字门新键 conf 1.0 干净放行 ✓，但事件轴 55<60 仍拦；**全量对拍暴露
  C113 哭哭奶龙回归（baseline high 70.2 → low 55.2）**——档位稳 B(27) 但
  dim2 28.2→13.2 塌档（probs 落 0-1 带 0.72）。归因=J1.50 dimension2 开头
  「实际被调动起来的传播面/多少人注意到/讨论」把镜头导向**语料实测互动**
  （138 粉载体推文→低带），与 J1.46「载体数据不参与判分、按 IP 认知面」锚
  直接打架；猫票同向（dim2 22.72→18），event_magnitude 两票档位未动
  （22/27 原样，未误伤）。**J1.51 修正**：dim2 开头改「评用户侧调动面本身
  （母题/IP 的圈内认知面与传染力），不是语料推文账号的实测互动量——小号
  载体≠小事件」，修正锚进题面（内嵌 J1.51 修正说明）+consolidation 测试
  A10b-J51 事故现场反证锁定（含 !includes('实际被调动起来的传播面') 反证）。
  教训：**「实际/多少人注意到」类措辞在 dim2 上天然读作实测互动——用户
  侧认知面轴必须显式否定实测互动读法**（J1.46 锚已验证过的坑，J1.50 重踩）。

### C118 载体豁免认演绎关系——image_depicts_name 条件题（2026-10-19 DND 案二轮）★

- **现场**：`0x4dbcb10e68626b6f663bd596905d41cdc6b07777`（DND，BinancePk 80 万粉
  「DND 😾」+猫拉窗帘视频，C114 案同票二轮）。C114 修掉 empty_content 误拦后
  重析落**载体门拦死**：subject_carrier no_visual 0.40-0.51 掷骰（Jev 判 DND
  概念无形象载体），C109 图证豁免不触发——name_image_consistency `unrelated`
  0.85（DND 是概念、猫是实体，字面不同实体）。名字维度已过（J1.47 轮
  meme_name conf 1）。用户买家视角问「web3 用户会接受 DND 在这个场景作为
  meme 币名字嘛」→ 会（缩写是 crypto meme 命名主流）→ 卡点定位=载体豁免只认
  名实同一/同类、不认演绎。
- **用户裁定**：「载体豁免认演绎关系，立 case 修」——「猫拉窗帘视频=do not
  disturb 的画面演绎」本身就是载体存在的事实证据，与名实同类（C109 交易猫）
  平行。表述纪律同 C112/C117：借叙事发币是常态，评估轴从来不是「蹭」。
- **实现**（J1.49 题集 bump，新条件题零污染）：
  ①**新条件题 `image_depicts_name`**（与 name_image_consistency 同
  imageConsistency 携带条件，仅语料含图证时问）：三档 depicts_name /
  decorative / unclear。**与 10.7 正交分工**——10.7 问名与图【所指实体】
  同一/同类（J1.30 消费），本题问图是否在【演绎名字含义】（J1.29 演绎臂
  消费）；概念名（缩写/口号）无实体对应 10.7 天然 unrelated，演绎证据由
  本题独立承接，两题答案可同票共存（unrelated+depicts_name）。对照锚：
  DND+猫拉窗帘=depicts_name / CRO+猫图=decorative（纯装饰）/ 香蕉+真香蕉=
  decorative（实体本身无「演绎」）。三方案取舍：扩 unrelated 判据（A）与
  10.7 加第四选（B）都会污染 J1.30 豁免面（nicMatchP 被动变化），选新题
  （C2）判据源分离。
  ②**mapper 演绎臂**：`imgCarrierOverride = imageEvidence ∧ (nicMatchP≥0.5 ∨
  depictP≥0.5)`——depictP=answers.image_depicts_name.depicts_name 概率，缺失
  回落 0 只剩 nicMatch 臂（旧缓存行/未问零影响 fail-safe）。**J1.30
  imgNameExempt 刻意不消费本题**（演绎≠名实一致，两豁免面不互扩，单测
  D1/D2 行为级锁定：演绎臂触发不豁 Stage3 关联截断、match 臂触发照常豁免）。
  ③**审计键双段**：stage2 段（拦截票唯一落库位——DND 形状=演绎臂救回载体门
  后 fallthrough 量级门拦，stage3 段被 __clear，stage2 补 `subjectCarrierImgOverride`
  同形键才能归因「载体门为何没拦」）+ Stage3 段原 C109 键扩 `via:
  'match'|'depicts'` 臂来源 + `depictP`。
- **验证**：单测 `_test_image_depicts_exempt.cjs` 22 断言全绿——DND 现场反证
  （演绎臂翻过载体门→D 档量级门拦=理由干净）/ 0.5 阈界 / 答案缺失 fail-safe /
  J1.30 零污染行为级（A 档票 Stage3 截断位）/ not_meme_name 门链接管（CRO+
  演绎图形状名字门照拦）/ decorative 不豁 / C109 原臂回归（交易猫 nicMatch
  臂 via=match）/ 源码口径+J1.49 版本锁。邻接版本锁 5 文件同步 J1.48→J1.49
  （empty_content/finding_recap/resonance/name_image/superip_standard_path，
  顺手实证 finding_recap 102 断言全绿含 C116 题面锚）。本地 fdbf352 已 push，
  182 pull+单测 6/6，worker 重启至 J1.49 生效。
- **DND 定向重析结果（演绎臂不触发=证据源问题，非机制问题）**：终态 low
  PASS（C114 回归票 expect 无漂移），reason 仍「叙事主体无形象载体｜P=0.35」；
  答案层 `image_depicts_name: decorative 0.82 / depicts_name 0.17`、审计键
  正确未落（臂未触发）。逐层取证定位根因：**vision 图证（Qwen3-Omni img-v3，
  只抓视频封面静态帧）描述=「暗楼群一亮窗、白猫站立窗边凝视」「对比图/
  different=cool/脱颖而出做自己」，完全不含「拉窗帘=别打扰」动作语义**——
  Jev 基于所见证据判 decorative 0.82 是诚实判断，C118 题面/mapper/审计全部
  按设计工作，fail-safe 方向正确（证据不足不豁免）。结构性缺口=**视频票的
  vision 证据只取封面帧**，演绎动作发生在视频内容里、封面帧拍不到——是否
  要视频抽帧/多帧证据属范围外新题，待用户裁定，未擅自扩。
- **全量对拍（J1.49，35+1 票）**：32 PASS / 0 FAIL / 4 OBSERVE-DEVIATION
  （C72/C79/C80/C82 已知掷骰偏差票，评级方向无翻转；C115/C116/C117 并行
  票同批 PASS）。

### C117 超大账号不走 prestage 账号判定——superIP 命中强制标准路径 + 发行方自发宣告粉丝门（2026-10-19 f8ab/Burn N Burn 案）★

- **现场**：`0xf8abd6a6bdc0d87291b4f79abc6188c48a807777`（Burn N Burn /
  `BNB͏`带零宽修饰符，flap 税币，34 分钟毕业 16 BNB，同名簇 4 枚）。语料=
  BNB Chain 官推（@BNBCHAIN 389 万粉）回复 CZ（父推「Which other blockchain
  burns $1.1 billion worth of tokens each quarter?」= BNB 季度销毁话题）的
  「@cz_binance Burn N Burn 🔥」。叙事现状：`detectSuperIP` 已命中 BNB Chain
  （tier S institution），但 `detectIssuerSelfLaunch` 独立判定不看 superIP——
  品牌同一性（norm(`bnb`)⊂norm(`bnbchain`) 互包含）+ 宣告指纹（币名 Burn N Burn
  全串出现在官推文本——官推在谈 BNB 销毁，非宣告发 meme 币）双机械命中 →
  `issuerDetected` → 劫进 prestage abm 考官 → 用 original_author=cz_binance 判
  「30 天 Web3 流量事件 no_traffic(0.75)」→ rating=1(low) 拦截。C83 既定语义
  「superIP registry 命中 → 标准路径 + state 注入认证行」被该门覆盖。
- **用户裁定**：「首先超大账号肯定不适合走账号判断这条路」——prestage abm 的
  考官（账号质量+30 天 Web3 流量轴）为中小 KOL 自发盘设计，对 S/A 级人物与
  机构完全失焦；超大账号语料票的正确考官是标准路径（按事件/梗评估叙事质量
  与传播力，registry 认证行注入 state）。同场裁定（表述纪律）：不说「蹭票」，
  meme 币多数都是借叙事发币，蹭本身从来不是评估轴（C112 ip_reuse 同向）。
- **实现**（双门，纯代码路由，题集零改动不 bump 版本）：
  ①**A 门**（`NarrativeAnalyzer.mjs`）：`shouldUseAccountCommunity` 计算后加
  短路——`superIPInfo` 命中（registry 命中对象非 null）→ 三臂（账号型语料/
  项目币 CA/发行方自发宣告）全短路强制 false，打点「superIP 命中 → 强制标准
  路径（C117）」；`issuerDetected` 变量保留原值（`credibleEventAnchor` 臂
  `superIPInfo || issuerDetected` 不受影响）。
  ②**C 门**（`narrative-utils.mjs detectIssuerSelfLaunch`）：粉丝量级门
  `author_followers_count ≥ 100 万 → return null`（`options.maxFollowers` 可
  覆盖；粉丝缺失 null/undefined fail-open 维持原判定）——兜 registry 漏网的
  超大号；自发宣告的合理域是中小账号。
- **验证**：单测 `_test_superip_no_prestate_route.cjs` 14 断言全绿——f8ab 现场
  反证（389 万粉官推双门拦截）+ 粉丝 999,999/恰 100 万边界 + 缺失 fail-open +
  maxFollowers 覆盖 + 截词借势盘反例保护（CONVICTION 不受门影响）+ A 门
  analyzer 短路源码口径断言（短路行存在/位于 prestage 调用前/回写 false，
  事故反证锁定）；相邻域回归 `_test_issuer_ca_detection.cjs` 15/15、
  `_test_narrative_middle_parallel.cjs` 22/22。f8ab 定向重析对拍（预期走标准
  路径重评）与回归票收录待 182 部署后执行；与 C112-C116 同批部署。

### C115 纯 website 兜底语料——「如果所有的信息都不能获取，又提供了网站信息，就去获取一下 web 网站信息」（2026-10-19 CZ4 案）★

- **现场**：CZ4 `0xc6fecab1b9bf2c761d754edbe016e186e44d7777`（flap，taxToken）：
  IPFS meta 只填了 `website=https://czfour.com`（twitter/telegram 全空），站是
  做工完整的 CZ「4」梗页（"When bad news hits, CZ replies with one number: 4"，
  1% 税换 BNB/Binance Life/ASTER/GIGGLE 分持仓者，中英双语）；15 分钟毕业
  12.7 BNB。叙事分析现状：URL 分类只有 websites 桶 1 条，`websiteFetch.enabled`
  默认关（2026-10-13 提速裁定「网站内容基本没用到」）→ 整段跳过 → Jev 裸判
  （state 618 字符只有 meta description）掷骰「营销噱头 P=0.55」拦——**票的
  唯一语料源被自己的总开关锁死**，判定理由与语料质量不匹配。
- **用户裁定**：开关关的提速语义只该省「有其它语料在手」的票；全平台语料
  落空而 websites 桶提供了 URL 时，网站内容就是该票唯一可得的语料，必须抓。
- **实现**（`data-fetch-service.mjs`）：①runWebsite 桶体抽 `fetchWebsiteCorpusOnce`
  单点（enabled 路径 bit 不变）；②`Promise.allSettled` 后兜底段：`websiteFetch.enabled
  !== true` ∧ `CORPUS_FALLBACK_INFO_KEYS`（12 个非 website `<x>Info` 键）全
  null（平台无 URL 与抓取失败同形状；**extractedInfo.description/intro 是宣告
  文案不算抓取语料，刻意不在集内**）→ 补抓一次（直抓+r.jina.ai 回退整链照常）；
  `dataFetchResults.website.corpusFallback=true` additive 留痕；失败 fail-closed
  null 与「网站抓取失败」旧形状一致（precheck 规则 4/Jev 消费点零改动）。
  enabled=true 时桶内已抓不重跑（互斥门）；有任一平台语料在手不触发（提速
  收益保留）；websites 桶空/不可抓 URL 不触发（与 C77 搜索兜底域无交集——
  C77 判各桶全空，本案 websites 桶非空本就不在 C77 域内）。
- **附带修复（C86 遗留 bug 复活）**：web-fetcher `_fetchDirect` 的 C86 改动把
  `clearTimeout` 挪进 finally 时 `timeoutId` 声明留在 try 块内——finally 引用
  不到 = **每次直抓成功都在 finally 抛 ReferenceError**（recordDataFetch 落
  success:false error:'timeoutId is not defined'，websiteInfo 恒 null）。10-13
  关总开关后此路成死代码未暴露，C115 复活即炸；声明提 to try 外修复。
- **验证**：单测 `_test_website_fetch_removal.cjs` 重写 B/B'/E 段 27 断言全绿
  （纯 website 票兜底发生/有 twitter 语料零抓取/抓取失败形状仍兜底/桶空与
  不可抓 URL 不兜底/enabled 桶内抓无标记/死站 fail-closed 同形状）；CZ4 定向
  重析：czfour.com 3363 字进 state（618→1634），Jev 从掷骰「营销噱头 P=0.55」
  变为有据打分「W 类 产品14.6+交互2.7+时效0=17.3<60」rating=low（无翻转；
  纯网站语料无社交佐证，W 数学不过线是诚实结论——本轮只修语料可得性，
  不动校准）。182 部署（pull+worker 重启）待办，与 C112/C113/C114 同批。

### C116 name_form 整句情绪姿态分界 + not_meme_name 根本判据——「作为一个 Web3 用户，会接受这个名字吗？」「是会接受呀」「名字也是一样的，用户能不能接纳它作为 meme 币是最根本的」（2026-10-19 猫案）★

- **现场**：「只是一只猫」`0x21573053e3ecda168007315f9153be78afa17777`（flap 非 BNB
  计价盘，10-19 12:29 UTC，毕业 12:49）：主推=「NVIDIA 新模型痴迷猫 memecoin」
  （meta 链 Nemotron-SFT 数据集 viewer 页），Jev 全维度放行（timing within_7d/
  direct_tweet 豁免桶/block none 0.54/ip_reuse 仅 0.09/E 类 0.52/magnitude C/
  web3_fit strong 0.96），唯 nameForm=not_meme_name 硬拦 rating=1——「只是一只
  猫」整句形态被归入「句片段」不合格臂（C108 J1.42）。C84 链路全程正常：触发门
  过 → round 1 4.3s 完成 → rating=1 → 非账号型语料不补轮 → 买条件 rating==2|3
  恒 false 无 signal 行。
- **用户裁定两条**（名字门第 5 张样本裁定，前 4 张掷骰偏差基线仍挂起待裁）：
  ①「作为一个 Web3 用户，会接受这个名字吗？——**是会接受呀**」：「只是一只猫」
  是自嘲/降格姿态句（just a chill guy 同款句式，just a cat），非「滑雪/我要去」
  类无感知句片段；对 NVIDIA 猫经济宏大叙事的刻意降格反差本身就是梗；名字与热点
  主体（The Meme Cat）不同名属 brand_hijack/ip_reuse 轴（该轴未成立 0.09），名字
  门不替它背锅。②**not_meme_name 同样立 web3 用户视角**（与事件侧 web3_fit 用户
  视角同构）：「用户能不能接纳它作为 meme 币是最根本的」——形态列举只是佐证，
  不是答案。
- **口径（题集 J1.48 纯措辞，mapper 零改动）**：①合格分支②扩「有 meme 情绪姿态
  的整句/短语」臂（自嘲/躺平/降格反差/宣言句式，「只是一只猫」=just a chill guy
  同款自嘲降格句式——句子本身携带可传播姿态、用户接得住当符号）；②不合格分支
  「句片段」臂加「无情绪姿态」限定（「滑雪/我要去」=纯生活陈述，无自嘲/宣言/
  玩梗姿态）；③对照锚加整句对（「只是一只猫」合格/「我要去滑雪」不合格），
  句子分界=**有无 meme 情绪姿态**，非是否整句、非句子长短（总则仍是用户侧感知）；
  ④not_meme_name criteria 立根本判据=web3 用户不接纳它作为 meme 币的名字，典型
  形态降为佐证列举。Choice 题纯措辞翻 argmax（C114 J1.47 同款先例；C108「题面
  改锚分不动」教训只约束分数锚定题，不适用本题）。
- **单测**：无新增（纯题面措辞、无 mapper/逻辑改动，同 J1.46 题面部分先例）；
  版本锁 5 处同步 `_test_name_image_consistency`/`_test_jev_resonance`/
  `_test_jev_finding_recap_statement_gate`/`_test_empty_content_img_exempt`+
  `_test_superip_standard_path`（后者系 C114 漏同步遗留，J1.46→J1.48 顺手修复）。
- **待办**：182 pull + 猫票定向重析对拍（验 nameForm 翻 meme_name、名字门放行、
  评级升档方向）+ `--add 0x21573053e3ecda168007315f9153be78afa17777 --case C116`
  收录回归票（生成后人工复核 expect——rating 大概率升档但掷骰面勿写死）+ 全量
  case-regression 对拍 + worker 重启。

### C114 empty_content 图证在场豁免 + J1.47 通用梗缩写锚——「从用户的角度想一下，币安发了一个推，内容 DND（do not disturb），然后视频是一只猫拉上窗帘。DND 能不能作为一个小meme币？」「dev 侧不管，只管叙事分析。选1」（2026-10-19 DND 案）★

- **现场**：DND `0x4dbcb10e68626b6f663bd596905d41cdc6b07777`（four.meme）：币安地域子账号
  BinancePk（80 万粉）发推「DND 😾」+猫拉窗帘视频，token=同名缩写票。Jev 判
  empty_content 0.36 vs none 0.31——argmax 臂掷骰边缘拦死 rating=1。结论碰巧对
  （该票终局确实 low），但**拦截理由不干净**：主推有配图/视频时「内容空洞」不成立
  （图就是内容），该票的正确拦截轴是 C97 地域子账号量级锚 D 档（小号无借壳无大
  事件）。叙事层用站不住的维度拦，长期会误伤真·大号官方梗票（同形状升 A 档即
  误伤面）。
- **用户视角裁定**（买家视角复盘）：「币安发 DND 推+猫拉窗帘视频」是可成立的
  meme 形态（通用梗缩写+官方大号玩梗配图）。「dev 侧不管，只管叙事分析。选1」=
  叙事层修两条口径：
- **口径①（mapper 代码臂）**：block 门 empty_content 臂 ∧ `context.imageEvidence`
  （=twitterInfo.image_analysis 存在，与 J1.30 名图一致豁免/C109 imgCarrierOverride
  同源判据）→ 该臂不拦，fallthrough 名字门（nf）→载体门（sc）→量级门照常接管。
  无图票不触发=纯文字空洞票照拦（fail-safe：context 键缺失回落原行为）；只翻本门
  ——institution_routine 等其他桶不外溢；审计键 `emptyContentImgOverride
  {emptyP, noneP}` 命中才落 stage2DataToSave.jev（拦截票 stage1 段被 __clear，
  键必须落 stage2 才可追溯——C88 superIpSlogan 先例）。
- **口径②（题集 J1.47 name_form 锚）**：合格分支②扩「通用网络梗/文化缩写同构
  （DND/FOMO/LFG）——虽非圈内原生词，但圈内用户对缩写本身有感知、能拿它配梗
  传播」；不合格分支加「机构职位/品牌内部缩写（如工牌上的 Chief Risk Officer→
  CRO）」。**分界=用户侧感知**（同 C108 总则）：DND 合格 / CRO 不合格；对照锚
  落题面+criteria 同步。版本 J1.46→J1.47（邻接 5 测试版本锁同步）。
- **DND 终局推演**（单测 A 组锁定）：图证在场 → 翻过 empty_content → name_form=
  meme_name（J1.47）不拦 → 载体 existing_entity 不拦 → **D 档量级门拦（理由
  干净：地域小号无借壳）**；同形状升 A 档（magnitude 4.2+dim2 20=69≥60）→
  pass（误伤面正证）；CRO 对照票 not_meme_name 0.66 → 名字门照拦（豁的是
  empty_content 不是免检）。
- **单测**：`_test_empty_content_img_exempt.cjs` 24 断言 8 组（事故现场反证/无图
  照拦两臂/误伤面正证+无图对照/门链接管/桶特异性/概率门正交/审计键细节/源码
  口径四反证）。fixture=J1.43+ 新题集形状（relevance_type 融合桶分流）。
- **待办**：182 pull + DND/CRO 定向重析对拍（验 DND 翻过 empty_content 落 D 档
  量级门、CRO 名字门维持）+ 名字门基线票核验不翻 + DND `--add C114` 收录回归票
  + 全量 case-regression 对拍。

### C113 找角度语料传播力判轴纠偏 + ip_reuse 有意义/无意义边界——「传播力不参考推文的数据，而是这个事件，这个我强调了一万遍了」「有意义的修改为什么不行？」（2026-10-19 哭哭奶龙案）★

- **现场**：哭哭奶龙 `0xe9356facf0558ab0d7025e2898f51d111d517777`（event:A 0.87，J1.45 分析于 11:22 UTC）被 block_reason ip_reuse 0.6（none 0.23）拦死 rating=1。主推=138 粉账号发「错版奶龙玩偶 哭哭奶龙/奶龙这波致敬哭哭马了」——Jev 两处违反既有裁定：①dim2 8.2（微弱带「新账号/千粉以下」）**按载体账号 138 粉判了 A 类 IP 方权重**（奶龙=国民级萌系 IP，题面「知名IP 20-25」没用上）、magnitude 1.61 D 档（「仅个别人提及」臂）按语料覆盖面判——正是 C32 正龟案 J1.20 两形状分流（09-30 用户裁定）明文禁止的形状；②「错版/哭哭」是**有具体新梗对象的变形**（新造型/错版变体），被「简单替换/拼贴/模仿等低质衍生」边界词扫进去。
- **用户裁定两条**：①「这是个找角度推文，传播力不参考推文的数据，而是这个事件，这个我强调了一万遍了，不要再犯错了！」②「现有知名IP/热点的替换/拼贴/抄袭/模仿，合理即可，无意义的修改无意义，有意义的修改为什么不行？」
- **ip_reuse 案史澄清**（用户问「什么时候多了这么个拦截理由」）：非新加——Jev 迁移初版（2026-09-20 9b76a1b）就有 ip_reuse+low_quality_derivative 双桶（A 域），对齐迁移前 legacy Stage2 prompt 阻断条件集；历史实拦「低质衍生」171 行+「IP二次利用」33 行；J1.44（C110 当日）只是两桶合一（判据吸收、拦截面等价）。哭哭奶龙=合桶后 6 小时内该桶 6 票实拦之一，label 变化引来注意。
- **根因①（污染源）**：state 头部 `[PRECOMPUTED]（直接采信）`块注入 `tweet_type_reason: 低影响力: 138粉, 0赞, 0转发`——C74 时效分桶产物顶着「直接采信」帽子把载体数据喂到所有题判断现场。**根因②**：event_magnitude/dimension2 两形状句（J1.20）是通用锚，A 类场景缺「主体=被借势 IP 本身、知名度按世界知识判」的显式钉子，Jev 被分带 legend（「新账号/千粉以下」）锚定到载体。**根因③**：ip_reuse 边界词「简单/低质」与裁定轴（有意义/无意义）错位。
- **改动（J1.46）四处**：①`jev-state-builder` PRECOMPUTED 加 `tweet_type_note` 划界（粉丝/赞/转仅时效分桶用、不是事件传播数据）；②`event_magnitude` A 类句加找角度锚（主体=被借势 IP 本身、可用世界知识按真实地位评档、载体账号数据与「只有小号提及」不参与定档）；③`dimension2` A 类句同款（IP 方权重按被借势 IP 知名度判、不因「只有小号提及」降档）；④`ip_reuse` criteria 重写——仅拦两形状：纯蹭名（原名原形象直接套用无任何新内容）+无意义修改（换皮改名/硬拼无关元素），**有意义的修改/变形（新造型/错版/变体/新玩法）不拦**。mapper 零改动（BLOCK_SCOPE ip_reuse:['A'] 不动）。
- **单测**：`_test_jev_question_consolidation` A1/A8b 随版本与判据更新 + 新增 A10a-A10d 事故现场反证（三处防线源码锚+版本常量防漂移）；`_test_jev_resonance`/`_test_angle_timing_override`/`_test_jev_finding_recap_statement_gate`/`_test_superip_standard_path`/`_test_name_image_consistency` 版本钉死 J1.46；`_test_case_regression_lib` F2 票数 33→34。全绿。
- **回归票**：C113 已收录（34 票）——expect=方向性断言 `rating∈{mid,high}` + `reasonExcludes:IP二次利用` + `tokenCategory:event:A`（mid/high 档位不写死：A 类量级轴评，掷骰面勿锁）。
- **验证（2026-10-19 182 实跑）**：①定向重析哭哭奶龙 → **high 70.79**（blockChoice=none 0.7、magnitudeTier B（原 C/1.61）、prompt_type=jev(J1.46/A类)），事件分 27(B 档)+传播 19.6+时效 15=61.6 过线——两处裁定轴全部生效；②case-regression 全量（J1.46，34 票）**27 PASS / 2 FAIL / 5 OBSERVE / 0 ERROR**，C113 本票 PASS（mid 69.71，high/mid 边界 70 上下正常方差）。**2 FAIL 归因处置**（均非 J1.46 语义设计对象的误伤，方向=拦截向/等价）：**C100 弹跳猫 high→low**=J1.46 prompt 漂移使 J1.39 parent_relationship 稳定落 translation_or_repost 臂（父推 lag 89.6d>24h）→ `staleRelParentOverride` 时效 15→0 → 事件分 47<60（两次采样复现、Jev 原生 timing within_7d）；C103 门设计形状命中（载体推挂 89 天父推）且本票 10-18 按 high 实买 -8.76%，拦截盈亏正向 → expect 更新 low+auditIncludes staleRelParentOverride 留痕；**C105 日本語版**=类别掷骰 C→B（0.42→0.56）换条件题集，name_form 题不再触达、routine_content_product 0.89 argmax 先拦（CZ 出书宣传语义等价更准），终态 low 不变 → 断言收敛为必拦不锁门；C78 鲸元卷（observe）=C78 拼写门按设计命中（图内「鲸元券」一位差），终态 low 不变同款收敛。**C80 蝙蝠侠摇（observe）low→high 74.93 待用户裁定**：ip_reuse 收窄后 none 0.47 险胜 ip_reuse 0.37 不拦 + magnitude 3——蝙蝠侠=真知名 IP 按裁定轴判事件自身地位方向一致，但属买线翻转且掷骰面近贴，不擅自 update。结果存档 `case-regression-result-2026-10-19T12-37-36-229Z.*`。
- **遗留待办：182 narrative worker 重启（J1.46 上 live 服务）**；v26 实验进程（05222b30）内嵌 analyzer 同款，重启与否用户决定。



### C112 meta 任意 http(s) 直链解包（形状判定→内容判定）——「我之前的方案是，收集能收集到的所有地址（不管它填写在哪个字段里，因为用户根本不会填），然后自己进行分类」（2026-10-19 CRO 案）★

- **现场**：CRO `0xf58d7bb1a74192d615a710c5f2d5e6234dfb7777`（four.meme taxToken）被规则 4-B `public_info_fetch_failed` 终局（rating low/10，stage1 全空零 Jev 调用；该 ruleName 不在 address/no_public_info 两重试域 → 无重试）。API 字段全空，唯一链接=链上 meta 直链 `https://mil3jetlf7mwwhkea9cu.xyz/m/e6ada90384f4497afbf381eece34b380.json`（随机子域 .xyz 网关）——直抓实证 JSON 内锁着真实语料 `x.com/BinanceDesi/status/2112144227757178894`。**C106 同型复发**：j7tracker host 卡位只认单一域，换网关域即再误杀（注释「出现新迁移网关形状时在此追加」=打地鼠）。
- **方案（用户设计原则，采集层本就如此）**：`extractAllUrls` 全字段收集没问题（.json 链接确实收进了 websites 桶），偏差唯一在**解包决策按 URL 形状猜**。meta 字段语义本身就是协议指定的 metadata 指针，无需猜：任意 http(s) URL 一律直抓 + JSON 校验——**内容判定代替形状判定**，非 JSON（网页/死链）→ null → 回落既有「meta 链接按 website 处理」路径。
- **改动**（`src/narrative/utils/ipfs-metadata-fetcher.mjs`）：① `normalizeIpfsRef` 任意 http(s) 透传（scheme 白名单+无空白）；② `fetchIpfsMetadata` 按 `extractCid` 有无分派——CID 在→多网关竞速（不信任原 host），无 CID→单点直抓（同款 8s/64KB/JSON 校验/缓存 TTL）；③ C106 `DIRECT_METADATA_URL_RE`+`isDirectMetadataUrl` 退役（j7tracker bit 不回归由单测锁定）；④ `IpfsCacheWriter` 键门与读侧同函数自动同步泛化（S3 直链起有键，补采 S3 分支接线为可选增强未动）。推文 URL 填 meta → 非 JSON null → 回落 allUrls twitter 桶，与改前行为一致（C3b 断言）。
- **边缘（接受）**：meta 填普通网页且该页恰返回合法 JSON → 会被当 metadata 消费（内容尽力而为，分类器仍是下游门）；http 明文直链放行（与 `isIpfsUrl` 口径一致）。
- **预告**：解包修复后 BinanceDesi=`binance` 前缀地域子账号 → C97 锚 D + C102 借壳父推窗正常接管，大概率仍低档——性质从「无语料终局误杀」变「Jev 正常裁决」。
- **单测**：`_test_ipfs_race.cjs` 19 断言（CRO 现场形状直抓出 twitter / HTML 非 JSON null 回落 / host 卡位退役源码反证 / j7tracker+C106 bit 不回归）；`_test_corpus_ready_prefetch.cjs` S3 断言随裁定更新（不写→透传写，25 过）。**待办：182 部署 + CRO 定向重析 + 视结果收录回归票**。
- **同案后续裁定（2026-10-19，GMGN 补源层）——「理论上 GMGN API 每个代币应该很少几次调用，可以全部落库，缓存过期5秒」**：CRO 归因中发现补源层两缺陷。① `gmgn-social-fetcher` 派生形状只有 twitterUrl/websiteUrl/risk 三键，**原始 link 对象不落即丢**——CRO 现场 GMGN 分析时刻 link 聚合为空（risk 有值 → 缓存成功行），twitter_username 晚到后永远吃不到，事后归因只能裸调现查。修复=成功返回/缓存带 `raw: info` 全量 payload（upsert 保留最新一份作审计）。② `gmgn_token_info` TTL `{maxAge:1d, ttl:90d}` 注释写「1 天刷新」但 `fetchWithCache` 命中公式 `expires_at >= now - maxAge` 下实际命中窗 ≈**91 天**——「GMGN 无社媒」结论被冻结三个月，晚到的 link 聚合永远进不了缓存。修复=`{maxAge:5, ttl:5}`（买前新鲜语义：per-token 调用极少，5s 重打配额无忧；无社媒无 risk → markFailed 1h 冷却原语义不变；`PrecheckFailRetryService` no_public_info 重析前的定点失效保留为 belt-and-braces）。单测 `_test_gmgn_social_fetcher.cjs` 19 断言（raw 同引用落库/C51 推文路径/CRO link 空形状/91 天回潮源码反证）。

### C111 叙事 case 回归集上线（33 票，C65-C110 全谱）——「把我近期提交的数十个 case 做成一个测试集合，在新的叙事分析模块上跑一遍，确认改拦住的拦住，该不拦的不拦，并且原因都是对的」（2026-10-19 用户指令三段：建集→CSV→扩至 ≥30）★

- **资产（commit f5f6d3c 起，2a0b4bb 收口）**：`scripts/narrative/case-regression-fixtures.json`（33 票：C65-C110 谱系，每票 expect DSL + observe/note）+ `run-case-regression.mjs`（182 跑；跑前整行备份 /tmp；`analyze ignoreCache` 覆盖落库后回读对拍；退出码 0=全过/1=硬断言败/2=重析异常）+ `case-regression-lib.mjs`（**四信封判读** fin>pcr>prestage>+s1/s2 blob；DSL：rating 单值/数组/null、reasonIncludes|Excludes、precheckRuleIncludes|Excludes、auditIncludes（blob 子串）、tokenCategory 精确等+Excludes）+ 单测 `_test_case_regression_lib.cjs` 31 断言（零 DB 零网络）。
- **全量首轮（2026-10-19 182 实跑 33 票，修复合并口径 29 PASS / 4 OBSERVE-DEVIATION）**。改拦住的都拦住且原因正确：C104（stage_final 残留清除修复实证：旧 high 76.99 遮蔽→expired_tweet low+源头 299637s>24h）、C98 负面硬新闻、C99/C101 地址门（AUTO_TOKEN_PAGE/OK❌ 修复生效）、C106 载体门、C103 事件分不足 52.8<60、C109c 量级锚 B→D、C110/C97 gimmick、C94/C96/C105 名字门；该放行的放行：C65 巴巴鸡图豁免翻 high 75.37、C83a/b BI 双票 C88 五腿救援 high 79.51/72.63、C100 rebondit high 73.84；C80 E 类感染力折损 55<60、C70/C85 prestage project 定档 mid、C92 黑名单。
- **回归集自身三处修正（机制无 bug，均为预期/判读写错）**：① **prestage 第四信封**——C70/C85 两 FAIL 根因=project 票终态在 `prestage_result` 顶层 {rating,reason}（粉丝带定档），原判读只读 fin/pcr → rating=null 假偏差；interpret 补 ?? 链（fin>pcr>prest，abm 续走标准路径票不受定档遮蔽，I5/I5b 单测锁定）。② **C68 预期写死于 mapper override**——C74 分桶后 precheck expired_tweet（非豁免桶 lag≥300s）先拦=主拦位，C68 angleTimingOverride 降级纵深防御（precheck 先拦时不可达、audit 不落）；断言改 precheckRuleIncludes。③ **C102 终拦位写死 sc 门**——C108 门链序 nf→sc→tier 前置后终拦位随 nameForm 掷骰在名字门/载体门移动（首轮 nf 拦、复核轮 sc 拦，两路皆 low）；改断言 staleParentOverride（父推窗客观 lag 确定性）+拦住即胜。
- **C109b 謎底（C88×C102 交互面）**：暗号資産の覇者五腿没救到 **≠ mem 瘦身**——父推 lag≈2.87d>24h → staleParentOverride → timing older → FRESH_TIMING 腿断 → 救援不成立（无 superIpSlogan 审计键）→ J1.29 载体门接管（与 C102 BAI 同构，设计内拦截）。**坑：score 类答案（mem/dim2）不落 stage1_result**（只落 choice+概率分布），判读 dump 勿找 mem 分。
- **Jev 掷骰拦截面（4 张基线 high 票被概率面拦，保留警示不宽断言，是否立案另裁）**：小黑 0x9641…7777 / JDI 0x4688…7777（nameForm=not_meme_name 且 block none 0.84/0.99=**名字门唯一拦截原因**）、偷窥狂 0x57ef…7777（carrier no_visual 掷骰）、롱캣 0xd97a…7777（gimmick 0.49 argmax=C110 扩全域既定代价面）；另 啾啾/FLY 亦落名字门（时序脏票，拦向可接受）。名字门边界（单字拟声/缩写名/宠物昵称）待用户裁定是否立新案。
- **工件**：`data/case-regression-result-2026-10-19.csv`（期望/基线/当前/tokenCat 同表 25 列，BOM Excel 直开）；两轮原始 JSON+整行备份在 182 /tmp。**后续纪律：改题集/改门后 182 跑 `node scripts/narrative/run-case-regression.mjs`**（`--only C98,C104` 可点跑；掷骰面票以 observe 警示追踪不阻塞）。
- **工具正式化（同日用户指令「做成一个正式的工具，长期维护一个测试集合，并且不断更新」）**：回归集从一次性脚本升为长期维护工具。①**收录流程** `--add <addr> --case C<n>`——快照现行行为作 rating 基线（刻意不重析不烧 Jev 配额），盖 `addedAt`，生成后人工复核补意图键（机器只记录现状，断言意图必须人来定）；②**预期更新留痕** `--update-expect <ids> --because "<case 编号> <裁定一句话>"`——rating 从现行行刷新、人工细节键保留、`expectSince/expectBecause` 成对留痕（validator 强制成对+ISO 日期），**每个预期都能回答「为什么是现在这个值」**；③**清单** `--list`（零 DB 本地可跑）；④写回=tmp+rename 原子写+写前 /tmp 备份；⑤入口 `npm run case-regression`，文档 `docs/case-regression-tool.md`（DSL 全表/三工作流/写断言纪律），CLAUDE.md 操作指南「修改 Jev 题集」第 5-6 步制度化（结案即收录回归票、部署前全量对拍）。新纯函数 buildCase/updateExpect+留痕校验进单测（31→36 断言）。**集合只增不删；caseId=台账编号先 grep 防撞（C107 教训）**。⑥**目录收拢+结果存档（同日用户指令「测试结果放 csv、工具文件夹建 data 放各类数据」）**：工具资产集中 `scripts/narrative/case-regression/`（fixtures.json/lib.mjs/run.mjs），其下 `data/` 子目录=对拍结果存档（CSV+JSON，.gitignore 否定规则保进版本库，长期维护资产；首轮 C111 结果 `case-regression-result-2026-10-19.csv` 已存档；runner 结果输出默认改此目录；token_narrative 整行备份仍 /tmp 不进 git）。

### C110 题集全面复查——逻辑错误/结构性冲突/冗余三档清单 + 低风险收敛批次（J1.44/P1.12）——「我担忧其中很多地方是有冲突以及冗余的，它们让整个流程很难继续改进」（2026-10-19 用户裁定；非单案，C109 题集收敛的自然延伸全量审计）★

- **案由与复查范围**：用户提出对 case 驱动累积的全部「题/桶」做一次全面复查，找逻辑错误、冲突、冗余。复查面=16 基础题+3 条件题+4 prestage 题 ↔ `jev-result-mapper` 全消费点 + 外围（web 详情页 chips/superip-labels `sipProb`/校准脚本/jev_dryrun/扫描工具）逐一对拍。
- **发现三档（全清单）**：

  | 档 | 项 | 内容 | 处置 |
  |---|---|---|---|
  | 逻辑错误 | L1 | `jev_dryrun.mjs` score 类校验仍要求 C109 已删三题（relevance_level/quality_spelling/quality_reasonability）→ J1.43 形状必判非法；打印侧同病 | 修复（零行为面，仅工具） |
  | 逻辑错误 | L2 | `event_resonance` 悬空注释头（题 J1.36/C93 已删，注释仍标「恒带」挂在 w_product_score 头上） | 删注释 |
  | 逻辑错误 | L3 | 文档残留：image-analysis-service 注释 `none_related`（C109 融合后=other_referent）；web 详情页 eventResonance 三处恒 null 展示空行 | 修注释/删展示行 |
  | 结构性冲突 | C1 | **mag↔dim2 同轴对**：dim2 题面明文「两题评估同一主体，档位应基本一致」=同一判断问两遍；形状①②/J1.23 锚/C94 锚语义在两题文本双份维护 | **先扫描后裁定**（扫描①） |
  | 结构性冲突 | C2 | **block_reason 三桶跨类空洞**：institution_routine 只拦 {C,D}、marketing_gimmick 只拦 {W,B}——Jev 答题时看不见类别（那是另一题的输出），argmax 落 scope 外=该桶不拦（`blockInScope` false 短路） | **先扫描后裁定**（扫描②） |
  | 冗余 | R1 | `low_quality_derivative`↔`ip_reuse` 功能双桶：均 A 域、判据重叠（对现有 IP/热点的低质衍生与直接复用）、共同锚「无独立叙事生命力/无新传播力」 | 合桶（J1.44） |
  | 冗余 | R4 | `prestage_community_activity` 死消费点：唯一消费方=社区型 project 高档条件（≥100 成员 ∧ high 活跃），窄消费点不值一题配额 | 删题（P1.12） |
  | 冗余 | C4 | `referent_memeability` 题面与 web3_fit 判据重叠：mem ②「与 web3 买家口味契合」把 web3_fit 的判断又问了一遍（且 C88 五腿谓词 mem≥2 AND strongFit≥0.5 双键并存的根源） | 题面瘦身（J1.44） |

- **用户裁定（AskUserQuestion 四项）**：①mag↔dim2=先扫描再裁定；②三桶空洞=先扫描空洞频率；③低风险项全选=L1-L3 修复+R1 合桶+R4 删题+C4 瘦身。计划批准（ExitPlanMode）后实施。
- **实施（J1.44 一次 bump 承载 R1+C4；P1.12 承载 R4）**：
  1. **R1 合桶（block_reason 10→9）**：题面删 `low_quality_derivative` 桶；`ip_reuse` 文案吸收双方判据（直接使用现有知名 IP/热点 + 简单替换/拼贴/抄袭/模仿等低质衍生）；mapper `BLOCK_SCOPE.low_quality_derivative: []` 显式空域退役（C109 坑复用：只删键=删除无效）、`BLOCK_LABELS` 保留回放兼容、`ip_reuse:['A']` 不动。
  2. **C4 瘦身**：mem instructions 收窄为单维度「对象自身的玩味空间与二创潜力」，末行消歧「对象与 web3 圈受众的契合度不由本题评——归 web3_fit；不给『与 crypto 圈无关』的对象压分」；6 档 criteria 全部去 web3 化（0 分类型中立锚/3 分下限档去 AND 双条件/4 分换自嘲例）；**分数 0-5 量表与 C88 mem≥2 腿判据零改动**（分数分布会移动，对拍覆盖）。
  3. **R4 删题（prestage 4→3）**：`rateProject(data, opts)` 签名收敛（activityChoice 参删除）；社区臂恒 mid（原 high 需双条件，删一条件后不白拿 high=收紧方向）；审计键 activityNote/communityActivity 同步删；`jev_prestage_calibration.mjs` 两处跟随。
  4. **L1-L3 修复**：dryrun 校验列 `['event_magnitude','dimension2','token_quality']`+打印侧换融合桶形状；悬空注释删；web 详情页三处 eventResonance 残留删。
- **单测**：`_test_jev_question_consolidation` 追加 A8（9 桶+low_quality_derivative 键删除）/A8b（ip_reuse 判据吸收锚）/A8c-A8d（合桶行为级：legacy low_quality_derivative argmax 行不再独立拦、ip_reuse 照拦 A 域 rating=low）；`_test_prestage_project_downgrade` 社区矩阵改恒 mid+第二参传数字防御锁+P1.12 断言；`_test_referent_memeability` A4/A4b 瘦身锚（单维度+web3 判据剥离）；4 个版本钉死测试随 J1.44 更新。全绿。
- **两项扫描（182 跑，tmp 脚本完成使命后删）**：①`tmp-scan-mag-dim2-correlation.cjs`——Pearson+Spearman、量级档内 dim2 均值±标准差、档位不一致样本、**合并翻转面模拟**（dim2:=档内均值重放 mapStandardAnswers 数评级翻转向）；②`tmp-scan-blockreason-scope-holes.cjs`——choice×category cross-tab（in-scope/空洞分解）、两空洞票单（现行评级+trades 买入关联）、R1 两桶 argmax 存量票单（对拍票源）。
- **扫描结论（2026-10-19 182 实跑，29605 行全表/10017 标准路径有效重放，零异常）**：
  - **①mag↔dim2 同轴性**：Pearson r=0.85 / Spearman ρ=0.87（强同轴非同一）；档内 dim2 标准差 0.37-0.83（0-5 刻度，B 档 0.83/A 档 0.71 最大=档内有真增量信号）；档位不一致罕见（A/S 档但 band(dim2)<18 → 38/1791=2.1%；E/D 档但 ≥23 → 5/1960=0.26%）。**合并翻转面**：dim2:=档内均值重放 → 597/10017（5.96%）评级翻转换向——放行向 275、拦去向 193、mid/high 互转 129（模拟是确定性档均值映射的下界估计；两轴 85% 共线但 dim2 档内残差驱动 ~6% 行为面）。
  - **②block_reason 空洞（choice×category cross-tab 全量）**：argmax=none 占 72.5%（7259/10019）。有 scope 五桶全有空洞：

    | 桶 | scope | 空洞行 | noneP<0.5（若扩全域 argmax 即拦） | 现high/mid | 被买入 |
    |---|---|---|---|---|---|
    | marketing_gimmick | {W,B} | 261（E123/A104/C75/D63/F33/G8） | 261/261 | 25（9.6%） | 6（如 币安菠萝 0x8ce8…7777 D 档 high 实买） |
    | institution_routine | {C,D} | 86（A41/W21/E16/B6/F2） | 86/86 | 18（20.9%） | 4（MISO/汤姆猫等；上限口径未剔 platformOfficial 等 C56 豁免面——FlapGuy 0x2fb7…7777 即此链 high） |
    | baseless_speculation | {G} | 74（C21/E18/F16/W8/A6/D5） | — | — | — |
    | niche_subculture | {A} | 76（C28/E28/W12/F5/G2/D1） | — | — | — |
    | ip_reuse | {A} | 30（W16/C7/E2/B2/D2/F1） | — | — | — |

    另：low_quality_derivative（R1 已并桶）argmax 存量 674 行——cat=A 165 行分析时被拦、cat≠A 509 行走的正是该桶旧 scope 洞（R1 后新形状此桶 argmax 全不拦，A 域语义由 ip_reuse 承接）；R1 对拍票源 729 行（+ip_reuse 55）评级 low 674/high 47/mid 8、被买入 15。
  - **扫描后裁定（同日三项）与落地 J1.45**：①**C1=题面瘦身保题**——dimension2 删「档位应基本一致」同轴锚，改「同档主体之中传播面强弱细分」镜头 + 明确允许与档位不一致（高档主体传播面弱给低分/低档强给高分）；类别分带/形状分流/J1.23/J1.35 证据源引用不动；删题方案的 5.96% 翻转面否决（0.85 同轴=同一判断问两遍，但档内残差是真信号）。②**C2a=marketing_gimmick 扩全域 all**（['W','B']→'all'）——261 行空洞 noneP 全<0.5 即拦、「营销噱头无实质产品」语义不分类别；pubProxy/platformOfficial 豁免在拦截位前置不受影响。③**C2b=institution_routine 先拉 18 票盈亏**（扫描③ tmp-scan-institution-holes-pnl）：18 票 high/mid 仅 4 票成交——MISO 0x1994…7777 +0.1824×2、汤姆猫 0x36ff…7777 +0.0935、UP 0xc4a7…7777 -0.2089×2、CZDOODOO 0xd567…7777 -0.0008 → **已平仓合计 +0.0395 BNB 打平，无方向性证据**；且 4/18 票的 high 档来自锚升机制（汤姆猫/UP/leonardo=J1.23 Web3 偏好锚原判 C 档、CUE=发布者指代锚原判 B 档），argmax 置信度普遍不高（p 0.3-0.5）。**C2b 终裁（同日）：维持 {C,D} 不扩域**——打平无方向性证据下不动拦截面；扩域反而会误伤锚升票（J1.23/发布者指代锚救回的 4 票）与 C56 平台官方豁免面重叠的 A 类机构票（FlapGuy 0x2fb7…7777 型）；scope 零改动收案。单测：consolidation 新增 A8e（E 类 gimmick 拦截行为证明）+A9（dim2 题面锚）+6 测试版本钉 J1.45，10 测试全绿。
- **行为变化声明**：R1=low_quality_derivative argmax 新形状行不再独立拦（A 域语义等价并入 ip_reuse；存量行回放 bit 不变）；R4=社区语料项目票 prestage 恒 mid（收紧方向）；C4=mem 分数分布移动 → C88 mem≥2 腿命中面移动（对拍覆盖口号票）；C1/C2=本轮零行为变化（只扫描出数，裁定另立 case）。
- **欠部署**：与 C104-C109 批次同批 182 pull+重启+定向重析对拍。

### C109 题集收敛（J1.43 基础题 18→16）+ J1.29 图证载体覆盖——「我其实希望合并你所谓的"题"，真的要这么多判断标准吗」（2026-10-19 用户裁定；交易猫 0xc929c8d1e57569b706d7cfdc3487c7d33b287777 flap 案）★

- **案发现场与用户纠错**：交易猫（0xc929…7777，flap），币安发猫图、币名=事件核心词「交易猫」。被 **J1.29 载体门**拦：`subject_carrier=no_visual_entity conf 仅 0.09`（多路 choice 掷硬币），而**同一次调用**里 `name_image_consistency same_entity=0.73/conf 0.59` 的事实答案被无视——门消费了低置信掷硬币、忽略了高置信事实证据（配图里就有一只猫=形象载体客观存在）。用户质问「叙事主体是币的名字，币安发了一张图，是一只猫。哪里不对？为什么不是个好 meme 币构思？」——归因成立，用户对。
- **根因（name_referent 分类学缺桶→指代链断裂）**：旧 name_referent 六桶（subject_self/super_ip/notable_other/minor_other/common_word/none_related）没有「语料配图中出现的匿名实体」桶——图中的猫无名，只能落 minor_other/common_word → 主体被判为无名/普通词 → subject_carrier 锚定漂移到新闻发布方（币安=机构非形象）→ no_visual。形象载体就在语料配图里，分类学却看不见它。
- **裁定原话（两轮）**：①「进一步思考一下，不要有那么多桶，能合并合并」②「我说错了，我其实希望合并你所谓的"题"，真的要这么多判断标准吗」+「当然，如果桶冗余也需要调整」——**合并的对象是题本身**，桶冗余跟着收。
- **死桶实证（182 全量扫描 10815 有效行，tmp-scan-blockreason-182.cjs）**：用户追问 `regional_event` 是否与 event_magnitude 冲突、`subject_unqualified` 是否与别的题一回事——扫描证死：

  | 桶 | argmax | 平均概率质量 | 域内拦截 | 裁定 |
  |---|---|---|---|---|
  | regional_event | 9 次(0.1%) | 0.010 | **0 次** | 死桶删——「地区性」与 magnitude 的「范围」镜头三处冲突（shape②传播规模/dim2 分带/B 档措辞都已在评地域量级） |
  | subject_unqualified | 31 次 | 0.050 | 23 次(p 0.22-0.58) | 三重冗余删——name_form 分支①无名实体臂/magnitude 无名低档/mem 0 档三处已判「主体资格」；唯一独有元素=粉丝<1万量化锚，语义由 name_form 承接 |

- **修复（J1.43，基础题 18→16；brand_hijack/name_image_consistency/parent_relationship 条件题另计）**：
  1. **relevance 两题合一**：删 `relevance_level`；`relevance_type` 改 9 融合桶（exact_match 20/translation_match 18/abbreviation_alias 17/semantic_clear 13/semantic_weak 9/cultural_rich 12/cultural_thin 3/generic_concept 5/none 0，代码端 `RELEVANCE_FUSED_SCORES`）。none=0 保住 imgNameExempt `relevance.score>0` 锚；weak 9≤10 仍截断/clear 13 过线对齐旧 lv 分层。
  2. **quality 两题合一**：删 `quality_spelling`+`quality_reasonability` → `token_quality`（score 0-3 band 索引，`TOKEN_QUALITY_BANDS=[[0,2],[3,5],[6,9],[10,12]]` 联合量纲=旧拼写 0-7+合理性 0-5 合刻度，类别阈值 70/50 语义不变）。
  3. **name_referent 6→3**：`subject_self`/`super_ip`/`other_referent`（notable_other+minor_other+common_word+none_related 四桶并入；super_ip 桶文本不动=C88 sipProb 判据源）；other_referent 文案新增「**语料配图中出现的形象（动物/玩偶/吉祥物/角色等）也是可判定的指代来源**：币名与配图形象对应时按该形象自身量级归此评估」——交易猫断链修复点。
  4. **subject_entity 8→2**：`product_entity`（功能产品/产品形象合并——J1.27 门本就同拦）/`other_entity`；mapper 兼容集 `Set{product_entity, product_functional, product_character}` 旧 choice 照拦（C107 先例）。
  5. **subject_carrier 锚修正**：instructions 删假同口径引用（原引 name_referent/subject_entity 两题的旧桶名已不存在），改「评估对象=代币名所指代的实体本身（按 name_referent 题判定的指代对象……名字指向配图/语料中出现的形象时，评估对象就是那个形象）」。
  6. **block_reason 删两死桶**（12→10）：mapper `BLOCK_SCOPE` 显式空数组退役（**blockInScope 坑**：`scope===undefined` 按通用拦——只删键会让 legacy 形状 choice 照拦，删除无效；空域=任何类别都不拦）；BLOCK_LABELS label 保留防未知选项 fallback 打裸键名。
  7. **M1 图证载体覆盖（imgCarrierOverride）**：`context.imageEvidence && nicMatchP>=0.5` → J1.29 不拦（同源同阈值=J1.30 imgNameExempt 的 same_entity≥0.5，但独立无关联≤10 窗——载体存在性与关联强度正交；audit `subjectCarrierImgOverride {carrier,matchP}` 命中才落）。校准不动：暗号資産の覹者本就走 C88 豁免、BI 无图证不触发。
- **已知边界变化（用户已批准方向内）**：①旧 cultural lv2(=10 恰好截断) 归入 cultural_rich(12 过线)——关联截断边界小幅移动；②quality 单票不再 bit 一致（题目本身变了，版本断代语义内）；③subject_unqualified 粉丝<1万量化锚退役。
- **事故级 bug 本轮自查补刀（relevanceFrom 同名桶劫持）**：融合表首版按**桶名**优先命中，而新旧表 5 个同名桶分值不同（abbreviation_alias 16-18 vs 17 / generic_concept 2-7 vs 5 / none 0-2 vs 0）——legacy 形状行（带 relevance_level）会被融合表劫持，存量行 bit 不变承诺被打破。修正为**形状分流**：`relevance_level` 键在（旧两题形影不离）→ 旧表查表；键无 → 融合桶直查。单测 C 潜在断言锁死（abbreviation lv0→16 非 17 / none lv4→2 非 0）。
- **测试**：新增 `_test_jev_question_consolidation`（48 断言：问卷形状/9 桶分值精确/legacy 关联+质量路径 bit 不变/同名桶防劫持/C88 relPositiveMass 新桶求和/J1.27 兼容集/退役桶空域+活桶对照）；`_test_subject_carrier` 扩 H 段 6 断言（M1：交易猫形状不拦/E+no_visual 同豁/无图证 BI 照拦/低 nic 照拦/audit 归因）。存量陈旧锚常规跟进 8 套（版本锁 J1.42→J1.43 六处、题数锁 18→16 三处、subject_entity 桶形锁、superip G2 调用形状锁）；**顺手修 C92（2e92c54）遗留存量失败** `_test_narrator_two_shapes` B9/C2（`git show HEAD` + stash 双验证非本轮引入——C92 重写 E 类证据层级措辞时漏更断言锚）。22 文件全绿。
- **断代语义**：J1.43 断代，存量缓存行不重放 mapper → bit 不变（含 legacy 形状回退路径：relevanceFrom/qualityFrom 旧分支、PRODUCT_ENTITY_CHOICES、BLOCK_SCOPE 空域）。
- **部署与对拍（待执行）**：182 pull + 重启叙事 worker + v24 实验进程（重启前走持仓确认规程）。定向重析对拍清单：交易猫（J1.29 不再断，终评级交全链）/暗号資産の覹者（C88 五腿仍全中）/BI（无图证仍拦）/C88 口号票（relPositiveMass 新桶名五腿仍中）/关联截断边界票（C59/C65/C86 豁免票）/23 张 subject_unqualified 拦截票+9 张 regional_event argmax 票（预期被 name_form/magnitude/mem 或其它活桶接管）。

### C108 名字门统一（J1.42 name_form 四分支：「合不合适作为 meme 币」单一门，四拦截位退役）——「所以我觉得很多门，不如合并为『合不合适作为meme币』门，这是根本的」（2026-10-19 用户三轮裁定；EARLY 0xc8a55fed967db1f1be1fac90c3a453c1c4187777 CZ 回复逐字发币案）★

- **案发现场与归因更正**：EARLY（0xc8a5…7777），CZ（@cz_binance 1299 万粉）回复评论者 "you got in early" 后 4 秒逐字发币。被 **nrBlock common_word 臂**（J1.10：name_referent common_word 0.92 + minor_other 0.04 = 阻断侧合计 0.96 ≥0.5）误拦为「截词」；J1.41 重析 name_form 亦判 not_meme_name（双门一致误拦——J1.41 三选缺「圈内文化词」分支）。放行侧证据全绿：web3_fit strong_fit 0.97、direct_tweet 豁免（CZ 粉丝档）、时效 lag≈0。**归因更正随案立档**：首轮排查误归因 block_misspelling 探针——错误，实拦 nr common_word；「截词」label × Stage3「截断:」前缀 ×「拼写错误」探针三术语连撞是误导源，本轮消除（nr 退役后「截词」label 源头消失）。
- **三轮裁定原话**：①「第一 CZ 是发了这句话，第二，如果一个 meme 币的叫 Early 行不行？尤其是 early 还有着『趁早』的深意。这里最重要的，还是看这个词作为 meme 币合理与否，web3 用户能不能接纳它作为 meme 币名字。CZ 回复一句 我要去滑雪，『滑雪』肯定不行，『我要去』肯定不行……所以我觉得很多门，不如合并为『合不合适作为meme币』门，这是根本的。」②「如果代币的名字指向一个实体，那么这个实体到底是什么情况还是需要考量（例如普通币安员工就不行），但是 early 并不是一个实体。」③「YAYA 我记得就是币安员工，所以不行」＋「meme 名字拼写错误，也肯定不行，不知道是不是涵盖了，我的意思是，用一个门涵盖多种情况」。
- **修复（J1.42，nf 门升格唯一名字拦截位）**：name_form 保持三选（meme_name/not_meme_name/unclear），判据四分支写全——**①指向实体**：实体是圈内符号/超级IP/有玩味空间→合格（实体量级与玩味另有题评，本题不扣分）；实体无名（普通员工/小号/花名外号，对照锚=币安员工 YAYA）→不合格，且被大V/超级IP提到/@到不改变其无名；**②非实体词**：圈内文化词/黑话/有圈内深意（early/趁早、HODL、LFG、WAGMI、GM）→合格；无圈内感知的普通句片段/语料截词（滑雪、我要去）→不合格——对照锚=CZ 说 "you got in early"→「Early」合格、「我要去滑雪」→「滑雪」「我要去」不合格，分界=**用户侧有没有感知**，不是词出自谁、也不是是否截自语料；**③形态缺陷**（C107 继承）：事件陈述/版本词/序号/纯功能描述→不合格；**④拼写变体**：对已知概念/实体的明显拼写错误且无独立背景/文化来源（doge→dogwifhat 类有文化来源变体不算）→不合格。「不限于此」锚保留（反打地鼠制度化）。
- **四拦截位退役**（现行四门判轴各异但根本问题同一个，各有实证误拦/失效）：

  | 退役拦截位 | 原判据 | 退役理由 |
  |---|---|---|
  | nrBlock（J1.10） | minor_other+common_word 合计≥0.5 | EARLY 被 common_word 0.92 误拦；YAYA 靠五五开概率摇摆过半——概率臂承载「实体考量」不可靠 |
  | rmBlock（J1.28） | referent_memeability mem≤1 | 判「无名/严肃对象」与 nr 票型重叠，同为「用户不接纳」子集 |
  | memFloor（C88） | mem∈(1,2)+FRESH_TIMING_C88 | 与 nf 形态判据高度重叠（币安上电视 mem 1.72 本就是 not_meme_name）；京小安 mem 1.88 误拦型 |
  | block_misspelling 探针臂（Stage3 P≥0.5） | noul≥0.5 | C78 鲸元卷案实证失效死键（Jev 答 0.13-0.27 拦不住）；**题整块删除**（默认题集 19→18，开 parent_relationship 臂 20→19；判据并入分支④） |

  C78 代码门 `detectNameImageSpellingMismatch` 保留兜底图文场景（Stage3 臂改 `spellingMismatch.hit` 单判据=唯一拼写拦截位）。**name_referent/referent_memeability 题保留原样**——只喂评分与豁免链（C88 五腿 sipProb≥0.5/mem≥2、rideDetour、pubProxyActive），不再承载拦截，避免多处断代。
- **mapper 形状**：`notMemeNameBlock` 唯一名字拦截位（`NOT_MEME_NAME_CHOICES = Set{not_meme_name, statement, functional_label}` 兼容映射保留——J1.37-J1.40 旧行重析继续拦）；门链序 nhn→rcp→w3→pe→blockChoice argmax→**nf**→sc→量级门（rm/memFloor 位消失）；`nameReferentBlock`/`NAME_REFERENT_BLOCK_LABELS`/`referentMemeabilityLowBlock`/`memFloorFired` 函数与常量删除；退役审计键新行不落=undefined（nrNotableExempt/nameReferentBlockMass/referentMemeabilityBlock/memFloorBlock/misspellingP/block_misspelling 概率投影）；恒落保留（nameReferentProbability 纯观察/referentMemeabilityScore/memScoreC88 五腿审计）；finalReason P 段 nrBlock.mass 引用清理。退役位留 C108 指向注释（案史不删，同 J1.26 模式）。**全域无豁免五腿不豁**（继承 C96/C105/C107 分工论证）。
- **断代语义**：J1.42 断代，存量缓存行不重放 mapper→bit 不变；重析票按新门判。**旧拦新放票型**（拦截面收窄，用户已认方向）：EARLY 型圈内词截票 / CONVICTION 型 KOL 推文截圈内信念词 / mem∈(1,2) 名字有圈内感知票（京小安 mem 1.88 双锚 60 恰过线新放行）。**仍拦**全由 nf 四分支承载：YAYA/币安员工型（分支①无名实体）、滑雪/我要去型（分支②无感知）、日本語版/币安上电视（分支③）、哦型无背景拼写变体（分支④）、C78 图文拼写（代码门不动）、无名普通人/严肃对象（原 rm mem≤1 票型→分支①②）。unclear/答案缺失 fail-open。风险点：原三门判别面由 choice 单题承载，choice 带锚判准度有 C96/C105/C107 实证背书但需扩票集对拍。
- **测试**：`_test_jev_finding_recap_statement_gate` 扩至 102 断言——A 段四分支判据锚（总判据/三对照锚 Early·滑雪·我要去「不是词出自谁也不是是否截自语料」/无名实体锚「币安员工花名」「被大V提到不改变无名」/拼写变体锚 doge→dogwifhat/A19 题集 18 题）/ G 段九断言（G1 EARLY 翻案位 common_word 0.92+meme_name→pass+nameReferentProbability 0.92 恒落 / G2 滑雪拦 / G3 YAYA 五五开 not_meme_name 拦·meme_name 放 / G4 mem=1 meme_name 放·not_meme_name 拦 / G5 mem 1.72+A 类 meme_name 放 / G6 referentMemeabilityScore 恒落 / G7 block_misspelling noul 0.9+meme_name→pass）/ F8-F11 退役调用形状反证 + 默认题集源码锁。直接门测改造：notable_other_exit（nr 断言退役+断代头注）、publisher_proxy（nr 豁免臂随门退役）、superip_slogan_class（memFloor 退役+五腿审计恒落）、subject_carrier（原拦截形状载体门接住不裸放）、name_image_spelling_mismatch（臂单判据化）、referent_memeability（拦截位退役题保留）。邻居 12 套跑绿（cashtag/web3_fit×2/w_interaction/regional/jev_resonance/angle_timing/name_image_consistency/superip_standard_path/instagram/product_entity/freshness_bucket）；版本断言 J1.41→J1.42 四套；顺手修两处存量过期锚（instagram F2c C94 双锚链、jev_product_entity D2b C88 参数——git show HEAD 验证非本轮引入）。
- **部署与对拍（2026-10-19 完成）**：182 pull f61f500 + 重启叙事 worker（pid 3219718）+ v24 实验进程（持仓=0 规程通过，pid 3222355，五案同批=C104/C105/C106/C107/C108）。定向重析 8 票结果（token_symbol 核实地址；wss_events payload contains 全表扫超时坑→改走 token_narrative token_symbol 独立列）：

  | 票 | 重析结果 | 判定 |
  |---|---|---|
  | 日本語版 0xe156…7777 | low，**名字门 P=0.83** | ✅ 仍拦（分支③） |
  | 币安上电视 0xc6d0…7777 | low，**名字门 P=0.51** | ✅ 仍拦（分支③）——**J1.42 门判准度正证**（C107 三选下的双案在新四分支下全接住） |
  | EARLY 0xc8a5…7777 | low，名字门**放行**（名字轴修复生效）→ 被 **J1.29 载体门**接住（C 类+no_visual P=0.43） | ⚠️ 未翻放行：名字误拦已消除，但载体门拦「EARLY 无形象载体」——subject_carrier 改造时「原拦截形状由载体门接住不裸放」的实证。是否豁载体门=新决策点交用户 |
  | 京小安 0xad55…7777 | low，**名字门拦**（name_form 判 not_meme_name） | ⚠️ 仍拦但换门：mem 1.88 玩味不足语义被名字门继承（C88 memFloor 原判与 J1.42 判同向） |
  | 鲸元卷 0xe0cf…7777 | low，事件分 59.24<60 量级门贴线拦 | ✅ 仍拦（拦截位=量级门；C78 图文门本轮未触发） |
  | YAYA 0x55ff…7777 | low，routine 内容门（机构日常运营） | ✅ 仍拦（语料形状与用户记忆的 YAYA 案未必同票，10-16 stage=null 老票） |
  | 哦 0xbefe…7777 / YAYA 0x774a…7777 | **重析异常：代币不存在** | ❌ 线上无法对拍（9 月老票 GMGN/AVE 已下架）；分支④形状由主测 G7/A18 fixture 锁定 |

### C107 名字门收敛（J1.41 name_form 三选：这名字适不适合作为 meme 币）——「其实我觉得可以不加新维度，就使用『是否合适作为 meme 币』这个维度就好」（2026-10-19 用户裁定；C105 日本語版案当日二次裁定收敛）★

- **裁定与根因**：C105 落地数小时后用户裁定收敛——逐形态加臂是打地鼠（C96 陈述句→C105 版本词→下一形态序号/目录行→……每出一个新形态就要 bump 一次题面加一个 choice 加一门），而「名字资格」本质是**一个判断不是一套语言学分类**。J1.37-J1.40 的 name_form 四分类（entity_phrase/statement/functional_label/unclear）把「分类学」当判据，Jev 感知正确但只能在错误的问题上作答（日本語版案 entity_phrase 0.96 语义上没错——它确实是 NP，错的是 NP 不等于合格 meme 名）。裁定原话直接进题面做唯一判据锚。
- **修复（J1.41，题数不变 20）**：name_form 整题重写为单一合格度三选——`meme_name`（名字是可指代/可传播的符号：实体名词短语或口号/宣言/代号，可被抓住当符号玩梗二创）/ `not_meme_name`（名字本身当不了符号：事件陈述/版本功能标注/序号——读者记住的是事件/内容/目录行，不是这个名字）/ `unclear`（fail-open）。判据锚：①「是否合适作为 meme 币」是唯一判据，语言学分类只是佐证不是答案；②判名字本身，不判指向对象的影响力/玩味价值（指代对象好不好玩梗另有题评——名字是陈述句或版本词照样不合格）；③核心词修饰锚（「XX 完整版」核心是 XX → 合格，防误伤）；④口号/宣言/祈愿（「货币自由」「HODL」「LFG」）是可传播符号 → 合格；⑤中英文名取更完整的一个判；⑥**不限列举锚**——not_meme_name 判定锚列举币安上电视（C96）/日本語版（C105）两案实例但题面明确「不限于此——凡『名字本身当不了符号』的形态都算」：下一形态出现不用再加 choice 不用再 bump（反打地鼠的制度化）。
- **mapper 两门合并**：`statementNameBlock`（C96）+ `functionalLabelNameBlock`（C105）→ 单门 `notMemeNameBlock`，`NOT_MEME_NAME_CHOICES = Set{not_meme_name, statement, functional_label}`；门链序 rm→**nf**→memFloor→sc；label 统一「币名不适合作为 meme 符号（名字门）」。**全域无豁免五腿不豁**（分工论证继承 C96/C105：mem 轴量「指代对象的玩味价值」量不到名字形态——币安上电视 1.72/日本語版 2.5 均过地板，「尺子量不到名字」；J1.29 载体门评主体形象不依赖名字结构；五腿前提是口号票——名字=口号=可传播符号，陈述句/版本词名字连口号都不是，两案五腿全中正是线上放行路径，本门是唯一拦截位）。
- **旧 choice 兼容映射（断代 bit 兼容红线）**：J1.37-J1.40 存量缓存行 choice=statement/functional_label → 兼容 Set 继续拦（两门时代各自拦截位不变，C96 已部署线上）；entity_phrase → 放行（语义等价 meme_name）；unclear/缺失 → fail-open。**存量行行为与断代前逐位一致**（C96 statement 行为照旧是部署红线——v24 直调进程跑的就是这套）。
- **审计**：stage1 `jev.nameForm` 恒落（Jev 原 choice）；stage2 `jev.nameFormBlock {form}` 命中才落——form=Jev 原 choice，归因可分（not_meme_name=J1.41 新判 / statement·functional_label=旧缓存行兼容臂，校准免重跑）；旧键 statementBlock/functionalLabelBlock 退役（零消费方，已核）。C105 的「优先级锚 functional_label>statement>entity_phrase」随之作废（三选下无竞争）。
- **断代语义**：J1.41 断代，旧缓存行不重评；新分析起生效。
- **测试**：`_test_jev_finding_recap_statement_gate` 重构扩至 83 断言——A 段（三态收敛+旧 id 退役+单一判据锚+口号合格锚+不限列举锚+两案事故词都在锚）/ C 段收敛真值表（8 类别×not_meme_name 全拦+meme_name/entity_phrase/unclear/缺失放行+五腿全中不豁）/ **C2 段兼容映射**（statement/functional_label 存量行 8 类别照拦+form 归因可分）/ D 段币安上电视 J1.32 快照反证（statement 兼容臂同位拦截）/ D2 段日本語版 J1.39 快照逐位反证保留（D6 entity_phrase 实况=pass=true 线上形状复现——名字门必要性正证；D7 not_meme_name=拦；D8 同快照新旧三臂同门同 label）/ E4b nameFormBlock 三形状 / F1b 兼容 Set 源码锁 + F2 门链序五点索引递增 + F6c J1.41 changelog 裁定原话锁。邻居单测版本断言 J1.40→J1.41 四套常规跟进（superip_standard_path/jev_resonance/angle_timing_override/name_image_consistency）；regional_binance_anchor 用 entity_phrase 默认值天然兼容零改动。
- **存量影响面**：断代免扫；日本語版 0xe156…7777 定向重析翻转验证与 C105 待办合并（J1.41 重析后 name_form 应判 not_meme_name→拦）。
- **部署**：182 pull + 重启叙事 worker + 实验进程；与 C104/C105/C106（欠部署）同批；live 实验（v24）重启前走持仓确认规程。

### C106 迁移直链 metadata 解包（j7tracker.io 第三形状）——社媒锁死在 metadata JSON 里被规则 4-B 一枪误杀（2026-10-19 用户裁定「好，修复」；BNB Tree 0xd50e11204f7f3d63598b0118ee4151bf95917777 案，pump.fun 迁移票）★

- **案发现场**：TREE（BNB Tree）0xd50e…7777，v24（18032923）C84 触发模型 round 1 于 2026-10-18 20:07:03 UTC 发起分析（trigger_reason=condition），**0.4s 完成 rating=1——precheck 规则 4-B `public_info_fetch_failed` 短路，Jev 零调用**。URL 分类全语料桶仅 1 条：`raw_api_data.meta` 直链 `https://metadata.j7tracker.io/metadata/1fc6571ba6bb4827.json`（落 websites 桶）；`twitterUrl`/`webUrl` API 字段均空。终局性双锁：该 ruleName 不在 PrecheckFailRetryService 两域（address/no_public_info）内；非 accountOnly 无 C84 补轮——无任何救援路径，一枪死。
- **根因（C7 解包器形状盲区，ARENA 案同族第三形状）**：metadata JSON 实抓内含 `twitter: https://x.com/TCryptochicks/status/2111911894772576530`（`createdOn:"pump.fun"`——pump.fun 迁移票，该形状将持续出现）。C7 解包链 `normalizeIpfsRef` 只认 `/ipfs/<cid>` 网关 URL 与裸 CID（Qm/baf）两形状；j7tracker 直链 `/metadata/<id>.json` 两条皆不中 → 不解包 → 社媒锁死在 JSON 里；websites 桶抓取全局关（`websiteFetch.enabled=false` 设计口径）→ `hasValidDataForAnalysis`=false → 4-B 误拦（语义错位：metadata 里本就没有社媒=应落 no_public_info 可重试域，却按「获取失败」终局死）。
- **修复（ipfs-metadata-fetcher，纯解包层不 bump 题集）**：新增 `isDirectMetadataUrl` host+路径双卡位（`https://metadata.j7tracker.io/metadata/<id>.json`，id 段 `[A-Za-z0-9_-]+` 收 .json 尾——新迁移网关形状出现时在此追加）；`normalizeIpfsRef` 第三形状原样透传；`fetchIpfsMetadata` 直链分支**先于 CID 提取**——单点直抓（复用 `fetchGatewayJson` 同款 8s 超时 + 64k JSON 校验），失败/异常均 warn + null（对齐网关全败语义）走原「解包失败按 website 处理」路径；缓存同 `ipfs_metadata` 档（metadata 不可变语义同 IPFS）。解包成功后 data-fetch-service 既有 splice 自动剥掉 meta URL 本身（JSON 已展开不重复抓）。
- **验证**：`extractAllUrls(真实 TREE metadata JSON)` 解出 twitter 推文 + 配图 2 URL（集成点 sanity）；单测 `_test_ipfs_race` 扩 C 段 6 断言（形状卡位含首尾空白 + 五反例（非 https/异 host/异路径/无 .json/id 带斜杠）、normalize 透传、直抓成功**不碰 IPFS 网关**（stub 未匹配即 throw 反证）、异常 → null、源码口径直链分支先于 CID 提取 + host 卡位在源码），全套 16/16。修复过程反证一坑：直链分支首版无内部 catch，打桩直透下异常穿透 FATAL——补内部 catch 后与网关路径语义逐位对齐。
- **存量影响面**：`token_narrative` 存量行不自动重析；本票可 `updateIsValid→reanalyze` 定向翻转验证（解包进 twitter 语料后走标准 Jev 评档，评级交 Jev——修复只解锁通路不预设结论）。
- **部署**：182 pull + 重启叙事 worker + 实验进程（直调走引擎进程内 analyzer）；与 C104/C105（欠部署）同批；live 实验（v24）重启前走持仓确认规程。

### C105 name_form 第四选 functional_label（版本词门：版本/语言/形态/序号元词不是 meme 名字）——「日本語版根本不能作为 meme 名字，事件本身在 web3 影响力并不小」（2026-10-19 用户裁定；日本語版 0xe156aa3f3e89ded51ef0b980018ef15ae0517777 案，CZ 出书簇第 6 张蹭票）★

- **案发现场**：CZ（@cz_binance 1299 万粉）2026-10-19 01:47:24 UTC 发推《Freedom of Money》日本語版本日发售（出书促销推，发推时 0 赞 0 转），**蹭票者同一秒抢发「日本語版」**（token_create block_time 与推文发布同秒；symbol/name 逐字=推文元词）。3 秒后分析完成（313ms 单次 fan-out），**S 档 39+传播 27.44+时效 15=81.44 过线，final 80.24 high**。0 信号 0 交易 0 轮次行（非 v24 触发模型发起，worker/直调通道预热缓存），但 high 已进 token_narrative 全局缓存（is_valid=true）——未来任何实验消费按 rating=2 放行。
- **Jev 感知正确、门不消费（mbti 夹克案同款句式）**：stage3 `relevance_type=translation_match 0.62`——Jev 完全知道名字是「某内容的翻译版本词」，但 name_form 三选里没有这个形态可选 → `entity_phrase 0.96`。放行路径逐关：①block 臂 argmax=routine_content_product **0.82**（Jev 最自信的判断就是「日常内容产品」）被 C88 五腿豁；②nr 阻断侧合计 0.36<0.5 放；③rm mem 2.5>1 放（指代对象=CZ 的书，J1.34 后按对象 web3 影响力评）；④st 不触发（无 statement 臂可选）；⑤**五腿全中**（superIp 0.53/relPositive 0.9/relNone 0.08/mem 2.5/within_7d/strongFit 0.73）豁 J1.29 载体门——`no_visual_entity 0.97` 本该拦 C 类；⑥mem 地板 2.5≥2 放；⑦J1.27 产品实体门被 web3_fit 接纳臂穿透（strong_fit 0.73+fit 0.08=0.81≥0.5）；⑧magnitude 5 档 0.9=S 档送 39 分。时效轴全绿（lag≈0 秒蹭新推，C74/C102/C103/C104 时效门天然不适用——本簇前五张是「旧推洗白」族，本票是「新推秒蹭」族，by design 管不着）。
- **用户裁定拆解（两个轴分开裁）**：「事件本身在 web3 影响力并不小」——**量级轴不背锅**，S 档/CZ 出书事件被接受（mbti 夹克案搁置候选 B「快推传播分不按体量满格」明确不启用）；「日本語版根本不能作为 meme 名字」——**洞=名字资格**：版本/语言/形态/序号元词描述「某内容的一种版本形态」，无独立指代对象无玩梗空间，是版本目录行不是符号。与 J1.37 陈述句门完全同构（C96「借壳口号豁载体/截断位救不了名字本身不合格」——名字本身不合格任何救援救不了），且比 mbti 案更裸：mbti 还有 personality trait→MBTI→夹克引申链，本票连引申都没有，币名=推文元词逐字。mbti 案（0x5f50…7777，2026-10-18 裁定先不改三候选搁置、台账未立）为同族前兆，本票为第二次复发。
- **修复（J1.40 name_form 加第四选 functional_label，题数不变 20）**：题面加「功能标注」定义（版本/语言/形态/序号元词：日本語版/英文版/完整版/第二版/官方版/remix 版/翻訳/version/edition——无独立指代对象，读者记住的是内容，名字只是版本目录里的一行）+ **判定优先级锚 functional_label > statement > entity_phrase**（版本词语法上是 NP 但语义是元词，同「陈述句里含实体不改变它是陈述」）+ 核心词修饰锚（「XX 完整版」核心是 XX 按核心词判，不算 functional label——防误伤「版本词只是修饰、核心是梗/实体」的真 meme 名）。mapper `functionalLabelNameBlock` 硬拦（statement 门同族同位，**全域无豁免五腿不豁**——五腿前提「口号票 NP 名字」，版本词连内容词都不是；本票五腿全中正是线上放行路径，本门是唯一拦截位）。门链序 rm→st→**fl**→memFloor→sc。审计 stage2 jev.functionalLabelBlock 命中才落；档位恒落 stage1 jev.nameForm（四选自动兼容）。
- **断代语义**：J1.40 断代，旧缓存行（J1.39-）name_form∈{entity_phrase,statement,unclear} 行为 bit 不变（fail-open 不拦），新分析起生效；答案缺失/unclear fail-open（J1.37 同款）。
- **测试**：`_test_jev_finding_recap_statement_gate` 扩至 76 断言——C2 段（8 类别×functional_label 全拦/其余三态+缺失不拦/statement 臂 label 归属 st 互斥无竞争/五腿全中不豁）+ D2 段（**日本語版 J1.39 快照逐位反证**：D6 entity_phrase 实况=五腿全中 pass=true 线上 high 形状复现——版本词门必要性正证；D7 functional_label=版本词门拦+五腿全中=唯一拦截位反证；D8 statement 臂链序归属 st）+ E4b 审计键 + F1b/F2/F3b/F6b 源码口径（门函数形状/门链序五点索引递增/fl 臂无豁免源码锁/J1.40 changelog 含地址与裁定原话）。邻居单测版本断言同步：superip_standard_path/jev_resonance/angle_timing_override/name_image_consistency 四套（版本号断言 J1.39→J1.40 常规跟进，题数断言不动）。
- **存量影响面**：断代免扫（旧行不重评）；本票 high 缓存行可 `updateIsValid→reanalyze` 定向翻转（J1.40 重析后 name_form 有臂可选应判 functional_label→拦），部署后按 C98/C100/C103 定向重析对拍先例验证。
- **部署**：182 pull + 重启叙事 worker + 实验进程（直调走引擎进程内 analyzer）；与 C104（欠部署）同批。

### C104 direct_tweet 豁免主从结构门（源头本体>24h 须有 ≤24h 新载体，否则回落 300s 拦）——「要有主从推文结构才豁免 lag<300s 拦截的呀！」「CZ 的推 3 天不被用烂了」（2026-10-19 用户裁定；バイナンス人生 0x1890c934d59697398494cfec9f92b9e521c67777 案，C88 出书簇第 5 张蹭票）★

- **案发现场**：CZ（@cz_binance 1299 万粉）2026-10-15 03:16 官宣《Freedom of Money》日文版 10-19 上市（回复 JPYC 代表 10-13 晒书推）；token 10-18 14:30 发币「バイナンス人生」= 上市前 28h 蹭预热，**主推 lag 3.47d**。J1.38 判 high 76.99（S 档 39+传播 29+时效 15=83 过线）：`tweetType=direct_tweet`（粉臂 1299 万）→ C74 豁免跳过 300s 硬拦；Jev `timing=within_7d`（0.79）按档位定义答案正确（3.47d<7d 且书未上市在发酵窗）；`staleSourceOverride=null`（C75 只拦 >30d）；C102 限 binanceCorpus（cz_binance 非 binance 前缀）；C103 J1.39 未部署（v24 前跑的）且 CZ 是当事方官宣非翻译/二手臂；**C88 五腿救援命中**（super_ip 0.82/relPositive 0.76/mem 3.07/within_7d/strongFit 0.89）豁掉 rcp argmax 臂（routine_content_product 0.7 本会拦）与 J1.29 载体门（no_visual_entity 0.95 本会拦）——救援本身是 C88 裁定预期（同簇暗号資産の覹者 11.8x/BI 4.86x 先例），但时效轴全盲。
- **时效洗白三形态收口（本案=第三形态完全体）**：①BAI（C102）载体=主推位新推，源头=in_reply_to 父推 3d→父推窗拦；②Jean Phil（C103）主推位=Dexerto 老推本体 20d，载体=website_tweet 翻译推 13s→J1.39 关系臂拦；③**CZ 本案：无载体**——源头本体直接当唯一语料（website_tweet 位挂的是同一条旧推），C74 豁免+C75 30d+无关系臂可用=全盲。台账 C103 段已点名「主推位本身就是老源头本体」盲区但 C103 只修了有父推关系的臂。「用烂」实证：CZ 10-15 推文后同簇已发 ≥4 票（C88 四票），本票第 5 张起。
- **事实澄清（先钉死再立法）**：C74 台账四决策/memory/实现三处一致——豁免判据=复用 classifyTweetType direct_tweet 线（粉≥5000/赞≥500/转≥100），**无主从结构条件**（非实现漏条件）；且啾啾立法原型本身零主从结构（41.7 万粉裸新闻推 8.8h、无 in_reply_to/quoted/retweeted/website_tweet）——照字面「有主从才豁免」会拦死啾啾类。真实立法意图（用户 2026-10-19 两句裁定合并）：**豁免的正当性=「实时传播正在发生」——要么主推本体新（啾啾发现窗口内），要么有新载体挂旧源头（主从结构）；两者皆无=用烂的存量旧推不豁免**。
- **修复（pre-check-service 规则 2.1，纯代码层不 bump 题集）**：direct_tweet 豁免分支加检——主推 lag `> DIRECT_TWEET_STALE_SEC`（24h，对齐 C102/C103 `PARENT_REL_STALE_SEC`，同窗三槽位：父推位/website 位/主推位）时，须 `website_tweet/quoted_status/retweeted_status` 任一 ≤24h 新载体（`_tweetLagSec` helper，created_at 缺失/解析失败=null fail-open）才继续豁免；无载体回落非豁免桶 300s 判定（此形全槽位必 ≥300s→`expired_tweet` 拦，不烧 Jev 配额）。主推 ≤24h 不依赖载体照豁免（啾啾 8.8h）；主推 created_at 缺失 fail-open 豁免照旧；锚=tokenCreatedAtSec 同链（外层锚门保证在场）。审计：回落形状 details 落 `staleDirectLagSec`（非回落不序列化），ruleName 保持 `'expired_tweet'`（监控口径连续）。
- **对拍验证（四形状全对称）**：啾啾 8.8h 裸推→豁 ✓；BAI 主推 50s→豁 ✓（源头旧由 C102 管）；Jean Phil new_angle 臂（主推 20d+载体 13s）→豁、关系归 Jev 层 ✓（**维持 C103「新角度解读臂放行」裁定不回退**）；CZ 3.47d 无载体→拦 ✓。
- **测试**：`_test_precheck_tweet_freshness_bucket` 65 断言——K 段新增 13 断言（**CZ 现场反证逐位重现**：1299 万粉/3.47d/website 同条旧推→拦+`staleDirectLagSec` 落值；载体救援臂 13s→放；主推窗边界 86400 放/86401 拦严格 `>`；载体窗边界 86400 放/86401 拦 `≤`；主推 created_at 缺失 fail-open；常量+判定链源码锁）；**F 段翻转**（互动臂 7d/30d 裸推从「无硬界放」变拦——C104 语义变化面显式锁定，+载体变体放行）；E3 语义更新（30d+8h=主从结构救回）；A 段啾啾回归不动（8.8h≤24h 天然豁免）。precheck 消费方回归 4 套全绿（fail_retry 42/parallel 18/search_fallback 90/angle_timing 59）。
- **部署**：182 pull + 重启叙事 worker + 实验进程（直调走引擎进程内 analyzer）；CZ 票存量行不自动重析（updateIsValid→reanalyze 可翻转，观察期语义 C74/C88 同款）；live 实验（v24）重启前走持仓确认规程。

### C103 载体↔父推关系源头窗（J1.39 条件题 parent_relationship：翻译搬运/解读二手臂 + 父推>24h → timing 归 older）——「如果仅仅是翻译另一个老推文，或者解释另一个找角度推文，那么这个被翻译的/被解释的，实效性也要足够好才行（24小时内）」（2026-10-18 用户裁定；Jean Phil 0x6915bec6e90dd26d282f544c91304b0846e97777 翻译洗白案）★

- **案发现场（Jean Phil，四案同周第三起时效洗白）**：主推位=**Dexerto 原生新闻推**（145 万粉 verified，Sep 28 09:30:07Z：「AI-generated influencer Jean Phil has spawned a meme coin valued at over $8 million」，3449 赞/108 转）——**20 天老（19.89d）**；website_tweet 位=rega_sport **229 粉「热点挖掘机」中文翻译推**（token 创建前 13s，reply 到 Dexerto 原推，fixture 简化为前 2s 同形状）：把英文推逐句翻译成中文「AI 生成的虚拟爆红网红 Jean Phil…市值超 800 万美元的 meme 币」，**零新增解读**。token 创建锚=2026-10-18 06:48:37Z。Jev 判 **71.42 high（J1.36 worker 路）**：事件分 63.65=量级 27（B 档 3.04）+传播 26.65+时效 10（within_30d 0.96）压线过 60 线，+质量 7.77 → 71.42。**评级层放行**（引擎侧量纲门未满足零成交，与 BAI 案同款「零损失是碰巧」）。
- **与 C102 的形状差异（为什么 C102 拦不住）**：①**非 binance 语料**——C102 判据轴=binanceCorpus，Dexerto 新闻推不在域内；②**槽位倒置**——BAI 案父推（binancezh 活动推）挂在主推 in_reply_to，本案**主推位本身就是老源头本体**（Dexerto 原推）、洗白载体（翻译推）在 website_tweet 位、其 in_reply_to 指回 Dexerto。时效三件套全盲同款：C74 锚主推 lag（主推=Dexerto 老推本体本该拦——但 Dexerto 145 万粉 direct_tweet 豁免跳过硬拦，且 precheck 在 worker 路未构成拦截位）/ C75 只锚**主推** 30d 窗（20d<30d 漏过）/ C68 载体集「任一新即活」（website_tweet 翻译推 13s 新鲜即活）。**Jev 时效不可靠第四次实证**：within_30d 0.96 答「合法」——按题面它只见载体集合，20 天前的源头在它眼里就是 within_30d。
- **用户裁定（三臂语义，全案核心）**：「如果新的找角度推文引用某一个推文用于解释某一个现象，那么被引用的推文可以老一些（找角度推文解释一个原生推文）。但是如果仅仅是翻译另一个老推文，或者解释另一个找角度推文，那么这个被翻译的/被解释的，实效性也要足够好才行（24小时内）。」——关系判定归 Jev（语义判断，J1.16/J1.23 题面语义 Jev、阈值聚合代码侧先例），24h 窗归 mapper。
- **修复（J1.39 条件题 + `overrideStaleRelParentTiming`，jev-questions/jev-result-mapper/NarrativeAnalyzer）**：新增第 20 题（条件题，brand_hijack/name_image_consistency 同款模式）`parent_relationship` 四选：**new_angle_on_original**（载体借原生推解释现象、有自己的新解读——豁免，父推可老）/ **translation_or_repost**（跨语言逐句对应翻译/复述/搬运）/ **explains_derivative**（被回复推本身是二手解读，载体在传播二手内容）/ unclear（fail-open 不干预）。**仅 `hasReplyParent(twitterInfo)` 为真才问**（四个载体槽位——主推/website_tweet/quoted/retweeted——任一带 `in_reply_to`；state 里【回复的推文】块存在；无父推不问防幻觉作答；默认 19 题 bit-identical，开门 20 题）。mapper：choice∈{translation_or_repost, explains_derivative} ∧ 任一槽位父推 lag=`锚−in_reply_to.created_at`>**24h**（`PARENT_REL_STALE_SEC`，与 C102 同窗）→ timing 归 older；取最老父推（worst lagSec）落审计。锚=tokenCreatedAtSec‖raw_api_data.created_at（C68/C75/C102 同链）；父推时间缺失/锚缺失/答案缺失（J1.38- 旧缓存行）/unclear 全 fail-open。题面判别锚：跨语言逐句对应=翻译搬运；被回复推自己是二手解读=解读二手解读；载体有新观点且被回复推是一手=新角度解读。**版本 bump J1.38→J1.39 断代**（旧缓存行不重评）。
- **与 C102 分工（并存不合并）**：C102=binanceCorpus **无条件**（借壳行为本身即拦截依据，不看关系——币安语料的搬运/翻译/找角度全算借壳）；C103=通用语料**关系门控**（非币安语料只在翻译/二手解读臂拦，新角度解读臂放行）。两门同票并存双 override 各落审计键（`staleParentOverride`/`staleRelParentOverride`），同归 older 不冲突。**拦截机制=纯时效分数学**：本案 63.65−10（within_30d 10→older 0）=53.65<60 → 事件分不足拦（不依赖五腿/载体门接管——A 类 character_ip existing_entity 五腿结构完好，C102 的 J1.29 接管路径在本案不适用，timing 分本身就是唯一拦截位）。
- **测试**：`_test_angle_timing_override.cjs` F 段 10 断言——**事故现场反证 fixture 逐位重现 63.65 压线过**（答案=stage1_raw_output 全 17 题逐字转录，Dexerto/翻译推/in_reply_to 三层结构完整）→ translation 臂 lagSec=1718310 精确值 + timing older + **53.65<60 事件分不足翻转** + category low；new_angle 豁免臂 63.65 原样照放；explains_derivative 臂同拦（用户裁定两臂并列）；86401/86400 边界（严格 >）；槽位覆盖（父推在主推位=BAI 形状同拦——两案实证全集扫描必要性）；父推 1h 新鲜翻译关系也放（24h 窗内=「时效性足够」）；unclear fail-open；C102+C103 同票双 override 各落（BAI fixture + parent_relationship 并注）；锚缺失 fail-open；hasReplyParent 四槽位逻辑。全套 59/59；版本断言四套同步（jev_resonance D5 双形状 19/20 题、finding_recap、superip、name_image）；mapper 消费方回归 10 套全绿（同 C102 批次）；校准脚本 `jev_calibration.mjs` 镜像生产接线（`parentRelationship: hasReplyParent(twitterInfo)`）。
- **182 实测验证（定向重析，替代灭绝的校准脚本抽样——见下）**：①Jean Phil 真 corpus 重析（9c4ea98）→ Jev 答 `parent_relationship=translation_or_repost`（关系判定正确）→ `staleRelParentOverride lagSec=1718310` **与 fixture 逐位一致** → 事件分 27+26.25+0=53.25<60 拦 → **low**（传播分 26.25 vs fixture 26.65 为 dimension2 答案方差，结论同向）；②BAI → C102+C103 **双 override 并存各落**（lagSec 247835 同值）→ 五腿断 → 叙事主体无形象载体拦 → **low**；③**买线不翻验证**：近 120 行带父推且 high 的恰 1 张 EXODUS1（cz_binance 父推当天，lag<24h 结构性安全）重析维持 **high 81.73**（vs 原 81.79，正常方差）；④附带到达面证据：BDUO（cz_binance 父推 38 天）双门皆触发、原 low 结论不变（rawTiming 本就 older，override 冗余无冲突）。两案 token_narrative 原行已备份 182 `/tmp/c102-c103-case-rows-backup.json`（重析覆盖为 J1.39 快照，C100 先例；原 17 题答案已逐字转录进测试 fixture）。
- **校准脚本抽样源灭绝注记**：`jev_calibration.mjs` 的对比基线=Jev 迁移（2026-09-21）前 `stage1+stage2(X类)` 旧行，现近期 400 行全为 `jev-*` 被跳过 → **0 样本**（C80 起「跑校准」待办真跑同样空转）。本题集验证改走 C98/C100 先例定向重析（本案即上述①-④）；后续版本 bump 的「无买线翻转」验证应沿用重析对拍而非该脚本。

### C102 借壳语料父推源头窗（binanceCorpus 父推>24h → timing 归 older）——「3 天前的币安推文肯定不行，早就被人用烂了」（2026-10-18 用户裁定 24h 窗；BAI 0x11efcbd0bfbaa5ad1c2d0db93710882722a27777 案，零资金接触）★

- **案发现场（BAI，flap 税币非 BNB 盘）**：`binancezh`（币安华语，46.4 万粉）2026-10-15 12:15 UTC 发「创意广告大赛」活动推（宣传 Binance AI 等，11.9 万浏览/113 引用）→ **第一波**：帕鲁 0x7c7ae9… 10-16 12:56 蹭（语料挂同一活动推，DB 实证）→ **第二波**：zhuifei008（1.29 万粉蓝 V）10-18 09:05:10 发参赛推「币安ai 币安ai 币安ai」回复在活动推下 → **50 秒后** dev `0xb5f0…7681` 发币 BAI（09:06:00，dev 自拉 0.1499 对倒 18 分钟死票）；同分钟孪生 BAI 0x337a8c…7777 挂同一条参赛推（日志实证）。Jev 判 **78.78 high（rating=3）**：event_timing=within_7d、五腿全中（super_ip 0.94/关联正向 0.74/mem 3.2/fresh/strong_fit 0.99）→ C88 豁免 J1.29 载体门放行。引擎零信号零交易（量纲因子未满足，非叙事层拦——**评级层已放行，零损失是碰巧**）。
- **双重洗白结构（用户判断精确命中的洞）**：①**载体推洗源头年龄**——载体 lag=50s 极新鲜，源头 lag≈3d；②**参赛用户主推洗币安身份**——C97 地域子账号锚只查主推作者（zhuifei008 非 binance 前缀），binancezh 在父推位不触发。时效三件套全盲：C74 锚主推 lag+粉 1.29 万≥5000 direct_tweet 豁免跳过硬拦 / C75 只锚主推（BOB 案先例刻意排除父推）/ C68 载体集合=主推+website+quoted+retweeted 最新一条（父推刻意不在集合，载体 50s 新鲜即活）。唯一能看见父推时间戳的是 Jev 软评——仍答 within_7d 拿满时效分（Jev 时效不可靠第三次实证，C75 立案同款）。
- **用户裁定**：「如果借助的是币安的语料发币，那么 3 天前的币安推文肯定不行，早就被人用烂了」+ 选定方案 A（父推源头窗）+ 窗口 24h。交易逻辑两层：币安活动注意力半衰期小时级，24h 线外全是接力尾部（帕鲁 1 天档贴线外也拦）；lag 大本身是 dev 质量信号（实时监听币安的快枪 dev 不会 lag 3 天，翻旧推找壳的是二道贩子——本案 dev 对倒印证）。
- **修复（`overrideStaleParentTiming`，jev-result-mapper）**：判据=binanceCorpus（C97 宽判据现成：币名/主推/父推含 binance/币安）∧ 主推 `in_reply_to.created_at` 存在 ∧ 父推 lag=`锚−父推时间`>24h（`BINANCE_PARENT_STALE_SEC`）→ timing 归 older=0。**不限 tweet_type**（判据轴是「源头事件年龄」不是「载体行为」——angle/direct/unknown 载体都能挂旧源头）；与 C68/C75 可同票并存（三条 override 同归 older 不冲突，审计键各落：`staleParentOverride`{lagSec,staleSec,rawTiming}）；载体推（主推/quoted/retweeted）刻意不进判定（新载体不构成源头新鲜证据，C75 同理）；锚=tokenCreatedAtSec‖raw_api_data.created_at（C68/C75 同链，flap 行 wss_events 回退验证覆盖）；父推时间缺失/无 in_reply_to/锚缺失 fail-open。mapper-only 不 bump（C42/C75 先例：时效分本来就是代码查表）。
- **机制本质（非新拦截位）**：timing 归 older 后 −9 分（15→0 ×0.6）翻不过 60 线——真正起效的是 **C88 五腿救援第四腿（`FRESH_TIMING_C88`）断** → 五腿不成立 → 豁免失效 → **J1.29 载体门接管拦截**（D 类 + no_visual_entity，`blockReason=叙事主体无形象载体`；C96 F→E 改道后载体门接管同款结构）。即：把真实源头年龄喂进 timing，让既有豁免链如实消费——C88 预留的「事件新鲜」腿第一次被代码 override 驱动。
- **测试**：`_test_angle_timing_override.cjs` E 段 15 断言——**事故现场反证 fixture 逐位重现 78.78 high**（答案=stage1_raw_output 全 17 题逐字抄录，父推换新鲜臂=门上线前形态）→ 父推 3d 臂 lagSec=247835 精确值 + C75 不触（主推 50s——载体洗白路径正是事故根因）+ 载体门接管拦截；帕鲁贴线形状 88835s；86400/86401 边界；非借壳语料同形状 bit-identical；父推时间/无 in_reply_to/锚缺失三 fail-open；载体（主推+quoted）新鲜不救；angle 同形状也拦（C68 窗内不双拦）；C75+C102 并存双 override 各落（495d 主推+25h 父推）；C4 源码口径锁（窗常量+in_reply_to 判定轴+函数签名）。全套 46/46；mapper 消费方回归 10 套全绿（jev_resonance/finding_recap/regional_anchor/brand_hijack/name_image/subject_carrier/referent_memeability/cashtag_w/publisher_proxy；`_test_jev_product_entity` 2 存量失败为 C101 遗留——题集 17→19 计数断言未更新+平台官方源豁免接线断言，stash 反证与本案无关）。
- **部署语义**：182 worker + v23 实验进程重启后生效（与 C94/C98/C99/C101 同批待办；重启 v23 前按规程确认持仓）。存量影响面不扫（C99 裁定沿用：修复方向=拦截向）。

### C101 OK❌ t.me URL 假 addressVerified + 推文语料 web3ip 双洞修复——「网址里头有CA不算命中CA」「web3_native_ip_early 仅限于账号」（2026-10-18 用户裁定；OK❌ 0x0195119e4806441c871adada6256296265ed7777 案，flap 税币净 -12.75%）★

- **案发现场（OK❌/何必东奔西走欧易啥也没有）**：flap 盘 2026-10-18 08:22:45 创建（税币），语料=推文 @Notickernowif（509 粉快照/落库 state 实为 0 粉 3 推、简介「404」、找角度作业号——近推全为热点梗转述）08:22:32 早创建 13s，文本「何必东奔西走，欧易啥也没有=OK❌」**无 CA**；token metadata URLs 含本币 CA：`t.me/#0x0195…` + CMC dex 自动页 → 08:22:55 买 0.004 BNB（mcap $4.2K）→ 08:25:33 P4 清仓 **-12.75%**。**孪生票对照**：欧抑 0xe8d526c4…7777（同梗「尽管东奔西走 欧易全部没有」、同窗口、不同账号）走标准路径 jev-J1.36 rating=1 low 拦住——同梗双票两种结局，路由形状是唯一差异。
- **伪造链还原（prestage state 实证）**：`isProjectCoin` classifiedUrls URL 臂命中（t.me 不在 C99 聚合器清单内；CMC 自动页 pre-C99 算独立站→账号链收集 relatedAccounts）→ 路由进 prestage + `skipAddressValidation=true` → `performRulesValidation` skip 分支直接返回 `addressVerified: true`（stage='project_coin_website_verified'——**账号简介/推文压根没验，唯一伪造位**；state 6734 字中全地址仅出现 1 次且位于 [TOKEN] 元数据段，[ACCOUNT] 简介「404」、6 推零 CA、无 [WEBSITE] 段=websiteFetch 默认关内容臂也不可能命中→URL 臂是唯一命中源）→ prestage token_type 二分（P1.10 无名字质量门）→ web3_native_ip_early 0.96 → 粉丝带 0-299 → mid=rating 2 → GMGN 过（创作者首币 issuerTokenCount=0，C85 连发门拦不住首犯）→ 买。
- **用户裁定三连**：①「web3_native_ip_early 仅限于账号」「这不是账号，这就是个推文」「这个也需要修」②「把假 addressVerified 给修了」③「说白了网址里头有CA不算命中CA」。
- **修复一（假 addressVerified 断源）**：`isProjectCoin` 加 `options.includeUrlArm`（默认 true=路由/账号补充收集等存量消费点全语义零变化；false=强证据模式——只认内容臂：推文文本/回复/引用/website_tweet/账号简介/网站正文）；`NarrativeAnalyzer` 的 `skipAddressValidation` 证据源换 `isProjectCoinContentVerified`（强证据模式）`|| issuerCaTimeline`；URL 臂独命中时打点观测。**修复后 OK❌ 形状走向**：URL 臂仍路由进 prestage（存量语义），真实验证 0 粉 3 推质量不达标 + 简介推文零 CA → stage='address' → low（fail-closed，零 Jev 配额）；质量达标账号无 CA 宣告 → account_quality_no_address → abm 两条件（addressVerified=false 不伪造）；skip 分支保留给真强证据（issuerCa 宣告/网站内容公示，C35 语义）。
- **修复二（web3ip 仅限账号语料）**：`mapPrestageAnswers` 加 `corpusType`（fetchResults.twitterInfo.type 透传）——`'tweet'` 时 web3_native_ip_early 答案**不采信**，回落 abm 双条件评定（两题恒带已答零额外调用；abm 评定块提取 `evaluateAbmAnswers` 两路共用 bit 一致）；'account'/'community'/缺省 null 放行（存量调用零影响）；project 答案不受限（仅 web3ip）；`jevDetails.web3ipRejectedCorpusType='tweet'` 观测键；parsed_output.addressVerified 事实保留 true。**两道防线独立**：修复一断源后 OK❌ 死在规则验证；修复二兜住「真宣告推文含 CA 的找角度票」（addressVerified=true 合法但语料是推文）不得按 web3ip 定档。
- **版本**：P1.10→**P1.11**（题面未动——mapper 采信语义变化，P1.3 先例「聚合语义变化须可按版本筛历史行」；同 token 两版本下推文语料票的类型判定不可直接比较）。修复一是路由级不 bump（C99 先例）。
- **测试**：`_test_isproject_coin_url_not_ca_hit.cjs` 19 断言（OK❌ 现场反证 includeUrlArm 双模式/内容臂六臂保留/C99 聚合臂兼容留/performRulesValidation 三通道真值表含对照组 skip=true 强证据通道保留/源码口径锁防 skip 退回 `isProjectCoinResult`）；`_test_prestage_web3ip_account_only.cjs` 17 断言（OK❌ 反证回落 abm low/abm 双过 mid/账号社区语料回归/缺省 null 放行/project 不受限/观测键/promptType P1.11/corpusType 透传源码锁）。回归全绿：C99 37、unrated_elimination 32、prestage_downgrade 29（版本断言随 bump 更新）、issuer_ca 15、account_ttl 53、corpus_invalidation 20、middle_parallel 22。
- **部署语义**：182 worker + v23 实验进程（b07fbe84）重启后生效（与 C94/C98/C99/C100 同批待办；重启 v23 前按规程确认持仓）。存量影响面沿用 C99 裁定不扫（修复方向=拦截向，功能无 bug 即可）。

### C100 弹跳猫法国骚乱同事件「语料零暴力词」J1.38 补丁未翻转——接受边界不修结案（2026-10-18 用户裁定原话「那就先不修了」；chat rebondit 0xed389dfed0568f07b71ff678b92da1c052957777 案）★

- **案发现场（chat rebondit/弹跳猫）**：fourmeme 盘 name「chat rebondit」，C98 影响面扫描 A 组法国骚乱同事件 16 票之一（清单里的「弹跳猫」）。语料形状：主推 @NVTH_LE_GUIGNOL（509 粉）正文仅「⬇️⬆️」箭头挂图，回复挂 **7 月 20 日（89 天前）**阿维尼翁抗议标语照片（肥猫梗图拼贴法语口号「ON N'ARRETE PAS UN PEUPLE QUI REBONDIT」，vision 判黑色幽默拼贴）；第二推 @coffeesippa1（14 粉）「all the images say rebondit?」回复 @PetalSoI（3,080 粉，Oct 17）转述「bounce cat 成为法国反叛象征、贴满巴黎街头、best meme to come from the **riots**、OFFICIAL MEME OF THE REBELLION」——全篇玩梗庆祝语气。主推 6,711 赞/495 转 → direct_tweet 豁免跳过时效硬拦。
- **两层未拦事实**：①08:12 实跑（v23 b07fbe84 live 进程内 **J1.36**，round 1 rating=3 / 9.2s，轮次表留痕）→ 08:13:13 实盘买入 0.004 BNB → 08:13:39 全清 0.0036497 BNB = **-8.76%**（未计 gas）——C98 部署语义「182 worker+v23 重启后生效」，进程未重启=补丁当时未上场；②13:22 182 最新代码（4a0568b）`reanalyze-tokens.mjs` 重析，**J1.38 题面实载**（行 prompt_version=jev-J1.38）→ **negative_hard_news 仅 0.13（argmax=none 0.73）→ 仍 high 73.83 / E 类**（事件分 63.8=22 C 档+26.8 传播+15 时效；关联 20 exact_match；质量 15.55）——题面层也有缺口。
- **根因（粉红豹翻得动、弹跳猫翻不动）**：J1.38 臂①锚「抗议/示威/罢工**演变为**打砸抢烧/骚乱/纵火」的演变词——粉红豹语料显式写了（「示威演变为打砸抢烧，143 年市政厅被纵火焚毁」）0.22→0.97；弹跳猫语料**通篇零暴力字眼**，唯一 riot 语境在第二推父推且为玩梗庆祝语气。臂③「形象被当作抗议象征传播时热度来自现实暴力苦难」预设 Jev 已确认底层是政治暴力——语料层无暴力证据 + 语料自述热度来自梗图传播（CG2.0 采信陈述原则同向），Jev 按反向窄边界（和平政治玩梗不选）处理。**底层事件事实层面与粉红豹同一场法国骚乱——「语料没写暴力」与「CG2.0 采信推文陈述」两原则在本形状顶牛，此张力即不修裁定所接受**。
- **裁定（「那就先不修了」）**：接受「语料不提暴力就放行」为边界（CG2.0 一致性优先），臂③措辞不扩。曾评估的扩法留档备重启：「梗/形象被张贴上街、成为抗议/反叛的官方象征」本身即臂触发（不要求语料含暴力演变词），误伤面须验 Ants 形状（辞职抗议、无上街张贴象征）不中。
- **C98 遗留修正**：C98「A 组 7 票骚乱 high 为正向翻转目标」的预期对本票**证伪**——J1.38 下弹跳猫不翻转；C98 定向重放 4 票验证集（粉红豹/Piccolo/Ants/Pepé）不含本票，其余 5 票翻转目标未逐一验证，维持 C98「存量行不批量失效」处置不变。
- **部署语义**：零代码改动、零版本 bump、零单测（纯调查结案）。重析已把本案 token_narrative 行覆盖为 J1.38 快照（原 J1.36 详细答案被覆盖，轮次表 rating=3 留痕）；182 代码已拉到 4a0568b（worker/v23 重启仍为既有待办，与本案无关）。**复查条件**：「梗图上街成为抗议/反叛象征」形状再现且连续亏损时重启臂③扩展调查，本条为完整出发点。

### C99 CMC dex 自动页 URL 假阳性「项目币验证」短路小号地址门——传奇蝴蝶 prestage mid 过审案（2026-10-18 用户裁定「修复吧」；传奇蝴蝶/群1109951764干1千倍 0x62f829bae9f387ae399ccd0c45a1360e61857777 案）★

- **案发现场（传奇蝴蝶）**：flap 盘，name「群1109951764干1千倍」（TG 群号喊单盘），twitterUrl=@AEIXGysp3s61796（64 粉/4 推小号，简介「新征程，新起途。」），token_create 自带 webUrl=`dex.coinmarketcap.com/token/bsc/0x62F8…7777`（**CMC dex 自动聚合页，任何 BSC 币的 URL 都长这样，路径天然含本币 CA**）。v23（b07fbe84 live）07:21 prestage `web3_native_ip_early` 0.98 + 粉丝 64 定档 **mid=rating 2** → 买腿 `narrativeRating == 2` 过审买入，07:25 卖出。
- **放行链还原（addressVerified=true 假阳性）**：①`isProjectCoin`（narrative-utils.mjs）最后一臂「classifiedUrls 任意 URL 含本币地址 → 项目币」——CMC 页 URL 机械命中 → `isProjectCoin=true`；②`NarrativeAnalyzer` 传 `skipAddressValidation: isProjectCoinResult` → `performRulesValidation` 走 `project_coin_website_verified` 分支**直接 `passed=true, addressVerified=true`，addressLocations=['website_content']——账号简介/推文压根没验**（该分支注释语义是「网站内容验证过地址」，实际只是 URL 字符串含地址）；③`addressVerified=true` → prestage token_type 二分（跳过 abm 两条件判定）；④Jev 的 state 只有 431 字符——**无 [POSTS] 段，4 条推文一条没进视野**，只有名字「群号干1千倍」+64 粉+无认证 → 判「币本身即 IP」社区 meme 档 0.98（P1.10 题面明说「账号随币而生不算反信号」——垃圾盘名字恰好完美匹配该档语义，Jev 没判错，是上游喂的证据就烂）；⑤粉丝带只定档不拦截 → mid。**若没有这个洞**：64 粉/4 推不满足质量阈值（500粉+20推/1000粉+认证/3000粉）→ 走「质量不达标时地址验证为强制门」→ 简介/推文找不到 CA → `stage='address'` 直接拒——洞把小号强制门整个短路了。
- **修复（用户裁定「修复吧」，2026-10-18）**：`narrative-utils.mjs` 新增 `AUTO_TOKEN_PAGE_DOMAINS` 清单（coinmarketcap/coingecko/dexscreener/geckoterminal/dextools/birdeye/ave.ai/avedex/gmgn/photon/bullx/bogged/pancakeswap/uniswap/jupiter/raydium/four.meme/flap.sh/pump.fun/moonshot，含子域匹配，导出 `isAutoTokenPageUrl()`）——**聚合器自动页面对任意代币机械存在，不构成「项目方在自有渠道公示 CA」的证据**。接线三处：`isProjectCoin` 的 websiteInfo content/rawHtml 臂（websiteInfo.url 为聚合器则不采信）+ classifiedUrls URL 臂（过滤聚合器 URL）；`hasIndependentWebsite`（CMC dex 页不再算「独立网站」→ 不再触发 relatedAccounts 收集与 `isProjectCoinResult && relatedAccounts` 路由）。**刻意不动**：推文文本/引用/第二推文/账号简介宣告臂（发行方亲手贴的仍是证据）；websiteInfo 无 url 字段时维持原信任（无域名可判）；material-id-extractor 的 `NON_STANDALONE_DOMAINS` 刻意不合并（用途不同——那边含搜索引擎/短链，演化方向不同；那边缺 CMC 属独立小遗漏，非本事故链路）。**语义变化点**：质量达标大号（≥500粉）+ 仅 CMC URL 时，从 `addressVerified=true`（token_type 二分）变为 `account_quality_no_address`（abm 两条件交 Jev）——聚合器页不再送归属证明，方向收紧。
- **断言**：新单测 `_test_isproject_coin_aggregator_urls.cjs` 37 断言全绿——事故现场反证（本案 classified_urls 原样+账号原样 → false + performRulesValidation `passed=false stage='address'`）、清单域名逐个、冒充子域前缀不误伤（cmdexscreener.example.com）、不误杀臂（独立站 URL/内容、推文宣告、bio 宣告、websiteInfo 无 url）、hasIndependentWebsite 存量行为锁定（linktr.ee/独立站）、真宣告仍过（小号推文 CA+名字匹配 → `stage='passed'`）。相邻回归：`_test_website_fetch_removal` 14、`_test_issuer_ca_detection` 15、`_test_narrative_middle_parallel` 22、`_test_prestage_project_downgrade` 29 全绿（`_test_narrator_two_shapes` 20/2 失败为存量失败，stash 复跑证实与本题无关——jev-questions 题面 B9/C2 断言滞后）。
- **存量影响面**：**不扫（2026-10-18 用户裁定「这个不用判影响面了，作为功能只要没 bug 就行」）**——存量行是已消费结论，修复只管新分析走对路径；扫描脚本 `scripts/scan-aggregator-url-prestage.cjs` 入库备查（真要复盘时可用，判据近似、命中行需人工复核）。
- **部署语义**：mapper 零改动、无题面变化（不 bump 版本）；182 worker + v23 实验进程重启后生效（重启 v23 前按规程确认持仓）；本案 token_narrative 行不手工失效（重析自然走新路径）。

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
| J1.86 | 2026-10-21 | **C143 校准（题面锚点，桶集/判据结构不变）**：①含品牌名的陈述句/短语（币安上电视/バイナンス人生/币安游戏）判 `not_entity`，不选 accepted/unknown/brand_mismatch；②官方品牌事件的具体产物/符号（币安官方菠萝→「币安菠萝」）不选 brand_mismatch | C143 校准（182 定向重析 9 票：8 PASS/1 FAIL——C96 entity accepted 0.53/not_entity 0.24 致 low→high 回归；C110 brand_mismatch 0.49 阈值边缘） | 本 commit |
| J1.85 | 2026-10-21 | **品牌劫持并入实体轴**：`name_brand_hijack` 条件题整题退役（题/概率审计键/问出闸全删）；`web3_user_name_entity_acceptance` **关键词票**新增第六桶 `brand_mismatch`（品牌劫持/概念扩大，优先于 accepted；非关键词票保持五桶原形）；mapper `brandMismatchP`=实体题 brand_mismatch 概率（keyword 预检同时作题集/门开关），`punExempt`/Stage3 品牌劫持臂改吃它，`brandHijackP` 审计键改名（历史行保留展示）。基础题仍 11 | C143（用户裁定「C」；J1.79 123 条 brand 题/39 条 P≥0.5、品牌门拦截 0；33/39 brand-high relevance>10；历史可解析 48 条品牌拦截 relevance 全 ≤10） | 本 commit |
| J1.84 | 2026-10-21 | **W 数学双轴合并为单轴**：`w_product_score`（0-35）整题退役（`W_PRODUCT_BANDS`/`scoringResult.wProductScore`/概率审计键全删；旧行残留键忽略、历史展示保留）；`w_bsc_user_appeal` 0-40→0-75（四带 [0,18]/[19,37]/[38,56]/[57,75]，语义档位不变）；W 数学 = 吸引力+时效，pass 60→57（J1.79 141 张 W 票校准：60→1、57→4=保持旧 top4、56→6、55→7、50→11）。题数 12→11 | C142（用户裁定「方案A」；J1.79 W 票 Spearman 0.847/R² 0.711/独立方差 ~9.6%；product 系统性高 0.28 带；旧 J1.55 product+交互 Spearman 0.231 对照） | 本 commit |
| J1.79 | 2026-10-20 | **事件层收敛为 Web3 用户口味契合（事件分=fit 质量）**：删除 `web3_user_event_impact`（14→13 题）；`eventCompositeScore = round2(min(1, strong_fit+fit)×100)`（pass 60）；`influenceScore = likedMass×5` 供量级锚/豁免/审计（不再有独立影响力题）；旧源 override -18→封顶 30；E 类感染力折损/unfit≥0.5 负门/五臂过滤（叙事存在性、名字 Symbol、拼写 C78、载体 J1.29+J1.78、实体 J1.56）保留；J1.78 动作/趋势名规则保留，J1.75-J1.77 影响力口径迭代被本版取代 | C135（用户裁定「事件分改用 fit」；案源 = 交易猫 C109a/돼지 H C130/DND C114 分数面） | e2bf2f3 |
| J1.70 | 2026-10-20 | **审计键/局部变量语义化（零判据零行为）**：用户指令「mapper 变量能否直接使用名字？」「现在还有 stage2 吗？stage2Total 还有存在价值吗？」——①局部变量：`stage2Total`→`eventCompositeScore`、`tierScore`→`impactTierScore`、`effSpread`→`spreadScore`、`spread`→`rawSpreadScore`、`timeliness`→`timingScore`、加权事件分 `eventScore`→`weightedEventScore`、`stage2Blocked`→`eventScoreBlocked`、`stage2Reason`→`eventScoreReason`、`stage2BlockReason`→`gateBlockReason` ②审计键：`scoringResult.totalScore`→`eventCompositeScore`、`scoringResult.tierScore`→`impactTierScore`、`scoringResult.timeliness`→`timingScore`；`stage_final.details.stage2TotalScore`→`eventCompositeScore`、`eventScore`→`weightedEventScore` ③前端/扫描工具双键读（新键优先、旧键=历史行兼容）④UI 文案对齐（「事件分」=合成分、「事件加权分」=×0.6 项）。**不是新题、不是新门**——「事件分」= `impactTierScore + spreadScore + timingScore` 的合成分；stage2 作为阶段已不存在（J1 单次 Jev 调用，stage1/stage2/stage_final 只是逻辑信封） | C130 同族收尾（用户问询） | 本 commit |
| J1.69 | 2026-10-20 | **名字门判定对象收敛为链上 Symbol（币名）**：`web3_user_name_acceptability` 从「代币 Name/Symbol 取更完整的一个」改为**只判链上 Symbol（ticker）**，Name（全名/描述句）不作判据；判据内容一字不动，只改判谁。范围只名字门（实体/载体/关联/名图/prestage 仍 Symbol+Name） | C130（用户裁定「币名应该看 Symbol」；돼지 H 按电影全名被陈述句误拦） | 495fd69 |
| P1.13 | 2026-10-20 | **prestage_abm_name_link 用户感知锚（四档/choice 键/二值消费不变）**：instructions 加「按 web3 用户视角判——只看币名会不会自然联想到该账号/人物」；exact/abbreviation/semantic 三档 label 加「web3 用户会立即/自然联想到」；none 档改「web3 用户不会自然联想到该账号/人物」 | C125（用户视角批次 3；消费位仅 nameLink≠none 二值，最小改法） | 2f83a35 |
| J1.55 | 2026-10-20 | **name_referent super_ip 圈内符号级锚**：super_ip 主定义从「世界级名人/顶级机构/全球IP/国民级人物」切「web3 用户普遍**认作符号**（被拿名字/形象/绰号玩梗、当标签当口号）的证据级」；大众量级不要求、纯大众知名但圈内不认作符号不升档；「只判身份量级、不评玩味」显式化；J1.18 发布者指代分支/三前提/原话词/官方产出物口号/配图形象臂（J1.43）全部保留；other_referent ① 承接句同步「知名但非符号级」。mapper 零改动（choice 键名不变）；行为边界移动=预期（C88 五腿/骑乘改道/标签分布） | C124（用户裁定「被当符号使用 vs 听说过」） | 24982b4 |
| J1.54 | 2026-10-20 | **门名/题键语义化（判据零改动）**：用户指令「其它门的名字也请梳理下，以类似思路，做一下调整」——①题键 event_magnitude → `web3_user_impact`（J1.50/J1.51 起主轴已是 Web3 用户被影响程度）②题键 dimension2 → `web3_user_spread`（占位名；语义=用户侧传播面）③门函数 notMemeNameBlock→web3UserAcceptabilityBlock / nameFormChoice→web3UserAcceptabilityChoice / NOT_MEME_NAME_CHOICES→WEB3_USER_NOT_ACCEPTABLE_CHOICES / web3FitBlock→web3UnfitBlock / rideDetourBelow→rideDetourMass ④审计键 jevImpactTier+effectiveImpactTier / effectiveTiming / anchoredTier / web3FitAnchoredTier / web3FitStrongPAnchored / blockChoiceProbability / web3FitMass→web3UnfitMass / resonance*→web3FitDamp* / instagramDim2Anchor→instagramSpreadAnchor / web3FitDim2Anchor→web3FitSpreadAnchor / scoringResult.dimension2→spreadScore / jevDetails.{tier,timing,dim2}→{impactTier,effectiveTiming,spread} ⑤label ip_reuse→IP低质复用、感染力折损→Web3偏好折损。mapper answers 双键读（scan 工具读历史行）+ 前端旧键回退 | C123（门名语义梳理） | 8d63253 |
| J1.53 | 2026-10-20 | **门名断代（零行为意图）**：用户裁定「name_form/niche_subculture 等门的名字都改一下，现在表达的含义是『Web3 用户接纳度』/『Web3 用户圈层可达性』」——①题键 name_form → `web3_user_acceptability`（判据/三态键不动）②block_reason 桶键 niche_subculture → `web3_circle_reachability`（J1.52 判据不动）。mapper 双键读（新键优先、旧键=存量缓存行兼容）、审计键 nameForm/nameFormBlock → web3UserAcceptability/web3UserAcceptabilityBlock、概率键跟随题键；BLOCK_SCOPE/LABELS 新旧并存；名字门 label→「Web3 用户不接纳该名字（用户接纳度门）」、圈层桶 label→「Web3 用户圈层可达性不足」 | C122（niche 合并问询的数据裁定：不合并=不把 A 域拦截扩到全类别） | 0016126 |
| J1.52 | 2026-10-20 | 用户视角批次一（两处正交）：①`w_product_score` 主轴切 web3 用户关注与兴奋度（客观创新性降参考锚+显式否定「发布后实测数据」读法；四带形态结构词刻意保留保 C42 `wNewProductP=1−P(0)−P(1)` 带结构；mapper 零改动）②`block_reason.niche_subculture` 判据从「圈外人无法理解/无出圈可能」切「web3 用户接不接得住」（认知可达性；crypto 圈内梗≠小圈子；品牌营销物料/官方周边/活动噱头不是社区梗——无实质内容仍归营销噱头；BLOCK_SCOPE ['A'] 不动）。批内修正见 C121（C110 币安菠萝 A/B 归因） | C121 用户裁定「只有切换 web3 用户视角，从用户需求角度出发…效果才能好」；182 前置扫描 niche 35 行全 event:A 活桶→改锚不退役 | 4546bd8 + 0f9ad8b |
| P1.11 | 2026-10-18 | **题面零改动；mapper 采信语义变化（P1.3 先例 bump）**：`mapPrestageAnswers` 新增 `corpusType`（fetchResults.twitterInfo.type 透传）——'tweet'（挂链语料是一条推文）时 web3_native_ip_early 答案不采信，回落 abm 双条件评定（两题恒带已答零额外调用，`evaluateAbmAnswers` 提取共用）；'account'/'community'/缺省 null 放行；project 不受限；`jevDetails.web3ipRejectedCorpusType` 观测键；同日配套修复一（isProjectCoin includeUrlArm——URL 含 CA 不算命中 CA，skipAddressValidation 证据源换内容臂强证据，路由级不 bump，C99 先例）。同 token 两版本下推文语料票的类型判定不可直接比较 | C101 OK❌ 案 0x0195119e…7777（用户裁定「web3_native_ip_early 仅限于账号」「这不是账号，这就是个推文」「说白了网址里头有CA不算命中CA」；找角度推文宣告+t.me/#CA 伪造 addressVerified → web3ip 0.96 mid → 买 -12.75%；孪生票欧抑同梗标准路径 low 对照） | 本 commit |
| J1.32 | 2026-10-17 | **题面零改动；变更在 state 输入形状**——superIP 注册表命中票改走标准路径全量 18 题（快车道删除），state PRECOMPUTED 注入 `super_ip_hit` 认证事实行（name/type/tier/desc，格式与快车道时代一致）+ `super_ip_note` 反混淆提示行（作者身份认证≠代币背书，关联/主体资格/量级仍归题集逐题判定）；preScores 预分行删除（评分归 Jev）；非 superIP 票 state 逐字节 bit-parity（单测 A5 红线）；新行评级与 J1.31 前不可比按 prompt_version 过滤 | C83 BI 簇案（bbbe2561 体检：快车道「引用即 IP」6 票引用同一 binance 推文全拿 S 级 84-86 high 全亏，10 票 9 亏净 -0.0085 BNB 占总亏 21%；量级被预分喂饱+reason 不落库；用户裁定 registry 进 state 评分归 Jev） | 本 commit |
| J1.31 | 2026-10-16 | 新增第 18 题 `event_resonance`（事件情绪感染力 choice 三档：strong_reaction 强感染 / mild_amusement 轻度有趣 / indifferent 无感）**恒带**；题面锚定 BSC meme 买家立场的情绪行动性（主动讨论/玩梗/二创/站队/参与冲动），与 web3_fit 分工=静态口味 vs 动态感染，圈外传播量级明确排除（另有题评）；mapper 标准数学分支 E 类系数折损：`category==='E'` 且系数<1 时 `stage2Total=(tierScore+effDim2)×coef+timeliness`（时效不折），strong ×1 bit-identical；mild 0.5/indifferent 0.25 数学上拦死全部档位（max 49.5<60）但刻意保留系数形式（梯度可观察+阈值校准留口）；旧缓存行缺答案 fail-open 不折；superIP 快车道不消费；审计 `jev.eventResonance` 恒落/`jev.resonanceDamp {resonance,coef}` 命中才落/`probabilities.event_resonance`；历史窗口回测前置失效 `scripts/narrative/invalidate-resonance-window.cjs`；单测 `node scripts/_test_jev_resonance.cjs`（14 断言；fixture 坑=quality 原始分需从 DB breakdown 反解 bandInterpolate） | C80 蝙蝠侠摇案 0x4547dae7…7777（用户裁定「对时事现象热度，其实也应该度量事件对Web3用户的情绪感染力」；E 类 70.68→75.68 high 买入 31s -12.4%，无形象纯现象+抖音搜索页截图+105 粉宣告者；折损后 mild 42.84/indifferent 28.92 双拦） | 本 commit |
| G1.2 | 2026-10-21 | **vision 前置门判据校准**：sufficient 要求「文本独立讲清叙事」（读者看图前不会问『这是什么』）；need_image 新增裸口号/官方措辞无上下文臂（只断言/引用口号、只重复币名、只给链接/二维码/下载页）；G1.2 补充分侧反锚——文本已讲清热点 meme（名字/来源/二创）时附视频/截图只是佐证，不得仅因「看视频」/附图判 need_image。判定/概率门/接线零改动；版本 G1.0→G1.1→G1.2；单测 `_test_vision_gate`（37 断言） | C158 智能时代 0xd633b60f…7777（用户裁定「文本已陈述清楚就无需验证，叙事无法单独从文本搞明白才走图片流程」；G1.0 把短句「币安官方称之为智能时代」判 sufficient 跳过 vision→载体门拦死；G1.1 误伤 C79 偷窥狂→G1.2 反锚校准） | 本 commit |
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
