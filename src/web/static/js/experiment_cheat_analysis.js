/**
 * 实验级反作弊分析页面（CD1 G12）
 * 数据源：
 *  - GET  /api/experiment/:id/cheat-detections   cheat_detection 全行（as-of 判定轨迹）
 *  - GET  /api/experiment/:id/signals            买点门拦截（execution_reason=cheat_gate_*）
 *  - GET  /api/experiment/:id/trades             买入结果联动（净 BNB）
 *  - GET  /api/experiment/:id                    cheatCheck 配置（gate 模式/首析门/重判门）
 *
 * 口径注记：
 *  - 每 token 多行=增量重判轨迹（帽 4/token），「最新判定」取 analyzed_at 最大行
 *  - 失败行 verdict=timeout/error（grade=null）；观察层/旧版行 grade=null
 *  - D3.5 起 verdict='observed'（只识别现象与强度，交易动作映射在 grade）
 */

// ============ 常量映射 ============

const CHEAT_GRADE_META = {
  cheat: { label: 'cheat', emoji: '🚫', cls: 'cheat-grade-cheat', dot: 'traj-cheat', order: 3 },
  unhealthy: { label: 'unhealthy', emoji: '⚠️', cls: 'cheat-grade-unhealthy', dot: 'traj-unhealthy', order: 2 },
  healthy: { label: 'healthy', emoji: '✅', cls: 'cheat-grade-healthy', dot: 'traj-healthy', order: 1 },
};

// 拦截通道配色（gradeReasons code 首字母）
const CHANNEL_COLOR = {
  A: '#dc2626', // 主判题 strong
  D: '#f97316', // 著名钱包控盘
  E: '#eab308', // 低活跃
  J: '#a855f7', // 持仓均衡
  L: '#ec4899', // 内部人联立
  R: '#38bdf8', // 真实参与不足
};

// 题档分布矩阵：题定义（key=读取字段路径，levels=档位列）
// 顺序=现象四题 → EXT 观察题 → 三个独立档域题
const LEVEL_QUESTIONS = [
  { key: 'phenomena.equal_amount_split', name: '等额分账', levels: ['none', 'weak', 'moderate', 'strong'], title: 'equal_amount_split · 同块近额分仓' },
  { key: 'phenomena.coordinated_sell_back', name: '协调卖回', levels: ['none', 'weak', 'moderate', 'strong'], title: 'coordinated_sell_back · 组织性买入后协同卖出' },
  { key: 'phenomena.creator_front_run', name: '创建者抢跑', levels: ['none', 'weak', 'moderate', 'strong'], title: 'creator_front_run · 创建者/关联盘抢先买入' },
  { key: 'phenomena.sell_dispersion', name: '卖压分散', levels: ['none', 'weak', 'moderate', 'strong'], title: 'sell_dispersion · 卖出委托分散布局' },
  { key: 'ext_levels.stall_burst_wave', name: '停滞突发', levels: ['none', 'burst'], title: 'stall_burst_wave · 长期停滞后涌入一波流量' },
  { key: 'ext_levels.amount_tiering', name: '金额分档', levels: ['none', 'weak', 'moderate', 'strong'], title: 'amount_tiering · 买入金额呈固定档位组合' },
  { key: 'ext_levels.same_block_buy_wave', name: '同块买波', levels: ['none', 'weak', 'moderate', 'strong'], title: 'same_block_buy_wave · 同块打包买入波' },
  { key: 'ext_levels.insider_supply_sell', name: '内部人供卖', levels: ['none', 'weak', 'moderate', 'strong'], title: 'insider_supply_sell · 内部人筹码派发' },
  { key: 'ext_levels.slow_grind_pump', name: '慢磨拉盘', levels: ['none', 'weak', 'moderate', 'strong'], title: 'slow_grind_pump · 缓慢匀速拉抬' },
  { key: 'ext_levels.wash_pair', name: '对敲', levels: ['none', 'weak', 'moderate', 'strong'], title: 'wash_pair · 同块卖→买等额对敲' },
  { key: 'ext_levels.holdings_balance', name: '持仓均衡', levels: ['none', 'weak', 'moderate', 'strong'], title: 'holdings_balance · 组合垄断/分仓持仓结构' },
  { key: 'activity_level', name: '活跃度', levels: ['low', 'mid', 'high', 'ultra'], title: 'activity_level · Jev 活跃度档' },
  { key: 'bundled_dominance', name: '捆绑主导', levels: ['low', 'mid', 'high'], title: 'bundled_trade_dominance · 捆绑交易主导度' },
  { key: 'participation', name: '真实参与', levels: ['mostly_genuine', 'meaningful_genuine', 'minimal_genuine', 'unclear'], title: 'real_participation · 真实用户参与度（R 通道数值源）' },
];

