/**
 * 从数据库获取人工标注信息并更新到llm_cache.json
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../config/.env') });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const CACHE_PATH = path.resolve(__dirname, 'data/llm_cache.json');

async function fetchHumanAnnotations() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           从数据库获取人工标注信息');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('📡 查询数据库...');

  // 查询有人工标注的代币
  const { data, error } = await client
    .from('experiment_tokens')
    .select('token_address, token_symbol, human_judges')
    .not('human_judges', 'is', null);

  if (error) {
    console.error('❌ 查询失败:', error);
    throw error;
  }

  console.log(`✅ 获取到 ${data.length} 个有人工标注的代币\n`);

  // 统计分布
  const byQuality = { high_quality: 0, mid_quality: 0, low_quality: 0, fake_pump: 0 };
  for (const t of data) {
    const category = t.human_judges?.category;
    if (category && byQuality[category] !== undefined) {
      byQuality[category]++;
    }
  }

  console.log('人工标注分布:');
  for (const [quality, count] of Object.entries(byQuality)) {
    console.log(`  ${quality}: ${count}个`);
  }
  console.log();

  // 构建映射
  const annotationsMap = new Map();
  for (const t of data) {
    if (t.human_judges && t.human_judges.category) {
      annotationsMap.set(t.token_symbol, {
        category: t.human_judges.category,
        judgeAt: t.human_judges.judge_at,
        note: t.human_judges.note,
        address: t.token_address
      });
    }
  }

  return annotationsMap;
}

async function updateCacheWithHumanAnnotations(annotationsMap) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           更新 llm_cache.json');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 加载缓存
  console.log('📂 加载缓存...');
  const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  console.log(`   已加载 ${Object.keys(cache).length} 个条目\n`);

  // 更新缓存
  let updatedCount = 0;
  let matchedCount = 0;

  for (const [key, value] of Object.entries(cache)) {
    // 按symbol匹配
    const annotation = annotationsMap.get(value.symbol);
    if (annotation) {
      matchedCount++;
      // 检查是否需要更新
      const existingCategory = value.humanAnnotation?.category;
      if (existingCategory !== annotation.category) {
        value.humanAnnotation = {
          category: annotation.category,
          judgeAt: annotation.judgeAt,
          note: annotation.note
        };
        updatedCount++;
      }
    } else {
      // 清除旧的人工标注（如果有）
      if (value.humanAnnotation) {
        delete value.humanAnnotation;
      }
    }
  }

  console.log(`匹配的代币: ${matchedCount} 个`);
  console.log(`更新的代币: ${updatedCount} 个\n`);

  // 统计更新后的分布
  const byQuality = {};
  for (const value of Object.values(cache)) {
    if (value.humanAnnotation?.category) {
      byQuality[value.humanAnnotation.category] = (byQuality[value.humanAnnotation.category] || 0) + 1;
    }
  }

  console.log('缓存中的人工标注分布:');
  for (const [quality, count] of Object.entries(byQuality)) {
    console.log(`  ${quality}: ${count}个`);
  }
  console.log();

  // 备份原文件
  const backupPath = CACHE_PATH + '.before_human_update';
  fs.copyFileSync(CACHE_PATH, backupPath);
  console.log(`💾 已备份原文件到: ${backupPath}`);

  // 保存更新后的缓存
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(`💾 已更新缓存: ${CACHE_PATH}\n`);
}

async function main() {
  try {
    const annotationsMap = await fetchHumanAnnotations();
    await updateCacheWithHumanAnnotations(annotationsMap);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('           ✅ 完成！');
    console.log('═══════════════════════════════════════════════════════════════');
  } catch (error) {
    console.error('❌ 错误:', error);
    process.exit(1);
  }
}

main();
