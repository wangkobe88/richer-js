/**
 * 实验统计监控页（/experiment/:id/hourly-stats）
 *
 * 数据：GET /api/experiment/:id/hourly-stats（per-experiment 60s 缓存，?refresh=1 强刷）
 * API 固定 1h UTC 桶；本页 mergeHours() 镜像服务端 mergeHourBuckets 算法（阈值随
 * 响应下发保证热度判定两侧一致）在本地合并 1h/4h/1d。
 *
 * 图表：Chart.js bar（各平台新票 stacked）+ 右轴 line（毕业大盘/毕业交集）。
 */

'use strict';

const HOUR_MS = 3600000;
const PLATFORM_COLORS = { fourmeme: '#3b82f6', flap: '#f59e0b', gang: '#34d399' };
const PLATFORM_LABELS = { fourmeme: 'four.meme', flap: 'flap', gang: 'gang' };
const HEAT_META = {
  hot: { text: '🔥 火爆', cls: 'heat-hot' },
  active: { text: '📈 活跃', cls: 'heat-active' },
  calm: { text: '➖ 平稳', cls: 'heat-calm' },
  cold: { text: '🧊 冷清', cls: 'heat-cold' },
};
const HEAT_ORDER = ['hot', 'active', 'calm', 'cold'];

class ExperimentHourlyStatsPage {
  constructor() {
    this.experimentId = null;
    this.rawHours = [];
    this.thresholds = null;
    this.gradWeight = 5;
    this.platforms = [];
    this.selectedPlatforms = new Set();
    this.granularity = 1;
    this.chart = null;
  }

  async init() {
    const pathParts = window.location.pathname.split('/');
    this.experimentId = pathParts[pathParts.length - 2]; // /experiment/:id/hourly-stats 中的 :id
    if (!this.experimentId) {
      this.showError('无法从 URL 解析实验 ID');
      return;
    }
    document.getElementById('refresh-btn').addEventListener('click', () => this.load(true));
    document.getElementById('retry-btn').addEventListener('click', () => this.load(true));
    document.getElementById('granularity-select').addEventListener('change', (e) => {
      this.granularity = Number(e.target.value) || 1;
      this.render();
    });
    await this.load(false);
  }

