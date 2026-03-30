/**
 * 叙事分析引擎（多线程版本）
 * 使用 Worker Threads 并发处理叙事分析任务
 *
 * 用法:
 *   const engine = new NarrativeAnalysisEngine({ maxConcurrency: 30 });
 *   await engine.start();
 */

// 先加载环境变量（必须在导入其他模块之前）
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

// 获取当前模块的目录（ESM 中没有 __dirname）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 使用绝对路径加载环境变量
dotenv.config({ path: resolve(__dirname, '../../../config/.env') });

import { createClient } from '@supabase/supabase-js';
import { Worker } from 'worker_threads';
import path from 'path';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量必须设置');
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 叙事分析引擎类（多线程版本）
 */
export class NarrativeAnalysisEngine {
  /**
   * @param {Object} config - 配置对象
   * @param {number} config.maxConcurrency - 最大并发任务数，默认30
   * @param {number} config.pollingInterval - 轮询间隔（毫秒），默认1000
   * @param {number} config.taskTimeout - 单个任务超时时间（毫秒），默认180000（3分钟）
   * @param {number} config.maxRetries - 最大重试次数，默认3
   */
  constructor(config = {}) {
    this.supabase = supabase;

    // 加载配置文件
    const configPath = resolve(__dirname, '../../../config/narrative-engine.json');
    let fileConfig = {};
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        fileConfig = JSON.parse(configContent);
      } catch (error) {
        console.warn(`[WARN] 加载配置文件失败: ${error.message}，使用默认配置`);
      }
    }

    const engineConfig = fileConfig.engine || {};

    this.maxConcurrency = config.maxConcurrency || engineConfig.maxConcurrency || 30;
    this.pollingInterval = config.pollingInterval || engineConfig.pollingInterval || 1000;
    this.taskTimeout = config.taskTimeout || engineConfig.taskTimeout || 180000;
    this.maxRetries = config.maxRetries || engineConfig.maxRetries || 3;

    this.isRunning = false;
    this.activeWorkers = new Map(); // taskId -> Worker
    this.workerStartTime = new Map(); // taskId -> startTime

    this.stats = {
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      currentActive: 0,
      peakConcurrency: 0,
      startTime: null
    };
  }

  /**
   * 启动引擎
   */
  async start() {
    this.isRunning = true;
    this.stats.startTime = new Date();

    console.log('='.repeat(60));
    console.log('🚀 叙事分析引擎启动（多线程版本）');
    console.log('='.repeat(60));
    console.log(`配置信息:`);
    console.log(`  最大并发任务: ${this.maxConcurrency}`);
    console.log(`  轮询间隔: ${this.pollingInterval}ms`);
    console.log(`  任务超时: ${this.taskTimeout}ms`);
    console.log(`  最大重试次数: ${this.maxRetries}`);
    console.log('='.repeat(60));

    while (this.isRunning) {
      try {
        await this._pollAndDispatchTasks();
      } catch (error) {
        this._log('ERROR', '任务调度异常', {
          error: error.message,
          stack: error.stack
        });
      }

      await this._sleep(this.pollingInterval);
    }
  }

  /**
   * 停止引擎
   */
  async stop() {
    this.isRunning = false;
    this._log('INFO', '收到停止信号，等待活跃任务完成...');

    // 等待所有活跃任务完成（最多等待60秒）
    const maxWait = 60000;
    const startWait = Date.now();

    while (this.activeWorkers.size > 0 && (Date.now() - startWait) < maxWait) {
      this._log('INFO', `等待 ${this.activeWorkers.size} 个活跃任务完成...`);
      await this._sleep(2000);
    }

    // 如果还有活跃任务，强制终止
    if (this.activeWorkers.size > 0) {
      this._log('WARN', `强制终止 ${this.activeWorkers.size} 个活跃任务`);
      for (const [taskId, worker] of this.activeWorkers) {
        worker.terminate();
      }
      this.activeWorkers.clear();
    }

    this._printStats();
  }

  /**
   * 轮询并分发任务
   * @private
   */
  async _pollAndDispatchTasks() {
    const availableSlots = this.maxConcurrency - this.activeWorkers.size;

    if (availableSlots <= 0) {
      return; // 已达到最大并发数
    }

    // 获取 pending 任务
    const { data: tasks, error } = await this.supabase
      .from('narrative_analysis_tasks')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(availableSlots);

    if (error) {
      this._log('ERROR', '获取任务失败', { error: error.message });
      return;
    }

    if (!tasks || tasks.length === 0) {
      return; // 没有待处理任务
    }

    // 分发任务到 Worker
    for (const task of tasks) {
      await this._spawnWorker(task);
    }
  }

  /**
   * 创建 Worker 处理任务
   * @private
   */
  async _spawnWorker(task) {
    try {
      // 先更新任务状态为 stage1_processing
      await this._updateTaskStatus(task.id, 'stage1_processing', {
        started_at: new Date().toISOString()
      });

      // 创建 Worker
      const workerPath = path.join(__dirname, 'Worker.mjs');
      const worker = new Worker(workerPath);

      // 记录 Worker 信息
      this.activeWorkers.set(task.id, worker);
      this.workerStartTime.set(task.id, Date.now());

      // 更新统计
      this.stats.currentActive = this.activeWorkers.size;
      if (this.stats.currentActive > this.stats.peakConcurrency) {
        this.stats.peakConcurrency = this.stats.currentActive;
      }

      this._log('INFO', '启动 Worker', {
        taskId: task.id,
        token: task.token_symbol,
        activeWorkers: this.activeWorkers.size
      });

      // 设置超时
      const timeoutId = setTimeout(() => {
        this._log('WARN', '任务超时，终止 Worker', {
          taskId: task.id,
          token: task.token_symbol,
          timeout: this.taskTimeout
        });
        worker.terminate();
        this._handleTaskTimeout(task.id);
      }, this.taskTimeout);

      // 监听 Worker 消息
      worker.on('message', (msg) => {
        clearTimeout(timeoutId);

        if (msg.type === 'success') {
          this._handleSuccess(msg.taskId, msg.result);
        } else if (msg.type === 'error') {
          this._handleError(msg.taskId, msg.error);
        }

        this._cleanupWorker(msg.taskId);
      });

      // 监听 Worker 错误
      worker.on('error', (error) => {
        clearTimeout(timeoutId);
        this._log('ERROR', 'Worker 线程错误', {
          taskId: task.id,
          error: error.message
        });
        this._handleError(task.id, `Worker error: ${error.message}`);
        this._cleanupWorker(task.id);
      });

      // 监听 Worker 退出
      worker.on('exit', (code) => {
        clearTimeout(timeoutId);
        if (code !== 0 && this.activeWorkers.has(task.id)) {
          this._log('ERROR', 'Worker 异常退出', {
            taskId: task.id,
            exitCode: code
          });
          this._handleError(task.id, `Worker exited with code ${code}`);
          this._cleanupWorker(task.id);
        }
      });

      // 发送任务给 Worker
      worker.postMessage(task);

    } catch (error) {
      this._log('ERROR', '创建 Worker 失败', {
        taskId: task.id,
        error: error.message
      });
      await this._updateTaskStatus(task.id, 'failed', {
        error_message: `Failed to spawn worker: ${error.message}`
      });
    }
  }

  /**
   * 处理任务成功
   * @private
   */
  async _handleSuccess(taskId, result) {
    const duration = this.workerStartTime.get(taskId)
      ? Date.now() - this.workerStartTime.get(taskId)
      : 0;

    this.stats.totalProcessed++;
    this.stats.successCount++;

    this._log('INFO', '任务完成', {
      taskId,
      duration: `${duration}ms`,
      stage2Category: result.stage2?.category || 'N/A'
    });

    // 先获取任务信息（获取 token_address）
    const { data: task } = await this.supabase
      .from('narrative_analysis_tasks')
      .select('token_address')
      .eq('id', taskId)
      .maybeSingle();

    if (!task) {
      this._log('ERROR', '任务不存在', { taskId });
      await this._handleError(taskId, '任务不存在');
      return;
    }

    // 检查 token_narrative 表中是否存在记录（使用 token_address）
    const { data: existingNarrative } = await this.supabase
      .from('token_narrative')
      .select('id')
      .eq('token_address', task.token_address)
      .maybeSingle();

    if (!existingNarrative) {
      // 没有记录，重试
      await this._handleNoNarrativeData(taskId);
      return;
    }

    // 更新 narrative（设置 task_id 和 analyzed_at）
    const { error } = await this.supabase
      .from('token_narrative')
      .update({
        task_id: taskId,
        analyzed_at: new Date().toISOString()
      })
      .eq('token_address', task.token_address);

    if (error) {
      this._log('ERROR', '更新叙事表失败', { taskId, error: error.message });
    }

    await this._updateTaskStatus(taskId, 'completed', {
      current_stage: result.stage2 ? 2 : 1,
      narrative_id: existingNarrative.id || null,
      completed_at: new Date().toISOString()
    });
  }

  /**
   * 处理任务错误
   * @private
   */
  async _handleError(taskId, errorMessage) {
    const duration = this.workerStartTime.get(taskId)
      ? Date.now() - this.workerStartTime.get(taskId)
      : 0;

    this.stats.totalProcessed++;
    this.stats.failureCount++;

    this._log('ERROR', '任务失败', {
      taskId,
      error: errorMessage,
      duration: `${duration}ms`
    });

    // 获取任务信息以决定是否重试
    const { data: task } = await this.supabase
      .from('narrative_analysis_tasks')
      .select('retry_count')
      .eq('id', taskId)
      .single();

    if (!task) return;

    const currentRetryCount = task.retry_count || 0;

    if (currentRetryCount < this.maxRetries) {
      // 重试
      this._log('INFO', '重试任务', {
        taskId,
        retryCount: currentRetryCount + 1,
        maxRetries: this.maxRetries
      });

      await this._updateTaskStatus(taskId, 'pending', {
        retry_count: currentRetryCount + 1,
        current_stage: 0,
        error_message: errorMessage,
        updated_at: new Date().toISOString()
      });
    } else {
      // 达到最大重试次数，标记为失败
      this._log('ERROR', '任务失败且已达最大重试次数', {
        taskId,
        retryCount: currentRetryCount
      });

      await this._updateTaskStatus(taskId, 'failed', {
        error_message: `${errorMessage} (重试 ${currentRetryCount} 次后仍失败)`,
        retry_count: currentRetryCount + 1
      });
    }
  }

  /**
   * 处理任务超时
   * @private
   */
  async _handleTaskTimeout(taskId) {
    this._handleError(taskId, `任务超时 (${this.taskTimeout}ms)`);
    this._cleanupWorker(taskId);
  }

  /**
   * 处理没有叙事数据的情况
   * @private
   */
  async _handleNoNarrativeData(taskId) {
    // 获取任务信息
    const { data: task } = await this.supabase
      .from('narrative_analysis_tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (!task) return;

    const currentRetryCount = task.retry_count || 0;

    if (currentRetryCount < this.maxRetries) {
      // 重试
      this._log('WARN', '叙事数据未保存，重置任务以便重试', {
        taskId,
        retryCount: currentRetryCount + 1
      });

      await this._updateTaskStatus(taskId, 'pending', {
        retry_count: currentRetryCount + 1,
        current_stage: 0,
        updated_at: new Date().toISOString()
      });
    } else {
      // 达到最大重试次数
      this._log('ERROR', '叙事数据未保存且已达最大重试次数', {
        taskId,
        retryCount: currentRetryCount
      });

      await this._updateTaskStatus(taskId, 'failed', {
        error_message: '叙事数据保存失败且已达最大重试次数',
        retry_count: currentRetryCount + 1
      });
    }
  }

  /**
   * 清理 Worker 资源
   * @private
   */
  _cleanupWorker(taskId) {
    const worker = this.activeWorkers.get(taskId);
    if (worker) {
      this.activeWorkers.delete(taskId);
      this.workerStartTime.delete(taskId);
      this.stats.currentActive = this.activeWorkers.size;
    }
  }

  /**
   * 更新任务状态
   * @private
   */
  async _updateTaskStatus(taskId, status, updates = {}) {
    const { error } = await this.supabase
      .from('narrative_analysis_tasks')
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...updates
      })
      .eq('id', taskId);

    if (error) {
      this._log('ERROR', '更新任务状态失败', {
        taskId,
        status,
        error: error.message
      });
    }
  }

  /**
   * 打印统计信息
   * @private
   */
  _printStats() {
    const uptime = this.stats.startTime
      ? Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000)
      : 0;

    console.log('='.repeat(60));
    console.log('📊 叙事分析引擎统计');
    console.log('='.repeat(60));
    console.log(`运行时间: ${uptime}秒`);
    console.log(`总处理任务: ${this.stats.totalProcessed}`);
    console.log(`成功: ${this.stats.successCount}`);
    console.log(`失败: ${this.stats.failureCount}`);
    console.log(`成功率: ${this.stats.totalProcessed > 0
      ? ((this.stats.successCount / this.stats.totalProcessed) * 100).toFixed(1)
      : 0}%`);
    console.log(`峰值并发: ${this.stats.peakConcurrency}`);
    console.log('='.repeat(60));
  }

  /**
   * 日志输出
   * @private
   */
  _log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;

    if (Object.keys(data).length > 0) {
      console.log(logMessage, JSON.stringify(data));
    } else {
      console.log(logMessage);
    }
  }

  /**
   * 睡眠指定毫秒数
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
