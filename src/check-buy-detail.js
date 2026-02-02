/**
 * 检查代币买入的详细数据
 */
require('dotenv').config({ path: '../config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function checkBuyDetail() {
  const experimentId = '95042847-cccd-4316-be03-f172e2885993';
  const tokenSymbol = '活下去';

  console.log(`\n📊 检查代币 "${tokenSymbol}" 的买入详情\n`);

  // 1. 获取买入信号（包含完整metadata）
  console.log('=== 买入信号详情 ===');
  const { data: buySignal } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_symbol', tokenSymbol)
    .eq('signal_type', 'BUY')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (buySignal) {
    console.log(`  创建时间: ${buySignal.created_at}`);
    console.log(`  原因: ${buySignal.reason}`);
    console.log(`  执行: ${buySignal.executed ? '是' : '否'}`);
    console.log(`  Metadata.price: ${buySignal.metadata?.price}`);
    console.log(`  Metadata.earlyReturn: ${buySignal.metadata?.earlyReturn}`);
    console.log(`  Metadata.currentPrice: ${buySignal.metadata?.currentPrice}`);
  }

  // 2. 获取同一时间的时序数据（前后1分钟）
  console.log('\n=== 时序数据（买入时间前后）===');
  const buyTime = new Date('2026-02-02T08:08:16.901Z');
  const startTime = new Date(buyTime.getTime() - 60000); // 前1分钟
  const endTime = new Date(buyTime.getTime() + 60000); // 后1分钟

  const { data: timeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_symbol', tokenSymbol)
    .gte('timestamp', startTime.toISOString())
    .lte('timestamp', endTime.toISOString())
    .order('timestamp', { ascending: true });

  if (timeSeriesData && timeSeriesData.length > 0) {
    timeSeriesData.forEach((d, i) => {
      const price = d.price_usd ? parseFloat(d.price_usd).toExponential(4) : 'N/A';
      const collectionPrice = d.factor_values?.collectionPrice ? parseFloat(d.factor_values.collectionPrice).toExponential(4) : 'N/A';
      const earlyReturn = d.factor_values?.earlyReturn !== undefined ? d.factor_values.earlyReturn.toFixed(2) + '%' : 'N/A';
      const age = d.factor_values?.age !== undefined ? d.factor_values.age.toFixed(2) + 'min' : 'N/A';
      const signal = d.signal_type || '-';
      const timeDiff = ((new Date(d.timestamp) - buyTime) / 1000).toFixed(0) + 's';

      console.log(`  [${i + 1}] ${d.timestamp} (${timeDiff}相对于买入)`);
      console.log(`      价格: ${price} | 收集价格: ${collectionPrice}`);
      console.log(`      earlyReturn: ${earlyReturn} | age: ${age} | 信号: ${signal}`);
    });
  }

  // 3. 获取所有时序数据，找出第一条
  console.log('\n=== 所有时序数据（第一条）===');
  const { data: allTimeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_symbol', tokenSymbol)
    .order('timestamp', { ascending: true })
    .limit(1);

  if (allTimeSeries && allTimeSeries.length > 0) {
    const d = allTimeSeries[0];
    console.log(`  第一条时序数据时间: ${d.timestamp}`);
    console.log(`  价格: ${d.price_usd}`);
    console.log(`  收集价格: ${d.factor_values?.collectionPrice}`);
    console.log(`  earlyReturn: ${d.factor_values?.earlyReturn}%`);
    console.log(`  age: ${d.factor_values?.age}分钟`);
  }
}

checkBuyDetail().catch(console.error);
