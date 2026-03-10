/**
 * 检查所有新增代币的数据位置
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkAllAddedTokensPosition() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  const addedTokens = [
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444',
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff',
    '0xa322f68af1dd4078d0e72998921f546391274444',
    '0xc3ca235bb3ac1bb951ce2833a9c8525f524e4444'
  ];

  console.log('=== 新增代币的数据位置 ===\n');
  console.log('代币                                  | 数据位置');
  console.log('-------------------------------------|----------');

  for (const token of addedTokens) {
    const { data: firstData } = await supabase
      .from('experiment_time_series_data')
      .select('id, timestamp')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token)
      .order('timestamp', { ascending: true })
      .range(0, 0);

    if (firstData && firstData.length > 0) {
      const firstTimestamp = firstData[0].timestamp;

      // 查询有多少条数据比这个时间更早
      const { data: earlierData } = await supabase
        .from('experiment_time_series_data')
        .select('id')
        .eq('experiment_id', sourceExpId)
        .lt('timestamp', firstTimestamp);

      const position = (earlierData?.length || 0) + 1;
      console.log(`${token} | 第 ${position} 条开始`);
    } else {
      console.log(`${token} | 无数据`);
    }
  }

  console.log('\n=== 结论 ===');
  console.log('如果所有新增代币的数据都在第 1000 条之后，');
  console.log('那说明旧回测引擎只加载了前 1000 条数据！');
  console.log('');
  console.log('这是一个严重的 bug！回测引擎应该加载所有数据，');
  console.log('或者至少应该明确说明只加载了部分数据。');
}

checkAllAddedTokensPosition().catch(console.error);
