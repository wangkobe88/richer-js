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

// 步骤1: 获取时序数据中的代币地址
console.log('步骤1: 获取时序数据中的代币地址...');
const { data: timeSeriesData, error: tsError } = await supabase
  .from('experiment_time_series_data')
  .select('token_address')
  .eq('experiment_id', experimentId);

if (tsError) {
  console.error('❌ 获取时序数据失败:', tsError);
  process.exit(1);
}

console.log(`   时序数据记录数: ${timeSeriesData.length}`);
const uniqueTokensFromTS = [...new Set(timeSeriesData.map(d => d.token_address))];
console.log(`   时序数据中唯一代币数: ${uniqueTokensFromTS.length}\n`);

// 步骤2: 获取代币表中的代币地址
console.log('步骤2: 获取代币表中的代币地址...');
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

// 步骤3: 找出孤儿数据
console.log('步骤3: 检查孤儿数据...');
const orphans = uniqueTokensFromTS.filter(addr => !tokensInTable.has(addr));

if (orphans.length === 0) {
  console.log('✅ 没有发现孤儿数据!\n');
  console.log(`📊 统计:`);
  console.log(`   - 时序数据记录: ${timeSeriesData.length} 条`);
  console.log(`   - 时序数据中代币: ${uniqueTokensFromTS.length} 个`);
  console.log(`   - 代币表中的代币: ${tokenData.length} 个`);
  console.log(`   - 孤儿代币: 0 个`);
} else {
  console.log(`❌ 发现 ${orphans.length} 个孤儿代币:\n`);
  orphans.slice(0, 10).forEach(addr => {
    const count = timeSeriesData.filter(d => d.token_address === addr).length;
    console.log(`   - ${addr}: ${count} 条时序记录`);
  });
  if (orphans.length > 10) {
    console.log(`   ... 还有 ${orphans.length - 10} 个`);
  }
}
