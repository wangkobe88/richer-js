const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testMapLookup() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 1. 加载所有代币
  const { data: tokensData } = await supabase
    .from('experiment_tokens')
    .select('token_address, discovered_at')
    .eq('experiment_id', sourceExperimentId);

  console.log('加载了', tokensData?.length, '个代币\n');

  // 2. 存储 token 创建时间到 Map
  const tokenCreatedTimes = new Map();
  for (const row of tokensData || []) {
    if (row.discovered_at) {
      tokenCreatedTimes.set(row.token_address, row.discovered_at);
    }
  }

  console.log('Map 大小:', tokenCreatedTimes.size);
  console.log('');

  // 3. 检查目标地址
  console.log('=== 查询测试 ===\n');
  console.log('目标地址:', targetAddress);
  console.log('');

  // 直接查询
  const result1 = tokenCreatedTimes.get(targetAddress);
  console.log('Map.get(原始地址):', result1 || 'null');

  // 小写查询
  const result2 = tokenCreatedTimes.get(targetAddress.toLowerCase());
  console.log('Map.get(小写地址):', result2 || 'null');

  // 检查 Map 中的所有键（找出 6b0fd 开头的）
  console.log('');
  console.log('=== Map 中 6b0fd 开头的键 ===');
  for (const [key, value] of tokenCreatedTimes.entries()) {
    if (key.toLowerCase().startsWith('0x6b0fd')) {
      console.log('  键:', key);
      console.log('  值:', value);
    }
  }
}

testMapLookup().catch(console.error);