const PARTICIPATION_SHORT = {
  mostly_genuine: 'mostly', meaningful_genuine: 'meaningful', minimal_genuine: 'minimal', unclear: 'unclear',
};

class ExperimentCheatAnalysis {
  constructor() {
    this.experimentId = null;
    this.experimentData = null;
    this.cheatRows = [];       // 原始行（desc）
    this.buySignals = [];      // BUY 信号行（含被拒）
    this.trades = [];
    this.tokens = [];          // 派生 per-token 记录
    this.filtered = [];
    this.expanded = new Set(); // 展开行（token 地址）
    this.autoRefresh = true;
    this.refreshTimer = null;
    this.init();
  }

  init() {
    const parts = window.location.pathname.split('/');
    this.experimentId = parts[2] || null;
    if (!this.experimentId) {
      this.showError('无法解析实验 ID（URL 形如 /experiment/:id/cheat-analysis）');
      return;
    }

    document.getElementById('refresh-btn')?.addEventListener('click', () => this.load());
    document.getElementById('retry-btn')?.addEventListener('click', () => this.load());
    document.getElementById('auto-refresh')?.addEventListener('change', (e) => {
      this.autoRefresh = e.target.checked;
      this._setupAutoRefresh();
    });
    document.getElementById('grade-filter')?.addEventListener('change', () => this.renderTokens());
    document.getElementById('platform-filter')?.addEventListener('change', () => this.renderTokens());
    document.getElementById('gate-filter')?.addEventListener('change', () => this.renderTokens());
    document.getElementById('search-input')?.addEventListener('input', () => this.renderTokens());

    // 导航链接
    const base = `/experiment/${this.experimentId}`;
    const setHref = (id, href) => { const el = document.getElementById(id); if (el) el.href = href; };
    setHref('link-detail', base);
    setHref('link-signal-stats', `${base}/signal-stats`);
    setHref('link-signals', `${base}/signals`);
    setHref('current-page', `${base}/cheat-analysis`);

    this.load();
    this._setupAutoRefresh();
  }

