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
  negativeHardNewsBlock / web3FitBlock（unfit ≥0.5）/ referent 豁免（J1.21，仅 superIP）
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
