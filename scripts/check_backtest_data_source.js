/**
 * 检查回测实验的数据来源
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查回测实验的数据来源 ===\n');

  const sourceId = '431ffc1c-9b68-491b-8707-08117a1d7b74';
  const exp2Id = '2522cab9-721f-4922-86f9-7484d644e7cc';

  // 获取源实验的 time_series_data 中的所有 token_symbol
  const { data: sourceTimeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('token_symbol, token_address, timestamp')
    .eq('experiment_id', sourceId);

  const sourceTokenSet = new Set(sourceTimeSeries?.map(t => `${t.token_symbol}-${t.token_address}`) || []);
  const sourceSymbols = [...new Set(sourceTimeSeries?.map(t => t.token_symbol) || [])];

  console.log(`源实验 time_series_data 中有 ${sourceSymbols.length} 个不同的代币符号`);
  console.log(`源实验 time_series_data 中有 ${sourceTokenSet.size} 个代币-地址组合\n`);

  // 打印源实验中的代币
  console.log('源实验中的代币符号:');
  sourceSymbols.sort();
  sourceSymbols.forEach(s => console.log(`  - ${s}`));

  // 获取实验2的第一个 buy signal 来检查其数据结构
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查实验2的 signal metadata】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: exp2Signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', exp2Id)
    .eq('action', 'buy')
    .eq('executed', true)
    .order('timestamp', { ascending: true })
    .limit(1);

  if (exp2Signals && exp2Signals.length > 0) {
    const signal = exp2Signals[0];
    console.log(`第一个买入信号:`);
    console.log(`  token_symbol: ${signal.token_symbol}`);
    console.log(`  token_address: ${signal.token_address}`);
    console.log(`  timestamp: ${signal.timestamp}`);

    // 检查 metadata 中的 key
    console.log(`\nmetadata keys:`);
    if (signal.metadata) {
      Object.keys(signal.metadata).forEach(key => {
        const value = signal.metadata[key];
        if (typeof value === 'object') {
          console.log(`  ${key}: [object] (${Object.keys(value).length} keys)`);
        } else {
          console.log(`  ${key}: ${value}`);
        }
      });
    }
  }

  // 检查实验2的代币是否在源实验的 time_series_data 中
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查实验2的代币地址是否在源实验 time_series_data 中】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: exp2Trades } = await supabase
    .from('trades')
    .select('token_symbol, token_address')
    .eq('experiment_id', exp2Id)
    .eq('trade_direction', 'buy');

  const exp2TokenAddresses = [...new Set(exp2Trades?.map(t => `${t.token_symbol}-${t.token_address}`) || [])];

  let inSource = 0;
  let notInSource = 0;

  for (const combo of exp2TokenAddresses) {
    if (sourceTokenSet.has(combo)) {
      inSource++;
    } else {
      notInSource++;
      const [symbol, address] = combo.split('-');
      console.log(`不在源实验中: ${symbol} (${address.slice(0, 10)}...)`);
    }
  }

  console.log(`\n在源实验中: ${inSource} 个代币-地址组合`);
  console.log(`不在源实验中: ${notInSource} 个代币-地址组合`);
}

main().catch(console.error);
