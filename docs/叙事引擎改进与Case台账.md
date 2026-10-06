# 叙事引擎改进与 Case 台账（卷二）

> **卷一已归档**：2026-09-20 ~ 2026-10-01 全部记录（C1-C35 / J1.8-J1.22 / P1.2-P1.7 /
> §四 系统级改进时间线 / §五 策略侧应用 E1-E5e2/V2-V4）见
> `docs/叙事引擎改进与Case台账-卷一归档.md`——历史版本详情、已解决事项、
> 各 case 完整排查过程都在卷一，本卷只续新记录与活跟踪项。
> 分工原则（多 Case 反复验证）：**LLM 管叙事价值判断，代码管市场事实**——凡是市场事实
> （谁先发、涨了多少、有没有同名）一律代码侧判定，不指望 LLM。
> 写作纪律（C35 确立）：case dump 一律 jq/node 抽窄字段，不整读（防 autocompact thrashing）。

---

## 一、现行架构一屏（2026-10-01 时点）

```
Token URL → URL 分类（含 IPFS metadata 解包 + GMGN 社媒补源）→ 数据抓取 → Pre-Check（纯规则，无 LLM）
                                   ├─ account/community token / 发行方自发宣告（字面法+CA 时间线）→ prestage Jev（P1.9，5 题）
                                   ├─ super-IP 账号 → 快速通道（标准题集 + 代码预评分 + referent_memeability 条件题）
                                   └─ 标准路径 → 单次 Jev 调用（J1.25：13 常驻题 + web3_fit 第 14 题
                                      + brand_hijack / referent_memeability 条件携带）
分类/量级/时机/阻断/W类/关联性/质量/Web3偏好 原子化同问；聚合/阈值/截断全部代码端（jev-result-mapper）
```

- **Jev**（TypeSafe System One，api.typesafe.ai）：结构化决策模型（Choice/Score/Noul 三原语），
  无文本生成，单 token 一次投机性 fan-out 调用（秒级）
- **版本规则**：改任何题的 instructions/criteria 必须 bump `JEV_QUESTIONS_VERSION`（现 J1.25）/
  `JEV_PRESTAGE_QUESTIONS_VERSION`（现 P1.9）；DB 列 prompt_type/prompt_version 标识
  （`jev(J1.25/…)`、`prestage-jev(P1.9/…)`）
- **prestage P1.9 五题**：token 类型（「币本身即IP」双形状：新称号 OR 社区/文化 meme
  主账号，年龄非反证）/ abm 名字关联 / abm Web3 流量 / 社区活跃度 /
  **项目实度 prestage_project_quality**（恒带；账号新 <30d + 实度 ≥3 豁免 P1.3 年龄降档，
  <3/缺分 fail-closed——**仅 project 消费，web3ip 不吃年龄门/实度门**（P1.9 C46），
  推文 <5 保留拦）
- **代码门族**（mapper 端确定性切分）：nameReferentBlock（阻断侧合计 ≥0.5，全域
  仅累计 minor+common——J1.26 notable_other 全域退出，知名度轴移交 web3_fit）/
  rideDetourBelow（B/C 骑乘改道 W）/ cashtag 改道 W（J1.17）/ detectPublisherProxy
  发布者指代（J1.18，量级 A 档锚）/ routineContentProductBlock（A 类角色豁免 J1.16）/
  negativeHardNewsBlock / web3FitBlock（unfit ≥0.5）/ referent 豁免（J1.21，仅 superIP）/
  punExempt 戏谑关联豁免（J1.24：P≥0.5+within_7d+S/A 档+可信事件源全中时豁免
  品牌劫持与 relevance≤10 双截断，计分照常）
- **交易引擎直调**：策略 `narrativeCallCondition` 触发 → `NarrativeDirectCaller.getRating()`
  同步调 analyze（30s 超时，失败/超时/未配置 normalize 9 放行）；rating=1 终端 veto 进
  `_narrativeBlockedTokens` 短路（address 形状 <300s 豁免，§4.8 重试域配套）
- **结果全局缓存**：`token_narrative` 按 token_address 全局唯一，不挂实验；失效靠行删或
  `updateIsValid(addr,false)`（批量失效机制未建，见 §四-3）
- **代码侧 pre-check 规则族**（无 LLM）：0.5/0.55/0.58 同名 /
  ~~0.52 同名蓝筹~~（C47 废除：同名≠蹭名，蹭名判定移交叙事层）/ 0.7 语料复用 /
  no_public_info 重试域（30min 窗 GMGN 缓存失效重析）/ 0.5x 爆款短路收窄（有推文文本或视频标题进 Jev）

---

## 二、Case 研究（倒序，卷二自 C36 起）

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
  如实记录。部署链：commit `27b209a` → 182 pull → 191 行存量置 is_valid=false →
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

### C54 狮鹫——notable_other「知名但非超级IP」全域退出阻断侧：知名度是错误的轴，Web3 可接纳性才是（2026-10-02 用户裁定两步演化 "A"→"A2"）★

- **案由**：狮鹫 `0xcb808ef1eeb9ba742935f50a63de6e158afb7777`（Griffin 翻译梗，
  推特语料「新模型Griffin的翻译刚好还是狮鹫，完美符合bsc的两字大金定律」）
  被name_referent阻断侧0.56拦low（minor 0.08+common 0.03+**notable 0.45**——
  notable是唯一把质量抬过门槛的项；web3_fit strong_fit 0.96 高置信放行侧）。
  市场实证：**7.8分钟毕业、首→峰12.3x**、窗末仍8.3x——错杀成本实锤。
- **裁定两步演化**：①「『名字指向知名但非超级IP』也太严格了吧——超级IP就那么
  几个，名字不是它们就不行吗」→ B类退出（A方案）；②回看CONVICTION/YAYA案后
  升级：「核心问题并不是实体不够知名，而是**实体根本没有被接纳为Web3 meme币的
  可能**——一个是严肃词汇（不跟实体对应），一个是个人名（普通币安员工）」→
  **A2 全域退出**（C/D/F/G/B/W + superIP通道）。
- **结构论证**：notable_other（知名度梯度）在B类骑乘语境与event_magnitude语义
  重叠（被骑对象够不够大tier已评过——双重惩罚），无独立信息；正确的轴（Web3
  meme可接纳性）已由 web3_fit unfit 负门（J1.19 全域）承载。真有独立拦截信息的
  只有 minor_other（无名对象，YAYA案）与 common_word（纯截词，CONVICTION案）。
- **改动**（mapper-only，题集J1.25不动）：`nameReferentBlock` 阻断质量全域只累计
  minor_other+common_word；`NAME_REFERENT_BLOCK_LABELS` 删notable键（label仅存
  注释供历史行reason展示）；审计字段 `stage1.jev.nrNotableExempt`（全域，原B类
  版升级）记录「旧拦新放」形状 `{minorCommon, notable}`。拦截责任移交：
  web3_fit unfit负门 + minor/common + magnitude/tier（热度不够）；翻案票仍需过
  各类事件分60线+质量门+preBuy全套。
- **实测影响面**（2026-10-02库扫）：B 143票 98拦→52拦（46翻案候选）；W 88→60
  （28放，含Manus骑乘家族）；F 26→20（6放）。
- **E2E四案复验**（dryrun真实Jev调用）：狮鹫 low→**high 74.44**（事件分67.68过线，
  翻案主线✅）；CONVICTION `0x81187055…7777` 维持low——**common_word 0.98主导
  自己拦住**（「严肃词汇不跟实体对应」正是保留键，兜底闭环✅）；YAYA
  `0x774a0dc9…7777` 维持low——minor_other 0.51主导仍拦（无名对象键✅；库内旧
  high行是superIP通道跑的，dryrun走标准路径，真实链路两路径都拦）；**Muse
  `0xc3136948…7777` low→high 76.41（⚠️已知代价）**——本轮web3_fit未判unfit
  （Jev认为AI工具对Web3用户不算明确不合），name门退出后版本更新票无腿可拦，
  与W类28票Manus家族同性质（A2裁定时已知的净放行边界，如实记录）。
- **单测**：`node scripts/_test_notable_other_exit.cjs`（22断言零DB四节：狮鹫
  数值复现/全域作用域矩阵含CONVICTION新兜底·YAYA边缘形状·superIP通道/审计
  矩阵/源码口径）。回归九套全过（publisher_proxy 29含B3a翻案+B3a2 unfit新兜底、
  cashtag_w_route 21、referent_memeability 30、community_name_exemption 16、
  w_interaction_exempt 17、web3_fit 29、web3_fit_anchor 12、brand_hijack 18、
  instagram_pipeline 31）。
- **存量失效已执行（2026-10-02 182）**：`invalidate-notable-blocked.cjs --commit`
  全表扫 17,008 行，命中「旧拦新放」形状且 is_valid=true 共 **130 行**批量置
  is_valid=false（119 行 stage2 标准路径 + 11 行 superIP prestage 通道——比预估
  80 多出的是 C/D/G 类与 prestage 域）；正主狮鹫行前段已单独失效（is_valid=false
  实查确认，不在 130 内）。下次任何实验/回测遇同 token 直调 miss 自动走新口径
  重析（upsert 回 is_valid=true）。
- **遗留**：182 narrative engine + 直调进程重启后才对新 token 生效（§四-10 同批，
  与 C47/C48/C49/C53 等重启项同一决策点）。

### C53 rating=null 落库 bug——apidance 空 stub + data_fetch_failed 无载体双修（2026-10-02 用户裁定「修复吧」A+B 都做）★

- **案由**：GMGN 轮 3 张 rating=null 票（蝴蝶人生 `0x87ae267002cd1ea0ec86bf3601d4a8ad76a47777` /
  AAPLB `0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a`（bStocks 家族 AAPL+B 第五张实证）/
  Freedom of Money `0x3e17ee3b1895dd1a7cf993a89769c5e029584444`）——内存有 low 结论
  （llmAnalysis.summary.rating='low' reason「无法获取账号/社区完整数据」）但落库 rating=null
  且 is_valid=true 缓存固化，违反 P1.4「分析完成必有结论」。
- **六环链破案**：① apidance 对停封/不存在账号返回 **code:0 + 空骨架**（user.result 存在
  但 core/legacy 全空）→ getUserByScreenName 组装全空 userInfo 还打印「✅ 成功获取」
  ② 空 stub 穿透 `if (!userInfo)` 判空 → twitterInfo=空壳（type:'account' 全零）→ 骗过
  `hasValidDataForAnalysis`（只要 type==='account' 就算有效数据）→ 进 account 路径
  ③ `getAccountWithFullTweets(空 screen_name)` → null → data_fetch_failed 早退——**唯一
  无落库载体的早退形状**（rules_validation 分支有 preCheckData、prestage 成功有
  prestageData，唯它两者皆无）④ 消费侧 else 分支裸奔：prestageDataToSave=undefined
  ⑤ token_narrative **无 rating 列**，rating 全靠 resolveFinalRating 扫六 stage 字段推导
  ——全空→null；llmResult.rating='low' 只进内存 llmAnalysis.summary 从未落库
  ⑥ is_valid=true 落库固化 → 缓存命中永续。且空 stub 作为非 null truthy 被
  fetchWithCache **set 成功缓存行（30 天 TTL）**——毒缓存比进程重启更持久。
- **全表扫描**：六 stage 载体全空且 is_valid=true 共 21 行 = **18 行 data_fetch_failed**
  （prompt_type='account_community'，远超已知 3+5）+ 3 行 prompt_type=null（9-28 13:3x
  jev-J1.16 同窗批量、twitter 语料空——Jev unrated catch 落库形状，另案观察不在本案域）。
  no_data 分支（9-27 加的 fail-closed）**0 行=从未触发过**，且检查发现它同样只设内存
  llmResult 无落库载体——B 修复生效后它将成为真实落点，不补载体则 rating 仍 null。
