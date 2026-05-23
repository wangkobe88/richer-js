/**
 * 实验分析页面 - K线图表展示
 * 提供K线图的可视化分析
 */

class ExperimentAnalysis {
  constructor() {
    this.experimentId = this.extractExperimentId();
    this.candlestickChart = null;
    this.klineData = [];
    this.experimentData = null;
    this.signals = [];

    // 🔥 多代币支持
    this.selectedToken = 'all';  // 当前选择的代币，'all'表示全部
    this.availableTokens = [];   // 可用的代币列表

    this.init();
  }

  /**
   * 初始化实验分析页面
   */
  async init() {
    console.log('🚀 实验分析页面初始化...', this.experimentId);

    try {
      // 等待Chart.js加载完成
      await this.waitForChartJS();

      // 加载实验数据
      await this.loadExperimentData();

      // 加载K线数据
      await this.loadKlineData();

      // 加载交易信号
      await this.loadSignals();

      // K线数据已在loadKlineData中获取完成

      // 初始化图表
      this.initCharts();

      // 隐藏加载指示器
      this.hideLoading();

      console.log('✅ 实验分析页面初始化完成');

    } catch (error) {
      console.error('❌ 实验分析页面初始化失败:', error);
      this.showError('初始化失败: ' + error.message);
    }
  }

  /**
   * 从URL中提取实验ID
   */
  extractExperimentId() {
    const pathParts = window.location.pathname.split('/');
    // URL格式: /experiment/:id/analysis
    // pathParts: ['', 'experiment', 'id', 'analysis']
    return pathParts[pathParts.length - 2];
  }

  /**
   * 加载实验数据
   */
  async loadExperimentData() {
    try {
      const response = await fetch(`/api/experiment/${this.experimentId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || '获取实验数据失败');
      }

      this.experimentData = data.data;

      // 🔥 提取代币列表并填充选择器
      this.extractTokensFromExperiment(this.experimentData);

      console.log('✅ 实验数据加载完成');

    } catch (error) {
      console.error('❌ 加载实验数据失败:', error);
      throw error;
    }
  }

  /**
   * 等待Chart.js加载完成
   */
  async waitForChartJS() {
    let attempts = 0;
    const maxAttempts = 20;

    while (typeof Chart === 'undefined' && attempts < maxAttempts) {
      console.log(`⏳ 等待Chart.js加载... (${attempts + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (typeof Chart === 'undefined') {
      throw new Error('Chart.js加载超时');
    }

    // 注册annotation插件
    if (typeof window !== 'undefined' && window.ChartAnnotation) {
      Chart.register(window.ChartAnnotation);
      console.log('✅ Chart.js annotation插件已注册');
    } else if (typeof ChartAnnotation !== 'undefined') {
      Chart.register(ChartAnnotation);
      console.log('✅ Chart.js annotation插件已注册');
    } else {
      console.warn('⚠️ Chart.js annotation插件未找到，信号标记将不可用');
    }

    console.log('✅ Chart.js已加载完成');
  }

  /**
   * 加载交易信号
   * @param {string} tokenId - 可选，代币地址
   */
  async loadSignals(tokenId = null) {
    try {
      const url = tokenId
        ? `/api/experiment/${this.experimentId}/signals?tokenAddress=${encodeURIComponent(tokenId)}`
        : `/api/experiment/${this.experimentId}/signals`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || '获取交易信号失败');
      }

      this.signals = data.signals || [];
      console.log('✅ 交易信号加载完成:', this.signals.length, '个信号');

    } catch (error) {
      console.error('❌ 加载交易信号失败:', error);
      this.signals = []; // 不阻塞页面初始化，使用空信号数组
    }
  }

  /**
   * 加载K线数据
   * @param {string} tokenId - 可选，代币地址
   */
  async loadKlineData(tokenId = null) {
    try {
      const url = tokenId
        ? `/api/experiment/${this.experimentId}/kline-with-indicators?tokenId=${encodeURIComponent(tokenId)}`
        : `/api/experiment/${this.experimentId}/kline-with-indicators`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || '获取K线数据失败');
      }

      this.klineData = data.data.map(item => ({
        time: new Date(item.time),
        timestamp: item.timestamp,
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
        volume: parseFloat(item.volume || 0),
        token_address: data.token?.address || item.token_address // 添加代币地址
      }));

      console.log('✅ K线数据加载完成:', this.klineData.length, '条记录');
      console.log('📊 后端计算统计:', data.stats);

    } catch (error) {
      console.error('❌ 加载K线数据失败:', error);
      throw error;
    }
  }

