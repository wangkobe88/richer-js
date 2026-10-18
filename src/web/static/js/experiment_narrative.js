/**
 * 实验叙事分析结果页（v2.0 重写 2026-10-18）
 *
 * 定位：实验层面叙事「详情与操作页」——统计瓦片（评级分布×平均最高涨幅）+
 * 评级 tab（含 ★超级IP / 📣口号票特殊票种，C88）+ 叙事类型 chips（C85
 * token_category）+ 搜索 + 排序 + 行点击展开全管线明细（precheck→prestage→
 * Jev 分类/评分/计分→终评，各环节关键数据 + C68/C75/C80/C86/C88 审计标记 +
 * Jev 关键答案 + 涨幅面板 + C84 轮次留痕）+ 人工标注操作。
 *
 * 适配近期修改：C74 tweetType / C84 轮次 / C85 token_category / C86 豁免贯穿 /
 * C88 narrativeSuperIp·narrativeSuperIpSlogan 标签 + superIpSlogan 五腿审计 +
 * memFloorBlock。旧行（C88 前缓存）无键 → null 诚实显 `-`。
 */

// 叙事评级映射（narrative.rating = summary.numericRating：1/2/3/9）
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

// 叙事类型（token_category，C85）显示映射；event:* 前缀单独处理
const CATEGORY_LABELS = {
  project: '项目',
  account_based_meme: '账号梗',
  web3_native_ip_early: 'W3早期'
};

// 时效档简写（event_timing / superIpSlogan.timing 同枚举）
const TIMING_LABELS = {
  within_7d: '7d内',
  within_30d: '30d内',
  expected_within_30d: '预30d内',
  expected_beyond_30d: '预30d外',
  older: '过时',
  unknown: '未知'
};

