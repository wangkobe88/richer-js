/**
 * 代币信号统计页面
 * 展示每个代币的买卖信号数量、已执行信号数量、叙事评级、最高涨幅等
 */

// 叙事评级映射
const NARRATIVE_RATING_MAP = {
  1: { label: '低质量', emoji: '📉', class: 'narrative-1' },
  2: { label: '中质量', emoji: '📊', class: 'narrative-2' },
  3: { label: '高质量', emoji: '🚀', class: 'narrative-3' },
  9: { label: '未评级', emoji: '❓', class: 'narrative-9' }
};

// 人工评级映射
const HUMAN_JUDGE_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭', bgClass: 'bg-red-900', borderClass: 'border-red-700', textClass: 'text-red-400' },
  no_user: { label: '无人玩', emoji: '👻', bgClass: 'bg-gray-700', borderClass: 'border-gray-600', textClass: 'text-gray-400' },
  low_quality: { label: '低质量', emoji: '📉', bgClass: 'bg-orange-900', borderClass: 'border-orange-700', textClass: 'text-orange-400' },
  mid_quality: { label: '中质量', emoji: '📊', bgClass: 'bg-blue-900', borderClass: 'border-blue-700', textClass: 'text-blue-400' },
  high_quality: { label: '高质量', emoji: '🚀', bgClass: 'bg-green-900', borderClass: 'border-green-700', textClass: 'text-green-400' }
};

class ExperimentSignalStats {
  constructor() {
    this.experimentId = null;
    this.experimentData = null;
    this.signalsData = [];
    this.tokensData = [];
    this.tokenStats = []; // { tokenAddress, symbol, buySignals, sellSignals, executedBuy, executedSell, narrativeRating, maxChange, ... }
    this.filteredStats = [];
    this.sortField = 'buySignals';
    this.sortOrder = 'desc'; // 'asc' or 'desc'
    this.currentPage = 1;
    this.pageSize = 50;
    this.currentFilter = 'all';
    this.currentNarrativeFilter = 'all';
    this.currentEditingToken = null; // 当前正在编辑评级的代币

    // 叙事数据映射
    this.narrativeDataMap = new Map(); // key: token_address (lowercase), value: { narrative, human_judge, max_change_percent }
    this.narrativeRatingMap = new Map(); // key: token_address (lowercase), value: rating

    this.init();
  }

  async init() {
    // 从 URL 获取实验 ID
    const pathParts = window.location.pathname.split('/');
    this.experimentId = pathParts[pathParts.length - 2]; // /experiment/:id/signal-stats 中的 :id

    if (!this.experimentId) {
      this.showError('无法获取实验 ID');
      return;
    }

    // 绑定事件
    this.bindEvents();

    // 加载数据
    await this.loadData();
  }