  /**
   * 🔥 加载特定代币的K线数据
   * @param {Object} token - 代币对象 { address, symbol, priority }
   */
  async loadKlineForToken(token) {
    try {
      console.log(`🔄 加载代币 ${token.symbol} (${token.address}) 的K线数据...`);

      // 显示加载状态
      const tokenInfo = document.getElementById('token-info');
      if (tokenInfo) {
        tokenInfo.innerHTML = `<span class="text-yellow-400">⏳ 正在加载 ${token.symbol} 的数据...</span>`;
      }

      // 重新加载K线数据（传入tokenId）
      await this.loadKlineData(token.address);

      // 重新加载信号数据（过滤该代币的信号）
      await this.loadSignals(token.address);

      // 重新初始化图表
      this.initCharts();

      console.log(`✅ 代币 ${token.symbol} 的K线图加载完成`);

      // 更新状态
      if (tokenInfo) {
        tokenInfo.innerHTML = `<span class="text-green-400">✅ 正在分析 ${token.symbol} 的数据</span>`;
      }

    } catch (error) {
      console.error(`❌ 加载代币 ${token.symbol} 的数据失败:`, error);

      // 更新状态
      const tokenInfo = document.getElementById('token-info');
      if (tokenInfo) {
        tokenInfo.innerHTML = `<span class="text-red-400">❌ 加载失败</span>`;
      }
    }
  }

  /**
   * 初始化图表
   */
  initCharts() {
    this.initCandlestickChart();
  }

