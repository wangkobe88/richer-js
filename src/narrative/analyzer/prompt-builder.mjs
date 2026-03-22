/**
 * Prompt构建器
 * 评估BSC链meme代币叙事质量
 * V5.30 - 支持 Twitter Article 内容提取（标题和预览文本）
 */

export class PromptBuilder {

  static getPromptVersion() {
    return 'V5.30';
  }

  /**
   * 构建代币叙事分析Prompt（完整版）
   * @param {Object} tokenData - 代币数据（包含 symbol, address, raw_api_data）
   * @param {Object} twitterInfo - Twitter信息
   * @param {Object} websiteInfo - 网页内容信息（仅在无Twitter信息时使用）
   * @param {Object} extractedInfo - 提取的结构化信息（包含 intro_en, intro_cn, website, description）
   * @param {Object} backgroundInfo - 背景信息（微博等外部资源，作为补充）
   */
  static build(tokenData, twitterInfo = null, websiteInfo = null, extractedInfo = null, backgroundInfo = null) {
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
        // 推文格式 - 先显示作者信息，再显示推文内容
        const authorScreenName = twitterInfo.author_screen_name || twitterInfo.author_name || '未知';
        const authorName = twitterInfo.author_name || '';
        contentParts.push(`【推文作者】@${authorScreenName}${authorName ? ` (${authorName})` : ''}`);
        contentParts.push(`【推文】${twitterInfo.text}`);

        // 如果有 Article 内容，添加到内容中
        if (twitterInfo.article) {
          if (twitterInfo.article.title) {
            contentParts.push(`【Article标题】${twitterInfo.article.title}`);
          }
          if (twitterInfo.article.preview_text) {
            contentParts.push(`【Article内容】${twitterInfo.article.preview_text}`);
          }
        }

        // 如果是回复推文，添加原始推文
        if (twitterInfo.in_reply_to) {
          const replyToName = twitterInfo.in_reply_to.author_screen_name || '未知';
          const replyToDisplayName = twitterInfo.in_reply_to.author_name || '';
          contentParts.push(`【回复的推文】@${replyToName}${replyToDisplayName ? ` (${replyToDisplayName})` : ''}: ${twitterInfo.in_reply_to.text}`);
          // 如果原始推文也有 Article
          if (twitterInfo.in_reply_to.article && twitterInfo.in_reply_to.article.title) {
            contentParts.push(`【回复的Article标题】${twitterInfo.in_reply_to.article.title}`);
            if (twitterInfo.in_reply_to.article.preview_text) {
              contentParts.push(`【回复的Article内容】${twitterInfo.in_reply_to.article.preview_text}`);
            }
          }
        }

        // 如果是转发推文，添加被转发的推文
        if (twitterInfo.retweet_of) {
          const retweetOfName = twitterInfo.retweet_of.author_screen_name || '未知';
          const retweetOfDisplayName = twitterInfo.retweet_of.author_name || '';
          contentParts.push(`【转发的推文】@${retweetOfName}${retweetOfDisplayName ? ` (${retweetOfDisplayName})` : ''}: ${twitterInfo.retweet_of.text}`);
        }

        // 如果有推文链接内容，添加到内容中
        if (twitterInfo.link_content && twitterInfo.link_content.content) {
          contentParts.push(`【推文链接内容】${twitterInfo.link_content.content}`);
          contentParts.push(`【链接来源】${twitterInfo.link_content.url}`);
        }
      }

