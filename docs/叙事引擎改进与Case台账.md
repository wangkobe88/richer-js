# 叙事引擎改进与 Case 台账

> 与《叙事分析引擎改进.txt》（随手 case 笔记）互补的完整台账：叙事引擎全部改进 + 研究
> 过的 Case，按时间倒序，近期详写。commit hash 可直接 `git show` 查细节。
> 分工原则（多 Case 反复验证）：**LLM 管叙事价值判断，代码管市场事实**——凡是市场事实
> （谁先发、涨了多少、有没有同名）一律代码侧判定，不指望 LLM。

---

## 一、现行架构一屏（2026-09-24 时点）

```
Token URL → URL 分类（含 IPFS metadata 解包）→ 数据抓取 → Pre-Check（纯规则，无 LLM）
                                   ├─ account/community token → prestage Jev（P1.2，4 题）
                                   ├─ 发行方自发宣告（品牌同一性+宣告指纹，纯代码）→ prestage Jev
                                   ├─ super-IP 账号 → 快速通道（标准题集 + 代码预评分）
                                   └─ 标准路径 → 单次 Jev 调用（13 题，J1.10）
分类/量级/时机/阻断/W类/关联性/质量 原子化同问；聚合/阈值/截断全部代码端（jev-result-mapper）
```

- **Jev**（TypeSafe System One，api.typesafe.ai）：结构化决策模型（Choice/Score/Noul 三原语），
  无文本生成，单 token 一次投机性 fan-out 调用（秒级）
- **版本规则**：改任何题的 instructions/criteria 必须 bump `JEV_QUESTIONS_VERSION` /
  `JEV_PRESTAGE_QUESTIONS_VERSION`；DB 列 prompt_type/prompt_version 标识（`jev(J1.10/…)`）
- **交易引擎直调**：策略 `narrativeCallCondition` 触发 → `NarrativeDirectCaller.getRating()`
  同步调 analyze（30s 超时 Promise.race，失败/超时/未配置 normalize 9 放行），策略用
  `narrativeRating` 在 preBuyCheckCondition 里裁决
- **结果全局缓存**：`token_narrative` 按 token_address 全局唯一，不挂实验
- **代码侧 pre-check 规则族**（pre-check-service.mjs，无 LLM）：见 §四.5

---

## 二、Case 研究（倒序）

### C8 桃花源记 0x1e09 —— B 类骑乘误放 + 同推文仿盘群 16s 抢发（2026-09-24）★

**现象**：0x1e093e9cfa51f8e75b38c8db1afa4398a14d7777（桃花源记，flap，铸币
2026-09-24T05:37:39Z）被 Jev 评 **high 73.16** → E5e 买门放行（rating=3 + 龙门 hot=0），
age=0.41min 买入后 -55.7% 冻结强平（E5e 最差轮）。用户裁定「明显不应该过」。

**时间线**（日志+experiment_tokens 实证）：宝玉（B 档 KOL，>4万粉）05:37:23 发推展示
自己的 AI 作品《桃花源记》重制版 → **+16s** 0x1e09 铸币（creator 0x90497450）→
4 分钟内 9 个同名盘密集抢发（0xe07c/0x0842/0xe554/0x4821/0xfa30…，≥5 个不同 creator；
**0x90497450 本人 38s 后再发第二个**——批量仿盘行为）→ 全没火（龙头检查 count=9
maxMultiple=0）→ E5e 买中活跃度最先达标的首发盘。

**评级事实链**（token_narrative，`jev(J1.10/B类)` 标准路径）：
- event_category=**B 0.52**（C 0.45 / W **0.02**）——非 Web3 产品发布，分类语义本身没错
  （three.js demo 确实是作品）；subject attribution 规则「作者自己的作品→主体=作者」→
  magnitude **2.97=B 档**（宝玉 >4万粉 KOL）
- name_referent=**subject_self 0.48**——币名=推文主体自己的作品名，放行侧（C3 阻断三项
  minor_other/common_word/notable_other 合计 0.44<0.5 不拦；super_ip 仅 0.07）
- stage2：事件分 27(B档) + 传播 23.55 + 时效 15 = **65.55>60** 过线；关联 exact_match
  满分 20 + 质量 13.83 → **73.16 high**

**三层缺口**（单看叙事判断逻辑自洽，缺的全是「发币者是谁/有几个」维度）：
1. **骑乘检测缺失（C7 双路径模型已知边界被踩中）**：creator 是第三方非宝玉。「第三方
   骑乘知名作者的作品名发币」结构标准路径无题可达——W 数学只在 event_category=W
   （被骑物是 Web3 产品）激活；本案被骑物是非 Web3 作品 → B 类直接按「主体=作品作者
   影响力」计分放行。C7 裁定「骑乘盘要求被骑产品影响力极高」只落地在 W 类计分上，
   骑乘非 Web3 作品/名人名/热点名的盘不经过任何骑乘门
2. **subject_self 豁免无量级门槛**：C3「天才」案豁免依据是「名字指向超级 IP」；本案
   主体 B 档（super_ip 0.07）照样全额豁免
3. **C1 仿盘群盲区复刻**：龙头门语义「有人火过才拦后来者」，9 盘全没火 → 全放行；
   pre-check 同名规则 0.5/0.55/0.58 对**首发者**天然不拦（更早同名不存在）。
   与 C1 嫦娥系列同构（LLM 区分不了仿盘），但 C1 龙头门补的是「后发追火」半边，
   「首发+全没火」半边无覆盖

**修复方向（2026-09-24 用户裁定 a）**：「如果是项目制作者自己发币，那么通过没有问题，
但是这只是第三方骑乘发币，这个产品的分量就远远不足了（如果是超级牛有巨大影响的产品
发布那可能可以）」——B 类骑乘门。b/c 方向未采纳（并发仿盘门暂不建；subject_self 叠加
量级门被豁免设计吸收）。

**落地**（2026-09-24，`jev-result-mapper.mjs` `rideDetourBelow`，纯代码无 LLM 新题）：
- **判定**：category ∈ {B, C} 且 name_referent 放行侧 subject_self+super_ip 合计 ≥ 0.5
  且 **super_ip 单项 < 0.5** → 改道 W 数学（w_product+w_interaction+时效，pass 60）。
  prompt_type 后缀 `-骑乘改道W数学` 可追溯
- **作用域 B+C 的原因（实证）**：v1 只挂 B 类，ignoreCache 重跑桃花源记时 Jev 判成
  C 类（B 0.41/C 0.56）绕过门仍 high——event_category 在 B/C 边界跨 run 抖动
  （三次 run：B 0.52→C 0.56→B），而骑乘特征 name_referent 质量稳定（0.55/0.56）。
  作品发布（B）与账号动态（C）在「作者展示自己的东西」语料上同构
- **super_ip ≥ 0.5 豁免**：名字的主人本身就是超级 IP——天才（0.97）/嫦娥 ×3
  （0.65-0.7）J1.10 放行侧语义直接豁免；B 类下同构覆盖「超级牛产品骑乘可放」。
  D/F/E/G 不入域（无实证 case，D/F 全量行已 low 零增益，E 热点先例不拦）
- **与路由层关系**：detectIssuerSelfLaunch 命中优先转 prestage（C7），到达标准路径的
  subject_self 必是 detector 不命中——真骑乘盘或 handle 无包含的漏检自发盘（C7 同源
  模糊区，误伤方向=漏检自发盘按产品分评偏低）
