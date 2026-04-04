/**
 * Prompt构建器 - V9.5 两阶段架构（Symbol/Name分别匹配）
 * 根据实际获取的数据动态组装Prompt
 *
 * V9.5变更（2026-04-01）：
 * - 豁免规则扩展：Binance/币安官方相关账号（包括Binance、BinanceAcademy、BinanceLabs、币安学院等）
 * - 豁免规则扩展：回复/引用/转发知名机构推文不算空洞
 * - 实体识别规则明确：必须列出所有依赖语料（in_reply_to、quoted_tweet、retweeted_tweet）
 * - 强调依赖语料的重要性：回复/引用/转发的推文往往包含更重要的上下文信息
 *
 * V9.4变更（2026-04-01）：
 * - Prompt增加代币Name字段显示（Symbol和Name分开显示）
 * - 第二阶段匹配规则：Symbol或Name满足一个即可匹配
 * - 示例：Symbol="B4", Name="BUILD4" → 实体包含"BUILD4" → 匹配
 * - 保持严格匹配：Symbol或Name必须完整匹配实体，不允许缩写/部分匹配
 *
 * V9.2变更（2026-04-01）：
 * - Stage 1 低质量检测新增场景6：地区性/本地化事件
 * - 检测局限于某个城市/地区的事件
 * - 地区性事件受众局限、无法跨文化传播
 * - 示例：代币名"种太阳"，内容是"长沙天气事件" → 触发low
 *
 * V9.1变更（2026-03-31）：
 * - Stage 1 低质量检测新增场景6：功能性/服务性内容
 * - 检测本质是工具、服务、功能性产品的内容
 * - 功能性内容即使解决了实际问题，也缺乏娱乐性和情感驱动
 * - 示例：代币名"辟谣侠"，内容是"辟谣工具/平台介绍" → 触发low
 *
 * V9.1变更（2026-03-31）：
 * - 删除代币信息中的URL显示（冗余，内容会在后面详细展示）
 * - 第二阶段增加"什么是语料"的说明
 * - 强化语言不匹配规则：只有中文⇄英文互译豁免
 * - 明确日文/韩语/泰语等非中英语言与英文/中文混用均触发语言不匹配
 *
 * V8.9变更（2025-03-26）：
 * - 扩展中英文对应规则，包括产品/服务名称和品牌名称
 * - 明确"币安VIP"（中文）vs "Binance VIP"（英文）是匹配的
 * - 添加详细的中英文对应判断标准：专有名词翻译、通用品牌/产品名
 * - 空格、大小写不影响匹配判断
 *
 * V8.8变更（2025-03-26）：
 * - 修复关联实体导致误判的问题
 * - 明确只判断代币名本身是否是超大IP，不看关联实体
 * - 示例：代币名"AgentPay"不是超大IP，即使实体包含"World Liberty（Trump相关）"，也应立即pass
 *
 * V8.7变更（2025-03-26）：
 * - 修复非超大IP（如"硅基茶水间"）被误判为硬蹭的问题
 * - 重构步骤3的逻辑结构，使判断流程更清晰
 * - 明确非超大IP只要名称匹配就立即pass，不做任何额外判断
 *
 * V8.6变更（2025-03-26）：
 * - 修复超大IP（CZ/Elon/Trump）硬蹭未拦截的问题
 * - 前置检查增加事件要求：超大IP必须有具体事件描述
 * - 只是账号/网站数据不算有事件，应触发硬蹭检查
 *
 * V8.5变更（2025-03-26）：
 * - 修复"HY"硬蹭CZ未拦截的问题
 * - 前置检查明确：只做精确字符串匹配，不做推理或联想
 * - 拼音首字母缩写不算匹配（HY vs CZ → 触发硬蹭）
 *
 * V8.4变更（2025-03-26）：
 * - 修复"代币名匹配实体但仍被判定为硬蹭"的执行逻辑混乱问题
 * - 强化"立即停止分析"指令，防止LLM在发现匹配后继续推理
 * - 明确"任何匹配都是有效匹配"，不论代币名在语料中如何出现
 *
 * V8.3变更（2025-03-26）：
 * - 修复"代币名是中文，实体是英文翻译"被误判为硬蹭的问题
 * - 前置检查明确说明：中英文翻译/对应也算匹配
 * - 示例：代币名"东莞崇英学校"与"Dongguan Chongying School"匹配
 *
 * V8.2变更（2025-03-26）：
 * - 修复"书籍标题匹配代币名"被误判为"硬蹭"的问题
 * - 前置检查范围从"推文"扩展到"所有语料"（推文/Website/Amazon）
 * - 明确书籍标题/产品名称匹配 = 强关联，不是硬蹭
 * - 目标：确保所有语料类型都能正确执行前置检查
 *
 * V8.1变更（2025-03-26）：
 * - 强制LLM分别列出每个推文的核心实体
 * - 新增加密圈常见缩写说明（CZ、SBF、ELON等）
 * - 输出格式增加entities字段，便于验证实体识别准确性
 * - 目标：解决实体识别不完整导致的评分不稳定问题
 *
 * V8.0变更（两阶段架构）：
 * - Stage 1: 低质量检测（8种场景），只做二元判断（pass/low）
 * - Stage 2: 详细评分（四维度100分），只在Stage 1通过后执行
 * - 目标：提高一致性，减少LLM认知负担
 *
 * V7.23变更（保留参考）：
 * - 调整硬蹭检查规则：明确区分"直接引用核心概念"vs"硬蹭"
 * - 新增正面示例：硅基茶水间、AgentPay、币安VIP → 强关联（不是硬蹭）
 * - 硬蹭判断标准：推文主体与代币主体是否在同一件事上
 */

