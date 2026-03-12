/**
 * 检查源实验的详细配置
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查源实验详细信息 ===\n');

  const sourceId = '431ffc1c-9b68-491b-8707-08117a1d7b74';

  // 获取源实验的完整信息
  const { data: sourceExp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (!sourceExp) {
    console.log('源实验不存在');
    return;
  }

  console.log('源实验基本信息:');
  console.log(`  ID: ${sourceExp.id}`);
  console.log(`  Name: ${sourceExp.name || 'N/A'}`);
  console.log(`  Mode: ${sourceExp.mode || 'N/A'}`);
  console.log(`  Type: ${sourceExp.type || 'N/A'}`);
  console.log(`  Status: ${sourceExp.status || 'N/A'}`);
  console.log(`  Created: ${sourceExp.created_at ? new Date(sourceExp.created_at).toLocaleString('zh-CN') : 'N/A'}`);
  console.log(`  Updated: ${sourceExp.updated_at ? new Date(sourceExp.updated_at).toLocaleString('zh-CN') : 'N/A'}`);

  // 检查 config
  if (sourceExp.config) {
    console.log('\nConfig 信息:');
    console.log(`  backtest.sourceExperimentId: ${sourceExp.config.backtest?.sourceExperimentId || 'N/A'}`);
    console.log(`  blockchain: ${sourceExp.config.blockchain || 'N/A'}`);
    console.log(`  strategiesConfig: ${sourceExp.config.strategiesConfig ? '有' : '无'}`);
  }

  // 获取源实验的 trades 数量
  const { data: sourceTrades } = await supabase
    .from('trades')
    .select('id')
    .eq('experiment_id', sourceId);

  console.log(`\n源实验的 trades 数量: ${sourceTrades?.length || 0}`);

  // 获取源实验的 experiment_tokens 数量
  const { data: sourceTokens, count: tokenCount } = await supabase
    .from('experiment_tokens')
    .select('token_symbol', { count: 'exact' })
    .eq('experiment_id', sourceId);

  console.log(`源实验的 experiment_tokens 数量: ${tokenCount || 0}`);

  // 获取源实验的 experiment_time_series_data 数量
  const { data: sourceTimeSeries, count: timeSeriesCount } = await supabase
    .from('experiment_time_series_data')
    .select('id', { count: 'exact' })
    .eq('experiment_id', sourceId);

  console.log(`源实验的 experiment_time_series_data 数量: ${timeSeriesCount || 0}`);

  // 检查那14个代币是否在源实验的 experiment_tokens 中
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查那14个代币是否在源实验的 experiment_tokens 中】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const onlyInExp2Symbols = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  const { data: tokensData } = await supabase
    .from('experiment_tokens')
    .select('token_symbol, token_address, discovered_at')
    .eq('experiment_id', sourceId)
    .in('token_symbol', onlyInExp2Symbols);

  if (tokensData && tokensData.length > 0) {
    console.log(`在源实验的 experiment_tokens 中找到 ${tokensData.length} 个代币:`);
    tokensData.forEach(t => {
      console.log(`  ${t.token_symbol}: ${t.token_address.slice(0, 10)}..., discovered_at: ${t.discovered_at ? new Date(t.discovered_at).toLocaleString('zh-CN') : 'N/A'}`);
    });
  } else {
    console.log('那14个代币都不在源实验的 experiment_tokens 中');
  }
}

main().catch(console.error);
