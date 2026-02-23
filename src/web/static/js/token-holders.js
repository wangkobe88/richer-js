/**
 * 代币持有者信息页面
 */

class TokenHoldersManager {
  constructor() {
    this.currentToken = null;
    this.init();
  }

  async init() {
    // 检查 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    this.experimentId = urlParams.get('experiment');
    const tokenParam = urlParams.get('token');

    this.bindEvents();

    // 如果有实验ID，显示实验信息并加载代币列表
    if (this.experimentId) {
      await this.showExperimentInfo();
      await this.loadTokenList(this.experimentId, tokenParam);
    } else {
      await this.loadTokenList(null, tokenParam);
    }

    // 如果有代币地址参数，自动搜索
    if (tokenParam) {
      // 设置搜索框的值
      document.getElementById('token-search').value = tokenParam;
      // 执行搜索
      await this.search();
    }
  }

  async showExperimentInfo() {
    try {
      const response = await fetch(`/api/experiments`);
      const result = await response.json();

      if (result.success) {
        const experiment = result.data.find(e => e.id === this.experimentId);
        if (experiment) {
          const infoDiv = document.getElementById('experiment-info');
          const nameSpan = document.getElementById('experiment-name');
          nameSpan.textContent = `${experiment.experimentName || experiment.experiment_name} (${this.experimentId.substring(0, 8)}...)`;
          infoDiv.classList.remove('hidden');
        }
      }
    } catch (error) {
      console.error('获取实验信息失败:', error);
    }
  }

