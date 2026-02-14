/**
 * 钱包管理页面
 */
class WalletManager {
  constructor() {
    this.wallets = [];
    this.init();
  }

  async init() {
    // 绑定事件
    this.bindEvents();

    // 加载数据
    await this.loadData();
  }

  bindEvents() {
    // 刷新按钮
    document.getElementById('refresh-btn')?.addEventListener('click', () => {
      this.loadData();
    });

    // 添加钱包按钮
    document.getElementById('add-wallet-btn')?.addEventListener('click', () => {
      this.showAddModal();
    });

    // 重试按钮
    document.getElementById('retry-btn')?.addEventListener('click', () => {
      this.loadData();
    });
  }

  async loadData() {
    this.showLoading(true);
    this.hideError();

    try {
      const response = await fetch('/api/wallets');
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '加载失败');
      }

      this.wallets = result.data || [];
      this.renderTable();
      this.showContent(true);

      // 更新统计
      this.updateStats();
    } catch (error) {
      console.error('加载数据失败:', error);
      this.showError(error.message);
    } finally {
      this.showLoading(false);
    }
  }

  renderTable() {
    const tbody = document.getElementById('wallets-table-body');
    const emptyState = document.getElementById('empty-state');

    if (!tbody) return;

    if (this.wallets.length === 0) {
      tbody.innerHTML = '';
      emptyState?.classList.remove('hidden');
      return;
    }

    emptyState?.classList.add('hidden');
    tbody.innerHTML = this.wallets.map(wallet => {
      return `
        <tr class="table-row">
          <td class="px-4 py-3 font-mono text-sm">
            <span class="text-white">${wallet.address}</span>
          </td>
          <td class="px-4 py-3">
            <input type="text"
                   value="${wallet.name || ''}"
                   onchange="window.walletManager.updateWallet('${wallet.id}', 'name', this.value)"
                   class="w-full px-3 py-2 bg-transparent border-none text-white text-sm focus:ring-2 focus:ring-blue-500">
          </td>
          <td class="px-4 py-3">
            <select onchange="window.walletManager.updateWallet('${wallet.id}', 'category', this.value)"
                    class="w-full px-3 py-2 bg-transparent border-none text-white text-sm focus:ring-2 focus:ring-blue-500">
              <option value="">无分类</option>
              <option value="hot" ${wallet.category === 'hot' ? 'selected' : ''}>热门代币</option>
              <option value="long" ${wallet.category === 'long' ? 'selected' : ''}>长期持有</option>
              <option value="test" ${wallet.category === 'test' ? 'selected' : ''}>测试钱包</option>
              <option value="dev" ${wallet.category === 'dev' ? 'selected' : ''}>流水盘Dev</option>
            </select>
          </td>
          <td class="px-4 py-3 text-center">
            <button type="button" class="text-blue-400 hover:text-blue-300 text-sm mr-2"
                    onclick="window.walletManager.copyAddress('${wallet.address}')">
              📋 复制
            </button>
            <button type="button" class="text-red-400 hover:text-red-300 text-sm"
                    onclick="window.walletManager.deleteWallet('${wallet.id}')">
              🗑️ 删除
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  updateStats() {
    // 更新统计
    const totalCount = document.getElementById('total-wallets');
    const hotCount = document.getElementById('hot-count');
    const longCount = document.getElementById('long-count');
    const testCount = document.getElementById('test-count');
    const devCount = document.getElementById('dev-count');

    if (totalCount) totalCount.textContent = this.wallets.length;
    if (hotCount) hotCount.textContent = this.wallets.filter(w => w.category === 'hot').length;
    if (longCount) longCount.textContent = this.wallets.filter(w => w.category === 'long').length;
    if (testCount) testCount.textContent = this.wallets.filter(w => w.category === 'test').length;
    if (devCount) devCount.textContent = this.wallets.filter(w => w.category === 'dev').length;
  }

  async addWallet(address, name, category) {
    try {
      const response = await fetch('/api/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, name, category })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '添加失败');
      }

      this.wallets.push(result.data);
      this.renderTable();
      this.updateStats();
      this.closeModal();
    } catch (error) {
      console.error('添加钱包失败:', error);
      alert('添加失败：' + error.message);
    }
  }

  async updateWallet(id, field, value) {
    try {
      const response = await fetch(`/api/wallets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '更新失败');
      }

      // 更新本地数据
      const index = this.wallets.findIndex(w => w.id === id);
      if (index !== -1) {
        this.wallets[index][field] = value;
        this.renderTable();
        this.updateStats();
      }
    } catch (error) {
      console.error('更新钱包失败:', error);
      alert('更新失败：' + error.message);
    }
  }

  async deleteWallet(id) {
    if (!confirm('确定要删除这个钱包吗？')) {
      return;
    }

    try {
      const response = await fetch(`/api/wallets/${id}`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '删除失败');
      }

      // 从本地数据中移除
      this.wallets = this.wallets.filter(w => w.id !== id);
      this.renderTable();
      this.updateStats();
    } catch (error) {
      console.error('删除钱包失败:', error);
      alert('删除失败：' + error.message);
    }
  }

  copyAddress(address) {
    navigator.clipboard.writeText(address);
    alert('地址已复制到剪贴板：' + address);
  }

  showAddModal() {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-50';
    modal.innerHTML = `
      <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h2 class="text-xl font-bold mb-4">添加新钱包</h2>
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-2">钱包地址</label>
          <input type="text" id="wallet-address-modal"
                 placeholder="0x..."
                 class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-2">名称（可选）</label>
          <input type="text" id="wallet-name-modal"
                 placeholder="我的钱包"
                 class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-2">分类（可选）</label>
          <select id="wallet-category-modal"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">无分类</option>
            <option value="hot">热门代币</option>
            <option value="long">长期持有</option>
            <option value="test">测试钱包</option>
            <option value="dev">流水盘Dev</option>
          </select>
        </div>
        <div class="flex space-x-4">
          <button type="button" onclick="window.walletManager.closeModal()"
                  class="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-md text-sm font-medium text-white">
            取消
          </button>
          <button type="button" onclick="window.walletManager.confirmAddWallet()"
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-sm font-medium text-white">
            添加
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  closeModal() {
    const modal = document.querySelector('.fixed.inset-0');
    if (modal) {
      modal.remove();
    }
  }

  async confirmAddWallet() {
    const addressInput = document.getElementById('wallet-address-modal');
    const nameInput = document.getElementById('wallet-name-modal');
    const categorySelect = document.getElementById('wallet-category-modal');

    const address = addressInput.value.trim();
    const name = nameInput.value.trim();
    const category = categorySelect.value;

    if (!address) {
      alert('请输入钱包地址');
      return;
    }

    await this.addWallet(address, name, category);
    this.closeModal();
  }

  showLoading(show) {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.toggle('hidden', !show);
    }
  }

  hideError() {
    const errorEl = document.getElementById('error-message');
    if (errorEl) errorEl.classList.add('hidden');
  }

  showError(message) {
    const errorEl = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    if (errorText) errorText.textContent = message;
    if (errorEl) errorEl.classList.remove('hidden');
  }

  showContent(show) {
    const content = document.getElementById('wallets-content');
    if (content) {
      content.classList.toggle('hidden', !show);
    }
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  window.walletManager = new WalletManager();
});
