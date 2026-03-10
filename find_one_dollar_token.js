const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function findOneDollarToken() {
  const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 在整个数据库中搜索这个地址
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('experiment_id, token_address, token_symbol, discovered_at')
    .eq('token_address', targetAddress)
    .limit(10);

  if (!tokens || tokens.length === 0) {
    console.log('❌ 数据库中没有这个代币');
    return;
  }

  console.log('=== 找到', tokens.length, '个记录 ===\n');
  tokens.forEach((t, i) => {
    console.log(`${i + 1}. 实验 ID: ${t.experiment_id}`);
    console.log(`   符号: ${t.token_symbol}`);
    console.log(`   discovered_at: ${t.discovered_at}`);
    console.log('');
  });
}

findOneDollarToken().catch(console.error);
