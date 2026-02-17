require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function exportTokensDataToCSV() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  // 获取所有时序数据
  const { data: tokensData, error } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('timestamp', { ascending: false });

  if (error) {
    console.log('查询错误:', error.message);
    return;
  }

  // 按代币分组，只取每个代币的最新一条记录
  const latestByToken = new Map();
  tokensData.forEach(ts => {
    const key = ts.token_address;
    if (!latestByToken.has(key)) {
      latestByToken.set(key, ts);
    }
  });

  const uniqueTokens = Array.from(latestByToken.values());
  console.log('实验中有 ' + uniqueTokens.length + ' 个代币');

  // 获取所有代币的历史数据，用于计算更多统计信息
  const allByToken = new Map();
  tokensData.forEach(ts => {
    const key = ts.token_address;
    if (!allByToken.has(key)) {
      allByToken.set(key, []);
    }
    allByToken.get(key).push(ts);
  });

  // 构建 CSV
  const csvRows = [];

  // CSV 表头
  const headers = [
    'token_address',
    'token_symbol',
    'latest_timestamp',
    'status',
    'age_minutes',
    'earlyReturn_percent',
    'riseSpeed',
    'currentPrice',
    'launchPrice',
    'collectionPrice',
    'holders',
    'txVolumeU24h',
    'tvl',
    'fdv',
    'marketCap',
    'highestPrice',
    'drawdownFromHighest_percent',
    'buyPrice',
    'profitPercent',
    'holdDuration_seconds',
    'total_records'
  ];

  csvRows.push(headers.join(','));

  // 添加数据行
  uniqueTokens.forEach(ts => {
    const f = ts.factor_values || {};
    const history = allByToken.get(ts.token_address) || [];

    const row = [
      ts.token_address || '',
      ts.token_symbol || '',
      ts.timestamp || '',
      ts.status || '',
      f.age?.toFixed(2) || '',
      f.earlyReturn?.toFixed(2) || '',
      f.riseSpeed?.toFixed(2) || '',
      f.currentPrice || '',
      f.launchPrice || '',
      f.collectionPrice || '',
      f.holders || '',
      f.txVolumeU24h || '',
      f.tvl || '',
      f.fdv || '',
      f.marketCap || '',
      f.highestPrice || '',
      f.drawdownFromHighest?.toFixed(2) || '',
      f.buyPrice || '',
      f.profitPercent || '',
      f.holdDuration || '',
      history.length
    ].map(v => {
      if (v === null || v === undefined || v === '') return '';
      const str = String(v);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    });

    csvRows.push(row.join(','));
  });

  const csvContent = csvRows.join('\n');

  // 写入文件
  const filename = 'experiment_' + experimentId.slice(0, 8) + '_tokens_data.csv';
  fs.writeFileSync(filename, csvContent, 'utf8');

  console.log('\nCSV 文件已生成: ' + filename);
  console.log('\n包含字段:');
  headers.forEach((h, i) => {
    console.log('  ' + (i + 1) + '. ' + h);
  });
}

exportTokensDataToCSV().catch(console.error);
