# 叙事引擎改进与 Case 台账

> 与《叙事分析引擎改进.txt》（随手 case 笔记）互补的完整台账：叙事引擎全部改进 + 研究
> 过的 Case，按时间倒序，近期详写。commit hash 可直接 `git show` 查细节。
> 分工原则（多 Case 反复验证）：**LLM 管叙事价值判断，代码管市场事实**——凡是市场事实
> （谁先发、涨了多少、有没有同名）一律代码侧判定，不指望 LLM。

---

## 一、现行架构一屏（2026-09-24 时点）

```
Token URL → URL 分类 → 数据抓取 → Pre-Check（纯规则，无 LLM）
                                   ├─ account/community token → prestage Jev（P1.2，4 题）
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

## 五、策略侧应用（回测 E1→E2→E3，源 572033ad）

| 实验 | id | preBuyCheckCondition | 差异 | 结果 |
|---|---|---|---|---|
| E1 | c0150101 | `==2 OR ==3 OR ==9` | 基线（跑在 J1.8） | 胜率 28.6% |
| E2 | f5adb5e7 | `==2 OR ==3` | 去掉 ==9（未评级不混入爆款语义）；跑 J1.10（与 E1 双重差异，对比注意归因） | 胜率 33.3% |
| E3 | adec51f7 | `(==2 OR ==3) AND narrativeLeaderHot == 0` | E2 + 同叙事龙头门（C1）；跑 J1.10 | **与 E2 完全同结果**（6 买入全同、ΣPnL 0.2391 BNB、胜率 33.3%）——零误杀；龙头 0x47da 放行吃到 +337.7% |

- 三者买侧主条件均为活跃度单门 `buyVolumeBnb >= 1.5 AND age < 30`，narrativeCallCondition
  挂同一门；卖侧均为轮 6 分档 trailing（P1~P5 drawdown 门槛腿）
- E2 的 ==9 收紧是 C4 裁定的实践修正：unrated（真爆款）与直调失败/超时（normalize 9）无法区分，
  保守起见只买确定 2/3
- V1 虚拟孪生（fb03389c，E1 策略 virtual 版）09-23 起在 182 实跑；e3 的 virtual 孪生（v3）留待
  E3 回测验证后

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
7. **e3 的 virtual 孪生（v3）**：E3 回测零误杀已过，待建虚拟实验实跑积累拦截场景
8. **W 类阻断对"首发公告盘"的校准**（C7 复跑发现，2026-09-24）：ARENA 修复后走标准
   Jev 路径仍 low——W 类数学 44.12<60 阻断（P=0.75 把发行方自有公告判为蹭仿）。
   "自有账号首发公告"是否应豁免/降权 W 类（该盘 8.5min 峰值 12.54x），待用户裁定