- **验证**：① 桃花源记三次 run 全拦（B 判定 28.2<60 / C 判定改道 / 终验 B 判定
  29.89<60 low）；② 天才/嫦娥豁免保持 high；③ **全量 93 行 jev 行重放**：评级变化
  恰好 4 行（桃花源记/Muse Charm/VELLINK/TenPayGo，全 high→low，其中 3 个是 E5e
  亏损票），FLYDRONES 改道但已 low 不变，零连带翻转
- **已知残余**：ss 在 0.5 附近的盘（如 TenPayGo 另一地址 0.37）不触发——合并质量
  门槛 0.5 是「过半」语义，边界盘漏放属已知接受面

**v3 补丁（2026-09-24，Muse 案：B 入 name_referent 阻断 scope）**：
- **case**：0xc3136948（Muse，B 类）——alexandr_wang 推 Muse 桌面版，第三方骑乘发币
  被 v2 双门皆漏（B 不在 `NAME_REFERENT_BLOCK_SCOPE` + 骑乘侧 ss+sip=0.35<0.5）
  评 high 放行。用户裁定「只是上了一个桌面版（而不是一个大产品），影响力不够，
  显然也不行」；拦截定性二次纠正：「不是知名但非超级 IP，而是**只是一个版本更新
  功能改进**」——版本更新不构成叙事事件
- **改动**：`NAME_REFERENT_BLOCK_SCOPE` 补 `'B'`（一行 + 注释）。版本更新语义在
  block_reason 题面**不可判**（Muse 语料实判 none 0.98/institution_routine 0.02——
  判「版本更新」需外部知识知道产品之前存在），不加题（加题须 bump
  JEV_QUESTIONS_VERSION 且 Jev 无此前置）；名字维度是结果正确的拦截路径：无论
  事件性质如何，骑乘非超级 IP 的产品名本身无独立生命力（与 C3 OneKey/CONVICTION
  同构）。与骑乘门互补：门拦「名字=主体自己的」（放行侧质量触发），scope 拦
  「名字指向非超级 IP 的他人对象」（阻断侧质量触发）
- **验证**：① Muse ignoreCache 终验：Jev 真实重调用实判 B 类，阻断侧合计 0.64 →
  **low**（label 取阻断侧最大项显示「名字指向无名对象」，拦截是合并质量语义）；
  ② 全量 104 行重放：变化 5 行 = 4 个 v2 已拦（TenPayGo 0x14d/VELLINK/Muse Charm/
  BOT）+ v3 新拦 TenPayGo 0xc6c（阻断 0.63，E5e 另一票）+ Muse 本行（终验已落 low）；
  ③ 零误伤：B 类 8 行中 AwesomeSeedance（阻断 0.62）旧 low 不变，无其他连带翻转
- **部署**：182 mapper scp + narrative engine 重启（14:43 加载 v3）
- **遗留发现（§六-11）**：V1 虚拟实验进程内存仍是旧 mapper，其 NarrativeDirectCaller
  直调写入的缓存行用旧聚合——BOT 行 14:30 落库 high（v2 应拦）即此问题

**v4 补丁（2026-09-25，ChainPulse 案：W 入 name_referent 阻断 scope）**：
- **case**：0x1fc2d27a（ChainPulse，W 类）——@danishless（3886 粉，1 赞 0 转发）推文链
  Twitter Article（**全文不可获取，state 仅 901 字符**），标题构想的 agent「ChainPulse」
  被第三方发币，蹭 09-22 BNB Agent Studio v4 发版。两次分析均 **W 数学压线过**
  （09-24: 产品18+交互18.1+时效25=61.1；09-25: 60.65）→ E5e2 买入 -36.1% 冻结强平
- **根因（W 数学的结构性错位）**：交互分「生态热度」档（10-19）的证据全是被骑对象
  字样（「A BNB Chain Agent」「BNB Chain shipped Agent Studio v4」）——**被骑对象火
  反而给骑乘盘加分**，与 C7「骑乘盘要求被骑产品影响力极高才放」直接矛盾；产品分
  对标题党创意无实体约束（语料 websiteGithub 组 used=0，18 分=「有特点新产品」
  基线）。骑乘门只管 B/C、W 不在 name_referent scope、detector 不命中 → 全漏
- **用户裁定（2026-09-25）**：「被骑对象的热度还是远远不够的，如果是超大超火的
  产品被骑，那没问题。但现在就是一个几千粉的用户，发了个1赞的产品介绍，被骑
  肯定不行的」——骑乘语义在 W 类同构落地：名字维度裁被骑对象分量
- **改动**：`NAME_REFERENT_BLOCK_SCOPE` 补 `'W'`（一行 + 注释）。super_ip≥0.5
  （超大超火被骑）仍在放行侧豁免；真自发盘 subject_self 高不受影响；交互/产品
  题面不动（不 bump JEV_QUESTIONS_VERSION）
- **验证**：① 全量 160 行重放：评级变化**仅 1 行 = ChainPulse**（阻断 0.68 拦，
  high→low）；W 类 23 行零误伤——自发盘（MUNCH ss0.90/mm ss0.80/TRENCH MCP
  ss0.66）与超级 IP（BNB的力量 sip0.88）评级不变，阻断侧高但本就 low 的 14 行
  （health 0.94/LEE 0.96/SOCK 0.99 等）无变化；② ChainPulse ignoreCache 端到端
  终验：Jev 真实重调（同 901 字符语料）→ 阻断侧 0.65 → **low**
- **部署**：182 mapper scp + narrative engine 重启（05:02 加载 v4）
- **对回测的影响**：E5e2 的 ChainPulse 亏损腿由此收口（缓存已终验落 low，下次
  重跑不再买）；Zen Monkey（E 类）不在本门 scope

### C7 ARENA 0x4b4d —— IPFS metadata 未解包，公告推语料丢失（2026-09-24）★

**现象**：0x4b4daf725bfe16f59249522faac053f1cbd47777（AI STOCK ARENA，铸币
2026-09-23T14:50:59Z）pre-check 规则4-B `public_info_fetch_failed` 拦截 → low(1)，
未进 LLM。`twitter_info=null`，唯一 URL = `raw_api_data.meta` 的
`ipfs.io/ipfs/bafkrei…`（被当 website 抓取，失败）。

**根因**：four.meme API 的 twitterUrl/webUrl 字段为空时，真实链接在 **IPFS metadata
JSON**（meta 指向，实测 353B）里——解包得 `twitter=x.com/AIStockArena/status/
2102770794636230709`（**发于铸币前 7m40s**，正规预热发币，与 C6"拉完才公告"不同）
+ `website=aiarena.meme`。URL 提取层（url-classifier `extractAllUrls`）只正则扫字符串，
不解包 IPFS JSON → 公告推文丢失；且 ipfs.io 网关正在 sunset（响应带 429/sunset 头），
web-fetcher 抓它必失败 → 规则4-B"有链接但获取失败"。

**盘面**（wss_price_ticks，outlier=false，共 1242 tick / 8.5min 寿命）：
+7s 内部拉到 9.7x → +80s（fire 时点）回落 3.05x → 峰值 **12.54x**（14:59:31）终局。
若评级放行，3.05x 进场吃到 +30%/+50% TP 阶梯大概率获利；但首 7s 9.7x 亦符合
C6 认定的内部抢先建仓模式。

