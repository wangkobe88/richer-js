const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  // 获取一个有标注的代币
  const { data } = await supabase
    .from('experiment_tokens')
    .select('token_address, raw_api_data, human_judges')
    .not('human_judges', 'is', null)
    .limit(1)
    .single();

  if (!data) {
    console.log('没有找到数据');
    return;
  }

  const rawApi = typeof data.raw_api_data === 'string' ? JSON.parse(data.raw_api_data) : data.raw_api_data;
  const launchAtFromRaw = rawApi?.token?.launch_at || rawApi?.launch_at;

  console.log('代币地址:', data.token_address);
  console.log('raw_api_data中的launch_at:', launchAtFromRaw, '(' + new Date(launchAtFromRaw * 1000).toISOString() + ')');

  // 调用API获取交易
  const response = await fetch('http://localhost:3010/api/token-early-trades', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({tokenAddress: data.token_address, chain: 'bsc', limit: 10})
  });

  const result = await response.json();
  if (result.success && result.data.earlyTrades) {
    const debugInfo = result.data.debug;
    console.log('\nAPI返回的debug信息:');
    console.log('  launchAt:', debugInfo.launchAt, '(' + new Date(debugInfo.launchAt * 1000).toISOString() + ')');
    console.log('  totalTrades:', debugInfo.totalTrades);

    if (result.data.earlyTrades.length > 0) {
      const first = result.data.earlyTrades[0];
      const last = result.data.earlyTrades[result.data.earlyTrades.length - 1];
      console.log('\n交易时间范围:');
      console.log('  首笔:', first.time, '(' + new Date(first.time * 1000).toISOString() + ')');
      console.log('  末笔:', last.time, '(' + new Date(last.time * 1000).toISOString() + ')');
      console.log('\n时间差:');
      console.log('  首笔 - launch_at:', (first.time - debugInfo.launchAt), '秒');
      console.log('  末笔 - launch_at:', (last.time - debugInfo.launchAt), '秒');
    }
  }
}
check().catch(console.error);