  bindEvents() {
    // 搜索按钮
    document.getElementById('search-btn')?.addEventListener('click', () => {
      this.search();
    });

    // 回车搜索
    document.getElementById('token-search')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.search();
      }
    });

    // 选择代币
    document.getElementById('token-select')?.addEventListener('change', (e) => {
      if (e.target.value) {
        document.getElementById('token-search').value = e.target.value;
        this.search();
      }
    });
  }

  async loadTokenList(experimentId = null, skipAutoSearch = false) {
    try {
      const url = experimentId
        ? `/api/token-holders?experiment=${experimentId}`
        : '/api/token-holders';

      const response = await fetch(url);
      const result = await response.json();

      if (result.success) {
        const select = document.getElementById('token-select');

        // 清空现有选项
        select.innerHTML = '<option value="">选择代币...</option>';

        result.data.forEach(token => {
          const option = document.createElement('option');
          option.value = token;
          option.textContent = `${token.substring(0, 10)}...${token.substring(token.length - 6)}`;
          select.appendChild(option);
        });

        // 只有在没有指定代币参数且来自实验时，才自动查询第一个
        if (!skipAutoSearch && result.data.length > 0 && experimentId) {
          document.getElementById('token-search').value = result.data[0];
          this.search();
        }
      }
    } catch (error) {
      console.error('加载代币列表失败:', error);
    }
  }

  async search() {
    const tokenAddress = document.getElementById('token-search').value.trim();
    if (!tokenAddress) {
      this.showError('请输入代币地址');
      return;
    }

    this.showLoading(true);
    this.hideError();
    this.hideResults();

    try {
      const response = await fetch(`/api/token-holders/${tokenAddress}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '查询失败');
      }

      this.currentToken = result.data;
      this.renderResults(result.data);
      this.showResults(true);
    } catch (error) {
      console.error('查询失败:', error);
      this.showError(error.message);
    } finally {
      this.showLoading(false);
    }
  }

  renderResults(data) {
    // 渲染代币信息
    const tokenInfo = document.getElementById('token-info');
    tokenInfo.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xl font-bold text-gray-900">代币地址</h2>
          <p class="font-mono text-sm text-gray-600 mt-1">${data.token_address}</p>
        </div>
        <button onclick="window.tokenHolders.copyAddress('${data.token_address}')"
                class="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm font-medium text-gray-700 transition-colors">
          📋 复制地址
        </button>
      </div>
    `;

    // 渲染统计信息
    const statsInfo = document.getElementById('stats-info');
    statsInfo.innerHTML = `
      <div class="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-gray-800">快照数量</h3>
          <span class="text-2xl font-bold text-blue-600">${data.stats.total_snapshots}</span>
        </div>
      </div>
      <div class="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-gray-800">持有者总数</h3>
          <span class="text-2xl font-bold text-green-600">${data.stats.total_holders}</span>
        </div>
      </div>
      <div class="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-gray-800">黑名单持有者</h3>
          <span class="text-2xl font-bold text-red-600">${data.stats.blacklisted_holders}</span>
        </div>
      </div>
    `;

    // 渲染快照列表
    const snapshotsContainer = document.getElementById('snapshots-container');
    if (data.snapshots.length === 0) {
      snapshotsContainer.innerHTML = `
        <div class="text-center py-8 bg-gray-50 rounded-lg">
          <p class="text-gray-600">暂无持有者数据</p>
        </div>
      `;
      return;
    }

    snapshotsContainer.innerHTML = data.snapshots.map((snapshot, index) => {
      const badgeClass = snapshot.blacklisted_count > 0 ? 'bg-red-100' : 'bg-green-100';
      const badgeText = snapshot.blacklisted_count > 0
        ? `⚠️ ${snapshot.blacklisted_count} 个黑名单`
        : '✅ 无黑名单';

      // 将持有者数据存储为JSON，供按钮使用
      const holdersJson = encodeURIComponent(JSON.stringify(snapshot.holders));

      return `
        <div class="bg-white rounded-lg shadow-sm border border-gray-200 mb-4 overflow-hidden">
          <div class="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-semibold text-gray-900">📸 快照 #${index + 1}</h3>
                <p class="text-sm text-gray-600 mt-1">
                  时间: ${new Date(snapshot.checked_at).toLocaleString('zh-CN')}
                </p>
              </div>
              <div class="text-right">
                <p class="text-sm text-gray-600">
                  实验: <span class="font-mono">${snapshot.experiment_name}</span>
                </p>
                <p class="text-sm text-gray-600 mt-1">
                  持有者: ${snapshot.holders_count} 个
                </p>
                <p class="text-xs text-gray-500 mt-1">
                  快照ID: <span class="font-mono">${snapshot.snapshot_id || 'N/A'}</span>
                </p>
                <span class="inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium ${badgeClass}">
                  ${badgeText}
                </span>
                <button onclick="window.tokenHolders.addPumpGroupWallets('${holdersJson}', '${snapshot.checked_at}')"
                        class="ml-2 px-3 py-1 bg-orange-500 hover:bg-orange-600 rounded text-xs font-medium text-white transition-colors">
                  ⚠️ 添加流水盘钱包
                </button>
              </div>
            </div>
          </div>

          <div class="p-4">
            ${snapshot.holders.length > 0 ? this.renderHoldersTable(snapshot.holders) : '<p class="text-gray-600">无持有者数据</p>'}
          </div>
        </div>
      `;
    }).join('');
  }

  renderHoldersTable(holders) {
    return `
      <div class="overflow-x-auto">
        <table class="min-w-full">
          <thead>
            <tr class="bg-gray-50">
              <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">地址</th>
              <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">持仓比例</th>
              <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">持仓价值</th>
              <th class="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">标签</th>
              <th class="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody class="bg-white">
            ${holders.map(holder => this.renderHolderRow(holder)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderHolderRow(holder) {
    const categoryBadges = {
      'dev': 'badge-dev',
      'pump_group': 'badge-pump_group',
      'negative_holder': 'badge-negative_holder',
      'hot': 'badge-hot',
      'long': 'badge-long',
      'test': 'badge-test'
    };

    const categoryNames = {
      'dev': '🚫 Dev',
      'pump_group': '⚠️ 流水盘',
      'negative_holder': '🚫 负面',
      'hot': '🔥 热门',
      'long': '📈 长期',
      'test': '🧪 测试'
    };

    const badgeClass = categoryBadges[holder.category] || 'badge-none';
    const categoryLabel = holder.category ? (categoryNames[holder.category] || holder.category) : '';

    // 判断钱包是否已在黑名单中
    const isInBlacklist = holder.category === 'pump_group' || holder.category === 'dev' || holder.category === 'negative_holder';

    return `
      <tr class="border-b">
        <td class="px-4 py-2 text-sm">
          <span class="font-mono text-gray-900">${holder.address}</span>
          ${holder.wallet_name ? `<span class="ml-2 text-xs text-gray-500">(${holder.wallet_name})</span>` : ''}
          <a href="https://gmgn.ai/bsc/address/${holder.address}" target="_blank" class="ml-2 text-xs text-blue-500 hover:text-blue-700" title="在 GMGN 查看">
            GMGN
          </a>
        </td>
        <td class="px-4 py-2 text-right text-sm text-gray-900">${holder.balance_ratio || '-'}</td>
        <td class="px-4 py-2 text-right text-sm text-gray-900">${holder.balance_usd || '-'}</td>
        <td class="px-4 py-2 text-center text-sm">
          ${categoryLabel ? `<span class="badge ${badgeClass}">${categoryLabel}</span>` : '<span class="text-gray-400 text-xs">无</span>'}
        </td>
        <td class="px-4 py-2 text-center text-sm">
          <button type="button" class="text-blue-600 hover:text-blue-800 mr-2"
                  onclick="window.tokenHolders.copyAddress('${holder.address}')">
            📋 复制
          </button>
          ${isInBlacklist
            ? `<button type="button" class="text-red-600 hover:text-red-800"
                  onclick="window.tokenHolders.deleteWallet('${holder.address}')">
                 🗑️ 删除
               </button>`
            : `<button type="button" class="text-orange-600 hover:text-orange-800"
                  onclick="window.tokenHolders.addSinglePumpGroupWallet('${holder.address}')">
                 ⚠️ 加入流水盘
               </button>`
          }
        </td>
      </tr>
    `;
  }

  copyAddress(address) {
    navigator.clipboard.writeText(address).then(() => {
      // 简单提示
      const btn = event.target;
      const originalText = btn.textContent;
      btn.textContent = '✅ 已复制';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 1500);
    });
  }

  /**
   * 添加流水盘钱包到黑名单
   * @param {string} holdersJson - 持有者数据的JSON字符串（已编码）
   * @param {string} snapshotDate - 快照时间
   */
  async addPumpGroupWallets(holdersJson, snapshotDate) {
    try {
      const holders = JSON.parse(decodeURIComponent(holdersJson));

      // 确认对话框
      const confirmed = confirm(
        `⚠️ 确定要添加流水盘钱包吗？\n\n` +
        `将把持仓比例 > 1% 的钱包（排除 fourmeme LP）添加到黑名单。\n` +
        `钱包名称: 流水盘钱包群-${new Date(snapshotDate).toISOString().split('T')[0].replace(/-/g, '')}\n` +
        `分类: pump_group`
      );

      if (!confirmed) return;

      // 调用API
      const response = await fetch('/api/token-holders/add-pump-group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          holders: holders,
          snapshotDate: snapshotDate
        })
      });

      const result = await response.json();

      if (result.success) {
        alert(`✅ ${result.message}\n\n钱包名称: ${result.data.walletName}`);
        // 重新加载数据
        this.search();
      } else {
        alert(`❌ 添加失败: ${result.error}`);
      }
    } catch (error) {
      console.error('添加流水盘钱包失败:', error);
      alert(`❌ 添加失败: ${error.message}`);
    }
  }

  /**
   * 添加单个钱包到流水盘黑名单
   * @param {string} address - 钱包地址
   */
  async addSinglePumpGroupWallet(address) {
    try {
      // 确认对话框
      const confirmed = confirm(
        `⚠️ 确定要将此钱包添加到流水盘黑名单吗？\n\n` +
        `地址: ${address}\n` +
        `分类: pump_group`
      );

      if (!confirmed) return;

      // 调用API
      const response = await fetch('/api/wallets/add-single', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: address,
          name: '流水盘钱包',
          category: 'pump_group'
        })
      });

      const result = await response.json();

      if (result.success) {
        if (result.alreadyExists) {
          alert(`ℹ️ ${result.message}`);
        } else {
          alert(`✅ ${result.message}`);
        }
        // 重新加载数据
        this.search();
      } else {
        alert(`❌ 添加失败: ${result.error}`);
      }
    } catch (error) {
      console.error('添加单个钱包失败:', error);
      alert(`❌ 添加失败: ${error.message}`);
    }
  }

  /**
   * 删除钱包
   * @param {string} address - 钱包地址
   */
  async deleteWallet(address) {
    try {
      // 确认对话框
      const confirmed = confirm(
        `🗑️ 确定要将此钱包从黑名单中删除吗？\n\n` +
        `地址: ${address}\n\n` +
        `注意：删除后该钱包将不再被识别为黑名单钱包。`
      );

      if (!confirmed) return;

      // 调用API
      const response = await fetch(`/api/wallets/address/${address}`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (result.success) {
        alert(`✅ ${result.message}`);
        // 重新加载数据
        this.search();
      } else {
        alert(`❌ 删除失败: ${result.error}`);
      }
    } catch (error) {
      console.error('删除钱包失败:', error);
      alert(`❌ 删除失败: ${error.message}`);
    }
  }

  showLoading(show) {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.toggle('hidden', !show);
    }
  }

  hideError() {
    const errorEl = document.getElementById('error-message');
    if (errorEl) {
      errorEl.classList.add('hidden');
    }
  }

  showError(message) {
    const errorEl = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    if (errorText) {
      errorText.textContent = message;
    }
    if (errorEl) {
      errorEl.classList.remove('hidden');
    }
  }

  showResults(show) {
    const results = document.getElementById('results-content');
    const emptyState = document.getElementById('empty-state');

    if (results) {
      results.classList.toggle('hidden', !show);
    }
    if (emptyState) {
      emptyState.classList.toggle('hidden', show);
    }
  }

  hideResults() {
    this.showResults(false);
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  window.tokenHolders = new TokenHoldersManager();
});
