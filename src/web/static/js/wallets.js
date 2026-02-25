/**
 * 钱包管理页面
 */
class WalletManager {
  constructor() {
    this.wallets = [];
    this.filteredWallets = [];
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

    // 搜索框
    const searchInput = document.getElementById('wallet-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.handleSearch(e.target.value);
      });
    }

    // 表格事件委托（复制和删除按钮）
    const tbody = document.getElementById('wallets-table-body');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.copy-address-btn');
        const deleteBtn = e.target.closest('.delete-wallet-btn');

        if (copyBtn) {
          const address = copyBtn.dataset.address;
          if (address) {
            this.copyAddress(address);
          }
        }

        if (deleteBtn) {
          const id = deleteBtn.dataset.id;
          if (id) {
            this.deleteWallet(parseInt(id));
          }
        }
      });
    }
  }

  handleSearch(query) {
    const searchTerm = query.toLowerCase().trim();

    if (!searchTerm) {
      this.filteredWallets = [...this.wallets];
    } else {
      this.filteredWallets = this.wallets.filter(wallet =>
        wallet.address.toLowerCase().includes(searchTerm) ||
        (wallet.name && wallet.name.toLowerCase().includes(searchTerm))
      );
    }

    this.renderTable();
    this.updateSearchResults();
  }

  updateSearchResults() {
    const resultsEl = document.getElementById('search-results');
    if (resultsEl) {
      const total = this.wallets.length;
      const filtered = this.filteredWallets.length;
      if (filtered !== total) {
        resultsEl.textContent = `找到 ${filtered} 个钱包（共 ${total} 个）`;
      } else {
        resultsEl.textContent = '';
      }
    }
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
      this.filteredWallets = [...this.wallets];

      // 清空搜索框
      const searchInput = document.getElementById('wallet-search');
      if (searchInput) {
        searchInput.value = '';
      }

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

    if (this.filteredWallets.length === 0) {
      tbody.innerHTML = '';
      const searchInput = document.getElementById('wallet-search');
      const hasSearch = searchInput && searchInput.value.trim();
      if (hasSearch) {
        tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-8 text-center text-gray-500">未找到匹配的钱包</td></tr>';
      } else {
        emptyState?.classList.remove('hidden');
      }
      return;
    }

    emptyState?.classList.add('hidden');
    tbody.innerHTML = this.filteredWallets.map(wallet => {
      return `
        <tr class="table-row">
          <td class="px-4 py-3 font-mono text-sm text-white">
            <span>${this.escapeHtml(wallet.address)}</span>
          </td>
          <td class="px-4 py-3">
            <input type="text"
                   value="${this.escapeHtml(wallet.name || '')}"
                   data-wallet-id="${wallet.id}"
                   data-field="name"
                   class="wallet-name-input w-full px-3 py-2 bg-transparent border-none text-white text-sm focus:ring-2 focus:ring-blue-500">
          </td>
          <td class="px-4 py-3">
            <select data-wallet-id="${wallet.id}"
                    data-field="category"
                    class="wallet-category-select w-full px-3 py-2 bg-transparent border-none text-white text-sm focus:ring-2 focus:ring-blue-500">
              <option value="">无分类</option>
              <option value="hot" ${wallet.category === 'hot' ? 'selected' : ''}>热门代币</option>
              <option value="long" ${wallet.category === 'long' ? 'selected' : ''}>长期持有</option>
              <option value="test" ${wallet.category === 'test' ? 'selected' : ''}>测试钱包</option>
              <option value="dev" ${wallet.category === 'dev' ? 'selected' : ''}>流水盘Dev</option>
              <option value="pump_group" ${wallet.category === 'pump_group' ? 'selected' : ''}>流水盘钱包</option>
              <option value="negative_holder" ${wallet.category === 'negative_holder' ? 'selected' : ''}>负面持有者</option>
              <option value="good_holder" ${wallet.category === 'good_holder' ? 'selected' : ''}>白名单持有者</option>
            </select>
          </td>
          <td class="px-4 py-3 text-center">
            <button type="button" class="copy-address-btn text-white hover:text-gray-300 text-sm mr-2"
                    data-address="${this.escapeHtml(wallet.address)}">
              📋 复制
            </button>
            <button type="button" class="delete-wallet-btn text-white hover:text-gray-300 text-sm"
                    data-id="${wallet.id}">
              🗑️ 删除
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // 绑定输入框和下拉框的变化事件
    this.bindInputEvents();
  }

  bindInputEvents() {
    // 绑定名称输入框
    document.querySelectorAll('.wallet-name-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const walletId = parseInt(e.target.dataset.walletId);
        const value = e.target.value;
        this.updateWallet(walletId, 'name', value);
      });
    });

    // 绑定分类下拉框
    document.querySelectorAll('.wallet-category-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const walletId = parseInt(e.target.dataset.walletId);
        const value = e.target.value;
        this.updateWallet(walletId, 'category', value);
      });
    });
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  updateStats() {
    // 更新统计
    const totalCount = document.getElementById('total-wallets');
    const hotCount = document.getElementById('hot-count');
    const longCount = document.getElementById('long-count');
    const testCount = document.getElementById('test-count');
    const devCount = document.getElementById('dev-count');
    const pumpGroupCount = document.getElementById('pump_group-count');
    const negativeHolderCount = document.getElementById('negative_holder-count');
    const goodHolderCount = document.getElementById('good_holder-count');

    if (totalCount) totalCount.textContent = this.wallets.length;
    if (hotCount) hotCount.textContent = this.wallets.filter(w => w.category === 'hot').length;
    if (longCount) longCount.textContent = this.wallets.filter(w => w.category === 'long').length;
    if (testCount) testCount.textContent = this.wallets.filter(w => w.category === 'test').length;
    if (devCount) devCount.textContent = this.wallets.filter(w => w.category === 'dev').length;
    if (pumpGroupCount) pumpGroupCount.textContent = this.wallets.filter(w => w.category === 'pump_group').length;
    if (negativeHolderCount) negativeHolderCount.textContent = this.wallets.filter(w => w.category === 'negative_holder').length;
    if (goodHolderCount) goodHolderCount.textContent = this.wallets.filter(w => w.category === 'good_holder').length;
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
      // 重新应用搜索
      const searchInput = document.getElementById('wallet-search');
      if (searchInput && searchInput.value.trim()) {
        this.handleSearch(searchInput.value);
      } else {
        this.filteredWallets = [...this.wallets];
        this.renderTable();
      }
      this.updateStats();
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
      // 重新应用搜索
      const searchInput = document.getElementById('wallet-search');
      if (searchInput && searchInput.value.trim()) {
        this.handleSearch(searchInput.value);
      } else {
        this.filteredWallets = [...this.wallets];
        this.renderTable();
      }
      this.updateStats();
    } catch (error) {
      console.error('删除钱包失败:', error);
      alert('删除失败：' + error.message);
    }
  }

  copyAddress(address) {
    navigator.clipboard.writeText(address).then(() => {
      // 显示成功提示
      this.showToast('地址已复制到剪贴板');
    }).catch(err => {
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = address;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        this.showToast('地址已复制到剪贴板');
      } catch (e) {
        alert('复制失败，请手动复制');
      }
      document.body.removeChild(textarea);
    });
  }

  showToast(message) {
    // 移除旧的 toast
    const oldToast = document.querySelector('.wallet-toast');
    if (oldToast) {
      oldToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'wallet-toast fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 2000);
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
            <option value="pump_group">流水盘钱包</option>
            <option value="negative_holder">负面持有者</option>
            <option value="good_holder">白名单持有者</option>
          </select>
        </div>
        <div class="flex space-x-4">
          <button type="button" id="modal-cancel-btn"
                  class="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-md text-sm font-medium text-white">
            取消
          </button>
          <button type="button" id="modal-confirm-btn"
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-sm font-medium text-white">
            添加
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 绑定按钮事件
    document.getElementById('modal-cancel-btn').addEventListener('click', () => {
      this.closeModal();
    });

    document.getElementById('modal-confirm-btn').addEventListener('click', () => {
      this.confirmAddWallet();
    });
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
