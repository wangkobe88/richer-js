/**
 * Stage 1：直接依托推文专用事件预处理 Prompt
 * 用于已被预分类为"直接依托推文"的代币分析
 *
 * 核心特点：
 * - 推文本身就是事件来源，代币直接基于这条推文
 * - 推文作者通常有影响力，推文有互动量
 * - 推文互动数据（点赞/转发/粉丝数）是有效的传播数据
 * - 最简短的 Stage 1 prompt
 */

import { buildTwitterSection } from '../sections/twitter-section.mjs';
import { buildWebsiteSection } from '../sections/website-section.mjs';
import { buildVideoSection } from '../sections/video-section.mjs';
import { buildGithubSection } from '../sections/github-section.mjs';
import { buildWeiboSection } from '../sections/weibo-section.mjs';
import { buildAmazonSection } from '../sections/amazon-section.mjs';
import { buildXiaohongshuSection } from '../sections/xiaohongshu-section.mjs';
import { buildInstagramSection } from '../sections/instagram-section.mjs';
import { buildWeixinSection } from '../sections/weixin-section.mjs';
import { buildBinanceSquareSection } from '../sections/binance-square-section.mjs';
import { generateAccountBackgroundsPrompt } from '../account/account-backgrounds.mjs';

export const STAGE1_DIRECT_TWEET_VERSION = 'V1.0';

/**
 * 构建直接依托推文专用 Stage 1 Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的数据结果
 * @returns {string} Stage 1 Prompt
 */
