/**
 * 检查代币买入原因
 */
require('dotenv').config({ path: '../config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function checkTokenBuyReason() {
  const experimentId = '95042847-cccd-4316-be03-f172e2885993';
  const tokenSymbol = '活下去';
  const tokenAddress = 'crpPTO';

  console.log(`\n📊 检查实验 ${experimentId} 中代币 "${tokenSymbol}" (${tokenAddress}) 的买入原因\n`);

  // 1. 获取该代币的时序数据，按时间排序
  console.log('=== 时序数据（前5条）===');
  const { data: timeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_symbol', tokenSymbol)
    .order('timestamp', { ascending: true })
    .limit(5);

  if (timeSeriesData && timeSeriesData.length > 0) {
    timeSeriesData.forEach((d, i) => {
      const price = d.price_usd ? parseFloat(d.price_usd).toExponential(4) : 'N/A';
      const collectionPrice = d.factor_values?.collectionPrice ? parseFloat(d.factor_values.collectionPrice).toExponential(4) : 'N/A';
      const earlyReturn = d.factor_values?.earlyReturn !== undefined ? d.factor_values.earlyReturn.toFixed(2) + '%' : 'N/A';
      const age = d.factor_values?.age !== undefined ? d.factor_values.age.toFixed(2) + 'min' : 'N/A';
      const signal = d.signal_type || '-';
      console.log(`  [${i + 1}] ${d.timestamp}`);
      console.log(`      价格: ${price} | 收集价格: ${collectionPrice}`);
      console.log(`      earlyReturn: ${earlyReturn} | age: ${age} | 信号: ${signal}`);
    });
  }

  // 2. 获取买入信号
  console.log('\n=== 买入信号 ===');
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_symbol', tokenSymbol)
    .eq('signal_type', 'BUY')
    .order('created_at', { ascending: true });

  if (buySignals && buySignals.length > 0) {
    buySignals.forEach((s, i) => {
      console.log(`  [${i + 1}] ${s.created_at}`);
      console.log(`      原因: ${s.reason || '-'}`);
      console.log(`      置信度: ${s.confidence || 'N/A'}`);
      console.log(`      执行: ${s.executed ? '是' : '否'}`);
    });
  } else {
    console.log('  未找到买入信号');
  }

  // 3. 获取交易记录
  console.log('\n=== 交易记录 ===');
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_symbol', tokenSymbol)
    .order('created_at', { ascending: true });

  if (trades && trades.length > 0) {
    trades.forEach((t, i) => {
      const direction = t.direction || 'unknown';
      const amount = t.amount || 'N/A';
      const price = t.price || 'N/A';
      const success = t.success ? '成功' : '失败';
      console.log(`  [${i + 1}] ${t.created_at}`);
      console.log(`      方向: ${direction} | 数量: ${amount} | 价格: ${price} | ${success}`);
    });
  }

  // 4. 检查实验配置
  console.log('\n=== 实验配置（买入策略）===');
  const { data: exp } = await supabase
    .from('experiments')
    .select('config')
    .eq('id', experimentId)
    .single();

  if (exp && exp.config) {
    const strategy = exp.config.strategy || {};
    console.log(`  buyTimeMinutes: ${strategy.buyTimeMinutes !== undefined ? strategy.buyTimeMinutes : '默认1.33'}`);
    console.log(`  earlyReturnMin: ${strategy.earlyReturnMin !== undefined ? strategy.earlyReturnMin : '默认80'}%`);
    console.log(`  earlyReturnMax: ${strategy.earlyReturnMax !== undefined ? strategy.earlyReturnMax : '默认120'}%`);
  }
}

checkTokenBuyReason().catch(console.error);
