/**
 * Prompt构建器 - V8.0 两阶段架构
 * 根据实际获取的数据动态组装Prompt
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
import { generateAccountBackgroundsPrompt } from './prompts/account-backgrounds.mjs';

// Stage 1: 低质量检测
import { buildLowQualityDetectionPrompt } from './prompts/low-quality-detection.mjs';

// Stage 2: 详细评分
import { buildDetailedScoringPrompt } from './prompts/detailed-scoring.mjs';

export class PromptBuilder {

  /**
   * 获取Prompt版本
   * @returns {string} Prompt版本号
   */
  static getPromptVersion() {
    return 'V8.0';
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

    if (fetchResults.twitterInfo?.text) types.push('tweet');
    else if (fetchResults.twitterInfo?.type === 'account') types.push('account');

    if (fetchResults.websiteInfo?.content) types.push('website');
    if (fetchResults.githubInfo) types.push('github');
    if (fetchResults.youtubeInfo) types.push('youtube');
    if (fetchResults.douyinInfo) types.push('douyin');
    if (fetchResults.tiktokInfo) types.push('tiktok');
    if (fetchResults.bilibiliInfo) types.push('bilibili');
    if (fetchResults.amazonInfo) types.push('amazon');
    if (fetchResults.backgroundInfo?.source === 'weibo') types.push('weibo');

    if (fetchResults.twitterInfo?.website_tweet) types.push('+website_tweet');

    return types.length > 0 ? types.join('+') : 'minimal';
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
