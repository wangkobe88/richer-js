/**
 * 钱包分析页面
 */

class WalletAnalysisApp {
  constructor() {
    this.currentTab = 'generate';
    this.currentPage = 1;
    this.pageSize = 50;
    this.totalProfiles = 0;
    this.currentFilters = {};
    this.pollInterval = null;

    this.init();
  }

  init() {
    this.bindEvents();
    this.loadStats();
    this.loadTokenCount();
    this.loadBayesModelInfo();
  }

  bindEvents() {
    // Tab 切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // 刷新统计
    document.getElementById('refresh-stats-btn')?.addEventListener('click', () => {
      this.loadStats();
    });

    // 生成画像 Tab
    document.getElementById('generate-btn')?.addEventListener('click', () => {
      this.generateProfiles();
    });

    // 生成标签 Tab
    document.getElementById('label-btn')?.addEventListener('click', () => {
      this.generateLabels();
    });

    // 查看画像 Tab
    document.getElementById('profile-search')?.addEventListener('input', (e) => {
      this.debounceSearch();
    });

    document.getElementById('label-filter')?.addEventListener('change', () => {
      this.loadProfiles();
    });

    document.getElementById('category-filter')?.addEventListener('change', () => {
      this.loadProfiles();
    });

    document.getElementById('prev-page')?.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.loadProfiles();
      }
    });

    document.getElementById('next-page')?.addEventListener('click', () => {
      if (this.currentPage * this.pageSize < this.totalProfiles) {
        this.currentPage++;
        this.loadProfiles();
      }
    });

    // 同步 Tab
    document.getElementById('sync-btn')?.addEventListener('click', () => {
      this.syncToWallets();
    });

    // 贝叶斯模型 Tab
    document.getElementById('train-bayes-btn')?.addEventListener('click', () => {
      this.trainBayesModel();
    });

    document.getElementById('predict-btn')?.addEventListener('click', () => {
      this.predictToken();
    });

    document.getElementById('refresh-bayes-btn')?.addEventListener('click', () => {
      this.loadBayesModelInfo();
    });
  }

  switchTab(tabName) {
    this.currentTab = tabName;

    // 更新 Tab 按钮
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // 更新内容
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tabName}`);
    });

    // 如果切换到查看画像 Tab，加载数据
    if (tabName === 'view') {
      this.loadProfiles();
    }

    // 如果切换到贝叶斯模型 Tab，加载模型信息
    if (tabName === 'bayes') {
      this.loadBayesModelInfo();
    }

    // 停止轮询
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async loadStats() {
    try {
      const response = await fetch('/api/wallet-analysis/stats');
      const result = await response.json();

      if (result.success) {
        const stats = result.data;
        document.getElementById('stat-total').textContent = stats.totalProfiles.toLocaleString();
        document.getElementById('stat-pump').textContent = (stats.labelStats?.pump_group || 0).toLocaleString();
        document.getElementById('stat-good').textContent = (stats.labelStats?.good_holder || 0).toLocaleString();

        if (stats.lastUpdated) {
          const updated = new Date(stats.lastUpdated);
          document.getElementById('stat-updated').textContent = this.formatDateTime(updated);
        } else {
          document.getElementById('stat-updated').textContent = '从未更新';
        }
      }
    } catch (error) {
      console.error('加载统计失败:', error);
    }
  }

  async loadTokenCount() {
    try {
      const response = await fetch('/api/wallet-analysis/token-count');
      const result = await response.json();

      if (result.success) {
        document.getElementById('info-token-count').textContent = result.data.count;
      }
    } catch (error) {
      console.error('加载标注代币数量失败:', error);
      document.getElementById('info-token-count').textContent = '?';
    }
  }

  async generateProfiles() {
    const btn = document.getElementById('generate-btn');
    const progress = document.getElementById('generate-progress');
    const result = document.getElementById('generate-result');

    btn.disabled = true;
    progress.classList.remove('hidden');
    result.classList.add('hidden');

    try {
      // 启动生成任务
      const response = await fetch('/api/wallet-analysis/generate-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const startResult = await response.json();

      if (!startResult.success) {
        throw new Error(startResult.error || '启动任务失败');
      }

      const taskId = startResult.taskId;

      // 轮询任务状态
      this.pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/wallet-analysis/generate-profiles/${taskId}/status`);
          const statusData = await statusRes.json();

          if (statusData.success) {
            const { status, progress, message, stats } = statusData.data;

            document.getElementById('progress-message').textContent = message || '处理中...';
            document.getElementById('progress-percent').textContent = `${progress}%`;
            document.getElementById('progress-bar').style.width = `${progress}%`;

            if (status === 'completed') {
              clearInterval(this.pollInterval);
              this.pollInterval = null;

              btn.disabled = false;
              result.classList.remove('hidden');

              document.getElementById('result-stats').innerHTML = `
                <p>分析完成，共处理 <strong>${stats?.totalWallets || 0}</strong> 个钱包</p>
              `;

              // 刷新统计
              this.loadStats();
            } else if (status === 'failed') {
              clearInterval(this.pollInterval);
              this.pollInterval = null;

              btn.disabled = false;
              progress.classList.add('hidden');
              alert('生成失败: ' + (statusData.error || '未知错误'));
            }
          }
        } catch (err) {
          console.error('获取任务状态失败:', err);
        }
      }, 1000);

    } catch (error) {
      console.error('生成画像失败:', error);
      alert('生成失败: ' + error.message);
      btn.disabled = false;
      progress.classList.add('hidden');
    }
  }

  async generateLabels() {
    const btn = document.getElementById('label-btn');
    const result = document.getElementById('label-result');

    const config = {
      pureFakePumpThreshold: parseFloat(document.getElementById('param-pure-threshold').value) || 0.8,
      minFakePumpCount: parseInt(document.getElementById('param-min-count').value) || 3,
      mixedFakePumpThreshold: parseFloat(document.getElementById('param-mixed-threshold').value) || 0.4
    };

    btn.disabled = true;
    result.classList.add('hidden');

    try {
      const response = await fetch('/api/wallet-analysis/generate-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ algorithmConfig: config })
      });

      const data = await response.json();

      if (data.success) {
        result.classList.remove('hidden');
        const stats = data.data.stats;

        document.getElementById('label-stats').innerHTML = `
          <p>流水盘钱包: <strong>${stats.pump_group}</strong></p>
          <p>正常钱包: <strong>${stats.good_holder}</strong></p>
          <p>总计: <strong>${stats.total}</strong></p>
        `;

        this.loadStats();
      } else {
        throw new Error(data.error || '生成标签失败');
      }
    } catch (error) {
      console.error('生成标签失败:', error);
      alert('生成失败: ' + error.message);
    } finally {
      btn.disabled = false;
    }
  }

  async loadProfiles() {
    const tbody = document.getElementById('profiles-table');
    const empty = document.getElementById('view-empty');
    const pagination = document.getElementById('pagination');
    const stats = document.getElementById('view-stats');

    const filters = {
      label: document.getElementById('label-filter')?.value || '',
      dominant_category: document.getElementById('category-filter')?.value || '',
      search: document.getElementById('profile-search')?.value?.trim() || '',
      page: this.currentPage,
      limit: this.pageSize
    };

    try {
      const params = new URLSearchParams();
      if (filters.label) params.append('label', filters.label);
      if (filters.dominant_category) params.append('dominant_category', filters.dominant_category);
      if (filters.search) params.append('search', filters.search);
      params.append('page', filters.page);
      params.append('limit', filters.limit);

      const response = await fetch(`/api/wallet-analysis/profiles?${params}`);
      const data = await response.json();

      if (data.success) {
        const { profiles, total, page, limit } = data.data;
        this.totalProfiles = total;

        if (profiles.length === 0) {
          tbody.innerHTML = '';
          empty.classList.remove('hidden');
          pagination.classList.add('hidden');
          stats.textContent = '';
          return;
        }

        empty.classList.add('hidden');
        pagination.classList.remove('hidden');

        // 更新分页信息
        const start = (page - 1) * limit + 1;
        const end = Math.min(page * limit, total);
        stats.textContent = `显示 ${start}-${end} / 共 ${total} 个钱包`;
        document.getElementById('pagination-info').textContent = `第 ${page} 页，共 ${Math.ceil(total / limit)} 页`;

        document.getElementById('prev-page').disabled = page <= 1;
        document.getElementById('next-page').disabled = page * limit >= total;

        // 渲染表格
        tbody.innerHTML = profiles.map(p => this.renderProfileRow(p)).join('');
      }
    } catch (error) {
      console.error('加载钱包画像失败:', error);
    }
  }

  renderProfileRow(profile) {
    const categories = profile.categories || {};
    const categoryBadges = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => {
        const catNames = {
          fake_pump: '流水盘',
          no_user: '无人玩',
          low_quality: '低质量',
          mid_quality: '中质量',
          high_quality: '高质量'
        };
        return `<span class="category-badge category-${cat}">${catNames[cat] || cat}: ${count}</span>`;
      })
      .join(' ');

    const labelBadge = profile.label
      ? `<span class="category-badge label-${profile.label}">${profile.label === 'pump_group' ? '流水盘钱包' : '正常钱包'}</span>`
      : '<span class="text-gray-400">未打标签</span>';

    const dominantNames = {
      fake_pump: '流水盘',
      no_user: '无人玩',
      low_quality: '低质量',
      mid_quality: '中质量',
      high_quality: '高质量'
    };
    const dominant = profile.dominant_category
      ? `<span class="category-badge category-${profile.dominant_category}">${dominantNames[profile.dominant_category]}</span>`
      : '-';

    return `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 font-mono text-sm text-blue-600">${this.shortenAddress(profile.wallet_address)}</td>
        <td class="px-4 py-3 text-sm">${profile.total_participations || 0}</td>
        <td class="px-4 py-3 text-sm">${labelBadge}</td>
        <td class="px-4 py-3 text-sm">${dominant}</td>
        <td class="px-4 py-3 text-sm">${categoryBadges}</td>
      </tr>
    `;
  }

  async syncToWallets() {
    const btn = document.getElementById('sync-btn');
    const result = document.getElementById('sync-result');
    const progress = document.getElementById('sync-progress');

    const mode = document.querySelector('input[name="sync-mode"]:checked')?.value || 'upsert';

    btn.disabled = true;
    result.classList.add('hidden');
    progress.classList.remove('hidden');

    try {
      const response = await fetch('/api/wallet-analysis/sync-to-wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });

      const data = await response.json();

      if (data.success) {
        const stats = data.data;

        result.classList.remove('hidden');
        document.getElementById('sync-stats').innerHTML = `
          <p>更新: <strong>${stats.updated}</strong> 个钱包</p>
          <p>插入: <strong>${stats.inserted}</strong> 个钱包</p>
          ${stats.skipped > 0 ? `<p>跳过: <strong>${stats.skipped}</strong> 个钱包</p>` : ''}
        `;

        this.loadStats();
      } else {
        throw new Error(data.error || '同步失败');
      }
    } catch (error) {
      console.error('同步失败:', error);
      alert('同步失败: ' + error.message);
    } finally {
      btn.disabled = false;
      progress.classList.add('hidden');
    }
  }

  shortenAddress(address) {
    if (!address) return '-';
    return `${address.slice(0, 10)}...${address.slice(-6)}`;
  }

  formatDateTime(date) {
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) {
      return '刚刚';
    } else if (diff < 3600000) {
      return `${Math.floor(diff / 60000)} 分钟前`;
    } else if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)} 小时前`;
    } else {
      return date.toLocaleDateString('zh-CN');
    }
  }

  debounceSearch() {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
    this.searchTimeout = setTimeout(() => {
      this.currentPage = 1;
      this.loadProfiles();
    }, 500);
  }

  // 贝叶斯模型相关方法

  async loadBayesModelInfo() {
    try {
      const response = await fetch('/api/bayes/model');
      const result = await response.json();

      const statusEl = document.getElementById('bayes-status');
      const countEl = document.getElementById('bayes-tokens');
      const updatedEl = document.getElementById('bayes-updated');
      const predictInput = document.getElementById('predict-token-address');

      if (result.success && result.data.exists) {
        const info = result.data;
        statusEl.innerHTML = '<span class="text-green-400">已训练</span>';
        countEl.textContent = (info.stats.totalTokens || 0).toLocaleString();

        if (info.updatedAt) {
          const updated = new Date(info.updatedAt);
          updatedEl.textContent = this.formatDateTime(updated);
        } else {
          updatedEl.textContent = '-';
        }

        predictInput.disabled = false;
      } else {
        statusEl.innerHTML = '<span class="text-gray-400">未训练</span>';
        countEl.textContent = '0';
        updatedEl.textContent = '-';
        predictInput.disabled = true;
      }
    } catch (error) {
      console.error('加载模型信息失败:', error);
      document.getElementById('bayes-status').innerHTML = '<span class="text-red-400">加载失败</span>';
    }
  }

  async trainBayesModel() {
    const btn = document.getElementById('train-bayes-btn');
    const progress = document.getElementById('train-bayes-progress');
    const result = document.getElementById('train-bayes-result');

    btn.disabled = true;
    progress.classList.remove('hidden');
    result.classList.add('hidden');

    try {
      // 启动训练任务
      const response = await fetch('/api/bayes/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const startResult = await response.json();

      if (!startResult.success) {
        throw new Error(startResult.error || '启动训练失败');
      }

      // 显示训练中消息
      document.getElementById('train-bayes-message').textContent = '模型训练中...（请查看服务器日志）';
      document.getElementById('train-bayes-percent').textContent = '0%';
      document.getElementById('train-bayes-bar').style.width = '0%';

      // 轮询模型状态
      this.pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch('/api/bayes/model');
          const statusData = await statusRes.json();

          if (statusData.success && statusData.data.exists) {
            // 检查模型是否更新（通过比较 updatedAt）
            const currentUpdatedAt = document.getElementById('bayes-updated').textContent;
            const newUpdatedAt = statusData.data.updatedAt ? new Date(statusData.data.updatedAt).toLocaleString('zh-CN') : '-';

            if (currentUpdatedAt !== newUpdatedAt && currentUpdatedAt !== '-') {
              // 模型已更新
              clearInterval(this.pollInterval);
              this.pollInterval = null;

              btn.disabled = false;
              result.classList.remove('hidden');

              const stats = statusData.data.stats;
              document.getElementById('train-bayes-stats').innerHTML = `
                <p>训练完成！使用 <strong>${stats.totalTokens || 0}</strong> 个标注代币</p>
                <p class="text-sm text-gray-400 mt-2">类别分布：</p>
                <ul class="text-sm text-gray-300 ml-4">
                  ${Object.entries(stats.categoryDistribution || {}).map(([cat, count]) =>
                    `<li>${cat}: ${count}</li>`
                  ).join('')}
                </ul>
              `;

              // 刷新模型信息
              this.loadBayesModelInfo();
            }
          }
        } catch (err) {
          console.error('获取模型状态失败:', err);
        }
      }, 3000);

    } catch (error) {
      console.error('训练模型失败:', error);
      alert('训练失败: ' + error.message);
      btn.disabled = false;
      progress.classList.add('hidden');
    }
  }

  async predictToken() {
    const input = document.getElementById('predict-token-address');
    const btn = document.getElementById('predict-btn');
    const result = document.getElementById('predict-result');

    const tokenAddress = input.value.trim();

    if (!tokenAddress) {
      alert('请输入代币地址');
      return;
    }

    btn.disabled = true;
    result.classList.add('hidden');

    try {
      const response = await fetch('/api/bayes/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress, chain: 'bsc' })
      });

      const data = await response.json();

      if (data.success) {
        const prediction = data.data;
        result.classList.remove('hidden');

        // 渲染预测结果
        this.renderPredictionResult(prediction);
      } else {
        throw new Error(data.error || '预测失败');
      }
    } catch (error) {
      console.error('预测失败:', error);
      alert('预测失败: ' + error.message);
    } finally {
      btn.disabled = false;
    }
  }

  renderPredictionResult(prediction) {
    // 类别名称映射
    const categoryNames = {
      fake_pump: '流水盘',
      no_user: '无人玩',
      low_quality: '低质量',
      mid_quality: '中质量',
      high_quality: '高质量'
    };

    // 类别颜色映射
    const categoryColors = {
      fake_pump: 'bg-red-600',
      no_user: 'bg-gray-500',
      low_quality: 'bg-yellow-600',
      mid_quality: 'bg-blue-600',
      high_quality: 'bg-emerald-600'
    };

    // 1. 渲染预测概率条
    const barsContainer = document.getElementById('predict-bars');
    let barsHTML = '';
    const sortedPredictions = Object.entries(prediction.prediction || {}).sort((a, b) => b[1] - a[1]);

    for (const [category, prob] of sortedPredictions) {
      const percent = (prob * 100).toFixed(1);
      const isTop = category === prediction.predictedCategory;

      barsHTML += `
        <div class="flex items-center">
          <div class="w-20 text-xs text-gray-400">${categoryNames[category] || category}</div>
          <div class="flex-1 h-5 bg-gray-700 rounded overflow-hidden">
            <div class="${categoryColors[category] || 'bg-gray-600'} h-full transition-all duration-300"
                 style="width: ${percent}%"></div>
          </div>
          <div class="w-14 text-right text-xs ${isTop ? 'text-green-400 font-bold' : 'text-gray-400'}">${percent}%</div>
        </div>
      `;
    }
    barsContainer.innerHTML = barsHTML;

    // 2. 更新详情卡片
    document.getElementById('predict-category').textContent = categoryNames[prediction.predictedCategory] || prediction.predictedCategory;

    const confidenceEl = document.getElementById('predict-confidence');
    confidenceEl.textContent = `${(prediction.confidence * 100).toFixed(1)}%`;
    confidenceEl.className = `text-lg font-bold ${prediction.confidence > 0.7 ? 'text-green-400' : prediction.confidence > 0.5 ? 'text-yellow-400' : 'text-red-400'}`;

    document.getElementById('predict-method').textContent = prediction.method === 'bayesian' ? '贝叶斯推断' : '先验概率';

    // 3. 渲染关键钱包
    const walletsContainer = document.getElementById('predict-wallets');

    if (prediction.keyWallets && prediction.keyWallets.length > 0) {
      let walletsHTML = '';
      for (const wallet of prediction.keyWallets) {
        walletsHTML += `
          <div class="flex items-center justify-between text-xs p-2 bg-gray-800 rounded border border-gray-700">
            <div class="flex items-center space-x-2">
              <span class="font-mono text-blue-400">${this.shortenAddress(wallet.address)}</span>
              <span class="text-gray-500">|</span>
              <span class="text-gray-400">${categoryNames[wallet.dominantCategory] || wallet.dominantCategory}</span>
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-gray-400">信任度: ${(wallet.trustScore * 100).toFixed(0)}%</span>
              <span class="text-yellow-400">影响: ${wallet.influence}</span>
            </div>
          </div>
        `;
      }
      walletsContainer.innerHTML = walletsHTML;
    } else if (prediction.message) {
      walletsContainer.innerHTML = `<p class="text-xs text-gray-400">${prediction.message}</p>`;
    } else {
      walletsContainer.innerHTML = `<p class="text-xs text-gray-400">无关键钱包数据</p>`;
    }

    // 更新标题
    document.getElementById('predict-token-title').textContent = `预测结果: ${this.shortenAddress(prediction.tokenAddress)}`;
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new WalletAnalysisApp();
});
