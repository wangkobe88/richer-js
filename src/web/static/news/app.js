/* news-monitor 前端（原 news_monitor web/public/app.js 收编）：原生 JS，无构建。
   60s 报告+状态轮询、30s 事件流增量（before id 游标），document.hidden 暂停。
   API 基路径 /api/news（richer-js web-server 挂载前缀）。 */
'use strict';

const $ = id => document.getElementById(id);

const TYPE_ZH = {
  NEW_TWEET: '发推', NEW_TWEET_REPLY: '回复', NEW_TWEET_QUOTE: '引用',
  NEW_RETWEET: '转推', CA: '发推·CA', CA_CREATE: '新CA',
  NEW_FOLLOWER: '关注', NEW_UNFOLLOWER: '取关',
  UPDATE_NAME: '改名', UPDATE_DESCRIPTION: '改简介',
  UPDATE_AVATAR: '换头像', UPDATE_BANNER: '换横幅',
  TWEET_TOPPING: '置顶', DELETE: '删推',
};
const MUTED_TYPES = new Set(['NEW_FOLLOWER', 'NEW_UNFOLLOWER', 'UPDATE_NAME',
  'UPDATE_DESCRIPTION', 'UPDATE_AVATAR', 'UPDATE_BANNER', 'TWEET_TOPPING']);

function fmtTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtWindow(a, b) {
  return `${fmtTime(a)} – ${fmtTime(b ? b.replace(/:\d\d$/, ':00') : b)}`;
}
function renderMd(md) {
  if (window.marked) {
    try { return marked.parse(md); } catch { /* fallthrough */ }
  }
  return `<pre>${md.replace(/</g, '&lt;')}</pre>`;
}
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- 状态条 ----------
async function refreshStatus() {
  try {
    const [st, ev] = await Promise.all([
      fetch('/api/news/status').then(r => r.json()),
      fetch('/api/news/events?limit=1').then(r => r.json()),
    ]);
    $('watch-count').textContent = st.watchCount ?? '-';
    $('latest-report-at').textContent = st.latestReportAt ? fmtTime(st.latestReportAt) : '-';
    // 事件活性：最新事件 created_at 10 分钟内 = 绿
    const lastEv = ev.events?.[0];
    const fresh = lastEv && Date.now() - new Date(lastEv.created_at).getTime() < 10 * 60 * 1000;
    $('pulse-dot').className = 'dot ' + (fresh ? 'on' : 'off');
    $('pulse-text').textContent = fresh ? '活跃' : (lastEv ? `静默(${fmtTime(lastEv.created_at)})` : '无事件');
  } catch (e) {
    $('pulse-text').textContent = '状态获取失败';
  }
}

// ---------- 报告 ----------
let currentReportId = null;

function reportMetaHtml(r) {
  const bits = [];
  if (r.llm_called) bits.push(`${r.model || 'LLM'} · in ${r.input_tokens ?? '-'} / out ${r.output_tokens ?? '-'}`);
  bits.push(`${r.event_count} 事件`);
  bits.push(fmtTime(r.created_at));
  return bits.join(' · ');
}

async function showReport(id) {
  const data = await fetch(`/api/news/report/${id}`).then(r => r.json());
  const r = data.report;
  if (!r) return;
  currentReportId = id;
  $('report-title').textContent = fmtWindow(r.window_start, r.window_end);
  $('report-meta').textContent = reportMetaHtml(r);
  $('report-body').innerHTML = renderMd(r.report_md);
  document.querySelectorAll('.report-list li').forEach(li =>
    li.classList.toggle('active', Number(li.dataset.id) === id));
}

async function refreshLatestReport() {
  const data = await fetch('/api/news/latest-report').then(r => r.json());
  if (data.report && data.report.id !== currentReportId) {
    await showReport(data.report.id);
    await loadReportList();
  } else if (!data.report) {
    $('report-title').textContent = '暂无报告';
    $('report-body').innerHTML = '<div class="empty">第一个小时的报告生成后会显示在这里</div>';
  }
}