**影响面**：`public_info_fetch_failed` 历史拦截 578 个；抽样 20 个中 4 个
（ipfs.io ×3 + pinata 网关 ×1）唯一语料入口是未解包的 IPFS metadata →
估计 ≈20%·100+ 个 token 同病。

**落地**（2026-09-24，用户裁定"当然要修"）：新增 `src/narrative/utils/ipfs-metadata-fetcher.mjs`
（多网关轮询 pinata→ipfs.io→4everland→w3s，单网关 8s 超时；失败走缓存冷却不缓存
null；TTL `ipfs_metadata` 365d/730d——IPFS 内容不可变同 tweet 档）+ data-fetch-service
提取层钩子：`raw_api_data.meta` 为 IPFS URL 时解包 JSON，其内 URL 经 extractAllUrls
并入分类池，meta URL 本身不再作为 website（JSON 非网页）；解包失败按原流程处理
（无行为回退）。**ARENA 端到端复跑验证**（ignoreCache）：规则4-B 清除 → 推文语料
进入（公告推文仍存活，priority 1）→ 标准 Jev 13 问路径，`prompt_type=jev(J1.10/W类-W数学)`，
终局 **W 类阻断 low（产品15.16+交互3.96+时效25=44.12<60，P=0.75）**——数据层修复
达成，该 token 仍 low 但已是实质判定（W 类把"发行方自有公告首发盘"判蹭仿 0.75
是否偏严 → §六-8 校准议题）。

**方案 A 落地**（2026-09-24，用户裁定两路径模型 + "A吧"）：W 数学误伤的根因是
**路径混判**——用户裁定双路径模型：① 第三方骑乘盘（币不是项目方发的）→ 要求
产品（项目）本身影响力极高，保留 W 数学；② 项目方/账号自发币 → 不应要求当前
影响力，应走账号判定路径。选 A（路由层检测自发盘 → 转 prestage，不做问题集拆分）。
- `detectIssuerSelfLaunch`（narrative-utils，纯代码）：tweet 语料上判**品牌同一性**
  （归一化后 symbol/name 与作者 handle/昵称任一方向包含，短串门限 3/4）+ **宣告指纹**
  （作者自己推文文本含该品牌）→ 命中即路由 prestage（`shouldUseAccountCommunity …
  || !!issuerSelfLaunch`），relatedAccounts 为空时补收作者账号
- **单测**：ARENA 命中；CONVICTION 截词（词来自推文但与作者身份无关）不命中；
  KOL 不以自己命名不命中；account 入口不适用
- **影响面**（最近 60 行 jev 路径）：tweet 语料 49 行命中 4（8%）——ARENA(27粉)/
  TenPayGo(29粉)/掌中乾坤(64粉)/币安王国(151粉)，全为小粉账号以自己品牌命名+宣告
  的目标人群（其中 3 个原被 W 数学阻断），无截词误入
- **ARENA 复跑终局**：`prestage-jev(P1.2/project)`——自发盘改道账号判定，project
  评级表按账号语义评 → **粉丝 27 < 60 底线 → low**（"27粉过不了也能接受，但是
  逻辑不要错"——路径已正确，不再被 W 数学判蹭仿）
- **残余误路由窗口**（已知，接受）：骑乘盘恰以被骑乘品牌命名（如假 PANCAKE）且
  语料挂的是品牌方自己的推文 → 误判自发盘进 prestage（语料层面无法证明钱包归属，
  品牌同一性≠所有权）。该路由优先于 super-IP 通道。但前置条件苛刻（双向包含+品牌方
  自有宣告文本+过账号门），且此结构下 W 数学/superIP 通道同样只评品牌影响力而非
  发行归属、同样倾向放行——增量风险有限。反向保护已验证：截词盘（CONVICTION 类，
  词取自推文但与作者身份无关）不满足品牌同一性，不会误入
- **品牌劫持例外评估 → 裁定不补**（2026-09-24）：币安王国 0xec648f…（@BK_bsc
  151 粉，name="Binance Kingdom" 蹭 Binance 品牌）与 ARENA 同构——W 阻断
  39.27<60（产品12.92+交互1.35+时效25），detector 命中，方案 A 生效后转 prestage →
  151 粉 project 评级表 mid(2) 会被放行。曾识别盲点：prestage 无品牌劫持检查
  （`shouldIncludeBrandHijackCheck` 对该盘实测 true，仅标准路径可达），假冒大牌的
  自发盘失去品牌劫持题兜底。**用户裁定：品牌劫持不拦——Web3 文化特有**，路由不做
  品牌劫持例外，自发盘一律按账号语义评（151 粉 mid 与 27 粉 low 均为账号判定正常输出）

### C6 BWA 0x724d —— KOL 账号链接发币，语料天然只有 profile 一行（2026-09-24）

**现象**：0x724d875ef143b0ae316bfae526770eae4b337777（BWA，desc="Binance World Assets"，
官网 bwa.bot，x.com/JackKongNano 60,388 粉/蓝V/2017 老号/Nano Labs）prestage P1.2 判 low：
名称关联 none(P=0.73) ｜ Web3流量 no_traffic(P=0) → abm 两条件全不满足 → numericRating=1 被买入门拒。

**根因链**（三层叠加，均为机制性）：
1. **语料**：four.meme 元数据只挂账号链接（无推文链接）→ `twitter_info` 仅 profile 一行；
   账号抓取不抓时间线（twitter-fetcher `_fetchAccountInternal` 只调 getUserByScreenName）
2. **发币公告推文永远进不来**：公告 status/2102904584091934796（snowflake 23:34:57.582Z
   = 铸币 eventTs 23:34:38 后 19.6s）——分析 23:34:44 触发（铸币后 6s）、prestage
   23:34:57.5-58.4 判定，抓取窗口内推文尚未发出；补跑/回测也拿不到（不抓时间线）
3. **路由无此路径**：super-IP 快速通道只认人工名单，且条件为 `superIPInfo &&
   !shouldUseAccountCommunity`（账号链接入口恒走 prestage）；HIGH_INFLUENCE_ACCOUNTS
   同为名单制；abm 两条件（名称关联+Web3流量）不含"发币公告热度/账号影响力"维度，
   60k 粉/蓝V/老号在 abm 分支零参与（粉丝数只在 project 评级表用；Jev token_type
   两答 project 0.51 / web3_native_ip_early 0.49 也未被消费——地址未验证固定走 abm 分支）

**附带发现**：desc="Binance World Assets"——若走标准路径，`shouldIncludeBrandHijackCheck`
会命中 Binance 触发 W 类品牌劫持题；prestage 无 W 类问题，该维度同样不可达。

**用户裁定**（2026-09-24）：**不建路径，本案存档**——KOL 发币后挺久才在推特公开宣传，
公告时价格已被发行方自己拉起来、正在出货，追公告=接盘；prestage 判 low 对此类盘
恰好形成拦截保护。（备案：本条公告推文实测为铸币后 19.6s 发出，若"挺久"另有所指，
结论不变——均不改变拦截裁定。）曾评估方向存档备查：A 账号入口补抓时间线转标准
13 问（W 类可达）/ B prestage 加公告影响力维度 / C 名单制。若未来重建，公告滞后
应作为出货/接盘风险信号参与判定，而非买入叙事。

### C1 嫦娥系列 —— 同推文仿盘群 → E3 龙头门（2026-09-24）★

**现象**：源推文 `2101613496303833524`（嫦娥六号相关）当天衍生 25 个名字含"嫦娥"
的代币，其中挂上 `narrative_material_id` 的 10 行 = 7 嫦娥 + 3 天鹏（同推文**不同名**）。

