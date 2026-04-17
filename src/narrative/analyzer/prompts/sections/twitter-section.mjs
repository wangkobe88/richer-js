/**
 * Twitter Section - 推文/账号信息
 */

import { safeSubstring } from '../../utils/data-cleaner.mjs';

/**
 * 清理推文文本中的URL
 * 移除http/https链接，保留文本内容
 * @param {string} text - 原始推文文本
 * @returns {string} 清理后的文本
 */
function cleanTweetText(text) {
  if (!text) return '';
  // 移除所有http/https开头的URL（包括连在单词后面的）
  return text.replace(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi, '');
}

/**
 * 构建推文部分
 * @param {Object} tweet - 推文数据
 * @param {string} label - 标签
 * @param {Object} options - 选项
 * @param {boolean} options.excludeEngagement - 是否排除推文互动数据（点赞、转发等）
 */
function buildTweetPart(tweet, label = '推文', options = {}) {
  const parts = [];

  if (label) {
    parts.push(`【${label}】`);
  }

  // 作者信息
  const authorScreenName = tweet.author_screen_name || '未知';
  const verified = tweet.author_verified ? ' ✓' : '';
  parts.push(`作者：@${authorScreenName}${verified}`);

  // 粉丝数
  if (!options.excludeEngagement && tweet.author_followers_count !== undefined) {
    parts.push(`【作者粉丝数】${tweet.author_followers_count}`);
  }

  // 推文发布时间
  if (tweet.created_at || tweet.createdTimeStamp) {
    const tweetDate = tweet.created_at ? new Date(tweet.created_at) : new Date(tweet.createdTimeStamp);
    const daysAgo = Math.floor((Date.now() - tweetDate.getTime()) / (1000 * 60 * 60 * 24));
    parts.push(`【发布时间】${tweet.created_at}（约${daysAgo}天前）`);
  }

  // 互动数据
  if (!options.excludeEngagement) {
    const favoriteCount = tweet.metrics?.favorite_count || 0;
    const retweetCount = tweet.metrics?.retweet_count || 0;
    parts.push(`【推文互动】点赞 ${favoriteCount} / 转发 ${retweetCount}`);
  }

  // 推文内容（清理URL）
  const cleanedText = cleanTweetText(tweet.text);
  parts.push(`内容：${cleanedText}`);

  // 展开后的URL（如果有）
  if (tweet.expanded_urls && tweet.expanded_urls.length > 0) {
    parts.push(`【推文链接（展开后）】`);
    for (const urlInfo of tweet.expanded_urls) {
      parts.push(`- ${urlInfo.expanded}`);
    }
  }

  // 回复的推文
  if (tweet.in_reply_to) {
    const inReplyTo = tweet.in_reply_to;
    parts.push('');
    parts.push(`【回复的推文】`);
    parts.push(`作者：@${inReplyTo.author_screen_name || '未知'}`);
    if (inReplyTo.created_at || inReplyTo.createdTimeStamp) {
      const tweetDate = inReplyTo.created_at ? new Date(inReplyTo.created_at) : new Date(inReplyTo.createdTimeStamp);
      const daysAgo = Math.floor((Date.now() - tweetDate.getTime()) / (1000 * 60 * 60 * 24));
      parts.push(`【发布时间】${inReplyTo.created_at}（约${daysAgo}天前）`);
    }
    if (inReplyTo.author_followers_count) {
      parts.push(`粉丝数: ${inReplyTo.author_followers_count}`);
    }
    const cleanedReplyText = cleanTweetText(inReplyTo.text);
    parts.push(`内容：${cleanedReplyText}`);
  }

  // 媒体内容
  if (tweet.media && tweet.media.has_media) {
    if (tweet.media.images?.length > 0) {
      parts.push(`【推文附带图片】${tweet.media.images.length}张`);
    }
    if (tweet.media.videos?.length > 0) {
      parts.push(`【推文附带视频】${tweet.media.videos.length}个`);
    }
  }

  // 图片分析结果
  if (tweet.image_analysis) {
    const analysis = tweet.image_analysis.analysis;
    if (analysis) {
      parts.push(`【图片内容分析】`);
      if (analysis.description) parts.push(`描述：${analysis.description}`);
      if (analysis.key_elements?.length > 0) parts.push(`关键元素：${analysis.key_elements.join(', ')}`);
      if (analysis.meme_type) parts.push(`梗图类型：${analysis.meme_type}`);
      if (analysis.meme_meaning) parts.push(`梗图含义：${analysis.meme_meaning}`);
      if (analysis.token_relevance) parts.push(`代币关联：${analysis.token_relevance}`);
    }
  }

  // Article
  if (tweet.article) {
    parts.push(`【Twitter Article】（注意：Article即为此推文的完整内容，非转发）`);
    parts.push(`标题：${tweet.article.title || '无'}`);
    parts.push(`摘要：${tweet.article.preview_text || '无'}`);
    if (tweet.article.plain_text) {
      const articleText = safeSubstring(tweet.article.plain_text, 3000);
      parts.push(`完整内容：${articleText}`);
    } else {
      // 如果没有完整内容，添加说明
      parts.push(`（注：此Article的完整内容暂不可获取，请基于标题和摘要进行分析）`);
    }
    if (tweet.article.cover_image_url) {
      parts.push(`封面图：${tweet.article.cover_image_url}`);
    }
  }

  return parts.join('\n');
}

