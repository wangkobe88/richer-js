/**
 * Prompt构建器 - 入口点
 * 根据代币信息类型，选择合适的Prompt模板
 *
 * V6.1 - 拆分为多个场景专用Prompt，增加video-only类型
 */

import { STANDARD_PROMPT } from './prompts/standard.mjs';
import { ACCOUNT_ONLY_PROMPT } from './prompts/account-only.mjs';
import { WEBSITE_ONLY_PROMPT } from './prompts/website-only.mjs';
import { VIDEO_ONLY_PROMPT } from './prompts/video-only.mjs';
import { COMPLETE_PROMPT } from './prompts/complete.mjs';

export class PromptBuilder {

  static getPromptVersion() {
    return 'V6.1';
  }

  /**
   * 判断应该使用哪种Prompt类型
   * @param {Object} twitterInfo - Twitter信息
   * @param {Object} websiteInfo - 网站信息
   * @param {Object} githubInfo - GitHub信息
   * @param {Object} youtubeInfo - YouTube信息
   * @param {Object} douyinInfo - 抖音信息
   * @param {Object} tiktokInfo - TikTok信息
   * @returns {string} Prompt类型：'standard', 'account-only', 'website-only', 'video-only', 'complete'
   */
  static determinePromptType(twitterInfo, websiteInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo) {
    // 优先级1：有GitHub → 使用完整Prompt（GitHub需要完整评估框架）
    if (githubInfo) {
      return 'complete';
    }

    // 优先级2：有推文 + 有视频平台 → 使用完整Prompt（需要综合评估）
    const hasTweet = twitterInfo && twitterInfo.type === 'tweet' && twitterInfo.text;
    const hasVideo = youtubeInfo || douyinInfo || tiktokInfo;
    if (hasTweet && hasVideo) {
      return 'complete';
    }

    // 优先级3：有推文文本 → 使用标准Prompt
    if (hasTweet) {
      return 'standard';
    }

    // 优先级4：只有Twitter账号（没有推文）→ 使用账号专用Prompt
    if (twitterInfo && twitterInfo.type === 'account') {
      return 'account-only';
    }

    // 优先级5：只有视频平台（TikTok/YouTube/抖音）且无其他复杂信息 → 使用视频专用Prompt
    if (hasVideo && !twitterInfo && !githubInfo && !(websiteInfo && websiteInfo.content)) {
      return 'video-only';
    }

    // 优先级6：有视频平台 + 其他信息 → 使用完整Prompt
    if (hasVideo) {
      return 'complete';
    }

    // 优先级7：只有网站内容（成功获取）→ 使用网站专用Prompt
    if (websiteInfo && websiteInfo.content) {
      return 'website-only';
    }

    // 默认：使用完整Prompt作为兜底（处理无信息或信息不全的情况）
    return 'complete';
  }

  /**
   * 构建代币叙事分析Prompt
   * @param {Object} tokenData - 代币数据（包含 symbol, address, raw_api_data）
   * @param {Object} twitterInfo - Twitter信息
   * @param {Object} websiteInfo - 网页内容信息
   * @param {Object} extractedInfo - 提取的结构化信息
   * @param {Object} backgroundInfo - 背景信息（微博等）
   * @param {Object} githubInfo - GitHub仓库信息
   * @param {Object} youtubeInfo - YouTube视频信息
   * @param {Object} douyinInfo - 抖音视频信息
   * @param {Object} tiktokInfo - TikTok视频信息
   * @returns {string} 构建好的Prompt字符串
   */
  static build(tokenData, twitterInfo = null, websiteInfo = null, extractedInfo = null, backgroundInfo = null, githubInfo = null, youtubeInfo = null, douyinInfo = null, tiktokInfo = null) {
    // 判断应该使用哪种Prompt
    const promptType = this.determinePromptType(twitterInfo, websiteInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo);

    // 根据类型选择对应的Prompt构建器
    switch (promptType) {
      case 'standard':
        return STANDARD_PROMPT(tokenData, twitterInfo, extractedInfo);

      case 'account-only':
        return ACCOUNT_ONLY_PROMPT(tokenData, twitterInfo, extractedInfo);

      case 'website-only':
        return WEBSITE_ONLY_PROMPT(tokenData, websiteInfo, extractedInfo);

      case 'video-only':
        return VIDEO_ONLY_PROMPT(tokenData, tiktokInfo, youtubeInfo, douyinInfo, extractedInfo);

      case 'complete':
      default:
        return COMPLETE_PROMPT(tokenData, twitterInfo, websiteInfo, extractedInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo);
    }
  }

  /**
   * 获取当前Prompt类型（用于记录和分析）
   * @param {Object} twitterInfo - Twitter信息
   * @param {Object} websiteInfo - 网站信息
   * @param {Object} githubInfo - GitHub信息
   * @param {Object} youtubeInfo - YouTube信息
   * @param {Object} douyinInfo - 抖音信息
   * @param {Object} tiktokInfo - TikTok信息
   * @returns {string} Prompt类型
   */
  static getPromptType(twitterInfo, websiteInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo) {
    return this.determinePromptType(twitterInfo, websiteInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo);
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