**关键事实**（wss_price_ticks 实测）：
- 最早 0xf805d6…（12:12:40 UTC）峰值仅 **1.5x** ——首发无优势
- 唯一火的是**第 6 个** 0x47da25…（12:39:16 创建）：峰值 **12.2x**，首达 5x = 13:21:47Z，至今 +996%
- 天鹏 ×3（15:02~15:03 创建，全部死盘）——**同推文不同名**，pre-check 同名规则（0.5/0.55/0.58）全部抓不到
- Jev 评级：同推文 3 个 token 全部 high —— **LLM 区分不了仿盘**（叙事价值判断没错，错的是市场地位）

**用户裁定**（2026-09-24）：
1. 不要求叙事首发（首发无优势，第 6 个反而 12.2x）；
2. 但同叙事（依托同一源推文，tweet_id 精确匹配）下**已有代币火了（峰值≥5x）**，
   其余代币在**龙头首达 5x 后 24h 内**买入不通过。

**落地**：`narrativeLeaderHot` 因子全链路（commit `6ee6a5b`）：
- 新服务 `SameNarrativeLeaderService`：同 `narrative_material_id` 候选（**不限名**），
  ticks 严格事前语义（只算 block_time ≤ t，尘门 price_outlier=false + bnbAmount≥0.002 与首价同门），
  分页 3 页 + 首达 early-exit；无 tweet/查询异常 fail-open 全 0 放行（漏拦方向，不误杀）
- 三因子：`narrativeLeaderHot`(0/1) / `narrativeLeaderCount` / `narrativeLeaderMaxMultiple`；
  默认 0 不用 null（ConditionEvaluator null 比较恒 false 会误拒）
- 回测无前视：checkTimeSec=回放时点（涨幅计算只用历史 ticks）

**离线验证**（三时点全过）：

| 判定时点 | 期望 | 实测 | 说明 |
|---|---|---|---|
| 龙头 0x47da @ 12:40:36 | 0 | 0（max 1.7x） | 首达前 41min，放行吃到 12.2x |
| 仿盘#7 @ 12:44:08 | 0 | 0（max 2.2x） | 全组尚无人到 5x |
| 天鹏 @ 15:03:47 | 1 | 1（max 12.2x） | 首达 13:21:47Z 在 24h 窗内，拒 |

**回测**：E3 = `adec51f7-6436-4741-a459-131d62eead99`（源 572033ad，策略 e3.json）——
与 E2 完全同结果（6 买入全同、ΣPnL 0.2391 BNB）：窗口内 hot=1 场景 0 次（天鹏型死盘活跃度
不足未 fire），零误杀；龙头 0x47da 判定 trail（12:42:37，count=9/maxMultiple=1.7/leaders 空）
实证无前视，放行后吃到 +337.7%。详见 §五/§六。

### C2 币安 agent 广场 0x355c —— 地址验证被短路（2026-09-23）

**现象**：0x355c11826d33ac0cce61f4c1f71eef9363707777（币安 agent 广场），
推文 x.com/_OSBook/status/2101673737015947354 里**有合约地址但没匹配上**。

**根因**：account 规则里账号质量达标分支直接短路了地址验证，bio/推文公示的地址被丢弃。

**修复**：commit `308b547` —— 账号质量达标分支补做地址验证。

### C3 截词借势群 —— CONVICTION / OneKey / YAYA / 天才 → J1.9→J1.10（2026-09-23）★

**用户裁定**：截词/截名发币要成立，**名字的主人得是超级 IP**——被超级 IP/大V提到 ≠ 名字有
生命力，知名 ≠ 超级 IP。

| Case | 结构 | 旧评级（J1.8） | J1.10 | 说明 |
|---|---|---|---|---|
| CONVICTION | 截自 133 万粉 KOL 推文的词 | high 76.88 | **low**（P≈0.84） | 首个触发改版的 case |
| OneKey ×5 | 257 粉小号 + Flork 纠纷（267k 粉声明中"Onkey"失败会展） | 边界漂移过线 | low（0.63-0.98 连续多轮） | J1.8 时 58-59.8 惊险拦住 |
| YAYA | 何一推文 @的周边账号 | 以 subject_self 0.57 **逃逸** | low | 指向无名当事人≠主体自己 |
| 天才 | CZ 原话 "not a genius" | high | **high 80.07** | 名字指向超级 IP 豁免，不能误杀 |
| 嫦娥 ×3 | 同推文仿盘 | high | high 72.5+ | LLM 侧无从区分（→ C1 龙头门） |
| SHIELDCAT | 截词 | 通过 | low（阻断侧 0.67） | **待用户裁定** |

**演进**：
- J1.9（`ce040b6`）：block_reason 加 word_extraction 复合选项 + subject_unqualified 扩作用域
  —— 六轮措辞实验证明 Jev 无法用一个选项同时覆盖"截词"与"指向无名当事人"两种结构，**废弃未上线**
- J1.10（`89e31ba`）：**name_referent 独立题**（6 选项：subject_self / super_ip / notable_other /
  minor_other / common_word / none_related）替代 word_extraction；mapper 代码端阻断：
  minor_other + common_word + notable_other **阻断侧合计概率 ≥ 0.5**（argmax 单项在五五开时跨
  run 抖动，合并质量后稳定），scope C/D/F/G，标准 + superIP 双路径
- 误伤抽查：11 条旧 high/mid 不受影响（B/E/W/A 类）；新拦 4 条均为无名主体截词结构
  （精神病圈子 / 傻韭菜 / CULT / 梦之队）
- 配套修复：校准/dryrun 脚本去掉 is_valid 过滤（09-23 全表缓存失效后旧基线行 is_valid=false
  但仍是有效对比基线，过滤会永远取 0 样本）

**已知未覆盖**：OneKey Flork 纠纷语料（267k 粉声明中的失败会展"Onkey"）——四种措辞 Jev 均稳定
判其为"事件主角名"，需**"币名指向 ≠ 计分主体"新维度**才能拦，待裁定。

### C4 抖音爆款视频 0x4498 —— unrated 放行裁定（2026-09-23）

**现象**：0x4498ff27e5b51c91f5cd3ce2dc4d533c82d17777（抖音视频 64.8 万赞）——视频内容无法解析
→ unrated(9)，被旧条件 `==2 OR ==3` 拦截。用户认为"数据好就该放行"。

**裁定**：引擎语义**不动**（爆款视频门槛触发 → unrated，"内容过于流行无法解析"），
放行在**实验策略侧**解决——叙事实验条件用 `narrativeRating == 2 OR == 3 OR == 9`。

**后续实践修正**（E2，09-24）：直调失败/超时也 normalize 成 9，==9 放行让"未评级"混进爆款
语义 → E2/E3 收紧为 `==2 OR ==3`（只买叙事评级确定的）。见 §五。

### C5 572033ad 叙事覆盖排查（2026-09-23）

实验 572033ad（BSC flap/fourmeme 混合，6161 token）排查终局事实：
- 覆盖 133/6161（is_valid 全 true）：**129 low / 2 mid / 1 unrated / 1 空值**
- final>50% 的 11 个中 9 个有评级；max>50% 的 49 个中 43 个有
- 真缺口仅 2 个且补跑无价值：蝴蝶家园（101%，仅介绍无语料）、🦋（92%，完全无语料）
- 页面混排监控池 token（status=monitoring 行与实验 token 混排）；worker 的 14779 个叙事任务
  几乎全是监控池的，与本实验交集仅 1
