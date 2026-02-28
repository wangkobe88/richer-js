/**
 * 代币收益汇总页面
 */

// 标注分类映射
const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭', colorClass: 'text-red-400', bgClass: 'bg-red-900', borderClass: 'border-red-700' },
  no_user: { label: '无人玩', emoji: '👻', colorClass: 'text-gray-400', bgClass: 'bg-gray-700', borderClass: 'border-gray-600' },
  low_quality: { label: '低质量', emoji: '📉', colorClass: 'text-orange-400', bgClass: 'bg-orange-900', borderClass: 'border-orange-700' },
  mid_quality: { label: '中质量', emoji: '📊', colorClass: 'text-blue-400', bgClass: 'bg-blue-900', borderClass: 'border-blue-700' },
  high_quality: { label: '高质量', emoji: '🚀', colorClass: 'text-green-400', bgClass: 'bg-green-900', borderClass: 'border-green-700' }
};

class ExperimentTokenReturns {
  constructor() {
    this.experimentId = null;
    this.judgeExperimentId = null; // 用于保存标注的实际实验ID（回测时为源实验ID）
    this.experimentData = null;
    this.tradesData = [];
    this.tokenReturns = []; // { tokenAddress, symbol, pnl, ... }
    this.filteredReturns = [];
    this.sortField = 'returnRate';
    this.sortOrder = 'desc'; // 'asc' or 'desc'

    // 黑名单统计
    this.blacklistStats = null;
    this.blacklistTokenMap = new Map();
    // 白名单统计
    this.whitelistTokenMap = new Map();
    // 标注数据
    this.judgesData = new Map();
    // 平台数据
    this.tokenPlatformMap = new Map();
    // 当前编辑的代币地址
    this.currentEditingToken = null;

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

    // 标注模态框事件
    document.getElementById('judge-cancel-btn')?.addEventListener('click', () => {
      this.closeJudgeModal();
    });

    document.getElementById('judge-save-btn')?.addEventListener('click', () => {
      this.saveJudge();
    });

    const judgeModal = document.getElementById('judge-modal');
    if (judgeModal) {
      judgeModal.addEventListener('click', (e) => {
        if (e.target === judgeModal) {
          this.closeJudgeModal();
        }
      });
    }
  }

