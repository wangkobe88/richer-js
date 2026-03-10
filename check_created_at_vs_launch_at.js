const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkComparison() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  const { data: token, error } = await supabase
    .from('experiment_tokens')
    .select('created_at, raw_api_data, discovered_at')
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

  console.log('=== 字段对比 ===\n');

  // experiment_tokens.created_at（数据库记录创建时间）
  const dbCreatedAt = token.created_at ? new Date(token.created_at).getTime() / 1000 : null;
  console.log('experiment_tokens.created_at (秒):', dbCreatedAt);
  console.log('experiment_tokens.created_at (日期):', token.created_at);
  console.log('');

  // experiment_tokens.discovered_at（代币被发现时间）
  const discoveredAt = token.discovered_at ? new Date(token.discovered_at).getTime() / 1000 : null;
  console.log('experiment_tokens.discovered_at (秒):', discoveredAt);
  console.log('experiment_tokens.discovered_at (日期):', token.discovered_at);
  console.log('');

  // raw_api_data.launch_at（代币发布时间）
  let launchAt = null;
  if (token.raw_api_data) {
    const rawData = typeof token.raw_api_data === 'string'
      ? JSON.parse(token.raw_api_data)
      : token.raw_api_data;
    launchAt = rawData.launch_at || null;
    console.log('raw_api_data.launch_at (秒):', launchAt);
    console.log('raw_api_data.launch_at (日期):', launchAt ? new Date(launchAt * 1000).toISOString() : 'null');
    console.log('');
  }

  console.log('=== 对比结果 ===\n');
  console.log('created_at == launch_at?', dbCreatedAt === launchAt);
  console.log('discovered_at == launch_at?', discoveredAt === launchAt);
  console.log('');

  // 计算差值
  if (dbCreatedAt && launchAt) {
    const diff = Math.abs(dbCreatedAt - launchAt);
    console.log('created_at 与 launch_at 差值:', diff, '秒 (', (diff / 60).toFixed(2), '分钟)');
  }
  if (discoveredAt && launchAt) {
    const diff = Math.abs(discoveredAt - launchAt);
    console.log('discovered_at 与 launch_at 差值:', diff, '秒 (', (diff / 60).toFixed(2), '分钟)');
  }
}

checkComparison().catch(console.error);
