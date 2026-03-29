/**
 * 叙事分析引擎主模块
 *
 * 注意：此文件假设环境变量已在 start.mjs 中预先加载
 * 不要直接运行此文件，请使用 start.mjs
 */

import { NarrativeAnalysisEngine } from './NarrativeAnalysisEngine.mjs';

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
