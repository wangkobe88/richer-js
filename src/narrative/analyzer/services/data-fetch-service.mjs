/**
 * Data Fetch Service - 数据获取服务
 * 处理各平台数据的统一获取流程
 */

import { extractAllUrls, classifyAllUrls } from '../../utils/url-classifier.mjs';
import { TwitterFetcher } from '../../utils/twitter-fetcher.mjs';
import { WeiboFetcher } from '../../utils/weibo-fetcher.mjs';
import { GithubFetcher } from '../../utils/github-fetcher.mjs';
import { YoutubeFetcher } from '../../utils/youtube-fetcher.mjs';
import { DouyinFetcher } from '../../utils/douyin-fetcher.mjs';
import { isHighInfluenceAccount } from '../prompts/account-backgrounds.mjs';
import { fetchTikTokVideoInfo, fetchTikTokUserProfile } from '../../utils/tiktok-fetcher.mjs';

// TikTok 影响力等级函数（从原始 NarrativeAnalyzer.mjs 中提取）
function getTikTokInfluenceLevel(tiktokInfo) {
  const viewCount = tiktokInfo.view_count || 0;
  const likeCount = tiktokInfo.like_count || 0;

  // 根据播放量和点赞数判断影响力
  if (viewCount >= 1000000 || likeCount >= 100000) {
    return 'world'; // 世界级：100万播放或10万点赞
  } else if (viewCount >= 100000 || likeCount >= 10000) {
    return 'platform'; // 平台级：10万播放或1万点赞
  } else if (viewCount >= 10000 || likeCount >= 1000) {
    return 'community'; // 社区级：1万播放或1000点赞
  } else {
    return 'niche'; // 小众：低于1万播放且1000点赞
  }
}

function getTikTokInfluenceDescription(level) {
  const descriptions = {
    'world': '世界级影响力（100万+播放）',
    'platform': '平台级影响力（10万+播放）',
    'community': '社区级影响力（1万+播放）',
    'niche': '小众影响力（1万以下播放）'
  };
  return descriptions[level] || '未知影响力';
}
import { BilibiliFetcher } from '../../utils/bilibili-fetcher.mjs';
import { WeixinFetcher } from '../../utils/weixin-fetcher.mjs';
import { fetchProductInfo, getInfluenceLevel, getInfluenceDescription } from '../../utils/amazon-fetcher.mjs';
import { XiaohongshuFetcher } from '../../utils/xiaohongshu-fetcher.mjs';
import { InstagramFetcher } from '../../utils/instagram-fetcher.mjs';
import { BinanceSquareFetcher } from '../../utils/binance-square-fetcher.mjs';
import { fetchWebsiteContent, isFetchableUrl } from '../../utils/web-fetcher.mjs';
import { TwitterMediaExtractor } from '../../utils/twitter-media-extractor.mjs';
import { ImageDownloader } from '../../utils/image-downloader.mjs';
import { detectLanguage, standardizeTranslatedNames } from '../utils/language-utils.mjs';
import { LLMClient } from '../llm/llm-api-client.mjs';

// 获取叙事配置
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = join(__dirname, '../../../../config/default.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const NARRATIVE_CONFIG = config.narrative || {
  enableImageAnalysis: false
};

/**
 * 基于URL分类器的统一数据获取流程
 * @param {Object} tokenData - 代币数据
 * @param {Object} extractedInfo - 提取的结构化信息
 * @returns {Promise<Object>} 所有获取到的数据
 */
