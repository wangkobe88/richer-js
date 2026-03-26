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
import { buildAmazonSection } from './sections/amazon-section.mjs';
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
    amazonInfo = null,
    extractedInfo = null
  } = fetchResults;

  const sections = [];

  // 1. 代币基本信息
  sections.push(`你是代币叙事质量检测器。请判断以下代币是否存在低质量问题。

【代币信息】
- 代币名称：${tokenData.symbol}
- 代币地址：${tokenData.address}`);

  if (extractedInfo.website) sections[0] += `\n- 网站：${extractedInfo.website}`;
  // 不显示intro，避免LLM被intro内容误导判断关联性

  // 2. 账号背景信息
  const backgrounds = generateAccountBackgroundsPrompt(twitterInfo);
  if (backgrounds) sections.push(backgrounds);

  // 3. 推文内容
  const twitterSection = buildTwitterSection(twitterInfo);
  if (twitterSection) sections.push(twitterSection);

  // 4. 网站内容
  const websiteSection = buildWebsiteSection(websiteInfo);
  if (websiteSection) sections.push(websiteSection);

  // 5. Amazon产品内容
  const amazonSection = buildAmazonSection(amazonInfo);
  if (amazonSection) sections.push(amazonSection);

  // 6. 低质量场景判断标准
  sections.push(`【🚨 低质量场景判断标准】

🛑 **前置检查（强制执行，不可跳过）：**

⚠️ **这是第一道关卡，必须严格按照执行：**

步骤1：识别每条推文的核心实体（人名、组织名、产品名、事件名、昵称、称号、概念等）

步骤2：检查代币名是否在推文核心实体中
- **名称匹配不分大小写**：代币名"MEMEFATHER"与推文中的"Memefather"匹配
- **meme币的本质**：meme币就是借助推文中的实体/概念来传播的
  - 示例：推文称Elon Musk为"Memefather"，代币名"MEMEFATHER" → 匹配
  - 示例：推文说"Freedom of speech is good"，代币名"Freedom of speech" → 匹配
  - 示例：推文核心实体是"Duck"，代币名"DUCK" → 匹配

步骤3：根据检查结果执行
- ✅ **如果代币名在任何一条推文的核心实体中出现（不区分大小写）**：
  → **必须立即返回 {"pass": true, "scenario": 0, "reason": "代币名在推文核心实体中"}**
  → **停止分析，不要继续判断后续场景**
- ❌ **如果代币名不在任何推文的核心实体中**：
  → 继续检查8种低质量场景

⛔ **禁止行为**：
- 一旦发现代币名在核心实体中，**绝对不允许**继续判断场景1-8
- 不允许因为"推文内容空洞"、"只是概念"等理由而忽略前置检查结果
- 前置检查通过即pass=true，这是最终结论，不可推翻

【低质量场景列表】

**1. 硬蹭/弱关联**：代币名借用推文中的词汇，但推文主体与代币主体不相关
   - **前提条件**：代币名（不分大小写）不在任何推文的核心实体中
   - **如果前置检查已通过（代币名在核心实体中），绝对不能触发此场景**
   - 示例：所有推文核心实体都是"数字身份证"，代币名是"招财" → 硬蹭
   - 示例：所有推文核心实体都是"利他主义者"、"Netflix"等，没有"CZ" → 硬蹭

**2. 纯谐音梗**：只有谐音关联无实质内容
   - 示例："生菜=生财"、"Duck you=鸭你一拳" → 触发场景2

**3. 泛泛情感概念**：只是借用常见词，且推文**没有具体故事/角色/情节**
   - ⚠️ **关键判断：推文是否有具体的内容？**
   - ✅ **不是泛泛概念**：即使代币名是常见词（如"海豚"、"狗"、"伞"），如果推文有具体角色、情节、故事，则不是泛泛概念
     - 示例：推文"Jeremy the dolphin left the ocean to hunt"，代币名"海豚" → 不是泛泛概念（有具体角色和情节）
     - 示例：推文"THIS NARRATIVE IS INSANELY GOOD..."，代币名"海豚" → 不是泛泛概念（有具体故事描述）
     - 示例：推文"Doge meme viral"，代币名"狗" → 不是泛泛概念（有具体事件）
   - ❌ **是泛泛概念**：推文内容空洞或极少，只有代币名而无其他实质内容
     - 示例：推文只有"遗憾"或"佛系"二字，无其他内容 → 触发场景3
     - 示例：推文只是表达某种情感态度，无具体事件或故事 → 触发场景3
   - **判断标准：推文是否有具体的角色、情节、事件、数据？如果没有，才是泛泛概念**

**4. 大IP蹭热度**：代币名是世界级大IP但缺乏强关联证据
   - 示例：代币名是"特朗普"，但推文只是同名，无本人提及/官方发布 → 触发场景4

**5. 功能性符号/标志**：传播力极弱的符号
   - 示例：紧急出口标志、交通标志等 → 触发场景5

**6. 纯报道热搜**：只报道"XX上热搜/爆火"，无具体叙事内容
   - 示例：推文只是"这个上热搜了"，无具体内容 → 触发场景6

**7. 语言不匹配**：推文语言与代币名称语言不匹配
   - ⚠️ **这是底线问题：语言不匹配 = 无法传播 = 触发场景7**
   - 示例：推文是英语（含"surprise"），代币名是日文"驚き" → 触发场景7
   - 示例：推文是中文，代币名是泰语/韩语等非中英语言 → 触发场景7
   - 理由：目标受众无法理解、无法记住、无法传播不同语言的代币名
   - ⛔ **豁免：中文⇄英文不算语言不匹配**（主体用户中英文都会，可互译）

**8. 纯负面概念**：代币名是纯负面概念，缺乏meme属性
   - ⚠️ **负面概念缺乏正向情感共鸣，用户不愿意传播持有**
   - 示例："失业"、"破产"、"倒闭"、"经济衰退"、"裁员"等 → 触发场景8
   - 示例："暴跌"、"崩盘"、"亏损"等 → 触发场景8
   - 理由：纯粹负面的概念缺乏幽默、讽刺或正向的情感驱动
   - 例外：有讽刺/幽默元素的负面概念（如"躺平"、"佛系"等可自嘲的概念）

【输出格式】

只返回JSON，不要其他内容：

**情况A：前置检查通过（代币名在推文核心实体中）**
{"pass": true, "scenario": 0, "reason": "代币名在推文核心实体中"}

**情况B：前置检查未通过，但8种场景都没触发**
{"pass": true, "scenario": 0, "reason": "无上述低质量场景"}

**情况C：触发低质量场景（scenario必须是1-8）**
{"pass": false, "scenario": 1-8, "reason": "说明理由"}

⚠️ **特别注意场景1的reason格式：**
- 如果选择场景1（硬蹭），reason必须包含：
  1. 有几条推文/语料
  2. 每条推文的核心实体是什么
  3. 为什么代币名不在核心实体中（**注意：已进行不分大小写的匹配检查**）

  示例格式："[1条推文]核心实体：数字身份证；代币名'招财'不在核心实体中（不分大小写）"

- 如果选择其他场景，reason简短说明即可

⚠️ **注意：scenario必须是1-8的数字**`);

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
    reason: result.reason || '',
    scenario: result.scenario || 0
  };
}
