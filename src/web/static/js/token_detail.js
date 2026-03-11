/**
 * 代币详情页面
 */

class TokenDetailPage {
  constructor() {
    this.experimentId = null;
    this.tokenAddress = null;
    this.tokenData = null;
    this.experimentData = null;

    this.init();
  }

  async init() {
    // 从URL参数获取experimentId和tokenAddress
    const urlParams = new URLSearchParams(window.location.search);
    this.experimentId = urlParams.get('experiment');
    this.tokenAddress = urlParams.get('address');

    if (!this.experimentId || !this.tokenAddress) {
      this.showError('缺少必要参数：experiment 和 address');
      return;
    }

    // 绑定事件
    this.bindEvents();

    // 加载数据
    await this.loadData();
  }

  bindEvents() {
    // 标签页切换
    document.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        this.switchTab(tabName);
      });
    });

    // 提取描述推文
    document.getElementById('btn-extract-description').addEventListener('click', () => {
      this.extractDescriptionTweets();
    });

    // 搜索代币地址
    document.getElementById('btn-search-address').addEventListener('click', () => {
      this.searchTokenAddress();
    });
  }

  switchTab(tabName) {
    // 更新按钮状态
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.tab === tabName) {
        btn.classList.add('active');
      }
    });

    // 更新内容显示
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    const targetContent = document.getElementById(`tab-${tabName}`);
    if (targetContent) {
      targetContent.classList.add('active');
    }

    // 加载标签页数据
    if (tabName === 'trades') {
      this.loadTrades();
    } else if (tabName === 'signals') {
      this.loadSignals();
    }
  }

  async loadData() {
    try {
      // 并行加载实验和代币数据
      const [experimentResponse, tokenResponse] = await Promise.all([
        fetch(`/api/experiment/${this.experimentId}`),
        fetch(`/api/experiment/${this.experimentId}/tokens/${this.tokenAddress}`)
      ]);

      const [experimentResult, tokenResult] = await Promise.all([
        experimentResponse.json(),
        tokenResponse.json()
      ]);

      if (!experimentResult.success || !tokenResult.success) {
        throw new Error('数据加载失败');
      }

      this.experimentData = experimentResult.data;
      this.tokenData = tokenResult.data;

      // 渲染页面
      this.render();

    } catch (error) {
      console.error('加载数据失败:', error);
      this.showError(`加载失败: ${error.message}`);
    }
  }

  render() {
    // 隐藏加载指示器
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');

    // 更新导航链接
    document.getElementById('link-experiment').href = `/experiment/${this.experimentId}`;
    document.getElementById('link-back').href = `/experiment/${this.experimentId}/tokens`;

    // 更新代币基本信息
    document.getElementById('token-title').textContent =
      this.tokenData.token_symbol || '代币详情';
    document.getElementById('token-symbol').textContent =
      this.tokenData.token_symbol || this.tokenData.raw_api_data?.symbol || '-';
    document.getElementById('token-address').textContent =
      this.tokenData.token_address || '-';
    document.getElementById('token-chain').textContent =
      (this.experimentData?.blockchain || 'bsc').toUpperCase();
    document.getElementById('token-status').textContent =
      this.getStatusText(this.tokenData.status);
    document.getElementById('token-discovered-at').textContent =
      this.formatDateTime(this.tokenData.discovered_at);

    // 更新代币描述（从多个字段获取）
    const rawData = this.tokenData.raw_api_data || {};
    let description = rawData.description || rawData.intro_cn || rawData.intro_en || '-';

    // 如果有appendix，显示twitter信息
    if (rawData.appendix) {
      try {
        const appendix = typeof rawData.appendix === 'string' ? JSON.parse(rawData.appendix) : rawData.appendix;
        if (appendix.twitter) {
          description += `\n\nTwitter: ${appendix.twitter}`;
        }
      } catch (e) {
        // ignore
      }
    }

    // 如果fourmeme_creator_info有twitterUrl
    if (rawData.fourmeme_creator_info?.full_info?.raw?.twitterUrl) {
      if (!description.includes('Twitter:')) {
        description += `\n\nTwitter: ${rawData.fourmeme_creator_info.full_info.raw.twitterUrl}`;
      }
    }

    document.getElementById('token-description').textContent =
      description.length > 300 ? description.substring(0, 300) + '...' : description;

    // 更新外部链接
    this.renderExternalLinks();

    // 更新原始API数据
    this.renderRawApiData();

    // 更新持有者和早期交易链接
    const chain = this.experimentData?.blockchain || 'bsc';
    document.getElementById('link-holders').href =
      `/token-holders?experiment=${this.experimentId}&token=${this.tokenAddress}`;
    document.getElementById('link-early-trades').href =
      `/token-early-trades?token=${this.tokenAddress}&chain=${chain}`;
  }

  renderExternalLinks() {
    const container = document.getElementById('external-links');
    const chain = this.experimentData?.blockchain || 'bsc';
    const address = this.tokenData.token_address;

    const links = [];

    // GMGN
    if (chain === 'bsc' || chain === 'eth') {
      links.push({
        name: 'GMGN',
        url: `https://gmgn.ai/${chain}/token/${address}`,
        color: 'bg-purple-600'
      });
    }

    // 浏览器链接
    if (chain === 'bsc') {
      links.push({
        name: 'BSCScan',
        url: `https://bscscan.com/address/${address}`,
        color: 'bg-yellow-600'
      });
    } else if (chain === 'eth') {
      links.push({
        name: 'Etherscan',
        url: `https://etherscan.io/address/${address}`,
        color: 'bg-blue-600'
      });
    } else if (chain === 'solana') {
      links.push({
        name: 'Solscan',
        url: `https://solscan.io/account/${address}`,
        color: 'bg-green-600'
      });
    }

    // four.meme
    if (this.tokenData.raw_api_data?.platform === 'fourmeme') {
      links.push({
        name: 'four.meme',
        url: `https://four.meme/en/token/${address}`,
        color: 'bg-pink-600'
      });
    }

    container.innerHTML = links.map(link =>
      `<a href="${link.url}" target="_blank" class="px-3 py-2 ${link.color} hover:opacity-80 rounded-md text-sm font-medium text-white">
        ${link.name} ↗
      </a>`
    ).join('');
  }

  renderRawApiData() {
    const rawData = this.tokenData.raw_api_data;
    const jsonStr = JSON.stringify(rawData, null, 2);
    document.getElementById('raw-api-data').textContent = jsonStr || '-';
  }

  async extractDescriptionTweets() {
    const container = document.getElementById('description-tweets-container');
    container.innerHTML = '<p class="text-sm text-blue-400">正在提取...</p>';

    try {
      const rawData = this.tokenData.raw_api_data || {};
      let twitterUrls = [];

      // 1. 从 appendix 字段提取（JSON字符串）
      if (rawData.appendix) {
        try {
          const appendix = typeof rawData.appendix === 'string' ? JSON.parse(rawData.appendix) : rawData.appendix;
          if (appendix.twitter) {
            twitterUrls.push(appendix.twitter);
          }
        } catch (e) {
          console.warn('解析 appendix 失败:', e);
        }
      }

      // 2. 从 fourmeme_creator_info.full_info.raw.twitterUrl 提取
      if (rawData.fourmeme_creator_info?.full_info?.raw?.twitterUrl) {
        const url = rawData.fourmeme_creator_info.full_info.raw.twitterUrl;
        if (!twitterUrls.includes(url)) {
          twitterUrls.push(url);
        }
      }

      // 3. 从 description 字段提取（备用）
      if (rawData.description) {
        // 从描述中提取推文链接
        const urlMatches = rawData.description.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]{1,15}\/status\/([0-9]+)/gi);
        if (urlMatches) {
          urlMatches.forEach(url => {
            if (!twitterUrls.includes(url)) {
              twitterUrls.push(url);
            }
          });
        }
      }

      if (twitterUrls.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500">未找到推特链接</p>';
        return;
      }

      // 提取推文ID并获取详情
      const tweetIds = [];
      for (const url of twitterUrls) {
        // 从URL中提取推文ID
        const idMatch = url.match(/status\/([0-9]+)/);
        if (idMatch) {
          const tweetId = idMatch[1];
          if (!tweetIds.includes(tweetId)) {
            tweetIds.push(tweetId);
          }
        }
      }

      if (tweetIds.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500">无法从链接中提取推文ID</p>';
        return;
      }

      // 获取推文详情
      const tweets = [];
      for (const tweetId of tweetIds) {
        try {
          const response = await fetch(`/api/twitter/tweet/${tweetId}`);
          const result = await response.json();

          if (result.success && result.data) {
            tweets.push(result.data);
          }
        } catch (e) {
          console.error('获取推文详情失败:', tweetId, e);
        }
      }

      if (tweets.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500">获取推文详情失败</p>';
        return;
      }

      // 渲染推文列表
      container.innerHTML = tweets.map(tweet => `
        <div class="tweet-item">
          <div class="tweet-user">
            <div class="tweet-avatar">
              <span class="text-white font-bold">${(tweet.user?.name || 'U')[0]}</span>
            </div>
            <div>
              <div class="font-medium text-white">${tweet.user?.name || '未知用户'}</div>
              <div class="text-sm text-gray-400">@${tweet.user?.screen_name || 'unknown'}</div>
            </div>
          </div>
          <div class="text-sm text-gray-300 mt-2">${tweet.text || '无内容'}</div>
          <div class="tweet-metrics">
            <span>❤️ ${tweet.favorite_count || 0}</span>
            <span>🔁 ${tweet.retweet_count || 0}</span>
            <span>💬 ${tweet.reply_count || 0}</span>
          </div>
        </div>
      `).join('');

    } catch (error) {
      console.error('提取描述推文失败:', error);
      container.innerHTML = `<p class="text-sm text-red-400">提取失败: ${error.message}</p>`;
    }
  }

  async searchTokenAddress() {
    const container = document.getElementById('address-search-container');
    container.innerHTML = '<p class="text-sm text-blue-400">正在搜索...</p>';

    try {
      const response = await fetch(`/api/twitter/token/${this.tokenAddress}/extract`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '搜索失败');
      }

      const features = result.data.features;

      // 更新特征显示
      document.getElementById('twitter-features-container').classList.remove('hidden');
      document.getElementById('feature-total-results').textContent = features.twitter_total_results || 0;
      document.getElementById('feature-likes').textContent = features.twitter_likes || 0;
      document.getElementById('feature-likes').textContent = this.formatNumber(features.twitter_likes || 0);
      document.getElementById('feature-retweets').textContent = this.formatNumber(features.twitter_retweets || 0);
      document.getElementById('feature-comments').textContent = this.formatNumber(features.twitter_comments || 0);
      document.getElementById('feature-followers').textContent = this.formatNumber(features.twitter_followers || 0);
      document.getElementById('feature-verified').textContent = features.twitter_verified_users || 0;
      document.getElementById('feature-quality').textContent = features.twitter_quality_tweets || 0;

      // 显示搜索结果摘要
      const rawData = JSON.parse(result.data.rawData || '{}');
      container.innerHTML = `
        <div class="text-sm text-gray-300">
          <p>搜索完成：</p>
          <ul class="list-disc list-inside mt-2 space-y-1">
            <li>总结果: ${rawData.total_search_results || 0} 条</li>
            <li>高质量: ${rawData.tweet_count || 0} 条</li>
            <li>总互动: ${rawData.analysis_details?.statistics?.total_engagement || 0}</li>
          </ul>
        </div>
      `;

    } catch (error) {
      console.error('搜索代币地址失败:', error);
      container.innerHTML = `<p class="text-sm text-red-400">搜索失败: ${error.message}</p>`;
    }
  }

  async loadTrades() {
    const container = document.getElementById('trades-container');
    container.innerHTML = '<p class="text-gray-500">加载中...</p>';

    try {
      const response = await fetch(`/api/experiment/${this.experimentId}/trades?tokenAddress=${this.tokenAddress}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '加载失败');
      }

      const trades = result.trades || result.data || [];

      if (trades.length === 0) {
        container.innerHTML = '<p class="text-gray-500">暂无交易记录</p>';
        return;
      }

      container.innerHTML = `
        <table class="w-full text-sm">
          <thead class="bg-gray-700">
            <tr>
              <th class="px-4 py-2 text-left">时间</th>
              <th class="px-4 py-2 text-left">方向</th>
              <th class="px-4 py-2 text-right">数量</th>
              <th class="px-4 py-2 text-right">价格</th>
              <th class="px-4 py-2 text-center">状态</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-700">
            ${trades.map(trade => `
              <tr>
                <td class="px-4 py-2">${this.formatDateTime(trade.created_at)}</td>
                <td class="px-4 py-2">${this.getDirectionBadge(trade.direction)}</td>
                <td class="px-4 py-2 text-right">${trade.output_amount || '-'}</td>
                <td class="px-4 py-2 text-right">${trade.unit_price || '-'}</td>
                <td class="px-4 py-2 text-center">${trade.success ? '✅' : '❌'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    } catch (error) {
      console.error('加载交易记录失败:', error);
      container.innerHTML = `<p class="text-red-400">加载失败: ${error.message}</p>`;
    }
  }

  async loadSignals() {
    const container = document.getElementById('signals-container');
    container.innerHTML = '<p class="text-gray-500">加载中...</p>';

    try {
      const response = await fetch(`/api/experiment/${this.experimentId}/signals?tokenAddress=${this.tokenAddress}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '加载失败');
      }

      const signals = result.signals || result.data || [];

      if (signals.length === 0) {
        container.innerHTML = '<p class="text-gray-500">暂无信号记录</p>';
        return;
      }

      container.innerHTML = `
        <table class="w-full text-sm">
          <thead class="bg-gray-700">
            <tr>
              <th class="px-4 py-2 text-left">时间</th>
              <th class="px-4 py-2 text-left">类型</th>
              <th class="px-4 py-2 text-left">动作</th>
              <th class="px-4 py-2 text-center">状态</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-700">
            ${signals.map(signal => `
              <tr>
                <td class="px-4 py-2">${this.formatDateTime(signal.created_at)}</td>
                <td class="px-4 py-2">${this.getSignalTypeBadge(signal.signal_type)}</td>
                <td class="px-4 py-2">${this.getActionBadge(signal.action)}</td>
                <td class="px-4 py-2 text-center">${this.getExecutionStatusBadge(signal)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    } catch (error) {
      console.error('加载信号记录失败:', error);
      container.innerHTML = `<p class="text-red-400">加载失败: ${error.message}</p>`;
    }
  }

  // 工具方法
  showError(message) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-message').classList.remove('hidden');
    document.getElementById('error-text').textContent = message;
  }

  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getStatusText(status) {
    const statusMap = {
      'monitoring': '监控中',
      'bought': '已买入',
      'exited': '已退出'
    };
    return statusMap[status] || status;
  }

  getDirectionBadge(direction) {
    if (direction === 'buy') {
      return '<span class="px-2 py-1 bg-green-600 text-white rounded text-xs">买入</span>';
    } else if (direction === 'sell') {
      return '<span class="px-2 py-1 bg-red-600 text-white rounded text-xs">卖出</span>';
    }
    return direction;
  }

  getSignalTypeBadge(signalType) {
    if (signalType === 'BUY') {
      return '<span class="px-2 py-1 bg-green-600 text-white rounded text-xs">BUY</span>';
    } else if (signalType === 'SELL') {
      return '<span class="px-2 py-1 bg-red-600 text-white rounded text-xs">SELL</span>';
    }
    return signalType;
  }

  getActionBadge(action) {
    const actionMap = {
      'BUY': '买入信号',
      'SELL': '卖出信号',
      'SKIP': '跳过'
    };
    return actionMap[action] || action;
  }

  getExecutionStatusBadge(signal) {
    const status = signal.metadata?.execution_status;
    if (status === 'executed') {
      return '<span class="px-2 py-1 bg-green-600 text-white rounded text-xs">已执行</span>';
    } else if (status === 'failed') {
      return '<span class="px-2 py-1 bg-red-600 text-white rounded text-xs">失败</span>';
    }
    return '<span class="px-2 py-1 bg-gray-600 text-white rounded text-xs">待执行</span>';
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  new TokenDetailPage();
});
