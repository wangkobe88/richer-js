/**
 * GitHub Section - GitHub仓库信息
 */

/**
 * 构建GitHub仓库section
 * @param {Object} githubInfo - GitHub信息
 * @returns {string} GitHub section或空字符串
 */
export function buildGithubSection(githubInfo) {
  if (!githubInfo) {
    return '';
  }

  const parts = [];

  parts.push(`【GitHub】${githubInfo.full_name || '未知'}`);
  parts.push(`Star数: ${githubInfo.stargazers_count || 0}`);

  if (githubInfo.description) {
    parts.push(`描述: ${githubInfo.description}`);
  }

  if (githubInfo.influence_level) {
    parts.push(`影响力: ${githubInfo.influence_description}`);
  }

  return parts.join('\n');
}
