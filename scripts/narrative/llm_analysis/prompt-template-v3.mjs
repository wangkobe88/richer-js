/**
 * LLM叙事分析Prompt模板 - V3 改进版
 *
 * 改进点：
 * 1. 移除预处理的skip逻辑，让LLM判断内容是否可理解
 * 2. 增加"可理解性"评估维度
 * 3. 增加"关联度"评估维度 - 内容必须与代币名称有实质关联
 * 4. 明确unrated的使用条件
 * 5. 强调内容实质而非长度
 */

/**
 * 单个代币分析Prompt
 */
export const NARRATIVE_ANALYSIS_PROMPT_V3 = (tokenData) => {
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

【重要说明】
1. 如果内容完全无法理解代币是什么、有什么意义，返回category:"unrated"
2. 内容长短不重要，能否理解代币性质才重要
3. 例如"币安演示狗币"虽短但明确说明代币性质和来源，应正常评分
4. 例如推文只说"已上传下载链接"但没说代币是什么，应返回unrated

【评估步骤】
第一步：判断可理解性
- 内容是否足以理解代币是什么、有什么叙事价值？
- 如果完全无法理解，直接返回 unrated，无需继续评分

第二步：判断关联度（关键）
- **如果有推文**：推文必须与代币名称有合理关联，否则直接返回 category:"low"
- **如果无推文/推文未取到**：可以不要求关联度（因为只有介绍文字）
- 关联强度判断标准：
  * 强关联：代币名称是内容的核心主题（如"佛系"代币讲述佛系生活态度）
  * 中等关联：代币名称是内容的重要组成部分（如"青蛙"代币讲述卖青蛙创业故事）
  * 弱关联：代币名称只是被顺便提及（如"宝可梦"代币只在童年故事背景中提了一次）
  * 无关联：内容与代币名称完全没有关系
- 如果有推文但关联为弱或无，直接返回 category:"low"，reason说明关联不足

第三步：判断推文语言
- **如果有推文内容且不是中文/英文**：直接返回 category:"low"
- 原因：非中英文推文会极大限制主要用户群体（中文/英文用户为主）的传播和认知
- 多数情况这表示代币主要面向其他语言市场，与目标用户群体不匹配
- 例外：如果推文中包含大量中英文内容混合，可以适当放宽此标准

第四步：如果可理解且有足够关联且语言合适，按以下标准评分
1.内容质量(35分):主题明确性+叙事强度+创意性。重点评估叙事是否清晰、有吸引力、有传播潜力。

2.可信度(30分):来源权威性+验证信息+专业程度。BSC官方/币安相关来源高分；权威媒体可验证高分；无来源0分。

3.传播力(20分):meme潜力+社交属性+FOMO。具备病毒传播、网络梗、热点话题属性得高分。

4.完整性(15分):信息完整度+多渠道覆盖。多渠道覆盖得分更高。

【评级标准】
- unrated: 内容无法理解代币性质
- low: 有推文但与代币关联极弱（弱关联/无关联），或 有推文但非中英文，或 总分<40，或 内容<15
- mid: 总分40-59或内容15-19（且有足够关联）
- high: 总分≥60且内容≥20（且有足够关联）

【评分示例】
示例1(明确说明):
介绍:币安演示狗币MOONDOGECOIN
→可理解+明确来源→{content:20,credibility:25,virality:8,completeness:5,total:58,category:"mid"}

示例2(无法理解):
推特:@user 已上传下载链接:https://t.co/xxx
介绍:无主之币
→无法理解代币是什么→{category:"unrated",reason:"内容无法说明代币性质"}

示例3(有推文但弱关联-直接low):
代币:宝可梦
内容:个人创业故事文章，仅在开头提到"8岁时在宝可梦热潮期间卖青蛙"
→有推文但关联极弱→{category:"low",reason:"有推文但与代币名称'宝可梦'关联极弱，只在背景中顺便提及，无法支撑代币叙事"}

示例3.5(非中英文推文-直接low):
代币:任意代币
内容:韩文/日文/阿拉伯文等非中英文推文
→非中英文限制传播→{category:"low",reason:"推文非中英文，会极大限制主要用户群体（中文/英文用户）的传播"}

示例4(强关联):
代币:青蛙
内容:童年卖青蛙的创业故事，青蛙是核心主题
→强关联+内容不错→{content:28,credibility:15,virality:18,completeness:6,total:67,category:"high"}

示例5(高质量):
推特:BBC称memecoins为SILLY coins
→权威来源+明确主题→{content:30,credibility:28,virality:18,completeness:8,total:84,category:"high"}

输出JSON(仅JSON无其他内容):
{"reasoning":"2-3句中文说明理由","scores":{"content":0-35,"credibility":0-30,"virality":0-20,"completeness":0-15},"total_score":0-100,"category":"high/mid/low/unrated"}`;
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
    promptVersion: 'V3'
  };
};
