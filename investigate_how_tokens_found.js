/**
 * 调查新增代币是如何被发现并生成信号的
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function investigateHowTokensFound() {
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  // 新增代币列表（在旧实验中没执行的代币）
  const addedTokens = [
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff',
    '0x7a8c4f9097ca55b66527f12ad8e4824602dc4444',
    '0x67af02b5e5624da2bbafe9621e42fb54cc094444',
    '0x3217f78a55d544667538524f3b56f9d098304444',
    '0x2bf6635545fd2a908d7912537fbb8584c51f4444',
    '0xa322f68af1dd4078d0e72998921f546391274444',
    '0xfbbf59bc00815b8fae78ff0bb136fae20f594444',
    '0xc3ca235bb3ac1bb951ce2833a9c8525f524e4444',
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444',
    '0x4240cf814aa7b0b30c308e7daaeae4f465c94444',
    '0x0f14933b0ccad8d31cb7ffb457667f919a6f4444',
    '0x340b4bb0ca122f949b2a32f5caf0fe0803324444'
  ];

  console.log('=== 调查新增代币的数据来源 ===\n');

  // 1. 重新检查这些代币在源实验的 experiment_time_series_data 中的数据
  console.log('1. 检查新增代币在源实验时间序列数据中的情况\n');

  for (const token of addedTokens) {
    const { data: tokenData } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token);

    if (tokenData && tokenData.length > 0) {
      console.log(`✓ ${token.substring(0, 10)}... : ${tokenData.length} 条数据点`);
    } else {
      console.log(`✗ ${token.substring(0, 10)}... : 无数据`);
    }
  }

  // 2. 统计有多少新增代币在时间序列数据中有记录
  console.log('\n2. 统计新增代币在时间序列数据中的覆盖情况\n');

  let tokensWithData = 0;
  let tokensWithoutData = 0;

  for (const token of addedTokens) {
    const { data: tokenData } = await supabase
      .from('experiment_time_series_data')
      .select('id')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token)
      .limit(1);

    if (tokenData && tokenData.length > 0) {
      tokensWithData++;
    } else {
      tokensWithoutData++;
    }
  }

  console.log('有时间序列数据:', tokensWithData, '个');
  console.log('无时间序列数据:', tokensWithoutData, '个');

  // 3. 检查新实验的信号是从哪里来的
  console.log('\n3. 检查新实验中这些代币的第一个信号的详细信息\n');

  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', newExpId);

  console.log('前3个新增代币的信号详情:');
  console.log('');

  for (const token of addedTokens.slice(0, 3)) {
    const tokenSignals = newSignals
      .filter(s => s.token_address === token)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    if (tokenSignals.length > 0) {
      const first = tokenSignals[0];
      console.log(`代币: ${token}`);
      console.log('  信号创建时间:', first.created_at);
      console.log('  数据时间戳:', first.metadata?.timestamp);

      // 检查是否有 factor_values（这来自时间序列数据）
      if (first.metadata?.factor_values) {
        console.log('  有 factor_values: 是（来自时间序列数据）');
      } else {
        console.log('  有 factor_values: 否');
      }

      // 检查 trendFactors
      if (first.metadata?.trendFactors) {
        console.log('  有 trendFactors: 是');
      } else {
        console.log('  有 trendFactors: 否');
      }

      console.log('');
    }
  }

  // 4. 检查源实验的 strategy_signals 表
  console.log('4. 检查源实验中这些代币的信号情况\n');

  const { data: sourceSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', sourceExpId);

  console.log('源实验中新增代币的信号数:');
  console.log('');

  for (const token of addedTokens) {
    const tokenSignals = sourceSignals.filter(s => s.token_address === token);
    console.log(`  ${token.substring(0, 10)}... : ${tokenSignals.length} 个信号`);
  }

  // 5. 关键检查：源实验时间序列数据是否真的只有这些代币
  console.log('\n5. 检查源实验时间序列数据的完整性\n');

  const { data: allTimeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('token_address')
    .eq('experiment_id', sourceExpId);

  const allTokensInTimeSeries = new Set();
  allTimeSeriesData?.forEach(d => allTokensInTimeSeries.add(d.token_address));

  console.log('源实验时间序列数据中的代币数:', allTokensInTimeSeries.size);

  // 检查新增代币中有多少在时间序列数据中
  const addedTokensInTimeSeries = addedTokens.filter(t => allTokensInTimeSeries.has(t));
  console.log('新增代币中在时间序列数据中的:', addedTokensInTimeSeries.length, '/', addedTokens.length);

  if (addedTokensInTimeSeries.length === addedTokens.length) {
    console.log('\n✓ 所有新增代币都在源实验的时间序列数据中！');
    console.log('  那么之前查询显示"无数据"可能是查询方式有问题');
  } else {
    console.log('\n✗ 部分新增代币不在源实验的时间序列数据中');
    console.log('  这是真的问题：这些代币的数据从哪里来的？');
  }
}

investigateHowTokensFound().catch(console.error);
