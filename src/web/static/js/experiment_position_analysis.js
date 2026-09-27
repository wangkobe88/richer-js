/**
 * 持仓分析页面逻辑（TokenPositionAnalyzer 落表结果展示；pumpfun 回迁批 4 web 展示）
 * 列表（verdict/分类过滤）+ 持仓因子弹窗（全部 holding_factors 实际值，未通过条件标红）。
 *
 * 数据全部来自列表 API（getAnalyses 已返回 holding_factors + block_reasons），
 * 弹窗纯前端组装，无需详情 API。
 *
 * BSC 适配：触发快照 buyBnb/currentPriceBnb/blockDiff（blocks 触发口径）；GMGN bsc 外链；
 * 本实验交易记录走 /trades#token=（richer-js 无独立 token-trades 页）。
 */

// verdict 收口 zhuang_score（tokenScore + 庄散比）。block_reasons 为自描述字符串
// （如 `TPAPre_tokenScore > 2（实际 1.5）`），弹窗展示全部 holding_factors 实际值，
// 并用 block_reasons 提取的未通过因子 key 做行高亮。旧实验 JSONB 行可能仍含已删因子（历史快照）。

// 离线/OPB 代币分类映射（token_profiles.category，richer-js 8 类 + neutral 兜底）
// source=offline（build-token-profiles 离线）/ online（OPB 实时），崩盘后定性，区别于 TPA 的 as-of 判定。
const TOKEN_PROFILE_MAP = {
  wash:          { label: '流水盘',     emoji: '🗑️', colorClass: 'text-red-400',     bgClass: 'bg-red-900',     borderClass: 'border-red-700' },
  high_mcap_wash:{ label: '高市值流水', emoji: '⚠️', colorClass: 'text-yellow-400',  bgClass: 'bg-yellow-900',  borderClass: 'border-yellow-700' },
  pump_dump:     { label: '拉高出货',   emoji: '📉', colorClass: 'text-orange-400',  bgClass: 'bg-orange-900',  borderClass: 'border-orange-700' },
  high_mcap:     { label: '高市值',     emoji: '💎', colorClass: 'text-emerald-400', bgClass: 'bg-emerald-900', borderClass: 'border-emerald-700' },
  quality:       { label: '高质量',     emoji: '🚀', colorClass: 'text-green-400',   bgClass: 'bg-green-900',   borderClass: 'border-green-700' },
  normal:        { label: '普通',       emoji: '📊', colorClass: 'text-blue-400',    bgClass: 'bg-blue-900',    borderClass: 'border-blue-700' },
  low_quality:   { label: '低质量',     emoji: '💤', colorClass: 'text-gray-400',    bgClass: 'bg-gray-700',    borderClass: 'border-gray-600' },
  low_activity:  { label: '低活跃',     emoji: '🔇', colorClass: 'text-cyan-400',    bgClass: 'bg-cyan-900',    borderClass: 'border-cyan-700' },
  neutral:       { label: '未知',       emoji: '❓', colorClass: 'text-gray-500',    bgClass: 'bg-gray-800',    borderClass: 'border-gray-700' },
};

class ExperimentPositionAnalysis {
  constructor() {
    this.experimentId = null;
    this.analyses = [];
    this.init();
  }

