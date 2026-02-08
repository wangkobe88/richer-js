/**
 * 实验卡片渲染器 - 增强版数据显示
 */

class ExperimentRenderer {
  constructor() {
    this.container = document.getElementById('experiments-container');
    this.emptyState = document.getElementById('empty-state');
  }

  /**
   * 渲染实验列表
   */
  renderExperiments(experiments) {
    if (!this.container) return;

    if (!experiments || experiments.length === 0) {
      this.showEmptyState();
      return;
    }

    this.hideEmptyState();
    this.container.innerHTML = '';

    experiments.forEach((experiment, index) => {
      const card = this.createExperimentCard(experiment, index);
      this.container.appendChild(card);
    });
  }

  /**
   * 创建实验卡片
   */
  createExperimentCard(experiment, index) {
    const card = document.createElement('div');
    const modeType = (experiment.trading_mode || 'virtual').toLowerCase();
    card.className = `card-enhanced-light ${modeType}-experiment-card`;
    card.style.animationDelay = `${index * 100}ms`;

    const status = this.getStatusBadge(experiment.status);
    const blockchain = this.getBlockchainBadge(experiment.blockchain || 'bsc');
    const tradingMode = this.getTradingModeBadge(experiment.trading_mode || 'virtual');

    // 获取实验类型的颜色配置
    const typeColorConfig = {
      'live': { bg: 'bg-red-600', border: 'border-red-700', icon: '⚡', label: '实盘' },
      'virtual': { bg: 'bg-blue-600', border: 'border-blue-700', icon: '🎮', label: '虚拟' },
      'backtest': { bg: 'bg-purple-600', border: 'border-purple-700', icon: '📊', label: '回测' }
    };

    const typeConfig = typeColorConfig[modeType] || typeColorConfig['virtual'];

    card.innerHTML = `
      <!-- 实验类型标识带 -->
      <div class="${typeConfig.bg} ${typeConfig.border} border-t-2 border-l-2 border-r-2 rounded-t-lg px-3 py-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <span class="text-lg">${typeConfig.icon}</span>
            <span class="text-sm font-bold text-white">${typeConfig.label}交易</span>
          </div>
          ${status}
        </div>
      </div>

      <!-- 卡片主体 -->
      <div class="p-4 border-l-2 border-r-2 border-b-2 ${typeConfig.border} rounded-b-lg bg-white">
        <h3 class="text-xl font-semibold text-gray-900 mb-3">
          ${experiment.experimentName || experiment.experiment_name || '未命名实验'}
        </h3>

        <p class="text-gray-600 mb-4 line-clamp-2 text-sm">
          ${experiment.experiment_description || '暂无描述'}
        </p>

        <div class="flex flex-wrap gap-2 mb-4">
          ${blockchain}
          ${experiment.strategy_type ? `<span class="text-xs text-blue-700 bg-blue-100 px-2 py-1 rounded border border-blue-300">${experiment.strategy_type.toUpperCase()}</span>` : ''}
        </div>

        <div class="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div class="text-gray-500">创建时间</div>
            <div class="text-gray-900">${this.formatDate(experiment.created_at)}</div>
          </div>
          <div>
            <div class="text-gray-500">最后状态</div>
            <div class="text-gray-900">${this.formatDate(experiment.stopped_at || experiment.started_at)}</div>
          </div>
          <div>
            <div class="text-gray-500">实验时长</div>
            <div class="text-gray-900 font-semibold">${this.calculateDuration(experiment)}</div>
          </div>
        </div>

        <!-- 第一行：主要操作按钮 -->
        <div class="grid grid-cols-4 gap-2 mt-4">
          <button onclick="window.experimentRenderer.editExperiment('${experiment.id}')"
                  class="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors">
            ✏️ 编辑
          </button>
          <button onclick="window.location.href='/experiment/${experiment.id}'"
                  class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors">
            📊 详情
          </button>
          <button onclick="window.location.href='/experiment/${experiment.id}/signals'"
                  class="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors">
            📈 信号
          </button>
          <button onclick="window.location.href='/experiment/${experiment.id}/trades'"
                  class="bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors">
            💰 交易
          </button>
        </div>

        <!-- 第二行：辅助操作按钮（上半部分） -->
        <div class="grid grid-cols-3 gap-2 mt-2">
          <button onclick="window.openExperimentObserver('${experiment.id}')"
                  class="bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors">
            📊 运行数据
          </button>
          <button onclick="window.location.href='/experiment/${experiment.id}/analysis'"
                  class="bg-orange-600 hover:bg-orange-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors">
            📈 K线分析
          </button>
          <button onclick="window.experimentRenderer.copyExperimentId('${experiment.id}')"
                  class="bg-slate-600 hover:bg-slate-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors">
            📋 复制ID
          </button>
        </div>

        <!-- 第三行：辅助操作按钮（下半部分） -->
        <div class="${modeType === 'live' ? 'grid grid-cols-3' : 'grid grid-cols-2'} gap-2 mt-2">
          ${modeType === 'live' ? `
          <button onclick="window.location.href='/experiment/${experiment.id}/wallet'"
                  class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors">
            💼 钱包操作
          </button>
          ` : ''}
          <button onclick="window.experimentRenderer.copyExperiment('${experiment.id}')"
                  class="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors">
            📋 复制
          </button>
          <button onclick="window.experimentRenderer.clearExperimentData('${experiment.id}', '${experiment.experimentName || experiment.experiment_name || '未命名实验'}')"
                  class="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors">
            🗑️ 清除数据
          </button>
        </div>
        <div class="text-xs text-gray-500 mt-3 text-right border-t border-gray-200 pt-2">
          ID: ${experiment.id.substring(0, 8)}...
        </div>
      </div>
    `;

    return card;
  }

