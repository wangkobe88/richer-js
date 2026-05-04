/**
 * 实验代币页面 - JavaScript模块
 * 提供实验发现代币的列表展示和详情查看功能
 */

// 标注分类映射
const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭', colorClass: 'text-red-400', bgClass: 'bg-red-900', borderClass: 'border-red-700' },
  no_user: { label: '无人玩', emoji: '👻', colorClass: 'text-gray-400', bgClass: 'bg-gray-700', borderClass: 'border-gray-600' },
  low_quality: { label: '低质量', emoji: '📉', colorClass: 'text-orange-400', bgClass: 'bg-orange-900', borderClass: 'border-orange-700' },
  mid_quality: { label: '中质量', emoji: '📊', colorClass: 'text-blue-400', bgClass: 'bg-blue-900', borderClass: 'border-blue-700' },
  high_quality: { label: '高质量', emoji: '🚀', colorClass: 'text-green-400', bgClass: 'bg-green-900', borderClass: 'border-green-700' }
};

// 叙事评级映射
const NARRATIVE_RATING_MAP = {
  1: { label: '低质量', emoji: '📉', colorClass: 'text-orange-400', bgClass: 'bg-orange-900', borderClass: 'border-orange-700' },
  2: { label: '中质量', emoji: '📊', colorClass: 'text-blue-400', bgClass: 'bg-blue-900', borderClass: 'border-blue-700' },
  3: { label: '高质量', emoji: '🚀', colorClass: 'text-green-400', bgClass: 'bg-green-900', borderClass: 'border-green-700' },
  9: { label: '未评级', emoji: '❓', colorClass: 'text-gray-400', bgClass: 'bg-gray-700', borderClass: 'border-gray-600' }
};

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
    // 叙事分析数据
    this.narrativeDataMap = new Map();
    // 当前编辑的代币地址（用于标注功能）
    this.currentEditingToken = null;

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

      // 异步加载叙事分析数据（不阻塞页面渲染）
      this.loadNarrativeData();

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

    // 黑白名单筛选按钮
    const filterHolderListBtn = document.getElementById('filter-holder-list');
    if (filterHolderListBtn) {
      filterHolderListBtn.addEventListener('click', () => this.filterByHolderList());
    }

    // 标注模态框事件
    const judgeCancelBtn = document.getElementById('judge-cancel-btn');
    if (judgeCancelBtn) {
      judgeCancelBtn.addEventListener('click', () => this.closeJudgeModal());
    }

    const judgeSaveBtn = document.getElementById('judge-save-btn');
    if (judgeSaveBtn) {
      judgeSaveBtn.addEventListener('click', () => this.saveJudge());
    }

    // 点击模态框背景关闭
    const judgeModal = document.getElementById('judge-modal');
    if (judgeModal) {
      judgeModal.addEventListener('click', (e) => {
        if (e.target === judgeModal) {
          this.closeJudgeModal();
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
    if (linkBack) linkBack.href = '/experiments';
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
    // 绑定标注事件
    this.bindJudgeEvents();

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
    const platformConfig = {
        fourmeme: { label: 'Four.meme', cls: 'bg-blue-600' },
        flap:     { label: 'Flap', cls: 'bg-purple-600' },
        bankr:    { label: 'Bankr', cls: 'bg-orange-600' },
        pumpfun:  { label: 'Pump.fun', cls: 'bg-green-600' },
        ave:      { label: 'AVE', cls: 'bg-teal-600' },
        gmgn:     { label: 'GMGN', cls: 'bg-yellow-600 text-black' },
    };
    const platformInfo = platformConfig[platform] || platformConfig.fourmeme;
    const platformLabel = platformInfo.label;
    const platformClass = platformInfo.cls;
    const symbol = token.token_symbol || rawData?.symbol || '-';
    const chain = this.experiment?.blockchain || 'bsc';
    const gmgnChainMap = { bsc: 'bsc', eth: 'eth', ethereum: 'eth', solana: 'sol', sol: 'sol', base: 'base' };
    const gmgnChain = gmgnChainMap[chain.toLowerCase()] || 'bsc';
    const gmgnUrl = `https://gmgn.ai/${gmgnChain}/token/${token.token_address}`;
    const signalsUrl = `/experiment/${this.experimentId}/signals#token=${token.token_address}`;
    const observerUrl = `/experiment/${this.experimentId}/observer#token=${token.token_address}`;
    const holdersUrl = `/token-holders?experiment=${this.experimentId}&token=${token.token_address}`;
    const earlyTradesUrl = `/token-early-trades?token=${token.token_address}&chain=${chain}`;
    const strategyUrl = `/experiment/${this.experimentId}/strategy-analysis?tokenAddress=${token.token_address}`;
    const tokenDetailUrl = `/token-detail?experiment=${this.experimentId}&address=${token.token_address}`;

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
    const blacklistCount = blacklistInfo?.blacklistedHolders || 0;
    const blacklistBadge = hasBlacklist
      ? `<span class="px-1 py-0.5 bg-red-900 text-red-400 text-[10px] rounded border border-red-700" title="黑名单命中${blacklistCount}个">⚠️${blacklistCount}</span>`
      : '';

    // 检查是否命中白名单（基于 token_holders 数据）
    const whitelistInfo = this.whitelistTokenMap?.get(token.token_address);
    const hasWhitelist = whitelistInfo && whitelistInfo.hasWhitelist;
    const whitelistCount = whitelistInfo?.whitelistedHolders || 0;
    const whitelistBadge = hasWhitelist
      ? `<span class="px-1 py-0.5 bg-green-900 text-green-400 text-[10px] rounded border border-green-700" title="白名单命中${whitelistCount}个">✨${whitelistCount}</span>`
      : '';

    const rowClass = hasBlacklist ? 'bg-red-900/20' : '';

    return `
      <tr class="token-row ${rowClass}" data-token-address="${token.token_address}">
        <td class="px-1 py-1 overflow-hidden" style="width: 180px;">
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-0.5 truncate">
              <img src="${rawData?.logo_url || ''}" alt="" class="w-3.5 h-3.5 rounded-full flex-shrink-0 ${!rawData?.logo_url ? 'hidden' : ''}" onerror="this.style.display='none'">
              <span class="font-medium text-white text-[10px] truncate">${this.escapeHtml(symbol)}</span>
              ${blacklistBadge}
              ${whitelistBadge}
            </div>
            <div class="flex items-center gap-0.5 text-[10px] text-gray-400 truncate">
              <code class="text-gray-500 truncate text-[9px]">${shortAddress}</code>
            </div>
            <div class="flex items-center gap-1 text-[9px] text-gray-500 flex-wrap">
              <a href="${gmgnUrl}" target="_blank" class="hover:text-purple-400 flex-shrink-0">GMGN</a>
              <span class="text-gray-600">|</span>
              <a href="${observerUrl}" target="_blank" class="hover:text-green-400 flex-shrink-0">时序</a>
              <span class="text-gray-600">|</span>
              <a href="${signalsUrl}" target="_blank" class="hover:text-purple-400 flex-shrink-0">信号</a>
              <span class="text-gray-600">|</span>
              <a href="${strategyUrl}" target="_blank" class="hover:text-pink-400 flex-shrink-0">策略</a>
              <span class="text-gray-600">|</span>
              <a href="${earlyTradesUrl}" target="_blank" class="hover:text-amber-400 flex-shrink-0" title="早期交易">早期</a>
              <span class="text-gray-600">|</span>
              <a href="${tokenDetailUrl}" target="_blank" class="hover:text-cyan-400 flex-shrink-0" title="代币详情">详情</a>
              <span class="text-gray-600">|</span>
              <a href="${holdersUrl}" target="_blank" class="hover:text-indigo-400 flex-shrink-0" title="持有者">持有者</a>
              <span class="text-gray-600">|</span>
              <button class="copy-address-btn hover:text-blue-400 flex-shrink-0" data-address="${token.token_address}">复制</button>
            </div>
          </div>
        </td>
        <td class="px-1.5 py-1 text-center overflow-hidden">
          <span class="px-1 py-0.5 rounded text-[10px] font-medium ${statusInfo.class}">${statusInfo.text}</span>
        </td>
        <td class="px-1.5 py-1 text-right text-[10px] text-white overflow-hidden truncate">${price}</td>
        <td class="px-1.5 py-1 text-right text-[10px] text-white overflow-hidden truncate">${launchPrice}</td>
        <td class="px-1.5 py-1 text-right text-[10px] text-white font-medium overflow-hidden truncate">${finalChangeEl}</td>
        <td class="px-1.5 py-1 text-right text-[10px] text-white font-medium overflow-hidden truncate">${maxChangeEl}</td>
        <td class="px-1.5 py-1 text-right text-[10px] text-white overflow-hidden truncate">${fdv}</td>
        <td class="px-1.5 py-1 text-right text-[10px] text-white overflow-hidden truncate">${tvl}</td>
        <td class="px-1.5 py-1 text-left text-[10px] text-gray-400 overflow-hidden truncate"><code class="text-gray-400 font-mono truncate">${shortCreatorAddress}</code></td>
        <td class="px-1.5 py-1 text-center overflow-hidden"><span class="px-1 py-0.5 rounded text-[10px] font-medium ${platformClass} text-white">${platformLabel}</span></td>
        <td class="px-1.5 py-1 text-left text-[10px] text-gray-400 overflow-hidden truncate">${discoveredAt}</td>
        <td class="px-1.5 py-1 text-center text-[10px] text-gray-400 overflow-hidden">${dataPointsEl}</td>
        <td class="px-1.5 py-1 text-center overflow-hidden narrative-cell">${this.renderNarrativeRating(token.token_address)}</td>
        <td class="px-1.5 py-1 text-center overflow-hidden">${this.renderJudgeColumn(token)}</td>
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
    if (numValue === 0) return '$0';

    // 处理负数
    const absValue = Math.abs(numValue);
    const sign = numValue < 0 ? '-' : '';

    // 小于 1 的数字直接返回，不加后缀
    if (absValue < 1) {
      return `$${sign}${absValue.toFixed(6)}`;
    }

    const suffixes = ['', 'K', 'M', 'B', 'T'];
    const suffixIndex = Math.floor(Math.log10(absValue) / 3);

    // 限制 suffixIndex 在数组范围内
    const validIndex = Math.min(suffixIndex, suffixes.length - 1);

    if (validIndex === 0) return `$${sign}${numValue.toFixed(2)}`;

    const scaled = absValue / Math.pow(1000, validIndex);
    return `$${sign}${scaled.toFixed(2)}${suffixes[validIndex]}`;
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
   * 绑定标注事件
   */
  bindJudgeEvents() {
    // 标注按钮
    document.querySelectorAll('.judge-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tokenAddress = btn.dataset.tokenAddress;
        this.openJudgeModal(tokenAddress);
      });
    });

    // 编辑标注按钮
    document.querySelectorAll('.edit-judge-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tokenAddress = btn.dataset.tokenAddress;
        this.openJudgeModal(tokenAddress);
      });
    });

    // 删除标注按钮
    document.querySelectorAll('.delete-judge-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tokenAddress = btn.dataset.tokenAddress;
        this.deleteJudge(tokenAddress);
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

  /**
   * 筛选命中黑白名单的代币
   */
  filterByHolderList() {
    let filtered = [...this.tokens];

    // 筛选命中黑名单或白名单的代币
    filtered = filtered.filter(t => {
      const hasBlacklist = this.blacklistTokenMap?.has(t.token_address);
      const hasWhitelist = this.whitelistTokenMap?.has(t.token_address);
      return hasBlacklist || hasWhitelist;
    });

    // 按最高涨幅降序排序
    filtered.sort((a, b) => {
      const aMaxChange = a.analysis_results?.max_change_percent || -999;
      const bMaxChange = b.analysis_results?.max_change_percent || -999;
      return bMaxChange - aMaxChange;
    });

    this.filteredTokens = filtered;
    this.currentPage = 1;
    this.renderTokens();

    // 统计黑名单和白名单数量
    const blacklistCount = filtered.filter(t => this.blacklistTokenMap?.has(t.token_address)).length;
    const whitelistCount = filtered.filter(t => this.whitelistTokenMap?.has(t.token_address)).length;

    if (filtered.length === 0) {
      this.showToast('⚠️ 没有命中黑白名单的代币');
    } else {
      this.showToast(`已筛选: 命中黑白名单（按最高涨幅排序），共 ${filtered.length} 个代币（黑名单: ${blacklistCount}，白名单: ${whitelistCount}）`);
    }
  }

  /**
   * 渲染标注列
   */
  renderJudgeColumn(token) {
    const judgeData = token.human_judges;

    if (!judgeData || !judgeData.category) {
      return `<button class="judge-btn hover:text-blue-400 text-[9px] text-gray-400" data-token-address="${token.token_address}">标注</button>`;
    }

    const category = CATEGORY_MAP[judgeData.category];
    if (!category) {
      return `<button class="judge-btn hover:text-blue-400 text-[9px] text-gray-400" data-token-address="${token.token_address}">标注</button>`;
    }

    return `
      <div class="flex items-center justify-center gap-0.5">
        <span class="px-1 py-0.5 rounded text-[9px] ${category.bgClass} ${category.colorClass} border ${category.borderClass}" title="${judgeData.note || ''}">
          ${category.emoji}
        </span>
        <button class="edit-judge-btn hover:text-blue-300 text-[9px] text-gray-400" data-token-address="${token.token_address}" title="编辑">编</button>
        <button class="delete-judge-btn hover:text-red-300 text-[9px] text-gray-400" data-token-address="${token.token_address}" title="删除">删</button>
      </div>
    `;
  }

  /**
   * 打开标注模态框
   */
  openJudgeModal(tokenAddress) {
    const token = this.tokens.find(t => t.token_address === tokenAddress);
    if (!token) return;

    this.currentEditingToken = tokenAddress;

    const modal = document.getElementById('judge-modal');
    const symbolEl = document.getElementById('modal-token-symbol');
    const addressEl = document.getElementById('modal-token-address');
    const noteEl = document.getElementById('judge-note');

    // 设置代币信息
    if (symbolEl) symbolEl.textContent = token.token_symbol || token.raw_api_data?.symbol || '-';
    if (addressEl) addressEl.textContent = tokenAddress;

    // 设置已有标注信息
    const judgeData = token.human_judges;
    const categoryRadios = document.querySelectorAll('input[name="judge-category"]');
    categoryRadios.forEach(radio => {
      radio.checked = radio.value === (judgeData?.category || '');
    });

    if (noteEl) noteEl.value = judgeData?.note || '';

    // 显示模态框
    if (modal) modal.classList.remove('hidden');
  }

  /**
   * 关闭标注模态框
   */
  closeJudgeModal() {
    const modal = document.getElementById('judge-modal');
    if (modal) modal.classList.add('hidden');

    // 清空输入
    const categoryRadios = document.querySelectorAll('input[name="judge-category"]');
    categoryRadios.forEach(radio => {
      radio.checked = false;
    });

    const noteEl = document.getElementById('judge-note');
    if (noteEl) noteEl.value = '';

    this.currentEditingToken = null;
  }

  /**
   * 保存标注
   */
  async saveJudge() {
    if (!this.currentEditingToken) return;

    const selectedRadio = document.querySelector('input[name="judge-category"]:checked');
    if (!selectedRadio) {
      this.showToast('请选择一个分类');
      return;
    }

    const category = selectedRadio.value;
    const noteEl = document.getElementById('judge-note');
    const note = noteEl?.value || '';

    try {
      const response = await fetch(`/api/experiment/${this.experimentId}/tokens/${this.currentEditingToken}/judge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ category, note })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '保存标注失败');
      }

      // 更新本地数据
      const tokenIndex = this.tokens.findIndex(t => t.token_address === this.currentEditingToken);
      if (tokenIndex !== -1) {
        this.tokens[tokenIndex].human_judges = result.data.human_judges;
      }

      this.closeJudgeModal();
      this.renderTokens();
      this.showToast('标注已保存');

    } catch (error) {
      console.error('保存标注失败:', error);
      this.showToast('保存失败: ' + error.message);
    }
  }

  /**
   * 删除标注
   */
  async deleteJudge(tokenAddress) {
    if (!confirm('确定要删除这个标注吗？')) return;

    try {
      const response = await fetch(`/api/experiment/${this.experimentId}/tokens/${tokenAddress}/judge`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '删除标注失败');
      }

      // 更新本地数据
      const tokenIndex = this.tokens.findIndex(t => t.token_address === tokenAddress);
      if (tokenIndex !== -1) {
        this.tokens[tokenIndex].human_judges = null;
      }

      this.renderTokens();
      this.showToast('标注已删除');

    } catch (error) {
      console.error('删除标注失败:', error);
      this.showToast('删除失败: ' + error.message);
    }
  }

  /**
   * 异步加载叙事分析数据
   */
  async loadNarrativeData() {
    try {
      const tokenAddresses = this.tokens.map(t => t.token_address);
      // 并发加载，每次最多 5 个请求
      const batchSize = 5;
      for (let i = 0; i < tokenAddresses.length; i += batchSize) {
        const batch = tokenAddresses.slice(i, i + batchSize);
        const promises = batch.map(async (address) => {
          try {
            const response = await fetch(`/api/narrative/result/${address}`);
            if (response.ok) {
              const result = await response.json();
              if (result.success && result.data) {
                this.narrativeDataMap.set(address, result.data);
              }
            }
          } catch (e) {
            // 单个加载失败不影响其他
          }
        });
        await Promise.all(promises);
      }

      // 更新已渲染的叙事列
      this.refreshNarrativeCells();
      console.log(`✅ 加载了 ${this.narrativeDataMap.size} 条叙事分析数据`);
    } catch (error) {
      console.error('加载叙事分析数据失败:', error);
    }
  }

  /**
   * 刷新已渲染的叙事评级单元格
   */
  refreshNarrativeCells() {
    const rows = document.querySelectorAll('tr[data-token-address]');
    rows.forEach(row => {
      const address = row.getAttribute('data-token-address');
      const cell = row.querySelector('.narrative-cell');
      if (cell) {
        cell.innerHTML = this.renderNarrativeRating(address);
      }
    });
  }

  /**
   * 渲染叙事评级
   */
  renderNarrativeRating(tokenAddress) {
    const narrative = this.narrativeDataMap.get(tokenAddress);

    if (!narrative || !narrative.meta?.isValid) {
      return `<a href="/narrative-analyzer?address=${tokenAddress}" target="_blank" class="text-gray-500 text-[10px] hover:text-blue-400 transition-colors">-</a>`;
    }

    const summary = narrative.llmAnalysis?.summary;
    const rating = summary?.rating ?? 9;
    const ratingInfo = NARRATIVE_RATING_MAP[rating] || NARRATIVE_RATING_MAP[9];

    const summaryStr = summary?.reasoning || '';
    const summaryTitle = summaryStr ? summaryStr.slice(0, 200) + (summaryStr.length > 200 ? '...' : '') : '';

    const totalScore = summary?.total_score;
    const scoreText = totalScore != null ? ` ${totalScore.toFixed(0)}分` : '';

    return `<a href="/narrative-analyzer?address=${tokenAddress}" target="_blank" class="px-1.5 py-0.5 rounded text-[10px] ${ratingInfo.bgClass} ${ratingInfo.colorClass} border ${ratingInfo.borderClass} hover:opacity-80 transition-opacity inline-block" title="${summaryTitle || ratingInfo.label}" style="cursor:pointer;text-decoration:none;">${ratingInfo.emoji} ${rating}${scoreText}</a>`;
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  window.experimentTokens = new ExperimentTokens();
});
