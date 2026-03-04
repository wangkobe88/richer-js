const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function querySignals() {
  const experimentId = 'dea2badf-4bbf-4eac-9a10-f6bf9dcc9717';
  const tokenAddress = '0xcd0827aa744903bfba63bb886da82e442f244444';

  // 获取交易信号
  const { data: signals, error } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('交易信号数量:', signals.length);
  console.log('');

  if (signals.length === 0) {
    console.log('没有找到交易信号');
    return;
  }

  signals.forEach((sig, i) => {
    console.log(`信号 ${i+1}:`);
    console.log(`  signal_type: ${sig.signal_type}`);
    console.log(`  action: ${sig.action}`);
    console.log(`  created_at: ${new Date(sig.created_at).toISOString()}`);
    console.log(`  reason: ${sig.reason || 'N/A'}`);
    console.log(`  confidence: ${sig.confidence}`);
    console.log(`  executed: ${sig.executed}`);
    if (sig.metadata) {
      console.log(`  metadata:`, sig.metadata);
    }
    console.log('');
  });
}

querySignals();
