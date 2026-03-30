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
 * 执行单阶段分析（带模型容错）
 */
async function executeStage(stage, task, modelConfig) {
  const Analyzer = await loadAnalyzer();
  const startTime = Date.now();
  let lastError = null;

  // 先尝试主模型
  for (const modelType of ['primary', 'fallback']) {
    const model = modelConfig[modelType];

    // 设置当前模型
    process.env.LLM_MODEL = model.name;

    const timeout = stage === 1 ? model.stage1Timeout : model.stage2Timeout;

    try {
      let result;
      if (stage === 1) {
        result = await withTimeout(
          Analyzer.analyzeStage1(task.token_address, {
            experimentId: task.triggered_by_experiment_id,
            ignoreCache: false
          }),
          timeout
        );
      } else {
        result = await withTimeout(
          Analyzer.analyzeStage2(task.token_address, {
            experimentId: task.triggered_by_experiment_id
          }),
          timeout
        );
      }

      const duration = Date.now() - startTime;

      // 记录日志
      if (modelType === 'fallback') {
        console.log(`[FALLBACK] Task ${task.id} Stage ${stage} 使用备用模型 ${model.name} 成功 (${duration}ms)`);
      } else {
        console.log(`[SUCCESS] Task ${task.id} Stage ${stage} 使用模型 ${model.name} 成功 (${duration}ms)`);
      }

      return { success: true, data: result, model: model.name, duration };

    } catch (error) {
      lastError = error;
      const duration = Date.now() - startTime;

      if (error.message === 'TIMEOUT') {
        console.log(`[TIMEOUT] Task ${task.id} Stage ${stage} 模型 ${model.name} 超时 (${timeout}ms)`);
        continue; // 尝试下一个模型
      }

      // 非超时错误，记录并抛出
      console.log(`[ERROR] Task ${task.id} Stage ${stage} 模型 ${model.name} 失败: ${error.message}`);
      throw error;
    }
  }

  // 两个模型都失败
  throw new Error(`Stage ${stage} 所有模型均失败: ${lastError?.message || 'Unknown error'}`);
}

/**
 * 执行完整的两阶段分析
 */
async function executeTask(task, modelConfig) {
  const taskStartTime = Date.now();

  // Stage 1
  console.log(`[INFO] Task ${task.id} 开始 Stage 1 分析`);
  const stage1Result = await executeStage(1, task, modelConfig);

  if (!stage1Result.data.pass) {
    // Stage 1 未通过，直接完成
    console.log(`[INFO] Task ${task.id} Stage 1 未通过，分析完成`);
    return {
      stage1: stage1Result.data,
      stage2: null,
      totalDuration: Date.now() - taskStartTime
    };
  }

  // Stage 2
  console.log(`[INFO] Task ${task.id} Stage 1 通过，开始 Stage 2 分析`);
  const stage2Result = await executeStage(2, task, modelConfig);

  const totalDuration = Date.now() - taskStartTime;
  console.log(`[INFO] Task ${task.id} 分析完成，总耗时 ${totalDuration}ms，评级: ${stage2Result.data.category}`);

  return {
    stage1: stage1Result.data,
    stage2: stage2Result.data,
    totalDuration
  };
}

/**
 * Worker 消息处理
 */
parentPort.on('message', async (task) => {
  try {
    console.log(`[WORKER] 收到任务 ${task.id} (${task.token_symbol})`);

    // 读取模型配置
    const modelConfig = {
      primary: {
        name: process.env.NARRATIVE_PRIMARY_MODEL || 'Pro/MiniMaxAI/MiniMax-M2.5',
        stage1Timeout: parseInt(process.env.NARRATIVE_PRIMARY_STAGE1_TIMEOUT) || 60000,
        stage2Timeout: parseInt(process.env.NARRATIVE_PRIMARY_STAGE2_TIMEOUT) || 60000
      },
      fallback: {
        name: process.env.NARRATIVE_FALLBACK_MODEL || 'deepseek-ai/DeepSeek-V3',
        stage1Timeout: parseInt(process.env.NARRATIVE_FALLBACK_STAGE1_TIMEOUT) || 30000,
        stage2Timeout: parseInt(process.env.NARRATIVE_FALLBACK_STAGE2_TIMEOUT) || 30000
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
