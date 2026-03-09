const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeTradeSignals() {
  const experimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  console.log('=== 交易信号特征分析 ===');
  console.log('');

  const pumpAndDump = [
    '0x2be52e98e45ed3d27f56284972b3545dac964444',
    '0x281f05868b5ba9e55869541a117ebb661f474444',
    '0xf3372a3dbc824f0b0044ca77209559514b294444',
    '0xb9b1142a28fade5771b7ae076c96c3bee8beffff',
    '0xd8d4ddeb91987a121422567260a88230dbb34444',
    '0x68b04d6e06495866cc810d4179caf97651a5ffff',
    '0x98fe71847aa16d9e40a4f0e123d172bc71d14444',
    '0x721f5abc0d34948aa0904ba135cc4d9c6ff84444'
  ];

  const notPumpAndDump = [
    '0x1443d233e2dbad52df65e6b17063274e6c844444',
    '0xf40dec26ab76df60a761e78c84682d7117a64444',
    '0x0da3a0a3bd66bbeaaa4d35d12cb9ea3725294444',
    '0x16aeb87aeb78e4cf7987f16e910c285d77354444',
    '0xa9fe96fd5230a135ada220523032b3e1a67d4444',
    '0x4d15d67fcf9bd0b109efa7fc1b150416cca04444',
    '0xd7a23f95c6698c44c7b861408f0d7b47acc74444'
  ];

  const allAddresses = [...pumpAndDump, ...notPumpAndDump];

  // 获取买卖信号
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .in('token_address', allAddresses)
    .order('created_at', { ascending: true });

  const { data: sellSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'sell')
    .in('token_address', allAddresses)
    .order('created_at', { ascending: true });

  // 获取时序数据
  const { data: timeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .in('token_address', allAddresses)
    .order('timestamp', { ascending: true });

  console.log('=== 第一阶段：买入信号特征分析 ===');
  console.log('');

  // 分析每个代币的买入信号特征
  pumpAndDump.forEach(addr => {
    const buySig = buySignals?.find(s => s.token_address === addr);
    if (!buySig) return;

    const metadata = buySig.metadata || {};
    const tf = metadata.trendFactors || {};

    console.log('拉砸代币:', metadata.symbol || addr.substring(0, 8));
    console.log('  买入时间:', buySig.created_at);
    console.log('  买入价格:', metadata.price);
    console.log('  代币年龄(age):', tf.age?.toFixed(2), '分钟');
    console.log('  早期收益率:', tf.earlyReturn?.toFixed(1), '%');
    console.log('  上涨速度:', tf.riseSpeed?.toFixed(1), '%/分钟');
  });

  console.log('');
  notPumpAndDump.forEach(addr => {
    const buySig = buySignals?.find(s => s.token_address === addr);
    if (!buySig) return;

    const metadata = buySig.metadata || {};
    const tf = metadata.trendFactors || {};

    console.log('正常代币:', metadata.symbol || addr.substring(0, 8));
    console.log('  买入时间:', buySig.created_at);
    console.log('  买入价格:', metadata.price);
    console.log('  代币年龄(age):', tf.age?.toFixed(2), '分钟');
    console.log('  早期收益率:', tf.earlyReturn?.toFixed(1), '%');
    console.log('  上涨速度:', tf.riseSpeed?.toFixed(1), '%/分钟');
  });

  console.log('');
  console.log('=== 第二阶段：价格走势分析 ===');
  console.log('');

  // 分析买入前后的价格走势
  pumpAndDump.forEach(addr => {
    const buySig = buySignals?.find(s => s.token_address === addr);
    const sellSig = sellSignals?.find(s => s.token_address === addr);
    if (!buySig) return;

    const tokenTimeSeries = timeSeriesData?.filter(ts => ts.token_address === addr) || [];

    if (tokenTimeSeries.length > 0) {
      const buyTime = new Date(buySig.created_at).getTime();
      const buyPrice = buySig.metadata?.price || 0;

      // 找到买入点前的最低点和最高点
      let minBeforeBuy = Infinity;
      let maxAfterBuy = 0;
      let maxAfterBuyTime = 0;

      tokenTimeSeries.forEach(ts => {
        const tsTime = new Date(ts.timestamp).getTime();
        const price = ts.factor_values?.currentPrice || 0;

        if (tsTime <= buyTime && price < minBeforeBuy) {
          minBeforeBuy = price;
        }
        if (tsTime > buyTime && price > maxAfterBuy) {
          maxAfterBuy = price;
          maxAfterBuyTime = tsTime;
        }
      });

      // 计算峰后下跌
      const sellPrice = sellSig?.metadata?.price || buyPrice;
      const peakDrawdown = maxAfterBuy > 0 ? ((sellPrice - maxAfterBuy) / maxAfterBuy * 100) : 0;

      console.log('拉砸代币:', buySig.metadata?.symbol || addr.substring(0, 8));
      console.log('  买入前最低:', minBeforeBuy);
      console.log('  买入价格:', buyPrice);
      console.log('  买入后峰值:', maxAfterBuy, '(', ((maxAfterBuy - buyPrice) / buyPrice * 100).toFixed(1), '%)');
      console.log('  卖出价格:', sellPrice);
      console.log('  峰后跌幅:', peakDrawdown.toFixed(1), '%');
      console.log('  峰值到卖出时间:', maxAfterBuyTime > 0 ? ((new Date(sellSig?.created_at || 0).getTime() - maxAfterBuyTime) / 1000).toFixed(0) + '秒' : 'N/A');
    }
  });

  console.log('');
  notPumpAndDump.forEach(addr => {
    const buySig = buySignals?.find(s => s.token_address === addr);
    const sellSig = sellSignals?.find(s => s.token_address === addr);
    if (!buySig) return;

    const tokenTimeSeries = timeSeriesData?.filter(ts => ts.token_address === addr) || [];

    if (tokenTimeSeries.length > 0) {
      const buyTime = new Date(buySig.created_at).getTime();
      const buyPrice = buySig.metadata?.price || 0;

      let minBeforeBuy = Infinity;
      let maxAfterBuy = 0;
      let maxAfterBuyTime = 0;

      tokenTimeSeries.forEach(ts => {
        const tsTime = new Date(ts.timestamp).getTime();
        const price = ts.factor_values?.currentPrice || 0;

        if (tsTime <= buyTime && price < minBeforeBuy) {
          minBeforeBuy = price;
        }
        if (tsTime > buyTime && price > maxAfterBuy) {
          maxAfterBuy = price;
          maxAfterBuyTime = tsTime;
        }
      });

      const sellPrice = sellSig?.metadata?.price || buyPrice;
      const peakDrawdown = maxAfterBuy > 0 ? ((sellPrice - maxAfterBuy) / maxAfterBuy * 100) : 0;

      console.log('正常代币:', buySig.metadata?.symbol || addr.substring(0, 8));
      console.log('  买入前最低:', minBeforeBuy);
      console.log('  买入价格:', buyPrice);
      console.log('  买入后峰值:', maxAfterBuy, '(', ((maxAfterBuy - buyPrice) / buyPrice * 100).toFixed(1), '%)');
      console.log('  卖出价格:', sellPrice);
      console.log('  峰后跌幅:', peakDrawdown.toFixed(1), '%');
      console.log('  峰值到卖出时间:', maxAfterBuyTime > 0 ? ((new Date(sellSig?.created_at || 0).getTime() - maxAfterBuyTime) / 1000).toFixed(0) + '秒' : 'N/A');
    }
  });

  console.log('');
  console.log('=== 统计总结 ===');
  console.log('');

  // 计算统计指标
  const pumpStats = [];
  const normalStats = [];

  pumpAndDump.forEach(addr => {
    const buySig = buySignals?.find(s => s.token_address === addr);
    const sellSig = sellSignals?.find(s => s.token_address === addr);
    if (!buySig) return;

    const buyTime = new Date(buySig.created_at).getTime();
    const sellTime = sellSig ? new Date(sellSig.created_at).getTime() : buyTime;
    const holdDuration = (sellTime - buyTime) / 1000;

    const buyPrice = buySig.metadata?.price || 0;
    const sellPrice = sellSig?.metadata?.price || buyPrice;
    const profitPct = ((sellPrice - buyPrice) / buyPrice * 100);

    const tf = buySig.metadata?.trendFactors || {};

    pumpStats.push({
      holdDuration,
      profitPct,
      age: tf.age || 0,
      earlyReturn: tf.earlyReturn || 0
    });
  });

  notPumpAndDump.forEach(addr => {
    const buySig = buySignals?.find(s => s.token_address === addr);
    const sellSig = sellSignals?.find(s => s.token_address === addr);
    if (!buySig) return;

    const buyTime = new Date(buySig.created_at).getTime();
    const sellTime = sellSig ? new Date(sellSig.created_at).getTime() : buyTime;
    const holdDuration = (sellTime - buyTime) / 1000;

    const buyPrice = buySig.metadata?.price || 0;
    const sellPrice = sellSig?.metadata?.price || buyPrice;
    const profitPct = ((sellPrice - buyPrice) / buyPrice * 100);

    const tf = buySig.metadata?.trendFactors || {};

    normalStats.push({
      holdDuration,
      profitPct,
      age: tf.age || 0,
      earlyReturn: tf.earlyReturn || 0
    });
  });

  const avg = (arr, key) => arr.reduce((sum, item) => sum + item[key], 0) / arr.length;

  console.log('拉砸代币:');
  console.log('  平均持仓时间:', avg(pumpStats, 'holdDuration').toFixed(1), '秒');
  console.log('  平均盈亏:', avg(pumpStats, 'profitPct').toFixed(1), '%');
  console.log('  平均代币年龄:', avg(pumpStats, 'age').toFixed(2), '分钟');
  console.log('  平均早期收益率:', avg(pumpStats, 'earlyReturn').toFixed(1), '%');

  console.log('');
  console.log('正常代币:');
  console.log('  平均持仓时间:', avg(normalStats, 'holdDuration').toFixed(1), '秒');
  console.log('  平均盈亏:', avg(normalStats, 'profitPct').toFixed(1), '%');
  console.log('  平均代币年龄:', avg(normalStats, 'age').toFixed(2), '分钟');
  console.log('  平均早期收益率:', avg(normalStats, 'earlyReturn').toFixed(1), '%');

  console.log('');
  console.log('=== 关键特征对比 ===');
  console.log('');

  // 测试持仓时间作为特征
  const pumpShortHold = pumpStats.filter(s => s.holdDuration < 20).length;
  const normalShortHold = normalStats.filter(s => s.holdDuration < 20).length;

  console.log('持仓时间 < 20秒:');
  console.log('  拉砸:', pumpShortHold, '/', pumpStats.length, '(' + (pumpShortHold / pumpStats.length * 100).toFixed(1) + '%)');
  console.log('  正常:', normalShortHold, '/', normalStats.length, '(' + (normalShortHold / normalStats.length * 100).toFixed(1) + '%)');

  console.log('');
  console.log('代币年龄 < 1.5分钟:');
  const pumpYoung = pumpStats.filter(s => s.age < 1.5).length;
  const normalYoung = normalStats.filter(s => s.age < 1.5).length;
  console.log('  拉砸:', pumpYoung, '/', pumpStats.length, '(' + (pumpYoung / pumpStats.length * 100).toFixed(1) + '%)');
  console.log('  正常:', normalYoung, '/', normalStats.length, '(' + (normalYoung / normalStats.length * 100).toFixed(1) + '%)');

  console.log('');
  console.log('早期收益率 > 200%:');
  const pumpHighReturn = pumpStats.filter(s => s.earlyReturn > 200).length;
  const normalHighReturn = normalStats.filter(s => s.earlyReturn > 200).length;
  console.log('  拉砸:', pumpHighReturn, '/', pumpStats.length, '(' + (pumpHighReturn / pumpStats.length * 100).toFixed(1) + '%)');
  console.log('  正常:', normalHighReturn, '/', normalStats.length, '(' + (normalHighReturn / normalStats.length * 100).toFixed(1) + '%)');
}

analyzeTradeSignals().catch(console.error);
