/**
 * Stage 2: 详细评分Prompt
 * 四维度100分评分框架
 *
 * V8.2 - 两阶段架构的第二阶段（配合Stage 1修复）
 * - 只在Stage 1通过后执行
 * - 提供完整的评分框架
 * - Stage 1已验证实体识别，此阶段专注于评分
 * - 关联强度增加副标题/部分匹配说明
 */

import { buildTwitterSection } from './sections/twitter-section.mjs';
import { buildWebsiteSection } from './sections/website-section.mjs';
import { buildVideoSection } from './sections/video-section.mjs';
import { buildGithubSection } from './sections/github-section.mjs';
import { buildWeiboSection } from './sections/weibo-section.mjs';
import { buildWeixinSection } from './sections/weixin-section.mjs';
import { buildAmazonSection } from './sections/amazon-section.mjs';
import { buildXiaohongshuSection } from './sections/xiaohongshu-section.mjs';
import { generateAccountBackgroundsPrompt } from './account-backgrounds.mjs';

/**
 * 构建Stage 2详细评分Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的数据结果
 * @returns {string} Stage 2 Prompt
 */
export function buildDetailedScoringPrompt(tokenData, fetchResults) {
  const {
    twitterInfo = null,
    websiteInfo = null,
    extractedInfo = null,
    backgroundInfo = null,
    githubInfo = null,
    youtubeInfo = null,
    douyinInfo = null,
    tiktokInfo = null,
    bilibiliInfo = null,
    xiaohongshuInfo = null,
    weixinInfo = null,
    amazonInfo = null,
    classifiedUrls = null
  } = fetchResults;

  // 判断有哪些数据类型
  const hasGithub = !!githubInfo;
  const hasVideo = !!(youtubeInfo || douyinInfo || tiktokInfo || bilibiliInfo);
  const hasTwitter = !!(twitterInfo && (twitterInfo.text || twitterInfo.type === 'account'));

  const sections = [];

  // 1. 开头：代币信息
  const chainName = (tokenData.blockchain || tokenData.platform || 'BSC').toUpperCase();

  // 计算代币名称的字数（用于评分参考）
  const symbol = tokenData.symbol || '';
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
  // 简单计算：中文字符+所有其他字符都算（包含空格、标点）
  const charCount = symbol.length;

  sections.push(`你是代币叙事分析专家，负责评估**新发布的meme代币**的叙事质量。

【评估对象：新发布的meme币】

⚠️ **重要Context**：
- **评估对象**：发布时间很短的meme币（大多数在30分钟以内）
- **没有历史数据**：没有价格历史、没有人气积累、社区还在形成中
- **无法验证真实性**：叙事是否真实无法验证，默认为真（虚假由黑名单处理）
- **评估重点**：不是评估"这个币现在有多成功"，而是评估"这个叙事有没有爆发潜力"

**因此**：
- ✅ 关注叙事本身的传播潜力
- ✅ 假设叙事描述的信息是可信的（因为新币无法验证）
- ✅ 新币不需要已有加密社区，评估的是叙事本身的吸引力
- ❌ 对于找角度的推文，不要因"推文作者粉丝少/互动少"而减分

【代币信息】
- 代币Symbol：${tokenData.symbol}${tokenName ? ` (${tokenName})` : ''}（${charCount}字符）
- 代币地址：${tokenData.address}
- 所属链：${chainName}${chainName === 'BSC' ? '（币安智能链，CZ/何一相关叙事适用溢价规则）' : ''}`);

  if (extractedInfo.intro_en) sections[0] += `\n- 介绍（英文）：${extractedInfo.intro_en}`;
  if (extractedInfo.intro_cn) sections[0] += `\n- 介绍（中文）：${extractedInfo.intro_cn}`;

  // 显示所有分类的URL（从 classifiedUrls 获取）
  if (classifiedUrls) {
    // Twitter 推文
    const tweets = classifiedUrls.twitter?.filter(u => u.type === 'tweet') || [];
    if (tweets.length > 0) {
      sections[0] += `\n- Twitter推文：${tweets.map(u => u.url).join(', ')}`;
    }
    // Twitter 账号
    const accounts = classifiedUrls.twitter?.filter(u => u.type === 'account') || [];
    if (accounts.length > 0) {
      sections[0] += `\n- Twitter账号：${accounts.map(u => u.url).join(', ')}`;
    }
    // 微博
    if (classifiedUrls.weibo?.length > 0) {
      sections[0] += `\n- 微博：${classifiedUrls.weibo.map(u => u.url).join(', ')}`;
    }
    // YouTube
    if (classifiedUrls.youtube?.length > 0) {
      sections[0] += `\n- YouTube：${classifiedUrls.youtube.map(u => u.url).join(', ')}`;
    }
    // TikTok
    if (classifiedUrls.tiktok?.length > 0) {
      sections[0] += `\n- TikTok：${classifiedUrls.tiktok.map(u => u.url).join(', ')}`;
    }
    // 抖音
    if (classifiedUrls.douyin?.length > 0) {
      sections[0] += `\n- 抖音：${classifiedUrls.douyin.map(u => u.url).join(', ')}`;
    }
    // Bilibili
    if (classifiedUrls.bilibili?.length > 0) {
      sections[0] += `\n- Bilibili：${classifiedUrls.bilibili.map(u => u.url).join(', ')}`;
    }
    // 微信公众号文章
    if (classifiedUrls.weixin?.length > 0) {
      sections[0] += `\n- 微信文章：${classifiedUrls.weixin.map(u => u.url).join(', ')}`;
    }
    // GitHub
    if (classifiedUrls.github?.length > 0) {
      sections[0] += `\n- GitHub：${classifiedUrls.github.map(u => u.url).join(', ')}`;
    }
    // Amazon
    if (classifiedUrls.amazon?.length > 0) {
      sections[0] += `\n- Amazon：${classifiedUrls.amazon.map(u => u.url).join(', ')}`;
    }
    // 普通网站
    if (classifiedUrls.websites?.length > 0) {
      sections[0] += `\n- 网站：${classifiedUrls.websites.map(u => u.url).join(', ')}`;
    }
    // Telegram
    if (classifiedUrls.telegram?.length > 0) {
      sections[0] += `\n- Telegram：${classifiedUrls.telegram.map(u => u.url).join(', ')}`;
    }
    // Discord
    if (classifiedUrls.discord?.length > 0) {
      sections[0] += `\n- Discord：${classifiedUrls.discord.map(u => u.url).join(', ')}`;
    }
  }

  // 2. 账号背景信息
  const backgrounds = generateAccountBackgroundsPrompt(twitterInfo);
  if (backgrounds) sections.push(backgrounds);

  // 3. 数据sections（Twitter、微博、GitHub、视频、网站）
  const twitterSection = buildTwitterSection(twitterInfo);
  if (twitterSection) sections.push(twitterSection);

  const weiboSection = buildWeiboSection(backgroundInfo);
  if (weiboSection) sections.push(weiboSection);

  const githubSection = buildGithubSection(githubInfo);
  if (githubSection) sections.push(githubSection);

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

  // 4. 评分框架
  sections.push(buildEvaluationFramework(hasGithub, hasVideo, hasTwitter));

  // 5. 实体识别说明（简化版）
  sections.push(buildEntityNote());

  // 6. 评级标准和输出格式
  sections.push(buildRatingStandards());

  return sections.filter(s => s).join('\n\n');
}

