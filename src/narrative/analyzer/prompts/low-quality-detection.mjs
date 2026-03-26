/**
 * Stage 1: 低质量检测Prompt
 * 聚焦8种低质量场景的判断
 *
 * V8.6 - 修复超大IP硬蹭未拦截问题
 * - 对于超大IP（CZ/Elon/Trump等），必须有具体事件描述
 * - 只是账号/网站数据不算有事件，应触发硬蹭检查
 * - 前置检查增加事件要求：超大IP必须基于具体事件
 *
 * V8.5 - 修复"HY"硬蹭CZ未拦截问题
 * - 明确前置检查只做精确字符串匹配，不做推理或联想
 * - 拼音首字母缩写不算匹配（HY vs CZ → 触发硬蹭）
 * - 新增反面示例：拼音缩写、英文缩写、推理关联、行业关联都不算匹配
 *
 * V8.4 - 修复LLM执行逻辑混乱问题
 * - 强化"立即停止分析"指令，防止LLM在发现匹配后继续推理
 * - 明确"任何匹配都是有效匹配"，不论代币名在语料中如何出现
 * - 修复"ASTERCLAN"匹配"asterclan"但仍被判定为硬蹭的问题
 *
 * V8.3 - 修复中英文对应匹配问题
 * - 前置检查明确说明：中英文翻译/对应也算匹配
 * - 示例：代币名"东莞崇英学校"与"Dongguan Chongying School"匹配
 * - 修复"代币名是中文，实体是英文翻译"被误判为硬蹭的问题
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

⚠️ **加密圈常见缩写（必须识别为核心实体）**：
- **CZ** = Changpeng Zhao（币安创始人）
- **SBF** = Sam Bankman-Fried（FTX创始人）
- **ELON** = Elon Musk（Tesla/Twitter创始人）
- **MUSK** = Elon Musk
- **TRUMP** = Donald Trump（美国总统）
- **BIDEN** = Joe Biden（美国总统）
- **何一** = 币安联合创始人
- **V神** / **Vitalik** = Vitalik Buterin（以太坊创始人）
⚠️ **这些缩写在推文中出现时，必须识别为核心实体，不能忽略！**

⚠️ **超大IP列表**：CZ、何一、SBF、Elon/Musk、Trump、拜登、V神/Vitalik

⚠️ **这是第一道关卡，必须严格按照执行：**

步骤1：**分别列出每条语料的核心实体**（人名、组织名、产品名、事件名、昵称、称号、概念、书籍名、缩写等）
- ⚠️ **必须输出完整的实体列表**，用于验证是否正确识别加密圈实体
- ⚠️ **实体列表必须去重**：相同的实体只列出一次
  - 示例：推文中多次出现"Billy"，entities中只需列出一个"Billy"
  - 示例：推文中多次出现"Billy the Cat"，entities中只需列一个"Billy the Cat"
- 推文、Website、Amazon要**分别列出**
- **书籍标题/产品名称是核心实体的一部分**，必须列出
- ⚠️ **中文名称必须列出**：如果语料中同时出现中英文名称，两者都要列出
  - 示例：推文有"东莞崇英学校"和"Dongguan Chongying School"，两个都要列出
  - 示例：推文有"CZ"和"Changpeng Zhao"，两个都要列出

步骤2：检查代币名是否在**任何语料（推文/Website/Amazon）**的核心实体中
- ⚠️ **只做精确字符串匹配，不做推理或联想**
- **名称匹配不分大小写**：代币名"MEMEFATHER"与语料中的"Memefather"匹配
- **中英文对应才算匹配**：代币名"东莞崇英学校"与语料中的"Dongguan Chongying School"匹配
- **meme币的本质**：meme币就是借助语料中的实体/概念来传播的
  - 示例：推文称Elon Musk为"Memefather"，代币名"MEMEFATHER" → 匹配
  - 示例：Amazon书籍标题"Freedom of speech"，代币名"Freedom of speech" → 匹配
  - 示例：Website核心实体是"Dongguan Chongying School"，代币名"东莞崇英学校" → 匹配（中英文对应）
  - 示例：Website核心实体是"Duck"，代币名"DUCK" → 匹配
  - 示例：推文说"饰演CZ"，代币名"CZ" → 匹配（CZ是加密圈核心人物）

⛔ **以下情况不算匹配（必须触发硬蹭检查）：**
- **拼音首字母缩写**：代币名"HY"（何一拼音首字母）vs 实体"CZ" → 不匹配，触发场景1
- **英文单词缩写**：代币名"CM"（Community Manager缩写）vs 实体"Community Manager" → 不匹配，触发场景1
- **推理关联**：代币名"Binance CEO"vs 实体"CZ" → 不是精确匹配，触发场景1
- **行业关联**：代币名"Crypto"vs 实体"Bitcoin" → 不是精确匹配，触发场景1

步骤3：根据检查结果执行
- ✅ **如果代币名在任何语料（推文/Website/Amazon）的核心实体中出现（不区分大小写）**：
  → **但需检查是否基于具体事件**（仅针对超大IP）
  - **超大IP**：CZ、何一、SBF、Elon/Musk、Trump、拜登、V神/Vitalik
  - **如果是超大IP**：必须有具体事件描述（电影发布、推文内容、政策发布等）
    - ✅ **有具体事件**：Netflix宣布拍CZ电影、Trump发布新政、Elon发布产品 → 通过
    - ❌ **只是账号/网站**：只提@cz_binance、只是CZ的官网链接、只是推特账号名 → 触发场景1（硬蹭）
  - **如果不是超大IP**：只要名称匹配即可，无需事件要求
  → **立即停止分析，直接返回 {"pass": true, "scenario": 0, "reason": "代币名在核心实体中"}**
  → **不要继续推理，不要考虑其他因素，不要判断后续场景**
  → **这是最终结论，不可推翻**
- ❌ **如果代币名不在任何语料的核心实体中**：
  → 继续检查8种低质量场景

⛔ **禁止行为**：
- 一旦发现代币名在核心实体中且满足事件要求，**立即停止分析，直接返回pass=true**
- **绝对不允许**在发现匹配后继续推理或判断场景1-8
- 不允许因为"只是logo名字"、"被提及"等理由而忽略匹配结果
- **任何匹配都是有效匹配**，不论代币名在语料中是如何出现的
- **书籍标题匹配代币名 = 强关联**，属于前置检查通过，不是"硬蹭"
- **中英文对应也算匹配**：代币名"东莞崇英学校"与"Dongguan Chongying School"是匹配的
- ⚠️ **超大IP必须有具体事件**：CZ/Elon/Trump等必须有事件描述，只是账号/网站不算
- 前置检查通过即pass=true，这是最终结论，不可推翻

【低质量场景列表】

**1. 硬蹭/弱关联**：代币名借用语料中的词汇，但语料主体与代币主体不相关
   - **前提条件**：
     - 代币名（不分大小写）不在任何语料（推文/Website/Amazon）的核心实体中
     - **或者**：代币名是超大IP（CZ/Elon/Trump等）但**没有具体事件描述**
   - **如果前置检查已通过（代币名在核心实体中且有具体事件），绝对不能触发此场景**
   - **超大IP硬蹭判定**：
     - 示例：代币名"CZ"，语料只有@cz_binance账号或CZ官网链接 → 硬蹭（无具体事件）
     - 示例：代币名"Elon"，语料只有@elonmusk账号或Tesla官网 → 硬蹭（无具体事件）
   - **普通硬蹭判定**：
     - 示例：所有语料核心实体都是"数字身份证"，代币名是"招财" → 硬蹭
     - 示例：所有语料核心实体都是"利他主义者"、"Netflix"等，没有"CZ" → 硬蹭

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

**情况A：前置检查通过（代币名在核心实体中）**
{"pass": true, "scenario": 0, "reason": "代币名在核心实体中", "entities": {"tweet1": ["实体1", ...], "quoted_tweet": [...], "website": [...], "amazon": [...]}}

**情况B：前置检查未通过，但8种场景都没触发**
{"pass": true, "scenario": 0, "reason": "无上述低质量场景", "entities": {...}}

**情况C：触发低质量场景（scenario必须是1-8）**
{"pass": false, "scenario": 1-8, "reason": "说明理由", "entities": {...}}

⚠️ **entities字段必须包含每条语料的核心实体列表**：
- "tweet1": 主推文的实体列表
- "quoted_tweet": 引用推文的实体列表（如果有）
- "website_tweet": Website推文的实体列表（如果有）
- "website": Website内容的实体列表（如果有）
- "amazon": Amazon内容的实体列表（如果有）

⚠️ **特别注意场景1的reason格式：**
- 如果选择场景1（硬蹭），reason必须包含：
  1. 有几条语料
  2. 每条语料的核心实体是什么
  3. 为什么代币名不在核心实体中（**注意：已进行不分大小写+中英文对应的匹配检查**）

  示例格式："[1条推文]核心实体：Giggle Academy；代币名'XYZ'不在核心实体中（已检查中英文对应）"

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
