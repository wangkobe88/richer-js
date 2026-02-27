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
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new WalletAnalysisApp();
});
