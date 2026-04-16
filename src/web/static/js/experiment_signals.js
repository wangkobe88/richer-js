/**
 * 交易信号页面JavaScript
 * 实现K线图展示和交易信号标记
 * Version: 4.0 - 添加拒绝信号标记和统计
 */

class ExperimentSignals {
  constructor() {
    this.experimentId = null;
    this.klineData = [];
    this.signals = [];  // 原始信号数据（所有代币）
    this.chart = null;
    this.holderChart = null;
    this.volumeChart = null;
    this.autoRefresh = true;
    this.refreshInterval = null;
    this.currentFilters = {
      action: 'all',
      limit: 10000  // 增加限制以获取所有信号
    };

    // 🔥 多代币支持
    this.selectedToken = 'all';  // 当前选择的代币，'all'表示全部
    this.availableTokens = [];   // 可用的代币列表

    // 🔥 区块链信息（用于生成GMGN链接）
    this.blockchain = 'bsc';  // 默认BSC

    // 🔥 回测模式支持
    this._isBacktest = false;    // 是否是回测实验
    this._sourceExperimentId = null;  // 源实验ID

    // 🔥 拒绝信号统计
    this.rejectionStats = null;
    this.showRejected = true;  // 默认显示被拒绝的信号

    // 🔥 实验配置（用于获取预检查条件）
    this.experimentConfig = null;

    this.init();
  }

  async init() {
    try {
      // 从URL获取实验ID
      const pathParts = window.location.pathname.split('/');
      this.experimentId = pathParts[pathParts.length - 2]; // 获取 /experiment/:id/signals 中的 :id

      if (!this.experimentId) {
        throw new Error('无法获取实验ID');
      }

      // 初始化事件监听器
      this.setupEventListeners();

      // 等待Chart.js加载完成
      await this.waitForChartJS();

      // 加载初始数据
      await this.loadData();

      // 隐藏加载指示器
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('signals-content').classList.remove('hidden');

    } catch (error) {
      console.error('页面初始化失败:', error);
      this.showError('页面初始化失败: ' + error.message);
    }
  }

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

