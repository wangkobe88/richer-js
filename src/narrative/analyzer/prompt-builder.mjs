/**
 * Prompt构建器
 * 完整迁移自 scripts/narrative/llm_analysis/prompt-template-v4.mjs V5.10
 */

export class PromptBuilder {

  static getPromptVersion() {
    return 'V5.14';
  }

  /**
   * 构建代币叙事分析Prompt（完整版）
   * @param {Object} tokenData - 代币数据
   * @param {Object} twitterInfo - Twitter信息
   * @param {Object} websiteInfo - 网页内容信息（仅在无Twitter信息时使用）
   */
  static build(tokenData, twitterInfo = null, websiteInfo = null) {
    const introEn = tokenData.intro_en || '';
    const introCn = tokenData.intro_cn || '';
    const website = tokenData.website || '';

    // 构建输入内容（明确标注推文/账号和介绍，避免混淆）
    const contentParts = [];

    // 优先使用Twitter信息
    if (twitterInfo) {
      if (twitterInfo.type === 'account') {
        // 账号信息格式
        const accountInfo = [];
        accountInfo.push(`【推特账号】@${twitterInfo.screen_name} (${twitterInfo.name})`);
        if (twitterInfo.description) {
          accountInfo.push(`简介: ${twitterInfo.description}`);
        }
        accountInfo.push(`粉丝数: ${(twitterInfo.followers_count || 0).toLocaleString()}`);
        accountInfo.push(`认证状态: ${twitterInfo.verified ? '已认证' : '未认证'}`);
        accountInfo.push(`推文数: ${(twitterInfo.statuses_count || 0).toLocaleString()}`);
        contentParts.push(accountInfo.join('\n'));
      } else if (twitterInfo.text) {
        // 推文格式（现有逻辑）
        contentParts.push(`【推文】${twitterInfo.text}`);
      }
    } else if (websiteInfo && websiteInfo.content) {
      // 没有Twitter信息时，使用网页内容
      contentParts.push(`【网页内容】${websiteInfo.content}`);
      contentParts.push(`【网页来源】${websiteInfo.url}`);
    }

    if (introEn) contentParts.push(`【介绍英文】${introEn}`);
    if (introCn) contentParts.push(`【介绍中文】${introCn}`);
    if (website) contentParts.push(`【网站】${website}`);
    const contentStr = contentParts.join('\n') || '无可用内容';

    return `评估BSC链代币叙事质量。

【代币】${tokenData.symbol || 'N/A'}
${contentStr}

【重要说明】
- "【推文】"是推文的实际内容
- "【推特账号】"是代币关联的推特账号信息（简介、粉丝数、认证状态等）
- "【网页内容】"是代币网站页面的正文内容（仅在无Twitter信息时使用）
- "【介绍英文/中文】"是代币的介绍文字，不是推文内容
- 如果【推文】只是一个链接（如"https://t.co/xxx"），说明主体信息在链接中，无法评估
- 如果只有推特账号信息而无推文，说明叙事线索主要在账号背景中
- 如果只有【网页内容】而无推文，说明叙事线索主要在网页内容中

【核心原则】
评估BSC链meme代币的叙事质量。注意：
- Meme币无实用价值，通过借助引用的事物/概念进行传播
- "代币实质"是指代币代表什么/关联什么/传播什么概念（而非用途/功能）
- **关键**：对于meme币，内容中提到代币同名人物/事物即视为有实质（如"COCO发贴"→COCO就是那个人），无需额外解释"代表"关系
- 与代币名称有强关联即可
- 评估叙事本身的质量，而非验证真假
- 情感共鸣、社会讨论、文化认同、梗文化都是meme币的核心叙事背景，不应因"缺乏官方背书"而低估
- **区分"官方代币"和"蹭平台热度的meme币"**：
  - 如果推文明确说明"XX平台官方发布XX代币"、"这是XX的官方代币" → 官方代币叙事
  - 如果只是"XX平台上线了XX功能/服务/产品，代币叫XX" → 可能是蹭平台热度的meme币，影响力打折扣
  - 判断标准：是否有明确的"官方发布"、"官方代币"表述，否则视为蹭热度
- **平台产品更新的影响力评估**：
  - 世界级知名平台（币安、特斯拉、Twitter、苹果等）的功能更新 → 可能是平台级影响力
  - 一般/中小型平台的功能更新 → 影响力有限（0-8分），除非有病毒式传播证据
  - "一个平台增加一个功能"属于产品迭代，不是重大事件，不应高估
- **大IP关联标准**：世界级大IP（特朗普/马斯克/CZ等）需要强证据才能建立有效关联
  - **区分两种情况**：
    1. **大IP官方背书代币**：需要本人提及、官方发布、权威媒体报道等强证据
       - 例如：Elon发推说"我发了一个代币" → 需要Elon本人提及
       - 如果只是简单命名（如"它叫特朗普"）视为蹭热度/伪关联，直接返回low
    2. **基于大IP相关事件的代币**：只需要有人声称/报道了这个事件即可
       - 例如：作家推文说"获得Elon许可出版这本书" → 这是真实事件叙事，不需要Elon认可这个代币
       - 叙事价值在于这个事件本身，而非大IP的官方认可
  - **加密相关账号识别**：
    - **@cz_binance** = CZ（币安创始人），世界级加密人物
    - **Trust Wallet** = 币安旗下钱包，平台级影响力
    - 如果推文作者是这些项目的人，或者推文中提到这些账号/平台，应该加分
    - 例如：Trust Wallet员工的推文提到"My mentor @cz_binance" → 这是平台级叙事，至少mid
  - 大IP列表：美国总统、顶级名人（马斯克/特朗普等）、CZ、币安、苹果/微软等世界级品牌
  - 小IP/新概念（一只狗、网络梗）：只需说明"这是什么"即可建立关联

【评估步骤】
第一步：判断推文时间（最高优先级）
- **前提：必须明确知道推文发布时间（createdAt字段有值）**
- **如果推文发布时间超过2周（14天）**：直接返回 low
- 原因：老推文通常已被用于发过多个代币，叙事价值已耗尽
- **当前日期：2026年3月19日**（用于判断推文时间是否过久）
- **注意**：如果createdAt为空/null，跳过时间判断（不能假设推文时间）

第二步：判断推文语言
- **如果有推文且不是中文/英文**：直接返回 low，不再检查其他条件
- 原因：非中英文推文会极大限制主要用户群体的传播，即使有链接也无法有效传播
- **注意**：如果推文内容显示为"True"/空/无法获取实际文本，返回 unrated（无法判断内容，可能是转发/私有/删除）

第三步：判断推文关联度（优先处理，避免误判为low）
- **如果有推文且推文仅为链接（如只有"https://t.co/xxx"）**：
  - **直接返回 unrated**，不再检查其他条件
  - 原因：推文内容只有链接，未提及代币或关联概念，核心信息在链接中，无法评估
- **如果有推文且推文包含链接/图片和其他内容**：
  - 推文明确提到代币名称或关联概念 → 继续评分
  - 推文未提及代币，也无法理解关联 → 返回 unrated
  - **特别注意**：如果链接是抖音/YouTube等外部平台，且推文内容无意义 → 返回 unrated
- **如果有推文但没有链接/图片（纯文本）**：
  - 强关联（推文提到代币或关联概念）→ 继续评分
  - 关联弱（代币仅被顺便提及）→ 后续继续判断，可能返回low
- **如果只有推特账号信息而无推文**：
  - 需要通过账号简介、粉丝数、认证状态等来评估叙事潜力
  - 认证账号 + 有意义的简介 + 一定粉丝数 → 可以评分
  - 无简介或粉丝数极低 → 可能返回 low 或 unrated

第四步：判断可理解性
- 内容是否足以理解代币是什么、有什么叙事价值？
- **完全无信息→unrated**：无推文 + intro只是名字/简单描述 + 无website
  - 例如：intro只是"Tom the lizard"、"1%"等，没有说明这是什么、有什么价值
  - 这种情况无法评估叙事质量，直接返回unrated
- **无价值内容直接low**：无推文 + intro为通用描述/无意义 + 无有效website
  - 通用描述示例：Infinite Runner、This is Elon、只有单词
  - 无效website：推特搜索链接、空链接、无website
- **主体信息在外部平台→unrated**：无推文 + intro简单 + website是内容平台链接
  - 内容平台链接：X社区(/i/communities/)、抖音视频、YouTube等
  - 示例：website是https://x.com/i/communities/xxx → 主体信息在社区里，无法评估
- 如果完全无法理解代币性质，返回 unrated

第五步：检测"低质量叙事"（以下情况直接返回low）
1. **纯谐音梗**：只有谐音关联（如"生菜=生财"、"Duck you=鸭你一拳"），无实质内容
   - 即使有情感包装（如"社畜情感共鸣"），如果核心只是谐音 → 直接low
   - 判断标准：如果去掉谐音关联，代币没有其他实质性叙事 → 纯谐音梗
2. **热搜搬运**：纯报道热点事件（如"火鸡面上热搜"、"遗憾话题爆火"），未与代币名称建立关联
   - 只是提到"XX上热搜/爆火"，没有具体内容/事件 → 蹭热搜，low
3. **泛泛情感概念**：只是借用常见词/抽象概念，没有具体事件/独特性支撑
   - 例如："遗憾"、"佛系"、"躺平"、"社恐"、"孤独"等常见词
   - 如果没有具体的故事/文化符号/社区共识支撑 → low
   - 区分：伞（有避雨情感+社区符号=有价值）vs 遗憾（只是抽象词=无价值）
4. **伪关联**：代币名称只在内容中顺便提及，不是核心主题（但**结尾口号式提及不算伪关联**）
   - **V5.10例外**：个人创业故事中，代币名称是核心隐喻/象征，贯穿故事始终 → 不算伪关联
     - 例如：童年抓青蛙 → 创业精神 → 现在做加密，"青蛙"是核心隐喻
     - 判断标准：代币名称是否在故事中反复出现、是否是故事的核心象征
5. **大IP蹭热度**：代币名称是世界级大IP（特朗普/马斯克/CZ等），但缺乏强关联证据
   - **世界级大IP**：美国总统、顶级名人、CZ、币安、世界级品牌等
   - **区分两种情况**：
     - **情况A（官方背书代币）**：代币声称是大IP官方发行的，需要**本人提及、官方发布、权威媒体报道**
       - 如果只是同名或简单提及（如"它叫特朗普"）→ 蹭热度，直接返回low
     - **情况B（基于大IP相关事件的代币）**：代币基于某个真实事件/声称，**不需要**大IP官方认可
       - 例如：作家推文说"获得Elon许可出版这本书" → 这是真实事件叙事，可以评分
       - 关键：叙事价值在于这个事件本身，而非大IP的官方背书
6. **平台产品更新蹭热度**：内容只是某个平台上线了新功能/新服务，代币蹭这个热度
   - **判断标准**：推文只是说"XX平台上线了XX功能/Skills/服务"，没有明确的"官方代币"表述
   - **影响力评估**：
     - 世界级知名平台（币安、特斯拉、Twitter等）的功能更新 → 可能有一定影响力，但需谨慎评估
     - 一般/中小型平台（如Orbofi、普通Web3项目）的功能更新 → 影响力极低（0-8分），通常返回low
   - **原因**："一个平台增加一个功能"是产品迭代，不是重大事件，除非有病毒式传播的证据
   - **示例**："Orbofi上线Fourmeme Skills功能" → 只是产品更新，非知名平台，影响力有限 → low

第六步：如果通过以上检查，按以下标准评分

【评分维度】（总分100）
1.叙事背景(50分):按影响力量级评分（加密相关有优势，情感叙事有溢价）

  * **世界级公司事件分级**（根据公司级别和事件类型）：
    - **第一梯队公司（Meta/Facebook、Google、Apple、Tesla、微软、亚马逊）的**：
      - 品牌战略级事件（如Facebook→Meta）：35-50分
      - 革命性产品发布（如iPhone、ChatGPT级别）：30-45分
      - 重大产品更新：20-35分
    - **第二梯队公司（阿里巴巴、腾讯、字节跳动、亚马逊AWS等区域性/特定领域巨头）的**：
      - 品牌战略级事件：20-35分
      - 重大产品发布：15-30分
      - **组织调整/部门设立**：5-15分（如"成立XX事业群"、"成立AI部门"）
    - **其他知名公司**：组织调整/部门设立 → 0-8分

  * **AI相关事件的特殊处理**（2025-2026年AI已常态化）：
    - **革命性AI突破**（如ChatGPT级别）：30-45分
    - **知名公司"成立AI部门"**：0-10分（已是常态，缺乏传播价值）
      - 原因：2025-2026年，几乎所有大公司都在做AI，"成立AI部门"不是新闻
      - 除非有突破性创新产品，否则视为常规组织调整
    - **普通AI产品发布**：5-15分

  * 币安/官方权威（如"币安XX"、"CZ演示"、"官方项目"、CZ相关）：35-50分
  * 世界级/加密重大事件（如全球大事件、顶级名人、国际主流媒体、CZ相关）：30-44分
  * 平台级影响力（加密相关）：25-34分（如抖音千万话题+币圈人物、知名KOL、交易所相关）
  * 平台级影响力（一般）：20-29分（如抖音千万话题、国家新闻、大型平台热点）
  * **社区级情感叙事（强情感共鸣）**：20-34分
    - **条件**：具备情感共鸣 + 具体故事/文化符号/社区共识支撑
    - **示例**：伞（避雨情感+社区符号）、特定的文化梗（唐·毒蛇）
    - **注意**：常见抽象词不算（如"遗憾"、"佛系"只是词，没有独特故事）
    - 关键区别：有具体的文化符号/故事=有价值，只是借用常见词=泛泛概念
  * 社区级影响力（加密相关）：10-24分（如加密社区KOL、币圈事件）
  * 社区级影响力（一般）：5-19分（如地方性事件、小圈子热点）
  * **媒体命名权威性分级**：
    - **顶级平台官方命名**：25-35分（如"抖音官方称XX为YY"、"微博官方命名"）
    - **普通媒体用语**：0-10分（如量子位、36氪、虎嗅等只是报道用语，不是命名）
    - 例如："量子位称XX为鹅虾"→只是科技媒体的报道用语，不是官方命名
    - 只有平台官方（抖音/微博/B站等）或国家机构的命名才有权威性
  * **限定范围影响力**：0-8分
    - **关键**：明确限定地点/范围的事件影响力有限
    - 例如："深圳商场里看到了好几个"→只是商场里的广告牌，连地区级都算不上
    - 判断标准：如果内容明确说明"深圳商场"、"北京XX商场"等限定具体场所，属于极低影响力
  * 无明确影响力：0-4分
  * 注意：同一层级中，加密相关事件比一般事件高约5分

2.传播力(50分):meme潜力+社交属性+情感共鸣+FOMO+内容丰富度
  * **情感溢价**：若叙事具备强情感共鸣，在原分数基础上+5分
  * **限定范围降权**：如果内容明确限定地点（如"深圳商场"），传播力减半
  * **AI相关事件降权**：常规AI产品发布/部门设立，传播力减半（AI已泛滥，缺乏新鲜感）
  * 具备病毒传播属性+内容丰富：40-50分
  * 有较强传播性+内容较丰富：30-39分
  * 有一定传播性：15-29分
  * 传播力弱：0-14分

【评级标准】
- unrated: 内容无法理解代币性质，或 推文包含链接/图片但无法理解与代币的关联
- low: 触发任何伪叙事模式，或 非中英文推文，或 纯文本推文关联弱，或 总分<50
- mid: 叙事背景≥20 且 总分≥50
- high: 叙事背景≥35 且 总分≥75

【评分示例】
示例1(币安官方):
介绍:币安演示狗币MOONDOGECOIN
币安官方+强传播力→{credibility:35,virality:38,total:73,category:"high"}

示例2(纯谐音梗-直接low):
代币:生菜
内容:支付宝热搜"生菜=生财"，顶级谐音梗
纯谐音梗，无传播潜力→{category:"low",reason:"纯谐音梗，无代币用途或价值主张说明"}

示例3(热搜搬运-直接low):
代币:火鸡面
内容:81岁爷爷误食火鸡面被辣到，微博热搜事件
纯热点搬运无代币意义→{category:"low",reason:"纯热搜事件搬运，未说明与代币的关联或代币价值"}

示例4(伪关联-直接low):
代币:宝可梦
内容:个人创业故事，仅在开头提到"8岁时在宝可梦热潮期间卖青蛙"（无链接/图片）
纯文本关联极弱→{category:"low",reason:"代币名称只在背景中顺便提及，与内容核心主题无关"}

示例4.5(CZ相关-可评分):
代币:MWM
内容:CZ的书籍《Money Without Masters》泄露草稿
CZ相关(加密重大事件)+强传播力→{credibility:35,virality:40,total:75,category:"high"}

示例5(有链接但无法理解-unrated):
代币:Memrush
内容:简短"打错了" + https://t.co/xxx链接
推文未提及代币或关联概念，只有链接→{category:"unrated",reason:"推文包含链接但未提及代币或任何关联概念，无法评估"}

示例6(平台级热点-可评分):
代币:大狗大狗
内容:抖音爆火的"大狗"声音，已有上千万话题热度，像"doge doge"
平台级热点(抖音千万话题+doge相关)+强传播力→{credibility:22,virality:45,total:67,category:"mid"}

示例6.5(社区级加密-可评分):
代币:BONKRot
内容:基于Solana链知名代币$bonk的嘲讽版本
社区级影响力(加密社区)+中等传播力→{credibility:12,virality:42,total:54,category:"mid"}

示例7(币安平台级-可评分):
代币:天使—COCO
内容:币安Openclaw聊群的群主 天使 COCO在广场发了贴
平台级影响力(币安广场)+强传播力→{credibility:28,virality:47,total:75,category:"high"}

示例8(社区级一般-可评分):
代币:30000
内容:"人生不过30000天"的哲学概念
社区级影响力(哲学概念)+中等传播力→{credibility:8,virality:45,total:53,category:"mid"}

示例9(高质量-币安官方):
代币:某代币
内容:币安发布的新功能代币，有明确概念和官方背景
币安官方+强传播力→{credibility:38,virality:50,total:88,category:"high"}

示例10(情感叙事-可high):
代币:伞
内容:伞字梗，避雨情感共鸣，加密社区文化符号
社区级情感叙事(强情感共鸣)+强传播力→{credibility:28,virality:47,total:75,category:"high"}

示例11(文化梗-可high):
代币:唐·毒蛇
内容:创意文化梗，社区传播潜力强
社区级情感叙事(文化梗)+强传播力→{credibility:25,virality:50,total:75,category:"high"}

示例12(泰语推文-直接low):
代币:卡穆
内容:สวัสดีวันเสาร์ #hippo https://t.co/xxx
泰语推文→{category:"low",reason:"推文为泰语，非中英文内容限制传播"}

示例13(无价值内容-直接low):
代币:π
介绍:Infinite Runner, website:推特搜索链接
无有意义内容→{category:"low",reason:"无推文，介绍为通用描述，无有效信息来源"}

示例14(抖音链接-unrated):
代币:猿神
介绍:信我我后期很牛逼, website:抖音链接
主体信息在外部平台→{category:"unrated",reason:"推文无意义，主体信息可能在抖音链接中"}

示例15(老推文-直接low):
代币:躺赢
内容:CZ的推文（2025年5月）
推文发布超过2周→{category:"low",reason:"推文发布时间过久，叙事价值已耗尽"}

示例16(普通媒体用语-low):
代币:鹅虾
内容:量子位将腾讯openclaw称为"鹅虾"
普通媒体用语(无权威性)→{category:"low",reason:"量子位仅为科技媒体，其用语只是报道，非官方命名"}

示例16.2(平台官方命名-可high):
代币:某代币
内容:抖音官方将此称为年度热词
平台官方命名(有权威性)+强传播力→{credibility:30,virality:42,total:72,category:"high"}

示例16.5(限定范围影响力-low):
代币:宽宽
内容:深圳商场里的公益广告"愿手术台上没有下一个宽宽"
商场广告牌(极低影响力)+传播力受限→{credibility:5,virality:12,total:17,category:"low",reason:"只是商场里的广告牌，连地区级都算不上"}

示例17(普通媒体用语-low):
代币:鹅虾
内容:量子位将腾讯openclaw称为"鹅虾"
普通媒体用语(无权威性)→{category:"low",reason:"量子位仅为科技媒体，其用语只是报道，非官方命名"}

示例17.5(外部平台链接-unrated):
代币:抽象
介绍:抽象=CX 五千亿播放的话题, website:https://x.com/i/communities/xxx
主体信息在X社区→{category:"unrated",reason:"无推文，website是X社区链接，主体信息无法评估"}

示例18(口号式强关联-可评分):
代币:russian victory
内容:投资建议讨论...total russian victory https://t.co/xxx
结尾口号式提及+强传播力→{credibility:18,virality:42,total:60,category:"mid"}

示例19(大IP蹭热度-直接low):
代币:Trump
内容:它叫特朗普
大IP蹭热度(无强关联证据)→{category:"low",reason:"代币名称是世界级大IP(特朗普)，但推文只是简单提及'它叫特朗普'，缺乏本人提及、官方发布或权威媒体报道等强关联证据"}

示例20(纯链接推文-unrated):
代币:1%
内容:【推文】https://t.co/acZFJamLN1 【介绍英文】1%
推文仅为链接，未提及代币→{category:"unrated",reason:"推文内容仅为链接，未提及代币名称或关联概念，核心信息在链接中"}

示例21(有链接但无法理解-unrated):
代币:微笑狗
内容:Tried a shorter prompt this time. #Four #FourCommunity https://t.co/xxx
推文包含链接但未提及代币→{category:"unrated",reason:"推文包含链接但未提及代币名称或任何关联概念，核心信息可能在链接中"}

示例22(完全无信息-unrated):
代币:TOM
内容:【介绍英文】Tom the lizard
无推文+intro只是名字+无website→{category:"unrated",reason:"无推文，intro只是简单名字'Tom the lizard'，没有说明这是什么、有什么价值，无法评估叙事质量"}

示例23(基于大IP相关事件的叙事-可high):
代币:TBOE
内容:【推文】How it felt to get Elon's permission to publish this book after 4 years of working on it 【介绍英文】The book of elon
真实事件叙事(作家声称获得Elon许可出版书)+强传播力→{credibility:32,virality:45,total:77,category:"high",reason:"基于真实事件(作家获得Elon许可出版书)，这是有价值的叙事，不需要Elon官方认可这个代币"}

示例24(纯谐音梗-直接low):
代币:Duck you
内容:Duck you的视觉暴击和硬核梗文化
纯谐音梗(Duck you=鸭你一拳)→{category:"low",reason:"纯谐音梗，核心只是谐音关联，即使有情感包装也没有实质内容"}

示例25(泛泛情感概念-low):
代币:遗憾
内容:人生中的遗憾，情感共鸣
泛泛情感概念(只是常见词"遗憾"，没有具体故事/独特性)→{category:"low",reason:"只是借用常见词'遗憾'，没有具体的故事、文化符号或社区共识支撑"}

示例26(蹭热搜-low):
代币:社恐人
内容:社恐在微博热搜第一
蹭热搜(只是提到"上热搜"，没有具体内容/事件)→{category:"low",reason:"只是提到'社恐上热搜'，没有具体的叙事内容或事件，属于蹭热点"}

示例27(有价值的情感叙事-可high):
代币:伞
内容:伞字梗，避雨情感共鸣，加密社区文化符号
社区级情感叙事(有具体文化符号+情感共鸣)→{credibility:28,virality:47,total:75,category:"high",reason:"有具体的文化符号'伞'和'避雨'情感，具备社区共识和传播潜力"}

示例28(个人创业故事-可mid):
代币:青蛙
内容:【推文】Trust Wallet员工个人故事，童年抓青蛙创业 → 现在做加密，My mentor @cz_binance gives me full support
个人创业故事(青蛙是核心隐喻)+Trust Wallet+CZ背书→{credibility:28,virality:40,total:68,category:"mid",reason:"个人创业故事，'青蛙'是核心隐喻贯穿始终，且有Trust Wallet和CZ背书，具备平台级影响力"}

示例29(第二梯队公司组织调整-low):
代币:ATH
内容:【网页内容】阿里巴巴成立Token Hub事业群，建立以"创造Token、输送Token、应用Token"为核心目标的全新组织，由CEO吴泳铭直接负责...
第二梯队公司(阿里巴巴)的组织调整(成立Token Hub事业群)→{credibility:10,virality:12,total:22,category:"low",reason:"阿里巴巴虽然是大公司，但只是内部组织调整(成立事业群)，且AI相关事件在2025-2026年已是常态，缺乏传播价值"}

示例29.1(第一梯队公司品牌战略-可high):
代币:META
内容:Facebook宣布更名为Meta，全力进军元宇宙
第一梯队公司(Meta)的品牌战略级事件(Facebook→Meta)→{credibility:40,virality:45,total:85,category:"high",reason:"Meta(Facebook)的品牌战略级转型，是全球关注的重大事件，具备世界级影响力"}

【输出格式】
正常评分输出（包含scores）:
{"reasoning":"2-3句中文说明理由","scores":{"credibility":0-50,"virality":0-50},"total_score":0-100,"category":"high/mid/low"}

无法理解输出（不包含scores）:
{"category":"unrated","reasoning":"说明无法理解代币性质的原因"}
`;
  }
}
