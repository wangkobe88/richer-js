/**
 * 叙事分析 Worker 线程
 * 每个 Worker 处理一个叙事分析任务
 *
 * 接收消息格式:
 * {
 *   id: string,
 *   token_address: string,
 *   token_symbol: string,
 *   triggered_by_experiment_id: string,
 *   priority: number,
 *   retry_count: number
 * }
 *
 * 返回消息格式:
 * {
 *   type: 'success' | 'error',
 *   taskId: string,
 *   result?: object,
 *   error?: string
 * }
 */

import { parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

// 获取当前模块的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: resolve(__dirname, '../../../../config/.env') });

// 导入配置模块
import { getPrimaryModelConfig, getFallbackModelConfig } from './config.mjs';

// 动态导入 NarrativeAnalyzer
let NarrativeAnalyzer;

async function loadAnalyzer() {
  if (!NarrativeAnalyzer) {
    const module = await import('../analyzer/NarrativeAnalyzer.mjs');
    NarrativeAnalyzer = module.NarrativeAnalyzer;
  }
  return NarrativeAnalyzer;
}

/**
 * 超时封装
 */
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
    })
  ]);
}

/**
 * 执行叙事分析任务（使用新框架）
 * 新框架：事件分析 + 代币分析 + 账号/社区子LLM
 */
async function executeTask(task, modelConfig) {
  const Analyzer = await loadAnalyzer();
  const taskStartTime = Date.now();
  let lastError = null;

  console.log(`[INFO] Task ${task.id} 开始分析（新框架）`);

  // 先尝试主模型
  for (const modelType of ['primary', 'fallback']) {
    const model = modelConfig[modelType];

    // 设置当前模型
    process.env.LLM_MODEL = model.name;

    // 合并超时时间（stage1 + stage2）
    const timeout = model.stage1Timeout + model.stage2Timeout;

    try {
      const result = await withTimeout(
        Analyzer.analyze(task.token_address, {
          experimentId: task.triggered_by_experiment_id,
          ignoreCache: false
        }),
        timeout
      );

      const duration = Date.now() - taskStartTime;

      // 记录日志
      if (modelType === 'fallback') {
        console.log(`[FALLBACK] Task ${task.id} 使用备用模型 ${model.name} 成功 (${duration}ms)`);
      } else {
        console.log(`[SUCCESS] Task ${task.id} 使用模型 ${model.name} 成功 (${duration}ms)`);
      }

      return {
        ...result,
        totalDuration: duration
      };

    } catch (error) {
      lastError = error;
      const duration = Date.now() - taskStartTime;

      if (error.message === 'TIMEOUT') {
        console.log(`[TIMEOUT] Task ${task.id} 模型 ${model.name} 超时 (${timeout}ms)`);
        continue; // 尝试下一个模型
      }

      // 非超时错误，记录并抛出
      console.log(`[ERROR] Task ${task.id} 模型 ${model.name} 失败: ${error.message}`);
      throw error;
    }
  }

  // 两个模型都失败
  throw new Error(`所有模型均失败: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Worker 消息处理
 */
parentPort.on('message', async (task) => {
  try {
    console.log(`[WORKER] 收到任务 ${task.id} (${task.token_symbol}) 地址: ${task.token_address}`);

    // 从配置文件读取模型配置
    const primaryConfig = getPrimaryModelConfig();
    const fallbackConfig = getFallbackModelConfig();

    const modelConfig = {
      primary: {
        name: primaryConfig?.name || 'Pro/MiniMaxAI/MiniMax-M2.5',
        stage1Timeout: primaryConfig?.stage1Timeout || 60000,
        stage2Timeout: primaryConfig?.stage2Timeout || 60000,
        parameters: primaryConfig?.parameters || {}
      },
      fallback: {
        name: fallbackConfig?.name || 'deepseek-ai/DeepSeek-V3',
        stage1Timeout: fallbackConfig?.stage1Timeout || 30000,
        stage2Timeout: fallbackConfig?.stage2Timeout || 30000,
        parameters: fallbackConfig?.parameters || {}
      }
    };

    // 执行分析
    const result = await executeTask(task, modelConfig);

    parentPort.postMessage({
      type: 'success',
      taskId: task.id,
      result
    });

  } catch (error) {
    console.error(`[WORKER] 任务 ${task.id} 执行失败:`, error.message);
    parentPort.postMessage({
      type: 'error',
      taskId: task.id,
      error: error.message
    });
  }
});

// Worker 错误处理
parentPort.on('error', (error) => {
  console.error('[WORKER] Worker 线程错误:', error);
});

// 退出处理
parentPort.on('exit', (code) => {
  if (code !== 0) {
    console.error(`[WORKER] Worker 线程异常退出，代码: ${code}`);
  }
});
