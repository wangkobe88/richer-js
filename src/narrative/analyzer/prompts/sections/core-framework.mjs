/**
 * 核心框架 - 代币信息、分析原则、评估步骤
 */

import { generateAccountBackgroundsPrompt } from '../account-backgrounds.mjs';

/**
 * 构建代币信息部分
 */
function buildTokenInfo(tokenData, extractedInfo) {
  const lines = [
    '【代币信息】',
    `- 代币名称：${tokenData.symbol}`,
    `- 代币地址：${tokenData.address}`
  ];

  // 添加基础信息
  if (extractedInfo.intro_en) lines.push(`- 介绍（英文）：${extractedInfo.intro_en}`);
  if (extractedInfo.intro_cn) lines.push(`- 介绍（中文）：${extractedInfo.intro_cn}`);
  if (extractedInfo.website) lines.push(`- 网站：${extractedInfo.website}`);
  if (extractedInfo.twitter_url) lines.push(`- Twitter链接：${extractedInfo.twitter_url}`);

  return lines.join('\n');
}

/**
 * 构建分析原则部分
 */
function buildAnalysisPrinciples() {
  return `
【分析原则】
- **代币名称匹配即视为有效关联**
- **meme币不需要"官方代币"等表述**，名称匹配即可
- **推文附带媒体说明存在视觉关联**：有配图/视频即建立关联，不能说"无法建立视觉关联"

【重要识别】
- **世界级人物**：Trump、Musk、Elon、拜登
- **加密平台**：Binance、Coinbase、Trust Wallet
- **@Four_FORM_** = FourMeme官方（平台官方推文至少mid，40-60分）
- **@cz_binance/@heyibinance** = 币安CZ/何一（世界级加密人物，直接提及代币至少mid）
`;
}

/**
 * 构建评估步骤部分
 */
