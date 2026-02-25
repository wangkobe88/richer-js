/**
 * 实验代币页面 - JavaScript模块
 * 提供实验发现代币的列表展示和详情查看功能
 */

class ExperimentTokens {
  constructor() {
    this.experimentId = this.extractExperimentId();
    this.experiment = null;
    this.tokens = [];
    this.filteredTokens = [];
    this.autoRefresh = false; // 默认关闭自动刷新
    this.refreshInterval = 10000; // 10秒
    this.refreshTimer = null;

    // 分页
    this.currentPage = 1;
    this.pageSize = 50;
    this.totalPages = 1;

    // 黑名单统计
    this.blacklistStats = null;
    this.blacklistTokenMap = new Map();
    // 白名单统计
    this.whitelistTokenMap = new Map();

    this.init();
  }

  /**
   * 从URL提取实验ID
   */
  extractExperimentId() {
    const pathParts = window.location.pathname.split('/');
    return pathParts[pathParts.length - 2]; // /experiment/:id/tokens
  }

  /**
   * 初始化
   */
  async init() {
    console.log('🚀 实验代币页面初始化...', this.experimentId);

    try {
      this.bindEvents();
      console.log('✅ 事件绑定完成');

      await this.loadExperimentDetail();
      console.log('✅ 实验详情加载完成');

      await this.loadTokens();
      console.log('✅ 代币数据加载完成');

      this.render();

    } catch (error) {
      console.error('❌ 初始化失败:', error);
      this.showError(error.message);
    }
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    const refreshBtn = document.getElementById('refresh-btn');
    const retryBtn = document.getElementById('retry-btn');
    const applyFiltersBtn = document.getElementById('apply-filters');

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.manualRefresh());
    }

    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.manualRefresh());
    }

    if (applyFiltersBtn) {
      applyFiltersBtn.addEventListener('click', () => this.applyFilters());
    }

    // 状态筛选变化时自动触发筛选
    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
      statusFilter.addEventListener('change', () => this.applyFilters());
    }

    // 排序方式变化时自动触发筛选
    const sortBySelect = document.getElementById('sort-by');
    if (sortBySelect) {
      sortBySelect.addEventListener('change', () => this.applyFilters());
    }

    // 搜索框回车触发筛选
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
          this.applyFilters();
        }
      });
    }

    // 分析按钮
    const analyzeBtn = document.getElementById('analyze-btn');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => this.startAnalysis());
    }

    // 涨幅筛选按钮
    const filterFinal50Btn = document.getElementById('filter-final-50');
    if (filterFinal50Btn) {
      filterFinal50Btn.addEventListener('click', () => this.filterByChange('final', 50));
    }

    const filterMax50Btn = document.getElementById('filter-max-50');
    if (filterMax50Btn) {
      filterMax50Btn.addEventListener('click', () => this.filterByChange('max', 50));
    }

    const clearFilterBtn = document.getElementById('clear-filter');
    if (clearFilterBtn) {
      clearFilterBtn.addEventListener('click', () => this.clearFilters());
    }
  }

  /**
   * 加载实验详情
   */
  async loadExperimentDetail() {
    try {
      const response = await fetch(`/api/experiment/${this.experimentId}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '加载实验详情失败');
      }

      this.experiment = result.data;

    } catch (error) {
      console.error('❌ 加载实验详情失败:', error);
      throw error;
    }
  }

  /**
   * 加载代币数据
   */
  async loadTokens() {
    try {
      const [tokensRes, blacklistRes] = await Promise.all([
        fetch(`/api/experiment/${this.experimentId}/tokens?limit=10000`),
        fetch(`/api/experiment/${this.experimentId}/holder-blacklist-stats`)
      ]);

      if (!tokensRes.ok) {
        throw new Error(`HTTP ${tokensRes.status}: ${tokensRes.statusText}`);
      }

      const result = await tokensRes.json();

      if (!result.success) {
        throw new Error(result.error || '加载代币数据失败');
      }

      this.tokens = result.tokens || [];
      this.filteredTokens = [...this.tokens];

      // 加载黑名单/白名单统计数据
      if (blacklistRes.ok) {
        const blacklistData = await blacklistRes.json();
        if (blacklistData.success) {
          this.blacklistStats = blacklistData.data;
          // 建立代币到黑名单状态的映射
          this.blacklistTokenMap = new Map(
            (blacklistData.data.blacklistedTokenList || []).map(t => [t.token, t])
          );
          // 建立代币到白名单状态的映射
          this.whitelistTokenMap = new Map(
            (blacklistData.data.whitelistedTokenList || []).map(t => [t.token, t])
          );
        }
      }

    } catch (error) {
      console.error('❌ 加载代币数据失败:', error);
      throw error;
    }
  }

  /**
   * 渲染页面
   */
  render() {
    this.hideLoading();
    this.renderExperimentHeader();
    this.renderStatistics();
    this.renderBlacklistStats();
    this.renderTokens();
    this.setupNavigationLinks();
  }

  /**
   * 隐藏加载指示器
   */
  hideLoading() {
    const loading = document.getElementById('loading');
    const content = document.getElementById('tokens-content');

    if (loading) loading.classList.add('hidden');
    if (content) content.classList.remove('hidden');
  }

  /**
   * 显示错误
   */
  showError(message) {
    this.hideLoading();

    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');

    if (errorText) errorText.textContent = message;
    if (errorMessage) errorMessage.classList.remove('hidden');
  }

  /**
   * 渲染实验头部信息
   */
  renderExperimentHeader() {
    if (!this.experiment) return;

    const nameEl = document.getElementById('experiment-name');
    const idEl = document.getElementById('experiment-id');
    const blockchainEl = document.getElementById('experiment-blockchain');

    if (nameEl) {
      const name = this.experiment.experimentName || this.experiment.experiment_name || '未命名实验';
      nameEl.textContent = name;
    }
    if (idEl) idEl.textContent = `ID: ${this.experimentId}`;
    if (blockchainEl) {
      const blockchain = this.experiment.blockchain || this.experiment.blockchainName || 'unknown';
      blockchainEl.textContent = `区块链: ${blockchain.toUpperCase()}`;
    }
  }

  /**
   * 设置导航链接
   */
  setupNavigationLinks() {
    const linkDetail = document.getElementById('link-detail');
    const linkSignals = document.getElementById('link-signals');
    const linkTrades = document.getElementById('link-trades');
    const linkBack = document.getElementById('link-back');

    const basePath = `/experiment/${this.experimentId}`;

    if (linkDetail) linkDetail.href = basePath;
    if (linkSignals) linkSignals.href = `${basePath}/signals`;
    if (linkTrades) linkTrades.href = `${basePath}/trades`;
    if (linkBack) linkBack.href = basePath;
  }

  /**
   * 渲染统计卡片
   */
  renderStatistics() {
    const stats = this.calculateStatistics();

    const totalEl = document.getElementById('total-tokens');
    const monitoringEl = document.getElementById('monitoring-tokens');
    const boughtEl = document.getElementById('bought-tokens');
    const exitedEl = document.getElementById('exited-tokens');
    const negativeDevEl = document.getElementById('negative-dev-tokens');

    if (totalEl) totalEl.textContent = stats.total;
    if (monitoringEl) monitoringEl.textContent = stats.monitoring;
    if (boughtEl) boughtEl.textContent = stats.bought;
    if (exitedEl) exitedEl.textContent = stats.exited;
    if (negativeDevEl) negativeDevEl.textContent = stats.negativeDev;
  }

  /**
   * 计算统计数据
   */
  calculateStatistics() {
    return {
      total: this.tokens.length,
      monitoring: this.tokens.filter(t => t.status === 'monitoring').length,
      bought: this.tokens.filter(t => t.status === 'bought').length,
      exited: this.tokens.filter(t => t.status === 'exited').length,
      negativeDev: this.tokens.filter(t => t.status === 'negative_dev').length
    };
  }

  /**
   * 渲染黑名单统计
   */
  renderBlacklistStats() {
    if (!this.blacklistStats) return;

    // 黑名单统计
    const collectedEl = document.getElementById('stat-collected-tokens');
    const blacklistedEl = document.getElementById('stat-blacklisted-tokens');
    const rateEl = document.getElementById('stat-blacklist-rate');
    const walletsEl = document.getElementById('stat-blacklist-wallets');

    if (collectedEl) collectedEl.textContent = this.blacklistStats.totalTokens || 0;
    if (blacklistedEl) blacklistedEl.textContent = this.blacklistStats.blacklistedTokens || 0;
    if (walletsEl) walletsEl.textContent = this.blacklistStats.blacklistWalletCount || 0;

    if (rateEl) {
      const rate = this.blacklistStats.totalTokens > 0
        ? (this.blacklistStats.blacklistedTokens / this.blacklistStats.totalTokens * 100)
        : 0;
      rateEl.textContent = `${rate.toFixed(2)}%`;
    }

    // 白名单统计
    const wCollectedEl = document.getElementById('stat-whitelist-collected-tokens');
    const wWhitelistedEl = document.getElementById('stat-whitelisted-tokens');
    const wRateEl = document.getElementById('stat-whitelist-rate');
    const wWalletsEl = document.getElementById('stat-whitelist-wallets');

    if (wCollectedEl) wCollectedEl.textContent = this.blacklistStats.totalTokens || 0;
    if (wWhitelistedEl) wWhitelistedEl.textContent = this.blacklistStats.whitelistedTokens || 0;
    if (wWalletsEl) wWalletsEl.textContent = this.blacklistStats.whitelistWalletCount || 0;

    if (wRateEl) {
      const wRate = this.blacklistStats.totalTokens > 0
        ? (this.blacklistStats.whitelistedTokens / this.blacklistStats.totalTokens * 100)
        : 0;
      wRateEl.textContent = `${wRate.toFixed(2)}%`;
    }
  }

  /**
   * 渲染代币列表
   */
  renderTokens() {
    const tbody = document.getElementById('tokens-table-body');
    const emptyState = document.getElementById('empty-state');

    if (!tbody) return;

    if (this.filteredTokens.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      this.renderPagination(0);
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    // 计算分页
    this.totalPages = Math.ceil(this.filteredTokens.length / this.pageSize);
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = Math.min(startIndex + this.pageSize, this.filteredTokens.length);
    const pageData = this.filteredTokens.slice(startIndex, endIndex);

    tbody.innerHTML = pageData.map((token, index) => this.renderTokenRow(token, startIndex + index)).join('');

    // 绑定展开/收起事件
    this.bindExpandEvents();
    // 绑定复制事件
    this.bindCopyEvents();

    // 渲染分页控制
    this.renderPagination(this.filteredTokens.length);
  }

  /**
   * 渲染分页控制
   */
  renderPagination(totalItems) {
    const paginationContainer = document.getElementById('pagination-container');
    if (!paginationContainer) return;

    if (totalItems === 0) {
      paginationContainer.innerHTML = '';
      return;
    }

    const totalPages = Math.ceil(totalItems / this.pageSize);
    const startItem = (this.currentPage - 1) * this.pageSize + 1;
    const endItem = Math.min(this.currentPage * this.pageSize, totalItems);

    let paginationHTML = `
      <div class="flex items-center justify-between px-4 py-3 border-t border-gray-700">
        <div class="text-sm text-gray-400">
          显示 <span class="font-medium text-white">${startItem}</span> 到 <span class="font-medium text-white">${endItem}</span>
          共 <span class="font-medium text-white">${totalItems}</span> 个代币
        </div>
        <div class="flex items-center space-x-2">
          <button ${this.currentPage === 1 ? 'disabled' : ''} onclick="window.experimentTokens.goToPage(${this.currentPage - 1})"
                  class="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm text-white">
            上一页
          </button>
          <span class="text-sm text-gray-400">
            第 <span class="font-medium text-white">${this.currentPage}</span> / <span class="font-medium text-white">${totalPages}</span> 页
          </span>
          <button ${this.currentPage === totalPages ? 'disabled' : ''} onclick="window.experimentTokens.goToPage(${this.currentPage + 1})"
                  class="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm text-white">
            下一页
          </button>
        </div>
      </div>
    `;

    paginationContainer.innerHTML = paginationHTML;
  }

  /**
   * 跳转到指定页
   */
  goToPage(page) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.renderTokens();
    // 滚动到表格顶部
    document.getElementById('tokens-table-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * 渲染单个代币行
   */
  renderTokenRow(token, index) {
    const statusInfo = this.getStatusInfo(token.status);
    const rawData = token.raw_api_data;
    const price = this.formatPrice(rawData?.current_price_usd);
    const launchPrice = this.formatPrice(rawData?.launch_price);
    const fdv = this.formatLargeNumber(rawData?.fdv);
    const tvl = this.formatLargeNumber(rawData?.tvl);
    const discoveredAt = this.formatDateTime(token.discovered_at);
    const shortAddress = this.shortenAddress(token.token_address);
    const creatorAddress = token.creator_address || null;
    const shortCreatorAddress = creatorAddress ? this.shortenAddress(creatorAddress) : '-';
    const platform = token.platform || 'fourmeme';
    const platformLabel = platform === 'flap' ? 'Flap' : 'Four.meme';
    const platformClass = platform === 'flap' ? 'bg-purple-600' : 'bg-blue-600';
    const symbol = token.token_symbol || rawData?.symbol || '-';
    const gmgnUrl = `https://gmgn.ai/bsc/token/${token.token_address}`;
    const signalsUrl = `/experiment/${this.experimentId}/signals#token=${token.token_address}`;
    const observerUrl = `/experiment/${this.experimentId}/observer#token=${token.token_address}`;
    const holdersUrl = `/token-holders?experiment=${this.experimentId}&token=${token.token_address}`;
    const chain = this.experiment?.blockchain || 'bsc';
    const earlyTradesUrl = `/token-early-trades?token=${token.token_address}&chain=${chain}`;

    // 获取分析结果
    const analysis = token.analysis_results;

    // 格式化涨幅
    const finalChangeEl = analysis
      ? this.formatChangePercent(analysis.final_change_percent)
      : '<span class="text-gray-500">-</span>';

    const maxChangeEl = analysis
      ? `<span class="text-yellow-400">${this.formatChangePercent(analysis.max_change_percent)}</span>`
      : '<span class="text-gray-500">-</span>';

    const dataPointsEl = analysis
      ? `<span class="text-gray-400">${analysis.data_points || 0}</span>`
      : '<span class="text-gray-500">-</span>';

    // 检查是否命中黑名单（基于 token_holders 数据）
    const blacklistInfo = this.blacklistTokenMap?.get(token.token_address);
    const hasBlacklist = blacklistInfo && blacklistInfo.hasBlacklist;
    const blacklistBadge = hasBlacklist
      ? '<span class="ml-2 px-2 py-0.5 bg-red-900 text-red-400 text-xs rounded border border-red-700" title="命中持有者黑名单">⚠️ 黑名单</span>'
      : '';

    // 检查是否命中白名单（基于 token_holders 数据）
    const whitelistInfo = this.whitelistTokenMap?.get(token.token_address);
    const hasWhitelist = whitelistInfo && whitelistInfo.hasWhitelist;
    const whitelistBadge = hasWhitelist
      ? '<span class="ml-2 px-2 py-0.5 bg-green-900 text-green-400 text-xs rounded border border-green-700" title="命中持有者白名单">✨ 白名单</span>'
      : '';

    const rowClass = hasBlacklist ? 'bg-red-900/20' : '';

    return `
      <tr class="token-row ${rowClass}" data-token-address="${token.token_address}">
        <td class="px-4 py-3 min-w-[400px]">
          <div class="flex items-start gap-3">
            <img src="${rawData?.logo_url || ''}" alt="" class="w-8 h-8 rounded-full flex-shrink-0 ${!rawData?.logo_url ? 'hidden' : ''}" onerror="this.style.display='none'">
            <div class="flex-1 min-w-0">
              <!-- 第一行：符号、徽章、链接 -->
              <div class="flex items-center flex-wrap gap-1 mb-1">
                <span class="font-medium text-white">${this.escapeHtml(symbol)}</span>
                ${blacklistBadge}
                ${whitelistBadge}
                <a href="${holdersUrl}" target="_blank" class="text-cyan-400 hover:text-cyan-300 text-xs" title="查看持有者">👥 持有者</a>
                <a href="${earlyTradesUrl}" target="_blank" class="text-amber-400 hover:text-amber-300 text-xs" title="查看最早交易">📈 最早交易</a>
              </div>
              <!-- 第二行：地址和操作 -->
              <div class="flex items-center flex-wrap gap-1 text-xs">
                <code class="text-gray-400">${shortAddress}</code>
                ${hasBlacklist && blacklistInfo ? '<span class="text-red-400">(' + (blacklistInfo.blacklistedHolders || 0) + '⚠️)</span>' : ''}
                ${hasWhitelist && whitelistInfo ? '<span class="text-green-400">(' + (whitelistInfo.whitelistedHolders || 0) + '✨)</span>' : ''}
                <a href="${gmgnUrl}" target="_blank" class="text-gray-400 hover:text-purple-400" title="GMGN">GMGN</a>
                <span class="text-gray-600">|</span>
                <a href="${observerUrl}" target="_blank" class="text-green-400 hover:text-green-300" title="时序数据">时序</a>
                <a href="${signalsUrl}" target="_blank" class="text-purple-400 hover:text-purple-300" title="信号">信号</a>
                <button class="text-blue-400 copy-address-btn hover:text-blue-300" data-address="${token.token_address}" title="复制地址">📋</button>
              </div>
            </div>
          </div>
        </td>
        <td class="px-6 py-3">
          <span class="px-2 py-1 rounded text-xs font-medium ${statusInfo.class}">${statusInfo.text}</span>
        </td>
        <td class="px-4 py-3 text-sm text-white text-right">
          ${price}
        </td>
        <td class="px-4 py-3 text-sm text-white text-right">
          ${launchPrice}
        </td>
        <td class="px-4 py-3 text-sm text-white text-right font-medium">
          ${finalChangeEl}
        </td>
        <td class="px-4 py-3 text-sm text-white text-right font-medium">
          ${maxChangeEl}
        </td>
        <td class="px-4 py-3 text-sm text-white text-right">
          ${fdv}
        </td>
        <td class="px-4 py-3 text-sm text-white text-right">
          ${tvl}
        </td>
        <td class="px-4 py-3 text-sm text-gray-400">
          <div class="flex items-center">
            <code class="text-gray-400 font-mono text-xs">${shortCreatorAddress}</code>
          </div>
        </td>
        <td class="px-4 py-3 text-sm text-center">
          <span class="px-2 py-1 rounded text-xs font-medium ${platformClass} text-white">${platformLabel}</span>
        </td>
        <td class="px-4 py-3 text-sm text-gray-400">
          ${discoveredAt}
        </td>
        <td class="px-4 py-3 text-sm text-center">
          ${dataPointsEl}
        </td>
      </tr>
    `;
  }

  /**
   * 格式化涨幅百分比
   */
  formatChangePercent(percent) {
    if (percent === undefined || percent === null || isNaN(percent)) {
      return '<span class="text-gray-500">-</span>';
    }
    const value = parseFloat(percent);
    let colorClass = 'text-gray-400';
    if (value > 0) {
      colorClass = 'text-green-400';
    } else if (value < 0) {
      colorClass = 'text-red-400';
    }
    return `<span class="${colorClass}">${value > 0 ? '+' : ''}${value.toFixed(2)}%</span>`;
  }

  /**
   * 启动涨幅分析
   */
  async startAnalysis() {
    const analyzeBtn = document.getElementById('analyze-btn');
    const progressContainer = document.getElementById('analysis-progress');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const resultText = document.getElementById('analysis-result');

    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = '⏳ 分析中...';
    }

    if (progressContainer) {
      progressContainer.classList.remove('hidden');
    }

    try {
      const response = await fetch(`/api/experiment/${this.experimentId}/analyze-tokens`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '分析失败');
      }

      if (resultText) {
        resultText.textContent = `✅ 完成: ${result.analyzed} 成功, ${result.failed} 失败`;
      }

      // 重新加载数据
      await this.loadTokens();
      this.render();

    } catch (error) {
      console.error('分析失败:', error);
      if (resultText) {
        resultText.textContent = `❌ 失败: ${error.message}`;
      }
      alert('分析失败：' + error.message);
    } finally {
      if (analyzeBtn) {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = '🔄 重新分析';
      }

      if (progressContainer) {
        setTimeout(() => {
          progressContainer.classList.add('hidden');
        }, 2000);
      }
    }
  }

  /**
   * 获取状态信息
   */
  getStatusInfo(status) {
    const statusMap = {
      'monitoring': { text: '监控中', class: 'status-monitoring' },
      'bought': { text: '已买入', class: 'status-bought' },
      'exited': { text: '已退出', class: 'status-exited' },
      'negative_dev': { text: 'Dev钱包', class: 'status-negative-dev' },
      'bad_holder': { text: '黑名单持有者', class: 'status-negative-dev' }
    };
    return statusMap[status] || { text: status || '未知', class: 'bg-gray-500 text-white' };
  }

  /**
   * 格式化价格
   */
  formatPrice(price) {
    if (price === null || price === undefined || price === '') return '-';
    // 转换为数字
    const numPrice = typeof price === 'string' ? parseFloat(price) : price;
    if (isNaN(numPrice)) return '-';
    if (numPrice === 0) return '$0.00';
    if (numPrice < 0.000001) return `$${numPrice.toExponential(2)}`;
    if (numPrice < 0.01) return `$${numPrice.toFixed(8)}`;
    if (numPrice < 1) return `$${numPrice.toFixed(6)}`;
    return `$${numPrice.toFixed(4)}`;
  }

  /**
   * 格式化大数字
   */
  formatLargeNumber(num) {
    if (num === null || num === undefined || num === '') return '-';
    // 转换为数字
    const numValue = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(numValue)) return '-';
    if (numValue === 0) return '0';

    const suffixes = ['', 'K', 'M', 'B', 'T'];
    const suffixIndex = Math.floor(Math.log10(Math.abs(numValue)) / 3);

    if (suffixIndex === 0) return `$${numValue.toFixed(2)}`;

    const scaled = numValue / Math.pow(1000, suffixIndex);
    return `$${scaled.toFixed(2)}${suffixes[suffixIndex]}`;
  }

  /**
   * 格式化日期时间
   */
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

  /**
   * 缩短地址
   */
  shortenAddress(address) {
    if (!address) return '-';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  /**
   * HTML转义
   */
  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 绑定展开/收起事件
   */
  bindExpandEvents() {
    document.querySelectorAll('.expand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tokenAddress = btn.dataset.tokenAddress;
        const content = document.querySelector(`.expand-content[data-token-address="${tokenAddress}"]`);

        if (content) {
          const isExpanding = !content.classList.contains('expanded');
          content.classList.toggle('expanded');
          // 保存展开状态
          if (isExpanding) {
            this.expandedTokens.add(tokenAddress);
          } else {
            this.expandedTokens.delete(tokenAddress);
          }
          // 更新按钮文字
          btn.innerHTML = isExpanding
            ? '<span class="expand-text">收起</span> ▲'
            : '<span class="expand-text">展开</span> ▼';
        }
      });
    });
  }

  /**
   * 绑定复制事件
   */
  bindCopyEvents() {
    // 复制地址
    document.querySelectorAll('.copy-address-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const address = btn.dataset.address;
        this.copyToClipboard(address, '地址');
      });
    });

    // 复制JSON
    document.querySelectorAll('.copy-json-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tokenAddress = btn.dataset.tokenAddress;
        const token = this.tokens.find(t => t.token_address === tokenAddress);
        if (token) {
          const jsonStr = JSON.stringify(token.raw_api_data, null, 2);
          this.copyToClipboard(jsonStr, 'JSON');
        }
      });
    });
  }

  /**
   * 复制到剪贴板
   */
  async copyToClipboard(text, label = '内容') {
    try {
      await navigator.clipboard.writeText(text);
      this.showToast(`${label}已复制到剪贴板`);
    } catch (err) {
      console.error('复制失败:', err);
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        this.showToast(`${label}已复制到剪贴板`);
      } catch (e) {
        this.showToast('复制失败，请手动复制');
      }
      document.body.removeChild(textarea);
    }
  }

  /**
   * 显示提示
   */
  showToast(message) {
    // 简单的toast实现
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => document.body.removeChild(toast), 300);
    }, 2000);
  }

  /**
   * 应用筛选
   */
  applyFilters() {
    const statusFilter = document.getElementById('status-filter')?.value || 'all';
    const sortBy = document.getElementById('sort-by')?.value || 'discovered_at';
    const searchInput = document.getElementById('search-input')?.value || '';

    // 筛选
    let filtered = [...this.tokens];

    if (statusFilter === 'blacklist') {
      // 黑名单筛选 - 基于 status === 'bad_holder'
      filtered = filtered.filter(t => t.status === 'bad_holder');
    } else if (statusFilter !== 'all') {
      filtered = filtered.filter(t => t.status === statusFilter);
    }

    if (searchInput) {
      const searchLower = searchInput.toLowerCase();
      filtered = filtered.filter(t =>
        (t.token_symbol && t.token_symbol.toLowerCase().includes(searchLower)) ||
        (t.token_address && t.token_address.toLowerCase().includes(searchLower))
      );
    }

    // 排序
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'fdv':
          const aFdv = a.raw_api_data?.fdv || 0;
          const bFdv = b.raw_api_data?.fdv || 0;
          return bFdv - aFdv;
        case 'price':
          const aPrice = a.raw_api_data?.current_price_usd || 0;
          const bPrice = b.raw_api_data?.current_price_usd || 0;
          return bPrice - aPrice;
        case 'symbol':
          const aSymbol = (a.token_symbol || '').toLowerCase();
          const bSymbol = (b.token_symbol || '').toLowerCase();
          return aSymbol.localeCompare(bSymbol);
        case 'final_change':
          const aFinalChange = a.analysis_results?.final_change_percent || -999;
          const bFinalChange = b.analysis_results?.final_change_percent || -999;
          return bFinalChange - aFinalChange;
        case 'max_change':
          const aMaxChange = a.analysis_results?.max_change_percent || -999;
          const bMaxChange = b.analysis_results?.max_change_percent || -999;
          return bMaxChange - aMaxChange;
        case 'discovered_at':
        default:
          return new Date(b.discovered_at || 0) - new Date(a.discovered_at || 0);
      }
    });

    this.filteredTokens = filtered;
    this.currentPage = 1; // 重置到第一页
    this.renderTokens();
  }

  /**
   * 手动刷新
   */
  async manualRefresh() {
    console.log('🔄 手动刷新...');

    try {
      // 先调用价格刷新 API 获取最新价格
      const priceRefreshResponse = await fetch(`/api/experiment/${this.experimentId}/tokens/refresh-prices`, {
        method: 'POST'
      });

      if (priceRefreshResponse.ok) {
        const priceResult = await priceRefreshResponse.json();
        if (priceResult.success) {
          console.log(`✅ 价格刷新完成: ${priceResult.updated} 个代币已更新`);
        }
      }

      // 再加载代币数据（此时数据已包含最新价格）
      await this.loadTokens();
      this.applyFilters();
      this.renderStatistics();
      this.showToast('刷新成功');
    } catch (error) {
      console.error('❌ 刷新失败:', error);
      this.showError(error.message);
    }
  }

  /**
   * 切换自动刷新
   */
  toggleAutoRefresh() {
    this.autoRefresh = !this.autoRefresh;
    if (this.autoRefresh) {
      this.startAutoRefresh();
    } else {
      this.stopAutoRefresh();
    }
  }

  /**
   * 启动自动刷新
   */
  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshTimer = setInterval(() => {
      this.manualRefresh();
    }, this.refreshInterval);
  }

  /**
   * 停止自动刷新
   */
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * 按涨幅筛选
   * @param {string} type - 'final' 或 'max'
   * @param {number} threshold - 涨幅阈值（百分比）
   */
  filterByChange(type, threshold) {
    const sortBy = document.getElementById('sort-by')?.value || 'discovered_at';
    const searchInput = document.getElementById('search-input')?.value || '';

    let filtered = [...this.tokens];

    console.log(`🔍 筛选前总代币数: ${filtered.length}`);

    // 统计有分析结果的代币
    const withAnalysis = filtered.filter(t => t.analysis_results && t.analysis_results[type === 'final' ? 'final_change_percent' : 'max_change_percent'] !== undefined);
    console.log(`📊 有分析结果的代币数: ${withAnalysis.length}`);

    // 按涨幅筛选
    filtered = filtered.filter(t => {
      const analysis = t.analysis_results;
      if (!analysis) return false;
      const percent = type === 'final'
        ? analysis.final_change_percent
        : analysis.max_change_percent;
      return percent !== undefined && percent !== null && percent > threshold;
    });

    console.log(`✅ 筛选后代币数: ${filtered.length}`);

    // 搜索框筛选
    if (searchInput) {
      const searchLower = searchInput.toLowerCase();
      filtered = filtered.filter(t =>
        (t.token_symbol && t.token_symbol.toLowerCase().includes(searchLower)) ||
        (t.token_address && t.token_address.toLowerCase().includes(searchLower))
      );
    }

    // 按涨幅降序排序
    filtered.sort((a, b) => {
      const aChange = a.analysis_results?.[type === 'final' ? 'final_change_percent' : 'max_change_percent'] || -999;
      const bChange = b.analysis_results?.[type === 'final' ? 'final_change_percent' : 'max_change_percent'] || -999;
      return bChange - aChange;
    });

    this.filteredTokens = filtered;
    this.currentPage = 1;
    this.renderTokens();

    if (filtered.length === 0) {
      if (withAnalysis.length === 0) {
        this.showToast(`⚠️ 该实验的代币还没有涨幅分析数据！请先点击页面顶部的"🔄 开始分析"按钮。`);
      } else {
        this.showToast(`⚠️ 没有符合条件的代币（${type === 'final' ? '最终涨幅' : '最高涨幅'} > ${threshold}%）。已有分析数据的代币: ${withAnalysis.length} 个`);
      }
    } else {
      this.showToast(`已筛选: ${type === 'final' ? '最终涨幅' : '最高涨幅'} > ${threshold}%，共 ${filtered.length} 个代币`);
    }
  }

  /**
   * 清除筛选
   */
  clearFilters() {
    // 重置状态筛选
    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
      statusFilter.value = 'all';
    }

    // 重置排序
    const sortBySelect = document.getElementById('sort-by');
    if (sortBySelect) {
      sortBySelect.value = 'discovered_at';
    }

    // 重置搜索框
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.value = '';
    }

    // 应用默认筛选
    this.applyFilters();
    this.showToast('已清除所有筛选');
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  window.experimentTokens = new ExperimentTokens();
});
