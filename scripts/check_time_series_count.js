require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function checkTimeSeriesCount() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  // 首先获取总数
  const { count, error: countError } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', experimentId);

  if (countError) {
    console.log('计数错误:', countError.message);
    return;
  }

  console.log('experiment_time_series_data 表中该实验的总记录数: ' + count);

  // 如果超过1000，需要分页获取
  const allRecords = [];
  let page = 0;
  const pageSize = 1000;

  while (page * pageSize < count) {
    const { data, error } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', experimentId)
      .range(page * pageSize, (page + 1) * pageSize - 1)
      .order('timestamp', { ascending: true });

    if (error) {
      console.log('获取数据错误:', error.message);
      break;
    }

    allRecords.push(...data);
    console.log('获取第 ' + (page + 1) + ' 页: ' + data.length + ' 条记录');
    page++;

    if (data.length < pageSize) break;
  }

  console.log('\n总共获取到: ' + allRecords.length + ' 条时序记录');

  // 按代币分组统计
  const byToken = new Map();
  allRecords.forEach(ts => {
    const addr = ts.token_address;
    if (!byToken.has(addr)) {
      byToken.set(addr, []);
    }
    byToken.get(addr).push(ts);
  });

  console.log('共有 ' + byToken.size + ' 个代币有时序数据');

  // 统计每个代币的记录数
  const recordCounts = [];
  byToken.forEach((records, addr) => {
    recordCounts.push({
      address: addr,
      symbol: records[0]?.token_symbol || 'Unknown',
      count: records.length
    });
  });

  recordCounts.sort((a, b) => b.count - a.count);

  console.log('\n=== 代币时序记录数统计 ===\n');
  console.log('记录数范围 | 代币数');
  console.log('-----------|--------');
  console.log('1-5 条     | ' + recordCounts.filter(r => r.count >= 1 && r.count <= 5).length);
  console.log('6-10 条    | ' + recordCounts.filter(r => r.count >= 6 && r.count <= 10).length);
  console.log('11-20 条   | ' + recordCounts.filter(r => r.count >= 11 && r.count <= 20).length);
  console.log('20+ 条     | ' + recordCounts.filter(r => r.count > 20).length);

  console.log('\n记录数最多的代币 (前10):');
  recordCounts.slice(0, 10).forEach((r, i) => {
    console.log((i + 1) + '. ' + r.symbol + ': ' + r.count + ' 条记录');
  });

  // 检查有多少代币有足够的数据点进行分析
  const analyzableTokens = recordCounts.filter(r => r.count >= 4);
  console.log('\n可分析代币数 (>=4条记录): ' + analyzableTokens.length);

  // 与experiment_tokens表对比
  const { data: allTokens } = await supabase
    .from('experiment_tokens')
    .select('token_address')
    .eq('experiment_id', experimentId);

  if (allTokens) {
    console.log('experiment_tokens 表中的代币数: ' + allTokens.length);

    const tokenSet = new Set(allTokens.map(t => t.token_address));
    const withTimeSeries = recordCounts.map(r => r.address);
    const withoutTimeSeries = [...tokenSet].filter(addr => !withTimeSeries.includes(addr));

    console.log('没有时序数据的代币数: ' + withoutTimeSeries.length);
    console.log('有时序数据的代币数: ' + withTimeSeries.length);
  }
}

checkTimeSeriesCount().catch(console.error);