import { buildTwitterSection } from './prompts/sections/twitter-section.mjs';
import { buildWebsiteSection } from './prompts/sections/website-section.mjs';
import { buildVideoSection } from './prompts/sections/video-section.mjs';
import { buildGithubSection } from './prompts/sections/github-section.mjs';
import { buildWeiboSection } from './prompts/sections/weibo-section.mjs';
import { buildAmazonSection } from './prompts/sections/amazon-section.mjs';
import { buildXiaohongshuSection } from './prompts/sections/xiaohongshu-section.mjs';
import { generateAccountBackgroundsPrompt } from './prompts/account-backgrounds.mjs';

// Stage 1: 低质量检测
import { buildLowQualityDetectionPrompt, STAGE1_PROMPT_VERSION } from './prompts/low-quality-detection.mjs';

// Stage 2: 详细评分
import { buildDetailedScoringPrompt } from './prompts/detailed-scoring.mjs';

// V12.0 新框架：事件分析 + 代币分析
import { buildEventAnalysisPrompt, EVENT_ANALYSIS_PROMPT_VERSION } from './prompts/event-analysis.mjs';
import { buildTokenAnalysisPrompt, TOKEN_ANALYSIS_PROMPT_VERSION } from './prompts/token-analysis.mjs';

export class PromptBuilder {

  /**
   * 获取Prompt版本
   * V13.2 新框架：返回 'V13.2'
   * @returns {string} Prompt版本号
   */
  static getPromptVersion() {
    return EVENT_ANALYSIS_PROMPT_VERSION; // V13.2
  }

  /**
   * 构建事件分析Prompt（新框架第一阶段）
   * 对应原 Stage 1（低质量检测），重构为"事件分析"
   * @param {Object} tokenData - 代币数据
   * @param {Object} fetchResults - 获取的数据结果
   * @returns {string} 事件分析Prompt
   */
  static buildEventAnalysis(tokenData, fetchResults) {
    return buildEventAnalysisPrompt(tokenData, fetchResults);
  }

  /**
   * 构建代币分析Prompt（新框架第二阶段）
   * 对应原 Stage 2（详细评分），重构为"代币分析"
   * @param {Object} tokenData - 代币数据
   * @param {Object} fetchResults - 获取的数据结果
   * @param {Object} eventAnalysis - 事件分析结果
   * @returns {string} 代币分析Prompt
   */
  static buildTokenAnalysis(tokenData, fetchResults, eventAnalysis) {
    return buildTokenAnalysisPrompt(tokenData, fetchResults, eventAnalysis);
  }

  /**
   * 构建Stage 1 Prompt（低质量检测）
   * @param {Object} tokenData - 代币数据
   * @param {Object} fetchResults - 获取的数据结果
   * @returns {string} Stage 1 Prompt
   */
  static buildStage1(tokenData, fetchResults) {
    return buildLowQualityDetectionPrompt(tokenData, fetchResults);
  }

