/**
 * 叙事分析引擎启动脚本
 * 用法: node src/narrative/engine/index.js
 * 环境变量:
 *   NARRATIVE_POLLING_INTERVAL - 轮询间隔（毫秒），默认5000
 *   NARRATIVE_MAX_CONCURRENT - 最大并发任务数，默认1
 *   NARRATIVE_TASK_TIMEOUT - 任务超时时间（毫秒），默认180000
 */

import { NarrativeAnalysisEngine } from './NarrativeAnalysisEngine.mjs';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: '../../config/.env' });

// 从环境变量读取配置
const config = {
  pollingInterval: parseInt(process.env.NARRATIVE_POLLING_INTERVAL || '5000'),
  maxConcurrentTasks: parseInt(process.env.NARRATIVE_MAX_CONCURRENT || '1'),
  taskTimeout: parseInt(process.env.NARRATIVE_TASK_TIMEOUT || '180000')
};

console.log('叙事分析引擎配置:', config);

// 创建引擎实例
const engine = new NarrativeAnalysisEngine(config);

// 优雅退出处理
const shutdown = (signal) => {
  console.log(`\n收到 ${signal} 信号，正在停止引擎...`);
  engine.stop();
  setTimeout(() => {
    console.log('引擎已停止');
    process.exit(0);
  }, 1000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 未捕获的异常处理
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
  engine.stop();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
  engine.stop();
  process.exit(1);
});

// 启动引擎
console.log('正在启动叙事分析引擎...\n');

engine.start().catch(error => {
  console.error('引擎启动失败:', error);
  process.exit(1);
});