// Jev 关键题 choice 简写（展示用，完整值 title 悬浮）
function shortChoice(v) {
  if (v == null) return null;
  return String(v).length > 14 ? String(v).slice(0, 13) + '…' : String(v);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtPct(v, digits = 1) {
  return (v == null || isNaN(v)) ? null : `${(+v).toFixed(digits)}%`;
}

function fmtNum(v, digits = 2) {
  return (v == null || isNaN(v)) ? null : (+v).toFixed(digits);
}

/** jsonb 可能是对象/字符串双态归一（旧行防御，parse 失败返回 null 不抛） */
function asObj(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

/**
 * stage 信封 payload 双形状（与 superip-labels.js _stagePayload 同款口径）：
 * 落库信封（buildStageSaveData）把 mapper 的 parsed_output 整包存进 `details` 键
 * （DB 行全部该形状）；内存新鲜路直传 mapper 形状时在原键 `parsed_output`。
 */
function stagePayload(stage) {
  const s = asObj(stage);
  return s?.details ?? s?.parsed_output ?? null;
}

class ExperimentNarrative {
  constructor() {
    this.experimentId = null;
    this.judgeExperimentId = null;
    this.experimentData = null;
    this.narrativeData = [];
    this.filteredData = [];
    this.features = new Map();   // addr → extractFeatures 产物（加载后一次算好）
    this.roundsMap = new Map();  // addr → { count, rows[] }（后置异步，C84）
    this.stats = {};
    this.state = {
      tab: 'all',             // all|high|mid|low|unrated|superip|slogan
      cats: new Set(),        // 选中的 token_category（空=全部；'__null__'=未分类）
      q: '',
      judge: 'all',
      sortKey: 'analyzed_at',
      sortDir: 'desc',
      open: new Set()         // 展开明细的 addr
    };
    this.currentEditingToken = null;
    this._searchTimer = null;

    this.init();
  }

  async init() {
    const pathParts = window.location.pathname.split('/');
    this.experimentId = pathParts[pathParts.length - 2]; // /experiment/:id/narrative

    if (!this.experimentId) {
      this.showError('无法获取实验 ID');
      return;
    }

    this.bindEvents();
    await this.loadData();
  }

  bindEvents() {
    document.getElementById('refresh-btn')?.addEventListener('click', () => this.loadData());
    document.getElementById('retry-btn')?.addEventListener('click', () => this.loadData());

    // 评级 tab（委托：tab 随数据动态渲染）
    document.getElementById('narrative-tabs')?.addEventListener('click', (e) => {
      const tab = e.target.closest('.nav-tab');
      if (!tab) return;
      this.state.tab = tab.dataset.tab;
      this.renderTabs();
      this.applyFilterAndSort();
    });

    // 叙事类型 chips（委托：chips 随数据动态渲染）
    document.getElementById('cat-chips')?.addEventListener('click', (e) => {
      const chip = e.target.closest('.cat-chip');
      if (!chip) return;
      const cat = chip.dataset.cat;
      if (this.state.cats.has(cat)) this.state.cats.delete(cat);
      else this.state.cats.add(cat);
      this.renderChips();
      this.applyFilterAndSort();
    });

    // 搜索（防抖 200ms）
    document.getElementById('search-input')?.addEventListener('input', (e) => {
      clearTimeout(this._searchTimer);
      const v = e.target.value.trim().toLowerCase();
      this._searchTimer = setTimeout(() => {
        this.state.q = v;
        this.applyFilterAndSort();
      }, 200);
    });

    // 人工评级筛选
    document.getElementById('judge-filter')?.addEventListener('change', (e) => {
      this.state.judge = e.target.value;
      this.applyFilterAndSort();
    });

    // 排序按钮（thead 静态，绑一次）
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const field = btn.dataset.sort;
        if (this.state.sortKey === field) {
          this.state.sortDir = this.state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.state.sortKey = field;
          this.state.sortDir = 'desc';
        }
        this.updateSortButtons();
        this.applyFilterAndSort();
      });
    });

    // 表体委托：行展开 / 复制地址 / judge 按钮
    document.getElementById('narrative-table-body')?.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.addr-btn');
      if (copyBtn) { this.copyAddress(copyBtn); return; }

      const judgeBtn = e.target.closest('.judge-btn');
      if (judgeBtn) {
        this.openJudgeModal(judgeBtn.dataset.address, judgeBtn.dataset.symbol);
        return;
      }
      const delBtn = e.target.closest('.judge-delete-btn');
      if (delBtn) {
        e.stopPropagation();
        this.deleteJudge(delBtn.dataset.address);
        return;
      }

      const row = e.target.closest('tr.table-row');
      if (row?.dataset?.addr) this.toggleOpen(row.dataset.addr);
    });

    // judge modal
    document.getElementById('judge-cancel-btn')?.addEventListener('click', () => this.closeJudgeModal());
    document.getElementById('judge-save-btn')?.addEventListener('click', () => this.saveJudge());
  }

  async loadData() {
    this.showLoading(true);
    try {
      const experimentRes = await fetch(`/api/experiment/${this.experimentId}`);
      if (!experimentRes.ok) throw new Error('加载实验数据失败');
      const experimentData = await experimentRes.json();
      if (!experimentData.success) throw new Error('实验数据格式错误');
      this.experimentData = experimentData.data;

      // 回测实验：标注数据用源实验 ID
      this.judgeExperimentId = this.experimentId;
      if (this.experimentData.config?.backtest?.sourceExperimentId) {
        this.judgeExperimentId = this.experimentData.config.backtest.sourceExperimentId;
      }

      const narrativeRes = await fetch(`/api/experiment/${this.experimentId}/narrative`);
      if (!narrativeRes.ok) throw new Error('加载叙事数据失败');
      const narrativeResult = await narrativeRes.json();
      if (narrativeResult.success) {
        this.narrativeData = narrativeResult.data || [];
        this.stats = narrativeResult.stats || {};
      } else {
        this.narrativeData = [];
        this.stats = {};
      }

      if (this.judgeExperimentId !== this.experimentId) {
        await this.loadJudgeDataFromSource();
      }

      // 特征提取一次算好（rawOutput JSON.parse 成本在加载期完成，渲染零重复解析）
      this.features = new Map(this.narrativeData.map(item => [item.token_address, extractFeatures(item)]));

      this.updateHeader();
      this.renderStats();
      this.renderTabs();
      this.renderChips();
      this.applyFilterAndSort();
      this.showContent(true);

      // C84 轮次留痕后置异步：不阻塞主表，失败静默（轮次列显 `-`）
      this.loadRounds();
    } catch (error) {
      console.error('加载数据失败:', error);
      this.showError(error.message);
    } finally {
      this.showLoading(false);
    }
  }

  /** C84 narrative_analysis_rounds 全量拉取 → per-token 计数+明细 */
  async loadRounds() {
    try {
      const res = await fetch(`/api/experiment/${this.experimentId}/narrative-rounds`);
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success || !Array.isArray(json.rounds)) return;
      const map = new Map();
      for (const row of json.rounds) {
        const addr = (row.token_address || '').toLowerCase();
        if (!addr) continue;
        if (!map.has(addr)) map.set(addr, { count: 0, rows: [] });
        const entry = map.get(addr);
        entry.count++;
        entry.rows.push(row);
      }
      this.roundsMap = map;
      // 行地址统一小写匹配；轮次到达后只重渲染表格
      this.renderTable();
    } catch (error) {
      console.warn('叙事轮次加载失败（静默，列显 -）:', error);
    }
  }

  /** 回测实验从源实验回填人工标注（原逻辑保留） */
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

  // ═══════════════ 渲染：头部 / 统计 / tab / chips ═══════════════

  updateHeader() {
    const nameEl = document.getElementById('experiment-name');
    const idEl = document.getElementById('experiment-id');
    const detailLink = document.getElementById('link-detail');
    if (nameEl) nameEl.textContent = this.experimentData.experimentName || '未命名实验';
    if (idEl) idEl.textContent = `ID: ${this.experimentId.slice(0, 8)}...`;
    if (detailLink) detailLink.href = `/experiment/${this.experimentId}`;
  }

  _ratingBuckets() {
    const b = { high: [], mid: [], low: [], unrated: [] };
    for (const d of this.narrativeData) {
      const r = d.narrative?.rating;
      if (r === 3) b.high.push(d);
      else if (r === 2) b.mid.push(d);
      else if (r === 1) b.low.push(d);
      else b.unrated.push(d); // 9 或 null
    }
    return b;
  }

  _avgMax(list) {
    const vals = list.map(d => d.max_change_percent).filter(v => v != null && !isNaN(v));
    if (vals.length === 0) return '-';
    return `${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}%`;
  }

  renderStats() {
    const buckets = this._ratingBuckets();
    document.getElementById('stat-total-tokens').textContent = this.stats.total_tokens || 0;
    document.getElementById('stat-narrative-tokens').textContent = this.stats.narrative_tokens || 0;
    const coverage = this.stats.total_tokens > 0
      ? ((this.stats.narrative_tokens / this.stats.total_tokens) * 100).toFixed(1) : 0;
    document.getElementById('stat-coverage-inline').textContent = `${coverage}%`;
    document.getElementById('stat-avg-max-change').textContent = `${this.stats.avg_max_change ?? 0}%`;

    document.getElementById('stat-high-count').textContent = buckets.high.length;
    document.getElementById('stat-mid-count').textContent = buckets.mid.length;
    document.getElementById('stat-low-count').textContent = buckets.low.length;
    document.getElementById('stat-unrated-count').textContent = buckets.unrated.length;
    document.getElementById('stat-high-avg').textContent = this._avgMax(buckets.high);
    document.getElementById('stat-mid-avg').textContent = this._avgMax(buckets.mid);
    document.getElementById('stat-low-avg').textContent = this._avgMax(buckets.low);
    document.getElementById('stat-unrated-avg').textContent = this._avgMax(buckets.unrated);

    // C88 两标签计数
    document.getElementById('stat-superip-count').textContent =
      this.narrativeData.filter(d => d.narrative?.narrativeSuperIp === 1).length;
    document.getElementById('stat-slogan-count').textContent =
      this.narrativeData.filter(d => d.narrative?.narrativeSuperIpSlogan === 1).length;
  }

  renderTabs() {
    const container = document.getElementById('narrative-tabs');
    if (!container) return;
    const buckets = this._ratingBuckets();
    const tabs = [
      { key: 'all', label: '全部', cnt: this.narrativeData.length },
      { key: 'high', label: '🚀 高质量', cnt: buckets.high.length },
      { key: 'mid', label: '📊 中质量', cnt: buckets.mid.length },
      { key: 'low', label: '📉 低质量', cnt: buckets.low.length },
      { key: 'unrated', label: '❓ 未评级', cnt: buckets.unrated.length },
      { key: 'superip', label: '★ 超级IP', cnt: this.narrativeData.filter(d => d.narrative?.narrativeSuperIp === 1).length },
      { key: 'slogan', label: '📣 口号票', cnt: this.narrativeData.filter(d => d.narrative?.narrativeSuperIpSlogan === 1).length }
    ];
    container.innerHTML = tabs.map(t => `
      <button class="nav-tab" role="tab" data-tab="${t.key}" aria-selected="${this.state.tab === t.key}">
        ${t.label} <span class="cnt">${t.cnt}</span>
      </button>`).join('');
  }

  renderChips() {
    const container = document.getElementById('cat-chips');
    if (!container) return;
    // 数据中出现的 token_category 聚合（C85；null=precheck fail/no_data →「未分类」）
    const counts = new Map();
    for (const d of this.narrativeData) {
      const cat = d.narrative?.token_category ?? '__null__';
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    const label = (cat) => cat === '__null__' ? '未分类'
      : cat.startsWith('event:') ? `事件${cat.slice(6)}`
      : (CATEGORY_LABELS[cat] || cat);
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    container.innerHTML = `<span class="text-xs text-gray-500 mr-1">叙事类型</span>` + entries.map(([cat, cnt]) => `
      <button class="cat-chip ${this.state.cats.has(cat) ? 'active' : ''}" data-cat="${esc(cat)}" title="${esc(cat === '__null__' ? 'null（precheck fail / no_data）' : cat)}">
        ${esc(label(cat))} ${cnt}
      </button>`).join('');
  }

  // ═══════════════ 筛选 + 排序 ═══════════════

  _tabMatch(d) {
    const r = d.narrative?.rating;
    switch (this.state.tab) {
      case 'high': return r === 3;
      case 'mid': return r === 2;
      case 'low': return r === 1;
      case 'unrated': return r !== 1 && r !== 2 && r !== 3;
      case 'superip': return d.narrative?.narrativeSuperIp === 1;
      case 'slogan': return d.narrative?.narrativeSuperIpSlogan === 1;
      default: return true;
    }
  }

  applyFilterAndSort() {
    const { cats, q, judge } = this.state;

    this.filteredData = this.narrativeData.filter(item => {
      if (!this._tabMatch(item)) return false;

      if (cats.size > 0) {
        const cat = item.narrative?.token_category ?? '__null__';
        if (!cats.has(cat)) return false;
      }

      if (judge !== 'all') {
        if (judge === 'none') {
          if (item.human_judge) return false;
        } else if (!item.human_judge || item.human_judge.category !== judge) {
          return false;
        }
      }

      if (q) {
        const sym = (item.token_symbol || '').toLowerCase();
        const addr = (item.token_address || '').toLowerCase();
        if (!sym.includes(q) && !addr.includes(q)) return false;
      }
      return true;
    });

    // 排序：null 一律沉底（两方向一致），有值按方向
    const dir = this.state.sortDir === 'asc' ? 1 : -1;
    const featOf = (item) => this.features.get(item.token_address);
    const valOf = (item) => {
      const f = featOf(item);
      switch (this.state.sortKey) {
        case 'max_change': return item.max_change_percent;
        case 'analyzed_at': {
          const t = new Date(item.narrative?.analyzed_at || 0).getTime();
          return isNaN(t) ? null : t;
        }
        case 'score': return f?.score ?? null;
        case 'mem': return f?.mem ?? null;
        case 'super_ip': return f?.superIpProb ?? null;
        default: return null;
      }
    };
    this.filteredData.sort((a, b) => {
      const av = valOf(a), bv = valOf(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;   // null 沉底
      if (bv == null) return -1;
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });

    this.renderTable();
  }

  // ═══════════════ 表格 ═══════════════

  toggleOpen(addr) {
    if (this.state.open.has(addr)) this.state.open.delete(addr);
    else this.state.open.add(addr);
    this.renderTable();
  }

  renderTable() {
    const tbody = document.getElementById('narrative-table-body');
    const emptyState = document.getElementById('empty-state');
    const shownEl = document.getElementById('shown-count');
    if (!tbody) return;

    if (shownEl) {
      shownEl.textContent = `显示 ${this.filteredData.length} / ${this.narrativeData.length} 票`
        + (this.roundsMap.size > 0 ? '' : '（轮次数据加载中/不可用）');
    }

    if (this.filteredData.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = this.filteredData.map(item => {
      const f = this.features.get(item.token_address) || {};
      const main = this.renderRow(item, f);
      const detail = this.state.open.has(item.token_address)
        ? `<tr class="detail-row"><td colspan="10">${this.renderDetail(item, f)}</td></tr>` : '';
      return main + detail;
    }).join('');
  }

  renderRow(item, f) {
    const ratingInfo = NARRATIVE_RATING_MAP[item.narrative.rating] || NARRATIVE_RATING_MAP[9];
    const scoreTxt = f.score != null ? `<div class="text-[10px] text-gray-500 font-mono">${fmtNum(f.score, 1)}</div>` : '';
    const ratingBadge = `
      <a href="/narrative-analyzer?address=${item.token_address}" target="_blank"
         class="rating-badge ${ratingInfo.class} hover:opacity-80 transition-opacity" title="narrative-analyzer 全详情">${ratingInfo.emoji} ${ratingInfo.label}</a>${scoreTxt}`;

    // 关键特征 chips
    const chips = [];
    const cat = item.narrative.token_category;
    if (cat) {
      const catLabel = cat.startsWith('event:') ? `E:${cat.slice(6)}` : (CATEGORY_LABELS[cat] || cat);
      chips.push(`<span class="feat-chip" title="叙事类型 ${esc(cat)}">${esc(catLabel)}</span>`);
    }
    if (item.narrative.narrativeSuperIp === 1) chips.push(`<span class="feat-chip feat-superip" title="超级IP（name_referent.super_ip ≥ 0.5，C88）">★超级IP</span>`);
    if (item.narrative.narrativeSuperIpSlogan === 1) chips.push(`<span class="feat-chip feat-slogan" title="口号票（五腿全中，C88）">📣口号</span>`);
    if (f.mem != null) {
      const cls = f.mem >= 2 ? 'feat-mem-hi' : 'feat-mem-lo';
      chips.push(`<span class="feat-chip ${cls}" title="口号性 referent_memeability（C88 mem 地板口径 ≥2）">mem ${f.mem}</span>`);
    }
    if (f.timing != null) chips.push(`<span class="feat-chip" title="时效 ${esc(f.timing)}">${TIMING_LABELS[f.timing] || esc(shortChoice(f.timing))}</span>`);
    if (f.tier) chips.push(`<span class="feat-chip" title="事件量级档 ${esc(f.tier)}">${esc(f.tier)}档</span>`);
    const featCell = chips.length ? chips.join('') : '<span class="text-gray-600 text-xs">-</span>';

    // 拦截点
    const blockCell = f.blockLabel
      ? `<span class="text-xs text-red-400" title="${esc(f.blockFull || f.blockLabel)}">${esc(f.blockLabel)}</span>`
      : '<span class="text-gray-600">—</span>';

    // 涨幅
    const mc = item.max_change_percent;
    const maxChange = mc != null
      ? `<span class="${mc > 0 ? 'text-green-400' : (mc < 0 ? 'text-red-400' : 'text-gray-400')}">${mc.toFixed(1)}%</span>` : '-';

    // 轮次（C84）
    const rounds = this.roundsMap.get((item.token_address || '').toLowerCase());
    const roundsCell = rounds ? `R${rounds.count}` : '<span class="text-gray-600">-</span>';

    const analyzedAt = item.narrative.analyzed_at
      ? new Date(item.narrative.analyzed_at).toLocaleString('zh-CN', {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        }) : '-';

    // 人工评级（保留旧逻辑）
    let judgeBadge = '';
    if (item.human_judge && item.human_judge.category) {
      const judgeInfo = HUMAN_JUDGE_MAP[item.human_judge.category];
      if (judgeInfo) {
        judgeBadge = `
          <span class="judge-badge ${judgeInfo.bgClass} ${judgeInfo.borderClass} ${judgeInfo.textClass}">${judgeInfo.emoji} ${judgeInfo.label}</span>
          <button class="judge-delete-btn ml-1 text-gray-400 hover:text-red-400 transition-colors" data-address="${item.token_address}" title="删除标注">✕</button>`;
      }
    }
    if (!judgeBadge) {
      judgeBadge = `
        <button class="judge-btn px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs text-white transition-colors"
                data-address="${item.token_address}" data-symbol="${esc(item.token_symbol)}" title="添加标注">+</button>`;
    }

    const platformLabel = item.platform === 'fourmeme' ? '4meme' : (item.platform || '-');
    const blockchain = item.blockchain || this.experimentData?.blockchain || 'bsc';
    const gmgnChain = ({ bsc: 'bsc', eth: 'eth', ethereum: 'eth', solana: 'sol', sol: 'sol', base: 'base' })[String(blockchain).toLowerCase()] || 'bsc';

    const openMark = this.state.open.has(item.token_address) ? '▾' : '▸';

    return `
      <tr class="table-row" data-addr="${item.token_address}">
        <td class="px-4 py-3">
          <div class="flex items-center">
            <span class="text-gray-500 mr-1 text-xs">${openMark}</span>
            <span class="font-medium text-white">${esc(item.token_symbol)}</span>
            <a href="https://gmgn.ai/${gmgnChain}/token/${item.token_address}" target="_blank" rel="noopener noreferrer"
               class="ml-2 text-gray-400 hover:text-purple-400 transition-colors" title="在 GMGN 查看">
              <img src="/static/gmgn.png" alt="GMGN" class="w-3 h-3">
            </a>
            <button class="addr-btn ml-2" data-addr="${item.token_address}" title="点击复制合约地址">${item.token_address.slice(0, 8)}…${item.token_address.slice(-4)}</button>
          </div>
        </td>
        <td class="px-3 py-3 text-center text-gray-400 text-xs">${esc(platformLabel)}</td>
        <td class="px-3 py-3 text-center">${ratingBadge}</td>
        <td class="px-3 py-3 text-left">${featCell}</td>
        <td class="px-3 py-3 text-left">${blockCell}</td>
        <td class="px-3 py-3 text-right font-medium">${maxChange}</td>
        <td class="px-3 py-3 text-center text-gray-400 text-xs">${roundsCell}</td>
        <td class="px-3 py-3 text-center text-gray-400 text-xs">${analyzedAt}</td>
        <td class="px-3 py-3 text-center">${judgeBadge}</td>
        <td class="px-4 py-3 text-center">
          <div class="action-links">
            <a href="/token-holders?experiment=${this.experimentId}&token=${item.token_address}" target="_blank" class="action-link text-cyan-400 hover:text-cyan-300">持有者</a>
            <a href="/token-detail?experiment=${this.experimentId}&address=${item.token_address}" target="_blank" class="action-link text-indigo-400 hover:text-indigo-300">详情</a>
          </div>
        </td>
      </tr>`;
  }

  // ═══════════════ 展开明细 ═══════════════

  _stageDot(stage) {
    if (!stage) return '<span class="stage-dot skip" title="未执行"></span>';
    if (stage.__clear) return '<span class="stage-dot skip" title="前置拦截未执行"></span>';
    const pass = stagePayload(stage)?.pass ?? stage.pass;
    return pass === false
      ? '<span class="stage-dot fail" title="拦截"></span>'
      : '<span class="stage-dot pass" title="通过"></span>';
  }

  _kv(k, v, title) {
    if (v == null || v === '') return '';
    return `<div class="kv"><span class="k">${esc(k)}</span><span class="v" ${title ? `title="${esc(title)}"` : ''}>${esc(v)}</span></div>`;
  }

  renderDetail(item, f) {
    const na = item.narrative?.llmAnalysis || {};
    const blockchain = item.blockchain || this.experimentData?.blockchain || 'bsc';
    const gmgnChain = ({ bsc: 'bsc', eth: 'eth', ethereum: 'eth', solana: 'sol', sol: 'sol', base: 'base' })[String(blockchain).toLowerCase()] || 'bsc';

    // ── 管线 6 段 ──
    const pc = na.preCheck;
    const precheckCard = `
      <div class="stage-card">
        <div class="stage-title"><span>① Precheck 纯规则</span>${this._stageDot(pc ? { pass: pc.pass } : null)}</div>
        ${pc ? (this._kv('规则', pc.details?.ruleName) + this._kv('评级', pc.rating) + this._kv('原因', pc.reason)) : '<div class="text-xs text-gray-500">未触发（直通标准路径）</div>'}
      </div>`;

    const ps = na.prestage;
    const psPo = stagePayload(ps);
    const prestageCard = `
      <div class="stage-card">
        <div class="stage-title"><span>② Prestage 自发判定</span>${this._stageDot(ps)}</div>
        ${ps ? (this._kv('类型', psPo?.tokenType || ps.category) + this._kv('评级', psPo?.rating ?? ps.rating) + this._kv('基线', psPo?.baselineMet == null ? null : (psPo.baselineMet ? '达标' : '未达标')) + this._kv('原因', psPo?.reason ?? ps.reason)) : '<div class="text-xs text-gray-500">未走 prestage（标准路径）</div>'}
      </div>`;

    const s1 = na.stage1;
    const s1j = stagePayload(s1)?.jev;
    const s1Audit = [];
    if (s1j?.categoryForced) s1Audit.push('cashtag改道W');
    if (s1j?.publisherProxyActive) s1Audit.push('发布者代理J1.18');
    if (s1j?.tierAnchored) s1Audit.push(`指代锚${s1j.tierAnchored}`);
    if (s1j?.web3FitAnchored) s1Audit.push(`W3偏好锚${s1j.web3FitAnchored}`);
    if (s1j?.angleTimingOverride) s1Audit.push('找角度时效C68');
    if (s1j?.staleSourceOverride) s1Audit.push('源头陈旧C75');
    if (s1j?.tweetType) s1Audit.push(`载体:${s1j.tweetType}`);
    const stage1Card = `
      <div class="stage-card">
        <div class="stage-title"><span>③ Jev 分类（Stage1）</span>${this._stageDot(s1)}</div>
        ${s1 ? (this._kv('类别', s1.category) + this._kv('量级档', s1j?.magnitudeTier) + this._kv('时效', s1j?.timing, s1j?.timing) + this._kv('载体', s1j?.tweetType) + (s1Audit.length ? this._kv('审计', s1Audit.join('｜')) : '')) : '<div class="text-xs text-gray-500">未执行</div>'}
      </div>`;

    const s2 = na.stage2;
    const s2po = stagePayload(s2);
    const s2j = s2po?.jev;
    const sr = s2po?.scoringResult;
    const s2IsW = sr?.category === 'W';
    const s2Audit = [];
    if (s2j?.wInteractionExempt) s2Audit.push('W交互豁免C42');
    if (s2j?.instagramDim2Anchor) s2Audit.push('IG锚C44');
    if (s2j?.productEntityBinanceExempt) s2Audit.push('币安豁免C55');
    if (s2j?.rcpPlatformExempt) s2Audit.push('平台官方豁免C56');
    if (s2j?.publisherProxyActive) s2Audit.push('发布者代理J1.18');
    if (s2j?.resonanceDamp) s2Audit.push(`感染力折损×${s2j.resonanceDamp.coef}(C80)`);
    if (s2j?.memFloorBlock) s2Audit.push(`mem地板拦截(${s2j.memFloorBlock.mem})`);
    const stage2Card = `
      <div class="stage-card">
        <div class="stage-title"><span>④ Jev 评分（Stage2）</span>${this._stageDot(s2)}</div>
        ${s2 ? (this._kv('总分', sr?.totalScore != null ? `${sr.totalScore}（pass线60）` : null)
          + (s2IsW
            ? this._kv('W 产品分', sr?.wProductScore) + this._kv('W 交互分', sr?.wInteractionScore)
            : this._kv('事件分', sr?.tierScore) + this._kv('传播分', sr?.dimension2))
          + this._kv('时效分', sr?.timeliness)
          + this._kv('拦截', s2po?.blockReason)
          + (s2Audit.length ? this._kv('审计', s2Audit.join('｜')) : '')
          + this._kv('算式', s2po?.reason)) : '<div class="text-xs text-gray-500">未执行</div>'}
      </div>`;

    const s3 = na.stage3;
    const s3po = stagePayload(s3);
    const s3j = s3po?.jev;
    const s3Audit = [];
    if (s3j?.punExempt) s3Audit.push('戏谑豁免J1.24');
    if (s3j?.imgNameExempt) s3Audit.push('名图一致豁免J1.30');
    if (s3j?.superIpSloganExempt) s3Audit.push(`口号票豁免C88(mem ${s3j.superIpSloganExempt.mem})`);
    if (s3j?.spellingMismatch) s3Audit.push(`图文名不符C78(${s3j.spellingMismatch.variant})`);
    const stage3Card = `
      <div class="stage-card">
        <div class="stage-title"><span>⑤ Jev 计分（Stage3）</span>${this._stageDot(s3)}</div>
        ${s3 ? (s3.__clear
          ? '<div class="text-xs text-gray-500">Stage2 拦截未执行</div>'
          : (this._kv('关联分', s3po?.relevanceScore != null ? `${s3po.relevanceScore}（${s3j?.relevanceType ?? '-'}/lv${s3j?.relevanceLevelIdx ?? '-'}）` : null)
            + this._kv('质量分', s3po?.qualityScore != null && s3po.breakdown ? `${s3po.qualityScore}（长${s3po.breakdown.length}+拼${s3po.breakdown.spelling}+合${s3po.breakdown.reasonability}）` : null)
            + this._kv('总分', s3po?.total_score)
            + this._kv('档位', s3po?.category_agg)
            + this._kv('拦截', s3po?.blockReason)
            + (s3Audit.length ? this._kv('豁免', s3Audit.join('｜')) : ''))) : '<div class="text-xs text-gray-500">未执行</div>'}
      </div>`;

    const sf = na.stageFinal;
    const finalCard = `
      <div class="stage-card">
        <div class="stage-title"><span>⑥ 终评</span>${sf ? (sf.blockReason ? '<span class="stage-dot fail"></span>' : '<span class="stage-dot pass"></span>') : '<span class="stage-dot skip"></span>'}</div>
        ${sf ? (this._kv('档位', sf.category) + this._kv('总分', sf.totalScore) + this._kv('事件分', sf.eventScore) + this._kv('关联分', sf.relevanceScore) + this._kv('质量分', sf.qualityScore) + this._kv('Stage2总分', sf.stage2TotalScore) + this._kv('拦截', sf.blockReason)) : '<div class="text-xs text-gray-500">未执行</div>'}
      </div>`;

    // ── Jev 关键答案（stage1 概率 + answers 直读）──
    const ans = f.answers || {};
    const probs = s1j?.probabilities || {};
    const probTop = (p) => {
      if (!p) return null;
      const entries = Object.entries(p).sort((a, b) => b[1] - a[1]);
      return entries.length ? `${entries[0][0]} ${Math.round(entries[0][1] * 100)}%` : null;
    };
    const ansRows = [
      this._kv('事件类别', f.eventCategory, probTop(probs.event_category)),
      this._kv('量级档', f.tier, probTop(probs.event_magnitude)),
      this._kv('名称指代', f.nameReferent, probTop(probs.name_referent)),
      this._kv('super_ip 概率', f.superIpProb != null ? `${Math.round(f.superIpProb * 100)}%` : null),
      this._kv('口号性 mem', f.mem),
      this._kv('时效', f.timing),
      this._kv('Web3 适配', f.strongFit != null ? `strong_fit ${Math.round(f.strongFit * 100)}%` : null, probTop(probs.web3_fit)),
      this._kv('拦截原因', f.blockChoice, probTop(probs.block_reason)),
      this._kv('主体实体', f.subjectEntity ?? s2j?.subjectEntity, probTop(probs.subject_entity)),
      this._kv('形象载体', f.subjectCarrier ?? s2j?.subjectCarrier),
      this._kv('感染力', f.eventResonance ?? s2j?.eventResonance)
    ].join('');

    // ── C88 审计盒 ──
    const sip = s2j?.superIpSlogan;
    const c88Box = sip
      ? `<div class="audit-box" title="C88 超级IP口号票五腿审计（stage2 jev.superIpSlogan 恒落）">
          ★ C88 口号票五腿：hit=${sip.hit ? '<b class="text-green-400">TRUE</b>' : 'false'} ｜
          superIp ${sip.superIp} ｜ rel+ ${sip.relPositive} ｜ relNone ${sip.relNone} ｜
          mem ${sip.mem} ｜ timing ${esc(sip.timing ?? '-')} ｜ strongFit ${sip.strongFit}
          ${s2j?.memFloorBlock ? `｜<br>mem 地板拦截：mem ${s2j.memFloorBlock.mem} timing ${esc(s2j.memFloorBlock.timing ?? '-')}` : ''}
        </div>`
      : '';

    // ── 涨幅面板 ──
    const mc = item.max_change_percent;
    const fc = item.final_change_percent;
    const pm = item.peak_mcap_usd;
    const gainPanel = `
      <div class="stage-card">
        <div class="stage-title"><span>📈 涨幅面板（token_profiles）</span></div>
        ${this._kv('最高涨幅', mc != null ? `${mc.toFixed(1)}%` : null)}
        ${this._kv('最终涨幅', fc != null ? `${fc.toFixed(1)}%` : null)}
        ${this._kv('峰值市值', pm != null ? `$${Number(pm).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : null)}
        ${mc == null && fc == null && pm == null ? '<div class="text-xs text-gray-500">无分类管线数据</div>' : ''}
      </div>`;

    // ── C84 轮次表 ──
    const rounds = this.roundsMap.get((item.token_address || '').toLowerCase());
    let roundsPanel = '';
    if (rounds && rounds.rows.length) {
      const rowsHtml = rounds.rows.map(r => {
        const lead = r.started_at && r.completed_at
          ? `${((new Date(r.completed_at) - new Date(r.started_at)) / 1000).toFixed(1)}s` : '-';
        const ratingTxt = r.rating != null ? (NARRATIVE_RATING_MAP[r.rating]?.label || r.rating) : (r.error ? '失败' : '-');
        return `<tr>
          <td>R${r.round_no}</td>
          <td>${esc(r.trigger_reason || '-')}</td>
          <td>${ratingTxt}${r.error ? `<span class="text-red-400" title="${esc(r.error)}"> ⚠</span>` : ''}</td>
          <td>${r.from_cache ? '缓存' : '真跑'}</td>
          <td>${lead}</td>
          <td>${r.completed_at ? new Date(r.completed_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}</td>
        </tr>`;
      }).join('');
      roundsPanel = `
        <div class="detail-label">🔁 叙事分析轮次（C84 留痕，共 ${rounds.count} 轮）</div>
        <div class="overflow-x-auto"><table class="mini-table">
          <thead><tr><th>轮次</th><th>发起原因</th><th>评级</th><th>来源</th><th>耗时</th><th>完成时间</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>`;
    }

    // ── 终评 reason 全文 ──
    const reasonFull = na.summary?.reason
      ? `<div class="detail-label">📝 终评算式全文</div><div class="reason-text">${esc(na.summary.reason)}</div>` : '';

    return `
      <div class="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-2">
        ${precheckCard}${prestageCard}${stage1Card}${stage2Card}${stage3Card}${finalCard}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-1">
        <div class="stage-card">
          <div class="stage-title"><span>🧠 Jev 关键答案</span></div>
          ${ansRows || '<div class="text-xs text-gray-500">无标准题集答案（prestage/precheck 路径）</div>'}
        </div>
        <div>
          ${c88Box}
          ${gainPanel}
        </div>
        <div class="stage-card">
          <div class="stage-title"><span>🔗 跳转</span></div>
          <div class="flex flex-col gap-1 text-xs">
            <a href="/narrative-analyzer?address=${item.token_address}" target="_blank" class="text-purple-400 hover:text-purple-300">→ narrative-analyzer 全详情（语料/题集/图谱）</a>
            <a href="https://gmgn.ai/${gmgnChain}/token/${item.token_address}" target="_blank" rel="noopener noreferrer" class="text-purple-400 hover:text-purple-300">→ GMGN 行情</a>
            <a href="/token-holders?experiment=${this.experimentId}&token=${item.token_address}" target="_blank" class="text-cyan-400 hover:text-cyan-300">→ 持有者分析</a>
            <a href="/token-detail?experiment=${this.experimentId}&address=${item.token_address}" target="_blank" class="text-indigo-400 hover:text-indigo-300">→ 代币详情</a>
            <a href="/token-ticks?token=${item.token_address}" target="_blank" class="text-gray-400 hover:text-gray-300">→ 全历史 ticks</a>
          </div>
          ${this._kv('合约地址', item.token_address)}
          ${this._kv('发现时间', item.discovered_at ? new Date(item.discovered_at).toLocaleString('zh-CN') : null)}
        </div>
      </div>
      ${roundsPanel}
      ${reasonFull}
    `;
  }

  // ═══════════════ 操作 ═══════════════

  copyAddress(btn) {
    const addr = btn.dataset.addr;
    const restore = () => {
      btn.textContent = `${addr.slice(0, 8)}…${addr.slice(-4)}`;
      btn.classList.remove('copied');
    };
    const ok = () => {
      btn.textContent = '已复制';
      btn.classList.add('copied');
      setTimeout(restore, 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(addr).then(ok).catch(() => {
        // 非 secure context 兜底：选中文本供手动复制
        const range = document.createRange();
        range.selectNodeContents(btn);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        btn.textContent = '已选中';
        btn.classList.add('copied');
        setTimeout(restore, 1500);
      });
    }
  }

  openJudgeModal(tokenAddress, symbol) {
    this.currentEditingToken = tokenAddress;
    const modal = document.getElementById('judge-modal');
    const symbolEl = document.getElementById('modal-token-symbol');
    const addressEl = document.getElementById('modal-token-address');
    const noteEl = document.getElementById('judge-note');

    if (symbolEl) symbolEl.textContent = symbol || tokenAddress;
    if (addressEl) addressEl.textContent = tokenAddress;

    const judgeData = this.narrativeData.find(item => item.token_address === tokenAddress)?.human_judge;
    document.querySelectorAll('input[name="judge-category"]').forEach(radio => {
      radio.checked = radio.value === (judgeData?.category || '');
    });
    if (noteEl) noteEl.value = judgeData?.note || '';
    if (modal) modal.classList.remove('hidden');
  }

  closeJudgeModal() {
    const modal = document.getElementById('judge-modal');
    if (modal) modal.classList.add('hidden');
    document.querySelectorAll('input[name="judge-category"]').forEach(radio => { radio.checked = false; });
    const noteEl = document.getElementById('judge-note');
    if (noteEl) noteEl.value = '';
    this.currentEditingToken = null;
  }

  async saveJudge() {
    if (!this.currentEditingToken) return;
    const selectedRadio = document.querySelector('input[name="judge-category"]:checked');
    if (!selectedRadio) { alert('请选择一个分类'); return; }

    const noteEl = document.getElementById('judge-note');
    try {
      const response = await fetch(`/api/experiment/${this.judgeExperimentId}/tokens/${this.currentEditingToken}/judge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: selectedRadio.value, note: noteEl?.value || '' })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '保存失败');

      const item = this.narrativeData.find(i => i.token_address === this.currentEditingToken);
      if (item) item.human_judge = result.data.human_judges;

      this.closeJudgeModal();
      this.renderTable();
    } catch (error) {
      console.error('保存标注失败:', error);
      alert('保存失败: ' + error.message);
    }
  }

  async deleteJudge(tokenAddress) {
    if (!confirm('确定要删除这个标注吗？')) return;
    try {
      const response = await fetch(`/api/experiment/${this.judgeExperimentId}/tokens/${tokenAddress}/judge`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '删除失败');

      const item = this.narrativeData.find(i => i.token_address === tokenAddress);
      if (item) delete item.human_judge;
      this.renderTable();
    } catch (error) {
      console.error('删除标注失败:', error);
      alert('删除失败: ' + error.message);
    }
  }

  // ═══════════════ 三态 ═══════════════

  updateSortButtons() {
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sort === this.state.sortKey);
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

