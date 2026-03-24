/**
 * 标准 Prompt - 适用于有推文的代币
 */

import { CORE_FRAMEWORK } from './core.mjs';
import { generateAccountBackgroundsPrompt } from './account-backgrounds.mjs';

export const STANDARD_PROMPT = (tokenData, twitterInfo, extractedInfo) => {
  // 计算推文时间距离
  let tweetDaysAgo = '';
  let quotedTweetDaysAgo = '';
  let isCZReplyExpectation = false;

  if (twitterInfo && twitterInfo.created_at) {
    const tweetDate = new Date(twitterInfo.created_at);
    const daysDiff = Math.floor((Date.now() - tweetDate.getTime()) / (1000 * 60 * 60 * 24));
    tweetDaysAgo = `（距今${daysDiff}天）`;

    // 检测是否是CZ回复预期
    const tweetText = (twitterInfo.text || '').toLowerCase();
    if (tweetText.includes('cz') && (tweetText.includes('回应') || tweetText.includes('回复') || tweetText.includes('react') || tweetText.includes('respond'))) {
      isCZReplyExpectation = true;
    }
  }

  if (twitterInfo?.quoted_status?.created_at) {
    const quotedDate = new Date(twitterInfo.quoted_status.created_at);
    const daysDiff = Math.floor((Date.now() - quotedDate.getTime()) / (1000 * 60 * 60 * 24));
    quotedTweetDaysAgo = `（距今${daysDiff}天）`;
  }

  return `
你是代币叙事分析专家，负责评估meme代币的叙事质量。

【代币信息】
- 代币名称：${tokenData.symbol}
- 代币地址：${tokenData.address}
- 介绍（英文）：${extractedInfo.intro_en || '无'}
- 介绍（中文）：${extractedInfo.intro_cn || '无'}
- 网站：${extractedInfo.website || '无'}
- Twitter链接：${extractedInfo.twitter_url || '无'}

${generateAccountBackgroundsPrompt(twitterInfo)}

【推文信息】
${twitterInfo ? `
- 推文作者：${twitterInfo.author_name || '未知'} (@${twitterInfo.author_screen_name || '未知'})
- 作者粉丝数：${twitterInfo.author_followers_count || '未知'}
- 作者认证：${twitterInfo.author_verified ? '是' : '否'}
- 推文内容：${twitterInfo.text || '无'}
- 推文发布时间：${twitterInfo.formatted_created_at || twitterInfo.created_at || '未知'}${tweetDaysAgo}
- 推文点赞数：${twitterInfo.metrics?.favorite_count || 0}
- 推文转发数：${twitterInfo.metrics?.retweet_count || 0}
${isCZReplyExpectation ? `- **【重要】此推文明确询问CZ/何一的回应，属于"回复预期"溢价场景**` : ''}
${twitterInfo.media && twitterInfo.media.has_media ? `
- 【推文附带媒体】${twitterInfo.media.images?.length || 0}张图片${twitterInfo.media.videos?.length || 0}个视频
` : ''}
${twitterInfo.in_reply_to ? `
- 【这是回复推文】
  原始推文作者：${twitterInfo.in_reply_to.author_name || '未知'}
  原始推文内容：${twitterInfo.in_reply_to.text || '无'}
  原始推文发布时间：${twitterInfo.in_reply_to.formatted_created_at || twitterInfo.in_reply_to.created_at || '未知'}
` : ''}
${twitterInfo.mentions_user ? `
- 【提及关系】推文@了用户：@${twitterInfo.mentions_user.screen_name}
` : ''}
${twitterInfo.quoted_status ? `
- 【这是引用推文】
  被引用推文作者：${twitterInfo.quoted_status.author_screen_name || twitterInfo.quoted_status.author_name || '未知'} (粉丝数: ${twitterInfo.quoted_status.author_followers_count || '未知'})
  被引用推文内容：${twitterInfo.quoted_status.text || '无'}
  被引用推文发布时间：${twitterInfo.quoted_status.formatted_created_at || twitterInfo.quoted_status.created_at || '未知'}${quotedTweetDaysAgo}
  被引用推文点赞数：${twitterInfo.quoted_status.metrics?.favorite_count || 0}
  被引用推文转发数：${twitterInfo.quoted_status.metrics?.retweet_count || 0}
` : ''}
${twitterInfo.article ? `
- 【Twitter Article】**（注意：Article即为此推文的完整内容，非转发）**
  标题：${twitterInfo.article.title || '无'}
  摘要：${twitterInfo.article.preview_text || '无'}
  ${twitterInfo.article.plain_text ? `完整内容：${twitterInfo.article.plain_text.substring(0, 3000)}${twitterInfo.article.plain_text.length > 3000 ? '...' : ''}` : ''}
  ${twitterInfo.article.cover_image_url ? `封面图：${twitterInfo.article.cover_image_url}` : ''}
` : ''}
` : '无推文信息'}

${twitterInfo?.link_content ? `
【推文链接内容】
链接：${twitterInfo.link_content.url || '未知'}
标题：${twitterInfo.link_content.title || '无'}
内容摘要：${twitterInfo.link_content.content?.substring(0, 500) || '无'}...
` : ''}

【分析原则】
- **代币名称匹配即视为有效关联**：内容中提到代币同名人物/事物即视为有实质
- **meme币不需要"官方代币"等表述**，名称匹配即可
- **官方权威 ≠ 实际热度**：评估时应关注"大家是否在讨论"，而非"谁发布的"

【重要概念识别】
- **世界级人物**：Trump（特朗普）、Musk（马斯克）、Elon、拜登
- **政府机构/世界级组织**：
  - White House（白宫）= 美国总统府，世界最高权力机构之一
  - 其他政府机构：国会、议会、央行等
  - 国际组织：UN（联合国）、NATO（北约）等
- **加密平台**：Binance、Coinbase、Trust Wallet（币安旗下钱包）
- **主流币**：Bitcoin、Ethereum、BNB、DOGE、SHIB
- **加密相关账号**：
  - @Four_FORM_ = FourMeme平台官方账号（BSC链），平台官方推文应至少评mid
  - @cz_binance = CZ（币安创始人），@heyibinance = 何一（币安联合创始人）
  - **提及CZ的关系强度判断**：
    - "我的导师@cz_binance"、"CZ支持" → 直接导师/被指导关系，**强关联**（至少mid）
    - "CZ回复了"、"CZ提到" → 互动关系，中等关联（可能mid）
    - 仅在推文中@cz_binance（无上下文） → 弱关联（不一定加分）
- **重要**：代币名/账号名/intro包含这些IP名称时需特别关注

【评估步骤】

**第一步：语言判断**
- 非中英文推文需满足影响力条件（粉丝>=1万 或认证 或高互动点赞>=1000/转发>=500）
- 满足则继续，否则返回low
- 推文为"True"/空/无法获取→unrated

**第二步：核心信息缺失判断（最高优先级）**
同时满足以下条件→unrated：
1. 无推文 2. 无website 3. 无Twitter账号 4. intro仅简单描述（名字/单词/短语）

**第三步：推文类型判断（重要）**

代币推文分为两类，需优先判断：

**类型A：找角度**
- **根本性特征**：推文本身就是在描述一个角度，即"因为发生了某事，所以这个概念可以作为meme币"
- **判断标准（根本性）**：
  1. **推文结构是"事件→概念"**：先描述事件/现象，然后提出概念（通常是#标签或代币名）
  2. **推文暗示因果关系**：因为事件发生，所以概念有价值/有meme潜力
  3. **推文是解释性的**：在说明"为什么这个概念有价值"，而非提供原创内容
- **评估要求（重要）**：
  - **不要求发布者影响力**：类型A推文的发布者就是发币人，粉丝数少是正常的，**绝不能因为粉丝少而降低评分**
  - **不要求推文互动量**：类型A推文只是指出角度，不需要高互动，**绝不能因为互动少而降低评分**
  - **默认叙事为真**（因为无法验证，发现虚假由黑名单处理）
- **常见形式**：
  - "某平台上线了XX功能 → #概念"
  - "某名人说了XX → $代币"
  - "某事件正在发生 → 人们开始谈论#概念"
  - 推文可能简短（一两句话），也可能详细解释
- **重点评估：事件本身的热度 + 角度的创意/合理性**
- **事件热度分级**：
  - **世界级事件**（政府meme、顶级平台重大更新）→ 30-45分
  - **平台级事件**（微博/抖音等平台上线新功能）→ 20-35分
    - **首个/首创类创新**（如"首个AI才能发帖的超话"）→ 至少30分
    - 微博/抖音等主流平台常规功能 → 20-25分
    - 一般/中小型平台功能更新 → 15-20分
  - **社区级事件**（圈内讨论热点）→ 5-15分
  - **无明确事件**（个人想法、抽象概念）→ 0-5分
- **角度合理性加分**：
  - 角度与事件强相关（如AI事件→硅基茶水间）→ +5-15分
  - 角度有创意/幽默感 → +5-15分
  - 角度牵强/无关联 → 0分
- **评分指导**：
  - 事件热度高 + 角度合理 → mid（50-75分）
  - 事件热度中等 + 角度合理 → mid（40-60分）
  - 事件热度低或角度牵强 → low（0-30分）

**类型B：由来**
- 特征：有影响力账号的内容本身就是meme币的来源/背景
- 判断标准（满足至少2个）：
  1. 发布者是知名人物（Trump、Musk、CZ等）或有影响力账号（粉丝>10000）
  2. 推文是原创内容/Article/图片/视频（**Article是Twitter长文章功能，本身即为完整内容**）
  3. 推文本身就是meme内容，而非解读其他事件（**有Article时直接满足此条件**）
  4. 代币名直接来自推文内容（如"基于这条推文发币"）
- **评估原则**：
  - **直接关联发布者影响力**：发布者影响力 = 叙事背景评分
  - 知名人物直接发帖 → mid或high
  - 有影响力账号（高粉丝/认证+高互动）→ 可评mid
  - 普通用户发帖 → low（除非内容极具传播性）

**第四步：可理解性/关联度判断**

**核心概念识别（重要）**：
- **判断标准**：代币名称在推文中是否作为核心概念/隐喻贯穿全文
- **强关联**：代币名称在推文中多次出现，有完整的故事线
  - 示例："青蛙"在推文中作为核心隐喻（童年卖青蛙→创业→Trust Wallet业务中的"selling frogs"）
  - 这种情况下，即使没有明确的meme内容，也建立了有效关联
  - **叙事背景评分：15-30分**（有故事但可能缺乏传播性）
- **弱关联**：代币名称只在推文中顺便提及一次
  - 示例：推文讲述个人故事，仅在开头提到"8岁时在宝可梦热潮期间卖青蛙"
  - 这种情况视为伪关联或弱关联
- **CZ导师关系（强关联）**：
  - 推文中提到"我的导师@cz_binance"、"CZ支持我"等表述
  - 表示发布者与CZ有直接关系（导师/被指导/支持）
  - **这是非常强的背书关系**，即使推文作者本人不是世界级人物
  - **叙事背景评分：30-45分**（CZ直接关联 + Trust Wallet CEO身份）

**推文有配图/视频（重要）**：
- **有图片/视频** → 假设图片与代币有关，**代币名即为图片内容的描述**
- **不需要**推文文字中明确提及代币名
- **重点评估**：推文的互动量 + 图片的传播潜力（而不是文字内容）

**推文@了用户**：@知名/加密用户→建立背书关联，可评low或mid（根据影响力判断）；发布者有影响力→可评mid

**政府机构/世界级组织meme（适用于类型A-找角度）**：
- **情况**：推文内容提到政府机构或世界级组织发布meme内容（如"White House is posting video memes"）
- **叙事背景评分：30-45分**（世界级影响力）
- **传播力评分：30-45分**（官方机构发布meme具有病毒传播潜力）
- **即使发布者影响力低，也应至少评mid或mid-high**
- 原因：政府/世界级组织的meme行为本身就是重大社会现象，具有极高的传播和讨论价值

**知名品牌背书（适用于类型A-找角度）**：
- **情况1**：推文内容明确提到是"XX市场营销/官方发布"的内容（如"aster市场营销发的logo"）
- **情况2**：推文提到币安旗下平台/知名项目（Aster、Trust Wallet、Binance等）
- **情况3**：代币名称与知名品牌匹配（如ASTERCLAN与Aster）
- **满足以上任一情况 + 有具体命名/Logo/配图 → 至少评mid**（25-40分）
- **重要：品牌背书的价值不取决于发布者粉丝数或互动量，即使互动低也应评mid**
- 原因：知名品牌本身具有影响力和信任背书

**信息在外部平台**（Telegram/Discord/小红书等）→unrated

**第五步：类型B-由来推文的影响力评估（仅适用于类型B）**
- **知名人物直接发帖**：Trump、Musk、CZ等世界级人物 → mid或high
- **认证用户+高互动**：点赞>1000或转发>500 → 可评mid
- **普通用户**：影响力低 → 通常low（除非内容极具传播性）

**第六步：BSC链CZ/何一回复预期溢价**
同时满足才加分：
1. **有近期事件**（2周内）：新闻/币安动态/加密事件/热点
2. **与CZ/何一强关联**：直接提及/涉及币安创始人/引用@cz_binance或@heyibinance
- 强关联+近期热点→+20-35分
- 中等关联→+5-15分
- 无事件或无强关联→不加分

**第七步：低质量叙事检测（直接返回low）**
1. **纯谐音梗**：只有谐音关联（如"生菜=生财"、"Duck you=鸭你一拳"），无实质内容
2. **热搜搬运**：纯报道热点事件（如"XX上热搜"），没有具体内容/事件
3. **泛泛情感概念**：只是借用常见词/抽象概念（"遗憾"、"佛系"等），没有具体故事/文化符号
4. **伪关联**：代币名称只在内容中顺便提及，不是核心主题（但结尾口号式提及不算伪关联）
5. **大IP蹭热度**：代币名称是世界级大IP，但缺乏强关联证据（本人提及、官方发布）
6. **平台产品更新蹭热度**：仅提及平台有新功能/更新，但没有建立任何有创意的角度或概念关联
   - 示例：只说"某某平台上线了AI功能"，没有进一步的meme化解读或创意命名
   - 如果有明确的创意角度（如"硅基茶水间"这种有概念的名字），按类型A-找角度评估
   - 一般/中小型平台的功能更新（无创意角度）→ low（0-8分）
7. **功能性符号/标志**：借用功能性、严肃性符号或标志
   - **功能性符号**：紧急出口标志（皮特托先生）、交通标志、警告标志等
     - 虽然有全球认知度，但缺乏娱乐性、情感共鸣或传播动力
     - 给人的感觉是严肃的、功能性的，不是好玩的、有趣的
     - 缺乏meme属性：不好笑、不荒诞、没有社区自发创作空间
   - **评估原则**：功能性符号通常 **0-15分**（传播力极弱）
8. **无影响力的新说法/梗**：创造或使用一个新的概念/梗，但发表者无影响力且未形成社交热度
   - **发表者影响力要求**：发表者需要具备一定的影响力
     - 粉丝数 < 1000：通常视为无影响力
     - 粉丝数 > 10000 或认证用户：有一定影响力
   - **社交热度证据**：需要有以下之一
     - 明确提到已经"火了"、"爆火"、"热搜"
     - 有转发、评论数据佐证（高互动量）

【评分示例】

**类型A示例（找角度）：**

示例1(找角度-政府meme-mid):
代币:Memehouse，内容:"Big front-run here. The White House is posting multiple video memes about war."
→评mid，理由：类型A-找角度，白宫meme是世界级事件(30-45分)，发币人影响力低是正常的

示例2(找角度-平台级事件-mid):
代币:硅基茶水间，内容:"微博官方上线了首个AI才能拥有完整社交权限，人类仅可围观互动 #硅基茶水间"
→评mid，**直接评分**：可信度30分+传播力25分=55分
**评分依据**：推文包含"首个"关键词 → 直接给可信度30分，不考虑其他因素
**禁止在理由中提到**：粉丝数、点赞数、转发数、影响力
**理由模板**：类型A-找角度，微博首个AI功能是平台级首创(30分)，硅基茶水间角度相关且有创意(25分)

示例3(找角度-品牌背书-mid):
代币:ASTERCLAN，内容:"aster市场营销发的忍者的logo，有名字叫'asterclan'"
→评mid，理由：类型A-找角度，Aster是币安旗下平台，品牌背书有价值

**类型B示例（由来）：**

示例3(币安官方-high):
介绍:币安演示狗币MOONDOGECOIN
→评high，理由：类型B-由来，币安官方+强传播力

**低质量示例：**

示例4(纯谐音梗-low):
代币:生菜，内容:支付宝热搜"生菜=生财"，顶级谐音梗
→评low，理由：纯谐音梗，无实质内容

示例5(伪关联-low):
代币:宝可梦，内容:个人创业故事，仅在开头提到"8岁时在宝可梦热潮期间卖青蛙"
→评low，理由：代币名称只在背景中顺便提及，不是核心主题

示例6(无信息-unrated):
代币:1%，内容:【推文】https://t.co/xxx，【介绍英文】1%
→评unrated，理由：无法理解代币性质

${CORE_FRAMEWORK}
`;
};
