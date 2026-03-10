const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkIfTokenInFirst1000() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 只查询前 1000 个
  const { data: first1000 } = await supabase
    .from('experiment_tokens')
    .select('token_address')
    .eq('experiment_id', sourceExperimentId)
    .limit(1000);

  console.log('前 1000 个代币数量:', first1000?.length);
  console.log('');

  // 检查目标地址是否在前 1000 个中
  const inFirst1000 = first1000?.some(t => t.token_address === targetAddress);
  console.log('1$ 代币在前 1000 个中:', inFirst1000 ? '✅ 是' : '❌ 否');
  console.log('');

  if (!inFirst1000) {
    // 查询 1000-2000
    const { data: next1000 } = await supabase
      .from('experiment_tokens')
      .select('token_address, token_symbol')
      .eq('experiment_id', sourceExperimentId)
      .range(1000, 1999);

    const inNext1000 = next1000?.some(t => t.token_address === targetAddress);
    console.log('1$ 代币在 1000-1999 中:', inNext1000 ? '✅ 是' : '❌ 否');

    if (inNext1000) {
      const token = next1000?.find(t => t.token_address === targetAddress);
      console.log('   符号:', token?.token_symbol);
    }
  }
}

checkIfTokenInFirst1000().catch(console.error);