export function buildStage1DirectTweetPrompt(tokenData, fetchResults) {
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
    instagramInfo = null,
    weixinInfo = null,
    binanceSquareInfo = null,
    accountSummary = null
  } = fetchResults;

  const sections = [];

  // 代币基本信息
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
  const currentDate = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' });

  sections.push(`你是事件预处理专家。请分析以下代币所依托的事件，并提取详细信息。

⚠️ **重要背景：这是新产生的meme币**
- 分析对象是**刚产生的meme币**（通常创建不到半小时）
- **你的任务**：专注于评估**事件/IP本身**的价值
- **评估重点**：事件/IP概念是否有传播潜力？是否有话题性？能否引发共鸣？

📌 **推文类型：直接依托推文**
- 这条推文已被识别为**直接依托推文**：推文本身就是事件的来源
- **事件主体通常是推文作者**（除非推文中明确描述了其他主体的事件）
- **推文的互动数据（点赞、转发、粉丝数）是事件传播数据的重要组成部分**，应正常提取

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

  const instagramSection = buildInstagramSection(instagramInfo);
  if (instagramSection) sections.push(instagramSection);

  const websiteSection = buildWebsiteSection(websiteInfo);
  if (websiteSection) sections.push(websiteSection);

  const amazonSection = buildAmazonSection(amazonInfo);
  if (amazonSection) sections.push(amazonSection);

  const binanceSquareSection = buildBinanceSquareSection(binanceSquareInfo);
  if (binanceSquareSection) sections.push(binanceSquareSection);

  // 分析框架
  sections.push(buildDirectTweetFramework());

  return sections.filter(s => s).join('\n\n');
}

/**
 * 构建直接依托推文专用分析框架
 */
function buildDirectTweetFramework() {
  return `
╔══════════════════════════════════════════════════════════════════════════════╗
║          Stage 1：直接依托推文 — 事件预处理框架                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

【分析目标】
1. 事件描述提取：提取推文所构成的事件详细信息
2. 初步分类判断：判断事件属于哪个类别（A-G类）

═══════════════════════════════════════════════════════════════════════════════

📋 **第一步：事件描述提取**

**事件描述**由以下要素组成：
1. **事件主题**：用一句话概括发生了什么
2. **事件主体**：谁发起/做了这件事
3. **事件内容**：详细的经过描述（200-500字）
4. **事件时效性**：什么时候发生的
5. **关键实体**：涉及的人物、机构、产品、概念等
6. **关键数据**：热度、传播数据、影响力数据等

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ **兜底事件定义规则**：

如果语料内容无法定义事件，则使用兜底格式定义：**"@[作者]发推'[内容]'"**

- 示例：推文内容只有"hi" → 事件：@CZ发推'hi'
- 示例：推文内容只有"🚀🚀🚀" → 事件：@某KOL发推'🚀🚀🚀'
- 示例：推文内容为"XX牛逼" → 事件：@某用户发推'XX牛逼'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

请提取事件的详细关键信息：

**1.1 事件主体**：
- **默认：事件主体 = 推文作者**（推文本身就是事件）
- 除非推文中明确描述了其他主体的事件
- ⚠️ **区分"发起者"和"被涉及者"**：
  - 发起者：主动做了这件事的人/组织 → 放入事件主体
  - 被涉及者：被提及、被作为内容对象、被涉及的人/组织 → 放入关键实体，不放事件主体
  - 示例：IPFLOW_FUN给CZ做AI短剧 → 发起者=IPFLOW_FUN，CZ是被涉及者→放入关键实体
  - 示例：某KOL采访CZ → 发起者=该KOL，CZ是被采访者→放入关键实体
  - 示例：CZ发推"hi" → 发起者=CZ
  - 示例：CZ和Binance联合发布产品 → 两者都是发起者

⚠️ **核心禁止规则：事件描述中禁止出现"发币"视角的表述**：
- ❌ 禁止："用户借CZ被称'老登'的网络热梗在BSC发币"
- ❌ 禁止："某人利用XX概念发行代币"
- ❌ 禁止："某用户在BSC链上创建了一个名为XX的代币"
- ✅ 正确：描述事件/现象本身
- ✅ 正确："XX概念在加密社区的传播"
- **原因**：所有分析的代币都是meme币，"发币"是前提而不是事件。

**1.2 事件内容（详细描述）**：
- **请详细描述事件的具体内容（200-500字）**
- 包括：发生了什么、有什么关键细节、数据如何、有什么亮点
- **这个描述将作为Stage 2的输入，请尽量详细**

⚠️ **事件内容必须基于语料事实，不得添加无根据的描述**：
- ❌ 不得凭空给人物添加"知名"、"意见领袖"、"著名"等影响力定语
- ❌ 不得编造人物的身份、头衔、粉丝数等语料中不存在的信息
- ❌ **不得将代币信息（Symbol/Name/地址）混入事件描述**：代币名称只出现在【代币信息】区块，不代表它出现在语料中
  - 错误：推文说"I know a coin" + 链接 → 事件描述写"推出了名为WOW的代币"（"WOW"来自代币信息，推文中没有）
  - 正确：推文说"I know a coin" + 链接 → 事件描述写"回复推文并附带一个代币链接"（只基于推文语料）
- ✅ 只描述语料（推文、视频、网站等）中明确提到的内容
- 示例：
  - ✅ 推文说"Professor Jiang says that he will be on the podcast" → "Professor Jiang宣布将参加播客节目"
  - ❌ 推文说"Professor Jiang says that he will be on the podcast" → "知名加密货币评论者/意见领袖Professor Jiang宣布..."（"知名加密货币评论者"是编造的）

**1.3 事件时效性**：
- 近期事件（7天内）、中期事件（30天内）、远期事件（超过30天）、预期事件（未来）
- 如果可以确定具体日期，请提供

**1.4 关键实体**：列出所有相关的重要实体

⚠️ **必须包含产品名/项目名/品牌名**：
- 如果事件涉及产品发布、项目上线、品牌推出等，产品名/项目名/品牌名必须列入关键实体
- 产品名/项目名通常出现在事件内容描述中
- 示例：事件"Gift是首个链上支持支付捐赠的合约" → 关键实体必须包含"Gift"、"Giftily"
- 示例：事件"Giggle Academy推出新产品XYZ" → 关键实体必须包含"XYZ"和"Giggle Academy"
- 示例：事件"CZ发推提到48小时" → 关键实体包含"CZ"、"48小时"

⚠️ **必须包含被明确讨论的概念/关键词**：
- 如果推文明确提到某个概念、关键词（如书名、文章标题中的关键词），必须列入关键实体
- 这些概念是事件的核心讨论对象，即使只有2-3个字也要提取
- **书名/文章标题**：如果推文提到书名或文章标题，标题中的核心概念词必须提取
- **被强调的词汇**：如果推文强调某个词（如加引号、重复提及），必须提取
- 示例：事件"CZ分享新书《Freedom of Money》，强调'运气'的重要性" → 关键实体必须包含"CZ"、"Freedom of Money"、"运气"
- 示例：事件"马斯克发推'DOGE'" → 关键实体必须包含"马斯克"、"DOGE"

除了产品名和概念，还应包括：人物、机构、平台、技术等实体

⚠️ **关键实体只能从语料内容中提取，不得从【代币信息】区块提取**：
- ❌ 除非语料中明确提到了这个名称，不得将代币Symbol/Name直接作为关键实体
- 错误：推文说"I know a coin" + 代币链接，代币名WOW → 关键实体包含"WOW"（推文没提到WOW）
- 正确：推文说"check out DOGE" + 代币链接，代币名WOW → 关键实体包含"DOGE"（推文提到了），不包含"WOW"（推文没提到）

**1.5 关键数据**：提取所有重要的数据

⚠️ **必须提取事件主体的影响力数据**：
- 事件主体本人的粉丝数、认证状态、头衔等
- 这是Stage 2判断分量等级（S/A/B/C级）的关键依据
- 示例：事件主体是@ABONHYANUAE → 关键数据应包含"粉丝数：@ABONHYANUAE约4.8万"
- 示例：事件主体是CZ → 关键数据应包含"粉丝数：CZ约1096万"

- ✅ **提取推文的互动数据**：推文的点赞数、转发数、评论数、浏览量
- ✅ **提取推文作者的影响力数据**：粉丝数、认证状态、头衔等
- ✅ **提取事件本身的热度信息**：如果有额外的传播数据
- 这些数据是Stage 2判断分量等级（S/A/B/C级）的关键依据

═══════════════════════════════════════════════════════════════════════════════

📋 **第二步：初步分类判断**

🎯 **基于事件内容本质**，判断事件属于哪个类别（7个核心类别，互斥且完备）

**【A类：形象化IP相关事件类】**
- 有具体形象的角色、吉祥物、虚拟形象、动物IP、人物形象的**推出、发现或描述**
- ⚠️ **"形象化"限定**：只有有具体视觉形象的IP，不包括口号、概念、数字叙事等抽象内容
- 示例：
  - 推出：推出新的虚拟形象、发布电子宠物IP、Trump发布Baby Trump形象
  - 发现：发现CZ推文背景中隐藏的青蛙图案、发现某IP的隐藏形象元素
  - 描述：全网爆火网红小鸟BSC版Moodeng、某动物IP的形象描述
- ❌ 不属于A类：口号（"WE MAKE IMPACT"）、数字叙事（"48小时"）、概念（"conviction"）→ 这些归F类或其他

**【B类：产品发布/改进/营销等产品相关事件类】**
- **非Web3**产品（APP、功能、工具等）的发布、升级、改进、营销等产品相关事件
- ⚠️ 聚焦"产品"本身，非产品的内容发布不归此类
- 示例：Apple发布新款iPhone、APP功能更新、传统产品营销活动
- ❌ 不属于B类：机构非产品的言论（Binance发"Happy New Year"）→ D类
- ❌ 不属于B类：**面向Web3/Crypto用户的产品**（即使发布方是币安）→ 归W类

**【W类：Web3项目发布/上线事件类】**
- Web3/Crypto领域项目（链上智能合约、DeFi协议、链上机制、Web3工具/应用、加密货币相关AI工具、链上游戏等）的发布、上线、发现事件
- **判断标准：产品是否以Web3/Crypto用户为目标受众，是否解决Web3领域的需求**
- ⚠️ **无论发布方是谁**，只要产品面向Web3用户群体就归W类（包括币安官方发布的Web3产品）
- ⚠️ **不仅限于链上协议**：以下类型只要面向Web3用户群体，也归W类：
  - 围绕Web3人物/文化/事件的AI工具（如围绕CZ新书构建的开源AI知识库）
  - 加密社区的教育/研究工具（如Web3知识库、加密课程平台）
  - 服务Web3用户的Web2工具（如加密货币AI漫画生成器、Web3数据分析平台）
- 示例：Gift链上税收转捐赠合约上线、加密AI漫画生成器发布、链上游戏上线、DeFi协议发布、币安发布BinanceSmartCaptcha、围绕CZ新书的开源AI知识库上线
- ⚠️ BSC链上的meme币所依托的Web3项目，都归W类
- ❌ 不属于W类：传统Web2产品（如普通APP、传统电商）→ 归B类

**【C类：人物言论/动作及相关事件类】**
- **个人账号**的公开言论、动作、互动及相关事件
- 包括：原创言论、个人动作（改头像、出席活动等）、回复互动、转发言论
- 示例：何一发推"Everything is number"、CZ回复推文、CZ转发推文
- ⚠️ 如果回复中代币概念来自回复者自己的解读（非大IP原话）→ 仍归C类（解读型回复），事件主体 = 回复者
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
- ⚠️ 发现型叙事（隐藏口号、数字叙事、概念关联等）归F类，不归E类
- ⚠️ 形象化IP相关的发现归A类，不归E类
- ⚠️ **E类 vs F类边界**：
  - E类：推文只是**报道**"存在一个网络热梗/社会现象"（热梗/现象本身是事件）
  - F类：推文在**揭示**网络热梗/流行语与某个人物/事件的**隐藏关联**（关联发现是核心）
  - 示例："老登这个网络热梗很火" → E类（仅报道热梗存在）
  - 示例："发现uncz = unc + cz，'老登'与CZ有文字关联" → F类（揭示隐藏的文字游戏关联）
  - 示例："发现XX词实际上是YY的谐音" → F类（揭示隐藏关联）

**【F类：发现型叙事类】**
- 发现/揭示已知内容中隐藏的模式、关联、叙事、彩蛋、口号
- **判定关键**：推文中是否存在明确的"发现/揭示/关联"动作？
  - ✅ **归为F类**：推文明确**关联多个信息点，揭示隐藏的模式/叙事/概念**，核心论点是"发现了一个叙事"
  - ❌ **不归F类**：推文只是在报道/引用某人的话，或简单提取某人的一个关键词 → 按说话者/发布者归类（C/D/B/W类）
- 包括：
  - 数字/日期叙事发现：关联多个信息点，发现某数字/日期成为叙事核心
  - 隐藏口号/概念发现：发现品牌/IP的隐藏核心理念或口号
  - 概念/模式关联：发现多个事件之间的隐藏关联规律
  - **文字游戏/缩写/谐音关联发现**：发现代币名/概念中隐藏的文字游戏、缩写含义、谐音关联
  - 非形象化彩蛋/设计细节发现（形象化的归A类）
- 示例：
  - "CZ 4月8日发书 + Binance多次提48 + 跟67一样的叙事" → F类（关联多个信息点，发现"48"数字叙事）
  - "发现Yzi Labs海报的真正口号是WE MAKE IMPACT" → F类（非形象化发现，口号不是视觉形象）
  - "某IP连续3次提到XX + XX与YY有关联 + 这是一个被低估的叙事" → F类（发现概念关联）
  - "发现uncz = unc + cz，'老登'(unc)与CZ有文字关联" → F类（发现缩写/文字游戏关联）
  - "发现XX实际上是YY的谐音/缩写" → F类（揭示隐藏的文字关联）
- ❌ 不属于F类：
  - CZ说"We make impact"（人物言论，没有"发现"动作）→ C类
  - 发现CZ推文背景中隐藏的青蛙图案（形象化发现）→ A类
  - "CZ近一周3次提到conviction，预计新书会重点阐述"（基于推理预测未来）→ G类

**【G类：推测型叙事类】**
- 基于已知信息，推测/预测未来可能发生的事件
- **判定关键**：推文中是否存在明确的推测/预测动作，且推测基于一定的推理过程？
  - ✅ **归为G类**：推文基于多个信息点推理预测未来事件，核心论点是"预测某事会发生"
  - ❌ **不归为G类**：推文只是在引用/报道某人说的话 → 按说话者归类（C/D/B/W类）
  - ❌ **不归为G类**：推文是发现已有隐藏模式（事件已经存在）→ F类
  - ❌ **不归为G类**：推文只是陈述已发生的事实 → 按内容归类
- 包括：
  - 基于模式的预测：关联多个信息点预测未来事件
  - 基于线索的推测：基于已知线索推测即将发生的事件
  - 基于趋势的预判：基于趋势分析预测某个方向
- 示例：
  - "CZ近一周3次提到conviction，新书即将发布，预计书中会重点阐述这个概念" → G类（基于多个证据点推理预测）
  - "关联多个信息点，推测Binance即将推出与48相关的产品" → G类（基于发现的模式预测）
  - "某KOL最近活跃度增加，预计即将发布新产品" → G类（基于线索推测，但推理较弱）
  - "我觉得明天CZ会发推提到X" → G类（纯猜测，无依据，Stage 2评分时会被阻断）
- ❌ 不属于G类：
  - CZ说"我认为下一个big thing是X"（人物言论，没有推理过程）→ C类
  - 发现Binance多次提到"48"形成数字叙事（发现已有模式）→ F类
  - Tesla发布新车（已发生事件）→ B类

**⚠️ G类 vs F类 vs C类的边界**：
- **F类**：推文在关联多个信息点，**揭示已存在的**隐藏模式/叙事/概念
  - 示例："发现48是Binance的隐藏数字叙事" → 48已经被多次提及，推文揭示了已有模式
- **G类**：推文基于已知信息，**预测尚未发生的**未来事件
  - 示例："基于Binance多次提48，推测即将推出与48相关的产品" → 产品尚未推出，推文预测未来
- **C类**：推文只是引用/报道某人的言论/动作，没有推理或预测过程
  - 示例：CZ说"我认为下一个big thing是X" → 直接引用人物观点，没有推理链
- **关键区分**：F类关注"已存在的模式"，G类关注"尚未发生的事件"，C类关注"谁说了什么"

**判断优先级**（当事件可能属于多个类别时）：

🎯 **核心原则**：按"内容本质"判断，问自己"这个事件的核心内容是什么？"

📊 **内容本质优先级**（从高到低）：
1️⃣ A类（形象化IP） - 有具体形象的IP的推出/发现/描述
2️⃣ W类（Web3项目） - Web3/Crypto项目的发布/上线/发现
3️⃣ B类（产品相关） - 非Web3产品的发布/改进/营销
4️⃣ F类（发现型叙事） - 关联多个信息点揭示隐藏的模式/叙事/概念
5️⃣ G类（推测型叙事） - 基于已知信息推测/预测未来事件
6️⃣ C类（人物相关） - 个人账号的言论/动作/互动（机构官方账号不归此类）
7️⃣ D类（机构相关） - 机构官方账号的言论/动作/互动
8️⃣ E类（社会现象） - 群体性的热点、社会现象

⚠️ **重要说明**：
- **当推文同时包含"具体事件提及"和"概念/模式发现"时**：如果推文的结论/核心论点是"发现了一个叙事/模式/概念"，优先归为F类（发现型叙事），即使推文提及了具体事件
- **当推文同时包含"发现已有模式"和"基于模式预测未来"时**：如果推文的核心论点是预测未来事件，优先归为G类（推测型叙事）；如果核心论点是揭示已存在的模式，归为F类
- **F类 vs G类 vs C类的边界**：引用某人的话 → C类；发现已有隐藏模式 → F类；基于已知信息预测未来 → G类
- **E类 vs F类的边界**：如果推文只是在报道"XX是一个网络热梗/社会现象" → E类；如果推文在揭示"XX热梗/流行语与YY之间存在隐藏关联（文字游戏、缩写、谐音等）" → F类
- **文字关联发现优先判断**：如果推文的核心论点是发现某个名称/词汇中隐藏的文字游戏、缩写含义、谐音关联 → F类（即使涉及的网络热梗本身属于社会现象）

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
- "围绕CZ新书《币安人生》的开源AI知识库上线GitHub" → W类（面向Web3用户的知识库产品）
- "社区成员制作的Web3数据分析平台上线" → W类（面向Web3用户的工具产品）
- "Binance发推'Happy New Year'" → D类（机构言论）
- "@binance转发推文" → D类（机构动作）
- "@TCryptochicks回复CZ推文并总结出'conviction'概念（CZ没说这个词）" → C类（解读型回复）
- "发现Yzi Labs海报的真正口号是WE MAKE IMPACT" → F类（非形象化发现，揭示隐藏口号）
- "CZ 4月8日发书 + Binance多次提48 → 发现48数字叙事" → F类（关联多个信息点，发现数字叙事）
- "CZ近一周3次提到conviction，预计新书会重点阐述这个概念" → G类（基于多个证据点推理预测未来）
- "关联多个信息点，推测Binance即将推出与48相关的产品" → G类（基于发现的模式预测未来）
- "我觉得明天CZ会发推提到X" → G类（纯猜测，无依据）
- "抖音爆款视频千万播放" → E类（纯社会热点现象）
- "日本流行的拍照姿势潮流" → E类（社会文化现象）
- "发现uncz = unc + cz = 老登 + CZ的文字关联" → F类（发现文字游戏/缩写关联，不归E类）
- "老登这个网络热梗很火" → E类（仅报道热梗存在，无发现动作）

**置信度评估**：
- **high**：事件特征明确，只属于一个类别
- **medium**：事件有多个类别特征，但主类别明确
- **low**：事件特征模糊，可能属于多个类别

═══════════════════════════════════════════════════════════════════════════════

【输出格式】

**只返回JSON，不要其他内容**：

⚠️ **所有通过预检查的语料都能定义事件**，pass 始终为 true。

{
  "pass": true,
  "reason": "事件定义说明",
  "eventDescription": {
    "eventTheme": "事件主题（⚠️ 发现型meme必须包含动作词，如'发现Yzi Labs海报的真正口号'，不能只写'Yzi Labs口号'）",
    "eventSubject": "事件主体",
    "eventContent": "详细的事件内容描述（200-500字）",
    "eventTiming": "recent/medium/distant/future",
    "specificDate": "具体日期（如果可以确定）",
    "keyEntities": ["实体1", "实体2"],
    "keyData": {
      "heatLevel": "热度描述",
      "spreadData": "传播数据（包含推文互动数据和事件传播数据）",
      "anySpecificNumbers": "具体数字"
    }
  },
  "eventClassification": {
    "primaryCategory": "A/W/B/F/G/C/D/E",
    "primaryCategoryName": "形象化IP/Web3项目/产品相关/发现型叙事/推测型叙事/人物言论动作/机构言论动作/社会热点现象",
    "possibleCategories": ["A", "B"],
    "confidence": "high/medium/low",
    "reason": "分类判断的理由"
  }
}

⚠️ **注意**：
- eventContent（事件内容）将作为Stage 2的输入，请尽量详细
- eventContent应包含：发生了什么、有什么关键细节、数据如何、有什么亮点
- ⚠️ **eventTheme和eventContent中禁止使用"发币"视角**：不要写"有人借助XX发币"等表述。应描述事件/现象本身
`;
}
