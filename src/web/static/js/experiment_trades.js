/**
 * 交易记录页面 - JavaScript模块
 * 提供交易记录展示、分页、详情查看和统计功能
 */

class ExperimentTrades {
  constructor() {
    this.experimentId = this.extractExperimentId();
    this.experiment = null;
    this.tradesData = [];  // 原始交易数据（所有代币）
    this.currentPage = 1;
    this.tradesPerPage = 12;
    this.isLoading = false;
    this.klineData = [];
    this.chart = null;
    this.volumeChart = null;
    this.currentFilters = {
      direction: 'all',
      success: 'all',
      symbol: 'all',
      limit: 50
    };

    // 🔥 多代币支持
    this.selectedToken = 'all';  // 当前选择的代币，'all'表示全部
    this.availableTokens = [];   // 可用的代币列表

    this.init();
  }

  /**
   * 初始化交易记录页面
   */
  async init() {
    console.log('🚀 交易记录页面初始化...', this.experimentId);

    try {
      // 绑定事件
      this.bindEvents();

      // 等待Chart.js加载完成
      await this.waitForChartJS();

      // 加载实验数据和交易记录
      await this.loadExperimentData();
      await this.loadTradesData();

      // 🔥 从交易数据中提取代币列表并填充选择器
      this.extractTokensFromExperiment();

      // 加载K线数据并初始化图表
      await this.loadKlineDataAndInitChart();

      // 渲染页面
      this.renderTradeStats();
      this.renderTradeCards();
      this.setupPagination();

      // 隐藏加载指示器
      this.hideLoading();

      console.log('✅ 交易记录页面初始化完成');

    } catch (error) {
      console.error('❌ 交易记录页面初始化失败:', error);
      this.showError('初始化失败: ' + error.message);
    }
  }

  /**
   * 从URL中提取实验ID
   */
  extractExperimentId() {
    const pathParts = window.location.pathname.split('/');
    return pathParts[pathParts.length - 2]; // 获取倒数第二个部分
  }

