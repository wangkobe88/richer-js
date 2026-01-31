/**
 * 简化的信号图表实现
 */

class SimpleSignalChart {
  constructor() {
    this.init();
  }

  init() {
    console.log('🚀 初始化简单信号图表...');

    // 等待DOM加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupChart());
    } else {
      this.setupChart();
    }
  }

  async setupChart() {
    console.log('📊 设置图表...');

    try {
      // 获取实验ID
      const pathParts = window.location.pathname.split('/');
      const experimentId = pathParts[pathParts.length - 2];
      console.log('🔍 实验ID:', experimentId);

      // 获取K线数据
      const response = await fetch(`/api/experiment/${experimentId}/kline`);
      const data = await response.json();

      console.log('📈 获取到数据:', data);

      if (data.kline_data && data.kline_data.length > 0) {
        this.createSimpleChart(data);
      } else {
        console.warn('⚠️ 没有K线数据');
        this.showNoDataMessage();
      }
    } catch (error) {
      console.error('❌ 设置图表失败:', error);
      this.showErrorMessage(error.message);
    }
  }

  createSimpleChart(data) {
    console.log('🎨 创建简单图表...');

    // 使用原生Canvas API创建简单图表
    const canvas = document.getElementById('kline-chart');
    if (!canvas) {
      console.error('❌ 找不到canvas元素');
      return;
    }

    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;

    // 设置canvas尺寸
    canvas.width = container.clientWidth - 40;
    canvas.height = 500;

    // 准备数据
    const klineData = data.kline_data;
    const signals = data.signals || [];

    console.log(`📊 处理 ${klineData.length} 个K线数据点`);
    console.log(`🎯 处理 ${signals.length} 个信号`);

    // 提取价格数据
    const prices = klineData.map(k => parseFloat(k.close_price));
    const timestamps = klineData.map(k => new Date(k.datetime));

    // 计算图表尺寸
    const padding = { top: 20, right: 60, bottom: 60, left: 60 };
    const chartWidth = canvas.width - padding.left - padding.right;
    const chartHeight = canvas.height - padding.top - padding.bottom;

    // 计算价格范围
    const minPrice = Math.min(...prices) * 0.98;
    const maxPrice = Math.max(...prices) * 1.02;
    const priceRange = maxPrice - minPrice;

    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制背景
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(padding.left, padding.top, chartWidth, chartHeight);

    // 绘制网格线
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;

    // 水平网格线
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartWidth, y);
      ctx.stroke();

      // 价格标签
      const price = maxPrice - (priceRange / 5) * i;
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(price.toFixed(4), padding.left - 10, y + 4);
    }

    // 垂直网格线
    const timePoints = Math.min(10, klineData.length);
    for (let i = 0; i < timePoints; i++) {
      const x = padding.left + (chartWidth / (timePoints - 1)) * i;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.stroke();
    }

    // 绘制价格线
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();

    prices.forEach((price, index) => {
      const x = padding.left + (chartWidth / (prices.length - 1)) * index;
      const y = padding.top + chartHeight - ((price - minPrice) / priceRange) * chartHeight;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // 绘制信号点
    signals.forEach(signal => {
      const signalTime = new Date(signal.signal_timestamp);
      const klineIndex = klineData.findIndex(k => {
        const klineTime = new Date(k.datetime);
        return Math.abs(klineTime - signalTime) < 15 * 60 * 1000; // 15分钟内的匹配
      });

      if (klineIndex >= 0) {
        const x = padding.left + (chartWidth / (klineData.length - 1)) * klineIndex;
        const price = prices[klineIndex];
        const y = padding.top + chartHeight - ((price - minPrice) / priceRange) * chartHeight;

        // 绘制信号点
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = signal.action === 'buy' ? '#10b981' : '#ef4444';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 绘制信号标签
        ctx.fillStyle = signal.action === 'buy' ? '#10b981' : '#ef4444';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(signal.action === 'buy' ? '买' : '卖', x, y - 10);
      }
    });

    // 添加图表标题
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `${data.token?.symbol || '代币'} 价格走势 (${data.interval_minutes}分钟)`,
      canvas.width / 2,
      15
    );

    console.log('✅ 简单图表创建完成');
  }

  showNoDataMessage() {
    const container = document.getElementById('kline-chart');
    if (container) {
      container.style.display = 'none';
      const parent = container.parentElement;
      parent.innerHTML = `
        <div class="flex items-center justify-center h-96 bg-gray-100 rounded-lg border border-gray-300">
          <div class="text-center">
            <div class="text-gray-500 text-lg mb-2">📊 暂无数据</div>
            <div class="text-gray-400 text-sm">该实验区间内没有K线数据</div>
          </div>
        </div>
      `;
    }
  }

  showErrorMessage(message) {
    const container = document.getElementById('kline-chart');
    if (container) {
      container.style.display = 'none';
      const parent = container.parentElement;
      parent.innerHTML = `
        <div class="flex items-center justify-center h-96 bg-gray-100 rounded-lg border border-gray-300">
          <div class="text-center">
            <div class="text-red-500 text-lg mb-2">⚠️ 图表加载失败</div>
            <div class="text-gray-600 text-sm">${message}</div>
            <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              刷新页面
            </button>
          </div>
        </div>
      `;
    }
  }
}

// 创建全局实例
window.simpleSignalChart = new SimpleSignalChart();