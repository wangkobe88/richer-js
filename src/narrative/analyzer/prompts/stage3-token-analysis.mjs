/**
 * Stage 3：代币分析 Prompt
 * V17.1 - 3阶段架构的第三阶段
 *
 * 功能：
 * 1. 代币-事件关联性评估
 * 2. 代币质量评估
 * 3. 综合评分（事件60% + 关联20% + 质量20%）
 *
 * V17.1 修改：
 * - 添加关联性底线：关联性得分≤10分（弱语义/弱文化）直接返回low
 * - 添加泛化概念规则：极度泛化的概念（金钱、自由、成功等）不构成有效关联
 *
 * 输入：
 * - Stage 1 的事件描述和分类结果
 * - Stage 2 的分类评分结果
 * - 不包含原始语料
 */

/**
 * Prompt版本号
 */
export const STAGE3_TOKEN_ANALYSIS_PROMPT_VERSION = 'V17.1';

/**
 * 构建Stage 3代币分析Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} stage1Output - Stage 1输出的事件预处理结果
 * @param {Object} stage2Output - Stage 2输出的分类评分结果
 * @returns {string} 代币分析Prompt
 */
export function buildStage3TokenAnalysisPrompt(tokenData, stage1Output, stage2Output) {
  const symbol = tokenData.symbol || '';
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
  const chainName = (tokenData.blockchain || tokenData.platform || 'BSC').toUpperCase();

  return `你是代币分析专家。请基于前两个阶段的分析结果，评估代币与事件的关联性及其传播潜力。

【代币信息】
- 代币Symbol：${symbol}${tokenName ? ` (${tokenName})` : ''}
- 代币地址：${tokenData.address}
- 所属链：${chainName}${chainName === 'BSC' ? '（币安智能链）' : ''}

═══════════════════════════════════════════════════════════════════════════════

📋 **Stage 1：事件预处理结果**

${stage1Output?.pass ? '✅ 通过' : '❌ 未通过'}
${stage1Output?.reason ? `原因：${stage1Output.reason}` : ''}

【事件描述】
- 主题：${stage1Output?.eventDescription?.eventTheme || '未知'}
- 主体：${stage1Output?.eventDescription?.eventSubject || '未知'}
- 事件内容：${stage1Output?.eventDescription?.eventContent || '无详细描述'}
- 时效性：${stage1Output?.eventDescription?.eventTiming || '未知'}
- 关键实体：${stage1Output?.eventDescription?.keyEntities?.join(', ') || '无'}
- 关键数据：${JSON.stringify(stage1Output?.eventDescription?.keyData || {})}

【事件分类】
- 主类别：${stage1Output?.eventClassification?.primaryCategory || '未知'}（${stage1Output?.eventClassification?.primaryCategoryName || ''}）
- 可能类别：${stage1Output?.eventClassification?.possibleCategories?.join(', ') || '无'}
- 置信度：${stage1Output?.eventClassification?.confidence || '未知'}

【性质标记】
${stage1Output?.propertyMarkers ? `
- 推测性：${stage1Output.propertyMarkers.speculative ? '是' : '否'}${stage1Output.propertyMarkers.speculativeReason ? `（${stage1Output.propertyMarkers.speculativeReason}）` : ''}
- 发现型：${stage1Output.propertyMarkers.discovery ? '是' : '否'}${stage1Output.propertyMarkers.discoveryReason ? `（${stage1Output.propertyMarkers.discoveryReason}）` : ''}
- 营销性：${stage1Output.propertyMarkers.marketing ? '是' : '否'}${stage1Output.propertyMarkers.marketingReason ? `（${stage1Output.propertyMarkers.marketingReason}）` : ''}
` : '- 无性质标记'}

═══════════════════════════════════════════════════════════════════════════════

📋 **Stage 2：分类评分结果**

${stage2Output?.raw?.pass ? '✅ 通过' : '❌ 未通过'}
${stage2Output?.raw?.blockReason ? `阻断原因：${stage2Output.raw.blockReason}` : ''}

【分类分析】
- 类别：${stage2Output?.raw?.categoryAnalysis?.category || '未知'}（${stage2Output?.raw?.categoryAnalysis?.categoryName || ''}）
- 分量等级：${stage2Output?.raw?.categoryAnalysis?.magnitudeLevel || '未知'}
- 基础分数：${stage2Output?.raw?.categoryAnalysis?.magnitudeScore || 0}
- 权重分数：${stage2Output?.raw?.categoryAnalysis?.weightScore || 0}
- 时效性分数：${stage2Output?.raw?.categoryAnalysis?.timelinessScore || 0}
- **总分**：${stage2Output?.raw?.categoryAnalysis?.totalScore || 0}/100

【阻断检查】
- 触发的阻断：${stage2Output?.raw?.blockChecks?.hardBlocks?.join(', ') || '无'}
- 通过的检查：${stage2Output?.raw?.blockChecks?.passedChecks?.join(', ') || '无'}

╔══════════════════════════════════════════════════════════════════════════════╗
║                           Stage 3：代币分析框架                                ║
╚══════════════════════════════════════════════════════════════════════════════╝

【分析目标】
1. 判断代币与事件是否存在有效关联
2. 评估代币质量
3. 综合评分（事件60% + 关联20% + 质量20%）

═══════════════════════════════════════════════════════════════════════════════

📋 **第一步：代币-事件关联性检查**

**1.1 精确匹配检查**（16-20分）

判断代币名（Symbol/Name）是否与事件中的核心实体精确匹配：

**匹配层级**：
- **完全匹配**（20分）：代币名 = 核心实体名称
  - 示例：代币" CZ "，事件主体"CZ"
  - 示例：代币" BINANCE "，事件主体"Binance"
  - 示例：代币" ELON "，事件主体"Elon Musk"

⚠️ **代币即产品匹配**：
如果事件分类为B类（产品发布）或D类（机构动作），且代币名（Symbol/Name）与eventContent中描述的产品名/项目名一致 → 视为"完全匹配"（20分）
  - 示例：代币Symbol"Gift"，eventContent描述"Gift是首个链上支持支付捐赠的合约" → 完全匹配（20分）
  - 示例：代币Name"Giftily"，eventContent描述"Giftily项目上线" → 完全匹配（20分）

- **中英文对应**（18分）：代币名与核心实体是中英文对应
  - 示例：代币" 币安 "，事件主体"Binance"
  - 示例：代币" 赵长鹏 "，事件主体"CZ"

- **缩写匹配**（16分）：代币名是核心实体的常见缩写
  - 示例：代币" CZ "，事件主体"Changpeng Zhao"
  - 示例：代币" BNB "，事件主体"Binance"

**1.2 语义关联检查**（10-15分）

如果精确匹配失败，判断是否存在语义关联：

- **强语义关联**（15分）：代币名与事件有明确的语义关联
  - 示例：代币" 48H "，事件"CZ提到48小时"
  - 示例：代币" FREEDOM "，事件"CZ出狱"

- **中等语义关联**（12分）：代币名与事件有间接语义关联
  - 示例：代币" MOON "，事件"Elon Musk提到登月"

- **弱语义关联**（10分）：代币名与事件有关联但不够明确
  - 示例：代币" WIN "，事件"某次比赛获胜"

**1.3 文化关联检查**（0-9分）

如果精确和语义都失败，判断是否存在文化关联：

- **强文化关联**（9分）：代币名与事件有明确的文化关联
  - 示例：代币" PEPE "，事件"网络青蛙梗"

- **中等文化关联**（6分）：代币名与事件有一定文化关联
  - 示例：代币" DOGE "，事件"狗币相关讨论"

- **弱文化关联**（3分）：代币名与事件关联较弱
  - 示例：代币" MEME "，事件"某个网络梗"

⚠️ **关联性底线（最高优先级规则，覆盖下方所有分类标准）**：
- **如果关联性得分 ≤ 10分**（弱语义关联或以下）→ **category必须填"low"**，即使总分计算结果落入mid或high区间
- 这条规则优先级最高，不可被总分覆盖
- **泛化概念不构成有效关联**：如果代币名是"金钱"、"自由"、"成功"、"赚钱"、"好运"等极度泛化的概念，这些词几乎可以关联到任何加密货币事件，不构成有效关联
  - 示例：代币"金钱自由"，事件"CZ分享《Go Live》书中BNB上线经历" → "金钱"与"BNB交易"的关系太泛化，不构成有效关联 → 应判为弱语义关联或无关联 → 返回low
  - 示例：代币"自由"，事件"CZ出狱" → "自由"与"出狱"的语义关联明确且具体 → 可判为强语义关联（15分），不触发底线

═══════════════════════════════════════════════════════════════════════════════

📋 **第二步：代币质量检查**

**2.1 长度评分**（0-8分）

- 中文：1-3字8分，4-6字5-7分，7-10字2-4分，>10字0-1分
- 英文：1词8分，2-3词5-7分，4词2-4分，>4词0-1分

**2.2 拼写/可读性评分**（0-7分）

- 完全正确、易读：7分
- 有小错误但可理解：5-6分
- 错误较多、难读：2-4分
- 完全无法理解：0分

**2.3 名称合理性评分**（0-5分）

- 名称合理、有意义：5分
- 名称一般：3-4分
- 名称奇怪、不合理：1-2分
- 名称完全不合理：0分

═══════════════════════════════════════════════════════════════════════════════

📋 **第三步：综合评分**

**计算公式**：
- 事件分 = Stage 2总分 × 60%（权重0.6）
- 关联分 = 第一步关联性得分（满分20，直接计入）
- 质量分 = 第二步质量得分（满分20，直接计入）
- **总分 = 事件分 + 关联分 + 质量分**

**示例**：
- 事件分：85 × 0.6 = 51
- 关联分：20（精确匹配，满分直接计入）
- 质量分：15（质量较高）
- **总分 = 51 + 20 + 15 = 86**

⚠️ **重要提示**：
- 关联分和质量分已经是最终得分（满分20），不要乘以权重
- breakdown 中填写的 relevanceScore 和 qualityScore 应该是最终得分（如20、15等），不是乘以权重后的值

═══════════════════════════════════════════════════════════════════════════════

【输出格式】

**只返回JSON，不要其他内容**：

{
  "category": "high/mid/low",
  "reasoning": "详细推理过程",
  "scores": {
    "credibility": 事件分,
    "virality": 关联分 + 质量分
  },
  "total_score": 总分,
  "relevanceScore": 关联分,
  "qualityScore": 质量分,
  "breakdown": {
    "eventScore": Stage2原始总分（未乘权重，如85）,
    "eventWeight": 0.6,
    "relevanceScore": 关联分最终得分（满分20，如20、18、15等，不要乘以权重）,
    "relevanceWeight": 0.2,
    "qualityScore": 质量分最终得分（满分20，如18、15、12等，不要乘以权重）,
    "qualityWeight": 0.2
  }
}

**分类标准（按优先级从高到低）**：
1. **关联性底线（最高优先级）**：如果第一步关联性得分 ≤ 10分 → category必须为"low"，无视总分
2. 然后才按总分分类：
   - total_score ≥ 70 → "high"
   - 50 ≤ total_score < 70 → "mid"
   - total_score < 50 → "low"

⚠️ **常见错误**：关联性=0分但category填"mid"——这是错误的！关联性≤10分时category必须是"low"。
`;
}
