require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkExperiment() {
  const experimentId = '5aadb32a-37bb-419c-93d3-10818737426e';

  console.log('========================================');
  console.log(`实验: ${experimentId}`);
  console.log('========================================\n');

  // 1. 查询实验信息
  const { data: experiment, error: expError } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  if (expError) {
    console.log('实验查询错误:', expError.message);
    return;
  }

  console.log('实验信息:');
  console.log('  名称:', experiment.experiment_name);
  console.log('  模式:', experiment.trading_mode);
  console.log('  状态:', experiment.status);
  console.log('  开始时间:', experiment.started_at);
  console.log('  区块链:', experiment.blockchain);
  console.log('  策略:', experiment.strategy_type);
  console.log('');

  // 2. 查询代币数量
  const { count: tokenCount, error: countError } = await supabase
    .from('experiment_tokens')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', experimentId);

  console.log(`代币总数: ${tokenCount || 0}`);
  console.log('');

  // 3. 查询已购买的代币
  const { data: boughtTokens, error: boughtError } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, buy_price, buy_time, status')
    .eq('experiment_id', experimentId)
    .not('buy_price', 'is', null);

  if (boughtError) {
    console.log('已购买代币查询错误:', boughtError.message);
  } else {
    console.log(`已购买代币数: ${boughtTokens?.length || 0}`);
    if (boughtTokens && boughtTokens.length > 0) {
      boughtTokens.forEach(t => {
        console.log(`  - ${t.token_symbol}: ${t.token_address}`);
        console.log(`    买入价格: ${t.buy_price}`);
        console.log(`    买入时间: ${t.buy_time}`);
      });
    }
  }
  console.log('');

  // 4. 查询交易信号
  const { data: signals, error: signalsError } = await supabase
    .from('trading_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  if (signalsError) {
    console.log('交易信号查询错误:', signalsError.message);
  } else {
    console.log(`交易信号总数: ${signals?.length || 0}`);
    if (signals && signals.length > 0) {
      console.log('信号类型分布:');
      const buySignals = signals.filter(s => s.signal_type === 'BUY').length;
      const sellSignals = signals.filter(s => s.signal_type === 'SELL').length;
      console.log(`  买入信号: ${buySignals}`);
      console.log(`  卖出信号: ${sellSignals}`);
    }
  }
  console.log('');

  // 5. 查询时序数据数量
  const { count: timeSeriesCount } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', experimentId);

  console.log(`时序数据总数: ${timeSeriesCount || 0}`);
  console.log('');

  // 6. 查询策略执行记录
  const { data: executions, error: execError } = await supabase
    .from('strategy_executions')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  if (execError) {
    console.log('策略执行记录查询错误:', execError.message);
  } else {
    console.log(`策略执行记录总数: ${executions?.length || 0}`);
  }
}

checkExperiment().catch(console.error);