  async loadData() {
    this.showLoading(true);

    try {
      // 并行加载实验数据、交易数据和黑名单统计
      const [experimentRes, tradesRes, blacklistRes, tokensRes] = await Promise.all([
        fetch(`/api/experiment/${this.experimentId}`),
        fetch(`/api/experiment/${this.experimentId}/trades?limit=10000`),
        fetch(`/api/experiment/${this.experimentId}/holder-blacklist-stats`),
        fetch(`/api/experiment/${this.experimentId}/tokens?limit=10000`)
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

      // 检查是否是回测实验，获取标注数据时使用源实验ID
      this.judgeExperimentId = this.experimentId;
      if (this.experimentData.config?.backtest?.sourceExperimentId) {
        this.judgeExperimentId = this.experimentData.config.backtest.sourceExperimentId;
        console.log(`回测实验，标注将保存到源实验: ${this.judgeExperimentId}`);
      }

      // 加载标注数据和平台数据
      if (tokensRes.ok) {
        const tokensData = await tokensRes.json();
        if (tokensData.success && tokensData.tokens) {
          tokensData.tokens.forEach(token => {
            if (token.human_judges) {
              this.judgesData.set(token.token_address, token.human_judges);
            }
            // 保存平台信息
            if (token.platform) {
              this.tokenPlatformMap.set(token.token_address, token.platform);
            }
          });
        }
      }

      // 如果是回测且当前实验没有标注数据，尝试从源实验加载
      if (this.judgeExperimentId !== this.experimentId && (this.judgesData.size === 0 || this.tokenPlatformMap.size === 0)) {
        try {
          const sourceTokensRes = await fetch(`/api/experiment/${this.judgeExperimentId}/tokens?limit=10000`);
          if (sourceTokensRes.ok) {
            const sourceTokensData = await sourceTokensRes.json();
            if (sourceTokensData.success && sourceTokensData.tokens) {
              sourceTokensData.tokens.forEach(token => {
                if (token.human_judges) {
                  this.judgesData.set(token.token_address, token.human_judges);
                }
                // 同时加载平台数据
                if (token.platform) {
                  this.tokenPlatformMap.set(token.token_address, token.platform);
                }
              });
              console.log(`从源实验加载了 ${this.judgesData.size} 条标注数据`);
              console.log(`从源实验加载了 ${this.tokenPlatformMap.size} 条平台数据`);
            }
          }
        } catch (error) {
          console.error('从源实验加载标注数据失败:', error);
        }
      }

      // 加载黑名单/白名单统计
      if (blacklistRes.ok) {
        const blacklistData = await blacklistRes.json();
        if (blacklistData.success) {
          this.blacklistStats = blacklistData.data;
          // 建立代币到黑名单状态的映射
          this.blacklistTokenMap = new Map(
            (blacklistData.data.blacklistedTokenList || []).map(t => [t.token, t])
          );
          // 建立代币到白名单状态的映射
          this.whitelistTokenMap = new Map(
            (blacklistData.data.whitelistedTokenList || []).map(t => [t.token, t])
          );
        }
      }

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
      document.getElementById('pagination-container').innerHTML = '';
      return;
    }

    emptyState?.classList.add('hidden');

    // 直接展示全部数据
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

      // 检查是否命中黑名单
      const blacklistInfo = this.blacklistTokenMap?.get(item.tokenAddress);
      const hasBlacklist = blacklistInfo && blacklistInfo.hasBlacklist;
      const blacklistBadge = hasBlacklist
        ? '<span class="ml-2 px-2 py-0.5 bg-red-900 text-red-400 text-xs rounded border border-red-700" title="命中持有者黑名单">⚠️ 黑名单</span>'
        : '';

      // 检查是否命中白名单
      const whitelistInfo = this.whitelistTokenMap?.get(item.tokenAddress);
      const hasWhitelist = whitelistInfo && whitelistInfo.hasWhitelist;
      const whitelistBadge = hasWhitelist
        ? '<span class="ml-2 px-2 py-0.5 bg-green-900 text-green-400 text-xs rounded border border-green-700" title="命中持有者白名单">✨ 白名单</span>'
        : '';

      return `
        <tr class="table-row ${hasBlacklist ? 'bg-red-900/20' : ''}">
          <td class="px-4 py-3">
            <div class="flex items-center justify-between">
              <div>
                <span class="font-medium text-white">${item.symbol}</span>
                ${blacklistBadge}
                ${whitelistBadge}
              </div>
              <div class="flex items-center space-x-2">
                <button class="copy-addr-btn text-gray-400 hover:text-blue-400 transition-colors"
                        data-address="${item.tokenAddress}"
                        title="复制代币地址">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                  </svg>
                </button>
                <a href="https://gmgn.ai/bsc/token/${item.tokenAddress}" target="_blank" rel="noopener noreferrer"
                   class="text-gray-400 hover:text-purple-400 transition-colors"
                   title="在 GMGN 查看">
                  <img src="/static/gmgn.png" alt="GMGN" class="w-4 h-4">
                </a>
              </div>
            </div>
            <div class="text-xs text-gray-500 font-mono mt-1 flex items-center justify-between">
              <span>${item.tokenAddress.slice(0, 8)}...${item.tokenAddress.slice(-6)}</span>
              ${hasBlacklist ? '<span class="text-red-400">(' + (blacklistInfo.blacklistedHolders || 0) + '⚠️)</span>' : ''}
              ${hasWhitelist ? '<span class="text-green-400">(' + (whitelistInfo.whitelistedHolders || 0) + '✨)</span>' : ''}
            </div>
          </td>
          <td class="px-4 py-3 text-center">
            ${this.renderPlatformBadge(item.tokenAddress)}
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
            ${this.renderJudgeColumn(item.tokenAddress, item.symbol)}
          </td>
          <td class="px-4 py-3 text-center">
            <a href="/experiment/${this.experimentId}/trades#token=${item.tokenAddress}" target="_blank" class="text-blue-400 hover:text-blue-300 text-sm mr-2">
              查看交易
            </a>
            <a href="/experiment/${this.experimentId}/signals#token=${item.tokenAddress}" target="_blank" class="text-purple-400 hover:text-purple-300 text-sm mr-2">
              查看信号
            </a>
            <a href="${this.getTimeSeriesUrl(item.tokenAddress)}" target="_blank" class="text-emerald-400 hover:text-emerald-300 text-sm mr-2">
              时序数据
            </a>
            <a href="/token-holders?experiment=${this.experimentId}&token=${item.tokenAddress}" target="_blank" class="text-cyan-400 hover:text-cyan-300 text-sm mr-2">
              持有者
            </a>
            <a href="/token-early-trades?token=${item.tokenAddress}&chain=${this.experimentData?.blockchain || 'bsc'}" target="_blank" class="text-amber-400 hover:text-amber-300 text-sm">
              早期交易
            </a>
          </td>
        </tr>
      `;
    }).join('');

    // 绑定拷贝按钮事件
    this.bindCopyButtons();

    // 绑定标注按钮事件
    this.bindJudgeButtons();

    // 清空分页容器
    document.getElementById('pagination-container').innerHTML = '';
  }

