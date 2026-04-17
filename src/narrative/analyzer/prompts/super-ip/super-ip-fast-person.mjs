/**
 * 超大IP快速通道 — 人物类（C类）Prompt
 *
 * 维度二：内容meme潜力（0-30分）
 * 阻断条件：纯营销/喊单、纯转发、日常废话、无观点互动、纯负面言论
 * S级人物豁免：简单发言不触发"内容无意义"阻断，由评分决定结果
 */

import {
  SUPER_IP_FAST_PROMPT_VERSION,
  shouldIncludeBrandHijackCheck,
  buildTruncationRules,
  buildDataSections,
  buildBrandHijackSection,
  buildCommonHeader,
  buildCommonTokenSection,
} from './super-ip-fast-shared.mjs';

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

  // 品牌劫持预检
  const includeBrandCheck = shouldIncludeBrandHijackCheck(symbol, tokenName);
  const brandSection = includeBrandCheck ? buildBrandHijackSection('person') : '';
  const truncationRules = buildTruncationRules(includeBrandCheck);

  // 共用头部
  const header = buildCommonHeader(
    ipInfo, preScores, tokenData,
    buildDataSections(fetchResults),
    'C类（人物言论/动作）'
  );

  // C类专用：内容meme潜力 + 阻断条件
  const dimension2Section = buildPersonDimension2(ipInfo);
  const blockingSection = buildPersonBlocking(ipInfo);

  // 共用代币评估段落
  const tokenSection = buildCommonTokenSection(ipInfo, brandSection, truncationRules, preScores);

  return `你是叙事分析专家，快速评估基于知名人士推文的meme代币。

╔══════════════════════════════════════════════════════════════════════════════╗
║              超大IP快速通道 — C类（人物言论/动作）                               ║
╚══════════════════════════════════════════════════════════════════════════════╝

${header}

${dimension2Section}

${blockingSection}

${tokenSection}`;
}

/**
 * 构建C类维度二：内容meme潜力
 */
function buildPersonDimension2(ipInfo) {
  return `**任务一：内容meme潜力评估（维度二，0-30分）**

评估推文内容本身的传播潜力（不是代币名的好坏）。

🎯 **meme币的本质**：需要社区共识和持续传播。核心看事件内容是否能引发社区广泛传播和讨论。

**评分标准**：

1. **口号性**（25-30分）：简短有力、朗朗上口、可被社区反复使用
   - 示例："We make impact"、"Everything is number"

2. **独特概念/新造词**（20-28分）：提出了独特的概念或词汇（包括讽刺/幽默性质的）
   - 示例：CZ回应SEC争议事件引发的新概念
   - 示例：Musk创造"Cuck Olympics"（讽刺性新造词）→ 典型独特概念/新造词
   - ⚠️ 讽刺/调侃 ≠ 日常闲聊：只要创造了新的、可传播的概念/词汇，就是"独特概念/新造词"

3. **数字/日期叙事**（20-28分）：具体数字/日期成为事件核心记忆点
   - 示例：CZ书中提到"第48页"被社区提取为"48"叙事

4. **CZ/何一/币安高管的互动/回复潜力**（25-30分）：
   - 对CZ/何一/币安的认同、致敬、情感表达，可能引发其回复/转发
   - 发现/引用了CZ/何一/币安说过的有趣/有影响力的话

5. **争议/话题性**（20-28分）：引发讨论、有争议空间

6. **形象化/故事性**（15-25分）：有画面感、有故事线

**不满足以上任何维度**（0-7分）：日常闲聊、纯产品提及、礼节性表达
- 示例：CZ回复"哪数的过来"(3分)、"Insta360自拍杆"(2分)、"Happy New Year"(1分)
- 示例：CZ发推"hi"(2分，纯问候，S级不阻断但分数极低)`;
}

/**
 * 构建C类阻断条件（与C类V3.1对齐）
 */
function buildPersonBlocking(ipInfo) {
  const isSTier = ipInfo.tier === 'S';

  return `**任务二：阻断检查**

⚠️ 以下情况直接阻断（pass=false），不再继续评估：

1. **内容完全无意义**：
   - 纯表情/纯符号："🚀🚀🚀"、"❤️"、纯点赞
   - 纯名称 + 修饰词/表情："XX牛逼"、"buy XX"、"XX 🚀"
   - 纯问候/感叹："hi"、"hello"、"Happy New Year"（除非发言者是S级 → 见下方豁免）
   - 理由：零meme潜力，不可能成为叙事

2. **纯营销/喊单**：推广、广告、买币建议等纯商业行为
   - ${isSTier ? '⚠️ S级人物的营销豁免：如果是本人营销内容，且内容本身有一定话题性/meme潜力 → 不阻断（由评分决定）' : 'A级人物营销不豁免'}

3. **纯负面/敌对言论**：无幽默/讽刺/自嘲元素的纯负面言论
   - 豁免：同情/保护类言论（动物保护、弱势群体关怀）

⚠️ **S级人物豁免**（${isSTier ? '当前账号为S级，适用此豁免' : '当前账号为A级，不适用此豁免'}）：
- ${isSTier ? 'S级人物的简单发言**不触发阻断条件1（内容完全无意义）**，由评分决定结果。理由：S级的任何发言都有传播价值（会被媒体报道、社区讨论）' : 'A级人物不享受此豁免'}
- ${isSTier ? '示例：CZ发推"hi" → 不阻断，但meme潜力给0-3分 → S级(40) + meme(2) + 近期(15) = 57 → 事件分57×0.6=34.2 + 关联性 + 质量 → 由总分决定' : ''}
- ${isSTier ? '示例：CZ回复"哪数的过来" → 不阻断，但meme潜力给3分 → 由总分决定' : ''}`;
}