  async init() {
    // 从 URL 提取实验 ID
    const parts = window.location.pathname.split('/');
    const idx = parts.indexOf('experiment');
    if (idx !== -1 && parts[idx + 1]) this.experimentId = parts[idx + 1];
    if (!this.experimentId) { this.showError('缺少实验 ID'); return; }

    // 导航 tab 链接
    const baseUrl = `/experiment/${this.experimentId}`;
    const setHref = (id, href) => { const el = document.getElementById(id); if (el) el.href = href; };
    setHref('link-detail', baseUrl);
    setHref('link-signals', `${baseUrl}/signals`);
    setHref('link-trades', `${baseUrl}/trades`);
    setHref('link-strategy-analysis', `${baseUrl}/strategy-analysis`);

    this.buildProfileFilter();
    document.getElementById('verdictFilter').addEventListener('change', () => this.loadList());
    document.getElementById('profileCategoryFilter').addEventListener('change', () => this.loadList());
    document.getElementById('limitSelect').addEventListener('change', () => this.loadList());
    // 搜索框：输入防抖 400ms 后查询（代币地址 ilike 后端模糊匹配）
    let searchTimer;
    document.getElementById('searchInput').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => this.loadList(), 400);
    });
    // 表达式过滤框：输入防抖 600ms（比地址搜索重，后端需全量取行内存 ConditionEvaluator 求值）
    let exprTimer;
    const exprInput = document.getElementById('expressionInput');
    if (exprInput) {
      exprInput.addEventListener('input', () => {
        clearTimeout(exprTimer);
        exprTimer = setTimeout(() => this.loadList(), 600);
      });
    }
    // 可用因子说明面板折叠
    const exprToggle = document.getElementById('exprFactorToggle');
    if (exprToggle) {
      exprToggle.addEventListener('click', () => {
        document.getElementById('exprFactorPanel')?.classList.toggle('hidden');
      });
    }
    document.getElementById('refreshBtn').addEventListener('click', () => this.loadList());
    document.getElementById('backBtn').addEventListener('click', () => {
      window.location.href = baseUrl;
    });

    // 弹窗关闭：关闭按钮 + 点击遮罩 + ESC
    const modal = document.getElementById('factor-modal');
    document.getElementById('factor-modal-close').addEventListener('click', () => this.closeFactorModal());
    modal.addEventListener('click', (e) => { if (e.target === modal) this.closeFactorModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeFactorModal(); });

    await this.loadList();
  }

  async loadList() {
    const verdict = document.getElementById('verdictFilter').value;
    const profileCategory = document.getElementById('profileCategoryFilter').value;
    const limit = document.getElementById('limitSelect').value;
    const search = document.getElementById('searchInput').value.trim();
    const expression = (document.getElementById('expressionInput')?.value || '').trim();
    const params = new URLSearchParams({ experimentId: this.experimentId, limit });
    if (verdict) params.set('verdict', verdict);
    if (profileCategory) params.set('profileCategory', profileCategory);
    if (search) params.set('search', search);
    if (expression) params.set('expression', expression);

    try {
      const resp = await fetch(`/api/experiment/position-analysis?${params}`);
      const result = await resp.json();
      if (!result.success) throw new Error(result.error || '加载失败');
      this.analyses = result.data.analyses || [];
      this.filteredTotal = result.data.filteredTotal ?? null;
      this.verdictCondition = result.data.verdictCondition || null;
      this.renderExprError(result.data.exprError || null);
      this.renderSummary(result.data.summary);
      this.renderCategoryBreakdown(result.data.summary);
      this.renderEnforceBadge();
      this.renderHint(profileCategory);
      this.renderList();
    } catch (e) {
      this.showError(e.message);
    }
  }

  // 表达式语法错误提示（输入框下方红字）；无错误则隐藏。exprError 由后端 getAnalyses 解析失败时结构化返回。
  renderExprError(err) {
    const el = document.getElementById('exprErrorHint');
    if (!el) return;
    el.textContent = err ? `表达式语法错误：${err}` : '';
    el.classList.toggle('hidden', !err);
  }

  renderSummary(summary) {
    const card = document.getElementById('summaryCard');
    if (!summary) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const s = summary;
    const blockRate = s.total > 0 ? ((s.block / s.total) * 100).toFixed(1) : '0.0';
    const items = [
      { label: '总分析', value: s.total, border: 'border-gray-600' },
      { label: 'approve', value: s.approve, border: 'border-green-700' },
      { label: 'block', value: s.block, border: 'border-red-700' },
      { label: 'block 率', value: blockRate + '%', border: 'border-red-700' },
    ];
    document.getElementById('summaryGrid').innerHTML = items.map(it =>
      `<div class="bg-gray-700 bg-opacity-40 rounded-lg p-3 border ${it.border}">
        <div class="text-xs text-gray-400">${it.label}</div>
        <div class="text-xl font-bold text-white mt-1 font-mono">${it.value}</div>
      </div>`
    ).join('');
  }

  // 离线/OPB 分类统计：两个核心指标卡（高市值通过率 / 通过代币中的流水盘占比）+ 分类明细表。
  // 数据来自后端 summary.categories（{cat:{total,approve,block}}）+ summary.coreMetrics。
  renderCategoryBreakdown(summary) {
    const card = document.getElementById('categoryCard');
    if (!summary || !summary.categories) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');

    const cm = summary.coreMetrics || {};
    const pct = (v) => (v == null ? '—' : v + '%');
    document.getElementById('coreMetrics').innerHTML = [
      `<div class="bg-gray-700 bg-opacity-40 rounded-md px-3 py-2 border border-emerald-800">
        <div class="flex items-baseline gap-2">
          <span class="text-xl font-bold text-emerald-400 font-mono">${pct(cm.highMcapPassRate)}</span>
          <span class="text-xs text-gray-400">高市值通过率</span>
        </div>
        <div class="text-[11px] text-gray-500 mt-0.5">${cm.highMcapTotal || 0} 个高市值 · 应放行 ↑</div>
      </div>`,
      `<div class="bg-gray-700 bg-opacity-40 rounded-md px-3 py-2 border border-red-800">
        <div class="flex items-baseline gap-2">
          <span class="text-xl font-bold text-red-400 font-mono">${pct(cm.washShareOfApproved)}</span>
          <span class="text-xs text-gray-400">通过中流水盘占比</span>
        </div>
        <div class="text-[11px] text-gray-500 mt-0.5">${cm.washApproved || 0}/${cm.approveAll || 0} 通过 · 应拦截 ↓</div>
      </div>`,
    ].join('');

    // 分类明细表：按 TOKEN_PROFILE_MAP 顺序 + 末尾未分类行
    const order = ['wash', 'high_mcap_wash', 'pump_dump', 'high_mcap', 'quality', 'normal', 'low_quality', 'low_activity', 'neutral'];
    const cats = summary.categories || {};
    const approveAll = cm.approveAll || 0;
    const rows = order
      .filter(k => cats[k] && cats[k].total > 0)
      .map(k => this._categoryRow(k, cats[k], approveAll))
      .join('');
    const unclassified = cats['__unclassified__'];
    const unclassifiedRow = (unclassified && unclassified.total > 0)
      ? this._categoryRow('__unclassified__', unclassified, approveAll)
      : '';
    document.getElementById('categoryTbody').innerHTML = rows + unclassifiedRow || '<tr><td colspan="6" class="px-3 py-4 text-center text-gray-500">无分类数据</td></tr>';
  }

  // 单行分类明细：badge + total/approve/block/通过率%。高市值行绿调、wash 行红调强调。
  _categoryRow(key, c, approveAll) {
    const m = key === '__unclassified__'
      ? { label: '未分类', emoji: '⬜', colorClass: 'text-gray-400', bgClass: 'bg-gray-800', borderClass: 'border-gray-700' }
      : (TOKEN_PROFILE_MAP[key] || TOKEN_PROFILE_MAP.neutral);
    const passRate = c.total > 0 ? ((c.approve / c.total) * 100).toFixed(1) + '%' : '—';
    const passShare = approveAll > 0 ? ((c.approve / approveAll) * 100).toFixed(1) + '%' : '—';
    return `<tr class="hover:bg-gray-700 hover:bg-opacity-30 transition-colors">
      <td class="px-3 py-1.5 whitespace-nowrap"><span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium border ${m.colorClass} ${m.bgClass} ${m.borderClass}">${m.emoji} ${m.label}</span></td>
      <td class="px-3 py-1.5 text-right text-gray-200 font-mono">${c.total}</td>
      <td class="px-3 py-1.5 text-right text-green-400 font-mono">${c.approve}</td>
      <td class="px-3 py-1.5 text-right text-red-400 font-mono">${c.block}</td>
      <td class="px-3 py-1.5 text-right text-gray-200 font-mono">${passRate}</td>
      <td class="px-3 py-1.5 text-right text-gray-200 font-mono">${passShare}</td>
    </tr>`;
  }

  // enforce 徽章：取首行 enforce 字段（同实验同 run 一致）。无数据则隐藏。
  renderEnforceBadge() {
    const badge = document.getElementById('enforceBadge');
    if (!badge) return;
    const first = this.analyses[0];
    if (!first || first.enforce == null) { badge.classList.add('hidden'); return; }
    badge.classList.remove('hidden');
    if (first.enforce) {
      badge.className = 'ml-2 px-2 py-1 rounded text-xs font-semibold bg-red-900 text-red-300 border border-red-700';
      badge.textContent = 'enforce（block=拦截买入）';
    } else {
      badge.className = 'ml-2 px-2 py-1 rounded text-xs font-semibold bg-gray-700 text-gray-300 border border-gray-600';
      badge.textContent = 'shadow（只记录不拦截）';
    }
  }

  // 离线/OPB 分类筛选下拉：选项复用 TOKEN_PROFILE_MAP（与单元格 label/emoji 一致，单一来源），
  // JS 动态填充避免 HTML 重复维护。顺序：wash 系（操纵）→ 正面 → 普通/低 → 未分类。
  buildProfileFilter() {
    const sel = document.getElementById('profileCategoryFilter');
    if (!sel) return;
    const order = ['wash', 'high_mcap_wash', 'pump_dump', 'high_mcap', 'quality', 'normal', 'low_quality', 'low_activity', 'neutral'];
    const opts = order.map(k => {
      const m = TOKEN_PROFILE_MAP[k];
      return `<option value="${k}">${m.emoji} ${m.label} (${k})</option>`;
    }).join('');
    sel.innerHTML = `<option value="">全部</option>${opts}<option value="__unclassified__">⬜ 未分类（无 OPB 定性）</option>`;
  }

  // OPB 筛选提示：filteredTotal 是该类别在全实验（叠加 verdict/category/search 后）的总条数，不受分页影响；
  // 当前页只展示其中一段。未筛 OPB 时不显示。
  renderHint(profileCategory) {
    const el = document.getElementById('profileFilterHint');
    if (!el) return;
    if (!profileCategory) { el.textContent = ''; return; }
    const label = profileCategory === '__unclassified__'
      ? '未分类'
      : (TOKEN_PROFILE_MAP[profileCategory] ? `${TOKEN_PROFILE_MAP[profileCategory].emoji} ${TOKEN_PROFILE_MAP[profileCategory].label}` : profileCategory);
    el.textContent = this.filteredTotal != null ? `· 离线/OPB=${label}：共 ${this.filteredTotal} 条` : '';
  }

  renderList() {
    const tbody = document.getElementById('tokenTbody');
    const empty = document.getElementById('listEmpty');
    this.hideError();
    if (!this.analyses.length) {
      tbody.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    tbody.innerHTML = this.analyses.map(a => {
      const snap = a.trigger_snapshot || {};
      // blockDiff 存在 = blocks 触发口径（BSC 生产）；存量行无此字段走 age 展示不变
      const blockStr = snap.blockDiff != null ? `blk+${fmt(snap.blockDiff, 0)} / ` : '';
      // BNB 原生价量级 ~1e-8 以下，toFixed 截断丢有效位 → 指数计数法（引擎日志同惯例）
      const priceStr = fmtExp(snap.currentPriceBnb);
      const snapStr = `${blockStr}${fmt(snap.ageSeconds)}s / tc${fmt(snap.tradeCount, 0)} / ${fmt(snap.buyBnb)}BNB / ${priceStr}`;
      const isBlock = a.verdict === 'block';
      let reasonCell;
      if (isBlock) {
        const chips = (a.block_reasons || []).map(r => `<span class="reason-chip">${r}</span>`).join('');
        reasonCell = chips || '<span class="text-gray-500">-</span>';
      } else {
        // approve 行：展示 verdict 依据的具体因子值（绿色 chip），与 block 行红色 chip 对称。
        // 按实验实际 zhuangCondition 引用的操作数动态展示（默认 tokenScore/庄散比；自定义如 zhuangScore/retailScore），附 4 桶占比解释构成。
        reasonCell = passReasonCell(a, this.verdictCondition);
      }
      return `<tr class="hover:bg-gray-700 hover:bg-opacity-30 transition-colors">
        <td class="px-4 py-3 text-gray-300 font-mono text-xs whitespace-nowrap">${shortAddr(a.token_address)}${tokenLinks(a.token_address, this.experimentId)}</td>
        <td class="px-4 py-3 whitespace-nowrap">${verdictBadge(a.verdict)}</td>
        <td class="px-4 py-3 whitespace-nowrap">${tokenScoreCell(a)}</td>
        <td class="px-4 py-3 whitespace-nowrap">${tokenProfileCell(a)}</td>
        <td class="px-4 py-3 block-reason-cell text-xs" data-token="${a.token_address}">${reasonCell}</td>
        <td class="px-4 py-3 text-gray-400 font-mono text-xs whitespace-nowrap">${snapStr}</td>
        <td class="px-4 py-3 text-gray-400 font-mono text-xs whitespace-nowrap">${fmtTime(a.as_of)}</td>
      </tr>`;
    }).join('');
    // block 原因单元格点击 → 弹窗（approve 行也可点开看因子全通过）
    tbody.querySelectorAll('.block-reason-cell').forEach(td => {
      td.addEventListener('click', () => this.openFactorModal(td.dataset.token));
    });
  }

  // ── block 原因子弹窗（verdict 因子实际值）──
  openFactorModal(tokenAddress) {
    const a = this.analyses.find(x => x.token_address === tokenAddress);
    if (!a) return;
    const hf = a.holding_factors || {};

    document.getElementById('factor-modal-title').innerHTML =
      `${shortAddr(tokenAddress)} ${tokenLinks(tokenAddress, this.experimentId)}`;
    // 代币总分（approve/block 都展示）：richer-js 不落 wallet_score_summary，后端回填 TPAPre_tokenScore 镜像。
    const ws = a.wallet_score_summary;
    const scoreLine = (ws && ws.totalScore != null)
      ? ` · 代币总分 <span class="text-white font-semibold">${Number(ws.totalScore).toFixed(2)}</span>` +
        (ws.holderCount != null ? ` <span class="text-gray-500">(${ws.holderCount}持仓者)</span>` : '') +
        (ws.penalized ? ` <span class="text-yellow-400" title="${ws.penaltyReason || '集中度/低流通惩罚'}">⚠${ws.penaltyReason || ''}</span>` : '')
      : '';
    document.getElementById('factor-modal-meta').innerHTML =
      `as_of ${fmtTime(a.as_of)} · trigger_no ${a.trigger_no ?? '-'} ${verdictBadge(a.verdict)}${scoreLine}`;

    // block_reasons 自描述：提取未通过因子 key 用于行高亮（格式 `factor op thresh（实际 val）`）
    const reasons = a.block_reasons || [];
    const failedKeys = new Set(
      reasons.map(r => {
        const m = String(r).match(/^([a-zA-Z_]\w*)\s*[<>=!]/);
        return m ? m[1] : null;
      }).filter(Boolean)
    );

    // 全部 holding_factors（因子 / 实际值 / 状态）；未通过的因子标红
    const rows = Object.keys(hf).map(k => {
      const failed = failedKeys.has(k);
      const valDisp = fmtFactorValue(k, hf[k]);
      const statusCls = failed ? 'text-red-400' : 'text-gray-500';
      const statusTxt = failed ? '✗ 未通过' : '—';
      return `<tr>
        <td class="px-3 py-2 text-gray-300 font-mono text-xs">${k}</td>
        <td class="px-3 py-2 text-right text-white font-mono">${valDisp}</td>
        <td class="px-3 py-2 text-center ${statusCls} font-medium">${statusTxt}</td>
      </tr>`;
    }).join('');
    document.getElementById('factor-modal-body').innerHTML = rows;

    const reasonsTxt = reasons.join(', ') || '(无)';
    const verdictCls = a.verdict === 'block' ? 'text-red-400' : 'text-green-400';
    // 庄散聚合（读落表 holding_factors，与 verdict 同源）：4 桶占比 + 庄散比 + 持仓者数；approve/block 都展示
    const zr = a.zhuang_retail;
    let zrHtml = '';
    if (zr) {
      // ∞ 判定用后端透传的布尔（JSON.stringify(Infinity)=null，直接传数值前端只见 null）
      const r = zr.TPAPre_zhuangRetailRatio;
      const rDisp = zr.TPAPre_zhuangRetailRatioInfinite ? '∞' : ((r == null) ? '-' : Number(r).toFixed(2));
      zrHtml = `<div class="text-xs text-gray-400 mt-2 pt-2 border-t border-gray-700">` +
        `<span class="text-gray-500">庄散聚合（落表）：</span>` +
        `庄<span class="text-red-400 font-mono"> ${zr.TPAPre_zhuangPct}%</span> · ` +
        `新<span class="text-cyan-400 font-mono"> ${zr.TPAPre_newWalletPct}%</span> · ` +
        `散<span class="text-blue-400 font-mono"> ${zr.TPAPre_retailPct}%</span> · ` +
        `中<span class="text-gray-400 font-mono"> ${zr.TPAPre_neutralPct}%</span>` +
        `<span class="ml-2">庄散比 <span class="text-white font-semibold font-mono">${rDisp}</span> <span class="text-gray-600">((庄+新)/散)</span></span>` +
        `<span class="ml-2 text-gray-500">${zr.TPAPre_zhuangHolderCount}持仓者</span>` +
        `</div>`;
    }
    const condTxt = this.verdictCondition || '(默认 TPAPre_tokenScore > 2 AND TPAPre_zhuangRetailRatio > 0.3)';
    document.getElementById('factor-modal-footer').innerHTML =
      `verdict <span class="${verdictCls} font-semibold">${a.verdict}</span>` +
      zrHtml +
      `<div class="text-xs text-gray-500 mt-1">verdict 条件 <span class="text-gray-400 font-mono">${condTxt}</span> · 未通过: ${reasonsTxt}</div>`;

    document.getElementById('factor-modal').classList.remove('hidden');
  }

  closeFactorModal() {
    document.getElementById('factor-modal').classList.add('hidden');
  }

  showError(msg) {
    document.getElementById('errorContainer').innerHTML =
      `<div class="bg-red-900 bg-opacity-30 border border-red-700 text-red-300 px-4 py-3 rounded-lg mb-4">${msg}</div>`;
  }
  hideError() {
    document.getElementById('errorContainer').innerHTML = '';
  }
}