  /**
   * 获取状态徽章
   */
  getStatusBadge(status) {
    const statusConfig = {
      'initializing': { class: 'bg-gray-600 text-white', text: '未启动' },
      'running': { class: 'bg-green-600 text-white', text: '运行中' },
      'stopped': { class: 'bg-red-600 text-white', text: '已停止' },
      'completed': { class: 'bg-blue-600 text-white', text: '已完成' },
      'failed': { class: 'bg-red-600 text-white', text: '失败' },
      'error': { class: 'bg-red-600 text-white', text: '错误' },
    };

    const config = statusConfig[status] || { class: 'bg-gray-600 text-white', text: '未知' };
    return `<span class="px-2 py-1 rounded-full text-xs font-medium ${config.class}">${config.text}</span>`;
  }

  /**
   * 获取区块链徽章
   */
  getBlockchainBadge(blockchain) {
    // 🔥 支持多种区块链名称变体（sol/solana, eth/ethereum）
    const normalizedId = blockchain?.toLowerCase() || '';

    const blockchainConfig = {
      'bsc': { icon: '<img src="/static/bsc-logo.png" alt="BSC" class="w-4 h-4 inline-block rounded-full">', text: 'BSC' },
      'bnb': { icon: '<img src="/static/bsc-logo.png" alt="BSC" class="w-4 h-4 inline-block rounded-full">', text: 'BSC' },
      'sol': { icon: '<img src="/static/solana-logo.png" alt="Solana" class="w-4 h-4 inline-block rounded-full">', text: 'SOL' },
      'solana': { icon: '<img src="/static/solana-logo.png" alt="Solana" class="w-4 h-4 inline-block rounded-full">', text: 'SOL' },
      'base': { icon: '🔷', text: 'BASE' },
      'eth': { icon: '🔵', text: 'ETH' },
      'ethereum': { icon: '🔵', text: 'ETH' },
    };

    const config = blockchainConfig[normalizedId] || { icon: '⚪', text: '未知' };
    return `<span class="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded border border-gray-300">${config.icon} ${config.text}</span>`;
  }

