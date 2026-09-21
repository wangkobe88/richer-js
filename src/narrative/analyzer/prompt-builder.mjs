/**
 * Prompt 构建器（Jev 迁移后仅剩工具方法）
 *
 * P2（2026-09-19）：主路径 3 阶段 prompt（Stage1 事件预处理 / Stage2 分类评分 /
 * Stage3 代币分析）由 Jev 单次 speculative fan-out 取代（jev-questions.mjs），
 * 阶段 prompt 构建、prompt-loader、版本号方法已删除。
 * P3（2026-09-21）：prestage/meme 分支 prompt 同步退役。
 *
 * 现存职责：getPromptTypeDesc —— 为 prompt_type 列生成数据来源描述
 * （预检查/no_data 分支用；Jev 分支的 promptType 由各 mapper 生成）。
 */

export class PromptBuilder {

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
    if (fetchResults.instagramInfo) types.push('instagram');
    if (fetchResults.weixinInfo) types.push('weixin');
    if (fetchResults.amazonInfo) types.push('amazon');
    if (fetchResults.binanceSquareInfo) types.push('binanceSquare');
    if (fetchResults.backgroundInfo?.source === 'weibo') types.push('weibo');

    if (fetchResults.twitterInfo?.website_tweet) types.push('+website_tweet');

    return types.length > 0 ? types.join('+') : 'minimal';
  }
}
