/**
 * 叙事分析引擎配置加载模块
 * 统一从 config/narrative-engine.json 读取配置
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量（确保能找到项目根目录的 .env）
dotenv.config({ path: resolve(__dirname, '../../../config/.env') });

let configCache = null;

/**
 * 加载配置文件
 * @returns {Object} 配置对象
 */
function loadConfig() {
  if (configCache) {
    return configCache;
  }

  // 配置文件路径：从 src/narrative/engine/ 到项目根目录的 config/narrative-engine.json
  // 使用绝对路径，确保无论从哪里调用都能正确找到
  const projectRoot = resolve(__dirname, '../../..');
  const configPath = resolve(projectRoot, 'config/narrative-engine.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`配置文件不存在: ${configPath}`);
  }

  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    configCache = JSON.parse(configContent);
    return configCache;
  } catch (error) {
    throw new Error(`加载配置文件失败: ${error.message}`);
  }
}

/**
 * 获取 API 配置
 * @returns {Object} { baseUrl, envKeyName }
 */
export function getApiConfig() {
  const config = loadConfig();
  return config.api || {};
}

/**
 * 获取引擎配置
 * @returns {Object} { maxConcurrency, pollingInterval, taskTimeout, maxRetries }
 */
export function getEngineConfig() {
  const config = loadConfig();
  return config.engine || {};
}

/**
 * 获取模型配置
 * @param {string} modelType - 'primary' 或 'fallback'
 * @returns {Object} { name, stage1Timeout, stage2Timeout, parameters }
 */
export function getModelConfig(modelType = 'primary') {
  const config = loadConfig();
  return config.models?.[modelType] || null;
}

/**
 * 获取主模型配置
 * @returns {Object}
 */
export function getPrimaryModelConfig() {
  return getModelConfig('primary');
}

/**
 * 获取备用模型配置
 * @returns {Object}
 */
export function getFallbackModelConfig() {
  return getModelConfig('fallback');
}

/**
 * 清除配置缓存（用于测试或重新加载配置）
 */
export function clearConfigCache() {
  configCache = null;
}

/**
 * 获取完整配置
 * @returns {Object}
 */
export function getConfig() {
  return loadConfig();
}
