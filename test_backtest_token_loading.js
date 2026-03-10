const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testBacktestTokenLoading() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  console.log('=== 模拟回测引擎加载代币创建时间 ===\n');

  // 1. 加载源实验的代币创建时间（discovered_at 与 launch_at 一致）
  const { data: tokensData } = await supabase
    .from('experiment_tokens')
    .select('token_address, discovered_at')
    .eq('experiment_id', sourceExperimentId);

  console.log('查询结果:', tokensData?.length, '个代币');
  console.log('');

  // 2. 存储 token 创建时间到 Map
  const tokenCreatedTimes = new Map();
  for (const row of tokensData || []) {
    if (row.discovered_at) {
      tokenCreatedTimes.set(row.token_address, row.discovered_at);
    }
  }

  console.log('✅ 已加载', tokenCreatedTimes.size, '个代币的创建时间 (discovered_at)');
  console.log('');

  // 3. 测试获取 1$ 代币的创建时间
  const tokenCreatedAt = tokenCreatedTimes.get(tokenAddress) || null;
  console.log('=== 1$ 代币 ===');
  console.log('tokenCreatedAt:', tokenCreatedAt);
  console.log('');

  // 4. 在 _getOrCreateTokenState 中设置
  const tokenState = {
    token: tokenAddress,
    symbol: '1$',
    tokenCreatedAt: tokenCreatedAt
  };

  console.log('tokenState.tokenCreatedAt:', tokenState.tokenCreatedAt);
  console.log('');

  // 5. 在 _buildTokenInfoForBacktest 中返回
  const tokenInfo = {
    innerPair: `${tokenAddress}_fo`,
    tokenCreatedAt: tokenState.tokenCreatedAt
  };

  console.log('tokenInfo.tokenCreatedAt:', tokenInfo.tokenCreatedAt);
  console.log('');

  // 6. 在信号 metadata 中保存为秒级时间戳
  const tokenCreateTime = tokenInfo.tokenCreatedAt
    ? Math.floor(new Date(tokenInfo.tokenCreatedAt).getTime() / 1000)
    : null;

  console.log('=== 最终保存到信号 metadata ===');
  console.log('tokenCreateTime:', tokenCreateTime);
  if (tokenCreateTime) {
    console.log('tokenCreateTime (日期):', new Date(tokenCreateTime * 1000).toLocaleString());
  }
  console.log('');

  // 7. 检查是否为 null
  if (tokenCreateTime === null) {
    console.log('❌ tokenCreateTime 是 null，会导致使用 relative 方法');
  } else {
    console.log('✅ tokenCreateTime 有值，应该使用 real_early 方法（如果时间差 <= 120秒）');
  }
}

testBacktestTokenLoading().catch(console.error);
