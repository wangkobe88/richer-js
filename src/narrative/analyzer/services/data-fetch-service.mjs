/**
 * Data Fetch Service - 数据获取服务
 * 处理各平台数据的统一获取流程
 */

import { extractAllUrls, classifyAllUrls } from '../../utils/url-classifier.mjs';
import { fetchIpfsMetadata, normalizeIpfsRef } from '../../utils/ipfs-metadata-fetcher.mjs';
import { fetchGmgnSocialLinks, hasTwitterLink } from '../../utils/gmgn-social-fetcher.mjs';
import { fetchAveSocialLinks } from '../../utils/ave-social-fetcher.mjs';
import { isSuperIpTweetUrl } from '../prompts/super-ip/super-ip-registry.mjs';
import { TwitterFetcher } from '../../utils/twitter-fetcher.mjs';
import { WeiboFetcher } from '../../utils/weibo-fetcher.mjs';
import { GithubFetcher } from '../../utils/github-fetcher.mjs';
import { YoutubeFetcher } from '../../utils/youtube-fetcher.mjs';
import { DouyinFetcher } from '../../utils/douyin-fetcher.mjs';
import { isHighInfluenceAccount } from '../prompts/account/account-backgrounds.mjs';
import { fetchTikTokVideoInfo, fetchTikTokUserProfile } from '../../utils/tiktok-fetcher.mjs';
import { isCorpusGateOn, pendingCorpusPlatforms, shouldAskCorpusGate, runCorpusGate } from './corpus-gate-service.mjs';

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
import { createSegmentTimer } from '../../utils/segment-timer.mjs';
import { CachedFetcher } from '../../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../../db/cache-ttl-config.mjs';
import { ImageDownloader } from '../../utils/image-downloader.mjs';
import { detectLanguage, standardizeTranslatedNames } from '../utils/language-utils.mjs';
import { getConfig } from '../../engine/config.mjs';
// 3a：全局 keepAlive——模块加载即生效（叙事大链必经此模块，早于任何 fetch 调用；
// 幂等守卫在 http-keepalive 模块内）
import { installKeepAlive } from '../utils/http-keepalive.mjs';
installKeepAlive();

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

// C115 纯 website 兜底语料判定的「全平台语料」键集（fetchDataSequentially results
// 的全部 <x>Info 键去掉 websiteInfo 本身）：全 null = 无任何平台语料在手——
// 平台无 URL 与抓取失败同形状；extractedInfo.description/intro 是宣告文案不算
// 抓取语料，刻意不在集内（见 fetchDataSequentially 尾部 C115 段）
const CORPUS_FALLBACK_INFO_KEYS = [
  'twitterInfo', 'backgroundInfo', 'githubInfo', 'youtubeInfo', 'douyinInfo',
  'tiktokInfo', 'bilibiliInfo', 'instagramInfo', 'xiaohongshuInfo', 'weixinInfo',
  'amazonInfo', 'binanceSquareInfo',
];

/**
 * 基于URL分类器的统一数据获取流程
 * @param {Object} tokenData - 代币数据
 * @param {Object} extractedInfo - 提取的结构化信息
 * @param {Object} [options]
 * @param {boolean} [options.enrichSocialByGmgn] - GMGN 社媒补源开关（BRF 案，
 *   2026-09-27 用户裁定）：仅交易引擎叙事直调传 true（买门已 fire 才花 GMGN 配额）；
 *   narrative engine 队列链路不传，零行为变化
 * @param {Object} [options.timing] - 分段计时器（N1 探针 2026-10-13 叙事提速案）：
 *   createSegmentTimer 产物，不传 → 旁路模式零行为变化；ipfs/gmgn/各平台 fetch 段
 *   落 { seg: 'ipfs'|'gmgn'|'fetch.<platform>', ms }
 * @returns {Promise<Object>} 所有获取到的数据
 */
