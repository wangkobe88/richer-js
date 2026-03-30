/**
 * 叙事分析任务管理
 */

// 状态配置
const STATUS_CONFIG = {
    pending: { label: '待处理', class: 'status-pending' },
    stage1_processing: { label: 'Stage 1 处理中', class: 'status-stage1_processing' },
    stage1_completed: { label: 'Stage 1 已完成', class: 'status-stage1_completed' },
    stage2_processing: { label: 'Stage 2 处理中', class: 'status-stage2_processing' },
    completed: { label: '已完成', class: 'status-completed' },
    failed: { label: '失败', class: 'status-failed' }
};

// 当前状态
let currentState = {
    page: 1,
    pageSize: 20,
    status: '',
    search: '',
    sortBy: 'created_at',
    sortOrder: 'desc',
    selectedTaskIds: new Set()
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    loadTasks();
    loadStats();
});

/**
 * 初始化事件监听器
 */
function initEventListeners() {
    // 刷新按钮
    document.getElementById('refresh-btn').addEventListener('click', () => {
        loadTasks();
        loadStats();
    });

    // 状态筛选
    document.getElementById('status-filter').addEventListener('change', (e) => {
        currentState.status = e.target.value;
        currentState.page = 1;
        loadTasks();
    });

    // 排序选择
    document.getElementById('sort-select').addEventListener('change', (e) => {
        const [sortBy, sortOrder] = e.target.value.split('-');
        currentState.sortBy = sortBy;
        currentState.sortOrder = sortOrder;
        currentState.page = 1;
        loadTasks();
    });

    // 搜索输入（防抖）
    let searchTimeout;
    document.getElementById('search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentState.search = e.target.value;
            currentState.page = 1;
            loadTasks();
        }, 500);
    });

    // 全选复选框
    document.getElementById('select-all-checkbox').addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.task-checkbox:not(:disabled)');
        checkboxes.forEach(cb => {
            cb.checked = e.target.checked;
            const taskId = cb.dataset.taskId;
            if (e.target.checked) {
                currentState.selectedTaskIds.add(taskId);
            } else {
                currentState.selectedTaskIds.delete(taskId);
            }
        });
        updateBatchDeleteButton();
    });

    // 添加任务按钮
    document.getElementById('add-task-btn').addEventListener('click', () => {
        document.getElementById('add-task-modal').classList.remove('hidden');
    });

    // 关闭弹窗
    document.getElementById('close-modal-btn').addEventListener('click', () => {
        document.getElementById('add-task-modal').classList.add('hidden');
    });

    document.getElementById('cancel-add-btn').addEventListener('click', () => {
        document.getElementById('add-task-modal').classList.add('hidden');
    });

    document.getElementById('close-detail-btn').addEventListener('click', () => {
        document.getElementById('task-detail-modal').classList.add('hidden');
    });

    // 添加任务表单
    document.getElementById('add-task-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addTask();
    });

    // 批量删除按钮
    document.getElementById('batch-delete-btn').addEventListener('click', async () => {
        if (confirm(`确定要删除选中的 ${currentState.selectedTaskIds.size} 个任务吗？`)) {
            await batchDeleteTasks();
        }
    });

    // 每页数量选择
    document.getElementById('page-size-select').addEventListener('change', (e) => {
        currentState.pageSize = parseInt(e.target.value);
        currentState.page = 1;
        loadTasks();
    });
}

/**
 * 加载任务列表
 */
