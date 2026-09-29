/**
 * 交易者详情页 JavaScript
 * 展示某交易者的全局所有交易记录（跨所有实验/代币，数据来自 wss_price_ticks）
 * + 钱包画像（TPA as-off 实时 + wallets 表人工标注 meta）
 *
 * 移植自 pumpfun-wss-trader /trader/:address（BSC 适配）：
 *   - bnb_amount BNB 浮点（母版 sol_amount lamports 整数）→ 金额列直读不除 1e9
 *   - 画像键 totalBnb/avgBnb（母版 totalSolLam/avgSolLam）；评分维度 volume(0-2)+avgBnb(0-2)+hold(flat 0.25)=4.5
 *   - 金额桶阈值（母版 SOL 边界 ×0.4）：dust<0.0004 / tiny<0.02 / small<0.2 / medium<0.8 / big≥0.8 BNB
 *   - 代币分类 badge：token_profiles 全局表（离线/OPB 崩盘后定性，richer-js 8 类），对齐母版
 *     tokenClassifications 语义；映射表与 position-analysis 页同款保持站内一致
 *   - 母版的 bad action 按笔判定 / 创建者画像（creator_token_stats）依赖 pumpfun 侧表，裁掉不展示
 */

// 离线/OPB 代币分类映射（token_profiles.category，richer-js 8 类 + neutral 兜底）
// ——与 experiment_position_analysis.js 的 TOKEN_PROFILE_MAP 同款（单一视觉口径）
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

class TraderDetail {
  constructor() {
    this.traderAddress = null;
    this.trades = [];
    this.tokenSymbols = {};
    this.tokenPlatforms = {}; // token_address → platform（fourmeme/flap）
    this.tokenClassifications = {}; // token_address → {category, source, maxMcap, classifiedAt}（token_profiles）
    this.pageSize = 100;
    this.currentPage = 1;
    this.init();
  }

  async init() {
    this.traderAddress = this.extractAddress();
    if (!this.traderAddress) {
      this.showError('无法从 URL 解析交易者地址');
      return;
    }
    this.setupHeader();
    this.setupEventListeners();
    this.loadProfile(); // 画像独立加载，不阻塞交易记录
    this.analyzeWallet(); // ★页面加载自动分析全局画像（无需点按钮），独立加载不阻塞
    await this.loadTrades();
  }

  /** 从 /trader/<address> 提取 address */
  extractAddress() {
    const parts = window.location.pathname.split('/'); // ['', 'trader', '<address>']
    const last = parts[parts.length - 1];
    return last ? decodeURIComponent(last) : null;
  }

  /** 设置 header 地址、外链 */
  setupHeader() {
    const addr = this.traderAddress;
    document.getElementById('trader-address').textContent = addr;
    document.getElementById('gmgn-wallet-btn').href = `https://gmgn.ai/bsc/address/${addr}`;
    document.getElementById('bscscan-btn').href = `https://bscscan.com/address/${addr}`;
  }

