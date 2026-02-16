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
    this.expandedTokens = new Set(); // 记录展开的代币

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
      const response = await fetch(`/api/experiment/${this.experimentId}/tokens?limit=10000`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '加载代币数据失败');
      }

      this.tokens = result.tokens || [];
      this.filteredTokens = [...this.tokens];

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
   * 渲染代币列表
   */
  renderTokens() {
    const tbody = document.getElementById('tokens-table-body');
    const emptyState = document.getElementById('empty-state');

    if (!tbody) return;

    if (this.filteredTokens.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = this.filteredTokens.map((token, index) => this.renderTokenRow(token, index)).join('');

    // 绑定展开/收起事件
    this.bindExpandEvents();
    // 绑定复制事件
    this.bindCopyEvents();
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
    const symbol = token.token_symbol || rawData?.symbol || '-';
    const isExpanded = this.expandedTokens.has(token.token_address);
    const gmgnUrl = `https://gmgn.ai/bsc/token/${token.token_address}`;

    return `
      <tr class="token-row" data-token-address="${token.token_address}">
        <td class="px-4 py-3">
          <div class="flex items-center">
            <img src="${rawData?.logo_url || ''}" alt="" class="w-8 h-8 rounded-full mr-3 ${!rawData?.logo_url ? 'hidden' : ''}" onerror="this.style.display='none'">
            <div>
              <div class="font-medium text-white">${this.escapeHtml(symbol)}</div>
              <div class="text-xs text-gray-400 font-mono flex items-center">
                <code class="text-gray-400">${shortAddress}</code>
                <a href="${gmgnUrl}" target="_blank" class="ml-2 text-green-400" title="GMGN">
                  🔗
                </a>
                <button class="ml-2 text-blue-400 copy-address-btn" data-address="${token.token_address}" title="复制地址">
                  📋
                </button>
              </div>
            </div>
          </div>
        </td>
        <td class="px-6 py-3">
          <span class="px-2 py-1 rounded text-xs font-medium ${statusInfo.class}">${statusInfo.text}</span>
        </td>
        <td class="px-4 py-3 text-sm text-white">
          ${price}
        </td>
        <td class="px-4 py-3 text-sm text-white">
          ${launchPrice}
        </td>
        <td class="px-4 py-3 text-sm text-white">
          ${fdv}
        </td>
        <td class="px-4 py-3 text-sm text-white">
          ${tvl}
        </td>
        <td class="px-4 py-3 text-sm text-gray-400">
          <div class="flex items-center">
            <code class="text-gray-400 font-mono text-xs">${shortCreatorAddress}</code>
          </div>
        </td>
        <td class="px-4 py-3 text-sm text-gray-400">
          ${discoveredAt}
        </td>
        <td class="px-4 py-3">
          <button class="expand-btn text-blue-400 text-sm" data-token-address="${token.token_address}">
            <span class="expand-text">${isExpanded ? '收起' : '展开'}</span> ${isExpanded ? '▲' : '▼'}
          </button>
          <div class="expand-content ${isExpanded ? 'expanded' : ''}" data-token-address="${token.token_address}">
            <div class="raw-data-block">
              <pre class="raw-data-code">${this.escapeHtml(JSON.stringify(rawData, null, 2))}</pre>
            </div>
            <div class="mt-2">
              <button class="copy-json-btn text-xs bg-gray-600 text-white px-2 py-1 rounded" data-token-address="${token.token_address}">
                复制 JSON
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  /**
   * 获取状态信息
   */
  getStatusInfo(status) {
    const statusMap = {
      'monitoring': { text: '监控中', class: 'status-monitoring' },
      'bought': { text: '已买入', class: 'status-bought' },
      'exited': { text: '已退出', class: 'status-exited' },
      'negative_dev': { text: 'Dev钱包', class: 'status-negative-dev' }
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

    if (statusFilter !== 'all') {
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
        case 'discovered_at':
        default:
          return new Date(b.discovered_at || 0) - new Date(a.discovered_at || 0);
      }
    });

    this.filteredTokens = filtered;
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
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  new ExperimentTokens();
});
