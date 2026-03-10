/**
 * 分析时间线：为什么旧实验只加载了部分数据
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeTimeline() {
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  console.log('=== 分析时间线 ===\n');

  // 获取三个实验的创建时间
  const { data: experiments } = await supabase
    .from('experiments')
    .select('id, created_at, name, status')
    .in('id', [newExpId, oldExpId, sourceExpId]);

  experiments.forEach(exp => {
    const type = exp.id === sourceExpId ? '源实验' : (exp.id === oldExpId ? '旧回测' : '新回测');
    console.log(`${type}:`);
    console.log(`  ID: ${exp.id}`);
    console.log(`  创建时间: ${exp.created_at}`);
    console.log(`  状态: ${exp.status}`);
    console.log('');
  });

  // 按时间排序
  const sorted = [...experiments].sort((a, b) => 
    new Date(a.created_at) - new Date(b.created_at)
  );

  console.log('时间顺序:');
  sorted.forEach((exp, i) => {
    const type = exp.id === sourceExpId ? '源实验' : (exp.id === oldExpId ? '旧回测' : '新回测');
    console.log(`  ${i + 1}. ${type}: ${exp.created_at}`);
  });

  // 检查源实验在不同时间点的数据量
  console.log('\n源实验数据量变化:');

  const { data: sourceSignals } = await supabase
    .from('strategy_signals')
    .select('created_at')
    .eq('experiment_id', sourceExpId)
    .order('created_at', { ascending: true });

  const { data: sourceTimeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp')
    .eq('experiment_id', sourceExpId)
    .order('timestamp', { ascending: true });

  console.log(`  strategy_signals: ${sourceSignals?.length || 0} 条`);
  console.log(`  第一个信号时间: ${sourceSignals?.[0]?.created_at || '无'}`);
  console.log(`  最后一个信号时间: ${sourceSignals?.[sourceSignals.length - 1]?.created_at || '无'}`);
  
  console.log(`  time_series_data: ${sourceTimeSeries?.length || 0} 条（查询限制）`);
  console.log(`  第一条数据时间: ${sourceTimeSeries?.[0]?.timestamp || '无'}`);
  console.log(`  最后一条数据时间: ${sourceTimeSeries?.[sourceTimeSeries.length - 1]?.timestamp || '无'}`);

  // 关键问题
  console.log('\n=== 关键问题 ===');
  
  const oldExpTime = new Date(experiments.find(e => e.id === oldExpId)?.created_at).getTime();
  const newExpTime = new Date(experiments.find(e => e.id === newExpId)?.created_at).getTime();
  const sourceFirstDataTime = new Date(sourceTimeSeries?.[0]?.timestamp || 0).getTime();
  const sourceLastDataTime = new Date(sourceTimeSeries?.[sourceTimeSeries.length - 1]?.timestamp || 0).getTime();

  console.log('旧回测创建时，源实验的数据情况:');
  console.log(`  旧回测创建: ${new Date(oldExpTime).toLocaleString()}`);
  console.log(`  源实验第一条数据: ${new Date(sourceFirstDataTime).toLocaleString()}`);
  console.log(`  源实验最后一条数据（前1000）: ${new Date(sourceLastDataTime).toLocaleString()}`);
  
  if (oldExpTime < sourceLastDataTime) {
    console.log(`  ⚠️  旧回测创建时，源实验还在运行中`);
    console.log(`     所以旧回测只看到了部分数据`);
  }

  console.log('');
  console.log('新回测创建时，源实验的数据情况:');
  console.log(`  新回测创建: ${new Date(newExpTime).toLocaleString()}`);
  
  if (newExpTime > sourceLastDataTime) {
    console.log(`  ✓ 新回测创建时，源实验可能已停止`);
    console.log(`     但由于查询限制，仍然可能只看到部分数据`);
  }
}

analyzeTimeline().catch(console.error);