export async function fetchAllDataViaClassifier(tokenData, extractedInfo, options = {}) {
  const timing = options.timing || createSegmentTimer(null);
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

  // 3. 解包链上 IPFS metadata（C7）：API twitterUrl/webUrl 为空时真实社交链接只在
  // meta 指向的 JSON 里（ARENA 案：公告推文先于铸币 7m40s 发出，却因不解包被规则4-B 误拦）。
  // 解包位于 0-URL 早退之前（BRF 案前移，2026-09-27）：meta 可能是 extractAllUrls
  // 不识别的裸 CID（BRF：meta="bafkreigaw…"），0-URL 的 token 也要解包——
  // IPFS 解包免费，先于 GMGN 付费补源。C112：meta 任意 http(s) URL 都尝试解包
  // （meta 字段语义即 metadata 指针，内容判定非形状判定），非 JSON 回落原路径
  //
  // N2 前缀并行（2026-10-13 叙事提速案）：IPFS 与 AVE 互不依赖同发；两者的
  // links/metadata 都要先于 URL 分类，但相互无依赖。
  // **应用顺序刻意保持 IPFS → AVE**：AVE 并入判定基于含 IPFS 新增 URL 的
  // allUrls（IPFS 解包补出 twitter 的罕见票 AVE 白调一次接受——调用量省不
  // 过这点并行性），URL 并入顺序影响 classifiedUrls 桶内顺序与 selectTwitterUrl
  // 选择——顺序变即内容变，此处 bit 一致
  //
  // C238 源优先级链（2026-10-26 用户裁定「GMGN 一定是所有的数据都失效后才走
  // 这一路，因为 GMGN API 无付费版本，容易因为流量封锁使用」）：
  //   meta/appendix → IPFS 解包 → AVE token detail → GMGN → C77 搜索（最后手段）
  // AVE 门判据=pre-IPFS 的 allUrls（与旧 GMGN 并行门同基准）；GMGN 自 C238 起
  // **串行在 AVE 之后**（原 IPFS∥GMGN 并行结构退役），判据升级为含 IPFS+AVE
  // 的 allUrls——串行化后判据变严只省 GMGN 配额，重叠白调形状消失
  // C182 必要门（2026-10-23 用户裁定「ave api 信息够了就不需要补充」——GMGN IP
  // 级 RATE_LIMIT_BANNED 事故，v34 15h 实测 694 次成功调用仅 37 次真正并入社媒，
  // 95% 是 live 买门不消费的风险字段白烧）：URL 集已含 twitter 链接 → 整段跳过
  // GMGN 不发包。C51 例外臂（已有 twitter 仍并入 superIP 推文）主要触发源随门
  // 退役；例外分支代码保留，残余形状=前置源全无 twitter 而 GMGN 补出的罕见票
  // 仍可命中
  const aveNeeded = !hasTwitterLink(allUrls);
  const metaUrl = normalizeIpfsRef(typeof rawData.meta === 'string' ? rawData.meta : null);
  const [metadata, aveSocials] = await Promise.all([
    metaUrl ? timing.wrap('ipfs', () => fetchIpfsMetadata(metaUrl)) : Promise.resolve(null),
    aveNeeded
      ? timing.wrap('ave', () => fetchAveSocialLinks('bsc', tokenData.address)
        .catch(e => {
          // AVE 失败按无补源继续（同 GMGN 形状）：AVE 是付费 key，无 IP 封禁
          // 续封循环形状，不做失败封顶
          console.warn('[NarrativeAnalyzer] AVE 补源获取失败（按无补源继续）:', e.message);
          return null;
        }))
      : Promise.resolve(null),
  ]);

  if (metadata) {
    const metaUrls = extractAllUrls(metadata);
    const newUrls = metaUrls.filter(u => !allUrls.includes(u));
    if (newUrls.length > 0) {
      console.log(`[NarrativeAnalyzer] IPFS metadata 解包新增 ${newUrls.length} 个URL: ${newUrls.join(', ')}`);
      allUrls.push(...newUrls);
    }
    // 解包成功：meta URL 本身不再作为 website 抓取（内容已展开，JSON 非网页）
    const metaIdx = allUrls.indexOf(metaUrl);
    if (metaIdx >= 0) allUrls.splice(metaIdx, 1);
  } else if (metaUrl) {
    console.warn('[NarrativeAnalyzer] IPFS metadata 解包失败，meta 链接按原流程作为 website 处理');
  }

  // 3.2 AVE token detail appendix（C238 社媒补源第三层，2026-10-26 股城案）：
  // flap 票链上 meta 无链接而 AVE 有独立社媒聚合（股城实测 appendix 带
  // STOCK__OPOLIS 官方号）；four.meme 票 AVE=元数据镜像（BRF 三例对照）=白调
  // 一次无害。IPFS 已补出 twitter → AVE 结果弃用（白调一次接受，见上方注释）
  if (aveSocials && !hasTwitterLink(allUrls)) {
    const addUrls = [aveSocials.twitterUrl, aveSocials.websiteUrl]
      .filter(u => u && !allUrls.includes(u));
    if (addUrls.length > 0) {
      console.log(`[NarrativeAnalyzer] AVE 社媒补源新增 ${addUrls.length} 个URL: ${addUrls.join(', ')}`);
      allUrls.push(...addUrls);
    }
  }

  // 3.3 GMGN 串行在 AVE 之后（C238 源优先级链第四层——所有前置源都失效才走：
  // 免费版 IP 封禁风险配额最省着烧；判据=此刻含 IPFS+AVE 的 allUrls，串行化后
  // 比旧 pre-IPFS 基准更严=重叠白调消失）
  const gmgnNeeded = options.enrichSocialByGmgn && !hasTwitterLink(allUrls);
  const gmgnSocials = gmgnNeeded
    ? await timing.wrap('gmgn', () => fetchGmgnSocialLinks('bsc', tokenData.address)
      .catch(e => {
        // 失败按无补源、无风险因子继续，行为与现状一致
        console.warn('[NarrativeAnalyzer] GMGN 补源/风险获取失败（按无补源继续）:', e.message);
        return null;
      }))
    : null;

  // 3.5 GMGN token info（BRF 社媒补源 + x-0 风险因子，2026-09-27）：
  // enrichSocialByGmgn（C238 起默认 true 全链路放开——原「仅叙事直调传 true」
  // 特权废止，2026-10-26 用户裁定「我从来没有要求关闭过，我的期望是打开」；配额
  // 由源优先级链必要门控制）时
  // **必要才调用**（C182 必要门，2026-10-23 裁定——原「总是调用」为同一次
  // getTokenInfo 带出 dev 风险字段，但该快照 live 买门不消费（GmgnRiskCheckService
  // 刻意隔离自抓），v34 15h 实测 95% 调用白烧并触发 IP 级封禁）；社媒并入仍以
  // 「无 twitter 链接」为前提（C10 行为零变化——有语料的 token 不需要补源）。
  // **例外（C51 龙虾案，2026-10-01 用户裁定「GMGN 补源返回的 twitterUrl 是推文
  // URL——如果是超级IP再并入」）**：GMGN link.twitter_username 可能带完整推文路径
  // （龙虾 0xeccbb861…4444 实测 "binancezh/status/2027304629890072818"——币安中文
  // Day 559 梗帖 2m57s 抢发票，自挂链接是 222 粉 3 推马甲号），「已有 twitter 链接
  // 不补」使 superIP 真语料被马甲号挡住；仅当 GMGN 推文 URL 作者在超级IP注册表
  // 时突破并入（普通推文/账号 URL 仍守 C10——superIP 推文才是强叙事锚）。并入后
  // selectTwitterUrl 的 tweet 类型优先保证它被选中而非自挂账号链接。
  // **C182（2026-10-23）**：AVE 已有 twitter 的票不再调 GMGN，本例外臂主要触发
  // 源随必要门退役（用户裁定；残余形状=pre-IPFS 无 twitter 而 IPFS 补出的罕见票，
  // 下方 else if 分支保留对其生效）。
  // GMGN 也拿不到 / 调用失败 → 按无补源、无风险因子继续，行为与现状一致
  let gmgnRisk = null;
  if (gmgnSocials) {
    gmgnRisk = gmgnSocials.risk ?? null;
    const superIpTweet = isSuperIpTweetUrl(gmgnSocials.twitterUrl || null);
    if (superIpTweet) {
      console.log(`[NarrativeAnalyzer] GMGN 超级IP推文命中(C51): ${gmgnSocials.twitterUrl} → ${superIpTweet.name}（tier ${superIpTweet.tier}）`);
    }
    // 判据改用 hasTwitterLink（C182 单一真相：与必要门同源，原内联正则逐字同形）
    const hasTwitterUrl = hasTwitterLink(allUrls);
    if (!hasTwitterUrl) {
      const addUrls = [gmgnSocials.twitterUrl, gmgnSocials.websiteUrl]
        .filter(u => u && !allUrls.includes(u));
      if (addUrls.length > 0) {
        console.log(`[NarrativeAnalyzer] GMGN 社媒补源新增 ${addUrls.length} 个URL: ${addUrls.join(', ')}`);
        allUrls.push(...addUrls);
      }
    } else if (superIpTweet && !allUrls.includes(gmgnSocials.twitterUrl)) {
      // C51 例外：已有 twitter 链接，但 GMGN 给出 superIP 推文 URL——只并入该推文
      // （websiteUrl 不随例外路径并入，C10 语义对它不变）
      console.log(`[NarrativeAnalyzer] GMGN 超级IP推文补源新增(C51): ${gmgnSocials.twitterUrl}（${superIpTweet.name}，自挂链接保留但 tweet 优先）`);
      allUrls.push(gmgnSocials.twitterUrl);
    }
  }

  // 3.9 0-URL 早退（IPFS 解包与 GMGN 补源之后的最终判定：三者都拿不到任何 URL
  // 才判 no_public_info 语义的空数据）；GMGN 风险字段（若有）仍随空数据带出
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
      bestUrls: null,
      gmgnRisk
    };
  }

  // 4. 分类所有URL
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
  const fetchData = await fetchDataSequentially(classifiedUrls, tokenData, extractedInfo, timing);

  return {
    ...fetchData,
    url_extraction_result,
    gmgnRisk
  };
}

