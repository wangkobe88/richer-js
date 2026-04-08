/**
 * Stage 1：事件预处理 Prompt
 * V1.4 - 3阶段架构的第一阶段
 *
 * 功能：
 * 1. 空洞内容检查
 * 2. 详细事件描述提取
 * 3. 初步分类判断（A-F类）- 采用"内容本质优先级"
 * 4. 性质标记识别（推测性/发现型/营销性）
 * 5. 找角度推文识别（内部规则，不输出）
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
export const STAGE1_EVENT_PREPROCESSING_VERSION = 'V1.4';

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

**2.2 事件主体**：谁/什么组织参与其中？
- 示例：何一（币安联合创始人）、CZ、Tesla、Binance、当代年轻人
- ⚠️ **先判断是否为找角度推文或解读型回复**，再决定事件主体是谁
  - 找角度推文：事件主体 = 被引用事件中的参与者（不是推文发布者）
  - 解读型回复：事件主体 = 回复者（不是被回复的大IP），因为代币概念来自回复者的解读
  - 非找角度且非解读型回复：事件主体 = 正常判断

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
- 判断事件主体是否为超大IP（何一、CZ、Elon、Trump等）
- 超大IP的定义：有全球影响力，其任何动作都可能成为新闻

═══════════════════════════════════════════════════════════════════════════════

📋 **第三步：初步分类判断**

🎯 **基于第二步输出**，判断事件属于哪个类别（6个核心类别，互斥且完备）

**【A类：人物言论类】**
- 个人/账号的公开发言、表态、观点、动态
- 包括：原创言论、回复互动（回复内容即为大IP原话）、转发言论
- 示例：何一发推"Everything is number"
- ⚠️ 如果回复中代币概念来自回复者自己的解读（非大IP原话）→ 归为F类（解读型回复），不归A类

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

**⚠️ 找角度推文的分类**：
- 找角度推文应该按**"推文陈述的事情"**来分类，不是按"某人发推"分类
- 示例：推文"Trump posted this baby" → 事件是"Trump发布Baby Trump" → 归为B类（IP概念推出）
- 示例：推文"CZ说XX" → 事件是"CZ的言论" → 归为A类（人物言论类）
- 示例：推文"Tesla发布新车" → 事件是"Tesla发布新车" → 归为C类（产品发布）

**⚠️ 找角度推文的"叙事关联型"识别**：
- 如果推文的核心不是报道某个具体事件，而是**关联多个信息点，发现/揭示某种模式、数字关联、概念规律** → 归为E类（社会热点/现象，发现型）
- 判断标准：推文的结论/核心论点是"发现了一个叙事/模式/概念"，而不是"某件事发生了"
- 示例：推文"CZ 4月8日发书 + Binance多次提48 + 跟67一样的叙事" → 核心不是报道CZ发书，而是发现"48"这个数字叙事 → 归为E类（数字叙事发现）
- 示例：推文"某IP连续3次提到XX + XX与YY有关联 + 这是一个被低估的叙事" → 核心是发现概念关联 → 归为E类

**⚠️ 【解读型回复的识别与分类】**

当主推文是回复大IP的推文时，需要判断代币概念来源于哪条推文：

**判断方法**：代币名/核心概念能否从**被回复推文（大IP的推文）**中直接找到？

✅ **能直接找到** → A类（事件主体 = 大IP）
   - 大IP原话中包含了币的核心概念
   - 示例：CZ说"We make impact" → 币名"IMPACT" → A类
   - 示例：CZ说"buy the dip" → 币名"buy the dip" → A类

❌ **不能直接找到（是回复者的解读/总结）** → F类（事件主体 = 回复者）
   - 币的概念是回复者自己总结/解读出来的
   - 大IP并未直接表达这个概念
   - 示例：CZ说"I knew a Binance Angel who bought then and held on for multiple years"
     → 回复者说"BNB always rewards conviction" → 币名"信念/conviction"
     → "conviction"是回复者的解读，CZ没说 → F类
   - 示例：CZ分享书中故事（BNB上线日经历）
     → 回复者说"不仅要学会buy the dip，更重要的是学会buy the early"
     → "buy the early"是回复者的总结 → F类

**⚠️ 解读型回复 vs 找角度推文的区别**：
- 找角度推文：发币人不与大IP互动，只是引用外部事件
- 解读型回复：发币人确实在回复大IP的推文，是真实互动
- 两者的共同点：代币概念都不是大IP直接说的
- 两者的区别：解读型回复有真实的互动关系（在推文线程中）

**F类解读型回复的事件描述规则**：
- eventSubject = 回复者（不是大IP）
- isLargeIP = 基于回复者判断（通常为false，除非回复者也是大IP）
- eventTheme = "XX回复了[大IP]的推文并表达观点"
- eventContent = 以"XX回复了[大IP]的推文"开头，描述回复者表达了什么观点
- 大IP仍列入keyEntities（作为背景信息）

**判断优先级**（当事件可能属于多个类别时）：

🎯 **核心原则**：按"内容本质"判断，问自己"这个事件的核心内容是什么？"

📊 **内容本质优先级**（从高到低）：
1️⃣ B类（IP概念推出） - 新概念/新IP的诞生
2️⃣ A类（个人言论） - 观点/表态的表达
3️⃣ C类（产品发布） - 实体内容的推出
4️⃣ D类（机构动作） - 组织的商业行为
5️⃣ E类（社会现象） - 群体性的热点
6️⃣ F类（互动传播） - 内容的二次传播 + 解读型回复（回复大IP但概念来自回复者）

⚠️ **重要说明**：
- F类用于"纯互动"（点赞、转发但无评论）和"解读型回复"（回复大IP但币的概念来自回复者自己的解读）
- 如果回复中有具体内容，但币的概念来自回复者（非大IP原话） → 归为F类（解读型回复）
- 如果回复中有具体内容，且币的概念来自大IP原话 → 按内容本身归类（A类等）
- 日常运营（如新池子上币）直接阻断，不参与优先级比较
- **当推文同时包含"具体事件提及"和"概念/模式发现"时**：如果推文的结论/核心论点是"发现了一个叙事/模式/概念"，优先归为E类（社会现象），即使推文提及了具体事件（如产品发布、人物言论）

✅ **示例**：
- "Trump发布Baby Trump" → B类（核心是IP推出）
- "何一发推'Everything is number'" → A类（核心是观点表达）
- "Tesla发布新车" → C类（核心是产品发布）
- "CZ回复推文" → 看回复内容，可能是A类或其他
- "大V转发（无评论）" → F类（纯互动）
- "@TCryptochicks回复CZ推文并总结出'conviction'概念（CZ没说这个词）" → F类（解读型回复）

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
- propertyMarkers中的reason字段要具体说明，不要只填true/false
`;
}
