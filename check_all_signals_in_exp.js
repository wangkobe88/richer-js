const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkAllSignals() {
  const experimentId = '233e4d94-e771-463a-9296-a93483a9ce96';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  if (!signals || signals.length === 0) {
    console.log('没有信号');
    return;
  }

  console.log('=== 实验所有信号 ===\n');
  console.log('总信号数:', signals.length);
  console.log('');

  signals.slice(0, 5).forEach((s, i) => {
    const metadata = s.metadata || {};
    console.log(`信号 ${i + 1}:`);
    console.log('  Token:', s.token_address?.substring(0, 10) + '...');
    console.log('  Created:', s.created_at);
    console.log('  tokenCreateTime:', metadata.tokenCreateTime ?? '不存在');
    console.log('  preBuyCheckFactors:', metadata.preBuyCheckFactors ? '存在' : '不存在');
    console.log('');
  });
}

checkAllSignals().catch(console.error);
