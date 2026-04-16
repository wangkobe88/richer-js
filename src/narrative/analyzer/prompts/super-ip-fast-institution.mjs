/**
 * 超大IP快速通道 — 机构类（D类）Prompt
 *
 * 维度二：事件传播价值（0-30分），4角度评估（话题性/煽动性/感染力/影响力）
 * 与D类V4.0对齐：
 * - 不阻断日常运营/营销类事件，由评分自然过滤
 * - 仅阻断政治/冲突性质事件
 * - 评分示例：Binance上架新币 → S级(40) + 弱传播(3) + 近期(15) = 58 → pass=false（自然过滤）
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
 * 构建机构类（D类）快速通道Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的所有语料数据
 * @param {Object} ipInfo - 注册表中的IP信息 { name, type, tier, desc }
 * @param {Object} preScores - 预计算分数 { tierScore, timeliness, baseEventScore }
 * @returns {string} Prompt
 */
export function buildInstitutionFastPrompt(tokenData, fetchResults, ipInfo, preScores) {
  const symbol = tokenData.symbol || '';
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';

  // 品牌劫持预检
  const includeBrandCheck = shouldIncludeBrandHijackCheck(symbol, tokenName);
  const brandSection = includeBrandCheck ? buildBrandHijackSection('institution') : '';
  const truncationRules = buildTruncationRules(includeBrandCheck);

  // 共用头部
  const header = buildCommonHeader(
    ipInfo, preScores, tokenData,
    buildDataSections(fetchResults),
    'D类（机构言论/动作）'
  );

  // D类专用：事件传播价值（4角度）+ 阻断条件（仅政治/冲突）
  const dimension2Section = buildInstitutionDimension2();
  const blockingSection = buildInstitutionBlocking();

  // 共用代币评估段落
  const tokenSection = buildCommonTokenSection(ipInfo, brandSection, truncationRules, preScores);

  return `你是叙事分析专家，快速评估基于知名机构官方推文的meme代币。

╔══════════════════════════════════════════════════════════════════════════════╗
║              超大IP快速通道 — D类（机构言论/动作）                               ║
╚══════════════════════════════════════════════════════════════════════════════╝

${header}

${dimension2Section}

${blockingSection}

${tokenSection}`;
}

/**
 * 构建D类维度二：事件传播价值（4角度评估）
 * 与D类V4.0的维度二设计完全对齐
 */
function buildInstitutionDimension2() {
  return `**任务一：事件传播价值评估（维度二，0-30分）**

⚠️ 此维度评估的是整个事件的传播价值。同一个内容，由不同机构发布，传播价值不同。
例如"Happy Easter"由Binance发布，社区会互动、玩梗，有传播价值；由不知名小公司发布，则无人在意。

**从四个角度综合评估**：

1. **话题性**：能否引发社区讨论？是否有人会转发/评论？
2. **煽动性**：是否激发情绪反应？是否有争议空间？
3. **感染力**：是否容易被记住/传播？是否有共鸣？
4. **影响力**：是否影响很多人？是否改变认知/行为？

**评分标准**（综合四个角度）：

- **强传播**（22-30分）：满足3-4个角度，且至少1个"高"
  - 示例：Binance宣布重大战略调整 → 强影响力 + 强话题性 + 强感染力
  - 示例：Binance被SEC起诉 → 强煽动性 + 强话题性 + 强影响力
  - 示例：简短有力的口号、独特概念/新造词 → 强感染力
  - 示例：与CZ/何一/币安官方强关联或引用其观点 → 强话题性 + 强感染力

- **中传播**（10-21分）：满足1-2个角度
  - 示例：Binance发起创意营销活动 → 有感染力 + 有话题性
  - 示例：知名机构发表有趣观点 → 有话题性
  - 示例：有画面感/故事线的内容 → 有感染力
  - 示例：Binance发节日问候 → 社区会互动玩梗，有话题性（弱）+ 有感染力（弱）

- **弱传播**（0-9分）：基本不满足
  - 示例：上架新币公告、常规功能更新
  - 示例：礼节性表达、系统维护通知`;
}

/**
 * 构建D类阻断条件
 * 与D类V4.0对齐：仅阻断政治/冲突性质事件，不阻断日常运营（由评分自然过滤）
 */
function buildInstitutionBlocking() {
  return `**任务二：阻断检查**

⚠️ 以下情况直接阻断（pass=false），不再继续评估：

**政治/冲突性质阻断**：
- 涉及战争、军事冲突、恐怖主义、制裁对抗的事件
- 涉及国家间对抗、地缘政治威胁、核威胁等负面政治事件
- 政府或政治实体的威胁性/敌对性言论和动作
- ⚠️ **豁免**：和平协议、国际合作、人道主义援助等正面政治事件不触发此阻断
- ⚠️ **豁免**：知名机构对政治事件发表观点引发社区玩梗，不触发此阻断
- ⚠️ **豁免**：政治实体的非严肃/娱乐性动作（推出吉祥物、使用meme、发表有趣/接地气的内容引发社区玩梗），不触发此阻断

⚠️ **不阻断日常运营/营销**：
- 日常运营（上架新币、常规功能更新、系统维护）不触发阻断，由评分自然过滤
- 营销噱头（节日活动、创意推广）不触发阻断，由评分自然过滤
- 示例：Binance上架新币 → S级(40) + 弱传播(3) + 近期(15) = 58 → 自然过滤（pass=false由分数决定，不因阻断）
- 示例：Binance发节日问候 → S级(40) + 中传播(10) + 近期(15) = 65 → pass=true（有价值）`;
}