  setupEventListeners() {
    const copyBtn = document.getElementById('copy-trader-btn');
    if (copyBtn) copyBtn.onclick = () => this.copyText(this.traderAddress, copyBtn);
    const prev = document.getElementById('prev-page');
    const next = document.getElementById('next-page');
    if (prev) prev.onclick = () => { if (this.currentPage > 1) { this.currentPage--; this.renderTable(); } };
    if (next) next.onclick = () => { this.currentPage++; this.renderTable(); };
    // 实验ID复制按钮（事件委托，覆盖交易表 + 实验分布面板所有 .copy-exp-btn）
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.copy-exp-btn');
      if (btn && btn.dataset.copy) { e.preventDefault(); this.copyText(btn.dataset.copy, btn); }
    });
  }

  async copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (btn) {
      const old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(() => { btn.textContent = old; }, 1500);
    }
  }

  async loadTrades() {
    try {
      const resp = await fetch(`/api/trader/${encodeURIComponent(this.traderAddress)}/trades`);
      const result = await resp.json();
      if (!resp.ok || !result.success) {
        this.showError(result.error || '加载失败');
        return;
      }
      this.trades = result.data || [];
      this.tokenSymbols = result.tokenSymbols || {};
      this.tokenPlatforms = result.tokenPlatforms || {};
      this.tokenClassifications = result.tokenClassifications || {};
      this.experimentInfo = result.experimentInfo || {};
      if (result.truncated) {
        document.getElementById('truncated-notice').classList.remove('hidden');
      }
      this.render();
    } catch (e) {
      console.error('❌ 加载交易者交易记录失败:', e);
      this.showError('加载交易者交易记录失败');
    }
  }

  /**
   * 加载钱包画像 meta（wallets 表人工标注：name/category/chain）
   * 主体 as-off 实时画像由 renderAnalyzeResult 渲染（analyzeWallet）。
   */
  async loadProfile() {
    const addr = this.traderAddress;
    try {
      const resp = await fetch(`/api/wallets/${encodeURIComponent(addr)}`);
      const j = await resp.json();
      this.renderWalletProfile(j.success ? j.data : null);
    } catch (e) {
      console.error('❌ 加载钱包画像失败:', e);
      this.renderWalletProfile(null);
    }
  }

  /** 渲染钱包画像顶部 meta（wallets 表：name / category / chain，无则空） */
  renderWalletProfile(data) {
    const metaEl = document.getElementById('wallet-profile-meta');
    if (metaEl) {
      const meta = [];
      if (data) {
        if (data.name) meta.push(`名称: ${data.name}`);
        if (data.category) meta.push(`人工分类: ${data.category}`);
        if (data.chain) meta.push(`链: ${data.chain}`);
      }
      metaEl.innerHTML = meta.length ? meta.map(m => this.escapeHtml(m)).join(' · ') : '';
    }
  }

  /**
   * 自动加载此钱包的全局 as-off 画像（页面加载即调，无需点按钮）。
   * POST /api/trader/:address/analyze-position → TPA._fetchAndBuildProfile
   * 查 wss_price_ticks（离线 profile 命中则增量合并，否则实时 14d 窗口）算画像。
   */
  async analyzeWallet() {
    const addr = this.traderAddress;
    const resEl = document.getElementById('tpa-analyze-result');
    if (resEl) resEl.innerHTML = '<span class="text-gray-500">分析中…（离线 profile + 实时增量合并，可能数秒）</span>';
    try {
      const resp = await fetch(`/api/trader/${encodeURIComponent(addr)}/analyze-position`, { method: 'POST' });
      const j = await resp.json();
      if (!resp.ok || !j.success) {
        if (resEl) resEl.innerHTML = `<span class="text-red-400">分析失败: ${this.escapeHtml(j.error || '')}</span>`;
        return;
      }
      this.renderAnalyzeResult(j.data);
    } catch (e) {
      console.error('❌ 全局画像分析失败:', e);
      if (resEl) resEl.innerHTML = '<span class="text-red-400">分析请求失败</span>';
    }
  }

  /** 渲染全局画像结果（钱包评分 + 庄散性质 + 三段对比 + 金额桶）——richer-js BNB 口径 */
  renderAnalyzeResult(data) {
    const el = document.getElementById('tpa-analyze-result');
    if (!el) return;
    const p = data.profile || {};
    const offline = data.offline || null;             // 离线 profile（截止 data_through 全历史）
    const incremental = data.incremental || null;     // 实时增量（[data_through, now]；未命中离线则=全量 14d）
    const rawTotal = (p.rawTotal != null) ? p.rawTotal : '-';
    const rawTotalNote = p.rawTotalApprox ? ' <span class="text-yellow-500 text-[10px]">(sniper 短路，tick 数近似)</span>' : '';
    // 钱包评分（scoreProfile：volume 0-2 + avgBnb 0-2 + hold flat 0.25 = 4.5；bad 只降不加分·恶意cap）
    const sc = data.score;
    let scoreHtml = '';
    if (sc) {
      const bd = sc.breakdown || {};
      const vDim = bd.volume || {}, aDim = bd.avg || {}, bDim = bd.bad || {}, hDim = bd.hold || {};
      const scoreCls = sc.score >= 3.2 ? 'text-emerald-400' : sc.score >= 2.0 ? 'text-yellow-400' : sc.score >= 1.6 ? 'text-orange-400' : 'text-red-400';
      const stags = [];
      if (sc.fallback) stags.push('<span class="text-red-500 text-[10px]">降级固定分·fetch失败</span>');
      if (sc.approx) stags.push('<span class="text-yellow-500 text-[10px]">样本近似(sniper)</span>');
      const mc = bd.maliciousCap || {};
      if (mc.incidentalExempt) stags.push('<span class="text-emerald-400 text-[10px]">🛡大户偶发豁免恶意cap</span>');
      else if (mc.applied) stags.push(`<span class="text-red-500 text-[10px]">⚠恶意cap≤${mc.capValue}</span>`);
      if (bd.lowVolumeCap && bd.lowVolumeCap.applied) stags.push(`<span class="text-amber-500 text-[10px]">⚠低交易额cap≤${bd.lowVolumeCap.ceiling}(交易额${bd.lowVolumeCap.totalBnb}BNB)</span>`);
      if (bd.tier2Penalty && bd.tier2Penalty.applied) stags.push(`<span class="text-amber-500 text-[10px]">⚠Tier2集中抛售衰减</span>`);
      if (bd.badActionByHumanCap && bd.badActionByHumanCap.applied) stags.push('<span class="text-red-500 text-[10px]">⚠人工标注恶意cap≤0.5</span>');
      // 维度分颜色：满=绿 / 最差=红 / 中=黄（让恶意 bad=0 一眼可见）
      const dimStr = (dim, fmt, max) => {
        if (dim.fallback) return '<span class="text-red-500">降级</span>';
        const raw = dim.raw != null ? fmt(dim.raw) : '-';
        const sCls = dim.score >= max ? 'text-emerald-300' : dim.score <= 0 ? 'text-red-400' : 'text-yellow-300';
        const tag = dim.score <= 0 ? ' ·最差' : dim.score >= max ? ' ·满' : '';
        return `<b class="${sCls}">${dim.score}</b><span class="text-gray-600 text-[10px]"> (raw ${raw}${dim.exempt ? ' ·豁免' : ''}${dim.sampleApprox ? ' ·样本' : ''}${tag})</span>`;
      };
      const badDetail = bDim.fallback ? '' : `早期抢筹${bDim.earlyLargeBuyCount ?? 0}次(恶${bDim.badBuyCount ?? 0}) / 闪崩砸盘${bDim.crashLargeSellCount ?? 0}次(恶${bDim.badSellCount ?? 0})`;
      // 恶意钱包醒目警告：靶向率 effBadRatio 极高危害最大，惩罚 modifier → 总分 hard cap
      const isMalicious = p.badAction || (bDim.raw != null && bDim.raw >= 0.6);
      let badWarn = '';
      if (isMalicious) {
        const effPct = ((mc.effBadRatio ?? bDim.raw ?? 0) * 100).toFixed(1);
        let capTxt;
        if (mc.incidentalExempt) {
          capTxt = ` → <b class="text-emerald-200">恶意 cap 已豁免</b>（小分母靶向率 ${effPct}% 不可信）`;
        } else if (mc.applied) {
          capTxt = ` → <b class="text-red-200">恶意惩罚生效</b>（靶向率 ${effPct}% → 连续降分 cap ≤ ${mc.capValue}）：总分 ${bd.totalBeforeCap} <b>cap → ${sc.score}</b>`;
        } else if (bDim.exempt) {
          capTxt = `（完全无候选：无早期抢筹/闪崩砸盘大额，无操纵信号未施惩罚）`;
        } else if (mc.capValue != null) {
          capTxt = `（靶向率 ${effPct}% 已入降分区，连续 cap ≤ ${mc.capValue}；原始总分 ${bd.totalBeforeCap} 未超，未触发）`;
        } else {
          capTxt = `（靶向率 ${effPct}% 未达 0.6 起罚阈值，恶意惩罚未触发）`;
        }
        badWarn = `<div class="bg-red-950 border border-red-500 text-red-300 px-3 py-2 rounded mb-2 text-xs">⚠ <b>恶意行为钱包</b>：badAction=${p.badAction ? '是' : '否'}，靶向率 ${effPct}%${badDetail ? `（${badDetail}）` : ''}${capTxt}</div>`;
      }
      scoreHtml = `
      ${badWarn}
      <div class="bg-gray-800 rounded p-2 border border-gray-700 mb-2">
        <div class="flex items-center gap-2 mb-1.5 flex-wrap">
          <span class="text-gray-500 text-[11px]">⭐ 钱包评分</span>
          <span class="text-lg font-bold ${scoreCls}">${sc.score}</span>
          <span class="text-gray-500 text-[11px]">/ 4.5</span>
          ${stags.join(' ')}
          <span class="text-gray-600 text-[10px]">(v1·BNB 口径·与 TPAPre_tokenScore 同源)</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-2 text-[11px]">
          <div><span class="text-gray-500">累计交易额 volume(0-2):</span> ${dimStr(vDim, v => `${v} BNB`, 2)}</div>
          <div><span class="text-gray-500">平均单笔 avgBnb(0-2):</span> ${dimStr(aDim, v => `${v} BNB`, 2)}</div>
          <div><span class="text-gray-500">恶意靶向率 bad(仅降分):</span> ${bDim.fallback ? '<span class="text-red-500">降级</span>' : `<b class="text-yellow-300">${bDim.raw != null ? `${(bDim.raw * 100).toFixed(1)}%` : '-'}</b><span class="text-gray-600 text-[10px]">${bDim.exempt ? ' ·无候选(无操纵信号)' : ' ·仅降分·不计基础分'}${mc.applied ? ` ·恶意cap≤${mc.capValue}` : ''}</span>`}</div>
          <div><span class="text-gray-500">中位持仓 hold(固定0.25):</span> ${dimStr(hDim, v => `${v}s`, 0.25)}</div>
        </div>
        <div class="text-[10px] text-gray-600 mt-1">${(!isMalicious && badDetail) ? `bad 维：${badDetail}` : ''}</div>
      </div>`;
    }

    // 金额桶：每区间「个数(占比%)」，阈值（母版 SOL 边界 ×0.4）dust<0.0004 / tiny<0.02 / small<0.2 / medium<0.8 / big≥0.8 BNB（单笔 max 归类）
    const BUCKETS = ['dust', 'tiny', 'small', 'medium', 'big'];
    const total = (p.buckets && p.buckets.total) || 0;
    let bucketsStr;
    if (p.buckets && typeof p.buckets === 'object' && !p.rawTotalApprox) {
      bucketsStr = BUCKETS.map(k => {
        const v = p.buckets[k] || 0;
        const ratio = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
        const cls = v > 0 ? 'bg-gray-700 text-gray-200' : 'bg-gray-800 text-gray-600';
        return `<span class="px-1.5 py-0.5 rounded mr-1 mb-1 inline-block whitespace-nowrap ${cls}">${this.escapeHtml(k)}: <b class="text-white">${v}</b> <span class="text-[10px]">(${ratio}%)</span></span>`;
      }).join('');
    } else {
      bucketsStr = p.rawTotalApprox ? '<span class="text-yellow-500">sniper 短路未取行（仅近似 tick 数）</span>' : '<span class="text-gray-600">-</span>';
    }
    const tagsStr = (Array.isArray(p.tags) && p.tags.length)
      ? p.tags.map(t => `<span class="px-1 py-0.5 rounded bg-indigo-900 text-indigo-300 border border-indigo-700 mr-0.5 whitespace-nowrap">${this.escapeHtml(t)}</span>`).join('')
      : '<span class="text-gray-600">无</span>';

    // 三栏对比：离线（截止 data_through 全历史预计算）/ 实时增量 / 汇总（merged=页面最终评分依据）
    const dtTxt = p.dataThroughMs ? new Date(p.dataThroughMs).toISOString().slice(0, 16).replace('T', ' ') : null;
    const offlineSub = offline ? (dtTxt ? `截止 ${dtTxt}` : '全历史累积') : '无离线 profile（未入离线表）';
    const incSub = incremental ? (offline ? `增量 [${dtTxt || 'data_through'} → now]` : '全量实时 14d') : '无增量（now ≤ data_through）';
    const segHtml = `
      <div class="mb-1"><span class="text-gray-500 text-[11px]">画像三段对比（离线预计算 + 实时增量 → 汇总）：</span></div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
        ${this.renderSeg(offline, '离线 profile', offlineSub, 'offline')}
        ${this.renderSeg(incremental, '实时增量', incSub, 'inc')}
        ${this.renderSeg(p, '汇总（最终）', '离线+增量合并', 'merged')}
      </div>`;

    // 庄散性质（Layer1，实时算不落库）：bucket + 命中维度（庄家 3 维度任一命中）
    const nature = data.nature;
    let natureHtml = '';
    if (nature) {
      const NATURE_META = {
        new_wallet: { label: '新钱包', cls: 'text-teal-400' },
        zhuang: { label: '庄家', cls: 'text-red-400' },
        retail: { label: '散户', cls: 'text-blue-400' },
        neutral: { label: '中性', cls: 'text-gray-400' },
      };
      const meta = NATURE_META[nature.bucket] || NATURE_META.neutral;
      // 庄家命中维度（①低额刷量 ②大额主导 ③抢筹）；非庄家桶无维度
      const d = nature.dims || {};
      const dimChips = nature.bucket === 'zhuang' ? [
        d.lowTiny ? '<span class="text-red-300">①低额刷量</span>' : '<span class="text-gray-600">①刷量</span>',
        d.bigDom ? '<span class="text-red-300">②大额主导</span>' : '<span class="text-gray-600">②大额</span>',
        d.rush ? '<span class="text-red-300">③抢筹</span>' : '<span class="text-gray-600">③抢筹</span>',
      ].join(' ') : '';
      const dimTxt = dimChips ? `<span class="ml-2 text-[10px]">命中: ${dimChips}</span>` : '';
      natureHtml = `<div class="bg-gray-800 rounded p-2 border border-gray-700 mb-2 flex items-center gap-2 flex-wrap">
        <span class="text-gray-500 text-xs">🎲 庄散性质</span>
        <b class="${meta.cls} text-base font-bold">${meta.label}</b>
        ${dimTxt}
        <span class="text-gray-600 text-[10px]">(行为分桶·与操纵标签正交·实时算不落库)</span>
      </div>`;
    }

    el.innerHTML = `
      ${scoreHtml}
      ${natureHtml}
      ${segHtml}
      <div class="grid grid-cols-2 gap-2 mb-3">
        <div class="bg-gray-800 rounded p-2"><div class="text-gray-500 text-[11px]">历史交易数 rawTotal</div><div class="font-bold text-white">${rawTotal}${rawTotalNote}</div></div>
        <div class="bg-gray-800 rounded p-2"><div class="text-gray-500 text-[11px]">badAction(恶性行为)</div><div class="font-bold ${p.badAction ? 'text-red-400' : 'text-green-400'}">${p.badAction ? '⚠ 是' : '✓ 否'}</div></div>
      </div>
      <div class="mb-1"><span class="text-gray-500">金额桶（单笔 max BNB 归类，共 ${total} 个 token）：</span></div>
      <div class="mb-1">${bucketsStr}</div>
      <div class="text-[10px] text-gray-600 mb-2">阈值：dust&lt;0.0004 / tiny&lt;0.02 / small&lt;0.2 / medium&lt;0.8 / big≥0.8 BNB</div>
      <div><span class="text-gray-500">人工标签:</span> ${tagsStr}</div>
    `;
  }

  /** 画像分段卡片（离线/增量/汇总三栏共用）：基础数据全量展示 + 低阈值恶意行为行（不计分） */
  renderSeg(seg, title, subtitle, kind) {
    const kindCls = kind === 'merged' ? 'border-blue-700' : kind === 'offline' ? 'border-indigo-800' : 'border-gray-700';
    const titleCls = kind === 'merged' ? 'text-blue-300' : kind === 'offline' ? 'text-indigo-300' : 'text-gray-300';
    if (!seg) {
      return `<div class="bg-gray-800/50 rounded p-2 border border-dashed border-gray-700">
        <div class="text-[11px] mb-1 font-semibold ${titleCls}">${this.escapeHtml(title)}</div>
        <div class="text-gray-600 text-[11px]">${this.escapeHtml(subtitle)}</div>
      </div>`;
    }
    const fmtBnb = (s) => s === 0 ? '0' : s < 0.01 ? s.toExponential(1) : s < 1 ? s.toFixed(4) : s < 100 ? s.toFixed(3) : s.toFixed(1);
    const sec2txt = (s) => (s == null) ? '-' : (Number(s) || 0) > 0 ? (Number(s)).toLocaleString() + 's' : '-';
    const tc = seg.tokenCount ?? seg.rawTotal ?? 0;
    const row = (label, valHtml) => `<div><span class="text-gray-500">${label}</span> ${valHtml}</div>`;
    // 恶意行为明细：抢筹X次(恶Y) / 砸盘Z次(恶W)
    const eBuy = seg.earlyLargeBuyCount ?? 0, bBuy = seg.badBuyCount ?? 0;
    const cSell = seg.crashLargeSellCount ?? 0, bSell = seg.badSellCount ?? 0;
    const badDetail = `抢筹${eBuy}(恶${bBuy}) / 砸盘${cSell}(恶${bSell})`;
    return `<div class="bg-gray-800 rounded p-2 border ${kindCls}">
      <div class="flex items-center justify-between mb-0.5">
        <span class="text-[11px] font-semibold ${titleCls}">${this.escapeHtml(title)}</span>
        <span class="text-[10px] text-gray-600">${seg.source ? this.escapeHtml(seg.source) : ''}</span>
      </div>
      <div class="text-[10px] text-gray-600 mb-1">${this.escapeHtml(subtitle)}</div>
      <div class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
        ${row('tick:', `<b class="text-white">${seg.tickCount ?? 0}</b>`)}
        ${row('token:', `<b class="text-white">${tc}</b>`)}
        ${row('买/卖:', `<b class="text-white">${seg.buyCount ?? 0}/${seg.sellCount ?? 0}</b>`)}
        ${row('大额笔:', `<b class="text-white">${seg.largeTradeCount ?? 0}</b>`)}
        ${row('BNB总量:', `<b class="text-yellow-300">${fmtBnb(seg.totalBnb ?? 0)}</b>`)}
        ${row('均笔BNB:', `<b class="text-yellow-300">${fmtBnb(seg.avgBnb ?? 0)}</b>`)}
        ${row('avg持仓:', `<b class="text-white">${sec2txt(seg.avgHoldSeconds)}</b>`)}
        ${row('中位持仓:', `<b class="text-white">${sec2txt(seg.medianHoldSeconds)}</b>`)}
        ${row('badAction:', `<b class="${seg.badAction ? 'text-red-400' : 'text-green-400'}">${seg.badAction ? '⚠是' : '✓否'}</b>`)}
        ${row('恶意明细:', `<span class="text-gray-300 text-[10px]">${badDetail}</span>`)}
      </div>
      ${this._llSegRow(seg.lowLevelBadAction)}
    </div>`;
  }

  /** renderSeg 三栏 low-level 精简行（无值/旧数据返回 ''） */
  _llSegRow(ll) {
    if (!ll) return '';
    const parts = [];
    if (ll.buy) for (const [thr, e] of Object.entries(ll.buy)) {
      const d = e.early || 0, b = e.bad || 0;
      parts.push(`buy${thr}:${d > 0 ? (b / d * 100).toFixed(0) + '%' : '—'}(${b}/${d})`);
    }
    if (ll.sell) for (const [thr, e] of Object.entries(ll.sell)) {
      const d = e.crash || 0, b = e.bad || 0;
      parts.push(`sell${thr}:${d > 0 ? (b / d * 100).toFixed(0) + '%' : '—'}(${b}/${d})`);
    }
    if (!parts.length) return '';
    return `<div class="col-span-2 text-[10px] text-gray-500 mt-0.5 border-t border-gray-700 pt-0.5">低阈值: ${this.escapeHtml(parts.join(' · '))}</div>`;
  }

  /** BNB 浮点 → 字符串（richer-js bnb_amount 是 BNB 计价浮点，非 lamports） */
  formatBnb(bnb) {
    const v = Number(bnb) || 0;
    if (v === 0) return '0';
    if (v < 0.001) return v.toExponential(2);
    if (v < 1) return v.toFixed(4);
    return v.toFixed(3);
  }

  formatPrice(usd) {
    const p = parseFloat(usd);
    if (!p || p <= 0 || isNaN(p)) return '-';
    if (p >= 1) return '$' + p.toFixed(4);
    if (p >= 0.001) return '$' + p.toPrecision(2);
    return '$' + p.toExponential(2);
  }

  /** 缩写地址 */
  shortAddr(addr) {
    if (!addr) return '-';
    return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
  }

  /** 市值缩写（position-analysis 页 fmtMcap 同款口径） */
  fmtMcap(v) {
    if (v == null) return '';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return v.toFixed(0);
  }

  formatTime(ts) {
    if (!ts) return '-';
    try {
      return new Date(ts).toLocaleString('zh-CN', { hour12: false });
    } catch {
      return ts;
    }
  }

  escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  render() {
    const trades = this.trades;

    // 聚合统计
    let buys = 0, sells = 0, totalBnb = 0;
    const tokenSet = new Set();
    for (const t of trades) {
      if (t.trade_type === 'buy') buys++;
      else if (t.trade_type === 'sell') sells++;
      totalBnb += Number(t.bnb_amount) || 0;
      if (t.token_address) tokenSet.add(t.token_address);
    }
    document.getElementById('stat-total').textContent = trades.length;
    document.getElementById('stat-buys').textContent = buys;
    document.getElementById('stat-sells').textContent = sells;
    document.getElementById('stat-volume').textContent = this.formatBnb(totalBnb);
    document.getElementById('stat-tokens').textContent = tokenSet.size;

    document.getElementById('trader-summary').textContent =
      `共 ${trades.length} 条交易记录，涉及 ${tokenSet.size} 个代币`;

    // 表格
    this.currentPage = 1;
    this.renderTable();

    // 实验分布聚合面板
    this._renderExperimentBreakdown();

    // 空状态
    const empty = document.getElementById('empty-state');
    if (trades.length === 0) {
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
    }
  }

  renderTable() {
    const tbody = document.getElementById('trades-tbody');
    const totalPages = Math.max(1, Math.ceil(this.trades.length / this.pageSize));
    if (this.currentPage > totalPages) this.currentPage = totalPages;
    const start = (this.currentPage - 1) * this.pageSize;
    const pageItems = this.trades.slice(start, start + this.pageSize);

    tbody.innerHTML = pageItems.map(t => {
      const addr = t.token_address || '';
      const symbol = this.tokenSymbols[addr] || this.shortAddr(addr);
      const isBuy = t.trade_type === 'buy';
      const typeBadge = isBuy
        ? '<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-green-900 text-green-400 border border-green-700 whitespace-nowrap">买入</span>'
        : '<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-900 text-red-400 border border-red-700 whitespace-nowrap">卖出</span>';
      const expId = t.experiment_id || '';
      // 平台 badge（fourmeme/flap；双平台代币显示 both）
      const platform = this.tokenPlatforms[addr] || t.platform || '';
      const platBadge = platform
        ? `<span class="px-1.5 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap ${platform === 'flap' ? 'bg-cyan-900 text-cyan-300 border border-cyan-700' : 'bg-orange-900 text-orange-300 border border-orange-700'}" title="平台">${this.escapeHtml(platform)}</span>`
        : '';
      const expShort = expId ? expId.slice(0, 8) : '-';
      // 实验列：实验名 + 模式 badge[V/BT/LIVE] + ID前8 + 复制完整ID
      const expInfo = expId ? (this.experimentInfo[expId] || null) : null;
      const expName = (expInfo && expInfo.name) || '';
      const expMode = (expInfo && expInfo.mode) || '';
      const modeLabel = expMode === 'virtual' ? 'V' : expMode === 'backtest' ? 'BT' : expMode === 'live' ? 'LIVE' : '';
      const modeCls = expMode === 'virtual' ? 'text-green-400' : expMode === 'backtest' ? 'text-blue-400' : expMode === 'live' ? 'text-orange-400' : 'text-gray-500';
      const modeTag = modeLabel ? `<span class="${modeCls} font-semibold" title="${this.escapeHtml(expMode)}">[${modeLabel}]</span>` : '';
      const expLink = expId ? `/experiment/${expId}` : '#';
      const expCell = expId
        ? `<div class="flex flex-col gap-0.5">
            <a href="${expLink}" target="_blank" class="text-gray-300 hover:text-white hover:underline text-xs truncate max-w-[150px]" title="${this.escapeHtml(expName || expId)}">${expName ? this.escapeHtml(expName) : '<span class="text-gray-500 italic">(无名称)</span>'} ${modeTag}</a>
            <div class="flex items-center gap-1">
              <span class="text-gray-500 font-mono text-[11px]">${expShort}</span>
              <button type="button" data-copy="${expId}" class="copy-exp-btn text-gray-500 hover:text-white text-[11px] px-0.5 leading-none" title="复制完整实验ID: ${expId}">📋</button>
            </div>
          </div>`
        : '<span class="text-gray-600">-</span>';
      // 代币分类 badge（token_profiles 离线/OPB 定性；无分类行不显示——多数新票未定性属常态）
      const cls = this.tokenClassifications[addr];
      const clsInfo = cls && cls.category ? (TOKEN_PROFILE_MAP[cls.category] || TOKEN_PROFILE_MAP.neutral) : null;
      const clsSrc = cls && cls.source === 'online' ? '在线' : cls && cls.source === 'offline' ? '离线' : '';
      const clsMcap = cls && cls.maxMcap != null && cls.maxMcap !== 0 ? ` · 峰值 $${this.fmtMcap(cls.maxMcap)}` : '';
      const catBadge = clsInfo
        ? `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-semibold border whitespace-nowrap ${clsInfo.colorClass} ${clsInfo.bgClass} ${clsInfo.borderClass}" title="代币分类（${clsSrc || '来源未知'}${clsMcap}）">${clsInfo.emoji} ${clsInfo.label}</span>`
        : '';
      const tokenCell = addr
        ? `<div class="flex items-center gap-1.5 flex-wrap">
            <a href="/token-ticks?token=${encodeURIComponent(addr)}" target="_blank" class="text-yellow-400 hover:underline font-mono text-xs" title="${addr}">${this.escapeHtml(symbol)}</a>
            ${platBadge}
            ${catBadge}
            <a href="https://gmgn.ai/bsc/token/${addr}" target="_blank" rel="noopener noreferrer" class="text-xs px-1.5 py-0.5 bg-purple-600 hover:bg-purple-700 rounded text-white whitespace-nowrap">📊 GMGN</a>
           </div>`
        : '-';
      return `<tr class="hover:bg-gray-700">
        <td class="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">${this.formatTime(t.block_time)}</td>
        <td class="px-4 py-2.5">${tokenCell}</td>
        <td class="px-4 py-2.5 text-center whitespace-nowrap">${typeBadge}</td>
        <td class="px-4 py-2.5 text-right text-yellow-400 font-mono">${this.formatBnb(t.bnb_amount)}</td>
        <td class="px-4 py-2.5 text-right text-gray-300 font-mono">${this.formatPrice(t.price_usd)}</td>
        <td class="px-4 py-2.5">${expCell}</td>
      </tr>`;
    }).join('');

    // 分页控件状态
    const prev = document.getElementById('prev-page');
    const next = document.getElementById('next-page');
    const pageInfo = document.getElementById('page-info');
    const tableInfo = document.getElementById('table-info');
    prev.disabled = this.currentPage <= 1;
    next.disabled = this.currentPage >= totalPages;
    pageInfo.textContent = `第 ${this.currentPage} / ${totalPages} 页`;
    tableInfo.textContent = this.trades.length > 0
      ? `第 ${start + 1}-${Math.min(start + this.pageSize, this.trades.length)} 条 / 共 ${this.trades.length} 条`
      : '';
  }

  /** 实验分布聚合面板：按 experiment_id 聚合交易（笔数/买卖/BNB/代币数），按笔数降序展示 */
  _renderExperimentBreakdown() {
    const el = document.getElementById('experiment-breakdown');
    if (!el) return;
    if (!this.trades.length) { el.innerHTML = '<span class="text-gray-500">无交易记录</span>'; return; }
    const NONE = '(无实验)';
    const agg = {};
    for (const t of this.trades) {
      const eid = t.experiment_id || NONE;
      if (!agg[eid]) agg[eid] = { count: 0, buys: 0, sells: 0, vol: 0, tokens: new Set() };
      const a = agg[eid];
      a.count++;
      if (t.trade_type === 'buy') a.buys++; else if (t.trade_type === 'sell') a.sells++;
      a.vol += Number(t.bnb_amount) || 0;
      if (t.token_address) a.tokens.add(t.token_address);
    }
    const total = this.trades.length;
    const rows = Object.entries(agg).sort((a, b) => b[1].count - a[1].count);
    el.innerHTML = rows.map(([eid, a]) => {
      const pct = (a.count / total * 100).toFixed(1);
      const info = eid !== NONE ? (this.experimentInfo[eid] || null) : null;
      const name = (info && info.name) || '';
      const mode = (info && info.mode) || '';
      const modeLabel = mode === 'virtual' ? 'V' : mode === 'backtest' ? 'BT' : mode === 'live' ? 'LIVE' : '';
      const modeCls = mode === 'virtual' ? 'text-green-400' : mode === 'backtest' ? 'text-blue-400' : mode === 'live' ? 'text-orange-400' : 'text-gray-500';
      const modeTag = modeLabel ? `<span class="${modeCls} font-semibold" title="${this.escapeHtml(mode)}">[${modeLabel}]</span>` : '';
      const short = eid !== NONE ? eid.slice(0, 8) : '-';
      const link = eid !== NONE ? `/experiment/${eid}` : '#';
      const nameCell = eid !== NONE
        ? `<a href="${link}" target="_blank" class="text-gray-200 hover:text-white hover:underline text-xs truncate max-w-[160px] inline-block align-middle" title="${this.escapeHtml(name || eid)}">${name ? this.escapeHtml(name) : '<span class="text-gray-500 italic">(无名称)</span>'} ${modeTag}</a>`
        : '<span class="text-gray-500 text-xs italic">(无实验)</span>';
      const copyBtn = eid !== NONE
        ? `<button type="button" data-copy="${eid}" class="copy-exp-btn text-gray-500 hover:text-white text-[11px] px-0.5 leading-none" title="复制完整实验ID: ${eid}">📋</button>`
        : '';
      return `<div class="flex items-center gap-3 py-1.5 border-b border-gray-700/50 last:border-0 flex-wrap">
        <div class="flex items-center gap-1 min-w-[180px] flex-1">${nameCell}${copyBtn}<span class="text-gray-500 font-mono text-[11px]">${short}</span></div>
        <span class="text-white font-semibold text-xs whitespace-nowrap">${a.count} 笔 <span class="text-gray-500 font-normal">(${pct}%)</span></span>
        <span class="text-green-400 text-xs whitespace-nowrap">买${a.buys}</span>
        <span class="text-red-400 text-xs whitespace-nowrap">卖${a.sells}</span>
        <span class="text-yellow-400 text-xs font-mono whitespace-nowrap">${this.formatBnb(a.vol)}</span>
        <span class="text-blue-400 text-xs whitespace-nowrap">${a.tokens.size} 币</span>
      </div>`;
    }).join('');
  }

  showError(msg) {
    const tbody = document.getElementById('trades-tbody');
    const empty = document.getElementById('empty-state');
    if (tbody) tbody.innerHTML = '';
    if (empty) {
      empty.classList.remove('hidden');
      empty.textContent = msg;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.traderDetail = new TraderDetail();
});
