// 监控账号列表页（原 news_monitor web/public/accounts.js 收编）：
// /api/news/accounts 拉全量 → 前端按生态分组 + 本地搜索过滤。
// 分组标签由路由从 news-watchlist.json 注入（ecosystem），与 sync 名单同源。
(() => {
  const groupsEl = document.getElementById('groups');
  const searchEl = document.getElementById('search');
  let accounts = [];

  const ECO_LABEL = {
    solana: 'Solana 生态', bsc: 'BSC 生态', eth: 'ETH 生态',
    hyperliquid: 'HyperLiquid 生态', base: 'Base 生态',
    ai: 'AI 领域', robinhood: 'Robinhood',
    intel: '链上情报', media: '加密快讯媒体', og: '加密人物与机构',
    general: '通用领域（宏观/监管/新闻）',
  };
  const GROUP_ORDER = ['solana', 'bsc', 'eth', 'hyperliquid', 'base', 'ai', 'robinhood', 'intel', 'media', 'og', 'general', null];

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function render() {
    const kw = searchEl.value.trim().toLowerCase();
    const filtered = kw
      ? accounts.filter(a =>
          a.handle.toLowerCase().includes(kw) || (a.display_name || '').toLowerCase().includes(kw))
      : accounts;

    const groups = new Map();
    for (const a of filtered) {
      const g = a.ecosystem ?? null;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(a);
    }

    if (!filtered.length) {
      groupsEl.innerHTML = '<div class="empty">没有匹配的账号</div>';
      return;
    }
    groupsEl.innerHTML = GROUP_ORDER.filter(g => groups.get(g)?.length)
      .map(g => {
        // 生态内置顶核心账号
        const items = groups.get(g).slice().sort((a, b) =>
          (a.tier === 'core' ? 0 : 1) - (b.tier === 'core' ? 0 : 1));
        const label = g ? ECO_LABEL[g] || g : '其他（不在当前名单）';
        return `
        <div class="card">
          <div class="card-head"><h2>${esc(label)}</h2><span class="meta">${items.length} 个</span></div>
          <ul class="acct-grid">
            ${items.map(a => `
              <li class="acct-cell${a.tier === 'core' ? ' core' : ''}">
                <a class="acct" href="https://x.com/${encodeURIComponent(a.handle)}" target="_blank" rel="noopener">@${esc(a.handle_raw || a.handle)}</a>
                ${a.tier === 'core' ? '<span class="core-mark">核</span>' : ''}
                ${a.display_name && a.display_name !== a.handle ? `<div class="acct-name">${esc(a.display_name)}</div>` : ''}
                ${a.in_watch_list === false ? '<span class="badge off-list">未在服务端</span>' : ''}
              </li>`).join('')}
          </ul>
        </div>`;
      }).join('');
  }

  async function load() {
    try {
      const res = await fetch('/api/news/accounts');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { accounts: rows } = await res.json();
      accounts = rows.slice().sort((a, b) => a.handle.localeCompare(b.handle));
      render();
      const core = accounts.filter(a => a.tier === 'core').length;
      document.getElementById('total-count').textContent = accounts.length;
      document.getElementById('core-count').textContent = core;
      const synced = accounts.map(a => a.sheet_synced_at).filter(Boolean).sort().pop();
      if (synced) {
        document.getElementById('synced-at').textContent =
          `上次同步 ${new Date(new Date(synced).getTime() + 8 * 3600_000)
            .toISOString().slice(0, 16).replace('T', ' ')}（北京时间）`;
      }
    } catch (err) {
      groupsEl.innerHTML = `<div class="empty">加载失败：${esc(err.message)}</div>`;
    }
  }

  searchEl.addEventListener('input', render);

  function tick() {
    const d = new Date(Date.now() + 8 * 3600_000);
    document.getElementById('clock').textContent = d.toISOString().slice(11, 19);
  }
  setInterval(tick, 1000); tick();

  load();
  // 列表低频刷新（sync 每小时 :00 跑，5 分钟足够跟得上）
  setInterval(load, 5 * 60_000);
})();
