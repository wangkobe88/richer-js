/**
 * Daily 更新流程页面（/model-metrics）
 *
 * 迁自 pumpfun-wss-trader（2026-09-27），裁剪为 richer-js 两步：
 * fetch /api/model-metrics → 表格提取 step3（token 分类）/ step4（钱包画像）核心数字；
 * 详情展开完整 metrics jsonb。无 ML 摘要卡 / step1·2·5·6 / Old→New 列（不迁）。
 * 纯只读监控——无手动触发（cron 专属，严格原口径）。
 */
'use strict';

class ModelMetricsManager {
  constructor() {
    this.rows = []; this.total = 0; this.offset = 0; this.limit = 50;
    this.init();
  }
  init() {
    document.getElementById('refresh-btn').addEventListener('click', () => this.load(true));
    document.getElementById('status-filter').addEventListener('change', () => this.load(true));
    document.getElementById('more-btn').addEventListener('click', () => this.load(false));
    this.load(true);
  }
  async load(reset) {
    if (reset) { this.offset = 0; this.rows = []; }
    const status = document.getElementById('status-filter').value;
    const params = new URLSearchParams({ limit: this.limit, offset: this.offset });
    if (status) params.set('status', status);
    try {
      const resp = await fetch(`/api/model-metrics?${params}`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error || '未知错误');
      this.rows = reset ? json.data : [...this.rows, ...json.data];
      this.total = json.pagination.total;
      this.offset = this.rows.length;
      this.render();
    } catch (e) { this.showError(e.message); }
  }
  fmtTime(iso) {
    if (!iso) return '-';
    try { return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }); }
    catch { return iso; }
  }
  fmtDuration(sec) {
    if (sec == null) return '';
    if (sec < 60) return `${Math.round(sec)}s`;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    if (m >= 60) return `${Math.floor(m / 60)}h${m % 60}m`;
    return s ? `${m}分${s}s` : `${m}分`;
  }
  esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  render() {
    const wrap = document.getElementById('table-wrap');
    const empty = document.getElementById('empty');
    const loading = document.getElementById('loading');
    const more = document.getElementById('more-btn');
    loading.classList.add('hidden');
    if (!this.rows.length) {
      wrap.classList.add('hidden'); empty.classList.remove('hidden'); more.classList.add('hidden'); return;
    }
    wrap.classList.remove('hidden'); empty.classList.add('hidden');
    more.classList.toggle('hidden', this.rows.length >= this.total);

    const tbody = document.getElementById('tbody');
    tbody.innerHTML = this.rows.map(r => {
      const m = r.metrics || {};
      const s3 = m.step3_token_profile || {};   // token 分类（逐实验断点，done 标记）
      const s4 = m.step4_wallet_profiles || {}; // 高频钱包离线全历史 profile（threshold=3, --days 14）
      const pct = (v, d = 1) => (v == null || v === '' ? '—' : `${(+v).toFixed(d)}%`);
      const D = (h) => `<div>${h}</div>`;
      const elapsedLine = (sec) => sec != null ? D(`⏱ ${this.fmtDuration(sec)}`) : '';
      const stCls = `status-${r.status || ''}`;
      return `<tr class="border-b border-gray-700/50 hover:bg-gray-700/30 align-top">
        <td class="px-3 py-2 mono">#${r.iteration_no ?? '?'}</td>
        <td class="px-3 py-2 text-xs whitespace-nowrap">${this.fmtTime(r.trigger_time)}</td>
        <td class="px-3 py-2 text-xs ${stCls}">${this.esc(r.status || '')}</td>
        <td class="px-3 py-2 text-xs">${this.esc(r.current_step || '-')}</td>
        <td class="px-3 py-2 text-xs mono">
          ${s3.processed != null
            ? D(`<span title="token 全集合计（scope=最新 N 个 virtual 实验逐实验跑）">token ${s3.processed} · 落地 ${s3.db_written ?? '—'} · ${(s3.per_experiment || []).length || '—'}实验</span>`)
              + D(`<span class="text-gray-400">${s3.ticks != null ? `${s3.ticks.toLocaleString()}tick` : '—'}</span>`)
              + D(`<span class="text-orange-300" title="wash 分类计数（操纵盘密度）；其余分类: ${Object.entries(s3.category_counts || {}).filter(([k, v]) => k !== 'wash' && v > 0).map(([k, v]) => `${k}=${v}`).join(' ') || '无'}">wash ${s3.category_counts?.wash ?? 0} (${pct(s3.processed ? (s3.category_counts?.wash || 0) / s3.processed * 100 : null, 0)})</span>`)
              + (s3.done === false ? D(`<span class="text-yellow-400" title="逐实验断点：done=false 表示中途失败，重跑从 per_experiment 已完实验后续跑">⏳ 进行中（${(s3.per_experiment || []).length}/${(s3.experiment_ids || []).length || '?'} 实验${s3.skipped_resumed ? `，续 ${s3.skipped_resumed}` : ''}）</span>`) : '')
              + D(`<span class="text-gray-500" title="${this.esc((s3.experiment_ids || []).join(' '))}">${(s3.experiment_ids || []).map(id => id.slice(0, 8)).join(',')}</span>`)
              + elapsedLine(s3.elapsed_sec)
            : '<div class="text-gray-500">—</div>'}
        </td>
        <td class="px-3 py-2 text-xs mono">
          ${(s4.upserted != null || s4.high_freq_found != null)
            ? D(`<span title="高频钱包(tick≥${s4.threshold ?? 3})离线全历史 profile → wallet_offline_profiles（--days 14，TPA 实时读侧消费）">HF ${s4.high_freq_found ?? '—'} · upsert ${s4.upserted ?? '—'}</span>`)
              + D(`<span class="text-gray-400" title="阶段1 扫描行数与缓存源 / 阶段3 token_profiles 分类命中率">${s4.cache_source ?? '—'} ${s4.rows_scanned != null ? s4.rows_scanned.toLocaleString() + '行' : ''} · 分类命中 ${s4.tp_hit ?? '—'}/${s4.tp_tokens ?? '—'}</span>`)
              + D(`<span class="text-gray-500">thr ${s4.threshold ?? 3}</span>`)
              + elapsedLine(s4.elapsed_sec)
            : '<div class="text-gray-500">—</div>'}
        </td>
        <td class="px-3 py-2"><button class="text-blue-400 hover:text-blue-300 text-xs" onclick="mmm.showDetail('${r.id}')">详情</button></td>
      </tr>`;
    }).join('');
  }

  async showDetail(id) {
    try {
      const resp = await fetch(`/api/model-metrics/${id}`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error || '未知错误');
      const d = json.data;
      document.getElementById('d-iter').textContent = `iter #${d.iteration_no} (${d.id.slice(0, 8)}) · ${this.fmtTime(d.trigger_time)}`;
      document.getElementById('d-metrics').textContent = JSON.stringify(d.metrics || {}, null, 2);
      const errEl = document.getElementById('d-error');
      if (d.error) { errEl.textContent = '错误: ' + d.error; errEl.classList.remove('hidden'); }
      else errEl.classList.add('hidden');
      document.getElementById('detail-modal').classList.add('active');
    } catch (e) { alert('加载详情失败: ' + e.message); }
  }
  closeDetail() { document.getElementById('detail-modal').classList.remove('active'); }
  showError(msg) {
    document.getElementById('loading').innerHTML = `<div class="text-red-400">加载失败: ${this.esc(msg)}</div>`;
  }
}

const mmm = new ModelMetricsManager();
