const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 检查回测实验信号是否有 preBuyCheckFactors
  const { data: sample } = await supabase
    .from('strategy_signals')
    .select('id, metadata')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .limit(3);

  console.log('回测实验信号样本:');
  sample?.forEach(s => {
    const factors = s.metadata?.preBuyCheckFactors;
    console.log('  信号 ID:', s.id.slice(0, 8) + '...');
    console.log('  有 preBuyCheckFactors:', factors !== undefined);
    if (factors) {
      console.log('  strongTraderNetPositionRatio:', factors.strongTraderNetPositionRatio);
    }
  });

  // 检查有 preBuyCheckFactors 的信号数量
  const { count: withFactors } = await supabase
    .from('strategy_signals')
    .select('id', { count: 'exact', head: true })
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .not('metadata->preBuyCheckFactors', 'null');

  console.log('\n有 preBuyCheckFactors 的信号数:', withFactors || 0);

  // 检查 experiment_time_series_data 表
  const { data: timeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .limit(1);

  console.log('\ntime_series_data 样本数:', timeSeries?.length || 0);
  if (timeSeries && timeSeries[0]) {
    console.log('time_series_data 字段:', Object.keys(timeSeries[0]).join(', '));
    const strongFields = Object.keys(timeSeries[0]).filter(k => k.toLowerCase().includes('strong'));
    console.log('有 strongTrader 相关字段:', strongFields.length > 0 ? strongFields.join(', ') : '无');
  }
})();