  _setupAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    if (this.autoRefresh) {
      this.refreshTimer = setInterval(() => this.load(), 60000);
    }
  }

  showError(msg) {
    document.getElementById('loading')?.classList.add('hidden');
    document.getElementById('error-message')?.classList.remove('hidden');
    const el = document.getElementById('error-text');
    if (el) el.textContent = msg;
  }

  async load() {
    try {
      const [expRes, cheatRes] = await Promise.all([
        fetch(`/api/experiment/${this.experimentId}`),
        fetch(`/api/experiment/${this.experimentId}/cheat-detections`),
      ]);
      if (!expRes.ok) throw new Error(`实验信息加载失败 HTTP ${expRes.status}`);
      if (!cheatRes.ok) throw new Error(`反作弊数据加载失败 HTTP ${cheatRes.status}`);
      const expJson = await expRes.json();
      const cheatJson = await cheatRes.json();

      this.experimentData = expJson.data || null;
      this.cheatRows = (cheatJson.data || []);

      // 信号与成交并行（失败不阻塞——门拦截列退化为「未触发」）
      const [signals, trades] = await Promise.all([
        this._fetchAllSignals(),
        this._fetchTrades(),
      ]);
      this.buySignals = signals;
      this.trades = trades;

      this._derive();
      this._renderHeader();
      this._renderSummary();
      this._renderReasonDist();
      this._renderLevelDist();
      this.renderTokens();

      document.getElementById('loading')?.classList.add('hidden');
      document.getElementById('error-message')?.classList.add('hidden');
      document.getElementById('cheat-content')?.classList.remove('hidden');
      const empty = document.getElementById('empty-state');
      if (empty) empty.classList.toggle('hidden', this.tokens.length > 0);
    } catch (error) {
      console.error('反作弊分析加载失败:', error);
      this.showError('加载失败: ' + error.message);
    }
  }

  /** 分页拉 BUY 信号（帽 8000 防失控）。action=buy 服务端过滤——
   *  全量排序 action desc 会把 BUY 排尾部，不带过滤分页会截丢 */
  async _fetchAllSignals() {
    const out = [];
    const PAGE = 500;
    for (let offset = 0; offset < 8000; offset += PAGE) {
      const params = new URLSearchParams({ action: 'buy', limit: String(PAGE), offset: String(offset) });
      const resp = await fetch(`/api/experiment/${this.experimentId}/signals?${params}`);
      if (!resp.ok) break;
      const json = await resp.json();
      const rows = (json.signals || []).filter(s => (s.action || '').toLowerCase() === 'buy');
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async _fetchTrades() {
    try {
      const params = new URLSearchParams({ limit: '2000' });
      const resp = await fetch(`/api/experiment/${this.experimentId}/trades?${params}`);
      if (!resp.ok) return [];
      const json = await resp.json();
      return json.data || [];
    } catch (e) {
      return [];
    }
  }

  /** digest 档位键归一：{bucket,prob} 对象或裸字符串 → 档位串 */
  static _level(v) {
    if (v == null) return null;
    if (typeof v === 'object') return v.bucket ?? null;
    return v;
  }

  /** 按路径读档位（'phenomena.equal_amount_split'） */
  static _pick(row, path) {
    if (!row) return null;
    let cur = row;
    for (const seg of path.split('.')) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = cur[seg];
    }
    return ExperimentCheatAnalysis._level(cur);
  }

  _derive() {
    const byToken = new Map();
    const get = (addr) => {
      const key = (addr || '').toLowerCase();
      if (!key) return null;
      if (!byToken.has(key)) {
        byToken.set(key, {
          address: key,
          symbol: null,
          platforms: new Set(),
          rounds: [],          // asc by analyzed_at
          latest: null,
          gateUnhealthy: 0,    // cheat_gate_unhealthy 拒买次数
          gateCheat: 0,        // cheat_gate_cheat 拉黑拒买次数
          boughtEver: false,
          buyFires: 0,         // 已执行买信号数
          netBnb: null,        // 买-卖 净 BNB（成交行口径）
        });
      }
      return byToken.get(key);
    };

    for (const row of this.cheatRows) {
      const rec = get(row.token_address);
      if (!rec) continue;
      if (row.platform) rec.platforms.add(row.platform);
      if (row.token_symbol) rec.symbol = row.token_symbol;
      rec.rounds.push(row);
    }
    for (const rec of byToken.values()) {
      rec.rounds.sort((a, b) => new Date(a.analyzed_at) - new Date(b.analyzed_at));
      rec.latest = rec.rounds[rec.rounds.length - 1] || null;
    }

    // 买点门拦截 + 已买（BUY 信号）
    for (const s of this.buySignals) {
      const rec = get(s.token_address || s.tokenAddress);
      if (!rec) continue;
      if (!rec.symbol && s.token_symbol) rec.symbol = s.token_symbol;
      const reason = s.execution_reason || '';
      if (reason === 'cheat_gate_unhealthy') rec.gateUnhealthy += 1;
      if (reason === 'cheat_gate_cheat') rec.gateCheat += 1;
      if (s.executed === true || s.executed === 'true') {
        rec.boughtEver = true;
        rec.buyFires += 1;
      }
    }

    // 成交联动（净 BNB；只计成功行）
    for (const t of this.trades) {
      const rec = get(t.token_address);
      if (!rec) continue;
      if (!rec.symbol && t.token_symbol) rec.symbol = t.token_symbol;
      if ((t.trade_status || t.status) !== 'success') continue;
      const inAmt = Number(t.input_amount) || 0;
      const outAmt = Number(t.output_amount) || 0;
      const dir = (t.trade_direction || t.direction || '').toLowerCase();
      if (dir === 'buy') rec.netBnb = (rec.netBnb ?? 0) - inAmt;
      else if (dir === 'sell') rec.netBnb = (rec.netBnb ?? 0) + outAmt;
    }

    this.tokens = [...byToken.values()].sort((a, b) =>
      new Date(b.latest?.analyzed_at || 0) - new Date(a.latest?.analyzed_at || 0)
    );

    // 平台筛选下拉选项
    const platforms = new Set();
    this.tokens.forEach(t => t.platforms.forEach(p => platforms.add(p)));
    const sel = document.getElementById('platform-filter');
    if (sel) {
      const cur = sel.value || 'all';
      sel.innerHTML = '<option value="all">全部</option>'
        + [...platforms].map(p => `<option value="${p}">${p}</option>`).join('');
      sel.value = [...platforms].includes(cur) ? cur : 'all';
    }
  }

  // ============ 头部 ============

  _renderHeader() {
    const exp = this.experimentData || {};
    document.getElementById('experiment-name').textContent = exp.experimentName || exp.config?.name || '未知实验';
    document.getElementById('experiment-id').textContent = `ID: ${this.experimentId}`;

    const times = this.cheatRows.map(r => new Date(r.analyzed_at).getTime()).filter(Number.isFinite);
    if (times.length) {
      const fmt = (ms) => new Date(ms).toLocaleString('zh-CN', { hour12: false });
      document.getElementById('analysis-window').textContent =
        `判定时间范围: ${fmt(Math.min(...times))} ~ ${fmt(Math.max(...times))}`;
    }
    const versions = new Set(this.cheatRows.map(r => r.grade_version).filter(Boolean));
    if (versions.size) {
      document.getElementById('grade-version').textContent = `规则版本: ${[...versions].join(' / ')}`;
    }

    // gate 模式徽章 + 配置 chips（both 实验配置落 fourmemeWs；flap 单平台实验落 flapWs）
    const cc = exp.config?.fourmemeWs?.cheatCheck || exp.config?.flapWs?.cheatCheck || null;
    const badge = document.getElementById('gate-mode-badge');
    const chips = document.getElementById('cheat-config-chips');
    const chipHtml = [];

    if (!cc || cc.enabled !== true) {
      badge.textContent = '未开启';
      badge.className = 'px-3 py-1 rounded-full text-xs font-semibold cheat-grade-plain';
      chipHtml.push('<span class="px-2 py-1 rounded bg-gray-700 text-gray-300">cheatCheck.enabled ≠ true（本实验无判定留痕属预期）</span>');
    } else if (cc.gate?.enabled === true) {
      badge.textContent = '🛡️ 分级买门（G12）';
      badge.className = 'px-3 py-1 rounded-full text-xs font-semibold cheat-grade-unhealthy';
    } else {
      badge.textContent = '👁 观察层（不拦买）';
      badge.className = 'px-3 py-1 rounded-full text-xs font-semibold cheat-grade-healthy';
    }

    if (cc) {
      const prefetch = cc.prefetchCondition ?? 'tradeCount >= 15（缺省）';
      chipHtml.push(`<span class="px-2 py-1 rounded bg-gray-700 text-gray-300" title="cheatCheck.prefetchCondition">首析门: <code class="text-green-400">${this._esc(String(prefetch))}</code></span>`);
      const reanalyze = cc.reanalyzeCondition;
      if (reanalyze != null) {
        chipHtml.push(`<span class="px-2 py-1 rounded bg-gray-700 text-gray-300" title="cheatCheck.reanalyzeCondition（CD134 因子化重判门）">重判门: <code class="text-green-400">${this._esc(String(reanalyze))}</code></span>`);
      }
      const cap = cc.maxAnalysesPerToken ?? 4;
      chipHtml.push(`<span class="px-2 py-1 rounded bg-gray-700 text-gray-300" title="每 token 判定次数上限（error/timeout 也计数）">判定帽: ${cap}/token</span>`);
      if (cc.gate?.awaitMs != null) {
        chipHtml.push(`<span class="px-2 py-1 rounded bg-gray-700 text-gray-300" title="gate.awaitMs 买点同步等待上限（超时 fail-open 放行）">买点等待: ${cc.gate.awaitMs}ms</span>`);
      }
      if (cc.gate?.enabled === true && cc.unhealthyReanalyses != null) {
        chipHtml.push(`<span class="px-2 py-1 rounded bg-gray-700 text-gray-300" title="连续 unhealthy 次数用尽即拉黑+清仓">拉黑阈: unhealthy ×${cc.unhealthyReanalyses}</span>`);
      }
    }
    chips.innerHTML = chipHtml.join('');
  }

  // ============ 总览卡片 ============

  _renderSummary() {
    const total = this.tokens.length;
    const rows = this.cheatRows.length;
    let healthy = 0, unhealthy = 0, cheat = 0, failed = 0, ungraded = 0;
    let flipped = 0, gateBlocked = 0, gateFires = 0, bought = 0;

    for (const t of this.tokens) {
      const g = t.latest?.grade ?? null;
      const verdict = t.latest?.verdict;
      if (g === 'healthy') healthy += 1;
      else if (g === 'unhealthy') unhealthy += 1;
      else if (g === 'cheat') cheat += 1;
      else if (verdict === 'timeout' || verdict === 'error') failed += 1;
      else ungraded += 1;

      const everUnhealthy = t.rounds.some(r => r.grade === 'unhealthy');
      if (everUnhealthy && g === 'healthy') flipped += 1;
      if (t.gateUnhealthy + t.gateCheat > 0) { gateBlocked += 1; gateFires += t.gateUnhealthy + t.gateCheat; }
      if (t.boughtEver) bought += 1;
    }

    const card = (label, value, cls, title = '') =>
      `<div class="bg-gray-800 rounded-lg p-4 border border-gray-700" title="${this._esc(title)}">
         <div class="text-xs text-gray-400 mb-1">${label}</div>
         <div class="text-2xl font-bold ${cls}">${value}</div>
       </div>`;

    document.getElementById('summary-cards').innerHTML = [
      card('分析代币数', total, 'text-white', 'cheat_detection 留痕的去重代币数'),
      card('判定行数', rows, 'text-gray-300', '全部判定行（含增量重判/失败行）'),
      card('最新 healthy', healthy, 'text-green-400'),
      card('最新 unhealthy', unhealthy, 'text-orange-400', '拒买不拉黑；增量重判可翻案'),
      card('cheat 拉黑', cheat, 'text-red-400', 'A 通道主判 strong（降级豁免外）'),
      card('翻案(不健康→健康)', flipped, 'text-yellow-400', '曾判 unhealthy 且最新 healthy'),
      card('门拦截买点', gateFires, 'text-pink-400', `cheat_gate_* 拒买次数 / ${gateBlocked} 个代币`),
      card('放行后已买', bought, 'text-teal-400', '存在已执行 BUY 信号'),
    ].join('');
  }

  // ============ 原因分布 ============

  _renderReasonDist() {
    const counts = new Map(); // code → {count, level}
    for (const row of this.cheatRows) {
      for (const r of row.grade_reasons || []) {
        // L_insider_sell<N> 数值后缀归一
        const code = String(r.code || '').replace(/^(L_insider_sell).*/, '$1');
        if (!code) continue;
        const cur = counts.get(code) || { count: 0, level: r.level || '' };
        cur.count += 1;
        counts.set(code, cur);
      }
    }
    const el = document.getElementById('reason-dist');
    if (!counts.size) {
      el.innerHTML = '<div class="text-gray-500">无 unhealthy/cheat 命中留痕（全部行 healthy 或未分级）</div>';
      return;
    }
    const entries = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
    const max = entries[0][1].count;
    el.innerHTML = entries.map(([code, { count, level }]) => {
      const ch = code[0];
      const color = CHANNEL_COLOR[ch] || '#6b7280';
      const pct = Math.max(4, Math.round((count / max) * 100));
      return `
        <div class="flex items-center gap-2">
          <code class="w-56 shrink-0 text-gray-200 truncate" title="${this._esc(code)}">${this._esc(code)}</code>
          <div class="reason-bar-track flex-1"><div class="reason-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <span class="w-16 text-right ${level === 'cheat' ? 'text-red-400' : 'text-orange-300'}">${count}</span>
        </div>`;
    }).join('');
  }

  // ============ 题档分布 ============

  _renderLevelDist() {
    // 最新行集合
    const latestRows = this.tokens.map(t => t.latest).filter(Boolean);
    if (!latestRows.length) {
      document.getElementById('level-dist').innerHTML = '<div class="text-gray-500">无判定行</div>';
      return;
    }

    // 各题 levels 列不同 → 每题一行：题名 + 各档位计数 chip + 缺席计数
    const rows = LEVEL_QUESTIONS.map(q => {
      const chips = q.levels.map(lv => {
        const c = latestRows.filter(r => ExperimentCheatAnalysis._pick(r, q.key) === lv).length;
        const strong = (lv === 'strong' || lv === 'burst');
        const cls = c
          ? (strong ? 'level-chip-strong' : 'level-chip-nonzero')
          : 'level-chip-zero';
        return `<span class="px-1.5 py-0.5 rounded ${cls}" title="${lv}: ${c}/${latestRows.length}">${lv} ${c}</span>`;
      }).join('');
      const nullCount = latestRows.filter(r => ExperimentCheatAnalysis._pick(r, q.key) == null).length;
      return `
        <div class="flex items-center gap-2 py-1 border-t border-gray-700 first:border-t-0">
          <code class="w-28 shrink-0 text-gray-200 truncate" title="${this._esc(q.title)}">${q.name}</code>
          <div class="flex flex-wrap gap-1">${chips}</div>
          ${nullCount ? `<span class="ml-auto text-gray-500" title="档位缺席（旧档断代/题未引入/失败行）">缺席 ${nullCount}</span>` : ''}
        </div>`;
    }).join('');

    document.getElementById('level-dist').innerHTML = rows
      + `<div class="text-xs text-gray-500 mt-2">样本=${latestRows.length} 代币（每代币最新一行判定）</div>`;
  }

  // ============ 代币明细表 ============

  renderTokens() {
    const gradeF = document.getElementById('grade-filter')?.value || 'all';
    const platF = document.getElementById('platform-filter')?.value || 'all';
    const gateF = document.getElementById('gate-filter')?.value || 'all';
    const search = (document.getElementById('search-input')?.value || '').trim().toLowerCase();

    this.filtered = this.tokens.filter(t => {
      const g = t.latest?.grade ?? null;
      const verdict = t.latest?.verdict;
      if (gradeF === 'failed') {
        if (!(verdict === 'timeout' || verdict === 'error')) return false;
      } else if (gradeF === 'none') {
        if (g != null || verdict === 'timeout' || verdict === 'error') return false;
      } else if (gradeF !== 'all' && g !== gradeF) return false;

      if (platF !== 'all' && !t.platforms.has(platF)) return false;
      if (gateF === 'blocked' && t.gateUnhealthy + t.gateCheat === 0) return false;
      if (gateF === 'bought' && !t.boughtEver) return false;
      if (gateF === 'blacklisted' && t.gateCheat === 0 && g !== 'cheat') return false;
      if (search && !(t.address.includes(search) || (t.symbol || '').toLowerCase().includes(search))) return false;
      return true;
    });

    document.getElementById('token-count-label').textContent = `${this.filtered.length} 个代币`;

    const tbody = document.getElementById('tokens-tbody');
    tbody.innerHTML = this.filtered.map(t => this._tokenRowHtml(t)).join('');
  }

  _gradeBadgeHtml(grade, verdict) {
    const meta = CHEAT_GRADE_META[grade];
    if (meta) {
      return `<span class="px-2 py-0.5 rounded ${meta.cls} whitespace-nowrap">${meta.emoji} ${meta.label}</span>`;
    }
    if (verdict === 'timeout') return '<span class="px-2 py-0.5 rounded cheat-grade-plain">⏱ timeout</span>';
    if (verdict === 'error') return '<span class="px-2 py-0.5 rounded cheat-grade-plain">❗ error</span>';
    return '<span class="px-2 py-0.5 rounded cheat-grade-plain">未分级</span>';
  }

  _tokenRowHtml(t) {
    const latest = t.latest || {};
    const reasons = (latest.grade_reasons || []).map(r =>
      `<code class="mr-1 ${r.level === 'cheat' ? 'text-red-400' : 'text-orange-300'}" title="${this._esc(r.level)}">${this._esc(String(r.code).replace(/^(L_insider_sell).*/, '$1'))}</code>`
    ).join('') || '<span class="text-gray-500">—</span>';

    const traj = t.rounds.map(r => {
      const g = r.grade;
      const cls = g ? (CHEAT_GRADE_META[g]?.dot || 'traj-fail') : 'traj-fail';
      return `<span class="traj-dot ${cls}" title="${new Date(r.analyzed_at).toLocaleTimeString('zh-CN', { hour12: false })} ${g || r.verdict}"></span>`;
    }).join('');

    const part = ExperimentCheatAnalysis._pick(latest, 'participation');
    const act = ExperimentCheatAnalysis._pick(latest, 'activity_level');
    const bd = ExperimentCheatAnalysis._pick(latest, 'bundled_dominance');
    const roles = [
      part ? `<span class="text-gray-300" title="真实参与">${PARTICIPATION_SHORT[part] || part}</span>` : '<span class="text-gray-600">–</span>',
      act ?? '<span class="text-gray-600">–</span>',
      bd ?? '<span class="text-gray-600">–</span>',
    ].join(' / ');

    const keyLevels = [
      ['等', latest.phenomena?.equal_amount_split],
      ['卖', latest.phenomena?.coordinated_sell_back],
      ['创', latest.phenomena?.creator_front_run],
      ['散', latest.phenomena?.sell_dispersion],
      ['敲', latest.ext_levels?.wash_pair],
      ['衡', latest.ext_levels?.holdings_balance],
    ].map(([tag, lv]) => lv
      ? `<span class="${lv === 'strong' ? 'text-red-400' : lv === 'moderate' ? 'text-orange-300' : 'text-yellow-200'}" title="${tag}=${lv}">${tag}${lv === 'strong' ? '!' : lv === 'moderate' ? '+' : ''}</span>`
      : `<span class="text-gray-600">${tag}·</span>`
    ).join(' ');

    const gateBits = [];
    if (t.gateCheat > 0) gateBits.push(`<span class="text-red-400">拉黑拒买×${t.gateCheat}</span>`);
    if (t.gateUnhealthy > 0) gateBits.push(`<span class="text-orange-300">不健康拒买×${t.gateUnhealthy}</span>`);
    if (t.boughtEver) gateBits.push('<span class="text-green-400">已买</span>');
    const gateHtml = gateBits.length
      ? gateBits.join('<br>')
      : '<span class="text-gray-500">未触发</span>';

    const netBnb = t.netBnb != null && Number.isFinite(t.netBnb)
      ? `<span class="${t.netBnb >= 0 ? 'text-green-400' : 'text-red-400'}">${t.netBnb >= 0 ? '+' : ''}${t.netBnb.toFixed(4)}</span>`
      : '<span class="text-gray-600">—</span>';

    const short = t.address ? `${t.address.slice(0, 6)}…${t.address.slice(-4)}` : '?';
    const symbol = t.symbol || '未知';
    const expanded = this.expanded.has(t.address);

    const row = `
      <tr class="border-t border-gray-700 cursor-pointer hover:bg-gray-750" data-addr="${t.address}" onclick="window.experimentCheatAnalysis._toggleRow('${t.address}')">
        <td class="py-2 px-3">
          <a href="/experiment/${this.experimentId}/signals#token=${t.address}" target="_blank"
             class="text-yellow-400 font-semibold hover:underline mr-1" title="打开信号页（含反作弊判定标注）" onclick="event.stopPropagation()">${this._esc(symbol)}</a>
          <code class="text-green-400" title="${t.address}">${short}</code>
        </td>
        <td class="py-2 px-2 text-gray-300">${[...t.platforms].join(',') || '—'}</td>
        <td class="py-2 px-2 text-gray-300">${t.rounds.length}</td>
        <td class="py-2 px-2">${traj || '—'}</td>
        <td class="py-2 px-2">${this._gradeBadgeHtml(latest.grade, latest.verdict)}</td>
        <td class="py-2 px-2 max-w-xs">${reasons}</td>
        <td class="py-2 px-2 text-gray-300 whitespace-nowrap">${roles}</td>
        <td class="py-2 px-2 whitespace-nowrap">${keyLevels}</td>
        <td class="py-2 px-2 text-right text-gray-300">${latest.tick_count ?? '—'}</td>
        <td class="py-2 px-2 text-right text-gray-300 whitespace-nowrap" title="锚窗买/卖 BNB（最新行）">${latest.buy_bnb ?? '—'} / ${latest.sell_bnb ?? '—'}</td>
        <td class="py-2 px-2 whitespace-nowrap">${gateHtml}</td>
        <td class="py-2 px-2 text-gray-400 whitespace-nowrap">${latest.analyzed_at ? new Date(latest.analyzed_at).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
      </tr>`;

    if (!expanded) return row;

    // 展开区：全部判定轮次
    const roundsHtml = t.rounds.map((r, i) => {
      const part2 = ExperimentCheatAnalysis._pick(r, 'participation');
      const act2 = ExperimentCheatAnalysis._pick(r, 'activity_level');
      const bd2 = ExperimentCheatAnalysis._pick(r, 'bundled_dominance');
      const rs = (r.grade_reasons || []).map(x =>
        `<code class="mr-1 ${x.level === 'cheat' ? 'text-red-400' : 'text-orange-300'}">${this._esc(String(x.code).replace(/^(L_insider_sell).*/, '$1'))}</code>`
      ).join('') || '<span class="text-gray-500">—</span>';
      return `
        <tr class="border-t border-gray-800">
          <td class="py-1.5 px-2 text-gray-400">R${i + 1}</td>
          <td class="py-1.5 px-2 text-gray-300 whitespace-nowrap">${new Date(r.analyzed_at).toLocaleString('zh-CN', { hour12: false })}</td>
          <td class="py-1.5 px-2">${this._gradeBadgeHtml(r.grade, r.verdict)}</td>
          <td class="py-1.5 px-2">${rs}</td>
          <td class="py-1.5 px-2 text-gray-300">${r.tick_count ?? '—'} ticks</td>
          <td class="py-1.5 px-2 text-gray-300">${r.buy_bnb ?? '—'} / ${r.sell_bnb ?? '—'}</td>
          <td class="py-1.5 px-2 text-gray-300">${part2 ? (PARTICIPATION_SHORT[part2] || part2) : '–'} / ${act2 ?? '–'} / ${bd2 ?? '–'}</td>
          <td class="py-1.5 px-2 text-gray-400">${this._esc(r.fail_reason || '')}</td>
        </tr>`;
    }).join('');

    return row + `
      <tr class="border-t border-gray-800 bg-gray-900">
        <td colspan="12" class="p-3">
          <div class="flex flex-wrap gap-4 mb-2 text-xs text-gray-400">
            <span>判定轮次轨迹（帽 ${t.rounds.length}/${this.experimentData?.config?.fourmemeWs?.cheatCheck?.maxAnalysesPerToken ?? 4}）：</span>
            ${t.netBnb != null ? `<span>实验净 BNB：${netBnb}</span>` : ''}
            <a class="text-blue-400 hover:underline" target="_blank" href="/token-ticks?token=${t.address}">Ticks 浏览 ↗</a>
          </div>
          <table class="w-full text-xs">
            <thead><tr class="text-gray-500 border-b border-gray-700">
              <th class="py-1 px-2 text-left">轮</th><th class="py-1 px-2 text-left">判定时刻</th>
              <th class="py-1 px-2 text-left">判定</th><th class="py-1 px-2 text-left">原因</th>
              <th class="py-1 px-2 text-left">锚窗</th><th class="py-1 px-2 text-left">买/卖 BNB</th>
              <th class="py-1 px-2 text-left">参与/活跃/捆绑</th><th class="py-1 px-2 text-left">失败原因</th>
            </tr></thead>
            <tbody>${roundsHtml}</tbody>
          </table>
        </td>
      </tr>`;
  }

  _toggleRow(addr) {
    if (this.expanded.has(addr)) this.expanded.delete(addr);
    else this.expanded.add(addr);
    this.renderTokens();
  }

  _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  window.experimentCheatAnalysis = new ExperimentCheatAnalysis();
});
