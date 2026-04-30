/**
 * 超大IP快速通道 — 机构类（D类）Prompt
 *
 * 维度二：事件传播价值（0-30分），4角度评估（话题性/煽动性/感染力/影响力）
 * 与D类V4.0对齐：
 * - 不阻断日常运营/营销类事件，由评分自然过滤
 * - 仅阻断政治/冲突性质事件
 * - 评分示例：Binance上架新币 → S级(40) + 弱传播(3) + 近期(15) = 58 → pass=false（自然过滤）
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 内部辅助函数
// ═══════════════════════════════════════════════════════════════════════════════

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

function shouldIncludeBrandHijackCheck(symbol, name) {
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

function buildBrandHijackSection() {
  return `
**品牌劫持检查**（最高优先级，在其他关联性规则之前执行）

⚠️ 此代币来自meme代币发行平台，只能创建meme代币。

如果代币名（Symbol/Name）与以下名称完全匹配或高度相似，且不满足豁免条件 → pass=false：
- 关联性得分设为0-5分 + 名称合理性降到1-2分 + pass=false

**A类 知名代币**：BTC, ETH, BNB, SOL, DOGE, PEPE, SHIB, USDT等
- 豁免：代币名虽与知名代币重名，但事件核心实体是完全不同的东西（不同领域）

**B类 知名人物**：CZ, Elon, Trump, 何一, Vitalik等
- 豁免（人物名）：事件确系该人物本人直接发起，有实质内容，有发酵空间

**C类 知名机构**：Binance, Coinbase, OpenAI等
- 豁免：该机构发生了重大事件（收购、被黑、重大政策变动等）
- ⚠️ 区分"机构名"和"包含机构名的专有名词"：
  - 机构名本身（"Binance"、"Coinbase"）→ 属于C类
  - 机构官方产品/部门（"Binance Research"）→ 属于C类
  - 包含机构名的独立作品/概念 → **不属于C类**
    - "币安人生" → CZ的**书名**，不是币安部门 → 不触发C类
    - "币安一姐" → 何一的**绰号**，不是币安正式称谓 → 不触发C类
    - 判断方法：去掉机构名，剩余部分是否构成独立意义？

`;
}

function buildDataSections(fetchResults) {
  if (!fetchResults) return '【无额外语料数据】';

  const sections = [];

  if (fetchResults.twitterInfo) {
    const tw = fetchResults.twitterInfo;
    let twSection = '【推文内容】';
    if (tw.author_name) twSection += `\n作者：${tw.author_name} (@${tw.author_screen_name || '?'})`;
    if (tw.created_at) twSection += `\n发布时间：${tw.created_at}`;
    if (tw.text) twSection += `\n内容：${tw.text}`;
    if (tw.metrics) twSection += `\n互动数据：${JSON.stringify(tw.metrics)}`;

    if (tw.quoted_status) {
      twSection += `\n\n【引用推文】`;
      twSection += `\n作者：${tw.quoted_status.author_name || '?'} (@${tw.quoted_status.author_screen_name || '?'})`;
      if (tw.quoted_status.text) twSection += `\n内容：${tw.quoted_status.text}`;
    }

    if (tw.in_reply_to) {
      twSection += `\n\n【回复推文】`;
      twSection += `\n作者：${tw.in_reply_to.author_name || '?'} (@${tw.in_reply_to.author_screen_name || '?'})`;
      if (tw.in_reply_to.text) twSection += `\n内容：${tw.in_reply_to.text}`;
    }

    if (tw.website_tweet) {
      twSection += `\n\n【Website推文】`;
      twSection += `\n作者：${tw.website_tweet.author_name || '?'} (@${tw.website_tweet.author_screen_name || '?'})`;
      if (tw.website_tweet.text) twSection += `\n内容：${tw.website_tweet.text}`;
    }

    sections.push(twSection);
  }

  if (fetchResults.websiteInfo?.content) {
    sections.push(`【网站内容】\n${fetchResults.websiteInfo.content.substring(0, 2000)}`);
  }

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

// ═══════════════════════════════════════════════════════════════════════════════
// 导出：构建机构类（D类）快速通道 Prompt
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 构建机构类（D类）快速通道Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的所有语料数据
 * @param {Object} ipInfo - 注册表中的IP信息 { name, type, tier, desc }
 * @param {Object} preScores - 预计算分数 { tierScore, timeliness, baseEventScore }
 * @returns {string} Prompt
 */
