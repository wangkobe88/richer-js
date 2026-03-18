/**
 * LLM叙事分析Prompt模板 - V4 严格版
 *
 * V3 问题：
 * - LLM过度评分，混淆"内容质量"与"代币叙事质量"
 * - 谐音梗、热搜搬运、伪关联被判定为high
 * - 可信度权重不足，声称"官方"但无验证的得高分
 *
 * V4 改进点：
 * 1. 增加"代币实质"判断 - 必须说明代币用途/价值主张
 * 2. 明确"伪叙事"检测规则 - 纯谐音/热搜/情感内容直接low
 * 3. 提高可信度权重到40分，且作为硬性门槛
 * 4. 调整评分权重：可信度40、代币实质35、传播力15、完整性10
 * 5. 提高high/mid阈值，增加可信度门槛
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
1.叙事背景(40分):叙事的权威性和背景质量
  * 官方/权威背景叙事（如"币安XX"、"BSC官方XX"、"官方演示"）：30-40分
  * 媒体/热点相关叙事（如"热搜XX"、"新闻XX"）：20-29分
  * 个人故事/创业叙事：10-19分
  * 无背景/纯梗叙事：0-9分
  * 注意：评估叙事背景本身的质量，而非验证真假

2.代币实质(35分):代币代表什么/关联什么/传播什么概念
  * 明确说明代币代表的概念/事物：25-35分（如MWM代表CZ的书，30000代表人生30000天的概念）
  * 有一定关联但说明不够明确：15-24分
  * 只有代币名称无实质内容：≤10分

3.传播力(15分):meme潜力+社交属性+FOMO
  * 具备病毒传播属性：10-15分
  * 有一定传播性：5-9分
  * 传播力弱：0-4分

4.完整性(10分):信息完整度+多渠道覆盖
  * 多渠道+完整信息：8-10分
  * 单渠道但信息完整：5-7分
  * 信息不完整：0-4分

【评级标准】
- unrated: 内容无法理解代币性质，或 推文包含链接/图片但无法理解与代币的关联
- low: 触发任何伪叙事模式，或 非中英文推文，或 纯文本推文关联弱，或 叙事背景<10，或 总分<50
- mid: 叙事背景≥15 且 总分≥55
- high: 叙事背景≥30 且 代币实质≥25 且 总分≥75

【评分示例】
示例1(官方背景叙事):
介绍:币安演示狗币MOONDOGECOIN
→官方背景叙事+明确性质→{credibility:35,substance:25,virality:8,completeness:5,total:73,category:"high"}

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

示例4.5(有链接但有关联-可评分):
代币:MWM
内容:CZ的书籍《Money Without Masters》泄露草稿 + 链接
→推文提到了关联概念(CZ的书)，即使有链接也可评分→{credibility:20,substance:28,virality:10,completeness:4,total:62,category:"mid"}

示例5(有链接但无法理解-unrated):
代币:Memrush
内容:简短"打错了" + https://t.co/xxx链接
→推文未提及代币或关联概念，只有链接→{category:"unrated",reason:"推文包含链接但未提及代币或任何关联概念，无法评估"}

示例6(meme概念-可评分):
代币:30000
内容:"人生不过30000天"的哲学概念
→推文明确说明代币代表的概念，可评分→{credibility:10,substance:25,virality:12,completeness:4,total:51,category:"mid"}

示例7(高质量):
代币:某代币
内容:币安发布的新功能代币，有明确概念和官方背景
→官方背景叙事+明确实质→{credibility:38,substance:30,virality:12,completeness:8,total:88,category:"high"}

【输出格式】
正常评分输出（包含scores）:
{"reasoning":"2-3句中文说明理由","scores":{"credibility":0-40,"substance":0-35,"virality":0-15,"completeness":0-10},"total_score":0-100,"category":"high/mid/low"}

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
    promptVersion: 'V4'
  };
};
