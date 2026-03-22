/**
 * 实验叙事分析页面
 */

// 叙事评级映射
const NARRATIVE_RATING_MAP = {
  1: { label: '低质量', emoji: '📉', class: 'rating-low' },
  2: { label: '中质量', emoji: '📊', class: 'rating-mid' },
  3: { label: '高质量', emoji: '🚀', class: 'rating-high' },
  9: { label: '未评级', emoji: '❓', class: 'rating-unrated' }
};

// 人工评级映射
const HUMAN_JUDGE_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭', bgClass: 'bg-red-900', borderClass: 'border-red-700', textClass: 'text-red-400' },
  no_user: { label: '无人玩', emoji: '👻', bgClass: 'bg-gray-700', borderClass: 'border-gray-600', textClass: 'text-gray-400' },
  low_quality: { label: '低质量', emoji: '📉', bgClass: 'bg-orange-900', borderClass: 'border-orange-700', textClass: 'text-orange-400' },
  mid_quality: { label: '中质量', emoji: '📊', bgClass: 'bg-blue-900', borderClass: 'border-blue-700', textClass: 'text-blue-400' },
  high_quality: { label: '高质量', emoji: '🚀', bgClass: 'bg-green-900', borderClass: 'border-green-700', textClass: 'text-green-400' }
};

class ExperimentNarrative {
  constructor() {
    this.experimentId = null;
    this.experimentData = null;
    this.narrativeData = [];
    this.filteredData = [];
    this.sortField = 'analyzed_at';
    this.sortOrder = 'desc';

    this.init();
  }

