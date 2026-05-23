/**
 * 代币分析页面 - 独立的K线分析
 * 不依赖实验，用户自定义参数
 */

class TokenAnalysis {
  constructor() {
    this.klineData = [];
    this.candlestickChart = null;
    this.currentParams = null;

    this.init();
  }

  /**
   * 初始化代币分析页面
   */
  async init() {
    console.log('🚀 代币分析页面初始化...');

    try {
      // 绑定事件
      this.bindEvents();

      // 等待Chart.js加载完成
      await this.waitForChartJS();

      // 设置默认值
      this.setDefaults();

      console.log('✅ 代币分析页面初始化完成');

    } catch (error) {
      console.error('❌ 代币分析页面初始化失败:', error);
      this.showError('初始化失败: ' + error.message);
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

    console.log('✅ Chart.js已加载完成');
  }

  /**
   * 绑定事件处理器
   */
  bindEvents() {
    // 快速时间范围选择
    document.getElementById('quick-range').addEventListener('change', (e) => {
      this.setQuickRange(e.target.value);
    });

    // 分析按钮
    document.getElementById('analyze-btn').addEventListener('click', () => {
      this.analyze();
    });

    // 重置按钮
    document.getElementById('reset-btn').addEventListener('click', () => {
      this.reset();
    });

    // 导出按钮
    document.getElementById('export-btn').addEventListener('click', () => {
      this.exportData();
    });
  }

  /**
   * 设置默认值
   */
  setDefaults() {
    // 设置默认时间范围（最近7天）
    this.setQuickRange('7');

    // 设置默认K线类型
    document.getElementById('kline-type').value = '15m';
  }

  /**
   * 快速设置时间范围
   */
  setQuickRange(days) {
    if (!days) return;

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - parseInt(days));

    document.getElementById('end-date').value = end.toISOString().split('T')[0];
    document.getElementById('start-date').value = start.toISOString().split('T')[0];
  }

  /**
   * 获取并验证参数
   */
  getAndValidateParams() {
    const tokenId = document.getElementById('token-id').value.trim();
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const klineType = document.getElementById('kline-type').value;

    // 验证Token ID
    if (!tokenId) {
      return { valid: false, error: '请输入Token ID（代币地址-区块链）' };
    }

    // 解析Token ID
    const parsed = this.parseTokenId(tokenId);
    if (!parsed) {
      return { valid: false, error: 'Token ID格式无效，应为：代币地址-区块链（例如: 0x5c85d6c6825ab4032337f11ee92a72df936b46f6-bsc）' };
    }

    if (!startDate || !endDate) {
      return { valid: false, error: '请选择时间范围' };
    }

    if (new Date(startDate) >= new Date(endDate)) {
      return { valid: false, error: '开始日期必须早于结束日期' };
    }

    return {
      valid: true,
      tokenId, // 原始Token ID（包含blockchain）
      tokenAddress: parsed.tokenAddress,
      blockchain: parsed.blockchain,
      startTime: new Date(startDate + 'T00:00:00Z'),
      endTime: new Date(endDate + 'T23:59:59Z'),
      klineType
    };
  }

  /**
   * 解析Token ID
   * Token ID格式：{tokenAddress}-{blockchain}
   * 例如：0x5c85d6c6825ab4032337f11ee92a72df936b46f6-bsc
   */
  parseTokenId(tokenId) {
    const parts = tokenId.split('-');
    if (parts.length < 2) {
      return null;
    }

    // 最后一部分是区块链
    const blockchain = parts[parts.length - 1].toLowerCase();
    // 其余部分组合成代币地址
    const tokenAddress = parts.slice(0, -1).join('-');

    // 验证代币地址格式（0x开头的40位十六进制）
    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
      return null;
    }

    // 验证区块链标识（支持常见链）
    const supportedBlockchains = ['bsc', 'eth', 'polygon', 'arbitrum', 'optimism', 'base', 'sol'];
    if (!supportedBlockchains.includes(blockchain)) {
      return null;
    }