  /**
   * 初始化K线图
   */
  initCandlestickChart() {
    console.log('🚀 开始初始化K线图...');

    // 检查Chart.js是否已加载
    if (typeof Chart === 'undefined') {
      console.error('❌ Chart.js 未加载，无法创建图表');
      throw new Error('图表库加载失败');
    }

    const canvas = document.getElementById('candlestick-chart');
    if (!canvas) {
      throw new Error('找不到K线图画布元素');
    }

    const ctx = canvas.getContext('2d');

    if (this.candlestickChart) {
      try {
        this.candlestickChart.destroy();
        this.candlestickChart = null;
        console.log('🗑️ 已销毁现有K线图表');
      } catch (error) {
        console.warn('销毁K线图表实例时出错:', error);
      }
    }

    // 确保canvas完全清空
    canvas.width = canvas.width;
    canvas.height = canvas.height;

    // 准备K线数据
    const candlestickData = this.klineData.map(kline => ({
      x: new Date(kline.time).getTime(),
      o: kline.open,
      h: kline.high,
      l: kline.low,
      c: kline.close
    }));

    // 准备信号标记
    const signalAnnotations = {};
    this.signals.forEach((signal, index) => {
      const signalTime = new Date(signal.signal_timestamp || signal.timestamp).getTime();

      // 找到最接近的K线时间点
      const closestKline = candlestickData.find(kline =>
        Math.abs(kline.x - signalTime) < 15 * 60 * 1000 // 15分钟K线间隔
      );

      if (closestKline) {
        const isBuy = signal.action === 'buy' || signal.trade_direction === 'buy';
        signalAnnotations[`signal_${index}`] = {
          type: 'point',
          xValue: closestKline.x,
          yValue: isBuy ? closestKline.o : closestKline.c, // 买在开盘价，卖在收盘价
          backgroundColor: isBuy ? '#10b981' : '#ef4444',
          borderColor: '#ffffff',
          borderWidth: 2,
          radius: 6,
          label: {
            display: true,
            content: isBuy ? '买入' : '卖出',
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

    console.log('📊 创建K线图表...', candlestickData.length, '个数据点, ', Object.keys(signalAnnotations).length, '个信号标记');

    try {
      this.candlestickChart = new Chart(ctx, {
        type: 'candlestick',
        data: {
          datasets: [{
            label: `${this.experimentData?.targetTokens?.[0]?.symbol || '代币'} K线`,
            data: candlestickData,
            borderColor: {
              up: '#10b981',
              down: '#ef4444',
              unchanged: '#6b7280'
            },
            backgroundColor: {
              up: 'rgba(16, 185, 129, 0.8)',
              down: 'rgba(239, 68, 68, 0.8)',
              unchanged: 'rgba(107, 114, 128, 0.8)'
            }
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'time',
              time: {
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
              position: 'right',
              grid: {
                color: 'rgba(156, 163, 175, 0.2)'
              },
              ticks: {
                color: '#9ca3af',
                callback: function(value) {
                  return value.toFixed(6);
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
                  return [
                    `开盘: ${data.o.toFixed(6)}`,
                    `最高: ${data.h.toFixed(6)}`,
                    `最低: ${data.l.toFixed(6)}`,
                    `收盘: ${data.c.toFixed(6)}`
                  ];
                }
              }
            }
          },
          annotation: {
            annotations: signalAnnotations
          }
        }
      });

      console.log('✅ K线图初始化完成');

    } catch (error) {
      console.error('❌ 创建K线图失败:', error);
      throw error;
    }
  }


  /**
   * 隐藏加载指示器
   */
  hideLoading() {
    const loadingElement = document.getElementById('loading');
    const chartsContainer = document.getElementById('charts-container');

    if (loadingElement) {
      loadingElement.classList.add('hidden');
    }

    if (chartsContainer) {
      chartsContainer.classList.remove('hidden');
    }
  }

  /**
   * 显示错误信息
   */
  showError(message) {
    const container = document.querySelector('main .max-w-7xl');
    if (container) {
      container.innerHTML = `
        <div class="bg-red-900 bg-opacity-20 border border-red-800 rounded-lg p-6 text-center">
          <h2 class="text-xl font-bold text-red-400 mb-2">❌ 加载失败</h2>
          <p class="text-red-300">${message}</p>
          <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-md text-white transition-colors">
            重新加载
          </button>
        </div>
      `;
    }
  }

  /**
   * 清理资源
   */
  destroy() {
    if (this.candlestickChart) {
      this.candlestickChart.destroy();
    }
    console.log('🧹 实验分析页面资源已清理');
  }

  /**
   * 🔥 从实验配置中提取代币列表
   */
  extractTokensFromExperiment(experiment) {
    if (!experiment.config?.targetTokens) {
      console.warn('⚠️ 实验配置中没有 targetTokens');
      return;
    }

    // 提取已启用的代币，按优先级排序
    this.availableTokens = experiment.config.targetTokens
      .filter(t => t.enabled)
      .map(t => ({
        address: t.address,
        symbol: t.symbol,
        priority: t.priority || 999
      }))
      .sort((a, b) => a.priority - b.priority);

    console.log('🔍 可用代币列表:', this.availableTokens);

    // 填充代币选择器
    this.populateTokenSelector();
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

    // 清空现有选项
    selector.innerHTML = '<option value="all">全部代币汇总</option>';

    // 添加代币选项
    this.availableTokens.forEach(token => {
      const option = document.createElement('option');
      option.value = token.address;
      option.textContent = `${token.symbol} (优先级: ${token.priority})`;
      selector.appendChild(option);
    });

    // 如果只有一个代币，禁用选择器
    if (this.availableTokens.length === 1) {
      selector.disabled = true;
      console.log('⚠️ 只有一个代币，禁用代币选择器');
    }

    // 绑定事件
    selector.addEventListener('change', async (e) => {
      const selectedTokenAddress = e.target.value;
      this.selectedToken = selectedTokenAddress;
      console.log('🔄 选择代币:', this.selectedToken);

      // 如果选择了具体代币（不是'all'），重新加载该代币的数据
      if (selectedTokenAddress !== 'all') {
        const selectedToken = this.availableTokens.find(t => t.address === selectedTokenAddress);
        if (selectedToken) {
          await this.loadKlineForToken(selectedToken);
          return; // loadKlineForToken 已经调用了 initCharts，不需要再调用 updateAnalysisForToken
        }
      }

      // 如果选择 'all'，调用原有的过滤逻辑
      this.updateAnalysisForToken();
    });

    console.log('✅ 代币选择器已填充');
  }

  /**
   * 🔥 根据选择的代币更新分析
   */
  async updateAnalysisForToken() {
    try {
      console.log('🔄 更新代币分析:', this.selectedToken);

      // 更新代币信息显示
      const tokenInfo = document.getElementById('token-info');
      if (this.selectedToken === 'all') {
        tokenInfo.textContent = '显示所有代币的汇总分析';
      } else {
        const token = this.availableTokens.find(t => t.address === this.selectedToken);
        if (token) {
          tokenInfo.textContent = `正在分析 ${token.symbol} 的数据`;
        }
      }

      // 过滤K线数据（按代币地址）
      const filteredKlineData = this.selectedToken === 'all'
        ? this.klineData
        : this.klineData.filter(k => k.token_address === this.selectedToken);

      // 过滤信号数据
      const filteredSignals = this.selectedToken === 'all'
        ? this.signals
        : this.signals.filter(s => s.token_address === this.selectedToken);

      console.log(`🔍 过滤后: K线${filteredKlineData.length}条, 信号${filteredSignals.length}条`);

      // 重新初始化图表
      if (filteredKlineData.length > 0) {
        // 销毁现有图表
        if (this.candlestickChart) {
          this.candlestickChart.destroy();
          this.candlestickChart = null;
        }

        // 使用过滤后的数据重新初始化图表
        this.initCandlestickChart(filteredKlineData, filteredSignals);
      } else {
        console.warn('⚠️ 没有可用的K线数据');
        if (tokenInfo) {
          tokenInfo.textContent = '该代币暂无K线数据';
        }
      }

    } catch (error) {
      console.error('❌ 更新代币分析失败:', error);
      const tokenInfo = document.getElementById('token-info');
      if (tokenInfo) {
        tokenInfo.textContent = '更新失败: ' + error.message;
      }
    }
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  window.experimentAnalysis = new ExperimentAnalysis();
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
  if (window.experimentAnalysis) {
    window.experimentAnalysis.destroy();
  }
});