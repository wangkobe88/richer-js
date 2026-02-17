require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

/**
 * 计算RSI
 * @param {Array<number>} prices - 价格数组（按时间顺序）
 * @param {number} period - RSI周期
 * @returns {Array<{rsi: number|null, price: number}>} - 每个点位的RSI值（前period-1个点位为null）
 */
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) {
    return prices.map(() => ({ rsi: null, price: 0 }));
  }

  const result = [];
  const gains = [];
  const losses = [];

  // 计算价格变化
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  // 计算初始平均涨幅和跌幅（使用简单移动平均）
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  // 第一个RSI值
  const firstRsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  // 前period个点位RSI为null（需要足够的历史数据）
  for (let i = 0; i < period; i++) {
    result.push({ rsi: null, price: prices[i] });
  }

  result.push({ rsi: firstRsi, price: prices[period] });

  // 后续RSI使用Wilder平滑方法
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    result.push({ rsi: rsi, price: prices[i + 1] });
  }

  return result;
}

async function analyzeRSISignals() {
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

  // 计算每个代币的RSI
  const tokensWithRSI = [];
  const rsiThreshold = 70;

  // 对于低流动性场景，使用较短的RSI周期
  // 标准是14，但这里数据少，可以用6-9
  const rsiPeriods = [6, 9, 14];

  byToken.forEach((records, addr) => {
    records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // 取前10次数据
    const dataPoints = Math.min(10, records.length);
    if (dataPoints < rsiPeriods[0] + 1) return; // 至少需要 period+1 个数据点

    const prices = records.slice(0, dataPoints).map(r => {
      const f = r.factor_values || {};
      return f.currentPrice;
    });

    if (prices.some(p => !p || p <= 0)) return;

    // 检查是否有价格变化
    const allSame = prices.every(p => p === prices[0]);
    if (allSame) return;

    const symbol = records[0]?.token_symbol || 'Unknown';

    // 计算不同周期的RSI
    const rsiResults = {};
    rsiPeriods.forEach(period => {
      const rsiData = calculateRSI(prices, period);
      rsiResults['period_' + period] = rsiData;

      // 找出RSI > 70的点位
      const signalPoints = [];
      rsiData.forEach((d, i) => {
        if (d.rsi !== null && d.rsi > rsiThreshold) {
          signalPoints.push({
            index: i,
            dataPointNumber: i + 1, // 第几次数据采集
            rsi: d.rsi,
            price: d.price
          });
        }
      });

      if (signalPoints.length > 0) {
        if (!tokensWithRSI.find(t => t.address === addr)) {
          tokensWithRSI.push({
            address: addr,
            symbol: symbol,
            prices: prices,
            rsiPeriods: {}
          });
        }

        const token = tokensWithRSI.find(t => t.address === addr);
        token.rsiPeriods['period_' + period] = {
          rsiData: rsiData,
          signalPoints: signalPoints
        };
      }
    });
  });

  console.log('=== RSI > 70 信号分析 ===\n');
  console.log('RSI阈值: ' + rsiThreshold);
  console.log('有RSI > 70信号的代币: ' + tokensWithRSI.length + ' 个\n');

  // 按RSI周期显示结果
  rsiPeriods.forEach(period => {
    const key = 'period_' + period;
    const tokensWithSignal = tokensWithRSI.filter(t => t.rsiPeriods[key]);

    console.log('--- RSI周期 ' + period + ' ---');
    console.log('符合条件代币: ' + tokensWithSignal.length + ' 个\n');

    tokensWithSignal.forEach(token => {
      const data = token.rsiPeriods[key];
      console.log('代币: ' + token.symbol);
      console.log('地址: ' + token.address);
      console.log('信号点位:');

      data.signalPoints.forEach(sp => {
        console.log('  第 ' + sp.dataPointNumber + ' 次数据采集: RSI=' + sp.rsi.toFixed(2) + ', 价格=' + sp.price.toFixed(8));
      });

      console.log('');
    });
  });

  // 分析：如果在不同RSI周期下都触发信号，可能是更可靠的信号
  console.log('\n=== 多周期RSI信号汇总 ===\n');

  tokensWithRSI.forEach(token => {
    const periods = [];
    rsiPeriods.forEach(period => {
      const key = 'period_' + period;
      if (token.rsiPeriods[key]) {
        periods.push(period + '(' + token.rsiPeriods[key].signalPoints.length + '次)');
      }
    });

    if (periods.length > 0) {
      console.log(token.symbol + ': ' + periods.join(', '));
    }
  });

  // 详细展示价格序列和RSI
  console.log('\n=== 价格序列与RSI对照 (RSI周期6) ===\n');

  const period6Tokens = tokensWithRSI.filter(t => t.rsiPeriods['period_6']);
  period6Tokens.slice(0, 5).forEach(token => {
    const rsiData = token.rsiPeriods['period_6'].rsiData;
    console.log(token.symbol + ' (' + token.address.slice(0, 10) + '...)');
    console.log('点位 | 价格        | RSI');
    console.log('-----|-------------|----------');

    token.prices.forEach((price, i) => {
      const rsi = rsiData[i]?.rsi;
      const rsiStr = rsi !== null ? rsi.toFixed(1) : 'N/A';
      const signal = rsi !== null && rsi > 70 ? ' <-- 信号!' : '';
      console.log(String(i + 1).padStart(4) + ' | ' + price.toFixed(8).padEnd(11) + ' | ' + rsiStr.padStart(7) + signal);
    });
    console.log('');
  });

  // 统计分析
  console.log('\n=== 统计分析 ===\n');

  const totalTokens = byToken.size;
  const tokensWithPriceChange = tokensWithRSI.length;
  const tokensWithSignalRSI6 = tokensWithRSI.filter(t => t.rsiPeriods['period_6']).length;
  const tokensWithSignalRSI9 = tokensWithRSI.filter(t => t.rsiPeriods['period_9']).length;
  const tokensWithSignalRSI14 = tokensWithRSI.filter(t => t.rsiPeriods['period_14']).length;

  console.log('总代币数: ' + totalTokens);
  console.log('有价格变化: ' + tokensWithPriceChange);
  console.log('RSI(6)>70: ' + tokensWithSignalRSI6 + ' 个 (' + (tokensWithPriceChange > 0 ? (tokensWithSignalRSI6 / tokensWithPriceChange * 100).toFixed(1) : 0) + '%)');
  console.log('RSI(9)>70: ' + tokensWithSignalRSI9 + ' 个 (' + (tokensWithPriceChange > 0 ? (tokensWithSignalRSI9 / tokensWithPriceChange * 100).toFixed(1) : 0) + '%)');
  console.log('RSI(14)>70: ' + tokensWithSignalRSI14 + ' 个 (' + (tokensWithPriceChange > 0 ? (tokensWithSignalRSI14 / tokensWithPriceChange * 100).toFixed(1) : 0) + '%)');

  // 导出CSV
  const csvRows = [];
  csvRows.push(['代币', '地址', 'RSI周期', '信号点位', 'RSI值', '价格']);

  tokensWithRSI.forEach(token => {
    rsiPeriods.forEach(period => {
      const key = 'period_' + period;
      if (token.rsiPeriods[key]) {
        token.rsiPeriods[key].signalPoints.forEach(sp => {
          csvRows.push([
            token.symbol,
            token.address,
            period,
            sp.dataPointNumber,
            sp.rsi.toFixed(2),
            sp.price.toFixed(8)
          ]);
        });
      }
    });
  });

  const csvContent = csvRows.map(row => row.map(c => `"${c}"`).join(',')).join('\n');
  fs.writeFileSync('rsi_signals.csv', csvContent, 'utf8');

  console.log('\nRSI信号数据已导出到: rsi_signals.csv');
}

analyzeRSISignals().catch(console.error);
