/**
 * Ticks 浏览页（/token-ticks?token=<address>，与实验无关）
 *
 * 移植自 pumpfun-wss-trader /token/:address（BSC 适配：block_number 聚合、BNB 计价、
 * BscScan 外链）；pumpfun 特有的钱包评分/trigger/庄散区块不迁（Solana 钱包画像体系，
 * richer-js 有独立 token-holders 页）。
 *
 * 数据源：
 *   - GET /api/token-ticks/info?token=X   代币基本信息（experiment_tokens 最近一条，可空）
 *   - GET /api/ticks?tokenAddress=X       全历史 ticks（UNIQUE(tx_hash, log_index) 全网去重，
 *                                         price_outlier=false、price_usd 非空口径）
 */
class TokenTicksPage {
  constructor() {
    this.tokenAddress = new URLSearchParams(window.location.search).get('token') || '';
    this.tokenInfo = null;
    this.chart = null;
    this.candleChart = null;   // 区块 K 线主图（candlestick）
    this.volumeChart = null;   // 区块 K 线副图（成交量 bar）

    // ⭐ famous 钱包名单（/api/rosters/famous-wallets，famous-copy-wallets.json 同源）：
    // 价格图 famous 操作标记的数据源（与 signals 页同款）；null=未加载/拉取失败
    // （零标记 fail-open 不阻塞主图）
    this._famousWallets = null;
    this._famousProfiles = null; // addr → GMGN 身份档案（twitter_username 等，可缺席）
    this._famousRosterPromise = null;

    // 🧠 聪明钱钱包名单（/api/rosters/smart-money-wallets，smartmoney-accum.json 同源）：
    // 价格图聪明钱操作标记（与 signals 页同款）；null=未加载/失败（零标记 fail-open）。
    // 与 famous 分层：famous 名单优先——交集钱包行归 famous 气泡，聪明钱标记跳过防双计
    this._smartWallets = null;
    this._smartProfiles = null; // addr → { twitterUsername, tags, hits, usd }（可缺席）
    this._smartRosterPromise = null;

    // BP 测试集点位（?bp=<setName> 直达；2026-11-05 BP3）
    this.bpSetName = new URLSearchParams(window.location.search).get('bp') || '';
    this.bpPoints = null;      // 当前 token 的点位（[{pointId, source, signalInfo, anchorTickCount, forwardReturns, ladder, ...}]）
    this.bpSetMeta = null;     // {name, builtAt, sampleRule, counts}

    // 交易明细
    this.currentPage = 1;
    this.pageSize = 50;
    this.totalTicks = 0;
    this.filters = { tradeType: 'all', from: '', to: '' };
    this.tickWindowSec = null;
    this.firstTickTime = null;   // 首个 tick 时间（时段基准）
    this.firstTickBlock = null;  // 首个 block_number（区块序号基准）

    this.init();
  }

  async init() {
    if (!this.tokenAddress) {
      document.getElementById('token-address').textContent = '地址缺失（?token= 参数必填）';
      return;
    }
    document.getElementById('token-address').textContent = this.tokenAddress;

    // 外链
    const setHref = (id, url) => { const el = document.getElementById(id); if (el) el.href = url; };
    setHref('gmgn-token-btn', `https://gmgn.ai/bsc/token/${this.tokenAddress}`);
    setHref('bscscan-token-btn', `https://bscscan.com/token/${this.tokenAddress}`);
    setHref('fourmeme-btn', `https://four.meme/en/token/${this.tokenAddress}`);
    setHref('dexscreener-btn', `https://dexscreener.com/bsc/${this.tokenAddress}`);

    const copyBtn = document.getElementById('copy-token-btn');
    if (copyBtn) copyBtn.addEventListener('click', () => this._copyText(this.tokenAddress, copyBtn));
    document.getElementById('refresh-btn')?.addEventListener('click', () => location.reload());

    this._bindEvents();
    await this._waitForChartJS();

    this._loadTokenInfo();
    // ⭐famous/🧠聪明钱 名单先就位（图表标记依赖；memoized，失败=空集零标记 fail-open；
    // 必须在 _loadBpSets 之前——?bp= 直达路径内部会直接画图，晚到名单会漏标记）
    await Promise.all([this.ensureFamousRoster(), this.ensureSmartRoster()]);
    await this._loadBpSets();   // BP 点位先到（图叠画依赖 bpPoints 已就位）
    await this._loadChartData();
    await this._loadTableData();
  }