      // 如果有网站内容，作为补充信息添加
      if (websiteInfo && websiteInfo.content) {
        contentParts.push(`【网站补充内容】${websiteInfo.content}`);
        contentParts.push(`【网站来源】${websiteInfo.url}`);
      }
    } else if (websiteInfo && websiteInfo.content) {
      // 没有Twitter信息时，使用网页内容
      contentParts.push(`【网页内容】${websiteInfo.content}`);
      contentParts.push(`【网页来源】${websiteInfo.url}`);
    }

    if (introEn) contentParts.push(`【介绍英文】${introEn}`);
    if (introCn) contentParts.push(`【介绍中文】${introCn}`);
    if (website) contentParts.push(`【网站】${website}`);

    // 添加背景信息（微博等）- 作为补充
    if (backgroundInfo && backgroundInfo.text) {
      contentParts.push(`【背景信息来源】${backgroundInfo.source === 'weibo' ? '微博' : '其他平台'}`);
      contentParts.push(`【背景信息内容】${backgroundInfo.text}`);
      if (backgroundInfo.author_name) {
        contentParts.push(`【背景信息作者】${backgroundInfo.author_name} (粉丝: ${(backgroundInfo.author_followers_count || 0).toLocaleString()})`);
      }
      if (backgroundInfo.created_at) {
        contentParts.push(`【背景信息发布时间】${backgroundInfo.created_at}`);
      }
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
- "【推文作者】"是推文发布者的账号信息（@username 和姓名），对于判断影响力非常重要
- "【Article标题】"和"【Article内容】"是 Twitter Article 的标题和预览文本
  - Article 是 X 平台的长文章功能，包含更完整的内容
  - 预览文本虽然是截断的，但通常包含文章的核心观点和关键信息
  - 对于叙事分析来说，Article 内容是重要的信息来源
- "【回复的推文】"是当前推文回复的原始推文内容，提供上下文信息
  - **对于回复推文，必须同时查看回复内容和原始推文**
  - 原始推文往往包含更重要的叙事线索（如代币名称、关联概念等）
  - 判断代币关联时，优先检查原始推文中是否提及代币相关内容
- "【转发的推文】"是当前推文转发的原始推文内容，提供上下文信息
- "【推特账号】"是代币关联的推特账号信息（简介、粉丝数、认证状态等）
- "【推文链接内容】"是推文中链接指向的网页内容，已自动获取并提取正文
- "【网页内容】"是代币网站页面的正文内容（在无Twitter信息时使用）
- "【网站补充内容】"是代币网站页面的正文内容（在有Twitter信息时作为补充）
- "【介绍英文/中文】"是代币的介绍文字
- "【背景信息】"是来自微博等其他平台的补充信息，作为叙事背景参考
- 如果只有推特账号信息而无推文，说明叙事线索主要在账号背景中
- 如果既有推文又有网站内容，需要综合两者信息进行评估
- 如果只有【网页内容】而无推文，说明叙事线索主要在网页内容中
- **代币名称匹配规则**：判断推文是否提及代币时，应忽略大小写、连字符、空格等差异
  - 例如：代币"AIFREE"应匹配推文中的"AI-free"、"ai free"、"AiFree"等变体
  - 匹配逻辑：去掉连字符和空格后，进行大小写不敏感的字符串比较
  - **谐音/相似发音也应视为有效关联**：如"Goo"可匹配"蛊"，"Duck"可匹配"达克"等

【核心原则】
评估BSC链meme代币的叙事质量。注意：
- Meme币无实用价值，通过"借用"知名事物/概念进行传播
- **禁止以"缺乏代币用途/价值主张说明"为由返回low**（meme币不需要用途说明）
- 评估叙事本身的质量，而非验证真假
- 情感共鸣、文化认同、梗文化都是meme币的核心叙事背景
- **认知度 ≠ 吸引力**：
  - "认知度"指人们是否知道这个东西（如紧急出口标志全球都知道）
  - "吸引力"指人们是否愿意为之买单、传播、创作（meme币的核心）
  - 功能性符号（如皮特托先生）虽有认知度，但缺乏吸引力：
    * 不搞笑、不荒诞、没有情感共鸣
    * 给人严肃、功能性的感觉，不是好玩的
    * 缺乏社区自发创作和传播的动力
- **叙事吸引力判断标准**：
  1. **有趣/好笑/荒诞**：是否让人会心一笑或觉得荒诞好笑？
  2. **情感共鸣**：是否引发怀念、认同、讽刺等情感？
  3. **传播动力**：用户是否愿意主动分享、创作、讨论？
  4. **社区创作空间**：是否有可被二次创作的梗属性？
  5. **正面联想**：是否给人正面的、积极的联想？
- **功能性符号特征**：
  - 设计目的是功能性（指示、警告、说明）
  - 给人严肃、正式、危险等负面/中性感觉
  - 缺乏娱乐性、趣味性、情感性
  - 即使"全球知名"，也不适合做meme币
- **大IP关联标准**：世界级大IP（特朗普/马斯克/CZ等）需要区分两种情况
  1. **官方背书代币**：需要本人提及、官方发布、权威媒体报道等强证据
     - 如果只是同名或简单提及（如"它叫特朗普"）→ 蹭热度，直接low
  2. **基于大IP相关事件的代币**：只需要有人声称/报道了这个事件即可
     - 例如：作家推文说"获得Elon许可出版这本书" → 这是真实事件叙事，不需要Elon认可
- **加密相关账号识别**：
  - **@cz_binance** = CZ（币安创始人），世界级加密人物
  - **@heyibinance** = 何一（币安联合创始人），世界级加密人物
  - **Trust Wallet** = 币安旗下钱包，平台级影响力
  - 如果推文涉及这些，应该加分
  - **特别注意**：币安CZ/何一等世界级加密人物的账号，推文内容**直接提及代币名称**，即使内容简单，也应给予中质量评级（至少mid）
- **代币名称匹配即视为有效关联**：内容中提到代币同名人物/事物即视为有实质
  - 例如：内容提到"MuleRun（骡子快跑）"，代币叫"骡子" → 有效关联
  - meme币不需要"官方代币"等表述，名称匹配即可
- **官方权威 ≠ 实际热度**：
  - 媒体/平台的官方发布不代表有实际社交讨论度
  - 评估时应关注"大家是否在讨论"，而非"谁发布的"
  - 除非有明确的社交热度佐证（热搜、话题量、病毒传播），否则官方发布不应获得过高分数
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

**情况1：信息获取不全（技术限制）→ unrated**
- 推文纯链接但链接内容获取失败（网络错误、访问限制等）
- 网站无法访问或超时
- Twitter Article等需要JS渲染的内容无法获取
- 原因：技术限制导致无法获取完整信息，无法评估

**情况2：信息在外部平台 → unrated**
- website是抖音视频、B站、YouTube、快手等视频平台链接
- website是Telegram、Discord、小红书、Instagram等无法获取的平台
- website是X社区链接、Twitter Article等需要登录/JS渲染的平台
- 无推文 + intro只是名字 + website指向外部平台
- 示例：website是https://x.com/i/communities/xxx、抖音视频链接、B站视频
- 原因：主体信息在外部平台，无法获取
- 注意：微博链接现在可以获取内容，不再标记为 unrated

**情况3：信息完整但无有效关联 → low（不是unrated）**
- 获取了完整信息（推文、网页内容等），但与代币无明显关联
- 通用描述/无意义内容：intro只是"Infinite Runner"、"This is Elon"、只有单词
- 借用普通/小众概念但无知名度支撑
- 示例：
  - intro只是"Tom the lizard" + 无其他信息 → low（有信息但无价值）
  - "OpenShell，一个开源运行时工具" → 小众概念，无知名度 → low
  - 推文与代币名称无明显关联，intro也无意义 → low

**借用概念/名称的评估（如果信息完整）**：
- **世界级知名概念**（Tesla、ChatGPT、iPhone、抖音、比特币等）→ 可评分
- **普通/小众概念**（某个开源工具、普通产品）→ 通常low
- **无法体现知名度**→ low（不是unrated，因为信息已完整获取）

第四步：检测"低质量叙事"（以下情况直接返回low）
1. **纯谐音梗**：只有谐音关联（如"生菜=生财"、"Duck you=鸭你一拳"），无实质内容
2. **热搜搬运**：纯报道热点事件（如"XX上热搜"），没有具体内容/事件
3. **泛泛情感概念**：只是借用常见词/抽象概念（"遗憾"、"佛系"等），没有具体故事/文化符号
4. **伪关联**：代币名称只在内容中顺便提及，不是核心主题（但结尾口号式提及不算伪关联）
5. **大IP蹭热度**：代币名称是世界级大IP，但缺乏强关联证据（本人提及、官方发布）
6. **平台产品更新蹭热度**：内容只是某个平台上线新功能，无明确"官方代币"表述
   - 一般/中小型平台的功能更新 → 通常low（0-8分）
   - "一个平台增加一个功能"是产品迭代，不是重大事件
7. **功能性符号/标志**：借用功能性、严肃性符号或标志
   - **功能性符号**：紧急出口标志（皮特托先生）、交通标志、警告标志等
     - 虽然有全球认知度，但缺乏娱乐性、情感共鸣或传播动力
     - 给人的感觉是严肃的、功能性的，不是好玩的、有趣的
     - 缺乏meme属性：不好笑、不荒诞、没有社区自发创作空间
     - 即使有"网友二次创作"，也需要是主流社区广泛认可的梗才算
   - **负面联想符号**：与危险、警告、逃生等负面概念相关的符号
     - 紧急出口标志（逃生、危险）
     - 放射标志、有毒物质标志等
   - **评估原则**：功能性符号通常 **0-15分**（传播力极弱）
     - 即使有全球认知度，也不应给予高分
     - 示例：皮特托先生（紧急出口标志）→ low（功能性符号，缺乏meme属性）

第五步：如果通过以上检查，按以下标准评分

【评分维度】（总分100）

1.叙事背景(50分):按影响力量级评分（情感叙事有加成，加密相关有加成）

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
    - 币安/CZ/何一相关：35-50分
    - 世界级/加密重大事件（顶级名人、国际媒体）：30-44分
    - 平台级影响力（加密相关）：25-34分
    - 平台级影响力（一般）：20-29分
    - **社区级情感叙事**（强情感共鸣+文化符号）：**25-40分**
      - 示例：伞（避雨情感+社区符号）、唐·毒蛇（文化梗）、尼采主义海豚（哲学+趣味）
      - 注意：常见抽象词不算（如"遗憾"只是词）
      - 优质情感叙事（有独特文化符号、强共鸣）可达到35-40分
    - 社区级影响力（加密相关）：10-24分
    - 社区级影响力（一般）：5-19分
    - **媒体命名权威性**：
      - 顶级平台官方命名（抖音/微博官方）：**15-25分**
        - 注意：官方权威性不代表实际热度
        - 除非有明确的社交讨论热度佐证（如热搜、话题量），否则不应超过25分
      - 普通媒体用语（量子位/36氪等）：0-10分
    - **限定范围影响力**：0-8分（如"深圳商场里的广告牌"）
    - 无明确影响力：0-4分

  * 加分说明：加密相关、情感叙事可在原分数基础上+3-5分（不超过该层级上限）

2.传播力(50分):meme潜力+社交属性+情感共鸣+FOMO+内容丰富度
  * **情感溢价**：若叙事具备强情感共鸣，在原分数基础上+5分
  * **限定范围降权**：如果内容明确限定地点（如"深圳商场"），传播力减半
  * **AI相关事件降权**：常规AI产品发布/部门设立，传播力减半
  * **功能性符号降权**：功能性符号/标志（紧急出口标志、交通标志、警告标志等）传播力极弱
    - 功能性符号通常 **0-15分**
    - 原因：不搞笑、不荒诞、没有情感共鸣，缺乏传播动力
    - 即使有全球认知度，也不代表有传播价值
    - 示例：皮特托先生（紧急出口标志）→ 传播力8分
  * 具备病毒传播属性+内容丰富：40-50分
  * 有较强传播性+内容较丰富：30-39分
  * 有一定传播性：15-29分
  * 传播力弱：0-14分

【评级标准】
- unrated: 信息获取不全或信息在外部平台，无法评估
  - 技术限制导致无法获取完整信息（网站无法访问、链接内容获取失败等）
  - 主体信息在外部平台（B站、抖音、YouTube、快手等）无法获取
  - 完全无信息（intro只是名字、无推文、无website）
  - 注意：微博现在可以获取，不再标记为 unrated
- low: 信息完整但无有效关联，或触发低质量叙事模式，或 非中英文推文，或 总分<50
  - 获取了完整信息但与代币无明显关联
  - 通用描述/无意义内容
  - 触发纯谐音梗、热搜搬运、伪关联、功能性符号等低质量模式
  - 功能性符号（紧急出口标志、交通标志、警告标志等）即使有认知度也评为 low
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

示例14(功能性符号-low):
代币:皮特托先生
介绍:皮特托先生（紧急出口标志绿色小人）
功能性符号，虽有全球认知度但缺乏meme属性→{credibility:10,virality:8,total:18,category:"low",reason:"功能性符号（紧急出口标志），缺乏娱乐性、情感共鸣和传播动力，不适合做meme币"}
分析：虽然是全球通用的安全标志，但属于严肃的功能性符号，不搞笑、不荒诞、没有情感共鸣，缺乏社区自发创作和传播的动力

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

示例19(社区情感叙事-mid):
代币:尼采主义海豚
内容:Jeremy这个尼采主义海豚逆流而上的故事
社区级情感叙事(有趣+有文化符号但非加密社区)→{credibility:27,virality:38,total:65,category:"mid"}

示例20(何一相关-mid):
代币:币安VIP
内容:何一(@heyibinance)发推文直接提及"币安VIP"
币安何一直接提及代币名(世界级加密人物)→{credibility:35,virality:30,total:65,category:"mid"}

示例21(官方发布但热度低-mid):
代币:中国神话
内容:央视推出AI微短剧"中国神话"
官方发布但实际社交讨论度低(无明确热度佐证)→{credibility:18,virality:32,total:50,category:"mid"}

示例22(回复推文-原始推文更重要-mid):
代币:蛊
回复推文内容:"From memes → to real agents 👀 BNB Chain is evolving fast"
原始推文内容:"Special thanks to Goo's early co-contributors"
回复推文原始推文提到"Goo"(与代币名"蛊"谐音)→{credibility:22,virality:35,total:57,category:"mid"}

【输出格式】
正常评分输出（包含scores）:
{"reasoning":"2-3句中文说明理由","scores":{"credibility":0-50,"virality":0-50},"total_score":0-100,"category":"high/mid/low"}

无法理解输出（不包含scores）:
{"category":"unrated","reasoning":"说明无法理解代币性质的原因"}
`;
  }
}
