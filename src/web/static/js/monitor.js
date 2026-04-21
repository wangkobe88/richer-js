/**
 * 事件监控页面 JS
 * 使用 Supabase Realtime 实时推送，回退到轮询
 */

// ============ 配置 ============
const POLLING_INTERVAL = 5000; // 轮询间隔（毫秒）
const PAGE_SIZE = 50;

// ============ 状态 ============
let allEvents = [];
let supabaseClient = null;
let channel = null;
let pollingTimer = null;
let narrativeRefreshTimer = null;
let isRealtime = false;
let isLoadingHistory = false;
let hasMoreEvents = false;
let currentOffset = 0;
let soundEnabled = true;

// 筛选状态
let filterAction = '';
let filterRating = '';
let filterToken = '';

// ============ 初始化 ============
async function init() {
  setupEventListeners();
  await loadHistory();
  await initRealtime();
}

// ============ Supabase Realtime ============
async function initRealtime() {
  try {
    // 获取 Supabase 配置
    const configResp = await fetch('/api/supabase-config');
    const config = await configResp.json();

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.warn('[Monitor] Supabase 配置缺失，使用轮询模式');
      startPolling();
      return;
    }

    // 动态加载 Supabase JS 客户端
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey);

    // 订阅 experiment_events 的 INSERT 事件
    channel = supabaseClient
      .channel('experiment-events-monitor')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'experiment_events' },
        (payload) => {
          onNewEvent(payload.new);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          isRealtime = true;
          updateConnectionStatus('connected', '实时连接');
          startNarrativeRefresh();
          console.log('[Monitor] Supabase Realtime 已连接');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Monitor] Realtime 连接失败，切换到轮询模式');
          startPolling();
        }
      });
  } catch (err) {
    console.warn('[Monitor] 初始化 Realtime 失败，使用轮询模式:', err.message);
    startPolling();
  }
}

/**
 * Realtime 新事件回调
 */
function onNewEvent(event) {
  // 避免重复（轮询也可能拉到同一条）
  if (allEvents.some(e => e.id === event.id)) return;

  allEvents.unshift(event);
  renderTokenNav();
  renderEvents();
  showNewEventAnimation(event.id);
  playNotificationSound();
  updateEventCount();
}

