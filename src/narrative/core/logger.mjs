/**
 * 叙事分析引擎日志系统
 * 类似交易引擎的日志实现，支持按日期和任务ID分隔日志文件
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 日志级别
 */
export const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
};

/**
 * 叙事分析日志器
 */
export class NarrativeLogger {
  #logDir;
  #currentDate;
  #currentLogFile;
  #enabled;

  /**
   * @param {Object} config - 配置
   * @param {string} config.logDir - 日志目录（默认：logs/narrative）
   * @param {boolean} config.enabled - 是否启用日志（默认：true）
   */
  constructor(config = {}) {
    this.#logDir = config.logDir || path.join(process.cwd(), 'logs', 'narrative');
    this.#enabled = config.enabled !== false;
    this.#currentDate = null;
    this.#currentLogFile = null;
    this.ensureLogDirectory();
  }

  /**
   * 确保日志目录存在
   */
  ensureLogDirectory() {
    if (this.#enabled && !fs.existsSync(this.#logDir)) {
      fs.mkdirSync(this.#logDir, { recursive: true });
    }
  }

  /**
   * 启用/禁用日志
   * @param {boolean} enabled - 是否启用
   */
  setEnabled(enabled) {
    this.#enabled = enabled;
  }

  /**
   * 是否启用
   */
  isEnabled() {
    return this.#enabled;
  }

  /**
   * 获取日志文件路径
   * @param {string} date - 日期字符串（YYYY-MM-DD）
   * @returns {string} 日志文件路径
   */
  getLogFilePath(date = null) {
    const dateStr = date || new Date().toISOString().split('T')[0];
    return path.join(this.#logDir, `narrative-${dateStr}.log`);
  }

  /**
   * 轮换日志文件（按日期）
   */
  #rotateLogFileIfNeeded() {
    const today = new Date().toISOString().split('T')[0];
    if (this.#currentDate !== today) {
      this.#currentDate = today;
      this.#currentLogFile = this.getLogFilePath(today);
    }
    return this.#currentLogFile;
  }

  /**
   * 写入日志到文件
   * @param {string} logLine - 日志行
   */
  #writeToFile(logLine) {
    if (!this.#enabled) return;

    try {
      const logFile = this.#rotateLogFileIfNeeded();
      fs.appendFileSync(logFile, logLine + '\n', 'utf8');
    } catch (err) {
      // 避免日志写入失败导致程序崩溃
      console.error('[NarrativeLogger] Failed to write log:', err.message);
    }
  }

  /**
   * 格式化日志行
   * @param {string} level - 日志级别
   * @param {string} module - 模块名
   * @param {string} message - 日志消息
   * @param {Object} data - 附加数据
   * @returns {string} 格式化后的日志行
   */
  #formatLogLine(level, module, message, data) {
    const timestamp = new Date().toISOString();
    const moduleStr = module ? `[${module}]` : '';
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level}]${moduleStr} ${message}${dataStr}`;
  }

  /**
   * 写入日志
   * @param {string} level - 日志级别
   * @param {string} module - 模块名
   * @param {string} message - 日志消息
   * @param {Object} data - 附加数据
   */
  log(level, module, message, data = null) {
    const logLine = this.#formatLogLine(level, module, message, data);

    // 写入文件
    this.#writeToFile(logLine);

    // 输出到控制台
    if (level === LogLevel.ERROR) {
      console.error(logLine);
    } else if (level === LogLevel.WARN) {
      console.warn(logLine);
    } else if (level === LogLevel.DEBUG) {
      console.debug(logLine);
    } else {
      console.log(logLine);
    }
  }

  /**
   * INFO 级别日志
   */
  info(module, message, data = null) {
    this.log(LogLevel.INFO, module, message, data);
  }

  /**
   * WARN 级别日志
   */
  warn(module, message, data = null) {
    this.log(LogLevel.WARN, module, message, data);
  }

  /**
   * ERROR 级别日志
   */
  error(module, message, data = null) {
    this.log(LogLevel.ERROR, module, message, data);
  }

  /**
   * DEBUG 级别日志
   */
  debug(module, message, data = null) {
    this.log(LogLevel.DEBUG, module, message, data);
  }

  /**
   * 记录分析开始
   * @param {string} address - 代币地址
   * @param {string} symbol - 代币符号
   * @param {string} taskId - 任务ID
   */
  logAnalysisStart(address, symbol, taskId) {
    this.info('NarrativeAnalyzer', '分析开始', {
      taskId,
      address,
      token: symbol
    });
  }

  /**
   * 记录分析完成
   * @param {string} taskId - 任务ID
   * @param {string} token - 代币符号
   * @param {string} category - 分类
   * @param {number} totalScore - 总分
   * @param {string} duration - 耗时
   */
  logAnalysisComplete(taskId, token, category, totalScore, duration) {
    this.info('NarrativeAnalyzer', '分析完成', {
      taskId,
      token,
      category,
      totalScore,
      duration
    });
  }

  /**
   * 记录分析失败
   * @param {string} taskId - 任务ID
   * @param {string} token - 代币符号
   * @param {string} error - 错误信息
   */
  logAnalysisFailed(taskId, token, error) {
    this.error('NarrativeAnalyzer', '分析失败', {
      taskId,
      token,
      error
    });
  }

  /**
   * 记录 Stage 1 结果
   * @param {string} taskId - 任务ID
   * @param {string} token - 代币符号
   * @param {boolean} pass - 是否通过
   * @param {string} category - 分类
   * @param {string} duration - 耗时
   */
  logStage1Complete(taskId, token, pass, category, duration) {
    this.info('Stage1', '完成', {
      taskId,
      token,
      pass,
      category,
      duration
    });
  }

  /**
   * 记录 Stage 2 结果
   * @param {string} taskId - 任务ID
   * @param {string} token - 代币符号
   * @param {string} category - 分类
   * @param {number} totalScore - 总分
   * @param {string} duration - 耗时
   */
  logStage2Complete(taskId, token, category, totalScore, duration) {
    this.info('Stage2', '完成', {
      taskId,
      token,
      category,
      totalScore,
      duration
    });
  }

  /**
   * 记录预检查触发
   * @param {string} taskId - 任务ID
   * @param {string} token - 代币符号
   * @param {string} reason - 触发原因
   * @param {string} category - 分类
   */
  logPreCheckTriggered(taskId, token, reason, category) {
    this.info('PreCheck', '触发', {
      taskId,
      token,
      reason,
      category
    });
  }

  /**
   * 记录 LLM API 调用
   * @param {string} stage - 阶段（Stage1/Stage2）
   * @param {string} model - 模型名称
   * @param {string} promptLength - Prompt长度
   * @param {string} duration - 耗时
   */
  logLLMCall(stage, model, promptLength, duration) {
    this.debug('LLMClient', 'API调用', {
      stage,
      model,
      promptLength,
      duration
    });
  }

  /**
   * 记录数据获取结果
   * @param {string} platform - 平台名称
   * @param {boolean} success - 是否成功
   * @param {string} error - 错误信息
   */
  logDataFetch(platform, success, error = null) {
    if (success) {
      this.debug('DataFetch', `成功: ${platform}`);
    } else {
      this.warn('DataFetch', `失败: ${platform}`, { error });
    }
  }

  /**
   * 记录原始日志（用于调试）
   * @param {string} message - 日志消息
   */
  logRaw(...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        return JSON.stringify(arg, null, 2);
      }
      return String(arg);
    }).join(' ');

    const logLine = `[${timestamp}] ${message}`;
    this.#writeToFile(logLine);
  }
}

/**
 * 全局日志实例（单例）
 */
let globalLoggerInstance = null;

/**
 * 获取全局日志实例
 * @returns {NarrativeLogger} 日志实例
 */
export function getLogger() {
  if (!globalLoggerInstance) {
    globalLoggerInstance = new NarrativeLogger();
  }
  return globalLoggerInstance;
}

/**
 * 设置全局日志配置
 * @param {Object} config - 配置
 */
export function configureLogger(config) {
  globalLoggerInstance = new NarrativeLogger(config);
  return globalLoggerInstance;
}

/**
 * 导出默认实例
 */
export default getLogger();