- **修复四处**（用户批准 A+B 都做，另加 A2 必修项）：
  - **B1 源头**（`new-apis.js` getUserByScreenName）：组装后 `if (!userInfo.screen_name)
    throw`「用户不存在（apidance 空响应骨架）」——screen_name 是账号主键，真实账号
    不可能为空；三调用方（twitter-fetcher / account-community-rules / TwitterService）
    全部 catch 接住（twitter-fetcher → null → fetchWithCache markFailed 60min 冷却）
  - **B2 缓存出口**（`twitter-fetcher.mjs` fetchAccountInfo）：`fetchWithCache` 返回后
    `if (result && !result.screen_name)` → invalidate 毒缓存行 + return null——缓存命中
    路径在 B1 源头之前返回，源头判定拦不到旧毒行；invalidate 后下次重新真 fetch
  - **A 早退补载体**（`account-analysis-service.mjs`）：data_fetch_failed 早退返回加
    preCheckData（与 rules_validation 分支同构）→ 消费侧走既有 precheck 分支落
    pre_check_result → resolveFinalRating 出 low。addressVerified/nameMatch 用 null
    （验证未执行，不冒充「验证失败 false」）
  - **A2 no_data 补载体**（`NarrativeAnalyzer.mjs`）：no_data 分支赋 preCheckDataToSave
    （形状与 precheck 分支构造同构）——与 pre-check 结果互斥分支不覆盖
- **副作用如实记录**：修复后这些票的 promptType 从 'account_community'（bug 状态 else
  分支默认值）变为 'precheck'（data_fetch_failed 形状）——失败归因到 precheck 语义层。
- **单测**：`node scripts/_test_data_fetch_failed_rating.cjs`（30 断言零 DB 零网络五节：
  B1 行为级打桩 fetch——空骨架 throw/真用户放行/user 整缺回归/单键判定不扩大化；
  _fetchAccountInternal 空输入 → null；resolveFinalRating 落库形状闭环——修复前 null
  bug 复现 vs 修复后 A/A2 形状 low + rules_validation/stage_final/prestage 回归；源码
  口径四连；B1 三调用方 catch 穿透安全）。回归 twitter_community 14 / unrated 32 /
  prestage_project 36 / precheck_fail_retry 35 全过。
- **三票重跑闭环（三条路径各异地兑现）**：蝴蝶人生 **null → low(1)**（twitter 毒缓存
  清除 → website butterflylife-web.vercel.app 进语料 → 标准路径 W 类截词 0.84 拦，
  stage_final low 落库）；AAPLB **null → low(1)**（无 website → 推特是唯一语料源且
  账号停封 → pre-check 规则 4 public_info_fetch_failed 拦，pre_check low 落库；
  bStocks 映射盘家族拦截维持）；Freedom **null → low(1)**（freedom-of-money.org 进
  语料 → 标准路径 C 类截词 0.51 拦）。三票 twitter_account 毒缓存行全清。修复后引擎
  真实看到了语料并判定（此前 data_fetch_failed 盲区），fail-closed 语义保持。
  no_data+A2 路径本轮未被端到端触发（三票各有 website 或 pre-check 接管），形状闭环
  由单测覆盖。
- **影响面与遗留**：18 行历史同病行中 15 行存量（is_valid=true）不自动失效（§四-3
  同款），重析走新链路即修；3 行 prompt_type=null 的 unrated 形状待另案裁定是否
  批量重析。182 narrative engine + 直调进程重启同 §四-10 批次。

### C52 METAB/Benny——「GMGN 错关联」定性推翻 + 映射盘本体五重实锤；符号引用≠票号归属（2026-10-01 用户复查触发）★

- **Token**：METAB `0x7425889fe94f9d693e8daefe88bcced6acfef4c0`（GMGN per-case 验证轮族七票；
  合约 name()="Meta Platforms"，创建 2026-06-24，fdv $3.79M / 3,480 holders / 日 1,177 笔）
- **用户复查入口**：「这个票拦截理由是什么？我认为我们的流程无法判断叙事真伪，
  只能相信。但其实这个票没问题」+ 指定推文 `status/2100030446910554609`。
- **拦截理由（在库）**：precheck「未在账号简介或推文中找到完整代币地址」
  （2026-10-01 11:29 验证轮写入，rating=low）——Benny 号语料（简介「All fees
  are paid out to holders in the form of $METAB shares」+ 推文）里找不到
  0x7425 完整 CA。
- **全链复查事实（本条目核心）**：
  1. 推文实为 **BENNY 票宣告**：CA `0xcdea0845dc394ce4bf5cdd1f8297521428877777`
     （symbol BENNY，9-16 01:11 创建，比推文早 3 分钟）；$METAB 是**符号级引用**
     （BENNY 奖励结算币——「Zuck 的狗发主人公司股票当股息」双关梗）；配图链接
     = Zuck 本人 FB 官方帖「Benny's first 4th」+ IG 帖——**Benny 是扎克伯格家
     真实的狗**，叙事源真实；
  2. AVE 全 BSC 搜 METAB 13 张：**唯一有体量 = 0x7425**；其余 2021-2025 死票；
     两张 "Meta Platforms" 死仿盘（holders=2）在 Benny 推文**之后**（9-22/9-24）
     出现 → Benny 语境 $METAB 指向 0x7425 成立；
  3. **旧定性「GMGN 错关联」错误，收回**——GMGN 关联正确（$METAB → 唯一活跃 METAB）。
- **但 0x7425 本体 = bStocks Meta 股票映射盘（五重证据 TSLAB 同构实锤）**：
  ①合约 name() 链上直读 "Meta Platforms"（SEC 法定全名格式）②价格 $724.75 vs
  META 股价 9-30 收盘 $725.18 **1:1 锚定**③1d -0.04%/24h -1.14% 股票形态
  ④totalSupply 5,227.59 带小数（按需铸造）⑤创建 2026-06-24 bStocks 上线窗口
  （TSLAB/BABAB/AAPLB 同族）。映射盘非叙事票不在判定域内（TSLAB 先例）——
  Benny 事件给它的是骑乘热度增量，本体不变。
- **用户论点「流程无法判断叙事真伪只能相信」的分层采纳**：叙事内容层成立
  （Benny 是否 Zuck 的狗/FB 帖真假——引擎判不了也没拦，语料照信）；**票号归属
  是市场事实不是叙事真伪**（哪个 CA 被宣告链上可判）：Benny 地址级宣告的是
  BENNY（0xcdea），对 0x7425 只有符号引用——「$METAB=0x7425」是按「唯一活跃
  METAB」推断的巧合性唯一解（9-22 仿盘出现后引用已歧义）。与 C47 互为镜像：
  **symbol 级关联不构成票号归属，地址级宣告才是**（地址验证门语义正确）。
- **处置**：0x7425 拦截维持（映射盘 + 无地址级宣告双事实），拦截理由记录修正
  为本条目定性；BENNY 正主票实跑结果见下。
- **BENNY 正主票实跑（2026-10-02 用户指令「跑一下」，mid(2) PASS）**：
  `0xcdea0845dc394ce4bf5cdd1f8297521428877777` 造行挂 Benny 号语料源
  （AVE/GMGN 自挂全空，C40 造行同款操作）+ created_at 1789521066（AVE+GMGN
  双源一致）→ `analyze(ignoreCache+enrichSocialByGmgn)`：**地址验证过**（置顶推
  正是宣告推 status/2100030446910554609，29 推内含完整 CA）+ nameMatch exact →
  prestage P1.9 判 **web3_native_ip_early 0.99**（vs project 0.01）→ 账号基本面
  评级粉丝 44 ≥20 底线 → **mid**。三个要点：① **C46 翻案键自然验证**——账号
  只比 token 早 5.5h、44 粉、实度题 1.5<3，旧 P1.7 世界线判 project 吃年龄门+
  实度门双拦 low；P1.9 双形状判 web3ip 绕开两门（C46 上线两天第一张完全踩在
  双形状上的自然票；与 ARX 对照：判 project 吃 no_traffic 拦 vs 判 web3ip 绕开
  骑乘判定，判型分流正确）② mid 非 high = 粉丝带 44<300 + **Zuck FB/IG 语料
  未进 prestage state**（置顶推 t.co 短链不被展开提取，prestage 路径语料边界）
  ③ **C52 论点机器实证**：同一宣告推，地址级宣告的 BENNY → mid 真评级；符号
  引用的 0x7425 → 维持拦。落库：token_narrative 全局行 + experiment_tokens
  造行挂验证实验 2609e300（与 163 张注入行同容器同去留）；结果未入
  results.jsonl/cases（非榜单票），dump 留档会话。
- **附带观察**：「Paired」字样疑指 flap 代币配对计价机制（BENNY 或为 METAB
  计价盘，watcher 9-24 起未覆盖 9-16 创建盘，未验证）——若成立则 0x7425 与
  Benny 生态存在池级配对链上事实，不改变本体定性。


### C51 龙虾——GMGN 补源 superIP 推文例外并入：马甲号挡不住 GMGN 手里的真语料（2026-10-01 用户裁定「GMGN 补源返回的 twitterUrl 是推文 URL——如果是超级IP再并入」）★

- **Token**：龙虾 `0xeccbb861c0dda7efd964010085488b69317e4444`（GMGN per-case 验证轮族七
  address_fail 票；mc $38.4M；2026-02-27 08:50:40 创建）
- **案由**：族七原判「2011 老号洗白买号盘」被用户推翻——GMGN 页面该 token 挂的
  推文是 **binancezh（币安中文，46.5 万粉 tier S）2026-02-27 08:47:43 的 Day 559
  运营梗帖「老板，有了龙虾之后接下来是不是就要解雇我了🥹 @heyibinance」**，token
  创建 08:50:40 = **梗帖发出 2m57s 后骑乘抢发**（leonardcoinbnb.lol 域名 Leonard
  →龙虾拉丁词根，@lobstercoinbnb 222 粉 3 推是发币者马甲号非叙事源；
  issuerTokenCount=61 量产盘）。
- **根因（GMGN 失明两层）**：① `link.twitter_username` 字段可带完整推文路径
  （实测 `"binancezh/status/2027304629890072818"`，fetchGmgnSocialLinks 拼
  `https://x.com/${username}` 恰好产出正确推文 URL）——**GMGN 是 token 自挂马甲号
  之外真实叙事源的唯一持有者**；② data-fetch 补源条件「已有 twitter 链接就不并入」
  （C10，省配额/不覆盖有效语料）被自挂马甲号链接挡住，superIP 真语料进不来
  → twitterType=account → prestage account 路径 address_fail 盲拦（数据缺失代劳，
  与 C48 社区死链同族：引擎从未见到真实叙事源）。
- **用户裁定**：「“GMGN 补源返回的 twitterUrl 是推文 URL” 如果是超级IP再并入吧」
  ——例外口径三重收窄：①推文级 URL（含 `/status/\d+`）②作者在 SUPER_IP_REGISTRY
  （`isSuperIpTweetUrl` = detectSuperIP 复用）；③例外路径只并入 twitterUrl 不并入
  websiteUrl（C10 对 website 不变）。普通推文/账号 URL 仍守 C10 原语义。
- **落地**：`super-ip-registry.mjs` 新增导出 `isSuperIpTweetUrl(url)`（纯函数，
  `/\/status\/\d+/` 门 + detectSuperIP）；`data-fetch-service.mjs` 3.5 GMGN 段
  单条件重构为双路径——`!hasTwitterUrl` 走原路径（twitterUrl+websiteUrl 都补，
  C10 零回归），`else if (superIpTweet && !allUrls.includes(...))` 例外只并入推文，
  日志「GMGN 超级IP推文命中(C51)」/「GMGN 超级IP推文补源新增(C51)」。并入后
  `selectTwitterUrl` 的 tweet 类型优先保证 superIP 推文被选中（自挂账号链接保留
  但靠后），零选择层改动。
