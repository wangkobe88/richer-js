/**
 * PVP Tokens 页面 JavaScript
 */

class PVPTokensViewer {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 50;
        this.totalCount = 0;
        this.currentFilters = {};
        this.currentSort = 'created_at';
        this.currentMarketCapData = {}; // 缓存当前市值数据
        this.currentTokens = []; // 当前页面的代币数据
        this.currentMarketCapMin = 0; // 当前市值过滤条件

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadStats();
        this.loadTokens(); // 会自动触发 loadCurrentMarketCaps
    }

    setupEventListeners() {
        // 搜索输入框回车事件
        document.getElementById('searchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.applyFilters();
            }
        });
    }

    async loadStats() {
        try {
            const response = await fetch('/api/pvp/tokens/stats');
            const data = await response.json();

            if (data.success) {
                document.getElementById('statTotal').textContent = data.stats.total.toLocaleString();
                document.getElementById('statImportant').textContent = data.stats.importantCount.toLocaleString();
                document.getElementById('statFirst').textContent = data.stats.firstAppearanceCount.toLocaleString();
                document.getElementById('statName').textContent = data.stats.nameMentionedCount.toLocaleString();
            }
        } catch (error) {
            console.error('加载统计信息失败:', error);
        }
    }

    async loadTokens() {
        const tbody = document.getElementById('tokensTableBody');
        tbody.innerHTML = '<tr><td colspan="12" class="loading-state">正在加载数据...</td></tr>';

        try {
            const params = new URLSearchParams({
                page: this.currentPage,
                limit: this.pageSize,
                sortBy: this.currentSort,
                ...this.currentFilters
            });

            const response = await fetch(`/api/pvp/tokens?${params}`);
            const data = await response.json();

            if (data.success) {
                this.totalCount = data.total;
                this.currentTokens = data.tokens; // 保存当前页面的代币数据
                this.renderTokens(data.tokens);
                this.updatePagination();
                // 渲染完成后加载当前市值
                this.loadCurrentMarketCaps();
            } else {
                tbody.innerHTML = `<tr><td colspan="12" class="error-state">加载失败: ${data.error}</td></tr>`;
            }
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="12" class="error-state">加载失败: ${error.message}</td></tr>`;
        }
    }

    async loadCurrentMarketCaps() {
        try {
            // 如果没有当前页面数据，跳过
            if (!this.currentTokens || this.currentTokens.length === 0) {
                return;
            }

            // 提取当前页面的代币地址
            const addresses = this.currentTokens
                .map(t => t.token_address)
                .filter(a => a)
                .join(',');

            if (!addresses) {
                return;
            }

            const response = await fetch(`/api/pvp/tokens/market-caps?addresses=${encodeURIComponent(addresses)}`);
            const data = await response.json();

            if (data.success) {
                this.currentMarketCapData = data.marketCaps || {};
                // 更新表格中的当前市值显示
                this.updateCurrentMarketCapsInTable();
            }
        } catch (error) {
            console.error('加载当前市值失败:', error);
        }
    }

    updateCurrentMarketCapsInTable() {
        // 更新所有已缓存的当前市值显示
        Object.entries(this.currentMarketCapData).forEach(([tokenAddress, currentCap]) => {
            const cells = document.querySelectorAll(`[data-current-cap="${tokenAddress}"]`);
            cells.forEach(cell => {
                if (cell && currentCap) {
                    cell.innerHTML = this.formatMarketCap(currentCap);
                }
            });
        });
    }

    renderTokens(tokens) {
        const tbody = document.getElementById('tokensTableBody');

        if (tokens.length === 0) {
            tbody.innerHTML = '<tr><td colspan="12" class="empty-state">暂无数据</td></tr>';
            return;
        }

        // 根据当前市值过滤
        let filteredTokens = tokens;
        if (this.currentMarketCapMin > 0) {
            filteredTokens = tokens.filter(token => {
                const currentCap = this.currentMarketCapData[token.token_address];
                if (!currentCap) return false; // 没有市值数据的过滤掉
                const capValue = parseFloat(currentCap);
                return capValue >= this.currentMarketCapMin;
            });
        }

        if (filteredTokens.length === 0) {
            tbody.innerHTML = '<tr><td colspan="12" class="empty-state">没有符合条件的代币</td></tr>';
            return;
        }

        tbody.innerHTML = filteredTokens.map(token => {
            const collectedTime = this.formatDateTime(token.collected_at);
            const createdTime = this.formatDateTime(token.created_at);
            const matchBadge = this.getMatchBadge(token.match_type);
            const twitterIdBtn = token.twitter_id
                ? `<button class="twitter-id-btn" onclick="searchTwitterId('${token.twitter_id}'); event.stopPropagation();">${token.twitter_id}</button>`
                : '-';
            // 推特链接
            const screenName = token.twitter_screen_name
                ? (token.twitter_url
                    ? `<a href="${token.twitter_url}" target="_blank" class="twitter-link">@${this.escapeHtml(token.twitter_screen_name)}</a>`
                    : '@' + this.escapeHtml(token.twitter_screen_name))
                : '-';
            const collectedMarketCap = this.formatMarketCap(token.market_cap);

            // 当前市值 - 从缓存或显示为加载中
            const currentCap = this.currentMarketCapData[token.token_address];
            const currentMarketCapHtml = currentCap
                ? this.formatMarketCap(currentCap)
                : '<span class="text-xs text-gray-400">加载中...</span>';

            // 外部链接
            const chain = token.chain || 'bsc';
            const gmgnLink = `https://gmgn.ai/${chain.toLowerCase()}/token/${token.token_address}`;
            const twitterSearchLink = `https://x.com/search?q=${token.token_address}&src=typed_query`;
            const originalTweetLink = token.twitter_url;

            const externalLinksHtml = `
                <div class="external-links">
                    <a href="${gmgnLink}" target="_blank" class="external-link" title="GMGN">
                        <img src="/static/gmgn.png" alt="GMGN" class="w-4 h-4">
                    </a>
                    <a href="${twitterSearchLink}" target="_blank" class="external-link" title="Twitter搜索">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                        </svg>
                    </a>
                    ${originalTweetLink ? `
                    <a href="${originalTweetLink}" target="_blank" class="external-link" title="原始推文">
                        <svg viewBox="0 0 24 24" fill="#1da1f2">
                            <path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z"></path>
                        </svg>
                    </a>` : ''}
                </div>
            `;

            return `
                <tr>
                    <td>${collectedTime}</td>
                    <td><strong>${this.escapeHtml(token.symbol || '')}</strong></td>
                    <td>${this.escapeHtml(token.name || '')}</td>
                    <td><span class="token-address" title="${this.escapeHtml(token.token_address)}">${this.shortenAddress(token.token_address)}</span></td>
                    <td>${createdTime}</td>
                    <td>${twitterIdBtn}</td>
                    <td>${screenName}</td>
                    <td>${matchBadge}</td>
                    <td>${collectedMarketCap}</td>
                    <td data-current-cap="${token.token_address}">${currentMarketCapHtml}</td>
                    <td>${externalLinksHtml}</td>
                    <td>
                        <button class="action-btn btn-view" onclick="showDetail('${token.token_address}')">详情</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    getMatchBadge(matchType) {
        switch (matchType) {
            case 'first_appearance':
                return '<span class="match-badge match-first">首次</span>';
            case 'name_mentioned':
                return '<span class="match-badge match-name">名字</span>';
            default:
                return '-';
        }
    }

    formatDateTime(dateStr) {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    formatMarketCap(value) {
        if (!value || value === 0) return '-';
        const num = parseFloat(value);
        if (num < 1000) return `$${num.toFixed(2)}`;
        if (num < 1000000) return `$${(num / 1000).toFixed(1)}K`;
        if (num < 1000000000) return `$${(num / 1000000).toFixed(1)}M`;
        return `$${(num / 1000000000).toFixed(1)}B`;
    }

    shortenAddress(address) {
        if (!address) return '-';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updatePagination() {
        const totalPages = Math.ceil(this.totalCount / this.pageSize);

        document.getElementById('currentPage').textContent = this.currentPage;
        document.getElementById('totalPages').textContent = totalPages;
        document.getElementById('totalCount').textContent = this.totalCount.toLocaleString();

        document.getElementById('prevBtn').disabled = this.currentPage <= 1;
        document.getElementById('nextBtn').disabled = this.currentPage >= totalPages;
    }

    applyFilters() {
        const search = document.getElementById('searchInput').value.trim();
        const importantFilter = document.getElementById('importantFilter').value;
        const matchTypeFilter = document.getElementById('matchTypeFilter').value;
        const sortBy = document.getElementById('sortBy').value;

        this.currentFilters = {};
        if (search) this.currentFilters.search = search;
        if (importantFilter) this.currentFilters.importantOnly = importantFilter;
        if (matchTypeFilter) this.currentFilters.matchType = matchTypeFilter;

        this.currentSort = sortBy;
        this.currentPage = 1;

        this.loadTokens();
    }

    clearFilters() {
        document.getElementById('searchInput').value = '';
        document.getElementById('importantFilter').value = '';
        document.getElementById('matchTypeFilter').value = '';
        document.getElementById('sortBy').value = 'created_at';

        this.currentFilters = {};
        this.currentSort = 'created_at';
        this.currentPage = 1;
        this.currentMarketCapMin = 0; // 重置市值过滤

        // 重置市值过滤按钮状态
        document.querySelectorAll('.cap-filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector('.cap-filter-btn[data-min="0"]').classList.add('active');

        this.loadTokens();
    }

    changePage(delta) {
        const totalPages = Math.ceil(this.totalCount / this.pageSize);
        const newPage = this.currentPage + delta;

        if (newPage >= 1 && newPage <= totalPages) {
            this.currentPage = newPage;
            this.loadTokens();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }
}

// 全局实例
let pvpViewer;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    pvpViewer = new PVPTokensViewer();
});

// 全局函数（供 HTML 调用）
function applyFilters() {
    pvpViewer.applyFilters();
}

function clearFilters() {
    pvpViewer.clearFilters();
}

function changePage(delta) {
    pvpViewer.changePage(delta);
}

// 搜索 Twitter ID（复制到搜索框并触发搜索）
function searchTwitterId(twitterId) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = twitterId;
        applyFilters();
    }
}

// 设置当前市值过滤
function setMarketCapFilter(minValue) {
    // 更新按钮状态
    document.querySelectorAll('.cap-filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`.cap-filter-btn[data-min="${minValue}"]`).classList.add('active');

    // 更新过滤条件并重新渲染
    pvpViewer.currentMarketCapMin = minValue;
    pvpViewer.renderTokens(pvpViewer.currentTokens);
}

async function showDetail(tokenAddress) {
    try {
        const response = await fetch(`/api/pvp/tokens/${tokenAddress}`);
        const data = await response.json();

        if (data.success) {
            renderDetailModal(data.token);
            document.getElementById('detailModal').style.display = 'block';
        } else {
            alert('加载详情失败: ' + data.error);
        }
    } catch (error) {
        alert('加载详情失败: ' + error.message);
    }
}

function renderDetailModal(token) {
    const modalBody = document.getElementById('modalBody');

    const importantBadge = token.is_important_account
        ? '<span class="important-badge">✓ 是</span>'
        : '否';
    const matchBadge = token.match_type
        ? (token.match_type === 'first_appearance'
            ? '<span class="match-badge match-first">首次出现</span>'
            : '<span class="match-badge match-name">名字包含</span>')
        : '-';

    modalBody.innerHTML = `
        <div class="detail-section">
            <h4>基础信息</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">符号</span>
                    <span class="detail-value">${token.symbol || '-'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">名称</span>
                    <span class="detail-value">${token.name || '-'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">代币地址</span>
                    <span class="detail-value token-address">${token.token_address || '-'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">区块链</span>
                    <span class="detail-value">${token.chain || '-'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">收集市值</span>
                    <span class="detail-value">${pvpViewer.formatMarketCap(token.market_cap)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">创建时间</span>
                    <span class="detail-value">${token.created_at ? new Date(token.created_at).toLocaleString('zh-CN') : '-'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">收集时间</span>
                    <span class="detail-value">${token.collected_at ? new Date(token.collected_at).toLocaleString('zh-CN') : '-'}</span>
                </div>
            </div>
        </div>

        <div class="detail-section">
            <h4>Twitter 信息</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">发布者</span>
                    <span class="detail-value">${token.twitter_screen_name ? '@' + token.twitter_screen_name : '-'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Twitter ID</span>
                    <span class="detail-value">${token.twitter_id || '-'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">推文链接</span>
                    <span class="detail-value">
                        ${token.twitter_url ? `<a href="${token.twitter_url}" target="_blank" class="twitter-link">查看推文</a>` : '-'}
                    </span>
                </div>
            </div>
        </div>

        <div class="detail-section">
            <h4>匹配信息</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">重要账号</span>
                    <span class="detail-value">${importantBadge}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">匹配类型</span>
                    <span class="detail-value">${matchBadge}</span>
                </div>
            </div>
            ${token.match_reason ? `
                <div class="match-reason">
                    <strong>匹配原因:</strong> ${token.match_reason}
                </div>
            ` : ''}
        </div>

        ${token.twitter_content ? `
            <div class="detail-section">
                <h4>推文内容</h4>
                <div style="background: #f3f4f6; padding: 12px; border-radius: 6px; white-space: pre-wrap;">${token.twitter_content}</div>
            </div>
        ` : ''}
    `;
}

function closeModal() {
    document.getElementById('detailModal').style.display = 'none';
}

// 点击弹窗外部关闭
window.addEventListener('click', (e) => {
    const modal = document.getElementById('detailModal');
    if (e.target === modal) {
        closeModal();
    }
});

// ESC 键关闭弹窗
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
    }
});
