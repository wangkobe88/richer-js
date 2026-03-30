/**
 * 叙事分析引擎
 * 独立进程运行，从任务队列拉取任务并执行分析
 *
 * 用法:
 *   const engine = new NarrativeAnalysisEngine({ pollingInterval: 5000 });
 *   await engine.start();
 */

// 先加载环境变量（必须在导入其他模块之前）
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

// 获取当前模块的目录（ESM 中没有 __dirname）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 使用绝对路径加载环境变量
dotenv.config({ path: resolve(__dirname, '../../../config/.env') });

import { createClient } from '@supabase/supabase-js';
import { NarrativeAnalyzer } from '../analyzer/NarrativeAnalyzer.mjs';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量必须设置');
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 叙事分析引擎类
 */
export class NarrativeAnalysisEngine {
  /**
   * @param {Object} config - 配置对象
   * @param {number} config.pollingInterval - 轮询间隔（毫秒），默认5000
   * @param {number} config.maxConcurrentTasks - 最大并发任务数，默认1（串行）
   * @param {number} config.taskTimeout - 单个任务超时时间（毫秒），默认180000（3分钟）
   */
  constructor(config = {}) {
    this.supabase = supabase;
    this.pollingInterval = config.pollingInterval || 5000;
    this.maxConcurrentTasks = config.maxConcurrentTasks || 1;
    this.taskTimeout = config.taskTimeout || 180000; // 3分钟超时
    this.isRunning = false;
    this.currentTask = null;
    this.stats = {
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
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
    console.log('🚀 叙事分析引擎启动');
    console.log('='.repeat(60));
    console.log(`配置信息:`);
    console.log(`  轮询间隔: ${this.pollingInterval}ms`);
    console.log(`  最大并发任务: ${this.maxConcurrentTasks}`);
    console.log(`  任务超时: ${this.taskTimeout}ms`);
    console.log('='.repeat(60));

    while (this.isRunning) {
      try {
        if (!this.currentTask) {
          await this._fetchAndProcessTask();
        }
      } catch (error) {
        this._log('ERROR', '任务处理异常', {
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
  stop() {
    this.isRunning = false;
    this._log('INFO', '收到停止信号，引擎将退出...');
    this._printStats();
  }

  /**
   * 拉取并处理下一个任务
   * @private
   */
  async _fetchAndProcessTask() {
    // 获取下一个待处理任务（按优先级降序、创建时间升序）
    const { data: task, error } = await this.supabase
      .from('narrative_analysis_tasks')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      this._log('ERROR', '获取任务失败', { error: error.message });
      return;
    }

    if (!task) {
      return; // 没有待处理任务
    }

    this.currentTask = task;
    this._log('INFO', '开始处理任务', {
      taskId: task.id,
      token: task.token_symbol,
      address: task.token_address,
      priority: task.priority,
      triggeredBy: task.triggered_by_experiment_id
    });

    await this._processTask(task);
    this.currentTask = null;
  }

  /**
   * 处理单个任务
   * @private
   * @param {Object} task - 任务对象
   */
  async _processTask(task) {
    const taskStartTime = Date.now();

    try {
      // 设置超时
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('任务超时')), this.taskTimeout);
      });

      // 执行任务
      await Promise.race([
        this._executeTask(task),
        timeoutPromise
      ]);

      const duration = Date.now() - taskStartTime;
      this.stats.totalProcessed++;
      this.stats.successCount++;

      this._log('INFO', '任务完成', {
        taskId: task.id,
        token: task.token_symbol,
        duration: `${duration}ms`
      });

    } catch (error) {
      const duration = Date.now() - taskStartTime;
      this.stats.totalProcessed++;
      this.stats.failureCount++;

      this._log('ERROR', '任务失败', {
        taskId: task.id,
        token: task.token_symbol,
        error: error.message,
        duration: `${duration}ms`
      });

      await this._updateTaskStatus(task.id, 'failed', {
        error_message: error.message,
        retry_count: (task.retry_count || 0) + 1
      });
    }
  }

  /**
   * 执行任务（两阶段分析）
   * @private
   * @param {Object} task - 任务对象
   */
  async _executeTask(task) {
    // 标记为 Stage 1 处理中
    await this._updateTaskStatus(task.id, 'stage1_processing', {
      started_at: new Date().toISOString()
    });

    // 执行 Stage 1
    const stage1Result = await this._executeStage1(task);

    if (!stage1Result.pass) {
      // 低质量，直接完成
      await this._completeAnalysis(task, stage1Result, null);
      this._log('INFO', 'Stage 1 检测到低质量，分析完成', {
        taskId: task.id,
        token: task.token_symbol,
        reason: stage1Result.reason
      });
      return;
    }

    // Stage 1 通过，更新状态
    await this._updateTaskStatus(task.id, 'stage1_completed', {
      current_stage: 1
    });

    this._log('INFO', 'Stage 1 通过，开始 Stage 2', {
      taskId: task.id,
      token: task.token_symbol
    });

    // 标记为 Stage 2 处理中
    await this._updateTaskStatus(task.id, 'stage2_processing');

    // 执行 Stage 2
    const stage2Result = await this._executeStage2(task);

    // 完成
    await this._completeAnalysis(task, stage1Result, stage2Result);
    this._log('INFO', 'Stage 2 完成，分析完成', {
      taskId: task.id,
      token: task.token_symbol,
      category: stage2Result.category
    });
  }

  /**
   * 执行 Stage 1
   * @private
   */
  async _executeStage1(task) {
    const startTime = Date.now();

    try {
      const result = await NarrativeAnalyzer.analyzeStage1(task.token_address, {
        experimentId: task.triggered_by_experiment_id,
        ignoreCache: false
      });

      const duration = Date.now() - startTime;
      this._log('INFO', 'Stage 1 完成', {
        taskId: task.id,
        token: task.token_symbol,
        pass: result.pass,
        category: result.category,
        duration: `${duration}ms`
      });

      return {
        pass: result.pass,
        category: result.category,
        reason: result.reason,
        stage: result.stage,
        scenario: result.scenario,
        entities: result.entities,
        started_at: result.started_at,
        finished_at: result.finished_at,
        success: result.success,
        error: result.error
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this._log('ERROR', 'Stage 1 失败', {
        taskId: task.id,
        token: task.token_symbol,
        error: error.message,
        duration: `${duration}ms`
      });

      // 尝试保存失败信息到数据库，避免数据完全丢失
      try {
        const { fetchTokenData, extractInfo } = NarrativeAnalyzer;
        const tokenData = await fetchTokenData(task.token_address);
        if (tokenData) {
          const extractedInfo = extractInfo(tokenData);
          const errorResult = {
            pass: false,
            category: 'low',
            reason: `Stage 1 失败: ${error.message}`,
            stage: 0,
            scenario: 0,
            entities: {},
            started_at: new Date(Date.now() - duration).toISOString(),
            finished_at: new Date().toISOString(),
            success: false,
            error: error.message
          };

          // 保存失败结果（只保存基本信息）
          await NarrativeAnalyzer._saveStage1Data(
            task.token_address.toLowerCase(),
            tokenData,
            extractedInfo,
            {}, // twitterInfo
            {}, // classifiedUrls
            task.triggered_by_experiment_id,
            errorResult,
            null, // urlExtractionResult
            {}, // dataFetchResults
            null  // stage1DataToSave
          );

          this._log('INFO', 'Stage 1 失败信息已保存', {
            taskId: task.id,
            token: task.token_symbol
          });
        }
      } catch (saveError) {
        this._log('ERROR', '保存 Stage 1 失败信息时出错', {
          taskId: task.id,
          token: task.token_symbol,
          saveError: saveError.message,
          originalError: error.message
        });
      }

      return {
        pass: false,
        category: 'low',
        reason: `Stage 1 失败: ${error.message}`,
        stage: 0,
        scenario: 0,
        entities: {},
        started_at: new Date(Date.now() - duration).toISOString(),
        finished_at: new Date().toISOString(),
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 执行 Stage 2
   * @private
   */
  async _executeStage2(task) {
    const startTime = Date.now();

    try {
      const result = await NarrativeAnalyzer.analyzeStage2(task.token_address, {
        experimentId: task.triggered_by_experiment_id
      });

      const duration = Date.now() - startTime;
      this._log('INFO', 'Stage 2 完成', {
        taskId: task.id,
        token: task.token_symbol,
        category: result.category,
        totalScore: result.total_score,
        duration: `${duration}ms`
      });

      return {
        ...result,
        started_at: result.started_at,
        finished_at: result.finished_at,
        success: result.success,
        error: result.error
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this._log('ERROR', 'Stage 2 失败', {
        taskId: task.id,
        token: task.token_symbol,
        error: error.message,
        duration: `${duration}ms`
      });

      // Stage 2 失败，返回 unrated
      return {
        category: 'unrated',
        reasoning: `Stage 2 失败: ${error.message}`,
        scores: null,
        total_score: null,
        started_at: new Date(Date.now() - duration).toISOString(),
        finished_at: new Date().toISOString(),
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 完成分析，更新叙事表和任务状态
   * @private
   */
  async _completeAnalysis(task, stage1Data, stage2Data) {
    // 1. 先检查 token_narrative 表中是否存在记录
    const { data: existingNarrative } = await this.supabase
      .from('token_narrative')
      .select('id')
      .eq('token_address', task.token_address)
      .maybeSingle();

    if (!existingNarrative) {
      // 没有记录，记录错误并重置任务状态以便重新处理
      this._log('ERROR', '完成分析时发现叙事数据不存在，重置任务状态', {
        taskId: task.id,
        token: task.token_symbol,
        tokenAddress: task.token_address
      });

      // 重置任务状态为 pending，让系统重新处理
      await this._updateTaskStatus(task.id, 'pending', {
        current_stage: 0,
        updated_at: new Date().toISOString()
      });

      this._log('WARN', '任务已重置为 pending 状态，等待重新处理', {
        taskId: task.id,
        token: task.token_symbol
      });

      return;
    }

    // 2. 更新 token_narrative 表
    const { data: narrative } = await this.supabase
      .from('token_narrative')
      .update({
        task_id: task.id,
        experiment_id: task.triggered_by_experiment_id,
        analyzed_at: new Date().toISOString()
      })
      .eq('token_address', task.token_address)
      .select('id')
      .single();

    // 3. 更新任务状态为完成
    await this._updateTaskStatus(task.id, 'completed', {
      current_stage: stage2Data ? 2 : 1,
      narrative_id: narrative?.id || null,
      completed_at: new Date().toISOString()
    });
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
    const uptime = this.stats.startTime ?
      Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000) : 0;

    console.log('='.repeat(60));
    console.log('📊 叙事分析引擎统计');
    console.log('='.repeat(60));
    console.log(`运行时间: ${uptime}秒`);
    console.log(`总处理任务: ${this.stats.totalProcessed}`);
    console.log(`成功: ${this.stats.successCount}`);
    console.log(`失败: ${this.stats.failureCount}`);
    console.log(`成功率: ${this.stats.totalProcessed > 0 ?
      ((this.stats.successCount / this.stats.totalProcessed) * 100).toFixed(1) : 0}%`);
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
