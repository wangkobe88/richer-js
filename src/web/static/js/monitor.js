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
let isRealtime = false;
let isLoadingHistory = false;
let hasMoreEvents = false;
let currentOffset = 0;

// 筛选状态
let filterAction = '';
let filterRating = '';

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
  renderEvents();
  showNewEventAnimation(event.id);
  updateEventCount();
}

// ============ 轮询 ============
function startPolling() {
  if (pollingTimer) return;
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

async function pollNewEvents() {
  // 只拉取最新的一条之后的事件
  const latestCreatedAt = allEvents.length > 0
    ? allEvents[0].created_at
    : new Date().toISOString();

  const params = new URLSearchParams({
    limit: '20',
    offset: '0'
  });

  const resp = await fetch(`/api/events?${params}`);
  const result = await resp.json();

  if (!result.success) return;

  const newEvents = result.data.filter(e =>
    !allEvents.some(existing => existing.id === e.id)
  );

  if (newEvents.length > 0) {
    // 按时间排序后插入
    allEvents = [...newEvents, ...allEvents];
    allEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    renderEvents();
    newEvents.forEach(e => showNewEventAnimation(e.id));
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

function renderEventCard(event) {
  const s = event.summary || {};
  const d = event.details || {};
  const isBuy = event.action === 'buy';
  const timeStr = formatTime(event.created_at);
  const shortAddr = shortenAddress(event.token_address);

  // 动作标签
  const actionClass = isBuy ? 'action-buy' : 'action-sell';
  const actionText = isBuy ? '买入' : '卖出';
  const actionIcon = isBuy ? '🟢' : '🔴';

  // 执行状态
  const execClass = event.executed ? 'exec-ok' : 'exec-rejected';
  const execText = event.executed ? '已执行' : '被拒绝';

  // 信号序号
  const indexStr = s.signalIndex ? `#${s.signalIndex} ` : '';

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
    }
    expandContent += stageHtml;
  }

  // 拒绝原因
  if (d.executionReason) {
    expandContent += `<div class="mt-2 text-sm text-red-600"><strong>拒绝原因:</strong> ${escapeHtml(d.executionReason)}</div>`;
  }

  return `
    <div class="event-card" id="card-${event.id}" data-action="${event.action}" data-rating="${s.narrativeRating || ''}">
      <!-- 头部 -->
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2 flex-wrap">
          <span class="action-tag ${actionClass}">${actionIcon} ${indexStr}${actionText}</span>
          <span class="exec-status ${execClass}">${execText}</span>
          <span class="font-semibold text-gray-900">${escapeHtml(event.token_symbol || '???')}</span>
          <span class="mono text-xs text-gray-500">${shortAddr}</span>
          <span class="text-xs text-gray-400 uppercase">${event.chain || 'BSC'}</span>
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

      <!-- 链接 -->
      <div class="flex items-center space-x-3 mt-2 text-xs">
        ${d.gmgnUrl ? `<a href="${d.gmgnUrl}" target="_blank" class="text-blue-500 hover:text-blue-700">GMGN</a>` : ''}
        ${d.signalsUrl ? `<a href="${d.signalsUrl}" target="_blank" class="text-blue-500 hover:text-blue-700">信号</a>` : ''}
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
  renderEvents();
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

// ============ 格式化工具 ============
function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (isToday) return timeStr;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${timeStr}`;
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
