require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  console.log('检查回测实验 9733f934 的详细信息...\n');

  // 1. 获取实验基本信息
  const { data: expData } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', '9733f934-b263-40e0-a4d3-8639703b0da9')
    .single();

  if (expData) {
    console.log('=== 回测实验信息 ===');
    console.log('ID:', expData.id);
    console.log('状态:', expData.status);
    console.log('创建时间:', expData.created_at);
    console.log('开始时间:', expData.started_at);
    console.log('完成时间:', expData.completed_at);

    if (expData.config) {
      console.log('\n配置:');
      console.log('  源实验ID:', expData.config.backtest?.sourceExperimentId);
      console.log('  初始余额:', expData.config.backtest?.initialBalance);
    }
  }

  // 2. 检查时序数据
  const { data: timeSeriesData, error: tsError } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, timestamp, token_symbol')
    .eq('experiment_id', '9733f934-b263-40e0-a4d3-8639703b0da9')
    .order('timestamp', { ascending: true });

  if (tsError) {
    console.log('\n时序数据查询错误:', tsError.message);
  } else {
    console.log('\n=== 回测实验时序数据 ===');
    console.log('总数据点数:', timeSeriesData?.length || 0);

    if (timeSeriesData && timeSeriesData.length > 0) {
      const loops = timeSeriesData.map(d => d.loop_count);
      const uniqueLoops = [...new Set(loops)];
      console.log('不同的 loop 值数量:', uniqueLoops.length);
      console.log('loop 范围:', Math.min(...loops), '-', Math.max(...loops));

      const startTime = new Date(timeSeriesData[0].timestamp);
      const endTime = new Date(timeSeriesData[timeSeriesData.length - 1].timestamp);
      const duration = (endTime - startTime) / 1000 / 60;
      console.log('时间跨度:', duration.toFixed(2), '分钟');
    }
  }

  // 3. 检查交易记录
  const { data: trades, error: tradesError } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', '9733f934-b263-40e0-a4d3-8639703b0da9');

  if (tradesError) {
    console.log('\n交易数据查询错误:', tradesError.message);
  } else {
    console.log('\n=== 交易记录 ===');
    console.log('交易数量:', trades?.length || 0);
  }

  // 4. 检查策略信号
  const { data: signals, error: signalsError } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', '9733f934-b263-40e0-a4d3-8639703b0da9');

  if (signalsError) {
    console.log('\n策略信号查询错误:', signalsError.message);
  } else {
    console.log('\n=== 策略信号 ===');
    console.log('信号数量:', signals?.length || 0);
  }

  // 5. 分析问题
  console.log('\n=== 问题分析 ===');
  if (expData) {
    const started = new Date(expData.started_at).getTime();
    const completed = expData.completed_at ? new Date(expData.completed_at).getTime() : Date.now();
    const duration = (completed - started) / 1000 / 60;
    console.log('回测运行时间:', duration.toFixed(2), '分钟');

    if (expData.status === 'running') {
      console.log('状态: running (可能已停止但状态未更新)');
    } else if (expData.status === 'completed') {
      console.log('状态: completed');
    } else if (expData.status === 'failed') {
      console.log('状态: failed');
    }
  }

  if (timeSeriesData && timeSeriesData.length > 0) {
    const loops = timeSeriesData.map(d => d.loop_count);
    const uniqueLoops = [...new Set(loops)];
    if (uniqueLoops.length < 100) {
      console.log(`\n⚠️ 只记录了 ${uniqueLoops.length} 个 loop 的时序数据`);
      console.log('这说明回测引擎在早期就停止了处理');
      console.log('需要检查回测引擎的日志找出停止原因');
    }
  }

  // 6. 检查源实验配置
  const { data: sourceExp } = await supabase
    .from('experiments')
    .select('id, config, status')
    .eq('id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .single();

  if (sourceExp) {
    console.log('\n=== 源实验信息 ===');
    console.log('状态:', sourceExp.status);
    console.log('有回测配置:', !!sourceExp.config?.backtest);
  }
})();
