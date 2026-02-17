require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function findPriceRisingTokens() {
  // 用户提供的ID是代币地址，需要找到对应的实验
  const tokenAddress = '0xf8433e46d33e29928c7215a092a37581039a4444';

  console.log('正在查找包含代币 ' + tokenAddress + ' 的实验...');

  // 先通过 experiment_tokens 查找实验
  const { data: tokenRecords, error: tokenError } = await supabase
    .from('experiment_tokens')
    .select('experiment_id')
    .eq('token_address', tokenAddress);

  if (tokenError) {
    console.log('查询代币错误:', tokenError.message);
    return;
  }

  if (!tokenRecords || tokenRecords.length === 0) {
    console.log('未找到包含该代币的实验');
    return;
  }

  // 使用第一个找到的实验ID
  const experimentId = tokenRecords[0].experiment_id;
  console.log('找到实验ID: ' + experimentId + '\n');

  // 获取该实验的所有时序数据
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

  // 按代币分组，并按时间排序
  const byToken = new Map();
  timeSeriesData.forEach(ts => {
    const addr = ts.token_address;
    if (!byToken.has(addr)) {
      byToken.set(addr, []);
    }
    byToken.get(addr).push(ts);
  });

  console.log('共有 ' + byToken.size + ' 个代币\n');

  // 分析每个代币的前三次价格变化
  const risingTokens = [];
  const notRisingTokens = [];

  byToken.forEach((records, addr) => {
    // 按时间排序
    records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // 需要至少有4条记录（获取时 + 3次后续数据）
    if (records.length < 4) {
      notRisingTokens.push({
        address: addr,
        symbol: records[0]?.token_symbol || 'Unknown',
        reason: '数据不足(' + records.length + '条)'
      });
      return;
    }

    // 获取前4条记录的价格
    const prices = records.slice(0, 4).map(r => {
      const f = r.factor_values || {};
      return f.currentPrice;
    });

    // 检查是否有效价格
    if (prices.some(p => !p || p <= 0)) {
      notRisingTokens.push({
        address: addr,
        symbol: records[0]?.token_symbol || 'Unknown',
        reason: '价格数据无效'
      });
      return;
    }

    // 第一次变化: prices[1] > prices[0]
    // 第二次变化: prices[2] > prices[1]
    // 第三次变化: prices[3] > prices[2]
    const rise1 = prices[1] > prices[0];
    const rise2 = prices[2] > prices[1];
    const rise3 = prices[3] > prices[2];

    if (rise1 && rise2 && rise3) {
      risingTokens.push({
        address: addr,
        symbol: records[0]?.token_symbol || 'Unknown',
        prices: prices,
        priceChanges: [
          ((prices[1] - prices[0]) / prices[0] * 100).toFixed(2),
          ((prices[2] - prices[1]) / prices[1] * 100).toFixed(2),
          ((prices[3] - prices[2]) / prices[2] * 100).toFixed(2)
        ],
        totalRise: ((prices[3] - prices[0]) / prices[0] * 100).toFixed(2)
      });
    } else {
      notRisingTokens.push({
        address: addr,
        symbol: records[0]?.token_symbol || 'Unknown',
        reason: '价格变化: ' + (rise1 ? '+' : '-') + (rise2 ? '+' : '-') + (rise3 ? '+' : '-')
      });
    }
  });

  console.log('=== 符合条件（前三次价格全部上涨）的代币 ===\n');
  console.log('共 ' + risingTokens.length + ' 个代币\n');

  if (risingTokens.length > 0) {
    // 按总涨幅排序
    risingTokens.sort((a, b) => parseFloat(b.totalRise) - parseFloat(a.totalRise));

    risingTokens.forEach((token, i) => {
      console.log((i + 1) + '. ' + token.symbol);
      console.log('   地址: ' + token.address);
      console.log('   价格序列: ' + token.prices.map(p => p.toFixed(8)).join(' -> '));
      console.log('   三次涨幅: ' + token.priceChanges.join('%, ') + '%');
      console.log('   总涨幅: ' + token.totalRise + '%');
      console.log('');
    });
  } else {
    console.log('没有符合条件的代币\n');
  }

  console.log('\n=== 统计信息 ===');
  console.log('总代币数: ' + byToken.size);
  console.log('符合条件: ' + risingTokens.length);
  console.log('不符合: ' + notRisingTokens.length);
  console.log('符合比例: ' + (byToken.size > 0 ? (risingTokens.length / byToken.size * 100).toFixed(1) : 0) + '%');
}

findPriceRisingTokens().catch(console.error);