function buildEvaluationSteps(hasTwitter, hasGithub, hasVideo) {
  const steps = [];

  // 第一步：语言判断（有推文时）
  if (hasTwitter) {
    steps.push(`
**第一步：语言判断（如有推文）**
- 非中英文推文需满足影响力条件（粉丝>=1万 或认证 或高互动点赞>=1000/转发>=500）
- 满足则继续，否则返回low
- 推文为"True"/空/无法获取→unrated
`);
  }

  // 第二步：核心信息缺失判断
  steps.push(`
**第二步：核心信息缺失判断（最高优先级）**
同时满足以下条件→unrated：
1. 无推文 2. 无website 3. 无Twitter账号 4. intro仅简单描述（名字/单词/短语）
`);

  // 第三步：推文类型判断（有推文时）
  if (hasTwitter) {
    steps.push(`
**第三步：推文类型判断（重要，如有推文）**

代币推文分为两类，需优先判断：

**类型A：找角度**
- 特征：发币人解读当前事件，说明为什么可以作为meme币
- 判断标准（满足至少2个）：
  1. 推文中有"front-run"、"people talking about"、"news coming"等前瞻性表述
  2. 有引用推文（引用原始事件）或包含网站链接
  3. 推文内容是"解读/分析"而非"原创声明"本身
  4. intro是解读性描述（如"The Meme House"、"Money Without Masters"）
  5. 发布者影响力较低（粉丝<10000，即使认证）
- **评估原则**：
  - **默认叙事为真**（因为无法验证，发现虚假由黑名单处理）
  - **不要求发布者影响力**，发币人影响力低是正常的
  - **重点评估：事件本身的热度 + 叙事的合理性**

**类型B：由来**
- 特征：有影响力账号的内容本身就是meme币的来源/背景
- 判断标准（满足至少2个）：
  1. 发布者是知名人物（Trump、Musk、CZ等）或有影响力账号（粉丝>10000）
  2. 推文是原创内容/Article/图片/视频（**Article是Twitter长文章功能，本身即为完整内容**）
  3. 推文本身就是meme内容，而非解读其他事件（**有Article时直接满足此条件**）
  4. 代币名直接来自推文内容（如"基于这条推文发币"）
- **评估原则**：
  - **直接关联发布者影响力**：发布者影响力 = 叙事背景评分
`);
  }

  // 第四步：可理解性/关联度判断
  steps.push(`
**第四步：可理解性/关联度判断**

**重要：如果有两个推文（主推文 + Website推文）**：
- **影响力判断：以影响力高的推文为准**（粉丝数多、互动量高的那个）
- 例如：主推文粉丝3千，Website推文粉丝18万 → 以Website推文的影响力为准

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

**知名品牌背书（适用于类型A-找角度）**：
- **情况1**：推文内容明确提到是"XX市场营销/官方发布"的内容（如"aster市场营销发的logo"）
- **情况2**：推文提到币安旗下平台/知名项目（Aster、Trust Wallet、Binance等）
- **情况3**：代币名称与知名品牌匹配（如ASTERCLAN与Aster）
- **满足以上任一情况 + 有具体命名/Logo/配图 → 至少评mid**（25-40分）

**信息在外部平台**（Telegram/Discord/小红书等）→unrated
`);

  // 第五步：类型B-由来推文的影响力评估（有推文时）
  if (hasTwitter) {
    steps.push(`
**第五步：类型B-由来推文的影响力评估（仅适用于类型B）**
- **知名人物直接发帖**：Trump、Musk、CZ等世界级人物 → mid或high
- **认证用户+高互动**：点赞>1000或转发>500 → 可评mid
- **普通用户**：影响力低 → 通常low（除非内容极具传播性）
`);
  }

  // 第六步：BSC链CZ/何一回复预期溢价
  steps.push(`
**第六步：BSC链CZ/何一回复预期溢价**
同时满足才加分：
1. **有近期事件**（2周内）：新闻/币安动态/加密事件/热点
2. **与CZ/何一强关联**：直接提及/涉及币安创始人/引用@cz_binance或@heyibinance
- 强关联+近期热点→+20-35分
- 中等关联→+5-15分
- 无事件或无强关联→不加分
`);

  // 第七步：低质量叙事检测
  steps.push(`
**第七步：低质量叙事检测（直接返回low）**
1. **纯谐音梗**：只有谐音关联（如"生菜=生财"、"Duck you=鸭你一拳"），无实质内容
2. **热搜搬运**：纯报道热点事件（如"XX上热搜"），没有具体内容/事件
3. **泛泛情感概念**：只是借用常见词/抽象概念（"遗憾"、"佛系"等），没有具体故事/文化符号
4. **伪关联**：代币名称只在内容中顺便提及，不是核心主题（但结尾口号式提及不算伪关联）
5. **大IP蹭热度**：代币名称是世界级大IP，但缺乏强关联证据（本人提及、官方发布）
6. **平台产品更新蹭热度**：内容只是某个平台上线新功能，无明确"官方代币"表述
   - 一般/中小型平台的功能更新 → 通常low（0-8分）
7. **功能性符号/标志**：借用功能性、严肃性符号或标志
   - **功能性符号**：紧急出口标志（皮特托先生）、交通标志、警告标志等
   - **评估原则**：功能性符号通常 **0-15分**（传播力极弱）
8. **无影响力的新说法/梗**：创造或使用一个新的概念/梗，但发表者无影响力且未形成社交热度
9. **低star数的GitHub项目**（<100 stars通常low）
`);

  // 第八步：按标准评分
  let scoringStep = `
**第八步：按标准评分**
`;
  if (hasGithub) {
    scoringStep += `- GitHub star数：<10→0-10分，10-100→0-15分，100-1K→10-25分，1K-1W→20-35分，>1W→30-50分\n`;
  }
  scoringStep += `- AI相关事件：革命性突破30-45分，普通产品5-15分，成立部门0-10分
- 功能性符号传播力：0-15分`;

  steps.push(scoringStep);

  return `【评估步骤】\n${steps.join('')}`;
}

/**
 * 构建核心框架
 * @param {Object} tokenData - 代币数据
 * @param {Object} extractedInfo - 提取的信息
 * @param {Object} twitterInfo - Twitter信息
 * @param {Object} options - 选项 { hasGithub, hasVideo }
 */
export function buildCoreFramework(tokenData, extractedInfo, twitterInfo, options = {}) {
  const { hasGithub = false, hasVideo = false } = options;
  const hasTwitter = !!(twitterInfo && (twitterInfo.text || twitterInfo.type === 'account'));

  return `
${buildTokenInfo(tokenData, extractedInfo)}

${generateAccountBackgroundsPrompt(twitterInfo)}${buildAnalysisPrinciples()}${buildEvaluationSteps(hasTwitter, hasGithub, hasVideo)}
`;
}
