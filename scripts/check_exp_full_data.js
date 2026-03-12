/**
 * 使用 supabase client 直接查询实验数据
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 查询实验完整数据 ===\n');

  const { data: experiments, error } = await supabase
    .from('experiments')
    .select('*')
    .in('id', ['209a7796-f955-4d7a-ae21-0902fef3d7cc', '2522cab9-721f-4922-86f9-7484d644e7cc']);

  if (error) {
    console.error('Error:', error);
    return;
  }

  for (const exp of experiments || []) {
    const isExp1 = exp.id === '209a7796-f955-4d7a-ae21-0902fef3d7cc';
    console.log(`${isExp1 ? '实验1' : '实验2'}:`);
    console.log(`  ID: ${exp.id}`);
    console.log(`  Name: ${exp.name || 'N/A'}`);
    console.log(`  Mode: ${exp.mode || 'N/A'}`);
    console.log(`  Type: ${exp.type || 'N/A'}`);

    const config = exp.config;
    if (config) {
      console.log(`  SourceExperimentId: ${config.backtest?.sourceExperimentId || 'N/A'}`);
      console.log(`  BuyStrategies: ${config.strategiesConfig?.buyStrategies?.length || 0}`);
      console.log(`  MaxExecutions: ${config.strategiesConfig?.buyStrategies?.[0]?.maxExecutions || 'N/A'}`);
    }
    console.log('');
  }

  // 检查源实验
  const sourceId = experiments?.[0]?.config?.backtest?.sourceExperimentId;
  if (sourceId) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【源实验信息】');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const { data: sourceExp } = await supabase
      .from('experiments')
      .select('*')
      .eq('id', sourceId)
      .single();

    console.log(`源实验 ID: ${sourceExp?.id}`);
    console.log(`源实验 Name: ${sourceExp?.name || 'N/A'}`);
    console.log(`源实验 Mode: ${sourceExp?.mode || 'N/A'}`);
    console.log(`源实验 Type: ${sourceExp?.type || 'N/A'}`);

    // 获取源实验的 trades
    const { data: sourceTrades } = await supabase
      .from('trades')
      .select('token_symbol, direction, timestamp')
      .eq('experiment_id', sourceId);

    const sourceTokens = [...new Set(sourceTrades?.map(t => t.token_symbol) || [])];
    console.log(`源实验中有 ${sourceTokens.length} 个代币`);
  }
}

main().catch(console.error);
