/**
 * 检查信号的完整元数据，看 inner_pair 是从哪里来的
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkInnerPairSource() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  // 获取第一个有 preBuyCheckFactors 的信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (signals && signals.length > 0) {
    const signal = signals[0];
    console.log('=== 第一个信号的完整 metadata ===\n');
    console.log('代币地址:', signal.token_address);
    console.log('符号:', signal.metadata?.symbol);
    console.log('');

    // 打印完整的 metadata（除了某些大字段）
    const metadata = signal.metadata || {};
    for (const [key, value] of Object.entries(metadata)) {
      if (key === 'preBuyCheckFactors' || key === 'trendFactors') {
        console.log(`${key}: [跳过]`);
      } else if (typeof value === 'object') {
        console.log(`${key}:`, JSON.stringify(value));
      } else {
        console.log(`${key}:`, value);
      }
    }

    console.log('\n=== preBuyCheckFactors 中的关键字段 ===');
    const factors = metadata.preBuyCheckFactors;
    if (factors) {
      console.log('earlyTradesChecked:', factors.earlyTradesChecked);
      console.log('earlyTradesTotalCount:', factors.earlyTradesTotalCount);
      console.log('earlyTradesDataFirstTime:', factors.earlyTradesDataFirstTime);
      console.log('earlyTradesDataLastTime:', factors.earlyTradesDataLastTime);
    }

    // 检查时间序列数据表
    console.log('\n=== 检查 experiment_time_series_data ===');
    const { data: timeSeries } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', experimentId)
      .eq('token_address', signal.token_address)
      .limit(1);

    if (timeSeries && timeSeries.length > 0) {
      console.log('找到时间序列数据');
      console.log('inner_pair:', timeSeries[0].inner_pair);
      console.log('chain:', timeSeries[0].chain);
    } else {
      console.log('没有找到时间序列数据');
    }
  } else {
    console.log('没有找到信号');
  }
}

checkInnerPairSource().catch(console.error);
