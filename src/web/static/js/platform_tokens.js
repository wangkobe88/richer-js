/**
 * 平台标签代币页面 JavaScript
 */

let currentData = null;

/**
 * 快速选择平台标签
 */
function quickSelect(tag) {
    const tagSelect = document.getElementById('tag-select');
    const chainSelect = document.getElementById('chain-select');

    // 设置标签
    tagSelect.value = tag;

    // 根据标签设置推荐的链
    if (tag.includes('pump') || tag.includes('bonk') || tag.includes('flap') ||
        tag.includes('grafun') || tag.includes('fourmeme')) {
        chainSelect.value = 'solana';
    } else if (tag.includes('sunpump')) {
        chainSelect.value = 'bsc';
    }

    // 自动触发查询
    queryTokens();
}

/**
 * 查询代币
 */
async function queryTokens() {
    const tag = document.getElementById('tag-select').value;
    const chain = document.getElementById('chain-select').value;
    const limit = parseInt(document.getElementById('limit-input').value) || 50;
    const orderby = document.getElementById('orderby-select').value;

    if (!tag) {
        alert('请选择平台标签');
        return;
    }

    console.log('查询参数:', { tag, chain, limit, orderby });

    // 显示加载状态
    showLoading(true);

    try {
        const response = await fetch(`/api/platform/tokens?tag=${encodeURIComponent(tag)}&chain=${chain}&limit=${limit}&orderby=${orderby}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || '查询失败');
        }

        currentData = result.tokens || [];
        const requestParams = result.requestParams || {};

        console.log('AVE返回数据:', { count: currentData.length, requestParams });

        // 显示结果（不进行客户端过滤）
        displayTableResult(currentData, requestParams);
        displayRawResult(currentData);

        // 隐藏加载状态
        showLoading(false);

    } catch (error) {
        console.error('查询失败:', error);
        alert(`查询失败: ${error.message}`);
        showLoading(false);
    }
}

/**
 * 显示加载状态
 */
function showLoading(show) {
    const tableLoading = document.getElementById('table-loading');
    const rawLoading = document.getElementById('raw-loading');
    const tableEmpty = document.getElementById('table-empty');
    const rawEmpty = document.getElementById('raw-empty');

    if (show) {
        tableLoading.classList.remove('hidden');
        rawLoading.classList.remove('hidden');
        tableEmpty.classList.add('hidden');
        rawEmpty.classList.add('hidden');
    } else {
        tableLoading.classList.add('hidden');
        rawLoading.classList.add('hidden');
    }
}

/**
 * 显示表格结果
 */
function displayTableResult(tokens, requestParams = {}) {
    const tableContent = document.getElementById('table-content');
    const tableEmpty = document.getElementById('table-empty');
    const tbody = document.getElementById('tokens-tbody');
    const resultInfo = document.getElementById('result-info');

    if (!tokens || tokens.length === 0) {
        tableContent.classList.add('hidden');
        tableEmpty.classList.remove('hidden');
        tableEmpty.innerHTML = `<p>未找到匹配的代币 (请求链: ${requestParams.chain || 'N/A'})</p>`;
        return;
    }

    // 统计实际返回的链分布
    const chainCount = {};
    tokens.forEach(t => {
        const c = t.chain || 'unknown';
        chainCount[c] = (chainCount[c] || 0) + 1;
    });

    console.log('链分布:', chainCount);

    // 生成表格行
    tbody.innerHTML = tokens.map(token => {
        const logo = token.logo_url
            ? `<img src="${token.logo_url}" alt="${token.symbol}" style="width: 24px; height: 24px; border-radius: 50%;" onerror="this.style.display='none'">`
            : '<div style="width: 24px; height: 24px; background: #e5e7eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px;">?</div>';

        const price = parseFloat(token.current_price_usd || 0);
        const change24h = parseFloat(token.price_change_24h || 0);
        const marketCap = parseFloat(token.market_cap || 0);
        const tvl = parseFloat(token.tvl || 0);

        return `
            <tr>
                <td>${logo}</td>
                <td><strong>${escapeHtml(token.symbol || 'N/A')}</strong></td>
                <td>${escapeHtml(token.name || 'N/A')}</td>
                <td><span class="chain-tag chain-${token.chain || 'bsc'}">${(token.chain || 'bsc').toUpperCase()}</span></td>
                <td>${formatPrice(price)}</td>
                <td style="color: ${change24h >= 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">
                    ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%
                </td>
                <td>${formatLargeNumber(marketCap)}</td>
                <td>${formatLargeNumber(tvl)}</td>
                <td>${(token.holders || 0).toLocaleString()}</td>
                <td>${escapeHtml(token.issue_platform || 'N/A')}</td>
                <td>
                    <button class="action-btn" onclick="copyAddress('${token.token || token.address}')">
                        📋 复制
                    </button>
                    <a href="https://gmgn.ai/${token.chain || 'bsc'}/token/${token.token || token.address}" target="_blank" class="action-btn" style="text-decoration: none;">
                        GMGN
                    </a>
                </td>
            </tr>
        `;
    }).join('');

    // 显示结果信息（包含调试信息）
    const chainDistribution = Object.entries(chainCount)
        .map(([chain, count]) => `${chain.toUpperCase()}: ${count}`)
        .join(', ');

    resultInfo.innerHTML = `
        <div class="text-sm">
            <span class="text-gray-400">请求链:</span> <span class="text-white font-medium">${(requestParams.chain || 'N/A').toUpperCase()}</span>
            <span class="mx-3 text-gray-600">|</span>
            <span class="text-gray-400">实际返回:</span> <span class="text-white">${chainDistribution}</span>
            <span class="mx-3 text-gray-600">|</span>
            <span class="text-gray-400">总计:</span> <span class="text-white font-medium">${tokens.length} 个代币</span>
        </div>
    `;

    // 显示表格内容
    tableContent.classList.remove('hidden');
    tableEmpty.classList.add('hidden');
}

/**
 * 显示裸数据结果
 */
function displayRawResult(tokens) {
    const rawContent = document.getElementById('raw-content');
    const rawEmpty = document.getElementById('raw-empty');
    const rawData = document.getElementById('raw-data');

    if (!tokens || tokens.length === 0) {
        rawContent.classList.add('hidden');
        rawEmpty.classList.remove('hidden');
        return;
    }

    rawData.textContent = JSON.stringify(tokens, null, 2);
    rawContent.classList.remove('hidden');
    rawEmpty.classList.add('hidden');
}

/**
 * 切换标签页
 */
function switchTab(tab) {
    const tabTable = document.getElementById('tab-table');
    const tabRaw = document.getElementById('tab-raw');
    const contentTable = document.getElementById('content-table');
    const contentRaw = document.getElementById('content-raw');

    if (tab === 'table') {
        tabTable.classList.add('active');
        tabRaw.classList.remove('active');
        contentTable.classList.remove('hidden');
        contentRaw.classList.add('hidden');
    } else {
        tabRaw.classList.add('active');
        tabTable.classList.remove('active');
        contentRaw.classList.remove('hidden');
        contentTable.classList.add('hidden');
    }
}

/**
 * 导出数据
 */
function exportData() {
    if (!currentData || currentData.length === 0) {
        alert('没有数据可导出，请先查询代币');
        return;
    }

    const dataStr = JSON.stringify(currentData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `platform_tokens_${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 复制地址
 */
function copyAddress(address) {
    if (!address) return;

    navigator.clipboard.writeText(address).then(() => {
        showToast('合约地址已复制到剪贴板');
    }).catch(err => {
        console.error('复制失败:', err);
        showToast('复制失败', 'error');
    });
}

/**
 * 显示提示消息
 */
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = 'fixed top-4 right-4 px-4 py-2 rounded-lg shadow-lg z-50 text-sm font-medium';
    toast.textContent = message;

    if (type === 'success') {
        toast.style.background = '#10b981';
        toast.style.color = 'white';
    } else {
        toast.style.background = '#ef4444';
        toast.style.color = 'white';
    }

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => {
            if (document.body.contains(toast)) {
                document.body.removeChild(toast);
            }
        }, 300);
    }, 2000);
}

/**
 * 格式化价格
 */
function formatPrice(price) {
    if (!price || price === 0) return '-';
    if (price < 0.000001) return `$${price.toExponential(2)}`;
    if (price < 0.01) return `$${price.toFixed(8)}`;
    if (price < 1) return `$${price.toFixed(6)}`;
    return `$${price.toFixed(4)}`;
}

/**
 * 格式化大数字
 */
function formatLargeNumber(num) {
    if (!num || num === 0) return '-';
    const suffixes = ['', 'K', 'M', 'B', 'T'];
    const suffixIndex = Math.floor(Math.log10(Math.abs(num)) / 3);
    if (suffixIndex === 0) return `$${num.toFixed(2)}`;
    const scaled = num / Math.pow(1000, suffixIndex);
    return `$${scaled.toFixed(2)}${suffixes[suffixIndex]}`;
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('平台标签代币页面已加载');
});
