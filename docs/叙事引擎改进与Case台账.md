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
                                   └─ 标准路径 → 单次 Jev 调用（13 题，J1.11）
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

### C16 双作弊票 0x0e27/0xd8e8 —— 同额度批量钱包伪造全绿画像 → 簇因子拦截（2026-09-27）★

**现象**：用户报两张「作弊票」——0x0e27088c6e832fbb6a5b11eac89506883bee7777 与
0xd8e8f436c14d1904e724f8ba4a30400139487777（均 09-26 铸，flap）。双实验买入
（0336befc 实时虚拟 + 377cc0a6 回测），回测腿分别强平 **-51.1%**（买 0.00000877 →
0.00000429）/ **-42.1%**；0336befc 冻结持有浮亏 -35.5%/-42.1%。

**手法还原（两票同构，同一作案人）**：
1. **90s 内批量独立钱包精确等额买入**——票1：17 钱包（0.100000×10 +
   0.070000×3 + 0.080000×2 + 0.050000 + creator 0.500000）；票2：14 钱包
   （0.120000×10 + 0.695505 + 0.060000/0.025000/0.015246）。链上固定额度下单
   （amountInExact）无 wei 级滑点离散，**簇内金额到小数点后 6 位完全相等**
2. **伪造全绿画像骗过所有现有门**：holders>5 ✓（17 独立钱包）、净流入 100% ✓
   （先只买不卖——刚上线的净流入门对「先建仓后退出」模式无效，fire@+21s 实测
   netBuy=100）、多样性高 ✓、集中度低 ✓（每钱包额度小而分散）
3. **持续推价**：票1 +120.7%@542s、票2 +216.9%@914s
4. **批量钱包按获利额精确退出 + 关联地址大单砸盘**：票1 5-10min 卖
   0.16/0.15/0.14…递减 + 569s 0x168303a9 零买入砸 0.98；票2 15-20min 砸
   5.74 BNB → 死盘

**跨票铁证与黑名单否决**：0x168303a96a767e2a6b2e00cb862eb95e416f72fa 在票1
零买入纯砸盘、票2 开局建仓 0.7——但排查发现它是 **296 token/13645 行的高频做市
地址**（09-20 起持续活动），黑名单误伤面不可控 → 转向结构性指纹（同额度簇）。

**成立方案（同额度买入簇因子）**：非尘埃（≥0.01 BNB）买入钱包按累计金额
`toFixed(2)` 分簇，最大簇钱包数 / 非尘埃钱包数 ×100。天然买家金额带滑点离散
（0.0587/0.0623…），团伙批量钱包精确等额——比例天然盘不可能高。

**校准（26 样本，90s 创建锚定窗 + 尘埃过滤后）**：作弊票 58.8%（17w/10c）/
71.4%（14w/10c），fire@85s 截断口径一致（簇 85s 内已完成）；赢家全 ≤20.6%
（天然 bot 整数额 JIBE 0.20×3=20%、BNBMART 0.07×6=20%）、lose 全 ≤30%、共合
25%（8 钱包被 wallets≥10 门豁免，净流入门管）。**拦截门：非尘埃钱包数 ≥10
AND 簇占比 ≥50**——小样本票（bitget被盗 3w、SpaceXAI 6w）被 wallets 门豁免，
Fred 22.9% 放行（-14.9% 接受漏拦）。

