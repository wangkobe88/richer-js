/**
 * 交易策略分析页面逻辑
 */

class StrategyAnalysisPage {
  constructor() {
    this.experiments = [];
    this.tokens = [];
    this.strategies = { buy: [], sell: [] };
    this.currentTimeIndex = 0;
    this.analysisData = null;
    this.chart = null;
    this.priceChart = null;

    this.init();
  }

  async init() {
    // 绑定元素
    this.experimentSelect = document.getElementById('experimentSelect');
    this.tokenSelect = document.getElementById('tokenSelect');
    this.strategyTypeSelect = document.getElementById('strategyTypeSelect');
    this.strategySelect = document.getElementById('strategySelect');
    this.analyzeBtn = document.getElementById('analyzeBtn');

    // 绑定事件
    this.experimentSelect.addEventListener('change', () => this.onExperimentChange());
    this.tokenSelect.addEventListener('change', () => this.onTokenChange());
    this.strategyTypeSelect.addEventListener('change', () => this.onStrategyTypeChange());
    this.analyzeBtn.addEventListener('click', () => this.analyze());
    document.getElementById('prevBtn').addEventListener('click', () => this.prevTimePoint());
    document.getElementById('nextBtn').addEventListener('click', () => this.nextTimePoint());

    // 加载实验列表
    await this.loadExperiments();

    // 检查 URL 参数
    this.checkURLParams();
  }

  async loadExperiments() {
    try {
      const response = await fetch('/api/experiments');
      const result = await response.json();

      if (result.success && result.data) {
        this.experiments = result.data;
        this.populateExperimentSelect();
      }
    } catch (error) {
      this.showError('加载实验列表失败: ' + error.message);
    }
  }

  populateExperimentSelect() {
    this.experimentSelect.innerHTML = '<option value="">选择实验...</option>';
    this.experiments.forEach(exp => {
      const option = document.createElement('option');
      option.value = exp.id;
      option.textContent = `${exp.experimentName} (${exp.id.substring(0, 8)}...)`;
      this.experimentSelect.appendChild(option);
    });
  }

  async onExperimentChange() {
    const experimentId = this.experimentSelect.value;
    if (!experimentId) {
      this.tokenSelect.innerHTML = '<option value="">请先选择实验</option>';
      this.tokenSelect.disabled = true;
      return;
    }

    this.tokenSelect.disabled = false;
    await this.loadTokens(experimentId);
    await this.loadStrategies(experimentId);
  }

  async loadTokens(experimentId) {
    try {
      const response = await fetch(`/api/experiment/${experimentId}/tokens-with-signals`);
      const result = await response.json();

      if (result.success && result.data) {
        this.tokens = result.data;
        this.populateTokenSelect();
      }
    } catch (error) {
      this.showError('加载代币列表失败: ' + error.message);
    }
  }

  populateTokenSelect() {
    this.tokenSelect.innerHTML = '<option value="">选择代币...</option>';
    this.tokens.forEach(token => {
      const option = document.createElement('option');
      // 使用 token_address 字段（数据库字段名）
      option.value = token.token_address || token.address;
      const symbol = token.token_symbol || token.symbol || 'Unknown';
      const address = token.token_address || token.address;
      const displayText = `${symbol} (${address.substring(0, 8)}...)`;
      option.textContent = displayText;
      this.tokenSelect.appendChild(option);
    });
  }

  async loadStrategies(experimentId) {
    try {
      const response = await fetch(`/api/experiment/strategies?experimentId=${experimentId}`);
      const result = await response.json();

      if (result.success && result.data) {
        // 转换格式：buyStrategies -> buy, sellStrategies -> sell
        this.strategies = {
          buy: result.data.buyStrategies || [],
          sell: result.data.sellStrategies || []
        };

        // 启用策略类型选择框，并默认选择"买入"
        this.strategyTypeSelect.disabled = false;
        this.strategyTypeSelect.value = 'buy';

        // 启用策略选择框并更新选项
        this.strategySelect.disabled = false;
        this.updateStrategySelect();

        // 如果有买入策略，默认选择第一个
        if (this.strategies.buy.length > 0) {
          this.strategySelect.value = '0';
          this.updateAnalyzeButton();
        }
      }
    } catch (error) {
      console.error('加载策略列表异常:', error);
      this.showError('加载策略列表失败: ' + error.message);
    }
  }