// ── 格式化 helpers ──
function shortAddr(a) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '-'; }
function fmt(v, d = 2) { return (v == null || v === '' || isNaN(v)) ? '-' : Number(v).toFixed(d); }
// BNB 原生价（~1e-8 以下）：toFixed 会截断丢有效位 → 指数计数法
function fmtExp(v) { return (v == null || v === '' || isNaN(v)) ? '-' : Number(v).toExponential(2); }

// 庄散加权分（0-5 桶内 floatPct 加权均分；gapZR 可负）非百分比，单独格式化不加 %。
const ZR_SCORE_KEYS = new Set(['TPAPre_zhuangScore', 'TPAPre_retailScore', 'TPAPre_newWalletScore', 'TPAPre_neutralScore', 'TPAPre_minZR', 'TPAPre_gapZR']);
// 因子值显示：庄散加权分 0-5 保留 3 位；占比/比率类（含 analyzeDurationMs 等非 ZR 数值沿用）→ 2 位 + %。
// 注：analyzeDurationMs/analyzedAgeSec/TPAPre_zhuangHolderCount 等非百分比键按母版同途走 % 格式（观察列，非精确读数）。
function fmtFactorValue(k, v) {
  if (v == null || v === '' || isNaN(v)) return '-';
  if (ZR_SCORE_KEYS.has(k)) return Number(v).toFixed(3);
  return Number(v).toFixed(2) + '%';
}

