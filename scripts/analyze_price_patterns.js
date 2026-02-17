require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function analyzePricePatterns() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  console.log('正在获取时序数据...');
  const { data: timeSeriesData, error: tsError } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('timestamp', { ascending: true });

  if (tsError) {
    console.log('查询时序数据错误:', tsError.message);
    return;
  }

  console.log('获取到 ' + timeSeriesData.length + ' 条时序记录\n');

  // 按代币分组
  const byToken = new Map();
  timeSeriesData.forEach(ts => {
    const addr = ts.token_address;
    if (!byToken.has(addr)) {
      byToken.set(addr, []);
    }
    byToken.get(addr).push(ts);
  });

  console.log('共有 ' + byToken.size + ' 个代币\n');

  // 统计连续上涨次数
  const riseCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const tokensByRiseCount = { 0: [], 1: [], 2: [], 3: [] };

  byToken.forEach((records, addr) => {
    records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (records.length < 4) {
      return;
    }

    const prices = records.slice(0, 4).map(r => {
      const f = r.factor_values || {};
      return f.currentPrice;
    });

    if (prices.some(p => !p || p <= 0)) {
      return;
    }

    let riseCount = 0;
    if (prices[1] > prices[0]) riseCount++;
    if (prices[2] > prices[1]) riseCount++;
    if (prices[3] > prices[2]) riseCount++;

    riseCounts[riseCount]++;
    tokensByRiseCount[riseCount].push({
      address: addr,
      symbol: records[0]?.token_symbol || 'Unknown',
      prices: prices,
      changes: [
        prices[1] > prices[0] ? '+' + ((prices[1] - prices[0]) / prices[0] * 100).toFixed(2) + '%' : '-' + ((prices[0] - prices[1]) / prices[0] * 100).toFixed(2) + '%',
        prices[2] > prices[1] ? '+' + ((prices[2] - prices[1]) / prices[1] * 100).toFixed(2) + '%' : '-' + ((prices[1] - prices[2]) / prices[1] * 100).toFixed(2) + '%',
        prices[3] > prices[2] ? '+' + ((prices[3] - prices[2]) / prices[2] * 100).toFixed(2) + '%' : '-' + ((prices[2] - prices[3]) / prices[2] * 100).toFixed(2) + '%'
      ]
    });
  });

  console.log('=== 连续上涨次数统计 ===\n');
  console.log('0次连续上涨（全部下跌或震荡）: ' + riseCounts[0] + ' 个代币');
  console.log('1次连续上涨: ' + riseCounts[1] + ' 个代币');
  console.log('2次连续上涨: ' + riseCounts[2] + ' 个代币');
  console.log('3次连续上涨（符合条件）: ' + riseCounts[3] + ' 个代币');

  // 显示各类型代币示例
  console.log('\n=== 各类型代币示例 ===\n');

  for (let count = 3; count >= 0; count--) {
    const tokens = tokensByRiseCount[count];
    if (tokens.length === 0) continue;

    console.log('--- ' + count + '次连续上涨 (' + tokens.length + '个) ---');

    // 最多显示5个
    tokens.slice(0, 5).forEach((t, i) => {
      console.log('  ' + (i + 1) + '. ' + t.symbol + ' (' + t.address.slice(0, 10) + '...)');
      console.log('     价格: ' + t.prices.map(p => p.toFixed(8)).join(' -> '));
      console.log('     变化: ' + t.changes.join(', '));
    });
    console.log('');
  }

  // 分析一下为什么没有3次连续上涨的
  console.log('=== 价格波动分析 ===\n');

  const allPriceChanges = [];
  byToken.forEach((records, addr) => {
    records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (records.length < 4) return;

    const prices = records.slice(0, 4).map(r => {
      const f = r.factor_values || {};
      return f.currentPrice;
    });

    if (prices.some(p => !p || p <= 0)) return;

    // 计算每次变化
    for (let i = 1; i < prices.length; i++) {
      allPriceChanges.push((prices[i] - prices[i-1]) / prices[i-1] * 100);
    }
  });

  allPriceChanges.sort((a, b) => a - b);

  console.log('总价格变化次数: ' + allPriceChanges.length);
  console.log('上涨次数: ' + allPriceChanges.filter(c => c > 0).length);
  console.log('下跌次数: ' + allPriceChanges.filter(c => c < 0).length);
  console.log('上涨概率: ' + (allPriceChanges.filter(c => c > 0).length / allPriceChanges.length * 100).toFixed(1) + '%');
  console.log('\n价格变化分布:');
  console.log('  最小跌幅: ' + allPriceChanges[0].toFixed(2) + '%');
  console.log('  25分位: ' + allPriceChanges[Math.floor(allPriceChanges.length * 0.25)].toFixed(2) + '%');
  console.log('  中位数: ' + allPriceChanges[Math.floor(allPriceChanges.length * 0.5)].toFixed(2) + '%');
  console.log('  75分位: ' + allPriceChanges[Math.floor(allPriceChanges.length * 0.75)].toFixed(2) + '%');
  console.log('  最大涨幅: ' + allPriceChanges[allPriceChanges.length - 1].toFixed(2) + '%');
}

analyzePricePatterns().catch(console.error);
