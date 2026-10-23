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

> （尚无条目——新案在此倒序追加）

## 三、Jev 问题集版本演进（卷四起）

> J1.109 及之前全史见卷三归档 §三（J1.87-J1.109 为 2026-10-23 归档时补录的简式索引）；
> 卷四起新版本行在此追加。

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
