/**
 * 检查源实验中监控的代币数量
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查源实验数据 ===\n');

  const sourceId = '431ffc1c-9b68-491b-8707-08117a1d7b74';

  // 获取源实验中监控的代币
  const { data: sourceTokens, count } = await supabase
    .from('experiment_tokens')
    .select('token_symbol, token_address', { count: 'exact' })
    .eq('experiment_id', sourceId);

  console.log(`源实验中监控的代币数量: ${count || 0}`);

  // 获取那14个只在实验2中的代币地址
  const onlyInExp2 = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  console.log('\n检查这14个代币是否在源实验的 experiment_tokens 中:');
  const foundInSource = [];
  const notFoundInSource = [];

  for (const symbol of onlyInExp2) {
    const tokens = sourceTokens?.filter(t => t.token_symbol === symbol) || [];
    if (tokens.length > 0) {
      foundInSource.push(symbol);
      console.log(`  ${symbol}: 在 (${tokens.length} 个地址)`);
    } else {
      notFoundInSource.push(symbol);
      console.log(`  ${symbol}: 不在`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【关键发现】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`在源实验中的代币: ${foundInSource.length} 个`);
  console.log(`不在源实验中的代币: ${notFoundInSource.length} 个`);

  if (notFoundInSource.length > 0) {
    console.log('\n不在源实验中的代币: ' + notFoundInSource.join(', '));
    console.log('\n这说明这些代币在回测时根本不在源实验的监控范围内，所以实验1没有处理它们。');
  }

  // 检查是否是因为回测时间范围不同
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查回测时间范围】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 获取源实验的开始和结束时间
  const { data: sourceExp } = await supabase
    .from('experiments')
    .select('created_at, updated_at')
    .eq('id', sourceId)
    .single();

  if (sourceExp) {
    console.log(`源实验创建时间: ${sourceExp.created_at ? new Date(sourceExp.created_at).toLocaleString('zh-CN') : 'N/A'}`);
    console.log(`源实验更新时间: ${sourceExp.updated_at ? new Date(sourceExp.updated_at).toLocaleString('zh-CN') : 'N/A'}`);
  }

  // 获取那14个代币在源实验中首次出现的时间
  if (foundInSource.length > 0) {
    console.log('\n那14个代币在源实验中的时间范围:');
    for (const symbol of foundInSource) {
      const tokens = sourceTokens?.filter(t => t.token_symbol === symbol) || [];
      if (tokens.length > 0) {
        const address = tokens[0].token_address;
        const { data: timeSeries } = await supabase
          .from('experiment_time_series_data')
          .select('timestamp')
          .eq('experiment_id', sourceId)
          .eq('token_address', address)
          .order('timestamp', { ascending: true })
          .limit(1);

        if (timeSeries && timeSeries.length > 0) {
          console.log(`  ${symbol}: ${new Date(timeSeries[0].timestamp).toLocaleString('zh-CN')}`);
        }
      }
    }
  }
}

main().catch(console.error);
