/**
 * 推特用户黑名单配置
 *
 * 如果推文发布者在黑名单中，直接判定为 low 质量，跳过 LLM 分析
 *
 * 黑名单添加格式：
 * - screenName: 推特用户名（不带@）
 * - reason: 加入黑名单的原因
 * - addedAt: 添加日期
 */

export const TWITTER_USER_BLACKLIST = [
  {
    screenName: 'Cortaviousloma1',
    reason: '发布低质量/垃圾内容',
    addedAt: '2026-03-18'
  },
  {
    screenName: 'heyi1f',
    reason: '发布低质量/垃圾内容',
    addedAt: '2026-03-19'
  },
  {
    screenName: 'can4feelmyworld',
    reason: '发布低质量/垃圾内容',
    addedAt: '2026-03-19'
  }
];

/**
 * 检查推特用户是否在黑名单中
 * @param {string} screenName - 推特用户名（不带@）
 * @returns {object|null} - 如果在黑名单中返回黑名单条目，否则返回null
 */
export function checkBlacklist(screenName) {
  if (!screenName) return null;

  const normalized = screenName.replace(/^@/, '').toLowerCase();

  for (const entry of TWITTER_USER_BLACKLIST) {
    if (entry.screenName.toLowerCase() === normalized) {
      return entry;
    }
  }

  return null;
}
