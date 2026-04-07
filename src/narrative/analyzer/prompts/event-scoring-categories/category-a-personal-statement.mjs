/**
 * Stage 2：A类（人物言论类）评分 Prompt
 * V1.0 - 3阶段架构的第二阶段
 *
 * 功能：
 * 1. 分量等级评估（S-E级）
 * 2. 有意义性判断
 * 3. 阻断条件检查
 * 4. 综合评分（基础分 + 权重分 + 时效性分）
 * 5. 推测性质量评估（如存在）
 */

/**
 * Prompt版本号
 */
export const CATEGORY_A_PROMPT_VERSION = 'V1.0';

/**
 * 构建A类（人物言论类）评分Prompt
 * @param {Object} eventDescription - Stage 1输出的事件描述
 * @param {Object} eventClassification - Stage 1输出的分类结果
 * @returns {string} A类评分Prompt
 */
export function buildCategoryAPrompt(eventDescription, eventClassification) {
  return `你是A类（人物言论类）事件评分专家。

【事件描述】
主题：${eventDescription.eventTheme}
主体：${eventDescription.eventSubject}
是否超大IP：${eventDescription.isLargeIP}
事件内容：${eventDescription.eventContent}
时效性：${eventDescription.eventTiming}
关键实体：${eventDescription.keyEntities?.join(', ') || '无'}
关键数据：${JSON.stringify(eventDescription.keyData || {})}

【分类信息】
主类别：${eventClassification.primaryCategory}
类别名称：${eventClassification.primaryCategoryName}
置信度：${eventClassification.confidence}

╔══════════════════════════════════════════════════════════════════════════════╗
║                     A类：人物言论类评分框架                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝

【分析目标】
基于Stage 1的事件描述，评估A类（人物言论类）事件的传播潜力。

═══════════════════════════════════════════════════════════════════════════════

📋 **第一步：分量等级评估**（S-E级）

**【S级分量】**：何一、CZ、Elon、Trump等世界级人物的公开发言
- 基础分数：40分

**【A级分量】**：知名KOL（粉丝>100万）或知名公众人物的言论
- 基础分数：32分

**【B级分量】**：普通KOL（粉丝>10万）的言论
- 基础分数：24分

**【C级分量】**：普通人的言论、日常表达
- 基础分数：12分

**【D级分量】**：无意义的表情、点赞、"hi"等
- 基础分数：5分

**【E级分量】**：完全无内容的表达
- 基础分数：0分

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 **第二步：有意义性判断**

**【S/A级】** → ✓✓✓有意义（世界级/知名人物言论本身就是新闻）
**【B级】** → ✓✓有意义（KOL言论有社交价值）
**【C级】** → 条件性有意义（需要特别有观点/有数据支撑）
**【D/E级】** → ✗无意义

⚠️ **D/E级分量直接阻断**，无需继续评分。

═══════════════════════════════════════════════════════════════════════════════

📋 **第三步：硬性阻断条件检查**

**1. 言论性质阻断**：
- 纯营销/喊单（推广、广告、买币建议）
- 日常废话/流水账（今天天气好、早上好、吃了饭）
- 纯转发/搬运（只是转发别人内容，无原创观点）
- 无观点的互动（只是"赞"、"转了"、表情）

**2. 内容性质阻断**：
- 纯通识知识/百科内容（只是讲述已有知识/事实，无个人观点）
- 极度小众/无关紧要的个人细节（绰号、外号、童年、爱好等）

**3. 情感性质阻断**：
- 纯负面/愤怒言论（无幽默/讽刺/自嘲元素）
- 豁免：同情/保护类言论（动物保护、弱势群体关怀）

⚠️ **触发任一阻断条件 → pass=false**

═══════════════════════════════════════════════════════════════════════════════

📋 **第四步：综合评分**

总分 = 基础分 + 信息源权重 + 时效性加分

**【A-3 基础分数】**（基于第一步分量等级）：
- S级 → 40分
- A级 → 32分
- B级 → 24分
- C级 → 12分
- D级 → 5分
- E级 → 0分

**【A-4 信息源权重】**（0-30分）：
- 世界级IP（何一、CZ、Elon、Trump）：30分
- 知名KOL/认证大V（粉丝>100万）：25-28分
- 普通KOL（粉丝>10万）：15-20分
- 普通账号（有具体内容）：10-15分
- 新账号/小号（粉丝<1000）：8-12分（⚠️不因粉丝少而过度扣分，看内容质量）

**【A-5 时效性加分】**（0-20分）：
- 近期事件（7天内）：+15分
- 中期事件（30天内）：+10分
- 远期事件（超过30天）：0分
- 预期事件（未来）：30天内+10分，超过30天+5分

**【A-6 示例】**：
- "何一发推'hi'" → S级(40) + 世界级IP(30) + 近期(15) = 85分
- "某普通KOL发推'hi'" → C级(12) + 普通KOL(15) + 近期(15) = 42分（有意义性：无额外支撑 → 可能无意义）

═══════════════════════════════════════════════════════════════════════════════

【输出格式】

**只返回JSON，不要其他内容**：

**D/E级分量（无意义）**：
{
  "pass": false,
  "blockReason": "事件无意义（D/E级分量）",
  "magnitudeLevel": "D/E",
  "categoryAnalysis": null
}

**触发阻断条件**：
{
  "pass": false,
  "blockReason": "具体阻断条件（如：纯营销/喊单）",
  "magnitudeLevel": "分量等级",
  "categoryAnalysis": null
}

**通过评分**：
{
  "pass": true,
  "blockReason": null,
  "categoryAnalysis": {
    "category": "A",
    "categoryName": "人物言论类",
    "magnitudeLevel": "S/A/B/C",
    "magnitudeScore": 40,
    "weightScore": 30,
    "timelinessScore": 15,
    "totalScore": 85,
    "meaningfulness": "有意义/条件性有意义/无意义",
    "meaningfulnessReason": "有意义性的判断理由"
  },
  "blockChecks": {
    "hardBlocks": [],
    "softBlocks": [],
    "passedChecks": ["言论性质检查", "内容性质检查", "情感性质检查"]
  }
}

⚠️ **评分建议**：
- totalScore ≥ 60 → 建议通过
- totalScore < 60 → 建议返回low
`;
}
