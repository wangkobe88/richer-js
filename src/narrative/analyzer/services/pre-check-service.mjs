/**
 * Pre-check Service - 预检查服务
 * 处理叙事分析前的各种预检查规则
 */

import { getVisualLength, hasValidDataForAnalysis } from '../utils/narrative-utils.mjs';
import { isHighInfluenceAccount, getHighInfluenceAccountBackground } from '../prompts/account-backgrounds.mjs';
import { LLMClient } from '../llm/llm-api-client.mjs';
import { ImageDownloader } from '../../utils/image-downloader.mjs';
import { SameNameCheckService } from './same-name-check-service.mjs';
import { NarrativeRepository } from '../../db/NarrativeRepository.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取配置文件
const configPath = join(__dirname, '../../../../config/default.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const NARRATIVE_CONFIG = config.narrative || {
  enableImageAnalysis: false,
  enableVideoAnalysis: false,
  twitterBlacklist: [],
  expiredTweetDaysThreshold: 14
};

/**
 * 构建统一的预检查返回结果
 * @param {string} rating - "low" | "unrated"
 * @param {string} reason - 原因描述
 * @param {string} ruleName - 规则名称（如 "symbol_too_long"）
 * @param {Object} [extra] - 额外的 details 字段
 * @returns {Object} 统一格式的预检查结果
 */
function buildPreCheckResult(rating, reason, ruleName, extra = {}) {
  return {
    rating,
    pass: false,
    reason,
    category: null,
    score: extra.total_score ?? null,
    details: {
      ruleName,
      ...extra,
    }
  };
}

/**
 * 执行预检查规则（不调用LLM，直接返回结果）
 * @param {Object} tokenData - 代币数据
 * @param {Object} twitterInfo - Twitter信息
 * @param {Object} extractedInfo - 提取的结构化信息
 * @param {Object} websiteInfo - 网站信息
 * @param {Object} classifiedUrls - 分类后的URL列表
 * @param {Object} videoInfos - 视频平台信息 { youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo }
 * @param {Object} githubInfo - GitHub信息
 * @param {Object} backgroundInfo - 背景信息（如微博）
 * @param {Object} options - 选项 { ignoreExpired }
 * @returns {Promise<Object|null>} 预检查结果，null表示通过预检查
 */
