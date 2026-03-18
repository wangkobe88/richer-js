/**
 * 将人工标注信息添加到 llm_cache.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_PATH = path.resolve(__dirname, 'data/llm_cache.json');
const HUMAN_PATH = path.resolve(__dirname, '../data/human_machine_comparison.json');
const OUTPUT_PATH = path.resolve(__dirname, 'data/llm_cache_with_human.json');

// 加载数据
const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
const humanData = JSON.parse(fs.readFileSync(HUMAN_PATH, 'utf-8'));

// 构建人工标注映射 (使用 symbol 作为 key)
const humanAnnotations = new Map();
for (const [category, tokens] of Object.entries(humanData.details)) {
  for (const t of tokens) {
    humanAnnotations.set(t.token, {
      category: t.human,
      machineCategory: t.machine,
      machineScore: t.machineScore,
      classification: category  // 记录这个代币在哪个分类中
    });
  }
}

// 更新缓存
let addedCount = 0;
let matchedCount = 0;

for (const [key, value] of Object.entries(cache)) {
  const humanInfo = humanAnnotations.get(value.symbol);
  if (humanInfo) {
    value.humanAnnotation = {
      category: humanInfo.category,
      classification: humanInfo.classification
    };
    addedCount++;
    matchedCount++;
  } else {
    // 没有人工标注的代币
    value.humanAnnotation = null;
  }
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('           添加人工标注信息到 LLM Cache');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log(`总缓存条目: ${Object.keys(cache).length} 个`);
console.log(`已添加人工标注: ${addedCount} 个`);
console.log(`无人工标注: ${Object.keys(cache).length - matchedCount} 个\n`);

// 统计人工标注分布
const humanStats = { high_quality: 0, mid_quality: 0, low_quality: 0 };
for (const value of Object.values(cache)) {
  if (value.humanAnnotation?.category) {
    humanStats[value.humanAnnotation.category]++;
  }
}

console.log('人工标注分布:');
console.log(`  high_quality: ${humanStats.high_quality} 个`);
console.log(`  mid_quality: ${humanStats.mid_quality} 个`);
console.log(`  low_quality: ${humanStats.low_quality} 个\n`);

// 保存更新后的缓存
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cache, null, 2));
console.log(`💾 已保存到: ${OUTPUT_PATH}`);

// 备份原文件并替换
const backupPath = CACHE_PATH + '.backup';
fs.copyFileSync(CACHE_PATH, backupPath);
fs.copyFileSync(OUTPUT_PATH, CACHE_PATH);
console.log(`💾 原文件已备份到: ${backupPath}`);
console.log(`💾 已更新原文件: ${CACHE_PATH}`);
