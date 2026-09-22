/**
 * 市场截面 Regime 监控页（观察版，pumpfun 回迁批 2.6）
 * 纯只读：market_regime_snapshots 快照时序（PnL 对照卡未迁——trading_strategies 实体表不在 richer-js）。
 * 红线：market* 因子仅观察，任何交易策略 condition 不得引用（本页零交易路径接触）。
 */
(function () {
  'use strict';

  var RANGE_MS = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3 };
  var REFRESH_SEC = 60;

  var state = {
    range: '24h',
    rows: [],
    stride: 1,
    total: 0,
    countdown: REFRESH_SEC,
    loading: false
  };

  var charts = {};   // chartNewborn / chartRates / chartMeanRet

  // ---------- 工具 ----------

  function el(id) { return document.getElementById(id); }

  function showError(msg) {
    var box = el('errorContainer');
    box.style.display = 'block';
    box.innerHTML = '<div class="error">' + msg + '</div>';
  }
  function clearError() { el('errorContainer').style.display = 'none'; }

  function store(key, val) {
    try { localStorage.setItem('marketRegime.' + key, JSON.stringify(val)); } catch (e) { /* 隐私模式等场景忽略 */ }
  }
  function load(key, dflt) {
    try {
      var raw = localStorage.getItem('marketRegime.' + key);
      return raw === null ? dflt : JSON.parse(raw);
    } catch (e) { return dflt; }
  }

  function fmtNum(x, digits) {
    if (x === null || x === undefined || Number.isNaN(Number(x))) return '—';
    return Number(x).toFixed(digits === undefined ? 2 : digits);
  }
  function fmtPct01(x, digits) {   // 0-1 比率 → %
    if (x === null || x === undefined) return '—';
    return (Number(x) * 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }
  function fmtMs(ms) {
    if (ms === null || ms === undefined) return '—';
    var m = Math.floor(ms / 60000);
    if (m < 60) return m + ' 分钟';
    return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
  }

  // ---------- 数据加载 ----------

  async function fetchJson(url) {
    var resp = await fetch(url);
    var body = await resp.json().catch(function () { return {}; });
    if (!resp.ok || body.success === false) {
      throw new Error(body.error || ('HTTP ' + resp.status));
    }
    return body;
  }

  async function loadSnapshots() {
    var now = Date.now();
    var from = now - RANGE_MS[state.range];
    var body = await fetchJson('/api/market-regime?from=' + new Date(from).toISOString() + '&to=' + new Date(now).toISOString());
    state.rows = body.rows || [];
    state.stride = body.stride || 1;
    state.total = body.total || 0;
  }

  // ---------- 图表 ----------

  function timeXScale(spanMs) {
    return {
      type: 'time',
      time: spanMs <= 3600e3 ? { unit: 'minute', displayFormats: { minute: 'HH:mm' } }
        : { unit: 'hour', displayFormats: { hour: spanMs > 24 * 3600e3 ? 'MM-dd HH:mm' : 'HH:mm' } },
      grid: { display: false }
    };
  }

  function baseOpts(spanMs, scales) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: { legend: { labels: { boxWidth: 14, font: { size: 12 } } } },
      scales: Object.assign({ x: timeXScale(spanMs) }, scales || {})
    };
  }

  function buildCharts() {
    var spanMs = RANGE_MS[state.range];

    // ① 新生票数（柱）+ cohort 样本量（线，右轴）
    charts.newborn = new Chart(el('chartNewborn'), {
      type: 'bar',
      data: { datasets: [
        { label: '新生票数 1h（出生>40m 复活老票不入册）', data: [], backgroundColor: 'rgba(24,144,255,0.55)', yAxisID: 'y' },
        { label: 'cohort 样本量（出生∈[t-40m,t-10m]）', data: [], type: 'line', borderColor: '#722ed1', backgroundColor: '#722ed1', pointRadius: 0, borderWidth: 1.5, tension: 0.15, spanGaps: false, yAxisID: 'y1' }
      ] },
      options: baseOpts(spanMs, {
        y: { position: 'left', title: { display: true, text: '新生票数' }, beginAtZero: true },
        y1: { position: 'right', title: { display: true, text: 'cohort N' }, grid: { drawOnChartArea: false }, beginAtZero: true }
      })
    });

    // ② 火箭率/断流死亡率（%左轴）+ 买卖比（右轴）
    charts.rates = new Chart(el('chartRates'), {
      type: 'line',
      data: { datasets: [
        { label: '火箭率 30m（cohort 峰值≥+100% 占比）', data: [], borderColor: '#f5222d', backgroundColor: '#f5222d', pointRadius: 0, borderWidth: 1.5, tension: 0.15, spanGaps: false, yAxisID: 'y' },
        { label: '断流死亡率 30m（≥540s 无 tick）', data: [], borderColor: '#8c8c8c', backgroundColor: '#8c8c8c', pointRadius: 0, borderWidth: 1.5, tension: 0.15, spanGaps: false, yAxisID: 'y' },
        { label: '买卖比 10m（Σ买/Σ卖 BNB）', data: [], borderColor: '#13c2c2', backgroundColor: '#13c2c2', pointRadius: 0, borderWidth: 1.5, tension: 0.15, spanGaps: false, yAxisID: 'y1' }
      ] },
      options: baseOpts(spanMs, {
        y: { position: 'left', title: { display: true, text: '占比 %' }, beginAtZero: true, ticks: { callback: function (v) { return v + '%'; } } },
        y1: { position: 'right', title: { display: true, text: '买/卖比' }, grid: { drawOnChartArea: false } }
      })
    });

    // ③ cohort 末价平均涨幅 %
    charts.meanRet = new Chart(el('chartMeanRet'), {
      type: 'line',
      data: { datasets: [
        { label: 'cohort 末价平均涨幅 %（死亡票含入，无幸存者偏差）', data: [], borderColor: '#52c41a', backgroundColor: 'rgba(82,196,26,0.12)', pointRadius: 0, borderWidth: 1.5, tension: 0.15, spanGaps: false, fill: true }
      ] },
      options: baseOpts(spanMs, {
        y: { title: { display: true, text: '平均涨幅 %' } }
      })
    });
  }

  function renderCharts() {
    var rows = state.rows;
    var ts = rows.map(function (r) { return Date.parse(r.ts); });

    // 档位切换后动态更新 x 轴时间粒度（图表只在 init 建一次）
    ['newborn', 'rates', 'meanRet'].forEach(function (k) {
      if (charts[k]) charts[k].options.scales.x.time = timeXScale(RANGE_MS[state.range]).time;
    });

    charts.newborn.data.datasets[0].data = rows.map(function (r, i) { return { x: ts[i], y: r.newborn_count_1h }; });
    charts.newborn.data.datasets[1].data = rows.map(function (r, i) { return { x: ts[i], y: r.cohort_n }; });
    charts.newborn.update('none');

    charts.rates.data.datasets[0].data = rows.map(function (r, i) { return { x: ts[i], y: r.rocket_rate_30m === null ? null : r.rocket_rate_30m * 100 }; });
    charts.rates.data.datasets[1].data = rows.map(function (r, i) { return { x: ts[i], y: r.death_rate_30m === null ? null : r.death_rate_30m * 100 }; });
    charts.rates.data.datasets[2].data = rows.map(function (r, i) { return { x: ts[i], y: r.flow_bs_ratio_10m }; });
    charts.rates.update('none');

    charts.meanRet.data.datasets[0].data = rows.map(function (r, i) { return { x: ts[i], y: r.young_mean_ret_30m }; });
    charts.meanRet.update('none');

    el('seriesNote').textContent = rows.length
      ? ('共 ' + state.total + ' 行' + (state.stride > 1 ? '，服务端等距抽样 stride=' + state.stride + '（展示 ' + rows.length + ' 点）' : '') + '；null 断线 = fail-closed 证据不足')
      : '';
  }

  // ---------- 分位卡片 ----------

  function percentile(values, cur) {
    if (!values.length) return null;
    var below = values.filter(function (v) { return v <= cur; }).length;
    return Math.round((below / values.length) * 100);
  }

  function renderCards() {
    var rows = state.rows;
    var grid = el('pctCards');
    var meta = el('snapshotMeta');

    if (!rows.length) {
      grid.innerHTML = '<div class="empty-state">快照表暂无数据。<br>' +
        '数据源 = WSS 引擎 60s 定时器（引擎启动后 1 分钟内首写，重启后暖机约 40 分钟 cohort 才成熟）。<br>' +
        '若长期为空：确认有运行中的 fourmemeWs 实验、market_regime_snapshots 表有行。</div>';
      meta.textContent = '';
      return;
    }

    var last = rows[rows.length - 1];
    function collect(key) {
      return rows.map(function (r) { return r[key]; }).filter(function (v) { return v !== null && v !== undefined; });
    }

    var defs = [
      { key: 'newborn_count_1h', name: '新生票数（1h 窗）', fmt: function (v) { return String(v); }, vals: collect('newborn_count_1h'), noNull: true,
        d: '出生=TokenCreate/回测 discovered_at；>40m 老票不入册' },
      { key: 'rocket_rate_30m', name: '火箭率（cohort 峰值≥+100%）', fmt: function (v) { return fmtPct01(v); }, vals: collect('rocket_rate_30m'),
        d: 'cohort<30 fail-closed' },
      { key: 'young_mean_ret_30m', name: 'cohort 末价平均涨幅', fmt: function (v) { return fmtNum(v, 1) + '%'; }, vals: collect('young_mean_ret_30m'),
        d: 'cohort<30 fail-closed；死亡票含入' },
      { key: 'death_rate_30m', name: '断流死亡率（≥540s 无 tick）', fmt: function (v) { return fmtPct01(v); }, vals: collect('death_rate_30m'),
        d: 'cohort<30 fail-closed' },
      { key: 'flow_bs_ratio_10m', name: '全市场买卖比（10m）', fmt: function (v) { return fmtNum(v); }, vals: collect('flow_bs_ratio_10m'),
        d: '窗口 Σ卖<1 BNB fail-closed' }
    ];

    var html = defs.map(function (d) {
      var cur = last[d.key];
      if (cur === null || cur === undefined) {
        return '<div class="pct-card nullstate"><div class="k">' + d.name + '</div>' +
          '<div class="v">null</div><div class="p">fail-closed（≠ 0）</div><div class="d">' + d.d + '</div></div>';
      }
      var p = percentile(d.vals, cur);
      return '<div class="pct-card"><div class="k">' + d.name + '</div>' +
        '<div class="v">' + d.fmt(cur) + '</div>' +
        '<div class="p">' + (p === null ? '窗口内无历史可比' : '窗口内 P' + p + ' 分位') + '</div>' +
        '<div class="d">' + d.d + '</div></div>';
    }).join('');

    // 暖机上下文：最后一行的诊断列
    var warm = [];
    if (last.cohort_n !== null && last.cohort_n !== undefined && last.cohort_n < 30) {
      warm.push('cohort_n=' + last.cohort_n + ' < 30（三率 null = fail-closed 暖机中）');
    }
    if (last.fed_age_ms !== null && last.fed_age_ms !== undefined) {
      warm.push('feed 已运行 ' + fmtMs(last.fed_age_ms));
    }
    if (last.flow_sell_bnb !== null && last.flow_sell_bnb !== undefined && last.flow_sell_bnb < 1 && last.flow_bs_ratio_10m === null) {
      warm.push('10m Σ卖=' + fmtNum(last.flow_sell_bnb, 1) + ' BNB < 1（买卖比 null）');
    }
    grid.innerHTML = html;
    meta.textContent = '末快照 ' + new Date(Date.parse(last.ts)).toLocaleString('zh-CN') +
      (last.source ? '（写者 ' + String(last.source).slice(0, 8) + '）' : '') +
      (warm.length ? '　|　' + warm.join('；') : '');
  }

  // ---------- 主流程 ----------

  async function reload() {
    if (state.loading) return;
    state.loading = true;
    state.countdown = REFRESH_SEC;
    clearError();
    try {
      await loadSnapshots();
      renderCards();
      renderCharts();
    } catch (e) {
      showError(e.message.indexOf('快照') === 0 ? e.message : '快照加载失败：' + e.message);
    }
    state.loading = false;
  }

  function bindEvents() {
    el('rangeTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-range]');
      if (!btn) return;
      el('rangeTabs').querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.range = btn.getAttribute('data-range');
      store('range', state.range);
      reload();
    });

    el('refreshBtn').addEventListener('click', reload);

    setInterval(function () {
      if (state.loading) return;
      state.countdown -= 1;
      if (state.countdown <= 0) { reload(); return; }
      el('countdown').textContent = String(state.countdown);
    }, 1000);
  }

  async function init() {
    // 恢复持久化选择（范围档合法性校验）
    var savedRange = load('range', null);
    if (savedRange && RANGE_MS[savedRange]) {
      state.range = savedRange;
      el('rangeTabs').querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-range') === savedRange);
      });
    }
    buildCharts();
    bindEvents();
    await reload();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
