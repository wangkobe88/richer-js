/**
 * LLM叙事分析Prompt模板 - V4.4 严格版
 *
 * V3 问题：
 * - LLM过度评分，混淆"内容质量"与"代币叙事质量"
 * - 谐音梗、热搜搬运、伪关联被判定为high
 * - 可信度权重不足，声称"官方"但无验证的得高分
 *
 * V4 改进点：
 * 1. 增加"代币实质"判断
 * 2. 明确"伪叙事"检测规则
 * 3. 提高可信度权重到40分
 *
 * V4.1-V4.3 改进点：
 * - 明确社交媒体热点属于媒体/热点相关叙事
 * - 明确加密社区文化评分
 * - 同名人物/事物即视为代币实质
 * - 删除"完整性"维度，传播力从15分→25分
 *
 * V4.4 改进点：
 * - **叙事背景按"影响力层级"评分**，而非叙事类型
 * - **加密相关事件有优势**（同一层级比一般事件高5分）
 * - 币安/官方权威：30-40分（最高级）
 * - 世界级/加密重大事件：25-34分
 * - 平台级影响力（加密相关）：20-29分
 * - 平台级影响力（一般）：15-24分
 * - 社区级影响力（加密相关）：10-19分
 * - 社区级影响力（一般）：5-14分
 */

/**
 * 单个代币分析Prompt
 */
