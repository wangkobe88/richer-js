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
    this.judgeExperimentId = null;
    this.experimentData = null;
    this.narrativeData = [];
    this.filteredData = [];
    this.sortField = 'analyzed_at';
    this.sortOrder = 'desc';
    this.currentEditingToken = null;

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
      // 获取实验数据（用于判断是否回测实验）
      const experimentRes = await fetch(`/api/experiment/${this.experimentId}`);

      if (!experimentRes.ok) {
        throw new Error('加载实验数据失败');
      }

      const experimentData = await experimentRes.json();
      if (!experimentData.success) {
        throw new Error('实验数据格式错误');
      }

      this.experimentData = experimentData.data;

      // 判断是否是回测实验，获取标注数据时使用源实验ID
      this.judgeExperimentId = this.experimentId;
      if (this.experimentData.config?.backtest?.sourceExperimentId) {
        this.judgeExperimentId = this.experimentData.config.backtest.sourceExperimentId;
      }

      // 加载叙事数据和人工标注数据
      const narrativeRes = await fetch(`/api/experiment/${this.experimentId}/narrative`);

      if (!narrativeRes.ok) {
        throw new Error('加载叙事数据失败');
      }

      const narrativeResult = await narrativeRes.json();

      if (narrativeResult.success) {
        this.narrativeData = narrativeResult.data || [];
        this.stats = narrativeResult.stats || {};
      } else {
        this.narrativeData = [];
        this.stats = {};
      }

      // 如果是回测实验且当前实验没有人工标注数据，尝试从源实验加载
      if (this.judgeExperimentId !== this.experimentId) {
        await this.loadJudgeDataFromSource();
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

  /**
   * 从源实验加载人工标注数据
   */
  async loadJudgeDataFromSource() {
    try {
      const sourceTokensRes = await fetch(`/api/experiment/${this.judgeExperimentId}/tokens?limit=10000`);
      if (sourceTokensRes.ok) {
        const sourceTokensData = await sourceTokensRes.json();
        if (sourceTokensData.success && sourceTokensData.tokens) {
          sourceTokensData.tokens.forEach(token => {
            const existingItem = this.narrativeData.find(item => item.token_address === token.token_address);
            if (existingItem && token.human_judges) {
              existingItem.human_judge = token.human_judges;
            }
          });
        }
      }
    } catch (error) {
      console.warn('从源实验加载人工标注数据失败:', error);
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
      backLink.href = '/experiments';
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

    // 绑定人工评级按钮事件
    this.bindJudgeButtons();
  }

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

  renderRow(item) {
    // 叙事评级（作为链接）
    const ratingInfo = NARRATIVE_RATING_MAP[item.narrative.rating] || NARRATIVE_RATING_MAP[9];
    const ratingBadge = `<a href="/narrative-analyzer?address=${item.token_address}" target="_blank" class="rating-badge ${ratingInfo.class} hover:opacity-80 transition-opacity">${ratingInfo.emoji} ${ratingInfo.label}</a>`;

    // 人工评级
    let judgeBadge = '';
    if (item.human_judge && item.human_judge.category) {
      const judgeInfo = HUMAN_JUDGE_MAP[item.human_judge.category];
      if (judgeInfo) {
        judgeBadge = `
          <span class="judge-badge ${judgeInfo.bgClass} ${judgeInfo.borderClass} ${judgeInfo.textClass}">${judgeInfo.emoji} ${judgeInfo.label}</span>
          <button class="judge-delete-btn ml-1 text-gray-400 hover:text-red-400 transition-colors" data-address="${item.token_address}" title="删除标注">✕</button>
        `;
      }
    }

    // 如果没有人工评级，显示添加按钮
    if (!judgeBadge) {
      judgeBadge = `
        <button class="judge-btn px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs text-white transition-colors"
                data-address="${item.token_address}" data-symbol="${item.token_symbol}" title="添加标注">
          +
        </button>
      `;
    }

    // 最大涨幅
    const maxChange = item.max_change_percent !== null
      ? `${item.max_change_percent.toFixed(2)}%`
      : '-';

    // 叙事摘要（截断）
    const summaryObj = item.narrative.llm_summary;
    const reasoning = summaryObj?.reasoning || '';
    const summary = reasoning
      ? (reasoning.length > 80
          ? reasoning.substring(0, 80) + '...'
          : reasoning)
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

    // 使用 judgeExperimentId（回测时为源实验ID，否则为当前实验ID）
    const targetExperimentId = this.judgeExperimentId || this.experimentId;
    const blockchain = this.experimentData?.blockchain || 'bsc';

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
          <div class="action-links">
            <a href="/experiment/${this.experimentId}/strategy-analysis?tokenAddress=${item.token_address}" target="_blank" class="action-link text-pink-400 hover:text-pink-300">
              策略分析
            </a>
            <a href="/experiment/${targetExperimentId}/observer#token=${item.token_address}" target="_blank" class="action-link text-emerald-400 hover:text-emerald-300">
              时序数据
            </a>
            <a href="/token-holders?experiment=${this.experimentId}&token=${item.token_address}" target="_blank" class="action-link text-cyan-400 hover:text-cyan-300">
              持有者
            </a>
            <a href="/token-early-trades?token=${item.token_address}&chain=${blockchain}" target="_blank" class="action-link text-amber-400 hover:text-amber-300">
              早期交易
            </a>
            <a href="/token-detail?experiment=${this.experimentId}&address=${item.token_address}" target="_blank" class="action-link text-indigo-400 hover:text-indigo-300">
              代币详情
            </a>
          </div>
        </td>
      </tr>
    `;
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

    const judgeData = this.narrativeData.find(item => item.token_address === tokenAddress)?.human_judge;
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

      // 更新本地数据
      const item = this.narrativeData.find(i => i.token_address === this.currentEditingToken);
      if (item) {
        item.human_judge = result.data.human_judges;
      }

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

      // 更新本地数据
      const item = this.narrativeData.find(i => i.token_address === tokenAddress);
      if (item) {
        delete item.human_judge;
      }

      this.renderTable();
    } catch (error) {
      console.error('删除标注失败:', error);
      alert('删除失败: ' + error.message);
    }
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
