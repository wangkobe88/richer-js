require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkEarlyReturn() {
  const experimentId = '5aadb32a-37bb-419c-93d3-10818737426e';

  // 查询时序数据，看看价格相关字段
  const { data: timeSeries, error } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('timestamp', { ascending: false })
    .limit(20);

  if (error) {
    console.log('查询错误:', error.message);
    return;
  }

  console.log('时序数据分析（最新20条）:\n');

  for (let i = 0; i < Math.min(timeSeries.length, 10); i++) {
    const ts = timeSeries[i];
    const factors = ts.factor_values || {};

    console.log(`${i + 1}. ${ts.token_symbol || '(null)'}`);
    console.log(`   时间: ${ts.timestamp}`);
    console.log(`   状态: ${ts.status}`);
    console.log(`   factor_values:`);
    console.log(`     age: ${factors.age}`);
    console.log(`     earlyReturn: ${factors.earlyReturn}`);
    console.log(`     currentPrice: ${factors.currentPrice}`);
    console.log(`     collectionPrice: ${factors.collectionPrice}`);
    console.log(`     holders: ${factors.holders}`);
    console.log(`     tvl: ${factors.tvl}`);
    console.log('');
  }
}

checkEarlyReturn().catch(console.error);