/**
 * 构建账号部分
 */
function buildAccountPart(account) {
  const parts = [];

  const isVerified = account.verified || account.is_blue_verified;
  const screenName = account.screen_name || account.username || '未知';
  const name = account.name || '';

  parts.push(`【推特账号】@${screenName} (${name})${isVerified ? ' ✓' : ''}`);

  if (account.description) {
    parts.push(`简介: ${account.description}`);
  }

  parts.push(`粉丝数: ${account.followers_count || 0}`);

  return parts.join('\n');
}

/**
 * 构建Twitter信息section
 * @param {Object} twitterInfo - Twitter信息
 * @param {Object} options - 选项
 * @param {boolean} options.excludeEngagement - 是否排除推文互动数据（点赞、转发等）
 * @returns {string} Twitter section或空字符串
 */
export function buildTwitterSection(twitterInfo, options = {}) {
  if (!twitterInfo) {
    return '';
  }

  const parts = [];

  // 主推文或账号
  if (twitterInfo.type === 'account') {
    parts.push(buildAccountPart(twitterInfo));
  } else if (twitterInfo.text) {
    parts.push(buildTweetPart(twitterInfo, '主推文', options));
  }

  // Website推文（第二个推文）
  if (twitterInfo.website_tweet && twitterInfo.website_tweet.text) {
    parts.push('');
    parts.push(buildTweetPart(twitterInfo.website_tweet, 'Website推文', options));
  }

  // 引用推文
  if (twitterInfo.quoted_status) {
    const quoted = twitterInfo.quoted_status;
    parts.push('');
    parts.push(`【引用推文】`);
    parts.push(`作者：@${quoted.author_screen_name || quoted.author_name || '未知'}`);
    if (quoted.created_at || quoted.createdTimeStamp) {
      const tweetDate = quoted.created_at ? new Date(quoted.created_at) : new Date(quoted.createdTimeStamp);
      const daysAgo = Math.floor((Date.now() - tweetDate.getTime()) / (1000 * 60 * 60 * 24));
      parts.push(`【发布时间】${quoted.created_at}（约${daysAgo}天前）`);
    }
    if (quoted.author_followers_count) {
      parts.push(`粉丝数: ${quoted.author_followers_count}`);
    }
    const cleanedQuotedText = cleanTweetText(quoted.text);
    parts.push(`内容：${cleanedQuotedText}`);
  }

  // 转发推文
  if (twitterInfo.retweeted_status) {
    const retweeted = twitterInfo.retweeted_status;
    parts.push('');
    parts.push(`【转发推文】`);
    parts.push(`作者：@${retweeted.author_screen_name || retweeted.author_name || '未知'}`);
    if (retweeted.created_at || retweeted.createdTimeStamp) {
      const tweetDate = retweeted.created_at ? new Date(retweeted.created_at) : new Date(retweeted.createdTimeStamp);
      const daysAgo = Math.floor((Date.now() - tweetDate.getTime()) / (1000 * 60 * 60 * 24));
      parts.push(`【发布时间】${retweeted.created_at}（约${daysAgo}天前）`);
    }
    if (retweeted.author_followers_count) {
      parts.push(`粉丝数: ${retweeted.author_followers_count}`);
    }
    const cleanedRetweetedText = cleanTweetText(retweeted.text);
    parts.push(`内容：${cleanedRetweetedText}`);
  }

  // 推文链接内容
  if (twitterInfo.link_content?.content) {
    parts.push('');
    const linkContent = twitterInfo.link_content.content;
    const truncated = safeSubstring(linkContent, 2000, '...(内容已截断)');
    parts.push(`【推文链接内容】${truncated}`);
  }

  // 检测推文中是否出现"广场"，添加币安广场语境提示
  const allText = [
    twitterInfo.text,
    twitterInfo.in_reply_to?.text,
    twitterInfo.website_tweet?.text,
    twitterInfo.website_tweet?.in_reply_to?.text,
    twitterInfo.quoted_status?.text,
    twitterInfo.retweeted_status?.text,
    twitterInfo.link_content?.content
  ].filter(Boolean).join(' ');

  if (allText.includes('广场')) {
    parts.push('');
    parts.push(`💡 语境提示：推文中提到的「广场」在Web3/加密货币语境下通常指「币安广场」(Binance Square)，是币安官方的内容社交平台`);
  }

  return parts.length > 0 ? parts.join('\n') : '';
}