// ═══════════════ 特征提取（纯函数，加载后一次算好）═══════════════
//
// 数据形状真相源：jev-result-mapper.mjs（mapper 形状）+ NarrativeAnalyzer
// buildStageSaveData（落库转换：parsed_output 整包 → details 键）——DB 行信封
// = {rating, pass, reason, category, score, details:{pass, blockReason, jev:{...}}}；
// stage3 拦截票 = {__clear:true}（顶层）；raw_output = JSON.stringify({answers, usage})。
// 旧行缺键 → 对应字段 null（诚实显 `-`），parse 失败不抛。
function extractFeatures(item) {
  const na = item.narrative?.llmAnalysis || {};
  const f = {
    rating: item.narrative?.rating ?? null,
    score: na.summary?.score ?? null,
    category: item.narrative?.token_category ?? null,
    superIpProb: null, mem: null, timing: null, tier: null,
    eventCategory: null, nameReferent: null, blockChoice: null,
    strongFit: null, subjectEntity: null, subjectCarrier: null, eventResonance: null,
    answers: null, blockLabel: null, blockFull: null
  };

  // stage2：C88 五腿审计恒落（旧行缺键 → null）；payload 双形状（details 落库信封
  // / parsed_output 内存形状，superip-labels._stagePayload 同款口径）
  const s2j = stagePayload(na.stage2)?.jev;
  if (s2j) {
    const sip = s2j.superIpSlogan;
    if (sip && typeof sip === 'object') {
      f.mem = sip.mem ?? null;
      f.timing = sip.timing ?? null;
      f.superIpProb = sip.superIp ?? null;
      f.strongFit = sip.strongFit ?? null;
    }
  }

  // stage1 概率带 + raw answers 兜底（C88 前旧行）
  const s1j = stagePayload(na.stage1)?.jev;
  const probs = s1j?.probabilities || {};
  if (f.superIpProb == null && probs.name_referent) f.superIpProb = probs.name_referent.super_ip ?? null;
  if (f.strongFit == null && probs.web3_fit) f.strongFit = probs.web3_fit.strong_fit ?? null;

  const raw = na.stage1?.rawOutput;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const answers = parsed?.answers || null;
      if (answers) {
        f.answers = answers;
        if (f.mem == null) f.mem = answers.referent_memeability?.score ?? null;
        if (f.timing == null) f.timing = answers.event_timing?.choice ?? null;
        f.eventCategory = answers.event_category?.choice ?? null;
        f.nameReferent = answers.name_referent?.choice ?? null;
        f.blockChoice = answers.block_reason?.choice ?? null;
        if (f.strongFit == null) f.strongFit = answers.web3_fit?.probabilities?.strong_fit ?? null;
        if (f.subjectEntity == null) f.subjectEntity = answers.subject_entity?.choice ?? null;
        if (f.subjectCarrier == null) f.subjectCarrier = answers.subject_carrier?.choice ?? null;
        if (f.eventResonance == null) f.eventResonance = answers.event_resonance?.choice ?? null;
      }
    } catch { /* 旧行/坏行：对应字段保持 null */ }
  }

  f.tier = s2j?.magnitudeTier ?? s1j?.magnitudeTier ?? answersTier(f.answers) ?? null;

  // 拦截点定位（优先级：precheck → mem地板 → stage2 → stage3 → prestage fail）
  const pc = na.preCheck;
  const s2po = stagePayload(na.stage2);
  const s3po = stagePayload(na.stage3);
  if (pc && pc.pass === false) {
    f.blockLabel = `pre:${pc.details?.ruleName || '?'}`;
    f.blockFull = pc.reason || null;
  } else if (s2j?.memFloorBlock) {
    f.blockLabel = 'mem地板(C88)';
    f.blockFull = `mem=${s2j.memFloorBlock.mem} timing=${s2j.memFloorBlock.timing}`;
  } else if (s2po && s2po.pass === false) {
    f.blockLabel = 'S2:' + (s2po.blockReason || '拦截');
    f.blockFull = s2po.reason || s2po.blockReason || null;
  } else if (s3po && s3po.pass === false) {
    f.blockLabel = 'S3:' + (s3po.blockReason || '拦截');
  } else if (na.prestage && na.prestage.pass === false) {
    f.blockLabel = 'prestage';
    f.blockFull = stagePayload(na.prestage)?.reason || na.prestage.reason || null;
  }

  return f;
}

function answersTier(answers) {
  return answers?.event_magnitude?.score ?? null;
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new ExperimentNarrative();
});
