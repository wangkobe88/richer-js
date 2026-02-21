require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  const experimentId = '9733f934-b263-40e0-a4d3-8639703b0da9';

  const { data } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  if (data) {
    console.log('实验状态:', data.status);
    console.log('创建时间:', data.created_at);
    console.log('开始时间:', data.started_at);
    console.log('完成时间:', data.completed_at);
  }

  // 检查时序数据
  const { data: tsData } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count')
    .eq('experiment_id', experimentId)
    .order('loop_count', { ascending: false })
    .limit(1);

  if (tsData && tsData.length > 0) {
    console.log('最后一个 loop:', tsData[0].loop_count);
  }

  // 检查交易记录
  const { data: trades } = await supabase
    .from('trades')
    .select('id')
    .eq('experiment_id', experimentId);

  console.log('交易数量:', trades?.length || 0);

  // 检查策略信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('id')
    .eq('experiment_id', experimentId);

  console.log('信号数量:', signals?.length || 0);
})();