  /**
   * 获取交易模式徽章
   */
  getTradingModeBadge(mode) {
    const modeConfig = {
      'live': {
        icon: '⚡',
        text: '实盘交易',
        bgColor: 'bg-red-600',
        borderColor: 'border-red-400',
        textColor: 'text-white',
        pulseClass: 'animate-pulse'
      },
      'virtual': {
        icon: '🎮',
        text: '虚拟交易',
        bgColor: 'bg-blue-600',
        borderColor: 'border-blue-400',
        textColor: 'text-white',
        pulseClass: ''
      },
      'backtest': {
        icon: '📊',
        text: '回测',
        bgColor: 'bg-purple-600',
        borderColor: 'border-purple-400',
        textColor: 'text-white',
        pulseClass: ''
      },
    };

    const config = modeConfig[mode.toLowerCase()] || {
      icon: '❓',
      text: '未知',
      bgColor: 'bg-gray-600',
      borderColor: 'border-gray-400',
      textColor: 'text-white',
      pulseClass: ''
    };

    return `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold ${config.bgColor} ${config.textColor} ${config.borderColor} border-2 ${config.pulseClass} experiment-type-badge">
      <span class="mr-1.5">${config.icon}</span>
      ${config.text}
    </span>`;
  }

  /**
   * 显示空状态
   */
  showEmptyState() {
    if (this.emptyState) {
      this.emptyState.classList.remove('hidden');
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  /**
   * 隐藏空状态
   */
  hideEmptyState() {
    if (this.emptyState) {
      this.emptyState.classList.add('hidden');
    }
  }

  /**
   * 清除单个实验数据
   */
  async clearExperimentData(experimentId, experimentName) {
    const confirmMessage = `确定要清除实验 "${experimentName}" 的所有数据吗？

此操作将删除该实验的以下所有数据：
📊 实验元数据 (experiments)
💰 投资组合快照 (portfolio_snapshots)
📈 策略信号 (strategy_signals)
💸 交易记录 (trades)

⚠️ 此操作不可恢复！`;

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      // 显示加载状态
      this.showClearLoading(experimentId);

      const response = await fetch(`/api/experiments/${experimentId}/clear`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('🧹 API响应:', result);

      // 检查响应格式
      if (result.message && result.tables) {
        // 旧格式响应
        this.showClearSuccess(`✅ 实验 "${experimentName}" 数据已清除`);
        console.log('清除结果:', result.tables);
      } else if (result.results) {
        // 新格式响应
        if (result.failed > 0) {
          this.showClearError(`部分数据清除失败：${result.message}`);
          console.warn('清除结果:', result.results);
        } else {
          this.showClearSuccess(`✅ 实验 "${experimentName}" 数据已清除`);
          console.log('清除结果:', result.results);
        }
      } else {
        this.showClearSuccess(`✅ 实验 "${experimentName}" 数据清除操作已发送`);
        console.log('清除响应:', result);
      }

      // 刷新实验列表
      if (window.experimentMonitor) {
        await window.experimentMonitor.loadExperiments();
      }

    } catch (error) {
      console.error('❌ 清除实验数据失败:', error);
      this.showClearError(`清除实验数据失败: ${error.message}`);
    } finally {
      this.hideClearLoading(experimentId);
    }
  }

  /**
   * 显示清除加载状态
   */
  showClearLoading(experimentId) {
    // 查找对应的清除按钮并显示加载状态
    const buttons = document.querySelectorAll('button[onclick*="clearExperimentData"]');
    buttons.forEach(button => {
      if (button.onclick && button.onclick.toString().includes(experimentId)) {
        const originalText = button.textContent;
        button.textContent = '⏳ 清除中...';
        button.disabled = true;
        button.classList.add('opacity-50', 'cursor-not-allowed');

        // 保存原始文本用于恢复
        button.dataset.originalText = originalText;
      }
    });
  }

  /**
   * 隐藏清除加载状态
   */
  hideClearLoading(experimentId) {
    // 恢复按钮状态
    const buttons = document.querySelectorAll('button[onclick*="clearExperimentData"]');
    buttons.forEach(button => {
      if (button.onclick && button.onclick.toString().includes(experimentId)) {
        const originalText = button.dataset.originalText || '清除数据';
        button.textContent = originalText;
        button.disabled = false;
        button.classList.remove('opacity-50', 'cursor-not-allowed');
        delete button.dataset.originalText;
      }
    });
  }

  /**
   * 显示清除成功信息
   */
  showClearSuccess(message) {
    // 使用实验监控页面的成功消息显示
    if (window.experimentMonitor) {
      window.experimentMonitor.showSuccess(message);
    } else {
      // 备用显示方案
      alert(message);
    }
  }

  /**
   * 显示清除错误信息
   */
  showClearError(message) {
    // 使用实验监控页面的错误消息显示
    if (window.experimentMonitor) {
      window.experimentMonitor.showError(message);
    } else {
      // 备用显示方案
      alert(message);
    }
  }

  /**
   * 复制实验
   */
  async copyExperiment(experimentId) {
    try {
      // 显示复制状态
      this.showCopyLoading(experimentId);

      // 获取实验详细信息
      const response = await fetch(`/api/experiment/${experimentId}`);
      if (!response.ok) {
        throw new Error(`获取实验信息失败: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success || !result.data) {
        throw new Error('实验数据不存在');
      }

      const experiment = result.data;
      const config = experiment.config || {};

      // 将实验配置存储到sessionStorage
      const copyData = {
        experiment_name: (experiment.experimentName || '') + ' - 副本',
        experiment_description: (experiment.experimentDescription || '') + ' (复制的实验)',
        trading_mode: experiment.tradingMode || 'virtual',
        blockchain: experiment.blockchain || 'bsc',
        kline_type: experiment.klineType,
        // 从config中提取其他配置
        ...this.extractConfigFromExperiment(experiment)
      };

      sessionStorage.setItem('copyExperimentData', JSON.stringify(copyData));

      // 跳转到创建实验页面
      window.location.href = '/create-experiment?copy=true';

    } catch (error) {
      console.error('❌ 复制实验失败:', error);
      this.showCopyError(`复制实验失败: ${error.message}`);
    } finally {
      this.hideCopyLoading(experimentId);
    }
  }

  /**
   * 从实验配置中提取表单数据
   */
  extractConfigFromExperiment(experiment) {
    const config = experiment.config || {};
    const formData = {};

    // 🔥 提取多代币配置（因子策略在代币级别）
    if (config.targetTokens && config.targetTokens.length > 0) {
      formData.targetTokens = config.targetTokens.map(token => ({
        symbol: token.symbol || '',
        address: token.address || '',
        decimals: token.decimals || 18,
        enabled: token.enabled !== false,
        priority: token.priority || 999,
        minTradeIntervalSeconds: token.minTradeIntervalSeconds || 300,  // 🔥 新增：默认5分钟
        trader: token.trader || 'v2',
        // 代币专属策略
        strategies: token.strategies || [],
        // 代币专属卡牌配置
        positionManagement: token.positionManagement || null
      }));
    }

    // 提取仓位管理配置
    if (config.positionManagement) {
      formData.total_cards = config.positionManagement.totalCards || 4;
      formData.min_cards_for_trade = config.positionManagement.minCardsForTrade || 1;
      // 提取初始卡牌分配
      if (config.positionManagement.initialAllocation) {
        formData.bnb_cards = config.positionManagement.initialAllocation.bnbCards ?? formData.total_cards;
        formData.token_cards = config.positionManagement.initialAllocation.tokenCards ?? 0;
      } else {
        // 默认所有卡牌在BNB
        formData.bnb_cards = formData.total_cards;
        formData.token_cards = 0;
      }
    }

    // 提取回测/虚拟模式配置
    if (config.backtest) {
      formData.start_date = config.backtest.start_date || '';
      formData.end_date = config.backtest.end_date || '';
      formData.initial_balance = config.backtest.initial_balance || '100';
      formData.trading_fee = config.backtest.trading_fee || '0.5';
    } else if (config.virtual) {
      formData.initial_balance = config.virtual.initial_balance || '100';
    }

    // 提取实盘交易钱包配置
    if (config.wallet) {
      formData.wallet_address = config.wallet.address || '';
      formData.private_key = config.wallet.privateKey || ''; // 恢复私钥复制（支持加密格式）
    }
    // 保留金额独立于 wallet 配置
    if (config.reserveNative !== undefined) {
      formData.reserve_amount = config.reserveNative;
    } else if (config.wallet?.reserveNative !== undefined) {
      formData.reserve_amount = config.wallet.reserveNative;
    } else {
      formData.reserve_amount = '0.1';
    }

    // 提取交易配置
    if (config.trading) {
      formData.max_slippage = config.trading.maxSlippage || '2';
    }

    // 提取数据源配置（包含数据更新间隔）
    if (config.dataSources) {
      formData.data_sources = config.dataSources;
      // 🔥 提取数据更新间隔到表单字段
      if (config.dataSources.updateInterval !== undefined) {
        formData.update_interval = config.dataSources.updateInterval;
      }
    }

    return formData;
  }

  /**
   * 显示复制加载状态
   */
  showCopyLoading(experimentId) {
    const buttons = document.querySelectorAll('button[onclick*="copyExperiment"]');
    buttons.forEach(button => {
      if (button.onclick && button.onclick.toString().includes(experimentId)) {
        const originalText = button.textContent;
        button.textContent = '⏳ 复制中...';
        button.disabled = true;
        button.classList.add('opacity-50', 'cursor-not-allowed');
        button.dataset.originalText = originalText;
      }
    });
  }

  /**
   * 隐藏复制加载状态
   */
  hideCopyLoading(experimentId) {
    const buttons = document.querySelectorAll('button[onclick*="copyExperiment"]');
    buttons.forEach(button => {
      if (button.onclick && button.onclick.toString().includes(experimentId)) {
        const originalText = button.dataset.originalText || '复制';
        button.textContent = originalText;
        button.disabled = false;
        button.classList.remove('opacity-50', 'cursor-not-allowed');
        delete button.dataset.originalText;
      }
    });
  }

  /**
   * 显示复制成功信息
   */
  showCopySuccess(message) {
    if (window.experimentMonitor) {
      window.experimentMonitor.showSuccess(message);
    } else {
      alert(message);
    }
  }

  /**
   * 显示复制错误信息
   */
  showCopyError(message) {
    if (window.experimentMonitor) {
      window.experimentMonitor.showError(message);
    } else {
      alert(message);
    }
  }

  /**
   * 编辑实验 - 跳转到创建页面并加载完整配置
   */
  async editExperiment(experimentId) {
    try {
      // 显示加载状态
      this.showEditLoading(experimentId);

      // 获取实验详细信息
      const response = await fetch(`/api/experiment/${experimentId}`);
      if (!response.ok) {
        throw new Error(`获取实验信息失败: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success || !result.data) {
        throw new Error('实验数据不存在');
      }

      const experiment = result.data;

      // 构建编辑数据（复用 extractConfigFromExperiment 逻辑）
      const editData = {
        experiment_id: experimentId,  // 标记为编辑模式
        experiment_name: experiment.experimentName || '',
        experiment_description: experiment.experimentDescription || '',
        trading_mode: experiment.tradingMode,
        blockchain: experiment.blockchain,
        kline_type: experiment.klineType,
        // 从 config 中提取所有配置
        ...this.extractConfigFromExperiment(experiment)
      };

      // 存储到 sessionStorage（供创建页面读取）
      sessionStorage.setItem('editExperimentData', JSON.stringify(editData));

      // 跳转到创建页面（带 edit 参数）
      window.location.href = '/create-experiment?edit=true';

    } catch (error) {
      console.error('❌ 加载编辑表单失败:', error);
      this.showEditError(`加载编辑表单失败: ${error.message}`);
      this.hideEditLoading(experimentId);
    }
  }

  /**
   * 显示编辑加载状态
   */
  showEditLoading(experimentId) {
    const buttons = document.querySelectorAll('button[onclick*="editExperiment"]');
    buttons.forEach(button => {
      if (button.onclick && button.onclick.toString().includes(experimentId)) {
        const originalText = button.textContent;
        button.textContent = '⏳ 加载中...';
        button.disabled = true;
        button.classList.add('opacity-50', 'cursor-not-allowed');
        button.dataset.originalText = originalText;
      }
    });
  }

  /**
   * 隐藏编辑加载状态
   */
  hideEditLoading(experimentId) {
    const buttons = document.querySelectorAll('button[onclick*="editExperiment"]');
    buttons.forEach(button => {
      if (button.onclick && button.onclick.toString().includes(experimentId)) {
        const originalText = button.dataset.originalText || '编辑';
        button.textContent = originalText;
        button.disabled = false;
        button.classList.remove('opacity-50', 'cursor-not-allowed');
        delete button.dataset.originalText;
      }
    });
  }

  /**
   * 显示编辑成功信息
   */
  showEditSuccess(message) {
    if (window.experimentMonitor) {
      window.experimentMonitor.showSuccess(message);
    } else {
      alert(message);
    }
  }

  /**
   * 显示编辑错误信息
   */
  showEditError(message) {
    if (window.experimentMonitor) {
      window.experimentMonitor.showError(message);
    } else {
      alert(message);
    }
  }

  /**
   * 复制实验ID到剪贴板
   */
  async copyExperimentId(experimentId) {
    try {
      await navigator.clipboard.writeText(experimentId);

      // 显示成功提示
      if (window.experimentMonitor) {
        window.experimentMonitor.showSuccess(`✅ ID已复制: ${experimentId}`);
      } else {
        alert(`实验ID已复制: ${experimentId}`);
      }

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

        if (window.experimentMonitor) {
          window.experimentMonitor.showSuccess(`✅ ID已复制: ${experimentId}`);
        } else {
          alert(`实验ID已复制: ${experimentId}`);
        }
      } catch (fallbackError) {
        this.showCopyIdError(`复制失败: ${error.message}`);
      }
    }
  }

  /**
   * 显示复制ID错误信息
   */
  showCopyIdError(message) {
    if (window.experimentMonitor) {
      window.experimentMonitor.showError(message);
    } else {
      alert(message);
    }
  }

  /**
   * 打开实验观察页面
   */
  openExperimentObserver(experimentId) {
    // 跳转到实验观察页面，并在URL中带上实验ID
    window.location.href = `/experiment-observer?experiment=${experimentId}`;
  }

  /**
   * 计算实验时长
   */
  calculateDuration(experiment) {
    if (!experiment.created_at) return '未知';

    const createdAt = new Date(experiment.created_at);
    // 如果已停止，使用停止时间；否则使用当前时间
    const endTime = experiment.stopped_at ? new Date(experiment.stopped_at) : new Date();
    const duration = endTime - createdAt;

    return this.formatDuration(duration);
  }

  /**
   * 格式化时长
   */
  formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}天${hours % 24}小时`;
    } else if (hours > 0) {
      return `${hours}小时${minutes % 60}分`;
    } else if (minutes > 0) {
      return `${minutes}分钟`;
    } else {
      return `${seconds}秒`;
    }
  }

  /**
   * 格式化日期
   */
  formatDate(dateString) {
    if (!dateString) return '未知';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return '日期错误';
    }
  }
}

// 初始化渲染器
document.addEventListener('DOMContentLoaded', () => {
  window.experimentRenderer = new ExperimentRenderer();
  console.log('✅ 实验渲染器初始化完成');
});

// 全局函数：打开实验观察页面
window.openExperimentObserver = function(experimentId) {
  if (window.experimentRenderer) {
    window.experimentRenderer.openExperimentObserver(experimentId);
  } else {
    console.error('实验渲染器未初始化');
  }
};