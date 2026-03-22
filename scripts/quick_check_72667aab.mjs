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

console.log(`📊 快速检查实验 ${experimentId}...\n`);

// 使用 estimated count
console.log('步骤1: 统计时序数据量...');
const { count: tsCount, error: tsError } = await supabase
  .from('experiment_time_series_data')
  .select('*', { count: 'estimated', head: true })
  .eq('experiment_id', experimentId);

if (tsError) {
  console.error('❌ 统计失败:', tsError);
} else {
  console.log(`   时序数据(estimated): ${tsCount} 条`);
}

// 统计代币表
console.log('\n步骤2: 统计代币表...');
const { count: tokenCount, error: tokenError } = await supabase
  .from('experiment_tokens')
  .select('*', { count: 'exact', head: true })
  .eq('experiment_id', experimentId);

if (tokenError) {
  console.error('❌ 统计失败:', tokenError);
} else {
  console.log(`   代币记录: ${tokenCount} 个`);
}

// 获取前1000条时序数据检查孤儿
console.log('\n步骤3: 抽查前1000条时序数据...');
const { data: sampleData, error: sampleError } = await supabase
  .from('experiment_time_series_data')
  .select('token_address')
  .eq('experiment_id', experimentId)
  .limit(1000);

if (sampleError) {
  console.error('❌ 抽样失败:', sampleError);
} else {
  const { data: allTokens } = await supabase
    .from('experiment_tokens')
    .select('token_address')
    .eq('experiment_id', experimentId);
  
  const tokenSet = new Set(allTokens.map(t => t.token_address));
  const orphans = new Set();
  sampleData.forEach(d => {
    if (!tokenSet.has(d.token_address)) {
      orphans.add(d.token_address);
    }
  });
  
  console.log(`   样本中孤儿代币: ${orphans.size} 个`);
  const orphanRate = (orphans.size / sampleData.length * 100).toFixed(1);
  console.log(`   估计孤儿率: ${orphanRate}%`);
  
  if (orphans.size > 0) {
    console.log(`   孤儿代币示例:`);
    Array.from(orphans).slice(0, 5).forEach(addr => {
      console.log(`     - ${addr}`);
    });
  }
}

console.log('\n📊 总结:');
console.log(`   时序数据: ~${tsCount} 条`);
console.log(`   代币记录: ${tokenCount} 个`);
console.log(`   平均每代币: ${tsCount && tokenCount ? (tsCount / tokenCount).toFixed(0) : '?'} 条记录`);