// 代币总分单元格（wallet_score_summary.totalScore，0-5 分；richer-js 后端回填 TPAPre_tokenScore 镜像，缺失显 -）。
// 着色：≥3 绿（优质持仓）/ 2-3 蓝 / <2 红；penalized 追加 ⚠。
function tokenScoreCell(a) {
  const s = a.wallet_score_summary;
  if (!s || s.totalScore == null) return '<span class="text-gray-600">-</span>';
  const cls = s.totalScore >= 3 ? 'text-green-400' : s.totalScore >= 2 ? 'text-blue-400' : 'text-red-400';
  const warn = s.penalized ? ` <span class="text-yellow-400" title="${s.penaltyReason || '集中度/低流通惩罚'}">⚠</span>` : '';
  return `<span class="font-mono font-semibold ${cls}">${Number(s.totalScore).toFixed(2)}</span>${warn}`;
}

// verdict 条件可能引用的操作数（与 TokenPositionAnalyzer _compileCondition allowedFactors 对称，单一真相源）。
// 含可选操作数 TPAPre_walletHoldingPct（默认 condition 不引用；自定义放宽路径时展示）。
const VERDICT_OPERANDS = ['TPAPre_tokenScore', 'TPAPre_zhuangRetailRatio', 'TPAPre_zhuangScore', 'TPAPre_retailScore', 'TPAPre_newWalletScore', 'TPAPre_neutralScore', 'TPAPre_minZR', 'TPAPre_gapZR', 'TPAPre_walletHoldingPct'];
const VERDICT_OPERAND_SET = new Set(VERDICT_OPERANDS);
const VERDICT_OPERAND_LABEL = {
  TPAPre_tokenScore: '总分', TPAPre_zhuangRetailRatio: '庄散比',
  TPAPre_zhuangScore: '庄分', TPAPre_retailScore: '散分',
  TPAPre_newWalletScore: '新钱包分', TPAPre_neutralScore: '中分', TPAPre_minZR: 'minZR', TPAPre_gapZR: 'gapZR',
  TPAPre_walletHoldingPct: '净吸收',
};

