require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 查找 TCLAW 代币出现的第一个 loop
  const { data: points } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, token_symbol, token_address')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .eq('token_symbol', 'TCLAW')
    .order('loop_count', { ascending: true })
    .limit(10);

  if (points && points.length > 0) {
    console.log('TCLAW 代币出现的 loop 范围:');
    console.log('  首次出现:', points[0].loop_count);
    console.log('  地址:', points[0].token_address);
    
    // 获取该 loop 的所有代币
    const { data: loopPoints } = await supabase
      .from('experiment_time_series_data')
      .select('token_symbol')
      .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
      .eq('loop_count', points[0].loop_count);
    
    console.log('  该 loop 的代币数:', loopPoints?.length || 0);
  } else {
    console.log('没有找到 TCLAW 代币');
  }
})();
