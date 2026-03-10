/**
 * 最终调查：两个回测实验的差异
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function finalInvestigation() {
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';

  console.log('=== 最终调查 ===\n');

  // 1. 比较两个实验的完整配置
  const { data: experiments } = await supabase
    .from('experiments')
    .select('*')
    .in('id', [newExpId, oldExpId]);

  console.log('1. 两个回测实验的配置对比\n');

  const newExp = experiments.find(e => e.id === newExpId);
  const oldExp = experiments.find(e => e.id === oldExpId);

  console.log('新实验:');
  console.log('  创建时间:', newExp.created_at);
  console.log('  源实验:', newExp.config?.backtest?.sourceExperimentId);
  console.log('  其他配置:', JSON.stringify(newExp.config?.backtest || {}, null, 2));

  console.log('\n旧实验:');
  console.log('  创建时间:', oldExp.created_at);
  console.log('  源实验:', oldExp.config?.backtest?.sourceExperimentId);
  console.log('  其他配置:', JSON.stringify(oldExp.config?.backtest || {}, null, 2));

  // 2. 检查两个实验创建时间差，以及这段时间内源实验是否有新数据
  console.log('\n2. 时间因素分析\n');

  const newTime = new Date(newExp.created_at).getTime();
  const oldTime = new Date(oldExp.created_at).getTime();
  const timeDiff = (newTime - oldTime) / (1000 * 60); // 分钟

  console.log('旧实验创建时间:', oldExp.created_at);
  console.log('新实验创建时间:', newExp.created_at);
  console.log('时间差:', timeDiff.toFixed(1), '分钟');

  // 3. 检查源实验在这段时间内是否增加了数据
  console.log('\n3. 关键结论\n');

  console.log('⚠️  问题根源分析:');
  console.log('');
  console.log('发现:');
  console.log('  1. 两个回测实验使用相同的源实验');
  console.log('  2. 新实验比旧实验晚创建约3小时');
  console.log('  3. 新实验有87个代币有信号，旧实验只有63个');
  console.log('  4. 新增的24个代币在源实验的 experiment_time_series_data 表中没有数据');
  console.log('');
  console.log('可能的原因:');
  console.log('  A. BacktestEngine 在回测过程中动态获取了实时API数据');
  console.log('  B. 源实验在旧实验创建后、新实验创建前继续运行，收集了更多数据');
  console.log('  C. 两个回测实验使用了不同的 BacktestEngine 版本，行为不同');
  console.log('');
  console.log('需要检查的点:');
  console.log('  - BacktestEngine 是否会调用实时API获取代币数据？');
  console.log('  - EarlyParticipantCheckService 在回测时是否调用AVE API？');
  console.log('  - 源实验在两个回测实验之间是否继续运行？');
}

finalInvestigation().catch(console.error);
