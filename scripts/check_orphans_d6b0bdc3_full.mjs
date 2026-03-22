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

const experimentId = 'd6b0bdc3-ddbe-4728-ab0c-f248e511c8fa';

console.log(`📊 检查实验 ${experimentId} 的孤儿数据...\n`);

// 步骤1: 获取所有时序数据（分页）
console.log('步骤1: 获取时序数据中的所有代币地址...');
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
    console.log(`   已获取 ${allTimeSeriesData.length} 条记录...`);
  }
}

console.log(`   时序数据记录总数: ${allTimeSeriesData.length}`);
const uniqueTokensFromTS = [...new Set(allTimeSeriesData.map(d => d.token_address))];
console.log(`   时序数据中唯一代币数: ${uniqueTokensFromTS.length}\n`);

// 步骤2: 获取代币表中的所有代币
console.log('步骤2: 获取代币表中的所有代币地址...');
let allTokenData = [];
from = 0;
hasMore = true;

while (hasMore) {
  const { data, error } = await supabase
    .from('experiment_tokens')
    .select('token_address')
    .eq('experiment_id', experimentId)
    .range(from, from + pageSize - 1);
  
  if (error) {
    console.error('❌ 获取代币数据失败:', error);
    process.exit(1);
  }
  
  if (data.length === 0) {
    hasMore = false;
  } else {
    allTokenData.push(...data);
    from += pageSize;
    hasMore = data.length === pageSize;
  }
}

console.log(`   代币表记录总数: ${allTokenData.length}`);
const tokensInTable = new Set(allTokenData.map(t => t.token_address));
console.log(`   代币表中唯一代币数: ${tokensInTable.size}\n`);

// 步骤3: 找出孤儿数据
console.log('步骤3: 检查孤儿数据...');
const orphans = uniqueTokensFromTS.filter(addr => !tokensInTable.has(addr));

if (orphans.length === 0) {
  console.log('✅ 没有发现孤儿数据!\n');
  console.log(`📊 统计:`);
  console.log(`   - 时序数据记录: ${allTimeSeriesData.length} 条`);
  console.log(`   - 时序数据中代币: ${uniqueTokensFromTS.length} 个`);
  console.log(`   - 代币表中的代币: ${tokensInTable.size} 个`);
  console.log(`   - 孤儿代币: 0 个`);
} else {
  console.log(`❌ 发现 ${orphans.length} 个孤儿代币:\n`);
  orphans.slice(0, 20).forEach(addr => {
    const count = allTimeSeriesData.filter(d => d.token_address === addr).length;
    console.log(`   - ${addr}: ${count} 条时序记录`);
  });
  if (orphans.length > 20) {
    console.log(`   ... 还有 ${orphans.length - 20} 个`);
  }
}