- 两口径别搞混：filter-final-50 = `analysis_results.final_change_percent`（11 个）；
  filter-max-50 = `max_change_percent`（49 个）
- 配套 web 修复：列表接口轻量化 16.8s→2s（`caf9a84`）、叙事列渲染崩溃 score 对象流前端
  （`1e43970`）、批量接口列裁剪（`106caa8`）、Jev prompt 全文落库 + 结构化展示（`a3ade9c`）

---

## 三、Jev 问题集版本演进

| 版本 | 日期 | 改动 | 触发 Case / 依据 | commit |
|---|---|---|---|---|
| J1.8 | 09-20 | 代码端量表校准：MAGNITUDE_TIER_SCORES S39/A34/B27/C22（108 样本定参）；DIM2_BANDS 分位带；一致率 29%→54%（含相邻档 68%） | Jev 迁移收尾 | `c430425` |
| J1.9 | 09-23 | block_reason 加 word_extraction + subject_unqualified 扩 scope——**已废弃**（Jev 无法单选项覆盖双结构） | CONVICTION/OneKey | `ce040b6` |
| J1.10 | 09-23 | name_referent 独立题（6 选项）+ 阻断侧合计概率 ≥0.5；标准+superIP 双路径 | CONVICTION/OneKey/YAYA/天才 | `89e31ba` |
| P1.2 | 09-20 | prestage Jev 化（4 题：token 类型/abm 名字关联/abm web3 流量/社区活跃度），全部确定性数学代码端 | Jev 迁移 P3 | `08d1ed5` |

**版本规则**：改题必 bump；DB prompt_type/prompt_version 可按版本筛历史结果。

---

## 四、系统级改进时间线

### 4.1 Jev 迁移（09-20 → 09-21，P0-P5 全部完成）
3-stage 生成式管线（Stage1 预处理 → Stage2 分类评分 → Stage3 决策）→ Jev 结构化决策。
P0-P1 客户端+问题集+state+映射（`9b76a1b`）→ P2 主路径+superIP（`7a4d1d8`）→ J1.8 校准
（`c430425`）→ P3 prestage P1.2 + meme 死分支删除（`08d1ed5`）→ P4 生成式 LLM 层全面退役
（`8758977`）→ P5 上线 182（引擎 nohup，maxConcurrency=30）。
遗留：主路径带真实语料端到端待新 token 自然验证（判据：新行 prompt_type 为 `jev(J1.x/…)`）。

### 4.2 交易引擎直调 + 全局缓存（09-22）
- `6288934`：实时引擎接入叙事直调（narrativeCallCondition 触发，Jev 秒级；失败/超时=9 放行）
- `af7c0ef`：BacktestEngine 接入直调（时序穿越声明：analyze 用当前语料分析历史 token，
  绝对收益不代表实时可得，只看相对增量）
- `05bd46c`：**结果改代币级全局缓存**——同一代币多次实验不再重复分析；experiment_id 不再写入
- `6565370`：新代币语料补采（four.meme API + flap IPFS metadata → raw_api_data，
  fire-and-forget ~10s 级）
- `24d033b`：web 层恢复并适配 Jev 新格式

### 4.3 时效基准改代币创建时间（09-23，`98e3f03`）
过期语义 = **发币时语料是否新鲜**（发币时间 vs 发推时间），与何时分析无关。修复补跑/回测/
延迟分析被分析时点污染的问题（2-3 天前的推文曾被 expired_tweet 10 分钟规则整体误拦成 low）。
覆盖：pre-check 规则 2.1/2.2、buildJevState/buildPrestageState、super-IP calculateTimeliness。
创建时间缺失则跳过过期检查。

### 4.4 数据抓取修复
- `404dea1`：getUserTweets 按 next_cursor_str 翻页凑满目标条数（sapi 每页固定 ~20 条且忽略 count）
- `308b547`：账号质量达标分支补做地址验证（C2）
- apidance 超时收紧 + 推文时间窗（2026-09-25）：账号路径拖慢主因定位为 data-fetch 层
  （Jev 本身 p50≈1s 无辜）——每账号 ~6 次串行 apidance 调用 × 坏页率 ~2% × 30s 死等
  × 无重试，单 token 命中率 ~22%（136 token 中 34 个 ≥10s，阴阳协议案账号收集挂 30s）。
  两项修复：① makeRequest 超时 30s→5s（new-apis.js + index.js 同源同改）；② 账号收集
  推文窗口化——untilSec = token 创建时间-24h，getUserTweets 翻到早于窗口下界的推文即停
  且页内越界推文丢弃，getAccountWithFullTweets 有窗口时不再 Math.max(100) 凑数
  （发币 CA 公告在创建后几分钟内必在窗口内；创建时间缺失回退凑数口径）。窗口从
  NarrativeAnalyzer 四处账号收集点 + analyzeAccountCommunityToken 规则验证点全程透传
- IPFS metadata 解包（2026-09-24，C7）：`ipfs-metadata-fetcher.mjs` 多网关轮询
  （pinata→ipfs.io→4everland→w3s，单网关 8s 超时，64KB 上限，失败缓存冷却不缓存
  null），data-fetch-service 提取层钩子——meta 指向 JSON 内的真实社交 URL 并入分类池
- 发行方自发盘路由（2026-09-24，C7 方案 A）：`detectIssuerSelfLaunch` 纯代码检测
  （品牌同一性+宣告指纹）→ 转 prestage 账号判定；双路径模型——骑乘盘走 W 数学
  （要求被骑乘产品影响力极高），自发盘按账号语义评（不要求当前影响力）
- 骑乘门（2026-09-24，C8）：`rideDetourBelow`（jev-result-mapper）——B/C 类第三方
  骑乘推文主体作品名发币改道 W 数学（subject_self+super_ip≥0.5 且 super_ip<0.5；
  super_ip 过半豁免=天才/嫦娥/超级牛产品统一语义）。双路径模型补齐「骑乘非 Web3
  作品」半边（C7 只覆盖了骑乘 Web3 产品的 W 类原生路径）
- name_referent 阻断作用域扩 B（2026-09-24，C8 v3 Muse 案）：B 类骑乘非超级 IP
  产品名（Muse 桌面版=版本更新，不构成叙事事件）v2 双门皆漏 → B 入
  `NAME_REFERENT_BLOCK_SCOPE`（阻断侧合计 ≥0.5 拦）；版本更新语义题面不可判
  不加题，名字维度拦截（骑乘非超级 IP 产品名无独立生命力）
- name_referent 阻断作用域扩 W（2026-09-25，C8 v4 ChainPulse 案）：W 类第三方
  骑乘文章构想名发币（3886 粉 1 赞 Article 标题党）——W 数学交互分被被骑对象
  字样喂饱（被骑对象火反而加分，与 C7 骑乘语义矛盾）→ W 入 scope（阻断侧
  ≥0.5 拦，super_ip≥0.5 超大产品豁免同构）；重放 160 行仅 ChainPulse 1 行翻转

### 4.5 代码侧 pre-check 规则族（无 LLM，与 LLM 分工的"市场事实"侧）
| 规则 | 判定 | 局限 |
|---|---|---|
| 0.5 | 同名蹭热度：发布前一周内同名代币且其中已有"起来过" | 要求同名 |
| 0.55 | 同名+同推文重复叙事（symbol 归一化防隐形字符规避） | 要求同名 |
| 0.58 | 同名活跃跟风：10min~2h 前有活跃同名 | 要求同名 |
| 0.7 | 语料复用（3 分钟豁免窗口） | — |

