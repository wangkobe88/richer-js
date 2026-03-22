import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '../config/.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const experimentId = '72667aab-043b-4b5c-9a2d-027fd1101af0';

console.log(`🧹 清理实验 ${experimentId} 的孤儿时序数据...\n`);

// 获取所有时序数据中的代币地址
console.log('步骤1: 获取时序数据中的代币地址...');
let allTimeSeriesData = [];
let from = 0;
const pageSize = 1000;
let hasMore = true;

while (hasMore) {
  const { data, error } = await supabase
    .from('experiment_time_series_data')
    .select('token_address')
    .eq('experiment_id', experimentId)
    .range(from, from + pageSize - 1);
  
  if (error) {
    console.error('❌ 获取时序数据失败:', error);
    process.exit(1);
  }
  
  if (data.length === 0) {
    hasMore = false;
  } else {
    allTimeSeriesData.push(...data);
    from += pageSize;
    hasMore = data.length === pageSize;
    if (allTimeSeriesData.length % 10000 === 0) {
      console.log(`   已获取 ${allTimeSeriesData.length} 条记录...`);
    }
  }
}

console.log(`   时序数据记录总数: ${allTimeSeriesData.length}`);
const uniqueTokensFromTS = [...new Set(allTimeSeriesData.map(d => d.token_address))];
console.log(`   时序数据中唯一代币数: ${uniqueTokensFromTS.length}\n`);

// 获取代币表中的代币
console.log('步骤2: 获取代币表中的代币...');
const { data: tokenData, error: tokenError } = await supabase
  .from('experiment_tokens')
  .select('token_address')
  .eq('experiment_id', experimentId);

if (tokenError) {
  console.error('❌ 获取代币数据失败:', tokenError);
  process.exit(1);
}

console.log(`   代币表记录数: ${tokenData.length}\n`);
const tokensInTable = new Set(tokenData.map(t => t.token_address));

// 找出孤儿代币
console.log('步骤3: 识别孤儿代币...');
const orphans = uniqueTokensFromTS.filter(addr => !tokensInTable.has(addr));
console.log(`   发现 ${orphans.length} 个孤儿代币\n`);

// 统计孤儿数据量
const orphanRecordCount = allTimeSeriesData.filter(d => !tokensInTable.has(d.token_address)).length;
console.log(`   孤儿代币占用: ${orphanRecordCount} 条时序记录\n`);

// 确认删除
console.log(`📊 清理计划:`);
console.log(`   删除孤儿代币: ${orphans.length} 个`);
console.log(`   删除时序记录: ${orphanRecordCount} 条`);
console.log(`   保留有效代币: ${tokensInTable.size} 个`);
console.log(`   保留有效记录: ${allTimeSeriesData.length - orphanRecordCount} 条\n`);

console.log('⚠️ 准备删除孤儿数据，5秒后开始...');
await new Promise(resolve => setTimeout(resolve, 5000));

// 分批删除孤儿时序数据
console.log('\n步骤4: 分批删除孤儿时序数据...');
const deleteBatchSize = 100;
let deletedCount = 0;

for (let i = 0; i < orphans.length; i += deleteBatchSize) {
  const batch = orphans.slice(i, i + deleteBatchSize);
  
  const { error: deleteError } = await supabase
    .from('experiment_time_series_data')
    .delete()
    .in('token_address', batch)
    .eq('experiment_id', experimentId);

  if (deleteError) {
    console.error(`❌ 批次 ${Math.floor(i/deleteBatchSize) + 1} 删除失败: ${deleteError.message}`);
  } else {
    deletedCount += batch.length;
    console.log(`✅ 已删除 ${deletedCount}/${orphans.length} 个孤儿代币的时序数据`);
  }
}

console.log('\n✅ 清理完成!');
console.log(`   删除孤儿代币: ${deletedCount} 个`);
console.log(`   删除时序记录约: ${orphanRecordCount} 条`);
