/**
 * 调查新增代币的数据来源
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function investigateDataSource() {
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  const addedTokens = [
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff',
    '0x7a8c4f9097ca55b66527f12ad8e4824602dc4444',
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444'
  ];

  console.log('=== 调查新增代币的数据来源 ===\n');

  // 1. 检查这些代币在源实验的 experiment_tokens 表中
  console.log('1. 检查源实验的 experiment_tokens 表\n');

  const { data: sourceTokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', sourceExpId);

  console.log('源实验中 experiment_tokens 总数:', sourceTokens.length);

  console.log('\n新增代币在 experiment_tokens 中的数据:');
  console.log('代币地址                              | 存在 | symbol | created_at');
  console.log('-------------------------------------|------|--------|------------------');

  for (const token of addedTokens) {
    const tokenData = sourceTokens.find(t => t.token_address === token);
    if (tokenData) {
      console.log(`${token} | 是   | ${tokenData.symbol?.padEnd(6)} | ${tokenData.token_created_at}`);
    } else {
      console.log(`${token} | 否   | -       | -`);
    }
  }

  // 2. 检查新实验的信号详情
  console.log('\n2. 检查新实验中这些代币的第一个信号\n');

  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', newExpId);

  for (const token of addedTokens) {
    const tokenSignals = newSignals
      .filter(s => s.token_address === token)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    if (tokenSignals.length > 0) {
      const first = tokenSignals[0];
      console.log(`\n代币: ${token}`);
      console.log('  信号时间:', first.created_at);
      console.log('  timestamp:', first.metadata?.timestamp);

      const trendFactors = first.metadata?.trendFactors;
      if (trendFactors) {
        console.log('  trendFactors:');
        console.log('    age:', trendFactors.age, '分钟');
        console.log('    earlyReturn:', trendFactors.earlyReturn, '%');
        console.log('    currentPrice:', trendFactors.currentPrice);
      }

      const preBuyFactors = first.metadata?.preBuyCheckFactors;
      if (preBuyFactors) {
        console.log('  preBuyCheckFactors:');
        console.log('    earlyTradesTotalCount:', preBuyFactors.earlyTradesTotalCount);
        console.log('    earlyTradesDataFirstTime:', preBuyFactors.earlyTradesDataFirstTime);
        console.log('    earlyTradesDataLastTime:', preBuyFactors.earlyTradesDataLastTime);
      }
    }
  }

  // 3. 检查BacktestEngine加载的数据
  console.log('\n3. 检查回测引擎加载的数据范围\n');

  // 获取新实验所有信号的代币
  const { data: allNewSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', newExpId);

  const newSignalTokens = new Set();
  allNewSignals.forEach(s => {
    newSignalTokens.add(s.token_address);
  });

  // 检查这些代币在源实验哪个表中
  const { data: allSourceData } = await supabase
    .from('experiment_time_series_data')
    .select('token_address')
    .eq('experiment_id', sourceExpId);

  const sourceTimeSeriesTokens = new Set();
  allSourceData.forEach(d => {
    sourceTimeSeriesTokens.add(d.token_address);
  });

  console.log('新实验有信号的代币数:', newSignalTokens.size);
  console.log('源实验有时间序列数据的代币数:', sourceTimeSeriesTokens.size);
  console.log('');

  const onlyInNew = Array.from(newSignalTokens).filter(t => !sourceTimeSeriesTokens.has(t));
  console.log('仅在新实验中有信号但源实验中无时间序列数据的代币数:', onlyInNew.length);

  if (onlyInNew.length > 0) {
    console.log('\n这些代币（前20个）:');
    onlyInNew.slice(0, 20).forEach(t => {
      console.log(' ', t);
    });

    console.log('\n⚠️  关键发现:');
    console.log('  这些代币在新实验中有信号，但源实验的 experiment_time_series_data 表中没有数据');
    console.log('  这可能意味着:');
    console.log('    1. BacktestEngine 从其他表加载了这些代币的数据');
    console.log('    2. 或者回测过程中动态获取了这些代币的数据');
    console.log('    3. 或者时间序列数据有限制（如只取前1000条）');
  }

  // 4. 检查源实验是否有数据限制
  console.log('\n4. 检查源实验的数据限制\n');

  const { data: sourceExp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', sourceExpId)
    .single();

  console.log('源实验配置:');
  console.log('  maxTokensToMonitor:', sourceExp.config?.maxTokensToMonitor);
  console.log('  observationWindow:', sourceExp.config?.observationWindow);
  console.log('  其他配置:', JSON.stringify(sourceExp.config || {}, null, 2));
}

investigateDataSource().catch(console.error);
