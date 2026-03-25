/**
 * Stage 1: 低质量检测Prompt
 * 聚焦8种低质量场景的判断
 *
 * V8.0 - 两阶段架构的第一阶段
 * - 只做二元判断：pass（继续）或 low（终止）
 * - Prompt简洁，提高一致性
 */

import { buildTwitterSection } from './sections/twitter-section.mjs';
import { buildWebsiteSection } from './sections/website-section.mjs';
import { generateAccountBackgroundsPrompt } from './account-backgrounds.mjs';

/**
 * 构建Stage 1低质量检测Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的数据结果
 * @returns {string} Stage 1 Prompt
 */
export function buildLowQualityDetectionPrompt(tokenData, fetchResults) {
  const {
    twitterInfo = null,
    websiteInfo = null,
    extractedInfo = null
  } = fetchResults;

  const sections = [];

  // 1. 代币基本信息
  sections.push(`你是代币叙事质量检测器。请判断以下代币是否存在低质量问题。

【代币信息】
- 代币名称：${tokenData.symbol}
- 代币地址：${tokenData.address}`);

  if (extractedInfo.intro_en) sections[0] += `\n- 介绍（英文）：${extractedInfo.intro_en}`;
  if (extractedInfo.intro_cn) sections[0] += `\n- 介绍（中文）：${extractedInfo.intro_cn}`;
  if (extractedInfo.website) sections[0] += `\n- 网站：${extractedInfo.website}`;

  // 2. 账号背景信息
  const backgrounds = generateAccountBackgroundsPrompt(twitterInfo);
  if (backgrounds) sections.push(backgrounds);

  // 3. 推文内容
  const twitterSection = buildTwitterSection(twitterInfo);
  if (twitterSection) sections.push(twitterSection);

  // 4. 网站内容
  const websiteSection = buildWebsiteSection(websiteInfo);
  if (websiteSection) sections.push(websiteSection);

  // 5. 低质量场景判断标准
  sections.push(`【🚨 低质量场景判断标准】

请检查以下8种低质量场景。**如果触发任何一种，返回 pass=false，并说明原因。**

**1. 硬蹭/弱关联**：代币名借用推文中的词汇，但推文主体与代币主体不相关
   - ⚠️ **必须区分：直接引用核心概念 vs 硬蹭**
   - ✅ **不是硬蹭（强关联）**：代币名直接引用推文中的核心产品/服务/概念名称
     - 示例：推文"微博首个AI才能发帖的超话#硅基茶水间"，代币名"硅基茶水间" → 强关联
     - 示例：推文"AgentPay SDK发布"，代币名"AgentPay" → 强关联
     - 示例：推文"币安VIP升级"，代币名"币安VIP" → 强关联
     - **判断依据：代币名是否与推文中的事件/产品/服务的名称完全一致？**
     - **💡 重要规则：如果代币名与推文中的话题/产品/功能名称完全匹配（如#话题名），则不是硬蹭！**
   - ❌ **是硬蹭（弱关联）**：代币名只是借用推文中的词汇，说的不是同一件事
     - 示例：推文"绿水青山"（风景话题），代币名"绿水青山就是金山银山" → 硬蹭
     - 示例：推文"AI创作比赛获奖"，代币名"AImeme" → 硬蹭（推文说比赛，代币说AI meme概念）
     - 示例：推文只是"Cute 🥰"，代币名某个不相关的词 → 硬蹭
   - **判断标准：推文的核心主体是什么？代币名的核心主体是什么？两者是否在同一件事上？**

**2. 纯谐音梗**：只有谐音关联无实质内容
   - 示例："生菜=生财"、"Duck you=鸭你一拳" → pass=false

**3. 泛泛情感概念**：只是借用常见词，且推文**没有具体故事/角色/情节**
   - ⚠️ **关键判断：推文是否有具体的内容？**
   - ✅ **不是泛泛概念**：即使代币名是常见词（如"海豚"、"狗"、"伞"），如果推文有具体角色、情节、故事，则不是泛泛概念
     - 示例：推文"Jeremy the dolphin left the ocean to hunt"，代币名"海豚" → 不是泛泛概念（有具体角色和情节）
     - 示例：推文"Doge meme viral"，代币名"狗" → 不是泛泛概念（有具体事件）
   - ❌ **是泛泛概念**：推文内容空洞或极少，只有代币名而无其他实质内容
     - 示例：推文只有"遗憾"或"佛系"二字，无其他内容 → pass=false
     - 示例：推文只是表达某种情感态度，无具体事件或故事 → pass=false
   - **判断标准：推文是否有具体的角色、情节、事件、数据？如果没有，才是泛泛概念**

**4. 大IP蹭热度**：代币名是世界级大IP但缺乏强关联证据
   - 示例：代币名是"特朗普"，但推文只是同名，无本人提及/官方发布 → pass=false

**5. 功能性符号/标志**：传播力极弱的符号
   - 示例：紧急出口标志、交通标志等 → pass=false

**6. 纯报道热搜**：只报道"XX上热搜/爆火"，无具体叙事内容
   - 示例：推文只是"这个上热搜了"，无具体内容 → pass=false

**7. 语言不匹配**：推文语言与代币名称语言不匹配
   - ⚠️ **这是底线问题：语言不匹配 = 无法传播 = pass=false**
   - 示例：推文是英语（含"surprise"），代币名是日文"驚き" → pass=false
   - 示例：推文是中文，代币名是泰语/韩语等非中英语言 → pass=false
   - 理由：目标受众无法理解、无法记住、无法传播不同语言的代币名
   - ⛔ **豁免：中文⇄英文不算语言不匹配**（主体用户中英文都会，可互译）

**8. 纯负面概念**：代币名是纯负面概念，缺乏meme属性
   - ⚠️ **负面概念缺乏正向情感共鸣，用户不愿意传播持有**
   - 示例："失业"、"破产"、"倒闭"、"经济衰退"、"裁员"等 → pass=false
   - 示例："暴跌"、"崩盘"、"亏损"等 → pass=false
   - 理由：纯粹负面的概念缺乏幽默、讽刺或正向的情感驱动
   - 例外：有讽刺/幽默元素的负面概念（如"躺平"、"佛系"等可自嘲的概念）

【输出格式】

只返回JSON，不要其他内容：

**如果通过检查（8种情况都没触发）：**
{"pass": true, "reason": ""}

**如果触发低质量场景：**
{"pass": false, "reason": "具体原因（如：硬蹭：推文主体为风景话题，代币名为标语，两者主体不相关）"}`);

  return sections.filter(s => s).join('\n\n');
}

/**
 * 解析Stage 1响应
 * @param {string} content - LLM响应内容
 * @returns {Object} 解析结果 { pass: boolean, reason: string }
 */
export function parseStage1Response(content) {
  let jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Stage 1: 无法提取JSON');
  }

  const result = JSON.parse(jsonMatch[0]);
  if (typeof result.pass !== 'boolean') {
    throw new Error('Stage 1: pass字段必须是boolean');
  }

  return {
    pass: result.pass,
    reason: result.reason || ''
  };
}