  _bindEvents() {
    const $ = id => document.getElementById(id);
    $('apply-filters')?.addEventListener('click', () => this._applyFilters());
    $('prev-page')?.addEventListener('click', () => this._goToPage(this.currentPage - 1));
    $('next-page')?.addEventListener('click', () => this._goToPage(this.currentPage + 1));
    $('apply-tick-window')?.addEventListener('click', () => this._applyTickWindow());
    $('reset-tick-window')?.addEventListener('click', () => this._resetTickWindow());
    $('tick-time-window')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this._applyTickWindow(); } });
  }

  async _waitForChartJS() {
    let attempts = 0;
    while (typeof Chart === 'undefined' && attempts < 20) { await new Promise(r => setTimeout(r, 500)); attempts++; }
  }

  _copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent; btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; }, 1000);
    }).catch(() => {});
  }

  // ── token 信息（experiment_tokens 最近一条，无也不阻塞页面）──
  async _loadTokenInfo() {
    try {
      const resp = await fetch(`/api/token-ticks/info?token=${encodeURIComponent(this.tokenAddress)}`);
      const j = await resp.json();
      if (!j.success || !j.data) return;
      this.tokenInfo = j.data;
      const sym = this.tokenInfo.token_symbol || '-';
      const creator = this.tokenInfo.creator_address || '';
      const discovered = this.tokenInfo.discovered_at
        ? new Date(this.tokenInfo.discovered_at).toLocaleString('zh-CN') : '';
      const parts = [`<b class="text-white">${this._esc(sym)}</b>`];
      if (creator) {
        parts.push(`creator <a href="https://bscscan.com/address/${creator}" target="_blank" rel="noopener noreferrer" class="text-yellow-400 hover:underline font-mono text-xs" title="${this._esc(creator)}">${this._shortAddr(creator)}</a>`);
      }
      if (discovered) parts.push(`发现于 <span class="text-gray-300">${discovered}</span>`);
      const summary = document.getElementById('token-summary');
      if (summary) summary.innerHTML = parts.join(' · ');
    } catch (e) { /* 忽略：信息缺失不影响 ticks 浏览 */ }
  }

  // ── ⭐famous / 🧠聪明钱 名单标记（与 signals 页同源同口径）─────────
  // 名单缺席/失败=空集零标记 fail-open，不阻塞主图（signals 页同策略）。

  /** ⭐ 拉取 famous 钱包名单（memoized：页面生命周期内拉一次；失败也 memoize 成空 Set） */
  ensureFamousRoster() {
    if (this._famousWallets) return Promise.resolve(this._famousWallets);
    if (!this._famousRosterPromise) {
      this._famousRosterPromise = fetch('/api/rosters/famous-wallets')
        .then(r => (r.ok ? r.json() : null))
        .then(json => {
          const wallets = (json?.success && Array.isArray(json.data?.wallets)) ? json.data.wallets : [];
          this._famousWallets = new Set(wallets.map(w => String(w).toLowerCase()));
          this._famousProfiles = json?.data?.profiles || null;
          console.log(`⭐ famous 名单加载: ${this._famousWallets.size} 址 (v${json?.data?.version ?? '?'})`);
          return this._famousWallets;
        })
        .catch(err => {
          console.warn('⚠️ famous 名单加载失败，价格图将无 famous 标记:', err);
          this._famousWallets = new Set();
          return this._famousWallets;
        });
    }
    return this._famousRosterPromise;
  }

  /** 🧠 拉取聪明钱钱包名单（memoized；失败也 memoize 成空 Set） */
  ensureSmartRoster() {
    if (this._smartWallets) return Promise.resolve(this._smartWallets);
    if (!this._smartRosterPromise) {
      this._smartRosterPromise = fetch('/api/rosters/smart-money-wallets')
        .then(r => (r.ok ? r.json() : null))
        .then(json => {
          const wallets = (json?.success && Array.isArray(json.data?.wallets)) ? json.data.wallets : [];
          this._smartWallets = new Set(wallets.map(w => String(w).toLowerCase()));
          this._smartProfiles = json?.data?.profiles || null;
          console.log(`🧠 聪明钱名单加载: ${this._smartWallets.size} 址 (快照 ${json?.data?.meta?.snapshots ?? '?'})`);
          return this._smartWallets;
        })
        .catch(err => {
          console.warn('⚠️ 聪明钱名单加载失败，价格图将无聪明钱标记:', err);
          this._smartWallets = new Set();
          return this._smartWallets;
        });
    }
    return this._smartRosterPromise;
  }

  /** ⭐ famous 钱包显示名：@twitter_username 优先 → twitter_name → GMGN name → null */
  _famousLabel(wallet) {
    const p = this._famousProfiles && this._famousProfiles[wallet];
    if (!p) return null;
    if (p.twitterUsername) return `@${p.twitterUsername}`;
    if (p.twitterName) return p.twitterName;
    if (p.name) return p.name;
    return null;
  }

  /** 🧠 聪明钱钱包显示名：@twitter 优先 → name → null（null=tooltip 回落地址缩写） */
  _smartLabel(wallet) {
    const p = this._smartProfiles && this._smartProfiles[wallet];
    if (!p) return null;
    if (p.twitterUsername) return `@${p.twitterUsername}`;
    if (p.name) return p.name;
    return null;
  }

  /**
   * 名单钱包操作点位通用构建器（famous/聪明钱共用；气泡图气泡/K线图 scatter 双图表）：
   * wallet 口径 = sender_address || trader_address（与 FA/引擎、signals 页一致）；
   * 名单缺席=空数组；价格/金额门槛与主气泡同口径（MIN_BNB=0.005、price_usd 有效）。
   * exclude=更高优先级名单地址集合（famous）——交集钱包行归高优先级标记防双计。
   */
  _buildRosterMarkPoints(tickData, wallets, kind, metaFn, exclude) {
    const buyPoints = [], sellPoints = [];
    if (!wallets || wallets.size === 0) return { buyPoints, sellPoints };
    const MIN_BNB = 0.005; // 与主气泡同口径（小额 tick 价格精度不足）
    for (const tick of tickData) {
      const wallet = (tick.sender_address || tick.trader_address || '').toLowerCase();
      if (!wallet || !wallets.has(wallet)) continue;
      if (exclude && exclude.size > 0 && exclude.has(wallet)) continue;
      const bnbAmount = parseFloat(tick.bnb_amount) || 0;
      if (bnbAmount < MIN_BNB) continue;
      const priceUsd = parseFloat(tick.price_usd);
      if (!priceUsd || priceUsd <= 0) continue;
      const tradeType = tick.trade_type === 'buy' ? '买' : '卖';
      (tick.trade_type === 'buy' ? buyPoints : sellPoints).push({
        x: new Date(tick.block_time).getTime(),
        y: priceUsd,
        r: this._mapRadius(bnbAmount),
        [kind]: { wallet, bnb: bnbAmount, tradeType, ...metaFn(wallet) },
      });
    }
    return { buyPoints, sellPoints };
  }

  /** ⭐ famous 操作点位（金=买/紫=卖）：{x,y,r,_famous:{wallet,bnb,tradeType,label}} */
  _buildFamousPoints(tickData) {
    return this._buildRosterMarkPoints(
      tickData, this._famousWallets, '_famous', (w) => ({ label: this._famousLabel(w) }));
  }

  /** 🧠 聪明钱操作点位（青=买/粉=卖）：famous 名单优先——交集钱包归 famous 防双计 */
  _buildSmartPoints(tickData) {
    return this._buildRosterMarkPoints(
      tickData, this._smartWallets, '_smart',
      (w) => {
        const p = this._smartProfiles && this._smartProfiles[w];
        return {
          label: this._smartLabel(w),
          tags: (p && Array.isArray(p.tags)) ? p.tags : [],
          hits: (p && Number(p.hits)) || 0,
          usd: (p && Number(p.usd)) || 0, // GMGN smartmoney 流出现次数/累计成交 USD（研究档案）
        };
      },
      this._famousWallets);
  }

  // ── BP 测试集点位（set JSON 本地文件；182 构建后 scp 回本地）──
  async _loadBpSets() {
    const sel = document.getElementById('bp-set-select');
    if (!sel) return;
    try {
      const resp = await fetch('/api/buy-point-sets');
      const j = await resp.json();
      const sets = (j.success && j.data) || [];
      sel.innerHTML = '<option value="">— 选择 BP 测试集 —</option>'
        + sets.map(s => `<option value="${this._esc(s.name)}">${this._esc(s.name)}（${s.points} 点位 / ${s.tokens} token${s.source ? ' / ' + s.source : ''}）</option>`).join('');
      sel.disabled = sets.length === 0;
      if (sets.length === 0) {
        document.getElementById('bp-section').classList.add('hidden');
        return;
      }
      document.getElementById('bp-section').classList.remove('hidden');
      sel.addEventListener('change', () => this._onBpSetChange());
      if (this.bpSetName && sets.some(s => s.name === this.bpSetName)) {
        sel.value = this.bpSetName;
        await this._loadBpPoints(this.bpSetName);
      }
    } catch (e) {
      console.warn('BP set 列表加载失败:', e);
      document.getElementById('bp-section').classList.add('hidden');
    }
  }

  async _onBpSetChange() {
    const sel = document.getElementById('bp-set-select');
    const name = sel ? sel.value : '';
    this.bpSetName = name;
    this._syncBpUrl();
    if (!name) { this.bpPoints = null; this.bpSignals = null; this.bpSetMeta = null; this._renderBpSection(); await this._loadChartData(); return; }
    await this._loadBpPoints(name);
  }

  _syncBpUrl() {
    const url = new URL(window.location);
    if (this.bpSetName) url.searchParams.set('bp', this.bpSetName); else url.searchParams.delete('bp');
    window.history.replaceState({}, '', url);
  }

  async _loadBpPoints(name) {
    this.bpSignals = null; // 信号触发点标记（含被拒腿；伴生 -signals.json 缺=无）
    try {
      const resp = await fetch(`/api/buy-point-set?set=${encodeURIComponent(name)}&token=${encodeURIComponent(this.tokenAddress)}`);
      const j = await resp.json();
      if (!j.success) throw new Error(j.error || `HTTP ${resp.status}`);
      const doc = j.data || {};
      this.bpPoints = doc.points || [];
      this.bpSignals = doc.signals || null;
      this.bpSetMeta = { name: doc.setName || name, builtAt: doc.builtAt, sampleRule: doc.sampleRule, counts: doc.counts };
    } catch (e) {
      console.warn('BP set 点位加载失败:', e);
      this.bpPoints = [];
      this.bpSetMeta = { name, error: e.message };
    }
    this._renderBpSection();
    await this._loadChartData(); // 重画图叠点位
  }

  _renderBpSection() {
    this._renderBpSignals();
    const tbody = document.getElementById('bp-table-body');
    const info = document.getElementById('bp-set-info');
    if (!tbody) return;
    if (!this.bpSetMeta) { tbody.innerHTML = ''; if (info) info.textContent = ''; return; }
    const pts = this.bpPoints || [];
    if (info) {
      const c = this.bpSetMeta.counts;
      info.textContent = this.bpSetMeta.error
        ? `加载失败: ${this.bpSetMeta.error}`
        : `本 token ${pts.length} 点位${c ? ` · 全集 ${c.points} 点位（${c.pointsBySource ? Object.entries(c.pointsBySource).map(([k, v]) => `${k} ${v}`).join(' + ') : ''}）` : ''}`;
    }
    if (!pts.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="px-3 py-4 text-gray-500 text-center">本 token 无收录点位</td></tr>';
      return;
    }
    const fwdCell = (p, sec) => {
      const f = p.forwardReturns && p.forwardReturns.byHorizon && p.forwardReturns.byHorizon[sec];
      if (!f) return '<span class="text-gray-600">-</span>';
      const riseCls = f.maxRisePct >= 20 ? 'text-green-400' : f.maxRisePct >= 0 ? 'text-gray-200' : 'text-red-400';
      return `<span class="${riseCls}">${f.maxRisePct >= 0 ? '+' : ''}${f.maxRisePct.toFixed(1)}%/${f.lastPct >= 0 ? '+' : ''}${f.lastPct.toFixed(1)}%</span>`;
    };
    const epCell = (p) => {
      const ep = p.trade && p.trade.episode;
      if (!ep) return '<span class="text-gray-600">-</span>';
      const pnl = ep.pnlBnb;
      if (pnl == null) return `<span class="text-gray-400">${ep.open ? '持仓中' : 'pnl 缺'}</span>`;
      const cls = pnl >= 0 ? 'text-green-400' : 'text-red-400';
      return `<span class="${cls}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}</span>`;
    };
    tbody.innerHTML = pts.map(p => {
      const isLadder = p.source === 'ladder';
      const srcBadge = isLadder
        ? '<span class="px-2 py-0.5 text-xs rounded-full bg-purple-900 text-purple-300">ladder</span>'
        : p.source === 'signals'
          ? '<span class="px-2 py-0.5 text-xs rounded-full bg-cyan-900 text-cyan-300">signal</span>'
          : '<span class="px-2 py-0.5 text-xs rounded-full bg-orange-900 text-orange-300">trade</span>';
      const strat = isLadder
        ? `<span class="font-mono text-purple-300" title="${this._esc(p.ladder ? p.ladder.condition : '')}">${this._esc(p.signalInfo && p.signalInfo.strategyName || p.ladder && p.ladder.legId || '?')}</span>`
        : this._esc(p.signalInfo && p.signalInfo.strategyName || '-');
      const price = p.signalInfo && p.signalInfo.price;
      return `<tr class="hover:bg-gray-750 transition-colors">
        <td class="px-3 py-2 font-mono text-gray-300">${this._esc(p.pointId)}</td>
        <td class="px-3 py-2">${srcBadge}</td>
        <td class="px-3 py-2">${strat}</td>
        <td class="px-3 py-2 text-gray-300 whitespace-nowrap">${new Date(p.signalCreatedAt).toLocaleString('zh-CN')}</td>
        <td class="px-3 py-2 text-right font-mono text-gray-400">${p.anchorTickCount}${p.thin ? '<span class="text-yellow-500" title="锚<8 行 thin">·t</span>' : ''}${p.anchorZero ? '<span class="text-red-500" title="锚 0">·z</span>' : ''}</td>
        <td class="px-3 py-2 text-right font-mono text-gray-300">${price != null ? price.toExponential(2) : '-'}</td>
        <td class="px-3 py-2 text-right font-mono">${fwdCell(p, 60)}</td>
        <td class="px-3 py-2 text-right font-mono">${fwdCell(p, 300)}</td>
        <td class="px-3 py-2 text-right font-mono">${fwdCell(p, 900)}</td>
        <td class="px-3 py-2 text-right font-mono">${epCell(p)}</td>
      </tr>`;
    }).join('');
  }

  /** 信号触发点子表（含被拒腿；伴生 -signals.json 缺=整表隐藏） */
  _renderBpSignals() {
    const wrap = document.getElementById('bp-signals-wrap');
    const tbody = document.getElementById('bp-signals-body');
    if (!wrap || !tbody) return;
    const sigs = this.bpSignals || [];
    if (!sigs.length) { wrap.classList.add('hidden'); tbody.innerHTML = ''; return; }
    wrap.classList.remove('hidden');
    const pct = (v) => v == null ? '<span class="text-gray-600">-</span>'
      : `<span class="${v >= 20 ? 'text-green-400' : v >= 0 ? 'text-gray-200' : 'text-red-400'}">${v >= 0 ? '+' : ''}${v}%</span>`;
    const fwdCell = (s, sec) => {
      const f = s.fwd && s.fwd[String(sec)];
      if (!f || f.mx == null) return '<span class="text-gray-600">-</span>';
      return `<span class="font-mono">${pct(f.mx)} <span class="text-gray-500">/</span> ${pct(f.last)}</span>`;
    };
    const execBadge = (s) => {
      if (s.exec === 'executed') return '<span class="px-2 py-0.5 text-xs rounded-full bg-green-900 text-green-300">成交</span>';
      const r = s.reason || '';
      const cls = r.startsWith('bp_gate_') || r.startsWith('cheat_') ? 'bg-red-900 text-red-300' : 'bg-yellow-900 text-yellow-300';
      return `<span class="px-2 py-0.5 text-xs rounded-full ${cls}" title="${this._esc(r || s.exec || '')}">${this._esc(r || s.exec || '?')}</span>`;
    };
    tbody.innerHTML = sigs.map((s) => `<tr class="hover:bg-gray-750 transition-colors">
        <td class="px-3 py-2 font-mono text-cyan-300">${this._esc(s.leg || s.legId || '?')}${s.triggerNo != null ? `<span class="text-gray-500 text-xs">#${s.triggerNo}</span>` : ''}</td>
        <td class="px-3 py-2 text-gray-300 whitespace-nowrap">${new Date(s.at).toLocaleString('zh-CN')}</td>
        <td class="px-3 py-2 text-right font-mono text-cyan-300">${s.tickNo}<span class="text-gray-500">/${s.totalTicks}</span></td>
        <td class="px-3 py-2 text-right font-mono">${pct(s.vsFirstPct)}</td>
        <td class="px-3 py-2 text-right font-mono text-gray-300">${s.priceBnb != null ? s.priceBnb.toExponential(2) : '-'}</td>
        <td class="px-3 py-2 text-right font-mono">${fwdCell(s, 60)}</td>
        <td class="px-3 py-2 text-right font-mono">${fwdCell(s, 300)}</td>
        <td class="px-3 py-2 text-right font-mono">${fwdCell(s, 900)}</td>
        <td class="px-3 py-2">${execBadge(s)}</td>
      </tr>`).join('');
  }

  /** 点位叠画 dataset（scatter 三角/菱形；y=锚时刻最近 tick 的 price_usd——USD 轴对齐） */
  _bpScatterDatasets(tickData) {
    if (!this.bpPoints || !this.bpPoints.length) return [];
    // 时间窗（「只显示代币发出后 N 秒内的 ticks」）启用时窗外点位不叠画：
    // 与服务端 withinSeconds 同基=首个 tick 的 block_time；窗外点会把 time 轴拉宽、窗内 ticks 压扁
    const winEndMs = (this.tickWindowSec && this.firstTickTime != null)
      ? this.firstTickTime + this.tickWindowSec * 1000 : null;
    const trades = [], ladder = [], trig = [];
    for (const p of this.bpPoints) {
      const ts = new Date(p.signalCreatedAt).getTime();
      if (!Number.isFinite(ts)) continue;
      if (winEndMs != null && ts > winEndMs) continue; // 窗外点位——不展示
      const y = this._anchorPriceUsd(tickData, ts);
      if (y == null) continue; // 图窗内无价格行（点位在窗外）——不冒充
      const raw = { _bp: true, pointId: p.pointId, source: p.source, strategy: (p.signalInfo && p.signalInfo.strategyName) || (p.ladder && p.ladder.legId) || '-', anchor: p.anchorTickCount, fwd: p.forwardReturns, ladder: p.ladder };
      const pt = { x: ts, y, _bpRaw: raw };
      if (p.source === 'ladder') ladder.push(pt);
      else if (p.source === 'signals') trig.push(pt); // 信号源集=触发点位非成交点
      else trades.push(pt);
    }
    const mk = (data, color, pointStyle, label) => ({ type: 'scatter', label, data,
      pointStyle, pointRadius: 7, pointHoverRadius: 9, backgroundColor: color, borderColor: color, borderWidth: 1 });
    const out = [];
    // 信号触发点（含被拒腿）排最前=最上层：复审看的是触发位（成交点只晚几秒但口径不同）
    if (this.bpSignals && this.bpSignals.length) {
      const sigPts = [];
      for (const s of this.bpSignals) {
        const ts = new Date(s.at).getTime();
        if (!Number.isFinite(ts)) continue;
        if (winEndMs != null && ts > winEndMs) continue;
        const y = this._anchorPriceUsd(tickData, ts);
        if (y == null) continue;
        sigPts.push({ x: ts, y, _sigRaw: s });
      }
      if (sigPts.length) out.push({ type: 'scatter', label: `信号触发点 (${sigPts.length})`, data: sigPts,
        pointStyle: 'circle', pointRadius: 5, pointHoverRadius: 8,
        backgroundColor: 'rgba(34,211,238,0.95)', borderColor: 'rgba(8,145,178,1)', borderWidth: 1 });
    }
    if (trades.length) out.push(mk(trades, 'rgba(251,146,60,0.95)', 'triangle', `BP 成交买点 (${trades.length})`));
    if (ladder.length) out.push(mk(ladder, 'rgba(192,132,252,0.95)', 'rectRot', `BP ladder 挖掘 (${ladder.length})`));
    if (trig.length) out.push(mk(trig, 'rgba(34,211,238,0.95)', 'circle', `BP 触发点位 (${trig.length})`));
    return out;
  }

  /** 二分找 ≤ts 最近 tick 的 price_usd（tickData block_time 升序） */
  _anchorPriceUsd(tickData, tsMs) {
    if (!tickData || !tickData.length) return null;
    let lo = 0, hi = tickData.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = new Date(tickData[mid].block_time).getTime();
      if (Number.isFinite(t) && t <= tsMs) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    // best 起回扫最近的有效价（个别行 price_usd 空）
    for (let i = best; i >= 0 && i > best - 20; i--) {
      const v = parseFloat(tickData[i].price_usd);
      if (Number.isFinite(v) && v > 0) return v;
    }
    return null;
  }

  _bpTooltip(item) {
    const s = item.raw && item.raw._sigRaw;
    if (s) {
      const lines = [
        `🎯 信号触发 ${s.leg || s.legId || '?'} · tick#${s.tickNo}/${s.totalTicks}`,
        `时刻 ${new Date(s.at).toLocaleTimeString('zh-CN')}${s.vsFirstPct != null ? ` · vs 首笔 ${s.vsFirstPct >= 0 ? '+' : ''}${s.vsFirstPct}%` : ''}`,
        `结果 ${s.exec || '?'}${s.reason ? ` · ${s.reason}` : ''}`,
      ];
      if (s.fwd) {
        for (const sec of [60, 300, 900]) {
          const f = s.fwd[String(sec)];
          lines.push(`+${sec / 60}min: ${f && f.mx != null ? `${f.mx >= 0 ? '+' : ''}${f.mx}% 峰 / ${f.last >= 0 ? '+' : ''}${f.last}% 末` : 'null'}`);
        }
      }
      return lines;
    }
    const r = item.raw && item.raw._bpRaw;
    if (!r) return null;
    const lines = [`📍 ${r.pointId} [${r.source}] 策略:${r.strategy}`, `锚 ${r.anchor} ticks`];
    const fwd = r.fwd && r.fwd.byHorizon;
    if (fwd) {
      for (const sec of [60, 300, 900]) {
        const f = fwd[sec];
        lines.push(`+${sec / 60}min: ${f ? `${f.maxRisePct >= 0 ? '+' : ''}${f.maxRisePct}% 峰 / ${f.lastPct >= 0 ? '+' : ''}${f.lastPct}% 末` : 'null'}`);
      }
    }
    if (r.ladder && r.ladder.factors) {
      const f = r.ladder.factors;
      lines.push(`tradeCount=${f.tradeCount} buyVol=${f.buyVolumeBnb} holders=${f.holdersExDust}`);
    }
    return lines;
  }

  // ── 图表数据（全量窗口，limit 5000）─────────────────────────
  async _loadChartData() {
    try {
      const params = new URLSearchParams({ tokenAddress: this.tokenAddress, limit: '5000' });
      if (this.filters.tradeType !== 'all') params.set('tradeType', this.filters.tradeType);
      if (this.filters.from) params.set('from', this.filters.from);
      if (this.filters.to) params.set('to', this.filters.to);
      if (this.tickWindowSec) params.set('withinSeconds', String(this.tickWindowSec));

      const resp = await fetch(`/api/ticks?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json();
      if (!result.success || !result.data?.length) {
        document.getElementById('chart-wrapper').style.display = 'none';
        document.getElementById('candle-chart-wrapper').style.display = 'none';
        return;
      }
      document.getElementById('chart-wrapper').style.display = 'block';
      // reduce 而非 Math.min(...arr)：5000 条 spread 有栈溢出风险
      const firstTick = result.data.reduce((acc, t) => {
        const ms = new Date(t.block_time).getTime();
        if (!Number.isFinite(ms)) return acc;
        if (acc.time == null || ms < acc.time) acc.time = ms;
        if (t.block_number != null && (acc.block == null || t.block_number < acc.block)) acc.block = t.block_number;
        return acc;
      }, { time: null, block: null });
      this.firstTickTime = firstTick.time;
      this.firstTickBlock = firstTick.block;
      this._initBubbleChart(result.data);
      this._initCandleChart(result.data);
    } catch (err) {
      console.error('加载图表数据失败:', err);
      document.getElementById('chart-wrapper').style.display = 'none';
      document.getElementById('candle-chart-wrapper').style.display = 'none';
    }
  }

  // ── 表格数据（分页）─────────────────────────────────────────
  async _loadTableData() {
    try {
      const params = new URLSearchParams({
        tokenAddress: this.tokenAddress,
        limit: String(this.pageSize),
        offset: String((this.currentPage - 1) * this.pageSize),
      });
      if (this.filters.tradeType !== 'all') params.set('tradeType', this.filters.tradeType);
      if (this.filters.from) params.set('from', this.filters.from);
      if (this.filters.to) params.set('to', this.filters.to);
      if (this.tickWindowSec) params.set('withinSeconds', String(this.tickWindowSec));

      const resp = await fetch(`/api/ticks?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json();
      const ticks = result.data || [];
      const pagination = result.pagination || {};
      this.totalTicks = pagination.total || 0;

      this._updateTickStats(ticks, this.totalTicks);
      this._renderTickTable(ticks);
      this._renderPagination();
    } catch (err) {
      console.error('加载表格数据失败:', err);
    }
  }

  // ── Bubble Chart ────────────────────────────────────────────
  _initBubbleChart(tickData) {
    const canvas = document.getElementById('tick-chart');
    if (!canvas) return;
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    const ctx = canvas.getContext('2d');
    const buys = [], sells = [];
    const MIN_BNB = 0.005; // 小额 tick 价格精度不足（与信号页散点图同口径）
    // ⭐famous/🧠聪明钱 操作点位（与 signals 页同款：独立气泡叠最顶层，
    // 主 buys/sells 剔除已标记行防双计——图例计数/悬停双气泡）
    const famousMarks = this._buildFamousPoints(tickData);
    const smartMarks = this._buildSmartPoints(tickData);
    const markedKeys = new Set([
      ...famousMarks.buyPoints, ...famousMarks.sellPoints,
      ...smartMarks.buyPoints, ...smartMarks.sellPoints,
    ].map(p => `${p.x}|${(p._famous || p._smart).wallet}`));
    for (const tick of tickData) {
      const bnbAmount = parseFloat(tick.bnb_amount) || 0;
      if (bnbAmount < MIN_BNB) continue;
      const priceUsd = parseFloat(tick.price_usd);
      if (!priceUsd || priceUsd <= 0) continue;
      const timestamp = new Date(tick.block_time).getTime();
      // famous/聪明钱行已进独立数据集，主数据集跳过
      const wallet = (tick.sender_address || tick.trader_address || '').toLowerCase();
      if (markedKeys.has(`${timestamp}|${wallet}`)) continue;
      const point = { x: timestamp, y: priceUsd, r: this._mapRadius(bnbAmount), _raw: tick };
      if (tick.trade_type === 'buy') buys.push(point); else sells.push(point);
    }
    this.chart = new Chart(ctx, {
      type: 'bubble',
      data: { datasets: [
        // ⭐famous 独立气泡（金=买/紫=卖）+ 🧠聪明钱独立气泡（青=买/粉=卖）：
        // 与 signals 页同款配色；Chart.js 倒序绘制——排最前=叠在普通气泡顶层
        // （famous 优先，交集钱包行已归 famous 跳过聪明钱标记防双计）
        {
          label: `⭐Famous买 (${famousMarks.buyPoints.length})`,
          data: famousMarks.buyPoints,
          backgroundColor: 'rgba(250,204,21,0.9)',
          borderColor: '#b45309',
          borderWidth: 1.5,
        },
        {
          label: `⭐Famous卖 (${famousMarks.sellPoints.length})`,
          data: famousMarks.sellPoints,
          backgroundColor: 'rgba(192,132,252,0.9)',
          borderColor: '#6b21a8',
          borderWidth: 1.5,
        },
        {
          label: `🧠聪明钱买 (${smartMarks.buyPoints.length})`,
          data: smartMarks.buyPoints,
          backgroundColor: 'rgba(14,165,233,0.9)',
          borderColor: '#0c4a6e',
          borderWidth: 1.5,
        },
        {
          label: `🧠聪明钱卖 (${smartMarks.sellPoints.length})`,
          data: smartMarks.sellPoints,
          backgroundColor: 'rgba(244,114,182,0.9)',
          borderColor: '#831843',
          borderWidth: 1.5,
        },
        // BP 点位紧随名单标记之后、主气泡之前：倒序绘制下仍压在普通气泡上层
        // （排尾部会被几百个半透明气泡堆叠近似不透明地埋掉，实测橙三角零像素）
        ...this._bpScatterDatasets(tickData),
        { label: `Buy (${buys.length})`, data: buys, backgroundColor: 'rgba(34,197,94,0.65)', borderColor: 'rgba(22,163,74,0.9)', borderWidth: 1 },
        { label: `Sell (${sells.length})`, data: sells, backgroundColor: 'rgba(239,68,68,0.65)', borderColor: 'rgba(220,38,38,0.9)', borderWidth: 1 },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 12, padding: 12 } },
          tooltip: { callbacks: {
            title(items) { return items.length ? new Date(items[0].raw.x).toLocaleString('zh-CN') : ''; },
            label: (item) => {
              // ⭐ famous 气泡：GMGN 用户名+钱包地址+金额（与 signals 页同款）
              if (item.raw._famous) {
                const f = item.raw._famous;
                const lines = [
                  `⭐Famous ${f.tradeType || ''} | ${f.bnb.toFixed(4)} BNB`,
                  `Price: $${item.raw.y.toExponential(3)}`,
                ];
                if (f.label) lines.push(f.label);
                lines.push(`钱包: ${f.wallet.slice(0, 8)}…${f.wallet.slice(-6)}`);
                return lines;
              }
              // 🧠 聪明钱气泡：twitter/标签+钱包地址+金额（GMGN smartmoney 流名单）
              if (item.raw._smart) {
                const f = item.raw._smart;
                const lines = [
                  `🧠聪明钱 ${f.tradeType || ''} | ${f.bnb.toFixed(4)} BNB`,
                  `Price: $${item.raw.y.toExponential(3)}`,
                ];
                if (f.label) lines.push(f.label);
                if (f.tags && f.tags.length) lines.push(`标签: ${f.tags.join(',')}`);
                if (f.hits) lines.push(`GMGN流: ${f.hits} 次 / $${f.usd >= 1000 ? (f.usd / 1000).toFixed(1) + 'k' : f.usd.toFixed(0)}`);
                lines.push(`钱包: ${f.wallet.slice(0, 8)}…${f.wallet.slice(-6)}`);
                return lines;
              }
              const bp = this._bpTooltip(item);
              if (bp) return bp;
              const raw = item.raw._raw;
              const bnb = (parseFloat(raw.bnb_amount) || 0).toFixed(4);
              const price = parseFloat(raw.price_usd || 0);
              const trader = (raw.trader_address || '').slice(0, 8) + '...';
              return [`${raw.trade_type === 'buy' ? 'BUY' : 'SELL'} | ${bnb} BNB`, `Price: $${price.toExponential(3)}`, `Trader: ${trader}`];
            },
          } },
        },
        scales: {
          x: { type: 'time', time: { tooltipFormat: 'HH:mm:ss', displayFormats: { second: 'HH:mm:ss', minute: 'HH:mm' } }, ticks: { font: { size: 10 }, maxTicksLimit: 12 }, title: { display: true, text: '时间' } },
          y: { type: 'logarithmic', title: { display: true, text: 'Price (USD)' }, ticks: { font: { size: 10 }, callback(v) { if (v >= 1) return '$' + v.toFixed(2); if (v >= 0.001) return '$' + v.toPrecision(2); return '$' + v.toExponential(1); } } },
        },
      },
    });
  }

  /** tick 气泡半径映射（BNB 交易额 → 3~15px，对数刻度；与信号页同口径） */
  _mapRadius(bnbAmount) {
    const logVal = Math.log10(Math.max(bnbAmount, 0.01));
    const normalized = Math.min(Math.max((logVal + 2) / 4, 0), 1); // 0.01 BNB ~ 100 BNB
    return 3 + normalized * (15 - 3);
  }

  // ── 区块 K 线（按 block_number 聚合 OHLC + 成交量副图）──────
  // 复用 _loadChartData 的窗口 ticks，在内存按 block_number 分组聚合 OHLC，
  // 与气泡图同源同口径（BSC 无 slot 概念，每根蜡烛=一个区块）。
  _buildBlockCandles(tickData) {
    if (this.firstTickBlock == null) return null;
    const map = new Map();   // blockNumber -> {t, open, high, low, close, buyVol, sellVol}
    for (const t of tickData) {
      if (t.block_number == null) continue;
      const price = parseFloat(t.price_usd);
      if (!price || price <= 0) continue;
      const bnb = parseFloat(t.bnb_amount) || 0;
      const block = t.block_number;
      let g = map.get(block);
      if (!g) { g = { t: new Date(t.block_time).getTime(), open: price, high: price, low: price, close: price, buyVol: 0, sellVol: 0 }; map.set(block, g); }
      // 数据按 block_time 升序，首个=open；末个持续覆盖即 close
      g.high = Math.max(g.high, price);
      g.low = Math.min(g.low, price);
      g.close = price;
      if (t.trade_type === 'buy') g.buyVol += bnb; else g.sellVol += bnb;
    }
    if (!map.size) return null;
    const blocks = [...map.keys()].sort((a, b) => a - b);
    const ohlc = [], buyVol = [], sellVol = [];
    for (const block of blocks) {
      const g = map.get(block);
      const x = g.t;                                  // 区块首笔时间戳（financial parsing:false 要求每点自带数值 x）
      const blockSeq = block - this.firstTickBlock + 1; // 区块序号（tooltip 显示）
      ohlc.push({ x, o: g.open, h: g.high, l: g.low, c: g.close, blockSeq });
      buyVol.push({ x, y: g.buyVol, blockSeq });
      sellVol.push({ x, y: g.sellVol, blockSeq });
    }
    return { ohlc, buyVol, sellVol };
  }

  _initCandleChart(tickData) {
    const data = this._buildBlockCandles(tickData);
    const wrapper = document.getElementById('candle-chart-wrapper');
    if (!data) { if (wrapper) wrapper.style.display = 'none'; return; }
    if (wrapper) wrapper.style.display = 'block';
    if (this.candleChart) { this.candleChart.destroy(); this.candleChart = null; }
    if (this.volumeChart) { this.volumeChart.destroy(); this.volumeChart = null; }

    // 涨跌配色（与气泡图 buy绿/sell红 一致：close>=open 绿，否则红）
    const up = 'rgba(34,197,94,0.85)', down = 'rgba(239,68,68,0.85)';

    // 主图：candlestick（time x 轴 + 每根=一个区块；价格 logarithmic，与气泡图同轴类型）
    this.candleChart = new Chart(document.getElementById('candle-chart'), {
      type: 'candlestick',
      data: { datasets: [{ label: 'OHLC(USD)', data: data.ohlc,
        backgroundColors: { up, down, unchanged: up }, borderColors: { up, down, unchanged: up } }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        plugins: {
          legend: { labels: { boxWidth: 12, padding: 12 } },
          tooltip: { callbacks: {
            title: items => {
              if (!items.length) return '';
              const r = items[0].raw;
              // 名单/BP 点位无 blockSeq——回落纯时刻（不冒充区块序号）
              return r.blockSeq != null
                ? `区块序号 ${r.blockSeq} · ${new Date(r.x).toLocaleTimeString('zh-CN')}`
                : new Date(r.x).toLocaleTimeString('zh-CN');
            },
            label: it => {
              // ⭐famous 点位：GMGN 用户名+钱包地址+金额（与散点图同款）
              if (it.raw._famous) {
                const f = it.raw._famous;
                const lines = [
                  `⭐Famous ${f.tradeType || ''} | ${f.bnb.toFixed(4)} BNB`,
                  `Price: $${it.raw.y.toExponential(3)}`,
                ];
                if (f.label) lines.push(f.label);
                lines.push(`钱包: ${f.wallet.slice(0, 8)}…${f.wallet.slice(-6)}`);
                return lines;
              }
              // 🧠 聪明钱点位：twitter/标签+钱包地址+金额（与散点图同款）
              if (it.raw._smart) {
                const f = it.raw._smart;
                const lines = [
                  `🧠聪明钱 ${f.tradeType || ''} | ${f.bnb.toFixed(4)} BNB`,
                  `Price: $${it.raw.y.toExponential(3)}`,
                ];
                if (f.label) lines.push(f.label);
                if (f.tags && f.tags.length) lines.push(`标签: ${f.tags.join(',')}`);
                if (f.hits) lines.push(`GMGN流: ${f.hits} 次 / $${f.usd >= 1000 ? (f.usd / 1000).toFixed(1) + 'k' : f.usd.toFixed(0)}`);
                lines.push(`钱包: ${f.wallet.slice(0, 8)}…${f.wallet.slice(-6)}`);
                return lines;
              }
              // BP 点位（此前落 OHLC 分支打 $undefined——路由到专属 tooltip）
              const bp = this._bpTooltip(it);
              if (bp) return bp;
              const p = it.raw, dir = p.c >= p.o ? '▲' : '▼';
              return [`${dir} O $${p.o.toExponential(2)}  H $${p.h.toExponential(2)}`, `   L $${p.l.toExponential(2)}  C $${p.c.toExponential(2)}`];
            },
          } },
        },
        scales: {
          x: { type: 'time', time: { tooltipFormat: 'HH:mm:ss', displayFormats: { second: 'HH:mm:ss', minute: 'HH:mm' } },
               // candlestick 控制器泄漏 ticks.source:'data'/major/autoSkipPadding:75（刻度=数据点时间戳，跳选后轴末端整段无刻度）→ 恢复 time 轴默认整刻度
               ticks: { font: { size: 10 }, maxTicksLimit: 12, source: 'auto', major: { enabled: false }, autoSkipPadding: 3 },
               title: { display: true, text: '时间' } },
          y: { type: 'logarithmic', title: { display: true, text: 'Price (USD)' },
               ticks: { font: { size: 10 }, callback(v) { if (v >= 1) return '$' + v.toFixed(2); if (v >= 0.001) return '$' + v.toPrecision(2); return '$' + v.toExponential(1); } } },
        },
      },
    });

    // ⭐famous/🧠聪明钱 + BP 点位叠画（candlestick 控制器 mixed scatter 兼容性未知——
    // 失败只 warn 不伤 K 线本体；三角 scatter 与 signals 页 K 线同款配色，famous 优先防双计）
    try {
      const famousMarks = this._buildFamousPoints(tickData);
      const smartMarks = this._buildSmartPoints(tickData);
      const rosterDs = [
        { label: `⭐Famous买 (${famousMarks.buyPoints.length})`, data: famousMarks.buyPoints, type: 'scatter',
          pointStyle: 'triangle', pointRadius: 8, pointHoverRadius: 10,
          backgroundColor: 'rgba(250,204,21,0.95)', borderColor: '#b45309', borderWidth: 1.5 },
        { label: `⭐Famous卖 (${famousMarks.sellPoints.length})`, data: famousMarks.sellPoints, type: 'scatter',
          pointStyle: 'triangle', rotation: 180, pointRadius: 8, pointHoverRadius: 10,
          backgroundColor: 'rgba(192,132,252,0.95)', borderColor: '#6b21a8', borderWidth: 1.5 },
        { label: `🧠聪明钱买 (${smartMarks.buyPoints.length})`, data: smartMarks.buyPoints, type: 'scatter',
          pointStyle: 'triangle', pointRadius: 8, pointHoverRadius: 10,
          backgroundColor: 'rgba(14,165,233,0.95)', borderColor: '#0c4a6e', borderWidth: 1.5 },
        { label: `🧠聪明钱卖 (${smartMarks.sellPoints.length})`, data: smartMarks.sellPoints, type: 'scatter',
          pointStyle: 'triangle', rotation: 180, pointRadius: 8, pointHoverRadius: 10,
          backgroundColor: 'rgba(244,114,182,0.95)', borderColor: '#831843', borderWidth: 1.5 },
      ];
      const bpDs = this._bpScatterDatasets(tickData);
      const overlay = [...rosterDs, ...bpDs];
      // unshift 排最前：倒序绘制=排前者画在上层（与气泡图同修，密集蜡烛区不再压点）
      overlay.forEach(d => { d.parsing = { xAxisKey: 'x', yAxisKey: 'y' }; });
      this.candleChart.data.datasets.unshift(...overlay);
      this.candleChart.update();
    } catch (e) { console.warn('K 线标记叠画失败（气泡图仍有点位）:', e); }

    // 副图：成交量 bar（buy 绿 / sell 红 堆叠；time x 轴与主图对齐）
    this.volumeChart = new Chart(document.getElementById('volume-chart'), {
      type: 'bar',
      data: { datasets: [
        { label: `Buy (${data.buyVol.reduce((s, p) => s + p.y, 0).toFixed(2)} BNB)`, data: data.buyVol, backgroundColor: 'rgba(34,197,94,0.6)', stack: 'vol' },
        { label: `Sell (${data.sellVol.reduce((s, p) => s + p.y, 0).toFixed(2)} BNB)`, data: data.sellVol, backgroundColor: 'rgba(239,68,68,0.6)', stack: 'vol' },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        plugins: {
          legend: { labels: { boxWidth: 12, padding: 12 } },
          tooltip: { callbacks: {
            title: items => items.length ? `区块序号 ${items[0].raw.blockSeq} · ${new Date(items[0].raw.x).toLocaleTimeString('zh-CN')}` : '',
            label: it => `${it.dataset.label.split(' ')[0]} ${(it.raw.y).toFixed(4)} BNB`,
          } },
        },
        scales: {
          x: { type: 'time', stacked: true, time: { displayFormats: { second: 'HH:mm:ss', minute: 'HH:mm' } },
               ticks: { font: { size: 10 }, maxTicksLimit: 12 }, grid: { display: false } },
          y: { stacked: true, title: { display: true, text: 'Vol (BNB)' }, ticks: { font: { size: 10 } } },
        },
      },
    });
  }

  // ── 交易明细表格 ────────────────────────────────────────────
  _renderTickTable(ticks) {
    const tbody = document.getElementById('tick-table-body');
    const offset = (this.currentPage - 1) * this.pageSize;
    tbody.innerHTML = ticks.map((tick, i) => {
      const idx = offset + i + 1;
      const time = new Date(tick.block_time).toLocaleString('zh-CN');
      const isBuy = tick.trade_type === 'buy';
      const typeBadge = isBuy
        ? '<span class="px-2 py-0.5 text-xs rounded-full bg-green-900 text-green-300">Buy</span>'
        : '<span class="px-2 py-0.5 text-xs rounded-full bg-red-900 text-red-300">Sell</span>';
      let phaseBadge = '';
      if (this.firstTickTime) {
        const elapsed = Math.floor((new Date(tick.block_time).getTime() - this.firstTickTime) / 1000);
        phaseBadge = `<span class="px-2 py-0.5 text-xs rounded-full bg-gray-700 text-gray-300">${elapsed}s</span>`;
      }
      const price = parseFloat(tick.price_usd || 0);
      const priceStr = price > 0 ? price.toExponential(3) : '-';
      const bnbStr = this._fmtBnb(parseFloat(tick.bnb_amount || 0));
      const tokenAmount = tick.token_amount != null ? this._formatNum(parseFloat(tick.token_amount)) : '-';
      const isCreator = this.tokenInfo?.creator_address && tick.trader_address === this.tokenInfo.creator_address;
      const creatorBadge = isCreator ? '<span class="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-violet-900 text-violet-300 font-sans">creator</span>' : '';
      // 钱包链接指向站内 /trader/:address 行为/画像页（同 pumpfun 母版 /token/:address 模式），
      // bscscan 降为辅助外链小图标
      const trader = tick.trader_address
        ? `<span class="inline-flex items-center"><a href="/trader/${tick.trader_address}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 font-mono" title="钱包统计/行为页：${this._esc(tick.trader_address)}">${tick.trader_address.slice(0, 8)}...</a>${creatorBadge}<a href="https://bscscan.com/address/${tick.trader_address}" target="_blank" rel="noopener noreferrer" class="ml-0.5 text-gray-500 hover:text-blue-400 text-[10px]" title="BscScan">B</a></span>`
        : '-';
      const tx = tick.tx_hash
        ? `<a href="https://bscscan.com/tx/${tick.tx_hash}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 font-mono" title="${this._esc(tick.tx_hash)}">${tick.tx_hash.slice(0, 10)}...</a>`
        : '-';
      const block = tick.block_number != null
        ? `<a href="https://bscscan.com/block/${tick.block_number}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 font-mono">${tick.block_number}</a>`
        : '-';
      const blockElapsed = (tick.block_number != null && this.firstTickBlock != null) ? (tick.block_number - this.firstTickBlock + 1) : '-';
      return `<tr class="hover:bg-gray-750 transition-colors">
        <td class="px-4 py-2 text-gray-500">${idx}</td>
        <td class="px-4 py-2 text-gray-300 whitespace-nowrap">${time}</td>
        <td class="px-4 py-2 text-right font-mono text-gray-400">${block}</td>
        <td class="px-4 py-2 text-right font-mono text-gray-400">${blockElapsed}</td>
        <td class="px-4 py-2">${typeBadge}</td>
        <td class="px-4 py-2 whitespace-nowrap">${phaseBadge}</td>
        <td class="px-4 py-2 text-right font-mono text-gray-200">${priceStr}</td>
        <td class="px-4 py-2 text-right font-mono text-gray-200">${bnbStr}</td>
        <td class="px-4 py-2 text-right font-mono text-gray-200">${tokenAmount}</td>
        <td class="px-4 py-2">${trader}</td>
        <td class="px-4 py-2">${tx}</td>
      </tr>`;
    }).join('');
  }

  _renderPagination() {
    const totalPages = Math.max(1, Math.ceil(this.totalTicks / this.pageSize));
    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, this.totalTicks);
    document.getElementById('page-info').textContent = `第 ${this.currentPage} / ${totalPages} 页 ｜ 显示 ${start}-${end} / 共 ${this.totalTicks} 条`;
    document.getElementById('tick-table-info').textContent = `共 ${this.totalTicks} 条`;
    document.getElementById('prev-page').disabled = this.currentPage <= 1;
    document.getElementById('next-page').disabled = this.currentPage >= totalPages;
  }

  _updateTickStats(ticks, total) {
    const buys = ticks.filter(t => t.trade_type === 'buy').length;
    const sells = ticks.filter(t => t.trade_type === 'sell').length;
    const bnbVolume = ticks.reduce((sum, t) => sum + parseFloat(t.bnb_amount || 0), 0);
    document.getElementById('stat-total').textContent = total.toLocaleString();
    document.getElementById('stat-buys').textContent = buys.toLocaleString();
    document.getElementById('stat-sells').textContent = sells.toLocaleString();
    document.getElementById('stat-volume').textContent = bnbVolume.toFixed(2) + ' BNB';
  }

  // ── 分页 / 筛选 ─────────────────────────────────────────────
  async _goToPage(page) {
    const totalPages = Math.max(1, Math.ceil(this.totalTicks / this.pageSize));
    if (page < 1 || page > totalPages) return;
    this.currentPage = page;
    await this._loadTableData();
    document.getElementById('tick-table-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async _applyFilters() {
    this.filters.tradeType = document.getElementById('filter-type').value;
    this.filters.from = document.getElementById('filter-from').value || '';
    this.filters.to = document.getElementById('filter-to').value || '';
    this.currentPage = 1;
    await Promise.all([this._loadChartData(), this._loadTableData()]);
  }

  async _applyTickWindow() {
    const input = document.getElementById('tick-time-window');
    if (!input) return;
    const raw = input.value.trim();
    const val = Number(raw);
    this.tickWindowSec = (raw !== '' && Number.isFinite(val) && val > 0) ? val : null;
    this.currentPage = 1;
    await Promise.all([this._loadChartData(), this._loadTableData()]);
  }

  async _resetTickWindow() {
    const input = document.getElementById('tick-time-window');
    if (input) input.value = '';
    this.tickWindowSec = null;
    this.currentPage = 1;
    await Promise.all([this._loadChartData(), this._loadTableData()]);
  }

  // ── 工具 ────────────────────────────────────────────────────
  _fmtBnb(b) {
    const v = Number(b) || 0;
    if (v === 0) return '0';
    if (v < 0.01) return v.toExponential(2);
    if (v < 1) return v.toFixed(4);
    if (v < 100) return v.toFixed(4);
    return v.toFixed(2);
  }
  _formatNum(n) {
    if (n === 0) return '0';
    if (Math.abs(n) < 0.001) return n.toExponential(2);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return n.toFixed(4);
  }
  _esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  _shortAddr(a) { return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '-'; }
}

window.addEventListener('DOMContentLoaded', () => { new TokenTicksPage(); });