  /**
   * 获取Prompt类型描述（用于记录和调试）
   * @param {Object} fetchResults - 获取的数据结果
   * @param {number} stage - 阶段（1或2）
   * @returns {string} Prompt类型描述
   */
  static getPromptTypeDesc(fetchResults, stage = null) {
    const types = [];

    // 添加阶段标识
    if (stage !== null) {
      types.push(`stage${stage}`);
    }

    // Prompt类型描述
    if (fetchResults.twitterInfo?.text) types.push('tweet');
    else if (fetchResults.twitterInfo?.type === 'account') types.push('account');

    if (fetchResults.websiteInfo?.content) types.push('website');
    if (fetchResults.githubInfo) types.push('github');
    if (fetchResults.youtubeInfo) types.push('youtube');
    if (fetchResults.douyinInfo) types.push('douyin');
    if (fetchResults.tiktokInfo) types.push('tiktok');
    if (fetchResults.bilibiliInfo) types.push('bilibili');
    if (fetchResults.xiaohongshuInfo) types.push('xiaohongshu');
    if (fetchResults.weixinInfo) types.push('weixin');
    if (fetchResults.amazonInfo) types.push('amazon');
    if (fetchResults.backgroundInfo?.source === 'weibo') types.push('weibo');

    if (fetchResults.twitterInfo?.website_tweet) types.push('+website_tweet');

    return types.length > 0 ? types.join('+') : 'minimal';
  }

  // buildStage1方法已在第139-146行定义（包含视频专用Prompt路由逻辑）

  /**
   * 构建Stage 2 Prompt（详细评分）
   * @param {Object} tokenData - 代币数据
   * @param {Object} fetchResults - 获取的数据结果
   * @returns {string} Stage 2 Prompt
   */
  static buildStage2(tokenData, fetchResults) {
    return buildDetailedScoringPrompt(tokenData, fetchResults);
  }

  /**
   * 检查中文合成词/简称关联
   * 识别如"万事币安"(万事达+币安)这类由多个词组成的代币名
   * @param {string} tokenName - 代币名称
   * @param {string} tweetText - 推文内容（已转小写）
   * @returns {string|null} 匹配提示或 null
   */
  static checkCompoundWordMatch(tokenName, tweetText) {
    // 中文品牌简称/双关语映射表
    const chineseAbbreviations = {
      '万事': ['mastercard', '万事达', 'master'],
      '马斯': ['musk', '马斯克'],
      '币安': ['binance', '币安'],
      '安币': ['binance', '币安'],
    };

    // 常见合成词模式（代币名 -> 分解后的组成部分）
    const compoundPatterns = {
      '万事币安': ['万事', '币安'],
      '马斯狗': ['马斯', '狗'],
    };

    // 检查是否是已知合成词
    const components = compoundPatterns[tokenName];
    if (components) {
      const matchedComponents = [];
      const matchedKeywords = [];

      for (const component of components) {
        if (tweetText.includes(component.toLowerCase())) {
          matchedComponents.push(component);
        }

        const abbreviations = chineseAbbreviations[component];
        if (abbreviations) {
          for (const abbr of abbreviations) {
            if (tweetText.includes(abbr.toLowerCase())) {
              matchedKeywords.push(abbr);
              break;
            }
          }
        }
      }

      if (matchedComponents.length > 0 || matchedKeywords.length > 0) {
        const hints = [];
        if (matchedComponents.length > 0) {
          hints.push(`直接匹配: ${matchedComponents.join(', ')}`);
        }
        if (matchedKeywords.length > 0) {
          hints.push(`关联匹配: ${matchedKeywords.join(', ')}`);
        }
        return `\n【代币名称关联】代币"${tokenName}"是合成词，推文包含其组成部分: ${hints.join('; ')}`;
      }
    }

    // 检查其他可能的简称关联
    for (const [abbr, keywords] of Object.entries(chineseAbbreviations)) {
      if (tokenName.includes(abbr)) {
        for (const keyword of keywords) {
          if (tweetText.includes(keyword.toLowerCase())) {
            return `\n【代币名称关联】代币"${tokenName}"包含"${abbr}"（${keyword}的简称），推文提及${keyword}`;
          }
        }
      }
    }

    return null;
  }
}