  /**
   * 等待Chart.js加载完成
   */
  async waitForChartJS() {
    let attempts = 0;
    const maxAttempts = 20; // 最多等待10秒

    while (typeof Chart === 'undefined' && attempts < maxAttempts) {
      console.log(`⏳ 等待Chart.js加载... (${attempts + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (typeof Chart === 'undefined') {
      throw new Error('Chart.js加载超时，请检查网络连接');
    }

    console.log('✅ Chart.js已加载完成');
  }

  /**
   * 绑定事件处理器
   */
  bindEvents() {
    // 交易卡片点击事件
    const tradeCardsView = document.getElementById('trades-container');
    if (tradeCardsView) {
      tradeCardsView.addEventListener('click', (e) => {
        const tradeCard = e.target.closest('.trade-card');
        if (tradeCard) {
          const tradeId = tradeCard.dataset.tradeId;
          this.showTradeDetail(tradeId);
        }
      });
    }

    // 模态框关闭事件
    const closeModal = document.getElementById('close-modal');
    if (closeModal) {
      closeModal.addEventListener('click', () => {
        this.hideTradeDetail();
      });
    }

    // 点击模态框外部关闭
    const modal = document.getElementById('trade-detail-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.hideTradeDetail();
        }
      });
    }

    // 分页事件
    const prevPage = document.getElementById('prev-page');
    const nextPage = document.getElementById('next-page');

    if (prevPage) {
      prevPage.addEventListener('click', () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.renderTradeCards();
          this.setupPagination();
        }
      });
    }

    if (nextPage) {
      nextPage.addEventListener('click', () => {
        const totalPages = Math.ceil(this.tradesData.length / this.tradesPerPage);
        if (this.currentPage < totalPages) {
          this.currentPage++;
          this.renderTradeCards();
          this.setupPagination();
        }
      });
    }

    // 筛选事件
    const filterSelect = document.getElementById('trade-filter');
    if (filterSelect) {
      filterSelect.addEventListener('change', () => {
        this.currentPage = 1;
        this.renderTradeCards();
        this.setupPagination();
      });
    }

    // 排序事件
    const sortSelect = document.getElementById('trade-sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        this.currentPage = 1;
        this.renderTradeCards();
        this.setupPagination();
      });
    }

    // 刷新按钮
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.loadTradesData();
        this.loadKlineDataAndInitChart();
        this.renderTradeStats();
        this.renderTradeCards();
        this.setupPagination();
      });
    }

    // 自动刷新按钮
    const autoRefreshBtn = document.getElementById('auto-refresh-btn');
    if (autoRefreshBtn) {
      autoRefreshBtn.addEventListener('click', () => {
        this.toggleAutoRefresh();
      });
    }

    // 筛选控件事件
    const applyFiltersBtn = document.getElementById('apply-filters');
    if (applyFiltersBtn) {
      applyFiltersBtn.addEventListener('click', () => {
        this.applyFilters();
      });
    }

    const clearFiltersBtn = document.getElementById('clear-filters');
    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener('click', () => {
        this.clearFilters();
      });
    }

    // 导出按钮
    const exportTradesBtn = document.getElementById('export-trades');
    if (exportTradesBtn) {
      exportTradesBtn.addEventListener('click', () => {
        this.exportTrades();
      });
    }

    // 视图切换按钮
    const viewCardsBtn = document.getElementById('view-cards');
    const viewTableBtn = document.getElementById('view-table');

    if (viewCardsBtn) {
      viewCardsBtn.addEventListener('click', () => {
        this.switchView('cards');
      });
    }

    if (viewTableBtn) {
      viewTableBtn.addEventListener('click', () => {
        this.switchView('table');
      });
    }
  }

  /**
   * 加载实验数据
   */
  async loadExperimentData() {
    try {
      console.log('📡 正在获取实验数据...');

      const response = await fetch(`/api/experiment/${this.experimentId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      this.experiment = result.data;

      // 更新实验头部信息
      this.updateExperimentHeader(this.experiment);

      console.log('✅ 实验数据加载完成');

    } catch (error) {
      console.error('❌ 加载实验数据失败:', error);
      throw error;
    }
  }

  /**
   * 更新实验头部信息
   */
  updateExperimentHeader(experiment) {
    if (!experiment) return;

    // API返回的是驼峰命名: experimentName, blockchain
    const name = experiment.experimentName || experiment.experiment_name || '未知实验';

    const nameEl = document.getElementById('experiment-name');
    const idEl = document.getElementById('experiment-id');
    const blockchainEl = document.getElementById('experiment-blockchain');

    if (nameEl) nameEl.textContent = name;
    if (idEl) idEl.textContent = `ID: ${this.experimentId}`;

    // 🔥 使用 BlockchainConfig 获取区块链显示名称和 logo
    const blockchain = experiment.blockchain || 'unknown';
    const blockchainDisplay = this.getBlockchainDisplay(blockchain);
    if (blockchainEl) {
      blockchainEl.innerHTML = `
        <img src="/static/${blockchain.toLowerCase()}-logo.png" alt="${blockchainDisplay}" class="w-4 h-4 inline-block rounded-full" onerror="this.style.display='none'">
        ${blockchainDisplay}
      `;
    }

    // 更新页面标题
    document.title = `交易记录 - ${name} - 2025-2026 Become Rich Baby!`;

    console.log('✅ 实验头部信息已更新');
  }

  /**
   * 🔥 从交易数据中提取有交易的代币列表
   */
  extractTokensFromExperiment() {
    try {
      console.log('🔄 从交易数据中提取代币列表...');

      // 从已加载的交易数据中提取代币，统计交易数量
      const tokenTradeCounts = new Map();

      if (this.tradesData && this.tradesData.length > 0) {
        this.tradesData.forEach(trade => {
          const address = trade.token_address || trade.tokenAddress;
          const symbol = trade.token_symbol || trade.symbol || 'Unknown';

          if (!tokenTradeCounts.has(address)) {
            tokenTradeCounts.set(address, {
              address: address,
              symbol: symbol,
              tradeCount: 0
            });
          }

          tokenTradeCounts.get(address).tradeCount++;
        });
      }

      this.availableTokens = Array.from(tokenTradeCounts.values());
      console.log(`📊 从 ${this.tradesData.length} 条交易中提取到 ${this.availableTokens.length} 个有交易的代币`);

      // 填充代币选择器
      this.populateTokenSelector();

    } catch (error) {
      console.error('❌ 提取代币列表失败:', error);
      this.availableTokens = [];
      // 即使失败也要尝试填充选择器
      this.populateTokenSelector();
    }
  }

  /**
   * 🔥 填充代币选择器
   */
  populateTokenSelector() {
    const selector = document.getElementById('token-selector');
    if (!selector) {
      console.warn('⚠️ 找不到代币选择器元素');
      return;
    }

    // 清空现有选项和事件监听器（克隆节点以移除监听器）
    const newSelector = selector.cloneNode(false);
    selector.parentNode.replaceChild(newSelector, selector);

    // 重新获取引用
    const freshSelector = document.getElementById('token-selector');

    // 清空现有选项
    freshSelector.innerHTML = '<option value="all">全部代币</option>';

    // 按交易数量降序排序（交易多的在前）
    const sortedTokens = [...this.availableTokens].sort((a, b) => {
      return (b.tradeCount || 0) - (a.tradeCount || 0);
    });

    // 添加代币选项，显示交易数量
    sortedTokens.forEach(token => {
      const option = document.createElement('option');
      option.value = token.address;
      const tradeCount = token.tradeCount || 0;
      option.textContent = `${token.symbol} (${tradeCount} 笔交易)`;
      freshSelector.appendChild(option);
    });

    // 如果没有代币，禁用选择器
    if (this.availableTokens.length === 0) {
      freshSelector.disabled = true;
      console.log('⚠️ 没有可用代币，禁用代币选择器');
    }

    // 绑定事件
    freshSelector.addEventListener('change', async (e) => {
      const selectedTokenAddress = e.target.value;
      this.selectedToken = selectedTokenAddress;
      console.log('🔄 选择代币:', this.selectedToken);

      // 如果选择了具体代币（不是'all'），重新加载对应的K线图
      if (selectedTokenAddress !== 'all') {
        const selectedToken = this.availableTokens.find(t => t.address === selectedTokenAddress);
        if (selectedToken) {
          await this.loadKlineForToken(selectedToken);
        }
      }

      // 过滤并渲染交易记录
      this.filterAndRenderTrades();
    });

    console.log('✅ 代币选择器已填充，代币数量:', this.availableTokens.length);
  }

  /**
   * 获取状态显示文本
   */
  getStatusText(status) {
    const statusMap = {
      'monitoring': '监控中',
      'bought': '已买入',
      'exited': '已退出'
    };
    return statusMap[status] || status;
  }

  /**
   * 🔥 根据选择的代币过滤并重新渲染交易
   */
  filterAndRenderTrades() {
    const filteredTrades = this.selectedToken === 'all'
      ? this.tradesData
      : this.tradesData.filter(t => t.token_address === this.selectedToken);

    console.log(`🔍 过滤后的交易数量: ${filteredTrades.length} (全部: ${this.tradesData.length})`);

    // 更新代币信息显示
    const tokenInfo = document.getElementById('token-info');
    if (tokenInfo) {
      if (this.selectedToken === 'all') {
        tokenInfo.textContent = '显示所有代币的K线图和交易汇总';
      } else {
        const token = this.availableTokens.find(t => t.address === this.selectedToken);
        if (token) {
          tokenInfo.textContent = `正在查看 ${token.symbol} 的K线图和交易记录`;
        }
      }
    }

    // 更新交易列表
    this.renderTradeCards(filteredTrades);

    // 更新统计信息
    this.renderTradeStats(filteredTrades);

    // 重置分页
    this.currentPage = 1;
    this.setupPagination();
  }

  /**
   * 加载交易数据
   */
  async loadTradesData() {
    try {
      console.log('💱 正在获取交易数据...');
      console.log(`📍 API URL: /api/experiment/${this.experimentId}/trades?limit=10000`);

      const response = await fetch(`/api/experiment/${this.experimentId}/trades?limit=10000`);
      console.log(`📡 API响应状态: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('📦 API响应数据:', result);

      this.tradesData = result.data || result.trades || [];
      console.log(`✅ 交易数据加载完成: ${this.tradesData.length} 条记录`);

      if (this.tradesData.length > 0) {
        console.log('📋 第一条交易数据示例:', JSON.stringify(this.tradesData[0], null, 2).substring(0, 300) + '...');
      }

    } catch (error) {
      console.error('❌ 加载交易数据失败:', error);
      console.error('❌ 错误堆栈:', error.stack);
      throw error;
    }
  }

  /**
   * 获取筛选后的交易数据
   */
  getFilteredTrades() {
    let filteredTrades = [...this.tradesData];

    // 应用筛选条件
    if (this.currentFilters.direction !== 'all') {
      const direction = this.currentFilters.direction.toLowerCase();
      filteredTrades = filteredTrades.filter(trade =>
        (trade.direction || trade.trade_direction || trade.action || trade.trade_type || '').toLowerCase() === direction ||
        (trade.direction || trade.trade_direction || trade.action || trade.trade_type || '') === direction.toUpperCase()
      );
    }

    if (this.currentFilters.success !== 'all') {
      const isSuccess = this.currentFilters.success === 'true';
      filteredTrades = filteredTrades.filter(trade =>
        (trade.status === 'success' || trade.trade_status === 'completed') === isSuccess
      );
    }

    if (this.currentFilters.symbol !== 'all') {
      filteredTrades = filteredTrades.filter(trade =>
        (trade.token_symbol || trade.symbol || '') === this.currentFilters.symbol
      );
    }

    // 应用排序（默认按时间倒序）
    filteredTrades.sort((a, b) => new Date(b.created_at || b.executed_at || 0) - new Date(a.created_at || a.executed_at || 0));

    // 限制数量
    if (this.currentFilters.limit && this.currentFilters.limit > 0) {
      filteredTrades = filteredTrades.slice(0, this.currentFilters.limit);
    }

    return filteredTrades;
  }

  /**
   * 渲染交易统计信息
   * @param {Array} trades - 要统计的交易数组（可选，默认使用所有交易）
   */
  renderTradeStats(trades = null) {
    // 如果没有传入参数，使用所有交易
    const tradesToCount = trades !== null ? trades : this.tradesData;

    const totalTradesElement = document.getElementById('total-trades');
    const successfulTradesElement = document.getElementById('successful-trades');
    const failedTradesElement = document.getElementById('failed-trades');
    const buyTradesElement = document.getElementById('stat-buy-trades');
    const sellTradesElement = document.getElementById('stat-sell-trades');
    const winRateElement = document.getElementById('win-rate');

    if (!tradesToCount.length) {
      if (totalTradesElement) totalTradesElement.textContent = '0';
      if (successfulTradesElement) successfulTradesElement.textContent = '0';
      if (failedTradesElement) failedTradesElement.textContent = '0';
      if (buyTradesElement) buyTradesElement.textContent = '0';
      if (sellTradesElement) sellTradesElement.textContent = '0';
      if (winRateElement) winRateElement.textContent = '0%';
      return;
    }

    const totalTrades = tradesToCount.length;
    const successfulTrades = tradesToCount.filter(trade => trade.status === 'success' || trade.trade_status === 'completed').length;
    const failedTrades = tradesToCount.filter(trade => trade.status !== 'success' && trade.trade_status !== 'completed').length;
    const buyTrades = tradesToCount.filter(trade =>
      (trade.direction || trade.trade_direction || trade.action || trade.trade_type || '').toLowerCase() === 'buy'
    ).length;
    const sellTrades = tradesToCount.filter(trade =>
      (trade.direction || trade.trade_direction || trade.action || trade.trade_type || '').toLowerCase() === 'sell'
    ).length;
    const totalVolume = tradesToCount.reduce((sum, trade) =>
      sum + parseFloat(trade.amount || trade.output_amount || trade.amount_native || 0), 0
    );
    const avgTradeSize = totalVolume / totalTrades;
    const successRate = totalTrades > 0 ? (successfulTrades / totalTrades * 100).toFixed(1) + '%' : '0%';

    console.log(`📊 更新统计信息: 总交易${totalTrades}, 成功${successfulTrades}, 失败${failedTrades}, 买入${buyTrades}, 卖出${sellTrades}, 成功率${successRate}, 总量${totalVolume.toFixed(2)}`);

    if (totalTradesElement) totalTradesElement.textContent = totalTrades.toString();
    if (successfulTradesElement) successfulTradesElement.textContent = successfulTrades.toString();
    if (failedTradesElement) failedTradesElement.textContent = failedTrades.toString();
    if (buyTradesElement) buyTradesElement.textContent = buyTrades.toString();
    if (sellTradesElement) sellTradesElement.textContent = sellTrades.toString();
    if (winRateElement) winRateElement.textContent = successRate;

    // 调试：输出统计信息
    console.log('🔍 交易统计调试:', {
      总数: totalTrades,
      成功: successfulTrades,
      失败: failedTrades,
      买入: buyTrades,
      卖出: sellTrades,
      成功率: successRate,
      数据样本: tradesToCount.slice(0, 3).map(t => ({
        success: t.success,
        trade_status: t.trade_status,
        trade_direction: t.trade_direction
      }))
    });
  }

  /**
   * 渲染交易卡片
   * @param {Array} trades - 要渲染的交易数组（可选，默认使用所有交易）
   */
  renderTradeCards(trades = null) {
    const container = document.getElementById('trades-container');
    const emptyState = document.getElementById('empty-state');

    if (!container) return;

    // 如果没有传入参数，使用所有交易并应用筛选
    const tradesToRender = trades !== null ? trades : this.getFilteredTrades();

    if (tradesToRender.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    // 计算当前页的交易数据
    const startIndex = (this.currentPage - 1) * this.tradesPerPage;
    const endIndex = startIndex + this.tradesPerPage;
    const currentTrades = tradesToRender.slice(startIndex, endIndex);

    container.innerHTML = currentTrades.map(trade => this.renderTradeCard(trade)).join('');
  }

  /**
   * 渲染单个交易卡片
   */
  renderTradeCard(trade) {
    const action = trade.trade_direction || trade.direction || 'unknown';
    const isBuy = action === 'buy' || action === 'BUY';
    const status = trade.trade_status || trade.status || 'unknown';
    const isCompleted = status === 'success' || status === 'completed';

    const actionClass = isBuy ? 'bg-green-500' : 'bg-red-500';
    const actionText = isBuy ? '买入' : '卖出';
    const statusClass = isCompleted ? 'bg-green-600' : 'bg-yellow-600';
    const statusText = isCompleted ? '已完成' : '进行中';

    // 使用新的 input/output 字段
    const inputCurrency = trade.input_currency || 'BNB';
    const outputCurrency = trade.output_currency || 'Token';
    const inputAmount = parseFloat(trade.input_amount || 0);
    const outputAmount = parseFloat(trade.output_amount || 0);
    const unitPrice = parseFloat(trade.unit_price || 0);

    const time = trade.executed_at || trade.created_at ? new Date(trade.executed_at || trade.created_at).toLocaleString('zh-CN') : '--';
    const token = trade.token_symbol || trade.symbol || 'Unknown';

    // Gas费用计算
    const gasFee = (trade.gas_used && trade.gas_price)
      ? parseFloat(trade.gas_used) * parseFloat(trade.gas_price) / 1e9
      : 0;

    return `
      <div class="trade-card bg-gray-800 rounded-lg p-6 hover:bg-gray-700 transition-colors" data-trade-id="${trade.id}">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center space-x-3">
            <div class="${actionClass} w-12 h-12 rounded-full flex items-center justify-center">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="${isBuy ? 'M7 16l4-4m0 0l4-4m-4 4H18M6 4h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z' : 'M17 8l4 4m0 0l-4 4m4-4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1'}"/>
              </svg>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white">${actionText} ${token}</h3>
              <p class="text-gray-400 text-sm">${time}</p>
            </div>
          </div>
          <span class="px-3 py-1 rounded-full text-xs font-medium ${statusClass} text-white">
            ${statusText}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-gray-400 text-sm">输入数量</p>
            <p class="text-white font-medium">${inputAmount > 0 ? inputAmount.toFixed(6) : '0.000000'} ${inputCurrency}</p>
          </div>
          <div>
            <p class="text-gray-400 text-sm">输出数量</p>
            <p class="text-white font-medium">${outputAmount > 0 ? outputAmount.toFixed(4) : '0.0000'} ${outputCurrency}</p>
          </div>
          <div>
            <p class="text-gray-400 text-sm">单价</p>
            <p class="text-white font-medium">${unitPrice > 0 ? unitPrice.toFixed(8) : '0.00000000'}</p>
          </div>
          <div>
            <p class="text-gray-400 text-sm">Gas费用</p>
            <p class="text-white font-medium">${gasFee > 0 ? gasFee.toFixed(6) : '0.000000'} BNB</p>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 设置分页
   */
  setupPagination() {
    const pagination = document.getElementById('pagination');
    const prevPage = document.getElementById('prev-page');
    const nextPage = document.getElementById('next-page');
    const currentPageNum = document.getElementById('current-page-num');
    const showingStart = document.getElementById('showing-start');
    const showingEnd = document.getElementById('showing-end');
    const totalTradesElement = document.getElementById('pagination-total-trades');

    if (!pagination) return;

    const filteredTrades = this.getFilteredTrades();
    const totalPages = Math.ceil(filteredTrades.length / this.tradesPerPage);

    if (totalPages <= 1) {
      pagination.classList.add('hidden');
      return;
    }

    pagination.classList.remove('hidden');

    // 更新分页按钮状态
    if (prevPage) {
      prevPage.disabled = this.currentPage === 1;
    }
    if (nextPage) {
      nextPage.disabled = this.currentPage === totalPages;
    }

    // 更新页码显示
    if (currentPageNum) {
      currentPageNum.textContent = this.currentPage.toString();
    }

    // 更新显示范围
    const start = (this.currentPage - 1) * this.tradesPerPage + 1;
    const end = Math.min(this.currentPage * this.tradesPerPage, filteredTrades.length);

    if (showingStart) showingStart.textContent = start.toString();
    if (showingEnd) showingEnd.textContent = end.toString();
    if (totalTradesElement) totalTradesElement.textContent = filteredTrades.length.toString();
  }

  /**
   * 显示交易详情
   */
  showTradeDetail(tradeId) {
    const trade = this.tradesData.find(t => t.id === tradeId);
    if (!trade) return;

    const modal = document.getElementById('trade-detail-modal');
    const content = document.getElementById('trade-detail-content');

    if (!modal || !content) return;

    // 从metadata中提取详细信息
    let metadata = {};
    try {
      metadata = trade.metadata ? JSON.parse(trade.metadata) : {};
    } catch (e) {
      console.warn('解析交易metadata失败:', e);
    }

    content.innerHTML = `
      <div class="space-y-6">
        <!-- 基本信息 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-gray-400 text-sm">交易ID</p>
            <p class="text-white font-medium">${trade.id}</p>
          </div>
          <div>
            <p class="text-gray-400 text-sm">交易状态</p>
            <p class="text-white font-medium">${trade.status || trade.trade_status || 'unknown'}</p>
          </div>
          <div>
            <p class="text-gray-400 text-sm">交易类型</p>
            <p class="text-white font-medium">${trade.direction || trade.trade_direction || trade.action || trade.trade_type || 'unknown'}</p>
          </div>
          <div>
            <p class="text-gray-400 text-sm">执行时间</p>
            <p class="text-white font-medium">${trade.created_at || trade.executed_at ? new Date(trade.created_at || trade.executed_at).toLocaleString('zh-CN') : '--'}</p>
          </div>
        </div>

        <!-- 代币信息 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-gray-400 text-sm">代币符号</p>
            <p class="text-white font-medium">${trade.token_symbol || trade.symbol || 'Unknown'}</p>
          </div>
          <div>
            <p class="text-gray-400 text-sm">代币地址</p>
            <p class="text-white font-medium font-mono text-xs">${trade.token_address || '--'}</p>
          </div>
        </div>

        <!-- 交易详情 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-gray-400 text-sm">交易数量</p>
            <p class="text-white font-medium">${parseFloat(trade.amount || trade.input_amount || trade.token_amount || 0).toFixed(6)}</p>
          </div>
          <div>
            <p class="text-gray-400 text-sm">交易价格</p>
            <p class="text-white font-medium">${parseFloat(trade.price || trade.unit_price || trade.price_native || 0).toFixed(6)} BNB</p>
          </div>
          <div>
            <p class="text-gray-400 text-sm">交易金额</p>
            <p class="text-white font-medium">${parseFloat(trade.amount || trade.output_amount || trade.amount_native || 0).toFixed(4)} BNB</p>
          </div>
          <div>
            <p class="text-gray-400 text-sm">Gas费用</p>
            <p class="text-white font-medium">${(trade.gas_used && trade.gas_price ? parseFloat(trade.gas_used) * parseFloat(trade.gas_price) / 1e9 : parseFloat(trade.gas_fee_native || 0)).toFixed(6)} BNB</p>
          </div>
        </div>

        <!-- 区块链信息 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-gray-400 text-sm">交易哈希</p>
            <p class="text-white font-medium font-mono text-xs">${trade.tx_hash || trade.transaction_hash || '--'}</p>
          </div>
          <div>
            <p class="text-gray-400 text-sm">区块号</p>
            <p class="text-white font-medium">${trade.block_number || '--'}</p>
          </div>
        </div>

        <!-- 元数据信息 -->
        ${Object.keys(metadata).length > 0 ? `
          <div>
            <p class="text-gray-400 text-sm mb-2">额外信息</p>
            <div class="bg-gray-800 rounded p-3">
              <pre class="text-xs text-gray-300 whitespace-pre-wrap">${JSON.stringify(metadata, null, 2)}</pre>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    modal.classList.remove('hidden');
  }

  /**
   * 隐藏交易详情
   */
  hideTradeDetail() {
    const modal = document.getElementById('trade-detail-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  /**
   * 隐藏加载指示器
   */
  hideLoading() {
    const loading = document.getElementById('loading');

    if (loading) {
      loading.classList.add('hidden');
      console.log('✅ 加载指示器已隐藏');
    }

    // 确保实验头部和其他主要内容可见 - 参考信号页面的实现方式
    const experimentHeader = document.getElementById('experiment-header');
    if (experimentHeader) {
      experimentHeader.classList.remove('hidden');
      console.log('✅ 实验头部已显示');
    }

    // 确保主要内容区域可见 - 参考信号页面的 signals-content
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.classList.remove('hidden');
      console.log('✅ 主内容区域已显示');
    }

    // 关键修复：显示交易内容区域
    const tradesContent = document.getElementById('trades-content');
    if (tradesContent) {
      tradesContent.classList.remove('hidden');
      console.log('✅ 交易内容区域已显示');
    } else {
      console.log('⚠️ 未找到trades-content元素');
    }
  }

  /**
   * 加载K线数据并初始化图表
   */
  async loadKlineDataAndInitChart(tokenId = null) {
    try {
      console.log('📈 开始加载K线数据...');

      const url = tokenId
        ? `/api/experiment/${this.experimentId}/kline?source=trades&tokenId=${encodeURIComponent(tokenId)}`
        : `/api/experiment/${this.experimentId}/kline?source=trades`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('✅ K线数据加载完成:', result);

      if (result.kline_data && result.kline_data.length > 0) {
        this.klineData = result.kline_data;
        console.log('🎯 准备初始化K线图，数据:', {
          kline_count: result.kline_data.length,
          trades_count: this.tradesData.length,
          interval: result.interval_minutes
        });

        // 更新图表配置信息
        this.updateTradeChartConfig(result);

        // 初始化K线图
        this.initTradeKlineChart(result);
      } else {
        console.warn('⚠️ 没有K线数据');
        // 即使没有K线数据也要更新配置信息
        this.updateTradeChartConfig(result);
      }

    } catch (error) {
      console.error('❌ 加载K线数据失败:', error);
      // 不抛出错误，允许页面在没有K线图的情况下继续工作
    }
  }

  /**
   * 🔥 加载特定代币的时序数据（替代K线数据）
   * @param {Object} token - 代币对象 { address, symbol, priority }
   */
  async loadKlineForToken(token) {
    try {
      console.log(`🔄 加载代币 ${token.symbol} (${token.address}) 的时序数据...`);

      // 显示加载状态
      const chartStatus = document.getElementById('trade-chart-status');
      if (chartStatus) {
        chartStatus.textContent = '加载中...';
        chartStatus.className = 'px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium';
      }

      // 获取时序数据（替代K线数据）
      const timeSeriesData = await this.fetchTimeSeriesData(token.address);

      if (!timeSeriesData || timeSeriesData.length === 0) {
        // 显示友好提示
        if (chartStatus) {
          chartStatus.textContent = '暂无时序数据';
          chartStatus.className = 'px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium';
        }
        // 隐藏图表容器
        const chartContainer = document.getElementById('trade-chart-container');
        if (chartContainer) {
          chartContainer.style.display = 'none';
        }
        return;
      }

      // 显示图表容器
      const chartContainer = document.getElementById('trade-chart-container');
      if (chartContainer) {
        chartContainer.style.display = 'block';
      }

      // 初始化价格折线图并标记交易
      this.initPriceLineChart(timeSeriesData, token);

      console.log(`✅ 代币 ${token.symbol} 的时序数据图表加载完成`);

      // 更新状态
      if (chartStatus) {
        chartStatus.textContent = '数据就绪';
        chartStatus.className = 'px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium';
      }

    } catch (error) {
      console.error(`❌ 加载代币 ${token.symbol} 的时序数据失败:`, error);

      // 更新状态
      const chartStatus = document.getElementById('trade-chart-status');
      if (chartStatus) {
        chartStatus.textContent = '加载失败';
        chartStatus.className = 'px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium';
      }
    }
  }

  /**
   * 获取特定代币的时序数据
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Array>} 时序数据数组
   */
  async fetchTimeSeriesData(tokenAddress) {
    try {
      const params = new URLSearchParams({
        experimentId: this.experimentId,
        tokenAddress: tokenAddress
      });

      const response = await fetch(`/api/experiment/time-series/data?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return result.data || [];
    } catch (error) {
      console.error('❌ 获取时序数据失败:', error);
      return [];
    }
  }

  /**
   * 初始化价格折线图（使用时序数据，标记交易）
   * @param {Array} timeSeriesData - 时序数据
   * @param {Object} token - 代币对象
   */
  initPriceLineChart(timeSeriesData, token) {
    const canvas = document.getElementById('trade-kline-chart');
    if (!canvas) return;

    // 销毁旧图表
    if (this.chart) {
      this.chart.destroy();
    }

    const ctx = canvas.getContext('2d');

    // 准备数据
    const labels = timeSeriesData.map(d => new Date(d.timestamp));
    const prices = timeSeriesData.map(d => d.price_usd ? parseFloat(d.price_usd) : null);

    // 准备交易标记点
    const tradeAnnotations = [];
    const tokenTrades = this.tradesData.filter(t =>
      (t.token_address || t.tokenAddress) === token.address
    );

    tokenTrades.forEach(trade => {
      const tradeTime = new Date(trade.timestamp || trade.created_at || trade.executed_at);
      const direction = trade.direction || 'buy';
      const isBuy = direction === 'buy';

      // 找到最接近的数据点
      const closestIndex = labels.findIndex(label => Math.abs(label - tradeTime) < 30000); // 30秒内
      if (closestIndex >= 0 && prices[closestIndex] !== null) {
        tradeAnnotations.push({
          type: 'line',
          xMin: tradeTime,
          xMax: tradeTime,
          yMin: 0,
          yMax: 'max',
          borderColor: isBuy ? '#52c41a' : '#ff4d4f',
          borderWidth: 2,
          borderDash: [5, 5],
          label: {
            display: true,
            content: isBuy ? '买入' : '卖出',
            position: 'start',
            backgroundColor: isBuy ? '#52c41a' : '#ff4d4f',
            color: '#fff',
            font: {
              size: 11
            }
          }
        });
      }
    });

    // 创建图表
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: `${token.symbol} 价格 (USDT)`,
          data: prices,
          borderColor: '#1890ff',
          backgroundColor: 'rgba(24, 144, 255, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          annotation: {
            annotations: tradeAnnotations
          },
          legend: {
            display: true,
            position: 'top'
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed.y;
                if (value !== null) {
                  return `价格: $${value.toExponential(4)}`;
                }
                return '价格: N/A';
              }
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: {
              displayFormats: {
                minute: 'HH:mm',
                hour: 'MM-dd HH:mm'
              }
            },
            title: {
              display: true,
              text: '时间'
            }
          },
          y: {
            type: 'linear',
            display: true,
            title: {
              display: true,
              text: '价格 (USDT)'
            }
          }
        }
      }
    });

    console.log(`📊 价格折线图已初始化，包含 ${timeSeriesData.length} 个数据点和 ${tradeAnnotations.length} 个交易标记`);
  }

  /**
   * 更新交易图表配置信息
   */
  updateTradeChartConfig(klineResponse) {
    const tokenSymbol = klineResponse.token?.symbol || 'HJM';
    const interval = klineResponse.interval_minutes || 15;
    const timeRange = klineResponse.time_range || { start_date: '2025-11-23', end_date: '2025-11-24' };

    document.getElementById('trade-chart-token-symbol').textContent = tokenSymbol;
    document.getElementById('trade-chart-interval').textContent = `${interval}分钟`;
    document.getElementById('trade-chart-time-range').textContent = `${timeRange.start_date} 至 ${timeRange.end_date}`;

    console.log(`📊 交易图表配置更新: ${tokenSymbol}, ${interval}分钟, ${timeRange.start_date} 到 ${timeRange.end_date}`);
  }

  /**
   * 初始化交易K线图
   */
  initTradeKlineChart(klineResponse) {
    console.log('🚀 开始初始化交易K线图...', klineResponse);

    // 检查Chart.js是否已加载
    if (typeof Chart === 'undefined') {
      console.error('❌ Chart.js 未加载，无法创建图表');
      return;
    }

    const canvas = document.getElementById('trade-kline-chart');
    if (!canvas) {
      console.error('❌ 找不到交易K线图画布元素');
      return;
    }

    const ctx = canvas.getContext('2d');

    // 如果图表已存在，先销毁
    if (this.chart) {
      try {
        this.chart.destroy();
        this.chart = null;
        console.log('🗑️ 已销毁现有图表');
      } catch (error) {
        console.warn('销毁图表实例时出错:', error);
      }
    }

    // 确保canvas完全清空
    canvas.width = canvas.width;
    canvas.height = canvas.height;

    // 准备交易量数据点 - 根据K线涨跌着色
    const volumeDataPoints = this.klineData.map(kline => {
      const isUp = parseFloat(kline.close_price) >= parseFloat(kline.open_price);
      return {
        x: parseInt(kline.timestamp) * 1000,
        y: parseFloat(kline.volume || 0),
        backgroundColor: isUp ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)',
        borderColor: isUp ? 'rgba(16, 185, 129, 0.8)' : 'rgba(239, 68, 68, 0.8)'
      };
    });

    // 准备K线数据
    const candlestickData = this.klineData.map(kline => {
      const timestamp = parseInt(kline.timestamp) * 1000; // 转换为毫秒
      return [
        timestamp,
        parseFloat(kline.open_price),
        parseFloat(kline.high_price),
        parseFloat(kline.low_price),
        parseFloat(kline.close_price)
      ];
    });

    // 将数据转换为Chart.js需要的格式
    const chartData = candlestickData.map(item => ({
      x: item[0],
      o: item[1],
      h: item[2],
      l: item[3],
      c: item[4]
    }));

    // 准备交易标记 - 适配交易数据
    const tradeAnnotations = {};
    this.tradesData.forEach((trade, index) => {
      // 找到最接近的K线时间点
      const tradeTime = new Date(trade.created_at || trade.executed_at).getTime();
      const closestKline = candlestickData.find(kline =>
        Math.abs(kline[0] - tradeTime) < (klineResponse.interval_minutes * 60 * 1000) // 一个K线间隔内
      );

      if (closestKline) {
        const isBuy = (trade.direction === 'buy' || trade.direction === 'BUY' || trade.trade_direction === 'buy' || trade.trade_direction === 'BUY' || trade.action === 'buy' || trade.trade_type === 'buy');
        tradeAnnotations[`trade_${index}`] = {
          type: 'point',
          xValue: closestKline[0],
          yValue: isBuy ? closestKline[4] : closestKline[4], // 收盘价
          backgroundColor: isBuy ? '#10b981' : '#ef4444',
          borderColor: '#ffffff',
          borderWidth: 2,
          radius: 8,
          label: {
            display: true,
            content: isBuy ? '买' : '卖',
            position: isBuy ? 'bottom' : 'top',
            backgroundColor: isBuy ? '#10b981' : '#ef4444',
            color: '#ffffff',
            font: {
              size: 10,
              weight: 'bold'
            },
            padding: 2
          }
        };
      }
    });

    try {
      console.log('📊 创建交易K线图表...');
      console.log('📈 K线数据点数:', chartData.length);
      console.log('🎯 交易标记数:', Object.keys(tradeAnnotations).length);

      // 🔧 创建图表对齐插件
      const alignmentPlugin = {
        id: 'chartAlignment',
        afterLayout: function(chart) {
          // 保存图表实例，用于相互对齐
          if (!chart._alignmentPartner) {
            if (chart.config.type === 'candlestick') {
              // 这是K线图
              window._klineChartInstance = chart;
            } else {
              // 这是交易量图
              window._volumeChartInstance = chart;
            }

            // 如果两个图表都已创建，进行对齐
            if (window._klineChartInstance && window._volumeChartInstance) {
              const klineChart = window._klineChartInstance;
              const volumeChart = window._volumeChartInstance;

              // 只在K线图上执行对齐逻辑
              if (chart.config.type === 'candlestick') {
                const klineArea = klineChart.chartArea;
                const volumeArea = volumeChart.chartArea;

                // 使用K线图的左右边距作为标准
                const targetLeft = klineArea.left;
                const targetRight = klineChart.width - klineArea.right;

                // 更新交易量图的 chartArea
                volumeChart.chartArea = {
                  top: volumeArea.top,
                  left: targetLeft,
                  right: volumeChart.width - targetRight,
                  bottom: volumeArea.bottom
                };
              }
            }
          }
        }
      };

      // 使用成功项目的图表配置
      const config = {
        type: 'candlestick',
        data: {
          datasets: [{
            label: `${klineResponse.token?.symbol || '代币'} (${klineResponse.interval_minutes}分钟)`,
            data: chartData,
            borderColor: {
              up: '#10b981',
              down: '#ef4444',
              unchanged: '#6b7280'
            },
            backgroundColor: {
              up: 'rgba(16, 185, 129, 0.1)',
              down: 'rgba(239, 68, 68, 0.1)',
              unchanged: 'rgba(107, 114, 128, 0.1)'
            }
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              left: 10,
              right: 10,
              top: 10,
              bottom: 0
            }
          },
          scales: {
            x: {
              type: 'time',
              time: {
                unit: this.getTimeUnit(klineResponse.interval_minutes),
                displayFormats: {
                  minute: 'MM-dd HH:mm',
                  hour: 'MM-dd HH:mm',
                  day: 'MM-dd'
                }
              },
              grid: {
                color: 'rgba(156, 163, 175, 0.2)'
              },
              ticks: {
                color: '#9ca3af',
                font: {
                  family: "'Inter', 'Roboto', 'Helvetica', 'Arial', sans-serif",
                  size: 11
                },
                maxRotation: 0,
                autoSkipPadding: 20
              }
            },
            y: {
              position: 'right',
              grid: {
                color: 'rgba(156, 163, 175, 0.2)'
              },
              ticks: {
                color: '#9ca3af',
                font: {
                  family: "'Inter', 'Roboto', 'Helvetica', 'Arial', sans-serif",
                  size: 11
                },
                padding: 10,
                callback: function(value) {
                  return value.toFixed(4);
                }
              }
            }
          },
          plugins: {
            legend: {
              display: true,
              labels: {
                color: '#374151',
                font: {
                  size: 12
                }
              }
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                title: function(context) {
                  const date = new Date(context[0].parsed.x);
                  return date.toLocaleString('zh-CN');
                },
                label: function(context) {
                  const data = context.raw;
                  return [
                    `开盘: ${data.o.toFixed(4)}`,
                    `最高: ${data.h.toFixed(4)}`,
                    `最低: ${data.l.toFixed(4)}`,
                    `收盘: ${data.c.toFixed(4)}`
                  ];
                }
              }
            },
            annotation: {
              annotations: tradeAnnotations
            },
            // 🔧 注册对齐插件
            alignment: alignmentPlugin
          }
        }
      };

      this.chart = new Chart(ctx, config);
      console.log(`✅ 交易K线图初始化完成，${chartData.length}个数据点，${Object.keys(tradeAnnotations).length}个交易标记`);

      // 创建交易量图，传递对齐插件
      this.createTradeVolumeChart(volumeDataPoints, klineResponse, alignmentPlugin);

    } catch (error) {
      console.error('❌ 创建交易K线图失败:', error);
      console.error('错误详情:', error.message);

      // 显示错误信息
      const chartContainer = canvas.parentElement;
      chartContainer.innerHTML = `
        <div class="flex items-center justify-center h-96 bg-gray-100 rounded-lg border border-gray-300">
          <div class="text-center">
            <div class="text-red-500 text-lg mb-2">⚠️ 图表加载失败</div>
            <div class="text-gray-600 text-sm">错误: ${error.message}</div>
            <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              刷新页面
            </button>
          </div>
        </div>
      `;

      return;
    }
  }

  /**
   * 创建交易量图
   */
  createTradeVolumeChart(volumeDataPoints, klineResponse, alignmentPlugin) {
    console.log('📊 开始创建独立的交易量图...');

    const volumeCanvas = document.getElementById('trade-volume-chart');
    if (!volumeCanvas) {
      console.error('❌ 找不到交易量图画布元素');
      return;
    }

    const volumeCtx = volumeCanvas.getContext('2d');

    // 如果交易量图已存在，先销毁
    if (this.volumeChart) {
      try {
        this.volumeChart.destroy();
        this.volumeChart = null;
        console.log('🗑️ 已销毁现有交易量图');
      } catch (error) {
        console.warn('销毁交易量图实例时出错:', error);
      }
    }

    try {
      // 准备交易量数据 - 颜色直接嵌入到数据点对象中
      const volumeChartData = volumeDataPoints.map(item => ({
        x: item.x,
        y: item.y,
        backgroundColor: item.backgroundColor
      }));

      // 创建交易量图
      this.volumeChart = new Chart(volumeCtx, {
        type: 'bar',
        data: {
          datasets: [{
            label: '交易量',
            data: volumeChartData,
            backgroundColor: volumeChartData.map(v => v.backgroundColor)
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              left: 10,
              right: 10,
              top: 0,
              bottom: 0
            }
          },
          scales: {
            x: {
              type: 'time',
              time: {
                unit: this.getTimeUnit(klineResponse.interval_minutes),
                displayFormats: {
                  minute: 'MM-dd HH:mm',
                  hour: 'MM-dd HH:mm',
                  day: 'MM-dd'
                }
              },
              grid: {
                color: 'rgba(156, 163, 175, 0.2)'
              },
              ticks: {
                color: '#9ca3af',
                font: {
                  family: "'Inter', 'Roboto', 'Helvetica', 'Arial', sans-serif",
                  size: 11
                },
                maxRotation: 0,
                autoSkipPadding: 20
              }
            },
            y: {
              position: 'right',
              grid: {
                color: 'rgba(156, 163, 175, 0.2)'
              },
              ticks: {
                color: '#9ca3af',
                font: {
                  family: "'Inter', 'Roboto', 'Helvetica', 'Arial', sans-serif",
                  size: 11
                },
                padding: 10,
                callback: function(value) {
                  if (value >= 1000000) {
                    return (value / 1000000).toFixed(1) + 'M';
                  } else if (value >= 1000) {
                    return (value / 1000).toFixed(1) + 'K';
                  }
                  return value.toFixed(0);
                }
              }
            }
          },
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                title: function(context) {
                  const date = new Date(context[0].parsed.x);
                  return date.toLocaleString('zh-CN');
                },
                label: function(context) {
                  const volume = context.parsed.y;
                  if (volume >= 1000000) {
                    return `交易量: ${(volume / 1000000).toFixed(2)}M`;
                  } else if (volume >= 1000) {
                    return `交易量: ${(volume / 1000).toFixed(2)}K`;
                  }
                  return `交易量: ${volume.toFixed(0)}`;
                }
              }
            },
            // 🔧 注册对齐插件
            alignment: alignmentPlugin
          }
        }
      });

      console.log('✅ 交易量图初始化完成');

    } catch (error) {
      console.error('❌ 创建交易量图失败:', error);
    }
  }

  /**
   * 获取时间单位
   */
  getTimeUnit(intervalMinutes) {
    if (intervalMinutes < 60) {
      return 'minute';
    } else if (intervalMinutes < 1440) {
      return 'hour';
    } else {
      return 'day';
    }
  }

  /**
   * 切换自动刷新
   */
  toggleAutoRefresh() {
    if (!this.autoRefreshEnabled) {
      // 启动自动刷新
      this.autoRefreshEnabled = true;
      this.autoRefreshInterval = setInterval(() => {
        this.loadTradesData();
        this.loadKlineDataAndInitChart();
        this.renderTradeStats();
        this.renderTradeCards();
        this.setupPagination();
      }, 30000); // 每30秒刷新一次

      const btn = document.getElementById('auto-refresh-btn');
      if (btn) {
        btn.textContent = '⏰ 自动刷新: 开启';
        btn.classList.remove('bg-gray-600');
        btn.classList.add('bg-green-600');
      }
    } else {
      // 停止自动刷新
      this.autoRefreshEnabled = false;
      if (this.autoRefreshInterval) {
        clearInterval(this.autoRefreshInterval);
        this.autoRefreshInterval = null;
      }

      const btn = document.getElementById('auto-refresh-btn');
      if (btn) {
        btn.textContent = '⏰ 自动刷新: 关闭';
        btn.classList.remove('bg-green-600');
        btn.classList.add('bg-gray-600');
      }
    }
  }

  /**
   * 应用筛选条件
   */
  applyFilters() {
    this.currentFilters.direction = document.getElementById('direction-filter')?.value || 'all';
    this.currentFilters.success = document.getElementById('success-filter')?.value || 'all';
    this.currentFilters.symbol = document.getElementById('symbol-filter')?.value || 'all';
    this.currentFilters.limit = parseInt(document.getElementById('limit')?.value || '50');

    this.currentPage = 1;
    this.renderTradeCards();
    this.setupPagination();
  }

  /**
   * 清除筛选条件
   */
  clearFilters() {
    this.currentFilters = {
      direction: 'all',
      success: 'all',
      symbol: 'all',
      limit: 50
    };

    // 重置表单
    const directionFilter = document.getElementById('direction-filter');
    const successFilter = document.getElementById('success-filter');
    const symbolFilter = document.getElementById('symbol-filter');
    const limitSelect = document.getElementById('limit');

    if (directionFilter) directionFilter.value = 'all';
    if (successFilter) successFilter.value = 'all';
    if (symbolFilter) symbolFilter.value = 'all';
    if (limitSelect) limitSelect.value = '50';

    this.currentPage = 1;
    this.renderTradeCards();
    this.setupPagination();
  }

  /**
   * 切换视图
   */
  switchView(viewType) {
    const cardsView = document.getElementById('trades-container');
    const tableView = document.getElementById('trades-table-view');
    const cardsBtn = document.getElementById('view-cards');
    const tableBtn = document.getElementById('view-table');

    if (viewType === 'cards') {
      cardsView.classList.remove('hidden');
      tableView.classList.add('hidden');
      cardsBtn.classList.remove('bg-gray-600');
      cardsBtn.classList.add('bg-blue-600');
      tableBtn.classList.remove('bg-blue-600');
      tableBtn.classList.add('bg-gray-600');
    } else {
      cardsView.classList.add('hidden');
      tableView.classList.remove('hidden');
      tableBtn.classList.remove('bg-gray-600');
      tableBtn.classList.add('bg-blue-600');
      cardsBtn.classList.remove('bg-blue-600');
      cardsBtn.classList.add('bg-gray-600');

      this.renderTradeTable();
    }
  }

  /**
   * 渲染交易表格
   */
  renderTradeTable() {
    const tableBody = document.getElementById('trades-table');
    if (!tableBody) return;

    const filteredTrades = this.getFilteredTrades();
    const startIndex = (this.currentPage - 1) * this.tradesPerPage;
    const endIndex = startIndex + this.tradesPerPage;
    const currentTrades = filteredTrades.slice(startIndex, endIndex);

    tableBody.innerHTML = currentTrades.map(trade => {
      const action = trade.direction || trade.trade_direction || trade.action || trade.trade_type || 'unknown';
      const isBuy = action === 'buy';
      const status = trade.status || trade.trade_status || 'unknown';
      const isCompleted = status === 'success' || status === 'completed';

      const time = trade.created_at || trade.executed_at ? new Date(trade.created_at || trade.executed_at).toLocaleString('zh-CN') : '--';
      const amount = parseFloat(trade.amount || trade.input_amount || trade.token_amount || 0);
      const price = parseFloat(trade.price || trade.unit_price || trade.price_native || 0);
      const total = parseFloat(trade.amount || trade.output_amount || trade.amount_native || 0);

      return `
        <tr class="hover:bg-gray-200">
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${time}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm">
            <span class="px-2 py-1 text-xs rounded-full ${isBuy ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}">
              ${isBuy ? '买入' : '卖出'}
            </span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${trade.token_symbol || trade.symbol || 'Unknown'}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${amount.toFixed(4)}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${price.toFixed(6)}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${total.toFixed(4)} BNB</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm">
            <span class="px-2 py-1 text-xs rounded-full ${isCompleted ? 'bg-green-600 text-white' : 'bg-yellow-600 text-white'}">
              ${isCompleted ? '成功' : '进行中'}
            </span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm">
            <span class="font-medium ${isBuy ? 'text-red-600' : 'text-green-600'}">
              ${isBuy ? '-' : '+'}${total.toFixed(4)}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }

  /**
   * 导出交易数据
   */
  exportTrades() {
    const filteredTrades = this.getFilteredTrades();
    if (filteredTrades.length === 0) {
      alert('暂无交易数据可导出');
      return;
    }

    // 准备导出数据
    const exportData = filteredTrades.map(trade => {
      const action = trade.direction || trade.trade_direction || trade.action || trade.trade_type || 'unknown';
      const isBuy = action === 'buy';
      const status = trade.status || trade.trade_status || 'unknown';
      const isCompleted = status === 'success' || status === 'completed';

      return {
        时间: trade.created_at || trade.executed_at ? new Date(trade.created_at || trade.executed_at).toLocaleString('zh-CN') : '--',
        方向: isBuy ? '买入' : '卖出',
        代币: trade.token_symbol || trade.symbol || 'Unknown',
        数量: parseFloat(trade.amount || trade.input_amount || trade.token_amount || 0).toFixed(6),
        单价: parseFloat(trade.price || trade.unit_price || trade.price_native || 0).toFixed(6),
        总价: parseFloat(trade.amount || trade.output_amount || trade.amount_native || 0).toFixed(4) + ' BNB',
        状态: isCompleted ? '成功' : '进行中',
        Gas费用: (trade.gas_used && trade.gas_price ? parseFloat(trade.gas_used) * parseFloat(trade.gas_price) / 1e9 : parseFloat(trade.gas_fee_native || 0)).toFixed(6) + ' BNB',
        交易哈希: trade.tx_hash || trade.transaction_hash || '--'
      };
    });

    // 转换为CSV
    const headers = Object.keys(exportData[0]);
    const csvContent = [
      headers.join(','),
      ...exportData.map(row => headers.map(header => `"${row[header]}"`).join(','))
    ].join('\n');

    // 下载CSV文件
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `交易记录_${this.experimentId}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();

    console.log('📥 交易数据导出完成');
  }

  /**
   * 显示错误信息
   */
  showError(message) {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.innerHTML = `
        <div class="text-center">
          <div class="mb-4">
            <svg class="w-16 h-16 text-red-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-red-400 mb-2">加载失败</h2>
          <p class="text-gray-300">${message}</p>
          <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium transition-colors">
            重新加载
          </button>
        </div>
      `;
    }
  }

  /**
   * 🔥 获取区块链显示名称
   * @param {string} blockchain - 区块链标识
   * @returns {string} 显示名称
   */
  getBlockchainDisplay(blockchain) {
    const blockchainMap = {
      'bsc': 'BSC',
      'bnb': 'BSC',
      'sol': 'Solana',
      'solana': 'Solana',
      'base': 'Base',
      'eth': 'Ethereum',
      'ethereum': 'Ethereum'
    };
    return blockchainMap[blockchain?.toLowerCase()] || blockchain || 'Unknown';
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  try {
    console.log('🚀 DOM加载完成，开始初始化交易记录页面...');
    window.experimentTrades = new ExperimentTrades();
  } catch (error) {
    console.error('❌ 初始化交易记录页面失败:', error);
  }
});