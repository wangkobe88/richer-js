const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  const { data } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', '65a68e5a-dfb5-4d52-a7cf-d088a5252e20')
    .eq('token_address', '0x438ed71e05a7ae7174e53b3a011cf643bbce4444')
    .order('created_at', { ascending: false })
    .limit(5);

  if (!data || data.length === 0) {
    console.log('未找到信号');
    return;
  }

  console.log('找到', data.length, '个信号\n');

  for (const s of data) {
    console.log('========================================');
    console.log('时间:', s.created_at);
    console.log('状态:', s.status);
    console.log('');

    const m = s.metadata || {};
    console.log('execution_reason:', m.execution_reason || '(无)');
    console.log('execution_status:', m.execution_status || '(无)');
    console.log('');

    console.log('preBuyCheck:', m.preBuyCheck);
    console.log('earlyTradesChecked:', m.earlyTradesChecked);
    console.log('earlyTradesCountPerMin:', m.earlyTradesCountPerMin);
    console.log('earlyTradesVolumePerMin:', m.earlyTradesVolumePerMin);
    console.log('earlyTradesHighValueCount:', m.earlyTradesHighValueCount);
    console.log('earlyTradesHighValuePerMin:', m.earlyTradesHighValuePerMin);
  }
}

check();
