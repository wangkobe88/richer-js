/**
 * GitHub 仓库信息获取工具
 * 用于评估 GitHub 项目的知名度
 */

/**
 * GitHub 仓库信息提取器
 */
export class GithubFetcher {

  /**
   * 从 GitHub URL 中提取仓库所有者和名称
   * @param {string} url - GitHub URL
   * @returns {Object|null} {owner, repo} 或 null
   */
  static extractRepoInfo(url) {
    if (!url) return null;

    // 匹配 github.com/owner/repo 格式
    const patterns = [
      /github\.com\/([^\/]+)\/([^\/]+)/,
      /github\.com\/([^\/]+)\/([^\/]+)\//
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          owner: match[1],
          repo: match[2].replace(/\.git$/, '')
        };
      }
    }

    return null;
  }

  /**
   * 判断是否是有效的 GitHub URL
   * @param {string} url - URL
   * @returns {boolean}
   */
  static isValidGithubUrl(url) {
    if (!url) return false;
    return /github\.com\/[^\/]+\/[^\/]+/.test(url);
  }

  /**
   * 获取 GitHub 仓库信息
   * 使用 GitHub API 获取 star、fork 等数据
   * @param {string} url - GitHub URL
   * @returns {Promise<Object|null>} 仓库信息
   */
  static async fetchRepoInfo(url) {
    if (!url) {
      return null;
    }

    const repoInfo = this.extractRepoInfo(url);
    if (!repoInfo) {
      console.warn('[GithubFetcher] 无法提取仓库信息:', url);
      return null;
    }

    console.log(`[GithubFetcher] 获取仓库信息: ${repoInfo.owner}/${repoInfo.repo}`);

    try {
      // 使用 GitHub API 获取仓库信息（无需认证的公开请求）
      const apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;

      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Mozilla/5.0'
        }
      });

      if (!response.ok) {
        // API 限制，尝试从网页解析
        console.warn('[GithubFetcher] API 请求失败，尝试网页解析');
        return await this._parseFromWebPage(url);
      }

      const data = await response.json();

      const result = {
        name: data.name,
        full_name: data.full_name,
        description: data.description,
        url: data.html_url,
        homepage: data.homepage,
        language: data.language,
        stargazers_count: data.stargazers_count,
        forks_count: data.forks_count,
        subscribers_count: data.subscribers_count,
        open_issues_count: data.open_issues_count,
        created_at: data.created_at,
        updated_at: data.updated_at,
        pushed_at: data.pushed_at,
        size: data.size,
        is_fork: data.fork,
        has_issues: data.has_issues,
        topics: data.topics || [],
        license: data.license?.name || null
      };

      // 计算影响力等级
      result.influence_level = this.getInfluenceLevel(result);
      result.influence_description = this.getInfluenceDescription(result.influence_level);

      console.log(`[GithubFetcher] 成功获取: ${result.stargazers_count} stars, ${result.forks_count} forks (${result.influence_level})`);
      return result;

    } catch (error) {
      console.error('[GithubFetcher] API 请求失败:', error.message);
      // 备用方案：尝试从网页解析
      return await this._parseFromWebPage(url);
    }
  }

  /**
   * 从网页解析 GitHub 仓库信息（备用方案）
   * @param {string} url - GitHub URL
   * @returns {Promise<Object|null>} 仓库信息
   */
  static async _parseFromWebPage(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      if (!response.ok) {
        return null;
      }

      const html = await response.text();

      // 尝试从 HTML 中解析 star 数
      const starMatch = html.match(/data-view-component="true" aria-label="([\\d,]+) users starred this repository"/);
      const starCount = starMatch ? parseInt(starMatch[1].replace(/,/g, '')) : null;

      const forkMatch = html.match(/data-view-component="true" aria-label="([\\d,]+) users forked this repository"/);
      const forkCount = forkMatch ? parseInt(forkMatch[1].replace(/,/g, '')) : null;

      // 尝试提取描述
      const descMatch = html.match(/<meta name="description" content="([^"]+)"/);
      const description = descMatch ? descMatch[1] : null;

      const repoInfo = this.extractRepoInfo(url);

      const result = {
        name: repoInfo?.repo,
        full_name: `${repoInfo?.owner}/${repoInfo?.repo}`,
        description: description,
        url: url,
        stargazers_count: starCount,
        forks_count: forkCount,
        parsed_from_web: true
      };

      // 计算影响力等级
      result.influence_level = this.getInfluenceLevel(result);
      result.influence_description = this.getInfluenceDescription(result.influence_level);

      console.log(`[GithubFetcher] 网页解析成功: ${starCount || '未知'} stars (${result.influence_level})`);
      return result;

    } catch (error) {
      console.error('[GithubFetcher] 网页解析失败:', error.message);
      return null;
    }
  }

  /**
   * 评估 GitHub 项目影响力等级
   * @param {Object} repoInfo - 仓库信息
   * @returns {string} 影响力等级
   */
  static getInfluenceLevel(repoInfo) {
    if (!repoInfo) {
      return 'unknown';
    }

    const stars = repoInfo.stargazers_count || 0;

    if (stars >= 10000) return 'world_class';      // 世界级
    if (stars >= 1000) return 'platform_level';   // 平台级
    if (stars >= 100) return 'community_level';   // 社区级
    if (stars >= 10) return 'niche_level';        // 小众级
    return 'unknown';                             // 无影响力
  }

  /**
   * 获取影响力等级说明
   * @param {string} level - 影响力等级
   * @returns {string} 说明
   */
  static getInfluenceDescription(level) {
    const descriptions = {
      'world_class': '世界级影响力（10k+ stars）',
      'platform_level': '平台级影响力（1k+ stars）',
      'community_level': '社区级影响力（100+ stars）',
      'niche_level': '小众级影响力（10+ stars）',
      'unknown': '无明确影响力（<10 stars）'
    };
    return descriptions[level] || '未知';
  }

  /**
   * 判断是否是官方代币
   * 简单判断：如果仓库名与代币相关度高，且是原始仓库（非fork）
   * @param {Object} repoInfo - 仓库信息
   * @param {string} tokenSymbol - 代币符号
   * @returns {boolean}
   */
  static isOfficialToken(repoInfo, tokenSymbol) {
    if (!repoInfo || !tokenSymbol) {
      return false;
    }

    // 如果是 fork，通常不是官方的
    if (repoInfo.is_fork) {
      return false;
    }

    // 简单判断：仓库名包含代币符号
    const repoName = repoInfo.name?.toLowerCase() || '';
    const symbol = tokenSymbol.toLowerCase().replace(/[^a-z0-9]/g, '');

    return repoName.includes(symbol);
  }
}
