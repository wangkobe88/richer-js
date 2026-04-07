/**
 * Stage 1：事件预处理 Prompt
 * V1.0 - 3阶段架构的第一阶段
 *
 * 功能：
 * 1. 空洞内容检查
 * 2. 详细事件描述提取
 * 3. 初步分类判断（A-F类）
 * 4. 性质标记识别（推测性/发现型/营销性）
 *
 * 输出：详细的事件描述和分类结果，供Stage 2使用
 */

import { buildTwitterSection } from './sections/twitter-section.mjs';
import { buildWebsiteSection } from './sections/website-section.mjs';
import { buildVideoSection } from './sections/video-section.mjs';
import { buildGithubSection } from './sections/github-section.mjs';
import { buildWeiboSection } from './sections/weibo-section.mjs';
import { buildAmazonSection } from './sections/amazon-section.mjs';
import { buildXiaohongshuSection } from './sections/xiaohongshu-section.mjs';
import { buildWeixinSection } from './sections/weixin-section.mjs';
import { generateAccountBackgroundsPrompt } from './account-backgrounds.mjs';

/**
 * Prompt版本号
 */
export const STAGE1_EVENT_PREPROCESSING_VERSION = 'V1.0';

/**
 * 构建Stage 1事件预处理Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的数据结果
 * @returns {string} 事件预处理Prompt
 */
export function buildStage1EventPreprocessingPrompt(tokenData, fetchResults) {
  const {
    twitterInfo = null,
    websiteInfo = null,
    amazonInfo = null,
    extractedInfo = null,
    backgroundInfo = null,
    youtubeInfo = null,
    douyinInfo = null,
    tiktokInfo = null,
    bilibiliInfo = null,
    xiaohongshuInfo = null,
    weixinInfo = null,
    accountSummary = null
  } = fetchResults;

  const sections = [];

  // 代币基本信息
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
  const currentTime = new Date().toISOString();
  const currentDate = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' });

  sections.push(`你是事件预处理专家。请分析以下代币所依托的事件，并提取详细信息。

⚠️ **重要背景：这是新产生的meme币**
- 分析对象是**刚产生的meme币**（通常创建不到半小时）
- 账号也刚建立，粉丝数少、社区规模小是**正常现象**
- **你的任务**：专注于评估**事件/IP本身**的价值，不要因为粉丝少、社区小就否定
- **评估重点**：事件/IP概念是否有传播潜力？是否有话题性？能否引发共鸣？

【当前时间】
- 现在时间：${currentDate}
- 重要：现在是2026年，任何2026年或之前的时间都是过去或现在，不是未来

【代币信息】
- 代币Symbol：${tokenData.symbol}
${tokenName ? `- 代币Name：${tokenName}` : ''}
- 代币地址：${tokenData.address}`);

  if (extractedInfo?.intro_en) sections[0] += `\n- 介绍（英文）：${extractedInfo.intro_en}`;
  if (extractedInfo?.intro_cn) sections[0] += `\n- 介绍（中文）：${extractedInfo.intro_cn}`;

  // 账号摘要（如果存在）
  if (accountSummary) {
    sections.push(`【账号摘要】
${accountSummary}`);
  }

  // 账号背景信息
  const backgrounds = generateAccountBackgroundsPrompt(twitterInfo);
  if (backgrounds) sections.push(backgrounds);

  // 各类语料sections
  const twitterSection = buildTwitterSection(twitterInfo);
  if (twitterSection) sections.push(twitterSection);

  const weiboSection = buildWeiboSection(backgroundInfo);
  if (weiboSection) sections.push(weiboSection);

  const videoSection = buildVideoSection(youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo);
  if (videoSection) sections.push(videoSection);

  const weixinSection = buildWeixinSection(weixinInfo);
  if (weixinSection) sections.push(weixinSection);

  const xiaohongshuSection = buildXiaohongshuSection(xiaohongshuInfo);
  if (xiaohongshuSection) sections.push(xiaohongshuSection);

  const websiteSection = buildWebsiteSection(websiteInfo);
  if (websiteSection) sections.push(websiteSection);

  const amazonSection = buildAmazonSection(amazonInfo);
  if (amazonSection) sections.push(amazonSection);

  // Stage 1分析框架
  sections.push(buildStage1Framework());

  return sections.filter(s => s).join('\n\n');
}