export function buildInstitutionFastPrompt(tokenData, fetchResults, ipInfo, preScores) {
  const symbol = tokenData.symbol || '';
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
  const chainName = (tokenData.blockchain || tokenData.platform || 'BSC').toUpperCase();

  const dataSections = buildDataSections(fetchResults);
  const includeBrandCheck = shouldIncludeBrandHijackCheck(symbol, tokenName);
  const brandSection = includeBrandCheck ? buildBrandHijackSection() : '';

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

⚠️ 此维度评估的是整个事件的传播价值。同一个内容，由不同机构发布，传播价值不同。
例如"Happy Easter"由Binance发布，社区会互动、玩梗，有传播价值；由不知名小公司发布，则无人在意。

**从四个角度综合评估**：

1. **话题性**：能否引发社区讨论？是否有人会转发/评论？
2. **煽动性**：是否激发情绪反应？是否有争议空间？
3. **感染力**：是否容易被记住/传播？是否有共鸣？
4. **影响力**：是否影响很多人？是否改变认知/行为？

**评分标准**（综合四个角度）：

- **强传播**（22-30分）：满足3-4个角度，且至少1个"高"
  - 示例：Binance宣布重大战略调整 → 强影响力 + 强话题性 + 强感染力
  - 示例：Binance被SEC起诉 → 强煽动性 + 强话题性 + 强影响力
  - 示例：简短有力的口号、独特概念/新造词 → 强感染力
  - 示例：与CZ/何一/币安官方强关联或引用其观点 → 强话题性 + 强感染力

- **中传播**（10-21分）：满足1-2个角度
  - 示例：Binance发起创意营销活动 → 有感染力 + 有话题性
  - 示例：知名机构发表有趣观点 → 有话题性
  - 示例：有画面感/故事线的内容 → 有感染力
  - 示例：Binance发节日问候 → 社区会互动玩梗，有话题性（弱）+ 有感染力（弱）

- **弱传播**（0-9分）：基本不满足
  - 示例：上架新币公告、常规功能更新
  - 示例：礼节性表达、系统维护通知

═══════════════════════════════════════════════════════════════════════════════

**任务二：阻断检查**

⚠️ 以下情况直接阻断（pass=false），不再继续评估：

**政治/冲突性质阻断**：
- 涉及战争、军事冲突、恐怖主义、制裁对抗的事件
- 涉及国家间对抗、地缘政治威胁、核威胁等负面政治事件
- 政府或政治实体的威胁性/敌对性言论和动作
- ⚠️ **豁免**：和平协议、国际合作、人道主义援助等正面政治事件不触发此阻断
- ⚠️ **豁免**：知名机构对政治事件发表观点引发社区玩梗，不触发此阻断
- ⚠️ **豁免**：政治实体的非严肃/娱乐性动作（推出吉祥物、使用meme、发表有趣/接地气的内容引发社区玩梗），不触发此阻断

⚠️ **不阻断日常运营/营销**：
- 日常运营（上架新币、常规功能更新、系统维护）不触发阻断，由评分自然过滤
- 营销噱头（节日活动、创意推广）不触发阻断，由评分自然过滤
- 示例：Binance上架新币 → S级(40) + 弱传播(3) + 近期(15) = 58 → 自然过滤（pass=false由分数决定，不因阻断）
- 示例：Binance发节日问候 → S级(40) + 中传播(10) + 近期(15) = 65 → pass=true（有价值）

═══════════════════════════════════════════════════════════════════════════════

**任务三：代币-事件关联性评估（0-20分）**
${brandSection}
**关联性评分**（互斥层级，从高到低检查，命中即停止）：

- **精确匹配**（16-20分）：代币名与推文核心内容直接对应
  - 完全匹配(20分)：代币名 = 核心实体名称
  - 中英文对应(18分)：代币名与核心实体是中英文对应
  - 缩写匹配(16分)：代币名是核心实体的常见缩写
  - 别名/绰号匹配(16-18分)：代币名是事件核心实体的广为人知的别名、绰号、黑称
    - 高排他性（几乎所有使用都指向该实体）→ 18分（如"孙割"→孙宇晨, "SBF"→Sam Bankman-Fried）
    - 广泛认知但偶有歧义 → 16分（如"V神"→Vitalik, "一姐"→何一）
  - ⚠️ 代币即产品匹配：如果事件涉及产品/项目发布，且代币名与产品名/项目名一致 → 完全匹配(20分)

- **语义关联**（10-15分）：代币名与事件有明显的语义联系
  - 强语义关联(15分)：代币名在事件内容中明确提及或直接衍生
    - 数字缩写对应：K(千)/M(百万)/B(十亿)与完整数字对应（如"1B" = 1 billion → 15分）
  - 中等语义关联(12分)：代币名与事件有间接但合理的语义关联
  - 弱语义关联(10分)：间接关联，事件内容未直接提及代币名的核心概念
  - ⚠️ 推断合理性：语义关联需基于事件内容中明确出现的关键词或Web3社区常识
    - ✅ 合理推断："币安一姐"是何一广为人知的绰号 → 有效语义关联
    - ✅ 合理推断："韭菜"是加密圈散户隐喻 → 有效语义关联
    - ❌ 不合理推断："链上皇"不是CZ的已知称谓，仅凭地位创造关联 → 不是有效语义关联

- **文化关联**（0-15分）：需要文化背景知识才能理解的关联
  - 强文化关联(13-15分)：代币名与事件有明确的文化关联，且该关联具有高度排他性
  - 中等文化关联(8-12分)：代币名与事件有一定文化关联
  - 弱文化关联(3-7分)：代币名与事件关联较弱
  - 无有效关联(0-2分)：代币名完全无法与事件建立有效联系
  - ⚠️ 泛化概念不构成有效关联：极度泛化的概念（金钱、自由、成功、爱、快乐等）不构成有效关联

⚠️ **关联性底线提醒**：关联性得分 ≤ 10分 → pass = false。因此只有强文化关联和中上等文化关联能越过底线。

**关联性约束**：
- 需2步以上推理 → 关联性降档
- 需要2步以上推理 + 概念联想 → 关联性极低(0-3分)

═══════════════════════════════════════════════════════════════════════════════

**任务四：代币质量评估（0-20分）**

- **名称长度**（0-8分）：
  - 中文：1-3字8分 | 4-6字5-7分 | 7-10字2-4分 | >10字0-1分
  - 英文：1词8分 | 2-3词5-7分 | 4词2-4分 | >4词0-1分

- **拼写/可读性**（0-7分）：
  - 完全正确、易读：7分 | 有小错误但可理解：5-6分 | 错误较多、难读：2-4分 | 完全无法理解：0分
  - ⚠️ 无背景拼写错误直接判low：代币名与事件实体/已知概念有明显拼写差异（1-2个字母），且没有独立背景故事 → 拼写/可读性降到0-2分 + 名称合理性降到0-1分 + pass=false

- **名称合理性**（0-5分）：
  - 名称合理、有意义：5分 | 名称一般：3-4分 | 名称奇怪：1-2分 | 完全不合理：0分

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