- **验证闭环**：单测 `_test_gmgn_superip_tweet_enrich.cjs`（15 断言零 DB 零网络
  三节：isSuperIpTweetUrl 矩阵龙虾案数值锚定/马甲号推文 null/superIP 账号 URL
  非、推文级不触发/源码口径三连）。端到端重跑（需先失效旧缓存行，见下）：
  **C51 命中日志 → twitterType account→tweet → 标准路径 stage3 真评级**——
  事件各维度全过（category C 0.56 / magnitude A 档 / timing within_7d / block
  none 0.52），唯一拦截点 name_referent「截词（非超级IP话中词）」P=0.79。
  回归 instagram 31 / twitter_community 14 / community_name 16 全过。
- **⚠️ GMGN 缓存坑（本案实证）**：`gmgn_token_info` 缓存 TTL 实为 90 天（非 1d），
  9-30 抓的旧行存的是 handle 形状（`x.com/lobstercoinbnb`），GMGN 后来把该 token
  的推特关联更新成推文路径——**C51 首跑被旧缓存挡住零日志**，须
  `ExternalResourceCache.invalidate('gmgn:token:bsc:<addr>', 'gmgn_token_info')`
  后重跑才生效。GMGN 社媒关联是动态的，缓存行里的形状反映抓取时点。
- **龙虾票终局（2026-10-01 用户裁定「先这样」——接受 fail-closed 维持拦截）**：
  链路修复后引擎真实判定 low（截词 0.79）。定性修正（用户给出关键事实：**龙虾 =
  Clawbot，当时最火的 AI 产品**的中文代称——梗帖真实含义「币安引入 Clawbot，
  运营自嘲要被 AI 解雇」）：按题面 super_ip 档判据原文（「超级IP亲口提及/讲述的
  具体实体——产品…如 CZ 提到的某产品名」）本应判 super_ip → nameReferentBlock
  放行 → A 档事件分大概率过 60。Jev 判 common_word 0.79 按其拿到的纯文本语料
  完全自洽（文本零 Clawbot 线索），盲区在语料域：**指代映射的唯一载体是配图**
  （实测 HCJuzrtagAAobDg.jpg：红色圆胖龙虾形 AI 机器人，胸口 "AI" 字样——
  AI 取代打工人梗图，与推文文本互文），而 ① 图片分析整块注释禁用
  （`LLMClient.analyzeTwitterImage` 本体已在 Jev 迁移时删，重启需另配视觉端点）、
  ② binancezh 不在 HIGH_INFLUENCE_ACCOUNTS 名单（即便当年开着也不走）——
  双重盲区。**与 C49 币有同族形状（判定所需事实不在引擎语料集合），news WSS
  落地后回访**；纯世界知识代称子形状（无图承载）图片分析也修不了，属模型升级域。
- **影响面**：所有「自挂链接是马甲号/垃圾链接 + GMGN 关联了 superIP 真推文」形状
  ——此前全在数据层盲拦（address_fail/no_public_info/fetch_failed 族）。注意：
  superIP 快车道触发源仍是 token 自挂 twitterUrl（本案走标准路径）——GMGN 并入的
  superIP 推文是否应触发快车道，出现 case 再议。同批 182 重启（§四-10）。

### C50 CZ——社区票名称匹配不作拒因：地址绑定 + 数百成员即阵地确凿（2026-10-01 用户裁定）★

- **Token**：CZ (The Final Form Bull) `0x7a848a5a8169aa6a2f603d056a749f924f504444`
  （GMGN per-case 验证轮族六；mc $2.4M / **70,009 holders** / renowned24h#17；
  2026-07-03 创建）
- **案由**：C48 修复后重跑拿到真数据仍被拦——**名称门字面失明**：「代币名称（CZ）
  与社区名称（crypto for genz）不匹配」。用户指出 **CZ = Crypto for Gen Z 首尾
  缩写双关**（C40 BI = Binance Intelligence 同族形状），且叙事有正式宣告：
  @jiaojiaojio（2.2 万粉）2026-07-26 帖「cz 社区的朋友们！…**CZ = Crypto for
  Gen Z.**」（mint 后 23 天社区后补叙事，C46「社区后建」合法形状）。`verifyTokenName`
  全部匹配规则是字面精确/包含——"cz" 与 "cryptoforgenz" 无字面包含关系（首尾缩写
  与全称之间不存在包含），结构性失明；且地址验证已过（社区推文含 CA = 最强归属
  绑定），强绑定票死于锦上添花层的匹配缺陷。
- **方案裁定**：缩写匹配方案（加 first[0]+last[0] / 词首连拼规则）被否决——
  「通过这种匹配也不能根治」（字面匹配家族里打补丁，永远有下一种双关形态漏网）。
  根治 = **社区票名称匹配不作拒因**：「如果社区中有地址，并且社区有数百人，
  基本够了」——地址绑定 × 成员规模 = 社区阵地确凿，名称关联与叙事价值交
  prestage Jev（P1.2 名字关联题本来就是它判）。
- **落地**（`account-community-rules.mjs` `performRulesValidation` 名称拒分支前）：
  豁免三条件全中才过——`type==='community'` × `addressResult.found` ×
  `members_count ≥ 200`（「数百人」下界取整，本案 292 过线，可调）。豁免返回
  `stage:'community_address_members_pass'`、`nameMatch:false`（字面不匹配如实
  记录不隐藏）、reason 明示交 Prestage、details 落 `nameExempt` 审计。account
  侧名称门不动；原名称拒分支保留（门槛外形状照常拒）；项目币 skip 分支零触及。
- **翻案**：low（名称门）→ **mid(2) PASS**——豁免日志命中 → P1.9
  「成员292，活跃度?」→ `web3_native_ip_early` → mid。**与 C48 接力**：本票先由
  C48 修复解锁社区真数据（fetch_failed 盲评 → 名称门真拦），再由 C50 名称豁免
  放行进评级——两案同一张票的两层修复链。
- **单测**：`node scripts/_test_community_name_exemption.cjs`（16 断言零 DB 零网络，
  直接 import 纯函数本体：CZ 案数值锚定翻案 / 199 门槛下拒 / 边界 200 过 /
  地址未命中不豁免 / 成员缺失 fail-closed / account 侧不豁免 / 名称匹配票原路径 /
  账号质量达标分支零回归 / 项目币 skip 分支零回归 / 源码口径四连）。
  C48 单测 14/14 回归通过。
- **影响面**：所有「社区票 + 字面名称不匹配 + 地址验证过 + ≥200 成员」形状——
  此前全被名称门拦死（缩写/谐音/双关/中英混排等一切非字面关联）；Jev 拿社区
  真数据（成员/活跃度/P1.2）做最终评级，误放面由评级层兜底。182 重启生效
  （§四-10 同批）。

### C49 币有——expired_tweet 窗 10min → 6h：叙事新鲜度不该代码预拦到分钟级（2026-10-01 用户裁定「10分钟确实有点太窄了，改成6小时」）★

- **Token**：币有 `0xe9337dde3dd9e97f1f45a56412767ce5098e7777`（GMGN per-case 验证轮族五
  expired_tweet 首票；symbol「币有」name「何必东奔西走 币安全部都有」= 何一文案原文；
  7,243 holders）
- **「叙事重新激活」形状（本案首证）**：币安老宣传文案「何必东奔西走，币安全部都有」
  2026-05-28 就在小号流传（@0xcocoCN 2135 粉转发引用，没火）→ **何一 7-31 12:02:52
  重新发布**（bStocks 代币化股票宣传「7000+股票，7X24小时交易」，叙事激活）→
  **27m47s 后币有跟进发币**（dump 创建锚 1785499479 = 12:30:39 UTC）。拦截两层根因：
  ① 10min 窗只看语料推文发布时间——引擎拿到的是 token.twitterUrl 挂的小号 5-28 旧推
  （62 天前），不知道叙事 27min 前刚被 S 级账号激活；② **何一激活推文不在语料集合**
  （name 文本 = 何一推文原文这个关联无机制发现——挂错锚问题用户裁定等 news WSS 解）。
- **用户裁定**：①「这种裁定叙事过期的币，其实是过去没火的叙事重新拿出来了」——
  叙事新鲜度的锚是**激活事件**不是语料首次发布；②「这个 case 如果要解，要结合我
  新引入的 news WSS 才行，暂时先放饭」（挂错锚/激活感知属 news WSS 域）；③ 窗口本身
  「10分钟确实有点太窄了，改成6小时」。
- **落地**：`expiredTweetMinutesThreshold` 10 → 360（三处单点：NarrativeAnalyzer.mjs /
  pre-check-service.mjs 两处默认对象 + 消费点 fallback；default.json 无此键，代码默认
  即生效源）。6h 内语料推文放行进 Jev，由 timing 题分档（within_7d=15 分「当前」档
  本来就是它的判定域）——10min 预拦比 Jev 自己的「当前」档严 4 个数量级，属于代码
  抢了 LLM 的叙事判断（分工原则再实证：推文发布时间是市场事实代码可判，「叙事是否
  还活着」是叙事判断归 Jev）。
- **族五四票新窗推演**：TRUMAN `0xabffa443547b34ab6c3b3173d26e233900527777` 32min → 放行进 Jev；9
  `0x990c71fdfa761bcf500ac8753f775ff7fb1b4444`（@binance S 级）3.9h → 放行；币安股票 `0xd8348b96c8f23e1e24c0f40f495823c98f8e7777`（何一）
  9.9h > 6h → 仍拦（裁定值，不放）；币有（挂小号 62 天推）→ 仍拦等 news WSS；
  **2026-10-02 三张实跑验证（推演全兑现，C49 两侧边界闭环）**：TRUMAN 拦 →
  **high(3) PASS**（@WillTheRapper_「Will 世界模型」6,722 粉蓝V，账号质量三条件
  全中 + 推文含完整 CA 地址验证过 → P1.9 判 project → 粉丝带 high；nameMatch=
  false 但走 account_quality_address_found 分支，地址绑定优先于名称匹配）；
  9 拦 → **mid(2) PASS**（语料 = @binance 官方推带媒体 → 规则 5 高影响力短路
  mid 跳过 LLM，GM 案同口径既定设计）；币安股票仍拦 low(1)（主推文 6-05
  20:58 vs token 6-06 创建 = 9.9h > 360min，窗外语义实跑确认）。轮统计更新
  （三张均族五重跑非新跑）：已跑 143 = PASS 49 + FAIL 91 + null 3，翻案
  8 张（GM/AST/中国人能飞/我踏马来了/CZ/CREPE/TRUMAN/9）。
  TSLAB（另案：特斯拉股票映射盘 `0x5b1910ea…292f` 五重证据实锤跳过——name="Tesla,
  Inc. " SEC 全名格式 / $356 1:1 锚定 TSLA / ±1.5% 股票形态 / totalSupply 68,120.54
  小数=按需铸造 / 76k holders，CZ 2018 推文装饰性挂链，映射盘非叙事票不在域内）
  2782 天 → 仍拦（歪打正着）。
- **影响面**：无单测引用该窗（grep 零命中）；存量 expired_tweet 缓存行不自动失效
  （§四-3 同款）；**182 narrative engine + 直调进程需重启生效**（§四-10 同批）。
  视频过期窗（365d）与推文窗独立，不动。

### C48 CREPE——Twitter Community 数据链路两处死链修复：社区票全程盲评（2026-10-01 用户裁定「修复吧」）★

- **Token**：CREPE `0xeb2b7d5691878627eff20492ca7c9a71228d931d`（GMGN per-case
  验证轮族三票；mc $7.2M，twitterUrl 是社区链接 x.com/i/communities/1936927457325515037，
  website crepe.life）
- **用户质疑（裁定入口）**：「"有一个 twitter community" 量级 D 档是怎么判断的？
  如果形成了社区，社区几百个人就不小了」——直觉完全正确：现场实测（apidance
  CommunitiesFetchOneQuery）社区真实存在且 **4145 成员 / 10 版主**（远超「几百人」），
  但 Jev 从未看到：dump 实证 state twitter 段 `used: 0`（配额 24000），全部语料 =
  crepe.life 官网 1016 字 generic roadmap → event_magnitude 1 档 0.44 → **D 档**；
  之后再被 name_referent common_word 0.7「截词蹭名」拦（族三重跑的 low 结论建立在
  twitter=null 之上）
