const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkRawApiData() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  const { data: token, error } = await supabase
    .from('experiment_tokens')
    .select('raw_api_data')
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

  if (token.raw_api_data) {
    const rawData = typeof token.raw_api_data === 'string' 
      ? JSON.parse(token.raw_api_data) 
      : token.raw_api_data;
    
    console.log('=== Raw API Data ===\n');
    console.log(JSON.stringify(rawData, null, 2));
    
    console.log('\n=== Launch At 检查 ===\n');
    console.log('rawData.token?.launch_at:', rawData.token?.launch_at);
    console.log('rawData.launch_at:', rawData.launch_at);
  } else {
    console.log('❌ raw_api_data 为空');
  }
}

checkRawApiData().catch(console.error);