三条同名规则都抓不到"天鹏"型同推文不同名仿盘 → E3 龙头门补位（C1）。

### 4.6 旧 3-stage 时代纪要（2026-04 ~ 05，已被 Jev 全面替代）
04-05 起叙事分析持续升级（`969533a`…）→ 04-07 3-stage 架构（`2552e81`）→ Stage3 决策树重构、
C/D 类双维度评分（`2acebff`）、F 类发现型（`04d4e22`）、G 类推测型（`6865b43`）、D/E 政治 meme
豁免（`b5c5297`）、合约地址未命中硬性限制 account_based_meme（`7df6856`）、同名跟风检测
（`7650a24`）、币安广场/Instagram 抓取器（`032f983`）、MiniMax 主模型（`122b158`）、Worker 内存
泄漏修复（`deb891d`）、Super IP 通道三度存废（最终 `4ff7fb4`+Revert 保留，`f28fb3a` 改为
tweetAuthorType 因子）、05-01 语料去重豁免 5min→1min + 无社交信息改 low + 推文过期 30min +
多推文支持（`fe92d72`/`42f5d66`）、09-04 与电报通知解耦（`968748d`）。

---

## 五、策略侧应用（回测 E1→E2→E3→E4，源 572033ad）

| 实验 | id | preBuyCheckCondition | 差异 | 结果 |
|---|---|---|---|---|
| E1 | c0150101 | `==2 OR ==3 OR ==9` | 基线（跑在 J1.8） | 胜率 28.6% |
| E2 | f5adb5e7 | `==2 OR ==3` | 去掉 ==9（未评级不混入爆款语义）；跑 J1.10（与 E1 双重差异，对比注意归因） | 胜率 33.3% |
| E3 | adec51f7 | `(==2 OR ==3) AND narrativeLeaderHot == 0` | E2 + 同叙事龙头门（C1）；跑 J1.10 | **与 E2 完全同结果**（6 买入全同、ΣPnL 0.2391、胜率 33.3%）——零误杀；龙头 0x47da 放行吃到 +337.7% |
| E4 | 83453b6e | 同 E3 | 买门加 `holders > 5`（E3 唯一差异；narrativeCallCondition 同步） | 4 买入、胜率 50%、ΣPnL 0.3208——拦掉 NOINT（fire 时 holders=2）与天才（holders=3）两个最大亏损笔，全部盈利笔 holders≥6；0x47da 大腿 +337.7% 保留 |
| E5 | cfe6d57b | 同 E4 | **卖侧全新 8 腔**（E4 买侧不动）：P1 -50% 硬底全清 / P2·P4 针臂（riseVel5m+risePct5m，猛档全清·普通档卖半）/ P3·P8 毕业臂（graduationProgress≥0.9 卖半、≥0.98 再卖半）/ P5-P7 RSI 阶梯（5m RSI9 实时口径 85/78/75 互斥带卖 0.4/0.3/0.25）；sellPercentage 部分卖全链路（默认 1=全仓，E4reg 4c258cde 逐笔对拍零污染） | **ΣPnL 0.0230——针臂秒卖风险完全兑现**：4 轮全部 P2 猛档 hold 0-2s 全清（0x47da 仅 +1.2%）。根因：risePct5m/riseVel5m 市场口径（5min 窗谷→现价，含买前涨幅）+ 动量买门（buyVolumeBnb≥1.5 拉升中买入）→ 买入瞬间针臂即成立 |
| E5b | c204a510 | 同 E4 | E5 + **针臂双修正**（2026-09-24 用户裁定）：① FA 针臂改持仓口径（窗下界=max(5min, 买入时间)，无仓恒 null fail-closed）；② 针臂市值门 graduationProgress≥2/3（≥毕业市值 2/3 才许针臂卖——早期拉升针不卖，只卖接近毕业的末段逼空针） | **ΣPnL 0.4456（E4 +39%，E5 19 倍）**，买侧 4 笔与 E4 字段级一致。0x47da **+497.1%**（vs E4 +337.7%）：P5 T85 卖 40%@+258% → P4 针臂卖 30%@+527%（市值门后=末段逼空收割）→ P3 毕业臂①卖 15%@+807% → 剩 15% 冻结估值@807%。代价：osbook -3.7%（E4 +26.2%——3.6min 快冲票 RSI 无 warmup、grad<2/3 针臂拦、峰值 96.8% 后硬底出，漏中段止盈）；嫦娥死盘 -26/-24% 冻结（互有胜负） |
| E5c | 1f69dc53 | 同 E4 | E5b + **P1 止损市值化**（2026-09-24 用户裁定「不能使用下跌幅度做止损，顶多到一定市值止损」）：`drawdownFromHighestSinceLastBuy <= -50` → `graduationProgress < 0.05 AND profitPercent < 0`（市值跌破毕业锚 5% 且低于成本才全清；建仓瞬间价格≈成本不误触） | **ΣPnL 0.7799（E4 +143%，E5b +75%）**，胜率 50%。osbook 由 -3.7% 翻为 **P2 针臂猛档全清 @+333.2%**（触发快照：grad=0.681 市值门刚开 + 持仓口径 rise=361% + vel=155%/min + rsi=null warmup 宽容——末段逼空教科书触发）；0x47da/嫦娥与 E5b 逐腿一致。四臂角色定型：P5 早段收割 / P2·P4 末段逼空 / P3·P8 贴锚毕业 / P1 纯防归零 |
| E5d | 08a85d2c | 同 E4 | 同 E5c（跨窗口验证：源 fb03389c，43,657 ticks / 5,671 tokens / 全 flap） | **ΣPnL 0.3196，胜率 50%（4/5 轮）**。P2 针臂跨窗口依旧主力（×2 全清 @+382.6% P50）；RSI 三档全开张（BRX1600 五腿轮：P7@467%→P4@598%→P5/P6@+61/53%）；币安王国 114s 全清 @+142%。**发现执行链精度 bug**：BRX1600 余仓 6140 token 强平腿静默失败（详见下方精度修复记录）——实际含未强平僵尸仓 |
| E5e | 6eced095 | 同 E4 | 同 E5c（跨窗口验证：源 c4a5a57f，35,935 ticks / 4,112 tokens / 全 flap） | **ΣPnL -0.2668，7 轮全败、0 策略腿触发**（全部冻结强平 -24.7%~-56.1%，峰值 25.6%~130% 全漏）。**根因=票型错配非 bug**：7 票 grad max 全部 0.13~0.28（无一接近毕业）→ 市值门 2/3 把 5/7 票的裸 P2 触发全部拦掉（TenPayGo 裸 P2 @+127% grad=0.135 被拦）；活跃期全部 2.1~27.6min < RSI warmup 42.5min → RSI 三臂全程 null；末态 grad>0.05 → P1 不触发——「中段止盈臂缺失」缺口的极端呈现（c4a5 窗口全是小票冲高回落型），市值门 trade-off 待裁定。另：桃花源记 0x1e09 轮的叙事放行为 C8 case（B 类骑乘误放+同推文 9 盘仿盘群） |
| E5d2 | 67e044fb | 同 E4 | 同 E5c **同源复跑 E5d**（fb03389c；Decimal 精度修复后的验证 run） | **ΣPnL 0.7074（vs E5d 0.3196，+0.39），胜率 60%**。**精度修复验证通过**：BRX1600 由 E5d 的「RSI 三腿 + 末段 P2 40+ 次触发全失败 + 强平腿静默跳过 = 6140 token 僵尸仓」变为**五腿轮 P7→P4→P5→P6→P2 末段逼空全清完整落袋 +385.9%**；SpaceXAI 四腿轮 +270.7%、币安王国 114s P2 全清 +139.6%；两强平轮 -26.2%/-66.1% 与 E5d 一致（五仁能敌/跳舞蛙型）。卖点反事实全部配置（peak8·dd12 等 12 组）Σ 0.45 < 实际 0.71——现行 8 腔在 fb 窗口显著优于 trailing 组合 |
| E5e2 | 67af6e3f | 同 E4 | 同 E5e 策略（e5.json 原样）**叙事 v2+v3 后同源复跑 E5e**（c4a5a57f；前置：7 翻转票 ignoreCache 缓存刷新，5 low 2 high——两 high 均为 v2/v3 不翻转行） | **ΣPnL -0.0733（vs E5e -0.2668，减亏 72.5%）**，2 轮全败 0 策略腿。**买侧收缩 7→2**：拦 5 票（桃花源记=骑乘门；Muse 0xc313+TenPayGo 0xc6c=B 入阻断 scope；VELLINK=骑乘改道；TenPayGo 0x14d=C7 detector 命中→prestage abm 两条件不满足→low，路由层功劳非骑乘门）；仍买 2 票：ChainPulse 0x1fc2（**W 类原生 W 数学** high——骑乘门不适用 W）+ Zen Monkey 0x933（**E 类** high——热点命名先例不拦），峰值 25.6%/130% 全漏冻结强平（-36.1%/-36.8%）——**小票窗口盲区原样复现**（grad<2/3 市值门拦针臂+RSI warmup，三方向仍待裁定）。副产品发现：① BOT 0x189c super_ip 跨 run 在 0.5 边界抖动（0.49 拦↔0.53 豁免），本轮未 fire 无影响；② prestage 行 stage_final_result 旧残留 bug（§六-12） |