// ============ 轮询 ============
function startPolling() {
  if (pollingTimer) return;
  stopNarrativeRefresh();
  isRealtime = false;
  updateConnectionStatus('polling', '轮询模式');

  pollingTimer = setInterval(async () => {
    try {
      await pollNewEvents();
    } catch (err) {
      console.error('[Monitor] 轮询失败:', err.message);
    }
  }, POLLING_INTERVAL);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

// ============ 叙事数据定期刷新（Realtime 模式） ============
function startNarrativeRefresh() {
  if (pollingTimer || narrativeRefreshTimer) return;
  narrativeRefreshTimer = setInterval(async () => {
    try {
      await refreshExistingEvents();
    } catch (err) {
      console.error('[Monitor] 叙事数据刷新失败:', err.message);
    }
  }, 15000);
}

function stopNarrativeRefresh() {
  if (narrativeRefreshTimer) {
    clearInterval(narrativeRefreshTimer);
    narrativeRefreshTimer = null;
  }
}

async function refreshExistingEvents() {
  if (allEvents.length === 0) return;

  const params = new URLSearchParams({
    limit: String(Math.min(allEvents.length, PAGE_SIZE)),
    offset: '0'
  });

  const resp = await fetch(`/api/events?${params}`);
  const result = await resp.json();
  if (!result.success) return;

  let hasUpdates = false;
  for (const apiEvent of result.data) {
    const existing = allEvents.find(e => e.id === apiEvent.id);
    if (existing) {
      if (JSON.stringify(existing.summary) !== JSON.stringify(apiEvent.summary) ||
          JSON.stringify(existing.details) !== JSON.stringify(apiEvent.details)) {
        existing.summary = apiEvent.summary;
        existing.details = apiEvent.details;
        hasUpdates = true;
      }
    }
  }

  if (hasUpdates) {
    renderEvents();
  }
}

async function pollNewEvents() {
  const params = new URLSearchParams({
    limit: '20',
    offset: '0'
  });

  const resp = await fetch(`/api/events?${params}`);
  const result = await resp.json();

  if (!result.success) return;

  const apiEvents = result.data;
  let hasUpdates = false;

  // 更新已有事件的叙事数据（叙事分析可能已完成）
  for (const apiEvent of apiEvents) {
    const existing = allEvents.find(e => e.id === apiEvent.id);
    if (existing) {
      if (JSON.stringify(existing.summary) !== JSON.stringify(apiEvent.summary) ||
          JSON.stringify(existing.details) !== JSON.stringify(apiEvent.details)) {
        existing.summary = apiEvent.summary;
        existing.details = apiEvent.details;
        hasUpdates = true;
      }
    }
  }

  // 添加新事件
  const newEvents = apiEvents.filter(e =>
    !allEvents.some(existing => existing.id === e.id)
  );

  if (newEvents.length > 0) {
    allEvents = [...newEvents, ...allEvents];
    allEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    hasUpdates = true;
    newEvents.forEach(e => showNewEventAnimation(e.id));
    playNotificationSound();
  }

  if (hasUpdates) {
    renderTokenNav();
    renderEvents();
    updateEventCount();
  }
}

// ============ 数据加载 ============
async function loadHistory() {
  if (isLoadingHistory) return;
  isLoadingHistory = true;

  try {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(currentOffset)
    });

    const resp = await fetch(`/api/events?${params}`);
    const result = await resp.json();

    if (result.success) {
      allEvents = result.data || [];
      hasMoreEvents = allEvents.length >= PAGE_SIZE;
      currentOffset = allEvents.length;
      renderTokenNav();
      renderEvents();
      updateEventCount();
      toggleLoadMore();
    }
  } catch (err) {
    console.error('[Monitor] 加载历史失败:', err.message);
  } finally {
    isLoadingHistory = false;
    document.getElementById('loading-indicator')?.remove();
  }
}

async function loadMore() {
  if (isLoadingHistory) return;
  isLoadingHistory = true;

  try {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(currentOffset)
    });

    const resp = await fetch(`/api/events?${params}`);
    const result = await resp.json();

    if (result.success) {
      const olderEvents = result.data || [];
      allEvents = [...allEvents, ...olderEvents];
      hasMoreEvents = olderEvents.length >= PAGE_SIZE;
      currentOffset = allEvents.length;
      renderEvents();
      toggleLoadMore();
    }
  } catch (err) {
    console.error('[Monitor] 加载更多失败:', err.message);
  } finally {
    isLoadingHistory = false;
  }
}

