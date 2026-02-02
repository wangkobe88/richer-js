/**
 * 检查特定代币的交易和时序数据
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function checkTokenData() {
  const experimentId = '95042847-cccd-4316-be03-f172e2885993';
  const tokenSymbol = '创业故事';

  console.log(`\n📊 检查实验 ${experimentId} 中代币 "${tokenSymbol}" 的数据\n`);

  // 1. 获取该代币的时序数据
  console.log('=== 时序数据 ===');
  const { data: timeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_symbol', tokenSymbol)
    .order('timestamp', { ascending: true });

  console.log(`时序数据条数: ${timeSeriesData?.length || 0}`);

  if (timeSeriesData && timeSeriesData.length > 0) {
    console.log('\n时间范围:');
    console.log('  开始:', timeSeriesData[0].timestamp);
    console.log('  结束:', timeSeriesData[timeSeriesData.length - 1].timestamp);

    console.log('\n每条时序数据:');
    timeSeriesData.forEach((d, i) => {
      const price = d.price_usd ? parseFloat(d.price_usd).toExponential(4) : 'N/A';
      const signal = d.signal_type || '-';
      const executed = d.signal_executed;
      console.log(`  [${i + 1}] ${d.timestamp} | 价格: ${price} | 信号: ${signal} | 执行: ${executed}`);
    });
  }

  // 2. 获取该代币的交易记录
  console.log('\n=== 交易记录 ===');
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_symbol', tokenSymbol)
    .order('created_at', { ascending: true });

  console.log(`交易记录条数: ${trades?.length || 0}`);

  if (trades && trades.length > 0) {
    console.log('\n每笔交易:');
    trades.forEach((t, i) => {
      const direction = t.direction || 'unknown';
      const amount = t.amount || t.amount_in || 'N/A';
      const price = t.price || 'N/A';
      const success = t.success ? '成功' : '失败';
      const status = t.status || 'N/A';
      console.log(`  [${i + 1}] ${t.created_at} | 方向: ${direction} | 数量: ${amount} | 价格: ${price} | ${success} | 状态: ${status}`);
    });
  }

  // 3. 获取该代币的信号记录
  console.log('\n=== 信号记录 ===');
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_symbol', tokenSymbol)
    .order('created_at', { ascending: true });

  console.log(`信号记录条数: ${signals?.length || 0}`);

  if (signals && signals.length > 0) {
    console.log('\n每个信号:');
    signals.forEach((s, i) => {
      const signalType = s.signal_type || s.action?.toUpperCase() || '-';
      const confidence = s.confidence || 'N/A';
      const reason = s.reason || '-';
      const executed = s.executed || false;
      console.log(`  [${i + 1}] ${s.created_at} | 类型: ${signalType} | 置信度: ${confidence} | 原因: ${reason} | 执行: ${executed}`);
    });
  }

  // 4. 检查代币表中的状态
  console.log('\n=== 代币状态 ===');
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_symbol', tokenSymbol);

  if (tokens && tokens.length > 0) {
    tokens.forEach(t => {
      console.log(`  状态: ${t.status}`);
      console.log(`  发现时间: ${t.discovered_at}`);
    });
  } else {
    console.log('  未在 experiment_tokens 表中找到记录');
  }

  // 5. 分析问题
  console.log('\n=== 分析 ===');

  if (timeSeriesData && timeSeriesData.length > 0) {
    const firstTime = new Date(timeSeriesData[0].timestamp);
    const lastTime = new Date(timeSeriesData[timeSeriesData.length - 1].timestamp);
    const durationMinutes = (lastTime - firstTime) / (1000 * 60);
    const durationHours = durationMinutes / 60;

    console.log(`监控时长: ${durationMinutes.toFixed(1)} 分钟 (${durationHours.toFixed(2)} 小时)`);

    // 计算该代币的创建时间
    if (timeSeriesData[0].factor_values?.age !== undefined) {
      const ageMinutes = timeSeriesData[0].factor_values.age;
      console.log(`代币年龄: ${ageMinutes?.toFixed(1) || 'N/A'} 分钟`);
    }

    // 检查是否有卖出信号但没有执行
    let sellSignalCount = 0;
    let sellExecutedCount = 0;
    timeSeriesData.forEach(d => {
      if (d.signal_type === 'SELL') {
        sellSignalCount++;
        if (d.signal_executed) {
          sellExecutedCount++;
        }
      }
    });

    console.log(`卖出信号数量: ${sellSignalCount}`);
    console.log(`卖出执行数量: ${sellExecutedCount}`);
  }

  if (trades && trades.length > 0) {
    const buyCount = trades.filter(t => t.direction === 'buy').length;
    const sellCount = trades.filter(t => t.direction === 'sell').length;
    console.log(`买入交易: ${buyCount} 笔`);
    console.log(`卖出交易: ${sellCount} 笔`);
  }
}

checkTokenData().catch(console.error);
