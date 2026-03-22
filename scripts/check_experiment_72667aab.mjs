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

console.log(`📊 检查实验 ${experimentId} 的数据情况...\n`);

// 步骤1: 获取所有时序数据（分页）
console.log('步骤1: 获取时序数据统计...');
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
  }
}

console.log(`   时序数据记录总数: ${allTimeSeriesData.length}`);

// 统计每个代币的时序记录数
const tokenRecordCounts = {};
allTimeSeriesData.forEach(d => {
  tokenRecordCounts[d.token_address] = (tokenRecordCounts[d.token_address] || 0) + 1;
});
const uniqueTokensFromTS = Object.keys(tokenRecordCounts);
console.log(`   时序数据中唯一代币数: ${uniqueTokensFromTS.length}\n`);

// 步骤2: 获取代币表中的所有代币及其分析结果
console.log('步骤2: 获取代币表数据...');
let allTokenData = [];
from = 0;
hasMore = true;

while (hasMore) {
  const { data, error } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, analysis_results')
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
const tokensInTable = new Map(allTokenData.map(t => [t.token_address, t]));
console.log(`   代币表中唯一代币数: ${tokensInTable.size}\n`);

// 步骤3: 检查孤儿数据
console.log('步骤3: 检查孤儿数据...');
const orphans = uniqueTokensFromTS.filter(addr => !tokensInTable.has(addr));

if (orphans.length === 0) {
  console.log('✅ 没有发现孤儿数据!\n');
} else {
  console.log(`❌ 发现 ${orphans.length} 个孤儿代币:\n`);
  orphans.slice(0, 10).forEach(addr => {
    const count = allTimeSeriesData.filter(d => d.token_address === addr).length;
    console.log(`   - ${addr}: ${count} 条时序记录`);
  });
  if (orphans.length > 10) {
    console.log(`   ... 还有 ${orphans.length - 10} 个`);
  }
  console.log();
}

// 步骤4: 分析剩余代币的涨幅分布
console.log('步骤4: 分析剩余代币的涨幅分布...');
const analysisResults = {
  noAnalysis: 0,
  below50: 0,
  between50and70: 0,
  between70and100: 0,
  between100and150: 0,
  above150: 0
};

// 统计有时序数据的代币的涨幅
const tokensWithTimeSeries = uniqueTokensFromTS.filter(addr => tokensInTable.has(addr));
console.log(`   有时序数据的代币数: ${tokensWithTimeSeries.length}\n`);

console.log('   涨幅分布:');
tokensWithTimeSeries.forEach(addr => {
  const token = tokensInTable.get(addr);
  const analysis = token?.analysis_results;
  
  if (!analysis || analysis.max_change_percent === null || analysis.max_change_percent === undefined) {
    analysisResults.noAnalysis++;
  } else {
    const maxChange = analysis.max_change_percent;
    if (maxChange < 50) analysisResults.below50++;
    else if (maxChange < 70) analysisResults.between50and70++;
    else if (maxChange < 100) analysisResults.between70and100++;
    else if (maxChange < 150) analysisResults.between100and150++;
    else analysisResults.above150++;
  }
});

console.log(`     无分析结果: ${analysisResults.noAnalysis}`);
console.log(`     涨幅 < 50%: ${analysisResults.below50}`);
console.log(`     50% ≤ 涨幅 < 70%: ${analysisResults.between50and70}`);
console.log(`     70% ≤ 涨幅 < 100%: ${analysisResults.between70and100}`);
console.log(`     100% ≤ 涨幅 < 150%: ${analysisResults.between100and150}`);
console.log(`     涨幅 ≥ 150%: ${analysisResults.above150}`);

// 步骤5: 计算平均每代币时序记录数
console.log('\n步骤5: 时序记录统计...');
const recordCounts = Object.values(tokenRecordCounts).sort((a, b) => b - a);
const avgRecords = recordCounts.reduce((a, b) => a + b, 0) / recordCounts.length;
const maxRecords = Math.max(...recordCounts);
const minRecords = Math.min(...recordCounts);

console.log(`   平均每代币时序记录: ${avgRecords.toFixed(1)} 条`);
console.log(`   最多时序记录: ${maxRecords} 条`);
console.log(`   最少时序记录: ${minRecords} 条`);

// 显示时序记录最多的前10个代币
console.log('\n   时序记录最多的前10个代币:');
const topTokens = Object.entries(tokenRecordCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);
topTokens.forEach(([addr, count]) => {
  const token = tokensInTable.get(addr);
  const symbol = token?.token_symbol || '未知';
  const maxChange = token?.analysis_results?.max_change_percent;
  const changeStr = maxChange !== undefined ? `${maxChange.toFixed(1)}%` : '无数据';
  console.log(`     ${symbol} (${addr.slice(0,8)}...): ${count} 条记录, 最大涨幅 ${changeStr}`);
});

// 总结
console.log('\n📊 总结:');
console.log(`   时序数据记录: ${allTimeSeriesData.length} 条`);
console.log(`   时序数据中代币: ${uniqueTokensFromTS.length} 个`);
console.log(`   代币表中代币: ${tokensInTable.size} 个`);
console.log(`   孤儿代币: ${orphans.length} 个`);
console.log(`   有时序数据的代币: ${tokensWithTimeSeries.length} 个`);
console.log(`   平均每代币 ${avgRecords.toFixed(0)} 条时序记录`);