- **根因：两处 import 层级写错，社区链路从未工作过且静默**（C44 IG 死链同款第三例，
  动态 import 不执行不解析、语法检查抓不到）：
  ① `data-fetch-service.mjs` 主 community 分支 `await import('../../utils/…')`——
  从 services/ 出发解析到**不存在的** `src/narrative/utils/twitter-validation/`
  （真实文件 `src/utils/twitter-validation/communities-api.js`；同文件 432 行回退分支
  反而写的正确三级）；fetch throw → `markFailed`（error_message 即 MODULE_NOT_FOUND
  落 external_resource_cache）→ **60min isFailed 冷却内重跑也不重试** → twitter=null；
  且主分支失败后回退分支被 `type !== 'community'` 条件挡住，null 固化
  ② `account-community-rules.mjs` `getCommunityWithFullTweets` 动态 import 三级路径
  （该文件在 prompts/account/ 深一级，需四级）→ 恒 null → **prestage 社区路径全部
  `data_fetch_failed` low**——若只修 ①，社区票只是换个姿势死（twitterInfo 有了 →
  走 prestage → ②还是死的）。同文件顶部静态 import 用的是正确四级（加载即验证），
  动态的死了没人发现
- **修复**：① 改 `'../../../utils/…'`（与回退分支对齐）；② 删动态 import 改顶部静态
  `import { fetchCommunityById } from '.../communities-api.js'`（注意 index.js 虽然
  require 了 fetchCommunityById 但**未放进 module.exports**，不能从 index.js 具名导入；
  communities-api.js 的 CJS shorthand module.exports 可被 cjs-module-lexer 静态分析，
  named import 实测可用）
- **端到端重跑**：清 external_resource_cache failed 行 + ignoreCache 重跑——
  **low → mid(2) PASS**：链路全通（社区识别 → fetchCommunityById 真数据 →
  getCommunityWithFullTweets 规则验证「网站已验证地址」→ P1.9 prestage），
  stateChars 1320→4848，判定 `web3_native_ip_early`（社区 meme 主账号形态，P1.9
  双形状）→「成员4145，活跃度?」→ mid（社区 timeline 零推文拉低上限没给 high，
  判定自洽）
- **影响面**：所有带 twitter community 链接的票（不只 CREPE）——修复前 twitter 恒
  null，社区票全在标准路径盲评（吃截词/D 档）或 prestage data_fetch_failed
- **附带观察**：社区 admin 账号已被封（"User is suspended"）、timeline 0 推文——
  4145 人零发言社区存疑，但这该由 Jev 拿到数据后自己判（「活跃度?」正是它判的），
  不该由数据缺失代劳
