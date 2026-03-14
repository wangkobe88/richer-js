const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function search() {
  // 搜索所有虚拟实验
  const { data: experiments } = await supabase
    .from('experiments')
    .select('id, trading_mode, status, created_at')
    .eq('trading_mode', 'virtual')
    .order('created_at', { ascending: false })
    .limit(15);

  console.log('最近的虚拟实验 (检查 strongTrader 数据):\n');

  for (const exp of experiments || []) {
    // 检查是否有 strongTraderNetPositionRatio 数据
    const { data: sample } = await supabase
      .from('strategy_signals')
      .select('id, metadata')
      .eq('experiment_id', exp.id)
      .limit(1);

    let hasData = false;
    if (sample && sample[0]) {
      const factors = sample[0].metadata?.preBuyCheckFactors || {};
      hasData = factors.strongTraderNetPositionRatio !== undefined;
    }

    console.log(`${exp.id.slice(0, 8)}... | ${exp.status} | strongTrader数据: ${hasData ? 'YES' : 'NO'}`);
  }
}

search().catch(console.error);
