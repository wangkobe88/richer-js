const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSpecificToken() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  const { data: token } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', sourceExpId)
    .eq('token_address', tokenAddress)
    .maybeSingle();

  if (!token) {
    console.log('❌ 代币不存在');
    return;
  }

  console.log('=== 1$ 代币数据 ===\n');
  console.log('token_address:', token.token_address);
  console.log('token_symbol:', token.token_symbol);
  console.log('discovered_at:', token.discovered_at);
  console.log('discovered_at (秒):', new Date(token.discovered_at).getTime() / 1000);
  console.log('');

  // 检查 BacktestEngine 是否会正确读取
  const discoveredAt = token.discovered_at;
  if (discoveredAt) {
    console.log('✅ discovered_at 存在');
    console.log('   回测引擎会保存到 Map:', discoveredAt);
    console.log('   然后在 _getOrCreateTokenState 中设置 tokenState.tokenCreatedAt');
    console.log('   然后在 _buildTokenInfoForBacktest 中返回');
    console.log('   最后在信号 metadata 中保存为秒级时间戳');
  } else {
    console.log('❌ discovered_at 为空');
  }
}

checkSpecificToken().catch(console.error);