  bindEvents() {
    // 刷新按钮
    document.getElementById('refresh-btn')?.addEventListener('click', () => {
      this.loadData();
    });

    // 重试按钮
    document.getElementById('retry-btn')?.addEventListener('click', () => {
      this.loadData();
    });

    // 筛选控件
    document.getElementById('signal-filter')?.addEventListener('change', (e) => {
      this.currentFilter = e.target.value;
      this.currentPage = 1;
      this.applyFilterAndSort();
    });

    document.getElementById('narrative-filter')?.addEventListener('change', (e) => {
      this.currentNarrativeFilter = e.target.value;
      this.currentPage = 1;
      this.applyFilterAndSort();
    });

    // 排序按钮
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const field = e.target.dataset.sort;
        if (this.sortField === field) {
          this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortField = field;
          this.sortOrder = 'desc';
        }
        this.updateSortButtons();
        this.applyFilterAndSort();
      });
    });

    // 人工评级弹窗事件
    document.getElementById('judge-cancel-btn')?.addEventListener('click', () => {
      this.closeJudgeModal();
    });

    document.getElementById('judge-save-btn')?.addEventListener('click', () => {
      this.saveJudge();
    });
  }

  async loadData() {
    this.showLoading(true);

    try {
      // 并行加载实验数据、信号数据、代币数据和叙事分析数据
      const [experimentRes, signalsRes, tokensRes, narrativeRes] = await Promise.all([
        fetch(`/api/experiment/${this.experimentId}`),
        fetch(`/api/experiment/${this.experimentId}/signals?limit=10000`),
        fetch(`/api/experiment/${this.experimentId}/tokens?limit=10000`),
        fetch(`/api/experiment/${this.experimentId}/narrative`)
      ]);

      if (!experimentRes.ok || !signalsRes.ok || !tokensRes.ok) {
        throw new Error('加载数据失败');
      }

      const experimentData = await experimentRes.json();
      const signalsData = await signalsRes.json();
      const tokensData = await tokensRes.json();
      const narrativeData = narrativeRes.ok ? await narrativeRes.json() : { success: false, data: [] };

      if (!experimentData.success) {
        throw new Error('实验数据格式错误');
      }

      this.experimentData = experimentData.data;
      this.signalsData = signalsData.signals || [];
      this.tokensData = tokensData.tokens || [];

      // 创建叙事数据映射表（保存完整数据，包含叙事评级和人工评级）
      this.narrativeDataMap = new Map();
      this.narrativeRatingMap = new Map();
      if (narrativeData.success && narrativeData.data) {
        for (const item of narrativeData.data) {
          const addr = item.token_address?.toLowerCase();
          if (addr) {
            this.narrativeDataMap.set(addr, {
              narrative: item.narrative,
              human_judge: item.human_judge,
              max_change_percent: item.max_change_percent
            });

            // 支持新旧两种数据格式
            let rating = 9; // 默认 unrated

            // 新格式：从 llmAnalysis.summary.category 获取
            if (item.narrative?.llmAnalysis?.summary?.category) {
              const categoryToRating = {
                'high': 3,
                'mid': 2,
                'low': 1,
                'unrated': 9
              };
              rating = categoryToRating[item.narrative.llmAnalysis.summary.category] ?? 9;
            }
            // 旧格式：直接从 rating 字段获取
            else if (item.narrative?.rating !== undefined) {
              rating = item.narrative.rating;
            }

            this.narrativeRatingMap.set(addr, rating);
          }
        }
      }
      console.log('叙事数据映射:', this.narrativeDataMap.size, '个代币有数据');

      // 聚合信号统计
      this.aggregateSignalsByToken();

      // 更新UI
      this.updateExperimentHeader();
      this.updateSummaryStats();
      this.applyFilterAndSort();

      // 显示内容
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('stats-content').classList.remove('hidden');

    } catch (error) {
      console.error('加载数据失败:', error);
      this.showError('加载数据失败: ' + error.message);
    }
  }

  aggregateSignalsByToken() {
    // 按代币地址聚合信号统计
    const signalMap = new Map();

    for (const signal of this.signalsData) {
      const addr = signal.token_address?.toLowerCase();
      if (!addr) continue;

      if (!signalMap.has(addr)) {
        signalMap.set(addr, {
          tokenAddress: addr,
          buySignals: 0,
          sellSignals: 0,
          holdSignals: 0,
          executedBuy: 0,
          executedSell: 0,
          executedHold: 0
        });
      }

      const stats = signalMap.get(addr);
      const signalType = signal.signal_type || signal.signalType; // 兼容两种字段名
      if (signalType === 'BUY') {
        stats.buySignals++;
        if (signal.executed) stats.executedBuy++;
      } else if (signalType === 'SELL') {
        stats.sellSignals++;
        if (signal.executed) stats.executedSell++;
      } else if (signalType === 'HOLD') {
        stats.holdSignals++;
        if (signal.executed) stats.executedHold++;
      }
    }

    // 合并代币元数据
    this.tokenStats = Array.from(signalMap.values()).map(signalStats => {
      // 查找对应的代币数据
      const token = this.tokensData.find(t =>
        t.token_address?.toLowerCase() === signalStats.tokenAddress
      );

      if (token) {
        return {
          ...signalStats,
          symbol: token.token_symbol || token.raw_api_data?.symbol || 'Unknown',
          name: token.raw_api_data?.name || '',
          narrativeRating: this.narrativeRatingMap.get(signalStats.tokenAddress) ?? 9, // 从叙事分析数据获取
          maxChange: token.analysis_results?.max_change_percent ?? null
        };
      }

      // 没有找到代币数据，返回基本信息
      return {
        ...signalStats,
        symbol: 'Unknown',
        name: '',
        narrativeRating: this.narrativeRatingMap.get(signalStats.tokenAddress) ?? 9,
        maxChange: null
      };
    });

    // 按买入信号数量默认排序
    this.tokenStats.sort((a, b) => b.buySignals - a.buySignals);
  }

  applyFilterAndSort() {
    // 应用筛选
    this.filteredStats = this.tokenStats.filter(stat => {
      // 信号筛选
      if (this.currentFilter === 'with-buy' && stat.buySignals === 0) return false;
      if (this.currentFilter === 'with-sell' && stat.sellSignals === 0) return false;
      if (this.currentFilter === 'with-signals' && stat.buySignals === 0 && stat.sellSignals === 0) return false;

      // 叙事评级筛选
      if (this.currentNarrativeFilter !== 'all' && stat.narrativeRating !== parseInt(this.currentNarrativeFilter)) {
        return false;
      }

      return true;
    });

    // 排序
    this.filteredStats.sort((a, b) => {
      let aVal = a[this.sortField];
      let bVal = b[this.sortField];

      // 处理 null 值
      if (aVal === null) aVal = -Infinity;
      if (bVal === null) bVal = -Infinity;

      // 字符串比较
      if (typeof aVal === 'string') {
        return this.sortOrder === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      // 数值比较
      return this.sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    this.renderTable();
    this.renderPagination();
  }

  renderTable() {
    const tbody = document.getElementById('stats-table-body');
    if (!tbody) return;

    // 分页
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    const pageData = this.filteredStats.slice(start, end);

    if (pageData.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="px-4 py-8 text-center text-gray-400">
                没有找到符合条件的代币
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = pageData.map(stat => this.renderTableRow(stat)).join('');

    // 绑定人工评级按钮事件
    this.bindJudgeButtons();
  }

  renderTableRow(stat) {
    // 叙事评级徽章（带链接和分数）
    const ratingInfo = NARRATIVE_RATING_MAP[stat.narrativeRating] || NARRATIVE_RATING_MAP[9];
    const analyzerUrl = `http://localhost:3010/narrative-analyzer?address=${stat.tokenAddress}`;

    // 尝试获取总分（从叙事数据中）
    const narrativeData = this.narrativeDataMap.get(stat.tokenAddress);
    let scoreText = '';
    if (narrativeData?.narrative?.llmAnalysis?.summary?.total_score !== undefined) {
      scoreText = ` (${narrativeData.narrative.llmAnalysis.summary.total_score.toFixed(0)}分)`;
    }

    const ratingBadge = `<a href="${analyzerUrl}" target="_blank" class="narrative-badge ${ratingInfo.class} hover:opacity-80 transition-opacity" title="点击查看详情">${ratingInfo.emoji} ${stat.narrativeRating}${scoreText}</a>`;

    // 人工评级徽章
    let humanJudgeBadge = '';
    if (narrativeData?.human_judge?.category) {
      const judgeInfo = HUMAN_JUDGE_MAP[narrativeData.human_judge.category];
      if (judgeInfo) {
        humanJudgeBadge = `
          <span class="narrative-badge ${judgeInfo.bgClass} ${judgeInfo.borderClass} ${judgeInfo.textClass}">${judgeInfo.emoji} ${judgeInfo.label}</span>
          <button class="judge-delete-btn ml-1 text-gray-400 hover:text-red-400 transition-colors text-xs" data-address="${stat.tokenAddress}" title="删除标注">✕</button>
        `;
      }
    }

    // 如果没有人工评级，显示添加按钮
    if (!humanJudgeBadge) {
      humanJudgeBadge = `
        <button class="judge-btn px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs text-white transition-colors"
                data-address="${stat.tokenAddress}" data-symbol="${stat.symbol}" title="添加标注">
          +
        </button>
      `;
    }

    // 最高涨幅显示
    let maxChangeDisplay = '<span class="max-change-neutral">-</span>';
    if (stat.maxChange !== null) {
      const changeValue = stat.maxChange.toFixed(2);
      if (stat.maxChange > 0) {
        maxChangeDisplay = `<span class="max-change-positive">+${changeValue}%</span>`;
      } else if (stat.maxChange < 0) {
        maxChangeDisplay = `<span class="max-change-negative">${changeValue}%</span>`;
      } else {
        maxChangeDisplay = `<span class="max-change-neutral">0.00%</span>`;
      }
    }

    // 代币显示（symbol + 地址前8位）
    const shortAddress = stat.tokenAddress.slice(0, 8) + '...';

    // 区块链（用于 GMGN 链接和其他链接）
    const blockchain = this.experimentData?.config?.blockchain || 'bsc';
    // GMGN 链接根据不同链使用不同格式
    const gmgnChainMap = {
      'bsc': 'bsc',
      'eth': 'eth',
      'sol': 'sol',
      'base': 'base'
    };
    const gmgnChain = gmgnChainMap[blockchain] || 'bsc';
    const gmgnUrl = `https://gmgn.ai/${gmgnChain}/token/${stat.tokenAddress}`;

    // 各个页面链接
    const observerUrl = `/experiment/${this.experimentId}/observer#token=${stat.tokenAddress}`;
    const signalsUrl = `/experiment/${this.experimentId}/signals#token=${stat.tokenAddress}`;
    const strategyUrl = `/experiment/${this.experimentId}/strategy-analysis?tokenAddress=${stat.tokenAddress}`;
    const earlyTradesUrl = `/token-early-trades?token=${stat.tokenAddress}&chain=${blockchain}`;
    const tokenDetailUrl = `/token-detail?experiment=${this.experimentId}&address=${stat.tokenAddress}`;
    const holdersUrl = `/token-holders?experiment=${this.experimentId}&token=${stat.tokenAddress}`;

    return `
      <tr class="table-row">
        <td class="px-4 py-3">
          <div class="flex flex-col">
            <span class="font-medium text-white">${this.escapeHtml(stat.symbol)}</span>
            <span class="text-xs text-gray-400 font-mono">${this.escapeHtml(shortAddress)}</span>
          </div>
        </td>
        <td class="px-4 py-3 text-center">
          <span class="signal-count signal-count-buy">${stat.buySignals}</span>
        </td>
        <td class="px-4 py-3 text-center">
          <span class="signal-count signal-count-sell">${stat.sellSignals}</span>
        </td>
        <td class="px-4 py-3 text-center">
          <span class="signal-count executed-buy">${stat.executedBuy}</span>
        </td>
        <td class="px-4 py-3 text-center">
          <span class="signal-count executed-sell">${stat.executedSell}</span>
        </td>
        <td class="px-4 py-3 text-center">${ratingBadge}</td>
        <td class="px-4 py-3 text-center">${humanJudgeBadge}</td>
        <td class="px-4 py-3 text-center">${maxChangeDisplay}</td>
        <td class="px-2 py-3">
          <div class="flex flex-col gap-1 text-xs text-gray-400">
            <div class="flex items-center gap-1">
              <a href="${gmgnUrl}" target="_blank" class="hover:text-purple-400 flex-shrink-0">GMGN</a>
              <span class="text-gray-600">|</span>
              <a href="${observerUrl}" target="_blank" class="hover:text-green-400 flex-shrink-0">时序</a>
              <span class="text-gray-600">|</span>
              <a href="${signalsUrl}" target="_blank" class="hover:text-purple-400 flex-shrink-0">信号</a>
              <span class="text-gray-600">|</span>
              <a href="${strategyUrl}" target="_blank" class="hover:text-pink-400 flex-shrink-0">策略</a>
            </div>
            <div class="flex items-center gap-1">
              <a href="${earlyTradesUrl}" target="_blank" class="hover:text-amber-400 flex-shrink-0" title="早期交易">早期</a>
              <span class="text-gray-600">|</span>
              <a href="${tokenDetailUrl}" target="_blank" class="hover:text-cyan-400 flex-shrink-0" title="代币详情">详情</a>
              <span class="text-gray-600">|</span>
              <a href="${holdersUrl}" target="_blank" class="hover:text-indigo-400 flex-shrink-0" title="持有者">持有者</a>
              <span class="text-gray-600">|</span>
              <button onclick="window.experimentSignalStats.copyAddress('${stat.tokenAddress}')" class="hover:text-blue-400 flex-shrink-0">复制</button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  renderPagination() {
    const container = document.getElementById('pagination-container');
    if (!container) return;

    const totalPages = Math.ceil(this.filteredStats.length / this.pageSize);

    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    let html = '<div class="flex items-center justify-between px-4 py-3 border-t border-gray-700">';

    // 页面信息
    html += `
      <div class="text-sm text-gray-400">
        显示 ${((this.currentPage - 1) * this.pageSize) + 1} - ${Math.min(this.currentPage * this.pageSize, this.filteredStats.length)} 条，共 ${this.filteredStats.length} 条
      </div>
    `;

    // 分页按钮
    html += '<div class="flex items-center space-x-2">';

    // 上一页
    html += `
      <button onclick="window.experimentSignalStats.goToPage(${this.currentPage - 1})" ${this.currentPage === 1 ? 'disabled' : ''} class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed">
        上一页
      </button>
    `;

    // 页码
    const maxPageButtons = 5;
    let startPage = Math.max(1, this.currentPage - Math.floor(maxPageButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxPageButtons - 1);

    if (endPage - startPage < maxPageButtons - 1) {
      startPage = Math.max(1, endPage - maxPageButtons + 1);
    }

    if (startPage > 1) {
      html += `<button onclick="window.experimentSignalStats.goToPage(1)" class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white">1</button>`;
      if (startPage > 2) {
        html += `<span class="text-gray-400">...</span>`;
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      const isActive = i === this.currentPage;
      html += `<button onclick="window.experimentSignalStats.goToPage(${i})" class="px-3 py-1 ${isActive ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'} rounded text-sm text-white">${i}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        html += `<span class="text-gray-400">...</span>`;
      }
      html += `<button onclick="window.experimentSignalStats.goToPage(${totalPages})" class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white">${totalPages}</button>`;
    }

    // 下一页
    html += `
      <button onclick="window.experimentSignalStats.goToPage(${this.currentPage + 1})" ${this.currentPage === totalPages ? 'disabled' : ''} class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed">
        下一页
      </button>
    `;

    html += '</div></div>';
    container.innerHTML = html;
  }

  goToPage(page) {
    const totalPages = Math.ceil(this.filteredStats.length / this.pageSize);
    if (page < 1 || page > totalPages) return;
    this.currentPage = page;
    this.renderTable();
    this.renderPagination();
  }

  updateExperimentHeader() {
    const exp = this.experimentData;
    if (!exp) return;

    document.getElementById('experiment-name').textContent = exp.experimentName || '未命名实验';
    document.getElementById('experiment-id').textContent = `ID: ${this.experimentId.slice(0, 8)}...`;
    document.getElementById('experiment-blockchain').textContent = `区块链: ${exp.config?.blockchain || 'BSC'}`;
    document.getElementById('token-count').textContent = `代币数量: ${this.tokenStats.length}`;

    // 更新导航链接（都打开新标签页）
    const linkDetail = document.getElementById('link-detail');
    if (linkDetail) {
      linkDetail.href = `/experiment/${this.experimentId}`;
      linkDetail.target = '_blank';
    }

    const linkSignalStats = document.getElementById('link-signal-stats');
    if (linkSignalStats) {
      linkSignalStats.href = `/experiment/${this.experimentId}/signal-stats`;
      linkSignalStats.target = '_blank';
    }

    const linkSignals = document.getElementById('link-signals');
    if (linkSignals) {
      linkSignals.href = `/experiment/${this.experimentId}/signals`;
      linkSignals.target = '_blank';
    }

    const linkTrades = document.getElementById('link-trades');
    if (linkTrades) {
      linkTrades.href = `/experiment/${this.experimentId}/trades`;
      linkTrades.target = '_blank';
    }

    const linkBack = document.getElementById('link-back');
    if (linkBack) {
      linkBack.href = '/experiments';
    }
  }

  updateSummaryStats() {
    const totalTokens = this.tokenStats.length;
    const tokensWithSignals = this.tokenStats.filter(s => s.buySignals > 0 || s.sellSignals > 0).length;
    const totalBuySignals = this.tokenStats.reduce((sum, s) => sum + s.buySignals, 0);
    const totalSellSignals = this.tokenStats.reduce((sum, s) => sum + s.sellSignals, 0);
    const executedBuySignals = this.tokenStats.reduce((sum, s) => sum + s.executedBuy, 0);
    const executedSellSignals = this.tokenStats.reduce((sum, s) => sum + s.executedSell, 0);

    document.getElementById('stat-total-tokens').textContent = totalTokens;
    document.getElementById('stat-tokens-with-signals').textContent = tokensWithSignals;
    document.getElementById('stat-total-buy-signals').textContent = totalBuySignals;
    document.getElementById('stat-total-sell-signals').textContent = totalSellSignals;
    document.getElementById('stat-executed-buy-signals').textContent = executedBuySignals;
    document.getElementById('stat-executed-sell-signals').textContent = executedSellSignals;
  }

  updateSortButtons() {
    document.querySelectorAll('.sort-btn').forEach(btn => {
      const field = btn.dataset.sort;
      btn.classList.toggle('active', field === this.sortField);
      // 可以添加排序图标
    });
  }

  showLoading(show) {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('stats-content');
    const errorEl = document.getElementById('error-message');

    if (show) {
      loadingEl?.classList.remove('hidden');
      contentEl?.classList.add('hidden');
      errorEl?.classList.add('hidden');
    } else {
      loadingEl?.classList.add('hidden');
      contentEl?.classList.remove('hidden');
    }
  }

  showError(message) {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('stats-content');
    const errorEl = document.getElementById('error-message');

    loadingEl?.classList.add('hidden');
    contentEl?.classList.add('hidden');
    errorEl?.classList.remove('hidden');

    const errorText = document.getElementById('error-text');
    if (errorText) {
      errorText.textContent = message;
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * 复制代币地址到剪贴板
   */
  async copyAddress(address) {
    try {
      await navigator.clipboard.writeText(address);
      // 显示简短的提示
      const toast = document.createElement('div');
      toast.className = 'fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      toast.textContent = '✓ 地址已复制';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    } catch (error) {
      console.error('复制失败:', error);
      // 降级方案：使用传统方法
      const textArea = document.createElement('textarea');
      textArea.value = address;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
        toast.textContent = '✓ 地址已复制';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
      } catch (err) {
        console.error('复制失败:', err);
      }
      document.body.removeChild(textArea);
    }
  }

  /**
   * 绑定人工评级按钮事件
   */
  bindJudgeButtons() {
    document.querySelectorAll('.judge-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tokenAddress = e.target.dataset.address;
        const tokenSymbol = e.target.dataset.symbol;
        this.openJudgeModal(tokenAddress, tokenSymbol);
      });
    });

    document.querySelectorAll('.judge-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tokenAddress = e.target.dataset.address;
        this.deleteJudge(tokenAddress);
      });
    });
  }

  /**
   * 打开人工评级弹窗
   */
  openJudgeModal(tokenAddress, symbol) {
    this.currentEditingToken = tokenAddress;

    const modal = document.getElementById('judge-modal');
    const symbolEl = document.getElementById('modal-token-symbol');
    const addressEl = document.getElementById('modal-token-address');
    const noteEl = document.getElementById('judge-note');

    if (symbolEl) symbolEl.textContent = symbol || tokenAddress;
    if (addressEl) addressEl.textContent = tokenAddress;

    const narrativeData = this.narrativeDataMap.get(tokenAddress);
    const judgeData = narrativeData?.human_judge;
    const categoryRadios = document.querySelectorAll('input[name="judge-category"]');
    categoryRadios.forEach(radio => {
      radio.checked = radio.value === (judgeData?.category || '');
    });

    if (noteEl) noteEl.value = judgeData?.note || '';

    if (modal) modal.classList.remove('hidden');
  }

  /**
   * 关闭人工评级弹窗
   */
  closeJudgeModal() {
    const modal = document.getElementById('judge-modal');
    if (modal) modal.classList.add('hidden');

    const categoryRadios = document.querySelectorAll('input[name="judge-category"]');
    categoryRadios.forEach(radio => {
      radio.checked = false;
    });

    const noteEl = document.getElementById('judge-note');
    if (noteEl) noteEl.value = '';

    this.currentEditingToken = null;
  }

  /**
   * 保存人工评级
   */
  async saveJudge() {
    if (!this.currentEditingToken) return;

    const categoryRadios = document.querySelectorAll('input[name="judge-category"]');
    let selectedCategory = null;
    for (const radio of categoryRadios) {
      if (radio.checked) {
        selectedCategory = radio.value;
        break;
      }
    }

    if (!selectedCategory) {
      alert('请选择一个分类');
      return;
    }

    const noteEl = document.getElementById('judge-note');
    const note = noteEl ? noteEl.value : '';

    try {
      const response = await fetch(`/api/experiment/${this.experimentId}/narrative/judge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token_address: this.currentEditingToken,
          category: selectedCategory,
          note: note
        })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '保存失败');
      }

      // 更新本地数据
      const narrativeData = this.narrativeDataMap.get(this.currentEditingToken);
      if (narrativeData) {
        narrativeData.human_judge = {
          category: selectedCategory,
          note: note
        };
      } else {
        this.narrativeDataMap.set(this.currentEditingToken, {
          human_judge: {
            category: selectedCategory,
            note: note
          }
        });
      }

      // 关闭弹窗并刷新表格
      this.closeJudgeModal();
      this.applyFilterAndSort();

      // 显示成功提示
      const toast = document.createElement('div');
      toast.className = 'fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      toast.textContent = '✓ 评级已保存';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);

    } catch (error) {
      console.error('保存评级失败:', error);
      alert('保存失败: ' + error.message);
    }
  }

  /**
   * 删除人工评级
   */
  async deleteJudge(tokenAddress) {
    if (!confirm('确定要删除这个代币的人工评级吗？')) {
      return;
    }

    try {
      const response = await fetch(`/api/experiment/${this.experimentId}/narrative/judge`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token_address: tokenAddress
        })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '删除失败');
      }

      // 更新本地数据
      const narrativeData = this.narrativeDataMap.get(tokenAddress);
      if (narrativeData) {
        delete narrativeData.human_judge;
      }

      // 刷新表格
      this.applyFilterAndSort();

      // 显示成功提示
      const toast = document.createElement('div');
      toast.className = 'fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      toast.textContent = '✓ 评级已删除';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);

    } catch (error) {
      console.error('删除评级失败:', error);
      alert('删除失败: ' + error.message);
    }
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  window.experimentSignalStats = new ExperimentSignalStats();
});
