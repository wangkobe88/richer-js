const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  const expId = 'bff98e09-e763-4e3d-bd2d-3359e91becfd';

  // 查看信号记录
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', expId)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('=== 信号记录 ===\n');
  console.log(`总数: ${signals?.length || 0}\n`);

  signals?.forEach(s => {
    console.log(`${s.action} - ${s.token_symbol} - ${s.created_at}`);
    console.log(`  执行: ${s.executed}, 原因: ${s.metadata?.execution_reason || '-'}`);
    console.log('');
  });
}

check().catch(console.error);