  bindCopyButtons() {
    document.querySelectorAll('.copy-addr-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const address = btn.dataset.address;

        try {
          await navigator.clipboard.writeText(address);

          // 显示成功提示
          const originalHTML = btn.innerHTML;
          btn.innerHTML = `<svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
          </svg>`;

          setTimeout(() => {
            btn.innerHTML = originalHTML;
          }, 1500);
        } catch (err) {
          console.error('复制失败:', err);
          // 降级方案：使用传统方法
          const textArea = document.createElement('textarea');
          textArea.value = address;
          textArea.style.position = 'fixed';
          textArea.style.opacity = '0';
          document.body.appendChild(textArea);
          textArea.select();
          try {
            document.execCommand('copy');
          } catch (e) {
            console.error('降级复制也失败:', e);
          }
          document.body.removeChild(textArea);
        }
      });
    });
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
    // 更新全部代币统计
    this.updateAllTokensStats();

    // 更新干净代币统计
    this.updateCleanTokensStats();

    // 更新非流水盘代币统计
    this.updateNoFakePumpTokensStats();

    // 更新黑名单统计
    this.updateBlacklistStats();
  }

  /**
   * 更新全部代币统计
   */
  updateAllTokensStats() {
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

  /**
   * 更新干净代币统计（无黑名单持有者）
   */
  updateCleanTokensStats() {
    // 筛选未命中黑名单的代币
    const cleanTokens = this.tokenReturns.filter(item => {
      const blacklistInfo = this.blacklistTokenMap?.get(item.tokenAddress);
      return !blacklistInfo || !blacklistInfo.hasBlacklist;
    });

    const totalTokens = cleanTokens.length;
    const profitCount = cleanTokens.filter(t => t.pnl.returnRate > 0).length;
    const lossCount = cleanTokens.filter(t => t.pnl.returnRate < 0).length;
    const winRate = totalTokens > 0 ? (profitCount / totalTokens * 100) : 0;

    // 计算总收益率
    let totalSpent = 0;
    let totalReceived = 0;
    cleanTokens.forEach(t => {
      totalSpent += t.pnl.totalSpent;
      totalReceived += t.pnl.totalReceived + t.pnl.remainingCost;
    });
    const totalReturn = totalSpent > 0 ? ((totalReceived - totalSpent) / totalSpent * 100) : 0;

    // 计算 BNB 总增减
    const bnbChange = totalReceived - totalSpent;

    const totalReturnEl = document.getElementById('stat-clean-total-return');
    totalReturnEl.textContent = `${totalReturn > 0 ? '+' : ''}${totalReturn.toFixed(2)}%`;
    totalReturnEl.className = `text-2xl font-bold ${totalReturn > 0 ? 'text-green-600' : totalReturn < 0 ? 'text-red-500' : 'text-gray-600'}`;

    const bnbChangeEl = document.getElementById('stat-clean-bnb-change');
    bnbChangeEl.textContent = `${bnbChange > 0 ? '+' : ''}${bnbChange.toFixed(4)} BNB`;
    bnbChangeEl.className = `text-2xl font-bold ${bnbChange > 0 ? 'text-green-600' : bnbChange < 0 ? 'text-red-500' : 'text-gray-600'}`;

    document.getElementById('stat-clean-total-tokens').textContent = totalTokens;
    document.getElementById('stat-clean-profit-count').textContent = profitCount;
    document.getElementById('stat-clean-loss-count').textContent = lossCount;
    document.getElementById('stat-clean-win-rate').textContent = `${winRate.toFixed(1)}%`;
  }

  /**
   * 更新非流水盘代币统计（去除人工标注为fake_pump的代币）
   */
  updateNoFakePumpTokensStats() {
    // 筛选未标注为 fake_pump 的代币
    const noFakeTokens = this.tokenReturns.filter(item => {
      const judgeData = this.judgesData.get(item.tokenAddress);
      // 如果没有标注数据，或者标注类别不是 fake_pump，则计入非流水盘代币
      return !judgeData || !judgeData.category || judgeData.category !== 'fake_pump';
    });

    const totalTokens = noFakeTokens.length;
    const profitCount = noFakeTokens.filter(t => t.pnl.returnRate > 0).length;
    const lossCount = noFakeTokens.filter(t => t.pnl.returnRate < 0).length;
    const winRate = totalTokens > 0 ? (profitCount / totalTokens * 100) : 0;

    // 计算总收益率
    let totalSpent = 0;
    let totalReceived = 0;
    noFakeTokens.forEach(t => {
      totalSpent += t.pnl.totalSpent;
      totalReceived += t.pnl.totalReceived + t.pnl.remainingCost;
    });
    const totalReturn = totalSpent > 0 ? ((totalReceived - totalSpent) / totalSpent * 100) : 0;

    // 计算 BNB 总增减
    const bnbChange = totalReceived - totalSpent;

    const totalReturnEl = document.getElementById('stat-nofake-total-return');
    totalReturnEl.textContent = `${totalReturn > 0 ? '+' : ''}${totalReturn.toFixed(2)}%`;
    totalReturnEl.className = `text-2xl font-bold ${totalReturn > 0 ? 'text-green-600' : totalReturn < 0 ? 'text-red-500' : 'text-gray-600'}`;

    const bnbChangeEl = document.getElementById('stat-nofake-bnb-change');
    bnbChangeEl.textContent = `${bnbChange > 0 ? '+' : ''}${bnbChange.toFixed(4)} BNB`;
    bnbChangeEl.className = `text-2xl font-bold ${bnbChange > 0 ? 'text-green-600' : bnbChange < 0 ? 'text-red-500' : 'text-gray-600'}`;

    document.getElementById('stat-nofake-total-tokens').textContent = totalTokens;
    document.getElementById('stat-nofake-profit-count').textContent = profitCount;
    document.getElementById('stat-nofake-loss-count').textContent = lossCount;
    document.getElementById('stat-nofake-win-rate').textContent = `${winRate.toFixed(1)}%`;
  }

  /**
   * 更新黑名单统计
   */
  updateBlacklistStats() {
    if (this.blacklistStats) {
      // 黑名单统计
      document.getElementById('stat-collected-tokens').textContent = this.blacklistStats.totalTokens || 0;
      document.getElementById('stat-blacklisted-tokens').textContent = this.blacklistStats.blacklistedTokens || 0;
      document.getElementById('stat-blacklist-wallets').textContent = this.blacklistStats.blacklistWalletCount || 0;

      const rate = this.blacklistStats.totalTokens > 0
        ? (this.blacklistStats.blacklistedTokens / this.blacklistStats.totalTokens * 100)
        : 0;
      document.getElementById('stat-blacklist-rate').textContent = `${rate.toFixed(2)}%`;

      // 白名单统计
      document.getElementById('stat-whitelist-collected-tokens').textContent = this.blacklistStats.totalTokens || 0;
      document.getElementById('stat-whitelisted-tokens').textContent = this.blacklistStats.whitelistedTokens || 0;
      document.getElementById('stat-whitelist-wallets').textContent = this.blacklistStats.whitelistWalletCount || 0;

      const wRate = this.blacklistStats.totalTokens > 0
        ? (this.blacklistStats.whitelistedTokens / this.blacklistStats.totalTokens * 100)
        : 0;
      document.getElementById('stat-whitelist-rate').textContent = `${wRate.toFixed(2)}%`;
    }
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

  /**
   * 渲染平台徽章
   * @param {string} tokenAddress - 代币地址
   * @returns {string} 平台徽章 HTML
   */
  renderPlatformBadge(tokenAddress) {
    const platform = this.tokenPlatformMap.get(tokenAddress) || 'fourmeme';
    const platformLabel = platform === 'flap' ? 'Flap' : 'Four.meme';
    const platformClass = platform === 'flap' ? 'bg-purple-600' : 'bg-blue-600';
    return `<span class="px-2 py-0.5 rounded text-xs font-medium ${platformClass} text-white">${platformLabel}</span>`;
  }

  /**
   * 获取时序数据页面的URL
   * @param {string} tokenAddress - 代币地址
   * @returns {string} 时序数据页面URL
   */
  getTimeSeriesUrl(tokenAddress) {
    // 如果是回测实验，使用源实验ID；否则使用当前实验ID
    const targetExperimentId = this.judgeExperimentId || this.experimentId;
    return `/experiment/${targetExperimentId}/observer#token=${tokenAddress}`;
  }

  /**
   * 渲染标注列
   */
  renderJudgeColumn(tokenAddress, symbol) {
    const judgeData = this.judgesData.get(tokenAddress);

    if (!judgeData || !judgeData.category) {
      return `<button class="judge-btn px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white" data-token-address="${tokenAddress}" data-symbol="${symbol}">标注</button>`;
    }

    const category = CATEGORY_MAP[judgeData.category];
    if (!category) {
      return `<button class="judge-btn px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white" data-token-address="${tokenAddress}" data-symbol="${symbol}">标注</button>`;
    }

    return `
      <div class="flex items-center justify-center gap-1">
        <span class="px-2 py-1 rounded text-xs ${category.bgClass} ${category.colorClass} border ${category.borderClass}" title="${judgeData.note || ''}">
          ${category.emoji} ${category.label}
        </span>
        <button class="edit-judge-btn text-blue-400 hover:text-blue-300 text-xs" data-token-address="${tokenAddress}" data-symbol="${symbol}" title="编辑">✏️</button>
        <button class="delete-judge-btn text-red-400 hover:text-red-300 text-xs" data-token-address="${tokenAddress}" title="删除">🗑️</button>
      </div>
    `;
  }

  /**
   * 绑定标注按钮事件
   */
  bindJudgeButtons() {
    // 标注按钮
    document.querySelectorAll('.judge-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tokenAddress = btn.dataset.tokenAddress;
        this.openJudgeModal(tokenAddress, btn.dataset.symbol);
      });
    });

    // 编辑标注按钮
    document.querySelectorAll('.edit-judge-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tokenAddress = btn.dataset.tokenAddress;
        this.openJudgeModal(tokenAddress, btn.dataset.symbol);
      });
    });

    // 删除标注按钮
    document.querySelectorAll('.delete-judge-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tokenAddress = btn.dataset.tokenAddress;
        this.deleteJudge(tokenAddress);
      });
    });
  }

  /**
   * 打开标注模态框
   */
  openJudgeModal(tokenAddress, symbol) {
    this.currentEditingToken = tokenAddress;

    const modal = document.getElementById('judge-modal');
    const symbolEl = document.getElementById('modal-token-symbol');
    const addressEl = document.getElementById('modal-token-address');
    const noteEl = document.getElementById('judge-note');

    if (symbolEl) symbolEl.textContent = symbol || tokenAddress;
    if (addressEl) addressEl.textContent = tokenAddress;

    const judgeData = this.judgesData.get(tokenAddress);
    const categoryRadios = document.querySelectorAll('input[name="judge-category"]');
    categoryRadios.forEach(radio => {
      radio.checked = radio.value === (judgeData?.category || '');
    });

    if (noteEl) noteEl.value = judgeData?.note || '';

    if (modal) modal.classList.remove('hidden');
  }

  /**
   * 关闭标注模态框
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
   * 保存标注
   */
  async saveJudge() {
    if (!this.currentEditingToken) return;

    const selectedRadio = document.querySelector('input[name="judge-category"]:checked');
    if (!selectedRadio) {
      alert('请选择一个分类');
      return;
    }

    const category = selectedRadio.value;
    const noteEl = document.getElementById('judge-note');
    const note = noteEl?.value || '';

    try {
      const response = await fetch(`/api/experiment/${this.judgeExperimentId}/tokens/${this.currentEditingToken}/judge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, note })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      if (!result.success) throw new Error(result.error || '保存失败');

      this.judgesData.set(this.currentEditingToken, result.data.human_judges);
      this.closeJudgeModal();
      this.renderTable();
    } catch (error) {
      console.error('保存标注失败:', error);
      alert('保存失败: ' + error.message);
    }
  }

  /**
   * 删除标注
   */
  async deleteJudge(tokenAddress) {
    if (!confirm('确定要删除这个标注吗？')) return;

    try {
      const response = await fetch(`/api/experiment/${this.judgeExperimentId}/tokens/${tokenAddress}/judge`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      if (!result.success) throw new Error(result.error || '删除失败');

      this.judgesData.delete(tokenAddress);
      this.renderTable();
    } catch (error) {
      console.error('删除标注失败:', error);
      alert('删除失败: ' + error.message);
    }
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new ExperimentTokenReturns();
});