    return {
      tokenAddress,
      blockchain
    };
  }

  /**
   * 显示加载状态
   */
  showLoading(show) {
    const loadingEl = document.getElementById('loading');
    if (show) {
      loadingEl.classList.remove('hidden');
    } else {
      loadingEl.classList.add('hidden');
    }
  }

  /**
   * 显示错误信息
   */
  showError(message) {
    const errorEl = document.getElementById('error');
    const errorText = document.getElementById('error-text');
    errorText.textContent = message;
    errorEl.classList.remove('hidden');

    // 3秒后自动隐藏
    setTimeout(() => {
      errorEl.classList.add('hidden');
    }, 5000);
  }

  /**
   * 隐藏错误信息
   */
  hideError() {
    document.getElementById('error').classList.add('hidden');
  }

  /**
   * 显示/隐藏图表区域
   */
  showCharts(show) {
    const chartsSection = document.getElementById('charts-section');
    if (show) {
      chartsSection.classList.remove('hidden');
    } else {
      chartsSection.classList.add('hidden');
    }
  }

  /**
   * 开始分析
   */
  async analyze() {
    try {
      console.log('📊 开始分析...');

      // 1. 获取并验证参数
      const params = this.getAndValidateParams();
      if (!params.valid) {
        this.showError(params.error);
        return;
      }

      this.currentParams = params;
      this.hideError();

      // 2. 显示加载状态
      this.showLoading(true);
      this.showCharts(false);

      // 3. 获取K线数据
      await this.fetchKlineData(params);

      // 4. 初始化图表
      this.initCharts();

      // 5. 更新统计信息
      this.updateStats();

      // 6. 显示图表区域
      this.showCharts(true);

      console.log('✅ 分析完成');

    } catch (error) {
      console.error('❌ 分析失败:', error);
      this.showError(error.message);
    } finally {
      this.showLoading(false);
    }
  }

  /**
   * 获取K线数据
   */
  async fetchKlineData(params) {
    const url = new URL('/api/token/kline-with-indicators', window.location.origin);
    url.searchParams.append('tokenAddress', params.tokenAddress);
    url.searchParams.append('blockchain', params.blockchain);
    url.searchParams.append('startTime', params.startTime.toISOString());
    url.searchParams.append('endTime', params.endTime.toISOString());
    url.searchParams.append('klineType', params.klineType);

    console.log('📡 请求URL:', url.toString());

    const response = await fetch(url);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || '获取数据失败');
    }

    this.klineData = data.data.map(item => ({
      time: new Date(item.time),
      timestamp: item.timestamp,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume
    }));

    console.log('✅ K线数据加载完成:', this.klineData.length, '条记录');
  }

  /**
   * 初始化图表
   */
  initCharts() {
    // 销毁旧图表
    if (this.candlestickChart) {
      this.candlestickChart.destroy();
      this.candlestickChart = null;
    }

    this.initCandlestickChart();
  }

  /**
   * 初始化K线图
   */
  initCandlestickChart() {
    console.log('🚀 开始初始化K线图...');

    const canvas = document.getElementById('candlestick-chart');
    if (!canvas) {
      throw new Error('找不到K线图画布元素');
    }

    const ctx = canvas.getContext('2d');

    // 准备K线数据（x轴使用毫秒时间戳）
    const candlestickData = this.klineData.map(kline => ({
      x: new Date(kline.time).getTime(),
      o: kline.open,
      h: kline.high,
      l: kline.low,
      c: kline.close
    }));

    console.log('📊 K线数据样本:', candlestickData.slice(0, 3));

    const config = {
      type: 'candlestick',
      data: {
        datasets: [{
          label: '价格',
          data: candlestickData,
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
        scales: {
          x: {
            type: 'time',
            time: {
              unit: this.getTimeUnit(),
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
            grid: {
              color: 'rgba(156, 163, 175, 0.2)'
            },
            ticks: {
              color: '#9ca3af',
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
              color: '#f3f4f6'
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
          }
        }
      }
    };

    this.candlestickChart = new Chart(ctx, config);
    console.log('✅ K线图初始化完成');
  }

  /**
   * 获取时间单位
   */
  getTimeUnit() {
    const klineType = this.currentParams?.klineType || '15m';
    const intervalMinutes = this.klineTypeToMinutes(klineType);

    if (intervalMinutes < 60) {
      return 'minute';
    } else if (intervalMinutes < 1440) {
      return 'hour';
    } else {
      return 'day';
    }
  }

  /**
   * K线类型转换为分钟数
   */
  klineTypeToMinutes(klineType) {
    const map = {
      '1m': 1,
      '5m': 5,
      '15m': 15,
      '30m': 30,
      '1h': 60,
      '4h': 240,
      '1d': 1440
    };
    return map[klineType] || 15;
  }

  /**
   * 更新统计信息
   */
  updateStats() {
    document.getElementById('stat-count').textContent = this.klineData.length;

    const klineType = this.currentParams?.klineType || '15m';
    document.getElementById('stat-interval').textContent = klineType;

    const start = new Date(this.klineData[0].time);
    const end = new Date(this.klineData[this.klineData.length - 1].time);
    document.getElementById('stat-time-range').textContent =
      `${start.toLocaleDateString('zh-CN')} ~ ${end.toLocaleDateString('zh-CN')}`;
  }

  /**
   * 重置
   */
  reset() {
    // 清空输入
    document.getElementById('token-id').value = '';
    document.getElementById('token-preset').value = '';

    // 重置为默认值
    this.setDefaults();

    // 隐藏图表
    this.showCharts(false);

    // 销毁图表
    if (this.candlestickChart) {
      this.candlestickChart.destroy();
      this.candlestickChart = null;
    }

    // 清空数据
    this.klineData = [];
    this.currentParams = null;

    console.log('🔄 已重置');
  }

  /**
   * 导出数据
   */
  exportData() {
    if (this.klineData.length === 0) {
      this.showError('暂无数据可导出');
      return;
    }

    // 准备导出数据
    const exportData = this.klineData.map(item => ({
      时间: new Date(item.time).toLocaleString('zh-CN'),
      开盘: item.open.toFixed(4),
      最高: item.high.toFixed(4),
      最低: item.low.toFixed(4),
      收盘: item.close.toFixed(4),
      交易量: item.volume.toFixed(2)
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
    link.download = `代币分析_${this.currentParams?.tokenAddress}_${this.currentParams?.blockchain}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();

    console.log('📥 数据导出完成');
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  window.tokenAnalysis = new TokenAnalysis();
});