/**
 * 顺序获取各平台数据
 * @param {Object} classifiedUrls - 分类后的所有URL
 * @param {Object} tokenData - 代币数据
 * @param {Object} extractedInfo - 提取的结构化信息
 * @param {Object} [timing] - 分段计时器（N1 探针；各平台段名 fetch.<platform>，
 *   recordDataFetch 内统一包裹——微博段非 recordDataFetch 形状，手动 wrap）
 * @returns {Promise<Object>} 获取到的所有数据
 */
export async function fetchDataSequentially(classifiedUrls, tokenData, extractedInfo, timing) {
  timing = timing || createSegmentTimer(null);
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
  const runTwitter = async () => {
  const twitterUrlInfo = selectTwitterUrl();
  if (twitterUrlInfo) {
    const twitterFetch = await recordDataFetch(
      async () => {
        let info;

        // 2d（2026-10-13 叙事提速第二批）：第二个推文 URL 只读 classifiedUrls
        // （同步可判）——与主推获取并发发起，挂载保持在 enrich 后（原顺序语义）；
        // 双推文票省主推链 0.5-5.5s（原串行等主推+enrich 完才发第二推）
        let secondTweetUrl = null;
        if (classifiedUrls.twitter && classifiedUrls.twitter.length > 1) {
          const mainUrl = twitterUrlInfo.url;
          // 第一个是主推文，查找第二个不同的推文
          const secondTweetInfo = classifiedUrls.twitter.find(t => t.url !== mainUrl && t.type === 'tweet');
          // 如果没有第二个推文，查找第二个账号（作为补充）
          const secondInfo = secondTweetInfo || classifiedUrls.twitter.find(t => t.url !== mainUrl);
          if (secondInfo) {
            secondTweetUrl = secondInfo.url;
          }
        }
        const secondTweetPromise = secondTweetUrl
          ? (async () => {
              console.log('[NarrativeAnalyzer] 检测到第二个推文链接，获取中...');
              try {
                return await TwitterFetcher.fetchFromUrls(secondTweetUrl, null);
              } catch (error) {
                console.warn('[NarrativeAnalyzer] 获取第二个推文失败:', error.message);
                return null;
              }
            })()
          : null;

        // 特殊处理：Twitter Community 链接
        if (twitterUrlInfo.type === 'community') {
          console.log('[NarrativeAnalyzer] 检测到Twitter Community链接，获取社区信息');
          try {
            // 从URL中提取community ID
            const communityIdMatch = twitterUrlInfo.url.match(/\/communities\/(\d+)/);
            if (communityIdMatch) {
              const communityId = communityIdMatch[1];
              const communityCacheKey = `https://x.com/i/communities/${communityId}`;
              info = await CachedFetcher.fetchWithCache(
                communityCacheKey, 'twitter_community',
                async () => {
                  // C48 修复（2026-10-01 CREPE 案）：此处原写 '../../utils/…'——从 services/
                  // 出发解析到不存在的 src/narrative/utils/twitter-validation/，社区链路
                  // 从未通过（与同文件 432 行回退分支的正确层级对齐）
                  const { fetchCommunityById } = await import('../../../utils/twitter-validation/communities-api.js');
                  return fetchCommunityById(communityId);
                },
                getCacheTTL('twitter_community')
              );

              if (info) {
                // 将社区信息转换为twitter_info兼容格式
                info = {
                  id: info.id,
                  type: 'community',
                  name: info.name,
                  description: info.description,
                  members_count: info.members_count,
                  moderators_count: info.moderators_count,
                  rules: info.rules,
                  avatar_image_url: info.avatar_image_url,
                  banner_image_url: info.banner_image_url,
                  created_at: info.created_at,
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

        // （非中英文推文翻译已删除——Jev 迁移裁定：原文直接进 state）

        // 消费第二个推文（2d：已在主推发起时刻并发拉取，此处仅 await 挂载）
        if (secondTweetPromise) {
          const websiteTweet = await secondTweetPromise;
          if (websiteTweet && websiteTweet.type === 'tweet' && websiteTweet.text) {
            info.website_tweet = websiteTweet;
            console.log('[NarrativeAnalyzer] 成功获取第二个推文');
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
                const communityCacheKey = `https://x.com/i/communities/${communityId}`;
                const communityData = await CachedFetcher.fetchWithCache(
                  communityCacheKey, 'twitter_community',
                  async () => {
                    const { fetchCommunityById } = await import('../../../utils/twitter-validation/communities-api.js');
                    return fetchCommunityById(communityId);
                  },
                  getCacheTTL('twitter_community')
                );
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
      twitterUrlInfo.url, timing
    );
    results.twitterInfo = twitterFetch.data;
    dataFetchResults.twitter = twitterFetch.record;
    if (!twitterFetch.record.success) {
      results.fetchErrors.twitterError = twitterFetch.record.error;
    }
  }
  };

  // === 2. 微博数据（作为背景信息）===
  const runWeibo = async () => {
  if (classifiedUrls.weibo.length > 0) {
    const weiboUrlInfo = classifiedUrls.weibo[0];
    console.log(`[NarrativeAnalyzer] 获取微博数据作为背景信息: ${weiboUrlInfo.url}`);
    try {
      await timing.wrap('fetch.weibo', async () => {
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
      });
    } catch (error) {
      console.warn('[NarrativeAnalyzer] 微博数据获取失败:', error.message);
    }
  }
  };

  // === 3. GitHub数据 ===
  const runGithub = async () => {
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
      githubUrlInfo.url, timing
    );
    results.githubInfo = githubFetch.data;
    dataFetchResults.github = githubFetch.record;
  }
  };

  // === 4. YouTube数据 ===
  const runYoutube = async () => {
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
      youtubeUrlInfo.url, timing
    );
    results.youtubeInfo = youtubeFetch.data;
    dataFetchResults.youtube = youtubeFetch.record;
    if (!youtubeFetch.record.success) {
      results.fetchErrors.videoErrors.youtube = youtubeFetch.record.error;
    }
  }
  };

  // === 5. 抖音数据 ===
  const runDouyin = async () => {
  const douyinUrlInfo = selectFirstUrl('douyin');
  // J1.68（彪弟案，用户裁定「抖音账号页只是一个信息引用，推文本身的信息够了，
  // 无需获取其信息」）：推文语料有内容时，抖音账号页(user_profile)仅作引用跳过；
  // 视频仍抓（视频内容可能是事件本体）。
  if (douyinUrlInfo && douyinUrlInfo.type === 'user_profile'
      && results.twitterInfo?.type === 'tweet' && results.twitterInfo?.text?.trim()) {
    console.log('[NarrativeAnalyzer] 抖音账号页仅为推文引用（推文语料已足够），跳过抓取');
    dataFetchResults.douyin = { skipped: true, reason: 'tweet_corpus_reference', url: douyinUrlInfo.url };
    return;
  }
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
      douyinUrlInfo.url, timing
    );
    results.douyinInfo = douyinFetch.data;
    dataFetchResults.douyin = douyinFetch.record;
    if (!douyinFetch.record.success) {
      results.fetchErrors.videoErrors.douyin = douyinFetch.record.error;
    }
  }
  };

  // === 6. TikTok数据 ===
  const runTiktok = async () => {
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
      tiktokUrlInfo.url, timing
    );
    results.tiktokInfo = tiktokFetch.data;
    dataFetchResults.tiktok = tiktokFetch.record;
    if (!tiktokFetch.record.success) {
      results.fetchErrors.videoErrors.tiktok = tiktokFetch.record.error;
    }
  }
  };

  // === 7. Bilibili数据 ===
  const runBilibili = async () => {
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
      bilibiliUrlInfo.url, timing
    );
    results.bilibiliInfo = bilibiliFetch.data;
    dataFetchResults.bilibili = bilibiliFetch.record;
    if (!bilibiliFetch.record.success) {
      results.fetchErrors.videoErrors.bilibili = bilibiliFetch.record.error;
    }
  }
  };

  // === 8. 币安广场数据 ===
  const runBinanceSquare = async () => {
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
      binanceSquareUrlInfo.url, timing
    );
    results.binanceSquareInfo = bsFetch.data;
    dataFetchResults.binanceSquare = bsFetch.record;
  }
  };

  // === 9. 微信文章数据 ===
  const runWeixin = async () => {
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
      weixinUrlInfo.url, timing
    );
    results.weixinInfo = weixinFetch.data;
    dataFetchResults.weixin = weixinFetch.record;
    if (!weixinFetch.record.success) {
      results.fetchErrors.videoErrors.weixin = weixinFetch.record.error;
    }
  }
  };

  // === 9. Amazon数据 ===
  const runAmazon = async () => {
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
      amazonUrlInfo.url, timing
    );
    results.amazonInfo = amazonFetch.data;
    dataFetchResults.amazon = amazonFetch.record;
    if (!amazonFetch.record.success) {
      results.fetchErrors.videoErrors.amazon = amazonFetch.record.error;
    }
  }
  };

  // === 10. 小红书数据 ===
  const runXiaohongshu = async () => {
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
      xiaohongshuUrlInfo.url, timing
    );
    results.xiaohongshuInfo = xiaohongshuFetch.data;
    dataFetchResults.xiaohongshu = xiaohongshuFetch.record;
    if (!xiaohongshuFetch.record.success) {
      results.fetchErrors.videoErrors.xiaohongshu = xiaohongshuFetch.record.error;
    }
  }
  };

  // === 10.5. Instagram 数据 ===
  const runInstagram = async () => {
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
      instagramUrlInfo.url, timing
    );
    results.instagramInfo = instagramFetch.data;
    dataFetchResults.instagram = instagramFetch.record;
    if (!instagramFetch.record.success) {
      results.fetchErrors.videoErrors.instagram = instagramFetch.record.error;
    }
  }
  };

  // === 11. 普通网站数据 ===
  // websites 桶可抓 URL 选取（enabled 桶内路径与 C115 兜底段共用；判定逐字保留
  // 原内联——排除已由专门桶/专门 fetcher 承接的视频平台、GitHub、Amazon、币安
  // 广场与 isFetchableUrl 不可抓形状）
  const pickWebsiteCorpusUrl = () => {
    const websiteUrlInfo = selectFirstUrl('websites');
    if (!websiteUrlInfo) return null;
    const websiteUrl = websiteUrlInfo.url;
    const isVideoPlatform = /youtube|youtu\.be|tiktok|douyin|bilibili|b23\.tv/i.test(websiteUrl);
    const isGithub = /github\.com/i.test(websiteUrl);
    const isAmazon = /amazon\.com/i.test(websiteUrl);
    const isBinanceSquare = /binance\.com\/.*\/square\//i.test(websiteUrl);
    if (!isVideoPlatform && !isGithub && !isAmazon && !isBinanceSquare && isFetchableUrl(websiteUrl)) {
      return websiteUrlInfo;
    }
    return null;
  };

  // 网站语料抓取单点（results/dataFetchResults/fetchErrors 写点，两路径同款；
  // 返回实际抓取的 URL，无可抓 URL 返回 null）
  const fetchWebsiteCorpusOnce = async () => {
    const websiteUrlInfo = pickWebsiteCorpusUrl();
    if (!websiteUrlInfo) return null;
    const websiteUrl = websiteUrlInfo.url;
    const websiteFetch = await recordDataFetch(
      () => fetchWebsiteContent(websiteUrl, { maxLength: 5000 }),
      'website',
      websiteUrl, timing
    );
    results.websiteInfo = websiteFetch.data;
    dataFetchResults.website = websiteFetch.record;
    if (!websiteFetch.record.success) {
      results.fetchErrors.websiteError = websiteFetch.record.error;
    }
    return websiteUrl;
  };

  const runWebsite = async () => {
  // website 内容抓取总开关（2026-10-13 叙事提速第二批，用户裁定「网站内容现在基本
  // 上没用到，网站的信息下载可以去除」）：narrative-engine.json websiteFetch.enabled
  // 缺省/false → 桶内整段跳过——websiteInfo 自然缺省（= 与「网站抓取失败」同形状，
  // 消费点零改动）。注意 hasIndependentWebsite / URL 分类只看 classifiedUrls.websites
  // 的 URL 域名不看内容 → shouldCollectAccounts 门不受影响；回滚 = 配置改 true
  // 重启。C115（2026-10-19 CZ4 案）修正：开关关不再等于「永不抓」——全平台语料
  // 落空而 websites 桶提供了 URL 时，由 allSettled 后的兜底段补抓（见下）
  if ((getConfig().websiteFetch || {}).enabled !== true) return;
  await fetchWebsiteCorpusOnce();
  };

  // ── N2 平台桶并发（2026-10-13 叙事提速案）──
  // 13 平台按真实上游域分四桶，桶间并发、桶内保持原串行顺序（同上游防限流）；
  // 各段代码体与输出键逐字不变（只改等待顺序，抓取内容 bit 一致）：
  //   apidance：twitter（含社区/第二推文/enrich）
  //   justoneapi：weibo→youtube→douyin→tiktok→bilibili→binanceSquare→weixin→
  //              amazon→xiaohongshu→instagram（桶内序 = 原全局序）
  //   github：api.github.com 独立域
  //   websites：目标网站各异（互不同域天然并发）
  // allSettled：单桶异常不拖死其它桶（各段自带 recordDataFetch 吞错，与串行版
  // 「单平台失败继续下一段」的鲁棒性对齐）
  // C79：twitterPromise 提取（runTwitter 仍第一个发起，调用顺序 bit 一致；hoist
  // 与 allSettled 之间无 await = 同 tick 挂 handler，无 unhandled rejection 窗口）
  // ——语料充分门判「现有语料够不够」需 twitter 主语料。
  // ── C79 语料充分门（2026-10-16 用户裁定，照 C72 vision gate 模式泛化）──
  // twitter 主语料等齐后判一次「其余待抓平台语料还需要吗」：sufficient 则
  // justoneapi 串行桶 + github 桶全部待抓段整段跳过（results.<x>Info 保持
  // null = 无该平台 URL / 抓取失败同形状，下游零改动；dataFetchResults 落
  // additive skipped='corpus_gate' 标记）。门关 / 无待抓平台 / twitter 失败
  // → 立即 resolve {skipped:false}，两桶照原样并发（N2 形状 bit 一致）。
  // twitterInfo 资格判定与 partial state 的 {...results} 展开都必须在 await
  // twitterPromise 之后——runTwitter 完成时才原地写 results.twitterInfo，
  // 提前判定/展开会拿到 null 永不更新。
  const twitterPromise = runTwitter();
  const pendingSources = pendingCorpusPlatforms(classifiedUrls);
  const corpusGatePromise = (async () => {
    if (!isCorpusGateOn() || pendingSources.length === 0) return { skipped: false };
    await twitterPromise.catch(() => {});
    if (!shouldAskCorpusGate(results.twitterInfo, pendingSources)) return { skipped: false };
    const run = () => runCorpusGate(tokenData, { ...results, extractedInfo }, { pending: pendingSources });
    return timing ? timing.wrap('fetch.corpusGate', run) : run();
  })();
  await Promise.allSettled([
    twitterPromise,
    (async () => {
      const gate = await corpusGatePromise;
      if (gate.skipped) {
        const ts = new Date().toISOString();
        for (const p of pendingSources) {
          dataFetchResults[p.platform] = { success: true, url: p.url,
            started_at: ts, finished_at: ts, error: null, skipped: 'corpus_gate' };
        }
        return;
      }
      await runWeibo();
      await runYoutube();
      await runDouyin();
      await runTiktok();
      await runBilibili();
      await runBinanceSquare();
      await runWeixin();
      await runAmazon();
      await runXiaohongshu();
      await runInstagram();
    })(),
    (async () => {
      const gate = await corpusGatePromise;
      if (gate.skipped) return;
      await runGithub();
    })(),
    runWebsite(),
  ]);

  // ── C115 纯 website 兜底语料（2026-10-19 CZ4 案 0xc6fe…7777，用户裁定「如果
  // 所有的信息都不能获取，又提供了网站信息，就去获取一下 web 网站信息」）──
  // websiteFetch.enabled 默认关（2026-10-13 提速裁定）的语义只省「有其它语料在
  // 手」的票：全平台语料落空（以下 12 个 <x>Info 全 null——平台无 URL 与抓取
  // 失败同形状；extractedInfo.description/intro 是宣告文案不算抓取语料，不参与
  // 判定）而 websites 桶提供了可抓 URL 时，网站内容是该票唯一可得的语料源，
  // 补抓一次（fetchWebsiteContent 直抓 + r.jina.ai 回退整链照常）。enabled=true
  // 时桶内已抓过本段不重跑；有任一平台语料在手不触发（提速裁定的临界路径收益
  // 保留）。dataFetchResults.website 落 additive 审计标记 corpusFallback=true
  // （与 enabled 路径可区分）；抓取失败 fail-closed null——与「网站抓取失败」
  // 旧形状一致，state/precheck/Jev 消费点零改动。
  if ((getConfig().websiteFetch || {}).enabled !== true
    && CORPUS_FALLBACK_INFO_KEYS.every(k => results[k] == null)) {
    const fallbackUrl = await fetchWebsiteCorpusOnce();
    if (fallbackUrl) {
      if (dataFetchResults.website) dataFetchResults.website.corpusFallback = true;
      console.log(`[NarrativeAnalyzer] C115 全平台语料落空，网站兜底抓取: ${fallbackUrl} → ${results.websiteInfo ? `成功 ${results.websiteInfo.content?.length ?? '?'} 字` : '失败'}`);
    }
  }

  return { ...results, classifiedUrls, dataFetchResults };
}

/**
 * 记录数据获取的元数据
 * @param {Function} fetcherFn - 数据获取函数
 * @param {string} platform - 平台名称
 * @param {string} url - 请求的URL
 * @param {Object} [timing] - 分段计时器（N1 探针）：段名 fetch.<platform>，
 *   成功/失败两路径都落（失败段耗时同样是探针数据）
 * @returns {Promise<Object>} { data, record } - data是获取的数据，record是元数据
 */
export async function recordDataFetch(fetcherFn, platform, url, timing) {
  if (!url) {
    return { data: null, record: null };
  }

  const startedAt = new Date().toISOString();
  if (timing) timing.start(`fetch.${platform}`);
  let data, error;

  try {
    data = await fetcherFn();
    if (timing) timing.end(`fetch.${platform}`);
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
    if (timing) timing.end(`fetch.${platform}`);
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
