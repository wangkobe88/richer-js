const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkDiscoveredAtNull() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 查询这个代币
  const { data: token } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', sourceExperimentId)
    .eq('token_address', targetAddress)
    .maybeSingle();

  if (!token) {
    console.log('❌ 代币不存在');
    return;
  }

  console.log('=== 1$ 代币数据 ===\n');
  console.log('token_address:', token.token_address);
  console.log('token_symbol:', token.token_symbol);
  console.log('discovered_at:', token.discovered_at);
  console.log('discovered_at 类型:', typeof token.discovered_at);
  console.log('discovered_at == null:', token.discovered_at == null);
  console.log('discovered_at === null:', token.discovered_at === null);
  console.log('');

  // 检查 Map 中的条件
  if (token.discovered_at) {
    console.log('✅ discovered_at 有值，会被添加到 Map');
  } else {
    console.log('❌ discovered_at 为 null/falsy，不会被添加到 Map');
  }
}

checkDiscoveredAtNull().catch(console.error);
