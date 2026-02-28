const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  const expId = '342bfb49-5bc9-48fd-bf8b-65e42bb1cbf0';

  console.log('=== 实验基本信息 ===\n');

  // 获取实验信息
  const { data: exp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', expId)
    .single();

  if (exp) {
    console.log(`ID: ${exp.id}`);
    console.log(`状态: ${exp.status}`);
    console.log(`模式: ${exp.mode}`);
    console.log(`创建时间: ${exp.created_at}`);
    console.log(`配置: ${JSON.stringify(exp.config, null, 2)}`);
  }

  console.log('\n=== 交易记录 ===\n');

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', expId)
    .order('created_at', { ascending: true });

  console.log(`交易总数: ${trades?.length || 0}`);

  if (trades && trades.length > 0) {
    trades.forEach(t => {
      console.log(`  ${t.trade_direction} - ${t.token_symbol} - ${t.created_at} - success=${t.success}`);
    });
  }

  console.log('\n=== 信号记录 ===\n');

  // 获取信号数据
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', expId)
    .order('created_at', { ascending: false })
    .limit(20);

  console.log(`信号总数: ${signals?.length || 0}\n`);

  if (signals && signals.length > 0) {
    console.log('最近信号:');
    signals.forEach(s => {
      console.log(`  ${s.action} - ${s.token_symbol} - ${s.created_at}`);
      console.log(`    执行: ${s.executed}, 原因: ${s.metadata?.execution_reason || s.metadata?.execution_error || '-'}`);
    });
  } else {
    console.log('没有信号记录');
  }

  console.log('\n=== 代币监控池 ===\n');

  // 获取监控池数据
  const { data: poolTokens } = await supabase
    .from('token_monitoring_pool')
    .select('*')
    .eq('experiment_id', expId)
    .order('added_at', { ascending: false })
    .limit(10);

  console.log(`监控池代币数: ${poolTokens?.length || 0}\n`);

  if (poolTokens && poolTokens.length > 0) {
    poolTokens.forEach(t => {
      console.log(`  ${t.token_symbol} - ${t.status} - ${t.added_at}`);
      console.log(`    地址: ${t.token_address}`);
    });
  } else {
    console.log('监控池为空');
  }

  console.log('\n=== 时序数据点数 ===\n');

  // 获取时序数据计数
  const { count } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', expId);

  console.log(`时序数据点: ${count || 0}`);
}

check().catch(console.error);