export async function fetchAllDataViaClassifier(tokenData, extractedInfo) {
  // 1. 从appendix和raw_api_data中提取所有URL
  const rawData = tokenData.raw_api_data || {};
  let appendix = {};
  if (rawData.appendix && typeof rawData.appendix === 'string') {
    try {
      appendix = JSON.parse(rawData.appendix);
    } catch (e) {
      console.warn('[NarrativeAnalyzer] 解析appendix失败:', e.message);
    }
  } else if (rawData.appendix && typeof rawData.appendix === 'object') {
    appendix = rawData.appendix;
  }

  // 构建完整的数据对象用于URL提取
  const fullData = {
    ...rawData,
    ...extractedInfo,
    appendix
  };

  // 2. 提取所有URL
  const allUrls = extractAllUrls(fullData);
  console.log(`[NarrativeAnalyzer] 从数据中提取到 ${allUrls.length} 个URL`);
  if (allUrls.length > 0) {
    console.log('[NarrativeAnalyzer] 提取到的URL:', allUrls.join(', '));
  } else {
    // 调试：输出关键字段帮助排查
    console.log('[NarrativeAnalyzer] URL提取失败，调试信息:');
    console.log('  - rawData.keys:', Object.keys(rawData).join(', '));
    console.log('  - rawData部分字段:', JSON.stringify({
      socials: rawData.socials,
      socialLinks: rawData.socialLinks,
      links: rawData.links,
      website: rawData.website,
      webUrl: rawData.webUrl,
      twitter: rawData.twitter,
      telegram: rawData.telegram,
      discord: rawData.discord
    }, null, 2));
    console.log('  - extractedInfo:', JSON.stringify(extractedInfo, null, 2));
    console.log('  - appendix:', JSON.stringify(appendix, null, 2));
  }

  if (allUrls.length === 0) {
    console.log('[NarrativeAnalyzer] 未找到任何URL，返回空数据');
    return {
      twitterInfo: null,
      websiteInfo: null,
      backgroundInfo: null,
      githubInfo: null,
      youtubeInfo: null,
      douyinInfo: null,
      tiktokInfo: null,
      bilibiliInfo: null,
      instagramInfo: null,
      xiaohongshuInfo: null,
      weixinInfo: null,
      amazonInfo: null,
      classifiedUrls: {  // 空的分类URL对象
        twitter: [],
        weibo: [],
        youtube: [],
        tiktok: [],
        douyin: [],
        bilibili: [],
        instagram: [],
        xiaohongshu: [],
        weixin: [],
        github: [],
        amazon: [],
        telegram: [],
        discord: [],
        binanceSquare: [],
        websites: []
      },
      fetchErrors: {  // 空的错误对象
        twitterError: null,
        websiteError: null,
        githubError: null,
        videoErrors: {}
      },
      bestUrls: null
    };
  }

  // 3. 分类所有URL
  const classifiedUrls = classifyAllUrls(allUrls);
  console.log('[NarrativeAnalyzer] URL分类结果:', {
    twitter: classifiedUrls.twitter.length,
    weibo: classifiedUrls.weibo.length,
    youtube: classifiedUrls.youtube.length,
    tiktok: classifiedUrls.tiktok.length,
    douyin: classifiedUrls.douyin.length,
    bilibili: classifiedUrls.bilibili.length,
    xiaohongshu: classifiedUrls.xiaohongshu?.length || 0,
    instagram: classifiedUrls.instagram?.length || 0,
    weixin: classifiedUrls.weixin?.length || 0,
    github: classifiedUrls.github.length,
    amazon: classifiedUrls.amazon.length,
    telegram: classifiedUrls.telegram.length,
    discord: classifiedUrls.discord.length,
    binanceSquare: classifiedUrls.binanceSquare?.length || 0,
    websites: classifiedUrls.websites.length
  });

  // 准备URL提取结果
  const url_extraction_result = {
    total_urls: allUrls.length,
    classified_urls: classifiedUrls,
    extraction_errors: []
  };

  // 4. 顺序获取数据（按优先级）
  const fetchData = await fetchDataSequentially(classifiedUrls, tokenData, extractedInfo);

  return {
    ...fetchData,
    url_extraction_result
  };
}

/**
 * 顺序获取各平台数据
 * @param {Object} classifiedUrls - 分类后的所有URL
 * @param {Object} tokenData - 代币数据
 * @param {Object} extractedInfo - 提取的结构化信息
 * @returns {Promise<Object>} 获取到的所有数据
 */
