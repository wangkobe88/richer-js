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
  版本规则=改题必 bump（现 J1.109 / P1.14），DB prompt_version 可按版本筛历史
- **现役拦截门链**（mapper 端，C180 时点）：蓝筹去重门 C168（首臂：name_exact 撞 b: 域蓝筹拦 low；
  条目级 dedupExempt + 新陈述豁免 C173）→ web3UnfitBlock（unfit≥0.5）→ web3FitMassBlock C141
  （sf+fit<0.5 全域拦）→ quality_veto argmax（empty_content/baseless/ip_reuse 三桶；图证在场豁免
  C114）→ wrong_entity C139（**名字轴唯一存留拦截位**，全域）→ 量级门 D/E 档臂 → W 数学
  （appeal 单轴 pass 32；三档 Choice 15/47/66 C177）/标准数学（eventCompositeScore≥60）→
  Stage3 三截断（关联≤10/拼写 C78/关联性不足）
- **C180 纯观察化**：nameEntityLowBlock（unknown 实体低影响力）/web3UserAcceptabilityBlock（词句
  接纳度）两臂退役拦截、题目照问、判定值照算落档（nameEntityLowMass / web3UserAcceptabilityBlock.choice），
  供「有用部分迁移到其它锚」；50 张被拦票收回归集 C180-C229 观察票待逐张裁定
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

### C187 词句题三因素重构——梗/口号 meme 的接纳判据理顺（J1.116）

- **裁定（2026-10-24，用户原话）**：「当前我们判断的是『币名是不是 BSC 链用户能接受的 meme 币名字』，但应该是：1. 事件是非常具体的事件 → 走实体题（事件核心实体作名）；2. 事件是『谁谁说了一个梗、一个口号』→ ①喊口号的人必须具备强影响力（否则代币完全无来由，普通用户喊的口号恐怕不行）②口号本身要有感染力（『you are still early』有感染力、『我要去滑雪』毫无感染力）③名字可以被接纳为 meme 币名字（原主要判断逻辑）。梗 meme 不同于其它，不是只判 token 层面，要综合更广泛因素——本质仍是 BSC 链用户能不能接纳它作为一个 meme 币。」追裁①：「CRO 对照锚删掉——Chief Risk Officer 是玩梗呢，可以接受」（C114 判例翻案）。追裁②（路由）：「某些人强调/提及/陈述了某一个实体（heyi.ai 是个域名、何一发了它）→ 走实体臂，实体臂不接受（判 not_entity）再过 phrase 臂」。
- **fix 的冲突与重复（题面级）**：①影响力两臂方向打架——J1.66/C126「高影响力主体说的词」当**加分臂** vs J1.80/C138 超IP来源极端否证**反向放宽**拦截（保护票），皆非「门槛」；新框架=①有来由门槛（普通用户喊的口号完全无来由，不能接纳）②J1.61 可玩臂与 C116 姿态臂重复判同一件事 → 并入②有感染力③原单一「名字形态」判据保留为③。J1.80 极端否证段+J1.94 官方措辞引用臂并入①（官方措辞=强影响力主体产出，采信陈述原则保留）；heyi.ai 形状在新逻辑①自然过门，不再需要反向放宽。
- **CRO 翻案**：C114「机构职位/品牌内部缩写不合格」半边退役（币安员工工牌 CHIEF RISK OFFICER=玩梗可接受），DND 正样本（通用梗缩写）保留、缩写分界句随之退役；防复活反证入 empty_content_img_exempt H5/H7。
- **路由确认**：具体事件→实体题（not_entity 才进本题，已有结构）；「强调/提及/陈述实体」（域名/代称/缩写指代形）→ 题面补路由句先实体臂、实体臂不接受才落本题、实体臂拦截不经过本题。
- **改动面（commit b259084）**：jev-questions.mjs 词句题 instructions/criteria 重写（三因素缺一不可+对照锚 Early/我要去滑雪/DND/只是一只猫/币安上电视）+J1.115→J1.116；**choice 三态键不动，mapper 零改动**（C180 后纯观察落档——本题重构暂不恢复拦截，恢复与否待对拍后裁定）。
- **单测**：七文件全绿——name_entity_acceptance 47P（D5 版本 J1.116）/empty_content_img_exempt 34P（H4-H7 CRO 翻案反证+H5/H7 切片=词句题题面本体防注释史实误伤）/jev_question_consolidation 90P（A10d 版本链）/angle_timing 47P（C5 版本链）/jev_finding_recap 106P（A7-A17 七断言适配三因素形态+A17 补实体臂路由句）/subject_carrier 30P/notable_other_exit 22P/jev_product_entity 38P。
- **对拍（定向重析，梗/口号家族八票）**：C114 DND `0x4dbcb10e68626b6f663bd596905d41cdc6b07777`（正样本：官方主体+通用梗缩写）/C126 こんにちは `0xf0ffa405a08a3abd1de1b2d88fdec7cbd9f37777`（何一原话=①门槛满足）/C138 heyi.ai `0x1774c0cc851a777c89fb0e1d73712bc7564b7777`（实体臂优先路由形状）/C96 币安上电视 `0xc6d089d749409f7646de440d637ac9db0e047777`（事件陈述）/C204 4人生 `0x019fb31a221d6efb103ba35942702918abd37777`/C217 中 `0x241d8a0c687e5c901f47fcc3fa05d4def3257777`/C219 🌮🦆🎩 `0x9714e14b046aebc11aef79d1f5d9a0dbe167ffff`（TrustWallet 官方点名）/C196 PHP `0x5f6de4cd7bd63d1033b2f8417cb640951f727777`（Flap 否认句）。**终态：待跑**（题面在 worker 进程内，部署 b259084 重启 worker 后重析；本题纯观察=评级不应因本题变化，看新答案分布+意外漂移）。

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