  onTokenChange() {
    this.updateAnalyzeButton();
  }

  onStrategyTypeChange() {
    this.strategySelect.disabled = false;
    this.updateStrategySelect();
    this.updateAnalyzeButton();
  }

  updateStrategySelect() {
    const strategyType = this.strategyTypeSelect.value;
    const strategies = this.strategies[strategyType] || [];

    this.strategySelect.innerHTML = '<option value="">选择策略...</option>';
    strategies.forEach((strategy, index) => {
      const option = document.createElement('option');
      option.value = index;
      const desc = strategy.description || `策略${index + 1}`;
      option.textContent = `${desc} - ${strategy.condition.substring(0, 50)}...`;
      this.strategySelect.appendChild(option);
    });
  }

  updateAnalyzeButton() {
    const hasExperiment = !!this.experimentSelect.value;
    const hasToken = !!this.tokenSelect.value;
    const hasStrategy = !!this.strategySelect.value;

    this.analyzeBtn.disabled = !(hasExperiment && hasToken && hasStrategy);
  }

  async analyze() {
    const experimentId = this.experimentSelect.value;
    const tokenAddress = this.tokenSelect.value;
    const strategyType = this.strategyTypeSelect.value;
    const strategyIndex = parseInt(this.strategySelect.value);

    this.showLoading(true);
    this.hideError();

    try {
      const params = new URLSearchParams({
        experimentId,
        tokenAddress,
        strategyType,
        strategyIndex: strategyIndex.toString()
      });

      const response = await fetch(`/api/experiment/strategy-analysis?${params}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '分析失败');
      }

      this.analysisData = result.data;
      this.currentTimeIndex = 0;

      this.renderStrategySummary();
      this.renderChart();
      this.renderDetails(0);

      document.getElementById('chartContainer').style.display = 'block';
      document.getElementById('priceChartContainer').style.display = 'block';
      document.getElementById('strategySummary').style.display = 'block';
      document.getElementById('detailsContainer').style.display = 'block';
      document.getElementById('emptyState').style.display = 'none';

    } catch (error) {
      this.showError('分析失败: ' + error.message);
    } finally {
      this.showLoading(false);
    }
  }

  renderStrategySummary() {
    const strategy = this.analysisData.strategy;
    const conditionEl = document.getElementById('strategyCondition');
    conditionEl.textContent = strategy.condition;

    const chartInfo = document.getElementById('chartInfo');
    chartInfo.textContent = `总条件: ${this.analysisData.totalConditions} | ${strategy.description}`;
  }

  renderChart() {
    const chartWrapper = document.getElementById('chartWrapper');
    if (!chartWrapper) return;

    // 清空容器并创建新的 canvas
    chartWrapper.innerHTML = '<canvas id="strategyChart"></canvas>';
    const canvas = document.getElementById('strategyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // 销毁旧图表
    if (this.chart) {
      this.chart.destroy();
    }
    if (this.priceChart) {
      this.priceChart.destroy();
    }

    const timePoints = this.analysisData.timePoints;
    const labels = timePoints.map(tp => {
      const date = new Date(tp.timestamp);
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    });

    // 使用新的数据结构：直接使用 satisfiedCount
    const satisfiedData = timePoints.map(tp => tp.satisfiedCount);
    const totalConditions = this.analysisData.totalConditions;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: '满足条件数',
          data: satisfiedData,
          borderColor: '#1890ff',
          backgroundColor: 'rgba(24, 144, 255, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 0
        },
        scales: {
          y: {
            beginAtZero: true,
            max: totalConditions,
            ticks: {
              stepSize: 1,
              maxTicksLimit: 10
            },
            title: {
              display: true,
              text: '满足条件数'
            }
          },
          x: {
            ticks: {
              maxTicksLimit: 20
            },
            title: {
              display: true,
              text: '时间'
            }
          }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top'
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                return `满足: ${context.parsed.y}/${totalConditions}`;
              }
            }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            this.renderDetails(index);
          }
        }
      }
    });

    // 渲染价格图表
    this.renderPriceChart();
  }

  renderPriceChart() {
    const priceChartWrapper = document.getElementById('priceChartWrapper');
    if (!priceChartWrapper) return;

    const timePoints = this.analysisData.timePoints;

    // 提取价格数据
    const labels = timePoints.map(tp => {
      const date = new Date(tp.timestamp);
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    });
    const prices = timePoints.map(tp => tp.data.price_usd ? parseFloat(tp.data.price_usd) : null);

    // 清空容器并创建新的 canvas
    priceChartWrapper.innerHTML = '<canvas id="priceChart"></canvas>';
    const canvas = document.getElementById('priceChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // 创建价格图表
    this.priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: '价格 (USDT)',
          data: prices,
          borderColor: '#52c41a',
          backgroundColor: 'rgba(82, 196, 26, 0.1)',
          tension: 0.1,
          pointRadius: 0,
          pointHoverRadius: 5,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 0
        },
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
                  return `价格: $${value.toFixed(6)}`;
                }
                return '价格: N/A';
              }
            }
          },
          legend: {
            display: true,
            position: 'top'
          }
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 20
            },
            title: {
              display: true,
              text: '时间'
            }
          },
          y: {
            title: {
              display: true,
              text: '价格 (USDT)'
            }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            this.renderDetails(index);
          }
        }
      }
    });
  }

  renderDetails(index) {
    if (!this.analysisData || !this.analysisData.timePoints[index]) {
      return;
    }

    this.currentTimeIndex = index;
    const timePoint = this.analysisData.timePoints[index];

    // 获取因子值（factor_values 是一个 JSON 对象）
    const factorValues = timePoint.data.factor_values || {};

    // 获取因子序号和Loop数
    const factorIndex = timePoint.data.factorIndex || index + 1;
    const loopCount = timePoint.data.loop_count || 0;

    // 更新时间显示
    const date = new Date(timePoint.timestamp);
    document.getElementById('currentTime').textContent =
      `时间: ${date.toLocaleString('zh-CN')} | 满足: ${timePoint.satisfiedCount}/${timePoint.totalCount} | ${timePoint.satisfied ? '✅ 触发' : '❌ 未触发'}`;

    // 渲染条件列表
    const conditionList = document.getElementById('conditionList');
    conditionList.innerHTML = '';

    // 使用 subConditions 定义来计算每个条件的满足情况
    const subConditions = this.analysisData.subConditions || [];
    const strategyVariables = new Set(subConditions.map(sc => sc.variable));

    // 1. 先展示策略相关的因子
    if (subConditions.length > 0) {
      const strategySection = document.createElement('div');
      strategySection.innerHTML = `<div class="section-title" style="font-weight:600; color:#1a1a1a; margin: 15px 0 10px 0; padding-bottom:8px; border-bottom:1px solid #ddd;">📋 策略条件 (因子序号: ${factorIndex}, Loop: ${loopCount})</div>`;
      conditionList.appendChild(strategySection);

      subConditions.forEach(sc => {
        // 从 factor_values 中获取实际值
        const actualValue = factorValues[sc.variable];
        const satisfied = this._compareValues(actualValue, sc.operator, sc.value);

        const item = document.createElement('div');
        item.className = `condition-item ${satisfied ? 'satisfied' : 'not-satisfied'}`;

        item.innerHTML = `
          <div class="condition-header">
            <span class="condition-icon">${satisfied ? '✅' : '❌'}</span>
            <span class="condition-text">${sc.raw}</span>
          </div>
          <div class="condition-values">
            实际值: ${actualValue !== null && actualValue !== undefined ? actualValue : 'N/A'} |
            期望: ${sc.operator} ${sc.value}
          </div>
        `;

        conditionList.appendChild(item);
      });
    }

    // 2. 再展示其它因子
    const otherFactors = Object.keys(factorValues).filter(key => !strategyVariables.has(key));
    if (otherFactors.length > 0) {
      const otherSection = document.createElement('div');
      otherSection.innerHTML = '<div class="section-title" style="font-weight:600; color:#1a1a1a; margin: 20px 0 10px 0; padding-bottom:8px; border-bottom:1px solid #ddd;">📊 其它因子</div>';
      conditionList.appendChild(otherSection);

      otherFactors.forEach(key => {
        const value = factorValues[key];
        const item = document.createElement('div');
        item.className = 'condition-item';
        item.style.background = '#fafafa';
        item.style.borderColor = '#eee';

        item.innerHTML = `
          <div class="condition-header">
            <span class="condition-text">${key}</span>
          </div>
          <div class="condition-values">
            值: ${value !== null && value !== undefined ? value : 'N/A'}
          </div>
        `;

        conditionList.appendChild(item);
      });
    }

    // 更新导航按钮
    document.getElementById('prevBtn').disabled = index === 0;
    document.getElementById('nextBtn').disabled = index >= this.analysisData.timePoints.length - 1;
  }

  /**
   * 比较值
   * @private
   */
  _compareValues(actual, operator, expected) {
    const actualNum = parseFloat(actual);
    const expectedNum = parseFloat(expected);

    if (isNaN(actualNum) || isNaN(expectedNum)) {
      return false;
    }

    switch (operator) {
      case '>': return actualNum > expectedNum;
      case '<': return actualNum < expectedNum;
      case '>=': return actualNum >= expectedNum;
      case '<=': return actualNum <= expectedNum;
      case '==': return actualNum === expectedNum;
      case '!=': return actualNum !== expectedNum;
      default: return false;
    }
  }

  prevTimePoint() {
    if (this.currentTimeIndex > 0) {
      this.renderDetails(this.currentTimeIndex - 1);
    }
  }

  nextTimePoint() {
    if (this.analysisData && this.currentTimeIndex < this.analysisData.timePoints.length - 1) {
      this.renderDetails(this.currentTimeIndex + 1);
    }
  }

  checkURLParams() {
    // 从路径中提取实验ID: /experiment/:id/strategy-analysis
    const pathParts = window.location.pathname.split('/');
    const experimentIdIndex = pathParts.indexOf('experiment');
    let experimentId = null;

    if (experimentIdIndex !== -1 && experimentIdIndex + 1 < pathParts.length) {
      experimentId = pathParts[experimentIdIndex + 1];
    }

    // 也支持 query 参数方式
    const params = new URLSearchParams(window.location.search);
    if (!experimentId) {
      experimentId = params.get('experimentId');
    }

    const tokenAddress = params.get('tokenAddress');

    console.log('checkURLParams - experimentId:', experimentId, 'tokenAddress:', tokenAddress);

    if (experimentId) {
      // 设置实验ID并加载数据
      this.experimentSelect.value = experimentId;

      // 等待实验数据加载完成后再继续
      this.onExperimentChange().then(() => {
        console.log('实验数据加载完成');

        if (tokenAddress) {
          // 检查代币是否在列表中
          setTimeout(() => {
            console.log('尝试设置代币:', tokenAddress);
            console.log('当前代币选项:', Array.from(this.tokenSelect.options).map(o => o.value));

            // 尝试设置代币
            this.tokenSelect.value = tokenAddress;

            // 如果设置成功，触发分析
            if (this.tokenSelect.value === tokenAddress) {
              console.log('代币设置成功，准备分析');
              this.onTokenChange();

              // 等待策略加载完成后自动分析
              setTimeout(() => {
                console.log('策略值:', this.strategySelect.value);
                if (this.strategySelect.value) {
                  console.log('触发自动分析');
                  this.analyze();
                } else {
                  console.log('策略未选择，无法自动分析');
                }
              }, 300);
            } else {
              console.error('代币设置失败，代币地址不在列表中');
            }
          }, 200);
        }
      });
    }
  }

  showLoading(show) {
    if (show) {
      this.analyzeBtn.textContent = '分析中...';
      this.analyzeBtn.disabled = true;
    } else {
      this.analyzeBtn.textContent = '分析';
      this.updateAnalyzeButton();
    }
  }

  showError(message) {
    const container = document.getElementById('errorContainer');
    container.innerHTML = `<div class="error">${message}</div>`;
    setTimeout(() => container.innerHTML = '', 5000);
  }

  hideError() {
    document.getElementById('errorContainer').innerHTML = '';
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new StrategyAnalysisPage();
});
