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
  // 账号完整数据两层缓存（2026-10-02 d46b1b6c 叙事耗时案 + 同日用户三点方案再升级）：
  // userInfo handle 级跨 token 复用（同作者连环发币不重复拉，月级稳定同 twitter_account 档）；
  // 推文 userId 级全量 key（翻满窗口的完整列表 + oldestSec 覆盖深度，复用时按请求窗口
  // 截断——离散窗口 key (userId, untilSec) 同作者不同 token 锚不同永不命中，B2 实测
  // 651 真拉/259 唯一作者）+ CA 早停专属 key (:ca:<addr>，本 token 截断列表跨调用点共享）。
  // 6h 刷新：时间线头部随新推文增长（同作者 6h 内新发 CA 宣告推的漏验由
  // PrecheckFailRetryService no_public_info 重试窗兜底）
  twitter_user_info:   { maxAge:  30 * DAY, ttl: 365 * DAY },
  twitter_user_tweets: { maxAge: 6 * 3600, ttl:  90 * DAY },

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

  // four.meme 链上 metadata（IPFS 内容不可变，同 tweet 档长期缓存）
  ipfs_metadata:      { maxAge: 365 * DAY, ttl: 730 * DAY },

  // GMGN token info 社媒补源（BRF 案）：link 内容稳定但可变，1 天刷新
  gmgn_token_info:    { maxAge:   1 * DAY, ttl:  90 * DAY },
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
