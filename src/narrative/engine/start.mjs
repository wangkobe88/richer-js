/**
 * 叙事分析引擎启动脚本（带环境变量预加载）
 *
 * 这个文件专门用于先加载环境变量，然后再导入实际引擎代码
 * 解决 ESM 模块加载时环境变量尚未设置的问题
 */

// 步骤1: 导入并配置 dotenv（必须在导入任何其他模块之前）
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

// 获取当前模块的目录（ESM 中没有 __dirname）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 使用绝对路径加载环境变量
dotenv.config({ path: resolve(__dirname, '../../../config/.env') });

// 步骤2: 验证环境变量已加载
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量必须设置');
  console.error('请检查 config/.env 文件是否正确配置');
  process.exit(1);
}

// 步骤3: 导入并启动引擎
import('./engine.mjs').catch(err => {
  console.error('❌ 引擎启动失败:', err.message);
  process.exit(1);
});
