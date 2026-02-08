/**
 * 交易信号页面JavaScript
 * 实现K线图展示和交易信号标记
 * Version: 3.4 - 清理日志，优化无数据提示
 */

class ExperimentSignals {
  constructor() {
    this.experimentId = null;
    this.klineData = [];
    this.signals = [];  // 原始信号数据（所有代币）
    this.chart = null;
    this.autoRefresh = true;
    this.refreshInterval = null;
    this.currentFilters = {
      action: 'all',
      limit: 10000  // 增加限制以获取所有信号
    };

    // 🔥 多代币支持
    this.selectedToken = 'all';  // 当前选择的代币，'all'表示全部
    this.availableTokens = [];   // 可用的代币列表

    // 🔥 回测模式支持
    this._isBacktest = false;    // 是否是回测实验
    this._sourceExperimentId = null;  // 源实验ID

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
      }

      // 🔥 检查是否是回测实验，如果是则显示源实验提示
      if (this._isBacktest && this._sourceExperimentId) {
        console.log('📊 [回测模式] 获取源实验信号数据:', this._sourceExperimentId);
        // 在页面标题中显示源实验信息
        this.updateBacktestHeader(this._sourceExperimentId);
      }

      // 然后加载信号数据（fetchSignals 内部会自动使用源实验ID）
      const signalsResponse = await this.fetchSignals();
      // console.log('📡 信号数据加载完成:', signalsResponse.signals?.length || 0, '条');
      // console.log('🔍 signalsResponse完整对象:', signalsResponse);

      // 更新信号数据（必须在 extractTokensFromExperiment 之前）
      this.signals = signalsResponse.signals || [];
      console.log('📊 已加载', this.signals.length, '条信号');

      // 🔥 从信号数据中提取代币列表并填充选择器
      this.extractTokensFromExperiment();

      // 更新信号统计
      this.updateSignalsStats();

      // 渲染信号列表（即使K线加载失败也要显示）
      this.renderSignals();

      // 尝试加载K线数据（不影响信号显示）
      try {
        console.log('📈 开始加载K线数据...');
        const klineResponse = await this.fetchKlineData();
        // console.log('📊 K线数据加载完成:', klineResponse.kline_data?.length || 0, '条');

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

    const container = canvas.parentElement;
    container.innerHTML = `
      <div class="flex items-center justify-center h-full bg-gray-100 rounded-lg border border-gray-300">
        <div class="text-center">
          <div class="text-yellow-600 text-lg mb-2">📊</div>
          <div class="text-gray-600 text-sm">${message}</div>
        </div>
      </div>
    `;
  }

  async fetchExperiment() {
    const response = await fetch(`/api/experiment/${this.experimentId}`);
    if (!response.ok) {
      throw new Error('获取实验信息失败');
    }
    return await response.json();
  }

