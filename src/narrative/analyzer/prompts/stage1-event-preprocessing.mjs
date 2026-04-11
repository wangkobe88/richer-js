/**
 * Stage 1：事件预处理 Prompt
 * V2.1 - 3阶段架构的第一阶段
 *
 * 功能：
 * 1. 空洞内容检查
 * 2. 详细事件描述提取
 * 3. 初步分类判断（A-E类）- 采用"内容本质优先级"
 * 4. 性质标记识别（推测性/发现型/营销性）
 * 5. 找角度推文识别（内部规则，不输出）
 *
 * V2.1 修改：
 * - 增强keyEntities提取规则：明确要求提取被明确讨论的概念/关键词
 * - 书名/文章标题中的核心概念词必须提取
 * - 被强调的词汇（加引号、重复提及）必须提取
 *
 * V2.0 修改：
 * - 分类体系从6类(A-F)重构为5类(A-E)
 * - B类扩展为"形象化IP相关事件"（推出/发现/描述）
 * - C类聚焦"产品相关事件"（去掉"内容发布"）
 * - A类扩展为"人物言论/动作及相关事件"（吸收F类人物互动）
 * - D类扩展为"机构言论/动作及相关事件"（吸收F类机构互动）
 * - F类（互动/传播类）合并入A类和D类
 *
 * V1.5 修改：
 * - 空洞内容检查添加超大IP特殊处理规则
 * - 超大IP（何一、CZ、Elon、Trump等）的任何公开发言都算事件，不因内容简单而阻断
 *
 * V1.4 修改：
 * - 移除输出中的isAngleFindingTweet字段（作为内部规则）
 * - 移除dataSource字段
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
export const STAGE1_EVENT_PREPROCESSING_VERSION = 'V2.1';

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

**⚠️ 超大IP发推的特殊处理**：

如果推文作者是超大IP（何一、CZ、Elon、Trump、Binance官方等有全球影响力的人物/机构）：
- **其任何公开发言本身就是事件**，即使内容很简单（如"hi"、"Happy Easter!"、一个表情）
- 这种情况下不算空洞内容，应通过空洞内容检查
- 事件描述："@[作者]发推'[内容]'"
- 分类为A类（人物言论类）
- 理由：超大IP的任何动作都可能成为新闻，其发言本身具有传播价值

⚠️ 此规则**仅适用于超大IP**（全球影响力的人物/机构），不适用于：
- 普通KOL或一般知名机构（如交易所发节日祝福 → 仍可判定为空洞内容）
- 知名但非"超大"的人物（如百万粉丝KOL → 按正常标准判断）

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

**⚠️ 找角度推文的识别（在提取事件主体前先判断）**

**什么是"找角度"推文？**
- 发币人借用当前热点事件/产品/新闻来发币
- 推文内容不是原创事件，而是"解读/评论/引用"某个外部事件
- **关键区别**：找角度推文的事件 = 推文陈述的事情，不是"某人发推"这个动作

**判断标准**（满足任一即为找角度推文）：
1. 推文提到"首个XXX"、"XXX正式上线"等产品发布新闻
2. 推文引用了公司/品牌的产品或事件（如百度、Apple、Tesla、Trump、CZ等）
3. 推文有Website/视频链接，指向品牌官网、新闻文章、视频平台等外部内容
4. 推文作者粉丝很少（<1000），但内容讨论的是大品牌/大事件/热门视频IP
5. 推文提到视频播放量（如"上百万浏览"、"千万播放"）但作者本身粉丝很少
6. 推文内容是新闻报道式、产品介绍式的语气，描述某个外部事件/现象
7. 推文提到"抖音新IP"、"B站热传"、"TikTok爆款"、"全网热议"等热门内容
8. 推文讨论的是社会现象/文化概念（如"当代年轻人的XXX"、"网络热梗XXX"）

**找角度推文的"事件"定义**：
- ✅ **事件 = 推文陈述的事情**（被引用的外部事件）
- ❌ **事件 ≠ 某人发推**（推文发布动作本身不重要）

**示例**：
- 推文："Trump posted this baby... CA below"
  - ✅ 事件：Trump发布Baby Trump形象（陈述的事情）
  - ❌ 事件：@NikolaiHauckx发推（不是这个）
- 推文："Tesla发布新车XXX... CA below"
  - ✅ 事件：Tesla发布新车（陈述的事情）
  - ❌ 事件：某账号发推（不是这个）

**找角度推文的"事件主体"提取规则**：
- ✅ **事件主体 = 被引用事件中的参与者**（推文陈述的事情里的主体）
  - 示例：推文说"Trump posted this baby" → 事件主体是"Trump"
  - 示例：推文说"Tesla发布新车" → 事件主体是"Tesla"
- ❌ **推文发布者不是事件主体**（只是借用者/评论者）

**2.2 事件主体**：**谁发起了/做了这件事？**
- eventSubject = 事件的**主动发起者/创造者**（做了这件事的人/组织）
- ⚠️ **区分"发起者"和"被涉及者"**：
  - 发起者：主动做了这件事的人/组织 → 放入eventSubject
  - 被涉及者：被提及、被作为内容对象、被涉及的人/组织 → 放入keyEntities，不放eventSubject
- 示例：IPFLOW_FUN给CZ做AI短剧 → 发起者=IPFLOW_FUN → eventSubject="IPFLOW_FUN"，CZ是被涉及者→放入keyEntities
- 示例：某KOL采访CZ → 发起者=该KOL → eventSubject="该KOL"，CZ是被采访者→放入keyEntities
- 示例：CZ发推"hi" → 发起者=CZ → eventSubject="CZ"
- 示例：CZ和Binance联合发布产品 → 两者都是发起者 → eventSubject="CZ、Binance"
- 示例：何一（币安联合创始人）、Tesla、当代年轻人
- ⚠️ **先判断是否为找角度推文或解读型回复**，再决定事件主体是谁
  - 找角度推文：事件主体 = 被引用事件中的参与者（不是推文发布者）
  - 解读型回复：事件主体 = 回复者（不是被回复的大IP），因为代币概念来自回复者的解读
  - 非找角度且非解读型回复：事件主体 = 正常判断

**2.3 事件内容（详细描述）**：
- **请详细描述事件的具体内容（200-500字）**
- 包括：发生了什么、有什么关键细节、数据如何、有什么亮点
- **这个描述将作为Stage 2的输入，请尽量详细**

⚠️ **eventContent必须基于语料事实，不得添加无根据的描述**：
- ❌ 不得凭空给人物添加"知名"、"意见领袖"、"著名"等影响力定语
- ❌ 不得编造人物的身份、头衔、粉丝数等语料中不存在的信息
- ✅ 只描述语料中明确提到的内容
- 示例：
  - ✅ 推文说"Professor Jiang says that he will be on the podcast" → "Professor Jiang宣布将参加播客节目"
  - ❌ 推文说"Professor Jiang says that he will be on the podcast" → "知名加密货币评论者/意见领袖Professor Jiang宣布..."（"知名加密货币评论者"是编造的，推文中没有这个信息）

**2.4 事件时效性**：
- 近期事件（7天内）、中期事件（30天内）、远期事件（超过30天）、预期事件（未来）
- 如果可以确定具体日期，请提供

**2.5 关键实体**：列出所有相关的重要实体

⚠️ **必须包含产品名/项目名/品牌名**：
- 如果事件涉及产品发布、项目上线、品牌推出等，产品名/项目名/品牌名必须列入keyEntities
- 这是Stage 3进行代币-事件关联匹配的关键依据，遗漏会导致匹配失败
- 产品名/项目名通常出现在事件内容描述中

- 示例：事件"Gift是首个链上支持支付捐赠的合约" → keyEntities必须包含"Gift"、"Giftily"
- 示例：事件"Giggle Academy推出新产品XYZ" → keyEntities必须包含"XYZ"和"Giggle Academy"
- 示例：事件"CZ发推提到48小时" → keyEntities包含"CZ"、"48小时"

⚠️ **必须包含被明确讨论的概念/关键词**：
- 如果推文明确提到某个概念、关键词（如书名、文章标题中的关键词），必须列入keyEntities
- 这些概念是事件的核心讨论对象，即使只有2-3个字也要提取
- **书名/文章标题**：如果推文提到书名或文章标题，标题中的核心概念词必须提取
- **被强调的词汇**：如果推文强调某个词（如加引号、重复提及），必须提取

- 示例：事件"CZ分享新书《Freedom of Money》，强调'运气'的重要性" → keyEntities必须包含"CZ"、"Freedom of Money"、"运气"
- 示例：事件"CZ发推'自由'" → keyEntities必须包含"CZ"、"自由"
- 示例：事件"马斯克发推'DOGE'" → keyEntities必须包含"马斯克"、"DOGE"

除了产品名和概念，还应包括：人物、机构、平台、技术等实体

**2.6 关键数据**：提取所有重要的数据

**【核心规则：提取事件本身的信息，不要推文的传播数据】**

**⚠️ 关键区别**：
- **事件本身的信息**：推文内容中提到的事件/现象有多火（如"在日推非常火爆"、"全网热议"）
- **推文的传播数据**：这条推文本身有多少点赞/转发（如"推文点赞19、转发3"）

**【规则：如果推文在描述外部事件/现象，不要提取推文的传播数据】**

**如何判断"推文在描述外部事件"？**
- 推文提到"日本流行的XXX"、"全网热议的XXX"、"抖音爆款XXX"
- 推文提到"在XX平台很火"、"XX热潮"、"XX现象"、"XX潮流"
- 推文提到"上百万浏览"、"千万播放"、"全网热度"
- 推文是新闻报道式、描述式的语气，讲述某个外部事件/现象
- 推文作者粉丝少，但讨论的是大话题/热点

**【上述情况的处理】**：
- ❌ **绝对不要提取**：这条推文的点赞、转发、作者粉丝数、评论数、浏览量
- ✅ **只提取**：推文内容中提到的**事件本身的热度信息**
  - 事件的热度描述："在日推非常火爆"、"全网热议"、"登上热搜"
  - 事件的传播数据："每天更新"、"上百万浏览"、"千万播放"

**【示例对比】**：
- 推文："日本流行的拍照姿势潮流...在日推非常火爆"
  - ❌ 错误：提取"推文点赞19、转发3"
  - ✅ 正确：提取"在日推非常火爆、每天更新"

- 推文："抖音爆款视频...上千万播放"
  - ❌ 错误：提取"推文点赞50、转发10"
  - ✅ 正确：提取"抖音爆款、上千万播放"

**【规则：如果推文本身就是事件，提取推文的传播数据】**

**什么情况是"推文本身就是事件"？**
- 原创言论、个人动态、首次发布内容
- 不是在描述外部事件，而是推文本身构成事件
- 示例：何一发推"hi"、用户原创观点、个人分享

**【上述情况的处理】**：
- ✅ 提取：推文的点赞、转发、粉丝数、浏览量

**2.7 是否超大IP**：
- 判断eventSubject（事件发起者）是否为超大IP（何一、CZ、Elon、Trump等）
- 超大IP的定义：有全球影响力，其任何动作都可能成为新闻
- ⚠️ isLargeIP严格基于eventSubject本身的影响力，**不是基于事件内容涉及的人物**
  - eventSubject = IPFLOW_FUN（小号）→ isLargeIP = false（即使内容涉及CZ）
  - eventSubject = CZ → isLargeIP = true
  - eventSubject = CZ、Binance → isLargeIP = true（发起者本身是大IP）
  - eventSubject = 某KOL（普通账号）→ isLargeIP = false（即使采访了CZ）

═══════════════════════════════════════════════════════════════════════════════

📋 **第三步：初步分类判断**

🎯 **基于第二步输出**，判断事件属于哪个类别（5个核心类别，互斥且完备）

**【A类：形象化IP相关事件类】**
- 有具体形象的角色、吉祥物、虚拟形象、动物IP、人物形象的**推出、发现或描述**
- ⚠️ **"形象化"限定**：只有有具体视觉形象的IP，不包括口号、概念、数字叙事等抽象内容
- 示例：
  - 推出：推出新的虚拟形象、发布电子宠物IP、Trump发布Baby Trump形象
  - 发现：发现CZ推文背景中隐藏的青蛙图案、发现某IP的隐藏形象元素
  - 描述：全网爆火网红小鸟BSC版Moodeng、某动物IP的形象描述
- ❌ 不属于A类：口号（"WE MAKE IMPACT"）、数字叙事（"48小时"）、概念（"conviction"）→ 这些归E类或其他

**【B类：产品发布/改进/营销等产品相关事件类】**
- **非Web3**产品（APP、功能、工具等）的发布、升级、改进、营销等产品相关事件
- ⚠️ 聚焦"产品"本身，非产品的内容发布不归此类
- 示例：Apple发布新款iPhone、APP功能更新、传统产品营销活动
- ❌ 不属于B类：机构非产品的言论（Binance发"Happy New Year"）→ D类
- ❌ 不属于B类：**面向Web3/Crypto用户的产品**（即使发布方是币安）→ 归W类

**【W类：Web3项目发布/上线事件类】**
- Web3/Crypto领域项目（链上智能合约、DeFi协议、链上机制、Web3工具/应用、加密货币相关AI工具、链上游戏等）的发布、上线、发现事件
- 判断标准：产品是否以Web3/Crypto用户为目标受众，是否解决Web3领域的需求
- ⚠️ **无论发布方是谁**，只要产品面向Web3用户群体就归W类（包括币安官方发布的Web3产品）
- 示例：Gift链上税收转捐赠合约上线、加密AI漫画生成器发布、链上游戏上线、DeFi协议发布、币安发布BinanceSmartCaptcha
- ⚠️ BSC链上的meme币所依托的Web3项目，都归W类
- ❌ 不属于W类：传统Web2产品（如普通APP、传统电商）→ 归B类

**【C类：人物言论/动作及相关事件类】**
- **个人账号**的公开言论、动作、互动及相关事件
- 包括：原创言论、个人动作（改头像、出席活动等）、回复互动、转发言论
- 示例：何一发推"Everything is number"、CZ回复推文、CZ转发推文
- ⚠️ 如果回复中代币概念来自回复者自己的解读（非大IP原话）→ 仍归C类（解读型回复），eventSubject = 回复者
- ⚠️ **机构/公司官方账号不归C类**：如果发言账号是机构/公司的官方账号（如@binance、@Tesla），应按内容本质归入B类（产品发布）或D类（机构言论/动作）
  - 示例：@binance发推宣布新AI intern → D类（机构推出新产品）或B类（产品发布）
  - 示例：何一个人账号@heyibinance发推 → C类（人物言论）

**【D类：机构言论/动作及相关事件类】**
- 机构、公司、平台**官方账号**的言论、动作、互动及相关事件
- 包括：官方言论表态、商业动作、战略举措、重大决策、官方互动（回复/转发/点赞）
- 示例：战略合作、并购、投资、Binance回复推文、Binance转发推文
- ⚠️ 日常运营（如新池子上币）直接阻断

**【E类：社会热点/现象类】**
- 社会热点现象、网络热点、文化现象、病毒传播事件
- 示例：抖音爆款、网络热梗、社会现象讨论
- 包括非形象化发现型meme（发现IP的隐藏口号、数字叙事、概念关联等）
- ⚠️ 形象化IP相关的发现归A类，不归E类

**⚠️ 找角度推文的分类**：
- 找角度推文应该按**"推文陈述的事情"**来分类，不是按"某人发推"分类
- 示例：推文"Trump posted this baby" → 事件是"Trump发布Baby Trump" → 归为A类（形象化IP推出）
- 示例：推文"CZ说XX" → 事件是"CZ的言论" → 归为C类（人物言论）
- 示例：推文"Tesla发布新车" → 事件是"Tesla发布新车" → 归为B类（产品发布）

**⚠️ 找角度推文的"叙事关联型"识别**：
- 如果推文的核心不是报道某个具体事件，而是**关联多个信息点，发现/揭示某种模式、数字关联、概念规律** → 归为E类（社会热点/现象，发现型）
- 判断标准：推文的结论/核心论点是"发现了一个叙事/模式/概念"，而不是"某件事发生了"
- 示例：推文"CZ 4月8日发书 + Binance多次提48 + 跟67一样的叙事" → 核心不是报道CZ发书，而是发现"48"这个数字叙事 → 归为E类（数字叙事发现）
- 示例：推文"某IP连续3次提到XX + XX与YY有关联 + 这是一个被低估的叙事" → 核心是发现概念关联 → 归为E类

**⚠️ 【解读型回复的识别与分类】**

当主推文是回复大IP的推文时，需要判断代币概念来源于哪条推文：

**判断方法**：代币名/核心概念能否从**被回复推文（大IP的推文）**中直接找到？

✅ **能直接找到** → C类或D类（事件主体 = 大IP，按大IP是个人还是机构决定C/D类）
   - 大IP原话中包含了币的核心概念
   - 示例：CZ说"We make impact" → 币名"IMPACT" → C类
   - 示例：CZ说"buy the dip" → 币名"buy the dip" → C类

❌ **不能直接找到（是回复者的解读/总结）** → C类或D类（事件主体 = 回复者）
   - 币的概念是回复者自己总结/解读出来的
   - 大IP并未直接表达这个概念
   - 回复者是个人 → C类；回复者是机构 → D类
   - 示例：CZ说"I knew a Binance Angel who bought then and held on for multiple years"
     → 回复者说"BNB always rewards conviction" → 币名"信念/conviction"
     → "conviction"是回复者的解读，CZ没说 → C类（eventSubject = 回复者）
   - 示例：CZ分享书中故事（BNB上线日经历）
     → 回复者说"不仅要学会buy the dip，更重要的是学会buy the early"
     → "buy the early"是回复者的总结 → C类（eventSubject = 回复者）

**⚠️ 解读型回复 vs 找角度推文的区别**：
- 找角度推文：发币人不与大IP互动，只是引用外部事件
- 解读型回复：发币人确实在回复大IP的推文，是真实互动
- 两者的共同点：代币概念都不是大IP直接说的
- 两者的区别：解读型回复有真实的互动关系（在推文线程中）

**解读型回复的事件描述规则**：
- eventSubject = 回复者（不是大IP）
- isLargeIP = 基于回复者判断（通常为false，除非回复者也是大IP）
- eventTheme = "XX回复了[大IP]的推文并表达观点"
- eventContent = 以"XX回复了[大IP]的推文"开头，描述回复者表达了什么观点
- 大IP仍列入keyEntities（作为背景信息）

**⚠️ 人物互动 vs 机构互动的区分**：
- CZ（个人账号）回复/转发/点赞 → C类（人物动作）
- @binance（官方账号）回复/转发/点赞 → D类（机构动作）
- 关键区分标准：账号是个人号还是机构官方号

**判断优先级**（当事件可能属于多个类别时）：

🎯 **核心原则**：按"内容本质"判断，问自己"这个事件的核心内容是什么？"

📊 **内容本质优先级**（从高到低）：
1️⃣ A类（形象化IP） - 有具体形象的IP的推出/发现/描述
2️⃣ W类（Web3项目） - Web3/Crypto项目的发布/上线/发现
3️⃣ B类（产品相关） - 非Web3产品的发布/改进/营销
4️⃣ C类（人物相关） - 个人账号的言论/动作/互动（机构官方账号不归此类）
5️⃣ D类（机构相关） - 机构官方账号的言论/动作/互动
6️⃣ E类（社会现象） - 群体性的热点、非形象化发现型meme

⚠️ **重要说明**：
- 如果回复中有具体内容，且币的概念来自大IP原话 → 按内容本身归类（C类等）
- 如果回复中有具体内容，但币的概念来自回复者（非大IP原话） → C类（解读型回复，eventSubject = 回复者）
- 日常运营（如新池子上币）直接阻断，不参与优先级比较
- **当推文同时包含"具体事件提及"和"概念/模式发现"时**：如果推文的结论/核心论点是"发现了一个叙事/模式/概念"，优先归为E类（社会现象），即使推文提及了具体事件

✅ **示例**：
- "Trump发布Baby Trump" → A类（核心是形象化IP推出）
- "全网爆火网红小鸟 BSC版Moodeng" → A类（核心是形象化IP描述）
- "发现CZ推文背景中隐藏的青蛙图案" → A类（形象化IP发现）
- "何一发推'Everything is number'" → C类（核心是人物言论）
- "CZ回复推文" → C类（人物动作，看回复内容评分）
- "Tesla发布新车" → B类（核心是产品发布）
- "Gift链上税收转捐赠合约上线" → W类（Web3项目发布）
- "币安发布BinanceSmartCaptcha" → W类（币安官方Web3产品，面向Web3用户）
- "孙哥的AI产品BAIclaw上线" → W类（Web3项目发布）
- "Binance发推'Happy New Year'" → D类（机构言论）
- "@binance转发推文" → D类（机构动作）
- "@TCryptochicks回复CZ推文并总结出'conviction'概念（CZ没说这个词）" → C类（解读型回复）
- "发现Yzi Labs海报的真正口号" → E类（非形象化发现，口号不是形象化IP）

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
    "primaryCategory": "A/W/B/C/D/E",
    "primaryCategoryName": "形象化IP/Web3项目/产品相关/人物言论动作/机构言论动作/社会热点现象",
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
- propertyMarkers中的reason字段要具体说明，不要只填true/false
`;
}
