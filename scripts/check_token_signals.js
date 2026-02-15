require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTokenSignals() {
  const experimentId = '3c143a5b-509b-43bc-8464-0fec05a073a2';
  const tokenAddress = '0x29c843390b18bdd4ef6a3894c2949d33ede64444';

  console.log('========================================');
  console.log(`查询实验: ${experimentId}`);
  console.log(`代币地址: ${tokenAddress}`);
  console.log('========================================\n');

  // 1. 查询代币基本信息
  console.log('1. 代币基本信息:');
  const { data: tokenData, error: tokenError } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .single();

  if (tokenError) {
    console.log('  错误:', tokenError.message);
  } else if (tokenData) {
    console.log('  symbol:', tokenData.symbol);
    console.log('  status:', tokenData.status);
    console.log('  creator_address:', tokenData.creator_address || '(null)');
    console.log('  buy_price:', tokenData.buy_price);
    console.log('  buy_time:', tokenData.buy_time);
  }
  console.log('');

  // 2. 查询交易信号
  console.log('2. 交易信号:');
  const { data: signals, error: signalsError } = await supabase
    .from('trading_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: true })
    .limit(20);

  if (signalsError) {
    console.log('  错误:', signalsError.message);
  } else {
    console.log(`  找到 ${signals?.length || 0} 条信号`);
    if (signals && signals.length > 0) {
      signals.forEach((s, i) => {
        console.log(`  信号 ${i + 1}:`);
        console.log(`    类型: ${s.signal_type} (${s.action})`);
        console.log(`    状态: ${s.status}`);
        console.log(`    原因: ${s.reason}`);
        console.log(`    信心度: ${s.confidence}`);
        console.log(`    时间: ${s.created_at}`);
        console.log(`    元数据: ${JSON.stringify(s.metadata).substring(0, 100)}...`);
      });
    }
  }
  console.log('');

  // 3. 查询时序数据
  console.log('3. 时序数据 (最近10条):');
  const { data: timeSeries, error: timeSeriesError } = await supabase
    .from('token_time_series')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: false })
    .limit(10);

  if (timeSeriesError) {
    console.log('  错误:', timeSeriesError.message);
  } else {
    console.log(`  找到 ${timeSeries?.length || 0} 条时序数据`);
    if (timeSeries && timeSeries.length > 0) {
      timeSeries.forEach((t, i) => {
        console.log(`  时序 ${i + 1}:`);
        console.log(`    时间: ${t.timestamp}`);
        console.log(`    价格: ${t.price}`);
        console.log(`    状态: ${t.status}`);
        console.log(`    早期收益率: ${t.early_return}`);
        console.log(`    age: ${t.age}`);
      });
    }
  }
  console.log('');

  // 4. 查询策略执行记录
  console.log('4. 策略执行记录:');
  const { data: executions, error: executionsError } = await supabase
    .from('strategy_executions')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: true })
    .limit(20);

  if (executionsError) {
    console.log('  错误:', executionsError.message);
  } else {
    console.log(`  找到 ${executions?.length || 0} 条执行记录`);
    if (executions && executions.length > 0) {
      executions.forEach((e, i) => {
        console.log(`  执行 ${i + 1}:`);
        console.log(`    策略: ${e.strategy_name}`);
        console.log(`    动作: ${e.action}`);
        console.log(`    状态: ${e.execution_status}`);
        console.log(`    时间: ${e.created_at}`);
      });
    }
  }
  console.log('');

  // 5. 查询交易记录
  console.log('5. 交易记录:');
  const { data: trades, error: tradesError } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: true });

  if (tradesError) {
    console.log('  错误:', tradesError.message);
  } else {
    console.log(`  找到 ${trades?.length || 0} 条交易记录`);
    if (trades && trades.length > 0) {
      trades.forEach((t, i) => {
        console.log(`  交易 ${i + 1}:`);
        console.log(`    方向: ${t.direction}`);
        console.log(`    状态: ${t.status}`);
        console.log(`    数量: ${t.amount}`);
        console.log(`    价格: ${t.unit_price}`);
        console.log(`    时间: ${t.created_at}`);
      });
    }
  }
}

checkTokenSignals().catch(console.error);
