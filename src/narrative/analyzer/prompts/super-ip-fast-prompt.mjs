/**
 * 超大IP快速通道 Prompt
 * 单次LLM调用完成：内容meme潜力评估 + 阻断检查 + 代币关联性/质量评估
 *
 * 设计原则：
 * - 维度一（影响力）和时效性已预计算，直接传入，LLM不需要重新评估
 * - LLM仅需评估：维度二（内容meme潜力）、阻断条件、代币关联性和质量
 * - 两套模板：人物类（C类）和机构类（D类），阻断条件不同
 */

/**
 * Prompt版本号
 */
export const SUPER_IP_FAST_PROMPT_VERSION = 'V1.0';

/**
 * 构建人物类（C类）快速通道Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的所有语料数据
 * @param {Object} ipInfo - 注册表中的IP信息 { name, type, tier, desc }
 * @param {Object} preScores - 预计算分数 { tierScore, timeliness, baseEventScore }
 * @returns {string} Prompt
 */
export function buildPersonFastPrompt(tokenData, fetchResults, ipInfo, preScores) {
  const symbol = tokenData.symbol || '';
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
  const chainName = (tokenData.blockchain || tokenData.platform || 'BSC').toUpperCase();

  // 构建语料段落
  const dataSections = _buildDataSections(fetchResults);

  // 品牌劫持预检
  const includeBrandCheck = _shouldIncludeBrandHijackCheck(symbol, tokenName);
  const brandSection = includeBrandCheck ? _buildBrandHijackSection('person') : '';
  const truncationRules = includeBrandCheck
    ? `1. **品牌劫持触发且不满足豁免** → pass = false
2. **无背景拼写错误触发** → pass = false
3. **关联性得分 ≤ 10分** → pass = false
4. **质量得分 ≤ 4分** → pass = false`
    : `1. **无背景拼写错误触发** → pass = false
2. **关联性得分 ≤ 10分** → pass = false
3. **质量得分 ≤ 4分** → pass = false`;

  return `你是叙事分析专家，快速评估基于知名人士推文的meme代币。

╔══════════════════════════════════════════════════════════════════════════════╗
║              超大IP快速通道 — C类（人物言论/动作）                               ║
╚══════════════════════════════════════════════════════════════════════════════╝

【已知信息】（预确定，无需重新评估）
- 来源账号：${ipInfo.name}（${ipInfo.desc}）
- 影响力等级：${ipInfo.tier}级 → 维度一得分：${preScores.tierScore}分
- 事件分类：C类（人物言论/动作）
- 时效性加分：${preScores.timeliness}分
- 基础事件分 = 维度一(${preScores.tierScore}) + 时效性(${preScores.timeliness}) = ${preScores.baseEventScore}分

${dataSections}

【代币信息】
- Symbol：${symbol}
- Name：${tokenName || symbol}
- 合约地址：${tokenData.address}
- 所属链：${chainName}

═══════════════════════════════════════════════════════════════════════════════

📋 **评估任务**（按顺序执行）

⚠️ **重要提示**：
- **不要求信息"可验证"或"真实"**，只要求有具体内容描述
- 推文中给出的数据都是有效信息
- 即使是营销包装，只要描述了具体的事件/数据/概念，就不算空洞

═══════════════════════════════════════════════════════════════════════════════

**任务一：内容meme潜力评估（维度二，0-30分）**

评估推文内容本身的传播潜力（不是代币名的好坏）。

🎯 **meme币的本质**：需要社区共识和持续传播。核心看事件内容是否能引发社区广泛传播和讨论。

**评分标准**：

1. **口号性**（25-30分）：简短有力、朗朗上口、可被社区反复使用
   - 示例："We make impact"、"Everything is number"

2. **独特概念/新造词**（20-28分）：提出了独特的概念或词汇（包括讽刺/幽默性质的）
   - 示例：CZ回应SEC争议事件引发的新概念

3. **数字/日期叙事**（20-28分）：具体数字/日期成为事件核心记忆点
   - 示例：CZ书中提到"第48页"被社区提取为"48"叙事

4. **CZ/何一/币安高管的互动/回复潜力**（25-30分）：
   - 对CZ/何一/币安的认同、致敬、情感表达，可能引发其回复/转发
   - 发现/引用了CZ/何一/币安说过的有趣/有影响力的话

5. **争议/话题性**（20-28分）：引发讨论、有争议空间

6. **形象化/故事性**（15-25分）：有画面感、有故事线

**不满足以上任何维度**（0-7分）：日常闲聊、纯产品提及、礼节性表达

═══════════════════════════════════════════════════════════════════════════════

**任务二：阻断检查**

⚠️ 以下情况直接阻断（pass=false），不再继续评估：

1. **纯营销/喊单**：推广、广告、买币建议等纯商业行为
   - ⚠️ ${ipInfo.tier === 'S' ? 'S级人物的营销豁免：如果是本人营销内容，且内容本身有一定话题性/meme潜力 → 不阻断' : 'A级人物营销不豁免'}

2. **纯转发/搬运**：只是转发别人的内容，无自己的观点/解读

3. **日常废话/流水账**：纯闲聊，无任何可传播元素

4. **无观点的互动**：回复"cool"、"nice"、纯表情等

5. **纯负面/敌对言论**：无幽默/讽刺/自嘲元素的纯负面言论

⚠️ **S级人物豁免**：
- ${ipInfo.tier === 'S' ? 'S级人物的简单发言（如"hi"）**不触发**"内容完全无意义"阻断，由评分决定结果' : 'A级人物不享受此豁免'}

═══════════════════════════════════════════════════════════════════════════════

**任务三：代币-事件关联性评估（0-20分）**
${brandSection}
**关联性评分**：

- **精确匹配**（16-20分）：代币名与推文核心内容直接对应
  - 完全匹配(20分)、中英文对应(18分)、别名/缩写(16-18分)

- **语义关联**（10-15分）：代币名与事件有明显的语义联系
  - 需基于推文中明确出现的关键词，禁止基于人物地位/背景知识推断

- **文化关联**（0-9分）：需要文化背景知识才能理解的关联
  - ⚠️ 极度泛化的概念（金钱、自由、成功）不构成有效关联

**关联性约束**：
- 需2步以上推理 → 关联性降档
- 需要2步以上推理 + 概念联想 → 关联性极低(0-3分)

═══════════════════════════════════════════════════════════════════════════════

**任务四：代币质量评估（0-20分）**

- **名称长度**（0-8分）：
  - ≤5字符：7-8分 | 6-10字符：5-6分 | 11-15字符：3-4分 | 16-20字符：1-2分 | >20字符：0分
  - 中文字符按2单位计

- **拼写/可读性**（0-7分）：
  - 正常可读/可发音：5-7分 | 有些奇怪：3-4分 | 乱码/无法发音：0-2分
  - ⚠️ 有明显拼写错误且无背景故事（如"Biance"模仿"Binance"）→ 0-1分

- **名称合理性**（0-5分）：
  - 有明确来源/故事：3-5分 | 有一定联系：2分 | 随机/无意义：0-1分

═══════════════════════════════════════════════════════════════════════════════

📋 **截断规则**

如果满足以下任一条件，直接pass=false：
${truncationRules}

═══════════════════════════════════════════════════════════════════════════════

📋 **分数聚合**（无需你计算，仅供参考）

最终总分 = (基础事件分 + 维度二得分) × 0.6 + 关联性得分 + 质量得分
= (${preScores.baseEventScore} + 维度二) × 0.6 + 关联性 + 质量

- ≥70 → high
- ≥50 → mid
- <50 → low

═══════════════════════════════════════════════════════════════════════════════

【输出格式】

**只返回JSON，不要其他内容**：

**阻断时**：
{
  "pass": false,
  "blockReason": "阻断原因",
  "dimension2Score": 0,
  "relevanceScore": 0,
  "qualityScore": 0,
  "qualityBreakdown": { "length": 0, "spelling": 0, "nameReasonability": 0 },
  "eventDescription": { "eventTheme": "...", "eventSubject": "${ipInfo.name}", "eventContent": "简要事件描述" },
  "reasoning": "阻断理由"
}

**通过时**：
{
  "pass": true,
  "blockReason": null,
  "dimension2Score": 25,
  "relevanceScore": 18,
  "qualityScore": 15,
  "qualityBreakdown": { "length": 7, "spelling": 5, "nameReasonability": 3 },
  "eventDescription": { "eventTheme": "...", "eventSubject": "${ipInfo.name}", "eventContent": "详细事件描述" },
  "reasoning": "简要分析过程"
}`;
}