  async fetchSignals(experimentId = null) {
    // 如果没有指定 experimentId，使用当前实验的 ID
    const targetId = experimentId || this.experimentId;

    const params = new URLSearchParams({
      limit: this.currentFilters.limit
    });

    if (this.currentFilters.action !== 'all') {
      params.append('action', this.currentFilters.action);
    }

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
   * 🔥 加载特定代币的时序数据（替代K线数据）
   * @param {Object} token - 代币对象 { address, symbol, priority }
   */
  async loadKlineForToken(token) {
    try {
      // 显示加载状态
      const chartWrapper = document.getElementById('kline-chart-wrapper');
      const chartContainer = document.querySelector('.chart-container');

      // 首先确保图表区域可见
      if (chartWrapper) {
        chartWrapper.style.display = 'block';
      }
      if (chartContainer) {
        chartContainer.style.display = 'block';
      }

      // 获取时序数据（替代K线数据）
      const timeSeriesResponse = await this.fetchTimeSeriesData(token.address);

      if (!timeSeriesResponse || !timeSeriesResponse.data || timeSeriesResponse.data.length === 0) {
        // 显示友好提示并隐藏整个图表区域
        if (chartWrapper) {
          chartWrapper.style.display = 'none';
        }
        return;
      }

      // 更新时序数据
      this.klineData = timeSeriesResponse.data;

      // 初始化价格折线图
      this.initPriceLineChart(timeSeriesResponse.data, token);

      console.log(`✅ 代币 ${token.symbol} 的时序数据图表加载完成`);

      // 更新状态
      if (chartStatus) {
        chartStatus.textContent = '数据就绪';
        chartStatus.className = 'px-3 py-1 bg-green-900 text-green-200 rounded-full text-sm font-medium';
      }

    } catch (error) {
      console.error(`❌ 加载代币 ${token.symbol} 的时序数据失败:`, error);

      // 隐藏图表区域
      const chartWrapper = document.getElementById('kline-chart-wrapper');
      if (chartWrapper) {
        chartWrapper.style.display = 'none';
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
   * 初始化价格折线图（使用时序数据）
   * @param {Array} timeSeriesData - 时序数据
   * @param {Object} token - 代币对象
   */
  initPriceLineChart(timeSeriesData, token) {
    const canvas = document.getElementById('kline-chart');
    if (!canvas) return;

    // 销毁旧图表
    if (this.chart) {
      this.chart.destroy();
    }

    const ctx = canvas.getContext('2d');

    // 🔥 价格乘以10亿得到市值
    const MARKET_CAP_MULTIPLIER = 1e9; // 10亿

    // 准备数据
    const labels = timeSeriesData.map(d => new Date(d.timestamp));
    const marketCaps = timeSeriesData.map(d => d.price_usd ? parseFloat(d.price_usd) * MARKET_CAP_MULTIPLIER : null);

    // 准备信号标记点
    const signalAnnotations = [];
    const tokenSignals = this.signals.filter(s =>
      (s.token_address || s.tokenAddress) === token.address
    );

    tokenSignals.forEach(signal => {
      const signalTime = new Date(signal.timestamp || signal.created_at);
      const signalType = signal.signal_type || signal.action?.toUpperCase();
      const isBuy = signalType === 'BUY';

      // 找到最接近的数据点
      const closestIndex = labels.findIndex(label => Math.abs(label - signalTime) < 30000); // 30秒内
      if (closestIndex >= 0 && marketCaps[closestIndex] !== null) {
        signalAnnotations.push({
          type: 'line',
          xMin: signalTime,
          xMax: signalTime,
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
          label: `${token.symbol} 市值`,
          data: marketCaps,
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
                if (value !== null) {
                  // 市值格式化为K（千）为单位
                  const marketCapInK = value / 1e3; // 转换为千
                  return `市值: ${marketCapInK.toFixed(1)}K`;
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

    console.log(`📊 市值折线图已初始化，包含 ${timeSeriesData.length} 个数据点和 ${signalAnnotations.length} 个信号标记`);
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

    // 🔥 设置回测状态
    this._isBacktest = experiment.tradingMode === 'backtest';
    if (this._isBacktest) {
      this._sourceExperimentId = experiment.config?.backtest?.sourceExperimentId || null;
    } else {
      this._sourceExperimentId = null;
    }

    // 🔥 使用 BlockchainConfig 获取区块链显示名称和 logo
    const blockchain = experiment.blockchain || 'unknown';
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
   * 🔥 从实验代币表获取代币列表
   */
  async extractTokensFromExperiment() {
    try {
      // 从已加载的信号数据中提取有信号的代币列表
      // 统计每个代币的信号数量
      const tokenSignalCounts = new Map();

      if (this.signals && this.signals.length > 0) {
        this.signals.forEach(signal => {
          const address = signal.token_address || signal.tokenAddress;
          const symbol = signal.token_symbol || signal.symbol || 'Unknown';

          if (!tokenSignalCounts.has(address)) {
            tokenSignalCounts.set(address, {
              address: address,
              symbol: symbol,
              signalCount: 0
            });
          }

          tokenSignalCounts.get(address).signalCount++;
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

    // 添加代币选项，显示信号数量和地址
    sortedTokens.forEach((token, index) => {
      const option = document.createElement('option');
      option.value = token.address;
      const signalCount = token.signalCount || 0;
      // 显示：代币符号 (信号数) - 地址前8位
      const shortAddress = token.address.length > 12
        ? `${token.address.substring(0, 8)}...`
        : token.address;
      option.textContent = `${token.symbol} (${signalCount} 条) - ${shortAddress}`;
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

    if (tokenInfoContainer) {
      if (this.selectedToken === 'all') {
        tokenInfoContainer.classList.add('hidden');
      } else {
        const token = this.availableTokens.find(t => t.address === this.selectedToken);
        if (token) {
          tokenInfoContainer.classList.remove('hidden');
          tokenAddressEl.textContent = token.address;

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
    const signalsToRender = signals !== null ? signals : this.signals;

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
    const signalClass = this.getSignalClass(signal.action);
    const badgeClass = this.getBadgeClass(signal.action);

    card.className = `signal-card ${signalClass} p-4`;

    const signalTime = new Date(signal.signal_timestamp).toLocaleString('zh-CN');

    const executedStatus = signal.executed ?
      '<span class="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">✅ 已执行</span>' :
      '<span class="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full">⏳ 未执行</span>';

    // 从 metadata 中获取策略信息
    const metadata = signal.metadata || {};
    const strategyName = metadata.strategyName || signal.strategyName || signal.reason || '策略信号';
    const strategyId = metadata.strategyId || signal.strategyId || null;

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
    const priceInfo = signal.price || metadata.price ?
      `<span class="text-gray-600">价格: <span class="font-medium text-gray-900">${parseFloat(signal.price || metadata.price).toFixed(8)}</span></span>` : '';

    // 构建额外信息（如果有）
    let extraInfoHtml = '';
    const extraInfo = [];
    if (metadata.profitPercent !== undefined && metadata.profitPercent !== null) {
      extraInfo.push(`收益率: ${metadata.profitPercent.toFixed(2)}%`);
    }
    if (metadata.holdDuration !== undefined && metadata.holdDuration !== null) {
      const holdSeconds = metadata.holdDuration;
      const holdMinutes = (holdSeconds / 60).toFixed(1);
      extraInfo.push(`持仓: ${holdMinutes}分钟`);
    }
    if (metadata.sellCalculatedRatio !== undefined && metadata.sellCalculatedRatio !== null) {
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

      ${strategyInfoHtml}

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

  getSignalClass(action) {
    switch (action.toUpperCase()) {
      case 'BUY': return 'signal-buy';
      case 'SELL': return 'signal-sell';
      case 'HOLD': return 'signal-hold';
      default: return 'signal-hold';
    }
  }

  getBadgeClass(action) {
    switch (action.toUpperCase()) {
      case 'BUY': return 'badge-buy';
      case 'SELL': return 'badge-sell';
      case 'HOLD': return 'badge-hold';
      default: return 'badge-hold';
    }
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
  window.experimentSignals = new ExperimentSignals();
});