async function loadReportList() {
  const data = await fetch('/api/news/reports?limit=30').then(r => r.json());
  const list = $('report-list');
  list.innerHTML = '';
  if (!data.reports?.length) {
    list.innerHTML = '<li class="empty" style="cursor:default">暂无历史报告</li>';
    return;
  }
  $('reports-count').textContent = `${data.reports.length} 份`;
  for (const r of data.reports) {
    const li = document.createElement('li');
    li.dataset.id = r.id;
    li.innerHTML = `
      <span class="win">${fmtWindow(r.window_start, r.window_end)}</span>
      <span>
        <span class="badge">${r.event_count} 事件</span>
        ${r.llm_called ? '<span class="badge llm">LLM</span>' : ''}
      </span>`;
    li.onclick = () => showReport(r.id);
    if (r.id === currentReportId) li.classList.add('active');
    list.appendChild(li);
  }
}

// ---------- 事件流 ----------
function eventContentText(ev) {
  const c = ev.content;
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return `关注/取关 ${c.length} 人`;
  if (typeof c === 'object') return c.text || '';
  return String(c);
}
function engagementText(ev) {
  const c = ev.content;
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    const parts = [];
    if (c.favoriteCount != null) parts.push(`♥${c.favoriteCount}`);
    if (c.retweetCount != null) parts.push(`⇆${c.retweetCount}`);
    if (c.viewCount != null) parts.push(`👁${c.viewCount}`);
    return parts.join(' ');
  }
  return '';
}

/** pbs.twimg.com 图片直链按需取尺寸（small≈300px / large 原图） */
function imgSize(url, name) {
  if (typeof url !== 'string' || !url) return url;
  return url.includes('?') ? url : `${url}?name=${name}`;
}
/** 事件富内容（图片网格 + 被回复/引用/转推原推块），数据中没有则返回空串 */
function eventRichHtml(ev) {
  const c = ev.content;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return '';
  let html = '';
  if (Array.isArray(c.media) && c.media.length) {
    const imgs = c.media.map(m => `
      <a class="media-cell" href="${esc(imgSize(m.url, 'large'))}" target="_blank" rel="noopener">
        <img src="${esc(imgSize(m.url, 'small'))}" loading="lazy" alt="推文图片"
          onerror="this.parentNode.classList.add('broken');this.remove()">${m.type && m.type !== 'photo' ? '<span class="play-mark">▶</span>' : ''}
      </a>`).join('');
    html += `<div class="media-grid n${Math.min(c.media.length, 4)}">${imgs}</div>`;
  }
  if (c.quoted && typeof c.quoted === 'object') {
    const q = c.quoted;
    const qMedia = Array.isArray(q.media) && q.media.length ? ` <span class="q-media-count">📎${q.media.length}</span>` : '';
    const who = q.user ? `<a class="q-user" href="https://x.com/${esc(q.user)}" target="_blank" rel="noopener">@${esc(q.user)}</a>` : '';
    html += q.text || who
      ? `<div class="quoted">${who}${qMedia}<div class="q-text">${esc(q.text || '')}</div></div>`
      : '';
  }
  return html;
}