/**
 * 构建机构类（D类）快速通道Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的所有语料数据
 * @param {Object} ipInfo - 注册表中的IP信息
 * @param {Object} preScores - 预计算分数
 * @returns {string} Prompt
 */
export function buildInstitutionFastPrompt(tokenData, fetchResults, ipInfo, preScores) {
  const symbol = tokenData.symbol || '';
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
  const chainName = (tokenData.blockchain || tokenData.platform || 'BSC').toUpperCase();

  const dataSections = _buildDataSections(fetchResults);

  const includeBrandCheck = _shouldIncludeBrandHijackCheck(symbol, tokenName);
  const brandSection = includeBrandCheck ? _buildBrandHijackSection('institution') : '';
  const truncationRules = includeBrandCheck
    ? `1. **品牌劫持触发且不满足豁免** → pass = false
2. **无背景拼写错误触发** → pass = false
3. **关联性得分 ≤ 10分** → pass = false
4. **质量得分 ≤ 4分** → pass = false`
    : `1. **无背景拼写错误触发** → pass = false
2. **关联性得分 ≤ 10分** → pass = false
3. **质量得分 ≤ 4分** → pass = false`;

  return `你是叙事分析专家，快速评估基于知名机构官方推文的meme代币。

╔══════════════════════════════════════════════════════════════════════════════╗
║              超大IP快速通道 — D类（机构言论/动作）                               ║
╚══════════════════════════════════════════════════════════════════════════════╝

【已知信息】（预确定，无需重新评估）
- 来源机构：${ipInfo.name}（${ipInfo.desc}）
- 影响力等级：${ipInfo.tier}级 → 维度一得分：${preScores.tierScore}分
- 事件分类：D类（机构言论/动作）
- 时效性加分：${preScores.timeliness}分
- 基础事件分 = 维度一(${preScores.tierScore}) + 时效性(${preScores.timeliness}) = ${preScores.baseEventScore}分

${dataSections}

【代币信息】
- Symbol：${symbol}
- Name：${tokenName || symbol}
- 合约地址：${tokenData.address}
- 所属链：${chainName}

═══════════════════════════════════════════════════════════════════════════════

📋 **评估任务**（按顺序执行）

⚠️ **重要提示**：
- **不要求信息"可验证"或"真实"**，只要求有具体内容描述
- 推文中给出的数据都是有效信息
- 即使是营销包装，只要描述了具体的事件/数据/概念，就不算空洞

═══════════════════════════════════════════════════════════════════════════════

**任务一：事件传播价值评估（维度二，0-30分）**

从四个角度综合评估事件的传播价值：

1. **话题性**：能否引发社区讨论？是否有人会转发/评论？
2. **煽动性**：是否激发情绪反应？是否有争议空间？
3. **感染力**：是否容易被记住/传播？是否有共鸣？
4. **影响力**：是否影响很多人？是否改变认知/行为？

**评分标准**：

- **强传播**（22-30分）：满足3-4个角度，且至少1个"高"
  - 示例：Binance宣布重大战略调整、Binance被SEC起诉
  - 示例：简短有力的口号、独特概念/新造词
  - 示例：与CZ/何一/币安官方强关联或引用其观点

- **中传播**（10-21分）：满足1-2个角度
  - 示例：Binance发起创意营销活动
  - 示例：知名机构发表有趣观点
  - 示例：Binance发节日问候 → 社区会互动玩梗

- **弱传播**（0-9分）：基本不满足
  - 示例：上架新币公告、常规功能更新

═══════════════════════════════════════════════════════════════════════════════

**任务二：阻断检查**

⚠️ 以下情况直接阻断（pass=false），不再继续评估：

1. **日常运营**：平台日常运营（新池子、上架新币、常规功能更新、系统维护）

2. **政治/冲突性质**：
   - 涉及战争、军事冲突、恐怖主义、制裁对抗的事件
   - ⚠️ 豁免：和平协议、国际合作、人道主义援助等正面政治事件
   - ⚠️ 豁免：非严肃/娱乐性动作（推出吉祥物、使用meme等引发社区玩梗）

═══════════════════════════════════════════════════════════════════════════════

**任务三：代币-事件关联性评估（0-20分）**
${brandSection}
**关联性评分**：

- **精确匹配**（16-20分）：代币名与推文核心内容直接对应
- **语义关联**（10-15分）：代币名与事件有明显语义联系
- **文化关联**（0-9分）：需要文化背景知识才能理解

═══════════════════════════════════════════════════════════════════════════════

**任务四：代币质量评估（0-20分）**

- **名称长度**（0-8分）：≤5字符7-8分 | 6-10字符5-6分 | 11-15字符3-4分 | >15字符0-2分
- **拼写/可读性**（0-7分）：正常5-7分 | 奇怪3-4分 | 乱码0-2分
- **名称合理性**（0-5分）：有来源3-5分 | 有联系2分 | 无意义0-1分

═══════════════════════════════════════════════════════════════════════════════

📋 **截断规则**

如果满足以下任一条件，直接pass=false：
${truncationRules}

═══════════════════════════════════════════════════════════════════════════════

📋 **分数聚合**（无需你计算，仅供参考）

最终总分 = (基础事件分 + 维度二得分) × 0.6 + 关联性得分 + 质量得分
= (${preScores.baseEventScore} + 维度二) × 0.6 + 关联性 + 质量

- ≥70 → high
- ≥50 → mid
- <50 → low

═══════════════════════════════════════════════════════════════════════════════

【输出格式】

**只返回JSON，不要其他内容**：

**阻断时**：
{
  "pass": false,
  "blockReason": "阻断原因",
  "dimension2Score": 0,
  "relevanceScore": 0,
  "qualityScore": 0,
  "qualityBreakdown": { "length": 0, "spelling": 0, "nameReasonability": 0 },
  "eventDescription": { "eventTheme": "...", "eventSubject": "${ipInfo.name}", "eventContent": "简要事件描述" },
  "reasoning": "阻断理由"
}

**通过时**：
{
  "pass": true,
  "blockReason": null,
  "dimension2Score": 25,
  "relevanceScore": 18,
  "qualityScore": 15,
  "qualityBreakdown": { "length": 7, "spelling": 5, "nameReasonability": 3 },
  "eventDescription": { "eventTheme": "...", "eventSubject": "${ipInfo.name}", "eventContent": "详细事件描述" },
  "reasoning": "简要分析过程"
}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 内部辅助函数
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 构建语料数据段落
 */
function _buildDataSections(fetchResults) {
  if (!fetchResults) return '【无额外语料数据】';

  const sections = [];

  // 推文内容
  if (fetchResults.twitterInfo) {
    const tw = fetchResults.twitterInfo;
    let twSection = '【推文内容】';
    if (tw.author_name) twSection += `\n作者：${tw.author_name} (@${tw.author_screen_name || '?'})`;
    if (tw.created_at) twSection += `\n发布时间：${tw.created_at}`;
    if (tw.text) twSection += `\n内容：${tw.text}`;
    if (tw.metrics) twSection += `\n互动数据：${JSON.stringify(tw.metrics)}`;

    // 引用推文
    if (tw.quoted_status) {
      twSection += `\n\n【引用推文】`;
      twSection += `\n作者：${tw.quoted_status.author_name || '?'} (@${tw.quoted_status.author_screen_name || '?'})`;
      if (tw.quoted_status.text) twSection += `\n内容：${tw.quoted_status.text}`;
    }

    // 回复推文
    if (tw.in_reply_to) {
      twSection += `\n\n【回复推文】`;
      twSection += `\n作者：${tw.in_reply_to.author_name || '?'} (@${tw.in_reply_to.author_screen_name || '?'})`;
      if (tw.in_reply_to.text) twSection += `\n内容：${tw.in_reply_to.text}`;
    }

    // Website推文（第二个推文）
    if (tw.website_tweet) {
      twSection += `\n\n【Website推文】`;
      twSection += `\n作者：${tw.website_tweet.author_name || '?'} (@${tw.website_tweet.author_screen_name || '?'})`;
      if (tw.website_tweet.text) twSection += `\n内容：${tw.website_tweet.text}`;
    }

    sections.push(twSection);
  }

  // 网站内容
  if (fetchResults.websiteInfo?.content) {
    sections.push(`【网站内容】\n${fetchResults.websiteInfo.content.substring(0, 2000)}`);
  }

  // 币安广场
  if (fetchResults.binanceSquareInfo) {
    const bs = fetchResults.binanceSquareInfo;
    let bsSection = '【币安广场内容】';
    if (bs.title) bsSection += `\n标题：${bs.title}`;
    if (bs.author) bsSection += `\n作者：${bs.author}`;
    if (bs.content) bsSection += `\n内容：${bs.content.substring(0, 2000)}`;
    sections.push(bsSection);
  }

  return sections.length > 0 ? sections.join('\n\n') : '【无额外语料数据】';
}

/**
 * 品牌劫持关键词（与 stage3-token-analysis.mjs 保持一致）
 */
const BRAND_HIJACK_KEYWORDS = [
  'btc', 'bitcoin', '比特币', 'eth', 'ethereum', '以太坊', 'bnb', 'sol', 'solana',
  'xrp', 'doge', 'dogecoin', 'pepe', 'shib', 'usdt', 'usdc', 'link', 'uni', 'aave', 'floki',
  'cz', '赵长鹏', 'elon', 'musk', '马斯克', 'trump', '特朗普',
  'vitalik', '何一', '孙宇晨', 'sbf',
  'binance', '币安', 'coinbase', 'openai', 'google', '谷歌',
];

/**
 * 检查是否需要包含品牌劫持检查
 */
function _shouldIncludeBrandHijackCheck(symbol, name) {
  const normalize = (str) => {
    if (!str) return '';
    return str.toLowerCase()
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
      .replace(/\d/g, '')
      .replace(/[^a-z\u4e00-\u9fff]/g, '');
  };
  const ns = normalize(symbol);
  const nn = normalize(name);
  return BRAND_HIJACK_KEYWORDS.some(kw => ns.includes(kw) || nn.includes(kw));
}

/**
 * 构建品牌劫持检查段落（精简版）
 */
function _buildBrandHijackSection(ipType) {
  return `
**品牌劫持检查**（最高优先级，在其他关联性规则之前执行）

⚠️ 此代币来自meme代币发行平台，只能创建meme代币。

如果代币名（Symbol/Name）与以下名称完全匹配或高度相似，且不满足豁免条件 → pass=false：

- **A类 知名代币**：BTC, ETH, BNB, SOL, DOGE, PEPE, SHIB, USDT等
- **B类 知名人物**：CZ, Elon, Trump, 何一, Vitalik等
- **C类 知名机构**：Binance, Coinbase, OpenAI等

**豁免条件**：
- A类：代币名虽与知名代币重名，但事件核心实体是完全不同的东西（不同领域）
- B类（${ipType === 'person' ? '如代币名是本人名' : '人物名'}）：事件确系该人物本人直接发起，有实质内容，有发酵空间
- C类：该机构发生了重大事件（收购、被黑、重大政策变动等）

`;
}
