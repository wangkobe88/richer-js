/**
 * Prompt构建器
 * 评估BSC链meme代币叙事质量
 * V5.20 - 重构版：简化结构，消除冗余
 */

export class PromptBuilder {

  static getPromptVersion() {
    return 'V5.20';
  }

  /**
   * 构建代币叙事分析Prompt（完整版）
   * @param {Object} tokenData - 代币数据（包含 symbol, address, raw_api_data）
   * @param {Object} twitterInfo - Twitter信息
   * @param {Object} websiteInfo - 网页内容信息（仅在无Twitter信息时使用）
   * @param {Object} extractedInfo - 提取的结构化信息（包含 intro_en, intro_cn, website, description）
   */
  static build(tokenData, twitterInfo = null, websiteInfo = null, extractedInfo = null) {
    // 从 extractedInfo 获取，如果没有则尝试从 tokenData 获取
    const info = extractedInfo || {};
    const introEn = info.intro_en || tokenData.intro_en || '';
    const introCn = info.intro_cn || tokenData.intro_cn || '';
    const description = info.description || tokenData.description || '';
    const website = info.website || tokenData.website || '';

    // 从 raw_api_data 获取 name
    const rawData = tokenData.raw_api_data || {};
    const tokenName = rawData.name || rawData.tokenName || tokenData.symbol || '';

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
        // 推文格式
        contentParts.push(`【推文】${twitterInfo.text}`);

        // 如果有推文链接内容，添加到内容中
        if (twitterInfo.link_content && twitterInfo.link_content.content) {
          contentParts.push(`【推文链接内容】${twitterInfo.link_content.content}`);
          contentParts.push(`【链接来源】${twitterInfo.link_content.url}`);
        }
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

【代币信息】
- 代币符号: ${tokenData.symbol || 'N/A'}
- 代币名称: ${tokenName || '(未提供)'}
- 代币描述: ${description || '(无)'}

${contentStr}

【重要说明】
- "【推文】"是推文的实际内容
- "【推特账号】"是代币关联的推特账号信息（简介、粉丝数、认证状态等）
- "【推文链接内容】"是推文中链接指向的网页内容，已自动获取并提取正文
- "【网页内容】"是代币网站页面的正文内容（仅在无Twitter信息时使用）
- "【介绍英文/中文】"是代币的介绍文字
- 如果只有推特账号信息而无推文，说明叙事线索主要在账号背景中
- 如果只有【网页内容】而无推文，说明叙事线索主要在网页内容中
- **代币名称匹配规则**：判断推文是否提及代币时，应忽略大小写、连字符、空格等差异
  - 例如：代币"AIFREE"应匹配推文中的"AI-free"、"ai free"、"AiFree"等变体
  - 匹配逻辑：去掉连字符和空格后，进行大小写不敏感的字符串比较

【核心原则】
评估BSC链meme代币的叙事质量。注意：
- Meme币无实用价值，通过"借用"知名事物/概念进行传播
- **禁止以"缺乏代币用途/价值主张说明"为由返回low**（meme币不需要用途说明）
- 评估叙事本身的质量，而非验证真假
- 情感共鸣、文化认同、梗文化都是meme币的核心叙事背景
- **大IP关联标准**：世界级大IP（特朗普/马斯克/CZ等）需要区分两种情况
  1. **官方背书代币**：需要本人提及、官方发布、权威媒体报道等强证据
     - 如果只是同名或简单提及（如"它叫特朗普"）→ 蹭热度，直接low
  2. **基于大IP相关事件的代币**：只需要有人声称/报道了这个事件即可
     - 例如：作家推文说"获得Elon许可出版这本书" → 这是真实事件叙事，不需要Elon认可
- **加密相关账号识别**：
  - **@cz_binance** = CZ（币安创始人），世界级加密人物
  - **Trust Wallet** = 币安旗下钱包，平台级影响力
  - 如果推文涉及这些，应该加分
- **代币名称匹配即视为有效关联**：内容中提到代币同名人物/事物即视为有实质
  - 例如：内容提到"MuleRun（骡子快跑）"，代币叫"骡子" → 有效关联
  - meme币不需要"官方代币"等表述，名称匹配即可

【评估步骤】

第一步：判断推文时间（最高优先级）
- **前提：必须明确知道推文发布时间（createdAt字段有值）**
- **如果推文发布时间超过2周（14天）**：直接返回 low
- 原因：老推文通常已被用于发过多个代币，叙事价值已耗尽
- **当前日期：2026年3月22日**（用于判断推文时间是否过久）
- **注意**：如果createdAt为空/null，跳过时间判断

第二步：判断推文语言
- **如果有推文且不是中文/英文**：直接返回 low
- 原因：非中英文推文会极大限制主要用户群体的传播
- **注意**：如果推文内容显示为"True"/空/无法获取实际文本，返回 unrated

第三步：判断可理解性/关联度
- **3.1 完全无信息→unrated**
  - 无推文 + intro只是名字/简单描述 + 无website
  - 例如：intro只是"Tom the lizard"、"1%"等
  - 无法评估叙事质量

- **3.2 纯链接推文**
  - 推文仅为链接（如只有"https://t.co/xxx"）→ 判断链接内容
  - 如果有【推文链接内容】或【网页内容】，继续判断
  - 如果无链接内容，intro也无意义 → unrated

- **3.3 主体信息在外部平台→unrated**
  - website是抖音视频、YouTube、X社区链接等
  - 示例：website是https://x.com/i/communities/xxx
  - 主体信息无法获取

- **3.4 借用概念/名称→评估概念知名度**
  - **世界级知名概念**（Tesla、ChatGPT、iPhone、抖音、比特币等）→ 可评分
  - **普通/小众概念**（某个开源工具、普通产品）→ 通常low
  - **无法体现知名度**→ unrated
  - **示例**：
    - "ChatGPT，OpenAI的AI助手"→ 世界级知名 → 可评分
    - "OpenShell，一个开源运行时工具"→ 小众概念 → low
  - **关键**：不要因为"提到"了概念就认为有效，关键在于概念的知名度

- **3.5 无价值内容→low**
  - 无推文 + intro为通用描述/无意义 + 无有效website
  - 通用描述示例：Infinite Runner、This is Elon、只有单词

第四步：检测"低质量叙事"（以下情况直接返回low）
1. **纯谐音梗**：只有谐音关联（如"生菜=生财"、"Duck you=鸭你一拳"），无实质内容
2. **热搜搬运**：纯报道热点事件（如"XX上热搜"），没有具体内容/事件
3. **泛泛情感概念**：只是借用常见词/抽象概念（"遗憾"、"佛系"等），没有具体故事/文化符号
4. **伪关联**：代币名称只在内容中顺便提及，不是核心主题（但结尾口号式提及不算伪关联）
5. **大IP蹭热度**：代币名称是世界级大IP，但缺乏强关联证据（本人提及、官方发布）
6. **平台产品更新蹭热度**：内容只是某个平台上线新功能，无明确"官方代币"表述
   - 一般/中小型平台的功能更新 → 通常low（0-8分）
   - "一个平台增加一个功能"是产品迭代，不是重大事件

第五步：如果通过以上检查，按以下标准评分

【评分维度】（总分100）

1.叙事背景(50分):按影响力量级评分（加密相关有优势，情感叙事有溢价）

  * **世界级公司事件分级**：
    - **第一梯队公司**（Meta/Google/Apple/Tesla/微软/亚马逊）：
      - 品牌战略级事件：35-50分
      - 革命性产品发布（iPhone/ChatGPT级别）：30-45分
      - 重大产品更新：20-35分
    - **第二梯队公司**（阿里巴巴/腾讯/字节跳动/AWS等）：
      - 品牌战略级事件：20-35分
      - 重大产品发布：15-30分
      - 组织调整/部门设立：5-15分
    - **其他知名公司**：组织调整 → 0-8分

  * **AI相关事件特殊处理**（2025-2026年AI已常态化）：
    - **革命性AI突破**（ChatGPT级别）：30-45分（需"首个/首创/突破"）
    - **普通AI产品发布**：5-15分
    - **成立AI部门**：0-10分（已是常态）

  * **影响力分级**：
    - 币安/官方权威/CZ相关：35-50分
    - 世界级/加密重大事件（顶级名人、国际媒体）：30-44分
    - 平台级影响力（加密相关）：25-34分
    - 平台级影响力（一般）：20-29分
    - **社区级情感叙事**（强情感共鸣+文化符号）：20-34分
      - 示例：伞（避雨情感+社区符号）、唐·毒蛇（文化梗）
      - 注意：常见抽象词不算（如"遗憾"只是词）
    - 社区级影响力（加密相关）：10-24分
    - 社区级影响力（一般）：5-19分
    - **媒体命名权威性**：
      - 顶级平台官方命名（抖音/微博官方）：25-35分
      - 普通媒体用语（量子位/36氪等）：0-10分
    - **限定范围影响力**：0-8分（如"深圳商场里的广告牌"）
    - 无明确影响力：0-4分

  * 注意：同一层级中，加密相关事件比一般事件高约5分

2.传播力(50分):meme潜力+社交属性+情感共鸣+FOMO+内容丰富度
  * **情感溢价**：若叙事具备强情感共鸣，在原分数基础上+5分
  * **限定范围降权**：如果内容明确限定地点（如"深圳商场"），传播力减半
  * **AI相关事件降权**：常规AI产品发布/部门设立，传播力减半
  * 具备病毒传播属性+内容丰富：40-50分
  * 有较强传播性+内容较丰富：30-39分
  * 有一定传播性：15-29分
  * 传播力弱：0-14分

【评级标准】
- unrated: 内容无法理解代币性质
- low: 触发任何低质量叙事模式，或 非中英文推文，或 总分<50
- mid: 叙事背景≥20 且 总分≥50
- high: 叙事背景≥35 且 总分≥75

【评分示例】

示例1(币安官方-high):
介绍:币安演示狗币MOONDOGECOIN
币安官方+强传播力→{credibility:35,virality:38,total:73,category:"high"}

示例2(纯谐音梗-low):
代币:生菜
内容:支付宝热搜"生菜=生财"，顶级谐音梗
纯谐音梗→{category:"low",reason:"纯谐音梗，无实质内容"}

示例3(热搜搬运-low):
代币:火鸡面
内容:81岁爷爷误食火鸡面被辣到，微博热搜事件
纯热点搬运→{category:"low",reason:"纯热搜事件搬运，无具体内容"}

示例4(伪关联-low):
代币:宝可梦
内容:个人创业故事，仅在开头提到"8岁时在宝可梦热潮期间卖青蛙"
顺便提及→{category:"low",reason:"代币名称只在背景中顺便提及"}

示例5(CZ相关-high):
代币:MWM
内容:CZ的书籍《Money Without Masters》泄露草稿
CZ相关(加密重大事件)+强传播力→{credibility:35,virality:40,total:75,category:"high"}

示例6(纯链接+无信息-unrated):
代币:1%
内容:【推文】https://t.co/xxx 【介绍英文】1%
推文仅为链接，intro只是名字，无其他信息→{category:"unrated",reason:"无法理解代币性质"}

示例7(平台级热点-mid):
代币:大狗大狗
内容:抖音爆火的"大狗"声音，已有上千万话题热度
平台级热点(抖音千万话题)→{credibility:22,virality:45,total:67,category:"mid"}

示例8(社区级加密-mid):
代币:BONKRot
内容:基于Solana链知名代币$bonk的嘲讽版本
社区级影响力(加密社区)→{credibility:12,virality:42,total:54,category:"mid"}

示例9(币安平台级-high):
代币:天使—COCO
内容:币安Openclaw聊群的群主 天使 COCO在广场发了贴
平台级影响力(币安广场)→{credibility:28,virality:47,total:75,category:"high"}

示例10(社区级一般-mid):
代币:30000
内容:"人生不过30000天"的哲学概念
社区级影响力(哲学概念)→{credibility:8,virality:45,total:53,category:"mid"}

示例11(泰语推文-low):
代币:卡穆
内容:สวัสดีวันเสาร์ #hippo https://t.co/xxx
泰语推文→{category:"low",reason:"推文为泰语，非中英文"}

示例12(无价值内容-low):
代币:π
介绍:Infinite Runner, website:推特搜索链接
无有意义内容→{category:"low",reason:"无推文，介绍为通用描述，无有效信息"}

示例13(抖音链接-unrated):
代币:猿神
介绍:信我我后期很牛逼, website:抖音链接
主体信息在外部平台→{category:"unrated",reason:"主体信息在抖音链接中"}

示例14(老推文-low):
代币:躺赢
内容:CZ的推文（2025年5月）
推文发布超过2周→{category:"low",reason:"推文发布时间过久"}

示例15(普通媒体用语-low):
代币:鹅虾
内容:量子位将腾讯openclaw称为"鹅虾"
普通媒体用语(无权威性)→{category:"low",reason:"量子位仅为科技媒体，非官方命名"}

示例16(平台官方命名-high):
代币:某代币
内容:抖音官方将此称为年度热词
平台官方命名(有权威性)→{credibility:30,virality:42,total:72,category:"high"}

示例17(限定范围影响力-low):
代币:宽宽
内容:深圳商场里的公益广告"愿手术台上没有下一个宽宽"
商场广告牌(极低影响力)→{credibility:5,virality:12,total:17,category:"low"}

示例18(情感叙事-high):
代币:伞
内容:伞字梗，避雨情感共鸣，加密社区文化符号
社区级情感叙事(有文化符号+情感共鸣)→{credibility:28,virality:47,total:75,category:"high"}

【输出格式】
正常评分输出（包含scores）:
{"reasoning":"2-3句中文说明理由","scores":{"credibility":0-50,"virality":0-50},"total_score":0-100,"category":"high/mid/low"}

无法理解输出（不包含scores）:
{"category":"unrated","reasoning":"说明无法理解代币性质的原因"}
`;
  }
}