- **单测**：`node scripts/_test_twitter_community_pipeline.cjs`（14 断言零 DB 零网络：
  模块解析/两修复点源码口径（字符串+按文件位置 resolve 双锁）/**全库 twitter-validation
  相对 import 逐条 resolve 零死链**（防新增——把「动态 import 不执行不解析」的盲区
  用测试填掉）/字段映射/data_fetch_failed fail-closed 语义不变）
- **182 重启项**：与 C41/J1.24/J1.25/C44/P1.9/C47 同批等重启

### C47 AST——rule 0.52 same_name_blue_chip 整体废除：同名≠蹭名，蹭名判定移交叙事层（2026-10-01 用户裁定「A跟C，根治」）★

- **Token**：AST (ast.fun) `0x265b3982ea730748100947f52561a4eab54affff`（GMGN
  renowned24h#61，mc $0.6M；per-case 验证轮族三首票；发行方 @ast_dotfun 4227 粉、
  issuerTokenCount 54 量产盘画像、website ast.fun）
- **误拦现场**：rule 0.52 硬拦——AVE 找到「同名蓝筹」Alpha Struct Token
  `0x4ef4b64f7d9304b6084627a30d51d64df9832a6d`（fdv $168.5M / tvl $253K /
  22,291 holders，创建 2026-03-17）。两个代币**完全不是一个东西**：ast.fun 是
  AI agent 平台自发币（27 条推文挂 CA），Alpha Struct Token 是老结构化产品币
  ——symbol "AST" 纯缩写巧合。C45 没救（selfRow=undefined fail-closed）、
  C37 没救（字面法 ast.fun↔ast_dotfun 点号/下划线对不上）。
- **用户裁定**：先质疑「这俩代币完全不是一个东西，只是名字一样，不能去重吧」，
  再定「A跟C，我认为还是需要根治的，该怎么样怎么样」——**C 为体**：0.52
  同名蓝筹不再一票否决（代码侧无法区分巧合撞名与蹭名，蹭名判定移交叙事层）；
  **A 的语义**（有认领/自发宣告 ≠ 蹭名）由叙事层既有防线天然承载：挂 CA
  自发宣告票走 prestage account 路径评级，无认领蹭名票吃 nameReferentBlock /
  brand_hijack / cashtag 改道门。
- **根因**：0.52 立规语义（富贵案「有同名蓝筹肯定不行」）混淆了**同名**（symbol
  巧合，AST 案）与**蹭名**（蹭既有蓝筹认知获客，CREPE 案）——代码侧只有
  symbol 匹配事实，蹭名是叙事意图判断，本就该归 LLM 层。四层豁免补丁
  （C29/C37/C45/C34）都是给代码侧蹭名判定打的语义补丁，越打越窄仍救不了
  巧合撞名形状——根治=删规则。
- **落地（三处删除）**：① pre-check-service.mjs 0.52 分支 +
  `evaluateBlueChipNarrativeAnchorExemption`（C37）+ performPreCheck options
  的 superIPInfo/issuerDetected 传参链（NarrativeAnalyzer 调用点同步清理）；
  ② same-name-check-service.mjs `checkBlueChipConflict`（含 C45/C34 内嵌豁免）；
  ③ 专用单测 `scripts/_test_blue_chip_check.cjs`（66 断言全为 0.52 生态）。
  `narrative.sameNameCheck.blueChip` config 段成死配置（无消费点，保留无害）。
  规则 0.5/0.55/0.58 零改动（_normalizeName/_searchBscWithCache 等共用工具保留）。
- **族三 10 票重跑验证**（A+C 语义双实证）：
  - **AST 翻案 high(3) PASS**——prestage project 路径：@ast_dotfun 挂 CA 自发
    宣告（addressVerified=true 27 条推文含地址）+ 4274 粉 + 项目实度 4.3 分
    →「项目币评级：粉丝4274 → high」——A 语义的正向承载（不拦且给真评级）；
  - **CREPE `0xeb2b7d5691878627eff20492ca7c9a71228d931d` 被 Jev「截词（非超级
    IP话中词）」拦**——C 语义的直接实证：以前 0.52 代码拦，现在叙事层用
    蹭名语义拦（CREPE vs 蓝筹 CREPE 是同名同意义蹭名，正确拦）；
  - 其余 8 票换正确理由维持 low：no_public_info×4（人生好物/pPOLY/SLX/TAC
    零语料）/ prestage abm 无30天Web3流量×2（ARX/ClipX 存量蓝筹无新叙事）/
    币安链能飞 13 粉<20 底线 / CZ 语料失效 fetch_failed——「只是换拦截理由」
    预期全中，零误放。
- **影响面**：存量 0.52 拦截行（token_narrative ruleName=same_name_blue_chip）
  缓存不自动失效（§四-3），重析走新链路；182 narrative engine 常驻进程重启
  与 C41/C44/J1.24/J1.25/P1.9 同批（§四-10）。
- **意义**：与 J1.16/J1.23/J1.24 同向的分工原则再实证——**代码管市场事实
  （谁先发/涨了多少），叙事意图判断归 LLM**；同名是市场事实（代码可判），
  蹭名是叙事意图（LLM 判）。

---

### C46 MarsCoin——社区 meme 主账号归 web3 原生 IP + web3ip 不吃账号年龄门（P1.9，2026-10-01 用户裁定）★

- **Token**：MarsCoin `0xfe189e97832da1573e4e4ff034f4ffc3a15c7777`（GMGN mc24h#5，
  mc $135.8M；per-case 验证轮 #36；C45 绝对体量豁免先行放行 0.52 → 进 prestage）
- **现象**：prestage low——Jev 判 `project`，评级链：账号晚于 token 创建 23 天
  （负年龄 <30 → P1.3 年龄降档）+ 项目实度 2.76 <3（P1.5 fail-closed）双臂锁死。
- **语料实证**（@bnbMarsCoin，3817 粉/118 推）：bio 自称 **"Community account"**、
  置顶推文挂 CA、20 条抽样推文全为 Elon/SpaceX/Mars meme 文化内容
  （"One planet, one coin"、Joe Rogan Mars edition、RT SpaceX 空投）零产品
  陈述——教科书社区 meme 主账号；实度 2.76 低分正是范畴错配产物（实度题要求
  产品陈述，meme 无产品可陈述）。
- **用户裁定（两条）**：①「MarsCoin 的推特账号是代币大了后社区自己搞的 Meme 币
  的主账号，这不属于项目。我记得之前有"web3 原生IP"这一类，应该是属于这一类」；
  ②「很多 meme 币也有可能是一出生就有账号的，一般算是"web3 原生 IP"」——
  账号随币而生/社区后建是 web3 原生 IP 常态，账号年龄不构成反证。
- **误判偏置源三处（P1.9 全修）**：
  ①题面 web3ip 判据过窄（「全新发明称号、不复用原名」把热点主题社区 meme 排除
  在外）→ 扩为「币本身即 IP」双形状：a) 发明新称号/概念（币安之王型）；b) 社区/
  文化 meme（热点人物主题主账号，MarsCoin 型）；project 侧补显式反例（社区 meme
  主账号有官网/品牌/认证也不算 project——官网≠产品）；
  ②state 预计算段「项目官方网站…确认为项目方官方代币」在类型判定前预设 project
  方向 → 措辞中性化（「官方网站…该账号/社区的官方代币」，jev-state-builder）；
  ③mapper web3ip 分支复用 rateProject 吃 P1.3 年龄降档 + P1.5 实度门 → 加
  `opts.accountAgeGate`（web3ip 传 false，reason 标签「账号基本面评级」）；年龄臂
  关闭后实度门随之不消费（qualityExempt 只作年龄豁免存在）；**推文 <5 拦截保留**
  （C15 x-0 买粉新号防线与 token 类型无关）。
- **验证闭环**：单测 `_test_unrated_elimination.cjs` 32 断言（168 粉 10 天新号
  web3ip low→mid 翻转 / MarsCoin 负年龄形状 → high / 同形状 project 仍 low 对照 /
  推文<5 保留）+ `_test_prestage_project_downgrade.mjs` 36 断言（新增第 6 节
  accountAgeGate 矩阵：默认 opts 零回归 / gate=false 年龄臂关 / 推文项独立 /
  实度缺分不再 fail-closed）。**重跑 `--case`：token_type project →
  web3_native_ip_early（语义修正类题改生效实证，与 J1.25 同族；对照 J1.23 分数
  锚定类不动），评级 low → high PASS**（prestage 路径无 stage3 分数；3817 粉 ≥300
  走 high 带；jev-P1.9 标识）。
- **影响面**：存量 web3ip 行被年龄降档 low 但推文 ≥5 的票重析时走粉丝带（缓存
  行不自动失效，§四-3）；C15 x-0 形状（1 推文）仍拦；project 路径零变化（默认
  opts 机器证明）。验证轮 #41 比特币（@btc2025x 343 粉 20 天新号 + 实度 3.25 →
  project high）同族形状若重析类型翻 web3ip，方向等价（343≥300 → high）。
- **部署提醒**：182 narrative engine 常驻进程重启与 C41/C44/J1.24 同批（§四-10）。

---

### C45 XRP——同名蓝筹「绝对体量豁免」（rule 0.52，2026-10-01 用户裁定 B）★ **〔已废除：同日 C47 AST 案 A+C 根治裁定整体移除 0.52，本豁免随之成死代码删除；条目留档〕**

- **Token**：XRP `0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe`（GMGN mc24h#1 / vol24h#7，
  mc $485.7M；per-case 验证轮 #32）
- **现象**：rule 0.52 `same_name_blue_chip` 误拦真 XRP 本体——AVE BSC 搜索返回的
  「蓝筹候选」是它自己的镜像版本 `0x9b7e464c9a5801f5b8d237205ee077533844e3db`
  （fdv $551M > 自身 $485.7M）。C34 相对豁免双毙：①票无 wss_events 创建锚
  （AVE created_at 存在但口径链路 anchor=0）②selfFdv < candMaxFdv——BSC 多版本
  蓝筹互为「同名蓝筹」的死锁形状。
- **用户裁定**：方案 B 体量豁免——「蹭名票必然是小盘新发盘」（引擎 90s 买窗语境），
  自身 fdv ≥ $10M（蓝筹体量）时撞名只可能是真身/多版本/成熟票，蹭名不成立。
  候选：A 维持不修 / B 绝对体量豁免 / C 官方账号豁免。
- **落地（`same-name-check-service.mjs`，C45 先判 + C34 后判共用 selfRow）**：
  `selfFdv ≥ selfFdvExemptMin`（默认 $10M，config
  `narrative.sameNameCheck.blueChip.selfFdvExempt` 可调）且 < maxValidFdv(1T)
  → 豁免，**不依赖创建锚与票龄**（XRP 案正是 C34 双毙形状）；selfRow 取自 AVE
  同次搜索原始结果（零新配额），缺失/fdv 0/脏值 fail-closed 维持拦截。
  exempt 审计对象带 `mode:'absolute'|'relative'` 区分两门；pre-check 日志 mode
  感知（「绝对体量豁免(C45)」/「名实不符豁免(C34)」）。
- **边界安全**：蹭名票长到 $10M 的风险=极端火票 pump——但它自己已是蓝筹体量
  且引擎 90s 买窗遇不到；0.5 一周窗 + Jev 各门仍在。C34 相对豁免语义不变
  （$5M 小盘侧 fail-closed 用例保留在单测）。
- **验证闭环**：单测 `_test_blue_chip_check.cjs` E 段重写（57→66 断言）：大盘/小盘
  双轨矩阵（E1-E10 每条用例大盘侧断 C45 absolute、小盘侧 $5M 保留 C34 原语义）
  + XRP 案数值复现（self $485.7M 无锚 vs cand $551M → absolute，ageDays null）
  + 恰 $10M 边界（>=）。`--case` 重跑：豁免日志命中（selfFdv=$481.7M 实时值），
  0.52 拦截解除 → 链路走完 → prestage Jev（@Ripple 317万粉官方号 + xrpl.org）
  判 `account_based_meme` + 无 30 天 Web3 流量事件 → **low——评级合理非误拦**
  （票龄 2213 天存量蓝筹无新叙事，榜单真蓝筹本非引擎目标票；拦截理由已从
  「蹭名指控」修正为「无新叙事」的正确评价）。
- **同轮遗留观察**：币安链能飞 `0xa993469257c411ab789d990fc995d806b6597777`
  （0.52 拦，C37 轮）C45 上线后可能同样被救——待重跑验证。

---

### C44 土豪猫猫——Instagram 链路三处死链修复 + IG 影响力两层处理（2026-10-01 用户裁定）★

- **Token**：土豪猫猫 `0xfade76ef97ada757be21a4a1aba87d576eda7777`（four.meme，
  provenance=A，vol24h#87；per-case 验证轮 #29）
- **裁定与方向升级（两句合并）**：用户先裁定「因为我们无法知道在Ins上这个猫的
  影响力多大，这里我觉得豁免一下吧，如果引用了Insgram的链接，就认为影响力达标」
  （我原建议维持拦截被推翻——证据缺失≠零影响力）；mid-turn 再升级「这个API能支持：
  docs.justoneapi.com/zh/api/instagram/ 进一步获取instagram的信息」——**两层设计**：
  ①真数据可得（JustOneAPI IG 端点抓到）→ 真数据进 state，Jev 按真证据判分不兜底；
  ②IG 链接存在但数据未抓到 → mapper A 类 dim2 兜底锚（见下）。真数据优先，豁免是
  数据不可得时的忠实翻译而非无脑放行。
- **三处死链（IG 数据链路从未成功过，全链破案）**：①`classifyAllUrls` switch 漏
  `case 'instagram'`——`classifyUrl` 一直正确识别 IG（platform/type 对）但落
  default 进 websites 桶 → data-fetch 的 `selectFirstUrl('instagram')` 恒 null →
  fetcher **从未被调用**（根因）；②fetcher 端点是旧路径（`post-details/v1`/
  `user-profile/v1` 路径 404 Resource not found——文档 slug ≠ API 路径，真实端点
  `get-post-detail/v1`/`get-user-detail/v1`）；③解析层读 `metrics.like_count`/
  `user`/`taken_at` 扁平结构，真实返回是 IG 原生 GraphQL 形状
  （`edge_media_preview_like.count`/`owner`/`taken_at_timestamp`/
  `edge_media_to_caption`；user 三层嵌套 `{data:{data:{user:{}}}}` +
  `edge_followed_by.count`）。输出形状保持（`buildInstagramSection` 与 pre-check
  规则 3.5.5 消费旧形状零改动）。
- **key 覆盖实测**：现有 key（硬编码 fetcher 内）对两个新端点均 `code:0` 成功——
  与 C41 调查的 `web/html/v1` `code:300` 套餐外不同族，**Instagram 端点在现有套餐内**
  （免开通直接用）。
- **本案真数据**：帖子 DFZg9g0Bz5E = 19,596 赞 / 12 评论 / GraphSidecar 多图 /
  发布 2025-01-29（8 个月前老帖）+ accessibility_caption「新年 農曆 紅包 利是 貓貓
  富豪」+ caption「跟著土豪貓貓秒變富豪」；作者 @meowmomagazine（MEOW MO MAGAZINE，
  港台生活杂志 Magazine 类）= **128,737 粉 / 920 帖**——「影响力不可知」实为十万粉
  级账号 + 2 万赞帖，完全支撑用户裁定直觉。
- **mapper 兜底锚（第二层，`jev-result-mapper.mjs`）**：`igDim2Anchor = A类 &&
  instagramLinked && instagramInfoFetched!==true && dim2<18` → `effDim2 = 18`
  （18 = J1.23 dimension2 A 类「风格契合 Web3 偏好」带下限）；analyzer 传
  `instagramLinked`（classifiedUrls.instagram 有 URL）/`instagramInfoFetched`
  （IG 数据非空=真数据已进 state）。边界：不救量级门（strong_fit<0.5 的 D 档票死
  量级门合理，偏好证据另有 web3FitAnchored 正门）；W 数学不消费 dim2 不触达；
  web3FitBlock unfit 负门在前豁免票仍拦；superIP 快车道不挂（一期范围）；非 A 类
  不锚（IG 是形象主阵地，豁免限 A 类场景）。审计 `jev.instagramDim2Anchor {from}` +
  stage2 reason `·IG影响力豁免(原N)` + llm 前缀「IG影响力豁免(C44)｜」。mapper-only
  不 bump 题集版本（C42 先例）。
- **重跑验证（真数据路径，PASS）**：`51.7 low` → **`high 72.29`**。IG URL 进
  instagram 桶（日志「URL识别为Instagram帖子/Reel」）→ 真数据进 state → Jev 按
  真证据判：**传播 dim2 9.7 → 22.32**（19596 赞+12.9万粉的证据分量）、量级 B 档
  （Web3偏好锚原判C档 strong_fit 95%）、timing within_7d 15 分——担忧的「8 个月
  老帖掉 older 档」未发生（Jev 判形象鲜活）；事件分 64.32（27+22.32+15）→
  72.29 high。**兜底锚未触发**（真数据抓到了）——两层设计按预期走到第一层。
  pre-check 规则 3.5.5（IG 帖子互动数据）桶修复后**首次生效**。
- **单测**：`node scripts/_test_instagram_pipeline.cjs`（31 断言零 DB 零网络，
  fixture=本案真实响应：端点路径/ post+user 解析矩阵/桶归属/兜底矩阵（本案 51.7→60
  数值复现、真数据不锚、非A不锚、只升不降、W 不触达、存量零变化）/analyzer 传递点/
  section 形状兼容七节）。
- **部署提醒**：narrative engine 常驻进程（182）需重启吃到 IG 修复（与 C41 jina
  回退 + J1.24/J1.25 同批，多进程 mapper 版本漂移同款）。

---

### C43 土豪猫猫——subject_unqualified 主体口径修正（J1.25，2026-10-01）★

- **Token**：土豪猫猫 `0xfade76ef97ada757be21a4a1aba87d576eda7777`（同 C44，先于
  IG 修复发现）
- **拦截点**：block_reason `subject_unqualified` argmax「主体资格不足」（A 类
  scope 内）——把**陈述者账号**（无名发帖号 @MGGA_BSC）当成了主体；实际主体 =
  币名所指核心实体（土豪猫猫形象本身），来源账号粉丝数不构成形象主体资格不足。
- **修正（J1.25，语义修正类）**：subject_unqualified 判据改「主体=币名所指核心
  实体（形象/人物/IP/事件主角），陈述者账号绝不构成主体资格不足；形象类主体按
  形象自身知名度判，来源账号粉丝是 proxy」。
- **验证（语义修正类题改生效实证，与 J1.23 分数锚定类不动形成对照）**：重跑后
  block argmax 翻转 none，拦截点移交「事件分不足 51.7<60」（dim2 只 9.7 因 IG
  数据抓不到、语料零传播证据）→ 引出 C44 豁免裁定。

---

### C41 RedCoin——web-fetcher r.jina.ai 回退（2026-10-01 用户裁定 A）+ W 类数学「世界级机构链上产品」错位（待裁定）

- **Token**：RedCoin `0xe2881a7ac454c473a8b4c858732402154e107777`（flap，provenance=A，
  vol24h#83；per-case 验证轮 #28）
- **事件**：HSBC 2026-09-30 12:18 HKT 官宣港元稳定币命名 "RedCoin"（330 万 PayMe 用户，
  年底前上线）——币名 exact_match + 世界级机构主体 + within_7d，真事件票。
- **修复（管道层，用户裁定 A）**：SCMP 有 Cloudflare JS 挑战（加强 header 也 403）→
  web-fetcher null → pre-check rule 4 `public_info_fetch_failed` 误拦（与 #24 那兔/
  #25 FISHMIND「语料物理删除 fail-closed 正确拦」不同族——本案是「源活着管道被反爬
  挡」，C39 币安广场 WAF 同族）。落地 `web-fetcher.mjs`：主抓失败（403/超时/内容
  提取 <50 字）回退 `https://r.jina.ai/<原URL>` 一次——免 key，实测直通 Cloudflare
  站点；解析 Title/Published Time/Markdown Content（`parseJinaReaderOutput` 导出），
  Published Time 仿 twitter-section 模式拼进 content 头部（Jev timing 题时间信息）；
  返回形状同构 + `fetchedVia` 审计字段；回退也失败 null（fail-closed 等价旧行为）。
  仅失败回退 + ExternalResourceCache 缓存，量在免费限流（~20 req/min）内。
  **UA 坑（实测对拍）**：r.jina.ai 对伪装 Chrome 浏览器 UA 的请求 403（反滥用），
  curl 默认 UA/无 UA 放行——回退请求带 `richer-js-narrative/1.0` 非浏览器 UA。
- **JustOneAPI web/html/v1 调查**（用户提示）：JustOneAPI 确有普通网页抓取端点
  （`api/web/html/v1`，返回 `{code,data:{data:渲染后HTML}}`），广场 fetcher 已接
  （C39 增强位）；但现有 key（douyin/tiktok 同把）调用返回 `code:300 API INVALID`
  ——端点不在当前套餐。**用户裁定不开通（「这块就先不管」）**：jina 免费档
  （仅失败回退，~20 req/min）继续顶用；未来若开通可作一级回退，挂点就在
  `_fetchWebsiteContentInternal` 回退链。
- **验证闭环**：RedCoin 重析 rule 4 消失（`preCheck=-`，语料 1137 字符 + 发布时间
  进 state）→ 进入 Jev 完整判定 stage3。单测
  `node scripts/_test_web_fetcher_jina_fallback.cjs`（19 断言零 DB 零网络，打桩
  globalThis.fetch：解析矩阵/主抓成功不回退/403 回退形状/回退也失败 null/空壳页
  走回退/源码接线六节）。
- **衍生判定点（W 类数学错位，已裁定 → C42）**：语料进来后新拦截点 = **W 类数学
  41.45 < 60**（产品 16.36 + 币安交互 0.09 + 时效 25）。Jev 全维度证据与 W 数学
  自相矛盾：event_category W 0.68 但 D 0.31（分类优先级表 W>D 把「机构官宣链上
  产品」推向 W）；magnitude A 档 0.72（HSBC 知名大公司）；name_referent super_ip
  0.70（RedCoin=HSBC 官宣产品名）；dim2 4.49 极强带（世界级机构）；relevance
  exact_match 0.91；block none 0.91——除币安交互轴外全维度世界级，唯
  `w_binance_interaction` 0.01（置信 0.99「无交互」事实正确：HSBC≠币安系）压死。
  裁定与落地见 C42。
- **部署提醒**：narrative engine 常驻进程（182）需重启吃到回退逻辑（与 J1.24 同批）。

---

### C42 RedCoin 续——W 类「世界级主体产品豁免币安交互」（2026-10-01 用户裁定）★

- **Token**：同 C41 RedCoin `0xe2881a7ac454c473a8b4c858732402154e107777`
- **用户裁定**：原话「世界级主体发布产品（不是版本更新），可以豁免跟币安交互」；
  另 JustOneAPI web/html/v1 不开通（「这块就先不管」）——jina 免费档（仅失败回退
  ~20 req/min）继续顶用。
- **语义**：交互轴（W 数学最大权重 40 分）为币安生态叙事票设计；「传统世界级
  机构 × 链上产品官宣」的叙事价值在机构本身（D 类量级/传播轴正主），跟币安
  零交互是常态而非缺陷——J1.17 ChainPulse 案「W 交互分语义错位」注释同源。
- **落地（mapper-only 切分，题集版本不动 J1.24——J1.16/J1.23/J1.24 三案教训：
  题面锚移不动 Jev 的分）**：`jev-result-mapper.mjs` W 数学分支 `wInteractionExempt`
  四条件全中才豁免：①**原生 W 类**（isW && 非 rideDetour && 非 cashtag 改道——
  改道票各有拦截语义，iNu 案 cashtag 改道就是要拦，豁免不越界）；②effTier S/A
  （世界级/头部主体）；③**新产品带 P(2)+P(3)≥0.5**（「重要新功能或有特点的新
  产品」+「创新产品」——裁定原文「不是版本更新」，0 档小改进/边缘更新与
  1 档一般新功能排除）；④交互已落无交互带（wInteraction<10）——交互 ≥10 的票
  三轴照算（高交互是加分，剔除反而亏分）。效果：**产品+时效两轴归一化百分制
  （÷60×100），pass 线 60 不变**；wInteraction 照常计算落库（审计可见）但不参与
  总分。审计 `jev.wInteractionExempt {tier, newProductP}` + reason 前缀
  「世界级主体产品豁免币安交互(C42)」+ stage2 reason「两轴归一」标注。
- **验证闭环**：单测 `node scripts/_test_w_interaction_exempt.cjs`（17 断言零 DB：
  RedCoin 实测 answers 数值复现 41.45→68.93 high 78.23 / 豁免矩阵六例——tier C
  不豁免、版本更新形状不豁免、交互 14.5 不豁免、D 类不触达、骑乘改道不豁免、
  cashtag 改道不豁免 / 高交互票三轴照算 89.2 / 审计 reason / 源码接线版本）；
  回归 pun_exemption 18 / web3_fit_anchor 12 / publisher_proxy 28 /
  narrative_signal_gate 13 全过。**端到端 `--case` 复验：low 41.45 → high
  77.39 PASS**（生产链路含 GMGN 补源，reason 完整标注；事件分 41.6(69.33×0.6)+
  关联 20+质量 15.79）。
- **影响面**：豁免条件三重收紧（S/A 主体门 × 新产品带 × 原生 W）——垃圾票主体
  量级过不了 A 档，误放面极小；交互 ≥10 的高交互票路径零变化。
- **遗留**：182 narrative engine 常驻进程重启与 J1.24/C41 同批（mapper 版本漂移
  §四-10）；改道票（B 类骑乘/cashtag）出现「世界级主体新产品被交互轴压死」case
  再议扩围。

---

### C40 Binance Inu——品牌劫持门「戏谑关联豁免」（J1.24，2026-10-01 用户裁定）★

- **Token**：BI (Binance Inu) `0xcaf66eb2c00d206d741a654face34768cf2a7777`（flap，
  provenance=A，vol24h#9/renowned24h#97，mc $1.6M；C37 轮曾以「零语料截词蹭名盘」
  合理拦——GMGN twitter_username 是 search query 垃圾值、website 是钓鱼站，C39
  修复后用户给到真实信息源＝币安广场发布会帖，与 C39 BI 本尊同一帖）
- **造行实验（判定层缺口定位）**：experiment_tokens 造行挂广场锚（官方认证 + 帖比
  token 创建早 36s）排除冷启动变量重跑——全链路只剩两层拦截：brand_hijack 0.72
  截断 + relevance semantic/lv1=10 分恰好压 `≤10` 截断线；stage2Total 72.9 已过
  60 线（无门即 high）。Jev 内部矛盾实证：nameReferent=super_ip 0.79（指向币安，
  放行向）vs brandHijackP 0.72（拦截向）。三维度映射：传播 ✅（timing 0.96）/
  审美 ✅（量级 A 档）/ 趣味 ❌ 无承载——「缩写双关×狗形象」在引擎里被当负向。
- **用户裁定**：原话「这里我觉得不是『劫持』，而是一种web3用户特有的戏谑/趣味性
  关联。当然它也必须是当前的热门新鲜事，否则就成了无病呻吟了」——戏谑关联是
  meme 创作手法，蹭的是**事件增量热度**而非品牌存量认知；新鲜事锚是必要条件
  （无病呻吟方向维持拦截）。前轮框架（「指代错位但有很强趣味性」）的三维度：
  有趣味（缩写双关×形象嫁接）/ 近期大事件有传播 / 符合 web3 审美。
- **落地 J1.24（题面锚 + 代码切分双防线）**：
  ① 题面：brand_hijack 豁免③扩充「缩写双关/谐音梗/形象嫁接（如大事件系统的
  缩写 × meme 动物形象）：语料锚定当前热门新鲜事时是 meme 创作手法而非劫持——
  蹭的是事件的增量热度而非品牌存量认知；无新鲜事件锚时纯玩品牌词根才是劫持」；
  ② mapper `punExempt`（web3FitAnchored/tierAnchored 同构确定性切分）：五条件
  全中才豁免——includeBrandHijack 且 P≥0.5（只救本会被拦的票）+ timing
  within_7d（当前）+ effTier S/A（热门）+ `credibleEventAnchor`（analyzer 传：
  superIP 语料锚 / 发行方自发宣告 / 广场官方认证源 任一——事件真实性有背书）；
  豁免范围两层：品牌劫持截断 + relevance≤10 截断（戏谑关联的本质＝弱字面关联+
  强语境关联，缩写双关在 relevance 体系天然落低档是特性不是缺陷，10 分照常计入
  总分——弱关联代价在分数上体现）；misspelling/quality 门不豁免（与戏谑语义
  无关）；timing/量级不达标的纯蹭名盘（无病呻吟）不豁免。审计 `jev.punExempt
  {timing,tier}` + reason 前缀「戏谑关联豁免(J1.24)」。
- **关键实证**：J1.24 题面下重跑 hijackP 0.72→0.69——题面锚影响甚微（J1.16/
  J1.23「Jev 分不动」第三次实证，代码切分是决定性防线）；豁免后 **mid 69.58
  PASS**（事件分 43.86(A档) + 关联 10 + 质量 15.72；正式入口 gmgn-bluechip-cases
  --case 复核 mid 69 PASS，生产链路含 GMGN 补源下同样生效）。
- **影响面（存量零误翻）**：34 行问过劫持题的存量行中，三条件（P≥0.5+within_7d+
  S/A 档）圈出 12 个候选——抽查语料锚全为无名小号推文/垃圾 URL（SSO 案
  `0xc3a4e39c…7777` 甚至挂 phishunt.io 钓鱼站），`credibleEventAnchor` 全 false，
  **零翻案**：anchor 门恰好挡住全部纯蹭名盘，豁免只解锁「可信事件源的新鲜事票」。
- **单测**：`node scripts/_test_brand_hijack_pun_exemption.cjs`（18 断言零 DB 五节：
  豁免矩阵六例/relevance 二层接力三例/审计与 reason/源码接线五项含 superIP 路径
  一期不挂/版本断言）；回归 web3_fit_anchor 12 / publisher_proxy 28 /
  narrative_signal_gate 13 全过。
- **遗留观察**：① superIP 快车道（mapSuperIPAnswers）未挂豁免——superIP 锚票
  名实题较友好且有 J1.21 referent 豁免，出现 case 再议；② 造行实验行留 2609e300
  （data_source='narrative_experiment'，勿删）；③ 冷启动问题本体（GMGN 垃圾社媒
  字段→真实源靠用户人肉）不在本案范围——广场 bapi 链路（C39）只解决「给了 URL
  能不能抓」，「去哪找 URL」是发现层问题。
- **意义**：meme 三维度全部进引擎承载——趣味（本案 punExempt）/ 传播（timing+
  spread）/ 审美（web3_fit 双向，C38）。

---

### C39 BI 案——币安广场链路整体修复：bapi 直连 + section 发布时间（2026-10-01）★

- **Token**：BI (Binance Intelligence) `0x176559b42f4587f12cd793d2a9cbd6d44dd47777`（flap，
  provenance=A，vol24h#41；per-case 验证轮 #16）
- **现象**：unrated——语料是币安广场官方号 2026-09-30 09:58Z 帖「Binance Intelligence
  产品发布会｜参与直播领5,000 USDC 红包」，但整条广场抓取链坏死：帖子页 WAF 202 空体
  + JustOneAPI key 是占位符（`your-j***`，从未配置）→ 恒降级 minimal（只有 postId 全空）
  → Jev 无语料。
- **修复一（bapi 直连，用户裁定 A）**：`binance-square-fetcher` 新增 `_fetchViaBapi`——
  `GET www.binance.com/bapi/composite/v3/friendly/pgc/special/content/detail/{postId}?lang=zh-CN`
  （浏览器 UA + Accept json + clienttype:web），**免 key/免登录/免渲染**，实测裸 curl 即通。
  返回 title/username/displayName/authorVerificationType(2=官方认证)/viewCount/likeCount/
  commentCount/shareCount/firstReleaseTime/hashtagList；正文 body 需登录态恒空（已知边界，
  标题通常已含事件核心）。优先级 bapi → JustOneAPI（key 有效时仍是全正文增强位）→
  minimal；bapi 成功即返回省配额。info 形状与 JustOneAPI 输出同构 + 新增
  `authorVerified`/`viewCount` 两字段。
- **修复二（section 发布时间）**：修一后重跑 BI 仍 low 59.68 差 0.32——卡时效 0。根因
  链：token 创建锚 wss_events 回退**正常工作**（`[TIME] Now: 2026年9月30日` 正确进
  state），但 binance-square-section 不输出发布时间 → Jev timing 题无时间信息可判 →
  unknown → 时效 0；而实际帖子 15:18:16Z vs token 创建 15:18:26Z **只早 10 秒**（抢发
  形状，within_7d 稳过 15 分）。`buildBinanceSquareSection` 补 `发布时间: …（今天/约N天
  前）`（twitter-section 同款模式，`{now}` 生产传创建锚保持补跑/回测幂等），state
  builder 调用点传 `nowMs`。
- **section 增强（同 commit）**：作者官方认证标记（`作者认证: 官方认证账号`——币安矩阵号
  发文强信号）+ 浏览量进统计行。
- **验证闭环**：BI 重跑 **unrated → high 79.93 PASS**（事件分 34(A档)+传播 24.6+时效
  15=73.6，stage3 关联 20+质量 15.77）；旧 minimal 缓存需 `ExternalResourceCache.
  invalidate(url,'binance_square')` 先失效（`analyze(ignoreCache:true)` 只绕 token_narrative
  行不绕外部资源缓存——PrecheckFailRetryService 对 GMGN 同款操作）。同轮 #20 币安带你飞
  `0x31f072d5187cc77667c3c81bf4fde577a1027777` high 79.39 PASS（带广场语料链的连带受益）。
- **遗留**：JustOneAPI 全正文增强位保留未删（未来配真 key 可拿登录墙内正文）；GMGN
  twitter_username 垃圾值（search query 串）未防护（C37 已记）。

### C38 久留美续——A 类量级锚换「Web3 买家视角」+ web3_fit 偏好正门（J1.23，2026-10-01 用户裁定）★

- **Token**：久留美（C25 本体）`0xfedf19759ba9c45b1a8345a2bde916b38acc7777`（four.meme，
  name=FX战士久留美；12.6x 毕业实验涨幅第一，本 case 时已毕业过观察窗）
- **现象**：J1.22 开播日重析维持 low 55.56（A 类 + C 档 22 + 传播 18.56 + 时效 15）。
  A 类量级锚=「角色自身及关联 IP 的**大众知名度**」（J1.16 ③），未开播角色=C 档
  置信 0.82 锁死；同票 web3_fit 只给 **marginal 0.44**（「主题小众」——Jev 按大众
  视角把未开播萌系动画判小众）。
- **用户裁定**：原话「A类判定标准，看起来合理，但是没有考虑到Web3用户的喜好，
  可爱风/极客风/奇怪的东西等等，Web3用户偏好很强。一个传统严肃的电影绣春刀宣传
  比这个case多得多，也不行。最根本上，还是要占到用户角度看叙事」——A 类量级的
  评价主体是 Web3 meme 买家不是大众，大众知名度排序与 Web3 吸引力排序可完全反向。
- **落地三件套**（J1.23）：
  ① `event_magnitude` A 类句换锚：形象吸引力=「会不会被 crypto 圈拿来做梗/二创/
  当吉祥物」——可爱萌系/极客风（AI/编程/科幻/交易投机文化题材）/奇怪猎奇荒诞=
  风格即吸引力（未开播大众无名也可到 B 档）；传统严肃风格大众知名度与宣传量不
  转化为 Web3 吸引力（通常 C 档以下）；已圈内梗（PEPE 型）=A/S 档。② `dimension2`
  A 类句配套双证据源（知名度 OR 圈内吸引力，同视角）。③ `web3_fit` 小众边界澄清：
  「小众」按 Web3 买家视角判——动漫游戏/极客/ACG 对 crypto 圈不是小众（用户群
  高度重叠）；强契合典型补可爱萌系 ACG 角色/极客风题材/奇怪猎奇乐子。
- **关键实证（题面不够，代码切）**：题面改锚后 182 重析久留美——magnitude C 档
  置信 **0.82→0.94 反而更死**（语料「2.5 万粉官号/未开播」客观事实锚死大众口径，
  Jev 分不动，J1.16 rcp / J1.18 pubProxy 同款教训），但 web3_fit **strong_fit
  0.88**（旧题面 marginal 0.44——小众边界澄清完全生效）→ 正信号已独立成题高置信
  产出，但 J1.19 只消费 unfit 负门、strong_fit 被丢弃 → mapper 补对称正门
  **web3FitAnchored**：category=A 且 strong_fit≥0.5 且原档 <B 时 effTier 锚 B
  （tierAnchored 同构；不越权 A/S——圈内喜好不证明世界级知名度；D/E 档随之放行=
  偏好推翻「量级不足」；仅 A 类——B 类有 pubProxy 锚，C/D/E 量级是客观规模偏好
  不替代；审计 `web3FitAnchored`/`web3FitStrongP` 落 stage1 jev 段，原判 tier 保留）。
- **验证闭环**：
  - 久留美 182 重析（J1.23 全量）→ **low 56.12 → high 72.26 PASS**：事件分
    27(B)·Web3偏好锚(原判C档,strong_fit 84%) + 传播 18.96 + 时效 15 = 60.96 过线；
    Marky（C37 速记）同日翻案 62.88——两票 strong_fit 跨 run 抖动 0.84-0.99 全在
    阈上，结论稳定
  - 负门回归：C30 死亡观察员 `0xd2a6d440…7777` / C31 太阳之勤 `0xe5fa214f…7777`
    重析均维持「Web3用户偏好不合」拦截——「小众」收窄方向在强侧，unfit 判定零漂移
  - 绣春刀3 `0xa7c9c86e…7777`（C12 立案样本）数据源已不可取（代币不存在）无法
    重析；影响面分析：三处改动不触 B 类判定路径（magnitude/dim2 均只改 A 类句，
    锚仅 A 类），B 类 rcp 门语义不变
  - 校准集 4 票（旧基线行快耗尽仅 super_ip_fast）：一致 3/4，翻转 1（币安人
    low→high 75.95）经查属 J1.22 品牌劫持名实一致改锚的已知效果非本次引入
  - **存量离线重放**（`scripts/narrative/web3fit-anchor-replay.mjs`，零 API 用
    J1.19-J1.22 落库 answers + 新 mapper 重映射，隔离锚增量）：锚条件命中 29 票
    （A 类 + strong_fit≥0.5 + 档 <B + low），**实际翻案仅 7 票**——其余 22 票被
    独立防线继续拦（低质衍生 5/小圈子亚文化 2/主体资格不足 4/IP二次利用 1/
    事件分不足 10），锚不绕过任何既有门。7 翻案票全为活盘（28-162 ticks，峰值
    1.39-2.54x）：锤锤 `0xa60e8168…7777` 61.92 / 完蛋小猫 `0x9623e0c7…7777`
    64.72 / 爱马 `0xf0210ac0…7777` 63.12 / 豚豚币 `0x4f7a5ea8…7777` 60.8 /
    来富猫 `0x65d8bcde…7777` 64.72 / 国庆 `0xe6cc3c23…7777` 61.68 / 奶方体
    `0x6010eff7…7777` 62.88（前五为动物萌宠典型偏好域；国庆/奶方体为边缘延伸，
    过线幅度 ≤1.68 观察即可）——翻案≠放行买入（另有 stage3 关联/质量门与买腿）
  - 单测 `_test_web3_fit_anchor.cjs` 12 断言（久留美实测 answers 数值复现 61.12
    过线/0.49 贴线不锚/B 类 W 类作用域/B·A 档原判不动/D 档放行/缺失 fail-closed/
    unfit 负门对称/双过半脏数据 unfit 先拦/审计三连）；回归 publisher_proxy 28 /
    narrative_signal_gate 13 全过
- **意义**：web3_fit 从单向负门（unfit 拦「大众热但 Web3 不喜欢」=绣春刀型）补全
  为双向偏好层（strong_fit 锚「大众无名但 Web3 强喜欢」=久留美型），A 类量级语义
  与「站到用户角度看叙事」裁定对齐。遗留观察：①「国庆」类节日文化票 A 类判定的
  边界（E 类文化符号误入 A？）；② marginal 档落库观察口径不变（J1.19 §四-32），
  strong_fit 锚后 marginal→strong 边界漂移量待实跑回看。

---


### C37 GM 同名蓝筹误拦——叙事锚优先豁免（rule 0.52，2026-10-01 用户裁定 B「同名不同意义不拦」）**〔已废除：同日 C47 AST 案 A+C 根治裁定整体移除 0.52，豁免函数随之删除；条目留档〕**

- **Token**：GREEN MORNING (symbol GM) `0x13920fe6467e9e3c852b8d365a036c995f0f7777`（GMGN
  vol24h#21，mc $0.7M；per-case 验证轮第 7 票）
- **现象**：rule 0.52 `same_name_blue_chip` 硬拦——AVE 找到 4 个同 symbol 蓝筹，最硬
  为 BSC 老 `gm`（0xa55c1e67…，fdv $40.8M / 5,729 持有人 / **24h 仅 2 笔交易**）。
- **调查**：语料锚 = CZ 推文（status 2105024133566468288，superIP 识别成功 tier S），
  token 名 GREEN MORNING 是推文直接派生；「GM」是 crypto 通用文化词（good morning），
  4 个蓝筹匹配（老 gm/GOMBLE/GM/GOLD MINT）恰是指代不唯一的证据。三问题：①拦截
  顺序权重倒挂——0.52 在 super-IP 快速通道之前，symbol 巧合一票否决 S 级叙事锚；
  ②通用文化词误伤蹭名规则设计意图（富贵案语义是「蹭名蓝筹认知」）；③死盘蓝筹
  （fdv 在认知亡）仍占名。
- **用户裁定**：方案 B——已识别独立强叙事锚时跳过同名蓝筹拦截；原话「如果同名
  不同意义，是不应该被阻塞的」。
- **落地**：`pre-check-service.mjs` 新增导出纯函数 `evaluateBlueChipNarrativeAnchorExemption`
  ——豁免信号 = superIP S/A 级语料锚 OR issuerSelfLaunch/CA 时间线检出（两者均在
  pre-check 之前算好，经 `performPreCheck` options 传入）；反向门 = `detectCorpusCashtag`
  命中 symbol 时不豁免（C28 iNu 案语义：语料即讨论该 symbol 资产 = 同名同意义，
  维持拦截）。isConflict 分支内豁免优先于拦截返回，日志与名实不符豁免分支对偶。
  单测 `_test_blue_chip_check.cjs` F 节 12 断言（S/A 级豁免矩阵/cashtag 反向/父推
  cashtag/tier 未知 fail-closed/源码接线三连），57/57。
- **验证**：GM ignoreCache 重析 → 豁免日志命中 → rating **low(0.52 拦) → mid(2)
  PASS**（preCheck=high_influence_with_media：CZ 推文带图片，媒体无法识别按影响力
  数据给 mid，既定设计）。
- **同轮 case 速记（per-case 验证轮 #8-#14）**：币安链能飞 mid PASS（web3_native_ip_
  early 粉丝 58 小号）；BINF mid PASS（@getbinference 实度 3.99 项目币）；招财猫 mid
  PASS（@binance 官方锚）；MTAT **high 84.5 PASS**（J1.21 回归确认）；Marky「王之蔑视」`0xf289d694…7777` J1.22 下 low 57.8 差 2.2（A 类 0.76 但 magnitude C，二次发射复读票叙事新鲜度已被原票消耗，判边界 case）→ 用户问「是否考虑了 Web3 用户偏好」引出关键核对：**web3_fit 答案 strong_fit 0.99 但 J1.22 只消费 unfit 负门，strong_fit 不参与计分**；恰逢 J1.23（C38）上线「A 类 + strong_fit≥0.5 → 量级锚 B」——**重跑翻案 low → high 62.88（事件分 27·Web3偏好锚(原判C档,strong_fit 100%) + 传播 20.88 + 时效 15，终分 73.2）**，预测 62.8 与实跑 62.88 精确对上；CSI
  (Chinese Super Inu) `0x74fef65b…7777` low「名字指向无名对象」——缩写双关梗票
  （CSI=中证指数文字巧合）+ Inu 拼接 + 3073 粉小号零互动语料（赞 0/转 0）+ magnitude
  D，上榜靠拉盘无叙事事件，**引擎拦截合理不改**；BI (Binance Inu) 同类合理拦
  （GMGN 侧也无有效社媒：twitter_username 是 search query 垃圾值、website 是随机
  字符 .lol 钓鱼站——零语料截词蹭名盘）。
- **观察点**：死盘蓝筹占名（老 gm 24h 2 笔）未处理——若后续出现「无 superIP 锚
  但明显独立叙事」被 0.52 拦的 case，再议活跃度门（方案 C）；GMGN twitter_username
  垃圾值（search query 串）拼成无效 x.com URL 未防护，记跟踪。

---

### C36 THESIS 实度 2.65 卡线——一篇产品陈述 + 链上新币相对尺度（P1.8，2026-10-01）

- **Token**：THESIS `0x4519cacc591aecc5f8476bebee43b11ffedd7777`（@thesisAI_family，6 天新号 771 粉）
- **现象**：用户质疑「我不能理解为什么说 THESIS 只有空话」并给出产品主推文链接
  （status 2103510570288963885）。P1.7 重析实度 2.65，卡 3 分豁免线下 0.35。
- **调查**（先证语料链路再看判分）：
  1. 目标推文（09-25 15:42Z「Trading isn't suffering from a lack of
     information…」产品陈述推）**在当时的 prestage state 里**（RECENT_POSTS 第 1
     条，P1.6 500 字截断保留主体：定位 + 四功能点）——fetch 链路无罪；
  2. Jev 作答原始输出：score 2.65、confidence 0.55、概率分布
     **{2:45%, 3:42%, 4:11%}**——不是「空话」断言（那是 0-1 分），是 2-3 档
     悬置均值；
  3. 当时语料 20 推构成：**1 篇产品陈述**（#1，用户给的这条）+ **17 条同文案
     中/英/印地语三语循环营销**（#8-#17 两轮循环，间隔几十分钟）+ 1 蹭白宫
     SI 热点 + 1 不可验证数据宣称 + 1 roadmap 提及。发币当天 20h 发 17 条。
- **根因**：P1.7 判据「3 分 = 功能/进展 AND **持续运营内容**」用成熟项目尺度
  评营销——同文案多语言分发被当「模板刷量」，而它是面向多语言市场的正常运营。
- **用户裁定（两条）**：①「推特上直接讲自己产品功能的，一篇足够」；②「对比
  对象是链上发的一天几万个新币，营销方面做一下不那么差就行吧，要啥自行车」。
- **落地（P1.8，commit `2ace60a`）**：第 5 题判据尺度校准——①产品价值维度：
  有一篇讲清「在解决什么问题/有什么功能」的产品陈述推即达标（不要求多篇
  佐证/进展证据）；②质量维度：新增「评估基准 = 链上每天数万新发 meme 币」
  总提示（纯喊单/无产品/蹭热点是普遍水平），有产品推垫底时多语言分发/常规
  宣传/热点借势不扣分，零产品描述 + 纯喊单才低分；2 分档改「通篇没有任何
  一篇产品陈述」、3 分档改「有一篇即够 AND 整体非纯营销空话」。mapper 零
  改动（纯题面），单测仅版本断言 bump（29/29 + 31/31）。
- **182 部署对拍（engine 重启后 ignoreCache 重析）**：
  - THESIS 实度 **2.65 → 3.32** 过线，豁免激活，评级 **low → high**（6 天
    新号 + 实度 ≥3 豁免年龄降档，771 粉走 high 带；reason 落「项目实度3.32
    分≥3豁免降档」）；
  - WIRED `0x55db4b1f497b1d7aa93354701883efc758367777` 实度 **4.25 → 4.44**
    维持 high（基础设施型不受放宽影响，4-5 档语义未动）；
  - 落库 `prestage-jev(P1.8/project)` / `jev-P1.8` 标识正确。
- **语义影响面**：实度分整体上移——「一篇产品推 + 及格营销」形状（多语言
  营销盘的典型）从卡线变过线；0-2 档语义收紧为「零产品陈述」（原「描述
  空泛」模糊档并入）；4-5 档不动。观察点：纯仿盘若抄一段产品文案进推文
  也会过 3 分线——归叙事层其余题（关联性/时机）把守，实度题只管「有没有
  在做事」。

---

## 三、Jev 问题集版本演进（卷二起）

| 版本 | 日期 | 改动 | 触发 Case / 依据 | commit |
|---|---|---|---|---|
| J1.27 | 2026-10-03 | ①event_magnitude 形状③收窄：公司产品发布量级按**产品实体自身**事件影响力评（母公司知名度不转移；第三方自传播才算大影响力，通稿不算）②dimension2 形状③配套 ③新增第 15 题 subject_entity 八档主体标注 ④币安豁免三处（D/W 边界句/magnitude 豁免句/fit 豁免句）⑤mapper `productEntityAcceptanceBlock` 产品实体接纳门：se∈{product_functional,product_character} 且 (strong_fit+fit)<0.5 → 阻断；豁免链 pubProxy/isW/rideMass/binanceCorpus（`detectBinanceCorpus`）/superIP ⑥C42 条件③ J1.27 适配：newProductP 改 1−P(0)−P(1)（形状③下概率质量移向 P4/P5，原 P2+P3 口径意外失效——RedCoin 43.17 偶发低分案） | C56 中国公司产品发布簇案（用户裁定「主体不是华为/网易而是它们发布的产品实体；要不事件形成大影响力，要不玩梗可爱形象——本质是 web3 用户能不能接纳」+ mid-turn「要豁免币安」；终校准真 state 156 票：产品门 11 票全中设计目标、币安 5/5 high、high→low 27/→mid 2；state 保真缺口 94/161 发现与校准方法论见案内） | 本 commit |
| （C56 mapper-only，题集 J1.27 不动） | 2026-10-03 | 平台官方源豁免三处：`detectPlatformOfficial` 主推作者 handle 硬集 `{binance, flapdotsh}`（大小写归一；刻意不查 in_reply_to 父推——BOB 路人号形状；作者字段双形状 tweet `author_screen_name`/account `screen_name`）→ ① rcp 概率门（routineContentProductBlock opts.platformOfficial）② **block_reason argmax 链 institution_routine/routine_content_product 豁免子句（FlapGuy 实测拦截位：argmax 0.55/none 0.30 而 rcp 概率仅 0.10，概率门盖不住——与 superIP 通道 institution_routine 豁免同语义）** ③ 产品实体接纳门；审计 `rcpPlatformExempt`（救票形状才落，忠实复算 argmax 链）；superIP 通道不传 opts（C23 域语义不变，币安官方号走注册表快车道） | C56 FlapGuy 案（用户裁定「flap 是 币安链的 meme 币发布平台，也是我们交易代币主要来源，跟币安链一个道理」；FlapGuy 0x2fb77ad0…7777 low→high 74.42/75.87、BOB 0xf2fca4cf…7777 路人号照拦双 low、RedCoin 77.52/81.75 基线不变、币安 5 票 flap 改动后复验全 high 不触达） | 本 commit |
| J1.26（mapper-only，题集 J1.25 不动） | 2026-10-02 | `nameReferentBlock` 阻断侧全域只累计 minor_other+common_word——notable_other（知名但非超级IP）全域退出：知名度梯度是错误判定轴（骑乘语境与 event_magnitude 双重惩罚、无独立信息），拦截责任移交 web3_fit unfit 负门 + minor/common + magnitude/tier；审计 `stage1.jev.nrNotableExempt`（全域）记「旧拦新放」形状 | C54 狮鹫案（两步裁定：①「超级IP就那么几个，名字不是它们就不行吗」→B类退出；②「核心问题不是实体不够知名，而是实体根本没有被接纳为Web3 meme币的可能」→全域；E2E：狮鹫翻high 74.44/CONVICTION截词0.98自拦/YAYA无名0.51自拦/Muse high 76.41=已知代价） | 本 commit |
| P1.9 | 2026-10-01 | ①token 类型题「币本身即IP」双形状：发明新称号 OR 社区/文化 meme 主账号（MarsCoin 型），账号随币而生/社区后建、年龄非反证；project 侧显式反例（社区 meme 主账号有官网/品牌/认证不算 project）②state 预计算措辞中性化（去「项目方官方代币」带节奏）③mapper `rateProject` 加 `opts.accountAgeGate`：web3ip 评级不吃 P1.3 年龄降档/P1.5 实度门（项目信用框架对 meme 范畴错配），推文<5 保留；reason 标签「账号基本面评级」 | C46 MarsCoin 案（用户裁定「社区自己搞的 Meme 币主账号不属于项目，属于 web3 原生IP」「很多 meme 币一出生就有账号」；重跑类型 project→web3ip 翻转=语义修正类题改生效实证） | 本 commit |
| J1.25 | 2026-10-01 | subject_unqualified 判据修正：主体=币名所指核心实体（形象/人物/IP/事件主角），陈述者账号绝不构成主体资格不足；形象类主体按形象自身知名度判，来源账号粉丝是 proxy | C43 土豪猫猫案（语义修正类题改生效实证：block argmax 翻转 none；与 J1.23 分数锚定类题改不动形成对照） | `923b31b` |
| J1.24 | 2026-10-01 | ①brand_hijack 豁免③扩充「当前热门新鲜事锚定的戏谑关联」（缩写双关/谐音梗/形象嫁接是 meme 创作手法非劫持，蹭事件增量热度非品牌存量认知；无新鲜事件锚纯玩品牌词根才是劫持）②mapper `punExempt`：P≥0.5 + timing within_7d + effTier S/A + credibleEventAnchor（superIP/issuer/广场官方认证）全中豁免品牌劫持截断与 relevance≤10 截断，计分照常；misspelling/quality 不豁免；审计 jev.punExempt + reason 前缀 | C40 Binance Inu 案（用户裁定「不是劫持，而是web3用户特有的戏谑/趣味性关联；也必须是当前的热门新鲜事，否则就成了无病呻吟」；J1.24 题面下 P 0.72→0.69 题面锚仍不动，代码切分决定性） | 本 commit |
| J1.23 | 2026-10-01 | ①event_magnitude A 类句换锚「Web3 买家视角形象吸引力」（可爱萌系/极客风/奇怪猎奇=风格即吸引力可到 B 档；传统严肃风格大众知名度不转化、通常 C 档以下；已圈内梗=A/S）②dimension2 A 类句配套双证据源 ③web3_fit 小众边界澄清（「小众」按 Web3 买家视角判，动漫游戏/极客/ACG 非小众）+ 强契合典型补三类 ④mapper `web3FitAnchored` 正门：A 类 + strong_fit≥0.5 + 原档 <B → effTier 锚 B（unfit 负门对称面；不越权 A/S；仅 A 类；审计 web3FitAnchored/web3FitStrongP） | C38 久留美续案（用户裁定「最根本上要占到用户角度看叙事」；题面改锚实证 Jev 分不动 C 档 0.94 但 strong_fit 0.88，J1.16/J1.18 同款代码切分） | `e7d0806`+mapper |
| P1.8 | 2026-10-01 | 实度题尺度校准：一篇产品陈述即达标（不要求多篇/进展）+ 营销按链上新币相对尺度评（有产品推垫底时多语言分发/宣传/借势不扣分）；2 档改「零产品陈述」、3 档「有一篇即够 AND 非纯营销空话」 | C36 THESIS 案（用户裁定「一篇足够」「要啥自行车」） | 2ace60a |
| （卷一终版：J1.22 / P1.7，2026-10-01；J1.8→J1.22、P1.2→P1.7 全历史见卷一 §三） | | | | |

**版本规则**：改题必 bump；DB prompt_type/prompt_version 可按版本筛历史结果。

---

## 四、未决事项（自卷一 §六迁入的活项；已解决项与原始排查过程见卷一）

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