- **记账口径**（E4 台账起澄清）：trades 表/余额的记账货币是 **USD**（virtual unit_price 为 USD 价、
  tradeAmount 0.1 为 0.1 USD）——ΣPnL 数值与 E1-E3 同口径可比，此前行文称 "BNB" 系口径误称
- 四者买侧主条件均为活跃度门 `buyVolumeBnb >= 1.5 AND age < 30`（E4 加 holders>5），
  narrativeCallCondition 挂同一门；E1-E4 卖侧均为轮 6 分档 trailing（P1~P5 drawdown 门槛腿）
- E2 的 ==9 收紧是 C4 裁定的实践修正：unrated（真爆款）与直调失败/超时（normalize 9）无法区分，
  保守起见只买确定 2/3
- E4 卖侧观察（0x47da 由 P5 时间档 +342% 出场、峰值 396%；冲高回落 2 轮理论捕获 0.0839）
  = E5 卖侧改造的直接动因（2026-09-24 用户裁定：叙事筛选后币质量高、BSC 发酵慢，时间分档不适配）
- **E5b 卖侧各臂实跑语义**（4 票样本，方向性观察）：RSI T85 首触卖 40% 是趋势票的「早段收割」
  （0x47da @+258%）；市值门后针臂 P4 专收「末段逼空」（@+527%，grad≥2/3 之后）；毕业臂①
  贴锚卖半 @+807%；硬底 P1 兜住快冲回落票的本金（osbook 峰值 96.8% → -3.7% 出）。**已知缺口**：
  中段止盈臂缺失——osbook 型 3.6min 快冲票（RSI 无 warmup、grad<2/3）全程无臂覆盖，峰值 96.8%
  一分未吃到；analyze 冲高回落段理论捕获 0.19（占 Σ 43%），若补需设计不依赖 RSI warmup 的
  中段腿（如 peakProfitPct 阶梯），待用户裁定
- **跨窗口三连测结论（E5c/d/e，2026-09-24）**：卖侧 8 腔在「毕业冲刺型」票上跨窗口同构有效
  （E5c 0.7799 / E5d 0.3196，P2 针臂两窗口都是主力）；但 **c4a5 窗口（E5e -0.2668）暴露结构性
  盲区**——小票冲高回落型（grad<0.3、活跃<30min）在现行 8 腔下零覆盖：市值门 2/3 拦针臂
  （5/7 票裸 P2 被拦，被拦点涨幅 +25%~+127%）、RSI warmup 拦三档、P1 水位 0.05 拦止损
  （7 票末态 grad 0.13-0.28）、毕业臂不可达。三窗口票型分布：572033ad 有冲毕业票
  （0x47da/osbook）、fb 有（BRX1600/SpaceXAI）、c4a5 全是小票——**卖侧设计隐含「等票冲毕业」
  先验，与叙事筛选后「币质量高」的判断在 c4a5 类窗口冲突**。市值门降档或加中段腿（如
  peakProfitPct 阶梯）的方向待用户裁定
- **执行链精度 bug（E5d 发现→修复，2026-09-24）**：部分卖（sellPercentage<1）后 PM 余仓是
  20 位精度 Decimal，卖出腿 `Number(Decimal)` 往返可能向上失真 → 全清腿（sellPct=1）请求量
  比精确余仓大一丝 → PM 抛 `Insufficient token balance` → 回测 executeTrade catch 静默吞 +
  `_executeSell` 失败分支无日志两层不可观测 → 每 tick 重触发不消耗 maxExecutions（BRX1600
  P2 末段 40+ 次触发全失败）、强平腿静默跳过（6140 token 僵尸仓）。**扫描实测被拒率 34.86%**
  （5000 样本）——E5c 0x47da 四腿侥幸失真向下、E5d BRX1600 撞上。修复：amountToSell 保持
  Decimal 精确链（`new Decimal(holding.amount).mul(sellPct)` 不 toNumber；PM `new Decimal()`
  接受 Decimal 实例，全清时精确相等不误拒）+ 回测 executeTrade PM 异常/卖出失败两处补日志；
  BacktestEngine 与 FourMemeWssTradingEngine 虚拟路径同构修复（live 路径待实盘验收统一核）。
  E5d2（67e044fb）复跑验证通过：BRX1600 五腿轮全清 +385.9%（Σ 0.3196→0.7074），见 §五
- E5→E5b 的方法论修正记录：第一版秒卖（Σ 0.0230）不是参数问题而是**口径问题**——市场口径因子
  叠加动量买门的结构性冲突；修正走语义层（持仓口径+市值门）而非加冷却/兜底。verify 脚本同步
  升级为按 E4 trades 买卖时点驱动 buyState 的持仓口径重放（预演裸 P2 触发@12:43:21 grad=0.133
  被市值门拦截的实证即来自它）
- V1 虚拟孪生（fb03389c，E1 策略 virtual 版）09-23 起在 182 实跑；e3/e4 的 virtual 孪生留待
  回测验证后

### V2 虚拟实验 0336befc 策略升级（2026-09-25，用户三项裁定）

flap 虚拟（叙事严格买门 V1，screen `v2-0336befc`）当日实跑 6 票后升级（延龄草 -35% /
人生好物 +80% / STONKS ×2 地址 / 子曰 -35% / 白头鹰 / 共合）：