async function loadTasks() {
    showLoading(true);

    try {
        const params = new URLSearchParams({
            page: currentState.page,
            pageSize: currentState.pageSize,
            sortBy: currentState.sortBy,
            sortOrder: currentState.sortOrder
        });

        if (currentState.status) params.append('status', currentState.status);
        if (currentState.search) params.append('search', currentState.search);

        const response = await fetch(`/api/narrative/tasks?${params}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        renderTasks(result.data);
        renderPagination(result.pagination);
        updateEmptyState(result.data.length);

    } catch (error) {
        console.error('加载任务失败:', error);
        showError('加载任务失败: ' + error.message);
    } finally {
        showLoading(false);
    }
}

/**
 * 加载统计数据
 */
async function loadStats() {
    try {
        const response = await fetch('/api/narrative/tasks/stats');
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        const stats = result.data;
        document.getElementById('stat-total').textContent = stats.total;
        document.getElementById('stat-pending').textContent = stats.pending;
        document.getElementById('stat-processing').textContent = stats.stage1_processing + stats.stage1_completed + stats.stage2_processing;
        document.getElementById('stat-completed').textContent = stats.completed;
        document.getElementById('stat-failed').textContent = stats.failed;

        // 计算成功率
        const completed = stats.completed;
        const total = stats.completed + stats.failed;
        const rate = total > 0 ? ((completed / total) * 100).toFixed(1) : '-';
        document.getElementById('stat-rate').textContent = rate === '-' ? '-' : rate + '%';

    } catch (error) {
        console.error('加载统计失败:', error);
    }
}

/**
 * 渲染任务列表
 */
function renderTasks(tasks) {
    const tbody = document.getElementById('tasks-tbody');
    tbody.innerHTML = '';

    if (tasks.length === 0) {
        return;
    }

    tasks.forEach(task => {
        const statusConfig = STATUS_CONFIG[task.status] || { label: task.status, class: '' };
        const shortAddress = task.token_address.slice(0, 6) + '...' + task.token_address.slice(-4);
        const isSelected = currentState.selectedTaskIds.has(task.id);

        const tr = document.createElement('tr');
        tr.className = 'task-row';
        tr.innerHTML = `
            <td class="checkbox-cell px-4 py-3">
                <input type="checkbox" class="task-checkbox rounded border-gray-300" data-task-id="${task.id}" ${isSelected ? 'checked' : ''}>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
                <div class="flex items-center">
                    <div class="text-sm font-medium text-gray-900">${escapeHtml(task.token_symbol)}</div>
                </div>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
                <div class="text-sm text-gray-500 font-mono">${shortAddress}</div>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
                <span class="status-badge ${statusConfig.class}">${statusConfig.label}</span>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
                <input type="number" class="priority-input" value="${task.priority}" min="0" max="100" data-task-id="${task.id}">
            </td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                ${task.triggered_by_experiment_id ? `<a href="/experiment/${task.triggered_by_experiment_id}" class="text-blue-600 hover:text-blue-700">${task.triggered_by_experiment_id.slice(0, 8)}...</a>` : '-'}
            </td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                ${formatDateTime(task.created_at)}
            </td>
            <td class="px-4 py-3 whitespace-nowrap text-sm font-medium">
                <button class="text-blue-600 hover:text-blue-900 mr-3" onclick="viewTaskDetail('${task.id}')">详情</button>
                <button class="text-green-600 hover:text-green-900 mr-3" onclick="resetTask('${task.id}')">重置</button>
                <button class="text-red-600 hover:text-red-900" onclick="deleteTask('${task.id}')">删除</button>
            </td>
        `;

        // 绑定复选框事件
        const checkbox = tr.querySelector('.task-checkbox');
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                currentState.selectedTaskIds.add(task.id);
            } else {
                currentState.selectedTaskIds.delete(task.id);
                document.getElementById('select-all-checkbox').checked = false;
            }
            updateBatchDeleteButton();
        });

        // 绑定优先级输入事件
        const priorityInput = tr.querySelector('.priority-input');
        priorityInput.addEventListener('change', (e) => {
            updateTaskPriority(task.id, e.target.value);
        });

        tbody.appendChild(tr);
    });
}

/**
 * 渲染分页
 */
function renderPagination(pagination) {
    const { page, pageSize, total, totalPages } = pagination;

    // 更新页码信息
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    document.getElementById('page-start').textContent = start;
    document.getElementById('page-end').textContent = end;
    document.getElementById('page-total').textContent = total;

    // 渲染分页按钮
    const nav = document.getElementById('pagination-nav');
    nav.innerHTML = '';

    const maxButtons = 7;
    let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }

    // 上一页
    if (page > 1) {
        nav.innerHTML += `<button onclick="goToPage(${page - 1})" class="relative inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-l-md text-gray-700 bg-white hover:bg-gray-50">上一页</button>`;
    } else {
        nav.innerHTML += `<button disabled class="relative inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-l-md text-gray-300 bg-white">上一页</button>`;
    }

    // 页码
    for (let i = startPage; i <= endPage; i++) {
        if (i === page) {
            nav.innerHTML += `<button class="relative inline-flex items-center px-4 py-2 border border-blue-500 text-sm font-medium rounded-md text-blue-600 bg-blue-50">${i}</button>`;
        } else {
            nav.innerHTML += `<button onclick="goToPage(${i})" class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">${i}</button>`;
        }
    }

    // 下一页
    if (page < totalPages) {
        nav.innerHTML += `<button onclick="goToPage(${page + 1})" class="relative inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-r-md text-gray-700 bg-white hover:bg-gray-50">下一页</button>`;
    } else {
        nav.innerHTML += `<button disabled class="relative inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-r-md text-gray-300 bg-white">下一页</button>`;
    }

    // 移动端分页按钮
    const prevMobile = document.getElementById('prev-page-mobile');
    const nextMobile = document.getElementById('next-page-mobile');

    prevMobile.onclick = page > 1 ? () => goToPage(page - 1) : null;
    prevMobile.disabled = page <= 1;
    prevMobile.className = page > 1
        ? 'relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50'
        : 'relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-300 bg-white cursor-not-allowed';

    nextMobile.onclick = page < totalPages ? () => goToPage(page + 1) : null;
    nextMobile.disabled = page >= totalPages;
    nextMobile.className = page < totalPages
        ? 'ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50'
        : 'ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-300 bg-white cursor-not-allowed';
}