// 从条件表达式提取引用的操作数（保序去重）；非操作数标识符（AND/OR/IS/NULL 等）忽略。无条件回退默认两因子。
function extractVerdictOperands(condition) {
  if (!condition) return ['TPAPre_tokenScore', 'TPAPre_zhuangRetailRatio'];
  const ids = String(condition).match(/[a-zA-Z_]\w*/g) || [];
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (VERDICT_OPERAND_SET.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out.length ? out : ['TPAPre_tokenScore', 'TPAPre_zhuangRetailRatio'];
}

// 取某操作数在该 token 的实际值：TPAPre_tokenScore←wallet_score_summary.totalScore；其余←zhuang_retail（透传自 holding_factors）。
// 庄散比 ∞ 从 infinite 布尔前端组回（JSON 序列化丢 Infinity），供 fmtOperand 的 isFinite 分支显示。
function verdictOperandValue(a, key) {
  if (key === 'TPAPre_tokenScore') return a.wallet_score_summary?.totalScore ?? null;
  const zr = a.zhuang_retail;
  if (!zr) return null;
  if (key === 'TPAPre_zhuangRetailRatio' && zr.TPAPre_zhuangRetailRatioInfinite) return Infinity;
  return zr[key] != null ? zr[key] : null;
}

// 格式化操作数实际值：庄散比支持 ∞；TPAPre_tokenScore/庄散加权分（0-5 浮点）/净吸收% 2 位小数。
function fmtOperand(key, v) {
  if (key === 'TPAPre_zhuangRetailRatio') return isFinite(v) ? Number(v).toFixed(2) : '∞';
  return Number(v).toFixed(2);
}

// approve 行「block 原因」列：展示该 token 通过所依据的具体因子值（绿色 chip），不再只显「全门通过」。
// 与 block 行（红色 reason-chip = 未通过因子）对称。按实验实际 zhuangCondition 引用的操作数动态展示
// （默认 tokenScore/庄散比；自定义如 zhuangScore/retailScore），附 4 桶占比解释构成。
// 无落表字段时 zhuang_retail=null（仅 tokenScore 可能显示，其余 chip 缺数据跳过）。
function passReasonCell(a, condition) {
  const chips = [];
  for (const key of extractVerdictOperands(condition)) {
    const v = verdictOperandValue(a, key);
    if (v == null) continue;
    const label = VERDICT_OPERAND_LABEL[key] || key;
    chips.push(`<span class="pass-chip">${label} ${fmtOperand(key, v)}</span>`);
  }
  const zr = a.zhuang_retail;
  if (zr) {
    chips.push(`<span class="pass-chip-sub">庄${zr.TPAPre_zhuangPct}%·新${zr.TPAPre_newWalletPct}%·散${zr.TPAPre_retailPct}%</span>`);
  }
  return chips.length ? chips.join('') : '<span class="text-green-400">✓ 全门通过</span>';
}

function verdictBadge(v) {
  const cls = v === 'approve'
    ? 'bg-green-900 text-green-400 border-green-700'
    : 'bg-red-900 text-red-400 border-red-700';
  return `<span class="inline-block px-2 py-0.5 rounded text-xs font-medium border ${cls}">${v}</span>`;
}

// 离线/OPB 分类单元格：category badge + source 小标（在线蓝/离线灰）+ max_mcap；未分类显「-」。
function tokenProfileCell(a) {
  const cat = a.token_profile_category;
  if (!cat) return '<span class="text-gray-600">-</span>';
  const m = TOKEN_PROFILE_MAP[cat] || TOKEN_PROFILE_MAP.neutral;
  const src = a.token_profile_source;
  const srcBadge = src === 'online'
    ? '<span class="ml-1 text-[10px] text-blue-400 align-middle">在线</span>'
    : src === 'offline'
      ? '<span class="ml-1 text-[10px] text-gray-500 align-middle">离线</span>'
      : '';
  const mcap = (a.token_profile_max_mcap != null && a.token_profile_max_mcap !== 0)
    ? ` <span class="text-[10px] text-gray-500 align-middle">$${fmtMcap(a.token_profile_max_mcap)}</span>`
    : '';
  return `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium border ${m.colorClass} ${m.bgClass} ${m.borderClass}">${m.emoji} ${m.label}</span>${srcBadge}${mcap}`;
}

function fmtMcap(v) {
  if (v == null) return '';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return v.toFixed(0);
}

// token 外链：GMGN 代币页（bsc；BSC-only）+ 复制地址按钮 + 本实验该 token 交易记录页（#token= 锚，
// richer-js 无独立 token-trades 页，沿用 token_returns 外链先例）。
// event.stopPropagation 防触发行/单元格点击。
function tokenLinks(addr, expId) {
  return ` <a href="https://gmgn.ai/bsc/token/${addr}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="text-gray-400 hover:text-purple-400 transition-colors p-0.5 inline-block align-middle" title="在 GMGN 查看"><img src="/static/gmgn.png" alt="GMGN" class="w-3 h-3 inline-block"></a><button onclick="copyTokenAddr('${addr}', event)" class="text-gray-400 hover:text-blue-400 transition-colors p-0.5 inline-block align-middle cursor-pointer" title="复制代币地址">📋</button><a href="/experiment/${expId}/trades#token=${addr}" target="_blank" onclick="event.stopPropagation()" class="text-gray-400 hover:text-purple-400 transition-colors p-0.5 inline-block align-middle text-xs" title="该 token 交易记录">📈</a>`;
}

// 复制代币地址到剪贴板（navigator.clipboard 优先，execCommand fallback），底部 toast 提示 1.5s。
function copyTokenAddr(addr, ev) {
  if (ev) ev.stopPropagation();
  const done = () => {
    const toast = document.getElementById('copy-toast');
    if (!toast) return;
    toast.classList.remove('opacity-0'); toast.classList.add('opacity-100');
    clearTimeout(window._copyToastTimer);
    window._copyToastTimer = setTimeout(() => {
      toast.classList.remove('opacity-100'); toast.classList.add('opacity-0');
    }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(addr).then(done).catch(() => _fallbackCopy(addr, done));
  } else {
    _fallbackCopy(addr, done);
  }
}
function _fallbackCopy(text, cb) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    if (cb) cb();
  } catch (_) { /* 忽略 */ }
}

function fmtTime(t) {
  if (!t) return '-';
  try { return new Date(t).toISOString().replace('T', ' ').slice(0, 19); } catch { return t; }
}

document.addEventListener('DOMContentLoaded', () => new ExperimentPositionAnalysis());
