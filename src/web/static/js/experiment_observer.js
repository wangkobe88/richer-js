/**
 * 实验观察页面逻辑
 * 负责加载和展示实验运行的时序数据
 */

class ExperimentObserver {
  constructor() {
    this.priceChart = null;
    this.factorChart = null;
    this.currentExperiment = null;
    this.currentToken = null;
    this.currentTimeSeriesData = [];
    this.currentPage = 1;
    this.pageSize = 50;
    this.totalPages = 1;

    this.init();
  }

  async init() {
    // 绑定元素
    this.experimentSelect = document.getElementById('experimentSelect');
    this.tokenSelect = document.getElementById('tokenSelect');
    this.tokenSelect2 = document.getElementById('tokenSelect2');
    this.factorSelect = document.getElementById('factorSelect');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.backToExperimentsBtn = document.getElementById('backToExperimentsBtn');
    this.errorContainer = document.getElementById('errorContainer');
    this.priceChartContainer = document.getElementById('priceChartContainer');
    this.factorChartContainer = document.getElementById('factorChartContainer');
    this.dataTableContainer = document.getElementById('dataTableContainer');

    // 新增元素
    this.experimentInfo = document.getElementById('experimentInfo');
    this.experimentSelector = document.getElementById('experimentSelector');
    this.experimentIdDisplay = document.getElementById('experimentIdDisplay');
    this.experimentDataCount = document.getElementById('experimentDataCount');

    // 绑定事件
    this.experimentSelect?.addEventListener('change', () => this.onExperimentChange());
    this.tokenSelect?.addEventListener('change', () => this.onTokenChange());
    this.tokenSelect2?.addEventListener('change', () => this.onTokenChange());
    this.factorSelect?.addEventListener('change', () => this.onFactorChange());
    this.refreshBtn?.addEventListener('click', () => this.refreshData());
    this.backToExperimentsBtn?.addEventListener('click', () => this.backToExperiments());

    // 绑定备用按钮（选择器模式下的按钮）
    const refreshBtn2 = document.getElementById('refreshBtn2');
    const backToExperimentsBtn2 = document.getElementById('backToExperimentsBtn2');
    if (refreshBtn2) refreshBtn2.addEventListener('click', () => this.refreshData());
    if (backToExperimentsBtn2) backToExperimentsBtn2.addEventListener('click', () => this.backToExperiments());

    // 从 URL 路径中提取实验 ID
    // 支持 /experiment/{id}/observer 格式
    const pathParts = window.location.pathname.split('/');
    const observerIndex = pathParts.indexOf('observer');
    let experimentIdFromPath = null;

    if (observerIndex > 0 && pathParts[observerIndex - 1]) {
      experimentIdFromPath = pathParts[observerIndex - 1];
    }

    // 同时也支持 URL 参数 ?experiment=xxx
    const urlParams = new URLSearchParams(window.location.search);
    const experimentIdFromParam = urlParams.get('experiment');

    this.preselectedExperimentId = experimentIdFromPath || experimentIdFromParam;

    // 优先处理 URL 中的实验参数
    if (this.preselectedExperimentId) {
      // 显示实验信息，隐藏选择器
      if (this.experimentInfo) this.experimentInfo.style.display = 'block';
      if (this.experimentSelector) this.experimentSelector.style.display = 'none';
      if (this.experimentIdDisplay) this.experimentIdDisplay.textContent = this.preselectedExperimentId;

      // 直接加载指定实验的数据
      this.currentExperiment = this.preselectedExperimentId;
      await this.loadTokens();
      // 解析URL hash中的token参数
      await this.parseHashToken();
      // 加载实验统计数据
      this.loadExperimentStats();
    } else {
      // 显示选择器，隐藏实验信息
      if (this.experimentSelector) this.experimentSelector.style.display = 'block';
      if (this.experimentInfo) this.experimentInfo.style.display = 'none';
      // 加载实验列表供用户选择
      this.loadExperiments();
    }
  }

