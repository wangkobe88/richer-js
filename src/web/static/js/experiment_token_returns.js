/**
 * 代币收益汇总页面
 */

class ExperimentTokenReturns {
  constructor() {
    this.experimentId = null;
    this.experimentData = null;
    this.tradesData = [];
    this.tokenReturns = []; // { tokenAddress, symbol, pnl, ... }
    this.filteredReturns = [];
    this.sortField = 'returnRate';
    this.sortOrder = 'desc'; // 'asc' or 'desc'

    this.init();
  }

  async init() {
    // 从 URL 获取实验 ID
    const pathParts = window.location.pathname.split('/');
    this.experimentId = pathParts[pathParts.length - 2]; // /experiment/:id/token-returns

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

    // 状态筛选
    document.getElementById('status-filter')?.addEventListener('change', (e) => {
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

    // 导出 CSV
    document.getElementById('export-btn')?.addEventListener('click', () => {
      this.exportToCSV();
    });
  }

  async loadData() {
    this.showLoading(true);

    try {
      // 并行加载实验数据和交易数据
      const [experimentRes, tradesRes] = await Promise.all([
        fetch(`/api/experiment/${this.experimentId}`),
        fetch(`/api/experiment/${this.experimentId}/trades?limit=1000`)
      ]);

      if (!experimentRes.ok || !tradesRes.ok) {
        throw new Error('加载数据失败');
      }

      const experimentData = await experimentRes.json();
      const tradesData = await tradesRes.json();

      if (!experimentData.success || !tradesData.success) {
        throw new Error('数据格式错误');
      }

      this.experimentData = experimentData.data;
      this.tradesData = tradesData.trades || [];

      // 计算所有代币收益
      this.calculateAllTokensPnL();

      // 更新页面
      this.updateHeader();
      this.updateStats();
      this.applyFilterAndSort();

      this.showContent(true);
    } catch (error) {
      console.error('加载数据失败:', error);
      this.showError(error.message);
    } finally {
      this.showLoading(false);
    }
  }

  /**
   * 计算所有代币的盈亏
   */
  calculateAllTokensPnL() {
    // 获取所有有交易的代币
    const tokenAddresses = [...new Set(this.tradesData.map(t => t.token_address))];

    this.tokenReturns = tokenAddresses.map(tokenAddress => {
      const pnl = this.calculateTokenPnL(tokenAddress);

      // 获取代币符号
      const tokenTrades = this.tradesData.filter(t => t.token_address === tokenAddress);
      const symbol = tokenTrades[0]?.token_symbol || 'Unknown';

      return {
        tokenAddress,
        symbol,
        pnl
      };
    }).filter(item => item.pnl !== null); // 过滤掉没有有效数据的代币
  }

  /**
   * 计算单个代币的盈亏（复用交易页面的计算方法）
   * @param {string} tokenAddress - 代币地址
   * @returns {Object|null} 盈亏信息
   */
  calculateTokenPnL(tokenAddress) {
    // 获取该代币的所有成功交易，按时间排序
    const tokenTrades = this.tradesData
      .filter(t => t.token_address === tokenAddress && (t.status === 'success' || t.trade_status === 'success'))
      .sort((a, b) => new Date(a.created_at || a.executed_at) - new Date(b.created_at || b.executed_at));

    if (tokenTrades.length === 0) {
      return null;
    }

    // FIFO 队列跟踪买入成本
    const buyQueue = []; // { amount, cost, price }
    let totalRealizedPnL = 0; // 已实现盈亏
    let totalBNBSpent = 0; // 总花费 BNB
    let totalBNBReceived = 0; // 总收到 BNB

    tokenTrades.forEach(trade => {
      const direction = trade.trade_direction || trade.direction || trade.action;
      const isBuy = direction === 'buy' || direction === 'BUY';

      if (isBuy) {
        // 买入：记录到队列
        const inputAmount = parseFloat(trade.input_amount || 0); // BNB 花费
        const outputAmount = parseFloat(trade.output_amount || 0); // 代币数量
        const unitPrice = parseFloat(trade.unit_price || 0);

        if (outputAmount > 0) {
          buyQueue.push({
            amount: outputAmount,
            cost: inputAmount,
            price: unitPrice
          });
          totalBNBSpent += inputAmount;
        }
      } else {
        // 卖出：FIFO 匹配
        const inputAmount = parseFloat(trade.input_amount || 0); // 代币数量
        const outputAmount = parseFloat(trade.output_amount || 0); // BNB 收到
        const unitPrice = parseFloat(trade.unit_price || 0);

        let remainingToSell = inputAmount;
        let costOfSold = 0;

        while (remainingToSell > 0 && buyQueue.length > 0) {
          const oldestBuy = buyQueue[0];
          const sellAmount = Math.min(remainingToSell, oldestBuy.amount);

          // 计算本次卖出的成本
          const unitCost = oldestBuy.cost / oldestBuy.amount;
          costOfSold += unitCost * sellAmount;
          remainingToSell -= sellAmount;

          // 更新队列中的剩余数量和成本
          oldestBuy.amount -= sellAmount;
          oldestBuy.cost -= unitCost * sellAmount;

          if (oldestBuy.amount <= 0.00000001) {
            buyQueue.shift(); // 移除已完全匹配的买入
          }
        }

        totalBNBReceived += outputAmount;
        totalRealizedPnL += (outputAmount - costOfSold);
      }
    });

    // 计算剩余持仓
    let remainingAmount = 0;
    let remainingCost = 0;
    buyQueue.forEach(buy => {
      remainingAmount += buy.amount;
      remainingCost += buy.cost;
    });

    // 计算收益率
    const totalCost = totalBNBSpent || 1; // 避免除零
    const totalValue = totalBNBReceived + remainingCost; // 剩余部分按成本价计算
    const returnRate = ((totalValue - totalCost) / totalCost) * 100;

    // 确定状态
    let status = 'monitoring';
    if (buyQueue.length === 0) {
      status = 'exited';
    } else if (totalBNBReceived > 0) {
      status = 'bought';
    }

    return {
      returnRate,
      realizedPnL: totalRealizedPnL,
      totalSpent: totalBNBSpent,
      totalReceived: totalBNBReceived,
      remainingAmount,
      remainingCost,
      buyCount: tokenTrades.filter(t => (t.trade_direction || t.direction || t.action) === 'buy' || (t.trade_direction || t.direction || t.action) === 'BUY').length,
      sellCount: tokenTrades.filter(t => (t.trade_direction || t.direction || t.action) === 'sell' || (t.trade_direction || t.direction || t.action) === 'SELL').length,
      status
    };
  }

  applyFilterAndSort() {
    const statusFilter = document.getElementById('status-filter')?.value || 'all';

    // 应用筛选
    let filtered = [...this.tokenReturns];

    if (statusFilter !== 'all') {
      filtered = filtered.filter(item => {
        const pnl = item.pnl;
        switch (statusFilter) {
          case 'profit':
            return pnl.returnRate > 0;
          case 'loss':
            return pnl.returnRate < 0;
          case 'holding':
            return pnl.status !== 'exited';
          case 'exited':
            return pnl.status === 'exited';
          default:
            return true;
        }
      });
    }

    this.filteredReturns = filtered;

    // 应用排序
    this.sortData();

    // 渲染表格
    this.renderTable();
  }

  sortData() {
    this.filteredReturns.sort((a, b) => {
      let aVal, bVal;

      switch (this.sortField) {
        case 'symbol':
          aVal = a.symbol.toLowerCase();
          bVal = b.symbol.toLowerCase();
          break;
        case 'returnRate':
          aVal = a.pnl.returnRate;
          bVal = b.pnl.returnRate;
          break;
        case 'realizedPnL':
          aVal = a.pnl.realizedPnL;
          bVal = b.pnl.realizedPnL;
          break;
        case 'totalSpent':
          aVal = a.pnl.totalSpent;
          bVal = b.pnl.totalSpent;
          break;
        case 'totalReceived':
          aVal = a.pnl.totalReceived;
          bVal = b.pnl.totalReceived;
          break;
        default:
          return 0;
      }

      if (typeof aVal === 'string') {
        return this.sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return this.sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }

  updateSortButtons() {
    document.querySelectorAll('.sort-btn').forEach(btn => {
      const field = btn.dataset.sort;
      btn.classList.toggle('active', field === this.sortField);
      // 可以添加排序箭头指示
    });
  }

  renderTable() {
    const tbody = document.getElementById('returns-table-body');
    const emptyState = document.getElementById('empty-state');

    if (!tbody) return;

    if (this.filteredReturns.length === 0) {
      tbody.innerHTML = '';
      emptyState?.classList.remove('hidden');
      return;
    }

    emptyState?.classList.add('hidden');

    tbody.innerHTML = this.filteredReturns.map(item => {
      const pnl = item.pnl;

      // 格式化数值
      const returnRateClass = pnl.returnRate > 0 ? 'profit-positive' : pnl.returnRate < 0 ? 'profit-negative' : 'profit-neutral';
      const returnRateSign = pnl.returnRate > 0 ? '+' : '';
      const pnlClass = pnl.realizedPnL > 0 ? 'profit-positive' : pnl.realizedPnL < 0 ? 'profit-negative' : 'profit-neutral';
      const pnlSign = pnl.realizedPnL > 0 ? '+' : '';

      // 状态徽章
      let statusBadge = '';
      switch (pnl.status) {
        case 'monitoring':
          statusBadge = '<span class="status-badge status-monitoring">监控中</span>';
          break;
        case 'bought':
          statusBadge = '<span class="status-badge status-bought">已买入</span>';
          break;
        case 'exited':
          statusBadge = '<span class="status-badge status-exited">已退出</span>';
          break;
      }

      return `
        <tr class="table-row">
          <td class="px-4 py-3">
            <div class="flex items-center">
              <span class="font-medium text-white">${item.symbol}</span>
            </div>
            <div class="text-xs text-gray-500 font-mono mt-1">${item.tokenAddress.slice(0, 8)}...${item.tokenAddress.slice(-6)}</div>
          </td>
          <td class="px-4 py-3 text-right">
            <span class="${returnRateClass}">${returnRateSign}${pnl.returnRate.toFixed(2)}%</span>
          </td>
          <td class="px-4 py-3 text-right">
            <span class="${pnlClass}">${pnlSign}${pnl.realizedPnL.toFixed(4)} BNB</span>
          </td>
          <td class="px-4 py-3 text-right text-gray-400">
            ${pnl.totalSpent.toFixed(4)} BNB
          </td>
          <td class="px-4 py-3 text-right text-gray-400">
            ${pnl.totalReceived.toFixed(4)} BNB
          </td>
          <td class="px-4 py-3 text-center text-blue-400">
            ${pnl.buyCount}
          </td>
          <td class="px-4 py-3 text-center text-purple-400">
            ${pnl.sellCount}
          </td>
          <td class="px-4 py-3 text-center">
            ${statusBadge}
          </td>
          <td class="px-4 py-3 text-center">
            <a href="/experiment/${this.experimentId}/trades#token=${item.tokenAddress}" class="text-blue-400 hover:text-blue-300 text-sm">
              查看交易
            </a>
          </td>
        </tr>
      `;
    }).join('');
  }

  updateHeader() {
    const nameEl = document.getElementById('experiment-name');
    const idEl = document.getElementById('experiment-id');
    const blockchainEl = document.getElementById('experiment-blockchain');
    const countEl = document.getElementById('token-count');
    const linkDetail = document.getElementById('link-detail');
    const linkSignals = document.getElementById('link-signals');
    const linkTrades = document.getElementById('link-trades');
    const linkBack = document.getElementById('link-back');

    if (nameEl) {
      const name = this.experimentData.experimentName || this.experimentData.name || '未命名实验';
      nameEl.textContent = name;
    }
    if (idEl) idEl.textContent = `ID: ${this.experimentId.slice(0, 8)}...`;
    if (blockchainEl) blockchainEl.textContent = `区块链: ${this.experimentData.blockchain || 'BSC'}`;
    if (countEl) countEl.textContent = `交易代币: ${this.tokenReturns.length}`;

    const baseUrl = `/experiment/${this.experimentId}`;
    if (linkDetail) linkDetail.href = `${baseUrl}`;
    if (linkSignals) linkSignals.href = `${baseUrl}/signals`;
    if (linkTrades) linkTrades.href = `${baseUrl}/trades`;
    if (linkBack) linkBack.href = `${baseUrl}`;
  }

  updateStats() {
    const totalTokens = this.tokenReturns.length;
    const profitCount = this.tokenReturns.filter(t => t.pnl.returnRate > 0).length;
    const lossCount = this.tokenReturns.filter(t => t.pnl.returnRate < 0).length;
    const winRate = totalTokens > 0 ? (profitCount / totalTokens * 100) : 0;

    // 计算总收益率（所有代币的总花费和总收回）
    let totalSpent = 0;
    let totalReceived = 0;
    this.tokenReturns.forEach(t => {
      totalSpent += t.pnl.totalSpent;
      totalReceived += t.pnl.totalReceived + t.pnl.remainingCost;
    });
    const totalReturn = totalSpent > 0 ? ((totalReceived - totalSpent) / totalSpent * 100) : 0;

    // 计算 BNB 总增减（净盈亏）
    const bnbChange = totalReceived - totalSpent;

    const totalReturnEl = document.getElementById('stat-total-return');
    totalReturnEl.textContent = `${totalReturn > 0 ? '+' : ''}${totalReturn.toFixed(2)}%`;
    totalReturnEl.className = `text-2xl font-bold ${totalReturn > 0 ? 'text-green-600' : totalReturn < 0 ? 'text-red-500' : 'text-gray-600'}`;

    // BNB 总增减显示
    const bnbChangeEl = document.getElementById('stat-bnb-change');
    bnbChangeEl.textContent = `${bnbChange > 0 ? '+' : ''}${bnbChange.toFixed(4)} BNB`;
    bnbChangeEl.className = `text-2xl font-bold ${bnbChange > 0 ? 'text-green-600' : bnbChange < 0 ? 'text-red-500' : 'text-gray-600'}`;

    document.getElementById('stat-total-tokens').textContent = totalTokens;
    document.getElementById('stat-profit-count').textContent = profitCount;
    document.getElementById('stat-loss-count').textContent = lossCount;
    document.getElementById('stat-win-rate').textContent = `${winRate.toFixed(1)}%`;
  }

  exportToCSV() {
    const headers = ['代币', '代币地址', '收益率(%)', '盈亏金额(BNB)', '总花费(BNB)', '总收回(BNB)', '剩余持仓', '买入次数', '卖出次数', '状态'];
    const rows = this.filteredReturns.map(item => {
      const pnl = item.pnl;
      let statusText = '';
      switch (pnl.status) {
        case 'monitoring': statusText = '监控中'; break;
        case 'bought': statusText = '已买入'; break;
        case 'exited': statusText = '已退出'; break;
      }
      return [
        item.symbol,
        item.tokenAddress,
        pnl.returnRate.toFixed(2),
        pnl.realizedPnL.toFixed(4),
        pnl.totalSpent.toFixed(4),
        pnl.totalReceived.toFixed(4),
        pnl.remainingAmount.toFixed(2),
        pnl.buyCount,
        pnl.sellCount,
        statusText
      ];
    });

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `token-returns-${this.experimentId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  showLoading(show) {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.toggle('hidden', !show);
    }
  }

  showContent(show) {
    const content = document.getElementById('returns-content');
    if (content) {
      content.classList.toggle('hidden', !show);
    }
  }

  showError(message) {
    const errorEl = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    if (errorText) errorText.textContent = message;
    if (errorEl) errorEl.classList.remove('hidden');
    this.showLoading(false);
    this.showContent(false);
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new ExperimentTokenReturns();
});
