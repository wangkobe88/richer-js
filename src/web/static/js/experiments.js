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
    safeAddListener('clear-all-btn', 'click', () => this.clearAllExperiments());

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

    // 使用事件委托处理删除和复制按钮点击
    const container = document.getElementById('experiments-container');
    if (container) {
      container.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('[data-action="delete"]');
        if (deleteBtn) {
          const id = deleteBtn.getAttribute('data-id');
          const name = deleteBtn.getAttribute('data-name');
          this.deleteExperiment(id, name);
          return;
        }

        const copyIdBtn = e.target.closest('[data-action="copy-id"]');
        if (copyIdBtn) {
          const id = copyIdBtn.getAttribute('data-id');
          this.copyExperimentId(id);
          return;
        }

        const copyExpBtn = e.target.closest('[data-action="copy-experiment"]');
        if (copyExpBtn) {
          const id = copyExpBtn.getAttribute('data-id');
          this.copyExperiment(id);
          return;
        }

        const editNameBtn = e.target.closest('[data-action="edit-name"]');
        if (editNameBtn) {
          const id = editNameBtn.getAttribute('data-id');
          const name = editNameBtn.getAttribute('data-name');
          this.openEditNameModal(id, name);
          return;
        }
      });
    }

    // 绑定模态框事件
    document.getElementById('cancel-edit-btn')?.addEventListener('click', () => {
      this.closeEditNameModal();
    });

    document.getElementById('save-name-btn')?.addEventListener('click', () => {
      this.saveExperimentName();
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
      live: 'bg-orange-100 text-orange-800',
      backtest: 'bg-blue-100 text-blue-800'
    };

    const statusLabel = {
      initializing: '未启动',
      running: '运行中',
      stopped: '已停止',
      completed: '已完成',
      failed: '失败'
    };

    const modeLabel = {
      virtual: '虚拟交易',
      live: '实盘交易',
      backtest: '回测'
    };

    // 区块链配置
    const blockchainConfig = {
      bsc: { name: 'BSC', logo: '/static/bsc-logo.png', color: '#F3BA2F' },
      base: { name: 'Base', logo: '/static/base-logo.png', color: '#0052FF' },
      solana: { name: 'Solana', logo: '/static/solana-logo.png', color: '#9945FF' }
    };

    // 平台配置（包含logo）
    const platformConfig = {
      fourmeme: { name: 'Four.meme', logo: '/static/fourmeme-logo.png' },
      flap: { name: 'Flap', logo: '/static/flap-logo.png' },
      bankr: { name: 'Bankr', logo: '/static/bankr-logo.png' },
      pumpfun: { name: 'Pump.fun', logo: '/static/pumpfun-logo.png' }
    };

    const createdAt = new Date(exp.createdAt);
    const startedAt = exp.startedAt ? new Date(exp.startedAt) : null;
    const stoppedAt = exp.stoppedAt ? new Date(exp.stoppedAt) : null;

    // 计算运行时长：从启动到停止，或从启动到现在（运行中）
    let duration = 0;
    if (startedAt) {
      const endTime = stoppedAt || new Date();
      duration = Math.floor((endTime.getTime() - startedAt.getTime()) / 1000 / 60);
    }

    // 格式化实验ID，显示前8位和后4位
    const shortId = exp.id.length > 12
      ? `${exp.id.substring(0, 8)}...${exp.id.substring(exp.id.length - 4)}`
      : exp.id;

    return `
      <div class="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
        <div class="p-4">
          <div class="mb-3">
            <div class="flex items-start justify-between mb-2">
              <h3 class="text-xl font-bold text-gray-100 break-words leading-tight flex-1 pr-3" title="${this._escapeHtml(exp.experimentName || exp.experiment_name)}">${exp.experimentName || exp.experiment_name || '未命名实验'}</h3>
              <div class="flex items-center gap-2 flex-shrink-0">
                <span class="px-2 py-1 text-xs font-medium rounded ${statusColors[exp.status] || 'bg-gray-100'}">
                  ${statusLabel[exp.status] || exp.status}
                </span>
                <button data-action="edit-name" data-id="${exp.id}" data-name="${this._escapeHtml(exp.experimentName || exp.experiment_name)}" class="text-gray-400 hover:text-blue-600 transition-colors" title="编辑名字">
                  ✏️
                </button>
              </div>
            </div>
          </div>

          <div class="space-y-2 text-sm">
            <div class="flex items-center justify-between">
              <span class="text-gray-800">实验ID:</span>
              <div class="flex items-center space-x-1">
                <code class="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">${shortId}</code>
                <button data-action="copy-id" data-id="${exp.id}" class="text-gray-500 hover:text-blue-600 transition-colors" title="复制完整ID">
                  📋
                </button>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-gray-800">交易模式:</span>
              <span class="px-2 py-0.5 text-xs font-medium rounded ${modeColors[exp.tradingMode] || 'bg-gray-100 text-gray-800'}">
                ${modeLabel[exp.tradingMode] || exp.tradingMode}
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-gray-800">区块链/平台:</span>
              <div class="flex items-center gap-2">
                ${(() => {
                  const platform = exp.platform || 'fourmeme';
                  const bc = exp.blockchain || 'bsc';
                  const platConfig = platformConfig[platform];
                  const bcConfig = blockchainConfig[bc];

                  let logos = '';
                  // 优先显示平台logo
                  if (platConfig && platConfig.logo) {
                    logos += `<img src="${platConfig.logo}" alt="${platConfig.name}" class="w-5 h-5 rounded-full" title="${platConfig.name}">`;
                  }
                  // 显示区块链logo（更小一点作为辅助）
                  if (bcConfig && bcConfig.logo) {
                    logos += `<img src="${bcConfig.logo}" alt="${bcConfig.name}" class="w-4 h-4 rounded-full opacity-70" title="${bcConfig.name}">`;
                  }
                  return logos || `<span class="font-medium">${platform}</span>`;
                })()}
              </div>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-gray-800">K线类型:</span>
              <span class="font-medium">${exp.klineType || 'N/A'}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-gray-800">开始时间:</span>
              <span class="font-medium">${this._formatBeijingTime(startedAt)}</span>
            </div>
            ${stoppedAt ? `
              <div class="flex items-center justify-between">
                <span class="text-gray-800">结束时间:</span>
                <span class="font-medium">${this._formatBeijingTime(stoppedAt)}</span>
              </div>
            ` : ''}
            <div class="flex items-center justify-between">
              <span class="text-gray-800">运行时长:</span>
              <span class="font-medium">${startedAt ? duration + ' 分钟' : '-'}</span>
            </div>
          </div>

          <div class="mt-4 pt-4 border-t border-gray-100">
            <div class="flex justify-between items-center mb-3">
              <a href="/experiment/${exp.id}" class="text-blue-600 hover:text-blue-800 text-sm font-medium">
                查看详情 →
              </a>
            </div>
            <div class="flex flex-wrap gap-2 mb-2">
              <a href="/experiment/${exp.id}/signals" class="text-green-600 hover:text-green-800 text-sm">
                信号
              </a>
              <a href="/experiment/${exp.id}/tokens" class="text-teal-600 hover:text-teal-800 text-sm">
                代币
              </a>
              <a href="/experiment/${exp.id}/trades" class="text-purple-600 hover:text-purple-800 text-sm">
                交易
              </a>
              <a href="/experiment/${exp.id}/observer" class="text-emerald-600 hover:text-emerald-800 text-sm">
                时序
              </a>
              <a href="/experiment/${exp.id}/token-returns" class="text-orange-600 hover:text-orange-800 text-sm">
                收益
              </a>
              <a href="/experiment/${exp.id}/strategy-analysis" class="text-pink-600 hover:text-pink-800 text-sm">
                策略
              </a>
              <a href="/token-holders?experiment=${exp.id}" class="text-cyan-600 text-sm" title="查看该实验的代币持有者信息">
                持有者
              </a>
            </div>
            <div class="flex justify-end gap-2">
              <button data-action="copy-experiment" data-id="${exp.id}" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium px-2 py-1 bg-indigo-50 hover:bg-indigo-100 rounded transition-colors">
                📋 复制
              </button>
              <button data-action="delete" data-id="${exp.id}" data-name="${this._escapeHtml(exp.experimentName)}" class="text-red-600 hover:text-red-800 text-sm font-medium px-2 py-1 bg-red-50 hover:bg-red-100 rounded transition-colors">
                🗑️ 删除
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 转义HTML特殊字符
   * @private
   * @param {string} text - 原始文本
   * @returns {string} 转义后的文本
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 格式化北京时间并显示时段
   * @private
   * @param {Date|string} date - 日期对象或ISO字符串
   * @returns {string} 格式化后的时间字符串
   */
  _formatBeijingTime(date) {
    if (!date) return '-';

    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '-';

    // 转换为北京时间 (UTC+8)
    // 使用 UTC 方法避免本地时区干扰
    let beijingHours = d.getUTCHours() + 8;
    let beijingDate = d.getUTCDate();
    let beijingMonth = d.getUTCMonth() + 1;
    let beijingYear = d.getUTCFullYear();

    // 处理跨日
    if (beijingHours >= 24) {
      beijingHours -= 24;
      beijingDate += 1;
      // 简单处理跨月（月末日期由 Date 对象自动处理）
      const tempDate = new Date(Date.UTC(beijingYear, beijingMonth - 1, beijingDate));
      beijingDate = tempDate.getUTCDate();
      beijingMonth = tempDate.getUTCMonth() + 1;
      beijingYear = tempDate.getUTCFullYear();
    }

    // 获取时段
    let period = '';
    if (beijingHours >= 0 && beijingHours < 6) {
      period = '凌晨';
    } else if (beijingHours >= 6 && beijingHours < 12) {
      period = '上午';
    } else if (beijingHours >= 12 && beijingHours < 18) {
      period = '下午';
    } else {
      period = '晚上';
    }

    // 格式化日期时间
    const month = String(beijingMonth).padStart(2, '0');
    const day = String(beijingDate).padStart(2, '0');
    const hours = String(beijingHours).padStart(2, '0');
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');
    const seconds = String(d.getUTCSeconds()).padStart(2, '0');

    return `${month}-${day} ${period}${hours}:${minutes}:${seconds}`;
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

  // 清空所有实验数据
  async clearAllExperiments() {
    const confirmed = confirm(
      '⚠️ 确定要清空所有实验数据吗？\n\n' +
      '此操作将删除：\n' +
      '📊 所有实验元数据\n' +
      '🪙 所有代币记录\n' +
      '💰 所有投资组合快照\n' +
      '📈 所有策略信号\n' +
      '💸 所有交易记录\n\n' +
      '⚠️ 此操作不可恢复！'
    );

    if (!confirmed) return;

    try {
      const response = await fetch('/api/experiments/clear-all', { method: 'DELETE' });
      const data = await response.json();

      if (data.success) {
        alert('✅ ' + data.message);
        await this.loadExperiments();
      } else {
        alert('❌ 清空失败: ' + data.error);
      }
    } catch (error) {
      console.error('清空数据失败:', error);
      alert('❌ 清空失败: ' + error.message);
    }
  }

  // 删除单个实验
  async deleteExperiment(experimentId, experimentName) {
    const confirmed = confirm(
      `⚠️ 确定要删除实验 "${experimentName}" 吗？\n\n` +
      '此操作将删除该实验的所有数据：\n' +
      '📊 实验元数据\n' +
      '🪙 代币记录\n' +
      '💰 投资组合快照\n' +
      '📈 策略信号\n' +
      '💸 交易记录\n\n' +
      '⚠️ 此操作不可恢复！'
    );

    if (!confirmed) return;

    try {
      const response = await fetch(`/api/experiment/${experimentId}`, { method: 'DELETE' });
      const data = await response.json();

      if (data.success) {
        alert('✅ 实验已删除');
        await this.loadExperiments();
      } else {
        alert('❌ 删除失败: ' + data.error);
      }
    } catch (error) {
      console.error('删除实验失败:', error);
      alert('❌ 删除失败: ' + error.message);
    }
  }

  /**
   * 复制实验ID到剪贴板
   * @param {string} experimentId - 实验ID
   */
  async copyExperimentId(experimentId) {
    try {
      await navigator.clipboard.writeText(experimentId);

      // 显示成功提示
      this.showCopySuccess(`✅ ID已复制: ${experimentId}`);
      console.log('✅ 实验ID已复制到剪贴板:', experimentId);

    } catch (error) {
      console.error('❌ 复制ID失败:', error);

      // 降级方案：使用传统方法
      try {
        const textArea = document.createElement('textarea');
        textArea.value = experimentId;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);

        this.showCopySuccess(`✅ ID已复制: ${experimentId}`);
      } catch (fallbackError) {
        console.error('❌ 降级复制也失败:', fallbackError);
        alert('❌ 复制失败，请手动复制ID');
      }
    }
  }

  /**
   * 复制实验配置并跳转到创建实验页面
   * @param {string} experimentId - 实验ID
   */
  async copyExperiment(experimentId) {
    try {
      console.log('📋 开始复制实验:', experimentId);

      // 显示复制状态
      this.showCopyLoading(experimentId);

      // 获取实验详细信息
      const response = await fetch(`/api/experiment/${experimentId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const experiment = result.data;

      console.log('📦 获取到实验数据:', experiment);

      // 构建复制数据
      const config = experiment.config || {};

      // 处理策略配置
      let buyStrategies = [];
      let sellStrategies = [];

      // 从 strategiesConfig 获取策略
      if (config.strategiesConfig) {
        buyStrategies = config.strategiesConfig.buyStrategies || [];
        sellStrategies = config.strategiesConfig.sellStrategies || [];
        console.log(`📋 从 strategiesConfig 加载: ${buyStrategies.length} 买入策略, ${sellStrategies.length} 卖出策略`);
      }

      const copyData = {
        // 基本信息
        experiment_name: (experiment.experimentName || experiment.experiment_name || '') + ' - 副本',
        experiment_description: (experiment.experimentDescription || experiment.experiment_description || '') + ' (复制的实验)',

        // 实验设置
        trading_mode: experiment.tradingMode || experiment.trading_mode || 'virtual',
        blockchain: experiment.blockchain || experiment.blockchain || 'bsc',
        kline_type: experiment.klineType || experiment.kline_type || '1m',

        // 策略配置 - 使用统一格式
        buyStrategies: buyStrategies,
        sellStrategies: sellStrategies,

        // 仓位管理
        positionManagement: config.positionManagement,

        // 回测配置
        backtest: config.backtest || config.backtestConfig,

        // 虚拟交易配置
        virtual: config.virtual || config.virtualConfig
      };

      // 添加 initial_balance 从 virtual 配置中获取
      if (config.virtual) {
        copyData.initial_balance = config.virtual.initialBalance || config.virtual.initial_balance || 100;
      }

      console.log('📋 准备复制的配置数据:', copyData);

      // 将配置存储到 sessionStorage
      sessionStorage.setItem('copyExperimentData', JSON.stringify(copyData));

      // 显示成功提示并跳转
      this.showCopySuccess('✅ 正在跳转到创建实验页面...');

      // 延迟跳转以便看到提示
      setTimeout(() => {
        window.location.href = '/create-experiment?copy=true';
      }, 500);

    } catch (error) {
      console.error('❌ 复制实验失败:', error);
      this.showCopyError(`复制实验失败: ${error.message}`);
    } finally {
      this.hideCopyLoading(experimentId);
    }
  }

  /**
   * 显示复制加载状态
   * @param {string} experimentId - 实验ID
   */
  showCopyLoading(experimentId) {
    const card = document.querySelector(`[data-id="${experimentId}"]`);
    if (!card) return;

    // 找到复制按钮并添加加载状态
    const copyBtn = card.querySelector('[data-action="copy-experiment"]');
    if (copyBtn) {
      copyBtn.disabled = true;
      copyBtn.innerHTML = '⏳ 复制中...';
    }
  }

  /**
   * 隐藏复制加载状态
   * @param {string} experimentId - 实验ID
   */
  hideCopyLoading(experimentId) {
    const card = document.querySelector(`[data-id="${experimentId}"]`);
    if (!card) return;

    const copyBtn = card.querySelector('[data-action="copy-experiment"]');
    if (copyBtn) {
      copyBtn.disabled = false;
      copyBtn.innerHTML = '📋 复制配置';
    }
  }

  /**
   * 显示复制错误提示
   * @param {string} message - 错误消息
   */
  showCopyError(message) {
    alert('❌ ' + message);
  }

  /**
   * 显示复制成功提示（临时通知）
   * @param {string} message - 提示消息
   */
  showCopySuccess(message) {
    // 创建临时通知元素
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-opacity duration-300';
    toast.textContent = message;
    document.body.appendChild(toast);

    // 2秒后淡出移除
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        document.body.removeChild(toast);
      }, 300);
    }, 2000);
  }

  /**
   * 打开编辑实验名字模态框
   * @param {string} experimentId - 实验ID
   * @param {string} currentName - 当前名字
   */
  openEditNameModal(experimentId, currentName) {
    const modal = document.getElementById('edit-name-modal');
    const input = document.getElementById('experiment-name-input');
    const idDisplay = document.getElementById('experiment-id-display');

    if (modal && input && idDisplay) {
      input.value = currentName || '';
      idDisplay.textContent = experimentId;
      input.dataset.experimentId = experimentId;

      modal.classList.remove('hidden');
    }
  }

  /**
   * 关闭编辑实验名字模态框
   */
  closeEditNameModal() {
    const modal = document.getElementById('edit-name-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  /**
   * 保存实验名字
   */
  async saveExperimentName() {
    const input = document.getElementById('experiment-name-input');
    const experimentId = input?.dataset.experimentId;

    if (!experimentId) {
      alert('❌ 无法获取实验ID');
      return;
    }

    const newName = input?.value?.trim();
    if (!newName) {
      alert('❌ 请输入实验名字');
      return;
    }

    try {
      const response = await fetch(`/api/experiment/${experimentId}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ experimentName: newName })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        this.closeEditNameModal();
        this.showCopySuccess('✅ 实验名字已更新');
        await this.loadExperiments();
      } else {
        alert('❌ 更新失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('❌ 更新实验名字失败:', error);
      alert('❌ 更新失败: ' + error.message);
    }
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  new ExperimentMonitor();
});