/**
 * 构建Stage 1分析框架
 */
function buildStage1Framework() {
  return `
╔══════════════════════════════════════════════════════════════════════════════╗
║                      Stage 1：事件预处理框架                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝

【分析目标】
1. 空洞内容检查：语料是否能让我们搞清楚发生了什么？
2. 事件描述提取：详细提取事件的所有关键信息
3. 初步分类判断：判断事件属于哪个类别（A-F类）
4. 性质标记识别：识别事件是否有推测性/发现型/营销性等性质

═══════════════════════════════════════════════════════════════════════════════

📋 **第一步：空洞内容检查**

🎯 **核心判断**：语料是否能让我们搞清楚发生了什么？

⚠️ **如果无法定义事件**（不知道发生了什么）→ 返回pass=false

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**空洞语料的特征**：

**特征1：纯名称 + 修饰词/表情**
- 只是提到某个名称 + 简单修饰词/表情，无具体内容
- 示例："链上 Binance"、"XX牛逼"、"buy XX"、"🚀 XX"

**特征2：纯玩梗/谐音**
- 代币名/语料只是对某个梗/热词/流行语的谐音、变体、拼贴
- 示例："一代人有一代人的鸡蛋要领"、"鸭鸭"、"鸡你太美"

**判断标准**（能定义出事件的最低要求）：

语料必须包含以下信息中的**至少一项**：

1. **明确的主体**：知道是谁/什么机构（何一、CZ、Binance等）
2. **具体的事件**：知道发生了什么（发推文、发布产品、提出概念等）
3. **IP/概念**：知道是什么IP或概念（电子宠物、虚拟形象等）
4. **数据/分析**：有具体数据或观点（热度数据、播放量等）

⚠️ **重要提示**：
- **不要求信息"可验证"或"真实"**，只要求有具体内容描述
- 即使是营销包装，只要描述了具体的事件/数据/概念，就不算空洞

═══════════════════════════════════════════════════════════════════════════════

📋 **第二步：详细事件描述提取**

⚠️ **只有通过空洞内容检查后才执行此步骤**

请提取事件的详细关键信息：

**2.1 事件主题**：事件是关于什么？
- 示例：何一发推文、产品发布、名人言论、社会现象、科技突破等
- ⚠️ **发现型meme格式**：必须包含"发现/揭示"动作词
  - ✅ "发现Yzi Labs海报的真正口号"
  - ❌ "Yzi Labs口号"（缺少动作词）

**2.2 事件主体**：谁/什么组织参与其中？
- 示例：何一（币安联合创始人）、CZ、Tesla、Binance、当代年轻人
- ⚠️ 先判断是否为找角度推文，再决定事件主体是谁

**2.3 事件内容（详细描述）**：
- **请详细描述事件的具体内容（200-500字）**
- 包括：发生了什么、有什么关键细节、数据如何、有什么亮点
- **这个描述将作为Stage 2的输入，请尽量详细**

**2.4 事件时效性**：
- 近期事件（7天内）、中期事件（30天内）、远期事件（超过30天）、预期事件（未来）
- 如果可以确定具体日期，请提供

**2.5 关键实体**：列出所有相关的重要实体
- 示例：["何一", "Binance", "CZ", "Yzi Labs"]

**2.6 关键数据**：提取所有重要的数据
- 热度描述：如"全网热度破百亿"
- 传播数据：如"50w人二创"、"播放量1000万"
- 其他指标：如"热搜排名"、"转发量"

**2.7 是否超大IP**：
- 判断事件主体是否为超大IP（何一、CZ、Elon、Trump等）
- 超大IP的定义：有全球影响力，其任何动作都可能成为新闻

═══════════════════════════════════════════════════════════════════════════════

📋 **第三步：初步分类判断**

🎯 **基于第二步输出**，判断事件属于哪个类别（6个核心类别，互斥且完备）

**【A类：人物言论类】**
- 个人/账号的公开发言、表态、观点、动态
- 包括：原创言论、回复互动、转发言论
- 示例：何一发推"Everything is number"

**【B类：IP概念推出类】**
- IP概念、角色设定、虚拟形象、文化符号、电子宠物的推出或发布
- 示例：推出新的虚拟形象、发布电子宠物IP、角色设定公布

**【C类：产品/内容发布类】**
- 产品、APP、视频、文章、功能等内容的发布/上线/推广
- 示例：新书发布、APP上线、视频发布、产品功能更新

**【D类：机构动作类】**
- 机构、公司、平台的商业动作、战略举措、重大决策
- 示例：战略合作、并购、投资、重大政策调整
- ⚠️ 日常运营（如新池子上币）直接阻断

**【E类：社会热点/现象类】**
- 社会热点现象、网络热点、文化现象、病毒传播事件
- 示例：抖音爆款、网络热梗、社会现象讨论
- 包括发现型meme（发现IP的隐藏元素、彩蛋、口号等）

**【F类：互动/传播类】**
- 互动、转发、引用、提及等传播行为
- 示例：CZ回复推文、大V转发、知名账号引用

**判断优先级**（当事件可能属于多个类别时）：
1. 如果是**超大IP的言论** → 优先归为A类
2. 如果是**IP概念推出** → 优先归为B类
3. 如果是**发现型meme** → 归为E类
4. 如果是**日常运营** → 直接阻断

**置信度评估**：
- **high**：事件特征明确，只属于一个类别
- **medium**：事件有多个类别特征，但主类别明确
- **low**：事件特征模糊，可能属于多个类别

═══════════════════════════════════════════════════════════════════════════════

📋 **第四步：性质标记识别**

判断事件是否有以下性质标记：

**4.1 推测性**
- 事件包含对未来情况的预测、推测
- 示例："书里会提到XX"、"预计下一步会XX"

**4.2 发现型**
- 事件是发现/揭示隐藏元素、彩蛋、口号、设计细节
- 示例："发现Yzi Labs海报的真正口号"、"发现CZ推文背景中的隐藏图案"

**4.3 营销性**
- 事件明显是营销/推广行为
- 示例：官方营销活动、产品推广、品牌合作

═══════════════════════════════════════════════════════════════════════════════

【输出格式】

**只返回JSON，不要其他内容**：

**事件无法定义（空洞内容）**：
{
  "pass": false,
  "reason": "说明为什么是空洞内容",
  "eventDescription": null,
  "eventClassification": null,
  "propertyMarkers": null
}

**事件通过（有内容）**：
{
  "pass": true,
  "reason": "事件可以定义",
  "eventDescription": {
    "eventTheme": "事件主题",
    "eventSubject": "事件主体",
    "isLargeIP": true/false,
    "eventContent": "详细的事件内容描述（200-500字）",
    "eventTiming": "recent/medium/distant/future",
    "specificDate": "具体日期（如果可以确定）",
    "keyEntities": ["实体1", "实体2"],
    "keyData": {
      "heatLevel": "热度描述",
      "spreadData": "传播数据",
      "anySpecificNumbers": "具体数字"
    }
  },
  "eventClassification": {
    "primaryCategory": "A/B/C/D/E/F",
    "primaryCategoryName": "人物言论/IP概念推出/产品内容发布/机构动作/社会热点现象/互动传播",
    "possibleCategories": ["A", "B"],
    "confidence": "high/medium/low",
    "reason": "分类判断的理由"
  },
  "propertyMarkers": {
    "speculative": true/false,
    "discovery": true/false,
    "marketing": true/false,
    "speculativeReason": "如果是推测性，说明推测了什么",
    "discoveryReason": "如果是发现型，说明发现了什么",
    "marketingReason": "如果是营销性，说明营销了什么"
  }
}

⚠️ **注意**：
- eventContent（事件内容描述）将作为Stage 2的输入，请尽量详细
- eventContent应包含：发生了什么、有什么关键细节、数据如何、有什么亮点
- propertyMarkers中的reason字段要具体说明，不要只填true/false
`;
}