/**
 * 跳转到指定页面
 */
function goToPage(page) {
    currentState.page = page;
    currentState.selectedTaskIds.clear();
    document.getElementById('select-all-checkbox').checked = false;
    updateBatchDeleteButton();
    loadTasks();
}

/**
 * 添加任务
 */
async function addTask() {
    const tokenAddress = document.getElementById('task-token-address').value.trim();
    const tokenSymbol = document.getElementById('task-token-symbol').value.trim();
    const experimentId = document.getElementById('task-experiment-id').value.trim();
    const priority = parseInt(document.getElementById('task-priority').value);

    try {
        const response = await fetch('/api/narrative/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tokenAddress,
                tokenSymbol: tokenSymbol || null,
                experimentId: experimentId || null,
                priority
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        // 关闭弹窗
        document.getElementById('add-task-modal').classList.add('hidden');

        // 清空表单
        document.getElementById('add-task-form').reset();
        document.getElementById('task-priority').value = 50;

        // 刷新列表
        loadTasks();
        loadStats();

        showSuccess('任务创建成功');

    } catch (error) {
        console.error('创建任务失败:', error);
        showError('创建任务失败: ' + error.message);
    }
}

/**
 * 更新任务优先级
 */
async function updateTaskPriority(taskId, priority) {
    try {
        const response = await fetch(`/api/narrative/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ priority: parseInt(priority) })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        // 不需要刷新列表，因为只更新了优先级

    } catch (error) {
        console.error('更新优先级失败:', error);
        showError('更新优先级失败: ' + error.message);
        // 恢复原值
        loadTasks();
    }
}

/**
 * 重置任务
 */
async function resetTask(taskId) {
    if (!confirm('确定要重置此任务吗？这将把任务状态重置为 pending。')) {
        return;
    }

    try {
        const response = await fetch(`/api/narrative/tasks/${taskId}/reset`, {
            method: 'POST'
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        loadTasks();
        loadStats();
        showSuccess('任务已重置');

    } catch (error) {
        console.error('重置任务失败:', error);
        showError('重置任务失败: ' + error.message);
    }
}

/**
 * 删除任务
 */
async function deleteTask(taskId) {
    if (!confirm('确定要删除此任务吗？')) {
        return;
    }

    try {
        const response = await fetch(`/api/narrative/tasks/${taskId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        currentState.selectedTaskIds.delete(taskId);
        updateBatchDeleteButton();
        loadTasks();
        loadStats();
        showSuccess('任务已删除');

    } catch (error) {
        console.error('删除任务失败:', error);
        showError('删除任务失败: ' + error.message);
    }
}

/**
 * 批量删除任务
 */
async function batchDeleteTasks() {
    try {
        const response = await fetch('/api/narrative/tasks/batch', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                taskIds: Array.from(currentState.selectedTaskIds)
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        currentState.selectedTaskIds.clear();
        document.getElementById('select-all-checkbox').checked = false;
        updateBatchDeleteButton();
        loadTasks();
        loadStats();
        showSuccess(result.message || '批量删除成功');

    } catch (error) {
        console.error('批量删除失败:', error);
        showError('批量删除失败: ' + error.message);
    }
}

/**
 * 查看任务详情
 */
async function viewTaskDetail(taskId) {
    try {
        const response = await fetch(`/api/narrative/tasks/${taskId}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        renderTaskDetail(result.data);
        document.getElementById('task-detail-modal').classList.remove('hidden');

    } catch (error) {
        console.error('获取任务详情失败:', error);
        showError('获取任务详情失败: ' + error.message);
    }
}

/**
 * 渲染任务详情
 */
function renderTaskDetail(task) {
    const statusConfig = STATUS_CONFIG[task.status] || { label: task.status, class: '' };
    const shortAddress = task.token_address.slice(0, 10) + '...' + task.token_address.slice(-8);

    let html = `
        <div class="grid grid-cols-2 gap-4">
            <div>
                <div class="text-sm text-gray-500">代币符号</div>
                <div class="font-medium">${escapeHtml(task.token_symbol)}</div>
            </div>
            <div>
                <div class="text-sm text-gray-500">状态</div>
                <div><span class="status-badge ${statusConfig.class}">${statusConfig.label}</span></div>
            </div>
            <div class="col-span-2">
                <div class="text-sm text-gray-500">代币地址</div>
                <div class="font-mono text-sm break-all">${shortAddress}</div>
            </div>
            <div>
                <div class="text-sm text-gray-500">优先级</div>
                <div class="font-medium">${task.priority}</div>
            </div>
            <div>
                <div class="text-sm text-gray-500">当前阶段</div>
                <div class="font-medium">${task.current_stage || 0}</div>
            </div>
            <div>
                <div class="text-sm text-gray-500">重试次数</div>
                <div class="font-medium">${task.retry_count || 0}</div>
            </div>
            <div>
                <div class="text-sm text-gray-500">创建时间</div>
                <div class="text-sm">${formatDateTime(task.created_at)}</div>
            </div>
            <div>
                <div class="text-sm text-gray-500">更新时间</div>
                <div class="text-sm">${formatDateTime(task.updated_at)}</div>
            </div>
            <div class="col-span-2">
                <div class="text-sm text-gray-500">触发实验</div>
                <div class="text-sm">
                    ${task.triggered_by_experiment_id
                        ? `<a href="/experiment/${task.triggered_by_experiment_id}" class="text-blue-600 hover:text-blue-700">${task.triggered_by_experiment_id}</a>`
                        : '-'}
                </div>
            </div>
        `;

    if (task.error_message) {
        html += `
            <div class="col-span-2">
                <div class="text-sm text-gray-500">错误信息</div>
                <div class="text-sm text-red-600 break-all">${escapeHtml(task.error_message)}</div>
            </div>
        `;
    }

    if (task.narrative_id) {
        html += `
            <div class="col-span-2">
                <div class="text-sm text-gray-500">关联叙事</div>
                <div class="text-sm">
                    <a href="/narrative-analyzer?address=${task.token_address}" class="text-blue-600 hover:text-blue-700">查看叙事分析结果</a>
                </div>
            </div>
        `;
    }

    html += '</div>';

    // 如果有叙事结果，显示更多信息
    if (task.narrative) {
        const n = task.narrative;
        html += `
            <div class="border-t border-gray-200 pt-4 mt-4">
                <h4 class="font-medium text-gray-900 mb-3">叙事分析结果</h4>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <div class="text-sm text-gray-500">LLM Stage 1 分类</div>
                        <div class="text-sm">${n.llm_stage1_category || '-'}</div>
                    </div>
                    <div>
                        <div class="text-sm text-gray-500">LLM Stage 2 分类</div>
                        <div class="text-sm">${n.llm_stage2_category || '-'}</div>
                    </div>
                    <div class="col-span-2">
                        <div class="text-sm text-gray-500">分析时间</div>
                        <div class="text-sm">${formatDateTime(n.analyzed_at)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    document.getElementById('task-detail-content').innerHTML = html;
}

/**
 * 更新批量删除按钮状态
 */
function updateBatchDeleteButton() {
    const btn = document.getElementById('batch-delete-btn');
    if (currentState.selectedTaskIds.size > 0) {
        btn.classList.remove('hidden');
        btn.textContent = `🗑️ 批量删除 (${currentState.selectedTaskIds.size})`;
    } else {
        btn.classList.add('hidden');
    }
}

/**
 * 显示/隐藏加载状态
 */
function showLoading(show) {
    const loadingContainer = document.getElementById('loading-container');
    const tasksTbody = document.getElementById('tasks-tbody');

    if (show) {
        loadingContainer.classList.remove('hidden');
        tasksTbody.classList.add('hidden');
    } else {
        loadingContainer.classList.add('hidden');
        tasksTbody.classList.remove('hidden');
    }
}

/**
 * 更新空状态显示
 */
function updateEmptyState(count) {
    const emptyContainer = document.getElementById('empty-container');
    const tasksTable = document.querySelector('.overflow-x-auto table');

    if (count === 0) {
        emptyContainer.classList.remove('hidden');
        tasksTable.classList.add('hidden');
    } else {
        emptyContainer.classList.add('hidden');
        tasksTable.classList.remove('hidden');
    }
}

/**
 * 格式化日期时间
 */
function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * 转义HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 显示成功消息
 */
function showSuccess(message) {
    // 简单实现，可以改成 toast
    alert(message);
}

/**
 * 显示错误消息
 */
function showError(message) {
    // 简单实现，可以改成 toast
    alert(message);
}

// 将 onclick 事件处理器函数暴露到全局作用域
window.deleteTask = deleteTask;
window.resetTask = resetTask;
window.viewTaskDetail = viewTaskDetail;
window.goToPage = goToPage;
