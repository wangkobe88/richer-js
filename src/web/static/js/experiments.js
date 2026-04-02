/**
 * 实验监控页面 - JavaScript模块
 * Richer-js Fourmeme Trading
 */

class ExperimentMonitor {
  constructor() {
    window.experimentMonitor = true;
    this.experiments = [];
    this.sourceExperimentNames = new Map(); // 缓存源实验名字
    this.filters = {
      blockchain: 'all',
      status: 'all',
      mode: 'all',
      virtualExpId: ''
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
    safeAddListener('analyze-btn', 'click', () => this.analyzeAllExperiments());

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

    safeAddListener('virtual-exp-filter', 'change', (e) => {
      this.filters.virtualExpId = e.target.value;
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

        const compressBtn = e.target.closest('[data-action="compress"]');
        if (compressBtn) {
          const id = compressBtn.getAttribute('data-id');
          const name = compressBtn.getAttribute('data-name');
          this.compressTimeSeries(id, name);
          return;
        }

        const cleanupBtn = e.target.closest('[data-action="cleanup"]');
        if (cleanupBtn) {
          const id = cleanupBtn.getAttribute('data-id');
          const name = cleanupBtn.getAttribute('data-name');
          this.cleanupTokens(id, name);
          return;
        }

        const tokenAnalysisBtn = e.target.closest('[data-action="token-analysis"]');
        if (tokenAnalysisBtn) {
          const id = tokenAnalysisBtn.getAttribute('data-id');
          const name = tokenAnalysisBtn.getAttribute('data-name');
          this.openTokenAnalysisModal(id, name);
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

    // 绑定压缩模态框事件
    document.getElementById('cancel-compress-btn')?.addEventListener('click', () => {
      this.closeCompressModal();
    });

    // 绑定压缩档位按钮事件
    document.querySelectorAll('.compress-threshold-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const threshold = parseInt(e.currentTarget.dataset.threshold);
        this.executeCompress(threshold);
      });
    });

    // 绑定涨幅分析模态框事件
    document.getElementById('cancel-token-analysis-btn')?.addEventListener('click', () => {
      this.closeTokenAnalysisModal();
    });

    document.getElementById('start-token-analysis-btn')?.addEventListener('click', () => {
      this.executeTokenAnalysis();
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

      // 加载源实验名字
      await this.loadSourceExperimentNames();

      // 填充虚拟实验下拉框
      this.populateVirtualExperimentsFilter();

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

  /**
   * 加载所有回测实验的源实验名字
   */
  async loadSourceExperimentNames() {
    // 收集所有唯一的源实验ID
    const sourceIds = new Set();
    this.experiments.forEach(exp => {
      if (exp.tradingMode === 'backtest' && exp.config?.backtest?.sourceExperimentId) {
        sourceIds.add(exp.config.backtest.sourceExperimentId);
      }
    });

    if (sourceIds.size === 0) return;

    // 批量获取源实验信息
    const promises = Array.from(sourceIds).map(async sourceId => {
      try {
        const response = await fetch(`/api/experiment/${sourceId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data) {
            return { id: sourceId, name: data.data.experimentName || data.data.experiment_name || '未知实验' };
          }
        }
      } catch (error) {
        console.error(`获取源实验名字失败 ${sourceId}:`, error);
      }
      return { id: sourceId, name: null };
    });

    const results = await Promise.all(promises);
    results.forEach(result => {
      if (result.name) {
        this.sourceExperimentNames.set(result.id, result.name);
      }
    });
  }

  /**
   * 填充虚拟实验下拉框
   */
  populateVirtualExperimentsFilter() {
    const select = document.getElementById('virtual-exp-filter');
    if (!select) return;

    // 获取所有虚拟实验
    const virtualExperiments = this.experiments.filter(exp => exp.tradingMode === 'virtual');

    // 保存当前选中的值
    const currentValue = select.value;

    // 清空现有选项（保留第一个"所有虚拟实验"选项）
    select.innerHTML = '<option value="">所有虚拟实验</option>';

    // 添加虚拟实验选项
    virtualExperiments.forEach(exp => {
      const option = document.createElement('option');
      option.value = exp.id;
      const name = exp.experimentName || exp.experiment_name || '未命名实验';
      const shortId = this._formatExperimentId(exp.id);
      option.textContent = `${name} (${shortId})`;
      option.title = `${name}\n${exp.id}`;
      select.appendChild(option);
    });

    // 恢复之前选中的值（如果仍然存在）
    if (currentValue && virtualExperiments.some(exp => exp.id === currentValue)) {
      select.value = currentValue;
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

    // 虚拟实验ID过滤：显示该虚拟实验本身以及依托其的回测实验
    if (this.filters.virtualExpId) {
      const targetId = this.filters.virtualExpId;
      filtered = filtered.filter(exp => {
        // 匹配虚拟实验ID本身
        if (exp.id === targetId) return true;
        // 匹配依托该虚拟实验的回测实验
        if (exp.tradingMode === 'backtest' && exp.config?.backtest?.sourceExperimentId === targetId) {
          return true;
        }
        return false;
      });
    }

    this.filteredExperiments = filtered;
    this.renderExperiments();
  }

  renderExperiments() {
    const tbody = document.getElementById('experiments-table-body');
    const emptyState = document.getElementById('empty-state');
    const container = document.getElementById('experiments-container');

    if (this.filteredExperiments.length === 0) {
      tbody.innerHTML = '';
      emptyState.classList.remove('hidden');
      container.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    container.classList.remove('hidden');
    tbody.innerHTML = this.filteredExperiments.map(exp => this.renderExperimentRow(exp)).join('');
  }

  renderExperimentRow(exp) {
    const statusColors = {
      initializing: 'bg-gray-600 text-gray-200',
      running: 'bg-green-700 text-green-100',
      stopped: 'bg-yellow-700 text-yellow-100',
      completed: 'bg-blue-700 text-blue-100',
      failed: 'bg-red-700 text-red-100'
    };

    const modeColors = {
      virtual: 'bg-purple-700 text-purple-100',
      live: 'bg-orange-700 text-orange-100',
      backtest: 'bg-blue-700 text-blue-100'
    };

    const statusLabel = {
      initializing: '未启动',
      running: '运行中',
      stopped: '已停止',
      completed: '已完成',
      failed: '失败'
    };

    const modeLabel = {
      virtual: '虚拟',
      live: '实盘',
      backtest: '回测'
    };

    const blockchainConfig = {
      bsc: { name: 'BSC', short: 'BSC' },
      base: { name: 'Base', short: 'Base' },
      solana: { name: 'Solana', short: 'Sol' },
      ethereum: { name: 'Ethereum', short: 'ETH' }
    };

    const createdAt = new Date(exp.createdAt);
    const startedAt = exp.startedAt ? new Date(exp.startedAt) : null;
    const stoppedAt = exp.stoppedAt ? new Date(exp.stoppedAt) : null;

    // 计算运行时长
    let duration = 0;
    if (startedAt) {
      const endTime = stoppedAt || new Date();
      duration = Math.floor((endTime.getTime() - startedAt.getTime()) / 1000 / 60);
    }

    // 格式化时长
    const formatDuration = (mins) => {
      if (mins < 60) return `${mins}m`;
      const hours = Math.floor(mins / 60);
      const remainingMins = mins % 60;
      return remainingMins > 0 ? `${hours}h${remainingMins}m` : `${hours}h`;
    };

    const stats = exp.stats || {};

    return `
      <tr class="hover:bg-gray-700 transition-colors">
        <!-- 实验名称 -->
        <td class="px-2 py-2">
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <div class="font-medium text-white text-sm break-words" title="${this._escapeHtml(exp.experimentName || exp.experiment_name)}">
                ${exp.experimentName || exp.experiment_name || '未命名实验'}
              </div>
              <button data-action="edit-name" data-id="${exp.id}" data-name="${this._escapeHtml(exp.experimentName || exp.experiment_name)}" class="text-gray-500 hover:text-blue-400 transition-colors text-xs" title="编辑名字">
                ✏️
              </button>
            </div>
            <div class="text-gray-500 text-xs font-mono" title="${exp.id}">
              ${this._formatExperimentId(exp.id)}
            </div>
          </div>
        </td>

        <!-- 状态 -->
        <td class="px-2 py-2 text-center">
          <span class="px-2 py-0.5 text-xs font-medium rounded ${statusColors[exp.status] || 'bg-gray-600'}">
            ${statusLabel[exp.status] || exp.status}
          </span>
        </td>

        <!-- 模式 -->
        <td class="px-2 py-2 text-center">
          <span class="px-2 py-0.5 text-xs font-medium rounded ${modeColors[exp.tradingMode] || 'bg-gray-600 text-gray-200'}">
            ${modeLabel[exp.tradingMode] || exp.tradingMode}
          </span>
        </td>

        <!-- 链 -->
        <td class="px-2 py-2 text-center">
          <span class="text-gray-300 text-xs">${blockchainConfig[exp.blockchain]?.short || exp.blockchain || '-'}</span>
        </td>

        <!-- 时长 -->
        <td class="px-2 py-2 text-right">
          <span class="text-gray-300 text-xs">${startedAt ? formatDuration(duration) : '-'}</span>
        </td>

        <!-- 开始时间 -->
        <td class="px-2 py-2">
          <div class="text-gray-300 text-xs leading-tight">${startedAt ? this._formatBeijingTime(startedAt) : '-'}</div>
        </td>

        <!-- 结束时间 -->
        <td class="px-2 py-2">
          <div class="text-gray-300 text-xs leading-tight">${stoppedAt ? this._formatBeijingTime(stoppedAt) : (exp.status === 'running' ? '运行中' : '-')}</div>
        </td>

        <!-- 代币数 -->
        <td class="px-2 py-2 text-right">
          <span class="text-gray-300 text-xs">${stats.tokenCount || 0}</span>
        </td>

        <!-- 胜率 -->
        <td class="px-2 py-2 text-right">
          <span class="text-xs font-medium ${stats.winRate >= 50 ? 'text-green-400' : 'text-red-400'}">
            ${stats.winRate?.toFixed(1) || 0}%
          </span>
        </td>

        <!-- 收益率 -->
        <td class="px-2 py-2 text-right">
          <span class="text-xs font-medium ${stats.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}">
            ${stats.totalReturn >= 0 ? '+' : ''}${(stats.totalReturn || 0).toFixed(1)}%
          </span>
        </td>

        <!-- BNB变化 -->
        <td class="px-2 py-2 text-right">
          <span class="text-xs font-medium ${stats.bnbChange >= 0 ? 'text-green-400' : 'text-red-400'}">
            ${stats.bnbChange >= 0 ? '+' : ''}${(stats.bnbChange || 0).toFixed(2)}
          </span>
        </td>

        <!-- 源实验 -->
        <td class="px-2 py-2">
          ${exp.tradingMode === 'backtest' && exp.config?.backtest?.sourceExperimentId ? `
            <a href="/experiment/${exp.config.backtest.sourceExperimentId}" target="_blank" class="text-blue-400 hover:text-blue-300 text-xs truncate block max-w-[100px]" title="${this.sourceExperimentNames.get(exp.config.backtest.sourceExperimentId) || ''}">
              ${this.sourceExperimentNames.get(exp.config.backtest.sourceExperimentId) || this._formatExperimentId(exp.config.backtest.sourceExperimentId)}
            </a>
          ` : '<span class="text-gray-500 text-xs">-</span>'}
        </td>

        <!-- 操作按钮 -->
        <td class="px-2 py-2">
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-1 flex-wrap">
              <button data-action="copy-id" data-id="${exp.id}" class="text-xs px-1.5 py-0.5 text-yellow-400 hover:bg-yellow-900 rounded transition-colors" title="复制ID">📋ID</button>
              <a href="/experiment/${exp.id}" target="_blank" class="text-xs px-1.5 py-0.5 text-blue-400 hover:bg-blue-900 rounded transition-colors">详情</a>
              <a href="/experiment/${exp.id}/signals" target="_blank" class="text-xs px-1.5 py-0.5 text-green-400 hover:bg-green-900 rounded transition-colors">信号</a>
              <a href="/experiment/${exp.id}/signal-stats" target="_blank" class="text-xs px-1.5 py-0.5 text-lime-400 hover:bg-lime-900 rounded transition-colors">信号统计</a>
              <a href="/experiment/${exp.id}/tokens" target="_blank" class="text-xs px-1.5 py-0.5 text-teal-400 hover:bg-teal-900 rounded transition-colors">代币</a>
              <a href="/experiment/${exp.id}/trades" target="_blank" class="text-xs px-1.5 py-0.5 text-purple-400 hover:bg-purple-900 rounded transition-colors">交易</a>
            </div>
            <div class="flex items-center gap-1 flex-wrap">
              <a href="/experiment/${exp.id}/token-returns" target="_blank" class="text-xs px-1.5 py-0.5 text-orange-400 hover:bg-orange-900 rounded transition-colors">收益</a>
              <a href="/experiment/${exp.id}/narrative" target="_blank" class="text-xs px-1.5 py-0.5 text-emerald-400 hover:bg-emerald-900 rounded transition-colors">叙事</a>
              <a href="/experiment/${exp.id}/strategy-analysis" target="_blank" class="text-xs px-1.5 py-0.5 text-pink-400 hover:bg-pink-900 rounded transition-colors">策略</a>
              <a href="/token-holders?experiment=${exp.id}" target="_blank" class="text-xs px-1.5 py-0.5 text-cyan-400 hover:bg-cyan-900 rounded transition-colors">持有者</a>
              <button data-action="copy-experiment" data-id="${exp.id}" class="text-xs px-1.5 py-0.5 text-indigo-400 hover:bg-indigo-900 rounded transition-colors" title="复制">📋复制</button>
              ${exp.tradingMode !== 'backtest' ? `<button data-action="token-analysis" data-id="${exp.id}" data-name="${this._escapeHtml(exp.experimentName)}" class="text-xs px-1.5 py-0.5 text-blue-400 hover:bg-blue-900 rounded transition-colors" title="分析代币涨幅">📊涨幅</button>` : ''}
              ${exp.tradingMode !== 'backtest' ? `<button data-action="compress" data-id="${exp.id}" data-name="${this._escapeHtml(exp.experimentName)}" class="text-xs px-1.5 py-0.5 text-amber-400 hover:bg-amber-900 rounded transition-colors" title="压缩时序数据">🗜️压缩</button>` : ''}
              ${exp.tradingMode !== 'backtest' ? `<button data-action="cleanup" data-id="${exp.id}" data-name="${this._escapeHtml(exp.experimentName)}" class="text-xs px-1.5 py-0.5 text-red-400 hover:bg-red-900 rounded transition-colors" title="清理无价格数据的代币">🧹清理</button>` : ''}
              <button data-action="delete" data-id="${exp.id}" data-name="${this._escapeHtml(exp.experimentName)}" class="text-xs px-1.5 py-0.5 text-red-400 hover:bg-red-900 rounded transition-colors" title="删除">🗑️删除</button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  /**
   * 格式化实验ID为简短形式
   * @private
   * @param {string} experimentId - 实验ID
   * @returns {string} 格式化后的ID
   */
  _formatExperimentId(experimentId) {
    if (!experimentId) return '-';
    return experimentId.length > 12
      ? `${experimentId.substring(0, 8)}...${experimentId.substring(experimentId.length - 4)}`
      : experimentId;
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

    return `${month}-${day}<br>${period}${hours}:${minutes}:${seconds}`;
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
        virtual: config.virtual || config.virtualConfig,

        // 平台选择
        platform: config.platform || 'fourmeme'
      };

      // 添加 initial_balance 从 virtual 配置中获取
      if (config.virtual) {
        copyData.initial_balance = config.virtual.initialBalance || config.virtual.initial_balance || 100;
      }

      // 添加 strategiesConfig 中的高级配置
      if (config.strategiesConfig) {
        const sc = config.strategiesConfig;

        // 叙事分析配置
        if (sc.narrativeAnalysis) {
          copyData.narrativeAnalysis = sc.narrativeAnalysis;
        }

        // 统计配置
        if (sc.stats) {
          copyData.stats = sc.stats;
        }

        // 电报通知配置
        if (sc.telegramNotifications) {
          copyData.telegramNotifications = sc.telegramNotifications;
        }
      }

      // 实盘配置（不复制私钥，需要用户重新输入）
      if (config.wallet && config.wallet.address) {
        copyData.wallet_address = config.wallet.address;
        // 不复制私钥，出于安全考虑
        copyData.reserve_amount = config.reserveNative || 0.1;
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

  /**
   * 分析所有实验的统计数据
   */
  async analyzeAllExperiments() {
    const confirmed = confirm(
      '⚠️ 确定要分析所有实验的统计数据吗？\n\n' +
      '此操作将：\n' +
      '📊 计算每个实验的交易代币数、胜率、收益率等统计数据\n' +
      '💾 将统计数据保存到 experiments 表的 stats 字段\n' +
      '⏱️ 跳过已有统计数据的实验\n\n' +
      '⚠️ 此操作可能需要较长时间，请耐心等待...'
    );

    if (!confirmed) return;

    const analyzeBtn = document.getElementById('analyze-btn');
    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = '⏳ 分析中...';
    }

    try {
      const response = await fetch('/api/experiments/analyze-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        const { total, processed, failed, skipped } = result.data;

        let message = `✅ 分析完成！\n\n`;
        message += `📊 总实验数: ${total}\n`;
        message += `✅ 成功分析: ${processed}\n`;
        message += `⏭️ 跳过: ${skipped}\n`;
        if (failed > 0) {
          message += `❌ 失败: ${failed}\n`;
        }

        alert(message);

        // 刷新实验列表以显示新的统计数据
        await this.loadExperiments();
      } else {
        alert('❌ 分析失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('❌ 分析实验统计数据失败:', error);
      alert('❌ 分析失败: ' + error.message);
    } finally {
      if (analyzeBtn) {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = '📊 分析';
      }
    }
  }

  /**
   * 压缩实验时序数据
   * @param {string} experimentId - 实验ID
   * @param {string} experimentName - 实验名称
   */
  async compressTimeSeries(experimentId, experimentName) {
    // 打开压缩档位选择模态框
    this.openCompressModal(experimentId, experimentName);
  }

  /**
   * 打开压缩档位选择模态框
   * @param {string} experimentId - 实验ID
   * @param {string} experimentName - 实验名称
   */
  openCompressModal(experimentId, experimentName) {
    const modal = document.getElementById('compress-modal');
    const nameDisplay = document.getElementById('compress-experiment-name');

    if (modal && nameDisplay) {
      nameDisplay.textContent = `实验: ${experimentName}`;
      modal.dataset.experimentId = experimentId;
      modal.classList.remove('hidden');
    }
  }

  /**
   * 关闭压缩档位选择模态框
   */
  closeCompressModal() {
    const modal = document.getElementById('compress-modal');
    if (modal) {
      modal.classList.add('hidden');
      delete modal.dataset.experimentId;
    }
  }

  /**
   * 执行压缩操作
   * @param {number} threshold - 涨幅阈值
   */
  async executeCompress(threshold) {
    const modal = document.getElementById('compress-modal');
    const experimentId = modal?.dataset.experimentId;

    if (!experimentId) {
      alert('❌ 无法获取实验ID');
      return;
    }

    // 关闭模态框
    this.closeCompressModal();

    // 最终确认
    const confirmed = confirm(
      `🗜️ 确定要压缩时序数据吗？\n\n` +
      `此操作将：\n` +
      `📊 删除最大涨幅低于 ${threshold}% 的代币的时序数据\n` +
      `💾 大幅减少存储空间和回测时间\n` +
      `⚠️ 被删除的数据无法恢复！\n\n` +
      `注意：有分析结果的代币会被处理，无结果的会被跳过。`
    );

    if (!confirmed) return;

    // 禁用按钮并显示加载状态
    const compressBtn = document.querySelector(`[data-action="compress"][data-id="${experimentId}"]`);
    if (compressBtn) {
      compressBtn.disabled = true;
      compressBtn.textContent = '⏳ 压缩中...';
    }

    try {
      const response = await fetch(`/api/experiment/${experimentId}/compress-time-series`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        const data = result.data;

        let message = `✅ 压缩完成！\n\n`;
        message += `📊 总代币数: ${data.totalTokens}\n`;
        message += `🗑️ 删除代币数: ${data.tokensToDelete}\n`;
        message += `⏭️ 跳过代币数: ${data.skippedTokens}\n\n`;
        message += `📈 数据统计:\n`;
        message += `   压缩前: ${data.beforeCount} 条记录\n`;
        message += `   压缩后: ${data.afterCount} 条记录\n`;
        message += `   删除: ${data.deletedRecords} 条记录 (${data.compressionRatio}%)\n`;

        if (data.orphanCleanedCount > 0) {
          message += `\n🧹 孤儿清理:\n`;
          message += `   清理了 ${data.orphanCleanedCount} 个孤儿代币的时序数据\n`;
        }

        alert(message);

        // 刷新实验列表
        await this.loadExperiments();
      } else {
        alert('❌ 压缩失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('❌ 压缩时序数据失败:', error);
      alert('❌ 压缩失败: ' + error.message);
    } finally {
      if (compressBtn) {
        compressBtn.disabled = false;
        compressBtn.textContent = '🗜️压缩';
      }
    }
  }

  /**
   * 清理无价格数据的代币
   * @param {string} experimentId - 实验ID
   * @param {string} experimentName - 实验名称
   */
  async cleanupTokens(experimentId, experimentName) {
    const confirmed = confirm(
      `🧹 确定要清理实验 "${experimentName}" 中的无数据代币吗？\n\n` +
      '此操作将：\n' +
      '🗑️ 删除无价格数据的代币记录\n' +
      '📊 保留有时序数据的代币\n' +
      '⚠️ 被删除的数据无法恢复！\n\n' +
      '注意：仅删除代币元数据，不影响信号和交易记录。'
    );

    if (!confirmed) return;

    // 禁用按钮并显示加载状态
    const cleanupBtn = document.querySelector(`[data-action="cleanup"][data-id="${experimentId}"]`);
    if (cleanupBtn) {
      cleanupBtn.disabled = true;
      cleanupBtn.textContent = '⏳ 清理中...';
    }

    try {
      const response = await fetch(`/api/experiment/${experimentId}/cleanup-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        const data = result.data;

        let message = `✅ 清理完成！\n\n`;
        message += `📊 总代币数: ${data.totalTokens}\n`;
        message += `🗑️ 删除代币数: ${data.deletedTokens} (无价格数据)\n`;
        message += `⏭️ 保留代币数: ${data.remainingTokens} (有价格数据)\n`;

        alert(message);

        // 刷新实验列表
        await this.loadExperiments();
      } else {
        alert('❌ 清理失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('❌ 清理代币失败:', error);
      alert('❌ 清理失败: ' + error.message);
    } finally {
      if (cleanupBtn) {
        cleanupBtn.disabled = false;
        cleanupBtn.textContent = '🧹清理';
      }
    }
  }

  /**
   * 打开涨幅分析模态框
   * @param {string} experimentId - 实验ID
   * @param {string} experimentName - 实验名称
   */
  openTokenAnalysisModal(experimentId, experimentName) {
    const modal = document.getElementById('token-analysis-modal');
    const nameDisplay = document.getElementById('token-analysis-experiment-name');
    const checkbox = document.getElementById('skip-analyzed-checkbox');

    if (modal && nameDisplay) {
      nameDisplay.textContent = `实验: ${experimentName}`;
      modal.dataset.experimentId = experimentId;
      // 重置checkbox状态
      if (checkbox) checkbox.checked = false;
      modal.classList.remove('hidden');
    }
  }

  /**
   * 关闭涨幅分析模态框
   */
  closeTokenAnalysisModal() {
    const modal = document.getElementById('token-analysis-modal');
    if (modal) {
      modal.classList.add('hidden');
      delete modal.dataset.experimentId;
    }
  }

  /**
   * 执行涨幅分析
   */
  async executeTokenAnalysis() {
    const modal = document.getElementById('token-analysis-modal');
    const experimentId = modal?.dataset.experimentId;
    const checkbox = document.getElementById('skip-analyzed-checkbox');
    const skipAnalyzed = checkbox?.checked || false;

    if (!experimentId) {
      alert('❌ 无法获取实验ID');
      return;
    }

    // 关闭模态框
    this.closeTokenAnalysisModal();

    // 确认提示
    const skipText = skipAnalyzed ? '（跳过已分析的代币）' : '';
    const confirmed = confirm(
      `📊 确定要分析代币涨幅吗？\n\n` +
      `此操作将：\n` +
      `📈 基于时序数据计算代币的最终涨幅和最高涨幅\n` +
      `💾 将分析结果保存到数据库\n` +
      `⏱️ 可能需要较长时间${skipText}\n\n` +
      `是否继续？`
    );

    if (!confirmed) return;

    // 禁用按钮并显示加载状态
    const analysisBtn = document.querySelector(`[data-action="token-analysis"][data-id="${experimentId}"]`);
    if (analysisBtn) {
      analysisBtn.disabled = true;
      analysisBtn.textContent = '⏳ 分析中...';
    }

    try {
      const response = await fetch(`/api/experiment/${experimentId}/analyze-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipAnalyzed })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        const skippedText = result.skipped > 0 ? `\n⏭️ 跳过: ${result.skipped}` : '';

        let message = `✅ 分析完成！\n\n`;
        message += `📊 总代币数: ${result.total}\n`;
        message += `✅ 成功分析: ${result.analyzed}\n`;
        message += `❌ 失败: ${result.failed}${skippedText}`;

        alert(message);

        // 刷新实验列表
        await this.loadExperiments();
      } else {
        alert('❌ 分析失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('❌ 分析代币涨幅失败:', error);
      alert('❌ 分析失败: ' + error.message);
    } finally {
      if (analysisBtn) {
        analysisBtn.disabled = false;
        analysisBtn.textContent = '📊涨幅';
      }
    }
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  new ExperimentMonitor();
});
