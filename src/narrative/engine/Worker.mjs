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
 *
 * P4（2026-09-21）：primary/fallback 双模型循环删除（生成式 LLM 已全面退役，
 * 判定全在 JevClient——其超时/重试由 jev 节配置自理）。任务级超时读引擎配置
 * taskTimeout，超时给明确错误信息（外层引擎同值超时是 terminate，信息不友好）。
 */

import { parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

// 获取当前模块的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量（3 级上溯到仓库根，与 config.mjs 同款——原 4 级路径已出仓库，
// 靠继承父进程 env 兜底才没暴露；独立 spawn 时读不到 .env）
dotenv.config({ path: resolve(__dirname, '../../../config/.env') });

// 导入配置模块
import { getEngineConfig } from './config.mjs';

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
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`任务超时(${timeoutMs}ms)：分析未在 taskTimeout 内完成`)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
 * 执行叙事分析任务（Jev 单模型：判定在 JevClient 内完成，超时/重试自理）
 */
async function executeTask(task) {
  const Analyzer = await loadAnalyzer();
  const taskStartTime = Date.now();
  const timeout = getEngineConfig().taskTimeout || 180000;

  console.log(`[INFO] Task ${task.id} 开始分析`);

  const result = await withTimeout(
    // 叙事结果为代币级全局缓存（不挂实验名下）：命中 is_valid 缓存即复用，不重复分析
    Analyzer.analyze(task.token_address, { ignoreCache: false }),
    timeout
  );

  const duration = Date.now() - taskStartTime;
  console.log(`[SUCCESS] Task ${task.id} 成功 (${duration}ms)`);

  return {
    ...result,
    totalDuration: duration
  };
}

/**
 * Worker 消息处理
 */
parentPort.on('message', async (task) => {
  try {
    console.log(`[WORKER] 收到任务 ${task.id} (${task.token_symbol}) 地址: ${task.token_address}`);

    // 执行分析
    const result = await executeTask(task);

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

// （C86 删除 parentPort.on('error')/.on('exit')：MessagePort 只有 message/close
// 事件，两监听永不触发——worker 级错误/退出处理在父进程 Worker 对象上
// （NarrativeAnalysisEngine._spawnWorker 的 error/exit 监听），此处删除死监听）
