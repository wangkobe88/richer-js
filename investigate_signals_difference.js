/**
 * 调查为什么新增代币在旧实验中没有信号
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function investigateSignalsDifference() {
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  console.log('=== 调查信号差异 ===\n');

  // 1. 检查源实验中这些代币的数据
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

  // 检查源实验中这些代币的数据
  console.log('1. 检查源实验中这些代币的数据\n');

  const { data: sourceData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', sourceExpId);

  console.log('源实验中时间序列数据总数:', sourceData.length);

  const sourceTokens = new Set();
  sourceData.forEach(d => {
    if (d.token_address) {
      sourceTokens.add(d.token_address);
    }
  });

  console.log('源实验中发现的代币数量:', sourceTokens.size);

  console.log('\n新增代币在源实验中的数据:');
  console.log('代地址                              | 数据点数 | 第一个数据点时间');
  console.log('-------------------------------------|----------|------------------');

  for (const token of addedTokens) {
    const tokenData = sourceData.filter(d => d.token_address === token);
    if (tokenData.length > 0) {
      const firstDataPoint = tokenData.sort((a, b) => a.timestamp - b.timestamp)[0];
      console.log(`${token} | ${tokenData.length.toString().padStart(8)} | ${new Date(firstDataPoint.timestamp * 1000).toLocaleString()}`);
    } else {
      console.log(`${token} | ${'无数据'.padStart(8)} | -`);
    }
  }

  // 2. 检查旧实验的配置
  console.log('\n2. 检查两个回测实验的配置差异\n');

  const { data: experiments } = await supabase
    .from('experiments')
    .select('id, config, created_at')
    .in('id', [newExpId, oldExpId]);

  const newExp = experiments.find(e => e.id === newExpId);
  const oldExp = experiments.find(e => e.id === oldExpId);

  console.log('新实验配置:');
  console.log('  创建时间:', newExp.created_at);
  console.log('  策略配置:', JSON.stringify(newExp.config?.strategies || {}, null, 2));

  console.log('\n旧实验配置:');
  console.log('  创建时间:', oldExp.created_at);
  console.log('  策略配置:', JSON.stringify(oldExp.config?.strategies || {}, null, 2));

  // 3. 检查源实验的完整数据
  console.log('\n3. 检查源实验的完整信息\n');

  const { data: sourceExp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', sourceExpId)
    .single();

  console.log('源实验信息:');
  console.log('  ID:', sourceExp.id);
  console.log('  名称:', sourceExp.name);
  console.log('  状态:', sourceExp.status);
  console.log('  模式:', sourceExp.mode);
  console.log('  开始时间:', sourceExp.started_at);
  console.log('  结束时间:', sourceExp.ended_at);

  // 检查源实验中有多少代币
  const { data: sourceTokensData } = await supabase
    .from('experiment_tokens')
    .select('token_address')
    .eq('experiment_id', sourceExpId);

  console.log('  发现代币数:', sourceTokensData?.length || 0);

  // 4. 比较两个回测实验处理的数据点数量
  console.log('\n4. 比较两个回测实验处理的数据\n');

  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('token_address')
    .eq('experiment_id', newExpId);

  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('token_address')
    .eq('experiment_id', oldExpId);

  const newSignalTokens = new Set(newSignals.map(s => s.token_address));
  const oldSignalTokens = new Set(oldSignals.map(s => s.token_address));

  console.log('新实验有信号的代币数:', newSignalTokens.size);
  console.log('旧实验有信号的代币数:', oldSignalTokens.size);
  console.log('仅在旧实验中有信号的代币数:', Array.from(oldSignalTokens).filter(t => !newSignalTokens.has(t)).length);
  console.log('仅在新实验中有信号的代币数:', Array.from(newSignalTokens).filter(t => !oldSignalTokens.has(t)).length);

  // 5. 检查是否是时间窗口问题
  console.log('\n5. 检查时间窗口问题\n');

  // 检查1$代币在源实验中的数据
  const dollarToken = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const dollarSourceData = sourceData.filter(d => d.token_address === dollarToken);

  if (dollarSourceData.length > 0) {
    dollarSourceData.sort((a, b) => a.timestamp - b.timestamp);
    console.log('1$ 代币在源实验中:');
    console.log('  数据点数:', dollarSourceData.length);
    console.log('  第一个数据点:', new Date(dollarSourceData[0].timestamp * 1000).toLocaleString());
    console.log('  最后一个数据点:', new Date(dollarSourceData[dollarSourceData.length - 1].timestamp * 1000).toLocaleString());
    console.log('  第一个数据点的age:', dollarSourceData[0].age, '分钟');
    console.log('  第一个数据点的earlyReturn:', dollarSourceData[0].early_return, '%');

    // 检查earlyReturn阈值
    console.log('\n  earlyReturn变化趋势:');
    dollarSourceData.slice(0, 10).forEach((d, i) => {
      console.log(`    ${i + 1}. age:${d.age?.toFixed(1)}min earlyReturn:${d.early_return?.toFixed(1)}%`);
    });
  } else {
    console.log('1$ 代币在源实验中没有数据');
  }
}

investigateSignalsDifference().catch(console.error);