    // console.log('✅ Chart.js已加载完成');
  }

  setupEventListeners() {
    // 辅助函数：安全绑定事件
    const safeBind = (id, event, handler) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener(event, handler);
      } else {
        console.warn(`⚠️ 元素 #${id} 不存在`);
      }
    };

    // 刷新按钮
    safeBind('refresh-btn', 'click', () => {
      this.loadData();
    });

    // 自动刷新切换
    safeBind('auto-refresh-btn', 'click', () => {
      this.toggleAutoRefresh();
    });

    // 筛选控件
    safeBind('apply-filters', 'click', () => {
      this.applyFilters();
    });

    // 显示/隐藏拒绝信号复选框
    safeBind('include-rejected', 'change', (e) => {
      this.showRejected = e.target.checked;
      this.applyFilters();
    });

    // 导出按钮（可能不存在）
    safeBind('export-signals', 'click', () => {
      this.exportSignals();
    });
  }

  async loadData() {
    try {
      // console.log('📊 loadData方法被调用 - 开始加载交易信号和K线数据...');

      // 先加载实验信息
      const experimentResponse = await this.fetchExperiment();
      // console.log('📋 实验信息加载完成');

      // 更新实验信息
      if (experimentResponse.data) {
        this.updateExperimentHeader(experimentResponse.data);

        // 🔥 如果是回测实验，异步获取源实验的区块链信息（用于生成GMGN链接）
        if (this._isBacktest && this._sourceExperimentId) {
          await this.fetchSourceExperimentInfo();
        }
      }

      // 🔥 先解析URL hash参数，自动选择代币（必须在fetchSignals之前）
      await this.parseHashToken();

      // 然后加载信号数据（fetchSignals 内部会自动使用源实验ID和tokenAddress过滤）
      const signalsResponse = await this.fetchSignals();
      console.log('📡 fetchSignals返回:', {
        success: signalsResponse.success,
        signalsCount: signalsResponse.signals?.length || 0,
        count: signalsResponse.count
      });

      // 更新信号数据（必须在 extractTokensFromExperiment 之前）
      this.signals = signalsResponse.signals || [];
      console.log('📊 已加载', this.signals.length, '条信号');
      console.log('📊 selectedToken:', this.selectedToken);

      // 🔥 从信号数据中提取代币列表并填充选择器
      this.extractTokensFromExperiment();

      // 🔥 如果URL中有token参数且找到了对应的代币，加载其时序图表
      if (this.selectedToken && this.selectedToken !== 'all') {
        const selectedToken = this.availableTokens.find(t => t.address.toLowerCase() === this.selectedToken.toLowerCase());
        if (selectedToken) {
          // 更新选择器的值
          const selector = document.getElementById('token-selector');
          if (selector) {
            selector.value = this.selectedToken;
            console.log('✅ 已自动选择代币:', this.selectedToken);
          }
          // 🔥 调用 filterAndRenderSignals 以显示代币地址信息
          this.filterAndRenderSignals();
          // 加载该代币的时序数据图表
          await this.loadKlineForToken(selectedToken);
        } else {
          console.warn('⚠️ URL中的代币不在信号列表中:', this.selectedToken);
          this.selectedToken = 'all'; // 重置为全部
        }
      }

      // 🔥 如果没有选择特定代币，也要调用 filterAndRenderSignals 来渲染所有信号
      if (this.selectedToken === 'all') {
        this.filterAndRenderSignals();
      }

      // 只有当没有选择特定代币时，才加载默认K线数据
      if (this.selectedToken === 'all') {
        // 尝试加载K线数据（不影响信号显示）
        try {
          console.log('📈 开始加载K线数据...');
          const klineResponse = await this.fetchKlineData();

          // 更新K线数据
          if (klineResponse.kline_data && klineResponse.kline_data.length > 0) {
            this.klineData = klineResponse.kline_data;
            console.log('🎯 准备初始化K线图，数据:', {
              kline_count: klineResponse.kline_data.length,
              signals_count: klineResponse.signals?.length || 0,
              interval: klineResponse.interval_minutes
            });

            // 初始化K线图
            this.initKlineChart(klineResponse);
          } else {
            console.warn('⚠️ 没有K线数据');
            this.showKlinePlaceholder('暂无K线数据');
          }
        } catch (klineError) {
          console.error('⚠️ K线数据加载失败（不影响信号显示）:', klineError);
          // 显示K线图占位符
          this.showKlinePlaceholder('暂无K线数据');
        }
      }

      // 根据 selectedToken 决定是否过滤数据
      const filteredSignals = this.selectedToken === 'all'
        ? this.signals
        : this.signals.filter(s => s.token_address === this.selectedToken);

      console.log('🔍 filteredSignals:', filteredSignals.length, 'selectedToken:', this.selectedToken);
      console.log('🔍 Sample signals:', filteredSignals.slice(0, 3).map(s => ({ action: s.action, symbol: s.symbol, token_address: s.token_address })));

      // 更新信号统计
      this.updateSignalsStats(filteredSignals);

      // 渲染信号列表
      this.renderSignals(filteredSignals);

      // 加载拒绝信号统计（不阻塞其他操作）
      this.loadRejectionStats();

      // console.log('✅ 数据加载完成');

    } catch (error) {
      console.error('❌ 数据加载失败:', error);
      this.showError('数据加载失败: ' + error.message);
    }
  }

  /**
   * 显示K线图占位符
   */
  showKlinePlaceholder(message) {
    const canvas = document.getElementById('kline-chart');
    if (!canvas) return;

    // 隐藏 canvas，显示占位符
    canvas.style.display = 'none';

    // 检查是否已有占位符元素
    let placeholder = document.getElementById('kline-chart-placeholder');
    if (!placeholder) {
      const container = canvas.parentElement;
      placeholder = document.createElement('div');
      placeholder.id = 'kline-chart-placeholder';
      placeholder.className = 'flex items-center justify-center h-full bg-gray-800 rounded-lg border border-gray-700';
      placeholder.style.minHeight = '450px';
      placeholder.innerHTML = `
        <div class="text-center">
          <div class="text-yellow-600 text-lg mb-2">📊</div>
          <div class="text-gray-400 text-sm">${message}</div>
        </div>
      `;
      container.appendChild(placeholder);
    } else {
      // 更新占位符消息
      placeholder.querySelector('.text-gray-400, .text-gray-600').textContent = message;
      placeholder.style.display = 'flex';
    }
  }

  async fetchExperiment() {
    const response = await fetch(`/api/experiment/${this.experimentId}`);
    if (!response.ok) {
      throw new Error('获取实验信息失败');
    }
    return await response.json();
  }

  async fetchSignals(experimentId = null) {
    // 🔥 始终使用当前实验的ID获取信号（回测实验显示自己的信号）
    const targetId = experimentId || this.experimentId;

    const params = new URLSearchParams({
      limit: this.currentFilters.limit
    });

    if (this.currentFilters.action !== 'all') {
      params.append('action', this.currentFilters.action);
    }

    // 🔥 如果选择了特定代币，传递tokenAddress参数进行服务端过滤
    if (this.selectedToken && this.selectedToken !== 'all') {
      params.append('tokenAddress', this.selectedToken);
    }

    console.log('🔍 fetchSignals params:', Object.fromEntries(params));
    console.log('🔍 fetchSignals URL:', `/api/experiment/${targetId}/signals?${params}`);

    const response = await fetch(`/api/experiment/${targetId}/signals?${params}`);
    if (!response.ok) {
      throw new Error('获取交易信号失败');
    }
    const result = await response.json();

    // 标准化信号字段名以匹配前端期望格式
    if (result.signals && Array.isArray(result.signals)) {
      result.signals = result.signals.map(signal => ({
        ...signal,
        symbol: signal.token_symbol || signal.symbol || 'Unknown',
        signal_timestamp: signal.timestamp || signal.created_at || new Date().toISOString(),
        price: signal.price || null,
        executed: signal.executed || false,
        action: signal.action || signal.signal_type || 'HOLD'  // 映射 signal_type 到 action
      }));
    }

    // console.log('🔍 fetchSignals原始返回数据:', result);
    // console.log('🔍 信号数据长度:', result.signals?.length || 0);
    // console.log('🔍 信号数据示例:', result.signals?.[0]);
    return result;
  }

  async fetchKlineData(tokenId = null) {
    const url = tokenId
      ? `/api/experiment/${this.experimentId}/kline?tokenId=${encodeURIComponent(tokenId)}`
      : `/api/experiment/${this.experimentId}/kline`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('获取K线数据失败');
    }
    return await response.json();
  }

  /**
   * 🔥 解析URL参数，自动选择代币
   * 支持 #token=0x... 和 ?token=0x... 两种格式
   * ?token= 用于从统计页面跳转，#token= 用于直接分享链接
   */
  async parseHashToken() {
    try {
      let tokenAddress = null;

      // 优先检查 query 参数 ?token=xxx（从统计页面跳转）
      const urlParams = new URLSearchParams(window.location.search);
      tokenAddress = urlParams.get('token');

      if (tokenAddress) {
        console.log('🔍 检测 URL query参数 token:', tokenAddress);
      } else {
        // 其次检查 hash 参数 #token=xxx（直接分享链接）
        const hash = window.location.hash;
        if (hash) {
          console.log('🔍 检测 URL hash参数:', hash);
          const tokenMatch = hash.match(/#token=([^&]+)/);
          if (tokenMatch) {
            tokenAddress = tokenMatch[1];
            console.log('🔍 发现hash token参数:', tokenAddress);
          }
        }
      }

      if (tokenAddress) {
        console.log('🔍 设置selectedToken:', tokenAddress);

        // 直接设置 selectedToken（用于API过滤）
        // 此时 availableTokens 还未填充，所以先不检查
        this.selectedToken = tokenAddress;

        // 隐藏代币选择下拉框（因为已经通过 URL 指定了代币）
        this.hideTokenSelector();

        // 注意：时序图表加载和选择器更新会在 extractTokensFromExperiment 之后进行
      }
    } catch (error) {
      console.error('❌ 解析URL参数失败:', error);
    }
  }

  /**
   * 隐藏代币选择下拉框（详情页模式）
   */
  hideTokenSelector() {
    const tokenSelectorContainer = document.getElementById('token-selector-container');
    if (tokenSelectorContainer) {
      tokenSelectorContainer.style.display = 'none';
      console.log('✅ 已隐藏代币选择下拉框（详情页模式）');
    }
  }

  /**
   * 🔥 加载特定代币的时序数据（替代K线数据）
   * @param {Object} token - 代币对象 { address, symbol, priority }
   */
  async loadKlineForToken(token) {
    try {
      console.log('🔄 loadKlineForToken 开始:', token.symbol, token.address);

      // 显示加载状态
      const chartWrapper = document.getElementById('kline-chart-wrapper');
      const chartContainer = document.querySelector('.chart-container');

      // 首先确保图表区域可见
      if (chartWrapper) {
        chartWrapper.style.display = 'block';
        console.log('✅ chartWrapper 设置为可见');
      }
      if (chartContainer) {
        chartContainer.style.display = 'block';
        console.log('✅ chartContainer 设置为可见');
      }

      // 获取代币的详细信息（created_at 和 discovered_at）
      const tokenInfo = await this.fetchTokenInfo(token.address);

      // 获取时序数据（替代K线数据）
      const timeSeriesResponse = await this.fetchTimeSeriesData(token.address);

      console.log('📊 fetchTimeSeriesData 返回:', {
        success: timeSeriesResponse?.success,
        dataLength: timeSeriesResponse?.data?.length,
        firstData: timeSeriesResponse?.data?.[0]
      });

      if (!timeSeriesResponse || !timeSeriesResponse.data || timeSeriesResponse.data.length === 0) {
        console.warn('⚠️ 没有时序数据，隐藏图表');
        // 显示友好提示并隐藏整个图表区域
        if (chartWrapper) {
          chartWrapper.style.display = 'none';
        }
        const holderChartWrapper = document.getElementById('holder-chart-wrapper');
        if (holderChartWrapper) {
          holderChartWrapper.style.display = 'none';
        }
        return;
      }

      // 更新时序数据
      this.klineData = timeSeriesResponse.data;

      // 初始化价格折线图，传入代币信息
      this.initPriceLineChart(timeSeriesResponse.data, token, tokenInfo);

      // 初始化 Holder 走势图
      this.initHolderChart(timeSeriesResponse.data, token);

      console.log(`✅ 代币 ${token.symbol} 的时序数据图表加载完成`);

    } catch (error) {
      console.error(`❌ 加载代币 ${token.symbol} 的时序数据失败:`, error);

      // 隐藏图表区域
      const chartWrapper = document.getElementById('kline-chart-wrapper');
      if (chartWrapper) {
        chartWrapper.style.display = 'none';
      }
      const holderChartWrapper = document.getElementById('holder-chart-wrapper');
      if (holderChartWrapper) {
        holderChartWrapper.style.display = 'none';
      }
    }
  }

  /**
   * 获取特定代币的时序数据
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Object>} 时序数据
   */
  async fetchTimeSeriesData(tokenAddress) {
    try {
      console.log('🔍 [fetchTimeSeriesData] 开始获取时序数据 | tokenAddress =', tokenAddress);

      // 🔥 对于回测实验，使用源实验的时序数据
      const targetExperimentId = this._isBacktest && this._sourceExperimentId
        ? this._sourceExperimentId
        : this.experimentId;

      const params = new URLSearchParams({
        experimentId: targetExperimentId,
        tokenAddress: tokenAddress
      });

      console.log('🔍 [fetchTimeSeriesData] 请求URL =', `/api/experiment/time-series/data?${params}`);
      const response = await fetch(`/api/experiment/time-series/data?${params}`);
      console.log('🔍 [fetchTimeSeriesData] 响应状态 =', response.status, response.ok);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('🔍 [fetchTimeSeriesData] 返回数据 | success =', result.success, ', data.length =', result.data?.length);
      return result;
    } catch (error) {
      console.error('❌ 获取时序数据失败:', error);
      return { data: [] };
    }
  }

  /**
   * 获取代币的详细信息（created_at, discovered_at）
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Object>} 代币信息
   */
  async fetchTokenInfo(tokenAddress) {
    try {
      const targetExperimentId = this._isBacktest && this._sourceExperimentId
        ? this._sourceExperimentId
        : this.experimentId;

      const response = await fetch(`/api/experiment/${targetExperimentId}/tokens?limit=10000`);
      if (!response.ok) {
        console.warn('获取代币列表失败，使用空数据');
        return null;
      }

      const result = await response.json();
      const tokens = result.data || result.tokens || [];
      const tokenInfo = tokens.find(t =>
        (t.token_address || t.address) === tokenAddress
      );

      if (tokenInfo) {
        console.log('📊 找到代币信息:', {
          created_at: tokenInfo.created_at,
          discovered_at: tokenInfo.discovered_at,
          raw_api_data_created_at: tokenInfo.raw_api_data?.created_at
        });
        return tokenInfo;
      }

      return null;
    } catch (error) {
      console.error('❌ 获取代币信息失败:', error);
      return null;
    }
  }

  /**
   * 初始化价格折线图（使用时序数据）
   * @param {Array} timeSeriesData - 时序数据
   * @param {Object} token - 代币对象
   * @param {Object} tokenInfo - 代币详细信息（包含 created_at, discovered_at）
   */
  initPriceLineChart(timeSeriesData, token, tokenInfo = null) {
    try {
      console.log('📊 initPriceLineChart 被调用，数据点:', timeSeriesData.length, '代币:', token.symbol);

      // 确保图表容器可见
      const chartWrapper = document.getElementById('kline-chart-wrapper');
      if (chartWrapper) {
        chartWrapper.style.display = 'block';
      }

      // 隐藏占位符
      const placeholder = document.getElementById('kline-chart-placeholder');
      if (placeholder) {
        placeholder.style.display = 'none';
      }

      // 确保并显示 canvas
      let canvas = document.getElementById('kline-chart');
      if (!canvas) {
        // canvas 不存在，需要重新创建
        const chartContainer = document.querySelector('.chart-container');
        if (!chartContainer) {
          console.error('❌ 找不到 .chart-container 容器');
          return;
        }
        canvas = document.createElement('canvas');
        canvas.id = 'kline-chart';
        chartContainer.innerHTML = ''; // 清空容器
        chartContainer.appendChild(canvas);
        console.log('✅ 重新创建了 kline-chart canvas 元素');
      }
      canvas.style.display = 'block';

      // 销毁旧图表
      if (this.chart) {
        this.chart.destroy();
        this.chart = null;
      }

      const ctx = canvas.getContext('2d');

      // 🔥 价格乘以10亿得到市值
      const MARKET_CAP_MULTIPLIER = 1e9; // 10亿

      // 🔥 准备扩展数据：在时序数据前面添加发布时价格和收集时价格
      const extendedData = [];

      // 从时序数据第一个点获取 launchPrice 和 collectionPrice
      const firstPoint = timeSeriesData[0];
      const factorValues = firstPoint?.factor_values || {};
      const launchPrice = factorValues.launchPrice;
      const collectionPrice = factorValues.collectionPrice;

      // 添加发布时价格点（如果有数据）
      if (launchPrice && tokenInfo?.raw_api_data?.created_at) {
        const createdAt = new Date(tokenInfo.raw_api_data.created_at * 1000); // 转换为毫秒
        extendedData.push({
          timestamp: createdAt.toISOString(),
          price_usd: launchPrice,
          isReferencePoint: true,
          pointType: 'launch'
        });
        console.log('📊 添加发布时价格点:', {
          time: createdAt.toISOString(),
          price: launchPrice
        });
      }

      // 添加收集时价格点（如果有数据）
      if (collectionPrice && tokenInfo?.discovered_at) {
        const discoveredAt = new Date(tokenInfo.discovered_at);
        extendedData.push({
          timestamp: discoveredAt.toISOString(),
          price_usd: collectionPrice,
          isReferencePoint: true,
          pointType: 'collection'
        });
        console.log('📊 添加收集时价格点:', {
          time: discoveredAt.toISOString(),
          price: collectionPrice
        });
      }

      // 添加时序数据
      timeSeriesData.forEach(d => {
        extendedData.push({
          ...d,
          isReferencePoint: false
        });
      });

      // 准备数据
      const labels = extendedData.map(d => new Date(d.timestamp));
      const marketCaps = extendedData.map(d => d.price_usd ? parseFloat(d.price_usd) * MARKET_CAP_MULTIPLIER : null);

      console.log('📊 图表数据准备完成:', {
        labels: labels.length,
        marketCaps: marketCaps.filter(m => m !== null).length,
        firstLabel: labels[0],
        lastLabel: labels[labels.length - 1],
        referencePoints: extendedData.filter(d => d.isReferencePoint).length
      });

      // 准备信号标记点
      const signalAnnotations = [];
      const tokenSignals = this.signals.filter(s =>
        (s.token_address || s.tokenAddress) === token.address
      );

      console.log('📊 找到', tokenSignals.length, '个该代币的信号');

      tokenSignals.forEach(signal => {
        const signalTime = new Date(signal.timestamp || signal.created_at);
        const signalType = signal.signal_type || signal.action?.toUpperCase();
        const isBuy = signalType === 'BUY';
        const isExecuted = signal.executed === true || signal.executed === 'true';

        // 找到最接近的数据点
        const closestIndex = labels.findIndex(label => Math.abs(label - signalTime) < 30000); // 30秒内
        if (closestIndex >= 0 && marketCaps[closestIndex] !== null) {
          // 根据执行状态设置不同的样式
          let borderColor, borderWidth, borderDash, labelBg, labelText;

          if (isExecuted) {
            // 已执行的信号：深色、实线、更粗
            borderColor = isBuy ? '#22c55e' : '#dc2626';  // 深绿/深红
            borderWidth = 3;
            borderDash = [];  // 实线
            labelBg = borderColor;
            labelText = (isBuy ? '买入' : '卖出') + ' ✓';
          } else {
            // 未执行的信号：浅色、虚线、较细
            borderColor = isBuy ? '#86efac' : '#fca5a5';  // 浅绿/浅红
            borderWidth = 2;
            borderDash = [5, 5];  // 虚线
            labelBg = borderColor;
            labelText = (isBuy ? '买入' : '卖出') + ' ✗';
          }

          signalAnnotations.push({
            type: 'line',
            xMin: signalTime,
            xMax: signalTime,
            yMin: 0,
            yMax: 'max',
            borderColor: borderColor,
            borderWidth: borderWidth,
            borderDash: borderDash,
            label: {
              display: true,
              content: labelText,
              position: 'start',
              backgroundColor: labelBg,
              color: '#fff',
              font: {
                size: isExecuted ? 12 : 11,
                weight: isExecuted ? 'bold' : 'normal'
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
            label: `${token.symbol} 市值`,
            data: marketCaps,
            borderColor: '#1890ff',
            backgroundColor: 'rgba(24, 144, 255, 0.1)',
            borderWidth: 2,
            pointRadius: extendedData.map(d => d.isReferencePoint ? 6 : 0),
            pointHoverRadius: extendedData.map(d => d.isReferencePoint ? 8 : 4),
            pointBackgroundColor: extendedData.map(d => {
              if (d.pointType === 'launch') return '#9ca3af'; // 灰色 - 发布价
              if (d.pointType === 'collection') return '#8b5cf6'; // 紫色 - 收集价
              return '#1890ff';
            }),
            pointBorderColor: extendedData.map(d => {
              if (d.isReferencePoint) return '#fff';
              return '#1890ff';
            }),
            pointBorderWidth: extendedData.map(d => d.isReferencePoint ? 2 : 0),
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
              annotations: signalAnnotations
            },
            legend: {
              display: true,
              position: 'top'
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const value = context.parsed.y;
                  const dataIndex = context.dataIndex;
                  const dataPoint = extendedData[dataIndex];

                  if (value !== null) {
                    // 市值格式化为K（千）为单位
                    const marketCapInK = value / 1e3;
                    let label = `市值: ${marketCapInK.toFixed(1)}K`;

                    // 添加参考点标签
                    if (dataPoint?.pointType === 'launch') {
                      label = '📌 发布时价格: ' + label;
                    } else if (dataPoint?.pointType === 'collection') {
                      label = '📍 收集时价格: ' + label;
                    }

                    return label;
                  }
                  return '市值: N/A';
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
              text: '市值 (K)'
            },
            ticks: {
              callback: function(value) {
                // Y轴刻度显示为K（千）
                return (value / 1e3).toFixed(1) + 'K';
              }
            }
          }
        }
      }
    });

    console.log(`✅ 市值折线图已初始化，包含 ${timeSeriesData.length} 个数据点和 ${signalAnnotations.length} 个信号标记`);

  } catch (error) {
    console.error('❌ initPriceLineChart 失败:', error);
    // 显示错误提示
    this.showKlinePlaceholder('图表初始化失败: ' + error.message);
  }
  }

  /**
   * 初始化 Holder 走势图
   * @param {Array} timeSeriesData - 时序数据
   * @param {Object} token - 代币信息
   */
  initHolderChart(timeSeriesData, token) {
    try {
      console.log('📊 initHolderChart 被调用，数据点:', timeSeriesData.length, '代币:', token.symbol);

      // 确保图表容器可见
      const chartWrapper = document.getElementById('holder-chart-wrapper');
      if (chartWrapper) {
        chartWrapper.classList.remove('hidden');
        chartWrapper.style.display = 'block';
      }

      // 确保并显示 canvas
      let canvas = document.getElementById('holder-chart');
      if (!canvas) {
        const chartContainer = chartWrapper.querySelector('.chart-container');
        if (!chartContainer) {
          console.error('❌ 找不到 holder chart container');
          return;
        }
        canvas = document.createElement('canvas');
        canvas.id = 'holder-chart';
        chartContainer.innerHTML = '';
        chartContainer.appendChild(canvas);
        console.log('✅ 重新创建了 holder-chart canvas 元素');
      }
      canvas.style.display = 'block';

      // 销毁旧图表
      if (this.holderChart) {
        this.holderChart.destroy();
        this.holderChart = null;
      }

      const ctx = canvas.getContext('2d');

      // 准备数据：提取 holders 数据
      const labels = timeSeriesData.map(d => new Date(d.timestamp));
      const holders = timeSeriesData.map(d => {
        const fv = d.factor_values || {};
        return fv.holders || null;
      });

      // 过滤掉 null 值用于统计
      const validHolders = holders.filter(h => h !== null);
      const hasData = validHolders.length > 0;

      console.log('📊 Holder 图表数据准备完成:', {
        labels: labels.length,
        holders: validHolders.length,
        firstHolder: validHolders[0],
        lastHolder: validHolders[validHolders.length - 1]
      });

      if (!hasData) {
        console.warn('⚠️ 没有有效的 holder 数据');
        this.showHolderPlaceholder('暂无 Holder 数据');
        return;
      }

      // 准备信号标记点
      const signalAnnotations = [];
      const tokenSignals = this.signals.filter(s =>
        (s.token_address || s.tokenAddress) === token.address
      );

      tokenSignals.forEach(signal => {
        const signalTime = new Date(signal.timestamp || signal.created_at);
        const signalType = signal.signal_type || signal.action?.toUpperCase();
        const isBuy = signalType === 'BUY';
        const isExecuted = signal.executed === true || signal.executed === 'true';

        // 找到最接近的数据点
        const closestIndex = labels.findIndex(label => Math.abs(label - signalTime) < 30000); // 30秒内
        if (closestIndex >= 0) {
          // 获取该时间点的 holder 值作为 y 轴范围
          const holderValue = holders[closestIndex];
          if (holderValue !== null && holderValue !== undefined) {
            // 根据执行状态设置不同的样式
            let borderColor, borderWidth, borderDash, labelBg, labelText;

            if (isExecuted) {
              // 已执行的信号：深色、实线、更粗
              borderColor = isBuy ? '#22c55e' : '#dc2626';  // 深绿/深红
              borderWidth = 3;
              borderDash = [];  // 实线
              labelBg = borderColor;
              labelText = (isBuy ? '买入' : '卖出') + ' ✓';
            } else {
              // 未执行的信号：浅色、虚线、较细
              borderColor = isBuy ? '#86efac' : '#fca5a5';  // 浅绿/浅红
              borderWidth = 2;
              borderDash = [5, 5];  // 虚线
              labelBg = borderColor;
              labelText = (isBuy ? '买入' : '卖出') + ' ✗';
            }

            signalAnnotations.push({
              type: 'line',
              xMin: signalTime,
              xMax: signalTime,
              yMin: 0,
              yMax: 'max',
              borderColor: borderColor,
              borderWidth: borderWidth,
              borderDash: borderDash,
              label: {
                display: true,
                content: labelText,
                position: 'start',
                backgroundColor: labelBg,
                color: '#fff',
                font: {
                  size: isExecuted ? 12 : 11,
                  weight: isExecuted ? 'bold' : 'normal'
                }
              }
            });
          }
        }
      });

      // 创建图表
      this.holderChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: `${token.symbol} Holders`,
            data: holders,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
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
              annotations: signalAnnotations
            },
            legend: {
              display: true,
              position: 'top'
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const value = context.parsed.y;
                  if (value !== null && value !== undefined) {
                    return `Holders: ${value}`;
                  }
                  return 'Holders: N/A';
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
                text: 'Holders 数量'
              },
              ticks: {
                callback: function(value) {
                  return value;
                }
              }
            }
          }
        }
      });

      console.log(`✅ Holder 走势图已初始化，包含 ${validHolders.length} 个数据点和 ${signalAnnotations.length} 个信号标记`);

    } catch (error) {
      console.error('❌ initHolderChart 失败:', error);
      this.showHolderPlaceholder('图表初始化失败: ' + error.message);
    }
  }

  /**
   * 显示 Holder 图表占位符
   * @param {string} message - 提示消息
   */
  showHolderPlaceholder(message) {
    const chartWrapper = document.getElementById('holder-chart-wrapper');
    if (chartWrapper) {
      const chartContainer = chartWrapper.querySelector('.chart-container');
      if (chartContainer) {
        chartContainer.innerHTML = `
          <div id="holder-chart-placeholder" class="flex items-center justify-center h-full text-gray-400">
            <div class="text-center">
              <div class="text-4xl mb-2">📊</div>
              <div>${message}</div>
            </div>
          </div>
        `;
      }
    }
  }

  updateExperimentHeader(experiment) {
    // 显示实验头部区域（移除hidden类）
    const header = document.getElementById('experiment-header');
    if (header) {
      header.classList.remove('hidden');
    }

    // API返回的是驼峰命名: experimentName, blockchain
    const name = experiment.experimentName || experiment.experiment_name || '未知实验';
    document.getElementById('experiment-name').textContent = name;
    document.getElementById('experiment-id').textContent = `ID: ${this.experimentId}`;

    // 🔥 解析实验配置（可能是 JSON 字符串或对象）
    const config = typeof experiment.config === 'string'
      ? JSON.parse(experiment.config)
      : (experiment.config || {});
    this.experimentConfig = config;

    // 🔥 设置回测状态
    this._isBacktest = experiment.tradingMode === 'backtest';
    if (this._isBacktest) {
      this._sourceExperimentId = config.backtest?.sourceExperimentId || null;
      // 🔥 对于回测实验，先使用回测实验的区块链配置，后面会异步获取源实验的配置
      this.blockchain = experiment.blockchain || 'bsc';
    } else {
      this._sourceExperimentId = null;
      this.blockchain = experiment.blockchain || 'bsc';
    }

    // 🔥 使用 BlockchainConfig 获取区块链显示名称和 logo
    const blockchain = this.blockchain || 'unknown';
    const blockchainDisplay = this.getBlockchainDisplay(blockchain);
    const blockchainElement = document.getElementById('experiment-blockchain');
    if (blockchainElement) {
      blockchainElement.innerHTML = `
        <img src="/static/${blockchain.toLowerCase()}-logo.png" alt="${blockchainDisplay}" class="w-4 h-4 inline-block rounded-full" onerror="this.style.display='none'">
        ${blockchainDisplay}
      `;
    }

    // 更新页面标题
    document.title = `交易信号 - ${name} - 2025-2026 Become Rich Baby!`;
  }

  /**
   * 🔥 更新回测模式的头部信息，显示源实验提示
   * @param {string} sourceExperimentId - 源实验ID
   */
  updateBacktestHeader(sourceExperimentId) {
    const header = document.getElementById('experiment-header');
    if (!header) return;

    // 创建回测提示元素
    const backtestNotice = document.createElement('div');
    backtestNotice.className = 'mt-4 p-3 bg-blue-900 border border-blue-700 rounded-lg';
    backtestNotice.innerHTML = `
      <div class="flex items-center space-x-2">
        <span class="text-blue-300 text-lg">📊</span>
        <div class="flex-1">
          <div class="text-blue-200 font-medium">回测模式 - 显示源实验数据</div>
          <div class="text-blue-400 text-sm mt-1">
            当前为回测实验，以下显示的是源实验 <code class="bg-blue-800 px-1 rounded text-blue-300">${sourceExperimentId.substring(0, 8)}...</code> 的原始信号数据
          </div>
        </div>
      </div>
    `;

    // 插入到头部内容的最后
    header.appendChild(backtestNotice);

    console.log('📊 [回测模式] 已添加源实验提示');
  }

  /**
   * 🔥 获取源实验的信息（区块链配置）
   */
  async fetchSourceExperimentInfo() {
    if (!this._sourceExperimentId) return;

    try {
      const response = await fetch(`/api/experiment/${this._sourceExperimentId}`);
      if (response.ok) {
        const result = await response.json();
        if (result.data) {
          // 更新区块链配置
          this.blockchain = result.data.blockchain || 'bsc';
          console.log('📊 [回测模式] 使用源实验的区块链配置:', this.blockchain);

          // 更新区块链显示
          const blockchainDisplay = this.getBlockchainDisplay(this.blockchain);
          const blockchainElement = document.getElementById('experiment-blockchain');
          if (blockchainElement) {
            blockchainElement.innerHTML = `
              <img src="/static/${this.blockchain.toLowerCase()}-logo.png" alt="${blockchainDisplay}" class="w-4 h-4 inline-block rounded-full" onerror="this.style.display='none'">
              ${blockchainDisplay}
            `;
          }
        }
      }
    } catch (error) {
      console.warn('⚠️ 获取源实验区块链信息失败，使用默认值:', error);
      this.blockchain = this.blockchain || 'bsc';
    }
  }

  /**
   * 🔥 从实验代币表获取代币列表
   */
  async extractTokensFromExperiment() {
    try {
      // 从已加载的信号数据中提取有信号的代币列表
      // 统计每个代币的信号数量和被拒绝信号数量
      const tokenSignalCounts = new Map();

      if (this.signals && this.signals.length > 0) {
        this.signals.forEach(signal => {
          const address = signal.token_address || signal.tokenAddress;
          const symbol = signal.token_symbol || signal.symbol || 'Unknown';

          if (!tokenSignalCounts.has(address)) {
            tokenSignalCounts.set(address, {
              address: address,
              symbol: symbol,
              signalCount: 0,
              rejectedCount: 0
            });
          }

          tokenSignalCounts.get(address).signalCount++;

          // 统计被拒绝的信号
          if (this.isSignalRejected(signal)) {
            tokenSignalCounts.get(address).rejectedCount++;
          }
        });
      }

      this.availableTokens = Array.from(tokenSignalCounts.values());
      console.log(`📊 从 ${this.signals.length} 条信号中提取到 ${this.availableTokens.length} 个有信号的代币`);

      // 填充代币选择器
      this.populateTokenSelector();

    } catch (error) {
      console.error('❌ 获取代币列表失败:', error);
      this.availableTokens = [];
      // 即使失败也要尝试填充选择器
      this.populateTokenSelector();
    }
  }

  /**
   * 🔥 填充代币选择器
   */
  populateTokenSelector() {
    console.log('🎨 populateTokenSelector 被调用，availableTokens:', this.availableTokens.length);
    const selector = document.getElementById('token-selector');
    if (!selector) {
      console.warn('⚠️ 找不到代币选择器元素');
      return;
    }
    // console.log('✅ 找到 #token-selector 元素');

    // 清空现有选项和事件监听器（克隆节点以移除监听器）
    const newSelector = selector.cloneNode(false);
    selector.parentNode.replaceChild(newSelector, selector);

    // 重新获取引用
    const freshSelector = document.getElementById('token-selector');

    // 清空现有选项
    freshSelector.innerHTML = '<option value="all">全部代币</option>';
    console.log('📝 已设置默认选项');

    // 按信号数量降序排序（信号多的在前）
    const sortedTokens = [...this.availableTokens].sort((a, b) => {
      return (b.signalCount || 0) - (a.signalCount || 0);
    });

    // console.log('🔄 准备添加', sortedTokens.length, '个代币选项');

    // 添加代币选项，显示信号数量、被拒绝数量和地址
    sortedTokens.forEach((token, index) => {
      const option = document.createElement('option');
      option.value = token.address;
      const signalCount = token.signalCount || 0;
      const rejectedCount = token.rejectedCount || 0;

      // 显示：代币符号 (信号数) 🚫(被拒绝数) - 地址前8位
      const shortAddress = token.address.length > 12
        ? `${token.address.substring(0, 8)}...`
        : token.address;

      let textContent = `${token.symbol} (${signalCount} 条)`;
      if (rejectedCount > 0) {
        textContent += ` 🚫(${rejectedCount})`;
      }
      textContent += ` - ${shortAddress}`;

      option.textContent = textContent;
      freshSelector.appendChild(option);
      if (index < 3) {
        console.log(`  [${index}] ${option.textContent}`);
      }
    });

    // 验证添加结果
    const finalOptions = freshSelector.querySelectorAll('option');
    // console.log('📊 最终选择器中的选项数量:', finalOptions.length);

    // 如果没有代币，禁用选择器
    if (this.availableTokens.length === 0) {
      freshSelector.disabled = true;
      console.log('⚠️ 没有可用代币，禁用代币选择器');
    }

    // 绑定事件
    freshSelector.addEventListener('change', async (e) => {
      const selectedTokenAddress = e.target.value;
      this.selectedToken = selectedTokenAddress;
      // console.log('🔄 选择代币:', this.selectedToken);

      // 如果选择了具体代币（不是'all'），重新加载对应的K线图
      if (selectedTokenAddress !== 'all') {
        const selectedToken = this.availableTokens.find(t => t.address === selectedTokenAddress);
        if (selectedToken) {
          await this.loadKlineForToken(selectedToken);
        }
      } else {
        // 选择"全部代币"时，隐藏整个图表区域
        const chartWrapper = document.getElementById('kline-chart-wrapper');
        if (chartWrapper) {
          chartWrapper.style.display = 'none';
        }
      }

      // 过滤并渲染信号列表
      this.filterAndRenderSignals();
    });

    // console.log('✅ 代币选择器已填充，代币数量:', this.availableTokens.length);

    // 调试：检查选择器状态
    setTimeout(() => {
      const checkSelector = document.getElementById('token-selector');
      if (checkSelector) {
        // console.log('🔍 选择器状态检查:');
        console.log('  - disabled:', checkSelector.disabled);
        console.log('  - options.length:', checkSelector.options.length);
        console.log('  - options[0]:', checkSelector.options[0]?.text);
        console.log('  - options[1]:', checkSelector.options[1]?.text);
        console.log('  - computedStyle display:', getComputedStyle(checkSelector).display);
        console.log('  - computedStyle pointerEvents:', getComputedStyle(checkSelector).pointerEvents);
      }
    }, 100);
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
   * 🔥 根据选择的代币过滤并重新渲染信号
   */
  filterAndRenderSignals() {
    const filteredSignals = this.selectedToken === 'all'
      ? this.signals
      : this.signals.filter(s => s.token_address === this.selectedToken);

    console.log(`🔍 过滤后的信号数量: ${filteredSignals.length} (全部: ${this.signals.length})`);

    // 更新代币信息显示
    const tokenInfoContainer = document.getElementById('token-info-container');
    const tokenAddressEl = document.getElementById('token-address');
    const copyAddressBtn = document.getElementById('copy-address-btn');
    const gmgnLinkBtn = document.getElementById('gmgn-link-btn');

    if (tokenInfoContainer) {
      if (this.selectedToken === 'all') {
        tokenInfoContainer.classList.add('hidden');
      } else {
        const token = this.availableTokens.find(t => t.address === this.selectedToken);
        if (token) {
          tokenInfoContainer.classList.remove('hidden');
          tokenAddressEl.textContent = token.address;

          // 🔥 生成GMGN链接
          // GMGN URL格式: https://gmgn.ai/{blockchain}/token/{address}
          const gmgnBlockchain = this.getGMGNBlockchain(this.blockchain);
          const gmgnUrl = `https://gmgn.ai/${gmgnBlockchain}/token/${token.address}`;
          if (gmgnLinkBtn) {
            gmgnLinkBtn.href = gmgnUrl;
            console.log('🔗 GMGN链接已设置:', gmgnUrl);
          } else {
            console.warn('⚠️ gmgnLinkBtn 元素未找到');
          }

          // 绑定复制按钮事件
          copyAddressBtn.onclick = async () => {
            try {
              await navigator.clipboard.writeText(token.address);
              // 显示复制成功提示
              copyAddressBtn.innerHTML = '<span>✅</span><span>已复制</span>';
              setTimeout(() => {
                copyAddressBtn.innerHTML = '<span>📋</span><span>复制</span>';
              }, 2000);
            } catch (error) {
              console.error('复制地址失败:', error);
              // 降级方案
              try {
                const textArea = document.createElement('textarea');
                textArea.value = token.address;
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                copyAddressBtn.innerHTML = '<span>✅</span><span>已复制</span>';
              } catch (fallbackError) {
                console.error('降级复制也失败:', fallbackError);
                copyAddressBtn.innerHTML = '<span>❌</span><span>复制失败</span>';
              }
            }
          };
        }
      }
    }

    // 更新信号列表
    this.renderSignals(filteredSignals);

    // 更新统计信息
    this.updateSignalsStats(filteredSignals);
  }

  /**
   * 更新信号统计信息
   * @param {Array} signals - 要统计的信号数组（可选，默认使用所有信号）
   */
  updateSignalsStats(signals = null) {
    // 如果没有传入参数，使用所有信号
    const signalsToCount = signals !== null ? signals : this.signals;

    const buySignals = signalsToCount.filter(s => s.action.toUpperCase() === 'BUY').length;
    const sellSignals = signalsToCount.filter(s => s.action.toUpperCase() === 'SELL').length;
    const holdSignals = signalsToCount.filter(s => s.action.toUpperCase() === 'HOLD').length;

    document.getElementById('signal-count').textContent = `信号数量: ${signalsToCount.length}`;
    document.getElementById('buy-signals').textContent = buySignals;
    document.getElementById('sell-signals').textContent = sellSignals;
    document.getElementById('hold-signals').textContent = holdSignals;

    // 计算平均置信度
    if (signalsToCount.length > 0) {
      const avgConfidence = signalsToCount.reduce((sum, s) => sum + (s.confidence || 0), 0) / signalsToCount.length;
      document.getElementById('avg-confidence').textContent = `${(avgConfidence * 100).toFixed(1)}%`;
    } else {
      document.getElementById('avg-confidence').textContent = '0%';
    }

    // 显示/隐藏空状态
    const emptyState = document.getElementById('empty-state');
    const signalsContainer = document.getElementById('signals-container');

    if (signalsToCount.length === 0) {
      emptyState.classList.remove('hidden');
      signalsContainer.parentElement.classList.add('hidden');
    } else {
      emptyState.classList.add('hidden');
      signalsContainer.parentElement.classList.remove('hidden');
    }
  }

  initKlineChart(klineResponse) {
    console.log('🚀 开始初始化K线图...', klineResponse);

    // 检查Chart.js是否已加载
    if (typeof Chart === 'undefined') {
      console.error('❌ Chart.js 未加载，无法创建图表');
      this.showError('图表库加载失败，请刷新页面重试');
      return;
    }

    const canvas = document.getElementById('kline-chart');
    if (!canvas) {
      console.error('❌ 找不到K线图画布元素');
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

    // 如果交易量图已存在，也销毁
    if (this.volumeChart) {
      try {
        this.volumeChart.destroy();
        this.volumeChart = null;
        console.log('🗑️ 已销毁现有交易量图');
      } catch (error) {
        console.warn('销毁交易量图实例时出错:', error);
      }
    }

    // 确保canvas完全清空
    canvas.width = canvas.width;
    canvas.height = canvas.height;

    // 🔥 价格乘以10亿得到市值
    const MARKET_CAP_MULTIPLIER = 1e9; // 10亿

    // 准备K线数据 - 使用成功项目的格式
    const candlestickData = klineResponse.kline_data.map(kline => {
      const timestamp = parseInt(kline.timestamp) * 1000; // 转换为毫秒
      return [
        timestamp,
        parseFloat(kline.open_price) * MARKET_CAP_MULTIPLIER,
        parseFloat(kline.high_price) * MARKET_CAP_MULTIPLIER,
        parseFloat(kline.low_price) * MARKET_CAP_MULTIPLIER,
        parseFloat(kline.close_price) * MARKET_CAP_MULTIPLIER
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

    // 准备交易量数据和颜色 - 颜色直接嵌入到数据点对象中（参考Python项目的实现）
    const volumeDataPoints = klineResponse.kline_data.map(kline => {
      const isUp = parseFloat(kline.close_price) >= parseFloat(kline.open_price);
      return {
        x: parseInt(kline.timestamp) * 1000,
        y: parseFloat(kline.volume || 0),
        // 将颜色直接嵌入到数据点对象中
        backgroundColor: isUp ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)',
        borderColor: isUp ? 'rgba(16, 185, 129, 0.8)' : 'rgba(239, 68, 68, 0.8)'
      };
    });

    // console.log('📊 交易量数据点数:', volumeDataPoints.length);
    if (volumeDataPoints.length > 0) {
      const totalVolume = volumeDataPoints.reduce((sum, item) => sum + item.y, 0);
      const avgVolume = totalVolume / volumeDataPoints.length;
      const maxVolume = Math.max(...volumeDataPoints.map(item => item.y));
      console.log(`📊 交易量统计: 总量=${totalVolume.toFixed(0)}, 平均=${avgVolume.toFixed(0)}, 最大=${maxVolume.toFixed(0)}`);
      // 显示前3个数据点的颜色，便于调试
      console.log('🎨 前3个交易量柱的颜色:', volumeDataPoints.slice(0, 3).map((v, i) => `Bar[${i}]: ${v.backgroundColor}`));
    }


    // 准备信号标记 - 使用成功项目的方法
    const signalAnnotations = {};
    const signalData = klineResponse.trades_on_chart || klineResponse.signals; // 兼容两种字段名

    console.log('🎯 检查信号数据:', {
      'trades_on_chart': klineResponse.trades_on_chart?.length || 0,
      'signals': klineResponse.signals?.length || 0,
      'signalData': signalData?.length || 0
    });

    if (signalData && Array.isArray(signalData)) {
      console.log('📍 开始处理', signalData.length, '个信号标记');
      signalData.forEach((signal, index) => {
        // 找到最接近的K线时间点
        const signalTime = new Date(signal.signal_timestamp).getTime();
        const closestKline = candlestickData.find(kline =>
          Math.abs(kline[0] - signalTime) < (klineResponse.interval_minutes * 60 * 1000) // 一个K线间隔内
        );

        if (closestKline) {
          const isBuy = signal.action === 'buy';
          signalAnnotations[`signal_${index}`] = {
            type: 'point',
            xValue: closestKline[0],
            yValue: isBuy ? closestKline[4] : closestKline[4], // 收盘价
            backgroundColor: isBuy ? '#10b981' : '#ef4444',
            borderColor: '#ffffff',
            borderWidth: 2,
            radius: 6,
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
    }

    try {
      // console.log('📊 创建K线图表...');
      console.log('📈 K线数据点数:', chartData.length);
      console.log('🎯 信号标记数:', Object.keys(signalAnnotations).length);

      // K线图配置（仅包含蜡烛图）
      const config = {
        type: 'candlestick',
        data: {
          datasets: [
            // 蜡烛图数据集
            {
              type: 'candlestick',
              label: `${klineResponse.token?.symbol || '代币'} 市值`,
              data: chartData,
              yAxisID: 'y',
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
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              bottom: 5
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
                color: '#9ca3af'
              }
            },
            y: {
              type: 'linear',
              position: 'right',
              display: true,
              title: {
                display: true,
                text: '市值 (K)',
                color: '#9ca3af'
              },
              grid: {
                color: 'rgba(156, 163, 175, 0.2)'
              },
              ticks: {
                color: '#9ca3af',
                callback: function(value) {
                  // Y轴刻度显示为K（千）
                  return (value / 1e3).toFixed(1) + 'K';
                }
              }
            }
          },
          plugins: {
            legend: {
              display: true,
              labels: {
                color: '#f3f4f6',
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
                  // 蜡烛图数据：显示OHLC（转换为K）
                  const toK = (val) => (val / 1e3).toFixed(1) + 'K';
                  return [
                    `开盘: ${toK(data.o)}`,
                    `最高: ${toK(data.h)}`,
                    `最低: ${toK(data.l)}`,
                    `收盘: ${toK(data.c)}`
                  ];
                }
              }
            },
            annotation: {
              annotations: signalAnnotations
            }
          }
        }
      };

      this.chart = new Chart(ctx, config);
      console.log(`✅ K线图初始化完成，${chartData.length}个数据点，${Object.keys(signalAnnotations).length}个信号标记`);

      // 创建独立的交易量图
      this.createVolumeChart(volumeDataPoints, klineResponse);

    } catch (error) {
      console.error('❌ 创建K线图失败:', error);
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

  createVolumeChart(volumeDataPoints, klineResponse) {
    // console.log('📊 开始创建独立的交易量图...');

    const volumeCanvas = document.getElementById('volume-chart');
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

      console.log(`📊 交易量数据准备完成: ${volumeChartData.length} 个数据点`);
      console.log('🎨 前3个交易量柱的颜色:', volumeChartData.slice(0, 3).map((v, i) => `Bar[${i}]: ${v.backgroundColor}`));

      // 创建交易量图（参考Python项目的实现）
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
              top: 5,
              bottom: 5
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
                maxTicksLimit: 8
              }
            },
            y: {
              position: 'right',
              grid: {
                color: 'rgba(156, 163, 175, 0.2)'
              },
              ticks: {
                color: '#9ca3af',
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
            }
          }
        }
      });

      // console.log('✅ 交易量图初始化完成');

    } catch (error) {
      console.error('❌ 创建交易量图失败:', error);
      console.error('错误详情:', error.message);

      // 显示错误信息
      const volumeContainer = volumeCanvas.parentElement;
      volumeContainer.innerHTML = `
        <div class="flex items-center justify-center h-32 bg-gray-100 rounded-lg border border-gray-300">
          <div class="text-center">
            <div class="text-red-500 text-sm mb-1">⚠️ 交易量图加载失败</div>
            <div class="text-gray-600 text-xs">错误: ${error.message}</div>
          </div>
        </div>
      `;
    }
  }

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
   * 渲染信号列表
   * @param {Array} signals - 要渲染的信号数组（可选，默认使用所有信号）
   */
  renderSignals(signals = null) {
    const container = document.getElementById('signals-container');
    container.innerHTML = '';

    // 如果没有传入参数，使用所有信号
    let signalsToRender = signals !== null ? signals : this.signals;

    // 根据 showRejected 过滤信号
    if (!this.showRejected) {
      signalsToRender = signalsToRender.filter(s => !this.isSignalRejected(s));
    }

    // 按时间倒序排列
    const sortedSignals = [...signalsToRender].sort((a, b) =>
      new Date(b.signal_timestamp) - new Date(a.signal_timestamp)
    );

    sortedSignals.forEach(signal => {
      const signalCard = this.createSignalCard(signal);
      container.appendChild(signalCard);
    });
  }

  createSignalCard(signal) {
    const card = document.createElement('div');
    const signalClass = this.getSignalClass(signal.action, signal);
    const badgeClass = this.getBadgeClass(signal.action, signal);

    card.className = `signal-card ${signalClass} p-4`;

    const signalTime = new Date(signal.signal_timestamp).toLocaleString('zh-CN');

    // 检查是否是被拒绝的信号
    const isRejected = this.isSignalRejected(signal);
    const executedStatus = signal.executed ?
      '<span class="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">✅ 已执行</span>' :
      (isRejected ?
        '<span class="text-xs px-2 py-1 bg-red-100 text-red-800 rounded-full">🚫 被拒绝</span>' :
        '<span class="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full">⏳ 未执行</span>');

    // 从 metadata 中获取策略信息
    const metadata = signal.metadata || {};
    const strategyName = metadata.strategyName || signal.strategyName || signal.reason || '策略信号';
    const strategyId = metadata.strategyId || signal.strategyId || null;
    const executionReason = signal.execution_reason || metadata.execution_reason || '';

    // 构建拒绝原因HTML
    let rejectionInfoHtml = '';
    if (isRejected && executionReason) {
      rejectionInfoHtml = `
        <div class="mt-2 p-2 bg-red-50 rounded border border-red-200">
          <div class="flex items-center space-x-2">
            <span class="text-red-700 font-medium text-sm">🚫 拒绝原因:</span>
            <span class="text-red-900 text-sm">${this._escapeHtml(executionReason)}</span>
          </div>
        </div>
      `;
    }

    // 构建策略信息HTML
    let strategyInfoHtml = '';
    if (strategyName || strategyId) {
      strategyInfoHtml = `
        <div class="mt-2 p-2 bg-purple-50 rounded border border-purple-200">
          <div class="flex items-center space-x-2">
            <span class="text-purple-700 font-medium text-sm">📌 策略:</span>
            <span class="text-purple-900 font-semibold text-sm">${strategyName}</span>
            ${strategyId ? `<span class="text-purple-500 text-xs">(${strategyId})</span>` : ''}
          </div>
        </div>
      `;
    }

    // 构建价格和原因信息
    const priceValue = signal.price || metadata.price;
    const priceInfo = (priceValue !== undefined && priceValue !== null && !isNaN(priceValue)) ?
      `<span class="text-gray-600">价格: <span class="font-medium text-gray-900">${parseFloat(priceValue).toFixed(8)}</span></span>` : '';

    // 构建额外信息（如果有）
    let extraInfoHtml = '';
    const extraInfo = [];
    if (metadata.profitPercent !== undefined && metadata.profitPercent !== null && !isNaN(metadata.profitPercent)) {
      extraInfo.push(`收益率: ${metadata.profitPercent.toFixed(2)}%`);
    }
    if (metadata.holdDuration !== undefined && metadata.holdDuration !== null && !isNaN(metadata.holdDuration)) {
      const holdSeconds = metadata.holdDuration;
      const holdMinutes = (holdSeconds / 60).toFixed(1);
      extraInfo.push(`持仓: ${holdMinutes}分钟`);
    }
    if (metadata.sellCalculatedRatio !== undefined && metadata.sellCalculatedRatio !== null && !isNaN(metadata.sellCalculatedRatio)) {
      const ratioPercent = (metadata.sellCalculatedRatio * 100).toFixed(0);
      extraInfo.push(`卖出比例: ${ratioPercent}%`);
    }
    if (metadata.cards) {
      const cardsText = metadata.cards === 'all' ? '全部' : `${metadata.cards}卡`;
      extraInfo.push(`卡牌: ${cardsText}`);
    }
    if (extraInfo.length > 0) {
      extraInfoHtml = `<div class="flex items-center space-x-3 text-xs text-gray-500 mt-1">
        ${extraInfo.map(info => `<span>• ${info}</span>`).join('')}
      </div>`;
    }

    // 构建购买前置检查信息（仅买入信号）
    let preBuyCheckHtml = '';
    if (signal.action.toUpperCase() === 'BUY') {
      const pf = metadata.preBuyCheckFactors || {};
      const tf = metadata.trendFactors || {};
      const pr = metadata.preBuyCheckResult || {};

      // 🔥 获取策略条件并解析阈值
      const buyCondition = this._getBuyCondition('buy', strategyId);
      const buyThresholds = buyCondition ? this._parseBuyCondition(buyCondition) : {};
      // 获取购买轮次，用于显示对应的预检查条件
      const buyRound = pf.buyRound || 1;
      const preBuyCheckCondition = this._getPreBuyCheckCondition('buy', buyRound);
      const preCheckThresholds = preBuyCheckCondition ? this._parsePreBuyCheckCondition(preBuyCheckCondition) : {};

      // 购买前置检查结果
      const checkResultBadge = pr.canBuy === false ?
        '<span class="text-xs px-2 py-1 bg-red-100 text-red-800 rounded-full">❌ 失败</span>' :
        '<span class="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">✅ 通过</span>';

      // 跳过条件匹配标识（代币已有交易记录）
      let skippedMatchBadge = '';
      if (pf.skippedConditionMatch === true) {
        skippedMatchBadge = '<span class="ml-2 text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded-full" title="代币已有交易记录，跳过条件匹配（因子已收集）">⚡️ 快速通道</span>';
      }

      // 显示实验配置的策略条件
      let strategyConfigHtml = '';
      if (buyCondition || preBuyCheckCondition) {
        strategyConfigHtml = `
          <div class="mb-2 pb-2 border-b border-amber-300">
            ${buyCondition ? `
              <div class="text-xs mb-1">
                <span class="font-semibold text-amber-900">📋 买入条件配置:</span>
                <code class="ml-2 px-2 py-0.5 bg-amber-200 rounded text-xs text-amber-900 break-all">${this._escapeHtml(buyCondition)}</code>
              </div>
            ` : ''}
            ${preBuyCheckCondition ? `
              <div class="text-xs">
                <span class="font-semibold text-amber-900">🔍 预检查条件配置 (第${buyRound}轮${buyRound > 1 ? '购买' : ''}):</span>
                <code class="ml-2 px-2 py-0.5 bg-amber-200 rounded text-xs text-amber-900 break-all">${this._escapeHtml(preBuyCheckCondition)}</code>
              </div>
            ` : ''}
          </div>
        `;
      }

      // 辅助函数：格式化数值
      const formatNum = (val, decimals = 2) => val !== undefined && val !== null ? val.toFixed(decimals) : 'N/A';
      const formatPercent = (val) => val !== undefined && val !== null ? val.toFixed(1) + '%' : 'N/A';

      // 第一阶段：买入策略条件（趋势因子）- 显示所有因子
      let trendFactorsHtml = '';
      if (Object.keys(tf).length > 0) {
        const ageClass = this._getFactorClass('age', tf.age || 0, buyThresholds);
        const earlyReturnClass = this._getFactorClass('earlyReturn', tf.earlyReturn || 0, buyThresholds);
        const currentPriceClass = this._getFactorClass('currentPrice', tf.currentPrice || 0, buyThresholds);
        const collectionPriceClass = this._getFactorClass('collectionPrice', tf.collectionPrice || 0, buyThresholds);
        const trendCVClass = this._getFactorClass('trendCV', tf.trendCV || 0, buyThresholds);
        const trendSlopeClass = this._getFactorClass('trendSlope', tf.trendSlope || 0, buyThresholds);
        const trendStrengthScoreClass = this._getFactorClass('trendStrengthScore', tf.trendStrengthScore || 0, buyThresholds);
        const trendTotalReturnClass = this._getFactorClass('trendTotalReturn', tf.trendTotalReturn || 0, buyThresholds);
        const trendRiseRatioClass = this._getFactorClass('trendRiseRatio', tf.trendRiseRatio || 0, buyThresholds);
        const drawdownFromHighestClass = this._getFactorClass('drawdownFromHighest', tf.drawdownFromHighest || 0, buyThresholds);
        const tvlClass = this._getFactorClass('tvl', tf.tvl || 0, buyThresholds);

        trendFactorsHtml = `
          <div class="mt-2 pt-2 border-t border-amber-300">
            <div class="text-xs font-semibold text-amber-900 mb-1">📈 买入条件因子（趋势分析）</div>
            <div class="grid grid-cols-3 gap-2 text-xs">
              <div><span class="text-amber-800">代币年龄:</span> <span class="${ageClass}">${formatNum(tf.age)}分</span></div>
              <div><span class="text-amber-800">早期收益率:</span> <span class="${earlyReturnClass}">${formatPercent(tf.earlyReturn)}</span></div>
              <div><span class="text-amber-800">当前价格:</span> <span class="${currentPriceClass}">${formatNum(tf.currentPrice, 8)}</span></div>
              <div><span class="text-amber-800">获取价格:</span> <span class="${collectionPriceClass}">${formatNum(tf.collectionPrice, 8)}</span></div>
              ${tf.buyPrice !== undefined ? `<div><span class="text-amber-800">买入价格:</span> <span class="text-gray-900">${formatNum(tf.buyPrice, 8)}</span></div>` : ''}
              ${tf.highestPrice !== undefined ? `<div><span class="text-amber-800">最高价格:</span> <span class="text-gray-900">${formatNum(tf.highestPrice, 8)}</span></div>` : ''}
              ${tf.launchPrice !== undefined ? `<div><span class="text-amber-800">发行价格:</span> <span class="text-gray-900">${formatNum(tf.launchPrice, 8)}</span></div>` : ''}
              <div><span class="text-amber-800">趋势CV:</span> <span class="${trendCVClass}">${formatNum(tf.trendCV)}</span></div>
              <div><span class="text-amber-800">趋势斜率:</span> <span class="${trendSlopeClass}">${formatNum(tf.trendSlope)}</span></div>
              <div><span class="text-amber-800">趋势强度:</span> <span class="${trendStrengthScoreClass}">${formatNum(tf.trendStrengthScore)}</span></div>
              <div><span class="text-amber-800">总回报:</span> <span class="${trendTotalReturnClass}">${formatPercent(tf.trendTotalReturn)}</span></div>
              <div><span class="text-amber-800">上升比例:</span> <span class="${trendRiseRatioClass}">${formatNum(tf.trendRiseRatio)}</span></div>
              <div><span class="text-amber-800">距最高跌幅:</span> <span class="${drawdownFromHighestClass}">${formatPercent(tf.drawdownFromHighest)}</span></div>
              ${tf.trendPriceUp !== undefined ? `<div><span class="text-amber-800">价格上升:</span> <span class="text-gray-900">${tf.trendPriceUp >= 1 ? '✅' : '❌'}</span></div>` : ''}
              ${tf.trendMedianUp !== undefined ? `<div><span class="text-amber-800">中位数上升:</span> <span class="text-gray-900">${tf.trendMedianUp >= 1 ? '✅' : '❌'}</span></div>` : ''}
              ${tf.trendRecentDownRatio !== undefined ? `<div><span class="text-amber-800">近期下跌比:</span> <span class="text-gray-900">${formatNum(tf.trendRecentDownRatio)}</span></div>` : ''}
              <div><span class="text-amber-800">TVL:</span> <span class="${tvlClass}">$${formatNum(tf.tvl, 0)}</span></div>
              ${tf.fdv !== undefined ? `<div><span class="text-amber-800">FDV:</span> <span class="text-gray-900">$${formatNum(tf.fdv, 0)}</span></div>` : ''}
              ${tf.marketCap !== undefined ? `<div><span class="text-amber-800">市值:</span> <span class="text-gray-900">$${formatNum(tf.marketCap, 0)}</span></div>` : ''}
              ${tf.holders !== undefined ? `<div><span class="text-amber-800">持有者数:</span> <span class="text-gray-900">${tf.holders}</span></div>` : ''}
              ${tf.txVolumeU24h !== undefined ? `<div><span class="text-amber-800">24h交易量:</span> <span class="text-gray-900">$${formatNum(tf.txVolumeU24h / 1000)}K</span></div>` : ''}
              ${tf.riseSpeed !== undefined ? `<div><span class="text-amber-800">上升速度:</span> <span class="text-gray-900">${formatNum(tf.riseSpeed)}</span></div>` : ''}
              ${tf.profitPercent !== undefined ? `<div><span class="text-amber-800">利润率:</span> <span class="text-gray-900">${formatPercent(tf.profitPercent)}</span></div>` : ''}
              ${tf.holdDuration !== undefined ? `<div><span class="text-amber-800">持仓时长:</span> <span class="text-gray-900">${formatNum(tf.holdDuration / 60)}分</span></div>` : ''}
            </div>
          </div>
        `;
      }

      // 第二阶段：早期交易者黑白名单 + 持有者检查信息
      let holderCheckHtml = '';
      if (pf.earlyTraderBlacklistCount !== undefined || pf.holdersCount !== undefined) {
        const traderWhitelistClass = this._getFactorClass('earlyTraderWhitelistCount', pf.earlyTraderWhitelistCount || 0, preCheckThresholds);
        const traderBlacklistClass = this._getFactorClass('earlyTraderBlacklistCount', pf.earlyTraderBlacklistCount || 0, preCheckThresholds);
        const traderBlacklistRatioClass = this._getFactorClass('earlyTraderBlacklistRatio', pf.earlyTraderBlacklistRatio || 0, preCheckThresholds);
        const devClass = this._getFactorClass('devHoldingRatio', pf.devHoldingRatio || 0, preCheckThresholds);
        const maxClass = this._getFactorClass('maxHoldingRatio', pf.maxHoldingRatio || 0, preCheckThresholds);

        holderCheckHtml = `
          <div class="mt-2 pt-2 border-t border-amber-300">
            <div class="text-xs font-semibold text-amber-900 mb-1">👥 黑白名单 & 持有者检查因子</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div><span class="text-amber-800">交易者白名单:</span> <span class="${traderWhitelistClass}">${pf.earlyTraderWhitelistCount || 0}</span></div>
              <div><span class="text-amber-800">交易者黑名单:</span> <span class="${traderBlacklistClass}">${pf.earlyTraderBlacklistCount || 0}</span></div>
              <div><span class="text-amber-800">交易参与者:</span> <span class="text-gray-900">${pf.earlyTraderUniqueParticipants || 0}</span></div>
              <div><span class="text-amber-800">黑名单占比:</span> <span class="${traderBlacklistRatioClass}">${((pf.earlyTraderBlacklistRatio || 0) * 100).toFixed(1)}%</span></div>
              <div><span class="text-amber-800">持有人数:</span> <span class="text-gray-900">${pf.holdersCount || 0}</span></div>
              <div><span class="text-amber-800">Dev持有:</span> <span class="${devClass}">${formatPercent(pf.devHoldingRatio)}</span></div>
              <div><span class="text-amber-800">最大持仓:</span> <span class="${maxClass}">${formatPercent(pf.maxHoldingRatio)}</span></div>
              ${pf.earlyTraderCanBuy !== undefined ? `<div><span class="text-amber-800">交易者检查:</span> <span class="${pf.earlyTraderCanBuy ? 'text-green-600' : 'text-red-600'}">${pf.earlyTraderCanBuy ? '✅ 通过' : '❌ 失败'}</span></div>` : ''}
              ${pf.holderCanBuy !== undefined ? `<div><span class="text-amber-800">持有者检查:</span> <span class="${pf.holderCanBuy ? 'text-green-600' : 'text-red-600'}">${pf.holderCanBuy ? '✅ 通过' : '❌ 失败'}</span></div>` : ''}
            </div>
          </div>
        `;
      }

      // Twitter搜索因子
      let twitterHtml = '';
      const hasTwitterData = pf.twitterTotalResults !== undefined ||
                             pf.twitterQualityTweets !== undefined ||
                             pf.twitterTotalEngagement !== undefined;

      if (hasTwitterData) {
        const totalResultsClass = this._getFactorClass('twitterTotalResults', pf.twitterTotalResults || 0, preCheckThresholds);
        const qualityTweetsClass = this._getFactorClass('twitterQualityTweets', pf.twitterQualityTweets || 0, preCheckThresholds);
        const totalEngagementClass = this._getFactorClass('twitterTotalEngagement', pf.twitterTotalEngagement || 0, preCheckThresholds);
        const verifiedUsersClass = this._getFactorClass('twitterVerifiedUsers', pf.twitterVerifiedUsers || 0, preCheckThresholds);

        // 生成唯一ID用于弹窗
        const modalId = `twitter-modal-${signal.id}-${Date.now()}`;
        const hasRawResult = signal.twitter_search_result && Object.keys(signal.twitter_search_result).length > 0;

        twitterHtml = `
          <div class="mt-2 pt-2 border-t border-amber-300">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs font-semibold text-amber-900">🐦 Twitter搜索因子</div>
              ${hasRawResult ? `
                <button onclick="window.experimentSignals.showTwitterRawResult('${modalId}')" class="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded transition-colors flex items-center space-x-1">
                  <span>📋</span>
                  <span>原始结果</span>
                </button>
              ` : `
                <button disabled class="text-xs px-2 py-1 bg-gray-100 text-gray-400 rounded cursor-not-allowed flex items-center space-x-1" title="此信号无原始搜索结果">
                  <span>📋</span>
                  <span>无原始结果</span>
                </button>
              `}
            </div>
            <div class="grid grid-cols-3 gap-2 text-xs">
              <div><span class="text-amber-800">搜索结果:</span> <span class="${totalResultsClass}">${pf.twitterTotalResults || 0}</span></div>
              <div><span class="text-amber-800">质量推文:</span> <span class="${qualityTweetsClass}">${pf.twitterQualityTweets || 0}</span></div>
              <div><span class="text-amber-800">总互动:</span> <span class="${totalEngagementClass}">${pf.twitterTotalEngagement || 0}</span></div>
              <div><span class="text-amber-800">点赞数:</span> <span class="text-gray-900">${pf.twitterLikes || 0}</span></div>
              <div><span class="text-amber-800">转发数:</span> <span class="text-gray-900">${pf.twitterRetweets || 0}</span></div>
              <div><span class="text-amber-800">评论数:</span> <span class="text-gray-900">${pf.twitterComments || 0}</span></div>
              <div><span class="text-amber-800">平均互动:</span> <span class="text-gray-900">${formatNum(pf.twitterAvgEngagement)}</span></div>
              <div><span class="text-amber-800">认证用户:</span> <span class="${verifiedUsersClass}">${pf.twitterVerifiedUsers || 0}</span></div>
              <div><span class="text-amber-800">粉丝数:</span> <span class="text-gray-900">${(pf.twitterFollowers || 0) / 1000}K</span></div>
              <div><span class="text-amber-800">独立用户:</span> <span class="text-gray-900">${pf.twitterUniqueUsers || 0}</span></div>
              <div><span class="text-amber-800">搜索耗时:</span> <span class="text-gray-900">${pf.twitterSearchDuration || 0}ms</span></div>
              <div><span class="text-amber-800">搜索状态:</span> <span class="${pf.twitterSearchSuccess ? 'text-green-600' : 'text-red-600'}">${pf.twitterSearchSuccess ? '✅ 成功' : '❌ 失败'}</span></div>
            </div>
            ${pf.twitterSearchError ? `<div class="text-xs text-red-600 mt-1">错误: ${this._escapeHtml(pf.twitterSearchError)}</div>` : ''}
          </div>

          <!-- Twitter原始结果弹窗 -->
          ${hasRawResult ? `
            <div id="${modalId}" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div class="bg-gray-800 rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden border border-gray-600">
                <div class="flex items-center justify-between p-4 border-b border-gray-600">
                  <h3 class="text-lg font-semibold text-white">🐦 Twitter搜索原始结果</h3>
                  <button onclick="window.experimentSignals.closeTwitterModal('${modalId}')" class="text-gray-400 hover:text-white">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
                <div class="p-4 overflow-y-auto max-h-[calc(80vh-80px)]">
                  <pre class="text-xs text-green-400 bg-gray-900 p-4 rounded border border-gray-700 overflow-x-auto">${JSON.stringify(signal.twitter_search_result, null, 2)}</pre>
                </div>
              </div>
            </div>
          ` : ''}
        `;
      }

      // 第三阶段：早期参与者检查信息
      let earlyTradesHtml = '';
      if (pf.earlyTradesChecked === 1) {
        const hasTradeData = (pf.earlyTradesTotalCount || 0) > 0;

        if (hasTradeData) {
          const highValueCountClass = this._getFactorClass('earlyTradesHighValueCount', pf.earlyTradesHighValueCount || 0, preCheckThresholds);
          const highValuePerMinClass = this._getFactorClass('earlyTradesHighValuePerMin', pf.earlyTradesHighValuePerMin || 0, preCheckThresholds);
          const countPerMinClass = this._getFactorClass('earlyTradesCountPerMin', pf.earlyTradesCountPerMin || 0, preCheckThresholds);
          const volumePerMinClass = this._getFactorClass('earlyTradesVolumePerMin', pf.earlyTradesVolumePerMin || 0, preCheckThresholds);
          const actualSpanClass = this._getFactorClass('earlyTradesActualSpan', pf.earlyTradesActualSpan || 0, preCheckThresholds);
          const uniqueWalletsClass = this._getFactorClass('earlyTradesUniqueWallets', pf.earlyTradesUniqueWallets || 0, preCheckThresholds);
          const secondToFirstRatioClass = this._getFactorClass('walletClusterSecondToFirstRatio', pf.walletClusterSecondToFirstRatio || 0, preCheckThresholds);
          const megaRatioClass = this._getFactorClass('walletClusterMegaRatio', pf.walletClusterMegaRatio || 0, preCheckThresholds);

          earlyTradesHtml = `
            <div class="mt-2 pt-2 border-t border-amber-300">
              <div class="flex items-center justify-between mb-1">
                <div class="text-xs font-semibold text-amber-900">📊 早期参与者检查因子</div>
                <a href="/signal/${signal.id}/early-trades" target="_blank" class="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded transition-colors flex items-center space-x-1 no-underline">
                  <span>📋</span>
                  <span>原始交易数据</span>
                </a>
              </div>
              <div class="grid grid-cols-3 gap-2 text-xs">
                <div><span class="text-amber-800">高价值交易:</span> <span class="${highValueCountClass}">${pf.earlyTradesHighValueCount || 0}</span></div>
                <div><span class="text-amber-800">高价值/分:</span> <span class="${highValuePerMinClass}">${formatNum(pf.earlyTradesHighValuePerMin)}</span></div>
                <div><span class="text-amber-800">交易/分:</span> <span class="${countPerMinClass}">${formatNum(pf.earlyTradesCountPerMin)}</span></div>
                <div><span class="text-amber-800">交易量/分:</span> <span class="${volumePerMinClass}">$${formatNum(pf.earlyTradesVolumePerMin)}</span></div>
                <div><span class="text-amber-800">实际跨度:</span> <span class="${actualSpanClass}">${formatNum(pf.earlyTradesActualSpan)}秒</span></div>
                <div><span class="text-amber-800">总交易数:</span> <span class="text-gray-900">${pf.earlyTradesTotalCount || 0}</span></div>
                <div><span class="text-amber-800">独立钱包:</span> <span class="${uniqueWalletsClass}">${pf.earlyTradesUniqueWallets || 0}</span></div>
                <div><span class="text-amber-800">钱包/分:</span> <span class="text-gray-900">${formatNum(pf.earlyTradesWalletsPerMin)}</span></div>
                <div><span class="text-amber-800">总交易量:</span> <span class="text-gray-900">$${formatNum(pf.earlyTradesVolume)}</span></div>
                <div><span class="text-amber-800">检查窗口:</span> <span class="text-gray-900">${pf.earlyTradesWindow || 0}秒</span></div>
                <div><span class="text-amber-800">过滤后交易:</span> <span class="text-gray-900">${pf.earlyTradesFilteredCount || 0}</span></div>
                <div><span class="text-amber-800">检查耗时:</span> <span class="text-gray-900">${pf.earlyTradesCheckDuration || 0}ms</span></div>

                <div><span class="text-amber-800">聚簇数:</span> <span class="text-gray-900">${pf.walletClusterCount || 0}</span></div>
                <div><span class="text-amber-800">平均大小:</span> <span class="text-gray-900">${formatNum(pf.walletClusterAvgSize)}</span></div>
                <div><span class="text-amber-800">最大聚簇:</span> <span class="text-gray-900">${pf.walletClusterMaxClusterWallets || 0}</span></div>
                <div><span class="text-amber-800">Mega聚簇:</span> <span class="${megaRatioClass}">${formatNum(pf.walletClusterMegaRatio)}</span></div>
                <div><span class="text-amber-800">第二/第一比:</span> <span class="${secondToFirstRatioClass}">${formatNum(pf.walletClusterSecondToFirstRatio)}</span></div>
                <div><span class="text-amber-800">Top2聚簇比:</span> <span class="text-gray-900">${formatNum(pf.walletClusterTop2Ratio)}</span></div>
              </div>
            </div>
          `;
        } else {
          earlyTradesHtml = `
            <div class="mt-2 pt-2 border-t border-amber-300">
              <div class="text-xs font-semibold text-amber-900 mb-1">📊 早期参与者检查</div>
              <div class="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                ⚠️ 无交易数据 - AVE API 未返回该代币对的早期交易记录
              </div>
            </div>
          `;
        }
      }

      // 第四阶段：强势交易者持仓检查信息
      let strongTraderHtml = '';
      if (pf.strongTraderTradeCount !== undefined && pf.strongTraderTradeCount > 0) {
        const netPositionRatioClass = this._getFactorClass('strongTraderNetPositionRatio', pf.strongTraderNetPositionRatio || 0, preCheckThresholds);
        const totalBuyRatioClass = this._getFactorClass('strongTraderTotalBuyRatio', pf.strongTraderTotalBuyRatio || 0, preCheckThresholds);
        const totalSellRatioClass = this._getFactorClass('strongTraderTotalSellRatio', pf.strongTraderTotalSellRatio || 0, preCheckThresholds);
        const sellIntensityClass = this._getFactorClass('strongTraderSellIntensity', pf.strongTraderSellIntensity || 0, preCheckThresholds);

        strongTraderHtml = `
          <div class="mt-2 pt-2 border-t border-amber-300">
            <div class="text-xs font-semibold text-amber-900 mb-1">💪 强势交易者持仓因子</div>
            <div class="grid grid-cols-3 gap-2 text-xs">
              <div><span class="text-amber-800">净持仓比:</span> <span class="${netPositionRatioClass}">${formatPercent(pf.strongTraderNetPositionRatio)}</span></div>
              <div><span class="text-amber-800">总买入比:</span> <span class="${totalBuyRatioClass}">${formatPercent(pf.strongTraderTotalBuyRatio)}</span></div>
              <div><span class="text-amber-800">总卖出比:</span> <span class="${totalSellRatioClass}">${formatPercent(pf.strongTraderTotalSellRatio)}</span></div>
              <div><span class="text-amber-800">钱包数:</span> <span class="text-gray-900">${pf.strongTraderWalletCount || 0}</span></div>
              <div><span class="text-amber-800">交易数:</span> <span class="text-gray-900">${pf.strongTraderTradeCount || 0}</span></div>
              <div><span class="text-amber-800">卖出强度:</span> <span class="${sellIntensityClass}">${formatNum(pf.strongTraderSellIntensity)}</span></div>
            </div>
          </div>
        `;
      }

      // 构建条件检查详情
      let failedConditionsHtml = '';
      if (pr.failedConditions && pr.failedConditions.length > 0) {
        const failedItems = pr.failedConditions.map(fc => {
          const severityIcon = fc.severity === 'critical' ? '🔴' : fc.severity === 'warning' ? '⚠️' : 'ℹ️';

          // 子因子（复杂条件中的组成因子）的显示逻辑
          if (fc.isSubFactor) {
            return `
              <div class="flex items-start justify-between py-1 border-b border-amber-100 last:border-0 bg-amber-50">
                <div class="flex-1 pl-4">
                  <div class="text-xs text-amber-800">
                    <span class="font-medium">${fc.name}</span>
                  </div>
                  <div class="text-xs text-amber-600 ml-4">
                    <span class="text-gray-500">表达式:</span> <code class="text-xs bg-amber-100 px-1 rounded">${this._escapeHtml(fc.expression)}</code>
                  </div>
                </div>
                <div class="ml-2 text-right">
                  <div class="text-xs text-gray-600 font-medium">${this._escapeHtml(fc.actualFormatted)}</div>
                </div>
              </div>
            `;
          }

          // 正常条件的显示逻辑
          const statusIcon = fc.satisfied ? '✅' : '❌';
          const statusClass = fc.satisfied ? 'text-green-700' : 'text-red-700';

          // 风险指示：宽松/边缘
          let marginBadge = '';
          if (fc.satisfied && fc.margin === 'loose') {
            marginBadge = '<span class="ml-2 text-xs px-1.5 py-0.5 bg-green-200 text-green-800 rounded">🟢 宽松</span>';
          } else if (fc.satisfied && fc.margin === 'edge') {
            marginBadge = '<span class="ml-2 text-xs px-1.5 py-0.5 bg-yellow-200 text-yellow-800 rounded">🟡 边缘</span>';
          }

          return `
            <div class="flex items-start justify-between py-1 border-b border-amber-200 last:border-0 ${fc.isComplex ? 'bg-amber-50' : ''}">
              <div class="flex-1">
                <div class="text-xs text-amber-900">
                  <span class="mr-1">${severityIcon}</span>
                  <span class="font-semibold">${fc.name}</span>
                  ${marginBadge}
                </div>
                <div class="text-xs text-amber-700 ml-5">
                  <span class="text-gray-600">条件:</span> <code class="text-xs bg-amber-200 px-1 rounded">${this._escapeHtml(fc.expression)}</code>
                </div>
              </div>
              <div class="ml-2 text-right">
                <div class="text-xs ${statusClass} font-semibold">${statusIcon} ${fc.satisfied === null ? '-' : (fc.satisfied ? '满足' : '不满足')}</div>
                <div class="text-xs text-gray-600">实际: ${this._escapeHtml(fc.actualFormatted)}</div>
              </div>
            </div>
          `;
        }).join('');

        failedConditionsHtml = `
          <div class="mt-2 pt-2 border-t border-amber-300">
            <div class="text-xs font-semibold text-amber-900 mb-1">📋 条件检查详情</div>
            <div class="bg-white rounded p-2 border border-amber-200 max-h-80 overflow-y-auto">
              ${failedItems}
            </div>
            ${pr.reason ? `<div class="text-xs text-amber-800 mt-2">📝 ${this._escapeHtml(pr.reason)}</div>` : ''}
          </div>
        `;
      } else if (pr.reason) {
        failedConditionsHtml = `<div class="text-xs text-amber-800 mt-2 border-t border-amber-300 pt-2">${this._escapeHtml(pr.reason)}</div>`;
      }

      preBuyCheckHtml = `
        <div class="mt-2 p-3 bg-amber-100 rounded-lg border border-amber-300">
          <div class="flex items-center justify-between mb-2">
            <span class="text-amber-900 font-semibold text-sm">🔍 购买前置检查</span>
            <div class="flex items-center gap-1">
              ${checkResultBadge}
              ${skippedMatchBadge}
            </div>
          </div>
          ${strategyConfigHtml}
          ${trendFactorsHtml}
          ${holderCheckHtml}
          ${twitterHtml}
          ${earlyTradesHtml}
          ${strongTraderHtml}
          ${failedConditionsHtml}
        </div>
      `;
    }

    // 构建卖出策略信息（仅卖出信号）
    let sellStrategyHtml = '';
    if (signal.action.toUpperCase() === 'SELL') {
      const tf = metadata.trendFactors || {};
      const tradeResult = metadata.tradeResult || {};
      const buyPrice = tf.buyPrice || metadata.buyPrice || 0;

      // 🔥 获取卖出策略条件并解析阈值
      const sellCondition = this._getBuyCondition('sell', strategyId);
      const sellThresholds = sellCondition ? this._parseBuyCondition(sellCondition) : {};

      // 辅助函数：格式化数值
      const formatNum = (val, decimals = 2) => val !== undefined && val !== null ? val.toFixed(decimals) : 'N/A';
      const formatPercent = (val) => val !== undefined && val !== null ? val.toFixed(1) + '%' : 'N/A';

      // 显示实验配置的卖出策略条件
      let sellStrategyConfigHtml = '';
      if (sellCondition) {
        sellStrategyConfigHtml = `
          <div class="mb-2 pb-2 border-b border-blue-300">
            <div class="text-xs">
              <span class="font-semibold text-blue-900">📋 卖出条件配置:</span>
              <code class="ml-2 px-2 py-0.5 bg-blue-200 rounded text-xs text-blue-900 break-all">${this._escapeHtml(sellCondition)}</code>
            </div>
          </div>
        `;
      }

      // 卖出因子显示
      let sellFactorsHtml = '';
      if (Object.keys(tf).length > 0) {
        const drawdownClass = this._getFactorClass('drawdownFromHighest', tf.drawdownFromHighest || 0, sellThresholds);
        const holdDurationClass = this._getFactorClass('holdDuration', (tf.holdDuration || 0) / 60, sellThresholds);
        const profitPercentClass = tf.profitPercent >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold';

        sellFactorsHtml = `
          <div class="mt-2 pt-2 border-t border-blue-300">
            <div class="text-xs font-semibold text-blue-900 mb-1">📉 卖出决策因子</div>
            <div class="grid grid-cols-3 gap-2 text-xs">
              <div><span class="text-blue-800">代币年龄:</span> <span class="text-gray-900">${formatNum(tf.age)}分</span></div>
              <div><span class="text-blue-800">持仓时长:</span> <span class="${holdDurationClass}">${formatNum(tf.holdDuration / 60)}分</span></div>
              <div><span class="text-blue-800">利润率:</span> <span class="${profitPercentClass}">${formatPercent(tf.profitPercent)}</span></div>
              <div><span class="text-blue-800">买入价格:</span> <span class="text-gray-900">${formatNum(buyPrice, 8)}</span></div>
              <div><span class="text-blue-800">当前价格:</span> <span class="text-gray-900">${formatNum(tf.currentPrice, 8)}</span></div>
              <div><span class="text-blue-800">最高价格:</span> <span class="text-gray-900">${formatNum(tf.highestPrice, 8)}</span></div>
              <div><span class="text-blue-800">距最高跌幅:</span> <span class="${drawdownClass}">${formatPercent(tf.drawdownFromHighest)}</span></div>
              ${tf.earlyReturn !== undefined ? `<div><span class="text-blue-800">早期收益率:</span> <span class="text-gray-900">${formatPercent(tf.earlyReturn)}</span></div>` : ''}
              ${tf.trendStrengthScore !== undefined ? `<div><span class="text-blue-800">趋势强度:</span> <span class="text-gray-900">${formatNum(tf.trendStrengthScore)}</span></div>` : ''}
              ${tf.trendTotalReturn !== undefined ? `<div><span class="text-blue-800">总回报:</span> <span class="text-gray-900">${formatPercent(tf.trendTotalReturn)}</span></div>` : ''}
              ${tf.holdDuration !== undefined ? `<div><span class="text-blue-800">买入后时长:</span> <span class="text-gray-900">${formatNum(tf.holdDuration / 60)}分</span></div>` : ''}
              ${tf.trendRecentDownRatio !== undefined ? `<div><span class="text-blue-800">近期下跌比:</span> <span class="text-gray-900">${formatNum(tf.trendRecentDownRatio)}</span></div>` : ''}
              ${tf.trendConsecutiveDowns !== undefined ? `<div><span class="text-blue-800">连跌次数:</span> <span class="text-gray-900">${tf.trendConsecutiveDowns}</span></div>` : ''}
              ${tf.txVolumeU24h !== undefined ? `<div><span class="text-blue-800">24h交易量:</span> <span class="text-gray-900">$${formatNum(tf.txVolumeU24h / 1000)}K</span></div>` : ''}
            </div>
          </div>
        `;
      }

      // 交易结果信息
      let tradeResultHtml = '';
      if (tradeResult.trade && tradeResult.trade.success) {
        const trade = tradeResult.trade;
        const inputAmount = parseFloat(trade.inputAmount || 0);
        const outputAmount = parseFloat(trade.outputAmount || 0);
        const actualProfitPercent = inputAmount > 0 ? ((outputAmount - inputAmount) / inputAmount * 100) : 0;

        tradeResultHtml = `
          <div class="mt-2 pt-2 border-t border-blue-300">
            <div class="text-xs font-semibold text-blue-900 mb-1">💰 交易执行结果</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div><span class="text-blue-800">卖出数量:</span> <span class="text-gray-900">${formatNum(inputAmount)}</span></div>
              <div><span class="text-blue-800">获得金额:</span> <span class="text-gray-900">${formatNum(outputAmount, 4)} BNB</span></div>
              <div><span class="text-blue-800">实际利润率:</span> <span class="${actualProfitPercent >= 0 ? 'text-green-600' : 'text-red-600'}">${formatPercent(actualProfitPercent)}</span></div>
              <div><span class="text-blue-800">交易状态:</span> <span class="text-green-600">✅ 成功</span></div>
            </div>
          </div>
        `;
      }

      sellStrategyHtml = `
        <div class="mt-2 p-3 bg-blue-100 rounded-lg border border-blue-300">
          <div class="flex items-center justify-between mb-2">
            <span class="text-blue-900 font-semibold text-sm">📤 卖出策略检查</span>
            ${tradeResult.trade && tradeResult.trade.success ?
              '<span class="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">✅ 已执行</span>' :
              '<span class="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded-full">📊 决策信息</span>'
            }
          </div>
          ${sellStrategyConfigHtml}
          ${sellFactorsHtml}
          ${tradeResultHtml}
        </div>
      `;
    }

    // 构建卡牌位置变化信息
    let cardPositionHtml = '';
    if (metadata.cardPositionChange) {
      const pos = metadata.cardPositionChange;
      const before = pos.before || {};
      const after = pos.after || {};
      const transferred = pos.transferredCards;

      // 计算变化
      const bnbCardsChange = (after.bnbCards || 0) - (before.bnbCards || 0);
      const tokenCardsChange = (after.tokenCards || 0) - (before.tokenCards || 0);
      const bnbBalanceChange = (after.bnbBalance || 0) - (before.bnbBalance || 0);
      const tokenBalanceChange = (after.tokenBalance || 0) - (before.tokenBalance || 0);

      // 格式化数字
      const formatNum = (n) => n !== undefined ? n.toFixed(4) : 'N/A';
      const formatChange = (n) => n !== undefined ? (n >= 0 ? '+' : '') + n.toFixed(4) : 'N/A';

      cardPositionHtml = `
        <div class="mt-2 p-2 bg-blue-50 rounded border border-blue-200">
          <div class="flex items-center space-x-2 mb-1">
            <span class="text-blue-700 font-medium text-sm">🃏 卡牌位置变化</span>
            ${transferred !== undefined ? `<span class="text-blue-500 text-xs">(转移${transferred}卡)</span>` : ''}
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span class="text-gray-600">BNB卡:</span>
              <span class="text-gray-900">${before.bnbCards || 0}</span>
              <span class="text-blue-600">→</span>
              <span class="text-gray-900">${after.bnbCards || 0}</span>
              <span class="${bnbCardsChange >= 0 ? 'text-green-600' : 'text-red-600'}">(${formatChange(bnbCardsChange)})</span>
            </div>
            <div>
              <span class="text-gray-600">代币卡:</span>
              <span class="text-gray-900">${before.tokenCards || 0}</span>
              <span class="text-blue-600">→</span>
              <span class="text-gray-900">${after.tokenCards || 0}</span>
              <span class="${tokenCardsChange >= 0 ? 'text-green-600' : 'text-red-600'}">(${formatChange(tokenCardsChange)})</span>
            </div>
            <div>
              <span class="text-gray-600">BNB余额:</span>
              <span class="text-gray-900">${formatNum(before.bnbBalance)}</span>
              <span class="text-blue-600">→</span>
              <span class="text-gray-900">${formatNum(after.bnbBalance)}</span>
              <span class="${bnbBalanceChange >= 0 ? 'text-green-600' : 'text-red-600'}">(${formatChange(bnbBalanceChange)})</span>
            </div>
            <div>
              <span class="text-gray-600">代币余额:</span>
              <span class="text-gray-900">${formatNum(before.tokenBalance)}</span>
              <span class="text-blue-600">→</span>
              <span class="text-gray-900">${formatNum(after.tokenBalance)}</span>
              <span class="${tokenBalanceChange >= 0 ? 'text-green-600' : 'text-red-600'}">(${formatChange(tokenBalanceChange)})</span>
            </div>
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <div class="flex items-center space-x-3 mb-2">
            <span class="signal-badge ${badgeClass}">
              ${signal.action.toUpperCase() === 'BUY' ? '买入' : signal.action.toUpperCase() === 'SELL' ? '卖出' : '持有'}
            </span>
            <span class="text-sm font-medium text-gray-700">${signal.symbol || '代币'}</span>
            <span class="text-xs text-gray-400">${signalTime}</span>
            ${executedStatus}
          </div>
          <div class="flex items-center space-x-4 text-sm">
            ${priceInfo}
          </div>
          ${extraInfoHtml}
        </div>
      </div>

      ${rejectionInfoHtml}

      ${strategyInfoHtml}

      ${preBuyCheckHtml}

      ${sellStrategyHtml}

      ${cardPositionHtml}

      <details class="mt-3">
        <summary class="cursor-pointer text-xs text-blue-600 hover:text-blue-800">
          📋 查看完整元数据
        </summary>
        <div class="mt-2 p-3 bg-gray-50 rounded-md border border-gray-200">
          <pre class="text-xs bg-gray-900 text-green-400 p-2 rounded overflow-x-auto max-h-64 font-mono">${JSON.stringify(signal.metadata || {}, null, 2)}</pre>
        </div>
      </details>
    `;

    // 添加点击事件，高亮对应的K线标记
    card.addEventListener('click', () => {
      this.highlightSignal(signal);
    });

    return card;
  }

  getSignalClass(action, signal) {
    // 检查是否是被拒绝的信号
    if (signal && signal.execution_status === 'failed') {
      return 'signal-rejected';
    }
    switch (action.toUpperCase()) {
      case 'BUY': return 'signal-buy';
      case 'SELL': return 'signal-sell';
      case 'HOLD': return 'signal-hold';
      default: return 'signal-hold';
    }
  }

  getBadgeClass(action, signal) {
    // 检查是否是被拒绝的信号
    if (signal && signal.execution_status === 'failed') {
      return 'badge-rejected';
    }
    switch (action.toUpperCase()) {
      case 'BUY': return 'badge-buy';
      case 'SELL': return 'badge-sell';
      case 'HOLD': return 'badge-hold';
      default: return 'badge-hold';
    }
  }

  /**
   * 检查信号是否被拒绝
   * @param {Object} signal - 信号对象
   * @returns {boolean} 是否被拒绝
   */
  isSignalRejected(signal) {
    return signal && signal.execution_status === 'failed';
  }

  highlightSignal(signal) {
    // 在图表中高亮显示对应的信号
    if (this.chart) {
      const signalTime = new Date(signal.signal_timestamp).getTime();

      // 查找最近的K线
      const kline = this.klineData.find(k =>
        Math.abs(k.timestamp * 1000 - signalTime) < 30000 // 30秒内的匹配
      );

      if (kline) {
        // 添加高亮注释
        this.chart.options.plugins.annotation.annotations.highlight = {
          type: 'box',
          xMin: kline.timestamp * 1000 - 60000,
          xMax: kline.timestamp * 1000 + 60000,
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderColor: 'rgba(59, 130, 246, 0.3)',
          borderWidth: 1
        };

        this.chart.update();
      }
    }
  }

  applyFilters() {
    this.currentFilters.action = document.getElementById('action-filter').value;
    this.currentFilters.limit = parseInt(document.getElementById('limit').value);

    // 🔥 应用筛选时重新加载数据（因为limit可能改变）
    // 代币筛选不需要重新加载，因为我们在前端有所有数据
    this.loadData();
  }

  updateTimeRange(range) {
    // 这里可以根据时间范围重新加载数据
    console.log('🕐 更新时间范围:', range);
    // 实现时间范围过滤逻辑
  }

  updateChartType(type) {
    if (this.chart) {
      this.chart.config.type = type;
      this.chart.update();
    }
  }

  toggleAutoRefresh() {
    this.autoRefresh = !this.autoRefresh;
    const btn = document.getElementById('auto-refresh-btn');

    if (this.autoRefresh) {
      btn.textContent = '⏰ 自动刷新: 开启';
      btn.classList.remove('bg-gray-600');
      btn.classList.add('bg-green-600');

      // 启动自动刷新（每30秒）
      this.refreshInterval = setInterval(() => {
        this.loadData();
      }, 30000);
    } else {
      btn.textContent = '⏰ 自动刷新: 关闭';
      btn.classList.remove('bg-green-600');
      btn.classList.add('bg-gray-600');

      // 停止自动刷新
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = null;
      }
    }
  }

  exportSignals() {
    if (this.signals.length === 0) {
      alert('暂无信号数据可导出');
      return;
    }

    // 准备导出数据
    const exportData = this.signals.map(signal => ({
      时间: new Date(signal.signal_timestamp).toLocaleString('zh-CN'),
      代币: signal.symbol,
      动作: signal.action === 'buy' ? '买入' : signal.action === 'sell' ? '卖出' : '持有',
      置信度: `${((signal.confidence || 0) * 100).toFixed(1)}%`,
      价格: signal.price ? parseFloat(signal.price).toFixed(8) : 'N/A',
      原因: signal.reason || '策略信号',
      策略类型: signal.strategy_type
    }));

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
    link.download = `交易信号_${this.experimentId}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();

    console.log('📥 信号数据导出完成');
  }

  showError(message) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-message').classList.remove('hidden');
    document.getElementById('error-text').textContent = message;
  }

  hideError() {
    document.getElementById('error-message').classList.add('hidden');
  }

  /**
   * 🔥 获取GMGN区块链标识
   * @param {string} blockchain - 区块链标识
   * @returns {string} GMGN使用的区块链标识
   */
  getGMGNBlockchain(blockchain) {
    const gmgnBlockchainMap = {
      'bsc': 'bsc',
      'bnb': 'bsc',
      'binance': 'bsc',
      'sol': 'sol',
      'solana': 'sol',
      'base': 'base',
      'eth': 'eth',
      'ethereum': 'eth'
    };
    return gmgnBlockchainMap[blockchain?.toLowerCase()] || 'bsc';
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

  /**
   * 加载拒绝信号统计
   * @returns {Promise<void>}
   */
  async loadRejectionStats() {
    try {
      const response = await fetch(`/api/experiment/${this.experimentId}/rejection-stats`);
      const result = await response.json();

      if (result.success) {
        this.rejectionStats = result.data;
        this.updateRejectionStatsUI();
      }
    } catch (error) {
      console.error('加载拒绝统计失败:', error);
    }
  }

  /**
   * 更新拒绝统计UI
   */
  updateRejectionStatsUI() {
    if (!this.rejectionStats) return;

    // 更新拒绝信号总数
    const rejectedSignalsEl = document.getElementById('rejected-signals');
    if (rejectedSignalsEl) {
      rejectedSignalsEl.textContent = this.rejectionStats.totalRejected || 0;
    }

    // 更新拒绝原因明细
    this.renderRejectionDetails();
  }

  /**
   * 渲染拒绝原因明细
   */
  renderRejectionDetails() {
    const container = document.getElementById('rejection-reasons-list');
    if (!container || !this.rejectionStats) return;

    const byReason = this.rejectionStats.byReason || {};
    const entries = Object.entries(byReason).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      container.innerHTML = '<p class="text-gray-400 text-sm">暂无拒绝记录</p>';
      return;
    }

    const maxCount = entries[0][1];
    const totalCount = this.rejectionStats.totalRejected || 1;

    container.innerHTML = entries.map(([reason, count]) => {
      const percentage = ((count / totalCount) * 100).toFixed(1);
      const barWidth = ((count / maxCount) * 100).toFixed(1);

      return `
        <div class="flex items-center space-x-3">
          <div class="flex-1">
            <div class="flex items-center justify-between mb-1">
              <span class="text-sm text-gray-300">${this._escapeHtml(reason)}</span>
              <span class="text-sm text-gray-400">${count} (${percentage}%)</span>
            </div>
            <div class="rejection-reason-bar">
              <div class="rejection-reason-fill" style="width: ${barWidth}%"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * 切换拒绝原因明细的显示/隐藏
   */
  toggleRejectionDetails() {
    const detailsPanel = document.getElementById('rejection-details');
    if (detailsPanel) {
      detailsPanel.classList.toggle('hidden');
    }
  }

  /**
   * 显示Twitter原始结果弹窗
   * @param {string} modalId - 弹窗元素的ID
   */
  showTwitterRawResult(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  /**
   * 关闭Twitter原始结果弹窗
   * @param {string} modalId - 弹窗元素的ID
   */
  closeTwitterModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  /**
   * HTML转义工具方法
   * @private
   * @param {string} text - 要转义的文本
   * @returns {string} 转义后的文本
   */
  _escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 从实验配置中获取买入条件（触发条件）
   * @private
   * @param {string} action - 交易动作 ('buy' 或 'sell')
   * @param {string} strategyId - 策略ID (可选，如 'sell_3_4' 或 'buy_0_1')
   * @returns {string|null} 条件表达式
   */
  _getBuyCondition(action, strategyId = null) {
    if (!this.experimentConfig || !this.experimentConfig.strategiesConfig) {
      return null;
    }

    const strategiesConfig = this.experimentConfig.strategiesConfig;
    const strategies = action === 'buy' ? strategiesConfig.buyStrategies : strategiesConfig.sellStrategies;

    if (!strategies || !Array.isArray(strategies) || strategies.length === 0) {
      return null;
    }

    // 动态构建策略数组，添加 id 和 name 字段（因为数据库保存的是原始配置）
    const enrichedStrategies = strategies.map((s, idx) => ({
      ...s,
      id: s.id || `${action}_${idx}_${s.priority || 0}`,
      name: s.name || `${action === 'buy' ? '买入' : '卖出'}策略 P${s.priority || 0}`
    }));

    // 如果提供了 strategyId，查找对应的策略
    if (strategyId) {
      console.log(`[ExperimentSignals] 查找策略: action=${action}, strategyId=${strategyId}`);
      console.log(`[ExperimentSignals] 可用策略列表:`, enrichedStrategies.map(s => ({ id: s.id, name: s.name })));

      const strategy = enrichedStrategies.find(s => s.id === strategyId);
      if (strategy && strategy.condition) {
        console.log(`[ExperimentSignals] 找到匹配策略: ${strategy.name}, condition=${strategy.condition}`);
        return strategy.condition;
      }
      // 如果找不到对应策略，回退到第一个策略
      console.warn(`[ExperimentSignals] 未找到策略ID ${strategyId}，使用第一个策略的条件`);
    }

    // 获取第一个策略的触发条件
    const firstStrategy = enrichedStrategies[0];
    console.log(`[ExperimentSignals] 使用第一个策略: ${firstStrategy?.id} - ${firstStrategy?.name}`);
    return firstStrategy?.condition || null;
  }

  /**
   * 解析买入条件表达式，提取各因子的阈值
   * 支持的运算符: >=, <=, >, <, =, ==
   * @private
   * @param {string} condition - 条件表达式
   * @returns {Object} 因子名到阈值的映射 { factorName: { operator, value } }
   */
  _parseBuyCondition(condition) {
    if (!condition || typeof condition !== 'string') {
      return {};
    }

    const thresholds = {};

    // 匹配模式: factorName operator value
    // 支持的运算符: >=, <=, >, <, =, ==, AND, OR
    const patterns = [
      /(\w+)\s*(>=|<=|>|<|=|==)\s*(\d+\.?\d*)/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(condition)) !== null) {
        const [, factorName, operator, value] = match;
        thresholds[factorName] = {
          operator: operator,
          value: parseFloat(value)
        };
      }
    }

    return thresholds;
  }

  /**
   * 从实验配置中获取购买前检查条件
   * @private
   * @param {string} action - 交易动作 ('buy' 或 'sell')
   * @param {number} buyRound - 购买轮次 (1=首次购买, 2+=后续购买)
   * @returns {string|null} 条件表达式
   */
  _getPreBuyCheckCondition(action, buyRound = 1) {
    if (!this.experimentConfig || !this.experimentConfig.strategiesConfig) {
      return null;
    }

    const strategiesConfig = this.experimentConfig.strategiesConfig;
    const strategies = action === 'buy' ? strategiesConfig.buyStrategies : strategiesConfig.sellStrategies;

    if (!strategies || !Array.isArray(strategies) || strategies.length === 0) {
      return null;
    }

    const strategy = strategies[0];

    // 根据购买轮次返回对应的预检查条件
    if (buyRound === 1) {
      // 首次购买：使用 preBuyCheckCondition
      return strategy.preBuyCheckCondition || null;
    } else {
      // 后续购买：使用 repeatBuyCheckCondition
      return strategy.repeatBuyCheckCondition || null;
    }
  }

  /**
   * 解析预检查条件表达式，提取各因子的阈值
   * 支持的运算符: >=, <=, >, <, =, ==
   * @private
   * @param {string} condition - 条件表达式
   * @returns {Object} 因子名到阈值的映射 { factorName: { operator, value } }
   */
  _parsePreBuyCheckCondition(condition) {
    if (!condition || typeof condition !== 'string') {
      return {};
    }

    const thresholds = {};

    // 匹配模式: factorName operator value
    // 支持的运算符: >=, <=, >, <, =, ==, AND, OR
    const patterns = [
      /(\w+)\s*(>=|<=|>|<|=|==)\s*(\d+\.?\d*)/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(condition)) !== null) {
        const [, factorName, operator, value] = match;
        thresholds[factorName] = {
          operator: operator,
          value: parseFloat(value)
        };
      }
    }

    return thresholds;
  }

  /**
   * 检查因子值是否满足预检查条件
   * @private
   * @param {string} factorName - 因子名称
   * @param {number} factorValue - 因子值
   * @param {Object} thresholds - 从 _parsePreBuyCheckCondition 返回的阈值对象
   * @returns {boolean} 是否满足条件
   */
  _checkFactorMeetsCondition(factorName, factorValue, thresholds) {
    if (!thresholds || !thresholds[factorName]) {
      return true; // 没有条件要求，视为满足
    }

    const threshold = thresholds[factorName];
    const value = threshold.value;

    switch (threshold.operator) {
      case '>=':
        return factorValue >= value;
      case '<=':
        return factorValue <= value;
      case '>':
        return factorValue > value;
      case '<':
        return factorValue < value;
      case '=':
      case '==':
        return factorValue == value;
      default:
        return true;
    }
  }

  /**
   * 根据是否满足条件返回对应的 CSS 类
   * @private
   * @param {string} factorName - 因子名称
   * @param {number} factorValue - 因子值
   * @param {Object} thresholds - 阈值对象
   * @returns {string} CSS 类名
   */
  _getFactorClass(factorName, factorValue, thresholds) {
    if (this._checkFactorMeetsCondition(factorName, factorValue, thresholds)) {
      return 'text-green-700'; // 满足条件 - 绿色
    } else {
      return 'text-red-700 font-bold'; // 不满足条件 - 红色加粗
    }
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  window.experimentSignals = new ExperimentSignals();
});