export const NARRATIVE_ANALYSIS_PROMPT_V4 = (tokenData) => {
  const twitterText = tokenData.twitter?.text || '';
  const introEn = tokenData.intro?.en || '';
  const introCn = tokenData.intro?.cn || '';

  // 构建输入内容
  const contentParts = [];
  if (twitterText) contentParts.push(`推特: ${twitterText}`);
  if (introEn) contentParts.push(`英文: ${introEn}`);
  if (introCn) contentParts.push(`中文: ${introCn}`);
  const contentStr = contentParts.join('\n') || '无可用内容';

  return `评估BSC链代币叙事质量。

【代币】${tokenData.symbol || 'N/A'}
${contentStr}

【核心原则】
评估BSC链meme代币的叙事质量。注意：
- Meme币无实用价值，通过借助引用的事物/概念进行传播
- "代币实质"是指代币代表什么/关联什么/传播什么概念（而非用途/功能）
- **关键**：对于meme币，内容中提到代币同名人物/事物即视为有实质（如"COCO发贴"→COCO就是那个人），无需额外解释"代表"关系
- 与代币名称有强关联即可
- 评估叙事本身的质量，而非验证真假

【评估步骤】
第一步：判断可理解性
- 内容是否足以理解代币是什么、有什么叙事价值？
- 如果完全无法理解，直接返回 unrated

第二步：检测"低质量叙事"（以下情况直接返回low）
1. **纯谐音梗**：只有谐音关联（如"生菜=生财"、"Duck you=鸭你一拳"），无实质内容
2. **热搜搬运**：纯报道热点事件（如"火鸡面上热搜"、"遗憾话题爆火"），未与代币名称建立关联
3. **伪关联**：代币名称只在内容中顺便提及，不是核心主题

第三步：判断推文语言
- **如果有推文且不是中文/英文**：直接返回 low
- 原因：非中英文推文会极大限制主要用户群体的传播

第四步：判断关联度
- **如果有推文**：需要判断推文与代币的关联度
  - **如果推文包含链接/图片**：
    * 推文提到了代币名称或关联概念（如MWM关联CZ的书）→ 继续评分
    * 推文未提及代币，也无法理解关联 → 返回 unrated（核心信息可能在链接/图片中）
  - **如果推文没有链接/图片（纯文本）**：
    * 关联弱（代币仅被顺便提及）→ 返回 low
    * 强关联（代币是核心主题）→ 继续评分
- **如果无推文/推文未取到**：不要求关联度（只有介绍文字）
- 强关联标准：推文提到了代币名称或其关联的概念/事物

第五步：如果通过以上检查，按以下标准评分

【评分维度】（总分100）
1.叙事背景(50分):按影响力量级评分（加密相关有优势）
  * 币安/官方权威（如"币安XX"、"CZ演示"、"官方项目"、CZ相关）：35-50分
  * 世界级/加密重大事件（如全球大事件、顶级名人、国际主流媒体、CZ相关）：30-44分
  * 平台级影响力（加密相关）：25-34分（如抖音千万话题+币圈人物、知名KOL、交易所相关）
  * 平台级影响力（一般）：20-29分（如抖音千万话题、国家新闻、大型平台热点）
  * 社区级影响力（加密相关）：10-24分（如加密社区KOL、币圈事件）
  * 社区级影响力（一般）：5-19分（如地方性事件、小圈子热点）
  * 无明确影响力：0-4分
  * 注意：同一层级中，加密相关事件比一般事件高约5分

2.传播力(50分):meme潜力+社交属性+FOMO+内容丰富度
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
→币安官方+明确性质→{credibility:35,substance:25,virality:13,total:73,category:"high"}

示例2(纯谐音梗-直接low):
代币:生菜
内容:支付宝热搜"生菜=生财"，顶级谐音梗
→纯谐音无代币实质→{category:"low",reason:"纯谐音梗，无代币用途或价值主张说明"}

示例3(热搜搬运-直接low):
代币:火鸡面
内容:81岁爷爷误食火鸡面被辣到，微博热搜事件
→纯热点搬运无代币意义→{category:"low",reason:"纯热搜事件搬运，未说明与代币的关联或代币价值"}

示例4(伪关联-直接low):
代币:宝可梦
内容:个人创业故事，仅在开头提到"8岁时在宝可梦热潮期间卖青蛙"（无链接/图片）
→纯文本关联极弱→{category:"low",reason:"代币名称只在背景中顺便提及，与内容核心主题无关"}

示例4.5(CZ相关-可评分):
代币:MWM
内容:CZ的书籍《Money Without Masters》泄露草稿
→CZ相关(加密重大事件)+同名实质→{credibility:30,substance:28,virality:17,total:75,category:"high"}

示例5(有链接但无法理解-unrated):
代币:Memrush
内容:简短"打错了" + https://t.co/xxx链接
→推文未提及代币或关联概念，只有链接→{category:"unrated",reason:"推文包含链接但未提及代币或任何关联概念，无法评估"}

示例6(平台级热点-可评分):
代币:大狗大狗
内容:抖音爆火的"大狗"声音，已有上千万话题热度，像"doge doge"
→平台级热点(抖音千万话题+doge相关)+同名关联→{credibility:22,substance:25,virality:20,total:67,category:"mid"}

示例6.5(社区级加密-可评分):
代币:BONKRot
内容:基于Solana链知名代币$bonk的嘲讽版本
→社区级影响力(加密社区)+明确实质→{credibility:12,substance:22,virality:20,total:54,category:"mid"}

示例7(币安平台级-可评分):
代币:天使—COCO
内容:币安Openclaw聊群的群主 天使 COCO在广场发了贴
→平台级影响力(币安广场)+同名人物→{credibility:28,substance:30,virality:18,total:76,category:"high"}

示例8(社区级一般-可评分):
代币:30000
内容:"人生不过30000天"的哲学概念
→社区级影响力(哲学概念)+明确实质→{credibility:8,substance:25,virality:20,total:53,category:"mid"}

示例9(高质量-币安官方):
代币:某代币
内容:币安发布的新功能代币，有明确概念和官方背景
→币安官方+明确实质→{credibility:38,substance:30,virality:20,total:88,category:"high"}

【输出格式】
正常评分输出（包含scores）:
{"reasoning":"2-3句中文说明理由","scores":{"credibility":0-40,"substance":0-35,"virality":0-25},"total_score":0-100,"category":"high/mid/low"}

无法理解输出（不包含scores）:
{"category":"unrated","reasoning":"说明无法理解代币性质的原因"}`;
};

/**
 * 获取Prompt摘要（用于日志记录）
 */
export const getPromptSummary = (tokenData) => {
  const twitterText = tokenData.twitter?.text || '';
  const introEn = tokenData.intro?.en || '';
  const introCn = tokenData.intro?.cn || '';
  const contentLength = twitterText.length + introEn.length + introCn.length;
  return {
    symbol: tokenData.symbol,
    hasTwitter: twitterText.length > 0,
    hasIntroEn: introEn.length > 0,
    hasIntroCn: introCn.length > 0,
    totalContentLength: contentLength,
    twitterLength: twitterText.length,
    introEnLength: introEn.length,
    introCnLength: introCn.length,
    promptVersion: 'V4.4'
  };
};
