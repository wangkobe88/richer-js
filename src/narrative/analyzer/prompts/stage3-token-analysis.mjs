/**
 * Stage 3：代币分析 Prompt
 * V18.1 - 3阶段架构的第三阶段
 *
 * 功能：
 * 1. 代币-事件关联性评估
 * 2. 代币质量评估
 * 3. 综合评分（事件60% + 关联20% + 质量20%）
 *
 * V18.3 修改：
 * - C类品牌劫持新增区分规则：区分"机构名"和"包含机构名的专有名词"（书名等）
 * - 解决"币安人生"等书名/作品名被误判为机构品牌劫持的问题
 *
 * V18.2 修改：
 * - 品牌劫持新增C类：著名机构及其部门/产品/服务名称
 * - 新增1.0.1拼写错误无背景检查（独立于品牌劫持）
 * - 要求同时检查Symbol和Name
 *
 * V18.1 修改：
 * - 加强语义关联严格性：要求关联必须基于事件内容中明确出现的关键词
 * - 禁止基于人物地位/背景知识的推断关联
 * - 添加明确的禁止推断方式示例
 *
 * V18.0 修改：
 * - 添加数字缩写关联规则：K（千）、M（百万）、B（十亿）与其对应的完整数字构成强语义关联
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
export const STAGE3_TOKEN_ANALYSIS_PROMPT_VERSION = 'V18.3';

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

**1.0 品牌劫持风险检查**（最高优先级，必须在所有其他匹配规则之前执行）

⚠️ **核心事实**：此代币来自meme代币发行平台（如four.meme），平台上只能创建meme代币，不可能存在真正的知名代币。

**品牌劫持范围**（必须同时检查代币的Symbol和Name）：

**A. 知名代币名称**（代表示例）：
- BTC/Bitcoin, ETH/Ethereum, BNB, SOL/Solana, XRP, DOGE/Dogecoin, PEPE, SHIB, USDT, USDC, LINK, UNI, AAVE

**B. 知名人物名称**（CZ、Elon Musk、Trump等全球级名人）：
- CZ, Elon/Musk, Trump, 何一, V神/Vitalik 等

**C. 著名机构及其部门/产品/服务名称**：
- 著名机构本身（Binance、Coinbase、OpenAI 等），或其部门/产品/服务（Binance Research、Binance Launchpad、Coinbase Pro 等）
- 如果事件实体属于此类，且代币名复制了该名称，则构成品牌劫持
- 不可能围绕一个机构的正式部门名称做meme币
  - ❌ 事件主体"Binance Research"，代币Name"Binance Research" → 直接复制机构部门名 → 品牌劫持 → low
  - ❌ 事件主体"Binance Research"，代币Name"Binance Researc"（拼写变体）→ 品牌劫持 → low
  - ❌ 事件主体"Binance"，代币Symbol"BR"/Name"Binance Researc" → Name复制机构部门拼写变体 → 品牌劫持 → low

⚠️ **区分"机构名"和"包含机构名的专有名词"**（容易混淆，务必仔细判断）：
- **机构名本身**：代币名 = 机构名（如"Binance"、"币安"、"Coinbase"）→ 属于C类
- **机构官方产品线/部门**：代币名 = 机构的官方产品或部门（如"Binance Research"、"Binance Smart Chain"）→ 属于C类
- **包含机构名的独立作品/概念**：代币名是书名、节目名、绰号等**独立专有名词**，只是恰好包含机构名 → **不属于C类**
  - "币安人生" → 这是CZ的**书名**，不是币安机构的部门/产品 → 代币引用的是书 → 不触发C类
  - "币安一姐" → 这是何一的**绰号**，不是币安机构的正式称谓 → 不触发C类
  - 判断方法：把机构名去掉，剩余部分是否构成独立意义？"人生"有意义（书的核心主题）→ 独立作品 → 不属于C类

**判断规则**：

如果代币名（Symbol或Name，去除emoji、数字、特殊字符后）与上述A/B/C类名称**完全匹配或高度相似**（包括：完全匹配、以品牌名开头并附加后缀如"BNBARMY"、品牌名的轻微变体如"BTCC"、拼写变体），则：

1. **关联性得分必须设为0-5分**（品牌劫持，非真正关联）
2. **名称合理性必须降到1-2分**（直接复制/模仿知名名称，缺乏原创性）
3. **category必须为"low"**
4. 理由：这种代币的"关联"只是蹭品牌热度，不是基于事件内容建立的真正叙事关联

⚠️ **知名人物的豁免条件**（仅适用于B类）：

如果代币名是知名人物名称（如CZ、Elon、Trump），且满足以下**全部条件**，可以不触发品牌劫持规则，进入正常评估流程：

1. 事件确实是**该人物本人直接发起的动作或言论**（不是第三方提及/报道）
2. 事件具有**实质性的有趣内容或影响力**（不是简单的"hi"、表情、节日问候等空洞内容）
3. 存在**社区可预期的互动/回复/发酵空间**（事件能激发社区创作和传播）

- ✅ 豁免示例：代币"CZ"，事件"CZ发布《Freedom of Money》新书" → CZ本人发起，有实质内容，有发酵空间 → 不触发品牌劫持，正常评估
- ✅ 豁免示例：代币"ELON"，事件"Elon Musk收购Twitter并改名为X" → Elon本人动作，重大事件 → 不触发品牌劫持
- ❌ 不豁免：代币"CZ"，事件"CZ转发币安历史视频" → 内容空洞，只是转发 → 仍触发品牌劫持 → low
- ❌ 不豁免：代币"TRUMP"，事件"第三方账号发布Trump相关内容" → 不是Trump本人发起 → 仍触发品牌劫持

⚠️ **知名代币的豁免条件**（仅适用于A类）：
知名代币名称（A类）默认触发品牌劫持，但如果满足以下条件可以豁免：

代币名虽然与知名代币重名，但事件中的核心实体是一个**完全不同的东西**（不同领域的概念、产品、人物、事件等），且事件内容中**没有提及或暗示**该知名代币/其所在领域：
- ✅ 豁免：代币"LINK"，事件"某游戏角色Link推出" → Link是游戏角色，与Chainlink代币完全无关，事件未提及区块链/Chainlink → 不触发品牌劫持
- ✅ 豁免：代币"ATOM"，事件"原子能研究新突破" → ATOM指原子，与Cosmos代币无关 → 不触发品牌劫持
- ❌ 不豁免：代币"DOGE"，事件"马斯克发DOGE梗图" → DOGE梗图直接关联Dogecoin文化 → 仍触发品牌劫持
- ❌ 不豁免：代币"PEPE"，事件"Pepe青蛙梗图热议" → Pepe直接关联知名meme代币 → 仍触发品牌劫持

⚠️ **著名机构的豁免条件**（仅适用于C类）：

如果代币名是著名机构/部门/产品名称，但该机构发生了**重大/高影响力事件**，则可以豁免，进入正常评估：
- 豁免标准：事件本身是**该机构的重大动作或重大变故**（如收购、被黑、重大政策变动等），具有广泛的社会关注度和meme发酵空间
- ✅ 豁免：代币"Binance"，事件"Binance被SEC起诉" → 重大事件，社会关注度高 → 不触发品牌劫持，正常评估
- ✅ 豁免：代币"Coinbase"，事件"Coinbase上市纳斯达克" → 重大事件 → 不触发品牌劫持
- ❌ 不豁免：代币"Binance Research"，事件"Binance Research发布市场报告" → 日常运营，非重大事件 → 仍触发品牌劫持 → low
- ❌ 不豁免：代币"Binance Researc"，事件"Binance Research发布报告" → 日常运营 + 拼写变体 → 品牌劫持 → low

**示例**：
- 代币"BNB🔥"，事件"CZ转发币安历史视频" → A类知名代币 → 品牌劫持 → low
- 代币"ETHKING"，事件"V神发言" → A类知名代币变体 → 品牌劫持 → low
- 代币"CZ"，事件"CZ发布新书" → B类人名，满足豁免条件 → 正常评估
- 代币"MUSK"，事件"某KOL评论Musk" → B类人名，不满足豁免 → 品牌劫持 → low
- 代币"LINK"，事件"游戏角色Link发布新皮肤" → A类豁免 → 正常评估
- 代币Name"Binance Research"，事件主体"Binance Research" → C类机构部门名 → 品牌劫持 → low
- 代币Symbol"BR"/Name"Binance Researc"，事件主体"Binance Research" → C类机构部门名拼写变体 → 品牌劫持 → low
- 代币"Binance"，事件"Binance被SEC起诉" → C类机构名，但事件重大 → 豁免 → 正常评估
- 代币"币安人生有声书"，事件"CZ推荐《币安人生》并制作有声书" → "币安人生"是书名，不是机构名 → 不触发C类 → 正常评估
- 代币"币安"，事件"CZ发推" → 直接用机构名 → C类 → 品牌劫持 → low

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1.0.1 拼写错误无背景检查**（与品牌劫持并列的独立检查）

⚠️ **核心原则**：如果代币名中包含对事件实体/已知概念的**明显拼写错误**，且这个拼写错误**没有独立的背景故事或文化来源**，说明代币质量极差，直接返回low。

**判断标准**：
1. 代币名（Symbol或Name）与事件中出现的某个名称/概念存在1-2个字母的差异（增/删/改）
2. 这个差异**不是**一个独立的梗/文化/故事
3. 代币的其他信息（介绍、简介等）也没有解释这个拼写差异

**触发结果**：
- **拼写/可读性评分降到0-2分**
- **名称合理性降到0-1分**
- **category必须为"low"**
- 理由中需说明：代币名包含无背景的拼写错误，质量极差

**示例**：
- 代币Name"Binance Researc"（vs 事件实体"Binance Research"，少了一个h）→ 无独立背景 → 拼写错误 → low
- 代币Name"Ethereum" → 拼写正确 → 不触发
- 代币Name"Dogge"（vs "Doge"，多了一个g）→ 如果"Dogge"有独立的梗/文化背景 → 不触发；如果只是拼错了 → low

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

⚠️ **核心原则**：语义关联必须基于**事件内容中明确出现的关键词**，不能基于对人物地位/背景知识的推断。

**判断标准**：
- 代币名的核心概念必须在事件内容（eventContent）中**明确提及**或**直接衍生**
- 不能仅仅因为某个人物有某种地位/头衔，就认为代币名与其有关联

- **强语义关联**（15分）：代币名与事件有明确的语义关联
  - 示例：代币" 48H "，事件"CZ提到48小时"
  - 示例：代币" FREEDOM "，事件"CZ出狱"
  - **数字缩写对应**（15分）：代币名的数字缩写与事件中的金额/数量直接对应
    - 示例：代币" 1B "，事件"bet $1 billion" → 1B = 1 billion，强语义关联
    - 示例：代币" 100M "，事件"raise $100 million" → 100M = 100 million，强语义关联
    - 示例：代币" 10K "，事件"10,000 holders" → 10K = 10 thousand，强语义关联
    - 规则：K（千）、M（百万）、B（十亿）与其对应的完整数字构成强语义关联

- **中等语义关联**（12分）：代币名与事件有间接但合理的语义关联
  - 示例：代币" MOON "，事件"Elon Musk提到登月"
  - ⚠️ 关键：事件内容中必须有"登月"、"月球"等相关词汇

- **弱语义关联**（10分）：代币名与事件有关联但不够明确
  - 示例：代币" WIN "，事件"某次比赛获胜"

⚠️ **禁止的推断方式**：
- ❌ "CZ是币安创始人，代币名'链上皇'与CZ有关联" → 这是基于地位推断，**不是有效语义关联**
- ❌ "何一是币安联合创始人，代币名'币安一姐'与何一有关联" → 推文中未提及，**不是有效语义关联**
- ✅ 推文中明确提到"CZ是币安皇帝" → 代币"链上皇"与推文内容有**强语义关联**
- ✅ 推文中提到"何一被称为币安一姐" → 代币"币安一姐"与推文内容有**强语义关联**

**1.3 文化关联检查**（0-9分）

如果精确和语义都失败，判断是否存在文化关联：

- **强文化关联**（9分）：代币名与事件有明确的文化关联
  - 示例：代币" PEPE "，事件"网络青蛙梗"

- **中等文化关联**（6分）：代币名与事件有一定文化关联
  - 示例：代币" DOGE "，事件"狗币相关讨论"

- **弱文化关联**（3分）：代币名与事件关联较弱
  - 示例：代币" MEME "，事件"某个网络梗"

⚠️ **关联性底线提醒**：在第三步确定category时，如果关联性得分 ≤ 10分，category必须为"low"（详见第三步决策树）。
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

📋 **第三步：确定category（决策树，严格按顺序执行）**

⚠️ **你必须按照以下决策树的顺序确定category，不要跳过任何一步：**

**决策节点1：关联性底线检查**
- 查看第一步的关联性得分
- **如果关联性得分 ≤ 10分 → category = "low"，到此结束，不需要看总分**
- 只有关联性得分 > 10分时，才继续往下

**决策节点2：总分计算（仅当关联性 > 10分时执行）**
- 事件分 = Stage 2总分 × 0.6
- 关联分 = 第一步关联性得分（满分20，直接计入）
- 质量分 = 第二步质量得分（满分20，直接计入）
- **总分 = 事件分 + 关联分 + 质量分**

**决策节点3：按总分分类**
- total_score ≥ 70 → "high"
- 50 ≤ total_score < 70 → "mid"
- total_score < 50 → "low"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**示例**：

✅ 关联性达标：
- 事件分：85 × 0.6 = 51，关联分：20，质量分：15
- 总分 = 51 + 20 + 15 = 86，关联分20 > 10 → 按总分分类 → **high**

❌ 关联性不达标（注意：即使总分 ≥ 70，category也必须是low）：
- 事件分：85 × 0.6 = 51，关联分：0，质量分：19
- 总分 = 51 + 0 + 19 = 70，但关联分0 ≤ 10 → **low**（不看总分）

⚠️ **警告**：关联性=0分时，无论总分是70还是80还是90，category都必须填"low"。这是不可逾越的底线。

═══════════════════════════════════════════════════════════════════════════════

【输出格式】

**只返回JSON，不要其他内容**：

{
  "category": "high/mid/low",
  "reasoning": "详细推理过程（必须明确说明：关联性得分是多少，是否触发底线，如果触发则说明'关联性N分≤10，触发底线规则，category为low'）",
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
`;
}
