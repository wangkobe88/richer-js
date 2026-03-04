require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTokenSignals() {
  const experimentId = 'f2c221a8-1214-466a-abae-2d68921b6dda';
  const tokenAddress = '0xc44af04f87a07b18289dc3254e9c3a6a1c8d4444';

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
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: false })
    .limit(5);

  if (signalsError) {
    console.log('  错误:', signalsError.message);
  } else {
    console.log(`  找到 ${signals?.length || 0} 条信号`);
    if (signals && signals.length > 0) {
      signals.forEach((s, i) => {
        const m = s.metadata || {};
        console.log(`  信号 ${i + 1}:`);
        console.log(`    类型: ${s.action}`);
        console.log(`    状态: ${s.status}`);
        console.log(`    时间: ${s.created_at}`);

        // 早期参与者指标
        if (m.earlyTradesChecked === 1) {
          console.log(`    早期参与者指标:`);
          console.log(`      检查时间: ${m.earlyTradesCheckTime}秒`);
          console.log(`      总交易数: ${m.earlyTradesTotalCount}`);
          console.log(`      总交易额: $${(m.earlyTradesVolume || 0).toFixed(2)}`);
          console.log(`      交易额/分: $${(m.earlyTradesVolumePerMin || 0).toFixed(2)}`);
          console.log(`      交易次数/分: ${(m.earlyTradesCountPerMin || 0).toFixed(2)}`);
          console.log(`      钱包数/分: ${(m.earlyTradesWalletsPerMin || 0).toFixed(2)}`);
          console.log(`      高价值交易数: ${m.earlyTradesHighValueCount || 0}`);
          console.log(`      高价值/分: ${(m.earlyTradesHighValuePerMin || 0).toFixed(2)}`);
          console.log(`      独立钱包数: ${m.earlyTradesUniqueWallets || 0}`);
          console.log(`    `);
          console.log(`    策略B检查:`);
          const hvCountOk = (m.earlyTradesHighValueCount || 0) >= 8;
          const hvPerMinOk = (m.earlyTradesHighValuePerMin || 0) >= 5.6;
          const countPerMinOk = (m.earlyTradesCountPerMin || 0) >= 10.6;
          const pass = hvCountOk && hvPerMinOk && countPerMinOk;
          console.log(`      高价值交易数>=8: ${m.earlyTradesHighValueCount || 0} ${hvCountOk ? '✓' : '✗'}`);
          console.log(`      高价值/分>=5.6: ${(m.earlyTradesHighValuePerMin || 0).toFixed(1)} ${hvPerMinOk ? '✓' : '✗'}`);
          console.log(`      交易次数/分>=10.6: ${(m.earlyTradesCountPerMin || 0).toFixed(1)} ${countPerMinOk ? '✓' : '✗'}`);
          console.log(`    => ${pass ? '✓ 通过' : '✗ 不通过'}`);
        }
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