  async init() {
    // 从 URL 获取实验 ID
    const pathParts = window.location.pathname.split('/');
    this.experimentId = pathParts[pathParts.length - 2]; // /experiment/:id/narrative

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

    // 叙事评级筛选
    document.getElementById('rating-filter')?.addEventListener('change', () => {
      this.applyFilterAndSort();
    });

    // 人工评级筛选
    document.getElementById('judge-filter')?.addEventListener('change', () => {
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
  }

  async loadData() {
    this.showLoading(true);

    try {
      // 并行加载实验数据和叙事数据
      const [experimentRes, narrativeRes] = await Promise.all([
        fetch(`/api/experiment/${this.experimentId}`),
        fetch(`/api/experiment/${this.experimentId}/narrative`)
      ]);

      if (!experimentRes.ok) {
        throw new Error('加载实验数据失败');
      }

      const experimentData = await experimentRes.json();
      if (!experimentData.success) {
        throw new Error('实验数据格式错误');
      }

      this.experimentData = experimentData.data;

      // 加载叙事数据
      if (narrativeRes.ok) {
        const narrativeResult = await narrativeRes.json();
        if (narrativeResult.success) {
          this.narrativeData = narrativeResult.data || [];
          this.stats = narrativeResult.stats || {};
        } else {
          this.narrativeData = [];
          this.stats = {};
        }
      } else {
        this.narrativeData = [];
        this.stats = {};
      }

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

  updateHeader() {
    // 更新实验名称和ID
    const nameEl = document.getElementById('experiment-name');
    const idEl = document.getElementById('experiment-id');
    const detailLink = document.getElementById('link-detail');
    const backLink = document.getElementById('link-back');

    if (nameEl) {
      nameEl.textContent = this.experimentData.experimentName || '未命名实验';
    }
    if (idEl) {
      idEl.textContent = `ID: ${this.experimentId.slice(0, 8)}...`;
    }
    if (detailLink) {
      detailLink.href = `/experiment/${this.experimentId}`;
    }
    if (backLink) {
      backLink.href = `/experiment/${this.experimentId}`;
    }
  }

  updateStats() {
    // 更新汇总统计
    document.getElementById('stat-total-tokens').textContent = this.stats.total_tokens || 0;
    document.getElementById('stat-narrative-tokens').textContent = this.stats.narrative_tokens || 0;

    // 计算覆盖率
    const coverage = this.stats.total_tokens > 0
      ? ((this.stats.narrative_tokens / this.stats.total_tokens) * 100).toFixed(1)
      : 0;
    document.getElementById('stat-coverage').textContent = `${coverage}%`;

    // 平均最大涨幅
    const avgMaxChange = this.stats.avg_max_change || 0;
    document.getElementById('stat-avg-max-change').textContent = `${avgMaxChange}%`;

    // 叙事评级分布
    document.getElementById('stat-high-count').textContent = this.stats.high_quality_count || 0;
    document.getElementById('stat-mid-count').textContent = this.stats.mid_quality_count || 0;
    document.getElementById('stat-low-count').textContent = this.stats.low_quality_count || 0;
    document.getElementById('stat-unrated-count').textContent = this.stats.unrated_count || 0;
  }

  applyFilterAndSort() {
    const ratingFilter = document.getElementById('rating-filter')?.value || 'all';
    const judgeFilter = document.getElementById('judge-filter')?.value || 'all';

    // 筛选
    this.filteredData = this.narrativeData.filter(item => {
      // 叙事评级筛选
      if (ratingFilter !== 'all') {
        if (ratingFilter === 'high' && item.narrative.rating !== 3) return false;
        if (ratingFilter === 'mid' && item.narrative.rating !== 2) return false;
        if (ratingFilter === 'low' && item.narrative.rating !== 1) return false;
        if (ratingFilter === 'unrated' && item.narrative.rating !== 9) return false;
      }

      // 人工评级筛选
      if (judgeFilter !== 'all') {
        if (judgeFilter === 'none') {
          if (item.human_judge) return false;
        } else {
          if (!item.human_judge || item.human_judge.category !== judgeFilter) return false;
        }
      }

      return true;
    });

    // 排序
    this.filteredData.sort((a, b) => {
      let aVal, bVal;

      switch (this.sortField) {
        case 'max_change':
          aVal = a.max_change_percent || 0;
          bVal = b.max_change_percent || 0;
          break;
        case 'analyzed_at':
          aVal = new Date(a.narrative.analyzed_at || 0).getTime();
          bVal = new Date(b.narrative.analyzed_at || 0).getTime();
          break;
        default:
          return 0;
      }

      if (this.sortOrder === 'asc') {
        return aVal - bVal;
      } else {
        return bVal - aVal;
      }
    });

    this.renderTable();
  }

  renderTable() {
    const tbody = document.getElementById('narrative-table-body');
    const emptyState = document.getElementById('empty-state');

    if (!tbody) return;

    if (this.filteredData.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = this.filteredData.map(item => this.renderRow(item)).join('');
  }

  renderRow(item) {
    // 叙事评级（作为链接）
    const ratingInfo = NARRATIVE_RATING_MAP[item.narrative.rating] || NARRATIVE_RATING_MAP[9];
    const ratingBadge = `<a href="/narrative-analyzer?address=${item.token_address}" target="_blank" class="rating-badge ${ratingInfo.class} hover:opacity-80 transition-opacity">${ratingInfo.emoji} ${ratingInfo.label}</a>`;

    // 人工评级
    let judgeBadge = '<span class="text-gray-500 text-xs">-</span>';
    if (item.human_judge && item.human_judge.category) {
      const judgeInfo = HUMAN_JUDGE_MAP[item.human_judge.category];
      if (judgeInfo) {
        judgeBadge = `<span class="judge-badge ${judgeInfo.bgClass} ${judgeInfo.borderClass} ${judgeInfo.textClass}">${judgeInfo.emoji} ${judgeInfo.label}</span>`;
      }
    }

    // 最大涨幅
    const maxChange = item.max_change_percent !== null
      ? `${item.max_change_percent.toFixed(2)}%`
      : '-';

    // 叙事摘要（截断）
    const summary = item.narrative.llm_summary
      ? (item.narrative.llm_summary.length > 80
          ? item.narrative.llm_summary.substring(0, 80) + '...'
          : item.narrative.llm_summary)
      : '-';

    // 来源实验ID
    const sourceExpId = item.narrative.experiment_id
      ? item.narrative.experiment_id.slice(0, 8)
      : '-';

    // 分析时间
    const analyzedAt = item.narrative.analyzed_at
      ? new Date(item.narrative.analyzed_at).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '-';

    // 平台标签
    const platformLabel = item.platform === 'fourmeme' ? '4meme' : item.platform;

    return `
      <tr class="table-row">
        <td class="px-4 py-3">
          <div class="flex items-center">
            <span class="font-medium text-white">${item.token_symbol}</span>
            <a href="https://gmgn.ai/bsc/token/${item.token_address}" target="_blank" rel="noopener noreferrer"
               class="ml-2 text-gray-400 hover:text-purple-400 transition-colors"
               title="在 GMGN 查看">
              <img src="/static/gmgn.png" alt="GMGN" class="w-3 h-3">
            </a>
            <span class="ml-2 text-xs text-gray-500 font-mono">${item.token_address.slice(0, 8)}...</span>
          </div>
        </td>
        <td class="px-4 py-3 text-center text-gray-400 text-xs">${platformLabel}</td>
        <td class="px-4 py-3 text-center">${ratingBadge}</td>
        <td class="px-4 py-3 text-center">${judgeBadge}</td>
        <td class="px-4 py-3 text-right font-medium ${item.max_change_percent > 0 ? 'text-green-400' : 'text-gray-400'}">${maxChange}</td>
        <td class="px-4 py-3 text-left text-gray-400 text-xs">${summary}</td>
        <td class="px-4 py-3 text-center text-gray-500 text-xs">${sourceExpId}</td>
        <td class="px-4 py-3 text-center text-gray-400 text-xs">${analyzedAt}</td>
        <td class="px-4 py-3 text-center">
          <a href="/narrative-analyzer?address=${item.token_address}" target="_blank"
             class="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs text-white transition-colors">
            查看
          </a>
        </td>
      </tr>
    `;
  }

  updateSortButtons() {
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.sort === this.sortField) {
        btn.classList.add('active');
      }
    });
  }

  showLoading(show) {
    const loading = document.getElementById('loading');
    const content = document.getElementById('narrative-content');
    const error = document.getElementById('error-message');

    if (loading) loading.classList.toggle('hidden', !show);
    if (content) content.classList.toggle('hidden', show);
    if (error) error.classList.add('hidden');
  }

  showContent(show) {
    const loading = document.getElementById('loading');
    const content = document.getElementById('narrative-content');
    const error = document.getElementById('error-message');

    if (loading) loading.classList.add('hidden');
    if (content) content.classList.toggle('hidden', !show);
    if (error) error.classList.add('hidden');
  }

  showError(message) {
    const loading = document.getElementById('loading');
    const content = document.getElementById('narrative-content');
    const error = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');

    if (loading) loading.classList.add('hidden');
    if (content) content.classList.add('hidden');
    if (error) error.classList.remove('hidden');
    if (errorText) errorText.textContent = message;
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new ExperimentNarrative();
});
