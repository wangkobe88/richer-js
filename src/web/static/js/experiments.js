/**
 * 实验监控页面 - JavaScript模块
 * Richer-js Fourmeme Trading
 */

class ExperimentMonitor {
  constructor() {
    window.experimentMonitor = true;
    this.experiments = [];
    this.filters = {
      blockchain: 'all',
      status: 'all',
      mode: 'all'
    };
    this.init();
  }

  async init() {
    console.log('🚀 实验监控页面初始化...');
    this.bindEvents();
    await this.loadExperiments();
    this.hideLoading();
    console.log('✅ 实验监控页面初始化完成');
  }

  bindEvents() {
    const safeAddListener = (id, event, handler) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener(event, handler);
      }
    };

    safeAddListener('refresh-btn', 'click', () => this.loadExperiments());

    safeAddListener('blockchain-filter', 'change', (e) => {
      this.filters.blockchain = e.target.value;
      this.applyFilters();
    });

    safeAddListener('status-filter', 'change', (e) => {
      this.filters.status = e.target.value;
      this.applyFilters();
    });

    safeAddListener('mode-filter', 'change', (e) => {
      this.filters.mode = e.target.value;
      this.applyFilters();
    });

    safeAddListener('retry-btn', 'click', () => {
      this.hideError();
      this.loadExperiments();
    });
  }

  async loadExperiments() {
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (this.filters.blockchain !== 'all') params.append('blockchain', this.filters.blockchain);
      if (this.filters.status !== 'all') params.append('status', this.filters.status);
      if (this.filters.mode !== 'all') params.append('tradingMode', this.filters.mode);

      const response = await fetch('/api/experiments?' + params);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      this.experiments = data.data || [];

      this.applyFilters();
      this.updateStats();

      // 更新最后更新时间
      document.getElementById('last-update').textContent =
        new Date().toLocaleTimeString('zh-CN');

    } catch (error) {
      console.error('❌ 加载实验数据失败:', error);
      this.showError('加载实验数据失败: ' + error.message);
    }
  }

  applyFilters() {
    let filtered = [...this.experiments];

    if (this.filters.blockchain !== 'all') {
      filtered = filtered.filter(exp => exp.blockchain === this.filters.blockchain);
    }
    if (this.filters.status !== 'all') {
      filtered = filtered.filter(exp => exp.status === this.filters.status);
    }
    if (this.filters.mode !== 'all') {
      filtered = filtered.filter(exp => exp.tradingMode === this.filters.mode);
    }

    this.filteredExperiments = filtered;
    this.renderExperiments();
  }

  renderExperiments() {
    const container = document.getElementById('experiments-container');
    const emptyState = document.getElementById('empty-state');

    if (this.filteredExperiments.length === 0) {
      container.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    container.innerHTML = this.filteredExperiments.map(exp => this.renderExperimentCard(exp)).join('');
  }

  renderExperimentCard(exp) {
    const statusColors = {
      initializing: 'bg-gray-100 text-gray-800',
      running: 'bg-green-100 text-green-800',
      stopped: 'bg-yellow-100 text-yellow-800',
      completed: 'bg-blue-100 text-blue-800',
      failed: 'bg-red-100 text-red-800'
    };

    const modeColors = {
      virtual: 'bg-purple-100 text-purple-800',
      live: 'bg-orange-100 text-orange-800'
    };

    const statusLabel = {
      initializing: '未启动',
      running: '运行中',
      stopped: '已停止',
      completed: '已完成',
      failed: '失败'
    };

    const createdAt = new Date(exp.createdAt);
    const startedAt = exp.startedAt ? new Date(exp.startedAt) : null;
    const duration = startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 1000 / 60) : 0;

    return `
      <div class="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
        <div class="p-4">
          <div class="flex items-start justify-between mb-3">
            <h3 class="text-lg font-semibold text-gray-900 truncate flex-1">${exp.experimentName}</h3>
            <span class="ml-2 px-2 py-1 text-xs font-medium rounded ${statusColors[exp.status] || 'bg-gray-100'}">
              ${statusLabel[exp.status] || exp.status}
            </span>
          </div>

          <div class="space-y-2 text-sm">
            <div class="flex items-center justify-between">
              <span class="text-gray-800">交易模式:</span>
              <span class="px-2 py-0.5 text-xs font-medium rounded ${modeColors[exp.tradingMode]}">
                ${exp.tradingMode === 'virtual' ? '虚拟交易' : '实盘交易'}
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-gray-800">区块链:</span>
              <span class="font-medium">${exp.blockchain?.toUpperCase() || 'N/A'}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-gray-800">K线类型:</span>
              <span class="font-medium">${exp.klineType || 'N/A'}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-gray-800">创建时间:</span>
              <span class="font-medium">${createdAt.toLocaleString('zh-CN')}</span>
            </div>
            ${startedAt ? `
              <div class="flex items-center justify-between">
                <span class="text-gray-800">运行时长:</span>
                <span class="font-medium">${duration} 分钟</span>
              </div>
            ` : ''}
          </div>

          <div class="mt-4 pt-4 border-t border-gray-100 flex justify-between">
            <a href="/experiment/${exp.id}" class="text-blue-600 hover:text-blue-800 text-sm font-medium">
              查看详情 →
            </a>
            <div class="flex space-x-2">
              <a href="/experiment/${exp.id}/signals" class="text-green-600 hover:text-green-800 text-sm">
                信号
              </a>
              <a href="/experiment/${exp.id}/trades" class="text-purple-600 hover:text-purple-800 text-sm">
                交易
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  updateStats() {
    document.getElementById('total-experiments').textContent = this.experiments.length;
    document.getElementById('running-experiments').textContent =
      this.experiments.filter(exp => exp.status === 'running').length;

    // 获取总交易数（需要从各实验统计中汇总）
    let totalTrades = 0;
    this.experiments.forEach(exp => {
      if (exp.config?.results?.totalTrades) {
        totalTrades += exp.config.results.totalTrades;
      }
    });
    document.getElementById('total-trades').textContent = totalTrades;
  }

  hideLoading() {
    document.getElementById('loading').classList.add('hidden');
  }

  showError(message) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-message').classList.remove('hidden');
    document.getElementById('error-text').textContent = message;
  }

  hideError() {
    document.getElementById('error-message').classList.add('hidden');
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  new ExperimentMonitor();
});
