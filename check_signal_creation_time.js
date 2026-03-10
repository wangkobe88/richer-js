const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSignalCreationTime() {
  const experimentId = '63d39534-cd5f-49c3-9b4f-e53c2a166fd9';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: false });

  if (!signals || signals.length === 0) {
    console.log('没有找到信号');
    return;
  }

  console.log('=== 信号信息 ===\n');
  signals.forEach((s, i) => {
    console.log(`信号 ${i + 1}:`);
    console.log('  ID:', s.id);
    console.log('  Created at:', s.created_at);
    console.log('  Status:', s.status);
    console.log('');
  });

  // 检查回测实验的创建时间
  const { data: exp } = await supabase
    .from('experiments')
    .select('created_at, updated_at')
    .eq('id', experimentId)
    .maybeSingle();

  if (exp) {
    console.log('=== 回测实验信息 ===\n');
    console.log('Created at:', exp.created_at);
    console.log('Updated at:', exp.updated_at);
  }
}

checkSignalCreationTime().catch(console.error);
