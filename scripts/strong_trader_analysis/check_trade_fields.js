const { AveTxAPI } = require('../../src/core/ave-api');
const config = require('../../config/default.json');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const txApi = new AveTxAPI(config.ave?.apiUrl || 'https://prod.ave-api.com', config.ave?.timeout || 30000, process.env.AVE_API_KEY);

async function checkTradeFields() {
  const expId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取一个信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', expId)
    .eq('token_symbol', '大冤种')
    .limit(1);

  if (!signals || signals.length === 0) {
    console.log('没有找到信号');
    return;
  }

  const signal = signals[0];

  // 获取代币的 main_pair
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('raw_api_data')
    .eq('experiment_id', expId)
    .eq('token_address', signal.token_address)
    .single();

  const mainPair = tokens?.raw_api_data?.main_pair;
  console.log('main_pair:', mainPair);

  if (!mainPair) {
    console.log('没有 main_pair 数据');
    return;
  }

  const toTime = Math.floor(new Date(signal.created_at).getTime() / 1000);
  const fromTime = toTime - 90;

  const trades = await txApi.getSwapTransactions(mainPair + '-bsc', 10, fromTime, toTime, 'asc', 0);
  console.log('获取到 ' + trades.length + ' 条交易');

  if (trades.length > 0) {
    console.log('\n第一条交易字段:');
    console.log(JSON.stringify(trades[0], null, 2));
  }
}

checkTradeFields().catch(console.error);
