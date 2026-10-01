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
                                   ├─ account/community token / 发行方自发宣告（字面法+CA 时间线）→ prestage Jev（P1.7，5 题）
                                   ├─ super-IP 账号 → 快速通道（标准题集 + 代码预评分 + referent_memeability 条件题）
                                   └─ 标准路径 → 单次 Jev 调用（J1.22：13 常驻题 + web3_fit 第 14 题
                                      + brand_hijack / referent_memeability 条件携带）
分类/量级/时机/阻断/W类/关联性/质量/Web3偏好 原子化同问；聚合/阈值/截断全部代码端（jev-result-mapper）
```

- **Jev**（TypeSafe System One，api.typesafe.ai）：结构化决策模型（Choice/Score/Noul 三原语），
  无文本生成，单 token 一次投机性 fan-out 调用（秒级）
- **版本规则**：改任何题的 instructions/criteria 必须 bump `JEV_QUESTIONS_VERSION`（现 J1.22）/
  `JEV_PRESTAGE_QUESTIONS_VERSION`（现 P1.7）；DB 列 prompt_type/prompt_version 标识
  （`jev(J1.22/…)`、`prestage-jev(P1.7/…)`）
- **prestage P1.7 五题**：token 类型 / abm 名字关联 / abm Web3 流量 / 社区活跃度 /
  **项目实度 prestage_project_quality**（恒带；账号新 <30d + 实度 ≥3 豁免 P1.3 年龄降档，
  <3/缺分 fail-closed；判据全落语料文本层——不要求产品实证）
- **代码门族**（mapper 端确定性切分）：nameReferentBlock（阻断侧合计 ≥0.5）/
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
- **代码侧 pre-check 规则族**（无 LLM）：0.5/0.55/0.58 同名 / 0.52 同名蓝筹（含同事件
  ±1h 豁免、票龄门+自身体量豁免+脏 fdv 帽）/ 0.7 语料复用 / no_public_info 重试域
  （30min 窗 GMGN 缓存失效重析）/ 0.5x 爆款短路收窄（有推文文本或视频标题进 Jev）

---

## 二、Case 研究（倒序，卷二自 C36 起）

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
  ——端点大概率不在当前套餐/需单独开通。若开通可作一级回退（付费稳定、jina 降
  二级免费兜底），挂点在 `_fetchWebsiteContentInternal` 回退链，待用户确认套餐。
- **验证闭环**：RedCoin 重析 rule 4 消失（`preCheck=-`，语料 1137 字符 + 发布时间
  进 state）→ 进入 Jev 完整判定 stage3。单测
  `node scripts/_test_web_fetcher_jina_fallback.cjs`（19 断言零 DB 零网络，打桩
  globalThis.fetch：解析矩阵/主抓成功不回退/403 回退形状/回退也失败 null/空壳页
  走回退/源码接线六节）。
- **衍生判定点（W 类数学错位，待裁定）**：语料进来后新拦截点 = **W 类数学
  41.45 < 60**（产品 16.36 + 币安交互 0.09 + 时效 25）。Jev 全维度证据与 W 数学
  自相矛盾：event_category W 0.68 但 D 0.31（分类优先级表 W>D 把「机构官宣链上
  产品」推向 W）；magnitude A 档 0.72（HSBC 知名大公司）；name_referent super_ip
  0.70（RedCoin=HSBC 官宣产品名）；dim2 4.49 极强带（世界级机构）；relevance
  exact_match 0.91；block none 0.91——除币安交互轴外全维度世界级，唯
  `w_binance_interaction` 0.01（置信 0.99「无交互」事实正确：HSBC≠币安系）压死。
  语义错位同源 J1.17 注释（ChainPulse 案「W 交互分语义错位」）：交互轴为币安生态
  叙事票设计，「传统世界级机构的链上产品官宣」的叙事价值在机构本身不在币安交互。
  反事实：按 D 类标准数学 = A 档 34 + dim2 28~29 + 时效 15 ≈ 77-78 过线，exact 20 +
  质量 ≈19 → **≈85 high**。三方向待裁定：A W 类 effTier S/A 世界级主体锚（交互轴
  换轴/豁免）/ B 分类改道（机构官宣自家链上产品优先 D）/ C 维持拦截。
- **部署提醒**：narrative engine 常驻进程（182）需重启吃到回退逻辑（与 J1.24 同批）。

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


### C37 GM 同名蓝筹误拦——叙事锚优先豁免（rule 0.52，2026-10-01 用户裁定 B「同名不同意义不拦」）

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
31. **prestage data_fetch_failed 路径 rating=null 落库 bug**（-37，5 票实证含 TRX $100M）：
    apidance 空 stub 用户对象「成功」返回 → account 路径 data_fetch_failed 早退无落库
    载体 → 全 null 行 is_valid=true 缓存固化，违反 P1.4「分析完成必有结论」。修复
    方向待裁定：A 早退路径补 preCheckData 形状（rating low 落库）、B TwitterFetcher
    判空 stub 按失败处理——可并行。附带：GMGN creation_timestamp 部分不可靠
    （负年龄 10 张，降档方向恰好保守）
32. **0.52 AVE 同名搜索波动两问**（-38）：同 token 两跑一拦一放（now-based 快照漂移）；
    ① minFdv 100K 门允许 $130K 撒币小盘拦 $1.7M 票，门槛对「假蓝筹真撒币盘」是否
    过松（可议抬高或加 holders/fdv 比值形状校验）② 快照波动致判定不稳定是否可接受
    （波动方向=多拦少放）。待裁定
33. **（完结留档）YouTube 语料链路**（-33）：①②③ 已全部收口（extractVideoId 扩
    pattern / 8aca25e2 重启 / 熊熊波西重析端到端），④ 畸形 URL 维持 null 合理
    （事实陈述非待办）