  /**
   * 显示错误消息
   */
  showError(message) {
    if (this.errorContainer) {
      this.errorContainer.innerHTML = `<div class="error">${message}</div>`;
      this.errorContainer.style.display = 'block';
      setTimeout(() => {
        this.errorContainer.style.display = 'none';
      }, 5000);
    }
  }

  /**
   * 加载实验列表
   */
  async loadExperiments() {
    try {
      const response = await fetch('/api/experiment/time-series/experiments');
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '加载实验列表失败');
      }

      const experiments = result.data;

      if (experiments.length === 0) {
        if (this.experimentSelect) {
          this.experimentSelect.innerHTML = '<option value="">暂无数据</option>';
        }
        return;
      }

      // 填充实验选择器
      if (this.experimentSelect) {
        this.experimentSelect.innerHTML = '<option value="">请选择实验</option>';
        experiments.forEach(exp => {
          const option = document.createElement('option');
          option.value = exp.experimentId;
          const dataPointCount = exp.dataPointCount || 0;
          option.textContent = `${exp.experimentId.substring(0, 8)}... (${dataPointCount} 条数据)`;
          this.experimentSelect.appendChild(option);
        });
      }

      // 如果当前有选中的实验，同步选择器的值
      if (this.currentExperiment && this.experimentSelect) {
        this.experimentSelect.value = this.currentExperiment;
      }

    } catch (error) {
      console.error('加载实验列表失败:', error);
    }
  }

  /**
   * 实验改变事件
   */
  async onExperimentChange() {
    if (!this.experimentSelect) return;
    this.currentExperiment = this.experimentSelect.value;

    if (!this.currentExperiment) {
      if (this.tokenSelect) {
        this.tokenSelect.disabled = true;
        this.tokenSelect.innerHTML = '<option value="">请先选择实验</option>';
      }
      if (this.tokenSelect2) {
        this.tokenSelect2.disabled = true;
        this.tokenSelect2.innerHTML = '<option value="">请先选择实验</option>';
      }
      this.clearCharts();
      return;
    }

    // 加载代币列表
    await this.loadTokens();
  }

  /**
   * 加载代币列表
   * 从 experiment_tokens 表获取所有代币，并显示哪些代币有交易信号
   */
  async loadTokens() {
    try {
      // 使用新的 API 端点，从 experiment_tokens 表获取所有代币，包含信号标记
      const response = await fetch(`/api/experiment/${this.currentExperiment}/tokens-with-signals`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '加载代币列表失败');
      }

      const tokens = result.data;

      console.log(`📊 [代币列表] 加载完成: ${tokens.length} 个代币`);

      // 更新所有代币选择器
      const tokenSelectors = [this.tokenSelect, this.tokenSelect2].filter(el => el);
      tokenSelectors.forEach(select => {
        if (tokens.length === 0) {
          select.innerHTML = '<option value="">该实验暂无代币数据</option>';
          return;
        }

        // 填充代币选择器
        select.innerHTML = '<option value="">请选择代币</option>';
        tokens.forEach(token => {
          const option = document.createElement('option');
          option.value = token.address;

          // 构建显示文本，包含信号标记
          let displayText = `${token.symbol} (${token.address.substring(0, 8)}...)`;

          // 如果有信号，添加标记
          if (token.hasSignals && token.signalCount > 0) {
            const signalBadge = ` [🔴 ${token.signalCount}条]`;
            displayText += signalBadge;
            // 使用颜色区分：有信号的代币用红色文字
            option.style.color = '#ef4444';
            option.style.fontWeight = '500';
          }

          // 添加状态标记
          const statusEmoji = {
            'monitoring': '👁️',
            'bought': '💰',
            'exited': '🚪'
          };
          if (statusEmoji[token.status]) {
            displayText = statusEmoji[token.status] + ' ' + displayText;
          }

          option.textContent = displayText;
          option.title = `状态: ${token.status}, 信号: ${token.signalCount} (买${token.buySignalCount}/卖${token.sellSignalCount})`;
          select.appendChild(option);
        });

        select.disabled = false;
      });

      // 更新数据统计显示
      const signalCount = tokens.filter(t => t.hasSignals).length;
      if (this.experimentDataCount) {
        this.experimentDataCount.textContent = `共 ${tokens.length} 个代币, ${signalCount} 个有信号`;
      }

    } catch (error) {
      console.error('加载代币列表失败:', error);
      this.showError('加载代币列表失败: ' + error.message);
    }
  }

  /**
   * 解析 URL hash 中的 token 参数
   * 支持 #token=xxx 格式
   */
  async parseHashToken() {
    const hash = window.location.hash;
    const tokenMatch = hash.match(/#token=([^&]+)/);

    if (!tokenMatch) return;

    const tokenAddress = tokenMatch[1];

    // 获取当前活动的代币选择器
    // 当 experimentInfo 显示时，使用 tokenSelect
    // 当 experimentSelector 显示时，使用 tokenSelect2
    let activeSelect = null;

    if (this.experimentInfo && this.experimentInfo.style.display !== 'none') {
      // 使用 experimentInfo 区域的选择器
      activeSelect = this.tokenSelect;
    } else if (this.experimentSelector && this.experimentSelector.style.display !== 'none') {
      // 使用 experimentSelector 区域的选择器
      activeSelect = this.tokenSelect2;
    }

    // 如果上述逻辑没有匹配到，fallback 到原来的逻辑
    if (!activeSelect) {
      activeSelect = this.tokenSelect || this.tokenSelect2;
    }

    if (!activeSelect) return;

    // 检查代币是否在选择器中
    const tokenOption = Array.from(activeSelect.options).find(
      option => option.value === tokenAddress
    );

    if (tokenOption) {
      // 选中该代币
      activeSelect.value = tokenAddress;
      this.currentToken = tokenAddress;

      // 加载该代币的时序数据
      await this.loadTimeSeriesData();

      // 加载因子列表
      await this.loadFactors();

      console.log(`📊 [URL参数] 自动选中代币: ${tokenAddress}`);
    } else {
      console.warn(`⚠️ [URL参数] 未找到代币: ${tokenAddress}`);
    }
  }

  /**
   * 加载实验统计信息
   */
  async loadExperimentStats() {
    try {
      const response = await fetch('/api/experiment/time-series/experiments');
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '加载实验统计失败');
      }

      const experiments = result.data;
      const currentExp = experiments.find(e => e.experimentId === this.currentExperiment);

      if (currentExp && this.experimentDataCount) {
        this.experimentDataCount.textContent = `共 ${currentExp.dataPointCount} 条数据`;
      }
    } catch (error) {
      console.error('加载实验统计失败:', error);
    }
  }

  /**
   * 代币改变事件
   */
  async onTokenChange() {
    // 获取当前活动的代币选择器
    // 当 experimentInfo 显示时，使用 tokenSelect
    // 当 experimentSelector 显示时，使用 tokenSelect2
    let activeSelect = null;

    if (this.experimentInfo && this.experimentInfo.style.display !== 'none') {
      // 使用 experimentInfo 区域的选择器
      activeSelect = this.tokenSelect;
    } else if (this.experimentSelector && this.experimentSelector.style.display !== 'none') {
      // 使用 experimentSelector 区域的选择器
      activeSelect = this.tokenSelect2;
    }

    // 如果上述逻辑没有匹配到，fallback 到原来的逻辑
    if (!activeSelect) {
      activeSelect = this.tokenSelect || this.tokenSelect2;
    }

    if (!activeSelect) return;

    this.currentToken = activeSelect.value;

    if (!this.currentToken) {
      if (this.factorSelect) {
        this.factorSelect.disabled = true;
        this.factorSelect.innerHTML = '<option value="">请先选择代币</option>';
      }
      this.clearCharts();
      return;
    }

    // 加载时序数据
    await this.loadTimeSeriesData();

    // 加载因子列表
    await this.loadFactors();
  }

  /**
   * 加载时序数据
   */
  async loadTimeSeriesData() {
    try {
      const params = new URLSearchParams({
        experimentId: this.currentExperiment,
        tokenAddress: this.currentToken
      });

      const response = await fetch(`/api/experiment/time-series/data?${params}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '加载时序数据失败');
      }

      this.currentTimeSeriesData = result.data;

      console.log(`📊 [时序数据] 加载完成: ${result.data.length} 条数据`);

      // 渲染价格图表
      this.renderPriceChart();

      // 加载详细数据表格第一页
      this.currentPage = 1;
      await this.loadDataTable();

    } catch (error) {
      console.error('加载时序数据失败:', error);
      this.showError('加载时序数据失败: ' + error.message);
    }
  }

  /**
   * 加载因子列表
   */
  async loadFactors() {
    try {
      const params = new URLSearchParams({
        experimentId: this.currentExperiment,
        tokenAddress: this.currentToken
      });

      const response = await fetch(`/api/experiment/time-series/factors?${params}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '加载因子列表失败');
      }

      const factors = result.data;

      if (!this.factorSelect) return;

      if (factors.length === 0) {
        this.factorSelect.innerHTML = '<option value="">暂无因子数据</option>';
        return;
      }

      // 填充因子选择器
      this.factorSelect.innerHTML = '<option value="">请选择因子</option>';
      factors.forEach(factor => {
        const option = document.createElement('option');
        option.value = factor;
        // 中文显示名称映射
        const displayNames = {
          age: '代币年龄',
          currentPrice: '当前价格',
          collectionPrice: '获取时价格',
          earlyReturn: '早期收益率',
          buyPrice: '买入价格',
          holdDuration: '持仓时长',
          profitPercent: '利润百分比',
          // 历史最高价格相关因子
          highestPrice: '历史最高价',
          highestPriceTimestamp: '最高价时间戳',
          drawdownFromHighest: '距最高价跌幅',
          // AVE API 因子
          txVolumeU24h: '24小时交易量',
          holders: '持有者数量',
          tvl: '总锁仓量(TVL)',
          fdv: '完全稀释估值(FDV)',
          marketCap: '市值'
        };
        option.textContent = displayNames[factor] || factor;
        this.factorSelect.appendChild(option);
      });

      this.factorSelect.disabled = false;

    } catch (error) {
      console.error('加载因子列表失败:', error);
      this.showError('加载因子列表失败: ' + error.message);
    }
  }

  /**
   * 因子改变事件
   */
  async onFactorChange() {
    if (!this.factorSelect) return;
    const factorName = this.factorSelect.value;

    if (!factorName) {
      this.clearFactorChart();
      return;
    }

    // 加载因子时序数据
    await this.loadFactorData(factorName);
  }

  /**
   * 加载因子时序数据
   */
  async loadFactorData(factorName) {
    try {
      const params = new URLSearchParams({
        experimentId: this.currentExperiment,
        tokenAddress: this.currentToken,
        factorName: factorName
      });

      const response = await fetch(`/api/experiment/time-series/factor-data?${params}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '加载因子数据失败');
      }

      const factorData = result.data;

      console.log(`📈 [因子数据] ${factorName}: ${factorData.length} 条数据`);

      // 渲染因子图表
      this.renderFactorChart(factorName, factorData);

    } catch (error) {
      console.error('加载因子数据失败:', error);
      this.showError('加载因子数据失败: ' + error.message);
    }
  }

  /**
   * 渲染价格图表
   */
  renderPriceChart() {
    if (this.currentTimeSeriesData.length === 0) {
      if (this.priceChartContainer) {
        this.priceChartContainer.innerHTML = '<div class="empty-state"><p>暂无数据</p></div>';
      }
      return;
    }

    // 准备数据
    const labels = this.currentTimeSeriesData.map(d => new Date(d.timestamp));
    const prices = this.currentTimeSeriesData.map(d => d.price_usd ? parseFloat(d.price_usd) : null);

    // 清空容器
    if (this.priceChartContainer) {
      this.priceChartContainer.innerHTML = '<canvas id="priceChart"></canvas>';
      const canvas = document.getElementById('priceChart');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');

      // 销毁旧图表
      if (this.priceChart) {
        this.priceChart.destroy();
      }

      // 创建图表
      this.priceChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: '价格 (USDT)',
            data: prices,
            borderColor: '#1890ff',
            backgroundColor: 'rgba(24, 144, 255, 0.1)',
            tension: 0.1,
            pointRadius: 0,
            pointHoverRadius: 5,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: (context) => {
                  const value = context.raw;
                  if (value !== null) {
                    return `价格: $${value.toExponential(4)}`;
                  }
                  return '价格: N/A';
                }
              }
            },
            legend: {
              position: 'top'
            }
          },
          scales: {
            x: {
              type: 'time',
              time: {
                displayFormats: {
                  minute: 'HH:mm',
                  hour: 'MM-dd HH:mm'
                }
              },
              title: {
                display: true,
                text: '时间'
              }
            },
            y: {
              type: 'linear',
              display: true,
              position: 'left',
              title: {
                display: true,
                text: '价格 (USDT)'
              }
            }
          }
        }
      });
    }
  }

  /**
   * 渲染因子图表
   */
  renderFactorChart(factorName, factorData) {
    if (factorData.length === 0) {
      if (this.factorChartContainer) {
        this.factorChartContainer.innerHTML = '<div class="empty-state"><p>暂无数据</p></div>';
      }
      return;
    }

    // 准备数据
    const labels = factorData.map(d => new Date(d.timestamp));
    const values = factorData.map(d => d.value);

    // 清空容器
    if (this.factorChartContainer) {
      this.factorChartContainer.innerHTML = '<canvas id="factorChart"></canvas>';
      const canvas = document.getElementById('factorChart');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');

      // 销毁旧图表
      if (this.factorChart) {
        this.factorChart.destroy();
      }

      // 创建图表
      this.factorChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: factorName,
            data: values,
            borderColor: '#722ed1',
            backgroundColor: 'rgba(114, 46, 209, 0.1)',
            tension: 0.1,
            pointRadius: 2,
            pointHoverRadius: 5,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: (context) => {
                  const value = context.raw;
                  if (typeof value === 'number') {
                    return `${factorName}: ${value.toFixed(4)}`;
                  }
                  return `${factorName}: ${value}`;
                }
              }
            },
            legend: {
              position: 'top'
            }
          },
          scales: {
            x: {
              type: 'time',
              time: {
                displayFormats: {
                  minute: 'HH:mm',
                  hour: 'MM-dd HH:mm'
                }
              },
              title: {
                display: true,
                text: '时间'
              }
            },
            y: {
              title: {
                display: true,
                text: factorName
              }
            }
          }
        }
      });
    }
  }

  /**
   * 加载详细数据表格
   */
  async loadDataTable() {
    try {
      const params = new URLSearchParams({
        experimentId: this.currentExperiment,
        tokenAddress: this.currentToken,
        page: this.currentPage,
        pageSize: this.pageSize
      });

      const response = await fetch(`/api/experiment/time-series/data/paginated?${params}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '加载数据表格失败');
      }

      const { data, total, page, pageSize, totalPages } = result.data;
      this.totalPages = totalPages;

      // 渲染表格
      this.renderDataTable(data, total, page, pageSize, totalPages);

    } catch (error) {
      console.error('加载数据表格失败:', error);
      this.showError('加载数据表格失败: ' + error.message);
    }
  }

  /**
   * 渲染数据表格
   */
  renderDataTable(data, total, page, pageSize, totalPages) {
    if (!this.dataTableContainer) return;

    if (data.length === 0) {
      this.dataTableContainer.innerHTML = '<div class="empty-state"><p>暂无数据</p></div>';
      return;
    }

    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>轮次</th>
            <th>价格 (USDT)</th>
            <th>信号类型</th>
            <th>执行状态</th>
            <th>策略信息</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.forEach(row => {
      const timestamp = new Date(row.timestamp).toLocaleString('zh-CN');
      const price = row.price_usd ? parseFloat(row.price_usd) : null;
      const priceDisplay = price !== null ? `$${price.toExponential(4)}` : 'N/A';
      const signalType = row.signal_type || '-';
      const signalExecuted = row.signal_executed;
      const executionReason = row.execution_reason || '-';

      let signalBadge = '<span class="signal-badge signal-hold">-</span>';
      if (signalType === 'BUY') {
        signalBadge = '<span class="signal-badge signal-buy">买入</span>';
      } else if (signalType === 'SELL') {
        signalBadge = '<span class="signal-badge signal-sell">卖出</span>';
      }

      let executedHtml = '-';
      if (signalExecuted !== null && signalExecuted !== undefined) {
        executedHtml = signalExecuted
          ? '<span class="executed-badge executed-true">✓ 已执行</span>'
          : '<span class="executed-badge executed-false">✗ 未执行</span>';
      }

      html += `
        <tr>
          <td>${timestamp}</td>
          <td>${row.loop_count}</td>
          <td>${priceDisplay}</td>
          <td>${signalBadge}</td>
          <td>${executedHtml}</td>
          <td style="font-size: 12px; color: #666; max-width: 300px; overflow: hidden; text-overflow: ellipsis;">${executionReason}</td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    // 添加分页
    html += `
      <div class="pagination">
        <button ${page <= 1 ? 'disabled' : ''} onclick="window.observer.goToPage(${page - 1})">上一页</button>
        <span class="page-info">第 ${page} / ${totalPages} 页 (共 ${total} 条)</span>
        <button ${page >= totalPages ? 'disabled' : ''} onclick="window.observer.goToPage(${page + 1})">下一页</button>
      </div>
    `;

    this.dataTableContainer.innerHTML = html;
  }

  /**
   * 跳转到指定页
   */
  async goToPage(page) {
    if (page < 1 || page > this.totalPages) {
      return;
    }
    this.currentPage = page;
    await this.loadDataTable();
  }

  /**
   * 刷新数据
   */
  async refreshData() {
    if (this.currentToken) {
      await this.loadTimeSeriesData();
      if (this.factorSelect) {
        const currentFactor = this.factorSelect.value;
        if (currentFactor) {
          await this.loadFactorData(currentFactor);
        }
      }
    } else if (this.currentExperiment) {
      await this.loadTokens();
    } else {
      await this.loadExperiments();
    }
  }

  /**
   * 清除图表
   */
  clearCharts() {
    this.clearPriceChart();
    this.clearFactorChart();
    if (this.dataTableContainer) {
      this.dataTableContainer.innerHTML = '<div class="empty-state"><p>请选择实验和代币以查看详细数据</p></div>';
    }
  }

  clearPriceChart() {
    if (this.priceChart) {
      this.priceChart.destroy();
      this.priceChart = null;
    }
    if (this.priceChartContainer) {
      this.priceChartContainer.innerHTML = '<div class="empty-state"><p>请选择实验和代币以查看数据</p></div>';
    }
  }

  clearFactorChart() {
    if (this.factorChart) {
      this.factorChart.destroy();
      this.factorChart = null;
    }
    if (this.factorChartContainer) {
      this.factorChartContainer.innerHTML = '<div class="empty-state"><p>选择因子以查看趋势</p></div>';
    }
  }

  /**
   * 返回实验面板
   */
  backToExperiments() {
    window.location.href = '/experiments';
  }
}

// 初始化
let observer;
document.addEventListener('DOMContentLoaded', async () => {
  observer = new ExperimentObserver();
  // 暴露到全局以便分页按钮调用
  window.observer = observer;
});