// ============ 渲染 ============
function renderEvents() {
  const container = document.getElementById('events-container');
  const filtered = getFilteredEvents();

  if (filtered.length === 0 && !isLoadingHistory) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="text-5xl mb-4">📡</div>
        <h3 class="text-lg font-medium text-gray-900 mb-2">暂无事件</h3>
        <p class="text-gray-500">等待实验引擎产生信号事件...</p>
      </div>
    `;
    return;
  }

  const html = filtered.map(event => renderEventCard(event)).join('');
  container.innerHTML = html;
}

function buildActionLinks(event) {
  const expId = event.experiment_id;
  const addr = event.token_address;
  const chain = (event.chain || 'bsc').toLowerCase();
  if (!expId || !addr) return '';

  const chainMap = { bsc: 'bsc', eth: 'eth', ethereum: 'eth', solana: 'sol', sol: 'sol', base: 'base' };
  const gmgnChain = chainMap[chain] || 'bsc';

  const links = [
    `<a href="/experiment/${expId}/signals#token=${addr}" target="_blank" class="hover:text-blue-600">信号</a>`,
    `<a href="/experiment/${expId}/strategy-analysis?tokenAddress=${addr}" target="_blank" class="hover:text-pink-500">策略</a>`,
    `<a href="/experiment/${expId}/observer#token=${addr}" target="_blank" class="hover:text-emerald-500">时序</a>`,
    `<a href="/token-early-trades?token=${addr}&chain=${chain}" target="_blank" class="hover:text-amber-500">早期</a>`,
    `<a href="/token-holders?experiment=${expId}&token=${addr}" target="_blank" class="hover:text-cyan-500">持有者</a>`,
    `<a href="/token-detail?experiment=${expId}&address=${addr}" target="_blank" class="hover:text-indigo-500">详情</a>`
  ];

  return links.join('<span class="text-gray-300">|</span>');
}

function renderEventCard(event) {
  const s = event.summary || {};
  const d = event.details || {};
  const isBuy = event.action === 'buy';
  const timeStr = formatTime(event.created_at);
  const shortAddr = shortenAddress(event.token_address);
  const _chainMap = { bsc: 'bsc', eth: 'eth', ethereum: 'eth', solana: 'sol', sol: 'sol', base: 'base' };
  const _gmgnChain = _chainMap[(event.chain || 'bsc').toLowerCase()] || 'bsc';

  // 动作标签
  const actionClass = isBuy ? 'action-buy' : 'action-sell';
  const actionText = isBuy ? '买入' : '卖出';
  const actionIcon = isBuy ? '🟢' : '🔴';

  // 执行状态
  const execClass = event.executed ? 'exec-ok' : 'exec-rejected';
  const execText = event.executed ? '已执行' : '被拒绝';

  // 信号序号
  const indexStr = s.signalIndex ? `#${s.signalIndex} ` : '';
  const isThirdBuy = isBuy && s.signalIndex === 3;

  // 市值
  const marketCapStr = s.marketCap != null ? formatMarketCap(s.marketCap) : '';

  // 涨幅
  const returnStr = s.earlyReturn != null ? `${s.earlyReturn >= 0 ? '+' : ''}${s.earlyReturn.toFixed(1)}%` : '';

  // 叙事评级
  const ratingHtml = renderRatingBadge(s.narrativeRating, s.narrativeScore);

  // 利润（卖出时）
  const profitStr = s.profitPercent != null
    ? `<span class="${s.profitPercent >= 0 ? 'text-green-600' : 'text-red-600'}">${s.profitPercent >= 0 ? '+' : ''}${s.profitPercent.toFixed(1)}%</span>`
    : '';

  // 持仓时长（卖出时）
  const holdStr = s.holdDuration != null ? formatDuration(s.holdDuration) : '';

  // 卖出卡数
  const cardsStr = s.cards ? (s.cards === 'all' ? '全部' : `${s.cards}卡`) : '';

  // 展开区域内容
  const expandId = `expand-${event.id}`;
  let expandContent = '';

  // 叙事原因
  if (d.narrativeReason) {
    expandContent += `<div class="text-sm text-gray-600 mt-2"><strong>叙事原因:</strong> ${escapeHtml(d.narrativeReason)}</div>`;
  }

  // 阶段摘要
  if (d.stageSummaries) {
    const stages = d.stageSummaries;
    const stageOrder = ['preCheck', 'prestage', 'stage1', 'stage2', 'stage3'];
    const stageLabels = { preCheck: '预检查', prestage: '预处理', stage1: '事件分析', stage2: '关联性', stage3: '质量评估' };
    let stageHtml = '<div class="mt-2 text-sm"><strong>阶段详情:</strong></div>';
    for (const name of stageOrder) {
      const st = stages[name];
      if (!st) continue;
      const passIcon = st.pass === true ? '✅' : st.pass === false ? '❌' : '⚪';
      const scorePart = st.score != null ? ` ${st.score.toFixed(1)}` : '';
      const catPart = st.category ? ` [${st.category}]` : '';
      const reasonPart = st.reason ? ` — ${escapeHtml(st.reason.substring(0, 150))}${st.reason.length > 150 ? '...' : ''}` : '';
      stageHtml += `<div class="ml-2 text-gray-600">${passIcon} ${stageLabels[name] || name}${catPart}${scorePart}${reasonPart}</div>`;

      // 预检查具体信息：同名代币 / 语料复用 / 重复叙事
      if (name === 'preCheck' && st.details) {
        const det = st.details;
        // 同名代币
        if (det.sameNameTokens && det.sameNameTokens.length > 0) {
          stageHtml += '<div class="ml-6 text-xs text-orange-700 mt-1">同名代币:';
          for (const t of det.sameNameTokens) {
            const addr = t.address ? shortenAddress(t.address) : '';
            const fdvStr = t.fdv ? ` FDV:${formatMarketCap(parseFloat(t.fdv))}` : '';
            const txStr = t.txCount ? ` 交易:${t.txCount}` : '';
            const gmgnLink = t.address ? ` <a href="https://gmgn.ai/${_gmgnChain}/token/${t.address}" target="_blank" class="inline-flex items-center"><img src="/static/gmgn.png" alt="GMGN" class="w-3 h-3"></a>` : '';
            stageHtml += `<div class="ml-2">• ${escapeHtml(t.symbol || t.name || '???')} <span class="mono">${addr}</span>${fdvStr}${txStr}${gmgnLink}</div>`;
          }
          stageHtml += '</div>';
        }
        // 语料复用的早期代币
        if (det.earlierTokens && det.earlierTokens.length > 0) {
          stageHtml += '<div class="ml-6 text-xs text-orange-700 mt-1">语料复用代币:';
          for (const t of det.earlierTokens) {
            const addr = t.address ? shortenAddress(t.address) : '';
            const timeStr2 = t.timeDiffText ? ` (${t.timeDiffText}前)` : '';
            const gmgnLink = t.address ? ` <a href="https://gmgn.ai/${_gmgnChain}/token/${t.address}" target="_blank" class="inline-flex items-center"><img src="/static/gmgn.png" alt="GMGN" class="w-3 h-3"></a>` : '';
            stageHtml += `<div class="ml-2">• ${escapeHtml(t.symbol || '???')} <span class="mono">${addr}</span>${timeStr2}${gmgnLink}</div>`;
          }
          stageHtml += '</div>';
        }
        // 同名+同推文重复
        if (det.matchedTokenSymbol && det.matchedTokenAddress) {
          const addr = shortenAddress(det.matchedTokenAddress);
          const gmgnLink = `<a href="https://gmgn.ai/${_gmgnChain}/token/${det.matchedTokenAddress}" target="_blank" class="inline-flex items-center"><img src="/static/gmgn.png" alt="GMGN" class="w-3 h-3"></a>`;
          stageHtml += `<div class="ml-6 text-xs text-orange-700 mt-1">重复叙事: ${escapeHtml(det.matchedTokenSymbol)} <span class="mono">${addr}</span> ${gmgnLink}</div>`;
        }
      }
    }
    expandContent += stageHtml;
  }

  // 拒绝原因
  if (d.executionReason) {
    expandContent += `<div class="mt-2 text-sm text-red-600"><strong>拒绝原因:</strong> ${escapeHtml(d.executionReason)}</div>`;
  }

  // 语料来源（买入事件）
  if (d.sourceUrls) {
    const allUrls = [];
    const labels = { twitter: '推特', websites: '网站', telegram: 'Telegram', discord: 'Discord', youtube: 'YouTube' };
    for (const [platform, urls] of Object.entries(d.sourceUrls)) {
      const label = labels[platform] || platform;
      for (const u of urls) {
        allUrls.push(`<a href="${escapeHtml(u.url)}" target="_blank" class="text-blue-500 hover:text-blue-700">${label}</a>`);
      }
    }
    if (allUrls.length > 0) {
      expandContent += `<div class="mt-2 text-sm"><strong>语料来源:</strong> ${allUrls.join(' ')}</div>`;
    }
  }

  // 推文内容
  if (d.tweetContents && d.tweetContents.length > 0) {
    for (const tw of d.tweetContents) {
      const authorStr = tw.author ? `@${escapeHtml(tw.author)}` : '';
      expandContent += `<div class="mt-2 p-2 bg-gray-50 rounded text-sm">
        <div class="text-gray-500 text-xs mb-1">${authorStr} <a href="${escapeHtml(tw.url)}" target="_blank" class="text-blue-400">原文</a></div>
        <div class="text-gray-700">${escapeHtml(tw.text)}</div>
      </div>`;
    }
  }

  // 卖出收益详情
  if (d.buyPrice != null || d.sellPrice != null) {
    const priceParts = [];
    if (d.buyPrice != null) priceParts.push(`买入价: ${d.buyPrice}`);
    if (d.sellPrice != null) priceParts.push(`卖出价: ${d.sellPrice}`);
    if (d.highestPrice != null) priceParts.push(`最高价: ${d.highestPrice}`);
    if (d.drawdownFromHighest != null) priceParts.push(`回撤: ${d.drawdownFromHighest.toFixed(1)}%`);
    expandContent += `<div class="mt-2 text-sm"><strong>价格详情:</strong> ${priceParts.join(' | ')}</div>`;
  }

  return `
    <div class="event-card ${isThirdBuy ? 'event-third-buy' : ''}" id="card-${event.id}" data-action="${event.action}" data-rating="${s.narrativeRating || ''}">
      <!-- 头部 -->
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2 flex-wrap">
          <span class="action-tag ${actionClass}">${actionIcon} ${indexStr}${actionText}</span>
          <span class="exec-status ${execClass}">${execText}</span>
          <span class="font-semibold text-gray-900">${escapeHtml(event.token_symbol || '???')}</span>
          <span class="mono text-xs text-gray-500">${shortAddr}</span>
          <span class="text-xs text-gray-400 uppercase">${formatChain(event.chain)}</span>
          ${d.gmgnUrl ? `<a href="${d.gmgnUrl}" target="_blank" title="在GMGN中查看" class="inline-flex items-center p-1 rounded bg-gray-100 hover:bg-blue-100 transition-colors"><img src="/static/gmgn.png" alt="GMGN" class="w-5 h-5"></a>` : ''}
        </div>
        <div class="flex items-center space-x-2 text-xs text-gray-400">
          <span>${timeStr}</span>
          ${expandContent ? `<button class="expand-btn text-blue-500 hover:text-blue-700" data-target="${expandId}">收起</button>` : ''}
        </div>
      </div>

      <!-- 摘要行 -->
      <div class="flex items-center flex-wrap gap-3 mt-2 text-sm">
        ${marketCapStr ? `<span class="text-gray-700">💰 \`${formatMarketCap(s.marketCap)}\`</span>` : ''}
        ${returnStr ? `<span class="text-gray-700">📈 \`${returnStr}\`</span>` : ''}
        ${ratingHtml}
        ${profitStr ? `<span>利润: ${profitStr}</span>` : ''}
        ${holdStr ? `<span class="text-gray-600">⏱ ${holdStr}</span>` : ''}
        ${cardsStr ? `<span class="text-gray-600">卖出: ${cardsStr}</span>` : ''}
      </div>

      <!-- 操作链接 -->
      <div class="flex items-center gap-2 mt-2 text-xs text-gray-500 flex-wrap">
        ${buildActionLinks(event)}
      </div>

      <!-- 展开区域 -->
      ${expandContent ? `<div class="expand-content" id="${expandId}"><div class="border-t border-gray-100 mt-2 pt-2">${expandContent}</div></div>` : ''}
    </div>
  `;
}

function renderRatingBadge(rating, score) {
  if (!rating) return '';
  const labels = { high: '高质量', mid: '中等', low: '低质量', unrated: '未评级' };
  const label = labels[rating] || rating;
  const scoreStr = (score != null && typeof score === 'number') ? ` ${score.toFixed(1)}` : '';
  return `<span class="rating-badge rating-${rating}">${label}${scoreStr}</span>`;
}

// ============ 筛选 ============
function getFilteredEvents() {
  return allEvents.filter(event => {
    const s = event.summary || {};
    if (filterAction && event.action !== filterAction) return false;
    if (filterRating && (s.narrativeRating || '') !== filterRating) return false;
    if (filterToken && event.token_symbol !== filterToken) return false;
    return true;
  });
}

function applyFilters() {
  filterAction = document.getElementById('action-filter').value;
  filterRating = document.getElementById('rating-filter').value;
  renderEvents();
}

function clearFilters() {
  document.getElementById('action-filter').value = '';
  document.getElementById('rating-filter').value = '';
  filterAction = '';
  filterRating = '';
  filterToken = '';
  renderTokenNav();
  renderEvents();
}

// ============ 代币导航栏 ============
function renderTokenNav() {
  const nav = document.getElementById('token-nav');
  if (!nav) return;

  // 聚合代币统计
  const tokenStats = {};
  for (const e of allEvents) {
    const sym = e.token_symbol || '???';
    if (!tokenStats[sym]) tokenStats[sym] = { buy: 0, sell: 0, symbol: sym };
    if (e.action === 'buy') tokenStats[sym].buy++;
    if (e.action === 'sell') tokenStats[sym].sell++;
  }

  const tokens = Object.values(tokenStats);
  if (tokens.length === 0) { nav.innerHTML = ''; return; }

  // 全部按钮
  const allActive = !filterToken;
  let html = `<button class="token-nav-btn ${allActive ? 'active' : ''}" data-token="">全部 (${allEvents.length})</button>`;

  for (const t of tokens) {
    const parts = [];
    if (t.buy > 0) parts.push(`买${t.buy}`);
    if (t.sell > 0) parts.push(`卖${t.sell}`);
    const active = filterToken === t.symbol;
    html += `<button class="token-nav-btn ${active ? 'active' : ''}" data-token="${escapeHtml(t.symbol)}">${escapeHtml(t.symbol)} (${parts.join(' ')})</button>`;
  }

  nav.innerHTML = html;
}

// ============ UI 辅助 ============
function updateConnectionStatus(type, text) {
  const dot = document.getElementById('connection-dot');
  const statusEl = document.getElementById('connection-status');
  dot.className = `connection-dot ${type}`;
  statusEl.textContent = text;
}

function updateEventCount() {
  const display = document.getElementById('event-count-display');
  const filtered = getFilteredEvents();
  display.textContent = `共 ${allEvents.length} 条事件`;
}

function toggleLoadMore() {
  const container = document.getElementById('load-more-container');
  if (hasMoreEvents) {
    container.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
  }
}

function showNewEventAnimation(eventId) {
  setTimeout(() => {
    const card = document.getElementById(`card-${eventId}`);
    if (card) {
      card.classList.add('event-new');
      setTimeout(() => card.classList.remove('event-new'), 2000);
    }
  }, 50);
}

/**
 * 播放新事件提示音
 */
function playNotificationSound() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // 浏览器可能阻止自动播放，忽略
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('sound-toggle-btn');
  btn.textContent = soundEnabled ? '🔔' : '🔕';
  btn.title = soundEnabled ? '声音已开启，点击静音' : '声音已关闭，点击开启';
}

// ============ 清空数据 ============
function closePurgeModal() {
  document.getElementById('purge-modal').classList.add('hidden');
}

function updatePurgePreview() {
  const hours = parseInt(document.getElementById('purge-hours').value) || 0;
  const preview = document.getElementById('purge-preview');
  if (hours <= 0) {
    preview.textContent = '';
    return;
  }
  const cutoff = new Date(Date.now() - hours * 3600000);
  const olderCount = allEvents.filter(e => new Date(e.created_at) < cutoff).length;
  preview.textContent = `将删除 ${cutoff.toLocaleString('zh-CN')} 之前的 ${olderCount} 条事件（当前页面统计，实际以数据库为准）`;
}

async function executePurge() {
  const hours = parseInt(document.getElementById('purge-hours').value) || 0;
  if (hours <= 0) return;

  const btn = document.getElementById('confirm-purge-btn');
  btn.disabled = true;
  btn.textContent = '清空中...';

  try {
    const resp = await fetch('/api/events/purge', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepHours: hours })
    });
    const result = await resp.json();

    if (result.success) {
      closePurgeModal();
      // 刷新页面数据
      allEvents = [];
      currentOffset = 0;
      await loadHistory();
      renderTokenNav();
    } else {
      alert('清空失败: ' + result.error);
    }
  } catch (err) {
    alert('清空失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '确认清空';
  }
}

// ============ 格式化工具 ============
function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const absolute = isToday ? timeStr : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${timeStr}`;
  const relative = formatTimeAgo(d, now);
  return `${absolute} <span class="text-gray-400">(${relative})</span>`;
}