  async load(forceRefresh) {
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('error-message').classList.add('hidden');
    try {
      const url = `/api/experiment/${this.experimentId}/hourly-stats${forceRefresh ? '?refresh=1' : ''}`;
      const response = await fetch(url);
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || `HTTP ${response.status}`);
      }
      this.rawHours = json.hours || [];
      this.thresholds = json.heatThresholds || null;
      this.gradWeight = json.gradWeight || 5;
      this.platforms = (json.experiment && json.experiment.platforms) || [];
      if (this.selectedPlatforms.size === 0) {
        this.platforms.forEach((p) => this.selectedPlatforms.add(p));
      }
      this.data = json;
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('stats-content').classList.remove('hidden');
      this.renderHeader(json);
      this.renderWarnings(json.warnings || {});
      this.renderGranularityControls();
      this.render();
      const cacheEl = document.getElementById('cache-indicator');
      cacheEl.textContent = json.fresh ? '刚刷新' : `缓存于 ${new Date(json.cachedAt).toLocaleTimeString('zh-CN')}`;
    } catch (err) {
      this.showError(err.message);
    }
  }

  showError(msg) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('stats-content').classList.add('hidden');
    document.getElementById('error-message').classList.remove('hidden');
    document.getElementById('error-text').textContent = `加载失败: ${msg}`;
  }

  renderHeader(json) {
    const exp = json.experiment || {};
    document.getElementById('experiment-name').textContent = exp.name || '未知实验';
    document.getElementById('experiment-id').textContent = `ID: ${String(exp.id || '').slice(0, 8)}...`;
    document.getElementById('experiment-mode').textContent = `模式: ${exp.tradingMode || '--'} · ${exp.status || '--'}`;
    const ws = exp.windowStart ? new Date(exp.windowStart).toLocaleString('zh-CN') : '--';
    const we = exp.windowEnd ? new Date(exp.windowEnd).toLocaleString('zh-CN') : '--';
    const srcMap = {
      'backtest-config': '回测配置窗', 'started_at': '启动时间', 'created_at': '创建时间',
      'now': '当前时间', 'stopped_at': '停止时间', 'clamped': '截断(45d)', 'missing': '缺失',
    };
    document.getElementById('experiment-window').textContent =
      `窗口: ${ws} ~ ${we}（${srcMap[exp.windowSource] || exp.windowSource || '--'}）`;
    const tu = exp.tokenUniverseSource;
    document.getElementById('experiment-token-universe').textContent =
      tu && tu !== 'self' ? `代币宇宙: 源实验 ${tu.replace('source-experiment:', '')}` : '';
    document.getElementById('grad-weight-label').textContent = String(this.gradWeight);

    document.getElementById('link-detail').href = `/experiment/${this.experimentId}`;
    document.getElementById('link-signal-stats').href = `/experiment/${this.experimentId}/signal-stats`;
    document.getElementById('link-signals').href = `/experiment/${this.experimentId}/signals`;
    document.getElementById('link-trades').href = `/experiment/${this.experimentId}/trades`;
  }

  renderWarnings(w) {
    const bar = document.getElementById('warnings-bar');
    const lines = [];
    if (w.platformErrors && Object.keys(w.platformErrors).length > 0) {
      for (const [p, msg] of Object.entries(w.platformErrors)) {
        lines.push(`⚠️ ${p} 毕业事件查询失败（该平台毕业数显示为 ?）：${msg}`);
      }
    }
    if (w.tokenRowsTruncated) lines.push('⚠️ 实验代币超过 30000 行保护上限，新票统计已截断');
    if (w.windowClamped) lines.push('⚠️ 时间窗超过 45 天，已截断展示');
    if (w.unplacedGraduations) lines.push(`ℹ️ ${w.unplacedGraduations} 条毕业事件缺失时间戳未计入分桶`);
    if (!lines.length) { bar.classList.add('hidden'); return; }
    bar.innerHTML = lines.map((l) => `<div>${this.escapeHtml(l)}</div>`).join('');
    bar.classList.remove('hidden');
  }

  renderGranularityControls() {
    const box = document.getElementById('platform-checkboxes');
    box.innerHTML = '';
    for (const p of this.platforms) {
      const label = document.createElement('label');
      label.className = 'flex items-center gap-1 cursor-pointer text-sm text-gray-300';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.selectedPlatforms.has(p);
      cb.addEventListener('change', () => {
        if (cb.checked) this.selectedPlatforms.add(p);
        else this.selectedPlatforms.delete(p);
        this.render();
      });
      const tag = document.createElement('span');
      tag.className = 'platform-tag';
      tag.textContent = PLATFORM_LABELS[p] || p;
      tag.style.backgroundColor = `${PLATFORM_COLORS[p] || '#6b7280'}33`;
      tag.style.color = PLATFORM_COLORS[p] || '#9ca3af';
      label.appendChild(cb);
      label.appendChild(tag);
      box.appendChild(label);
    }
  }

  /** 镜像服务端 mergeHourBuckets：floor UTC ms 到粒度网格求和（null 传播）+ 重算热度 */
  computeHeat(scope, newTokens, gradTotal) {
    if (gradTotal == null || !this.thresholds) return null;
    const th = this.thresholds[scope] || this.thresholds.total;
    const score = (newTokens || 0) + this.gradWeight * (gradTotal || 0);
    if (score >= th.hot) return 'hot';
    if (score >= th.active) return 'active';
    if (score >= th.calm) return 'calm';
    return 'cold';
  }

  mergeHours(granularityHours) {
    const granMs = Math.max(1, granularityHours) * HOUR_MS;
    const buckets = new Map();
    const sumNullable = (a, b) => (a == null || b == null) ? null : a + b;
    for (const h of this.rawHours) {
      const ms = new Date(h.hourStart).getTime();
      if (!Number.isFinite(ms)) continue;
      const b = Math.floor(ms / granMs) * granMs;
      if (!buckets.has(b)) buckets.set(b, { platforms: {}, total: { newTokens: 0, gradTotal: 0, gradDiscovered: 0 } });
      const cell = buckets.get(b);
      for (const p of this.platforms) {
        const pc = h.platforms[p];
        if (!pc) continue;
        if (!cell.platforms[p]) cell.platforms[p] = { newTokens: 0, gradTotal: 0, gradDiscovered: 0 };
        cell.platforms[p].newTokens += pc.newTokens || 0;
        cell.platforms[p].gradTotal = sumNullable(cell.platforms[p].gradTotal, pc.gradTotal);
        cell.platforms[p].gradDiscovered = sumNullable(cell.platforms[p].gradDiscovered, pc.gradDiscovered);
      }
      cell.total.newTokens += (h.total && h.total.newTokens) || 0;
      cell.total.gradTotal = sumNullable(cell.total.gradTotal, h.total && h.total.gradTotal);
      cell.total.gradDiscovered = sumNullable(cell.total.gradDiscovered, h.total && h.total.gradDiscovered);
    }
    const merged = [];
    for (const ms of [...buckets.keys()].sort((a, b) => a - b)) {
      const cell = buckets.get(ms);
      const heat = {};
      for (const scope of Object.keys({ ...cell.platforms, total: cell.total })) {
        heat[scope] = this.computeHeat(scope, cell.platforms[scope] ? cell.platforms[scope].newTokens : cell.total.newTokens,
          scope === 'total' ? cell.total.gradTotal : (cell.platforms[scope] || {}).gradTotal);
      }
      merged.push({ hourStart: new Date(ms).toISOString(), platforms: cell.platforms, total: cell.total, heat });
    }
    return merged;
  }

  render() {
    const hours = this.mergeHours(this.granularity);
    this.renderSummary(hours);
    this.renderChart(hours);
    this.renderTable(hours);
    const empty = document.getElementById('empty-state');
    const hasData = hours.some((h) => Object.values(h.platforms).some((p) => (p.newTokens || 0) + (p.gradTotal || 0) > 0));
    empty.classList.toggle('hidden', hasData);
  }

  renderSummary(hours) {
    const sum = { newTokens: 0, gradTotal: 0, gradDiscovered: 0 };
    const gradNonNull = hours.some((h) => h.total.gradTotal != null);
    for (const h of hours) {
      sum.newTokens += h.total.newTokens || 0;
      if (h.total.gradTotal != null && sum.gradTotal != null) sum.gradTotal += h.total.gradTotal;
      else if (h.total.gradTotal == null) sum.gradTotal = null;
      if (h.total.gradDiscovered != null && sum.gradDiscovered != null) sum.gradDiscovered += h.total.gradDiscovered;
      else if (h.total.gradDiscovered == null) sum.gradDiscovered = null;
    }
    const s = this.data && this.data.summary ? this.data.summary : { total: sum, platforms: {}, heatCounts: {}, peakHour: null };
    const fmt = (v) => (v == null ? '?' : String(v));
    const heatTotal = (s.heatCounts && s.heatCounts.total) || {};
    const cards = [
      { label: '新票总数', value: String(s.total.newTokens), cls: 'text-blue-400' },
      { label: '毕业总数（大盘）', value: fmt(s.total.gradTotal), cls: 'text-rose-400' },
      { label: '毕业（本实验发现）', value: fmt(s.total.gradDiscovered), cls: 'text-orange-400' },
      { label: '覆盖小时数', value: String(hours.length), cls: 'text-gray-100' },
      { label: '峰值小时', value: s.peakHour ? new Date(s.peakHour.hourStart).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit' }) + '时' : '--', cls: 'text-purple-400' },
      { label: '热度分布（合计）', value: HEAT_ORDER.map((k) => `${HEAT_META[k].text.slice(2)} ${heatTotal[k] || 0}`).join(' · '), cls: 'text-gray-300 text-base leading-relaxed' },
    ];
    document.getElementById('summary-cards').innerHTML = cards.map((c) => `
      <div class="bg-gray-700 p-4 rounded-lg border border-gray-600">
        <div class="text-sm text-gray-400 mb-1">${c.label}</div>
        <div class="text-xl font-bold ${c.cls}">${this.escapeHtml(c.value)}</div>
      </div>`).join('');
    void gradNonNull;
  }

  timeLabel(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return this.granularity >= 24
      ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}时`;
  }

  renderChart(hours) {
    const labels = hours.map((h) => this.timeLabel(h.hourStart));
    const activePlatforms = this.platforms.filter((p) => this.selectedPlatforms.has(p));
    const datasets = activePlatforms.map((p) => ({
      label: `${PLATFORM_LABELS[p] || p} 新票`,
      data: hours.map((h) => (h.platforms[p] ? h.platforms[p].newTokens : 0)),
      backgroundColor: `${PLATFORM_COLORS[p] || '#6b7280'}cc`,
      borderColor: PLATFORM_COLORS[p] || '#6b7280',
      borderWidth: 1,
      stack: 'newTokens',
      yAxisID: 'y',
      order: 3,
    }));
    datasets.push({
      label: '毕业（大盘）',
      data: hours.map((h) => h.total.gradTotal),
      type: 'line',
      borderColor: '#f43f5e',
      backgroundColor: '#f43f5e',
      yAxisID: 'y1',
      pointRadius: 2,
      tension: 0.2,
      spanGaps: true,
      order: 1,
    });
    datasets.push({
      label: '毕业（本实验发现）',
      data: hours.map((h) => h.total.gradDiscovered),
      type: 'line',
      borderColor: '#fb923c',
      backgroundColor: '#fb923c',
      borderDash: [6, 3],
      yAxisID: 'y1',
      pointRadius: 2,
      tension: 0.2,
      spanGaps: true,
      order: 2,
    });

    const ctx = document.getElementById('hourly-chart').getContext('2d');
    if (this.chart) this.chart.destroy(); // 粒度/平台切换复用 canvas 的常规坑
    this.chart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#d1d5db' } },
          tooltip: { mode: 'index' },
        },
        scales: {
          x: { stacked: true, ticks: { color: '#9ca3af', maxRotation: 60, autoSkip: true, maxTicksLimit: 24 }, grid: { color: 'rgba(75,85,99,0.2)' } },
          y: { stacked: true, beginAtZero: true, title: { display: true, text: '新票数', color: '#9ca3af' }, ticks: { color: '#9ca3af' }, grid: { color: 'rgba(75,85,99,0.2)' } },
          y1: { position: 'right', beginAtZero: true, title: { display: true, text: '毕业数', color: '#9ca3af' }, ticks: { color: '#9ca3af' }, grid: { drawOnChartArea: false } },
        },
      },
    });
    document.getElementById('chart-gran-label').textContent = this.granularity >= 24 ? '1 天' : `${this.granularity} 小时`;
  }

  heatBadge(label, small) {
    if (!label) return `<span class="heat-badge heat-unknown ${small ? '' : 'text-sm'}">?</span>`;
    const meta = HEAT_META[label] || HEAT_META.cold;
    return `<span class="heat-badge ${meta.cls} ${small ? '' : 'text-sm'}">${meta.text}</span>`;
  }

  renderTable(hours) {
    const headRow = document.getElementById('table-head-row');
    const activePlatforms = this.platforms.filter((p) => this.selectedPlatforms.has(p));
    let head = '<th class="px-4 py-3 text-left">时间</th>';
    for (const p of activePlatforms) {
      head += `
        <th class="px-3 py-3 text-center" colspan="3">
          <span class="platform-tag" style="background-color:${PLATFORM_COLORS[p]}33;color:${PLATFORM_COLORS[p]}">${PLATFORM_LABELS[p] || p}</span>
        </th>`;
    }
    head += `
      <th class="px-3 py-3 text-center">合计新票</th>
      <th class="px-3 py-3 text-center">毕业大盘/交集</th>
      <th class="px-3 py-3 text-center">热度</th>`;
    headRow.innerHTML = head;

    const body = document.getElementById('stats-table-body');
    const fmt = (v) => (v == null ? '<span class="cell-muted" title="查询失败/未知">?</span>' : String(v));
    const rows = hours.slice().reverse().map((h) => {
      let tds = `<td class="px-4 py-2 whitespace-nowrap text-gray-300">${this.timeLabel(h.hourStart)}</td>`;
      for (const p of activePlatforms) {
        const c = h.platforms[p] || { newTokens: 0, gradTotal: 0, gradDiscovered: 0 };
        tds += `
          <td class="px-3 py-2 text-center">${c.newTokens || 0}</td>
          <td class="px-3 py-2 text-center">${fmt(c.gradTotal)}</td>
          <td class="px-3 py-2 text-center cell-muted">${fmt(c.gradDiscovered)}</td>`;
      }
      tds += `
        <td class="px-3 py-2 text-center font-semibold">${h.total.newTokens || 0}</td>
        <td class="px-3 py-2 text-center">${fmt(h.total.gradTotal)} / <span class="cell-muted">${fmt(h.total.gradDiscovered)}</span></td>`;
      const smallBadges = activePlatforms
        .map((p) => this.heatBadge(h.heat[p], true))
        .join(' ');
      tds += `<td class="px-3 py-2 text-center whitespace-nowrap">${this.heatBadge(h.heat.total, false)}<div class="mt-1 flex gap-1 justify-center">${smallBadges}</div></td>`;
      return `<tr class="table-row">${tds}</tr>`;
    }).join('');
    body.innerHTML = rows || '<tr><td colspan="9" class="px-4 py-8 text-center text-gray-500">无数据</td></tr>';
  }

  escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ExperimentHourlyStatsPage().init();
});