export async function fetchDataSequentially(classifiedUrls, tokenData, extractedInfo) {
  const results = {
    twitterInfo: null,
    websiteInfo: null,
    backgroundInfo: null,
    githubInfo: null,
    youtubeInfo: null,
    douyinInfo: null,
    tiktokInfo: null,
    bilibiliInfo: null,
    instagramInfo: null,
    xiaohongshuInfo: null,
    weixinInfo: null,
    amazonInfo: null,
    binanceSquareInfo: null,
    // 存储数据获取错误信息
    fetchErrors: {
      twitterError: null,
      websiteError: null,
      githubError: null,
      videoErrors: {}
    }
  };

  // 新增：数据获取结果记录
  const dataFetchResults = {};

  // === 辅助函数：从 classifiedUrls 中选择 URL ===
  const selectTwitterUrl = () => {
    if (!classifiedUrls.twitter || classifiedUrls.twitter.length === 0) return null;
    // 优先选择 tweet 类型
    const tweet = classifiedUrls.twitter.find(u => u.type === 'tweet');
    if (tweet) return tweet;
    // 其次选择 community 类型
    const community = classifiedUrls.twitter.find(u => u.type === 'community');
    if (community) return community;
    // 否则返回第一个（可能是 account）
    return classifiedUrls.twitter[0];
  };

  const selectFirstUrl = (platform) => {
    const urls = classifiedUrls[platform];
    if (!urls || urls.length === 0) return null;
    return urls[0];
  };

  // === 1. Twitter数据（最高优先级）===
  const twitterUrlInfo = selectTwitterUrl();
  if (twitterUrlInfo) {
    const twitterFetch = await recordDataFetch(
      async () => {
        let info;

        // 特殊处理：Twitter Community 链接
        if (twitterUrlInfo.type === 'community') {
          console.log('[NarrativeAnalyzer] 检测到Twitter Community链接，获取社区信息');
          try {
            // 从URL中提取community ID
            const communityIdMatch = twitterUrlInfo.url.match(/\/communities\/(\d+)/);
            if (communityIdMatch) {
              const communityId = communityIdMatch[1];
              const { fetchCommunityById } = await import('../../utils/twitter-validation/communities-api.js');
              info = await fetchCommunityById(communityId);

              if (info) {
                // 将社区信息转换为twitter_info兼容格式
                info = {
                  id: info.id,  // 保留community_id，供后续规则验证使用
                  type: 'community',
                  name: info.name,
                  description: info.description,
                  members_count: info.members_count,
                  moderators_count: info.moderators_count,
                  rules: info.rules,
                  avatar_image_url: info.avatar_image_url,
                  banner_image_url: info.banner_image_url,
                  created_at: info.created_at,
                  // 保留原始community数据用于后续分析
                  community_results: info
                };
                console.log(`[NarrativeAnalyzer] 成功获取Twitter社区: "${info.name}" (${info.members_count}成员)`);
              }
            }
          } catch (err) {
            console.warn('[NarrativeAnalyzer] 获取Twitter社区信息失败:', err.message);
          }
        } else {
          // 常规推文/账号获取
          info = await TwitterFetcher.fetchFromUrls(twitterUrlInfo.url, null);
        }

        // 如果成功获取推文，尝试获取推文中的链接内容
        if (info && info.text) {
          console.log('[NarrativeAnalyzer] 推文已获取，尝试获取推文链接内容');
          info = await TwitterFetcher.enrichWithLinkContent(info);
        }

        // 图片分析已禁用 — 推文图片分析结果对叙事判断贡献有限，节省下载+压缩+LLM开销
        // const screenName = info?.author_screen_name || info?.screen_name;
        // const isHighInfluence = isHighInfluenceAccount(screenName);
        // if (NARRATIVE_CONFIG.enableImageAnalysis && isHighInfluence && info?.media && TwitterMediaExtractor.hasImages(info)) {
        //   console.log(`[NarrativeAnalyzer] 高影响力账号 @${screenName} 推文包含图片，开始分析...`);
        //   const imageUrls = TwitterMediaExtractor.extractImageUrls(info);
        //   const firstImage = imageUrls[0];
        //   if (firstImage) {
        //     try {
        //       const imageData = await ImageDownloader.downloadAsBase64(firstImage.url);
        //       if (imageData) {
        //         const imageAnalysis = await LLMClient.analyzeTwitterImage(imageData.dataUrl);
        //         info.image_analysis = {
        //           url: firstImage.url,
        //           analysis: imageAnalysis
        //         };
        //         console.log('[NarrativeAnalyzer] 图片分析完成');
        //       }
        //     } catch (error) {
        //       console.warn('[NarrativeAnalyzer] 图片分析失败:', error.message);
        //     }
        //   }
        // } else if (NARRATIVE_CONFIG.enableImageAnalysis && !isHighInfluence && info?.media && TwitterMediaExtractor.hasImages(info)) {
        //   console.log(`[NarrativeAnalyzer] 非高影响力账号 @${screenName}，跳过图片分析`);
        // }

        // 非中英文推文翻译
        if (info && info.text) {
          const tweetLang = detectLanguage(info.text);
          if (tweetLang && tweetLang !== 'zh' && tweetLang !== 'en') {
            console.log(`[NarrativeAnalyzer] 检测到非中英文推文 (${tweetLang})，尝试翻译...`);
            try {
              const translated = await LLMClient.translate(info.text, 'zh');
              if (translated) {
                const standardized = standardizeTranslatedNames(translated, tokenData.symbol);
                info.text_original = info.text;
                info.text = standardized;
                info.text_translated = true;
                info.original_language = tweetLang;
                console.log('[NarrativeAnalyzer] 推文翻译成功');
              }
            } catch (error) {
              console.warn('[NarrativeAnalyzer] 推文翻译失败:', error.message);
            }
          }
        }

        // 检查是否有第二个推文（classifiedUrls中的第二个twitter URL）
        let secondTweetUrl = null;

        // 检查classifiedUrls.twitter中是否有多个推文
        if (classifiedUrls.twitter && classifiedUrls.twitter.length > 1) {
          // 第一个是主推文，查找第二个不同的推文
          const mainUrl = twitterUrlInfo.url;
          const secondTweetInfo = classifiedUrls.twitter.find(t => t.url !== mainUrl && t.type === 'tweet');
          // 如果没有第二个推文，查找第二个账号（作为补充）
          const secondInfo = secondTweetInfo || classifiedUrls.twitter.find(t => t.url !== mainUrl);
          if (secondInfo) {
            secondTweetUrl = secondInfo.url;
          }
        }

        // 获取第二个推文
        if (secondTweetUrl) {
          console.log('[NarrativeAnalyzer] 检测到第二个推文链接，获取中...');
          try {
            const websiteTweet = await TwitterFetcher.fetchFromUrls(secondTweetUrl, null);
            if (websiteTweet && websiteTweet.type === 'tweet' && websiteTweet.text) {
              info.website_tweet = websiteTweet;
              console.log('[NarrativeAnalyzer] 成功获取第二个推文');
            }
          } catch (error) {
            console.warn('[NarrativeAnalyzer] 获取第二个推文失败:', error.message);
          }
        }

        // 回退检查：如果主推文获取失败且存在社区URL，回退获取社区数据
        if ((!info || !info.text) && twitterUrlInfo.type !== 'community') {
          const communityUrlInfo = classifiedUrls.twitter.find(t => t.type === 'community' && t.url !== twitterUrlInfo.url);
          if (communityUrlInfo) {
            console.log('[NarrativeAnalyzer] 主推文获取失败，回退获取社区数据:', communityUrlInfo.url);
            try {
              const communityIdMatch = communityUrlInfo.url.match(/\/communities\/(\d+)/);
              if (communityIdMatch) {
                const communityId = communityIdMatch[1];
                const { fetchCommunityById } = await import('../../../utils/twitter-validation/communities-api.js');
                const communityData = await fetchCommunityById(communityId);
                if (communityData) {
                  info = {
                    id: communityData.id,
                    type: 'community',
                    name: communityData.name,
                    description: communityData.description,
                    members_count: communityData.members_count,
                    moderators_count: communityData.moderators_count,
                    rules: communityData.rules,
                    avatar_image_url: communityData.avatar_image_url,
                    banner_image_url: communityData.banner_image_url,
                    created_at: communityData.created_at,
                    community_results: communityData
                  };
                  console.log(`[NarrativeAnalyzer] 回退成功，获取到社区: "${communityData.name}" (${communityData.members_count}成员)`);
                }
              }
            } catch (err) {
              console.warn('[NarrativeAnalyzer] 回退获取社区数据失败:', err.message);
            }
          }
        }

        return info;
      },
      'twitter',
      twitterUrlInfo.url
    );
    results.twitterInfo = twitterFetch.data;
    dataFetchResults.twitter = twitterFetch.record;
    if (!twitterFetch.record.success) {
      results.fetchErrors.twitterError = twitterFetch.record.error;
    }
  }

  // === 2. 微博数据（作为背景信息）===
  if (classifiedUrls.weibo.length > 0) {
    const weiboUrlInfo = classifiedUrls.weibo[0];
    console.log(`[NarrativeAnalyzer] 获取微博数据作为背景信息: ${weiboUrlInfo.url}`);
    try {
      if (weiboUrlInfo.type === 'user_profile') {
        // 用户主页
        results.backgroundInfo = await WeiboFetcher.fetchUserProfile(weiboUrlInfo.url);
        if (results.backgroundInfo) {
          results.backgroundInfo.source = 'weibo';
          console.log(`[NarrativeAnalyzer] 微博用户主页获取成功: ${results.backgroundInfo.screen_name}`);
        }
      } else {
        // 微博帖子
        results.backgroundInfo = await WeiboFetcher.fetchFromUrl(weiboUrlInfo.url);
        if (results.backgroundInfo) {
          results.backgroundInfo.source = 'weibo';
          console.log('[NarrativeAnalyzer] 微博数据获取成功');
        }
      }
    } catch (error) {
      console.warn('[NarrativeAnalyzer] 微博数据获取失败:', error.message);
    }
  }

  // === 3. GitHub数据 ===
  const githubUrlInfo = selectFirstUrl('github');
  if (githubUrlInfo) {
    const githubFetch = await recordDataFetch(
      async () => {
        const info = await GithubFetcher.fetchRepoInfo(githubUrlInfo.url);
        if (info) {
          const influenceLevel = GithubFetcher.getInfluenceLevel(info);
          info.influence_level = influenceLevel;
          info.influence_description = GithubFetcher.getInfluenceDescription(influenceLevel);
          info.is_official_token = GithubFetcher.isOfficialToken(info, tokenData.symbol);
          console.log(`[NarrativeAnalyzer] GitHub信息: ${info.stargazers_count} stars`);
        }
        return info;
      },
      'github',
      githubUrlInfo.url
    );
    results.githubInfo = githubFetch.data;
    dataFetchResults.github = githubFetch.record;
  }

  // === 4. YouTube数据 ===
  const youtubeUrlInfo = selectFirstUrl('youtube');
  if (youtubeUrlInfo) {
    const youtubeFetch = await recordDataFetch(
      async () => {
        if (youtubeUrlInfo.type === 'channel') {
          // 频道
          const info = await YoutubeFetcher.fetchChannelInfo(youtubeUrlInfo.url);
          if (info) {
            console.log(`[NarrativeAnalyzer] YouTube频道: "${info.channel_title}"`);
          }
          return info;
        }
        // 视频
        const info = await YoutubeFetcher.fetchVideoInfo(youtubeUrlInfo.url);
        if (info) {
          const influenceLevel = YoutubeFetcher.getInfluenceLevel(info);
          info.influence_level = influenceLevel;
          info.influence_description = YoutubeFetcher.getInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] YouTube信息: "${info.title}"`);
        }
        return info;
      },
      'youtube',
      youtubeUrlInfo.url
    );
    results.youtubeInfo = youtubeFetch.data;
    dataFetchResults.youtube = youtubeFetch.record;
    if (!youtubeFetch.record.success) {
      results.fetchErrors.videoErrors.youtube = youtubeFetch.record.error;
    }
  }

  // === 5. 抖音数据 ===
  const douyinUrlInfo = selectFirstUrl('douyin');
  if (douyinUrlInfo) {
    const douyinFetch = await recordDataFetch(
      async () => {
        if (douyinUrlInfo.type === 'user_profile') {
          // 用户主页
          const info = await DouyinFetcher.fetchUserProfile(douyinUrlInfo.url);
          if (info) {
            console.log(`[NarrativeAnalyzer] 抖音用户主页: "${info.nickname}" (粉丝${info.follower_count})`);
          }
          return info;
        }
        // 视频
        const info = await DouyinFetcher.fetchVideoInfo(douyinUrlInfo.url);
        if (info) {
          const influenceLevel = DouyinFetcher.getInfluenceLevel(info);
          info.influence_level = influenceLevel;
          info.influence_description = DouyinFetcher.getInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] 抖音信息: "${info.title}"`);
        }
        return info;
      },
      'douyin',
      douyinUrlInfo.url
    );
    results.douyinInfo = douyinFetch.data;
    dataFetchResults.douyin = douyinFetch.record;
    if (!douyinFetch.record.success) {
      results.fetchErrors.videoErrors.douyin = douyinFetch.record.error;
    }
  }

  // === 6. TikTok数据 ===
  const tiktokUrlInfo = selectFirstUrl('tiktok');
  if (tiktokUrlInfo) {
    const tiktokFetch = await recordDataFetch(
      async () => {
        if (tiktokUrlInfo.type === 'user_profile') {
          // 用户主页
          const info = await fetchTikTokUserProfile(tiktokUrlInfo.url);
          if (info) {
            console.log(`[NarrativeAnalyzer] TikTok用户: @${info.unique_id} (粉丝${info.follower_count})`);
          }
          return info;
        }
        // 视频
        const info = await fetchTikTokVideoInfo(tiktokUrlInfo.url);
        if (info) {
          const influenceLevel = getTikTokInfluenceLevel(info);
          info.influence_level = influenceLevel;
          info.influence_description = getTikTokInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] TikTok信息: @${info.author_username}`);
        }
        return info;
      },
      'tiktok',
      tiktokUrlInfo.url
    );
    results.tiktokInfo = tiktokFetch.data;
    dataFetchResults.tiktok = tiktokFetch.record;
    if (!tiktokFetch.record.success) {
      results.fetchErrors.videoErrors.tiktok = tiktokFetch.record.error;
    }
  }

  // === 7. Bilibili数据 ===
  const bilibiliUrlInfo = selectFirstUrl('bilibili');
  if (bilibiliUrlInfo) {
    const bilibiliFetch = await recordDataFetch(
      async () => {
        const info = await BilibiliFetcher.fetchVideoInfo(bilibiliUrlInfo.url);
        if (info) {
          const influenceLevel = BilibiliFetcher.getInfluenceLevel(info);
          info.influence_level = influenceLevel;
          info.influence_description = BilibiliFetcher.getInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] Bilibili信息: "${info.title}"`);
        }
        return info;
      },
      'bilibili',
      bilibiliUrlInfo.url
    );
    results.bilibiliInfo = bilibiliFetch.data;
    dataFetchResults.bilibili = bilibiliFetch.record;
    if (!bilibiliFetch.record.success) {
      results.fetchErrors.videoErrors.bilibili = bilibiliFetch.record.error;
    }
  }

  // === 8. 币安广场数据 ===
  const binanceSquareUrlInfo = selectFirstUrl('binanceSquare');
  if (binanceSquareUrlInfo) {
    const bsFetch = await recordDataFetch(
      async () => {
        const info = await BinanceSquareFetcher.fetchPostInfo(binanceSquareUrlInfo.url);
        if (info) {
          const influenceLevel = BinanceSquareFetcher.getInfluenceLevel(info);
          info.influence_level = influenceLevel;
          info.influence_description = BinanceSquareFetcher.getInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] 币安广场信息: "${info.title || '无标题'}" (方法: ${info.fetchMethod})`);
        }
        return info;
      },
      'binanceSquare',
      binanceSquareUrlInfo.url
    );
    results.binanceSquareInfo = bsFetch.data;
    dataFetchResults.binanceSquare = bsFetch.record;
  }

  // === 9. 微信文章数据 ===
  const weixinUrlInfo = selectFirstUrl('weixin');
  if (weixinUrlInfo) {
    const weixinFetch = await recordDataFetch(
      async () => {
        const info = await WeixinFetcher.fetchArticleInfo(weixinUrlInfo.url);
        if (info) {
          console.log(`[NarrativeAnalyzer] 微信文章信息: "${info.title}"`);
        }
        return info;
      },
      'weixin',
      weixinUrlInfo.url
    );
    results.weixinInfo = weixinFetch.data;
    dataFetchResults.weixin = weixinFetch.record;
    if (!weixinFetch.record.success) {
      results.fetchErrors.videoErrors.weixin = weixinFetch.record.error;
    }
  }

  // === 9. Amazon数据 ===
  const amazonUrlInfo = selectFirstUrl('amazon');
  if (amazonUrlInfo) {
    const amazonFetch = await recordDataFetch(
      async () => {
        const info = await fetchProductInfo(amazonUrlInfo.url);
        if (info) {
          const influenceLevel = getInfluenceLevel(info);
          info.influence_level = influenceLevel;
          info.influence_description = getInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] Amazon信息: "${info.title}"`);
        }
        return info;
      },
      'amazon',
      amazonUrlInfo.url
    );
    results.amazonInfo = amazonFetch.data;
    dataFetchResults.amazon = amazonFetch.record;
    if (!amazonFetch.record.success) {
      results.fetchErrors.videoErrors.amazon = amazonFetch.record.error;
    }
  }

  // === 10. 小红书数据 ===
  const xiaohongshuUrlInfo = selectFirstUrl('xiaohongshu');
  if (xiaohongshuUrlInfo) {
    const xiaohongshuFetch = await recordDataFetch(
      async () => {
        if (xiaohongshuUrlInfo.type === 'user_profile') {
          // 用户主页
          const info = await XiaohongshuFetcher.fetchUserProfile(xiaohongshuUrlInfo.url);
          if (info) {
            console.log(`[NarrativeAnalyzer] 小红书用户主页: "${info.nickname}" (粉丝${info.fans})`);
          }
          return info;
        } else {
          // 笔记
          const info = await XiaohongshuFetcher.fetchNoteInfo(xiaohongshuUrlInfo.url);
          if (info) {
            const influenceLevel = XiaohongshuFetcher.getInfluenceLevel(info);
            info.influence_level = influenceLevel;
            info.influence_description = XiaohongshuFetcher.getInfluenceDescription(influenceLevel);
            console.log(`[NarrativeAnalyzer] 小红书信息: "${info.title}"`);
          }
          return info;
        }
      },
      'xiaohongshu',
      xiaohongshuUrlInfo.url
    );
    results.xiaohongshuInfo = xiaohongshuFetch.data;
    dataFetchResults.xiaohongshu = xiaohongshuFetch.record;
    if (!xiaohongshuFetch.record.success) {
      results.fetchErrors.videoErrors.xiaohongshu = xiaohongshuFetch.record.error;
    }
  }

  // === 10.5. Instagram 数据 ===
  const instagramUrlInfo = selectFirstUrl('instagram');
  if (instagramUrlInfo) {
    const instagramFetch = await recordDataFetch(
      async () => {
        if (instagramUrlInfo.type === 'user_profile') {
          const info = await InstagramFetcher.fetchProfileInfo(instagramUrlInfo.url);
          if (info) {
            console.log(`[NarrativeAnalyzer] Instagram用户: @${info.username} (粉丝${info.follower_count})`);
          }
          return info;
        } else {
          const info = await InstagramFetcher.fetchPostInfo(instagramUrlInfo.url);
          if (info) {
            console.log(`[NarrativeAnalyzer] Instagram${info.type === 'reel' ? ' Reel' : '帖子'}: @${info.user.username} (${info.metrics.like_count}赞)`);
          }
          return info;
        }
      },
      'instagram',
      instagramUrlInfo.url
    );
    results.instagramInfo = instagramFetch.data;
    dataFetchResults.instagram = instagramFetch.record;
    if (!instagramFetch.record.success) {
      results.fetchErrors.videoErrors.instagram = instagramFetch.record.error;
    }
  }

  // === 11. 普通网站数据 ===
  const websiteUrlInfo = selectFirstUrl('websites');
  if (websiteUrlInfo) {
    const websiteUrl = websiteUrlInfo.url;
    // 排除视频平台、GitHub和Amazon（已经处理过）
    const isVideoPlatform = /youtube|youtu\.be|tiktok|douyin|bilibili|b23\.tv/i.test(websiteUrl);
    const isGithub = /github\.com/i.test(websiteUrl);
    const isAmazon = /amazon\.com/i.test(websiteUrl);
    const isBinanceSquare = /binance\.com\/.*\/square\//i.test(websiteUrl);

    if (!isVideoPlatform && !isGithub && !isAmazon && !isBinanceSquare && isFetchableUrl(websiteUrl)) {
      const websiteFetch = await recordDataFetch(
        () => fetchWebsiteContent(websiteUrl, { maxLength: 5000 }),
        'website',
        websiteUrl
      );
      results.websiteInfo = websiteFetch.data;
      dataFetchResults.website = websiteFetch.record;
      if (!websiteFetch.record.success) {
        results.fetchErrors.websiteError = websiteFetch.record.error;
      }
    }
  }

  return { ...results, classifiedUrls, dataFetchResults };
}

/**
 * 记录数据获取的元数据
 * @param {Function} fetcherFn - 数据获取函数
 * @param {string} platform - 平台名称
 * @param {string} url - 请求的URL
 * @returns {Promise<Object>} { data, record } - data是获取的数据，record是元数据
 */
export async function recordDataFetch(fetcherFn, platform, url) {
  if (!url) {
    return { data: null, record: null };
  }

  const startedAt = new Date().toISOString();
  let data, error;

  try {
    data = await fetcherFn();
    return {
      data,
      record: {
        success: true,
        url,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        error: null
      }
    };
  } catch (e) {
    error = e.message;
    return {
      data: null,
      record: {
        success: false,
        url,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        error
      }
    };
  }
}
