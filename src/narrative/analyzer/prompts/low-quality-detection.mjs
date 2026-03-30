/**
 * Stage 1: 低质量检测Prompt
 * 三阶段低质量检测流程
 *
 * V11.1 - 新增"学术圈事件"检测场景
 * - 第三阶段增加scenario 4：学术圈事件检测
 * - 学术圈的绝大多数事件都不适合构建meme币
 * - 豁免条件：与Web3有交集、世界性大事件、大IP参与、有meme属性
 *
 * V11.0 - 重大重构：三阶段检测流程
 * - 将原有结构重构为三个清晰的阶段
 * - 第一阶段：内容空洞/无意义事件检查
 * - 第二阶段：代币/语料核心实体匹配检查
 * - 第三阶段：低传播能力代币检查
 * - 保留所有已有的规则和判断标准
 * - 优化命名和结构，提高可读性和可维护性
 * - 输出格式增加stage字段，明确标识触发阶段
 *
 * V10.6 - 合并"功能性符号/标志"到"纯通识知识/百科内容"
 * - 两者高度重叠：功能性符号/标志属于通识知识/百科内容的范畴
 * - 在场景3中明确包含功能性符号/标志的内容类型
 * - 场景数量从4种减少到3种
 *
 * V10.5 - 删除冗余的低质量场景
 * - 删除场景1"大IP蹭热度"（前置检查已覆盖：代币名在实体中即pass）
 * - 删除场景3"纯报道热搜"（步骤0已覆盖：空洞内容/琐碎小事）
 * - 场景数量从5种减少到4种
 *
 * V10.4 - 删除场景1"泛泛情感概念"
 * - 该场景与步骤0"空洞内容/无实质内容"高度重叠
 * - 步骤0的判断标准已覆盖：无故事/情节、无数据/分析、去掉代币名后无信息价值
 * - 场景数量从6种减少到5种
 *
 * V10.3 - 删除场景1"账号信息与代币无明显关联"
 * - 前置检查的步骤1已增加"Twitter账号"的实体识别规则
 * - 账号名/品牌名、账号所属机构等均作为核心实体列出
 * - 前置检查已覆盖"账号名与代币名是否匹配"的判断
 * - 场景数量从7种减少到6种
 *
 * V10.2 - 删除冗余的低质量场景
 * - 删除场景1"硬蹭/弱关联"（前置检查已覆盖）
 * - 删除场景1"纯谐音梗"（前置检查已覆盖）
 * - 谐音梗加入到步骤2的"不算匹配"示例中
 * - 场景数量从9种减少到7种
 *
 * V10.1 - 简化步骤3逻辑
 * - 移除"超大IP是否有具体事件"的重复判断
 * - 步骤2已详细说明匹配规则，步骤3只需简单执行判断结果
 * - 超大IP背书（即使是空洞推文）由步骤0豁免处理
 *
 * V10.0 - 新增"步骤0：内容空洞检查"
 * - 在前置检查之前先检查内容是否空洞
 * - 如果所有语料都是空洞的，直接返回low（scenario=0）
 * - 内容空洞 = 无法形成meme传播 = 不需要判断是否硬蹭
 * - 示例："发送正确的名称链上Binance"、"XX上线"等空洞内容
 *
 * V8.9 - 修复产品名称中英文对应未识别的问题
 * - 扩展中英文对应规则，包括产品/服务名称和品牌名称
 * - 明确"币安VIP"（中文）vs "Binance VIP"（英文）是匹配的
 * - 添加详细的中英文对应判断标准和示例
 *
 * V8.8 - 修复关联实体导致误判的问题
 * - 明确只判断代币名本身是否是超大IP，不看关联实体
 * - 示例：代币名"AgentPay"不是超大IP，即使实体包含"World Liberty（Trump相关）"，也应立即pass
 * - 修复"AgentPay"被误判为硬蹭Trump的问题
 *
 * V8.7 - 修复非超大IP被误判为硬蹭的问题
 * - 重构步骤3的逻辑结构，使判断流程更清晰
 * - 明确非超大IP只要名称匹配就立即pass，不做任何额外判断
 * - 修复"硅基茶水间"被误判为硬蹭的问题
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
import { buildWeiboSection } from './sections/weibo-section.mjs';
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
    extractedInfo = null,
    backgroundInfo = null,
    classifiedUrls = null
  } = fetchResults;

  const sections = [];

  // 1. 代币基本信息
  sections.push(`你是代币叙事质量检测器。请判断以下代币是否存在低质量问题。

【代币信息】
- 代币名称：${tokenData.symbol}
- 代币地址：${tokenData.address}`);

  // 显示介绍信息
  if (extractedInfo?.intro_en) sections[0] += `\n- 介绍（英文）：${extractedInfo.intro_en}`;
  if (extractedInfo?.intro_cn) sections[0] += `\n- 介绍（中文）：${extractedInfo.intro_cn}`;

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

  // 3. 推文内容
  const twitterSection = buildTwitterSection(twitterInfo);
  if (twitterSection) sections.push(twitterSection);

  // 3.5 微博内容
  const weiboSection = buildWeiboSection(backgroundInfo);
  if (weiboSection) sections.push(weiboSection);

  // 4. 网站内容
  const websiteSection = buildWebsiteSection(websiteInfo);
  if (websiteSection) sections.push(websiteSection);

  // 5. Amazon产品内容
  const amazonSection = buildAmazonSection(amazonInfo);
  if (amazonSection) sections.push(amazonSection);

  // 6. 低质量场景判断标准
  const stage2Rules = [];

  // 步骤2.1的规则：根据实际语料类型动态添加
  // 基础规则（总是包含）
  stage2Rules.push(`- **书籍标题/产品名称是核心实体的一部分**，必须列出`);
  stage2Rules.push(`- ⚠️ **中文名称必须列出**：如果语料中同时出现中英文名称，两者都要列出`);
  stage2Rules.push(`  - 示例：推文有"东莞崇英学校"和"Dongguan Chongying School"，两个都要列出`);
  stage2Rules.push(`  - 示例：推文有"CZ"和"Changpeng Zhao"，两个都要列出`);

  // Twitter账号实体识别规则（条件性：如果有Twitter账号信息）
  if (twitterInfo && twitterInfo.type === 'account') {
    stage2Rules.push(``);
    stage2Rules.push(`⚠️ **Twitter账号的实体识别规则**（检测到Twitter账号，必须严格执行）：`);
    stage2Rules.push(`  - **账号名/账号品牌名**：账号的screen_name或品牌名必须作为实体列出`);
    stage2Rules.push(`    - 示例：账号@FoxNews → 实体包括"FoxNews"、"Fox News"`);
    stage2Rules.push(`    - 示例：账号@Tesla → 实体包括"Tesla"`);
    stage2Rules.push(`    - 示例：账号@realDonald_Trump → 实体包括"realDonald_Trump"、"Donald Trump"`);
    stage2Rules.push(`  - **账号所属机构/公司名**：如果账号简介或背景中提及所属机构，必须作为实体列出`);
    stage2Rules.push(`    - 示例：账号@NBA（NBA官方账号）→ 实体包括"NBA"、"National Basketball Association"`);
    stage2Rules.push(`  - **账号关联人物/品牌**：如果账号与知名人物或品牌关联，必须作为实体列出`);
    stage2Rules.push(`    - 示例：账号@Tesla（特斯拉官方账号）→ 实体包括"Tesla"、"Elon Musk"`);
  }

  // Amazon书籍实体识别规则（条件性：如果有Amazon信息）
  if (amazonInfo) {
    stage2Rules.push(``);
    stage2Rules.push(`⚠️ **Amazon书籍的实体识别规则**（检测到Amazon内容，必须严格执行）：`);
    stage2Rules.push(`  - **书的全称**：完整书名必须作为实体列出`);
    stage2Rules.push(`    - 示例：书名"FREEDOM OF MONEY: Fight For Freedom" → 实体包括"FREEDOM OF MONEY: Fight For Freedom"`);
    stage2Rules.push(`  - **主标题**：冒号或副标题符号之前的部分必须作为实体列出`);
    stage2Rules.push(`    - 示例：书名"FREEDOM OF MONEY: Fight For Freedom" → 主标题实体"FREEDOM OF MONEY"`);
    stage2Rules.push(`  - **副标题**：冒号或副标题符号之后的部分必须作为实体列出`);
    stage2Rules.push(`    - 示例：书名"FREEDOM OF MONEY: Fight For Freedom" → 副标题实体"Fight For Freedom"`);
    stage2Rules.push(`  - **作者**：作者名称必须作为实体列出`);
    stage2Rules.push(`    - 示例：作者"Changpeng Zhao" → 实体"Changpeng Zhao"`);
    stage2Rules.push(`    - 示例：作者"CZ" → 实体"CZ"`);
    stage2Rules.push(`  - ⚠️ **注意**：副标题匹配也算强关联，代币名匹配副标题 = 匹配实体`);
  }

  sections.push(`【🚨 三阶段低质量检测流程】

⚠️ **请按顺序依次执行以下三个阶段的检查，一旦某个阶段触发结果，立即返回对应JSON！**

═══════════════════════════════════════════════════════════════

📋 **第一阶段：内容空洞/无意义事件检查**

🎯 **目的**：判断语料是否有基本的信息价值
📌 **执行时机**：最先执行
⚠️ **如果所有语料都空洞或事件无意义，直接返回low，无需继续判断！**

**1.1 空洞内容/无实质内容检查**：所有语料都是空洞的，缺乏具体事件/故事/观点
   - ⚠️ **核心判断：去掉代币名后，语料是否还有独立的信息价值？**
   - 如果所有语料都空洞 → **立即返回pass=false, stage=1**
   - 如果有任何语料不空洞 → **继续执行1.2检查**
   - **空洞语料的特征**：
     - 只是提到某个名称 + 简单修饰词/表情，无具体内容
     - 示例："链上 Binance"、"XX牛逼"、"buy XX"、"🚀 XX"
     - 这些内容去掉代币名后没有任何信息价值
   - **⛔ 豁免：以下情况不算空洞**：
     - **知名meme币发行平台的官方账号背书**：Pump.fun、pump.fun、Four.meme等官方账号的推文
       - 示例：Pump.fun官方账号（@Pumpfun）发推 → 非空洞（平台背书本身就是事件）
       - 理由：这些平台是meme币发行的核心阵地，官方账号推文代表平台认可
     - **知名机构/品牌的官方公告**：Binance/Coinbase/Apple/Google等官方账号发布产品/功能公告
       - 示例：Binance官方推文"Binance Ai Pro. Coming soon!" → 非空洞（官方产品公告）
       - 理由：知名机构的产品发布本身就是有信息价值的事件
     - **粉丝团口号式情感表达**：使用可复用模板表达强烈支持/情感认同
       - 示例："if XX have a million fans, then I am one of them..." → 非空洞（经典粉丝口号）
       - 理由：这是粉丝文化中常见的情感表达方式，有独立的传播价值
     - **具体事件描述**：谁做了什么、发生了什么
     - **故事/情节**：角色、情节、故事发展
     - **数据/分析**：具体数据、分析、观点
   - **判断标准（所有语料都满足才算空洞）**：
     1. **无具体事件**：没有事件描述（谁做了什么、发生了什么）
     2. **无故事/情节**：没有角色、情节、故事发展
     3. **无数据/分析**：没有具体数据、分析、观点
     4. **独立测试失败**：去掉代币名后，语料无信息价值
     5. **⛔ 非知名机构公告**：不是Binance/Coinbase/Apple/Google等知名机构的官方公告

**1.2 无意义事件检查**：
   - ⚠️ **如果所有语料的事件都没有新闻价值或传播价值 → 立即返回pass=false, stage=1**
   - **无意义事件的类型**：
     - **平台日常运营**：新池子、上架新币、常规功能更新 → 无意义
     - **强行关联的弱逻辑**：仅凭首字母相同、谐音等弱关联 → 无意义
     - **琐碎小事**：日常操作、无意义的巧合 → 无意义
   - **示例**："aster新池子alien"、"都是a开头所以alien应该在aster上" → 触发
   - **排除：真正有意义的平台事件**（重大发布、战略升级、大人物动态）
   - 理由：事件无意义 = 无法形成meme传播 = 直接low

═══════════════════════════════════════════════════════════════

📋 **第二阶段：代币/语料核心实体匹配检查**

🎯 **目的**：判断代币名与语料是否有关联
📌 **执行时机**：第一阶段通过后执行
⚠️ **如果代币名不在核心实体中，说明无相关性，直接返回pass=false！**

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

⚠️ **这是第二道关卡，必须严格按照执行：**

**步骤2.1：列出每条语料的核心实体**（人名、组织名、产品名、事件名、昵称、称号、概念、书籍名、缩写等）
- ⚠️ **必须输出完整的实体列表**，用于验证是否正确识别加密圈实体
- ⚠️ **实体列表必须去重**：相同的实体只列出一次
  - 示例：推文中多次出现"Billy"，entities中只需列出一个"Billy"
  - 示例：推文中多次出现"Billy the Cat"，entities中只需列一个"Billy the Cat"
- 推文、Website、Amazon、Twitter账号要**分别列出**
${stage2Rules.length > 0 ? '\n' + stage2Rules.join('\n') : ''}

**步骤2.2：检查代币名是否在核心实体中**（推文/Website/Amazon/Twitter账号）
- ⚠️ **只做精确字符串匹配，不做推理或联想**
- ⚠️ **必须是完整匹配**：代币名必须**完整地**出现在实体列表中才算匹配
  - 示例：代币名"BNB Memoirs" → 实体必须包含"BNB Memoirs"才算匹配
  - 示例：实体只有"BNB" → **不算匹配**（只是部分包含）
  - 示例：代币名"Trump2024" → 实体包含"Trump" → **不算匹配**（必须完整包含"Trump2024"）
- **名称匹配不分大小写**：代币名"MEMEFATHER"与语料中的"Memefather"匹配
- **中英文对应也算匹配**：
  - **地名对应**：代币名"东莞崇英学校"与语料中的"Dongguan Chongying School"匹配
  - **产品/服务名称对应**：代币名"币安VIP"与语料中的"Binance VIP"匹配
  - **品牌名称对应**：代币名"特斯拉"与语料中的"Tesla"匹配
- **meme币的本质**：meme币就是借助语料中的实体/概念来传播的
  - 示例：推文称Elon Musk为"Memefather"，代币名"MEMEFATHER" → 匹配
  - 示例：Amazon书籍标题"Freedom of speech"，代币名"Freedom of speech" → 匹配
  - 示例：Website核心实体是"Binance VIP"，代币名"币安VIP" → 匹配（中英文对应）
  - 示例：Website核心实体是"Duck"，代币名"DUCK" → 匹配
  - 示例：推文说"饰演CZ"，代币名"CZ" → 匹配（CZ是加密圈核心人物）

⛔ **以下情况不算匹配**：
- **拼音首字母缩写**：代币名"HY"（何一拼音首字母）vs 实体"CZ" → 不匹配
- **英文单词缩写**：代币名"CM"（Community Manager缩写）vs 实体"Community Manager" → 不匹配
- **谐音梗**：代币名"生财"vs 实体"生菜" → 只是谐音，不匹配
- **推理关联**：代币名"Binance CEO"vs 实体"CZ" → 不是精确匹配，不匹配
- **行业关联**：代币名"Crypto"vs 实体"Bitcoin" → 不是精确匹配，不匹配

⚠️ **中英文对应的判断标准**：
- **专有名词翻译**：同一个专有名词的中英文版本算对应
  - 示例："币安VIP"（中文）vs "Binance VIP"（英文）→ 匹配
  - 示例："特斯拉"（中文）vs "Tesla"（英文）→ 匹配
  - 示例："东莞崇英学校"（中文）vs "Dongguan Chongying School"（英文）→ 匹配
- **通用的品牌/产品名**：如果是知名品牌/产品的标准翻译，算对应
  - 示例："苹果"vs "Apple"（品牌）→ 匹配
  - 示例："币安"vs "Binance"（品牌）→ 匹配
- ⚠️ **注意**：空格、大小写不影响匹配判断
  - 示例："币安VIP"与"Binance VIP"匹配（去掉空格差异后是同一词的翻译）
  - 示例："币安VIP"与"BinanceVIP"也匹配（空格不影响）

**步骤2.3：根据匹配结果执行**

- ⚠️ **如果代币名不在核心实体中（未满足步骤2.2的匹配规则）** → **立即返回pass=false, stage=2**
  - 理由：代币名不在核心实体中 = 无相关性 = 无法形成meme传播
- ⚠️ **如果代币名在核心实体中（满足步骤2.2的匹配规则）** → 继续执行第三阶段
  - 理由：代币名在核心实体中 = 有相关性 = 需要进一步检查质量

⛔ **禁止行为**：
- 一旦发现代币名不在核心实体中，**立即停止分析，直接返回pass=false**
- **绝对不允许**在发现不匹配后继续推理或判断第三阶段的场景
- 第二阶段未通过即pass=false，这是最终结论，不可推翻

═══════════════════════════════════════════════════════════════

📋 **第三阶段：低质量/低传播能力检查**

🎯 **目的**：判断有相关性的代币是否具备足够的传播潜力
📌 **执行时机**：第二阶段通过（代币名在核心实体中）后执行
⚠️ **即使有相关性，如果触发以下场景，仍返回low**

**3.1 语言不匹配**：推文语言与代币名称语言不匹配
   - ✅ **✅✅✅ 重要豁免：中文⇄英文不算语言不匹配 ✅✅✅**
     - **中文和英文共存是正常现象，不算语言不匹配！**
     - 示例：推文含中英文双语（中英混用）→ 不触发
     - 示例：推文是中文，代币名是英文 → 不触发
     - 示例：推文是英文，代币名是中文 → 不触发
     - 理由：加密圈主体用户中英文都会，中英互译是常见现象
   - ⚠️ **这是底线问题：语言不匹配 = 无法传播 = 返回pass=false, stage=3, scenario=1**
   - 示例：推文是英语（含"surprise"），代币名是日文"驚き" → 触发
   - 示例：推文是中文，代币名是泰语/韩语等非中英语言 → 触发
   - 理由：目标受众无法理解、无法记住、无法传播不同语言的代币名（除中英文互译外）

**3.2 纯负面概念**：代币名是纯负面概念，缺乏meme属性
   - ⚠️ **负面概念缺乏正向情感共鸣，用户不愿意传播持有 = 返回pass=false, stage=3, scenario=2**
   - 示例："失业"、"破产"、"倒闭"、"经济衰退"、"裁员"等 → 触发
   - 示例："暴跌"、"崩盘"、"亏损"等 → 触发
   - 理由：纯粹负面的概念缺乏幽默、讽刺或正向的情感驱动
   - 例外：有讽刺/幽默元素的负面概念（如"躺平"、"佛系"等可自嘲的概念）

**3.3 纯通识知识/百科内容**：内容是历史/通识知识科普，无近期事件驱动，缺乏meme属性
   - ⚠️ **这类内容虽然真实且关联性强，但缺乏meme的核心要素 = 返回pass=false, stage=3, scenario=3**
   - **包括内容类型**：
     - 历史科普、百科介绍、知识讲解类内容
     - 功能性符号/标志（紧急出口标志、交通标志等）
     - 技术标准制定过程、安全标志起源等
   - **判断标准（必须同时满足）**：
     1. **内容类型**：历史科普、百科介绍、知识讲解、符号标志类内容
       - 示例：安全标志起源、历史事件介绍、技术知识科普
       - 示例：紧急出口标志、交通标志等传播力极弱的符号
     2. **无近期事件**：内容讲述的是过去的事情，没有近期热点或突发事件
       - 示例："1972年火灾"、"1987年ISO认证" → 历史事件，非近期
     3. **无meme属性**：内容严肃、缺乏幽默/讽刺/情感共鸣
       - 示例：安全标志设计流程、技术标准制定过程 → 严肃科普
     4. **无大IP喊单**：没有CZ/Elon/Trump等超大IP的近期推荐或讨论
   - **反面示例（触发）**：
     - 示例：代币名"皮特托先生"，内容是"紧急出口标志起源的科普文章" → 触发
     - 示例：代币名"某某发明家"，内容是"某某人物的生平百科介绍" → 触发
     - 示例：代币名"某某定律"，内容是"科学定律的知识讲解" → 触发
   - **正面示例（不触发）**：
     - ✅ 如果有大IP近期喊单：CZ发推讨论安全标志 → 不触发（有事件驱动）
     - ✅ 如果有近期热点：某安全标志因新闻事件火了 → 不触发（有近期事件）
     - ✅ 如果内容有meme属性：用幽默方式讲述历史 → 不触发（有情感驱动）
   - 理由：meme币需要"热点事件 + 情感驱动 + 传播动力"，纯知识科普即使强关联也成不了meme

═══════════════════════════════════════════════════════════════

【输出格式】

**只返回JSON，不要其他内容**：

**第一阶段触发：内容空洞/无意义事件**
{"pass": false, "stage": 1, "reason": "所有语料内容空洞/事件无意义", "entities": {...}}

**第二阶段触发：无相关性（代币名不在核心实体中）**
{"pass": false, "stage": 2, "reason": "代币名不在核心实体中，无相关性", "entities": {...}}

**第三阶段触发：有相关性但质量低**
{"pass": false, "stage": 3, "scenario": 1-4, "reason": "说明理由", "entities": {...}}

**最终通过：有相关性且质量过关**
{"pass": true, "stage": 0, "reason": "代币名在核心实体中，且无低质量问题", "entities": {"tweet1": ["实体1", ...], "quoted_tweet": [...], "website": [...], "amazon": [...], "twitter_account": [...]}}

⚠️ **entities字段必须包含每条语料的核心实体列表**：
- "tweet1": 主推文的实体列表
- "quoted_tweet": 引用推文的实体列表（如果有）
- "website_tweet": Website推文的实体列表（如果有）
- "website": Website内容的实体列表（如果有）
- "amazon": Amazon内容的实体列表（如果有）
- "twitter_account": Twitter账号的实体列表（如果有，包括账号名、品牌名、所属机构等）

⚠️ **注意**：
- stage: 0 表示通过（有相关性且质量过关）
- stage: 1 表示第一阶段触发（内容空洞，pass=false）
- stage: 2 表示第二阶段触发（无相关性，pass=false）
- stage: 3 表示第三阶段触发（有相关性但质量低，pass=false）
- 当stage=3时，scenario字段必须是1-3的数字，对应三个场景`);

  return sections.filter(s => s).join('\n\n');
}

/**
 * 解析Stage 1响应
 *
 * 注意：此函数已弃用，请使用 NarrativeAnalyzer._parseStage1Response
 * NarrativeAnalyzer中的版本支持stage字段和entities字段
 *
 * @deprecated
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