function eventItemHtml(ev) {
  const muted = MUTED_TYPES.has(ev.event_type);
  const link = ev.tweet_id
    ? `https://x.com/${ev.tw_account}/status/${ev.tweet_id}`
    : `https://x.com/${ev.tw_account}`;
  const c = ev.content;
  const avatarUrl = c && typeof c === 'object' && !Array.isArray(c) ? c.userAvatar : null;
  const initial = esc(ev.tw_account.slice(0, 1).toUpperCase());
  const hue = [...ev.tw_account].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360; // handle 决定头像色
  const avatar = avatarUrl
    ? `<img class="avatar" src="${esc(avatarUrl)}" loading="lazy" alt=""` +
      ` onerror="(()=>{const s=document.createElement('span');s.className='avatar fb';s.style.setProperty('--h','${hue}');s.textContent='${initial}';this.replaceWith(s)})()">`
    : `<span class="avatar fb" style="--h:${hue}">${initial}</span>`;
  const content = esc(eventContentText(ev));
  const eng = engagementText(ev);
  const rich = eventRichHtml(ev);
  return `
    <li class="event-item ${muted ? 'muted' : ''}">
      <div class="avatar-col">${avatar}</div>
      <div class="item-body">
        <div class="row1">
          <span class="type-badge ${esc(ev.event_type)}">${TYPE_ZH[ev.event_type] || ev.event_type}</span>
          <a class="acct" href="${link}" target="_blank" rel="noopener">@${esc(ev.tw_account)}</a>
          ${ev.tw_user_name ? `<span class="disp-name">${esc(ev.tw_user_name)}</span>` : ''}
          ${ev.is_core ? '<span class="core-mark" title="核心账号">核</span>' : ''}
          <span class="engagement">${eng}</span>
        </div>
        ${content ? `<div class="row2">${content}</div>` : ''}
        ${rich}
        <div class="ts">${fmtTime(ev.created_at)}</div>
      </div>
    </li>`;
}

function prependEvents(events) {
  const stream = $('event-stream');
  if (stream.querySelector('.empty')) stream.innerHTML = '';
  const frag = document.createDocumentFragment();
  const tmp = document.createElement('div');
  // events 已是 id 倒序；去重
  const existingIds = new Set([...stream.querySelectorAll('.event-item')].map(li => li.dataset.id));
  for (const ev of events) {
    if (existingIds.has(String(ev.id))) continue;
    tmp.innerHTML = eventItemHtml(ev);
    const li = tmp.firstElementChild;
    li.dataset.id = ev.id;
    frag.appendChild(li);
  }
  stream.prepend(frag);
  // 最多保留 300 条 DOM
  while (stream.children.length > 300) stream.lastElementChild.remove();
}

let newestEventId = null;
async function refreshEvents() {
  try {
    const data = await fetch('/api/news/events?limit=50').then(r => r.json());
    if (data.events?.length) {
      prependEvents(data.events);
      if (!newestEventId || data.events[0].id > newestEventId) {
        newestEventId = data.events[0].id;
      }
    } else if (!newestEventId) {
      $('event-stream').innerHTML = '<li class="empty" style="cursor:default">暂无事件（等待监控数据…）</li>';
    }
  } catch { /* 下轮重试 */ }
}

async function loadMoreEvents() {
  const stream = $('event-stream');
  const last = stream.lastElementChild;
  if (!last || !last.dataset.id) return;
  const data = await fetch(`/api/news/events?before_id=${last.dataset.id}&limit=50`).then(r => r.json());
  if (data.events?.length) {
    const tmp = document.createElement('div');
    for (const ev of data.events) {
      tmp.innerHTML = eventItemHtml(ev);
      const li = tmp.firstElementChild;
      li.dataset.id = ev.id;
      stream.appendChild(li);
    }
  } else {
    $('load-more-events').textContent = '没有更多了';
    $('load-more-events').disabled = true;
  }
}

// ---------- 时钟 ----------
function tickClock() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  $('clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------- 启动 ----------
async function init() {
  tickClock();
  setInterval(tickClock, 1000);
  await Promise.all([refreshStatus(), refreshLatestReport(), refreshEvents()]);
  await loadReportList();

  setInterval(() => { if (!document.hidden) refreshStatus(); }, 30_000);
  setInterval(() => { if (!document.hidden) refreshLatestReport(); }, 60_000);
  setInterval(() => { if (!document.hidden) refreshEvents(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshEvents(); });

  $('load-more-events').onclick = loadMoreEvents;
}
init();