**落地（五步清单）**：EarlyParticipantCheckService `_calculateUniformBuyCluster`
（买入判定 to_token===tokenAddress 与净流入因子同口径；钱包多笔合并；窗口语义
同构——age>90s/launchAt 缺失全 0 放行 covered=0，**注意放行值是 0 不是 9999**：
拦截门是"达到阈值触发"，9999 会误触发，与净流入因子高值放行方向相反）+
result/`_getEmptyResult`（异常 0 值）/`getEmptyFactorValues`（0 值，null 会让
`<10` 放行写法恒 false 误拦）+ PreBuyCheckService context + FACTOR_METADATA +
FactorBuilder（引擎/回测两路径全覆盖）。本地零 DB 单测 12/12；182 端到端真实
performCheck 链路：**拦** 作弊1 fire@+21s（12w/10c/**83.3%**——窗口截断后簇纯度
更高）/作弊2 fire@+45s（14w/10c/71.4%）；**放** 和平熊猫 0%/人生好物 20%/
龙布布 28.6%/JIBE 12.5%/MuseCharm 16.7%/BNBMART 20%/Fred 11.1%/共合 R1@+6s
（4w<10 豁免，极早 fire 无信息与净流入因子同边界）。策略用法：
`earlyTradesUniformBuyWallets < 10 OR earlyTradesUniformBuyClusterRatio < 50`。

**上线（2026-09-27 用户批准「明白了，可以上」）**：拦截门与净流入门（C13）同门写入
运行中实验 53c9737c / dfc7a623 的 preBuyCheckCondition——
`(narrativeRating == 2 OR narrativeRating == 3) AND strictSameNameMaxFDV < 500000
AND earlyTradesNetBuyRatio >= 40 AND (earlyTradesUniformBuyWallets < 10 OR
earlyTradesUniformBuyClusterRatio < 50)`（ConditionEvaluator 递归下降解析核验：
`(A OR B) AND C AND D AND (E OR F)` 与现行条件同构，五因子 context 全在位）。
DB 写入回读验证一致，两 screen 进程 11:16 重启加载（新 pid 1115189/1115191），
config 含新条件、9 策略加载、水位对齐（events 85758 / ticks 549680）、消费循环
正常零报错。0336befc 母版已停未写入（拉起待用户确认）。

**已知接受面**：真有 ≥10 个 bot 同精确额度买入的健康票会误拦——校准集不存在此
结构，且该结构本身即协同买入信号。已知漏拦：作弊团伙改用随机额度（每钱包不同
金额）则簇因子失效——但等额是他们控制成本/均分收益的最省力路径，改随机额度
显著增加操作复杂度，属于对抗升级而非修补面。

### C15 x-0 0xa5fd1f —— 税币伪装项目币骗 prestage mid 评级（2026-09-27）★

**现象**：0xa5fd1ff387bdbd3df877ffd35b908651250b7777（name/symbol=x-0，flap 税币 7777
后缀，09-26 12:02:17 铸，creator=0x90497450 工厂地址——C13 已证 flap creator 共享）
0336befc 母版 12:02:39 买入、377cc0a6 回测命中叙事缓存同买（fromCache），回放结束强平
-68.8%（最高 +330% 后崩回 launch 下方）。用户问「这个代币怎么通过的」。

**决策链还原**（信号 metadata + token_narrative + wss_events 逐环核实）：
1. 买门 fire：`buyVolumeBnb >= 1.5 AND age < 30 AND holders > 5`——fire@12:02:38（创建后
   21s），90s 窗 37 笔 $4685 / holders=6 / earlyReturn +207%，全过
2. 叙事直调：IPFS meta 解包出 Twitter **@x0money** + 官网 x0money.com（非「无语料」，
   符号是随机名 x-0）→ prestage Jev P1.2 判 token_type=project(0.8)；nameMatch=true
   （token 名 x-0 与账号名精确一致）、addressVerified=true、rulesValidationPassed
3. 项目评级表（rateProject 纯代码）：账号粉丝 **131 ∈ [60,299) → mid(2)**——恰好命中
   策略放行带 `narrativeRating == 2 OR == 3`
4. strictSameNameMaxFDV=0 放行 → 12:02:38/39 双实验成交 @+207% 价位

**伪装画像**：账号 09-15 注册（11 天新号）、仅 1 条推文、131 粉丝、蓝 V（按设计认证记
details 不参与计算）、token 名与账号名精确同名、配官网——项目评级表唯一量化指标
（粉丝数）被精确卡进 mid 带。creator 同为 C13 flap 工厂 0x90497450，属同一批量伪装
模式（工厂铸币 + 买粉新号 + IPFS meta 挂社媒链）。

**已有解实证（C13 净流入因子）**：创建锚定 90s 全窗实测净流入比 **18.6% < 40**（Σ买
16.86 BNB / Σ卖 13.73 BNB，345 笔）——preBuyCheckCondition 若已含
`earlyTradesNetBuyRatio >= 40` 本案被拦。回测 377cc0a6 跑于因子上线前
（preBuyCheckFactors 无该字段），母版 0336befc 及新副本策略亦未写入该门——§六-18
「是否写入实验 preBuyCheckCondition」的拦截实证 +1（与共合同向）。

**叙事侧可加固方向（待裁定，非必须）**：项目评级表对「新号+空内容」无免疫——可加
账号年龄/推文数降档（如注册 <30 天或 statuses_count <5 → low）→ 需重放校准误伤面；
市场事实侧（净流入）已可拦，优先级看裁定。

### C14 Cz黄鞋 0x91c4 —— 「IP名+闲聊物品词」拼接 + superIP 通道闲聊满分 → J1.14 实体性前提（2026-09-27）★

**现象**：0x91c4c4e9f769f0f7a126c583f2dfb5b938717777（name=symbol=「Cz黄鞋」，flap，
09-26 12:57:32 铸，creator 0x0027737e 第三方）语料挂 CZ 闲聊回复「I need to get one.
I love yellow shoes. 😂」（@币安系账号的 reply，与 SHOES 案同推文）→ superIP 快车道
**high 77.15**（`super_ip_fast(CZ/S级/jev-J1.10)`）→ 0336befc（12:58:37）与 377cc0a6
双双放行 executed BUY（均无成交，§六-14 已修正定性：个别买入失败非系统性——
0336befc 当天 13:33-18:26 另有 8 笔正常成交）。用户裁定「**superIP讲了一个第三方
主体也没有问题，例如CZ说了Giggle肯定没问题，但是问题在于，'yellow shoes'不是
什么具体实体，只是一个修饰+名词，没有具体实体对应，也没有meme元素**」。

**评级事实链**（superIP 快车道，三处失守）：
- 推文作者=CZ 命中注册表 → **跳过 event_magnitude，S 级预评分 40+时效15 直接喂饱**
  ——一句闲聊 reply 被当 S 级事件计分（传播 29.56 → 事件分 84.56×0.6）
- name_referent **super_ip 0.44 argmax 摇摆**（common_word 0.27 被题面「文本作者非
  超级IP」限制压低；阻断侧合计 0.41<0.5 差 0.09 不拦）——「Cz」字样出现 → Jev 倾向
  判指向 CZ 本人
- block_reason none 0.36 vs empty_content 0.32 五五开，argmax=none 放行
  （institution_routine 在 superIP 通道被豁免）

**根因（豁免第四空洞：实体性）**：「Cz黄鞋」=注册表 IP 缩写 + CZ 闲聊推文中的
**非实体物品词**拼接——蹭的是 CZ 的注意力，名字主体「黄鞋」无具体实体对应、无
meme 元素。J1.12 双前提**双满足拦不住**（J1.12 下重析仍 high 77.15：「Cz」是忠实
缩写、「黄鞋」非传闻名）——缺失维度是「名字主体是否指向具体实体」。另一面（用户
裁定正向语义）：超级 IP 亲口提及/讲述的**具体实体**（如 CZ 提到的某产品名）没问题
——提及本身即事件，不该因「指向第三方」而拦（「整体指代 IP 本身」方案被用户
否定：superIP 讲第三方主体也成立）。

**修复（J1.14，name_referent 两处 criteria，mapper 零改动）**：
- **super_ip 加第③前提「实体性」**：主定义扩含「该 IP 亲口提及/讲述的具体实体——
  产品/项目/公司/事件，提及本身即事件（Giggle 语义）」+「不含被其@到的普通人物/
  小号账号——那些仍是周边对象」（YAYA 型仍走 minor_other，边界自洽）；③实体性——
  名字只是「IP名+日常物品词」拼接（如「Cz黄鞋」）或主体词是 IP 文本中无具体实体
  对应的普通词组（修饰+名词，无 meme 元素）→ 判 common_word。自指原话词（天才）在
  主定义实体性满足项内，不翻转
- **common_word 去「文本作者非超级IP」限制**：IP 闲聊里的非实体词组同样判本项
  （该限制正是本案 common_word 仅 0.27 的题面原因）；超级 IP 明确提及的具体实体
  不是普通词（按 super_ip 评估）

**验证**：① **Cz黄鞋 ignoreCache 重析**：name_referent 翻 **common_word 0.78**
  （super_ip 掉到 0.19）→ 阻断侧 0.79 → **low**，落库 `super_ip_fast(CZ/S级/jev-J1.14)`；
  ② **天才**（0x110bbb，CZ 自指原话）：super_ip **0.72** → 仍 **high 80.07** 零误伤；
  ③ **哦**（J1.12 变体/传闻）：notable_other **0.98** → 仍 low 零回归；④ **全量重放
  322 行**（v2 修 brand_hijack 实判后）：翻转 7 行全部对上已知集合——捕日者×4
  （§六-11 脏缓存）+ GRASS/YAYA（J1.11 重放已知 nameReferentBlock 滞后行）+ Cz黄鞋
  本行（刚重析、stage_final 残留旧 high）——**零新增翻转**（mapper 零改动的数学
  预期）。⚠️ 重放方法论教训：首版脚本 includeBrandHijack 硬设 false，9 个 superIP
  行（币安慈善/歌手CZ 等）被误报 low→high——brand_hijack 必须按行内 prompt 的
  questionIds 实判（名字含「币安/CZ」的行当年正是被品牌劫持题拦的）

**部署**：182 scp + narrative engine / v2-53c9737c / v2-dfc7a623 重启（09-27 10:49
加载 J1.14，engine 1101583 / 53c9737c 1101599 / dfc7a623 1101624，Realtime 订阅正常）。

**附带发现**：superIP 通道 blocked 时 `stageFinalData=null` 不写也不清——Cz黄鞋行
stage_final_result 残留旧 high（llmResult 已 low，交易链取 llmResult 无影响，web/
人工核查会误导）——§六-12 prestage 残留的同构变体，修法一并待裁定。

### C13 共合 0x667c —— 对倒盘净流入拦截因子（2026-09-27）★

**现象**：0x667cedcf623067da4494ec1c74a4c365fc697777（共合，flap，蹭微博热点词）0336befc
实时虚拟一轮买入 -25.7%、377cc0a6 回测二轮买入 -39.5%。任务 G 排查确认**对倒极重**：
11 个地址倒货 19 小时，卖盘 99.6% 来自双向钱包（既买又卖）。用户裁定「看看用什么
因子，把这种币干掉」。

**四方向证伪**（每步有数据，全不行）：
1. **现有集中度因子失效**——fire 时 walletTop1TradeRatio/Top3/Diversity 分不开对倒与
   赢家：SpaceXAI（+274%）fire 时 Top1Tr=83.3/Top3Tr=100/eUniq=2，比共合（75/95/4）
   更极端——早期高集中度是新币常态（创建者+狙击 bot 主导）
2. **双向钱包占比失效**——前 90s 既买又卖量占比：和平熊猫（+201%）97.2% vs 嫦娥
   （+503%）14.5%，赢家输家完全混排——flap/four.meme 前 90s 做市 bot/套利 bot/快翻
   交易者天然双向
3. **creator 维度对 flap 失效**——wss_events payload.creator 在 flap 是工厂/发射器共享
   地址 0x90497450（名下 3270 token、7 天 1584 个）——延龄草/STONKS/和平熊猫/JIBE 全
   是它；four.meme 的 creator 才是每 token 真实地址
4. **同 symbol 克隆数失效**——共合 10 分钟内 4 个先行克隆，但和平熊猫 24 个克隆仍 +201%

**成立方案（净流入因子）**：`earlyTradesNetBuyRatio = (Σ买BNB − Σ卖BNB)/Σ买BNB × 100`，
窗口同 earlyTradesWindow（90s，截断到 checkTime 严格无前视，尘门 price_outlier=false +
price_usd 非 null 与既有查询一致）。**创建锚定口径**（关键）：仅当 checkTime 距创建
≤90s（查询窗覆盖创建时点，trades 即"创建以来全量"）才有效；age>90s 或 launchAt 缺失
给通过值 100 放行（fail-open 宁漏拦不误杀——龙布布 fire@103s 滚动窗实测 34.6% 会被
误杀，covered=0 因子标记口径未覆盖）。

**校准（阈值 40，182 真实 ticks）**：
- 对倒盘 90s 全窗全 ≤30（共合 9.5/桃花源记 9.1/STONKS 3.0/宝力青宝 3.5/白头鹰 15.8/
  跳舞蛙 29.5）
- fire 时点引擎全链路实测（performCheck 真实查询）：**拦** 共合R2 39.77/孔子AI 36.83/
  跳舞蛙 39.12（全 <40）；**放** 和平熊猫 86.14/人生好物 100/JIBE 99.99/MuseCharm
  86.58/币安王国 95.57（全 ≥86）——中间带 [40, 86] 空旷，但共合R2 距阈值仅 0.23
- **已知边界（极早 fire 无信息）**：<15s fire 时窗口内 washers 先买后卖未开卖腿，净流入
  虚高（共合 R1@6.6s=63.7%、桃花源记@12.5s=100 放行）——该场景由 holders>5 门拦
  （共合 R1 holders=3 拦）；桃花源记 holders 过门，防线在叙事骑乘门（C8 v2 已拦）

**落地（五步清单）**：EarlyParticipantCheckService `_calculateNetBuyRatio`（buy/sell 判定
to_token===tokenAddress，与 WalletCluster 同口径）+ result/getEmptyResult（异常通过值
100）/getEmptyFactorValues（null）+ PreBuyCheckService `_performEarlyParticipantCheck`
恢复 launchAt 传参（tokenInfo.launchAt，全链路秒口径已核）+ `_evaluateWithCondition`
context（缺省 100 放行）+ FactorBuilder（引擎/回测 preBuyCheckFactors 两路径全经此构造）。
本地零 DB 单测 8/8（含 age=90/91 边界、大小写、全卖盘 -100）；182 端到端 10 token
上表全过。策略用法：preBuyCheckCondition 加 `earlyTradesNetBuyRatio >= 40`。

**叙事侧 miss（附带发现，待裁定）**：共合 token_narrative `jev(J1.10/E类)` 判 high 84.68
放行——语料仅一条微博链接，E 类事件分 39(S档)+传播 27.7+时效 15=81.7>60 过线；
name_referent common_word 0.93 但 **E 类不在 NAME_REFERENT_BLOCK_SCOPE**（现为
B/C/D/F/G+W）。扩 E 有误伤风险（Zen Monkey E 类 +68%），需重放验证，留用户裁定。

### C12 绣春刀3 0xa7c9 —— 常规电影骑乘豁免误放 → J1.13 routine_content_product（2026-09-27）★

**现象**：0xa7c9c86e2d3b6cb7de698d8067635ebd8e627777（symbol/name=绣春刀3，flap，
09-26 11:55:23 铸，creator 0xc1cb…70c3 第三方）语料源 BTCdayu 推「绣春刀3电影即将推出」
→ 16s 后 0336befc 与 377cc0a6 双双 narrativeCall 直调，0336befc 2.1s 评 **high 75.31**
（`jev(J1.10/B类)`）→ BUY 信号（无成交）。用户裁定「**显然不能用这种常规电影作为
meme币**，当然『牛来』（0xbeea…7777，crypto 原生梗）可以」；二次裁定收口「**即使
推出了，也不能作为meme币的**」——官宣与否无关，类型层面排除。

**评级事实链**（J1.10 标准路径，三道门全没拦）：
- event_category **B 0.46**（电影=非 Web3 产品发布）/ C 0.41；magnitudeTier B 档 →
  事件分 27 + 传播 23.95 + 时效 15 = **65.95>60** 过线
- name_referent **super_ip 0.66** → C8 豁免区（骑乘门 sip≥0.5 不改道；阻断侧合计
  0.30 不拦）——Jev 把华语电影系列按「国民级 IP」语义判了超级 IP

**根因（评分内部自相矛盾 + 豁免第三空洞）**：同 run 量级题 S 档概率仅 **0.01**
（magnitudeTier=B「知名中小 IP」），name_referent 却 super_ip 0.66——两题矛盾，
量级题明说不是世界级、名字题给了豁免。C8 豁免先例（天才=名人原话梗/嫦娥=世界级
航天+神话）都有梗/事件维度；**常规商业电影续作宣传是娱乐产品新闻：观众是消费者
不是玩梗社区，无二创动力、无 meme 玩味空间**——蹭其命名只是消费上映热度（与
C9「热度≠该放」同构：产品知名度≠该放）。J1.12 双前提对本案**双满足拦不住**
（原名忠实呈现 + 电影已官宣），实证靠 notable_other 0.53 贴线拦（非类型确定）。

**修复（J1.13，block_reason 新增第 12 选项 `routine_content_product`）**：
常规内容产品宣传——电影/剧集/综艺/动漫/小说/游戏等常规内容型产品的发布/上映/
定档/预告/官宣消息，**即便已官宣已上映、即便系列国民级知名也不构成叙事事件**。
边界收窄（防误伤）：内容本身已是全民玩梗对象（名场面梗/大规模二创）不选（按
E 类热点评估）；跨世代文化符号/神话/历史人物/公共事件（孔子/嫦娥/探月）不是
产品宣传不选；Web3 产品不适用；世界级颠覆性实体产品/平台发布不选。mapper 双挂
（与 negative_hard_news 同构）：BLOCK_SCOPE `'all'`（argmax 全域）+ 概率 ≥0.5
质量门 `routineContentProductBlock`（标准 + superIP 双路径），mass 透出
`routineContentProductMass`。

**验证**：① **绣春刀3 ignoreCache 重析**：`routine_content_product 0.95`（argmax，
none 仅 0.02）→ 阻断「常规内容产品宣传」**low**，落库 `jev(J1.13/B类)`——类型
确定性拦截；② **天才**（CZ 原话梗）：super_ip 0.76、rcp=0 → 仍 **high 80.12**
零误伤；③ **嫦娥 0x47da**（E5 大腿票）：rcp=0 → 仍 **high 72.63** 零误伤；
④ **全量重放 289 行**（旧行 answers + 新 mapper）：翻转恰 4 行=捕日者已知脏缓存
（§六-11），rcpP 全 0——**零新增翻转**（数学预期一致：旧 answers 无该选项概率）；
⑤ 校准集 28 样本 The Half Second（B 类内容产品）被 rcp 正常拦截（mid→low）。

**部署**：182 scp + narrative engine / v2-53c9737c / v2-dfc7a623 重启（09-27 10:38
加载 J1.13）；377cc0a6 回测进程已停不在运行，无重启项。

**附带发现**：①「牛来」0xbeea1d61 完全未进系统（无 wss_events/ticks/监控池）——
watcher 断供窗口漏采嫌疑，是否排查待裁定；② ≤J1.12 旧版本「豁免/骑乘区 + high +
is_valid」脏缓存共 **21 行**（crypto guy J1.11 sip 0.81 / 子曰 0.58 / 孔子AI 0.76 /
熊猫外交 0.7 / 捕日者×4 / 嫦娥×3（正例，重析应保持）/ BOT 0.53 等）——离线重放
发现不了（旧 answers 是旧题面产物，本案即证据），实时实验无买入风险（全过观察窗），
**回测前需按 E5e2 流程 ignoreCache 批量刷新**（刷新时嫦娥等正例预期保持 high）。

### C11 哦 0xbefe —— OpenAI 传闻名变体抢注 → J1.12 super_ip 双前提（2026-09-27）★

**现象**：0xbefe2b70020089f6d7f311c0ddb80fc074107777（**name="o"、symbol="哦"**，第三方
0xf9f9…3358 铸于 09-26 10:08:26，元数据全空）被 J1.10 判 **high 80.05** → 0336befc
（实时虚拟）与 377cc0a6（回测）均放行 `executed` BUY 信号。语料是 OpenAI DevDay 前瞻
传闻推文：always-on assistant 将命名 **"o"**（ChatGPT 升级界面内部 config 短暂曝光，
**未官宣、产品未发布**）。同推文 **37 个抢名盘**（narrativeLeaderCount=37）全没火；
走势 1 分钟冲 217.8% 后回落 74.4% 死盘，fire 时点恰在峰值顶上。用户裁定「把'o'
直接发成中文'哦'，感觉不行」，方向选定 **B：忠实度 + 传闻维度**（一次 J1.12）。

**评级事实链**（`jev(J1.10/B类)` 标准路径，三道门全没拦）：
- 事件主体归因 OpenAI 产品传闻 → **S 档 39** + 传播 26.05 + 时效 15 = **80.05>60** 过线
- name_referent **super_ip 0.81**（币名指向 OpenAI 的传闻名）→ C8「超大超火被骑可放」
  豁免直接命中：骑乘门 super_ip≥0.5 不改道、阻断侧合计仅 0.07 不拦

**根因（豁免语义的两个空洞）**：
1. **无名字忠实度校验**——「超大超火产品被骑没问题」的隐含前提是币名忠实呈现被骑名。
   「哦」是 "o" 的中文音译变体：发币者明知不是自己的名字，用形近音字蹭——**变体替换
   本身是「蹭」而非「是」的证据**（与天才案 CZ 原话「天才」的直接使用不同）
2. **被骑的是传闻不是产品**——"o" 未官宣未发布，火的是 OpenAI、"o" 还不存在，
   「超大超火产品」语义不成立

**修复（J1.12，jev-questions name_referent）**：super_ip 选项加**双前提**：
①忠实呈现——币名须为该 IP 名字的忠实使用（原名直接出现或官方/通用标准译名），
音译/形近/跨书写系统变体（如 "o"→"哦"）不算；②已官宣存在——名字所指对象须已被
官方正式官宣或已公开发布，仅为传闻/泄露/内部界面曝光/未官宣计划中的名字（"will be
named X"）不算。不满足前提判 **notable_other**（承接语义同步写入该 criteria）；
mapper **零改动**（notable_other 已在阻断侧三项、scope 已含 B/C/D/F/G/W——变体/传闻
盘掉出豁免后直接被阻断 scope 拦）。

**验证**：① **哦案 ignoreCache 重析**：name_referent **notable_other 0.98**（super_ip
仅 0.01）→ 阻断侧 0.98 → **low**，落库 `jev(J1.12/B类)`（原 high 缓存已覆盖）；
② **天才反向**（CZ 原话「天才」，忠实用名）：super_ip **0.83** 稳定，仍 high(3)
（73.8 过线）——零误伤；③ **全量重放 289 行**：翻转仅捕日者 4 行（C9 基线同款
§六-11 已知脏缓存，非 J1.12 引入）——**J1.12 零新增翻转**（与 mapper 零改动的
数学预期一致）。

**部署**：182 scp + narrative engine / v2-53c9737c / v2-dfc7a623 重启（09-27 10:24
加载 J1.12）；**377cc0a6 回测未重启**（避免中断回放——进程内题面仍 J1.11，直调命中
缓存的行受 J1.12 新行影响，未命中缓存的 token 首析仍 J1.11，版本混杂是否可接受/
是否中断重跑待用户裁定）。

**附注（支线异常，§六-14）**：两笔信号 `execution_status=executed` 但 trades /
experiment_tokens 均 0 行——执行链在 pre-check 完成后（10:08:59.890 存储成功后）
断掉，无买入日志。独立于本案的执行层问题，待查。

### C10 BRF 0x2c5b —— 元数据全空 no_public_info 误拦 → GMGN 社媒补源（2026-09-27）★

**现象**：0x2c5b84d4ab2256d987a6fc094e1e764d9e9b7777（BRF，Bitget Relief Fund
蹭名盘，"by the BNBCHAIN community as asked by CZ"）被 pre-check 规则
`no_public_info` 拦 → low(10) 未进 LLM。用户指出 GMGN 网站上有其推特信息。

**根因（三层叠加）**：four.meme 元数据 twitterUrl/webUrl 全空 + IPFS JSON 社媒
字段全空串（上段实测）+ **meta 是裸 CID**（`meta="bafkreigaw…"`，非 http 网关
URL——`extractAllUrls` 不识别、C7 的 `isIpfsUrl` 也不匹配 → IPFS 解包从不运行）
→ 0-URL 早退分支在 IPFS 解包/GMGN 补源之前 return，token 唯一信息源只剩 desc 自述。

**AVE 补源排查（用户提议，实测不可行）**：AVE detail（`/v2/tokens/{id}`）与
search 端点均不返回任何社媒字段（BRF + 成熟币 CAKE 对照全字段实证）；社媒
`appendix` 只在 platform 列表端点返回且**三例对照与 four.meme 元数据
twitterUrl 逐字符一致**（含 `?s=20` 分享尾参）——AVE 无独立社媒渠道，four.meme
元数据空的币 AVE 同样空；且 platform 端点固定 200 行窗口（≈30-50 分钟），
`page`/`offset` 均无效，按地址不可查。结论：AVE 付费也补不了此缺口。

**修复（2026-09-27 用户裁定「可以，但限制在其他购买条件满足的前提下再调
GMGN，否则每一个都调用扛不住」）**——配额控制为核心设计：
- **`gmgn-social-fetcher.mjs`**（新，与 ipfs-fetcher 同构）：GMGN token info 的
  `link` 补社媒——`twitter_username` 拼接（形状不固定：纯 handle 或
  `handle/status/id` 复合串，后者拼出即合法推文 URL 语料更丰富）；website 空串
  过滤；`gmgn_token_info` 缓存 1d + 失败冷却 1h（GMGN 确认无社媒不重打）
- **data-fetch 层 `enrichSocialByGmgn` 开关**：仅交易引擎叙事直调
  （NarrativeDirectCaller）传 true——直调时点买门已 fire（其他购买条件已
  满足）才花 GMGN 配额；narrative engine 队列 / web 路由不传，零调用零行为
  变化（三处调用点实证）
- **触发条件**：extractAllUrls + IPFS 解包后仍无任何 twitter 链接才调——有
  元数据社媒的 token（多数）不增加延迟与配额
- **IPFS 解包前移 + `normalizeIpfsRef`**（同病顺带修复）：裸 CID 归一化为
  pinata 网关 URL 后解包；解包与 GMGN 补源都移到 0-URL 早退之前（IPFS 免费
  先试，GMGN 付费兜底）
- **`no_public_info` 缓存行穿透**（NarrativeAnalyzer）：engine 队列先写入的
  空语料拦截行在补源语境下已失真——直调链路命中该类行时视为未命中重析
  （upsert 覆盖）；其他行（Jev 评过/其他规则拦）照常复用

**验证**：① **BRF 端到端**（182，不带 ignoreCache 专门验证穿透）：
no_public_info 行穿透 → GMGN 补源 `@Bitgetrelief`（9 粉项目方账号）→ 推特
抓取（置顶推文 + bio 挂合约地址）→ 项目币路径地址验证通过 → prestage Jev 判
`web3_native_ip_early` → **unrated**（"需等待社区成长后再评估"，实质判定
而非空语料误拦），耗时 9.9s（30s 直调预算内）；② **HASH 回归**（元数据有
推文的 four.meme 币）：正常路径 2 URL 提取、正常账号规则判定、无 GMGN 调用，
零影响；③ engine/web 链路 `analyze` 调用点 grep 实证不传开关；④ **53c9737c
批量验证**（09-27，four.meme V2 实跑被 no_public_info 误拦的全部 14 个 fire
token 重析）：GMGN 补源成功率 **12/14**——3 翻 high（GEND ×2 同推文 E 类
70.2 / crypto guy C 类 72.04，当时若非误拦会被买入）、9 仍 low 但全部实质
判定（名字指向无名对象 ×2、截词、账号地址验证 ×2、prestage 粉丝 7<60 底线、
superIP 判 low ×2、推文已删 fetch_failed）、2 个 GMGN 也无语料（猿AI/狗熊
哆嗦毛，正确拦截）——判定从「没数据」变成「有判断」，重析行已 upsert 覆盖
旧误拦缓存。

**部署**：182 六文件 scp（09-27 08:25-08:27：gmgn-social-fetcher /
ipfs-metadata-fetcher / cache-ttl-config / data-fetch-service /
NarrativeAnalyzer / NarrativeDirectCaller）。**加载完成**（09-27 用户裁定
全重启）：narrative engine 与 v2-53c9737c 已于 08:43 重启（新 pid
1044505/1044565，Realtime 订阅与水位对齐正常）；08:33 起的 v2-dfc7a623 /
bt-377cc0a6 启动即新代码无需动；0336befc 发现已不在运行（未擅自拉起，
flap V2 实跑中断待用户确认是否有意）。

### C9 bitget被盗 0x0e32 —— 负面硬新闻事件误放 → J1.11（2026-09-26）★

**现象**：0x0e323198cdfd9928831d929a1c78c0c04bdc7777（bitget被盗，铸币蹭 Bitget 官方
被盗公告）被 Jev 评 **high 80.32** → 买门放行（rating=3）后 **-55%**。用户裁定「这个事件
热度挺高，但问题在于，第一，这是一个负面事件；第二，它没有啥 meme 的」——热度高≠该放。

**评级事实链**（token_narrative，`jev(J1.10/D类)` 标准路径，三道门全没拦）：
- event_category **D 1.0**（机构官方公告）+ 量级 A 档（被盗 3.516 亿——被骑事件量级直接
  喂饱事件分 34 + 传播 25.65 + 时效 15 = **74.65>60** 过线）——D 类版 ChainPulse：被骑对象
  的量级直接给骑乘盘计分
- block_reason none 0.94（旧题面 10 选项无负面事件维度可判）
- name_referent notable_other 0.45（Bitget 知名但按量表非超级 IP）→ 阻断侧合计 0.45<0.5
  **差 0.05 未拦**；super_ip 0.42<0.5 也在阻断侧豁免线下
- 骑乘门 rideDetourBelow scope 只 B/C（D 类当时无实证 case 不入域）
- detectIssuerSelfLaunch 不命中（creator 是第三方非 Bitget，公告文本无"bitget被盗"连串）

**修复（J1.11，2026-09-26 用户批准「好，搞吧」）**：负面事件 + 无 meme 性 → 新拦截维度
`negative_hard_news`：
- **题面**（jev-questions block_reason 第 11 选项）：安全事故/被盗/被黑/暴雷/巨额损失/
  灾难类负面事件，语料是事故通报/公告/新闻报道；事件无 meme 化玩味空间——主体是机构
  不参与自嘲传播、无梗无二创动力，蹭名只是消费热度。**边界收窄**（用户确认）：监管罚款/
  项目失败/名人去世等其他负面不选本项，留给 Jev 按实际叙事价值自由裁量
- **代码端双挂**（jev-result-mapper）：① BLOCK_SCOPE `'all'`（argmax 机制全域，标准 +
  superIP 双路径）；② 独立质量门 `negativeHardNewsBlock`——概率 ≥0.5 即拦（不依赖
  argmax/noneProb，覆盖 none/negative 五五开边界抖动；nameReferentBlock 同思路）。
  superIP 通道无豁免（超级 IP 的被盗公告同样无 meme 空间）
- **验证**：① 全量重放 240 行（213 标准 + 27 superIP）J1.11 自身**零翻转**——6 行翻转
  全是既有门对旧 mapper 滞后行的纠正（捕日者 ×4 = v2 骑乘门、GRASS/YAYA = J1.10
  nameReferentBlock，6 行 negativeHardNewsMass 全 null；另 583 行无 rating/answers 不可
  重放，零效果同理成立——存量答案无新键数学上不可触发两道门）；② **bitget被盗
  ignoreCache 端到端**：Jev 真实重调（J1.11 题面）→ D 1.0 + negative_hard_news
  **0.98**（none 0.02）→ **low**，落库 `jev(J1.11/D类)`，blockReason「负面硬新闻事件」
- **部署**：182 两文件 scp + narrative engine 重启（01:41 加载 J1.11）
- **重放副产品**：捕日者 4 行（09-25 06:29 f3ae56d3 回测直调写入的 high 缓存行）实为
  §六-11 多进程 mapper 漂移的滞后行——现行 mapper 下本就是 low（骑乘门），4 个缓存行
  仍是脏 high（未刷新，待 ignoreCache 重跑或失效机制）

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
| J1.11 | 09-26 | block_reason 加 negative_hard_news（第 11 选项，边界收窄到安全事故/被盗/暴雷/巨额损失/灾难）；mapper 双挂 BLOCK_SCOPE 'all' + 概率 ≥0.5 质量门（negativeHardNewsBlock，标准+superIP 双路径）；重放 240 行零翻转 | bitget被盗 C9 | 本 commit |
| J1.12 | 09-27 | name_referent super_ip 加双前提（①忠实呈现：原名直接出现/官方通用标准译名，音译/形近/跨书写系统变体不算；②已官宣存在：传闻/泄露/内部曝光/未官宣计划名不算），不满足判 notable_other（承接语义入该 criteria）；mapper 零改动；重放 289 行零新增翻转 | 哦 0xbefe2b70 C11 | 5668e4c |
| J1.13 | 09-27 | block_reason 加 routine_content_product（第 12 选项：常规内容产品宣传——电影/剧集/综艺/动漫/小说/游戏发布上映预告，官宣与否无关均拦；边界：全民玩梗对象/文化符号/公共事件/世界级实体产品不选）；mapper 双挂 BLOCK_SCOPE 'all' + 概率 ≥0.5 质量门（routineContentProductBlock，标准+superIP 双路径）；重放 289 行零新增翻转 | 绣春刀3 0xa7c9c86e C12 | `36b66cb` |
| J1.14 | 09-27 | name_referent super_ip 加第③前提「实体性」（主定义扩含「IP 亲口提及/讲述的具体实体=提及即事件」Giggle 语义，不含被@的普通人物；「IP名+日常物品词」拼接/无实体对应无 meme 元素的普通词组判 common_word）+ common_word 去「文本作者非超级IP」限制；mapper 零改动；重放 322 行（含 superIP）零新增翻转 | Cz黄鞋 0x91c4c4e9 C14 | 本 commit |
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
- 负面硬新闻拦截（2026-09-26，C9 bitget被盗案，J1.11）：block_reason 加
  negative_hard_news 选项（边界收窄到安全事故/被盗/暴雷/巨额损失/灾难，其余负面
  留给 Jev 自由裁量）+ mapper 双挂（BLOCK_SCOPE 'all' argmax 机制 + 概率 ≥0.5
  质量门 negativeHardNewsBlock，标准 + superIP 双路径，superIP 无豁免）；端到端
  negative_hard_news 0.98 → low，重放 240 行 J1.11 自身零翻转
- GMGN 社媒补源（2026-09-27，C10 BRF案）：元数据+IPFS 均无社交链接的 token，
  叙事直调时（买门已 fire）调 GMGN token info 补社媒入口（付费配额控制：
  engine 队列/web 链路零调用）；IPFS 解包前移+裸 CID 归一化（normalizeIpfsRef）；
  no_public_info 缓存行直调穿透重析。AVE 实测无独立社媒渠道（appendix 与
  four.meme 元数据逐字符一致）不可行
- 名字忠实度+传闻维度（2026-09-27，C11 哦案，J1.12）：super_ip 豁免加双前提
  （忠实呈现——音译/形近/跨书写系统变体不算；已官宣存在——传闻/泄露/内部曝光/
  未官宣传闻名不算），不满足判 notable_other 走阻断 scope——变体蹭名盘（"o"→
  「哦」抢注 OpenAI 传闻名）掉出「超大超火被骑可放」豁免被拦；忠实用名（天才）
  零误伤，mapper 零改动
- 常规内容产品宣传拦截（2026-09-27，C12 绣春刀3案，J1.13）：block_reason 新增
  routine_content_product——电影/剧集等内容型产品宣传无 meme 玩味空间（观众是
  消费者非玩梗社区），官宣与否无关均拦（产品知名度≠该放，C9 同构）；super_ip
  0.66 命中 C8 豁免的骑乘电影名盘（65.95 high）被类型确定性拦截（rcp 0.95 argmax）；
  梗/文化符号/公共事件不误伤（天才 0.76 保持 high、嫦娥 rcp=0 保持 high）；
  mapper 与 negative_hard_news 同构双挂（BLOCK_SCOPE 'all' + ≥0.5 质量门，标准
  +superIP 双路径）
- 实体性前提（2026-09-27，C14 Cz黄鞋案，J1.14）：name_referent super_ip 加第③
  前提——名字主体须指向具体实体；主定义扩含「IP 亲口提及/讲述的具体实体=提及
  本身即事件」（Giggle 语义，superIP 讲第三方主体成立），「IP名+日常物品词」拼接
  （Cz黄鞋）或无实体对应无 meme 元素的普通词组判 common_word；common_word 去
  「文本作者非超级IP」限制（正是本案 common_word 被压低的题面原因）。拼接蹭名盘
  （0.44 argmax 摇摆 → high 77.15）重析 common_word 0.78 拦；天才（自指原话）/
  哦（变体传闻）零回归，mapper 零改动

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

### 4.7 交易引擎买前因子
- **净流入因子**（2026-09-27，C13 共合对倒案）：`earlyTradesNetBuyRatio` =
  (Σ买BNB − Σ卖BNB)/Σ买BNB × 100，earlyTradesWindow 90s 窗口创建锚定口径
  （age>90s / launchAt 缺失 → 通过值 100 + covered=0 fail-open）；伴生因子
  `earlyTradesNetBuyCovered` 标记口径覆盖。策略用法：preBuyCheckCondition 加
  `earlyTradesNetBuyRatio >= 40`（校准：对倒盘 fire 全 ≤39.8 拦、赢家全 ≥58.6 放；
  极早 fire <15s 无信息由 holders 门补位）。四方向证伪（集中度/双向钱包占比/
  creator 发币史/克隆数）见 C13
- **同额度买入簇因子**（2026-09-27，C16 双作弊票案）：`earlyTradesUniformBuyClusterRatio`
  = 最大同额度簇钱包数 / 非尘埃（≥0.01 BNB）买入钱包数 × 100（金额 toFixed(2)
  分簇，同钱包多笔合并），伴生 `earlyTradesUniformBuyWallets`（分母）/
  `earlyTradesUniformBuyClusterN`（最大簇）/ `earlyTradesUniformBuyCovered`。
  90s 创建锚定口径，fail-open 放行值 **0**（拦截门是"达到阈值触发"，与净流入
  因子的高值放行方向相反）。策略用法：`earlyTradesUniformBuyWallets < 10 OR
  earlyTradesUniformBuyClusterRatio < 50`（校准：两票 83.3%/71.4% 拦、赢家全
  ≤28.6% 放；手法还原与 0x168303a9 黑名单否决见 C16）

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

**V2 策略回测 f3ae56d3（2026-09-25，源 5866a04e 虚拟副本0924 窗口）**：11325 token /
66000 tick / 21h 全 flap。**ΣPnL -0.3793，8 轮 0 胜，全部冻结强平、0 策略卖腿触发**。
- 买门实测正常：8 票 rating 全 2/3、holders 6-9（刚过 >5）、同名 maxFDV 全 <6k 放行；
  7629 信号只过 8——严格买门在本窗口选票本身没有问题
- **卖腿零触发的机制分解**（E5e 小票盲区第三次实证，本窗口无一冲毕业票）：8 票终态
  graduationProgress 全钉 0.077-0.104（flap 小票地板市值 ~5.5 BNB）→ P1 硬底门 0.05
  差一点够不着（0.077>0.05）、P2/P4 市值门 0.6667 与 P3/P8 毕业臂不可达、
  rsi9Bar5mRt 7/8 全程 null（5m bar 构建不足）
- **同窗口对照组**：源实验 5866a04e 自己（rating 含 9 宽门 + 老分档 trailing）
  28 票 6 胜 +0.32；其中 6 个盈利票 ≥4 个 rating 也是 2/3（两边都买）——差异不在买门在卖侧
- **买点对比**：6/8 票两边同秒同价（直调秒级+holders 门不推迟买入）；和平熊猫
  0xb77767 晚 59s 买贵 3.2 倍（1 分钟拉 3 倍的山顶，回测最差 -80.6% vs 源最好 +198.5%）、
  捕日者 0xf325 晚 18s 贵 63%
- **反事实**：trail(peak8·dd12·bail5) 在回测买点（山顶价）上 Σ +0.0236 vs 实际 -0.3793
  ——Δ+0.40 全是"无中段止盈"的代价；6/8 轮峰值 ≥15%（均值 64.7%）全漏
- 结论：E5c 8 腿对「不冲毕业的中小票」零收割零保护（§六-9 三方向裁定紧迫度上升）；
  卖点反事实 top 失配 sim+14% vs 实际-63%（同票同路径）全部出自无腿触发

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
14. **executed 信号 0 成交——个别买入静默失败**（2026-09-27 C11 附带发现，C14 修正
   定性）：0xbefe2b70（哦）与 0x91c4c4e9（Cz黄鞋）BUY 信号（0336befc 实时 / 377cc0a6
   回测）`execution_status=executed`（preBuy 全过），但 trades 均 0 行，日志到「早期交易
   数据存储成功」后无买入执行记录。**非系统性断点**：0336befc 同日 13:33-18:26 另有
   8 笔正常成交（中国第一×4/KUKU/JEANPHIL）——执行链没断，是这两个 token 的买入
   静默失败（共同特征：创建后 16-65s 内 fire 的极新盘）。是否深查待裁定
15. **377cc0a6 回测题面版本混杂**（2026-09-27 J1.12 部署遗留）：回测进程 08:33 启动加载
   J1.11，J1.12 部署时未重启（避免中断回放）——直调命中缓存受 J1.12 新行影响、
   miss 的 token 首析仍 J1.11。中断重跑 vs 跑完接受混杂，待用户裁定
16. **「牛来」0xbeea1d61 完全未进系统**（2026-09-27 C12 附带发现）：用户举例的正例
   （crypto 原生梗盘），无 wss_events / wss_price_ticks（0 行）/ 监控池行——watcher
   断供窗口漏采 token_create 嫌疑。是否排查 09-26 前后心跳连续性待裁定
17. **≤J1.12 豁免/骑乘区脏 high 缓存 21 行**（2026-09-27 C12 排查）：旧题面 answers 下
   评的 high 行（crypto guy sip 0.81 / 子曰 0.58 / 孔子AI 0.76 / 熊猫外交 0.7 / 捕日者×4 /
   嫦娥×3（正例）/ BOT 0.53 等），离线重放发现不了（题面改动改变 Jev 答案本身，本案
   即证据）。实时实验无买入风险（全过观察窗），回测会吃到——回测前按 E5e2 流程
   ignoreCache 批量刷新（嫦娥等正例预期保持 high）；彻底解法（题面版本变化时的
   缓存失效机制）仍是 CLAUDE.md 已记录的 planned-not-built
18. ~~**净流入因子阈值与应用面**~~（**已解决**，2026-09-27 用户批准写入上线）：阈值
    维持 40（共合R2 39.77 贴线，但 C15 x-0 18.6% 强拦截实证 + 中间带 [40,86] 空旷，
    保守不抬）；已与簇因子门同门写入运行中实验 53c9737c / dfc7a623
    preBuyCheckCondition，进程 11:16 重启加载（详见 C16「上线」段）。
    0336befc 母版已停未写入（拉起待用户确认）
19. **E 类 name_referent 阻断 scope**（2026-09-27 C13 附带发现）：共合 E 类 common_word
   0.93 但 E 不在 NAME_REFERENT_BLOCK_SCOPE（现 B/C/D/F/G+W）→ S 档事件分喂饱 81.7
   过线 high 放行。扩 E 有误伤风险（Zen Monkey E 类 +68%），需全量重放验证误伤面，
   待用户裁定
20. ~~**同额度簇因子阈值与应用面**~~（**已解决**，2026-09-27 与 §六-18 净流入门
    同门写入运行中实验 53c9737c / dfc7a623 并重启加载——两因子互补组合上线，
    阈值维持 wallets≥10 AND ratio≥50 保守值，详见 C16「上线」段）
