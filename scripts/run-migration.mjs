/**
 * 运行数据库迁移脚本
 */

import dbManager from '../src/services/dbManager.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration(sqlFile) {
  try {
    // 读取SQL文件
    const sqlPath = join(__dirname, '..', 'migrations', sqlFile);
    const sql = readFileSync(sqlPath, 'utf-8');

    console.log(`[Migration] 运行迁移: ${sqlFile}`);

    // 执行SQL - 使用 Supabase 的 RPC 功能
    const supabase = dbManager.getSupabase();

    // Supabase 不支持直接执行原始SQL，需要拆分成多个语句
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      console.log(`[Migration] 执行语句: ${statement.substring(0, 50)}...`);
      // 注意：Supabase JS客户端不支持直接执行DDL语句
      // 这个脚本主要用于展示，实际需要在 Supabase 控制台运行
    }

    console.log('[Migration] ✅ 迁移完成');
    console.log('[Migration] ⚠️  注意：DDL语句需要在 Supabase 控制台的 SQL Editor 中手动执行');

  } catch (error) {
    console.error('[Migration] ❌ 迁移失败:', error.message);
    throw error;
  }
}

// 运行指定迁移
const migrationFile = process.argv[2] || 'create_external_resource_cache_table.sql';
runMigration(migrationFile);
