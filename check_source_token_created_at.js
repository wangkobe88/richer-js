const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSourceToken() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 获取源实验的代币数据
  const { data: token, error } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', sourceExperimentId)
    .eq('token_address', tokenAddress)
    .maybeSingle();

  if (error) {
    console.log('Error:', error);
    return;
  }

  if (!token) {
    console.log('❌ 代币不存在');
    return;
  }

  console.log('=== 源实验的代币数据 ===\n');
  console.log('Experiment ID:', token.experiment_id);
  console.log('Token Address:', token.token_address);
  console.log('Token Symbol:', token.token_symbol);
  console.log('');
  console.log('=== Token Created At ===\n');
  console.log('token_created_at:', token.token_created_at);
  
  if (token.token_created_at) {
    const tokenCreateTime = Math.floor(new Date(token.token_created_at).getTime() / 1000);
    console.log('');
    console.log('tokenCreateTime (秒):', tokenCreateTime);
    console.log('tokenCreateTime (日期):', new Date(tokenCreateTime * 1000).toLocaleString());
  }
}

checkSourceToken().catch(console.error);