1. **同名老币拒买门**（STONKS 案：0x7cbc/0xd65d 蹭 flap.sh 09-04 老盘 Stonks
   $1.08M FDV / TVL $252k 的名字发币）——`SameNameTokenService`（交易引擎侧原死代码，
   与叙事侧 SameNameCheckService 同源不同物）激活接入 PreBuyCheckService：
   AVE 按归一化 symbol 检索 BSC 同名（300 条，~100-300ms），严格 **name 维度**匹配
   （归一化防隐形字符 + 相同/互相包含≥3；**不用 symbol 相同规则**——symbol 同名但 name
   跨语义的盘不属蹭名：人生好物买入盘 name="Treasures of Life" vs 老盘中文 name，
   语义不同不拦，+80% 票保住），`tvl≥$1k && vol>0 && fdv≤$20M` 假数据过滤
   （$28B/TVL$9 型行排除），排除自己地址（防补买轮当前盘 FDV 已达标自我误拦）；
   因子 `strictSameNameMaxFDV` 进 preBuyCheckCondition（0336befc 门 `< $500k`）。
   AVE 错误 / symbol 缺失 → maxFDV=0 放行（fail-open，与龙头门同方向）。
   回测同步接入（BacktestEngine tokenInfo 补 name；AVE 检索为当前快照，时序穿越
   同 narrativeRating 直调声明——绝对收益不代表实时可得）。
   **实测四 case 全对**：STONKS 0x7cbc maxFDV=$1.11M 拦 / 人生好物 $0 放（name 跨语义）/
   子曰 $3.3k 放 / 老盘自排除后 $26.9k 放。**误伤面**：嫦娥（$16.5k）/延龄草/白头鹰/
   共合全部远低于门。叙事分工印证：叙事评级管推文语料价值，名字是否被老盘占用是
   市场事实归代码侧（STONKS 叙事评级 2/3 放行没错，错在名字无独立生命力）
2. **holders > 5 买门**：buy condition `buyVolumeBnb >= 1.5 AND age < 30 AND holders > 5`
   （holders=FA 内盘净持仓 trader 计数，fire 因子零代码改动；E4 回测先例：拦掉 NOINT/
   天才两个最大亏损笔）；narrativeCallCondition 同步（省直调费）
3. **卖侧换 E5c 8 腔**：5 腿 trailing 全换 E5c 止损市值化 8 腿（硬底 `grad<0.05 AND
   profit<0` / 针臂猛档+普通档 / 毕业臂 ①② / RSI T85/T78/T75，bypassDebounce，
   maxExecutions=1）——1f69dc53 同为 flap 平台，因子键全在 FA，直接迁移

**待用户裁定**：symbol 同名维度是否纳入严格匹配（现仅 name 维度；若纳入，人生好物型
symbol 同名 name 跨语义盘会被拦）

---

## 六、未决事项

1. **SHIELDCAT**：J1.10 下阻断侧 0.67 → low，待用户裁定是否预期行为
2. **OneKey Flork 纠纷语料**：需"币名指向 ≠ 计分主体"新维度，待设计
3. **主路径带语料端到端**：等新 token 自然验证（jev 新格式行落库）
4. **龙头门拦截力未激活**（E3 回测，2026-09-24）：窗口内 hot=1 信号 0 条——天鹏型仿盘活跃度
   不足买门（buyVolumeBnb≥1.5）从未 fire，龙头门只拦"活跃度够但叙事已火"的后来者，此类 case
   本窗口未出现。正向验证全过：E3 与 E2 executed 买入完全一致（零误杀）、龙头 0x47da
   12:42:37 判定 trail 实测 count=9 / maxMultiple=1.7（只看 ≤t ticks，无前视）、
   rating=3 + hot=0 双门放行吃到 +337.7%。拦截场景需等虚拟实跑（V 系）自然出现
5. **叙事缓存失效清理机制**：模块改动后批量置 is_valid=false 的机制 planned 未建；现行手动
   行删或 `NarrativeRepository.updateIsValid(address, false)`
6. **material_id 映射覆盖率**：全表 22184 行仅 10159 有值——龙头门只对挂了 material_id 的
   候选生效，无映射的仿盘漏拦（fail-open 方向已接受）
9. **E5 卖侧小票窗口盲区**（E5e，2026-09-24）：市值门 2/3 在小票窗口（grad 全程 <0.3）把
   针臂全拦（裸 P2 被拦点 +25%~+127%）、RSI warmup 拦三档、P1 水位 0.05 拦止损——
   冲高回落型零覆盖（7 轮全冻结 -24%~-56%）。市值门降档 / 加不依赖 RSI warmup 的中段
   止盈腿（peakProfitPct 阶梯）/ 维持现状接受小票窗口亏损，三方向待用户裁定
7. **e3 的 virtual 孪生（v3）**：E3 回测零误杀已过，待建虚拟实验实跑积累拦截场景
8. ~~**W 类阻断对"首发公告盘"的校准**~~（已解决，2026-09-24 方案 A）：W 数学误伤的
   根因是路径混判——自发盘改道 prestage 账号判定后，W 数学回归纯骑乘盘语义（要求
   被骑乘产品影响力极高），无需再校准。见 C7 方案 A 落地记录
10. ~~**B 类骑乘盘盲区**~~（已解决，2026-09-24 骑乘门落地）：`rideDetourBelow`
   B/C 域改道 W 数学，见 C8 落地记录；v3 补 B 入 name_referent 阻断 scope 收口
   Muse/TenPayGo 0xc6c（版本更新/无名对象两案）。**同推文仿盘群盲区仍在**：
   「首发+全没火」结构（9 盘 16s 抢发）龙头门/同名规则均无覆盖，需并发仿盘门
   （pre-check 密度口径）方向待后续裁定
11. **多进程 mapper 版本漂移**（2026-09-24 发现，待裁定）：token_narrative 缓存行
   由多进程写入——narrative engine（重启即加载新 mapper）+ 交易引擎进程直调
   （NarrativeDirectCaller，启动后不随文件更新）。V1 虚拟实验（fb03389c，09-23 起
   182 实跑）内存仍是旧 mapper，14:30 分析的 BOT 行落库 high（v2 应拦）即此问题。
   mapper 语义改动要彻底生效需重启所有直调进程；重启 V1 有实跑中断风险，是否重启
   或依赖缓存失效机制待用户裁定
12. **prestage 行 stage_final_result 旧残留**（2026-09-25 E5e2 发现）：prestage
   分支只写 prestage_result（+unrated 时清 stage1/2），**不写/不清 stage_final_result**
   → 改道 prestage 的 token 行残留旧主路径终局（TenPayGo 0x14d：prestage 'low' vs
   stage_final 旧 'high' 并存）。交易链无影响（resolveFinalRating 按 pre_check→
   prestage→… 顺序提前返回 prestage 'low'），但 web 展示/人工核查读 stage_final 会
   误导。修法：prestage 分支终局时同步写 stageFinalData（或 __clear）——待裁定
13. ~~**apidance 配额耗尽**（2026-09-25 发现，**阻塞全部叙事分析**）~~
   **已解决（2026-09-25 用户续费）**：401 恢复正常，narrative engine（pid 212830）与
   v2-0336befc（同日重启）已加载超时收紧+推文窗口化新代码实跑。遗留观察项：makeRequest
   的 abort 只覆盖响应头阶段，`response.json()` body 阶段无超时保护（实测偶发 body
   阶段挂死 120s+）——是否把超时延长到 body 读取完待裁定
