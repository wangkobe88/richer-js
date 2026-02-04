const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function analyzeReturns() {
  // 1. 获取所有买入信号
  const { data: signals, error: signalsError } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', '303b22cb-d17a-488f-b187-cfd650d0ce7c')
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  if (signalsError) {
    console.error('Error fetching signals:', signalsError);
    return;
  }

  console.log('Total buy signals:', signals.length);

  // 2. 按代币分组，获取第一个信号
  const tokenFirstSignals = new Map();
  for (const signal of signals) {
    const key = signal.token_address;
    if (!tokenFirstSignals.has(key)) {
      tokenFirstSignals.set(key, {
        tokenAddress: signal.token_address,
        symbol: signal.token_symbol || signal.metadata?.symbol || 'Unknown',
        firstSignal: {
          id: signal.id,
          price: signal.metadata?.price,
          created_at: signal.created_at
        }
      });
    }
  }

  console.log('Unique tokens with buy signals:', tokenFirstSignals.size);

  // 3. 分析每个代币的收益率
  const results = [];

  for (const [tokenAddress, signalData] of tokenFirstSignals) {
    // 获取该代币的时序数据
    const { data: timeSeries, error: tsError } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', '303b22cb-d17a-488f-b187-cfd650d0ce7c')
      .eq('token_address', tokenAddress)
      .order('timestamp', { ascending: true });

    if (tsError) {
      console.error('Error fetching time series for', tokenAddress, tsError);
      continue;
    }

    if (!timeSeries || timeSeries.length === 0) {
      console.log('No time series data for', tokenAddress);
      continue;
    }

    // 找到第一个信号之后的第一个时序数据点
    const signalTime = new Date(signalData.firstSignal.created_at).getTime();
    const firstAfterSignal = timeSeries.find(ts => new Date(ts.timestamp).getTime() >= signalTime);

    // 最后一个时序数据点
    const lastTimePoint = timeSeries[timeSeries.length - 1];

    if (firstAfterSignal && lastTimePoint) {
      // 尝试获取价格字段
      const buyPrice = firstAfterSignal.price_usd || firstAfterSignal.currentPrice || firstAfterSignal.price;
      const sellPrice = lastTimePoint.price_usd || lastTimePoint.currentPrice || lastTimePoint.price;

      if (!buyPrice || !sellPrice) {
        console.log('No price data for', tokenAddress);
        continue;
      }

      const returnPercent = ((sellPrice - buyPrice) / buyPrice) * 100;

      results.push({
        tokenAddress: tokenAddress,
        symbol: signalData.symbol,
        buyPrice: buyPrice,
        sellPrice: sellPrice,
        returnPercent: returnPercent,
        buyTime: firstAfterSignal.timestamp,
        sellTime: lastTimePoint.timestamp,
        dataPoints: timeSeries.length
      });
    }
  }

  // 4. 排序并输出结果
  results.sort((a, b) => b.returnPercent - a.returnPercent);

  console.log('\n========== 收益率分析 ==========');
  console.log('代币数量:', results.length);
  console.log('\n详细结果:');
  console.log('序号 | 代币 | 买入价格 | 卖出价格 | 收益率 | 数据点数');
  console.log('---');

  let totalReturn = 0;
  let winCount = 0;
  let lossCount = 0;

  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.symbol} | ${r.buyPrice.toExponential(2)} | ${r.sellPrice.toExponential(2)} | ${r.returnPercent.toFixed(2)}% | ${r.dataPoints}点`);
    totalReturn += r.returnPercent;
    if (r.returnPercent > 0) winCount++;
    else lossCount++;
  });

  const avgReturn = totalReturn / results.length;
  const winRate = results.length > 0 ? (winCount / results.length) * 100 : 0;

  console.log('\n========== 统计摘要 ==========');
  console.log('总交易数:', results.length);
  console.log('平均收益率:', avgReturn.toFixed(2) + '%');
  console.log('胜率:', winRate.toFixed(2) + '%');
  console.log('盈利交易:', winCount);
  console.log('亏损交易:', lossCount);

  if (results.length > 0) {
    console.log('\n最佳交易:', results[0].symbol, results[0].returnPercent.toFixed(2) + '%');
    console.log('最差交易:', results[results.length - 1].symbol, results[results.length - 1].returnPercent.toFixed(2) + '%');

    // 计算如果每次都投入相同金额的总收益
    const investPerTrade = 1; // 假设每次投入1 BNB (4张卡 x 0.25 BNB)
    const totalInvested = results.length * investPerTrade;
    const totalReturnBNB = results.reduce((sum, r) => sum + (investPerTrade * r.returnPercent / 100), 0);
    const finalValue = totalInvested + totalReturnBNB;
    console.log('\n========== 资金模拟 ==========');
    console.log('每笔投入:', investPerTrade, 'BNB (4张卡 x 0.25 BNB)');
    console.log('总投入:', totalInvested.toFixed(2), 'BNB');
    console.log('总收益:', totalReturnBNB.toFixed(2), 'BNB');
    console.log('最终价值:', finalValue.toFixed(2), 'BNB');
    console.log('总回报率:', ((totalReturnBNB / totalInvested) * 100).toFixed(2) + '%');
  }
}

analyzeReturns();