export async function performPreCheck(tokenData, twitterInfo, extractedInfo, websiteInfo, classifiedUrls = {}, videoInfos = {}, githubInfo = null, backgroundInfo = null, options = {}) {
  const { ignoreExpired = false } = options;
  const { youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo } = videoInfos;

  // 规则0：代币名称长度检查（优先级最高）
  // 过滤名称过长的代币，通常是为了博眼球而故意使用长名称，缺乏真实叙事价值
  const tokenSymbol = (tokenData.symbol || '').trim();
  const tokenName = (tokenData.name || tokenData.raw_api_data?.name || '').trim();

  const MAX_SYMBOL_LENGTH = 20;  // Symbol最大视觉长度（>=触发）
  const MAX_NAME_LENGTH = 50;     // Name最大视觉长度（>=触发）
  const MAX_ENGLISH_WORDS = 8;   // 英文最大单词数（>触发）

  // 使用视觉长度计算（中文字符算2个单位）
  const symbolVisualLength = getVisualLength(tokenSymbol);
  const nameVisualLength = getVisualLength(tokenName);

  /**
   * 检查字符串是否主要为英文（按单词数判断）
   * @param {string} str - 要检查的字符串
   * @returns {boolean} true表示主要为英文
   */
  const isMostlyEnglish = (str) => {
    if (!str) return false;
    // 计算非CJK字符的比例
    let nonCJKChars = 0;
    for (const char of str) {
      const code = char.codePointAt(0);
      const isCJK = (
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x20000 && code <= 0x2A6DF) ||
        (code >= 0x2A700 && code <= 0x2B73F) ||
        (code >= 0x2B740 && code <= 0x2B81F) ||
        (code >= 0x2B820 && code <= 0x2CEAF) ||
        (code >= 0x2CEB0 && code <= 0x2EBEF) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0x2F800 && code <= 0x2FA1F)
      );
      if (!isCJK && /[a-zA-Z]/.test(char)) {
        nonCJKChars++;
      }
    }
    // 如果英文字符占多数，认为是英文
    return nonCJKChars > str.length / 2;
  };

  /**
   * 计算英文单词数
   * @param {string} str - 英文字符串
   * @returns {number} 单词数
   */
  const countEnglishWords = (str) => {
    if (!str) return 0;
    // 按空格和常见分隔符分割单词
    const words = str.trim().split(/[\s\-_]+/).filter(w => w.length > 0 && /[a-zA-Z]/.test(w));
    return words.length;
  };

  // 检查Symbol长度
  if (tokenSymbol && symbolVisualLength > MAX_SYMBOL_LENGTH) {
    // 对于英文，检查单词数而非字符数
    if (isMostlyEnglish(tokenSymbol)) {
      const wordCount = countEnglishWords(tokenSymbol);
      if (wordCount > MAX_ENGLISH_WORDS) {
        console.log(`[NarrativeAnalyzer] 预检查触发: 代币Symbol过长 (英文单词数: ${wordCount}, 阈值: ${MAX_ENGLISH_WORDS})`);
        return buildPreCheckResult('low', `代币Symbol"${tokenSymbol}"包含${wordCount}个英文单词，超出正常范围（阈值：${MAX_ENGLISH_WORDS}），疑似博眼球而无真实叙事价值`, 'symbol_too_long', { scores: { credibility: 0, virality: 0 }, total_score: 0 });
      }
      // 英文单词数在合理范围内，通过检查
      console.log(`[NarrativeAnalyzer] Symbol长度检查通过: "${tokenSymbol}" (${wordCount}个英文单词 ≤ ${MAX_ENGLISH_WORDS})`);
    } else {
      // 非英文（如中文），使用视觉长度检查
      console.log(`[NarrativeAnalyzer] 预检查触发: 代币Symbol过长 (视觉长度: ${symbolVisualLength}, 实际字符: ${tokenSymbol.length})`);
      return buildPreCheckResult('low', `代币Symbol"${tokenSymbol}"视觉长度为${symbolVisualLength}（实际${tokenSymbol.length}字符），超出正常范围（阈值：${MAX_SYMBOL_LENGTH}），疑似博眼球而无真实叙事价值`, 'symbol_too_long', { scores: { credibility: 0, virality: 0 }, total_score: 0 });
    }
  }

  // 检查Name长度
  if (tokenName && nameVisualLength > MAX_NAME_LENGTH) {
    // 对于英文，检查单词数而非字符数
    if (isMostlyEnglish(tokenName)) {
      const wordCount = countEnglishWords(tokenName);
      if (wordCount > MAX_ENGLISH_WORDS * 2) {  // Name的单词数阈值是Symbol的2倍
        console.log(`[NarrativeAnalyzer] 预检查触发: 代币Name过长 (英文单词数: ${wordCount}, 阈值: ${MAX_ENGLISH_WORDS * 2})`);
        return buildPreCheckResult('low', `代币名称"${tokenName}"包含${wordCount}个英文单词，超出正常范围（阈值：${MAX_ENGLISH_WORDS * 2}），疑似博眼球而无真实叙事价值`, 'name_too_long', { scores: { credibility: 0, virality: 0 }, total_score: 0 });
      }
      // 英文单词数在合理范围内，通过检查
      console.log(`[NarrativeAnalyzer] Name长度检查通过: "${tokenName}" (${wordCount}个英文单词 ≤ ${MAX_ENGLISH_WORDS * 2})`);
    } else {
      // 非英文（如中文），使用视觉长度检查
      console.log(`[NarrativeAnalyzer] 预检查触发: 代币Name过长 (视觉长度: ${nameVisualLength}, 实际字符: ${tokenName.length})`);
      return buildPreCheckResult('low', `代币名称"${tokenName}"视觉长度为${nameVisualLength}（实际${tokenName.length}字符），超出正常范围（阈值：${MAX_NAME_LENGTH}），疑似博眼球而无真实叙事价值`, 'name_too_long', { scores: { credibility: 0, virality: 0 }, total_score: 0 });
    }
  }

  // 规则0.5：同名代币检查（检测蹭热度作弊币）
  // 检查代币发布前是否存在大量同名代币，这通常是蹭热度行为
  const sameNameConfig = NARRATIVE_CONFIG.sameNameCheck || { enabled: true };

  if (sameNameConfig.enabled) {
    // 获取代币创建时间
    const tokenCreatedAt = tokenData.raw_api_data?.created_at;
    if (tokenCreatedAt) {
      const sameNameService = new SameNameCheckService(console);
      const sameNameCheck = await sameNameService.checkIfCopycatToken(
        tokenSymbol,
        tokenName,
        Math.floor(tokenCreatedAt),
        tokenData  // 传入完整代币数据，用于 appendix 对比
      );

      if (sameNameCheck.success && sameNameCheck.isCopycat) {
        const { details } = sameNameCheck;
        console.log(`[NarrativeAnalyzer] 预检查触发: 检测到蹭热度同名代币 (一周内${details.withinOneWeek}个, 其中已"起来过")`);

        return buildPreCheckResult('low', `检测到蹭热度行为：在代币发布前一周内有${details.withinOneWeek}个共享相同叙事的同名代币，且其中已有代币"起来过"（有过明显涨幅/活跃），说明这个叙事已经被市场验证过`, 'copycat_token', { scores: { credibility: 0, virality: 0 }, total_score: 0, sameNameTokens: details.withinOneDayTokens || [], totalOlder: details.totalOlder, duplicateNarrativeCount: details.duplicateNarrativeCount, withinOneWeek: details.withinOneWeek });
      } else if (sameNameCheck.success) {
        console.log(`[NarrativeAnalyzer] 同名代币检查通过 (同名总数: ${sameNameCheck.details.totalOlder}, 重复叙事: ${sameNameCheck.details.duplicateNarrativeCount}, 一周内${sameNameCheck.details.withinOneWeek}个)`);
      } else {
        console.warn(`[NarrativeAnalyzer] 同名代币检查失败: ${sameNameCheck.error || '未知错误'}，跳过此项检查`);
      }
    } else {
      console.log('[NarrativeAnalyzer] 代币无创建时间数据，跳过同名代币检查');
    }
  }

  // 规则0.6：近期重复叙事检查
  // 查询近期被 copycat_token 阻断的代币，如果当前代币共享相同的 Twitter Status ID，也阻断
  // 解决全中文名代币无法通过 Solana 搜索发现蹭热度的问题
  try {
    const currentAppendix = tokenData.raw_api_data?.appendix;
    if (currentAppendix) {
      const parsedCurrentAppendix = typeof currentAppendix === 'string'
        ? JSON.parse(currentAppendix)
        : currentAppendix;
      const currentTwitterId = extractTwitterStatusId(parsedCurrentAppendix?.twitter);

      if (currentTwitterId) {
        const normalizedAddress = (tokenData.raw_api_data?.token || tokenData.address || '').toLowerCase();
        const supabase = NarrativeRepository.getSupabase();
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const { data: recentBlocked, error: queryError } = await supabase
          .from('token_narrative')
          .select('token_address, token_symbol, raw_api_data')
          .contains('pre_check_result', { details: { ruleName: 'copycat_token' } })
          .gte('analyzed_at', oneDayAgo);

        if (!queryError && recentBlocked && recentBlocked.length > 0) {
          for (const blocked of recentBlocked) {
            // 跳过自身
            if (blocked.token_address === normalizedAddress) continue;

            const blockedAppendix = blocked.raw_api_data?.appendix;
            if (!blockedAppendix) continue;
            const parsedBlockedAppendix = typeof blockedAppendix === 'string'
              ? JSON.parse(blockedAppendix)
              : blockedAppendix;
            const blockedTwitterId = extractTwitterStatusId(parsedBlockedAppendix?.twitter);

            if (currentTwitterId === blockedTwitterId) {
              // 只在匹配代币创建更早时才阻断（当前代币是后来者）
              const blockedCreatedAt = blocked.raw_api_data?.created_at;
              const currentCreatedAt = tokenData.raw_api_data?.created_at;
              if (blockedCreatedAt && currentCreatedAt && blockedCreatedAt >= currentCreatedAt) {
                continue; // 匹配代币创建更晚或同时，不能用它阻断当前代币
              }
              const timeDiff = currentCreatedAt && blockedCreatedAt
                ? `当前代币创建于 ${new Date(currentCreatedAt * 1000).toISOString()}, 匹配代币创建于 ${new Date(blockedCreatedAt * 1000).toISOString()}`
                : '';
              console.log(`[NarrativeAnalyzer] 预检查触发: 近期重复叙事 (Twitter Status: ${currentTwitterId}, 匹配代币: ${blocked.token_symbol || ''} ${blocked.token_address}, ${timeDiff})`);
              return buildPreCheckResult('low', `近期已有代币 ${blocked.token_symbol || ''}(${blocked.token_address.slice(0, 10)}...) 因蹭热度被阻断，且共享同一推特链接，判定为重复叙事`, 'recent_duplicate_narrative', { scores: { credibility: 0, virality: 0 }, total_score: 0, matchedTokenAddress: blocked.token_address, matchedTokenSymbol: blocked.token_symbol, matchedTwitterId: currentTwitterId });
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[NarrativeAnalyzer] 近期重复叙事检查失败:', err.message);
  }

  // 规则1：黑名单博主
  // 1.1 从twitterInfo中获取用户名
  let authorScreenName = twitterInfo?.author_screen_name;

  // 1.2 如果twitterInfo为空，尝试从URL提取用户名
  if (!authorScreenName && extractedInfo?.twitter_url) {
    const urlMatch = extractedInfo.twitter_url.match(/x\.com\/([^\/]+)/);
    if (urlMatch) {
      authorScreenName = urlMatch[1];
    }
  }

  if (authorScreenName && NARRATIVE_CONFIG.twitterBlacklist?.includes(authorScreenName)) {
    console.log(`[NarrativeAnalyzer] 预检查触发: 推文作者 @${authorScreenName} 在黑名单中`);
    return buildPreCheckResult('low', `推文作者@${authorScreenName}在黑名单中，该账号专门制造虚假叙事`, 'blacklist', { scores: { credibility: 0, virality: 0 }, total_score: 0 });
  }

  // 规则1.7：应用商店链接检查
  // 应用商店App不适合构建meme币（产品而非事件，缺乏传播属性）
  const appStoreDomains = [
    'apps.apple.com',           // Apple App Store
    'play.google.com',          // Google Play Store
    'appgallery.huawei.com',    // Huawei AppGallery
    'store.steampowered.com',   // Steam Store
    'apps.microsoft.com',       // Microsoft Store
    'www.amazon.com/appstore',  // Amazon Appstore
    'apkcombo.com',             // APK下载站
    'apkpure.com',              // APK下载站
    'apkmirror.com'             // APK下载站
  ];

  // 检查website URL
  const websiteUrl = extractedInfo?.website;
  if (websiteUrl) {
    try {
      const urlObj = new URL(websiteUrl);
      const hostname = urlObj.hostname.toLowerCase();

      if (appStoreDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
        console.log(`[NarrativeAnalyzer] 预检查触发: 检测到应用商店链接 (${websiteUrl})`);
        return buildPreCheckResult('low', `检测到应用商店链接，App产品不适合构建meme币（缺乏事件驱动和病毒传播属性）`, 'app_store_link', { scores: { credibility: 5, virality: 5 }, total_score: 10 });
      }
    } catch (e) {
      // URL解析失败，继续后续检查
      console.warn('[NarrativeAnalyzer] 解析URL失败:', websiteUrl, e.message);
    }
  }

  // 规则2：过期内容检查（推文或视频超过配置的天数阈值）
  // 如果设置了ignoreExpired，跳过过期检查
  if (!ignoreExpired) {
    const expiredDaysThreshold = NARRATIVE_CONFIG.expiredTweetDaysThreshold || 14;

    // 2.1 检查推文过期
    if (twitterInfo?.type === 'tweet' && twitterInfo?.created_at) {
      try {
        const tweetDate = new Date(twitterInfo.created_at);
        const now = new Date();
        const daysDiff = (now - tweetDate) / (1000 * 60 * 60 * 24);

        if (daysDiff > expiredDaysThreshold) {
          console.log(`[NarrativeAnalyzer] 预检查触发: 推文发布时间超过${expiredDaysThreshold}天 (${twitterInfo.formatted_created_at || twitterInfo.created_at})`);
          return buildPreCheckResult('low', `推文发布时间超过${expiredDaysThreshold}天（${twitterInfo.formatted_created_at || twitterInfo.created_at}），叙事价值已耗尽`, 'expired_tweet', { scores: { credibility: 10, virality: 10 }, total_score: 20 });
        }
      } catch (e) {
        console.warn('[NarrativeAnalyzer] 解析推文时间失败:', e.message);
      }
    }

    // 2.2 检查视频过期（抖音、YouTube、TikTok、Bilibili）
    // 视频过期阈值：365天（一年）
    const expiredVideoDaysThreshold = 365;

    const videos = [
      { name: '抖音', info: douyinInfo },
      { name: 'YouTube', info: youtubeInfo },
      { name: 'TikTok', info: tiktokInfo },
      { name: 'Bilibili', info: bilibiliInfo },
      { name: '微信', info: weixinInfo }
    ];

    for (const video of videos) {
      // 获取视频发布时间（不同平台字段名不同）
      const videoTime = video.info?.create_time || video.info?.publish_date || video.info?.create;
      if (videoTime) {
        try {
          const videoDate = new Date(videoTime);
          const now = new Date();
          const daysDiff = (now - videoDate) / (1000 * 60 * 60 * 24);

          if (daysDiff > expiredVideoDaysThreshold) {
            console.log(`[NarrativeAnalyzer] 预检查触发: ${video.name}视频发布时间超过${expiredVideoDaysThreshold}天 (${videoTime})`);
            return buildPreCheckResult('low', `${video.name}视频发布时间超过${expiredVideoDaysThreshold}天（${Math.floor(daysDiff)}天前），叙事价值已耗尽`, 'expired_video', { scores: { credibility: 10, virality: 10 }, total_score: 20 });
          }
        } catch (e) {
          console.warn(`[NarrativeAnalyzer] 解析${video.name}视频时间失败:`, e.message);
        }
      } else if (video.info) {
        // 有视频数据但无发布时间：记录日志用于调试
        console.log(`[NarrativeAnalyzer] ${video.name}视频无发布时间数据，跳过过期检查`);
        console.log(`[NarrativeAnalyzer] ${video.name}视频数据:`, JSON.stringify(video.info).substring(0, 200));
      }
    }
  } else {
    console.log('[NarrativeAnalyzer] 忽略过期时间限制（ignoreExpired=true）');
  }

  // 规则3：视频传播力检查（有视频时直接判断，不走LLM）
  // 优先级：Bilibili > 抖音 > TikTok > YouTube
  const videoPriority = [
    { name: 'Bilibili', info: bilibiliInfo, viewField: 'view_count', likeField: 'like_count' },
    { name: '抖音', info: douyinInfo, viewField: 'view_count', likeField: 'like_count' },
    { name: 'TikTok', info: tiktokInfo, viewField: 'view_count', likeField: 'like_count' },
    { name: 'YouTube', info: youtubeInfo, viewField: 'view_count', likeField: 'like_count' }
  ];

  for (const video of videoPriority) {
    if (!video.info) continue;

    // 检查播放量和点赞数
    const viewCount = video.info[video.viewField];
    const likeCount = video.info[video.likeField];

    // 调试日志：输出播放量和点赞数的值
    console.log(`[NarrativeAnalyzer] ${video.name}视频数据 - 播放量: ${viewCount}, 点赞数: ${likeCount}`);

    // 优先检查播放量，如果没有播放量则检查点赞数
    const hasViewData = viewCount !== undefined && viewCount !== null;
    const hasLikeData = likeCount !== undefined && likeCount !== null;

    if (!hasViewData && !hasLikeData) continue;

    // 设置阈值（播放量或点赞数任一达到即可）
    // 各平台的"爆款"门槛：达到此播放量时，内容过于流行无法准确分析
    const unratedViewThresholdMap = {
      'Bilibili': 500000,     // 50万播放量
      'YouTube': 1000000,     // 100万播放量
      'Twitter': 100000,      // 10万播放量
      'TikTok': 500000,       // 50万播放量（流量大，提高门槛）
      '抖音': 500000          // 50万播放量（流量大，提高门槛）
    };
    const unratedViewThreshold = unratedViewThresholdMap[video.name] || 100000; // 默认10万
    const unratedLikeThreshold = 100000; // 10万点赞（保持不变）

    // 判断是否达到 unrated 阈值
    const viewMeetsThreshold = hasViewData && viewCount >= unratedViewThreshold;
    const likeMeetsThreshold = hasLikeData && likeCount >= unratedLikeThreshold;

    // 调试日志：输出阈值判断结果
    console.log(`[NarrativeAnalyzer] ${video.name}阈值判断 - viewMeetsThreshold: ${viewMeetsThreshold} (${viewCount}>=${unratedViewThreshold}), likeMeetsThreshold: ${likeMeetsThreshold} (${likeCount}>=${unratedLikeThreshold})`);

    // 获取用于显示的数据
    const displayValue = hasViewData ? viewCount : likeCount;
    const displayType = hasViewData ? '播放量' : '点赞数';

    if (viewMeetsThreshold || likeMeetsThreshold) {
      console.log(`[NarrativeAnalyzer] 规则3触发: ${video.name}视频${displayType}=${displayValue}，达到unrated阈值`);
      return buildPreCheckResult('unrated', `${video.name}视频${displayType}${displayValue}，无法解析视频内容进行完整叙事评估`, 'video_unrated');
    }

    // ⚠️ 播放量/点赞数低的情况不再自动返回low，交给LLM判断
    console.log(`[NarrativeAnalyzer] ${video.name}视频未达到unrated阈值，将进入LLM分析`);
  }

  // 规则3.5：微信文章传播力检查
  if (weixinInfo) {
    const readCount = weixinInfo.read_num || 0;
    const likeCount = weixinInfo.like_num || 0;

    // 阅读数低于1000 → low
    if (readCount > 0 && readCount < 1000) {
      console.log(`[NarrativeAnalyzer] 规则3.5触发: 微信文章阅读数(${readCount})低于1000，返回low`);
      return buildPreCheckResult('low', `微信文章阅读数仅${readCount}，传播力不足（阈值：1000）`, 'weixin_low_reads', { scores: { credibility: 10, virality: 10 }, total_score: 20 });
    }

    // 阅读数为0但有文章内容 → 说明文章存在但无法获取统计数据，视为传播力不足
    if (readCount === 0 && weixinInfo.title) {
      console.log(`[NarrativeAnalyzer] 规则3.5触发: 微信文章无法获取阅读数，返回low`);
      return buildPreCheckResult('low', `微信文章无法获取阅读统计数据，视为传播力不足`, 'weixin_no_stats', { scores: { credibility: 10, virality: 10 }, total_score: 20 });
    }
  }

  // 规则3.6：微博交互数据检查
  // 如果引用微博且微博交互数据不高，直接返回 low
  if (backgroundInfo && backgroundInfo.source === 'weibo' && backgroundInfo.metrics) {
    const repostsCount = backgroundInfo.metrics.reposts_count || 0;
    const commentsCount = backgroundInfo.metrics.comments_count || 0;
    const attitudesCount = backgroundInfo.metrics.attitudes_count || 0;

    // 总交互数 = 转发 + 评论 + 点赞
    const totalEngagement = repostsCount + commentsCount + attitudesCount;

    // 阈值：总交互数 < 150 认为传播力不足
    const LOW_ENGAGEMENT_THRESHOLD = 150;

    if (totalEngagement < LOW_ENGAGEMENT_THRESHOLD) {
      const authorName = backgroundInfo.author_name || '未知';
      const engagementDetails = [];
      if (repostsCount > 0) engagementDetails.push(`转发${repostsCount}`);
      if (commentsCount > 0) engagementDetails.push(`评论${commentsCount}`);
      if (attitudesCount > 0) engagementDetails.push(`点赞${attitudesCount}`);

      const engagementStr = engagementDetails.length > 0
        ? engagementDetails.join('、')
        : '无交互数据';

      console.log(`[NarrativeAnalyzer] 规则3.6触发: 微博总交互数(${totalEngagement})低于阈值(${LOW_ENGAGEMENT_THRESHOLD})，返回low`);
      return buildPreCheckResult('low', `微博作者"${authorName}"的交互数据过低（${engagementStr}，总交互${totalEngagement}），传播力不足（阈值：${LOW_ENGAGEMENT_THRESHOLD}）`, 'weibo_low_engagement', { scores: { credibility: 10, virality: 10 }, total_score: 20 });

      console.log(`[NarrativeAnalyzer] 微博交互数据检查通过: 总交互数=${totalEngagement}（转发${repostsCount}+评论${commentsCount}+点赞${attitudesCount}）`);
    }
  }

  // 规则4：公开信息检查（基于 classifiedUrls）
  // 区分两种情况：没有公开信息（unrated） vs 有信息但失效（low）

  // 公开信息平台（排除 Telegram/Discord 通讯应用）
  const publicUrlPlatforms = ['twitter', 'weibo', 'youtube', 'tiktok', 'douyin', 'bilibili', 'weixin', 'github', 'amazon', 'websites'];

  // 检查是否有任何公开URL
  const hasAnyPublicUrl = publicUrlPlatforms.some(platform =>
    classifiedUrls[platform] && classifiedUrls[platform].length > 0
  );

  // 情况A：没有公开URL → low（无法评估叙事，直接不通过）
  if (!hasAnyPublicUrl) {
    const hasTelegram = !!(classifiedUrls.telegram && classifiedUrls.telegram.length > 0);
    const hasDiscord = !!(classifiedUrls.discord && classifiedUrls.discord.length > 0);
    const reason = (hasTelegram || hasDiscord)
      ? '仅有通讯应用链接（Telegram/Discord），缺少公开可验证的叙事信息'
      : '缺少任何有效的公开信息来源（网站、社交媒体、视频等），无法评估叙事';

    console.log(`[NarrativeAnalyzer] 规则4触发: ${reason}`);
    return buildPreCheckResult('low', reason, 'no_public_info');
  }

  // 情况B：有公开URL，检查数据是否获取成功
  const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo };
  const hasValidData = hasValidDataForAnalysis(fetchResults);

  if (!hasValidData) {
    // 有URL但都没获取到数据 → low
    console.log(`[NarrativeAnalyzer] 规则4触发: 有公开信息但内容获取失败或已失效`);
    return buildPreCheckResult('low', '有公开信息链接但内容获取失败或已失效（推文删除、网站无法访问、视频下架等），叙事价值已耗尽', 'public_info_fetch_failed', { scores: { credibility: 5, virality: 5 }, total_score: 10 });
  }

  // 有有效数据，继续后续规则检查

  // 规则5：高影响力推文 + 媒体 → unrated（保护可能的好叙事）
  // 检查条件：
  // 1. 推文作者属于高影响力账号（Elon、Trump等）
  // 2. 或者推文交互数据高（点赞>5000 或 转发>2000）
  // 3. 并且推文带有图片/视频

  // 收集所有可能的推文信息
  const allTweets = [];
  if (twitterInfo?.type === 'tweet') {
    allTweets.push(twitterInfo);
  }
  if (twitterInfo?.website_tweet?.type === 'tweet') {
    allTweets.push(twitterInfo.website_tweet);
  }
  if (twitterInfo?.quoted_status?.type === 'tweet') {
    allTweets.push(twitterInfo.quoted_status);
  }

  for (const tweet of allTweets) {
    // 检查是否有媒体
    const hasMedia = tweet?.media?.has_media ||
                     (tweet?.media?.images && tweet.media.images.length > 0) ||
                     (tweet?.media?.videos && tweet.media.videos.length > 0);

    if (!hasMedia) continue;

    // 检查作者是否是高影响力账号
    const authorScreenName = tweet?.author_screen_name;
    const isHighInfluence = isHighInfluenceAccount(authorScreenName);

    // 检查交互数据是否高
    const metrics = tweet?.metrics || {};
    const likeCount = metrics.like_count || 0;
    const retweetCount = metrics.retweet_count || 0;
    const isHighEngagement = likeCount > 5000 || retweetCount > 2000;

    // 如果满足任一条件 + 有媒体 → 进行图片识别或返回unrated
    if (isHighInfluence || isHighEngagement) {
      const hasImages = tweet?.media?.images && tweet.media.images.length > 0;
      const hasVideos = tweet?.media?.videos && tweet.media.videos.length > 0;

      // 高影响力账号 + 有图片 → 进行图片识别
      if (isHighInfluence && hasImages) {
        console.log(`[NarrativeAnalyzer] 高影响力账号 @${authorScreenName} 的推文包含图片，启动图片识别...`);

        const images = tweet.media.images;
        const analysisResults = [];

        // 最多分析3张图片
        const maxImages = Math.min(images.length, 3);

        for (let i = 0; i < maxImages; i++) {
          const imageUrl = images[i].url;
          try {
            // 下载图片
            const imageData = await ImageDownloader.downloadAsBase64(imageUrl, {
              maxSize: 5 * 1024 * 1024,  // 5MB
              timeout: 15000  // 15秒下载超时
            });

            if (!imageData) {
              console.warn(`[NarrativeAnalyzer] 图片下载失败: ${imageUrl}`);
              continue;
            }

            // 使用 LLM 分析图片（只生成描述信息）
            const imageAnalysis = await LLMClient.analyzeTwitterImage(imageData.dataUrl);

            analysisResults.push({
              image_url: imageUrl,
              analysis: imageAnalysis
            });

            console.log(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] 图片分析成功`);

          } catch (error) {
            console.warn(`[NarrativeAnalyzer] 图片分析失败: ${error.message}`);
          }
        }

        // 将分析结果附加到 twitterInfo
        if (analysisResults.length > 0) {
          if (!twitterInfo._imageAnalysis) {
            twitterInfo._imageAnalysis = [];
          }
          twitterInfo._imageAnalysis.push({
            account: authorScreenName,
            accountBackground: getHighInfluenceAccountBackground(authorScreenName),
            images_analyzed: analysisResults.length,
            results: analysisResults
          });

          console.log(`[NarrativeAnalyzer] 图片识别完成（${analysisResults.length}张），继续LLM分析`);
          // 不返回unrated，继续后续分析
          continue;
        }
      }

      // 有视频或高交互数据（非高影响力账号）→ 仍然返回 unrated
      const reasons = [];
      if (isHighInfluence) {
        const background = getHighInfluenceAccountBackground(authorScreenName);
        reasons.push(`推文作者@${authorScreenName}是高影响力账号（${background}）`);
      }
      if (isHighEngagement) {
        reasons.push(`推文交互数据高（点赞${likeCount}，转发${retweetCount}）`);
      }
      reasons.push(hasVideos ? '推文带有视频内容' : '推文带有其他类型媒体内容（非图片）');

      console.log(`[NarrativeAnalyzer] 规则4触发: ${reasons.join('，')}，返回unrated`);
      return buildPreCheckResult('unrated', `${reasons.join('，')}，暂不支持解析该类型媒体`, 'high_influence_with_media');
    }
  }

  // 规则6：已移除 - Twitter社区名称匹配不再直接返回unrated
  // 社区代币将通过LLM流程进行分析（见shouldUseAccountCommunityAnalysis）
  // 如果只有社区信息且无其他内容，会走账号/社区分析流程

  return null; // 通过预检查，继续LLM分析
}

/**
 * 从 Twitter URL 中提取 Status ID
 * @param {string} url - Twitter URL
 * @returns {string|null} Status ID，提取失败返回 null
 */
function extractTwitterStatusId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i);
  return match ? match[1] : null;
}
