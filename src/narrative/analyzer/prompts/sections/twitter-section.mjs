/**
 * Twitter Section - 推文/账号信息
 */

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
 */
function buildTweetPart(tweet, label = '推文') {
  const parts = [];

  if (label) {
    parts.push(`【${label}】`);
  }

  // 作者信息
  const authorScreenName = tweet.author_screen_name || '未知';
  const verified = tweet.author_verified ? ' ✓' : '';
  parts.push(`作者：@${authorScreenName}${verified}`);

  // 粉丝数
  if (tweet.author_followers_count !== undefined) {
    parts.push(`【作者粉丝数】${tweet.author_followers_count}`);
  }

  // 互动数据
  const favoriteCount = tweet.metrics?.favorite_count || 0;
  const retweetCount = tweet.metrics?.retweet_count || 0;
  parts.push(`【推文互动】点赞 ${favoriteCount} / 转发 ${retweetCount}`);

  // 推文内容（清理URL）
  const cleanedText = cleanTweetText(tweet.text);
  parts.push(`内容：${cleanedText}`);

  // 回复的推文
  if (tweet.in_reply_to) {
    const inReplyTo = tweet.in_reply_to;
    parts.push('');
    parts.push(`【回复的推文】`);
    parts.push(`作者：@${inReplyTo.author_screen_name || '未知'}`);
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

  // Article
  if (tweet.article) {
    parts.push(`【Twitter Article】（注意：Article即为此推文的完整内容，非转发）`);
    parts.push(`标题：${tweet.article.title || '无'}`);
    parts.push(`摘要：${tweet.article.preview_text || '无'}`);
    if (tweet.article.plain_text) {
      const articleText = tweet.article.plain_text.length > 3000
        ? tweet.article.plain_text.substring(0, 3000) + '...'
        : tweet.article.plain_text;
      parts.push(`完整内容：${articleText}`);
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
 * @returns {string} Twitter section或空字符串
 */
export function buildTwitterSection(twitterInfo) {
  if (!twitterInfo) {
    return '';
  }

  const parts = [];

  // 主推文或账号
  if (twitterInfo.type === 'account') {
    parts.push(buildAccountPart(twitterInfo));
  } else if (twitterInfo.text) {
    parts.push(buildTweetPart(twitterInfo, '主推文'));
  }

  // Website推文（第二个推文）
  if (twitterInfo.website_tweet && twitterInfo.website_tweet.text) {
    parts.push('');
    parts.push(buildTweetPart(twitterInfo.website_tweet, 'Website推文'));
  }

  // 引用推文
  if (twitterInfo.quoted_status) {
    const quoted = twitterInfo.quoted_status;
    parts.push('');
    parts.push(`【引用推文】`);
    parts.push(`作者：@${quoted.author_screen_name || quoted.author_name || '未知'}`);
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
    const truncated = linkContent.length > 2000
      ? linkContent.substring(0, 2000) + '...(内容已截断)'
      : linkContent;
    parts.push(`【推文链接内容】${truncated}`);
  }

  return parts.length > 0 ? parts.join('\n') : '';
}
