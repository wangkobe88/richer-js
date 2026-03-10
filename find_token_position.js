/**
 * 找到新增代币的数据位置
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function findTokenPosition() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const newToken = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  console.log('=== 找到新增代币的数据位置 ===\n');

  // 使用二分查找找到代币的位置
  let low = 0;
  let high = 165000;
  let foundRow = -1;

  // 先查一下该代币有多少条数据
  const { data: tokenCount } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', sourceExpId)
    .eq('token_address', newToken);

  console.log('1$ 代币的数据点数:', tokenCount || '未知');

  // 获取该代币的第一条数据
  const { data: firstData } = await supabase
    .from('experiment_time_series_data')
    .select('id, timestamp')
    .eq('experiment_id', sourceExpId)
    .eq('token_address', newToken)
    .order('timestamp', { ascending: true })
    .range(0, 0);

  if (firstData && firstData.length > 0) {
    const firstTimestamp = firstData[0].timestamp;
    console.log('第一条数据时间:', firstTimestamp);

    // 查询有多少条数据比这个时间更早
    const { data: earlierData } = await supabase
      .from('experiment_time_series_data')
      .select('id')
      .eq('experiment_id', sourceExpId)
      .lt('timestamp', firstTimestamp);

    const position = earlierData?.length || 0;
    console.log('该代币从第', position + 1, '条数据开始');
    console.log('');

    // 检查旧实验是否可能加载了这么多数据
    console.log('如果旧实验只加载了前 X 条数据:');
    console.log('  X=1000: 包含该代币?', position < 1000 ? '是' : '否');
    console.log('  X=5000: 包含该代币?', position < 5000 ? '是' : '否');
    console.log('  X=10000: 包含该代币?', position < 10000 ? '是' : '否');
    console.log('  X=20000: 包含该代币?', position < 20000 ? '是' : '否');
  }
}

findTokenPosition().catch(console.error);
