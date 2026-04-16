/**
 * 外部资源缓存 TTL 配置
 *
 * maxAge: 读取有效期（秒），超过此时间视为缓存过期，会重新获取
 * ttl:   写入过期时间（秒），缓存条目在DB中的保留时间
 */

const DAY = 86400; // 秒

const CACHE_TTL_CONFIG = {
  // Twitter
  tweet:              { maxAge: 365 * DAY, ttl: 730 * DAY },
  twitter_account:    { maxAge:  30 * DAY, ttl: 365 * DAY },
  twitter_community:  { maxAge:  30 * DAY, ttl: 365 * DAY },

  // 微博
  weibo:              { maxAge:  90 * DAY, ttl: 365 * DAY },
  weibo_user:         { maxAge:  30 * DAY, ttl: 365 * DAY },

  // 网站
  website:            { maxAge:   7 * DAY, ttl:  90 * DAY },

  // GitHub
  github:             { maxAge:  30 * DAY, ttl: 365 * DAY },

  // YouTube
  youtube:            { maxAge:  90 * DAY, ttl: 365 * DAY },
  youtube_channel:    { maxAge:  30 * DAY, ttl: 365 * DAY },

  // 抖音
  douyin:             { maxAge:  90 * DAY, ttl: 365 * DAY },
  douyin_user:        { maxAge:  30 * DAY, ttl: 365 * DAY },

  // TikTok
  tiktok:             { maxAge:  90 * DAY, ttl: 365 * DAY },
  tiktok_user:        { maxAge:  30 * DAY, ttl: 365 * DAY },

  // B站
  bilibili:           { maxAge:  90 * DAY, ttl: 365 * DAY },

  // 微信
  weixin:             { maxAge: 365 * DAY, ttl: 730 * DAY },

  // Amazon
  amazon:             { maxAge:   7 * DAY, ttl:  90 * DAY },

  // 小红书
  xiaohongshu:        { maxAge:  90 * DAY, ttl: 365 * DAY },
  xiaohongshu_user:   { maxAge:  30 * DAY, ttl: 365 * DAY },

  // Instagram
  instagram:          { maxAge:  90 * DAY, ttl: 365 * DAY },
  instagram_user:     { maxAge:  30 * DAY, ttl: 365 * DAY },

  // 币安广场
  binance_square:     { maxAge:  90 * DAY, ttl: 365 * DAY },
};

const DEFAULT_TTL = { maxAge: 30 * DAY, ttl: 365 * DAY };

/**
 * 获取指定资源类型的缓存TTL配置
 * @param {string} resourceType - 资源类型
 * @returns {{ maxAge: number, ttl: number }}
 */
export function getCacheTTL(resourceType) {
  return CACHE_TTL_CONFIG[resourceType] || DEFAULT_TTL;
}