function formatTimeAgo(date, now) {
  const diffMs = now - date;
  if (diffMs < 0) return '刚刚';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  const months = Math.floor(days / 30);
  return `${months}个月前`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function shortenAddress(addr) {
  if (!addr || addr.length < 16) return addr || '';
  return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
}

function formatMarketCap(num) {
  if (num == null || isNaN(num)) return '';
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function formatDuration(ms) {
  if (ms == null) return '';
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}时${minutes % 60}分`;
  return `${minutes}分`;
}

function formatChain(chain) {
  const map = { bsc: 'BSC', eth: 'ETH', ethereum: 'ETH', solana: 'SOL', sol: 'SOL', base: 'BASE' };
  return map[(chain || 'bsc').toLowerCase()] || (chain || 'BSC').toUpperCase();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============ 事件监听 ============
function setupEventListeners() {
  // 筛选
  document.getElementById('action-filter').addEventListener('change', applyFilters);
  document.getElementById('rating-filter').addEventListener('change', applyFilters);
  document.getElementById('clear-filter-btn').addEventListener('click', clearFilters);

  // 加载更多
  document.getElementById('load-more-btn').addEventListener('click', loadMore);

  // 声音开关
  document.getElementById('sound-toggle-btn').addEventListener('click', toggleSound);

  // 清空数据
  document.getElementById('purge-btn').addEventListener('click', () => {
    document.getElementById('purge-modal').classList.remove('hidden');
    updatePurgePreview();
  });
  document.getElementById('close-purge-btn').addEventListener('click', closePurgeModal);
  document.getElementById('cancel-purge-btn').addEventListener('click', closePurgeModal);
  document.getElementById('purge-hours').addEventListener('input', updatePurgePreview);
  document.getElementById('confirm-purge-btn').addEventListener('click', executePurge);

  // 代币导航点击（事件委托）
  document.getElementById('token-nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.token-nav-btn');
    if (!btn) return;
    const token = btn.dataset.token;
    if (filterToken === token) {
      filterToken = ''; // 再次点击取消选中
    } else {
      filterToken = token;
    }
    renderTokenNav();
    renderEvents();
  });

  // 展开/折叠（事件委托）
  document.getElementById('events-container').addEventListener('click', (e) => {
    const btn = e.target.closest('.expand-btn');
    if (!btn) return;
    const targetId = btn.dataset.target;
    const content = document.getElementById(targetId);
    if (content) {
      content.classList.toggle('collapsed');
      btn.textContent = content.classList.contains('collapsed') ? '展开' : '收起';
    }
  });
}

// ============ 启动 ============
// type="module" 脚本默认 defer，DOMContentLoaded 可能已触发，直接调用 init
init();