/**
 * 构建实体识别说明（简化版）
 */
function buildEntityNote() {
  return `
⚠️ **关键实体**（影响评分）：
- CZ = 币安创始人 | 何一 = 币安联合创始人 | SBF = FTX创始人
- ELON/MUSK = Elon Musk | TRUMP = Trump
`;
}

/**
 * 构建评估框架
 */
function buildEvaluationFramework(hasGithub, hasVideo, hasTwitter) {
  const lines = [];

  // 分析原则
  lines.push(`【分析原则】
- **代币名称匹配即视为有效关联**
- **meme币不需要"官方代币"等表述**，名称匹配即可
- **新币不需要已有加密社区**：评估的是叙事本身的传播潜力

【评分维度（总分100分）】
1. **叙事强度（0-50分）= 叙事影响力（0-25分）+ 关联强度（0-25分）**
   - 叙事影响力：叙事本身的影响力、热度
   - 关联强度：代币与叙事背景的关联程度

2. **传播潜力（0-50分）= 内容传播力（0-25分）+ 代币质量（0-25分）**
   - 内容传播力：社交属性、情感共鸣、FOMO效应、话题性
   - 代币质量：名字长度、meme程度（诙谐易传播 vs 古板无趣）
`);

  // 评估步骤
  lines.push(`【评估步骤】`);

  // 找角度推文的特殊说明（在评分标准前）
  if (hasTwitter) {
    lines.push(`
**⚠️ 找角度推文的评估说明（非常重要！）**

**什么是"找角度"推文？**
- 发币人借用当前热点事件/产品/新闻来发币
- 推文内容不是原创事件，而是"解读/评论/引用"某个外部事件

**如何识别找角度推文？**
✅ **是找角度推文**的典型特征：
1. 推文提到"首个XXX"、"XXX正式上线"等产品发布新闻
2. 推文引用了公司/品牌的产品或事件（如百度、Apple、Tesla等）
3. 推文有Website/视频链接，指向品牌官网、新闻文章、视频平台（抖音、B站、TikTok、YouTube等）等外部内容
4. 推文作者粉丝很少（<1000），但内容讨论的是大品牌/大事件/热门视频IP
5. 推文内容是新闻报道式、产品介绍式的语气
6. 推文提到"抖音新IP"、"B站热传"、"TikTok爆款"等视频平台热门内容
7. 推文提到视频播放量（如"上百万浏览"、"千万播放"）但作者本身粉丝很少

❌ **不是找角度推文**的特征：
1. 推文作者本人就是大V（粉丝>1万）或有影响力的人物
2. 推文内容是作者原创的、有个人观点的内容
3. 推文没有引用外部事件或产品

**找角度推文如何评分？**
- ⚠️ **叙事影响力**：评估被引用的事件/品牌的影响力，而不是主推文作者
  - 示例：推文借用百度产品发布 → 评估百度品牌影响力（15-20分），而不是推文作者粉丝数（30粉丝）
  - 示例：推文引用抖音爆款IP → 评估视频IP热度（10-18分），而不是推文作者粉丝数
  - ⚠️ **品牌产品/营销发布类上限**：如果引用的是品牌产品营销发布（非重大产品发布，如新品广告、联名款、常规功能更新等），叙事影响力最高11分（按细分市场品牌评分）
  - ⚠️ **视频平台IP上限**：抖音/快手/B站等平台热门内容属于平台级内容，最高18分
- ⚠️ **内容传播力**：评估被引用内容的传播属性，而不是主推文的互动量
  - ⚠️ **品牌产品/营销发布类上限**：品牌营销发布类内容缺乏病毒传播属性，内容传播力最高10分
  - ⚠️ **视频平台IP**：需要评估视频内容本身的传播属性（是否有梗、是否引发模仿、是否有情感共鸣）
- ⚠️ **完全忽略**主推文作者的粉丝数、点赞数、转发数——这些数据与找角度推文质量无关
- 评估重点是：被引用事件/品牌本身的热度 + 代币与事件的关联度 + 事件本身的传播属性

**其他推文（默认情况）**：
- 推文作者影响力是叙事影响力的组成部分
- 需要评估推文作者的影响力和代币与推文内容的关联度`);
  }

  // 评分标准
  lines.push(`
**评分标准**

**评分结构（总分100分）：**
- **叙事强度（0-50分）** = 叙事影响力（0-25分）+ 关联强度（0-25分）
- **传播潜力（0-50分）** = 内容传播力（0-25分）+ 代币质量（0-25分）

---

**1. 叙事强度评分（0-50分）**

**叙事影响力（0-25分）**：叙事本身的影响力、热度

⚠️ **BSC链CZ/何一近期强相关事件**：
- **CZ/何一的近期强相关事件**（自传出版、重大声明、新动态等）→ 22-25分
- 理由：Web3垂直领域但CZ影响力顶级，且是近期事件，市场预期CZ会回应
- 示例：CZ自传/回忆录出版、CZ近期重大声明 → 22-25分
- ⚠️ 非近期事件或弱相关事件 → 按常规标准评分，不适用此溢价

⚠️ **Web3领域事件分级（代币交易者视角）**：
- **所有Web3相关事件/项目，必须按Web3领域影响力评分，不按大众影响力评分**
- **理由**：代币交易者都是Web3用户，Web3项目在该群体中的影响力才是关键，而非大众知名度
- **Web3平台级项目**（头部DEX、公链、L2、知名协议）→ 20-24分
  - 示例：Aster/Astherus、Uniswap、币安相关项目、主流L2
  - 判断依据：认证项目账号+粉丝数>5万 或 知名Web3品牌
- **Web3知名项目/KOL**（认证账号+粉丝>1万）→ 15-19分
- **社区级讨论**→ 5-14分

⚠️ **地域限制**：
- **地方性话题**（地方球队、地方新闻、地方活动）即使有地方媒体报道 → **最高15分**
- 示例：地方足球队吉祥物、省级媒体报道本地事件 → 最高10-15分
- 理由：地方性话题影响力有限，无法与全国性/世界级话题相比

*数据来源：事件本身（找角度推文）*
- ⚠️ **判断标准**：如果推文内容是引用/报道某个外部事件（如产品发布、品牌新闻），则评估该事件/品牌本身的影响力，而不是主推文作者
- 世界级事件（政府meme、顶级国际事件）→ 20-25分
- **顶级科技品牌事件** → 18-25分
  - 判断标准：
    1. 市值超千亿美元
    2. 产品影响全球用户（非细分市场）
    3. 品牌本身是全球性话题
  - 示例：Apple、Google、Microsoft、Tesla、百度、阿里、腾讯、字节
  - ⚠️ 外设品牌（罗技、雷蛇）、PC品牌（戴尔、惠普）等细分市场品牌不算，按细分市场品牌评分（5-11分）
  - 理由：顶级科技品牌在中国有巨大影响力，产品发布是重大事件
- **视频平台热门内容/IP**（抖音爆款、B站热门、TikTok病毒视频等）→ 10-18分
  - 判断依据：推文提到播放量（百万、千万级）或描述为"爆款"、"热传"、"新IP"
  - 高播放量（千万+）或引发全网讨论 → 15-18分
  - 中等热度（百万播放）→ 10-14分
  - ⚠️ **上限说明**：视频平台IP属于平台级内容，影响力限于平台用户群体，最高18分
- 平台级事件（微博/抖音/Bilibili等平台上线新功能）→ 15-24分
  - 首个/首创类 → 20-24分
  - 主流平台常规功能 → 15-19分
  - 社区级情感叙事（强情感共鸣+文化符号）→ 15-24分
- 社区级事件（圈内讨论热点）→ 5-14分
- 其他品牌背书（明确提到XX官方/品牌）→ 按品牌级别细分
  - 区域/细分市场品牌（Tod's Japan、特定领域品牌）→ 5-11分
  - 小品牌/地方品牌 → 0-4分
- 无明确影响力 → 0-4分

*数据来源：推文作者（默认情况）*
- 世界级人物（Trump、Musk、拜登、CZ/何一）→ 20-25分
- 认证用户+高互动（点赞>1000或转发>500）→ 15-24分
- 普通有影响力账号（粉丝>10000）→ 10-19分
- 普通用户 → 0-9分

**关联强度（0-25分）**：代币与叙事背景的关联程度

- **强关联**（20-25分）：代币名称直接出现在叙事内容中
  - **完全匹配**：代币名与核心关键词完全相同
  - **副标题/部分匹配**：代币名匹配书籍/内容的副标题、别名或核心组成部分
    - 示例：书名《主标题：副标题》，代币名是"副标题" → 强关联
    - 示例：推文提到"XXX的伞"，代币名是"伞" → 强关联
  - **直接引用**：代币名被直接提及或作为核心元素

- **中关联**（10-19分）：代币名称与叙事有合理联系，但不是直接引用
  - 示例：事件是AI技术突破，代币名是"AI助手"
  - 示例：代币名与叙事关键词有主题上的相关性

- **弱关联**（0-9分）：代币名称勉强相关
  - 示例：代币名与事件内容联系较弱

---

**2. 传播潜力评分（0-50分）**

**内容传播力（0-25分）**：社交属性、情感共鸣、FOMO效应、话题性

⚠️ **地域限制（必须首先检查）**：
- **地方性事件/话题**（地方球队、地方新闻、地方活动）→ **最高12分**
- 示例：地方足球队吉祥物发布、省级媒体报道本地事件 → 最高8-12分
- 理由：地方性事件传播范围限于当地，缺乏病毒传播潜力

⚠️ **重要区分：平台属性 ≠ 地域限制**
- **全国性平台**（抖音、快手、B站、微博、微信视频号等）的内容 **不是地域限制**
- 理由：这些平台覆盖全国用户，内容可跨地域传播
- **地域限制仅指**：真正局限于某个城市/省份的地方性话题
  - 示例（触发地域限制）："长沙下雨"、"北京堵车"、"上海某餐厅"
  - 示例（不触发）：抖音爆款视频、B站热门内容、微博热搜话题

⚠️ **叙事内容语言调整（推文/内容语言）**：
- 如果叙事语言非中英文（如日语、泰语等）→ **降低1-2档（-5至-10分）**
- ⛔ **豁免**：中文⇄英文互译不算语言不匹配

**按内容类型评分**：
- 强创意+高社会讨论价值（如首个AI功能、病毒话题、引发全民讨论）→ 20-25分
- 有一定创意+话题性 → 15-19分
- 普通内容 → 8-14分
- **工具/功能发布类**（推广某个工具、功能、产品）→ 0-10分
  - 即使描述有趣，但本质是功能推广，不是病毒传播内容
  - 示例："防阿峰装置"、"XXX交易工具"、"XXX助手"等功能发布
- **品牌产品/营销发布类**（品牌推出新产品、联名款等）→ 3-10分
  - 品牌营销发布缺乏病毒传播属性，主要是品牌粉丝关注
  - 示例：品牌推出新包款、联名产品等
- 内容平淡/无趣 → 0-7分

**代币质量（0-25分）**：meme程度、名字长度、易记性、语言匹配度

⚠️ **字数统计规则（必须严格执行）**：
- **中文**：每个汉字、标点符号、空格都算1个字
  - 示例："像狗一样跑过来" = 7字（像狗一样跑过来，7个字符）
  - 示例："硅基茶水间" = 5字（硅基茶水间）
- **英文**：每个字母、标点符号、空格都算1个字符
  - 示例："Duck" = 4字符
  - 示例："Mini Trump" = 10字符（Mini_Trump，含空格）
  - 示例："Moon Bag" = 9字符（Moon_Bag，含空格）
- ⚠️ **严格按照字符总数评分，不要少算或多算**

⚠️ **代币名称语言调整（代币符号语言）**：
- 非中英文名称（如日语、泰语、韩语等）→ **降低1档（-5分）**
- 示例：日语"フォーバッグ"从15分降到10分
- 输出要求：应用调整需在reasoning中说明"日语名称-5分"

⚠️ **首先判断名称类型，然后按meme程度评分（评分后再应用语言调整）：**

**类型A：功能性/技术性名称**（工具、平台、功能、技术术语等）→ **0-10分**
- 即使字数少，也因为不是meme而低分
- 示例："防阿峰装置"、"TokenHub"、"AI助手"、"交易工具"
- 理由：功能性名称缺乏meme属性，不易形成病毒传播

**类型B：meme名称**（有趣、诙谐、有梗、易传播）→ 按中英文字数细分

⚠️ **中文字数包含标点和空格，英文按单词数优先**：

**中文meme名称**（按字数）：
- **高质量**（20-25分）：1-2字、简短、直观、易记
  - 示例："伞"、"狗"、"鸡"、"马"
- **中等质量**（10-19分）：3-5字、有一定意义但不突出
  - 示例："硅基茶水间"（5字）、"来根麻子"（4字）
- **低质量**（0-9分）：6+字、过长、难记
  - 示例："像狗一样跑过来"（7字）、"绿水青山就是金山银山"（10字）

**英文meme名称**（按单词数优先）：
- **高质量**（20-25分）：1个单词、简短直观
  - 示例："Duck"、"Dog"、"Pepe"
- **中等质量**（10-19分）：2个单词、有一定意义
  - 示例："Mini Trump"、"Moon Bag"、"DogeCoin"
- **低质量**（0-9分）：3个单词以上、过长难记
  - 示例："Fight For Freedom"、"Silicon Valley Tech"

**类型C：人名/IP名** → 取决于IP本身的传播力（在叙事影响力中体现），代币质量中等（10-15分）

**类型D：品牌组合词**（品牌名+概念词的组合）→ **10-20分**
- **评分标准**：即使总字符数超过6个，如果是有意义的品牌组合词，给予中等偏上分数
- **示例**：
  - "ASTERCLAN"（Aster品牌+Clan社群概念）→ 15-18分
  - "BINANCEVIP"（Binance品牌+VIP概念）→ 15-18分
  - "TESLACOIN"（Tesla品牌+Coin）→ 12-16分
- **判断依据**：
  1. 前半部分是知名品牌/项目名称
  2. 后半部分是有意义的英文概念（如Clan、VIP、Coin、DAO等）
  3. 组合后有明确含义
- **理由**：品牌组合词虽然字数多，但有强品牌背书和明确含义，传播力优于普通长名称

---

【重要补充说明】

**1. 特殊情况处理**

**双推文**：如果有主推文+Website推文，以影响力高的为准（粉丝数多、互动量高）

**推文有配图/视频**：
- 注意：有媒体的推文可能在预检查阶段被拦截（高影响力账号+媒体 → unrated）
- 如果进入评分阶段，重点评估推文互动量和文本内容
  - 高互动（点赞>5000）→ 内容传播力20-25分
  - 中等互动（点赞500-5000）→ 内容传播力15-19分
  - 低互动（点赞<500）→ 内容传播力8-14分

**推文@用户**：@知名/加密用户→建立背书关联

**信息在外部平台**（Telegram/Discord/小红书等）→unrated`);

  // 第三步：综合评分
  lines.push(`

**第三步：综合评分**

根据第二步的评分标准和补充说明，给出最终评分：

**输出格式要求**：
- reasoning必须明确说明四个维度的评分
- 格式示例："叙事影响力20分（世界级事件）+关联强度15分（中关联），内容传播力18分+代币质量12分（4字中等）"
- 必须说明关联强度：强关联(20-25)/中关联(10-19)/弱关联(0-9)
- 必须说明代币质量：高质量(1-3字,20-25)/中等质量(4-6字,10-19)/低质量(7+字,0-9)`);

  return lines.join('\n');
}

/**
 * 构建评级标准和输出格式
 */
function buildRatingStandards() {
  return `
【评级定义】

- **low**： 总分<55
- **mid**：总分≥55
- **high**：总分≥75

【输出格式】

**正常评分输出（包含scores）:**
{"reasoning":"必须说明四个维度的评分：叙事影响力(X/25)+关联强度(X/25)，内容传播力(X/25)+代币质量(X/25)","scores":{"credibility":0-50,"virality":0-50},"total_score":0-100,"category":"high/mid/low"}

**无法理解输出（不包含scores）:**
{"category":"unrated","reasoning":"说明无法理解代币性质的原因"}

⚠️ **reasoning格式要求**：
1. 必须说明四个维度的评分
2. 必须说明关联强度：强关联(20-25)/中关联(10-19)/弱关联(0-9)
3. 必须说明代币质量：高质量(1-3字,20-25)/中等质量(4-6字,10-19)/低质量(7+字,0-9)
`;
}
